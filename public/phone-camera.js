const video = document.querySelector("#camera");
const overlay = document.querySelector("#tag-overlay");
const overlayContext = overlay.getContext("2d");
const statusNode = document.querySelector("#status");
const linkNode = document.querySelector("#link");
const metricsNode = document.querySelector("#detect-metrics");
const detectToggle = document.querySelector("#detect-toggle");
const viewNode = document.querySelector(".view");
const room = new URLSearchParams(location.search).get("room") || "aura";
const detectorCanvas = document.createElement("canvas");
const detectorContext = detectorCanvas.getContext("2d", { willReadFrequently: true });
const detectorWorker = new Worker("/apriltag-worker.js");

let facingMode = "environment";
let stream;
const peers = new Map();
let socket;
let detectorReady = false;
let detectorBusy = false;
let detectionEnabled = true;
let detectionTimer;
let latestDetections = [];

const setStatus = (text) => { statusNode.textContent = text; };
const modeButtons = [...document.querySelectorAll("[data-mode]")];
let displayMode = localStorage.getItem("aura-camera-mode") || "auto";

function applyDisplayMode(mode) {
  displayMode = ["auto", "landscape", "portrait"].includes(mode) ? mode : "auto";
  document.body.classList.remove("mode-auto", "mode-landscape", "mode-portrait");
  document.body.classList.add(`mode-${displayMode}`);
  modeButtons.forEach((button) => button.classList.toggle("active", button.dataset.mode === displayMode));
  localStorage.setItem("aura-camera-mode", displayMode);
  requestAnimationFrame(fitOverlay);
}

function fitOverlay() {
  if (!video.videoWidth || !video.videoHeight) return;
  const viewWidth = viewNode.clientWidth; const viewHeight = viewNode.clientHeight;
  const scale = Math.min(viewWidth / video.videoWidth, viewHeight / video.videoHeight);
  const width = video.videoWidth * scale; const height = video.videoHeight * scale;
  overlay.style.width = `${width}px`; overlay.style.height = `${height}px`;
  overlay.style.left = `${(viewWidth - width) / 2}px`; overlay.style.top = `${(viewHeight - height) / 2}px`;
}

function drawDetections(detections, width, height) {
  overlay.width = width; overlay.height = height; fitOverlay();
  overlayContext.clearRect(0, 0, width, height);
  detections.forEach((detection) => {
    const corners = detection.corners ?? [];
    if (corners.length !== 4) return;
    overlayContext.beginPath(); overlayContext.moveTo(corners[0].x, corners[0].y);
    corners.slice(1).forEach((corner) => overlayContext.lineTo(corner.x, corner.y));
    overlayContext.closePath(); overlayContext.lineWidth = Math.max(3, width / 180); overlayContext.strokeStyle = "#62f0ad"; overlayContext.stroke();
    overlayContext.fillStyle = "rgba(8,18,22,.82)"; overlayContext.fillRect(detection.center.x - 34, detection.center.y - 19, 68, 38);
    overlayContext.fillStyle = "#dffff0"; overlayContext.font = `700 ${Math.max(18, width / 25)}px sans-serif`; overlayContext.textAlign = "center"; overlayContext.textBaseline = "middle";
    overlayContext.fillText(`ID ${detection.id}`, detection.center.x, detection.center.y);
    overlayContext.beginPath(); overlayContext.arc(detection.center.x, detection.center.y, Math.max(4, width / 150), 0, Math.PI * 2); overlayContext.fillStyle = "#ffdb6e"; overlayContext.fill();
  });
}

function signal(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function scheduleDetection(delay = 150) {
  clearTimeout(detectionTimer);
  detectionTimer = setTimeout(processFrame, delay);
}

function processFrame() {
  if (!detectionEnabled || !detectorReady || detectorBusy || video.readyState < 2 || !video.videoWidth) { scheduleDetection(180); return; }
  const width = Math.min(480, video.videoWidth);
  const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
  detectorCanvas.width = width; detectorCanvas.height = height;
  detectorContext.drawImage(video, 0, 0, width, height);
  const rgba = detectorContext.getImageData(0, 0, width, height).data;
  const grayscale = new Uint8Array(width * height);
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 1) grayscale[target] = Math.round(rgba[source] * .299 + rgba[source + 1] * .587 + rgba[source + 2] * .114);
  detectorBusy = true;
  detectorWorker.postMessage({ type: "detect", pixels: grayscale.buffer, width, height, capturedAt: Date.now() }, [grayscale.buffer]);
}

