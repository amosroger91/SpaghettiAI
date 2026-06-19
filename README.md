<div align="center">

# 🍝 SpaghettiAI

**Point a webcam at your 3D printer and let a local vision model catch the spaghetti — and help you fix it.**

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
| 🟢 **"What's on the bed?"** | A one-click read of the printer's state — **empty/clean**, **printing**, **complete** (finished part ready to remove), or **failed** — voted across passes the same way. |
| 🖨️ **"What printer is this?"** | Identifies the machine in view: motion style (bed-slinger / CoreXY / delta) and enclosure, plus make/model. It **reads the branding off the machine and looks it up online** to name the exact printer instead of guessing (e.g. `ACE GEN2` → Anycubic Kobra X). |
| 📺 **Live monitor** | A grid dashboard that streams **every camera** at once and re-checks health + bed state on an interval, so you can watch a whole print farm from one tab. |
| 🔔 **Alerts** | Get a **Slack or Discord** ping the moment a failure is detected — webhook or bot, per channel. |
| 🎥 **OctoPrint feed** | Re-serves any camera in **mjpg-streamer format**, so a USB cam on this box becomes an OctoPrint webcam. |
| 🤖 **MCP server** | Optional [MCP](https://modelcontextprotocol.io) server — drive everything from Claude or any MCP client by voice/chat. |

Run it however you like: **`npm run dev`**, a one-click **desktop app** (Electron), or **Docker** for a headless box watching many cameras.

## Contents

- [Quick start](#quick-start)
- [Configure your cameras](#configure-your-cameras)
- [Live monitor](#live-monitor)
- [Alerts](#alerts)
- [Feed OctoPrint](#feed-octoprint) (use a USB cam as an OctoPrint webcam)
- [Run it your way](#run-it-your-way) (desktop · Docker)
- [MCP server](#mcp-server) (use it from Claude / any MCP client)
- [Choosing a model](#choosing-a-model)
- [Printer & bed state](#printer--bed-state)
- [How it works](#how-it-works)
- [Tuning & accuracy](#tuning--accuracy)
- [API](#api)
- [Contributing](#contributing)

## Quick start

```bash
git clone https://github.com/amosroger91/SpaghettiAI.git
cd SpaghettiAI
npm install
npm run setup    # installs Ollama if needed, starts it, pulls the vision model
npm run dev
```

`npm run setup` is the automated path — it installs Ollama (winget / Homebrew /
install.sh), launches it, and pulls the model (`gemma3:4b` by default, or `$PW_MODEL`).
Already have Ollama? It just checks and pulls the model. Prefer to do it by hand?
`ollama pull gemma3:4b` is all you need. Standalone scripts also live in
[`scripts/`](scripts) (`setup-ollama.ps1`, `setup-ollama.sh`).

Then open:

- **http://127.0.0.1:8787** — the dashboard (single-camera check / troubleshoot)
- **http://127.0.0.1:8787/monitor** — the [live monitor](#live-monitor) grid (all cameras)
- **http://127.0.0.1:8787/docs** — interactive [API docs](#api) (Swagger UI)

The dashboard loads even before a camera is configured — set one in `config.json` (below).

## Configure your cameras

Cameras live in the `cameras` array in `config.json` — **add as many as you like and mix
types freely**. Each entry has an `id` (used in the API as `?camera=id`), a `label`, a
`type`, and that type's field:

```jsonc
"cameras": [
  { "id": "kobra",  "label": "Anycubic Kobra X", "type": "usb",           "usbDevice": "video=USB 2.0 Camera" },
  { "id": "ender",  "label": "Ender 3",          "type": "mjpeg",         "url": "http://octopi.local/webcam/?action=stream" },
  { "id": "prusa",  "label": "Prusa MK4",        "type": "http-snapshot", "url": "http://prusa.local/snapshot" },
  { "id": "bench",  "label": "Bench cam",        "type": "folder",        "folderPath": "./incoming" }
]
```

| `type`          | Use it for                                                | Set         |
|-----------------|-----------------------------------------------------------|-------------|
| `http-snapshot` | OctoPrint `?action=snapshot`, mjpg-streamer, any JPEG URL | `url`       |
| `mjpeg`         | An MJPEG stream (OctoPrint `?action=stream`)              | `url`       |
| `usb`           | A webcam on this machine (needs `ffmpeg`)                  | `usbDevice` |
| `folder`        | A directory other tools drop snapshots into               | `folderPath`|

> **OctoPrint users:** the webcam is just a normal MJPEG/snapshot endpoint —
> point `http-snapshot` at `http://<octoprint-host>/webcam/?action=snapshot`.
> The legacy single `camera: { … }` object still works — it's folded into `cameras` automatically.

### USB webcam on the host PC

For a webcam plugged straight into the machine running SpaghettiAI, set `camera.type`
to `usb` and `camera.usbDevice` to the device's `ffmpeg` name. Frames are grabbed with
[`ffmpeg`](https://ffmpeg.org), so it must be installed (`winget install Gyan.FFmpeg`,
`brew install ffmpeg`, or your distro's package).

List your devices, then copy the name into `usbDevice`:

```bash
# Windows (DirectShow)
ffmpeg -list_devices true -f dshow -i dummy      # → usbDevice: "video=USB 2.0 Camera"
# macOS (AVFoundation):  usbDevice "0"   ·   Linux (V4L2):  usbDevice "/dev/video0"
```

If `ffmpeg` isn't on your `PATH` (e.g. a fresh install in an already-open terminal),
point at it with `camera.ffmpegPath` or the `PW_FFMPEG` env var.

Env overrides (no file edit needed): `PW_CAMERA_URL` · `PW_CAMERA_TYPE` · `PW_MODEL` ·
`PW_OLLAMA_URL` · `PW_PORT` · `PW_FFMPEG` (single-camera vars apply to the first camera).

## Live monitor

**http://127.0.0.1:8787/monitor** is a grid that streams **every configured camera** and,
on a timer you set, re-runs the failure check and bed-state read on each — turning a pile
of webcams into one glanceable wall.

- Set the interval (default **30 s**), hit **Start monitoring**, or **Run once**.
- Each tile shows a live frame + colour-coded **health** and **bed** badges, and an
  **Identify** button for printer detection.
- Cameras are checked independently, so one printer alerting doesn't stop the others.

> A full 2×2 failure check on a 4B CPU model takes a couple of minutes; the loop waits for
> a cycle to finish before the next, so the interval is the *gap between* cycles. For many
> cameras or snappier ticks, lower `check.samples`/`check.frames` or use a GPU.

## Alerts

Get pinged when a failure (or, optionally, an *uncertain* verdict) is detected. **Slack and
Discord** are supported, each as a **webhook** *or* a **bot (API token)**. Configure under
`alerts` in `config.json` — but **keep secrets out of the file**; prefer env vars:

| Channel             | Env vars                                            |
|---------------------|-----------------------------------------------------|
| Slack webhook       | `PW_SLACK_WEBHOOK`                                  |
| Slack bot           | `PW_SLACK_BOT_TOKEN` + `PW_SLACK_CHANNEL`           |
| Discord webhook     | `PW_DISCORD_WEBHOOK`                                |
| Discord bot         | `PW_DISCORD_BOT_TOKEN` + `PW_DISCORD_CHANNEL` (id)  |

Setting any of these enables that channel automatically. Then send a test from the monitor
page (**Send test alert**) or `POST /api/alerts/test`. Repeat failures are de-duplicated by
a `alerts.cooldownMinutes` window so you're not spammed every cycle.

```bash
# example: alert a Discord channel via webhook
PW_DISCORD_WEBHOOK="https://discord.com/api/webhooks/…" npm run dev
```

## Feed OctoPrint

Got a USB webcam on the SpaghettiAI machine and want OctoPrint (often on a different Pi) to
use it? SpaghettiAI can re-serve any camera in the **mjpg-streamer format OctoPrint expects**.
In OctoPrint → *Settings → Webcam & Timelapse*:

| OctoPrint field | Set to                                                        |
|-----------------|---------------------------------------------------------------|
| Stream URL      | `http://<SpaghettiAI-host>:8787/webcam?action=stream&camera=kobra`  |
| Snapshot URL    | `http://<SpaghettiAI-host>:8787/webcam?action=snapshot&camera=kobra` |

Serves the full-resolution camera frame (not the model-downscaled one). Tune the frame rate
with `webcam.fps`, or turn the whole thing off with `webcam.enabled: false`.

## Run it your way

**1 · Node (dev)** — `npm run dev`, open the URLs above.

**2 · Desktop app (Electron)** — a standalone, one-click product for end users, no terminal:

```bash
npm install          # fetches the Electron runtime
npm run app          # build + launch the desktop window
npm run dist         # build a one-click installer (.exe / .dmg / AppImage) into release/
```

On Windows `npm run dist` produces a **one-click `.exe` installer** (NSIS: desktop + start-menu
shortcuts, launches on finish). On first launch the app runs the **Ollama setup automatically**
— it shows a setup screen, installs/starts Ollama, pulls the model, then opens the monitor.
Data (snapshots, history) lives in your per-user app-data folder, so it runs from a read-only
install location.

> Building the installer on Windows needs **Developer Mode on** (or an elevated shell) — that's
> an [electron-builder requirement](https://www.electron.build/) for unpacking its signing
> tools, not a SpaghettiAI one. The packaged app itself is in `release/win-unpacked/`.

**3 · Docker** — best for a headless box watching lots of network cameras. Ollama runs on
the host; the container talks to it over `host.docker.internal`:

```bash
docker compose up --build      # → http://localhost:8787
```

Edit `config.json` (bind-mounted) to add your cameras; snapshots persist in a named volume.
For USB passthrough on a Linux host, uncomment the `devices:` block in `docker-compose.yml`.
A fully self-contained stack (Ollama in a container too) is included commented-out.

## MCP server

SpaghettiAI ships an optional **[MCP](https://modelcontextprotocol.io) server** so an AI
assistant (Claude Desktop / Claude Code / any MCP client) can drive it with tools —
*"check printer 2", "what's on the bed?", "show me a snapshot", "send a test alert"*.

It's **off by default**. Enable it, then run it over stdio:

```bash
PW_MCP_ENABLED=true npm run mcp     # or set mcp.enabled: true in config.json
```

It proxies to a running SpaghettiAI server (start `npm run dev` too), exposing 10 tools:
`list_cameras`, `get_status`, `get_camera_snapshot`, `check_print`, `get_bed_state`,
`identify_printer`, `troubleshoot`, `recent_checks`, `alerts_status`, `send_test_alert`.

Register it once with **Claude Code** so every new session has it:

```bash
claude mcp add SpaghettiAI -s user -e PW_MCP_ENABLED=true -- node /abs/path/dist/mcp/stdio.js
```

Or add to a **Claude Desktop** `claude_desktop_config.json`:

```jsonc
{ "mcpServers": {
  "SpaghettiAI": {
    "command": "node",
    "args": ["/abs/path/SpaghettiAI/dist/mcp/stdio.js"],
    "env": { "PW_MCP_ENABLED": "true" }
  }
} }
```

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

## Printer & bed state

Two lightweight, one-click reads that answer "what am I looking at?" — both use the same
self-consistency voting as the failure check (`check.samples` passes, majority wins).

**Bed / job state** (`POST /api/bed-state`) classifies the plate into one of:

| State | Meaning |
|-------|---------|
| `empty` | bed is clear and clean, ready for a new job |
| `printing` | a part is on the bed and the build is in progress |
| `complete` | a finished part is sitting on the bed, ready to remove |
| `failed` | the bed is occupied by a spaghetti/detached/blob mess |

**Printer detection** (`POST /api/printer`) reports motion style
(`bed_slinger` · `corexy` · `delta`), enclosure, and make/model. The vision model can
*read* the branding on a machine but doesn't *know* the product catalog — so when it sees
legible text it runs a **web lookup** and names the printer from real search results:

```
 vision reads "ACE GEN2"  ─►  DuckDuckGo search  ─►  model picks make/model from results
                                                     →  Anycubic Kobra X  (web-identified)
```

> **Privacy:** the web lookup is the *only* feature that sends anything off the machine,
> and it sends **only the short text read off the printer** — never the image. Set
> `printer.webLookup: false` in `config.json` for fully-offline, vision-only detection.
> Endpoint and result count are configurable under the `printer` block.

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
| `analysis/`  | `failureCheck`, `troubleshoot`, `bedState`, and `printerDetect`             |
| `web/`       | `ddgSearch` — text-only DuckDuckGo lookup used to ground printer make/model |
| `alerts/`    | Slack/Discord notifiers (webhook + bot) with per-key cooldown               |
| `mcp/`       | Optional MCP server (stdio) exposing the API as tools for AI clients         |
| `store/`     | JSON-file persistence of checks, sessions, bed-states, detections, snapshots|
| `server/`    | Express API + SSE; multi-camera registry; OctoPrint webcam feed; dashboards |
| `electron/`  | Desktop wrapper: boots the server, first-run Ollama setup, opens a window   |
| `scripts/`   | `ensure-ollama.mjs` + `setup-ollama.*` — automated model install/config     |

Add a `VisionProvider` to swap the model backend, or a `CaptureSource` to add a camera type
— nothing else changes. Results carry a `cameraId`, so every endpoint is per-camera via
`?camera=id`.

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

Interactive reference (Swagger UI) at **`/docs`**; raw spec at
**[`/openapi.json`](web/openapi.json)**. CORS is open so other local tools can call it.
Every per-camera endpoint accepts `?camera=<id>` (defaults to the first camera).

| Method | Path                                  | Description                          |
|--------|---------------------------------------|--------------------------------------|
| GET    | `/api/cameras`                        | Configured cameras + each one's latest results |
| GET    | `/api/status`                         | Model health, camera list, config    |
| GET    | `/api/snapshot`                       | Live preprocessed frame (JPEG)       |
| POST   | `/api/check`                          | Run a double-checked failure check   |
| GET    | `/api/checks`                         | Recent check history                 |
| POST   | `/api/bed-state`                      | Read bed/job state (empty/printing/complete/failed) |
| GET    | `/api/bed-states`                     | Recent bed-state history             |
| POST   | `/api/printer`                        | Identify the printer (+ web lookup)  |
| GET    | `/api/printers`                       | Recent printer detections            |
| GET    | `/api/alerts`                         | Alert config + per-channel readiness |
| POST   | `/api/alerts/test`                    | Send a test alert to ready channels  |
| POST   | `/api/troubleshoot`                   | Start an investigation (`{ symptom }`)|
| POST   | `/api/troubleshoot/:id/verify`        | Verify an applied change worked      |
| GET    | `/api/sessions` · `/api/sessions/:id` | Troubleshooting sessions             |
| GET    | `/api/events`                         | Server-Sent Events (progress/alerts) |
| GET    | `/webcam`                             | OctoPrint-style `?action=snapshot` / `?action=stream` (optional) |

## Development

```bash
npm run dev        # watch mode (tsx)
npm run setup      # install/configure Ollama + pull the model
npm run build      # typecheck + emit to dist/
npm run mcp        # run the MCP server (needs mcp.enabled / PW_MCP_ENABLED)
npm run app        # build + launch the Electron desktop app
npm run dist       # build a one-click desktop installer into release/
npm run docker:up  # build + run via docker compose
npm run smoke      # end-to-end pipeline smoke test
npm run eval       # accuracy eval against the labeled fixtures
```

## Roadmap

- [x] Multi-camera monitoring with a live grid dashboard
- [x] Slack / Discord alerts on failure (webhook + bot)
- [x] Desktop app (one-click installer) + Docker packaging
- [x] Optional MCP server + automated Ollama setup
- [x] OctoPrint-compatible webcam passthrough
- [ ] Scheduled background monitoring (no tab open) + ntfy/email channels
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
