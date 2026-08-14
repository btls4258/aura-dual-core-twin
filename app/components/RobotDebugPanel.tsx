"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Faction } from "../lib/game";
import { normalizeRobotEndpoint } from "../lib/robot-transport";

type Endpoints = Record<Faction, string>;
type DriveDirection = "forward" | "back" | "left" | "right";
type Telemetry = {
  imu?: { roll?: number; pitch?: number; yaw?: number } | null;
  wheel_speed?: { left_mm_s?: number; right_mm_s?: number } | null;
  body_speed?: { linear_m_s?: number; angular_rad_s?: number } | null;
};

type Props = {
  endpoints: Endpoints;
  onEndpoints: (value: Endpoints) => void;
  onClose: () => void;
};

const factionName = (faction: Faction) => faction === "red" ? "赤曜机器人" : "蓝穹机器人";
const number = (value: unknown, digits = 1) => typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
const DISPLAY_EXPRESSIONS = [
  { id: "happy", icon: "◡", label: "开心" },
  { id: "angry", icon: "⌁", label: "警告" },
  { id: "thinking", icon: "…", label: "思考" },
  { id: "excited", icon: "✦", label: "兴奋" },
  { id: "curious", icon: "?", label: "好奇" },
  { id: "confused", icon: "≈", label: "困惑" },
  { id: "sad", icon: "︵", label: "失落" },
  { id: "processing", icon: "↻", label: "处理中" },
  { id: "tired", icon: "–", label: "充电" },
  { id: "neutral", icon: "○", label: "中性" },
  { id: "idle", icon: "◇", label: "待机" },
] as const;

