import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AppConfig, AlertChannel, CameraConfig } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..");
// Writable data location. Defaults next to the app, but a packaged desktop build
// (read-only install dir) sets PW_DATA_DIR to a per-user folder.
export const DATA_DIR = process.env.PW_DATA_DIR || join(ROOT, "data");

/** Recursively drop "comment" keys so docs in config.json don't leak into the API. */
function stripComments(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(stripComments);
  if (o && typeof o === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k === "comment") continue;
      out[k] = stripComments(v);
    }
    return out;
  }
  return o;
}

function load(): AppConfig {
  const raw = stripComments(JSON.parse(readFileSync(join(ROOT, "config.json"), "utf8"))) as AppConfig;
  // Back-compat defaults for configs written before these features existed.
  raw.printer ??= { webLookup: true, searchEndpoint: "https://html.duckduckgo.com/html/", maxResults: 5 };
  raw.alerts ??= { enabled: false, notifyUncertain: false, cooldownMinutes: 15, channels: [] };
  raw.alerts.channels ??= [];
  raw.mcp ??= { enabled: false, target: "" };
  raw.webcam ??= { enabled: true, fps: 5 };
  raw.cameras = normalizeCameras(raw);
  // Env overrides for the things you most often tweak without editing the file.
  // Single-camera env vars apply to the FIRST camera (back-compat).
  if (process.env.PW_CAMERA_URL) raw.cameras[0].url = process.env.PW_CAMERA_URL;
  if (process.env.PW_CAMERA_TYPE) raw.cameras[0].type = process.env.PW_CAMERA_TYPE as CameraConfig["type"];
  if (process.env.PW_MODEL) raw.ai.model = process.env.PW_MODEL;
  if (process.env.PW_OLLAMA_URL) raw.ai.baseUrl = process.env.PW_OLLAMA_URL;
  if (process.env.PW_PORT) raw.server.port = Number(process.env.PW_PORT);
  applyAlertEnv(raw.alerts.channels);
  if (process.env.PW_ALERTS_ENABLED) raw.alerts.enabled = process.env.PW_ALERTS_ENABLED !== "false";
  else if (raw.alerts.channels.some((c) => c.enabled)) raw.alerts.enabled = true;
  // MCP: default target to this instance's own HTTP address.
  if (process.env.PW_MCP_ENABLED) raw.mcp.enabled = process.env.PW_MCP_ENABLED !== "false";
  raw.mcp.target = process.env.PW_MCP_TARGET || raw.mcp.target || `http://${raw.server.host}:${raw.server.port}`;
  return raw as AppConfig;
}

/**
 * Resolve the camera list. Accepts the new `cameras: []` array or the legacy single
 * `camera` object (folded in), then fills stable ids/labels and de-duplicates ids.
 */
function normalizeCameras(raw: AppConfig): CameraConfig[] {
  const list = Array.isArray(raw.cameras) && raw.cameras.length ? raw.cameras : raw.camera ? [raw.camera] : [];
  if (list.length === 0) {
    // Nothing configured — a harmless placeholder so the dashboard still loads.
    list.push({ type: "http-snapshot", url: "http://localhost:8080/?action=snapshot" });
  }
  const seen = new Set<string>();
  return list.map((cam, i) => {
    let id = (cam.id || slugify(cam.label) || `cam${i + 1}`).trim();
    while (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    return { ...cam, id, label: cam.label || cam.id || `Camera ${i + 1}` };
  });
}

const slugify = (s?: string) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Inject alert secrets from the environment so tokens/URLs never live in the
 * committed config. Each env-provided credential enables (or creates) its channel.
 */
function applyAlertEnv(channels: AlertChannel[]): void {
  const upsert = (match: Partial<AlertChannel>, patch: Partial<AlertChannel>) => {
    let ch = channels.find((c) => c.type === match.type && c.mode === match.mode);
    if (!ch) {
      ch = { type: match.type!, mode: match.mode!, enabled: false };
      channels.push(ch);
    }
    Object.assign(ch, patch, { enabled: true });
  };
  if (process.env.PW_SLACK_WEBHOOK) upsert({ type: "slack", mode: "webhook" }, { webhookUrl: process.env.PW_SLACK_WEBHOOK });
  if (process.env.PW_DISCORD_WEBHOOK) upsert({ type: "discord", mode: "webhook" }, { webhookUrl: process.env.PW_DISCORD_WEBHOOK });
  if (process.env.PW_SLACK_BOT_TOKEN)
    upsert({ type: "slack", mode: "bot" }, { token: process.env.PW_SLACK_BOT_TOKEN, channel: process.env.PW_SLACK_CHANNEL });
  if (process.env.PW_DISCORD_BOT_TOKEN)
    upsert({ type: "discord", mode: "bot" }, { token: process.env.PW_DISCORD_BOT_TOKEN, channel: process.env.PW_DISCORD_CHANNEL });
}

export const config = load();
