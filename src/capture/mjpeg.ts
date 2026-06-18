import type { CaptureSource } from "./source.js";

// Extracts a single JPEG frame from an MJPEG (multipart/x-mixed-replace) stream,
// e.g. OctoPrint's `?action=stream`. We read the stream until we have one full
// JPEG (SOI 0xFFD8 .. EOI 0xFFD9), then abort.
export class MjpegSource implements CaptureSource {
  readonly kind = "mjpeg";
  constructor(private url: string) {}

  async grab(): Promise<Buffer> {
    const ac = new AbortController();
    const res = await fetch(this.url, { signal: ac.signal });
    if (!res.ok || !res.body) {
      ac.abort();
      throw new Error(`mjpeg fetch failed: ${res.status} ${res.statusText} (${this.url})`);
    }
    const reader = res.body.getReader();
    let buf = Buffer.alloc(0);
    const timeout = setTimeout(() => ac.abort(), 8000);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf = Buffer.concat([buf, Buffer.from(value)]);
        const start = buf.indexOf(Buffer.from([0xff, 0xd8]));
        if (start >= 0) {
          const end = buf.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
          if (end >= 0) {
            return buf.subarray(start, end + 2);
          }
        }
        if (buf.length > 8 * 1024 * 1024) throw new Error("mjpeg: no frame found in 8MB");
      }
      throw new Error("mjpeg stream ended before a full frame");
    } finally {
      clearTimeout(timeout);
      ac.abort();
    }
  }

  describe() {
    return `MJPEG stream: ${this.url}`;
  }
}
