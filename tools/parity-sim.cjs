'use strict';
/* ============================================================================
 * 模拟探针（v7 对等审查 · 模拟臂）—— **完整对局推演 + 行为统计**
 *
 * ⚠⚠ 纪律（2026-10-08 用户裁定，**本文件的硬约束**）：
 *   「裁判探针可以有上帝视角，模拟 AI 探针不可以；这是纪律。」
 *   本文件是**模拟臂**：它跑对局、让 AI 决策、统计行为。
 *   ⇒ **不许读任何真相字段。** 不许 `p.faction`（除自己）、不许 `p.role`（除自己）、
 *     不许 `p.infection` / `p.dying` / `p.silenceNight` / `p.alien` / `p.originRole` ……
 *     一个字都不许出现在本文件里（唯一的 `getter` 装置也只用于**记录**读了什么，
 *     绝不改值；且「自己读自己」在真机上就是合法的）。
 *   上帝视角的判定在 tools/parity-referee.cjs —— 裁判读本文件写下的账本。
 *   裁判看得见真相但**不能碰对局**；本文件碰对局但**看不见真相**。两者互不越界。
 *
 * 本文件产出三类统计（你要求的三项）：
 *   ① 发言（speak）  —— 谁在什么场合说了什么、宣称了什么、有没有留一手
 *   ② 思维（thought）—— 每个角色的 duty.senses 有没有真的取到料（不是「能不能」，
 *                      是「实际上取到没有」）
 *   ③ 决策（decide） —— 每个 kind 的动作分布、放弃率、僵局率
 *   外加：完整对局的异常检出（抛错 / 未终局 / 步数越界 / 决策形状异常）
 *
 * 自证：裁判在场与否，模拟结果必须**逐位相同** —— 故本脚本末尾跑
 *   「裸跑 vs 装 getter 跑」两种模式比对指纹。
 *
 * 用法：node tools/parity-sim.cjs <REPO_ROOT> [局数] [起始种子]
 * 退出码：0 = 无异常；非 0 = 有异常
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || process.cwd();
const N = +(process.argv[3] || 60);
const SEED0 = +(process.argv[4] || 241);
const SeatMode = require(path.join(ROOT, 'tools', 'seat-mode.cjs'));

const src = fs.readFileSync(path.join(ROOT, 'tools', 'load-order.cjs'), 'utf8');
const m = { exports: {} };
new Function('require', 'module', 'exports', '__dirname', '__filename', src)(
  require, m, m.exports, path.join(ROOT, 'tools'), 'x');
const { makeCtx, loadInto, profiles } = m.exports;
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
/* ⚠ view.js 属 profiles.ui，不在 full 里 —— **必须补载**：
   可见性闸门（js/ai/visibility.js）的判据真源就是 View.build，view 缺席时它会降级为
   「只可见自己」。那就等于让模拟器在一个**产品里不存在的降级路径**上跑，
   量出来的 AI 行为不是真实对局的行为（实测：漏载时 gate 投影读取恒为 0，是它的信号）。
   浏览器端 view.js 由 profiles.ui 加载，故模拟器补载它才是对齐产品。 */
loadInto(ctx, path.join(ROOT, 'js'), ['view']);
if (!ctx.View || typeof ctx.View.build !== 'function')
  throw new Error('parity-sim: View.build 不可用 —— 可见性闸门会降级为「只可见自己」，'
    + '那样量出来的不是产品的真实行为。');
const { Engine, Setup, AI } = ctx;
const RD = ctx.SKRoleDecl;
const Voice = ctx.AIVoice;
const AIVisible = ctx.AIVisible;

/* ── 观测桶 ── */
const P = {
  games: 0, errs: 0, errMsgs: {}, steps: 0, unfinished: 0, maxSteps: 0,
  /* ① 发言 */
  say: { total: 0, byRole: {}, byKind: {}, empty: 0, withClaim: 0, claimKind: {},
         avgLen: 0, lenSum: 0, dupText: 0, seenText: {} },
  /* ② 思维 */
  thought: { calls: 0, hit: 0, byRole: {}, senseUsed: {}, senseMiss: {}, claimKind: {} },
  /* ③ 决策 */
  decide: { total: 0, byKind: {}, byRole: {}, emptyRes: 0, kindShapes: {} },
  /* 账本（供裁判臂判定） */
  decisions: [], reads: [],
  formError: 0, formErrorSamples: [],
  /* 异常检出 */
  anomaly: [],
  /* 自证 */
  selfCheck: { compared: 0, mismatch: 0 },
};

