/* =============================================================
 * tools/mobile-layout-check.cjs — 移动端横屏布局自检（v35 适配门禁）
 *
 * 为什么需要：#screen-game 曾写死 min-width:1080px，手机横屏根本进不去对局，
 * 而「看着像没问题」证明不了——必须拿真实手机视口量一遍。
 *
 * 做法：用 Playwright 打开本地页面，按手机横屏/竖屏视口切到对局页，
 *       量关键元素的 getBoundingClientRect，检查是否溢出视口 / 被裁切。
 * 依赖：playwright（未装则跳过并提示，不阻塞其他门禁）
 *
 * 用法：node tools/mobile-layout-check.cjs
 * 退出：0 = 全部通过；1 = 有溢出/不可见项
 * ============================================================= */
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg', '.json': 'application/json',
};

/* 覆盖三档常见手机 + 竖屏 + 桌面回归对照 */
const DEVICES = [
  { name: 'iPhone 14 横屏', width: 844, height: 390, touch: true },
  { name: 'iPhone SE 横屏', width: 667, height: 375, touch: true },
  { name: 'Android 横屏', width: 915, height: 412, touch: true },
  { name: 'iPhone 14 竖屏（应提示旋转）', width: 390, height: 844, touch: true, portrait: true },
  { name: '桌面（回归对照）', width: 1440, height: 900, touch: false },
];

function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, () => r(srv)));
}

(async () => {
  let chromium;
  /* 优先 playwright（自带浏览器）；退回 playwright-core + 系统 Chrome/Edge。
     不做浏览器下载——为一个布局门禁拉 150MB 不划算。 */
  try { ({ chromium } = require('playwright')); }
  catch (e) {
    try { ({ chromium } = require('playwright-core')); }
    catch (e2) {
      console.log('SKIP 未安装 playwright / playwright-core，跳过移动端布局自检（不影响其他门禁）');
      process.exit(0);
    }
  }
  const CANDIDATES = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  const exePath = CANDIDATES.find(p => fs.existsSync(p));
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch(exePath ? { executablePath: exePath } : {});
  let fail = 0;

  for (const d of DEVICES) {
    const ctx = await browser.newContext({
      viewport: { width: d.width, height: d.height },
      isMobile: d.touch, hasTouch: d.touch, deviceScaleFactor: d.touch ? 3 : 1,
    });
    const page = await ctx.newPage();
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    /* 直接进对局页：开始页要选阵营+开局，这里只验对局页布局 */
    await page.evaluate(() => {
      document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
      const g = document.getElementById('screen-game');
      if (g) g.classList.remove('hidden');
      /* 灌最小内容：15 人名单 + 4 条发言，验证真实内容下的挤压 */
      const r = document.getElementById('roster');
      if (r) for (let i = 1; i <= 15; i++) {
        const d2 = document.createElement('div');
        d2.className = 'pl';
        d2.innerHTML = '<div class="did">' + i + ' 号</div><div class="tags"><span class="tag">船员</span></div>';
        r.appendChild(d2);
      }
      const c = document.getElementById('chatlog');
      if (c) for (let i = 0; i < 4; i++) {
        const s = document.createElement('div');
        s.className = 'say';
        s.innerHTML = '<span class="ava">3</span><div class="say-main"><div class="who">3 号</div>我怀疑 7 号是外星人，昨晚的查验方向不对。</div></div>';
        c.appendChild(s);
      }
      const tb = document.getElementById('talkbar');
      if (tb) tb.classList.remove('hidden');
    });
    await page.waitForTimeout(150);

    const res = await page.evaluate((vp) => {
      const out = [];
      const bad = (name, el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;          /* 隐藏元素跳过 */
        if (r.right > vp.w + 1 || r.left < -1 || r.bottom > vp.h + 1 || r.top < -1) {
          out.push(name + ' 溢出 ' + JSON.stringify({
            l: Math.round(r.left), t: Math.round(r.top),
            r: Math.round(r.right), b: Math.round(r.bottom),
          }));
        }
      };
      ['#screen-game', '.topbar', '.orb-bar', '#roster', '.seg-stage', '#chatlog', '#f-text', '#btn-send']
        .forEach(s => { const e = document.querySelector(s); if (e) bad(s, e); });
      /* 侧栏抽屉关闭时故意 translateX 到视口外，不算溢出；打开时必须在视口内 */
      const sd = document.querySelector('.seg-side');
      if (sd) {
        const open = sd.classList.contains('open');
        const r = sd.getBoundingClientRect();
        if (open && (r.left < -1 || r.right > vp.w + 1)) {
          out.push('.seg-side 打开态溢出 ' + JSON.stringify({ l: Math.round(r.left), r: Math.round(r.right) }));
        }
      }
      const r = document.getElementById('roster');
      let rosterScrollable = false, rosterH = 0;
      if (r) {
        rosterH = r.getBoundingClientRect().height;
        const cs = getComputedStyle(r);
        rosterScrollable = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
      }
      const tg = document.getElementById('btn-side-toggle');
      const rot = document.getElementById('rot-hint');
      return {
        out, rosterScrollable, rosterH,
        rotShown: !!rot && getComputedStyle(rot).display !== 'none',
        toggleShown: tg ? tg.style.display : 'missing',
      };
    }, { w: d.width, h: d.height });

    const errs = d.portrait ? [] : res.out.slice();
    if (d.portrait) {
      /* 竖屏刻意不适配（旋转提示遮罩已覆盖），故不查溢出——底层溢出对用户不可见 */
      if (!res.rotShown) errs.push('竖屏未显示旋转提示');
      if (res.toggleShown !== 'none') errs.push('竖屏不应显示抽屉按钮（当前 ' + res.toggleShown + '）');
    } else {
      if (d.touch && !res.rosterScrollable) errs.push('名单未横向滚动（手机横屏必须是横条）');
      if (d.touch && res.rosterH > 60) errs.push('名单横条高度异常：' + Math.round(res.rosterH) + 'px');
      if (d.touch) {
        /* 抽屉打开态必须完整落在视口内（等transition 结束再量，否则量到动画中间态） */
        await page.evaluate(() => { const s = document.querySelector('.seg-side'); if (s) s.classList.add('open'); });
        await page.waitForTimeout(500);
        const dr = await page.evaluate(() => {
          const el = document.querySelector('.seg-side');
          const r = el.getBoundingClientRect();
          return { l: Math.round(r.left), r: Math.round(r.right), tf: getComputedStyle(el).transform };
        });
        if (dr.tf !== 'none') errs.push('抽屉未完全展开（transform=' + dr.tf + '）');
        if (dr.l < -1 || dr.r > d.width + 1) errs.push('抽屉打开态溢出 ' + JSON.stringify(dr));
        await page.evaluate(() => { const s = document.querySelector('.seg-side'); if (s) s.classList.remove('open'); });
      }
    }
    if (errs.length) {
      fail++;
      console.log('✗ ' + d.name + ' ' + d.width + '×' + d.height);
      errs.forEach(e => console.log('    · ' + e));
    } else {
      console.log('✓ ' + d.name + ' ' + d.width + '×' + d.height +
        (d.touch ? '（名单横条 ' + Math.round(res.rosterH) + 'px，抽屉按钮 ' + (res.toggleShown || 'none') + '）' : ''));
    }
    await ctx.close();
  }
  await browser.close();
  srv.close();
  console.log(fail ? '\n移动端布局自检：' + fail + ' 档失败' : '\n移动端布局自检：全部通过');
  process.exit(fail ? 1 : 0);
})();