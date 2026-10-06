#!/usr/bin/env node
/* =============================================================
 * 太空杀 · 步位覆盖审计（C1 收口：声明 ↔ 引擎 的闭合检查）
 *
 * 做什么：跑若干局，记录**引擎实际派发过决策**的每个步位及其角色集合，
 *         与声明层（RoleDecl.actionSteps ∪ 机制 owner ∪ 步位参与者规则）比对，
 *         报告「引擎派发了、声明未覆盖」的缺口。
 *
 * 为什么重要：C1「三层收口」的前提是声明层必须完整描述引擎的派发面。
 *   缺口意味着「某个角色在某步位能出手，但声明层不知道」——加角色/改行动位时
 *   就会漏改，正是 K1 类框死点的成因。本审计把该前提变成可复跑的数字。
 *
 * 用法：node tools/audit-step-coverage.cjs [局数]
 * 退出码：0＝无缺口；1＝存在缺口（逐条列出）。
 * ============================================================= */
'use strict';
const path = require('path');
const { makeCtx, loadInto, profiles } = require('./load-order.cjs');

const N = parseInt(process.argv[2] || '10', 10);
const ctx = makeCtx({ RegExp });
loadInto(ctx, path.join(__dirname, '..', 'js'), profiles.full);
const { Setup, Engine, SKDerivation: DER, SKEventFamily: EF } = ctx;

const seen = new Map();                       // step -> Set(role)
const combos = new Map();                     // step -> Set(batch)（来自 g.log 的实际发布点）
for (let i = 0; i < N; i++) {
  const g = Setup.createGame(9900 + i, 'random');
  g.humanId = -1; g.humans = [];
  Engine.begin(g);
  let steps = 0;
  while (!g.over && steps < 4000) {
    const S = Engine.STEPS[g.step];
    if (S && typeof S.req === 'function') {
      let r = [];
      try { r = S.req(g) || []; } catch (e) { /* 某些步位 req 依赖当步上下文，忽略取样失败 */ }
      if (r.length) {
        if (!seen.has(g.step)) seen.set(g.step, new Set());
        for (const it of r) { const p = Engine.P(g, it.pid); if (p) seen.get(g.step).add(p.role); }
      }
    }
    Engine.stepOnce(g);
    steps++;
    if (g.pending) {
      const f = g.pending, d = { opt: null, targets: [], num: null, text: '' };
      if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) d.opt = u[0].v; }
      if (f.targets) { const l = Engine.alive(g); if (l.length) d.targets.push(l[0].id); }
      if (f.num) d.num = f.num.options[0].v;
      Engine.submit(g, d);
    }
  }
  /* 步位 × 批次：日志里的批次发布于哪个步位，必须与契约声明一致（含在案待裁决批次） */
  for (const e of g.log) {
    if (!e.batch) continue;
    if (!combos.has(e.step)) combos.set(e.step, new Set());
    combos.get(e.step).add(e.batch);
  }
}

let gaps = 0, undeclaredSlots = 0;
console.log(`步位覆盖审计（${N} 局，种子基准 9900）`);
for (const st of [...seen.keys()].sort((a, b) => String(a).localeCompare(String(b)))) {
  const roles = [...seen.get(st)].sort();
  const gap = DER.coverageGap(st, roles);
  const inTable = !!EF.STEP_INDEX[st];
  if (!inTable) undeclaredSlots++;
  if (gap.length) gaps++;
  console.log(`  ${String(st).padEnd(9)} ${(inTable ? '已登记' : '未登记').padEnd(4)} ` +
    `实际=${roles.length} 声明=${DER.declaredActors(st).length} ` +
    (gap.length ? `✗ 缺口: ${gap.join(',')}` : '✓'));
}
const selfAudit = EF.audit().concat(DER.audit());
console.log(`\n步位覆盖: 总数 ${seen.size} · 存在缺口 ${gaps} · 未登记步位 ${undeclaredSlots}`);

/* ---------- 第二项审计：步位 × 批次（契约声明「哪一步产哪个批次」） ---------- */
console.log('\n步位 × 批次一致性审计');
let batchBad = 0;
for (const st of [...combos.keys()].sort((a, b) => String(a).localeCompare(String(b)))) {
  const actual = [...combos.get(st)].sort();
  const declared = EF.batchesOfStepAll(st).slice().sort();
  const missing = actual.filter(b => declared.indexOf(b) < 0);
  if (missing.length) batchBad++;
  console.log(`  ${String(st).padEnd(9)} 实际=${JSON.stringify(actual).padEnd(20)} 契约=${JSON.stringify(declared).padEnd(20)} ` +
    (missing.length ? `✗ 契约未声明: ${missing.join(',')}` : '✓'));
}
console.log(`步位×批次: ${combos.size} 个步位 · 不一致 ${batchBad}`);
console.log(`契约自检: ${selfAudit.length ? '✗ ' + selfAudit.join('；') : '✓ 空'}`);
process.exit((gaps || undeclaredSlots || batchBad || selfAudit.length) ? 1 : 0);
