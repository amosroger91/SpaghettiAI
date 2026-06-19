// Phone capture client: open the rear camera, stream JPEG frames to the server
// over a WebSocket. The server registers us as a push camera, so this phone then
// behaves like any other camera (checks, bed-state, /webcam stream into OctoPrint…).
const $ = (id) => document.getElementById(id);

// Stable per-device id so reconnects map to the same camera (and keep their history).
let deviceId = localStorage.getItem("pw-device-id");
if (!deviceId) {
  deviceId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).slice(0, 12);
  localStorage.setItem("pw-device-id", deviceId);
}
$("label").value = localStorage.getItem("pw-device-label") || "Phone camera";

const video = $("video");
const canvas = $("canvas");
const ctx = canvas.getContext("2d");

let stream = null;
let track = null;
let ws = null;
let streaming = false;
let sendTimer = null;
let wakeLock = null;
let framesSent = 0;
let bytesSent = 0;
let cameraId = null;

function setState(text, cls) {
  $("state").textContent = text;
  const dot = $("dot");
  dot.className = "dot" + (cls ? " " + cls : "");
}

// ---- camera ----
async function startCamera() {
  stopCamera();
  const facing = $("facing").checked ? { ideal: "environment" } : { ideal: "user" };
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch (e) {
    setState("camera blocked", "bad");
    $("info").textContent =
      location.protocol === "https:"
        ? "Camera permission denied. Allow camera access and reload."
        : "Camera needs HTTPS. Open the https:// link from the dashboard QR, not http://.";
    return;
  }
  video.srcObject = stream;
  track = stream.getVideoTracks()[0];
  setState("camera ready", "ok");
  $("info").textContent = "Tap “Start streaming” to begin.";
  updateTorchAvailability();
}

function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = track = null;
}

function updateTorchAvailability() {
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  $("torch").disabled = !caps.torch;
}

async function applyTorch() {
  if (!track) return;
  try {
    await track.applyConstraints({ advanced: [{ torch: $("torch").checked }] });
  } catch {
    /* not supported on this device */
  }
}

// ---- websocket ----
function wsUrl() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const label = encodeURIComponent($("label").value.trim() || "Phone camera");
  return `${proto}://${location.host}/ws/ingest?id=${encodeURIComponent(deviceId)}&label=${label}`;
}

function connect() {
  ws = new WebSocket(wsUrl());
  ws.binaryType = "arraybuffer";
  ws.onopen = () => setState("paired", "ok");
  ws.onmessage = (e) => {
    try {
      const m = JSON.parse(e.data);
      if (m.type === "paired") {
        cameraId = m.cameraId;
        $("info").textContent = `Paired as “${m.label}” (camera id: ${m.cameraId}).`;
      }
    } catch {}
  };
  ws.onclose = () => {
    setState(streaming ? "reconnecting…" : "disconnected", streaming ? "" : "bad");
    if (streaming) setTimeout(connect, 1500); // auto-reconnect while streaming
  };
  ws.onerror = () => ws.close();
}

// ---- capture loop ----
function captureOnce() {
  if (!track || !ws || ws.readyState !== WebSocket.OPEN) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const maxW = Number($("width").value);
  const scale = Math.min(1, maxW / vw);
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const q = Number($("quality").value) / 100;
  canvas.toBlob(
    (blob) => {
      if (!blob || !ws || ws.readyState !== WebSocket.OPEN) return;
      blob.arrayBuffer().then((buf) => {
        ws.send(buf);
        framesSent++;
        bytesSent += buf.byteLength;
        $("counters").textContent = `${framesSent} frames · ${(bytesSent / 1e6).toFixed(1)} MB sent`;
      });
    },
    "image/jpeg",
    q,
  );
}

function startLoop() {
  stopLoop();
  const fps = Number($("fps").value);
  sendTimer = setInterval(captureOnce, Math.round(1000 / fps));
}
function stopLoop() {
  if (sendTimer) clearInterval(sendTimer);
  sendTimer = null;
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
  } catch {}
}
function releaseWakeLock() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

// ---- start/stop ----
async function startStreaming() {
  if (!stream) await startCamera();
  if (!stream) return;
  streaming = true;
  framesSent = bytesSent = 0;
  localStorage.setItem("pw-device-label", $("label").value.trim());
  connect();
  startLoop();
  requestWakeLock();
  $("toggleBtn").textContent = "Stop streaming";
  $("toggleBtn").classList.remove("primary");
}

function stopStreaming() {
  streaming = false;
  stopLoop();
  releaseWakeLock();
  if (ws) ws.close();
  ws = null;
  setState("stopped", "");
  $("toggleBtn").textContent = "Start streaming";
  $("toggleBtn").classList.add("primary");
}

// ---- wiring ----
$("toggleBtn").addEventListener("click", () => (streaming ? stopStreaming() : startStreaming()));
$("torch").addEventListener("change", applyTorch);
$("facing").addEventListener("change", startCamera);
$("fps").addEventListener("input", () => {
  $("fpsVal").textContent = `${$("fps").value}/s`;
  if (streaming) startLoop();
});
$("quality").addEventListener("input", () => ($("qVal").textContent = `${$("quality").value}%`));
$("width").addEventListener("input", () => ($("wVal").textContent = `${$("width").value}px`));

// Re-acquire the wake lock when returning to the tab.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && streaming) requestWakeLock();
});

// initial labels
$("fpsVal").textContent = `${$("fps").value}/s`;
$("qVal").textContent = `${$("quality").value}%`;
$("wVal").textContent = `${$("width").value}px`;
startCamera();
