import type { ImageConfig } from "../types.js";
import { prepareImage, type PreparedImage } from "./preprocess.js";

// Enhancement now lives inside prepareImage() (gated on cfg.enhance) so every call
// site benefits. This thin wrapper forces it on regardless of config — used by the
// eval harness to A/B the enhanced path against the plain one.
export async function enhanceForVision(input: Buffer, cfg: ImageConfig): Promise<PreparedImage> {
  return prepareImage(input, { ...cfg, enhance: true });
}
