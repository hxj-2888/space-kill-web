'use strict';
/* 决定性核对：警长巡逻。
 * 矛盾：diag-dead4 说 660 次在场里有 645 次 patrolUsed 已为真（只有 669 一处会置真），
 *      classify-dead2 却又说 sheriff@2 派发 0 次。二者必有一错。
 * 这里同时用三种口径看同一件事：req 是否派发、决策内容、patrolUsed 的初值。
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || process.cwd();
const N = +(process.argv[3] || 60);
const SeatMode = require(path.join(ROOT, 'tools', 'seat-mode.cjs'));

const src = fs.readFileSync(path.join(ROOT, 'tools', 'load-order.cjs'), 'utf8');
const m = { exports: {} };
new Function('require', 'module', 'exports', '__dirname', '__filename', src)(
  require, m, m.exports, path.join(ROOT, 'tools'), 'x');
const { makeCtx, loadInto, profiles } = m.exports;
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { Engine, Setup } = ctx;

const P = {
  games: 0,
  patrolUsedAtStart: 0, sheriffCount: 0,
  step2ReqTotal: 0, step2Patrol: 0,
  decUseTrue: 0, decSamples: [],
  patrolUsedAfter: 0,
};
for (let i = 0; i < N; i++) {
  try {
    const g = SeatMode.seatGame(Setup, 241 + i);
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    const sh0 = g.players.find(p => p.role === 'sheriff');
    if (sh0) { P.sheriffCount++; if (sh0.patrolUsed) P.patrolUsedAtStart++; }
    Engine.begin(g);
    P.games++;
    let k = 0;
    while (!g.over && k < 5000) {
      const step = g.step;
      k++;
      if (step === '2') {
        const req = (Engine.STEPS['2'].req(g) || []);
        P.step2ReqTotal += req.length;
        for (const r of req) {
          if (r.kind !== 'patrol') continue;
          P.step2Patrol++;
          const p = g.players.find(x => x.id === r.pid);
          const d = (g.decisions && g.decisions[r.pid]) || null;
          if (d && d.use) P.decUseTrue++;
          if (P.decSamples.length < 6) {
            P.decSamples.push({
              night: g.night, id: r.pid, role: p && p.role,
              patrolUsedBefore: p && p.patrolUsed,
              decision: d ? { use: d.use, targets: d.targets } : null,
            });
          }
        }
      }
      Engine.stepOnce(g);
      if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
    }
    const sh1 = g.players.find(p => p.role === 'sheriff');
    if (sh1 && sh1.patrolUsed) P.patrolUsedAfter++;
  } catch (e) { }
}

console.log(SeatMode.note());
console.log(SeatMode.zoneReport(241, 241 + N - 1).note);
console.log('局数 = ' + P.games);
console.log('开局有警长的局 = ' + P.sheriffCount + '，其中开局 patrolUsed 已为真 = ' + P.patrolUsedAtStart);
console.log('步骤 2 的 req 条目总数 = ' + P.step2ReqTotal);
console.log('其中 kind=patrol = ' + P.step2Patrol);
console.log('patrol 决策里 use=true 的次数 = ' + P.decUseTrue);
console.log('终局时 patrolUsed=true 的局 = ' + P.patrolUsedAfter + ' / ' + P.games);
console.log('');
console.log('样本：');
P.decSamples.forEach(s => console.log('  ' + JSON.stringify(s)));