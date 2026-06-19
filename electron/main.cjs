// Electron wrapper that boots the print-watch server in-process and shows the
// dashboard in a desktop window. Build first (`npm run build`) so dist/ exists.
const { app, BrowserWindow, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PW_PORT || 8787);

// Keep all writable state (snapshots, store.json) in a per-user folder so a
// read-only install location still works.
process.env.PW_DATA_DIR = process.env.PW_DATA_DIR || path.join(app.getPath("userData"), "data");

async function startServer() {
  // dist/index.js is ESM; load it via dynamic import to boot the Express server.
  const entry = path.join(__dirname, "..", "dist", "index.js");
  await import(pathToFileURL(entry).href);
}

function waitForServer(timeoutMs = 25000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`http://${HOST}:${PORT}/api/status`, (res) => {
        res.destroy();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) reject(new Error("server did not come up"));
        else setTimeout(tick, 400);
      });
    };
    tick();
  });
}

// Is the Ollama model ready yet?
function modelReady() {
  return new Promise((resolve) => {
    const req = http.get(`http://${HOST}:${PORT}/api/status`, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        try {
          resolve(!!JSON.parse(body).ai?.ok);
        } catch {
          resolve(false);
        }
      });
    });
    req.on("error", () => resolve(false));
  });
}

// First-run: install Ollama + pull the model using our bundled Node (the Electron
// binary in ELECTRON_RUN_AS_NODE mode), so the desktop app needs no system Node.
function bootstrapOllama() {
  const script = path.join(__dirname, "..", "scripts", "ensure-ollama.mjs");
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
  });
  child.on("error", (e) => console.error("ollama bootstrap failed:", e));
}

function createWindow(ready) {
  // Use the spaghetti icon for the window/taskbar in dev runs; the packaged app
  // gets its icon from the executable that electron-builder stamps with build/icon.ico.
  const iconPath = path.join(__dirname, "icon.png");
  const win = new BrowserWindow({
    width: 1200,
    height: 920,
    title: "SpaghettiAI",
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    backgroundColor: "#0f1115",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  // If the model isn't ready, show the setup screen (it polls and redirects to the
  // dashboard once Ollama + the model are up); otherwise go straight to the dashboard.
  win.loadURL(`http://${HOST}:${PORT}/${ready ? "" : "setup.html"}`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });
  return win;
}

// Self-update: check the GitHub releases (configured via build.publish, baked into
// app-update.yml), download a newer installer in the background, and — on the user's
// OK — run it. The NSIS installer removes the current version and installs the new one
// fresh, then relaunches. Only meaningful in a packaged build.
function setupAutoUpdate(win) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // fallback: apply on next quit if not now
  const log = (m) => console.log(`[update] ${m}`);
  autoUpdater.on("checking-for-update", () => log("checking GitHub for a newer release…"));
  autoUpdater.on("update-available", (info) => log(`update available: v${info.version} — downloading`));
  autoUpdater.on("update-not-available", () => log("already on the latest version"));
  autoUpdater.on("download-progress", (p) => log(`downloading ${Math.round(p.percent)}%`));
  autoUpdater.on("error", (err) => console.error("[update] error:", (err && (err.stack || err.message)) || err));
  autoUpdater.on("update-downloaded", async (info) => {
    log(`v${info.version} downloaded — prompting to install`);
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      buttons: ["Restart & update now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update ready",
      message: `SpaghettiAI ${info.version} is ready to install.`,
      detail: "The app will close, replace the current version with the new one, and reopen.",
    });
    if (response === 0) setImmediate(() => autoUpdater.quitAndInstall());
  });

  const check = () => autoUpdater.checkForUpdates().catch((e) => console.error("[update] check failed:", (e && e.message) || e));
  check();
  setInterval(check, 6 * 60 * 60 * 1000); // re-check every 6 h while the app stays open
}

app.whenReady().then(async () => {
  // Windows groups taskbar entries (and picks their icon) by AppUserModelID. Without
  // this the running process falls back to the generic Electron taskbar icon even
  // though the window icon is correct. Must match build.appId / the installer's AUMID.
  app.setAppUserModelId("com.amosroger91.spaghettiai");
  try {
    await startServer();
    await waitForServer();
  } catch (e) {
    console.error("print-watch failed to start:", e);
  }
  const ready = await modelReady();
  if (!ready) bootstrapOllama();
  const win = createWindow(ready);
  if (app.isPackaged) setupAutoUpdate(win);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(true);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
