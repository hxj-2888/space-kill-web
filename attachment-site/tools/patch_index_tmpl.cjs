'use strict';
// 一次性工具：把 build_site.py 的 INDEX_TMPL 常量整体替换为 new_index.tmpl 内容
const fs = require('fs');

const pyPath = 'C:/Users/ASUS/Desktop/太空杀游戏-完整版/attachment-site/tools/build_site.py';
const tmplPath = 'C:/Users/ASUS/Desktop/.tmp_docs/new_index.tmpl';

const py = fs.readFileSync(pyPath, 'utf8');
const tmpl = fs.readFileSync(tmplPath, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '\n');

const startMarker = 'INDEX_TMPL = """';
const start = py.indexOf(startMarker);
if (start < 0) throw new Error('INDEX_TMPL start not found');
const endMarker = '\n"""';
const end = py.indexOf(endMarker, start + startMarker.length);
if (end < 0) throw new Error('INDEX_TMPL end not found');

const out = py.slice(0, start) + 'INDEX_TMPL = """\n' + tmpl + py.slice(end);
fs.writeFileSync(pyPath, out);
console.log('spliced. new py bytes:', Buffer.byteLength(out));
console.log('old block bytes:', end - start, '-> new block bytes:', startMarker.length + tmpl.length);
