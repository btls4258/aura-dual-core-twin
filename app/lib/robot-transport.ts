import type { Faction, Vec2 } from "./game";
import type { AuraEnvelope, RobotCommand } from "./protocol";
import { envelope } from "./protocol";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "mock";
export type RobotEndpointStates = Record<Faction, ConnectionState>;
export type RobotHardwareModes = Record<Faction, "virtual" | "physical">;
export type VisualRobotPose = Vec2 & { headingDeg: number; capturedAt: number };

export interface RobotTransport {
  readonly connectionState: ConnectionState;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(command: RobotCommand): Promise<AuraEnvelope>;
  fallbackFaction?(faction: Faction): Promise<void>;
}

const pause = (milliseconds: number) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));

export class MockRobotTransport implements RobotTransport {
  readonly connectionState = "mock" as const;
  async connect() { return Promise.resolve(); }
  async disconnect() { return Promise.resolve(); }
  async send(command: RobotCommand) {
    await pause(180);
    return envelope("robot.ack", { commandId: command.commandId, accepted: true, simulated: true });
  }
}

type EndpointConfig = Record<Faction, string>;
type Telemetry = { imu?: { yaw?: number } | null };
type MotionStatus = { connected?: boolean; error?: string | null };

export function normalizeRobotEndpoint(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("请先输入机器人 IP 地址");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed.includes(":") ? trimmed : `${trimmed}:8765`}`;
}

const normalizeAngle = (angle: number) => {
  let value = angle % 360;
  if (value > 180) value -= 360;
  if (value < -180) value += 360;
  return value;
};

const routeDistance = (from: Vec2, to: Vec2) => Math.hypot(to.x - from.x, to.z - from.z);

/**
 * Browser-side adapter for the AuraOS motion REST API. The game remains the
 * authority for rules/path planning; this adapter only executes a validated path.
 */
export class DualAuraHttpTransport implements RobotTransport {
  connectionState: ConnectionState = "disconnected";
  endpointStates: RobotEndpointStates = { red: "disconnected", blue: "disconnected" };
  connectionErrors: Partial<Record<Faction, string>> = {};
  private readonly endpoints: EndpointConfig;
  private readonly hardwareModes: RobotHardwareModes;
  private readonly yawOffsets: Partial<Record<Faction, number>> = {};
  private readonly imuYaws: Partial<Record<Faction, number>> = {};
  private commandGeneration = 0;

  constructor(endpoints: EndpointConfig, hardwareModes: RobotHardwareModes, private readonly onState?: (states: RobotEndpointStates) => void, private readonly getVisualPose?: (faction: Faction) => VisualRobotPose | undefined, private readonly pauseFn: (milliseconds: number) => Promise<unknown> = pause) {
    this.endpoints = {
      red: normalizeRobotEndpoint(endpoints.red),
      blue: normalizeRobotEndpoint(endpoints.blue),
    };
    this.hardwareModes = { ...hardwareModes };
  }

  private setEndpointState(faction: Faction, state: RobotEndpointStates[Faction]) {
    this.endpointStates = { ...this.endpointStates, [faction]: state };
    this.onState?.(this.endpointStates);
  }

  private async request<T>(faction: Faction, path: string, init?: RequestInit, timeoutMs = 1800): Promise<T> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.endpoints[faction]}${path}`, {
        ...init,
        headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${faction} AURA 返回 HTTP ${response.status}`);
      return await response.json() as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`${faction} AURA 请求超时：${path}`);
      }
      throw error;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  async connect() {
    this.connectionState = "connecting";
    this.connectionErrors = {};
    this.endpointStates = {
      red: this.hardwareModes.red === "physical" ? "connecting" : "mock",
      blue: this.hardwareModes.blue === "physical" ? "connecting" : "mock",
    };
    this.onState?.(this.endpointStates);
    const physicalFactions = (["red", "blue"] as Faction[]).filter((faction) => this.hardwareModes[faction] === "physical");
    if (!physicalFactions.length) {
      this.connectionState = "mock";
      return;
    }
    await Promise.all(physicalFactions.map(async (faction) => {
      try {
        const status = await this.request<MotionStatus>(faction, "/api/motion/status");
        if (!status.connected) throw new Error(`${faction} AURA 底盘串口未连接${status.error ? `：${status.error}` : ""}`);
        const telemetry = await this.request<Telemetry>(faction, "/api/motion/telemetry");
        const yaw = telemetry.imu?.yaw;
        if (typeof yaw !== "number") throw new Error(`${faction} AURA 未返回有效航向角`);
        this.imuYaws[faction] = yaw;
        // At deployment the two black fronts face each other: red +X, blue -X.
        const visualPose = this.getVisualPose?.(faction);
        const logicalStartYaw = visualPose && Date.now() - visualPose.capturedAt < 1200 ? visualPose.headingDeg : faction === "red" ? 0 : 180;
        this.yawOffsets[faction] = normalizeAngle(yaw - logicalStartYaw);
        this.setEndpointState(faction, "connected");
      } catch (error) {
        this.connectionErrors[faction] = error instanceof Error ? error.message : "连接失败";
        this.setEndpointState(faction, "mock");
      }
    }));
    const connectedCount = physicalFactions.filter((faction) => this.endpointStates[faction] === "connected").length;
    this.connectionState = connectedCount ? "connected" : "mock";
    if (!connectedCount) {
      throw new Error(physicalFactions.map((faction) => this.connectionErrors[faction]).filter(Boolean).join("；") || "实体 AURA 连接失败");
    }
  }

  private async stopAll() {
    this.commandGeneration += 1;
    const connectedFactions = (["red", "blue"] as Faction[]).filter((faction) => this.endpointStates[faction] === "connected");
    await Promise.allSettled(connectedFactions.map((faction) =>
      this.request(faction, "/api/motion/stop", { method: "POST" }, 900),
    ));
  }

  async disconnect() {
    await this.stopAll();
    this.connectionState = "mock";
    this.endpointStates = { red: "mock", blue: "mock" };
    this.onState?.(this.endpointStates);
  }

  async fallbackFaction(faction: Faction) {
    this.commandGeneration += 1;
    if (this.endpointStates[faction] === "connected") {
      await Promise.allSettled([this.request(faction, "/api/motion/stop", { method: "POST" }, 900)]);
    }
    this.hardwareModes[faction] = "virtual";
    delete this.yawOffsets[faction];
    this.setEndpointState(faction, "mock");
    this.connectionState = (["red", "blue"] as Faction[]).some((side) => this.endpointStates[side] === "connected") ? "connected" : "mock";
  }

  private async waitForYaw(faction: Faction, targetYaw: number, generation: number) {
    for (let attempt = 0; attempt < 18; attempt += 1) {
      if (generation !== this.commandGeneration) throw new Error("运动已被急停取消");
      const telemetry = await this.request<Telemetry>(faction, "/api/motion/telemetry", undefined, 900);
      const yaw = telemetry.imu?.yaw;
      if (typeof yaw === "number") this.imuYaws[faction] = yaw;
      if (typeof yaw === "number" && Math.abs(normalizeAngle(targetYaw - yaw)) <= 6) return;
      await this.pauseFn(160);
    }
    throw new Error(`${faction} AURA 转向超时，运动已停止`);
  }

  private freshVisualPose(faction: Faction) {
    const pose = this.getVisualPose?.(faction);
    return pose && Date.now() - pose.capturedAt <= 900 ? pose : undefined;
  }

  private async recoverLostVision(command: RobotCommand, lastPose: VisualRobotPose, waypoint: Vec2, turnPoint: Vec2, generation: number, speedMmS: number, yawOffset: number) {
    if (generation !== this.commandGeneration) throw new Error("运动已被急停取消");
    const forwardCm = Math.min(30, routeDistance(lastPose, waypoint));
    const recoverySpeedMmS = Math.min(speedMmS, 60);
    if (forwardCm >= 0.8) {
      await this.request(command.faction, "/api/motion/move_distance", {
        method: "POST",
        body: JSON.stringify({ left_distance_mm: forwardCm * 10, right_distance_mm: forwardCm * 10, speed_mm_s: recoverySpeedMmS }),
      });
      await this.pauseFn(forwardCm * 10 / recoverySpeedMmS * 1000 + 350);
    }

    const heading = lastPose.headingDeg * Math.PI / 180;
    const estimated = {
      x: lastPose.x + Math.cos(heading) * forwardCm,
      z: lastPose.z + Math.sin(heading) * forwardCm,
    };
    let estimatedHeadingDeg = lastPose.headingDeg;
    if (routeDistance(estimated, turnPoint) >= 1) {
      const logicalYaw = Math.atan2(turnPoint.z - estimated.z, turnPoint.x - estimated.x) * 180 / Math.PI;
      const targetYaw = normalizeAngle(logicalYaw + yawOffset);
      await this.request(command.faction, "/api/motion/target_yaw", {
        method: "POST",
        body: JSON.stringify({ target_yaw: targetYaw }),
      });
      await this.waitForYaw(command.faction, targetYaw, generation);
      estimatedHeadingDeg = normalizeAngle(logicalYaw);
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const recovered = this.freshVisualPose(command.faction);
      if (recovered) return { pose: recovered, recovered: true };
      await this.pauseFn(250);
    }
    return {
      pose: { ...estimated, headingDeg: estimatedHeadingDeg, capturedAt: Date.now() },
      recovered: false,
    };
  }

  private async executeVisualPath(command: RobotCommand, path: Vec2[], generation: number, speedMmS: number, yawOffset: number) {
    let lastPose = this.getVisualPose?.(command.faction);
    let recoveryAttempts = 0;
    for (let index = 1; index < path.length; index += 1) {
      const waypoint = path[index]; let reached = false;
      for (let correction = 0; correction < 36; correction += 1) {
        if (generation !== this.commandGeneration) throw new Error("运动已被急停取消");
        let pose = this.freshVisualPose(command.faction);
        if (!pose) {
          if (recoveryAttempts >= 3 || !lastPose) throw new Error(`${command.faction} AURA 视觉仍未恢复，已完成最多 3 段盲走并停车；实体连接保持`);
          recoveryAttempts += 1;
          const remainingCm = routeDistance(lastPose, waypoint);
          const turnPoint = remainingCm <= 31 ? path[index + 1] ?? waypoint : waypoint;
          const recovery = await this.recoverLostVision(command, lastPose, waypoint, turnPoint, generation, speedMmS, yawOffset);
          pose = recovery.pose;
          lastPose = pose;
          if (!recovery.recovered) {
            if (routeDistance(pose, waypoint) <= 3) { reached = true; break; }
            continue;
          }
        }
        lastPose = pose;
        const distanceCm = routeDistance(pose, waypoint);
        if (distanceCm <= 3) { reached = true; break; }
        const logicalYaw = Math.atan2(waypoint.z - pose.z, waypoint.x - pose.x) * 180 / Math.PI;
        const targetYaw = normalizeAngle(logicalYaw + yawOffset);
        await this.request(command.faction, "/api/motion/target_yaw", {
          method: "POST",
          body: JSON.stringify({ target_yaw: targetYaw }),
        });
        await this.waitForYaw(command.faction, targetYaw, generation);
        const stepCm = Math.min(distanceCm, 8);
        const poseTimestamp = pose.capturedAt;
        await this.request(command.faction, "/api/motion/move_distance", {
          method: "POST",
          body: JSON.stringify({ left_distance_mm: stepCm * 10, right_distance_mm: stepCm * 10, speed_mm_s: speedMmS }),
        });
        await this.pauseFn(stepCm * 10 / speedMmS * 1000 + 280);
        const updated = this.freshVisualPose(command.faction);
        if (!updated || updated.capturedAt <= poseTimestamp) continue;
        if (routeDistance(pose, updated) > stepCm + 12) throw new Error(`${command.faction} AURA 定位发生跳变，运动已停止`);
        lastPose = updated;
      }
      if (!reached) throw new Error(`${command.faction} AURA 未能收敛到路径点，运动已停止`);
    }
  }

  private async executePath(command: RobotCommand) {
    const path = command.path?.length && command.path.length > 1
      ? command.path
      : command.target ? [command.target] : [];
    if (path.length < 2) throw new Error("实体移动缺少完整安全路径");
    const generation = this.commandGeneration;
    let yawOffset = this.yawOffsets[command.faction];
    if (typeof yawOffset !== "number") throw new Error("机器人尚未完成航向标定");
    const speedMmS = Math.round(Math.min(Math.max(command.speedLimit ?? 0.1, 0.04), 0.15) * 1000);

    if (this.getVisualPose) {
      const telemetry = await this.request<Telemetry>(command.faction, "/api/motion/telemetry", undefined, 900);
      const imuYaw = telemetry.imu?.yaw;
      if (typeof imuYaw !== "number") throw new Error(`${command.faction} AURA 未返回有效航向角`);
      const pose = this.freshVisualPose(command.faction);
      if (pose) {
        yawOffset = normalizeAngle(imuYaw - pose.headingDeg);
        this.yawOffsets[command.faction] = yawOffset;
      }
      await this.executeVisualPath(command, path, generation, speedMmS, yawOffset);
      return;
    }

    for (let index = 1; index < path.length; index += 1) {
      if (generation !== this.commandGeneration) throw new Error("运动已被急停取消");
      const from = path[index - 1];
      const to = path[index];
      const distanceCm = routeDistance(from, to);
      if (distanceCm < 0.8) continue;
      const logicalYaw = Math.atan2(to.z - from.z, to.x - from.x) * 180 / Math.PI;
      const targetYaw = normalizeAngle(logicalYaw + yawOffset);
      await this.request(command.faction, "/api/motion/target_yaw", {
        method: "POST",
        body: JSON.stringify({ target_yaw: targetYaw }),
      });
      await this.waitForYaw(command.faction, targetYaw, generation);
      await this.request(command.faction, "/api/motion/move_distance", {
        method: "POST",
        body: JSON.stringify({ left_distance_mm: distanceCm * 10, right_distance_mm: distanceCm * 10, speed_mm_s: speedMmS }),
      });
      await this.pauseFn(distanceCm * 10 / speedMmS * 1000 + 350);
    }
  }

  async send(command: RobotCommand): Promise<AuraEnvelope> {
    if (command.kind !== "stop" && this.endpointStates[command.faction] !== "connected") {
      await pause(180);
      return envelope("robot.ack", { commandId: command.commandId, accepted: true, simulated: true });
    }
    if (command.kind === "stop") await this.stopAll();
    if (command.kind === "move") {
      try {
        await this.executePath(command);
      } catch (error) {
        await Promise.allSettled([this.request(command.faction, "/api/motion/stop", { method: "POST" }, 900)]);
        throw error;
      }
    }
    return envelope("robot.ack", { commandId: command.commandId, accepted: true, simulated: false });
  }
}
