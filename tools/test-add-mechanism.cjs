#!/usr/bin/env node
/* =============================================================
 * 太空杀 · H3 验收：加机制只改声明层（K1/C2/C5 的机械证据）
 *
 * 与 H1（tools/test-add-role.cjs）同制，验收对象换成「机制」：
 *   ① 把 js/ 整树复制到临时目录；
 *   ② **只**改副本里的 js/v66/declaration/capabilityRegistry.js——追加一条机制声明
 *      （演习机制：某角色在既有步位上的新机制，十关齐备）；
 *   ③ 用副本加载完整栈，检查推导层倒排索引是否自动纳入该机制（C5：机制 → 候选发出者；
 *      C4：机制 → 产出观测），并跑整局确认零异常；
 *   ④ 逐文件比对副本与源树：**除 capabilityRegistry.js 外必须逐字节一致**。
 *
 * 判定：任一环节失败即视为 K1/C2 破口（新增机制被迫改第二个文件）。
 * 用法：node tools/test-add-mechanism.cjs
 * ============================================================= */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeCtx, loadInto, profiles } = require('./load-order.cjs');

const ROOT = path.join(__dirname, '..');
const SRC_JS = path.join(ROOT, 'js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-addmech-'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  → ' + extra : ''}`); }
};

/* ---------- ① 复制整树 ---------- */
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}
const TMP_JS = path.join(TMP, 'js');
copyTree(SRC_JS, TMP_JS);

/* ---------- ② 只改声明层：追加一条机制声明 ---------- */
const REG = path.join(TMP_JS, 'v66', 'declaration', 'capabilityRegistry.js');
const src = fs.readFileSync(REG, 'utf8');
const ANCHOR = "  const MECHANISMS = {";
if (src.indexOf(ANCHOR) < 0) {
  console.error('fixture 锚点缺失：capabilityRegistry.js 中找不到 MECHANISMS 表头');
  process.exit(2);
}
/* 十关齐备的 fixture：
   · steps=['6'] 且 actionStep 原文含「步骤6」——生成器的「策展 × 正文核对」要求二者一致；
   · owner 指定已在册角色（sheriff），故本 fixture 不引入新角色，纯粹验证「加机制」；
   · 该步位产出批次⑤（4b）之外的观测：这里挂 ⑥（死亡名单）无关，故只验 C5 倒排与契约一致性。 */
const NEW_MECH = `    '__fixture_tracer': {
      clause: 'fixture/H3', owner: 'sheriff', mechanism: '演习·追踪弹（H3 fixture）', lines: 'fixture',
      steps: ['6'],
      pendingRole: [],
      gates: {
        actionStep: { verbatim: '步骤6（与警长同行动位，fixture）', lines: 'fixture' },
        seat: { verbatim: '与警长同席位（fixture）', lines: 'fixture' },
        judgeMode: { verbatim: '字面身份（2.8.1①）', lines: 'fixture' },
        damageLayer: { verbatim: '依2.8.2，枪击不另设层序', lines: 'fixture' },
        infectLayer: { verbatim: '不参与（fixture）', lines: 'fixture' },
        visibility: { verbatim: '依2.8.7 仅本人可见', lines: 'fixture' },
        blocked: { verbatim: '受沉默与感染抑制封锁（2.8.3③）', lines: 'fixture' },
        exempt: { verbatim: null, status: '未明文（⑥无豁免项）', lines: null },
        charges: { verbatim: '额度记账依 2.5（fixture）', lines: 'fixture' },
        process: { verbatim: null, status: '未明文', lines: null },
        batchDelta: { verbatim: '不新增公告批次（2.1.6）', lines: 'fixture' },
        restatement: { verbatim: '已标注〔适用〕', lines: 'fixture' },
      },
    },
`;
fs.writeFileSync(REG, src.replace(ANCHOR, ANCHOR + '\n' + NEW_MECH), 'utf8');

/* ---------- ③ 推导层倒排 + 整局运行 ---------- */
const ctx = makeCtx({ RegExp });
loadInto(ctx, TMP_JS, profiles.full);
const CAP = ctx.SKCapability, DER = ctx.SKDerivation, EF = ctx.SKEventFamily;
const D = ctx.SKData, Setup = ctx.Setup, Engine = ctx.Engine;

ok('H3：新机制已进注册表（无需改任何其他文件）',
  CAP.keys().indexOf('__fixture_tracer') >= 0 && CAP.get('__fixture_tracer').owner === 'sheriff');
