/* 自检：场景笔记本 → 手写纸面账本
 * 用法：node tools/verify-ledger.cjs
 * 判据：notebookInScene · overlayVisible · hasPaper · hasKv=0 · hasEvt=0（无方框）
 * 历史坑：AI.suspDist 返回 Map<阵营,概率>，按 {best:[...]} 取值会让条目只剩编号。
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
  const OUT = path.join(__dirname, '..', '.tmp_shots', 'verify-ledger');
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const br = await pw.chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const c = await br.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const pg = await c.newPage();
  pg.on('pageerror', e => console.log('[pageerror]', e.message));
  await pg.goto(base + '/index.html', { waitUntil: 'load' });
  await pg.evaluate(() => { document.getElementById('seed').value = '953'; document.getElementById('btn-start').click(); });
  await pg.waitForTimeout(1200);

  const step1 = await pg.evaluate(() => {
    const nb = document.getElementById('sk-notebook');
    return { notebookInScene: !!nb };
  });
  console.log('① 笔记本道具:', JSON.stringify(step1));

  const step2 = await pg.evaluate(() => {
    const nb = document.getElementById('sk-notebook');
    if (!nb) return { err: 'no notebook' };
    nb.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const ov = document.getElementById('ledger-overlay');
    return {
      overlayVisible: !!(ov && !ov.classList.contains('hidden')),
      hasPaper: !!(ov && ov.querySelector('.ledger-paper')),
      lines: ov ? ov.querySelectorAll('.ld-line').length : 0,
      heads: ov ? ov.querySelectorAll('.ld-h').length : 0,
      /* 反证：账本里不应再出现方框类名 */
      hasKv: ov ? ov.querySelectorAll('.kv').length : 0,
      hasEvt: ov ? ov.querySelectorAll('.evt').length : 0,
      sample: ov ? [...ov.querySelectorAll('.ld-line')].slice(0, 4).map(e => e.textContent.trim()) : [],
    };
  });
  console.log('② 打开账本:', JSON.stringify(step2, null, 0));
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: path.join(OUT, 'ledger.png') });

  const step3 = await pg.evaluate(() => {
    const btn = document.querySelector('[data-ld-close]');
    if (btn) btn.click();
    const ov = document.getElementById('ledger-overlay');
    return { closed: !!(ov && ov.classList.contains('hidden')) };
  });
  console.log('③ 合上:', JSON.stringify(step3));

  await br.close(); srv.close();
})();
