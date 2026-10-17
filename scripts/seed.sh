#!/usr/bin/env bash
set -euo pipefail
cd /var/www/html
if ! wp core is-installed --allow-root; then
  wp core install --url="http://127.0.0.1:8098" --title="Tillwise Demo Store" --admin_user=admin --admin_password=adminpass --admin_email=admin@example.test --skip-email --allow-root
fi
wp plugin install woocommerce --version=11.1.1 --activate --allow-root || wp plugin activate woocommerce --allow-root
wp plugin activate tillwise-store-agent --allow-root
wp option update woocommerce_currency EUR --allow-root
wp option update permalink_structure '/%postname%/' --allow-root
wp rewrite flush --allow-root
wp eval-file /var/www/html/tillwise-scripts/seed-store.php --allow-root
