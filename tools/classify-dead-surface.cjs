'use strict';
/* 判定死面候选的性质（变量改名版：原先 st 既当数字又当字符串用，撞了）。
 *
 * 席位口径：本脚本与它读的产物必须**同一口径**，否则拿 classic 的死面清单去量 variants 的
 * 局面（或反过来）会把「口径差」误判成「缺陷」。口径由 tools/seat-mode.cjs 单点决定，
 * 产物文件名也按口径分流（classic 沿用历史名，variants 加 -variants 后缀）。
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || process.cwd();
const S0 = +(process.argv[3] || 241), N = +(process.argv[4] || 260);
const SeatMode = require(path.join(ROOT, 'tools', 'seat-mode.cjs'));
/* 产物可显式指定（第 5 个参数）；缺省按口径取报数区的那一份，
   保证「本脚本量的局面」与「被判定的死面清单」出自同一口径。 */
const ART = process.argv[5] || SeatMode.artifactFor('handover-report-241-500');

const src = fs.readFileSync(path.join(ROOT, 'tools', 'load-order.cjs'), 'utf8');
const m = { exports: {} };
new Function('require', 'module', 'exports', '__dirname', '__filename', src)(
  require, m, m.exports, path.join(ROOT, 'tools'), 'x');
const { makeCtx, loadInto, profiles } = m.exports;
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { Engine, Setup } = ctx;

/* 「这次派发算谁行使的」——与 handsover-sim.cjs 的 roleKeyFor 是同一个 helper 口径。
   变形（p.morph 非空）：p.role 是伪装目标（steps.js:1943 改写），能力仍是死囚的 ⇒ 取 originRole，
     否则死囚在步骤 8 的复生会记成 poisoner@8，convict@8 成了假死面。
   转职：p.role 是真职业（engine.js:245 改写，originRole 留在底册）⇒ 取 role，
     否则 armed/tempdoc/assistant 的派发全记成 crew@，制造三个新假死面。 */
const roleOf = p => (p.morph ? (p.originRole || p.role) : p.role);
const seated = {}, aliveNights = {}, dispatches = {}, stepsEntered = {};
let games = 0;

/* 派发观测同样必须钩在 req 本身：在 stepOnce 外层读 g.step 再调 req 拿到的是**上一步**
   的派发，且时点已在上一步结算之后 —— 实测 120 局会让 crew@0.6 / sheriff@2 / xeno@5 /
   listener@D-report 四个声明面成为假死面（§4.3 的教训，此处与 handsover-sim 同因）。 */
for (const stepId of Object.keys(Engine.STEPS)) {
  const def = Engine.STEPS[stepId];
  if (!def || typeof def.req !== 'function') continue;
  const origReq = def.req;
  def.req = function (gg) {
    const r = origReq.call(def, gg) || [];
    for (const x of r) {
      const p = gg.players.find(y => y.id === x.pid);
      const key = (p ? roleOf(p) : '?') + '@' + stepId;
      dispatches[key] = (dispatches[key] || 0) + 1;
    }
    return r;
  };
}

for (let i = 0; i < N; i++) {
  try {
    const g = SeatMode.seatGame(Setup, S0 + i);
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    /* 上场集合按**底册** originRole 判：变形不改变「谁上过场」（死囚就是死囚上场），
       否则变形后会把 convict 从上场名单里抹掉，制造「该角色整批 0 局上场」的假死面。 */
    const inGame = new Set(g.players.map(p => p.originRole || p.role));
    for (const r of inGame) seated[r] = (seated[r] || 0) + 1;
    Engine.begin(g);
    let k = 0;
    while (!g.over && k < 5000) {
      const step = g.step;
      k++;
      /* ⚠ g.step 在此处是**上一步**（beginStep 内部才设成本次步，engine.js:701）。
         所以「本步是否被走到」不能读 g.step，要读引擎即将执行的 queue 头。 */
      const ahead = (g.queue && g.queue.length) ? g.queue[0] : null;
      if (ahead != null) stepsEntered[ahead] = (stepsEntered[ahead] || 0) + 1;
      /* 存活夜次也按底册归：变形不改变这个人是谁（不然 convict 的存活夜全跑到伪装目标上）。 */
      for (const p of g.players) if (!p.out) {
        const o = p.originRole || p.role;
        aliveNights[o] = (aliveNights[o] || 0) + (1 / 60);
      }
      Engine.stepOnce(g);
      if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
    }
    games++;
  } catch (e) { }
}

const art = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', ART), 'utf8'));
const dead = art.coverage.dead;
if (art.meta && art.meta.seatMode && art.meta.seatMode !== SeatMode.seatMode())
  throw new Error('口径不一致：产物 ' + ART + ' 是 ' + art.meta.seatMode + '，本脚本跑的是 '
    + SeatMode.seatMode() + '。拿另一口径的死面清单来判定本口径的局面 = 制造假缺陷。');

console.log(SeatMode.note());
console.log('产物 = ' + ART + '　' + SeatMode.zoneReport(S0, S0 + N - 1).note);
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