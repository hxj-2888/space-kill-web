#!/usr/bin/env node
/* sync-www.cjs — 把站点资源同步进 Android 资产目录（APK 内置页面）
 *
 * 用法：node android/sync-www.cjs
 * 说明：只复制站点真正运行需要的四类资源（index.html / css / js / audio），
 *       与 tools/deploy-pages.cjs 的部署白名单同口径；docs、tools、node_modules、
 *       打包 zip 等一律不进 APK。同步是「先清空再复制」，保证不会残留旧文件。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEST = path.join(__dirname, 'assets', 'www');
// 与 tools/deploy-pages.cjs 的白名单同口径：页面 + 资源 + 图标（index.html 声明了图标，
// 不带上会在 WebView/file:// 下报 404，虽然不影响运行但会污染控制台）
const ENTRIES = ['index.html', 'css', 'js', 'audio',
  'favicon.ico', 'icon-32.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

const walk = (dir, base, out) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), rel, out);
    else out.push(rel);
  }
  return out;
};

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

let files = 0, bytes = 0;
for (const entry of ENTRIES) {
  const src = path.join(ROOT, entry);
  if (!fs.existsSync(src)) {
    console.error('缺少站点资源: ' + entry);
    process.exit(1);
  }
  fs.cpSync(src, path.join(DEST, entry), { recursive: true });
}
for (const f of walk(DEST, '', [])) {
  files++;
  bytes += fs.statSync(path.join(DEST, f)).size;
}

console.log('已同步 ' + files + ' 个文件 / ' + (bytes / 1048576).toFixed(2) + ' MB → android/assets/www/');
