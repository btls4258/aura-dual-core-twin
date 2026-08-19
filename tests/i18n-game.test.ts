import assert from "node:assert/strict";
import test from "node:test";
import { CARD_DEFINITIONS, parseCardPayload } from "../app/lib/game";
import { PERSONALITIES } from "../app/lib/agent-personality";
import { translateText } from "../app/lib/i18n";
import { POST as decide } from "../app/api/agent/route";

const agentState = {
  locale: "en-US" as const,
  round: 2,
  active: "red" as const,
  points: 3,
  personality: "vanguard" as const,
  selectedCard: { id: "red-pierce-01", name: "天穹贯穿", type: "pierce", cost: 3, range: 75, damage: 45 },
  player: { auraHp: 40, baseHp: 60, shield: 0, revives: 2, position: { x: -58, z: 0 } },
  enemy: { auraHp: 40, baseHp: 60, shield: 0, revives: 2, position: { x: -20, z: 0 } },
  moveOptions: [],
};

const agentRequest = () => new Request("http://localhost/api/agent", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(agentState),
});

test("English card names preserve stable card types and remain scannable", () => {
  assert.equal(new Set(CARD_DEFINITIONS.map((card) => card.nameEn)).size, CARD_DEFINITIONS.length);
  for (const card of CARD_DEFINITIONS) {
    assert.equal(parseCardPayload(card.name)?.type, card.type);
    assert.equal(parseCardPayload(card.nameEn)?.type, card.type);
    assert.equal(parseCardPayload(card.nameEn.toUpperCase())?.type, card.type);
    assert.ok(card.functionNameEn.length > 0);
    assert.ok(card.descriptionEn.length > 0);
  }
});

test("Every pilot persona has complete English presentation copy", () => {
  for (const personality of Object.values(PERSONALITIES)) {
    assert.ok(personality.nameEn.length > 0);
    assert.ok(personality.titleEn.length > 0);
    assert.ok(personality.descriptionEn.length > 0);
    assert.ok(personality.credoEn.length > 0);
  }
});

test("Dynamic gameplay events translate without visible Chinese", () => {
  const events = [
    "赤曜阵营摸取一张牌，牌库剩余 17 张。",
    "破阵者执行极昼疾行，自主移动 63 cm 至 (-3, 23)；“绕开障碍，直取敌方核心。 ”",
    "玩家直控执行天穹贯穿，直接锁定 AURA 并造成 40 点伤害；“切换为玩家直控。”",
    "蓝穹阵营消耗 10 点基地生命完成方舟重构。",
  ];
  for (const source of events) assert.doesNotMatch(translateText(source, "en-US"), /[\u3400-\u9fff]/);
});

test("Local agent decisions keep the Chinese contract and include English display copy", async () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const response = await decide(agentRequest());
    const resolution = await response.json();
    assert.equal(resolution.source, "local");
    assert.match(resolution.reason, /AURA/);
    assert.equal(resolution.localized.zh.reason, resolution.reason);
    assert.doesNotMatch(resolution.localized.en.label + resolution.localized.en.line + resolution.localized.en.reason, /[\u3400-\u9fff]/);
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
  }
});

test("DeepSeek decisions map bilingual copy without changing the default response fields", async () => {
  const previousKey = process.env.DEEPSEEK_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.DEEPSEEK_API_KEY = "test-only";
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({
    decision: "execute",
    target: "enemy_aura",
    labelZh: "破阵者接受指令",
    lineZh: "锁定敌机。",
    reasonZh: "选择削弱敌方 AURA。",
    labelEn: "Vanguard accepts",
    lineEn: "Enemy AURA locked.",
    reasonEn: "Disabling the enemy AURA offers the best result.",
  }) } }] });
  try {
    const response = await decide(agentRequest());
    const resolution = await response.json();
    assert.equal(resolution.source, "deepseek");
    assert.equal(resolution.label, "破阵者接受指令");
    assert.equal(resolution.localized.zh.label, resolution.label);
    assert.equal(resolution.localized.en.label, "Vanguard accepts");
    assert.doesNotMatch(resolution.localized.en.line + resolution.localized.en.reason, /[\u3400-\u9fff]/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});
