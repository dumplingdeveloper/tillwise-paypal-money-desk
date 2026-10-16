#!/usr/bin/env bash
# Runs the official MCP conformance suite against a throwaway local instance of the
# Tillwise MCP server and compares the result with conformance/baseline.yml.
# Exit 0: only baseline failures. Exit 1: a new failure, or a baseline entry now passes.
# Optional env: CONFORMANCE_PORT (default 3399), CONFORMANCE_OUT (results dir), CONFORMANCE_BASELINE.
set -euo pipefail
cd "$(dirname "$0")/.."

SUITE_VERSION="0.1.16"
SPEC_VERSION="2025-11-25"
PORT="${CONFORMANCE_PORT:-3399}"
OUT_DIR="${CONFORMANCE_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/tillwise-conformance.XXXXXX")}"
mkdir -p "$OUT_DIR"

if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use; set CONFORMANCE_PORT to a free port." >&2
  exit 2
fi

# Reuse the WordPress connection settings, but run this instance on its own port.
if [ -f mcp-server/.env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in WP_*=*) export "${line%%=*}=${line#*=}" ;; esac
  done < mcp-server/.env
fi
export MCP_HOST=127.0.0.1 MCP_PORT="$PORT"
# The suite cannot send an Authorization header, so this short-lived loopback instance runs without one.
unset MCP_AUTH_TOKEN

(cd mcp-server && npm run build --silent)
node mcp-server/dist/src/server.js >"$OUT_DIR/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  if curl -fs -o /dev/null "http://127.0.0.1:$PORT/status"; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then cat "$OUT_DIR/server.log" >&2; exit 2; fi
  sleep 0.2
done

set +e
npx -y "@modelcontextprotocol/conformance@$SUITE_VERSION" server \
  --url "http://127.0.0.1:$PORT/mcp" \
  --spec-version "$SPEC_VERSION" \
  --expected-failures "${CONFORMANCE_BASELINE:-conformance/baseline.yml}" \
  -o "$OUT_DIR/results" >"$OUT_DIR/run.txt" 2>&1
STATUS=$?
set -e

sed -n '/=== SUMMARY ===/,$p' "$OUT_DIR/run.txt"
echo
echo "Note: tools-call-simple-text and tools-call-error also pass when the fixture tool is missing"
echo "(https://github.com/modelcontextprotocol/conformance/issues/515), so they are not counted as real passes."
echo "Full output: $OUT_DIR/run.txt"
exit "$STATUS"
