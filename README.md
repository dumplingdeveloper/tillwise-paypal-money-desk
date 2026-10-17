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

The agent only has Studio tools and read-only PayPal tools; no money-moving tool is exposed to Studio. See `docs/M2_AG_STUDIO_EVIDENCE.md`. The live acceptance test is `cd alexa-sim && npm run build && LIVE_LLM=1 EXPECTED_GITHUB_LOGIN=<login> SIM_PORT=4189 node --test dist/test/moneyDeskLive.test.js`.

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
