import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { frameBrightness } from "../src/analysis/scene.js";
import { prepareImage } from "../src/image/preprocess.js";
import { enhanceForVision } from "../src/image/enhance.js";
import { bakeOverlay } from "../src/image/overlay.js";
import type { ImageConfig } from "../src/types.js";

const CFG: ImageConfig = { maxSize: 256, crop: null, normalize: true, grayscale: false, enhance: false };
const solid = (r: number, g: number, b: number) =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();

test("frameBrightness reads a near-black frame as dark and white as bright", async () => {
  const black = await frameBrightness(await solid(0, 0, 0));
  const white = await frameBrightness(await solid(255, 255, 255));
  assert.ok(black < 0.1, `black ${black} should be < 0.1`);
  assert.ok(white > 0.9, `white ${white} should be > 0.9`);
  assert.ok(black < white);
});

test("prepareImage honors the enhance flag (output differs, still valid JPEG)", async () => {
  // A noisy frame so denoise/contrast/sharpen actually change pixels.
  const noisy = await sharp({
    create: { width: 200, height: 150, channels: 3, noise: { type: "gaussian", mean: 110, sigma: 40 } },
  }).jpeg().toBuffer();

  const plain = await prepareImage(noisy, { ...CFG, enhance: false });
  const enhanced = await enhanceForVision(noisy, CFG);

  assert.ok(plain.bytes.length > 0 && enhanced.bytes.length > 0);
  assert.notEqual(plain.base64, enhanced.base64, "enhancement should change the frame");
  // Both must remain decodable images of the expected size.
  const meta = await sharp(enhanced.bytes).metadata();
  assert.equal(meta.format, "jpeg");
  assert.ok((meta.width ?? 0) <= CFG.maxSize && (meta.height ?? 0) <= CFG.maxSize);
});

test("bakeOverlay composites a status banner and returns a valid same-size JPEG", async () => {
  const frame = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 30, g: 40, b: 60 } } }).jpeg().toBuffer();
  const out = await bakeOverlay(frame, { label: "Kobra X", status: "Healthy 92%", tone: "ok", sub: "v1.0.4" });
  assert.ok(!out.equals(frame), "overlay should change the frame (no silent fallback to raw)");
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, 640);
  assert.equal(meta.height, 480);
});
