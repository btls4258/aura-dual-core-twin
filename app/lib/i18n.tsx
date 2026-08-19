"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

export type Locale = "zh-CN" | "en-US";

const STORAGE_KEY = "aura-duel-locale";
const CHANGE_EVENT = "aura-duel-locale-change";
const DEFAULT_LOCALE: Locale = "zh-CN";

const exact: Record<string, string> = {
  "赤曜阵营": "Crimson",
  "蓝穹阵营": "Azure",
  "赤曜": "Crimson",
  "蓝穹": "Azure",
  "当前行动": "ACTIVE",
  "链路待命": "STANDBY",
  "AURA 生命": "AURA HP",
  "基地核心": "BASE CORE",
  "护盾": "SHIELD",
  "重构次数": "REBUILDS",
  "手牌": "HAND",
  "牌库": "DECK",
  "张": "CARDS",
  "能量值": "ENERGY",
  "规则引擎": "RULE ENGINE",
  "机器人接口": "ROBOT LINK",
  "实体 AURA": "PHYSICAL AURA",
  "连接中": "CONNECTING",
  "虚拟 AURA": "VIRTUAL AURA",
  "阵营机器人配置": "Faction Robot Setup",
  "关闭机器人连接面板": "Close robot setup",
  "每个阵营可独立使用实体或虚拟 AURA。实体侧执行真实路径，虚拟侧继续在数字孪生中运行。": "Each faction can independently use a physical or virtual AURA. Physical units follow real paths while virtual units remain in the digital twin.",
  "实体已连接": "PHYSICAL CONNECTED",
  "检查中": "CHECKING",
  "虚拟运行": "VIRTUAL",
  "虚拟机器人": "Virtual Robot",
  "实体机器人": "Physical Robot",
  "实体模式安全边界": "Physical-mode Safety Limits",
  "AURAOS · 局域网": "AURAOS · LOCAL NETWORK",
  "最大 0.15 m/s · 路线最长 70 cm · A* 避障 · 随时急停": "Max 0.15 m/s · Route up to 70 cm · A* avoidance · Emergency stop anytime",
  "取消": "Cancel",
  "断开全部实体机器人": "Disconnect Physical Robots",
  "正在检查实体 AURA…": "Checking physical AURA…",
  "应用并连接": "Apply & Connect",
  "双击预览": "Double-click to preview",
  "等待扫描卡牌，或从当前手牌中选择一张进行测试。": "Scan a card or select one from the active hand.",
  "先选择卡牌": "Select a card first",
  "AURA 裁决中…": "AURA deciding…",
  "请点击战场落点": "Select a destination",
  "玩家确认执行": "Confirm action",
  "人格裁决": "Persona Decision",
  "已执行": "EXECUTED",
  "步骤 2/3": "STEP 2/3",
  "步骤 2/2": "STEP 2/2",
  "步骤 1/2": "STEP 1/2",
  "机器人连接中": "ROBOT CONNECTING",
  "双实体 AURA": "DUAL PHYSICAL AURA",
  "实体 / 虚拟混合": "PHYSICAL / VIRTUAL",
  "连接机器人": "Connect Robots",
  "虚拟牌库 · 扫描当前手牌": "Virtual deck · scan active hand",
  "卡牌识别": "Card Scanner",
  "Mac 本机摄像头": "Mac Camera",
  "Mac 摄像头未开启": "Mac camera is off",
  "当前浏览器不支持原生二维码识别，请用手动输入": "This browser does not support native QR scanning. Use manual input.",
  "正在识别卡牌二维码": "Scanning card QR code",
  "识别器暂时不可用，可使用手动输入": "Scanner unavailable. Use manual input.",
  "无法打开 Mac 摄像头，请检查浏览器权限": "Unable to open the Mac camera. Check browser permissions.",
  "关闭摄像头": "Close Camera",
  "开启扫码": "Start Scanner",
  "读取": "Read",
  "等待四个角标": "Waiting for four corner tags",
  "尚未收到识别数据": "No detection data received",
  "180 × 90 cm 坐标系已锁定": "180 × 90 cm coordinate system locked",
  "标定失败": "Calibration failed",
  "全局画面在线": "Global camera online",
  "等待手机加入": "Waiting for phone",
  "摄像头网关离线": "Camera gateway offline",
  "手机全局摄像头": "Phone Global Camera",
  "关闭大图（Esc）": "Close view (Esc)",
  "放大识别": "Open detection view",
  "请启动本地摄像头网关": "Start the local camera gateway",
  "在手机浏览器打开": "Open in the phone browser",
  "首次打开 HTTPS 地址时，请在手机上允许证书与摄像头权限。": "On first opening the HTTPS address, allow the certificate and camera permission on the phone.",
  "等待手机检测": "Waiting for phone detection",
  "重新标定": "Recalibrate",
  "开始标定": "Start Calibration",
  "视频流 WebRTC": "WebRTC Video",
  "AprilTag 手机端识别": "AprilTag phone detection",
  "载入场景模型": "Loading scene models",
  "实景模型与 AURA 就绪": "Scene models and AURA ready",
  "载入 AURA 模型": "Loading AURA model",
  "部分模型使用安全占位": "Some models use safe placeholders",
  "AURA 模型载入失败": "AURA model failed to load",
  "AURA 数字孪生战场": "AURA digital-twin battlefield",
  "视角切换": "Camera view",
  "俯视复位": "Top View",
  "立体复位": "3D View",
  "隐藏坐标": "Hide Coordinates",
  "显示坐标": "Show Coordinates",
  "左键旋转 · 滚轮缩放 · 右键平移": "Left drag: rotate · Wheel: zoom · Right drag: pan",
  "点击地面规划坐标": "Click ground to plan a destination",
  "暂时无法读取相机画面": "Camera feed unavailable",
  "正在请求相机画面": "Requesting camera feed",
  "连接机器人后显示画面": "Connect a robot to view its camera",
  "线速度": "LINEAR SPEED",
  "角速度": "ANGULAR SPEED",
  "左轮": "LEFT WHEEL",
  "右轮": "RIGHT WHEEL",
  "调试日志": "DEBUG LOG",
  "尚无控制记录": "No control activity",
  "机器人调试台": "ROBOT DEBUG CONSOLE",
  "等待连接检查": "WAITING FOR CONNECTION CHECK",
  "机器人地址": "ROBOT ADDRESS",
  "连接检查": "CHECK CONNECTION",
  "检查中…": "CHECKING…",
  "手动遥控": "MANUAL DRIVE",
  "WASD 可组合 · 松开停车": "Combine WASD · release to stop",
  "前进": "FORWARD",
  "左转": "TURN LEFT",
  "停车": "STOP",
  "右转": "TURN RIGHT",
  "后退": "REVERSE",
  "调试控制绕过牌局路径规划，仅在机器人架空或安全区域内使用。页面失焦、松开按键或关闭弹窗都会自动停车。": "Debug controls bypass game route planning. Use only with the robot lifted or in a safe area. Losing focus, releasing a key, or closing this panel stops the robot.",
  "屏幕表情 Demo": "DISPLAY EXPRESSION DEMO",
  "播放后自动返回待机": "Returns to idle after playback",
  "开心": "HAPPY",
  "警告": "WARNING",
  "思考": "THINKING",
  "兴奋": "EXCITED",
  "好奇": "CURIOUS",
  "困惑": "CONFUSED",
  "失落": "SAD",
  "处理中": "PROCESSING",
  "充电": "CHARGING",
  "中性": "NEUTRAL",
  "待机": "IDLE",
  "实时遥测": "LIVE TELEMETRY",
  "打开": "OPEN",
  "暂停": "PAUSE",
  "实体牌库初始化": "PHYSICAL DECK SETUP",
  "前往扫码": "OPEN SCANNER",
  "登记摸牌": "REGISTER DRAW",
  "等待实体牌登记": "WAITING FOR PHYSICAL CARDS",
  "实体牌库同步": "PHYSICAL DECK SYNC",
  "待执行卡牌": "PENDING CARD",
  "查看大图": "VIEW CARD",
  "由玩家直接确认执行": "Player confirms and executes directly",
  "完全服从": "FULL COMPLIANCE",
  "不经过人格裁决。移动落点由玩家点击，其他卡牌由玩家确认后立即执行。": "No persona decision. The player selects move destinations and directly confirms all other cards.",
  "选择这张卡": "SELECT THIS CARD",
  "点能量": "energy",
  "落点 / 路径由 Agent 决定": "Destination / route decided by Agent",
  "是否执行 / 目标由 Agent 决定": "Execution / target decided by Agent",
  "移动卡已就绪：请点击战场选择目标点。": "Move card ready. Select a destination on the battlefield.",
  "点击地图选择落点": "Click the battlefield to select a destination",
  "+20 护盾": "+20 SHIELD",
  "+15 生命": "+15 HP",
  "已从洗牌后的牌库摸取一张牌。": "Drew one card from the shuffled deck.",
  "指令已由玩家确认执行。": "Order confirmed and executed by the player.",
  "玩家选择卡牌并直接确认动作": "Choose a card and confirm the action directly",
  "回合已切换，能量值重置为 3。": "Turn passed. Energy reset to 3.",
  "协议终局": "PROTOCOL COMPLETE",
  "虚拟牌库已重新洗牌，双方各摸取 5 张起始手牌。": "Virtual decks reshuffled. Both factions drew five starting cards.",
  "AURA 驾驶人格": "AURA PILOT PERSONA",
  "玩家直控": "PLAYER CONTROL",
  "玩家先选择卡牌，AURA 再决定如何执行": "Choose a card, then AURA decides how to execute it",
  "摸牌": "DRAW CARD",
  "结束回合": "END TURN",
  "基地回血": "REPAIR BASE",
  "重新部署并洗牌": "REDEPLOY & SHUFFLE",
  "卡牌预览": "CARD PREVIEW",
  "关闭卡牌预览": "Close card preview",
  "战术事件": "TACTICAL EVENTS",
  "等待行动": "WAITING FOR ACTION",
  "行动控制": "ACTION CONTROL",
  "视觉链路": "VISION LINK",
  "虚拟": "VIRTUAL",
  "实体卡牌": "PHYSICAL CARDS",
  "决策权": "DECISION MODE",
  "玩家提交的卡牌": "PLAYER-SUBMITTED CARD",
  "玩家直接指令": "PLAYER ORDER",
  "未选择": "NOT SELECTED",
  "收起": "COLLAPSE",
  "战报": "INTEL",
  "等待玩家提交卡牌": "Waiting for the player to submit a card",
  "战场事件": "BATTLEFIELD EVENTS",
  "实时状态流": "LIVE STATUS STREAM",
  "双核协议已启动，红方获得先手。": "Dual-Core Protocol initialized. Crimson moves first.",
  "接口状态": "INTEGRATION STATUS",
  "逐项联调": "SYSTEM CHECK",
  "Web 前端": "WEB CLIENT",
  "已运行": "RUNNING",
  "手机视频流": "PHONE VIDEO",
  "QR + 手动回退": "QR + MANUAL FALLBACK",
  "AprilTag 检测": "APRILTAG DETECTION",
  "手机端 WASM": "PHONE WASM",
  "场地坐标标定": "FIELD CALIBRATION",
  "等待标定": "WAITING FOR CALIBRATION",
  "位姿同步": "POSE SYNC",
  "Aura 机器人": "AURA ROBOTS",
  "双实体": "DUAL PHYSICAL",
  "双虚拟": "DUAL VIRTUAL",
  "极昼风暴后 · 第七方舟战区": "After the Polar Storm · Seventh Ark Sector",
  "双核协议": "DUAL-CORE PROTOCOL",
  "中央核心：固定掩体 / 视线阻挡": "Central core: fixed cover / line-of-sight blocker",
  "AURA：双核协议": "AURA: Dual-Core Protocol",
  "方舟对决": "Ark Duel",
  "紧急停止": "EMERGENCY STOP",
  "机器人调试": "ROBOT DEBUG",
  "回合": "ROUND",
  "能量": "ENERGY",
  "行动点": "ACTION POINTS",
  "抽牌次数": "DRAWS",
  "胜利": "VICTORY",
  "失败": "DEFEAT",
  "平局": "DRAW",
  "关闭": "Close",
  "失能": "DISABLED",
  "界面语言": "Interface language",
  "收起人格和战报": "Collapse persona and battle log",
  "展开人格和战报": "Expand persona and battle log",
  "关闭机器人调试台": "Close robot debug console",
  "选择调试机器人": "Select debug robot",
  "移动": "MOVE",
  "轻型攻击": "LIGHT ATTACK",
  "中型攻击": "MEDIUM ATTACK",
  "重型攻击": "HEAVY ATTACK",
  "修复": "REPAIR",
  "反制": "COUNTER",
  "实": "PHYS",
  "体": "ICAL",
};

