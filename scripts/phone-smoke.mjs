// One-shot smoke test for the phone-camera feature: boots the built server, pairs
// a fake phone over the ingest WebSocket, pushes a JPEG, and verifies it surfaces
// as a live camera + snapshot. Runs everything in one process so the sandbox
// doesn't reap the server between steps.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import https from "node:https";
import WebSocket from "ws";
import sharp from "sharp";

const PORT = 8799;
const PHONE_PORT = 8800;
const base = `http://127.0.0.1:${PORT}`;
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.error("  ✗ " + m); } else console.log("  ✓ " + m); };

const srv = spawn(process.execPath, ["dist/index.js"], {
  env: { ...process.env, PW_PORT: String(PORT), PW_PHONE_PORT: String(PHONE_PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
srv.stdout.on("data", (d) => process.stdout.write("    [srv] " + d));
srv.stderr.on("data", (d) => process.stderr.write("    [srv:err] " + d));

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + "/api/status")).ok) return true; } catch {}
    await sleep(200);
  }
  throw new Error("server did not become ready");
}

async function main() {
  await waitReady();
  console.log("server ready\n");

  // No phone cameras paired yet (user may have other configured cameras).
  let cams = await (await fetch(base + "/api/cameras")).json();
  ok(Array.isArray(cams) && !cams.some((c) => c.kind === "push"), "starts with no phone cameras");

  // Phone pairing info + QR.
  const info = await (await fetch(base + "/api/phone/info")).json();
  ok(info.enabled && Array.isArray(info.urls), "/api/phone/info returns urls");
  const qr = await fetch(base + "/api/phone/qr");
  const qrBuf = Buffer.from(await qr.arrayBuffer());
  ok(qr.ok && qrBuf[0] === 0x89 && qrBuf.toString("latin1", 1, 4) === "PNG", "/api/phone/qr returns a PNG");

  // Pair a fake phone and push a frame.
  const frame = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .jpeg().toBuffer();

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/ingest?id=smoke&label=Smoke%20Phone`);
  const paired = await new Promise((resolve) => {
    ws.on("open", () => {});
    ws.on("message", (m) => { try { resolve(JSON.parse(m.toString())); } catch {} });
    ws.on("error", () => resolve(null));
  });
  ok(paired && paired.cameraId === "phone-smoke", `pairing assigns camera id (${paired?.cameraId})`);

  // Push frames a few times so it stays "fresh".
  for (let i = 0; i < 3; i++) { ws.send(frame); await sleep(100); }
  await sleep(200);

  cams = await (await fetch(base + "/api/cameras")).json();
  const phoneCam = cams.find((c) => c.id === "phone-smoke");
  ok(phoneCam && phoneCam.kind === "push", "phone shows up in /api/cameras as a push camera");
  ok(phoneCam && phoneCam.online === true, "phone camera reports online while streaming");

  // The pushed frame should come back through the normal snapshot path (sharp-processed).
  const snap = await fetch(base + "/api/snapshot?camera=phone-smoke");
  const snapBuf = Buffer.from(await snap.arrayBuffer());
  ok(snap.ok && snapBuf[0] === 0xff && snapBuf[1] === 0xd8, "/api/snapshot returns the phone's JPEG frame");

  // And the OctoPrint-compatible webcam endpoint serves the raw frame too.
  const webcam = await fetch(base + "/webcam?camera=phone-smoke&action=snapshot");
  const wcBuf = Buffer.from(await webcam.arrayBuffer());
  ok(webcam.ok && wcBuf[0] === 0xff && wcBuf[1] === 0xd8, "/webcam?action=snapshot serves the phone frame (USB-style)");

  // The phone page must be reachable over HTTPS (getUserMedia needs a secure context).
  const phonePage = await new Promise((resolve) => {
    https
      .get({ host: "127.0.0.1", port: PHONE_PORT, path: "/phone", rejectUnauthorized: false }, (r) => {
        let body = "";
        r.on("data", (c) => (body += c));
        r.on("end", () => resolve({ status: r.statusCode, body }));
      })
      .on("error", () => resolve(null));
  });
  ok(phonePage && phonePage.status === 200 && phonePage.body.includes("Phone camera"), "HTTPS phone page served (self-signed)");

  ws.close();
}

main()
  .catch((e) => { console.error("FATAL", e); failures++; })
  .finally(() => {
    srv.kill();
    setTimeout(() => { console.log(`\n${failures ? "❌ " + failures + " failure(s)" : "✅ all phone-camera checks passed"}`); process.exit(failures ? 1 : 0); }, 300);
  });
