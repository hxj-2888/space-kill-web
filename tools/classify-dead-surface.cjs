'use strict';
/* 判定死面候选的性质（变量改名版：原先 st 既当数字又当字符串用，撞了）。 */
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || process.cwd();
const S0 = +(process.argv[3] || 241), N = +(process.argv[4] || 260);

const src = fs.readFileSync(path.join(ROOT, 'tools', 'load-order.cjs'), 'utf8');
const m = { exports: {} };
new Function('require', 'module', 'exports', '__dirname', '__filename', src)(
  require, m, m.exports, path.join(ROOT, 'tools'), 'x');
const { makeCtx, loadInto, profiles } = m.exports;
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { Engine, Setup } = ctx;

const seated = {}, aliveNights = {}, dispatches = {}, stepsEntered = {};
let games = 0;

for (let i = 0; i < N; i++) {
  try {
    const g = Setup.createGame(S0 + i, 'random');
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    const inGame = new Set(g.players.map(p => p.role));
    for (const r of inGame) seated[r] = (seated[r] || 0) + 1;
    Engine.begin(g);
    let k = 0;
    while (!g.over && k < 5000) {
      const step = g.step;
      k++;
      stepsEntered[step] = (stepsEntered[step] || 0) + 1;
      let req = [];
      try { req = (Engine.STEPS[step] && Engine.STEPS[step].req) ? (Engine.STEPS[step].req(g) || []) : []; } catch (e) { }
      for (const r of req) {
        const p = g.players.find(x => x.id === r.pid);
        const key = (p ? p.role : '?') + '@' + step;
        dispatches[key] = (dispatches[key] || 0) + 1;
      }
      for (const p of g.players) if (!p.out) aliveNights[p.role] = (aliveNights[p.role] || 0) + (1 / 60);
      Engine.stepOnce(g);
      if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
    }
    games++;
  } catch (e) { }
}

const dead = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'handover-report-241-500.json'), 'utf8')).coverage.dead;

console.log('局数 = ' + games + '（种子 ' + S0 + ' 起）');
console.log('');
console.log('════ 死面候选逐项判定 ════');
const cls = { notSeated: [], neverReached: [], realCandidate: [] };
for (const d of dead) {
  if (d.indexOf('stepfn:') === 0) {
    const step = d.split(':')[1].split('.')[0];
    const entered = stepsEntered[step] || 0;
    if (entered === 0) cls.neverReached.push(d + '　← 该步整批从未进入');
    else cls.realCandidate.push(d + '　← 该步进入了 ' + entered + ' 次');
    continue;
  }
  const roleAtStep = d.split(':')[1];              // 如 crew@0.6
  const at = roleAtStep.indexOf('@');
  const role = roleAtStep.slice(0, at);
  const stepId = roleAtStep.slice(at + 1);
  const g = seated[role] || 0;
  const an = Math.round(aliveNights[role] || 0);
  const disp = dispatches[role + '@' + stepId] || 0;
  if (g === 0) cls.notSeated.push(d + '　← 该角色整批 **0 局**上场');
  else if (an === 0) cls.notSeated.push(d + '　← 该角色上过场但 **0 存活夜次**');
  else cls.realCandidate.push(d + '　← 上场 ' + g + ' 局 / 存活约 ' + an + ' 夜 / 该位派发 ' + disp + ' 次');
}
console.log('');
console.log('① 角色整批未上场（不是缺陷 —— 席位表里就没有）　' + cls.notSeated.length + ' 项：');
cls.notSeated.forEach(x => console.log('    · ' + x));
console.log('');
console.log('② 该步整批从未进入　' + cls.neverReached.length + ' 项：');
cls.neverReached.forEach(x => console.log('    · ' + x));
console.log('');
console.log('③ 真候选：角色上过场、该位却从未派发　' + cls.realCandidate.length + ' 项：');
cls.realCandidate.forEach(x => console.log('    · ' + x));

console.log('');
console.log('════ 各角色上场局数 / 派发过的行动位 ════');
const roles = Object.keys(seated).sort();
console.log('  ' + '角色'.padEnd(11) + '上场局数'.padStart(8) + '  派发过的行动位（步×次数）');
for (const r of roles) {
  const slots = Object.keys(dispatches).filter(k => k.indexOf(r + '@') === 0)
    .map(k => k.split('@')[1] + '×' + dispatches[k]).sort();
  console.log('  ' + r.padEnd(9) + String(seated[r]).padStart(8) + '  ' + (slots.join('  ') || '—'));
}
const ALL = ['crew', 'engineer', 'sheriff', 'hunter', 'armed', 'detective', 'inspector', 'listener', 'bio', 'rescue', 'poisoner', 'tempdoc', 'assistant', 'artisan', 'bodyguard', 'alien', 'xeno', 'convict'];
const notSeated = ALL.filter(r => !seated[r]);
console.log('');
console.log('  整批 0 局上场的角色：' + (notSeated.length ? notSeated.join(', ') : '（无）'));