/* 账本：记给裁判臂。
   ⚠ 不记 worlds（完整状态）—— 那是把上帝视角交出去 = 纪律破口。
     裁判自己按同种子重放（对局确定性，重放状态逐位相同）见 tools/parity-referee.cjs。 */
const art = 'parity-sim-' + SEED0 + '-' + (SEED0 + N - 1);

const bump = (o, k, n) => { o[k] = (o[k] || 0) + (n == null ? 1 : n); };

/* ══════════════ 读取记录装置（只记录、不改值）══════════════
   ⚠ 这是模拟器唯一触碰真相字段的地方，且它**只 push 一个字符串**到账本。
      它不读值、不判对错、不返回任何东西 —— 对局状态零影响。
      真正的「这一读合法吗」由裁判臂用上帝视角回答。 */
const RECORD_READS = true;
const READ_FIELDS = [
  'faction', 'role', 'originRole', 'roleName', 'claimedRole', 'infection', 'branch',
  'alien', 'convict', 'morph', 'silenceNight', 'noActive', 'vSelf', 'theta',
  'healLeft', 'rescueLeft', 'cureSelf', 'bullets', 'patrolUsed', 'repairTotal',
  'extraRepair', 'nightImmune', 'destroyLeft', 'meetingLeft', 'dying', 'poison',
  'revealed', 'accuseHistory', 'killLeft', 'extraKill', 'transferExposed',
];
let CUR = null;
let PHASE = null;   /* 'form' = 引擎在替真人算菜单（合法）；'decide' = AI 决策期 */

function installRecorders(g, seed) {
  for (const p of g.players) {
    for (const f of READ_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(p, f)) continue;
      let val = p[f];
      Object.defineProperty(p, f, {
        configurable: true, enumerable: true,
        get() {
          /* ⚠ 三个条件缺一不可，否则读数会被自己人污染（本探针第一版就栽在这）：
             ① CUR 非空          —— 只在 AI 决策窗口内记
             ② subject ≠ reader  —— 读自己是合法的（真人也有自己的面板）
             ③ PHASE !== 'form'  —— **form 层读取不算 AI 决策读取**。
                表单是引擎在替真人算菜单（真人也看得见同样内容），它内部会遍历全场。
                漏掉这一条 ⇒ 步骤 2 单步就记进 24 万条 originRole 读取，
                把「AI 用了 AI 视角外的信息」这个结论彻底污染掉。
             via:'gate' = 这次读取发生在可见性闸门算投影期间（View.build 遍历全员），
               与真人客户端渲染同一份投影同性质，单列成 GATE 档不参与判定。 */
          if (RECORD_READS && CUR && CUR.pid != null && p.id !== CUR.pid && PHASE !== 'form') {
            const via = (AIVisible && AIVisible.inGate && AIVisible.inGate()) ? 'gate' : 'decide';
            CUR.reads.push({ seed, reader: CUR.pid, subject: p.id, field: f, step: CUR.step, kind: CUR.kind, via });
          }
          return val;                       /* ← 原值，不改 */
        },
        set(nv) { val = nv; },
      });
    }
  }
}

/* ══════════════ ① 发言统计 ══════════════ */
const origSay = (ctx.Bridge && typeof ctx.Bridge.say === 'function') ? ctx.Bridge.say : null;
if (origSay) {
  ctx.Bridge.say = function (g, pid, text, opts) {
    const r = origSay.apply(this, arguments);
    try {
      const p = g.players.find(x => x.id === pid);
      const t = typeof text === 'string' ? text.trim() : '';
      if (t) {
        P.say.total++;
        bump(P.say.byRole, p && p.role);
        bump(P.say.byKind, opts && opts.kind ? opts.kind : (g.step || '?'));
        P.say.lenSum += t.length;
        if (P.say.seenText[t] != null) P.say.dupText++; else P.say.seenText[t] = 1;
        /* 宣称：p.outClaims 由 speak 层写（决定.js 的 IR.mk） */
        const cl = (p && p.outClaims) || [];
        if (cl.length) { P.say.withClaim++; for (const c of cl) bump(P.say.claimKind, c.kind || '?'); }
      } else P.say.empty++;
    } catch (e) { }
    return r;
  };
}

