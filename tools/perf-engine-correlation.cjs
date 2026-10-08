/* ============================================================================
 * 性能 × 引擎 相关性探针
 * ----------------------------------------------------------------------------
 * 目标：把种子对局审查里的观察，落到引擎子系统的量化读数上，回答三个问题：
 *   Q1 哪些引擎子系统真的解释 AI 表现？（相关性强 + 机制有调用）
 *   Q2 哪些子系统在转但对表现无解释力？（机制-指标背离，治理规范检测一）
 *   Q3 哪些指标在动但机制没调用？（反向背离，指标博弈嫌疑）
 *
 * 纪律：只观测不设靶；相关不等于因果，因果线索另标注机制调用数。
 * 只读。用法：node perf-engine-correlation.cjs <项目根> [局数]
 * ==========================================================================*/
'use strict';
const path = require('path');
const ROOT = process.argv[2];
const N = +(process.argv[3] || 300);
const { makeCtx, loadInto, profiles } = require(path.join(ROOT, 'tools', 'load-order.cjs'));
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { AI, Engine, Setup, MoE, Tiers, SKData, AIBelief: BEL } = ctx;

/* ============ 逐局取证 ============ */
const GAMES = [];
let CUR = null;

const CHANRE = [
  ['accuse', /^accuse:/], ['ask', /^ask|ans|askVerify/], ['king', /^king|emitKing/],
  ['expose', /^repair:|destroy:|R22|R23/], ['settle', /^settle:/], ['cross', /^cross|crossRole|ansCross|R12|conflict/],
  ['lock', /^locksay:|R38|privClaim|privSame|privShare/], ['ballot', /^R27|R28|R29|R40|R64|promiseMiss/],
  ['deny', /^denyLie:/], ['exclusion', /^excludesay:/], ['grudge', /^grudge:/], ['claim', /^claim:/],
  ['quote', /^quote:/], ['chan', /^chan:/], ['private', /^pm:|priv/],
];
const chanOf = s => { s = String(s || ''); for (const [n, re] of CHANRE) if (re.test(s)) return n; return 'other'; };

/* MoE.stats 是模块级全局且【跨局累加不清零】（moe.js:19 无 reset）——
   故逐局读数必须做差分，否则等于拿「第 N 局累计值」当该局特征。 */
let MOE_BASE = null;
function moeDelta() {
  const st = MoE.stats;
  const cur = {
    arb: { n: st.arb.n, multi: st.arb.multi, same: st.arb.same, gap1: st.arb.gap1, gap2: st.arb.gap2 },
    events: st.events, actSum: st.actSum, pairSum: st.pairSum, pairs: st.pairs,
    attended: st.attended || 0, leaked: st.leaked || 0, ignored: st.ignored || 0, capped: st.capped || 0,
    shadow: { calls: st.shadow.calls, applied: st.shadow.applied },
    rerouted: Object.assign({}, st.rerouted),
  };
  if (!MOE_BASE) { MOE_BASE = cur; return null; }
  const d = {
    arb: { n: cur.arb.n - MOE_BASE.arb.n, multi: cur.arb.multi - MOE_BASE.arb.multi, same: cur.arb.same - MOE_BASE.arb.same,
      gap1: cur.arb.gap1 - MOE_BASE.arb.gap1, gap2: cur.arb.gap2 - MOE_BASE.arb.gap2 },
    events: cur.events - MOE_BASE.events, actSum: cur.actSum - MOE_BASE.actSum,
    pairSum: cur.pairSum - MOE_BASE.pairSum, pairs: cur.pairs - MOE_BASE.pairs,
    attended: cur.attended - MOE_BASE.attended, leaked: cur.leaked - MOE_BASE.leaked,
    ignored: cur.ignored - MOE_BASE.ignored, capped: cur.capped - MOE_BASE.capped,
    shadow: { calls: cur.shadow.calls - MOE_BASE.shadow.calls, applied: cur.shadow.applied - MOE_BASE.shadow.applied },
    rerouted: {},
  };
  for (const k of Object.keys(cur.rerouted)) d.rerouted[k] = (cur.rerouted[k] || 0) - (MOE_BASE.rerouted[k] || 0);
  MOE_BASE = cur;
  return d;
}

