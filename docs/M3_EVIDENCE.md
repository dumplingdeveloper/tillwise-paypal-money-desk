# M3 evidence: canvas polish, refund anomaly drill-down, BYOK, sandbox smoke, judge path

M3 work started at 2026-10-25T18:07Z on top of M2 (`b961f79`). Every file named under `docs/evidence/` and `alexa-sim/screenshots/` here was written by a test, not by hand. The clean-clone transcript in §6 is copied from command output.

## 1. Canvas polish

### 1a. Agent widgets now use the full width

**Cause.** AG Studio's canvas is a 24-column grid, so the `xSpan: 12` that the model chose in M2 meant half width.
- `alexa-sim/node_modules/ag-studio/dist/types/api/theme/theme.d.ts:30`: `readonly studioCanvasColumnsScale: 24;`
- `theme.d.ts:31`: `readonly studioCanvasRowHeight: 16;`
- `theme.d.ts:27`: `readonly studioCanvasMinWidth: 720;`
- https://www.ag-grid.com/studio/javascript/modes-layout.md l.141: "The `layout` property controls the grid that widgets are placed on, and the space the page occupies." l.247: "The default layout setup can be overridden via the `layout` property. The example above adjusts the default number of columns and the row height in the layout."

**Fix.** Placement is now done in code; the model no longer picks positions.
- The model's `add_widget` / `position_widget` tools were replaced by one `place_widget` tool (`alexa-sim/public/money-desk.js:332`). The model chooses only `type` and `widgetId`.
- Our planner `TillwiseLayout.planPlacement` (`alexa-sim/public/money-desk-layout.js:42`) picks the position. It reads the column count from the page layout (default 24, `:8`) and gives the widget a full-width row. Tiles can share the bottom row, at most 4 per row, re-split evenly.
- The tool then applies Studio's own commands: `AgPositionWidgetCommand` first for any tiles that must shrink, then `AgAddWidgetCommand`. Adding first did not work: Studio moved an overlapping new widget to the next free row.
- Documented pattern, https://www.ag-grid.com/studio/javascript/ai-custom-tools.md l.336-348 ("Wrap a Built-in Command … `name: 'place_widget'` … `command: api.defineAiCommand({ type: 'AgAddWidgetCommand' })`") and l.376 (`const result = await command.apply(args, { signal });`).
- The bridge allowlist no longer contains `add_widget` / `position_widget` (`alexa-sim/src/studioBridge.ts:21`).

**Evidence from live run 2** (`docs/evidence/money-desk-live-{1,2,3,anomaly}.json` → `canvas.geometry`):
- Canvas width 984 px at a 1600×1000 viewport. Every agent widget frame is 976 px wide.
- On every frame: `titleTruncated:false`, `gridOverflowX:false`, `truncatedCells:[]`.
- Agent layouts are `xTrack 0, xSpan 24` (y 50 / 70 / 82 / 100).
- How the harness detects truncation (`alexa-sim/test/moneyDeskHarness.ts`, `canvasGeometry`): it compares the text's Range width with the fractional content width. AG Grid adds an ellipsis on sub-pixel overflow, which integer `scrollWidth` misses.

### 1b. Seeded refunds grid: the Reason column was clipped

- The grid now gets 17 of 24 columns (`money-desk.js:241`), with a product column added (`:232`).
- The compose panel starts collapsed, which gives the canvas more width.
- The dispute tile is 7 columns wide and titled "Dispute deadlines" (`:231`).
- Live evidence: `money-desk-live-initial.json` → `canvasGeometry`. "PayPal refunds" is 692 px wide, with `truncatedCells: []` and `gridOverflowX: false`.
- The live test runs `assertCanvasPolish('initial', …)` against every frame.

### 1c. No duplicate refund tile; title matches the window

- Every request now gives the agent a compact summary of the widgets already on the canvas: id, type, title, fields, widget filters, the refund tile's window, and position (`canvasSummary`, `money-desk.js:397`; `agentInstructions`, `:410`).
- The system message tells the agent to explain or configure an existing widget instead of duplicating it (`studioBridge.ts:36-37`).
- The refund tile has a real `window` option: `rolling-days` (with `windowDays`) or `calendar-week` (Monday to today) (`money-desk.js:76`, `refundWindow`).
- Both are form items (`money-desk.js:181-182`). Custom widgets only receive format values that have form items. https://www.ag-grid.com/studio/javascript/custom-widgets.md l.278: "`format` | `TWidget["format"]` | | Widget format as constructed from the widget form."
- The tile prints the exact dates it covers. The seeded tile is titled "Refund rate · last 7 days".
- Day labels are computed from local date parts (`dayIndex`). Studio returns local-midnight `Date`s, so the old UTC floor shifted labels by one day under Irish summer time.
- Live run 2, prompt 2 ("Add a tile for this week's refund rate") added `refund-rate-tile` with `format.window = "calendar-week"`, titled "Refund rate · this week". The test requires that: a refund tile must be calendar-week, and a `value` tile must carry a date widget filter.
- Today (2026-10-25) is a Sunday, so the calendar week (Mon 19 – Sun 25 Oct) currently equals the rolling 7 days. Both tiles show 35.3%.

