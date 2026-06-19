// Cross-platform Ollama bootstrapper: make sure Ollama is installed, running, and
// has the vision model pulled. Used by `npm run setup` and by the desktop app on
// first launch. Plain Node (no build step) so it runs anywhere.
//
// Env: PW_MODEL (default gemma3:4b), PW_OLLAMA_URL (default http://127.0.0.1:11434).
import { spawn, spawnSync, execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const MODEL = process.env.PW_MODEL || "gemma3:4b";
const BASE = (process.env.PW_OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const log = (m) => console.error(`[setup-ollama] ${m}`);

const have = (cmd) => {
  try {
    execSync(`${process.platform === "win32" ? "where" : "command -v"} ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

async function reachable() {
  try {
    const r = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function models() {
  try {
    const r = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(2500) });
    const j = await r.json();
    return (j.models || []).map((m) => m.name);
  } catch {
    return [];
  }
}

function installOllama() {
  log("Ollama not found — installing…");
  if (process.platform === "win32") {
    if (have("winget")) {
      const r = spawnSync(
        "winget",
        ["install", "-e", "--id", "Ollama.Ollama", "--accept-source-agreements", "--accept-package-agreements", "--silent"],
        { stdio: "inherit", shell: true },
      );
      if (r.status === 0) return true;
    }
    log("Automatic install failed. Download Ollama from https://ollama.com/download/windows and re-run.");
    return false;
  }
  if (process.platform === "darwin") {
    if (have("brew")) return spawnSync("brew", ["install", "ollama"], { stdio: "inherit" }).status === 0;
    log("Install Homebrew or download Ollama from https://ollama.com/download/mac, then re-run.");
    return false;
  }
  // linux
  const r = spawnSync("sh", ["-c", "curl -fsSL https://ollama.com/install.sh | sh"], { stdio: "inherit" });
  return r.status === 0;
}

function startServe() {
  log("Starting `ollama serve` in the background…");
  try {
    const child = spawn("ollama", ["serve"], { detached: true, stdio: "ignore" });
    child.unref();
  } catch (e) {
    log(`could not start ollama serve: ${e.message}`);
  }
}

async function waitReachable(timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await reachable()) return true;
    await sleep(1500);
  }
  return false;
}

function pullModel() {
  log(`Pulling vision model "${MODEL}" (first time can be several GB — please wait)…`);
  const r = spawnSync("ollama", ["pull", MODEL], { stdio: "inherit" });
  return r.status === 0;
}

async function main() {
  log(`target ${BASE}, model ${MODEL}`);

  if (!(await reachable())) {
    if (!have("ollama")) {
      if (!installOllama()) process.exit(1);
    }
    startServe();
    if (!(await waitReachable())) {
      log("Ollama did not become reachable. Start it manually (`ollama serve`) and re-run.");
      process.exit(1);
    }
  }
  log("Ollama is running. ✓");

  const present = await models();
  const short = MODEL.split(":")[0];
  if (present.some((n) => n === MODEL || n.startsWith(short))) {
    log(`Model "${MODEL}" already available. ✓`);
  } else if (have("ollama")) {
    if (!pullModel()) {
      log(`Failed to pull ${MODEL}. Run \`ollama pull ${MODEL}\` manually.`);
      process.exit(1);
    }
    log(`Model "${MODEL}" ready. ✓`);
  } else {
    log(`Model "${MODEL}" missing and the ollama CLI isn't on PATH. Pull it from another machine or fix PATH.`);
    process.exit(1);
  }

  log("Setup complete — SpaghettiAI is ready to use. 🍝");
}

main().catch((e) => {
  log(`unexpected error: ${e.message}`);
  process.exit(1);
});
