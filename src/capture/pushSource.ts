import type { CaptureSource } from "./source.js";

/**
 * A push-based camera: frames are pushed IN (by a phone over a WebSocket) rather
 * than pulled from a device. It just holds the most recent JPEG frame in memory.
 *
 * This is what makes "use your phone as a camera" fall out for free — once a phone
 * is feeding frames here, every consumer that calls grab() (failure checks, bed
 * state, printer detection, /api/snapshot, and the OctoPrint-compatible /webcam
 * MJPEG stream) works against the phone exactly as it would a USB cam.
 */
export class PushSource implements CaptureSource {
  readonly kind = "push";
  private latest: Buffer | null = null;
  private ts = 0;
  private waiters: ((b: Buffer) => void)[] = [];

  constructor(
    private label: string,
    /** Frames older than this are treated as "offline" by grab(). */
    private staleMs = 10000,
  ) {}

  /** Feed a fresh frame in (called per WebSocket message from the phone). */
  push(frame: Buffer): void {
    this.latest = frame;
    this.ts = Date.now();
    if (this.waiters.length) {
      const pending = this.waiters;
      this.waiters = [];
      for (const w of pending) w(frame);
    }
  }

  /** True while the phone is actively streaming (a recent frame exists). */
  get connected(): boolean {
    return !!this.latest && Date.now() - this.ts < this.staleMs;
  }

  setLabel(label: string): void {
    this.label = label;
  }

  /**
   * Return the latest frame. If one is fresh, return it immediately. Otherwise
   * wait briefly for the next pushed frame (so a check fired right after pairing,
   * or during a momentary gap, doesn't fail instantly) before giving up.
   */
  grab(): Promise<Buffer> {
    if (this.connected && this.latest) return Promise.resolve(this.latest);
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(onFrame);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`phone camera "${this.label}" sent no frame (offline?)`));
      }, 3000);
      const onFrame = (b: Buffer) => {
        clearTimeout(timer);
        resolve(b);
      };
      this.waiters.push(onFrame);
    });
  }

  describe(): string {
    return `Phone camera (push): ${this.label}${this.connected ? "" : " — offline"}`;
  }
}
