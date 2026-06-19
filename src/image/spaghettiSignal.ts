import sharp from "sharp";

// ---------------------------------------------------------------------------
// Classical-CV "failure prior" — a fast, deterministic, LLM-free pre-scan that
// rates how spaghetti-like a frame looks. It runs in a few milliseconds on the
// CPU and gives the pipeline a prior BEFORE the vision model is consulted, so:
//   - obvious cases can be decided (or strongly anchored) without burning model
//     passes — less heavy lifting on the local LLM, and
//   - the model gets a hint, nudging it right on the ambiguous frames.
//
// Why these features separate a print failure from a healthy print/printer:
//   * busyFraction  — spaghetti is a dense mat of thin high-contrast strands, so
//     a large FRACTION of pixels are strong edges. A solid print (even a complex
//     one) concentrates its edges on the object outline; far fewer edge pixels.
//   * incoherence   — strands point every which way, so the gradient-orientation
//     histogram is near-uniform (high entropy). A printer's own frame, gantry,
//     wires and bed are dominated by straight horizontal/vertical lines, so their
//     orientation histogram is peaky (low entropy). This is what keeps a busy
//     MACHINE photo from reading as a failure.
// The two are multiplied: a failure needs to be BOTH busy AND directionless.
// ---------------------------------------------------------------------------

export interface SpaghettiSignalConfig {
  /** Long edge (px) the frame is scaled to for analysis. Small = fast + denoised. */
  analyzeSize: number;
  /** Sobel magnitude (0..~1.4) above which a pixel counts as a strong edge. */
  edgeThreshold: number;
  /** score below this => confidently healthy; above highThreshold => confidently failed. */
  lowThreshold: number;
  highThreshold: number;
}

export const DEFAULT_SIGNAL_CFG: SpaghettiSignalConfig = {
  analyzeSize: 320,
  edgeThreshold: 0.18,
  // Calibrated on the labeled fixture set (see test/signal-eval.ts).
  lowThreshold: 0.018,
  highThreshold: 0.05,
};

export type FailLikelihood = "low" | "medium" | "high";

export interface SpaghettiSignal {
  /** 0..1 prior that the frame shows a print failure (spaghetti/tangle). */
  score: number;
  /** Coarse band derived from score vs the configured thresholds. */
  likelihood: FailLikelihood;
  /** Fraction of pixels that are strong edges (texture density). */
  busyFraction: number;
  /** Normalized entropy (0..1) of edge orientations — 1 = directionless/chaotic. */
  incoherence: number;
  /** width/height of the analyzed (downscaled) image. */
  width: number;
  height: number;
}

const ORI_BINS = 12; // gradient-orientation histogram bins over 0..π

/**
 * Compute the failure prior for a frame. Pure function of the pixels + config:
 * the same image always yields the same score (deterministic, test-friendly).
 */
export async function spaghettiSignal(
  input: Buffer,
  cfg: SpaghettiSignalConfig = DEFAULT_SIGNAL_CFG,
): Promise<SpaghettiSignal> {
  const { data, info } = await sharp(input, { failOn: "none" })
    .rotate() // honor EXIF orientation
    .grayscale()
    .resize({ width: cfg.analyzeSize, height: cfg.analyzeSize, fit: "inside", withoutEnlargement: true })
    .normalize() // stretch contrast so dim webcams still expose edges
    .raw()
    .toBuffer({ resolveWithObject: true });

  return scoreGray(data, info.width, info.height, cfg);
}

/** Core scorer, split out so tests can feed synthetic grayscale buffers directly. */
export function scoreGray(
  gray: Uint8Array | Buffer,
  width: number,
  height: number,
  cfg: SpaghettiSignalConfig = DEFAULT_SIGNAL_CFG,
): SpaghettiSignal {
  const at = (x: number, y: number) => gray[y * width + x] / 255;
  let edgePixels = 0;
  let total = 0;
  const oriHist = new Float64Array(ORI_BINS);

  // Sobel over the interior; magnitude normalized so a full black/white edge ~= 1.
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const tl = at(x - 1, y - 1), tm = at(x, y - 1), tr = at(x + 1, y - 1);
      const ml = at(x - 1, y), mr = at(x + 1, y);
      const bl = at(x - 1, y + 1), bm = at(x, y + 1), br = at(x + 1, y + 1);
      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const gy = bl + 2 * bm + br - (tl + 2 * tm + tr);
      const mag = Math.hypot(gx, gy) / 4; // /4 keeps mag in ~[0,1]
      total++;
      if (mag >= cfg.edgeThreshold) {
        edgePixels++;
        // Orientation in [0,π) (gradient direction is sign-agnostic for lines).
        let ang = Math.atan2(gy, gx);
        if (ang < 0) ang += Math.PI;
        let bin = Math.floor((ang / Math.PI) * ORI_BINS);
        if (bin >= ORI_BINS) bin = ORI_BINS - 1;
        oriHist[bin] += mag; // weight by edge strength
      }
    }
  }

  const busyFraction = total ? edgePixels / total : 0;
  const incoherence = normalizedEntropy(oriHist);

  // A failure is BOTH dense AND directionless. Multiply, then squash to 0..1.
  // The 22x gain maps the calibrated busy*incoherence range onto a usable 0..1.
  const raw = busyFraction * incoherence;
  const score = clamp01(raw * 22);

  let likelihood: FailLikelihood = "medium";
  if (score <= cfg.lowThreshold * 22) likelihood = "low";
  else if (score >= cfg.highThreshold * 22) likelihood = "high";

  return { score, likelihood, busyFraction, incoherence, width, height };
}

/** Shannon entropy of a histogram, normalized to 0..1 (1 = perfectly uniform). */
function normalizedEntropy(hist: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < hist.length; i++) sum += hist[i];
  if (sum <= 0) return 0;
  let h = 0;
  for (let i = 0; i < hist.length; i++) {
    const p = hist[i] / sum;
    if (p > 0) h -= p * Math.log(p);
  }
  return h / Math.log(hist.length);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
