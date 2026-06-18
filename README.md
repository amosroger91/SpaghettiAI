<div align="center">

# 🖨️ printjob-llm-webcam-monitor

**Point a webcam at your 3D printer and let a local vision model catch failures — and help you fix them.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-green.svg)](https://nodejs.org)
[![LLM: Ollama (local)](https://img.shields.io/badge/LLM-Ollama%20(local)-black.svg)](https://ollama.com)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-orange.svg)](CONTRIBUTING.md)

No cloud · no API keys · no images leave your machine.

</div>

---

## What it does

| | |
|---|---|
| 🔎 **"Has this print failed?"** | An on-demand health check with a real **double-check**: it votes across multiple model passes *and* multiple frames seconds apart, so glare, a moving nozzle, or one bad guess don't trigger false alarms. |
| 🛠️ **"Why did it fail?"** | The model diagnoses your symptom, proposes concrete changes each with a **visually verifiable** success signal, then watches a later snapshot (before vs. after) to confirm the fix actually worked. |

## Contents

- [Quick start](#quick-start)
- [Configure your camera](#configure-your-camera)
- [Choosing a model](#choosing-a-model)
- [How it works](#how-it-works)
- [Tuning & accuracy](#tuning--accuracy)
- [API](#api)
- [Contributing](#contributing)

## Quick start

```bash
# 1. Install Ollama + a vision model  (https://ollama.com)
ollama pull gemma3:4b

# 2. Run
git clone https://github.com/amosroger91/printjob-llm-webcam-monitor.git
cd printjob-llm-webcam-monitor
npm install
npm run dev
```

Open **http://127.0.0.1:8787** and click **Check now**. The dashboard loads even before a
camera is configured — set your URL in `config.json` (below) and you're live.

## Configure your camera

`printjob-llm-webcam-monitor` is source-agnostic. Set `camera.type` in `config.json`:

| `type`          | Use it for                                                | Set         |
|-----------------|-----------------------------------------------------------|-------------|
| `http-snapshot` | OctoPrint `?action=snapshot`, mjpg-streamer, any JPEG URL | `url`       |
| `mjpeg`         | An MJPEG stream (OctoPrint `?action=stream`)              | `url`       |
| `usb`           | A webcam on this machine (needs `ffmpeg` on PATH)         | `usbDevice` |
| `folder`        | A directory other tools drop snapshots into               | `folderPath`|

> **OctoPrint users:** the webcam is just a normal MJPEG/snapshot endpoint —
> point `http-snapshot` at `http://<octoprint-host>/webcam/?action=snapshot`.

Env overrides (no file edit needed): `PW_CAMERA_URL` · `PW_CAMERA_TYPE` · `PW_MODEL` ·
`PW_OLLAMA_URL` · `PW_PORT`.

## Choosing a model

Ships defaulting to **`gemma3:4b`** so it runs on modest hardware with no extra download
beyond Ollama. Any Ollama vision model works:

| Model                 | Pull                              | Notes                                |
|-----------------------|-----------------------------------|--------------------------------------|
| `gemma3:4b` (default) | `ollama pull gemma3:4b`           | Fast, runs on modest hardware        |
| `qwen2.5vl:7b`        | `ollama pull qwen2.5vl:7b`        | Stronger reasoning, best quality/size|
| `llama3.2-vision:11b` | `ollama pull llama3.2-vision:11b` | Strong, heavier                      |
| `moondream`           | `ollama pull moondream`           | Tiny/fast for frequent checks        |

> On CPU a single pass on a 4B model is ~30–40s, so the default 2×2 double-check takes a
> couple of minutes. Use a smaller model or a GPU for snappier checks.

## How it works

```
 webcam ─► capture/ ─► image/ ─► ai/ (Ollama) ─► analysis/ ─► store/ ─► dashboard
           (source)   (sharp)    (vision+JSON)   (vote/verify) (JSON)   (web/ + SSE)
```

| Module       | Responsibility                                                              |
|--------------|-----------------------------------------------------------------------------|
| `capture/`   | `CaptureSource` implementations (`http-snapshot`, `mjpeg`, `usb`, `folder`) |
| `image/`     | `sharp` preprocessing + before/after stitching                              |
| `ai/`        | `VisionProvider` interface, Ollama impl, small-model-tuned prompts & schemas|
| `analysis/`  | `failureCheck` (double-check) and `troubleshoot` (diagnose → verify)        |
| `store/`     | JSON-file persistence of checks, sessions, snapshots                        |
| `server/`    | Express API + SSE; serves the static dashboard in `web/`                    |

Add a `VisionProvider` to swap the model backend, or a `CaptureSource` to add a camera —
nothing else changes.

## Tuning & accuracy

A 4B model can do this reliably because the work is shaped to its strengths — and that's
**measured, not assumed**. An offline harness scores the real detection path against a
labeled image set so changes can be verified without a live printer.

```bash
npm run fetch-fixtures   # download the labeled eval images (gitignored, not committed)
npm run eval             # score the model and print a confusion matrix
PW_EVAL_SAMPLES=3 npm run eval   # also exercise the self-consistency vote
```

The levers that make small models accurate (all in `config.json`):

- **Preprocessing** — downscale (`image.maxSize`), optional bed crop (`image.crop`), and
  contrast normalize (`image.normalize`) so the model sees a clean, relevant frame.
- **Structured output** — the model fills a fixed JSON schema via Ollama's `format`
  instead of writing prose.
- **Decomposition** — explicit per-failure-mode questions beat one vague "is it wrong?".
- **Double-check** — `check.samples` passes/frame (majority vote) × `check.frames` frames
  spaced `check.frameDelayMs` apart. Real failures persist; noise doesn't.
- **Honest uncertainty** — below `check.confidenceThreshold` the verdict is *uncertain*
  rather than a forced yes/no (a natural hook for escalating to a bigger model).

See [`test/fixtures.json`](test/fixtures.json) for the labeled set and its sources.

## API

| Method | Path                                  | Description                          |
|--------|---------------------------------------|--------------------------------------|
| GET    | `/api/status`                         | Camera + model health, current config|
| GET    | `/api/snapshot`                       | Live preprocessed frame (JPEG)       |
| POST   | `/api/check`                          | Run a double-checked failure check   |
| GET    | `/api/checks`                         | Recent check history                 |
| POST   | `/api/troubleshoot`                   | Start an investigation (`{ symptom }`)|
| POST   | `/api/troubleshoot/:id/verify`        | Verify an applied change worked      |
| GET    | `/api/sessions` · `/api/sessions/:id` | Troubleshooting sessions             |
| GET    | `/api/events`                         | Server-Sent Events (progress/alerts) |

## Development

```bash
npm run dev      # watch mode (tsx)
npm run build    # typecheck + emit to dist/
npm run smoke    # end-to-end pipeline smoke test
npm run eval     # accuracy eval against the labeled fixtures
```

## Roadmap

- [ ] Scheduled background monitoring with desktop / ntfy / Discord alerts
- [ ] OctoPrint plugin / print-state awareness (only watch while printing)
- [ ] Optional cloud-model escalation for *uncertain* verdicts
- [ ] Auto-pause/cancel via OctoPrint API on confirmed failure
- [ ] Per-printer baselines and few-shot reference frames

## Contributing

Contributions of all kinds are welcome — code, docs, model tuning, and especially
**labeled test images**. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the workflow and
contribution roles, and our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © Roger Hernandez and contributors
