/* 批 SHIP 截图核对：进对局页 → 截主视图 + 小地图；再点门走到隔壁，截"走动中"与"到达后"。
   用法：node tools/_shots-ship.cjs <输出目录> */
'use strict';
const path = require('path'), fs = require('fs'), http = require('http'), os = require('os');
const ROOT = path.join(__dirname, '..');
const pw = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const OUT = process.argv[2] || path.join(os.tmpdir(), 'sk-ship-shots');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' };
function serve() {
  const s = http.createServer((q, r) => {
    let p = decodeURIComponent(q.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise(k => s.listen(0, '127.0.0.1', () => k(s)));
}
function chromeExe() {
  return ['C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const br = await pw.chromium.launch({ executablePath: chromeExe() });
  const ctx = await br.newContext({ viewport: { width: 1600, height: 900 } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push('pageerror: ' + e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push('console: ' + m.text()); });

  await pg.goto(base + '/index.html', { waitUntil: 'load' });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: path.join(OUT, '00-home.png') });

  /* 进对局页并渲染一个白天场景（与 mobile-layout-check 同一套 mock，不复制渲染逻辑） */
  const info = await pg.evaluate(() => {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById('screen-game').classList.remove('hidden');
    const V = { humanId: 3, players: Array.from({ length: 15 }, (_, k) => ({ id: k + 1, name: (k + 1) + ' 号', out: false })) };
    window.SKScene.render({ phase: 'day', pending: null }, V);
    const svg = document.querySelector('#scene-mount svg.sk-scene');
    return {
      vb: svg ? svg.getAttribute('viewBox') : null,
      crews: document.querySelectorAll('#scene-mount [data-seat]').length,
      rooms: document.querySelectorAll('#scene-mount .sk-props-room').length,
      doors: document.querySelectorAll('#scene-mount [data-door]').length,
      minimap: !!document.querySelector('#scene-mount .sk-minimap'),
      mmRooms: document.querySelectorAll('#scene-mount .sk-mm-room').length,
      mmLinks: document.querySelectorAll('#scene-mount .sk-mm-link').length,
      me: window.SKScene.myPos(), cam: window.SKScene.camera(),
    };
  });
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: path.join(OUT, '01-bridge.png') });

  /* 走到隔壁（点门）：中途截一张，到达后截一张 */
  await pg.evaluate(() => { window.SKScene.goto('verify'); });
  await pg.waitForTimeout(420);
  const mid = await pg.evaluate(() => ({ walking: window.SKScene.isWalking(), me: window.SKScene.myPos(), room: window.SKScene.currentRoom() }));
  await pg.screenshot({ path: path.join(OUT, '02-walking.png') });
  await pg.waitForTimeout(3600);
  const end = await pg.evaluate(() => ({ walking: window.SKScene.isWalking(), me: window.SKScene.myPos(), room: window.SKScene.currentRoom() }));
  await pg.screenshot({ path: path.join(OUT, '03-arrived.png') });

  /* 矮横屏再看一眼（小地图会不会挡路） */
  await pg.setViewportSize({ width: 844, height: 390 });
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: path.join(OUT, '04-mobile.png') });

  console.log(JSON.stringify({ info, mid, end, errs }, null, 2));
  await br.close().catch(() => {});
  srv.close();
})().catch(e => { console.error('ERR', e.message || e); process.exit(1); });
