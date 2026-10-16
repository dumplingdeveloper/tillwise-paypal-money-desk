<?php
/**
 * Main Tillwise Store Agent implementation.
 *
 * @package Tillwise_Store_Agent
 */

defined( 'ABSPATH' ) || exit;

/**
 * Registers WordPress abilities and implements safe store actions.
 */
class Tillwise_Store_Agent {
	const PREVIEWS_OPTION   = 'tillwise_store_agent_previews';
	const HISTORY_OPTION    = 'tillwise_store_agent_history';
	const GUARDRAILS_OPTION = 'tillwise_store_agent_guardrails';
	const PREVIEW_TTL       = 900;
	const MAX_HISTORY       = 50;
	const MAX_PREVIEWS      = 50;

	/** Bootstrap hooks. */
	public static function bootstrap() {
		if ( ! class_exists( 'WooCommerce' ) ) {
			add_action( 'admin_notices', array( __CLASS__, 'missing_woocommerce_notice' ) );
			return;
		}

		add_action( 'wp_abilities_api_categories_init', array( __CLASS__, 'register_ability_category' ) );
		add_action( 'wp_abilities_api_init', array( __CLASS__, 'register_abilities' ) );
	}

	/** Admin notice for missing WooCommerce. */
	public static function missing_woocommerce_notice() {
		if ( current_user_can( 'activate_plugins' ) ) {
			printf( '<div class="notice notice-warning"><p>%s</p></div>', esc_html__( 'Tillwise Store Agent needs WooCommerce to be active.', 'tillwise-store-agent' ) );
		}
	}

	/** Register the Tillwise ability category. */
	public static function register_ability_category() {
		wp_register_ability_category(
			'tillwise-store',
			array(
				'label'       => __( 'Tillwise Store', 'tillwise-store-agent' ),
				'description' => __( 'Safe WooCommerce operations for store-owner agents.', 'tillwise-store-agent' ),
			)
		);
	}

	/** Register abilities using the WordPress Abilities API. */
	public static function register_abilities() {
		foreach ( self::ability_definitions() as $name => $definition ) {
			wp_register_ability(
				'tillwise-store/' . $name,
				array(
					'label'               => $definition['label'],
					'description'         => $definition['description'],
					'category'            => 'tillwise-store',
					'input_schema'        => $definition['input_schema'],
					'output_schema'       => self::output_schema(),
					'execute_callback'    => function ( $input = null ) use ( $name ) {
						return self::dispatch( $name, is_array( $input ) ? $input : array() );
					},
					'permission_callback' => array( __CLASS__, 'permission_callback' ),
					'meta'                => array(
						'public'       => true,
						'show_in_rest' => true,
						'annotations'  => $definition['annotations'],
					),
				)
			);
		}
	}

	/** Permission callback. */
	public static function permission_callback() {
		return current_user_can( 'manage_woocommerce' );
	}