## 2. Refund anomaly drill-down (read-only)

**Data.** The mock spike now has a real cause in the ledger.
- Stoneware Mug Set captures from the last ~9 days are refunded at 85% with reason "Damaged in transit".
- Everything else stays at the 6% baseline (`mcp-server/src/paypal/mockLedger.ts:27-28, :78-84`).

**Tool.** New MCP tool `paypal_refund_anomaly`, annotated `readOnlyHint: true` (`mcp-server/src/paypal/tools.ts:13`).
- Implemented by `explainRefundAnomaly` (`mcp-server/src/paypal/refundAnomaly.ts`).
- It compares the window rate with the baseline using the same definition as the tile, and breaks refunds down by reason, product, segment and customer.
- It returns pre-formatted € and % strings.
- Tests (`mcp-server/test/ledger.test.ts`): the spike has one cause across anchors and hours, the breakdown figures add up to the ledger rows, and the tool is read-only.

**Agent.** The tool is in `READ_ONLY_PAYPAL_TOOLS` (`alexa-sim/src/paypalMcp.ts:5`). The system message says (`studioBridge.ts:38`): call it, quote its pre-formatted figures exactly, and never compute rates, totals or shares yourself.

**Live run 2** (`docs/evidence/money-desk-live-anomaly.json`), prompt "Why are refunds spiking?":
- Tool calls: `paypal_refund_anomaly` (args `{}`), then `place_widget`, `configure_bar_chart_grouped`, `add_widget_filter`.
- Reply: "Refund rate is 35.3% over the last 7 days (Oct 19–25) vs. 5.4% before — a 6.5× spike. Top product: Stoneware Mug Set €564.36 (100.0% of refunded €). Top reason: Damaged in transit €564.36 (100.0% of refunded €)…"
- Figure check: the test re-reads the tool over MCP with the same args. Every € / % / × figure in the reply (`35.3%`, `5.4%`, `6.5×`, `€564.36`, `100.0%`) appears in that output, so `notFoundInToolOutput: []`.
- The added chart reads `refunds.product` / `refunds.amount` / `refunds.reason`, filtered to the last 7 days, at full width.

## 3. BYOK (no Copilot subscription needed)

**Module.** `alexa-sim/src/llmProvider.ts` reads:
- `TILLWISE_LLM_PROVIDER`: `openai`, `anthropic`, `azure`, `ollama`, or `copilot` (the default).
- `TILLWISE_LLM_MODEL`: required with a provider.
- `TILLWISE_LLM_API_KEY`: required unless the provider is Ollama or the base URL is loopback.
- `TILLWISE_LLM_BASE_URL`, `TILLWISE_LLM_AZURE_API_VERSION`, `TILLWISE_LLM_WIRE_API`.

**SDK facts it relies on** (@github/copilot-sdk 1.0.15, `dist/types.d.ts`):
- `SessionConfig.provider` at :2009-2012.
- `ProviderConfig` at :2510-2534.
- `useLoggedInUser` at :322 ("When false, only explicit tokens … are used").
- `baseDirectory` at :280.
- `onListModels` at :329.

**Wiring.**
- `CopilotAgentRuntime.start()` (`alexa-sim/src/copilotAgent.ts`) runs with `useLoggedInUser:false`, an isolated `COPILOT_HOME`, a runtime env without `GH_TOKEN` / `GITHUB_TOKEN` / `COPILOT_GITHUB_TOKEN`, and no GitHub login check.
- `provider` and `model` are added to the voice session (`buildSessionConfig`, `copilotAgent.ts:150-154`) and to the Studio bridge session (`createStudioSession`).
- The bridge model is set to the BYOK model (`server.ts`).