function newGame(seed) {
  return {
    seed, winner: null, nights: 0,
    // ── 表现侧 ──
    humanWin: 0, nonHumanWin: 0,
    humanSurvived: 0, humanTotal: 0,
    expelPrec: [0, 0],          // 人类放逐：命中异形 / 总放逐
    votePrec: [0, 0],           // 投票命中：投中敌方 / 总投票
    voteAlien: 0, voteTotal: 0, voteAbstain: 0,
    killOnAlly: 0, killTotal: 0, killOnKey: 0,
    // ── 引擎侧 ──
    aucHuman: [0, 0],           // 累加
    hardCover: [0, 0],          // 硬源覆盖对数
    detCheck: 0, detPub: 0, crewCheck: 0,
    sabDecide: 0, sabGo: 0, net10Max: 0, stopNight: 0, ext: 0,
    arb: { n: 0, multi: 0, same: 0, gap1: 0, gap2: 0 },
    routeEvt: 0, routeAct: 0, overlap: [0, 0],
    attended: 0, leaked: 0, ignored: 0, capped: 0,
    shadow: { calls: 0, applied: 0 },
    rerouted: { reason: 0, speak: 0, announce: 0, chan: 0, chanUniv: 0, private: 0 },
    evMass: {}, evPairs: [0, 0],
    deadEvidence: 0, aliveEvidence: 0,
    tacTotal: 0, tacDead: 0,
    meetingNoInfo: 0,
    speaks: 0, emptySpeaks: 0,
    promiseHit: 0, promiseMiss: 0, promiseVoid: 0,
    // 记忆
    memContra: 0, memRoleChange: 0, memStance: 0,
  };
}

/* 包住 decide：夜间行动 + 投票精度 */
const od = AI.decide;
AI.decide = function (g, req) {
  const d = od.apply(this, arguments);
  if (!CUR || !req) return d;
  const k = req.kind;
  if (k === 'vote') {
    const p = g.players.find(x => x.id === req.pid);
    const t = d && d.target;
    if (!p) return d;
    if (t == null) { CUR.voteAbstain++; return d; }
    CUR.voteTotal++;
    const tp = g.players.find(x => x.id === t);
    if (tp && !tp.out && (tp.faction === 'alien' || tp.faction === 'xeno')) CUR.votePrec[0]++; CUR.votePrec[1]++;
  } else if (k === 'branch') { CUR.sabDecide++; if (d && d.branch === 'destroy') CUR.sabGo++; }
  else if (k === 'detective') { if (d && d.mode === 'check') CUR.detCheck++; if (d && d.mode === 'announce') CUR.detPub++; }
  else if (k === 'crewAction') { if (d && d.mode === 'check') CUR.crewCheck++; }
  else if (k === 'meeting') { if (!(d && d.do)) CUR.meetingNoInfo++; }
  return d;
};

/* 包住 speak：发言与复读 */
const os = AI.speak;
AI.speak = function (g, p, q) {
  const t = os.apply(this, arguments);
  if (CUR) { CUR.speaks++; if (!t || !String(t).trim()) CUR.emptySpeaks++; }
  return t;
};

/* 包住 pickTactic：死条目 */
const op = ctx.Tactics.pickTactic;
ctx.Tactics.pickTactic = function () {
  const r = op.apply(this, arguments);
  if (CUR && r) { CUR.tacTotal++; if (!r.text && !r.claim) CUR.tacDead++; }
  return r;
};

