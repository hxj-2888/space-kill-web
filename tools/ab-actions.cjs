'use strict';
/* 动作层对照：确认胜率变化不是「异形停摆」造成的。
   分别统计两类阵营的**实际执行动作**与决策产出。 */
const fs = require('fs');
const path = require('path');

function loadOrder(root) {
  const src = fs.readFileSync(path.join(root, 'tools', 'load-order.cjs'), 'utf8');
  const m = { exports: {} };
  new Function('require', 'module', 'exports', '__dirname', '__filename', src)(
    require, m, m.exports, path.join(root, 'tools'), 'x');
  return m.exports;
}

function run(root, N, SEED0) {
  const { makeCtx, loadInto, profiles } = loadOrder(root);
  const ctx = makeCtx({ RegExp });
  loadInto(ctx, path.join(root, 'js'), profiles.full);
  const { Setup, Engine, AI } = ctx;

  const st = {
    games: 0, errs: 0,
    reqSab: 0, sabDone: 0, reqKill: 0, killDone: 0,
    reqAny: 0, actNonEmpty: 0,
    votesCast: 0, humanVotes: 0, alienVotes: 0,
    aliensEliminated: 0, humansEliminated: 0,
  };

  for (let i = 0; i < N; i++) {
    const seed = SEED0 + i;
    try {
      const g = Setup.createGame(seed, 'random');
      g.humans = []; g.humanId = -1;
      for (const p of g.players) p.isHuman = false;

      // 包一层 decide，统计异形/人类的决策产出
      const rawDecide = AI.decide;
      AI.decide = function (gg, req) {
        st.reqAny++;
        let r;
        try { r = rawDecide.call(AI, gg, req); } catch (e) { r = null; }
        if (r && (r.act || (r.targets && r.targets.length))) {
          st.actNonEmpty++;
          const me = gg.players.find(p => p.id === (req && req.pid));
          if (me && me.faction === 'alien') {
            if (/destroy|sabotage|破坏/.test(String(r.mode || r.act || ''))) st.reqSab++;
            if (/kill|infect|刺杀/.test(String(r.mode || r.act || ''))) st.reqKill++;
          }
        }
        if (req && req.kind === 'vote' && r && r.vote != null) {
          const me = gg.players.find(p => p.id === req.pid);
          if (me && me.faction === 'alien') st.alienVotes++;
          else st.humanVotes++;
        }
        return r;
      };

      Engine.begin(g);
      let steps = 0;
      while (!g.over && steps < 5000) {
        steps++;
        Engine.stepOnce(g);
        if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
      }
      AI.decide = rawDecide;
      st.games++;
      for (const p of g.players) {
        if (!p.out) continue;
        if (p.faction === 'alien') st.aliensEliminated++;
        else if (p.faction === 'human') st.humansEliminated++;
      }
    } catch (e) { st.errs++; }
  }
  return st;
}

const N = parseInt(process.argv[4] || '120', 10);
const S0 = parseInt(process.argv[5] || '1', 10);
const A = run(process.argv[2], N, S0);
const B = run(process.argv[3], N, S0);
const per = (v, k) => (k ? (v / k).toFixed(2) : '—');

console.log('\n=== 动作层对照（每局均值，N=' + N + '）===');
console.log('  ' + '指标'.padEnd(28) + '基线'.padStart(10) + '  ' + '拆除后'.padStart(10) + '     Δ');
console.log('  ' + '-'.repeat(58));
const row = (k, a, b) => {
  const d = b - a;
  console.log('  ' + k.padEnd(26) + per(a, N).padStart(10) + '  ' + per(b, N).padStart(10)
    + '   ' + (d > 0 ? '+' : '') + d.toFixed(2));
};
row('完成局数', A.games, B.games);
row('异常局数', A.errs, B.errs);
row('decide 调用', A.reqAny, B.reqAny);
row('非空决策', A.actNonEmpty, B.actNonEmpty);
row('异形破坏决策', A.reqSab, B.reqSab);
row('异形击杀决策', A.reqKill, B.reqKill);
row('异形投票', A.alienVotes, B.alienVotes);
row('人类投票', A.humanVotes, B.humanVotes);
row('异形被淘汰', A.aliensEliminated, B.aliensEliminated);
row('人类被淘汰', A.humansEliminated, B.humansEliminated);
fs.writeFileSync('C:/Users/ASUS/AppData/Local/Temp/opencode/ab-actions.json', JSON.stringify({ A, B }, null, 1));