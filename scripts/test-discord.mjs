// One-shot Discord alert tester. Reads .env, posts a test message to the
// configured channel, and prints the exact HTTP status + body so we can see
// what's rejecting the request. Tries `Bot <token>` first; if that auths-fails,
// retries with `Bearer <token>` to tell us which token type you were handed.
//
//   node scripts/test-discord.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env parser (no dotenv dependency).
for (const line of readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (m && !line.trimStart().startsWith("#")) {
    const v = m[2].replace(/^["']|["']$/g, "");
    if (v) process.env[m[1]] = v;
  }
}

// Users often paste the secret with its scheme already attached ("Bot xxx" or
// "Bearer xxx"). Strip any leading scheme so we control the header prefix.
const rawToken = process.env.PW_DISCORD_BOT_TOKEN ?? "";
const token = rawToken.replace(/^\s*(Bot|Bearer)\s+/i, "").trim();
const channel = process.env.PW_DISCORD_CHANNEL;
if (!token) {
  console.error("✗ PW_DISCORD_BOT_TOKEN is empty in .env — paste your secret after the = and rerun.");
  process.exit(1);
}
if (!channel) {
  console.error("✗ PW_DISCORD_CHANNEL is empty in .env.");
  process.exit(1);
}

const url = `https://discord.com/api/v10/channels/${channel}/messages`;
const body = JSON.stringify({ content: "🍝 SpaghettiAI test alert — if you see this, alerts work." });

async function attempt(scheme) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `${scheme} ${token}` },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  console.log(`\n[${scheme}] → ${res.status} ${res.statusText}`);
  console.log(text.slice(0, 500) || "(empty body)");
  return res;
}

console.log(`POST ${url}`);
let res = await attempt("Bot");
if (res.status === 401 || res.status === 403) {
  console.log("\nBot auth failed — retrying as an OAuth Bearer token…");
  res = await attempt("Bearer");
}

if (res.ok) {
  console.log("\n✅ Message sent. The secret is valid; configure the Discord·bot channel in Settings with this scheme.");
} else {
  console.log(`\n❌ Still failing (${res.status}). See body above — that's Discord telling us why.`);
}