/* 采样：投票轮后记引擎读数 */
function sampleEngine(g) {
  if (!CUR) return;
  // 仲裁 / 路由 / 注意力 / 影子（MoE 全局 stats 增量在每局末取，这里先记录快照）
  const d = moeDelta();
  if (!d) return;
  CUR.arb.n += d.arb.n; CUR.arb.multi += d.arb.multi; CUR.arb.same += d.arb.same;
  CUR.arb.gap1 += d.arb.gap1; CUR.arb.gap2 += d.arb.gap2;
  CUR.routeEvt += d.events; CUR.routeAct += d.actSum;
  CUR.overlap[0] += d.pairSum; CUR.overlap[1] += d.pairs;
  CUR.attended += d.attended; CUR.leaked += d.leaked;
  CUR.ignored += d.ignored; CUR.capped += d.capped;
  CUR.shadow.calls += d.shadow.calls; CUR.shadow.applied += d.shadow.applied;
  for (const key of Object.keys(d.rerouted)) CUR.rerouted[key] = (CUR.rerouted[key] || 0) + (d.rerouted[key] || 0);
  CUR.moeSampled = 1;

  // AUC（人类观察者）+ 硬源覆盖 + 证据量 + 记忆
  for (const o of g.players) {
    if (o.out || o.faction !== 'human') continue;
    const al = g.players.filter(x => !x.out && x.id !== o.id);
    if (al.length < 2) continue;
    const hostileSet = new Set(['alien', 'xeno']);
    const pos = [], neg = [];
    for (const x of al) {
      const truth = hostileSet.has(x.faction);
      // 硬源覆盖
      const k = o.known && o.known.get(x.id);
      const rd = k && k.role && SKData.ROLES[k.role];
      const f = (x.revealed && x.revealed.faction) || (k && k.faction) || (rd && rd.faction);
      CUR.hardCover[1]++; if (f) CUR.hardCover[0]++;
      // 证据量（按通道）
      const evs = (o.tEvents && o.tEvents.get(x.id)) || [];
      let m = 0;
      for (const e of evs) {
        if ((e.delta || 0) <= 0) continue;
        const age = Math.max(0, g.night - e.night);
        const decay = e.kind === 'fact' ? 1 : Math.pow(e.grudge ? Tiers.GRUDGE_DECAY : Tiers.CLAIM_DECAY, age);
        const cs = (e.tier && e.tier[0] === 'D') ? (0.4 + 0.6 * BEL.credOf(o, e.spk || x.id)) : 1;
        m += Math.abs(e.delta) * decay * cs;
        const c = chanOf(e.src); CUR.evMass[c] = (CUR.evMass[c] || 0) + Math.abs(e.delta) * decay * cs;
      }
      CUR.evPairs[1]++;
      if (x.out) CUR.deadEvidence += m; else CUR.aliveEvidence += m;
      let s = 0; try { s = AI.suspOf(g, o, x.id); } catch (e) {}
      (truth ? pos : neg).push(s);
    }
    if (pos.length && neg.length) {
      let w = 0; for (const a of pos) for (const b of neg) w += a > b ? 1 : a === b ? 0.5 : 0;
      CUR.aucHuman[0] += w / (pos.length * neg.length); CUR.aucHuman[1]++;
    }
    // 记忆
    if (o.mem) {
      CUR.memContra += o.mem.contradiction.length;
      for (const [, e] of o.mem.saidRole) if (e.conflictWith) CUR.memRoleChange++;
      for (const [, e] of o.mem.stance) CUR.memStance += Math.abs(e.score);
    }
  }
}

