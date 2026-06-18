import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CaptureSource } from "./source.js";

// Returns the most recently modified image in a folder. Lets any external tool
// (a script, a different camera app) drop snapshots in and have us analyze them.
export class FolderSource implements CaptureSource {
  readonly kind = "folder";
  constructor(private dir: string) {}

  async grab(): Promise<Buffer> {
    const entries = await readdir(this.dir);
    const images = entries.filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
    if (images.length === 0) throw new Error(`no images in folder ${this.dir}`);
    let newest = images[0];
    let newestMtime = 0;
    for (const f of images) {
      const s = await stat(join(this.dir, f));
      if (s.mtimeMs > newestMtime) {
        newestMtime = s.mtimeMs;
        newest = f;
      }
    }
    return readFile(join(this.dir, newest));
  }

  describe() {
    return `Folder watch: ${this.dir}`;
  }
}
