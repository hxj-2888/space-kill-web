const path = require('path');
const ROOT = process.argv[2];
const N = +(process.argv[3] || 200);
const { makeCtx, loadInto, profiles } = require(path.join(ROOT, 'tools', 'load-order.cjs'));
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { AI, Engine, Setup } = ctx;

function aucOf(g, getter) {
  let sum = 0, n = 0;
  for (const o of g.players) {
    if (o.out) continue;
    const al = g.players.filter(x => !x.out && x.id !== o.id);
    const hostileSet = new Set(o.faction === 'alien' ? ['human', 'xeno'] : o.faction === 'xeno' ? ['alien'] : ['alien', 'xeno']);
    const pos = [], neg = [];
    for (const x of al) { let d; try { d = getter(g, o, x.id); } catch (e) { continue; } (hostileSet.has(x.faction) ? pos : neg).push(d); }
    if (!pos.length || !neg.length) continue;
    let w = 0; for (const a of pos) for (const b of neg) w += a > b ? 1 : a === b ? 0.5 : 0;
    sum += w / (pos.length * neg.length); n++;
  }
  return { a: n ? sum / n : NaN, n };
}

const agg = { danger: { s: 0, n: 0 }, susp: { s: 0, n: 0 }, act: { s: 0, n: 0 } };
const per = {};
for (let seed = 1; seed <= N; seed++) {
  const g = Setup.createGame(seed, 'random');
  g.humans = []; g.humanId = -1; for (const p of g.players) p.isHuman = false;
  Engine.begin(g);
  let steps = 0;
  while (!g.over && steps < 5000) {
    steps++; Engine.stepOnce(g);
    if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
    if (g.step !== '9' && g.step !== 'M-vote' && g.step !== 'D-vote') continue;
    for (const [k, fn] of [['danger', AI.dangerOf], ['susp', AI.suspOf], ['act', (gg, o, id) => AI.dangerOf(gg, o, id)]]) {
      const r = aucOf(g, fn);
      if (isFinite(r.a)) { agg[k].s += r.a; agg[k].n++; }
    }
    // 人类观察者单独看 suspicion 层
    for (const o of g.players) {
      if (o.out || o.faction !== 'human') continue;
      const r = aucOf({ players: [o].concat(g.players.filter(x => x !== o)) }, AI.suspOf);
      void r;
    }
  }
}
console.log('=== 三层判别力 AUC（200 局，每夜/每投票轮采样）===');
for (const k of ['susp', 'danger', 'act']) {
  const a = agg[k];
  console.log('  %s'.padEnd(8), 'AUC =', a.n ? (a.s / a.n).toFixed(4) : 'NaN', ' (n=' + a.n + ')');
}
console.log('\n  0.5 = 完全随机；>0.5 会识别威胁；<0.5 系统性反着来');
console.log('  注意 alien 观察者 AUC 恒为 1.0（队友由硬源确认为己方 → hostile=0 钳制归零），');
console.log('        属结构性恒等，不是推理能力，故上面按全体平均会掩盖人类的真实读数。');