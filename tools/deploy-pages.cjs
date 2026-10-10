/* ============================================================
 * tools/deploy-pages.cjs — 部署到 Cloudflare Pages（太空杀 · 网页版）
 *
 * 为什么需要「白名单暂存」：`wrangler pages deploy` 会把目录内容整体上传，
 * 而仓库根目录还含 node_modules/（约 9MB）、.git/、以及打包产物 zip（约 2.6MB）
 * ——这些都不该出现在站点上。故先只复制站点真正需要的文件到临时目录再部署。
 *
 * 站点实际引用（见 index.html 与 js/audio.js）：index.html / css/ / js/ / audio/
 *
 * 前置：本机已安装 wrangler 并 `wrangler login`。
 * CI：设 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID 环境变量（wrangler 自动识别，免登录），
 *     并用 WRANGLER_CMD 指定启动命令（如 "npx wrangler@4"）——见 .github/workflows/deploy.yml。
 * 用法：node tools/deploy-pages.cjs
 * ============================================================ */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT = 'space-kill-web';
const BRANCH = 'main';
const ROOT = path.join(__dirname, '..');
// CI 注入的启动命令（如 "npx wrangler@4"）；本地默认用 PATH 里的 wrangler
const WRANGLER = process.env.WRANGLER_CMD || 'wrangler';
// 站点图标随页面一起部署（缺了会被 Cloudflare 回退成 404，浏览器退回默认空白图标）
// _headers = APK 的附件下载响应头，缺了线上"能点但下不到"。
// （assets/ 已随第四十二批扫码浮层退役删除，不再是站点资源——2026-10-07 CI 首跑时该
//   死条目被 fail-loud 检查拦下，现移除。）
const SITE_ENTRIES = ['index.html', 'css', 'js', 'audio', 'favicon.ico', 'icon-32.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', '_headers', '_redirects'];
// 可选资源：SpaceKill.apk 被 .gitignore 排除、不进 git——本地由 android/build.cmd 产出，
// CI 部署前从 GitHub Release 拉回仓库根；两边都没有时警告跳过（下载走 Release 兜底链接）。
// 〔2026-10-10〕站点上实际分发的是 SpaceKill.apk.zip（.apk 后缀不进 Cloudflare CDN 缓存，
// 且 Pages 免费版不支持 Range → 4.5MB 一断就从头来，见 _headers 注释）——
// 这里在暂存时把 apk **复制一份为 zip**，本地/CI 两条部署路都自动带上，无需各自多一步。
const OPTIONAL_ENTRIES = ['SpaceKill.apk'];

const stage = path.join(os.tmpdir(), 'space-kill-pages-deploy');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

for (const entry of SITE_ENTRIES) {
  const src = path.join(ROOT, entry);
  if (!fs.existsSync(src)) {
    console.error('缺少站点资源: ' + entry);
    process.exit(1);
  }
  fs.cpSync(src, path.join(stage, entry), { recursive: true });
}
for (const entry of OPTIONAL_ENTRIES) {
  const src = path.join(ROOT, entry);
  if (!fs.existsSync(src)) {
    console.warn('⚠ 可选资源不存在，本次部署不包含（安装包下载走 Release 兜底链接）: ' + entry);
    continue;
  }
  fs.cpSync(src, path.join(stage, entry), { recursive: true });
  // 同名 .zip 副本：.apk 后缀不进 CDN 缓存、Range 不可用（下载易断且无法续传），见 _headers 注释
  fs.copyFileSync(src, path.join(stage, entry + '.zip'));
}

// 打印暂存内容，便于确认没有多余文件被上传
const walk = (dir, base, out) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), rel, out);
    else out.push(rel);
  }
  return out;
};
const files = walk(stage, '', []);
console.log('暂存目录: ' + stage);
console.log('待上传文件数: ' + files.length + '（仅站点资源，不含 node_modules/.git/打包 zip）');
const total = files.reduce((s, f) => s + fs.statSync(path.join(stage, f)).size, 0);
console.log('总体积: ' + (total / 1048576).toFixed(2) + ' MB');

console.log('\n创建 Pages 项目（已存在则忽略报错）...');
spawnSync(WRANGLER, ['pages', 'project', 'create', PROJECT, '--production-branch', BRANCH],
  { cwd: ROOT, stdio: 'inherit', shell: true });

console.log('\n部署中...');
const r = spawnSync(WRANGLER,
  ['pages', 'deploy', stage, '--project-name', PROJECT, '--branch', BRANCH],
  { cwd: ROOT, stdio: 'inherit', shell: true });

fs.rmSync(stage, { recursive: true, force: true });
process.exit(r.status === null ? 1 : r.status);
