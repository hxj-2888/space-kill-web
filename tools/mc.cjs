/* =============================================================
 * 太空杀 · 蒙特卡洛模拟器（AI 运行模块独立入口）
 * 依赖割裂：无 DOM、无 UI、无联机层；加载 L1~L4.5（rng / data / state / nlp /
 * lang/ir / lang/renderer / infer/speakable / infer/tiers / corpus/tactics /
 * infer/pipeline / infer/visible / ai / engine）——结合层必须在场，
 * 否则 AI 发言不进证据链（Bridge 缺席会使 Claim 路由全失效，结果失真）
 * 用法：node tools/mc.cjs [对局数] [起始种子]
 * 输出：胜负分布 / 阶段分布 / 平均夜数 / 场均驱逐 / 异常清单 + mc_result.json
 * ============================================================= */
const fs = require('fs');
const path = require('path');
const { makeCtx, loadInto, profiles } = require('./load-order.cjs');

const N = parseInt(process.argv[2] || '300', 10);
const SEED0 = parseInt(process.argv[3] || '1', 10);

/* —— 沙盒上下文：与浏览器共享同一份源码，证明 AI 模块与 UI 完全解耦 ——
   加载清单已收敛到 tools/load-order.cjs（唯一真源），新增文件只改那一处 */
const ctx = makeCtx();
loadInto(ctx, path.join(__dirname, '..', 'js'), profiles.full);

/* ---------- v28b（B6 / B7）A/B 标定台 ----------
   允许用环境变量覆盖【标定对象】，其余代码完全相同（与 v26 的 R38 同种子 A/B 同口径）。
   用法（PowerShell）：
     $env:SK_SAB='{"gainW":0.15,"resistPer":4}'; node tools/mc.cjs 300 1
     $env:SK_SHADOW_FACTOR='0.8';              node tools/mc.cjs 300 1
   注意：只覆盖 Tiers 里的数值，不改任何判据；跑完记得清空环境变量。 */
let AB = null;
if (process.env.SK_SAB) {
  try { AB = JSON.parse(process.env.SK_SAB); Object.assign(ctx.Tiers.SAB, AB); }
  catch (e) { console.error('SK_SAB 解析失败：' + e.message); }
}
if (process.env.SK_SHADOW_FACTOR) {
  ctx.Tiers.SHADOW_FACTOR = Number(process.env.SK_SHADOW_FACTOR);
  AB = AB || {}; AB.shadowFactor = ctx.Tiers.SHADOW_FACTOR;
}

const { Setup, Engine } = ctx;

/* ---------- 统计容器 ---------- */
const wins = { human: 0, alien: 0, xeno: 0, draw: 0 };
const phases = { '常规': 0, '寂灭': 0, '决斗': 0, '未终局': 0 };
let nightsSum = 0, evictSum = 0, deathsSum = 0, checksSum = 0, repairsSum = 0;
const errs = [];
const nightHist = {};                      // 夜数分布
const outByCause = {};                     // 死因分布
let sabGames = 0, sab5Total = 0;           // v21 审查 #9：出现 ⑤ 破坏公告的局数 / ⑤ 公告总条数
const tiersHit = { 3: 0, 6: 0, 9: 0 };     // 停摆 3.0 / 6.0 / 9.0 触发局数
let drawNightsSum = 0;

const t0 = Date.now();

/* ---------- v25 指标体系（§三：只统计，不调参——① 不设阈值 ② 不进 gate ③ 只写 mc_result.json） ---------- */
const M = () => ctx.MoE;
const AI_ = () => ctx.AI;
const chanFired = new Set();               // A 组：chan_fired（跨局去重的触发通道）
const chanFires = {};                      // A 组：每通道累计触发次数（chan_wired 可被空转刷高，次数才有信息）
const chanEval = {};                       // v27（C3）：每通道累计求值次数——与 chanFires 成对读，才能分辨「条件过严」与「未求值」
const chanSrcViewers = {};                 // v26：通道证据 src → 持有它的观察者集合（分叉度：只被 1 人持有 = 真私有）
const srcViewers = {};                     // v26：全部证据 src → 持有它的观察者集合（证据层隐私结构的整体读数）
const expActive = new Set();               // A 组：产出过证据的专家
const evidenceDivPerGame = [];             // v32 批 5′：局内口径证据分叉度（每局一个值，场均输出）
let announce3 = 0;                         // v32：官方 ③ 神探公告总次数（公告利用率仪器）
let expertMarked = 0, tevTotal = 0;        // D 组：expert_marked / 证据总量
const srcKind = { fact: 0, claim: 0, universal: 0 };   // D 组：硬源 / 软源 / 普适层
let foldTotal = 0;                         // D 组：并罚折叠条数（viewer|target|src 去重）
const aucByPhase = { 开局: [], 中期: [], 残局: [] };    // 替代校准度：AUC 分阶段（人类观察者）
const defeatMode = {};                     // E 组：败法分布（死因 × 阶段）
/* v26 新增观测：分阵营 AUC（此前只采人类观察者，异形/外星人视角无标尺）+
   「宣称类目标侧证据」落地计数（验证 P0-① 修复是否真的开始产出）+ Z 档拦截统计 */