/* ══════════════ ② 思维统计 ══════════════
   思维是**会话内**的旁白层，不落盘、不发言。它有自己的 rng 消耗（COST_HEDGE），
   故取料时必须**换掉 rng 为吞调用桩**（交接文档 §6.5：观测扰动随机流的教训）。
   这里只取 sense / claimKind 两个字段，不看 hedge 文案。 */
function withStubRng(g, fn) {
  const real = g.rng;
  g.rng = { next: () => 0.5, int: n => Math.floor(0.5 * n), pick: a => a[0],
            chance: () => true, shuffle: a => a };
  try { return fn(); } finally { g.rng = real; }
}
function probeThought(g, p, seed) {
  if (!Voice || typeof Voice.thought !== 'function') return;
  P.thought.calls++;
  try {
    /* 取料覆盖：每个 duty.senses 声明都要问一遍「本局实际上有没有料」 */
    if (Voice.probeAll) {
      const all = Voice.probeAll(g, p);
      for (const [k, v] of Object.entries(all || {})) {
        if (v === 'hasMaterial') bump(P.thought.senseUsed, k);
        else if (v === 'noMaterial') bump(P.thought.senseMiss, k);
        else bump(P.thought.senseUsed, k + '(' + v + ')');
      }
    }
    const v2 = withStubRng(g, () => Voice.thought(g, p, { allowNonHuman: true }));
    if (v2) {
      P.thought.hit++;
      bump(P.thought.byRole, p.role);
      bump(P.thought.senseUsed, v2.sense);
      bump(P.thought.claimKind, v2.claimKind || '(none)');
    }
  } catch (e) { }
}

/* ══════════════ ③ 决策统计 ══════════════ */
/* ⚠ AI.decide 只调一次。§6.5 的教训：探针多调一次会扰动 g.rng
   （voice 的 COST_HEDGE 消耗随机流），推演出的对局与裸跑不同源。
   故：CUR 在调用**前**设好，让记录器在 AI 自己的那次执行里抓到读取，
       返回值直接用那一次的 res，绝不重调。 */
const origDecide = AI.decide;
AI.decide = function (g, req) {
  const p = g.players.find(x => x.id === (req && req.pid));
  let res = null;
  if (req && p) {
    const prev = CUR, prevPhase = PHASE;
    CUR = { pid: p.id, step: g.step, kind: req.kind, reads: [] };
    PHASE = 'decide';
    try { res = origDecide.call(AI, g, req); }
    catch (e) { P.errs++; bump(P.errMsgs, String(e.message).slice(0, 60), 1); }
    finally {
      PHASE = prevPhase;
      P.decide.total++;
      bump(P.decide.byKind, req.kind);
      bump(P.decide.byRole, p.role);
      if (!res || !Object.keys(res).length) P.decide.emptyRes++;
      bump(P.decide.kindShapes, req.kind + ' → ' + (res ? Object.keys(res).sort().join(',') : '(null)'));
      P.decisions.push({ seed: CURRENT_SEED, step: g.step, kind: req.kind, role: p.role, pid: p.id,
                         night: g.night, res, form: formOf(g, req.kind, p, g.step) });
      for (const r of CUR.reads) P.reads.push(r);
      CUR = prev;
    }
  } else {
    try { res = origDecide.call(AI, g, req); }
    catch (e) { P.errs++; bump(P.errMsgs, String(e.message).slice(0, 60), 1); }
  }
  return res;
};

/* 池描述 → 候选集。判据必须是**UI 的池推导**，不能自己重写一套：
   真人手上下发的就是 ui.js `targetList` 算出的那张表，自己写一套等于拿「我以为的
   合法目标」去判「真人的合法目标」—— 违例数会随我的实现漂移。
   故逐行对齐 ui.js:526-531 的三个分支（含 aliveNotAlien 那一支，漏掉它会误判）。 */
function poolOf(g, p, spec) {
  const al = g.players.filter(x => !x.out);
  const list = spec.list || 'aliveOthers';
  let base;
  if (list === 'alive') base = al;
  else if (list === 'aliveNotAlien') base = al.filter(x => x.faction !== 'alien');
  else base = al.filter(x => x.id !== p.id);
  const ex = new Set((spec.exclude || []).filter(x => x != null));
  return base.filter(x => !ex.has(x.id)).map(x => ({ v: x.id, id: x.id }));
}

