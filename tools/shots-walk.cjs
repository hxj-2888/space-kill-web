/* 批 WALK 截图与手感核对（真实浏览器）：
     node tools/shots-walk.cjs <输出目录>
   量四件事（红线 9「元素存在 ≠ 像素可见」—— 只靠门禁看不出手感）：
     ① 按住方向键：人**真的**在连续移动（位移 ≈ 速度 × 时间），腿在摆；
     ② 撞墙：走到房间上壁就停住，不穿墙、不出房间；
     ③ 点地面：走到点击点并**停在原地**（不弹回座位锚点）；
     ④ 跨房：从舰桥点查证室的地面，沿通道走过去，房间与小地图房名跟着变。
   输出 5 张截图 + 一份读数 JSON。 */
'use strict';
const path = require('path'), fs = require('fs'), http = require('http'), os = require('os');
const ROOT = path.join(__dirname, '..');
const pw = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const OUT = process.argv[2] || path.join(os.tmpdir(), 'sk-walk-shots');

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
  await pg.waitForTimeout(400);

  /* 进对局页并渲染一个白天场景（与 shots-ship 同一套 mock） */
  await pg.evaluate(() => {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById('screen-game').classList.remove('hidden');
    const V = { humanId: 3, players: Array.from({ length: 15 }, (_, k) => ({ id: k + 1, name: (k + 1) + ' 号', out: false })) };
    window.__V = V;
    window.SKScene.render({ phase: 'day', pending: null }, V);
  });
  await pg.waitForTimeout(250);
  await pg.screenshot({ path: path.join(OUT, '01-bridge-idle.png') });
  const start = await pg.evaluate(() => window.SKScene.position());

  /* ① 按住方向键 0.6s：位移应 ≈ 7.5 格/秒 × 0.6 ≈ 4.5 格，且腿在摆 */
  await pg.keyboard.down('ArrowRight');
  await pg.waitForTimeout(600);
  const moving = await pg.evaluate(() => ({
    pos: window.SKScene.position(),
    walking: window.SKScene.isWalking(),
    legs: !!document.querySelector('#scene-mount .sk-crew-layer.sk-walking'),
    walkable: window.SKShip.walkable(window.SKScene.position().x, window.SKScene.position().y),
  }));
  await pg.screenshot({ path: path.join(OUT, '02-key-walking.png') });
  await pg.keyboard.up('ArrowRight');
  await pg.waitForTimeout(150);
  const afterKey = await pg.evaluate(() => ({
    pos: window.SKScene.position(),
    walking: window.SKScene.isWalking(),
    legs: !!document.querySelector('#scene-mount .sk-crew-layer.sk-walking'),
  }));
  await pg.screenshot({ path: path.join(OUT, '03-key-stopped.png') });

  /* ② 撞墙：一直往上走 3s，必须停在上壁（船的 y = 房间顶 + 2.1），不许出房间 */
  await pg.keyboard.down('ArrowUp');
  await pg.waitForTimeout(3000);
  await pg.keyboard.up('ArrowUp');
  await pg.waitForTimeout(150);
  const wall = await pg.evaluate(() => {
    const p = window.SKScene.position();
    const r = window.SKShip.roomRect(window.SKScene.currentRoom());
    return { pos: p, room: window.SKScene.currentRoom(), roomTop: r.y, walkable: window.SKShip.walkable(p.x, p.y) };
  });
  await pg.screenshot({ path: path.join(OUT, '04-wall-stopped.png') });

  /* ③ 点地面：点画布中央偏右下的一块地板 → 走过去并停在点击点 */
  const clickInfo = await pg.evaluate(() => {
    const svg = document.querySelector('#scene-mount svg.sk-scene');
    const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    const T = window.SKScene._tile;
    /* 目的点：当前视窗内、房间右下区域（避开道具/座位）。
       ⚠ 屏幕坐标必须走 getScreenCTM —— 手算 (rect 比例) 会漏掉 preserveAspectRatio="meet"
         的留白，点下去差 0.7 格，看着像"点歪了"（本脚本第一版就是这么错的）。 */
    const target = { x: vb[0] / T + 22.5, y: vb[1] / T + 8.2 };
    const sp = svg.createSVGPoint();
    sp.x = target.x * T; sp.y = target.y * T;
    const q = sp.matrixTransform(svg.getScreenCTM());
    return { target: target, sx: q.x, sy: q.y, walkable: window.SKShip.walkable(target.x, target.y) };
  });
  await pg.mouse.click(clickInfo.sx, clickInfo.sy);
  await pg.waitForTimeout(700);
  const clicking = await pg.evaluate(() => ({ walking: window.SKScene.isWalking(), pos: window.SKScene.position() }));
  await pg.waitForTimeout(2200);
  const afterClick = await pg.evaluate(() => ({
    pos: window.SKScene.position(),
    walking: window.SKScene.isWalking(),
    room: window.SKScene.currentRoom(),
  }));
  await pg.screenshot({ path: path.join(OUT, '05-click-arrived.png') });

  /* ④ 跨房：点查证室的地面（用对外接口，等价于点小地图/门外的地面） */
  const dest = await pg.evaluate(() => {
    const c = window.SKShip.roomCenter('verify');
    window.SKScene.walkToPoint({ x: c.x + 3, y: c.y + 1.5 });
    return { dest: { x: c.x + 3, y: c.y + 1.5 }, from: window.SKScene.currentRoom() };
  });
  await pg.waitForTimeout(1500);
  await pg.screenshot({ path: path.join(OUT, '06-cross-walking.png') });
  await pg.waitForTimeout(4500);
  const arrived = await pg.evaluate(() => {
    const p = window.SKScene.position();
    const nm = document.querySelector('#scene-mount .sk-mm-name');
    return {
      pos: p, room: window.SKScene.currentRoom(), walking: window.SKScene.isWalking(),
      minimapName: nm ? nm.textContent : null,
      walkable: window.SKShip.walkable(p.x, p.y),
      cam: window.SKScene.camera(),
    };
  });
  await pg.screenshot({ path: path.join(OUT, '07-cross-arrived.png') });

  /* ⑤ 夜间从宿舍舱位起步（锚点 1/2/4/5 号正好落在可行走面上沿之外 0.1 格）——
     这一条守的是"从锚点起步会不会四向卡死"。 */
  await pg.evaluate(() => {
    document.getElementById('screen-game').classList.remove('hidden');
    const V = { humanId: 1, players: Array.from({ length: 15 }, (_, k) => ({ id: k + 1, name: (k + 1) + ' 号', out: false })) };
    window.SKScene.render({ phase: 'night', pending: null }, V);
    window.SKScene.goto('dorms');
  });
  await pg.waitForTimeout(9000);
  const dormBefore = await pg.evaluate(() => ({
    pos: window.SKScene.position(), room: window.SKScene.currentRoom(),
    anchorWalkable: window.SKShip.walkable(window.SKScene.position().x, window.SKScene.position().y),
  }));
  await pg.keyboard.down('ArrowDown');
  await pg.waitForTimeout(500);
  await pg.keyboard.up('ArrowDown');
  await pg.waitForTimeout(150);
  const dormAfter = await pg.evaluate(() => ({ pos: window.SKScene.position(), room: window.SKScene.currentRoom() }));
  await pg.screenshot({ path: path.join(OUT, '08-dorms-start.png') });

  console.log(JSON.stringify({
    start, moving, afterKey,
    dormBefore, dormAfter,
    dormDelta: +Math.hypot(dormAfter.pos.x - dormBefore.pos.x, dormAfter.pos.y - dormBefore.pos.y).toFixed(2),
    keyDelta: { dx: +(afterKey.pos.x - start.x).toFixed(2), dy: +(afterKey.pos.y - start.y).toFixed(2) },
    wall, clickInfo, clicking, afterClick,
    clickGap: +Math.hypot(afterClick.pos.x - clickInfo.target.x, afterClick.pos.y - clickInfo.target.y).toFixed(2),
    dest, arrived,
    crossGap: +Math.hypot(arrived.pos.x - dest.dest.x, arrived.pos.y - dest.dest.y).toFixed(2),
    errs,
  }, null, 2));
  await br.close().catch(() => {});
  srv.close();
})().catch(e => { console.error('ERR', e.message || e); process.exit(1); });
