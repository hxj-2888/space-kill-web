/* AI 决策与推理链规格实现（v21 规格落地）
   记事本(事实) → 推理链 R1~R41 → E 三通道证据分(只增不减/硬源override/并罚按独立源) 
   → 怀疑度分布 S(p_human,p_alien,p_king) / 独立危险度 Dg → 效用函数 → ε-greedy
   对齐《太空杀·怀疑度与危险度 审查报告与修改规格 v21》：西塔三档 / E 先验(28.6/21.4/50) /
   宣称×0.85衰减·事实不衰减 / 可信度C / 活跃度只进Dg / ε=0.4主干·0.15生存 */
(function (global) {

  /* ============ 分层完成：本文件只剩门面（v27 模块化第三批）============
     js/ai/util.js      共享工具与跨层常量（clamp/alive/aliveF/byId/isAlly/pick/gauss/knownOf；BAND_DOWN/GRUDGE_W）
     js/ai/belief.js    证据账本与估值数学（project / suspOf / dangerOf / addEvent / capability …）
     js/ai/perceive.js  事件入账（onAccuse / onClaim / onReveal / reason / emitKingSignals …）
     js/ai/decide.js    决策（speak / vote / decide / argmax / urgency …）

     本文件只做别名转发：AI.* 的对外接口与全部调用点零改动。
     依赖方向（单向，无环）：util → belief → perceive → decide → ai（门面） */
  const U = global.AIUtil, BEL = global.AIBelief, PER = global.AIPerceive, DEC = global.AIDecide;
  /* 工具与跨层常量 */
  const clamp = U.clamp, alive = U.alive, aliveF = U.aliveF, byId = U.byId;
  const isAlly = U.isAlly, pick = U.pick, gauss = U.gauss, knownOf = U.knownOf;
  const BAND_DOWN = U.BAND_DOWN, GRUDGE_W = U.GRUDGE_W;
  /* 估值层 */
  const ROLE2FACTION = BEL.ROLE2FACTION, FACTION_SET = BEL.FACTION_SET;
  const CLAIM_DECAY = BEL.CLAIM_DECAY, GRUDGE_DECAY = BEL.GRUDGE_DECAY;
  const DG_W = BEL.DG_W, TIER_BY_VAL = BEL.TIER_BY_VAL;
  const priorOf = BEL.priorOf, ensureE = BEL.ensureE, actF = BEL.actF, claimDecay = BEL.claimDecay;
  const credOf = BEL.credOf, credAdd = BEL.credAdd, setHardFloor = BEL.setHardFloor, chanFor = BEL.chanFor;
  const knownLockOf = BEL.knownLockOf, project = BEL.project;
  const addUniversal = BEL.addUniversal, universalOf = BEL.universalOf, hostileOf = BEL.hostileOf;
  const suspOf = BEL.suspOf, suspDist = BEL.suspDist, dangerOf = BEL.dangerOf, capability = BEL.capability;
  const addEvent = BEL.addEvent, once = BEL.once;
  /* 入账层 */
  const onClaim = PER.onClaim, holds = PER.holds, adjudicate = PER.adjudicate;
  const grudgeLevel = PER.grudgeLevel, phaseTag = PER.phaseTag, settleClaims = PER.settleClaims;
  const onAccuse = PER.onAccuse, onExpose = PER.onExpose, onReveal = PER.onReveal, reason = PER.reason;
  const updatePublicThreat = PER.updatePublicThreat, onAsk = PER.onAsk, onQuote = PER.onQuote;
  const answerQuestion = PER.answerQuestion, evaluateAnswer = PER.evaluateAnswer;
  const onReport = PER.onReport, onCheckClaim = PER.onCheckClaim, emitKingSignals = PER.emitKingSignals;
  const onPrivate = PER.onPrivate, onPrivateShare = PER.onPrivateShare;
  const onVoteSettle = PER.onVoteSettle, settlePromises = PER.settlePromises;
  /* 决策层 */
  const urgency = DEC.urgency, exposedEngineer = DEC.exposedEngineer, EPS = DEC.EPS;
  const knownRepairers = DEC.knownRepairers;      // v28（B1）：对手方维修能力估计（破坏效用的阻力项）
  const confOf = DEC.confOf, argmax = DEC.argmax, speak = DEC.speak, evilIntent = DEC.evilIntent;
  const argmaxProtect = DEC.argmaxProtect;   // v31 批 3.5（N417）：保护型选择入口（下界硬约束 ≥5%）
  const vote = DEC.vote, inviteUtility = DEC.inviteUtility, decide = DEC.decide;
  const canKill = DEC.canKill, clearedK = DEC.clearedK, threatTop = DEC.threatTop;
  const dirOcc = DEC.dirOcc, exposeRiskInc = DEC.exposeRiskInc, rankLow = DEC.rankLow;
  global.AI = {
    decide, speak, vote, threatOf: suspOf, suspOf, suspDist, dangerOf, onAccuse, onClaim, onReveal, reason, updatePublicThreat, onExpose,
    onVoteSettle, addEvent,
    onAsk, onQuote, onReport, onCheckClaim, onPrivate, onPrivateShare,
    answerQuestion, evaluateAnswer,
    setHardFloor, credAdd, priorOf, holds, adjudicate, grudgeLevel, phaseTag, addUniversal, universalOf, settleClaims,
    settlePromises,   // v31 批 2：门面此前漏导出（函数已声明、engine 直连 perceive，但门面无此接口）
    /* v31 批 0（命名污染清理）：删除 `threatOf: suspOf` 别名——它名字叫「威胁度」，实际返回的是
       怀疑度（认知层量）。行动层读的是 dangerOf：改动若按字面意思找「威胁度逻辑」会找错地方。
       调用点（ui/view 的 DEV 面板）已改为显式 suspOf。 */
    inviteUtility, alive, aliveF, byId, knownFaction: knownOf, knownRepairers, sus: (g, me, t) => suspOf(g, me, t.id),
    /* v31 批 3.5（人类侧保护专项）：N417 下界硬约束的入口 + 其对照物（供回归断言与审计读取） */
    argmax, argmaxProtect, confOf, EPS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
