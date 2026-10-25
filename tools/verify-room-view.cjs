/* 自检：点房间 → 场景放大 → 表单搬进房间 → 退出搬回
 * 用法：node tools/verify-room-view.cjs [截图输出目录]
 * 判据：stageOpen / decInRoom / decParent=sk-rs-body / hasSubmit 全为 true，
 *       退出后 decParent=ops-dock 且提交按钮仍在。
 * 说明：不依赖跑到某个特定 step，而是手动构造一个 repair 表单 —— 测的是 UI 路径本身。
 */const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, '..', '.tmp_shots', 'verify-room');
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
  const exe = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const br = await pw.chromium.launch({ executablePath: exe });
  const c = await br.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const pg = await c.newPage();
  pg.on('pageerror', e => console.log('[pageerror]', e.message));
  await pg.goto(base + '/index.html', { waitUntil: 'load' });
  await pg.evaluate(() => { const s = document.getElementById('seed'); if (s) s.value = '953'; document.getElementById('btn-start').click(); });
  await pg.waitForTimeout(900);

  /* 构造 repair 待决策：直接给 g.pending 塞一个表单，再 render */
  const setup = await pg.evaluate(() => {
    const G = window.Game, g = G.g;
    const me = g.players[g.humanId - 1];
    g.pending = {
      kind: 'repair', pid: me.id, title: '步骤 4a · 维修',
      desc: '选择一处设备进行维修（示例表单，用于验证房间近景）。',
      opts: [{ v: 'yes', label: '维修', sub: '消耗一次维修额度' }, { v: 'no', label: '跳过' }],
      targets: { list: g.players.filter(p => !p.out && p.id !== me.id).map(p => p.id), max: 1 },
      duration: 30,
    };
    window.UI.render();
    return { kind: g.pending.kind, pid: me.id };
  });
  console.log('构造:', JSON.stringify(setup));
  await pg.waitForTimeout(200);

  const r = await pg.evaluate(() => {
    const card = document.querySelector('.sk-room[data-room="repair"]');
    if (!card) return { err: 'no repair card' };
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const stage = document.getElementById('sk-room-stage');
    const dec = document.getElementById('region-dec');
    return {
      stageOpen: !!(stage && stage.classList.contains('open')),
      decInRoom: !!(dec && dec.classList.contains('in-room')),
      decParent: dec && dec.parentElement && dec.parentElement.className,
      hasSubmit: !!(stage && stage.querySelector('#btn-submit')),
      hasOpts: !!(stage && stage.querySelector('#f-opts')),
      hasTargets: !!(stage && stage.querySelector('#f-targets')),
      bg: stage && stage.querySelector('.sk-rs-bg') ? /rooms\/repair\.png/.test(stage.querySelector('.sk-rs-bg').style.backgroundImage) : false,
    };
  });
  console.log('房间近景:', JSON.stringify(r));
  /* 规则速览浮层可能在开局流程里被误触打开 —— 截图前强制关闭，否则整屏被它挡住 */
  await pg.evaluate(() => {
    const ov = document.getElementById('rules-overlay');
    if (ov) ov.classList.add('hidden');
  });
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: path.join(OUT, 'room.png') });

  /* 点「离开房间」→ 表单应搬回底部操作区 */
  const back = await pg.evaluate(() => {
    const btn = document.querySelector('#sk-room-stage [data-room-close]');
    if (btn) btn.click();
    const dec = document.getElementById('region-dec');
    const stage = document.getElementById('sk-room-stage');
    return {
      stageOpen: !!(stage && stage.classList.contains('open')),
      decInRoom: !!(dec && dec.classList.contains('in-room')),
      decParent: dec && dec.parentElement && dec.parentElement.className,
      stillHasSubmit: !!document.querySelector('#btn-submit'),
    };
  });
  console.log('退出房间:', JSON.stringify(back));

  await br.close(); srv.close();
})();
