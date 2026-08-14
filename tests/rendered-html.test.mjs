import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function worker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

const bindings = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const executionContext = {
  waitUntil() {},
  passThroughOnException() {},
};

test("server-renders the playable AURA game shell", async () => {
  const response = await (await worker()).fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    bindings,
    executionContext,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>AURA：双核协议<\/title>/i);
  assert.doesNotMatch(html, /第七方舟战区 · 战术控制台/);
  assert.match(html, /赤曜阵营(?:<!-- -->)?手牌/);
  assert.match(html, /摸牌/);
  assert.match(html, /AURA 驾驶人格/);
  assert.match(html, /破阵者/);
  assert.match(html, /人格裁决/);
  assert.match(html, /玩家直控/);
  assert.match(html, /玩家先选择卡牌，AURA 再决定如何执行/);
  assert.match(html, /连接机器人/);
  assert.match(html, /牌库<\/span><b>18<\/b>/);
  assert.match(html, /class="card-art"/);
  assert.match(html, /\/cards\/(?:move|pulse|beam|pierce|repair|shield|jam)\.webp/);
});

test("dual AURA transport preserves mock play and enforces physical safety limits", async () => {
  const [transportSource, protocolSource, appSource] = await Promise.all([
    readFile(new URL("../app/lib/robot-transport.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/protocol.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AuraGameApp.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(transportSource, /\/api\/motion\/status/);
  assert.match(transportSource, /\/api\/motion\/telemetry/);
  assert.match(transportSource, /\/api\/motion\/target_yaw/);
  assert.match(transportSource, /\/api\/motion\/move_distance/);
  assert.match(transportSource, /\/api\/motion\/stop/);
  assert.match(transportSource, /Math\.min\([\s\S]*0\.15\)/);
  assert.match(protocolSource, /path\?: Vec2\[\]/);
  assert.match(appSource, /阵营机器人配置/);
  assert.match(appSource, /虚拟机器人/);
  assert.match(appSource, /实体机器人/);
  assert.match(appSource, /实体 \/ 虚拟混合/);
  assert.match(appSource, /new MockRobotTransport\(\)/);
  assert.match(appSource, /path: route\.points/);
  assert.match(transportSource, /this\.endpointStates\[command\.faction\] !== "connected"/);
  assert.match(transportSource, /fallbackFaction\(faction: Faction\)/);
  assert.match(transportSource, /getVisualPose/);
  assert.match(transportSource, /Date\.now\(\) - pose\.capturedAt <= 900/);
  assert.match(transportSource, /Math\.min\(distanceCm, 8\)/);
  assert.match(transportSource, /视觉仍未恢复/);
  assert.match(transportSource, /定位发生跳变，运动已停止/);
  assert.match(appSource, /onRobotPoses=\{receiveRobotPoses\}/);
  assert.match(appSource, /robotEndpointStates\[incoming\.faction\] === "connected"/);
  assert.match(appSource, /moveUsesPhysicalRobot/);
  assert.match(appSource, /headings=\{visualHeadings\}/);
});

test("embedded robot debug console keeps hold-to-drive safety controls", async () => {
  const [appSource, debugSource, cssSource] = await Promise.all([
    readFile(new URL("../app/components/AuraGameApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/RobotDebugPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(appSource, /机器人调试/);
  assert.match(appSource, /<RobotDebugPanel/);
  assert.match(debugSource, /\/api\/motion\/status/);
  assert.match(debugSource, /\/api\/motion\/telemetry/);
  assert.match(debugSource, /\/api\/motion\/cmd_vel/);
  assert.match(debugSource, /\/api\/motion\/move_distance/);
  assert.match(debugSource, /\/api\/motion\/stop/);
  assert.match(debugSource, /\/api\/media\/camera\/snapshot\?t=/);
  assert.match(debugSource, /\/api\/media\/display\/expression/);
  assert.match(debugSource, /屏幕表情 Demo/);
  assert.match(debugSource, /机器人视角/);
  assert.match(debugSource, /scheduleCameraFrame\(450\)/);
  assert.match(debugSource, /scheduleCameraFrame\(1500\)/);
  assert.match(debugSource, /setInterval\(\(\) => void sendVector/);
  assert.match(debugSource, /left_distance_mm: -40 \* sign/);
  assert.match(debugSource, /right_distance_mm: 40 \* sign/);
  assert.match(debugSource, /pressedDirections\.current/);
  assert.match(debugSource, /linearSign \* linearSpeed, turnSign \* Math\.min/);
  assert.match(debugSource, /releaseDrive\(direction\)/);
  assert.match(debugSource, /窗口失焦自动停车/);
  assert.match(debugSource, /max="0\.15"/);
  assert.match(cssSource, /\.robot-debug-panel/);
  assert.match(cssSource, /\.robot-debug-camera-view/);
});

test("camera gateway refreshes the phone URL when the Mac LAN address changes", async () => {
  const [gatewaySource, cameraPanelSource] = await Promise.all([
    readFile(new URL("../scripts/lan-camera-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/components/GlobalCameraPanel.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(gatewaySource, /function currentLanAddresses\(\)/);
  assert.match(gatewaySource, /currentGatewayInfo\(\)/);
  assert.match(gatewaySource, /httpsServer\.setSecureContext\(credentials\)/);
  assert.match(cameraPanelSource, /setInterval\(refreshGatewayInfo, 3000\)/);
  assert.match(cameraPanelSource, /cache: "no-store"/);
});

test("global camera supports four-corner field calibration and coordinate overlay", async () => {
  const [cameraSource, calibrationSource, cssSource, gatewaySource] = await Promise.all([
    readFile(new URL("../app/components/GlobalCameraPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/field-calibration.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../scripts/lan-camera-server.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(cameraSource, /开始标定/);
  assert.match(cameraSource, /重新标定/);
  assert.match(cameraSource, /O 0,0/);
  assert.match(cameraSource, /\+X/);
  assert.match(cameraSource, /\+Z/);
  assert.match(calibrationSource, /4: \{ x: -FIELD_LENGTH_CM \/ 2, z: -FIELD_WIDTH_CM \/ 2 \}/);
  assert.match(calibrationSource, /5: \{ x: -FIELD_LENGTH_CM \/ 2, z: FIELD_WIDTH_CM \/ 2 \}/);
  assert.match(calibrationSource, /6: \{ x: FIELD_LENGTH_CM \/ 2, z: FIELD_WIDTH_CM \/ 2 \}/);
  assert.match(calibrationSource, /7: \{ x: FIELD_LENGTH_CM \/ 2, z: -FIELD_WIDTH_CM \/ 2 \}/);
  assert.match(calibrationSource, /homographyFromFourPoints/);
  assert.match(calibrationSource, /detectionToFieldPose/);
  assert.match(cameraSource, /headingDeg\.toFixed\(1\)/);
  assert.match(cssSource, /\.camera-calibration/);
  assert.match(cameraSource, /setTimeout\(connectViewer, 1500\)/);
  assert.match(cameraSource, /nextSocket\.onerror/);
  assert.match(cameraSource, /searchParams\.set\("client", crypto\.randomUUID\(\)\)/);
  assert.match(gatewaySource, /viewers: new Map\(\)/);
  assert.match(gatewaySource, /viewerCount/);
  assert.match(gatewaySource, /room\.viewers\.forEach/);
});

test("digital twin can expose the shared physical field coordinate system", async () => {
  const twinSource = await readFile(new URL("../app/components/TwinScene.tsx", import.meta.url), "utf8");
  assert.match(twinSource, /显示坐标/);
  assert.match(twinSource, /隐藏坐标/);
  assert.match(twinSource, /RED BASE  \(-79, 0\)/);
  assert.match(twinSource, /BLUE BASE  \(79, 0\)/);
  assert.match(twinSource, /CORE  \(0, 0\)/);
  assert.match(twinSource, /coordinateGuide\.visible = coordinatesVisible/);
});

test("agent rejects an illegal card without an external model call", async () => {
  const gameWorker = await worker();
  const response = await gameWorker.fetch(
    new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        round: 1,
        active: "red",
        points: 3,
        personality: "vanguard",
        selectedCard: { id: "red-pulse-01", name: "曙光脉冲", type: "pulse", cost: 1, range: 80, damage: 20 },
        player: { auraHp: 40, baseHp: 60, shield: 0, revives: 2, position: { x: -58, z: 0 } },
        enemy: { auraHp: 40, baseHp: 60, shield: 0, revives: 2, position: { x: 58, z: 0 } },
        moveOptions: [],
      }),
    }),
    bindings,
    executionContext,
  );

  const decision = await response.json();
  assert.equal(decision.decision, "refuse");
  assert.equal(decision.source, "local");
  assert.match(decision.reason, /超出射程/);
});

test("vanguard movement prefers a curved advance over a straight retreat", async () => {
  const gameWorker = await worker();
  const response = await gameWorker.fetch(
    new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        round: 1,
        active: "red",
        points: 3,
        personality: "vanguard",
        selectedCard: { id: "red-move-01", name: "极昼疾行", type: "move", cost: 1, range: 70 },
        player: { auraHp: 40, baseHp: 60, shield: 0, revives: 2, position: { x: -58, z: 0 } },
        enemy: { auraHp: 40, baseHp: 60, shield: 0, revives: 2, position: { x: 58, z: 0 } },
        moveOptions: [
          { id: "retreat", point: { x: -78, z: 0 }, routeLength: 20, distanceToEnemy: 136, distanceToEnemyBase: 157, distanceToOwnBase: 1, progressToEnemy: -20, progressToEnemyBase: -20, lateralOffset: 0, waypointCount: 2, direct: true, repetitionPenalty: 20, preferredRange: 45, rangeError: 91, attackReadiness: 0 },
          { id: "flank", point: { x: -10, z: 28 }, routeLength: 61, distanceToEnemy: 74, distanceToEnemyBase: 93, distanceToOwnBase: 74, progressToEnemy: 42, progressToEnemyBase: 44, lateralOffset: 28, waypointCount: 8, direct: false, repetitionPenalty: 0, preferredRange: 45, rangeError: 29, attackReadiness: 0 },
          { id: "advance", point: { x: -8, z: 15 }, routeLength: 58, distanceToEnemy: 68, distanceToEnemyBase: 88, distanceToOwnBase: 73, progressToEnemy: 48, progressToEnemyBase: 49, lateralOffset: 15, waypointCount: 7, direct: false, repetitionPenalty: 0, preferredRange: 45, rangeError: 23, attackReadiness: 20 },
        ],
      }),
    }),
    bindings,
    executionContext,
  );

  const decision = await response.json();
  assert.equal(decision.decision, "execute");
  assert.notEqual(decision.target, "retreat");
  assert.ok(["advance", "flank"].includes(decision.target));
  assert.match(decision.reason, /绕障|推进/);
});

test("agent dynamically switches attack targets when a kill is available", async () => {
  const gameWorker = await worker();
  const decide = async (enemy) => {
    const response = await gameWorker.fetch(
      new Request("http://localhost/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          round: 2,
          active: "red",
          points: 3,
          personality: "strategist",
          selectedCard: { id: "red-beam-01", name: "裂空光束", type: "beam", cost: 2, range: 55, damage: 30 },
          player: { auraHp: 40, baseHp: 60, shield: 0, revives: 2, position: { x: 30, z: 0 } },
          enemy: { shield: 0, revives: 1, position: { x: 40, z: 0 }, ...enemy },
          moveOptions: [],
        }),
      }),
      bindings,
      executionContext,
    );
    return response.json();
  };

  assert.equal((await decide({ auraHp: 20, baseHp: 60 })).target, "enemy_aura");
  assert.equal((await decide({ auraHp: 40, baseHp: 20 })).target, "enemy_base");
});

test("vanguard cannot attack a distant base through a nearby enemy AURA", async () => {
  const gameWorker = await worker();
  const response = await gameWorker.fetch(
    new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        round: 2,
        active: "red",
        points: 3,
        personality: "vanguard",
        selectedCard: { id: "red-pierce-01", name: "天穹贯穿", type: "pierce", cost: 3, range: 75, damage: 45 },
        player: { auraHp: 40, baseHp: 60, shield: 0, revives: 2, position: { x: -58, z: 0 } },
        enemy: { auraHp: 40, baseHp: 20, shield: 0, revives: 1, position: { x: -20, z: 0 } },
        moveOptions: [],
      }),
    }),
    bindings,
    executionContext,
  );

  const decision = await response.json();
  assert.equal(decision.decision, "execute");
  assert.equal(decision.target, "enemy_aura");
  assert.match(decision.reason, /AURA/);
});

test("navigation keeps the midfield corridor open for curved routes", async () => {
  const navigationSource = await readFile(new URL("../app/lib/navigation.ts", import.meta.url), "utf8");

  assert.match(navigationSource, /const GRID_STEP_CM = 2;/);
  assert.match(navigationSource, /const PLANNING_MARGIN_CM = \.5;/);
  assert.doesNotMatch(navigationSource, /const PLANNING_MARGIN_CM = 2;/);
  assert.match(navigationSource, /roundedRoute\(simplified\)/);
});

test("card rules have no per-type turn limits", async () => {
  const [gameSource, appSource] = await Promise.all([
    readFile(new URL("../app/lib/game.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AuraGameApp.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(gameSource, /TurnLimits|每回合最多两次/);
  assert.match(gameSource, /range: 35/);
  assert.match(gameSource, /range: 55/);
  assert.match(gameSource, /range: 75/);
  assert.doesNotMatch(appSource, /limits\.(moves|weapons|repairs|jam)|refusedCardIds/);
  assert.match(appSource, /for \(const radius of \[70, 60, 50, 40, 30, 20\]\)/);
  assert.match(appSource, /angle \+= 22\.5/);
  assert.match(appSource, /repetitionPenalty/);
  assert.match(appSource, /preferredRange/);
  assert.match(appSource, /consumeCard\(current, card, players\)/);
  assert.doesNotMatch(appSource, /卡牌保留，能量足够即可再次提交/);
  assert.match(appSource, /points: Math\.max\(0, current\.points - card\.cost\)/);
  assert.match(appSource, /卡牌作废并消耗/);
  assert.match(appSource, /activePlayer\.auraHp <= 0/);
  assert.match(appSource, /基地回血 · 消耗 10/);
});

test("attack resolution triggers the Moonfall-style impact pillar", async () => {
  const [sceneSource, appSource] = await Promise.all([
    readFile(new URL("../app/components/TwinScene.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AuraGameApp.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(sceneSource, /spawnImpact/);
  assert.match(sceneSource, /new THREE\.RingGeometry/);
  assert.match(sceneSource, /new THREE\.CylinderGeometry/);
  assert.match(sceneSource, /THREE\.AdditiveBlending/);
  assert.match(sceneSource, /scene\.remove\(effect\.ring, effect\.beam, effect\.core, effect\.light\)/);
  assert.match(appSource, /setImpact\(/);
  assert.match(appSource, /target: resolution\.target === "enemy_base" \? "base" : "aura"/);
  assert.match(appSource, /&& !attackWasJammed/);
});

test("real card artwork and play animation remain wired into the hand UI", async () => {
  const [appSource, cssSource, sceneSource] = await Promise.all([
    readFile(new URL("../app/components/AuraGameApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/components/TwinScene.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /played-card-effect/);
  assert.match(appSource, /setPlayedCard\(\{ id: Date\.now\(\), card, faction: snapshot\.active, origin:/);
  assert.match(appSource, /battle-action-slot/);
  assert.match(appSource, /card-outcome-fx/);
  assert.match(appSource, /card-preview-modal/);
  assert.match(appSource, /energy-cost-fx/);
  assert.match(appSource, /intel-collapsed/);
  assert.match(sceneSource, /rangeGuide/);
  assert.match(cssSource, /@keyframes play-card-launch/);
  assert.match(cssSource, /@keyframes card-outcome-refuse/);
  assert.match(cssSource, /aspect-ratio:54\/85\.6/);
});

test("physical card scans are integrated with setup, draw and play", async () => {
  const [appSource, scannerSource, cssSource] = await Promise.all([
    readFile(new URL("../app/components/AuraGameApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/CardScanner.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(appSource, /type DeckMode = "virtual" \| "physical"/);
  assert.match(appSource, /setPhysicalSetup\(\{ faction: "red", counts: \{ red: 0, blue: 0 \} \}\)/);
  assert.match(appSource, /physicalScanIntent === "draw"/);
  assert.match(appSource, /setTab\("command"\)/);
  assert.match(appSource, /登记摸牌/);
  assert.match(appSource, /scan-card-arrival/);
  assert.match(scannerSource, /onScanRef\.current\(value\)/);
  assert.match(scannerSource, /instruction\?: string; feedback\?: string/);
  assert.match(cssSource, /@keyframes scan-card-arrive/);
});

test("keeps the DeepSeek credential server-only and documented", async () => {
  const [route, exampleEnv, gitignore] = await Promise.all([
    readFile(new URL("../app/api/agent/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
  ]);

  assert.match(route, /process\.env\.DEEPSEEK_API_KEY/);
  assert.match(route, /AbortController/);
  assert.match(route, /thinking:\s*\{\s*type:\s*"disabled"\s*\}/);
  assert.match(route, /return fallback\(\)/);
  assert.match(exampleEnv, /^DEEPSEEK_API_KEY=replace_with_your_rotated_key$/m);
  assert.match(gitignore, /^\.env\*$/m);
  assert.doesNotMatch(route, /sk-[a-z0-9]{12,}/i);
  assert.doesNotMatch(exampleEnv, /sk-[a-z0-9]{12,}/i);
});
