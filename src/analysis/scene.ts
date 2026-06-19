import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { CaptureSource } from "../capture/index.js";
import type { VisionProvider } from "../ai/provider.js";
import { prepareImage } from "../image/preprocess.js";
import { SCENE_SCHEMA, SCENE_SYSTEM, sceneUserPrompt, type RawSceneJson } from "../ai/prompts.js";
import { store } from "../store/store.js";
import type { AppConfig, SceneResult, SceneStatus } from "../types.js";

// Below this mean luminance (0..1) we call the frame too dark to judge a print —
// purely algorithmic, so it's reliable and free even when the model would hedge.
const DARK_THRESHOLD = 0.16;
const DIM_THRESHOLD = 0.28;

/** Mean luminance (0..1) of a frame — a fast, deterministic light meter. */
export async function frameBrightness(input: Buffer): Promise<number> {
  const { channels } = await sharp(input, { failOn: "none" }).stats();
  if (!channels.length) return 0;
  // Rec.601-ish: average the channel means (grayscale-equivalent), normalize to 0..1.
  const mean = channels.slice(0, 3).reduce((s, c) => s + c.mean, 0) / Math.min(3, channels.length);
  return Math.max(0, Math.min(1, mean / 255));
}

/**
 * Situational-awareness gate, run before the expensive failure inspection:
 *   1. measure brightness algorithmically — a black/dark frame is "too_dark"
 *      without even consulting the model,
 *   2. ask the model (one pass) whether a 3D printer is in view + a description,
 *   3. fuse into a status the UI/alerts act on: ok | no_printer | too_dark.
 * "Camera moved away" falls out naturally: a printer that was present reads
 * no_printer once it leaves frame, and ok again when it returns.
 */
export async function runSceneCheck(
  source: CaptureSource,
  ai: VisionProvider,
  cfg: AppConfig,
  cameraId?: string,
  onProgress?: (msg: string) => void,
): Promise<SceneResult> {
  const id = randomUUID().slice(0, 8);
  const ts = Date.now();

  onProgress?.("Capturing frame…");
  const raw = await source.grab();
  const brightness = await frameBrightness(raw);
  const prepped = await prepareImage(raw, cfg.image);
  const snapshotPath = await store.saveSnapshot(`${id}-scene`, prepped.bytes);

  // Too dark to see anything → don't waste a model pass; the light meter is enough.
  if (brightness < DARK_THRESHOLD) {
    const result: SceneResult = {
      id, ts, cameraId,
      status: "too_dark",
      printerPresent: false,
      brightness,
      lighting: "dark",
      description: "The frame is too dark to make anything out.",
      summary: `Too dark to monitor (brightness ${(brightness * 100).toFixed(0)}%). Add light or check the camera.`,
      snapshotPath,
    };
    store.addScene(result);
    return result;
  }

  onProgress?.("Checking the scene…");
  let printerPresent = true;
  let modelLighting: RawSceneJson["lighting"] = "ok";
  let description = "";
  try {
    const json = await ai.json<RawSceneJson>({
      system: SCENE_SYSTEM,
      prompt: sceneUserPrompt(),
      images: [prepped.base64],
      schema: SCENE_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0,
    });
    printerPresent = json.printer_present !== false;
    modelLighting = json.lighting ?? "ok";
    description = (json.description ?? "").trim();
  } catch (e) {
    onProgress?.(`scene pass error: ${(e as Error).message}`);
  }

  // Fuse the light verdict: trust the algorithmic meter for "dark", let the model
  // downgrade to "dim", otherwise "ok".
  const lighting = brightness < DIM_THRESHOLD || modelLighting === "dim" ? "dim" : modelLighting === "dark" ? "dark" : "ok";

  let status: SceneStatus = "ok";
  if (!printerPresent) status = "no_printer";

  const summary = buildSummary(status, lighting, description, brightness);
  const result: SceneResult = { id, ts, cameraId, status, printerPresent, brightness, lighting, description, summary, snapshotPath };
  store.addScene(result);
  return result;
}

function buildSummary(status: SceneStatus, lighting: string, description: string, brightness: number): string {
  if (status === "too_dark") return `Too dark to monitor (brightness ${(brightness * 100).toFixed(0)}%).`;
  if (status === "no_printer")
    return `No 3D printer in view${description ? ` — ${description}` : ""}. Point the camera back at the printer.`;
  const lightNote = lighting === "dim" ? " Lighting is dim — more light would improve accuracy." : "";
  return `${description || "Printer in view."}${lightNote}`;
}