const replacements: Array<[RegExp, string]> = [
  [/指令已执行：/g, "Order executed: "],
  [/绕开障碍，直取敌方核心。/g, "Clear the obstacle and drive for the enemy core."],
  [/守住回撤空间，同时把对手纳入射界。/g, "Keep the retreat lane open and bring the enemy into range."],
  [/切换为玩家直控。/g, "Switched to player control."],
  [/(赤曜阵营|蓝穹阵营)摸取一张牌，牌库剩余 (\d+) 张。/g, "$1 drew one card. $2 cards remain in the deck."],
  [/(Crimson|Azure)摸取一张牌，牌库剩余 (\d+) 张。/g, "$1 drew one card. $2 cards remain in the deck."],
  [/摸取一张牌，牌库剩余 (\d+) 张。/g, " drew one card. $1 cards remain in the deck."],
  [/结束回合，行动权交给/g, " ended the turn. Control passes to "],
  [/玩家直控执行/g, "Player control executed "],
  [/自主移动/g, " autonomously moved"],
  [/直接锁定 AURA 并造成/g, " directly targeted the AURA and dealt "],
  [/建立 (\d+) 点护盾/g, " deployed $1 shield"],
  [/基地向 AURA 输送能量：消耗 (\d+) 点基地生命，AURA 恢复至 (\d+) 点。/g, "The base transferred energy to AURA: spent $1 base HP and restored AURA to $2 HP."],
  [/消耗 (\d+) 点基地生命完成方舟重构。/g, " spent $1 base HP to rebuild the AURA."],
  [/虚拟牌库已重新洗牌，双方各摸取 (\d+) 张起始手牌。/g, "Virtual decks reshuffled. Both factions drew $1 starting cards."],
  [/胜利/g, " VICTORY"],
  [/失能/g, "DISABLED"],
  [/失效/g, "DISABLED"],
  [/破阵者/g, "Vanguard"],
  [/守望者/g, "Guardian"],
  [/演算师/g, "Strategist"],
  [/逐风者/g, "Wanderer"],
  [/进攻人格/g, "Aggressive Persona"],
  [/防御人格/g, "Defensive Persona"],
  [/理性人格/g, "Analytical Persona"],
  [/自由人格/g, "Freeform Persona"],
  [/已读取：/g, "Read: "],
  [/极昼疾行/g, "Polar Rush"],
  [/曙光脉冲/g, "Dawn Pulse"],
  [/裂空光束/g, "Rift Beam"],
  [/天穹贯穿/g, "Sky Piercer"],
  [/曙光再生/g, "Dawn Renewal"],
  [/相位壁垒/g, "Phase Barrier"],
  [/链路干扰/g, "Link Jammer"],
  [/赤曜机器人/g, "Crimson robot"],
  [/蓝穹机器人/g, "Azure robot"],
  [/实体牌库已启用：请先依次扫描/g, "Physical deck enabled. Scan "],
  [/的 (\d+) 张起始手牌/g, "'s $1 starting cards"],
  [/请前往视觉链路继续登记/g, "Open Vision Link to continue registering "],
  [/请扫描/g, "Scan "],
  [/第 (\d+) 张/g, " card $1"],
  [/请登记/g, "Register "],
  [/起始手牌/g, " starting hand"],
  [/手牌/g, " hand"],
  [/登记/g, "Register "],
  [/实体牌库/g, "Physical deck"],
  [/有效射程/g, "Effective range"],
  [/移动上限/g, "Move limit"],
  [/已就绪，等待玩家确认执行。/g, " is ready. Waiting for player confirmation."],
  [/移动卡已提交：落点与安全路径将由/g, "Move card submitted. Destination and safe route will be decided by "],
  [/决定。/g, "."],
  [/已提交，等待/g, " submitted. Waiting for "],
  [/决定是否执行及执行/g, " to decide execution and target"],
  [/交给/g, "Ask "],
  [/裁决/g, " to decide"],
  [/机器人视角/g, "ROBOT VIEW"],
  [/转向轮速/g, "TURN WHEEL SPEED"],
  [/机器人接口/g, "ROBOT LINK"],
  [/已到达目标/g, "reached the destination"],
  [/目标 \(([-\d.]+), ([-\d.]+)\)/g, "Target ($1, $2)"],
  [/目标/g, "TARGET"],
  [/点击地面规划坐标/g, "click ground to plan a destination"],
  [/牌库 (\d+) · 弃牌 (\d+)/g, "Deck $1 · Discard $2"],
  [/牌库 (\d+)/g, "Deck $1"],
  [/弃牌 (\d+)/g, "Discard $1"],
  [/弃牌/g, "Discard"],
  [/第 (\d+) 回合/g, "Round $1"],
  [/第(\d+)回合/g, "Round $1"],
  [/消耗 (\d+) 点能量/g, "costs $1 energy"],
  [/消耗 (\d+)/g, "cost $1"],
  [/需要 (\d+) 点能量/g, " requires $1 energy"],
  [/造成 (\d+) 点伤害/g, "deals $1 damage"],
  [/恢复 (\d+) 点生命/g, "restores $1 HP"],
  [/获得 (\d+) 点护盾/g, "gains $1 shield"],
  [/(\d+) 点能量/g, "$1 energy"],
  [/直线移动/g, "direct route"],
  [/自动绕障/g, "obstacle-avoiding route"],
  [/路径不可达/g, "route unreachable"],
  [/超出射程/g, "out of range"],
  [/当前玩家/g, "active player"],
  [/敌方 AURA/g, "enemy AURA"],
  [/敌方基地/g, "enemy base"],
  [/己方 AURA/g, "own AURA"],
  [/己方基地/g, "own base"],
  [/实体 AURA/g, "physical AURA"],
  [/虚拟 AURA/g, "virtual AURA"],
  [/赤曜阵营/g, "Crimson"],
  [/蓝穹阵营/g, "Azure"],
  [/赤曜/g, "Crimson"],
  [/蓝穹/g, "Azure"],
  [/中文名称/g, "Chinese or English name"],
  [/双击查看大图/g, "double-click to preview"],
  [/机器人模式/g, " robot mode"],
  [/卡牌预览/g, " card preview"],
  [/ 或 /g, " or "],
  [/卡面/g, " card art"],
  [/地址/g, " address"],
  [/ 至 /g, " to "],
  [/点伤害/g, "damage"],
  [/，/g, ", "],
  [/；/g, "; "],
  [/执行/g, " executed "],
  [/生命/g, " HP"],
  [/张/g, " cards"],
];

