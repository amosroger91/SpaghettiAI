// Merged dashboard: the all-camera live monitor (grid + monitoring loop + alerts)
// plus the single-camera detail tools (live view, failure check, printer ID, bed
// state, troubleshoot, history). Clicking a tile in the grid selects that camera;
// the detail panels below all operate on the selected camera via ?camera=<id>.

const $ = (id) => document.getElementById(id);
const fmtTime = (ts) => new Date(ts).toLocaleTimeString();
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&"));
const STATIC = location.search.includes("shot"); // headless capture: no SSE / intervals
const camParam = () => (selectedId ? `?camera=${encodeURIComponent(selectedId)}` : "");
const postJSON = async (url) => {
  const r = await fetch(url, { method: "POST" });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
};

let cameras = [];
let selectedId = null;
const camPreviewTimers = new Map();

function logLine(msg) {
  const d = document.createElement("div");
  d.textContent = `${fmtTime(Date.now())}  ${msg}`;
  $("log").prepend(d);
}

// ---------- labels ----------
const HEALTH = { ok: ["✓ Healthy", "ok"], failed: ["✕ Failure", "failed"], uncertain: ["? Uncertain", "uncertain"] };
const BED = {
  empty: ["🟢 Empty", "ok"], printing: ["🖨️ Printing", "uncertain"], complete: ["✅ Complete", "ok"],
  failed: ["✕ Failed", "failed"], unsure: ["? Unsure", "uncertain"],
};
const KINE = { bed_slinger: "Bed-slinger", corexy: "CoreXY", delta: "Delta", other: "Other", unknown: "Unknown" };
const verdictLabel = (v) => (v === "ok" ? "✓ Looks healthy" : v === "failed" ? "✕ Likely failure" : "? Uncertain");
const KINE_LABEL = {
  bed_slinger: "Open-frame bed-slinger (i3)", corexy: "CoreXY (boxed)", delta: "Delta",
  other: "Other / non-standard", unknown: "Unknown type",
};
const BED_LABEL = { empty: "🟢 Empty / clean", printing: "🖨️ Printing", complete: "✅ Complete", failed: "✕ Failed", unsure: "? Unsure" };
const BED_CLASS = { empty: "ok", complete: "ok", printing: "uncertain", failed: "failed", unsure: "uncertain" };

// ========================================================================
// Camera grid
// ========================================================================
function tileHtml(c) {
  return `
    <div class="cam" id="cam-${esc(c.id)}" data-id="${esc(c.id)}" tabindex="0" role="button" aria-label="Select ${esc(c.label)}">
      <div class="cam-head"><b>${esc(c.label)}</b> <span class="muted">${esc(c.kind)}</span></div>
      <div class="frame">
        <img class="cam-img" alt="${esc(c.label)} preview" />
        <div class="feed-overlay" data-role="overlay" hidden></div>
      </div>
      <div class="cam-status">
        <span class="badge" data-role="health">health —</span>
        <span class="badge" data-role="bed">bed —</span>
        <span class="badge" data-role="scene" hidden>scene —</span>
      </div>
      <div class="cam-printer muted"><span data-role="printer">printer —</span></div>
    </div>`;
}

async function loadCameras() {
  cameras = await (await fetch("/api/cameras")).json();
  $("camCount").textContent = cameras.length;
  $("grid").innerHTML = cameras.length ? cameras.map(tileHtml).join("") : `<p class="hint">No cameras yet — add one in <a href="/settings">Settings</a>, or pair a phone below.</p>`;
  cameras.forEach((c) => {
    const img = document.querySelector(`#cam-${cssEsc(c.id)} .cam-img`);
    const refresh = () => (img.src = `/api/snapshot?camera=${encodeURIComponent(c.id)}&t=${Date.now()}`);
    img.addEventListener("error", () => (img.alt = "no frame"));
    refresh();
    if (!STATIC) camPreviewTimers.set(c.id, setInterval(refresh, 3000));
    if (c.latest) renderHealthBadge(c.id, c.latest);
    if (c.latestBedState) renderBedBadge(c.id, c.latestBedState);
    if (c.latestPrinter) renderPrinterBadge(c.id, c.latestPrinter);
    if (c.latestScene) renderSceneBadge(c.id, c.latestScene);
  });
  // Clicking (or keyboard-activating) a tile selects that camera.
  document.querySelectorAll(".cam").forEach((el) => {
    el.addEventListener("click", () => selectCamera(el.dataset.id));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectCamera(el.dataset.id); }
    });
  });
  // Select the first camera by default so the detail panels are populated.
  if (cameras.length) selectCamera(cameras.find((c) => c.id === selectedId) ? selectedId : cameras[0].id);
  else setSelectedDetailEmpty();
}

