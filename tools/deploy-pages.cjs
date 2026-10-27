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
/* 〔2026-10-26 批 P0-a〕清单收敛到 tools/site-entries.cjs（唯一真源）。
   此前本文件自带一份 SITE_ENTRIES，**漏了 assets**：
   R3/U1 之后 js/ui.js、js/ui-scene.js、css/06-scene.css、css/07-start-scene.css
   全都在引用 assets/scene/**，线上却根本没上传 ⇒ 云端回退成 index.html(26201B, text/html)
   ⇒ 浏览器把 <image> 当 HTML 解 ⇒ **网页版所有场景图/头像/背景全不显示**，
   而 CI 的 smoke-test 只 curl 了 / 与 /js/main.js，一直是绿的。
   现由 tools/test-site-entries.cjs 守「代码引用的 assets 必须落在白名单内」。 */
const { SITE_ENTRIES, OPTIONAL_ENTRIES, allowed } = require('./site-entries.cjs');

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

/* 〔2026-10-26 批 P0-a〕上传前的最后一道闸：暂存目录里**不许出现**拒绝清单的路径。
   白名单是「正面清单」，这里再做一次「负面校验」——即使哪天有人把 .env 塞进 assets/，
   白名单会放行它，这一道会拦下整个部署（fail loud，宁可不发也不外泄）。 */
{
  /* 注意：可选资源（SpaceKill.apk 及其 .zip 副本）**不在** SITE_ENTRIES 里，
     它们是单独一段逻辑加进来的，所以必须一并放行，否则这一道会误杀整个部署。
     （2026-10-26 首次实跑就撞上了：✗ SpaceKill.apk / SpaceKill.apk.zip） */
  const okOptional = f => OPTIONAL_ENTRIES.some(e => f === e || f === e + '.zip');
  const leaked = files.filter(f => !allowed(f) && !okOptional(f));
  if (leaked.length) {
    console.error('✗ 暂存目录含拒绝清单文件，部署中止：');
    for (const f of leaked.slice(0, 20)) console.error('   ' + f);
    if (leaked.length > 20) console.error('   …（共 ' + leaked.length + ' 个）');
    fs.rmSync(stage, { recursive: true, force: true });
    process.exit(1);
  }
}

console.log('待上传文件数: ' + files.length + '（仅站点资源，不含 node_modules/.git/打包 zip）');
const total = files.reduce((s, f) => s + fs.statSync(path.join(stage, f)).size, 0);
console.log('总体积: ' + (total / 1048576).toFixed(2) + ' MB');

/* 〔2026-10-26 批 P0-a〕--dry-run：只做到「暂存 + 白名单校验 + 清单打印」就停，
   不调用 wrangler。用途：本地复核「这次到底会上传哪些文件」，
   也是 tools/test-site-entries.cjs 之外唯一能验证暂存内容的手段（CI 里真删不现实）。 */
if (process.argv.includes('--dry-run')) {
  const byTop = new Map();
  for (const f of files) {
    const top = f.indexOf('/') < 0 ? f : f.slice(0, f.indexOf('/'));
    const cur = byTop.get(top) || { n: 0, b: 0 };
    cur.n++; cur.b += fs.statSync(path.join(stage, f)).size;
    byTop.set(top, cur);
  }
  console.log('\n[--dry-run] 按顶层分组的暂存内容：');
  for (const [k, v] of [...byTop.entries()].sort((a, b) => b[1].b - a[1].b)) {
    console.log('  ' + k.padEnd(22) + String(v.n).padStart(4) + ' 个  ' + (v.b / 1048576).toFixed(2) + ' MB');
  }
  console.log('\n[--dry-run] 未调用 wrangler，暂存目录保留在：' + stage);
  process.exit(0);
}

console.log('\n创建 Pages 项目（已存在则忽略报错）...');
spawnSync(WRANGLER, ['pages', 'project', 'create', PROJECT, '--production-branch', BRANCH],
  { cwd: ROOT, stdio: 'inherit', shell: true });

console.log('\n部署中...');
const r = spawnSync(WRANGLER,
  ['pages', 'deploy', stage, '--project-name', PROJECT, '--branch', BRANCH],
  { cwd: ROOT, stdio: 'inherit', shell: true });

fs.rmSync(stage, { recursive: true, force: true });
process.exit(r.status === null ? 1 : r.status);
