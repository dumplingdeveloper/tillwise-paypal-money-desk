# Demo video script (M5 draft rendered in mock mode)

The target is 2:30–2:50 and the hard limit is under 3 minutes, because judges are not required to watch past three minutes (submission/RULES_EXCERPTS.md).

The renderable form of this script is the scene file `video/scenes/m5-money-desk.json`. Every spoken line below is copied from it.

A draft was rendered on 2026-10-26: 156.1 s. The render record, frames, model-call counts and known mismatches are in `docs/VIDEO_RENDER.md`. The times below are from that render's `out/compose-report.json` (4 s intro card included).

## Scenes

| # | Time (draft) | Screen | Narration / spoken line |
| --- | --- | --- | --- |
| 0 | 0:00–0:04 | Intro card (compose.js): "PayPal AI Hackathon · draft demo", "Tillwise × PayPal" | none |
| 1 | 0:04–0:22 | Voice simulator (`/?demo=1`) with the badge "PayPal: mock mode · demo data, not a PayPal account" | NARRATOR: "Small shop owners take payments with PayPal, but refunds, disputes and unpaid invoices live in different screens. Tillwise is a store agent they can simply talk to. In this demo, PayPal runs in mock mode, on deterministic demo data." |
| 2 | 0:22–0:36 | Owner asks; the live model previews the refund | OWNER: "Refund order {{ORDER_ID}}." The ASSISTANT answer is live model output (draft: "The refund preview is ready for EUR 31.00. Say yes to move the money."). |
| 3 | 0:41–1:06 | Owner says go ahead → the host's confirmation card → yes → refund applied | NARRATOR: "Money never moves on a guess. The refund is previewed first, and when the owner says go ahead, the host asks once more before the PayPal call is made." OWNER: "Yes, go ahead." HOST: the confirmation question. OWNER: "Yes." ASSISTANT: live result. |
| 4 | 1:08–1:19 | "Under the hood" panel: preview → permission → apply | NARRATOR: "Under the hood, every MCP tool call is visible: the preview, the confirmation, then the refund call to PayPal mock mode, and its audit row." |
| 5 | 1:20–1:39 | Money Desk (`/money-desk.html`), seeded AG Studio canvas; header says "mock ledger (demo data, not PayPal)" | NARRATOR: "This is the Money Desk, built inside AG Studio. Built-in charts and grids sit next to three custom widgets: refund rate, who still owes us, and dispute deadlines. The rows come through our MCP server from the PayPal tools, here on the mock ledger." |
| 6 | 1:40–2:04 | The question is typed into Studio's own AI panel; the agent answers from `paypal_refund_anomaly` and adds a chart, which is scrolled into view | OWNER: "Why are refunds spiking?" NARRATOR: "Studio's AI panel runs on the GitHub Copilot SDK. The model reads a read-only refund anomaly tool, quotes its figures, and adds a chart of refunds per day by reason, so the damaged mug shipments stand out against the weeks before." |
| 7 | 2:07–2:23 | The refund request is typed into the Studio AI panel | OWNER: "Refund order {{ORDER_ID}}." NARRATOR: "The Studio agent has no money-moving tools at all, so it declines and points back to the confirmed voice flow." |
| 8 | 2:23–2:36 | Closing line, then the outro card: "Draft render…", "PayPal ran in mock mode here: deterministic demo data, not a PayPal account. The Alexa+ experience simulator is an unofficial demo, not an Amazon product." | NARRATOR: "Tillwise and PayPal. Talk to your shop, see your money, and stay in control of every refund." |

`{{ORDER_ID}}` is replaced by `video/scripts/resolve-scene.js --order <id>` after the demo reset, because the reset recreates the seed orders with new ids. The draft used order 360.

Model latency between steps is compressed above `maxSilenceMs: 5000`. Compressed stretches are marked "⏩ fast-forward" (video/README.md). The real latencies are in `out/compose-report.json` (`stepLatencies`).

## Honesty notes

- PayPal runs in **mock mode** in this video. It is said in scene 1, shown in the voice-sim badge and the Money Desk header, and written on the outro card. Never call it sandbox or live. A sandbox version needs `~/.config/tillwise/paypal-sandbox.env`, `npm run sandbox:seed` and a new recording with new narration.
- Scenes 2, 3, 6 and 7 are live model output.
  - The scene waits for the confirmation card (scene 3) and for the 8th widget frame (scene 6: `… .ag-studio-layout-widget >> nth=7`). It fails loudly if they do not appear.
  - Re-record in that case; do not edit the footage.
- The figures on screen come from `paypal_refund_anomaly` and the ledger export, not from the narration. The narration names no numbers on purpose, because the data anchor moves with the date.
- No music. No third-party logos beyond the product names in the UI text.

## How to render

See `docs/VIDEO_RENDER.md` → "Exact commands" (the step-by-step commands used for the draft).

The one-command alternative after the demo reset and scene resolution is:

```bash
npm run video -- --scene out/m5-money-desk.resolved.json --url http://127.0.0.1:4189
```

That runs tts, record and compose in one go.

## Before the final render

The draft shows three issues that were fixed in code after the recording (details in `docs/VIDEO_RENDER.md`):
1. the generic host question;
2. a "last 14 days" chart that plots 45 days;
3. a 7.3% vs 7.4% baseline difference between the tile and the agent.

A new recording is needed to show the fixed versions: about 9–10 model calls, on AC power.
