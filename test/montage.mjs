// Tile images into a labeled contact sheet for quick visual review.
// Usage: node test/montage.mjs <dir> <outfile> [cols] [cell]
import sharp from "sharp";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const out = process.argv[3] ?? "montage.png";
const cols = Number(process.argv[4] ?? 4);
const cell = Number(process.argv[5] ?? 300);
const labelH = 22;

const files = readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
const rows = Math.ceil(files.length / cols);
const W = cols * cell;
const H = rows * (cell + labelH);

const composites = [];
for (let i = 0; i < files.length; i++) {
  const c = i % cols;
  const r = Math.floor(i / cols);
  const x = c * cell;
  const y = r * (cell + labelH);
  const img = await sharp(join(dir, files[i]))
    .resize({ width: cell, height: cell, fit: "contain", background: "#111" })
    .toBuffer();
  composites.push({ input: img, left: x, top: y + labelH });
  const label = Buffer.from(
    `<svg width="${cell}" height="${labelH}"><rect width="100%" height="100%" fill="#000"/><text x="4" y="16" font-family="monospace" font-size="14" fill="#0f0">${files[i]}</text></svg>`,
  );
  composites.push({ input: label, left: x, top: y });
}

await sharp({ create: { width: W, height: H, channels: 3, background: "#222" } })
  .composite(composites)
  .png()
  .toFile(out);
console.log(`wrote ${out} (${files.length} images, ${cols}x${rows})`);
