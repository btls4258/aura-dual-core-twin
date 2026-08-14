"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { FIELD_LENGTH_CM, FIELD_WIDTH_CM, type Faction, type Vec2 } from "../lib/game";
import { planRoute, ROBOT_COLLISION_RADIUS_CM } from "../lib/navigation";

type Props = {
  positions: Record<Faction, Vec2>;
  headings?: Partial<Record<Faction, number>>;
  plannedTarget?: Vec2;
  active: Faction;
  rangePreview?: { range: number; kind: "move" | "attack" };
  impact?: { id: number; source: Faction; targetFaction: Faction; target: "aura" | "base"; power: number };
  onFieldPoint: (point: Vec2) => void;
};

type ImpactFx = {
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  core: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  light: THREE.PointLight;
  t: number;
  life: number;
  power: number;
};

type SceneHandles = {
  robots: Record<Faction, THREE.Group>;
  target: THREE.Mesh;
  rangeGuide: THREE.LineLoop;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  robotRoutes: Record<Faction, { points: THREE.Vector3[]; index: number }>;
  routeLines: Record<Faction, THREE.Line>;
  setRouteLine: (faction: Faction, points: Vec2[]) => void;
  moving: Record<Faction, boolean>;
  spawnImpact: (position: THREE.Vector3, color: number, power: number) => void;
  coordinateGuide: THREE.Group;
  previewFaction?: Faction;
  controlsView: "tactical" | "cinematic" | "free";
};

function fallbackObject(color: number, kind: "base" | "cover" | "core") {
  const group = new THREE.Group();
  const geometry = kind === "base" ? new THREE.CylinderGeometry(15, 20, 10, 8) : kind === "core" ? new THREE.OctahedronGeometry(10) : new THREE.BoxGeometry(18, 18, 22);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: .72, metalness: .25 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.y = kind === "core" ? 10 : 5;
  group.add(mesh);
  return group;
}

function applyModelColor(model: THREE.Object3D, kind: "base" | "cover" | "core", accent: number) {
  const tint = new THREE.Color(accent);
  const tintStrength = kind === "base" ? .62 : kind === "core" ? .55 : .16;
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const colored = materials.map((source) => {
      const material = source.clone();
      if ("color" in material && material.color instanceof THREE.Color) material.color.lerp(tint, tintStrength);
      if ("emissive" in material && material.emissive instanceof THREE.Color) { material.emissive.copy(tint); material.emissiveIntensity = kind === "base" ? .055 : kind === "core" ? .04 : .01; }
      return material;
    });
    node.material = Array.isArray(node.material) ? colored : colored[0];
  });
}

