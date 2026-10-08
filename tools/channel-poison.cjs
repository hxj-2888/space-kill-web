/* ============================================================================
 * 通道级投毒溯源：把证据按来源通道拆开，逐类算判别力。
 * 目标：找出「哪些通道在把证据量推向"人类"」——即哪些必须从怀疑度里消除。
 *
 * 方法：对每个通道 c，构造两个指标并测 AUC：
 *   only(c)  = 只用通道 c 的负向量
 *   drop(c)  = 用全部通道但剔除 c 之后的负向量
 * 若 drop(c) 的 AUC 明显高于全量 ⇒ 通道 c 是投毒源。
 * 只读。用法：node channel-poison.cjs <项目根> [局数]
 * ==========================================================================*/
'use strict';
const path = require('path');
const ROOT = process.argv[2];
const N = +(process.argv[3] || 120);
const { makeCtx, loadInto, profiles } = require(path.join(ROOT, 'tools', 'load-order.cjs'));
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { AI, Engine, Setup, Tiers, AIBelief: BEL } = ctx;

/* 通道分类：按 src 前缀归族（对齐 perceive.js 的 evtFamilyOf 思路，但更细） */
const CHAN = [
  ['accuse',  /^accuse:/],
  ['ask',     /^ask|ans|askVerify/],
  ['quote',   /^quote/],
  ['claim',   /^claim:/],
  ['lock',    /^locksay:|R38|privClaim|privSame|privShare/],
  ['exclusion', /^excludesay:/],
  ['deny',    /^denyLie:/],
  ['expose',  /^repair:|destroy:|R22|R23/],
  ['settle',  /^settle:/],
  ['grudge',  /^grudge:/],
  ['rescue',  /^rescue:/],
  ['cross',   /^cross|crossRole|ansCross|R12|conflict/],
  ['ballot',  /^R27|R28|R29|R40|R64|promiseMiss|chan:.*ballot/],
  ['king',    /^king|emitKing/],
  ['chan',    /^chan:/],
  ['private', /^pm:|priv/],
  ['other',   /.*/],
];
function chanOf(src) {
  const s = String(src || '');
  for (const [name, re] of CHAN) if (re.test(s)) return name;
  return 'other';
}

/* 收集：每个观察者-目标对，按通道分桶的负向量 */
const PAIR = [];   // { truth, buckets: {chan: mass}, all: mass }
let NEG_ALL = 0;

function sample(g) {
  for (const o of g.players) {
    if (o.out || o.faction !== 'human') continue;      // 人类观察者（异形视角是结构性恒等，无参考价值）
    const al = g.players.filter(x => !x.out && x.id !== o.id);
    if (al.length < 2) continue;
    const hostileSet = new Set(['alien', 'xeno']);
    const pos = [], neg = [];
    for (const x of al) {
      const evs = (o.tEvents && o.tEvents.get(x.id)) || [];
      const b = {};
      let all = 0;
      for (const e of evs) {
        if ((e.delta || 0) <= 0) continue;              // 只看负向（指向敌方）
        const age = Math.max(0, g.night - e.night);
        const decay = e.kind === 'fact' ? 1 : Math.pow(e.grudge ? Tiers.GRUDGE_DECAY : Tiers.CLAIM_DECAY, age);
        const cscale = (e.tier && e.tier[0] === 'D') ? (0.4 + 0.6 * BEL.credOf(o, e.spk || x.id)) : 1;
        const amt = Math.abs(e.delta) * decay * cscale;
        const c = chanOf(e.src);
        b[c] = (b[c] || 0) + amt;
        all += amt;
      }
      NEG_ALL += all;
      (hostileSet.has(x.faction) ? pos : neg).push({ b, all });
    }
    if (!pos.length || !neg.length) continue;
    PAIR.push({ pos, neg });
  }
}

function aucOf(get) {
  let s = 0, n = 0;
  for (const g of PAIR) {
    const P = g.pos.map(get), N = g.neg.map(get);
    if (!P.length || !N.length) continue;
    let w = 0;
    for (const a of P) for (const b of N) w += a > b ? 1 : a === b ? 0.5 : 0;
    s += w / (P.length * N.length); n++;
  }
  return n ? s / n : NaN;
}

for (let seed = 1; seed <= N; seed++) {
  const g = Setup.createGame(seed, 'random');
  g.humans = []; g.humanId = -1; for (const p of g.players) p.isHuman = false;
  Engine.begin(g);
  let steps = 0;
  while (!g.over && steps < 5000) {
    steps++; Engine.stepOnce(g);
    if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
    if (g.step === '9' || g.step === 'D-vote' || g.step === 'M-vote') sample(g);
  }
}

console.log('=== 通道级投毒溯源（%d 局，%d 个观察者组，全量负向量 %s）===\n', N, PAIR.length, NEG_ALL.toFixed(0));
const base = aucOf(r => r.all);
console.log('  【基线】全部通道合计负向量        AUC = ' + base.toFixed(4) + (base < 0.5 ? '   ← 当前是反向的' : ''));

console.log('\n  ── only(c)：只用该通道 ──');
const onlyRows = CHAN.map(([name]) => ({ name, a: aucOf(r => r.b[name] || 0), mass: PAIR.reduce((a, g) => a + g.pos.concat(g.neg).reduce((x, r) => x + (r.b[name] || 0), 0), 0) }));
for (const r of onlyRows) if (r.mass > 0) console.log('    ' + r.name.padEnd(10) + ' AUC=' + r.a.toFixed(4) + '  质量=' + r.mass.toFixed(0));

console.log('\n  ── drop(c)：剔除该通道后（若上升 ⇒ 该通道投毒）──');
const dropRows = CHAN.map(([name]) => {
  const a = aucOf(r => { let s = 0; for (const k of Object.keys(r.b)) if (k !== name) s += r.b[k]; return s; });
  return { name, a, delta: a - base, mass: PAIR.reduce((a, g) => a + g.pos.concat(g.neg).reduce((x, r) => x + (r.b[name] || 0), 0), 0) };
}).filter(r => r.mass > 0).sort((x, y) => y.delta - x.delta);
for (const r of dropRows) {
  const arrow = r.delta > 0.005 ? '  ↑ 剔除后变好 ⇒ 投毒源' : (r.delta < -0.005 ? '  ↓ 剔除后变差 ⇒ 有用' : '  ＝ 中性');
  console.log('    ' + r.name.padEnd(10) + ' AUC=' + r.a.toFixed(4) + '  Δ=' + (r.delta >= 0 ? '+' : '') + r.delta.toFixed(4) + arrow);
}