export function translateText(source: string, locale: Locale): string {
  if (locale === "zh-CN" || !source.trim()) return source;
  const leading = source.match(/^\s*/)?.[0] ?? "";
  const trailing = source.match(/\s*$/)?.[0] ?? "";
  const end = source.length - trailing.length;
  const core = source.slice(leading.length, end);
  let translated = exact[core] ?? core;
  if (translated === core) {
    for (const [pattern, replacement] of replacements) translated = translated.replace(pattern, replacement);
  }
  return `${leading}${translated}${trailing}`;
}

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (zh: string, en: string) => string;
};

const LocaleContext = createContext<LocaleContextValue>({ locale: DEFAULT_LOCALE, setLocale: () => undefined, t: (zh) => zh });
const originalText = new WeakMap<Text, string>();
const appliedText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const appliedAttributes = new WeakMap<Element, Map<string, string>>();
const translatedAttributes = ["aria-label", "title", "placeholder", "alt"] as const;

function translateNode(root: Node, locale: Locale) {
  const translateTextNode = (node: Text) => {
    const previous = originalText.get(node);
    const current = node.nodeValue ?? "";
    const original = previous !== undefined && current === appliedText.get(node) ? previous : current;
    originalText.set(node, original);
    const next = translateText(original, locale);
    appliedText.set(node, next);
    if (current !== next) node.nodeValue = next;
  };
  const translateElement = (element: Element) => {
    const originals = originalAttributes.get(element) ?? new Map<string, string>();
    const applied = appliedAttributes.get(element) ?? new Map<string, string>();
    for (const attribute of translatedAttributes) {
      const current = element.getAttribute(attribute);
      if (current == null) continue;
      const previous = originals.get(attribute);
      const original = previous !== undefined && current === applied.get(attribute) ? previous : current;
      originals.set(attribute, original);
      const next = translateText(original, locale);
      applied.set(attribute, next);
      if (current !== next) element.setAttribute(attribute, next);
    }
    originalAttributes.set(element, originals);
    appliedAttributes.set(element, applied);
  };
  if (root.nodeType === Node.TEXT_NODE) translateTextNode(root as Text);
  if (root.nodeType === Node.ELEMENT_NODE) translateElement(root as Element);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) translateTextNode(node as Text);
    else translateElement(node as Element);
    node = walker.nextNode();
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(
    (notify) => {
      window.addEventListener(CHANGE_EVENT, notify);
      window.addEventListener("storage", notify);
      return () => { window.removeEventListener(CHANGE_EVENT, notify); window.removeEventListener("storage", notify); };
    },
    () => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored === "en-US" || stored === "zh-CN" ? stored : DEFAULT_LOCALE;
    },
    () => DEFAULT_LOCALE,
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
    document.title = locale === "en-US" ? "AURA: Dual-Core Protocol" : "AURA：双核协议";
    translateNode(document.body, locale);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") translateNode(mutation.target, locale);
        for (const node of mutation.addedNodes) translateNode(node, locale);
        if (mutation.type === "attributes") translateNode(mutation.target, locale);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...translatedAttributes] });
    return () => observer.disconnect();
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale, t: (zh, en) => locale === "en-US" ? en : zh }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function LanguageSwitch() {
  const { locale, setLocale } = useLocale();
  return <div className="language-switch" role="group" aria-label="界面语言">
    <button type="button" className={locale === "zh-CN" ? "active" : ""} aria-pressed={locale === "zh-CN"} onClick={() => setLocale("zh-CN")}>中</button>
    <button type="button" className={locale === "en-US" ? "active" : ""} aria-pressed={locale === "en-US"} onClick={() => setLocale("en-US")}>EN</button>
  </div>;
}
