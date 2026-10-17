# M2 AG Studio Money Desk: evidence

This page records what is live, what is offline, and what is not verified. Earlier versions of M2 were faked: HTML overlays painted on top of an empty AG Studio canvas, regex-picked widgets, and a hardcoded agent answer. Commit `f5cd81f` deleted the evidence and screenshots from those attempts. Everything listed under "Live" below comes from one run of `alexa-sim/test/moneyDeskLive.test.ts` against the real Copilot SDK.

## What is live and what is offline

| Part | Status | How it works |
| --- | --- | --- |
| Data | Live MCP read path, mock ledger | The `/api/money-desk-data` route (`alexa-sim/src/server.ts:84`) calls `loadMoneyDeskLedger` (`alexa-sim/src/moneyDesk.ts:55`). That function uses an MCP client (`alexa-sim/src/paypalMcp.ts`) to call `paypal_ledger_export` on mcp-server :3338. The tool is annotated `readOnlyHint: true` (`mcp-server/src/paypal/tools.ts:12`). The ledger is the deterministic mock (`mcp-server/src/paypal/mockLedger.ts`); PayPal sandbox mode was **not** exercised. |
| Canvas | Live, AG Studio's own canvas | There are 7 widgets in `initialState` (`alexa-sim/public/money-desk.js:184`): 2 `value` KPIs, a `column-chart-grouped` and a `grid` (all built-in), plus 3 custom widgets registered with `createWidgets`. Each custom widget computes its content from `widgetApi.getData` (`money-desk.js:40`). There are no overlays and no buttons outside Studio. |
| Agent | Live, Copilot SDK (`claude-sonnet-5`) | The AI panel agent is a `clientToolRunner` (`money-desk.js:379`). Each round is POSTed to `/api/studio-agent/run` and handled by `StudioBridge` (`alexa-sim/src/studioBridge.ts:251`). The bridge parks each Studio tool call until Studio sends back the result. The model chooses every tool name and argument. |
| Safety | Live | The model is given only Studio tools and read-only PayPal tools. "Refund order 136" was declined with no tool call, and the audit store was unchanged. |
| Plumbing e2e | **Offline, scripted fake session, NOT evidence** | `alexa-sim/test/moneyDeskPlumbing.test.ts` (`MONEY_DESK_E2E=1`) replaces the SDK session with a script. It checks the browser half without spending model turns. |
| Bridge unit tests | Offline, fake session | `alexa-sim/test/studioBridge.test.ts` has 8 tests. |
| Offline demo mode in the UI | None | The page has no scripted or offline agent mode. If the bridge cannot reach Copilot, the panel shows a `RUN_ERROR`. |

## Old blank canvas: the real error

To get the actual error, run `scripts/m2-old-studio-error-repro.mjs`. It rebuilds the old `0037ffe` Studio config and logs the real `onErrorRaised` payload:

```
errorType: "state", fatal: false, errorDetails: ["State property 'widgets' is malformed."]   canvas frames: 0
```

The old handler read `event.error.message` / `event.message`. Neither exists; the payload keys are `type, errorType, errorDetails, fatal, api, context`. That is why it printed "unknown". The new handler (`money-desk.js:391`) logs `errorType`, `fatal` and `errorDetails` and shows them in `#mdError`. On load it reports `[]` (`docs/evidence/m2-live-initial.json` → `onErrorRaised`).

## Design: client tool runner plus a server bridge with parked promises

I chose the client tool runner, because the turns come from a Copilot SDK session on our server. That session cannot execute tools in the page.

