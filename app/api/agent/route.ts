import { PERSONALITIES, type AgentMoveOption, type AgentResolution, type PersonalityId } from "../../lib/agent-personality";

type AgentCard = { id: string; name: string; type: string; cost: number; range?: number; damage?: number };
type AgentPlayer = { auraHp: number; baseHp: number; shield: number; revives: number; jamActive?: boolean; position: { x: number; z: number } };
type AgentRequest = {
  round: number;
  active: "red" | "blue";
  points: number;
  personality: PersonalityId;
  selectedCard: AgentCard;
  player: AgentPlayer;
  enemy: AgentPlayer;
  moveOptions: AgentMoveOption[];
};

const distance = (a: AgentPlayer["position"], b: AgentPlayer["position"]) => Math.hypot(a.x - b.x, a.z - b.z);
const hash = (value: string) => [...value].reduce((total, char) => ((total * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
const enemyBasePosition = (active: AgentRequest["active"]) => ({ x: active === "red" ? 79 : -79, z: 0 });
const attackDistances = (state: AgentRequest) => ({
  enemy_aura: distance(state.player.position, state.enemy.position),
  enemy_base: distance(state.player.position, enemyBasePosition(state.active)),
});

const movementScore = (option: AgentMoveOption, personality: PersonalityId) => {
  const efficiencyPenalty = Math.max(0, option.routeLength - Math.hypot(option.progressToEnemy, option.lateralOffset * .15));
  if (personality === "vanguard") {
    return option.progressToEnemyBase * 3.2 + option.progressToEnemy * 1.1 + option.attackReadiness * .8 - option.rangeError * .16 + Math.min(option.lateralOffset, 24) * .18 - efficiencyPenalty * .08 - option.repetitionPenalty * 1.35;
  }
  if (personality === "guardian") {
    return -option.rangeError * 2.1 - Math.abs(option.distanceToOwnBase - 48) * .55 + option.attackReadiness * 1.15 + option.progressToEnemyBase * .3 - efficiencyPenalty * .05 - option.repetitionPenalty * 1.1;
  }
  if (personality === "strategist") {
    return -option.rangeError * 2.8 + option.attackReadiness * 1.7 + option.progressToEnemyBase * .65 - efficiencyPenalty * .12 - option.repetitionPenalty * 1.2;
  }
  return option.progressToEnemyBase * 1.35 + Math.min(option.lateralOffset, 32) * 1.2 + option.attackReadiness * .65 - option.rangeError * .18 + option.progressToEnemy * .4 - efficiencyPenalty * .08 - option.repetitionPenalty * 1.55;
};

const rankedMoveOptions = (state: AgentRequest) => [...state.moveOptions].sort((a, b) =>
  movementScore(b, state.personality) - movementScore(a, state.personality)
  || b.progressToEnemyBase - a.progressToEnemyBase
  || a.routeLength - b.routeLength,
);

const selectedMoveOption = (state: AgentRequest) => {
  const pool = rankedMoveOptions(state).slice(0, 3);
  if (pool.length <= 1) return pool[0];
  const seed = hash(`${state.active}-${state.round}-${state.selectedCard.id}-${state.player.position.x}-${state.player.position.z}`);
  const patterns: Record<PersonalityId, number[]> = {
    vanguard: [0, 0, 1, 2],
    guardian: [0, 1, 0, 2],
    strategist: [0, 0, 0, 1],
    wanderer: [0, 1, 2],
  };
  return pool[Math.min(pool.length - 1, patterns[state.personality][seed % patterns[state.personality].length])];
};

const selectedAttackTarget = (state: AgentRequest) => {
  const damage = state.selectedCard.damage ?? 0;
  const ranges = attackDistances(state);
  const maxRange = state.selectedCard.range ?? 0;
  const auraEffectiveHp = state.enemy.auraHp + state.enemy.shield;
  let auraScore = Math.min(damage, auraEffectiveHp) * 1.15;
  let baseScore = Math.min(damage, state.enemy.baseHp) * 1.25;
  if (state.enemy.shield > 0) auraScore += Math.min(damage, state.enemy.shield) * .35;
  if (auraEffectiveHp > 0 && auraEffectiveHp <= damage) auraScore += 32 + (state.enemy.revives > 0 ? 14 : 24);
  if (state.enemy.auraHp <= 12 && state.enemy.auraHp > 0) auraScore += 12;
  if (state.enemy.auraHp <= 0) auraScore -= 100;
  if (state.enemy.baseHp <= damage) baseScore += 120;
  else if (state.enemy.baseHp <= 20) baseScore += 24;
  if (state.personality === "vanguard") baseScore += 18;
  if (state.personality === "guardian") auraScore += 13;
  if (state.personality === "strategist") {
    auraScore += auraEffectiveHp <= damage ? 15 : 0;
    baseScore += state.enemy.baseHp <= damage ? 20 : 0;
  }
  if (state.personality === "wanderer") {
    if (hash(`${state.selectedCard.id}-${state.round}-${state.enemy.baseHp}`) % 2) baseScore += 8;
    else auraScore += 8;
  }
  if (ranges.enemy_aura > maxRange) auraScore = Number.NEGATIVE_INFINITY;
  if (ranges.enemy_base > maxRange) baseScore = Number.NEGATIVE_INFINITY;
  return baseScore > auraScore ? "enemy_base" : "enemy_aura";
};

function result(input: Omit<AgentResolution, "source" | "durationMs">, durationMs: number): AgentResolution {
  return { ...input, source: "local", durationMs };
}

function localResolution(state: AgentRequest, durationMs = 0): AgentResolution {
  const card = state.selectedCard;
  const persona = PERSONALITIES[state.personality];
  const refuse = (reason: string, line: string) => result({ decision: "refuse", label: `${persona.name}拒绝执行`, reason, line }, durationMs);
  const execute = (target: string | undefined, reason: string, line: string) => result({ decision: "execute", target, label: `${persona.name}接受指令`, reason, line }, durationMs);

  if (card.cost > state.points) return refuse("当前能量不足，指令不合法。", "能量链路不足，我不会启动。 ");
  if (["pulse", "beam", "pierce"].includes(card.type)) {
    const ranges = attackDistances(state);
    if (Math.min(ranges.enemy_aura, ranges.enemy_base) > (card.range ?? 0)) return refuse(`敌方 AURA 距离 ${Math.round(ranges.enemy_aura)} cm、基地距离 ${Math.round(ranges.enemy_base)} cm，均超出射程。`, "目标不在有效射界内，拒绝浪费弹药。 ");
    if (state.personality === "guardian" && state.player.auraHp <= 12 && state.player.shield === 0) {
      return refuse("己方生命过低且没有护盾，守望者拒绝冒险开火。", "先保住核心，我不会在这里暴露位置。 ");
    }
    const target = selectedAttackTarget(state);
    return execute(target, target === "enemy_base" ? "选择直接压制敌方基地。" : "选择削弱敌方 AURA。", target === "enemy_base" ? "锁定核心。让这一击改变战场。" : "锁定敌机，先解除眼前的威胁。 ");
  }

  if (card.type === "move") {
    if (!state.moveOptions.length) return refuse("没有通过碰撞与边界校验的移动路线。", "所有路径都在说不，换一张牌。 ");
    const choice = selectedMoveOption(state);
    const routeStyle = choice.direct ? "直线" : `绕障${Math.max(1, choice.waypointCount - 2)}弯`;
    return execute(choice.id, `${routeStyle}推进 ${Math.round(choice.routeLength)} cm，向敌方核心接近 ${Math.max(0, Math.round(choice.progressToEnemyBase))} cm。`, state.personality === "guardian" ? "守住回撤空间，同时把对手纳入射界。" : state.personality === "wanderer" ? "从侧翼切进去，下一步会更有趣。" : state.personality === "strategist" ? "进入最佳交战距离，路线已解算。" : "绕开障碍，直取敌方核心。 ");
  }

  if (card.type === "repair") {
    const auraMissing = 40 - state.player.auraHp;
    const baseMissing = 60 - state.player.baseHp;
    if (auraMissing <= 0 && baseMissing <= 0) return refuse("AURA 与基地均为满生命，修复无效。", "没有裂痕需要修补。 ");
    if (state.personality === "vanguard" && state.player.auraHp > 24 && state.player.baseHp > 30) {
      return refuse("当前状态仍可进攻，破阵者拒绝提前修整。", "这点损伤拦不住我，把能量留给进攻。 ");
    }
    const target = auraMissing / 40 >= baseMissing / 60 ? "own_aura" : "own_base";
    return execute(target, target === "own_aura" ? "优先恢复 AURA。" : "优先修复基地核心。", target === "own_aura" ? "先修复机体，我还要继续战斗。" : "核心优先，正在重建防线。 ");
  }

  if (card.type === "shield") {
    if (state.player.shield > 0) return refuse("现有护盾仍然有效，重复部署没有收益。", "护盾在线，不需要重复充能。 ");
    if (state.personality === "vanguard" && state.player.auraHp > 28) return refuse("状态良好，破阵者不愿为防御停下。", "装甲足够。我要的是突破，不是等待。 ");
    return execute("own_aura", "建立 20 点防护。", "护盾展开，继续行动。 ");
  }

  if (card.type === "jam") {
    if (state.player.jamActive) return refuse("干扰链路已经待命。", "干扰器已经在监听，不必重复部署。 ");
    if (state.personality === "wanderer" && hash(`${card.id}-${state.round}`) % 7 === 0) return refuse("逐风者临时改变了战术。", "不，这次我要让他们看见我。 ");
    return execute("self", "部署一次攻击反制。", "链路已潜伏，等他们先犯错。 ");
  }

  return execute("self", "指令有效。", "执行。 ");
}

const validState = (value: unknown): value is AgentRequest => {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<AgentRequest>;
  return (state.active === "red" || state.active === "blue")
    && typeof state.personality === "string" && state.personality in PERSONALITIES
    && Number.isFinite(state.points) && !!state.selectedCard && !!state.player && !!state.enemy
    && Array.isArray(state.moveOptions);
};

function allowedTargets(state: AgentRequest) {
  if (state.selectedCard.type === "move") return rankedMoveOptions(state).slice(0, 6).map((option) => option.id);
  if (["pulse", "beam", "pierce"].includes(state.selectedCard.type)) {
    const ranges = attackDistances(state);
    const maxRange = state.selectedCard.range ?? 0;
    return (["enemy_aura", "enemy_base"] as const).filter((target) => ranges[target] <= maxRange);
  }
  if (state.selectedCard.type === "repair") return ["own_aura", "own_base"];
  return ["own_aura", "self"];
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const body: unknown = await request.json().catch(() => null);
  if (!validState(body)) return Response.json({ error: "invalid_game_state" }, { status: 400 });
  const fallback = () => Response.json(localResolution(body, Date.now() - startedAt));
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return fallback();

  const localGuard = localResolution(body);
  if (localGuard.decision === "refuse" && /能量|射程|没有通过|满生命|已经|重复部署|现有护盾/.test(localGuard.reason)) return fallback();
  const targets = allowedTargets(body);
  const persona = PERSONALITIES[body.personality];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        thinking: { type: "disabled" },
        temperature: body.personality === "wanderer" ? 0.65 : 0.25,
        max_tokens: 190,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `你是桌游中真正控制AURA执行动作的驾驶人格“${persona.name}”。性格：${persona.description} 信条：${persona.credo} 玩家只选择卡牌；你必须决定execute或refuse。移动路线和攻击目标会由本地战术系统结合手牌射程、基地生命、重构次数、路线历史与人格完成最终校准。有效且有收益的攻击通常应执行，只有明确无效或会立即导致失败时才拒绝。玩家一旦提交卡牌，无论接受或拒绝，卡牌都会作废、进入弃牌堆并消耗能量。同回合不限制任何卡牌类型的使用次数。只输出JSON：{"decision":"execute或refuse","target":"合法target；拒绝时省略","label":"12字内裁决","line":"24字内角色台词","reason":"36字内理由"}。不得改变伤害、费用或规则。` },
          { role: "user", content: `合法target=${JSON.stringify(targets)}；局面=${JSON.stringify(body)}` },
        ],
      }),
    });
    if (!response.ok) return fallback();
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return fallback();
    const parsed = JSON.parse(content) as Partial<AgentResolution>;
    if (parsed.decision !== "execute" && parsed.decision !== "refuse") return fallback();
    if (parsed.decision === "execute" && (typeof parsed.target !== "string" || !targets.includes(parsed.target))) return fallback();
    if (body.selectedCard.type === "move" && parsed.decision === "execute") {
      parsed.target = selectedMoveOption(body)?.id;
    }
    if (["pulse", "beam", "pierce"].includes(body.selectedCard.type) && parsed.decision === "execute") {
      parsed.target = selectedAttackTarget(body);
    }
    if (["pulse", "beam", "pierce"].includes(body.selectedCard.type) && parsed.decision === "refuse" && localGuard.decision === "execute") {
      return Response.json({ ...localGuard, durationMs: Date.now() - startedAt });
    }
    return Response.json({
      decision: parsed.decision,
      target: parsed.decision === "execute" ? parsed.target : undefined,
      label: typeof parsed.label === "string" ? parsed.label.slice(0, 24) : `${persona.name}完成裁决`,
      line: typeof parsed.line === "string" ? parsed.line.slice(0, 48) : persona.credo,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 72) : "依据当前人格与战场状态。",
      source: "deepseek",
      durationMs: Date.now() - startedAt,
    } satisfies AgentResolution);
  } catch {
    return fallback();
  } finally {
    clearTimeout(timeout);
  }
}
