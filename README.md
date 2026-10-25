# Tillwise Store Agent

Tillwise Store Agent is an Alexa+ track hackathon project for WooCommerce store owners. It exposes safe, stateful store operations through WordPress Abilities, a self-hosted MCP server over Streamable HTTP, Agent Skills, and an unofficial browser-based Alexa+ experience simulator.

Phase B adds the PayPal AI Hackathon fork, “Tillwise × PayPal”: the same safety model now wraps PayPal sandbox money tools in mock-first mode, with explicit confirmation before any mutation.

## Architecture

```text
Chrome browser voice/text UI (alexa-sim/public)
  -> alexa-sim/ backend (GitHub Copilot SDK session, SSE events, permission gate)
  -> mcp-server/ (TypeScript, @modelcontextprotocol/sdk, Streamable HTTP)
  -> WordPress REST /wp-abilities/v1/abilities/tillwise-store/<ability>/run
  -> wp-plugin/tillwise-store-agent/ (WooCommerce operations, previews, history, guardrails)
  -> PayPal client layer in mcp-server/src/paypal (mock by default; sandbox when credentials exist)
  -> WooCommerce demo store in Docker

skills/ contains Agent Skills loaded by the Copilot SDK and exposed by the MCP server as resources.
```

## Safety model

- Price changes are previewed first and stored server-side with a preview id.
- Apply accepts only a valid preview id for the same user.
- Previews expire after 15 minutes and are single-use.
- Apply writes exactly the previewed values and skips products whose price changed after preview.
- Applied batches are stored in persistent history and can be undone.
- Undo also checks for conflicts before restoring old values.
- Guardrails such as minimum price and maximum discount persist in WordPress options and are enforced during preview.
- Every ability returns a short `speech` string plus structured data for cards or screens.
- PayPal mutations use preview/apply where practical, caps, `PayPal-Request-Id` idempotency keys, and WordPress audit rows/order notes.
- PayPal mock mode is the default and requires no PayPal credentials. Sandbox mode is enabled with `PAYPAL_MODE=sandbox` only when `~/.config/tillwise/paypal-sandbox.env` exists with `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`; secrets must not be printed or committed.
- This build can only talk to the PayPal sandbox host `api-m.sandbox.paypal.com`; production PayPal hosts are refused in code.

## Judge quick start

Needs Docker, Node 22 (`^20.19.0 || >=22.12.0` for the Copilot SDK) and Google Chrome. PayPal runs in **mock mode** by default (a deterministic ledger in `mcp-server/src/paypal/mockLedger.ts`); no PayPal account is needed.

```bash
git clone <this repo> tillwise-paypal && cd tillwise-paypal
docker compose up -d --wait               # WordPress + WooCommerce on http://127.0.0.1:8098 (project "tillwise-paypal")
./scripts/seed-local.sh                   # installs WooCommerce, seeds the demo store, writes .env + mcp-server/.env
(cd mcp-server && npm ci && npm run build)
cd alexa-sim && npm ci
```

Then pick ONE way to reach a model:

| Option | Command (from `alexa-sim/`) |
| --- | --- |
| GitHub Copilot (logged-in Copilot CLI user, or `COPILOT_GITHUB_TOKEN=github_pat_…`) | `ALLOW_ANY_GITHUB_LOGIN=1 npm run demo` |
| Your own key (BYOK, no Copilot, no GitHub login) | `TILLWISE_LLM_PROVIDER=openai TILLWISE_LLM_API_KEY=… TILLWISE_LLM_MODEL=gpt-4o-mini npm run demo` |
| Anthropic / Azure / local Ollama | `TILLWISE_LLM_PROVIDER=anthropic` (or `azure` + `TILLWISE_LLM_BASE_URL`, or `ollama` with no key) + `TILLWISE_LLM_MODEL` |

`npm run demo` starts the MCP server on `127.0.0.1:3338` and the simulator on `127.0.0.1:4179`. Expected output (Copilot login):

```text
Tillwise MCP server listening on http://127.0.0.1:3338/mcp
MCP LATEST_PROTOCOL_VERSION=2025-11-25
Copilot SDK authenticated as <your login>
Copilot SDK model count <n>
Alexa+ simulator listening on http://127.0.0.1:4179
```