**Errors.** `explainLlmError` rewrites provider failures. Example: "BYOK provider openai rejected the API key (HTTP 401). Check TILLWISE_LLM_API_KEY / TILLWISE_LLM_BASE_URL. Provider said: Authentication failed with provider at https://api.openai.com/v1 (HTTP 401)."
- In the voice sim it appears as an `error` event, rendered in the transcript.
- In the Money Desk it appears as a Studio `RUN_ERROR`.
- The page header shows the provider and model, never the key.

**Tests.**
- `alexa-sim/test/llmProvider.test.ts` (offline): env parsing, defaults, misconfiguration messages, token stripping, and 401 mapping. It also checks that a bridge whose session factory throws the provider 401 yields exactly one `RUN_ERROR`.
- `alexa-sim/test/byokProbe.test.ts` (`BYOK_PROBE=1`, real network, random fake key, GitHub tokens removed): starts the real sim and checks both paths.
- Probe runs:
  - `docs/evidence/byok-fake-key-probe-openai.json`: Studio and voice both reported "BYOK provider openai rejected the API key (HTTP 401) …" (8.1 s).
  - `docs/evidence/byok-fake-key-probe-anthropic.json`: the same for `https://api.anthropic.com` (2.2 s).
  - The test asserts that the key string appears nowhere in its output.

## 4. No invoice reminders or dunning

Nothing was added for reminders or dunning. The only invoice write in M3 is the sandbox smoke's single draft invoice (§5). It is never sent, and it is deleted again.

## 5. PayPal sandbox smoke

`cd mcp-server && npm run sandbox:smoke` (`mcp-server/src/sandboxSmoke.ts`) uses the existing `LivePayPalClient`, which is hard-pinned to `api-m.sandbox.paypal.com`. Steps:
1. OAuth.
2. Transaction Search over the last 30 days.
3. Disputes.
4. Create ONE draft invoice (never sent).
5. Read it back and expect `DRAFT`.
6. Delete it, unless `--keep-draft` is given.

It prints a summary without the client id, secret or token, and writes `docs/evidence/paypal-sandbox-smoke.json` only when credentials exist.

Today (no `~/.config/tillwise/paypal-sandbox.env`):

```text
PayPal sandbox smoke: NO CREDENTIALS — ~/.config/tillwise/paypal-sandbox.env is missing or lacks PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET.
Nothing was called. Create sandbox REST app credentials at developer.paypal.com (Apps & Credentials → Sandbox), then run
  ./scripts/save-paypal-sandbox-creds.sh   # writes that file with mode 600, never echoes the secret
  cd mcp-server && npm run sandbox:smoke
exit=2
```

Offline tests (`mcp-server/test/sandboxSmoke.test.ts`) cover the no-credentials exit (nothing called), step order, cleanup, redaction, and error reporting with `debug_id`. **The smoke has never run against the real sandbox.**

## 6. Judge path and clean clone

The README has a new "Judge quick start" section:
- mock mode by default;
- Copilot login or BYOK;
- ports and how to override them;
- expected output and the sandbox smoke.

Changes that support it:
- `docker-compose.yml` and the seed scripts accept `TILLWISE_WP_PORT` (default 8098).
- `npm run demo` lets shell env override the seeded `.env` (so `MCP_PORT` / `MCP_URL` can be changed).
- `scripts/save-paypal-sandbox-creds.sh` is now tracked (the copy under `submission/` is gitignored).
- `mcp-server/test/e2e.test.ts` picks a free port; `3338+random` collided with running servers.

Clean clone at `67f9fb2` into `/tmp/tw-judge/repo`, 2026-10-25 18:44–19:00Z:

