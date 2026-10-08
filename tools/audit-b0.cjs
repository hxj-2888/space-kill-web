'use strict';
/* B0 归档完整性审计（归档≠删除：每条都要能被独立复核） */
const fs = require('fs');
const path = require('path');
const repo = 'C:/Users/ASUS/Desktop/太空杀游戏-完整版';

const EXPECT = [
  ['corpus/_retired/channels.data.js', '通道总表', 506],
  ['corpus/_retired/channels.retired.js', '判据失效台账', 38],
  ['corpus/_retired/channels.js', '通道查询门面', null],
  ['infer/_retired/moe.js', 'MoE 专家层', null],
  ['infer/_retired/channels.run.js', '通道执行器', null],
  ['infer/_retired/registry.js', '专家注册表', null],
  ['infer/_retired/predicates.js', '通道谓词层', null],
];

console.log('=== B0 归档完整性审计 ===\n');
let bad = 0, totalBytes = 0;
for (const [rel, label, expectN] of EXPECT) {
  const abs = path.join(repo, 'js', rel);
  if (!fs.existsSync(abs)) { console.log('  [缺失] ' + rel); bad++; continue; }
  const buf = fs.readFileSync(abs);
  const s = buf.toString('utf8');
  totalBytes += buf.length;
  let n = null;
  if (expectN != null) {
    if (rel.includes('channels.data')) n = (s.match(/id:\s*'[A-Z]\d+'/g) || []).length;
    if (rel.includes('channels.retired')) {
      const i = s.indexOf('const RETIRED = {'), j = s.indexOf('};', i);
      n = [...s.slice(i, j).matchAll(/\b([A-Z]\d{1,3})\s*:/g)].length;
    }
  }
  const okN = n == null || n === expectN;
  if (!okN) bad++;
  console.log('  ' + (okN ? 'OK  ' : 'BAD ') + rel.padEnd(38)
    + (buf.length + ' B').padStart(9)
    + (n != null ? '   条目 ' + n + '/' + expectN : ''));
}

// 专家模块
const modDir = path.join(repo, 'js', 'infer', '_retired', 'modules');
let mods = 0;
if (fs.existsSync(modDir)) {
  for (const f of fs.readdirSync(modDir)) {
    const b = fs.statSync(path.join(modDir, f)).size;
    totalBytes += b; mods++;
    console.log('  OK   infer/_retired/modules/' + f.padEnd(24) + (b + ' B').padStart(9));
  }
}
console.log('\n  归档文件 ' + (EXPECT.length + mods) + ' 个，合计 ' + (totalBytes / 1024).toFixed(0) + ' KB');

// 活代码中不得再有残留引用（_retired 之外）
console.log('\n=== 活代码残留引用检查（不含 _retired / 不含注释）===');
const DEAD = ['MoE', 'Channels', 'SKChannelsData', 'SKChanGates', 'MoERegistry', 'SK_CHAN_MODE', 'runChannelsAll'];
const strip = line => line
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/, '$1');
function walk(d, out) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === '_retired') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const live = walk(path.join(repo, 'js'), []);
const hits = {};
for (const f of live) {
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const c = strip(line);
    for (const d of DEAD) {
      if (new RegExp('\\b' + d + '\\b').test(c)) {
        const k = path.relative(repo, f).replace(/\\/g, '/');
        (hits[k] = hits[k] || []).push(d);
      }
    }
  }
}
const keys = Object.keys(hits);
if (!keys.length) console.log('  OK   活代码中零残留');
else {
  console.log('  共 ' + keys.length + ' 个文件仍有引用（按文件列出符号）：');
  for (const k of keys.sort()) console.log('       ' + k.padEnd(34) + [...new Set(hits[k])].join(','));
}
console.log('\n审计结论：' + (bad ? 'BAD ' + bad + ' 项不符' : '全部通过'));