/* ============================================================
 * tools/test-site-entries.cjs — 站点白名单门禁
 *
 * 存在理由（2026-10-26 两个 P0 的直接产物）：
 *   ① 线上 /assets/** 全 404 —— deploy 白名单漏了 assets，而四个文件在引用它。
 *      这不是「部署失败」，是「部署成功但内容不全」，CI 的 curl 冒烟测不出来。
 *   ② 本地 server.js 把仓库根当静态目录 —— /.env 与 release.keystore 明文可下载。
 *
 * 本门禁守两件事：
 *   A. **引用闭合**：站点代码里引用到的每个 assets/ 路径，都必须落在白名单内。
 *      —— 防的正是 P0-a：代码引用了 assets，白名单却没放行。
 *   B. **拒绝清单**：敏感路径（.env / keystore / .git / node_modules / tools / docs）
 *      一律 allowed() === false。
 *      —— 防的正是 P0-b。
 *
 * 断言纪律（本仓血的教训，见 AGENTS §五）：
 *   · 每条都能被证伪：把 assets 从 SITE_ENTRIES 删掉，A 必须变红。
 *   · 反向自检已做：2026-10-26 实测，删 assets ⇒ A1/A2/A3 三条同时红。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const SE = require('./site-entries.cjs');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const rows = [];

function ok(name, cond, detail) {
  if (cond) { pass++; rows.push('  ✓ ' + name); }
  else { fail++; rows.push('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

/* ---------- A. 引用闭合：代码里引用的 assets 路径必须被白名单放行 ---------- */
{
  ok('E1：白名单含 assets（P0-a 的一行根因）',
    SE.SITE_ENTRIES.indexOf('assets') >= 0,
    'SITE_ENTRIES=' + SE.SITE_ENTRIES.join(','));

  /* 收集站点代码里的 assets/ 引用（只认字符串字面量里的路径前缀，
     不解析模板拼接——拼接的目标也都在同一个目录下，用目录级断言覆盖）。 */
  const SRC = ['js', 'css', 'index.html'];
  const hits = new Set();
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(abs)) walk(rel + '/' + e);
      return;
    }
    if (!/\.(js|css|html)$/.test(rel)) return;
    if (/\/_retired\//.test(rel)) return;          /* 归档代码不参与 */
    const txt = fs.readFileSync(abs, 'utf8');
    const re = /assets\/[A-Za-z0-9_\-./]+/g;
    let m;
    while ((m = re.exec(txt))) hits.add(m[0].replace(/[.,;:'")\]]+$/, ''));
  };
  SRC.forEach(walk);

  /* 逐条断言：每个被引用的 assets 路径（去掉可能的不完整尾段）必须 allowed */
  const bad = [...hits].filter(p => !SE.allowed(p));
  ok('E2：站点代码引用的 assets 路径全部落在白名单内',
    hits.size > 0 && bad.length === 0,
    bad.length ? '未放行：' + bad.join(' , ') : ('引用 ' + hits.size + ' 条'));

  /* 目录级兜底：assets/ 下每个顶层子目录都要 allowed
     （模板拼接的路径（如 'assets/scene/cozy/' + 'tiles/' + x）只能这样覆盖） */
  const assetsAbs = path.join(ROOT, 'assets');
  const subs = fs.existsSync(assetsAbs)
    ? fs.readdirSync(assetsAbs, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => 'assets/' + d.name)
    : [];
  const badSubs = subs.filter(p => !SE.allowed(p));
  ok('E3：assets/ 每个顶层子目录都被放行（覆盖模板拼接路径）',
    subs.length > 0 && badSubs.length === 0,
    badSubs.length ? '未放行：' + badSubs.join(' , ') : ('子目录 ' + subs.length + ' 个'));
}

/* ---------- B. 拒绝清单：敏感路径一律不许下发 ---------- */
{
  const mustDeny = [
    '.env', '.env.local', 'android/release.keystore', 'android/release.jks',
    'cert.pem', 'key.p12', '.git/config', '.git/HEAD',
    'node_modules/docx/package.json', 'tools/sim.cjs', 'docs/README.md',
    'backup/form-ui-20261025/index.html', 'attachment-site/site/rules.html',
    '.wrangler/state', '.tmp_shots/x.png',
    /* 即使被放进 assets/，也必须拒 —— 拒绝清单优先于允许清单 */
    'assets/.env', 'assets/scene/bg/release.keystore',
  ];
  const leaked = mustDeny.filter(p => SE.allowed(p));
  ok('E4：敏感路径一律不在白名单内（.env / keystore / .git / node_modules / tools / docs …）',
    leaked.length === 0,
    leaked.length ? '仍被放行：' + leaked.join(' , ') : (mustDeny.length + ' 条全部拒绝'));

  /* resolve() 的目录语义：/ → index.html；越界/拒绝 → null */
  ok('E5：resolve() 目录语义与拒绝语义正确',
    SE.resolve('') === 'index.html'
    && SE.resolve('/') === 'index.html'
    && SE.resolve('index.html') === 'index.html'
    && SE.resolve('js/arena.js') === 'js/arena.js'
    && SE.resolve('.env') === null
    && SE.resolve('android/release.keystore') === null
    && SE.resolve('../package.json') === null);
}

/* ---------- C. 三处消费方必须共用本清单（防再次各写各的） ---------- */
{
  const deploy = fs.readFileSync(path.join(ROOT, 'tools', 'deploy-pages.cjs'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  const android = fs.readFileSync(path.join(ROOT, 'android', 'sync-www.cjs'), 'utf8');

  ok('E6：deploy-pages.cjs 从 site-entries.cjs 取清单（不再自带一份）',
    /require\(['"]\.\/site-entries(\.cjs)?['"]\)/.test(deploy)
    && /SITE_ENTRIES/.test(deploy)
    && !/const SITE_ENTRIES = \[/.test(deploy),
    '仍自带硬编码清单');

  ok('E7：server.js 用白名单解析请求（不再把仓库根当静态目录）',
    /site-entries/.test(server) && /SE\.resolve|siteEntries\.resolve|allowed\(/.test(server),
    '未接入白名单');

  ok('E8：android/sync-www.cjs 从 site-entries.cjs 取清单',
    /site-entries/.test(android),
    '仍自带硬编码清单');
}

/* ---------- 输出 ---------- */
console.log(rows.join('\n'));
console.log('\n站点白名单门禁：通过 ' + pass + ' 条、失败 ' + fail + ' 条');
process.exit(fail ? 1 : 0);
