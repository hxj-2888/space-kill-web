/* 临时：验证公开指控（威胁度）是否真实影响投票——统计被驱逐者的威胁度分布。
   v26 修复：加载列表停留在 v21 之前（只有 rng/data/state/ai/engine）——
   ai.js 自 v22 起依赖 Tiers（档位分值表），缺 tiers.js 会直接 `Cannot read properties of
   undefined (reading 'SCORE')` 崩掉，本工具因此长期失效。
   v33 修复（复审 O3）：v26 的手写清单仍缺 infer/registry（moe.js 读 global.MoERegistry
   即崩，且注释一度失实地声称已修）——现彻底废弃手写清单，改用 tools/load-order.cjs
   唯一真源（与 mc.cjs 同一份 profiles.full），此后新增文件只改 load-order 一处。 */
const path = require('path');
const { makeCtx, loadInto, profiles } = require('./load-order.cjs');
const base = path.join(__dirname, '..', 'js');
const ctx = makeCtx({ RegExp });
loadInto(ctx, base, profiles.full);
const { Setup, Engine } = ctx;

let evHeat = [], survHeat = [], accusals = 0, games = 120;
/* v26：改看【排名】而不是均值——均值会被幸存者偏差污染（异形活得久 → 存活池里敌方差值占比更高，
   「存活者热度更高」是结构性的，不代表投票没跟着证据走）。排名口径直接回答：
   被驱逐者在【投票前的共识热度榜】上排第几？随机基线 ≈ 1/N 与 3/N。 */
let rankTop1 = 0, rankTop3 = 0, evRanked = 0;
const rankHist = {};
for (let i = 0; i < games; i++) {
  const g = Setup.createGame(31337 + i, 'random');
  g.humanId = -1;
  Engine.begin(g);
  let n = 0;
  while (!g.over && n < 4000) {
    const before = g.players.filter(p => p.out && p.outType === 'vote').length;
    const heatBefore = { ...g.threat };
    Engine.stepOnce(g);
    if (Engine.pendingCount(g)) {
      const pid = +Object.keys(g.pendings)[0];
      Engine.setDecisionFor(g, pid, { targets: [], opt: null, num: null, text: '' });
      Engine.finishIfReady(g);
    }
    /* v26：威胁度增量只统计【前后都存在】的席位——旧写法用两个快照的总和相减，
       出局者条目消失会把总和拉低（实测累计增量 -39041，指标本身失效）。 */
    for (const k of Object.keys(g.threat || {})) if (heatBefore[k] != null) accusals += g.threat[k] - heatBefore[k];
    const after = g.players.filter(p => p.out && p.outType === 'vote');
    if (after.length > before) {
      const ev = after[after.length - 1];
      /* v26：读【投票前】的共识威胁度——旧写法读投票后的 g.threat，而被驱逐者已不在存活表里，
         取到的是 0，导致「被驱逐者热度低于存活者」的假结论（28.55 vs 30.73）。 */
      evHeat.push(heatBefore[ev.id] || 0);
      for (const p of g.players) if (!p.out) survHeat.push(heatBefore[p.id] || 0);
      survHeat = survHeat.slice(-40);            // 只取同期存活者样本
      /* 排名口径：heatBefore 是投票前的存活者热度快照 */
      const list = Object.keys(heatBefore).map(k => ({ id: +k, h: heatBefore[k] }))
        .sort((x, y) => y.h - x.h);
      const r = list.findIndex(x => x.id === ev.id) + 1;
      if (r > 0) {
        evRanked++;
        rankHist[r] = (rankHist[r] || 0) + 1;
        if (r === 1) rankTop1++;
        if (r <= 3) rankTop3++;
      }
    }
    n++;
  }
}
const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : '0';
console.log(`对局 ${games}，累计威胁度增量 ${accusals}（指控确实在发生）`);
console.log(`被驱逐者威胁度均值: ${avg(evHeat)}   同期未出局者威胁度均值: ${avg(survHeat)}`);
console.log(`被驱逐者威胁度>0 占比: ${evHeat.length ? (evHeat.filter(h => h > 0).length / evHeat.length * 100).toFixed(0) + '%' : '—'}`);
if (evRanked) {
  console.log(`投票前共识热度榜名次：被驱逐者中排名第 1 占 ${(100 * rankTop1 / evRanked).toFixed(1)}%` +
    ` · 前三占 ${(100 * rankTop3 / evRanked).toFixed(1)}%（随机基线约 ${(100 / 7).toFixed(0)}% / ${(300 / 7).toFixed(0)}%，按 7 人存活估）`);
  console.log(`名次分布: ${JSON.stringify(rankHist)}`);
}
console.log(`注：均值受幸存者偏差影响（敌形存活更久 → 存活池热度更高），以名次口径为准。`);
