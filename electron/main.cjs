// Electron wrapper that boots the print-watch server in-process and shows the
// dashboard in a desktop window. Build first (`npm run build`) so dist/ exists.
const { app, BrowserWindow, shell, dialog, Tray, Menu, nativeImage } = require("electron");
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

const iconPath = path.join(__dirname, "icon.png");
let tray = null;
let trayHintShown = false;

function createWindow(ready) {
  // Use the spaghetti icon for the window/taskbar in dev runs; the packaged app
  // gets its icon from the executable that electron-builder stamps with build/icon.ico.
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

  // Closing the window doesn't quit — it hides to the system tray so monitoring
  // keeps running in the background. The tray menu's "Quit" is the real exit.
  win.on("close", (e) => {
    if (app.isQuitting) return;
    e.preventDefault();
    win.hide();
    if (tray && !trayHintShown) {
      trayHintShown = true;
      try {
        tray.displayBalloon?.({
          title: "Still watching 🍝",
          content: "SpaghettiAI keeps monitoring in the background. Click the tray icon to reopen, or right-click → Quit to stop.",
        });
      } catch {}
    }
  });
  return win;
}

// System-tray icon so the app lives in the taskbar tray and keeps monitoring even
// with the window closed. Click to reopen; right-click for a menu.
function setupTray(getWin) {
  if (tray) return;
  try {
    const img = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
    tray = new Tray(img.isEmpty() ? img : img.resize({ width: 16, height: 16 }));
  } catch (e) {
    console.error("[tray] could not create tray:", (e && e.message) || e);
    return;
  }
  const show = () => {
    const win = getWin();
    if (!win) return;
    win.show();
    win.focus();
  };
  tray.setToolTip("SpaghettiAI — watching your prints");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open SpaghettiAI", click: show },
      { label: "Monitoring runs in the background", enabled: false },
      { type: "separator" },
      { label: "Quit SpaghettiAI", click: () => { app.isQuitting = true; app.quit(); } },
    ]),
  );
  tray.on("click", show);
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
  let win = createWindow(ready);
  setupTray(() => win || (win = createWindow(true)));
  if (app.isPackaged) setupAutoUpdate(win);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow(true);
  });
});

app.on("before-quit", () => { app.isQuitting = true; });

// With minimize-to-tray, the window hides rather than closes, so this rarely fires;
// keep the macOS convention but otherwise let the tray own the lifecycle.
app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  if (app.isQuitting) app.quit();
});
