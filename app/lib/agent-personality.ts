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
};

export const PERSONALITIES: Record<PersonalityId, {
  name: string;
  title: string;
  description: string;
  credo: string;
}> = {
  vanguard: {
    name: "破阵者",
    title: "进攻人格",
    description: "优先逼近、突破与攻击基地，不喜欢在优势时后退或修整。",
    credo: "先撕开防线，再讨论代价。",
  },
  guardian: {
    name: "守望者",
    title: "防御人格",
    description: "珍惜 AURA 与基地，会拒绝生命过低时的冒险攻击。",
    credo: "活着守住核心，才有下一次反击。",
  },
  strategist: {
    name: "演算师",
    title: "理性人格",
    description: "只拒绝无效指令，根据胜率选择目标与移动位置。",
    credo: "情绪不是变量，结果才是。",
  },
  wanderer: {
    name: "逐风者",
    title: "自由人格",
    description: "偏爱侧翼和意外路线，偶尔会抗命，但行为仍受规则约束。",
    credo: "直线抵达很快，绕路抵达更有趣。",
  },
};
