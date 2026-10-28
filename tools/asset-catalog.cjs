#!/usr/bin/env node
/* =============================================================
 * asset-catalog · 素材台账与引用扫描（批 ART-0 · 2026-10-28）
 * -------------------------------------------------------------
 * 为什么要有它（规范见 docs/工程规范_模块化_20261028.md §六）：
 *   `assets/scene/` 只有一份**人工**台账（CREDITS.md），"哪张素材零引用""哪张参考图
 *   被误引用进了代码""磁盘与台账是否一致"全靠人眼。美术素材对齐要靠这份东西做基线。
 *
 * 三类产物：
 *   assets/MANIFEST.json   机器台账（路径 / 字节 / 尺寸 / sha1 / 引用计数 / 类别）
 *   --write                重写台账（换素材后跑这个）
 *   --check                校验台账与磁盘一致 + refs 规范（门禁 `npm run test:assets`）
 *   --unused               列出零引用素材（**只报告不判红**：历史素材很多，见下）
 *
 * 引用怎么数（为什么不按完整路径数）：
 *   代码里的路径大多是**拼接**的（`ASSET + 'tiles/' + r.floor + '.png'`、
 *   `'crew-' + String(id).padStart(2,'0')`），完整路径根本不出现在源码里。
 *   所以按"文件名去扩展名"（stem）在 js/ space.js css/ index.html 里数出现次数；
 *   完整相对路径额外数一次（能数到的是硬引用）。
 *
 * ⚠ 零引用 **不判红**：assets/scene/station（97 件 Kenney）、rooms、characters 是历史批次
 *   留下来的整包素材，产品已经不引用它们（CREDITS.md 有留痕）。判红会逼着人删素材，
 *   而"删素材"必须单独一批、逐张核对许可 —— 这里只负责把清单摊开。
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'assets', 'MANIFEST.json');
const REFS_DIR = path.join(ROOT, 'assets', 'refs');
const REFS_README = path.join(REFS_DIR, 'README.md');
const CREDITS = path.join(ROOT, 'assets', 'scene', 'CREDITS.md');
const IMG = /\.(png|jpe?g|webp|gif)$/i;

function walk(dir, base, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else if (IMG.test(e.name)) out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}

/* 尺寸：PNG 读 IHDR；JPEG 扫 SOF；读不出返回 null（不算错，台账里写 null） */
function imageSize(abs) {
  let buf;
  try { buf = fs.readFileSync(abs); } catch (_) { return null; }
  if (buf.length > 24 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
    for (let i = 2; i < buf.length - 9;) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

/* 源码文本池：js/**（含 space.js 的素材名）、css/**、index.html —— 引用只可能来自这三处 */
function sourcePool() {
  const parts = [];
  const add = (rel) => {
    const p = path.join(ROOT, rel);
    if (fs.existsSync(p)) parts.push({ rel: rel, text: fs.readFileSync(p, 'utf8') });
  };
  (function rec(rel) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel + '/' + e.name;
      if (e.isDirectory()) { if (!/_retired|node_modules/.test(e.name)) rec(r); }
      else if (/\.(js|cjs|css|html)$/i.test(e.name)) add(r);
    }
  })('js');
  add('index.html');
  add('_headers');
  return parts;
}

function countRefs(pool, relPath, stem) {
  let hits = 0, where = [];
  for (const f of pool) {
    let n = 0;
    const exact = f.text.split(relPath).length - 1;
    n += exact;
    if (stem && stem.length >= 4) n += f.text.split(stem).length - 1;
    if (n) { hits += n; if (where.length < 3) where.push(f.rel + '×' + n); }
  }
  return { n: hits, where: where };
}