const tile = (id) => $(`cam-${id}`) || document.querySelector(`#cam-${cssEsc(id)}`);
function setBadge(id, role, text, cls) {
  const el = tile(id)?.querySelector(`[data-role="${role}"]`);
  if (el) { el.className = `badge ${cls || ""}`; el.textContent = text; }
}
function renderHealthBadge(id, r) {
  const [label, cls] = HEALTH[r.verdict] || ["—", ""];
  setBadge(id, "health", `${label} ${Math.round(r.confidence * 100)}%`, cls);
}
// Each camera can be "blocked" (a red, attention-needed state) for one reason at a
// time: no bed visible, no printer in view (camera moved away), or too dark. The
// state clears itself the moment a later reading comes back clean — so when you
// point the camera back at the printer, the red overlay disappears on its own.
const blocked = {}; // cameraId -> { reason, label, detail }
const sceneByCam = {}; // cameraId -> latest SceneResult
function setBlocked(id, reason, label, detail) {
  if (reason) blocked[id] = { reason, label, detail: detail || "" };
  else delete blocked[id];
  paintTileOverlay(id);
  updateBlockOverlay();
}
function renderBedBadge(id, r) {
  if (r.bedVisible === false) { setBadge(id, "bed", "⛔ No bed", "failed"); setBlocked(id, "no_bed", "No print bed detected", r.summary); }
  else { const [label, cls] = BED[r.state] || ["—", ""]; setBadge(id, "bed", label, cls); if (blocked[id]?.reason === "no_bed") setBlocked(id, null); }
}
const SCENE_BADGE = {
  ok: ["👁️ Scene OK", "ok"],
  no_printer: ["⛔ No printer", "failed"],
  too_dark: ["🌑 Too dark", "failed"],
};
function renderSceneBadge(id, r) {
  const [label, cls] = SCENE_BADGE[r.status] || ["scene —", ""];
  const b = tile(id)?.querySelector('[data-role="scene"]');
  if (b) { b.hidden = false; b.className = `badge ${cls}`; b.textContent = label; b.title = r.summary || ""; }
  if (r.status === "no_printer") setBlocked(id, "no_printer", "No 3D printer in view", r.summary);
  else if (r.status === "too_dark") setBlocked(id, "too_dark", "Too dark to monitor", r.summary);
  else if (["no_printer", "too_dark"].includes(blocked[id]?.reason)) setBlocked(id, null);
  sceneByCam[id] = r;
  if (id === selectedId) paintPreviewOverlay();
}
// Paint the small status chip burned onto each camera tile's feed.
function paintTileOverlay(id) {
  const ov = tile(id)?.querySelector('[data-role="overlay"]');
  if (!ov) return;
  const b = blocked[id];
  if (b) { ov.hidden = false; ov.className = "feed-overlay danger"; ov.innerHTML = `<b>⛔ ${esc(b.label)}</b>`; }
  else { ov.hidden = true; ov.innerHTML = ""; }
}
function updateBlockOverlay() {
  const ids = Object.keys(blocked);
  const ov = $("nobedOverlay");
  if (!ov) return;
  if (ids.length) {
    const lines = ids.map((id) => `${cameras.find((c) => c.id === id)?.label || id}: ${blocked[id].label}`);
    $("nobedWhich").textContent = ` — ${lines.join(" · ")}`;
    ov.classList.remove("hidden");
  } else ov.classList.add("hidden");
}
function renderPrinterBadge(id, r) {
  const name = r.brand !== "unknown" && r.model !== "unknown" ? `${r.brand} ${r.model}` : r.brand !== "unknown" ? r.brand : "unidentified";
  const via = r.identifiedVia === "web" ? "🌐" : "👁️";
  const el = tile(id)?.querySelector('[data-role="printer"]');
  if (el) el.innerHTML = `${via} ${esc(name)} <span class="muted">· ${KINE[r.kinematics] || r.kinematics}</span>`;
}

