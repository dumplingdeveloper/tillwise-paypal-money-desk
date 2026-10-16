#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
output=$(docker compose exec -T cli bash /var/www/html/tillwise-scripts/seed.sh)
printf '%s\n' "$output" | awk '/TILLWISE_ENV_BEGIN/{flag=1; next} /TILLWISE_ENV_END/{flag=0} flag' > .env
docker compose exec -T cli rm -f /var/www/html/.env
cp .env mcp-server/.env
printf '%s\n' "$output" | sed '/TILLWISE_ENV_BEGIN/,/TILLWISE_ENV_END/d'
echo "Wrote .env and mcp-server/.env with the demo Application Password."