	/** Ability definitions. */
	public static function ability_definitions() {
		$object_input_schema = array( 'type' => 'object', 'default' => array() );
		$target_schema = array(
			'type'       => 'object',
			'properties' => array(
				'category'    => array( 'type' => 'string' ),
				'search'      => array( 'type' => 'string' ),
				'product_ids' => array( 'type' => 'array', 'items' => array( 'type' => 'integer' ) ),
				'limit'       => array( 'type' => 'integer' ),
			),
		);
		$change_schema = array(
			'type'       => 'object',
			'properties' => array(
				'target'         => $target_schema,
				'change_type'    => array( 'type' => 'string', 'enum' => array( 'percent_decrease', 'percent_increase', 'fixed_decrease', 'fixed_increase', 'set_price' ) ),
				'amount'         => array( 'type' => 'number' ),
				'price_field'    => array( 'type' => 'string', 'enum' => array( 'regular', 'sale' ) ),
				'sale_end_date'  => array( 'type' => 'string', 'format' => 'date', 'pattern' => '^\\d{4}-\\d{2}-\\d{2}$' ),
				'rounding'       => array( 'type' => 'string' ),
			),
			'required'   => array( 'target', 'change_type', 'amount' ),
		);
		return array(
			'store-briefing'       => array( 'label' => 'Store briefing', 'description' => 'Daily briefing across sales, orders, stock, and ending sales.', 'input_schema' => $object_input_schema, 'annotations' => array( 'readonly' => true, 'destructive' => false, 'idempotent' => true ) ),
			'sales-summary'        => array( 'label' => 'Sales summary', 'description' => 'Summarize sales for a requested period.', 'input_schema' => array( 'type' => 'object', 'default' => array(), 'properties' => array( 'period' => array( 'type' => 'string', 'enum' => array( 'today', 'yesterday', 'last_7_days', 'this_month' ) ) ) ), 'annotations' => array( 'readonly' => true, 'destructive' => false, 'idempotent' => true ) ),
			'low-stock'            => array( 'label' => 'Low stock', 'description' => 'List products at or below their low-stock threshold.', 'input_schema' => $object_input_schema, 'annotations' => array( 'readonly' => true, 'destructive' => false, 'idempotent' => true ) ),
			'price-change-preview' => array( 'label' => 'Price change preview', 'description' => 'Create a guarded server-side price change preview.', 'input_schema' => $change_schema, 'annotations' => array( 'readonly' => true, 'destructive' => false, 'idempotent' => false ) ),
			'price-change-apply'   => array( 'label' => 'Apply price change', 'description' => 'Apply exactly a previously created preview.', 'input_schema' => array( 'type' => 'object', 'properties' => array( 'preview_id' => array( 'type' => 'string' ) ), 'required' => array( 'preview_id' ) ), 'annotations' => array( 'readonly' => false, 'destructive' => true, 'idempotent' => false ) ),
			'price-change-undo'    => array( 'label' => 'Undo price change', 'description' => 'Undo an applied batch from persistent history.', 'input_schema' => array( 'type' => 'object', 'properties' => array( 'history_id' => array( 'type' => 'string' ) ), 'required' => array( 'history_id' ) ), 'annotations' => array( 'readonly' => false, 'destructive' => true, 'idempotent' => false ) ),
			'price-change-history' => array( 'label' => 'Price change history', 'description' => 'Read applied price change history.', 'input_schema' => $object_input_schema, 'annotations' => array( 'readonly' => true, 'destructive' => false, 'idempotent' => true ) ),
			'guardrails-get'       => array( 'label' => 'Get guardrails', 'description' => 'Read persistent owner price-change guardrails.', 'input_schema' => $object_input_schema, 'annotations' => array( 'readonly' => true, 'destructive' => false, 'idempotent' => true ) ),
			'guardrails-update'    => array( 'label' => 'Update guardrails', 'description' => 'Update persistent owner price-change guardrails.', 'input_schema' => array( 'type' => 'object', 'properties' => array( 'min_price' => array( 'type' => 'number', 'minimum' => 0 ), 'max_discount_percent' => array( 'type' => 'number', 'minimum' => 0, 'maximum' => 100 ), 'max_items_per_preview' => array( 'type' => 'integer', 'minimum' => 1, 'maximum' => 500 ), 'allow_regular_price_increase' => array( 'type' => 'boolean' ) ) ), 'annotations' => array( 'readonly' => false, 'destructive' => false, 'idempotent' => true ) ),
		);
	}

	/** Output schema shared by abilities. */
	protected static function output_schema() {
		return array( 'type' => 'object', 'required' => array( 'speech', 'data' ), 'properties' => array( 'speech' => array( 'type' => 'string' ), 'data' => array( 'type' => 'object' ) ) );
	}

	/** Dispatch ability. */
	protected static function dispatch( $ability, array $input ) {
		switch ( $ability ) {
			case 'store-briefing': return self::store_briefing();
			case 'sales-summary': return self::sales_summary( $input );
			case 'low-stock': return self::low_stock();
			case 'price-change-preview': return self::price_change_preview( $input );
			case 'price-change-apply': return self::price_change_apply( $input );
			case 'price-change-undo': return self::price_change_undo( $input );
			case 'price-change-history': return self::price_change_history();
			case 'guardrails-get': return self::guardrails_get();
			case 'guardrails-update': return self::guardrails_update( $input );
		}
		return new WP_Error( 'tillwise_unknown_ability', __( 'Unknown ability.', 'tillwise-store-agent' ), array( 'status' => 404 ) );
	}

	/** Default guardrails. */
	protected static function default_guardrails() {
		return array( 'min_price' => 1.00, 'max_discount_percent' => 50.0, 'max_items_per_preview' => 100, 'allow_regular_price_increase' => true );
	}

