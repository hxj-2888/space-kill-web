#!/usr/bin/env node
/* =============================================================
 * action-map-text · 把「动作映射表」md 转成**纯文字**（批 RTA-0 · 2026-10-28）
 * -------------------------------------------------------------
 * 用途：讨论/批注时看 txt 比看 md 表舒服（不需要渲染器、不会被宽表挤断行）。
 *       供 `docs/动作映射表_实时行动_20261028.md` 用；**改表仍然改 md**，
 *       改完跑一次本工具重新生成 txt，避免两份内容漂移。
 *
 * 用法：
 *   node tools/action-map-text.cjs                 # → 桌面/动作映射表_实时行动_纯文字_20261028.txt
 *   node tools/action-map-text.cjs <输出路径>
 *
 * 规则：
 *   · 14 列的"动作表" → 一条动作一段（字段对齐，适合逐行批注）；
 *   · 其它表（列定义/争夺域/关系） → 一行一条，字段用「｜」串起来；
 *   · 输出 UTF-8 **带 BOM**（Windows 记事本双击不乱码）。
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'docs', '动作映射表_实时行动_20261028.md');
const OUT = process.argv[2] || path.join(
  process.env.USERPROFILE || 'C:/Users/ASUS', 'Desktop', '动作映射表_实时行动_纯文字_20261028.txt');

const ACT_COLS = ['id', 'kind', '权能', '场所', '目标', '距', '时长', '冷却', '消耗', '结算', '反制', '目击', '争夺域', 'AI'];
const FIELD_CN = {
  id: '动作', kind: '旧kind', 权能: '指纹', 场所: '场所', 目标: '目标', 距: '距离',
  时长: '时长', 冷却: '冷却', 消耗: '消耗', 结算: '结算', 反制: '反制', 目击: '目击', 争夺域: '争夺域', AI: 'AI倾向',
};
const RULE = '='.repeat(72);
const RULE2 = '-'.repeat(72);

function clean(s) {
  return String(s == null ? '' : s)
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/⟂/g, '⟂')
    .trim();
}
function cells(line) {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(clean);
}
const isSep = (line) => /^\|[\s:|-]+\|$/.test(line.trim());

const md = fs.readFileSync(SRC, 'utf8').split('\n');
const out = [];
out.push(RULE);
out.push('动作映射表 · 实时行动版 —— 纯文字版');
out.push('来源：docs/动作映射表_实时行动_20261028.md（改表请改 md，再跑 tools/action-map-text.cjs）');
out.push('标记：⟂ = 权能待与 roleDecl 核准；《暂定》= 数值未定；— = 不适用');
out.push(RULE);
out.push('');

let title = '';
let actIdx = 0;
for (let i = 0; i < md.length; i++) {
  const raw = md[i];
  const line = raw.replace(/\s+$/, '');
  if (!line.trim()) { if (out[out.length - 1] !== '') out.push(''); continue; }

  if (/^#\s/.test(line)) { title = clean(line.replace(/^#\s*/, '')); continue; }

  if (/^##\s/.test(line)) {
    const t = clean(line.replace(/^##\s*/, ''));
    out.push('');
    out.push('【' + t + '】');
    out.push(RULE2);
    continue;
  }
  if (/^###\s/.test(line)) {
    const t = clean(line.replace(/^###\s*/, ''));
    out.push('');
    out.push('■ ' + t);
    out.push(RULE2);
    continue;
  }
  if (/^>/.test(line)) {
    out.push('  ' + clean(line.replace(/^>\s?/, '')));
    continue;
  }

  if (/^\|/.test(line.trim())) {
    /* 收集一张完整表格 */
    const tbl = [];
    while (i < md.length && /^\|/.test(md[i].trim())) {
      if (!isSep(md[i])) tbl.push(cells(md[i].trim()));
      i++;
    }
    i--;
    const head = tbl[0] || [];
    const rows = tbl.slice(1);
    const isAction = head.length === ACT_COLS.length && head[0] === 'id' && head[1] === 'kind';
    if (isAction) {
      for (const r of rows) {
        actIdx++;
        const id = r[0] || '?';
        out.push('');
        out.push('[' + String(actIdx).padStart(2, '0') + '] ' + id + '    （旧 kind：' + (r[1] || '—') + '）');
        const pairs = [];
        for (let k = 2; k < ACT_COLS.length; k++) {
          const v = r[k] == null ? '' : r[k];
          if (!v || v === '—') continue;
          pairs.push(FIELD_CN[ACT_COLS[k]] + '：' + v);
        }
        /* 每行两条，纯文字下更好读 */
        for (let k = 0; k < pairs.length; k += 2) {
          out.push('     ' + pairs[k] + (pairs[k + 1] ? '    ' + pairs[k + 1] : ''));
        }
      }
      out.push('');
      continue;
    }
    /* 普通表：一行一条 */
    for (const r of rows) {
      const first = r[0] || '';
      const rest = r.slice(1).filter(v => v && v !== '—');
      out.push('  · ' + first + (rest.length ? ' ｜ ' + rest.join(' ｜ ') : ''));
    }
    out.push('');
    continue;
  }

  /* 普通段落 / 编号列表 */
  if (/^\d+\.\s/.test(line)) { out.push('  ' + clean(line)); continue; }
  out.push('  ' + clean(line));
}

const text = out.join('\r\n').replace(/\r\n{3,}/g, '\r\n\r\n') + '\r\n';
fs.writeFileSync(OUT, '\uFEFF' + text, 'utf8');
console.log('已生成纯文字版：' + OUT);
console.log('  动作条目 ' + actIdx + ' 条 · ' + (text.length / 1024).toFixed(1) + ' KB');
