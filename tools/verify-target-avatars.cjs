/* 自检：目标选择渲染为横向头像（不是单列方框）
 * 用法：node tools/verify-target-avatars.cjs
 * 判据：display=flex · sameRow=true · count=14（种子 953 时除自己外 14 人）
 * 历史坑：只 !important 了 display 会让头像排成单列（01 层 .opts 是 column）。
 */const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp' };
function serve() {
  const s = http.createServer((q, r) => {
    let p = decodeURIComponent(q.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise(k => s.listen(0, () => k(s)));
}
(async () => {
  const pw = require('playwright-core');
  const OUT = path.join(__dirname, '..', '.tmp_shots', 'verify-avatars');
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const br = await pw.chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const c = await br.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const pg = await c.newPage();
  pg.on('pageerror', e => console.log('[pageerror]', e.message));
  await pg.goto(base + '/index.html', { waitUntil: 'load' });
  await pg.evaluate(() => { document.getElementById('seed').value = '953'; document.getElementById('btn-start').click(); });
  await pg.waitForTimeout(900);
  await pg.evaluate(() => {
    const G = window.Game, g = G.g, me = g.players[g.humanId - 1];
    g.pending = {
      kind: 'repair', pid: me.id, title: '步骤 4a · 维修',
      desc: '选择一处设备进行维修（示例）。',
      opts: [{ v: 'yes', label: '维修', sub: '消耗一次维修额度' }, { v: 'no', label: '跳过' }],
      targets: { list: g.players.filter(p => !p.out && p.id !== me.id).map(p => p.id), max: 1 },
      duration: 30,
    };
    window.UI.render();
  });
  await pg.waitForTimeout(150);
  await pg.evaluate(() => {
    document.querySelector('.sk-room[data-room="repair"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const ov = document.getElementById('rules-overlay'); if (ov) ov.classList.add('hidden');
  });
  await pg.waitForTimeout(350);
  const m = await pg.evaluate(() => {
    const box = document.querySelector('#f-targets');
    const kids = [...box.querySelectorAll('.tgt-avatar')];
    const a = kids[0] ? kids[0].getBoundingClientRect() : null;
    const b = kids[1] ? kids[1].getBoundingClientRect() : null;
    return {
      display: getComputedStyle(box).display,
      count: kids.length,
      sameRow: a && b ? Math.abs(a.top - b.top) < 4 : null,
      cardW: a ? Math.round(a.width) : null,
      boxW: Math.round(box.getBoundingClientRect().width),
      perRow: (() => {
        if (!a) return 0;
        const w = Math.round(a.width) + 6;
        return Math.max(1, Math.floor(Math.round(box.getBoundingClientRect().width) / w));
      })(),
    };
  });
  console.log('头像布局:', JSON.stringify(m));
  await pg.screenshot({ path: path.join(OUT, 'room.png') });
  await br.close(); srv.close();
})();
