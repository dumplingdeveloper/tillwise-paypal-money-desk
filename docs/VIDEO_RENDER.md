# Sandbox-mode video (2026-10-27): final take (submission video)

The submission video is `video/out/money-desk-final-sandbox.mp4`, recorded in one take from
`video/scenes/m5-money-desk-sandbox.json` on the **real PayPal sandbox** (PayPal's public default sandbox credentials,
shared app `APP-80W284485P519543T`). The Money Desk analytics stay on the labelled mock ledger ("· mock data" on every
analytics title). Take 1 (below) was rejected and is not used anywhere.

## Final take (accepted)

| | |
| --- | --- |
| File (gitignored) | `video/out/money-desk-final-sandbox.mp4` |
| md5 | `51c3c542c33291c59d1fde79a224ed68` |
| Size | 8,473,651 bytes |
| ffprobe | duration 172.566667 s (2:52.6); h264 1920×1080, 30 fps; aac audio |
| compose checks | `temporalChecks`: 107 checks, 0 failures; `pixelChecks`: 11, 0 failures; 4 silences fast-forwarded with the on-screen "⏩ fast-forward" badge (×2.34, ×1.66, ×2.89, ×2.52) |
| Timeline | `video/out/money-desk-final-sandbox.timeline.json` (also `.compose-report.json`, `.srt`); committed copy: `video/frames/sandbox-final/money-desk-final-sandbox.timeline.json` |
| Recording | 2026-10-27 22:22:43Z – 22:26:03Z (record.js exit 0); compose 22:26:54Z – 22:34:43Z |
| Order | Woo order 481 (€45.00), linked with `sandboxSeed.js --link-woo 481` at 22:21Z |
| PayPal (money-moving) | card capture `8RH99162HA9261302` on order `3T232280XN893500D` (`POST /v2/checkout/orders` 201, debug id `f2888126a2df1`); voice refund `01567521794782012` `COMPLETED` €45.00 (`POST /v2/payments/captures/8RH99162HA9261302/refund` 201, debug id `f560177e160bc`) |
| PayPal calls | 25 for this take (seed link 6, Money Desk/voice reads and the refund 19); milestone 50 of 60; running total 146 of 250 |
| Model calls | 9: 5 × `gpt-6-luna` (voice), 4 × `claude-sonnet-5` (Studio), counted from `assistant.message` events in `alexa-sim/.copilot-sdk-state/.state/events.jsonl` since 22:22:43Z. Milestone total 17 of 20 (take 1: 8). No retry. |
| Power | `pmset -g batt` before each heavy step, all under `caffeinate -i`: TTS 65 % battery, recording 62 %, gallery 01 56 %, compose 56 % (gate: AC or ≥ 50 %); AC power from about 22:36Z (gallery 02–05). Lowest reading 40 % (on AC). |
| Sleep check | `pmset -g log`: last Sleep 21:56:17Z, Wake 21:56:23Z; no Sleep/Wake between 22:20Z and 22:36Z, so none inside the take or the compose |
| Courtesy | entry-2 busy check clear before TTS, recording and compose |

**Review (frames viewed one by one, `video/frames/sandbox-final/`, 18 PNGs):**

| Frame | Narration / caption at that moment | On screen |
| --- | --- | --- |
| `t002.0-intro-card.png` | intro card | title card |
| `t008.0-scene1-voice-sim.png` | "If you run a small WooCommerce shop on PayPal," | voice simulator, badge still "PayPal: checking mode…"; by "Here, refunds go to the real PayPal sandbox" (≈24.5 s) the badge reads "PayPal: REAL sandbox · api-m.sandbox.paypal.com · PayPal's public default sandbox app (shared)" |
| `t028.2-owner-refund-ask.png` | Owner: "Refund order 481." | the owner's message |
| `t037.0-refund-preview.png` | Assistant: "A refund of 45 euros for order 481 is ready." | the same text in the transcript |
| `t048.0-preview-confirm-gate.png` | "The refund is previewed first, and when the owner says go ahead," | preview in the transcript, no money moved yet |
| `t054.3-owner-yes.png` | Owner: "Yes, go ahead." | |
| `t061.0-host-confirm-preview.png` | Host: "Refund €45.00 for order 481 through PayPal?" | confirmation card with Yes / No, "Listening for yes or no…" |
| `t066.1-owner-yes-final.png` | Owner: "Yes." | |
| `t073.0-refund-result.png` | Assistant: "Refund of 45 euros for order 481 completed." | the same text in the transcript |
| `t085.0-hood-paypal-ids.png` | "the refund preview, the owner's voice confirmation," | hood: `paypal_refund_preview · 262 ms · ok`, `permission · confirmed by owner (voice) after 8.6 s`, `paypal_refund_apply · 4.6 s after confirmation · ok` |
| `t091.0-money-desk-fast-forward.png` | (silence, fast-forwarded) | Money Desk loading, "⏩ fast-forward" badge |
| `t100.0-money-desk-sandbox-grid.png` | "The grid at the top reads the real PayPal sandbox:" | grid "Real PayPal sandbox · objects Tillwise created", **top row refund `01567521794782012` 22:23 €45.00 COMPLETED**, then capture `8RH99162HA9261302` REFUNDED |
| `t115.0-money-desk-widgets.png` | "refund rate, who still owes us, and dispute deadlines." | scrolled: tiles, the revenue chart, refund rate 34.9 %, Who still owes us, Disputes, PayPal refunds, all "· mock data" |
| `t124.2-owner-studio-ask.png` | Owner: "Why are refunds spiking?" | typed into AG Studio's AI panel |
| `t138.0-studio-drilldown.png` | "quotes its figures," | the answer quotes 34.9 % vs 7.3 %, Stoneware Mug Set €2,083.77, "Damaged in transit" €2,193.30; new stacked chart "Refunds per day by reason · last 14 days … · mock data" with a legend; ends "using the mock ledger data" |
| `t153.0-studio-read-only.png` | "The Studio agent is read-only: it has no tool that moves money." | the same drill-down |
| `t162.0-outro.png` | "Tillwise and PayPal. …" | outro |
| `t170.0-end-card.png` | end card | "Thanks for watching", repo URL, sandbox/mock disclosure |

