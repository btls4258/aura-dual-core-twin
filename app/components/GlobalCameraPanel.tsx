"use client";

import { useEffect, useRef, useState } from "react";
import { calibrateField, detectionToFieldPose, transformPoint, type FieldCalibration } from "../lib/field-calibration";

type GatewayInfo = { phoneUrl: string; wsViewerUrl: string; lanIp: string };
type TagPoint = { x: number; y: number };
type TagDetection = { id: number; corners: TagPoint[]; center: TagPoint };
type TagPacket = {
  type: "apriltag-detections";
  family: string;
  frame: { width: number; height: number; capturedAt: number };
  processingMs: number;
  detections: TagDetection[];
};

export type RobotVisionPose = { id: number; faction: "red" | "blue"; x: number; z: number; headingDeg: number; capturedAt: number };

export function GlobalCameraPanel({ onRobotPoses }: { onRobotPoses?: (poses: RobotVisionPose[]) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const lastTagPacketRef = useRef<TagPacket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const calibrationRef = useRef<FieldCalibration | null>(null);
  const onRobotPosesRef = useRef(onRobotPoses);
  const [info, setInfo] = useState<GatewayInfo | null>(null);
  const [status, setStatus] = useState<"offline" | "waiting" | "connected">("offline");
  const [expanded, setExpanded] = useState(false);
  const [tagStatus, setTagStatus] = useState({ count: 0, ids: [] as number[], processingMs: 0, seen: false });
  const [calibrationStatus, setCalibrationStatus] = useState<"idle" | "ready" | "error">("idle");
  const [calibrationMessage, setCalibrationMessage] = useState("等待四个角标");
  const [robotPoses, setRobotPoses] = useState<Array<{ id: number; x: number; z: number; headingDeg: number }>>([]);
  useEffect(() => { onRobotPosesRef.current = onRobotPoses; }, [onRobotPoses]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshGatewayInfo = () => {
      fetch(`http://localhost:8088/api/info?t=${Date.now()}`, { cache: "no-store" })
        .then((response) => response.json())
        .then((data: GatewayInfo) => { if (!cancelled) setInfo(data); })
        .catch(() => undefined);
    };
    refreshGatewayInfo();
    const timer = window.setInterval(refreshGatewayInfo, 3000);
    window.addEventListener("online", refreshGatewayInfo);
    window.addEventListener("focus", refreshGatewayInfo);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("online", refreshGatewayInfo);
      window.removeEventListener("focus", refreshGatewayInfo);
    };
  }, []);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let cancelled = false;
    const drawTags = (packet: TagPacket | null) => {
      const canvas = overlayRef.current; const body = bodyRef.current;
      if (!canvas || !body) return;
      const width = body.clientWidth; const height = body.clientHeight; const pixelRatio = Math.min(window.devicePixelRatio, 2);
      canvas.width = Math.max(1, Math.round(width * pixelRatio)); canvas.height = Math.max(1, Math.round(height * pixelRatio));
      const context = canvas.getContext("2d"); if (!context) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); context.clearRect(0, 0, width, height);
      if (!packet?.frame.width || !packet.frame.height) return;
      const scale = Math.min(width / packet.frame.width, height / packet.frame.height);
      const offsetX = (width - packet.frame.width * scale) / 2; const offsetY = (height - packet.frame.height * scale) / 2;
      const calibration = calibrationRef.current;
      if (calibration) {
        const screenPoint = (x: number, z: number) => {
          const pixel = transformPoint(calibration.worldToPixel, { x, y: z });
          return { x: offsetX + pixel.x * scale, y: offsetY + pixel.y * scale };
        };
        context.save(); context.lineWidth = 1;
        for (let x = -90; x <= 90; x += 30) {
          const from = screenPoint(x, -45); const to = screenPoint(x, 45);
          context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y);
          context.strokeStyle = x === 0 ? "rgba(255,206,105,.9)" : "rgba(98,240,173,.22)"; context.stroke();
        }
        for (let z = -45; z <= 45; z += 15) {
          const from = screenPoint(-90, z); const to = screenPoint(90, z);
          context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y);
          context.strokeStyle = z === 0 ? "rgba(91,180,255,.9)" : "rgba(98,240,173,.22)"; context.stroke();
        }
        const corners = [[-90, -45], [90, -45], [90, 45], [-90, 45], [-90, -45]].map(([x, z]) => screenPoint(x, z));
        context.beginPath(); context.moveTo(corners[0].x, corners[0].y); corners.slice(1).forEach((point) => context.lineTo(point.x, point.y));
        context.lineWidth = 2; context.strokeStyle = "rgba(98,240,173,.85)"; context.stroke();
        const origin = screenPoint(0, 0); const xLabel = screenPoint(76, 0); const zLabel = screenPoint(0, 34);
        context.fillStyle = "#ffda82"; context.font = "700 11px sans-serif"; context.fillText("O 0,0", origin.x + 5, origin.y - 5);
        context.fillText("+X", xLabel.x, xLabel.y); context.fillStyle = "#76c8ff"; context.fillText("+Z", zLabel.x, zLabel.y);
        context.restore();
      }
      packet.detections.forEach((detection) => {
        if (detection.corners.length !== 4) return;
        const points = detection.corners.map((point) => ({ x: offsetX + point.x * scale, y: offsetY + point.y * scale }));
        const center = { x: offsetX + detection.center.x * scale, y: offsetY + detection.center.y * scale };
        context.beginPath(); context.moveTo(points[0].x, points[0].y); points.slice(1).forEach((point) => context.lineTo(point.x, point.y)); context.closePath();
        context.lineWidth = 3; context.strokeStyle = "#62f0ad"; context.shadowColor = "#31d990"; context.shadowBlur = 10; context.stroke(); context.shadowBlur = 0;
        context.fillStyle = "rgba(4,13,17,.86)"; context.fillRect(center.x - 28, center.y - 14, 56, 28);
        context.fillStyle = "#e1fff0"; context.font = "700 14px sans-serif"; context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(`ID ${detection.id}`, center.x, center.y);
        context.beginPath(); context.arc(center.x, center.y, 3, 0, Math.PI * 2); context.fillStyle = "#ffdc70"; context.fill();
      });
    };
    const resizeObserver = new ResizeObserver(() => drawTags(lastTagPacketRef.current));
    if (bodyRef.current) resizeObserver.observe(bodyRef.current);
    const connectViewer = () => fetch("http://localhost:8088/api/info", { cache: "no-store" }).then((response) => response.json()).then((data: GatewayInfo) => {
      if (cancelled) return;
      setInfo(data); setStatus("waiting");
      const viewerUrl = new URL(data.wsViewerUrl); viewerUrl.searchParams.set("client", crypto.randomUUID());
      const nextSocket = new WebSocket(viewerUrl); socket = nextSocket;
      nextSocket.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "apriltag-detections") {
          const packet = message as TagPacket; lastTagPacketRef.current = packet; drawTags(packet);
          setTagStatus({ count: packet.detections.length, ids: packet.detections.map((item) => item.id), processingMs: packet.processingMs, seen: true });
          if (calibrationRef.current) {
            const poses = packet.detections.filter((item) => item.id === 0 || item.id === 1).map((item) => {
              const pose = detectionToFieldPose(calibrationRef.current!, item);
              return { id: item.id, faction: item.id === 0 ? "red" as const : "blue" as const, ...pose, capturedAt: Date.now() };
            });
            setRobotPoses(poses); onRobotPosesRef.current?.(poses);
          }
          return;
        }
        if (message.type === "camera-ready") nextSocket.send(JSON.stringify({ type: "viewer-ready" }));
        if (message.type === "offer") {
          peerRef.current?.close();
          const peer = new RTCPeerConnection({ iceServers: [] }); peerRef.current = peer;
          peer.ontrack = (trackEvent) => { if (videoRef.current) videoRef.current.srcObject = trackEvent.streams[0]; setStatus("connected"); };
          peer.onicecandidate = (iceEvent) => { if (iceEvent.candidate) nextSocket.send(JSON.stringify({ type: "ice", candidate: iceEvent.candidate })); };
          peer.onconnectionstatechange = () => { if (["failed", "closed", "disconnected"].includes(peer.connectionState)) setStatus("waiting"); };
          await peer.setRemoteDescription(message.offer);
          await peer.setLocalDescription(await peer.createAnswer());
          nextSocket.send(JSON.stringify({ type: "answer", answer: peer.localDescription }));
        }
        if (message.type === "ice" && peerRef.current) await peerRef.current.addIceCandidate(message.candidate).catch(() => undefined);
      };
      nextSocket.onclose = () => {
        if (cancelled || socket !== nextSocket) return;
        setStatus("offline"); peerRef.current?.close(); peerRef.current = null;
        reconnectTimer = window.setTimeout(connectViewer, 1500);
      };
      nextSocket.onerror = () => nextSocket.close();
    }).catch(() => {
      if (cancelled) return;
      setStatus("offline"); reconnectTimer = window.setTimeout(connectViewer, 1500);
    });
    connectViewer();
    return () => { cancelled = true; resizeObserver.disconnect(); if (reconnectTimer) window.clearTimeout(reconnectTimer); socket?.close(); peerRef.current?.close(); };
  }, []);

  const startCalibration = () => {
    const packet = lastTagPacketRef.current;
    if (!packet) { setCalibrationStatus("error"); setCalibrationMessage("尚未收到识别数据"); return; }
    try {
      calibrationRef.current = calibrateField(packet.detections);
      setCalibrationStatus("ready"); setCalibrationMessage("180 × 90 cm 坐标系已锁定"); drawCalibrationFrame(packet);
    } catch (error) {
      setCalibrationStatus("error"); setCalibrationMessage(error instanceof Error ? error.message : "标定失败");
    }
  };

  const drawCalibrationFrame = (packet: TagPacket) => {
    lastTagPacketRef.current = packet;
    window.dispatchEvent(new Event("resize"));
  };

  const label = status === "connected" ? "全局画面在线" : status === "waiting" ? "等待手机加入" : "摄像头网关离线";
  return <section className={`camera-panel ${expanded ? "expanded" : ""}`}>
    <button className="camera-head" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      <span><span className={`status-dot ${status}`} />手机全局摄像头</span>
      <small>{label} · {expanded ? "关闭大图（Esc）" : "放大识别"}</small>
    </button>
    <div ref={bodyRef} className="camera-body">
      <video ref={videoRef} autoPlay playsInline muted />
      <canvas ref={overlayRef} className="camera-tag-overlay" />
      {status !== "connected" && <div className="camera-empty">
        <strong>{status === "offline" ? "请启动本地摄像头网关" : "在手机浏览器打开"}</strong>
        <code>{info?.phoneUrl ?? "http://localhost:8088/api/info"}</code>
        <span>首次打开 HTTPS 地址时，请在手机上允许证书与摄像头权限。</span>
      </div>}
      <div className="camera-detection-hud"><b>TAG36H11</b><span>{tagStatus.seen ? `${tagStatus.count} 个 · ${Math.round(tagStatus.processingMs)} ms` : "等待手机检测"}</span></div>
      <div className={`camera-calibration ${calibrationStatus}`}>
        <button onClick={startCalibration}>{calibrationStatus === "ready" ? "重新标定" : "开始标定"}</button>
        <span>{calibrationMessage}</span>
        {robotPoses.map((pose) => <b key={pose.id}>ID {pose.id} · X {pose.x.toFixed(1)} / Z {pose.z.toFixed(1)} cm · θ {pose.headingDeg.toFixed(1)}°</b>)}
      </div>
      <div className="camera-tags"><span>视频流 WebRTC</span><span>{tagStatus.ids.length ? `AprilTag ID ${tagStatus.ids.join(", ")}` : "AprilTag 手机端识别"}</span></div>
    </div>
  </section>;
}
