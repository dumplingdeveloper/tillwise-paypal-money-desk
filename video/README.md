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
npm run record:live -- --url http://127.0.0.1:4178
```

## Outputs

- `out/demo.mp4` — H.264/AAC, 1080p, 30 fps, burned-in subtitles.
- `out/preview.gif` — 640px GIF preview under 5 MB.
- `out/sample-frame-1.png` through `out/sample-frame-4.png` — review frames.
- `out/tts-report.json`, `out/recording-manifest.json`, `out/compose-report.json`, `out/ffprobe-demo.json` — proof and diagnostics.

The page is recorded at `1920 x (1080 - subtitleBandHeight)` and then composed onto a 1920x1080 dark canvas. Burned-in captions are constrained to the reserved bottom band, wrap to at most two lines, and long speech is split into sequential caption cards timed proportionally to the generated audio.

Live scenes support honest dead-air compression with `maxSilenceMs` (default `1500`): gaps with no audio are sped up and marked with a waiting badge in the subtitle band.

## Scene step types

`goto`, `type`, `click`, `waitFor`, `pause`, `say`, `caption`, and `scrollTo`/`reveal` are supported. `waitFor` fails loudly when a selector or text does not appear, preventing silent wrong-demo recordings.

## License and rules posture

No music is added. The stub uses original HTML/CSS only and no logos, sounds, trademarks, or third-party brand assets. TTS uses `kokoro-js` with the ONNX model license verified through the Hugging Face API before generation; details are recorded in `LICENSES.md`.
