#!/usr/bin/env node
/* =============================================================
 * selfcheck-actions.cjs —— 动作映射表门禁的**反向自检**（批 RTA-0 / R0 · 2026-10-28）
 * -------------------------------------------------------------
 * 规矩（AGENTS 红线 11）：新增断言必须能被打红，否则它只是装饰。
 * 做法：每次改一处**源**（md 或生成器）→ 重新生成 → 跑门禁 → 断言 ACn 变红 → 还原。
 * 还原时必须**再生成一次**，否则 js 与 md 不同步，后续批次会踩到脏工作区。
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MD = path.join(ROOT, 'docs', '动作映射表_实时行动_20261028.md');
const GEN = path.join(ROOT, 'tools', 'gen-action-map.cjs');
const TEST = path.join(ROOT, 'tools', 'test-actions.cjs');

function gen() { execFileSync(process.execPath, [GEN], { cwd: ROOT }); }
function runTest() {
  try {
    return execFileSync(process.execPath, [TEST], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}
function patch(file, from, to) {
  const s = fs.readFileSync(file, 'utf8');
  if (s.indexOf(from) < 0) return null;
  fs.writeFileSync(file, s.split(from).join(to), 'utf8');
  return s;
}
let bad = 0;
function mutate(file, from, to, label, tag) {
  const orig = patch(file, from, to);
  if (orig == null) { console.log('  ✗ ' + label + ' —— 变异未命中（源里找不到那段）'); bad++; return; }
  gen();
  const out = runTest();
  fs.writeFileSync(file, orig, 'utf8');
  gen();
  const hit = new RegExp('✗\\s*' + tag).test(out);
  if (hit) console.log('  ✓ ' + label + ' ⇒ ' + tag + ' 红（预期）');
  else { console.log('  ✗ ' + label + ' ⇒ ' + tag + ' 仍绿（断言空转）'); bad++; }
}

console.log('\n反向自检（动作映射表）：');

/* AC1：改一个 kind 成引擎没有的名字 */
mutate(MD, '| `crew.escape` | escape |', '| `crew.escape` | escapeZZ |',
  'AC1 动作引用不存在的 kind', 'AC1');

/* AC2：改一个物件成房间里没有的 */
mutate(MD, 'armory/weapon_rack', 'armory/ammo_box_typo',
  'AC2 场所指向不存在的物件', 'AC2');

/* AC3：把一个 grant 权能的来源改成非法值 */
mutate(GEN, "sniff: 'grant',", "sniff: 'bogus',",
  'AC3 权能来源非法（bogus）', 'AC3');

/* AC4：把一个用 grant 的动作换成别的权能 ⇒ 该 grant 没有动作（反向覆盖） */
mutate(GEN, "'doctor.medicine': 'brew',", "'doctor.medicine': 'base.chat',",
  'AC4 声明层的 brew 没有动作（声明了却点不出来）', 'AC4');

console.log('');
if (bad) { console.log('反向自检失败 ' + bad + ' 项 —— 有断言是空转的'); process.exit(1); }
console.log('反向自检全部通过');