const aucByFaction = { human: { 开局: [], 中期: [], 残局: [] }, alien: { 开局: [], 中期: [], 残局: [] }, xeno: { 开局: [], 中期: [], 残局: [] } };
const sayEv = { locksay: 0, denyLie: 0, promiseMiss: 0, promiseHit: 0 };
let zFiltered = 0;
/* v28b（B6 仪器）：全部破坏决策样本（跨局累计）——用于回答「AI 是否按局势合理选择」 */
const sabEval = [];
/* v31 批 2（A3 仪器）：承诺兑现 / 违约分档计数（兑现走 credAdd，没有事后证据，此前数不出来） */
const promiseSettle = { hit: {}, miss: {}, void: {} };
/* v31 批 3（战术库接线仪器）：每个战术条目被出口多少次——37 条此前零消费者，无读数不可验收 */
const tacticUse = {};

/* Mann-Whitney AUC：敌对方被排在前面的概率（0.5=瞎猜，1.0=透视） */
function auc(pos, neg) {
  if (!pos.length || !neg.length) return null;
  const all = pos.map(s => ({ s, p: 1 })).concat(neg.map(s => ({ s, p: 0 }))).sort((a, b) => a.s - b.s);
  let r = 1, rankSumPos = 0, i = 0;
  while (i < all.length) {
    let j = i; while (j < all.length && all[j].s === all[i].s) j++;
    const avg = r + (j - i - 1) / 2;
    for (let k = i; k < j; k++) if (all[k].p) rankSumPos += avg;
    r += j - i; i = j;
  }
  const n1 = pos.length, n0 = neg.length;
  return (rankSumPos - n1 * (n1 + 1) / 2) / (n1 * n0);
}
function phaseOfNight(n) { return n <= 3 ? '开局' : n <= 5 ? '中期' : '残局'; }

/* ---------- C1 仪器：硬源锁定的三分类计数 ----------
   盲区：project() 命中 knownLockOf 时【短路返回、不读 tEvents】→ mc 的 srcKind.fact
   只统计「软事实」，全部硬源锁定（⑥⑩揭示 / ④⑤暴露 / ⑦验票官 / 查验锁定 / 异形互认 /
   真神探公告）在证据表里根本不存在。硬源的唯一载体是 p.known，因此这里直接读它——
   读出路径与 AI 完全一致（AIBelief.knownLockOf，含「职业→阵营」确定性推论与白名单校验）。
   三分类口径（同一 (目标, 阵营) 被多少名存活观察者持有）：
     单人私有 = 恰 1 名观察者（真正的私有信息优势，D2 的唯一直接读数）
     小组     = 2 ~ n-1 名
     全场     = 全部存活观察者（规则性公开锁⑥⑩/④）
   每条样本计「观察者×目标」对数；只统计存活目标。 */
const lockStat = { games: 0, pairs: 0, solo: 0, group: 0, global: 0, groups: 0, perNightPairs: [],
  gamePairs: [], gameSolo: [], gameGroup: [], gameGlobal: [] };
function sampleLocks(g) {
  const A = ctx.AIBelief;
  if (!A || !A.knownLockOf) return;
  const obs = g.players.filter(p => !p.out && !p.isHuman);
  if (!obs.length) return;
  const alive = new Set(g.players.filter(x => !x.out).map(x => x.id));
  const byKey = new Map();                 // target|faction → { set:Set(observerId), target }
  let pairs = 0;
  for (const p of obs) {
    if (!p.known) continue;
    for (const tid of p.known.keys()) {
      if (!alive.has(tid) || tid === p.id) continue;
      const f = A.knownLockOf(p, tid);
      if (!f) continue;                    // viaPrivate / 无阵营 → 不算硬源
      pairs++;
      const key = tid + '|' + f;
      if (!byKey.has(key)) byKey.set(key, { set: new Set(), target: tid });
      byKey.get(key).set.add(p.id);
    }
  }
  const snap = g._lockSnap = { pairs, solo: 0, group: 0, global: 0, groups: 0 };
  for (const rec of byKey.values()) {
    /* 全场共享的分母要排除【目标本人】——他不可能持有关于自己的硬源记录 */
    const denom = obs.length - (alive.has(rec.target) ? 1 : 0);
    if (rec.set.size <= 1) snap.solo += rec.set.size;
    else if (denom > 0 && rec.set.size >= denom) snap.global += rec.set.size;
    else snap.group += rec.set.size;
    snap.groups++;
  }
  lockStat.pairs += pairs;
  lockStat.solo += snap.solo;
  lockStat.group += snap.group;
  lockStat.global += snap.global;
  lockStat.groups += snap.groups;
  lockStat.perNightPairs.push(pairs);
}
const median = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
/* 每夜采样：分阵营观察者的怀疑度排序 AUC（v26：补异形 / 外星人视角——此前整条采样逻辑
   只含人类，v25 批次 10「对抗衰减」检验在异形侧没有标尺）。
   口径（队友是硬信息，必须排除在 pos/neg 之外，否则 AUC 恒为 1）：
     人类观察者：pos = 异形+外星人， neg = 人类           —— 能否把敌人排在前面
     异形观察者：pos = 人类，        neg = 外星人（非队友）—— 能否把人类排在外星人前面（异形要清人）
     外星人观察者：pos = 异形，      neg = 人类            —— 能否把异形排在人类前面（第三方要清异形） */
