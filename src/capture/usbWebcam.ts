import { spawn } from "node:child_process";
import type { CaptureSource } from "./source.js";

// Grabs one frame from a local USB webcam via ffmpeg. On Windows this uses the
// DirectShow input ("video=<device name>"); list devices with:
//   ffmpeg -list_devices true -f dshow -i dummy
// Requires ffmpeg on PATH.
export class UsbWebcamSource implements CaptureSource {
  readonly kind = "usb";
  constructor(private device: string, private platform: NodeJS.Platform = process.platform) {}

  async grab(): Promise<Buffer> {
    const args = this.ffmpegArgs();
    return new Promise<Buffer>((resolve, reject) => {
      const ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
      const chunks: Buffer[] = [];
      let err = "";
      ff.stdout.on("data", (d) => chunks.push(d));
      ff.stderr.on("data", (d) => (err += d.toString()));
      ff.on("error", (e) =>
        reject(new Error(`ffmpeg not runnable (${(e as Error).message}). Install ffmpeg and add to PATH.`)),
      );
      ff.on("close", (code) => {
        const out = Buffer.concat(chunks);
        if (code === 0 && out.length > 100) resolve(out);
        else reject(new Error(`ffmpeg capture failed (code ${code}): ${err.slice(-400)}`));
      });
    });
  }

  private ffmpegArgs(): string[] {
    const common = ["-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-"];
    if (this.platform === "win32") {
      return ["-f", "dshow", "-i", this.device, ...common];
    }
    if (this.platform === "darwin") {
      return ["-f", "avfoundation", "-i", this.device || "0", ...common];
    }
    return ["-f", "v4l2", "-i", this.device || "/dev/video0", ...common];
  }

  describe() {
    return `USB webcam (ffmpeg): ${this.device}`;
  }
}
