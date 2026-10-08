'use strict';
/* scout.cjs 两份 JSON 的结构化对照 */
const fs = require('fs');
const A = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));   // 基线
const B = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));   // B0 后
const NL = String.fromCharCode(10);
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '0.0') + '%';

const row = (label, a, b, isPct) => {
  const f = x => isPct ? (typeof x === 'number' ? x.toFixed(1) + '%' : String(x)) : String(x);
  const d = (typeof a === 'number' && typeof b === 'number') ? (b - a) : 0;
  console.log('  ' + label.padEnd(34) + f(a).padStart(12) + '  ' + f(b).padStart(12)
    + '   ' + (d > 0 ? '+' : '') + (isPct ? d.toFixed(1) + 'pp' : d));
};
const H = t => console.log(NL + '══ ' + t + ' ' + '═'.repeat(Math.max(0, 56 - t.length)));

H('结局');
row('完成局数', A.meta.games, B.meta.games);
row('异常局数', A.meta.errs, B.meta.errs);
row('人类胜率', parseFloat(A.outcome.humanWin), parseFloat(B.outcome.humanWin), true);
row('异形胜率', parseFloat(A.outcome.alienWin), parseFloat(B.outcome.alienWin), true);
row('外星人胜率', parseFloat(A.outcome.xenoWin), parseFloat(B.outcome.xenoWin), true);
row('寂灭局', A.outcome.extinction, B.outcome.extinction);
row('决斗局', A.outcome.duel, B.outcome.duel);

H('发言层');
row('Bridge.say 调用', A.speech.calls, B.speech.calls);
row('空发言', A.speech.empty, B.speech.empty);
row('空发言率', parseFloat(A.speech.emptyPct), parseFloat(B.speech.emptyPct), true);
row('句子总数', A.speech.sentences, B.speech.sentences);
row('唯一句子数', A.speech.unique, B.speech.unique);
row('句子多样性', parseFloat(A.speech.diversity), parseFloat(B.speech.diversity), true);
row('指控条目数', A.speech.accuseN, B.speech.accuseN);

H('Claim 分布（按阵营）');
const kinds = [...new Set([...Object.keys(A.speech.claimKindByFaction.human || {}),
  ...Object.keys(A.speech.claimKindByFaction.alien || {}),
  ...Object.keys(A.speech.claimKindByFaction.xeno || {}),
  ...Object.keys(B.speech.claimKindByFaction.human || {}),
  ...Object.keys(B.speech.claimKindByFaction.alien || {}),
  ...Object.keys(B.speech.claimKindByFaction.xeno || {})])].sort();
for (const fac of ['human', 'alien', 'xeno']) {
  const a = A.speech.claimKindByFaction[fac] || {}, b = B.speech.claimKindByFaction[fac] || {};
  const tot = o => Object.values(o).reduce((x, y) => x + y, 0);
  console.log('  【' + fac + '】总计 ' + tot(a) + ' → ' + tot(b)
    + '　ask:accuse ' + (a.accuse ? (a.ask || 0) / a.accuse : 0).toFixed(2)
    + ' → ' + (b.accuse ? (b.ask || 0) / b.accuse : 0).toFixed(2));
  for (const k of kinds) {
    const av = a[k] || 0, bv = b[k] || 0;
    if (av || bv) console.log('      ' + k.padEnd(12) + String(av).padStart(7) + '  ' + String(bv).padStart(7)
      + '   ' + (bv - av > 0 ? '+' : '') + (bv - av));
  }
}

H('记忆层：写入 vs 引用（推理层可观测替代量）');
const rc = (o, k) => o.reasoning[k] || 0;
row('saidRole 写入 / 引用', rc(A, 'memSaidRole'), rc(B, 'memSaidRole'));
row('  引用率', pct(rc(A, 'citeSaidRole'), rc(A, 'memSaidRole')), pct(rc(B, 'citeSaidRole'), rc(B, 'memSaidRole')), true);
row('promise 写入 / 引用', rc(A, 'memPromise'), rc(B, 'memPromise'));
row('  引用率', pct(rc(A, 'citePromise'), rc(A, 'memPromise')), pct(rc(B, 'citePromise'), rc(B, 'memPromise')), true);
row('stance 写入 / 引用', rc(A, 'memStance'), rc(B, 'memStance'));
row('  引用率', pct(rc(A, 'citeStance'), rc(A, 'memStance')), pct(rc(B, 'citeStance'), rc(B, 'memStance')), true);
row('contradiction 写入 / 引用', rc(A, 'memContradiction'), rc(B, 'memContradiction'));
row('出现过改口的局', rc(A, 'gamesWithConflict'), rc(B, 'gamesWithConflict'));