// ========================================================================
// Camera selection -> drives the detail panels
// ========================================================================
function selectCamera(id) {
  selectedId = id;
  const cam = cameras.find((c) => c.id === id);
  document.querySelectorAll(".cam").forEach((el) => el.classList.toggle("selected", el.dataset.id === id));
  $("selectedLabel").textContent = cam ? cam.label : id;
  // Reset progress lines; repopulate result panels from the camera's last-known results.
  for (const p of ["checkProgress", "printerProgress", "bedProgress", "sceneProgress"]) $(p).textContent = "";
  $("tsResult").innerHTML = "";
  if (cam?.latest) renderCheck(cam.latest); else setEmpty("checkResult", "No check run yet.");
  if (cam?.latestPrinter) renderPrinter(cam.latestPrinter); else setEmpty("printerResult", "Not identified yet.");
  if (cam?.latestBedState) renderBed(cam.latestBedState); else setEmpty("bedResult", "No reading yet.");
  const sc = sceneByCam[id] || cam?.latestScene;
  if (sc) renderScene(sc); else setEmpty("sceneResult", "No reading yet.");
  refreshPreview();
  paintPreviewOverlay();
}
function setSelectedDetailEmpty() {
  selectedId = null;
  $("selectedLabel").textContent = "no camera";
  for (const [el, msg] of [["checkResult", "No check run yet."], ["printerResult", "Not identified yet."], ["bedResult", "No reading yet."]]) setEmpty(el, msg);
}
const setEmpty = (elId, msg) => { const el = $(elId); el.className = "result empty"; el.textContent = msg; };

// ---------- live preview (selected camera) ----------
function refreshPreview() {
  if (!$("autorefresh").checked || !selectedId) return;
  $("preview").src = `/api/snapshot?camera=${encodeURIComponent(selectedId)}&t=${Date.now()}`;
}
// Sleek glass overlay on the big live view: verdict + confidence, scene status,
// lighting, and a one-line description — everything we know, at a glance.
function paintPreviewOverlay() {
  const ov = $("previewOverlay");
  if (!ov || !selectedId) return;
  const cam = cameras.find((c) => c.id === selectedId);
  const check = cam?.latest;
  const scene = sceneByCam[selectedId] || cam?.latestScene;
  const blk = blocked[selectedId];
  const chips = [];
  if (check) {
    const [label, cls] = HEALTH[check.verdict] || ["—", ""];
    chips.push(`<span class="ov-chip ${cls}">${esc(label)} · ${Math.round(check.confidence * 100)}%</span>`);
  }
  if (scene) {
    const light = scene.lighting === "ok" ? "☀️ Good light" : scene.lighting === "dim" ? "🔅 Dim" : "🌑 Dark";
    chips.push(`<span class="ov-chip ${scene.lighting === "ok" ? "" : "uncertain"}">${light}${scene.brightness != null ? ` ${Math.round(scene.brightness * 100)}%` : ""}</span>`);
    chips.push(`<span class="ov-chip ${scene.printerPresent ? "ok" : "failed"}">${scene.printerPresent ? "🖨️ Printer in view" : "⛔ No printer"}</span>`);
  }
  const desc = scene?.description ? `<div class="ov-desc">${esc(scene.description)}</div>` : "";
  ov.className = "preview-overlay" + (blk ? " danger" : "");
  ov.innerHTML = chips.length || desc ? `<div class="ov-chips">${chips.join("")}</div>${desc}` : "";
  ov.hidden = !(chips.length || desc);
}
$("preview").addEventListener("error", () => ($("preview").alt = "no camera frame — check the camera in Settings"));
$("autorefresh").addEventListener("change", refreshPreview);
if (!STATIC) setInterval(refreshPreview, 5000);

// ========================================================================
// Monitoring loop (sequential across all cameras)
// ========================================================================
let running = false;
let busy = false;
let loopTimer = null;

