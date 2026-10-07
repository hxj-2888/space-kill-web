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
// SpaceKill.apk = 安卓版安装包（由 android/build.cmd 自动复制到仓库根，见该脚本注释）；
// _headers = 该 APK 的附件下载响应头。三者缺一都会导致线上"能点但下不到"。
// （assets/ 已随第四十二批扫码浮层退役删除，不再是站点资源——2026-10-07 CI 首跑时该
//   死条目被 fail-loud 检查拦下，现移除。）
const SITE_ENTRIES = ['index.html', 'css', 'js', 'audio', 'favicon.ico', 'icon-32.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'SpaceKill.apk', '_headers'];

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
