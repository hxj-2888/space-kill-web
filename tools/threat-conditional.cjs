/* 只测一件事：当观察者「确实持有判别信息」时，他对不对？
   （此前天花板被全并列样本污染，故改为条件化测量。） */
const path = require('path');
const ROOT = process.argv[2];
const N = +(process.argv[3] || 150);
const { makeCtx, loadInto, profiles } = require(path.join(ROOT, 'tools', 'load-order.cjs'));
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { AI, Engine, Setup, SKData, Tiers, AIBelief: BEL } = ctx;

const CHANRE = [['accuse',/^accuse:/],['ask',/^ask|ans|askVerify/],['king',/^king|emitKing/],
  ['expose',/^repair:|destroy:|R22|R23/],['settle',/^settle:/],['cross',/^cross|crossRole|ansCross|R12|conflict/],
  ['lock',/^locksay:|R38|privClaim|privSame|privShare/],['ballot',/^R27|R28|R29|R40|R64|promiseMiss/],
  ['deny',/^denyLie:/],['exclusion',/^excludesay:/],['grudge',/^grudge:/],['claim',/^claim:/],['quote',/^quote:/]];
const chanOf = s => { s=String(s||''); for (const [n,re] of CHANRE) if (re.test(s)) return n; return 'other'; };

const T = { hard: { s: 0, n: 0 }, check: { s: 0, n: 0 }, crew: { s: 0, n: 0 }, none: { s: 0, n: 0 } };
let PAIRN = { hard: 0, check: 0, crew: 0, none: 0 };

function sample(g) {
  for (const o of g.players) {
    if (o.out || o.faction !== 'human') continue;
    const al = g.players.filter(x => !x.out && x.id !== o.id);
    const hostileSet = new Set(['alien', 'xeno']);
    const buckets = { hard: { p: [], n: [] }, check: { p: [], n: [] }, crew: { p: [], n: [] }, none: { p: [], n: [] } };
    for (const x of al) {
      const truth = hostileSet.has(x.faction);
      const side = truth ? 'p' : 'n';

      // ① 硬源：known / revealed 锁定了非人类
      const k = o.known && o.known.get(x.id);
      const rd = k && k.role && SKData.ROLES[k.role];
      const f = (x.revealed && x.revealed.faction) || (k && k.faction) || (rd && rd.faction);
      if (f) { buckets.hard[side].push(f === 'human' ? 0 : 1); continue; }

      // ② 神探私有查验
      const cp = o.checkPool && o.checkPool.get(x.id);
      if (cp && cp.role) { const ff = SKData.ROLES[cp.role] ? SKData.ROLES[cp.role].faction : null;
        buckets.check[side].push(ff === 'human' ? 0 : 1); continue; }

      // ③ 船员双查（A13 验证式）
      const cc = o.crewChecks && o.crewChecks.get(x.id);
      if (cc && cc.results && cc.results.length) { const yes = cc.results.filter(r => r.ans);
        if (yes.length) { const last = yes[yes.length-1].id; const ff = SKData.ROLES[last] ? SKData.ROLES[last].faction : null;
          buckets.crew[side].push(ff === 'human' ? 0 : 1); continue; }
        buckets.crew[side].push(0.5); continue; }

      // ④ 无任何私有判别信息 —— 用 A7 口径看它还剩多少
      const evs = (o.tEvents && o.tEvents.get(x.id)) || [];
      let rest = 0;
      for (const e of evs) {
        if ((e.delta || 0) <= 0) continue;
        const c = chanOf(e.src); if (c === 'ask' || c === 'accuse') continue;
        const age = Math.max(0, g.night - e.night);
        const decay = e.kind === 'fact' ? 1 : Math.pow(e.grudge ? Tiers.GRUDGE_DECAY : Tiers.CLAIM_DECAY, age);
        rest += Math.abs(e.delta) * decay;
      }
      buckets.none[side].push(rest);
    }
    for (const key of Object.keys(buckets)) {
      const b = buckets[key];
      if (!b.p.length || !b.n.length) continue;
      PAIRN[key] += b.p.length + b.n.length;
      let w = 0; for (const a of b.p) for (const c of b.n) w += a > c ? 1 : a === c ? 0.5 : 0;
      T[key].s += w / (b.p.length * b.n.length); T[key].n++;
    }
  }
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

console.log('=== 条件化判别力：「观察者真正持有判别信息时，他对不对？」%d 局 ===\n', N);
const LBL = { hard: '硬源（known/revealed 锁定）', check: '神探私有查验池', crew: '船员双查 A13', none: '无私有信息 · 用 A7 口径' };
for (const k of ['hard', 'check', 'crew', 'none']) {
  if (!T[k].n) { console.log('  ' + LBL[k].padEnd(26) + ' 样本不足'); continue; }
  const a = T[k].s / T[k].n;
  const bar = (a >= 0.5 ? '+' : '-').repeat(Math.min(40, Math.round(Math.abs(a - 0.5) * 100)));
  console.log('  ' + LBL[k].padEnd(26) + ' AUC=' + a.toFixed(4) + '  ' + bar
    + '   覆盖对数=' + PAIRN[k]);
}
console.log('\n  读法：硬源与私有查验应当接近 1.0（那是规则背书的真值）；');
console.log('        「无私有信息」一栏衡量的是纯软证据还剩多少判别力。');