	/** Get guardrails. */
	protected static function guardrails() {
		$stored = get_option( self::GUARDRAILS_OPTION, array() );
		return array_merge( self::default_guardrails(), is_array( $stored ) ? $stored : array() );
	}

	/** Format money for voice without HTML entities. */
	protected static function spoken_money( $amount ) {
		return html_entity_decode( wp_strip_all_tags( wc_price( $amount ) ), ENT_QUOTES, get_bloginfo( 'charset' ) );
	}

	/** Guardrails response. */
	protected static function guardrails_get() {
		$guardrails = self::guardrails();
		return array( 'speech' => 'Guardrails are active. Minimum price is ' . self::spoken_money( $guardrails['min_price'] ) . ' and maximum discount is ' . (float) $guardrails['max_discount_percent'] . ' percent.', 'data' => array( 'guardrails' => $guardrails ) );
	}

	/** Update guardrails. */
	protected static function guardrails_update( array $input ) {
		$current = self::guardrails();
		$next    = $current;
		foreach ( array( 'min_price', 'max_discount_percent' ) as $key ) {
			if ( isset( $input[ $key ] ) ) {
				$next[ $key ] = max( 0, round( (float) $input[ $key ], 2 ) );
			}
		}
		if ( isset( $input['max_items_per_preview'] ) ) {
			$next['max_items_per_preview'] = max( 1, min( 500, (int) $input['max_items_per_preview'] ) );
		}
		if ( isset( $input['allow_regular_price_increase'] ) ) {
			$next['allow_regular_price_increase'] = (bool) $input['allow_regular_price_increase'];
		}
		update_option( self::GUARDRAILS_OPTION, $next, false );
		return array( 'speech' => 'Guardrails updated.', 'data' => array( 'guardrails' => $next, 'previous' => $current ) );
	}

	/** Sales summary. */
	protected static function sales_summary( array $input ) {
		$period = isset( $input['period'] ) ? sanitize_key( $input['period'] ) : 'today';
		$range  = self::date_range_for_period( $period );
		$orders = wc_get_orders( array( 'limit' => -1, 'status' => array( 'wc-processing', 'wc-completed', 'wc-on-hold' ), 'date_created' => $range['start'] . '...' . $range['end'], 'return' => 'objects' ) );
		$total = 0.0; $items = 0; $products = array();
		foreach ( $orders as $order ) {
			$total += (float) $order->get_total();
			foreach ( $order->get_items() as $item ) {
				$items += (int) $item->get_quantity();
				$pid = $item->get_variation_id() ? $item->get_variation_id() : $item->get_product_id();
				if ( ! isset( $products[ $pid ] ) ) { $products[ $pid ] = array( 'id' => $pid, 'name' => $item->get_name(), 'quantity' => 0, 'total' => 0.0 ); }
				$products[ $pid ]['quantity'] += (int) $item->get_quantity();
				$products[ $pid ]['total'] += (float) $item->get_total();
			}
		}
		usort( $products, function ( $a, $b ) { return $b['total'] <=> $a['total']; } );
		$top = array_slice( array_values( $products ), 0, 5 );
		$speech = sprintf( 'Sales for %s are %s across %d orders.', str_replace( '_', ' ', $period ), self::spoken_money( $total ), count( $orders ) );
		return array( 'speech' => $speech, 'data' => array( 'period' => $period, 'range' => $range, 'total' => round( $total, 2 ), 'order_count' => count( $orders ), 'items_sold' => $items, 'top_products' => $top ) );
	}

	/** Date range helper. */
	protected static function date_range_for_period( $period ) {
		$tz = wp_timezone(); $now = new DateTimeImmutable( 'now', $tz );
		switch ( $period ) {
			case 'yesterday': $start = $now->modify( 'yesterday' )->setTime( 0, 0, 0 ); $end = $now->modify( 'yesterday' )->setTime( 23, 59, 59 ); break;
			case 'last_7_days': $start = $now->modify( '-6 days' )->setTime( 0, 0, 0 ); $end = $now->setTime( 23, 59, 59 ); break;
			case 'this_month': $start = $now->modify( 'first day of this month' )->setTime( 0, 0, 0 ); $end = $now->setTime( 23, 59, 59 ); break;
			case 'today': default: $start = $now->setTime( 0, 0, 0 ); $end = $now->setTime( 23, 59, 59 ); break;
		}
		return array( 'start' => $start->getTimestamp(), 'end' => $end->getTimestamp(), 'after' => $start->format( 'Y-m-d H:i:s' ), 'before' => $end->format( 'Y-m-d H:i:s' ) );
	}

