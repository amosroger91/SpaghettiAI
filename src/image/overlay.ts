import sharp from "sharp";

// Bakes a sleek status banner onto a JPEG frame so the OctoPrint (mjpg-streamer)
// feed carries SpaghettiAI's verdict directly in the pixels — visible in OctoPrint,
// a browser, a timelapse, anywhere the stream is shown, with no JS overlay needed.
// Rendered as an SVG composited along the bottom edge (librsvg resolves system
// fonts; we avoid emoji, which it won't render, and use a colored status dot).

export type OverlayTone = "ok" | "warn" | "fail" | "muted";

export interface OverlayInfo {
  label: string;
  status: string;
  tone: OverlayTone;
  sub?: string;
}

const TONE_COLOR: Record<OverlayTone, string> = {
  ok: "#36d399",
  warn: "#fbbf3b",
  fail: "#ff5f6d",
  muted: "#9aa3b2",
};

const escapeXml = (s: string) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));

export async function bakeOverlay(jpeg: Buffer, info: OverlayInfo): Promise<Buffer> {
  const base = sharp(jpeg, { failOn: "none" }).rotate();
  const meta = await base.metadata();
  const W = meta.width ?? 640;
  const H = meta.height ?? 480;

  const barH = Math.min(64, Math.max(30, Math.round(H * 0.11)));
  const pad = Math.round(barH * 0.32);
  const dotR = Math.round(barH * 0.16);
  const fs = Math.round(barH * 0.42); // status font size
  const fsLabel = Math.round(barH * 0.34);
  const cy = Math.round(barH / 2);
  const color = TONE_COLOR[info.tone];
  const right = `SpaghettiAI${info.sub ? ` · ${escapeXml(info.sub)}` : ""}`;

  const svg = `<svg width="${W}" height="${barH}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0a0c14" stop-opacity="0.30"/>
      <stop offset="1" stop-color="#0a0c14" stop-opacity="0.78"/>
    </linearGradient></defs>
    <rect width="${W}" height="${barH}" fill="url(#g)"/>
    <rect width="${W}" height="2" y="0" fill="${color}" opacity="0.85"/>
    <circle cx="${pad + dotR}" cy="${cy}" r="${dotR}" fill="${color}"/>
    <text x="${pad + dotR * 2 + 10}" y="${cy}" font-family="Segoe UI, Arial, sans-serif" font-size="${fs}" font-weight="700" fill="#ffffff" dominant-baseline="central">${escapeXml(
      info.status,
    )}</text>
    <text x="${W - pad}" y="${cy}" font-family="Segoe UI, Arial, sans-serif" font-size="${fsLabel}" fill="#c9cee0" text-anchor="end" dominant-baseline="central">${escapeXml(
      info.label,
    )} — ${right}</text>
  </svg>`;

  try {
    return await base
      .composite([{ input: Buffer.from(svg), top: H - barH, left: 0 }])
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
  } catch {
    // Never let overlay rendering break the stream — fall back to the raw frame.
    return jpeg;
  }
}
