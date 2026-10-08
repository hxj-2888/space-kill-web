/* 可行性验证（临时）：本地 HTTP 服务器 + 真浏览器 打开太空杀页面 */
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 8799;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

function get(port, p) {
  return new Promise((res) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 800 }, (r) => {
      r.resume();
      res(r.statusCode);
    });
    req.on('error', () => res(0));
    req.on('timeout', () => { req.destroy(); res(0); });
  });
}

(async () => {
  if (!CHROME) { console.log('NO_CHROME'); process.exit(0); }
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
  });
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) { ok = (await get(PORT, '/')) === 200; if (!ok) await new Promise(r => setTimeout(r, 200)); }
  if (!ok) { console.log('SERVER_FAIL'); srv.kill(); process.exit(1); }
  console.log('server up on http://127.0.0.1:' + PORT + '/  (browser=' + CHROME + ')');

  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errs = [], failed = [], media = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e.message).slice(0, 200)));
  page.on('requestfailed', (r) => failed.push(r.url().replace(/^http:\/\/127\.0\.0\.1:\d+/, '') + ' :: ' + (r.failure() && r.failure().errorText)));
  page.on('response', (r) => {
    const u = r.url();
    if (/\.(m4a|ogg|png|ico|webmanifest)$/.test(u)) {
      media.push(path.basename(u) + ' -> ' + (r.headers()['content-type'] || '?') + ' [' + r.status() + ']');
    }
  });

  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  const storage = await page.evaluate(() => {
    try { localStorage.setItem('__t', 'v'); return localStorage.getItem('__t') === 'v' ? 'OK' : 'READ_BACK_FAIL'; }
    catch (e) { return 'EXCEPTION ' + e.message; }
  });
  const audioProbe = await page.evaluate(async () => {
    try {
      const a = new Audio('audio/music-bgm.m4a');
      await new Promise((r) => { a.addEventListener('canplay', r, { once: true }); a.addEventListener('error', r, { once: true }); a.load(); setTimeout(r, 1500); });
      return 'readyState=' + a.readyState + ' err=' + (a.error ? a.error.code : 'none');
    } catch (e) { return 'EXCEPTION ' + e.message; }
  });
  const secureCtx = await page.evaluate(() => ({ isSecureContext: window.isSecureContext, sw: 'serviceWorker' in navigator, origin: location.origin }));
  const title = await page.title();
  await page.screenshot({ path: path.join(__dirname, 'sk-http-start.png') });

  console.log('title=' + title);
  console.log('localStorage=' + storage);
  console.log('audio=' + audioProbe);
  console.log('ctx=' + JSON.stringify(secureCtx));
  console.log('mediaTypes=' + JSON.stringify([...new Set(media)], null, 0));
  console.log('consoleErrors=' + (errs.length ? JSON.stringify(errs.slice(0, 8), null, 0) : 'none'));
  console.log('requestFailed=' + (failed.length ? JSON.stringify(failed.slice(0, 8), null, 0) : 'none'));

  await browser.close();
  srv.kill();
  process.exit(0);
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
