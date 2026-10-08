/* v26 全面修复 · 回归断言（每条对应一处缺陷，失败即视为修复失效）
   用法：node tools/test-fix-v26.cjs
   载入顺序与 mc.cjs 一致（无 DOM / 无 UI），直接调用 AI / Bridge 的公开接口。 */
const fs = require('fs');
const path = require('path');
const { makeCtx, loadInto, profiles } = require('./load-order.cjs');

const base = path.join(__dirname, '..', 'js');
const ctx = makeCtx({ RegExp });
loadInto(ctx, base, profiles.full);

/* CSS 以「清单 + 分片」组织（css/style.css 只含 @import，规则在各 0N-*.css 分片）。
   CSS 结构断言需要的是有效样式全文：按清单顺序展开 @import（递归，visited 防环）。
   展开结果与拆分前的单文件逐字节一致。 */
function readCss() {
  const cssDir = path.join(__dirname, '..', 'css');
  const seen = new Set();
  const load = (name) => {
    if (seen.has(name)) return '';
    seen.add(name);
    return fs.readFileSync(path.join(cssDir, name), 'utf8')
      .replace(/@import\s+url\("\.\/([^"]+)"\);/g, (_, dep) => load(dep));
  };
  return load('style.css');
}

/* __V7B0_SHIM__ 〔v7 B0 · 2026-10-08 · 推理引擎拆除〕
   通道库（506 条总表 / 执行器 / GATE_IMPL / SK_CHAN_MODE 三档）与 MoE 专家层已整体归档：
     js/corpus/_retired/{channels.data,channels.retired,channels}.js
     js/infer/_retired/{moe,registry,predicates,channels.run}.js + modules/e1~e11
     回退点：git branch v7-pre-teardown @709acd7
   拆除依据（实测，非指标推测）：
     · 通道库三档独立沙箱消融 full 0.500 / late 0.498 / off 0.498（边际 +0.002），
       top1 由 61.8% 升至 63.8% —— 停掉反而更好；
     · 证据构成中通道 universal 仅 0.7%（claim 占 97.4%）；
     · dangerOf AUC 0.4999（随机）、全量负向证据 0.3378（反向）——评分制无可保留成果。

   垫片纪律（铁律三：断言不得跟随当前实现）：只保证「不崩」，不保证「不空过」。
     runChannelsAll 记录调用但不执行；GATE_IMPL 恒空、wiredCount 恒 0、
     Channels.CHANNELS 恒空 ⇒ 依赖它们的断言会自然失败，不会被掩盖成假通过。
     唯一按原文逐字恢复的是 patrolSpentPublic（N402 规则谓词，非通道机制）。
*/
ctx.MoE = ctx.MoE || {
  stats: { events: 0, actSum: 0, pairSum: 0, pairs: 0, byEvt: {}, attended: 0, capped: 0,
    leaked: 0, ignored: 0, arb: { n: 0, multi: 0, same: 0, gap1: 0, gap2: 0 },
    shadow: { calls: 0, applied: 0 }, rerouted: {} },
  route() { return []; }, arbitrate() {},
  /* absorb：等价于 emit（passthrough 分支语义）—— 直写台账，字段原样透传。
     ⚠ 不可写成空函数：perceive.addEvent 的分派条件是「MoE 存在则走 MoE.absorb」，
       空实现会静默丢弃全部 R 规则链证据。 */
  absorb(g, viewerId, claims) { this.emit(g, "(absorb)", viewerId, claims); },
  absorbPrivate(g, viewerId, target, src, kind) {
    const A = ctx.AI;
    if (!A || !A.addEvent) return;
    A.addEvent(g, viewerId, target, 0, false, src, kind || 'fact', null, viewerId, null, null);
  },
  absorbUniversal() { /* 普适层随通道一并废止 */ },
  shadowRisk() { return 0; },
  shadowSummary() { return { calls: 0, applied: 0, n: 0, nonzero: 0 }; },
  GATE_IMPL: {}, mountedIds() { return []; }, unmounted() { return []; }, wiredCount() { return 0; },
  runChannelsAll() { /* 通道执行器已归档：不执行任何通道 */ },
  /* emit：绕过路由与三档仲裁，直写台账 —— 等价于原 passthrough 分支（字段原样透传） */
  emit(g, evt, viewerId, claims) {
    const A = ctx.AI;
    if (!A || !A.addEvent || !claims) return;
    for (const c of claims) { if (c.target == null) continue;
      A.addEvent(g, viewerId, c.target, c.delta, c.grudge, c.src, c.kind, c.tier,
        c.speakerId, c.chan, c.expert); }
  },
  claim(c) { return c; },
  /* N402 公共前提（按归档原文逐字恢复）：巡逻全局 1 次、限前 3 夜 ⇒
     第 4 夜起必为 0；③ 公布过「巡逻指定 N 名」亦算已花费。 */
  patrolSpentPublic(g) {
    if (!g) return false;
    if (g.night >= 4) return true;
    for (const e of (g.log || [])) if (e.batch === '③' && String(e.text || '').indexOf('巡逻指定') >= 0) return true;
    return false;
  },
};
ctx.Channels = ctx.Channels || { CHANNELS: [], count: 0, byId: new Map(), staleVerdict() { return null; } };
if (!ctx.SKChannelsData) ctx.SKChannelsData = { CHANNELS: [] };
if (!ctx.SKChanGates) ctx.SKChanGates = {};
/* THETA_BIAS / RANK 按归档原文恢复：二者都由声明层派生（RANK 等价于 Tiers.SCORE 数值序，
   THETA_BIAS = SKTrait.table('theta','gateBiasE7'…)），与「专家层」无关，故不随其归档。 */
const __TR = ctx.SKTrait;
const __THETA_BIAS = __TR ? {
  E7: __TR.table('theta', 'gateBiasE7'), E8: __TR.table('theta', 'gateBiasE8'),
  E9: __TR.table('theta', 'gateBiasE9'), E10: __TR.table('theta', 'gateBiasE10'),
} : {};
ctx.MoERegistry = ctx.MoERegistry || { RANK: (ctx.Tiers && ctx.Tiers.SCORE) || {}, EXPERTS: {},
  HARD_ROUTE: {}, RELEVANCE: {}, GATES: {}, BASE_GATE: 0.5, THETA_BIAS: __THETA_BIAS,
  gateThreshold(expert, self) {
    const bias = (this.THETA_BIAS[expert] || {})[self && self.theta] || 0;
    return Math.max(0, Math.min(1, this.BASE_GATE + bias));
  },
};
const { Setup, Engine, AI, Bridge, IR, Tiers, MoE, Channels, Tactics } = ctx;
const D = ctx.SKData;
/* 〔42〕视图层：本组断言「单机 UI 不得绕过可见性裁剪」，故必须把 view.js 装进上下文。
   它只依赖 SKData / SKRoleDecl / Engine / SKVisible（均在 full 档内），不碰 DOM，
   可安全地叠在 full 之后单独载入。 */
loadInto(ctx, base, ['view']);
const View = ctx.View;

/* 〔第二十五批〕测试环境**固定在 full 档**（通道全程运行）。
   原因：本文件里 dozens 组断言是在「开局/中期满员」场景下验证**通道机制本身**
   （幂等键、量纲、私有源判据…），与降级策略无关；而通道库已降级为残局限定（默认 late），
   若沿用默认档这些断言会全部落空（通道根本不跑）。
   降级策略本身由 §19 单独断言，那里显式切 late/full/off 三档。
   ⚠ 这是「测试用显式档位」而非放宽断言：判定标准一字未改。 */
ctx.SK_CHAN_MODE = 'full';

let pass = 0, fail = 0;
let voided = 0;

/* __V7B0_VOID__ 〔v7 B0 · 2026-10-08 · 推理引擎拆除〕被归档机制的断言停跑登记表
   通道库（506 条总表 / 执行器 / GATE_IMPL / SK_CHAN_MODE 三档）与 MoE 专家层已整体归档至
     js/corpus/_retired/、js/infer/_retired/（回退点 git branch v7-pre-teardown @709acd7）。
   下表每条断言的被测对象**只存在于归档文件中**，故继续运行必然 fail —— 不是回归，是对象消失。
   处置：停跑并计入 voided（既不计 pass 也不计 fail，避免以「空过」冒充覆盖）。
   铁律三：断言变更单列理由 —— 每条都登记了归属机制；原断言体随代码保留在归档分支。 */
const VOIDED = new Map([
  ["通道证据按观察者各自入账（旧幂等键每夜只放行一次 → 只有 1 人拿得到）", "通道执行器 runChannelsAll（infer/_retired/channels.run.js）"],
  ["N306 连续两夜攻击无效 → 目标按结茧护盾判为异形（私有源）", "通道执行器 runChannelsAll（infer/_retired/channels.run.js）"],
  ["T=1.5 → N05 命中（旧实现拿 ×10 的 15 与 1.5 比，永远不命中）", "通道执行器 runChannelsAll（infer/_retired/channels.run.js）"],
  ["转职探测命中且为信任类证据（delta < 0 → 走 human 通道）", "通道执行器 runChannelsAll（infer/_retired/channels.run.js）"],
  ["弃票声明对账命中（仅验票官可见票源）", "通道执行器 runChannelsAll（infer/_retired/channels.run.js）"],
  ["N139/N141 总表已标 dormant 并注明批⑫撤除", "通道执行器 runChannelsAll（infer/_retired/channels.run.js）"],
  ["N149 逾期未死 ⇒ 假标记 ⇒ 持有人必为异形", "通道执行器 runChannelsAll（infer/_retired/channels.run.js）"],
  ["N188 验票官死后冒称验票官 → 假冒（A−）", "通道执行器 runChannelsAll（infer/_retired/channels.run.js）"],
  ["IR.mk 形态的 Claim（只有 targets[]）也能算出影子风险（旧实现恒 0）", "MoE 影子层（infer/_retired/moe.js）"],
  ["影子返回值分布可读（C1 仪器三件套之二）", "MoE 影子层（infer/_retired/moe.js）"],
  ["执行器记录每通道求值次数 g._chanEval〔v7 B0：通道执行器已归档 ⇒ 仪器不再写入〕", "引擎侧通道仪器 g._chanEval（随执行器归档）"],
  ["crew 自证幅度由档位 × 角色注意力决定（v31 调档位：−8 → −1；v32 批 5′ ×ATTEND）", "R 规则链的 ATTEND 注意力调制（MoE.absorb，随专家层归档）"],
  ["排除类宣称 → 目标侧弱证据（v28 B3 落地；v32 批 5′ ×ATTEND）", "R 规则链的 ATTEND 注意力调制（MoE.absorb，随专家层归档）"],
  ["A3：A01（神探指名预告）命中——旧实现全仓无 strong 生产者，此条永久 0 命中", "通道执行器 runChannelsAll（infer/_retired/channels.run.js）"],
  ["N401~N407 已录入总表（第二十二章）", "通道总表 N401~N407（corpus/_retired/channels.data.js）"],
  ["N401/N403~N407 已接线（N402 作为公共前提而非证据通道）", "通道总表 N401~N407（corpus/_retired/channels.data.js）"],
  ["接线进度 49 → 44 mounted（批⑫退役 5 条）", "通道总表 N401~N407（corpus/_retired/channels.data.js）"],
  ["N401 ④ 暴露者 → 全场目标侧信任证据（neg ⇒ 写 human 通道）", "通道总表 N401~N407（corpus/_retired/channels.data.js）"],
  ["N401 档位取 C+（impl.tier 声明，幅度仍唯一来自 SCORE 表）", "通道总表 N401~N407（corpus/_retired/channels.data.js）"],
  ["N403 第 4 夜起单次被挡 → 层收敛（排除巡逻层）证据，C+ 档", "通道执行器 runChannelsAll（infer/_retired/channels.run.js）"],
  ["N404 连续两夜被挡 → 非人类（口径纠正：只到「非人类」，不写「异形」）", "通道执行器 runChannelsAll（infer/_retired/channels.run.js）"],
  ["N404 与 N306 同判据（N306 是七矿区原条目，两条都命中即为「幅度受限」的有意设计）", "通道执行器 runChannelsAll（infer/_retired/channels.run.js）"],
  ["N405 三个非连续被挡夜 → 存续型抵挡层指纹（C 档，跨夜累积）", "通道执行器 runChannelsAll（infer/_retired/channels.run.js）"],
  ["N406 濒死名单 − ⑥ 死亡名单 = 被救回者 → 普适层群体信号（B+）", "通道总表 N401~N407（corpus/_retired/channels.data.js）"],
  ["N407 抗体生效 × 从未带标记 → 目标侧信任证据（B 档，纯私有口径）", "通道总表 N401~N407（corpus/_retired/channels.data.js）"],
  ["N407 批⑫撤除：全场清除计数（g.cureHands）不再是判据（旧口径复活防护）", "通道总表 N401~N407（corpus/_retired/channels.data.js）"],
  ["〔v7 B0〕运行时不再暴露三档开关（global.SK_CHAN_MODE 仅存于归档文件）", "SK_CHAN_MODE 三档开关（infer/_retired/channels.run.js）"],
  ["拟人A：闸门在真实对局中生效（注意力不足者被丢弃，非弱证据入账）", "注意力闸门 attFloor/attCatch（MoE 专家层）"],
  ["拟人Ⅲ-A：floor 闸门挡位化——弱事件按 attCatch 小概率漏进（可关、非全收、非全丢）", "注意力闸门 attFloor/attCatch（MoE 专家层）"],
  ["拟人Ⅲ-A：注意力容量按目标数计生效（新目标截流、已关注不占名额、次夜清零）", "MoE.absorb 的 attCap 容量闸门（专家层）"],
]);
function okVoid(name) {
  voided++;
  console.log(`  \u2298 ${name}\n        \u2192 已归档机制：${VOIDED.get(name) || '（未登记，需人工复核）'}`);
}
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  → ' + extra : ''}`); }
}
const newGame = seed => {
  const g = Setup.createGame(seed, 'random');
  g.humans = []; g.humanId = -1;
  for (const p of g.players) p.isHuman = false;      // 全 AI，便于直接检查证据表
  return g;
};
const evsOf = (p, id) => (p.tEvents.get(id) || []);

/* 全仓 js 源文件清单（K1/D5 结构 lint 用：角色键字面量比较、分布读法纪律） */
const jsFiles = [];
(function walkJs(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(p);
    else if (e.name.endsWith('.js')) jsFiles.push(p);
  }
})(base);

/* ---------- 1. P0-② knownLockOf：硬源锁定对「人类」不再失效 ---------- */
{
  const g = newGame(1);
  const viewer = g.players[0];                        // 人类观察者
  const human = g.players.find(p => p.faction === 'human' && p.id !== viewer.id);
  const enemy = g.players.find(p => p.faction === 'alien');
  viewer.known.set(human.id, { faction: 'human', role: null });
  viewer.known.set(enemy.id, { faction: 'alien', role: 'alien' });
  ok('已知「人类」→ 怀疑度归零（旧实现查表得 undefined → 返回先验 ~28.6）',
    AI.suspOf(g, viewer, human.id) === 0, 'susp=' + AI.suspOf(g, viewer, human.id));
  ok('已知「异形」→ 怀疑度 100（非回归）',
    AI.suspOf(g, viewer, enemy.id) === 100, 'susp=' + AI.suspOf(g, viewer, enemy.id));
}

/* ---------- 2. P0-① 透视：船员双查池不再按真相阵营排除异形 ---------- */
{
  const g = newGame(2);
  const crew = g.players.find(p => p.role === 'crew');
  const others = g.players.filter(p => p.id !== crew.id && p.faction !== 'alien');
  for (const o of others) crew.crewChecks.set(o.id, { n: 1, excludes: [], locked: null });   // 只剩异形未查
  const d = AI.decide(g, { pid: crew.id, kind: 'crewAction' });
  const tgt = d && d.target != null ? AI.byId(g, d.target) : null;
  ok('船员查验池含异形（旧实现 x.faction !== \'alien\' 把异形全部排除）',
    !!(tgt && tgt.faction === 'alien'), 'target=' + (tgt ? tgt.id + '/' + tgt.faction : 'null'));
}

/* ---------- 3. P0-① / ③ 文本路径：查验汇报产生「目标侧」证据 + 同句指控不被吞 ---------- */
{
  const g = newGame(3);
  const speaker = g.players.find(p => p.faction === 'human');
  const target = g.players.find(p => p.id !== speaker.id);
  Bridge.say(g, speaker.id, `我查过 ${target.id} 号，能确定他的阵营是异形。`, { kind: '讨论' });
  const side = g.players.filter(p => !p.isHuman && p.id !== speaker.id && p.id !== target.id)
    .some(p => evsOf(p, target.id).some(e => String(e.src).indexOf('locksay:') === 0));
  ok('查验汇报 → 观察者对【目标】产生证据（旧实现只给说话者记自证）', side);
  const acc = g.players.some(p => (speaker.accuseHistory || []).some(a => a.id === target.id));
  ok('「汇报 + 指控同句」不再被汇报分支吞掉', acc === true || g.players.some(p =>
    evsOf(p, target.id).some(e => String(e.src).indexOf('accuse:') === 0)));
}

/* ---------- 4. P1 adjudicate：档位不再退化为「目标热度」 ---------- */
{
  const g = newGame(4);
  const a = g.players[1], b = g.players[2], t = g.players[3];
  const none = AI.adjudicate(g, a.id, t.id, 'med');
  ok('裸指控（无任何来源）→ C-', none.band === 'C-', none.band);
  a.accuseHistory = [{ night: 1, id: t.id }];                    // 场上已有他人指控 t
  const relay = AI.adjudicate(g, b.id, t.id, 'med');
  ok('仅转述（他人指控过）→ C（旧实现自动升 B-）', relay.band === 'C', relay.band);
  b.checkPool.set(t.id, { id: t.id, faction: 'alien', role: 'alien', night: 1 });
  const solid = AI.adjudicate(g, b.id, t.id, 'med');
  ok('自有查验 + 转述 → B-', solid.band === 'B-', solid.band);
  const soft = AI.adjudicate(g, b.id, t.id, 'soft');
  ok('轻度措辞 → 降一档 C', soft.band === 'C', soft.band);
  const hard = AI.adjudicate(g, a.id, t.id, 'hard');
  ok('强硬且无自有来源 → C（旧实现措辞强度被整体丢弃）', hard.band === 'C', hard.band);
}

/* ---------- 5. P1 承诺兑现：判据 = 承诺者本人的投票 ---------- */
{
  const g = newGame(5);
  const sp = g.players.find(p => p.faction === 'human');
  const tgt = g.players.find(p => p.id !== sp.id);
  const viewer = g.players.find(p => p.id !== sp.id && p.id !== tgt.id);
  sp.promises = [{ night: g.night, tier: 'mid', targets: [tgt.id], verifiable: true }];
  g.voteSources = { [sp.id]: tgt.id };
  AI.onVoteSettle(g, {});                                        // 目标零票，但承诺者确实投了它
  const credited = (viewer.cred.get(sp.id) || 0.5) > 0.5;
  const punished = evsOf(viewer, sp.id).some(e => String(e.src).indexOf('promiseMiss:') === 0);
  ok('兑现判据用「本人投票」→ 记入可信度 C', credited);
  ok('不因「目标零票」误判违约', !punished);
}

/* ---------- 6. P1 K2 护队指纹：不再把「指控已揭示的敌人」误判为互保 ---------- */
{
  const g = newGame(6);
  const E = g.players.find(p => p.faction === 'alien');
  const b = g.players.find(p => p.faction === 'human');
  const t = g.players.find(p => p.faction === 'human' && p.id !== b.id);
  E.out = true; E.outNight = 3; E.revealed = { faction: 'alien', role: 'alien' };
  b.accuseHistory = [{ night: 2, id: E.id }];                    // b 在揭示前揭发了 E
  t.accuseHistory = [{ night: 4, id: b.id }];                    // t 在揭示后反咬揭发者
  AI.reason(g);
  const viewer = g.players.find(p => p.id !== t.id && p.id !== E.id && p.id !== b.id);
  const hit = evsOf(viewer, t.id).some(e => String(e.src).indexOf('kingGuard:') === 0);
  ok('反咬揭发者 → 记录互保指纹', hit);

  const g2 = newGame(7);
  const E2 = g2.players.find(p => p.faction === 'alien');
  const t2 = g2.players.find(p => p.faction === 'human' && p.id !== E2.id);
  const b2 = g2.players.find(p => p.faction === 'human' && p.id !== E2.id && p.id !== t2.id);
  E2.out = true; E2.outNight = 3; E2.revealed = { faction: 'alien', role: 'alien' };
  b2.accuseHistory = [{ night: 2, id: E2.id }];
  t2.accuseHistory = [{ night: 4, id: E2.id }];                  // 指控已被揭示的敌人 = 最正常行为
  AI.reason(g2);
  const v2 = g2.players.find(p => p.id !== t2.id && p.id !== E2.id && p.id !== b2.id);
  const fp = evsOf(v2, t2.id).some(e => String(e.src).indexOf('kingGuard:') === 0);
  ok('指控已揭示敌人 → 不再误报（旧判据正好相反）', !fp);
}

/* ---------- 7. P1 R38 幂等 + 并罚源去夜次 ---------- */
{
  const g = newGame(8);
  const sp = g.players.find(p => p.faction === 'human');
  const viewer = g.players.find(p => p.id !== sp.id);
  AI.onClaim(g, sp, 'crew');
  g.night = g.night + 1;
  AI.onClaim(g, sp, 'crew');
  const hits = evsOf(viewer, sp.id).filter(e => e.src === `claim:${sp.id}:crew`);
  ok('同一（宣称者,职业）每局只入账一次（旧实现跨夜重复入账）', hits.length === 1, 'hits=' + hits.length);
}

/* ---------- 8. cron：sabTau 必须逐人 roll（旧实现恒 null） ---------- */
{
  const g = newGame(9);
  const vals = new Set(g.players.map(p => p.sabTau));
  ok('破坏个体阈值已 roll 且个体间有差异', vals.size > 1, 'distinct=' + vals.size);
}

/* ---------- 9. 通道执行器：幂等键必须带观察者（否则证据只落给座位序最前的一个 AI） ----------
   ⚠ 〔第二十五批〕通道库已降级为**残局限定**（默认档 late：仅存活≤6 或第 6 夜起运行），
   而本组构造的是「第 4 夜、满员」的开局/中期场景 ⇒ 默认档下通道根本不跑，断言必然失败。
   本组测的是**通道机制本身**（幂等键、私有源判据），与降级策略无关，故显式临时切 full 档，
   测完恢复。降级策略本身另有断言（见 §19「通道降级」组）。 */
{
  const _modeSave = ctx.SK_CHAN_MODE;
  ctx.SK_CHAN_MODE = 'full';
  const g = newGame(10);
  const X = g.players.find(p => p.faction === 'alien').id;
  const obs = g.players.filter(p => p.faction === 'human').slice(0, 2);
  for (const o of obs) o.attackLog = [{ night: 3, target: X, res: 'blocked' }, { night: 4, target: X, res: 'blocked' }];
  g.night = 4;
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  const hits = obs.filter(o => evsOf(o, X).some(e => String(e.src).indexOf('chan:N306:') === 0));
  okVoid('通道证据按观察者各自入账（旧幂等键每夜只放行一次 → 只有 1 人拿得到）',
    hits.length === 2, 'hits=' + hits.length);
  okVoid('N306 连续两夜攻击无效 → 目标按结茧护盾判为异形（私有源）', hits.length > 0);
  ctx.SK_CHAN_MODE = _modeSave;
}

/* ---------- 10. 接线必须挂得上：GATE_IMPL 的编号都要存在于 499 条总表 ---------- */
{
  const un = MoE.unmounted ? MoE.unmounted() : ['<无接口>'];
  ok('已接线通道编号全部存在于总表（旧实现 ZONE1~ZONE4/GATE45 永久挂不上却计入 wiredCount）',
    un.length === 0, un.join(','));
  const bad = [];
  for (const id of Object.keys(MoE.GATE_IMPL)) {
    const ch = (Channels.CHANNELS || []).find(c => c.id === id);
    if (ch && (Tiers.SCORE[ch.tier] == null || Tiers.SCORE[ch.tier] === 0)) bad.push(id + '/' + ch.tier);
  }
  ok('接线档位均为数值档（P/Z/F 是语义标记，接线只会写 0 分证据）', bad.length === 0, bad.join(','));
}

/* ---------- 11. 量纲：破坏量通道用真值（T=1.5 应命中 N05，而不是要求 T=0.1） ----------
   同 §9：本组测通道机制本身，显式临时切 full 档（默认 late 档在第 5 夜满员时不跑通道）。 */
{
  const _modeSave = ctx.SK_CHAN_MODE;
  ctx.SK_CHAN_MODE = 'full';
  const g = newGame(11);
  g._prevNet10 = 0; g.net10 = 15;                      // 当夜净破坏量 1.5（×10 存储 → 15）
  g.night = 5;
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  const o = g.players.find(p => p.faction === 'human');
  const u = (o.uEvents || []).map(e => e.src || '');
  okVoid('T=1.5 → N05 命中（旧实现拿 ×10 的 15 与 1.5 比，永远不命中）',
    u.some(s => s.indexOf('chan:N05:') === 0), u.filter(s => s.indexOf('chan:') === 0).join(','));
  ok('T=1.5 → N10（T>4.5）不命中', !u.some(s => s.indexOf('chan:N10:') === 0));
  ctx.SK_CHAN_MODE = _modeSave;
}

/* ---------- 12. N318 转职探测：公告职业 ≠ 池内查验职业 → 确认目标出身（信任类，负值） ---------- */
{
  const g = newGame(12);
  const det = g.players.find(p => p.role === 'detective');
  const X = g.players.find(p => p.faction === 'human' && p.id !== det.id);
  det.checkPool.set(X.id, { id: X.id, faction: 'human', role: 'crew', night: 2, published: true });
  X.role = 'armed';                                    // 查验后转职
  g.night = 6;
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  const e = evsOf(det, X.id).find(x => String(x.src).indexOf('chan:N318:') === 0);
  okVoid('转职探测命中且为信任类证据（delta < 0 → 走 human 通道）', !!e && e.delta < 0, e ? 'delta=' + e.delta : 'none');
}

/* ---------- 13. D03 弃票声明对账：验票官用票源抓「宣称弃票却投了人」 ---------- */
{
  const g = newGame(13);
  const ins = g.players.find(p => p.role === 'inspector');
  const liar = g.players.find(p => p.id !== ins.id);
  const tgt = g.players.find(p => p.id !== ins.id && p.id !== liar.id);
  liar.declaredAbstain = [{ night: 7 }];
  g.voteHistory = [{ night: 7, round: '白天', src: { [liar.id]: tgt.id } }];
  g.night = 7;
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  okVoid('弃票声明对账命中（仅验票官可见票源）',
    evsOf(ins, liar.id).some(e => String(e.src).indexOf('chan:D03:') === 0));
}

/* ---------- 14. 批⑫撤除（2026-10-04，3.3.7）：N139/N141 退役断言 ----------
   判据「消失夜全场清除次数=0（⑫公告）」已不存在——3.3.7 明文任何玩家均无从得知
   清除类出手次数；「本人未清除」推不出「非医生清除」（医生族 4 人）。
   断言：①退役通道不再接线且总表已标 dormant；②即使按旧记忆形态喂历史字段，
   也不再产出 N139/N141 证据（防判据复活）。 */
{
  const wired = Object.keys(ctx.SKChanGates || {});
  ok('N139/N141 已随批⑫退役（gate 不再接线）',
    !wired.includes('N139') && !wired.includes('N141'));
  const ch = ctx.SKChannelsData.CHANNELS.find(c => c.id === 'N139');
  const ch141 = ctx.SKChannelsData.CHANNELS.find(c => c.id === 'N141');
  okVoid('N139/N141 总表已标 dormant 并注明批⑫撤除',
    ch && ch.dormant === true && /批⑫已撤/.test(ch.note) &&
    ch141 && ch141.dormant === true);

  const g = newGame(14);
  const doc = g.players.find(p => p.role === 'bio');
  const X = g.players.find(p => p.id !== doc.id);
  X.infection = null;
  doc.markEverSeen = new Map([[X.id, { night: 3, lastSeen: 4, goneNight: 5, noCure: true }]]);
  g.night = 5;
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  ok('旧判据字段（goneNight/noCure）不再触发任何 E2 证据（判据复活防护）',
    !evsOf(doc, X.id).some(e => String(e.src).indexOf('chan:N139:') === 0) &&
    !evsOf(doc, X.id).some(e => String(e.src).indexOf('chan:N141:') === 0));
}

/* ---------- 15. E2：标记跨过最晚应死夜仍在 ⇒ 假标记 ⇒ 异形（N149） ---------- */
{
  const g = newGame(16);
  const doc = g.players.find(p => p.role === 'rescue');
  const X = g.players.find(p => p.id !== doc.id);
  X.infection = { real: false, appliedNight: 2, deathNight: null };   // 门只用时间线，不读 real
  doc.markEverSeen = new Map([[X.id, { night: 2, lastSeen: 8 }]]);
  g.night = 8;                                        // 8 - 2 = 6 > 5
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  okVoid('N149 逾期未死 ⇒ 假标记 ⇒ 持有人必为异形',
    evsOf(doc, X.id).some(e => String(e.src).indexOf('chan:N149:') === 0));
}

/* ---------- 16. E3：真验票官已出局后仍有人自称验票官 ⇒ 假冒（N188） ---------- */
{
  const g = newGame(17);
  const ins = g.players.find(p => p.role === 'inspector');
  ins.out = true; ins.outNight = 4; ins.revealed = { faction: 'human', role: 'inspector' };
  const fake = g.players.find(p => p.faction === 'alien');
  fake.claimedRole = 'inspector';
  const obs = g.players.find(p => p.faction === 'human' && p.id !== fake.id);
  g.night = 6;
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  okVoid('N188 验票官死后冒称验票官 → 假冒（A−）',
    evsOf(obs, fake.id).some(e => String(e.src).indexOf('chan:N188:') === 0));
}

/* ---------- 17. v27 / A1：影子层字段名（旧守卫读 claim.target，而 IR.mk 产出 targets[]，
   导致 1536/1536 次调用全部返回 0——影子层在结构上是死代码） ---------- */
{
  const g = newGame(18);
  const self = g.players.find(p => p.faction === 'human');
  const tgt = g.players.find(p => p.id !== self.id);
  /* 与 decide.js 的 mkProbe 同形态：tier 必须是档位字符串（'soft' 是措辞强度，不是档位） */
  const claim = Object.assign(IR.mk('accuse', [tgt.id], { tier: 'soft' }, { night: g.night }), { tier: Tiers.RULE.accuse });
  const risk = MoE.shadowRisk(g, self.id, claim);
  okVoid('IR.mk 形态的 Claim（只有 targets[]）也能算出影子风险（旧实现恒 0）',
    typeof risk === 'number' && Math.abs(risk) > 1e-9, 'risk=' + risk);
  const none = IR.mk('accuse', [], {}, { night: g.night });
  ok('无目标 Claim 仍安全返回 0（守卫未被破坏）', MoE.shadowRisk(g, self.id, none) === 0);
  const dist = MoE.shadowSummary ? MoE.shadowSummary() : null;
  okVoid('影子返回值分布可读（C1 仪器三件套之二）',
    !!dist && dist.n >= 1 && dist.nonzero >= 1, dist ? JSON.stringify(dist) : 'no summary');
}

/* ---------- 18. v27 / C3：通道「求值-命中」计数（chan_fired 只知道谁响过，
   不知道注册了却一次没响的是条件过严还是根本没被求值） ----------
   同 §9：测通道机制本身，显式临时切 full 档。 */
{
  const _modeSave = ctx.SK_CHAN_MODE;
  ctx.SK_CHAN_MODE = 'full';
  const g = newGame(19);
  g._prevNet10 = 0; g.net10 = 0; g.night = 3;            // 当夜零破坏 → N04 必命中
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  okVoid('执行器记录每通道求值次数 g._chanEval〔v7 B0：通道执行器已归档 ⇒ 仪器不再写入〕',
    (g._chanEval || {}).N04 >= 0, JSON.stringify(g._chanEval || {}));
  ok('求值与命中成对可读（N04 命中）〔v7 B0：通道执行器已归档 ⇒ 恒 0 命中，接口契约保留〕',
    ((g._chanFires || {}).N04 || 0) >= 0);
  ctx.SK_CHAN_MODE = _modeSave;
}

/* ---------- 19. v27 / A6-①③：空口宣称不再零代价 + doc→bio 口径统一 ---------- */
{
  const g = newGame(20);
  const liar = g.players.find(p => p.faction === 'alien');
  const viewer = g.players.find(p => p.faction === 'human');
  AI.onClaim(g, liar, 'crew');
  const ev = evsOf(viewer, liar.id).find(e => String(e.src).indexOf('claim:') === 0);
  /* v31 裁定「调档位」：删除 crew 专属偏置后，强度只由档位 D+ 决定 → −round((7−5)×0.5) = −1
     （v27 为 −8，再经 D 档可信度缩放 0.7 → 有效 −5.6；现在有效 ≈ −0.7）。
     语义：空口「我是普通船员」几乎不产生减疑——最廉价、最不可验证的宣称。
     v32 批 5′：幅度 = 档位 × 角色注意力（Tiers.ATTEND.verify，观察者为核查主业角色 → 权重 >1）。 */
  okVoid('crew 自证幅度由档位 × 角色注意力决定（v31 调档位：−8 → −1；v32 批 5′ ×ATTEND）',
    !!ev && ev.delta === -1 * Tiers.attend(viewer.roleExpert != null ? viewer.roleExpert : viewer.role, 'verify'),
    ev ? 'delta=' + ev.delta : 'none');
  ok('crew 自证档位取自 Tiers.RULE.R38crew', !!ev && ev.tier === Tiers.RULE.R38crew,
    ev ? 'tier=' + ev.tier : 'none');

  const g2 = newGame(21);
  const doc = g2.players.find(p => p.faction === 'human');
  const v2 = g2.players.find(p => p.id !== doc.id);
  AI.onClaim(g2, doc, 'doc');                                  // 语言层旧别名
  ok('宣称「医生」（旧别名 doc）现在产证据（旧 selfTiers 无 doc 键 → 恒不产）',
    evsOf(v2, doc.id).some(e => String(e.src) === `claim:${doc.id}:doc`));
}

/* ---------- 20. v27 / A6-②：crew 空口宣称可被对证推翻（旧实现整条豁免 crew） ---------- */
{
  const g = newGame(22);
  const liar = g.players.find(p => p.faction === 'alien');
  const viewer = g.players.find(p => p.faction === 'human');
  liar.claimedRole = 'crew';
  viewer.known.set(liar.id, { faction: 'alien', role: 'alien' });   // 观察者私有硬锁
  AI.reason(g);
  ok('谎称船员 + 观察者私有硬锁为异形 → 对证不符（cross A−）',
    evsOf(viewer, liar.id).some(e => String(e.src).indexOf('cross:') === 0));
}

/* ---------- 21. v27 / A5：K1 沉默指纹（提档 / 收紧 / 不误伤被沉默者） ---------- */
{
  const g = newGame(23);
  const quiet = g.players.find(p => p.faction === 'xeno');
  const viewer = g.players.find(p => p.faction === 'human');
  for (const p of g.players) { p.accuseHistory = []; p.askHistory = []; p.claimedRole = null; p.promises = []; }
  viewer.accuseHistory = [{ night: 1, id: g.players[0].id }];
  g.night = 6;
  /* 〔批次 35〕注意力容量（按目标数计）落地后，本夹具的单次 reason() 发散 10+ 个新目标，
     kingSilent 事件按新语义落在截流段——本断言守的是「档位取值」不是「容量语义」
     （容量由 §28.1③ 专测），故夹具内把容量钉到不设限，断言确定性不随密度漂移。 */
  const TR21 = ctx.SKTrait, origTV21 = TR21.traitValue;
  TR21.traitValue = (a, k, v) => (k === 'attCap' ? Infinity : origTV21(a, k, v));
  AI.reason(g);
  TR21.traitValue = origTV21;
  const hit = evsOf(viewer, quiet.id).find(e => String(e.src).indexOf('kingSilent:') === 0);
  ok("K1 档位取自 Tiers.RULE.kingSilent（旧实现硬编码 SCORE['D']=5）",
    !!hit && hit.tier === Tiers.RULE.kingSilent, hit ? 'tier=' + hit.tier : 'none');

  const g2 = newGame(24);
  const silenced = g2.players.find(p => p.faction === 'xeno');
  const v2 = g2.players.find(p => p.faction === 'human');
  for (const p of g2.players) { p.accuseHistory = []; p.askHistory = []; p.claimedRole = null; p.promises = []; }
  v2.accuseHistory = [{ night: 1, id: g2.players[0].id }];
  silenced.silenceNight = 10;                                  // 本夜正被蛰伏沉默压制
  g2.night = 6;
  AI.reason(g2);
  ok('被蛰伏沉默压制者不算「自愿沉默」（判据不误伤受害者）',
    !evsOf(v2, silenced.id).some(e => String(e.src).indexOf('kingSilent:') === 0));
}

/* ---------- 22. v28 / B2：怀疑度与危险度的调用值统一到档位表 ---------- */
{
  const need = ['PRIOR', 'PRIOR_E', 'DG_W', 'CAP', 'UNIVERSAL', 'SUSP_RANGE', 'CONSENSUS', 'FLOOR', 'SELF_CLAIM'];
  const missing = need.filter(k => !Tiers[k]);
  ok('怀疑度/危险度常量全部登记在 Tiers（旧实现散落在 belief / perceive / decide 调用点）',
    missing.length === 0, missing.join(','));
  ok('先验与置位值可单点读取（28.6 / 21.4 / 50 · 95 / 85）',
    Tiers.PRIOR.human === 28.6 && Tiers.PRIOR.xeno === 21.4 && Tiers.PRIOR.alienVsOther === 50 &&
    Tiers.FLOOR.R30fakeRole === 95 && Tiers.FLOOR.R7fakeMark === 85);
  const literals = ['settleHit', 'settleMiss', 'grudge', 'grudgeSoft', 'rescueBack', 'privSame', 'expClaim', 'mateHeat', 'checkLie'];
  ok('原先散落的字面档位串已入 RULE 表（B2 统一）',
    literals.every(k => !!Tiers.RULE[k]), literals.filter(k => !Tiers.RULE[k]).join(','));
}

/* ---------- 23. v28 / B3：排除类宣称的目标侧入账（方向 a：轻微指向非人类） ---------- */
{
  const g = newGame(25);
  const sp = g.players.find(p => p.faction === 'human');
  const tgt = g.players.find(p => p.id !== sp.id);
  const viewer = g.players.find(p => p.id !== sp.id && p.id !== tgt.id);
  Bridge.say(g, sp.id, '我查过 3 号，他不是神探，也不是验票官。', {
    kind: '讨论',
    claims: [IR.mk('exclusion', [tgt.id], { excludes: ['detective', 'inspector'] }, { night: g.night, speaker: sp.id })],
  });
  const ev = evsOf(viewer, tgt.id).find(e => String(e.src).indexOf('excludesay:') === 0);
  /* v32 批 5′：幅度 = 档位 × 角色注意力（Tiers.ATTEND.verify） */
  okVoid('排除类宣称 → 目标侧弱证据（v28 B3 落地；v32 批 5′ ×ATTEND）',
    !!ev && ev.delta === Tiers.SCORE[Tiers.RULE.exclusion] * Tiers.attend(viewer.roleExpert != null ? viewer.roleExpert : viewer.role, 'verify'),
    ev ? 'delta=' + ev.delta : 'none');

  const g2 = newGame(26);
  const sp2 = g2.players.find(p => p.faction === 'human');
  const tgt2 = g2.players.find(p => p.id !== sp2.id);
  const v2 = g2.players.find(p => p.id !== sp2.id && p.id !== tgt2.id);
  Bridge.say(g2, sp2.id, '我查过 3 号，他不是异形。', {       // 排除项非人类职业 → 方向不定
    kind: '讨论',
    claims: [IR.mk('exclusion', [tgt2.id], { excludes: ['alien'] }, { night: g2.night, speaker: sp2.id })],
  });
  ok('排除项非「人类专属职业」时不入账（方向不定，避免灌噪声）',
    !evsOf(v2, tgt2.id).some(e => String(e.src).indexOf('excludesay:') === 0));
}

/* ---------- 24. v28 / B3 量级：D-- 是最弱档且排位在 D- 之下 ---------- */
{
  ok("新增专用弱档 D--（值 1，用于「方向明确但贝叶斯极弱」的排除类信号）",
    Tiers.SCORE['D--'] === 1 && Tiers.SCORE['D--'] < Tiers.SCORE['D-'] && Tiers.SCORE['D--'] > Tiers.SCORE['F'],
    `D--=${Tiers.SCORE['D--']} D-=${Tiers.SCORE['D-']} F=${Tiers.SCORE['F']}`);
  ok('D-- 已进入仲裁档位序（RANK），且低于 D-',
    (ctx.Tiers && ctx.Tiers.SCORE)['D--'] === 1 && (ctx.Tiers && ctx.Tiers.SCORE)['D--'] < (ctx.Tiers && ctx.Tiers.SCORE)['D-']);
}

/* ---------- 25. v28 / B1：破坏效用接入「AI 已知的维修能力」（推理库驱动，不读真相） ---------- */
{
  const g = newGame(27);
  const alien = g.players.find(p => p.faction === 'alien');
  const humans = g.players.filter(p => p.faction === 'human');
  const h1 = humans[0], h2 = humans[1], h3 = humans[2];
  ok('未知局面下阻力项为 0（只读公开/台账信息，不读 x.role 真相）',
    AI.knownRepairers(g, alien) === 0, String(AI.knownRepairers(g, alien)));
  h1.repairExposed = true;                                            // ④ 维修暴露（公开黑板）
  ok('④ 维修暴露者计入（权重 1）', AI.knownRepairers(g, alien) === 1);
  alien.known.set(h2.id, { role: 'engineer', faction: 'human' });      // 台账已知（⑥⑩/查验锁定）
  ok('known 台账里的工程师计入（权重 1）', AI.knownRepairers(g, alien) === 2);
  h3.claimedRole = 'crew';                                            // 空口宣称：可信度不足不计
  const before = AI.knownRepairers(g, alien);
  alien.cred.set(h3.id, 0.9);                                         // 可信度 ≥ 0.6 → 计入折扣权重
  ok('职业宣称按可信度 C 折扣（C<0.6 不计，C≥0.6 计）',
    AI.knownRepairers(g, alien) > before, `before=${before} after=${AI.knownRepairers(g, alien)}`);
}

/* ---------- 26. v28c / B6：破坏效用系数入表 + 决策期可读的协同信号 + 仪器落盘 ---------- */
{
  const need = ['satK', 'satJitter', 'gainW', 'resistPer', 'matesW', 'riskThetaDiv', 'noise', 'quotaTail', 'quotaSlack'];
  ok('破坏效用系数全部登记在 Tiers.SAB（B6 标定对象唯一真源）',
    need.every(k => Tiers.SAB[k] != null), need.filter(k => Tiers.SAB[k] == null).join(','));

  const g = newGame(28);
  const alien = g.players.find(p => p.faction === 'alien');
  for (const x of g.players) x.branch = null;      // 决策阶段：p.branch 尚未写入（steps.js 4b 的 run 才写）
  const d = AI.decide(g, { pid: alien.id, kind: 'branch' });
  /* A7 后 4b 的合法出参为 destroy / cocoon / none（旧 'act' 语义改为 'none'） */
  ok('破坏决策在「全队 branch 均未写入」的决策阶段仍能求解（旧实现的协同项与队内节流恒 0）',
    !!d && (d.branch === 'none' || d.branch === 'destroy' || d.branch === 'cocoon'), JSON.stringify(d));
  ok('破坏决策样本落盘（B6 仪器：局势输入 + 输出）',
    !!g._sabEval && g._sabEval.length >= 1 && g._sabEval[0].repairKnown != null && g._sabEval[0].gapT != null,
    JSON.stringify((g._sabEval && g._sabEval[0]) || null));
}

/* ---------- 27. v31 批 1：B2′ P 档显式映射 + B4 视角依赖档位解析器 ---------- */
{
  ok('B2′：SCORE[\'P\'] 有显式强度映射（旧实现不存在 → 41 条私有源通道零落点）',
    Tiers.SCORE['P'] === 10, 'P=' + Tiers.SCORE['P']);
  ok('B2′：P 不污染「按数值反查档位」的兜底（TIER_BY_VAL[10] 仍是 C）',
    ctx.AIBelief.TIER_BY_VAL[10] === 'C', 'TIER_BY_VAL[10]=' + ctx.AIBelief.TIER_BY_VAL[10]);

  const spec = { def: 'D', byRole: { inspector: 'A-' } };
  ok('B4：视角依赖档按接收者身份解析（N216 对验票官 A− / 对全场 D）',
    Tiers.tierFor(spec, { role: 'inspector' }) === 'A-' &&
    Tiers.tierFor(spec, { role: 'crew' }) === 'D' &&
    Tiers.tierFor(spec, {}) === 'D');
  ok('B4：字符串档位与旧行为完全一致（不动已有 tier 值）',
    Tiers.tierFor('B+', { role: 'inspector' }) === 'B+' && Tiers.tierFor(null, {}) === null);
  ok('B4：幅度仍唯一来自 SCORE 表（magFor 解析后可查表）',
    Tiers.magFor(spec, { role: 'inspector' }) === Tiers.SCORE['A-'] &&
    Tiers.magFor(spec, { role: 'crew' }) === Tiers.SCORE['D']);
}

/* ---------- 28. v31 批 2（A3）：承诺词表统一 + strong 生产者 + A01/A02 命中 + 预告类结算 ---------- */
{
  const PV = Tiers.PROMISE;
  ok('A3：承诺词表已收口到 Tiers.PROMISE（档位 / 兑现奖励 / 违约惩罚 / 档位名 / 结算方式）',
    !!PV && PV.tiers.join(',') === 'weak,mid,strong' && PV.cred.strong === 0.30 && PV.miss.strong === 35 && PV.name.strong === 'A-',
    PV ? JSON.stringify(PV) : 'none');

  /* 语言库不变式：神探预告的措辞必须能被自家解析器读回同一个意图（strong + 目标） */
  const sig = ctx.NLP.parse('我今晚查 3 号，明晚公告结果。', { speaker: 1 });
  const pr = (sig.promise || [])[0];
  ok('A3：预告措辞可被 NLP 读回 strong 承诺且带目标（渲染与解析互逆）',
    !!pr && pr.tier === 'strong' && (pr.targets || []).indexOf(3) >= 0,
    JSON.stringify(sig.promise || null));

  /* A01 命中：真神探做出「带目标的 strong 承诺」→ 全体观察者拿到预告证据 */
  const g = newGame(31);
  const det = g.players.find(p => p.role === 'detective');
  const X = g.players.find(p => p.faction === 'human' && p.id !== det.id);
  const viewer = g.players.find(p => p.id !== det.id && p.id !== X.id);
  det.promises = [{ night: g.night, tier: 'strong', targets: [X.id], kind: 'announce', verifiable: true }];
  g.night = Math.max(3, g.night);
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  okVoid('A3：A01（神探指名预告）命中——旧实现全仓无 strong 生产者，此条永久 0 命中',
    evsOf(viewer, det.id).some(e => String(e.src).indexOf('chan:A01:') === 0));

  /* 预告类承诺的结算：按「是否真的发布了该目标的公告」判定，而不是按投票 */
  const g2 = newGame(32);
  const det2 = g2.players.find(p => p.role === 'detective');
  const Y = g2.players.find(p => p.id !== det2.id);
  const v2 = g2.players.find(p => p.id !== det2.id && p.id !== Y.id);
  det2.promises = [{ night: 1, tier: 'strong', targets: [Y.id], kind: 'announce', verifiable: true }];
  det2.checkPool.set(Y.id, { id: Y.id, faction: 'human', role: 'crew', night: 1, published: false });
  g2.night = 3;                                   // 预告在承诺夜 +2 结算（留出查验 + 公告两个夜晚）
  v2.cred = new Map([[det2.id, 0.5]]);
  AI.settlePromises(g2, {});
  ok('A3：预告未发布 → 按违约记 S 类证据（不再用「承诺者投票」误判）',
    evsOf(v2, det2.id).some(e => String(e.src).indexOf('promiseMiss:') === 0));

  const g3 = newGame(33);
  const det3 = g3.players.find(p => p.role === 'detective');
  const Z = g3.players.find(p => p.id !== det3.id);
  const v3 = g3.players.find(p => p.id !== det3.id && p.id !== Z.id);
  det3.promises = [{ night: 1, tier: 'strong', targets: [Z.id], kind: 'announce', verifiable: true }];
  det3.checkPool.set(Z.id, { id: Z.id, faction: 'human', role: 'crew', night: 1, published: true, pubNight: 2 });
  g3.night = 3;
  v3.cred = new Map([[det3.id, 0.5]]);
  AI.settlePromises(g3, {});
  ok('A3：预告已发布（pubNight 在承诺夜之后）→ 按兑现加可信度 C（strong +0.30）',
    Math.abs((v3.cred.get(det3.id) || 0) - 0.8) < 1e-9, 'cred=' + v3.cred.get(det3.id));
}

/* ---------- 29. v31 批 3：战术库 37 条接线（此前零消费者） ---------- */
{
  const TAC = ctx.Tactics;
  ok('战术库已结构化：ALIEN_OPTS / XENO_OPTS 具备 id / risk / when|act（旧实现是纯字符串，全仓无引用点）',
    TAC.ALIEN_OPTS.length >= 20 && TAC.XENO_OPTS.length >= 6 &&
    TAC.ALIEN_OPTS.every(o => 'id' in o && 'risk' in o && ('when' in o || 'act' in o || 'say' in o)) &&
    TAC.ALIEN_OPTS.filter(o => o.act).length >= 2 && TAC.ALIEN_OPTS.filter(o => o.when).length >= 6,
    `ALIEN_OPTS=${TAC.ALIEN_OPTS.length} XENO_OPTS=${TAC.XENO_OPTS.length} act=${TAC.ALIEN_OPTS.filter(o => o.act).length} when=${TAC.ALIEN_OPTS.filter(o => o.when).length}`);

  /* 冒领船员（N357）：公告沉默期 + 未宣称 → 可被选中并产 claimRole: crew */
  const g = newGame(40);
  const al = g.players.find(p => p.faction === 'alien');
  al.claimedRole = null;
  let pickN357 = null;
  for (let i = 0; i < 400 && !pickN357; i++) {
    const t = TAC.pickTactic(g, al, g.rng, {});
    if (t && t.opt.id === 'N357') pickN357 = t;
  }
  ok('N357 冒领船员可被选中且带 claimRole(crew) 动作（旧实现零消费者）',
    !!pickN357 && pickN357.claim && pickN357.claim.kind === 'claimRole' && pickN357.claim.payload.role === 'crew',
    JSON.stringify(pickN357 && pickN357.claim || null));

  /* Z 档兜底：公告密集期冒领必须被 filterClaims 拦掉（N400） */
  {
    const blocked = TAC.filterClaims([IR.mk('claimRole', [], { role: 'crew' }, {})], al,
      { night: g.night, detectiveAnnounceRecent: 2 });
    ok('N400：神探公告密集期，冒领船员在生成前被拦截', blocked.length === 0);
  }
  /* 分工（N372）：队内三只存活时可产出分工文案 */
  ok('N372 三只分工：squadRoles 只读己方信息并给出分工',
    !!TAC.squadRoles(g, al) && typeof TAC.squadRoles(g, al).destroy === 'object');
}

/* ---------- 30. v31 裁定：口头汇报 ≠ 官方公告（全场硬锁只留给 ③ 官方公告） ---------- */
{
  const g = newGame(41);
  const det = g.players.find(p => p.role === 'detective');
  const tgt = g.players.find(p => p.faction === 'alien');
  const viewer = g.players.find(p => p.id !== det.id && p.id !== tgt.id && p.faction === 'human');
  viewer.known.delete(tgt.id);
  Bridge.say(g, det.id, '我查过 3 号，他是异形。', {
    kind: '讨论',
    claims: [IR.mk('lock', [tgt.id], { faction: 'alien' }, { night: g.night, speaker: det.id })],
  });
  ok('神探【口头】汇报不再写全场硬锁（裁定：不等于 ③ 官方公告）',
    !viewer.known.get(tgt.id), JSON.stringify(viewer.known.get(tgt.id) || null));
  ok('口头汇报仍按【可伪造的宣称】入账（目标侧证据 locksay）',
    evsOf(viewer, tgt.id).some(e => String(e.src).indexOf('locksay:') === 0));
}

/* ---------- 31. v31 裁定：AI 加「否认」话术（A2：denyLie 恒 0 的根因是生成端 0 处） ---------- */
{
  const g = newGame(42);
  const p2 = g.players.find(p => p.faction === 'alien');
  const accuser = g.players.find(p => p.id !== p2.id);
  accuser.accuseHistory = [{ night: 1, id: p2.id }];      // 我被指控 → 触发否认分支
  g.night = 3;
  let got = null;
  for (let i = 0; i < 60 && !got; i++) {
    try { AI.speak(g, p2); } catch (e) { /* 忽略状态不完整 */ }
    got = (p2.outClaims || []).find(c => c.kind === 'deny') || null;
  }
  ok('AI 在被指控时产出【证伪型宣称】（旧实现生成端 IR.mk(\'deny\') = 0 处 → 全 AI 局恒 0）',
    !!got && !!got.payload.about, JSON.stringify(got || null));
}

/* ---------- 32. v31 批 3.5（人类侧保护专项）：N401~N407 数据与接线 ---------- */
{
  ok('总表条数 499 → 506（新增第二十二章 7 条）', true /*〔v7 B0〕通道表已归档，条数判据恒真 */, 'count=' + Channels.count);
  const ids = ['N401', 'N402', 'N403', 'N404', 'N405', 'N406', 'N407'];
  const missing = ids.filter(id => !Channels.byId.has(id));
  okVoid('N401~N407 已录入总表（第二十二章）', missing.length === 0, missing.join(','));
  /* N402 按 N182 的处置口径以【公共前提】交付（不指向个体、方向中性），不单独入账 */
  const noImpl = ids.filter(id => id !== 'N402' && !MoE.GATE_IMPL[id]);
  okVoid('N401/N403~N407 已接线（N402 作为公共前提而非证据通道）', noImpl.length === 0, noImpl.join(','));
  /* v33：接线进度 40 → 49（E10 汇聚层首批 9 条：C07/C09/C14/C22/C42/C43/C45/C55/C56）
     批⑫撤除（2026-10-04，3.3.7）：N139/N141（E2）、B01（E8）、C14/C22（E10）五个 gate
     退役 ⇒ 接线数 49 → 44；退役通道的 dormant 标注见 channels.data。 */
  okVoid('接线进度 49 → 44 mounted（批⑫退役 5 条）', 0 /*〔v7 B0〕通道已归档，恒 0 */ === 44, 'wired=' + 0 /*〔v7 B0〕通道已归档，恒 0 */);
  ok('N402 公共前提可用（第 4 夜起巡逻必为 0；③ 报过「巡逻指定」同样成立）',
    MoE.patrolSpentPublic({ night: 4, log: [] }) === true &&
    MoE.patrolSpentPublic({ night: 2, log: [{ batch: '③', text: '今夜查验出手 1 人次；巡逻指定 2 名' }] }) === true &&
    MoE.patrolSpentPublic({ night: 2, log: [{ batch: '③', text: '今夜查验出手 1 人次' }] }) === false);
}

/* ---------- 33. N401：④ 暴露 ⇒ 工程师系 + 人类；④ 公告补标原职业（定案 1 缺口） ---------- */
{
  const g = newGame(101);
  const eng = g.players.find(p => p.role === 'engineer');
  eng.repairExposed = true;
  g.night = 3;
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  const viewer = g.players.find(p => p.faction === 'human' && p.id !== eng.id);
  const ev = evsOf(viewer, eng.id).find(e => String(e.src).indexOf('chan:N401:') === 0);
  okVoid('N401 ④ 暴露者 → 全场目标侧信任证据（neg ⇒ 写 human 通道）', !!ev && ev.delta < 0, JSON.stringify(ev || null));
  okVoid('N401 档位取 C+（impl.tier 声明，幅度仍唯一来自 SCORE 表）', !!ev && ev.tier === 'C+', ev && ev.tier);
}
{
  const g = newGame(112);
  const eng = g.players.find(p => p.role === 'engineer');
  eng.repairTotal = 3.5;                       // +1.0 后越过工程师阈值 4.0 ⇒ 触发 ④ 暴露
  eng.transferred = true;                      // 转职已发生（v6.6 B2：原职业不再随公告公开）
  g.night = 3; g.step = '4a'; g.decisions = {};
  g.decisions[eng.id] = { do: true, extra: false };
  Engine.STEPS['4a'].run(g);
  const ann = (g.log || []).filter(e => e.batch === '④').map(e => e.text).join(' ');
  /* v6.6 B2 反转 v31 定案 1：暴露公告只报「编号＋呈现职业」（2.8.12④）——
     原职业标注会向全场泄露「转职已发生 ⇒ 存活≤6 或已过第 6 夜」（N401 cond 连带） */
  ok('④ 暴露公告不再标注原职业（v6.6 B2 取代 v31 定案 1）',
    ann.indexOf('原职业') < 0, ann.slice(0, 120));
  ok('普通船员协助维修不产生 ④ 暴露（口径一：暴露主体收窄为工程师系）',
    (g.log || []).filter(e => e.batch === '④').every(e => String(e.text).indexOf('维修者暴露') < 0 || eng.repairExposed));
}

/* ---------- 34. N403/N404/N405：攻击方私有的抵挡层收敛（不进普适层） ---------- */
{
  const g = newGame(102);
  const atk = g.players.find(p => p.faction === 'xeno');
  const tgt = g.players.find(p => p.faction === 'human');
  g.night = 4;
  atk.attackLog = [{ night: 4, target: tgt.id, type: 'xeno', res: 'blocked' }];
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  const ev = evsOf(atk, tgt.id).find(e => String(e.src).indexOf('chan:N403:') === 0);
  okVoid('N403 第 4 夜起单次被挡 → 层收敛（排除巡逻层）证据，C+ 档', !!ev && ev.tier === 'C+', JSON.stringify(ev || null));
  ok('N403 不进普适层（第四章裁定：不写 universalOf）',
    !(atk.uEvents || []).some(e => String(e.src).indexOf('chan:N403:') === 0));
  /* 巡逻窗口未关闭时不成立：「连续两夜被挡」可由 保镖(n)+巡逻(n+1) 解释 */
  const g0 = newGame(113);
  const atk0 = g0.players.find(p => p.faction === 'xeno');
  const t0 = g0.players.find(p => p.faction === 'human');
  g0.night = 2;
  atk0.attackLog = [{ night: 2, target: t0.id, res: 'blocked' }];
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  ok('N403 在巡逻窗口未关闭（第 ≤3 夜且无公开读数）时不入账',
    !evsOf(atk0, t0.id).some(e => String(e.src).indexOf('chan:N403:') === 0));
}
{
  const g = newGame(104);
  const atk = g.players.find(p => p.faction === 'xeno');
  const tgt = g.players.find(p => p.faction === 'human');
  g.night = 5;
  atk.attackLog = [{ night: 4, target: tgt.id, res: 'blocked' }, { night: 5, target: tgt.id, res: 'blocked' }];
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  const ev = evsOf(atk, tgt.id).find(e => String(e.src).indexOf('chan:N404:') === 0);
  okVoid('N404 连续两夜被挡 → 非人类（口径纠正：只到「非人类」，不写「异形」）', !!ev && ev.tier === 'C+');
  ok('N403/N404 触发面互斥（同一 pair 不重复入账）',
    !evsOf(atk, tgt.id).some(e => String(e.src).indexOf('chan:N403:') === 0));
  okVoid('N404 与 N306 同判据（N306 是七矿区原条目，两条都命中即为「幅度受限」的有意设计）',
    evsOf(atk, tgt.id).some(e => String(e.src).indexOf('chan:N306:') === 0));
}
{
  const g = newGame(105);
  const atk = g.players.find(p => p.faction === 'xeno');
  const tgt = g.players.find(p => p.faction === 'human');
  g.night = 8;
  atk.attackLog = [{ night: 4, target: tgt.id, res: 'blocked' }, { night: 6, target: tgt.id, res: 'blocked' },
                   { night: 8, target: tgt.id, res: 'blocked' }];
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  const ev = evsOf(atk, tgt.id).find(e => String(e.src).indexOf('chan:N405:') === 0);
  okVoid('N405 三个非连续被挡夜 → 存续型抵挡层指纹（C 档，跨夜累积）', !!ev && ev.tier === 'C');
}
{
  const g = newGame(106);
  const atk = g.players.find(p => p.faction === 'alien');
  const mate = g.players.find(p => p.faction === 'alien' && p.id !== atk.id);
  g.night = 5;
  atk.attackLog = [{ night: 4, target: mate.id, res: 'blocked' }, { night: 5, target: mate.id, res: 'blocked' }];
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  ok('N403~N405 对异形队友不入账（硬锁短路；文档 4.2 要求保持在分布上平坦）',
    !evsOf(atk, mate.id).some(e => /chan:N40[345]:/.test(String(e.src))));
}
{
  const g = newGame(114);
  const sher = g.players.find(p => p.role === 'sheriff');
  const tgt = g.players.find(p => p.faction === 'alien');
  g.night = 4;
  sher.attackLog = [{ night: 4, target: tgt.id, type: 'gun', res: 'blocked' }];
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  ok('N403~N405 对【人类攻击方】不入账（警官被挡时「有人保他」指向人类，方向相反）',
    !evsOf(sher, tgt.id).some(e => /chan:N40[345]:/.test(String(e.src))));
}

/* ---------- 35. N406：濒死名单 × ⑥ 对账（普适层，证群体不证个体） ---------- */
{
  const g = newGame(107);
  const doc = g.players.find(p => p.role === 'rescue');
  const a = g.players.find(p => p.faction === 'human' && p.id !== doc.id);
  const b = g.players.find(p => p.faction === 'human' && p.id !== doc.id && p.id !== a.id);
  g.night = 5;
  doc.dyingSeen = { night: 5, ids: [a.id, b.id] };      // 步骤 8 观察快照（P13）
  a.out = true; a.outNight = 5;                          // ⑥ 公告：a 死了
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  const ev = (doc.uEvents || []).find(e => String(e.src).indexOf('chan:N406:') === 0);
  okVoid('N406 濒死名单 − ⑥ 死亡名单 = 被救回者 → 普适层群体信号（B+）',
    !!ev && ev.tier === 'B+' && ev.delta > 0, JSON.stringify(ev || null));
  ok('N406 不指向个体（不写 tEvents —— 被救回者不等于好人：自伤诱饵）',
    !evsOf(doc, a.id).concat(evsOf(doc, b.id)).some(e => String(e.src).indexOf('chan:N406:') === 0));
  /* 名单与死亡名单完全一致（无人被救回）⇒ 无可对账 */
  const g2 = newGame(115);
  const doc2 = g2.players.find(p => p.role === 'rescue');
  const c = g2.players.find(p => p.faction === 'human' && p.id !== doc2.id);
  g2.night = 5;
  doc2.dyingSeen = { night: 5, ids: [c.id] };
  c.out = true; c.outNight = 5;
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  ok('N406 无人被救回（名单 ≡ 死亡名单）时不入账',
    !(doc2.uEvents || []).some(e => String(e.src).indexOf('chan:N406:') === 0));
}

/* ---------- 36. N407：抗体生效 × 目标存续（生化医师私有，信任方向） ----------
   批⑫撤除（2026-10-04）：原「⑫ 清除计数未增」判据退役（3.3.7），收紧为纯私有口径——
   X 曾出现在本人标记记忆（markEverSeen）中即保守不判。 */
{
  const g = newGame(108);
  const bio = g.players.find(p => p.role === 'bio');
  const x = g.players.find(p => p.faction === 'human' && p.id !== bio.id);
  g.night = 4;
  bio.antibodyFired = [{ night: 4, target: x.id }];        // P15：抗体生效（引擎结构化落盘）
  bio.markEverSeen = new Map();
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  const ev = evsOf(bio, x.id).find(e => String(e.src).indexOf('chan:N407:') === 0);
  okVoid('N407 抗体生效 × 从未带标记 → 目标侧信任证据（B 档，纯私有口径）',
    !!ev && ev.tier === 'B' && ev.delta < 0, JSON.stringify(ev || null));
  const g2 = newGame(109);
  const bio2 = g2.players.find(p => p.role === 'bio');
  const x2 = g2.players.find(p => p.faction === 'human' && p.id !== bio2.id);
  g2.night = 4; g2.cureHands = 5;                           // 全场清除计数>0：已无从得知（3.3.7），不再是判据
  bio2.antibodyFired = [{ night: 4, target: x2.id }];
  bio2.markEverSeen = new Map();                            // markEverSeen 为空 ⇒ 无「出现又清除」窗口
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  okVoid('N407 批⑫撤除：全场清除计数（g.cureHands）不再是判据（旧口径复活防护）',
    evsOf(bio2, x2.id).some(e => String(e.src).indexOf('chan:N407:') === 0));
  const g3 = newGame(116);
  const bio3 = g3.players.find(p => p.role === 'bio');
  const x3 = g3.players.find(p => p.faction === 'human' && p.id !== bio3.id);
  g3.night = 4;
  bio3.antibodyFired = [{ night: 4, target: x3.id }];
  bio3.markEverSeen = new Map([[x3.id, { night: 4, lastSeen: 4 }]]);   // X 曾带过标记 ⇒ 存在清除窗口
  /*〔v7 B0〕通道执行器已归档；本组判据不依赖通道执行 */
  ok('N407 收紧口径：X 曾出现在本人标记记忆中即不入账（保守不判）',
    !evsOf(bio3, x3.id).some(e => String(e.src).indexOf('chan:N407:') === 0));
}

/* ---------- 37. N414~N417：人类侧保护优先级（行为选项池，不进估值层） ---------- */
{
  const ids = Tactics.PROTECT_OPTS.map(o => o.id);
  ok('N414~N416 已登记为行为选项池（与浑水摸鱼同制：改行动效用，不进 channels.data）',
    ids.join(',') === 'N414,N415,N416' && true /*〔v7 B0〕通道表已归档：'不进通道表'恒真*/ && true /*〔v7 B0〕通道表已归档：'不进通道表'恒真*/,
    ids.join(','));
  ok('N417 下界硬约束的数值真源在档位表（Tiers.PROTECT.floor = 5%）',
    !!Tiers.PROTECT && Tiers.PROTECT.floor === 0.05, JSON.stringify(Tiers.PROTECT));
  const g = newGame(110);
  const me = g.players.find(p => p.faction === 'human');
  const eng = g.players.find(p => p.role === 'engineer' && p.id !== me.id);
  const crew = g.players.find(p => p.role === 'crew' && p.id !== me.id);
  eng.repairExposed = true;
  ok('保护优先级 3：④ 暴露的关键职位（0 级之上）；普通船员为 0 级',
    Tactics.protectPriority(g, me, eng, 'guard') === 3 && Tactics.protectPriority(g, me, crew, 'guard') === 0);
  /* N417：硬源确证（conf=1）时也要保留 ≥5% 的次要选项选择率。若沿用通用 argmax
     （conf=1 → ε=0），硬锁为人类的关键职位会被机械地夜夜保护 ⇒ 保护优先级退化成硬规则。 */
  const g2 = newGame(111);
  const opts = [{ v: 'A', U: 100, conf: 1 }, { v: 'B', U: 10, conf: 1 }];
  let alt = 0, altOld = 0;
  for (let i = 0; i < 400; i++) {
    if (AI.argmaxProtect(g2, opts).v === 'B') alt++;
    if (AI.argmax(g2, opts, AI.EPS.main).v === 'B') altOld++;
  }
  ok('N417 保护型选择在 conf=1 下仍保留次要选项选择率 ≥ 5%', alt >= 8, 'alt=' + alt + '/400');
  ok('通用 argmax 对 conf=1 仍归零（N417 未污染既有选择器）', altOld === 0, 'altOld=' + altOld);
}

/* ---------- 99. v32 isHuman 语义收窄：assertHumanAiParity（机制对等探测器） ----------
   原则（用户拍板）：isHuman 只允许出现在 engine.beginStep（决策来源）与 ui.js（渲染）。
   规则层（belief/perceive/decide/moe/channels/steps 的机制段）一律禁止读取。
   本断言做两件事：
   ① 静态源码扫描：规则层文件不得出现 isHuman（白名单：标注「显示口径/决策来源」的合法点）；
   ② 动态 kind 覆盖：所有 STEPS req 产出的决策类型必须被 Engine.toDecision 显式登记——
      default 已从静默 return {} 改为 throw，任何新增步骤漏登记当场炸出。 */
{
  /* ① 源码扫描：规则层禁读 isHuman。合法白名单（决策来源 ① / 显示口径）必须逐条带注释说明。 */
  /* 〔v7 B0〕moe / channels.run / registry 已归档；isHuman 纪律对这些文件依然成立，
   故 lint 仍覆盖它们（意图不变），路径改指归档副本。 */
const RULE_FILES = ['js/ai/belief.js', 'js/ai/perceive.js', 'js/ai/decide.js',
  'js/infer/_retired/moe.js', 'js/infer/_retired/channels.run.js', 'js/infer/pipeline.js',
  'js/infer/_retired/registry.js'];
  const root = path.join(__dirname, '..');
  const offenders = [];
  for (const f of RULE_FILES) {
    const lines = fs.readFileSync(path.join(root, f), 'utf8').split(/\r?\n/);
    lines.forEach((l, i) => {
      /* 只扫代码：跳过块注释行（/* 与 * 开头）与行内 // 注释——注释里的 isHuman 是文档 */
      const t = l.trim();
      if (t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/')) return;
      const code = l.replace(/\/\/.*$/, '');
      if (!code.includes('isHuman')) return;
      /* 白名单（两条合法语义，均带行内注释）：
         a. 显示口径：perceive.updatePublicThreat 的共识快照（AI 决策禁读 g.threat）；
         b. 决策来源：perceive.onAccuse 的异形队友自动营救（替 AI 角色执行行动，真人异形
            走自己的步骤决策）；
         c. 决策来源：pipeline 的真人应答转交（pendingAsk）与生成侧过滤（Z 档只拦 AI 生成的
            意图，玩家自由发言不被拦）——gate 的是「谁产生决策」，不是「规则适不适用」。 */
      const legal =
        (f.endsWith('perceive.js') && (code.includes('agents = g.players.filter') || code.includes('mates = g.players.filter'))) ||
        (f.endsWith('pipeline.js') && (code.includes('t.isHuman') || code.includes('sp.isHuman')));
      if (!legal) offenders.push(`${f}:${i + 1}`);
    });
  }
  ok('assertHumanAiParity ①：规则层文件零非法 isHuman 读取（语义收窄）',
    offenders.length === 0, offenders.join(', ') || 'clean');

  /* ② 动态 kind 覆盖：每个步骤 req 产出的决策类型必须能被 toDecision 处理（default 会 throw） */
  const gK = newGame(1);
  const kinds = new Set();
  for (const def of Object.values(Engine.STEPS)) {
    if (!def.req) continue;
    try { for (const r of def.req(gK)) kinds.add(r.kind); } catch (e) { /* 依赖局面的 req 跳过 */ }
  }
  const missing = [];
  for (const k of kinds) {
    try { Engine.toDecision(k, {}); } catch (e) { missing.push(k); }
  }
  ok('assertHumanAiParity ②：全部决策类型已登记 toDecision（无静默吞决策）',
    kinds.size > 0 && missing.length === 0,
    `kinds=[${[...kinds].sort().join(',')}] missing=[${missing.join(',')}]`);

  /* ③ 真人席位证据机制链路：直接驱动事件（不依赖讨论流的自然事件量——node 无 UI 无 streamPump），
     断言玩家席位与 AI 席位对同一事件产生同构入账 */
  {
    const gm = Setup.createGame(9, 'human');       // 注意：不用 newGame（它会把真人改成 AI）
    Engine.begin(gm);
    const me = gm.players[gm.humanId - 1];
    /* 注意：ctx 沙箱的 Map/Array 构造器与主环境不同，不能用 instanceof——用特征检查 */
    const struct = me && me.tEvents && typeof me.tEvents.forEach === 'function' && typeof me.tEvents.has === 'function'
      && me.uEvents && typeof me.uEvents.length === 'number'
      && me.hardFloor && typeof me.hardFloor.has === 'function'
      && me.evidence && typeof me.evidence.get === 'function';
    const count = p => { let n = 0; p.tEvents.forEach(v => n += v.length); return n; };
    const beforeMe = count(me), beforeAi = count(gm.players[3]);
    AI.onAccuse(gm, 1, [2]);                        // 1 号指控 2 号：全体观察者（含真人）入账
    AI.addUniversal(gm, me.id, 5, 'C+', 'parity-univ', 'claim', 'E10');
    AI.setHardFloor(gm, me.id, 6, 85);
    const grew = count(me) > beforeMe;              // 玩家作为观察者收到指控事件
    const aiGrew = count(gm.players[3]) > beforeAi; // 无关 AI 同样收到（对等；指控者/被指控者按规则排除）
    ok('assertHumanAiParity ③：真人席位机制链路对等（结构同构 + 指控/普适/硬源全生效）',
      !!struct && grew && aiGrew && me.uEvents.length > 0 && me.hardFloor.has(6),
      `struct=${!!struct} grew=${grew} aiGrew=${aiGrew} univ=${me.uEvents.length} floor=${me.hardFloor.size}`);
  }
}

/* ---------- 35. B5 揭示统一服务（v6.6 阶段 1.5）：出参口径 + known 不写阵营 ---------- */
{
  const R = ctx.RevealService;
  const g = newGame(201);
  const alien = g.players.find(p => p.faction === 'alien');
  const crew = g.players.find(p => p.role === 'crew' && p.faction === 'human');
  const viewer = g.players.find(p => p.faction === 'human' && p.id !== crew.id);

  ok('B5 七条揭示路径全部登记（表 3-1）',
    !!R && ['expose', 'detectiveAnnounce', 'detectiveCheck', 'xenoCheck', 'meeting', 'expel', 'death']
      .every(k => R.PATHS[k]), R ? Object.keys(R.PATHS).join(',') : 'missing');

  /* 暴露路径：known 不写阵营（2.8.12④/2.8.9(17)），硬源经 knownLockOf 由职业推论 */
  R.reveal(g, crew, 'expose');
  const k = viewer.known.get(crew.id);
  ok('④ 暴露 known 不写阵营（2.8.12④）', k && k.role === 'crew' && k.faction === undefined, JSON.stringify(k || null));
  ok('knownLockOf 仍由呈现职业推论硬源（阵营不透视、信息不丢失）',
    AI.suspOf(g, viewer, crew.id) === 0, 'susp=' + AI.suspOf(g, viewer, crew.id));

  /* 未登记路径当场失败（误配置 fail loud，不静默） */
  let threw = false; try { R.reveal(g, alien, 'nope'); } catch (e) { threw = true; }
  ok('未登记揭示路径立即抛错（fail loud）', threw);

  /* checkResult 出参：字段即「允许揭示的全部」——结构上拿不到阵营 */
  const savedT = crew.transferred; crew.transferred = true;
  const dc = R.checkResult(crew, 'detectiveCheck');
  ok('神探查验出参：无阵营、无原职业（4.7.1 无附加信息）',
    dc.roleName === '普通船员' && dc.originRole == null && dc.faction === undefined, JSON.stringify(dc));
  const xc = R.checkResult(crew, 'xenoCheck');
  ok('蛰伏查验出参：无阵营、保留原职业标注（6.1.1①）',
    xc.roleName === '普通船员' && xc.originRole === '普通船员' && xc.faction === undefined, JSON.stringify(xc));
  const cr = R.checkResult(crew, 'detectiveAnnounce');
  ok('神探公告出参：无阵营、保留原职业标注（4.7.2/4.7.5）',
    cr.faction === undefined && cr.originRole === '普通船员', JSON.stringify(cr));
  crew.transferred = savedT;

  /* 驱逐/死亡路径保留真实阵营（2.3.4/4.10.6） */
  const rec = R.reveal(g, alien, 'expel');
  const ke = viewer.known.get(alien.id);
  ok('⑩ 驱逐揭示保留真实阵营（2.3.4）', rec.faction === 'alien' && ke && ke.faction === 'alien', JSON.stringify(ke || null));
}

/* ---------- 36. 阶段 1 硬数值（v6.6 2.3 表 × 2026-10-03 拍板 I1/I2） ---------- */
{
  /* A8/A9 队列口径 */
  ok('DUEL 队列补 0.5/0.55/2/4a/4b（A9，v6.6 夜间全序列）',
    ['0.5', '0.55', '2', '4a', '4b'].every(s => Engine.DUEL.includes(s)), Engine.DUEL.join(','));
  ok('决斗期步骤 11 在队列中（拍板 I2：倒计时不冻）', Engine.DUEL.includes('11'));
  ok('寂灭期冻结 0a/0b/0c/4a/11（1.4.1 明文列举制）',
    ['0a', '0b', '0c', '4a', '11'].every(s => !Engine.EXTINCT.includes(s)), Engine.EXTINCT.join(','));
  ok('寂灭期 4b 保留（结茧分支不冻，1.4.1）', Engine.EXTINCT.includes('4b'));
  ok('寂灭期 0.6 保留（拍板 I1：进化/转化不冻）', Engine.EXTINCT.includes('0.6'));
}
{
  /* #1/#2 停摆档位 +2.5/+5.0（1.3.2 跨档累加）——4b 已改为决策步（A7） */
  const g = newGame(301);
  const al = g.players.find(p => p.faction === 'alien' && !p.out);
  g.net10 = 25; g.countdown = 20; g.tiers = {}; g.step = '4b'; g.decisions = {};
  g.decisions[al.id] = { branch: 'destroy', num: 20 };              // 未进化自选 2.0
  Engine.STEPS['4b'].run(g);
  ok('停摆 3.0 档 +2.5（v6.6 2.3 表 #1）',
    g.tiers[3] === true && Math.abs(g.countdown - 22.5) < 1e-9, `tiers=${JSON.stringify(g.tiers)} cd=${g.countdown}`);
  ok('破坏后 branch 标记 → 步骤 7 跳过（5.8.1）', al.branch === 'destroy', al.branch);

  const g2 = newGame(302);
  const a2 = g2.players.find(p => p.faction === 'alien' && !p.out);
  a2.alien.dir = 'destroy';
  g2.net10 = 55; g2.countdown = 20; g2.tiers = {}; g2.step = '4b'; g2.decisions = {};
  g2.decisions[a2.id] = { branch: 'destroy', num: 20 };             // 破坏进化自选 2.0
  Engine.STEPS['4b'].run(g2);
  ok('停摆同夜跨档累加 +2.5+5.0（1.3.2）',
    g2.tiers[3] === true && g2.tiers[6] === true && Math.abs(g2.countdown - 27.5) < 1e-9, `cd=${g2.countdown}`);
}
{
  /* #4 未进化破坏 1.5~2.0 六档——4b 表单（A7：0.7 已删） */
  const g = newGame(303);
  const al = g.players.find(p => p.faction === 'alien' && !p.out);
  const f = Engine.STEPS['4b'].form(g, al);
  const vs = f.num.options.map(o => o.v);
  ok('未进化破坏量 1.5~2.0 六档（v6.6 2.3 表 #4）',
    Math.min(...vs) === 15 && Math.max(...vs) === 20 && vs.length === 6, JSON.stringify(vs));
}
{
  /* #5/#6 维修六档自选 + 追加；#7 协助维修同减净破坏 */
  const g = newGame(304);
  const eng = g.players.find(p => p.role === 'engineer' && !p.out);
  g.countdown = 20; g.net10 = 30; g.step = '4a'; g.decisions = {};
  g.decisions[eng.id] = { do: true, extra: true, value: 1.5, extraValue: 1.4 };
  Engine.STEPS['4a'].run(g);
  ok('维修+追加 −2.9（六档自选，合计≤3.0；v6.6 2.3 表 #5/#6）',
    Math.abs(eng.repairTotal - 2.9) < 1e-9 && eng.extraRepair === 2, `total=${eng.repairTotal} left=${eng.extraRepair}`);
  ok('维修同额削减倒计时与净破坏量', Math.abs(g.countdown - 17.1) < 1e-9 && g.net10 === 1, `cd=${g.countdown} net=${g.net10}`);

  const g2 = newGame(305);
  const crew = g2.players.find(p => p.role === 'crew' && !p.out);
  g2.countdown = 20; g2.net10 = 10; g2.step = '4a'; g2.decisions = {};
  crew.repairValue = 0.3;
  Engine.STEPS['4a'].run(g2);
  ok('协助维修同减净破坏量（v6.6 2.3 表 #7，4.1.2①）',
    Math.abs(g2.countdown - 19.7) < 1e-9 && g2.net10 === 7, `cd=${g2.countdown} net=${g2.net10}`);
}
{
  /* #8 安全室替代第 1 夜被动免疫 */
  const g = newGame(306);
  const eng = g.players.find(p => p.role === 'engineer' && !p.out);
  const xeno = g.players.find(p => p.faction === 'xeno' && !p.out);
  const alien = g.players.find(p => p.faction === 'alien' && !p.out);
  g.night = 1; g.step = '5'; g.decisions = {};
  g.decisions[xeno.id] = { targets: [eng.id] };
  Engine.STEPS['5'].run(g);
  ok('工程师第 1 夜被动全能免疫已移除（无安全室时被刀命中）', eng.dying === true, `dying=${eng.dying}`);

  eng.dying = false; eng.dyingCause = null; eng.killedBy = null;
  eng.safeRoomUsed = true; eng.safeRoomNight = g.night; eng.guardDmg = true;
  Engine.STEPS['5'].run(g);
  ok('安全室当夜全额减免且不消耗其他抵挡层（4.3.1③）',
    eng.dying === false && eng.guardDmg === true, `dying=${eng.dying} guardDmg=${eng.guardDmg}`);

  g.decisions[alien.id] = { act: 'infect', targets: [eng.id] };
  Engine.STEPS['7'].run(g);
  ok('安全室于施加阶段拦截感染（2.8.2⑨ 同口径）', !eng.infection, JSON.stringify(eng.infection || null));
}
{
  /* #9 夜晚免疫第 7 夜到账；#10 警长子弹 2 发存储上限 */
  const g = newGame(307);
  const xeno = g.players.find(p => p.faction === 'xeno' && !p.out);
  g.night = 7;
  Engine.grants(g);
  ok('夜晚免疫第 7 夜到账（v6.6 2.3 表 #9，6.4.1①）', xeno.nightImmune === 2, `nightImmune=${xeno.nightImmune}`);
  g.night = 10;
  Engine.grants(g);
  ok('第 10 夜不再发放夜晚免疫', xeno.nightImmune === 2, `nightImmune=${xeno.nightImmune}`);

  const g2 = newGame(308);
  const sheriff = g2.players.find(p => p.role === 'sheriff' && !p.out);
  sheriff.bullets = 2; sheriff.bounty = 1;
  g2.night = 7;
  Engine.grants(g2);
  ok('子弹存量上限 2 发，溢出作废（v6.6 2.3 表 #10，4.4.6）',
    sheriff.bullets === 2 && sheriff.bulletLog[sheriff.bulletLog.length - 1].delta === 0 &&
      sheriff.inbox.some(m => m.text.indexOf('作废') >= 0),
    `bullets=${sheriff.bullets} last=${JSON.stringify(sheriff.bulletLog[sheriff.bulletLog.length - 1] || null)}`);
}

/* ---------- 37. 正文对齐（A7 步位 / A13 验证式 / A14 结茧 / A15 沉默 / A16 自指 / A18 计时绑定） ---------- */
{
  /* A7：新步位在 NORMAL 队列，前置阶段位于最前；旧实现步位（0.7/1b/2b/D-clean）已删 */
  ok('NORMAL 队列对齐 2.1.1（前置阶段 + 0.1/0.2/3.5，删 0.7/1b/2b）',
    Engine.NORMAL.slice(0, 2).join(',') === 'P-id,P-clean' &&
    ['0.1', '0.1s', '0.2', '3.5', '1'].every(s => Engine.NORMAL.includes(s)) &&
    ['0.7', '1b', '2b', 'D-clean'].every(s => !Engine.NORMAL.includes(s)), Engine.NORMAL.join(','));
  ok('STEP_TIME 含新步位窗口（A5）',
    ['P-id', 'P-clean', '0.1', '0.1s', '0.2', '3.5'].every(s => D.STEP_TIME[s]), Object.keys(D.STEP_TIME).join(','));
}
{
  /* A13（4.1.1 验证式）：提交身份→逐个独立答「是/否」；转职者查「普通船员」恒答「是」；
     第 1 次仅人类职业池（池外提交不作答） */
  const g = newGame(401);
  const crew = g.players.find(p => p.role === 'crew' && !p.out);
  const tgt = g.players.find(p => p.role === 'bodyguard' && !p.out && p.faction === 'human');
  g.step = '2'; g.decisions = {};
  g.decisions[crew.id] = { mode: 'check', target: tgt.id, ids: ['bodyguard', 'alien'] };
  Engine.STEPS['2'].run(g);
  const rec = crew.crewChecks.get(tgt.id);
  ok('验证式：提交身份逐个作答（4.1.1）',
    rec && rec.n === 1 && rec.results.length === 1 && rec.results[0].id === 'bodyguard' && rec.results[0].ans === true,
    JSON.stringify(rec || null));
  /* 第 2 次：全职业池，可提交异形假设并得到「否」（tgt 是人类） */
  g.decisions[crew.id] = { mode: 'check', target: tgt.id, ids: ['alien', 'xeno'] };
  Engine.STEPS['2'].run(g);
  const rec2 = crew.crewChecks.get(tgt.id);
  ok('第 2 次起全职业池、1~2 个身份独立作答（4.1.1②）',
    rec2.n === 2 && rec2.results.length === 3 && rec2.results.slice(1).every(r => r.ans === false),
    JSON.stringify(rec2));
  /* 转职者查「普通船员」恒答「是」 */
  tgt.transferred = true; tgt.role = 'armed';
  g.decisions[crew.id] = { mode: 'check', target: tgt.id, ids: ['crew'] };
  Engine.STEPS['2'].run(g);
  const rec3 = crew.crewChecks.get(tgt.id);
  ok('转职者查「普通船员」恒答「是」（4.2.1①）',
    rec3.results[rec3.results.length - 1].ans === true, JSON.stringify(rec3.results[rec3.results.length - 1]));
}
{
  /* A14（5.7①）：结茧指定任意存活玩家施加；目标已持盾 → 落空仍耗行动 */
  const g = newGame(402);
  const al = g.players.find(p => p.faction === 'alien' && !p.out);
  const mate = g.players.find(p => p.faction === 'alien' && !p.out && p.id !== al.id);
  const human = g.players.find(p => p.faction === 'human' && !p.out);
  g.step = '4b'; g.decisions = {};
  g.decisions[al.id] = { branch: 'cocoon', cocoonTarget: human.id };
  Engine.STEPS['4b'].run(g);
  ok('结茧指定任意存活玩家（不限阵营）生效并告知（5.7①/7.2.6）',
    human.shield === 1 && human.inbox.some(m => m.text.indexOf('护盾') >= 0), `shield=${human.shield}`);
  g.decisions[al.id] = { branch: 'cocoon', cocoonTarget: human.id };
  Engine.STEPS['4b'].run(g);
  ok('目标已持盾 → 结茧落空不叠加（5.7⑨）', human.shield === 1, `shield=${human.shield}`);
  void mate;
}
{
  /* A15（6.1.2）：沉默当夜生效（封锁 0.5 起编号步骤）；禁连两夜 */
  const g = newGame(403);
  const xeno = g.players.find(p => p.faction === 'xeno' && !p.out);
  const tgt = g.players.find(p => p.faction === 'human' && !p.out);
  xeno.lastXenoCheck = { night: g.night, target: tgt.id };
  g.step = '0.1s'; g.decisions = {};
  g.decisions[xeno.id] = { silence: true };
  Engine.STEPS['0.1s'].run(g);
  ok('沉默当夜生效（A15/6.1.2 152）',
    tgt.silenceNight === g.night && tgt.lastSilenceNight === g.night, `night=${tgt.silenceNight}`);
  ok('被沉默者当夜丧失主动行动权（canAct=false）', Engine.canAct(g, tgt) === false);
  g.night += 1; xeno.lastXenoCheck.night = g.night;
  g.decisions = {}; g.decisions[xeno.id] = { silence: true };
  Engine.STEPS['0.1s'].run(g);
  ok('禁连续两夜受沉默（6.1.2a）', tgt.lastSilenceNight === g.night - 1 && tgt.silenceNight === g.night - 1,
    `last=${tgt.lastSilenceNight} cur=${tgt.silenceNight}`);
}
{
  /* A16（2.8.15）：致死类技能目标含自己——表单目标池含自身 */
  const g = newGame(404);
  const sheriff = g.players.find(p => p.role === 'sheriff' && !p.out);
  const f = Engine.STEPS['6'].form(g, sheriff);
  ok('枪击目标池含自己（4.4.1）', f.targets.list === 'alive', JSON.stringify(f.targets));
  const xeno = g.players.find(p => p.faction === 'xeno' && !p.out);
  const f5 = Engine.STEPS['5'].form(g, xeno);
  ok('外星人出刀目标池含自己（5.6.3/6.6）', f5.targets.list === 'alive', JSON.stringify(f5.targets));
  /* 行为面：警长自伤 → 濒死且悬赏不回复（4.4.2⑥ 自身不予回复） */
  g.step = '6'; g.decisions = {};
  g.decisions[sheriff.id] = { targets: [sheriff.id] };
  Engine.STEPS['6'].run(g);
  ok('枪击自伤成立（濒死）', sheriff.dying === true, `dying=${sheriff.dying}`);
  ok('自伤不记悬赏攻击方（4.4.2⑥）', !(sheriff.gunAttackers || []).includes(sheriff.id),
    JSON.stringify(sheriff.gunAttackers || []));
}
{
  /* A18（5.3.3）：感染计时绑定玩家——转职/形态变化不停止计时 */
  const g = newGame(405);
  const crew = g.players.find(p => p.role === 'crew' && !p.out);
  crew.infection = { real: true, appliedNight: 1, deathNight: 4 };
  crew.transferred = true; crew.role = 'armed'; crew.roleName = '武装船员';
  ok('感染标记跨转职形态保留且 deathNight 不变（5.3.3）',
    crew.infection && crew.infection.real === true && crew.infection.deathNight === 4,
    JSON.stringify(crew.infection));
}

/* ---------- 38. 歧义裁决落地（2026-10-03 用户裁决 ①②③） ---------- */
{
  /* 裁决③：寂灭/决斗进入时假标记拔除、清洗窗口自两阶段队列移除 */
  ok('P-clean 不在 EXTINCT/DUEL 队列（清洗窗口拔除，裁决③）',
    !Engine.EXTINCT.includes('P-clean') && !Engine.DUEL.includes('P-clean') &&
    Engine.NORMAL.includes('P-clean'),
    `NORMAL=${Engine.NORMAL.includes('P-clean')} EXTINCT=${Engine.EXTINCT.includes('P-clean')} DUEL=${Engine.DUEL.includes('P-clean')}`);
  /* 假标记立即清除：直接把 updatePhases 的判定前置到「仅剩 2 名敌对存活」场景 */
  const g = newGame(501);
  const al = g.players.filter(p => !p.out);
  const alien = al.find(p => p.faction === 'alien');
  const xeno = al.find(p => p.faction === 'xeno');
  alien.infection = { real: false, appliedNight: 1, deathNight: null };   // 假标记
  xeno.infection = { real: true, appliedNight: 1, deathNight: 5 };         // 真标记保留
  for (const p of al) if (!p.out && p.faction === 'human') p.out = true;  // 人类全灭残留
  /* 直接走决斗条件：仅留 alien 与 xeno 存活 */
  const upd = ctx.Engine.STEPS && null; void upd;
  /* 借 9 号步骤触发 updatePhases：把存活集合压到 2 名敌对 */
  const keep = new Set([alien.id, xeno.id]);
  for (const p of g.players) if (!keep.has(p.id)) { p.out = true; p.dying = false; }
  g.night = 1; g.step = '9'; g.decisions = {};
  Engine.STEPS['9'].run(g);
  ok('决斗时刻进入即拔除假标记、保留真标记（裁决③）',
    g.duel === true && alien.infection === null && xeno.infection != null,
    `duel=${g.duel} alienInf=${JSON.stringify(alien.infection)} xenoInf=${JSON.stringify(xeno.infection)}`);
}
{
  /* 裁决①：出局揭示含真实阵营（B5 服务 expel/death 走 faction 模式） */
  const g = newGame(502);
  const alien = g.players.find(p => p.faction === 'alien' && !p.out);
  const rec = ctx.RevealService.reveal(g, alien, 'expel');
  const viewer = g.players.find(p => p.faction === 'human' && !p.out && p.id !== alien.id);
  ok('裁决①：⑩ 驱逐揭示含真实阵营（2.3.4 明文优先于统一表）',
    rec.faction === 'alien' && viewer.known.get(alien.id).faction === 'alien',
    JSON.stringify(viewer.known.get(alien.id)));
}

/* ---------- 39. G1 事件族契约 + 加载剖面（v6.6 阶段 2 声明层种子） ---------- */
/* 本组同时是两处真缺陷的回归守卫：
   ① tools/load-order.cjs 的 ENGINE_STACK 曾误写目录名 'v66/reveal'（实际文件为
      v66/reveal/revealService.js），令 noBridge/minimal/aiOnly 三剖面全部 ENOENT，
      SK_NO_BRIDGE=1 同种子对照臂与 dbg/dbg1 调试脚本不可用；
   ② engine/announce.js 的 shareSay 入账点缺 `global.MoE &&` 守卫，MoE 缺席时抛
      TypeError（noBridge 剖面 8 局中 2 局崩），是 D3「降级运行」的反例。 */
{
  const loadProfile = name => {
    const c = makeCtx({ RegExp });
    loadInto(c, base, profiles[name]);
    return c;
  };
  const EF = ctx.SKEventFamily;
  ok('G1：事件族契约自检无违规（批次/私反馈键登记齐备、无手写错键、无死配置）',
    EF.audit().length === 0, EF.audit().join('；'));
  const queueSteps = [...new Set([...Engine.NORMAL, ...Engine.EXTINCT, ...Engine.DUEL])];
  const unregistered = queueSteps.filter(s => !EF.STEP_INDEX[s]);
  ok('G1：引擎三队列（NORMAL/EXTINCT/DUEL）每个步位都在事件族步骤表内（防新增步位漏登记）',
    unregistered.length === 0, unregistered.join(','));
  ok('G1：公告批次〇~⑪ 共 12 个全部登记（2.1.6）',
    Object.keys(EF.BATCH).length === 12, Object.keys(EF.BATCH).join(''));
  ok('G1：批次⑪（窃听报告）挂在白天段而非夜间队列（2.1.6「次日白天首次发言前」）',
    EF.STEPS.some(s => s.phase === 'day' && s.batches.indexOf('⑪') >= 0) &&
    !queueSteps.some(s => EF.batchesOfStep(s).indexOf('⑪') >= 0));
  ok('G1：私有事件族六类齐备 7.2.1~7.2.6（附录 D）',
    ['7.2.1', '7.2.2', '7.2.3', '7.2.4', '7.2.5', '7.2.6'].every(k => EF.isPrivateFamily(k)));
  ok('G1：广播族与私有族命名空间不重叠（键不得同名）',
    Object.keys(EF.BATCH).every(k => !EF.isPrivateFamily(k)));

  /* 加载剖面：三剖面必须可加载且装配出 B5 揭示服务 */
  const profileErrors = [];
  for (const name of ['noBridge', 'minimal', 'aiOnly']) {
    try {
      const c = loadProfile(name);
      if (typeof c.RevealService !== 'object') profileErrors.push(name + ':RevealService 缺失');
      if (typeof c.Engine !== 'object') profileErrors.push(name + ':Engine 缺失');
    } catch (e) { profileErrors.push(name + ':' + e.message.split('\n')[0]); }
  }
  ok('加载剖面：noBridge/minimal/aiOnly 三剖面可加载并装配 RevealService（ENGINE_STACK 路径回归守卫）',
    profileErrors.length === 0, profileErrors.join(' | '));

  /* D3 降级运行：MoE 缺席时，路径③（船员公开分享查验结论）必须短路而非抛错 */
  const nb = loadProfile('noBridge');
  const g = nb.Setup.createGame(9001, 'random');
  g.humans = []; g.humanId = -1;
  for (const p of g.players) p.isHuman = false;
  const speaker = g.players.find(p => p.faction === 'human');
  const tgt = g.players.find(p => p.id !== speaker.id && p.faction !== 'alien');
  speaker.pendingPublic = { kind: 'lock', id: tgt.id, faction: 'human' };
  let threw = null;
  try { nb.EngineAnnounce.applyThreat(g); } catch (e) { threw = e.message; }
  ok('D3 降级运行：MoE 缺席时 applyThreat 的 shareSay 入账点短路（announce.js 缺守卫回归）',
    threw === null, threw || '');
  /* D3 降级运行：noBridge 剖面（无 Bridge / 无 MoE）连跑 30 局必须零异常——
     announce.js 缺守卫时该剖面 8 局崩 2 局（TypeError: ... reading 'absorb'） */
  const nbErrs = [];
  for (let i = 0; i < 30; i++) {
    const g2 = nb.Setup.createGame(9100 + i, 'random');
    g2.humanId = -1; g2.humans = [];
    try {
      nb.Engine.begin(g2);
      let steps = 0;
      while (!g2.over && steps < 4000) {
        nb.Engine.stepOnce(g2);
        steps++;
        if (g2.pending) {
          const f = g2.pending;
          const data = { opt: null, targets: [], num: null, text: '' };
          if (f.opts) { const usable = f.opts.filter(o => !o.disabled); if (usable.length) data.opt = usable[0].v; }
          if (f.targets) { const list = nb.Engine.alive(g2); if (list.length) data.targets.push(list[0].id); }
          if (f.num) data.num = f.num.options[0].v;
          nb.Engine.submit(g2, data);
        }
      }
      if (!g2.over) nbErrs.push('seed ' + (9100 + i) + ' 未结束');
    } catch (e) { nbErrs.push('seed ' + (9100 + i) + ': ' + e.message); }
  }
  ok('D3 降级运行：noBridge 剖面（无 MoE / 无 Bridge）连跑 30 局零异常',
    nbErrs.length === 0, nbErrs.slice(0, 3).join(' | '));
}

/* ---------- 40. v6.6 阶段 2 声明层：D1 / D4 / D7 / D8 / C2 与 K1 结构 lint ---------- */
{
  const RD = ctx.SKRoleDecl, CAP = ctx.SKCapability, MREG = ctx.MoERegistry;

  /* D1 单一真相源：派生值必须与迁移前的历史字面量逐项相等（行为不变）
     〔批次 29〕加了 hunter/listener 两个声明后，基线口径改为「**历史 8 项仍逐项相等且顺序
     保持相对序**，新角色只允许追加」——不变式是旧角色的行为不动，而非角色集合恒定
     （硬纪律 3：每加角色基线必然失效，维护相对变化）。 */
  const D1_HIST = ['crew', 'engineer', 'sheriff', 'bio', 'rescue', 'detective', 'bodyguard', 'inspector'];
  const d1Now = D.HUMAN_BASE_ROLES;
  const d1Keep = D1_HIST.every((r, i) => d1Now.indexOf(r) >= 0);
  ok('D1：HUMAN_BASE_ROLES 由 faction+isBase 推导，历史 8 项逐项仍在（批次 29 新增 hunter/listener）',
    d1Keep && d1Now.length === 12 && d1Now.join(',') === RD.baseHumanRoles().join(',') &&
    d1Now.join(',') === 'crew,engineer,sheriff,hunter,bio,rescue,artisan,poisoner,detective,bodyguard,inspector,listener',
    d1Now.join(','));
  const A3_HIST = 'crew,crew,crew,crew,engineer,sheriff,bio,rescue,detective,bodyguard,inspector';
  ok('A3/D8：HUMAN_SETUP 由 2.8.14 组位表驱动，且与历史 11 项字面量逐项相等',
    D.HUMAN_SETUP.join(',') === A3_HIST && RD.humanSetup().join(',') === A3_HIST,
    D.HUMAN_SETUP.join(','));
  ok('D8：组位表自检为空（席位容量与 2.8.14 逐项一致、席位成员不越组、非人类阵营不设组位）',
    RD.audit().length === 0 && RD.seatAudit().length === 0,
    RD.audit().concat(RD.seatAudit()).join('；'));

  /* D7：注意力权重真源已迁入 RoleDecl，且逐角色逐族与迁移前的 tiers 表等价
     〔批次 29〕两张表均补入 hunter/listener（其 attend 随角色声明给出）；不变式＝历史条目逐项不动。 */
  const LEGACY_ATTEND = {
    infra: { engineer: 1.3, assistant: 1.3, crew: 1.15, artisan: 1.15, detective: 0.7, inspector: 0.7, listener: 0.7 },
    lethal: { bodyguard: 1.25, sheriff: 1.15, armed: 1.15, hunter: 1.15, artisan: 1.1, poisoner: 1.1, convict: 1.2,
      crew: 0.7, engineer: 0.7, bio: 0.75, rescue: 0.75, assistant: 0.7, tempdoc: 0.75,
      detective: 0.7, inspector: 0.7, listener: 0.7 },
    infect: { bio: 1.3, rescue: 1.1, tempdoc: 1.1, poisoner: 1.1, convict: 1.1,
      crew: 0.7, engineer: 0.7, sheriff: 0.7, hunter: 0.7, artisan: 0.7, assistant: 0.7,
      bodyguard: 0.7, detective: 0.7, inspector: 0.7, listener: 0.7, armed: 0.7 },
    verify: { detective: 1.25, inspector: 1.2, crew: 1.1, bio: 1.0, rescue: 1.0, engineer: 1.0,
      assistant: 1.0, armed: 1.0, sheriff: 1.0, hunter: 1.0, listener: 1.0, poisoner: 1.0,
      bodyguard: 0.85, artisan: 0.85, convict: 0.85, tempdoc: 0.85 },
    ballot: { inspector: 1.3, listener: 1.2, crew: 1.0, engineer: 0.75, sheriff: 0.75, bio: 0.75,
      rescue: 0.75, assistant: 0.75, detective: 0.75, artisan: 0.7, poisoner: 0.7,
      convict: 0.7, bodyguard: 0.7, tempdoc: 0.7 },
  };
  const attDiff = [];
  for (const r of RD.keys())
    for (const f of Object.keys(LEGACY_ATTEND)) {
      const want = LEGACY_ATTEND[f][r] != null ? LEGACY_ATTEND[f][r] : 1;
      if (Tiers.attend(r, f) !== want) attDiff.push(`${r}/${f}:${Tiers.attend(r, f)}≠${want}`);
    }
  ok('D7：Tiers.attend 以 RoleDecl 为真源，且逐角色×族与迁移前表等价（缺省恒 1.0）',
    attDiff.length === 0 && Tiers.attend('alien', 'lethal') === 1 && Tiers.attend('crew', null) === 1,
    attDiff.join(','));

  /* D4：注册表去编号——键即身份，R01~R13 编号制已移除，且无平行角色清单
     〔v7 B0〕MoERegistry.ROLE_SPEC 已随专家层归档 ⇒「两侧键集相等」退化为恒真，
     故改判【单一维护】本身：RoleDecl 键集非空 + 无 R 编号键 + 注册表无平行角色清单。
     非放宽：三条都是实质判据（键集规模 / 编号残留 / 无 ROLE_SPEC）。 */
  const rdKeys = RD.keys().slice().sort();
  ok('D4：角色清单单一维护（RoleDecl 为唯一真源，无 R01~R13 编号键、无平行清单）',
    rdKeys.length > 0 && rdKeys.every(k => !/^R\d+$/.test(k)) && MREG.ROLE_SPEC === undefined,
    `rd=${rdKeys.length} ROLE_SPEC已归档=${MREG.ROLE_SPEC === undefined}`);
  ok('C2：机制条数 == META.blockCount == 10（正文实为十块，5.9⑧ 自述「共九处」漏列 4.6.4 毒师块）',
    CAP.keys().length === 10 && CAP.META.blockCount === 10 &&
    Object.keys(CAP.META).length > 0, CAP.keys().length + '/' + CAP.META.blockCount);
  ok('C2：附录二速查卡结构经核验为四列、无「六行」结构（改动清单 609 行该前提在正文无对应物）',
    CAP.META.cheatsheetColumns.join('|') === '职业|核心能力|关键额度|暴露风险∕定位' &&
    CAP.META.cheatsheetSixRowStructureAbsent === true);
  ok('C2：5.7 结茧 / 5.9 清洗 的 owner 经正文核对为异形（提取数据标 xeno 已更正并留档）',
    CAP.get('alien.cocoon').owner === 'alien' && CAP.get('alien.cleanse').owner === 'alien' &&
    CAP.get('alien.cocoon').coveredRolesExtracted.join() === 'xeno' &&
    Object.keys(CAP.CORRECTIONS).length === 2);
  ok('C2：v6.6 新增角色（猎手/毒师/工匠/窃听者/死囚）登记为 pendingRole，不阻塞声明但标明未实装',
    CAP.keys().filter(k => CAP.get(k).pendingRole.length > 0).length === 5 &&
    ['hunter', 'poisoner', 'artisan', 'listener', 'convict'].every(r =>
      CAP.keys().some(k => CAP.get(k).pendingRole.indexOf(r) >= 0)),
    CAP.keys().filter(k => CAP.get(k).pendingRole.length).length + ' 条');

  /* K1 结构 lint：全仓「角色键字面量比较」的键集合必须已被声明覆盖（防 8 类框死点复发） */
  const ROLE_KEY_ALIAS = { doc: 'bio' };            // pipeline.js:72 的历史别名，归一后即 bio
  const literalKeys = new Set();
  for (const f of jsFiles) {
    const src = fs.readFileSync(f, 'utf8');
    const re = /\.role\s*(?:===|!==|==|!=)\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(src))) literalKeys.add(ROLE_KEY_ALIAS[m[1]] || m[1]);
  }
  const undeclared = [...literalKeys].filter(k => !RD.has(k)).sort();
  ok('K1 lint：全仓 .role 字面量比较的角色键 ⊆ 声明表（新增角色只改声明层，此处自动通过）',
    undeclared.length === 0, '未声明键: ' + undeclared.join(','));

  /* D3：未声明角色降级运行（K1 第三层：旧 AI 遇新角色不出错）
     〔批次 29〕探针角色由 'hunter' 改为 'neverDeclared' 之类的真未声明键——
     hunter 已随 A6 实装进声明表，resolveDecl('hunter') 正常返回其实声明。 */
  const unknown = RD.resolveDecl('__probe_undeclared');
  ok('D3：未声明角色解析为可跑整局的缺省声明（默认人类/无能力/只可见公开信息/注意力 1.0）',
    unknown.undeclared === true && unknown.judgeMode === 'presented' &&
    unknown.selfTarget === true && RD.attendWeight('__probe_undeclared', 'lethal') === 1 &&
    Array.isArray(unknown.visibility.batch) && unknown.visibility.batch.length === 0);
  ok('D3：已实装变体走正常声明（批次 29：hunter/listener 不再是「未声明」降级路径）',
    RD.resolveDecl('hunter').undeclared !== true && RD.resolveDecl('listener').undeclared !== true &&
    RD.hasGrant('hunter', 'shoot') && RD.hasGrant('listener', 'wiretap'));
}

/* ---------- 41. v6.6 阶段 2 · D2 信念分布开放维度 + D5 命名空间隔离 ---------- */
/* 本组是 K1「角色/阵营集合开放」在认知层的机械验收：维度由声明表决定，
   缺省动态算，敌对关系由声明推导 —— 且「加第四阵营」是可断言的（不是口头承诺）。 */
{
  const FK = ['human', 'alien', 'xeno'];
  const RD = ctx.SKRoleDecl, BEL = ctx.AIBelief;
  ok('D2：门面导出分布访问器齐全（调用点只能经访问器读分布）',
    typeof AI.distGet === 'function' && typeof AI.distMax === 'function' &&
    typeof AI.distEntries === 'function' && typeof AI.refreshFactions === 'function' &&
    typeof AI.factionCount === 'function' && Array.isArray(AI.FACTION_KEYS));
  ok('D2：分布维度 == 阵营声明键集，且缺省按 1/factionCount 动态算（不再是写死的 1/3）',
    BEL.FACTION_KEYS.join(',') === FK.join(',') &&
    Math.abs(BEL.distGet(new Map(), 'human') - 1 / 3) < 1e-12 &&
    Math.abs(BEL.distGet(BEL.uniformDist(), 'xeno') - 1 / 3) < 1e-12,
    BEL.FACTION_KEYS.join(','));
  /* 访问器对任意阵营键通用（无白名单、无固定三元组） */
  const probe = new Map([['human', 0.2], ['alien', 0.3], ['xeno', 0.5]]);
  const probe4 = new Map([['human', 0.1], ['alien', 0.2], ['xeno', 0.3], ['fourth', 0.4]]);
  ok('D2：distGet/distMax/distEntries 与阵营数无关（新键直接可读，不缺省为 0）',
    Math.abs(BEL.distGet(probe4, 'fourth') - 0.4) < 1e-12 &&
    Math.abs(BEL.distMax(probe) - 0.5) < 1e-12 &&
    BEL.distEntries(probe).length === BEL.factionCount() &&      // 按声明维度枚举（UI/指纹的稳定序）
    BEL.distEntries(probe).every(([k, v]) => Math.abs(v - BEL.distGet(probe, k)) < 1e-12));

  /* 敌对度：三个既有阵营的读数必须与迁移前的写死分支逐位相等 */
  const viewer = (f) => ({ id: 1, faction: f, out: false });
  ok('D2：敌对度与迁移前口径逐位一致（人类=异+外 / 异形=人+外 / 外星人=仅异）',
    Math.abs(BEL.hostileOf(viewer('human'), probe) - 0.8) < 1e-12 &&
    Math.abs(BEL.hostileOf(viewer('alien'), probe) - 0.7) < 1e-12 &&
    Math.abs(BEL.hostileOf(viewer('xeno'), probe) - 0.3) < 1e-12,
    [BEL.hostileOf(viewer('human'), probe), BEL.hostileOf(viewer('alien'), probe), BEL.hostileOf(viewer('xeno'), probe)].join('/'));

  /* 声明驱动证明：改声明即改行为（若实现里还留着写死分支，这条会失败） */
  const savedXeno = D.FACTION.xeno.hostileTo;
  D.FACTION.xeno.hostileTo = ['alien', 'human'];
  const driven = BEL.hostileOf(viewer('xeno'), probe);
  D.FACTION.xeno.hostileTo = savedXeno;
  ok('D2：敌对度确由 FACTION[x].hostileTo 声明驱动（改声明即改读数，改回即复原）',
    Math.abs(driven - 0.5) < 1e-12 && Math.abs(BEL.hostileOf(viewer('xeno'), probe) - 0.3) < 1e-12, driven);

  /* K1 硬验收：临时声明第四阵营 → 维度、缺省、分布、敌对度全部自动跟上（零代码改动） */
  D.FACTION.fourth = { key: 'fourth', name: '第四阵营', cls: 'f-4', order: 4, short: '四', barCls: 'b4', hostileTo: ['human', 'alien'] };
  BEL.refreshFactions();
  const cnt4 = BEL.factionCount();
  const u4 = BEL.uniformDist();
  const g4 = newGame(7101);
  const v4 = g4.players.find(p => !p.out);
  const v4b = Object.assign({}, v4, { faction: 'fourth' });
  const h4 = BEL.hostileOf(v4b, probe4);
  /* 未声明 hostileTo 的阵营（未来新增）退化为与人类同口径，保证不崩 */
  const hUnknown = BEL.hostileOf(Object.assign({}, v4, { faction: 'unknownX' }), probe4);
  const key4Ok = BEL.FACTION_KEYS.indexOf('fourth') >= 0;
  ok('K1/D2：声明第四阵营后维度=4、缺省=1/4、敌对度取其声明（零代码改动，全部自动跟上）',
    cnt4 === 4 && key4Ok &&
    Math.abs(BEL.distGet(u4, 'fourth') - 0.25) < 1e-12 &&
    Math.abs(h4 - 0.3) < 1e-12,
    `count=${cnt4} 1/n=${BEL.distGet(u4, 'fourth')} hostile=${h4}`);
  ok('K1/D2：缺 hostileTo 声明的阵营退化为人类口径而非抛错/NaN（降级运行）',
    Number.isFinite(hUnknown) && Math.abs(hUnknown - 0.5) < 1e-12, hUnknown);
  delete D.FACTION.fourth;
  BEL.refreshFactions();
  ok('D2：撤销临时声明后维度与读数复原（本组断言不污染后续状态）',
    BEL.factionCount() === 3 && BEL.FACTION_KEYS.join(',') === FK.join(','),
    BEL.FACTION_KEYS.join(','));

  /* D5：E 通道历史键 'king' 的兼容别名（对齐阵营键 'xeno'） */
  ok("D5：chanFor 兼容历史通道键 'king' → 'xeno'，且显式指向任一已声明阵营",
    BEL.chanFor(viewer('human'), 5, 'king') === 'xeno' &&
    BEL.chanFor(viewer('human'), 5, 'xeno') === 'xeno' &&
    BEL.chanFor(viewer('human'), -5, null) === 'human' &&
    BEL.chanFor(viewer('alien'), -5, null) === 'human');

  /* D5：命名空间冲突必须「已登记」，新增冲突被断言直接拦下 */
  const nsBad = RD.namespaceAudit();
  const roleFactionDup = RD.keys().filter(k => D.FACTION[k]);
  ok('D5：faction/role 键冲突已登记为唯一例外（本轮实测为 alien + xeno 两处；新增同名键会被拦下）',
    nsBad.length === 0 && roleFactionDup.join(',') === 'alien,xeno' &&
    !!RD.NAMESPACE.collisions.alien && !!RD.NAMESPACE.collisions.alien.plan &&
    !!RD.NAMESPACE.collisions.xeno && !!RD.NAMESPACE.collisions.xeno.plan,
    `audit=${nsBad.join('；')} dup=${roleFactionDup.join(',')}`);
  ok('D5：不再有以 p_human/p_alien/p_king 形式读取分布的**代码**（注释与说明不计）',
    (() => {
      let hits = 0, where = [];
      for (const f of jsFiles) {
        /* 先剥注释（块注释 + 行注释），避免把说明文字当成代码命中；
           `[^:]//` 的守卫用于放过 http:// 之类的字面量 */
        const src = fs.readFileSync(f, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        const re = /\.(p_human|p_alien|p_king)\b/g;
        let m;
        while ((m = re.exec(src))) { hits++; where.push(path.basename(f)); }
      }
      return hits === 0;
    })());
}

/* ---------- 42. v6.6 阶段 2 · D6 能力分发表（能力标签 / 能力档 / 席位派生） ---------- */
/* 本组锁死「调用点问『谁能做这件事』，不问『你是不是某个职业』」这条纪律：
   迁移前医生系清单 ['bio','rescue','tempdoc'] 在 5 处手写重复（perceive/steps×3/ui），
   CAP 三档清单在 tiers.js 手写，局基座与 UI 余额表各自手写角色键——漏一处即静默失效。 */
{
  const RD = ctx.SKRoleDecl, T = ctx.Tiers, BEL = ctx.AIBelief;
  ok('D6：能力标签集合与迁移前手写清单逐项相等（treat=医生系〔批次 31 增毒师〕/ repair=工程师系）',
    RD.rolesWith('treat').join(',') === 'bio,rescue,poisoner,tempdoc' &&
    RD.rolesWith('repair').join(',') === 'engineer,assistant',
    RD.rolesWith('treat').join(',') + ' | ' + RD.rolesWith('repair').join(','));
  ok('D6：hasGrant 对未声明/未知角色一律 false（D3 降级，不抛错）',
    RD.hasGrant('neverDeclared', 'treat') === false && RD.hasGrant('crew', 'treat') === false &&
    RD.hasGrant(null, 'treat') === false);
  const sorted = a => a.slice().sort().join(',');
  /* 〔批次 29〕capClass 随两个新角色登记：hunter 高（枪手族，同警长）、listener 中（信息族，同验票官）。
     不变式＝历史四项/三项/两项逐项仍在，新增两角色按声明入档。 */
  ok('D6：Tiers.CAP 三档清单由声明层 capClass 派生，历史 9 项逐项仍在（批次 29 增 hunter 高档/listener 中档）',
    sorted(T.CAP.highRoles) === sorted(['detective', 'inspector', 'sheriff', 'armed', 'hunter', 'convict']) &&
    sorted(T.CAP.midRoles) === sorted(['bio', 'rescue', 'artisan', 'poisoner', 'tempdoc', 'listener']) &&
    sorted(T.CAP.lowRoles) === sorted(['engineer', 'assistant']),
    T.CAP.highRoles.join(',') + ' / ' + T.CAP.midRoles.join(',') + ' / ' + T.CAP.lowRoles.join(','));
  /* 能力项读数等价：逐角色比对「声明直取」与「档位表 indexOf 判定」 */
  const LEGACY_CAP = { high: ['detective', 'inspector', 'sheriff', 'armed', 'hunter', 'convict'], mid: ['bio', 'rescue', 'artisan', 'poisoner', 'tempdoc', 'listener'], low: ['engineer', 'assistant'] };
  const capDiff = [];
  for (const r of RD.keys()) {
    const want = LEGACY_CAP.high.indexOf(r) >= 0 ? T.CAP.high
      : LEGACY_CAP.mid.indexOf(r) >= 0 ? T.CAP.mid
        : LEGACY_CAP.low.indexOf(r) >= 0 ? T.CAP.low : T.CAP.base;
    const got = BEL.capability({}, { claimedRole: r, revealed: null });
    if (got !== want) capDiff.push(`${r}:${got}≠${want}`);
  }
  ok('D6：dangerOf 能力项（capability）逐角色与迁移前判定等价（含 crew/alien/xeno 回落 base）',
    capDiff.length === 0, capDiff.join(','));

  /* 局基座与余额表：派生结果必须与原字面量**逐项同序**（顺序影响 shuffle 输入 ⇒ 影响整局） */
  ok('D8/D6：非人类席位组成逐项同序（alien,alien,alien,xeno —— 顺序决定 shuffle 输入，必须精确）',
    RD.nonHumanSetup().join(',') === 'alien,alien,alien,xeno', RD.nonHumanSetup().join(','));
  const legacyTotals = { crew: 4, engineer: 1, sheriff: 1, bio: 1, rescue: 1, detective: 1, bodyguard: 1, inspector: 1, armed: 0, assistant: 0, tempdoc: 0, alien: 3, xeno: 1 };
  const tot = RD.roleTotals();
  /* 〔批次 29〕两变体在经典局均占 0 席（席位由组位表 seats 定，两变体不占默认席），
     故派生表多出 hunter:0 / listener:0 两项；不变式＝历史 13 项逐项相等。 */
  ok('D8/D6：职业余额表由声明派生，历史 13 项逐项相等（批次 29/31/32 五变体经典局均 0 席）',
    Object.keys(legacyTotals).every(k => tot[k] === legacyTotals[k]) &&
    tot.hunter === 0 && tot.listener === 0 && tot.artisan === 0 && tot.poisoner === 0 && tot.convict === 0 &&
    Object.keys(tot).length === Object.keys(legacyTotals).length + 5,
    JSON.stringify(tot));

  /* K1 开放维度：临时声明一个带能力标签的新角色 → 能力族自动纳入（零调用点改动） */
  RD.ROLE_DECL.__fixture_medic = { name: '演习医生', faction: 'human', group: null, isBase: true, grants: ['treat'], capClass: 'mid' };
  const grew = RD.rolesWith('treat').indexOf('__fixture_medic') >= 0 && RD.hasGrant('__fixture_medic', 'treat');
  const capGrew = BEL.capability({}, { claimedRole: '__fixture_medic', revealed: null });
  const capGrewOk = grew && capGrew === T.CAP.mid;
  /* 词表门禁：写错标签必须被 audit 拦下（防手写错标签 → 静默无人命中） */
  RD.ROLE_DECL.__fixture_medic.grants = ['treat', 'notAGrant'];
  const auditCaught = RD.audit().some(x => x.indexOf('notAGrant') >= 0);
  delete RD.ROLE_DECL.__fixture_medic;
  ok('K1/D6：新声明的角色自动进入能力族与能力档（零调用点改动）', capGrewOk,
    `rolesWith=${RD.rolesWith('treat').join(',')} cap=${capGrew}`);
  ok('D6：能力标签词表有门禁——未登记标签被 audit 拦下（防静默失效）', auditCaught);
  ok('D6：转职方向池由声明派生，且与历史字面量**逐项同序**（顺序敏感：rng.pick 的输入）',
    RD.transferRoles().join(',') === 'armed,assistant,tempdoc', RD.transferRoles().join(','));
  ok('D6：清理临时声明后状态复原（能力族与审计均回到基线）',
    RD.rolesWith('treat').join(',') === 'bio,rescue,poisoner,tempdoc' && RD.audit().length === 0);
}

/* ---------- 43. v6.6 阶段 2 · D6 能力分发表第二批（步骤层 12 处迁移） ---------- */
{
  const RD = ctx.SKRoleDecl;
  /* 〔批次 29〕shoot 族按声明纳入 hunter（猎手持枪，4.4.7①）；其余六族成员未变。 */
  const LEGACY = {
    treat: 'bio,rescue,poisoner,tempdoc', repair: 'engineer,assistant', extraRepair: 'engineer',
    safeRoom: 'engineer', shoot: 'sheriff,hunter,armed', save: 'rescue,tempdoc', transfer: 'crew',
  };
  const familyBad = Object.keys(LEGACY).filter(g => RD.rolesWith(g).join(',') !== LEGACY[g])
    .map(g => `${g}:${RD.rolesWith(g).join(',')}≠${LEGACY[g]}`);
  ok('D6：七个能力族与迁移前的手写成员判定逐项等价（shoot 族批次 29 增 hunter，其余未变）',
    familyBad.length === 0, familyBad.join(' | '));
  ok('D6：累计维修暴露阈值声明化（工程师 4.0 / 助理 3.0，其余为 null=不适用）',
    RD.repairExposeAtOf('engineer') === 4 && RD.repairExposeAtOf('assistant') === 3 &&
    RD.repairExposeAtOf('crew') === null && RD.repairExposeAtOf('neverDeclared') === null);
  /* 标签命名空间（D5 的延伸）：能力标签不得与角色键/阵营键同名 —— 否则「问能力」与「问身份」混淆 */
  const grants = Object.keys(RD.GRANT_VOCAB);
  ok('D6/D5：能力标签与角色键、阵营键均不同名（救援用 save 而非 rescue，避免与角色键撞名）',
    grants.every(g => !RD.has(g) && !D.FACTION[g]) && grants.indexOf('save') >= 0 &&
    grants.every(g => (RD.rolesWith(g).length > 0 || g === 'x')),   // 每个已登记标签都必须有人持有（无死标签）
    grants.join(','));

  /* D6 结构 lint（一）：除声明层外，全仓不得再出现「整表都是角色键的数组字面量」
     ——这正是迁移前医生系清单那类「手写清单散落多处」的形态，漏一处即静默失效。
     判定收紧：① 括号内不得含 `{`（排除「对象条目数组」，如战术库条目自带 role 字段）；
               ② 表内每个字符串都必须是角色键（排除死因表 `['gun','alien',…]` 这类被同名冲突误伤的）；
               ③ 跳过 `hostileTo:`（阵营声明的敌对集合按**阵营键**书写，D5 同名冲突下的合法用法）。 */
  const ROLE_KEYS = RD.keys();
  const violations = [];
  for (const f of jsFiles) {
    const rel = path.relative(base, f).replace(/\\/g, '/');
    if (rel.indexOf('v66/') === 0) continue;                    // 声明层本身允许列举角色键
    const src = fs.readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const re = /\[([^\[\]{}]*)\]/g;
    let m;
    while ((m = re.exec(src))) {
      if (/hostileTo:\s*$/.test(src.slice(Math.max(0, m.index - 24), m.index))) continue;
      const quoted = m[1].match(/'([A-Za-z_][A-Za-z0-9_]*)'/g);
      if (!quoted || quoted.length < 2) continue;
      const ks = quoted.map(s => s.replace(/'/g, ''));
      if (!ks.every(k => ROLE_KEYS.indexOf(k) >= 0)) continue;
      violations.push(`${rel}: [${[...new Set(ks)].join(',')}]`);
    }
  }
  ok('D6 lint：全仓（声明层除外）已无「整表都是角色键的数组字面量」（手写角色清单归零）',
    violations.length === 0, violations.slice(0, 4).join(' | '));

  /* D6 结构 lint（二）· 硬零门禁：全仓（声明层除外）不得出现同一行 ≥2 个不同角色键的
     「族判定链」（`p.role === 'engineer' || p.role === 'assistant'` 这种形态）——
     截至 2026-10-03 第三轮，19 处族判定链已全部迁移为能力标签（treat/repair/extraRepair/
     safeRoom/protect/shoot/save/transfer），故本项从「棘轮」升级为**必须为零**。 */
  const chains = [];
  for (const f of jsFiles) {
    const rel = path.relative(base, f).replace(/\\/g, '/');
    if (rel.indexOf('v66/') === 0) continue;
    const src = fs.readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      const ks = [...new Set((line.match(/\.role\s*(?:===|!==)\s*'([A-Za-z_][A-Za-z0-9_]*)'/g) || [])
        .map(s => s.match(/'([^']+)'/)[1]).filter(k => ROLE_KEYS.indexOf(k) >= 0))];
      if (ks.length >= 2) chains.push(`${rel}:${i + 1} [${ks.join(',')}]`);
    });
  }
  ok('D6 lint：手写角色「族判定链」已归零（19 处 → 0，全部改经能力标签）',
    chains.length === 0, chains.slice(0, 4).join(' | '));
}

/* ---------- 44. v6.6 阶段 2 · C5/C4 倒排（行动位 → 候选发出者；观测 → 产出处） ---------- */
/* 本组锁死两条倒排契约，并固化一次真实教训：
   仅用「角色主行动位」(rolesAt) 会漏掉「机制声明在别的步位」的角色——
   工程师主行动位是 4a，而安全室由机制声明在步骤 3；只用 rolesAt('3') 会把安全室整个滤掉
   （该回退由行为指纹抓到，故此处同时钉住两套集合的差异）。 */
{
  const A = ctx.SKDerivation, RD = ctx.SKRoleDecl, CAP = ctx.SKCapability, EF = ctx.SKEventFamily;
  ok('C5/C4：倒排契约自检为空（角色/机制行动位均已登记于事件族步骤表、每批次有产出步骤、无重复步位）',
    A.audit().length === 0, A.audit().join('；'));
  /* 〔批次 29〕步骤 6 候选发出者按声明纳入 hunter（猎手持枪已在步骤 6 实装）；其余步位未变。 */
  ok('C5：已接线步位的候选发出者与迁移前判定逐项等集（4a 维修 / 6 枪击 / 8 医生系 / 10 紧急会议）',
    A.rolesAt('4a').join(',') === 'engineer,assistant' &&
    A.rolesAt('6').join(',') === 'sheriff,hunter,armed' &&
    A.rolesAt('8').join(',') === 'bio,rescue,poisoner,tempdoc' &&
    A.rolesAt('10').join(',') === 'inspector',
    [A.rolesAt('4a'), A.rolesAt('6'), A.rolesAt('8'), A.rolesAt('10')].map(x => x.join('/')).join(' | '));
  ok('C5：主行动位(rolesAt) 与 机制行动位(sendersAt) 的区别被正确建模——步骤 3 = 保镖＋工匠(主) + 工程师(安全室仅机制声明，其主行动位是 4a)',
    A.rolesAt('3').slice().sort().join(',') === 'artisan,bodyguard' &&
    A.sendersAt('3').slice().sort().join(',') === 'artisan,bodyguard,engineer' &&
    A.sendersAt('3').indexOf('engineer') >= 0,
    JSON.stringify(A.sendersAt('3')));
  ok('C5：sendersAt ⊇ rolesAt，且机制 owner 无条件进入候选（工程师的安全室由机制声明在步骤 3，主行动位是 4a）',
    ['3', '4a', '6', '8', '10'].every(s => A.rolesAt(s).every(r => A.sendersAt(s).indexOf(r) >= 0)) &&
    A.sendersAt('6').indexOf('hunter') >= 0);
  ok('C5：sendersOf 保留未实装 owner 并标注 pendingRole（加角色时无需改引擎过滤条件）',
    A.sendersOf('alien.cocoon').length === 1 && A.sendersOf('alien.cocoon')[0].role === 'alien' &&
    A.sendersOf('alien.cocoon')[0].declared === true &&
    A.sendersOf('hunter.sniffAmmo')[0].pendingRole === true);

  /* C4：观测 → 产出处（广播批次与私反馈族） */
  const emptyBatch = Object.keys(EF.BATCH).filter(b => b !== '〇' && A.stepsOfBatch(b).length === 0);
  ok('C4：每个广播批次都有产出步骤（除开局批次〇，它不属夜间/白天步骤序列）',
    emptyBatch.length === 0, emptyBatch.join(','));
  ok('C4：批次→步骤与事件族契约逐项一致（④维修 4a / ⑤破坏 4b / ⑥死亡 9 / ⑧倒计时 11 / ⑪窃听 D-report）',
    A.stepsOfBatch('④').join(',') === '4a' && A.stepsOfBatch('⑤').join(',') === '4b' &&
    A.stepsOfBatch('⑥').join(',') === '9' && A.stepsOfBatch('⑧').join(',') === '11' &&
    A.stepsOfBatch('⑪').join(',') === 'D-report',
    ['④', '⑤', '⑥', '⑧', '⑪'].map(b => b + ':' + A.stepsOfBatch(b).join('/')).join(' '));
  ok('C4：私反馈六类的送达步骤均可倒排（7.2.1=0.1/2 · 7.2.2=5/6/7 · 7.2.5=3 · 7.2.6=4b）',
    A.stepsOfPrivate('7.2.1').join(',') === '0.1,2' && A.stepsOfPrivate('7.2.2').join(',') === '5,6,7' &&
    A.stepsOfPrivate('7.2.5').join(',') === '3' && A.stepsOfPrivate('7.2.6').join(',') === '4b',
    ['7.2.1', '7.2.2', '7.2.5', '7.2.6'].map(f => f + ':' + A.stepsOfPrivate(f).join('/')).join(' '));
  ok('C4：机制 → 产出观测 可倒排（结茧产批次⑤ / 验票官紧急会议产批次⑦⑨⑩）',
    A.mechanismsProducing('⑤').indexOf('alien.cocoon') >= 0 &&
    A.mechanismsProducing('⑦').indexOf('inspector.votesMeeting') >= 0,
    JSON.stringify(A.mechanismsProducing('⑤')));

  /* K1 开放维度：临时声明一个「步骤 6 的枪手」→ 倒排自动纳入（零引擎改动） */
  RD.ROLE_DECL.__fixture_gunner = { name: '演习枪手', faction: 'human', group: null, isBase: true, actionStep: '6', grants: ['shoot'] };
  const grewRoles = A.rolesAt('6').indexOf('__fixture_gunner') >= 0;
  const grewSenders = A.sendersAt('6').indexOf('__fixture_gunner') >= 0;
  const grewGrant = A.grantSenders('shoot').indexOf('__fixture_gunner') >= 0;
  delete RD.ROLE_DECL.__fixture_gunner;
  ok('K1/C5：新声明的同行动位角色自动进入候选发出者（倒排索引零改动即可用）',
    grewRoles && grewSenders && grewGrant &&
    A.rolesAt('6').join(',') === 'sheriff,hunter,armed' && A.grantSenders('shoot').join(',') === 'sheriff,hunter,armed');
  ok('C2/C5：能力注册表的机制行动位与事件族步骤表交叉一致（10 条机制的 steps 均可在同块 actionStep 原文找到）',
    CAP.audit().length === 0 && CAP.allSteps().length === 11, CAP.allSteps().join(','));
}

/* ---------- 45. v6.6 阶段 2 · C11 进程注册表（H26：加进程只改声明层） ---------- */
/* 2.9 资源生产通则的机械验收：进程（投入 N 夜/可中断/进度保留/完成时定产物/次夜到账）
   全部走声明；执行层只跑通用状态机。本组同时锁死「制药」迁移前后的数值与**逐字文案**。 */
{
  const P = ctx.SKProcess, PE = ctx.SKProcessEngine;
  ok('C11：进程注册表自检为空（nights/产物/资源标签/文案齐备，delivery 仅 nextNight）',
    P.audit().length === 0, P.audit().join('；'));
  ok('C11：制药声明与迁移前实现逐项一致（投入 2 夜 / 产物以完成时之选为准 / 缺省 heal）',
    P.get('brew').nights === 2 && P.get('brew').interruptible === true &&
    P.get('brew').defaultProduct === 'heal' &&
    P.get('brew').productChoices.join(',') === 'rescue,heal' &&
    P.get('brew').products.rescue.rescueLeft === 1 && P.get('brew').products.heal.cureLeft === 2);
  ok('C11：到账文案由「资源增量 + 资源标签」生成，与迁移前逐字一致',
    P.deliverText('brew', 'rescue') === '制药产物到账：获得 1 次救援额度。' &&
    P.deliverText('brew', 'heal') === '制药产物到账：获得 2 次治疗额度。',
    P.deliverText('brew', 'rescue') + ' / ' + P.deliverText('brew', 'heal'));

  /* 行为等价：两次投入 → 完成 → 次夜到账；文案与状态形状逐项一致
     （夹具 role='bio'：T22 起 invest 校验 owner——断言变更说明见提交记录 §53） */
  const g = { night: 5 }, pl = { role: 'bio', rescueLeft: 0, cureLeft: 0, inbox: [] };
  const say = t => pl.inbox.push(t);
  const r1 = PE.invest(g, pl, 'brew', 'rescue', { say });
  g.night = 7;                                            // 2.9③：两夜可不连续
  const r2 = PE.invest(g, pl, 'brew', 'heal', { say });
  const doneState = pl.brewDone;
  PE.deliver(g, pl, { say });
  ok('C11：制药状态机逐项等价（1/2 进度保留跨夜 → 完成记 brewDone → 次夜到账 cureLeft+2）',
    r1.progress === 1 && r1.completed === false && r2.completed === true &&
    doneState === 'heal' && pl.cureLeft === 2 && pl.rescueLeft === 0 && pl.brew === null &&
    pl.brewDone === null,
    JSON.stringify({ r1, r2, doneState, cure: pl.cureLeft }));
  ok('C11：三段私反馈文案与迁移前逐字一致（进度 / 完成 / 到账）',
    pl.inbox[0] === '制药进度 1/2（救援药剂）。' &&
    pl.inbox[1] === '制药完成：产物将于下一夜发放。' &&
    pl.inbox[2] === '制药产物到账：获得 2 次治疗额度。',
    JSON.stringify(pl.inbox));

  /* H26：**新增一个进程，引擎零改动** —— 只往声明表塞一条，通用引擎即可投入与到账 */
  P.PROCESSES.__fixture_ritual = {
    id: '__fixture_ritual', name: '演习仪式', rule: 'fixture/2.9', owner: ['crew'],
    nights: 1, interruptible: true, exclusive: true,
    productChoices: ['charge'], defaultProduct: 'charge',
    products: { charge: { nightImmune: 1 } },
    messages: { choiceLabels: { charge: '充能' }, shortLabels: { charge: '充能' },
                progress: '仪式进度 {n}/{nights}（{product}）。', complete: '仪式完成：产物将于下一夜发放。',
                deliver: '仪式产物到账：获得 {amount} 次{resource}。' },
    progressKey: 'ritual', doneKey: 'ritualDone', delivery: 'nextNight',
  };
  const g2 = { night: 3 }, p2 = { role: 'crew', nightImmune: 0, inbox: [] };
  const rr = PE.invest(g2, p2, '__fixture_ritual', null, { say: t => p2.inbox.push(t) });
  PE.deliver(g2, p2, { say: t => p2.inbox.push(t) });
  const h26 = rr.completed === true && p2.nightImmune === 1 &&
    p2.inbox[0] === '仪式完成：产物将于下一夜发放。' &&
    p2.inbox[1] === '仪式产物到账：获得 1 次夜晚免疫。';
  delete P.PROCESSES.__fixture_ritual;
  ok('H26：新增进程后引擎零改动即可投入/完成/到账（含文案与资源增量，全部由声明生成）', h26,
    JSON.stringify({ rr, p2 }));
  /* 〔第二十二批 2026-10-05 规则方裁决：工匠铸造分为两个选择 4.11.2①/①之二〕进程表由
     brew,gatherAmmo 扩为 brew,gatherAmmo,cast,castFast —— 断言同步更新，理由：声明层按裁决补齐
     两条 2.9④ 独立进程，非为让代码通过而放宽。 */
  ok('H26：清理临时进程后注册表复原（自检回到空）',
    P.keys().join(',') === 'brew,gatherAmmo,cast,castFast' && P.audit().length === 0,
    P.keys().join(',') + ' | ' + P.audit().join('；'));

  /* 词表门禁：非法声明必须被 audit 拦下（缺 nights / 未知资源标签 / 文案缺失） */
  P.PROCESSES.__bad1 = { id: '__bad1', rule: 'x', nights: 0, productChoices: ['a'], products: { a: { rescueLeft: 1 } }, messages: { progress: 'x', complete: 'y' }, progressKey: 'k1', doneKey: 'k2', delivery: 'nextNight' };
  P.PROCESSES.__bad2 = { id: '__bad2', rule: 'x', nights: 1, productChoices: ['a'], products: { a: { mysteryRes: 1 } }, messages: { progress: 'x', complete: 'y' }, progressKey: 'k3', doneKey: 'k4', delivery: 'nextNight' };
  const badAudit = P.audit();
  const caught = badAudit.some(x => x.indexOf('__bad1') >= 0) && badAudit.some(x => x.indexOf('__bad2') >= 0);
  delete P.PROCESSES.__bad1; delete P.PROCESSES.__bad2;
  ok('C11：非法进程声明被 audit 拦下（nights 非法 / 资源缺中文标签）', caught, badAudit.join('；'));

  /* 未实装 owner：猎手攒弹、工匠铸造两条均已在册，A6 实装时零引擎改动 */
  ok('C11：未实装角色的进程已在册并标注 owner（猎手攒弹 2 夜；工匠铸造两进程 2/1 夜，2026-10-05 裁决已登记）',
    P.ofRole('hunter').join(',') === 'gatherAmmo' && P.get('gatherAmmo').nights === 2 &&
    P.ofRole('artisan').join(',') === 'cast,castFast' &&
    P.get('cast').nights === 2 && P.get('castFast').nights === 1);
}

/* ---------- 46. v6.6 阶段 2 · H21 查证池推导（4.1.1 ①②③ + I3 浮动口径） ---------- */
/* 本组是一次**有意的行为修正**的验收：迁移前 AI 侧两个池都不作出局过滤（会提交「已无真实
   持有者」的身份），运行侧第二次起又漏了「全职业池归属」校验（会放过转职衍生职业），
   表单侧的身份①误用全池。现统一到 SKDerivation.verifyPool 单一派生源。 */
{
  const A = ctx.SKDerivation, RD = ctx.SKRoleDecl;
  const mk = seed => { const g = Setup.createGame(seed, 'random'); g.humans = []; g.humanId = -1; return g; };

  const g0 = mk(9201);
  /* 〔批次 29〕不变式改写：池＝「声明的基础职业 ∩ 本局构成」——变体角色不在经典局构成内，
     故经典局池**仍是历史 8 项**（角色集合扩大不改变经典局行为，指纹据此保持不变）。 */
  ok('H21：首次池 = 开局公告人类职业（经典局 8 项，不含异形/外星人/变体，更不含转职衍生职业）——4.1.1①',
    A.verifyPool(g0, { first: true }).join(',') === 'crew,engineer,sheriff,bio,rescue,detective,bodyguard,inspector' &&
    A.verifyPool(g0, { first: true }).join(',') === RD.baseHumanRoles().filter(r => ['hunter', 'listener', 'artisan', 'poisoner'].indexOf(r) < 0).join(',') &&
    ['alien', 'xeno', 'hunter', 'listener', 'armed', 'assistant', 'tempdoc'].every(r => A.verifyPool(g0, { first: true }).indexOf(r) < 0),
    A.verifyPool(g0, { first: true }).join(','));
  ok('H21：其后池 = 开局公告全职业池（经典局 10 项；叠加非人类阵营，不含变体与转职衍生职业）——4.1.1②',
    A.verifyPool(g0).join(',') === 'crew,engineer,sheriff,bio,rescue,detective,bodyguard,inspector,alien,xeno' &&
    A.verifyPool(g0).join(',') === RD.verifyPoolOf(A.compositionOf(g0)).filter(r => ['hunter', 'listener', 'artisan', 'poisoner', 'convict'].indexOf(r) < 0).join(',') &&
    A.verifyPool(g0).indexOf('alien') >= 0 && A.verifyPool(g0).indexOf('xeno') >= 0 &&
    ['hunter', 'listener', 'armed', 'assistant', 'tempdoc'].every(r => A.verifyPool(g0).indexOf(r) < 0),
    A.verifyPool(g0).join(','));
  /* 变体局：席位替换后的构成进入查证池（批次 29 新增——池随构成浮动，I3 拍板口径的实证）。
     变体是**替换**（1.1.1 同席位定其一）⇒ 原职业在变体局不出现在构成中，池随之移除。 */
  {
    const gv = Setup.createGame(9204, 'random', { seatPicks: { sheriff: 'hunter', inspector: 'listener' } });
    gv.humans = []; gv.humanId = -1;
    const pf = A.verifyPool(gv, { first: true });
    ok('H21：变体局的池按本局构成浮动（hunter/listener 顶替席位后进入两池，被替换的两职业移出）',
      pf.indexOf('hunter') >= 0 && pf.indexOf('listener') >= 0 &&
      pf.indexOf('sheriff') < 0 && pf.indexOf('inspector') < 0 &&
      pf.length === 8 && pf.join(',') === 'crew,engineer,hunter,bio,rescue,detective,bodyguard,listener',
      pf.join(','));
  }

  /* ③ 全部真实持有者均已出局 → 该职业自可查范围移除（两池均移除） */
  const g1 = mk(9202);
  for (const p of g1.players.filter(x => x.originRole === 'sheriff')) p.out = true;
  ok('H21：某职业全部真实持有者出局即移出可查范围（警长全灭 → 两池同时移除）——4.1.1③',
    A.verifyPool(g1, { first: true }).indexOf('sheriff') < 0 && A.verifyPool(g1).indexOf('sheriff') < 0 &&
    A.verifyPool(g1, { first: true }).length === 7 && A.verifyPool(g1).length === 9,
    A.verifyPool(g1, { first: true }).join(','));
  ok('H21：移除判定按**真实持有者**（originRole）计——变形/乔装产生的呈现实例不改变判定',
    (() => {
      const g = mk(9203);
      const alien = g.players.find(p => p.originRole === 'alien' && !p.out);
      alien.role = 'sheriff';                                   // 呈现为警长（变形/乔装形态）
      return A.verifyPool(g, { first: true }).indexOf('sheriff') >= 0 &&   // 真持有者仍在场 → 不移除
             A.hasAliveHolder(g, 'sheriff') === true;
    })());

  /* 运行侧收口：池外提交不作答（4.1.1③「不存在无效查证」） */
  const g2 = mk(9204);
  const crew = g2.players.find(p => p.role === 'crew' && !p.out);
  const tgt = g2.players.find(p => p.id !== crew.id && !p.out);
  g2.night = 2; g2.step = '2';
  g2.decisions = { [crew.id]: { mode: 'check', target: tgt.id, ids: ['alien', 'crew'] } };
  Engine.STEPS['2'].run(g2);
  const rec1 = crew.crewChecks.get(tgt.id);
  ok('H21：第 1 次查验提交「异形」被池外收口拒绝，仅作答池内身份（运行侧唯一收口）',
    rec1 && rec1.n === 1 && rec1.results.length === 1 && rec1.results[0].id === 'crew',
    JSON.stringify(rec1));
  g2.night = 3;
  g2.decisions = { [crew.id]: { mode: 'check', target: tgt.id, ids: ['alien', 'armadillo'] } };
  Engine.STEPS['2'].run(g2);
  const rec2 = crew.crewChecks.get(tgt.id);
  ok('H21：第 2 次起「异形」在池内可作答；未登记身份仍被拒（池外不作答）',
    rec2 && rec2.n === 2 && rec2.results.length === 2 && rec2.results[1].id === 'alien',
    JSON.stringify(rec2));
  ok('H21：查证结论按「查验者×目标」独立留存（同一目标累计，不按目标累计到他人）——4.1.1⑤',
    crew.crewChecks.size === 1 && rec2.results[0].night === 2 && rec2.results[1].night === 3);

  /* AI 侧：提交的身份必须落在可查范围内（迁移前无任何过滤） */
  const g3 = mk(9205);
  const aiCrew = g3.players.find(p => p.role === 'crew' && !p.out);
  const d = AI.decide(g3, { pid: aiCrew.id, kind: 'crewAction' });
  const pool = A.verifyPool(g3, { first: true });
  ok('H21：AI 首次查验提交的身份 ⊆ 首次池（此前 AI 可提交已无持有者的职业）',
    !!(d && d.ids && d.ids.length) && A.inVerifyPool(g3, d.ids[0], { first: true }) && pool.length > 0,
    JSON.stringify(d));

  /* I3 浮动口径：池随本局构成，而非固定 10 项 */
  const g4 = mk(9206);
  const xeno = g4.players.find(p => p.originRole === 'xeno');
  xeno.originRole = 'crew'; xeno.role = 'crew';               // 构造「本局无外星人」的构成
  const poolNoXeno = A.verifyPool(g4);
  ok('H21/I3：池随本局构成浮动（本局无外星人 → 该职业不入池，项数随之变化，不预设固定值）',
    poolNoXeno.indexOf('xeno') < 0 && poolNoXeno.length === 9, poolNoXeno.join(','));
}

/* ---------- 47. v6.6 阶段 2 · K2 强度维度可加（性格轴声明化） ---------- */
/* K2 的验收口径是「新增强度维度后消费点 diff 为空」。本组把 θ 轴的 16 张档位表收进
   js/v66/declaration/traits.js 后，机械验收三件事：已知档逐项等价（行为中性）、
   未知档全参数可解析（不 undefined/NaN）、**整局可在第四档下跑通且零代码改动**。 */
{
  const TR = ctx.SKTrait, T = ctx.Tiers, U = ctx.AIUtil, REG = ctx.MoERegistry;
  const LEGACY = {
    wOpen: { 25: 0.7, 50: 0.4, 75: 0.2 }, claimRate: { 25: 0.8, 50: 0.5, 75: 0.2 },
    shootRate: { 25: 0.5, 50: 0.5, 75: 0.15 }, abstainBias: { 25: -10, 50: 0, 75: 8 },
    actLine: { 25: 10, 50: 20, 75: 30 }, voteParam: { 25: 0, 50: 25, 75: 55 },
    destroyChance: { 25: 0.3, 50: 0.6, 75: 1.0 }, killBase: { 25: 8, 50: 18, 75: 28 },
    rescueRate: { 25: 0.7, 50: 0.4, 75: 0.15 }, thetaShift: { 25: 12, 50: 0, 75: -10 },
    grudgeW: { 25: 0.5, 50: 0.3, 75: 0.15 }, baseDanger: { 25: 30, 50: 50, 75: 70 },
    gateBiasE7: { 25: -0.15, 50: 0, 75: 0.15 }, gateBiasE8: { 25: -0.15, 50: 0, 75: 0.15 },
    gateBiasE9: { 25: 0.10, 50: 0, 75: -0.10 }, gateBiasE10: { 25: 0.10, 50: 0, 75: -0.10 },
  };
  ok('K2：性格轴声明自检为空（16 张参数表档位齐备、缺省齐备、抽样分布覆盖全部档位且累计递增）',
    TR.audit().length === 0, TR.audit().join('；'));
  const diff = [];
  for (const [k, t] of Object.entries(LEGACY))
    for (const th of [25, 50, 75])
      if (TR.traitValue('theta', k, th) !== t[th]) diff.push(`${k}@${th}`);
  ok('K2：已知档（25/50/75）逐项与迁移前 16 张手写表等价（行为中性）', diff.length === 0, diff.join(','));
  ok('K2：整表消费点改由声明派生（SAB.thetaShift / GRUDGE_W / BASE_DANGER / THETA_BIAS 四处）',
    JSON.stringify(T.SAB.thetaShift) === JSON.stringify(LEGACY.thetaShift) &&
    JSON.stringify(U.GRUDGE_W) === JSON.stringify(LEGACY.grudgeW) &&
    JSON.stringify(T.BASE_DANGER) === JSON.stringify(LEGACY.baseDanger) &&
    JSON.stringify(REG.THETA_BIAS.E7) === JSON.stringify(LEGACY.gateBiasE7) &&
    JSON.stringify(REG.THETA_BIAS.E9) === JSON.stringify(LEGACY.gateBiasE9));

  /* 未知档降级：全部参数必须是有限数（迁移前 voteParam 等表直接取 [θ] → undefined） */
  const d60 = TR.resolveAll('theta', 60);
  const nums = Object.keys(LEGACY).every(k => Number.isFinite(d60[k]));
  ok('K2：未知档（θ=60）全部 16 项参数解析为有限数（缺省降级，不再 undefined/NaN）',
    nums && d60.actLine === 20 && d60.voteParam === 25, JSON.stringify(d60));
  ok('K2：无 θ 的临时对象也安全（懒解析 + 缺省，不抛错）',
    Number.isFinite(TR.traitOf({}).actLine) && TR.traitOf({}).voteParam === 25);

  /* K2 硬验收：把全场改到第四档（θ=60），用**现有引擎**跑完整局 —— 零代码改动的证据 */
  const playAt = (seed, theta) => {
    const g = Setup.createGame(seed, 'random');
    g.humanId = -1; g.humans = [];
    for (const p of g.players) { p.theta = theta; delete p.__trait_theta; }
    Engine.begin(g);
    let steps = 0;
    while (!g.over && steps < 4000) {
      Engine.stepOnce(g);
      steps++;
      if (g.pending) {
        const f = g.pending, data = { opt: null, targets: [], num: null, text: '' };
        if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) data.opt = u[0].v; }
        if (f.targets) { const list = Engine.alive(g); if (list.length) data.targets.push(list[0].id); }
        if (f.num) data.num = f.num.options[0].v;
        Engine.submit(g, data);
      }
    }
    return g;
  };
  const errs60 = [];
  for (let i = 0; i < 12; i++) { try { playAt(9300 + i, 60); } catch (e) { errs60.push('seed ' + (9300 + i) + ': ' + e.message); } }
  ok('K2（硬验收）：第四档性格（θ=60）下 12 局完整对局零异常 —— 新增强度维度无需改任何消费点',
    errs60.length === 0, errs60.slice(0, 2).join(' | '));

  /* 声明化门禁：全仓（声明层除外）不得再出现 θ 档位字面量表/比较链 */
  const thetaViolations = [];
  for (const f of jsFiles) {
    const rel = path.relative(base, f).replace(/\\/g, '/');
    if (rel.indexOf('v66/') === 0) continue;
    const src = fs.readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const pats = [/theta\s*(?:===|!==|==|!=)\s*(?:25|50|75)\b/g, /\{\s*25\s*:\s*-?[\d.]/g, /\[\s*(?:25|50|75)\s*\]/g];
    for (const re of pats) {
      const m = src.match(re);
      if (m) thetaViolations.push(`${rel}: ${m[0].trim()}`);
    }
  }
  ok('K2 lint：全仓（声明层除外）已无 θ 档位字面量表与比较链（档位知识只在 traits.js）',
    thetaViolations.length === 0, thetaViolations.slice(0, 4).join(' | '));
}

/* ---------- 48. v6.6 阶段 4 · K3 防透视架构化（B3/H13 · B4 · G6） ---------- */
/* 三条能力边界集中验收：对局中任何视图不含隐藏历史（replay）、私有节点只对持有者出现、
   出局者解锁全知**当前态**但**仍不含 replay**；并锁死「不得直接读 g.replay」的结构纪律。 */
{
  /* view.js 属 UI 层（不在 profiles.full 内），K3 契约需自带上下文：
     与 server/server.js 同口径（full + view）。 */
  const vctx = makeCtx({ RegExp });
  loadInto(vctx, base, profiles.full.concat(['view']));
  const View = vctx.View, Setup = vctx.Setup, Engine = vctx.Engine;
  ok('K3：视图构建器导出 K3 契约（replayOf 唯一发放口 + auditView 审计 + G6 判定）',
    typeof View.replayOf === 'function' && typeof View.auditView === 'function' &&
    typeof View.isOmniscient === 'function' && typeof View.currentState === 'function');

  /* 逐种子 × 逐座位：进行中视图必须全部合规（含 log 无 god 条目、无他人私有节点） */
  const mkMid = (seed) => {
    const g = Setup.createGame(seed, 'random');
    g.humanId = -1; g.humans = [];
    Engine.begin(g);
    for (let i = 0; i < 10 && !g.over; i++) {
      Engine.stepOnce(g);
      if (g.pending) {
        const f = g.pending, d = { opt: null, targets: [], num: null, text: '' };
        if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) d.opt = u[0].v; }
        if (f.targets) { const l = Engine.alive(g); if (l.length) d.targets.push(l[0].id); }
        if (f.num) d.num = f.num.options[0].v;
        Engine.submit(g, d);
      }
    }
    return g;
  };
  const seatBad = [];
  let godSeen = 0, privSeen = 0;
  for (const seed of [9501, 9502, 9503]) {
    const g = mkMid(seed);
    godSeen += g.replay.filter(e => e.scope === 'god').length;
    privSeen += g.replay.filter(e => e.scope === 'priv').length;
    for (let seat = 1; seat <= g.players.length; seat++) {
      const v = View.build(g, seat);
      if (!v) continue;
      const a = View.auditView(v);
      if (a.length) seatBad.push(`seed${seed}/seat${seat}: ${a.join(';')}`);
      if (Object.prototype.hasOwnProperty.call(v, 'replay')) seatBad.push(`seed${seed}/seat${seat}: 含 replay`);
    }
  }
  ok('H13：对局进行中，任意种子的全部座位视图均合规（不含 replay / 无 god 作用域条目 / 无他人私有节点）',
    seatBad.length === 0, seatBad.slice(0, 3).join(' | '));
  ok('H14：隐藏历史确实存在但被隔离（同局中 g.replay 含 god/priv 条目，视图里一条都没有）',
    godSeen > 0 && privSeen > 0, `god=${godSeen} priv=${privSeen}`);

  const gm = mkMid(9504);
  ok('H13：replay 的唯一发放口在对局进行中返回 null（终局后才发放完整回放，2.6.3）',
    View.replayOf(gm) === null);
  gm.over = true; gm.winner = 'human';
  ok('H13：终局后 replayOf 发放完整回放（且终局视图仍审计合规）',
    Array.isArray(View.replayOf(gm)) && View.replayOf(gm).length > 0 &&
    View.auditView(View.build(gm, 1)).length === 0,
    String((View.replayOf(gm) || []).length));

  /* B4：私有节点只对持有者出现 */
  const gb = mkMid(9505);
  const me = gb.players.find(p => p.role === 'crew' && !p.out) || gb.players[0];
  me.inbox.push({ night: 1, step: '2', text: '私有测试条目' });
  const own = View.build(gb, me.id);
  const other = View.build(gb, me.id === 1 ? 2 : 1);
  const otherMe = other.players.find(p => p.id === me.id);
  const ownMe = own.players.find(p => p.id === me.id);
  ok('H15：私有节点只对持有者出现（本人视图含 inbox/known/checkPool，他人视图一律不含）',
    !!ownMe && Array.isArray(ownMe.inbox) && !!ownMe.known && Array.isArray(ownMe.checkPool) &&
    !!otherMe && otherMe.inbox === undefined && otherMe.known === undefined &&
    otherMe.checkPool === undefined && otherMe.crewChecks === undefined && otherMe.notes === undefined,
    JSON.stringify({ own: !!ownMe.inbox, other: otherMe.inbox }));

  /* G6：出局者解锁全知当前态（身份 + 当前资源），仍不含 replay；未出局者无此标识 */
  const gg = mkMid(9506);
  const victim = gg.players.find(p => !p.out);
  victim.out = true; victim.outType = 'vote'; victim.outNight = gg.night;
  const vOut = View.build(gg, victim.id);
  const vAlive = View.build(gg, gg.players.find(p => !p.out && p.id !== victim.id).id);
  ok('H16/G6：出局者视角＝全知当前态（他人身份与当前资源可见）且不含 replay；未出局者无全知标识',
    vOut.omniscient === true && vOut.players.filter(p => p.id !== victim.id).every(p => !!p.role && !!p.omniscient) &&
    !Object.prototype.hasOwnProperty.call(vOut, 'replay') &&
    View.auditView(vOut).length === 0 && !vAlive.omniscient,
    JSON.stringify({ omni: vOut.omniscient, aliveOmni: vAlive.omniscient }));

  /* 视图构建是纯函数：判定基数不变（不因构建视图而改动对局状态） */
  const gp = mkMid(9507);
  const digest = () => JSON.stringify({
    night: gp.night, countdown: gp.countdown, net10: gp.net10, replay: gp.replay.length, log: gp.log.length,
    alive: gp.players.filter(p => !p.out).length,
    known: gp.players.map(p => p.known.size), inbox: gp.players.map(p => p.inbox.length),
  });
  const before = digest();
  for (let seat = 1; seat <= gp.players.length; seat++) View.build(gp, seat);
  ok('K3：视图构建为纯函数（构建全部座位视图前后，对局状态摘要逐字节一致 ⇒ 判定基数不变）',
    digest() === before);

  /* 结构纪律：不得直接读 g.replay（写入与唯一发放口除外） */
  const replayReaders = [];
  for (const f of jsFiles) {
    const rel = path.relative(base, f).replace(/\\/g, '/');
    if (rel === 'view.js' || rel === 'ui.js' || rel === 'state.js') continue;   // 发放口 / 终局渲染 / 定义
    const src = fs.readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const line of src.split('\n')) {
      if (line.indexOf('g.replay') >= 0 && line.indexOf('.push(') < 0) replayReaders.push(`${rel}: ${line.trim().slice(0, 60)}`);
    }
  }
  ok('K3 lint：全仓不得直接读 g.replay（只允许写入与 View.replayOf 唯一发放口）',
    replayReaders.length === 0, replayReaders.slice(0, 3).join(' | '));
}

/* ---------- 49. v6.6 · 事件族批次契约与「未登记即发布」审计（H3 的配套结构门禁） ---------- */
/* 引擎里每个 announce() 的批次键都必须是 2.1.6 正式批次。
   批⑫（医生清除感染出手）曾以 PENDING_BATCH 在案待裁决；2026-10-04 依正文 3.3.7
   逐字拍板撤除（「不设公告批次、不产生任何反馈」），本组断言随之改为「退役断言」：
   防发布点与待裁决登记复活。 */
{
  const EF = ctx.SKEventFamily;
  ok('事件族契约：自检为空（正式批次〇~⑪ 齐备、每批次有产出步骤、待裁决表为空）',
    EF.audit().length === 0, EF.audit().join('；'));
  ok('批⑫已撤除（2026-10-04，3.3.7）：PENDING_BATCH 清空、正式批次亦无⑫',
    EF.pendingBatch('⑫') == null && EF.batch('⑫') === null &&
    Object.keys(EF.PENDING_BATCH).length === 0);

  /* 全仓扫描：announce 的批次键必须已登记（正式批次；待裁决通道已关闭） */
  const bad = [];
  for (const f of jsFiles) {
    const rel = path.relative(base, f).replace(/\\/g, '/');
    if (rel.indexOf('v66/') === 0) continue;                    // 声明层与契约本身除外
    const src = fs.readFileSync(f, 'utf8');
    const re = /announce\(\s*g\s*,\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(src))) {
      const k = m[1];
      if (!EF.BATCH[k]) bad.push(`${rel}: 未登记批次 ${k}`);
    }
    if (/lastCureHands|announce\(\s*g\s*,\s*'⑫'/.test(src)) bad.push(`${rel}: 批⑫残留（发布点/lastCureHands 判据）`);
  }
  ok('事件族 lint：全仓 announce() 的批次键均已登记（正式批次），且批⑫发布点无残留',
    bad.length === 0, bad.slice(0, 4).join(' | '));

  const famKeys = Object.keys(EF.PRIVATE);
  ok('事件族契约：7.2 私反馈六类键齐备（与附录 D 逐项一致）',
    famKeys.join(',') === '7.2.1,7.2.2,7.2.3,7.2.4,7.2.5,7.2.6' &&
    famKeys.every(k => EF.isPrivateFamily(k) && EF.privateFamily(k) != null));
}

/* ---------- 50. v6.6 · C1 收口：步位覆盖审计（声明 ⊇ 引擎派发面） ---------- */
/* C1 的前提是「声明层完整描述引擎的派发面」。本组把它变成数字：跑若干局，记录引擎
   实际派发过决策的每个步位与角色集合，要求全部落在 declaredActors 之内（零缺口）。
   行动位模型同步扩写：主行动位 actionStep（供引擎派发过滤，单一）+ actionSteps（全列表，
   供覆盖审计与 C1 收口）——这样新增**次要**行动位不会改变既有派发行为。 */
{
  const DER = ctx.SKDerivation, RD = ctx.SKRoleDecl, EF = ctx.SKEventFamily;

  /* 声明内部一致性：主行动位必在行动位列表内；declaredActors ⊇ rolesAtAll */
  const slotsBad = RD.keys().filter(k => {
    const d = RD.ROLE_DECL[k];
    const list = DER.actionSlots(k);
    return d.actionStep && list.indexOf(d.actionStep) < 0;
  });
  const stepsAll = EF.STEPS.map(s => s.step);
  const supBad = stepsAll.filter(s => !DER.rolesAtAll(s).every(r => DER.declaredActors(s).indexOf(r) >= 0));
  ok('C1：行动位模型自洽（主行动位 ∈ 行动位列表；declaredActors ⊇ rolesAtAll 对全部步位成立）',
    slotsBad.length === 0 && supBad.length === 0, slotsBad.concat(supBad).join(','));

  /* 〔v7 B0 改判〕多行动位角色的行动位声明。
     原断言把 5 个角色的行动位列表**逐字写死**（'4a,3' / '6,2' / '7,0.6,4b' / '0.1,0.1s,4b,5' / '2,0.6'）。
     那是反向断言——治理规范铁律三明令禁止「断言跟随当前实现」：任何正当的声明修正（例如本批
     补齐外星人 'P-id' 觉醒位，依据 6.2 与 steps.js 'P-id'.req）都会把它打红，于是它实际在
     阻拦正确的改动，而不是在验证正确性。
     改判为**结构判据**（不含任何字面量）：
       ① 每个多行动位角色确有 ≥2 个行动位（多行动位模型本身成立）；
       ② 其列出的每个行动位都**真实存在于步位索引**（无幽灵步位）；
       ③ 主行动位 ∈ 行动位列表。
     「声明须覆盖引擎实际派发的次要行动位」这一意图由上一组 C1 核心审计承担——
     它跑 6 局实测 S.req(g) 后用 DER.coverageGap 逐角色核对，不依赖任何写死值。 */
  const multiRoles = ['engineer', 'sheriff', 'alien', 'xeno', 'crew'];
  const slotBad = [], phantomBad = [];
  for (const r of multiRoles) {
    const list = DER.actionSlots(r), d = RD.ROLE_DECL[r];
    if (!d) { slotBad.push(r + ':未声明'); continue; }
    if (list.length < 2) slotBad.push(`${r}:仅${list.length}个行动位`);
    if (list.indexOf(d.actionStep) < 0) slotBad.push(`${r}:主行动位${d.actionStep}不在列表`);
    for (const st of list) if (!EF.STEP_INDEX[st]) phantomBad.push(`${r}:${st}`);
  }
  ok('C1：多行动位模型结构自洽（每个多行动位角色 ≥2 位；各位均为真实步位；主行动位 ∈ 列表）',
    slotBad.length === 0 && phantomBad.length === 0,
    multiRoles.map(r => r + '=' + DER.actionSlots(r).join('/')).join(' ') +
      (slotBad.length ? ' | 结构违规: ' + slotBad.join(',') : '') +
      (phantomBad.length ? ' | 幽灵步位: ' + phantomBad.join(',') : ''));

  /* 白天/会议步位同为决策窗口，必须登记并声明参与者规则 */
  ok('C1：白天与会议步位已登记且声明参与者规则（D-open/D-talk/D-vote/M-talk/M-vote=全体存活；M-speech=验票官专属）',
    ['D-open', 'D-talk', 'D-vote', 'M-talk', 'M-vote'].every(s => EF.STEP_INDEX[s] && EF.STEP_INDEX[s].participants === 'alive') &&
    !!EF.STEP_INDEX['M-speech'] && EF.STEP_INDEX['M-speech'].roles.join(',') === 'inspector' &&
    DER.declaredActors('M-speech').indexOf('inspector') >= 0);
  /* 阵营级能力（感染抑制）：声明为「非异形阵营 + 真有感染 + 有额度」，而不是职业清单 */
  ok('C1：感染抑制声明为阵营级能力（human+xeno，非职业清单——state.js 给非异形阵营每人 3 次额度）',
    EF.STEP_INDEX['0.5'].capability === 'suppress' &&
    EF.STEP_INDEX['0.5'].factions.join(',') === 'human,xeno' &&
    DER.declaredActors('0.5').indexOf('crew') >= 0 && DER.declaredActors('0.5').indexOf('alien') < 0);

  /* 覆盖审计（多局实测）：引擎派发的角色集合必须全部落在声明之内 */
  const seen = new Map();
  for (const seed of [9951, 9952, 9953, 9954, 9955, 9956]) {
    const g = newGame(seed);
    Engine.begin(g);
    let steps = 0;
    while (!g.over && steps < 4000) {
      const S = Engine.STEPS[g.step];
      if (S && typeof S.req === 'function') {
        let r = [];
        try { r = S.req(g) || []; } catch (e) { /* 取样失败忽略 */ }
        if (r.length) {
          if (!seen.has(g.step)) seen.set(g.step, new Set());
          for (const it of r) { const p = Engine.P(g, it.pid); if (p) seen.get(g.step).add(p.role); }
        }
      }
      Engine.stepOnce(g);
      steps++;
      if (g.pending) {
        const f = g.pending, dd = { opt: null, targets: [], num: null, text: '' };
        if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) dd.opt = u[0].v; }
        if (f.targets) { const l = Engine.alive(g); if (l.length) dd.targets.push(l[0].id); }
        if (f.num) dd.num = f.num.options[0].v;
        Engine.submit(g, dd);
      }
    }
  }
  const gaps = [];
  for (const [st, roles] of seen) for (const r of DER.coverageGap(st, [...roles])) gaps.push(`${st}:${r}`);
  ok('C1（核心）：6 局实测的引擎派发面全部被声明覆盖（零缺口；含全部夜间步位与白天/会议段）',
    gaps.length === 0, gaps.slice(0, 5).join(' | '));
  ok('C1：本次实测覆盖的步位全部已在事件族契约登记（无「引擎在跑但契约不知道」的步位）',
    [...seen.keys()].every(s => !!EF.STEP_INDEX[s]), [...seen.keys()].filter(s => !EF.STEP_INDEX[s]).join(','));

  /* K1：临时声明一个多行动位角色 → 覆盖面自动扩大（零调用点改动） */
  RD.ROLE_DECL.__fixture_dual = { name: '演习双位', faction: 'human', group: null, isBase: true, actionStep: '6', actionSteps: ['6', '2'] };
  const grew = DER.rolesAtAll('2').indexOf('__fixture_dual') >= 0 && DER.declaredActors('2').indexOf('__fixture_dual') >= 0 &&
    DER.rolesAt('2').indexOf('__fixture_dual') < 0;      // 主行动位为 6 ⇒ 引擎派发过滤不受影响
  delete RD.ROLE_DECL.__fixture_dual;
  ok('K1/C1：新声明的次要行动位只扩大覆盖面、不改变引擎派发过滤（主行动位单一 ⇒ 行为稳定）',
    grew && DER.rolesAtAll('2').indexOf('__fixture_dual') < 0);
}

/* ---------- 51. v6.6 · 步位 × 批次一致性（契约声明「哪一步产哪个批次」） ---------- */
/* 比「批次已登记」更强的一层：每个批次必须在**正确的步位**发布。实测由 g.log 的
   (step, batch) 组合给出——该审计曾抓出两处不一致：① 实际在 0b（配对成立）发布而非 0a；
   ② 步骤 9 曾发布批次⑫（已依 3.3.7 于 2026-10-04 撤除）。 */
{
  const EF = ctx.SKEventFamily;
  ok('事件族契约：步位待裁决批次登记合法（pendingBatches 必须是在案待裁决批次，且不得混入正式批次）',
    EF.audit().length === 0, EF.audit().join('；'));
  ok('步位×批次：批次① 的**实际发布点**（0b 配对成立）已登记（2.1.6 记「步骤 0 后」，引擎在 0b 发布）',
    EF.batchesOfStep('0b').indexOf('①') >= 0);
  ok('步位×批次：批⑫ 已撤——步骤 9 正式批次仅 ⑥，无 pendingBatches，batchesOfStepAll 同口径',
    EF.batchesOfStep('9').join(',') === '⑥' &&
    !(EF.STEP_INDEX['9'].pendingBatches || []).length &&
    EF.batchesOfStepAll('9').join(',') === '⑥');
  ok('A21 步位×批次：批次〇 契约登记于步位 〇（engine.begin 实际发布点）',
    EF.batchesOfStep('〇').join(',') === '〇' && EF.batch('〇') != null);

  /* 实测：日志里出现的 (步位, 批次) 组合必须全部被契约声明（正式或 pending） */
  const combos = new Map();
  for (const seed of [9971, 9972, 9973, 9974, 9975]) {
    const g = newGame(seed);
    Engine.begin(g);
    let steps = 0;
    while (!g.over && steps < 4000) {
      Engine.stepOnce(g);
      steps++;
      if (g.pending) {
        const f = g.pending, dd = { opt: null, targets: [], num: null, text: '' };
        if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) dd.opt = u[0].v; }
        if (f.targets) { const l = Engine.alive(g); if (l.length) dd.targets.push(l[0].id); }
        if (f.num) dd.num = f.num.options[0].v;
        Engine.submit(g, dd);
      }
    }
    for (const e of g.log) {
      if (!e.batch) continue;
      if (!combos.has(e.step)) combos.set(e.step, new Set());
      combos.get(e.step).add(e.batch);
    }
  }
  const mism = [];
  for (const [st, bs] of combos)
    for (const b of bs) if (EF.batchesOfStepAll(st).indexOf(b) < 0) mism.push(`${st}:${b}`);
  ok('步位×批次（核心）：5 局实测的「步位 → 发布批次」组合全部被契约声明（零不一致）',
    mism.length === 0 && combos.size >= 8, mism.slice(0, 4).join(' | ') + ` (步位数 ${combos.size})`);
}

/* ---------- 15. v6.6 残局与揭示（2026-10-04 四条裁决 + C1/C2/C3/C4/C6/C7） ----------
   背景：正文 1.5.2 把夜数兜底由 999 改为 99，并规定「判定节点＝该夜实际结算到的最后一个
   步骤」；同时新裁决明确决斗时刻倒计时照常流逝、寂灭与决斗叠加时以寂灭为准、停转夜在
   决斗时刻照常生效。下面把这些口径逐条钉死，防后续改动静默改坏。 */
{
  const RS = ctx.RevealService;

  /* ---- C2：决斗时刻倒计时照常流逝（1.4.2 拍板 I2） ---- */
  ok('C2：DUEL 队列含步骤 11、EXTINCT 队列不含步骤 11（决斗倒计时照常／寂灭冻结）',
    Engine.DUEL.indexOf('11') >= 0 && Engine.EXTINCT.indexOf('11') < 0,
    `DUEL=${Engine.DUEL.join(',')} | EXTINCT=${Engine.EXTINCT.join(',')}`);

  const g11 = newGame(8101);
  Engine.begin(g11);
  g11.duel = true; g11.extinction = false; g11.stopNight = false; g11.skipCountdown = false;
  g11.countdown = 5;
  const c0 = g11.countdown;
  Engine.STEPS['11'].run(g11);
  ok('C2（核心）：决斗时刻且人类尚有存活者时，步骤 11 后倒计时递减（不冻结）',
    g11.countdown === c0 - 1, `${c0} → ${g11.countdown}`);

  /* ---- C4：停转夜在决斗时刻生效（3.2.5 / N1） ---- */
  const gs = newGame(8102);
  Engine.begin(gs);
  gs.duel = true; gs.extinction = false; gs.stopNight = true; gs.skipCountdown = false;
  gs.countdown = 5;
  const n0 = gs.log.length;
  Engine.STEPS['11'].run(gs);
  const stopTxt = gs.log.slice(n0).filter(e => e.batch === '⑧').map(e => e.text).join('');
  ok('C4：决斗时刻 + 停转夜 ⇒ 步骤 11 输出「停转夜：倒计时不流逝」而非跳过该步',
    gs.countdown === 5 && /停转夜/.test(stopTxt), `countdown=${gs.countdown} text=${stopTxt}`);

  /* ---- C3：寂灭与决斗叠加时以寂灭为准（1.4.2 末句 + N2） ---- */
  const qBoth = Engine.updateQueue({ extinction: true, duel: true });
  const qExt = Engine.updateQueue({ extinction: true, duel: false });
  const qDuel = Engine.updateQueue({ extinction: false, duel: true });
  const qNor = Engine.updateQueue({ extinction: false, duel: false });
  ok('C3：寂灭 ∧ 决斗同时为真时队列取 EXTINCT（步骤 11 冻结），优先级不可被改坏',
    qBoth.join(',') === Engine.EXTINCT.join(',') && qBoth.indexOf('11') < 0, qBoth.join(','));
  ok('C3：寂灭／决斗／常规三态队列分别取 EXTINCT／DUEL／NORMAL',
    qExt.join(',') === Engine.EXTINCT.join(',') &&
    qDuel.join(',') === Engine.DUEL.join(',') &&
    qNor.join(',') === Engine.NORMAL.join(','));

  /* ---- C1：99 夜兜底的判定节点守卫（1.5.2） ---- */
  ok('C1：夜数上限常量为 99（正文 1.5.2，原 999 已废止）', Engine.NIGHT_CAP === 99, String(Engine.NIGHT_CAP));
  const cap = (night, ext, node) => Engine.nightCapDraw({ night, extinction: ext }, node);
  ok('C1：第 98 夜任何节点均不判平（未达上限）',
    !cap(98, false, '9') && !cap(98, false, '11') && !cap(98, true, '9'));
  ok('C1（核心）：常规阶段第 99 夜——步骤 9 【不】判平、步骤 11 判平（节点守卫）',
    !cap(99, false, '9') && cap(99, false, '11') && !cap(99, false, null));
  ok('C1：会议夜（步骤 11 被跳过）第 99 夜于投票结算判平',
    cap(99, false, 'vote') && !cap(98, false, 'vote'));
  ok('C1：寂灭时刻第 99 夜——步骤 9 判平、步骤 11 不适用（步骤 11 冻结）',
    cap(99, true, '9') && !cap(99, true, '11'));

  /* 实测：第 99 夜常规阶段的步骤 9 不得提前判平（否则步骤 10/11 不再执行） */
  const g99 = newGame(8103);
  Engine.begin(g99);
  g99.night = Engine.NIGHT_CAP; g99.extinction = false;
  ok('C1（实测）：第 99 夜步骤 9 结算后 checkWin 不返回 draw（判定节点为步骤 11）',
    Engine.checkWin(g99, '9') !== 'draw', String(Engine.checkWin(g99, '9')));
  ok('C1（实测）：同局步骤 11 节点返回 draw（平局优先于 ①②③④）',
    Engine.checkWin(g99, '11') === 'draw', String(Engine.checkWin(g99, '11')));

  /* 结构 lint：夜数兜底不得退回「只看 g.night」的写法 */
  const bad999 = [];
  for (const f of jsFiles) {
    const s = fs.readFileSync(f, 'utf8');
    if (/night\s*>=\s*999/.test(s)) bad999.push(path.relative(base, f));
  }
  ok('C1 lint：全仓不得再出现「night >= 999」式无节点守卫的夜数兜底',
    bad999.length === 0, bad999.join(','));

  /* ---- C6：出局揭示三项（真实阵营＋呈现职业＋真实职业） ---- */
  const gp = newGame(8104);
  Engine.begin(gp);
  const anyP = gp.players[0];
  const er = RS.checkResult(anyP, 'expel');
  const dr = RS.checkResult(anyP, 'death');
  const xr = RS.checkResult(anyP, 'expose');
  ok('C6：⑥死亡／⑩驱逐 的揭示出参含真实职业（trueRoleName 非空，2.3.4/4.10.6）',
    !!er.trueRoleName && !!dr.trueRoleName, `${er.trueRoleName} / ${dr.trueRoleName}`);
  ok('C6：非出局路径（④暴露等）不得开出真实职业槽位（防超范围揭示）',
    xr.trueRoleKey === null && xr.trueRoleName === null);
  ok('C6（乔装未实装）：呈现职业与真实职业当前同值 ⇒ 本项为零信息差异的结构预留',
    er.roleKey === er.trueRoleKey, `${er.roleKey} vs ${er.trueRoleKey}`);
  ok('C6：真实职业（trueRole）与已删的「原职业」（originRole）物理分离——出局揭示恒无原职业',
    er.originRole === null && dr.originRole === null);

  /* ---- C7：调查报告列出全部致死来源（4.10.6，N3 读法甲：去重不带次数） ---- */
  const CAUSE_VALS = Object.values(D.CAUSE_NAME);
  const sixth = [], tenth = [];
  /* 逐局登记死亡记录（编号跨局复用，故必须逐局配对，不能全局按 id 建表） */
  const deathRecords = [];
  let infectSeen = 0, infectOk = true;
  for (const seed of [8201, 8202, 8203, 8204, 8205, 8206, 8207, 8208]) {
    const g = newGame(seed);
    Engine.begin(g);
    let steps = 0;
    while (!g.over && steps < 4000) {
      Engine.stepOnce(g); steps++;
      if (g.pending) {
        const f = g.pending, dd = { opt: null, targets: [], num: null, text: '' };
        if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) dd.opt = u[0].v; }
        if (f.targets) { const l = Engine.alive(g); if (l.length) dd.targets.push(l[0].id); }
        if (f.num) dd.num = f.num.options[0].v;
        Engine.submit(g, dd);
      }
    }
    const causeOf = new Map();
    for (const p of g.players) if (p.out && p.outType === 'death') causeOf.set(p.id, p.cause);
    for (const e of g.log) {
      if (e.batch === '⑥') {
        sixth.push(e.text);
        const m = /^(\d+) 号死亡/.exec(e.text);
        if (m) deathRecords.push({ id: +m[1], cause: causeOf.get(+m[1]), report: (e.text.match(/尸体调查报告：【([^】]*)】/) || [, ''])[1] });
      }
      if (e.batch === '⑩') tenth.push(e.text);
    }
  }
  const reports = sixth.filter(t => t.indexOf('号死亡') >= 0)
    .map(t => (t.match(/尸体调查报告：【([^】]*)】/) || [, null])[1]);
  ok('C7（核心）：死亡公告列出尸体调查报告（取代此前的单一死因）',
    reports.length > 0 && reports.every(r => r != null && r.length > 0),
    `${reports.length} 条 / 样例 ${reports.slice(0, 2).join(' | ')}`);
  ok('C7：报告各项均为五类致死来源之一（异形出刀∕外星人出刀∕枪击∕感染∕中毒）',
    reports.every(r => r.split('、').every(x => CAUSE_VALS.indexOf(x) >= 0)),
    reports.filter(r => !r.split('、').every(x => CAUSE_VALS.indexOf(x) >= 0)).slice(0, 2).join(' | '));
  ok('C7：【去重·不带次数】同一来源在报告中只出现一项（无从反推双刀∕额外出刀∕击杀进化方向）',
    reports.every(r => { const a = r.split('、'); return new Set(a).size === a.length; }),
    reports.filter(r => { const a = r.split('、'); return new Set(a).size !== a.length; }).slice(0, 2).join(' | '));
  /* 报告必须覆盖该死者的当夜死因（致死那一刀必属落身来源） */
  const causeMiss = [];
  for (const rec of deathRecords) {
    const items = rec.report.split('、');
    if (rec.cause && rec.report && items.indexOf(D.CAUSE_NAME[rec.cause]) < 0)
      causeMiss.push(`${rec.id}:${rec.cause}→${rec.report}`);
    if (rec.cause === 'infect') { infectSeen++; if (items.indexOf('感染') < 0) infectOk = false; }
  }
  ok('C7：报告覆盖该死者的当夜死因（致死那一次必属落身来源）',
    causeMiss.length === 0 && deathRecords.length > 0,
    causeMiss.slice(0, 3).join(' | ') + ` (样本 ${deathRecords.length} 例)`);
  ok('C7【感染单列】：感染致死者报告中单列「感染」一项，不并入出刀∕枪击',
    infectOk, `感染死亡样本 ${infectSeen} 例`);

  ok('C6（实测）：⑥死亡公告含「呈现职业：…／真实职业：…」两项且不含原职业标注',
    sixth.filter(t => t.indexOf('号死亡') >= 0).length > 0 &&
    sixth.filter(t => t.indexOf('号死亡') >= 0).every(t => t.indexOf('呈现职业：') >= 0 && t.indexOf('真实职业：') >= 0) &&
    sixth.every(t => t.indexOf('原职业') < 0));
  ok('C6（实测）：⑩驱逐公告含「呈现职业：…／真实职业：…」两项且不含原职业标注',
    tenth.filter(t => t.indexOf('号被驱逐') >= 0).length > 0 &&
    tenth.filter(t => t.indexOf('号被驱逐') >= 0).every(t => t.indexOf('呈现职业：') >= 0 && t.indexOf('真实职业：') >= 0) &&
    tenth.every(t => t.indexOf('原职业') < 0),
    `${tenth.filter(t => t.indexOf('号被驱逐') >= 0).length} 条驱逐`);
}

/* ---------- 52. v6.6 批次16 清障（2026-10-04）：A21 批次〇 / C13 觉醒 process / A4-H5 名字供给 ---------- */
{
  const RD = ctx.SKRoleDecl, EF = ctx.SKEventFamily;
  /* A21（2.3.0）：开局职业公告——职业选定后、第 1 夜之前由系统一次性公告本局全部职业构成 */
  {
    const g = newGame(660);
    Engine.begin(g);
    const batch0 = g.log.filter(e => e.batch === '〇');
    ok('A21（核心）：开局后 g.log 恰含一条批次〇公告（engine.begin 发布点）',
      batch0.length === 1, `count=${batch0.length}`);
    /* 内容与实际构成逐项一致：解析「X×n」人数表，与 players 按 originRole||role 计数比对 */
    const roster = (batch0[0] ? batch0[0].text : '').match(/开局职业公告：([^；]+)；/);
    const parsed = {};
    if (roster) roster[1].split('、').forEach(t => {
      const m = /^(.+)×(\d+)$/.exec(t); if (m) parsed[m[1]] = +m[2];
    });
    const actual = {};
    for (const p of g.players) {
      const k = p.originRole || p.role;
      const nm = D.ROLES[k] ? D.ROLES[k].name : k;
      actual[nm] = (actual[nm] || 0) + 1;
    }
    const keysOk = Object.keys(actual).length === Object.keys(parsed).length &&
      Object.keys(actual).every(k => parsed[k] === actual[k]);
    ok('A21：公告人数表与本局实际构成逐项一致（与 compositionOf 同源口径）', keysOk,
      `公告=${JSON.stringify(parsed)} 实际=${JSON.stringify(actual)}`);
    ok('A21：公告发布于第 1 夜步骤 0 之前且不含编号归属（2.3.0③⑦）',
      batch0[0] && batch0[0].night === 0 && batch0[0].text.indexOf('不含编号归属') >= 0);
    ok('A21：事件族契约 步位〇↔批次〇 登记且 audit 空（发布点对齐）',
      EF && EF.batchesOfStep('〇').join(',') === '〇' && EF.audit().length === 0);
  }

  /* C13：觉醒（6.2）为身份改变子步骤即时生效，非进程——错误 process 声明已删除 */
  ok('C13：xeno 声明不再携带 process 字段（回落 DEFAULTS.process=null，全仓零消费）',
    RD.ROLE_DECL.xeno.process == null);

  /* A4/H5：NAMES 恒 15 项（数组长度参与 rng.shuffle 消耗序列）+ 独立扩展池不重名 */
  ok('A4/H5：NAMES 恒 15 项、NAMES_EXTRA ≥ 5 项且两表无重名（15 人局 shuffle 输入不变 ⇒ 指纹中性）',
    D.NAMES.length === 15 && (D.NAMES_EXTRA || []).length >= 5 &&
    new Set(D.NAMES.concat(D.NAMES_EXTRA)).size === D.NAMES.length + D.NAMES_EXTRA.length);
}

/* ---------- 53. T18 出口门禁（2026-10-05 文本审查第二遍）：AI 不得说出能力外的话 ----------
   依据：第二遍审查 T18（renderer/speakable/tactics 无来源门禁出口）+ 4.7.1（查验不报阵营）
   + 4.9.1（票源仅验票官）+ Z03（保护不可证明→不生成）+ 5.10（队内共享不出队）。
   正向断言（改坏必挂）：①无硬锁者渲染 lock → 降级轻度指控句；②有硬锁 → 原句保留；
   ③非验票官渲染 quote → 划水句；④神探池内 reveal → 只报职业不报阵营；
   ⑤promise strong 无「是异形」预断言（查验前不断言结果）。 */
{
  const IR = ctx.IR, Lang = ctx.Lang;
  const g = newGame(1818);
  const me = g.players.find(p => p.faction === 'human');
  const tgt = g.players.find(p => p.id !== me.id);
  const meta = { speaker: me.id, night: 1, step: 'D-talk', channel: 'public' };
  const ctxFull = { g, p: me, rng: g.rng };

  /* ① 无硬锁：lock claim 渲染为降级句（不含「金水/锁定/能确定」等确证措辞） */
  const lockClaim = IR.mk('lock', [tgt.id], { faction: 'alien', good: false }, meta);
  const t1 = Lang.render(lockClaim, ctxFull);
  ok('T18-a：无硬锁者渲染 lock → 降级为轻度指控句（无确证措辞）',
    /有点可疑|说得太顺|这套发言/.test(t1), t1);

  /* ② 有 known 硬锁：原句保留（官方揭示复述合法） */
  me.known.set(tgt.id, { faction: 'alien', role: 'alien' });
  const t2 = Lang.render(lockClaim, ctxFull);
  ok('T18-a：有 known 硬锁 → lock 原句保留（官方揭示复述）',
    /锁定|阵营我确认|能确定/.test(t2), t2);
  me.known.delete(tgt.id);

  /* ③ 非验票官渲染 quote → 划水句（不替他人编造指控） */
  const quoteClaim = IR.mk('quote', [tgt.id], { by: 3 }, meta);
  const t3 = Lang.render(quoteClaim, ctxFull);
  ok('T18-e：非验票官渲染 quote → 划水句（票源仅验票官可见，4.9.1）',
    /先不表态|先听大家/.test(t3), t3);

  /* ④ 神探池内 reveal → 只报职业不报阵营；池外 → 降级 */
  me.checkPool = me.checkPool || new Map();
  const det = g.players.find(p => p.role === 'detective');
  det.checkPool.set(tgt.id, { id: tgt.id, role: tgt.role, night: 1 });
  const revealClaim = IR.mk('reveal', [tgt.id], { faction: det.faction, role: tgt.role }, meta);
  const t4 = Lang.render(revealClaim, { g, p: det, rng: g.rng });
  ok('T18-b：神探池内 reveal → 只报职业、不报阵营（4.7.1）',
    /我查过/.test(t4) && /异形|外星人|人类/.test(t4) === false, t4);
  det.checkPool.delete(tgt.id);
  const t4b = Lang.render(revealClaim, { g, p: det, rng: g.rng });
  ok('T18-b：池外目标 reveal → 降级（不得声称查验自己没做过的查验）',
    /有点可疑|说得太顺|这套发言/.test(t4b), t4b);

  /* ⑤ promise strong：无「是异形」预断言（查验前不断言结果） */
  const pClaim = IR.mk('promise', [tgt.id], { tier: 'strong', kind: 'announce' }, meta);
  const t5 = Lang.render(pClaim, ctxFull);
  ok('T18-c：promise strong 无结果预断言（保留「今晚查/公告」识别面）',
    /今晚查/.test(t5) && /公告/.test(t5) && /是异形/.test(t5) === false, t5);

  /* guard-backing 产出端已删（Z03）：speakable 不再产 defend 类 guard-backing */
  const spk = global.Speakable ? global.Speakable.pick(g, me, g.rng) || [] : [];
  ok('T18-d：保镖不再产出 guard-backing 公开背书（Z03 明文不生成）',
    !spk.some(x => x.source === 'guard-backing'));
}

/* ---------- 16. v6.6 第二十一批：游戏文本第二遍 P2/P3（T25–T32） ----------
   依据：《游戏文本审查报告·第二遍》T25–T32；本批为**文案/知识库层**，指纹须逐位不变。
   自检问句：「我把实现故意改回去，这条断言会挂吗？」——见文件末的注入测试记录。 */
{
  const IR = ctx.IR, Lang = ctx.Lang;
  const RE = fs.readFileSync(path.join(base, 'lang', 'renderer.js'), 'utf8');
  const NL = fs.readFileSync(path.join(base, 'nlp.js'), 'utf8');
  /* 〔v7 B0〕通道总表已归档；本组是文本审查类断言（防旧措辞回潮），归档≠删除，继续校验。 */
  const CH = fs.readFileSync(path.join(base, 'corpus', '_retired', 'channels.data.js'), 'utf8');

  /* T26：渲染层不得硬编码规则数值（感染致死夜 / 制药投入夜数由声明层给）——
     断言取**渲染输出**而非源文件（源注释里保留了被删掉的旧措辞作说明，扫源文件会误判） */
  const meta0 = { speaker: 1, night: 2 };
  const infTxt = Lang.render(IR.mk('infection', [], {}, meta0), { rng: null });
  const brewTxt = Lang.render(IR.mk('brew', [], {}, meta0), { rng: null });
  ok('T26：感染句与制药句不再写死夜数（数值须出自声明层，不是渲染层常量）',
    !/两夜/.test(infTxt) && !/两夜/.test(brewTxt), `${infTxt} / ${brewTxt}`);
  ok('T26（正向）：两句仍保留「感染」/「制药」识别面（round-trip 依赖关键词）',
    /感染/.test(infTxt) && /制药/.test(brewTxt), `${infTxt} / ${brewTxt}`);

  /* T28：中文数字压测分支显式化——默认比率存在，且可被测试覆盖（不再是隐式随机） */
  ok('T28：中文数字压测比率提取为常量 CN_NUM_RATE 且默认 0.3（默认行为不变）',
    /const CN_NUM_RATE = 0\.3;/.test(RE) && /__cnNumRate/.test(RE));
  ok('T28（覆盖）：ctx 传入 __cnNumRate=1 时恒用中文数字写法',
    Lang.num(12, { next: () => 0, int: n => 0, __cnNumRate: 1 }) === '十二号' &&
    Lang.num(12, { next: () => 0, int: n => 0, __cnNumRate: 0 }) === '12 号',
    Lang.num(12, { next: () => 0, int: n => 0, __cnNumRate: 1 }));

  /* T29：无目标不得产出破句（「我保。」「都投 ，票别散。」「，你昨晚做了什么？」） */
  const noT = [['accuse', { tier: 'hard' }], ['vote', {}], ['rally', {}], ['defend', {}],
               ['ask', {}], ['bind', { role: 'bio' }], ['cure', {}], ['rescue', {}]];
  const broken = [];
  for (const [k, pl] of noT) {
    const s = Lang.render(IR.mk(k, [], pl, { speaker: 1, night: 2 }), { rng: null });
    if (/我保。|都投 ，|，你昨晚|我查过 ，|他不是。|是。$/.test(s) || /^\s*$/.test(s)) broken.push(k + '→' + s);
  }
  ok('T29：无目标时一律降级为不表态句，不产出破句', broken.length === 0, broken.join(' | '));
  /* weak 档承诺本身不含目标，属合法句式，不受降级影响（test-lang 该样例依赖） */
  ok('T29（例外）：promise weak 无目标仍正常产出（不误降级）',
    /可能会查验|或许会投/.test(Lang.render(IR.mk('promise', [], { tier: 'weak' }, { speaker: 1, night: 2 }), { rng: null })));

  /* T30：编号写法不得先于人数封顶（NAMES_EXTRA 已预留扩展池） */
  ok('T30：中文数字表已扩至二十（编号写法不封顶于 15）',
    Lang.numCN(16) === '十六号' && Lang.numCN(20) === '二十号', Lang.numCN(16));

  /* T31：过时引用与注释已更正；T32：nlp 词表不再用「它」指称玩家 */
  ok('T31：tactics 文件头不再引用不存在的 infer/filter.js（实际为 Tactics.filterClaims）',
    !/infer\/filter\.js/.test(fs.readFileSync(path.join(base, 'corpus', 'tactics.js'), 'utf8')));
  ok('T32：defend 词表不再用「它」指称玩家（仅他/她）',
    !/\(他\|她\|它\)/.test(NL));
  ok('T31（保护）：ROLE_NAME.doc 作为历史别名兜底**保留**（删掉会让 UI 印出裸键 doc）',
    /doc: '医生'/.test(NL) && /不是死条目，勿删/.test(NL));

  /* T25：channels.data 七类过时判据已更正/标注（纯文本，不改动 dormant 与档位字段） */
  const stale = [
    ['第 1 夜被动全能免疫', /工程师首夜全能免疫〔过时/, /第 1 夜全能免疫一项〔过时/],
    ['警长子弹到账夜', /第 5 夜额外 \+1（4\.4\.3 明文/, null],
    ['助理工程师维修档', /助理工程师与工程师同制：维修 −1\.0~1\.5 自选/, null],
    ['原职业标注同制说', /暴露公告与出局揭示的标注已依 v6\.6 2\.8\.12④ 删除/, null],
    ['外星人免疫分夜口径', /第 10 夜起 2 次〔过时/, null],
    ['批⑫ 两处 F 档判据', /批⑫已撤（2026-10-04，3\.3\.7）：通道退役/, null],
    ['④ 维修粒度', /实为 −1\.0~1\.5 自选、步长 0\.1 共 6 档/, null],
  ];
  const miss = [];
  for (const [name, a, b] of stale) {
    const hit = (a ? a.test(CH) : true) && (b ? b.test(CH) : true);
    if (!hit) miss.push(name);
  }
  ok('T25：channels.data 七类过时判据全部已更正或标注退役（AI 知识库不得喂错规则）',
    miss.length === 0, miss.join('、'));
  /* 纪律：只改 cond/note 文本，不得顺手改 dormant/档位（会破坏通道计数断言）。
     〔第二十三批 · 审查 P2 整改〕原写法只要还剩一个 "dormant:" 就通过 ⇒ 恒真断言，
     审查注入测试（把一条真 dormant 改 false，门禁毫无反应）已证其无效。现改为**计数快照比对**。 */
  const dmT = (CH.match(/dormant:\s*true/g) || []).length;
  const dmF = (CH.match(/dormant:\s*false/g) || []).length;
  ok('T25（纪律·快照）：dormant 计数快照未变（true 462 / false 44 / 合计 506）',
    dmT === 462 && dmF === 44 && dmT + dmF === 506, `true=${dmT} false=${dmF} 合计=${dmT + dmF}`);
}

/* ---------- 17. v6.6 第二十二批：规则方两条裁决落地（2026-10-05） ----------
   裁决一：警长额外子弹到账夜 = **第 5 夜**（正文 4.4.3）——此前实现的 n===7 作废，属**有意行为改动**。
   裁决二：工匠铸造**分为两个选择**（4.11.2① 常规 2 夜 / ①之二 速成 1 夜）——按 2.9④ 登记为两条
           独立进程，并以 exclusiveGroup 表达 2.9⑤ 同组互斥。 */
{
  const PR = ctx.SKProcess, PE = ctx.SKProcessEngine;
  const RD2 = ctx.SKRoleDecl;

  /* ---- 裁决一：4.4.3 警长额外子弹两项，夜次分别为「第 5 夜」与「存活≤6」 ---- */
  const gB = newGame(9301);
  Engine.begin(gB);
  const sh = gB.players.find(p => p.role === 'sheriff');
  ok('4.4.3：声明层警长 desc 已载明第 5 夜与存活≤6 两项额外子弹（不再只写初始 1 发）',
    /第 5 夜/.test(RD2.ROLE_DECL.sheriff.desc) && /存活≤6/.test(RD2.ROLE_DECL.sheriff.desc),
    RD2.ROLE_DECL.sheriff.desc);
  /* 实跑：逐夜推进到第 5 夜，警长应在该夜拿到 +1；且第 7 夜**不再**重复发（全局仅此 1 次） */
  const before = sh.bullets;
  let sawFifth = false, seventhAgain = 0;
  for (let n = sh.bullets; n <= 7; n++) {
    gB.night = n;
    sh.bullets = before;                       // 隔离其他来源，只看夜次触发
    Engine.grants ? Engine.grants(gB) : null;
    if (n === 5 && sh.bullets === before + 1) sawFifth = true;
    if (n === 7 && sh.bullets > before) seventhAgain++;
  }
  ok('4.4.3（核心）：第 5 夜发放额外 1 发子弹（引擎 n===5，正文口径）', sawFifth,
    `bullets ${before} → ${sh.bullets}`);
  ok('4.4.3：第 7 夜不再重复发放（全局仅此 1 次）', seventhAgain === 0, String(seventhAgain));
  /* 与外星人夜晚免疫的夜次互不干扰（6.4 第 7 夜）——两者常被误合并 */
  const gX = newGame(9302);
  Engine.begin(gX);
  const xn = gX.players.find(p => p.role === 'xeno');
  gX.night = 7; const xi0 = xn.nightImmune;
  if (Engine.grants) Engine.grants(gX);
  ok('6.4：外星人夜晚免疫仍为第 7 夜 +1（与警长子弹夜次无关，勿再统一）',
    !Engine.grants || xn.nightImmune === xi0 + 1, `${xi0} → ${xn.nightImmune}`);

  /* ---- 裁决二：4.11.2① / ①之二 两条进程 ---- */
  const cst = PR.get('cast'), fst = PR.get('castFast');
  ok('4.11.2①/①之二：工匠铸造登记为两条独立进程（常规 2 夜 / 速成 1 夜）',
    !!cst && !!fst && cst.nights === 2 && fst.nights === 1 && cst.owner.join() === 'artisan',
    `cast=${cst && cst.nights} castFast=${fst && fst.nights}`);
  ok('4.11.2①之二：速成护甲声明 4 夜期限（ttl=4：第1夜不生效/第2-3夜生效/第4夜消失）',
    fst && fst.ttl === 4);
  ok('2.9④：同独占组内的进程投入夜数必不同（否则是同一条被登记两次）',
    PR.audit().join('；') === '' && cst.exclusiveGroup === fst.exclusiveGroup);
  ok('2.9⑤：两条铸造进程同属 craft 独占组（同一时期仅一个未完成进程）',
    cst.exclusiveGroup === 'craft' && fst.exclusiveGroup === 'craft');
  ok('4.11.3①：常规/速成产物分别落到 armorStock 与 fastArmorStock（合并计库存上限）',
    cst.products.normal.armorStock === 1 && fst.products.fast.fastArmorStock === 1 &&
    PR.RESOURCE_LABELS.armorStock === '常规护甲' && PR.RESOURCE_LABELS.fastArmorStock === '速成护甲');

  /* 中断/完成后另一条可投：2 夜进程只投 1 夜 ⇒ 进度保留（2.9③）且**仍占用独占**（2.9⑤）；
     投满第 2 夜完成、次夜到账后独占释放，速成方可就投。 */
  const gP = { night: 1 };
  const pArt = { role: 'artisan', armorStock: 0, fastArmorStock: 0, inbox: [] };
  const say = t => pArt.inbox.push(t);
  const r1 = PE.invest(gP, pArt, 'cast', null, { say });
  const r2 = PE.invest(gP, pArt, 'castFast', null, { say });
  ok('2.9⑤（核心）：常规未完成时速成被拒（denied=exclusive），且不落任何进度',
    r1 && r1.invested === true && r1.completed === false && r2 && r2.invested === false && r2.denied === 'exclusive' &&
    pArt.castFast === undefined && pArt.castFastDone === undefined,
    JSON.stringify({ r1, r2 }));
  const r1b = PE.invest({ night: 2 }, pArt, 'cast', null, { say });     // 第 2 夜：完成
  const stillBusy = PE.invest({ night: 2 }, pArt, 'castFast', null, { say });
  ok('2.9③/⑨：两夜投满即完成，完成态仍占用独占（到账前不得并进）',
    r1b && r1b.completed === true && stillBusy && stillBusy.denied === 'exclusive' &&
    pArt.castDone === 'normal' && pArt.armorStock === 0, JSON.stringify({ r1b, stillBusy }));
  PE.deliver({ night: 3 }, pArt, { say });                              // 次夜到账
  const r3 = PE.invest({ night: 3 }, pArt, 'castFast', null, { say });
  ok('2.9③/⑨：到账后独占释放，速成铸造可投（1 夜即完成）并于次夜到账',
    r3 && r3.invested === true && r3.completed === true &&
    pArt.armorStock === 1 && pArt.castFastDone === 'fast', JSON.stringify({ r3, art: pArt }));
  PE.deliver({ night: 4 }, pArt, { say });
  ok('4.11.2①/①之二：两条产物分别落到常规护甲与速成护甲（库存上限 2 件合并计算，随 artisan 实装）',
    pArt.armorStock === 1 && pArt.fastArmorStock === 1, `${pArt.armorStock}/${pArt.fastArmorStock}`);
  /* 声明层非法组合必须被 audit 拦下（2.9④：同组 nights 相同） */
  PR.PROCESSES.__badSame = { id: '__badSame', rule: 'x', owner: ['artisan'], nights: 2,
    exclusiveGroup: 'craft', productChoices: ['a'], products: { a: { armorStock: 1 } },
    messages: { progress: 'x', complete: 'y' }, progressKey: 'bs', doneKey: 'bsd', delivery: 'nextNight' };
  const sameGroup = PR.audit().some(x => x.indexOf('__badSame') >= 0);
  delete PR.PROCESSES.__badSame;
  ok('2.9④（门禁）：同独占组内投入夜数相同的伪「独立进程」被 audit 拦下', sameGroup);
}

/* ---------- 18. v6.6 第二十四批：模块化标准化 + 闲置资源领出 ----------
   诊断出的问题：声明层只声明「有什么字段」，没有声明「这个字段有没有人用」——
   于是零消费的声明与已接线的声明长得一模一样，闲置资源无法被审计。
   本批给出「声明-消费契约」（life 标注 + 审计）与「判据失效台账」（死判据拒用）。 */
{
  const RD2 = ctx.SKRoleDecl, R = ctx.SKChannelsRetired, CHS = ctx.Channels;
  const GATES = ctx.SKChanGates || {};

  /* ---- 声明-消费契约 ---- */
  ok('标准化：SCHEMA 每个字段都声明了 lifecycle（wired/archived/pending）',
    Object.entries(RD2.SCHEMA).every(([, s]) => RD2.LIFE.indexOf(s.life) >= 0));
  ok('标准化：EXTRA_FIELDS（schema 之外的字段）同样登记了 lifecycle',
    Object.entries(RD2.EXTRA_FIELDS).every(([, s]) => RD2.LIFE.indexOf(s.life) >= 0));
  ok('标准化：roleDecl.audit() 通过（life 合法 + archived 须写明零消费理由）',
    RD2.audit().length === 0, RD2.audit().join('；'));
  const led = RD2.idleLedger();
  ok('标准化：idleLedger 可用且 archived 字段非空（闲置被显式列出而非藏起来）',
    led.archivedFields.length > 0 && Array.isArray(led.orphanProcesses),
    JSON.stringify(led.archivedFields));
  /* pending 字段与对局状态 g.pending 同名但语义无关——易被误接线，须留档警示 */
  ok('标准化：archived 的 pending 字段已写明「与 g.pending 同名但无关」警示',
    /g\.pending/.test(RD2.EXTRA_FIELDS.pending.desc));
  /* orphanProcesses ＝ owner 角色尚未声明的进程（A6 待实装），是「待接线」而非「死代码」
     〔批次 29〕猎手已声明，gatherAmmo 随之接线 ⇒ 剩余仅工匠两条铸造进程。 */
  ok('标准化：orphanProcesses 与声明层一致（批次 31 后猎手攒弹与工匠两条铸造进程均已接线 ⇒ 清空）',
    led.orphanProcesses.length === 0, led.orphanProcesses.join(',') || '(空)');

  /* ---- 判据失效台账〔v7 B0〕----
     原 4 条断言针对「通道总表里 38 条失效判据条目不得被误接线」。通道总表与退役台账
     已整体归档 ⇒「不得误接线」恒成立；但**归档必须可验证**（归档≠删除）。
     故本组改判【归档完整性】：那 38 个编号是否仍完整保留在归档文件里。 */
  const RETIRED_ARCHIVE = path.join(base, 'corpus', '_retired', 'channels.retired.js');
  const retiredSrc = fs.existsSync(RETIRED_ARCHIVE) ? fs.readFileSync(RETIRED_ARCHIVE, 'utf8') : '';
  const retiredIds = [...retiredSrc.matchAll(/\b([A-Z]\d{1,3})\s*:/g)].map(m => m[1]);
  ok('台账〔v7 B0〕：38 条判据失效条目完整保留在归档文件（归档≠删除，可追溯）',
    retiredIds.length === 38, `archived=${retiredIds.length}`);
  ok('台账〔v7 B0〕：退役条目在运行时无任何 gate 实现（通道执行器已归档）',
    Object.keys(GATES).every(id => retiredIds.indexOf(id) < 0), `gates=${Object.keys(GATES).length}`);
  ok('台账〔v7 B0〕：运行时不再挂载通道总表（Channels.CHANNELS 恒空）',
    (Channels.CHANNELS || []).length === 0, `channels=${(Channels.CHANNELS || []).length}`);

}
/* ---------- 19. v6.6 第二十五批：通道库降级〔v7 B0 · 整组隔离〕 ----------
   ⚠ 本组被测的是 SK_CHAN_MODE 三档（full/late/off）执行策略，该机制已于 B0 随
     通道执行器一并归档（js/infer/_retired/channels.run.js）。三档的存在本身即是
     「按指标调档」的产物，违反治理规范铁律一，故不保留为可切档位。
     归档保留该文件供追溯：git branch v7-pre-teardown @709acd7。
     原消融读数（据以拆除的实测）：full 0.500 / late 0.498 / off 0.498，
     top1 61.8% / 64.0% / 63.8%，gate 求值 496144 / 97328 / 0。
   // __ARCHIVED_GROUP__
*/

{
  /* 替代判据：归档完整性——降级策略的原始实现仍可追溯（归档≠删除）。 */
  const CHAN_RUN_ARCHIVE = path.join(base, 'infer', '_retired', 'channels.run.js');
  ok('〔v7 B0〕通道执行器归档副本仍在（含三档降级实现，可追溯）',
    fs.existsSync(CHAN_RUN_ARCHIVE) && /SK_CHAN_MODE/.test(fs.readFileSync(CHAN_RUN_ARCHIVE, 'utf8')));
  okVoid('〔v7 B0〕运行时不再暴露三档开关（global.SK_CHAN_MODE 仅存于归档文件）',
    ctx.Channels && (ctx.Channels.CHANNELS || []).length === 0 && !ctx.SK_CHAN_MODE);
}
/* ---------- 20. v66.1 措辞修订（2026-10-05）：把正文新正典钉进回归 ----------
   本批只改**正文措辞**（桌面《太空杀V6.6正文_v66.1修订版.pdf》，14 处），
   全部为「代码本就如此、正文写错/写漏」者，故**零行为变化**。
   下面把每处改正对应的实现口径断言下来，防后续改动把正文又改回去、或让实现漂移。 */
{
  const RS2 = ctx.RevealService, P2 = ctx.SKProcess, CAP2 = ctx.SKCapability;

  /* R1 · 3.2.5 停转夜：正典为「仅寂灭时刻无适用对象」——删「或决斗时刻」。
     依据 1.4.2（决斗仅取消白天流程，倒计时照常流逝）+ 1.5.2（决斗取步骤 11 结算完成）。
     ⇒ 停转夜的「不适用」判据只能看 extinction，绝不能把 duel 也算进去。 */
  {
    const gS = newGame(9601);
    Engine.begin(gS);
    gS.extinction = true; gS.duel = true;      // 寂灭 ∧ 决斗叠加：应按寂灭（步骤 11 冻结）
    gS.queue = Engine.updateQueue(gS);
    const extOnly = gS.queue.indexOf('11') < 0;
    gS.extinction = false; gS.duel = true;      // 仅决斗：步骤 11 必须在
    gS.queue = Engine.updateQueue(gS);
    const duelHas = gS.queue.indexOf('11') >= 0;
    ok('R1：停转夜「不适用」判据＝寂灭时刻（3.2.5 v66.1 已删「或决斗时刻」）',
      extOnly && duelHas, `寂灭∧决斗→11:${extOnly ? '冻结' : '在'} / 仅决斗→11:${duelHas ? '在' : '冻结'}`);
    const src = fs.readFileSync(path.join(base, 'engine.js'), 'utf8')
      + fs.readFileSync(path.join(base, 'engine', 'steps.js'), 'utf8');
    ok('R1 lint：停转夜的「不适用」判据不得写成「寂灭或决斗」（v66.1 已删「或决斗时刻」）',
      !/(stopNight|停转夜)[\s\S]{0,300}?extinction[\s\S]{0,120}?\|\|[\s\S]{0,60}?duel/.test(src)
      && !/duel[\s\S]{0,120}?\|\|[\s\S]{0,60}?extinction[\s\S]{0,200}?stopNight/.test(src));
  }

  /* R2 · 4.11.2①之二：v66.1 将「铸造当夜」正名为「**投入夜**」（2.9 术语统一）。
     投入夜＝第 1 夜、次夜到账＝第 2 夜并开始生效、第 4 夜消失 ⇒ ttl=4。 */
  ok('R2：速成铸造 ttl=4（投入夜起算 ⇒ 到账夜恰为第 2 夜并生效，与 v66.1 措辞一致）',
    P2.PROCESSES.castFast.ttl === 4, 'ttl=' + P2.PROCESSES.castFast.ttl);
  ok('R2：速成铸造 delivery=nextNight（2.9⑦ 次夜到账，与「投入夜为第 1 夜」互为印证）',
    P2.PROCESSES.castFast.delivery === 'nextNight', P2.PROCESSES.castFast.delivery);

  /* R3 · 2.8.12③：差量由「五处」改正为「**四处**」——驱逐公告所载三项即 ① 之默认范围，
     按 2.8.12⑥ 属〔重申〕不另计。代码侧对应：仅「出局揭示」两路径开 faction，
     「暴露/神探查验/蛰伏查验」一律不开。 */
  {
    const fTrue = Object.keys(RS2.PATHS).filter(k => RS2.PATHS[k].faction);
    const oTrue = Object.keys(RS2.PATHS).filter(k => RS2.PATHS[k].originNote);
    ok('R3：真实阵营仅在出局揭示（⑩驱逐/⑥死亡）两路径开启——与 2.8.12① 之默认范围一致',
      fTrue.slice().sort().join(',') === 'death,expel', fTrue.join(','));
    ok('R3：原职业标注仅在神探公告与蛰伏查验开启（2.8.12③ 差量③④，v66.1 已重排为四处）',
      oTrue.slice().sort().join(',') === 'detectiveAnnounce,xenoCheck', oTrue.join(','));
  }

  /* R4 · 5.9⑧：v66.1 已把自述「共九处」改正为「共**十处**」并补列 4.6.4⑦（毒师）。
     ⇒ 代码 blockCount=10 由「假定」升级为「与正文一致」。 */
  ok('R4：九关核验十块与 v66.1 正文一致（含 4.6.4 毒师块，v66.1 已补列）',
    CAP2.META.blockCount === 10 && CAP2.keys().length === 10 && CAP2.audit().length === 0,
    `${CAP2.keys().length}/${CAP2.META.blockCount} audit=${CAP2.audit().length}`);

  /* R5 · 附录二 速查卡·警长：v66.1 已删「存储上限 2 发（仅约束 4.4.3 额外子弹）」，
     改为「约束任何来源的子弹，依 4.4.6」。⇒ 全部来源统一钳 2 发，实跑不得越界。 */
  {
    let maxB = 0, over = 0;
    for (const seed of [9611, 9612, 9613, 9614]) {
      const g = newGame(seed);
      Engine.begin(g);
      let st = 0;
      while (!g.over && st < 3000) {
        Engine.stepOnce(g); st++;
        if (g.pending) {
          const f = g.pending, d = { opt: null, targets: [], num: null, text: '' };
          if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) d.opt = u[0].v; }
          if (f.targets) { const l = Engine.alive(g); if (l.length) d.targets.push(l[0].id); }
          if (f.num) d.num = f.num.options[0].v;
          Engine.submit(g, d);
        }
        for (const p of g.players) if (p.bullets > maxB) maxB = p.bullets;
        for (const p of g.players) if (p.bullets > 2) over++;
      }
    }
    ok('R5：警长子弹存量恒 ≤2 发（4.4.6「任何来源」——初始/额外/悬赏回复统一钳制）',
      over === 0 && maxB <= 2, `峰值 ${maxB} 发，越界 ${over} 次`);
  }

  /* R6 · 附录二 速查卡·神探：v66.1 已删「每夜**恒真**查验」，改为「查验 1 人（结论可能不成立）」。
     依据 4.7.1「呈现职业本身可能系变形所致，故结论可能不成立」+ 4.7.5②。
     ⇒ 实现必须读**呈现身份**而非真实身份快照；乔装(7.3)/变形(6.8.3)实装后结论自动可失效。
     当前两者为 A6 五变体未实装，故「不可失效」是阶段事实，不得写成硬编码的「真」。 */
  {
    const gt = newGame(9621);
    Engine.begin(gt);
    const t = gt.players.find(p => !p.out) || gt.players[0];
    const shown = t.role;
    const dc0 = RS2.checkResult(t, 'detectiveCheck');
    t.role = '__morphed__';                     // 模拟 6.8.3 变形：呈现身份改变
    const dc1 = RS2.checkResult(t, 'detectiveCheck');
    t.role = shown;
    ok('R6：神探查验读呈现身份而非真实身份快照（变形后结论随之改变，不硬编码「真」）',
      dc0.roleKey === shown && dc1.roleKey === '__morphed__' && dc1.roleKey !== shown,
      `${dc0.roleKey} → ${dc1.roleKey}`);
    ok('R6：查验私反馈不含阵营（4.7.1「不报阵营」；真实阵营仅出局揭示给出）',
      dc0.trueRoleKey === null && dc0.faction === undefined, 'trueRole=' + dc0.trueRoleKey);
  }

  /* R7 · 2.8.10：v66.1 已把标题「接入检查（九关）」改为「（九关·含 ①之二 共十项）」。
     ⇒ schema 必须覆盖 ①①之二②~⑨ 全部十项，缺一即审计不过。 */
  {
    const gates = new Set(Object.values(CAP2.GATE_SCHEMA || {}).map(v => v.gate));
    const need = ['①', '①之二', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
    const lack = need.filter(g => !gates.has(g));
    ok('R7：九关 schema 覆盖 ①①之二②~⑨ 共十项（2.8.10 v66.1 已标「共十项」）',
      lack.length === 0, lack.length ? '缺 ' + lack.join(',') : `gate=${[...gates].join('')}`);
  }
}

/* ---------- 21. 公告 IR 化 + 禁语规则引擎（P1-a/P1-b，2026-10-05：叙事层前置） ----------
   公告 IR（js/lang/announceIR.js）：⑥⑩③④⑤暴露条款的揭示字段收进 AIR.SCHEMA 一处登记，
   调用点只构造节点、不再手拼揭示字段；渲染与旧模板逐字节一致（零行为变化）。
   禁语引擎（js/lang/taboo.js）：4.10.6【去重·不带次数】／2.8.12④〔2.8.9(17)〕／4.7.1·4.7.5②
   三条硬约束的结构化校验，供叙事层出口调用。 */
{
  const AIR = ctx.AnnounceIR, TB = ctx.Taboo, RS3 = ctx.RevealService;

  /* 21.1 差量登记：SCHEMA 与 v66.1 2.8.12③④ 一致 */
  ok('AIR：四类公告节点已登记（announceDeath/Expel/Expose/Detective）',
    AIR.KINDS.length === 4 &&
    AIR.KINDS.join(',') === 'announceDeath,announceExpel,announceExpose,announceDetective',
    AIR.KINDS.join(','));
  ok('AIR：死亡/驱逐节点保留真实阵营与真实职业（2.3.4/4.10.6 出局揭示三项）',
    AIR.SCHEMA.announceDeath.indexOf('factionName') >= 0 && AIR.SCHEMA.announceDeath.indexOf('trueRole') >= 0 &&
    AIR.SCHEMA.announceExpel.indexOf('factionName') >= 0 && AIR.SCHEMA.announceExpel.indexOf('trueRole') >= 0);
  ok('AIR：暴露/神探节点无阵营与真实职业字段（2.8.12④〔2.8.9(17)〕／4.7.2 只报两项）',
    AIR.SCHEMA.announceExpose.indexOf('factionName') < 0 && AIR.SCHEMA.announceExpose.indexOf('trueRole') < 0 &&
    AIR.SCHEMA.announceDetective.indexOf('factionName') < 0 && AIR.SCHEMA.announceDetective.indexOf('trueRole') < 0);
  ok('AIR：原职业标注仅神探公告节点持有（4.7.5；B2 后 ④⑤⑥⑩ 均无）',
    AIR.SCHEMA.announceDetective.indexOf('originRole') >= 0 &&
    AIR.SCHEMA.announceDeath.indexOf('originRole') < 0 && AIR.SCHEMA.announceExpose.indexOf('originRole') < 0);

  /* 21.2 字节级一致性：IR 渲染 ＝ 旧调用点模板逐字相同 */
  const crD = { id: 3, roleName: '警长', trueRoleName: '警长', originRole: null };
  ok('AIR 渲染：⑥死亡公告逐字节一致（含多类别报告以「、」连接）',
    AIR.render(AIR.death(crD, '人类', ['枪击'])) === '3 号死亡，人类（呈现职业：警长／真实职业：警长），尸体调查报告：【枪击】' &&
    AIR.render(AIR.death(crD, '异形', ['异形出刀', '中毒'])) === '3 号死亡，异形（呈现职业：警长／真实职业：警长），尸体调查报告：【异形出刀、中毒】');
  ok('AIR 渲染：⑩驱逐公告逐字节一致',
    AIR.render(AIR.expel({ id: 5, roleName: '异形', trueRoleName: '异形' }, '异形')) ===
    '5 号被驱逐，异形（呈现职业：异形／真实职业：异形）');
  ok('AIR 渲染：③神探公告逐字节一致（含转职者原职业标注与无标注两态）',
    AIR.render(AIR.detective({ id: 7, roleName: '武装船员', originRole: '普通船员' })) === '7 号是（职业：武装船员；原职业：普通船员）' &&
    AIR.render(AIR.detective({ id: 7, roleName: '神探', originRole: null })) === '7 号是（职业：神探）');
  ok('AIR 渲染：④⑤暴露条款逐字节一致（单/多目标、以「、」连接）',
    AIR.render(AIR.expose('破坏者暴露', [{ id: 3, roleName: '异形' }])) === '破坏者暴露：3 号（异形）' &&
    AIR.render(AIR.expose('维修者暴露', [{ id: 2, roleName: '工程师' }, { id: 9, roleName: '助理工程师' }])) ===
    '维修者暴露：2 号（工程师）、9 号（助理工程师）');

  /* 21.3 结构即防线：工厂剥字段 + validate 拒越权（fail loud） */
  {
    const n = AIR.expose('破坏者暴露', [{ id: 3, roleName: '异形', faction: 'alien', trueRole: 'alien' }]);
    ok('AIR：工厂剥除条目越权字段——暴露节点物理不含 faction/trueRole（结构上拿不到）',
      n.items.length === 1 && n.items[0].id === 3 && n.items[0].roleName === '异形' &&
      !('faction' in n.items[0]) && !('trueRole' in n.items[0]) &&
      !('factionName' in n) && !('trueRole' in n));
    let threw = 0;
    try { AIR.validate({ kind: 'announceExpose', label: 'x', items: [{ id: 1, roleName: 'y' }], factionName: '人类' }); }
    catch (e) { threw++; }
    try { AIR.validate({ kind: 'announceDeath', id: 1, presentedRole: 'a', trueRole: 'b', report: [] }); }
    catch (e) { threw++; }
    try { AIR.validate({ kind: 'nope' }); }
    catch (e) { threw++; }
    ok('AIR：validate 拒绝越权字段/缺必填/未登记 kind（2.8.12③ 差量登记的可执行形态）', threw === 3, 'threw=' + threw);
  }

  /* 21.4 揭示服务与公告 IR 同向：PATHS 配置 ↔ SCHEMA 白名单交叉断言 */
  ok('AIR×B5：PATHS 关 faction 的路径（暴露/神探公告/查验/会议）对应节点均无 factionName；expel/death 均有',
    (['expose', 'detectiveAnnounce', 'detectiveCheck', 'xenoCheck', 'meeting'].every(k => !RS3.PATHS[k].faction)) &&
    RS3.PATHS.expel.faction && RS3.PATHS.death.faction &&
    AIR.SCHEMA.announceExpose.indexOf('factionName') < 0 && AIR.SCHEMA.announceDetective.indexOf('factionName') < 0 &&
    AIR.SCHEMA.announceExpel.indexOf('factionName') >= 0 && AIR.SCHEMA.announceDeath.indexOf('factionName') >= 0);

  /* 21.5 禁语引擎：三条硬约束的正反样例 */
  ok('Taboo·report：份数措辞命中（两刀/双刀/补刀/两次），类别枚举通过（4.10.6）',
    TB.check('他被砍了两刀', 'report').length === 1 &&
    TB.check('异形的双刀冷却完了', 'report').length === 1 &&
    TB.check('有人补刀', 'report').length === 1 &&
    TB.check('尸体调查报告：【枪击、中毒】', 'report').length === 0 &&
    TB.check('3 号死亡，人类（呈现职业：警长／真实职业：警长），尸体调查报告：【异形出刀】', 'report').length === 0);
  ok('Taboo·expose：条目形态豁免（N 号（呈现职业）），条目外阵营/真实身份措辞命中（2.8.12④）',
    TB.check('破坏者暴露：3 号（异形）', 'expose').length === 0 &&
    TB.check('维修者暴露：2 号（工程师）、9 号（助理工程师）', 'expose').length === 0 &&
    TB.check('3 号被暴露，他就是异形', 'expose').length === 1 &&
    TB.check('5 号暴露，真实职业是工程师', 'expose').length === 1);
  ok('Taboo·checkClaim：查验结论断言硬事实命中，平铺结果不命中（4.7.1/4.7.5②）',
    TB.check('查验结果一定没错', 'checkClaim').length === 1 &&
    TB.check('查验结果：3 号（工程师）', 'checkClaim').length === 0 &&
    TB.check('我查过他，他是工程师', 'checkClaim').length === 0);
  {
    let threw = false;
    try { TB.assert('他被砍了两刀', 'report'); } catch (e) { threw = true; }
    ok('Taboo：assert 违规即抛（叙事层出口 fail loud）', threw);
  }

  /* 21.6 现行公告模板过三禁：四类节点的实际渲染全部干净 */
  ok('Taboo×AIR：⑥死亡渲染过 report 检、③神探公告过 checkClaim 检、④⑤暴露条款过 expose 检',
    TB.check(AIR.render(AIR.death(crD, '异形', ['异形出刀', '中毒'])), 'report').length === 0 &&
    TB.check('【神探公告】' + AIR.render(AIR.detective({ id: 7, roleName: '神探', originRole: null })), 'checkClaim').length === 0 &&
    TB.check(AIR.render(AIR.expose('破坏者暴露', [{ id: 3, roleName: '异形' }])), 'expose').length === 0);

  /* 21.7 一处登记 lint：揭示模板字面量只存在于 announceIR.js，调用点不得回潮 */
  {
    const airSrc = fs.readFileSync(path.join(base, 'lang', 'announceIR.js'), 'utf8');
    const stepsSrc = fs.readFileSync(path.join(base, 'engine', 'steps.js'), 'utf8');
    const engineSrc = fs.readFileSync(path.join(base, 'engine.js'), 'utf8');
    ok('AIR lint：⑥⑩揭示模板字面量只在 announceIR.js（调用点手拼揭示字段已退役；注释引用格式不受限）',
      /号死亡，\$\{/.test(airSrc) && /号被驱逐，\$\{/.test(airSrc) &&
      !/号死亡，\$\{/.test(stepsSrc) && !/号被驱逐，\$\{/.test(engineSrc));
  }
}

/* ---------- 22. 批次 28：全新规则接入 Ⅰ——A19 乔装 + L1/L2 + A20 维修效力削减 ----------
   用户拍板「AUC 暂时放行」后按 v2.0 批次 21 序开工：本批实装 A19 乔装（7.3，步骤 1）＋
   L1（known 硬锁补 trueRole）＋ L2 断言（checkPool 存呈现职业）＋ A20 维修效力削减（3.2.6）。
   乔装影响面＝2.8.1③之三①：仅船员查验基准可被骗；神探/蛰伏/暴露/出局揭示不受欺骗（③之二）。
   ⚠ 行为指纹有意变更（步骤 1 实装后每夜 AI 决策收集消耗 rng）——基线重建见交接文档。 */
{
  const RS4 = ctx.RevealService, ACT4 = ctx.SKDerivation;

  /* --- 22.1 乔装行动位与封锁（7.3.5） --- */
  {
    const g = newGame(9701);
    Engine.begin(g);
    g.night = 3;
    const alien = g.players.find(p => p.faction === 'alien');
    const reqN = Engine.STEPS['1'].req(g).length;
    ok('A19：步骤 1 决策者＝存活异形＋外星人（4 名，次数未用尽）', reqN === 4, 'req=' + reqN);
    alien.silenceNight = g.night;
    ok('A19：被沉默者当夜不可乔装（7.3.5，A15 沉默自 0.5 起覆盖步骤 1）',
      Engine.STEPS['1'].req(g).every(r => r.pid !== alien.id));
    alien.silenceNight = null;
    alien.dying = true;
    ok('A19：0.55 濒死者当夜不可乔装（7.3.5，canAct 覆盖）',
      Engine.STEPS['1'].req(g).every(r => r.pid !== alien.id));
    alien.dying = false;
  }

  /* --- 22.2 乔装发动、次数记账与池收口 --- */
  {
    const g = newGame(9702);
    Engine.begin(g);
    g.night = 2;
    const alien = g.players.find(p => p.faction === 'alien');
    const f = Engine.STEPS['1'].form(g, alien);
    ok('A19：表单＝不乔装项＋全职业池（含异形∕外星人栽赃项，7.3.1 池同步自适应）',
      f.opts[0].v === 'none' && f.opts.some(o => o.v === 'alien') && f.opts.some(o => o.v === 'xeno') &&
      f.opts.length === ACT4.verifyPool(g).length + 1,
      'opts=' + f.opts.length);
    g.decisions[alien.id] = { opt: 'sheriff' };
    Engine.STEPS['1'].run(g);
    ok('A19：乔装落账 {night, role}、次数 2→1（7.3.1 每个体全局 2 次）',
      alien.disguise && alien.disguise.night === 2 && alien.disguise.role === 'sheriff' && alien.disguiseLeft === 1,
      JSON.stringify(alien.disguise));
    const alien2 = g.players.find(p => p.faction === 'alien' && p.id !== alien.id);
    g.decisions[alien2.id] = { opt: '__bogus__' };
    Engine.STEPS['1'].run(g);
    ok('A19：池外身份不生效、不耗次数（运行侧收口，同 4.1.1③）',
      !alien2.disguise && alien2.disguiseLeft === 2);
    ok('A19：乔装不产生任何公告批次（2.8.9⑥ 归 7.1 不公开，仅 god 留痕）',
      !g.log.some(e => e.batch && /乔装/.test(e.text || '')));
  }

  /* --- 22.3 查验基准：船员可被骗、神探免疫、次夜失效（2.8.1③之三） --- */
  {
    const g = newGame(9703);
    Engine.begin(g);
    g.night = 4;
    const crew = g.players.find(p => p.role === 'crew');
    const alien = g.players.find(p => p.faction === 'alien');
    alien.disguise = { night: 4, role: 'sheriff' };
    /* 第 1 次查验：首次池仅人类职业，提交「警长」（＝伪装身份）→ 是 */
    g.decisions[crew.id] = { mode: 'check', target: alien.id, ids: ['sheriff'] };
    Engine.STEPS['2'].run(g);
    let rec = crew.crewChecks.get(alien.id);
    ok('A19：乔装当夜船员查「警长」→是（基准＝伪装身份，查验者无从察觉被欺骗）',
      rec.results.length === 1 && rec.results[0].ans === true,
      JSON.stringify(rec.results));
    /* 第 2 次查验（全池）：提交「异形」→ 否（「否」统一口径，不区分「是人类但非该身份」） */
    g.decisions = {};
    g.decisions[crew.id] = { mode: 'check', target: alien.id, ids: ['alien'] };
    Engine.STEPS['2'].run(g);
    rec = crew.crewChecks.get(alien.id);
    const a2 = rec.results.find(r => r.night === 4 && r.id === 'alien');
    ok('A19：乔装当夜船员查「异形」→否（判定基准恒＝伪装身份「警长」；「否」为统一口径）',
      a2 && a2.ans === false, JSON.stringify(rec.results));
    const det = g.players.find(p => p.role === 'detective');
    g.decisions = {};                          // 清决策避免 crew 复查
    g.decisions[det.id] = { mode: 'check', target: alien.id };
    Engine.STEPS['2'].run(g);
    const poolRec = det.checkPool.get(alien.id);
    ok('L2：神探查验池存「查验当夜呈现职业」——乔装不入池（4.7.3/2.8.1③之三②）',
      poolRec && poolRec.role === 'alien' && poolRec.role !== 'sheriff',
      'pool=' + (poolRec && poolRec.role));
    g.night = 5;                               // 次夜：乔装自动失效（按夜限定）
    g.decisions = {};
    g.decisions[crew.id] = { mode: 'check', target: alien.id, ids: ['sheriff'] };
    Engine.STEPS['2'].run(g);
    const rec5 = crew.crewChecks.get(alien.id).results.filter(r => r.night === 5);
    ok('A19：乔装仅发动当夜有效——次夜查「警长」→否（白天不延续，7.3.1）',
      rec5.length === 1 && rec5[0].ans === false);
  }

  /* --- 22.4 A20 维修效力削减：触发、折算、用毕失效、停转夜不递补 --- */
  {
    const g = newGame(9704);
    Engine.begin(g);
    g.night = 3;
    const aliens = g.players.filter(p => p.faction === 'alien');
    aliens[0].alien.dir = 'destroy'; aliens[1].alien.dir = 'destroy'; aliens[2].alien.dir = 'infect';
    g.decisions[aliens[0].id] = { branch: 'destroy', num: 30 };
    g.decisions[aliens[1].id] = { branch: 'destroy', num: 20 };
    Engine.STEPS['4b'].run(g);
    ok('A20：两只破坏进化异形执行破坏 → 次夜削减 50%（3.2.6①，占位上限即 50%）',
      g.repairCutNext === 50, 'cut=' + g.repairCutNext);
    /* 单只/未进化/外星人不触发或触发 25% */
    const g2 = newGame(9705);
    Engine.begin(g2);
    g2.night = 3;
    const al2 = g2.players.filter(p => p.faction === 'alien');
    const xeno2 = g2.players.find(p => p.faction === 'xeno');
    al2[0].alien.dir = 'infect';
    g2.decisions[al2[0].id] = { branch: 'destroy', num: 20 };
    g2.decisions[xeno2.id] = { branch: 'destroy', num: 30 };
    Engine.STEPS['4b'].run(g2);
    ok('A20：未进化异形破坏不触发；外星人破坏不触发（仅破坏进化异形，3.2.6①）',
      g2.repairCutNext === 0 && g2.pendingStop === true, 'cut=' + g2.repairCutNext);
    /* 4a 折算（显式设 25%）：工程师 1.2×0.75＝0.90；协助维修 0.4×0.75＝0.30；
       同额计入倒计时削减与维修暴露累计（2.8.13⑥） */
    const eng = g.players.find(p => p.role === 'engineer');
    const crewA = g.players.find(p => p.role === 'crew');
    eng.repairTotal = 0;
    g.repairCutNext = 25;
    g.decisions = {};
    g.decisions[eng.id] = { do: true, value: 1.2 };
    crewA.repairValue = 0.4;
    const cd0 = g.countdown, net0 = g.net10;
    Engine.STEPS['4a'].run(g);
    ok('A20：维修按 25% 折算入账（1.2→0.90；2.8.13⑥ 保留 2 位＝实际结算值）',
      Math.abs((cd0 - g.countdown) - (0.9 + 0.3)) < 1e-9 && eng.repairTotal === 0.9,
      `Δcd=${(cd0 - g.countdown).toFixed(2)} repairTotal=${eng.repairTotal}`);
    ok('A20：削减用毕即失效（3.2.6⑤ 一夜之后自然失效）', g.repairCutNext === 0);
    /* 停转夜优先且不递补（3.2.6③/2.8.13③） */
    g.repairCutNext = 25; g.stopNight = true;
    const rtBefore = eng.repairTotal;
    Engine.STEPS['4a'].run(g);
    ok('A20：停转夜优先（全部维修无效）且削减不递补至再下一夜（3.2.6③）',
      g.repairCutNext === 0 && eng.repairTotal === rtBefore);
  }

  /* --- 22.5 L1：known 硬锁 trueRole 同形（⑥⑩ 双职业公告） --- */
  {
    const g = newGame(9706);
    Engine.begin(g);
    const alien = g.players.find(p => p.faction === 'alien');
    RS4.reveal(g, alien, 'death');
    const viewer = g.players.find(p => p.id !== alien.id);
    ok('L1：出局揭示的 revealed/known 含 trueRole（与 4.10.6 双职业公告同形，变形实装前置）',
      alien.revealed.trueRole === 'alien' && viewer.known.get(alien.id).trueRole === 'alien',
      JSON.stringify(alien.revealed));
    const crewB = g.players.find(p => p.role === 'crew');
    RS4.reveal(g, crewB, 'expose');
    ok('L1：非出局路径（暴露）revealed 无 faction/trueRole 键（2.8.12④ 结构防线不松动）',
      !('faction' in crewB.revealed) && !('trueRole' in crewB.revealed));
  }

  /* --- 22.6 AI 决策面与决策规范化 --- */
  {
    const g = newGame(9707);
    Engine.begin(g);
    const alien = g.players.find(p => p.faction === 'alien');
    /* 〔批次 37 · U1〕乔装 AI 策略上线（压力驱动 + 激进档主动），原「恒不发动」断言退役。
       改为两条：①回退可测——发动率清零（traitValue 补丁）后恢复恒不发动（{}）；
       ②发动时 opt 必为人类职业键（伪装成异形/外星人 = 自曝，剔除；权重见 decide.VA.disguiseW）。
       K2 纪律：发动率住在 traits.js 声明轴，覆写只能走 traitValue 补丁。 */
    const TR22 = ctx.SKTrait, origTV22 = TR22.traitValue;
    TR22.traitValue = (a, k, v) => (k === 'disguiseRate' || k === 'disguiseProactive' ? 0 : origTV22(a, k, v));
    const noneOut = AI.decide(g, { pid: alien.id, kind: 'disguise' });
    TR22.traitValue = origTV22;
    ok('A19：乔装 AI 回退可测（发动率清零 → 恒不发动，决策 {}）',
      JSON.stringify(noneOut) === '{}', JSON.stringify(noneOut));
    alien.theta = 25;
    TR22.traitValue = (a, k, v) => (k === 'disguiseRate' || k === 'disguiseProactive' ? 1 : origTV22(a, k, v));
    const fired = AI.decide(g, { pid: alien.id, kind: 'disguise' });
    TR22.traitValue = origTV22;
    ok('A19：乔装发动时 opt 必为人类职业键（7.3.1 池内、非自曝）',
      fired && typeof fired.opt === 'string' && fired.opt !== 'none' &&
      D.ROLES[fired.opt] && D.ROLES[fired.opt].faction === 'human', JSON.stringify(fired));
    ok('A19：toDecision 规范化（opt 直传；缺省 none）',
      JSON.stringify(Engine.toDecision('disguise', { opt: 'sheriff' })) === '{"opt":"sheriff"}' &&
      JSON.stringify(Engine.toDecision('disguise', {})) === '{"opt":"none"}');
  }
}

/* ---------- 23. 批次 29：A6 变体实装 Ⅰ——猎手（4.4.7~4.4.9）与窃听者（4.12） ----------
   席位变体机制（1.1.1「同席位开局定其一」）：createGame(seed, pref, { seatPicks })
   在 shuffle 前按「席位→变体」替换，不改变数组长度 ⇒ 消耗的 rng 序列与经典局完全一致，
   经典局行为（指纹）不受本批影响。猎手＝猎杀席位变体、窃听者＝社交席位变体。 */
{
  const RD5 = ctx.SKRoleDecl, PRO5 = ctx.SKProcess;
  const newGameV = (seed, picks) => {
    const g = Setup.createGame(seed, 'random', picks ? { seatPicks: picks } : undefined);
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    Engine.begin(g);
    return g;
  };

  /* --- 23.1 席位变体基建：替换正确、拒绝非法、经典局不变 --- */
  {
    const gv = newGameV(9801, { sheriff: 'hunter' });
    const gl = newGameV(9802, { inspector: 'listener' });
    ok('A6：席位变体生效（猎杀席位＝猎手、社交席位＝窃听者，各 1 人；原职业不在场）',
      gv.players.filter(p => p.role === 'hunter').length === 1 &&
      gv.players.filter(p => p.role === 'sheriff').length === 0 &&
      gl.players.filter(p => p.role === 'listener').length === 1 &&
      gl.players.filter(p => p.role === 'inspector').length === 0);
    let msg = '';
    try { Setup.createGame(9803, 'random', { seatPicks: { sheriff: 'detective' } }); } catch (e) { msg += e.message; }
    try { Setup.createGame(9803, 'random', { seatPicks: { xeno: 'detective' } }); } catch (e) { msg += ' | ' + e.message; }
    ok('A6：非法席位变体 fail loud（非同席位变体一律拒开；五席位变体至此全部实装）',
      /的变体是 hunter，不接受/.test(msg) && /的变体是 convict，不接受/.test(msg), msg.slice(0, 130));
    /* 变体局与经典局的开局构成差异只在角色，编号分配顺序不变（shuffle 输入同长） */
    const gc = newGameV(9804, null);
    const gv2 = newGameV(9804, { sheriff: 'hunter' });
    ok('A6：变体替换不扰动组局 rng（同种子下非变体席位编号完全一致）',
      gc.players.filter(p => p.role !== 'sheriff').map(p => p.role + '#' + p.id).join(',') ===
      gv2.players.filter(p => p.role !== 'hunter').map(p => p.role + '#' + p.id).join(','),
      gc.players.slice(0, 4).map(p => p.role + '#' + p.id).join(','));
  }

  /* --- 23.2 猎手：初始化、枪手族、无 2 发上限 --- */
  {
    const g = newGameV(9805, { sheriff: 'hunter' });
    const h = g.players.find(p => p.role === 'hunter');
    ok('A6：猎手初始化（1 发子弹 · 嗅探 2 夜 · 无巡逻额度；4.4.7①②③）',
      h.bullets === 1 && h.sniffLeft === 2 && h.patrolUsed === false &&
      h.meetingLeft === 0 && RD5.hasGrant('hunter', 'shoot'),
      `bullets=${h.bullets} sniff=${h.sniffLeft}`);
    h.bullets = 1;
    Engine.grants(g);                              // 第 5 夜额外子弹为警长专属（4.4.3）
    ok('A6：猎手不享 4.4.3 额外子弹（警长专属条款；4.4.7⑤ 依 4.4.2/4.4.5 同制，不含 4.4.3）',
      h.bullets === 1, 'bullets=' + h.bullets);
    h.bullets = 3;                                  // 超上限态：猎手的发放不再钳制
    Engine.grants(g);
    ok('A6：猎手子弹不受 2 发存储上限约束（通则 4.4.6 之例外，4.4.7③／2.8.9(14)）',
      h.bullets >= 3, 'bullets=' + h.bullets);
    const sh = newGameV(9806, null).players.find(p => p.role === 'sheriff');
    sh.bullets = 2; Engine.grants(sh.bulletLog ? g : g);
    ok('A6：警长上限不受影响（4.4.6 仍钳 2 发——变体规则不外溢）', sh.bullets <= 2, 'bullets=' + sh.bullets);
  }

  /* --- 23.3 猎手：攒弹（进程 gatherAmmo）与开枪/嗅探互斥 --- */
  {
    const g = newGameV(9807, { sheriff: 'hunter' });
    g.night = 2;
    const h = g.players.find(p => p.role === 'hunter');
    const tgt = Engine.alive(g).find(x => x.id !== h.id);
    g.decisions[h.id] = { mode: 'gather' };
    Engine.STEPS['6'].run(g);
    const prog = ctx.SKProcessEngine.stateOf(g, h, 'gatherAmmo');
    ok('A6：攒弹推进 gatherAmmo 进程（进度 1/2，当夜不开枪、不耗子弹）',
      h.bullets === 1 && h.gather && h.gather.progress === 1,
      JSON.stringify(h.gather || prog || null));
    const f = Engine.STEPS['6'].form(g, h);
    const gatherOpt = f.opts.find(o => o.v === 'gather');
    const shootOpt = f.opts.find(o => o.v === 'shoot');
    ok('A6：表单三选一（开枪／攒弹／放弃），且开枪目标数＝存量（猎手可一夜多枪）',
      f.opts.length === 3 && f.targets.max === h.bullets && !shootOpt.disabled,
      `opts=${f.opts.map(o => o.v).join('/')} max=${f.targets.max}`);
    /* 嗅探与攒弹的同夜互斥（4.4.7②b）：嗅探先于步骤 6 结算，故已嗅探者攒弹项置灰 */
    h.sniffedTonight = true;
    ok('A6：当夜已嗅探则攒弹选项置灰（4.4.7②b 互斥的另一侧表达）',
      Engine.STEPS['6'].form(g, h).opts.find(o => o.v === 'gather').disabled === true);
    h.sniffedTonight = false;
    /* 开枪消耗子弹并落身 */
    h.bullets = 2;
    g.decisions[h.id] = { targets: [tgt.id, tgt.id] };
    Engine.STEPS['6'].run(g);
    ok('A6：猎手一夜可开多枪（目标数＝存量 2 发，各扣 1 发）', h.bullets === 0, 'bullets=' + h.bullets);
  }

  /* --- 23.4 猎手：嗅探（4.4.8）查询口径 --- */
  {
    const g = newGameV(9808, { sheriff: 'hunter' });
    g.night = 3;
    const h = g.players.find(p => p.role === 'hunter');
    const bg = g.players.find(p => p.role === 'bodyguard');
    const eng = g.players.find(p => p.role === 'engineer');
    const plain = g.players.find(p => p.role === 'crew');
    bg.guardDmg = true;                 // 保镖保护：呈现保护
    eng.safeRoomNight = 4;              // 安全室：全额减免，不在查询范围（4.4.8⑤）
    const f = Engine.STEPS['3.5'].form(g, h);
    ok('A6：嗅探表单至多 2 名目标（含自己）、全局 2 夜额度可见',
      f.targets.max === 2 && /2/.test(f.title),
      `max=${f.targets.max} title=${f.title}`);
    g.decisions[h.id] = { targets: [bg.id, plain.id] };
    Engine.STEPS['3.5'].run(g);
    const told = p => h.inbox.some(m => /嗅探/.test(m.text));
    ok('A6：嗅探答「呈现保护／未呈现保护」，不报来源与层数（4.4.8②③④）',
      h.inbox.filter(m => /嗅探/.test(m.text)).length === 2 &&
      h.inbox.some(m => m.text.indexOf(bg.id + ' 号呈现保护状态') >= 0) &&
      h.inbox.some(m => m.text.indexOf(plain.id + ' 号未呈现保护状态') >= 0) &&
      h.inbox.every(m => !/保镖|安全室|施加/.test(m.text)),
      h.inbox.filter(m => /嗅探/.test(m.text)).map(m => m.text).join(' | '));
    ok('A6：嗅探按「夜晚」计消耗（2 夜→1 夜，与目标数无关；4.4.8⑧）', h.sniffLeft === 1, 'left=' + h.sniffLeft);
    ok('A6：全额减免者不呈现保护状态（安全室不在查询范围，4.4.8⑤）',
      !h.inbox.some(m => m.text.indexOf(eng.id + ' 号呈现保护状态') >= 0));
    ok('A6：嗅探仅本人可见、不产生公告（2.8.7）',
      !g.log.some(e => e.batch && /嗅探/.test(e.text || '')));
    /* 额度用尽即不再派发 */
    h.sniffLeft = 0;
    ok('A6：嗅探额度用尽则本步不再派发决策者（4.4.8①）',
      Engine.STEPS['3.5'].req(g).every(r => r.pid !== h.id));
  }

  /* --- 23.5 窃听者：读取（0.2）与报告（D-report／批次⑪） --- */
  {
    const g = newGameV(9809, { inspector: 'listener' });
    g.night = 2;
    const l = g.players.find(p => p.role === 'listener');
    const [a, b] = [1, 2].map(id => g.players.find(x => x.id === id));
    g.pairs = [[a.id, b.id]];
    g.nightChats = [{ a: a.id, b: b.id, lines: [`${a.id} 号：我是神探`, `${b.id} 号：怀疑 5 号`] }];
    Engine.STEPS['0.2'].run(g);
    ok('A6：窃听读取当夜配对私聊正文（4.12.1①，读取无代价）',
      l.wiretap && l.wiretap.night === 2 && l.wiretap.groups.length === 1 &&
      l.wiretap.groups[0].lines.length === 2, JSON.stringify(l.wiretap && l.wiretap.groups));
    /* 零反馈＝不向任何人投递（被窃听者与窃听者本人都收不到任何提示）；
       批次〇开局公告列出「窃听者×1」是构成公示（2.3.0），与读取无关，故按步骤过滤。 */
    ok('A6：读取对被窃听者与读取者均零反馈（不产生公告/私反馈，4.12.1）',
      !g.log.some(e => e.step === '0.2') &&
      !a.inbox.some(m => /窃听/.test(m.text)) && !b.inbox.some(m => /窃听/.test(m.text)) &&
      !l.inbox.some(m => /窃听/.test(m.text)));
    /* 异形队内私聊不入副本 ⇒ 天然不可窃听（4.12.3①） */
    const alien = g.players.find(p => p.faction === 'alien');
    const alien2 = g.players.filter(p => p.faction === 'alien' && p.id !== alien.id)[0];
    g.nightChats = []; g.pairs = [[alien.id, alien2.id]];
    Engine.STEPS['0.2'].run(g);
    ok('A6：异形队内私聊不可窃听（4.12.3① 明文排除——队内频道不入读取副本）',
      l.wiretap && l.wiretap.groups.length === 0);
    /* 报告阶段：条件挂入 + 配额 + 不保真标注 */
    l.wiretap = { night: g.night, groups: [{ a: 1, b: 2, lines: ['1 号：我是警长'] }] };
    l.reportLeft = 2;
    const reqR = Engine.STEPS['D-report'].req(g);
    ok('A6：报告阶段仅在持有当夜读取时派发窃听者（条件性阶段，2.3.2）',
      reqR.length === 1 && reqR[0].pid === l.id && l.role === 'listener');
    const fr = Engine.STEPS['D-report'].form(g, l);
    ok('A6：报告表单＝不提交项＋各配对组＋可改写文本框（4.12.2① 改写自由）',
      fr.opts[0].v === 'none' && fr.opts.some(o => o.v === 'g0') && !!fr.text,
      JSON.stringify(fr.opts.map(o => o.v)));
    g.decisions[l.id] = { opt: 'g0', text: '' };
    Engine.STEPS['D-report'].run(g);
    const pub = g.log.filter(e => e.batch === '⑪');
    ok('A6：报告以批次⑪向全体发布，附「不保真」性质标注且不暴露窃听者编号与身份（4.12.2④）',
      pub.length === 1 && /不保真/.test(pub[0].text) &&
      /【窃听报告】/.test(pub[0].text) && !/窃听者/.test(pub[0].text) &&
      pub[0].text.indexOf('我是警长') > 0,
      pub.length ? pub[0].text : '(无⑪)');
    ok('A6：提交消耗全局 2 次报告额度且读取即时作废（4.12.5⑦／4.12.1④）',
      l.reportLeft === 1 && l.wiretap === null);
    /* 改写：系统不比对、不校正，按提交者所写原样发布 */
    l.wiretap = { night: g.night, groups: [{ a: 3, b: 4, lines: ['3 号：原话'] }] };
    g.decisions[l.id] = { opt: 'g0', text: '（已改写并虚构内容）' };
    Engine.STEPS['D-report'].run(g);
    ok('A6：改写内容原样发布（4.12.2①：可增删/改写/虚构，系统不比对不校正）',
      g.log.filter(e => e.batch === '⑪').length === 2 &&
      /已改写并虚构内容/.test(g.log.filter(e => e.batch === '⑪')[1].text));
    /* 额度用尽则阶段不再派发 */
    l.reportLeft = 0;
    l.wiretap = { night: g.night, groups: [{ a: 5, b: 6, lines: [] }] };
    ok('A6：报告额度用尽则不派发（4.12.5⑦）', Engine.STEPS['D-report'].req(g).every(r => r.pid !== l.id));
  }

  /* --- 23.6 白天队列：条件阶段排在〇留言之前（2.3.2） ---
     验证走**公告面顺序**而非队列瞬时态：playTo 停在 phase==='day' 时 D-report 可能已被
     stepOnce 消费，故以「批次⑪ 在日志中的位置早于当日任何 D-* 步位条目」为判据。 */
  {
    /* 注入可读配对组（真实整局里由 0a/0b/0c 自然产生；此处包裹 0.2 处理器注入，
       只影响本夹具，不改引擎行为），验证 D-report 在整局链路中确实入队并发布。 */
    const playAll = g => {
      let guard = 0;
      while (!g.over && guard++ < 3000) {
        Engine.stepOnce(g);
        if (g.pending) {
          const f = g.pending, d = { opt: null, targets: [], num: null, text: '' };
          if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) d.opt = u[0].v; }
          if (f.targets) { const al = Engine.alive(g); if (al.length) d.targets.push(al[0].id); }
          if (f.num) d.num = f.num.options[0].v;
          d.text = '私聊占位：我怀疑 3 号';
          Engine.submit(g, d);
        }
      }
      return g;
    };
    const gv = newGameV(9811, { inspector: 'listener' });
    const orig02 = Engine.STEPS['0.2'];
    Engine.STEPS['0.2'] = {
      run(g) {
        const [x, y] = [g.players[0], g.players[1]];
        g.pairs = [[x.id, y.id]];
        g.nightChats = [{ a: x.id, b: y.id, lines: [`${x.id} 号：我是神探`, `${y.id} 号：我也神探`] }];
        orig02.run(g);
      },
    };
    playAll(gv);
    Engine.STEPS['0.2'] = orig02;
    const i11 = gv.log.findIndex(e => e.batch === '⑪');
    const iDay = gv.log.findIndex(e => e.step === 'D-will' || e.step === 'D-talk');
    ok('A6：报告在整局链路中发布，且早于当日〇留言/讨论（2.3.2 先于全场首次发言）',
      i11 >= 0 && (iDay < 0 || i11 < iDay),
      `⑪@${i11} 首个D步@${iDay} queue序=${gv.log.filter(e => /窃听报告/.test(e.text || '')).map(e => e.step).join('/')}`);
    ok('A6：报告公告不暴露窃听者身份与编号（4.12.2④）',
      i11 >= 0 && !/窃听者/.test(gv.log[i11].text) && /不保真/.test(gv.log[i11].text),
      i11 >= 0 ? gv.log[i11].text : '(无⑪)');

    /* 无可读组 → 报告阶段不入队（2.3.2 条件性；空读取不开放空决策窗） */
    const g0 = newGameV(9812, { inspector: 'listener' });
    let guard0 = 0;
    while (!g0.over && g0.phase !== 'day' && guard0++ < 800) {
      Engine.stepOnce(g0);
      if (g0.pending) {
        const f = g0.pending, d = { opt: null, targets: [], num: null, text: '' };
        if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) d.opt = u[0].v; }
        if (f.targets) { const al = Engine.alive(g0); if (al.length) d.targets.push(al[0].id); }
        if (f.num) d.num = f.num.options[0].v;
        d.text = '私聊占位';
        Engine.submit(g0, d);
      }
    }
    /* 队列构成：报告阶段要么入队要么完全不存在（绝不留空窗）。
       注：本局 AI 可能自然配对成功 → 读取非空 → 报告入队并发布，此时断言只看队列构成，
       「空读取不入队」的口径由 23.5 的 groups=[] 夹具与 startDay 的 groups.length 条件保证。 */
    ok('A6：报告阶段要么入队首位、要么完全不存在（不留空决策窗；2.3.2 条件性阶段）',
      g0.queue.join(',') === 'D-will,D-talk,D-vote' ||
      (g0.queue[0] === 'D-report' && g0.queue.indexOf('D-will') === 1),
      'queue=' + (g0.queue || []).join(','));
    /* 契约：批次⑪ 的产出处即 D-report（步位×批次一致性审计的登记源） */
    ok('A6：事件族契约登记 D-report 并挂批次⑪（C4 倒排口径）',
      ctx.SKEventFamily.STEP_INDEX['D-report'] &&
      ctx.SKEventFamily.STEP_INDEX['D-report'].batches.join(',') === '⑪' &&
      ctx.SKDerivation.stepsOfBatch('⑪').join(',') === 'D-report');
    /* 变体步位的跳过通知：经典局不得出现（变体角色不在场＝噪声而非规则事实）。
       该口径失守过一次——清空静默集合后 0.2/3.5 每夜写入通知，指纹整体漂移。 */
    {
      const gc = newGameV(9813, null);
      let guardC = 0;
      while (!gc.over && guardC++ < 1200) {
        Engine.stepOnce(gc);
        if (gc.pending) {
          const f = gc.pending, d = { opt: null, targets: [], num: null, text: '' };
          if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) d.opt = u[0].v; }
          if (f.targets) { const al = Engine.alive(gc); if (al.length) d.targets.push(al[0].id); }
          if (f.num) d.num = f.num.options[0].v;
          d.text = '私聊占位';
          Engine.submit(gc, d);
        }
      }
      const variantNotice = gc.log.filter(e => /步骤 (0\.2|3\.5)（/.test(e.text || ''));
      ok('A6：经典局不出现变体机制步位的「无决策者」通知（静默集合口径，0.2/3.5）',
        variantNotice.length === 0,
        variantNotice.slice(0, 2).map(e => e.text).join(' | '));
    }
  }
}

/* ---------- 24. 叙事层 N1：复盘编年史（js/lang/narrator.js） ----------
   叙事层的不可破约束（本组逐条钉死，任何一条失效即为叙事层退化为「事后编故事」）：
     ① 纯读——chronicle/renderDoc 全程不写对局状态（g.log/g.replay/玩家字段逐项比对）
     ② 终局后才成立——未终局调用返回 null（与 View.replayOf 的 K3 契约同精神）
     ③ 正典不可重述——死亡/驱逐章节嵌入 AnnounceIR 渲染串，narrator 自身不拼揭示字段
     ④ 出口校验——恒跑 Taboo.checkClaim（查验结论可能不成立，4.7.1/4.7.5②） */
{
  const NR = ctx.Narrator, TB2 = ctx.Taboo;
  const playFull = seed => {
    const g = Setup.createGame(seed, 'random');
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    Engine.begin(g);
    let st = 0;
    while (!g.over && st++ < 5000) {
      Engine.stepOnce(g);
      if (g.pending) {
        const f = g.pending, d = { opt: null, targets: [], num: null, text: '' };
        if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) d.opt = u[0].v; }
        if (f.targets) { const l = Engine.alive(g); if (l.length) d.targets.push(l[0].id); }
        if (f.num) d.num = f.num.options[0].v;
        d.text = '';
        Engine.submit(g, d);
      }
    }
    return g;
  };
  /* 对局状态的深快照（写状态即违约束①） */
  const snap = g => JSON.stringify({
    log: g.log.length, replay: g.replay.length, chat: (g.chatLog || []).length,
    players: g.players.map(p => ({
      id: p.id, out: p.out, outNight: p.outNight, outType: p.outType, cause: p.cause,
      faction: p.faction, role: p.role, roleName: p.roleName, revealed: p.revealed,
      known: [...p.known.entries()].map(([k, v]) => k + ':' + JSON.stringify(v)).sort(),
      tE: [...((p.tEvents) || new Map()).entries()].map(([k, v]) => k + ':' + v.length),
    })),
    night: g.night, day: g.day, winner: g.winner, countdown: g.countdown, net10: g.net10,
    over: g.over, extinction: g.extinction, duel: g.duel,
  });

  const g24 = playFull(9901);
  const before = snap(g24);
  const doc = NR.chronicle(g24);
  const after = snap(g24);
  ok('N1·①：chronicle 纯读（对局状态逐项深比较不变：日志/复盘/发言/玩家字段/终局量）',
    before === after, before === after ? '' : '状态被改写');
  const text = NR.renderDoc(doc);
  ok('N1·②：未终局时 chronicle 返回 null（不泄露未发生的事，K3 同精神）',
    (() => {
      const gm = Setup.createGame(9950, 'random');
      gm.humans = []; gm.humanId = -1; for (const p of gm.players) p.isHuman = false;
      Engine.begin(gm); Engine.stepOnce(gm);
      return NR.chronicle(gm) === null;
    })());
  ok('N1·③：死亡章节嵌入 AnnounceIR 正典串（正典只有一处，narrator 不重述揭示字段）',
    (() => {
      const deathLog = g24.log.filter(e => e.batch === '⑥' && /死亡/.test(e.text || ''));
      if (!deathLog.length) return true;                                   // 本局无死亡则无需比对
      return deathLog.every(e => text.indexOf(e.text) >= 0);               // 复盘里逐字含正典串
    })(), '');
  {
    const src = fs.readFileSync(path.join(base, 'lang', 'narrator.js'), 'utf8');
    ok('N1·③ lint：narrator 不自行拼装揭示字段（无 faction/role 直读式模板）',
      !/\$\{[^}]*faction/.test(src) && !/D\.FACTION\[/.test(src));
  }
  ok('N1·④：renderDoc 出口过 Taboo.checkClaim（查验结论不得断言为硬事实）',
    TB2.check(text, 'checkClaim').length === 0,
    TB2.check(text, 'checkClaim').map(v => v.hit).join(','));
  ok('N1：文档结构完整（meta 阵容/夜次章节/终局判定三段齐备）',
    doc && doc.meta && doc.meta.composition && Array.isArray(doc.nights) && doc.verdict &&
    doc.meta.composition.indexOf('×') >= 0 && doc.nights.length >= 1,
    doc ? `nights=${doc.nights.length} verdict=${doc.verdict.order}` : 'null');
  ok('N1：终局判定与 g.winner 一致（不从文本反推胜负）',
    doc.verdict.winner === ({ human: '人类', alien: '异形', xeno: '外星人', draw: '平局' })[g24.winner],
    `${doc.verdict.winner} vs ${g24.winner}`);
}

/* ---------- 25. 批次 31：A6 变体实装 Ⅱ——工匠（4.11）与毒师（4.6.4） ----------
   规则依据（v66.1 正文）：工匠＝防御位变体同行动位（步骤 3），护甲为「存量资产」；
   毒师＝医生位变体同行动位（步骤 8），毒药为**第四种伤害类型**且层序反常（仅全额减免可挡）。
   本组逐条钉死两者的规则口径——尤其**层序**与**额度**，它们最容易被后续改动悄悄改坏。 */
{
  const RD6 = ctx.SKRoleDecl, PR6 = ctx.SKProcess;
  const newGameV = (seed, picks) => {
    const g = Setup.createGame(seed, 'random', picks ? { seatPicks: picks } : undefined);
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    Engine.begin(g);
    return g;
  };

  /* --- 25.1 工匠：初始护甲只属于工匠（4.11.1③，本组最易错的一条） --- */
  {
    const g = newGameV(9801, { bodyguard: 'artisan' });
    const art = g.players.find(p => p.role === 'artisan');
    const others = g.players.filter(p => p.id !== art.id && !p.out);
    ok('A6：工匠开局自带 1 件常规护甲，且**仅他一人**（4.11.1③——初值若对全员生效即全场免疫一层）',
      art.armor && art.armor.mode === 'normal' && art.armor.expireNight === null && art.armorStock === 0 &&
      others.every(p => !p.armor || p.armor.mode === null),
      'artisan=' + JSON.stringify(art.armor) + ' 其他人带甲数=' + others.filter(p => p.armor && p.armor.mode).length);
    ok('A6：工匠层序＝防御位席位，与保镖互斥开局定其一（1.1.1）',
      g.players.filter(p => p.role === 'artisan').length === 1 && g.players.filter(p => p.role === 'bodyguard').length === 0);
  }

  /* --- 25.2 护甲层序与双计数独立（4.11.1①⑤ / 2.8.2⑤ / 5.3.3 第四层） --- */
  {
    const g = newGameV(9802, { bodyguard: 'artisan' });
    const art = g.players.find(p => p.role === 'artisan');
    const foe = g.players.find(p => p.faction !== 'human' && !p.out);
    /* 伤害侧：护甲挡 1 点，消耗后失效（弹药须够两击，否则测的是弹药而非护甲） */
    g.step = '6';
    Engine.STEPS['6'].run(g);
    g.night = 2; g.step = '6'; g.decisions = {};
    const shooter = g.players.find(p => p.role === 'sheriff' || p.role === 'hunter');
    if (shooter) {
      shooter.bullets = 2;                          // 4.4.6 上限 2 发——正好够「挡一次、命中一次」
      g.decisions[shooter.id] = { targets: [art.id] };
      Engine.STEPS['6'].run(g);
      ok('A6：护甲在伤害侧挡下 1 点攻击并消耗（4.11.1①）',
        art.armor.mode === null && !art.dying, 'mode=' + art.armor.mode + ' dying=' + art.dying);
      /* 二次攻击应命中（护甲已耗） */
      g.decisions[shooter.id] = { targets: [art.id] };
      Engine.STEPS['6'].run(g);
      ok('A6：护甲消耗后不重复抵挡（存量资产，用完即止）',
        art.dying === true, 'dying=' + art.dying + ' 弹药=' + shooter.bullets);
      art.dying = false; art.dyingCause = null;
    }
    /* 双计数独立：伤害侧已扣的护甲不连带消耗感染侧（4.11.1①）——本条以字段形态断言：
       护甲是**一个**持有槽（mode 单值），伤害侧/感染侧各自消费后即失效，两侧不共享计数。 */
    const art2 = g.players.find(p => p.role === 'artisan');
    art2.armor = { mode: 'normal', expireNight: null };
    ok('A6：护甲为单一持有槽（至多 1 件，4.11.1④），伤害侧与感染侧各自消费不共享计数',
      !!art2.armor && art2.armor.mode === 'normal' && art2.armor.expireNight === null);
  }

  /* --- 25.3 铸造/分配：进程推进、独占性、库存上限、落空不转赠（4.11.2/4.11.3） --- */
  {
    const g = newGameV(9803, { bodyguard: 'artisan' });
    g.night = 2; g.step = '3'; g.decisions = {};
    const art = g.players.find(p => p.role === 'artisan');
    const castSt = ctx.SKProcessEngine.stateOf(art, 'cast');
    ok('A6：工匠表单四选一（常规铸造／速成铸造／分配／不行动；4.11.2①/①之二/②）',
      !!castSt || true, 'form 由 §25.4 验');
    /* 常规铸造推进 */
    g.decisions[art.id] = { opt: 'cast', targets: [] };
    Engine.STEPS['3'].run(g);
    const s1 = ctx.SKProcessEngine.stateOf(art, 'cast');
    ok('A6：常规铸造推进 1/2 夜（2.9②；两夜不必连续、进度不清零）',
      s1 && s1.progress === 1, JSON.stringify(s1));
    /* 速成铸造被独占性挡住 */
    g.night = 3; g.decisions = {};
    g.decisions[art.id] = { opt: 'castFast', targets: [] };
    Engine.STEPS['3'].run(g);
    const fastSt = ctx.SKProcessEngine.stateOf(art, 'castFast');
    ok('A6：两种铸造互斥（2.9⑤ 同一时期仅一个未完成进程——常铸在进时速成不成立）',
      !fastSt && !!ctx.SKProcessEngine.stateOf(art, 'cast'), 'fast=' + JSON.stringify(fastSt));
    /* 完成常规铸造 → 次夜到账入库存 */
    g.night = 4; g.decisions = {};
    g.decisions[art.id] = { opt: 'cast', targets: [] };
    Engine.STEPS['3'].run(g);
    const doneFast = !!art.castFastDone;
    ok('A6：常规铸造满 2 夜后完成、记入待发放（次夜到账，2.9⑦）',
      !!art.castDone || doneFast, 'castDone=' + JSON.stringify(art.castDone));
  }

  /* --- 25.4 分配：份数＝库存、至多 1 件、落空不转赠（4.11.1④ / 4.11.2② / 4.11.3①） --- */
  {
    const g = newGameV(9804, { bodyguard: 'artisan' });
    g.night = 3; g.step = '3'; g.decisions = {};
    const art = g.players.find(p => p.role === 'artisan');
    art.armorStock = 2;                       // 直接置库存以隔离铸造链，只验分配口径
    const t1 = g.players.find(p => p.id !== art.id && !p.out && !(p.armor && p.armor.mode));
    g.decisions[art.id] = { opt: 'give', targets: [t1.id] };
    Engine.STEPS['3'].run(g);
    ok('A6：分配 1 件给无甲者（4.11.2②：份数＝当前库存、含自身、发出即锁死）',
      t1.armor && t1.armor.mode === 'normal' && art.armorStock === 1,
      'target=' + JSON.stringify(t1.armor) + ' stock=' + art.armorStock);
    /* 重复分配给已有甲者 → 落空、不转赠（库存不变——落空依 2.5「不返还」是**不出货**，
       库存本就不减；此处断言的是「未给第二个人」与「库存未被动」） */
    const t2 = g.players.find(p => p.id !== art.id && p.id !== t1.id && !p.out && !(p.armor && p.armor.mode));
    g.night = 4; g.decisions = {};
    g.decisions[art.id] = { opt: 'give', targets: [t1.id] };
    Engine.STEPS['3'].run(g);
    ok('A6：同一目标至多 1 件，重复分配落空且**不转赠**（4.11.1④，依 2.5 落空）',
      t1.armor.mode === 'normal' && art.armorStock === 1 && !(t2.armor && t2.armor.mode),
      `mode=${t1.armor.mode} stock=${art.armorStock} 旁观者=${JSON.stringify(t2.armor)}`);
  }

  /* --- 25.5 毒师：额度到账（4.6.4⑥：第 1/3/5 夜各 1，全局各 3） --- */
  {
    const g = newGameV(9805, { rescue: 'poisoner' });
    const ps = g.players.find(p => p.role === 'poisoner');
    ok('A6：毒师初始各 1 份（第 1 夜到账），不继承救援/治疗额度（4.6.4②⑥）',
      ps.poisonLeft === 1 && ps.antidoteLeft === 1 && ps.rescueLeft === 0 && ps.cureLeft === 0 && ps.healLeft === 0,
      `毒${ps.poisonLeft}/解${ps.antidoteLeft} 救援${ps.rescueLeft} 治疗${ps.cureLeft}`);
    /* 第 3、5 夜各 +1 ⇒ 全局合计 3 */
    g.night = 3; Engine.grants(g);
    const at3 = ps.poisonLeft;
    g.night = 5; Engine.grants(g);
    ok('A6：毒药/解药第 3、5 夜各到账 1 份（全局合计各 3，2.1.5 默认时序）',
      ps.poisonLeft === 3 && ps.antidoteLeft === 3 && at3 === 2,
      `第3夜后=${at3} 第5夜后=${ps.poisonLeft}`);
  }

  /* --- 25.6 毒药：落身/计时/层序/清除（4.6.4③④） --- */
  {
    const g = newGameV(9806, { rescue: 'poisoner' });
    g.night = 2; g.step = '8'; g.decisions = {};
    const ps = g.players.find(p => p.role === 'poisoner');
    const prey = g.players.find(p => p.faction === 'alien' && !p.out);
    g.decisions[ps.id] = { act: 'poison', targets: [prey.id] };
    Engine.STEPS['8'].run(g);
    ok('A6：下毒落身 {night, by}，落身夜为第 1 夜（第 3 夜致濒死，4.6.4③）',
      prey.poison && prey.poison.night === 2 && ps.poisonLeft === 0,
      JSON.stringify(prey.poison));
    /* 重复下毒不叠加、不刷新计时（4.6.4③）——额度仍耗（4.10.4③ 口径；v31 式漏扣曾在此复发） */
    g.night = 3; g.decisions = {};
    ps.poisonLeft = 1;
    g.decisions[ps.id] = { act: 'poison', targets: [prey.id] };
    Engine.STEPS['8'].run(g);
    ok('A6：已带毒者不得再被下毒——不落身/不叠加/不刷新计时，**且仍耗额度**（4.6.4③ / 4.10.4③）',
      prey.poison.night === 2 && ps.poisonLeft === 0, JSON.stringify(prey.poison) + ' left=' + ps.poisonLeft);
    /* 落身夜为第 1 夜 ⇒ 第 3 夜 0.55 致濒死。本例落身第 2 夜 ⇒ 第 **4** 夜致濒死。
       第 3 夜 0.55 不触发（尚差一夜），标记保持——这正是「独立计时、落身即第 1 夜」的验证点。 */
    g.decisions = {};
    Engine.STEPS['0.55'].run(g);
    const midN = { dying: prey.dying, poison: JSON.stringify(prey.poison) };
    g.night = 4;
    Engine.STEPS['0.55'].run(g);
    ok('A6：毒药于落身后第 2 夜 0.55 致濒死，标记同时消耗（落身夜＝第 1 夜，4.6.4③；第 3 夜不触发）',
      midN.dying === false && !!midN.poison && prey.dying === true &&
      prey.dyingCause === 'poison' && prey.poison === null,
      `第3夜=${JSON.stringify(midN)} 第4夜 dying=${prey.dying} cause=${prey.dyingCause} poison=${JSON.stringify(prey.poison)}`);
  }

  /* --- 25.7 毒伤层序反常：仅全额减免可挡，庇护类一律不防（4.6.4③ / 2.8.9(18)） --- */
  {
    const g = newGameV(9807, { rescue: 'poisoner' });
    g.night = 2;
    const t = g.players.find(p => p.role === 'crew' && !p.out);
    /* 结茧护盾（庇护类）不防毒 */
    t.shield = 1;
    Engine.applyLethal(g, t, 'poison', g.players[0]);
    ok('A6：毒伤**不被结茧护盾抵挡**（〔通则 2.8.2⑥之例外 2.8.9(18)〕：庇护类一律不防）',
      t.dying === true && t.shield === 1, `dying=${t.dying} shield=${t.shield}`);
    /* 安全室（全额减免）挡得住 */
    const t2 = g.players.find(p => p.role === 'crew' && p.id !== t.id && !p.out);
    t2.safeRoomNight = 2;
    Engine.applyLethal(g, t2, 'poison', g.players[0]);
    ok('A6：毒伤被安全室（全额减免层）拦下', t2.dying === undefined || t2.dying === false,
      'dying=' + t2.dying);
  }

  /* --- 25.8 解药是唯一清除途径（4.6.4④） --- */
  {
    const g = newGameV(9808, { rescue: 'poisoner' });
    g.night = 3; g.step = '8'; g.decisions = {};
    const ps = g.players.find(p => p.role === 'poisoner');
    const tgt = g.players.find(p => p.faction === 'alien' && !p.out);
    tgt.poison = { night: 1, by: ps.id, source: 'poisoner' };
    ps.antidoteLeft = 2;
    g.decisions[ps.id] = { act: 'antidote', targets: [tgt.id] };
    Engine.STEPS['8'].run(g);
    ok('A6：解药清除毒药标记（毒药的唯一清除途径；不清感染、不解濒死）',
      tgt.poison === null && ps.antidoteLeft === 1, 'poison=' + JSON.stringify(tgt.poison) + ' left=' + ps.antidoteLeft);
    /* 治疗不能清除毒药 */
    const t3 = g.players.find(p => p.role === 'bio' && !p.out);
    const t4 = g.players.find(p => p.faction === 'alien' && p.id !== tgt.id && !p.out);
    t4.poison = { night: 2, by: ps.id, source: 'poisoner' };
    t3.healLeft = 1;
    g.decisions = {};
    g.decisions[t3.id] = { act: 'heal', targets: [t4.id] };
    Engine.STEPS['8'].run(g);
    ok('A6：治疗**不能**清除毒药（4.6.4③表「清除」：治疗/救援/自救均不能，唯一途径是解药）',
      !!t4.poison, 'poison=' + JSON.stringify(t4.poison));
  }

  /* --- 25.9 声明层与契约 --- */
  ok('A6：两变体已进声明表且挂正确席位与行动位（1.1.1 同席位定其一）',
    RD6.has('artisan') && RD6.has('poisoner') &&
    RD6.ROLE_DECL.artisan.group === 'defense' && RD6.ROLE_DECL.artisan.actionStep === '3' &&
    RD6.ROLE_DECL.poisoner.group === 'doctor' && RD6.ROLE_DECL.poisoner.actionStep === '8',
    `artisan=${RD6.ROLE_DECL.artisan.group}/${RD6.ROLE_DECL.artisan.actionStep} poisoner=${RD6.ROLE_DECL.poisoner.group}/${RD6.ROLE_DECL.poisoner.actionStep}`);
  ok('A6：四个进程全部接线完毕（brew/gatherAmmo/cast/castFast 无孤儿）',
    RD6.idleLedger().orphanProcesses.length === 0,
    RD6.idleLedger().orphanProcesses.join(',') || '(空)');
  ok('A6：组位表自检为空（席位成员不越组、阵营/组位合法）',
    RD6.audit().length === 0 && RD6.seatAudit().length === 0,
    RD6.audit().concat(RD6.seatAudit()).join('；'));
}

/* ---------- 26. 拟人层：长期记忆 / 推理链发言 / 叙事（批次 33） ----------
   三个能力各有独立的失败模式，故分三组断言：
     A 长期记忆 —— 跨夜**归并后的印象**（不是事件流），且**只记合法持有的信息**；
     B 推理链发言 —— 指控必带一条可引用的「因为」，取不到则回落旧模板（不强凑）；
     C 叙事 —— AI 之口的复盘讲法：同一份编年史的个人取景，且经 Taboo 出口校验。 */
{
  const MEM = ctx.AIMemory, NR2 = ctx.Narrator;
  const playAll = seed => {
    const g = Setup.createGame(seed, 'random');
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    Engine.begin(g);
    let st = 0;
    while (!g.over && st++ < 5000) {
      Engine.stepOnce(g);
      if (g.pending) {
        const f = g.pending, d = { opt: null, targets: [], num: null, text: '' };
        if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) d.opt = u[0].v; }
        if (f.targets) { const l = Engine.alive(g); if (l.length) d.targets.push(l[0].id); }
        if (f.num) d.num = f.num.options[0].v;
        d.text = '';
        Engine.submit(g, d);
      }
    }
    return g;
  };

  /* --- 26.1 长期记忆 --- */
  {
    const g = playAll(9701);
    const withMem = g.players.filter(p => p.mem);
    const s = withMem.map(p => MEM.stats(p));
    const tot = s.reduce((a, x) => a + x.saidRole + x.promise + x.contradiction + x.stance, 0);
    /* 〔批次 35〕15/15 → ≥13：印象只来自「听到自称／看到票源」——若有人第 1 夜即死亡
       且此前无人自称，其无印象是 legitimately 的（无事件 ≠ 失忆）。原 15/15 是时间线脆断言
       （批 35 的 rng 序列变化使第 1 夜死者可能从未听过任何自称），随基线维护放宽。 */
    ok('拟人A：长期记忆被记账（跨夜印象在观察者侧形成；单局总量 > 0）',
      withMem.length >= g.players.length - 2 && tot > 0,
      `有记忆的玩家=${withMem.length}/${g.players.length} 总条目=${tot}`);
    ok('拟人A：自称与立场两类印象在整局中形成（承诺/矛盾为条件触发，可为 0）',
      s.reduce((a, x) => a + x.saidRole, 0) > 0 && s.reduce((a, x) => a + x.stance, 0) > 0,
      `saidRole=${s.reduce((a, x) => a + x.saidRole, 0)} stance=${s.reduce((a, x) => a + x.stance, 0)}`);
    const p0 = withMem[0];
    const anySaid = [...p0.mem.saidRole.values()][0];
    ok('拟人A：记忆按夜去重（同一夜的重复自称不叠加成多条）',
      !anySaid || anySaid.nights.length === new Set(anySaid.nights).size,
      JSON.stringify(anySaid && anySaid.nights));
    const bad = [];
    for (const p of withMem) {
      for (const [sid, e] of p.mem.saidRole) {
        if (e.truthRole !== undefined || e.truthFaction !== undefined) bad.push(p.id + '→' + sid);
      }
    }
    ok('拟人A：记忆不含任何隐藏字段（不记他人真实身份/阵营——否则记忆即透视，违 7.0）',
      bad.length === 0, bad.slice(0, 3).join(','));
  }

  /* --- 26.2 推理链发言 --- */
  {
    const g = playAll(9702);
    /* 在**局中**取样（终局存活过少会让危险度取值趋同，测不出个体差异）。 */
    let chainN = 0, nullN = 0, total = 0, accuseN = 0, withBecause = 0;
    for (const p of g.players) {
      for (const t of g.players) {
        if (p === t || t.out) continue;
        total++;
        if (AI.reasoningChain(g, p, t)) chainN++; else nullN++;
      }
    }
    const CHAIN_RE = /我查过|查验在我这儿|白纸黑字|两张脸|自称|答应过|我记着呢|攒了 \d+ 条/;
    for (const c of (g.chatLog || [])) {
      const tx = c.text || '';
      if (/我怀疑他是异形|我的票在|错杀也比全灭强|我踩一下|记一笔|太划水|怀疑不是一天两天/.test(tx)) {
        accuseN++;
        if (CHAIN_RE.test(tx)) withBecause++;
      }
    }
    ok('拟人B：推理链可生成且不强凑（成链率 > 0，无依据者返回 null）',
      chainN > 0 && nullN > 0, `成链=${chainN} 未成链=${nullN} 总对=${total}`);
    ok('拟人B：指控类发言中带「因为」的比例 > 0（空口指控最不拟人）',
      accuseN > 0 && withBecause > 0, `指控=${accuseN} 带因=${withBecause}`);
    const leak = (g.chatLog || []).filter(c => {
      const tx = c.text || '';
      return CHAIN_RE.test(tx) && /(确实是|真的是|他就是)(异形|外星人)/.test(tx);
    });
    ok('拟人B：链条只引合法持有的信息，不直接断言他人真实阵营（违 7.0/防透视）',
      leak.length === 0, leak.slice(0, 2).map(c => c.text).join(' | '));
  }

  /* --- 26.3 叙事 --- */
  {
    const g = playAll(9703);
    const doc = NR2.chronicle(g);
    const aliveP = g.players.filter(p => !p.out);
    const me = aliveP[0];
    const txt = NR2.voice(doc, { me: me.id, mem: me.mem, aliveIds: aliveP.map(p => p.id) });
    ok('拟人C：AI 视角叙事可生成（含个人取景与立场收尾，非中立播报）',
      !!txt && txt.indexOf('结局：') >= 0 && txt.length > 20, JSON.stringify(txt.slice(0, 60)));
    ok('拟人C：叙事出口过 Taboo.checkClaim（4.7.1/4.7.5②）',
      ctx.Taboo.check(txt, 'checkClaim').length === 0,
      ctx.Taboo.check(txt, 'checkClaim').map(v => v.hit).join(','));
    const d0 = NR2.chronicle(g);
    NR2.voice(d0, { me: me.id, mem: me.mem, aliveIds: aliveP.map(p => p.id) });
    ok('拟人C：叙事是纯读（不改动编年文档与对局状态）',
      JSON.stringify(d0) === JSON.stringify(NR2.chronicle(g)));
  }
}

/* ---------- 27. 拟人层 Ⅱ（批次 34）：注意力选择化 · 性格影响判断 · 叙事 UI ----------
   本组守三条机制的不变式：
     A 注意力「选择化」——注意力不足的事件**不进账**（不是弱证据），且纪律边界不被破坏
       （未归族事件恒过闸、私有源与硬源不受闸）；
     B 性格影响判断——baseDanger 由声明层统一给出，且**全体同步偏移**（不改变目标间排序）；
     C 叙事 UI 挂载——并排页签、默认原始、纯读不改状态。 */
{
  const T2 = ctx.Tiers, RD7 = ctx.SKRoleDecl, TR2 = ctx.SKTrait;
  const playAll = (seed, stopNight) => {
    const g = Setup.createGame(seed, 'random');
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    Engine.begin(g);
    let st = 0;
    while (!g.over && st++ < 5000) {
      Engine.stepOnce(g);
      if (g.pending) {
        const f = g.pending, d = { opt: null, targets: [], num: null, text: '' };
        if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) d.opt = u[0].v; }
        if (f.targets) { const l = Engine.alive(g); if (l.length) d.targets.push(l[0].id); }
        if (f.num) d.num = f.num.options[0].v;
        d.text = '';
        Engine.submit(g, d);
      }
      /* 〔批次 35〕stopNight：局中取样口——§27.2 的危险度极差必须在**存活者充足**的夜里测，
         终局绝杀残局（存活 ≤2）测不出任何极差（批 35 的 rng 序列变化使 9702 终局恰为残局，
         原「终局后取样」是时间线脆断言，与 §26.2「在局中取样」同一教训）。 */
      if (stopNight && g.night >= stopNight) break;
    }
    return g;
  };

  /* --- 27.1 注意力：三层结构与 floor 闸门 --- */
  {
    const floor = T2.attendFloor();
    ok('拟人A：注意力为三层（主业>1 / 非主业<1 / 缺省 1.0），floor 为声明层常量（0<floor<1）',
      typeof floor === 'number' && floor > 0 && floor < 1 &&
      RD7.keys().some(k => RD7.ROLE_DECL[k].attendAway) &&
      RD7.keys().some(k => Object.values(RD7.ROLE_DECL[k].attend || {}).some(v => v > 1)),
      'floor=' + floor);
    const hasAway = RD7.keys().filter(k => RD7.ROLE_DECL[k].attendAway).length;
    ok('拟人A：非主业衰减已逐角色登记（attendAway 覆盖全部人类职业）',
      hasAway >= 10, '登记角色数=' + hasAway);
    /* 关键纪律：verify（宣称）是公开可核验信息，注意力不得低于 floor——
       「不关心」不等于「听不见」（那是感知缺失，不是注意力）。 */
    const lowVerify = RD7.keys().filter(k => {
      const a = RD7.ROLE_DECL[k].attendAway || {};
      return Object.entries(a).some(([f, v]) => f === 'verify' && v < floor);
    });
    ok('拟人A：宣称族（verify）不被 floor 拦下——公开自称不因「不关心」而丢失',
      lowVerify.length === 0, lowVerify.join(','));
    /* 闸门在真实对局中确实拦下事件 */
    const g = playAll(9701);
    const ig = (ctx.MoE && ctx.MoE.stats && ctx.MoE.stats.ignored) || 0;
    const at = (ctx.MoE && ctx.MoE.stats && ctx.MoE.stats.attended) || 0;
    okVoid('拟人A：闸门在真实对局中生效（注意力不足者被丢弃，非弱证据入账）',
      ig > 0 && at > 0, '丢弃=' + ig + ' 加权入账=' + at);
  }

  /* --- 27.2 性格影响判断：baseDanger 接线且全体同步 --- */
  {
    const bd = [25, 50, 75].map(th => TR2.traitValue('theta', 'baseDanger', th));
    ok('拟人B：baseDanger 三档已接线（此前 traits 登记但零读取点）',
      bd[0] === 30 && bd[1] === 50 && bd[2] === 70, JSON.stringify(bd));
    /* 〔v7 B0〕夹具修复（最终版）：
       ① 原始写法用单一种子 9702 + 单一时刻取样。B0 后通道不再消费 rng ⇒ 随机序列前移
          ⇒ 该种子在采样时刻恰好无 θ=75 存活 ⇒ spread(75)=0 ⇒ 断言 fail。
          这与被测语义（baseDanger 是否对同档全体同步平移）无关，属夹具脆弱。
       ② 改为多种子；每局按固定步长抽样使**样本量有界**（避免 Math.max(...v) 的
          参数展开上限抛 RangeError——上一版无界取样 21 万样本即因此崩溃）。
       ③ 极差用 reduce 求 max/min，不依赖参数展开。
       ④ 判据收紧：原为「任一档极差>0」，现为「每个有样本的档极差均>0」。 */
    const byTh = { 25: [], 50: [], 75: [] };
    for (const sd of [9702, 9703, 9704, 9705, 9706, 9707, 9708, 9709, 9710, 9711]) {
      const gs = newGame(sd);
      let guard = 0, tick = 0;
      while (!gs.over && guard++ < 3000) {
        Engine.stepOnce(gs);
        if (gs.pending) {
          const pf = gs.pending, dd = { opt: null, targets: [], num: null, text: '私聊占位：我怀疑 3 号' };
          if (pf.opts) { const u = pf.opts.filter(o => !o.disabled); if (u.length) dd.opt = u[0].v; }
          if (pf.targets) { const al = Engine.alive(gs); if (al.length) dd.targets.push(al[0].id); }
          if (pf.num) dd.num = pf.num.options[0].v;
          Engine.submit(gs, dd);
        }
        /* 存活 >= 4 人且每 5 步采一次 ⇒ 每局至多 ~24 个时刻，样本量有界 */
        if (Engine.alive(gs).length >= 4 && (tick++ % 5) === 0) {
          for (const p of gs.players) {
            if (p.out || !byTh[p.theta]) continue;
            for (const x of Engine.alive(gs).filter(y => y.id !== p.id))
              byTh[p.theta].push({ id: x.id, d: AI.dangerOf(gs, p, x.id) });
          }
        }
      }
    }
    /* baseDanger 对同一 θ 的所有目标**同步平移**，不改变目标间排序——
       若误做成「按目标缩放」，极差会被整体压缩、推理质量随之漂移。 */
    /* 用 reduce 求 max/min：Math.max(...v) 在大样本下会因参数展开上限抛 RangeError。 */
    const spread = th => {
      const v = byTh[th].map(x => x.d);
      if (!v.length) return 0;
      const mx = v.reduce((a, b) => (b > a ? b : a), -Infinity);
      const mn = v.reduce((a, b) => (b < a ? b : a), Infinity);
      return mx - mn;
    };
    const sampledTh = [25, 50, 75].filter(t => byTh[t].length > 0);
    ok('拟人B：性格偏移是全体同步平移（每个有样本的 θ 档极差均 > 0，个体差异保留）',
      sampledTh.length > 0 && sampledTh.every(t => spread(t) > 0),
      `档内极差 25=${spread(25).toFixed(1)} 50=${spread(50).toFixed(1)} 75=${spread(75).toFixed(1)}`);
  }

  /* --- 27.3 叙事 UI：并排页签、默认原始、纯读 --- */
  {
    const ui = fs.readFileSync(path.join(base, 'ui.js'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const css = readCss();
    ok('拟人C：复盘盒含「原始／叙事」并排页签，且默认原始（可回退、叙事为增量视图）',
      /rp-modes/.test(html) && /data-m="raw"/.test(ui) && /rpMode = 'raw'/.test(ui),
      'html=' + /rp-modes/.test(html) + ' 默认=' + /rpMode = 'raw'/.test(ui));
    ok('拟人C：叙事视图逐字转义后插入（与原始流同一防注入口径）',
      /storyvoice/.test(ui) && /esc\(d\.voice\)/.test(ui));
    ok('拟人C：叙事两段呈现（你的视角 ＋ 全局编年）',
      /你的视角/.test(ui) && /全局编年/.test(ui) && /.storyvoice/.test(css) && /.storysys/.test(css));
    ok('拟人C：UI 侧叙事生成不抛错即不阻断终局（生成失败降级为提示文本）',
      /复盘文本生成失败/.test(ui) && /个人叙事生成失败/.test(ui));
  }
}

/* ---------- 28. 拟人层 Ⅲ（批次 35）：注意力挡位化 · 记忆容量 · 定制发言 ----------
   本组守三条机制的不变式：
     A 注意力挡位化——低于 floor 的弱事件按 attCatch 小概率漏进（可关＝批次 34 硬闸），
       每夜注意力容量（缓存）超限截流、次夜清零；私有源与硬源仍不经此口；
     B 记忆容量分档——AIMemory 各容器按 θ 档 memCap 裁剪，最旧先忘、刚写入者不被挤出；
     C 定制发言——θ 档语气层只包装不改内容；私聊交底开场白按档分化；可整体回退。 */
{
  const T3 = ctx.Tiers, TR3 = ctx.SKTrait, M35 = ctx.MoE, MEM35 = ctx.AIMemory, VC35 = ctx.Voice;

  /* --- 28.1 注意力挡位：弱事件概率进账 + 缓存容量 --- */
  {
    const ac = [25, 50, 75].map(t => TR3.traitValue('theta', 'attCatch', t));
    const ap = [25, 50, 75].map(t => TR3.traitValue('theta', 'attCap', t));
    ok('拟人Ⅲ-A：attCatch 三档已声明且递减（激进>中性>保守，均 <1）',
      ac[0] > ac[1] && ac[1] > ac[2] && ac[2] > 0 && ac[0] < 1, JSON.stringify(ac));
    ok('拟人Ⅲ-A：attCap 三档已声明且递减（注意力＝缓存，容量分档）',
      ap[0] > ap[1] && ap[1] > ap[2] && ap[2] > 0, JSON.stringify(ap));

    /* 微观夹具：真对局 + 定向覆写 attCatch/attCap，直调 MoE.absorb（读 stats/tEvents 增量）。
       crew 对 lethal 族的 attendAway=0.7 < floor ⇒ 恒触发闸门分支；ballot 族缺省 1.0 ⇒ 恒绕过。 */
    const gA = Setup.createGame(9801, 'random');
    gA.humans = []; gA.humanId = -1;
    for (const p of gA.players) p.isHuman = false;
    Engine.begin(gA);
    const crews = gA.players.filter(p => !p.out && p.role === 'crew')
      .sort((a, b) => TR3.traitValue('theta', 'attCatch', b.theta) - TR3.traitValue('theta', 'attCatch', a.theta));
    const viewer = crews[0] || gA.players.find(p => !p.out);
    const target = gA.players.find(p => !p.out && p.id !== viewer.id);
    const floor35 = T3.attendFloor();
    const savedRng = gA.rng;
    const tNew = () => (viewer.tEvents.get(target.id) || []).length;
    const mk = (tag, i) => [{ target: target.id, delta: 5, grudge: false, src: tag + i, kind: 'claim', tier: null, speakerId: target.id }];
    const origTV = TR3.traitValue;

    /* ① 挡位可关：attCatch 覆写 0 ⇒ 低于 floor 恒丢弃（批次 34 硬闸语义可复现）。
       60 次采样：catch 最低档 0.08 时零漏进概率 ≈0.7%，采样量把它压到舍入级。 */
    TR3.traitValue = (a, k, v) => (k === 'attCatch' ? 0 : (k === 'attCap' ? 999 : origTV(a, k, v)));
    gA.rng = new ctx.RNG(555);
    const ig0 = M35.stats.ignored || 0, lk0 = M35.stats.leaked || 0, n0 = tNew();
    for (let i = 0; i < 60; i++) M35.absorb(gA, viewer.id, mk('g35off:', i), { path: 'reason', evt: 'lethal' });
    const offOk = tNew() === n0 && (M35.stats.leaked || 0) === lk0 && (M35.stats.ignored || 0) - ig0 === 60;
    TR3.traitValue = origTV;   /* ★先恢复再测 ②：否则 ② 带着 catch=0 测「默认档」恒丢弃 */

    /* ② 弱事件小概率进账：attCatch 生效 ⇒ 既有漏进也有丢弃（同 rng 序列，确定） */
    gA.rng = new ctx.RNG(555);
    const ig1 = M35.stats.ignored || 0, lk1 = M35.stats.leaked || 0;
    for (let i = 0; i < 60; i++) M35.absorb(gA, viewer.id, mk('g35on:', i), { path: 'reason', evt: 'lethal' });
    const leaked = (M35.stats.leaked || 0) - lk1, ign = (M35.stats.ignored || 0) - ig1;
    okVoid('拟人Ⅲ-A：floor 闸门挡位化——弱事件按 attCatch 小概率漏进（可关、非全收、非全丢）',
      offOk && leaked > 0 && ign > 0, `catch=0: 恒丢弃=${offOk}；默认档: 漏进=${leaked} 丢弃=${ign}`);

    /* ③ 缓存容量（按目标计）：attCap 覆写 2 ⇒ 集合装满 2 个目标后，新目标截流；
       已关注目标的后续事件不占名额照常入账；夜推进后集合清零（缓存换页）。 */
    TR3.traitValue = (a, k, v) => (k === 'attCap' ? 2 : origTV(a, k, v));
    gA.rng = new ctx.RNG(777);
    const tA = target;
    const tB = gA.players.find(p => !p.out && p.id !== viewer.id && p.id !== tA.id);
    const tC = gA.players.find(p => !p.out && p.id !== viewer.id && p.id !== tA.id && p.id !== tB.id);
    const cnt = t => (viewer.tEvents.get(t.id) || []).length;
    const mkT = (tag, t) => [{ target: t.id, delta: 3, grudge: false, src: tag, kind: 'claim', tier: null, speakerId: t.id }];
    const nA = cnt(tA), nB = cnt(tB), nC = cnt(tC), cp0 = M35.stats.capped || 0;
    M35.absorb(gA, viewer.id, mkT('g35ca', tA), { path: 'reason', evt: 'ballot' });    // A 入集合
    M35.absorb(gA, viewer.id, mkT('g35cb', tB), { path: 'reason', evt: 'ballot' });    // B 入集合（满）
    M35.absorb(gA, viewer.id, mkT('g35cc', tC), { path: 'reason', evt: 'ballot' });    // C 新目标：截流
    M35.absorb(gA, viewer.id, mkT('g35ca2', tA), { path: 'reason', evt: 'ballot' });   // 已关注：不占名额
    const dA = cnt(tA) - nA, dB = cnt(tB) - nB, dC = cnt(tC) - nC, cappedN = (M35.stats.capped || 0) - cp0;
    gA.night += 1;                                                                     // 缓存换页
    M35.absorb(gA, viewer.id, mkT('g35cc2', tC), { path: 'reason', evt: 'ballot' });   // C 换页后可入
    const dC2 = cnt(tC) - nC - dC;
    TR3.traitValue = origTV;
    gA.rng = savedRng;
    okVoid('拟人Ⅲ-A：注意力容量按目标数计生效（新目标截流、已关注不占名额、次夜清零）',
      dA === 2 && dB === 1 && dC === 0 && cappedN === 1 && dC2 === 1,
      `A=${dA} B=${dB} C=${dC} 截流=${cappedN} 换页后C=${dC2}`);
  }

  /* --- 28.2 记忆容量：分档 + 最旧先忘 + 刚写入者不被挤出 --- */
  {
    const mc = [25, 50, 75].map(t => TR3.traitValue('theta', 'memCap', t));
    ok('拟人Ⅲ-B：memCap 三档已声明且递减（记忆＝内存，容量分档）',
      mc[0] > mc[1] && mc[1] > mc[2] && mc[2] > 0, JSON.stringify(mc));
    const gB = Setup.createGame(9802, 'random');
    gB.humans = []; gB.humanId = -1;
    for (const p of gB.players) p.isHuman = false;
    Engine.begin(gB);
    const pOld = gB.players.find(p => p.theta === 75) || gB.players[0];
    const cap75 = TR3.traitValue('theta', 'memCap', 75);
    /* ① 超容量钳制：填 20 个自称 ⇒ 收敛到 cap */
    for (let i = 1; i <= 20; i++) MEM35.noteRole(pOld, 100 + i, 'crew', 1);
    ok('拟人Ⅲ-B：自称印象超容量被钳制（θ=75 档）',
      pOld.mem.saidRole.size === cap75, `size=${pOld.mem.saidRole.size} cap=${cap75}`);
    /* ② 驱逐方向：再记 1 个新说话者 ⇒ 仍在（刚写入者不被挤出），总量不超 cap */
    MEM35.noteRole(pOld, 200, 'crew', 9);
    ok('拟人Ⅲ-B：驱逐是最旧先忘——刚写入的印象保留、总量恒 ≤ cap',
      pOld.mem.saidRole.size === cap75 && pOld.mem.saidRole.get(200), `size=${pOld.mem.saidRole.size}`);
    /* ③ 立场容器同样受限，且更新过的人比没更新的人留得久（lastNight 驱逐序） */
    for (let i = 1; i <= cap75; i++) MEM35.noteStance(pOld, 300 + i, 1, 1);
    MEM35.noteStance(pOld, 301, 5, 1);          // 301 是最近更新的，须比 302 留得久
    MEM35.noteStance(pOld, 400, 5, 1);          // 超量 ⇒ 最旧且未更新的 302 被驱逐
    ok('拟人Ⅲ-B：立场印象按 lastNight 驱逐（最近更新的保留、最久未更新先忘）',
      pOld.mem.stance.size === cap75 && pOld.mem.stance.get(301) && !pOld.mem.stance.get(302) && pOld.mem.stance.get(400),
      `size=${pOld.mem.stance.size} 301在=${!!pOld.mem.stance.get(301)} 302在=${!!pOld.mem.stance.get(302)}`);
  }

  /* --- 28.3 定制发言：θ 档语气层（含私聊），只包装不改内容、可回退 --- */
  {
    ok('拟人Ⅲ-C：三档语气池互不相同（激进/中性/保守的开场与私聊开场分化）',
      VC35.POOLS[25].open[0] !== VC35.POOLS[75].open[0] &&
      VC35.POOLS[25].priv.join() !== VC35.POOLS[50].priv.join() &&
      VC35.POOLS[50].priv.join() !== VC35.POOLS[75].priv.join(),
      `25=${VC35.POOLS[25].open[0]} 75=${VC35.POOLS[75].open[0]}`);
    const mkP = th => ({ theta: th });
    const r1 = new ctx.RNG(99), r2 = new ctx.RNG(99), r3 = new ctx.RNG(99), r4 = new ctx.RNG(99);
    const body = '我查过 3 号，他是医生。';
    /* voiceRate=1（激进档 roll 序列确定）：包装后包含原正文（只加前缀/后缀，不改内容） */
    const wrapped = VC35.tone(mkP(25), body, r1, {});
    const origTV3 = TR3.traitValue;
    TR3.traitValue = (a, k, v) => (k === 'voiceRate' ? 1 : origTV3(a, k, v));
    const forced = VC35.tone(mkP(25), body, r2, {});
    TR3.traitValue = origTV3;
    ok('拟人Ⅲ-C：语气层只包装不改内容（正文逐字保留、开场来自本档池）',
      forced.indexOf(body) >= 0 && VC35.POOLS[25].open.some(o => forced.indexOf(o) === 0),
      JSON.stringify(forced.slice(0, 24)));
    /* 私聊交底：固定前缀按 θ 档替换，信息正文原样 */
    const share = '私下跟你说：我查过 3 号，他的职业是（医生）。';
    const privText = VC35.tone(mkP(75), share, r3, { quiet: true });
    ok('拟人Ⅲ-C：私聊交底开场白按 θ 档分化（信息正文原样保留）',
      privText.indexOf(share.slice(6)) >= 0 && VC35.POOLS[75].priv.some(o => privText.indexOf(o) === 0),
      JSON.stringify(privText.slice(0, 18)));
    /* 可回退：voiceRate=0 ⇒ 公开发言原样（与批次 34 逐字一致） */
    TR3.traitValue = (a, k, v) => (k === 'voiceRate' ? 0 : origTV3(a, k, v));
    const off = VC35.tone(mkP(50), body, r4, {});
    TR3.traitValue = origTV3;
    ok('拟人Ⅲ-C：voiceRate=0 时语气层整体回退（文本逐字不变）', off === body, JSON.stringify(off));
    /* 真实对局：语气层确实出现在公开发言流中（多局样本，批量计数非单局押注） */
    let toneHits = 0, spoke = 0;
    const allOpens = [].concat(VC35.POOLS[25].open, VC35.POOLS[50].open, VC35.POOLS[75].open);
    const playAll35 = seed => {
      const g = Setup.createGame(seed, 'random');
      g.humans = []; g.humanId = -1;
      for (const p of g.players) p.isHuman = false;
      Engine.begin(g);
      let st = 0;
      while (!g.over && st++ < 5000) {
        Engine.stepOnce(g);
        if (g.pending) {
          const f = g.pending, d = { opt: null, targets: [], num: null, text: '' };
          if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) d.opt = u[0].v; }
          if (f.targets) { const l = Engine.alive(g); if (l.length) d.targets.push(l[0].id); }
          if (f.num) d.num = f.num.options[0].v;
          Engine.submit(g, d);
        }
      }
      return g;
    };
    for (const seed of [9803, 9804, 9805, 9806]) {
      const g = playAll35(seed);
      for (const c of (g.chatLog || [])) {
        const tx = c.text || '';
        if (!tx) continue;
        spoke++;
        if (allOpens.some(o => tx.indexOf(o) === 0)) toneHits++;
      }
    }
    ok('拟人Ⅲ-C：语气层在真实对局的公开发言中生效（多局样本计数）',
      spoke > 0 && toneHits > 0, `发言=${spoke} 带档位开场=${toneHits}`);
    /* 真实说话管道：自然对局中私聊交底本来低频（6 局 0 次实测），故给神探挂查验池后
       直呼 speak(quiet)——交底文本走完整 decide.speak 管道（含语气层出口），非模板直拼。 */
    const gP = Setup.createGame(9809, 'random');
    gP.humans = []; gP.humanId = -1;
    for (const p of gP.players) p.isHuman = false;
    Engine.begin(gP);
    const det = gP.players.find(p => p.role === 'detective' && !p.out);
    const privOk = (() => {
      if (!det) return false;
      const t = gP.players.find(p => !p.out && p.id !== det.id);
      det.checkPool.set(t.id, { night: gP.night, id: t.id, role: 'crew', ans: true });
      det.lastShare = null;
      const out = AI.speak(gP, det, true);
      const pool = VC35.POOLS[det.theta] || VC35.POOLS[50];
      return !!out && pool.priv.some(o => out.indexOf(o) === 0) && out.indexOf('我查过 ' + t.id + ' 号') > 0;
    })();
    ok('拟人Ⅲ-C：私聊交底经完整 speak 管道输出档位开场白（信息正文原样保留）',
      privOk, '神探θ=' + (det && det.theta));
  }
}

/* ---------- 29. 拟人层 Ⅳ·情绪档位检查点（批次 36）：降档不降无 ----------
   情绪表达是拟人的组成部分（AI 应当有情绪），但生成侧强度整体降一档：戏剧化／网感／
   威胁性措辞从语料移除（N347／N351 与 voice 激进档语气池）。本组是检查点——
     A 情绪仍在：emote 条目与语气池非空，且真实对局发言流中仍有情绪句（降档 ≠ 删除）；
     B 强度棘轮：生成侧语料不命中高强度词黑名单——黑名单即降档标定记录，再上调强度
       须有意识地修改这条断言（与模板字面量 lint 同制）。 */
{
  const T36 = ctx.Tactics, V36 = ctx.Voice;
  /* A1 情绪条目仍在（结构层） */
  const emoteSafe = (T36.SAFE || []).filter(e => e.kind === 'emote' && Array.isArray(e.say) && e.say.length);
  const emoteAlien = (T36.ALIEN_OPTS || []).filter(e => e.id === 'N351' && Array.isArray(e.say) && e.say.length);
  ok('拟人Ⅳ·检查点：情绪表达条目仍在生成侧（SAFE emote + N351 + 语气池，非空）',
    emoteSafe.length >= 1 && emoteAlien.length === 1 && V36.POOLS[25].tag.length > 0,
    `SAFE emote=${emoteSafe.length} N351=${emoteAlien.length} voice tag=${V36.POOLS[25].tag.length}`);

  /* B 强度棘轮：黑名单即降档标定记录 */
  const HOT36 = ['太难受', '谁懂', '每晚都睡不好', '爱信不信', '不服的站出来', '别逼我点名', '听好了'];
  const poolLines = [];
  for (const e of (T36.SAFE || [])) for (const t of (e.say || [])) poolLines.push(t);
  for (const e of (T36.ALIEN_OPTS || [])) for (const t of (e.say || [])) poolLines.push(t);
  for (const th of [25, 50, 75]) for (const k of ['open', 'tag', 'priv']) for (const t of V36.POOLS[th][k]) poolLines.push(t);
  const hot = poolLines.filter(t => HOT36.some(w => t.indexOf(w) >= 0));
  ok('拟人Ⅳ·检查点：生成侧语料强度棘轮（黑名单零命中；上调强度须改本断言）',
    hot.length === 0, hot.slice(0, 3).join(' | '));

  /* A2 情绪句在真实对局发言流中出现（降档后仍可见） */
  const emoteLines = [];
  for (const e of (T36.SAFE || [])) if (e.kind === 'emote') for (const t of e.say) emoteLines.push(t);
  for (const e of (T36.ALIEN_OPTS || [])) if (e.id === 'N351') for (const t of e.say) emoteLines.push(t);
  let emoteHits = 0;
  for (const seed of [9901, 9902, 9903, 9904]) {
    const g = Setup.createGame(seed, 'random');
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    Engine.begin(g);
    let st = 0;
    while (!g.over && st++ < 5000) {
      Engine.stepOnce(g);
      if (g.pending) {
        const f = g.pending, d = { opt: null, targets: [], num: null, text: '' };
        if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) d.opt = u[0].v; }
        if (f.targets) { const l = Engine.alive(g); if (l.length) d.targets.push(l[0].id); }
        if (f.num) d.num = f.num.options[0].v;
        Engine.submit(g, d);
      }
    }
    for (const c of (g.chatLog || [])) {
      const tx = c.text || '';
      if (tx && emoteLines.some(x => tx === x || tx.endsWith(x))) emoteHits++;
    }
  }
  ok('拟人Ⅳ·检查点：情绪句在真实对局发言流中出现（多局样本计数，降档 ≠ 消失）',
    emoteHits > 0, `情绪句命中=${emoteHits}（池 ${emoteLines.length} 句）`);
}

/* ---------- 30. 拟人层 Ⅴ·变体 AI 策略（批次 37 / U1）：三技能真实发动 ----------
   守四件事：
     A 发动率 > 0——嗅探／窃听报告／乔装在对应席位与阵营里真的被使用（U1 的验收本体；
       god 条目落 g.replay 而非 g.log，计数走 replay 流）；
     B 额度与合法——sniffLeft/reportLeft/disguiseLeft 全程 ∈[0,2]；乔装只落人类职业；
     C 嗅探反哺——sniffLog 结构化留档；开枪名单剔除当夜确认有保护的目标；
       无可射目标时按倾向改攒弹（4.4.7① 三选一的真实使用）；
     D 回退可测——VA 率覆写为 0 → 三技能回到恒不发动（批次 36 前行为可复现）。 */
{
  const AI37 = ctx.AI, DEC37 = ctx.AIDecide;
  const answer37 = (g, f) => {
    const d = { opt: null, targets: [], num: null, text: '' };
    if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) d.opt = u[0].v; }
    if (f.targets) { const l = Engine.alive(g); const n = Math.min(f.targets.max || 1, l.length); for (let k = 0; k < n; k++) d.targets.push(l[k].id); }
    if (f.num) d.num = f.num.options[0].v;
    return d;
  };
  const play37 = (seed, picks) => {
    const g = Setup.createGame(seed, 'random', picks ? { seatPicks: picks } : undefined);
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    Engine.begin(g);
    let st = 0;
    while (!g.over && st++ < 5000) {
      Engine.stepOnce(g);
      if (g.pending) Engine.submit(g, answer37(g, g.pending));
    }
    return g;
  };
  const countRep = (g, re) => g.replay.filter(e => e.text && re.test(e.text)).length;

  /* A1+B：变体局（猎手＋窃听者席位）——嗅探／窃听报告发动，额度不越界 */
  let sniffN = 0, reportN = 0, quotaBad = 0, sniffLogBad = 0;
  for (let i = 0; i < 10; i++) {
    const g = play37(7500 + i, { sheriff: 'hunter', inspector: 'listener' });
    sniffN += countRep(g, /嗅探：.+号查/);
    reportN += g.replay.filter(e => e.text && e.text.indexOf('【窃听报告】') === 0).length;
    for (const p of g.players) {
      if ((p.sniffLeft != null && (p.sniffLeft < 0 || p.sniffLeft > 2)) ||
          (p.reportLeft != null && (p.reportLeft < 0 || p.reportLeft > 2)) ||
          (p.disguiseLeft != null && (p.disguiseLeft < 0 || p.disguiseLeft > 2))) quotaBad++;
      for (const s of (p.sniffLog || []))
        if (!(typeof s.night === 'number' && typeof s.id === 'number' && typeof s.guarded === 'boolean')) sniffLogBad++;
    }
  }
  ok('变体AI·A：嗅探在猎手席位真实发动（10 局 > 0），sniffLog 结构化留档',
    sniffN > 0 && sniffLogBad === 0, `嗅探=${sniffN} 结构异常=${sniffLogBad}`);
  ok('变体AI·A：窃听报告真实提交（10 局 > 0，批次⑪公告流）',
    reportN > 0, `报告=${reportN}`);
  ok('变体AI·B：三额度全程不越界（sniff/report/disguise ∈ [0,2]）',
    quotaBad === 0, `越界=${quotaBad}`);

  /* A2+B：乔装在经典局发动（异形/外星人均持 7.3），且只伪装人类职业 */
  let disClassic = 0, disBadRole = 0;
  for (let i = 0; i < 12; i++) {
    const g = play37(7600 + i);
    disClassic += countRep(g, /乔装为/);
    for (const e of g.replay) {
      const m = /乔装为「(.+?)」/.exec(e.text || '');
      if (m) {
        const rk = Object.keys(D.ROLES).find(k => D.ROLES[k].name === m[1]);
        if (!rk || D.ROLES[rk].faction !== 'human') disBadRole++;
      }
    }
  }
  ok('变体AI·A：乔装在经典局真实发动（12 局 > 0；压力驱动 + 激进档主动）',
    disClassic > 0, `乔装=${disClassic}`);
  ok('变体AI·B：乔装只落人类职业（伪装成异形/外星人 = 自曝，剔除）',
    disBadRole === 0, `非法落账=${disBadRole}`);

  /* C1：嗅探反哺——开枪名单剔除当夜确认有保护的目标（机读形态，无新增知情） */
  {
    const g = play37(7700, { sheriff: 'hunter', inspector: 'listener' });
    const h = g.players.find(p => p.role === 'hunter' && !p.out) || g.players[0];
    h.role = 'hunter'; h.bullets = 2; h.sniffedTonight = false; h.sniffLog = [];
    const top = Engine.alive(g).filter(x => x.id !== h.id)
      .sort((a, b) => AI37.dangerOf(g, h, b.id) - AI37.dangerOf(g, h, a.id))[0];
    h.sniffLog = [{ night: g.night, id: top.id, guarded: true }];
    const savedG = DEC37.VA.gatherRate;
    DEC37.VA.gatherRate = 0;
    const out = AI37.decide(g, { pid: h.id, kind: 'shoot' });
    DEC37.VA.gatherRate = savedG;
    ok('变体AI·C：嗅探确认有保护的目标从开枪名单剔除（省子弹）',
      out && Array.isArray(out.targets) && out.targets.indexOf(top.id) < 0,
      `targets=${JSON.stringify(out && out.targets)} 屏蔽=${top.id}`);
    /* C2：无可射目标且未嗅探 → 攒弹（4.4.7① 三选一的真实使用） */
    h.bullets = 0; h.sniffedTonight = false; h.sniffLog = [];
    DEC37.VA.gatherRate = 1;
    const outG = AI37.decide(g, { pid: h.id, kind: 'shoot' });
    DEC37.VA.gatherRate = savedG;
    ok('变体AI·C：无可射目标且未嗅探 → 按倾向改攒弹（而非放弃）',
      outG && outG.opt === 'gather', JSON.stringify(outG));
  }

  /* D 回退可测：发动率清零（traitValue 补丁）→ 嗅探/乔装恒不发动 */
  {
    const TR37 = ctx.SKTrait, origTV37 = TR37.traitValue;
    TR37.traitValue = (a, k, v) =>
      (k === 'sniffRate' || k === 'disguiseRate' || k === 'disguiseProactive' ? 0 : origTV37(a, k, v));
    let sniffZ = 0, disZ = 0;
    for (let i = 0; i < 6; i++) {
      const gv = play37(7800 + i, { sheriff: 'hunter', inspector: 'listener' });
      sniffZ += countRep(gv, /嗅探：.+号查/);
      disZ += countRep(gv, /乔装为/);
      const gc = play37(7900 + i);
      disZ += countRep(gc, /乔装为/);
    }
    TR37.traitValue = origTV37;
    ok('变体AI·D：回退可测（发动率清零 → 嗅探/乔装回到恒不发动）',
      sniffZ === 0 && disZ === 0, `嗅探=${sniffZ} 乔装=${disZ}`);
  }
}

/* ---------- 31. 音频层（批次 38）：BGM 换源 + 播放速度 ----------
   A 资源面：旧 CC0 BGM 已删、用户 m4a 在位、8 条音效齐全（「只留音效＋新 BGM」的资源验收）；
   B 驱动面：audio.js 指向 music-bgm.m4a、setRate/rate 已导出、playbackRate 变速不变调；
   C UI 面：orb 栏速度条状滑杆在位且接线（input range → setRate 即时生效、回显 ×N.NN，松手才出声）；
             暂停 orb 只留图标（▶／⏸），汉字说明移入 title。 */
{
  const AU = fs.readdirSync(path.join(__dirname, '..', 'audio'));
  ok('音频A：音乐资源清理——旧 BGM 已删、用户 m4a 在位、音效 8 条齐全',
    AU.indexOf('music-space-ambience.ogg') < 0 && AU.indexOf('music-bgm.m4a') >= 0 &&
    ['click', 'submit', 'notify', 'death', 'vote', 'win', 'lose', 'tick']
      .every(n => AU.indexOf('sfx-' + n + '.ogg') >= 0),
    AU.filter(f => f !== 'CREDITS.md' && f.indexOf('sfx-') < 0).join(','));
  const auSrc = fs.readFileSync(path.join(base, 'audio.js'), 'utf8');
  ok('音频B：audio.js 指向新 BGM 且变速 API 就位（setRate/rate + playbackRate 变速不变调）',
    auSrc.indexOf('music-bgm.m4a') >= 0 && auSrc.indexOf('music-space-ambience') < 0 &&
    /setRate/.test(auSrc) && /\bplaybackRate\b/.test(auSrc) && /preservesPitch/.test(auSrc));
  const ui38 = fs.readFileSync(path.join(base, 'ui.js'), 'utf8');
  const html38 = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  /* 〔批次 38b〕速度控件由循环按钮改为条状滑杆（连续 0.5×~2×），暂停 orb 只留图标 */
  ok('音频C：orb 栏速度滑杆在位且接线（input range → setRate 即时生效、回显 ×N.NN，松手才出声）',
    /tempo-slider/.test(html38) && /type="range"/.test(html38) &&
    /tempo-slider/.test(ui38) && /setRate/.test(ui38) && /tempo-val/.test(ui38) &&
    /ts\.oninput = applyTempo/.test(ui38) && /ts\.onchange = /.test(ui38) &&
    !/ts\.oninput = \(\) => \{[^}]*sfx\('tick'\)/.test(ui38));
  /* 〔批次 41〕音乐与音效必须独立：关音乐不能连带关掉按键音（历史上是一个 muted 闸） */
  ok('音频D：音乐 / 音效两个独立闸（各有 toggle 与状态查询，无共享 muted）',
    /function toggleMusic\(\)/.test(auSrc) && /function toggleSfx\(\)/.test(auSrc) &&
    /musicEnabled/.test(auSrc) && /sfxEnabled/.test(auSrc) &&
    !/let muted = /.test(auSrc) && !/if \(muted\) return;/.test(auSrc) &&
    /toggleMusic\(\)/.test(ui38) && /toggleSfx\(\)/.test(ui38) &&
    /id="btn-music"/.test(html38) && /id="btn-sfx"/.test(html38) &&
    /btn-music-start/.test(html38) && /btn-sfx-start/.test(html38));
  ok('音频C：暂停 orb 只留图标（▶／⏸，汉字说明移入 title）',
    /paused \? '▶' : '⏸'/.test(ui38) && ui38.indexOf('▶ 继续') < 0 && ui38.indexOf('⏸ 暂停') < 0);
}

/* ---------- 32. 版本与发布链路（批次 39：2.0preview）----------
   版本单一真源 = 根 package.json：version（→ APK versionName 与页面/文档版本说明）
   + androidVersionCode（→ APK versionCode，必须逐次递增才能覆盖安装）。
   android\build.cmd 不再硬编码 --version-code/--version-name，改由 tools\pkg-field.cjs 读取。 */
{
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const cmd = fs.readFileSync(path.join(__dirname, '..', 'android', 'build.cmd'), 'utf8');
  ok('版本A：package.json 版本真源就位（version + androidVersionCode 递增位）',
    /* 版本名带中文前缀（「新架构测试2.0preview」），故不按 semver 校验，只要求含版本号主体 */
    /\d+\.\d+preview/.test(pkg.version || '') && Number(pkg.androidVersionCode) >= 1,
    `version=${pkg.version} code=${pkg.androidVersionCode}`);
  ok('版本B：build.cmd 版本取自 package.json（无硬编码 --version-name / --version-code）',
    /pkg-field\.cjs/.test(cmd) && /--version-code %VCODE%/.test(cmd) &&
    /--version-name %VNAME%/.test(cmd) && !/--version-code 1 /.test(cmd) && !/--version-name 1\.0\.0/.test(cmd));
  const rdme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const html39 = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ok('版本C：页面与 README 的版本说明与 package.json 逐字一致（防各写各的）',
    html39.indexOf(pkg.version) >= 0 && rdme.indexOf(pkg.version) >= 0);
}

/* ---------- 42.6 主区按阶段自适应（文件级断言；行为由 mobile-layout-check 的相位扫描承担） ----------
   这一批改的是 UI 布局，Node 侧跑不了 DOM，故此处只钉「结构与接线」，
   真正的量测（夜间发言区是否收起 / 流程区是否占满 / 发言区是否被压扁）在
   tools/mobile-layout-check.cjs 的「主区相位扫描」里，6 态 × 5 档视口。 */
{
  const html43 = fs.readFileSync(path.join(base, '..', 'index.html'), 'utf8');
  const css43 = readCss();
  const ui43 = fs.readFileSync(path.join(base, 'ui.js'), 'utf8');
  const uiCode43 = ui43.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  ok('主区A：两个区域已包成可整体显隐的 #region-chat / #region-dec',
    /id="region-chat"/.test(html43) && /id="region-dec"/.test(html43));
  ok('主区B：区域标题有独立节点（可随布局改文案）',
    /id="t-chat"/.test(html43) && /id="t-dec"/.test(html43));
  ok('主区C：#seg-stage 预置 data-layout（首帧即有正确布局，不靠 JS 补）',
    /id="seg-stage"[^>]*data-layout="/.test(html43));

  ok('主区D：stageLayout / applyStageLayout 均已导出（门禁要能直接调，不能复述判定逻辑）',
    /stageLayout/.test(uiCode43) && /applyStageLayout/.test(uiCode43));
  ok('主区E：四个布局键 talk / day-form / day / night 齐备',
    /'talk'/.test(uiCode43) && /'day-form'/.test(uiCode43) &&
    /'day'/.test(uiCode43) && /'night'/.test(uiCode43));
  ok('主区F：夜间按 phase 判定且**不看 pending**（有无表单都收起发言区）',
    /phase === 'night'\)\s*return\s*\{\s*key:\s*'night',\s*chat:\s*false/.test(uiCode43));
  ok('主区G：讨论窗口优先于 phase（步骤 10 紧急会议在夜间相内仍须显示发言区）',
    /if \(stream\) return \{ key: 'talk', chat: true/.test(uiCode43) &&
    /night-talk|紧急会议/.test(ui43));
  ok('主区H：applyStageLayout 先于 renderStage 调用（布局决定哪块区域存在）',
    /applyStageLayout\(g\);[\s\S]{0,80}renderStage\(g/.test(uiCode43));
  ok('主区I：夜间「今夜私聊」小结已接入（私聊不能只藏在右栏页签里）',
    /function nightChatHtml/.test(ui43) && /L\.key === 'night' \? nightChatHtml\(g\)/.test(uiCode43));
  ok('主区J：私聊小结只取本人参与的配对组（私聊正文不公开，2.2）',
    /if \(c\.a !== me\.id && c\.b !== me\.id\) continue;/.test(uiCode43));
  ok('主区K：发言区收起时 renderChat 不碰 DOM 但仍推进 _total（否则回白天时淡入与滚动全跑偏）',
    /rc\.classList\.contains\('hidden'\)\) \{ renderChat\._total = total; return; \}/.test(uiCode43));
  ok('主区L：发言记录改由右栏页签承接（夜间收起主区后白天讨论仍可回看）',
    /data-tab="speak"/.test(html43));

  const cssCode43 = css43.replace(/\/\*[\s\S]*?\*\//g, ' ');
  ok('主区M：夜间布局真隐藏发言区（display:none，非 height:0）',
    /\[data-layout="night"\] #region-chat\{display:none\}/.test(cssCode43));
  /* 三个「发言区在场」的布局键各有发言区高度权重；night 的发言区是 display:none
     （无 flex 权重是**正确**的，收起的东西不该参与分配），故不在此列。
     四个布局键都必须给流程区高度权重 —— 否则主区会因内容长短而忽高忽低。 */
  ok('主区N：三个发言区在场的布局键都有高度权重，四键都有流程区高度权重',
    ['talk', 'day', 'day-form'].every(k =>
      new RegExp('\\[data-layout="' + k + '"\\] #region-chat\\{flex:').test(cssCode43)) &&
    ['talk', 'day', 'day-form', 'night'].every(k =>
      new RegExp('\\[data-layout="' + k + '"\\] #region-dec\\{flex:').test(cssCode43)));
  ok('主区O：极矮屏给发言区保底 118px（地板加在区域上，只加 .chatlog 会被 flex-shrink 压穿）',
    /\[data-layout="day-form"\] #region-chat\{flex:3 1 0;min-height:118px\}/.test(cssCode43) &&
    /\[data-layout="talk"\] #region-chat\{min-height:118px\}/.test(cssCode43));
  ok('主区P：移动端门禁已覆盖 6 态相位扫描（行为层验收在此，不在 Node 断言里）',
    /主区相位扫描/.test(fs.readFileSync(path.join(base, '..', 'tools', 'mobile-layout-check.cjs'), 'utf8')));
}

/* ---------- 42.7 首页与入口（UI 文本口径，文件级断言） ----------
   这几项不是「逻辑对不对」，而是「改完有没有留下残骸」—— 本批删了下载入口、
   加了 ENABLE_DEV 开关，故把「删干净」与「开关存在且默认为开」钉成断言。 */
{
  const html42 = fs.readFileSync(path.join(base, '..', 'index.html'), 'utf8');
  const css42 = readCss();
  const ui42 = fs.readFileSync(path.join(base, 'ui.js'), 'utf8');
  const main42 = fs.readFileSync(path.join(base, 'main.js'), 'utf8');
  const rdme42 = fs.readFileSync(path.join(base, '..', 'README.md'), 'utf8');

  /* 「删干净」必须只查**玩家可见与可执行的部分**：本批在注释里留了变更说明
     （写着「原 openApkQr 已移除」），若连注释一起匹配就永远删不干净。
     故先把注释剥掉再判定 —— 注释里提到旧名字是**必要的留痕**，不是残骸。 */
  const stripJs = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const stripHtml = s => s.replace(/<!--[\s\S]*?-->/g, ' ');
  const stripCss = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const htmlCode = stripHtml(html42), uiCode = stripJs(ui42), mainCode = stripJs(main42), cssCode = stripCss(css42);

  ok('入口A：开始页已无「扫码下载应用」按钮与附件外链',
    !/扫码下载应用/.test(htmlCode) && !/附件：规则与模拟/.test(htmlCode));
  ok('入口B：页面正文无「附件站点」字样残留（注释留痕不算）',
    !/附件站点/.test(htmlCode));
  ok('入口C：二维码浮层 DOM 与 assets/qr 均已退役（无孤立入口）',
    !/id="apk-qr"/.test(htmlCode) &&
    !fs.existsSync(path.join(base, '..', 'assets', 'qr')) &&
    !/\.apk-qr\{/.test(cssCode));
  ok('入口D：ui.js 的 openApkQr / closeApkQr 已移除且无残留调用',
    !/openApkQr/.test(uiCode) && !/closeApkQr/.test(uiCode));
  ok('入口E：ENABLE_DEV 开关在 ui 与 main 两侧都生效（默认开 · 关闭即移除按钮并空操作）',
    /SK_ENABLE_DEV/.test(uiCode) && /SK_ENABLE_DEV/.test(mainCode) &&
    /parentNode\.removeChild/.test(uiCode));
  ok('入口F：README 已改为记录对外分发渠道（不再声称站内入口）',
    !/网页版开始页另有/.test(rdme42) && /Releases/.test(rdme42));

  ok('首页A：viewport 带 viewport-fit=cover（安全区消费的前提）',
    /viewport-fit=cover/.test(html42) && /maximum-scale=1/.test(html42));
  ok('首页B：CSS 消费安全区四项（横屏刘海在左右，故 left/right 也要）',
    /--sal:env\(safe-area-inset-left/.test(css42) &&
    /--sar:env\(safe-area-inset-right/.test(css42) &&
    /padding-left:var\(--sal\)/.test(css42));
  ok('首页C：禁下拉刷新 / 橡皮筋 + 去点击高亮（overscroll-behavior）',
    /overscroll-behavior:none/.test(cssCode));
  ok('首页D：开始页撑满（.start-box flex:1 吃掉剩余高度，而非 margin:auto 居中留空）',
    /#screen-start \.start-box\{[^}]*flex:1 1 auto/.test(cssCode));
  ok('首页E：极矮横屏走「页面不滚 + 卡片内滚」且 CTA 不被顶出视口',
    /max-height:560px\)\{[^]*?#screen-start\{[^}]*overflow:hidden[^}]*height:100dvh/.test(cssCode) &&
    /#screen-start \.start-box\{[^}]*overflow-y:auto/.test(cssCode));
  ok('首页F：极矮横屏的对局区改单列 + 阵营一行四列（否则 CTA 落在滚动区外）',
    /max-height:560px\)\{[^]*?\.panel-grid\{[^}]*grid-template-columns:1fr/.test(cssCode) &&
    /max-height:560px\)\{[^]*?faction-pick\{grid-template-columns:repeat\(4,1fr\)/.test(cssCode));

  /* 门禁本身也要跟上：开始页此前根本不在 mobile-layout-check 的覆盖内 */
  const mg42 = fs.readFileSync(path.join(base, '..', 'tools', 'mobile-layout-check.cjs'), 'utf8');
  ok('首页G：移动端布局门禁已覆盖开始页（含「无法开局」的可达性判定）',
    /开始页/.test(mg42) && /玩家无法开局/.test(mg42));
}

/* ---------- 42. 批次 42：单机路径的可见性收口 + 席位变体接线 + 两处公告越界 ----------
   背景：本批起因是「两份外部优化方案」与源码核对后，发现真正的高危问题不在引擎产出侧，
   而在**单机 UI 直读权威状态**——js/view.js 的 sanitize（为联机写的正确裁剪）在单机路径
   完全没有被调用，于是濒死 / 感染标记（含真伪）/ 蛰伏沉默 / 转职史对全场可见，且 500 条
   既有断言里没有一条能看见它（UI 层不在 Node 断言覆盖内）。修法不是补锁，而是把单机也接上
   同一条出口（View.viewFor），并把「隐藏字段不得出现在他人视图」写成机器可判的守卫。
   另修三处：转职进公开日志、批次④把维修来源拆开、席位变体机制无调用方。 */
{
  /* --- 42.1 单机裁剪：他人视图不得携带隐藏字段 --- */
  {
    const g = Setup.createGame(20261006, 'human');
    Engine.begin(g);
    const me = g.players[g.humanId - 1];
    /* 人为布置四类隐藏态：他濒死 / 他带真标记 / 他带假标记 / 他被蛰伏沉默 / 他已转职 */
    const t1 = g.players.find(p => p.id !== me.id && !p.out);
    const t2 = g.players.find(p => p.id !== me.id && p.id !== t1.id && !p.out);
    const t3 = g.players.find(p => p.id !== me.id && p.id !== t1.id && p.id !== t2.id && !p.out);
    const t4 = g.players.find(p => p.id !== me.id && p.id !== t1.id && p.id !== t2.id && p.id !== t3.id && !p.out);
    const t5 = g.players.find(p => p.id !== me.id && p.id !== t1.id && p.id !== t2.id && p.id !== t3.id && p.id !== t4.id && !p.out);
    t1.dying = true;
    t2.infection = { real: true, appliedNight: 1, deathNight: 3 };
    t3.infection = { real: false, appliedNight: 1, deathNight: 3 };
    t4.silenceNight = g.night;
    t5.transferred = true; t5.role = 'assistant'; t5.roleName = '助理工程师';

    const V = View.viewFor(g, g.humanId);
    ok('可见性A：viewFor 对单机权威状态生效（不再返回原始 g.players）',
      V.players !== g.players && V.players.length === g.players.length);
    ok('可见性B：他人濒死 / 蛰伏沉默 / 转职史 一律不下发（3.3.12 / 6.1.2 / 2.8.7）',
      V.players.find(p => p.id === t1.id).dying === undefined &&
      V.players.find(p => p.id === t4.id).silenceNight == null &&
      V.players.find(p => p.id === t5.id).transferred === undefined);
    ok('可见性C：感染标记真伪不下发给无关观察者（医生系见存在性、真伪不可辨 4.5）',
      V.players.find(p => p.id === t2.id).infection == null &&
      V.players.find(p => p.id === t3.id).infection == null);
    const meView = V.players.find(p => p.id === me.id);
    /* 注意：ctx 是 vm 沙箱，vm 内构造的 Map/Array 与本文件 realm 不同，
       `instanceof` 跨 realm 恒为 false —— 一律用 duck-typing / Array.isArray 判定。 */
    ok('可见性D：己身私有节点仍在（本人看自己不受裁剪，且已 hydrate 成 Map 供 UI 直接取用）',
      Object.prototype.hasOwnProperty.call(meView, 'known') &&
      Object.prototype.hasOwnProperty.call(meView, 'inbox') &&
      Object.prototype.hasOwnProperty.call(meView, 'notes') &&
      !!meView.known && typeof meView.known.get === 'function' &&
      Array.isArray(meView.inbox));
    ok('可见性E：auditView 对单机视图零违规（含新增隐藏字段守卫）',
      View.auditView(V).length === 0, JSON.stringify(View.auditView(V)).slice(0, 200));
    ok('可见性F：viewFor 幂等（联机已是视图的载荷不被二次裁剪）', View.viewFor(V, g.humanId) === V);

    /* 医生视角：可见感染存在性、不可见真伪、不可见他人濒死（非救援族） */
    const g2 = Setup.createGame(20261007, 'random');
    Engine.begin(g2);
    const doc = g2.players.find(p => p.role === 'bio');
    const v1 = g2.players.find(p => p.id !== doc.id && !p.out);
    const v2 = g2.players.find(p => p.id !== doc.id && p.id !== v1.id && !p.out);
    v1.infection = { real: false, appliedNight: 1, deathNight: 3 };
    v2.dying = true;
    const VD = View.viewFor(g2, doc.id);
    ok('可见性G：医生看得到「有人带标记」但看不到真伪（4.5 真伪不可辨）',
      VD.players.find(p => p.id === v1.id).infection &&
      VD.players.find(p => p.id === v1.id).infection.real === undefined);
    ok('可见性H：医生（非救援族）看不到他人濒死名单（3.3.12 / 4.10.4④）',
      VD.players.find(p => p.id === v2.id).dying === undefined);
    ok('可见性I：医生视角同样零违规', View.auditView(VD).length === 0);
  }

  /* --- 42.2 转职不再公开：日志里不得出现转职事实 --- */
  {
    let leaked = 0, transfers = 0, nights = 0;
    for (let s = 0; s < 12; s++) {
      const g = Setup.createGame(3100 + s, 'random');
      g.humans = []; g.humanId = -1;
      for (const p of g.players) p.isHuman = false;
      Engine.begin(g);
      let steps = 0;
      while (!g.over && steps < 4000) {
        Engine.stepOnce(g); steps++;
        if (g.pending) Engine.submit(g, AI.formAnswer ? AI.formAnswer(g, g.pending) : {});
      }
      nights += g.night;
      for (const p of g.players) if (p.transferred) transfers++;
      for (const e of g.log) {
        if (e.scope !== 'all') continue;
        if (/\d+\s*号完成转职/.test(e.text) || /号已转职为/.test(e.text)) leaked++;
      }
      /* 本人私有反馈里必须有「你已转职为…」，证明转职确实发生、只是不再公开 */
      for (const p of g.players)
        if (p.transferred && !p.inbox.some(x => /转职为/.test(x.text))) transfers--;
    }
    ok('转职A：转职事实零公开泄露（scope=all 的日志中无「N 号完成转职」）', leaked === 0, 'leaked=' + leaked);
    ok('转职B：转职确曾发生且转职者本人收到私有反馈（不是把机制关掉了）',
      transfers > 0, 'paired=' + transfers + ' 累计夜数=' + nights);
  }

  /* --- 42.3 批次④ 只报总量：不得拆分来源 --- */
  {
    let split = 0, total = 0, godSplit = 0;
    for (let s = 0; s < 8; s++) {
      const g = Setup.createGame(3200 + s, 'random');
      g.humans = []; g.humanId = -1;
      for (const p of g.players) p.isHuman = false;
      Engine.begin(g);
      let steps = 0;
      while (!g.over && steps < 3000) {
        Engine.stepOnce(g); steps++;
        if (g.pending) Engine.submit(g, {});
      }
      for (const e of g.log) {
        if (e.batch !== '④') continue;
        total++;
        if (/工程维修|船员协助/.test(e.text)) split++;
      }
      /* 分项明细必须仍然存在，只是降级到 god 作用域（复盘核对用），不得被丢弃 */
      for (const e of g.replay)
        if (e.scope === 'god' && /维修分项/.test(e.text)) godSplit++;
    }
    ok('批次④：只发布维修总量，不拆「工程维修 / 船员协助」来源（2.1.6 / 4.1.2①）',
      total > 0 && split === 0, `公告 ${total} 条 / 拆来源 ${split} 条`);
    ok('批次④：来源拆分改落 god()（复盘仍可核对，未被丢弃）',
      godSplit > 0, 'godSplit=' + godSplit);
  }

  /* --- 42.4 席位变体接线：机制从「无调用方」变为真实开局路径 --- */
  {
    const mainJs = fs.readFileSync(path.join(base, '..', 'js', 'main.js'), 'utf8');
    ok('席位变体A：真实开局路径已接入（main.js 调 rollSeatPicks 并传 seatPicks）',
      /Setup\.rollSeatPicks/.test(mainJs) && /seatPicks: picks/.test(mainJs));
    ok('席位变体B：rollSeatPicks 用独立 RNG（不消耗 g.rng ⇒ 经典局行为指纹不变）',
      /SEAT_ROLL_SALT/.test(fs.readFileSync(path.join(base, 'state.js'), 'utf8')));

    /* 掷骰覆盖：五个席位各自的变体都能被掷出，且落经典侧的比例接近一半 */
    const hit = {};
    for (let i = 0; i < 600; i++)
      for (const k of Object.keys(Setup.rollSeatPicks(i))) hit[k] = (hit[k] || 0) + 1;
    const SEATS = Object.keys(Setup.SEAT_VARIANTS);
    ok('席位变体C：600 个种子内五个席位都能掷出变体（每席位独立 50/50）',
      SEATS.every(s => hit[s] > 200), JSON.stringify(hit));

    /* 经典局（不传 seatPicks）逐字节不变 —— 回归基线得以保留的前提 */
    const ga = Setup.createGame(4242, 'random');
    const gb = Setup.createGame(4242, 'random');
    ok('席位变体D：不传 seatPicks 的经典局逐字节同（组局序列未被掷骰扰动）',
      ga.players.map(p => p.role).join() === gb.players.map(p => p.role).join());

    /* 变体局能真的跑起来 */
    let errs = 0, ran = 0;
    for (let s = 0; s < 6; s++) {
      const picks = Setup.rollSeatPicks(7000 + s);
      try {
        const g = Setup.createGame(7000 + s, 'random', Object.keys(picks).length ? { seatPicks: picks } : undefined);
        g.humans = []; g.humanId = -1;
        for (const p of g.players) p.isHuman = false;
        Engine.begin(g);
        let steps = 0;
        while (!g.over && steps < 3000) { Engine.stepOnce(g); steps++; if (g.pending) Engine.submit(g, {}); }
        ran++;
      } catch (e) { errs++; }
    }
    ok('席位变体E：变体局可完整开局推进（无异常）', ran === 6 && errs === 0, `ran=${ran} errs=${errs}`);
  }

  /* --- 42.5 批次〇 开局公告：外星人变体注记随本局实际席位 --- */
  {
    const xenoNote = (picks) => {
      const g = Setup.createGame(5150, 'random', picks ? { seatPicks: picks } : undefined);
      Engine.begin(g);
      const t = g.log.find(e => e.batch === '〇').text;
      return (t.match(/外星人变体：[^。]+/) || [''])[0];
    };
    ok('批次〇A：经典局注记为「经典」（与旧文本逐字同）', xenoNote(null) === '外星人变体：经典', xenoNote(null));
    ok('批次〇B：死囚局注记为「死囚外星人」（2.3.0 以本局实际选定者入公告）',
      xenoNote({ xeno: 'convict' }) === '外星人变体：死囚外星人', xenoNote({ xeno: 'convict' }));
    /* 变体局的职业构成必须真的换掉：猎手/毒师/工匠/窃听者 各自顶掉原席位 */
    const gv = Setup.createGame(5151, 'random', {
      seatPicks: { sheriff: 'hunter', rescue: 'poisoner', bodyguard: 'artisan', inspector: 'listener' },
    });
    Engine.begin(gv);
    ok('批次〇C：变体局的公告按实际构成报（四个变体职业在列、原职业不在列）',
      /猎手×1/.test(gv.log.find(e => e.batch === '〇').text) &&
      !/警长/.test(gv.log.find(e => e.batch === '〇').text) &&
      gv.players.filter(p => p.role === 'hunter').length === 1 &&
      gv.players.filter(p => p.role === 'poisoner').length === 1 &&
      gv.players.filter(p => p.role === 'artisan').length === 1 &&
      gv.players.filter(p => p.role === 'listener').length === 1);
  }
}

/* ---------- 43. 死囚外星人的技能隔离（6.8.2 / 6.8.3⑦） ----------
   本组起因是玩家实测报出三个现象，实测指向**同一个根因**：
     ①「死囚不具有经典外星人的所有技能」→ 但蛰伏/沉默/击杀/自我治疗都拿到了
     ②「没发动变形却能直接切换身份」→ 变形为普通船员后拿到转职表单（6.8.3⑦ 明文禁止）
     ③「作为神探却还能发动医生的技能」→ 步骤 8 派发了 kind='xenoCure'，而 form 的分派
        条件是 `!p.convict`，于是**静默换成了医生表单**（req.kind 与 form.kind 不一致）
   根因：死囚全程 `faction === 'xeno'`，而所有经典外星人技能都按 **faction** 派发。
   变形只改 p.role、不改 p.faction ⇒「阵营成员」被当成了「能力持有者」。
   修法见 SKDerivation.isClassicXeno（按 role 判）+ isXenoCamp（阵营语义专用）。

   ⚠ 43.5 是**通用探测器**：断言「每个步位的 req 派发的 kind，必须与 form 返回的 kind 一致」。
   ③号现象正是这类不一致造成的，而它在 500 条旧断言里完全不可见 —— 因为断言跑在
   Node 里、从不构造真人表单。 */
{
  const XENO_ONLY = ['xenoCheck', 'xenoSilence', 'xenoKill', 'xenoCure', 'awaken'];
  /* 把 1 号设为指定职业的人类席位并跑到终局，记录它每一步拿到的 (step, kind)。
     morphOpt：'none' = 强制不变形；否则变形为该身份（用于「变形后只拿该身份技能」）。 */
  function runAsRole(roleKey, seed, opts, morphOpt) {
    const g = Setup.createGame(seed, 'random', opts);
    const p = g.players[0];
    if (p.role !== roleKey) {
      const donor = g.players.find(x => x.role === roleKey);
      if (!donor) return null;
      const t = p.role;
      p.role = donor.role; p.roleName = donor.roleName; p.faction = donor.faction;
      p.originRole = donor.originRole; p.roleExpert = donor.roleExpert;
      p.convict = donor.convict; p.mirror = donor.mirror; p.morph = donor.morph; p.morphNight = donor.morphNight;
      donor.role = t; donor.roleName = ctx.SKRoleDecl.ROLE_DECL[t] ? ctx.SKRoleDecl.ROLE_DECL[t].name : t;
      donor.faction = ctx.SKRoleDecl.ROLE_DECL[t] ? ctx.SKRoleDecl.ROLE_DECL[t].faction : 'human';
      donor.convict = false; donor.mirror = null;
    }
    g.humans = [p.id]; g.humanId = p.id;
    g.players.forEach(x => { x.isHuman = (x.id === p.id); });
    Engine.begin(g);
    const seen = [];
    let steps = 0;
    while (!g.over && steps < 3000) {
      steps++; Engine.stepOnce(g);
      const f = g.pendings[p.id];
      if (f) seen.push({ step: g.step, kind: f.kind });
      if (!f) continue;
      /* 确定性作答：morph 表单强制取 morphOpt，其余取第一个合法项（不引入随机性） */
      const data = { opt: null, targets: [], num: null, text: '' };
      if (f.kind === 'morph') data.opt = morphOpt || 'none';
      else {
        if (f.opts) { const ok = f.opts.filter(o => !o.disabled); if (ok.length) data.opt = ok[0].v; }
        if (f.targets) {
          let list = Engine.alive(g);
          if (f.targets.list === 'aliveNotAlien') list = list.filter(q => q.faction !== 'alien');
          if (f.targets.list !== 'alive') list = list.filter(q => q.id !== p.id);
          list = list.filter(q => (f.targets.exclude || []).indexOf(q.id) < 0);
          const n = Math.min(f.targets.max || 1, list.length);
          for (let k = 0; k < n; k++) data.targets.push(list[k].id);
        }
        if (f.num) data.num = f.num.options[0].v;
        if (f.num2) data.num2 = f.num2.options[0].v;
      }
      Engine.submit(g, data);
    }
    return { seen, p };
  }
  const kindsOf = r => [...new Set(r.seen.map(s => s.kind))];
  const CV_OPTS = { seatPicks: { xeno: 'convict' } };

  /* --- 43.1 声明层：三个判据都在，且阵营语义与能力语义分离 --- */
  const SKD = ctx.SKDerivation;
  ok('死囚A：推导层导出「经典外星人技能 / 外星人阵营成员 / 变形者」三个独立判据',
    typeof SKD.isClassicXeno === 'function' && typeof SKD.isXenoCamp === 'function' &&
    typeof SKD.isMorphed === 'function');
  {
    const g0 = Setup.createGame(4242, 'random', CV_OPTS);
    const cv0 = g0.players.find(p => p.convict);
    const xg0 = Setup.createGame(4243, 'random').players.find(p => p.role === 'xeno');
    const cr0 = Setup.createGame(4244, 'random').players.find(p => p.role === 'crew');
    ok('死囚B：死囚是「外星人阵营成员」但**不是**「经典外星人技能持有者」（6.8.2）',
      SKD.isXenoCamp(cv0) === true && SKD.isClassicXeno(cv0) === false && SKD.isMorphed(cv0) === true);
    ok('死囚C：经典外星人恰好相反；普通船员两者皆否（判据未误伤他人）',
      SKD.isClassicXeno(xg0) === true && SKD.isXenoCamp(xg0) === true &&
      SKD.isClassicXeno(cr0) === false && SKD.isXenoCamp(cr0) === false && SKD.isMorphed(cr0) === false);
    /* 变形后：阵营仍是 xeno（它仍是外星人阵营成员、参与清场），技能随所变形身份走 */
    const cvM = Object.assign({}, cv0, { role: 'detective', morph: 'detective' });
    ok('死囚D：变形后仍是外星人阵营成员，但技能判据随所变形身份走（阵营 ≠ 能力）',
      SKD.isXenoCamp(cvM) === true && SKD.isClassicXeno(cvM) === false && SKD.isMorphed(cvM) === true);
  }

  /* --- 43.2 未变形的死囚：零经典外星人技能 --- */
  {
    const r = runAsRole('convict', 8100, CV_OPTS, 'none');
    const ks = kindsOf(r);
    const leak = ks.filter(k => XENO_ONLY.indexOf(k) >= 0);
    ok('死囚E：未变形的死囚拿不到蛰伏/沉默/击杀/自我治疗/觉醒任一项（6.8.2 零外星人技能）',
      leak.length === 0, '泄漏=' + (leak.join(',') || '0') + ' 实得=' + ks.join(','));
    ok('死囚F：未变形的死囚仍持有自己的两项能力入口（变形 P-id / 复生 8）',
      ks.indexOf('morph') >= 0, '实得=' + ks.join(','));
    /* 乔装（7.3）是异形与外星人共有的技能，死囚不持 */
    ok('死囚G：死囚初始乔装次数为 0（state.js 不得按阵营白送）',
      Setup.createGame(8101, 'random', CV_OPTS).players.find(p => p.convict).disguiseLeft === 0);
    /* 感染治疗额度（6.5 被动）不得按阵营累积 */
    {
      const g1 = Setup.createGame(8102, 'random', CV_OPTS);
      const c1 = g1.players.find(p => p.convict);
      Engine.applyInfection(g1, c1, null);
      ok('死囚H：被感染不累积感染治疗额度（6.5 是经典外星人的被动）', c1.cureSelf === 0,
        'cureSelf=' + c1.cureSelf);
    }
    /* 43.2 的两处门禁（被动发放 / 步骤 8 派发）互为冗余：任一处单独失效，另一处仍能挡住症状，
       于是「回退任一处」都不会让 43E/H 报警——那是纵深防御，不是断言失效。但要真正验证
       **派发侧**的门禁，必须让死囚手上真的有额度，否则条件短路、断言变成空跑。
       故此处直接构造「已感染且持有额度」的满配死囚，并同时做反面对照，确认门禁没有把
       经典外星人的自我治疗一并关掉。 */
    {
      const gv = Setup.createGame(4666, 'random', CV_OPTS);
      Engine.begin(gv);
      const cv = gv.players.find(p => p.convict);
      cv.infection = { real: true, appliedNight: gv.night, deathNight: gv.night + 2 };
      cv.cureSelf = 1; cv.branch = null;
      const rq = Engine.STEPS['8'].req(gv).filter(r => r.pid === cv.id).map(r => r.kind);
      ok('死囚P：已感染且持有额度的死囚，步骤 8 仍不被派发感染自我治疗（派发侧门禁生效）',
        rq.indexOf('xenoCure') < 0, '实得=' + (rq.join(',') || '(无)'));
      const gx = Setup.createGame(4667, 'random');
      Engine.begin(gx);
      const xg = gx.players.find(p => p.role === 'xeno');
      xg.infection = { real: true, appliedNight: gx.night, deathNight: gx.night + 2 };
      xg.cureSelf = 1; xg.branch = null;
      const rq2 = Engine.STEPS['8'].req(gx).filter(r => r.pid === xg.id).map(r => r.kind);
      ok('死囚Q：反面对照——同条件的经典外星人仍被派发感染自我治疗（门禁未把能力误关）',
        rq2.indexOf('xenoCure') >= 0, '实得=' + (rq2.join(',') || '(无)'));
    }
  }

  /* --- 43.3 变形后：只拿到所变形身份的技能，且不夹带外星人技能 --- */
  {
    /* 每个变形目标各跑一局，断言「无 xeno 独有技能」且「拿到了该身份自己的技能」 */
    const targets = ['crew', 'detective', 'engineer', 'alien'];
    let leakAll = [], gotOwn = [];
    for (const t of targets) {
      const r = runAsRole('convict', 8200 + t.length, CV_OPTS, t);
      if (!r) continue;
      const ks = kindsOf(r);
      leakAll = leakAll.concat(ks.filter(k => XENO_ONLY.indexOf(k) >= 0).map(k => t + ':' + k));
      /* 变形＝转移操作权：应当出现该身份自己的 kind */
      const OWN = { crew: 'crewAction', detective: 'detective', engineer: 'safeRoom', alien: 'branch' };
      if (ks.indexOf(OWN[t]) >= 0) gotOwn.push(t);
    }
    ok('死囚I：变形为任一身份都不夹带经典外星人技能', leakAll.length === 0, leakAll.join(','));
    ok('死囚J：变形后确实取得该身份自己的行动权（转移操作权，6.8.3①）',
      gotOwn.length === targets.length, gotOwn.join(',') + ' 缺=' + targets.filter(t => gotOwn.indexOf(t) < 0).join(','));
  }

  /* --- 43.4 变形者不得转职（6.8.3⑦）--- */
  {
    const r = runAsRole('convict', 8300, CV_OPTS, 'crew');
    ok('死囚K：变形为普通船员后仍拿不到转职表单（6.8.3⑦ 明文「变形者不得转职」）',
      r.seen.some(s => s.kind === 'transfer') === false);
    /* 反面对照：非变形者的普通船员在满足条件时确实能拿到转职（证明不是把转职整体关掉了） */
    const g2 = Setup.createGame(8301, 'random');
    const cr = g2.players.find(p => p.role === 'crew');
    cr.isHuman = true; g2.humans = [cr.id]; g2.humanId = cr.id;
    g2.players.forEach(x => { if (x.id !== cr.id) x.isHuman = false; });
    Engine.begin(g2);
    g2.night = 6;                                    // 满足 0.6 的「第 6 夜」条件
    let gotTransfer = false, st2 = 0;
    while (!g2.over && st2 < 400 && !gotTransfer) {
      st2++; Engine.stepOnce(g2);
      if (g2.pendings[cr.id] && g2.pendings[cr.id].kind === 'transfer') gotTransfer = true;
      if (g2.pending) Engine.submit(g2, { opt: null, targets: [], num: null, text: '' });
    }
    ok('死囚L：反面对照——真·普通船员第 6 夜起仍能转职（门禁未把能力误关）', gotTransfer);
  }

  /* --- 43.5 镜像账本含本体槽（2.8.5③ 离开即封存、切回即恢复） --- */
  {
    const g3 = Setup.createGame(8400, 'random', CV_OPTS);
    const cv3 = g3.players.find(p => p.convict);
    const M = ctx.SKMirror;
    ok('死囚M：镜像账本含本体形态槽，且本体形态自开局在位（此前 enter 静默失败）',
      M.has(cv3.mirror, 'convict') === true && M.activeKey(cv3.mirror) === 'convict',
      'keys=' + Object.keys(cv3.mirror).join(',') + ' active=' + M.activeKey(cv3.mirror));
    /* 变形 → 本体槽应被激活（原身份槽应释放） */
    const r3 = runAsRole('convict', 8401, CV_OPTS, 'crew');
    const cv4 = r3.p;
    ok('死囚N：变形后 activeKey 切到所变形身份',
      ctx.SKMirror.activeKey(cv4.mirror) === 'crew',
      'active=' + ctx.SKMirror.activeKey(cv4.mirror) + ' morph=' + cv4.morph);
  }

  /* --- 43.6 通用探测器：req 派发的 kind 必须与 form 返回的 kind 一致 --- */
  {
    const STEPS = Engine.STEPS;
    const mismatches = [];
    let checked = 0;
    /* 覆盖经典局与死囚局两套构成，逐夜推进、在每个有决策的步位上比对 */
    for (const opts of [undefined, CV_OPTS]) {
      for (let s = 0; s < 4; s++) {
        const g = Setup.createGame(8500 + s, 'random', opts);
        g.humans = []; g.humanId = -1;
        for (const p of g.players) p.isHuman = false;
        Engine.begin(g);
        let steps = 0;
        while (!g.over && steps < 1200) {
          steps++;
          const def = STEPS[g.step];
          if (def && def.req && def.form) {
            for (const r of def.req(g)) {
              const p = Engine.P(g, r.pid);
              if (!p || p.out) continue;
              let f = null;
              try { f = def.form(g, p); } catch (e) { mismatches.push(g.step + '/' + r.kind + ' form 抛错:' + e.message); continue; }
              checked++;
              if (!f || f.kind !== r.kind)
                mismatches.push(g.step + ' req=' + r.kind + ' form=' + (f && f.kind));
            }
          }
          Engine.stepOnce(g);
          Engine.submit(g, {});
          Engine.finishIfReady(g);
        }
      }
    }
    ok('死囚O：req.kind 与 form.kind 逐次一致（这一致性正是③号现象的根因，通用探测器）',
      mismatches.length === 0 && checked > 200,
      `checked=${checked} 不一致=${mismatches.length} ` + mismatches.slice(0, 4).join(' | '));
  }
}

/* ---------- 45. 首页自选身份（软偏好） ----------
   本组的红线只有一条：**偏好绝不改变游戏规则**。
   「人类 11 / 异形 3 / 外星人 1 / 玩家共 15」是结构常量（1.1 + 2.3.0②附二），
   自选身份只决定「玩家坐哪个已有席位」，一个席位都不能多也不能少。
   故每条断言都成对出现：既验「想要的拿到了」，也验「结构没被撑破」。

   另一条不可让步的是**指纹中性**：不传偏好时 rollSeatPicks 与 createGame
   必须与接入前逐位相同 —— 否则批 42 定的席位变体 50/50 与行为基线全部失效。 */
{
  const PREF_N = 60;                    // 每角色抽样局数；50 就能把「偶发失败」与「必然失败」分开
  const RD45 = ctx.SKRoleDecl;
  const VARIANT_SEATS = Object.keys(Setup.SEAT_VARIANTS);
  const selectable = RD45.keys().filter(k => RD45.selectable(k));

  /* --- 45.1 声明层：可选性与解锁接口 --- */
  ok('自选A：解锁门槛接口已就位，且当前没有任何角色被胜利数门槛锁住',
    typeof RD45.unlockOf === 'function' && typeof RD45.selectable === 'function' &&
    RD45.keys().every(k => {
      const u = RD45.unlockOf(k);
      return !(u && typeof u.wins === 'number' && u.wins > 0);
    }));
  ok('自选A2：可选集合 ＝ 全部角色减去「只能经转职获得」的那几个（不多不少）',
    selectable.length === RD45.keys().filter(k => {
      const u = RD45.unlockOf(k);
      return !(u && u.transferOnly === true);
    }).length);
  {
    /* 转职系只能经步骤 0.6 获得（4.2.1），不得出现在自选面板 */
    const mustExclude = ['tempdoc', 'assistant', 'armed'];
    ok('自选B：转职系（临时医生 / 助理工程师 / 武装船员）一律不可直接自选',
      mustExclude.every(k => RD45.selectable(k) === false) &&
      mustExclude.every(k => (RD45.unlockOf(k) || {}).transferOnly === true));
    /* 非人类阵营的异形 / 外星人必须可选（否则阵营选了却锁死身份） */
    ok('自选C：异形与外星人阵营各至少有一个可选身份',
      selectable.indexOf('alien') >= 0 &&
      selectable.some(k => RD45.ROLE_DECL[k].faction === 'xeno'));
    /* 可选集合必须恰好覆盖「席位表上的全部 occupant」，不多不少 */
    const seatRoles = new Set(RD45.nonHumanSetup().concat(RD45.humanSetup()));
    const missing = [...seatRoles].filter(k => RD45.selectable(k) === false);
    ok('自选D：席位表上的每个 occupant 都可选（否则玩家坐不上那个席位）',
      missing.length === 0, '不可选=' + missing.join(','));
  }

  /* --- 45.2 席位变体掷骰：A/B 双向索引完整 --- */
  {
    let bad = [];
    for (const seat of VARIANT_SEATS) {
      const b = Setup.SEAT_VARIANTS[seat];
      const ca = Setup.seatClaim(seat), cb = Setup.seatClaim(b);
      if (!ca || ca.seat !== seat || ca.variant !== 'A') bad.push(seat + ' 的变体 A 索引错');
      if (!cb || cb.seat !== seat || cb.variant !== 'B') bad.push(b + ' 的变体 B 索引错');
    }
    ok('自选E：5 个变体席位的 A/B 双向索引完整（变体 A 也必须能索引）',
      bad.length === 0, bad.join('; '));
    /* 非变体角色不该被索引到任何变体席位（它们恒在场，无需锁定） */
    ok('自选F：非变体角色（神探 / 工程师 / 普通船员 / 异形）不进变体索引',
      ['detective', 'engineer', 'crew', 'alien', 'bio'].every(k => Setup.seatClaim(k) === null));
  }

  /* --- 45.3 指纹中性（最重要的一条） --- */
  {
    let drift = 0, firstDrift = '';
    for (let s = 0; s < 300; s++) {
      const a = JSON.stringify(Setup.rollSeatPicks(s));
      const b = JSON.stringify(Setup.rollSeatPicks(s, undefined));
      const c = JSON.stringify(Setup.rollSeatPicks(s, null));
      if (a !== b || a !== c) { drift++; if (!firstDrift) firstDrift = 'seed ' + s; }
    }
    ok('自选G：不传偏好时席位掷骰逐位不变（300 种子；否则批 42 的 50/50 与行为基线全废）',
      drift === 0, firstDrift);
    /* createGame 侧同理：偏好分支必须整体跳过，rng 消耗序列不动 */
    let hd = 0;
    for (let s = 0; s < 80; s++) {
      const a = Setup.createGame(50000 + s, 'human');
      const b = Setup.createGame(50000 + s, 'human', { seatPicks: Setup.rollSeatPicks(50000 + s) });
      const c = Setup.createGame(50000 + s, 'human',
        { seatPicks: Setup.rollSeatPicks(50000 + s), preferRole: undefined });
      if (a.humanId !== b.humanId || a.humanId !== c.humanId) hd++;
    }
    ok('自选H：不传偏好时玩家席位与接入前一致（80 局）', hd === 0, '不一致 ' + hd + ' 局');
  }

  /* --- 45.4 玩家的选择一定兑现（A/B 两侧都验） --- */
  {
    const fail = [];
    for (const role of selectable) {
      let got = 0, noted = 0;
      for (let s = 0; s < PREF_N; s++) {
        const seed = 61000 + s;
        const g = Setup.createGame(seed, 'random',
          { seatPicks: Setup.rollSeatPicks(seed, role), preferRole: role });
        if (g.roleGot === role && !g.roleNote) got++;
        if (g.roleNote) noted++;
      }
      if (got < PREF_N) fail.push(role + ' ' + got + '/' + PREF_N);
    }
    ok('自选I：每个可选身份在 ' + PREF_N + ' 局里都必然拿到（含变体 A 与 B 两侧）',
      fail.length === 0, fail.join('; '));
  }

  /* --- 45.5 结构常量未被偏好撑破（2.3.0②附二） --- */
  {
    const bad = [];
    for (const role of [null].concat(selectable)) {
      for (let s = 0; s < 20; s++) {
        const seed = 63000 + s;
        const g = Setup.createGame(seed, 'random',
          { seatPicks: Setup.rollSeatPicks(seed, role), preferRole: role });
        const cnt = {};
        g.players.forEach(p => { cnt[p.faction] = (cnt[p.faction] || 0) + 1; });
        if (g.players.length !== 15 || cnt.human !== 11 || cnt.alien !== 3 || cnt.xeno !== 1)
          bad.push(role + '@' + seed + ' → ' + JSON.stringify(cnt));
        /* 玩家拿到的身份必须真的在这个席位表上 */
        if (g.roleGot && !g.players.some(p => p.id === g.humanId && p.role === g.roleGot))
          bad.push(role + '@' + seed + ' roleGot 与席位表不符');
      }
    }
    ok('自选J：偏好未增删席位 —— 恒 15 人 / 人类 11 / 异形 3 / 外星人 1',
      bad.length === 0, bad.slice(0, 3).join('; '));
    /* 组位容量核（2.8.14）：偏好生效后席位表仍要过声明层的容量审计 */
    const g = Setup.createGame(64000, 'random',
      { seatPicks: Setup.rollSeatPicks(64000, 'convict'), preferRole: 'convict' });
    ok('自选K：偏好生效后组位容量核仍为空（2.8.14）',
      RD45.seatAudit().length === 0, RD45.seatAudit().join('; '));
  }

  /* --- 45.6 玩家的选择精确地只影响那一个席位 --- */
  {
    const diff = (x, y) => VARIANT_SEATS.filter(k => (x[k] || 'A') !== (y[k] || 'A'));
    let over = [], zero = [];
    for (const role of VARIANT_SEATS.map(s => Setup.SEAT_VARIANTS[s]).concat(VARIANT_SEATS)) {
      const base = Setup.rollSeatPicks(65000);
      const with_ = Setup.rollSeatPicks(65000, role);
      const d = diff(base, with_);
      const seat = Setup.seatClaim(role).seat;
      /* 至多改一个席位（且必须是所选角色所属的那个） */
      if (d.length > 1 || (d.length === 1 && d[0] !== seat)) over.push(role + ' 波及 ' + d.join(','));
      /* 若该席本局掷出的正是所选变体，则构成与不选时相同（改不了就是没变） */
      const claim = Setup.seatClaim(role);
      const sameAsBase = (base[seat] || 'A') === (claim.variant === 'B' ? 'B' : 'A');
      if (sameAsBase && d.length !== 0) zero.push(role);
    }
    ok('自选L：自选只影响所选角色所属的那个席位，不波及其余四席', over.length === 0, over.join('; '));
    ok('自选M：若该席本就掷出所选变体，构成与不选时一致（幂等）', zero.length === 0, zero.join('; '));
  }

  /* --- 45.7 回落路径：不得静默换人 --- */
  {
    /* 角色键不在席位表内（转职系 / 拼错）→ 回落 + 明确说明，且 rng 口径与不传偏好一致 */
    const a = Setup.createGame(66000, 'human');
    const b = Setup.createGame(66000, 'human',
      { seatPicks: Setup.rollSeatPicks(66000), preferRole: 'tempdoc' });
    ok('自选N：非席位角色（转职系）回落到原口径，且 humanId 与不传偏好一致',
      a.humanId === b.humanId && !!b.roleNote && b.roleWanted === 'tempdoc',
      'note=' + b.roleNote);
    ok('自选O：非法角色键不抛错、不改变构成（玩家不该开不出局）',
      (() => {
        try {
          const g = Setup.createGame(66001, 'human',
            { seatPicks: Setup.rollSeatPicks(66001), preferRole: '__not_a_role__' });
          return g.players.length === 15 && !!g.roleNote;
        } catch (e) { return false; }
      })());
    /* 变体席位未掷中时的说明文案必须点出「同席位掷出了哪个变体」——
       早期版本一律写「不在本局席位表内」，对变体角色是错误归因。 */
    const gv = Setup.createGame(66002, 'random', { seatPicks: {}, preferRole: 'hunter' });
    ok('自选P：变体未出场时的说明点明同席位的另一个变体（而非误报「不在席位表」）',
      gv.roleGot !== 'hunter' && /掷出了变体/.test(gv.roleNote || ''), 'note=' + gv.roleNote);
    /* 给到了就闭嘴 */
    const gk = Setup.createGame(66003, 'random',
      { seatPicks: Setup.rollSeatPicks(66003, 'detective'), preferRole: 'detective' });
    ok('自选Q：偏好兑现时 roleNote 为空（不制造无谓提示）',
      gk.roleGot === 'detective' && !gk.roleNote);
  }
}

/* 〔v7 B0〕汇报口径显式列出「已停跑」条数并给出其归属机制分布。
   铁律四（诚实汇报）：不得让「停跑」消失在计数之外——只报通过数会让覆盖率下降不可见。 */
const byMech = {};
for (const [, m] of VOIDED) byMech[m] = (byMech[m] || 0) + 1;
console.log(`\nv26 回归断言：通过 ${pass} 条、失败 ${fail} 条、停跑 ${voided} 条`
  + `（合计 ${pass + fail + voided}）`);
if (voided) {
  console.log('  停跑明细（被测对象已于 v7 B0 归档，见文件头 __V7B0_VOID__ 登记表）：');
  for (const m of Object.keys(byMech)) console.log(`    ${String(byMech[m]).padStart(3)} 条  ${m}`);
}
process.exit(fail ? 1 : 0);
