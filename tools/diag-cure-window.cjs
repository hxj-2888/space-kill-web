'use strict';
/* 排查裁定① 的自我治疗额度在真实对局里走不到的原因。
 * 不钩 applyInfection（它在 steps.js 里是模块内绑定，从 Engine 上钩不到），
 * 改为在步骤 8 直接读外星人的真实状态与 req 结果。
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || process.cwd();
const N = +(process.argv[3] || 120);

const src = fs.readFileSync(path.join(ROOT, 'tools', 'load-order.cjs'), 'utf8');
const m = { exports: {} };
new Function('require', 'module', 'exports', '__dirname', '__filename', src)(
  require, m, m.exports, path.join(ROOT, 'tools'), 'x');
const { makeCtx, loadInto, profiles } = m.exports;
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { Engine, Setup } = ctx;

const C = {
  games: 0, xenoAlive: 0,
  step8Seen: 0,
  infNull: 0, infFake: 0, infReal: 0,
  cure0: 0, curePos: 0,
  branchNull: 0, branchSet: 0,
  canActTrue: 0, canActFalse: 0,
  reqHit: 0,
  sample: [],
  /* 到账侧：grants 之后、步骤 0 之前的状态 */
  grantsWithInfection: 0, grantsWithout: 0,
  cureAtStep7: 0,
};
const bump = k => { C[k]++; };

for (let i = 0; i < N; i++) {
  const g = Setup.createGame(1 + i, 'random');
  g.humans = []; g.humanId = -1;
  for (const p of g.players) p.isHuman = false;
  Engine.begin(g);
  let k = 0, sawXeno = false;
  while (!g.over && k < 5000) {
    const step = g.step;
    k++;
    const x = g.players.find(p => p.role === 'xeno' && !p.out);
    if (x) { sawXeno = true; bump('xenoAlive'); }

    /* 到账后立刻看一次：有感染标记吗？cureSelf 是多少？ */
    if (step === '0' && x) {
      if (x.infection) bump('grantsWithInfection'); else bump('grantsWithout');
    }
    /* 步骤 7 之后（即感染已落地）看 cureSelf */
    if (step === '7' && x) { if (x.cureSelf > 0) bump('cureAtStep7'); }

    if (step === '8' && x) {
      bump('step8Seen');
      if (!x.infection) bump('infNull');
      else if (x.infection.real) bump('infReal');
      else bump('infFake');
      if (x.cureSelf > 0) bump('curePos'); else bump('cure0');
      if (x.branch) bump('branchSet'); else bump('branchNull');
      const canAct = Engine.canAct(g, x);
      if (canAct) bump('canActTrue'); else bump('canActFalse');
      const req = (Engine.STEPS['8'].req(g) || []);
      const hit = req.some(r => r.kind === 'xenoCure' && r.pid === x.id);
      if (hit) bump('reqHit');
      if (C.sample.length < 8 && (x.infection || x.cureSelf > 0)) {
        C.sample.push({
          night: g.night, id: x.id,
          infection: x.infection ? (x.infection.real ? 'real' : 'fake') : null,
          cureSelf: x.cureSelf, branch: x.branch, canAct, hit,
          reqKinds: req.map(r => r.kind),
        });
      }
    }
    Engine.stepOnce(g);
    if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
  }
  if (sawXeno) bump('games');
}

console.log('局数 = ' + N + '　出现外星人的局 = ' + C.games);
console.log('');
console.log('外星人存活观测 = ' + C.xenoAlive + ' 次　步骤 8 观测 = ' + C.step8Seen + ' 次');
console.log('');
console.log('感染标记：null ' + C.infNull + '　fake ' + C.infFake + '　real ' + C.infReal);
console.log('cureSelf ：=0 ' + C.cure0 + '　>0 ' + C.curePos);
console.log('branch   ：null ' + C.branchNull + '　已占用 ' + C.branchSet);
console.log('canAct   ：真 ' + C.canActTrue + '　假 ' + C.canActFalse);
console.log('req 命中 xenoCure = ' + C.reqHit);
console.log('');
console.log('到账时点（步骤 0）：有感染标记 ' + C.grantsWithInfection + '　无 ' + C.grantsWithout);
console.log('步骤 7 后 cureSelf>0 = ' + C.cureAtStep7);
console.log('');
console.log('样本（有感染或有额度的时刻）：');
C.sample.forEach(s => console.log('  ' + JSON.stringify(s)));