```text
$ git clone -q /Users/shiyx/Downloads/claude_folder/hackathon_paypal repo        # 1.2 s
$ TILLWISE_WP_PORT=8108 COMPOSE_PROJECT_NAME=tillwise-judge docker compose up -d --wait
Network tillwise-judge_default  Created
Volume "tillwise-judge_dbdata"  Created
Volume "tillwise-judge_wpdata"  Created
Container tillwise-judge-db-1  Created
Container tillwise-judge-wordpress-1  Created
Container tillwise-judge-cli-1  Created
Container tillwise-judge-db-1  Starting          <- hung (12 min, then a 3 min retry); see BLOCKED below
$ cd mcp-server && npm ci && npm run build
added 132 packages in 5s
$ cd alexa-sim && npm ci
added 123 packages in 5s
# WordPress: the existing tillwise-paypal stack on 8098, with the main checkout's seeded .env copied in (not printed)
$ MCP_PORT=3348 MCP_URL=http://127.0.0.1:3348/mcp SIM_PORT=4193 EXPECTED_GITHUB_LOGIN=yuxinshiu63 npm run demo
Tillwise MCP server listening on http://127.0.0.1:3348/mcp
MCP LATEST_PROTOCOL_VERSION=2025-11-25
Copilot SDK authenticated as yuxinshiu63
Copilot SDK model count 19
Alexa+ simulator listening on http://127.0.0.1:4193
$ curl -s :4193/api/money-desk-data
source: {'tool': 'paypal_ledger_export', 'via': 'mcp', 'speech': 'PayPal ledger export (mock) for the last 45 days: 138 captures, 16 refunds, 6 invoices, 3 disputes, 8 tracking rows.'} | mode: mock anchor: 2026-10-25
GET / 200 · GET /money-desk.html 200 · GET /money-desk.js 200 · GET /money-desk-layout.js 200 · GET /vendor/ag-studio.js 200 (5,576,251 B)
MCP initialize on 3348 → protocolVersion 2025-11-25, serverInfo tillwise-store-agent 0.1.0
$ MONEY_DESK_E2E=1 SIM_PORT=4194 MCP_URL=http://127.0.0.1:3348/mcp node --test dist/test/moneyDeskPlumbing.test.js
✔ offline plumbing: AI panel → client tool runner → bridge → Studio executes tool calls (17249ms)
$ npm test   (alexa-sim)  → tests 44, pass 36, fail 0, skipped 8
$ npm run sandbox:smoke   → PayPal sandbox smoke: NO CREDENTIALS … (exit 2)
$ TILLWISE_WP_PORT=8108 COMPOSE_PROJECT_NAME=tillwise-judge docker compose down -v
… Volume tillwise-judge_dbdata Removed · Volume tillwise-judge_wpdata Removed · Network tillwise-judge_default Removed
```

The demo, MCP and plumbing processes were stopped by shell id; ports 3348, 4193 and 4194 are free afterwards. `/tmp/tw-judge/repo` was deleted.

**BLOCKED: Docker on this Mac cannot start new containers.**
- Both `docker compose up` attempts stuck at "Starting", and so did a plain `docker run --rm redis:7-alpine echo` (left in state `created`).
- Docker Desktop's backend log at the time: `[com.docker.backend][W] unable to inject 3 events for 14m10.002033392s`.
- `docker compose exec` into the already-running `tillwise-paypal` stack works (the PHP suite ran 80/80).
- Restarting Docker Desktop would kill other projects' running stacks, so I did not do it.
- So `docker compose up` → `./scripts/seed-local.sh` on a fresh project with port 8108 is **unverified**. The compose and seed changes for `TILLWISE_WP_PORT` are small and were not exercised end to end.

## 7. Live acceptance runs (budget ≤ 40 model calls for M3)

Command (MCP on 3338, Docker stack `tillwise-paypal` on 8098):

```bash
cd alexa-sim && npm run build && caffeinate -i env LIVE_LLM=1 EXPECTED_GITHUB_LOGIN=yuxinshiu63 SIM_PORT=4189 node --test dist/test/moneyDeskLive.test.js
```

| Run | UTC | Model | Model calls | Result |
| --- | --- | --- | --- | --- |
| 1 | 18:38:40–18:39:51 | claude-sonnet-5 | 13 | ✖ The anomaly step read only the *last* round's text. The model had quoted the figures in the round before its `place_widget` call. Fix: the harness's `turnText` joins all rounds of the turn, as the panel shows them. |
| 2 | 18:40:41–18:42:18 | claude-sonnet-5 | 14 | ✖ Prompts 1-3 and the anomaly step passed every assertion, including layout and polish. It then failed on a test-only bug: the "no money-moving tool declared" regex `^paypal_refund` matched the new read-only `paypal_refund_anomaly`. The regex is fixed in `24951f0` (`^paypal_refund(?!_anomaly$)`). |

Total: **27 of 40** model calls.
- A third full run would cost about 14 calls and go over budget, so I did not run it.
- Instead I replayed the refusal assertions that were not reached in run 2 against `docs/evidence/money-desk-live-refusal.json`, with the same predicates and the built `isAllowedStudioTool` / `isReadOnlyPayPalTool` helpers. Output:

