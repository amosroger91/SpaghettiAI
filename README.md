# printjob-llm-webcam-monitor

> Point a webcam at your 3D printer and let a **local** vision LLM tell you whether the
> print is failing — and help you fix it.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-green.svg)](https://nodejs.org)
[![Built with Ollama](https://img.shields.io/badge/LLM-Ollama%20(local)-black.svg)](https://ollama.com)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-orange.svg)](CONTRIBUTING.md)

`printjob-llm-webcam-monitor` watches a webcam pointed at a 3D printer and uses a
**local, private** vision model (via [Ollama](https://ollama.com)) to do two things:

1. **"Has this print failed?"** — an on-demand health check with a real **double-check**
   mechanism: it votes across multiple model passes (self-consistency) *and* across
   multiple frames captured seconds apart, so transient glare, a moving nozzle, or one
   bad guess don't trigger false alarms.
2. **"Why did it fail — and did my fix work?"** — an investigation flow where the model
   diagnoses your symptom, proposes concrete changes with a **visually verifiable**
   success signal, then watches a later snapshot (before vs. after) to confirm whether
   the change actually helped.

No cloud. No API keys. No images leave your machine.

---

## Why local models?

Print monitoring means sending a near-constant stream of images of your home/workshop to
*something*. This project deliberately keeps that on your own hardware, and is engineered
so that **small** models (it ships defaulting to the 4B-parameter `gemma3:4b`) are
accurate enough to be useful. See [Designed for small models](#designed-for-small-models).

## Features

- 🔌 **Pluggable camera sources** — OctoPrint snapshot/stream, any MJPEG/HTTP camera,
  a local USB webcam (via ffmpeg), or a watched folder. One interface, swap freely.
- 🧠 **Pluggable vision backend** — defaults to Ollama; the `VisionProvider` interface
  makes it easy to add a cloud model for optional escalation on uncertain calls.
- ✅ **Double-checked verdicts** — self-consistency voting + cross-frame confirmation,
  with an explicit *uncertain* state instead of a forced yes/no.
- 🛠️ **Diagnose → change → verify loop** — closes the loop on troubleshooting by
  visually comparing before/after.
- 📊 **Local web dashboard** — live view, check history, and a troubleshooting panel,
  with a live activity feed over Server-Sent Events.
- 🗃️ **Zero heavy deps** — JSON-file storage, no database server, no native build steps
  beyond `sharp`.

## Quick start

```bash
# 1. Install Ollama and pull a vision model (gemma3:4b is the default).
#    https://ollama.com
ollama pull gemma3:4b

# 2. Clone and run.
git clone https://github.com/amosroger91/printjob-llm-webcam-monitor.git
cd printjob-llm-webcam-monitor
npm install
npm run dev
```

Open **http://127.0.0.1:8787** and click **Check now**.

> First run with no camera configured still loads the dashboard — set your camera URL in
> `config.json` (below) and you're live.

## Configuring the camera

Edit `config.json` → `camera`. The tool is source-agnostic:

| `type`          | Use it for                                                | Set                  |
|-----------------|-----------------------------------------------------------|----------------------|
| `http-snapshot` | OctoPrint `?action=snapshot`, mjpg-streamer, any JPEG URL | `url`                |
| `mjpeg`         | An MJPEG stream (OctoPrint `?action=stream`)              | `url`                |
| `usb`           | A webcam on this machine (requires `ffmpeg` on PATH)      | `usbDevice`          |
| `folder`        | A directory other tools drop snapshots into               | `folderPath`         |

> **OctoPrint users:** the webcam is just a normal MJPEG/snapshot endpoint. Point
> `http-snapshot` at `http://<octoprint-host>/webcam/?action=snapshot`.

List Windows webcam device names for `usb`:

```bash
ffmpeg -list_devices true -f dshow -i dummy
```

Handy env overrides (no file edit needed): `PW_CAMERA_URL`, `PW_CAMERA_TYPE`,
`PW_MODEL`, `PW_OLLAMA_URL`, `PW_PORT`.

## Designed for small models

A 4B model can do this reliably because the work is shaped to its strengths. Every lever
is in `config.json`:

- **Preprocessing (`sharp`)** — frames are downscaled (`image.maxSize`), optionally
  cropped to just the print bed (`image.crop`), and contrast-normalized
  (`image.normalize`) so the model sees a clean, relevant image cheaply.
- **Structured output** — the model fills a fixed JSON schema (via Ollama's `format`),
  one boolean slot per known failure mode (spaghetti, detachment, blobs, stringing,
  layer shift). Fixed slots are far more reliable for small models than free-form text.
- **Decomposition** — asking about each failure mode explicitly beats one vague
  "is anything wrong?" question.
- **Double-check** — `check.samples` model passes per frame (majority vote) ×
  `check.frames` frames spaced `check.frameDelayMs` apart. A real failure persists; noise
  doesn't.
- **Honest uncertainty** — below `check.confidenceThreshold`, the verdict is reported as
  *uncertain* (a natural hook for escalating to a larger model).
- **Comparison over absolutes** — troubleshooting captures a baseline and verifies by
  comparing before/after, which is much easier for a small model than judging in a vacuum.

### Recommended models

| Model                 | Pull                              | Notes                                  |
|-----------------------|-----------------------------------|----------------------------------------|
| `gemma3:4b` (default) | `ollama pull gemma3:4b`           | Fast, runs on modest hardware          |
| `qwen2.5vl:7b`        | `ollama pull qwen2.5vl:7b`        | Stronger reasoning, best quality/size  |
| `llama3.2-vision:11b` | `ollama pull llama3.2-vision:11b` | Strong, heavier                        |
| `moondream`           | `ollama pull moondream`           | Tiny/fast for the frequent check       |

> On CPU, a single model pass on a 4B model is ~30–40s, so the default 2×2 double-check
> takes a couple of minutes. Use a smaller model or a GPU for snappier checks.

## How it works

```
 webcam ──► capture/  ──► image/ ──► ai/ (Ollama) ──► analysis/ ──► store/ ──► dashboard
            (source)     (sharp)     (vision+JSON)    (vote/verify)  (JSON)    (web/ + SSE)
```

- **`capture/`** — `CaptureSource` implementations (`http-snapshot`, `mjpeg`, `usb`, `folder`).
- **`image/`** — `sharp` preprocessing + before/after stitching.
- **`ai/`** — `VisionProvider` interface, Ollama implementation, and the small-model-tuned
  prompts & JSON schemas.
- **`analysis/`** — `failureCheck` (double-check) and `troubleshoot` (diagnose → verify).
- **`store/`** — JSON-file persistence of checks, sessions, and snapshots.
- **`server/`** — Express API + SSE; serves the static dashboard in `web/`.

## API

| Method | Path                              | Description                              |
|--------|-----------------------------------|------------------------------------------|
| GET    | `/api/status`                     | Camera + model health, current config    |
| GET    | `/api/snapshot`                   | Live preprocessed frame (JPEG)           |
| POST   | `/api/check`                      | Run a double-checked failure inspection  |
| GET    | `/api/checks`                     | Recent check history                     |
| POST   | `/api/troubleshoot`               | Start an investigation (`{ symptom }`)   |
| POST   | `/api/troubleshoot/:id/verify`    | Verify an applied change worked          |
| GET    | `/api/sessions` · `/api/sessions/:id` | Troubleshooting sessions             |
| GET    | `/api/events`                     | Server-Sent Events stream (progress/alerts) |

## Development

```bash
npm run dev      # watch mode (tsx)
npm run smoke    # end-to-end pipeline smoke test against your local model
npm run build    # typecheck + emit to dist/
```

## Roadmap

- [ ] Scheduled background monitoring with desktop / ntfy / Discord alerts
- [ ] OctoPrint plugin / direct print-state awareness (only watch while printing)
- [ ] Optional cloud-model escalation for *uncertain* verdicts
- [ ] Auto-pause/cancel the print via OctoPrint API on confirmed failure
- [ ] Per-printer baselines and few-shot reference frames

Contributions toward any of these are very welcome.

## Contributing

We'd love your help — see **[CONTRIBUTING.md](CONTRIBUTING.md)** for how to get started,
the contribution roles, and the development workflow. Please also read our
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © contributors