/* ============ 跑局 ============ */
for (let seed = 1; seed <= N; seed++) {
  let g;
  CUR = newGame(seed);
  MOE_BASE = null;
  try {
    g = Setup.createGame(seed, 'random');
    g.humans = []; g.humanId = -1; for (const p of g.players) p.isHuman = false;
    CUR.humanTotal = g.players.filter(p => p.faction === 'human').length;
    Engine.begin(g);
    let steps = 0;
    while (!g.over && steps < 5000) {
      steps++;
      Engine.stepOnce(g);
      if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
      if (typeof g.net10 === 'number') CUR.net10Max = Math.max(CUR.net10Max, g.net10);
      if (g.step === '9' || g.step === 'D-vote' || g.step === 'M-vote') sampleEngine(g);
    }
    { const d = moeDelta();
      if (d) { CUR.arb.n += d.arb.n; CUR.arb.multi += d.arb.multi; CUR.arb.same += d.arb.same;
        CUR.arb.gap1 += d.arb.gap1; CUR.arb.gap2 += d.arb.gap2;
        CUR.routeEvt += d.events; CUR.routeAct += d.actSum;
        CUR.overlap[0] += d.pairSum; CUR.overlap[1] += d.pairs;
        CUR.attended += d.attended; CUR.leaked += d.leaked; CUR.ignored += d.ignored; CUR.capped += d.capped;
        CUR.shadow.calls += d.shadow.calls; CUR.shadow.applied += d.shadow.applied;
        for (const key of Object.keys(d.rerouted)) CUR.rerouted[key] = (CUR.rerouted[key] || 0) + (d.rerouted[key] || 0); } }
    CUR.winner = g.winner || 'timeout';
    CUR.nights = g.night;
    CUR.humanWin = CUR.winner === 'human' ? 1 : 0;
    CUR.nonHumanWin = CUR.winner === 'alien' || CUR.winner === 'xeno' ? 1 : 0;
    CUR.humanSurvived = g.players.filter(p => p.faction === 'human' && !p.out).length;
    // 放逐精度
    for (const p of g.players) if (p.out && p.outType === 'vote') { CUR.expelPrec[1]++; if (p.faction !== 'human') CUR.expelPrec[0]++; }
    if (g.stopNight) CUR.stopNight = 1;
    if (g.extinction) CUR.ext = 1;
    if (g._promiseSettle) {
      for (const k of ['hit', 'miss', 'void']) CUR['promise' + k[0].toUpperCase() + k.slice(1)] = Object.keys(g._promiseSettle[k] || {}).length;
    }
  } catch (e) { CUR.winner = 'error'; }
  GAMES.push(CUR);
  CUR = null;
}

/* ============ 相关性 ============ */
function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 8) return NaN;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return (da && db) ? num / Math.sqrt(da * db) : NaN;
}
function rank(v) {
  const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(v.length);
  let i = 0;
  while (i < idx.length) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let m = i; m <= j; m++) r[idx[m][1]] = avg;
    i = j + 1;
  }
  return r;
}
function spearman(a, b) { return pearson(rank(a), rank(b)); }

const ok = GAMES.filter(g => g.winner !== 'error' && g.winner !== 'timeout');
const Y = ok.map(g => g.humanWin);

