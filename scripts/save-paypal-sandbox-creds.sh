#!/bin/sh
# Saves PayPal SANDBOX REST credentials to ~/.config/tillwise/paypal-sandbox.env (mode 600)
# and checks them with one OAuth call to api-m.sandbox.paypal.com. Nothing secret is printed
# and the secret never appears on a command line.
#
# Where the values come from (https://developer.paypal.com/api/rest/, 2026-10-25):
#   "Select Log in to Dashboard and log in or sign up." / "Select Apps & Credentials." /
#   "New accounts come with a Default Application in the REST API apps section." /
#   "Copy the client ID and client secret for your app."
set -eu

dir="$HOME/.config/tillwise"
file="$dir/paypal-sandbox.env"
mkdir -p "$dir"
chmod 700 "$dir"

printf 'PayPal sandbox Client ID: '
read -r client_id
printf 'PayPal sandbox Secret (input hidden): '
if [ -t 0 ]; then
  stty -echo
  trap 'stty echo' EXIT INT TERM
  read -r client_secret
  stty echo
  trap - EXIT INT TERM
else
  read -r client_secret
fi
echo

case "$client_id$client_secret" in
  *[!A-Za-z0-9_-]*) echo "Unexpected characters in the values; nothing was saved." >&2; exit 1 ;;
esac
if [ -z "$client_id" ] || [ -z "$client_secret" ]; then
  echo "Both values are required; nothing was saved." >&2
  exit 1
fi

umask 077
printf 'PAYPAL_CLIENT_ID=%s\nPAYPAL_CLIENT_SECRET=%s\n' "$client_id" "$client_secret" > "$file"
chmod 600 "$file"
echo "Saved $file (mode 600)."

status=$(printf 'user = "%s:%s"\n' "$client_id" "$client_secret" | curl -s -o /dev/null -w '%{http_code}' -K - \
  -X POST https://api-m.sandbox.paypal.com/v1/oauth2/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d grant_type=client_credentials)
unset client_secret
if [ "$status" = "200" ]; then
  echo "Sandbox OAuth check: HTTP 200 (credentials work)."
else
  rm -f "$file"
  echo "Sandbox OAuth check: HTTP $status. The values did not authenticate, so $file was removed (the app stays in mock mode)." >&2
  exit 2
fi
