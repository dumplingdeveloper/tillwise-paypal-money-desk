# Demo video script (final mock-mode render)

The hard limit is under 3 minutes, because judges are not required to watch past three minutes (submission/RULES_EXCERPTS.md).

The renderable form of this script is the scene file `video/scenes/m5-money-desk.json`. Every spoken line below is copied from it.

The final mock-mode render was made on 2026-10-26: 162.1 s, md5 `774992c9af72c11e76f6e0b0e9c7e40f`. Its render record, frames, ASR check, model-call counts and known mismatches are in `docs/VIDEO_RENDER.md`. The times below come from that render's `out/compose-report.json`, including the 4 s intro card.

Presentation criterion ("Does the pitch communicate what problem is solved, who it's for, and why it matters?"): the intro card and the first narration sentence answer all three by about 15 s.

## Scenes

| # | Time | Screen | Narration / spoken line |
| --- | --- | --- | --- |
| 0 | 0:00–0:04 | Intro card: "PayPal AI Hackathon · mock-mode demo", "Tillwise × PayPal", "For small WooCommerce shops on PayPal: refunds, disputes and unpaid invoices in one conversation, and no money moves without the owner's yes.", "PayPal runs in mock mode in this video: demo data, not a PayPal account." | none |
| 1 | 0:04–0:28 | Voice simulator (`/?demo=1`) with the badge "PayPal: mock mode · demo data, not a PayPal account" | NARRATOR: "If you run a small WooCommerce shop on PayPal, refunds, disputes and unpaid invoices sit in separate screens, and one wrong refund costs real money. Tillwise is a store agent you simply talk to. It shows you the numbers, and it moves money only after you confirm. In this demo, PayPal runs in mock mode, on demo data." |
| 2 | 0:28–0:42 | Owner asks; the live model previews the refund | OWNER: "Refund order {{ORDER_ID}}." The ASSISTANT line is live model output (final render: "The refund preview is ready for 31 euros on order 416. Say yes to move the money."). |
| 3 | 0:47–1:17 | Owner says go ahead → host confirmation card → yes → refund applied | NARRATOR: "Money never moves on a guess. The refund is previewed first, and when the owner says go ahead, the host asks once more before the PayPal call is made." OWNER: "Yes, go ahead." HOST: "Refund €31.00 for order 416 through PayPal?" (spoken "31 euros"). OWNER: "Yes." ASSISTANT: live result. |
| 4 | 1:20–1:31 | "Under the hood" panel: preview → permission → apply | NARRATOR: "Under the hood, every MCP tool call is visible: the preview, the confirmation, then the refund call to PayPal mock mode, and its audit row." |
| 5 | 1:32–1:50 | Money Desk (`/money-desk.html`), seeded AG Studio canvas; header says "mock ledger (demo data, not PayPal)" | NARRATOR: "This is the Money Desk, built inside AG Studio. Built-in charts and grids sit next to three custom widgets: refund rate, who still owes us, and dispute deadlines. The rows come through our MCP server from the PayPal tools, here on the mock ledger." |
| 6 | 1:51–2:16 | The question is typed into Studio's own AI panel. The agent answers from `paypal_refund_anomaly` and adds a 14-day stacked chart with a legend, which is scrolled into view. | OWNER: "Why are refunds spiking?" NARRATOR: "Studio's AI panel runs on the GitHub Copilot SDK. The model reads a read-only refund anomaly tool, quotes its figures, and adds a chart of refunds per day by reason, so the damaged mug shipments stand out against the weeks before." |
| 7 | 2:18–2:28 | Same canvas with the agent's answer | NARRATOR: "The Studio agent is read-only: it has no tool that moves money. Refunds happen only in the voice flow, after a preview and the owner's yes." |
| 8 | 2:28–2:42 | Closing line, then the outro card: "Talk to your shop, see your money, confirm every refund.", "PayPal ran in mock mode here: deterministic demo data, not a PayPal account. The Alexa+ experience simulator is an unofficial demo, not an Amazon product." | NARRATOR: "Tillwise and PayPal. Talk to your shop, see your money, and stay in control of every refund." |

`{{ORDER_ID}}` is replaced by `video/scripts/resolve-scene.js --order <id>` after the demo reset, because the reset recreates the seed orders with new ids. The final render used order 416.

Model latency between steps is compressed above `maxSilenceMs: 5000`. Compressed stretches are marked "⏩ fast-forward" (video/README.md). The real latencies are in `out/compose-report.json` (`stepLatencies`).

Speech and captions:
- Money is spoken as words: `video/scripts/speakable.js` turns "EUR 31.00" into "31 euros" and "€2,083.77" into "2,083 euros and 77 cents". Captions keep the written form.
- The narrator has no caption label.
- Captions break at sentence and clause boundaries (`video/scripts/captions.js`).

## Honesty notes

- PayPal runs in **mock mode** in this video. It is written on the intro card, said in scene 1, shown in the voice-sim badge and the Money Desk header, and written on the outro card. Never call it sandbox or live. A sandbox version needs `~/.config/tillwise/paypal-sandbox.env`, `npm run sandbox:seed` and a new recording with new narration.
- Scenes 2, 3 and 6 are live model output.
  - The scene waits for the confirmation card (scene 3) and for the 8th widget frame (scene 6: `… .ag-studio-layout-widget >> nth=7`). It fails loudly if they do not appear.
  - Re-record in that case; do not edit the footage.
- The figures on screen come from `paypal_refund_anomaly` and the ledger export, not from the narration. The narration names no numbers on purpose, because the data anchor moves with the date.
- No music. No third-party logos beyond the product names in the UI text.

## How to render

See `docs/VIDEO_RENDER.md` → "Exact commands" (the step-by-step commands used for the final render).

The one-command alternative after the demo reset and scene resolution is:

```bash
npm run video -- --scene out/m5-money-desk.resolved.json --url http://127.0.0.1:4189
```

That runs tts, record and compose in one go.

## Open points

- Scene 6 says "against the weeks before", but the 14-day chart shows one week before the spike. Fix the wording at the next recording.
- A sandbox version needs:
  - `~/.config/tillwise/paypal-sandbox.env`;
  - `npm run sandbox:seed`;
  - new narration (no "mock mode" lines);
  - a new recording.
