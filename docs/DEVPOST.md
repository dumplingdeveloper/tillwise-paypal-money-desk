# Devpost submission draft: Tillwise × PayPal

This is a draft of the text for the Devpost form. Facts come from this repository; anything not verified is marked **UNVERIFIED**. The rule quotes come from `submission/RULES_EXCERPTS.md`, which is gitignored and kept locally, and from https://paypalaihackathon.devpost.com/rules, fetched 2026-10-25.

Required by the rules, and where each is covered:

| Requirement | Where it is covered |
| --- | --- |
| Text description of features and functionality | "What it does", "How we built it" |
| A functional demo that judges can run | "Try it out" and the README "Judge quick start" |
| A public repo with a detectable open-source licence | `LICENSE` (GNU GPL); repo URL still to fill in |
| A video under 3 minutes on YouTube | `docs/VIDEO_SCRIPT.md`; URL to fill in after rendering |
| For a project that existed before the Submission Period, an explanation of how it was significantly updated | "New vs existing" |
| PayPal integration that is central, using the free sandbox | "PayPal integration", "Mock vs sandbox" |
| Third-party tools used within their terms | "Built with" and "Licences" |

---

## Project name
Tillwise × PayPal

## Tagline (elevator pitch)
A voice store agent for WooCommerce owners that reads PayPal money, explains refund spikes on an AG Studio Money Desk, and never moves money without a preview and the owner's "yes".

## Inspiration
A one-person WooCommerce shop that takes PayPal payments spreads its money questions across WooCommerce orders, the PayPal activity page, the resolution centre and invoicing. "Why did refunds jump this week?" or "who still owes us?" means opening several screens. Letting an AI agent touch money is a real risk, though, so we wanted an agent that is useful on read questions and strictly gated on anything that moves money.

## What it does
- **Voice/text store agent.** The owner asks in plain English: briefings, sales and stock questions, price changes and PayPal questions. The agent runs on the GitHub Copilot SDK and calls tools on our MCP server, which wraps WordPress Abilities in the WooCommerce store and a PayPal client layer.
- **PayPal money tools behind a gate.** Refunds, invoice creation and sending, tracking upload and dispute acceptance always run as **preview → owner confirmation → apply**.
  - The apply calls use `PayPal-Request-Id` idempotency keys.
  - Every mutation writes an audit row in WordPress.
  - Read-only tools: money briefing, ledger export, refund anomaly, disputes list and dispute details.
- **AG Studio Money Desk** (`/money-desk.html`). This is a real AG Studio 3 canvas whose data comes from the read-only MCP tool `paypal_ledger_export`. It contains:
  - built-in widgets: KPI values, a daily revenue column chart and a refunds grid;
  - three custom widgets registered with `createWidgets`: a refund-rate tile that flags spikes against a baseline, a "who still owes us" scoreboard and a dispute-deadline countdown;
  - a Tillwise theme.
- **Studio's AI panel runs on the Copilot SDK.**
  - The owner types into AG Studio's own AI panel. A `clientToolRunner` streams each round to our server bridge, which keeps a Copilot SDK session per thread.
  - When the model calls a Studio tool, the bridge emits the tool-call events. Studio executes the tool in the browser and the result flows back to the model.
  - The model chooses every tool and every argument. Examples:
    - "Show PayPal revenue by customer segment this month" adds a chart.
    - "Who still owes us money? Make it a table" adds a grid.
    - "Why are refunds spiking?" reads the read-only `paypal_refund_anomaly` tool. It quotes figures computed from the ledger (rate vs baseline, top product and reason, refunds per day) and can add a per-day stacked chart by reason.
  - When the owner asks for a refund in Studio, the agent declines. It has no money-moving tools at all, so it points to the confirmed voice flow.
- **Bring your own key.** Judges without a Copilot subscription can use `TILLWISE_LLM_PROVIDER`, `TILLWISE_LLM_BASE_URL`, `TILLWISE_LLM_API_KEY` and `TILLWISE_LLM_MODEL`. These map to the Copilot SDK `provider` option. A bad key produces a clear HTTP 401 message.

