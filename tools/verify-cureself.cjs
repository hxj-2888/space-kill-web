'use strict';
/* 确定性验证「外星人自我治疗」是否真的可用了。
   不依赖随机对局：直接构造状态 → 调引擎的步骤 8 req → 提交 → 查三件事：
     ① req 是否派发（cureSelf 到账 + 有感染 + 未行动 ⇒ 应命中）
     ② 结算是否清感染
     ③ 是否写入 antibodyNight/antibodyBy（卡：自我治疗赋予抗体）
   再验证抗体真的能拦截下一次感染（applyInfection 层序）。
   用法：node verify-cureself.cjs <REPO_ROOT> */
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || process.cwd();

function loadOrder(root) {
  const src = fs.readFileSync(path.join(root, 'tools', 'load-order.cjs'), 'utf8');
  const m = { exports: {} };
  new Function('require', 'module', 'exports', '__dirname', '__filename', src)(
    require, m, m.exports, path.join(root, 'tools'), 'x');
  return m.exports;
}
const { makeCtx, loadInto, profiles } = loadOrder(ROOT);
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { Engine, Setup, AI } = ctx;
const ACT = ctx.SKDerivation || null;

const out = [];
const ok = (c, label, extra) => out.push((c ? '  [通过] ' : '  [失败] ') + label + (extra ? '  → ' + extra : ''));

/* ── 场景：推进到某个夜晚，手工给外星人挂上真感染，观察 req/结算 ── */
const g = Setup.createGame(11, 'random');
g.humans = []; g.humanId = -1;
for (const p of g.players) p.isHuman = false;
Engine.begin(g);
// 推进几步到有夜晚流程的位置
let k = 0;
while (k < 60 && !['8', '9', '7', 'D-vote'].includes(g.step)) {
  Engine.stepOnce(g);
  if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
  k++;
}

const xeno = g.players.find(p => p.role === 'xeno');
out.push('外星人: id=' + (xeno && xeno.id) + ' role=' + (xeno && xeno.role)
  + ' 当前 step=' + g.step + ' night=' + g.night);
if (!xeno) { console.log(out.join('\n')); process.exit(1); }

/* ① 补齐后：cureSelf 应在夜间到账区被赋 1 */
out.push('');
out.push('① 额度到账（engine.js 夜间到账区 `if (p.role === "xeno") p.cureSelf = 1;`）');
out.push('   观察：进入本夜后 xeno.cureSelf = ' + xeno.cureSelf);
ok(xeno.cureSelf === 1, 'cureSelf 到账为 1', 'cureSelf=' + xeno.cureSelf);

/* ② 构造真感染，验证步骤 8 req 是否派发 */
xeno.infection = { real: true, night: g.night, kind: 'infect' };
xeno.branch = null;
const S8 = Engine.STEPS['8'];
const reqOut = S8 && typeof S8.req === 'function' ? (S8.req(g) || []) : [];
const hit = reqOut.some(r => r.pid === xeno.id && r.kind === 'xenoCure');
out.push('');
out.push('② 步骤 8 req 派发（有感染 + cureSelf=1 + 未行动）');
out.push('   req 返回 ' + reqOut.length + ' 项：' + JSON.stringify(reqOut.map(r => r.kind + '@' + r.pid)));
ok(hit, 'req 派发 kind=xenoCure 给外星人 ' + xeno.id);

/* ③ 提交并查结算 */
if (hit) {
  g.decisions = g.decisions || {};
  g.decisions[xeno.id] = { use: true, targets: [xeno.id] };
  const submit8 = S8.submit || S8.run;
  let ran = false;
  try {
    if (typeof S8.submit === 'function') { S8.submit(g); ran = true; }
    else if (typeof S8.run === 'function') { S8.run(g); ran = true; }
  } catch (e) { out.push('   结算异常: ' + e.message); }
  out.push('');
  out.push('③ 步骤 8 结算（提交处理器: ' + (typeof S8.submit === 'function' ? 'submit' : typeof S8.run === 'function' ? 'run' : '无') + '，ran=' + ran + '）');
  out.push('   infection 现值 = ' + JSON.stringify(xeno.infection));
  ok(!xeno.infection, '感染已清除');
  ok(xeno.antibodyNight === g.night + 1, '写入 antibodyNight = ' + xeno.antibodyNight + '（应为 night+1）',
    'antibodyNight=' + xeno.antibodyNight + ' antibodyBy=' + xeno.antibodyBy);
}

/* ④ 抗体能否真的拦截下一次感染（applyInfection 层序） */
out.push('');
out.push('④ 抗体拦截（engine.js applyInfection：抗体在效果免疫之前结算）');
const probe = g.players.find(p => p.role === 'xeno');
if (probe) {
  const other = g.players.find(p => !p.out && p.id !== probe.id && p.role === 'alien');
  if (other) {
    /* 抗体的时限语义（卡·生化医师页注）：「仅存在于获得后的下一个夜晚，该夜内抵挡 1 次感染，
       夜末一律失效、不结转、不累积」。引擎存 antibodyNight = 授予夜 + 1，
       applyInfection 判 `t.antibodyNight === g.night` —— 故必须在**下一个夜晚**施加感染。
       （我先前当夜就施加，故读到 'real'；那是测试构造错，不是实现错。） */
    const grantNight = g.night;
    probe.antibodyNight = grantNight + 1;
    const eng = ctx.Engine;
    const hasFn = typeof eng.applyInfection === 'function';
    out.push('   Engine.applyInfection 是否导出 = ' + hasFn);
    if (hasFn) {
      // 场景 A：下一个夜晚（抗体在场）→ 应被拦截
      g.night = grantNight + 1;
      probe.infection = null;
      const resA = eng.applyInfection(g, probe, other);
      const landedA = !!probe.infection;
      // 场景 B：再下一夜（抗体已过期）→ 应落地
      g.night = grantNight + 2;
      probe.infection = null;
      const resB = eng.applyInfection(g, probe, other);
      const landedB = !!probe.infection;
      out.push('   A 授予夜+1（抗体在场）：返回=' + resA + '  infection落地=' + landedA);
      out.push('   B 授予夜+2（抗体过期）：返回=' + resB + '  infection落地=' + landedB);
      ok(resA === 'blocked' && !landedA, '下一个夜晚：有抗体 ⇒ 感染被拦截');
      ok(landedB, '再下一夜：抗体已失效 ⇒ 感染正常落地（卡·时限型，不结转）');
    } else {
      out.push('   （未导出 applyInfection，跳过实测）');
    }
  }
}

console.log(out.join('\n'));
fs.writeFileSync('C:/Users/ASUS/AppData/Local/Temp/opencode/cureself-verify.txt', out.join('\n'));