export function RobotDebugPanel({ endpoints, onEndpoints, onClose }: Props) {
  const [faction, setFaction] = useState<Faction>("red");
  const [state, setState] = useState<"offline" | "checking" | "online" | "error">("offline");
  const [statusText, setStatusText] = useState("等待连接检查");
  const [telemetry, setTelemetry] = useState<Telemetry>({});
  const [linearSpeed, setLinearSpeed] = useState(0.08);
  const [turnWheelSpeed, setTurnWheelSpeed] = useState(90);
  const [activeDirections, setActiveDirections] = useState<DriveDirection[]>([]);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraFrame, setCameraFrame] = useState("");
  const [cameraState, setCameraState] = useState<"idle" | "loading" | "live" | "error">("idle");
  const [expressionBusy, setExpressionBusy] = useState<string>();
  const [logs, setLogs] = useState<Array<{ id: number; text: string; error?: boolean }>>([]);
  const holdTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const cameraTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pressedDirections = useRef(new Set<DriveDirection>());
  const requestBusy = useRef(false);
  const mounted = useRef(true);
  const endpoint = endpoints[faction];
  const endpointBase = useMemo(() => {
    try { return normalizeRobotEndpoint(endpoint); } catch { return ""; }
  }, [endpoint]);
  const endpointBaseRef = useRef(endpointBase);
  useEffect(() => { endpointBaseRef.current = endpointBase; }, [endpointBase]);

  const addLog = (text: string, error = false) => setLogs((current) => [{ id: Date.now() + Math.random(), text, error }, ...current].slice(0, 12));

  const request = async <T,>(path: string, init?: RequestInit, timeoutMs = 1600): Promise<T> => {
    const base = normalizeRobotEndpoint(endpoint);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as T & { detail?: string; error?: string };
      if (!response.ok) throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
      return payload;
    } finally { window.clearTimeout(timeout); }
  };

  const stop = async (reason = "调试台停车", quiet = false) => {
    if (holdTimer.current) window.clearInterval(holdTimer.current);
    holdTimer.current = undefined;
    pressedDirections.current.clear();
    setActiveDirections([]);
    try {
      await request("/api/motion/stop", { method: "POST", body: "{}", keepalive: true }, 900);
      if (!quiet) addLog(reason);
    } catch (error) {
      if (!quiet) addLog(`停车失败：${error instanceof Error ? error.message : "未知错误"}`, true);
    }
  };

  const sendVector = async (linearX: number, angularZ: number) => {
    if (requestBusy.current || state !== "online") return;
    requestBusy.current = true;
    try {
      // AuraOS 底盘的航向正方向与界面左右语义相反。
      await request("/api/motion/cmd_vel", { method: "POST", body: JSON.stringify({ linear_x: linearX, angular_z: -angularZ }) }, 900);
    } catch (error) {
      setState("error");
      setStatusText("控制请求失败");
      addLog(`控制失败：${error instanceof Error ? error.message : "未知错误"}`, true);
      void stop("控制异常自动停车", true);
    } finally { requestBusy.current = false; }
  };

  const sendTurnStep = async (direction: "left" | "right") => {
    if (requestBusy.current || state !== "online") return;
    requestBusy.current = true;
    const sign = direction === "left" ? 1 : -1;
    try {
      await request("/api/motion/move_distance", {
        method: "POST",
        body: JSON.stringify({
          left_distance_mm: -40 * sign,
          right_distance_mm: 40 * sign,
          speed_mm_s: turnWheelSpeed,
        }),
      }, 900);
    } catch (error) {
      setState("error"); setStatusText("转向指令失败");
      addLog(`转向失败：${error instanceof Error ? error.message : "未知错误"}`, true);
      void stop("转向异常自动停车", true);
    } finally { requestBusy.current = false; }
  };

  const applyPressedDirections = () => {
    if (holdTimer.current) window.clearInterval(holdTimer.current);
    holdTimer.current = undefined;
    const pressed = pressedDirections.current;
    const linearSign = (pressed.has("forward") ? 1 : 0) - (pressed.has("back") ? 1 : 0);
    const turnSign = (pressed.has("left") ? 1 : 0) - (pressed.has("right") ? 1 : 0);
    if (linearSign !== 0) {
      const vector: [number, number] = [linearSign * linearSpeed, turnSign * Math.min(0.8, turnWheelSpeed / 300)];
      void sendVector(...vector);
      holdTimer.current = setInterval(() => void sendVector(...vector), 120);
    } else if (turnSign !== 0) {
      const direction = turnSign > 0 ? "left" : "right";
      void sendTurnStep(direction);
      holdTimer.current = setInterval(() => void sendTurnStep(direction), 520);
    } else if (pressed.size > 0) {
      // Opposing inputs (W+S or A+D) cancel motion but remain pressed, so
      // releasing either key immediately resumes the other direction.
      void request("/api/motion/stop", { method: "POST", body: "{}" }, 900).catch(() => undefined);
    } else {
      void stop("方向键全部松开", true);
    }
  };

  const startDrive = (direction: DriveDirection) => {
    if (state !== "online") { addLog("请先完成连接检查", true); return; }
    const labels = { forward: "前进", back: "后退", left: "左转", right: "右转" };
    if (pressedDirections.current.has(direction)) return;
    pressedDirections.current.add(direction);
    setActiveDirections([...pressedDirections.current]);
    const combined = [...pressedDirections.current].map((item) => labels[item]).join(" + ");
    addLog(`开始${combined}`);
    applyPressedDirections();
  };

  const releaseDrive = (direction: DriveDirection) => {
    if (!pressedDirections.current.delete(direction)) return;
    setActiveDirections([...pressedDirections.current]);
    applyPressedDirections();
  };

  const checkConnection = async () => {
    if (holdTimer.current) await stop("切换连接前停车", true);
    setState("checking"); setStatusText("正在读取底盘状态…");
    try {
      const status = await request<{ connected?: boolean; error?: string | null }>("/api/motion/status");
      if (!status.connected) throw new Error(status.error || "底盘串口未连接");
      const nextTelemetry = await request<Telemetry>("/api/motion/telemetry");
      if (!mounted.current) return;
      setTelemetry(nextTelemetry); setState("online"); setStatusText("实体底盘在线");
      setCameraEnabled(true); setCameraState("loading");
      addLog(`${factionName(faction)}连接成功 · ${normalizeRobotEndpoint(endpoint)}`);
    } catch (error) {
      if (!mounted.current) return;
      setState("error"); setStatusText(error instanceof Error ? error.message : "连接失败");
      addLog(`连接失败：${error instanceof Error ? error.message : "未知错误"}`, true);
    }
  };

  const playExpression = async (expression: string, label: string) => {
    if (state !== "online" || expressionBusy) return;
    setExpressionBusy(expression);
    try {
      const result = await request<{ asset?: string }>("/api/media/display/expression", {
        method: "POST",
        body: JSON.stringify({ expression }),
      }, 1800);
      addLog(`屏幕表情：${label}${result.asset ? ` · ${result.asset}` : ""}`);
    } catch (error) {
      addLog(`表情播放失败：${error instanceof Error ? error.message : "未知错误"}`, true);
    } finally { setExpressionBusy(undefined); }
  };

  useEffect(() => {
    if (state !== "online") return;
    const timer = window.setInterval(async () => {
      try { setTelemetry(await request<Telemetry>("/api/motion/telemetry", undefined, 900)); }
      catch { setStatusText("遥测暂时无响应"); }
    }, 750);
    return () => window.clearInterval(timer);
  }, [state, endpoint]);

  const scheduleCameraFrame = (delay = 450) => {
    if (cameraTimer.current) window.clearTimeout(cameraTimer.current);
    cameraTimer.current = setTimeout(() => {
      if (!endpointBase) return;
      setCameraState("loading");
      setCameraFrame(`${endpointBase}/api/media/camera/snapshot?t=${Date.now()}`);
    }, delay);
  };

  useEffect(() => {
    if (state === "online" && cameraEnabled && endpointBase) scheduleCameraFrame(0);
    else {
      if (cameraTimer.current) window.clearTimeout(cameraTimer.current);
      cameraTimer.current = undefined;
      setCameraFrame("");
      setCameraState("idle");
    }
    return () => { if (cameraTimer.current) window.clearTimeout(cameraTimer.current); };
  }, [state, cameraEnabled, endpointBase]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      const direction = ({ w: "forward", s: "back", a: "left", d: "right" } as const)[event.key.toLowerCase() as "w" | "s" | "a" | "d"];
      if (event.key === " ") { event.preventDefault(); void stop("空格键紧急停车"); }
      else if (direction && !event.repeat) { event.preventDefault(); startDrive(direction); }
    };
    const keyup = (event: KeyboardEvent) => {
      const direction = ({ w: "forward", s: "back", a: "left", d: "right" } as const)[event.key.toLowerCase() as "w" | "s" | "a" | "d"];
      if (direction) releaseDrive(direction);
    };
    const blur = () => void stop("窗口失焦自动停车", true);
    window.addEventListener("keydown", keydown); window.addEventListener("keyup", keyup); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", keydown); window.removeEventListener("keyup", keyup); window.removeEventListener("blur", blur); };
  });

  useEffect(() => () => {
    mounted.current = false;
    if (holdTimer.current) window.clearInterval(holdTimer.current);
    if (cameraTimer.current) window.clearTimeout(cameraTimer.current);
    if (endpointBaseRef.current) void fetch(`${endpointBaseRef.current}/api/motion/stop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", keepalive: true }).catch(() => undefined);
  }, []);

  const chooseFaction = async (next: Faction) => {
    if (next === faction) return;
    await stop("切换机器人自动停车", true);
    setFaction(next); setState("offline"); setStatusText("等待连接检查"); setTelemetry({});
    setCameraEnabled(false); setCameraFrame(""); setCameraState("idle");
  };

  const close = async () => { await stop("关闭调试台停车", true); onClose(); };
  return <div className="robot-debug-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) void close(); }}>
    <section className="robot-debug-panel" role="dialog" aria-modal="true" aria-labelledby="robot-debug-title">
      <header className="robot-debug-head"><div><small>AURAOS · ENGINEERING</small><h2 id="robot-debug-title">机器人调试台</h2></div><span className={`robot-debug-state ${state}`}><i />{statusText}</span><button onClick={() => void close()} aria-label="关闭机器人调试台">×</button></header>
      <div className="robot-debug-connect">
        <div className="robot-debug-factions" role="group" aria-label="选择调试机器人"><button className={faction === "red" ? "active red" : ""} onClick={() => void chooseFaction("red")}>赤曜</button><button className={faction === "blue" ? "active blue" : ""} onClick={() => void chooseFaction("blue")}>蓝穹</button></div>
        <label><span>机器人地址</span><input value={endpoint} onChange={(event) => { onEndpoints({ ...endpoints, [faction]: event.target.value }); setState("offline"); setStatusText("地址已修改，请重新检查"); }} placeholder="192.168.31.31 或 http://IP:8765" /></label>
        <button className="robot-debug-check" disabled={state === "checking"} onClick={() => void checkConnection()}>{state === "checking" ? "检查中…" : "连接检查"}</button>
      </div>

      <div className="robot-debug-body">
        <div className="robot-debug-drive">
          <div className="robot-debug-section-title"><b>手动遥控</b><span>WASD 可组合 · 松开停车</span></div>
          <div className="robot-debug-speed"><label>线速度 <b>{linearSpeed.toFixed(2)} m/s</b><input type="range" min="0.04" max="0.15" step="0.01" value={linearSpeed} onChange={(event) => setLinearSpeed(Number(event.target.value))} /></label><label>转向轮速 <b>{turnWheelSpeed} mm/s</b><input type="range" min="60" max="140" step="10" value={turnWheelSpeed} onChange={(event) => setTurnWheelSpeed(Number(event.target.value))} /></label></div>
          <div className="robot-debug-pad">
            <button className={`forward ${activeDirections.includes("forward") ? "active" : ""}`} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); startDrive("forward"); }} onPointerUp={() => releaseDrive("forward")} onPointerCancel={() => releaseDrive("forward")} onLostPointerCapture={() => releaseDrive("forward")}><kbd>W</kbd><span>前进</span></button>
            <button className={`left ${activeDirections.includes("left") ? "active" : ""}`} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); startDrive("left"); }} onPointerUp={() => releaseDrive("left")} onPointerCancel={() => releaseDrive("left")} onLostPointerCapture={() => releaseDrive("left")}><kbd>A</kbd><span>左转</span></button>
            <button className="stop" onClick={() => void stop("调试台紧急停车")}><i /><b>停车</b><small>SPACE</small></button>
            <button className={`right ${activeDirections.includes("right") ? "active" : ""}`} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); startDrive("right"); }} onPointerUp={() => releaseDrive("right")} onPointerCancel={() => releaseDrive("right")} onLostPointerCapture={() => releaseDrive("right")}><kbd>D</kbd><span>右转</span></button>
            <button className={`back ${activeDirections.includes("back") ? "active" : ""}`} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); startDrive("back"); }} onPointerUp={() => releaseDrive("back")} onPointerCancel={() => releaseDrive("back")} onLostPointerCapture={() => releaseDrive("back")}><kbd>S</kbd><span>后退</span></button>
          </div>
          <p className="robot-debug-warning">调试控制绕过牌局路径规划，仅在机器人架空或安全区域内使用。页面失焦、松开按键或关闭弹窗都会自动停车。</p>
          <div className="robot-debug-expressions"><div className="robot-debug-section-title"><b>屏幕表情 Demo</b><span>播放后自动返回待机</span></div><div className="robot-debug-expression-grid">{DISPLAY_EXPRESSIONS.map((expression) => <button key={expression.id} disabled={state !== "online" || Boolean(expressionBusy)} className={expressionBusy === expression.id ? "active" : ""} onClick={() => void playExpression(expression.id, expression.label)}><i>{expression.icon}</i><span>{expression.label}</span></button>)}</div></div>
        </div>

        <div className="robot-debug-telemetry">
          <div className="robot-debug-section-title"><b>实时遥测</b><span>750 ms</span></div>
          <div className={`robot-debug-camera ${cameraState}`}>
            <div className="robot-debug-camera-head"><span>机器人视角 · {faction === "red" ? "赤曜" : "蓝穹"}</span><button disabled={state !== "online"} onClick={() => setCameraEnabled((enabled) => !enabled)}>{cameraEnabled ? "暂停" : "打开"}</button></div>
            <div className="robot-debug-camera-view">
              {cameraFrame && <img src={cameraFrame} alt={`${factionName(faction)}摄像头画面`} onLoad={() => { setCameraState("live"); scheduleCameraFrame(450); }} onError={() => { setCameraState("error"); scheduleCameraFrame(1500); }} />}
              {(!cameraFrame || cameraState === "error") && <div className="robot-debug-camera-empty"><i /><span>{cameraState === "error" ? "暂时无法读取相机画面" : state === "online" ? "正在请求相机画面" : "连接机器人后显示画面"}</span></div>}
              {cameraState === "live" && <em>LIVE</em>}
            </div>
          </div>
          <div className="robot-debug-orientation"><div className="robot-debug-compass" style={{ transform: `rotate(${number(telemetry.imu?.yaw, 0) === "—" ? 0 : Number(telemetry.imu?.yaw)}deg)` }}>↑</div><strong>{number(telemetry.imu?.yaw)}°</strong><small>YAW</small></div>
          <div className="robot-debug-metrics"><div><span>ROLL</span><b>{number(telemetry.imu?.roll)}°</b></div><div><span>PITCH</span><b>{number(telemetry.imu?.pitch)}°</b></div><div><span>线速度</span><b>{number(telemetry.body_speed?.linear_m_s, 3)}</b></div><div><span>角速度</span><b>{number(telemetry.body_speed?.angular_rad_s, 3)}</b></div><div><span>左轮</span><b>{number(telemetry.wheel_speed?.left_mm_s)} mm/s</b></div><div><span>右轮</span><b>{number(telemetry.wheel_speed?.right_mm_s)} mm/s</b></div></div>
          <div className="robot-debug-log"><span>调试日志</span>{logs.length ? logs.map((item) => <p key={item.id} className={item.error ? "error" : ""}>{item.text}</p>) : <p>尚无控制记录</p>}</div>
        </div>
      </div>
    </section>
  </div>;
}