Honest notes:
- From 1:33 to 1:46, while the narration talks only about the grid at the top, the "Daily PayPal revenue · mock data"
  chart below it still shows AG Studio's "Loading…". The scene waits for a chart canvas before that line
  (`289bae2`), but the chart finished drawing only after the scroll. When the narration names the chart (from 1:48, "Below
  it, AG Studio's built-in tiles, chart and grid …") it is drawn.
- "Studio's AI panel runs on the GitHub Copilot SDK" and "answers from the mock ledger with read-only tools" describe
  the architecture. The panel lists only the two Studio tools it ran (`place_widget`, `configure_column_chart_stacked`);
  the read-only MCP tool runs server-side in the bridge and is not listed there. The page header names the
  agent ("Copilot SDK bridge · GitHub Copilot SDK") while the top of the page is visible (1:33–1:46).
- ASR was not run by me for this take.

Commands (as run; `<log>` is the PayPal call log outside the repo):

```bash
cd mcp-server && set -a && . ./.env && set +a && PAYPAL_MODE=sandbox MCP_PORT=3338 TILLWISE_SANDBOX_ACTIVITY_TTL_MS=900000 TILLWISE_PAYPAL_CALL_LOG=<log> node dist/src/server.js &
cd alexa-sim && SIM_PORT=4189 EXPECTED_GITHUB_LOGIN=<login> TILLWISE_PAYPAL_CALL_LOG=<log> node dist/src/server.js &
cd mcp-server && TILLWISE_PAYPAL_CALL_LOG=<log> node dist/src/sandboxSeed.js --link-woo 481
cd video && node scripts/resolve-scene.js --scene scenes/m5-money-desk-sandbox.json --order 481
export HF_HOME=$PWD/.cache/hf TRANSFORMERS_CACHE=$PWD/.cache/hf
caffeinate -i node scripts/tts.js --scene out/m5-money-desk-sandbox.resolved.json
caffeinate -i node scripts/record.js --scene out/m5-money-desk-sandbox.resolved.json --url http://127.0.0.1:4189
caffeinate -i node scripts/devpost-media.js --url http://127.0.0.1:4189 --out ../docs/devpost --moneyDeskOnly
caffeinate -i node scripts/compose.js --scene out/m5-money-desk-sandbox.resolved.json
cp out/demo.mp4 out/money-desk-final-sandbox.mp4   # plus compose-report.json, subtitles.srt and the timeline JSON
caffeinate -i node scripts/devpost-media.js --video out/money-desk-final-sandbox.mp4 --out ../docs/devpost --confirmAt 61 --hoodAt 85 --drillAt 138 --skipCapture
node scripts/chapters.js --timeline out/money-desk-final-sandbox.timeline.json --scene scenes/m5-money-desk-sandbox.json
```

### Devpost media (final take)
01 and the thumbnail were captured at 22:26:37Z, right after the recording ended and before compose, from the same
servers (the sandbox read came from the warm shared cache: 0 PayPal calls). 02–05 are frames of the final take.

| File | Size | md5 |
| --- | --- | --- |
| `01-money-desk.png` (1920×1280) | 328,750 | `487d685cf4e651b4d91b6df00fecab90` |
| `02-voice-refund-confirmation.png` (1500×1000, t=61 s) | 240,053 | `6e290c4f678aa71cbb7aee2d98b937fd` |
| `03-under-the-hood.png` (1500×1000, t=85 s) | 288,751 | `d307cdba10da7684d01785ed351bdd8d` |
| `04-why-are-refunds-spiking.png` (1500×1000, t=138 s) | 583,177 | `906459807a9a46aebb5b23e949094776` |
| `05-refunds-per-day-by-reason.png` (1500×1000, t=138 s) | 477,024 | `06d2ed3d848e6d7725aba8f0940693bc` |
| `youtube-thumbnail.png` (1280×720) | 311,530 | `bb0d16e1d9ec4364c9c78bdca568e33c` |

- The mock figures match across all six: refund rate 34.9 % (€2,236.51 of €6,401.37, baseline 7.3 %) in 01, the thumbnail
  and the drill-down text in 04.
- Labels: 01 and the thumbnail show "Real PayPal sandbox · objects Tillwise created" with refund `01567521794782012` on
  top and every analytics title "· mock data"; 02/03 carry the voice-sim badge "PayPal: REAL sandbox ·
  api-m.sandbox.paypal.com · PayPal's public default sandbox app (shared)"; 04/05 show the drill-down titled "· mock data".


The submission video is to be `video/out/money-desk-final-sandbox.mp4`, recorded from `video/scenes/m5-money-desk-sandbox.json`
on the **real PayPal sandbox** (PayPal's public default sandbox credentials, shared app `APP-80W284485P519543T`). The
Money Desk analytics stay on the labelled mock ledger ("· mock data" on every analytics title).

## Sandbox take 1 (rejected: do not upload)

| | |
| --- | --- |
| File (gitignored) | `video/out/money-desk-sandbox-take1.mp4` (renamed from `money-desk-final-sandbox.mp4` once rejected) |
| md5 | `0235199d1f3a2c23f8b83a2a6aba80f1` |
| Size | 8,003,918 bytes |
| ffprobe | duration 171.633333 s (2:51.6); video 1920×1080, 30 fps; audio stream present |
| compose checks | `temporalChecks`: 105 checks, 0 failures; `pixelChecks`: 11, 0 failures; 4 silences fast-forwarded with the on-screen "⏩ fast-forward" badge (×2.23, ×1.48, ×1.15, ×2.83) |
| Timeline | `video/out/money-desk-sandbox-take1.timeline.json` (also `.compose-report.json`, `.srt`) |
| Frames | 17 frames at each scene start, the preview, both "yes", the host confirmation, the refund result, the hood, the Money Desk, the drill-down and the end card: `video/out/frames-sandbox-take1/` (gitignored, kept as evidence of the defect) |
| Order | Woo order 474 (€39.00, Coffee Lover Gift Box), linked with `sandboxSeed.js --link-woo 474` |
| PayPal | capture `3KH53287DG893982N` (order `2WA29940028880628`, debug id `ca514c40dcd01`); voice refund `7HT09013T9850053S` `COMPLETED` €39.00 (debug id `ca514ca736f24`); see `docs/FACTS_PAYPAL_SANDBOX.md` §8 |
| Model calls | 8 of 12: 4 × `gpt-6-luna` (voice), 4 × `claude-sonnet-5` (Studio), counted from `assistant.message` events in `alexa-sim/.copilot-sdk-state/.state/events.jsonl` since 21:24:33Z. No retry. |
| PayPal calls | 25 for the whole milestone (seed link 6, Money Desk/voice reads and the refund 19); running total 121 of 250 |
| Power / courtesy | `pmset -g batt` "AC Power" before the recording (21:27Z) and before both compose runs; the entry-2 busy check was clear each time |

**Why it was rejected (found by viewing the frames):**
1. **Stale live grid (1:35–2:00).** The Money Desk's "LIVE PayPal sandbox" grid showed capture `3KH53287DG893982N` as
   `COMPLETED` and no refund row, while the narration said "with the refund we just made at the top". Cause: each MCP
   session had its own `PayPalService`, so the voice session's refund invalidated only its own activity cache, and
   the Money Desk session kept the entry it read 3 minutes earlier (made worse by a 15-minute TTL set for the
   recording). Fixed in `159b2a6`: one activity cache per MCP server, previews still per session; regression test in
   `mcp-server/test/sandboxActivity.test.ts`. A fresh read afterwards shows refund `7HT09013T9850053S` on top and the
   capture `REFUNDED` (`docs/devpost/01-money-desk.png`).
2. **Hood narration claimed more than the hood shows** ("its audit row with PayPal's refund ID"). The scene now says
   "every step is logged with its timing: the refund preview, the owner's voice confirmation, then the refund call to
   the PayPal sandbox"; the refund id is shown by the Money Desk grid.
3. "LIVE PayPal sandbox" could be read as PayPal's production environment ("Live"). The grid is now titled
   "Real PayPal sandbox · objects Tillwise created" (`d27eb7d`), and the narration says "reads the real PayPal sandbox".

Not done on purpose: no splicing of a re-recorded Money Desk segment into take 1, and no editing of the recorded
manifest's narration. The final video should be one honest take.

**What the final take needed (at the time):** one more full recording (about 4 voice + 4 Studio model calls). Only 4 of this
milestone's 12 model calls were left, so it was **not** started then; it was recorded later ("Final take" above). Everything else is ready: the scene (end card with the
planned repo URL, `maxSilenceMs` 4000, corrected narration, `chapters`), the fix, and the commands below.

Commands (take 1; the final take is the same with a new order id and the output copied to `money-desk-final-sandbox.*`):

```bash
cd mcp-server && set -a && . ./.env && set +a && PAYPAL_MODE=sandbox MCP_PORT=3338 TILLWISE_PAYPAL_CALL_LOG=<log> node dist/src/server.js &
cd mcp-server && TILLWISE_PAYPAL_CALL_LOG=<log> node dist/src/sandboxSeed.js --link-woo 474
cd alexa-sim && SIM_PORT=4189 EXPECTED_GITHUB_LOGIN=<login> TILLWISE_PAYPAL_CALL_LOG=<log> node dist/src/server.js &
cd video && node scripts/resolve-scene.js --scene scenes/m5-money-desk-sandbox.json --order 474
export HF_HOME=$PWD/.cache/hf TRANSFORMERS_CACHE=$PWD/.cache/hf
caffeinate -i node scripts/tts.js --scene out/m5-money-desk-sandbox.resolved.json
caffeinate -i node scripts/record.js --scene out/m5-money-desk-sandbox.resolved.json --url http://127.0.0.1:4189
caffeinate -i node scripts/compose.js --scene out/m5-money-desk-sandbox.resolved.json
node scripts/chapters.js --timeline out/<video>.timeline.json --scene scenes/m5-money-desk-sandbox.json
```

The first compose (scene `maxSilenceMs` 5000) stopped with "Demo is 175.233333s, not under 175s" (the pipeline's own
margin under 3:00); with 4000 it gave 171.63 s. The order was picked with the WooCommerce REST API (completed, ≤ €100,
no `_tillwise_paypal_refund_ids`), not with `scripts/demo-reset.sh`, because that script uses `docker compose exec` and
this milestone allowed no Docker use.

### Devpost media from take 1 (superseded by the final take above)
`node scripts/devpost-media.js --video out/money-desk-sandbox-take1.mp4 --url http://127.0.0.1:4189 --out ../docs/devpost --confirmAt 62 --hoodAt 90 --drillAt 138`

| File | Size | md5 |
| --- | --- | --- |
| `01-money-desk.png` (1920×1280, fresh capture after the fix) | 328,230 | `16d61920548b8e0e8025b4ac7ffca219` |
| `02-voice-refund-confirmation.png` (1500×1000) | 239,388 | `e4a1090f33bbdf826aa59a04f95c5d9d` |
| `03-under-the-hood.png` (1500×1000) | 265,388 | `17b504f54d0b1212fc588c67e639d0be` |
| `04-why-are-refunds-spiking.png` (1500×1000) | 569,660 | `5d70a6a19d02536f65077bfd62702403` |
| `05-refunds-per-day-by-reason.png` (1500×1000) | 455,672 | `5cbd37efac6a23c150c4d7384148eb9e` |
| `youtube-thumbnail.png` (1280×720) | 311,051 | `a4238f6c2f58999ce26783d62ea31cf9` |

- Labels: 01 and the thumbnail show "Real PayPal sandbox · objects Tillwise created" with refund `7HT09013T9850053S` on top, and every analytics widget titled "· mock data"; 02/03 carry the voice-sim badge "PayPal: REAL sandbox · api-m.sandbox.paypal.com · PayPal's public default sandbox app (shared)"; 04/05 show the drill-down titled "· mock data" and the agent's text "Using the mock ledger".
- Known inconsistency: 04/05 (take 1, 21:3xZ) quote a 35.2% refund rate, 01 (21:59Z) shows 34.9%. The mock ledger is anchored on the current time and gained one capture between the two.
- **Power-gate deviation:** this step ran at 21:59Z although `pmset -g batt` printed "Battery Power" in the same command (the check and the step were chained, and the step did not stop on it). It was one Playwright capture and five single-frame ffmpeg extractions, no recording or render. No heavy step ran on battery after that.

---

# Demo video: render record (final mock-mode render)

The final mock-mode video was rendered on 2026-10-26 with this repo's own `video/` pipeline from `video/scenes/m5-money-desk.json`. PayPal runs in **mock mode**.

The intro card ("PayPal runs in mock mode in this video: demo data, not a PayPal account"), the narration ("In this demo, PayPal runs in mock mode, on demo data"), the voice-sim badge ("PayPal: mock mode · demo data, not a PayPal account"), the Money Desk header ("mock ledger (demo data, not PayPal)") and the outro card all say so. Nothing in it claims a live PayPal sandbox.

It replaces the M5 draft (`money-desk-draft-mock.mp4`, md5 `6d604431…`; its record is kept below as an appendix).

## Result

| | |
| --- | --- |
| File | `video/out/money-desk-final-mock.mp4` (gitignored; a byte copy of `video/out/demo.mp4`) |
| Duration (ffprobe) | 162.100000 s = 2:42 (hard limit 3:00) |
| Video | H.264, 1920x1080, 30 fps |
| Audio | AAC 48 kHz; loudness −16.2 LUFS integrated, −1.5 dBFS true peak (compose-report.json) |
| Size | 7,119,436 bytes |
| md5 | `774992c9af72c11e76f6e0b0e9c7e40f` |
| Music | none |

`ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate -of compact video/out/money-desk-final-mock.mp4`:

```
stream|codec_name=h264|width=1920|height=1080|r_frame_rate=30/1
stream|codec_name=aac|r_frame_rate=0/0
format|duration=162.100000|size=7119436
```

The compose report's pixel checks and temporal checks (no audio overlap, no caption overlap, captions within their clips) are all `ok`.

## What changed since the draft

- **Spoken currency.** `video/scripts/speakable.js` turns money into words before Kokoro synthesis: "EUR 31.00" → "31 euros", "€2,083.77" → "2,083 euros and 77 cents", and the same for USD/$ and GBP/£. It is used for the scripted lines (`tts.js`) and for live model and host lines (`tts-engine.js`, used by `record.js`). The clip cache is keyed on the spoken text. Captions keep the original text ("Host: Refund €31.00 for order 416 through PayPal?").
  - The voice simulator's browser `speechSynthesis` uses an identical copy, `alexa-sim/public/speakable.js`. The alexa-sim unit tests assert the two files are byte-identical.
  - Tests: `video/test/speakable.test.js` and alexa-sim `test/unit.test.ts` "the voice sim speaks money as words…".
- **Captions** (`video/scripts/captions.js`, `video/test/captions.test.js`):
  - no "Narrator:" label; Owner, Assistant and Host keep theirs;
  - cards break at sentence ends, then at clause boundaries (`, : ;` and dashes), using the fewest cards;
  - a break that leaves a list hanging ("…on PayPal, refunds, | disputes…") costs as much as an extra card;
  - only a single clause longer than a card is split between words.
- **Opening.** The first 15 s say who it is for, what problem it solves and why it matters.
  - Intro card (0–4 s): "For small WooCommerce shops on PayPal: refunds, disputes and unpaid invoices in one conversation, and no money moves without the owner's yes."
  - Narration from 4.4 s: "If you run a small WooCommerce shop on PayPal, refunds, disputes and unpaid invoices sit in separate screens, and one wrong refund costs real money." This sentence ends at about 15.4 s; the ASR places it at 12.5–15.4 s.
- **Fixes now on screen** (earlier commits, first time in a recording):
  - the plain host question "Refund €31.00 for order 416 through PayPal?";
  - the 14-day `recent_refunds` chart "Refunds per day by reason · Tue 13 Oct – Mon 26 Oct", with a legend;
  - the same 36.3% and 7.3% baseline in the tile and the agent's answer;
  - the outstanding-only "Who still owes us" board (4 customers, €1,196.00).
- **Studio refusal prompt dropped.** The draft typed "Refund order …" into the Studio AI panel to show the agent declining. This render only *says* so in the narration ("The Studio agent is read-only: it has no tool that moves money…"), to stay within the model-call budget after the first attempt failed (see "Model calls").
  - The refusal is still covered by the LIVE acceptance test (`money-desk-live-refusal.json`, no tool calls, audit counts unchanged), but it is not shown in this video.

## Frames (committed, extracted from the mp4 at fixed timestamps)

`ffmpeg -v error -y -ss <t> -i out/money-desk-final-mock.mp4 -frames:v 1 frames/money-desk-final-t<t>.png`

| Frame | md5 | Speech at that moment | What the screen shows |
| --- | --- | --- | --- |
| `video/frames/money-desk-final-t006.png` | `bdb10dff25c34091099f742a26fc8406` | "If you run a small WooCommerce shop on PayPal," (no speaker label) | Voice sim, idle, mock-mode badge |
| `video/frames/money-desk-final-t040.png` | `c2b1a8ff3d119a80c67b14c9855d32db` | ASSISTANT (live): "Say yes to move the money." | "Refund order 416." and the live preview answer "…ready for 31 euros on order 416…" |
| `video/frames/money-desk-final-t066.png` | `4a50121c13de96deb1608ad98276a8d3` | HOST: "Refund €31.00 for order 416 through PayPal?" (spoken "31 euros") | Confirmation card with Yes/No |
| `video/frames/money-desk-final-t086.png` | `5dcbe601edce4316f61554c17c64100f` | "then the refund call to PayPal mock mode, and its audit row." | Under the hood: `paypal_refund_preview` → permission confirmed by owner (voice) → `paypal_refund_apply`; "The 31 euro refund for order 416 is complete." |
| `video/frames/money-desk-final-t108.png` | `e9a7a485e8ce6fda4c86601d367f2e04` | "The rows come through our MCP server from the PayPal tools," | Seeded Money Desk: refund-rate tile (36.3%, Refund spike, baseline 7.3%, Tue 20 Oct – Mon 26 Oct), Who still owes us (4 rows, €1,196.00), dispute countdowns, revenue chart, refunds grid |
| `video/frames/money-desk-final-t132.png` | `51581b7fac314131190fe0847029a93e` | "so the damaged mug shipments stand out against the weeks before." | Studio AI answer (36.3% vs 7.3%, 4.9×, Stoneware Mug Set €2,033.77 = 93.0%, Damaged in transit €2,143.30 = 98.0%) and the new stacked chart, 14 days, legend: Damaged in transit, Duplicate order, Late delivery |
| `video/frames/money-desk-final-t150.png` | `45ce0a0fe4c852ec981be07cb8b9e605` | "Talk to your shop, see your money," | Same canvas, closing line |

I opened and checked every frame:
- **Readable:** all text is legible at 1920x1080. Captions sit in their own band.
- **Private data:** none found.
  - No email addresses, tokens or home paths are visible.
  - The only account-like string is the GitHub login `yuxinshiu63` in the under-the-hood panel (the repo's commit identity).
  - Person names in the refunds grid ("Sean Murphy", "Niamh Walsh") are invented mock-ledger customers (`mcp-server/src/paypal/mockLedger.ts`).
- **Matches the narration:** yes, with the mismatches below.

## Narration / screen mismatches (honest list)

1. "…stand out against **the weeks** before": the chart shows 14 days, so only one week before the spike. Changing it needs a new TTS clip, and so a new recording; no model calls were left.
2. "Kilkenny Workspace Co" (the renamed customer) is not visible in any frame. Its only invoice is a DRAFT (`mockLedger.ts:105`), so the outstanding-only board rightly leaves it out. The old "Desk Refresh Box" *customer* is gone. "Desk Refresh Box" appears only as a product in the refunds grid, which is correct.
3. The agent's answer mentions "using the recent_refunds table", an internal table name. This is live model text and was not edited.

## ASR check (faster-whisper base.en)

`asr-venv/bin/python asr_check.py video/out/money-desk-final-mock.mp4 video/out/m5-money-desk.resolved.json base.en` (the orchestrator's tool):

- **Currency is heard as euros everywhere:**
  - "The refund preview is ready for 31 euros on Order 416."
  - "Refund 31 euros for Order 416 through PayPal."
  - "The 31 euro refund for Order 416 is complete."
- No "your" stands in for EUR. The only "your" is the scripted "Talk to your shop, see your money".
- Script words 255, heard 292, ratio 0.910. The surplus is the live model and host lines, which are not in the scene file and show as inserts.
- The other differences are spelling only: "pay pal", "co pilot", "till wise", "owners", and "refund" for "refunds" in "Why are refunds spiking?".

## Model calls (budget 12 incl. at most 1 retry)

| Attempt | Voice (gpt-6-luna) | Studio bridge (claude-sonnet-5) | Result |
| --- | --- | --- | --- |
| 1 (12:22 UTC) | 4 | 0 | failed at `confirm`. I had started the MCP server without `mcp-server/.env`, so the WordPress ability `paypal-order-context` returned 401 and the model reported "permission was denied" (operator error, not model behaviour). |
| 2 (12:27–12:31 UTC, the retry) | 4 | 4 | recorded OK |
| **Total** | **8** | **4** | **12 of 12** |

How the calls were counted:
- Voice calls are the `assistant.message` events with model `gpt-6-luna` in `alexa-sim/.copilot-sdk-state/.state/events.jsonl` (gitignored), from 12:22 UTC.
- Studio calls are `assistant.message` events with model `claude-sonnet-5` in the same file, and `threads[].modelCalls: 4` from `GET /api/studio-agent/log`.
- The machine was on AC power for both attempts (`pmset -g batt`).

## CPU courtesy waits

Before every TTS, recording, compose and media step, `/tmp/tw-busy.sh` ran the requested check (`pgrep -f 'ffmpeg|node|python|chrom'` + `lsof … | grep hackathon_paypal_bryntum`), polling every 60 s for at most 40 min.
- 12:19 UTC: one busy poll, then clear at 12:20.
- 12:52: two busy polls before the Devpost media step.
- Every other check was clear at once (12:22, 12:27, 12:31, 12:40, 12:53, 12:54).

## Exact commands

Prerequisites:
- the tillwise-paypal Docker stack is already running on 8098 (no containers were started);
- the MCP server runs in mock mode on 3338 **with its `.env` loaded**, because the WordPress abilities need the application password;
- the simulator runs on 4189:

```bash
(cd mcp-server && npm run build && set -a && . ./.env && set +a && PAYPAL_MODE=mock MCP_PORT=3338 node dist/src/server.js)
(cd alexa-sim && npm run build && SIM_PORT=4189 EXPECTED_GITHUB_LOGIN=<your login> node dist/src/server.js)
```

From `video/`:

```bash
cd video
npm ci && npm test                      # speakable + captions unit tests
bash ../scripts/demo-reset.sh          # docker compose exec only: recreates the seed orders with new ids
# find today's completed order id (here 416, €31.00) with wp-cli in the running stack, then:
node scripts/resolve-scene.js --scene scenes/m5-money-desk.json --order 416    # → out/m5-money-desk.resolved.json
export HF_HOME=$PWD/.cache/hf TRANSFORMERS_CACHE=$PWD/.cache/hf
caffeinate -i node scripts/tts.js     --scene out/m5-money-desk.resolved.json
caffeinate -i node scripts/record.js  --scene out/m5-money-desk.resolved.json --url http://127.0.0.1:4189
caffeinate -i node scripts/compose.js --scene out/m5-money-desk.resolved.json   # scene maxSilenceMs 5000
cp out/demo.mp4 out/money-desk-final-mock.mp4
for t in 006 040 066 086 108 132 150; do ffmpeg -v error -y -ss $((10#$t)) -i out/money-desk-final-mock.mp4 -frames:v 1 frames/money-desk-final-t$t.png; done
node scripts/devpost-media.js --video out/money-desk-final-mock.mp4 --url http://127.0.0.1:4189 --out ../docs/devpost
```

- The captions were improved after the recording (list-aware splitting). `compose.js` was re-run on the same recording; no model calls were needed.
- The record estimate check (< 170 s) passed. A stub dry-run on 4193 cannot pass the first `waitFor #text`, because the stub page has no voice UI.

## Devpost media (`docs/devpost/`, committed)

All images are real UI. `video/scripts/devpost-media.js` makes them, with no model calls:
- `01` is a fresh Playwright capture of the seeded Money Desk at a 1920x1280 viewport.
- `02`–`05` are crops of frames of the final video, above the caption band.
  - `02` and `03` show the whole voice-sim UI scaled to 1500 wide. The strip below the page is a blurred copy of the same frame, so it has no flat bar.
  - `04` and `05` are 1410x940 windows scaled to 1500x1000.
- The thumbnail is the top 16:9 of `01`.

| File | Size | md5 | Shows |
| --- | --- | --- | --- |
| `docs/devpost/01-money-desk.png` | 1920x1280 (3:2) | `4995862d1f438902fa693ef8fa2358b6` | Seeded AG Studio Money Desk with the mock-ledger label |
| `docs/devpost/02-voice-refund-confirmation.png` | 1500x1000 | `169851fa3125ca3db5d4bd4e22d713a9` | Voice sim: preview answer, "Yes, go ahead.", host card "Refund €31.00 for order 416 through PayPal?" |
| `docs/devpost/03-under-the-hood.png` | 1500x1000 | `c0b595150f4b3eaa8f4eaf10e1ca5100` | Under the hood: preview → owner's voice confirmation → apply; refund complete |
| `docs/devpost/04-why-are-refunds-spiking.png` | 1500x1000 | `573c4c5b4ba2fb6d4bcb36bb9de60b54` | Studio AI panel answer with tool figures, beside the canvas |
| `docs/devpost/05-refunds-per-day-by-reason.png` | 1500x1000 | `eadd95dfdb30cdf1e5943d04af2d2466` | The agent's stacked 14-day chart with legend, next to the seeded widgets |
| `docs/devpost/youtube-thumbnail.png` | 1280x720 | `925a37c7f7bf78798d7de3e06badaac1` | Money Desk title, 36.3% Refund spike tile, all seeded widgets |

I viewed each one. The text is readable and nothing private is shown beyond the GitHub login in `03`.

## Unverified

- Nobody has watched the full video end to end. The checks were the seven frames, the ASR transcript and the compose report's pixel, timeline and overlap checks.
- The YouTube upload and how YouTube re-encodes the video are untested.
- `npm run record:live` (the one-command path with preflight and reset) was not used.
- Sandbox mode is not shown anywhere. The recording ran from 12:22 to 12:31 UTC, with MCP started as `PAYPAL_MODE=mock`. At 12:36 UTC someone else created `~/.config/tillwise/paypal-sandbox.env`. Its SOURCE note says it holds PayPal's shared public sandbox credentials from the Postman collection, not our own app. I have not run `npm run sandbox:smoke` or `sandbox:seed` with it.

## Appendix: M5 draft render (superseded)

The draft frames `video/frames/money-desk-draft-t*.png` stay committed for reference.

### Result

| | |
| --- | --- |
| File | `video/out/money-desk-draft-mock.mp4` (gitignored; a byte copy of `video/out/demo.mp4`) |
| Duration (ffprobe) | 156.100000 s = 2:36 (target 2:30–2:50, hard limit 3:00) |
| Video | H.264, 1920x1080, 30 fps |
| Audio | AAC 48 kHz; loudness −16.2 LUFS integrated, −1.5 dBFS true peak (compose-report.json) |
| Size | 7,624,468 bytes |
| md5 | `6d604431e4b3de1c263d112e01a6a31a` |
| Music | none |

`ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate -of compact video/out/money-desk-draft-mock.mp4`:

```
stream|codec_name=h264|width=1920|height=1080|r_frame_rate=30/1
stream|codec_name=aac|r_frame_rate=0/0
format|duration=156.100000|size=7624468
```

### Frames (committed, extracted from the mp4 at fixed timestamps)

`ffmpeg -v error -y -ss <t> -i out/money-desk-draft-mock.mp4 -frames:v 1 frames/money-desk-draft-t<t>.png`

| Frame | md5 | Narration / speech at that moment | What the screen shows |
| --- | --- | --- | --- |
| `video/frames/money-desk-draft-t030.png` | `3ae967ed28d13cce5e8580e34862a005` | ASSISTANT (live model): "The refund preview is ready for EUR 31.00. Say yes to move the money." | Voice sim with the mock-mode badge; "Refund order 360." and the live preview answer |
| `video/frames/money-desk-draft-t056.png` | `fa422ba3cece141c9d2cbee7e5900ef0` | HOST: "Do you want me to paypal refund apply?" | Confirmation card with Yes/No (see mismatch 1) |
| `video/frames/money-desk-draft-t072.png` | `952ed564fadc3c06c93eb2a707d5d402` | NARRATOR: "Under the hood, every MCP tool call is visible…" | Under-the-hood panel: `paypal_refund_preview` → permission confirmed by owner → `paypal_refund_apply` |
| `video/frames/money-desk-draft-t090.png` | `722dc89a3ab167b1e99c1d06acaed6b1` | NARRATOR: "…three custom widgets: refund rate, who still owes us…" | Seeded AG Studio Money Desk: refund-rate tile (34.9%, Refund spike), "Who still owes us" (4 rows, €1,196.00), dispute countdown, revenue chart, refunds grid |
| `video/frames/money-desk-draft-t118.png` | `cdbd39881e3a9c89ad20b0ca6721e828` | NARRATOR: "…adds a chart of refunds per day by reason, so the damaged mug…" | Studio AI panel answer to "Why are refunds spiking?" and the new stacked chart with legend (see mismatches 2 and 3) |
| `video/frames/money-desk-draft-t140.png` | `7dd09ce5ebe49fdb6bad41a4febb3586` | NARRATOR: "…declines and points back to the confirmed voice flow." | Studio agent's refusal of "Refund order 360" |

I opened and checked every frame:
- **Readable:** all text is legible at 1920x1080. The subtitle band is separate from the UI.
- **Private data:** none found.
  - No email addresses are on screen. The ledger's emails are `*.example.test`, and none is visible in these frames.
  - No tokens, no home paths.
  - The only account-like string is the GitHub login `yuxinshiu63` in the under-the-hood panel (the repo's commit identity).
  - The person names in the grids (e.g. "Sean Murphy", "Niamh Walsh") are invented mock-ledger customers (`mcp-server/src/paypal/mockLedger.ts`), not real people's data.
- **Matches the narration:** yes for all six, with the mismatches listed below.

### Narration / screen mismatches in this draft (honest list)

1. **Host wording (t≈55 s).** The host asks "Do you want me to paypal refund apply?", the generic fallback built from the tool name (`permissionGate.ts:24`), because `confirmationFor` had no PayPal branch.
   - **Fixed after the recording:** `alexa-sim/src/copilotAgent.ts` `paypalConfirmation` builds the question from the MCP preview, e.g. "Refund €31.00 for order 360 through PayPal?". Unit test: `test/unit.test.ts` "the host asks a plain-language question for each human-gated PayPal tool".
   - The footage still has the old wording.
2. **Drill-down chart window (t≈107–143 s).** The model titled its chart "Refunds by reason, last 14 days (Mon 12 Oct – Sun 25 Oct)" but never called `add_widget_filter`, so the chart plots all 45 days (x-axis 12/09 – 25/10). The spike against the earlier days is still visible, and the narration ("against the weeks before") fits the picture, but the title does not match the axis.
   - **Fixed after the recording:**
     - a `recent_refunds` table that already holds exactly the last 14 ledger days, with the exact dates in its AI-facing description (`alexa-sim/src/moneyDesk.ts`);
     - a system-message pointer to it (`studioBridge.ts`);
     - the plumbing test checks it day by day against `paypal_refund_anomaly`'s daily series;
     - the LIVE test now fails if the drill-down chart plots more days than the 14-day series.
   - The footage still shows the 45-day chart. The fix has **not** been re-run live.
3. **Baseline 7.3% vs 7.4%.** The agent quoted the tool ("34.9% … vs 7.3% before"); the seeded tile said "baseline 7.4% before this window".
   - Cause: the MCP server builds the mock ledger once at start-up (here 25 Oct, about 23:30 UTC). After midnight, `paypal_ledger_export` (which feeds the tile) cut its 45-day window by the wall clock and dropped the ledger's first day (11 Sep). `paypal_refund_anomaly` kept it.
   - **Fixed after the recording:** both tools now use one `windowedLedger()` counted back from the ledger's own anchor day (`mcp-server/src/paypal/service.ts`). Test: `mcp-server/test/ledger.test.ts` "refund anomaly uses exactly the rows paypal_ledger_export gives the Money Desk tile". That test fails on the old code with the exact recording-time case: built at 23:30, read at 00:31.
   - The footage still shows both numbers.
4. The window figures agree (34.9% in both the tile and the reply). The "Who still owes us" board shows only outstanding invoices (4 rows, €1,196.00), and the chart has a legend. These are the cddc806 fixes, and they are visible in the footage.

A final render needs a new recording after these fixes (about 9–10 model calls; see "Model calls").

### Model calls used for this draft (budget 16 incl. retries)

| Attempt | Voice (gpt-6-luna) | Studio bridge (claude-sonnet-5) | Result |
| --- | --- | --- | --- |
| 1 (≈00:24 UTC) | 5 | 0 | failed at the `confirm` step: the model stopped after the preview, so no confirmation card appeared (the scene then had "Good morning" and no "Yes, go ahead." step) |
| 2 (00:29–00:35 UTC) | 4 | 5 | recorded OK |
| **Total** | **9** | **5** | **14 of 16** |

How the calls were counted:
- Voice calls are the `assistant.message` events with `model: gpt-6-luna` in the simulator's Copilot SDK session log (`alexa-sim/.copilot-sdk-state/.state/events.jsonl`, gitignored), from 00:20 UTC on.
- Studio calls are `threads[].modelCalls` from `GET /api/studio-agent/log` (one thread, `modelCalls: 5`).
- Machine on AC power for both attempts (`pmset -g batt`: "Now drawing from 'AC Power'").

### CPU courtesy waits

Before each TTS, recording and compose step, `/tmp/tw-busy.sh` ran the requested check (`pgrep -f 'ffmpeg|node|python|chrom'` + `lsof … | grep hackathon_paypal_bryntum`), polling every 60 s for at most 40 min.
- 23:59–00:20 UTC: busy. Entry 2 was composing its own video with ffmpeg; waited.
- 00:28 (TTS) clear. 00:28–00:29 (record) one busy poll, then clear. 00:38 (first compose) clear.
- 00:44–05:28 UTC (second compose, after changing `maxSilenceMs`): busy only because of an idle Entry 2 dev server (`node … src/server/main.ts`, 0% CPU). The Mac slept from about 00:58 to 05:24; at 05:28 the check was clear and the compose ran (it finished after a further sleep, about 10:40 UTC).

### Exact commands

Prerequisites:
- the tillwise-paypal Docker stack is already running on 8098 (no containers were started);
- the MCP server runs in mock mode on 3338;
- the simulator runs on 4189:

```bash
(cd mcp-server && npm run build && PAYPAL_MODE=mock MCP_PORT=3338 node dist/src/server.js)
(cd alexa-sim && npm run build && SIM_PORT=4189 EXPECTED_GITHUB_LOGIN=<your login> node dist/src/server.js)
```

From `video/` (`npm ci` once: 57 packages). The steps were run one by one, not with `npm run record:live`, so the order id stays known and the courtesy check could run between steps:

```bash
cd video
npm ci
bash ../scripts/demo-reset.sh          # docker compose exec only: recreates the seed orders with new ids
# find today's completed order id (here 360) with wp-cli in the running stack, then:
node scripts/resolve-scene.js --scene scenes/m5-money-desk.json --order 360    # → out/m5-money-desk.resolved.json
export HF_HOME=$PWD/.cache/hf TRANSFORMERS_CACHE=$PWD/.cache/hf
caffeinate -i node scripts/tts.js     --scene out/m5-money-desk.resolved.json
caffeinate -i node scripts/record.js  --scene out/m5-money-desk.resolved.json --url http://127.0.0.1:4189
caffeinate -i node scripts/compose.js --scene out/m5-money-desk.resolved.json   # scene maxSilenceMs 5000
cp out/demo.mp4 out/money-desk-draft-mock.mp4
mkdir -p frames && for t in 030 056 072 090 118 140; do ffmpeg -v error -y -ss $((10#$t)) -i out/money-desk-draft-mock.mp4 -frames:v 1 frames/money-desk-draft-t$t.png; done
```

- The first compose used `maxSilenceMs: 1500` and gave 137.9 s, which is under the 2:30 target. The scene now uses 5000, so the real model waits are shown for up to 5 s. Longer gaps are still sped up and carry the "⏩ fast-forward" badge.
- `npm run video -- --dry-run …` was run only against the pipeline's stub page (estimate 151.5 s, then 153.3 s for the reworked scene). It stops at the first live step there. `record.js --dry-run` executes the live steps too, so it was not run against the real simulator, to save model calls.

### Unverified

- The three fixes above (host wording, `recent_refunds`, shared ledger window) pass unit and plumbing tests but have **not** been through a live model run or a new recording.
- `npm run record:live` (the one-command path with preflight and reset) was not used for this draft.
- Nobody has watched the full video end to end apart from the six frames above and the compose report's timeline, pixel and overlap checks (`out/compose-report.json`, all `ok`).
