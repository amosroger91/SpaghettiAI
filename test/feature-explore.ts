// Throwaway exploration: compute a battery of cheap CPU features per fixture and
// report which single feature best separates failed vs healthy (best-threshold
// accuracy + the gap between class means). Guides what to bake into the prior.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
interface Fixture { file: string; label: "failed" | "healthy" }
const manifest = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8")) as { fixtures: Fixture[] };

const SIZE = 320;

async function features(buf: Buffer): Promise<Record<string, number>> {
  const { data, info } = await sharp(buf, { failOn: "none" })
    .rotate().grayscale()
    .resize({ width: SIZE, height: SIZE, fit: "inside", withoutEnlargement: true })
    .normalize().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const at = (x: number, y: number) => data[y * W + x] / 255;

  let total = 0, strong = 0, flat = 0, ridge = 0;
  let gradSum = 0, gradSq = 0;
  const ori = new Float64Array(12);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const tl = at(x-1,y-1), tm = at(x,y-1), tr = at(x+1,y-1);
      const ml = at(x-1,y), c = at(x,y), mr = at(x+1,y);
      const bl = at(x-1,y+1), bm = at(x,y+1), br = at(x+1,y+1);
      const gx = tr + 2*mr + br - (tl + 2*ml + bl);
      const gy = bl + 2*bm + br - (tl + 2*tm + tr);
      const mag = Math.hypot(gx, gy) / 4;
      total++; gradSum += mag; gradSq += mag*mag;
      if (mag >= 0.18) {
        strong++;
        let a = Math.atan2(gy, gx); if (a < 0) a += Math.PI;
        ori[Math.min(11, Math.floor(a/Math.PI*12))] += mag;
      }
      if (mag < 0.04) flat++;
      // thin-ridge: center brighter/darker than BOTH opposite neighbour pairs (a line a few px wide)
      const lapH = 2*c - ml - mr, lapV = 2*c - tm - bm;
      if (Math.abs(lapH) > 0.16 || Math.abs(lapV) > 0.16) ridge++;
    }
  }
  const mean = gradSum/total;
  const variance = gradSq/total - mean*mean;
  let sum=0; for (const v of ori) sum+=v;
  let ent=0; if (sum>0) for (const v of ori){const p=v/sum; if(p>0) ent-=p*Math.log(p);}
  return {
    busy: strong/total,
    flat: flat/total,
    ridge: ridge/total,
    meanGrad: mean,
    stdGrad: Math.sqrt(Math.max(0,variance)),
    incoh: ent/Math.log(12),
    busyOverFlat: strong/(flat+1),
  };
}

interface Row { label: string; f: Record<string, number> }
const rows: Row[] = [];
for (const fx of manifest.fixtures) {
  const p = join(here, "fixtures", fx.label, fx.file);
  if (!existsSync(p)) continue;
  rows.push({ label: fx.label, f: await features(readFileSync(p)) });
}

const keys = Object.keys(rows[0].f);
function bestAcc(key: string) {
  const vals = rows.map(r => r.f[key]).sort((a,b)=>a-b);
  let best = { acc: 0, thr: 0, dir: 1 };
  for (const thr of vals) {
    for (const dir of [1, -1]) {
      let ok = 0;
      for (const r of rows) {
        const pred = dir * r.f[key] >= dir * thr ? "failed" : "healthy";
        if (pred === r.label) ok++;
      }
      const acc = ok / rows.length;
      if (acc > best.acc) best = { acc, thr, dir };
    }
  }
  const fm = rows.filter(r=>r.label==="failed").map(r=>r.f[key]);
  const hm = rows.filter(r=>r.label==="healthy").map(r=>r.f[key]);
  const avg = (a:number[])=>a.reduce((s,v)=>s+v,0)/a.length;
  return { ...best, failMean: avg(fm), healthyMean: avg(hm) };
}

console.log("\n  feature separability (best single-threshold accuracy):");
const ranked = keys.map(k => ({ k, ...bestAcc(k) })).sort((a,b)=>b.acc-a.acc);
for (const r of ranked) {
  console.log(`   ${r.k.padEnd(13)} acc=${(r.acc*100).toFixed(1)}%  thr=${r.thr.toFixed(4)} dir=${r.dir>0?"hi=fail":"lo=fail"}  failμ=${r.failMean.toFixed(4)} healthyμ=${r.healthyMean.toFixed(4)}`);
}
