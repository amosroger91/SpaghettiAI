#!/usr/bin/env bash
# Installs Ollama (if needed), starts it, and pulls the print-watch vision model.
# Usage:  PW_MODEL=gemma3:4b ./scripts/setup-ollama.sh
set -euo pipefail
MODEL="${PW_MODEL:-gemma3:4b}"
BASE="${PW_OLLAMA_URL:-http://127.0.0.1:11434}"
log() { echo "[setup-ollama] $*" >&2; }

reachable() { curl -fsS -m 3 "$BASE/api/tags" >/dev/null 2>&1; }

if ! reachable; then
  if ! command -v ollama >/dev/null 2>&1; then
    log "Ollama not found — installing…"
    if [ "$(uname)" = "Darwin" ]; then
      if command -v brew >/dev/null 2>&1; then brew install ollama; else
        log "Install Homebrew or download Ollama from https://ollama.com/download/mac"; exit 1; fi
    else
      curl -fsSL https://ollama.com/install.sh | sh
    fi
  fi
  log "Starting ollama serve…"
  (ollama serve >/dev/null 2>&1 &) || true
  for _ in $(seq 1 45); do reachable && break; sleep 2; done
  reachable || { log "Ollama did not start. Launch it and re-run."; exit 1; }
fi
log "Ollama is running."

short="${MODEL%%:*}"
if curl -fsS -m 3 "$BASE/api/tags" | grep -q "\"$short"; then
  log "Model '$MODEL' already available."
else
  log "Pulling '$MODEL' (first time can be several GB)…"
  ollama pull "$MODEL"
fi
log "Setup complete — print-watch is ready."