## How we built it
- `mcp-server/` is a TypeScript server built on `@modelcontextprotocol/sdk` (Streamable HTTP, port 3338).
  - Its PayPal layer lives in `mcp-server/src/paypal/`.
  - Mock mode uses a deterministic ledger: 45 days of captures across 3 customer segments, refunds with a causal spike (damaged-in-transit mug shipments), invoices across statuses, disputes with response deadlines, and tracking.
  - Sandbox mode uses `@paypal/paypal-server-sdk` and plain REST calls against `api-m.sandbox.paypal.com` only.
- `wp-plugin/tillwise-store-agent/` holds the WordPress Abilities: store operations, PayPal order context, the audit log and guardrails.
- `alexa-sim/` is the browser voice/text simulator and the GitHub Copilot SDK (`@github/copilot-sdk`) runtime, plus:
  - the Money Desk page, which runs on AG Studio 3.0.0;
  - the Studio bridge, `alexa-sim/src/studioBridge.ts`, which uses parked promises per tool call, honours aborts, emits `RUN_ERROR` instead of throwing, and expires idle sessions.
- Tests:
  - `mcp-server npm test`: 31 tests;
  - `alexa-sim npm test`: 44 tests, of which 36 pass and 8 are gated live tests that are skipped;
  - PHP integration tests: 80/80;
  - a live acceptance test, `alexa-sim/test/moneyDeskLive.test.ts`, which types each prompt into Studio's panel and checks `studioApi.getState()` before and after.

