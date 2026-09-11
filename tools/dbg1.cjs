const fs = require('fs'), path = require('path');
const { makeCtx, loadInto, profiles } = require('./load-order.cjs');
const base = path.join(__dirname, '..', 'js');
const ctx = makeCtx();
loadInto(ctx, base, profiles.aiOnly);
const { Setup, Engine } = ctx;
const g = Setup.createGame(7, 'random'); g.humans = [];
Engine.begin(g);
let steps = 0;
while (!g.over && steps < 5000) {
  steps++; Engine.stepOnce(g);
  if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
  if (g.stepDone === '9') {
    const d = g.log.filter(e => e.batch === '⑥' && e.night === g.night).map(e => e.text).join(' ; ');
    const acts = g.players.filter(p => p.faction === 'alien' && !p.out).map(p =>
      `${p.id}:${p.alien.dir || '未'}刀${p.alien.kills}连休${p.guardStreak || 0}`).join(' ');
    console.log(`夜${g.night}: ${d || '无人死亡'}  | 异形[${acts}]`);
  }
  if (g.winner) break;
}
console.log('终局:', g.winner, '夜', g.night);
console.log('出局:', g.players.filter(p => p.out).map(p => `${p.id}(${p.faction}/${p.outType === 'vote' ? '逐' : p.cause})`).join(' '));
