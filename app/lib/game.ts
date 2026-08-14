export type Faction = "red" | "blue";
export type CardType = "move" | "pulse" | "beam" | "pierce" | "repair" | "shield" | "jam";

export type CardDefinition = {
  type: CardType;
  name: string;
  functionName: string;
  cost: number;
  count: number;
  description: string;
  range?: number;
  damage?: number;
};

export type CardInstance = CardDefinition & { id: string; faction: Faction };
export type Vec2 = { x: number; z: number };

export const FIELD_LENGTH_CM = 180;
export const FIELD_WIDTH_CM = 90;
export const FIELD_SAFE_MARGIN_CM = 10;
export const AURA_START_POSITIONS: Record<Faction, Vec2> = {
  red: { x: -58, z: 0 },
  blue: { x: 58, z: 0 },
};
export const BASE_POSITIONS: Record<Faction, Vec2> = {
  red: { x: -79, z: 0 },
  blue: { x: 79, z: 0 },
};

export type PlayerState = {
  faction: Faction;
  auraHp: number;
  baseHp: number;
  shield: number;
  revives: number;
  hand: CardInstance[];
  deck: CardInstance[];
  discard: CardInstance[];
  position: Vec2;
  jamActive?: boolean;
};

export type GameEvent = { id: number; time: string; faction?: Faction; text: string; kind?: "info" | "damage" | "system" };

export type GameState = {
  round: number;
  active: Faction;
  points: number;
  drawsRemaining: number;
  phase: "playing" | "finished";
  winner?: Faction | "draw";
  players: Record<Faction, PlayerState>;
  selectedCard?: CardInstance;
  plannedTarget?: Vec2;
  routeHistory: Record<Faction, Vec2[]>;
  events: GameEvent[];
};

export const CARD_DEFINITIONS: CardDefinition[] = [
  { type: "move", name: "极昼疾行", functionName: "移动", cost: 1, count: 8, range: 70, description: "沿合法规划路径移动，单次距离最多 70 cm。" },
  { type: "pulse", name: "曙光脉冲", functionName: "轻型攻击", cost: 1, count: 4, range: 35, damage: 20, description: "35 cm 内造成 20 点伤害。" },
  { type: "beam", name: "裂空光束", functionName: "中型攻击", cost: 2, count: 3, range: 55, damage: 30, description: "55 cm 内造成 30 点伤害，可被干扰。" },
  { type: "pierce", name: "天穹贯穿", functionName: "重型攻击", cost: 3, count: 2, range: 75, damage: 45, description: "75 cm 内造成 45 点伤害，可被干扰。" },
  { type: "repair", name: "曙光再生", functionName: "修复", cost: 2, count: 3, description: "为己方 Aura 或基地恢复 15 点生命。" },
  { type: "shield", name: "相位壁垒", functionName: "护盾", cost: 2, count: 2, description: "获得 20 点护盾，持续至己方下回合。" },
  { type: "jam", name: "链路干扰", functionName: "反制", cost: 1, count: 1, description: "抵消一次中型或重型攻击。" },
];

const makeDeck = (faction: Faction) => CARD_DEFINITIONS.flatMap((def) =>
  Array.from({ length: def.count }, (_, index) => ({ ...def, faction, id: `${faction}-${def.type}-${String(index + 1).padStart(2, "0")}` })),
);

const seededRandom = (seed: number) => {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
};

export const shuffleCards = <T,>(cards: T[], seed: number): T[] => {
  const shuffled = [...cards];
  const random = seededRandom(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
};

const preparePlayer = (faction: Faction, seed: number): PlayerState => {
  const all = shuffleCards(makeDeck(faction), seed ^ (faction === "red" ? 0x52ed : 0xb1ae));
  const hand = all.slice(0, 5);
  const deck = all.slice(5);
  return {
    faction,
    auraHp: 40,
    baseHp: 60,
    shield: 0,
    revives: 2,
    hand,
    deck,
    discard: [],
    position: { ...AURA_START_POSITIONS[faction] },
  };
};

const now = () => new Date().toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const event = (id: number, text: string, faction?: Faction, kind: GameEvent["kind"] = "info"): GameEvent => ({ id, text, faction, kind, time: now() });

export function createInitialGame(seed = 0x20260806): GameState {
  return {
    round: 1,
    active: "red",
    points: 3,
    drawsRemaining: 2,
    phase: "playing",
    routeHistory: { red: [], blue: [] },
    players: { red: preparePlayer("red", seed), blue: preparePlayer("blue", seed) },
    events: [{ id: 1, time: "--:--:--", text: "双核协议已启动，红方获得先手。", kind: "system" }],
  };
}

export const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
export const otherFaction = (f: Faction): Faction => f === "red" ? "blue" : "red";

export type CardPayload = { faction?: Faction; type: CardType; instanceId: string };

export function parseCardPayload(raw: string): CardPayload | null {
  const normalized = raw.trim();
  const namedCard = CARD_DEFINITIONS.find((card) => card.name === normalized);
  if (namedCard) {
    return { type: namedCard.type, instanceId: `name-${namedCard.type}` };
  }

  try {
    const parsed = JSON.parse(raw);
    const faction = String(parsed.faction).toLowerCase();
    const type = String(parsed.cardType ?? parsed.type).toLowerCase();
    if ((faction === "red" || faction === "blue") && CARD_DEFINITIONS.some((card) => card.type === type)) {
      return { faction, type: type as CardType, instanceId: String(parsed.instanceId ?? `${faction}-${type}-demo`) };
    }
  } catch { /* accept compact card codes below */ }
  const match = normalized.toLowerCase().match(/^(red|blue)[-:](move|pulse|beam|pierce|repair|shield|jam)(?:[-:](.+))?$/);
  return match ? { faction: match[1] as Faction, type: match[2] as CardType, instanceId: match[3] ?? normalized } : null;
}