async function runCycle() {
  if (busy || !cameras.length) return;
  busy = true;
  $("cycleState").textContent = "Checking…";
  for (const c of cameras) {
    // Scene gate first: if there's no printer in view or it's too dark, flag it
    // (red overlay + alert server-side) and SKIP the costly bed + failure passes —
    // no point asking a vision model to inspect a print that isn't there.
    let gated = false;
    try {
      const scene = await postJSON(`/api/scene?camera=${encodeURIComponent(c.id)}`);
      renderSceneBadge(c.id, scene);
      gated = scene.status !== "ok";
    } catch { /* scene check is best-effort; fall through to the full checks */ }
    if (gated) continue;

    setBadge(c.id, "bed", "bed …", "");
    try { renderBedBadge(c.id, await postJSON(`/api/bed-state?camera=${encodeURIComponent(c.id)}`)); }
    catch { setBadge(c.id, "bed", "bed err", "failed"); }
    setBadge(c.id, "health", "health …", "");
    try { renderHealthBadge(c.id, await postJSON(`/api/check?camera=${encodeURIComponent(c.id)}`)); }
    catch { setBadge(c.id, "health", "health err", "failed"); }
  }
  $("lastRun").textContent = `· last checked ${fmtTime(Date.now())}`;
  $("cycleState").textContent = running ? "Monitoring." : "Idle.";
  busy = false;
}
function scheduleNext() {
  if (!running) return;
  const secs = Math.max(5, Number($("interval").value) || 30);
  loopTimer = setTimeout(async () => { await runCycle(); scheduleNext(); }, secs * 1000);
}
$("toggleBtn").addEventListener("click", async () => {
  running = !running;
  $("toggleBtn").textContent = running ? "⏸ Stop monitoring" : "▶ Start monitoring";
  $("toggleBtn").classList.toggle("primary", !running);
  if (running) { logLine("monitoring started"); await runCycle(); scheduleNext(); }
  else { logLine("monitoring stopped"); clearTimeout(loopTimer); $("cycleState").textContent = "Idle."; }
});
$("runBtn").addEventListener("click", () => runCycle());

// ========================================================================
// Detail: failure check
// ========================================================================
$("checkBtn").addEventListener("click", async () => {
  if (!selectedId) return;
  $("checkBtn").disabled = true;
  $("checkProgress").textContent = "starting…";
  $("checkResult").className = "result empty";
  $("checkResult").textContent = "running double-checked inspection…";
  try {
    const r = await postJSON(`/api/check${camParam()}`);
    renderCheck(r);
    renderHealthBadge(selectedId, r);
    loadHistory();
  } catch (e) {
    $("checkResult").className = "result";
    $("checkResult").textContent = "error: " + e.message;
  } finally {
    $("checkBtn").disabled = false;
    $("checkProgress").textContent = "";
  }
});
function renderCheck(r) {
  const el = $("checkResult");
  el.className = "result";
  const conf = Math.round(r.confidence * 100);
  const issues = r.issues.length
    ? `<div class="tags">${r.issues.map((i) => `<span class="tag ${i.severity}">${i.type} · ${i.severity}</span>`).join("")}</div>`
    : "";
  const thumbs = (r.snapshotPaths || []).map((p) => `<img src="${p}" />`).join("");
  el.innerHTML = `
    <div class="verdict ${r.verdict}">${verdictLabel(r.verdict)}</div>
    <div class="confbar"><span style="width:${conf}%"></span></div>
    <div>${r.summary}</div>
    ${issues}
    <p class="hint">Double-check: ${r.framesAnalyzed} frame(s) × ${r.samplesPerFrame} model passes = ${r.passes.length} votes.</p>
    <div class="thumbs">${thumbs}</div>`;
}

// ---------- history (global) ----------
async function loadHistory() {
  try {
    const checks = await (await fetch("/api/checks")).json();
    if (!checks.length) { $("history").textContent = "No checks yet."; return; }
    $("history").innerHTML = checks
      .map((c) =>
        `<div class="h-item"><span class="verdict ${c.verdict}" style="margin:0;padding:2px 8px;">${verdictLabel(c.verdict)}</span>` +
        `<span>${Math.round(c.confidence * 100)}% · ${c.issues.map((i) => i.type).join(", ") || "—"}</span>` +
        `<span class="when">${fmtTime(c.ts)}</span></div>`)
      .join("");
  } catch { $("history").textContent = "—"; }
}