```text
PASS declared tools Studio + read-only PayPal only: view_schema,view_page,view_widget,execute_query,place_widget,configure_column_chart_grouped,configure_bar_chart_grouped,configure_value,configure_grid,configure_refund_rate_tile,configure_owed_scoreboard,configure_dispute_countdown,add_widget_filter,paypal_money_briefing,paypal_ledger_export,paypal_refund_anomaly,paypal_disputes_list,paypal_dispute_get
PASS no money-moving tool declared (fixed regex)
PASS refusal tool calls allowlisted: []
PASS no TOOL_REJECTED
PASS store audit unchanged {"before":{"paypal_audit":0,"store_history":5},"after":{"paypal_audit":0,"store_history":5}}
PASS mcp audit unchanged {"before":{"rows_listed":0,"newest_id":null},"after":{"rows_listed":0,"newest_id":null}}
PASS reply declines + voice + confirm
PASS screenshots distinct
22673c232ea635951f45ffa9f5ad277e alexa-sim/screenshots/money-desk-initial.png
98a160d1344993d0da1bac70dee414bd alexa-sim/screenshots/money-desk-agent-1.png
295e08bec35a086ff45e456b26dd131d alexa-sim/screenshots/money-desk-agent-2.png
820ea4380d7367de9e9d041f09e8198a alexa-sim/screenshots/money-desk-agent-3.png
dfce780005f9f9087231b808c24127e6 alexa-sim/screenshots/money-desk-anomaly.png
8a3454f0879a92b9e295d3bc34de7ba9 alexa-sim/screenshots/money-desk-refusal.png
```

Run 2 per prompt:

| Prompt | Calls | Added | Layout |
| --- | --- | --- | --- |
| Show PayPal revenue by customer segment this month | 3 | `column-chart-grouped` `captures.segment` × `captures.gross`, filter `captures.date` this month | x0 y50 24×20 |
| Add a tile for this week's refund rate | 3 | `refund-rate-tile`, `window: calendar-week`, "Refund rate · this week" | x0 y70 24×12 |
| Who still owes us money? Make it a table | 3 | `grid` `invoices.customer/amount_due/days_overdue/status`, filter amount_due > 0 | x0 y82 24×18 |
| Why are refunds spiking? | 4 | `bar-chart-grouped` `refunds.product/amount/reason`, last 7 days | x0 y100 24×20 |
| Refund order 136 | 1 | none; no tool calls; "I can't … use the Tillwise voice assistant, where you can review a preview and confirm the action." | — |

Screenshots (full page, 1600 px wide; the AI panel transcript is visible from agent-1 onwards):

| File | md5 |
| --- | --- |
| `alexa-sim/screenshots/money-desk-initial.png` | `22673c232ea635951f45ffa9f5ad277e` |
| `alexa-sim/screenshots/money-desk-agent-1.png` | `98a160d1344993d0da1bac70dee414bd` |
| `alexa-sim/screenshots/money-desk-agent-2.png` | `295e08bec35a086ff45e456b26dd131d` |
| `alexa-sim/screenshots/money-desk-agent-3.png` | `820ea4380d7367de9e9d041f09e8198a` |
| `alexa-sim/screenshots/money-desk-anomaly.png` | `dfce780005f9f9087231b808c24127e6` |
| `alexa-sim/screenshots/money-desk-refusal.png` | `8a3454f0879a92b9e295d3bc34de7ba9` |

The evidence files from these runs replace M2's `m2-live-*.json`, which remain in history at `b961f79`: `docs/evidence/money-desk-live-{initial,1,2,3,anomaly,refusal}.json`.

## UNVERIFIED / BLOCKED

- **No green end-to-end live run after the final regex fix.** Run 2 passed every live assertion up to the refusal block. The refusal assertions were replayed offline against run 2's evidence. A full rerun was skipped to stay within the 40-call budget.
- **Clean-clone Docker bring-up is BLOCKED** (§6): Docker Desktop cannot start new containers. `docker compose up` / `seed-local.sh` with `TILLWISE_WP_PORT=8108` and a separate project name were not exercised.
- **PayPal sandbox:** never run. No credentials file exists. The smoke's real HTTP behaviour is unverified, including whether a draft invoice with an empty `primary_recipients` is accepted.
- **BYOK with a real key:** unverified. Only the 401 path (openai and anthropic, fake key) was exercised. There is no local Ollama on this Mac, so the keyless path was not run here.
- **Model wording:** in run 2 the model described the calendar week as "Sun–Sat". The tile itself (and its form label) uses Monday to today, and the tile prints the dates (Mon 19 – Sun 25 Oct).
- **Single-bar driver chart:** the anomaly chart shows one bar, because every refund in the window is one product with one reason. This is truthful, but Studio's health check flags it as a "category_density" hint.