	/** Low-stock products. */
	protected static function low_stock() {
		$rows = array();
		$products = wc_get_products( array( 'limit' => -1, 'status' => array( 'publish', 'private' ), 'type' => array( 'simple', 'variation' ), 'return' => 'objects' ) );
		foreach ( $products as $product ) {
			if ( ! $product->managing_stock() ) { continue; }
			$threshold = '' !== $product->get_low_stock_amount() ? (int) $product->get_low_stock_amount() : (int) get_option( 'woocommerce_notify_low_stock_amount', 2 );
			$qty = $product->get_stock_quantity();
			if ( null !== $qty && $qty <= $threshold ) {
				$rows[] = array( 'id' => $product->get_id(), 'name' => self::product_display_name( $product ), 'stock_quantity' => (int) $qty, 'threshold' => $threshold );
			}
		}
		return array( 'speech' => empty( $rows ) ? 'No products are low on stock.' : count( $rows ) . ' products are low on stock.', 'data' => array( 'items' => $rows, 'count' => count( $rows ) ) );
	}

	/** Store briefing. */
	protected static function store_briefing() {
		$today = self::sales_summary( array( 'period' => 'today' ) );
		$low = self::low_stock();
		$waiting = wc_get_orders( array( 'limit' => -1, 'status' => array( 'wc-pending', 'wc-on-hold', 'wc-processing' ), 'return' => 'ids' ) );
		$ending = self::sales_ending_soon();
		$last = self::same_weekday_last_week_sales();
		$delta = round( (float) $today['data']['total'] - (float) $last['total'], 2 );
		$speech = sprintf( 'Today sales are %s, %s versus last week. %d orders are waiting, %d items are low on stock, and %d sales end soon.', self::spoken_money( $today['data']['total'] ), $delta >= 0 ? 'up ' . self::spoken_money( $delta ) : 'down ' . self::spoken_money( abs( $delta ) ), count( $waiting ), $low['data']['count'], count( $ending ) );
		return array( 'speech' => $speech, 'data' => array( 'today' => $today['data'], 'same_weekday_last_week' => $last, 'waiting_orders' => count( $waiting ), 'low_stock' => $low['data'], 'sales_ending_soon' => $ending, 'store_today' => wp_date( 'Y-m-d' ), 'store_weekday' => wp_date( 'l' ), 'timezone' => wp_timezone_string(), 'currency' => get_woocommerce_currency() ) );
	}

	/** Same weekday last week sales. */
	protected static function same_weekday_last_week_sales() {
		$tz = wp_timezone(); $start = ( new DateTimeImmutable( '-7 days', $tz ) )->setTime( 0, 0, 0 ); $end = $start->setTime( 23, 59, 59 );
		$orders = wc_get_orders( array( 'limit' => -1, 'status' => array( 'wc-processing', 'wc-completed', 'wc-on-hold' ), 'date_created' => $start->getTimestamp() . '...' . $end->getTimestamp(), 'return' => 'objects' ) );
		$total = 0.0; foreach ( $orders as $order ) { $total += (float) $order->get_total(); }
		return array( 'total' => round( $total, 2 ), 'order_count' => count( $orders ), 'date' => $start->format( 'Y-m-d' ) );
	}

	/** Sale end dates within three days. */
	protected static function sales_ending_soon() {
		$rows = array(); $now = time(); $soon = $now + 3 * DAY_IN_SECONDS;
		foreach ( wc_get_products( array( 'limit' => -1, 'status' => array( 'publish', 'private' ), 'type' => array( 'simple', 'variation' ), 'return' => 'objects' ) ) as $product ) {
			$to = $product->get_date_on_sale_to();
			if ( $to && $to->getTimestamp() >= $now && $to->getTimestamp() <= $soon ) { $rows[] = array( 'id' => $product->get_id(), 'name' => self::product_display_name( $product ), 'sale_ends' => $to->date( 'Y-m-d' ) ); }
		}
		return $rows;
	}