function sampleAUC(g) {
  const A = AI_(); if (!A || !A.suspOf) return;
  for (const p of g.players) {
    if (p.out) continue;
    const others = g.players.filter(x => !x.out && x.id !== p.id);
    let pos, neg;
    if (p.faction === 'human') {
      pos = others.filter(x => x.faction !== 'human');
      neg = others.filter(x => x.faction === 'human');
    } else if (p.faction === 'alien') {
      pos = others.filter(x => x.faction === 'human');
      neg = others.filter(x => x.faction === 'xeno');
    } else {
      pos = others.filter(x => x.faction === 'alien');
      neg = others.filter(x => x.faction === 'human');
    }
    if (!pos.length || !neg.length) continue;
    const a = auc(pos.map(x => A.suspOf(g, p, x.id)), neg.map(x => A.suspOf(g, p, x.id)));
    if (a == null || !isFinite(a)) continue;
    aucByFaction[p.faction][phaseOfNight(g.night)].push(a);
    if (p.faction === 'human') aucByPhase[phaseOfNight(g.night)].push(a);
  }
}

for (let i = 0; i < N; i++) {
  const seed = SEED0 + i;
  let g;
  try {
    g = Setup.createGame(seed, 'random');
    g.humans = [];                          // 全 AI 对局（蒙特卡洛基线）
    /* v21 修复：必须同时清空 humanId 与 isHuman——只清 humans 会残留一个「幻影真人席位」，
       该席位每步被空提交（视为放弃行动），把人类胜率从 ~50% 拖到 ~7%，蒙特卡洛基线失真 */
    g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    Engine.begin(g);
    let steps = 0, lastNight = -1;
    while (!g.over && steps < 5000) {
      steps++;
      Engine.stepOnce(g);
      if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
      if (g.night !== lastNight) { lastNight = g.night; sampleAUC(g); sampleLocks(g); }   // v25：每夜 AUC 采样 · v27：每夜硬源快照
    }
  } catch (e) {
    errs.push({ seed, msg: (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : String(e)) });
    continue;
  }
  /* v25 指标采集（每局） */
  if (g._chanFired) for (const k of g._chanFired) { const m = /^chan:([^:]+):/.exec(k); if (m) chanFired.add(m[1]); }
  if (g._chanFires) for (const k of Object.keys(g._chanFires)) chanFires[k] = (chanFires[k] || 0) + g._chanFires[k];
  if (g._chanEval) for (const k of Object.keys(g._chanEval)) chanEval[k] = (chanEval[k] || 0) + g._chanEval[k];   // v27（C3）
  /* v27（C1）：本局末夜硬源快照入样本（条/局 与 中位 以此为准） */
  if (g._sabEval) for (const r of g._sabEval) sabEval.push(r);   // v28b（B6）
  if (g._tacticUse) for (const k of Object.keys(g._tacticUse)) tacticUse[k] = (tacticUse[k] || 0) + g._tacticUse[k];
  if (g._promiseSettle) for (const k of ['hit', 'miss', 'void'])
    for (const t of Object.keys(g._promiseSettle[k] || {}))
      promiseSettle[k][t] = (promiseSettle[k][t] || 0) + g._promiseSettle[k][t];
  if (g._lockSnap) {
    lockStat.games++;
    lockStat.gamePairs.push(g._lockSnap.pairs);
    lockStat.gameSolo.push(g._lockSnap.solo);
    lockStat.gameGroup.push(g._lockSnap.group);
    lockStat.gameGlobal.push(g._lockSnap.global);
  }
  const gameSrcViewers = {};                       // v32 批 5′：本局的 src → 持有者集合（局内口径）
  for (const p of g.players) {
    if (p.isHuman) continue;
    for (const evs of (p.tEvents || new Map()).values()) {
      for (const e of evs) {
        tevTotal++;
        if (e.exp) { expertMarked++; expActive.add(e.exp); }
        /* v32 批 5′：局内口径的证据分叉度采样（对照全局聚合口径）——
           私有流水 src（own:<Role>:<what>:<night>）不含局标识，跨局聚合会把
           「每局单人私有」稀释成「跨局多人共享」，掩盖 5′ 的结构性效果。
           本采样每局独立统计 src 持有者数，取场均值作为对照读数（只观测不设靶）。 */
        if (e.src) {
          (gameSrcViewers[e.src] = gameSrcViewers[e.src] || new Set()).add(p.id);
        }
        if (e.kind === 'fact') srcKind.fact++; else srcKind.claim++;
        /* v26：宣称类目标侧落地的观测（P0-① 修复效果）+ 承诺兑现/违约 + 证伪型对账 */
        const s = e.src || '';
        if (s.startsWith('locksay:')) sayEv.locksay++;
        if (s.startsWith('denyLie:')) sayEv.denyLie++;
        if (s.startsWith('promiseMiss:')) sayEv.promiseMiss++;
        if (s.startsWith('settle:N01:')) sayEv.promiseHit++;
        /* v28（B3/D2）：排除信息的两个落点——私有（船员自己查验所得）/ 公开（排除类宣称） */
        if (s.startsWith('crewExclude:')) { sayEv.crewExclude = (sayEv.crewExclude || 0) + 1; if (sayEv.crewExclude <= 2) console.log('FIRED ' + s); }
        if (s.startsWith('excludesay:')) sayEv.excludesay = (sayEv.excludesay || 0) + 1;
        /* v26：证据按 src 去重后统计「持有它的观察者数」——这是「真分叉」的唯一直接读数。
           通道子集与全体证据各记一份：前者看接线质量，后者看整个证据层的隐私结构。 */
        if (s) {
          (srcViewers[s] = srcViewers[s] || new Set()).add(p.id);
          if (s.indexOf('chan:') === 0) (chanSrcViewers[s] = chanSrcViewers[s] || new Set()).add(p.id);
        }
      }
    }
    for (const e of (p.uEvents || [])) {
      srcKind.universal++;
      if (e.exp) expActive.add(e.exp);
      if (e.src) (srcViewers[e.src] = srcViewers[e.src] || new Set()).add(p.id);
    }
    zFiltered += (p.filteredClaims || []).length;      // Z 档「生成前过滤」拦截条数（N397~N400）
    sayEv.claimExp = (sayEv.claimExp || 0) + (p.claimedExperience || []).length;   // 私有体验宣称台账
    sayEv.roleBind = (sayEv.roleBind || 0) + (p.roleBindClaims || []).length;      // 编号+职业绑定台账
  }
  foldTotal += g._foldSet ? g._foldSet.size : 0;
  /* v32 批 5′：局内口径证据分叉度（场均）——对照全局聚合读数（稀释效应见上方注释） */
  {
    const srcKeys = Object.keys(gameSrcViewers);
    if (srcKeys.length) {
      const solo = srcKeys.filter(k => gameSrcViewers[k].size === 1).length;
      evidenceDivPerGame.push(+(solo / srcKeys.length).toFixed(4));
    }
  }
  /* v32 语言层修复仪器：官方 ③ 神探公告出现率（「公告有啥用」的第一读数——公告先得发生） */
  announce3 += (g.log || []).filter(e => e.batch === '③' && String(e.text).indexOf('神探公告') >= 0).length;
  for (const p of g.players) {
    if (!p.out || p.outType === 'vote') continue;
    const key = (p.cause || '—') + '@' + phaseOfNight(p.outNight || g.night);
    defeatMode[key] = (defeatMode[key] || 0) + 1;
  }
  wins[g.winner] = (wins[g.winner] || 0) + 1;
  const ph = g.extinction ? '寂灭' : g.duel ? '决斗' : '常规';
  phases[ph] = (phases[ph] || 0) + 1;
  nightsSum += g.night;
  nightHist[g.night] = (nightHist[g.night] || 0) + 1;
  const outs = g.players.filter(p => p.out);
  evictSum += outs.filter(p => p.outType === 'vote').length;
  deathsSum += outs.filter(p => p.outType !== 'vote').length;
  checksSum += g.actCounts.check || 0;
  repairsSum += g.actCounts.repair || 0;
  for (const p of outs) {
    const key = p.outType === 'vote' ? '驱逐' : (p.cause || '—');
    outByCause[key] = (outByCause[key] || 0) + 1;
  }
  /* v21 审查 #9：旧自检按 ⑤ 公告文本找「异形破坏」字样——v4.1 §3.2 合并口径下公告
     只报「本夜破坏总量：X.X」，自检恒不命中（死代码），与「异形从不破坏」无法区分。
     改为直接统计 ⑤ 条数与 g.tiers 各档触发，纳入结果表。 */
  const sabCount = g.log.filter(e => e.batch === '⑤').length;
  if (sabCount) { sabGames++; sab5Total += sabCount; }
  for (const k of [3, 6, 9]) if (g.tiers[k]) tiersHit[k]++;
  if (g.winner === 'draw') drawNightsSum += g.night;
  if ((i + 1) % 100 === 0) console.log(`  … 已完成 ${i + 1}/${N}`);
}
const done = N - errs.length;

