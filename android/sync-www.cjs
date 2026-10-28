#!/usr/bin/env node
/* sync-www.cjs — 把站点资源同步进 Android 资产目录（APK 内置页面）
 *
 * 用法：node android/sync-www.cjs
 * 说明：清单来自 tools/site-entries.cjs（**与 tools/deploy-pages.cjs / server 共用同一份**）。
 *       此前本文件自带一份 ENTRIES，虽然当时含 assets 是对的，但三处各写各的
 *       正是「部署漏了 assets、本地服务吐出 .env」这两个 P0 的温床（2026-10-26 审阅）。
 *       docs、tools、node_modules、打包 zip 等一律不进 APK；同步是「先清空再复制」，
 *       保证不会残留旧文件。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { SITE_ENTRIES, allowed } = require(path.join(__dirname, '..', 'tools', 'site-entries.cjs'));

const ROOT = path.join(__dirname, '..');
const DEST = path.join(__dirname, 'assets', 'www');
/* APK 内不需要 _headers / _redirects（那是 Cloudflare 的约定，WebView 不认），
   但留着无害；这里剔除以免进包体积与困惑。 */
const SKIP = new Set(['_headers', '_redirects']);
const ENTRIES = SITE_ENTRIES.filter(e => !SKIP.has(e));

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

let files = 0, bytes = 0, skipped = 0;
for (const entry of ENTRIES) {
  const src = path.join(ROOT, entry);
  if (!fs.existsSync(src)) {
    console.error('缺少站点资源: ' + entry);
    process.exit(1);
  }
  /* 〔批 ART-0 · 2026-10-28〕按**拒绝清单**过滤，而不是整目录照抄。
     此前 `assets` 是整目录复制的，于是 `assets/refs/`（设计参考图，不可再分发）
     会跟着进 APK —— 拒绝清单在 deploy/server 生效，在这一处被绕过。
     filter 的入参是绝对路径，换算成仓库相对路径后问 allowed()（唯一判据）。 */
  fs.cpSync(src, path.join(DEST, entry), {
    recursive: true,
    filter: function (p) {
      const rel = path.relative(ROOT, p).replace(/\\/g, '/');
      if (!rel) return true;
      if (!allowed(rel)) { skipped++; return false; }
      return true;
    },
  });
}
for (const f of walk(DEST, '', [])) {
  files++;
  bytes += fs.statSync(path.join(DEST, f)).size;
}

console.log('已同步 ' + files + ' 个文件 / ' + (bytes / 1048576).toFixed(2) + ' MB → android/assets/www/'
  + (skipped ? '（按拒绝清单跳过 ' + skipped + ' 项）' : ''));
