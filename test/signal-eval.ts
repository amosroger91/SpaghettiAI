// Calibration + accuracy harness for the LLM-free spaghetti prior. Pure CPU, no
// model — runs in well under a second over the whole fixture set, so it doubles
// as a fast regression guard for the algorithm.
//
//   npm run signal-eval
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spaghettiSignal, DEFAULT_SIGNAL_CFG } from "../src/image/spaghettiSignal.js";

const here = dirname(fileURLToPath(import.meta.url));
interface Fixture { file: string; label: "failed" | "healthy"; type: string }
const manifest = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8")) as { fixtures: Fixture[] };

interface Row { file: string; label: string; score: number; busy: number; incoh: number }
const rows: Row[] = [];

for (const fx of manifest.fixtures) {
  const path = join(here, "fixtures", fx.label, fx.file);
  if (!existsSync(path)) { console.log(`  (missing) ${fx.label}/${fx.file}`); continue; }
  const s = await spaghettiSignal(readFileSync(path), DEFAULT_SIGNAL_CFG);
  rows.push({ file: fx.file, label: fx.label, score: s.score, busy: s.busyFraction, incoh: s.incoherence });
}

rows.sort((a, b) => a.score - b.score);
console.log("\n  per-image signal (sorted by score):");
for (const r of rows) {
  console.log(
    `   ${r.label.padEnd(7)} ${r.file.padEnd(24)} score=${r.score.toFixed(3)} busy=${r.busy.toFixed(4)} incoh=${r.incoh.toFixed(3)}`,
  );
}

// Sweep the decision threshold on `score` and report the best accuracy.
function accAt(thr: number) {
  let tp = 0, fn = 0, fp = 0, tn = 0;
  for (const r of rows) {
    const pred = r.score >= thr ? "failed" : "healthy";
    if (r.label === "failed") pred === "failed" ? tp++ : fn++;
    else pred === "failed" ? fp++ : tn++;
  }
  return { thr, acc: (tp + tn) / rows.length, tp, fn, fp, tn };
}

let best = accAt(0);
for (let t = 0; t <= 1.0001; t += 0.005) {
  const a = accAt(t);
  if (a.acc > best.acc) best = a;
}
console.log(
  `\n  best score threshold = ${best.thr.toFixed(3)}  →  accuracy ${(best.acc * 100).toFixed(1)}%  (tp=${best.tp} fn=${best.fn} fp=${best.fp} tn=${best.tn}, n=${rows.length})`,
);

// Also report accuracy at the shipped low/high thresholds (band midpoint as the cut).
const cut = ((DEFAULT_SIGNAL_CFG.lowThreshold + DEFAULT_SIGNAL_CFG.highThreshold) / 2) * 22;
const shipped = accAt(cut);
console.log(`  shipped band midpoint cut = ${cut.toFixed(3)}  →  accuracy ${(shipped.acc * 100).toFixed(1)}%`);
