'use strict';
/* judge-probe 基线 vs B0 后的对照解析（两份报告文本 → 关键指标表） */
const fs = require('fs');
const A = fs.readFileSync(process.argv[2], 'utf8');   // 基线
const B = fs.readFileSync(process.argv[3], 'utf8');   // B0 后

/* 解析「命中 N」行 */
function tally(t) {
  const out = {};
  const re = /\[(P\d)\]\s+(S\d|R\d|A\d)[^\n]*?\n?[^\n]*?命中\s+(\d+)/g;
  let m;
  while ((m = re.exec(t))) out[m[2]] = +(m[3] || 0);
  return out;
}
/* 解析「标签 : 值」结算行 */
function kv(t) {
  const out = {};
  const re = /^\s*([^:\n]{2,24}?)\s*[:：]\s*([^\n]+)$/gm;
  let m;
  while ((m = re.exec(t))) {
    const k = m[1].trim();
    if (/命中|╔|═|║|╚/.test(k)) continue;
    if (out[k] == null) out[k] = m[2].trim();
  }
  return out;
}

const ta = tally(A), tb = tally(B);
const ka = kv(A), kb = kv(B);

console.log('═══ judge-probe 判罚项（300 局）═══\n');
console.log('  ' + '判罚'.padEnd(46) + '基线'.padStart(8) + '  ' + 'B0后'.padStart(8) + '     Δ');
console.log('  ' + '-'.repeat(74));
const NAMES = {
  R1: 'R1 声称查验某人而本人无查验记录',
  R2: 'R2 引"公告白纸黑字"但身份从未公开',
  R3: 'R3 发起指控却给不出任何推理链',
  R4: 'R4 对方已改口自相矛盾，全程未引用',
  S1: 'S1 轮到发言却产出空话',
  S2: 'S2 第0夜引用"昨晚"',
  S3: 'S3 宣称"昨夜无人死亡"但确有人出局',
  S4: 'S4 发言引用查验结果但本人无记录',
  S5: 'S5 复读：同一玩家重复完全相同句子',
  S6: 'S6 指名投某人却未给出任何依据',
  S7: 'S7 指控凭空：账本无负面证据',
  S8: 'S8 战术库死条目（无文本无动作）',
  A1: 'A1 人类口称"X号"却实投他人',
  A2: 'A2 异形投票把队友送上驱逐台',
};
for (const k of Object.keys(NAMES)) {
  const a = ta[k], b = tb[k];
  if (a == null && b == null) continue;
  const d = (b || 0) - (a || 0);
  console.log('  ' + NAMES[k].padEnd(44) + String(a == null ? '—' : a).padStart(8)
    + '  ' + String(b == null ? '—' : b).padStart(8)
    + '   ' + (d > 0 ? '+' : '') + d);
}

console.log('\n═══ 结算层 ═══\n');
console.log('  ' + '指标'.padEnd(30) + '基线'.padStart(16) + '  ' + 'B0后'.padStart(16));
console.log('  ' + '-'.repeat(66));
const pick = (k, obj) => obj[k] || '(未采集)';
const KEYS = ['局数', '完成', '异常', 'speak 总调用', '空发言', '第三次及以上复读', '句子多样性',
  'reasoningChain 调用', '返回空(null)', '账本记录的改口次数', '其中被发言引用',
  '出现过改口的局', 'pickTactic 调用', '死条目'];
for (const k of KEYS) {
  const a = ka[k], b = kb[k];
  if (a == null && b == null) continue;
  console.log('  ' + k.padEnd(28) + String(a || '—').padStart(16) + '  ' + String(b || '—').padStart(16));
}

/* 最高频句子 */
function topFreq(t) {
  const m = t.match(/最高频句子[^\n]*\n([^\n]*)/);
  if (!m) return null;
  const hits = [...m[1].matchAll(/(\d+)×/g)].map(x => +x[1]);
  const txt = [...m[1].matchAll(/×\s*「([^」]*)」/g)].map(x => x[1]);
  return { hits, txt };
}
const fa = topFreq(A), fb = topFreq(B);
console.log('\n═══ 最高频句子 Top6 ═══');
if (fa) fa.hits.slice(0, 6).forEach((h, i) =>
  console.log('  基线 ' + String(h).padStart(5) + '×  ' + (fa.txt[i] || '').slice(0, 34)));
if (fb) fb.hits.slice(0, 6).forEach((h, i) =>
  console.log('  B0后 ' + String(h).padStart(5) + '×  ' + (fb.txt[i] || '').slice(0, 34)));