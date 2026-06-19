// Throwaway end-to-end smoke test of the vision pipeline against a real model.
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config, DATA_DIR } from "../src/config.js";
import { store } from "../src/store/store.js";
import { FolderSource } from "../src/capture/folder.js";
import { OllamaVisionProvider } from "../src/ai/ollama.js";
import { runFailureCheck } from "../src/analysis/failureCheck.js";

const incoming = join(DATA_DIR, "incoming");
mkdirSync(incoming, { recursive: true });

// Synthesize a crude "print on a bed" image so we exercise the real pipeline.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
  <rect width="640" height="480" fill="#202020"/>
  <rect x="120" y="300" width="400" height="120" fill="#2b2b2b"/>
  <rect x="250" y="180" width="140" height="140" fill="#d8a24a"/>
</svg>`;
await sharp(Buffer.from(svg)).jpeg().toFile(join(incoming, "frame.jpg"));

store.init();
const source = new FolderSource(incoming);
const ai = new OllamaVisionProvider(config.ai);
const cfg = { ...config, check: { ...config.check, frames: 1, samples: 1 } };

console.log("running single-pass check against gemma3:4b…");
const t0 = Date.now();
const result = await runFailureCheck(source, ai, cfg, "smoke", (m) => console.log("  ", m));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
console.log(JSON.stringify({ verdict: result.verdict, confidence: result.confidence, issues: result.issues, summary: result.summary, passes: result.passes }, null, 2));
process.exit(0);
