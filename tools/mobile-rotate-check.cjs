/* 旋转专项检查：竖屏打开 → 旋转到横屏，看对局页是否真的响应
   为什么单独写：mobile-layout-check.cjs 是「按目标视口分别打开」，覆盖不到
   「同一页面从竖屏转到横屏」这条路径——而旋转失败恰恰出在这条路径上
   （媒体查询要重新求值、JS 的 matchMedia 监听要重建布局、fixed 浮层要收起）。

   用法：node tools/mobile-rotate-check.cjs [--url=https://…]
   退出：0 = 旋转后对局页正常；1 = 有问题 */
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.json': 'application/json' };
const PAIRS = [
  { name: 'iPhone 14', pw: 390, ph: 844, lw: 844, lh: 390 },
  { name: 'iPhone SE', pw: 375, ph: 667, lw: 667, lh: 375 },
  { name: 'Android', pw: 412, ph: 915, lw: 915, lh: 412 },
  { name: '折叠内屏', pw: 344, ph: 882, lw: 882, lh: 344 },
];
function serve() {
  const s = http.createServer(function (q, r) {
    let u = decodeURIComponent(q.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    const f = path.join(ROOT, u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise(function (k) { s.listen(0, function () { k(s); }); });
}
const FIXTURE = function () {
  document.querySelectorAll('.screen').forEach(function (s) { s.classList.add('hidden'); });
  var g = document.getElementById('screen-game'); if (g) g.classList.remove('hidden');
  var r = document.getElementById('roster');
  if (r) for (var i = 1; i <= 15; i++) {
    var e = document.createElement('div'); e.className = 'pl';
    e.innerHTML = '<div class="did">' + i + ' 号</div><div class="tags"><span class="tag">船员</span></div>';
    r.appendChild(e);
  }
  var c = document.getElementById('chatlog');
  if (c) for (var k = 0; k < 4; k++) {
    var s2 = document.createElement('div'); s2.className = 'say';
    s2.innerHTML = '<span class="ava">3</span><div class="say-main"><div class="who">3 号</div>我怀疑 7 号是外星人，昨晚的查验方向不对。</div></div>';
    c.appendChild(s2);
  }
  var tb = document.getElementById('talkbar'); if (tb) tb.classList.remove('hidden');
};
(async function () {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('playwright-core')); }
  const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
  const exe = CAND.find(function (p) { return fs.existsSync(p); });
  const argUrl = process.argv.find(function (a) { return a.startsWith('--url='); });
  const srv = await serve();
  const base = argUrl ? argUrl.slice(6) : 'http://127.0.0.1:' + srv.address().port;
  console.log('目标：' + base);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  let fail = 0;
  for (const d of PAIRS) {
    const ctx = await browser.newContext({ viewport: { width: d.pw, height: d.ph }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', function (e) { errs.push(String(e).slice(0, 140)); });
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    if (argUrl) {
      await page.evaluate(function () {
        var t = Date.now();
        document.querySelectorAll('link[rel=stylesheet],script[src]').forEach(function (el) {
          var u = new URL(el.href || el.src, location.href);
          u.searchParams.set('nocache', t);
          if (el.href) el.href = u.toString(); else el.src = u.toString();
        });
      });
      await page.waitForTimeout(400);
    }
    await page.evaluate(FIXTURE);
    await page.waitForTimeout(300);
    const before = await page.evaluate(function () {
      return { rot: getComputedStyle(document.getElementById('rot-hint')).display, game: getComputedStyle(document.getElementById('screen-game')).display };
    });
    await page.setViewportSize({ width: d.lw, height: d.lh });
    await page.waitForTimeout(700);
    const after = await page.evaluate(function () {
      function vis(e) { return !!e && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'; }
      var rot = document.getElementById('rot-hint'), game = document.getElementById('screen-game');
      var gr = game.getBoundingClientRect();
      var chat = document.getElementById('chatlog');
      var cr = chat ? chat.getBoundingClientRect() : { height: 0 };
      var tg = document.getElementById('btn-side-toggle');
      var roster = document.getElementById('roster');
      var st = document.querySelector('.seg-stage');
      return {
        rotShown: vis(rot), gameShown: vis(game),
        gameBox: { w: Math.round(gr.width), h: Math.round(gr.height) },
        chatH: Math.round(cr.height),
        toggle: tg ? getComputedStyle(tg).display : 'missing',
        rosterH: roster ? Math.round(roster.getBoundingClientRect().height) : 0,
        rosterScroll: roster ? (getComputedStyle(roster).overflowX === 'auto' || getComputedStyle(roster).overflowX === 'scroll') : false,
        stageW: st ? Math.round(st.getBoundingClientRect().width) : 0,
        gameMinW: getComputedStyle(game).minWidth, gameH: getComputedStyle(game).height
      };
    });
    const bad = [];
    if (after.rotShown) bad.push('旋转后竖屏提示层仍盖着（用户看到的「没反应」）');
    if (!after.gameShown) bad.push('对局页不可见');
    if (after.gameBox.h < 200) bad.push('对局页高度异常 ' + after.gameBox.h + 'px');
    if (after.chatH < 70) bad.push('发言流水高度异常 ' + after.chatH + 'px');
    if (!after.rosterScroll) bad.push('名单未转横向滚动条');
    if (after.rosterH > 60) bad.push('名单横条过高 ' + after.rosterH + 'px');
    if (after.toggle === 'none') bad.push('抽屉按钮未出现');
    if (errs.length) bad.push('JS 错误：' + errs.join(' | '));
    if (bad.length) {
      fail++;
      console.log('x ' + d.name + ' ' + d.pw + 'x' + d.ph + ' -> ' + d.lw + 'x' + d.lh);
      bad.forEach(function (e) { console.log('    · ' + e); });
      console.log('    旋转前 ' + JSON.stringify(before));
      console.log('    旋转后 ' + JSON.stringify(after));
    } else {
      console.log('v ' + d.name + ' ' + d.pw + 'x' + d.ph + ' -> ' + d.lw + 'x' + d.lh + '（提示层已收起、对局 ' + after.gameBox.w + 'x' + after.gameBox.h + '、发言区 ' + after.chatH + 'px、抽屉 ' + after.toggle + '）');
    }
    await ctx.close();
  }
  await browser.close(); srv.close();
  console.log(fail ? '\n旋转专项：' + fail + ' 组失败' : '\n旋转专项：全部通过');
  process.exit(fail ? 1 : 0);
})();