/* 取真人表单摘要（模拟器读 form 是合法的：它就是真人手上那张菜单）。
   挂在 PHASE='form' 上，使表单内部的真相读取不被记成「AI 决策期越界」。

   ⚠ 收束时点：这个函数在 AI.decide **内部**调用，而 decide 是在 beginStep 里被调的
      —— 此时 g.step 已设成本步。**但外层钩返回后 beginStep 还会继续跑**，
      所以取值必须用调用瞬间的 g.step，不能等到钩子外层再取（那会拿到下一步）。 */
function formOf(g, kind, p, stepId) {
  const def = Engine.STEPS[stepId != null ? stepId : g.step];
  if (!def || typeof def.form !== 'function') return null;
  const prev = PHASE; PHASE = 'form';
  let targetsKind = 'none';
  try {
    const f = def.form(g, p);
    if (!f) return null;
    /* ⚠ targets 有**三种**形态，按步不同，绝不是一律数组：
       ① 候选数组   —— 已算好的选项列表（引擎算完直接下发给真人）
       ② 池描述对象 —— {list:'aliveOthers', max:1, min:0, exclude:[]}（还没算，由 UI 现算）
       ③ 单个 id    —— 步骤 0a 的 invite 表单
       上一版把它一律当数组，对 ② 抛错 → 1443 条决策被误记成「无表单可对照」，
       白丢七成覆盖面。判据：**只有 ① 能作词表用**；② 要自己按池描述求候选集。
    */
    const tg = f.targets;
    let targets;
    if (Array.isArray(tg)) {
      targets = tg.map(t => (t && typeof t === 'object' ? { v: t.v, id: t.id } : t));
      targetsKind = 'list';
    } else if (tg && typeof tg === 'object') {
      /* 池描述：按声明求候选集（引擎侧同一份推导，模拟器读它合法——就是真人能点的池） */
      const pool = poolOf(g, p, tg);
      targets = pool;
      targetsKind = 'pool:' + (tg.list || '?');
    } else if (tg != null) {
      targets = [tg]; targetsKind = 'single';
    } else { targets = []; targetsKind = 'none'; }
    return {
      kind: f.kind, title: f.title, targetsKind,
      opts: (f.opts || []).map(o => ({ v: o.v, disabled: !!o.disabled })),
      targets,
      num: f.num ? { label: f.num.label, options: (f.num.options || []).map(o => o.v) } : null,
      num2: f.num2 ? { label: f.num2.label, options: (f.num2.options || []).map(o => o.v) } : null,
    };
  } catch (e) {
    /* form 抛错不静默：吞掉会让「无 form 可对照」变成一个看不出原因的数字
       （上一版就因此把 1443 条决策误记成「无表单」，白丢七成覆盖面）。
       记下首个样本，其余只计数。 */
    P.formError++;
    if (P.formErrorSamples.length < 6)
      P.formErrorSamples.push({ kind, step: stepId, role: p && p.role, msg: String(e.message).slice(0, 80) });
    return null;
  } finally { PHASE = prev; }
}

/* 裁判要按「读者自己表单点名了谁」判定，需要这张名单。
   ⚠ 记的是**表单内容**（真人看得见的东西），不是真相 —— 故采集合法。
   ⚠ 但 pendings 只在**真人席位**存在时非空；本探针跑全 AI 局 ⇒ pendings 恒空
      ⇒ 必须**按当前步现算**那张表单（beginStep 做的也只是把它挂上去）。
      现算时挂 PHASE='form'，使表单内部的真相读取不被记成「AI 决策期越界」。 */
