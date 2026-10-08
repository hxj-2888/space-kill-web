'use strict';
/* ============================================================================
 * 确定性验证「外星人自我治疗」额度口径（用户裁定 2026-10-08：每夜有感染标记自动
 * 赋予一次额度）。
 *
 * 口径变更（记录理由——治理规范铁律五：断言/验证改动须写明理由）：
 *   初版口径＝**每夜无条件**到账 cureSelf=1，理由是「速查卡的外星人额度行未列自我
 *   治疗 ⇒ 疑为每夜回复」，且当时把该推断登记进 IMPL_GAP 待正文确认。
 *   现由用户裁定改为「**有感染标记才到账**」。因此本脚本的 ① 从「cureSelf 必为 1」
 *   改为**正反两例**：无标记 ⇒ 不到账；有标记 ⇒ 到账 1。
 *   ③④（req 派发、结算清感染、赋予抗体、抗体时限拦截）的判据**未变**，全部保留。
 *
 * 不依赖随机对局：直接构造状态 → 调 Engine.grants → 查额度 → 调步骤 8 req → 提交 → 查结算。
 * 用法：node tools/verify-cureself.cjs <REPO_ROOT>
 * ========================================================================== */
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
const { Engine, Setup } = ctx;

const out = [];
let pass = 0, fail = 0;
const ok = (c, label, extra) => {
  if (c) pass++; else fail++;
  out.push((c ? '  [通过] ' : '  [失败] ') + label + (extra ? '  → ' + extra : ''));
};

/* ── 场景：推进到一个有外星人的夜晚 ─────────────────────────────── */
const g = Setup.createGame(11, 'random');
g.humans = []; g.humanId = -1;
for (const p of g.players) p.isHuman = false;
Engine.begin(g);
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

/* ① 额度口径：正反两例（裁定口径的直接判据） */
out.push('');
out.push('① 额度口径（裁定：每夜「有感染标记」自动赋予一次额度）');

/* ①a 反例：无感染标记 ⇒ 不到账。
   注意顺序：必须先清 infection 再调 grants，否则用的是上一夜的残留值。 */
xeno.cureSelf = 0;
xeno.infection = null;
Engine.grants(g);
out.push('   ①a 无感染标记 → cureSelf = ' + xeno.cureSelf);
ok(xeno.cureSelf === 0, '无感染标记 ⇒ 额度不到账（裁定新增的前置条件）', 'cureSelf=' + xeno.cureSelf);

/* ①b 正例：有感染标记 ⇒ 到账 1 */
xeno.infection = { real: true, night: g.night, kind: 'infect' };
Engine.grants(g);
out.push('   ①b 有感染标记 → cureSelf = ' + xeno.cureSelf);
ok(xeno.cureSelf === 1, '有感染标记 ⇒ 额度到账为 1', 'cureSelf=' + xeno.cureSelf);

/* ①c 未用额度跨夜保留：本实现只在有标记时赋值、不清零，
   故「无标记的下一夜」不会把没用掉的额度收走。裁定未规定累积与否，
   这里锁的是**当前实现事实**（若裁定改口径，此条须同步改）。 */
const carried = xeno.cureSelf;
xeno.infection = null;
Engine.grants(g);
out.push('   ①c 下一夜无标记 → cureSelf = ' + xeno.cureSelf + '（沿用 ' + carried + '）');
ok(xeno.cureSelf === carried, '未用掉的额度不被清零（保留到下一夜）', 'cureSelf=' + xeno.cureSelf);

/* 重新挂感染，供 ②③ 使用 */
xeno.infection = { real: true, night: g.night, kind: 'infect' };
xeno.branch = null;

/* ② 构造真感染，验证步骤 8 req 是否派发 */
const S8 = Engine.STEPS['8'];
const reqOut = S8 && typeof S8.req === 'function' ? (S8.req(g) || []) : [];
const hit = reqOut.some(r => r.pid === xeno.id && r.kind === 'xenoCure');
out.push('');
out.push('② 步骤 8 req 派发（有感染 + cureSelf>0 + 未行动）');
out.push('   req 返回 ' + reqOut.length + ' 项：' + JSON.stringify(reqOut.map(r => r.kind + '@' + r.pid)));
ok(hit, 'req 派发 kind=xenoCure 给外星人 ' + xeno.id);

