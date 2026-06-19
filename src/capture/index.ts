import type { CameraConfig } from "../types.js";
import type { CaptureSource } from "./source.js";
import { HttpSnapshotSource } from "./httpSnapshot.js";
import { MjpegSource } from "./mjpeg.js";
import { UsbWebcamSource } from "./usbWebcam.js";
import { FolderSource } from "./folder.js";
import { PushSource } from "./pushSource.js";

export type { CaptureSource } from "./source.js";
export { PushSource } from "./pushSource.js";

/** A configured camera plus its live capture source. */
export interface CameraEntry {
  id: string;
  label: string;
  source: CaptureSource;
}

/**
 * Serializes grab() calls so only one runs at a time for a given camera. USB
 * webcams (and ffmpeg-per-frame capture) are single-consumer — the live preview
 * and a running check both grab the same device, and concurrent opens fail with
 * "device busy". Queueing makes them coexist instead of colliding.
 */
class SerializedSource implements CaptureSource {
  readonly kind: string;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private inner: CaptureSource) {
    this.kind = inner.kind;
  }
  grab(): Promise<Buffer> {
    const run = this.tail.then(
      () => this.inner.grab(),
      () => this.inner.grab(),
    );
    // keep the chain alive regardless of this grab's outcome
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  describe(): string {
    return this.inner.describe();
  }
}

/**
 * Register (or reuse) a phone push-camera in a live registry. Phones pair
 * dynamically — the entry is created the first time a phone connects and reused on
 * reconnect (so it keeps a stable id/history). The PushSource is stored unwrapped
 * (no SerializedSource) so the ingest socket can grab it back and feed frames in.
 */
export function registerPushCamera(
  registry: Map<string, CameraEntry>,
  id: string,
  label: string,
  staleMs?: number,
): PushSource {
  const existing = registry.get(id);
  if (existing && existing.source instanceof PushSource) {
    existing.source.setLabel(label);
    existing.label = label;
    return existing.source;
  }
  const source = new PushSource(label, staleMs);
  registry.set(id, { id, label, source });
  return source;
}

/** Build an ordered registry of capture sources, one per configured camera. */
export function createCameraRegistry(cameras: CameraConfig[]): Map<string, CameraEntry> {
  const reg = new Map<string, CameraEntry>();
  cameras.forEach((cam, i) => {
    const id = cam.id || `cam${i + 1}`;
    reg.set(id, { id, label: cam.label || id, source: new SerializedSource(createCaptureSource(cam)) });
  });
  return reg;
}

export function createCaptureSource(cfg: CameraConfig): CaptureSource {
  switch (cfg.type) {
    case "http-snapshot":
      if (!cfg.url) throw new Error("camera.url required for http-snapshot");
      return new HttpSnapshotSource(cfg.url);
    case "mjpeg":
      if (!cfg.url) throw new Error("camera.url required for mjpeg");
      return new MjpegSource(cfg.url);
    case "usb":
      return new UsbWebcamSource(cfg.usbDevice ?? "", cfg.ffmpegPath);
    case "folder":
      if (!cfg.folderPath) throw new Error("camera.folderPath required for folder");
      return new FolderSource(cfg.folderPath);
    case "push":
      // A statically-configured phone slot; frames arrive later over the ingest socket.
      return new PushSource(cfg.label || cfg.id || "phone");
    default:
      throw new Error(`unknown camera type: ${(cfg as CameraConfig).type}`);
  }
}