	/** Preview price change. */
	protected static function price_change_preview( array $input ) {
		$guardrails = self::guardrails();
		$products = self::select_products( isset( $input['target'] ) && is_array( $input['target'] ) ? $input['target'] : array(), (int) $guardrails['max_items_per_preview'] );
		$change_type = isset( $input['change_type'] ) ? sanitize_key( $input['change_type'] ) : 'percent_decrease';
		$amount = isset( $input['amount'] ) ? (float) $input['amount'] : 0.0;
		$field = isset( $input['price_field'] ) && 'sale' === $input['price_field'] ? 'sale' : 'regular';
		$sale_end = isset( $input['sale_end_date'] ) ? sanitize_text_field( $input['sale_end_date'] ) : '';
		$sale_end_timestamp = null;
		if ( '' !== $sale_end ) {
			if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $sale_end ) ) { return new WP_Error( 'tillwise_invalid_sale_end_date', __( 'Sale end date must use YYYY-MM-DD.', 'tillwise-store-agent' ), array( 'status' => 400 ) ); }
			try { $sale_end_dt = new DateTimeImmutable( $sale_end . ' 23:59:59', wp_timezone() ); } catch ( Exception $e ) { return new WP_Error( 'tillwise_invalid_sale_end_date', __( 'Sale end date is invalid.', 'tillwise-store-agent' ), array( 'status' => 400 ) ); }
			$today_start = ( new DateTimeImmutable( 'now', wp_timezone() ) )->setTime( 0, 0, 0 );
			if ( $sale_end_dt < $today_start ) { return new WP_Error( 'tillwise_past_sale_end_date', __( 'Sale end date cannot be in the past.', 'tillwise-store-agent' ), array( 'status' => 400 ) ); }
			$sale_end_timestamp = $sale_end_dt->getTimestamp();
		}
		$rounding = isset( $input['rounding'] ) ? sanitize_key( $input['rounding'] ) : 'decimals';
		$rows = array(); $skipped = array();
		foreach ( $products as $product ) {
			$display_name = self::product_display_name( $product );
			$skip = function ( $reason ) use ( &$skipped, $product, $display_name, $guardrails ) {
				$skipped[] = array( 'id' => $product->get_id(), 'name' => $display_name, 'reason' => $reason, 'max_discount_percent' => (float) $guardrails['max_discount_percent'], 'min_price' => (float) $guardrails['min_price'] );
			};
			$field_price = self::price_to_number( 'sale' === $field ? $product->get_sale_price() : $product->get_regular_price() );
			$base = self::price_to_number( $product->get_regular_price() );
			$old = ( 'sale' === $field && null === $field_price ) ? $base : $field_price;
			if ( null === $old && 'set_price' !== $change_type ) { $skip( 'missing_price' ); continue; }
			if ( null === $base ) { $base = $old; }
			$new = self::calculate_price( $old, $base, $change_type, $amount, $rounding );
			if ( 'regular' === $field && ! $guardrails['allow_regular_price_increase'] && $new > $old ) { $skip( 'increase_blocked' ); continue; }
			$discount = $base > 0 ? ( ( $base - $new ) / $base ) * 100 : 0;
			if ( $discount > (float) $guardrails['max_discount_percent'] ) { $skip( 'max_discount_exceeded' ); continue; }
			if ( $new < (float) $guardrails['min_price'] ) { $skip( 'min_price' ); continue; }
			if ( 'sale' === $field && $new >= $base ) { $skip( 'sale_not_below_regular' ); continue; }
			if ( null !== $old && abs( $old - $new ) < 0.00001 ) { continue; }
			$rows[] = array( 'id' => $product->get_id(), 'name' => $display_name, 'type' => $product->get_type(), 'field' => $field, 'old' => $old, 'new' => $new, 'regular_at_preview' => $base, 'field_price_at_preview' => $field_price, 'sale_end_date' => $sale_end, 'sale_end_timestamp' => $sale_end_timestamp );
		}
		$preview_id = 'p' . substr( str_replace( '-', '', wp_generate_uuid4() ), 0, 16 );
		$previews = self::prune_previews( self::previews(), self::MAX_PREVIEWS - 1 );
		$previews[ $preview_id ] = array( 'id' => $preview_id, 'user_id' => get_current_user_id(), 'created_at' => time(), 'expires_at' => time() + self::PREVIEW_TTL, 'used' => false, 'input' => $input, 'changes' => $rows, 'skipped' => $skipped );
		update_option( self::PREVIEWS_OPTION, $previews, false );
		$range = self::change_range( $rows );
		$speech = empty( $rows ) ? 'No eligible products matched that change.' : sprintf( 'Preview ready for %d prices, from %s to %s. Would you like me to apply it?', count( $rows ), self::spoken_money( $range['min_new'] ), self::spoken_money( $range['max_new'] ) );
		return array( 'speech' => $speech, 'data' => array( 'preview_id' => $preview_id, 'expires_at' => gmdate( 'c', $previews[ $preview_id ]['expires_at'] ), 'count' => count( $rows ), 'range' => $range, 'examples' => array_slice( $rows, 0, 5 ), 'changes' => $rows, 'skipped' => $skipped, 'guardrails' => $guardrails, 'currency' => get_woocommerce_currency(), 'timezone' => wp_timezone_string() ) );
	}

	/** Apply preview. */
	protected static function price_change_apply( array $input ) {
		$preview_id = isset( $input['preview_id'] ) ? sanitize_text_field( $input['preview_id'] ) : '';
		$previews = self::previews();
		if ( empty( $previews[ $preview_id ] ) ) { return new WP_Error( 'tillwise_preview_not_found', __( 'Preview not found.', 'tillwise-store-agent' ), array( 'status' => 404 ) ); }
		$preview = $previews[ $preview_id ];
		if ( (int) $preview['user_id'] !== get_current_user_id() ) { return new WP_Error( 'tillwise_foreign_preview', __( 'This preview belongs to another user.', 'tillwise-store-agent' ), array( 'status' => 403 ) ); }
		if ( ! empty( $preview['used'] ) ) { return new WP_Error( 'tillwise_preview_used', __( 'This preview has already been used.', 'tillwise-store-agent' ), array( 'status' => 409 ) ); }
		if ( time() > (int) $preview['expires_at'] ) { return new WP_Error( 'tillwise_preview_expired', __( 'This preview has expired.', 'tillwise-store-agent' ), array( 'status' => 410 ) ); }
		$applied = array(); $conflicts = array();
		foreach ( (array) $preview['changes'] as $change ) {
			$product = wc_get_product( (int) $change['id'] );
			if ( ! $product ) { $conflicts[] = array( 'id' => (int) $change['id'], 'reason' => 'missing_product' ); continue; }
			$current = self::price_to_number( 'sale' === $change['field'] ? $product->get_sale_price() : $product->get_regular_price() );
			$expected_current = array_key_exists( 'field_price_at_preview', $change ) ? $change['field_price_at_preview'] : $change['old'];
			if ( ! self::same_price( $current, $expected_current ) ) { $conflicts[] = array( 'id' => $product->get_id(), 'name' => self::product_display_name( $product ), 'field' => $change['field'], 'expected' => $change['old'], 'actual' => $current ); continue; }
			$old_from = $product->get_date_on_sale_from();
			$old_to = $product->get_date_on_sale_to();
			self::write_price( $product, $change['field'], $change['new'], $change['sale_end_date'], null, null, false, isset( $change['sale_end_timestamp'] ) ? $change['sale_end_timestamp'] : null );
			$applied[] = array( 'id' => $product->get_id(), 'name' => self::product_display_name( $product ), 'field' => $change['field'], 'old' => $current, 'regular' => isset( $change['regular_at_preview'] ) ? $change['regular_at_preview'] : self::price_to_number( $product->get_regular_price() ), 'new' => $change['new'], 'sale_end_date' => $change['sale_end_date'], 'sale_end_timestamp' => isset( $change['sale_end_timestamp'] ) ? $change['sale_end_timestamp'] : null, 'old_sale_date_from' => $old_from ? $old_from->getTimestamp() : null, 'old_sale_date_to' => $old_to ? $old_to->getTimestamp() : null );
		}
		$preview['used'] = true; $preview['used_at'] = time(); $previews[ $preview_id ] = $preview; update_option( self::PREVIEWS_OPTION, self::prune_previews( $previews ), false );
		$history_id = null;
		if ( ! empty( $applied ) ) { $history_id = self::record_history( $preview_id, $applied ); }
		$speech = sprintf( 'Applied %d price changes%s.', count( $applied ), empty( $conflicts ) ? '' : ', with ' . count( $conflicts ) . ' conflicts skipped' );
		return array( 'speech' => $speech, 'data' => array( 'history_id' => $history_id, 'applied_count' => count( $applied ), 'applied' => $applied, 'conflicts' => $conflicts, 'currency' => get_woocommerce_currency(), 'timezone' => wp_timezone_string() ) );
	}

	/** Undo. */
	protected static function price_change_undo( array $input ) {
		$history_id = isset( $input['history_id'] ) ? sanitize_text_field( $input['history_id'] ) : '';
		$history = self::history();
		if ( empty( $history[ $history_id ] ) ) { return new WP_Error( 'tillwise_history_not_found', __( 'History item not found.', 'tillwise-store-agent' ), array( 'status' => 404 ) ); }
		$batch = $history[ $history_id ]; $restored = array(); $conflicts = array();
		foreach ( (array) $batch['changes'] as $change ) {
			$product = wc_get_product( (int) $change['id'] );
			if ( ! $product ) { $conflicts[] = array( 'id' => (int) $change['id'], 'reason' => 'missing_product' ); continue; }
			$current = self::price_to_number( 'sale' === $change['field'] ? $product->get_sale_price() : $product->get_regular_price() );
			if ( ! self::same_price( $current, $change['new'] ) ) { $conflicts[] = array( 'id' => $product->get_id(), 'name' => self::product_display_name( $product ), 'field' => $change['field'], 'expected' => $change['new'], 'actual' => $current ); continue; }
			self::write_price( $product, $change['field'], $change['old'], '', isset( $change['old_sale_date_from'] ) ? $change['old_sale_date_from'] : null, isset( $change['old_sale_date_to'] ) ? $change['old_sale_date_to'] : null, true );
			$restored[] = array( 'id' => $product->get_id(), 'name' => self::product_display_name( $product ), 'field' => $change['field'], 'was' => $current, 'regular' => isset( $change['regular'] ) ? $change['regular'] : self::price_to_number( $product->get_regular_price() ), 'restored' => $change['old'], 'restored_sale_end_timestamp' => isset( $change['old_sale_date_to'] ) ? $change['old_sale_date_to'] : null );
		}
		$history[ $history_id ]['undone_at'] = time(); update_option( self::HISTORY_OPTION, $history, false );
		$speech = sprintf( 'Undo restored %d prices%s.', count( $restored ), empty( $conflicts ) ? '' : ', with ' . count( $conflicts ) . ' conflicts' );
		return array( 'speech' => $speech, 'data' => array( 'history_id' => $history_id, 'restored_count' => count( $restored ), 'restored' => $restored, 'conflicts' => $conflicts, 'currency' => get_woocommerce_currency(), 'timezone' => wp_timezone_string() ) );
	}

	/** History response. */
	protected static function price_change_history() {
		$items = array_values( self::history() );
		usort( $items, function ( $a, $b ) { return $b['created_at'] <=> $a['created_at']; } );
		return array( 'speech' => empty( $items ) ? 'There are no price changes in history.' : 'There are ' . count( $items ) . ' price changes in history.', 'data' => array( 'items' => $items, 'currency' => get_woocommerce_currency(), 'timezone' => wp_timezone_string() ) );
	}

	/** Product selection. */
	protected static function select_products( array $target, $limit ) {
		$args = array( 'limit' => max( 1, min( 500, (int) $limit ) ), 'status' => array( 'publish', 'private' ), 'return' => 'objects', 'orderby' => 'ID', 'order' => 'ASC' );
		if ( ! empty( $target['product_ids'] ) && is_array( $target['product_ids'] ) ) { $args['include'] = array_map( 'absint', $target['product_ids'] ); }
		if ( ! empty( $target['search'] ) ) { $args['s'] = sanitize_text_field( $target['search'] ); }
		if ( ! empty( $target['category'] ) ) { $args['category'] = array( sanitize_title( $target['category'] ) ); }
		$parents = wc_get_products( $args ); $out = array();
		foreach ( $parents as $product ) {
			if ( $product->is_type( 'variable' ) ) {
				foreach ( $product->get_children() as $child_id ) { $child = wc_get_product( $child_id ); if ( $child ) { $out[] = $child; } }
			} else { $out[] = $product; }
		}
		return array_slice( $out, 0, (int) $limit );
	}

	/** Calculate new price. */
	protected static function calculate_price( $old, $base, $type, $amount, $rounding ) {
		$value = 'set_price' === $type ? (float) $amount : (float) $old;
		switch ( $type ) {
			case 'percent_decrease': $value = (float) $base * ( 1 - ( (float) $amount / 100 ) ); break;
			case 'percent_increase': $value = (float) $base * ( 1 + ( (float) $amount / 100 ) ); break;
			case 'fixed_decrease': $value = (float) $old - (float) $amount; break;
			case 'fixed_increase': $value = (float) $old + (float) $amount; break;
		}
		if ( 'nearest_99' === $rounding ) { $value = max( 0, ceil( $value - 0.000001 ) - 0.01 ); }
		return round( max( 0, $value ), 2 );
	}

	/** Write a price. */
	protected static function write_price( $product, $field, $value, $sale_end_date, $restore_from = null, $restore_to = null, $restore_sale_dates = false, $sale_end_timestamp = null ) {
		$write = null === $value ? '' : wc_format_decimal( $value );
		if ( 'sale' === $field ) {
			$product->set_sale_price( $write );
			if ( $restore_sale_dates ) {
				$product->set_date_on_sale_from( $restore_from ? (int) $restore_from : null );
				$product->set_date_on_sale_to( $restore_to ? (int) $restore_to : null );
			} elseif ( $sale_end_timestamp ) {
				$product->set_date_on_sale_to( (int) $sale_end_timestamp );
			} elseif ( $sale_end_date ) {
				$product->set_date_on_sale_to( ( new DateTimeImmutable( $sale_end_date . ' 23:59:59', wp_timezone() ) )->getTimestamp() );
			}
		} else {
			$product->set_regular_price( $write );
		}
		$product->save(); wc_delete_product_transients( $product->get_id() );
	}

	/** Record history. */
	protected static function record_history( $preview_id, array $applied ) {
		$history_id = 'h' . substr( str_replace( '-', '', wp_generate_uuid4() ), 0, 16 );
		$history = self::history();
		$history[ $history_id ] = array( 'id' => $history_id, 'preview_id' => $preview_id, 'user_id' => get_current_user_id(), 'created_at' => time(), 'created_at_gmt' => gmdate( 'c' ), 'count' => count( $applied ), 'changes' => $applied );
		if ( count( $history ) > self::MAX_HISTORY ) { uasort( $history, function ( $a, $b ) { return $b['created_at'] <=> $a['created_at']; } ); $history = array_slice( $history, 0, self::MAX_HISTORY, true ); }
		update_option( self::HISTORY_OPTION, $history, false );
		return $history_id;
	}

	/** Remove expired and used previews and cap retained unused previews. */
	protected static function prune_previews( array $previews, $limit = self::MAX_PREVIEWS ) {
		$now = time();
		$kept = array();
		foreach ( $previews as $id => $preview ) {
			if ( ! is_array( $preview ) || ! empty( $preview['used'] ) || ( isset( $preview['expires_at'] ) && (int) $preview['expires_at'] < $now ) ) {
				continue;
			}
			$kept[ $id ] = $preview;
		}
		uasort( $kept, function ( $a, $b ) { return ( $b['created_at'] ?? 0 ) <=> ( $a['created_at'] ?? 0 ); } );
		return array_slice( $kept, 0, (int) $limit, true );
	}

	protected static function previews() { $value = get_option( self::PREVIEWS_OPTION, array() ); return is_array( $value ) ? $value : array(); }
	protected static function history() { $value = get_option( self::HISTORY_OPTION, array() ); return is_array( $value ) ? $value : array(); }
	protected static function price_to_number( $value ) { return '' === $value || null === $value ? null : round( (float) $value, 2 ); }
	protected static function same_price( $a, $b ) { return ( null === $a && null === $b ) || ( null !== $a && null !== $b && abs( (float) $a - (float) $b ) < 0.00001 ); }
	protected static function change_range( array $rows ) { $values = wp_list_pluck( $rows, 'new' ); if ( empty( $values ) ) { return array( 'min_new' => null, 'max_new' => null ); } return array( 'min_new' => min( $values ), 'max_new' => max( $values ) ); }
	protected static function product_display_name( WC_Product $product ) {
		if ( $product->is_type( 'variation' ) ) {
			$variation = wc_get_formatted_variation( $product, true, false, true );
			if ( '' !== $variation ) {
				$parent = wc_get_product( $product->get_parent_id() );
				return ( $parent ? $parent->get_name() : $product->get_name() ) . ' - ' . wp_strip_all_tags( $variation );
			}
		}
		return $product->get_name();
	}
}
