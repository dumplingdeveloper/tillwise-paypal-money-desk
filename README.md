# Tillwise × PayPal

A voice store agent for small WooCommerce shops on PayPal. It reads PayPal money, explains refund spikes on an AG Studio Money Desk, and never moves money without a preview and the owner's "yes". Built for the PayPal AI Hackathon on Devpost.

- **Real PayPal sandbox:** the voice flow's money tools (refund, invoice create/send, tracking, dispute accept) call `api-m.sandbox.paypal.com` as preview → owner confirmation → apply, with an audit row in WordPress. The refund is verified end to end on the sandbox; the other three use the same client but have not been run live (`docs/FACTS_PAYPAL_SANDBOX.md`). The Money Desk grid "Real PayPal sandbox · objects Tillwise created" reads those objects back from PayPal.
- **Mock data, labelled "· mock data" on every widget:** the Money Desk analytics (KPIs, revenue chart, refund rate, who still owes us, disputes, the refund drill-down). On the shared public sandbox app, Transaction Search returns other users' traffic, so the analytics run on a deterministic mock ledger. Details: `docs/DEVPOST.md` → "PayPal integration and mock vs sandbox".
- **Two agents, both on the GitHub Copilot SDK:** the voice agent can move money only through the gated tools; the AG Studio AI panel agent is read-only.
- **Devpost write-up:** `docs/DEVPOST.md`. To run it yourself, see "Judge quick start" below (mock mode by default; no PayPal account needed).

This repository started as "Tillwise Store Agent", an Alexa+ track hackathon project for WooCommerce store owners: safe, stateful store operations through WordPress Abilities, a self-hosted MCP server over Streamable HTTP, Agent Skills, and an unofficial browser-based Alexa+ experience simulator. The PayPal money tools, the AG Studio Money Desk and the Copilot SDK Studio bridge were added during the PayPal AI Hackathon; `docs/DEVPOST.md` → "New vs existing" lists those commits.

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
- PayPal mock mode is the default and requires no PayPal credentials. Sandbox mode is used when `~/.config/tillwise/paypal-sandbox.env` exists with `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` (`PAYPAL_MODE=mock` forces mock); secrets must not be printed or committed.
- This build can only talk to the PayPal sandbox host `api-m.sandbox.paypal.com`; production PayPal hosts are refused in code.

## Judge quick start

Needs Docker, Node 22 (`^20.19.0 || >=22.12.0` for the Copilot SDK) and Google Chrome. PayPal runs in **mock mode** by default (a deterministic ledger in `mcp-server/src/paypal/mockLedger.ts`); no PayPal account is needed.

