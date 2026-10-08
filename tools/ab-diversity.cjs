/* ⚠〔v7 侦察 · 2026-10-08〕口径缺陷标注：本探针的 humanHitPct 分母用了 accN（**全部**有效票，
   含异形票），而语义应是「人类票」。故其绝对值被系统性缩小为正确值的约 0.725 倍
   （基线 27.4% vs 正确 37.8%；B0 后 41.2% vs 正确 56.5%）。
   正确口径见 tools/scout.cjs（vote.humanHitPct，分母 humanVoteN）。
   本探针保留仅为 B3 的同种子 A/B 复用；引用其 humanHitPct 时必须先除以人类票占比。 */
'use strict';
/* 胜率跃变的退化性检查：72.5% 的人类胜率若来自「所有人类投同一个人」则投票多样性塌缩。
   投票记录在 g.voteHistory = [{night, round, src:{voterId: targetId}}]。 */
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
  const { Setup, Engine } = ctx;

  const st = {
    games: 0, rounds: 0, seats: 0,
    distinctSum: 0, maxShareSum: 0, oneTargetRounds: 0,
    humanRounds: 0, humanDistinctSum: 0, humanMaxShareSum: 0, accHumanHit: 0, accAllyHit: 0, accAlienHit: 0,
    accCorrectSum: 0, accN: 0,
  };

  for (let i = 0; i < N; i++) {
    const seed = SEED0 + i;
    try {
      const g = Setup.createGame(seed, 'random');
      g.humans = []; g.humanId = -1;
      for (const p of g.players) p.isHuman = false;
      Engine.begin(g);
      let steps = 0;
      while (!g.over && steps < 5000) {
        steps++;
        Engine.stepOnce(g);
        if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
      }
      st.games++;
      for (const rec of (g.voteHistory || [])) {
        const src = rec.src || {};
        const ids = Object.keys(src);
        if (!ids.length) continue;
        st.rounds++;
        st.seats += ids.length;

        const tally = {};
        for (const v of ids) {
          const t = src[v];
          if (t == null) continue;
          tally[t] = (tally[t] || 0) + 1;
        }
        const tot = Object.values(tally).reduce((a, b) => a + b, 0);
        if (!tot) continue;
        st.distinctSum += Object.keys(tally).length;
        st.maxShareSum += Math.max(...Object.values(tally)) / tot;
        if (Object.keys(tally).length === 1) st.oneTargetRounds++;

        /* 只看人类阵营选民的票（src 的键是字符串，p.id 是数字 —— 必须 Number() 归一） */
        const ht = {};
        for (const v of ids) {
          const p = g.players.find(x => x.id === Number(v));
          if (!p || p.faction !== 'human') continue;
          const t = src[v];
          if (t == null) continue;
          ht[t] = (ht[t] || 0) + 1;
        }
        const htot = Object.values(ht).reduce((a, b) => a + b, 0);
        if (htot >= 2) {
          st.humanRounds++;
          st.humanDistinctSum += Object.keys(ht).length;
          st.humanMaxShareSum += Math.max(...Object.values(ht)) / htot;
        }

        /* 投票精度：选民阵营 → 目标阵营（全部有效票都计入分母，不再是恒真指标） */
        for (const v of ids) {
          const t = src[v];
          if (t == null) continue;
          const vp = g.players.find(x => x.id === Number(v));
          const tp = g.players.find(x => x.id === t);
          if (!vp || !tp) continue;
          st.accN++;
          if (vp.faction === 'human' && (tp.faction === 'alien' || tp.faction === 'xeno')) st.accHumanHit++;
          if (vp.faction !== 'human' && vp.faction === tp.faction) st.accAllyHit++;
          if (vp.faction !== 'human' && (tp.faction === 'alien' || tp.faction === 'xeno')
              && !(vp.faction === 'alien' && tp.faction === 'xeno')) st.accAlienHit++;
        }
      }
    } catch (e) { }
  }
  return st;
}

const N = parseInt(process.argv[4] || '120', 10);
const S0 = parseInt(process.argv[5] || '1', 10);
const A = run(process.argv[2], N, S0);
const B = run(process.argv[3], N, S0);
const dv = (s, n) => (n ? s / n : 0);
const pc = x => (100 * x).toFixed(1) + '%';

console.log('\n=== 投票多样性与精度（N=' + N + ' 局）===');
console.log('  ' + '指标'.padEnd(32) + '基线'.padStart(11) + '  ' + '拆除后'.padStart(11));
console.log('  ' + '-'.repeat(58));
const row = (k, f) => console.log('  ' + k.padEnd(30) + String(f(A)).padStart(11) + '  ' + String(f(B)).padStart(11));
row('投票轮次', s => s.rounds);
row('每轮不同被投目标数（全体）', s => dv(s.distinctSum, s.rounds).toFixed(2));
row('最高票目标占比（全体）', s => pc(dv(s.maxShareSum, s.rounds)));
row('全票指向同一目标轮次', s => pc(dv(s.oneTargetRounds, s.rounds)));
row('人类选民的投票轮次', s => s.humanRounds);
row('· 每轮不同被投目标数', s => dv(s.humanDistinctSum, s.humanRounds).toFixed(2));
row('· 最高票目标占比', s => pc(dv(s.humanMaxShareSum, s.humanRounds)));
row('· 人类票命中敌对阵营比例', s => pc(s.accHumanHit / (s.accN || 1)));
row('异形票投人类比例', s => pc(s.accAllyHit / (s.accN || 1)));
row('异形票投异形或外星人比例', s => pc(s.accAlienHit / (s.accN || 1)));
row('有效票样本数', s => s.accN);
fs.writeFileSync('C:/Users/ASUS/AppData/Local/Temp/opencode/ab-diversity.json', JSON.stringify({ A, B }, null, 1));
console.log('\n  原始计数已存 ab-diversity.json');