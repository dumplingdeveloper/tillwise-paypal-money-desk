# Demo video script (M5 prep, not rendered yet)

The target is under 3 minutes, because judges are not required to watch past three minutes (submission/RULES_EXCERPTS.md).
The renderable form of this script is the scene file `video/scenes/m5-money-desk.json`. Every `say` line below is copied from it.

The video has not been rendered and the `video/` node_modules are not installed. The timings below are estimates. The exact length is known only after a dry run or a render (see "How to render").

## Scenes

| # | Time (est.) | Screen | Narration / spoken line |
| --- | --- | --- | --- |
| 1 | 0:00–0:12 | Voice simulator (`/?demo=1`), idle | NARRATOR: "Small shop owners take payments with PayPal, but refunds, disputes and unpaid invoices live in five different screens. Tillwise is a store agent they can simply talk to." |
| 2 | 0:12–0:30 | Owner types and speaks; the agent answers live | OWNER: "Good morning, how's the shop doing today?" The live answer is spoken in the ASSISTANT voice, and its wording comes from the model. |
| 3 | 0:30–0:55 | Refund preview card, then confirmation | OWNER: "Refund order 136." NARRATOR: "Money never moves on a guess. The PayPal refund is previewed first, and nothing happens until the owner confirms." OWNER: "Yes." |
| 4 | 0:55–1:05 | "Under the hood" panel opened | NARRATOR: "Under the hood, every MCP tool call is visible: preview, confirmation, then the PayPal apply call and its audit row." |
| 5 | 1:05–1:20 | Money Desk (`/money-desk.html`), seeded AG Studio canvas | NARRATOR: "This is the Money Desk, built inside AG Studio. Built-in charts and grids sit next to three custom widgets: refund rate, who still owes us, and dispute deadlines. All of it is read from PayPal through our MCP server." |
| 6 | 1:20–2:05 | The question is typed into Studio's own AI panel; a new chart appears and is scrolled into view | OWNER: "Why are refunds spiking?" NARRATOR: "Studio's AI panel runs on the GitHub Copilot SDK. The model reads a read-only refund anomaly tool, quotes its figures, and adds a chart of refunds per day by reason, so the damaged mug shipments stand out against the weeks before." |
| 7 | 2:05–2:30 | The refund request is typed into the Studio AI panel | OWNER: "Refund order 136." NARRATOR: "The Studio agent has no money-moving tools at all, so it declines and points back to the confirmed voice flow." |
| 8 | 2:30–2:40 | Outro card (added by compose.js) | NARRATOR: "Tillwise and PayPal. Talk to your shop, see your money, and stay in control of every refund." |

Model latency between steps is compressed by the pipeline's `maxSilenceMs: 1500`. The compressed stretches are marked "⏩ fast-forward" (video/README.md, "Live scenes support honest dead-air compression"). The real latencies are written to `video/out/compose-report.json`.

## Honesty notes for the narration

- PayPal runs in **mock mode** in this video unless `~/.config/tillwise/paypal-sandbox.env` exists. If the render is done in mock mode, add a `caption` step saying "PayPal mock mode (deterministic data)". Never call it sandbox or live.
- Scene 6 depends on the model. The scene waits for the 8th widget frame (`… .ag-studio-layout-widget >> nth=7`) and fails loudly if the model adds no widget (video/README.md: "`waitFor` fails loudly"). Re-record in that case; do not edit the footage.
- The figures quoted on screen come from `paypal_refund_anomaly`, not from the narration. The narration names no numbers on purpose, because the data anchor moves with the date.
- No music. No third-party logos beyond the product names in the UI text.

## How to render (later; not run now)

Prerequisites:
- The tillwise-paypal Docker stack is up on 8098.
- The MCP server is running on 3338: `cd mcp-server && npm run build && npm start`.
- The simulator is running with the logged-in Copilot account (or BYOK), e.g. `cd alexa-sim && SIM_PORT=4189 npm start`.

```bash
cd video
npm ci                                   # installs kokoro-js, @huggingface/transformers, playwright-core (not done yet)
# 1. validate selectors, voices and the estimated duration (<170 s) without recording
npm run video -- --dry-run --scene scenes/m5-money-desk.json --url http://127.0.0.1:4189
# 2. preflight (/api/status must report login and model), demo reset, TTS, record, compose
npm run record:live -- --scene scenes/m5-money-desk.json --url http://127.0.0.1:4189
```

`record:live` (video/scripts/record-live.js):
1. checks `GET /` and `/api/status`;
2. runs `scripts/demo-reset.sh`;
3. checks `#text`, `#send` and `#hoodToggle` on `/?demo=1`;
4. runs `tts.js`, then `record.js`, then `compose.js`.

Outputs are `video/out/demo.mp4` (1080p, burned-in subtitles), `preview.gif`, sample frames and JSON reports (video/README.md, "Outputs").

## UNVERIFIED

- The scene file has never been dry-run or rendered. Things that could break:
  - the step actions used (`goto` twice, `type`/`click` on the AG Studio panel, `>> nth=7` in a `waitFor` selector);
  - the voice flow for "Refund order 136." producing the `.confirm` card that the `confirm` step waits for.
- The total duration is an estimate from word counts (about 190 narration words, two live answers and the typing time). The dry run prints the pipeline's own estimate.
