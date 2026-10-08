/* ============================================================================
 * 收官：A7 口径的种子隔离验证 + 「合法信息天花板」测量
 * ----------------------------------------------------------------------------
 * 铁律四（种子隔离）：调试集与验证集不重叠，标定集不得复用。
 * 铁律一（指标只读）：本探针不设健康区间，只报读数与稳定性。
 *
 * 用法：node threat-validate.cjs <项目根> <起始种子> <局数>
 * ==========================================================================*/
'use strict';
const path = require('path');
const ROOT = process.argv[2];
const SEED0 = +(process.argv[3] || 1);
const N = +(process.argv[4] || 120);
const { makeCtx, loadInto, profiles } = require(path.join(ROOT, 'tools', 'load-order.cjs'));
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { AI, Engine, Setup, Tiers, SKData, AIBelief: BEL } = ctx;

const CHANRE = [
  ['accuse', /^accuse:/], ['ask', /^ask|ans|askVerify/], ['quote', /^quote/],
  ['claim', /^claim:/], ['lock', /^locksay:|R38|privClaim|privSame|privShare/],
  ['exclusion', /^excludesay:/], ['deny', /^denyLie:/], ['expose', /^repair:|destroy:|R22|R23/],
  ['settle', /^settle:/], ['grudge', /^grudge:/], ['rescue', /^rescue:/],
  ['cross', /^cross|crossRole|ansCross|R12|conflict/], ['ballot', /^R27|R28|R29|R40|R64|promiseMiss/],
  ['king', /^king|emitKing/], ['chan', /^chan:/], ['private', /^pm:|priv/],
];
const chanOf = s => { s = String(s || ''); for (const [n, re] of CHANRE) if (re.test(s)) return n; return 'other'; };

const GROUPS = [];
let CEIL = { s: 0, n: 0 };   // 合法信息天花板
let COVER = { hard: 0, total: 0, detPub: 0, detPubWithInfo: 0, games: 0 };

function sample(g) {
  const talk = {};
  for (const x of g.players) {
    if (x.out) continue;
    let t = (x.accuseHistory || []).length + (x.askHistory || []).length + (x.claims || []).length;
    for (const o of g.players) { if (o.out || o.id === x.id) continue; t += ((o.tEvents && o.tEvents.get(x.id)) || []).length; }
    talk[x.id] = t;
  }
  for (const o of g.players) {
    if (o.out || o.faction !== 'human') continue;
    const al = g.players.filter(x => !x.out && x.id !== o.id);
    if (al.length < 2) continue;
    const hostileSet = new Set(['alien', 'xeno']);
    const pos = [], neg = [], cpos = [], cneg = [];
    for (const x of al) {
      const evs = (o.tEvents && o.tEvents.get(x.id)) || [];
      const b = {}; let rest = 0, hard = 0;
      for (const e of evs) {
        if ((e.delta || 0) <= 0) continue;
        const age = Math.max(0, g.night - e.night);
        const decay = e.kind === 'fact' ? 1 : Math.pow(e.grudge ? Tiers.GRUDGE_DECAY : Tiers.CLAIM_DECAY, age);
        const cs = (e.tier && e.tier[0] === 'D') ? (0.4 + 0.6 * BEL.credOf(o, e.spk || x.id)) : 1;
        const amt = Math.abs(e.delta) * decay * cs;
        const c = chanOf(e.src); b[c] = (b[c] || 0) + amt;
        if (c !== 'ask' && c !== 'accuse') rest += amt;
        const sc = Tiers.SCORE[e.tier] || 0;
        if (sc >= 20) hard += amt;
      }
      // 天花板：观察者合法持有的全部私有信息（查验池 + 双查 + 已知 + 记忆）
      let ceil = 0;
      try {
        if (o.checkPool && o.checkPool.get(x.id)) { const r = o.checkPool.get(x.id); const f = SKData.ROLES[r.role] ? SKData.ROLES[r.role].faction : null; if (f && f !== 'human') ceil += 100; }
        const cc = o.crewChecks && o.crewChecks.get(x.id);
        if (cc && cc.results) { const yes = cc.results.filter(r => r.ans); if (yes.length) { const f = SKData.ROLES[yes[yes.length-1].id] ? SKData.ROLES[yes[yes.length-1].id].faction : null; if (f === 'human') ceil -= 100; } }
      } catch (e) {}
      try {
        const k = o.known && o.known.get(x.id);
        const rd = k && k.role && SKData.ROLES[k.role];
        const f = (x.revealed && x.revealed.faction) || (k && k.faction) || (rd && rd.faction);
        if (f && f !== 'human') ceil += 1000;
        COVER.hard++; COVER.total++;
      } catch (e) {}
      const row = { rest, talk: talk[x.id] || 0, ceil, hard };
      (hostileSet.has(x.faction) ? pos : neg).push(row);
      (hostileSet.has(x.faction) ? cpos : cneg).push(row);
    }
    if (!pos.length || !neg.length) continue;
    GROUPS.push({ pos, neg });
    if (cpos.length && cneg.length) {
      let w = 0;
      for (const a of cpos) for (const b of cneg) w += a.ceil > b.ceil ? 1 : a.ceil === b.ceil ? 0.5 : 0;
      CEIL.s += w / (cpos.length * cneg.length); CEIL.n++;
    }
  }
}

for (let i = 0; i < N; i++) {
  const g = Setup.createGame(SEED0 + i, 'random');
  g.humans = []; g.humanId = -1; for (const p of g.players) p.isHuman = false;
  COVER.games++;
  Engine.begin(g);
  let steps = 0;
  while (!g.over && steps < 5000) {
    steps++; Engine.stepOnce(g);
    if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
    if (g.step === '9' || g.step === 'D-vote' || g.step === 'M-vote') sample(g);
  }
  for (const p of g.players) if (p.role === 'detective' && !p.out) { COVER.detPub++; if ((p.checkPool && p.checkPool.size) > 0) COVER.detPubWithInfo++; }
}

function aucOf(get) {
  let s = 0, n = 0;
  for (const g of GROUPS) {
    const P = g.pos.map(get), Nn = g.neg.map(get);
    if (!P.length || !Nn.length) continue;
    let w = 0; for (const a of P) for (const b of Nn) w += a > b ? 1 : a === b ? 0.5 : 0;
    s += w / (P.length * Nn.length); n++;
  }
  return n ? s / n : NaN;
}

const a7 = aucOf(r => r.rest / (1 + r.talk));
const a0 = aucOf(r => r.rest);
console.log(`=== 种子集 [${SEED0}, ${SEED0 + N - 1}]　${N} 局　${GROUPS.length} 观察者组 ===`);
console.log('  A7 口径（剔除 ask+accuse，再除以可见度）  AUC = ' + a7.toFixed(4));
console.log('  A1 口径（剔除 ask+accuse，不去偏）        AUC = ' + a0.toFixed(4));
console.log('  合法信息天花板（查验+双查+已知，真值口径） AUC = ' + (CEIL.n ? (CEIL.s / CEIL.n).toFixed(4) : 'NaN'));
console.log('\n  硬源覆盖率 = ' + (100 * COVER.hard / Math.max(1, COVER.total)).toFixed(2) + '%');
console.log('  神探存活时持有查验结果的局 = ' + COVER.detPubWithInfo + ' / ' + COVER.detPub);