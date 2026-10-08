'use strict';
/* 定点查两个真死面：① 步骤 2 的警长巡逻（条件 !patrolUsed && night<=3）
 * ② 步骤 0.6 的船员转职（条件 存活<=6 或 night>=6）。
 * 目的是判定它们是「条件在样本内从未成立」还是「req 侧有缺陷」。
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || process.cwd();
const N = +(process.argv[3] || 200);
const SeatMode = require(path.join(ROOT, 'tools', 'seat-mode.cjs'));

const src = fs.readFileSync(path.join(ROOT, 'tools', 'load-order.cjs'), 'utf8');
const m = { exports: {} };
new Function('require', 'module', 'exports', '__dirname', '__filename', src)(
  require, m, m.exports, path.join(ROOT, 'tools'), 'x');
const { makeCtx, loadInto, profiles } = m.exports;
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { Engine, Setup } = ctx;

/* ⚠ 2026-10-08 修正：这个探针原先在 stepOnce 外层读 g.step 再调 req —— 读到的是**上一步**
   （beginStep 内部才设 g.step，engine.js:701），故「条件是否成立」的判据全部取错时点，
   报出「两个条件一次都没成立」的假结论。改法：钩 req 本体，记引擎真实派发。
   派发条件是否成立，用 req 返回值本身回答（引擎已经判过了），不再自己重算。 */
const P = {
  games: 0,
  maxNight: 0, nightHist: {},
  minAlive: 99, aliveAtNight6: [],
  step2Seen: 0, sheriffAtStep2: 0, patrolUsedTrue: 0, nightAtStep2: {},
  step06Seen: 0, crewAtStep06: 0, aliveLe6: 0, nightGe6: 0, transferredAlready: 0,
  /* 真实派发（钩 req 所得）—— 这才是「窗口有没有被打开」的直接证据 */
  patrolDispatch: 0, transferDispatch: 0, transferSamples: [], CURG: null,
};

/* 钩 req 本体：记引擎真实派发了什么 */
for (const stepId of Object.keys(Engine.STEPS)) {
  const def = Engine.STEPS[stepId];
  if (!def || typeof def.req !== 'function') continue;
  const origReq = def.req;
  def.req = function (g) {
    const r = origReq.call(def, g) || [];
    if (!P.CURG) return r;
    for (const x of r) {
      const p = g.players.find(y => y.id === x.pid);
      if (stepId === '2' && x.kind === 'patrol') {
        P.patrolDispatch++;
      } else if (stepId === '0.6' && x.kind === 'transfer') {
        P.transferDispatch++;
        if (P.transferSamples.length < 6) P.transferSamples.push({
          id: x.pid, night: g.night, role: p && p.role,
          alive: g.players.filter(y => !y.out).length,
        });
      }
    }
    return r;
  };
}

for (let i = 0; i < N; i++) {
  try {
    const g = SeatMode.seatGame(Setup, 241 + i);
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    P.CURG = g;
    Engine.begin(g);
    P.games++;
    let k = 0;
    while (!g.over && k < 5000) {
      const step = g.step;
      k++;
      const alive = g.players.filter(p => !p.out).length;
      if (alive < P.minAlive) P.minAlive = alive;
      if (g.night > P.maxNight) P.maxNight = g.night;
      P.nightHist[g.night] = (P.nightHist[g.night] || 0) + 1;

      if (step === '2') {
        P.step2Seen++;
        const sh = g.players.find(p => p.role === 'sheriff' && !p.out);
        if (sh) {
          P.sheriffAtStep2++;
          P.nightAtStep2[g.night] = (P.nightAtStep2[g.night] || 0) + 1;
          if (sh.patrolUsed) P.patrolUsedTrue++;
        }
      }
      if (step === '0.6') {
        P.step06Seen++;
        for (const p of g.players) {
          if (p.out || p.role !== 'crew') continue;
          P.crewAtStep06++;
          if (alive <= 6) P.aliveLe6++;
          if (g.night >= 6) P.nightGe6++;
          if (p.transferred) P.transferredAlready++;
        }
      }
      Engine.stepOnce(g);
      if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
    }
  } catch (e) { }
}

console.log(SeatMode.note());
console.log(SeatMode.zoneReport(241, 241 + N - 1).note);
console.log('局数 = ' + P.games);
console.log('最长夜次 = ' + P.maxNight + '   最低存活数 = ' + P.minAlive);
console.log('夜次分布 = ' + JSON.stringify(P.nightHist));
console.log('');
console.log('── 步骤 2 的警长 ──');
console.log('   步骤 2 观测 ' + P.step2Seen + ' 次，其中警长在场 ' + P.sheriffAtStep2 + ' 次');
console.log('   警长在场时 patrolUsed 已为真的次数 = ' + P.patrolUsedTrue + '（req 要求 !patrolUsed）');
console.log('   步骤 2 出现时的夜次分布 = ' + JSON.stringify(P.nightAtStep2));
console.log('');
console.log('── 步骤 0.6 的船员转职 ──');
console.log('   步骤 0.6 观测 ' + P.step06Seen + ' 次，其中船员在场 ' + P.crewAtStep06 + ' 人次');
console.log('   其中 存活<=6：' + P.aliveLe6 + '   night>=6：' + P.nightGe6 + '   已转职：' + P.transferredAlready);
console.log('');
console.log('── 直接证据：引擎真实派发了几次（钩 req 本体，非探针重算）──');
console.log('   步骤 2 派发 kind=patrol   = ' + P.patrolDispatch + ' 次');
console.log('   步骤 0.6 派发 kind=transfer = ' + P.transferDispatch + ' 次');
if (P.transferSamples.length) {
  console.log('   transfer 派发样本：');
  P.transferSamples.forEach(s => console.log('     ' + JSON.stringify(s)));
}
console.log('');
console.log('   注：上面的「存活<=6 / night>=6」是探针在**外层**自算的计数，');
console.log('       因外层读到的是上一步的 g.step，这两个数只作参考；');
console.log('       「窗口有没有被打开」以上面两行直接派发数为准。');