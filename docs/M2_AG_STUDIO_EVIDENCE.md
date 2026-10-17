# M2 AG Studio evidence

## AG Studio APIs used

- `alexa-sim/public/money-desk.js` uses the UMD global `window.agStudio` served from the installed `ag-studio@3.0.0` package. User-provided licensing fact applies: AG Studio can be tested locally without a license; this repo does not commit a license key.
- `money-desk.js` calls `createWidgets` for three custom widget definitions. Evidence: https://www.ag-grid.com/studio/javascript/custom-widgets.md line 19 says “Custom widgets add application-defined widgets to AG Studio”; lines 184-190 say custom widgets are provided through the `widgets` property and `createWidgets(params)`.
- `money-desk.js` calls `createStudioWithAi`/`createStudio` with `mode: 'edit'`, data sources, initial layout, widgets, and an AI harness. Evidence: https://www.ag-grid.com/studio/javascript/ai.md line 17 says the Studio Agent Framework lets users “build or modify dashboards using natural language”; lines 111-120 show `ai: ({ api }) => createAiHarness(...)` and `createStudio(studioDiv, studioProperties)`.
- `money-desk.js` configures `createAiHarness` with a declared `money-agent`. Evidence: https://www.ag-grid.com/studio/javascript/ai-harness.md line 23 says the harness manages the conversation, agents, and UI state; line 36 says AG Studio ships a harness built with `createAiHarness`.
- `money-desk.js` uses `clientToolRunner` for the Money agent. Evidence: https://www.ag-grid.com/studio/javascript/ai-client-tool-runner.md line 23 says a client tool runner answers one turn at a time; lines 34-39 show `clientToolRunner({ ... tools: () => [...], run: async function* (...) })`.
- `money-desk.js` lists only read-only Studio tools for the Money agent: `viewSchema`, `executeQuery`, and `viewPage`. Evidence: https://www.ag-grid.com/studio/javascript/ai-custom-agents.md lines 239-239 state “A read-only analyst: it can look and answer, but not touch the page” with `tools: () => [studio.viewSchema(), studio.viewPage(), studio.executeQuery()]`.

## Money-moving isolation

- Studio endpoint `/api/studio-agent/widgets` returns `readOnlyTools: ['paypal_money_briefing', 'paypal_disputes_list', 'paypal_dispute_get']` and `forbiddenTools` containing PayPal mutation tools. The browser log records those read-only tools. Money-moving MCP tools remain only in the voice/chat permission gate.

## Screenshot evidence

- `alexa-sim/screenshots/money-desk-overview.png`
- `alexa-sim/screenshots/money-desk-agent-widgets.png`

The Playwright capture returned three pass widgets: Refund-rate tile, Who still owes, and Dispute deadline countdown.
