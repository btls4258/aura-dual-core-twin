"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AURA_START_POSITIONS, BASE_POSITIONS, CARD_DEFINITIONS, createInitialGame, distance, event, FIELD_LENGTH_CM, FIELD_SAFE_MARGIN_CM, FIELD_WIDTH_CM, otherFaction, parseCardPayload, type CardInstance, type CardType, type Faction, type GameState, type PlayerState, type Vec2 } from "../lib/game";
import { PERSONALITIES, type AgentMoveOption, type AgentResolution, type PersonalityId } from "../lib/agent-personality";
import { LanguageSwitch, useLocale, type Locale } from "../lib/i18n";
import { planRoute, ROBOT_COLLISION_RADIUS_CM } from "../lib/navigation";
import { DualAuraHttpTransport, MockRobotTransport, type RobotEndpointStates, type RobotHardwareModes, type RobotTransport, type VisualRobotPose } from "../lib/robot-transport";
import { CardScanner } from "./CardScanner";
import { GlobalCameraPanel, type RobotVisionPose } from "./GlobalCameraPanel";
import { RobotDebugPanel } from "./RobotDebugPanel";
import { TwinScene } from "./TwinScene";

const factionName = (faction: Faction) => faction === "red" ? "赤曜阵营" : "蓝穹阵营";
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const CARD_ART: Record<CardType, string> = {
  move: "/cards/move.webp",
  pulse: "/cards/pulse.webp",
  beam: "/cards/beam.webp",
  pierce: "/cards/pierce.webp",
  repair: "/cards/repair.webp",
  shield: "/cards/shield.webp",
  jam: "/cards/jam.webp",
};
const cardArt = (type: CardType, locale: Locale) => locale === "en-US" ? `/cards/en/${type}.webp` : CARD_ART[type];
const cardName = (card: CardInstance, locale: Locale) => locale === "en-US" ? card.nameEn : card.name;
const cardFunction = (card: CardInstance, locale: Locale) => locale === "en-US" ? card.functionNameEn : card.functionName;
const cardDescription = (card: CardInstance, locale: Locale) => locale === "en-US" ? card.descriptionEn : card.description;
const personalityCopy = (personality: (typeof PERSONALITIES)[PersonalityId], locale: Locale) => locale === "en-US"
  ? { name: personality.nameEn, title: personality.titleEn, description: personality.descriptionEn, credo: personality.credoEn }
  : { name: personality.name, title: personality.title, description: personality.description, credo: personality.credo };
const resolutionCopy = (resolution: AgentResolution, locale: Locale) => resolution.localized?.[locale === "en-US" ? "en" : "zh"] ?? resolution;

function Meter({ value, max, tone }: { value: number; max: number; tone: "hp" | "shield" | "base" }) {
  return <div className="meter"><i className={tone} style={{ width: `${clamp(value / max * 100, 0, 100)}%` }} /></div>;
}

type RobotMode = "mock" | "connecting" | "live";
type RobotEndpoints = Record<Faction, string>;
type DeckMode = "virtual" | "physical";
type PhysicalSetup = { faction: Faction; counts: Record<Faction, number> };
type PhysicalScanIntent = "play" | "draw";

function PlayerPanel({ player, active, endpointState, impactId, statusEffect, deckMode }: { player: PlayerState; active: boolean; endpointState: RobotEndpointStates[Faction]; impactId?: number; statusEffect?: { id: number; kind: "heal" | "shield" | "jam" }; deckMode: DeckMode }) {
  return <aside className={`player-panel ${player.faction} ${active ? "is-active" : ""} ${player.auraHp <= 0 ? "is-disabled" : ""}`}>
    {impactId && <i key={impactId} className="panel-impact-fx" />}
    {statusEffect && <span key={statusEffect.id} className={`panel-status-fx ${statusEffect.kind}`}>{statusEffect.kind === "heal" ? "+15 生命" : statusEffect.kind === "shield" ? "+20 护盾" : "链路就绪"}</span>}
    <div className="player-heading"><div><small>{active ? "当前行动" : "链路待命"}</small><h2>{factionName(player.faction)}</h2></div><span className="faction-mark">{player.faction === "red" ? "R" : "B"}</span></div>
    <div className="stat-block"><div className="stat-line"><span>AURA 生命</span><strong>{player.auraHp}<em>/40</em></strong></div><Meter value={player.auraHp} max={40} tone="hp" /></div>
    <div className="stat-block"><div className="stat-line"><span>基地核心</span><strong>{player.baseHp}<em>/60</em></strong></div><Meter value={player.baseHp} max={60} tone="base" /></div>
    <div className="mini-stats"><div><span>护盾</span><b>{player.shield}</b><small>/20</small></div><div><span>重构次数</span><b>{player.revives}</b><small>/2</small></div><div><span>手牌</span><b>{player.hand.length}</b><small>/8</small></div><div><span>牌库</span><b>{deckMode === "physical" ? "实" : player.deck.length}</b><small>{deckMode === "physical" ? "体" : "张"}</small></div></div>
    <div className="link-status"><span className={`status-dot ${endpointState === "connected" ? "connected" : endpointState === "connecting" ? "waiting" : "mock"}`} />机器人接口 · {endpointState === "connected" ? "实体 AURA" : endpointState === "connecting" ? "连接中" : "虚拟 AURA"}</div>
  </aside>;
}

function RobotConnectionPanel({ mode, endpoints, hardwareModes, endpointStates, error, onEndpoints, onHardwareModes, onConnect, onDisconnect, onClose }: {
  mode: RobotMode;
  endpoints: RobotEndpoints;
  hardwareModes: RobotHardwareModes;
  endpointStates: RobotEndpointStates;
  error?: string;
  onEndpoints: (endpoints: RobotEndpoints) => void;
  onHardwareModes: (modes: RobotHardwareModes) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onClose: () => void;
}) {
  return <div className="robot-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="robot-modal" role="dialog" aria-modal="true" aria-labelledby="robot-connection-title">
      <div className="robot-modal-head"><div><small>AURAOS · 局域网</small><h2 id="robot-connection-title">阵营机器人配置</h2></div><button aria-label="关闭机器人连接面板" onClick={onClose}>×</button></div>
      <p className="robot-intro">每个阵营可独立使用实体或虚拟 AURA。实体侧执行真实路径，虚拟侧继续在数字孪生中运行。</p>
      {(["red", "blue"] as Faction[]).map((faction) => <div className={`robot-endpoint ${faction}`} key={faction}>
        <span className="robot-endpoint-head"><b>{factionName(faction)}</b><em><i className={`status-dot ${endpointStates[faction] === "connected" ? "connected" : endpointStates[faction] === "connecting" ? "waiting" : "mock"}`} />{endpointStates[faction] === "connected" ? "实体已连接" : endpointStates[faction] === "connecting" ? "检查中" : "虚拟运行"}</em></span>
        <span className="robot-side-mode" role="group" aria-label={`${factionName(faction)}机器人模式`}><button type="button" className={hardwareModes[faction] === "virtual" ? "active" : ""} disabled={mode !== "mock"} onClick={() => onHardwareModes({ ...hardwareModes, [faction]: "virtual" })}>虚拟机器人</button><button type="button" className={hardwareModes[faction] === "physical" ? "active" : ""} disabled={mode !== "mock"} onClick={() => onHardwareModes({ ...hardwareModes, [faction]: "physical" })}>实体机器人</button></span>
        {hardwareModes[faction] === "physical" && <input type="url" aria-label={`${factionName(faction)} AURA 地址`} value={endpoints[faction]} disabled={mode !== "mock"} onChange={(event) => onEndpoints({ ...endpoints, [faction]: event.target.value })} placeholder="http://192.168.31.31:8765" />}
      </div>)}
      <div className="robot-safety"><b>实体模式安全边界</b><span>最大 0.15 m/s · 路线最长 70 cm · A* 避障 · 随时急停</span></div>
      {error && <p className="robot-error">{error}</p>}
      <div className="robot-modal-actions"><button onClick={onClose}>取消</button>{mode === "live" ? <button className="disconnect" onClick={onDisconnect}>断开全部实体机器人</button> : <button className="connect" disabled={mode === "connecting" || !(["red", "blue"] as Faction[]).some((faction) => hardwareModes[faction] === "physical") || (["red", "blue"] as Faction[]).some((faction) => hardwareModes[faction] === "physical" && !endpoints[faction].trim())} onClick={onConnect}>{mode === "connecting" ? "正在检查实体 AURA…" : "应用并连接"}</button>}</div>
    </section>
  </div>;
}

