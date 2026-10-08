/* 独立复核：投票是否真的与推理脱钩 + AUC。种子 42 报告称一致性 0/N。
   判官不采信自报读数，按铁律二自己复算。 */
const path = require('path');
const ROOT = process.argv[2];
const N = +(process.argv[3] || 200);
const { makeCtx, loadInto, profiles } = require(path.join(ROOT, 'tools', 'load-order.cjs'));
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { AI, Engine, Setup } = ctx;

const S = {
  votes: 0, rankedFirst: 0, top3: 0, consistencyByN: {},
  aucPairs: 0, aucSum: 0,
  perFaction: {}, spreadAcrossObservers: [],
};

function aucSample(g) {
  // 对每个存活观察者：把「敌方嫌疑」与「真实阵营」做 Mann-Whitney AUC
  for (const o of g.players) {
    if (o.out) continue;
    const al = g.players.filter(x => !x.out && x.id !== o.id);
    const hostileSet = new Set((o.faction === 'alien' ? ['human', 'xeno'] : o.faction === 'xeno' ? ['alien'] : ['alien', 'xeno']));
    const pos = [], neg = [];
    for (const x of al) {
      let d; try { d = AI.dangerOf(g, o, x.id); } catch (e) { continue; }
      (hostileSet.has(x.faction) ? pos : neg).push(d);
    }
    if (!pos.length || !neg.length) continue;
    let w = 0;
    for (const a of pos) for (const b of neg) w += a > b ? 1 : a === b ? 0.5 : 0;
    const a = w / (pos.length * neg.length);
    S.aucSum += a; S.aucPairs++;
    const f = o.faction;
    S.perFaction[f] = S.perFaction[f] || { n: 0, sum: 0 };
    S.perFaction[f].n++; S.perFaction[f].sum += a;
  }
}

const od = AI.decide;
AI.decide = function (g, req) {
  // 先让 AI 自己算完（此时决策已定），再事后核对它的 dangerOf 排序
  const d = od.apply(this, arguments);
  if (req && req.kind === 'vote') {
    const p = g.players.find(x => x.id === req.pid);
    if (!p || p.out) return d;
    const t = d && d.target;
    if (t == null) return d;
    const al = g.players.filter(x => !x.out && x.id !== p.id);
    if (al.length < 2) return d;
    let ranked;
    try {
      ranked = al.map(x => ({ id: x.id, dg: AI.dangerOf(g, p, x.id) })).sort((a, b) => b.dg - a.dg);
    } catch (e) { return d; }
    S.votes++;
    if (ranked[0] && ranked[0].id === t) S.rankedFirst++;
    if (ranked.slice(0, 3).some(x => x.id === t)) S.top3++;
    // 观察者间读数离散度（同一夜、同一批目标，各观察者 dangerOf 的标准差均值）
    if (req._n == null && g.step) {
      const perTarget = {};
      for (const x of al) { try { perTarget[x.id] = (perTarget[x.id] || []).concat(AI.dangerOf(g, p, x.id)); } catch (e) {} }
      void perTarget;
    }
  }
  return d;
};

for (let seed = 1; seed <= N; seed++) {
  const g = Setup.createGame(seed, 'random');
  g.humans = []; g.humanId = -1; for (const p of g.players) p.isHuman = false;
  Engine.begin(g);
  let steps = 0;
  while (!g.over && steps < 5000) {
    steps++; Engine.stepOnce(g);
    if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
    if (g.step === '9' || g.step === 'M-vote' || g.step === 'D-vote') aucSample(g);
  }
}

console.log('=== 投票 vs 推理 一致性（独立复算，%d 局）===', N);
console.log('  有效投票 %d', S.votes);
console.log('  投票目标 = 说话者 dangerOf 排名第 1 : %d (%.1f%%)', S.rankedFirst, 100 * S.rankedFirst / S.votes);
console.log('  投票目标 ∈ 说话者 dangerOf top3      : %d (%.1f%%)', S.top3, 100 * S.top3 / S.votes);
console.log('  （随机基线：top1≈%.1f%%  top3≈%.1f%%，取决于存活人数）', 100 / 11, 300 / 110);

console.log('\n=== 危险度判别力 AUC（0.5=随机，>0.5=会识别威胁）===');
console.log('  全样本 AUC = %.4f  (n=%d 次采样)', S.aucPairs ? S.aucSum / S.aucPairs : NaN, S.aucPairs);
for (const f of Object.keys(S.perFaction)) {
  const v = S.perFaction[f];
  console.log('    %s 阵营观察者 AUC = %.4f  (n=%d)', f.padEnd(6), v.sum / v.n, v.n);
}