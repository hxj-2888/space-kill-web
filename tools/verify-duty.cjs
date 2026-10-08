const path = require('path');
const ROOT = process.argv[2];
const { makeCtx, loadInto, profiles } = require(path.join(ROOT, 'tools', 'load-order.cjs'));
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { AI, Engine, Setup, SKData } = ctx;

const docAct = {};        // doctor 返回的 act 分布
const craftReq = {};      // craft 请求数
const roleCount = {};     // 各职业出现局数
const bulletsHist = { zero: 0, has: 0, fired: 0, req: 0 };
const convertGain = [];

const od = AI.decide;
AI.decide = function (g, req) {
  const d = od.apply(this, arguments);
  const k = req && req.kind;
  if (k === 'doctor') docAct[(d && d.act) || 'undefined'] = (docAct[(d && d.act) || 'undefined'] || 0) + 1;
  if (k === 'craft') craftReq.req = (craftReq.req || 0) + 1;
  if (k === 'shoot') {
    const p = g.players.find(x => x.id === req.pid);
    bulletsHist.req++;
    if (p && (p.bullets || 0) <= 0) bulletsHist.zero++; else bulletsHist.has++;
    if (d && d.targets && d.targets.length) bulletsHist.fired++;
  }
  if (k === 'convert') convertGain.push(d && d.do ? 'do' : 'no');
  return d;
};

const setupRoles = {};
for (const r of SKData.HUMAN_SETUP) setupRoles[r] = (setupRoles[r] || 0) + 1;
console.log('HUMAN_SETUP 席位表 =', JSON.stringify(SKData.HUMAN_SETUP));
console.log('各职业席位数 =', JSON.stringify(setupRoles));

for (let seed = 1; seed <= 200; seed++) {
  const g = Setup.createGame(seed, 'random');
  g.humans = []; g.humanId = -1; for (const p of g.players) p.isHuman = false;
  for (const p of g.players) roleCount[p.role] = (roleCount[p.role] || 0) + 1;
  Engine.begin(g);
  let steps = 0;
  while (!g.over && steps < 5000) { steps++; Engine.stepOnce(g); if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' }); }
}

console.log('\n200 局中各职业实际出现次数 =', JSON.stringify(roleCount));
console.log('\ndoctor 返回 act 分布 =', JSON.stringify(docAct));
console.log('craft 请求总数 =', craftReq.req || 0);
console.log('\nshoot：请求', bulletsHist.req, '其中持弹0发', bulletsHist.zero, '有弹', bulletsHist.has, '实际开出', bulletsHist.fired);
const cg = convertGain.reduce((a, x) => (a[x] = (a[x] || 0) + 1, a), {});
console.log('\nconvert 返回 do 分布 =', JSON.stringify(cg));