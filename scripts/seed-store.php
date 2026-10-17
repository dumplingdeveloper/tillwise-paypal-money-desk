<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

$user = get_user_by( 'login', 'shopmanager' );
if ( ! $user ) {
	$user_id = wp_create_user( 'shopmanager', 'shopmanager-pass', 'shopmanager@example.test' );
	$user = get_user_by( 'id', $user_id );
}
$user->set_role( 'shop_manager' );

foreach ( WP_Application_Passwords::get_user_application_passwords( $user->ID ) as $item ) {
	if ( 'Tillwise MCP Server' === $item['name'] && ! empty( $item['uuid'] ) ) {
		WP_Application_Passwords::delete_application_password( $user->ID, $item['uuid'] );
	}
}
$created = WP_Application_Passwords::create_new_application_password( $user->ID, array( 'name' => 'Tillwise MCP Server' ) );
$password = $created[0];
$env = "WP_BASE_URL=http://127.0.0.1:8098
WP_USERNAME=shopmanager
WP_APPLICATION_PASSWORD=" . $password . "
MCP_HOST=127.0.0.1
MCP_PORT=3338
MCP_AUTH_TOKEN=
";
@unlink( ABSPATH . '.env' );
echo "TILLWISE_ENV_BEGIN
" . $env . "TILLWISE_ENV_END
";

update_option( 'woocommerce_currency', 'EUR' );
update_option( 'woocommerce_notify_low_stock_amount', 3 );
update_option( 'timezone_string', 'Europe/Dublin' );

$categories = array( 'Mugs', 'Candles', 'Stationery', 'Gift Boxes' );
$term_ids = array();
foreach ( $categories as $cat ) {
	$term = term_exists( $cat, 'product_cat' );
	if ( ! $term ) { $term = wp_insert_term( $cat, 'product_cat' ); }
	$term_ids[ $cat ] = (int) ( is_array( $term ) ? $term['term_id'] : $term );
}

function tillwise_find_product_post_by_title( $title ) {
	$posts = get_posts( array( 'post_type' => 'product', 'title' => $title, 'post_status' => 'any', 'numberposts' => 1, 'fields' => 'ids' ) );
	return $posts ? (int) $posts[0] : 0;
}

function tillwise_seed_product( $name, $cat, $price, $stock, $term_ids, $low = 3 ) {
	$existing_id = tillwise_find_product_post_by_title( $name );
	$product = $existing_id ? wc_get_product( $existing_id ) : new WC_Product_Simple();
	$product->set_name( $name );
	$product->set_status( 'publish' );
	$product->set_regular_price( (string) $price );
	$product->set_manage_stock( true );
	$product->set_stock_quantity( $stock );
	$product->set_low_stock_amount( $low );
	$product->set_category_ids( array( $term_ids[ $cat ] ) );
	$product->save();
	return $product->get_id();
}

$products = array(
	array( 'Ceramic Sunrise Mug', 'Mugs', 14.90, 12 ), array( 'Midnight Espresso Mug', 'Mugs', 16.50, 2 ), array( 'Tall Latte Mug', 'Mugs', 18.00, 7 ), array( 'Travel Cork Mug', 'Mugs', 24.00, 4 ), array( 'Stoneware Tea Mug', 'Mugs', 15.50, 1 ),
	array( 'Cedar Amber Candle', 'Candles', 22.00, 8 ), array( 'Citrus Grove Candle', 'Candles', 19.50, 2 ), array( 'Lavender Night Candle', 'Candles', 21.00, 10 ), array( 'Vanilla Bean Candle', 'Candles', 18.50, 3 ), array( 'Winter Pine Candle', 'Candles', 23.00, 6 ),
	array( 'Weekly Planner Pad', 'Stationery', 9.90, 25 ), array( 'Recycled Notebook', 'Stationery', 12.50, 2 ), array( 'Brush Pen Set', 'Stationery', 17.90, 9 ), array( 'Desk Sticky Notes', 'Stationery', 6.50, 16 ), array( 'Greeting Card Bundle', 'Stationery', 11.00, 5 ),
	array( 'Coffee Lover Gift Box', 'Gift Boxes', 39.00, 4 ), array( 'Relax Evening Gift Box', 'Gift Boxes', 45.00, 1 ), array( 'Desk Refresh Gift Box', 'Gift Boxes', 34.00, 6 ), array( 'Birthday Mini Gift Box', 'Gift Boxes', 29.00, 8 ), array( 'Thank You Gift Box', 'Gift Boxes', 31.00, 2 ),
);
$product_ids = array();
foreach ( $products as $row ) { $product_ids[] = tillwise_seed_product( $row[0], $row[1], $row[2], $row[3], $term_ids ); }

