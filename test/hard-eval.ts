// Headroom probe + A/B harness for algorithmic image enhancement.
//
// Real printer webcams are often dark, noisy, and low-res. We simulate that
// ("degrade"), then compare the vision model's accuracy with the CURRENT
// preprocessing vs an ENHANCED pipeline (denoise + local contrast + sharpen).
// Deterministic (temp 0) so runs are reproducible and comparable.
//
//   PW_MODE=clean      npx tsx test/hard-eval.ts   # sanity: clean images
//   PW_MODE=degraded   npx tsx test/hard-eval.ts   # baseline preprocess on bad frames
//   PW_MODE=enhanced   npx tsx test/hard-eval.ts   # enhanced preprocess on bad frames
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { config } from "../src/config.js";
import { prepareImage } from "../src/image/preprocess.js";
import { enhanceForVision } from "../src/image/enhance.js";
import { OllamaVisionProvider } from "../src/ai/ollama.js";
import { FAILURE_SCHEMA, FAILURE_SYSTEM, failureUserPrompt, type RawFailureJson } from "../src/ai/prompts.js";
import { rawToPass } from "../src/analysis/interpret.js";

const here = dirname(fileURLToPath(import.meta.url));
const MODE = (process.env.PW_MODE ?? "degraded") as "clean" | "degraded" | "enhanced";
// Optional resolution override so we can measure the speed/accuracy tradeoff on
// weak hardware (gemma3 vision cost scales with the long edge fed to it).
// Force enhance OFF for the baseline modes; "enhanced" mode opts in via enhanceForVision.
const IMG_CFG = { ...config.image, maxSize: Number(process.env.PW_MAXSIZE ?? config.image.maxSize), enhance: false };

interface Fixture { file: string; label: "failed" | "healthy" }
const manifest = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8")) as { fixtures: Fixture[] };

// Deterministic "bad webcam": low-res, dark, slightly soft, JPEG-crushed.
async function degrade(buf: Buffer): Promise<Buffer> {
  return sharp(buf, { failOn: "none" })
    .rotate()
    .resize({ width: 240, height: 240, fit: "inside", withoutEnlargement: true })
    .linear(0.55, 0) // darken (cheap sensor / dim enclosure)
    .blur(0.7) // soft optics
    .jpeg({ quality: 32 }) // compression artifacts
    .toBuffer();
}

const ai = new OllamaVisionProvider(config.ai);
const health = await ai.health();
if (!health.ok) { console.error(`model not ready: ${health.detail}`); process.exit(1); }
console.log(`\nhard-eval mode=${MODE} model=${config.ai.model} maxSize=${IMG_CFG.maxSize} temp=0\n`);

let tp = 0, fn = 0, fp = 0, tn = 0;
let modelMs = 0;
for (const fx of manifest.fixtures) {
  const path = join(here, "fixtures", fx.label, fx.file);
  if (!existsSync(path)) continue;
  const orig = readFileSync(path);
  const src = MODE === "clean" ? orig : await degrade(orig);
  const prepped = MODE === "enhanced" ? await enhanceForVision(src, IMG_CFG) : await prepareImage(src, IMG_CFG);
  let predicted = "healthy";
  const t0 = Date.now();
  try {
    const r = await ai.json<RawFailureJson>({
      system: FAILURE_SYSTEM, prompt: failureUserPrompt(),
      images: [prepped.base64], schema: FAILURE_SCHEMA as unknown as Record<string, unknown>, temperature: 0,
    });
    if (rawToPass(r).failed) predicted = "failed";
  } catch (e) { console.log(`  pass error ${fx.file}: ${(e as Error).message}`); }
  modelMs += Date.now() - t0;
  const correct = predicted === fx.label;
  if (fx.label === "failed") correct ? tp++ : fn++; else correct ? tn++ : fp++;
  console.log(`  ${correct ? "OK   " : "WRONG"} ${fx.label.padEnd(7)} ${fx.file.padEnd(22)} pred=${predicted}`);
}

const n = tp + fn + fp + tn;
const acc = n ? (tp + tn) / n : 0;
const recall = tp + fn ? tp / (tp + fn) : 0;
const prec = tp + fp ? tp / (tp + fp) : 0;
console.log(`\n  mode=${MODE} maxSize=${IMG_CFG.maxSize}  accuracy ${(acc*100).toFixed(1)}%  recall ${(recall*100).toFixed(0)}%  precision ${(prec*100).toFixed(0)}%  (tp=${tp} fn=${fn} fp=${fp} tn=${tn}, n=${n})  avg model ${(modelMs/n).toFixed(0)}ms/img`);
appendFileSync(join(here, "hard-eval.log"), `${new Date(config.image.maxSize && Date.now ? Date.now() : 0).toISOString?.() ?? ""} mode=${MODE} acc=${acc.toFixed(3)} recall=${recall.toFixed(2)} prec=${prec.toFixed(2)} tp=${tp} fn=${fn} fp=${fp} tn=${tn}\n`);
