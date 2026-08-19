export type PersonalityId = "vanguard" | "guardian" | "strategist" | "wanderer";

export type AgentMoveOption = {
  id: string;
  point: { x: number; z: number };
  path?: { x: number; z: number }[];
  routeLength: number;
  distanceToEnemy: number;
  distanceToEnemyBase: number;
  distanceToOwnBase: number;
  progressToEnemy: number;
  progressToEnemyBase: number;
  lateralOffset: number;
  waypointCount: number;
  direct: boolean;
  repetitionPenalty: number;
  preferredRange: number;
  rangeError: number;
  attackReadiness: number;
};

export type AgentResolution = {
  decision: "execute" | "refuse";
  target?: string;
  label: string;
  line: string;
  reason: string;
  source: "deepseek" | "local";
  durationMs: number;
  localized?: {
    zh: { label: string; line: string; reason: string };
    en: { label: string; line: string; reason: string };
  };
};

export const PERSONALITIES: Record<PersonalityId, {
  name: string;
  nameEn: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  credo: string;
  credoEn: string;
}> = {
  vanguard: {
    name: "破阵者",
    nameEn: "Vanguard",
    title: "进攻人格",
    titleEn: "Aggressive Persona",
    description: "优先逼近、突破与攻击基地，不喜欢在优势时后退或修整。",
    descriptionEn: "Prioritizes advancing, breaking through, and attacking the base; dislikes retreating or repairing while ahead.",
    credo: "先撕开防线，再讨论代价。",
    credoEn: "Break the line first. Count the cost later.",
  },
  guardian: {
    name: "守望者",
    nameEn: "Guardian",
    title: "防御人格",
    titleEn: "Defensive Persona",
    description: "珍惜 AURA 与基地，会拒绝生命过低时的冒险攻击。",
    descriptionEn: "Protects the AURA and base, and refuses risky attacks at critically low health.",
    credo: "活着守住核心，才有下一次反击。",
    credoEn: "Keep the core alive, then counterattack.",
  },
  strategist: {
    name: "演算师",
    nameEn: "Strategist",
    title: "理性人格",
    titleEn: "Analytical Persona",
    description: "只拒绝无效指令，根据胜率选择目标与移动位置。",
    descriptionEn: "Rejects only ineffective orders and chooses targets and positions by expected outcome.",
    credo: "情绪不是变量，结果才是。",
    credoEn: "Emotion is not a variable. Results are.",
  },
  wanderer: {
    name: "逐风者",
    nameEn: "Wanderer",
    title: "自由人格",
    titleEn: "Freeform Persona",
    description: "偏爱侧翼和意外路线，偶尔会抗命，但行为仍受规则约束。",
    descriptionEn: "Favors flanks and unexpected routes, sometimes disobeys, but always remains within the rules.",
    credo: "直线抵达很快，绕路抵达更有趣。",
    credoEn: "A straight line is faster. A detour is more interesting.",
  },
};