// ========================================================================
// Detail: printer detection
// ========================================================================
$("printerBtn").addEventListener("click", async () => {
  if (!selectedId) return;
  $("printerBtn").disabled = true;
  $("printerProgress").textContent = "starting…";
  $("printerResult").className = "result empty";
  $("printerResult").textContent = "identifying printer…";
  try {
    const r = await postJSON(`/api/printer${camParam()}`);
    renderPrinter(r);
    renderPrinterBadge(selectedId, r);
  } catch (e) {
    $("printerResult").className = "result";
    $("printerResult").textContent = "error: " + e.message;
  } finally {
    $("printerBtn").disabled = false;
    $("printerProgress").textContent = "";
  }
});
function renderPrinter(r) {
  const el = $("printerResult");
  el.className = "result";
  const conf = Math.round(r.confidence * 100);
  const name = r.brand !== "unknown" && r.model !== "unknown" ? `${r.brand} ${r.model}` : r.brand !== "unknown" ? r.brand : "Unidentified make";
  const rows = [["Type", KINE_LABEL[r.kinematics] || r.kinematics], ["Enclosure", r.enclosure], ["Visible text", r.visibleText || "—"]]
    .map(([k, v]) => `<div class="field"><b>${k}:</b> ${v}</div>`).join("");
  const via = r.identifiedVia === "web" ? `<span class="tag minor">🌐 web-identified</span>` : `<span class="tag">👁️ vision-only</span>`;
  const sources = (r.sources || []).length
    ? `<details class="sources"><summary>Sources (${r.sources.length})</summary>` +
      r.sources.map((s) => `<div class="src"><a href="${s.url}" target="_blank" rel="noopener">${s.title}</a></div>`).join("") + `</details>`
    : "";
  el.innerHTML = `
    <div class="verdict ${r.confidence >= 0.6 ? "ok" : "uncertain"}">🖨️ ${name}</div>
    <div class="confbar"><span style="width:${conf}%"></span></div>
    <div>${r.summary}</div>
    <div class="tags">${via}</div>
    ${rows}
    ${sources}
    <p class="hint">${r.votes.length} pass(es) · ${conf}% agreed on form factor.</p>
    <div class="thumbs"><img src="${r.snapshotPath}" /></div>`;
}

// ========================================================================
// Detail: bed / job state
// ========================================================================
$("bedBtn").addEventListener("click", async () => {
  if (!selectedId) return;
  $("bedBtn").disabled = true;
  $("bedProgress").textContent = "starting…";
  $("bedResult").className = "result empty";
  $("bedResult").textContent = "reading bed state…";
  try {
    const r = await postJSON(`/api/bed-state${camParam()}`);
    renderBed(r);
    renderBedBadge(selectedId, r);
  } catch (e) {
    $("bedResult").className = "result";
    $("bedResult").textContent = "error: " + e.message;
  } finally {
    $("bedBtn").disabled = false;
    $("bedProgress").textContent = "";
  }
});
function renderBed(r) {
  const el = $("bedResult");
  el.className = "result";
  const conf = Math.round(r.confidence * 100);
  el.innerHTML = `
    <div class="verdict ${BED_CLASS[r.state] || "uncertain"}">${BED_LABEL[r.state] || r.state}</div>
    <div class="confbar"><span style="width:${conf}%"></span></div>
    <div>${r.summary}</div>
    <p class="hint">${r.votes.length} pass(es) · ${conf}% agreed on "${r.state}".</p>
    <div class="thumbs"><img src="${r.snapshotPath}" /></div>`;
}

// ========================================================================
// Detail: scene gate ("what's in the picture / is there a printer / enough light")
// ========================================================================
const SCENE_VERDICT = { ok: ["✅ Looks good to monitor", "ok"], no_printer: ["⛔ No 3D printer in view", "failed"], too_dark: ["🌑 Too dark to monitor", "failed"] };
$("sceneBtn").addEventListener("click", async () => {
  if (!selectedId) return;
  $("sceneBtn").disabled = true;
  $("sceneProgress").textContent = "looking…";
  $("sceneResult").className = "result empty";
  $("sceneResult").textContent = "describing the scene…";
  try {
    const r = await postJSON(`/api/scene${camParam()}`);
    renderScene(r);
    renderSceneBadge(selectedId, r);
  } catch (e) {
    $("sceneResult").className = "result";
    $("sceneResult").textContent = "error: " + e.message;
  } finally {
    $("sceneBtn").disabled = false;
    $("sceneProgress").textContent = "";
  }
});
function renderScene(r) {
  const el = $("sceneResult");
  el.className = "result";
  const [label, cls] = SCENE_VERDICT[r.status] || ["—", ""];
  const light = r.lighting === "ok" ? "Good" : r.lighting === "dim" ? "Dim" : "Dark";
  el.innerHTML = `
    <div class="verdict ${cls}">${label}</div>
    <div>${esc(r.description || r.summary)}</div>
    <div class="field"><b>Printer in view:</b> ${r.printerPresent ? "yes" : "no"}</div>
    <div class="field"><b>Lighting:</b> ${light} (${Math.round((r.brightness ?? 0) * 100)}% brightness)</div>
    <div class="thumbs"><img src="${r.snapshotPath}" /></div>`;
}