$variable_name = 'Signature Hoodie';
$existing_id = tillwise_find_product_post_by_title( $variable_name );
$variable = $existing_id ? wc_get_product( $existing_id ) : new WC_Product_Variable();
$variable->set_name( $variable_name );
$variable->set_status( 'publish' );
$variable->set_category_ids( array( $term_ids['Gift Boxes'] ) );
$attribute = new WC_Product_Attribute();
$attribute->set_name( 'size' );
$attribute->set_options( array( 'Small', 'Large' ) );
$attribute->set_visible( true );
$attribute->set_variation( true );
$variable->set_attributes( array( $attribute ) );
$variable_id = $variable->save();

$desired_sizes = array( 'Small', 'Large' );
$children_by_size = array();
foreach ( $variable->get_children() as $child_id ) {
	$child = wc_get_product( $child_id );
	if ( ! $child ) { continue; }
	$size = $child->get_attribute( 'size' );
	if ( ! in_array( $size, $desired_sizes, true ) || isset( $children_by_size[ $size ] ) ) {
		wp_delete_post( $child_id, true );
		continue;
	}
	$children_by_size[ $size ] = $child;
}

foreach ( array( 'Small' => 49.00, 'Large' => 54.00 ) as $size => $price ) {
	$found = isset( $children_by_size[ $size ] ) ? $children_by_size[ $size ] : null;
	$variation = $found ?: new WC_Product_Variation();
	$variation->set_parent_id( $variable_id );
	$variation->set_name( $variable_name . ' - ' . $size );
	$variation->set_attributes( array( 'size' => $size ) );
	$variation->set_regular_price( (string) $price );
	$variation->set_manage_stock( true );
	$variation->set_stock_quantity( 'Small' === $size ? 3 : 9 );
	$variation->set_low_stock_amount( 3 );
	$variation->save();
	$product_ids[] = $variation->get_id();
}
WC_Product_Variable::sync( $variable_id );

if ( wc_get_orders( array( 'limit' => 1, 'meta_key' => '_tillwise_seed_order', 'meta_value' => '1', 'return' => 'ids' ) ) ) {
	echo "Demo products and orders already exist.\n";
	return;
}
$statuses = array( 'completed', 'processing', 'on-hold', 'pending' );
for ( $i = 0; $i < 40; $i++ ) {
	$order = wc_create_order();
	$count = 1 + ( $i % 3 );
	for ( $j = 0; $j < $count; $j++ ) {
		$product = wc_get_product( $product_ids[ ( $i + $j * 3 ) % count( $product_ids ) ] );
		if ( $product ) { $order->add_product( $product, 1 + ( ( $i + $j ) % 2 ) ); }
	}
	$order->set_status( $statuses[ $i % count( $statuses ) ] );
	$date = new WC_DateTime( gmdate( 'Y-m-d H:i:s', strtotime( '-' . ( $i % 14 ) . ' days -' . ( $i % 8 ) . ' hours' ) ) );
	$order->set_date_created( $date );
	$order->update_meta_data( '_tillwise_seed_order', '1' );
	$order->calculate_totals();
	$order->save();
}
echo "Seeded Tillwise demo store.\n";
