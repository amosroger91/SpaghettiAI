const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const CAM_TYPES = ["usb", "http-snapshot", "mjpeg", "folder"];
const CAM_FIELD = { usb: "usbDevice", "http-snapshot": "url", mjpeg: "url", folder: "folderPath" };
const CAM_PH = { usb: "video=USB 2.0 Camera", "http-snapshot": "http://host/snapshot", mjpeg: "http://host/stream", folder: "./incoming" };

let cfg = {};

async function load() {
  cfg = await (await fetch("/api/config")).json();
  // simple fields
  $("ai_model").value = cfg.ai?.model ?? "";
  $("ai_baseUrl").value = cfg.ai?.baseUrl ?? "";
  $("check_samples").value = cfg.check?.samples ?? 2;
  $("check_frames").value = cfg.check?.frames ?? 2;
  $("check_frameDelayMs").value = cfg.check?.frameDelayMs ?? 4000;
  $("check_confidenceThreshold").value = cfg.check?.confidenceThreshold ?? 0.6;
  $("printer_webLookup").checked = !!cfg.printer?.webLookup;
  $("webcam_enabled").checked = !!cfg.webcam?.enabled;
  $("webcam_fps").value = cfg.webcam?.fps ?? 5;
  $("alerts_enabled").checked = !!cfg.alerts?.enabled;
  $("alerts_notifyUncertain").checked = !!cfg.alerts?.notifyUncertain;
  $("alerts_cooldownMinutes").value = cfg.alerts?.cooldownMinutes ?? 15;
  renderCameras();
  renderChannels();
}

// ---- cameras ----
function camRow(cam, i) {
  const type = cam.type || "usb";
  const field = CAM_FIELD[type];
  return `<div class="camrow" data-i="${i}">
    <input class="c-label" placeholder="Label" value="${esc(cam.label || "")}" style="width:130px" />
    <input class="c-id" placeholder="id" value="${esc(cam.id || "")}" style="width:90px" />
    <select class="c-type">${CAM_TYPES.map((t) => `<option ${t === type ? "selected" : ""}>${t}</option>`).join("")}</select>
    <input class="c-val" placeholder="${esc(CAM_PH[type])}" value="${esc(cam[field] || "")}" style="flex:1;min-width:160px" />
    <button class="small c-del">✕</button>
  </div>`;
}
function renderCameras() {
  $("cameras").innerHTML = (cfg.cameras || []).map(camRow).join("") || `<p class="hint">No cameras yet.</p>`;
  $("cameras").querySelectorAll(".c-del").forEach((b) =>
    b.addEventListener("click", (e) => {
      cfg.cameras.splice(Number(e.target.closest(".camrow").dataset.i), 1);
      renderCameras();
    }),
  );
  $("cameras").querySelectorAll(".c-type").forEach((s) =>
    s.addEventListener("change", (e) => {
      const row = e.target.closest(".camrow");
      const val = row.querySelector(".c-val");
      val.placeholder = CAM_PH[e.target.value];
    }),
  );
}
$("addCam").addEventListener("click", () => {
  cfg.cameras = cfg.cameras || [];
  cfg.cameras.push({ type: "usb", label: "", id: "" });
  renderCameras();
});

function collectCameras() {
  return [...$("cameras").querySelectorAll(".camrow")].map((row) => {
    const type = row.querySelector(".c-type").value;
    const cam = {
      label: row.querySelector(".c-label").value.trim(),
      id: row.querySelector(".c-id").value.trim(),
      type,
    };
    const v = row.querySelector(".c-val").value.trim();
    if (v) cam[CAM_FIELD[type]] = v;
    return cam;
  });
}

// ---- alert channels ----
function chanRow(ch, i) {
  const secretField = ch.mode === "bot" ? "token" : "webhookUrl";
  const secretLabel = ch.mode === "bot" ? "Bot token" : "Webhook URL";
  return `<div class="chanrow" data-i="${i}">
    <label class="chk"><input type="checkbox" class="ch-en" ${ch.enabled ? "checked" : ""} /> <b>${esc(ch.type)}</b> · ${esc(ch.mode)}</label>
    <input class="ch-secret" placeholder="${secretLabel}" value="${esc(ch[secretField] || "")}" style="flex:1;min-width:200px" />
    ${ch.mode === "bot" ? `<input class="ch-channel" placeholder="#channel / id" value="${esc(ch.channel || "")}" style="width:130px" />` : ""}
  </div>`;
}
function renderChannels() {
  const channels = cfg.alerts?.channels?.length
    ? cfg.alerts.channels
    : (cfg.alerts = cfg.alerts || {}).channels = [
        { type: "slack", mode: "webhook", enabled: false },
        { type: "slack", mode: "bot", enabled: false },
        { type: "discord", mode: "webhook", enabled: false },
        { type: "discord", mode: "bot", enabled: false },
      ];
  $("channels").innerHTML = channels.map(chanRow).join("");
}
function collectChannels() {
  return [...$("channels").querySelectorAll(".chanrow")].map((row, i) => {
    const base = cfg.alerts.channels[i];
    const ch = { type: base.type, mode: base.mode, enabled: row.querySelector(".ch-en").checked };
    const secret = row.querySelector(".ch-secret").value;
    if (base.mode === "bot") {
      ch.token = secret;
      ch.channel = row.querySelector(".ch-channel").value.trim();
    } else {
      ch.webhookUrl = secret;
    }
    return ch;
  });
}

// ---- save ----
$("save").addEventListener("click", async () => {
  $("save").disabled = true;
  $("saveMsg").textContent = "saving…";
  const patch = {
    cameras: collectCameras(),
    ai: { model: $("ai_model").value.trim(), baseUrl: $("ai_baseUrl").value.trim() },
    check: {
      samples: Number($("check_samples").value),
      frames: Number($("check_frames").value),
      frameDelayMs: Number($("check_frameDelayMs").value),
      confidenceThreshold: Number($("check_confidenceThreshold").value),
    },
    printer: { webLookup: $("printer_webLookup").checked },
    webcam: { enabled: $("webcam_enabled").checked, fps: Number($("webcam_fps").value) },
    alerts: {
      enabled: $("alerts_enabled").checked,
      notifyUncertain: $("alerts_notifyUncertain").checked,
      cooldownMinutes: Number($("alerts_cooldownMinutes").value),
      channels: collectChannels(),
    },
  };
  try {
    const r = await (await fetch("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    })).json();
    if (r.error) throw new Error(r.error);
    cfg = r.config;
    const restart = (r.restartRequired || []).length
      ? ` ⚠ Restart to apply: ${r.restartRequired.join(", ")}.`
      : "";
    $("saveMsg").innerHTML = `✓ Saved.${restart}`;
    renderCameras();
    renderChannels();
  } catch (e) {
    $("saveMsg").textContent = "error: " + e.message;
  } finally {
    $("save").disabled = false;
  }
});

load();
