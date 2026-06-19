// Update the locally-installed SpaghettiAI desktop app in place, without the NSIS
// installer (which trips Windows Defender's unsigned-temp-exe block on this box):
//   1) close the running app so its files unlock,
//   2) build the unpacked app from current code + icon (electron-builder --dir),
//   3) copy it over the existing install dir,
//   4) relaunch.
// The NSIS installer is still what CI ships to GitHub Releases for everyone else.
// Windows-only. Run: npm run reinstall
import { spawnSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform !== "win32") {
  console.error("reinstall.mjs currently supports Windows only.");
  process.exit(1);
}

const installDir = path.join(process.env.LOCALAPPDATA || "", "Programs", "spaghetti-ai");
const installedExe = path.join(installDir, "SpaghettiAI.exe");
if (!existsSync(installDir)) {
  console.error(`Install not found at ${installDir}. Run the installer once first (npm run dist → run release/*.exe).`);
  process.exit(1);
}

function run(cmd, args, ok = (s) => s === 0) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: true });
  if (!ok(r.status)) process.exit(r.status ?? 1);
  return r;
}

// 1) Close the running app (all Electron processes share the exe name).
console.log("• closing SpaghettiAI if running…");
spawnSync("taskkill", ["/IM", "SpaghettiAI.exe", "/F"], { stdio: "inherit", shell: true });

// 2) Build the unpacked app (regenerates icon → tsc → electron-builder --dir).
run("npm", ["run", "dist:dir"]);

// 3) Copy the freshly built app over the install dir. robocopy /E overwrites and
//    adds files but does NOT purge — so the NSIS uninstaller/registry stay intact.
//    robocopy exit codes < 8 are success (bit flags), >= 8 is failure.
const unpacked = path.join(root, "release", "win-unpacked");
console.log(`• copying ${path.relative(root, unpacked)} → ${installDir}`);
run("robocopy", [unpacked, installDir, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"], (s) => s < 8);

// 4) Relaunch the installed app, detached, so it survives this script exiting.
console.log("• relaunching SpaghettiAI…");
spawn(installedExe, [], { detached: true, stdio: "ignore" }).unref();
console.log("✓ updated in place and relaunched with the spaghetti icon.");
