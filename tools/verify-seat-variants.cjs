'use strict';
/* 验证「席位变体从未生效」这一发现，并给出修法。
 *
 * 事实：rollSeatPicks(seed) 正常产出 50/50 的变体 B，但 createGame 只读 opts.seatPicks，
 *       自己不调 rollSeatPicks ⇒ Setup.createGame(seed, 'random') 的所有对局
 *       5 个变体席位恒为变体 A ⇒ hunter/listener/poisoner/artisan/convict 从未上场。
 *
 * 本脚本：
 *   ① 统计不传 seatPicks 时的角色覆盖；
 *   ② 统计显式传入 rollSeatPicks 结果时的角色覆盖；
 *   ③ 对比两者，量化「变体从未生效」让多少机制面处于未被检验状态。
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || process.cwd();
const N = +(process.argv[3] || 200);

const src = fs.readFileSync(path.join(ROOT, 'tools', 'load-order.cjs'), 'utf8');
const m = { exports: {} };
new Function('require', 'module', 'exports', '__dirname', '__filename', src)(
  require, m, m.exports, path.join(ROOT, 'tools'), 'x');
const { makeCtx, loadInto, profiles } = m.exports;
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { Engine, Setup } = ctx;
const RD = ctx.SKRoleDecl;

function sweep(label, mkOpts) {
  const seated = {}, dispatches = {};
  let games = 0, errs = 0;
  for (let i = 0; i < N; i++) {
    const seed = 241 + i;
    try {
      const g = Setup.createGame(seed, 'random', mkOpts ? mkOpts(seed) : undefined);
      g.humans = []; g.humanId = -1;
      for (const p of g.players) p.isHuman = false;
      for (const p of g.players) seated[p.role] = (seated[p.role] || 0) + 1;
      Engine.begin(g);
      let k = 0;
      while (!g.over && k < 5000) {
        const step = g.step; k++;
        let req = [];
        try { req = (Engine.STEPS[step] && Engine.STEPS[step].req) ? (Engine.STEPS[step].req(g) || []) : []; } catch (e) { }
        for (const r of req) {
          const p = g.players.find(x => x.id === r.pid);
          if (!p) continue;
          dispatches[p.role + '@' + step] = (dispatches[p.role + '@' + step] || 0) + 1;
        }
        Engine.stepOnce(g);
        if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
      }
      games++;
    } catch (e) { errs++; }
  }
  const roles = Object.keys(seated).sort();
  const never = RD.keys().filter(r => !seated[r]);
  console.log('── ' + label + '（' + games + ' 局，异常 ' + errs + '）');
  console.log('   上场的角色（' + roles.length + '）：' + roles.join(', '));
  console.log('   从未上场（' + never.length + '）：' + (never.length ? never.join(', ') : '（无）'));
  const slots = Object.keys(dispatches).length;
  console.log('   产生过派发的「角色@步骤」组合：' + slots);
  return { seated, dispatches, never, games, errs };
}

console.log('════ A. 现状（Setup.createGame(seed, random)，即所有既有探针/回归的用法）════');
const A = sweep('不传 seatPicks', null);

console.log('');
console.log('════ B. 显式传入 rollSeatPicks 结果 ════');
const B = sweep('传 seatPicks = rollSeatPicks(seed)', seed => ({ seatPicks: Setup.rollSeatPicks(seed) }));

console.log('');
console.log('════ C. 差异 ════');
const newRoles = RD.keys().filter(r => !A.seated[r] && B.seated[r]);
console.log('  变体生效后**新获得**的角色：' + (newRoles.length ? newRoles.join(', ') : '（无）'));
const newSlots = Object.keys(B.dispatches).filter(k => !A.dispatches[k]);
console.log('  新获得派发的「角色@步骤」组合（' + newSlots.length + ' 个）：');
newSlots.forEach(k => console.log('    · ' + k + ' ×' + B.dispatches[k]));
const allSlots = {};
for (const k of Object.keys(A.dispatches)) allSlots[k] = '现状';
for (const k of newSlots) allSlots[k] = '变体新增';
console.log('');
console.log('  ⇒ 现状只检验了 ' + Object.keys(A.dispatches).length + ' 个派发组合；'
  + '变体生效后会多出 ' + newSlots.length + ' 个（占全量 ' + newSlots.length
  + '，即约 ' + (100 * newSlots.length / (Object.keys(A.dispatches).length + newSlots.length)).toFixed(1) + '%）。');