/* 特征表：name -> {get, 机制调用, 说明} */
const FEAT = {
  '神探公告次数':        { get: g => g.detPub, mech: g => g.detCheck, note: 'detective mode=announce' },
  '神探查验次数':        { get: g => g.detCheck, mech: g => g.detCheck, note: 'detective mode=check' },
  '船员查验次数':        { get: g => g.crewCheck, mech: g => g.crewCheck, note: 'crewAction mode=check' },
  '硬源覆盖率':          { get: g => g.hardCover[1] ? g.hardCover[0] / g.hardCover[1] : 0, mech: g => g.hardCover[0], note: 'known/revealed 锁定占比' },
  '人类 AUC':            { get: g => g.aucHuman[1] ? g.aucHuman[0] / g.aucHuman[1] : 0.5, mech: g => g.aucHuman[1], note: 'suspOf 判别力' },
  '投票精度':            { get: g => g.votePrec[1] ? g.votePrec[0] / g.votePrec[1] : 0, mech: g => g.votePrec[1], note: '投中敌方/总投票' },
  '放逐精度':            { get: g => g.expelPrec[1] ? g.expelPrec[0] / g.expelPrec[1] : 0, mech: g => g.expelPrec[1], note: '放逐异形/总放逐' },
  'ask 通道证据量':      { get: g => g.evMass.ask || 0, mech: g => g.evMass.ask || 0, note: '质询投毒源' },
  'king 通道证据量':     { get: g => g.evMass.king || 0, mech: g => g.evMass.king || 0, note: '沉默指纹（唯一有效通道）' },
  'ballot 通道证据量':   { get: g => g.evMass.ballot || 0, mech: g => g.evMass.ballot || 0, note: '票型/验票官' },
  '证据总负向量':        { get: g => g.aliveEvidence + g.deadEvidence, mech: g => g.evPairs[1], note: '可见度代理' },
  '死者证据占比':        { get: g => (g.aliveEvidence + g.deadEvidence) ? g.deadEvidence / (g.aliveEvidence + g.deadEvidence) : 0, mech: g => g.deadEvidence, note: '无剪枝（种子42 观察）' },
  '破坏发生率':          { get: g => g.sabDecide ? g.sabGo / g.sabDecide : 0, mech: g => g.sabGo, note: 'branch=destroy' },
  '净破坏峰值':          { get: g => g.net10Max / 10, mech: g => g.net10Max, note: 'net10' },
  '仲裁多Claim组占比':   { get: g => g.arb.n ? g.arb.multi / g.arb.n : 0, mech: g => g.arb.multi, note: '三档仲裁输入多样性' },
  '仲裁差一档':          { get: g => g.arb.gap1, mech: g => g.arb.gap1, note: '仲裁差异化分支' },
  '仲裁差两档':          { get: g => g.arb.gap2, mech: g => g.arb.gap2, note: '待验证队列' },
  '路由重合度':          { get: g => g.overlap[1] ? g.overlap[0] / g.overlap[1] : 1, mech: g => g.overlap[1], note: '专家激活两两 Jaccard' },
  '平均激活专家':        { get: g => g.routeEvt ? g.routeAct / g.routeEvt : 0, mech: g => g.routeEvt, note: 'route 广度' },
  '注意力调制次数':      { get: g => g.attended, mech: g => g.attended, note: 'ATTEND 写入侧' },
  '注意力闸门丢弃':      { get: g => g.ignored, mech: g => g.ignored, note: 'floor 闸门' },
  '注意力缓存截流':      { get: g => g.capped, mech: g => g.capped, note: 'attCap 缓存' },
  '影子层采用':          { get: g => g.shadow.applied, mech: g => g.shadow.calls, note: '做戏构陷改靶' },
  '通道改道入账 chan':   { get: g => g.rerouted.chan || 0, mech: g => g.rerouted.chan || 0, note: '总表通道消费' },
  '公告改道入账':        { get: g => g.rerouted.announce || 0, mech: g => g.rerouted.announce || 0, note: '③ 公告清算' },
  '理由链入账 reason':   { get: g => g.rerouted.reason || 0, mech: g => g.rerouted.reason || 0, note: 'R 规则链' },
  '战术死条目率':        { get: g => g.tacTotal ? g.tacDead / g.tacTotal : 0, mech: g => g.tacTotal, note: 'pickTactic 空转' },
  '空发言率':            { get: g => g.speaks ? g.emptySpeaks / g.speaks : 0, mech: g => g.speaks, note: 'speak 返回空串' },
  '零信息紧急会议':      { get: g => g.meetingNoInfo, mech: g => g.meetingNoInfo, note: 'meeting do=false' },
  '记忆·矛盾条数':       { get: g => g.memContra, mech: g => g.memContra, note: 'AIMemory 矛盾' },
  '记忆·自称改口':       { get: g => g.memRoleChange, mech: g => g.memRoleChange, note: 'AIMemory 改口' },
  '记忆·立场强度':       { get: g => g.memStance, mech: g => g.memStance, note: 'AIMemory 立场' },
  '承诺兑现 hit':        { get: g => g.promiseHit, mech: g => g.promiseHit, note: 'E7' },
  '平均夜数':            { get: g => g.nights, mech: g => g.nights, note: '对局长度' },
  '人类存活人数':        { get: g => g.humanSurvived, mech: g => g.humanTotal, note: '终局' },
};

