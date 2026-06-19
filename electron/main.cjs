// Electron wrapper that boots the print-watch server in-process and shows the
// dashboard in a desktop window. Build first (`npm run build`) so dist/ exists.
const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");
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
  const win = new BrowserWindow({
    width: 1200,
    height: 920,
    title: "SpaghettiAI",
    backgroundColor: "#0f1115",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  // If the model isn't ready, show the setup screen (it polls and redirects to the
  // monitor once Ollama + the model are up); otherwise go straight to the monitor.
  win.loadURL(`http://${HOST}:${PORT}/${ready ? "monitor" : "setup.html"}`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  try {
    await startServer();
    await waitForServer();
  } catch (e) {
    console.error("print-watch failed to start:", e);
  }
  const ready = await modelReady();
  if (!ready) bootstrapOllama();
  createWindow(ready);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(true);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