Quick check: `curl -s http://127.0.0.1:4179/api/money-desk-data` returns `"source":{"tool":"paypal_ledger_export","via":"mcp",…}` with about 310–320 captures, 40–45 refunds (the exact counts depend on the time of day), 6 invoices, 3 disputes and 8 tracking rows (mock ledger, 45 days to today).

With BYOK the second line is `LLM provider: BYOK openai · gpt-4o-mini @ api.openai.com (key set)` (the key itself is never printed). A wrong key is shown in the voice sim and in the Money Desk AI panel as `BYOK provider openai rejected the API key (HTTP 401). Check TILLWISE_LLM_API_KEY …`.

Open:

- `http://127.0.0.1:4179/` — voice/text store agent. Try "How did the shop do today?", then "Refund order 136" (preview → you confirm → apply).
- `http://127.0.0.1:4179/money-desk.html` — AG Studio Money Desk. Type in the AI panel on the left: "Show PayPal revenue by customer segment this month", "Why are refunds spiking?". The Studio agent is read-only; refunds stay in the confirmed voice flow.

Ports are configurable if 8098 / 3338 / 4179 are taken: `TILLWISE_WP_PORT=8108 COMPOSE_PROJECT_NAME=tillwise-judge docker compose up -d --wait` and the same two variables for `./scripts/seed-local.sh`; then `MCP_PORT=3348 MCP_URL=http://127.0.0.1:3348/mcp SIM_PORT=4193 npm run demo`. Tear down with `docker compose down -v` (same variables).

PayPal sandbox (optional): `./scripts/save-paypal-sandbox-creds.sh` stores sandbox REST credentials in `~/.config/tillwise/paypal-sandbox.env` (mode 600); then `cd mcp-server && npm run sandbox:smoke` runs OAuth, Transaction Search, Disputes, and creates + reads back + deletes one draft invoice against `api-m.sandbox.paypal.com`, printing a summary without secrets. Without that file it prints `PayPal sandbox smoke: NO CREDENTIALS …` and exits 2.

## Use the real PayPal sandbox

Mock mode needs nothing. To run against **your own** PayPal sandbox app instead:
- Every PayPal call goes only to `api-m.sandbox.paypal.com`; production hosts are refused in code.
- Sources and the live/mock feature matrix are in `docs/FACTS_PAYPAL_SANDBOX.md`.
- Status: these steps have been tested only against local stubs. No sandbox credentials have been available to the authors yet.

1. Sign in or sign up at https://developer.paypal.com/ → **Apps & Credentials → Sandbox → REST API apps**. Use the Default Application or create one, and copy its Client ID and Secret.
2. In that app: **Features → Accept payments**. Make sure **Advanced Credit and Debit Card Payments** is ticked. PayPal says it "should be enabled automatically" for sandbox business accounts. A US sandbox business account avoids 3-D Secure prompts.
3. Save the credentials. The script prompts, never echoes the secret, and writes `~/.config/tillwise/paypal-sandbox.env` with mode 600:
   ```bash
   ./scripts/save-paypal-sandbox-creds.sh
   ```
4. Check the connection. It runs OAuth, Transaction Search, Disputes, and creates, reads back and deletes one draft invoice. Expect `Summary: 6/6 steps ok against api-m.sandbox.paypal.com`.
   ```bash
   cd mcp-server && npm run sandbox:smoke
   ```
5. Seed the demo data (idempotent; tags `TW-DEMO-*`; rerun safely):
   ```bash
   npm run sandbox:seed
   ```
   - It creates 3 captured orders (one per segment) with PayPal's sandbox test card, plus invoice `TW-DEMO-INV-01`. The invoice is sent with `send_to_recipient=false`, so nobody is emailed.
   - Expected: `✔ capture TW-DEMO-CAP-01 …` ×3, then `✔ invoice TW-DEMO-INV-01: created: INV2-… status UNPAID`, then `Summary: 5/5 steps ok`.
   - If your account cannot take card payments, the seed prints `PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING` and an approve link per order. Open each link and log in as your sandbox **personal** account (Testing Tools → Sandbox Accounts), then run `npm run sandbox:seed` again to capture them.
   - IDs are kept in `~/.config/tillwise/paypal-sandbox-seed.json` (no secrets).
   - Without credentials it prints `PayPal sandbox seed: NO CREDENTIALS …`, makes no network call, and exits 2.