// ========================================================================
// Detail: troubleshoot
// ========================================================================
$("tsBtn").addEventListener("click", async () => {
  const symptom = $("symptom").value.trim();
  if (!symptom || !selectedId) return;
  $("tsBtn").disabled = true;
  $("tsResult").innerHTML = `<p class="hint">analyzing the print and diagnosing…</p>`;
  try {
    const s = await (await fetch(`/api/troubleshoot${camParam()}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symptom }),
    })).json();
    if (s.error) throw new Error(s.error);
    renderSession(s);
  } catch (e) {
    $("tsResult").innerHTML = `<p class="hint">error: ${e.message}</p>`;
  } finally {
    $("tsBtn").disabled = false;
  }
});
function renderSession(s) {
  const sugg = (s.suggestions || [])
    .map((g, i) => `
      <div class="suggestion">
        <h4>${i + 1}. ${g.hypothesis}</h4>
        <div class="field"><b>Change:</b> ${g.change}</div>
        <div class="field"><b>Expected:</b> ${g.expectedOutcome}</div>
        <div class="field"><b>Watch for:</b> ${g.watchFor}</div>
        <button data-session="${s.id}" data-idx="${i}" class="verifyBtn">I made this change — verify it worked</button>
        <div class="obs-slot"></div>
      </div>`)
    .join("");
  $("tsResult").innerHTML = `<p class="hint">Baseline captured. Apply a change, then click verify to have the model watch the outcome.</p>${sugg}`;
  document.querySelectorAll(".verifyBtn").forEach((b) => b.addEventListener("click", onVerify));
}
async function onVerify(e) {
  const btn = e.currentTarget;
  const slot = btn.parentElement.querySelector(".obs-slot");
  btn.disabled = true;
  slot.innerHTML = `<p class="hint">capturing & comparing to baseline…</p>`;
  try {
    const s = await (await fetch(`/api/troubleshoot/${btn.dataset.session}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ suggestionIndex: Number(btn.dataset.idx) }),
    })).json();
    if (s.error) throw new Error(s.error);
    const o = s.observations.at(-1);
    const cls = o.verdict === "improved" ? "ok" : o.verdict === "worse" ? "failed" : "uncertain";
    slot.innerHTML = `<div class="obs"><span class="verdict ${cls}" style="margin:0;padding:2px 8px;">${o.verdict}</span> ${o.note}
      <div class="thumbs"><img src="${o.snapshotPath}" /></div></div>`;
  } catch (err) {
    slot.innerHTML = `<p class="hint">error: ${err.message}</p>`;
  } finally {
    btn.disabled = false;
  }
}

// ========================================================================
// Phone pairing
// ========================================================================
$("phoneToggle").addEventListener("click", async () => {
  const box = $("phonePair");
  const showing = !box.hidden;
  box.hidden = showing;
  $("phoneToggle").textContent = showing ? "Show QR" : "Hide QR";
  if (showing) return;
  try {
    const info = await (await fetch("/api/phone/info")).json();
    if (!info.enabled || !info.urls.length) {
      $("phoneUrls").textContent = "Phone server is disabled (set phone.enabled in settings).";
      return;
    }
    // A scannable QR + the literal URL for each address: the network (LAN) one is
    // what a phone on Wi-Fi can reach; localhost is shown for completeness.
    $("phoneQr").src = `/api/phone/qr?url=${encodeURIComponent(info.urls[0])}&t=${Date.now()}`;
    const isLocal = (u) => u.includes("localhost") || u.includes("127.0.0.1");
    $("phoneUrls").innerHTML = info.urls.map((u) => `
      <div class="qrcard">
        <span class="urltag">${isLocal(u) ? "this PC" : "network"}</span>
        <img class="qrmini" src="/api/phone/qr?url=${encodeURIComponent(u)}&t=${Date.now()}" alt="QR for ${u}" />
        <a href="${u}" target="_blank" rel="noopener">${u}</a>
      </div>`).join("");
  } catch {
    $("phoneUrls").textContent = "Could not load pairing info.";
  }
});

