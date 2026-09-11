/* =============================================================
 * index.html 脚本标签同步器
 *
 * 加载清单的唯一真源是 tools/load-order.cjs。本工具把清单渲染成 <script> 标签，
 * 写回 index.html 的标记块内；自动迁移（首次运行自动补标记）。
 *
 * 用法：
 *   node tools/sync-html.cjs           写入
 *   node tools/sync-html.cjs --check   只校验（不一致则退出码 1）
 * ============================================================= */
const fs = require('fs');
const path = require('path');
const { browserTags } = require('./load-order.cjs');

const HTML = path.join(__dirname, '..', 'index.html');
const BEGIN = '<!-- SK:SCRIPTS:BEGIN 由 tools/sync-html.cjs 从 tools/load-order.cjs 生成，勿手改 -->';
const END = '<!-- SK:SCRIPTS:END -->';
const CHECK = process.argv.includes('--check');

const src = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n');
const lines = src.split('\n');
const isTag = l => /<script\s+src=["']js\//.test(l);

let bi = lines.findIndex(l => l.indexOf('SK:SCRIPTS:BEGIN') >= 0);
let ei = lines.findIndex(l => l.indexOf('SK:SCRIPTS:END') >= 0);
let head = [], tail = [], keep = [];

if (bi >= 0 && ei > bi) {
  head = lines.slice(0, bi);
  keep = lines.slice(bi + 1, ei).filter(l => l.trim() && !isTag(l));   // 块内注释保留
  tail = lines.slice(ei + 1);
} else {
  /* 首次迁移：用第一个/最后一个 <script src="js/...> 定界 */
  const idx = lines.map((l, i) => (isTag(l) ? i : -1)).filter(i => i >= 0);
  if (!idx.length) { console.error('未找到任何 <script src="js/..."> 标签'); process.exit(2); }
  const a = idx[0], b = idx[idx.length - 1];
  head = lines.slice(0, a);
  keep = lines.slice(a, b + 1).filter(l => l.trim() && !isTag(l));
  tail = lines.slice(b + 1);
}

const block = [BEGIN, browserTags('  '), ...keep, END];
const out = head.concat(block, tail).join('\n');

if (CHECK) {
  if (out !== src) { console.error('index.html 的脚本块与 load-order.cjs 不一致（跑 node tools/sync-html.cjs 修正）'); process.exit(1); }
  console.log('index.html 脚本块与清单一致 ✓');
  process.exit(0);
}
if (out === src) { console.log('index.html 无需变更 ✓'); process.exit(0); }
fs.writeFileSync(HTML, out);
console.log('index.html 脚本块已同步（' + browserTags().split('\n').length + ' 个标签）');