console.log('=== 性能 × 引擎 相关性（%d 局，有效 %d）===\n', N, ok.length);
const win = {};
for (const g of ok) win[g.winner] = (win[g.winner] || 0) + 1;
console.log('胜负分布：' + JSON.stringify(win) + '　人类胜率 ' + (100 * Y.reduce((a, b) => a + b, 0) / Y.length).toFixed(1) + '%\n');

console.log('目标变量 = 人类是否获胜（1/0）。r=皮尔逊，ρ=斯皮尔曼(秩，更抗异常)\n');
const rows = [];
for (const name of Object.keys(FEAT)) {
  const X = ok.map(FEAT[name].get);
  if (X.every(v => !v)) continue;
  rows.push({ name, r: pearson(X, Y), rho: spearman(X, Y), note: FEAT[name].note,
    act: ok.reduce((a, g) => a + (FEAT[name].mech(g) || 0), 0) });
}
rows.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
for (const row of rows) {
  const s = '█'.repeat(Math.min(30, Math.round(Math.abs(row.rho) * 30)));
  const dir = row.rho > 0 ? '＋' : '－';
  console.log('  ' + row.name.padEnd(20) + ' r=' + (row.rho >= 0 ? '+' : '') + row.r.toFixed(3)
    + '  ρ=' + (row.rho >= 0 ? '+' : '') + row.rho.toFixed(3) + ' ' + dir + s
    + '   [机制量=' + row.act + '] ' + row.note);
}
/* ---- 偏相关：控制对局长度 Z ---- */
function partialCorr(X, Y, Z) {
  const rxy = pearson(X, Y), rxz = pearson(X, Z), ryz = pearson(Y, Z);
  const den = Math.sqrt((1 - rxz * rxz) * (1 - ryz * ryz));
  if (!isFinite(rxy) || !isFinite(rxz) || !isFinite(ryz) || !den) return NaN;
  return (rxy - rxz * ryz) / den;
}
const ZC = ok.map(g => g.nights);
console.log('\n--- 控制「对局长度」后的偏相关（剔除"打得越久数据越多"的伪相关）---\n');
const prows = [];
for (const name of Object.keys(FEAT)) {
  if (name === '平均夜数' || name === '人类存活人数') continue;
  const X = ok.map(FEAT[name].get);
  if (X.every(v => !v)) continue;
  prows.push({ name, p: partialCorr(X, Y, ZC), rho: spearman(X, Y) });
}
prows.sort((a, b) => Math.abs(b.p) - Math.abs(a.p));
for (const row of prows) {
  const bar = (row.p >= 0 ? '+' : '-').repeat(Math.min(28, Math.round(Math.abs(row.p) * 28)));
  console.log('  ' + row.name.padEnd(20) + ' 偏r=' + (row.p >= 0 ? '+' : '') + row.p.toFixed(3)
    + '  (原始 rho=' + (row.rho >= 0 ? '+' : '') + row.rho.toFixed(3) + ')  ' + bar);
}
console.log('\n  判读：偏相关大幅缩水 => 原相关性主要来自"对局越长该量越大"，非因果。');

require('fs').writeFileSync(path.join(__dirname, 'perf-corr-report.txt'),
  rows.map(r => `${r.name}\tr=${r.r.toFixed(4)}\trho=${r.rho.toFixed(4)}\tmech=${r.act}\t${r.note}`).join('\n'), 'utf8');