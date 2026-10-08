'use strict';
/* 基线 vs 拆除后 的独立对照（同一组种子、同一驱动口径）。
   目的：B0 不是行为中性改造，必须诚实报告指标变化（治理规范铁律四/五）。 */
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
    games: 0, errs: 0, winners: {}, emptySpeech: 0, speeches: 0,
    voidTalks: 0, talks: 0, suspSamples: 0, suspNonZero: 0,
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
        // 发言统计
        for (const p of g.players) {
          if (p.out) continue;
          const cl = p.outClaims || [];
          if (!cl.length) continue;
          st.talks++;
          const empty = cl.every(c => {
            const t = String(c.text || '').trim();
            const hasAccuse = (c.accuse && c.accuse.length) || (c.payload && c.payload.targets && c.payload.targets.length);
            const hasAsk = (c.ask && c.ask.length) || (c.payload && c.payload.ask);
            return !t && !hasAccuse && !hasAsk;
          });
          if (empty) { st.emptySpeech++; st.voidTalks++; }
          st.speeches++;
        }
        // 怀疑度是否仍被写入
        const al = g.players.filter(p => !p.out);
        for (const a of al) for (const b of al) {
          if (a.id === b.id) continue;
          st.suspSamples++;
          if (AI.suspOf(g, a, b.id) > 0) st.suspNonZero++;
        }
      }
      st.games++;
      st.winners[g.winner || '(none)'] = (st.winners[g.winner || '(none)'] || 0) + 1;
    } catch (e) { st.errs++; }
  }
  return st;
}

const A = run(process.argv[2], parseInt(process.argv[4] || '200', 10), parseInt(process.argv[5] || '1', 10));
const B = run(process.argv[3], parseInt(process.argv[4] || '200', 10), parseInt(process.argv[5] || '1', 10));

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '—') + '%';
const line = (k, a, b, unit) => {
  const d = (typeof a === 'number' && typeof b === 'number') ? (b - a) : 0;
  const sign = d > 0 ? '+' : '';
  console.log('  ' + k.padEnd(26) + String(a).padStart(9) + '  ' + String(b).padStart(9)
    + '   ' + sign + (typeof d === 'number' ? d.toFixed(1) : d) + (unit || ''));
};

console.log('\n=== 基线(' + process.argv[2].split(/[\\/]/).pop() + ') vs 拆除后 ===');
console.log('  ' + '指标'.padEnd(24) + '基线'.padStart(11) + '  ' + '拆除后'.padStart(11) + '     Δ');
console.log('  ' + '-'.repeat(62));
line('完成局数', A.games, B.games);
line('异常局数', A.errs, B.errs);
const allW = ['human', 'alien', 'xeno', '(none)'];
for (const w of allW) line('胜者 ' + w, A.winners[w] || 0, B.winners[w] || 0);
line('人类胜率', pct(A.winners.human || 0, A.games), pct(B.winners.human || 0, B.games), 'pp');
line('异形胜率', pct(A.winners.alien || 0, A.games), pct(B.winners.alien || 0, B.games), 'pp');
line('外星人胜率', pct(A.winners.xeno || 0, A.games), pct(B.winners.xeno || 0, B.games), 'pp');
console.log('  ' + '-'.repeat(62));
line('发言轮次', A.talks, B.talks);
line('空发言轮次', A.emptySpeech, B.emptySpeech);
line('空发言占比', pct(A.emptySpeech, A.talks || 1), pct(B.emptySpeech, B.talks || 1), 'pp');
line('suspOf>0 样本占比', pct(A.suspNonZero, A.suspSamples || 1), pct(B.suspNonZero, B.suspSamples || 1), 'pp');
fs.writeFileSync('C:/Users/ASUS/AppData/Local/Temp/opencode/ab-compare.json', JSON.stringify({ A, B }, null, 1));
console.log('\n（原始计数已存ab-compare.json）');