'use strict';
/* mutex-probe v2 —— 修正分类器
 * v1 的两处错误（都是我自己的探针 bug，不是 AI 的问题）：
 *   ① 分类器有 default 分支：step 4b 未匹配时直接 return 'destroy'、step 7 未匹配时
 *      直接 return 'kill' ⇒ 凭空造出 2070 次 destroy 与大量 kill，伪造成 1502 次「违规」。
 *   ② 读错字段：4b 的动作在 r.branch（不是 r.act/r.mode），于是全被读成 null。
 * 正确返回形状（由 tools/decide-shapes 转储核验，见本函数注释逐条标注）：
 *   2|crewAction|crew      → r.mode ∈ {none, check, ...}
 *   2|detective|detective  → r.mode ∈ {check, none}
 *   2|patrol|sheriff       → r.use + r.targets
 *   4b|branch|alien        → r.branch ∈ {cocoon, destroy, none}
 *   4b|branch|xeno         → r.branch ∈ {none, destroy}
 *   7|alienAct|alien       → r.act ∈ {kill, infect, none}   ← 引擎表单只有这三项
 *   8|doctor|*             → r.act ∈ {brew, rescue, selfsave, treat, none, ...}
 *   6|shoot|*              → r.targets（无 opt 字段）
 *   5|xenoKill|xeno        → r.targets
 * 未匹配一律 UNKNOWN，**绝不 default**（0 与「没采到」是两件事）。
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || process.cwd();
const SeatMode = require(path.join(ROOT, 'tools', 'seat-mode.cjs'));
const N = +(process.argv[3] || 150);
const OUTF = process.argv[4] || null;

function loadOrder(root) {
  const src = fs.readFileSync(path.join(root, 'tools', 'load-order.cjs'), 'utf8');
  const m = { exports: {} };
  new Function('require', 'module', 'exports', '__dirname', '__filename', src)(
    require, m, m.exports, path.join(root, 'tools'), 'x');
  return m.exports;
}
const { makeCtx, loadInto, profiles } = loadOrder(ROOT);
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { AI, Engine, Setup } = ctx;
const RD = ctx.SKRoleDecl;

/* step → 该步位上「合法」的动作身份集合（直接照抄各步 form 的 opts，未匹配即非法） */
/* 合法值**逐条照抄引擎 form 的 opts**（v2 修正：v1 把医生治疗写成 treat，
   实际 steps.js:1238 是 heal ⇒ v1 误报了 ILLEGAL@8:heal；step 8 的 selfsave
   亦照抄 steps.js:1248 的字面量，不是 selfSave） */
const LEGAL = {
  /* 步 2：船员 opts = check + repair{0.20..0.50} 七档（前缀式命名，steps.js:584-586）+ none
     神探 opts = check + announce（steps.js:608）+ none。
     两者的互斥都靠「同一张菜单」天然保证，无需引擎再判。 */
  '2': {
    /* crew：'repair' 是 AI 内部协议（decide.js:749 返 {mode:'repair', value}），
       引擎 steps.js:620 按 d.mode==='repair' 取 d.value 接受；
       人类表单另用前缀式取值 'repair0.20'…'repair0.50'（steps.js:584-586）。两套接口并存。 */
    crewAction: (v) => v === 'check' || v === 'none' || v === 'repair' || /^repair0\.\d\d$/.test(v),
    detective: (v) => v === 'check' || v === 'announce' || v === 'none',
  },
  '4b': { branch: ['cocoon', 'destroy', 'none'] },
  '7': { alienAct: ['kill', 'infect', 'none'] },
  '8': { doctor: ['none', 'heal', 'rescue', 'selfsave', 'brew', 'poison', 'antidote', 'revive'] },
};

/** 该步位该 kind 是否接受此取值；LEGAL 的槽位可以是数组或判定函数 */
function okAt(step, kind, v) {
  const slot = LEGAL[step] && LEGAL[step][kind];
  if (!slot) return false;
  return typeof slot === 'function' ? !!slot(v) : slot.indexOf(v) >= 0;
}

