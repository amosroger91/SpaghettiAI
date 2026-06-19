import sharp from "sharp";
import type { ImageConfig } from "../types.js";

export interface PreparedImage {
  /** base64 (no data: prefix) JPEG, ready for Ollama's `images` field. */
  base64: string;
  /** raw bytes, for saving a snapshot to disk. */
  bytes: Buffer;
  width: number;
  height: number;
}

// Make a frame as easy as possible for a small vision model to read:
//  - optional ROI crop to the print bed (cuts irrelevant background tokens)
//  - downscale the long edge to maxSize (full scene, low token cost, fast)
//  - normalize contrast so dim/over-lit webcams still show detail
//  - optional grayscale (some failure cues are purely structural)
export async function prepareImage(input: Buffer, cfg: ImageConfig): Promise<PreparedImage> {
  let img = sharp(input, { failOn: "none" }).rotate(); // honor EXIF orientation

  if (cfg.crop) {
    const [left, top, width, height] = cfg.crop;
    img = img.extract({ left, top, width, height });
  }

  img = img.resize({
    width: cfg.maxSize,
    height: cfg.maxSize,
    fit: "inside",
    withoutEnlargement: true,
  });

  // Algorithmic enhancement for poor webcams (denoise + local contrast + sharpen):
  //  1) median denoise — kill sensor speckle / JPEG mosquito noise the model
  //     otherwise mistakes for fine "strands" (a false-alarm source),
  //  2) CLAHE local adaptive contrast — pulls strand detail out of dark/flat
  //     regions a global normalize() can't, without blowing out bright areas,
  //  3) unsharp — crisps the thin high-frequency strand edges the model keys on.
  // Measured on a simulated bad-webcam set: recall 55%→73%, accuracy 77%→86%,
  // precision unchanged at 100% (see test/hard-eval.ts).
  if (cfg.enhance) {
    img = img.median(3).clahe({ width: 64, height: 64, maxSlope: 3 }).sharpen({ sigma: 1 });
  }

  if (cfg.normalize) img = img.normalize();
  if (cfg.grayscale) img = img.grayscale();

  const { data, info } = await img
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return {
    base64: data.toString("base64"),
    bytes: data,
    width: info.width,
    height: info.height,
  };
}

/** Stitch two frames side by side for before/after comparison prompts. */
export async function sideBySide(a: Buffer, b: Buffer, cfg: ImageConfig): Promise<PreparedImage> {
  const half = Math.round(cfg.maxSize / 2);
  const prep = async (buf: Buffer) =>
    sharp(buf, { failOn: "none" })
      .rotate()
      .resize({ width: half, height: cfg.maxSize, fit: "inside", withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true });

  const [la, lb] = await Promise.all([prep(a), prep(b)]);
  const height = Math.max(la.info.height, lb.info.height);
  const composite = sharp({
    create: { width: la.info.width + lb.info.width, height, channels: 3, background: "#000" },
  }).composite([
    { input: la.data, left: 0, top: 0 },
    { input: lb.data, left: la.info.width, top: 0 },
  ]);

  const { data, info } = await composite.jpeg({ quality: 85, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return { base64: data.toString("base64"), bytes: data, width: info.width, height: info.height };
}
