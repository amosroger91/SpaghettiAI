import type { CameraConfig } from "../types.js";
import type { CaptureSource } from "./source.js";
import { HttpSnapshotSource } from "./httpSnapshot.js";
import { MjpegSource } from "./mjpeg.js";
import { UsbWebcamSource } from "./usbWebcam.js";
import { FolderSource } from "./folder.js";

export type { CaptureSource } from "./source.js";

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
    default:
      throw new Error(`unknown camera type: ${(cfg as CameraConfig).type}`);
  }
}
