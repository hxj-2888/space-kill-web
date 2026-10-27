/* =============================================================
 * 返航录 · 站点资源白名单（唯一真源）
 * -------------------------------------------------------------
 * 背景（2026-10-26 审阅发现的两个 P0 的共同根因）：
 *
 *   P0-a · 线上场景图全 404
 *     tools/deploy-pages.cjs 的 SITE_ENTRIES 里没有 'assets'，
 *     而 R3/U1 之后 js/ui.js、js/ui-scene.js、css/06-scene.css、
 *     css/07-start-scene.css 全部在引用 assets/scene/**。
 *     云端对不存在的路径回退成 index.html（26201 B / text/html），
 *     浏览器把 <image> 当 HTML 解，于是**所有场景图、头像、背景全不显示**。
 *     CI 的 smoke-test 只 curl 了 / 与 /js/main.js，所以一直是绿的。
 *
 *   P0-b · 本地服务明文吐 .env 与签名私钥
 *     server/server.js 把**仓库根整棵树**当静态目录，只挡「越出仓库根」，
 *     于是 /.env（KEYSTORE_PASS / KEY_PASS）、/android/release.keystore、
 *     /.git/config、/node_modules/**、/tools/** 全部 200。
 *     文档写明联机「建议本地局域网体验」⇒ 局域网内任何一台机器都能拿走签名私钥。
 *
 * 收敛办法：把「哪些文件属于站点」收敛成**一份清单**，
 *   deploy（上云）/ server（本地服务）/ android（打包镜像）三处共用。
 *   —— 这三处此前各写各的，正是「唯一真源」纪律的反面教材。
 *
 * 不变量：
 *   · 本文件只描述「站点需要什么」，不含任何部署/服务实现细节；
 *   · 新增站点资源 = 只改本文件一处；
 *   · 拒绝清单（DENY）优先级高于允许清单——即使有人把 .env 放进了 assets/。
 * ============================================================= */
'use strict';

/* ---- 站点资源（顺序即复制顺序；缺失即 fail loud） ---- */
const SITE_ENTRIES = [
  'index.html',
  'css',
  'js',
  'assets',          /* ← P0-a：R3/U1 起场景图、头像、背景全在这里 */
  'audio',
  'favicon.ico',
  'icon-32.png',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  '_headers',
  '_redirects',
];

/* ---- 可选资源：不存在时只警告、不中止 ----
   APK 被 .gitignore 排除，本地由 android/build.cmd 产出、
   CI 从 GitHub Release 拉回；两边都没有时走 Release 兜底链接。 */
const OPTIONAL_ENTRIES = ['SpaceKill.apk'];

/* ---- 显式拒绝（比允许清单优先）----
   用途：即使某次配置失误把敏感文件塞进了 assets/，
   本地服务与部署暂存都必须拒发 / 拒传。 */
const DENY_PATTERNS = [
  /(^|\/)\.env(\.|$)/i,          /* .env / .env.local / .env.production */
  /\.keystore$/i,
  /\.jks$/i,
  /\.pem$/i,
  /\.p12$/i,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.wrangler(\/|$)/,
  /(^|\/)\.tmp_shots(\/|$)/,
  /(^|\/)backup(\/|$)/,
  /(^|\/)docs(\/|$)/,
  /(^|\/)tools(\/|$)/,
  /(^|\/)attachment-site(\/|$)/,
];

/** 相对仓库根的路径是否允许下发/上传 */
function allowed(relPath) {
  const p = String(relPath == null ? '' : relPath).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p) return false;
  for (const re of DENY_PATTERNS) if (re.test(p)) return false;
  return SITE_ENTRIES.some(function (e) { return p === e || p.indexOf(e + '/') === 0; });
}

/** 供 server.js：请求路径 → 允许则返回规范化相对路径，否则 null */
function resolve(relPath) {
  const p = String(relPath == null ? '' : relPath).replace(/\\/g, '/').replace(/^\/+/, '');
  /* 目录请求回 index.html（与静态站一致） */
  const target = (!p || p === '/') ? 'index.html' : p;
  return allowed(target) ? target : null;
}

module.exports = {
  SITE_ENTRIES,
  OPTIONAL_ENTRIES,
  DENY_PATTERNS,
  allowed,
  resolve,
};
