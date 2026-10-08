const path = require('path');
const ROOT = process.argv[2];
const N = +(process.argv[3] || 120);
const { makeCtx, loadInto, profiles } = require(path.join(ROOT, 'tools', 'load-order.cjs'));
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { AI, Engine, Setup, SKData, AIBelief: BEL, Tiers } = ctx;

const X = { kh: { truth: [0, 0], fals: [0, 0] }, suspByF: { truth: [], fals: [] } };
const ev = { human: { n: 0, ev: 0, neg: 0, pos: 0 }, alien: { n: 0, ev: 0, neg: 0, pos: 0 }, xeno: { n: 0, ev: 0, neg: 0, pos: 0 } };
const suspAUC = { s: 0, n: 0 };

function sample(g) {
  for (const o of g.players) {
    if (o.out || o.faction !== 'human') continue;   // 只看人类观察者
    const al = g.players.filter(x => !x.out && x.id !== o.id);
    if (al.length < 2) continue;
    const hostileSet = new Set(['alien', 'xeno']);
    const pos = [], neg = [];
    for (const x of al) {
      const truth = hostileSet.has(x.faction);
      // kh：观察者是否已「硬源确证该目标非人类」
      const k = o.known && o.known.get(x.id);
      const rd = k && k.role && SKData.ROLES[k.role];
      const f = (x.revealed && x.revealed.faction) || (k && k.faction) || (rd && rd.faction);
      const kh = (f && f !== 'human') ? 1 : 0;
      X.kh[truth ? 'truth' : 'fals'][kh]++;

      // 证据量分组（这次标签正确：直接按目标真实阵营分桶）
      const evs = (o.tEvents && o.tEvents.get(x.id)) || [];
      let ng = 0, ps = 0;
      for (const e of evs) {
        const age = Math.max(0, g.night - e.night);
        const decay = e.kind === 'fact' ? 1 : Math.pow(e.grudge ? Tiers.GRUDGE_DECAY : Tiers.CLAIM_DECAY, age);
        if ((e.delta || 0) > 0) ng += Math.abs(e.delta) * decay; else if ((e.delta || 0) < 0) ps += Math.abs(e.delta) * decay;
      }
      const b = ev[x.faction] || (ev[x.faction] = { n: 0, ev: 0, neg: 0, pos: 0 });
      b.n++; b.ev += evs.length; b.neg += ng; b.pos += ps;

      let s = 0; try { s = AI.suspOf(g, o, x.id); } catch (e) {}
      (truth ? pos : neg).push(s);
    }
    if (pos.length && neg.length) {
      let w = 0; for (const a of pos) for (const b2 of neg) w += a > b2 ? 1 : a === b2 ? 0.5 : 0;
      suspAUC.s += w / (pos.length * neg.length); suspAUC.n++;
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

console.log('=== H2 交叉表：kh(硬源确证非人类) × 目标真实阵营 ===');
console.log('  目标是异形/外星人：kh=0 → %d 次,  kh=1 → %d 次', X.kh.truth[0], X.kh.truth[1]);
console.log('  目标是人类      ：kh=0 → %d 次,  kh=1 → %d 次', X.kh.fals[0], X.kh.fals[1]);
const tot = X.kh.truth[0] + X.kh.truth[1] + X.kh.fals[0] + X.kh.fals[1];
console.log('  硬锁覆盖率（kh=1 占比）= %.2f%%  准确率 = %s',
  100 * (X.kh.truth[1] + X.kh.fals[1]) / tot,
  (X.kh.truth[1] + X.kh.fals[1]) ? (100 * X.kh.truth[1] / (X.kh.truth[1] + X.kh.fals[1])).toFixed(2) + '%' : 'n/a');

console.log('\n=== H1 证据量按【目标真实阵营】分桶（人类观察者视角）===');
for (const k of Object.keys(ev)) {
  const b = ev[k];
  if (!b.n) continue;
  console.log('  %s 目标 %d 次　人均证据条数 %s　人均负向量 %s　人均正向量 %s',
    k.padEnd(6), b.n, (b.ev / b.n).toFixed(2), (b.neg / b.n).toFixed(2), (b.pos / b.n).toFixed(2));
}
const h = ev.human, a = ev.alien;
if (h.n && a.n) console.log('  ⇒ 人类/异形 比值：条数 %s×　负向 %s×',
  ((h.ev / h.n) / (a.ev / a.n)).toFixed(2), ((h.neg / h.n) / (a.neg / a.n)).toFixed(2));

console.log('\n=== 人类观察者的 suspOf AUC（剔除异形恒等样本后）===');
console.log('  AUC = %s  (n=%d)', (suspAUC.s / suspAUC.n).toFixed(4), suspAUC.n);