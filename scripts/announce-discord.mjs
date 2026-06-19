// Post a release announcement to the configured Discord channel (bot API).
// Reads creds from .env (PW_DISCORD_BOT_TOKEN / PW_DISCORD_CHANNEL), tolerating a
// leading "Bot " on the token. One-shot: node scripts/announce-discord.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (m && !line.trimStart().startsWith("#")) {
    const v = m[2].replace(/^["']|["']$/g, "");
    if (v) process.env[m[1]] = v;
  }
}
const token = (process.env.PW_DISCORD_BOT_TOKEN ?? "").replace(/^\s*(Bot|Bearer)\s+/i, "").trim();
const channel = process.env.PW_DISCORD_CHANNEL;
if (!token || !channel) { console.error("missing PW_DISCORD_BOT_TOKEN / PW_DISCORD_CHANNEL in .env"); process.exit(1); }

const content = `🍝 **SpaghettiAI v1.0.3 is out** — hey **Forrest**! 👋

This one's a real step up in how good the failure detection actually is:
• 🧠 **Much smarter on cheap/dark webcams** — a new frame-enhancement pass (denoise → local contrast → sharpen) recovers strand detail the model used to miss. On a simulated bad-webcam test: **recall 55% → 73%**, **accuracy 77% → 86%**, and **zero new false alarms**.
• ⚡ **~40% faster on weak hardware** — runs at half resolution with no accuracy loss (12.4s vs 19.8s/frame on a CPU box), so a Pi/old laptop keeps up.
• 👁️ **Scene awareness** — it now knows when there's **no 3D printer in view** or it's **too dark**, throws a red overlay + alert, and **clears itself** the moment you point it back. Plus a sleek live overlay (verdict, confidence, lighting) and a "what's in the picture?" check.

**Install on Windows** — paste into **PowerShell**:
\`\`\`powershell
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $u='https://github.com/amosroger91/SpaghettiAI/releases/download/v1.0.3/SpaghettiAI-Setup-1.0.3.exe'; $o="$env:TEMP\\SpaghettiAI-Setup-1.0.3.exe"; Invoke-WebRequest $u -OutFile $o -UseBasicParsing; Start-Process $o
\`\`\`
(or grab it from the releases page: <https://github.com/amosroger91/SpaghettiAI/releases/latest> — if the link 404s, the build is still publishing, give it a couple minutes.)

It just needs a webcam pointed at your printer — everything runs **locally, no cloud**. First launch sets up the local AI for you.

**Please give it a spin and tell us what you think** 🙏 — what's confusing, what's missing, and would you actually leave it running on a print? Brutal honesty welcome.`;

const res = await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bot ${token}` },
  body: JSON.stringify({ content }),
  signal: AbortSignal.timeout(10_000),
});
const text = await res.text();
console.log(`${res.status} ${res.statusText}`);
console.log(text.slice(0, 300));
process.exit(res.ok ? 0 : 1);
