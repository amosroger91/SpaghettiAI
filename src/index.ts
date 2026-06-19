import http from "node:http";
import https from "node:https";
import { config } from "./config.js";
import { store } from "./store/store.js";
import { createCameraRegistry } from "./capture/index.js";
import { DispatchVisionProvider } from "./ai/dispatch.js";
import { createServer } from "./server/server.js";
import { ensureCert, lanIPv4 } from "./server/tls.js";

async function main() {
  store.init();

  const cameras = createCameraRegistry(config.cameras);
  const ai = new DispatchVisionProvider(config.ai);
  const { app, attachIngest } = createServer(config, cameras, ai);

  const { port, host } = config.server;
  const httpServer = http.createServer(app);
  attachIngest(httpServer); // allow ws:// ingest for local testing
  httpServer.listen(port, host, async () => {
    console.log(`\n  🍝 SpaghettiAI  →  http://${host}:${port}`);
    console.log(`  cameras: ${cameras.size}`);
    for (const c of cameras.values()) console.log(`    • ${c.id} (${c.label}) — ${c.source.describe()}`);
    const health = await ai.health();
    console.log(`  ai:      ${ai.name} — ${health.ok ? "OK" : "⚠ " + health.detail}`);
    if (!health.ok) {
      console.log(`           (the dashboard still loads; fix the model/server and retry a check)`);
    }
    console.log("");
  });

  // Phone capture server: HTTPS (self-signed) so getUserMedia works on the phone,
  // bound to all interfaces so LAN devices can reach it. Same app + ingest socket.
  if (config.phone.enabled) {
    try {
      const { key, cert } = await ensureCert();
      const phoneServer = https.createServer({ key, cert }, app);
      attachIngest(phoneServer);
      phoneServer.listen(config.phone.httpsPort, "0.0.0.0", () => {
        const ips = lanIPv4();
        console.log(`  📱 phone:  https://${ips[0] ?? "localhost"}:${config.phone.httpsPort}/phone`);
        if (ips.length > 1) console.log(`             (also: ${ips.slice(1).map((ip) => `https://${ip}:${config.phone.httpsPort}`).join(", ")})`);
        console.log(`             open the dashboard and scan the QR to pair your phone\n`);
      });
      phoneServer.on("error", (e) => console.error(`  ⚠ phone server: ${(e as Error).message}`));
    } catch (e) {
      console.error(`  ⚠ phone server disabled: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