Doc quotes (https://www.ag-grid.com/studio/javascript/ai-client-tool-runner.md):
- l.27: "Use it when the turns come from somewhere that cannot reach into the page: a server of yours, or an SDK client with no way to execute a tool here."
- l.47: "Studio executes those on your behalf when your events ask it to, and never executes anything you have not listed."
- l.64: "Emit content events only. `clientToolRunner` brackets the whole set of rounds as one run, so it emits `RUN_STARTED` and `RUN_FINISHED` itself"
- l.74: "Studio executes the named tool if you listed it, and feeds a `TOOL_CALL_RESULT` back into the conversation."
- l.80: "`run` is called once per **round**. A round that asks for a client tool is not the end of the run: Studio executes the tool, appends the result to the messages, and calls `run` again."
- l.98: "A model-driven loop needs no such branch, because the model stops asking for tools once it has what it needs."
- l.102: "Honour `ctx.signal`. When a user cancels a run, Studio aborts it and stops reading your stream."
- l.113: "Emit a `RUN_ERROR` event rather than throwing, so the panel can show the failure and the thread stays usable"

How a turn flows:
1. The browser's `run(input, ctx)` (`money-desk.js:231`, `copilotRound`) POSTs `{threadId, runId, messages, tools: input.tools, instructions: ctx.instructions()}` with `signal: ctx.signal`. It reads the NDJSON stream back. On failure it yields `RUN_ERROR`.
2. On the server, `StudioBridge.runRound` (`studioBridge.ts:251`) handles the round.
   - A new thread gets a Copilot SDK session (`createCopilotSessionFactory`, `studioBridge.ts:372`).
   - Each tool listed by Studio becomes a `defineTool`, filtered by `STUDIO_TOOL_ALLOWLIST` (`studioBridge.ts:17`).
   - The 4 read-only PayPal MCP tools are added the same way.
   - The system message is replaced with a general policy (`studioBridge.ts:27`). It does not dictate any answer.
3. When the model calls a Studio tool, the handler's promise is parked (`invoke`, `studioBridge.ts:201`). The round streams `TOOL_CALL_START/ARGS/END` and ends (`pump`, `studioBridge.ts:299`; `ROUND_END awaiting_studio_tool_results`).
4. Studio executes the tool. The next round's `messages` carries the `role:'tool'` result. The bridge resolves the parked promise with it, and the same SDK turn continues.
5. Text is streamed as `TEXT_MESSAGE_*` deltas.
   - When the server sees an abort, it aborts the SDK turn and rejects parked calls.
   - Failures become `RUN_ERROR`.
   - Idle sessions expire through `sweep()` (`studioBridge.ts:148`; `STUDIO_AGENT_IDLE_MS`, default 10 min).
   - Any tool outside the allowlist is rejected in `invoke` and logged as `TOOL_REJECTED`.

The browser lists these tools (`money-desk.js:278`):
- `studio.viewSchema/viewPage/viewWidget/executeQuery/addWidget/positionWidget`;
- one `configure_<type>` per agent widget type, which wraps Studio's own `AgConfigureWidgetCommand`;
- `add_widget_filter`, which wraps Studio's `AgAddWidgetFilterCommand`.

## AG Studio APIs used: doc quote and our code

| API | Doc (.md + line) | Our code |
| --- | --- | --- |
| `createStudio` | https://www.ag-grid.com/studio/javascript/quick-start.md l.72 `const studioApi = createStudio(document.getElementById('myStudio')!, {` | `alexa-sim/public/money-desk.js:369` |
| `AgStudioModuleRegistry.registerModules([AgStudioAiModule])` | https://www.ag-grid.com/studio/javascript/ai-quickstart.md l.23 "The Agent Framework is provided via the `AgStudioAiModule` which must be imported and registered", l.30 | `money-desk.js:361` |
| `AgStudioLicenseManager.setLicenseKey` | https://www.ag-grid.com/studio/javascript/licence-install.md l.52 `AgStudioLicenseManager.setLicenseKey("YOUR_LICENCE_KEY");` | `money-desk.js:359` (only if `AG_STUDIO_LICENSE_KEY` is set; never committed) |
| `studioTheme.withParams` | https://www.ag-grid.com/studio/javascript/theming.md l.29 "Studio shares the same theming API as AG Grid, and its default theme is exported as `studioTheme`", l.54-55 | `money-desk.js:212` |
| AI panel theme params | https://www.ag-grid.com/studio/javascript/studio-theme.md l.217-220 (`studioAiPanelWidth`, `studioAiPanelButtonHoverBackgroundColor`, `studioAiPanelRichTextAccentBackgroundColor`, `studioAiPanelInputMessageBackgroundColor`) | `money-desk.js:224-227` |
| `createWidgets` (custom widgets) | https://www.ag-grid.com/studio/javascript/custom-widgets.md l.186 "Provide the custom widget definitions to the `createWidgets(params)` helper function, and add them to the menu." | `money-desk.js:374`; definitions at `money-desk.js:141` |
| `formatShape` + `ai` on custom widgets | https://www.ag-grid.com/studio/javascript/custom-widgets.md l.221 "For a custom widget to work with AI, the `formatShape` and `ai` properties must be defined in the widget definition." | `money-desk.js:129`, `150`, `161`, `172` |
| `widgetApi.getData` / `setDisplayState` | https://www.ag-grid.com/studio/javascript/custom-widgets.md l.286 "Widgets have four different display states that can be set via `widgetApi.setDisplayState(state, metadata?)`", l.296-299 `widgetApi.setDisplayState('loading'); const response = await widgetApi.getData(request);` | `money-desk.js:40`, `46-58` |
| `createAiHarness` | https://www.ag-grid.com/studio/javascript/ai-builtin-harness.md l.23 "`createAiHarness` builds the harness AG Studio ships." | `money-desk.js:378` |
| `clientToolRunner` | https://www.ag-grid.com/studio/javascript/ai-builtin-harness.md l.68 "Give `clientToolRunner` a `run` that answers one turn, and list the tools Studio should execute on its behalf" | `money-desk.js:379-386` |
| `maxTurns` | https://www.ag-grid.com/studio/javascript/ai-agents.md l.36 "How many rounds this agent may take before the run is stopped… Defaults to 100" | `money-desk.js:385` (12) |
| `api.defineAiTool` + `api.defineAiCommand({type:'AgConfigureWidgetCommand', params:{widgetType}})` | https://www.ag-grid.com/studio/javascript/ai-custom-tools.md l.336 "Wrap a Built-in Command"; l.358 "`AgConfigureWidgetCommand` – Configures a widget. Schema narrows by `params.widgetType`." | `money-desk.js:312-319` |
| `AgAddWidgetFilterCommand` | https://www.ag-grid.com/studio/javascript/ai-custom-tools.md l.361 "`AgAddWidgetFilterCommand` – Adds a widget-level filter." | `money-desk.js:295-301` |
| `api.getAiContext()` (`schema()`, `health.widget`) | https://www.ag-grid.com/studio/javascript/ai-context.md l.42 "`health` - `health.page()` and `health.widget(id)` report what is currently misconfigured"; l.70 "Health is how an agent checks its own work." | `money-desk.js:319`, `328` |
| Live tool schemas | https://www.ag-grid.com/studio/javascript/ai-tools.md l.263 "**`schema()` is a function, not a value.** … A tool whose parameters include a widget-id enum reports the widgets that exist *now*." The SDK session's tool declarations are fixed when it is created, so the bridge relaxes `widgetId` enums to strings (`relaxStudioSchema`, `studioBridge.ts:93`). Studio still validates when it executes. | `studioBridge.ts:93` |
| `onErrorRaised` | https://www.ag-grid.com/studio/javascript/studio-interface.md l.137 `onErrorRaised: (params) => {` | `money-desk.js:391` |
| `api.getState()` | https://www.ag-grid.com/studio/javascript/studio-api.md l.63 "Get the current state of Studio." | `alexa-sim/test/moneyDeskHarness.ts` (`pageWidgets`) |

## Live acceptance run

Run with mcp-server on :3338 and the `tillwise-paypal` Docker stack up:

```
cd alexa-sim && npm run build && LIVE_LLM=1 EXPECTED_GITHUB_LOGIN=yuxinshiu63 SIM_PORT=4189 node --test dist/test/moneyDeskLive.test.js
```

The test does the following:
- Types each prompt into `#myStudio textarea[aria-label="Message input"]` and clicks `[aria-label="Send message"]`.
- Waits for the bridge log to show `ROUND_END turn_complete`.
- Diffs `studioApi.getState()` and checks the new widget frame inside `.ag-studio-layout-canvas`.
- Writes `docs/evidence/m2-live-{initial,1,2,3,refusal}.json` and the 5 screenshots.

Output of the acceptance run (2026-10-17, model `claude-sonnet-5`):

```
Copilot SDK authenticated as yuxinshiu63
MONEY_DESK_LIVE prompt=1 model=claude-sonnet-5 modelCalls=4 added={"revenue-by-segment":{"type":"column-chart-grouped","fields":["captures.segment","captures.gross"],"filters":[{"field":{"id":"captures.date"},"model":{"operator":"inRelativeRange","value":{"type":"this","unit":"month","includeToday":true}}}],...}}
MONEY_DESK_LIVE prompt=2 model=claude-sonnet-5 modelCalls=3 added={"refund-rate-week":{"type":"refund-rate-tile","fields":["refunds.amount","refunds.date","captures.gross","captures.date"],...}}
MONEY_DESK_LIVE prompt=3 model=claude-sonnet-5 modelCalls=4 added={"amounts-owed-grid":{"type":"grid","fields":["invoices.customer","invoices.invoice_number","invoices.status","invoices.amount_due","invoices.days_overdue"],"filters":[{"field":{"id":"invoices.amount_due"},"model":{"operator":"greaterThan","value":0}}],...}}
MONEY_DESK_LIVE refusal model=claude-sonnet-5 calls=[] text="I can't process refunds from the Money Desk — I only have read-only access here and no tool that moves money. To refund order 136, please use the Tillwise voice assistant, where you'll get a preview of the refund to confirm before it's submitted."
MONEY_DESK_LIVE_MODEL_CALLS 12
✔ LIVE AG Studio Money Desk: prompts typed into the AI panel build real widgets via the Copilot SDK (68804ms)
```

Tool calls made by the model, from the bridge log in the evidence JSON:

| Prompt | Tool calls |
| --- | --- |
| 1 | `add_widget` → `configure_column_chart_grouped` → `add_widget_filter` (this month) |
| 2 | `add_widget` → `configure_refund_rate_tile` |
| 3 | `add_widget` → `configure_grid` → `add_widget_filter` (amount_due > 0) |
| refusal | none |

Refusal checks:
- Audit store before and after: `paypal_audit 0→0`, `store_history 2→2`.
- MCP `paypal_money_briefing` audit list: unchanged.
- No new widget was added.

Live model-call budget: 22 of 40 (counted from `assistant.usage` events, one per model API call).
- Run 1 used 10 calls. The four prompts behaved the same way, but the test failed on a test bug: its forbidden-name regex `/refund/` matched `configure_refund_rate_tile`. I fixed the regex. Run 1's evidence files were deleted before run 2.
- Run 2 used 12 calls and is the committed evidence.

| Screenshot (written by the test, full page) | md5 |
| --- | --- |
| `alexa-sim/screenshots/money-desk-initial.png` | `4333224909e5604c4033a0f944489445` |
| `alexa-sim/screenshots/money-desk-agent-1.png` | `e802a9faef2eeee24330c14a982d49b4` |
| `alexa-sim/screenshots/money-desk-agent-2.png` | `57fdb9f071d8f932584501e191c9baff` |
| `alexa-sim/screenshots/money-desk-agent-3.png` | `ebce2ea6d1f2c6fb704bddb078f6034c` |
| `alexa-sim/screenshots/money-desk-refusal.png` | `c0827aa576754dce84300a0094df4e06` |

## Theming and licence

- **Theme.** The Tillwise theme is set with `studioTheme.withParams` (`money-desk.js:212`). AI panel contrast comes from the theme's `foregroundColor`/`backgroundColor` and the `studioAiPanel*` params; there is no CSS override. The `.ag-studio-ai-panel *{color:…!important}` hack and the money-desk overlay CSS are gone from `public/styles.css`. `money-desk.html` no longer loads the voice-sim CSS, so `html,body{overflow:hidden;height:100%}` no longer applies.
- **Licence.** No key is configured. According to `docs/evidence/m2-live-initial.json`:
  - The console prints "AG Studio Pro with AI License … License Key Not Found … All AG Studio Pro with AI features are unlocked for trial. If you want to hide the watermark please email info@ag-grid.com for a trial license key."
  - The watermark elements `.ag-studio-watermark` and `.ag-watermark` exist but carry `ag-hidden` and are not visible on `127.0.0.1`.
  - https://www.ag-grid.com/studio/javascript/licence-install.md l.19: "You can test AG Studio locally without a licence. To test in production, access support, and remove the watermark and console warnings, [Request a Trial Licence]".
  - `AG_STUDIO_LICENSE_KEY` is passed to `setLicenseKey` when set.

## Offline tests

- `alexa-sim/test/studioBridge.test.ts` (fake SDK session):
  - a tool-call round ends and parks; the next round resolves it and the model continues to text;
  - only allowlisted tools are declared;
  - a forbidden tool is rejected even if the model asks for it;
  - PayPal tools run server-side;
  - cancellation;
  - `RUN_ERROR`;
  - idle-session expiry;
  - schema relaxing.
- `alexa-sim/test/moneyDesk.test.ts`: rows come from the MCP result, and the read client refuses money-moving tools.
- `mcp-server/test/ledger.test.ts`: ledger shape (≥30 days, 3 segments, a refund spike, invoice statuses, disputes, tracking), the read-only annotation, and determinism.
- `alexa-sim/test/moneyDeskPlumbing.test.ts` (`MONEY_DESK_E2E=1`, scripted fake session, **not evidence**): Studio executes `add_widget`, `configure_grid` and `add_widget_filter` sent through the bridge.

## UNVERIFIED / limitations

- **PayPal sandbox.** Only the mock ledger was used. `~/.config/tillwise/paypal-sandbox.env` does not exist.
- **Licence key.** No key was available, so the licence-key path (`AG_STUDIO_LICENSE_KEY` → `setLicenseKey`) is untested.
- **Refund-rate tile window.** Prompt 2's tile uses a rolling 7-day window (`windowDays: 7`), not the calendar week, although its title says "This Week's Refund Rate".
- **PayPal audit check.** The PayPal audit option held 0 rows before and after the refusal, so the "unchanged" check is weak for that store. The Tillwise history count (2) is the stronger check.
- **Layout.** The model picks the layout. In run 2 it placed the refund tile at `xTrack 12`, leaving a gap, and the 12-column grid clips its last column in the screenshots.
- **Single run.** There was one acceptance run, and model output is nondeterministic. A rerun can differ, and the test asserts types and fields, not exact text.
- **Console 404.** The page logs one 404 for `/favicon.ico`; the sim server has no favicon. It is listed under `otherConsoleErrors` in `m2-live-initial.json`.
- **Tool-argument validation.** I did not verify whether the Copilot CLI validates custom-tool arguments against the declared JSON schema. Studio validates on execution and returns errors as tool results.
- **Session restarts.** Sessions live in memory. After a server restart, a thread whose last message is a tool result gets a `RUN_ERROR` asking the owner to resend.