```bash
git clone https://github.com/dumplingdeveloper/tillwise-paypal-money-desk.git tillwise-paypal && cd tillwise-paypal
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

PayPal sandbox (optional): see the next section. Without `~/.config/tillwise/paypal-sandbox.env`, everything runs on the mock ledger. With it, sandbox mode is chosen automatically, and `PAYPAL_MODE=mock` forces mock.

## Use the real PayPal sandbox

The voice flow's money tools then call the **real PayPal sandbox**:
- refund: preview → you confirm → `POST /v2/payments/captures/{id}/refund`;
- invoice create/send, tracking, dispute accept.

The Money Desk gets a **live** grid of every PayPal object Tillwise created. The analytics widgets (refund rate, anomaly drill-down, owed scoreboard, disputes) stay on the labelled mock ledger, and every one of their titles ends in "· mock data". Why: on a shared sandbox app, Transaction Search returns other people's traffic, has no tag filter and lagged about 2 h. Details and verbatim PayPal responses are in `docs/FACTS_PAYPAL_SANDBOX.md`.

Every PayPal call goes only to `api-m.sandbox.paypal.com`; production hosts are refused in code. Secrets are never printed.

**1. Credentials: pick one.**

- **Option A: PayPal's public default sandbox credentials (no PayPal account needed).** PayPal publishes a default sandbox app in its official Postman collections:
  - repository https://github.com/paypal/postman-collections, file `Collections/PayPal_Public_APIs.json` (same values in `Collections/PayPal_Checkout_Flows.json`);
  - collection variables `client_id` and `client_secret`;
  - their note: "PayPal Public Collection comes with following default public set of credentials stored at the Collection level. You may choose to override these values via environment level variables. You may bring your own credentials from PayPal Developer Dashboard there."

  This helper downloads that file (pinned commit), writes `~/.config/tillwise/paypal-sandbox.env` (mode 600) and `paypal-sandbox.SOURCE.txt` (provenance), and prints only the value lengths. It does not overwrite an existing file without `--force`:
  ```bash
  cd mcp-server && npm run sandbox:public-creds
  ```
  It is a **shared** app: whatever you create is visible to everyone using these credentials. The seed uses fake names, `@example.com` addresses and a per-install tag (`TW-DEMO-<RUN>-…`), and only reads back its own objects by id. Tillwise shows and acts on disputes only if they are on one of its own captures.
- **Option B: your own sandbox app.**
  1. Sign in or sign up at https://developer.paypal.com/ → **Apps & Credentials → Sandbox → REST API apps**, and copy the Default Application's Client ID and Secret.
  2. Under **Features → Accept payments**, keep **Advanced Credit and Debit Card Payments** ticked. PayPal says it "should be enabled automatically".
  3. Save them. The script prompts and never echoes the secret:
     ```bash
     ./scripts/save-paypal-sandbox-creds.sh
     ```
  With your own app you may also set `PAYPAL_LEDGER=sandbox`, which computes the analytics from Transaction Search instead of the mock ledger.

**2. Check the connection.** This runs OAuth, Transaction Search (last 24 h) and Disputes, then creates, reads back and deletes one draft invoice. Expect `Summary: 6/6 steps ok against api-m.sandbox.paypal.com`.
```bash
cd mcp-server && npm run sandbox:smoke
```

**3. Seed the demo objects** (idempotent; a rerun creates nothing new):
```bash
npm run sandbox:seed
```
- It creates 3 orders captured server-side with PayPal's sandbox test card. No buyer login is needed: the order comes back `COMPLETED`.
- It also creates one €6.00 partial refund and invoice `TW-DEMO-<RUN>-INV-01`. The invoice is sent with `send_to_recipient=false`, so nobody is emailed, and its status is `UNPAID`.
- Expected: `Summary: 6/6 steps ok`. IDs are kept in `~/.config/tillwise/paypal-sandbox-seed.json` (no secrets).
- Without credentials it prints `PayPal sandbox seed: NO CREDENTIALS …`, makes no network call, and exits 2.
- If your own app can't take cards, the seed prints `PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING` and an approve link per order. Log in as your sandbox personal account, then rerun.

**4. Link a Woo order to a real sandbox capture**, so "Refund order N" refunds real sandbox money. Pick a completed order of €100 or less; the refund cap per confirmation is €100. It needs `mcp-server/.env` from `./scripts/seed-local.sh`.
```bash
npm run sandbox:seed -- --link-woo 136
```
It captures exactly that order's total in the sandbox and records the link through the audited `paypal-audit-record` ability. `scripts/demo-reset.sh` recreates the Woo orders, so link again after a reset.

**5. Start the demo.** Sandbox mode is automatic when the credentials file exists:
```bash
cd ../alexa-sim && ALLOW_ANY_GITHUB_LOGIN=1 npm run demo
```
- The voice page badge then reads `PayPal: REAL sandbox · api-m.sandbox.paypal.com · PayPal's public default sandbox app (shared)`, or `… your own PayPal sandbox app`.
- Say or type "Refund order 136" and confirm with "yes". The voice reply confirms the refund, and the WordPress audit row stores the PayPal refund id.
- The Money Desk's top grid "Real PayPal sandbox · objects Tillwise created" shows the new refund.

**Opt-in end-to-end test** against the real sandbox. It needs the MCP server running in sandbox mode, Chrome and a Copilot login. It makes one real refund, uses about 4 model calls and about 20 PayPal calls:
```bash
cd alexa-sim && npm run build && LIVE_PAYPAL=1 EXPECTED_GITHUB_LOGIN=<your login> node --test dist/test/sandboxLive.test.js
```

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
