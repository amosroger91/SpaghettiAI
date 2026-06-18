import { config } from "./config.js";
import { store } from "./store/store.js";
import { createCaptureSource } from "./capture/index.js";
import { OllamaVisionProvider } from "./ai/ollama.js";
import { createServer } from "./server/server.js";

async function main() {
  store.init();

  const source = createCaptureSource(config.camera);
  const ai = new OllamaVisionProvider(config.ai);
  const { app } = createServer(config, source, ai);

  const { port, host } = config.server;
  app.listen(port, host, async () => {
    console.log(`\n  print-watch  →  http://${host}:${port}`);
    console.log(`  camera:  ${source.describe()}`);
    const health = await ai.health();
    console.log(`  ai:      ${ai.name} — ${health.ok ? "OK" : "⚠ " + health.detail}`);
    if (!health.ok) {
      console.log(`           (the dashboard still loads; fix the model/server and retry a check)`);
    }
    console.log("");
  });
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