### AG Grid / AG Studio usage (for "Best Use of AG Grid")
The Money Desk uses these AG Studio APIs:
- `createStudio` in edit mode, with data sources and field definitions;
- `createWidgets` with three custom widgets;
- `formatShape` and `ai` metadata, so Studio's AI can configure the custom widgets;
- the Studio form items (select and number) for the refund-tile window;
- `createAiHarness` with a `clientToolRunner` agent;
- `api.defineAiTool` and `api.defineAiCommand`, which wrap `AgAddWidgetCommand` (as our `place_widget` tool, with a full-width layout planner on Studio's 24-column grid) and `AgConfigureWidgetCommand`;
- widget filters (relative date ranges) and date-bucket fields (`refunds.date::day`);
- `getAiContext().health` checks;
- `onErrorRaised`;
- theming through `withParams`;
- the optional licence key through `AgStudioLicenseManager.setLicenseKey` from `AG_STUDIO_LICENSE_KEY`. No key is committed.

Doc quotes with file:line references are in `docs/M2_AG_STUDIO_EVIDENCE.md` and `docs/M3_EVIDENCE.md`.

### APIMatic usage (only what is real)
We used the APIMatic PayPal Server SDK **context plugin** (`paypaldev/server-sdk-context-plugin-preview`, MIT) as reference while building the live PayPal client. `docs/BUILD_LOG.md` lists the plugin's skill files we read and what each one changed in the code: the `@paypal/paypal-server-sdk` client construction, the client-credentials auth, the explicit 30 s timeout, `ApiError` handling and the adapter-injection contract test.

Limits:
- The installer itself failed on this Mac (old Apple Git). We read a manual clone, and the plugin is not vendored into this repo.
- We do not claim any other APIMatic tooling.

## PayPal integration and mock vs sandbox
**Today the demo, the video and all Money Desk evidence run in mock mode.** No sandbox credentials have been available to us yet, so nothing has run against PayPal so far.
- **Mock mode is the default.** It needs no credentials, and every PayPal tool returns deterministic, PayPal-shaped data from `mcp-server/src/paypal/mockLedger.ts`. The Money Desk header says `mock ledger (demo data, not PayPal)`.
- **Sandbox mode** switches on when `~/.config/tillwise/paypal-sandbox.env` exists with `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` (or with `PAYPAL_MODE=sandbox`). `PAYPAL_MODE=mock` forces mock. The helper `scripts/save-paypal-sandbox-creds.sh` writes that file without echoing secrets. Every call goes only to `api-m.sandbox.paypal.com`.
- Switching to the real sandbox takes the creds file plus two commands (README → "Use the real PayPal sandbox"):
  - `cd mcp-server && npm run sandbox:smoke`: real reads (OAuth, Transaction Search, Disputes) plus one draft invoice that it deletes again.
  - `npm run sandbox:seed`: idempotent, `TW-DEMO-*`-tagged demo data.
    - It creates 3 captured orders via Orders v2 `payment_source.card` with PayPal's sandbox test card, and one invoice sent with `send_to_recipient=false`.
    - If the account cannot take card payments, it falls back to buyer-approval links.
    - `-- --link-woo <order>` links a real sandbox capture to a Woo order, so the confirmed voice refund refunds it.
  - Without credentials both commands print `NO CREDENTIALS`, make no network call, and exit 2.
- Live vs mock in sandbox mode (full matrix in `docs/FACTS_PAYPAL_SANDBOX.md` §6):
  - **Live:** the voice flow's money actions, the Money Desk captures/revenue/refunds (Transaction Search, up to 3 h delay), invoices and disputes.
  - **Mock only:** the refund-spike story (damaged-in-transit mugs) behind "Why are refunds spiking?". In sandbox mode the same tools compute from whatever the sandbox holds.
- **UNVERIFIED:** `sandbox:smoke` and `sandbox:seed` have only been tested against local HTTP stubs, never against PayPal.

## New vs existing (Submission Period)
The official rules (https://paypalaihackathon.devpost.com/rules, fetched 2026-10-25) define the period as: "Submission Period: Thursday Oct 1, 2026 (9:15 am Pacific Time) – Thursday Nov 12, 2026 (12:00 pm Pacific Time)". 9:15 am PDT is **2026-10-01 16:15 UTC**.

**Tillwise × PayPal is an existing project that was significantly updated during the Submission Period.**
- The Tillwise base project was started around **2026-09-29**, before the Submission Period, for an earlier (Amazon Alexa+) hackathon. It includes:
  - the WooCommerce store agent;
  - the WordPress Abilities plugin;
  - the MCP server;
  - the Agent Skills;
  - the voice simulator;
  - the video pipeline.
- This repository's first commit, **`bfa04a5` (2026-10-16 22:32 +0100)**, is a squashed snapshot of that earlier project.
  - Its commit date falls inside the period, but its contents were built for, and largely before, the other hackathon.
  - We therefore count **none of `bfa04a5`** as PayPal-hackathon work.
- Only the commits below are claimed as hackathon work. All of them were committed after 2026-10-01 16:15 UTC; the earliest is 2026-10-17 10:27 UTC.

Built for the PayPal AI Hackathon, from `git log` (short hash, author date):

| Commit | Date | Change |
| --- | --- | --- |
| `85edb64` | 2026-10-17 | Fix hood timing for gated tools; keep demo video in sync |
| `62cf6d5` | 2026-10-17 | Isolate PayPal hackathon stack (separate Docker project/ports) |
| `09f1467` | 2026-10-17 | PayPal design document |
| `326c2a2` | 2026-10-17 | PayPal M1 core: client layer, mock + sandbox clients, preview/apply money tools, audit abilities |
| `be48567` | 2026-10-17 | PayPal safety fixes; first Money Desk attempt |
| `0037ffe` | 2026-10-17 | Money Desk evidence redo |
| `a3b3da6` | 2026-10-17 | Deterministic PayPal mock ledger; read-only `paypal_ledger_export` |
| `6696343` | 2026-10-17 | Copilot SDK Studio bridge; MCP-backed Money Desk data |
| `3e8db8f` | 2026-10-17 | Real AG Studio canvas, custom widgets, client tool runner |
| `f5cd81f` | 2026-10-17 | Removal of evidence not produced by a real agent |
| `b5d754f` | 2026-10-17 | Live acceptance test, widget filter tool, layout hints |
| `57d5a97` | 2026-10-17 | Live evidence produced by the LIVE_LLM test |
| `b961f79` | 2026-10-17 | Honest M2 evidence doc |
| `4a95e20` | 2026-10-25 | Causal refund spike, read-only `paypal_refund_anomaly` |
| `e1f0737` | 2026-10-25 | Full-width placement, canvas summary, calendar-week refund tile |
| `d11fd13` | 2026-10-25 | Mock product name so the refunds grid fits |
| `7c321ba` | 2026-10-25 | BYOK provider for the voice sim and the Studio bridge |
| `58022a2` | 2026-10-25 | `npm run sandbox:smoke` |
| `24951f0` | 2026-10-25 | Live test: anomaly drill-down, layout/polish checks |
| `b96e459`, `67f9fb2`, `c81f06e` | 2026-10-25 | Judge quick start, configurable ports, test port fix |
| `9bab855` | 2026-10-25 | M3 evidence |
| `ea94db7`, `9f5258a`, `d172e71`, `dedb7f5` | 2026-10-25 | Refund drill-down per day by reason, calendar-week dates, de-duplication of the "this week" tile |
| `a96ba0d` | 2026-10-25 | Video script and scene |
| `ccba904`, `9dcbaa3` | 2026-10-25 | Devpost draft; M3.1 evidence notes |

All PayPal code (`mcp-server/src/paypal/`, the PayPal abilities in the WordPress plugin) and all AG Studio code (`alexa-sim/public/money-desk*.js`, `alexa-sim/src/studioBridge.ts`, `alexa-sim/src/moneyDesk.ts`, `alexa-sim/src/paypalMcp.ts`) are new in this period.

Later commits (licence facts, sandbox seed, live evidence) are listed by `git log --since=2026-10-01T16:15Z`; refresh this table before submitting.

## Challenges we ran into
- **AG Studio canvas.** The canvas stayed blank until every widget had a valid `dataMapping` against declared data sources.
- **Layout.** Agent-added widgets were half-width until we placed them ourselves on Studio's 24-column grid.
- **Number provenance.** Models like to compute percentages. We moved every figure into read-only tools and made the live test check that each € and % value in the reply appears in the tool output.
- **Duplicate tiles.** On a Sunday "this week" and "last 7 days" are the same dates. The canvas summary now tells the agent so, instead of letting it add a duplicate tile.

## Accomplishments that we're proud of
- A live test, not a mock-up, drives Studio's own AI panel and checks `getState()`.
- The refusal path is proven by data:
  - no money-moving tool is declared to the Studio agent;
  - the bridge rejects any non-allowlisted tool (unit-tested);
  - the audit counts are unchanged before and after the refusal.

## What we learned
- Client tool runners let a server-side SDK agent drive a browser-side tool surface cleanly.
- Deterministic data plus "quote, don't compute" makes AI analytics trustworthy.

## What's next
- Run `sandbox:smoke` and `sandbox:seed`, and the Money Desk, against real PayPal sandbox data once credentials exist.
- Add anomaly alerts for disputes.

## Built with
TypeScript, Node.js, GitHub Copilot SDK, Model Context Protocol (`@modelcontextprotocol/sdk`), PayPal REST APIs and `@paypal/paypal-server-sdk` (sandbox), APIMatic PayPal SDK context plugin (reference), AG Studio 3 (AG Grid), WordPress Abilities API, WooCommerce, PHP, Docker, Playwright (tests).

## Try it out
- Repo: **TODO, public URL** (the licence is GPL, `LICENSE` at the root).
- Setup and run: README → "Judge quick start" (mock by default; Copilot login or BYOK; ports 8098 / 3338 / 4179 by default).
- Video: **TODO, YouTube URL** (script in `docs/VIDEO_SCRIPT.md`).
- Testing instructions for judges:
  - No PayPal account is needed in mock mode.
  - For sandbox, create a free PayPal developer sandbox app and run `scripts/save-paypal-sandbox-creds.sh`, then `cd mcp-server && npm run sandbox:smoke && npm run sandbox:seed`. See README → "Use the real PayPal sandbox".

## Licences and third-party terms
- AG Studio's `package.json` says `"license": "Commercial"`. It is an npm dependency and is not vendored into this repo.
  - AG Studio's docs say "You can test AG Studio locally without a licence" (licence-install.md).
  - Without a key, the page logs a "License Key Not Found" console banner. The "For Trial Use Only" watermark is hidden on `127.0.0.1`/`localhost`, by code in AG Studio's own bundle.
  - An optional key is read only from `AG_STUDIO_LICENSE_KEY`; no key is committed.
- Verbatim terms, the conflicts between them, and open questions are in `docs/FACTS_AG_STUDIO_LICENCE.md`:
  - "45-day trial" vs EULA clause 13.2(b) "thirty (30) days and a further period of thirty (30) days";
  - "internal evaluation and review purposes only" vs public judging until Dec 15, 2026.
- **UNVERIFIED:** AG Grid has not yet confirmed that judges may run the repo with no key, or with a trial key, through the end of judging. The questions are listed for the PayPal Discord.
- The PayPal + AG Studio boilerplate repo has no LICENSE, so no code was copied from it; it was used only to learn API shapes.