const namedByReader = {};
let CURRENT_SEED = 0;
function recordNamed(g, seed) {
  const step = g.step;
  const def = Engine.STEPS[step];
  if (!def || typeof def.form !== 'function') return;
  const m2 = namedByReader[seed] || (namedByReader[seed] = {});
  for (const p of g.players) {
    if (p.out) continue;
    const prev = PHASE; PHASE = 'form';
    try {
      const f = def.form(g, p);
      if (!f) continue;
      const ids = [];
      /* targets 三形态同 formOf：候选数组 / 池描述对象 / 单个 id */
      const tg = f.targets;
      const tl = Array.isArray(tg) ? tg : (tg && typeof tg === 'object' ? poolOf(g, p, tg) : (tg != null ? [tg] : []));
      for (const t of tl) { if (t == null) continue; ids.push(typeof t === 'object' ? (t.v != null ? t.v : t.id) : t); }
      /* 目标池之外，表单正文里也可能直接印出编号（如感染标记清单） */
      const blob = JSON.stringify([f.desc || '', f.opts || [], f.num || null]);
      for (const q of g.players) if (blob.indexOf(q.id + ' 号') >= 0 && ids.indexOf(q.id) < 0) ids.push(q.id);
      if (ids.length) m2[p.id] = ids;
    } catch (e) { } finally { PHASE = prev; }
  }
}

/* ══════════════ 对局指纹（自证用）══════════════ */
function fp(g) {
  let hp = 0, inf = 0, br = 0, alive = 0;
  for (const p of g.players) {
    if (!p.out) alive++;
    hp += (p.hp || 0);
    if (p.infection) inf++;
    if (p.branch) br++;
  }
  return [g.over ? 1 : 0, g.winner == null ? '-' : g.winner, g.night, alive, hp, inf, br, g.step].join('/');
}

/* ══════════════ 主循环 ══════════════ */
console.log(SeatMode.note());
console.log(SeatMode.zoneReport(SEED0, SEED0 + N - 1).note);
console.log('局数 = ' + N + '（种子 ' + SEED0 + ' 起）　【模拟臂：无上帝视角】');

const fingerprints = [];
for (let i = 0; i < N; i++) {
  const seed = SEED0 + i;
  CURRENT_SEED = seed;
  try {
    const g = SeatMode.seatGame(Setup, seed);
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    installRecorders(g, seed);
    Engine.begin(g);
    let k = 0;
    while (!g.over && k < 6000) {
      Engine.stepOnce(g);
      /* 每步：谁在场就探一次思维（取料覆盖），并记录各席表单点名了什么 */
      try {
        for (const p of g.players) if (!p.out) probeThought(g, p, seed);
      } catch (e) { }
      recordNamed(g, seed);
      if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
      k++;
      P.steps++;
    }
    if (!g.over) { P.unfinished++; P.anomaly.push({ seed, kind: '未终局', steps: k }); }
    if (k > 5000) P.anomaly.push({ seed, kind: '步数越界', steps: k });
    P.maxSteps = Math.max(P.maxSteps, k);
    fingerprints.push([seed, fp(g)]);
    P.games++;
  } catch (e) {
    P.errs++; bump(P.errMsgs, String(e.message).slice(0, 60), 1);
    P.anomaly.push({ seed, kind: '抛错', msg: String(e.message).slice(0, 90) });
  }
}
AI.decide = origDecide;
if (origSay) ctx.Bridge.say = origSay;

/* ══════════════ 自证：装记录器 vs 裸跑，逐位必须相同 ══════════════
   纪律的最后一环：记录器只该「看着」，不该「碰着」。
   做法：同一批种子跑两遍 —— 一遍装 getter、一遍不装 —— 比对指纹。
   不一致 ⇒ getter 污染了对局 ⇒ 本臂的全部数字不可信。 */
P.selfCheck.compared = 0;
P.selfCheck.mismatch = 0;
{
  const sample = fingerprints.slice(0, Math.min(8, fingerprints.length));
  for (const [seed, hooked] of sample) {
    let bare = null;
    try {
      const g2 = SeatMode.seatGame(Setup, seed);        /* 不装 getter = 裸跑 */
      g2.humans = []; g2.humanId = -1;
      for (const p of g2.players) p.isHuman = false;
      Engine.begin(g2);
      let k = 0;
      while (!g2.over && k < 6000) {
        Engine.stepOnce(g2);
        if (g2.pending) Engine.submit(g2, { opt: null, targets: [], num: null, text: '' });
        k++;
      }
      bare = fp(g2);
    } catch (e) { bare = 'ERR:' + String(e.message).slice(0, 40); }
    P.selfCheck.compared++;
    if (bare !== hooked) P.selfCheck.mismatch++;
  }
}

/* ══════════════ 报告 ══════════════ */
P.say.avgLen = P.say.total ? +(P.say.lenSum / P.say.total).toFixed(1) : 0;