function classify(step, kind, res) {
  if (!res || typeof res !== 'object') return 'NO_RETURN';
  // 4b：分支值在 r.branch
  if (res.branch !== undefined) {
    return okAt(step, kind, res.branch) ? res.branch : 'ILLEGAL@' + step + ':' + res.branch;
  }
  // 8 / 7：动作在 r.act
  if (res.act !== undefined) {
    const a2 = { heal: 'treat', selfsave: 'selfSave' }[res.act] || res.act;
    return okAt(step, kind, res.act) ? a2 : 'ILLEGAL@' + step + ':' + res.act;
  }
  // 2：动作在 r.mode
  if (res.mode !== undefined) {
    const m = res.mode;
    const alias = { heal: 'treat', selfsave: 'selfSave', check: 'verify', announce: 'announce' }[m] || m;
    return okAt(step, kind, m) ? alias : 'ILLEGAL@' + step + ':' + m;
  }
  // 巡逻：r.use
  if (kind === 'patrol') return res.use ? 'patrol' : 'none';
  if (kind === 'shoot') return (res.targets && res.targets.length) ? 'shoot' : 'none';
  if (kind === 'xenoKill') return (res.targets && res.targets.length) ? 'kill' : 'none';
  if (kind === 'guard') return res.target != null ? 'protect' : 'none';
  if (kind === 'lurk' || kind === 'xenoCheck') return res.target != null ? 'lurk' : 'none';
  if (kind === 'disguise') return 'disguise';
  if (kind === 'safeRoom') return res.use ? 'safeRoom' : 'none';
  if (kind === 'announce') return res.opt ? 'announce' : 'none';
  if (kind === 'meeting') return res.use ? 'meeting' : 'none';
  return 'UNMAPPED@' + step + ':' + kind;
}

const perNight = new Map();
const S = {
  games: 0, errs: 0, decisions: 0,
  acts: {}, unknown: {}, illegal: {},
  mutexNights: 0, violations: 0, samples: [],
  mxDist: {},
};
const origDecide = AI.decide;
AI.decide = function (g, req) {
  let res = null;
  try { res = origDecide.call(AI, g, req); } catch (e) { S.errs++; }
  try {
    const p = g.players.find(x => x.id === (req && req.pid));
    if (!p) return res;
    const step = (req && req.step) || g.step;
    const a = classify(step, req && req.kind, res);
    S.decisions++;
    S.acts[a] = (S.acts[a] || 0) + 1;
    if (a.indexOf('UNKNOWN') === 0 || a.indexOf('UNMAPPED') === 0 || a === 'NO_RETURN') S.unknown[a] = (S.unknown[a] || 0) + 1;
    if (a.indexOf('ILLEGAL') === 0) S.illegal[a + ' (step ' + step + '/' + (req && req.kind) + '/' + p.role + ')'] = 1;
    const key = p.role + '|' + p.id + '|' + g.night;
    if (!perNight.has(key)) perNight.set(key, { role: p.role, night: g.night, acts: [] });
    perNight.get(key).acts.push(a);
  } catch (e) { }
  return res;
};

for (let i = 0; i < N; i++) {
  perNight.clear();
  try {
    const g = SeatMode.seatGame(Setup, 1 + i);
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    Engine.begin(g);
    let k = 0;
    while (!g.over && k < 5000) {
      k++; Engine.stepOnce(g);
      if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
    }
    S.games++;
    for (const [, rec] of perNight) {
      const mx = RD.mutexOf(rec.role);
      if (!mx.length) continue;
      const used = new Set(rec.acts.filter(a => a.indexOf('UNKNOWN') < 0 && a.indexOf('UNMAPPED') < 0 && a.indexOf('ILLEGAL') < 0 && a !== 'NO_RETURN'));
      if (!used.size) continue;
      S.mutexNights++;
      const hit = [...used].filter(a => mx.indexOf(a) >= 0);
      S.mxDist[hit.length] = (S.mxDist[hit.length] || 0) + 1;
      if (hit.length >= 2) {
        S.violations++;
        if (S.samples.length < 10) S.samples.push(`${rec.role}(夜${rec.night}) 同夜用了 ${hit.length} 个互斥动作：${hit.join('+')}`);
      }
    }
  } catch (e) { S.errs++; }
}
AI.decide = origDecide;

const out = {
  games: S.games, errs: S.errs, decisions: S.decisions,
  mutexNightsChecked: S.mutexNights,
  mutexActionsPerNight: S.mxDist,
  violations: S.violations,
  violationSamples: S.samples,
  actionHistogram: S.acts,
  illegalChoices: S.illegal,
  unknownTop: Object.entries(S.unknown).sort((a, b) => b[1] - a[1]).slice(0, 8),
};
if (OUTF) fs.writeFileSync(OUTF, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));