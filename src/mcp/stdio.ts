// Optional MCP server for print-watch. Exposes the cameras / checks / bed-state /
// printer-detection / alerts as MCP tools over stdio, for clients like Claude
// Desktop and Claude Code. Disabled by default — enable via config.mcp.enabled
// (or PW_MCP_ENABLED=true), then run `npm run mcp`.
//
// IMPORTANT: stdout is the MCP protocol channel — never write to it. All logging
// goes to stderr (console.error).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "../config.js";
import { PrintWatchClient } from "./client.js";

if (!config.mcp.enabled) {
  console.error(
    "print-watch MCP server is disabled. Enable it with `mcp.enabled: true` in config.json " +
      "or PW_MCP_ENABLED=true, then run `npm run mcp`.",
  );
  process.exit(1);
}

const client = new PrintWatchClient(config.mcp.target);
const server = new McpServer({ name: "print-watch", version: "0.1.0" });

type Content = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (data: unknown): Content => ({
  content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});
const fail = (e: unknown): Content => ({ content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true });

const camera = { camera: z.string().optional().describe("Camera id (see list_cameras); omit for the first camera.") };

// --- read-only tools ---
server.tool("list_cameras", "List configured cameras and each one's latest results.", {}, async () => {
  try {
    return ok(await client.get("/api/cameras"));
  } catch (e) {
    return fail(e);
  }
});

server.tool("get_status", "Model health, camera list, and current config of the print-watch server.", {}, async () => {
  try {
    return ok(await client.get("/api/status"));
  } catch (e) {
    return fail(e);
  }
});

server.tool(
  "get_camera_snapshot",
  "Return a live preprocessed webcam frame (the exact image the model sees) for a camera.",
  camera,
  async ({ camera: cam }) => {
    try {
      const data = await client.snapshot(cam);
      return { content: [{ type: "image" as const, data, mimeType: "image/jpeg" }] } as unknown as Content;
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool("recent_checks", "Recent failure-check history (optionally for one camera).", camera, async ({ camera: cam }) => {
  try {
    return ok(await client.get("/api/checks", cam));
  } catch (e) {
    return fail(e);
  }
});

server.tool("alerts_status", "Show alert configuration and per-channel readiness (Slack/Discord).", {}, async () => {
  try {
    return ok(await client.get("/api/alerts"));
  } catch (e) {
    return fail(e);
  }
});

// --- action tools (these run the model / send messages) ---
server.tool(
  "check_print",
  "Run a double-checked failure inspection on a camera (multi-pass, multi-frame vote). May take a minute or two.",
  camera,
  async ({ camera: cam }) => {
    try {
      return ok(await client.post("/api/check", cam));
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "get_bed_state",
  "Classify a camera's bed/job state: empty, printing, complete, or failed.",
  camera,
  async ({ camera: cam }) => {
    try {
      return ok(await client.post("/api/bed-state", cam));
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "identify_printer",
  "Identify the printer in a camera's view (kinematics, enclosure, make/model via on-machine text + web lookup).",
  camera,
  async ({ camera: cam }) => {
    try {
      return ok(await client.post("/api/printer", cam));
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "troubleshoot",
  "Diagnose a reported print problem and propose verifiable fixes for a camera's current view.",
  { symptom: z.string().describe("What looks wrong, e.g. 'first layer not sticking on the left'."), ...camera },
  async ({ symptom, camera: cam }) => {
    try {
      return ok(await client.post("/api/troubleshoot", cam, { symptom }));
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool("send_test_alert", "Send a test alert to every ready Slack/Discord channel.", {}, async () => {
  try {
    return ok(await client.post("/api/alerts/test"));
  } catch (e) {
    return fail(e);
  }
});

// --- connect over stdio ---
await client.ping().catch((e) => console.error(`warning: ${(e as Error).message}`));
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`print-watch MCP server ready (target ${config.mcp.target}) — 10 tools exposed.`);