ok('H3：注册表自检仍为空（十关齐备、策展 steps 能在 actionStep 原文中找到、键不含编号）',
  CAP.audit().length === 0, CAP.audit().join('；'));
ok('C5：新机制自动进入该步位的倒排索引（mechanismsAt / sendersAt 零改动纳入）',
  CAP.mechanismsAt('6').indexOf('__fixture_tracer') >= 0 &&
  DER.sendersAt('6').indexOf('sheriff') >= 0,
  JSON.stringify(CAP.mechanismsAt('6')));
ok('C4：产出观测的倒排不受影响（新机制未声明新批次 ⇒ 不引入未登记批次）',
  CAP.get('__fixture_tracer').gates.batchDelta.verbatim.indexOf('不新增') >= 0 &&
  EF.audit().length === 0);
ok('C5：sendersOf 正确解析新机制的候选发出者（owner 已在册 ⇒ pendingRole 为空）',
  DER.sendersOf('__fixture_tracer').length === 1 &&
  DER.sendersOf('__fixture_tracer')[0].role === 'sheriff' &&
  DER.sendersOf('__fixture_tracer')[0].pendingRole === false);

/* 整局运行：新机制在位时既有对局零异常（机制未接线，故不改变行为） */
const play = seed => {
  const g = Setup.createGame(seed, 'random');
  g.humanId = -1; g.humans = [];
  Engine.begin(g);
  let steps = 0;
  while (!g.over && steps < 4000) {
    Engine.stepOnce(g);
    steps++;
    if (g.pending) {
      const f = g.pending, data = { opt: null, targets: [], num: null, text: '' };
      if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) data.opt = u[0].v; }
      if (f.targets) { const l = Engine.alive(g); if (l.length) data.targets.push(l[0].id); }
      if (f.num) data.num = f.num.options[0].v;
      Engine.submit(g, data);
    }
  }
};
const errs = [];
for (let i = 0; i < 15; i++) { try { play(9700 + i); } catch (e) { errs.push('seed ' + (9700 + i) + ': ' + e.message); } }
ok('H3：新机制声明在位时 15 局完整对局零异常（声明不污染既有机制）', errs.length === 0, errs.slice(0, 2).join(' | '));

/* 非法机制声明必须被 audit 拦下（防「声明写错却静默无人命中」） */
CAP.MECHANISMS.__bad_mech = {
  clause: 'fixture/bad', owner: 'sheriff', mechanism: '坏机制', lines: 'fixture', steps: ['9'],
  pendingRole: [],
  gates: { actionStep: { verbatim: '步骤 6（步位不符：steps 写 9）', lines: 'fixture' } },
};
const badCaught = CAP.audit().some(x => x.indexOf('__bad_mech') >= 0);
delete CAP.MECHANISMS.__bad_mech;
ok('H3：步位与 actionStep 原文不符的机制声明被 audit 拦下（策展 × 正文交叉核对）', badCaught,
  CAP.audit().join('；'));
delete CAP.MECHANISMS.__fixture_tracer;
ok('H3：清理临时声明后注册表复原（条数回到转录条数、自检回到空）',
  CAP.keys().length === CAP.META.blockCount && CAP.audit().length === 0,
  String(CAP.keys().length) + '/' + CAP.META.blockCount);

/* ---------- ④ 逐文件比对：除 capabilityRegistry.js 外必须逐字节一致 ---------- */
const diffs = [];
(function compare(a, b, rel) {
  for (const e of fs.readdirSync(a, { withFileTypes: true })) {
    const sa = path.join(a, e.name), sb = path.join(b, e.name), r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { if (!fs.existsSync(sb)) { diffs.push(r + '（副本缺失目录）'); continue; } compare(sa, sb, r); }
    else {
      if (!fs.existsSync(sb)) { diffs.push(r + '（副本缺失）'); continue; }
      if (!fs.readFileSync(sa).equals(fs.readFileSync(sb))) diffs.push(r);
    }
  }
})(SRC_JS, TMP_JS, '');
ok('H3（核心）：加机制后**唯一**被改动的文件是 v66/declaration/capabilityRegistry.js',
  diffs.length === 1 && diffs[0] === 'v66/declaration/capabilityRegistry.js', diffs.join(', '));

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nH3 加机制验收：通过 ${pass} 条、失败 ${fail} 条`);
process.exit(fail ? 1 : 0);