H('证据层');
row('证据条数总计', A.evidence.total, B.evidence.total);
const fams = [...new Set([...Object.keys(A.evidence.bySrcFamily), ...Object.keys(B.evidence.bySrcFamily)])];
for (const f of fams) row('  ' + f, A.evidence.bySrcFamily[f] || 0, B.evidence.bySrcFamily[f] || 0);

H('行动层');
row('decide 调用', A.action.calls, B.action.calls);
row('非空决策', A.action.nonEmpty, B.action.nonEmpty);
row('非空率', pct(A.action.nonEmpty, A.action.calls), pct(B.action.nonEmpty, B.action.calls), true);
row('异形破坏', A.action.alienDestroy, B.action.alienDestroy);
row('异形击杀', A.action.alienKill, B.action.alienKill);
row('异形感染', A.action.alienInfect, B.action.alienInfect);
row('人类职业技能', A.action.humanSkills, B.action.humanSkills);
row('战术库调用', A.action.tacticCalls, B.action.tacticCalls);
row('战术库死条目', A.action.tacticDead, B.action.tacticDead);
row('死条目率', parseFloat(A.action.tacticDeadPct), parseFloat(B.action.tacticDeadPct), true);

H('投票层');
row('投票轮次', A.vote.rounds, B.vote.rounds);
row('每轮不同被投目标', parseFloat(A.vote.distinctPerRound), parseFloat(B.vote.distinctPerRound));
row('最高票目标占比', parseFloat(A.vote.maxShare), parseFloat(B.vote.maxShare), true);
row('全票一致率', parseFloat(A.vote.unanimousPct), parseFloat(B.vote.unanimousPct), true);
row('人类票命中敌对', parseFloat(A.vote.humanHitPct), parseFloat(B.vote.humanHitPct), true);
row('异形票投人类', parseFloat(A.vote.alienVoteHumanPct), parseFloat(B.vote.alienVoteHumanPct), true);
row('异形票投队友', parseFloat(A.vote.alienVoteAllyPct), parseFloat(B.vote.alienVoteAllyPct), true);

H('角色差异化：各角色见过的证据家族数（均值）');
/* keys 形如 "crew:3"（角色:该观察者见过的家族数），每次观察记一条 */
const meanByRole = src => {
  const g = {};
  for (const k of Object.keys(src.evidence.kindsByRole)) {
    const [role, n] = k.split(':');
    (g[role] = g[role] || []).push(+n);
  }
  const o = {};
  for (const r of Object.keys(g)) o[r] = g[r].reduce((x, y) => x + y, 0) / g[r].length;
  return o;
};
const ma = meanByRole(A), mb = meanByRole(B);
console.log('  ' + '角色'.padEnd(14) + '基线家族数'.padStart(12) + '  ' + 'B0后'.padStart(8));
for (const r of [...new Set([...Object.keys(ma), ...Object.keys(mb)])].sort()) {
  const a = ma[r], b = mb[r];
  const d = (a == null || b == null) ? NaN : b - a;
  console.log('  ' + r.padEnd(12) + (a == null ? '—' : a.toFixed(2)).padStart(12) + '  '
    + (b == null ? '—' : b.toFixed(2)).padStart(8)
    + '   ' + (isNaN(d) ? '' : (d > 0 ? '+' : '') + d.toFixed(2)));
}

H('最高频句子 Top10');
console.log('  ── 基线 ──');
A.speech.topSentences.slice(0, 10).forEach(([t, n]) => console.log('    ' + String(n).padStart(6) + '×  ' + t.slice(0, 40)));
console.log('  ── B0 后 ──');
B.speech.topSentences.slice(0, 10).forEach(([t, n]) => console.log('    ' + String(n).padStart(6) + '×  ' + t.slice(0, 40)));