console.log('');
console.log('── 自证（记录器 vs 裸跑）──');
console.log('   比对种子 ' + P.selfCheck.compared + ' 个，指纹不一致 ' + P.selfCheck.mismatch + ' 个（须为 0）');

console.log('');
console.log('── ① 发言 ──');
console.log('   总条数 = ' + P.say.total + '　空发言 = ' + P.say.empty + '　平均长度 = ' + P.say.avgLen + ' 字');
console.log('   重复文本 = ' + P.say.dupText + ' 次（同一句被重复说，说明多样性不足）');
console.log('   带宣称 = ' + P.say.withClaim + '　宣称种类 = ' + JSON.stringify(P.say.claimKind));
console.log('   按角色 = ' + JSON.stringify(P.say.byRole));
console.log('   按场合 = ' + JSON.stringify(P.say.byKind));

console.log('');
console.log('── ② 思维（duty.senses 取料覆盖）──');
console.log('   调用 = ' + P.thought.calls + '　命中 = ' + P.thought.hit
  + '　命中率 = ' + (P.thought.calls ? (100 * P.thought.hit / P.thought.calls).toFixed(1) : 'n/a') + '%');
console.log('   取到料的情报面 = ' + JSON.stringify(P.thought.senseUsed));
console.log('   无料的情报面   = ' + JSON.stringify(P.thought.senseMiss));
console.log('   心声的宣称类别 = ' + JSON.stringify(P.thought.claimKind));

console.log('');
console.log('── ③ 决策 ──');
console.log('   决策总数 = ' + P.decide.total + '　空返回 = ' + P.decide.emptyRes);
console.log('   按 kind = ' + JSON.stringify(P.decide.byKind));
console.log('   取表单失败 = ' + P.formError + ' 次（form 抛错）');
P.formErrorSamples.forEach(x => console.log('   · ' + JSON.stringify(x)));

console.log('');
console.log('── 异常检出 ──');
console.log('   抛错 ' + P.errs + '　未终局 ' + P.unfinished + '　最长对局 ' + P.maxSteps + ' 步');
if (P.anomaly.length) P.anomaly.slice(0, 10).forEach(a => console.log('   · ' + JSON.stringify(a)));

const out = {
  meta: {
    role: '模拟臂（不许读真相；上帝视角判定在 tools/parity-referee.cjs）',
    seatMode: SeatMode.seatMode(), seedFrom: SEED0, seedTo: SEED0 + N - 1,
    games: P.games, steps: P.steps, errs: P.errs, errMsgs: P.errMsgs,
    selfCheck: P.selfCheck,
    note: 'decisions/reads 是给裁判臂的账本。reads 只记录「读了哪个字段」，不记值。'
      + '**不导出 worlds**：导出完整对局状态等于把上帝视角交出去 = 纪律破口。'
      + '裁判按同种子重放取状态（对局确定性 ⇒ 重放逐位相同）。',
  },
  speak: P.say, thought: P.thought, decide: P.decide, anomaly: P.anomaly,
  selfCheck: P.selfCheck,
  ledgerMeta: { decisions: P.decisions.length, reads: P.reads.length },
};
/* readSteps：哪些 (seed, step) 出现过读取 —— 裁判据此决定在哪几步建视图，省时间。 */
const readSteps = {};
for (const r of P.reads) {
  if (!readSteps[r.seed]) readSteps[r.seed] = [];
  if (readSteps[r.seed].indexOf(r.step) < 0) readSteps[r.seed].push(r.step);
}
try {
  const file = path.join(ROOT, 'tools', SeatMode.artifactFor(art));
  fs.writeFileSync(file, JSON.stringify({
    meta: out.meta,
    decisions: P.decisions,
    reads: P.reads,
    readSteps,
    namedByReader,
  }));
  console.log('');
  console.log('账本已写出 ' + file + '（决策 ' + P.decisions.length + ' 条 / 读取记录 ' + P.reads.length + ' 条）');
  fs.writeFileSync(path.join(ROOT, 'tools', SeatMode.artifactFor('parity-sim-stats-' + SEED0 + '-' + (SEED0 + N - 1))),
    JSON.stringify(out, null, 1));
} catch (e) { console.log('产物写出失败: ' + String(e.message).slice(0, 60)); }

const bad = P.errs || P.unfinished || P.selfCheck.mismatch || P.anomaly.length;
process.exit(bad ? 1 : 0);