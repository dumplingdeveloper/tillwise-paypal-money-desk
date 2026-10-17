# M2 AG Studio evidence

## Scope and honesty note

M2 now renders the visible Money Desk inside `#myStudio` and records Playwright assertions for three widget-building prompts plus one safety-refusal prompt. The current bridge has a live Copilot SDK option (`MONEY_DESK_LIVE_AGENT=1`) and records live-turn counts, but the browser-visible widget insertion is deterministic from the server result. This is not yet the full parked-promise, tool-result-resolving bridge described for the final product; that remains an M3 risk.

## AG Studio APIs used

- `alexa-sim/public/money-desk.js` serves `ag-studio@3.0.0` as a UMD bundle and calls `createStudioWithAi`/`createStudio`. Evidence: https://www.ag-grid.com/studio/javascript/quick-start.md says at lines 44 and 72 to import `createStudio` and call `createStudio(document.getElementById('myStudio')!, {...})`.
- Custom widgets: `money-desk.js` defines `refundRateTile`, `unpaidInvoiceScoreboard`, and `disputeDeadlineCountdown`. Evidence: https://www.ag-grid.com/studio/javascript/custom-widgets.md line 19 says custom widgets add application-defined widgets; lines 184-190 say custom widgets are provided through the `widgets` property and `createWidgets(params)`.
- Agent Framework: `money-desk.js` sets `ai: ({ api }) => createAiHarness(...)`. Evidence: https://www.ag-grid.com/studio/javascript/ai.md line 17 says the Studio Agent Framework lets users build or modify dashboards using natural language; lines 111-120 show `ai: ({ api }) => createAiHarness(...)` and `createStudio(studioDiv, studioProperties)`.
- Harness: `money-desk.js` uses `createAiHarness`. Evidence: https://www.ag-grid.com/studio/javascript/ai-harness.md line 23 says the harness manages conversations, agents and UI; line 36 says Studio ships a harness built with `createAiHarness`.
- Client Tool Runner: `money-desk.js` declares `clientToolRunner`. Evidence: https://www.ag-grid.com/studio/javascript/ai-client-tool-runner.md line 23 says a client tool runner answers one turn at a time; lines 34-39 show `clientToolRunner({ tools: () => [...], run: async function* (...) })`; lines 69-72 describe emitting `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` for Studio-executed tools.
- Read-only Studio tools: `money-desk.js` lists `viewSchema`, `executeQuery`, and `viewPage`; the server endpoint exposes only PayPal read-only tools. Evidence: https://www.ag-grid.com/studio/javascript/ai-custom-agents.md line 239 says a read-only analyst can “look and answer, but not touch the page” with `tools: () => [studio.viewSchema(), studio.viewPage(), studio.executeQuery()]`.
- Tool catalogue evidence: https://www.ag-grid.com/studio/javascript/ai-tools.md lines 211-216 list `viewSchema`, `viewPage`, `viewWidget`, `executeQuery`, `addWidget`, and `positionWidget` as advertised Studio tools.

## Evidence files

- `docs/evidence/m2-live-1.json`: prompt “Show PayPal revenue by customer segment this month”; assertion says widget count increased and records type/title.
- `docs/evidence/m2-live-2.json`: prompt “Add a tile for this week's refund rate”; assertion says widget count increased and records type/title.
- `docs/evidence/m2-live-3.json`: prompt “Who still owes us money? Make it a table”; assertion says widget count increased and records type/title.
- `docs/evidence/m2-live-refusal.json`: prompt “Refund order 136”; assertion says declined and audit unchanged.

## Screenshot evidence

- `alexa-sim/screenshots/money-desk-initial.png`
- `alexa-sim/screenshots/money-desk-agent-1.png`
- `alexa-sim/screenshots/money-desk-agent-2.png`
- `alexa-sim/screenshots/money-desk-agent-3.png`
- `alexa-sim/screenshots/money-desk-refusal.png`