function CardChip({ card, selected, committed, disabled, onClick, onPreview }: { card: CardInstance; selected: boolean; committed?: boolean; disabled?: boolean; onClick: () => void; onPreview: () => void }) {
  const { locale, t } = useLocale();
  const name = cardName(card, locale);
  return <button className={`card-chip ${card.type} ${selected ? "selected" : ""} ${committed ? "committed" : ""}`} data-card-instance={card.id} disabled={disabled} onClick={onClick} onDoubleClick={(event) => { event.preventDefault(); onPreview(); }} title={`${name} · ${t("双击查看大图", "double-click to preview")}`} aria-label={`${name}, ${cardFunction(card, locale)}, ${t(`消耗 ${card.cost} 点能量`, `costs ${card.cost} energy`)}`}>
    <img className="card-art" src={cardArt(card.type, locale)} alt="" draggable={false} />
    <span className="card-chip-caption">{name}</span>
    <span className="card-inspect-hint">双击预览</span>
  </button>;
}

export function AuraGameApp() {
  const { locale } = useLocale();
  const [game, setGame] = useState<GameState>(() => createInitialGame());
  const [notice, setNotice] = useState("等待扫描卡牌，或从当前手牌中选择一张进行测试。 ");
  const [tab, setTab] = useState<"command" | "cameras">("command");
  const [agentResolution, setAgentResolution] = useState<AgentResolution | null>(null);
  const [impact, setImpact] = useState<{ id: number; source: Faction; targetFaction: Faction; target: "aura" | "base"; power: number }>();
  const [playedCard, setPlayedCard] = useState<{ id: number; card: CardInstance; faction: Faction; origin: { x: number; y: number } }>();
  const [cardOutcome, setCardOutcome] = useState<{ id: number; card: CardInstance; faction: Faction; status: "execute" | "refuse" | "return"; label: string }>();
  const [energySpend, setEnergySpend] = useState<{ id: number; cost: number }>();
  const [statusEffect, setStatusEffect] = useState<{ id: number; faction: Faction; kind: "heal" | "shield" | "jam" }>();
  const [previewCard, setPreviewCard] = useState<CardInstance>();
  const [intelOpen, setIntelOpen] = useState(true);
  const [agentBusy, setAgentBusy] = useState(false);
  const [decisionMode, setDecisionMode] = useState<"agent" | "manual">("agent");
  const [deckMode, setDeckMode] = useState<DeckMode>("virtual");
  const [physicalSetup, setPhysicalSetup] = useState<PhysicalSetup>();
  const [physicalScanIntent, setPhysicalScanIntent] = useState<PhysicalScanIntent>("play");
  const [scanFeedback, setScanFeedback] = useState("");
  const [scanArrival, setScanArrival] = useState<{ id: number; card: CardInstance; faction: Faction }>();
  const [personalities, setPersonalities] = useState<Record<Faction, PersonalityId>>({ red: "vanguard", blue: "guardian" });
  const [robotMode, setRobotMode] = useState<RobotMode>("mock");
  const [robotPanelOpen, setRobotPanelOpen] = useState(false);
  const [robotDebugOpen, setRobotDebugOpen] = useState(false);
  const [robotError, setRobotError] = useState<string>();
  const [robotHardwareModes, setRobotHardwareModes] = useState<RobotHardwareModes>({ red: "physical", blue: "physical" });
  const [robotEndpoints, setRobotEndpoints] = useState<RobotEndpoints>(() => {
    const defaults = { red: "http://192.168.31.31:8765", blue: "http://192.168.31.32:8765" };
    if (typeof window === "undefined") return defaults;
    try {
      const saved = window.localStorage.getItem("aura.robot.endpoints");
      return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
    } catch { return defaults; }
  });
  const [robotEndpointStates, setRobotEndpointStates] = useState<RobotEndpointStates>({ red: "mock", blue: "mock" });
  const transport = useRef<RobotTransport>(new MockRobotTransport());
  const visualPoseRef = useRef<Partial<Record<Faction, VisualRobotPose>>>({});
  const [visualHeadings, setVisualHeadings] = useState<Partial<Record<Faction, number>>>({});
  const initializedRef = useRef(false);
  const agentRequestRef = useRef(0);
  const physicalSequenceRef = useRef(0);
  const activePlayer = game.players[game.active];
  const selected = game.selectedCard;
  const selectedRange = selected?.type === "move" ? 70 : ["pulse", "beam", "pierce"].includes(selected?.type ?? "") ? selected?.range : undefined;
  const activePersonality = PERSONALITIES[personalities[game.active]];
  const visiblePersonality = personalityCopy(activePersonality, locale);
  const visibleResolution = agentResolution ? resolutionCopy(agentResolution, locale) : undefined;
  const confirmLabel = !selected ? "先选择卡牌" : agentBusy ? "AURA 裁决中…" : decisionMode === "agent" ? `交给${activePersonality.name}裁决` : selected.type === "move" && !game.plannedTarget ? "请点击战场落点" : "玩家确认执行";
  const actionStage = agentBusy ? "人格裁决" : notice.startsWith("指令已") ? "已执行" : decisionMode === "manual" && selected?.type === "move" && !game.plannedTarget ? "步骤 2/3" : selected ? "步骤 2/2" : "步骤 1/2";
  const positions = useMemo(() => ({ red: game.players.red.position, blue: game.players.blue.position }), [game.players.red.position, game.players.blue.position]);
  const connectedRobotCount = (["red", "blue"] as Faction[]).filter((faction) => robotEndpointStates[faction] === "connected").length;
  const robotLinkLabel = robotMode === "connecting" ? "机器人连接中" : connectedRobotCount === 2 ? "双实体 AURA" : connectedRobotCount === 1 ? "实体 / 虚拟混合" : "连接机器人";
  const scanInstruction = deckMode === "virtual"
    ? "虚拟牌库 · 扫描当前手牌"
    : physicalSetup
      ? `登记${factionName(physicalSetup.faction)}起始手牌 ${physicalSetup.counts[physicalSetup.faction]}/5`
      : physicalScanIntent === "draw"
        ? `登记${factionName(game.active)}新摸到的卡牌`
        : `实体出牌 · ${factionName(game.active)}`;

  const showCardResolution = (card: CardInstance, faction: Faction, status: "execute" | "refuse" | "return", label: string, spend = true) => {
    const id = Date.now();
    setCardOutcome({ id, card, faction, status, label });
    if (spend) setEnergySpend({ id, cost: card.cost });
  };

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    setGame(createInitialGame(Date.now()));
  }, []);

  const addNoticeEvent = (text: string, kind: "info" | "damage" | "system" = "info") => {
    setNotice(text);
    setGame((current) => ({ ...current, events: [event(Date.now(), text, current.active, kind), ...current.events].slice(0, 24) }));
  };

  const receiveRobotPoses = (poses: RobotVisionPose[]) => {
    if (!poses.length) return;
    const normalized = (angle: number) => ((angle + 180) % 360 + 360) % 360 - 180;
    const nextHeadings: Partial<Record<Faction, number>> = {};
    poses.forEach((incoming) => {
      const previous = visualPoseRef.current[incoming.faction];
      const pose: VisualRobotPose = previous ? {
        x: previous.x + (incoming.x - previous.x) * .42,
        z: previous.z + (incoming.z - previous.z) * .42,
        headingDeg: normalized(previous.headingDeg + normalized(incoming.headingDeg - previous.headingDeg) * .35),
        capturedAt: incoming.capturedAt,
      } : { x: incoming.x, z: incoming.z, headingDeg: incoming.headingDeg, capturedAt: incoming.capturedAt };
      visualPoseRef.current[incoming.faction] = pose;
      if (robotEndpointStates[incoming.faction] === "connected") nextHeadings[incoming.faction] = pose.headingDeg;
    });
    const trackedFactions = poses.map((pose) => pose.faction).filter((faction) => robotEndpointStates[faction] === "connected");
    if (!trackedFactions.length) return;
    setVisualHeadings((current) => ({ ...current, ...nextHeadings }));
    setGame((current) => {
      const players = { red: { ...current.players.red }, blue: { ...current.players.blue } };
      trackedFactions.forEach((faction) => {
        const pose = visualPoseRef.current[faction];
        if (pose) players[faction].position = { x: pose.x, z: pose.z };
      });
      return { ...current, players };
    });
  };

  const connectRobots = async () => {
    setRobotMode("connecting");
    setRobotError(undefined);
    const adapter = new DualAuraHttpTransport(robotEndpoints, robotHardwareModes, setRobotEndpointStates, (faction) => visualPoseRef.current[faction]);
    try {
      await adapter.connect();
      transport.current = adapter;
      setRobotMode("live");
      window.localStorage.setItem("aura.robot.endpoints", JSON.stringify(robotEndpoints));
      const connected = (["red", "blue"] as Faction[]).filter((faction) => adapter.endpointStates[faction] === "connected");
      const fallback = (["red", "blue"] as Faction[]).filter((faction) => robotHardwareModes[faction] === "physical" && adapter.endpointStates[faction] !== "connected");
      if (fallback.length) {
        setRobotHardwareModes((current) => ({ ...current, ...Object.fromEntries(fallback.map((faction) => [faction, "virtual"])) }));
        setRobotError(`${fallback.map(factionName).join("、")}连接失败，已单独回退虚拟机器人；另一阵营保持实体连接。`);
      }
      const initialHeadings: Partial<Record<Faction, number>> = {};
      setGame((current) => {
        const players = { red: { ...current.players.red }, blue: { ...current.players.blue } };
        connected.forEach((faction) => {
          const pose = visualPoseRef.current[faction];
          if (pose && Date.now() - pose.capturedAt < 1200) { players[faction].position = { x: pose.x, z: pose.z }; initialHeadings[faction] = pose.headingDeg; }
        });
        return { ...current, players };
      });
      setVisualHeadings((current) => ({ ...current, ...initialHeadings }));
      addNoticeEvent(`${connected.map(factionName).join("、")}实体 AURA 已连接；其余阵营使用虚拟机器人。`, "system");
    } catch (error) {
      transport.current = new MockRobotTransport();
      setRobotMode("mock");
      const message = error instanceof Error ? error.message : "无法连接机器人";
      setRobotError(`${message}。当前牌局仍使用虚拟机器人。`);
      addNoticeEvent(`实体连接失败：${message}；已自动回退虚拟模式。`, "system");
    }
  };

  const disconnectRobots = async () => {
    await transport.current.disconnect();
    transport.current = new MockRobotTransport();
    setVisualHeadings({});
    setRobotMode("mock");
    setRobotEndpointStates({ red: "mock", blue: "mock" });
    setRobotPanelOpen(false);
    addNoticeEvent("实体 AURA 已停止并断开，当前牌局继续使用虚拟机器人。", "system");
  };

  const emergencyStop = async () => {
    try {
      await transport.current.send({ commandId: crypto.randomUUID(), faction: game.active, kind: "stop" });
      addNoticeEvent(robotMode === "live" ? "紧急停止已发送到当前已连接的实体 AURA。" : "紧急停止事件已广播；当前为虚拟模式。", "system");
    } catch (error) {
      addNoticeEvent(`急停指令已发出，但链路返回异常：${error instanceof Error ? error.message : "未知错误"}`, "system");
    }
  };

  const sendRobotCommand = async (command: Parameters<RobotTransport["send"]>[0]) => {
    try {
      await transport.current.send(command);
    } catch (error) {
      addNoticeEvent(`${factionName(command.faction)}实体执行中断：${error instanceof Error ? error.message : "机器人链路异常"}；已停车并保持实体连接。`, "system");
    }
  };

  const changeDeckMode = (mode: DeckMode) => {
    const fresh = createInitialGame(Date.now());
    setDeckMode(mode);
    setAgentResolution(null);
    setPhysicalScanIntent("play");
    setScanFeedback("");
    setScanArrival(undefined);
    if (mode === "physical") {
      fresh.players.red.hand = []; fresh.players.red.deck = []; fresh.players.red.discard = [];
      fresh.players.blue.hand = []; fresh.players.blue.deck = []; fresh.players.blue.discard = [];
      setPhysicalSetup({ faction: "red", counts: { red: 0, blue: 0 } });
      setGame(fresh);
      setTab("cameras");
      setNotice("实体牌库已启用：请先依次扫描赤曜阵营的 5 张起始手牌。");
      setScanFeedback("请扫描赤曜阵营第 1 张起始手牌");
      return;
    }
    setPhysicalSetup(undefined);
    setGame(fresh);
    setTab("command");
    setNotice("虚拟牌库已重新洗牌，双方各摸取 5 张起始手牌。");
  };

  const makePhysicalCard = (type: CardType, faction: Faction): CardInstance => {
    const definition = CARD_DEFINITIONS.find((card) => card.type === type)!;
    physicalSequenceRef.current += 1;
    return { ...definition, faction, id: `physical-${faction}-${type}-${physicalSequenceRef.current}` };
  };

  const physicalTypeCount = (player: PlayerState, type: CardType) =>
    [...player.hand, ...player.discard].filter((card) => card.type === type).length;

  const selectCard = (card: CardInstance) => {
    if (game.phase === "finished") return;
    if (deckMode === "physical" && physicalSetup) { addNoticeEvent("请先完成双方起始手牌登记。", "system"); return; }
    if (activePlayer.auraHp <= 0) { addNoticeEvent("AURA 已失能，不能出牌或移动；请消耗 10 点基地生命完成重构。", "system"); return; }
    if (card.cost > game.points) { addNoticeEvent(`能量值不足：${card.name}需要 ${card.cost} 点能量。`); return; }
    setGame((current) => ({ ...current, selectedCard: card, plannedTarget: undefined }));
    setAgentResolution(null);
    setNotice(decisionMode === "agent" ? (card.type === "move" ? `移动卡已提交：落点与安全路径将由${activePersonality.name}决定。` : `${card.name}已提交，等待${activePersonality.name}决定是否执行及执行目标。`) : (card.type === "move" ? "移动卡已就绪：请点击战场选择目标点。" : `${card.name}已就绪，等待玩家确认执行。`));
  };

  const handleScan = (raw: string) => {
    const payload = parseCardPayload(raw);
    if (!payload) { addNoticeEvent("二维码内容无法识别，请使用卡牌中文名称、JSON 或 RED-MOVE-01 格式。"); return; }
    const expectedFaction = deckMode === "physical" && physicalSetup ? physicalSetup.faction : game.active;
    if (payload.faction && payload.faction !== expectedFaction) { addNoticeEvent(`阵营校验失败：当前应扫描${factionName(expectedFaction)}的卡牌。`); return; }

    if (deckMode === "virtual") {
      const found = activePlayer.hand.find((card) => card.id.toLowerCase() === payload.instanceId.toLowerCase()) ?? activePlayer.hand.find((card) => card.type === payload.type);
      if (!found) { addNoticeEvent("卡牌不在当前玩家手牌中，或已经使用。", "system"); return; }
      selectCard(found);
      setScanArrival({ id: Date.now(), card: found, faction: game.active });
      setScanFeedback(`识别成功：${found.name}`);
      setTab("command");
      return;
    }

    if (physicalSetup) {
      const faction = physicalSetup.faction;
      const definition = CARD_DEFINITIONS.find((card) => card.type === payload.type)!;
      if (physicalTypeCount(game.players[faction], payload.type) >= definition.count) {
        const message = `${definition.name}每方最多 ${definition.count} 张，请检查是否重复扫描。`;
        setScanFeedback(message); addNoticeEvent(message, "system"); return;
      }
      const physicalCard = makePhysicalCard(payload.type, faction);
      const nextCount = physicalSetup.counts[faction] + 1;
      setGame((current) => ({ ...current, players: { ...current.players, [faction]: { ...current.players[faction], hand: [...current.players[faction].hand, physicalCard] } } }));
      setScanArrival({ id: Date.now(), card: physicalCard, faction });
      if (nextCount < 5) {
        setPhysicalSetup({ ...physicalSetup, counts: { ...physicalSetup.counts, [faction]: nextCount } });
        setScanFeedback(`${definition.name}已登记 · 请扫描第 ${nextCount + 1} 张`);
      } else if (faction === "red") {
        setPhysicalSetup({ faction: "blue", counts: { red: 5, blue: 0 } });
        setScanFeedback("赤曜登记完成 · 请扫描蓝穹阵营第 1 张");
        addNoticeEvent("赤曜阵营 5 张起始手牌登记完成，现在登记蓝穹阵营。", "system");
      } else {
        setPhysicalSetup(undefined);
        setScanFeedback("双方手牌登记完成，可以开始出牌");
        setNotice("双方实体起始手牌登记完成。扫描当前玩家的卡牌即可提交行动。");
        setTab("command");
      }
      return;
    }

    if (physicalScanIntent === "draw") {
      const definition = CARD_DEFINITIONS.find((card) => card.type === payload.type)!;
      if (game.drawsRemaining <= 0) { setScanFeedback("本回合摸牌次数已用完"); return; }
      if (activePlayer.hand.length >= 8) { setScanFeedback("手牌已达到 8 张上限"); return; }
      if (physicalTypeCount(activePlayer, payload.type) >= definition.count) {
        const message = `${definition.name}已达到每方 ${definition.count} 张上限，请检查实体牌堆。`;
        setScanFeedback(message); addNoticeEvent(message, "system"); return;
      }
      const physicalCard = makePhysicalCard(payload.type, game.active);
      setGame((current) => ({ ...current, drawsRemaining: current.drawsRemaining - 1, players: { ...current.players, [current.active]: { ...current.players[current.active], hand: [...current.players[current.active].hand, physicalCard] } }, events: [event(Date.now(), `${factionName(current.active)}登记摸取${physicalCard.name}。`, current.active), ...current.events].slice(0, 24) }));
      setPhysicalScanIntent("play");
      setScanArrival({ id: Date.now(), card: physicalCard, faction: game.active });
      setScanFeedback(`摸牌登记成功：${physicalCard.name}`);
      setNotice(`${physicalCard.name}已加入实体手牌，本次不会自动打出。`);
      setTab("command");
      return;
    }

    const found = activePlayer.hand.find((card) => card.id.toLowerCase() === payload.instanceId.toLowerCase()) ?? activePlayer.hand.find((card) => card.type === payload.type);
    if (!found) { setScanFeedback("这张卡尚未登记，或已经进入弃牌堆"); addNoticeEvent("实体卡不在当前手牌中；新摸到的牌请先点击“登记摸牌”。", "system"); return; }
    selectCard(found);
    setScanArrival({ id: Date.now(), card: found, faction: game.active });
    setScanFeedback(`出牌识别成功：${found.name}`);
    setTab("command");
  };

  const handleFieldPoint = (point: Vec2) => {
    if (activePlayer.auraHp <= 0) { setNotice("AURA 已失能，无法移动；请先使用基地重构。 "); return; }
    if (decisionMode === "agent") { setNotice(selected?.type === "move" ? `当前为人格裁决模式；移动落点和路径由${activePersonality.name}决定。` : "战场落点只用于显示，先从手牌中选择行动。 "); return; }
    if (selected?.type !== "move") { setNotice("玩家直控模式：先选择一张移动卡，再点击战场落点。 "); return; }
    const maxX = FIELD_LENGTH_CM / 2 - FIELD_SAFE_MARGIN_CM;
    const maxZ = FIELD_WIDTH_CM / 2 - FIELD_SAFE_MARGIN_CM;
    if (Math.abs(point.x) > maxX || Math.abs(point.z) > maxZ) { setNotice(`目标点进入 ${FIELD_SAFE_MARGIN_CM} cm 场地安全边界，请重新选择。`); return; }
    const enemy = game.players[otherFaction(game.active)].position;
    const route = planRoute(activePlayer.position, point, [{ id: "enemy-aura", ...enemy, radius: ROBOT_COLLISION_RADIUS_CM }]);
    if (!route) { setNotice(`目标 (${point.x}, ${point.z}) 或路径进入障碍物安全区，请重新选择。`); return; }
    if (route.length > 70) { setNotice(`绕障路径 ${Math.round(route.length)} cm，超过单次 70 cm 上限。`); return; }
    setGame((current) => ({ ...current, plannedTarget: point }));
    setNotice(`${route.direct ? "直线路径" : "自动绕障曲线"} ${Math.round(route.length)} cm，等待玩家确认。`);
  };

  const buildMoveOptions = (state: GameState): AgentMoveOption[] => {
    const origin = state.players[state.active].position;
    const activeState = state.players[state.active];
    const enemy = state.players[otherFaction(state.active)].position;
    const enemyBase = BASE_POSITIONS[otherFaction(state.active)];
    const ownBase = BASE_POSITIONS[state.active];
    const originEnemyDistance = distance(origin, enemy);
    const originEnemyBaseDistance = distance(origin, enemyBase);
    const attackCards = activeState.hand.filter((candidate) => ["pulse", "beam", "pierce"].includes(candidate.type));
    const affordableAttackCards = attackCards.filter((candidate) => candidate.cost <= state.points - 1);
    const plannedAttackCards = affordableAttackCards.length ? affordableAttackCards : attackCards;
    const preferredAttack = [...plannedAttackCards].sort((a, b) => (b.damage ?? 0) - (a.damage ?? 0) || (b.range ?? 0) - (a.range ?? 0))[0];
    const preferredRange = preferredAttack ? Math.round((preferredAttack.range ?? 0) * .82) : 50;
    const routeHistory = state.routeHistory[state.active] ?? [];
    const maxX = FIELD_LENGTH_CM / 2 - FIELD_SAFE_MARGIN_CM;
    const maxZ = FIELD_WIDTH_CM / 2 - FIELD_SAFE_MARGIN_CM;
    const seen = new Set<string>();
    const options: AgentMoveOption[] = [];
    for (const radius of [70, 60, 50, 40, 30, 20]) {
      for (let angle = 0; angle < 360; angle += 22.5) {
        const radians = angle * Math.PI / 180;
        const point = {
          x: Math.round(clamp(origin.x + Math.cos(radians) * radius, -maxX, maxX)),
          z: Math.round(clamp(origin.z + Math.sin(radians) * radius, -maxZ, maxZ)),
        };
        const key = `${point.x},${point.z}`;
        if (seen.has(key) || distance(origin, point) < 20) continue;
        const route = planRoute(origin, point, [{ id: "enemy-aura", ...enemy, radius: ROBOT_COLLISION_RADIUS_CM }]);
        if (!route || route.length > 70) continue;
        const targetDistance = distance(point, enemy);
        const repetitionPenalty = routeHistory.reduce((penalty, previous, index) => {
          const recency = (index + 1) / routeHistory.length;
          const sameLane = Math.max(0, 22 - Math.abs(point.z - previous.z)) / 22;
          return penalty + sameLane * 24 * recency;
        }, 0);
        const attackReadiness = affordableAttackCards.reduce((best, candidate) => targetDistance <= (candidate.range ?? 0) ? Math.max(best, candidate.damage ?? 0) : best, 0);
        seen.add(key);
        options.push({
          id: `route-${options.length + 1}`,
          point,
          path: route.points,
          routeLength: route.length,
          distanceToEnemy: targetDistance,
          distanceToEnemyBase: distance(point, enemyBase),
          distanceToOwnBase: distance(point, ownBase),
          progressToEnemy: originEnemyDistance - distance(point, enemy),
          progressToEnemyBase: originEnemyBaseDistance - distance(point, enemyBase),
          lateralOffset: Math.abs(point.z),
          waypointCount: route.points.length,
          direct: route.direct,
          repetitionPenalty,
          preferredRange,
          rangeError: Math.abs(targetDistance - preferredRange),
          attackReadiness,
        });
      }
    }
    return options;
  };

  const consumeCard = (state: GameState, card: CardInstance, players: Record<Faction, PlayerState>) => {
    const player = players[state.active];
    players[state.active] = { ...player, hand: player.hand.filter((item) => item.id !== card.id), discard: [...player.discard, card] };
  };

  const drawCard = () => {
    if (game.phase === "finished") return;
    if (deckMode === "physical" && physicalSetup) { setNotice("请先完成双方起始手牌登记。 "); return; }
    if (activePlayer.auraHp <= 0) { setNotice("AURA 已失能，本回合只能使用基地重构或结束回合。 "); return; }
    if (game.drawsRemaining <= 0) { setNotice("本回合的两次摸牌机会已经用完。"); return; }
    if (activePlayer.hand.length >= 8) { setNotice("手牌已达到 8 张上限，请先出牌。"); return; }
    if (deckMode === "physical") {
      setPhysicalScanIntent("draw");
      setScanFeedback(`请扫描${factionName(game.active)}刚刚从实体牌堆摸到的卡牌`);
      setNotice("实体摸牌登记已开启：从实体牌堆摸一张牌，然后用 Mac 摄像头扫描二维码。 ");
      setTab("cameras");
      return;
    }
    if (!activePlayer.deck.length) { setNotice("牌库已经为空。"); return; }
    setGame((current) => {
      const players = { red: { ...current.players.red }, blue: { ...current.players.blue } };
      const player = players[current.active];
      const card = player.deck[0];
      player.deck = player.deck.slice(1);
      player.hand = [...player.hand, card];
      const message = `${factionName(current.active)}摸取一张牌，牌库剩余 ${player.deck.length} 张。`;
      return { ...current, players, drawsRemaining: current.drawsRemaining - 1, events: [event(Date.now(), message, current.active), ...current.events].slice(0, 24) };
    });
    setNotice("已从洗牌后的牌库摸取一张牌。");
  };

  const confirmAction = async () => {
    if (!selected) { setNotice("请先扫描或选择一张手牌。"); return; }
    if (activePlayer.auraHp <= 0) { setGame((current) => ({ ...current, selectedCard: undefined, plannedTarget: undefined })); setNotice("AURA 已失能，指令取消；请先使用基地重构。 "); return; }
    if (agentBusy) return;
    const snapshot = game;
    const card = selected;
    if (decisionMode === "manual" && card.type === "move" && !snapshot.plannedTarget) { setNotice("玩家直控模式：请先点击战场选择移动落点。 "); return; }
    const sourceCard = document.querySelector<HTMLElement>(`[data-card-instance="${card.id}"]`);
    const sourceRect = sourceCard?.getBoundingClientRect();
    setPlayedCard({ id: Date.now(), card, faction: snapshot.active, origin: sourceRect ? { x: sourceRect.left + sourceRect.width / 2, y: sourceRect.top + sourceRect.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight } });
    const personaId = personalities[game.active];
    const persona = PERSONALITIES[personaId];
    const enemyAtSubmission = snapshot.players[otherFaction(snapshot.active)];
    const attackOrigin = snapshot.players[snapshot.active].position;
    const enemyAuraDistance = distance(attackOrigin, enemyAtSubmission.position);
    const enemyBaseDistance = distance(attackOrigin, BASE_POSITIONS[otherFaction(snapshot.active)]);
    if (["pulse", "beam", "pierce"].includes(card.type) && Math.min(enemyAuraDistance, enemyBaseDistance) > (card.range ?? 0)) {
      const reason = `敌方 AURA 距离 ${Math.round(enemyAuraDistance)} cm、基地距离 ${Math.round(enemyBaseDistance)} cm，均超出${card.name}的 ${card.range ?? 0} cm 射程`;
      setGame((current) => {
        const players = { red: { ...current.players.red }, blue: { ...current.players.blue } };
        consumeCard(current, card, players);
        return { ...current, players, points: Math.max(0, current.points - card.cost), selectedCard: undefined, plannedTarget: undefined, events: [event(Date.now(), `${reason}；卡牌作废并消耗 ${card.cost} 点能量。`, current.active, "system"), ...current.events].slice(0, 24) };
      });
      setAgentResolution({ decision: "refuse", label: "射程不足 · 卡牌作废", line: "无效射击已被规则引擎拦截。", reason, source: "local", durationMs: 0 });
      showCardResolution(card, snapshot.active, "refuse", "射程不足 · 进入弃牌堆");
      setNotice(`${reason}：卡牌已进入弃牌堆，并消耗 ${card.cost} 点能量。`);
      return;
    }
    const moveOptions = card.type === "move" ? buildMoveOptions(snapshot) : [];
    let resolution: AgentResolution;
    let moveChoice: AgentMoveOption | undefined;
    if (decisionMode === "manual") {
      const enemy = snapshot.players[otherFaction(snapshot.active)];
      const manualRoute = card.type === "move" && snapshot.plannedTarget
        ? planRoute(snapshot.players[snapshot.active].position, snapshot.plannedTarget, [{ id: "enemy-aura", ...enemy.position, radius: ROBOT_COLLISION_RADIUS_CM }])
        : null;
      moveChoice = card.type === "move" && snapshot.plannedTarget && manualRoute ? {
        id: "manual",
        point: snapshot.plannedTarget,
        path: manualRoute.points,
        routeLength: manualRoute.length,
        distanceToEnemy: distance(snapshot.plannedTarget, enemy.position),
        distanceToEnemyBase: 0,
        distanceToOwnBase: 0,
        progressToEnemy: 0,
        progressToEnemyBase: 0,
        lateralOffset: Math.abs(snapshot.plannedTarget.z),
        waypointCount: manualRoute.points.length,
        direct: manualRoute.direct,
        repetitionPenalty: 0,
        preferredRange: 0,
        rangeError: 0,
        attackReadiness: 0,
      } : undefined;
      resolution = { decision: "execute", target: card.type === "move" ? "manual" : ["pulse", "beam", "pierce"].includes(card.type) ? "enemy_aura" : card.type === "repair" ? "own_aura" : "self", label: "玩家确认执行", line: "切换为玩家直控。", reason: "由玩家直接指定并确认动作。", source: "local", durationMs: 0 };
      setAgentResolution(null);
    } else {
      const requestId = agentRequestRef.current + 1;
      agentRequestRef.current = requestId;
      setAgentBusy(true);
      setAgentResolution(null);
      setNotice(`${persona.name}正在读取战场并裁决指令…`);
      try {
        const enemy = snapshot.players[otherFaction(snapshot.active)];
        const own = snapshot.players[snapshot.active];
        const response = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locale,
            round: snapshot.round,
            active: snapshot.active,
            points: snapshot.points,
            personality: personaId,
            selectedCard: { id: card.id, name: card.name, type: card.type, cost: card.cost, range: card.range, damage: card.damage },
            player: { auraHp: own.auraHp, baseHp: own.baseHp, shield: own.shield, revives: own.revives, jamActive: own.jamActive, position: own.position },
            enemy: { auraHp: enemy.auraHp, baseHp: enemy.baseHp, shield: enemy.shield, revives: enemy.revives, jamActive: enemy.jamActive, position: enemy.position },
            moveOptions,
          }),
        });
        if (!response.ok) throw new Error("agent unavailable");
        resolution = await response.json() as AgentResolution;
        if (agentRequestRef.current !== requestId) return;
      } catch {
        showCardResolution(card, snapshot.active, "return", "链路中断 · 退回手牌", false);
        setNotice("人格 Agent 暂时离线，卡牌尚未消耗；也可以切换到玩家直控。 ");
        return;
      } finally {
        if (agentRequestRef.current === requestId) setAgentBusy(false);
      }
      setAgentResolution(resolution);
      if (resolution.decision === "refuse") {
        setGame((current) => {
          const players = { red: { ...current.players.red }, blue: { ...current.players.blue } };
          consumeCard(current, card, players);
          return { ...current, players, points: Math.max(0, current.points - card.cost), selectedCard: undefined, plannedTarget: undefined, events: [event(Date.now(), `${persona.name}拒绝${card.name}：卡牌作废并消耗 ${card.cost} 点能量；${resolution.line}`, current.active, "system"), ...current.events].slice(0, 24) };
        });
        showCardResolution(card, snapshot.active, "refuse", "AURA 拒绝 · 进入弃牌堆");
        setNotice(`“${resolution.line}” Agent 拒绝执行；卡牌已进入弃牌堆，并消耗 ${card.cost} 点能量。`);
        return;
      }
      moveChoice = card.type === "move" ? moveOptions.find((option) => option.id === resolution.target) : undefined;
    }

    if (card.type === "move" && !moveChoice) {
      showCardResolution(card, snapshot.active, "return", "路径无效 · 退回手牌", false);
      setNotice("Agent 返回的移动路线未通过本地安全校验，卡牌没有消耗。 ");
      return;
    }
    if (["pulse", "beam", "pierce"].includes(card.type)) {
      const resolvedDistance = resolution.target === "enemy_base" ? enemyBaseDistance : enemyAuraDistance;
      if (resolvedDistance > (card.range ?? 0)) {
        const targetLabel = resolution.target === "enemy_base" ? "敌方基地" : "敌方 AURA";
        const reason = `${targetLabel}距离 ${Math.round(resolvedDistance)} cm，超出${card.name}的 ${card.range ?? 0} cm 射程`;
        setGame((current) => {
          const players = { red: { ...current.players.red }, blue: { ...current.players.blue } };
          consumeCard(current, card, players);
          return { ...current, players, points: Math.max(0, current.points - card.cost), selectedCard: undefined, plannedTarget: undefined, events: [event(Date.now(), `${reason}；卡牌作废并消耗 ${card.cost} 点能量。`, current.active, "system"), ...current.events].slice(0, 24) };
        });
        setAgentResolution({ decision: "refuse", label: "目标超距 · 卡牌作废", line: "目标不在有效射界内。", reason, source: "local", durationMs: 0 });
        showCardResolution(card, snapshot.active, "refuse", "目标超距 · 进入弃牌堆");
        setNotice(`${reason}：卡牌已进入弃牌堆，并消耗 ${card.cost} 点能量。`);
        return;
      }
    }
    const executorName = decisionMode === "agent" ? persona.name : "玩家直控";
    const targetVerb = decisionMode === "agent" ? "自主" : "直接";
    const attackWasJammed = ["beam", "pierce"].includes(card.type) && Boolean(enemyAtSubmission.jamActive);
    const moveUsesPhysicalRobot = card.type === "move" && robotEndpointStates[snapshot.active] === "connected";
    setGame((current) => {
      const players = { red: { ...current.players.red }, blue: { ...current.players.blue } };
      const own = players[current.active]; const enemyKey = otherFaction(current.active); const enemy = players[enemyKey];
      let message = `${executorName}执行${card.name}`;
      if (card.type === "move" && moveChoice) {
        if (!moveUsesPhysicalRobot) own.position = moveChoice.point;
        message += `，${targetVerb}${moveUsesPhysicalRobot ? "下发实体路径" : "移动"} ${Math.round(moveChoice.routeLength)} cm 至 (${moveChoice.point.x}, ${moveChoice.point.z})`;
      }
      if (["pulse", "beam", "pierce"].includes(card.type)) {
        let damage = card.damage ?? 0;
        if ((card.type === "beam" || card.type === "pierce") && enemy.jamActive) { damage = 0; (enemy as PlayerState & { jamActive?: boolean }).jamActive = false; message += "，被链路干扰抵消"; }
        else if (resolution.target === "enemy_base") { enemy.baseHp = Math.max(0, enemy.baseHp - damage); message += `，${targetVerb}锁定基地并造成 ${damage} 点伤害`; }
        else {
          const shieldDamage = Math.min(enemy.shield, damage); enemy.shield -= shieldDamage; damage -= shieldDamage;
          const auraDamage = Math.min(enemy.auraHp, damage); enemy.auraHp -= auraDamage; damage -= auraDamage;
          message += `，${targetVerb}锁定 AURA 并造成 ${(card.damage ?? 0) - damage} 点伤害`;
        }
      }
      if (card.type === "repair") { if (resolution.target === "own_base") { own.baseHp = Math.min(60, own.baseHp + 15); message += "，自主修复基地 15 点生命"; } else { own.auraHp = Math.min(40, own.auraHp + 15); message += "，自主修复 AURA 15 点生命"; } }
      if (card.type === "shield") { own.shield = 20; message += "，建立 20 点护盾"; }
      if (card.type === "jam") { (own as PlayerState & { jamActive?: boolean }).jamActive = true; message += "，干扰链路已待命"; }
      consumeCard(current, card, players);
      const routeHistory = card.type === "move" && moveChoice
        ? { ...current.routeHistory, [current.active]: [...current.routeHistory[current.active], moveChoice.point].slice(-3) }
        : current.routeHistory;
      let phase: GameState["phase"] = current.phase; let winner = current.winner;
      if (enemy.baseHp <= 0) { phase = "finished"; winner = current.active; message += "，敌方基地失效，战斗结束"; }
      return { ...current, players, routeHistory, points: current.points - card.cost, selectedCard: undefined, plannedTarget: undefined, phase, winner, events: [event(Date.now(), `${message}；“${resolution.line}”`, current.active, card.damage ? "damage" : "info"), ...current.events].slice(0, 24) };
    });
    showCardResolution(card, snapshot.active, "execute", "指令执行 · 卡牌结算");
    if (card.type === "repair") setStatusEffect({ id: Date.now(), faction: snapshot.active, kind: "heal" });
    if (card.type === "shield") setStatusEffect({ id: Date.now(), faction: snapshot.active, kind: "shield" });
    if (card.type === "jam") setStatusEffect({ id: Date.now(), faction: snapshot.active, kind: "jam" });
    setNotice(decisionMode === "agent" ? `指令已执行：“${resolution.line}”` : "指令已由玩家确认执行。 ");
    if (["pulse", "beam", "pierce"].includes(card.type) && !attackWasJammed) {
      setImpact({ id: Date.now(), source: snapshot.active, targetFaction: otherFaction(snapshot.active), target: resolution.target === "enemy_base" ? "base" : "aura", power: card.type === "pierce" ? 1.45 : card.type === "beam" ? 1.2 : 1 });
    }
    if (card.type === "move" && moveChoice) void sendRobotCommand({ commandId: crypto.randomUUID(), faction: snapshot.active, kind: "move", target: moveChoice.point, path: moveChoice.path, speedLimit: 0.15 });
  };

  const endTurn = () => {
    setGame((current) => {
      if (current.phase === "finished") return current;
      const next = otherFaction(current.active); const players = { red: { ...current.players.red }, blue: { ...current.players.blue } };
      const nextPlayer = players[next]; nextPlayer.shield = 0;
      const nextRound = current.active === "blue" ? current.round + 1 : current.round;
      let phase: GameState["phase"] = current.phase; let winner = current.winner;
      if (nextRound > 10) {
        phase = "finished";
        const red = players.red, blue = players.blue;
        winner = red.baseHp !== blue.baseHp ? (red.baseHp > blue.baseHp ? "red" : "blue") : red.auraHp !== blue.auraHp ? (red.auraHp > blue.auraHp ? "red" : "blue") : red.revives !== blue.revives ? (red.revives > blue.revives ? "red" : "blue") : "draw";
      }
      return { ...current, active: next, round: nextRound, points: 3, drawsRemaining: 2, selectedCard: undefined, plannedTarget: undefined, players, phase, winner, events: [event(Date.now(), `${factionName(current.active)}结束回合，行动权交给${factionName(next)}。`, undefined, "system"), ...current.events].slice(0, 24) };
    });
    setAgentResolution(null);
    setPhysicalScanIntent("play");
    setScanFeedback("");
    setNotice("回合已切换，能量值重置为 3。 ");
  };

  const revive = () => {
    setGame((current) => {
      const player = { ...current.players[current.active] };
      if (player.auraHp > 0 || player.revives <= 0 || player.baseHp <= 10) return current;
      player.baseHp -= 10; player.revives -= 1; player.auraHp = 20; player.position = { ...AURA_START_POSITIONS[current.active] };
      return { ...current, players: { ...current.players, [current.active]: player }, events: [event(Date.now(), `${factionName(current.active)}消耗 10 点基地生命完成方舟重构。`, current.active, "system"), ...current.events] };
    });
    setStatusEffect({ id: Date.now(), faction: game.active, kind: "heal" });
    setNotice("基地向 AURA 输送能量：消耗 10 点基地生命，AURA 恢复至 20 点。 ");
  };

  return <main className="app-shell">
    {playedCard && <div key={playedCard.id} className={`played-card-effect ${playedCard.faction}`} style={{ "--card-origin-x": `${playedCard.origin.x}px`, "--card-origin-y": `${playedCard.origin.y}px` } as CSSProperties} onAnimationEnd={() => setPlayedCard((current) => current?.id === playedCard.id ? undefined : current)} aria-hidden="true"><img src={cardArt(playedCard.card.type, locale)} alt="" /><span>{cardName(playedCard.card, locale)}</span></div>}
    {scanArrival && <div key={scanArrival.id} className={`scan-card-arrival ${scanArrival.faction}`} onAnimationEnd={() => setScanArrival((current) => current?.id === scanArrival.id ? undefined : current)} aria-hidden="true"><img src={cardArt(scanArrival.card.type, locale)} alt="" /><span>识别成功 · {cardName(scanArrival.card, locale)}</span></div>}
    <header className="topbar">
      <div className="brand"><span className="brand-glyph">A</span><div><b>AURA</b></div></div>
      <div className="match-status"><div><small>回合</small><strong>{Math.min(game.round, 10)}<em>/10</em></strong></div><div><small>当前行动</small><strong className={game.active}>{factionName(game.active)}</strong></div><div className="energy"><small>能量值</small><span>{[1, 2, 3].map((point) => <i key={point} className={point <= game.points ? "charged" : ""} />)}</span><strong>{game.points}</strong>{energySpend && <em key={energySpend.id} className="energy-cost-fx" onAnimationEnd={() => setEnergySpend((current) => current?.id === energySpend.id ? undefined : current)}>-{energySpend.cost}</em>}</div></div>
      <div className="system-links"><span><i className="status-dot connected" />规则引擎</span><button className="robot-link-button" onClick={() => setRobotPanelOpen(true)}><i className={`status-dot ${robotMode === "live" ? "connected" : robotMode === "connecting" ? "waiting" : "mock"}`} />{robotLinkLabel}</button><button className="robot-debug-button" onClick={() => setRobotDebugOpen(true)}>机器人调试</button><LanguageSwitch /><button className="danger" onClick={emergencyStop}>紧急停止</button></div>
    </header>

    <div className="battle-layout">
      <PlayerPanel player={game.players.red} active={game.active === "red"} endpointState={robotEndpointStates.red} impactId={impact?.targetFaction === "red" ? impact.id : undefined} statusEffect={statusEffect?.faction === "red" ? statusEffect : undefined} deckMode={deckMode} />
      <section className="battle-center">
        <TwinScene positions={positions} headings={visualHeadings} plannedTarget={game.plannedTarget} active={game.active} rangePreview={selectedRange ? { range: selectedRange, kind: selected?.type === "move" ? "move" : "attack" } : undefined} impact={impact} onFieldPoint={handleFieldPoint} />
        {deckMode === "physical" && physicalSetup && <div className={`physical-setup-banner ${physicalSetup.faction}`}><small>实体牌库初始化</small><b>请登记{factionName(physicalSetup.faction)}起始手牌</b><span>{physicalSetup.counts.red}/5 赤曜 · {physicalSetup.counts.blue}/5 蓝穹</span><button onClick={() => setTab("cameras")}>前往扫码</button></div>}
        {selected && <div className={`battle-action-slot ${agentBusy ? "judging" : "ready"}`}><img src={cardArt(selected.type, locale)} alt="" /><div><small>{agentBusy ? `${visiblePersonality.name}正在裁决` : "待执行卡牌"}</small><b>{cardName(selected, locale)}</b><span>{selectedRange ? `${selected.type === "move" ? "移动上限" : "有效射程"} ${selectedRange} cm` : cardFunction(selected, locale)}</span></div></div>}
        {cardOutcome && <div key={cardOutcome.id} className={`card-outcome-fx ${cardOutcome.status} ${cardOutcome.faction}`} onAnimationEnd={() => setCardOutcome((current) => current?.id === cardOutcome.id ? undefined : current)} aria-hidden="true"><img src={cardArt(cardOutcome.card.type, locale)} alt="" /><b>{cardOutcome.label}</b></div>}
        <div className="action-toast"><span className={selected || actionStage === "已执行" ? "ready" : ""}>{actionStage}</span>{notice}</div>
        {game.phase === "finished" && <div className="winner-banner"><small>协议终局</small><strong>{game.winner === "draw" ? "平局" : `${factionName(game.winner!)}胜利`}</strong><button onClick={() => changeDeckMode(deckMode)}>{deckMode === "physical" ? "重新登记实体牌" : "重新部署并洗牌"}</button></div>}
      </section>
      <PlayerPanel player={game.players.blue} active={game.active === "blue"} endpointState={robotEndpointStates.blue} impactId={impact?.targetFaction === "blue" ? impact.id : undefined} statusEffect={statusEffect?.faction === "blue" ? statusEffect : undefined} deckMode={deckMode} />
    </div>

    <section className="control-deck">
      <div className="control-tabs"><button className={tab === "command" ? "active" : ""} onClick={() => setTab("command")}>行动控制</button><button className={tab === "cameras" ? "active" : ""} onClick={() => setTab("cameras")}>视觉链路</button><div className="deck-mode"><small>牌库</small><button className={deckMode === "virtual" ? "active" : ""} disabled={agentBusy} onClick={() => changeDeckMode("virtual")}>虚拟</button><button className={deckMode === "physical" ? "active" : ""} disabled={agentBusy} onClick={() => changeDeckMode("physical")}>实体卡牌</button></div><div className="decision-mode"><small>决策权</small><button className={decisionMode === "agent" ? "active" : ""} disabled={agentBusy} onClick={() => { setDecisionMode("agent"); setGame((current) => ({ ...current, selectedCard: undefined, plannedTarget: undefined })); setAgentResolution(null); setNotice(`已切换为人格裁决：玩家选牌，${activePersonality.name}决定执行。`); }}>人格裁决</button><button className={decisionMode === "manual" ? "active" : ""} disabled={agentBusy} onClick={() => { setDecisionMode("manual"); setGame((current) => ({ ...current, selectedCard: undefined, plannedTarget: undefined })); setAgentResolution(null); setNotice("已切换为玩家直控：由玩家决定并确认全部动作。 "); }}>玩家直控</button></div></div>
      <><div className={`command-grid ${intelOpen ? "" : "intel-collapsed"} ${tab !== "command" ? "tab-panel-hidden" : ""}`}>
        <div className="hand-panel"><div className="section-title"><span>{factionName(game.active)}手牌</span><div className="hand-tools"><small>{deckMode === "physical" ? "实体牌库" : `牌库 ${activePlayer.deck.length}`} · 弃牌 {activePlayer.discard.length}</small><button onClick={drawCard} disabled={Boolean(physicalSetup) || activePlayer.auraHp <= 0 || game.drawsRemaining <= 0 || activePlayer.hand.length >= 8 || (deckMode === "virtual" && activePlayer.deck.length === 0)}>{deckMode === "physical" ? "登记摸牌" : "摸牌"} {game.drawsRemaining}/2</button></div></div><div className="hand-list">{activePlayer.hand.map((card) => <CardChip key={card.id} card={card} selected={selected?.id === card.id} committed={selected?.id === card.id && Boolean(playedCard)} disabled={activePlayer.auraHp <= 0 || Boolean(physicalSetup)} onClick={() => selectCard(card)} onPreview={() => setPreviewCard(card)} />)}</div></div>
        <div className="action-panel"><div className="section-title"><span>{decisionMode === "agent" ? "玩家提交的卡牌" : "玩家直接指令"}</span><small>{physicalSetup ? "等待实体牌登记" : selected ? `${selected.cost} 点能量` : activePlayer.auraHp <= 0 ? "AURA 失能" : "未选择"}</small></div>{activePlayer.auraHp <= 0 ? <div className="disabled-aura"><b>AURA 已失能</b><p>无法移动和出牌，只能由基地消耗生命完成重构。</p></div> : selected ? <div className="pending-card"><img className="pending-card-art" src={cardArt(selected.type, locale)} alt="" onClick={() => setPreviewCard(selected)} /><div className="pending-card-copy"><div className="pending-card-title"><b>{cardName(selected, locale)}</b><span>{cardFunction(selected, locale)}</span><button className="preview-card-button" onClick={() => setPreviewCard(selected)}>查看大图</button></div><p>{cardDescription(selected, locale)}</p><code>{decisionMode === "agent" ? (selected.type === "move" ? "落点 / 路径由 Agent 决定" : "是否执行 / 目标由 Agent 决定") : (selected.type === "move" ? "点击地图选择落点" : "由玩家直接确认执行")}</code></div></div> : <div className="empty-action">{physicalSetup ? `请前往视觉链路继续登记${factionName(physicalSetup.faction)}手牌` : decisionMode === "agent" ? "玩家先选择卡牌，AURA 再决定如何执行" : "玩家选择卡牌并直接确认动作"}</div>}<div className="notice-line">{notice}</div><div className="primary-actions"><button className="secondary" disabled={agentBusy || activePlayer.auraHp <= 0 || Boolean(physicalSetup)} onClick={() => setGame((current) => ({ ...current, selectedCard: undefined, plannedTarget: undefined }))}>取消</button><button className="primary" disabled={!selected || agentBusy || activePlayer.auraHp <= 0 || Boolean(physicalSetup)} onClick={confirmAction}>{confirmLabel}</button><button className="end-turn" disabled={agentBusy || Boolean(physicalSetup)} onClick={endTurn}>结束回合</button>{activePlayer.auraHp === 0 && <button className="revive-action" disabled={activePlayer.revives <= 0 || activePlayer.baseHp <= 10} onClick={revive}>基地回血 · 消耗 10</button>}</div></div>
        <div className={`event-panel tactical-drawer ${intelOpen ? "open" : "collapsed"}`}><div className="section-title"><span>{decisionMode === "agent" ? "AURA 驾驶人格" : "玩家直控"}</span><div className="event-panel-tools">{decisionMode === "agent" && intelOpen && <select className="persona-select" value={personalities[game.active]} disabled={agentBusy} onChange={(event) => { const personality = event.target.value as PersonalityId; setPersonalities((current) => ({ ...current, [game.active]: personality })); setAgentResolution(null); }}>{Object.entries(PERSONALITIES).map(([id, personality]) => { const copy = personalityCopy(personality, locale); return <option key={id} value={id}>{copy.name} · {copy.title}</option>; })}</select>}<button className="drawer-toggle" onClick={() => setIntelOpen((open) => !open)} aria-label={intelOpen ? "收起人格和战报" : "展开人格和战报"}>{intelOpen ? "收起" : "战报"}</button></div></div>{decisionMode === "agent" ? <><div className="persona-card"><b>{visiblePersonality.name}</b><span>{visiblePersonality.description}</span><q>{visiblePersonality.credo}</q></div><div className={`agent-verdict ${agentBusy ? "thinking" : agentResolution?.decision ?? "idle"}`}><b>{agentBusy ? "正在裁决玩家指令…" : visibleResolution?.label ?? "等待玩家提交卡牌"}</b>{agentResolution && visibleResolution && !agentBusy && <><p>“{visibleResolution.line}”</p><small>{visibleResolution.reason} · {agentResolution.source === "deepseek" ? "DEEPSEEK" : "LOCAL"} {agentResolution.durationMs} ms</small></>}</div></> : <div className="manual-control-card"><b>完全服从</b><p>不经过人格裁决。移动落点由玩家点击，其他卡牌由玩家确认后立即执行。</p></div>}<div className="event-title"><span>战场事件</span><small>实时状态流</small></div><div className="event-list">{game.events.map((item) => <div key={item.id + item.time} className={item.kind}><time>{item.time}</time><p>{item.text}</p></div>)}</div></div>
      </div><div className={`vision-grid ${tab !== "cameras" ? "tab-panel-hidden" : ""}`}><CardScanner onScan={handleScan} instruction={scanInstruction} feedback={scanFeedback} active={tab === "cameras"} /><GlobalCameraPanel onRobotPoses={receiveRobotPoses} /><section className="integration-panel"><div className="section-title"><span>接口状态</span><small>逐项联调</small></div><ul><li className="ready"><b>Web 前端</b><span>已运行</span></li><li className="ready"><b>手机视频流</b><span>WebRTC</span></li><li className="ready"><b>卡牌识别</b><span>{deckMode === "physical" ? "实体牌库同步" : "QR + 手动回退"}</span></li><li className="ready"><b>AprilTag 检测</b><span>手机端 WASM</span></li><li className={Object.keys(visualHeadings).length ? "ready" : ""}><b>场地坐标标定</b><span>{Object.keys(visualHeadings).length ? "位姿同步" : "等待标定"}</span></li><li className={robotMode === "live" ? "ready" : ""}><b>Aura 机器人</b><span>{connectedRobotCount === 2 ? "双实体" : connectedRobotCount === 1 ? "实体 / 虚拟混合" : "双虚拟"}</span></li></ul></section></div></>
    </section>
    {previewCard && <div className="card-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewCard(undefined); }}><section className="card-preview-modal" role="dialog" aria-modal="true" aria-label={`${cardName(previewCard, locale)}卡牌预览`}><button className="card-preview-close" onClick={() => setPreviewCard(undefined)} aria-label="关闭卡牌预览">×</button><img src={cardArt(previewCard.type, locale)} alt={`${cardName(previewCard, locale)}卡面`} /><div><small>{cardFunction(previewCard, locale)} · {previewCard.cost} 点能量</small><h2>{cardName(previewCard, locale)}</h2><p>{cardDescription(previewCard, locale)}</p><button onClick={() => { selectCard(previewCard); setPreviewCard(undefined); }}>选择这张卡</button></div></section></div>}
    {robotPanelOpen && <RobotConnectionPanel mode={robotMode} endpoints={robotEndpoints} hardwareModes={robotHardwareModes} endpointStates={robotEndpointStates} error={robotError} onEndpoints={setRobotEndpoints} onHardwareModes={setRobotHardwareModes} onConnect={connectRobots} onDisconnect={disconnectRobots} onClose={() => setRobotPanelOpen(false)} />}
    {robotDebugOpen && <RobotDebugPanel endpoints={robotEndpoints} onEndpoints={setRobotEndpoints} onClose={() => setRobotDebugOpen(false)} />}
    <footer><span>极昼风暴后 · 第七方舟战区</span><b>双核协议</b><span>中央核心：固定掩体 / 视线阻挡</span></footer>
  </main>;
}