/* ③ 提交并查结算 */
if (hit) {
  g.decisions = g.decisions || {};
  g.decisions[xeno.id] = { use: true, targets: [xeno.id] };
  const submit8 = S8.submit || S8.run;
  let ran = false, err = '';
  try {
    if (typeof S8.submit === 'function') { S8.submit(g); ran = true; }
    else if (typeof S8.run === 'function') { S8.run(g); ran = true; }
  } catch (e) { err = e.message; }
  out.push('');
  out.push('③ 步骤 8 结算（处理器: ' + (typeof S8.submit === 'function' ? 'submit' : typeof S8.run === 'function' ? 'run' : '无') + '，ran=' + ran + (err ? '，异常=' + err : '') + '）');
  out.push('   infection 现值 = ' + JSON.stringify(xeno.infection));
  ok(!xeno.infection, '感染已清除');
  ok(xeno.antibodyNight === g.night + 1, '写入 antibodyNight = ' + xeno.antibodyNight + '（应为 night+1）',
    'antibodyNight=' + xeno.antibodyNight + ' antibodyBy=' + xeno.antibodyBy);
}

/* ④ 抗体能否真的拦截下一次感染（applyInfection 层序）
   ⚠ 测试构造修正（记录理由）：本段原实现只改 `g.night` 就去调 applyInfection，
   却没清当夜的其他防护层标志，于是**真实第 1 夜警长巡逻留下的 patrolInf=true
   仍然挂着**，在「授予夜+2」那一例里被巡逻层拦下并返回 blocked —— 表现为
   「抗体已过期却仍被拦截」，读起来像实现的 bug，实则是测试把两个变量混在了一起。
   该失败在本次改动**之前**就存在（对 HEAD 版脚本跑同一引擎同样失败），不是回归。
   现改为：每次探测前清空除抗体以外的全部防护层，使 antibodyNight 成为唯一变量，
   这样「抗体在场 ⇒ 拦截」与「抗体过期 ⇒ 落地」两句话才真的各自可验。 */
out.push('');
out.push('④ 抗体拦截（Engine.applyInfection：抗体在效果免疫之前结算）');
const probe = g.players.find(p => p.role === 'xeno');
if (probe) {
  const other = g.players.find(p => !p.out && p.id !== probe.id && p.role === 'alien');
  if (other) {
    /* 抗体的时限语义（卡·生化医师页注）：「仅存在于获得后的下一个夜晚，该夜内抵挡 1 次感染，
       夜末一律失效、不结转、不累积」。引擎存 antibodyNight = 授予夜 + 1，
       applyInfection 判 `t.antibodyNight === g.night` —— 故必须在**下一个夜晚**施加感染。 */
    const grantNight = g.night;
    const eng = ctx.Engine;
    const hasFn = typeof eng.applyInfection === 'function';
    /* 清掉除抗体外的全部防护层，使 antibodyNight 成为唯一变量 */
    const clearOtherLayers = () => {
      probe.safeRoomNight = null; probe.guardInf = false; probe.patrolInf = false;
      if (probe.armor) probe.armor.mode = null;
      probe.infection = null;
    };
    out.push('   Engine.applyInfection 是否导出 = ' + hasFn);
    if (hasFn) {
      g.night = grantNight + 1; probe.antibodyNight = grantNight + 1; clearOtherLayers();
      const resA = eng.applyInfection(g, probe, other);
      const landedA = !!probe.infection;
      g.night = grantNight + 2; probe.antibodyNight = grantNight + 1; clearOtherLayers();  // 同值 ⇒ 过期
      const resB = eng.applyInfection(g, probe, other);
      const landedB = !!probe.infection;
      out.push('   A 授予夜+1（抗体在场）：返回=' + resA + '  infection落地=' + landedA);
      out.push('   B 授予夜+2（抗体过期）：返回=' + resB + '  infection落地=' + landedB);
      ok(resA === 'blocked' && !landedA, '下一个夜晚：有抗体 ⇒ 感染被拦截');
      ok(landedB, '再下一夜：抗体已失效 ⇒ 感染正常落地（卡·时限型，不结转）');
    } else {
      out.push('   （未导出 applyInfection，跳过实测）');
      fail++;
    }
  } else {
    out.push('   （场上无存活异形可施加感染，跳过）');
  }
} else {
  out.push('   （无存活外星人，跳过）');
}

out.push('');
out.push('汇总：通过 ' + pass + ' 条，失败 ' + fail + ' 条');
console.log(out.join('\n'));
const txt = out.join('\n');
try { fs.writeFileSync(process.env.TEMP + '/cureself-verify.txt', txt); } catch (e) { }
process.exit(fail ? 1 : 0);