/* ---------- 汇总 ---------- */
const pct = v => done ? (100 * v / done).toFixed(1) + '%' : '—';
const avgAuc = {};
for (const k of Object.keys(aucByPhase)) {
  const arr = aucByPhase[k];
  avgAuc[k] = arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3) : null;
}
const avgAucFaction = {};
for (const f of Object.keys(aucByFaction)) {
  avgAucFaction[f] = {};
  for (const k of Object.keys(aucByFaction[f])) {
    const arr = aucByFaction[f][k];
    avgAucFaction[f][k] = arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3) : null;
  }
}
/* v25 指标体系汇总（只统计不调参） */
const moe = M();
/* v26：通道分叉度——同一 (channel,night) 的 src 被多少个观察者持有。
   只被 1 人持有 = 真分叉（私有源生效）；被多人持有 = 共享证据（普适/黑板类）。
   这是阶段②「gate 接线」的验收口径：chan_wired 会被空转 gate 刷高，分叉度不会。 */
let chanSrcTotal = 0, chanSrcPrivate = 0, chanSrcShared = 0;
for (const k of Object.keys(chanSrcViewers)) {
  chanSrcTotal++;
  if (chanSrcViewers[k].size <= 1) chanSrcPrivate++; else chanSrcShared++;
}
let allSrcTotal = 0, allSrcPrivate = 0;
for (const k of Object.keys(srcViewers)) {
  allSrcTotal++;
  if (srcViewers[k].size <= 1) allSrcPrivate++;
}
/* v27（C1 / C3）：仪器读数汇总 */
const avgOf = a => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null;
const hardLock = {
  lock_pairs_per_game: avgOf(lockStat.gamePairs),
  lock_pairs_median: median(lockStat.gamePairs),
  lock_pairs_per_night: lockStat.perNightPairs.length ? +(lockStat.pairs / lockStat.perNightPairs.length).toFixed(2) : null,
  solo_per_game: avgOf(lockStat.gameSolo),        // 单人私有（D2 私有信息优势的直接读数）
  group_per_game: avgOf(lockStat.gameGroup),      // 小组共享
  global_per_game: avgOf(lockStat.gameGlobal),    // 全场共享（规则性公开锁）
  groups_total: lockStat.groups,
  games: lockStat.games,
};
const mountedList = moe && moe.mountedIds ? moe.mountedIds() : [];
const gateStats = mountedList.map(id => ({ id, eval: chanEval[id] || 0, fired: chanFires[id] || 0 }));
const gateNeverFired = gateStats.filter(x => x.eval > 0 && x.fired === 0).map(x => x.id);
const shadowDist = moe && moe.shadowSummary ? moe.shadowSummary() : null;
/* v28b（B6）：破坏决策的「局势相关性」——不设靶，只看方向是否符合常识：
   维修阻力越大 → 越不该破坏；距下一档越近 / 压力越大 / 队友已破坏越多 → 越值得破坏。
   若某一路的斜率方向反了，说明该项系数（或该项本身）标定有问题。 */
