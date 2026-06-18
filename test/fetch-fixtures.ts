// Downloads the labeled evaluation images listed in fixtures.json into
// test/fixtures/<label>/<file>. Images are gitignored; this makes the set
// reproducible without committing third-party images to the repo.
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8")) as {
  fixtures: { file: string; label: string; url: string }[];
};

const UA = "printwatch-test/1.0 (https://github.com/amosroger91/printjob-llm-webcam-monitor)";

let ok = 0;
let skip = 0;
let fail = 0;
for (const f of manifest.fixtures) {
  const dir = join(here, "fixtures", f.label);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, f.file);
  if (existsSync(dest)) {
    skip++;
    continue;
  }
  try {
    const res = await fetch(f.url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500) throw new Error(`too small (${buf.length}b)`);
    writeFileSync(dest, buf);
    ok++;
    console.log(`  ok    ${f.label}/${f.file}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL  ${f.label}/${f.file}: ${(e as Error).message}`);
  }
}
console.log(`\nfetched ${ok}, skipped ${skip} (already present), failed ${fail}`);
if (fail) process.exit(1);
