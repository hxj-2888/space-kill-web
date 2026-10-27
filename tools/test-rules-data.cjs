'use strict';
/* =============================================================
 * test-rules-data.cjs —— 规则数据门禁（批 UI-8c）
 * -------------------------------------------------------------
 * 用户要求：游戏内看三份 v1preview1.0 子文件的内容；把 V6.6 全部移除。
 * 产物 js/data/rules.js 由 tools/gen-rules-data.py 从 PDF 抽取。
 * ============================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const F = path.join(ROOT, 'js', 'data', 'rules.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  [' + extra + ']' : '')); }
}

ok('R0：产物存在（node tools/gen-rules-data.py 生成）', fs.existsSync(F));
if (!fs.existsSync(F)) { process.exitCode = 1; }
else {
  const raw = fs.readFileSync(F, 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(raw, ctx);
  const D = ctx.SKRules || {};

  ok('R1a：结构齐备（cards / glossary / flow 三块都在）',
    Array.isArray(D.cards) && Array.isArray(D.glossary) && Array.isArray(D.flow));
  ok('R1b：三块都不是空壳（卡 >= 10 · 术语 >= 100 · 流程图 >= 8 页）',
    (D.cards || []).length >= 10 && (D.glossary || []).length >= 100 && (D.flow || []).length >= 8,
    'cards=' + (D.cards || []).length + ' gloss=' + (D.glossary || []).length + ' flow=' + (D.flow || []).length);

  const thin = (D.cards || []).filter(function (c) { return Object.keys(c.fields || {}).length < 3; });
  ok('R2：没有只有标题没有内容的空卡（每张至少 3 个字段）', thin.length === 0,
    thin.map(function (c) { return c.name; }).join(','));
  const noName = (D.cards || []).filter(function (c) { return !c.name; });
  ok('R2b：每张卡都有名字', noName.length === 0);

  const bodyOnly = raw.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const v66 = bodyOnly.match(/v6\.6|V6\.6/gi) || [];
  ok('R3：产物正文里没有 V6.6 的援引（用户要求全部移除）', v66.length === 0, v66.join(','));

  ok('R4：版本口径是 v1preview1.0', D.version === 'v1preview1.0', String(D.version));

  const names = (D.cards || []).map(function (c) { return c.name; }).join(' ');
  const must = ['普通船员', '工程师', '警长', '神探', '外星人', '猎手'];
  const missing = must.filter(function (n) { return names.indexOf(n) < 0; });
  ok('R5：核心职业都在（抽查 6 个）', missing.length === 0, missing.join(','));
}

console.log('');
console.log('规则数据门禁：通过 ' + pass + ' 条、失败 ' + fail + ' 条');
if (fail) process.exitCode = 1;