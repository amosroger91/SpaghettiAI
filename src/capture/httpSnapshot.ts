import type { CaptureSource } from "./source.js";

// Works with OctoPrint's `?action=snapshot`, mjpg-streamer, or any URL that
// returns a single JPEG when fetched. This is the recommended default.
export class HttpSnapshotSource implements CaptureSource {
  readonly kind = "http-snapshot";
  constructor(private url: string) {}

  async grab(): Promise<Buffer> {
    const res = await fetch(this.url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      throw new Error(`snapshot fetch failed: ${res.status} ${res.statusText} (${this.url})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw new Error(`snapshot too small (${buf.length} bytes) from ${this.url}`);
    return buf;
  }

  describe() {
    return `HTTP snapshot: ${this.url}`;
  }
}