6. Optional: make a voice-flow refund hit a real sandbox capture. Pick a Woo order total of €100 or less, because the refund cap is €100 per confirmation. This needs `mcp-server/.env` from `./scripts/seed-local.sh`.
   ```bash
   npm run sandbox:seed -- --link-woo 136
   ```
   It creates a sandbox capture for exactly that order's total and links it to the order through the audited `paypal-audit-record` ability. "Refund order 136" then previews, asks for confirmation, and refunds that capture in the sandbox.
7. Start the demo in sandbox mode. Sandbox mode is also chosen automatically whenever the credentials file exists; `PAYPAL_MODE=mock` forces mock.
   ```bash
   cd ../alexa-sim && PAYPAL_MODE=sandbox ALLOW_ANY_GITHUB_LOGIN=1 npm run demo
   ```
   - The Money Desk header then says `live PayPal sandbox` instead of `mock ledger (demo data, not PayPal)`.
   - PayPal: "It takes a maximum of three hours for executed transactions to appear in the list transactions call". New captures may show up only later.
   - The refund-spike drill-down story exists only in the mock ledger. In sandbox mode the same tiles and tools compute from whatever your sandbox holds.

## Quick start

```bash
# from the repository root
docker compose up -d
./scripts/seed-local.sh
cd mcp-server
npm install
npm run build
set -a && source .env && set +a
npm start
```

The MCP endpoint is `http://127.0.0.1:3338/mcp`. The seed script writes `.env` and `mcp-server/.env` with a local WordPress Application Password for `shopmanager`.

## Tools

The MCP server exposes:

- `store_briefing`
- `sales_summary`
- `low_stock`
- `price_change_preview`
- `price_change_apply`
- `price_change_undo`
- `price_change_history`
- `guardrails_get`
- `guardrails_update`
- `paypal_money_briefing`
- `paypal_ledger_export` (read-only)
- `paypal_refund_anomaly` (read-only)
- `paypal_refund_preview`
- `paypal_refund_apply`
- `paypal_invoice_create_preview`
- `paypal_invoice_create_apply`
- `paypal_invoice_send_apply`
- `paypal_tracking_add_apply`
- `paypal_disputes_list`
- `paypal_dispute_get`
- `paypal_dispute_accept_claim_preview`
- `paypal_dispute_accept_claim_apply`
- `paypal_guardrail_refusal`

It also exposes the Agent Skill markdown files as MCP resources.

## Alexa+ experience simulator

The simulator is in `alexa-sim/`. It is an unofficial demo and does not use Amazon or Alexa brand assets.

```bash
cd alexa-sim
npm install
npm run demo
```

Open the printed `http://127.0.0.1:4179` URL in Chrome. The UI supports push-to-talk with the Web Speech API (`webkitSpeechRecognition`) and a text fallback. It speaks final answers with `speechSynthesis`, renders structured MCP results as cards, and shows a collapsible MCP timeline with protocol version `2025-11-25`.

### AG Studio Money Desk

Open `http://127.0.0.1:4179/money-desk.html` after starting the simulator and the MCP server. The page embeds AG Studio 3.0.0 in edit mode. Its data comes from the read-only MCP tool `paypal_ledger_export`. The canvas holds built-in value, column-chart and grid widgets, plus three Tillwise custom widgets: a refund-rate tile, a "who still owes" scoreboard and a dispute-deadline countdown.

The AI panel's agent is a `clientToolRunner`. Its rounds go to `/api/studio-agent/run`, where a GitHub Copilot SDK session decides which Studio tools to call. Studio runs those tools in the browser and sends the results back to the session.

The agent only has Studio tools and read-only PayPal tools; no money-moving tool is exposed to Studio. New widgets are placed by our `place_widget` tool, which wraps Studio's `AgAddWidgetCommand` and gives each one the full free width of the 24-column canvas. Asking "Why are refunds spiking?" makes the agent call the read-only `paypal_refund_anomaly` tool and quote its figures. See `docs/M2_AG_STUDIO_EVIDENCE.md` and `docs/M3_EVIDENCE.md`. The live acceptance test is `cd alexa-sim && npm run build && LIVE_LLM=1 EXPECTED_GITHUB_LOGIN=<login> SIM_PORT=4189 node --test dist/test/moneyDeskLive.test.js`.

AG Studio is a commercial product. This repo includes `ag-studio@3.0.0` for local hackathon testing only; no AG Studio license key is committed. If a trial key is provided later, keep it in the environment as `AG_STUDIO_LICENSE_KEY`.

