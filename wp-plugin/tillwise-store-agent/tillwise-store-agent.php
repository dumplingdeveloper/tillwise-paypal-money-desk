<?php
/**
 * Plugin Name: Tillwise Store Agent
 * Description: Safe, stateful WooCommerce store operations exposed through WordPress Abilities for MCP agents.
 * Version:     0.1.0
 * Author:      Yuxin Shi
 * License:     GPL-2.0-or-later
 * Text Domain: tillwise-store-agent
 * Requires PHP: 7.4
 * Requires at least: 7.1
 * Requires Plugins: woocommerce
 * WC requires at least: 11.1
 *
 * @package Tillwise_Store_Agent
 */

defined( 'ABSPATH' ) || exit;

define( 'TILLWISE_STORE_AGENT_VERSION', '0.1.0' );
define( 'TILLWISE_STORE_AGENT_FILE', __FILE__ );
define( 'TILLWISE_STORE_AGENT_PATH', plugin_dir_path( __FILE__ ) );

require_once TILLWISE_STORE_AGENT_PATH . 'includes/class-store-agent.php';

add_action( 'plugins_loaded', array( 'Tillwise_Store_Agent', 'bootstrap' ), 20 );

add_action(
	'before_woocommerce_init',
	function () {
		if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
		}
	}
);