function buildStormWorld(scene: THREE.Scene) {
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { time: { value: 0 } },
    vertexShader: `varying vec3 vPos; void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      varying vec3 vPos; uniform float time;
      void main(){
        float h=normalize(vPos).y;
        vec3 ground=vec3(0.025,0.055,0.071);
        vec3 horizon=vec3(0.12,0.24,0.27);
        vec3 zenith=vec3(0.012,0.025,0.052);
        vec3 color=mix(horizon,zenith,smoothstep(-0.05,0.72,h));
        color=mix(ground,color,smoothstep(-0.35,0.08,h));
        float ribbon=sin(vPos.x*.018+sin(vPos.z*.013)+time*.08)*.5+.5;
        float aurora=smoothstep(.72,.94,ribbon)*smoothstep(.04,.32,h)*(1.0-smoothstep(.42,.72,h));
        color+=vec3(.06,.28,.31)*aurora*.35;
        gl_FragColor=vec4(color,1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(620, 40, 24), skyMaterial);
  scene.add(sky);

  const terrainGeometry = new THREE.PlaneGeometry(920, 720, 64, 48);
  const positions = terrainGeometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i); const z = positions.getY(i);
    const edgeX = Math.max(0, Math.abs(x) - 195); const edgeZ = Math.max(0, Math.abs(z) - 135);
    const edge = Math.min(1, Math.hypot(edgeX, edgeZ) / 160);
    const ridges = Math.sin(x * .026) * 11 + Math.cos(z * .035 + 1.7) * 8 + Math.sin((x + z) * .014) * 13;
    positions.setZ(i, edge * (14 + Math.abs(ridges)) - 4);
  }
  terrainGeometry.computeVertexNormals();
  const terrain = new THREE.Mesh(terrainGeometry, new THREE.MeshStandardMaterial({ color: 0x13232a, roughness: .98, metalness: .03, flatShading: true }));
  terrain.rotation.x = -Math.PI / 2; terrain.position.y = -4.5; terrain.receiveShadow = true; scene.add(terrain);

  const starCount = 900; const starPositions = new Float32Array(starCount * 3); const starColors = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i += 1) {
    const radius = 300 + Math.random() * 230; const angle = Math.random() * Math.PI * 2; const height = 45 + Math.random() * 300;
    starPositions[i * 3] = Math.cos(angle) * radius; starPositions[i * 3 + 1] = height; starPositions[i * 3 + 2] = Math.sin(angle) * radius;
    const bright = .35 + Math.random() * .65; starColors[i * 3] = bright * .68; starColors[i * 3 + 1] = bright * .86; starColors[i * 3 + 2] = bright;
  }
  const starGeometry = new THREE.BufferGeometry(); starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3)); starGeometry.setAttribute("color", new THREE.BufferAttribute(starColors, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: .75, depthWrite: false })); scene.add(stars);

  const sun = new THREE.Mesh(new THREE.SphereGeometry(15, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffdda0 }));
  sun.position.set(-285, 115, -330); scene.add(sun);
  const haloCanvas = document.createElement("canvas"); haloCanvas.width = haloCanvas.height = 128;
  const context = haloCanvas.getContext("2d")!; const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, "rgba(255,231,180,.9)"); gradient.addColorStop(.18, "rgba(235,192,112,.38)"); gradient.addColorStop(1, "rgba(235,178,90,0)"); context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
  const haloTexture = new THREE.CanvasTexture(haloCanvas); const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.position.copy(sun.position); halo.scale.set(105, 105, 1); scene.add(halo);

  const stormRing = new THREE.Mesh(new THREE.TorusGeometry(255, 1.2, 8, 128), new THREE.MeshBasicMaterial({ color: 0x5ccddd, transparent: true, opacity: .2, blending: THREE.AdditiveBlending }));
  stormRing.rotation.x = Math.PI / 2; stormRing.position.y = 18; scene.add(stormRing);
  return { skyMaterial, stars, stormRing, haloTexture };
}

export function TwinScene({ positions, headings, plannedTarget, active, rangePreview, impact, onFieldPoint }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const handlesRef = useRef<SceneHandles | null>(null);
  const onPointRef = useRef(onFieldPoint);
  const initialPositionsRef = useRef(positions);
  const [view, setView] = useState<"tactical" | "cinematic" | "free">("tactical");
  const [modelStatus, setModelStatus] = useState("载入场景模型");
  const [motionStatus, setMotionStatus] = useState<string | null>(null);
  const [coordinatesVisible, setCoordinatesVisible] = useState(false);
  useEffect(() => { onPointRef.current = onFieldPoint; }, [onFieldPoint]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060b12);
    scene.fog = new THREE.FogExp2(0x071019, 0.0024);
    const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / mount.clientHeight, 0.1, 1200);
    camera.position.set(0, 170, 1);
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.domElement.style.touchAction = "none";
    mount.appendChild(renderer.domElement);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
    scene.environment = environment;
    pmrem.dispose();
    const stormWorld = buildStormWorld(scene);
    const impactFx: ImpactFx[] = [];
    const spawnImpact = (position: THREE.Vector3, color: number, power: number) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.4, 2.8, 64),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .72, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(position.x, .55, position.z);
      ring.renderOrder = 12;
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(.75, 1.7, 72, 18, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .48, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
      );
      beam.position.set(position.x, 36, position.z);
      beam.renderOrder = 11;
      const core = new THREE.Mesh(
        new THREE.CylinderGeometry(.22, .6, 78, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .78, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
      );
      core.position.set(position.x, 39, position.z);
      core.renderOrder = 13;
      const light = new THREE.PointLight(color, 18 * power, 55, 2);
      light.position.set(position.x, 8, position.z);
      scene.add(ring, beam, core, light);
      impactFx.push({ ring, beam, core, light, t: 0, life: 1.15, power });
    };

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = .065;
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.screenSpacePanning = false;
    controls.minDistance = 65;
    controls.maxDistance = 320;
    controls.minPolarAngle = .12;
    controls.maxPolarAngle = Math.PI * .48;
    controls.zoomToCursor = true;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    controls.addEventListener("start", () => setView("free"));
    controls.update();

    scene.add(new THREE.HemisphereLight(0x8ec9ff, 0x081018, 1.4));
    const sun = new THREE.DirectionalLight(0xe6f5ff, 3.2);
    sun.position.set(-100, 180, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -120; sun.shadow.camera.right = 120; sun.shadow.camera.top = 75; sun.shadow.camera.bottom = -75;
    scene.add(sun);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_LENGTH_CM, FIELD_WIDTH_CM), new THREE.MeshStandardMaterial({ color: 0x111b22, roughness: .96, metalness: .04 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.name = "field";
    scene.add(floor);
    const grid = new THREE.GridHelper(FIELD_LENGTH_CM, 18, 0x345061, 0x1a2c35);
    grid.scale.z = FIELD_WIDTH_CM / FIELD_LENGTH_CM;
    grid.position.y = .12;
    (grid.material as THREE.Material).opacity = .2;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    const coordinateGuide = new THREE.Group(); coordinateGuide.visible = false; coordinateGuide.renderOrder = 20;
    const coordinateTextures: THREE.CanvasTexture[] = [];
    const guideLine = (from: THREE.Vector3, to: THREE.Vector3, color: number, opacity = .9) => {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([from, to]),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false }),
      );
      line.renderOrder = 20; coordinateGuide.add(line);
    };
    const guideLabel = (text: string, x: number, z: number, color = "#e9d093", scale = 11) => {
      const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 72;
      const context = canvas.getContext("2d")!; context.fillStyle = "rgba(5,10,12,.84)"; context.fillRect(0, 0, 320, 72);
      context.strokeStyle = color; context.lineWidth = 3; context.strokeRect(2, 2, 316, 68);
      context.fillStyle = color; context.font = "700 27px monospace"; context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(text, 160, 38);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; coordinateTextures.push(texture);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
      sprite.position.set(x, 2.4, z); sprite.scale.set(scale * 2.8, scale * .63, 1); sprite.renderOrder = 21; coordinateGuide.add(sprite);
    };
    guideLine(new THREE.Vector3(-90, .75, 0), new THREE.Vector3(90, .75, 0), 0xe8bd63, 1);
    guideLine(new THREE.Vector3(0, .77, -45), new THREE.Vector3(0, .77, 45), 0x62b9ee, 1);
    for (let x = -90; x <= 90; x += 30) {
      guideLine(new THREE.Vector3(x, .76, -2), new THREE.Vector3(x, .76, 2), 0xe8bd63, .85);
      guideLabel(`X ${x}`, x, -40, "#e8bd63", 8);
    }
    for (let z = -45; z <= 45; z += 15) {
      guideLine(new THREE.Vector3(-2, .78, z), new THREE.Vector3(2, .78, z), 0x62b9ee, .85);
      if (z !== 0) guideLabel(`Z ${z}`, -82, z, "#62b9ee", 8);
    }
    guideLabel("O  (0, 0)", 0, 0, "#ffffff", 10);
    guideLabel("RED BASE  (-79, 0)", -70, 18, "#ff837d", 9);
    guideLabel("BLUE BASE  (79, 0)", 70, 18, "#79c5ff", 9);
    guideLabel("CORE  (0, 0)", 0, -13, "#e9cc7c", 9);
    guideLabel("(-20, -27)", -20, -27, "#b9c8cd", 7);
    guideLabel("(20, -27)", 20, -27, "#b9c8cd", 7);
    guideLabel("(-20, 27)", -20, 27, "#b9c8cd", 7);
    guideLabel("(20, 27)", 20, 27, "#b9c8cd", 7);
    scene.add(coordinateGuide);

    const padTextures: THREE.CanvasTexture[] = [];
    const makeBasePad = (x: number, color: number, designation: string) => {
      const colorText = `#${color.toString(16).padStart(6, "0")}`;
      const underlay = new THREE.Mesh(
        new THREE.CylinderGeometry(20, 20, .3, 96),
        new THREE.MeshStandardMaterial({ color: 0x091116, roughness: .92, metalness: .08 }),
      );
      underlay.position.set(x, .15, 0);
      underlay.receiveShadow = true;
      scene.add(underlay);

      const canvas = document.createElement("canvas");
      canvas.width = 1024; canvas.height = 1024;
      const context = canvas.getContext("2d")!;
      context.translate(512, 512);
      context.beginPath(); context.arc(0, 0, 500, 0, Math.PI * 2); context.clip();
      context.fillStyle = "#0b1419"; context.fillRect(-512, -512, 1024, 1024);
      const glow = context.createRadialGradient(0, 0, 90, 0, 0, 500);
      glow.addColorStop(0, `${colorText}36`); glow.addColorStop(.58, `${colorText}17`); glow.addColorStop(1, `${colorText}08`);
      context.fillStyle = glow; context.fillRect(-512, -512, 1024, 1024);

      context.strokeStyle = `${colorText}d9`; context.lineWidth = 24;
      context.beginPath(); context.arc(0, 0, 474, 0, Math.PI * 2); context.stroke();
      context.strokeStyle = `${colorText}66`; context.lineWidth = 7; context.setLineDash([28, 18]);
      context.beginPath(); context.arc(0, 0, 382, 0, Math.PI * 2); context.stroke();
      context.setLineDash([]);
      context.strokeStyle = `${colorText}2d`; context.lineWidth = 3;
      context.beginPath(); context.arc(0, 0, 270, 0, Math.PI * 2); context.stroke();

      for (let index = 0; index < 12; index += 1) {
        context.save(); context.rotate(index * Math.PI / 6);
        context.fillStyle = index % 3 === 0 ? `${colorText}cc` : `${colorText}66`;
        context.fillRect(-10, -460, 20, index % 3 === 0 ? 72 : 42);
        context.strokeStyle = `${colorText}38`; context.lineWidth = 4;
        context.beginPath(); context.moveTo(0, -370); context.lineTo(0, -292); context.stroke();
        context.restore();
      }

      context.fillStyle = `${colorText}1f`; context.fillRect(-54, -290, 108, 580);
      context.fillStyle = `${colorText}aa`; context.fillRect(-18, -290, 36, 105);
      context.fillRect(-18, 185, 36, 105);
      context.font = "700 48px sans-serif"; context.textAlign = "center"; context.textBaseline = "middle";
      context.fillStyle = `${colorText}e8`; context.fillText("AURA BASE", 0, 340);
      context.font = "800 58px monospace"; context.fillText(designation, 0, -335);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      padTextures.push(texture);
      const surface = new THREE.Mesh(
        new THREE.CircleGeometry(20, 96),
        new THREE.MeshStandardMaterial({ map: texture, transparent: true, alphaTest: .04, roughness: .8, metalness: .18, emissive: color, emissiveIntensity: .06 }),
      );
      surface.rotation.x = -Math.PI / 2;
      surface.position.set(x, .31, 0);
      surface.receiveShadow = true;
      scene.add(surface);
    };
    makeBasePad(-70, 0xff554f, "R-01");
    makeBasePad(70, 0x4ca9ff, "B-01");

    const loader = new GLTFLoader();
    let loaded = 0;
    let auraLoaded = false;
    const refreshModelStatus = () => {
      if (loaded === 7 && auraLoaded) setModelStatus("实景模型与 AURA 就绪");
      else if (loaded === 7) setModelStatus("载入 AURA 模型");
    };
    const load = (url: string, at: [number, number, number], footprint: number, maxHeight: number, color: number, kind: "base" | "cover" | "core", rotation = 0) => {
      const slot = new THREE.Group(); slot.position.set(...at); slot.rotation.y = rotation; scene.add(slot);
      const placeholder = fallbackObject(color, kind); slot.add(placeholder);
      loader.load(url, (gltf) => {
        slot.remove(placeholder);
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const scale = Math.min(footprint / Math.max(size.x, size.z, .001), maxHeight / Math.max(size.y, .001));
        model.scale.setScalar(scale);
        box.setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.set(-center.x, -box.min.y, -center.z);
        model.traverse((node) => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
        slot.add(model);
        applyModelColor(model, kind, color);
        loaded += 1;
        refreshModelStatus();
      }, undefined, () => setModelStatus("部分模型使用安全占位"));
    };
    load("/models/base-red.glb", [-79, .32, 0], 15, 32, 0xe04c46, "base", Math.PI / 2);
    load("/models/base-blue.glb", [79, .32, 0], 15, 32, 0x3d92e8, "base");
    load("/models/central-core.glb", [0, 0, 0], 10, 22, 0xe1b651, "core");
    load("/models/ruin-tower.glb", [-20, 0, -27], 10, 20, 0xa36a3e, "cover", .2);
    load("/models/ruin-tower.glb", [20, 0, 27], 10, 20, 0xa36a3e, "cover", -1.4);
    load("/models/sea-cliff.glb", [-20, 0, 27], 10, 26, 0x7f705f, "cover", .7);
    load("/models/sea-cliff.glb", [20, 0, -27], 10, 26, 0x7f705f, "cover", -2.1);

    const makeRobot = (color: number, labelText: string) => {
      const robot = new THREE.Group();
      const halo = new THREE.Mesh(new THREE.TorusGeometry(11, .7, 8, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .85 })); halo.rotation.x = Math.PI / 2; halo.position.y = .8;
      const beacon = new THREE.PointLight(color, 3.2, 65, 2); beacon.position.y = 13;
      const labelCanvas = document.createElement("canvas"); labelCanvas.width = 256; labelCanvas.height = 64;
      const labelContext = labelCanvas.getContext("2d")!; labelContext.fillStyle = "rgba(4,10,14,.82)"; labelContext.fillRect(0, 0, 256, 64); labelContext.strokeStyle = `#${color.toString(16).padStart(6, "0")}`; labelContext.lineWidth = 4; labelContext.strokeRect(2, 2, 252, 60); labelContext.fillStyle = "#eefbff"; labelContext.font = "700 24px sans-serif"; labelContext.textAlign = "center"; labelContext.textBaseline = "middle"; labelContext.fillText(labelText, 128, 33);
      const labelTexture = new THREE.CanvasTexture(labelCanvas); const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: false })); label.position.y = 27; label.scale.set(32, 8, 1); label.renderOrder = 8;
      const trailData = new Float32Array(60 * 3).fill(9999); const trailGeometry = new THREE.BufferGeometry(); trailGeometry.setAttribute("position", new THREE.BufferAttribute(trailData, 3));
      const trail = new THREE.Points(trailGeometry, new THREE.PointsMaterial({ color, size: 2.2, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending })); trail.frustumCulled = false; scene.add(trail);
      robot.userData.motion = { trail, trailData, trailIndex: 0, lastPosition: new THREE.Vector3() };
      robot.add(halo, beacon, label); scene.add(robot); return robot;
    };
    const robots = { red: makeRobot(0xff5b50, "RED AURA"), blue: makeRobot(0x4ca9ff, "BLUE AURA") };
    loader.load("/models/aura.glb", (gltf) => {
      const sourceModel = gltf.scene;
      const sourceBox = new THREE.Box3().setFromObject(sourceModel);
      const sourceSize = sourceBox.getSize(new THREE.Vector3());
      sourceModel.scale.setScalar(15 / Math.max(sourceSize.x, sourceSize.z, .001));
      sourceBox.setFromObject(sourceModel);
      const sourceCenter = sourceBox.getCenter(new THREE.Vector3());
      sourceModel.position.set(-sourceCenter.x, -sourceBox.min.y, -sourceCenter.z);
      sourceModel.traverse((node) => {
        if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; }
      });
      robots.red.add(sourceModel.clone(true));
      robots.blue.add(sourceModel.clone(true));
      auraLoaded = true;
      refreshModelStatus();
    }, undefined, () => setModelStatus("AURA 模型载入失败"));
    robots.red.position.set(initialPositionsRef.current.red.x, 0, initialPositionsRef.current.red.z);
    robots.blue.position.set(initialPositionsRef.current.blue.x, 0, initialPositionsRef.current.blue.z);
    robots.red.rotation.y = Math.PI / 2;
    robots.blue.rotation.y = -Math.PI / 2;
    const robotRoutes = {
      red: { points: [robots.red.position.clone()], index: 0 },
      blue: { points: [robots.blue.position.clone()], index: 0 },
    };
    const moving = { red: false, blue: false };
    const makeRouteLine = (color: number) => {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color, dashSize: 5, gapSize: 3, transparent: true, opacity: .9, depthTest: false }));
      line.computeLineDistances(); line.visible = false; line.renderOrder = 5; scene.add(line); return line;
    };
    const routeLines = { red: makeRouteLine(0xff665e), blue: makeRouteLine(0x63b7ff) };
    const setRouteLine = (faction: Faction, points: Vec2[]) => {
      routeLines[faction].geometry.dispose();
      routeLines[faction].geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(point.x, .65, point.z)));
      routeLines[faction].computeLineDistances();
      routeLines[faction].visible = points.length > 1;
    };
    const target = new THREE.Mesh(new THREE.RingGeometry(5, 7, 32), new THREE.MeshBasicMaterial({ color: 0xf3c95e, transparent: true, opacity: .9, side: THREE.DoubleSide }));
    target.rotation.x = -Math.PI / 2; target.position.y = .5; target.visible = false; scene.add(target);
    const rangePoints = Array.from({ length: 129 }, (_, index) => {
      const angle = index / 128 * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    });
    const rangeGuide = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(rangePoints),
      new THREE.LineDashedMaterial({ color: 0xe1bd70, transparent: true, opacity: .72, dashSize: .045, gapSize: .025, depthWrite: false }),
    );
    rangeGuide.computeLineDistances();
    rangeGuide.visible = false;
    rangeGuide.renderOrder = 9;
    scene.add(rangeGuide);
    handlesRef.current = { robots, target, rangeGuide, camera, controls, robotRoutes, routeLines, setRouteLine, moving, spawnImpact, coordinateGuide, controlsView: "tactical" };

    const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
    let pointerStart: { x: number; y: number; time: number } | null = null;
    const pointerDown = (event: PointerEvent) => {
      if (event.button === 0) pointerStart = { x: event.clientX, y: event.clientY, time: performance.now() };
    };
    const pointerUp = (event: PointerEvent) => {
      if (!pointerStart || event.button !== 0) return;
      const travel = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
      const duration = performance.now() - pointerStart.time;
      pointerStart = null;
      if (travel > 6 || duration > 450) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(floor)[0];
      if (hit) onPointRef.current({ x: Math.round(hit.point.x), z: Math.round(hit.point.z) });
    };
    const preventContextMenu = (event: MouseEvent) => event.preventDefault();
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("contextmenu", preventContextMenu);
    const resize = () => { if (!mount) return; camera.aspect = mount.clientWidth / mount.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(mount.clientWidth, mount.clientHeight); };
    const observer = new ResizeObserver(resize); observer.observe(mount);
    const animationStart = performance.now(); let previousFrame = animationStart; let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const frameTime = performance.now(); const elapsed = (frameTime - animationStart) / 1000; const delta = Math.min(.05, (frameTime - previousFrame) / 1000); previousFrame = frameTime;
      target.rotation.z += .012;
      stormWorld.skyMaterial.uniforms.time.value = elapsed;
      stormWorld.stars.rotation.y = elapsed * .0025;
      stormWorld.stormRing.rotation.z = elapsed * .018;
      (stormWorld.stormRing.material as THREE.MeshBasicMaterial).opacity = .16 + Math.sin(elapsed * .65) * .045;
      for (let index = impactFx.length - 1; index >= 0; index -= 1) {
        const effect = impactFx[index];
        effect.t += delta;
        const progress = effect.t / effect.life;
        if (progress >= 1) {
          scene.remove(effect.ring, effect.beam, effect.core, effect.light);
          effect.ring.geometry.dispose(); effect.ring.material.dispose();
          effect.beam.geometry.dispose(); effect.beam.material.dispose();
          effect.core.geometry.dispose(); effect.core.material.dispose();
          impactFx.splice(index, 1);
          continue;
        }
        const fade = 1 - progress;
        const radius = 1 + progress * 8.5 * effect.power;
        effect.ring.scale.setScalar(radius);
        effect.ring.material.opacity = .72 * fade;
        effect.ring.rotation.z += delta * 1.8;
        effect.beam.material.opacity = .48 * fade;
        effect.beam.scale.set(.45 + fade * .55, .88 + Math.sin(progress * Math.PI) * .16, .45 + fade * .55);
        effect.core.material.opacity = .78 * fade * fade;
        effect.core.scale.set(.55 + fade * .45, 1, .55 + fade * .45);
        effect.light.intensity = 18 * effect.power * fade * fade;
      }
      (["red", "blue"] as Faction[]).forEach((faction) => {
        if (!moving[faction]) return;
        const robot = robots[faction]; const route = robotRoutes[faction]; const destination = route.points[route.index];
        if (!destination) { moving[faction] = false; routeLines[faction].visible = false; return; }
        const offset = destination.clone().sub(robot.position); const remaining = offset.length();
        if (remaining > .2) {
          const desiredHeading = Math.atan2(offset.x, offset.z); let headingDelta = desiredHeading - robot.rotation.y;
          while (headingDelta > Math.PI) headingDelta -= Math.PI * 2;
          while (headingDelta < -Math.PI) headingDelta += Math.PI * 2;
          robot.rotation.y += headingDelta * Math.min(1, delta * 6);
          robot.position.addScaledVector(offset.normalize(), Math.min(remaining, delta * 34));
          const motion = robot.userData.motion;
          if (robot.position.distanceTo(motion.lastPosition) > 1.4) {
            motion.trailIndex = (motion.trailIndex + 1) % (motion.trailData.length / 3);
            const index = motion.trailIndex * 3;
            motion.trailData[index] = robot.position.x + (Math.random() - .5) * 2;
            motion.trailData[index + 1] = .8 + Math.random() * 1.6;
            motion.trailData[index + 2] = robot.position.z + (Math.random() - .5) * 2;
            motion.lastPosition.copy(robot.position);
            motion.trail.geometry.attributes.position.array.set(motion.trailData);
            motion.trail.geometry.attributes.position.needsUpdate = true;
          }
        } else {
          robot.position.copy(destination); route.index += 1;
          if (route.index >= route.points.length) {
            moving[faction] = false; routeLines[faction].visible = false;
            setMotionStatus(`${faction === "red" ? "RED" : "BLUE"} AURA 已到达目标`);
          }
        }
      });
      controls.update(); renderer.render(scene, camera);
    };
    animate();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); rangeGuide.geometry.dispose(); (rangeGuide.material as THREE.Material).dispose(); coordinateGuide.traverse((node) => { if (node instanceof THREE.Line) { node.geometry.dispose(); (node.material as THREE.Material).dispose(); } if (node instanceof THREE.Sprite) (node.material as THREE.Material).dispose(); }); coordinateTextures.forEach((texture) => texture.dispose()); impactFx.forEach((effect) => { effect.ring.geometry.dispose(); effect.ring.material.dispose(); effect.beam.geometry.dispose(); effect.beam.material.dispose(); effect.core.geometry.dispose(); effect.core.material.dispose(); }); environment.dispose(); stormWorld.haloTexture.dispose(); padTextures.forEach((texture) => texture.dispose()); renderer.domElement.removeEventListener("pointerdown", pointerDown); renderer.domElement.removeEventListener("pointerup", pointerUp); renderer.domElement.removeEventListener("contextmenu", preventContextMenu); renderer.dispose(); mount.removeChild(renderer.domElement); };
  }, []);

  useEffect(() => {
    if (handlesRef.current) handlesRef.current.coordinateGuide.visible = coordinatesVisible;
  }, [coordinatesVisible]);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles || !impact) return;
    const position = impact.target === "base"
      ? new THREE.Vector3(impact.targetFaction === "red" ? -79 : 79, 0, 0)
      : handles.robots[impact.targetFaction].position.clone();
    const color = impact.source === "red" ? 0xff5b50 : 0x4ca9ff;
    handles.spawnImpact(position, color, impact.power);
  }, [impact]);

  useEffect(() => {
    const handles = handlesRef.current; if (!handles) return;
    (["red", "blue"] as Faction[]).forEach((faction) => {
      const p = positions[faction];
      const trackedHeading = headings?.[faction];
      if (typeof trackedHeading === "number") {
        handles.robots[faction].position.set(p.x, 0, p.z);
        handles.robots[faction].rotation.y = Math.PI / 2 - trackedHeading * Math.PI / 180;
        handles.robotRoutes[faction] = { points: [new THREE.Vector3(p.x, 0, p.z)], index: 0 };
        handles.routeLines[faction].visible = false; handles.moving[faction] = false;
        handles.robots[faction].scale.setScalar(faction === active ? 1.12 : 1);
        return;
      }
      const willMove = handles.robots[faction].position.distanceTo(new THREE.Vector3(p.x, 0, p.z)) > .2;
      if (willMove) {
        const opponent = faction === "red" ? "blue" : "red";
        const route = planRoute(
          { x: handles.robots[faction].position.x, z: handles.robots[faction].position.z },
          p,
          [{ id: "enemy-aura", x: handles.robots[opponent].position.x, z: handles.robots[opponent].position.z, radius: ROBOT_COLLISION_RADIUS_CM }],
        );
        if (route) {
          handles.robotRoutes[faction] = { points: route.points.map((point) => new THREE.Vector3(point.x, 0, point.z)), index: 1 };
          handles.setRouteLine(faction, route.points);
          handles.moving[faction] = true;
          setMotionStatus(`${faction === "red" ? "RED" : "BLUE"} AURA ${route.direct ? "直线移动" : "自动绕障"} → (${p.x}, ${p.z})`);
        } else setMotionStatus(`${faction === "red" ? "RED" : "BLUE"} AURA 路径不可达`);
      }
      handles.robots[faction].scale.setScalar(faction === active ? 1.12 : 1);
    });
    handles.target.visible = Boolean(plannedTarget);
    if (plannedTarget) {
      handles.target.position.set(plannedTarget.x, .5, plannedTarget.z);
      const opponent = active === "red" ? "blue" : "red";
      const preview = planRoute(
        { x: handles.robots[active].position.x, z: handles.robots[active].position.z },
        plannedTarget,
        [{ id: "enemy-aura", x: handles.robots[opponent].position.x, z: handles.robots[opponent].position.z, radius: ROBOT_COLLISION_RADIUS_CM }],
      );
      if (preview && !handles.moving[active]) { handles.setRouteLine(active, preview.points); handles.previewFaction = active; }
    } else if (handles.previewFaction) {
      if (!handles.moving[handles.previewFaction]) handles.routeLines[handles.previewFaction].visible = false;
      handles.previewFaction = undefined;
    }
  }, [positions, headings, plannedTarget, active]);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) return;
    handles.rangeGuide.visible = Boolean(rangePreview);
    if (!rangePreview) return;
    const origin = handles.robots[active].position;
    handles.rangeGuide.position.set(origin.x, .42, origin.z);
    handles.rangeGuide.scale.set(rangePreview.range, 1, rangePreview.range);
    const material = handles.rangeGuide.material as THREE.LineDashedMaterial;
    material.color.set(rangePreview.kind === "move" ? 0xe1bd70 : active === "red" ? 0xcf625d : 0x5f8fbd);
  }, [active, positions, rangePreview]);

  useEffect(() => {
    const handles = handlesRef.current; if (!handles) return;
    if (view === "free") { handles.controlsView = view; return; }
    handles.controls.target.set(0, 0, 0);
    if (view === "tactical") handles.camera.position.set(0, 170, 1);
    else handles.camera.position.set(135, 105, 120);
    handles.controls.update();
    handles.controlsView = view;
  }, [view]);

  return <div className="twin-shell">
    <div ref={mountRef} className="twin-canvas" aria-label="AURA 数字孪生战场" />
    <div className="twin-overlay twin-label"><span className="live-dot" />{modelStatus}</div>
    <div className="twin-overlay twin-view-switch" role="group" aria-label="视角切换">
      <button className={view === "tactical" ? "active" : ""} onClick={() => setView("tactical")}>俯视复位</button>
      <button className={view === "cinematic" ? "active" : ""} onClick={() => setView("cinematic")}>立体复位</button>
      <button className={coordinatesVisible ? "active" : ""} onClick={() => setCoordinatesVisible((visible) => !visible)}>{coordinatesVisible ? "隐藏坐标" : "显示坐标"}</button>
    </div>
    <div className="twin-overlay twin-controls-help">左键旋转 · 滚轮缩放 · 右键平移</div>
    <div className="twin-overlay twin-telemetry"><span className="red">RED 目标 {positions.red.x}, {positions.red.z}</span><span className="blue">BLUE 目标 {positions.blue.x}, {positions.blue.z}</span></div>
    {motionStatus && <div className="twin-overlay twin-motion-status"><span className="live-dot" />{motionStatus}</div>}
    <div className="twin-overlay field-scale">180 × 90 cm · 点击地面规划坐标</div>
  </div>;
}
