const $ = (id) => document.getElementById(id);
const fmtTime = (ts) => new Date(ts).toLocaleTimeString();

// ---------- live preview ----------
let previewTimer = null;
function refreshPreview() {
  if (!$("autorefresh").checked) return;
  $("preview").src = `/api/snapshot?t=${Date.now()}`;
}
$("preview").addEventListener("error", () => {
  $("preview").alt = "no camera frame — check config.json camera.url";
});
$("autorefresh").addEventListener("change", refreshPreview);
previewTimer = setInterval(refreshPreview, 5000);
refreshPreview();

// ---------- status ----------
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
loadStatus();

// ---------- activity log via SSE ----------
function logLine(msg) {
  const d = document.createElement("div");
  d.textContent = `${fmtTime(Date.now())}  ${msg}`;
  $("log").prepend(d);
}
const es = new EventSource("/api/events");
es.onmessage = (e) => {
  const evt = JSON.parse(e.data);
  switch (evt.type) {
    case "check:progress": logLine(evt.data.msg); $("checkProgress").textContent = evt.data.msg; break;
    case "check:start": logLine("check started"); break;
    case "check:done": logLine(`check done: ${evt.data.verdict}`); break;
    case "check:error": logLine(`check error: ${evt.data.error}`); break;
    case "alert": logLine(`⚠ ALERT: ${evt.data.summary}`); break;
    case "ts:start": logLine(`investigating: ${evt.data.symptom}`); break;
    case "ts:diagnosed": logLine(`diagnosis ready (${evt.data.suggestions.length} suggestions)`); break;
    case "ts:verifying": logLine("verifying outcome…"); break;
    case "ts:verified": logLine(`verification: ${evt.data.observations.at(-1)?.verdict}`); break;
  }
};

// ---------- use case 1: failure check ----------
$("checkBtn").addEventListener("click", async () => {
  $("checkBtn").disabled = true;
  $("checkProgress").textContent = "starting…";
  $("checkResult").className = "result empty";
  $("checkResult").textContent = "running double-checked inspection…";
  try {
    const r = await (await fetch("/api/check", { method: "POST" })).json();
    if (r.error) throw new Error(r.error);
    renderCheck(r);
    loadHistory();
  } catch (e) {
    $("checkResult").className = "result";
    $("checkResult").textContent = "error: " + e.message;
  } finally {
    $("checkBtn").disabled = false;
    $("checkProgress").textContent = "";
  }
});

function verdictLabel(v) {
  return v === "ok" ? "✓ Looks healthy" : v === "failed" ? "✕ Likely failure" : "? Uncertain";
}

function renderCheck(r) {
  const el = $("checkResult");
  el.className = "result";
  const conf = Math.round(r.confidence * 100);
  const issues = r.issues.length
    ? `<div class="tags">${r.issues.map((i) => `<span class="tag ${i.severity}">${i.type} · ${i.severity}</span>`).join("")}</div>`
    : "";
  const thumbs = r.snapshotPaths.map((p) => `<img src="${p}" />`).join("");
  el.innerHTML = `
    <div class="verdict ${r.verdict}">${verdictLabel(r.verdict)}</div>
    <div class="confbar"><span style="width:${conf}%"></span></div>
    <div>${r.summary}</div>
    ${issues}
    <p class="hint">Double-check: ${r.framesAnalyzed} frame(s) × ${r.samplesPerFrame} model passes = ${r.passes.length} votes.</p>
    <div class="thumbs">${thumbs}</div>`;
}

// ---------- history ----------
async function loadHistory() {
  try {
    const checks = await (await fetch("/api/checks")).json();
    if (!checks.length) { $("history").textContent = "No checks yet."; return; }
    $("history").innerHTML = checks
      .map(
        (c) =>
          `<div class="h-item"><span class="verdict ${c.verdict}" style="margin:0;padding:2px 8px;">${verdictLabel(c.verdict)}</span>` +
          `<span>${Math.round(c.confidence * 100)}% · ${c.issues.map((i) => i.type).join(", ") || "—"}</span>` +
          `<span class="when">${fmtTime(c.ts)}</span></div>`,
      )
      .join("");
  } catch {
    $("history").textContent = "—";
  }
}
loadHistory();

// ---------- use case 2: troubleshoot ----------
$("tsBtn").addEventListener("click", async () => {
  const symptom = $("symptom").value.trim();
  if (!symptom) return;
  $("tsBtn").disabled = true;
  $("tsResult").innerHTML = `<p class="hint">analyzing the print and diagnosing…</p>`;
  try {
    const s = await (await fetch("/api/troubleshoot", {
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
    .map(
      (g, i) => `
      <div class="suggestion">
        <h4>${i + 1}. ${g.hypothesis}</h4>
        <div class="field"><b>Change:</b> ${g.change}</div>
        <div class="field"><b>Expected:</b> ${g.expectedOutcome}</div>
        <div class="field"><b>Watch for:</b> ${g.watchFor}</div>
        <button data-session="${s.id}" data-idx="${i}" class="verifyBtn">I made this change — verify it worked</button>
        <div class="obs-slot"></div>
      </div>`,
    )
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
