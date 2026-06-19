// Build locally first, push only if it succeeds. A failed build aborts before
// anything reaches the remote. Pushes already-committed work on the current
// branch (commit first). Extra args pass through to git push.
//   npm run push                 → build, then: git push --follow-tags
//   npm run push -- origin main  → build, then: git push --follow-tags origin main
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function step(label, cmd, args) {
  console.log(`\n• ${label}: ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error(`\n✗ ${label} failed (exit ${r.status}). Not pushing.`);
    process.exit(r.status ?? 1);
  }
}

// Build gate: regenerate icon, compile TS, and package (--dir = fast, skips the
// NSIS installer but still runs the full electron-builder pack pipeline).
step("icon", "npm", ["run", "icon"]);
step("typescript", "npm", ["run", "build"]);
step("package check", "npx", ["--no-install", "electron-builder", "--dir"]);

// Build passed → push committed work (+ tags so a `v*` release tag goes up too).
step("git push", "git", ["push", "--follow-tags", ...process.argv.slice(2)]);
console.log("\n✓ build passed and pushed.");
