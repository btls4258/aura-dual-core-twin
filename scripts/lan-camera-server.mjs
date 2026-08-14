import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const CERTS = path.join(ROOT, ".certs");
const HTTP_PORT = 8088;
const HTTPS_PORT = 8443;

function currentLanAddresses() {
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, entries]) => (entries ?? []).map((entry) => ({ name, ...entry })))
    .filter((entry) => entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254."))
    .sort((left, right) => {
      const priority = (name) => /^(en0|wlan0|wifi|eth0)$/i.test(name) ? 0 : 1;
      return priority(left.name) - priority(right.name) || left.name.localeCompare(right.name);
    })
    .map((entry) => entry.address);
}

let certificateAddressKey = "";

function createCertificate(addresses) {
  fs.mkdirSync(CERTS, { recursive: true });
  const key = path.join(CERTS, "server-key.pem"); const cert = path.join(CERTS, "server-cert.pem");
  // Wi-Fi networks often assign a new LAN address. Regenerating this local-only
  // certificate on startup prevents a stale IP from making the phone page fail.
  const san = ["DNS:localhost", "IP:127.0.0.1", ...addresses.map((address) => `IP:${address}`)].join(",");
  const result = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "30", "-subj", "/CN=AURA Camera Gateway", "-addext", `subjectAltName=${san}`, "-keyout", key, "-out", cert]);
  if (result.status !== 0) throw new Error("无法生成本地 HTTPS 测试证书");
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

function currentGatewayInfo() {
  const addresses = currentLanAddresses();
  const lanIp = addresses[0] ?? "127.0.0.1";
  const addressKey = addresses.join(",");
  if (addressKey !== certificateAddressKey) {
    const credentials = createCertificate(addresses);
    certificateAddressKey = addressKey;
    if (typeof httpsServer !== "undefined") httpsServer.setSecureContext(credentials);
  }
  return { lanIp, phoneUrl: `https://${lanIp}:${HTTPS_PORT}/phone-camera.html?room=aura`, wsViewerUrl: `ws://localhost:${HTTP_PORT}/signal/aura/viewer` };
}

const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const rooms = new Map();
let latestDetection = null;
function handler(request, response) {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/api/info") {
    response.writeHead(200, { ...headers, "Content-Type": "application/json" });
    response.end(JSON.stringify(currentGatewayInfo()));
    return;
  }
  if (url.pathname === "/api/status") {
    const room = rooms.get("aura");
    response.writeHead(200, { ...headers, "Content-Type": "application/json" });
    response.end(JSON.stringify({
      cameraConnected: room?.camera?.readyState === WebSocket.OPEN,
      viewerCount: room?.viewers?.size ?? 0,
      lastDetectionAt: latestDetection?.receivedAt ?? null,
      ids: latestDetection?.ids ?? [],
    }));
    return;
  }
  const allowed = new Map([
    ["/phone-camera.html", "phone-camera.html"],
    ["/phone-camera.js", "phone-camera.js"],
    ["/apriltag-worker.js", "apriltag-worker.js"],
    ["/apriltag_wasm.js", "apriltag_wasm.js"],
    ["/apriltag_wasm.wasm", "apriltag_wasm.wasm"],
  ]);
  const file = allowed.get(url.pathname);
  if (!file) { response.writeHead(404, headers); response.end("Not found"); return; }
  fs.readFile(path.join(PUBLIC, file), (error, data) => {
    if (error) { response.writeHead(404, headers); response.end("Not found"); return; }
    const contentType = file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".wasm") ? "application/wasm" : "text/javascript; charset=utf-8";
    response.writeHead(200, { ...headers, "Content-Type": contentType }); response.end(data);
  });
}

const httpServer = http.createServer(handler);
const initialAddresses = currentLanAddresses();
const initialCredentials = createCertificate(initialAddresses);
certificateAddressKey = initialAddresses.join(",");
const httpsServer = https.createServer(initialCredentials, handler);
const send = (socket, value) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
function connect(socket, request) {
  const url = new URL(request.url ?? "/", "http://localhost"); const match = url.pathname.match(/^\/signal\/([\w-]{1,32})\/(camera|viewer)$/);
  if (!match) { socket.close(1008, "Invalid signaling path"); return; }
  const [, roomId, role] = match;
  const room = rooms.get(roomId) ?? { camera: null, viewers: new Map() }; rooms.set(roomId, room);
  if (role === "camera") {
    room.camera?.close(4001, "Replaced"); room.camera = socket;
    send(socket, { type: "signal-ready", role });
    room.viewers.forEach((viewer) => send(viewer, { type: "camera-ready" }));
  } else {
    const viewerId = url.searchParams.get("client")?.slice(0, 64) || randomUUID();
    room.viewers.get(viewerId)?.close(4001, "Replaced"); room.viewers.set(viewerId, socket);
    socket.viewerId = viewerId;
    send(socket, { type: "signal-ready", role, viewerId });
    if (room.camera) send(socket, { type: "camera-ready" });
  }
  socket.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (!["viewer-ready", "offer", "answer", "ice", "apriltag-detections"].includes(data.type)) return;
      if (role === "camera") {
        if (data.type === "apriltag-detections") {
          latestDetection = { receivedAt: Date.now(), ids: (data.detections ?? []).map((item) => item.id) };
          room.viewers.forEach((viewer) => send(viewer, data));
        } else send(room.viewers.get(String(data.viewerId ?? "")), data);
      } else send(room.camera, { ...data, viewerId: socket.viewerId });
    } catch { /* ignore malformed signaling */ }
  });
  socket.on("close", () => {
    if (role === "camera") {
      if (room.camera === socket) room.camera = null;
      room.viewers.forEach((viewer) => send(viewer, { type: "peer-left", role: "camera" }));
    } else {
      if (room.viewers.get(socket.viewerId) === socket) room.viewers.delete(socket.viewerId);
      send(room.camera, { type: "peer-left", role: "viewer", viewerId: socket.viewerId });
    }
    if (!room.camera && !room.viewers.size) rooms.delete(roomId);
  });
}
for (const server of [httpServer, httpsServer]) { const wss = new WebSocketServer({ server }); wss.on("connection", connect); }
httpServer.listen(HTTP_PORT, "0.0.0.0");
httpsServer.listen(HTTPS_PORT, "0.0.0.0", () => {
  const { phoneUrl } = currentGatewayInfo();
  console.log(`摄像头网关已启动：http://localhost:${HTTP_PORT}/api/info`);
  console.log(`手机推流地址：${phoneUrl}`);
});