// ========================================================================
// Status + alerts
// ========================================================================
async function loadStatus() {
  try {
    const s = await (await fetch("/api/status")).json();
    const ok = s.ai.ok;
    $("status").innerHTML =
      `<span class="dot ${ok ? "ok" : "bad"}"></span>` +
      `${s.ai.name} · ${s.cameraKind} · ${s.check.frames}×${s.check.samples} checks` +
      (ok ? "" : ` — ${s.ai.detail}`);
  } catch {
    $("status").textContent = "server unreachable";
  }
}
async function loadAlerts() {
  try {
    const a = await (await fetch("/api/alerts")).json();
    const rows = (a.channels || [])
      .map((c) => `<div class="field"><b>${esc(c.label)}</b> — ${c.ready ? "✅ ready" : c.enabled ? "⚠ missing creds" : "off"}` +
        `${c.target ? ` <span class="muted">(${esc(c.target)})</span>` : ""}</div>`)
      .join("");
    $("alertStatus").className = "result";
    $("alertStatus").innerHTML =
      `<div class="field"><b>Alerts:</b> ${a.enabled ? "enabled" : "disabled"}${a.notifyUncertain ? " · also on uncertain" : ""}</div>` +
      (rows || '<p class="hint">No channels configured — set them up in <a href="/settings">Settings</a>.</p>');
  } catch {
    $("alertStatus").textContent = "could not load alert status";
  }
}
$("testAlertBtn").addEventListener("click", async () => {
  $("testAlertBtn").disabled = true;
  try {
    const { results, error } = await (await fetch("/api/alerts/test", { method: "POST" })).json();
    if (error) throw new Error(error);
    (results || []).forEach((r) => logLine(`test → ${r.channel}: ${r.ok ? "ok" : "FAIL " + r.detail}`));
  } catch (e) {
    logLine(`test alert error: ${e.message}`);
  } finally {
    $("testAlertBtn").disabled = false;
  }
});

// ========================================================================
// SSE: route progress + results to grid tiles AND, if it's the selected
// camera, into the detail panels.
// ========================================================================
if (!STATIC) {
  const es = new EventSource("/api/events");
  es.onmessage = (e) => {
    const evt = JSON.parse(e.data);
    const d = evt.data || {};
    const isSel = d.cameraId && d.cameraId === selectedId;
    switch (evt.type) {
      case "check:progress":
        if (d.cameraId) setBadge(d.cameraId, "health", "health …", "");
        if (isSel) $("checkProgress").textContent = d.msg;
        break;
      case "bed:progress":
        if (d.cameraId) setBadge(d.cameraId, "bed", "bed …", "");
        if (isSel) $("bedProgress").textContent = d.msg;
        break;
      case "printer:progress":
        if (isSel) $("printerProgress").textContent = d.msg;
        break;
      case "check:done":
        if (d.result) { renderHealthBadge(d.cameraId, d.result); if (isSel) renderCheck(d.result); }
        break;
      case "bed:done":
        if (d.result) { renderBedBadge(d.cameraId, d.result); if (isSel) renderBed(d.result); }
        break;
      case "printer:done":
        if (d.result) { renderPrinterBadge(d.cameraId, d.result); if (isSel) renderPrinter(d.result); }
        break;
      case "check:error": if (isSel) logLine(`check error: ${d.error}`); break;
      case "alert:sent": (d.results || []).forEach((r) => logLine(`alert → ${r.channel}: ${r.ok ? "sent" : "FAIL " + r.detail}`)); break;
      case "alert:error": logLine(`alert error: ${d.error}`); break;
      case "phone:paired": logLine(`📱 phone ${d.reconnect ? "reconnected" : "paired"}: ${d.label}`); loadCameras(); break;
      case "phone:unpaired": logLine(`📱 phone disconnected: ${d.cameraId}`); break;
      case "camera:added": loadCameras(); break;
    }
  };
}

// ---------- boot ----------
loadCameras().catch((e) => logLine("failed to load cameras: " + e.message));
loadStatus();
loadAlerts();
loadHistory();