detectorWorker.onmessage = (event) => {
  const message = event.data;
  if (message.type === "ready") {
    detectorReady = true; metricsNode.textContent = "检测器已就绪"; metricsNode.className = "ok"; scheduleDetection(0); return;
  }
  if (message.type === "error") {
    detectorBusy = false; metricsNode.textContent = `识别错误：${message.message}`; metricsNode.className = ""; scheduleDetection(500); return;
  }
  if (message.type !== "detections") return;
  detectorBusy = false;
  latestDetections = message.detections ?? [];
  drawDetections(latestDetections, message.width, message.height);
  const ids = latestDetections.map((item) => item.id).join(", ");
  metricsNode.textContent = `${latestDetections.length} 个 · ${Math.round(message.processingMs)} ms${ids ? ` · ID ${ids}` : ""}`;
  metricsNode.className = latestDetections.length ? "ok" : "";
  signal({
    type: "apriltag-detections",
    family: "tag36h11",
    frame: { width: message.width, height: message.height, capturedAt: message.capturedAt },
    processingMs: message.processingMs,
    detections: latestDetections.map((item) => ({ id: item.id, corners: item.corners, center: item.center })),
  });
  scheduleDetection(150);
};

async function makeOffer(viewerId = "legacy") {
  if (!stream || socket?.readyState !== WebSocket.OPEN) return;
  peers.get(viewerId)?.close();
  const peer = new RTCPeerConnection({ iceServers: [] }); peers.set(viewerId, peer); stream.getTracks().forEach((track) => peer.addTrack(track, stream));
  peer.onicecandidate = (event) => event.candidate && signal({ type: "ice", viewerId, candidate: event.candidate });
  peer.onconnectionstatechange = () => {
    const ok = peer.connectionState === "connected";
    linkNode.textContent = ok ? "正在推流" : `链路 ${peer.connectionState}`; linkNode.className = ok ? "live" : "";
    if (ok) setStatus("全局视频与 AprilTag 检测结果已发送到 Mac。");
    if (["closed", "failed"].includes(peer.connectionState)) { peer.close(); peers.delete(viewerId); }
  };
  await peer.setLocalDescription(await peer.createOffer()); signal({ type: "offer", viewerId, offer: peer.localDescription });
}

function openSocket() {
  socket?.close(); socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/signal/${room}/camera`);
  socket.onopen = () => { linkNode.textContent = "等待 Mac"; signal({ type: "camera-ready" }); };
  socket.onmessage = async (event) => {
    const message = JSON.parse(event.data);
    const viewerId = message.viewerId || "legacy"; const peer = peers.get(viewerId);
    if (message.type === "viewer-ready") await makeOffer(viewerId);
    if (message.type === "answer" && peer) await peer.setRemoteDescription(message.answer);
    if (message.type === "ice" && peer) await peer.addIceCandidate(message.candidate).catch(() => {});
    if (message.type === "peer-left" && peer) { peer.close(); peers.delete(viewerId); }
  };
  socket.onclose = () => {
    peers.forEach((peer) => peer.close()); peers.clear();
    linkNode.textContent = "链路离线"; setTimeout(openSocket, 1500);
  };
}

async function start() {
  try {
    peers.forEach((peer) => peer.close()); peers.clear();
    stream?.getTracks().forEach((track) => track.stop());
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } }, audio: false });
    video.srcObject = stream; await video.play(); fitOverlay();
    setStatus("摄像头已开启，AprilTag 36h11 本地识别运行中。"); openSocket(); scheduleDetection(0);
  } catch (error) { setStatus(`摄像头启动失败：${error.message}`); }
}

modeButtons.forEach((button) => button.addEventListener("click", () => applyDisplayMode(button.dataset.mode)));
applyDisplayMode(displayMode);
window.addEventListener("resize", fitOverlay);
document.querySelector("#start").addEventListener("click", start);
document.querySelector("#switch").addEventListener("click", async () => { facingMode = facingMode === "environment" ? "user" : "environment"; await start(); });
detectToggle.addEventListener("click", () => {
  detectionEnabled = !detectionEnabled;
  detectToggle.textContent = detectionEnabled ? "暂停识别" : "继续识别";
  detectToggle.classList.toggle("detecting", detectionEnabled);
  if (!detectionEnabled) { overlayContext.clearRect(0, 0, overlay.width, overlay.height); metricsNode.textContent = "识别已暂停"; }
  else scheduleDetection(0);
});
detectToggle.classList.add("detecting");
