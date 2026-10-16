#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T cli wp eval '
update_option("timezone_string", "Europe/Dublin");
add_filter("pre_wp_mail", "__return_true");
foreach (wc_get_products(array("limit"=>-1,"type"=>array("simple","variation"),"return"=>"objects")) as $p) {
  $name = $p->get_name();
  $prices = array(
    "Ceramic Sunrise Mug"=>14.90,"Midnight Espresso Mug"=>16.50,"Tall Latte Mug"=>18.00,"Travel Cork Mug"=>24.00,"Stoneware Tea Mug"=>15.50,
    "Cedar Amber Candle"=>22.00,"Citrus Grove Candle"=>19.50,"Lavender Night Candle"=>21.00,"Vanilla Bean Candle"=>18.50,"Winter Pine Candle"=>23.00,
    "Weekly Planner Pad"=>9.90,"Recycled Notebook"=>12.50,"Brush Pen Set"=>17.90,"Desk Sticky Notes"=>6.50,"Greeting Card Bundle"=>11.00,
    "Coffee Lover Gift Box"=>39.00,"Relax Evening Gift Box"=>45.00,"Desk Refresh Gift Box"=>34.00,"Birthday Mini Gift Box"=>29.00,"Thank You Gift Box"=>31.00,
    "Signature Hoodie - Small"=>49.00,"Signature Hoodie - Large"=>54.00,"Signature Hoodie"=>49.00
  );
  $key = $name;
  if ($p->is_type("variation")) { $key = "Signature Hoodie - " . $p->get_attribute("size"); }
  if (isset($prices[$key])) { $p->set_regular_price((string)$prices[$key]); }
  $p->set_sale_price(""); $p->set_date_on_sale_from(null); $p->set_date_on_sale_to(null); $p->save();
}
$seed_orders = wc_get_orders(array("limit"=>-1,"meta_key"=>"_tillwise_seed_order","meta_value"=>"1","return"=>"ids","status"=>array_keys(wc_get_order_statuses())));
foreach ($seed_orders as $order_id) { $order = wc_get_order($order_id); if ($order) { $order->delete(true); } }
$products_by_name = array();
foreach (wc_get_products(array("limit"=>-1,"status"=>array("publish","private"),"type"=>array("simple","variation"),"return"=>"objects")) as $product) {
  $name = $product->get_name();
  if ($product->is_type("variation")) { $name = "Signature Hoodie - " . $product->get_attribute("size"); }
  $products_by_name[$name] = $product;
}
$tz = wp_timezone();
$now = new DateTimeImmutable("now", $tz);
$start_today = $now->setTime(0,5,0);
$latest_today = $now->modify("-5 minutes");
$earliest_today = $now->modify("-10 hours");
if ($earliest_today < $start_today) { $earliest_today = $start_today; }
if ($latest_today <= $earliest_today) { $latest_today = $earliest_today->modify("+5 minutes"); }
$today_span = max(1, $latest_today->getTimestamp() - $earliest_today->getTimestamp());
$today_names = array("Coffee Lover Gift Box","Desk Refresh Gift Box","Travel Cork Mug","Cedar Amber Candle","Tall Latte Mug","Weekly Planner Pad","Thank You Gift Box","Ceramic Sunrise Mug");
$last_week_orders = array(
  array("Coffee Lover Gift Box"),
  array("Travel Cork Mug","Desk Sticky Notes"),
  array("Cedar Amber Candle"),
  array("Weekly Planner Pad","Recycled Notebook"),
  array("Ceramic Sunrise Mug","Greeting Card Bundle"),
  array("Tall Latte Mug"),
);
$history_names = array("Birthday Mini Gift Box","Relax Evening Gift Box","Brush Pen Set","Stoneware Tea Mug","Vanilla Bean Candle","Desk Sticky Notes","Midnight Espresso Mug","Lavender Night Candle","Winter Pine Candle","Signature Hoodie - Large");
$create_order = function($names, $status, $date) use ($products_by_name) {
  $order = wc_create_order();
  foreach ($names as $name) {
    if (isset($products_by_name[$name])) { $order->add_product($products_by_name[$name], 1); }
  }
  $order->set_status($status);
  $order->set_date_created(new WC_DateTime($date->format("Y-m-d H:i:s"), $date->getTimezone()));
  $order->update_meta_data("_tillwise_seed_order", "1");
  $order->calculate_totals();
  $order->save();
};
for ($i = 0; $i < 8; $i++) {
  $date = (new DateTimeImmutable("@".($earliest_today->getTimestamp() + (int) round($today_span * ($i + 1) / 9))))->setTimezone($tz);
  $create_order(array($today_names[$i]), $i < 6 ? "processing" : "completed", $date);
}
$last_week = $now->modify("-7 days")->setTime(10, 0, 0);
for ($i = 0; $i < count($last_week_orders); $i++) {
  $create_order($last_week_orders[$i], "completed", $last_week->modify("+".($i * 80)." minutes"));
}
for ($i = 0; $i < 14; $i++) {
  $days = 1 + ($i % 6) + (int) floor($i / 6) * 8;
  $create_order(array($history_names[$i % count($history_names)]), "completed", $now->modify("-".$days." days")->setTime(9 + ($i % 8), 30, 0));
}
$stocks = array(
  "Ceramic Sunrise Mug"=>12,"Midnight Espresso Mug"=>2,"Tall Latte Mug"=>7,"Travel Cork Mug"=>4,"Stoneware Tea Mug"=>1,
  "Cedar Amber Candle"=>8,"Citrus Grove Candle"=>2,"Lavender Night Candle"=>10,"Vanilla Bean Candle"=>3,"Winter Pine Candle"=>6,
  "Weekly Planner Pad"=>25,"Recycled Notebook"=>2,"Brush Pen Set"=>9,"Desk Sticky Notes"=>16,"Greeting Card Bundle"=>5,
  "Coffee Lover Gift Box"=>4,"Relax Evening Gift Box"=>1,"Desk Refresh Gift Box"=>6,"Birthday Mini Gift Box"=>8,"Thank You Gift Box"=>2,
  "Signature Hoodie - Small"=>3,"Signature Hoodie - Large"=>9
);
foreach ($products_by_name as $name => $product) {
  if (isset($stocks[$name])) { wc_update_product_stock($product, $stocks[$name], "set"); }
}
if (isset($products_by_name["Signature Hoodie - Small"])) {
  $hoodie = $products_by_name["Signature Hoodie - Small"];
  $hoodie->set_sale_price("44.10");
  $sale_from = $now->modify("-1 hour");
  $sale_to = $now->modify("+36 hours");
  $hoodie->set_date_on_sale_from(new WC_DateTime($sale_from->format("Y-m-d H:i:s"), $sale_from->getTimezone()));
  $hoodie->set_date_on_sale_to(new WC_DateTime($sale_to->format("Y-m-d H:i:s"), $sale_to->getTimezone()));
  $hoodie->save();
}
delete_option(Tillwise_Store_Agent::PREVIEWS_OPTION);
delete_option(Tillwise_Store_Agent::HISTORY_OPTION);
delete_option(Tillwise_Store_Agent::GUARDRAILS_OPTION);
echo "Demo store reset.\n";
' --allow-root
