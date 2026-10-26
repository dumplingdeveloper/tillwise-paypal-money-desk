# Draft demo video: render record (M5 draft, mock mode)

This is a **draft**. It was rendered with this repo's own `video/` pipeline from `video/scenes/m5-money-desk.json`, in PayPal **mock mode**.

The narration (scene 1), the voice simulator badge ("PayPal: mock mode · demo data, not a PayPal account"), the Money Desk header ("mock ledger (demo data, not PayPal)") and the outro card ("PayPal ran in mock mode here…") all say it is mock/demo data. Nothing in it claims a live PayPal sandbox.

## Result

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

## Frames (committed, extracted from the mp4 at fixed timestamps)

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

## Narration / screen mismatches in this draft (honest list)

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

## Model calls used for this draft (budget 16 incl. retries)

| Attempt | Voice (gpt-6-luna) | Studio bridge (claude-sonnet-5) | Result |
| --- | --- | --- | --- |
| 1 (≈00:24 UTC) | 5 | 0 | failed at the `confirm` step: the model stopped after the preview, so no confirmation card appeared (the scene then had "Good morning" and no "Yes, go ahead." step) |
| 2 (00:29–00:35 UTC) | 4 | 5 | recorded OK |
| **Total** | **9** | **5** | **14 of 16** |

How the calls were counted:
- Voice calls are the `assistant.message` events with `model: gpt-6-luna` in the simulator's Copilot SDK session log (`alexa-sim/.copilot-sdk-state/.state/events.jsonl`, gitignored), from 00:20 UTC on.
- Studio calls are `threads[].modelCalls` from `GET /api/studio-agent/log` (one thread, `modelCalls: 5`).
- Machine on AC power for both attempts (`pmset -g batt`: "Now drawing from 'AC Power'").

## CPU courtesy waits

Before each TTS, recording and compose step, `/tmp/tw-busy.sh` ran the requested check (`pgrep -f 'ffmpeg|node|python|chrom'` + `lsof … | grep hackathon_paypal_bryntum`), polling every 60 s for at most 40 min.
- 23:59–00:20 UTC: busy. Entry 2 was composing its own video with ffmpeg; waited.
- 00:28 (TTS) clear. 00:28–00:29 (record) one busy poll, then clear. 00:38 (first compose) clear.
- 00:44–05:28 UTC (second compose, after changing `maxSilenceMs`): busy only because of an idle Entry 2 dev server (`node … src/server/main.ts`, 0% CPU). The Mac slept from about 00:58 to 05:24; at 05:28 the check was clear and the compose ran (it finished after a further sleep, about 10:40 UTC).

## Exact commands

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

## Unverified

- The three fixes above (host wording, `recent_refunds`, shared ledger window) pass unit and plumbing tests but have **not** been through a live model run or a new recording.
- `npm run record:live` (the one-command path with preflight and reset) was not used for this draft.
- Nobody has watched the full video end to end apart from the six frames above and the compose report's timeline, pixel and overlap checks (`out/compose-report.json`, all `ok`).
