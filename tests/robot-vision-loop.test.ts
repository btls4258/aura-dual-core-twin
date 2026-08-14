import assert from "node:assert/strict";
import test from "node:test";
import { calibrateField, detectionToFieldPose, transformPoint } from "../app/lib/field-calibration";
import { DualAuraHttpTransport, normalizeRobotEndpoint, type VisualRobotPose } from "../app/lib/robot-transport";
import type { Faction } from "../app/lib/game";

type Call = { faction: Faction; path: string; body?: Record<string, number> };

test("bare robot IP addresses receive the AuraOS scheme and default port", () => {
  assert.equal(normalizeRobotEndpoint("192.168.21.188"), "http://192.168.21.188:8765");
  assert.equal(normalizeRobotEndpoint("192.168.21.188:9000/"), "http://192.168.21.188:9000");
  assert.equal(normalizeRobotEndpoint("http://robot.local:8765/"), "http://robot.local:8765");
});

function fakeRobotSystem(hardwareModes: Record<Faction, "physical" | "virtual">) {
  const poses: Partial<Record<Faction, VisualRobotPose>> = {
    red: { x: -20, z: 0, headingDeg: 0, capturedAt: Date.now() },
    blue: { x: 20, z: 0, headingDeg: 180, capturedAt: Date.now() },
  };
  const imu: Record<Faction, number> = { red: 0, blue: 180 };
  const calls: Call[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); const faction: Faction = url.hostname === "red" ? "red" : "blue";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ faction, path: url.pathname, body });
    if (url.pathname === "/api/motion/status") return Response.json({ connected: true });
    if (url.pathname === "/api/motion/telemetry") return Response.json({ imu: { yaw: imu[faction] } });
    if (url.pathname === "/api/motion/target_yaw") { imu[faction] = body.target_yaw; return Response.json({ status: "ok" }); }
    if (url.pathname === "/api/motion/move_distance") {
      const pose = poses[faction]!; const distanceCm = body.left_distance_mm / 10;
      const heading = imu[faction] * Math.PI / 180;
      poses[faction] = { ...pose, x: pose.x + Math.cos(heading) * distanceCm, z: pose.z + Math.sin(heading) * distanceCm, headingDeg: imu[faction], capturedAt: pose.capturedAt + 1 };
      return Response.json({ status: "ok" });
    }
    if (url.pathname === "/api/motion/stop") return Response.json({ status: "ok" });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  const transport = new DualAuraHttpTransport(
    { red: "http://red", blue: "http://blue" }, hardwareModes, undefined,
    (faction) => poses[faction], async () => undefined,
  );
  return { transport, poses, calls, restore: () => { globalThis.fetch = originalFetch; } };
}

test("one physical AURA moves in visual 8 cm corrections while the other remains virtual", async () => {
  const system = fakeRobotSystem({ red: "physical", blue: "virtual" });
  try {
    await system.transport.connect();
    assert.equal(system.transport.endpointStates.red, "connected");
    assert.equal(system.transport.endpointStates.blue, "mock");
    const virtualAck = await system.transport.send({ commandId: "blue-1", faction: "blue", kind: "move", path: [{ x: 20, z: 0 }, { x: 10, z: 0 }] });
    assert.equal((virtualAck.payload as { simulated: boolean }).simulated, true);
    const physicalAck = await system.transport.send({ commandId: "red-1", faction: "red", kind: "move", path: [{ x: -20, z: 0 }, { x: 0, z: 0 }], speedLimit: .15 });
    assert.equal((physicalAck.payload as { simulated: boolean }).simulated, false);
    assert.ok(Math.abs(system.poses.red!.x) <= 3);
    const movement = system.calls.filter((call) => call.faction === "red" && call.path === "/api/motion/move_distance");
    assert.ok(movement.length >= 2);
    assert.ok(movement.every((call) => (call.body?.left_distance_mm ?? Infinity) <= 80));
    assert.equal(system.calls.some((call) => call.faction === "blue" && call.path === "/api/motion/move_distance"), false);
  } finally { system.restore(); }
});

test("two connected AURAs each receive only their own physical path", async () => {
  const system = fakeRobotSystem({ red: "physical", blue: "physical" });
  try {
    await system.transport.connect();
    await system.transport.send({ commandId: "red-2", faction: "red", kind: "move", path: [{ x: -20, z: 0 }, { x: -10, z: 0 }] });
    await system.transport.send({ commandId: "blue-2", faction: "blue", kind: "move", path: [{ x: 20, z: 0 }, { x: 10, z: 0 }] });
    assert.equal(system.transport.endpointStates.red, "connected");
    assert.equal(system.transport.endpointStates.blue, "connected");
    assert.ok(system.calls.some((call) => call.faction === "red" && call.path === "/api/motion/move_distance"));
    assert.ok(system.calls.some((call) => call.faction === "blue" && call.path === "/api/motion/move_distance"));
  } finally { system.restore(); }
});

test("stale vision can finish a move in repeated bounded 30 cm recoveries without virtual fallback", async () => {
  const system = fakeRobotSystem({ red: "physical", blue: "virtual" });
  try {
    await system.transport.connect();
    system.poses.red!.capturedAt = Date.now() - 5000;
    const ack = await system.transport.send({ commandId: "red-stale", faction: "red", kind: "move", path: [{ x: -20, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 10 }] });
    const movement = system.calls.filter((call) => call.faction === "red" && call.path === "/api/motion/move_distance");
    assert.equal((ack.payload as { simulated: boolean }).simulated, false);
    assert.equal(movement.length, 3);
    assert.equal(movement[0]?.body?.left_distance_mm, 300);
    assert.equal(movement[0]?.body?.right_distance_mm, 300);
    assert.ok(movement.every((call) => (call.body?.left_distance_mm ?? Infinity) <= 300));
    assert.ok(system.calls.some((call) => call.path === "/api/motion/target_yaw"));
    assert.equal(system.transport.endpointStates.red, "connected");
  } finally { system.restore(); }
});

test("four-corner calibration maps the camera trapezoid and robot heading into the shared field frame", () => {
  const calibration = calibrateField([
    { id: 4, center: { x: 700, y: 900 }, corners: [] },
    { id: 5, center: { x: 300, y: 900 }, corners: [] },
    { id: 6, center: { x: 420, y: 100 }, corners: [] },
    { id: 7, center: { x: 580, y: 100 }, corners: [] },
  ]);
  const center = transformPoint(calibration.worldToPixel, { x: 0, y: 0 });
  const forward = transformPoint(calibration.worldToPixel, { x: 10, y: 0 });
  const dx = forward.x - center.x; const dy = forward.y - center.y;
  const pose = detectionToFieldPose(calibration, {
    id: 0, center,
    corners: [
      { x: forward.x - dy * .1, y: forward.y + dx * .1 },
      { x: forward.x + dy * .1, y: forward.y - dx * .1 },
      { x: center.x - dx, y: center.y - dy },
      { x: center.x - dx, y: center.y - dy },
    ],
  });
  assert.ok(Math.abs(pose.x) < 1e-6);
  assert.ok(Math.abs(pose.z) < 1e-6);
  assert.ok(Math.abs(pose.headingDeg) < 1e-6);
});
