# Demo video production pipeline

This folder is self-contained and intentionally decoupled from the real simulator. It records any local URL driven by a declarative scene, mixes locally generated Kokoro TTS, adds title/outro cards and subtitles, then writes review artifacts.

## One command

```bash
cd video
npm run video -- --scene scenes/example.json --url http://127.0.0.1:4177/
```

If `--url` is omitted, the command starts `video/stub/` on `127.0.0.1:4177`. To use the stub explicitly:

```bash
node scripts/serve-static.js stub 4177
npm run video -- --scene scenes/example.json --url http://127.0.0.1:4177/
```

Later, point `--url` at the real simulator URL served on `127.0.0.1`.

Useful options:

```bash
# Validate voices, selectors, and estimated duration (<170s) without recording.
npm run video -- --dry-run --scene scenes/example.json --url http://127.0.0.1:4177/

# Override the reserved caption band height in pixels.
npm run video -- --scene scenes/example.json --url http://127.0.0.1:4177/ --subtitle-band-height 140

# Preflight, reset, record, and compose the real simulator when it is running.
npm run record:live -- --url http://127.0.0.1:4179
```

## Outputs

- `out/demo.mp4` — H.264/AAC, 1080p, 30 fps, burned-in subtitles.
- `out/preview.gif` — 640px GIF preview under 5 MB.
- `out/sample-frame-1.png` through `out/sample-frame-4.png` — review frames.
- `out/tts-report.json`, `out/recording-manifest.json`, `out/compose-report.json`, `out/ffprobe-demo.json` — proof and diagnostics.

The page is recorded at `1920 x (1080 - subtitleBandHeight)` and then composed onto a 1920x1080 dark canvas. Burned-in captions are constrained to the reserved bottom band, wrap to at most two lines, and long speech is split into sequential caption cards timed proportionally to the generated audio.

Live scenes support honest dead-air compression with `maxSilenceMs` (default `1500`): gaps with no audio are sped up and marked with a "⏩ fast-forward" badge in the subtitle band. These gaps include model latency and the time Kokoro needs to generate each live answer; the real time from the end of each owner line to the live answer is recorded in `out/compose-report.json` (`stepLatencies`).

`scripts/video-timing.js` patches Playwright's video recorder before recording. Unpatched, Playwright writes every screencast frame at least once at 25 fps, so a page that repaints faster (the simulator's animated ring) produces a video longer than wall-clock time and the narration drifts away from the picture. In a 20-second test with the ring animating, the unpatched recording was 32.96 s long and the patched one 20.08 s.

## Scene templates and card text

- A scene may contain `{{ORDER_ID}}` (for example "Refund order {{ORDER_ID}}."). The demo reset recreates the seed orders with new ids, so resolve the template after the reset: `node scripts/resolve-scene.js --scene scenes/m5-money-desk.json --order <id>` writes `out/m5-money-desk.resolved.json`. Then run tts/record/compose on that file.
- Optional scene fields for the cards: `cardEyebrow` (intro/outro eyebrow), `outroSub` (outro subtitle; when set, the `github` field may be empty) and `outroNote` (small print on the outro card). `maxSilenceMs` may also be set per scene. `scenes/m5-money-desk.json` uses 5000.
- The full commands for the PayPal draft are in `docs/VIDEO_RENDER.md`.

## Scene step types

`goto`, `type`, `click`, `waitFor`, `pause`, `say`, `caption`, and `scrollTo`/`reveal` are supported. `waitFor` fails loudly when a selector or text does not appear, preventing silent wrong-demo recordings.

## License and rules posture

No music is added. The stub uses original HTML/CSS only and no logos, sounds, trademarks, or third-party brand assets. TTS uses `kokoro-js` with the ONNX model license verified through the Hugging Face API before generation; details are recorded in `LICENSES.md`.