function build() {
  const pool = sourcePool();
  const sceneAbs = path.join(ROOT, 'assets', 'scene');
  const sceneFiles = walk(sceneAbs, ROOT, []);
  const refFiles = fs.existsSync(REFS_DIR)
    ? fs.readdirSync(REFS_DIR, { withFileTypes: true }).filter(e => e.isFile() && IMG.test(e.name))
      .map(e => 'assets/refs/' + e.name) : [];
  const items = [];
  for (const rel of sceneFiles.concat(refFiles)) {
    const abs = path.join(ROOT, rel);
    const buf = fs.readFileSync(abs);
    const size = imageSize(abs);
    const stem = path.basename(rel).replace(IMG, '');
    const ref = countRefs(pool, rel, stem);
    items.push({
      path: rel,
      kind: rel.indexOf('assets/refs/') === 0 ? 'ref' : 'scene',
      bytes: buf.length,
      dim: size ? size.w + 'x' + size.h : null,
      sha1: crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16),
      refs: ref.n,
    });
  }
  items.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { generated: 'tools/asset-catalog.cjs --write', count: items.length, items: items };
}

function write() {
  const m = build();
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 1) + '\n', 'utf8');
  console.log('台账已写入 assets/MANIFEST.json：' + m.count + ' 个文件');
  return 0;
}

function check() {
  const bad = [];
  if (!fs.existsSync(MANIFEST)) {
    console.log('✗ 缺少 assets/MANIFEST.json（先跑 node tools/asset-catalog.cjs --write）');
    return 1;
  }
  const disk = build();
  const old = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const oldMap = {};
  for (const it of (old.items || [])) oldMap[it.path] = it;
  for (const it of disk.items) {
    const o = oldMap[it.path];
    if (!o) { bad.push('台账缺：' + it.path); continue; }
    if (o.sha1 !== it.sha1) bad.push('内容变了：' + it.path);
    delete oldMap[it.path];
  }
  for (const p of Object.keys(oldMap)) bad.push('台账多了（磁盘已无）：' + p);

  /* 参考图规范：① 必须在 refs/README.md 登记 ② 不得被 js/css/html 引用 */
  let readme = '';
  try { readme = fs.readFileSync(REFS_README, 'utf8'); } catch (_) { bad.push('缺少 assets/refs/README.md'); }
  for (const it of disk.items) {
    if (it.kind !== 'ref') continue;
    const name = path.basename(it.path);
    if (name === 'README.md') continue;
    if (readme && readme.indexOf(name) < 0) bad.push('参考图未登记（refs/README.md）：' + name);
    if (it.refs > 0) bad.push('参考图被代码引用（必须移出 refs/）：' + it.path);
  }

  /* 产品素材：顶层类别目录必须有许可留痕 —— 二选一即可：
     ① 出现在 assets/scene/CREDITS.md（台账总表）；或
     ② 该目录自带 LICENSE / CREDITS 文件（整包引用的第三方素材通常这么放：cozy、crew、rooms）。 */
  let credits = '';
  try { credits = fs.readFileSync(CREDITS, 'utf8'); } catch (_) { bad.push('缺少 assets/scene/CREDITS.md'); }
  const tops = new Set();
  for (const it of disk.items) {
    if (it.kind !== 'scene') continue;
    const seg = it.path.split('/');         /* assets / scene / <top> / … */
    if (seg.length > 3) tops.add(seg[2]);
  }
  const hasOwnLicense = (t) => {
    const dir = path.join(ROOT, 'assets', 'scene', t);
    try {
      return fs.readdirSync(dir).some(f => /^(LICENSE|CREDITS)/i.test(f));
    } catch (_) { return false; }
  };
  for (const t of tops) {
    if (credits && credits.indexOf(t) >= 0) continue;
    if (hasOwnLicense(t)) continue;
    bad.push('素材类别既不在 CREDITS.md、也没有自带 LICENSE：' + t);
  }

  if (bad.length) {
    console.log('素材台账门禁：失败 ' + bad.length + ' 条');
    bad.slice(0, 20).forEach(b => console.log('  ✗ ' + b));
    return 1;
  }
  console.log('素材台账门禁：通过（' + disk.count + ' 个文件与磁盘逐字节一致；refs 登记与不引用均成立）');
  return 0;
}

function unused() {
  const m = build();
  const zero = m.items.filter(it => it.refs === 0);
  console.log('零引用素材 ' + zero.length + ' / ' + m.items.length + '（只报告，不判红）：');
  for (const it of zero) console.log('  · ' + it.path);
  return 0;
}

const arg = process.argv[2] || '--check';
let code = 0;
if (arg === '--write') code = write();
else if (arg === '--unused') code = unused();
else code = check();
process.exitCode = code;