function goRate(rows) { return rows.length ? +(100 * rows.filter(r => r.go).length / rows.length).toFixed(1) : null; }
const sabStats = (() => {
  const all = sabEval;
  if (!all.length) return null;
  /* 三分位分档（v28b 修正）：固定阈值在实战里会退化成单桶（例：pressure 实测恒 ≤0.4，
     「≤0.4 / (0.4,0.6] / >0.6」全部落在第一档，读数零信息）。改为按样本自身分位数切三档，
     档位边界随数据自适应，并在标签里打印区间。 */
  const terciles = (keyFn) => {
    const vals = all.map(keyFn).slice().sort((a, b) => a - b);
    const q1 = vals[Math.floor(vals.length / 3)];
    const q2 = vals[Math.floor(2 * vals.length / 3)];
    const groups = { '低': [], '中': [], '高': [] };
    for (const r of all) { const v = keyFn(r); groups[v <= q1 ? '低' : v <= q2 ? '中' : '高'].push(r); }
    const ci = (lo, hi) => `${lo.toFixed ? lo.toFixed(3) : lo}~${hi.toFixed ? hi.toFixed(3) : hi}`;
    return {
      低: `${goRate(groups['低'])}%（n=${groups['低'].length}，≤${q1.toFixed(3)}）`,
      中: `${goRate(groups['中'])}%（n=${groups['中'].length}，${ci(q1, q2)}）`,
      高: `${goRate(groups['高'])}%（n=${groups['高'].length}，>${q2.toFixed(3)}）`,
    };
  };
  const keyed = (keyFn) => {
    const m = new Map();
    for (const r of all) { const k = String(keyFn(r)); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    const out = {};
    for (const [k, rows] of [...m.entries()].sort()) out[k] = `${goRate(rows)}%（n=${rows.length}）`;
    return out;
  };
  return {
    decisions: all.length,
    go_rate: goRate(all),
    avg_uDestroy_go: all.filter(r => r.go).length ? +(all.filter(r => r.go).reduce((a, r) => a + (r.uDestroy || 0), 0) / all.filter(r => r.go).length).toFixed(1) : null,
    avg_uAct: +(all.reduce((a, r) => a + r.uAct, 0) / all.length).toFixed(1),
    by_repairKnown: keyed(r => r.repairKnown === 0 ? '0' : r.repairKnown <= 1 ? '(0,1]' : '>1'),
    by_gapT: terciles(r => r.gapT),
    by_pressure: terciles(r => r.pressure),
    by_mates: keyed(r => r.mates),
    /* 均值对照（比固定分档稳健）：选择破坏的那批，各信号的均值 vs 全样本均值。
       期望方向：pressure ↑ / gapT ↓ / repairKnown ↓ / mates ↑。 */
    means: (() => {
      const go = all.filter(r => r.go);
      const m = (rows, f) => rows.length ? +(rows.reduce((a, r) => a + f(r), 0) / rows.length).toFixed(3) : null;
      const mk = (f) => ({ go: m(go, f), all: m(all, f) });
      return { pressure: mk(r => r.pressure), gapT: mk(r => r.gapT), repairKnown: mk(r => r.repairKnown), mates: mk(r => r.mates) };
    })(),
  };
})();
const metrics = {
  A_接入度: {
    chan_wired: moe && moe.wiredCount ? moe.wiredCount() : null,
    chan_unmounted: moe && moe.unmounted ? moe.unmounted() : null,   // v26：接了但编号不在总表 → 永不触发
    chan_total: ctx.Channels ? ctx.Channels.count : null,
    chan_fired: [...chanFired].sort(),
    chan_fires: chanFires,
    chan_src_total: chanSrcTotal,
    chan_src_private: chanSrcPrivate,
    chan_src_shared: chanSrcShared,
    chan_divergence: chanSrcTotal ? +(chanSrcPrivate / chanSrcTotal).toFixed(3) : null,
    /* v32 批 5′：局内口径证据分叉度（场均）——对照下方全局聚合的 evidence_divergence */
    evidence_divergence_per_game: evidenceDivPerGame.length
      ? +(evidenceDivPerGame.reduce((a, b) => a + b, 0) / evidenceDivPerGame.length).toFixed(4) : null,
    src_total: allSrcTotal,
    src_private: allSrcPrivate,
    evidence_divergence: allSrcTotal ? +(allSrcPrivate / allSrcTotal).toFixed(4) : null,
    expert_active: [...expActive].sort(),
    /* v27（C3）：求值-命中全表——chan_fires 只回答「谁响过」，这里回答「注册了却一次没响的有哪些」 */
    gate_eval_hit: gateStats,
    gate_never_fired: gateNeverFired,
  },
  B_仲裁: moe ? {
    arb_input_total: moe.stats.arb.n,
    arb_multi: moe.stats.arb.multi,
    arb_multi_rate: moe.stats.arb.n ? +(moe.stats.arb.multi / moe.stats.arb.n).toFixed(4) : null,
    arb_tier: { 同档保留分歧: moe.stats.arb.same, 差一档降权: moe.stats.arb.gap1, 差两档待验证: moe.stats.arb.gap2 },
  } : null,
  /* v32 批 4′（统一入账口）：四类写入路径的改道计数（直通模式，验收 = 指纹不变 + 本计数 > 0） */
  B1_改道: moe && moe.stats.rerouted ? Object.assign({}, moe.stats.rerouted) : null,
  C_影子: moe ? Object.assign({
    shadow_calls: moe.stats.shadow.calls,
    shadow_applied: moe.stats.shadow.applied,
    shadow_hit_rate: moe.stats.shadow.calls ? +(moe.stats.shadow.applied / moe.stats.shadow.calls).toFixed(4) : null,
  }, shadowDist ? { shadow_dist: shadowDist } : {}) : null,
  C1_硬源: hardLock,                 // v27：硬源锁定三分类（C1 盲区仪器的修正读数）
  D_证据结构: {
    src_kind: srcKind,
    fold_folded: foldTotal,
    fold_rate: tevTotal ? +(foldTotal / tevTotal).toFixed(4) : null,
    expert_marked: expertMarked,
    say_side: sayEv,                 // v26：宣称类目标侧证据（locksay / denyLie）+ 承诺兑现与违约
    z_filtered: zFiltered,           // v26：Z 档生成前过滤拦截条数（N397~N400）
  },
  E_结局: {
    win: wins, nights: done ? +(nightsSum / done).toFixed(2) : null,
    defeat_mode: defeatMode,
  },
};
const result = {
  N, done, seed0: SEED0, seedEnd: SEED0 + N - 1, elapsedMs: Date.now() - t0,
  sabEval: sabStats,               // v28b（B6）：破坏决策的局势相关性（只观测）
  abOverride: AB,                  // v28b（B6/B7）：本次运行覆盖过的标定对象（A/B 追溯用）
  wins, phases, errs,
  avgNights: done ? +(nightsSum / done).toFixed(2) : null,
  avgEvictions: done ? +(evictSum / done).toFixed(2) : null,
  avgDeaths: done ? +(deathsSum / done).toFixed(2) : null,
  avgChecks: done ? +(checksSum / done).toFixed(2) : null,
  avgRepair: done ? +(repairsSum / done).toFixed(2) : null,
  nightHist, outByCause,
  sabGames, sab5Total, tiersHit,   // v21 审查 #9：破坏 / 停摆触发统计
  auc: avgAuc,                     // v25：替代校准度的区分度指标（分阶段 AUC，只观测不设靶）
  aucByFaction: avgAucFaction,     // v26：分阵营 AUC（人类/异形/外星人各自视角）
  metrics,                         // v25 §三 指标体系
};
fs.writeFileSync(path.join(__dirname, '..', '..', '.tmp_docs', 'mc_result.json'),
  JSON.stringify(result, null, 2));

console.log('\n===== 蒙特卡洛结果 =====');
console.log(`对局 ${done}/${N}（种子 ${SEED0}~${SEED0 + N - 1}）  耗时 ${(result.elapsedMs / 1000).toFixed(1)}s  异常 ${errs.length}`);
console.log(`胜负分布: 人类 ${pct(wins.human)} | 异形 ${pct(wins.alien)} | 外星人 ${pct(wins.xeno)} | 平局 ${pct(wins.draw)}`);
console.log(`阶段分布: 常规 ${pct(phases['常规'])} | 寂灭 ${pct(phases['寂灭'])} | 决斗 ${pct(phases['决斗'])}`);
console.log(`平均夜数 ${result.avgNights} | 场均驱逐 ${result.avgEvictions} | 场均夜死 ${result.avgDeaths} | 场均查验 ${result.avgChecks} 人次 | 场均维修 ${result.avgRepair}`);
console.log(`死因分布: ${JSON.stringify(outByCause)}`);
/* v26：补三项已写入 result 但从未打印的读数（defeat_mode / nightHist / avgRepair 见上）+ 分阵营 AUC */
console.log(`夜数分布: ${JSON.stringify(nightHist)}`);
console.log(`败法分布: ${JSON.stringify(defeatMode)}`);
const decided = done - (wins.draw || 0);
if (decided > 0) console.log(`平局单独统计: ${wins.draw || 0} 局（占 ${(100 * (wins.draw || 0) / done).toFixed(1)}%，平均夜数 ${wins.draw ? (drawNightsSum / wins.draw).toFixed(1) : '—'}）；非平局胜率: 人类 ${pct(wins.human * done / decided).replace('%','')} / 异形 ${pct(wins.alien * done / decided)} / 外星人 ${pct(wins.xeno * done / decided)}`);
console.log(`破坏 / 停摆: 出现 ⑤ 公告 ${sabGames}/${done} 局（${done ? (100 * sabGames / done).toFixed(1) : '—'}%）· ⑤ 共 ${sab5Total} 条 · 停摆 3.0: ${tiersHit[3]} 局 / 6.0: ${tiersHit[6]} 局 / 9.0: ${tiersHit[9]} 局`);
/* v22 批次 4 → v25 批次 2：重合度只报告读数（C(n,2) 两两口径，按事件分列）——不设健康区间（§三：不设靶） */
if (ctx.MoE && ctx.MoE.stats.events) {
  const s = ctx.MoE.stats;
  const byEvt = Object.keys(s.byEvt).map(k => `${k}:${s.byEvt[k].pairs ? (s.byEvt[k].sum / s.byEvt[k].pairs).toFixed(2) : '—'}(${s.byEvt[k].pairs})`).join(' ');
  console.log(`路由重合度: ${s.pairs ? (s.pairSum / s.pairs).toFixed(2) : '—'}（两两 ${s.pairs} 对 · 平均激活 ${(s.actSum / s.events).toFixed(1)} / 12 专家）按事件: ${byEvt}`);
}
if (metrics) {
  console.log(`AUC 分阶段（人类）: ${JSON.stringify(avgAuc)}（敌对方排前概率，0.5=瞎猜——只观测）`);
  console.log(`AUC 分阵营: 人类 ${JSON.stringify(avgAucFaction.human)} · 异形 ${JSON.stringify(avgAucFaction.alien)} · 外星人 ${JSON.stringify(avgAucFaction.xeno)}`);
  console.log(`接入度: chan_wired ${metrics.A_接入度.chan_wired}/${metrics.A_接入度.chan_total} · chan_fired ${metrics.A_接入度.chan_fired.length} · expert_active ${metrics.A_接入度.expert_active.length}/13` +
    (metrics.A_接入度.chan_unmounted && metrics.A_接入度.chan_unmounted.length ? ` · ⚠ 未挂载（编号不在总表）${JSON.stringify(metrics.A_接入度.chan_unmounted)}` : ''));
  console.log(`通道分叉度（v26 阶段②验收口径）: src ${metrics.A_接入度.chan_src_total} 条 · 私有（仅 1 名观察者）${metrics.A_接入度.chan_src_private} · 共享 ${metrics.A_接入度.chan_src_shared} · divergence ${metrics.A_接入度.chan_divergence}`);
  console.log(`证据层分叉度（全部 src）: ${metrics.A_接入度.src_private}/${metrics.A_接入度.src_total} 条只被单一观察者持有 · evidence_divergence ${metrics.A_接入度.evidence_divergence}` +
    (metrics.A_接入度.evidence_divergence_per_game != null ? ` · 局内口径（v32 批 5′）${metrics.A_接入度.evidence_divergence_per_game}` : ''));
  console.log(`通道触发次数: ${JSON.stringify(metrics.A_接入度.chan_fires)}`);
  console.log(`官方③神探公告: ${announce3} 次 / ${done || '—'} 局（v32 仪器——公告先得发生才有用）`);
  console.log(`仲裁: 输入 ${metrics.B_仲裁.arb_input_total} · 多Claim率 ${metrics.B_仲裁.arb_multi_rate} · 三档 ${JSON.stringify(metrics.B_仲裁.arb_tier)}`);
  /* v32 批 4′：统一入账口的四类路径改道计数；批 5′ 增 private 流水与 ATTEND 调制读数 */
  if (metrics.B1_改道) console.log(`改道计数（v32 批 4′/5′）: ${JSON.stringify(metrics.B1_改道)}` +
    (moe && moe.stats.attended ? ` · ATTEND 调制 ${moe.stats.attended} 条` : ''));
  console.log(`影子: calls ${metrics.C_影子.shadow_calls} · 采纳率 ${metrics.C_影子.shadow_hit_rate}` +
    (metrics.C_影子.shadow_dist ? ` · 分布 n ${metrics.C_影子.shadow_dist.n} 非零 ${metrics.C_影子.shadow_dist.nonzero} (min/p50/p90/max ${metrics.C_影子.shadow_dist.min}/${metrics.C_影子.shadow_dist.p50}/${metrics.C_影子.shadow_dist.p90}/${metrics.C_影子.shadow_dist.max})` : ''));
  /* v27（C1）：硬源锁定三分类——srcKind.fact 漏掉的正是这一块 */
  const hl = metrics.C1_硬源;
  console.log(`硬源锁定（v27 修正口径）: ${hl.lock_pairs_per_game} 条/局（中位 ${hl.lock_pairs_median}，每夜样本均值 ${hl.lock_pairs_per_night}）· 单人私有 ${hl.solo_per_game} · 小组 ${hl.group_per_game} · 全场 ${hl.global_per_game}（${hl.games} 局）`);
  /* v27（C3）：注册了但一次没响的接线 */
  console.log(`接线求值-命中（v27）: 求值 ${metrics.A_接入度.gate_eval_hit.reduce((s, x) => s + x.eval, 0)} 次 · 命中 ${metrics.A_接入度.gate_eval_hit.reduce((s, x) => s + x.fired, 0)} 次` +
    (metrics.A_接入度.gate_never_fired.length ? ` · 求值>0 而 0 命中: ${JSON.stringify(metrics.A_接入度.gate_never_fired)}` : ' · 全部接线至少命中一次'));
  console.log(`证据: expert_marked ${metrics.D_证据结构.expert_marked}/${metrics.D_证据结构.src_kind.fact + metrics.D_证据结构.src_kind.claim} · fold_rate ${metrics.D_证据结构.fold_rate} · src ${JSON.stringify(metrics.D_证据结构.src_kind)}`);
  console.log(`宣称侧（v26）: 目标侧查验汇报 ${metrics.D_证据结构.say_side.locksay} · 证伪型对账 ${metrics.D_证据结构.say_side.denyLie} · 破坏宣称兑现(N01) ${metrics.D_证据结构.say_side.promiseHit} · Z 档拦截 ${metrics.D_证据结构.z_filtered}`);
  console.log(`承诺结算（v31 批 2 / A3）: 兑现 ${JSON.stringify(promiseSettle.hit)} · 违约 ${JSON.stringify(promiseSettle.miss)} · 失效(承诺者/目标出局) ${JSON.stringify(promiseSettle.void)}（违约另记 promiseMiss 事件 ${metrics.D_证据结构.say_side.promiseMiss} 条）`);
  const tacIds = Object.keys(tacticUse).sort();
  console.log(`战术库出口（v31 批 3）: 命中条目 ${tacIds.length} 条 / 总出口 ${tacIds.reduce((s, k) => s + tacticUse[k], 0)} 次 · ${JSON.stringify(tacticUse)}`);
  console.log(`排除类证据（v28 / B3+D2）: 私有（船员查验）${metrics.D_证据结构.say_side.crewExclude || 0} · 公开（排除宣称）${metrics.D_证据结构.say_side.excludesay || 0}`);
}
/* v28b（B6）：破坏决策的局势相关性（不设靶——只看方向是否符合常识） */
if (sabStats) {
  console.log(`破坏决策局势相关性（v28b / B6）: 决策样本 ${sabStats.decisions} · 选择破坏 ${sabStats.go_rate}% · 均值 uDestroy(go)=${sabStats.avg_uDestroy_go} vs uAct=${sabStats.avg_uAct}`);
  console.log(`  · 按【AI 已知维修者数】: ${JSON.stringify(sabStats.by_repairKnown)}`);
  console.log(`  · 按【距下一停摆档位】  : ${JSON.stringify(sabStats.by_gapT)}`);
  console.log(`  · 按【倒计时压力】      : ${JSON.stringify(sabStats.by_pressure)}`);
  console.log(`  · 按【已破坏队友数】    : ${JSON.stringify(sabStats.by_mates)}`);
  const M = sabStats.means;
  console.log(`  · 均值对照（go 组 vs 全样本）: pressure ${M.pressure.go} / ${M.pressure.all} · gapT ${M.gapT.go} / ${M.gapT.all} · repairKnown ${M.repairKnown.go} / ${M.repairKnown.all} · mates ${M.mates.go} / ${M.mates.all}`);
}
if (AB) console.log(`A/B 覆盖生效（v28b）: ${JSON.stringify(AB)}`);
if (errs.length) console.log('异常样例:', errs.slice(0, 3));
