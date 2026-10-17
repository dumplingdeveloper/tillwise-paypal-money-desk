<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class Tillwise_Test_Runner {
	private $passed = 0;
	private $failed = 0;
	private $snapshots = array();
	private $original_guardrails;
	private $original_previews;
	private $original_history;
	private $original_paypal_audit;
	private $original_timezone;
	private $created_users = array();

	public function run() {
		$this->original_guardrails = get_option( Tillwise_Store_Agent::GUARDRAILS_OPTION, array() );
		$this->original_previews   = get_option( Tillwise_Store_Agent::PREVIEWS_OPTION, array() );
		$this->original_history    = get_option( Tillwise_Store_Agent::HISTORY_OPTION, array() );
		$this->original_paypal_audit = get_option( Tillwise_Store_Agent::PAYPAL_AUDIT_OPTION, array() );
		$this->original_timezone   = get_option( 'timezone_string' );
		try {
			$this->test_abilities_api_registration_and_core_routes();
			$this->test_permissions();
			$this->test_preview_apply_reuse_and_undo();
			$this->test_expired_and_foreign_previews();
			$this->test_concurrency_conflict();
			$this->test_undo_conflict();
			$this->test_guardrails();
			$this->test_variations();
			$this->test_category_mugs();
			$this->test_seeded_timezone();
			$this->test_mugs_sale_until_sunday_timezone();
			$this->test_sale_apply_and_undo_rows_include_regular();
			$this->test_voice_safe_speech_and_preview_pruning();
			$this->test_sale_end_date_undo();
			$this->test_sales_summary();
			$this->test_sales_summary_timezone();
			$this->test_demo_reset_briefing_data();
			$this->test_paypal_audit_and_order_links();
			$this->test_low_stock();
			$this->test_low_stock_names_unique();
			$this->test_seeded_hoodie_variations();
		} finally {
			$this->restore_all();
		}
		echo "PHP integration tests: {$this->passed} passed, {$this->failed} failed\n";
		if ( $this->failed > 0 ) { exit( 1 ); }
	}

	private function assert_true( $condition, $message ) {
		if ( $condition ) { $this->passed++; echo "PASS: $message\n"; return; }
		$this->failed++; echo "FAIL: $message\n";
	}

	private function manager_id() { return get_user_by( 'login', 'shopmanager' )->ID; }
	private function admin_id() { return get_user_by( 'login', 'admin' )->ID; }

	private function call( $ability, $body = array(), $user_id = null, $method = null ) {
		wp_set_current_user( $user_id ? $user_id : $this->manager_id() );
		if ( null === $method ) {
			$definition = Tillwise_Store_Agent::ability_definitions()[ $ability ];
			$method = ! empty( $definition['annotations']['readonly'] ) ? 'GET' : 'POST';
		}
		$request = new WP_REST_Request( $method, '/wp-abilities/v1/abilities/tillwise-store/' . $ability . '/run' );
		if ( 'GET' === $method || 'DELETE' === $method ) {
			$request->set_query_params( empty( $body ) ? array() : array( 'input' => $body ) );
		} else {
			$request->set_header( 'content-type', 'application/json' );
			$request->set_body( wp_json_encode( array( 'input' => $body ) ) );
		}
		$response = rest_do_request( $request );
		$data = $response->get_data();
		if ( $response->get_status() < 400 && is_array( $data ) && isset( $data['speech'] ) ) {
			$this->assert_voice_safe( $data['speech'], 'speech for ' . $ability . ' is voice-safe' );
		}
		return $response;
	}

	private function data( $response ) { return $response->get_data(); }

	private function assert_voice_safe( $speech, $message ) {
		$this->assert_true( false === strpos( $speech, '&' ) && ! preg_match( '/\b[ph][a-f0-9]{12,}\b/i', $speech ), $message );
	}

	private function product_by_name( $name ) {
		$posts = get_posts( array( 'post_type' => 'product', 'title' => $name, 'post_status' => 'any', 'numberposts' => 1, 'fields' => 'ids' ) );
		return $posts ? wc_get_product( (int) $posts[0] ) : null;
	}

	private function snapshot( $product_id ) {
		if ( isset( $this->snapshots[ $product_id ] ) ) { return; }
		$p = wc_get_product( $product_id );
		$this->snapshots[ $product_id ] = array( 'regular' => $p->get_regular_price(), 'sale' => $p->get_sale_price(), 'from' => $p->get_date_on_sale_from(), 'to' => $p->get_date_on_sale_to() );
	}

	private function restore_all() {
		foreach ( $this->snapshots as $id => $row ) {
			$p = wc_get_product( $id ); if ( ! $p ) { continue; }
			$p->set_regular_price( $row['regular'] ); $p->set_sale_price( $row['sale'] ); $p->set_date_on_sale_from( $row['from'] ); $p->set_date_on_sale_to( $row['to'] ); $p->save();
		}
		update_option( Tillwise_Store_Agent::GUARDRAILS_OPTION, $this->original_guardrails, false );
		update_option( Tillwise_Store_Agent::PREVIEWS_OPTION, $this->original_previews, false );
		update_option( Tillwise_Store_Agent::HISTORY_OPTION, $this->original_history, false );
		update_option( Tillwise_Store_Agent::PAYPAL_AUDIT_OPTION, $this->original_paypal_audit, false );
		update_option( 'timezone_string', $this->original_timezone, false );
		foreach ( $this->created_users as $user_id ) { wp_delete_user( $user_id ); }
		wp_set_current_user( 0 );
	}

	private function preview_for_ids( $ids, $amount = 10, $field = 'regular' ) {
		foreach ( $ids as $id ) { $this->snapshot( $id ); }
		return $this->call( 'price-change-preview', array( 'target' => array( 'product_ids' => $ids ), 'change_type' => 'percent_decrease', 'amount' => $amount, 'price_field' => $field ) );
	}

	private function test_abilities_api_registration_and_core_routes() {
		wp_set_current_user( $this->manager_id() );
		$ability = wp_get_ability( 'tillwise-store/low-stock' );
		$this->assert_true( $ability instanceof WP_Ability, 'tillwise low-stock is registered with Abilities API' );
		$result = $ability->execute( array() );
		$this->assert_true( is_array( $result ) && isset( $result['speech'] ), 'wp_get_ability(...)->execute() works' );

		$ok = $this->call( 'low-stock', array(), $this->manager_id(), 'GET' );
		$this->assert_true( 200 === $ok->get_status(), 'readonly ability runs over GET using core envelope' );
		$bad_method = $this->call( 'low-stock', array(), $this->manager_id(), 'POST' );
		$this->assert_true( 405 === $bad_method->get_status(), 'core rejects readonly ability over POST' );
		$invalid = $this->call( 'sales-summary', array( 'period' => 'not-a-period' ), $this->manager_id(), 'GET' );
		$this->assert_true( 400 === $invalid->get_status(), 'core schema validation rejects invalid input' );
		$updated = $this->call( 'guardrails-update', array( 'min_price' => 1.23 ), $this->manager_id(), 'POST' );
		$this->assert_true( 200 === $updated->get_status(), 'non-readonly ability runs over POST using core envelope' );

		wp_set_current_user( $this->admin_id() );
		$core = new WP_REST_Request( 'GET', '/wp-abilities/v1/abilities/core/get-site-info/run' );
		$core_response = rest_do_request( $core );
		$this->assert_true( 200 === $core_response->get_status(), 'core/get-site-info still returns 200 with plugin active' );
	}

	private function test_permissions() {
		wp_set_current_user( 0 );
		$anon_request = new WP_REST_Request( 'GET', '/wp-abilities/v1/abilities/tillwise-store/low-stock/run' );
		$anon = rest_do_request( $anon_request );
		$this->assert_true( $anon->get_status() >= 400, 'anonymous user is denied through REST' );
		$customer_id = username_exists( 'tillwise_customer' ) ?: wp_create_user( 'tillwise_customer', 'password', 'customer@example.test' );
		$this->created_users[] = $customer_id;
		$user = get_user_by( 'id', $customer_id ); $user->set_role( 'customer' );
		$customer = $this->call( 'low-stock', array(), $customer_id );
		$this->assert_true( $customer->get_status() >= 400, 'customer user is denied through REST' );
	}

	private function test_preview_apply_reuse_and_undo() {
		$p = $this->product_by_name( 'Ceramic Sunrise Mug' ); $this->snapshot( $p->get_id() ); $old = (float) $p->get_regular_price();
		$preview = $this->data( $this->preview_for_ids( array( $p->get_id() ), 10 ) );
		$expected_new = $preview['data']['changes'][0]['new'];
		$p = wc_get_product( $p->get_id() );
		$this->assert_true( abs( (float) $p->get_regular_price() - $old ) < 0.001, 'preview does not mutate prices' );
		$apply = $this->data( $this->call( 'price-change-apply', array( 'preview_id' => $preview['data']['preview_id'] ) ) );
		$p = wc_get_product( $p->get_id() );
		$this->assert_true( abs( (float) $p->get_regular_price() - $expected_new ) < 0.001, 'apply applies exactly previewed values' );
		$reused = $this->call( 'price-change-apply', array( 'preview_id' => $preview['data']['preview_id'] ) );
		$this->assert_true( $reused->get_status() >= 400, 'apply rejects reused previews' );
		$undo = $this->data( $this->call( 'price-change-undo', array( 'history_id' => $apply['data']['history_id'] ) ) );
		$p = wc_get_product( $p->get_id() );
		$this->assert_true( abs( (float) $p->get_regular_price() - $old ) < 0.001 && 1 === $undo['data']['restored_count'], 'undo restores values' );
	}

	private function test_expired_and_foreign_previews() {
		$p = $this->product_by_name( 'Tall Latte Mug' ); $preview = $this->data( $this->preview_for_ids( array( $p->get_id() ), 5 ) );
		$previews = get_option( Tillwise_Store_Agent::PREVIEWS_OPTION, array() ); $previews[ $preview['data']['preview_id'] ]['expires_at'] = time() - 1; update_option( Tillwise_Store_Agent::PREVIEWS_OPTION, $previews, false );
		$expired = $this->call( 'price-change-apply', array( 'preview_id' => $preview['data']['preview_id'] ) );
		$this->assert_true( 410 === $expired->get_status(), 'apply rejects expired previews' );
		$preview2 = $this->data( $this->preview_for_ids( array( $p->get_id() ), 5 ) );
		$other = username_exists( 'other_manager' ) ?: wp_create_user( 'other_manager', 'password', 'other@example.test' ); $this->created_users[] = $other; get_user_by( 'id', $other )->set_role( 'shop_manager' );
		$foreign = $this->call( 'price-change-apply', array( 'preview_id' => $preview2['data']['preview_id'] ), $other );
		$this->assert_true( 403 === $foreign->get_status(), 'apply rejects foreign-user previews' );
	}

	private function test_concurrency_conflict() {
		$p = $this->product_by_name( 'Travel Cork Mug' ); $this->snapshot( $p->get_id() ); $preview = $this->data( $this->preview_for_ids( array( $p->get_id() ), 10 ) );
		$p->set_regular_price( '99.99' ); $p->save();
		$apply = $this->data( $this->call( 'price-change-apply', array( 'preview_id' => $preview['data']['preview_id'] ) ) );
		$this->assert_true( 0 === $apply['data']['applied_count'] && 1 === count( $apply['data']['conflicts'] ), 'concurrency conflict is skipped and reported' );
	}

	private function test_undo_conflict() {
		$p = $this->product_by_name( 'Weekly Planner Pad' ); $this->snapshot( $p->get_id() ); $preview = $this->data( $this->preview_for_ids( array( $p->get_id() ), 10 ) );
		$apply = $this->data( $this->call( 'price-change-apply', array( 'preview_id' => $preview['data']['preview_id'] ) ) );
		$p = wc_get_product( $p->get_id() ); $p->set_regular_price( '77.77' ); $p->save();
		$undo = $this->data( $this->call( 'price-change-undo', array( 'history_id' => $apply['data']['history_id'] ) ) );
		$this->assert_true( 0 === $undo['data']['restored_count'] && 1 === count( $undo['data']['conflicts'] ), 'undo reports a conflict if price was edited after apply' );
	}

	private function test_guardrails() {
		$p = $this->product_by_name( 'Desk Sticky Notes' ); $this->snapshot( $p->get_id() );
		$this->call( 'guardrails-update', array( 'min_price' => 10, 'max_discount_percent' => 20 ) );
		$preview = $this->data( $this->preview_for_ids( array( $p->get_id() ), 50 ) );
		$this->assert_true( 0 === $preview['data']['count'] && ! empty( $preview['data']['skipped'] ), 'guardrails are enforced during preview' );
	}

	private function test_variations() {
		$variable = $this->product_by_name( 'Signature Hoodie' ); $ids = $variable->get_children(); foreach ( $ids as $id ) { $this->snapshot( $id ); }
		$preview = $this->data( $this->call( 'price-change-preview', array( 'target' => array( 'product_ids' => array( $variable->get_id() ) ), 'change_type' => 'percent_decrease', 'amount' => 5, 'price_field' => 'regular' ) ) );
		$this->assert_true( count( $ids ) === $preview['data']['count'], 'variations are handled by preview' );
	}

	private function test_category_mugs() {
		$preview = $this->data( $this->call( 'price-change-preview', array( 'target' => array( 'category' => 'mugs' ), 'change_type' => 'percent_decrease', 'amount' => 5, 'price_field' => 'regular' ) ) );
		$this->assert_true( 5 === $preview['data']['count'], 'category target mugs returns exactly the 5 mug products' );
	}

	private function test_mugs_sale_until_sunday_timezone() {
		update_option( 'timezone_string', 'Europe/Dublin', false );
		$ids = wc_get_products( array( 'category' => array( 'mugs' ), 'limit' => -1, 'return' => 'ids' ) );
		foreach ( $ids as $id ) { $this->snapshot( $id ); }
		$today = new DateTimeImmutable( 'now', wp_timezone() );
		$sunday = 'Sunday' === $today->format( 'l' ) ? $today : $today->modify( 'next sunday' );
		$date = $sunday->format( 'Y-m-d' );
		$expected_ts = $sunday->setTime( 23, 59, 59 )->getTimestamp();
		$preview = $this->data( $this->call( 'price-change-preview', array( 'target' => array( 'category' => 'mugs' ), 'change_type' => 'percent_decrease', 'amount' => 15, 'price_field' => 'sale', 'sale_end_date' => $date ) ) );
		$this->assert_true( 5 === $preview['data']['count'] && 'sale' === $preview['data']['changes'][0]['field'], 'mugs until Sunday previews 5 sale prices' );
		$this->assert_true( $expected_ts === $preview['data']['changes'][0]['sale_end_timestamp'], 'sale end uses Sunday 23:59:59 in store timezone' );
		$apply = $this->data( $this->call( 'price-change-apply', array( 'preview_id' => $preview['data']['preview_id'] ) ) );
		$p = wc_get_product( (int) $ids[0] );
		$this->assert_true( $expected_ts === $p->get_date_on_sale_to()->getTimestamp(), 'applied sale end is Sunday 23:59:59 store time' );
		$this->call( 'price-change-undo', array( 'history_id' => $apply['data']['history_id'] ) );
	}

	private function test_seeded_timezone() {
		$this->assert_true( 'Europe/Dublin' === wp_timezone_string(), 'seeded store timezone is Europe/Dublin' );
	}

	private function test_sale_apply_and_undo_rows_include_regular() {
		$p = $this->product_by_name( 'Cedar Amber Candle' ); $this->snapshot( $p->get_id() );
		$regular = (float) $p->get_regular_price();
		$p->set_sale_price( '' ); $p->set_date_on_sale_from( null ); $p->set_date_on_sale_to( null ); $p->save();
		$date = ( new DateTimeImmutable( '+2 days', wp_timezone() ) )->format( 'Y-m-d' );
		$preview = $this->data( $this->call( 'price-change-preview', array( 'target' => array( 'product_ids' => array( $p->get_id() ) ), 'change_type' => 'percent_decrease', 'amount' => 10, 'price_field' => 'sale', 'sale_end_date' => $date ) ) );
		$apply = $this->data( $this->call( 'price-change-apply', array( 'preview_id' => $preview['data']['preview_id'] ) ) );
		$this->assert_true( isset( $apply['data']['applied'][0]['regular'] ) && abs( (float) $apply['data']['applied'][0]['regular'] - $regular ) < 0.001 && null === $apply['data']['applied'][0]['old'], 'applied sale rows include regular when prior sale is empty' );
		$undo = $this->data( $this->call( 'price-change-undo', array( 'history_id' => $apply['data']['history_id'] ) ) );
		$p = wc_get_product( $p->get_id() );
		$this->assert_true( isset( $undo['data']['restored'][0]['regular'] ) && abs( (float) $undo['data']['restored'][0]['regular'] - $regular ) < 0.001 && '' === $p->get_sale_price(), 'undo rows include regular and restore empty sale price' );
	}

	private function test_voice_safe_speech_and_preview_pruning() {
		$old = time() - 1000; $future = time() + 1000; $fake = array();
		for ( $i = 0; $i < 60; $i++ ) { $fake[ 'pkeep' . $i ] = array( 'id' => 'pkeep' . $i, 'user_id' => $this->manager_id(), 'created_at' => $future - $i, 'expires_at' => $future + 1000, 'used' => false, 'changes' => array() ); }
		$fake['pused'] = array( 'id' => 'pused', 'user_id' => $this->manager_id(), 'created_at' => $future, 'expires_at' => $future + 1000, 'used' => true );
		$fake['pexpired'] = array( 'id' => 'pexpired', 'user_id' => $this->manager_id(), 'created_at' => $old, 'expires_at' => $old, 'used' => false );
		update_option( Tillwise_Store_Agent::PREVIEWS_OPTION, $fake, false );
		$p = $this->product_by_name( 'Cedar Amber Candle' ); $this->snapshot( $p->get_id() );
		$preview = $this->data( $this->preview_for_ids( array( $p->get_id() ), 5 ) );
		$this->assert_voice_safe( $preview['speech'], 'preview speech contains no HTML entity and no id' );
		$stored = get_option( Tillwise_Store_Agent::PREVIEWS_OPTION, array() );
		$this->assert_true( count( $stored ) <= Tillwise_Store_Agent::MAX_PREVIEWS && ! isset( $stored['pused'] ) && ! isset( $stored['pexpired'] ), 'preview writes prune used and expired previews and cap total' );
	}

	private function test_sale_end_date_undo() {
		$p = $this->product_by_name( 'Lavender Night Candle' ); $this->snapshot( $p->get_id() );
		$p->set_sale_price( '18.00' ); $p->set_date_on_sale_from( strtotime( '-1 day' ) ); $p->set_date_on_sale_to( strtotime( '+5 days' ) ); $p->save();
		$old_from = $p->get_date_on_sale_from()->getTimestamp(); $old_to = $p->get_date_on_sale_to()->getTimestamp();
		$preview = $this->data( $this->call( 'price-change-preview', array( 'target' => array( 'product_ids' => array( $p->get_id() ) ), 'change_type' => 'percent_decrease', 'amount' => 20, 'price_field' => 'sale', 'sale_end_date' => gmdate( 'Y-m-d', strtotime( '+2 days' ) ) ) ) );
		$apply = $this->data( $this->call( 'price-change-apply', array( 'preview_id' => $preview['data']['preview_id'] ) ) );
		$this->call( 'price-change-undo', array( 'history_id' => $apply['data']['history_id'] ) );
		$p = wc_get_product( $p->get_id() );
		$this->assert_true( $old_from === $p->get_date_on_sale_from()->getTimestamp() && $old_to === $p->get_date_on_sale_to()->getTimestamp(), 'undo restores sale start and end dates' );
	}

	private function test_sales_summary() {
		$response = $this->data( $this->call( 'sales-summary', array( 'period' => 'today' ) ) );
		$range = $response['data']['range'];
		$orders = wc_get_orders( array( 'limit' => -1, 'status' => array( 'wc-processing', 'wc-completed', 'wc-on-hold' ), 'date_created' => $range['start'] . '...' . $range['end'], 'return' => 'objects' ) );
		$total = 0.0; foreach ( $orders as $order ) { $total += (float) $order->get_total(); }
		$this->assert_true( abs( $response['data']['total'] - round( $total, 2 ) ) < 0.001 && $response['data']['order_count'] === count( $orders ), 'sales-summary equals independent timestamp computation' );
	}

	private function test_sales_summary_timezone() {
		update_option( 'timezone_string', 'Europe/Dublin', false );
		$response = $this->data( $this->call( 'sales-summary', array( 'period' => 'today' ) ) );
		$range = $response['data']['range'];
		$orders = wc_get_orders( array( 'limit' => -1, 'status' => array( 'wc-processing', 'wc-completed', 'wc-on-hold' ), 'date_created' => $range['start'] . '...' . $range['end'], 'return' => 'objects' ) );
		$total = 0.0; foreach ( $orders as $order ) { $total += (float) $order->get_total(); }
		$this->assert_true( abs( $response['data']['total'] - round( $total, 2 ) ) < 0.001 && 'Europe/Dublin' === get_option( 'timezone_string' ), 'sales-summary uses timestamp ranges with Europe/Dublin timezone' );
	}

	private function test_demo_reset_briefing_data() {
		$briefing = $this->data( $this->call( 'store-briefing' ) );
		$data     = $briefing['data'];
		$this->assert_true( (float) $data['today']['total'] > 0, 'demo reset creates non-zero sales today' );
		$this->assert_true( (float) $data['today']['total'] > (float) $data['same_weekday_last_week']['total'], 'demo reset sales are up versus same weekday last week' );
		$this->assert_true( 6 === (int) $data['waiting_orders'], 'demo reset creates exactly 6 processing orders waiting' );
		$this->assert_true( 1 === count( $data['sales_ending_soon'] ), 'demo reset creates exactly one sale ending soon' );
	}

	private function test_paypal_audit_and_order_links() {
		$orders = wc_get_orders( array( 'limit' => 1, 'orderby' => 'date', 'order' => 'DESC', 'return' => 'objects', 'status' => array_keys( wc_get_order_statuses() ) ) );
		$this->assert_true( ! empty( $orders ), 'paypal audit test has a seeded Woo order' );
		$order_id = $orders[0]->get_id();
		$seed = $this->data( $this->call( 'paypal-seed-demo' ) );
		$this->assert_true( 0 === strpos( $seed['data']['paypal_capture_id'], 'MOCKCAPTURE' ), 'paypal-seed-demo attaches mock capture id' );
		$context = $this->data( $this->call( 'paypal-order-context', array( 'order_id' => $order_id ) ) );
		$this->assert_true( $seed['data']['paypal_capture_id'] === $context['data']['paypal']['paypal_capture_id'], 'paypal-order-context returns stored mock capture id' );
		$audit = $this->data( $this->call( 'paypal-audit-record', array( 'woo_order_id' => $order_id, 'tool' => 'paypal_refund_apply', 'paypal_object_id' => 'MOCK-REFUND-1', 'paypal_refund_id' => 'MOCK-REFUND-1', 'amount' => 12.34, 'currency' => 'EUR', 'idempotency_key' => 'idem-1', 'status' => 'COMPLETED', 'summary' => 'Refunded test order' ) ) );
		$this->assert_true( 'MOCK-REFUND-1' === $audit['data']['audit']['paypal_object_id'], 'paypal-audit-record stores PayPal object id' );
		$list = $this->data( $this->call( 'paypal-audit-list' ) );
		$this->assert_true( $list['data']['count'] > 0 && 'MOCK-REFUND-1' === $list['data']['audit'][0]['paypal_object_id'], 'paypal-audit-list returns newest PayPal audit row first' );
		$context2 = $this->data( $this->call( 'paypal-order-context', array( 'order_id' => $order_id ) ) );
		$this->assert_true( in_array( 'MOCK-REFUND-1', $context2['data']['paypal']['paypal_refund_ids'], true ), 'paypal audit links refund id back to Woo order meta' );
	}

	private function test_low_stock() {
		$response = $this->data( $this->call( 'low-stock' ) );
		$expected = 0; foreach ( wc_get_products( array( 'limit' => -1, 'type' => array( 'simple', 'variation' ), 'return' => 'objects' ) ) as $product ) { if ( $product->managing_stock() ) { $threshold = '' !== $product->get_low_stock_amount() ? (int) $product->get_low_stock_amount() : (int) get_option( 'woocommerce_notify_low_stock_amount', 2 ); $qty = $product->get_stock_quantity(); if ( null !== $qty && $qty <= $threshold ) { $expected++; } } }
		$this->assert_true( $expected === $response['data']['count'], 'low-stock is correct' );
	}

	private function test_low_stock_names_unique() {
		$response = $this->data( $this->call( 'low-stock' ) );
		$names = wp_list_pluck( $response['data']['items'], 'name' );
		$this->assert_true( count( $names ) === count( array_unique( $names ) ), 'low-stock variation names are unique' );
	}

	private function test_seeded_hoodie_variations() {
		$hoodie = $this->product_by_name( 'Signature Hoodie' );
		$children = $hoodie ? $hoodie->get_children() : array();
		$sizes = array();
		foreach ( $children as $child_id ) {
			$child = wc_get_product( $child_id );
			if ( $child ) { $sizes[] = $child->get_attribute( 'size' ); }
		}
		sort( $sizes );
		$this->assert_true( 2 === count( $children ) && array( 'Large', 'Small' ) === $sizes, 'seeded hoodie has exactly two idempotent size variations' );
	}
}

( new Tillwise_Test_Runner() )->run();