The simulator uses the GitHub Copilot SDK (`@github/copilot-sdk`) in `copilot-cli` mode with the logged-in Copilot CLI user by default. That mode keeps keytar (the OS keychain) available, so a stored Copilot CLI login is used; `empty` mode disables keytar and can fall back to a different `gh` account. Instead of a stored login, you can set `COPILOT_GITHUB_TOKEN` to a fine-grained `github_pat_` token that has the Copilot Requests permission. Classic `ghp_` tokens are rejected. Either way, the account needs GitHub Copilot access.

Because `copilot-cli` mode does not apply the SDK's `empty`-mode safe defaults automatically, the simulator pins them explicitly in code: session telemetry off, MCP OAuth token storage in memory, embedding retrieval skipped with in-memory cache storage, on-demand instruction discovery off, file hooks off, host git operations off, session store off, coauthor and schedule management off, memory off, custom agents local-only, no built-in skills, custom instructions skipped, config discovery off, and the system prompt's `environment_context` section removed so host path and OS details are not sent to the model. Skills remain enabled so the two Tillwise Agent Skills load.

Default model: `gpt-6-luna`, selected because the live MCP tool benchmark called the store briefing tool reliably and was fastest in the measured tool run. You can override it with `COPILOT_MODEL`.

Create `alexa-sim/.env` before live/demo runs:

```bash
cp alexa-sim/.env.example alexa-sim/.env
# Set EXPECTED_GITHUB_LOGIN to the allowed Copilot login.
```

The simulator logs the authenticated login and refuses to send prompts unless it matches `EXPECTED_GITHUB_LOGIN`, or unless `ALLOW_ANY_GITHUB_LOGIN=1` is set explicitly for a judge-owned account.

### Simulator safety layers

1. **Tool allow-list:** the Copilot session gets only the Tillwise MCP tools (`mcp:tillwise-*`) and the built-in `skill` tool, which may load only the two Tillwise Agent Skills. It has no shell, file, web, or other built-in tools.
2. **Human confirmation gate:** readonly tools, previews, and guardrail refusals are auto-approved; price mutations and PayPal mutation tools require a Yes/No confirmation in the UI. Typing or saying “yes” or “no” resolves the pending request; otherwise it times out after 120 seconds and is denied.
3. **Server-side safety:** WordPress still enforces preview tokens, user binding, expiry, single use, guardrails, optimistic concurrency, history, undo conflict checks, and PayPal audit persistence.

### Demo reset

```bash
# from the repository root
./scripts/demo-reset.sh
```

This resets demo prices, sale dates, previews, history, and guardrails without deleting Docker volumes.

### PayPal mock seed

```bash
# from the repository root
node scripts/paypal-seed.mjs
```

Without sandbox credentials, this seeds deterministic mock PayPal order/capture ids onto the latest Woo order. With sandbox credentials present, browserless card seeding is still marked UNVERIFIED and is not attempted by M1/M2.

## Agent Skills

The skills are in open Agent Skills format:

- `skills/woocommerce-safe-price-changes/SKILL.md`
- `skills/woocommerce-daily-briefing/SKILL.md`

They are voice-oriented: preview first, summarize count/range/examples, require explicit confirmation, then apply or undo.

## Testing

After the stack is seeded:

```bash
docker compose exec -T cli wp eval-file /var/www/html/tillwise-tests/integration.php --allow-root
cd mcp-server
npm test
```

Simulator tests:

```bash
cd alexa-sim
npm test
npm run test:live          # opt-in live Copilot requests
npm run benchmark:models   # opt-in model/tool latency comparison
BROWSER_E2E=1 npm run test:e2e
RELIABILITY_E2E=1 npm run test:reliability
```

The browser e2e uses `playwright-core` with the system Google Chrome (`channel: "chrome"`), saves screenshots to:

- `alexa-sim/screenshots/briefing.png`
- `alexa-sim/screenshots/confirmation.png`
- `alexa-sim/screenshots/applied.png`
- `alexa-sim/screenshots/undo.png`
- `alexa-sim/screenshots/guardrail-refusal.png`
- `alexa-sim/screenshots/low-stock.png`
- `alexa-sim/screenshots/hood-open.png`

Optional Plugin Check:

```bash
docker compose exec -T cli wp plugin install plugin-check --activate --allow-root
docker compose exec -T cli wp plugin check tillwise-store-agent --allow-root
```

## License

GPL-2.0-or-later. See `LICENSE`.
