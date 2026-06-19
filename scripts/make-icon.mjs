// Generates the SpaghettiAI app icon — a spaghetti-emoji style plate of noodles
// and meatballs — as the assets electron-builder embeds in the compiled app:
//   build/icon.png   1024x1024 master (mac/linux + source of truth)
//   build/icon.ico   multi-size Windows icon (16..256, PNG-compressed)
//   electron/icon.png runtime BrowserWindow icon (bundled in the asar)
//
// Pure vector + sharp/librsvg, so it needs no emoji font or network access.
// Run after editing the art:  node scripts/make-icon.mjs
import sharp from "sharp";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, "build");
const electronDir = path.join(root, "electron");

// ---- art ----------------------------------------------------------------
const S = 1024;
const cx = S / 2;

const pastaDark = "#C9952E";
const pastaTones = ["#F2C94C", "#F4D06A", "#E8B84B", "#EFC257", "#F6D873"];

// One wavy noodle strand, mounded up toward the middle of the plate.
function strand(i, n) {
  const t = i / (n - 1);
  const baseY = 360 + t * 300;
  const left = 235 + 30 * Math.sin(i * 1.3);
  const right = 789 - 30 * Math.cos(i * 0.9);
  const amp = 24 + 18 * Math.sin(i * 2.1);
  const freq = 2.0 + (i % 3) * 0.6;
  const phase = i * 1.7;
  const steps = 46;
  const pts = [];
  for (let s = 0; s <= steps; s++) {
    const u = s / steps;
    const x = left + (right - left) * u;
    const bulge = 64 * Math.sin(Math.PI * u) * (0.45 + 0.55 * (1 - t));
    const y = baseY + amp * Math.sin(freq * Math.PI * u + phase) - bulge;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return { d: "M" + pts.join(" L"), tone: pastaTones[i % pastaTones.length] };
}

const N = 15;
let noodleShadow = "";
let noodleLight = "";
for (let i = 0; i < N; i++) {
  const { d, tone } = strand(i, N);
  noodleShadow += `<path d="${d}" fill="none" stroke="${pastaDark}" stroke-width="34" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>`;
  noodleLight += `<path d="${d}" fill="none" stroke="${tone}" stroke-width="23" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function meatball(x, y, r) {
  return `
    <circle cx="${x}" cy="${y}" r="${r}" fill="url(#mb)"/>
    <ellipse cx="${x - r * 0.32}" cy="${y - r * 0.36}" rx="${r * 0.4}" ry="${r * 0.27}" fill="#ffffff" opacity="0.32"/>`;
}

function leaf(x, y, rot) {
  return `<g transform="translate(${x} ${y}) rotate(${rot})">
    <path d="M0,0 C 20,-28 20,-66 0,-90 C -20,-66 -20,-28 0,0 Z" fill="url(#leaf)"/>
    <path d="M0,-6 L0,-80" stroke="#2f7d18" stroke-width="4" opacity="0.7"/>
  </g>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <radialGradient id="mb" cx="35%" cy="30%" r="75%">
      <stop offset="0%" stop-color="#E2613F"/>
      <stop offset="55%" stop-color="#BC3B22"/>
      <stop offset="100%" stop-color="#8E2A18"/>
    </radialGradient>
    <linearGradient id="leaf" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#5FB72E"/>
      <stop offset="100%" stop-color="#3C8C1C"/>
    </linearGradient>
    <radialGradient id="plate" cx="50%" cy="42%" r="62%">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="78%" stop-color="#F2F2F0"/>
      <stop offset="100%" stop-color="#DCDDDB"/>
    </radialGradient>
    <clipPath id="mound"><ellipse cx="${cx}" cy="540" rx="300" ry="190"/></clipPath>
  </defs>

  <!-- plate -->
  <ellipse cx="${cx}" cy="598" rx="412" ry="300" fill="#000000" opacity="0.16"/>
  <ellipse cx="${cx}" cy="560" rx="410" ry="298" fill="url(#plate)"/>
  <ellipse cx="${cx}" cy="556" rx="344" ry="236" fill="#ECECE9"/>
  <ellipse cx="${cx}" cy="548" rx="318" ry="214" fill="#EC8F2E" opacity="0.16"/>

  <!-- pasta mound -->
  <g clip-path="url(#mound)">
    <ellipse cx="${cx}" cy="560" rx="300" ry="190" fill="#E7B23F"/>
    ${noodleShadow}
    ${noodleLight}
  </g>

  <!-- garnish + meatballs sitting on top -->
  ${leaf(474, 432, -12)}
  ${leaf(548, 428, 14)}
  ${meatball(430, 548, 70)}
  ${meatball(602, 560, 76)}
  ${meatball(512, 624, 62)}
</svg>`;

// ---- rasterize ----------------------------------------------------------
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
const render = (size) =>
  sharp(Buffer.from(svg))
    .resize(size, size, { fit: "contain", background: transparent })
    .png()
    .toBuffer();

// Pack PNG buffers into a Windows .ico (PNG-compressed entries, Vista+).
function buildIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const blobs = [];
  images.forEach((img, i) => {
    const e = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, e + 0);
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, e + 1);
    dir.writeUInt8(0, e + 2);
    dir.writeUInt8(0, e + 3);
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(img.data.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += img.data.length;
    blobs.push(img.data);
  });
  return Buffer.concat([header, dir, ...blobs]);
}

await mkdir(buildDir, { recursive: true });

await writeFile(path.join(buildDir, "icon.png"), await render(1024));

const sizes = [16, 24, 32, 48, 64, 128, 256];
const entries = [];
for (const size of sizes) entries.push({ size, data: await render(size) });
await writeFile(path.join(buildDir, "icon.ico"), buildIco(entries));

await writeFile(path.join(electronDir, "icon.png"), await render(256));

console.log("wrote build/icon.png (1024), build/icon.ico (" + sizes.join(",") + "), electron/icon.png (256)");
