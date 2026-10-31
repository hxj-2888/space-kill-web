/* 新返航录 · 返航录V1 · 浏览器断言门禁
 * ------------------------------------------------------------
 * 用法： node tools/test-v3.cjs
 * 依赖： playwright-core（优先本地 node_modules；找不到时可用
 *        PLAYWRIGHT_CORE 指定安装目录）
 * 覆盖： 2.5D 底图、搜尸、拖拽、幽灵态、DEV 无敌/全知、报告会议、
 *        不变量断言（SKInvariants）、监控室/电闸、地道选择、驱逐公布身份、
 *        音效日志/声纹、维修 10s 无限制、保安/医疗无人机、HUD 存活人数、
 *        AI 夜间能力（拉闸/停摆机器人/破坏舱室/钻管道/开枪/救人/补给）、
 *        破坏技选舱/60 秒故障/-3 进度/连续 10 秒维修、幽灵不可破坏、
 *        暗处不可隔空开枪、暂停/退出、事件流/回放复盘、亮走廊视野、
 *        AI 领申请单/反常拖尸/藏尸避人、枪刀音效分层、59 件真实掩体审计、
 *        控制台零报错、帧率。
 * 产出： tools/screenshots/*.png（可用 SHOT_DIR 覆盖）
 */
const path = require('path');
const fs = require('fs');

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_CORE,
    'playwright-core',
  ].filter(Boolean);
  const errors = [];
  for (const c of candidates) {
    try { return require(c); } catch (e) { errors.push(c + ': ' + (e.code || e.message)); }
  }
  throw new Error('未找到 playwright-core。请 npm i -D playwright-core，或设置 PLAYWRIGHT_CORE 指向安装目录。\n  ' + errors.join('\n  '));
}

const { chromium } = loadPlaywright();

const DIR = path.resolve(__dirname, '..');
const URL = 'file:///' + DIR.replace(/\\/g, '/') + '/index.html?test';
const SHOT = process.env.SHOT_DIR || path.join(DIR, 'tools', 'screenshots');
fs.mkdirSync(SHOT, { recursive: true });

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  PASS  ' + msg); }
  else { fail++; console.log('  FAIL  ' + msg); }
}
function section(t) { console.log('\n== ' + t); }

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push('CONSOLE ' + m.text());
  });
  const T = (fn, arg) => page.evaluate(fn, arg);
  const shot = async n => { await page.screenshot({ path: path.join(SHOT, n) }); };
  const shotClip = async (n, clip) => { await page.screenshot({ path: path.join(SHOT, n), clip }); };
  const freezeFx = async () => T(() => {
    const g = SKV3._t.G();
    g.noReport = true;
    g.fx.forEach(f => { f.dur = Math.max(6, f.dur); f.t = f.dur * 0.7; });
    g.agents.forEach(a => { if (a.act) { a.act.dur = Math.max(6, a.act.dur); a.act.t = a.act.dur * 0.3; } });
  });
  const fresh = async dev => {
    await page.evaluate(d => { SKV3._t.setDev(!!d); SKV3._t.newGame(); SKV3._t.G().noReport = false; }, !!dev);
    await page.waitForTimeout(260);
  };

  await page.goto(URL);
  /* 主页改成"先选身份再进入"：默认选中人类，点「进入舱段」开局 */
  const HOME = await T(() => ({
    ship: !!document.querySelector('#home-ship .room[data-room="bridge"]'),
    rooms: document.querySelectorAll('#home-ship .room').length,
    pipes: document.querySelectorAll('#home-ship .pipe').length,
    chips: document.querySelectorAll('#home-stats .chip').length,
    note: (document.getElementById('home-note').textContent || '').slice(0, 12),
    go: !!document.getElementById('home-go')
  }));
  ok(HOME.ship && HOME.rooms === 10 && HOME.pipes === 6 && HOME.chips >= 5 && HOME.go,
    '主页由 SKMapData 生成整船：' + HOME.rooms + ' 舱 / ' + HOME.pipes + ' 管道口 / ' +
    HOME.chips + ' 项统计');
  ok(HOME.note.length > 0, '主页默认展示已选身份的说明：' + HOME.note + '…');
  await page.click('#home-go');
  await page.waitForFunction(() => window.SKV3 && SKV3._t && SKV3._t.assets().base, null, { timeout: 30000 });
  await page.waitForTimeout(400);

  section('底图 / 基线');
  const A = await T(() => {
    const t = SKV3._t;
    return { a: t.assets(), n: t.state().length, inv: t.inv(), role: document.getElementById('role').textContent,
      tip: document.getElementById('tip').textContent, meet: !document.getElementById('meet').classList.contains('hide') };
  });
  ok(A.a.base && A.a.w === 4704 && A.a.h === 4413, 'Blender 2.5D 底图已加载 ' + A.a.w + '×' + A.a.h);
  ok(A.n === 15, '15 个席位');
  ok(A.inv && A.inv.fails.length === 0 && A.inv.checks > 200, '不变量基线 ' + (A.inv && A.inv.checks) + ' 项检查全过');
  ok(A.role.indexOf('人类') >= 0, 'HUD 显示人类');
  ok(A.tip.indexOf('S 搜尸') >= 0 && A.tip.indexOf('D 收尸') >= 0 && A.tip.indexOf('W 交互') >= 0,
    '提示栏改为 WASD 主操作键：W 交互 / S 搜尸 / D 收尸');
  ok(!A.meet, '?test 跳过开局会议，直接进夜');
  await T(() => { SKV3._t.tp(0, 34.8,33.8); });
  await page.waitForTimeout(300);
  await shot('24_2.5D底图_跟随.png');

  const fps = await T(() => new Promise(res => {
    let n = 0; const t0 = performance.now();
    (function f() { n++; if (performance.now() - t0 < 1600) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); })();
  }));
  ok(fps >= 24, '跟随视角帧率 ' + fps.toFixed(1) + ' ≥ 24');

  await page.keyboard.press('c');
  await page.waitForTimeout(300);
  await shot('25_2.5D底图_全图.png');
  await page.keyboard.press('c');
  await page.waitForTimeout(200);

  section('地图 · 扩容 / 管道 / 全连通');
  const MAPA = await T(() => {
    const t = SKV3._t, rs = t.rooms(), ps = t.pipes(), pts = t.points();
    const bad = [];
    for (const a of rs) for (const b of rs) {
      if (a.id === b.id) continue;
      if (!t.astar(a.x, a.y, b.x, b.y)) bad.push(a.id + '→' + b.id);
    }
    return { rs, ps, pts, bad, pipeFree: ps.every(p => t.free(p.x, p.y)),
      pipeRooms: ps.map(p => p.room).sort() };
  });
  ok(MAPA.rs.length === 10 && MAPA.bad.length === 0,
    '10 间房两两 A* 可达' + (MAPA.bad.length ? ' :: ' + MAPA.bad.join(',') : ''));
  const powerR = MAPA.rs.find(r => r.id === 'power'), engineR = MAPA.rs.find(r => r.id === 'engine'),
    transitR = MAPA.rs.find(r => r.id === 'transit');
  ok(powerR.area === 148 && powerR.cls === '小' && engineR.area === 216 && engineR.cls === '中',
    '配电室 148 格（小型）/ 引擎 216 格（中型）');
  ok(transitR.area === 102 && transitR.cls === '小',
    '食堂仍为小型：102 格');
  ok(MAPA.ps.length === 6 && MAPA.pipeFree &&
    MAPA.pipeRooms.join(',') === 'armory,cam,engine,med,transit,warehouse',
    '6 个管道口全部可站立：engine / cam / armory / warehouse / 食堂 / 医疗间');
  const whPipe = MAPA.ps.find(p => p.room === 'warehouse');
  ok(whPipe && whPipe.x > 50 && whPipe.y < 15,
    '仓库管道位于新舱室（' + (whPipe ? whPipe.x + ',' + whPipe.y : '缺') + '）');
  ok(MAPA.pts.length === 26 && MAPA.pts.every(p => p.d <= 2.6),
    '26 个任务点全部能被 nearPoint 命中（高难 8 / 普通 18）');
  const whRoom = MAPA.rs.find(r => r.id === 'warehouse');
  ok(whRoom && whRoom.area === 504 && whRoom.cls === '大' && whRoom.doors.length === 1,
    '仓库是 42×12 大型单门舱室（504 格）');
  const hardN = MAPA.pts.filter(p => p.kind === 'hard').length;
  const normalN = MAPA.pts.filter(p => p.kind === 'normal').length;
  ok(hardN === 8 && normalN === 18 &&
    MAPA.pts.filter(p => p.room === 'power' && p.kind === 'normal').length === 0 &&
    MAPA.pts.filter(p => p.room === 'engine' && p.kind === 'normal').length === 3 &&
    MAPA.pts.filter(p => p.room === 'warehouse' && p.kind === 'normal').length === 3,
    '任务点重排：高难 8 / 普通 18，配电室无普通点，引擎/仓库各 3 个普通点');

  section('搜尸');
  await fresh(false);
  const S = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    /* 测试隔离：本节只验搜尸/拖拽，先卸掉异形 AI 的刀，避免它把测试玩家击倒 */
    for (const a of g.agents) if (a.alien) { a.knife = 0; a.target = null; a.path = null; }
    t.tp(1, 28.2,44);
    t.kill(1, 'knife');
    const b = t.bodyOf(1);
    t.tp(0, b[0] + 0.5, b[1] + 0.5);
    return { b, st: t.state()[1], dur: t.inv() };
  });
  ok(S.b && Math.abs(S.b[0] - 28.2) < 0.01 && Math.abs(S.b[1] - 44.0) < 0.01, '尸体留在死亡点 (28.2,44.0)');
  ok(!S.st.alive && S.st.ghost && S.st.cause === 'knife', '死亡 → 幽灵态，死因刀伤');
  ok(S.dur && S.dur.fails.length === 0, '死亡后不变量仍全过');
  await page.keyboard.press('x');
  await page.waitForTimeout(1700);
  const card = await T(() => {
    const el = document.getElementById('body');
    return { open: !el.classList.contains('hide'), text: el.textContent, inspect: SKV3._t.inspect(),
      t: SKV3._t.G().t };
  });
  ok(card.open && card.inspect === '银翼', 'X 开启尸检卡：' + card.inspect);
  ok(card.text.indexOf('刀伤') >= 0, '尸检给出死因（刀伤）');
  ok(card.text.indexOf('无法判断') >= 0, '非 DEV 不显示凶手');
  ok(card.text.indexOf('未被移动') >= 0, '尸检给出移动状态');
  const t0 = card.t;
  await page.waitForTimeout(500);
  const t1 = await T(() => SKV3._t.G().t);
  ok(Math.abs(t0 - t1) < 0.02, '尸检期间游戏暂停（计时冻结）');
  await shot('26_搜尸.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  ok((await T(() => SKV3._t.inspect())) === null, 'Esc 关闭尸检卡');

  section('拖拽');
  await page.keyboard.press('g');
  await page.waitForTimeout(150);
  const D = await T(() => ({ drag: SKV3._t.dragOf(), st: SKV3._t.state()[1],
    tag: !document.getElementById('dragtag').classList.contains('hide'), inv: SKV3._t.inv(),
    me: SKV3._t.state()[0], paused: SKV3._t.paused(), msg: SKV3._t.G().msg }));
  ok(D.drag === 1 && D.st.draggedBy === 0, 'G 拖起尸体，双向标记互指' +
    (D.drag === 1 ? '' : ' :: ' + JSON.stringify({ msg: D.msg, paused: D.paused, me: D.me })));
  ok(D.tag, '拖拽提示条显示');
  ok(D.inv && D.inv.fails.length === 0, '拖拽起始不变量全过');
  const before = D.st.body;
  await T(() => { SKV3._t.tp(0, 28.3,41.7); });
  await page.waitForTimeout(450);
  const D2 = await T(() => {
    const t = SKV3._t; const me = t.pos(); const st = t.state()[1];
    return { st, me, d: Math.hypot(st.body[0] - me[0], st.body[1] - me[1]), inv: t.inv() };
  });
  const moved = Math.hypot(D2.st.body[0] - before[0], D2.st.body[1] - before[1]);
  ok(moved > 1.2, '尸体被拖动 ' + moved.toFixed(2) + ' 格');
  ok(D2.st.bodyMoved === true, 'bodyMoved 标记置位');
  ok(D2.d <= 3.2, '拖拽距离 ' + D2.d.toFixed(2) + ' ≤ 3.2');
  ok(D2.inv && D2.inv.fails.length === 0, '拖拽中不变量全过');
  await shot('27_拖拽.png');
  await page.keyboard.press('g');
  await page.waitForTimeout(150);
  const D3 = await T(() => ({ drag: SKV3._t.dragOf(), st: SKV3._t.state()[1],
    tag: !document.getElementById('dragtag').classList.contains('hide'), inv: SKV3._t.inv() }));
  ok(D3.drag === null && D3.st.draggedBy === null && !D3.tag, 'G 放下：拖拽标记与提示条清除');
  ok(D3.inv && D3.inv.fails.length === 0, '放下后不变量全过');

  section('搜尸 · 取走尸体身上的物资');
  await fresh(false);
  const LOOT = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true;
    for (const a of g.agents) if (a.alien) { a.knife = 0; a.target = null; a.path = null; }
    const v = g.agents[1];
    v.bullet = 1; v.medkit = 1; v.qual = 2;
    t.tp(v.i, 28.2,44);
    t.kill(v.i, 'knife');
    t.tp(0, 28.4,44.4);
    g.me.bullet = 0; g.me.medkit = 0; g.me.qual = 0;
    return { v: v.i, before: t.bodyItems(v.i), vname: v.name };
  });
  ok(LOOT.before.bullet === 1 && LOOT.before.medkit === 1 && LOOT.before.qual === 2,
    '尸体保留生前物资：子弹 / 医疗包 / 申请单');
  await page.keyboard.press('s');
  await page.waitForTimeout(1650);
  const LOOT2 = await T(o => {
    const t = SKV3._t, g = t.G();
    return { body: t.bodyItems(o.v), bullet: g.me.bullet, medkit: g.me.medkit, qual: g.me.qual,
      msg: g.msg, searched: t.state()[o.v].searched, card: t.inspect(), inv: t.inv() };
  }, LOOT);
  ok(LOOT2.bullet === 1 && LOOT2.medkit === 1 && LOOT2.qual === 2,
    'S 搜尸把子弹 / 医疗包 / 申请单一起收进背包');
  ok(LOOT2.body.bullet === 0 && LOOT2.body.medkit === 0 && LOOT2.body.qual === 0,
    '尸体上的物资被清空（不是复制）');
  ok(/取得/.test(LOOT2.msg) && LOOT2.card === '银翼',
    '搜尸播报列出取得的物资，并打开尸检卡：' + LOOT2.msg);
  ok(LOOT2.searched === true && LOOT2.inv.fails.length === 0, '搜尸同时完成取证，不变量全过');
  await T(() => { SKV3._t.tp(0, 28.4,44.4); SKV3._t.G().msg = ''; });
  await page.keyboard.press('Escape');   /* 先关掉上一步自动打开的尸检卡 */
  await page.waitForTimeout(120);
  await page.keyboard.press('s');
  await page.waitForTimeout(320);
  const LOOT3 = await T(() => {
    const t = SKV3._t, g = t.G();
    return { do: g.me._doing, msg: g.msg };
  });
  ok(LOOT3.do !== 'search' && /(没有可带走|已经检查)/.test(LOOT3.msg),
    '物资取空后再搜尸会被拒绝（不再空耗 1.2 秒）：' + LOOT3.msg);

  const LOOT4 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const v = g.agents.find(a => !a.alien && a.i !== 0);
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a !== v);
    for (const a of g.agents) if (a !== v && a !== h) t.tp(a.i, 30,32);
    v.bullet = 1; v.qual = 1;
    t.tp(v.i, 28.2,44); t.kill(v.i, 'knife');
    t.tp(h.i, 28.4,44.4);
    h.bullet = 0; h.qual = 0; h.doing = 0; h._doing = null; h.path = null; h._delay = 0;
    t.aiScan(h.i, 0.6);
    const do0 = g.agents[h.i]._doing;
    t.aiTick(h.i, 40, 0.05);
    return { h: h.i, v: v.i, do0, bullet: g.agents[h.i].bullet, qual: g.agents[h.i].qual,
      body: t.bodyItems(v.i), searched: t.state()[v.i].searched, inv: t.inv() };
  });
  ok(LOOT4.do0 === 'search' && LOOT4.bullet === 1 && LOOT4.qual === 1,
    'AI 人类会主动搜尸取物资：子弹 +1 / 申请单 +1');
  ok(LOOT4.body.bullet === 0 && LOOT4.searched === true,
    'AI 搜完同样清空尸体物资并完成取证');
  ok(LOOT4.inv.fails.length === 0, 'AI 搜尸后不变量全过');

  const LOOT5 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const v = g.agents.find(a => !a.alien && a.i !== 0);
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== v && a !== k) t.tp(a.i, 30,32);
    v.bullet = 1;
    t.tp(v.i, 28.2,44); t.kill(v.i, 'knife');
    t.tp(k.i, 28.4,44.4);
    k.bullet = 0; k.doing = 0; k._doing = null; k.path = null; k._delay = 0; k.sabUsed = true;
    t.aiScan(k.i, 0.6);
    const do0 = g.agents[k.i]._doing;
    t.aiTickAlien(k.i, 40, 0.05);
    return { do0, bullet: g.agents[k.i].bullet, body: t.bodyItems(v.i), inv: t.inv() };
  });
  ok(LOOT5.do0 === 'search' && LOOT5.bullet === 1 && LOOT5.body.bullet === 0,
    'AI 异形也会搜尸取物资（从尸体上拿走子弹）');
  ok(LOOT5.inv.fails.length === 0, '异形搜尸后不变量全过');

  section('幽灵态');
  await fresh(false);
  const G0 = await T(() => {
    const t = SKV3._t;
    t.tp(0, 28.2,44);
    t.kill(0, 'knife');
    return { st: t.state()[0], fog: t.fog(), role: document.getElementById('role').textContent,
      tip: document.getElementById('tip').textContent, inv: t.inv() };
  });
  ok(!G0.st.alive && G0.st.ghost && G0.st.body, '玩家死亡 → 幽灵 + 留尸');
  ok(G0.fog === false, '幽灵全视（雾关闭）');
  ok(G0.role.indexOf('幽灵') >= 0, 'HUD 标记幽灵');
  ok(G0.tip.indexOf('穿墙') >= 0, '提示栏切换为幽灵操作');
  ok(G0.inv && G0.inv.fails.length === 0, '幽灵态不变量全过');
  const p0 = await T(() => SKV3._t.pos());
  await page.mouse.click(880, 450);
  await page.waitForTimeout(500);
  const p1 = await T(() => SKV3._t.pos());
  ok(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 1.5, '幽灵点击移动（直线穿墙）');
  const GR = await T(() => {
    const t = SKV3._t, g = t.G();
    g.me.tasks = [0, 1, 2, 3]; g.me.tIdx = 0;
    const spot = t.taskSpot(0);
    t.tp(0, spot.x, spot.y); g.me.path = null;
    return { pos: t.pos(), spot };
  });
  await page.keyboard.press('e');
  await page.waitForTimeout(200);
  const GD = await T(() => ({ doing: SKV3._t.G().me.doing, prog: SKV3._t.G().prog }));
  ok(GD.doing > 18 && GD.doing <= 21, '幽灵维修耗时 1.6×（' + GD.doing.toFixed(1) + 's）');
  await T(() => { SKV3._t.G().me.doing = 0.03; });
  await page.waitForTimeout(300);
  const GR2 = await T(() => ({ prog: SKV3._t.G().prog, tIdx: SKV3._t.G().me.tIdx, inv: SKV3._t.inv() }));
  ok(GR2.prog >= 2 && GR2.tIdx === 1, '幽灵维修可完成并计分（prog=' + GR2.prog + '）');
  ok(GR2.inv && GR2.inv.fails.length === 0, '幽灵修完不变量全过');
  const GCAP = await T(() => {
    const t = SKV3._t, g = t.G();
    const spot = t.taskSpot(0);
    t.tp(0, spot.x, spot.y);
    g.me.doing = 0; g.me._doing = null; g.me.path = null;
    return { pts: g.me.ghostPts, tIdx: g.me.tIdx, spot: spot.label };
  });
  await page.keyboard.press('e');
  await page.waitForTimeout(220);
  const GCAP2 = await T(() => {
    const g = SKV3._t.G();
    return { pts: g.me.ghostPts, tIdx: g.me.tIdx, do: g.me._doing, msg: g.msg };
  });
  ok(GCAP.pts === 2 && GCAP2.pts === 2, '幽灵任务额度：修满 2 分');
  ok(GCAP2.do === null && GCAP2.tIdx === GCAP.tIdx && GCAP2.msg.indexOf('2 分') >= 0,
    '幽灵额度用尽后不再开始新任务（' + GCAP.spot + '）');
  await T(() => { SKV3._t.tp(0, 28.2,43.1); });
  await page.waitForTimeout(350);
  await page.keyboard.press('x');
  await page.waitForTimeout(600);
  ok(!(await T(() => !document.getElementById('body').classList.contains('hide'))), '幽灵无法搜尸');
  await shot('28_幽灵态.png');

  section('幽灵任务 · 乱序 / 故障维修');
  await fresh(false);
  const GO = await T(() => {
    const t = SKV3._t, g = t.G();
    t.tp(0, 28.2,44); t.kill(0, 'knife');
    g.me.tasks = [0, 4, 11, 8]; g.me.tIdx = 0; g.me.progress = 0;
    g.me.doing = 0; g.me._doing = null; g.me.path = null;
    const P = t.points()[11];
    t.tp(0, P.x, P.y);
    return { label: P.label };
  });
  await page.keyboard.press('e');
  await page.waitForTimeout(180);
  const GO1 = await T(() => {
    const g = SKV3._t.G();
    return { do: g.me._doing, doing: g.me.doing, pt: g.me._taskPt, tIdx: g.me.tIdx };
  });
  ok(GO1.do === 'task' && GO1.pt === 11 && GO1.doing > 12.2 && GO1.doing <= 13.4,
    '幽灵乱序维修：实际点位「' + GO.label + '」，耗时 1.6×');
  await T(() => SKV3._t.finishDoing(0));
  const GO2 = await T(() => {
    const g = SKV3._t.G();
    return { tIdx: g.me.tIdx, prog: g.prog, msg: g.msg,
      left: g.me.tasks.slice(g.me.tIdx).map(i => SKV3._t.points()[i].label),
      doing: g.me.doing };
  });
  ok(GO2.tIdx === 1 && GO2.prog === 1 && GO2.msg.indexOf(GO.label) >= 0 &&
    GO2.left.indexOf(GO.label) < 0 && GO2.doing === 0,
    '幽灵任务按实际点位结算，完成后计时归零');
  const GF = await T(() => {
    const t = SKV3._t, g = t.G();
    const alien = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    alien.sabUsed = false; g.dmg = [];
    t.damageRoom(alien.i, 'med');
    const d = g.dmg[0];
    g.me.doing = 0; g.me._doing = null; g.me.path = null;
    t.tp(0, d.x, d.y);
    const start = t.interact();
    return { start, dmg: g.dmg.length, doing: g.me.doing, label: d.label };
  });
  ok(GF.start.do === 'fix' && GF.doing > 15.5 && GF.dmg === 1,
    '幽灵维修故障：进入连续维修且与任务同样 1.6×');
  await T(() => { SKV3._t.G().me.doing = 0.02; });
  await page.waitForTimeout(260);
  const GF2 = await T(() => ({ dmg: SKV3._t.dmg().length, inv: SKV3._t.inv() }));
  ok(GF2.dmg === 0 && GF2.inv && GF2.inv.fails.length === 0,
    '幽灵修完故障：故障清除，不变量全过');

  section('性格轴 · 激进/谨慎的系数差');
  const TR8 = await T(() => {
    const bold = { aggr: 72, caut: 28, soc: 50, cur: 50 };
    const shy = { aggr: 28, caut: 72, soc: 50, cur: 50 };
    const a1 = { trait: bold }, a2 = { trait: shy };
    return {
      boldBold: SKTrait.C.knifeBold(a1), shyBold: SKTrait.C.knifeBold(a2),
      boldAbstain: SKTrait.C.voteAbstain(a1), shyAbstain: SKTrait.C.voteAbstain(a2),
      boldShoot: SKTrait.C.shootSus(a1), shyShoot: SKTrait.C.shootSus(a2),
      boldReach: SKTrait.C.knifeReach(a1), shyReach: SKTrait.C.knifeReach(a2),
      boldFlee: SKTrait.C.fleeThreshold(a1), shyFlee: SKTrait.C.fleeThreshold(a2),
    };
  });
  ok(TR8.boldBold > TR8.shyBold && TR8.boldAbstain < TR8.shyAbstain &&
    TR8.boldShoot < TR8.shyShoot && TR8.boldReach > TR8.shyReach &&
    TR8.boldFlee > TR8.shyFlee,
    '激进 vs 谨慎：更敢在目击者前出刀（' + TR8.boldBold.toFixed(2) + '/' + TR8.shyBold.toFixed(2) +
    '）· 更少弃权（' + TR8.boldAbstain.toFixed(2) + '/' + TR8.shyAbstain.toFixed(2) +
    '）· 更低开枪门槛 · 更远收刀 · 弃修阈值更高');

  section('DEV 无敌 / 全知');
  await fresh(true);
  const V = await T(() => {
    const t = SKV3._t;
    return { dev: t.dev(), panel: !document.getElementById('dev').classList.contains('hide'),
      line: !document.getElementById('devline').classList.contains('hide'),
      rows: document.querySelectorAll('#dev .dr').length, text: document.getElementById('dev').textContent,
      alive: t.state()[0].alive, inv: t.inv() };
  });
  ok(V.dev && V.panel && V.line, 'F2/API 开启 DEV：面板与 HUD 行可见');
  ok(V.rows === 15, 'DEV 面板列出 15 个席位');
  ok(V.text.indexOf('异形') >= 0 && V.text.indexOf('人类') >= 0, 'DEV 面板显示全部身份');
  /* DEV 横栏（2026-10-31）：从右侧竖栏改贴顶横栏，且不许压住左上角 HUD */
  const VD = await T(() => {
    const dev = document.getElementById('dev');
    const hud = document.getElementById('hud');
    const dv = dev.getBoundingClientRect(), hv = hud.getBoundingClientRect();
    const rows = [...document.querySelectorAll('#dev-rows .dr')].map(e => e.textContent);
    const cols = getComputedStyle(document.getElementById('dev-rows'))
      .gridTemplateColumns.split(' ').filter(Boolean).length;
    return { devTop: dv.top, devH: dv.height, hudTop: hv.top, rows, cols,
      dn: !document.getElementById('dnwrap').classList.contains('hide') };
  });
  ok(VD.devTop <= 2 && VD.devH > 30 && VD.devH < 180,
    'DEV 总览是顶部横栏（top=' + VD.devTop.toFixed(0) + ' · 高 ' + VD.devH.toFixed(0) + 'px）');
  ok(VD.hudTop >= VD.devH - 2,
    'DEV 横栏不占用左上角（HUD 顶边 ' + VD.hudTop.toFixed(0) + ' ≥ 横栏高 ' + VD.devH.toFixed(0) + '）');
  /* 2026-10-31：卡片压到 1/8 屏宽后资源行改成紧凑写法（弹0 包0 单0），
     正则容忍带不带空格两种排版，别让排版微调反复弄红门禁 */
  ok(VD.rows.length === 15 &&
    VD.rows.every(r => /弹\s*\d+/.test(r) && /包\s*\d+/.test(r) && /单\s*\d+/.test(r)),
    'DEV 卡片显示每人身上的资源（弹 / 包 / 申请单 / 任务）');
  ok(VD.cols >= 4 && VD.rows.length === 15,
    'DEV 卡片排成多列（' + VD.cols + ' 列 × 2 排，不再横向滚动）');
  ok(VD.dn, 'DEV 下才显示左上角濒死人数');
  const VN = await T(() => {
    SKV3._t.setDev(false);
    const out = {
      dn: !document.getElementById('dnwrap').classList.contains('hide'),
      panel: !document.getElementById('dev').classList.contains('hide'),
      hudTop: SKV3._t ? document.getElementById('hud').getBoundingClientRect().top : 0
    };
    SKV3._t.setDev(true);
    return out;
  });
  ok(!VN.dn && !VN.panel, '关闭 DEV：濒死人数与全知面板一起隐藏（对局内不再显示谁倒了）');
  const K = await T(() => {
    const t = SKV3._t, g = t.G();
    g.agents[1].knife = 1;
    const before = g.agents[1].knife;
    t.knife(1, 0);
    return { st: t.state()[0], inv: t.inv(), before, after: g.agents[1].knife,
      red: g.agents[1].redT };
  });
  ok(K.st.alive && !K.st.downed, 'DEV 无敌：AI 出刀对玩家无效');
  ok(K.before === 1 && K.after === 0,
    'DEV 免伤仍然消耗 AI 的刀（不会变成无限连刀，与子弹同一口径）');
  ok(K.red >= 2.5, 'DEV 免伤的这一刀同样留下刀者红身');
  ok(K.inv && K.inv.fails.length === 0, 'DEV 被刀后不变量全过');
  const VM = await T(() => {
    const t = SKV3._t;
    t.openMeeting('night');
    const m = t.G().meet;
    m.votes = { 1: 0, 2: 0, 3: 0, 4: 0 };
    m.phase = 'vote';
    t.closeVote();
    const mm = t.G().meet;
    return { alive: t.state()[0].alive, tally: mm.tally,
      text: document.getElementById('m-tally').textContent, inv: t.inv() };
  });
  ok(VM.alive && VM.tally && VM.tally.devSaved, 'DEV 无敌：驱逐票无效');
  ok(VM.text.indexOf('驱逐无效') >= 0, '会议公布栏提示 DEV 免疫');
  await T(() => SKV3._t.finishMeeting());
  await page.waitForTimeout(300);
  await page.keyboard.press('c');
  await page.waitForTimeout(400);
  await shot('29_DEV全知.png');
  const INV = await T(() => SKV3._t.inv());
  ok(INV && INV.fails.length === 0, 'DEV 会议后不变量全过');
  await page.keyboard.press('c');
  await page.waitForTimeout(200);

  section('报告会议');
  await fresh(false);
  const R = await T(() => {
    const t = SKV3._t;
    t.tp(2, 28.2,44);
    t.kill(2, 'shot');
    const b = t.bodyOf(2);
    t.tp(0, b[0] + 0.5, b[1] + 0.5);
    const st = t.state()[2];
    return { b, name: st.name, tag: String(st.i + 1).padStart(2, '0') + ' ' + st.name };
  });
  await page.keyboard.press('r');
  await page.waitForTimeout(300);
  const M = await T(() => {
    const t = SKV3._t;
    return { open: !document.getElementById('meet').classList.contains('hide'),
      vic: document.getElementById('m-vic').textContent, kind: t.G().meet && t.G().meet.kind,
      inv: t.inv() };
  });
  ok(M.open && M.vic === R.tag, 'R 报告尸体：会议打开，受害者 ' + R.tag);
  ok(M.kind === 'night', '会议类型：夜间紧急会议');
  await shot('30_报告会议.png');
  const rem0 = await T(() => SKClock.remaining(SKV3._t.G().phase, performance.now()));
  await page.waitForTimeout(650);
  await T(() => SKV3._t.finishMeeting());
  await page.waitForTimeout(200);
  const rem1 = await T(() => SKClock.remaining(SKV3._t.G().phase, performance.now()));
  ok(rem1 < rem0 - 300, '夜间会议时长从夜晚时间里扣除');
  ok((await T(() => SKV3._t.G().meet)) === null, '会议关闭');
  const MF = await T(() => SKV3._t.inv());
  ok(MF && MF.fails.length === 0, '散会后不变量全过');

  section('专属动画 · 出刀');
  await fresh(false);
  const KN = await T(() => {
    const t = SKV3._t, g = t.G();
    const k = g.agents.find(a => a.alien && a !== g.me && a.alive);
    const v = g.agents.find(a => !a.alien && a !== g.me && a.alive);
    t.tp(k.i, 34.8,33.8); t.tp(v.i, 35.75,33.8); t.tp(0, 33.4,33.8);
    k.knife = 1;
    t.knife(k.i, v.i);
    return { fx: t.fx(), acts: t.acts(), downed: t.state()[v.i].downed,
      stab: g.agents[k.i].act, hurt: g.agents[v.i].act, k: k.i, v: v.i };
  });
  ok(KN.fx.includes('slash') && KN.fx.includes('blood'), '出刀：斩击弧 + 血雾特效');
  ok(KN.acts.includes('stab') && KN.acts.includes('hurt'), '出刀：挥砍突进 + 受击后仰');
  ok(KN.stab && KN.stab.lunge > 0.3 && KN.stab.ang != null, '出刀动作带方向与突进距离');
  ok(KN.downed, '出刀命中 → 目标濒死');
  await page.waitForTimeout(1400);
  const KNF = await T(o => {
    const g = SKV3._t.G();
    return { kAct: g.agents[o.k].act, vAct: g.agents[o.v].act };
  }, KN);
  ok(!KNF.kAct && !KNF.vAct, '出刀动作按真实时间自动收尾');
  await T(o => {
    const t = SKV3._t, g = t.G();
    const k = g.agents[o.k], v = g.agents[o.v];
    const v2 = g.agents.find(a => !a.alien && a !== g.me && a.alive && a !== v);
    for (const a of g.agents) if (a !== g.me && a !== k && a !== v2) { a.path = null; a.x = 28.2; a.y = 44.0; }
    t.tp(0, 33.4,33.8);
    t.tp(k.i, 34.8,33.8); k.knife = 1; k.detained = false; k.path = null;
    t.tp(v2.i, 35.75,33.8);
    t.knife(k.i, v2.i);
  }, KN);
  await page.waitForTimeout(90);
  await freezeFx();
  await shotClip('31_出刀动画.png', { x: 440, y: 220, width: 600, height: 460 });

  section('刀者红身 · 3 秒');
  await fresh(false);
  const RED = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const k = g.agents.find(a => a.alien && a !== g.me && a.alive);
    const v = g.agents.find(a => !a.alien && a !== g.me && a.alive);
    for (const a of g.agents) if (a !== g.me && a !== k && a !== v) {
      a.knife = 0; a.path = null; a.x = 28.2; a.y = 44.0;
    }
    t.tp(k.i, 34.8,33.8); t.tp(v.i, 35.7,33.8); t.tp(0, 33.2,33.8);
    k.knife = 1; k.sabUsed = true; k._delay = 999; v._delay = 999;
    t.knife(k.i, v.i);
    const st = t.state();
    return { k: k.i, v: v.i, red: st[k.i].redT, victimRed: st[v.i].redT };
  });
  ok(RED.red >= 2.9 && RED.red <= 3.0, '出刀者获得 3 秒红身标记（' + RED.red + 's）');
  ok(RED.victimRed === 0, '红身只给刀者，不给被击倒者');
  await page.waitForTimeout(1200);
  const RED2 = await T(o => SKV3._t.state()[o.k].redT, RED);
  ok(RED2 > 0.8 && RED2 < 2.6, '红身按真实时间衰减（1.2 秒后剩 ' + RED2.toFixed(2) + 's）');
  await page.waitForTimeout(2600);
  const RED3 = await T(o => ({ red: SKV3._t.state()[o.k].redT, inv: SKV3._t.inv() }), RED);
  ok(RED3.red === 0, '3 秒后红身自动结束');
  ok(RED3.inv.fails.length === 0, '红身结束后不变量全过');

  section('任务标记 · 掩体本体闪烁取代黄色边框');
  await fresh(false);
  const TK = await T(() => {
    const t = SKV3._t, g = t.G();
    g.paused = true; g.noReport = true;
    const pts = t.points();
    const idx = pts.findIndex(p => p.label === '引擎组同步');
    g.me.tasks = [idx]; g.me.tIdx = 0;
    t.tp(0, pts[idx].x + 2.4, pts[idx].y + 2.4);
    g.gfx.coverFlashes = 0; g.gfx.dashedBorders = 0;
    return { idx, spot: pts[idx] };
  });
  await page.waitForTimeout(360);
  const TK2 = await T(() => SKV3._t.gfx());
  ok(TK2.coverFlashes > 0, '任务点所在掩体以本体金色脉冲提示（' + TK2.coverFlashes + ' 帧叠加）');
  ok(TK2.dashedBorders === 0, '不再给掩体套黄色虚线边框');

  section('专属动画 · 开枪');
  await fresh(false);
  const SH = await T(() => {
    const t = SKV3._t, g = t.G();
    t.tp(0, 34.8,33.8);
    for (const a of g.agents) if (a !== g.me) { a.path = null; a.x = 28.2; a.y = 44.0; }
    t.tp(2, 30.5,33.8);
    g.me.bullet = 1;
    t.shoot();
    return { fx: t.fx(), acts: t.acts(), bullet: g.me.bullet, downed: t.state()[2].downed,
      target: 2, tracer: g.fx.find(f => f.type === 'tracer'),
      muzzle: !!g.fx.find(f => f.type === 'muzzle'),
      impact: !!g.fx.find(f => f.type === 'impact'),
      blood: !!g.fx.find(f => f.type === 'blood') };
  });
  ok(SH.tracer && Math.abs(SH.tracer.x2 - 30.5) < 0.01 && Math.abs(SH.tracer.y2 - 33.8) < 0.01,
    '开枪：弹道从枪口连到目标');
  ok(SH.muzzle && SH.impact && SH.blood, '开枪：枪口火光 + 命中环 + 血雾');
  ok(SH.acts.includes('shoot') && SH.acts.includes('hurt'), '开枪：后坐 + 受击动作');
  ok(SH.bullet === 0 && SH.downed, '开枪消耗子弹并击倒目标');
  await freezeFx();
  await shotClip('32_开枪动画.png', { x: 360, y: 220, width: 760, height: 460 });
  await page.waitForTimeout(5000);
  const SHF = await T(o => {
    const g = SKV3._t.G();
    return { fx: g.fx.filter(f => f.type === 'tracer' || f.type === 'muzzle' || f.type === 'impact'),
      act: g.agents[o.target].act };
  }, SH);
  ok(SHF.fx.length === 0 && SHF.act === null, '开枪特效/后坐按真实时间自动收尾');

  section('专属动画 · 维修 / 领取物资申请单 / 领取补给');
  await fresh(false);
  const DURS = await T(() => SKV3._t.taskDurs());
  const dNorm = DURS.filter(d => d.kind === 'normal');
  const dHard = DURS.filter(d => d.kind === 'hard');
  ok(DURS.length === 26 && dNorm.length === 18 && dNorm.every(d => d.dur === 8) &&
    dHard.length === 8 && dHard.filter(d => d.dur === 12).length === 7 &&
    dHard.filter(d => d.dur === 15).length === 1,
    '18 个普通任务 ' + dNorm[0].dur + ' 秒 / 7 个高难 12 秒 / 电路维修 15 秒');
  const W0 = await T(() => {
    const t = SKV3._t, g = t.G();
    for (const a of g.agents) if (a !== g.me) { a.path = null; a.x = 28.2; a.y = 44.0; }
    const allP = t.points();
    const pi = allP.findIndex(p => p.label === '药柜');
    const mp = allP[pi];
    const normals = allP.map((p, i) => ({ p, i })).filter(x => x.p.kind === 'normal' && x.i !== pi).map(x => x.i);
    t.tp(0, mp.x - 1.6, mp.y + 1.4);
    g.me.tasks = [pi, normals[0], normals[1], normals[2]]; g.me.tIdx = 0; g.me.progress = 2;
    g.me.qual = 0; g.me.qualPending = 0;
    g.me.doing = 0; g.me._doing = null; g.me.path = null;
    return { room: t.state()[0].room, spot: t.taskSpot(0) };
  });
  await page.keyboard.press('e');
  await page.waitForFunction(() => SKV3._t.fx().includes('workSpark'), null, { timeout: 3000 });
  const W1 = await T(() => {
    const g = SKV3._t.G();
    return { doing: g.me.doing, dur: g.me._dur, do: g.me._doing, fx: SKV3._t.fx() };
  });
  ok(W0.room === 'med' && W0.spot && W0.spot.label === '药柜', '维修点：医疗间 / 药柜');
  ok(W1.do === 'task' && W1.doing > 7.4 && W1.dur === 8, '维修：进入工作态（普通任务 ' + W1.dur + 's 倒计时）');
  ok(W1.fx.includes('workSpark'), '维修：工具接触点持续冒火花');
  await T(() => { const g = SKV3._t.G(); g.me.doing = 40; g.me._dur = 60; });
  await freezeFx();
  await shotClip('33_维修动画.png', { x: 440, y: 220, width: 600, height: 460 });
  await T(() => { const g = SKV3._t.G(); g.me.doing = 9.5; g.me._dur = 10; });
  /* 站桩规则：任务维修中移动 → 立即打断，不结算 */
  await T(() => { const g = SKV3._t.G(); g.me.path = [[g.me.x + 1.6, g.me.y]]; });
  await page.waitForTimeout(340);
  const W2 = await T(() => {
    const g = SKV3._t.G();
    return { doing: g.me.doing, do: g.me._doing, tIdx: g.me.tIdx, msg: g.msg };
  });
  ok(W2.doing === 0 && W2.do === null && W2.tIdx === 0 && W2.msg.indexOf('移动打断') >= 0,
    '任务维修必须站桩：移动立即打断且不计分');
  /* 回到任务点重新开工并完成 */
  await T(() => {
    const t = SKV3._t, g = t.G();
    g.me.path = null; g.me.moving = false; g.me.doing = 0; g.me._doing = null;
    const spot = t.taskSpot(0); t.tp(0, spot.x, spot.y);
  });
  await page.keyboard.press('e');
  await page.waitForTimeout(160);
  const W3 = await T(() => { const g = SKV3._t.G(); return { do: g.me._doing, doing: g.me.doing }; });
  ok(W3.do === 'task' && W3.doing > 7.4, '重新按 E 继续维修（计时从 8 秒重来）');
  await T(() => { SKV3._t.G().me.doing = 0.02; });
  await page.waitForTimeout(240);
  const Q = await T(() => {
    const g = SKV3._t.G();
    return { prog: g.prog, qual: g.me.qual, pending: g.me.qualPending, progress: g.me.progress,
      tIdx: g.me.tIdx, fx: SKV3._t.fx(),
      ql: document.getElementById('ql').textContent, qp: document.getElementById('qp').textContent,
      qpPop: document.getElementById('qp').classList.contains('pop'),
      hint: !document.getElementById('qual-hint').classList.contains('hide'),
      doneFx: !!g.fx.find(f => f.type === 'done'), qualFx: !!g.fx.find(f => f.type === 'qual') };
  });
  ok(Q.tIdx === 1 && Q.progress >= 3, '完成维修：任务索引 +1，积分累加');
  ok(Q.qual === 0 && Q.pending === 1 && Q.qp === '1' && Q.ql === '0',
    '积分到 3 → 生成 1 份待领取物资申请单（HUD 待领 1 / 申请单 0）');
  ok(Q.hint, '待领申请单时 HUD 常驻提示「回圆桌领取」（不用猜领取地点）');
  ok(Q.doneFx && !Q.qualFx, '任务完成只给完工特效；申请单必须回中央会议室圆桌领取');
  ok(Q.qpPop, 'HUD 待领申请单数字弹跳（.pop）');
  const Q2 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.fx.length = 0;
    g.me.doing = 0; g.me._doing = null; g.me.path = null;
    const spot = t.taskSpot(0);
    t.tp(0, spot.x, spot.y);
    return { spot, tIdx: g.me.tIdx };
  });
  await page.keyboard.press('e');
  await page.waitForTimeout(150);
  const Q3 = await T(() => {
    const g = SKV3._t.G();
    return { do: g.me._doing, doing: g.me.doing, dur: g.me._dur, tIdx: g.me.tIdx };
  });
  ok(Q3.do === 'task' && Q3.dur === 8 && Q3.tIdx === 1,
    '取消夜修限制：同一夜可以继续开工第二个任务（' + Q2.spot.label + '）');
  await T(() => { SKV3._t.G().me.doing = 0.02; });
  await page.waitForTimeout(240);
  const Q4 = await T(() => ({ tIdx: SKV3._t.G().me.tIdx, progress: SKV3._t.G().me.progress,
    prog: SKV3._t.G().prog, pending: SKV3._t.G().me.qualPending }));
  ok(Q4.tIdx === 2 && Q4.progress >= 4 && Q4.pending === 1,
    '第二个任务同样能完成（任务 2/4，个人积分 ' + Q4.progress + '，待领仍为 1）');
  /* 未领取申请单时，不能直接去医疗间拿物资 */
  await T(() => {
    const t = SKV3._t, g = t.G();
    g.fx.length = 0;
    g.me.doing = 0; g.me._doing = null; g.me.path = null;
    g.me.qual = 0; g.me.qualPending = 1; g.me.medkit = 0;
    const sp = t.supplies().find(s => s.item === 'med');
    t.tp(0, sp.x, sp.y);
  });
  await page.waitForTimeout(140);
  await page.keyboard.press('e');
  await page.waitForTimeout(160);
  const DENY = await T(() => ({ do: SKV3._t.G().me._doing, msg: SKV3._t.G().msg }));
  ok(DENY.do !== 'med' && DENY.msg.indexOf('先回中央会议室') >= 0,
    '未领取申请单：直接进医疗间拿物资被拒绝');
  /* 回中央会议室圆桌领取物资申请单 */
  const QD = await T(() => {
    const t = SKV3._t, g = t.G();
    const q = t.qualDesk();
    g.me.path = null; g.me.moving = false; g.me.doing = 0; g.me._doing = null;
    /* 站在圆桌外沿 2.1 格（旧 1.7 判定会拒绝，现在 2.3 内即可） */
    t.tp(0, q.x, q.y + 0.9);
    return { q, room: t.state()[0].room };
  });
  await page.keyboard.press('e');
  await page.waitForTimeout(170);
  const CL = await T(() => { const g = SKV3._t.G(); return { do: g.me._doing, doing: g.me.doing }; });
  ok(QD.room === 'bridge' && CL.do === 'qual' && CL.doing > 2.4,
    '中央会议室圆桌：2.1 格外按 E 也能进入 3 秒领取动作（判定 2.3 格）');
  await T(() => { SKV3._t.G().me.doing = 0.02; });
  await page.waitForTimeout(240);
  const Q5 = await T(() => {
    const g = SKV3._t.G();
    return { qual: g.me.qual, pending: g.me.qualPending,
      ql: document.getElementById('ql').textContent, qp: document.getElementById('qp').textContent,
      qlPop: document.getElementById('ql').classList.contains('pop'),
      fx: SKV3._t.fx(), msg: g.msg };
  });
  ok(Q5.qual === 1 && Q5.pending === 0 && Q5.ql === '1' && Q5.qp === '0',
    '领取成功：申请单 1 / 待领 0，HUD 同步');
  ok(Q5.fx.includes('qual') && Q5.msg.indexOf('领取物资申请单') >= 0 && Q5.qlPop,
    '领取物资申请单：金色徽章特效 + HUD 弹跳 + 播报');
  await freezeFx();
  await shotClip('34_领取申请单动画.png', { x: 440, y: 220, width: 600, height: 460 });
  /* 已领取申请单后才允许在医疗间补给点换医疗包 */
  await T(() => {
    const t = SKV3._t, g = t.G();
    g.fx.length = 0;
    g.me.doing = 0; g.me._doing = null; g.me.path = null;
    const sp = t.supplies().find(s => s.item === 'med');
    t.tp(0, sp.x, sp.y);
  });
  await page.waitForTimeout(120);
  await page.keyboard.press('e');
  await page.waitForTimeout(120);
  const P0 = await T(() => ({ do: SKV3._t.G().me._doing, doing: SKV3._t.G().me.doing }));
  ok(P0.do === 'med' && P0.doing > 4, '已领取申请单：医疗补给点按 E 进入取医疗包动作');
  await T(() => { SKV3._t.G().me.doing = 0.02; });
  await page.waitForTimeout(240);
  const P = await T(() => {
    const g = SKV3._t.G();
    return { med: g.me.medkit, qual: g.me.qual, fx: SKV3._t.fx(),
      act: g.me.act && g.me.act.kind, md: document.getElementById('md').classList.contains('pop'),
      mdText: document.getElementById('md').textContent };
  });
  ok(P.med === 1 && P.qual === 0 && P.mdText === '1', '领取补给：医疗包 +1、物资申请单 -1，HUD 同步');
  ok(P.fx.includes('pickup') && P.act === 'pickup', '领取补给：拾取光柱 + 下蹲拾取动作');
  ok(P.md, 'HUD 医疗包数字弹跳（.pop）');
  await freezeFx();
  await shotClip('35_领取补给动画.png', { x: 440, y: 220, width: 600, height: 460 });

  section('任务乱序维修 · 按实际点位结算');
  await fresh(false);
  const ORD = await T(() => {
    const t = SKV3._t, g = t.G();
    const allP = t.points();
    const pi = allP.findIndex(p => p.label === '餐台清洁');
    const P = allP[pi];
    const rest = allP.map((p, i) => i).filter(i => i !== pi).slice(0, 3);
    g.me.tasks = [pi].concat(rest); g.me.tIdx = 0; g.me.progress = 0;
    g.me.doing = 0; g.me._doing = null; g.me.path = null; g.me._taskPt = null;
    t.tp(0, P.x, P.y);
    const it = t.interact();                  // 只刷出任务项 → 直接开修
    const started = { do: g.me._doing, doing: g.me.doing, pt: g.me._taskPt };
    const fin = t.finishDoing(0);
    return { P: P.label, pi, it, started, fin,
      tIdx: g.me.tIdx, prog: g.prog, progress: g.me.progress,
      left: g.me.tasks.slice(g.me.tIdx).map(i => t.points()[i].label) };
  });
  ok(ORD.started.do === 'task' && ORD.started.pt === ORD.pi,
    '乱序开工：记录实际任务点「' + ORD.P + '」（不是列表首个任务）');
  ok(ORD.fin.msg.indexOf(ORD.P) >= 0 && ORD.fin.msg.indexOf('引擎组同步') < 0,
    '结算播报按实际点位：' + ORD.fin.msg);
  ok(ORD.tIdx === 1 && ORD.prog === 1 && ORD.progress === 1,
    '乱序维修计分正确：普通任务 +1，任务索引 +1');
  ok(ORD.left.length === 3 && ORD.left.indexOf(ORD.P) < 0 && ORD.left.indexOf('引擎组同步') >= 0,
    '任务列表：已修的餐台清洁移除，未修的引擎组同步保留');

  section('AI 节奏 · 慢工 + 夜间可连修');
  await fresh(false);
  const AI0 = await T(() => {
    const t = SKV3._t, g = t.G();
    const h = g.agents.find(a => !a.alien && a !== g.me && a.alive);
    h._delay = 0; h._rest = 0; h.tIdx = 0;
    h._doing = null; h.doing = 0; h.path = null;
    const spot = t.taskSpot(h.i);
    t.tp(h.i, spot.x, spot.y);
    const first = t.aiTick(h.i, 1, 0.05);
    return { i: h.i, spot, first };
  });
  ok(AI0.first.do === 'task' && Math.abs(AI0.first.doing - AI0.spot.dur) < 0.05,
    'AI 开工耗时 = 任务时长（' + AI0.spot.dur + 's → ' + AI0.spot.dur.toFixed(1) + 's，无额外倍率）');
  const AI1 = await T(i => SKV3._t.aiTick(i, 180, 0.05), AI0.i);
  ok(AI1.doing > 0 && AI1.tIdx === 0, 'AI 开工 9s 仍在同一任务（不再瞬间刷完）');
  const AI2 = await T(i => {
    const a = SKV3._t.G().agents[i];
    const steps = Math.ceil(((a.doing || 1) + 1.2) / 0.05);
    return SKV3._t.aiTick(i, steps, 0.05);
  }, AI0.i);
  ok(AI2.tIdx === 1 && AI2.rest === 0,
    'AI 完成第一个任务后不再休息（rest=' + (AI2.rest || 0).toFixed(1) + 's）');
  const AI3 = await T(i => {
    const t = SKV3._t, g = t.G();
    const a = g.agents[i];
    a._rest = 0; a.path = null;
    a.doing = 0; a._doing = null; a._taskPt = null;
    a._fixGo = null; a._lightGo = false; a._fleeT = 0;
    const spot = t.taskSpot(i);
    t.tp(i, spot.x, spot.y);
    const next = t.aiTick(i, 1, 0.05);
    return { spot, next };
  }, AI0.i);
  ok(AI3.next.do === 'task' && AI3.next.tIdx === 1 && Math.abs(AI3.next.doing - AI3.spot.dur) < 0.05,
    '完成后能立即接下一个任务（不再限一夜一个）');
  ok((await T(() => SKV3._t.G().prog)) >= 1, 'AI 维修计入全局维修进度');
  const DLY = await T(() => {
    const t = SKV3._t; t.newGame();
    return t.G().agents.filter(a => !a.alien).map(a => a._delay);
  });
  ok(DLY.length === 11 && DLY.every(d => d >= 2 && d <= 8),
    'AI 人类开局延迟压缩到 2–8 秒');

  section('会议发言 · 上下文连贯');
  await fresh(false);
  const MS = await T(() => {
    const t = SKV3._t, g = t.G();
    const aliens = g.agents.filter(a => a.alien && a.alive);
    const humans = g.agents.filter(a => !a.alien && a.alive && a !== g.me);
    const k = aliens[0], v = humans[0], w1 = humans[1], w2 = humans[2];
    t.tp(k.i, 56, 85); t.tp(v.i, 57.2, 85); t.tp(w1.i, 55, 85); t.tp(w2.i, 56, 87);
    t.tp(0, 58.5,85.2);
    k.knife = 1;
    t.knife(k.i, v.i);
    const sawNear = g.agents[w1.i].suspect === k.i || g.agents[w2.i].suspect === k.i;
    /* 其余 3 个异形倒地，保证发言席里至少有 2 名人类；所有人类都目击到这一刀 */
    for (const a of aliens) if (a !== k) { a.downed = true; a.downAt = g.t; a.path = null; }
    for (const h of humans) h.suspect = k.i;
    t.kill(v.i, 'knife');
    /* 造出每个 AI 昨晚真实去过的房间/修过的任务，供口供核对 */
    const facts = [
      ['engine', '引擎组同步'], ['ecosys', '水培阀'], ['power', '电路维修'], ['transit', '升降台'],
      ['fun', '娱乐桌'], ['cam', '监控墙重连'], ['armory', '靶道校准'],
      ['engine', '压力表校准'], ['ecosys', '培养罐补液'], ['power', '变压器换芯'],
      ['fun', '点唱机'], ['cam', '录像归档'], ['armory', '弹药清点']
    ];
    let fi = 0;
    for (const a of g.agents) {
      if (a === g.me || !a.alive) continue;
      const f = facts[fi++ % facts.length];
      a.nRoom = f[0]; a.nTask = f[1]; a.nSeen = a.nSeen || {};
    }
    const ais = g.agents.filter(a => a !== g.me && a.alive && !a.downed);
    for (let i = 0; i < 4; i++) {
      const a = ais[i % ais.length], b = ais[(i + 3) % ais.length];
      if (a && b && a !== b) a.nSeen[b.i] = 4;
    }
    t.openMeeting('night', w1.i, v.i);
    return { k: k.i, v: v.i, w1: w1.i, w2: w2.i, vicName: v.name, vicRoom: '医疗间',
      sawNear, label: document.getElementById('m-vic-l').textContent,
      hudRoom: document.getElementById('m-room').textContent };
  });
  ok(MS.sawNear, '行凶当时附近的人类 → suspect 指向凶手');
  ok(MS.label === '死者' && MS.hudRoom === '医疗间', '会议 HUD：死者 / 医疗间');
  await page.waitForTimeout(14500);
  const ML = await T(() => {
    const t = SKV3._t, g = t.G();
    const lines = t.meetLines().filter(l => !l.sys);
    const claims = t.meetCtx().claims;
    const declared = {}, tasks = {};
    for (const a of g.agents) {
      declared[a.name] = a._lie ? a._lie.room : (a.nRoom ? t.roomName(a.nRoom) : null);
      tasks[a.name] = a._lie ? a._lie.task : a.nTask;
    }
    return { lines, claims, declared, tasks, vic: t.meetCtx().victim };
  });
  const alibis = ML.lines.filter(l => l.text.indexOf('我今晚在') === 0);
  ok(ML.lines.length >= 8, '夜间会议生成 ' + ML.lines.length + ' 条发言');
  ok(ML.vic && ML.vic.dead && ML.vic.room === '医疗间' && ML.vic.cause === '刀伤',
    '会议上下文记录死者、房间、死因');
  const opening = ML.lines[0];
  ok(opening && opening.text.indexOf(MS.vicName) >= 0 && opening.text.indexOf(MS.vicRoom) >= 0 && opening.text.indexOf('刀伤') >= 0,
    '开场白包含死者 + 房间 + 死因');
  ok(alibis.length >= 3, '至少 3 名 AI 给出完整不在场说明');
  const claimsOk = ML.claims.length > 0 && ML.claims.every(c =>
    alibis.some(l => l.who === c.who && l.text.indexOf('我今晚在' + c.room) === 0));
  ok(claimsOk, '每个 AI 的发言房间与其登记口供一致（' + ML.claims.length + ' 条）');
  const taskOk = alibis.every(l => {
    const m = l.text.match(/把(.+?)搞定/);
    return !m || !ML.tasks[l.who] || m[1] === ML.tasks[l.who];
  });
  ok(taskOk, '发言里提到的维修任务与真实任务一致');
  ok(ML.lines.filter(l => /你说你在|我可以给|你那边还有谁/.test(l.text)).length >= 1,
    '出现引用上一条发言的质疑 / 作证 / 追问');
  const ci = ML.lines.findIndex(l => /你说你在|我可以给|你那边还有谁/.test(l.text));
  const chal = ci >= 0 ? ML.lines[ci] : null;
  const rep = ci >= 0 ? ML.lines[ci + 1] : null;
  const rooms = await T(() => SKV3._t.roomNames());
  /* 回应可能走「作证 / 异形搪塞 / 报出自己位置」三种分支：只在它报位置时校验一致性 */
  const loc = rep ? rep.text.match(/(?:我|我们)[^，。]{0,6}在([^，。；]{1,10})/) : null;
  const claimed = loc ? rooms.find(n => loc[1].indexOf(n) >= 0) : null;
  ok(chal && rep && rep.who !== chal.who && (!claimed || claimed === ML.declared[rep.who]),
    '被质疑者做出回应，且报出的位置与口供一致' +
    (!rep || !chal ? ' :: 没有找到质疑/回应行' :
      (claimed && claimed !== ML.declared[rep.who] ? ' :: ' + JSON.stringify({ who: rep.who, text: rep.text,
        declared: ML.declared[rep.who], claimed }) : '')));
  ok(ML.lines.filter(l => /我投|我倾向|我跟/.test(l.text)).length >= 2, '至少两条明确指控');
  ok(ML.lines.some(l => l.text.indexOf('亲眼看见') >= 0 || l.text.indexOf('动了手') >= 0),
    '目击者说出亲眼所见，而不是随机台词');
  const n0 = await T(() => SKV3._t.chat('你在哪？'));
  await page.waitForFunction(n => SKV3._t.meetLines().length > n, n0, { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(300);
  const PC = await T(n0 => {
    const t = SKV3._t, g = t.G();
    const lines = t.meetLines();
    const fresh = lines.slice(n0);
    for (const l of fresh) {
      const a = g.agents.find(x => x.name === l.who);
      const declared = a ? (a._lie ? a._lie.room : (a.nRoom ? t.roomName(a.nRoom) : null)) : null;
      if (declared && l.text.indexOf(declared) >= 0) return { n: lines.length, who: l.who, text: l.text, declared };
    }
    const last = fresh.length ? fresh[fresh.length - 1] : lines[lines.length - 1];
    const a = g.agents.find(x => x.name === last.who);
    return { n: lines.length, who: last.who, text: last.text,
      declared: a ? (a._lie ? a._lie.room : (a.nRoom ? t.roomName(a.nRoom) : null)) : null };
  }, n0);
  ok(PC.n > n0, '玩家发言得到 AI 回应');
  ok(PC.declared && PC.text.indexOf(PC.declared) >= 0, '回应中的位置与它先前的口供一致（' + PC.declared + '）');
  await shot('36_会议连贯发言.png');
  const VT = await T(() => {
    const t = SKV3._t, g = t.G();
    t.startVote();
    const m = g.meet;
    const humans = g.agents.filter(a => !a.alien && a.alive && !a.downed && a !== g.me);
    return { votes: m.votes, humans: humans.map(a => ({ i: a.i, name: a.name, target: a.accuse })),
      k: g.agents.find(a => a.alien && a.alive && !a.downed).i };
  });
  const withAcc = VT.humans.filter(h => h.target != null);
  ok(withAcc.length >= 8 && withAcc.every(h => VT.votes[h.i] === h.target && h.target === VT.k),
    withAcc.length + ' 名目击者把票投给了自己指认的凶手');
  await T(() => SKV3._t.finishMeeting());
  await page.waitForTimeout(200);
  const DMI = await T(() => SKV3._t.inv());
  ok(DMI && DMI.fails.length === 0, '会议结束后不变量全过');

  section('AI 确证 · 管道 / 红身 / 误判边界');
  await fresh(false);
  const CERT1 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const demote = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    demote.alien = false; g.me.alien = true;
    const w = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const pipe = t.pipes().find(p => p.room === 'warehouse');
    t.tp(w.i, pipe.x - 1.7, pipe.y);
    t.tp(0, pipe.x, pipe.y);
    const before = t.knownOf(w.i);
    t.openPipe();
    t.pickPipe(t.pipes().find(p => p.room === 'cam').i);
    const after = t.knownOf(w.i);
    t.openMeeting('night', w.i, null);
    const acc = g.agents[w.i].accuse;
    const why = g.agents[w.i].accuseWhy;
    const line = t.accuseLineOf(w.i);
    t.startVote();
    const vote = g.meet.votes[w.i];
    t.finishMeeting();
    return { w: w.i, before, after, acc, why, line, vote, inv: t.inv() };
  });
  ok(!CERT1.before || !CERT1.before[0], '钻管道之前：证人没有"他是异形"的结论');
  ok(CERT1.after && CERT1.after[0] && CERT1.after[0].kind === 'saw_pipe',
    '亲眼看见钻管道 → 直接确证该人是异形（不是加一点嫌疑分）');
  ok(CERT1.acc === 0 && CERT1.vote === 0, '确证之后：会议指控与投票都锁定这个席位');
  ok(/管道/.test(CERT1.line) && /(确定|确证|异形)/.test(CERT1.line),
    '确证台词点破具体行为与地点：' + CERT1.line);
  ok(CERT1.inv.fails.length === 0, '确证链路不变量全过');

  const CERT2 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const w = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    t.tp(k.i, 56, 85); t.tp(w.i, 57.2, 85);
    k.redT = 3;                       /* 模拟刚出刀后的 3 秒红身 */
    t.track();
    const know = t.knownOf(w.i);
    const sus = (t.mind(w.i).sus || {})[k.i] || 0;
    return { k: k.i, w: w.i, know, sus };
  });
  ok(CERT2.know[CERT2.k] && CERT2.know[CERT2.k].kind === 'saw_red',
    '看见「刀者红身」同样确证：带红光的人就是刚出刀的异形');
  ok(CERT2.sus >= 0.99, '红身目击把嫌疑分直接拉满（' + CERT2.sus + '），不再慢慢累计');

  const CERT3 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const w = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    t.tp(k.i, 56, 85); t.tp(w.i, 57.2, 85);
    t.notice(k.i, 56, 85, 6, 'shot', null);   /* 开枪人类也会做 */
    return { know: t.knownOf(w.i), sus: (t.mind(w.i).sus || {})[k.i] || 0, k: k.i };
  });
  ok(Object.keys(CERT3.know).length === 0 && CERT3.sus > 0.3,
    '开枪 / 拖尸这类人类也会做的事：只记嫌疑（' + CERT3.sus + '），不确证身份');

  const CERT4 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const w = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    t.tp(k.i, 56, 85); t.tp(w.i, 57.2, 85);
    t.notice(k.i, 56, 85, 6, 'sabotage', null);
    const k1 = t.knownOf(w.i);
    t.newNight();                        /* 进入下一夜：普通认知清空 */
    const k2 = t.knownOf(w.i);
    const mem = t.mind(w.i).mem.length;
    const sus = Object.keys(t.mind(w.i).sus).length;
    t.openMeeting('day');
    const acc = g.agents[w.i].accuse;
    t.startVote();
    const vote = g.meet.votes[w.i];
    t.finishMeeting();
    return { k: k.i, w: w.i, k1, k2, mem, sus, acc, vote, inv: t.inv() };
  });
  ok(CERT4.k1[CERT4.k] && CERT4.k2[CERT4.k] && CERT4.k2[CERT4.k].kind === 'saw_sabotage',
    '确证是长期记忆：第二天仍然记得「他是异形」');
  ok(CERT4.mem === 0 && CERT4.sus === 0, '普通记忆与嫌疑分仍按夜清空（只有确证跨夜）');
  ok(CERT4.acc === CERT4.k && CERT4.vote === CERT4.k,
    '下一夜的会议指控与投票继续锁定这个人');

  section('会议 · 异形反咬与构陷');
  await fresh(false);
  const FRAME = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const w = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const l1 = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== w);
    const l2 = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== w && a !== l1);
    for (const a of g.agents) if (a !== k && a !== w && a !== l1 && a !== l2) t.tp(a.i, 30,54);
    t.tp(l1.i, 27,56); t.tp(l2.i, 29,56);
    t.tp(k.i, 56, 85); t.tp(w.i, 57.2, 85);
    k.redT = 3; t.track();                 /* w 亲眼看见红光，拿到确证 */
    for (const a of g.agents) {
      if (a === w || !a.mind) continue;
      a.mind.known = {}; a.mind.mem = []; a.mind.sus = {}; a.mind.why = {};
      a.mind.alert = 0; a.suspect = null; a.accuse = null; a.accuseWhy = null;
    }
    /* l2 的时间线记忆：今晚在引擎舱见过异形 → 能拆穿它的假口供 */
    l2.mind.mem.push({kind: 'saw_agent', subj: k.i, room: 'engine', night: g.night,
      t: 0, conf: 0.8, src: 'sight'});
    const oldRandom = Math.random;
    /* l1/l2 固定成谨慎型：本组测「没证据 → 弃权」这条纪律。
       2026-10-31 起投票弃权率随性格（voteAbstain），不锁性格的话
       激进的旁观 AI 会跟着多数指控走，断言就不稳定了。 */
    for (const a of [l1, l2]) a.trait = { aggr: 28, caut: 72, soc: 50, cur: 50 };
    Math.random = () => 0;                 /* 必反咬、必构陷证人 */
    t.openMeeting('night', w.i, null);
    Math.random = oldRandom;
    const ctx = t.meetCtx();
    const f = ctx.frames[0];
    t.startVote();
    const out = { k: k.i, w: w.i, l1: l1.i, l2: l2.i, frame: f,
      liarName: f ? g.agents[f.by].name : null,
      targetName: f ? g.agents[f.target].name : null,
      knownW: t.knownOf(w.i), knownL1: t.knownOf(l1.i), knownL2: t.knownOf(l2.i),
      susL1: (t.mind(l1.i).sus || {})[w.i] || 0,
      susL2: (t.mind(l2.i).sus || {})[k.i] || 0,
      votes: { witness: g.meet.votes[w.i], liar: g.meet.votes[k.i],
        l1: g.meet.votes[l1.i], l2: g.meet.votes[l2.i] } };
    t.finishMeeting();
    return out;
  });
  ok(FRAME.frame && FRAME.frame.kind === 'saw_red' && FRAME.frame.by === FRAME.k &&
    FRAME.frame.target === FRAME.w && /红光/.test(FRAME.frame.text) &&
    FRAME.frame.text.indexOf(FRAME.frame.ownRoom) >= 0,
    '被确证的异形会先反驳，再反咬证人"带红光"，并带上自己的假口供');
  ok(FRAME.frame && FRAME.frame.reaffirm && /亲眼/.test(FRAME.frame.reaffirm) &&
    FRAME.frame.reaffirm.indexOf(FRAME.liarName) >= 0,
    '真目击者当场顶回去：不认可反咬，重申自己看见的是谁');
  ok(FRAME.knownW[FRAME.k] && FRAME.knownW[FRAME.k].kind === 'saw_red' &&
    FRAME.votes.witness === FRAME.k && FRAME.votes.liar === FRAME.w,
    '确证与投票都不受构陷影响：证人仍投真凶，异形反投证人');
  /* 2026-10-31 起没证据不再必弃权：投票改由性格决定（voteAbstain），
     激进的 AI 会跟着场上最多的指控投 —— 这里允许「弃权」或「跟票指控真凶」两种结果，
     但绝不允许它去投证人（那是被构陷带偏）。 */
  ok(Object.keys(FRAME.knownL1).length === 0 && FRAME.susL1 > 0.1 && FRAME.susL1 < 0.5 &&
    (FRAME.votes.l1 === -1 || FRAME.votes.l1 === FRAME.k),
    '构陷只制造少量传闻嫌疑（' + FRAME.susL1.toFixed(2) + '），不写 known；' +
    '没证据时按性格弃权或跟票（实测 l1→' + FRAME.votes.l1 +
    '，真凶=' + FRAME.k + '，证人=' + FRAME.w + '）');
  ok(FRAME.frame && FRAME.frame.caught && FRAME.frame.caught.i === FRAME.l2 &&
    FRAME.susL2 >= 0.2 && Object.keys(FRAME.knownL2).length === 0,
    '时间线记忆能拆谎：' + (FRAME.frame && FRAME.frame.caught ? FRAME.frame.caught.text : '—'));

  await fresh(false);
  const PIPE_LIE = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const pipes = t.pipes();
    const p = pipes.find(x => x.room === 'engine') || pipes[0];
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const w = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k && a !== w) t.tp(a.i, 30,54);
    t.tp(k.i, p.x, p.y); t.tp(w.i, p.x + 1.2, p.y);
    w.nRoom = 'med';                        /* 证人的自述位置不在管道房 */
    t.notice(k.i, p.x, p.y, 6, 'pipe');     /* w 亲眼看见钻管道 → known */
    const oldRandom = Math.random;
    Math.random = () => 0;                  /* 必反咬、必说管道 */
    t.openMeeting('night', w.i, null);
    Math.random = oldRandom;
    const f = t.meetCtx().frames[0] || null;
    const out = { room: f ? f.room : null, text: f ? f.text : '',
      kind: f ? f.kind : null, pipeNames: [...new Set(pipes.map(x => x.name))],
      knownName: t.roomName(p.room), reaffirm: f ? f.reaffirm : '' };
    t.finishMeeting();
    return out;
  });
  ok(PIPE_LIE.kind === 'saw_pipe' && PIPE_LIE.pipeNames.indexOf(PIPE_LIE.room) >= 0 &&
    PIPE_LIE.text.indexOf(PIPE_LIE.room) >= 0,
    '异形构陷“钻管道”只落在真正有管道口的舱室：' + PIPE_LIE.room + ' / ' + PIPE_LIE.text);
  ok(PIPE_LIE.reaffirm.indexOf(PIPE_LIE.knownName) >= 0 &&
    PIPE_LIE.reaffirm.indexOf('医疗间') < 0,
    '真目击者的反驳也引用真实管道现场，而不是自己的自述房间');

  await fresh(false);
  const PRO = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    for (const a of g.agents) if (a.mind) {
      a.mind.known = {}; a.mind.mem = []; a.mind.sus = {}; a.mind.why = {}; a.mind.alert = 0;
    }
    const oldRandom = Math.random;
    Math.random = () => 0;
    t.openMeeting('day', null, null);
    Math.random = oldRandom;
    const f = t.meetCtx().frames[0];
    const out = { n: t.meetCtx().frames.length, f: f || null,
      byAlien: f ? g.agents[f.by].alien : null,
      targetAlive: f ? (g.agents[f.target].alive && !g.agents[f.target].downed) : false,
      hasResponse: !!(f && f.response), hasReaffirm: !!(f && f.reaffirm) };
    t.startVote(); t.finishMeeting();
    return out;
  });
  ok(PRO.n === 1 && PRO.f && PRO.byAlien === true && PRO.targetAlive &&
    PRO.hasResponse && !PRO.hasReaffirm,
    '没有被确证时异形也会偶尔主动构陷：点名一个活人，被点名者当场反问');

  section('玩家发言 · 槽位解析与时间线对质');
  await fresh(false);
  const SLOT = await T(() => {
    const t = SKV3._t;
    const p1 = t.parseSpeech('我怀疑 03 北极，我当时在配电室');
    const p2 = t.parseSpeech('我投 05，我在医疗间修东西');
    const p3 = t.parseSpeech('不是我，我整晚都在引擎');
    return { p1, p2, p3 };
  });
  ok(SLOT.p1.people.indexOf(2) >= 0 && SLOT.p1.accuse === 2 && SLOT.p1.where === 'power',
    '槽位：认出「03 北极」+ 指控意图 + 自述舱室（配电室）');
  ok(SLOT.p2.vote === 4 && SLOT.p2.where === 'med', '槽位：认出投票对象（05）与自述位置（医疗间）');
  ok(SLOT.p3.deny === true && SLOT.p3.where === 'engine', '槽位：认出否认语气与不在场声明（引擎）');

  const SLOT2 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    g.me.x = 8; g.me.y = 52; h.x = 9; h.y = 52; h.nRoom = 'engine';
    h.mind.mem = [];
    t.track();                        /* h 记住：玩家在引擎舱 */
    t.tp(0, 55,84);                  /* 玩家随后跑到医疗间 */
    for (const a of g.agents) if (a !== g.me) a._delay = 999;
    t.openMeeting('day');
    const s0 = (t.mind(h.i).sus || {})[0] || 0;
    t.chat('我一直在医疗间');
    return { h: h.i, s0 };
  });
  await page.waitForTimeout(1250);
  const SLOT3 = await T(o => {
    const t = SKV3._t;
    const lines = t.meetLines().map(l => l.text);
    const claim = lines.find(x => x.indexOf(t.G().me.name) >= 0 && x.indexOf('医疗间') >= 0 &&
      /(看见|碰见|不在|明明)/.test(x)) || '';
    return { s1: (t.mind(o.h).sus || {})[0] || 0, claim, says: t.meetCtx().playerSays };
  }, SLOT2);
  ok(SLOT3.s1 > SLOT2.s0 + 0.2,
    '玩家谎报位置：目击过他的 AI 当场拆穿并把玩家嫌疑分从 ' + SLOT2.s0.toFixed(2) + ' 调到 ' + SLOT3.s1.toFixed(2));
  ok(/医疗间/.test(SLOT3.claim) && /引擎/.test(SLOT3.claim),
    '拆穿台词同时引用「玩家声称的舱室」与「真实目击地点」：' + SLOT3.claim);
  ok(SLOT3.says.length === 1 && SLOT3.says[0].where === 'med',
    '发言槽位进入会议上下文（where=med，可供后续追问与投票引用）');

  section('会议模板 · 一键发言与扩展词库');
  await fresh(false);
  const TPL = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G();
    const target = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const txt = {};
    for (const k of ['accuse', 'vote', 'support', 'pipe', 'red', 'knife', 'where', 'deny'])
      txt[k] = t.tplText(k, target.i, k === 'pipe' ? 'engine' : 'med');
    const P = {};
    for (const k in txt) P[k] = t.parseSpeech(txt[k]);
    const pipeBad = t.tplText('pipe', target.i, 'power');
    const pipeBadP = t.parseSpeech(pipeBad);
    const free = {
      neg: t.parseSpeech('北极不是异形'),
      seat: t.parseSpeech('我投3号'),
      claimRoom: t.parseSpeech('我看见北极在引擎室钻管道')
    };
    return { target: target.i, txt, P, free, pipeBad, pipeBadP };
  });
  ok(TPL.P.accuse.accuse === TPL.target && TPL.P.vote.vote === TPL.target,
    '模板「怀疑 / 投他」可被解析为对应玩家');
  ok(TPL.P.support.support === TPL.target, '模板「作证」可被解析为支持对象');
  ok(TPL.P.pipe.claim && TPL.P.pipe.claim.kind === 'saw_pipe' &&
    TPL.P.pipe.claim.target === TPL.target && TPL.P.pipe.claim.room === 'engine',
    '模板「看见钻管道」生成可解析的直接证据，并带上真正有管道口的舱室');
  ok(TPL.pipeBad.indexOf('配电室') < 0 && TPL.pipeBadP.claim &&
    TPL.pipeBadP.claim.kind === 'saw_pipe' && TPL.pipeBadP.claim.room == null,
    '没有管道口的舱室不会生成“在配电室钻管道”：模板自动省略地点');
  ok(TPL.P.red.claim && TPL.P.red.claim.kind === 'saw_red' &&
    TPL.P.knife.claim && TPL.P.knife.claim.kind === 'saw_knife',
    '模板「看见红光 / 出刀」可被解析');
  ok(TPL.P.where.where === 'med' && TPL.P.deny.deny === true && TPL.P.deny.where === 'med',
    '模板「我在… / 不是我」带上舱室，可被当作自述位置');
  ok(TPL.free.neg.accuse == null && TPL.free.neg.support === 2,
    '否定词：北极不是异形 → 不指控，而是支持');
  ok(TPL.free.seat.vote === 2, '席位格式：3号 → 03 北极');
  ok(TPL.free.claimRoom.claim && TPL.free.claimRoom.claim.kind === 'saw_pipe' &&
    TPL.free.claimRoom.claim.room === 'engine' && TPL.free.claimRoom.where == null,
    '「我看见X在引擎室钻管道」：证据房间与玩家自述位置分开，不再误判玩家在引擎室');

  await fresh(false);
  const TPL2 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const target = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const listener = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== target);
    for (const a of g.agents) if (a !== target && a !== listener) t.tp(a.i, 30,54);
    t.tp(target.i, 56, 85); t.tp(listener.i, 57, 85);
    for (const a of g.agents) if (a.mind) {
      a.mind.known = {}; a.mind.mem = []; a.mind.sus = {}; a.mind.why = {}; a.mind.alert = 0;
      a.suspect = null; a.accuse = null;
    }
    t.openMeeting('pre', null, null);
    const visible = !document.getElementById('m-tpl').classList.contains('hide');
    const nBtn = document.querySelectorAll('#m-tpl-btns button').length;
    document.getElementById('m-tpl-target').value = String(target.i);
    [...document.querySelectorAll('#m-tpl-btns button')]
      .find(b => b.dataset.tpl === 'pipe').click();
    const ctx = t.meetCtx();
    const claim = (ctx.playerClaims || [])[0];
    const sus = (t.mind(listener.i).sus || {})[target.i] || 0;
    const line = t.meetLines().slice(-1)[0];
    const known = t.knownOf(listener.i);
    t.finishMeeting();
    return { visible, nBtn, claim, sus, known,
      text: line ? line.text : '', target: target.i, listener: listener.i };
  });
  ok(TPL2.visible && TPL2.nBtn === 8, '人类会议显示模板栏与 8 个默认发言');
  ok(TPL2.claim && TPL2.claim.target === TPL2.target && TPL2.claim.kind === 'saw_pipe' &&
    /钻管道/.test(TPL2.text), '点击「看见钻管道」会以玩家身份发出并解析成直接证据');
  ok(TPL2.sus >= 0.2 && Object.keys(TPL2.known).length === 0,
    'AI 只把玩家的话记成传闻嫌疑（' + TPL2.sus.toFixed(2) + '），绝不写成 known');

  await fresh(false);
  const TPL3 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const target = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const listener = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== target);
    for (const a of g.agents) if (a !== target && a !== listener) t.tp(a.i, 30,54);
    t.tp(target.i, 56, 85); t.tp(listener.i, 57, 85);
    for (const a of g.agents) if (a.mind) {
      a.mind.known = {}; a.mind.mem = []; a.mind.sus = {}; a.mind.why = {}; a.mind.alert = 0;
      a.suspect = null; a.accuse = null;
    }
    listener.mind.mem.push({kind: 'saw_agent', subj: target.i, room: 'engine',
      night: g.night, t: 0, conf: 0.8, src: 'sight'});
    t.openMeeting('pre', null, null);
    document.getElementById('m-text').value =
      '我看见 ' + g.agents[target.i].name + ' 在军械库钻管道';
    document.getElementById('m-send').click();
    const s0 = (t.mind(listener.i).sus || {})[0] || 0;
    const st = (t.mind(listener.i).sus || {})[target.i] || 0;
    const line = t.meetLines().slice(-1)[0];
    t.finishMeeting();
    return { s0, st, text: line ? line.text : '', target: target.i, listener: listener.i };
  });
  ok(TPL3.s0 >= 0.2 && TPL3.st < 0.1,
    '玩家构陷与听众时间线冲突：反过来怀疑玩家（' + TPL3.s0.toFixed(2) +
    '），不把构陷当成目标证据（目标仅 ' + TPL3.st.toFixed(2) + '，来自空口指控）');

  await fresh(false);
  const IMPOSSIBLE = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const target = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const listener = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== target);
    for (const a of g.agents) if (a !== target && a !== listener) t.tp(a.i, 30,54);
    t.tp(target.i, 56, 85); t.tp(listener.i, 57, 85);
    for (const a of g.agents) if (a.mind) {
      a.mind.known = {}; a.mind.mem = []; a.mind.sus = {}; a.mind.why = {}; a.mind.alert = 0;
      a.suspect = null; a.accuse = null;
    }
    t.openMeeting('pre', null, null);
    document.getElementById('m-text').value =
      '我看见 ' + g.agents[target.i].name + ' 在配电室钻管道';
    document.getElementById('m-send').click();
    const s0 = (t.mind(listener.i).sus || {})[0] || 0;
    const st = (t.mind(listener.i).sus || {})[target.i] || 0;
    const claims = (t.meetCtx().playerClaims || []).length;
    t.finishMeeting();
    return { s0, st, claims };
  });
  ok(IMPOSSIBLE.s0 >= 0.15 && IMPOSSIBLE.st < 0.06 && IMPOSSIBLE.claims === 0,
    '“在配电室钻管道”是物理上不可能的口供：AI 反过来怀疑发言者（' +
    IMPOSSIBLE.s0.toFixed(2) + '），不记成目标的证据');

  section('开局讨论 · 时间覆盖');
  const PACE = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true;
    t.openMeeting('pre');
    return { plan: t.chatterPlan() };
  });
  ok(PACE.plan && PACE.plan.n >= 10,
    '开局公开讨论排了 ' + (PACE.plan ? PACE.plan.n : 0) + ' 条发言（原来只有 5 条、7 秒就说完）');
  ok(PACE.plan && PACE.plan.endAt >= 55000, '讨论窗口保持 60 秒（结束前 2.2 秒才收尾）');
  ok(PACE.plan && PACE.plan.lastScheduled >= PACE.plan.endAt - 2500,
    '最后一条讨论/提示贴着结束时间，不再出现「前 7 秒热闹、后面 50 秒死寂」');
  ok(PACE.plan && PACE.plan.nudges.length >= 2,
    '内容讲完后用自由讨论提示补空档（' + (PACE.plan ? PACE.plan.nudges.length : 0) + ' 次）');

  section('任务清单 · 1 高难 + 3 普通');
  await fresh(false);
  const TP = await T(() => {
    const t = SKV3._t, g = t.G();
    const plan = t.taskPlan();
    const rows = [...document.querySelectorAll('#tasks .tr')].map(e => ({ cls: e.className, text: e.textContent }));
    const expected = g.me.tasks.map((ti, n) => {
      const p = plan[g.me.i][n];
      return { kind: p.kind, room: t.roomName(p.room), label: p.label };
    });
    return { plan, rows, expected, tags: t.tags() };
  });
  ok(TP.plan.length === 15 && TP.plan.every(p => p.length === 4), '15 席每席 4 个任务');
  ok(TP.plan.every(p => p.filter(x => x.kind === 'hard').length === 1 &&
    p.filter(x => x.kind === 'normal').length === 3), '每席都是 1 个高难 + 3 个普通');
  ok(TP.plan.every(p => new Set(p.map(x => x.kind + '|' + x.label)).size === 4), '同一席不重复派任务');
  ok(TP.rows.length === 4 && TP.rows.filter(r => r.cls.indexOf('hard') >= 0).length === 1 &&
    TP.rows.filter(r => r.cls.indexOf('normal') >= 0).length === 3, 'HUD 任务清单渲染 4 条：1 高难 3 普通');
  ok(TP.rows.every((r, i) => r.text.indexOf(TP.expected[i].room) >= 0 &&
    r.text.indexOf(TP.expected[i].label) >= 0), '清单逐条标注目标舱室与任务名');
  ok(TP.tags.length === 15 && TP.tags.every((s, i) =>
    s.indexOf(String(i + 1).padStart(2, '0') + ' ') === 0), '15 人标签均为「编号 + 名字」，编号在前');
  const MT = await T(() => {
    const t = SKV3._t, g = t.G();
    const v = g.agents.find(a => a.i !== 0 && !a.alien && a.alive);
    t.tp(v.i, 28.4,44);
    t.kill(v.i, 'knife');
    const rep = g.agents.find(a => a.i !== 0 && a.alive && a !== v);
    t.openMeeting('night', rep, v);
    t.startVote();
    const btns = [...document.querySelectorAll('#m-who button')].map(b => b.textContent);
    t.finishMeeting();
    return btns;
  });
  const named = MT.filter(s => s !== '弃权');
  ok(named.length >= 10 && named.every(s => /^\d{2} \S+/.test(s)) && MT.includes('弃权'),
    '自由发言/投票名单同样显示编号+名字');

  section('任务完成提示 · 只提示本人');
  const FN = await T(() => {
    const t = SKV3._t, g = t.G();
    const ai = g.agents.find(a => a.i !== 0 && !a.alien && a.alive);
    ai.tasks = [0, 1, 2, 3]; ai.tIdx = 0; ai._doing = 'task'; ai.doing = 1;
    g.msg = ''; g.msgT = 0;
    const aiBefore = g.prog;
    const aiR = t.finishDoing(ai.i);
    const aiMsg = g.msg;
    const me = g.me;
    me.tasks = [16, 17, 18, 19]; me.tIdx = 0; me._doing = 'task'; me.doing = 1;
    const meR = t.finishDoing(0);
    return { aiMsg, aiTIdx: aiR.tIdx, aiProg: aiR.prog - aiBefore, meMsg: g.msg, meTIdx: meR.tIdx };
  });
  ok(FN.aiTIdx === 1 && FN.aiProg > 0, 'AI 完成任务计入全局进度');
  ok(FN.aiMsg === '' || FN.aiMsg.indexOf('完成') < 0, 'AI 完成任务不弹完成提示');
  ok(FN.meTIdx === 1 && FN.meMsg.indexOf('完成') >= 0, '玩家完成任务才提示「完成」');

  section('走廊灯 · 配电室拉闸');
  await fresh(false);
  const L0 = await T(() => ({ l: SKV3._t.lights(), lamps: SKV3._t.lamps() }));
  ok(L0.lamps.length === 11 && L0.lamps.every(n => n === 2), '11 条走廊各 2 盏灯');
  ok(L0.l.state === 0 && L0.l.corr === true && L0.l.lit.bridge && !L0.l.lit.engine && !L0.l.lit.power,
    '常态：走廊灯亮，引擎/配电暗');
  const L1 = await T(() => {
    const t = SKV3._t;
    const r = t.breaker();
    return { r, l: t.lights(), nOn: Object.keys(t.lights().lit).filter(k => t.lights().lit[k]).length };
  });
  ok(L1.r.state === 2 && L1.r.corr === false && L1.l.corr === false && L1.nOn === 1 && L1.l.lit.bridge,
    '拉闸：走廊灯全熄，只有会议室保持照明');
  await T(() => { SKV3._t.tp(0, 30.4,67); });
  await page.keyboard.press('c');
  await page.waitForTimeout(350);
  await shot('37_拉闸全船变暗.png');
  await page.keyboard.press('c');
  await T(() => SKV3._t.breaker());
  await page.waitForTimeout(150);

  section('寻路 · 硬掩体阻挡 / 绕行 / 围墙兜底');
  await fresh(false);
  const PF = await T(() => {
    const t = SKV3._t;
    const plen = p => p ? p.reduce((s, q, i) => i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0, 0) : 0;
    const ratio = (a, b) => {
      const p = t.astar(a[0], a[1], b[0], b[1]);
      return p ? { n: p.length, len: plen(p), ratio: plen(p) / Math.hypot(b[0] - a[0], b[1] - a[1]) } : null;
    };
    const rMed = ratio([34.8, 33.8], [56.5, 83]);
    const rArm = ratio([34.8, 33.8], [83.5, 70]);
    const rTable = ratio([39, 37.5], [39, 27.5]);
    const outside = t.astar(34.8, 33.8, 0.5, 0.5);
    const outsideMap = t.astar(34.8, 33.8, -20, -20);
    t.tp(0, 34.8,50);
    const p = t.stepTo(34.8, 0.5);
    return { rMed, rArm, rTable, outside, outsideMap, p, pfree: t.free(p[0], p[1]),
      outFree: t.free(0.5, 0.5), room: t.state()[0].room,
      tableFree: t.free(41, 32.8), consoleFree: t.free(27, 26), audit: t.coverAudit() };
  });
  ok(PF.rMed && PF.rMed.ratio < 1.35, '会议室→医疗间绕行比 ' + (PF.rMed && PF.rMed.ratio.toFixed(2)));
  ok(PF.rArm && PF.rArm.ratio < 1.45, '会议室→军械库绕行比 ' + (PF.rArm && PF.rArm.ratio.toFixed(2)));
  ok(PF.rTable && PF.rTable.len > 9.2 && PF.rTable.len < 12,
    '圆桌是硬掩体：A* 绕最短边（路径 ' + (PF.rTable && PF.rTable.len.toFixed(1)) + ' 格）');
  ok(!PF.tableFree && !PF.consoleFree, '掩体阻挡行走：圆桌与控制台不可穿越');
  ok(PF.audit && PF.audit.gaps.length === 0 && PF.audit.dead.length === 0,
    '硬掩体布局无窄夹缝 / 无掩体死路');
  ok(PF.outside === null && PF.outsideMap === null && !PF.outFree,
    '船体外/地图外目标不可达（A* 遇到越界坐标安全返回，不会死循环）');
  ok(PF.pfree && PF.p[1] > 2.8 && PF.p[1] < 19, '撞墙后被兜底拉回会议室，不会走出船体');

  section('自动门 · 无人闭合 / 靠近开启 / 阻挡移动与视线');
  await fresh(false);
  const DR0 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    for (const a of g.agents) { a.path = null; a.x = 34.8; a.y = 33.8; a._delay = 9e9; }
    const doors = t.doors();
    for (const dr of doors) t.setDoor(dr.id, 0);
    t.doorTick(0.1);
    return { n: doors.length, doors, closed: t.doors(), inv: t.inv() };
  });
  ok(DR0.n === 22 && DR0.closed.every(d => d.open === 0), '22 扇自动门可全部闭合');
  ok(DR0.inv && DR0.inv.fails.length === 0, '自动门初始不变量全过');
  const DR1 = await T(() => {
    const t = SKV3._t, g = t.G();
    const d = t.doors().find(x => x.id === 'c1:bridge');
    t.tp(0, d.x, d.y - 2.0);
    for (let i = 0; i < 20; i++) t.doorTick(0.05);
    const opened = t.doors().find(x => x.id === d.id);
    const l1 = t.los(d.x, d.y - 1.2, d.x, d.y + 1.2);
    t.setDoor(d.id, 0);
    const l0 = t.los(d.x, d.y - 1.2, d.x, d.y + 1.2);
    return { d, opened, l0, l1, inv: t.inv() };
  });
  ok(DR1.opened.open > 0.9 && DR1.opened.target === 1, '玩家靠近门口 → 自动门滑开');
  ok(DR1.l0 === false && DR1.l1 === true, '关门阻挡视线，开门后视线恢复');
  const DR2 = await T(() => {
    const t = SKV3._t, g = t.G();
    const d = t.doors().find(x => x.id === 'c1:bridge');
    t.tp(0, d.x, d.y - 1.5);
    t.setDoor(d.id, 0);
    g.me.path = [[d.x, d.y + 3.2]];
    const blocked = t.stepOnce(0.5);
    t.setDoor(d.id, 1);
    const opened = t.stepOnce(0.5);
    return { d, blocked, opened, inv: t.inv() };
  });
  ok(DR2.blocked[1] < DR2.d.y && DR2.opened[1] > DR2.d.y, '关门阻挡移动，开门后可通过');
  ok(DR2.inv && DR2.inv.fails.length === 0, '自动门状态不变量全过');
  await T(() => {
    const t = SKV3._t;
    const d = t.doors().find(x => x.id === 'c1:bridge');
    t.setDoor('c1:bridge', 1);
    t.tp(0, d.x, d.y - 2.2);
  });
  await page.waitForTimeout(220);
  await shot('49_自动门.png');

  section('配电室 · 断电后所有门扫描 2 秒');
  await fresh(false);
  const LOCK = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const ds = t.doors();
    const nb = ds.find(d => !/:bridge$/.test(d.id));
    const br = ds.find(d => /:bridge$/.test(d.id));
    const cross = d => d.horiz ? [d.x, d.y - 0.6, d.x, d.y + 0.6] : [d.x - 0.6, d.y, d.x + 0.6, d.y];
    /* 其他人远离门口；玩家站到非会议室门内侧 1.6 格 */
    for (const a of g.agents) if (a.i !== 0) t.tp(a.i, 30,54);
    t.tp(0, nb.horiz ? nb.x : nb.x - 1.6, nb.horiz ? nb.y - 1.6 : nb.y);
    t.setDoor(nb.id, 1); t.setDoor(br.id, 1);
    t.breaker();                            /* 断电：所有门进入逐门扫描 */
    const c1 = cross(nb), c2 = cross(br);
    t.doorTick(1.0);
    const half = t.doors().find(d => d.id === nb.id);
    const blockedHalf = t.doorBlock(c1[0], c1[1], c1[2], c1[3]);
    t.doorTick(1.1);
    const full = t.doors().find(d => d.id === nb.id);
    const blockedFull = t.doorBlock(c1[0], c1[1], c1[2], c1[3]);
    /* 会议室门同样要扫描：把玩家移到 bridge 门内侧再看 2 秒 */
    t.tp(0, br.horiz ? br.x : br.x - 1.6, br.horiz ? br.y - 1.6 : br.y);
    t.setDoor(br.id, 1);
    t.doorTick(1.0);
    const bridgeHalf = t.doors().find(d => d.id === br.id);
    const bridgeBlockedHalf = t.doorBlock(c2[0], c2[1], c2[2], c2[3]);
    t.doorTick(1.1);
    const bridgeFull = t.doors().find(d => d.id === br.id);
    const bridgeBlocked = t.doorBlock(c2[0], c2[1], c2[2], c2[3]);
    /* 离开门口 → 重新上锁；再次靠近又要重新扫描 */
    t.tp(0, 30,54);
    t.doorTick(0.2);
    const away = t.doors().find(d => d.id === nb.id);
    t.tp(0, nb.horiz ? nb.x : nb.x - 1.6, nb.horiz ? nb.y - 1.6 : nb.y);
    t.doorTick(0.6);
    const again = t.doors().find(d => d.id === nb.id);
    const blockedAgain = t.doorBlock(c1[0], c1[1], c1[2], c1[3]);
    /* 恢复供电 → 立即解除扫描 */
    t.breaker();
    t.setDoor(nb.id, 1);
    t.doorTick(0.1);
    const restored = t.doors().find(d => d.id === nb.id);
    const blockedRestored = t.doorBlock(c1[0], c1[1], c1[2], c1[3]);
    return { nb: nb.id, br: br.id, bridgeDoors: ds.filter(d => /:bridge$/.test(d.id)).length,
      half, blockedHalf, full, blockedFull, bridgeHalf, bridgeBlockedHalf, bridgeFull, bridgeBlocked,
      away, again, blockedAgain, restored, blockedRestored };
  });
  ok(LOCK.half.scanT > 0.8 && LOCK.half.scanT < 1.2 && LOCK.half.scanning && LOCK.blockedHalf,
    '断电后靠近非会议室门：先扫描，1 秒时仍不能通过');
  ok(LOCK.full.scanT >= 1.9 && LOCK.full.locked === false && !LOCK.blockedFull,
    '扫描满 2 秒才放行：' + LOCK.nb);
  ok(LOCK.bridgeHalf.scanT > 0.5 && LOCK.bridgeBlockedHalf,
    '会议室门同样要扫描：1 秒时仍不能通过');
  ok(LOCK.bridgeFull.scanT >= 1.9 && !LOCK.bridgeBlocked && LOCK.bridgeDoors === 4,
    '会议室 4 扇门扫描满 2 秒才放行');
  ok(LOCK.away.scanT === 0 && LOCK.again.scanT > 0.5 && LOCK.again.scanT < 0.8 &&
    LOCK.blockedAgain,
    '人离开后重新上锁：再次靠近仍需重新扫描 2 秒');
  ok(LOCK.restored.scanT === 0 && !LOCK.blockedRestored,
    '电力恢复立即解除扫描：门恢复正常通行');
  await fresh(false);

  section('AI 拐角寻路 · 不卡死');
  const CW0 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const a = g.agents.find(x => !x.alien && x.i !== 0 && x.alive);
    t.tp(a.i, 34.8,33.8);
    a.path = t.astar(34.8, 33.8, 58, 45);
    const r = t.walkAgent(a.i, 260, 0.05);
    return { i: a.i, r, inv: t.inv() };
  });
  ok(CW0.r && CW0.r.left === 0 && Math.hypot(CW0.r.x - 58, CW0.r.y - 45) < 3,
    'AI 拐角寻路 260 步不卡死（终点 ' + CW0.r.x.toFixed(1) + ',' + CW0.r.y.toFixed(1) + '）');
  ok(CW0.inv && CW0.inv.fails.length === 0, '拐角寻路后不变量全过');

  section('E 交互轮盘 · 多项选择');
  await fresh(false);
  const WH0 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const all = t.points();
    const pi = all.findIndex(p => p.label === '药柜');
    const p = all[pi];
    g.me.tasks = [pi, 0, 1, 2]; g.me.tIdx = 0;
    g.me.doing = 0; g.me._doing = null; g.me.path = null;
    g.dmg = [{ room: p.room, x: p.x, y: p.y, label: '测试故障', left: 60, dur: 60, by: 0 }];
    t.tp(0, p.x, p.y);
    const opened = t.openWheel();
    return { opened, wheel: t.wheel(),
      dom: !document.getElementById('wheel').classList.contains('hide'),
      buttons: document.querySelectorAll('#wheel-opts button').length, inv: t.inv() };
  });
  ok(WH0.opened && WH0.wheel && WH0.wheel.n >= 2 && WH0.dom && WH0.buttons === WH0.wheel.n,
    'E 多项交互打开轮盘（' + (WH0.wheel ? WH0.wheel.n : 0) + ' 项）');
  ok(WH0.inv && WH0.inv.fails.length === 0, '交互轮盘打开后不变量全过');
  await shot('50_交互轮盘.png');
  const WH1 = await T(() => {
    const t = SKV3._t, g = t.G();
    const w = t.wheel();
    const i = w.items.findIndex(x => x.id === 'task');
    const r = t.pickWheel(i);
    return { i, r, do: g.me._doing, doing: g.me.doing, wheel: t.wheel() };
  });
  ok(WH1.i >= 0 && WH1.do === 'task' && !WH1.wheel, '轮盘选择「维修任务」→ 进入任务站桩');
  const WH2 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.me.doing = 0; g.me._doing = null; g.me.path = null;
    g.dmg = [];
    const pi = t.points().findIndex(p => p.label === '电路维修');
    g.me.tasks = [pi, 0, 1, 2]; g.me.tIdx = 0;
    t.tp(0, 49, 55.4);
    t.openWheel();
    const w = t.wheel();
    const i = w.items.findIndex(x => x.id === 'breaker');
    t.pickWheel(i);
    return { i, do: g.me._doing, doing: g.me.doing };
  });
  ok(WH2.i >= 0 && WH2.do === 'breaker' && WH2.doing > 2.5, '轮盘选择「拉闸」→ 进入 3 秒动作');

  section('AI 尸体报告');
  await fresh(false);
  const AR = await T(() => {
    const t = SKV3._t, g = t.G();
    const v = g.agents.find(a => a.i !== 0 && !a.alien && a.alive);
    t.tp(v.i, 28.4,44);
    t.kill(v.i, 'knife');
    const rep = g.agents.find(a => a.i !== 0 && !a.alien && a.alive && a !== v);
    t.tp(rep.i, 28.4,46.6);
    const s1 = t.aiScan(rep.i, 0.6);
    const s2 = t.aiScan(rep.i, 5);
    const out = {
      s1, s2, open: !document.getElementById('meet').classList.contains('hide'),
      vic: document.getElementById('m-vic').textContent,
      by: document.getElementById('m-by').textContent,
      vicTag: String(v.i + 1).padStart(2, '0') + ' ' + v.name,
      repTag: String(rep.i + 1).padStart(2, '0') + ' ' + rep.name,
      inv: t.inv()
    };
    t.finishMeeting();
    return out;
  });
  ok(AR.s1.t > 1 && !AR.s1.meet, 'AI 看到尸体先犹豫 1.4–3s');
  ok(AR.s2.meet && AR.open, 'AI 犹豫结束自动拉响紧急会议');
  ok(AR.vic === AR.vicTag && AR.by === AR.repTag, '会议记录：报告人 ' + AR.by + ' / 死者 ' + AR.vic);
  ok(AR.inv && AR.inv.fails.length === 0, 'AI 报告后不变量全过');

  section('AI 认知 · 伤口/搜尸/听觉/证据链');
  await fresh(false);
  const COG = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = false;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const w = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== v);
    for (const a of g.agents) if (a !== k && a !== v && a !== w) t.tp(a.i, 30,32);
    t.tp(k.i, 56, 85); t.tp(v.i, 57.2, 85); t.tp(w.i, 55.5, 85);
    k.knife = 1; k.sabUsed = true; k._delay = 0; k.doing = 0;
    k._doing = null; k.path = null; k.target = null;
    t.knife(k.i, v.i);
    const b0 = t.bodyInfo(v.i), m0 = t.mind(w.i);
    const s1 = t.aiScan(w.i, 0.6);
    const startDo = g.agents[w.i]._doing;
    const r = t.aiTick(w.i, 30, 0.05);
    const b1 = t.bodyInfo(v.i), m1 = t.mind(w.i);
    return { k: k.i, v: v.i, w: w.i, b0, m0, s1, startDo, r, b1, m1 };
  });
  ok(COG.b0.downed && COG.b0.cause === 'knife' && COG.b0.wound.indexOf('刀伤') >= 0 &&
    COG.b0.searched === false, '刀击写入伤口/濒死状态，尸体尚未检查');
  ok(COG.m0.sus[COG.k] >= 0.6, '目击刀击 → 嫌疑分 ' + COG.m0.sus[COG.k]);
  ok(COG.m0.mem.some(e => e.kind === 'saw_knife') &&
    COG.m0.mem.some(e => e.kind === 'heard_knife'),
    '视觉证据 saw_knife + 听觉证据 heard_knife 同时入链');
  ok(COG.startDo === 'search', 'AI 发现未检查的濒死者：先进入搜尸，不直接拉铃');
  ok(COG.b1.searched === true && COG.m1.mem.some(e => e.kind === 'search_result'),
    '搜尸完成：身体状态变为已检查，证据链新增 search_result');

  section('AI 认知 · 环境线索 / 报告上限 / 异形自报 / 证据投票');
  const ENV = await T(() => {
    const t = SKV3._t, g = t.G();
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && !a.downed);
    t.breaker();
    const m = t.mind(h.i);
    return { mem: m ? m.mem.map(e => e.kind) : [], alert: m ? m.alert : 0 };
  });
  ok(ENV.mem.indexOf('env_lights') >= 0 || ENV.mem.indexOf('heard_power') >= 0,
    '拉闸 → 环境/听觉证据进入 AI 记忆（env_lights / heard_power）');

  await fresh(false);
  const RPT = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = false; g.aiReportUsed = false;
    const humans = g.agents.filter(a => !a.alien && a.i !== 0 && a.alive);
    const v1 = humans[0], v2 = humans[1];
    const r1 = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== v1 && a !== v2);
    const r2 = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== v1 && a !== v2 && a !== r1);
    for (const a of g.agents) if (a !== v1 && a !== v2 && a !== r1 && a !== r2) t.tp(a.i, 30,32);
    t.tp(v1.i, 28.4,44); t.kill(v1.i, 'knife'); t.tp(r1.i, 28.4,46.6);
    r1._delay = 0; r1.doing = 0; r1._doing = null; r1.path = null;
    let m1 = null; for (let i = 0; i < 100; i++) { m1 = t.aiScan(r1.i, 0.1); if (m1.meet) break; }
    const used1 = t.aiReportUsed();
    t.finishMeeting();
    t.tp(v2.i, 28.4,44); t.kill(v2.i, 'knife'); t.tp(r2.i, 28.4,46.6);
    r2._delay = 0; r2.doing = 0; r2._doing = null; r2.path = null;
    let m2 = null; for (let i = 0; i < 100; i++) { m2 = t.aiScan(r2.i, 0.1); if (m2.meet) break; }
    return { meet1: !!(m1 && m1.meet), used1, used2: t.aiReportUsed(), meet2: !!t.G().meet };
  });
  ok(RPT.meet1 && RPT.used1, '第一次 AI 尸体报告成功');
  ok(RPT.meet2, '同一夜第二具尸体也能报告（不再限制每晚一次会议）');

  /* 同一具尸体：本夜报过一次就失效，天亮入夜后重新可报 */
  /* 同一具尸体不能被报告两次。真实机制比"每夜一次"更强：
     openMeeting 在会议开始时就清场（js/game.js 的 bodyGone），
     所以一次报告之后那具尸体的坐标已经不存在，物理上无法再报第二次。
     reportNight 只是把"本夜已报"的意图写明确，并修掉旧实现里
     「尸体标记跨夜永久锁死」的隐患（若某具尸体所在夜没人拉铃，下一夜仍可报）。 */
  await fresh(false);
  const RPT1B = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true;
    const v = g.agents.find(a => a.i !== 0 && a.alive && !a.downed);
    /* 尸体放在圆桌南侧的空地上，人站在它旁边 1.6 格（报告半径 2.4 格内） */
    t.tp(v.i, 41, 38.4); t.kill(v.i, 'knife');
    const bp = t.bodyOf(v.i);
    const stand = () => {
      const me = g.agents[0];
      me.alive = true; me.downed = false; me.detained = false;
      g.over = false; g.meet = null;
      t.tp(0, bp[0], bp[1] - 1.6);
      return +Math.hypot(bp[0] - g.me.x, bp[1] - g.me.y).toFixed(2);
    };
    const d = stand();
    const first = t.report();
    const flag = t.bodyReported(v.i);
    const bodyAfterMeet = !!t.bodyOf(v.i);
    t.finishMeeting();
    stand();
    const second = t.report();
    return { d, first, flag, bodyAfterMeet, second };
  });
  ok(RPT1B.first && RPT1B.flag && !RPT1B.second,
    '同一具尸体不能报告第二次（首报 ' + RPT1B.first + ' · 复报 ' + RPT1B.second
    + ' · 站位 ' + RPT1B.d + ' 格）');
  ok(RPT1B.bodyAfterMeet === false,
    '报告即开会时尸体清场：重复报告在机制上不可能（bodyGone 生效）');

  /* 玩家自己拉铃时，系统不得替玩家发言——聊天栏里不能冒出一个"AI 星尘" */
  await fresh(false);
  await T(() => {
    const t = SKV3._t, g = t.G(); g.paused = true;
    const v = g.agents.find(a => a.i !== 0 && a.alive && !a.downed);
    t.tp(v.i, 41, 38.4); t.kill(v.i, 'knife');
    const bp = t.bodyOf(v.i);
    t.tp(0, bp[0], bp[1] - 1.6);
    t.report();
    return { me: g.me.name };
  });
  await page.waitForTimeout(2800);
  const MVOX = await T(() => {
    const t = SKV3._t, g = t.G();
    const lines = t.meetLines();
    return { me: g.me.name,
      fake: lines.filter(l => l.who === g.me.name && !l.sys).map(l => l.text),
      sys: lines.filter(l => l.sys).map(l => l.text).join(' | ') };
  });
  ok(MVOX.fake.length === 0,
    '玩家拉铃不会被代发言：挂在「' + MVOX.me + '」名下的非系统台词 ' + MVOX.fake.length + ' 条');
  ok(/发现了/.test(MVOX.sys) && /(人已经没了|先救人)/.test(MVOX.sys),
    '报告事实改由系统播报（' + MVOX.sys.slice(0, 46) + '…）');

  await fresh(false);
  const ALR = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = false; g.aiReportUsed = false;
    g.prog = 30;                 /* 人类进度高 → 拖时间的收益足够，异形会主动报案 */
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k && a !== v) t.tp(a.i, 85,77);
    t.tp(v.i, 28.4,44); t.kill(v.i, 'knife'); t.tp(k.i, 28.4,46.6);
    k._delay = 0; k.doing = 0; k._doing = null; k.path = null; k.knife = 0;
    let scan = null; for (let i = 0; i < 120; i++) { scan = t.aiScan(k.i, 0.1); if (scan.meet) break; }
    const by = document.getElementById('m-by').textContent;
    return { meet: !!(scan && scan.meet), used: t.aiReportUsed(), alien: k.i,
      tag: String(k.i + 1).padStart(2, '0') + ' ' + k.name, by };
  });
  ok(ALR.meet && ALR.used && ALR.by === ALR.tag,
    'AI 异形现在会报告尸体（报告人 ' + ALR.by + '，期望 ' + ALR.tag + '；meet=' + ALR.meet + ' used=' + ALR.used + '）');

  await fresh(false);
  const EV = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const w = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== v);
    for (const a of g.agents) if (a !== k && a !== v && a !== w) t.tp(a.i, 30,32);
    t.tp(k.i, 56, 85); t.tp(v.i, 57.2, 85); t.tp(w.i, 55.5, 85);
    k.knife = 1; k.sabUsed = true; k._delay = 0; k.doing = 0;
    k._doing = null; k.path = null; k.target = null;
    t.knife(k.i, v.i);
    w.suspect = null;                 // 只保留证据分，验证推理链本身
    t.openMeeting('night', w.i, v.i);
    const acc = w.accuse;
    t.startVote();
    const vote = g.meet.votes[w.i];
    t.finishMeeting();
    return { k: k.i, w: w.i, acc, vote, inv: t.inv() };
  });
  ok(EV.acc === EV.k && EV.vote === EV.k,
    '没有直接 suspect 时，证据分仍能驱动指控与投票（' + EV.acc + '/' + EV.vote + '）');
  ok(EV.inv && EV.inv.fails.length === 0, '证据链指控/投票后不变量全过');

  await fresh(false);
  const ABST = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true;
    for (const a of g.agents) {
      a.suspect = null; a.accuse = null;
      if (a.mind) { a.mind.mem = []; a.mind.sus = {}; a.mind.why = {}; a.mind.alert = 0; a.mind.noise = null; }
    }
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    t.openMeeting('day', null, null);
    t.startVote();
    const vote = g.meet.votes[h.i];
    const humans = g.agents.filter(a => !a.alien && a.alive && !a.downed && a !== g.me);
    const badVotes = humans.filter(a => g.meet.votes[a.i] !== undefined && g.meet.votes[a.i] !== -1)
      .map(a => a.i);
    t.finishMeeting();
    return { h: h.i, vote, sus: h.suspect, acc: h.accuse, badVotes, humanN: humans.length,
      mind: h.mind ? {sus:h.mind.sus, mem:h.mind.mem.length} : null,
      votes: g.meet ? Object.assign({}, g.meet.votes) : null, mem: h.mind ? h.mind.mem.length : -1 };
  });
  ok(ABST.vote === -1, 'AI 人类没有证据时弃权，不再随机投人');
  ok(ABST.badVotes.length === 0,
    '零证据的人类 AI 全部弃权（跟票只给手里有动静的人，不会凭空替人定罪）' +
    (ABST.badVotes.length ? ' :: ' + JSON.stringify(ABST.badVotes) : ''));
  ok(ABST.sus === null && ABST.mem === 0, '进入新一夜：suspect 与认知记忆清空（无跨夜记忆）');

  section('开局出生点 · HUD 存活人数');
  const SP = await T(() => {
    const t = SKV3._t;
    t.newGame();
    const st = t.state();
    return { rooms: st.map(s => s.room), n: st.length, inv: t.inv() };
  });
  ok(SP.n === 15 && SP.rooms.every(r => r === 'bridge'), '开局 15 人全部出生在中央会议室');
  ok(SP.inv && SP.inv.fails.length === 0, '出生站位不变量全过');
  await page.waitForTimeout(250);
  const H0 = await T(() => ({
    alive: document.getElementById('alive').textContent,
    hum: document.getElementById('hum').textContent,
    ali: document.getElementById('ali').textContent,
    pwr: document.getElementById('pwr').textContent,
    text: document.querySelector('#hud .surv').textContent
  }));
  ok(H0.alive === '15' && H0.hum === '11' && H0.ali === '4', 'HUD 存活 15 · 人类 11 · 异形 4');
  ok(H0.text.indexOf('人类') >= 0 && H0.text.indexOf('异形') >= 0 && H0.pwr === '照明正常',
    'HUD 分列人类/异形，并显示照明状态');
  await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const h = g.agents.find(a => a.i !== 0 && !a.alien && a.alive);
    const k = g.agents.find(a => a.i !== 0 && a.alien && a.alive);
    t.kill(h.i, 'knife');
    t.kill(k.i, 'knife');
  });
  await page.waitForTimeout(220);
  const H1 = await T(() => ({
    alive: document.getElementById('alive').textContent,
    hum: document.getElementById('hum').textContent,
    ali: document.getElementById('ali').textContent
  }));
  ok(H1.alive === '13' && H1.hum === '10' && H1.ali === '3', '有人出局后 HUD 实时更新：13 / 人类 10 / 异形 3');
  await shotClip('39_HUD存活人数.png', { x: 6, y: 6, width: 520, height: 190 });

  section('监控室 · 10 路画面 / 电闸断信号');
  await fresh(false);
  const C0 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    /* 监控台锚点 2026-10-31 从 (84,29) → (81,28.8) → (79.35,36.0)：
       最终贴在主控台上（屏幕斜躺在台面），玩家站主控台北侧 y34.7 调画面。 */
    t.tp(0, 79.35,34.7);
    return { room: t.state()[0].room, near: t.cams().near, inv: t.inv() };
  });
  await page.keyboard.press('e');
  await page.waitForTimeout(260);
  const C1 = await T(() => {
    const t = SKV3._t;
    return { cams: t.cams(), open: !document.getElementById('cam').classList.contains('hide'),
      state: document.getElementById('cam-state').textContent,
      tip: document.getElementById('tip').textContent };
  });
  ok(C0.room === 'cam' && C0.near && C0.inv.fails.length === 0, '站在监控室监控台旁，交互范围命中');
  ok(C1.cams.open && C1.cams.room && C1.cams.feeds === 10 && C1.open,
    'E 打开监控台：10 路画面全覆盖');
  ok(C1.state.indexOf('10 路在线') >= 0 && C1.tip.indexOf('监控台') >= 0,
    '状态条显示 10 路在线，提示栏切换为监控操作');
  await shot('40_监控室10路.png');
  const C2 = await T(() => { const t = SKV3._t; const r = t.breaker(); return { r, cams: t.cams() }; });
  await page.waitForTimeout(360);
  const C3 = await T(() => ({
    cut: SKV3._t.cams().cut,
    state: document.getElementById('cam-state').textContent,
    cls: document.getElementById('cam-state').className,
    open: !document.getElementById('cam').classList.contains('hide')
  }));
  ok(C2.r.state === 2 && C3.cut && C3.open, '配电室拉闸：监控遮罩仍在，10 路全部断信号');
  ok(C3.state.indexOf('信号中断') >= 0 && C3.cls.indexOf('cut') >= 0, '监控状态条：信号中断 · 电闸断开');
  await shot('41_断电监控.png');
  const C4 = await T(() => { const t = SKV3._t; t.breaker(); return { cams: t.cams() }; });
  ok(C4.cams.cut === false, '合上电闸：监控信号恢复');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  ok(!(await T(() => SKV3._t.cams().open)), 'ESC 退出监控台');

  section('地道 · 选择出口方向');
  await fresh(false);
  const PP = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const swap = g.agents.find(a => a.alien && a.i !== 0);
    swap.alien = false;
    g.me.alien = true;
    const pipe = t.pipes()[1];
    t.tp(0, pipe.x, pipe.y);
    return { pipe, pipes: t.pipes(), room: t.state()[0].room };
  });
  await page.keyboard.press('e');
  await page.waitForTimeout(200);
  const PD = await T(() => {
    const t = SKV3._t;
    return { p: t.pipe(), open: !document.getElementById('pipe').classList.contains('hide'),
      btns: [...document.querySelectorAll('#pipe-list button')].map(b => b.textContent),
      sub: document.getElementById('pipe-sub').textContent };
  });
  ok(PD.p.open && PD.p.opts.length === 5 && PD.open, '异形按 E 打开地道出口列表：5 个可选目的地');
  ok(PD.p.fromRoom === '监控室' && PD.btns.length === 5 && PD.btns[0].indexOf('1') === 0,
    '列表标出当前管道口与 1–5 快捷键');
  await shot('42_地道选择.png');
  const DEST = PD.p.opts[1];
  await page.keyboard.press('2');
  await page.waitForTimeout(160);
  const PJ = await T(() => {
    const t = SKV3._t;
    return { pos: t.pos(), room: t.state()[0].room, open: t.pipe().open, fx: t.fx() };
  });
  ok(Math.abs(PJ.pos[0] - PP.pipes[DEST.i].x) < 0.01 && Math.abs(PJ.pos[1] - PP.pipes[DEST.i].y) < 0.01 &&
    PJ.room !== 'power', '数字键 2 直达指定出口（' + DEST.name + ' 管道口），不再随机方向');
  ok(PJ.open === false && PJ.fx.includes('pipefx'), '选择后关闭列表并播放管道特效');
  await page.keyboard.press('e');
  await page.waitForTimeout(160);
  const PO = await T(() => ({ open: SKV3._t.pipe().open, from: SKV3._t.pipe().fromRoom }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(130);
  ok(PO.open && PO.from === DEST.name && !(await T(() => SKV3._t.pipe().open)),
    '到达后可再次打开列表，ESC 取消');

  section('驱逐出局 · 公布身份');
  await fresh(false);
  const E1 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const k = g.agents.find(a => a.i >= 4 && a.alien && a.alive);
    t.openMeeting('night');
    const m = g.meet;
    m.votes = { 0: k.i, 1: k.i, 2: k.i, 3: k.i };
    m.phase = 'vote';
    t.closeVote();
    const st = t.state()[k.i];
    return { tally: m.tally, text: document.getElementById('m-tally').textContent,
      sys: document.getElementById('m-say').textContent, dead: !st.alive, cause: st.cause,
      tag: String(k.i + 1).padStart(2, '0') + ' ' + k.name };
  });
  ok(E1.tally.exRole === '异形' && E1.dead && E1.cause === 'vote', '驱逐异形：立即出局并记录身份');
  ok(E1.text.indexOf('身份：异形') >= 0 && E1.sys.indexOf('身份公布：异形') >= 0,
    '计票栏与系统播报同时公布「异形」');
  ok(E1.text.indexOf(E1.tag) >= 0, '计票栏保留「编号 + 名字」');
  await shot('43_驱逐身份.png');
  await T(() => SKV3._t.finishMeeting());
  await page.waitForTimeout(160);
  await fresh(false);
  const E2 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const h = g.agents.find(a => a.i >= 4 && !a.alien && a.alive);
    t.openMeeting('night');
    const m = g.meet;
    m.votes = { 0: h.i, 1: h.i, 2: h.i, 3: h.i };
    m.phase = 'vote';
    t.closeVote();
    return { tally: m.tally, text: document.getElementById('m-tally').textContent,
      dead: !t.state()[h.i].alive };
  });
  ok(E2.tally.exRole === '人类' && E2.dead && E2.text.indexOf('身份：人类') >= 0,
    '驱逐人类：同样公布「人类」，不会隐去身份');
  await T(() => SKV3._t.finishMeeting());
  await page.waitForTimeout(160);

  section('机器人 · 巡逻 / 停摆');
  await fresh(false);
  const PT0 = await T(() => ({ b: SKV3._t.bots(), home: SKV3._t.medbotHome() }));
  ok(PT0.b.medbot && PT0.b.secbot &&
    PT0.b.medbot.patrol.length === 0 && PT0.b.secbot.patrol.length === 4,
    '医疗无人机不巡逻（0 航点，悬停医疗间中央）/ 保安机器人 4 点巡逻');
  ok(PT0.home && Math.hypot(PT0.home[0] - 55, PT0.home[1] - 84) < 4.5,
    '医疗无人机坞位在医疗间正中央附近（' + PT0.home.map(v => v.toFixed(1)).join(',') + '）');
  const PT1 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const before = t.bots();
    t.botTick(1.0);
    const after = t.bots();
    return { before, after,
      medFree: t.free(after.medbot.x, after.medbot.y),
      secFree: t.free(after.secbot.x, after.secbot.y) };
  });
  const medStep = Math.hypot(PT1.after.medbot.x - PT1.before.medbot.x,
    PT1.after.medbot.y - PT1.before.medbot.y);
  const secStep = Math.hypot(PT1.after.secbot.x - PT1.before.secbot.x,
    PT1.after.secbot.y - PT1.before.secbot.y);
  ok(secStep > 1.2 && secStep < 1.75,
    '保安巡逻速度 1.6 格/秒（1s 位移 ' + secStep.toFixed(2) + ' 格）');
  ok(medStep < 0.2, '没有伤员时医疗无人机停在坞位悬停（1s 位移 ' + medStep.toFixed(2) + ' 格）');
  ok(PT1.medFree && PT1.secFree, '巡逻/悬停中的机器人始终站在可行走格上');
  const PT2 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.secbotDead = true;
    const p0 = t.bots().secbot;
    t.botTick(1.0);
    const p1 = t.bots().secbot;
    return { p0, p1 };
  });
  ok(Math.hypot(PT2.p1.x - PT2.p0.x, PT2.p1.y - PT2.p0.y) < 1e-9,
    '停摆的保安机器人原地不动');
  await T(() => SKV3._t.tp(0, 84,72));
  await page.waitForTimeout(220);
  await shot('47_机器人巡逻.png');

  section('保安机器人 · 拘留 / 释放 / 破坏');
  await fresh(false);
  const SB0 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const freeNear = (x, y) => {
      for (let r = 0.4; r <= 2.4; r += 0.2)
        for (let i = 0; i < 20; i++) {
          const a = i / 20 * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
          if (t.free(px, py)) return [px, py];
        }
      return [x, y];
    };
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== v);
    /* 把保安机器人摆到军械库东南角：离设施初始位 >6 格，只有读运行时坐标才会擒拿 */
    const sec = t.setBot('secbot', 88.5, 54.5, Math.PI);
    const sb = g.bots && g.bots.secbot;
    if (sb) { sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = Math.PI; }
    const kp = freeNear(86, 54), vp = freeNear(86, 53.2);
    t.tp(k.i, kp[0], kp[1]);
    t.tp(v.i, vp[0], vp[1]); t.tp(h.i, 84.8,74.2);
    k.knife = 1;
    t.knife(k.i, v.i);
    return { k: k.i, v: v.i, h: h.i, jail: t.jail(), kp, vp, sec, inv: t.inv() };
  });
  await page.waitForTimeout(200);
  const SB1 = await T(o => {
    const t = SKV3._t, g = t.G();
    for (let i = 0; i < 6; i++) t.botTick(1.0);   /* 追捕 → 压制 → 押送完成 */
    const a = g.agents[o.k];
    return { detained: t.detained(), st: t.state()[o.k], fx: t.fx(), pos: [a.x, a.y],
      used: t.robots().sec.used, jail: t.jail(), msg: g.msg || '', inv: t.inv(),
      bots: t.bots(), uses: t.robots().sec.uses, sus: t.mind(o.h) ? (t.mind(o.h).sus[o.k] || 0) : 0 };
  }, SB0);
  ok(SB0.sec && Math.hypot(SB0.kp[0] - SB0.sec[0], SB0.kp[1] - SB0.sec[1]) < 6 &&
    Math.hypot(SB0.kp[0] - 80, SB0.kp[1] - 53) > 6 && SB0.inv.fails.length === 0,
    '行凶点离保安机器人初始位 >6 格：仍按巡逻坐标擒拿');
  ok(SB1.detained.some(d => d.i === SB0.k) && SB1.st.detained && SB1.st.detainedT > 29 && SB1.st.detainedT <= 31.5,
    '保安机器人擒拿凶手：拘留倒计时 ' + (SB1.st.detainedT || 0).toFixed(1) + 's');
  ok(SB1.used && SB1.uses >= 1 && SB1.st.room === 'armory' && SB1.jail &&
    Math.hypot(SB1.pos[0] - SB1.jail[0], SB1.pos[1] - SB1.jail[1]) < 0.01,
    '凶手被拽到军械库角落拘留位');
  ok(SB1.fx.includes('detain') && SB1.fx.includes('alarm'), '拘留拖拽线 + 红色警报环特效');
  ok(String(SB1.msg || '').indexOf('保安机器人擒拿') < 0, '拘押不再公告（无全局播报）');
  ok(SB1.sus >= 0.4, '被拘留者被附近人类优先怀疑（sus=' + SB1.sus.toFixed(2) + '）');
  ok(SB1.inv && SB1.inv.fails.length === 0, '拘留状态不变量全过');
  await T(() => {
    const t = SKV3._t, g = t.G();
    g.fx.forEach(f => { f.dur = Math.max(6, f.dur); f.t = f.dur * 0.55; });
    const p = t.jail();
    t.tp(0, 85.2,73.2);
  });
  await page.waitForTimeout(140);
  await shot('44_保安机器人拘留.png');
  await T(o => { SKV3._t.G().agents[o.k].detainedT = 0.12; }, SB0);
  await page.waitForTimeout(420);
  const SB2 = await T(o => ({ detained: SKV3._t.detained(), st: SKV3._t.state()[o.k], inv: SKV3._t.inv() }), SB0);
  ok(SB2.detained.length === 0 && !SB2.st.detained, '30 秒拘留结束：自动释放');
  ok(SB2.inv && SB2.inv.fails.length === 0, '释放后不变量全过');
  await T(() => {
    const g = SKV3._t.G();
    g.me.detained = true; g.me.detainedT = 5; g.me.path = null;
  });
  await page.waitForTimeout(300);
  const SB3 = await T(() => ({
    role: document.getElementById('role').textContent,
    tip: document.getElementById('tip').textContent,
    path: SKV3._t.G().me.path
  }));
  ok(SB3.role.indexOf('被擒') >= 0 && SB3.tip.indexOf('自动释放') >= 0,
    '玩家被擒：HUD 显示倒计时，提示栏说明释放规则');
  await page.mouse.click(700, 450);
  await page.waitForTimeout(140);
  const SB3b = await T(() => SKV3._t.G().me.path);
  ok(SB3b === null, '被擒期间点击地面不会移动');
  await T(() => { SKV3._t.G().me.detainedT = 0.1; });
  /* detainedT 走的是模拟时间，dt 有钳制：机器忙时（后台在烘图/出图）模拟会落后墙钟，
     320ms 不够走完 0.1 秒。等到 900ms，测的是"倒计时归零即释放"，
     不是"这台机器此刻有多少帧预算"。 */
  await page.waitForTimeout(900);
  ok(!(await T(() => SKV3._t.G().me.detained)), '玩家倒计时归零后恢复自由');

  section('保安机器人 · 异形破坏停摆');
  await fresh(false);
  const SS0 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const swap = g.agents.find(a => a.alien && a.i !== 0);
    swap.alien = false;
    g.me.alien = true;
    g.me.sabUsed = false;
    const sp = t.setBot('secbot', 80, 53);
    let best = [sp[0] + 1.2, sp[1]];
    for (let r = 0.6; r <= 1.4; r += 0.15) {
      let hit = null;
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * Math.PI * 2, x = sp[0] + Math.cos(a) * r, y = sp[1] + Math.sin(a) * r;
        if (t.free(x, y)) { hit = [x, y]; break; }
      }
      if (hit) { best = hit; break; }
    }
    t.tp(0, best[0], best[1]);
    return { pos: best, sec: sp, dist: Math.hypot(best[0] - sp[0], best[1] - sp[1]), inv: t.inv() };
  });
  await page.keyboard.press('h');
  await page.waitForTimeout(200);
  const FW = await T(() => {
    const t = SKV3._t, w = t.wheel();
    if (!w) return { wheel: false, items: [] };
    const items = w.items.map(x => x.id);
    const i = w.items.findIndex(x => x.id === 'sab-bot');
    t.pickWheel(i);
    return { wheel: true, items };
  });
  ok(FW.wheel && FW.items.includes('sab-bot') && FW.items.includes('sab-room'),
    '异形贴着机器人按 H：轮盘选择「停摆机器人 / 破坏舱室」');
  const SS1 = await T(() => ({
    robots: SKV3._t.robots(), fx: SKV3._t.fx(), msg: SKV3._t.G().msg, inv: SKV3._t.inv()
  }));
  ok(SS0.dist < 1.5 && SS1.robots.sec.dead, '异形贴近巡逻中的保安机器人按 F：当晚停摆');
  ok(SS1.fx.includes('spark') && String(SS1.msg || '').indexOf('保安机器人今晚停摆') < 0, '破坏反馈：火花保留，但不再公告机器人被毁');
  ok(SS1.inv && SS1.inv.fails.length === 0, '破坏后不变量全过');
  const SS2 = await T(() => {
    const t = SKV3._t, g = t.G();
    const freeNear = (x, y) => {
      for (let r = 0.4; r <= 2.4; r += 0.2)
        for (let i = 0; i < 20; i++) {
          const a = i / 20 * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
          if (t.free(px, py)) return [px, py];
        }
      return [x, y];
    };
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive && !a.detained);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && !a.downed);
    const kp = freeNear(82, 51.5), vp = freeNear(82, 50.4);
    t.tp(k.i, kp[0], kp[1]); t.tp(v.i, vp[0], vp[1]);
    k.knife = 1;
    t.knife(k.i, v.i);
    return { k: k.i };
  });
  await page.waitForTimeout(240);
  const SS3 = await T(() => ({ detained: SKV3._t.detained(), used: SKV3._t.robots().sec.used,
    inv: SKV3._t.inv() }));
  ok(SS3.detained.length === 0 && SS3.used === false, '机器人停摆后，视野内行凶不再触发拘留');
  ok(SS3.inv && SS3.inv.fails.length === 0, '停摆后的行凶同样不违反不变量');

  section('异形 F/H 分离 · 施救与破坏');
  await fresh(false);
  const FR = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true;
    g.me.alien = true; g.me.medkit = 1; g.me.sabUsed = false;
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && !a.downed);
    t.tp(v.i, 56, 85); t.tp(0, 57.1,85);
    v.downed = true; v.downAt = g.t; v.path = null;
    return { v: v.i, medkit: g.me.medkit };
  });
  await page.keyboard.press('f');
  await page.waitForTimeout(180);
  const FR2 = await T(() => {
    const t = SKV3._t, g = t.G();
    return { do: g.me._doing, doing: g.me.doing, rv: g.me._rv ? g.me._rv.i : null,
      sab: !!g.sabPick, msg: g.msg };
  });
  ok(FR2.do === 'revive' && FR2.rv === FR.v && !FR2.sab && FR2.doing > 4,
    '异形按 F 进入施救，不再与破坏面板耦合');
  ok(FR2.msg.indexOf('施救') >= 0, '施救提示明确');

  section('机器人可被攻击 · 保安反击拘留');
  await fresh(false);
  const BMED = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true; g.secbotUsed = true;
    const med = t.setBot('medbot', 52, 84.9);
    t.tp(0, med[0] + 2, med[1]);
    g.me.bullet = 1; g.aimX = med[0]; g.aimY = med[1];
    t.shoot();
    return { dead: t.robots().med.dead, hp: t.robots().med.hp,
      bullet: g.me.bullet, msg: g.msg, inv: t.inv() };
  });
  ok(BMED.dead && BMED.hp === 0 && BMED.bullet === 0,
    '玩家开枪可以摧毁医疗无人机（子弹 -1）');
  ok(BMED.inv && BMED.inv.fails.length === 0, '摧毁医疗无人机后不变量全过');

  /* 无人机是实体目标：出刀同样能摧毁（医疗装甲 HP 1，一刀拆掉），并留下刀者红身与危险行为 */
  await fresh(false);
  const BMEDK = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true; g.secbotUsed = true;
    /* 降级一名 AI 异形再让 0 号变异形：维持 15 席 / 4 异形的不变量 */
    const demoted = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    if (demoted) demoted.alien = false;
    g.me.alien = true; g.me.knife = 1;
    const med = t.setBot('medbot', 52, 84.9);
    t.tp(0, med[0] + 1.0, med[1]);
    t.attack();
    return { dead: t.robots().med.dead, hp: t.robots().med.hp, knife: g.me.knife,
      red: g.me.redT, crime: g.pendingCrime, msg: g.msg, inv: t.inv() };
  });
  ok(BMEDK.dead && BMEDK.hp === 0 && BMEDK.knife === 0,
    '异形出刀可以砍毁医疗无人机（刀数 -1 / 装甲 HP 1）');
  ok(BMEDK.red > 0 && BMEDK.crime === 0, '砍无人机留红身与危险行为记录（保安可据此拘留）');
  ok(BMEDK.inv && BMEDK.inv.fails.length === 0, '刀砍无人机后不变量全过' +
    (BMEDK.inv && BMEDK.inv.fails.length ? '（失败项：' +
      BMEDK.inv.fails.slice(0, 4).map(f => f.code + ':' + f.msg).join(' | ') + '）' : ''));

  await fresh(false);
  const BSEC = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true; g.secbotUsed = true;
    const sec = t.setBot('secbot', 80, 75, 0);
    const sb = g.bots.secbot; if (sb) { sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; }
    let p = [sec[0] + 1.2, sec[1]];
    for (let r = 0.8; r <= 1.6; r += 0.1)
      for (let i = 0; i < 20; i++) {
        const a = i / 20 * Math.PI * 2, x = sec[0] + Math.cos(a) * r, y = sec[1] + Math.sin(a) * r;
        if (t.free(x, y)) { p = [x, y]; r = 99; break; }
      }
    t.tp(0, p[0], p[1]);
    g.me.bullet = 1; g.aimX = sec[0]; g.aimY = sec[1];
    t.shoot();
    const hp1 = t.robots().sec.hp;
    g.me.bullet = 1; t.shoot();
    return { hp1, dead: t.robots().sec.dead, hp2: t.robots().sec.hp,
      bullet: g.me.bullet, inv: t.inv() };
  });
  ok(BSEC.hp1 === 1 && BSEC.dead && BSEC.hp2 === 0 && BSEC.bullet === 0,
    '保安机器人装甲 2 点：两枪摧毁');
  ok(BSEC.inv && BSEC.inv.fails.length === 0, '摧毁保安机器人后不变量全过');
  await fresh(false);
  const BSHOOTBOT = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true;
    const sec = t.setBot('secbot', 80, 75, 0);
    const sb = g.bots.secbot; if (sb) { sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = 0; }
    let p = [80.8, 75];
    for (let r = 0.4; r <= 1.4; r += 0.1)
      for (let i = 0; i < 20; i++) {
        const a = i / 20 * Math.PI * 2, x = 80 + Math.cos(a) * r, y = 75 + Math.sin(a) * r;
        if (t.free(x, y)) { p = [x, y]; r = 99; break; }
      }
    t.tp(0, p[0], p[1]);
    g.me.bullet = 1; g.aimX = sec[0]; g.aimY = sec[1];
    t.shoot();
    const hp = t.robots().sec.hp, pending = g.pendingCrime;
    t.botTick(0.2); t.botTick(0.2);
    return { hp, pending, detained: g.me.detained, uses: t.robots().sec.uses,
      bullet: g.me.bullet, inv: t.inv() };
  });
  ok(BSHOOTBOT.hp === 1 && BSHOOTBOT.pending === 0 && BSHOOTBOT.bullet === 0,
    '枪击保安机器人：装甲 -1、留下危险行为记录');
  ok(BSHOOTBOT.detained && BSHOOTBOT.uses === 1,
    '保安机器人会拘留开枪攻击自己的人');
  ok(BSHOOTBOT.inv && BSHOOTBOT.inv.fails.length === 0, '枪击保安后不变量全过');

  await fresh(false);
  const BK = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true;
    const demoted = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    if (demoted) demoted.alien = false;
    g.me.alien = true; g.me.knife = 1; g.secbotUsed = false;
    const sec = t.setBot('secbot', 80, 75, 0);
    const sb = g.bots.secbot; if (sb) { sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = 0; }
    let p = [sec[0], sec[1] + 1.1];
    for (let r = 0.8; r <= 1.35; r += 0.1)
      for (let i = 0; i < 20; i++) {
        const a = i / 20 * Math.PI * 2, x = sec[0] + Math.cos(a) * r, y = sec[1] + Math.sin(a) * r;
        if (t.free(x, y)) { p = [x, y]; r = 99; break; }
      }
    t.tp(0, p[0], p[1]);
    const atk = t.attack();
    const hp = t.robots().sec.hp, pend = g.pendingCrime;
    t.botTick(0.2); t.botTick(0.2);
    return { hp, pend, knife: atk.knife, detained: g.me.detained,
      used: t.robots().sec.used, p, sec, inv: t.inv() };
  });
  ok(BK.hp === 1 && BK.pend === 0 && BK.knife === 0,
    '玩家出刀攻击保安机器人：装甲 -1、消耗刀');
  ok(BK.detained && BK.used, '保安机器人被袭击后转身拘留袭击者');
  ok(BK.inv && BK.inv.fails.length === 0, '机器人反击拘留后不变量全过');

  await fresh(false);
  const BDEV = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true; t.setDev(true);
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const sec = t.setBot('secbot', 80, 75, 0);
    const sb = g.bots.secbot; if (sb) { sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = 0; }
    t.tp(k.i, 80.8,75);
    k.knife = 1;
    t.knife(k.i, 0);                 // DEV 免伤：不产生濒死
    const pending = g.pendingCrime;
    t.botTick(0.2); t.botTick(0.2);
    return { pending, downed: g.me.downed, detained: g.agents[k.i].detained,
      uses: t.robots().sec.uses, inv: t.inv() };
  });
  ok(BDEV.pending != null, 'DEV 免伤的攻击仍写入危险行为');
  ok(!BDEV.downed && BDEV.detained && BDEV.uses === 1,
    '未造成濒死的出刀也会被保安机器人擒拿');
  ok(BDEV.inv && BDEV.inv.fails.length === 0, '未致濒死拘留后不变量全过');

  await fresh(false);
  const BL2 = await T(() => ({
    label: SKV3._t.botLabel('secbot'), left: SKV3._t.robots().sec.left,
    med: SKV3._t.botLabel('medbot')
  }));
  ok(BL2.left === 2 && /拘留 0\/2/.test(BL2.label) && !/\/3/.test(BL2.label) &&
    /电量 2\/2/.test(BL2.med),
    '机器人标签与上限同源：保安「' + BL2.label + '」/ 医疗「' + BL2.med + '」');
  const BCAP = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true;
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const sec = t.setBot('secbot', 80, 75, 0);
    const sb = g.bots.secbot; if (sb) { sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = 0; }
    t.tp(h.i, 80.8,75);
    g.secbotUsed = true; g.secbotUses = 2; g.pendingCrime = h.i;   /* 上限已用满 */
    t.botTick(0.2);
    return { detained: t.detained(), uses: t.robots().sec.uses,
      left: t.robots().sec.left, label: t.botLabel('secbot'), inv: t.inv() };
  });
  ok(BCAP.detained.length === 0 && BCAP.uses === 2 && BCAP.left === 0 &&
    /拘留 2\/2/.test(BCAP.label),
    '保安机器人每夜最多擒拿 2 人：第 3 次不再触发（标签 ' + BCAP.label + '）');
  ok(BCAP.inv && BCAP.inv.fails.length === 0, '擒拿上限后不变量全过');

  await fresh(false);
  const BSHOOT = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true;
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && !a.downed);
    const sec = t.setBot('secbot', 80, 75, 0);
    const sb = g.bots.secbot; if (sb) { sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = 0; }
    let p = [80.8, 75];
    for (let r = 0.4; r <= 1.4; r += 0.1)
      for (let i = 0; i < 20; i++) {
        const a = i / 20 * Math.PI * 2, x = 80 + Math.cos(a) * r, y = 75 + Math.sin(a) * r;
        if (t.free(x, y)) { p = [x, y]; r = 99; break; }
      }
    t.tp(0, p[0], p[1]);
    let vp = [80.4, 76.3];
    for (let r = 0.2; r <= 1.2; r += 0.1)
      for (let i = 0; i < 20; i++) {
        const a = i / 20 * Math.PI * 2, x = 80.4 + Math.cos(a) * r, y = 76.3 + Math.sin(a) * r;
        if (t.free(x, y)) { vp = [x, y]; r = 99; break; }
      }
    t.tp(v.i, vp[0], vp[1]);
    g.me.bullet = 1; g.aimX = vp[0]; g.aimY = vp[1];
    t.shoot();
    t.botTick(0.2); t.botTick(0.2);
    return { v: v.i, downed: g.agents[v.i].downed, detained: g.me.detained,
      uses: t.robots().sec.uses, inv: t.inv() };
  });
  ok(BSHOOT.downed && BSHOOT.detained && BSHOOT.uses === 1,
    '玩家开枪后即使目标已经濒死，保安也会拘留开枪者');
  ok(BSHOOT.inv && BSHOOT.inv.fails.length === 0, '开枪拘留后不变量全过');

  section('医疗无人机 · 悬停医疗间中央 / 飞向伤员近身施救');
  await fresh(false);
  const MB0 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const home = t.medbotHome();
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    /* 伤员放在离坞位最远的医疗间角落：旧实现是「6 格圆内隔空读条」，
       现在是「房间内就飞过去」，所以最远角落也必须能救到 */
    let p = [55, 85.6], bd = -1;
    for (let y = 78.8; y <= 89.4; y += 0.3)
      for (let x = 46.8; x <= 63.4; x += 0.3) {
        if (!t.free(x, y)) continue;
        const d = Math.hypot(x - home[0], y - home[1]);
        if (d > bd) { bd = d; p = [+x.toFixed(2), +y.toFixed(2)]; }
      }
    t.tp(v.i, p[0], p[1]);
    v.downed = true; v.downAt = g.t; v.path = null; v.doing = 0; v._doing = null;
    const start = t.bots().medbot;
    const d0 = Math.hypot(start.x - v.x, start.y - v.y);
    let touchAt = -1, healedAt = -1, b = null;
    for (let i = 0; i < 140; i++) {
      b = t.botTick(0.1);
      const bot = t.bots().medbot;
      if (touchAt < 0 && bot.healing) touchAt = i;
      if (!t.state()[v.i].downed) { healedAt = i; break; }
    }
    const end = t.bots().medbot;
    return { v: v.i, p, home, d0: +d0.toFixed(2), touchAt, healedAt,
      endDist: +Math.hypot(end.x - v.x, end.y - v.y).toFixed(2),
      b, st: t.state()[v.i], fx: t.fx(), msg: g.msg, inv: t.inv(),
      room: t.state()[v.i].room, heal: t.robots().med.heal };
  });
  ok(MB0.room === 'med' && !MB0.st.downed,
    '医疗间角落的濒死者被救起（离坞位 ' + MB0.d0 + ' 格 → 无人机飞过去）');
  ok(MB0.touchAt >= 0 && MB0.endDist <= 1.4,
    '无人机先飞到伤员身边才开始治疗（末帧距离 ' + MB0.endDist + ' 格）');
  /* 3 秒 = 30 帧（dt=0.1）；允许 ±3 帧的采样误差 */
  const healFrames = MB0.healedAt - MB0.touchAt;
  ok(MB0.touchAt >= 0 && healFrames >= 27 && healFrames <= 33,
    '近身治疗满 ' + MB0.heal + ' 秒才拉起（实测 ' + (healFrames / 10).toFixed(1) + ' 秒）');
  ok(MB0.b.med === true && MB0.fx.includes('healBeam') && MB0.fx.includes('heal'),
    '施救特效：治疗光束 + 治疗环');
  ok(String(MB0.msg || '').indexOf('医疗无人机') < 0,
    '救治不对外播报（聊天栏与提示都不出现「谁被无人机救起」）');
  ok(MB0.inv && MB0.inv.fails.length === 0, '施救后不变量全过');

  /* 覆盖范围：无人机覆盖整间医疗间（不再有 6 格圆），走廊里的濒死者不响应 */
  await fresh(false);
  const MBR = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const home = t.medbotHome();
    let far = [55, 85.6], bd = -1;
    for (let y = 78.8; y <= 89.4; y += 0.3)
      for (let x = 46.8; x <= 63.4; x += 0.3) {
        if (!t.free(x, y)) continue;
        const d = Math.hypot(x - home[0], y - home[1]);
        if (d > bd) { bd = d; far = [x, y]; }
      }
    /* 走廊（医疗间外）找一个可站立点：c7 走廊在医疗间正上方 */
    const outside = (() => {
      for (let y = 70; y <= 77; y += 0.25)
        for (let x = 55; x <= 61; x += 0.25)
          if (t.free(x, y)) return [x, y];
      return [58, 70];
    })();
    const put = (p) => {
      g.medbotT = 0; g.medbotTarget = null; g.medbotLeft = 1; g.medbotDead = false;
      t.setBot('medbot', home[0], home[1]);
      t.tp(v.i, p[0], p[1]);
      v.downed = true; v.downAt = g.t; v.path = null; v.doing = 0; v._doing = null;
    };
    put(far);
    let inFrames = 0;
    for (let i = 0; i < 120; i++) { inFrames++; t.botTick(0.1); if (!t.state()[v.i].downed) break; }
    const inRoom = { frames: inFrames, downed: t.state()[v.i].downed, room: t.state()[v.i].room };
    put(outside);
    for (let i = 0; i < 60; i++) t.botTick(0.1);
    const outRoom = { downed: t.state()[v.i].downed, room: t.state()[v.i].room,
      t: +(g.medbotT || 0).toFixed(2) };
    return { R: t.medbotR(), far, outside, dist: +bd.toFixed(2), inRoom, outRoom,
      inv: t.inv(), heal: t.robots().med.heal, touch: t.robots().med.touch };
  });
  ok(MBR.R >= 11, '医疗无人机覆盖整间医疗间（覆盖半径读数 ' + MBR.R + ' 格）');
  ok(MBR.inRoom.room === 'med' && MBR.inRoom.downed === false,
    '离坞位 ' + MBR.dist + ' 格的医疗间角落也能救起');
  ok(MBR.outRoom.downed === true && MBR.outRoom.t === 0,
    '医疗间外的濒死者不施救（当前 ' + MBR.outRoom.room + '）');
  ok(MBR.heal === 3 && MBR.touch > 0.8 && MBR.touch < 1.6,
    '近身治疗 ' + MBR.heal + ' 秒 · 悬停距离 ' + MBR.touch + ' 格');
  ok(MBR.inv && MBR.inv.fails.length === 0, '施救覆盖测试后不变量全过');

  await fresh(false);
  const MB1 = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true;
    t.setBot('medbot', 52, 84.9);
    const freeNear = (x, y) => {
      for (let r = 0.4; r <= 2.4; r += 0.2)
        for (let i = 0; i < 20; i++) {
          const a = i / 20 * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
          if (t.free(px, py)) return [px, py];
        }
      return [x, y];
    };
    const vs = g.agents.filter(a => !a.alien && a.i !== 0 && a.alive && !a.downed).slice(0, 3);
    const ps = vs.map((a, n) => { const p = freeNear(49.6 + n * 1.6, 85.4); t.tp(a.i, p[0], p[1]); return p; });
    for (const v of vs) { v.downed = true; v.downAt = g.t; v.path = null; }
    /* 巡逻线是 9 个点的大环，5 秒里机器人会走开；每步钉在**当前仍在场的伤员**身上，
       测的才是“电量 2 次”这件事，而不是“巡逻恰好路过几个人”。 */
    const run5 = () => { let r = null;
      for (let i = 0; i < 21; i++) {
        const live = vs.find(v => v.downed) || vs[0];
        t.setBot('medbot', live.x, live.y); r = t.botTick(0.25);
      }
      return r; };
    const b1 = run5();
    const b2 = run5();
    const b3 = run5();
    return { vs: vs.map(v => v.i), ps, b1, b2, b3, left: t.robots().med.left,
      used: t.robots().med.used, downed: vs.map(v => v.downed), inv: t.inv() };
  });
  ok(MB1.b1.medLeft === 1 && MB1.b2.medLeft === 0 && MB1.b3.medLeft === 0 && MB1.used,
    '医疗无人机每夜救 2 人（第二次施救后电量 0）');
  ok(MB1.downed[0] === false && MB1.downed[1] === false && MB1.downed[2] === true &&
    MB1.left === 0,
    '电量耗尽后第三名濒死者不会被继续施救');
  ok(MB1.inv && MB1.inv.fails.length === 0, '两次施救后不变量全过');
  await T(() => {
    const t = SKV3._t, g = t.G();
    g.fx.forEach(f => { f.dur = Math.max(6, f.dur); f.t = f.dur * 0.4; });
    t.tp(0, 53.2,82.6);
  });
  await page.waitForTimeout(140);
  await shot('45_医疗无人机施救.png');

  section('AI 异形 · 拉闸 / 停摆机器人 / 破坏舱室 / 钻管道');
  await fresh(false);
  const AIK0 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const freeNear = (x, y, minD, maxD) => {
      for (let r = minD; r <= maxD; r += 0.2)
        for (let i = 0; i < 24; i++) {
          const a = i / 24 * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
          if (t.free(px, py)) return [px, py];
        }
      return [x, y];
    };
    for (const h of g.agents) if (!h.alien && h.alive) t.tp(h.i, 30,32);
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a.alien && a !== k) a.sabUsed = true;
    g.breakerSaboteur = k.i;
    const p = freeNear(50.8, 54.1, 2.2, 3.8);
    t.tp(k.i, p[0], p[1]);
    k._delay = 0; k._rest = 0; k.doing = 0; k._doing = null;
    k.sabUsed = false; k.knife = 1; k.path = null; k.target = null; k._pipeCD = 0;
    t.clearDrags(); t.resetAiState(k.i);
    const before = t.lights().state;
    const r = t.aiTickAlien(k.i, 120, 0.05);
    return { i: k.i, p, before, after: t.lights().state, sab: r.sab,
      fx: t.fx(), msg: g.msg, inv: t.inv() };
  });
  ok(AIK0.before !== 2 && AIK0.after === 2,
    'AI 异形走到电闸拉闸：真正断电（' + AIK0.before + '→' + AIK0.after + '）');
  ok(AIK0.sab && AIK0.fx.includes('power') && AIK0.msg.indexOf('电闸已拉下') >= 0,
    '拉闸反馈：全船断电 + 电闸特效 + 播报');
  ok(AIK0.inv && AIK0.inv.fails.length === 0, 'AI 拉闸后不变量全过');
  const AIK1 = await T(o => {
    const t = SKV3._t, g = t.G();
    t.breaker(); /* 先恢复照明，避免拉闸分支抢在停摆机器人前面 */
    const freeNear = (x, y, minD, maxD) => {
      for (let r = minD; r <= maxD; r += 0.2)
        for (let i = 0; i < 24; i++) {
          const a = i / 24 * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
          if (t.free(px, py)) return [px, py];
        }
      return [x, y];
    };
    const k = g.agents[o.i];
    g.breakerSaboteur = -1; /* 恢复照明后仍要单独验证“停摆机器人”分支 */
    for (const h of g.agents) if (!h.alien && h.alive) t.tp(h.i, 30,32);
    const sp = t.setBot('secbot', 80, 53);
    const p = freeNear(sp[0], sp[1], 2.4, 3.6);
    t.tp(k.i, p[0], p[1]);
    k.sabUsed = false; k.path = null; k.target = null; k.doing = 0; k._doing = null;
    t.clearDrags(); t.resetAiState(k.i); k.sabUsed = false;
    k.knife = 0;   /* 本节只验"破坏技停摆机器人"：先把刀用完，才轮到每夜一次的破坏技 */
    /* 2026-10-31 起拆保安需要围攻前提：造 2 名已识别队友 + 一个 5 格外的共同目标 */
    const mates = g.agents.filter(a => a.alien && a !== k && a.alive).slice(0, 2);
    mates.forEach((m2, n) => { t.tp(m2.i, sp[0] + 3 + n, sp[1] + 1.2); k.mates[m2.i] = true; });
    const vic = g.agents.find(a => !a.alien && a.alive && a.i !== 0);
    const vp = freeNear(sp[0] + 6, sp[1] - 4, 0, 2);
    t.tp(vic.i, vp[0], vp[1]);
    const oldR = Math.random; Math.random = () => 0.1;
    const r = t.aiTickAlien(k.i, 100, 0.05);
    Math.random = oldR;
    return { p, sp, dead: t.robots().sec.dead, sab: r.sab, fx: t.fx(),
      knife: r.knife, hp: t.robots().sec.hp,
      prog: g.prog, inv: t.inv() };
  }, AIK0);
  ok(AIK1.dead && AIK1.sab, 'AI 异形刀用完后改用破坏技停摆保安机器人：当晚停摆');
  ok(AIK1.fx.includes('spark'), 'AI 停摆机器人留下火花特效');
  ok(AIK1.inv && AIK1.inv.fails.length === 0, 'AI 停摆机器人后不变量全过');
  const AIK2 = await T(o => {
    const t = SKV3._t, g = t.G();
    const freeNear = (x, y, minD, maxD) => {
      for (let r = minD; r <= maxD; r += 0.2)
        for (let i = 0; i < 24; i++) {
          const a = i / 24 * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
          if (t.free(px, py)) return [px, py];
        }
      return [x, y];
    };
    const k = g.agents[o.i];
    g.breakerSaboteur = -1; /* 单独验证“破坏舱室”，不让拉闸分支抢先 */
    for (const h of g.agents) if (!h.alien && h.alive) t.tp(h.i, 30,32);
    g.dmg = [];
    const sp = t.sabSpot('engine');
    const p = freeNear(sp.x, sp.y, 0.8, 1.6);
    t.tp(k.i, p[0], p[1]);
    k.sabUsed = false; k.path = null; k.target = null; k.doing = 0; k._doing = null;
    t.clearDrags(); t.resetAiState(k.i);
    k.sabRoom = 'engine'; k._delay = 0; k._pipeCD = 0; k.sabUsed = false;
    const first = t.aiTickAlien(k.i, 1, 0.05);
    const r = t.aiTickAlien(k.i, 30, 0.05);
    return { first, sp, dmg: t.dmg(), sab: r.sab, fx: t.fx(), msg: g.msg, inv: t.inv() };
  }, AIK0);
  ok(AIK2.dmg.length === 1 && AIK2.dmg[0].room === 'engine' &&
    Math.abs(AIK2.dmg[0].left - 30) < 0.01 && AIK2.sab,
    'AI 异形抵达引擎舱后损毁设备：30 秒故障倒计时，消耗本夜破坏技');
  ok(AIK2.dmg[0] && AIK2.dmg[0].label === AIK2.sp.label &&
    AIK2.fx.includes('spark') && AIK2.fx.includes('alarm') &&
    AIK2.msg.indexOf('被损毁') >= 0,
    '破坏落点是该舱室设备（带名字）：火花 + 警报特效 + 全船播报');
  ok(AIK2.inv && AIK2.inv.fails.length === 0, 'AI 破坏舱室后不变量全过');
  const AIK3 = await T(o => {
    const t = SKV3._t, g = t.G();
    for (const h of g.agents) if (!h.alien && h.alive) t.tp(h.i, 85,77);
    const k = g.agents[o.i];
    for (const a of g.agents) if (a.alien && a !== k) t.tp(a.i, 85,77);
    t.tp(k.i, 12.2,57.2);
    k.sabUsed = true; k.knife = 1; k.path = null; k.target = null;
    k.doing = 0; k._doing = null; k._pipeCD = 0;
    t.clearDrags(); t.resetAiState(k.i); k.sabUsed = true; k.knife = 1;
    const r = t.aiTickAlien(k.i, 1, 0.05);
    return { r, fx: t.fx(), pipe: t.pipes(), cd: k._pipeCD };
  }, AIK0);
  const armPipe = AIK3.pipe.find(p => p.name.indexOf('军械库') >= 0);
  ok(Math.abs(AIK3.r.x - armPipe.x) < 0.01 && Math.abs(AIK3.r.y - armPipe.y) < 0.01 &&
    AIK3.cd === 20, 'AI 异形钻管道：瞬移到离目标最近的出口（20s 冷却）');
  ok(AIK3.fx.includes('pipefx'), '钻管道留下管道口特效');

  /* AI 异形拆保安有前提（2026-10-31）：必须房间里认出 2 名以上队友 + 有共同捕杀目标，
     否则默认不碰保安（落单拆保安=白送 saw_bot 确证）。落单与组队两个分支都测。 */
  const AIKB0 = await T(() => {
    /* 夹具必须写在页面上下文里：page.evaluate 不能引用 Node 侧的函数 */
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k) { a.knife = 0; t.tp(a.i, 30,32); }
    g.breakerSaboteur = -1;
    t.clearDrags(); t.resetAiState(k.i);
    const sec = t.setBot('secbot', 80, 75, 0);
    const sb = g.bots.secbot; sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = Math.PI;
    let p = null;
    for (let r = 0.8; r <= 1.6 && !p; r += 0.1)
      for (let i = 0; i < 20 && !p; i++) {
        const a = i / 20 * Math.PI * 2, x = sec[0] + Math.cos(a) * r, y = sec[1] + Math.sin(a) * r;
        if (t.free(x, y)) p = [x, y];
      }
    t.tp(k.i, p[0], p[1]);
    k.knife = 1; k.sabUsed = false; k._delay = 0; k.doing = 0; k._doing = null;
    k.path = null; k.target = null;
    const before = { hp: t.robots().sec.hp, dead: t.robots().sec.dead };
    const r1 = t.aiTickAlien(k.i, 3, 0.05);
    return { before, knife: r1.knife, sab: r1.sab, hp: t.robots().sec.hp,
      dead: t.robots().sec.dead };
  });
  ok(AIKB0.before.hp === 2 && AIKB0.knife === 1 && AIKB0.hp === 2 && !AIKB0.dead,
    '落单异形默认不攻击保安（刀数保留 / 保安装甲完好）');

  const AIKB = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k) { a.knife = 0; t.tp(a.i, 30,32); }
    g.breakerSaboteur = -1;
    t.clearDrags(); t.resetAiState(k.i);
    const sec = t.setBot('secbot', 80, 75, 0);
    const sb = g.bots.secbot; sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = Math.PI;
    let ppt = null;
    for (let r = 0.8; r <= 1.6 && !ppt; r += 0.1)
      for (let i = 0; i < 20 && !ppt; i++) {
        const a = i / 20 * Math.PI * 2, x = sec[0] + Math.cos(a) * r, y = sec[1] + Math.sin(a) * r;
        if (t.free(x, y)) ppt = [x, y];
      }
    t.tp(k.i, ppt[0], ppt[1]);
    k.knife = 1; k.sabUsed = false; k._delay = 0; k.doing = 0; k._doing = null;
    k.path = null; k.target = null;
    /* 造出「房间里认出 2 名队友 + 一个共同捕杀目标」的围攻局面 */
    const mates = g.agents.filter(a => a.alien && a !== k && a.alive).slice(0, 2);
    mates.forEach((m2, n) => {
      t.tp(m2.i, sec[0] + 3 + n, sec[1] + n * 0.8);
      k.mates[m2.i] = true;
    });
    /* 共同目标必须离异形本体 >5 格（否则 AI 会优先追人、轮不到机器人分支），
       同时仍在保安 8 格内 */
    const vic = g.agents.find(a => !a.alien && a.alive && a.i !== 0);
    t.tp(vic.i, sec[0] + 6, sec[1] - 4.5);
    const before = { knife: k.knife, sab: k.sabUsed, hp: t.robots().sec.hp, dead: t.robots().sec.dead };
    /* 围攻意愿是 70% 概率：这里固定随机数，避免门禁随机飘 */
    const oldR = Math.random; Math.random = () => 0.1;
    const r1 = t.aiTickAlien(k.i, 3, 0.05);
    Math.random = oldR;
    const after = { knife: r1.knife, sab: r1.sab, hp: t.robots().sec.hp, dead: t.robots().sec.dead,
      red: k.redT, acts: t.acts(), crime: g.pendingCrime };
    return { before, after, k: k.i, mates: mates.length, inv: t.inv() };
  });
  ok(AIKB.before.hp === 2 && AIKB.after.knife === 0,
    '组队围攻时 AI 异形才对保安出刀：消耗刀数（不再是白得的停摆）');
  ok(AIKB.after.hp === 1 && !AIKB.after.dead && AIKB.after.sab === false,
    'AI 出刀按装甲 HP 结算：保安 2 点装甲只掉到 1，没被一刀拆死，也没偷用破坏技');
  ok(AIKB.after.red >= 2.5 && AIKB.after.acts.includes('stab'),
    'AI 对机器人出刀同样留下挥砍动作与 3 秒刀者红身');
  ok(AIKB.after.crime === AIKB.k && AIKB.inv.fails.length === 0,
    'AI 砍机器人同样登记危险行为（保安可反制），不变量全过');

  section('管道权限 · 人类不可用');
  await fresh(false);
  const HP = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const pipe = t.pipes()[1];
    t.tp(0, pipe.x, pipe.y);
    const opened = t.openPipe();
    const msg1 = g.msg;
    const menu = t.pipe();
    const pos0 = t.pos();
    t.interact();
    return { opened, menu, msg1, pos0, pos1: t.pos(), msg2: g.msg, inv: t.inv() };
  });
  ok(!HP.opened && !HP.menu.open, '人类站在管道口：地道不可用');
  ok(HP.pos0[0] === HP.pos1[0] && HP.pos0[1] === HP.pos1[1], '人类不会因管道交互被传送');
  ok(HP.inv && HP.inv.fails.length === 0, '人类尝试管道后不变量全过');

  section('AI 人类 · 开枪 / 救人 / 补给');
  await fresh(false);
  const AHC0 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive && !a.downed);
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    t.tp(h.i, 56, 85); t.tp(k.i, 57.2, 85);
    h.bullet = 1; h.medkit = 0; h.suspect = k.i;
    h.doing = 0; h._doing = null; h.path = null; h._delay = 0; h._rest = 0;
    const r = t.aiTick(h.i, 1, 0.05);
    return { k: k.i, h: h.i, downed: g.agents[k.i].downed, rest: g.agents[h.i]._rest,
      bullet: r.bullet, crime: g.pendingCrime, suspect: g.agents[h.i].suspect,
      fx: t.fx(), inv: t.inv() };
  });
  ok(AHC0.downed && AHC0.bullet === 0 && AHC0.rest > 0,
    'AI 人类对目击凶手开枪：命中濒死 + 消耗子弹 + 进入冷却');
  ok(AHC0.crime === AHC0.h && AHC0.fx.includes('tracer') && AHC0.fx.includes('blood'),
    'AI 开枪同样留犯罪记录 + 完整弹道/血雾特效');
  ok(AHC0.inv && AHC0.inv.fails.length === 0, 'AI 开枪后不变量全过');
  await fresh(false);
  const AIDARK = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true;
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && !a.downed);
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive && !a.downed);
    for (const a of g.agents) if (a !== h && a !== k) t.tp(a.i, 30,32);
    t.tp(h.i, 56, 85); t.tp(k.i, 62, 85);
    h.bullet = 1; h.suspect = k.i; h.medkit = 0;
    h.doing = 0; h._doing = null; h.path = null; h._delay = 0; h._rest = 0;
    t.breaker(); /* 全船断电：医疗间也变暗，AI 只剩近身视野 */
    const r = t.aiTick(h.i, 1, 0.05);
    return { h: h.i, k: k.i, bullet: r.bullet, downed: g.agents[k.i].downed,
      light: t.lights().state };
  });
  ok(AIDARK.light === 2 && AIDARK.bullet === 1 && !AIDARK.downed,
    'AI 人类在黑暗中只有近身视野：不隔空开枪（子弹保留）');
  await fresh(false);
  const AHH = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true;
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && !a.downed);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && !a.downed && a !== h);
    t.tp(h.i, 56, 85); t.tp(v.i, 57.2, 85);
    h.bullet = 1; h.suspect = v.i; h.medkit = 0;
    h.doing = 0; h._doing = null; h.path = null; h._delay = 0; h._rest = 0;
    const r = t.aiTick(h.i, 1, 0.05);
    return { h: h.i, v: v.i, bullet: r.bullet, downed: g.agents[v.i].downed, inv: t.inv() };
  });
  ok(AHH.downed && AHH.bullet === 0 && AHH.inv && AHH.inv.fails.length === 0,
    'AI 人类有证据时也会对人类开枪（不按阵营豁免）');

  await fresh(true);
  const ADV = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true;
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && !a.downed);
    t.tp(0, 57.2,85); t.tp(h.i, 56, 85);
    h.bullet = 1; h.suspect = 0;
    h.doing = 0; h._doing = null; h.path = null; h._delay = 0; h._rest = 0;
    const r = t.aiTick(h.i, 1, 0.05);
    return { bullet: r.bullet, downed: g.me.downed, dev: g.dev, inv: t.inv() };
  });
  ok(ADV.dev && !ADV.downed && ADV.bullet === 0,
    'DEV 免伤仍消耗 AI 子弹（不再出现无限连射）');

  await fresh(false);
  const AHC1 = await T(() => {
    const t = SKV3._t, g = t.G();
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && !a.downed);
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== v);
    t.tp(h.i, 56, 85); t.tp(v.i, 57.2, 85);
    v.downed = true; v.downAt = g.t; v.path = null; v.doing = 0; v._doing = null;
    h.medkit = 1; h.bullet = 0; h.suspect = null;
    h.doing = 0; h._doing = null; h.path = null; h._delay = 0; h._rest = 0;
    const first = t.aiTick(h.i, 1, 0.05);
    const r = t.aiTick(h.i, 110, 0.05);
    return { v: v.i, h: h.i, first, downed: g.agents[v.i].downed,
      med: r.medkit, fx: t.fx(), inv: t.inv() };
  });
  ok(AHC1.first.do === 'revive' && !AHC1.downed && AHC1.med === 0,
    'AI 人类用医疗包救起身边濒死者（医疗包 -1）');
  ok(AHC1.fx.includes('heal'), 'AI 施救留下治疗环特效');
  ok(AHC1.inv && AHC1.inv.fails.length === 0, 'AI 施救后不变量全过');
  const AHC2 = await T(() => {
    const t = SKV3._t, g = t.G();
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const sp = t.supplies().find(s => s.item === 'ammo');
    t.tp(h.i, sp.x, sp.y);
    h.bullet = 0; h.qual = 1; h.suspect = null; h.medkit = 0;
    h.doing = 0; h._doing = null; h.path = null; h._delay = 0; h._rest = 0;
    const first = t.aiTick(h.i, 1, 0.05);
    const r = t.aiTick(h.i, 210, 0.05);
    return { h: h.i, first, bullet: r.bullet, qual: r.qual, sp,
      fx: t.fx(), inv: t.inv() };
  });
  ok(AHC2.first.do === 'ammo' && AHC2.bullet === 1 && AHC2.qual === 0,
    'AI 人类在军械补给点消耗申请单换子弹（10s，子弹 +1 / 申请单 -1）');
  ok(AHC2.fx.includes('pickup'), 'AI 领取补给留下拾取光柱');
  ok(AHC2.inv && AHC2.inv.fails.length === 0, 'AI 领取补给后不变量全过');
  await fresh(false);
  const AIAMMO = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true; g.secbotUsed = true;
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && !a.downed);
    const sp = t.supplies().find(s => s.item === 'ammo');
    t.tp(h.i, sp.x, sp.y);
    /* 锁成激进型（shootSus 0.36）：2026-10-31 起开枪门槛随性格，
       不锁的话谨慎 h 可能整段不开枪，"开枪后归零"断言就随机飘。 */
    h.trait = { aggr: 72, caut: 28, soc: 50, cur: 50 };
    h.bullet = 0; h.qual = 1; h.suspect = null; h.medkit = 0;
    h.doing = 0; h._doing = null; h.path = null; h._delay = 0; h._rest = 0;
    const a1 = t.aiTick(h.i, 210, 0.05);
    /* 2026-10-31 起「任务全做完」的 AI 会走 aiIdleRoam 巡舱——210 秒后 h 可能
       已经飘到别的舱室/掩体背后，玩家贴过去也未必可见。先把 h 拉回补给点再验开枪。 */
    t.tp(h.i, sp.x, sp.y);
    t.tp(0, h.x + 1, h.y);
    h.suspect = 0; h.doing = 0; h._doing = null; h.path = null;
    const a2 = t.aiTick(h.i, 1, 0.05);
    const a3 = t.aiTick(h.i, 210, 0.05);
    return { afterBuy: { bullet: a1.bullet, qual: a1.qual },
      afterShot: { bullet: a2.bullet, qual: a2.qual, playerDown: g.me.downed },
      afterWait: { bullet: a3.bullet, qual: a3.qual } };
  });
  ok(AIAMMO.afterBuy.bullet === 1 && AIAMMO.afterBuy.qual === 0,
    'AI 领取子弹：子弹 +1、申请单 -1');
  ok(AIAMMO.afterShot.bullet === 0 && AIAMMO.afterShot.qual === 0 &&
    AIAMMO.afterWait.bullet === 0,
    'AI 子弹有限：开枪后归零，不会凭申请单无限补弹'
    + '（买后 弹' + AIAMMO.afterBuy.bullet + '/单' + AIAMMO.afterBuy.qual
    + ' · 打后 弹' + AIAMMO.afterShot.bullet + '/单' + AIAMMO.afterShot.qual
    + ' · 等待后 弹' + AIAMMO.afterWait.bullet + '/单' + AIAMMO.afterWait.qual + '）');
  await fresh(false);  /* AIAMMO 把 0 号 tp 到过巡舱后的 h 旁边（可能不可走），重开局再测领取 */
  const AIQ = await T(() => {
    const t = SKV3._t, g = t.G();
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    h.qualPending = 1; h.qual = 0; h.medkit = 0; h.bullet = 0; h.suspect = null;
    h.doing = 0; h._doing = null; h._rest = 0; h._delay = 0; h.path = null;
    const q = t.qualDesk();
    t.tp(h.i, q.x, q.y);
    const first = t.aiTick(h.i, 1, 0.05);
    return { first, q, inv: t.inv() };
  });
  ok(AIQ.first.do === 'qual' && AIQ.first.qualPending === 1,
    'AI 人类同样必须回中央会议室圆桌领取物资申请单');
  ok(AIQ.inv && AIQ.inv.fails.length === 0, 'AI 领取申请单状态不变量全过' +
    (AIQ.inv && AIQ.inv.fails.length ? '（失败项：' +
      AIQ.inv.fails.slice(0, 4).map(f => f.code + ':' + f.msg).join(' | ') + '）' : ''));
  /* 真实节奏：先做任务到 3 分，再自己走回圆桌领取；不是把 qualPending 预先塞进去 */
  const AIQN = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true; g.dmg = [];
    g.secbotDead = true; g.medbotDead = true;
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== h) t.tp(a.i, 30, 54);
    h._delay = 0; h._rest = 0; h.doing = 0; h._doing = null; h.path = null;
    h.progress = 2; h.tIdx = 0; h._q3 = false; h._q5 = false; h.qualPending = 0; h.qual = 0;
    const spot = t.taskSpot(h.i);
    t.tp(h.i, spot.x, spot.y);
    t.aiTick(h.i, 4500, 0.05);
    const evs = t.events().filter(e => e.kind === 'qual' && e.actor === h.i);
    return { progress: h.progress, qp: h.qualPending, qual: h.qual, do: h._doing,
      spot, claims: evs.length, inv: t.inv() };
  });
  ok(AIQN.progress >= 3 && AIQN.qp === 0 && AIQN.qual >= 1 && AIQN.claims >= 1,
    'AI 人类完成 3 分后会自己回圆桌领取申请单（progress=' + AIQN.progress +
    ' / 待领 ' + AIQN.qp + ' / 申请单 ' + AIQN.qual + '）');
  ok(AIQN.inv && AIQN.inv.fails.length === 0, 'AI 自然领取申请单后不变量全过');

  section('AI 拖拽 · 濒死者送医疗间复活');
  await fresh(false);
  const ADR = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true; g.dmg = [];
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== v);
    for (const a of g.agents) if (a !== k && a !== v && a !== h) t.tp(a.i, 30,32);
    t.clearDrags();
    [k, v, h].forEach(a => {
      t.resetAiState(a.i);
      a._delay = 0; a._rest = 0; a.knife = 0; a.bullet = 0; a.medkit = 0;
      a.qual = 0; a.qualPending = 0; a.suspect = null; a.tIdx = a.tasks.length;
    });
    k.knife = 1;
    t.tp(v.i, 58,63); t.tp(h.i, 58.4,62.4);
    t.knife(k.i, v.i);
    k.knife = 0;
    const first = t.aiTick(h.i, 2, 0.05);
    return { k: k.i, v: v.i, h: h.i, drag: first.drag,
      draggedBy: g.agents[v.i].draggedBy, inv: t.inv(), med: t.robots().med.left };
  });
  ok(ADR.drag === ADR.v && ADR.draggedBy === ADR.h,
    'AI 人类没有医疗包时把濒死者拖起来（双向标记互指）');
  ok(ADR.inv.fails.length === 0, 'AI 拖拽起始不变量全过');
  const ADR2 = await T(o => {
    const t = SKV3._t, g = t.G();
    let last = null;
    for (let i = 0; i < 900; i++) {
      last = t.aiTick(o.h, 1, 0.05);
      if (last.drag === null && i > 4) break;
    }
    return { drag: last.drag, draggedBy: g.agents[o.v].draggedBy,
      room: t.state()[o.v].room, moved: t.bodyInfo(o.v).moved,
      pos: t.bodyOf(o.v), med: t.robots().med.left, inv: t.inv() };
  }, ADR);
  ok(ADR2.drag === null && ADR2.draggedBy === null, 'AI 把伤者拖进医疗间后松手');
  ok(ADR2.room === 'med', '伤者被拖进医疗间（当前 ' + ADR2.room + '）');
  ok(ADR2.moved === true, 'AI 拖拽同样留下 bodyMoved 痕迹（搜尸可读）');
  const ADR3 = await T(o => {
    const t = SKV3._t;
    const vv = t.G().agents[o.v];
    for (let i = 0; i < 40; i++) { t.setBot('medbot', vv.x, vv.y); t.botTick(0.2); }
    const st = t.state()[o.v];
    return { downed: st.downed, alive: st.alive, left: t.robots().med.left, inv: t.inv() };
  }, ADR);
  ok(ADR3.alive && !ADR3.downed, '医疗无人机把 AI 拖来的伤者救活');
  ok(ADR3.left === 1, '医疗无人机电量按次扣减（剩 ' + ADR3.left + '/2）');
  ok(ADR3.inv.fails.length === 0, 'AI 拖尸→医疗间复活链路不变量全过');

  section('AI 异形 · 藏尸');
  await fresh(false);
  const HID = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k && a !== v) t.tp(a.i, 30,32);
    t.clearDrags(); t.resetAiState(k.i);
    g.secbotDead = true;
    k.knife = 0; k.sabUsed = true; k._delay = 0; k._rest = 0;
    t.tp(v.i, 84,54); t.kill(v.i, 'knife');
    t.tp(k.i, 84.6,54.6);
    const b0 = t.bodyOf(v.i);
    let dragSeen = false, last = null;
    for (let i = 0; i < 900; i++) {
      last = t.aiTickAlien(k.i, 1, 0.05);
      if (last.drag === v.i) dragSeen = true;
      if (dragSeen && last.drag === null) break;
    }
    const b1 = t.bodyOf(v.i);
    const room = t.roomIdAt(b1[0], b1[1]);
    return { k: k.i, v: v.i, dragSeen, b0, b1,
      dist: Math.hypot(b1[0] - b0[0], b1[1] - b0[1]),
      hides: last.hides, draggedBy: t.state()[v.i].draggedBy,
      moved: t.bodyInfo(v.i).moved, room,
      spot: t.hideSpot(room), inv: t.inv() };
  });
  ok(HID.dragSeen, 'AI 异形会把尸体拖走藏起来（不必等玩家发现）');
  ok(HID.dist > 2 && HID.moved === true,
    '尸体被拖动 ' + HID.dist.toFixed(2) + ' 格并写入 bodyMoved');
  ok(HID.draggedBy === null && HID.hides === 1, '藏到角落后松手，本夜藏尸计数 +1');
  ok(HID.room !== 'med' && HID.room !== 'bridge' && HID.spot &&
    Math.hypot(HID.b1[0] - HID.spot[0], HID.b1[1] - HID.spot[1]) < 2.2,
    '藏尸点落在远离门与任务点的舱室角落（当前 ' + HID.room + '）');
  ok(HID.inv.fails.length === 0, 'AI 藏尸后不变量全过');

  await fresh(false);
  const HIDFAR = await T(() => {
    const t = SKV3._t; t.newGame();
    const rooms = t.rooms();
    const med = rooms.find(r => r.id === 'med');
    const cands = rooms.filter(r => r.id !== 'med' && r.id !== 'bridge');
    const dist = (r) => Math.hypot(r.x - med.x, r.y - med.y);
    const near = cands.slice().sort((a, b) => dist(a) - dist(b))[0];
    const dest = t.hideRoomFor(near.id, near.x, near.y);
    const d = rooms.find(r => r.id === dest);
    return { med: med.id, near: near.id, dest, nearD: dist(near),
      destD: d ? dist(d) : -1 };
  });
  ok(HIDFAR.dest !== 'med' && HIDFAR.destD > HIDFAR.nearD,
    '藏尸目的地优先远离医疗间：从 ' + HIDFAR.near + ' 改拖到 ' + HIDFAR.dest +
    '（' + HIDFAR.nearD.toFixed(1) + ' → ' + HIDFAR.destD.toFixed(1) + ' 格）');

  section('AI 异形 · 避开保安扇形');
  await fresh(false);
  const SEC = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k && a !== v) t.tp(a.i, 30,32);
    t.clearDrags(); t.resetAiState(k.i);
    const sec = t.setBot('secbot', 66, 32, 0);
    const sb = g.bots.secbot; sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = 0;
    t.tp(k.i, 69,32); t.tp(v.i, 70,32);
    k.knife = 1; k.sabUsed = true; k._delay = 0; k._rest = 0;
    k._botCD = 999;              /* 本节只验"保安扇形回避"，机器人砍击另有 AIKB 用例 */
    const seen = t.secWouldSee(69, 32);
    const r1 = t.aiTickAlien(k.i, 20, 0.05);
    const blocked = { downed: t.state()[v.i].downed, avoid: r1.secAvoid, knife: k.knife };
    t.setBot('secbot', sec[0], sec[1], Math.PI);
    t.tp(k.i, 69,32); t.tp(v.i, 70,32);   /* 回避阶段可能走开：复位后再验补刀 */
    k._secAvoidT = 0; k.path = null; k.target = null;
    t.aiTickAlien(k.i, 40, 0.05);
    return { seen, blocked, after: { downed: t.state()[v.i].downed, knife: k.knife },
      detained: t.detained().length, inv: t.inv() };
  });
  ok(SEC.seen && !SEC.blocked.downed && SEC.blocked.avoid > 0 && SEC.blocked.knife === 1,
    '保安扇形正对时 AI 异形不出刀（宁可废刀也不进拘留区）');
  ok(SEC.after.downed && SEC.after.knife === 0,
    '保安转向背后后 AI 异形立刻补刀（同一判定，换个朝向就动手）');
  ok(SEC.detained === 0 && SEC.inv.fails.length === 0, '回避判定没有触发拘留，不变量全过');

  section('AI 异形 · 目击判定与队友配合');
  await fresh(false);
  const WIT = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const vs = g.agents.filter(a => !a.alien && a.i !== 0 && a.alive).slice(0, 4);
    const w1 = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && vs.indexOf(a) < 0);
    const w2 = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && vs.indexOf(a) < 0 && a !== w1);
    const keep = [k, w1, w2].concat(vs);
    for (const a of g.agents) if (keep.indexOf(a) < 0) t.tp(a.i, 30,54);
    g.secbotDead = true; g.medbotDead = true;
    t.clearDrags(); t.resetAiState(k.i);
    for (const a of keep) { a._delay = 0; a._rest = 0; a.path = null; a.target = null; }
    k.knife = 1; k.sabUsed = true;
    /* 固定成谨慎型（aggr=28 / caut=72）：本组断言测的是「目击者风险」的保守分支。
       2026-10-31 起出刀胆量随性格（knifeBold / knifeWatcherCap），
       不锁性格的话激进 AI 会在 2 个目击者面前照砍，测试就没法断言了。 */
    k.trait = { aggr: 28, caut: 72, soc: 50, cur: 50 };
    /* 引擎舱是暗舱：旁观者在 1~1.5 格内一定能看见 */
    const setup = (v, two) => {
      for (const u of vs) if (u !== v) t.tp(u.i, 30,54);
      t.tp(k.i, 8,53); t.tp(v.i, 9,53); t.tp(w1.i, 10,53);
      t.tp(w2.i, two ? 8 : 30, two ? 52 : 32);
      k.path = null; k.target = v; v.path = null; k.knife = 1;
    };
    setup(vs[0], false);
    const seen = t.witnessesAt(k.i, 9, 53, 6, vs[0].i);
    const oldRandom = Math.random;
    /* 1 个非队友目击者 + 冒险 → 直接出刀 */
    Math.random = () => 0;
    t.aiTickAlien(k.i, 1, 0.05);
    const oneRisk = { downed: t.state()[vs[0].i].downed };
    /* 每一次行凶都会让异形记住目击者；分支之间清空，避免它改追目击者 */
    const clearAlienMind = () => {
      k.mind.seenBy = {}; k.mind.mem = []; k.mind.sus = {}; k.mind.why = {}; k.mind.alert = 0;
      k.target = null; k.path = null; k._avoid = {};
    };
    /* 1 个非队友目击者 + 谨慎 → 放弃目标（不再原地等待/踱步） */
    clearAlienMind();
    setup(vs[1], false); Math.random = () => 0.999;
    t.aiTickAlien(k.i, 1, 0.05);
    const oneHold = { downed: t.state()[vs[1].i].downed,
      target: k.target ? k.target.i : null,
      avoid: !!(k._avoid && k._avoid[vs[1].i] > 0) };
    /* 2 个非队友目击者 → 无论随机数都放弃 */
    clearAlienMind();
    setup(vs[2], true); Math.random = () => 0;
    t.aiTickAlien(k.i, 1, 0.05);
    const two = { downed: t.state()[vs[2].i].downed,
      target: k.target ? k.target.i : null,
      avoid: !!(k._avoid && k._avoid[vs[2].i] > 0) };
    /* 目击者是已认出的队友 → 不算风险，高随机数也照常出刀 */
    clearAlienMind();
    k.mates[w1.i] = { t: 0, kind: 'saw_red' };
    setup(vs[3], false); t.tp(w2.i, 30,54);
    k.target = vs[3]; Math.random = () => 0.999;
    t.aiTickAlien(k.i, 1, 0.05);
    const mate = { downed: t.state()[vs[3].i].downed };
    Math.random = oldRandom;
    return { k: k.i, w1: w1.i, seen, oneRisk, oneHold, two, mate, inv: t.inv() };
  });
  ok(WIT.seen.indexOf(WIT.w1) >= 0, '旁观者识别：能看见出手点的活人被算作目击者');
  ok(WIT.oneRisk.downed, '只有 1 个非队友目击者：仍有一定概率直接出刀');
  ok(!WIT.oneHold.downed && WIT.oneHold.target === null && WIT.oneHold.avoid,
    '只有 1 个目击者但选择谨慎：直接放弃目标，不原地踱步');
  ok(!WIT.two.downed && WIT.two.target === null && WIT.two.avoid,
    '2 个非队友目击者：必定放弃，转而寻找落单者');
  ok(WIT.mate.downed, '目击者是已认出的队友：不算风险，照常出刀配合');
  ok(WIT.inv.fails.length === 0, '目击/队友判定后不变量全过');

  section('AI 异形 · 队友识别与保护');
  await fresh(false);
  const MATE = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const al = g.agents.filter(a => a.alien && a.i !== 0 && a.alive).slice(0, 2);
    const k = al[0], m = al[1];
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k && a !== m && a !== v) t.tp(a.i, 30,54);
    t.resetAiState(k.i); t.resetAiState(m.i);
    k.mates = {}; m.mates = {};
    g.secbotDead = true; g.medbotDead = true;
    t.tp(k.i, 8,53); t.tp(m.i, 9,53); t.tp(v.i, 8,51);
    for (const a of [k, m, v]) { a._delay = 0; a._rest = 0; a.path = null; a.target = null; }
    t.notice(m.i, 9, 53, 6, 'pipe', null);
    const pipeMate = t.mind(k.i).mates[m.i] || null;
    m.redT = 3; t.track();
    const redMate = t.mind(k.i).mates[m.i] || null;
    t.breaker();
    t.tp(k.i, 48,54); t.tp(m.i, 47,54);
    t.notice(m.i, 47, 54, 6, 'breaker', null);
    const brMate = t.mind(k.i).mates[m.i] || null;
    k.knife = 1; k.sabUsed = true; k._botCD = 999; k._delay = 0;
    k.target = null; k.path = null;
    t.aiTickAlien(k.i, 1, 0.05);
    const tgt = k.target ? k.target.i : null;
    t.openMeeting('day', null, null);
    t.startVote();
    const vote = g.meet ? g.meet.votes[k.i] : null;
    if (g.meet) t.finishMeeting();
    return { k: k.i, m: m.i, v: v.i, pipeMate, redMate, brMate, tgt, vote };
  });
  ok(MATE.pipeMate && MATE.pipeMate.kind === 'pipe' &&
    MATE.redMate && MATE.redMate.kind === 'saw_red',
    '异形目击队友钻管道 / 红光 → 记成队友');
  ok(MATE.brMate && MATE.brMate.kind === 'breaker', '异形目击断电拉闸 → 记成队友');
  ok(MATE.tgt !== MATE.m && MATE.vote !== MATE.m,
    '队友不会被当作刀下目标，也不会被队友投票');

  await fresh(false);
  const ALLY = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const al = g.agents.filter(a => a.alien && a.i !== 0 && a.alive).slice(0, 2);
    const k = al[0], m = al[1];
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k && a !== m && a !== v) t.tp(a.i, 30,54);
    t.resetAiState(k.i); t.resetAiState(m.i);
    k.mates = {}; m.mates = {};
    k.mates[m.i] = { t: 0, kind: 'pipe' };
    m.mates[k.i] = { t: 0, kind: 'pipe' };
    t.tp(k.i, 56, 85); t.tp(m.i, 57, 85); t.tp(v.i, 55, 85);
    const oldRandom = Math.random;
    Math.random = () => 0;
    t.openMeeting('day', null, null);
    Math.random = oldRandom;
    const f = (t.meetCtx().frames || [])[0] || null;
    t.startVote();
    const vote = g.meet ? g.meet.votes[k.i] : null;
    if (g.meet) t.finishMeeting();
    return { k: k.i, m: m.i, v: v.i, f, vote };
  });
  ok(ALLY.f && ALLY.f.ally != null && ALLY.f.ally !== ALLY.f.by &&
    ALLY.f.ally !== ALLY.f.target && /我也看见了/.test(ALLY.f.allyText || ''),
    '异形主动构陷时，已认出的队友帮腔共同诬陷');
  ok(ALLY.f && ALLY.f.target !== ALLY.m && ALLY.vote !== ALLY.m,
    '联合构陷不会指向队友');

  section('人类 AI · 故障优先 / 弃修逃跑');
  await fresh(false);
  const FLEE = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== h && a !== k) t.tp(a.i, 30,54);
    t.tp(h.i, 30,33); t.tp(k.i, 34,33);
    h._delay = 0; h._rest = 0; h.doing = 8; h._doing = 'task'; h._taskPt = h.tasks[0];
    h.path = null; h.mind.known[k.i] = { t: 0, kind: 'saw_pipe', room: 'bridge', conf: 0.95 };
    k.moving = true; k.path = [[31, 11]];
    t.aiTick(h.i, 1, 0.05);
    return { doing: h.doing, do: h._doing, flee: h._fleeT || 0,
      path: !!(h.path && h.path.length) };
  });
  ok(FLEE.doing === 0 && FLEE.flee > 0 && FLEE.path,
    '人类 AI 修任务时确认异形逼近：立刻弃修逃跑');

  const REP = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== h && a !== k) t.tp(a.i, 30,54);
    t.tp(h.i, 8,53); t.tp(k.i, 30,54);
    g.dmg = [{ room: 'engine', x: 6, y: 51, label: '测试故障', left: 60, dur: 60, by: k.i }];
    h._delay = 0; h._rest = 0; h._fixGo = null; h.path = null;
    h.doing = 0; h._doing = null; h._lightGo = false;
    t.aiTick(h.i, 1, 0.05);
    return { fixGo: !!h._fixGo, doing: h._doing, path: !!(h.path && h.path.length) };
  });
  ok(REP.fixGo || REP.doing === 'fix' || REP.path,
    '看到故障后人类 AI 直接前往/开始维修，不被别的事务打断');

  section('人类 AI 幽灵 · 2 分额度');
  await fresh(false);
  const AG = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    t.kill(h.i, 'knife');
    g.dmg = [];
    h.ghostPts = 0; h.tIdx = 0; h.doing = 0; h._doing = null; h.path = null;
    const spot = t.taskSpot(h.i);
    t.tp(h.i, spot.x, spot.y);
    t.aiGhostTick(h.i, 1, 0.05);
    const steps = Math.ceil(((h.doing || 1) + 1) / 0.05);
    t.aiGhostTick(h.i, steps, 0.05);
    const p1 = h.ghostPts || 0;
    h.ghostPts = 2; h.doing = 0; h._doing = null; h.path = null;
    const spot2 = t.taskSpot(h.i);
    t.tp(h.i, spot2.x, spot2.y);
    const r2 = t.aiGhostTick(h.i, 1, 0.05);
    return { p1, doing: h.doing, do: h._doing, pts: h.ghostPts || 0, r2 };
  });
  ok(AG.p1 > 0 && AG.p1 <= 2, '人类 AI 幽灵做剩余任务，进度不超过 2 分');
  ok(AG.doing === 0 && AG.do !== 'task' && AG.pts === 2,
    '额度用尽后 AI 幽灵不再做任务');

  section('幽灵 · 异形幽灵不推进人类进度');
  await fresh(false);
  const AG2 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true; g.dmg = [];
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    t.kill(k.i, 'knife');
    k.ghostPts = 0; k.tIdx = 0; k.doing = 0; k._doing = null; k.path = null;
    const spot = t.taskSpot(k.i);
    t.tp(k.i, spot.x, spot.y);
    const r = t.aiGhostTick(k.i, 1, 0.05);
    return { do: r.do, doing: r.doing, tIdx: r.tIdx, pts: r.ghostPts || 0 };
  });
  ok(AG2.do !== 'task' && AG2.doing === 0 && AG2.tIdx === 0 && AG2.pts === 0,
    '异形幽灵不执行任务/维修，不推进人类进度');

  section('AI 搜尸取物资 · 人类与异形');
  await fresh(false);
  const LOOTB = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true; g.dmg = [];
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v1 = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== h);
    const v2 = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== h && a !== v1);
    for (const a of g.agents) if ([h, k, v1, v2].indexOf(a) < 0) t.tp(a.i, 30,54);
    t.tp(h.i, 30,33); t.tp(v1.i, 34,33);
    t.tp(k.i, 8,53); t.tp(v2.i, 10,53);
    for (const a of [h, k, v1, v2]) { a._delay = 0; a._rest = 0; a.path = null; a.target = null; }
    t.kill(v1.i, 'knife'); v1.bullet = 1; v1.qual = 1; v1.medkit = 0;
    t.kill(v2.i, 'knife'); v2.bullet = 1; v2.medkit = 1; v2.qual = 0;
    h.bullet = 0; h.medkit = 0; h.qual = 0;
    k.bullet = 0; k.medkit = 0; k.qual = 0; k.knife = 0;
    k.sabUsed = true; k._hides = 2; k._hideCD = 999;
    g.secbotDead = true; g.medbotDead = true;
    /* AI 拿到物资后会按规则立刻花掉（申请单换补给、子弹打人），所以不能只看到终点背包；
       逐帧记录“第一次拿到物资”的瞬间，并让事件流给出对应 search 证据。 */
    const grab = { h: null, k: null };
    for (let i = 0; i < 280; i++) {
      t.aiTickAlien(k.i, 1, 0.05);
      if (!grab.k && ((k.bullet | 0) >= 1 || (k.medkit | 0) >= 1 || (k.qual | 0) >= 1))
        grab.k = { i, bullet: k.bullet | 0, medkit: k.medkit | 0, qual: k.qual | 0 };
      t.aiTick(h.i, 1, 0.05);
      if (!grab.h && ((h.bullet | 0) >= 1 || (h.qual | 0) >= 1))
        grab.h = { i, bullet: h.bullet | 0, qual: h.qual | 0 };
    }
    const searches = t.events().filter(e => e.kind === 'search').map(e => ({
      actor: e.actor, victim: e.victim, bullet: e.bullet, medkit: e.medkit, qual: e.qual
    }));
    return { h: { bullet: h.bullet, medkit: h.medkit, qual: h.qual },
      k: { bullet: k.bullet, medkit: k.medkit, qual: k.qual },
      grab, v1s: !!v1.searched, v2s: !!v2.searched, searches,
      hi: h.i, ki: k.i, v1i: v1.i, v2i: v2.i };
  });
  ok(!!LOOTB.grab.h && LOOTB.v1s &&
    LOOTB.searches.some(e => e.actor === LOOTB.hi && e.victim === LOOTB.v1i &&
      (e.bullet + e.medkit + e.qual) > 0),
    '人类 AI 会走到尸体旁搜尸并取走子弹/申请单（第 '
    + (LOOTB.grab.h ? LOOTB.grab.h.i : '—') + ' 步拿到，事件流留痕）');
  ok(!!LOOTB.grab.k && LOOTB.v2s &&
    LOOTB.searches.some(e => e.actor === LOOTB.ki && e.victim === LOOTB.v2i &&
      (e.bullet + e.medkit + e.qual) > 0),
    '异形 AI 同样会翻尸拿子弹/医疗包/申请单（事件流留痕）');

  await fresh(false);
  const LOOTD = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true; g.dmg = [];
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k && a !== v) t.tp(a.i, 30,54);
    t.resetAiState(k.i);
    g.secbotDead = true; g.medbotDead = true;
    k.knife = 0; k.bullet = 0; k.medkit = 0; k.qual = 0; k.qualPending = 0;
    k.sabUsed = true; k._hides = 2; k._hideCD = 999; k._delay = 0; k._rest = 0;
    v.downed = true; v.alive = true; v.downAt = g.t; v.downX = 56; v.downY = 51;
    v.bullet = 0; v.medkit = 0; v.qual = 0; v.qualPending = 1;
    t.tp(k.i, 56.8, 85); t.tp(v.i, 56, 85);
    for (let i = 0; i < 12; i++) t.aiScan(k.i, 0.06);
    const start = { do: k._doing, sv: k._sv };
    t.aiTickAlien(k.i, 40, 0.05);
    return { start, qual: k.qual, qp: k.qualPending, vqp: v.qualPending,
      searched: v.searched, inv: t.inv() };
  });
  ok(LOOTD.start.do === 'search' && (LOOTD.qual >= 1 || LOOTD.qp >= 1) &&
    LOOTD.vqp === 0,
    '异形会搜还活着的倒地伤员，继承其未领取的申请单（不再等到天亮尸体被清场）');
  ok(LOOTD.inv.fails.length === 0, '异形搜倒地伤员后不变量全过');

  await fresh(false);
  const LOOTM = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true; g.dmg = [];
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== h);
    for (const a of g.agents) if (a !== h && a !== v) t.tp(a.i, 30,54);
    /* 医疗无人机可用时“把伤员拖去医疗间”优先级高于搜尸，这条测的是记忆绕回收尸，
       所以先关掉救援选项，否则 AI 会一路拖着伤员走、永远不开始 search。 */
    g.secbotDead = true; g.medbotDead = true;
    h.bullet = 0; h.medkit = 0; h.qual = 0; h.qualPending = 0;
    h.tIdx = h.tasks.length; h._delay = 0; h._rest = 0; h.path = null;
    h.doing = 0; h._doing = null; h._lootMem = {};
    v.downed = true; v.alive = true; v.downAt = g.t; v.downX = 40; v.downY = 30;
    v.bullet = 0; v.medkit = 0; v.qual = 0; v.qualPending = 1;
    /* 找一处真正可站立、且有视线、彼此相隔 4 格的同房位置；
       40,30 是墙/未知区域，旧测试会因此观察不到。 */
    const rooms = t.rooms();
    let hp = null, vp = null;
    for (const r of rooms) {
      for (let dx = -2; dx <= 2 && !hp; dx += 0.5)
        for (let dy = -2; dy <= 2 && !hp; dy += 0.5) {
          const x = r.x + dx, y = r.y + dy, vx = x + 4, vy = y;
          if (!t.free(x, y) || !t.free(vx, vy) || !t.los(x, y, vx, vy)) continue;
          hp = [x, y]; vp = [vx, vy];
        }
      if (hp) break;
    }
    if (!hp) { hp = [44, 30]; vp = [40, 30]; }
    t.tp(h.i, hp[0], hp[1]); t.tp(v.i, vp[0], vp[1]);
    for (let i = 0; i < 12; i++) t.aiScan(h.i, 0.06);
    const mem = !!(h._lootMem && h._lootMem[v.i]);
    /* 离开视野：在 12–18 格内找一处可站点（记忆半径 20），只剩记忆能指路 */
    let far = null;
    for (let rr = 12; rr <= 18 && !far; rr += 1)
      for (let ai = 0; ai < 24 && !far; ai++) {
        const a = ai / 24 * Math.PI * 2;
        const x = vp[0] + Math.cos(a) * rr, y = vp[1] + Math.sin(a) * rr;
        if (t.free(x, y)) far = [x, y];
      }
    if (!far) far = [30, 32];
    t.tp(h.i, far[0], far[1]); h.path = null;
    for (let i = 0; i < 500 && v.qualPending > 0 && h._doing !== 'search'; i++)
      t.aiTick(h.i, 1, 0.05);
    const started = h._doing === 'search';
    if (started) t.aiTick(h.i, 40, 0.05);
    return { mem, started, qual: h.qual, qp: h.qualPending, vqp: v.qualPending,
      hp, vp, far, inv: t.inv() };
  });
  ok(LOOTM.mem && LOOTM.started && LOOTM.qp === 0 && LOOTM.qual >= 1,
    'AI 会记住视野里见过的倒地伤员，离开后专门绕回去收尸拿资源（mem=' +
    LOOTM.mem + ' started=' + LOOTM.started + ' qp=' + LOOTM.vqp + '）');
  ok(LOOTM.inv.fails.length === 0, 'AI 记忆收尸后不变量全过');

  section('AI 异形 · 假装维修 / 补给 / 开枪');
  await fresh(false);
  const FAKE = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const w = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k && a !== w) t.tp(a.i, 30,54);
    t.resetAiState(k.i);
    t.tp(k.i, 7.5,53); t.tp(w.i, 9,53);
    k.knife = 0; k.sabUsed = true; k._alienTaskN = g.night;
    k._fakeN = 0; k._supportGoal = null; k.target = null;
    k._delay = 0; k._rest = 0;
    g.dmg = [{ room: 'engine', x: 6, y: 51, label: '测试故障', left: 60, dur: 60, by: k.i }];
    const old = Math.random; Math.random = () => 0;
    t.aiTickAlien(k.i, 2, 0.05);      /* 决定假装维修 */
    t.aiTickAlien(k.i, 30, 0.05);     /* 走到故障旁开始站桩 */
    Math.random = old;
    const out = { do: k._doing, doing: k.doing, dmg: g.dmg.length, fake: k._fakeN };
    t.aiTickAlien(k.i, 140, 0.05);
    out.dmgAfter = g.dmg.length; out.prog = g.prog; out.doAfter = k._doing;
    return out;
  });
  ok(FAKE.do === 'fake' && FAKE.doing > 0 && FAKE.dmg === 1,
    '异形会在故障旁假装维修（不实际修好）');
  ok(FAKE.doAfter !== 'fake' && FAKE.dmgAfter === 1 && FAKE.prog === 0,
    '假装修完不留进度、不修复故障');

  await fresh(false);
  const FAKET = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true; g.dmg = [];
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const w = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k && a !== w) t.tp(a.i, 30,54);
    t.resetAiState(k.i);
    /* 只能从"这个 AI 还没被派过"的任务点里挑，且必须带着**原始下标**回来用：
       直接改写 k.tasks[tIdx] 若撞上列表里已有的点位会触发不变量 A6「任务点重复」
       （历史偶发红就是这个原因，是测试自己把任务表写坏了，不是对局问题）。
       注意 filter 之后 indexOf 得到的是过滤数组的位置，不是 M.points 编号 —— 所以这里显式存 idx。 */
    const pts = t.points().map((p, i) => Object.assign({ idx: i }, p))
      .filter(p => k.tasks.indexOf(p.idx) < 0);
    let spot = null;
    for (const p of pts) {
      for (const d of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) {
        const kx = p.x + d[0], ky = p.y + d[1];
        const wx = p.x - d[0], wy = p.y - d[1];
        if (t.free(kx, ky) && t.free(wx, wy) && t.los(kx, ky, wx, wy)) {
          spot = { p, kx, ky, wx, wy }; break;
        }
      }
      if (spot) break;
    }
    if (!spot) spot = { p: pts[0], kx: pts[0].x + 1.2, ky: pts[0].y,
      wx: pts[0].x - 1.2, wy: pts[0].y };
    const pi = spot.p.idx;
    if (pi != null && k.tasks) k.tasks[k.tIdx] = pi;   /* 让假任务目标就在附近 */
    t.tp(k.i, spot.kx, spot.ky); t.tp(w.i, spot.wx, spot.wy);
    k.knife = 0; k.bullet = 0; k.medkit = 0; k.qual = 0; k.qualPending = 0;
    k.sabUsed = true; k._delay = 0; k._rest = 0;
    k._fakeTaskN = 0; k._fakeN = g.night; k._supportGoal = null; k.target = null;
    k._alienTaskN = g.night; k._alienTaskTotal = 1;   /* 排除真做任务 */
    g.prog = 0;
    const prog0 = g.prog, old = Math.random;
    Math.random = () => 0;
    let seen = false;
    for (let i = 0; i < 200 && !seen; i++) {
      t.aiTickAlien(k.i, 1, 0.05);
      if (k._doing === 'fake') seen = true;
    }
    Math.random = old;
    const start = { seen, do: k._doing, doing: k.doing, fakeTaskN: k._fakeTaskN };
    t.aiTickAlien(k.i, 200, 0.05);
    return { start, night: g.night, prog0, prog1: g.prog, fakeTaskN: k._fakeTaskN,
      doAfter: k._doing, kind: k._fakeKind, inv: t.inv() };
  });
  ok(FAKET.start.seen && FAKET.start.do === 'fake' && FAKET.start.doing > 0 &&
    FAKET.start.fakeTaskN === FAKET.night,
    '异形会在任务点假装做任务（有目击者时进入 fake 动作；seen=' +
    FAKET.start.seen + ' do=' + FAKET.start.do + ' n=' + FAKET.start.fakeTaskN + '）');
  ok(FAKET.prog1 === FAKET.prog0 && FAKET.doAfter !== 'fake' && FAKET.fakeTaskN > 0,
    '假装做任务不增加任何维修进度，也不会真的完成任务');
  ok(FAKET.inv.fails.length === 0, '异形假装做任务后不变量全过' +
    (FAKET.inv.fails.length ? '（失败项：' + FAKET.inv.fails.slice(0, 4).map(f => f.code + ':' + f.msg).join(' | ') + '）' : ''));

  await fresh(false);
  const ASUP = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true; g.dmg = [];
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k) t.tp(a.i, 30,54);
    t.resetAiState(k.i);
    const pts = t.points();
    let kp = null;
    for (const p of pts) {
      for (const d of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) {
        if (t.free(p.x + d[0], p.y + d[1])) { kp = [p.x + d[0], p.y + d[1]]; break; }
      }
      if (kp) break;
    }
    t.tp(k.i, kp[0], kp[1]);
    k.knife = 0; k.bullet = 0; k.medkit = 0; k.qual = 0; k.qualPending = 0;
    k.sabUsed = true; k._delay = 0; k._rest = 0;
    k._fakeTaskN = g.night; k._fakeN = g.night;   /* 排除假装分支 */
    k._supportGoal = null; k.target = null;
    k._alienTaskN = 0; k._alienTaskTotal = 0;
    g.prog = 0;
    const old = Math.random; Math.random = () => 0;
    t.aiTickAlien(k.i, 3, 0.05);
    Math.random = old;
    const goalLow = k._supportGoal ? k._supportGoal.kind : (k._doing || null);
    k.doing = 0; k._doing = null; k._supportGoal = null; k._taskPt = null;
    k._alienTaskN = 0; k._alienTaskTotal = 0;
    g.prog = 40;
    const old2 = Math.random; Math.random = () => 0;
    t.aiTickAlien(k.i, 20, 0.05);
    Math.random = old2;
    const goalHigh = k._supportGoal ? k._supportGoal.kind : (k._doing || null);
    return { goalLow, goalHigh, total: k._alienTaskTotal };
  });
  ok(ASUP.goalLow === 'task' && ASUP.goalHigh !== 'task',
    '异形真做任务只在低进度/缺弹时小概率发生；人类接近 45 分时不做任务帮人类赢');

  await fresh(false);
  const AGUN = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true; g.dmg = [];
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k && a !== h) t.tp(a.i, 30,54);
    t.resetAiState(k.i);
    g.secbotDead = true; g.medbotDead = true;
    k.qual = 1; k.bullet = 0; k.medkit = 0; k.knife = 1;
    k.sabUsed = true; k._delay = 0; k._rest = 0;
    t.tp(k.i, 78.2,76.6);
    t.aiTickAlien(k.i, 1, 0.05);
    const start = { do: k._doing, doing: k.doing };
    t.aiTickAlien(k.i, 220, 0.05);
    const got = { bullet: k.bullet, qual: k.qual };
    t.tp(k.i, 56, 85); t.tp(h.i, 61, 85);
    k.bullet = 1; k.knife = 1; k.target = h;
    k._supportGoal = null; k._fakeN = g.night; k._alienTaskN = g.night;
    const old = Math.random; Math.random = () => 0;
    t.aiTickAlien(k.i, 1, 0.05);
    Math.random = old;
    return { start, got, downed: !!h.downed, bullet: k.bullet };
  });
  ok(AGUN.start.do === 'ammo' && AGUN.got.bullet === 1 && AGUN.got.qual === 0,
    '异形会用申请单在军械补给点换子弹');
  ok(AGUN.downed && AGUN.bullet === 0, '异形有子弹时会开枪击倒人类');

  section('AI 异形 · 用医疗包救倒下的队友');
  await fresh(false);
  const AMED = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true; g.dmg = [];
    const al = g.agents.filter(a => a.alien && a.i !== 0 && a.alive).slice(0, 2);
    const k = al[0], m = al[1];
    for (const a of g.agents) if (a !== k && a !== m) t.tp(a.i, 30,54);
    t.resetAiState(k.i);
    k.mates = {}; k.mates[m.i] = { t: 0, kind: 'pipe' };
    k.medkit = 1; k.knife = 0; k.sabUsed = true; k._delay = 0; k._rest = 0;
    m.downed = true; m.alive = true; m.downX = 56; m.downY = 51; m.downAt = g.t;
    t.tp(k.i, 56.6, 85); t.tp(m.i, 56, 85);
    t.aiTickAlien(k.i, 1, 0.05);
    const start = { do: k._doing, doing: k.doing };
    t.aiTickAlien(k.i, 120, 0.05);
    return { start, downed: m.downed, alive: m.alive, medkit: k.medkit };
  });
  ok(AMED.start.do === 'revive' && AMED.start.doing > 0,
    '异形会用医疗包救起已认出的队友');
  ok(!AMED.downed && AMED.alive && AMED.medkit === 0,
    '队友被救起，医疗包消耗');

  section('AI 推理 · 反向洗清 / 枪击正当性 / 空口指控');
  await fresh(false);
  const ALIB = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const w = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const a = g.agents.find(x => x.i !== 0 && x !== w && x.alive);
    const v = g.agents.find(x => !x.alien && x.i !== 0 && x.alive && x !== w && x !== a);
    for (const x of g.agents) if (x !== w && x !== a && x !== v) t.tp(x.i, 30,54);
    t.tp(w.i, 30,33); t.tp(a.i, 10,53); t.tp(v.i, 56, 85);
    t.kill(v.i, 'knife');
    const deathEv = 120 - Math.max(0, v.alive ? v.downAt : v.deathAt);
    a.nRoom = 'engine';
    w.mind.sus[a.i] = 0.5;
    w.mind.mem.push({ kind: 'saw_agent', subj: a.i, room: 'engine',
      night: g.night, t: deathEv, conf: 0.8, src: 'sight' });
    t.openMeeting('night', w.i, v.i);
    const out = { after: (t.mind(w.i).sus || {})[a.i] || 0,
      accuse: g.agents[w.i].accuse, a: a.i };
    if (g.meet) t.finishMeeting();
    return out;
  });
  ok(ALIB.after < 0.4 && ALIB.accuse !== ALIB.a,
    '目击案发时在别处 → 降低普通嫌疑、不当场指控（' + ALIB.after.toFixed(2) + '）');

  const SHOTJ = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const w = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const w2 = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== w);
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== w && a !== w2);
    const v = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    for (const x of g.agents) if ([w, w2, h, v].indexOf(x) < 0) t.tp(x.i, 30,54);
    t.tp(w.i, 56, 85); t.tp(w2.i, 57, 85); t.tp(h.i, 58, 85); t.tp(v.i, 59, 85);
    w.mind.known[v.i] = { t: 0, kind: 'saw_pipe', room: 'med', conf: 0.95 };
    const b1 = (t.mind(w.i).sus || {})[h.i] || 0;
    const b2 = (t.mind(w2.i).sus || {})[h.i] || 0;
    t.notice(h.i, 58, 85, 7, 'shot', v.i);
    return { b1, b2, a1: (t.mind(w.i).sus || {})[h.i] || 0,
      a2: (t.mind(w2.i).sus || {})[h.i] || 0,
      s1: g.agents[w.i].suspect, s2: g.agents[w2.i].suspect, h: h.i };
  });
  ok(SHOTJ.a1 === SHOTJ.b1 && SHOTJ.s1 !== SHOTJ.h,
    '目击者已确证被害者是异形：枪击是处决，不怀疑开枪者');
  ok(SHOTJ.a2 > SHOTJ.b2 && SHOTJ.s2 === SHOTJ.h,
    '没有该确证的目击者仍会把枪击记为凶手证据');

  const EMPTY = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const w = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    for (const x of g.agents) if (x !== w && x !== k) t.tp(x.i, 30,54);
    t.tp(w.i, 56, 85); t.tp(k.i, 57, 85);
    const before = (t.mind(w.i).sus || {})[k.i] || 0;
    t.openMeeting('day', null, null);
    const after = (t.mind(w.i).sus || {})[k.i] || 0;
    if (g.meet) t.finishMeeting();
    return { before, after };
  });
  ok(EMPTY.after > EMPTY.before,
    '零证据指控会损耗发言者可信度（人类听众记一笔小嫌疑）');

  section('AI 异形 · 偶尔直接报案');
  await fresh(false);
  const DIR = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = false; g.aiReportUsed = false;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k && a !== v) t.tp(a.i, 30,32);
    t.clearDrags(); t.resetAiState(k.i);
    t.tp(v.i, 56, 85); t.kill(v.i, 'knife'); t.tp(k.i, 56.6, 85);
    k.knife = 0; k.sabUsed = true; k._delay = 0; k._rest = 0;
    k._killBody = v.i; k._killAt = 0; k._killDecided = false;
    const oldRandom = Math.random;
    Math.random = () => 0;                 /* 报案概率 + 直接报案都命中 */
    t.aiTickAlien(k.i, 1, 0.05);
    Math.random = oldRandom;
    const plan = t.reportPlan(k.i);
    t.aiTickAlien(k.i, 4, 0.5);            /* 短暂停顿后原地拉铃，不绕去做不在场 */
    const out = { plan, meet: !!t.G().meet, used: t.aiReportUsed(),
      by: document.getElementById('m-by').textContent,
      tag: String(k.i + 1).padStart(2, '0') + ' ' + k.name };
    if (t.G().meet) t.finishMeeting();
    return out;
  });
  ok(DIR.plan && DIR.plan.direct && DIR.plan.wait > 0,
    '杀完人偶尔直接报案：计划标记 direct，原地短暂停顿');
  ok(DIR.meet && DIR.used && DIR.by === DIR.tag,
    '直接报案同样能开会：' + DIR.by);

  section('AI 异形 · 杀完人绕一圈回来报告');
  await fresh(false);
  const RP = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = false; g.aiReportUsed = false;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k && a !== v) t.tp(a.i, 30,32);
    t.tp(v.i, 56, 85); t.kill(v.i, 'knife');
    t.tp(k.i, 56.6, 85);
    k.knife = 0; k.sabUsed = true; k._delay = 0;
    t.planReport(k.i, v.i, 0);
    t.aiTickAlien(k.i, 20, 0.05);
    const out = { meet: !!g.meet, used: t.aiReportUsed(),
      by: document.getElementById('m-by').textContent,
      tag: String(k.i + 1).padStart(2, '0') + ' ' + k.name, inv: t.inv() };
    if (g.meet) t.finishMeeting();
    return out;
  });
  ok(RP.meet && RP.used && RP.by === RP.tag, 'AI 异形会主动回到现场报告尸体：' + RP.by);
  ok(RP.inv.fails.length === 0, '回场报告后不变量全过');

  const RP2 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = false; g.aiReportUsed = false;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k && a !== v) t.tp(a.i, 30,32);
    t.tp(v.i, 56, 85); t.kill(v.i, 'knife');
    t.tp(k.i, 56.6, 85);
    k.knife = 0; k.sabUsed = true; k._delay = 0;
    t.planReport(k.i, v.i, 4);
    t.aiTickAlien(k.i, 20, 0.05);
    const mid = { d: +Math.hypot(g.agents[k.i].x - 56, g.agents[k.i].y - 51).toFixed(1),
      meet: !!g.meet, plan: t.reportPlan(k.i) };
    t.aiTickAlien(k.i, 700, 0.05);
    const after = { meet: !!g.meet, used: t.aiReportUsed() };
    if (g.meet) t.finishMeeting();
    return { mid, after, inv: t.inv() };
  });
  ok(RP2.mid.d > 1.5 && !RP2.mid.meet, '报告前先离开现场（不站在尸体旁喊人，间距 ' +
    RP2.mid.d + ' 格）');
  ok(RP2.after.meet && RP2.after.used, '绕一圈后回到现场再拉铃，用会议拖人类的时间');
  ok(RP2.inv.fails.length === 0, '绕场报告后不变量全过');

  section('会议 · 尸体还热就有人来报');
  const QR = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = false;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const w = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== v);
    for (const a of g.agents) if (a !== k && a !== v && a !== w) t.tp(a.i, 30,32);
    t.tp(v.i, 56, 85); t.kill(v.i, 'knife');
    t.tp(w.i, 57.4, 85);
    t.aiScan(w.i, 0.6);                    /* w 看到尸体（没看到凶手） */
    const s0 = (t.mind(w.i).sus || {})[k.i] || 0;
    t.openMeeting('night', k.i, v.i);      /* 凶手本人报告 */
    const q = t.meetCtx().quick;
    const s1 = (t.mind(w.i).sus || {})[k.i] || 0;
    t.finishMeeting();
    return { k: k.i, w: w.i, s0, s1, q, inv: t.inv() };
  });
  ok(QR.q && QR.q.age <= 10, '会议记录「尸体刚倒下」（quick.age=' + (QR.q && QR.q.age) + 's）');
  ok(QR.s1 > QR.s0 + 0.15,
    '见过尸体的人会怀疑报告人来得太快（' + QR.s0.toFixed(2) + ' → ' + QR.s1.toFixed(2) + '）');
  ok(QR.inv.fails.length === 0, '快速报告不变量全过');

  const QR2 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = false;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const w = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== v);
    for (const a of g.agents) if (a !== k && a !== v && a !== w) t.tp(a.i, 30,32);
    t.tp(v.i, 56, 85); t.kill(v.i, 'knife');
    v.deathAt = g.t + 30;                  /* 死了 30 秒才被报 */
    t.tp(w.i, 57.4, 85);
    t.aiScan(w.i, 0.6);
    const s0 = (t.mind(w.i).sus || {})[k.i] || 0;
    t.openMeeting('night', k.i, v.i);
    const s1 = (t.mind(w.i).sus || {})[k.i] || 0;
    const q = t.meetCtx().quick;
    const why = (t.mind(w.i).why || {})[k.i] || [];
    t.finishMeeting();
    return { s0, s1, q, why };
  });
  ok(QR2.q && QR2.q.age > 10, '死亡 30 秒后才报告：quick.age=' + (QR2.q && QR2.q.age) + 's');
  const qr2 = (QR2.why || []).filter(x => x.reason === 'quick_report');
  ok(qr2.length === 0,
    '不是「来得太快」就不记 quick_report 嫌疑（总嫌疑可能被会议构陷抬高：' +
    QR2.s0.toFixed(2) + ' → ' + QR2.s1.toFixed(2) + '）');

  section('故障维修 · 队友修好后立即松手');
  await fresh(false);
  const SFIX = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const a1 = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const a2 = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== a1);
    t.tp(a1.i, 56, 85); t.tp(a2.i, 57.2, 85);
    g.dmg = [{room: 'med', x: 56.1, y: 83.4, label: '测试设备', left: 60, dur: 60, by: 0}];
    t.startFix(a1.i, 'med'); t.startFix(a2.i, 'med');
    const before = { d1: g.agents[a1.i]._doing, d2: g.agents[a2.i]._doing };
    g.agents[a1.i].doing = 0.01;
    t.finishDoing(a1.i);
    return { a1: a1.i, a2: a2.i, before, dmg: g.dmg.length,
      d2: g.agents[a2.i]._doing, doing2: g.agents[a2.i].doing,
      path2: !!g.agents[a2.i].path, inv: t.inv() };
  });
  ok(SFIX.before.d1 === 'fix' && SFIX.before.d2 === 'fix', '两名 AI 可以同时修同一座故障');
  ok(SFIX.dmg === 0 && !SFIX.d2 && SFIX.doing2 === 0,
    '队友修好后另一人立即停止站桩（不再空耗剩下的 10 秒）');
  ok(!SFIX.path2 && SFIX.inv.fails.length === 0, '同时清掉旧故障路径，不变量全过');

  const SFIX2 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const a1 = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const a2 = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== a1);
    t.tp(a1.i, 56, 85); t.tp(a2.i, 30,54);
    g.dmg = [{room: 'med', x: 56.1, y: 83.4, label: '测试设备', left: 60, dur: 60, by: 0}];
    a2._fixGo = g.dmg[0];
    a2.path = [[56.1, 83.4]];
    g.dmg = [];
    t.aiTick(a2.i, 1, 0.05);
    const end = a2.path && a2.path.length ? a2.path[a2.path.length - 1] : null;
    return { fixGo: a2._fixGo, end,
      atFault: !!(end && Math.hypot(end[0] - 56.1, end[1] - 71.4) < 0.6), inv: t.inv() };
  });
  ok(!SFIX2.fixGo && !SFIX2.atFault, '赶往故障途中故障被修好：立刻改道，不再往旧设备跑');
  ok(SFIX2.inv.fails.length === 0, '改道后不变量全过');

  section('AI 人类 · 断电后主动合闸');
  await fresh(false);
  const LB = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true; g.dmg = [];
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== h) { a.knife = 0; t.tp(a.i, 30,32); }
    t.clearDrags(); t.resetAiState(h.i);
    h.medkit = 0; h.bullet = 0; h.qual = 0; h.qualPending = 0; h.suspect = null;
    h.tIdx = h.tasks.length; h._delay = 0; h._rest = 0;
    t.breaker();
    const st0 = t.lights().state;
    let hp = null;
    for (let r = 0.4; r <= 3.2 && !hp; r += 0.2)
      for (let i = 0; i < 24 && !hp; i++) {
        const a = i / 24 * Math.PI * 2, x = 50.8 + Math.cos(a) * r, y = 54.1 + Math.sin(a) * r;
        if (t.free(x, y)) hp = [x, y];
      }
    t.tp(h.i, hp[0], hp[1]);
    t.aiTick(h.i, 40, 0.05);
    const doing = g.agents[h.i]._doing;
    g.agents[h.i].doing = 0.02;
    t.aiTick(h.i, 4, 0.05);
    return { st0, doing, after: t.lights().state, lightGo: g.agents[h.i]._lightGo,
      inv: t.inv() };
  });
  ok(LB.st0 === 2 && LB.doing === 'breaker', '断电时 AI 人类走到电闸前开始合闸（3 秒站桩）');
  ok(LB.after !== 2 && !LB.lightGo, '合闸完成：全船照明恢复，响应标记清空');
  ok(LB.inv.fails.length === 0, 'AI 合闸后不变量全过');

  section('AI 异形 · 主动寻管道口');
  await fresh(false);
  const PIP = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k && a !== v) t.tp(a.i, 30,32);
    t.clearDrags(); t.resetAiState(k.i);
    k.knife = 1; k.sabUsed = true; k._delay = 0; k._rest = 0; k._pipeCD = 0;
    let kp = null;
    for (let r = 0; r <= 3.2 && !kp; r += 0.2)
      for (let i = 0; i < 24 && !kp; i++) {
        const a = i / 24 * Math.PI * 2, x = 8 + Math.cos(a) * r, y = 52 + Math.sin(a) * r;
        if (t.free(x, y)) kp = [x, y];
      }
    t.tp(k.i, kp[0], kp[1]); t.tp(v.i, 84,31);
    k.target = v;                    /* 目标锁定监控室的人：验证它会规划到管道口 */
    let last = null;
    for (let i = 0; i < 600; i++) {
      last = t.aiTickAlien(k.i, 1, 0.05);
      if (last.pipeSeeks >= 1) break;
    }
    const pipes = t.pipes();
    const at = pipes.find(p => Math.hypot(p.x - k.x, p.y - k.y) < 0.05);
    return { seeks: last.pipeSeeks, at, cd: k._pipeCD, room: t.state()[k.i].room,
      x: k.x, y: k.y, inv: t.inv() };
  });
  ok(PIP.seeks >= 1 && PIP.at && PIP.cd === 20,
    'AI 异形会自己寻路到管道口再钻（不再要求正好站在口上）');
  ok(PIP.room === 'cam', '管道出口按离目标最近选择（目标在监控室 → ' + PIP.room + '）');
  ok(PIP.inv.fails.length === 0, 'AI 主动钻管道后不变量全过');

  await fresh(false);
  const PIP0 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k && a !== v) t.tp(a.i, 30,32);
    t.clearDrags(); t.resetAiState(k.i);
    k.knife = 0; k.bullet = 0; k.medkit = 0; k.qual = 0; k.qualPending = 0;
    k.sabUsed = true; k._delay = 0; k._rest = 0; k._pipeCD = 0;
    k._fakeN = g.night; k._alienTaskN = g.night;   /* 排除伪装/做任务分支 */
    const pipes = t.pipes();
    const pin = pipes[0];
    t.tp(k.i, pin.x, pin.y); t.tp(v.i, 84,31);
    k.target = v;
    let last = null;
    for (let i = 0; i < 20; i++) {
      last = t.aiTickAlien(k.i, 1, 0.05);
      if (last.pipeSeeks >= 1) break;
    }
    const at = pipes.find(p => Math.hypot(p.x - k.x, p.y - k.y) < 0.05);
    return { seeks: last.pipeSeeks, at, cd: k._pipeCD, knife: k.knife, inv: t.inv() };
  });
  ok(PIP0.knife === 0 && PIP0.seeks >= 1 && PIP0.at && PIP0.cd === 20,
    '刀用完的异形也会钻管道（修复“没刀只会原地游荡”）');
  ok(PIP0.inv.fails.length === 0, '没刀异形钻管道后不变量全过');

  await fresh(false);
  const BUSYPRI = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true; g.dmg = [];
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const idle = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const busy = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== idle);
    for (const a of g.agents) if (a !== k && a !== idle && a !== busy) t.tp(a.i, 30,54);
    t.clearDrags(); t.resetAiState(k.i);
    g.secbotDead = true; g.medbotDead = true;
    k.knife = 1; k.bullet = 0; k.sabUsed = true; k._delay = 0; k._rest = 0;
    k._pipeCD = 0;
    t.tp(k.i, 30,52); t.tp(idle.i, 33,52); t.tp(busy.i, 40,52);
    idle.doing = 0; idle._doing = null;
    busy.doing = 5; busy._doing = 'task';
    t.aiTickAlien(k.i, 1, 0.05);
    return { target: k.target ? k.target.i : null, idle: idle.i, busy: busy.i };
  });
  ok(BUSYPRI.target === BUSYPRI.busy,
    '异形优先挑选正在做任务的人（8 格外的任务者优先于 3 格外的闲人）');

  section('破坏技 · 选舱 / 30 秒 / 连续 10 秒维修');
  await fresh(false);
  const SAB0 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const swap = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    swap.alien = false; /* 保持 4 异形 / 11 人类，不触发不变量 */
    g.me.alien = true; g.me.sabUsed = false;
    g.me.doing = 0; g.me._doing = null; g.me.path = null;
    g.dmg = []; g.sabTarget = null;
    t.tp(0, 30,32);
    const open = t.openSab();
    return { open, pick: t.sabPick(), msg: g.msg, inv: t.inv() };
  });
  await page.waitForTimeout(150);
  const SAB0b = await T(() => ({
    ui: !document.getElementById('sabot').classList.contains('hide'),
    buttons: document.querySelectorAll('#sabot-list button').length,
    tip: document.getElementById('tip').textContent
  }));
  ok(SAB0.open && SAB0.pick.rooms.length === 9 && SAB0.pick.rooms.indexOf('bridge') < 0,
    '玩家异形按 F 打开舱室列表：9 个舱室，中央会议室被排除');
  ok(SAB0b.ui && SAB0b.buttons === 9 && SAB0b.tip.indexOf('破坏选择') >= 0,
    '破坏面板：9 个按钮 + 提示栏切换到破坏说明');
  ok(SAB0.inv && SAB0.inv.fails.length === 0, '打开破坏面板后不变量全过');
  await shot('46_破坏选舱.png');
  const SAB1 = await T(() => {
    const t = SKV3._t, g = t.G();
    const sp = t.sabSpot('power');
    const picked = t.pickSab('power');
    const target = t.sabTarget();
    t.tp(0, sp.x, sp.y);
    t.sabTick();
    return { picked, target, after: t.sabTarget(), sp, dmg: t.dmg(), sab: g.me.sabUsed,
      fx: t.fx(), msg: g.msg, inv: t.inv() };
  });
  ok(SAB1.picked && SAB1.target && SAB1.target.room === 'power',
    '选择配电室后生成目标：进入舱室自动下手');
  ok(SAB1.dmg.length === 1 && SAB1.dmg[0].room === 'power' &&
    SAB1.dmg[0].label === SAB1.sp.label && SAB1.dmg[0].dur === 30 && SAB1.sab && !SAB1.after,
    '抵达目标舱室损毁对应设备：消耗本夜破坏技并清除目标（30 秒窗口）');
  ok(SAB1.fx.includes('spark') && SAB1.fx.includes('alarm') &&
    SAB1.msg.indexOf('30 秒') >= 0, '破坏反馈：火花 + 警报环 + 30 秒维修窗口播报');
  ok(SAB1.inv && SAB1.inv.fails.length === 0, '破坏舱室后不变量全过');
  await page.waitForTimeout(180);
  const SAB1b = await T(() => ({
    dmg: SKV3._t.dmg(),
    hud: document.getElementById('dmgline').textContent,
    show: !document.getElementById('dmgline').classList.contains('hide'),
    room: SKV3._t.roomName('power')
  }));
  ok(SAB1b.show && SAB1b.hud.indexOf('故障') >= 0 && SAB1b.hud.indexOf(SAB1b.room) >= 0 &&
    SAB1b.dmg[0] && SAB1b.dmg[0].left < 30,
    'HUD 故障条显示舱室/设备/剩余秒数，倒计时随时间下降');
  await shot('46b_故障倒计时.png');
  const SAB2 = await T(() => {
    const t = SKV3._t, g = t.G();
    t.sabotage();
    return { open: !!g.sabPick, msg: g.msg, inv: t.inv() };
  });
  ok(!SAB2.open && SAB2.msg.indexOf('今晚已经破坏过了') >= 0,
    '破坏技每夜一次：用过后再按 F 被拒绝');
  await T(() => {
    const g = SKV3._t.G();
    g.prog = 10;
    g.dmg[0].left = 0.05;
  });
  await page.waitForTimeout(340);
  const SAB3 = await T(() => ({ prog: SKV3._t.G().prog, dmg: SKV3._t.dmg().length,
    msg: SKV3._t.G().msg, inv: SKV3._t.inv() }));
  ok(SAB3.prog === 5 && SAB3.dmg === 0 && SAB3.msg.indexOf('维修进度 -5') >= 0,
    '30 秒内未修复且仍在天黑：维修进度 -5');
  ok(SAB3.inv && SAB3.inv.fails.length === 0, '超时扣分后不变量全过');

  await fresh(false);
  const SAB4 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true; g.dmg = [];
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive && !a.downed);
    k.sabUsed = false; k.doing = 0; k._doing = null;
    const made = t.damageRoom(k.i, 'med');
    const d = t.dmg().find(q => q.room === 'med');
    t.tp(0, d.x, d.y);
    g.me.doing = 0; g.me._doing = null; g.me.path = null;
    const first = t.interact();
    const fixing = t.fixing();
    t.finishDoing(0);
    return { made, d, first, fixing, dmg: t.dmg(), fx: t.fx(), msg: g.msg, inv: t.inv() };
  });
  ok(SAB4.made && SAB4.first.do === 'fix' && Math.abs(SAB4.first.doing - 10) < 0.001 &&
    SAB4.fixing.length === 1 && Math.abs(SAB4.fixing[0].t - 10) < 0.001,
    '人类按 E 维修故障：连续 10 秒计时，维修者状态可查');
  ok(SAB4.dmg.length === 0 && SAB4.fx.includes('heal') && SAB4.msg.indexOf('故障已修复') >= 0,
    '修满 10 秒后故障消失：治疗环特效 + 播报');
  ok(SAB4.inv && SAB4.inv.fails.length === 0, '维修故障后不变量全过');
  const SAB5 = await T(() => {
    const t = SKV3._t, g = t.G();
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive && !a.downed);
    k.sabUsed = false; g.dmg = [];
    t.damageRoom(k.i, 'fun');
    const d = t.dmg()[0];
    t.tp(0, d.x, d.y);
    g.me.path = null; g.me.doing = 0; g.me._doing = null;
    t.interact();
    g.me.path = [[d.x + 2, d.y]];
    return { dmg: t.dmg().length, doing: g.me.doing, do: g.me._doing };
  });
  await page.waitForTimeout(180);
  const SAB5b = await T(() => ({ doing: SKV3._t.G().me.doing, do: SKV3._t.G().me._doing,
    msg: SKV3._t.G().msg, dmg: SKV3._t.dmg().length }));
  ok(SAB5.doing > 9 && SAB5.do === 'fix' && SAB5b.doing === 0 && SAB5b.do === null &&
    SAB5b.msg.indexOf('移动打断') >= 0 && SAB5b.dmg === 1,
    '维修必须连续：移动会打断计时，故障保留');
  const SAB6 = await T(() => {
    const t = SKV3._t, g = t.G();
    const swap = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    swap.alien = false; g.me.alien = true;
    g.me.sabUsed = false; g.me.doing = 0; g.me._doing = null;
    t.kill(0, 'knife');
    t.sabotage();
    return { ghost: !g.me.alive && !!g.me.ghost, open: !!g.sabPick,
      msg: g.msg, inv: t.inv() };
  });
  ok(SAB6.ghost && !SAB6.open && SAB6.msg.indexOf('幽灵无法破坏') >= 0,
    '幽灵不能施展破坏：按 F 被明确拒绝');
  ok(SAB6.inv && SAB6.inv.fails.length === 0, '幽灵拒绝破坏后不变量全过');

  await fresh(false);
  const SAB7 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true; g.dmg = [];
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive && !a.downed);
    k.sabUsed = false;
    t.damageRoom(k.i, 'engine');
    const d = g.dmg[0];
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && !a.downed);
    t.tp(h.i, d.x, d.y);
    h._delay = 0; h._rest = 0; h.path = null; h.doing = 0; h._doing = null;
    h.medkit = 0; h.suspect = null;
    const first = t.aiTick(h.i, 1, 0.05);
    const mid = t.fixing();
    const r = t.aiTick(h.i, 230, 0.05);
    return { h: h.i, first, mid, dmg: t.dmg().length, fx: t.fx(), msg: g.msg, inv: t.inv() };
  });
  ok(SAB7.first.do === 'fix' && SAB7.mid.some(x => x.i === SAB7.h),
    'AI 人类自动响应故障：抵达后开始连续维修');
  ok(SAB7.dmg === 0 && SAB7.fx.includes('heal'), 'AI 人类修满 10 秒后故障清除');
  ok(SAB7.inv && SAB7.inv.fails.length === 0, 'AI 抢修后不变量全过');
  const SAB8 = await T(() => {
    const t = SKV3._t, g = t.G();
    const swap = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    swap.alien = false; g.me.alien = true;
    g.me.sabUsed = false; g.me.doing = 0; g.me._doing = null; g.me.path = null;
    g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    k.sabUsed = false; g.dmg = [];
    t.damageRoom(k.i, 'armory');
    const d = g.dmg[0];
    t.tp(0, d.x, d.y);
    const first = t.interact();
    t.finishDoing(0);
    return { first, dmg: t.dmg().length, msg: g.msg, inv: t.inv() };
  });
  ok(SAB8.first.do === 'fix' && SAB8.dmg === 0 && SAB8.msg.indexOf('故障已修复') >= 0,
    '异形同样可以维修故障：人类/异形共用连续 10 秒规则');
  ok(SAB8.inv && SAB8.inv.fails.length === 0, '异形维修后不变量全过');

  await fresh(false);
  const SAB9 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.dmg = []; g.prog = 10;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    k.sabUsed = false;
    t.damageRoom(k.i, 'transit');
    g.dmg[0].left = 0.01;
    g.t = 0;
    t.dmgTick(1);
    return { prog: g.prog, dmg: t.dmg().length };
  });
  ok(SAB9.prog === 10 && SAB9.dmg === 0, '天亮前未修完的故障不扣分：随夜晚结束清除');

  section('胜负 · 维修 45 分');
  await fresh(false);
  const WIN45 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true;
    g.prog = 44;
    const before = t.checkWin();
    const over44 = g.over;
    g.prog = 45;
    const hit = t.checkWin();
    return { before, over44, hit, over: g.over, why: g.overWhy };
  });
  ok(WIN45.before === false && !WIN45.over44 && WIN45.hit === true &&
    WIN45.over && /45/.test(WIN45.why || ''),
    '人类维修进度必须达到 45 分才胜利（40 分不再直接结束）');
  await fresh(false);

  /* HUD 的进度上限必须是胜利目标分：曾经模板里写死「/ 40」而实际按 45 结算 */
  const HUD45 = await T(() => ({
    win: SKV3._t.winPts(),
    max: document.getElementById('pgmax').textContent,
    line: document.getElementById('pg').parentElement.textContent.replace(/\s+/g, ' ').trim(),
    bar: document.getElementById('pgi').style.width
  }));
  ok(HUD45.win === 45 && HUD45.max === String(HUD45.win) &&
    HUD45.line.indexOf('/ ' + HUD45.win) >= 0,
    'HUD 维修进度上限与胜利目标同源（winPts=' + HUD45.win + ' · HUD="' + HUD45.line + '"）');

  /* 幽灵不留脚步声纹：它们飘在墙里，响起来会让活人误读"这里有人在走"。
     对照组必须仍然响，否则就是把整条声纹链路关掉了。 */
  await fresh(false);
  const GWAVE = await T(() => {
    const t = SKV3._t, g = t.G();
    g.paused = true; g.noReport = true;
    /* 不改任务表（会破坏对账不变量），而是把人放到离自己任务点最远的一端，
       让它必须走一段路——否则它会站在任务点上原地不动，对照组就不成立。 */
    const sendFar = (a) => {
      const pi = a.tasks[Math.min(a.tIdx, a.tasks.length - 1)];
      const p = SKMapData.points[pi];
      const cand = [[8, 52], [60, 84], [86, 52], [41, 8], [30, 55], [83, 30]];
      let best = null, bd = -1;
      for (const c of cand) {
        if (!t.free(c[0], c[1])) continue;
        const d = p ? Math.hypot(c[0] - p.x, c[1] - p.y) : 1;
        if (d > bd) { bd = d; best = c; }
      }
      if (best) t.tp(a.i, best[0], best[1]);
      a._delay = 0; a._rest = 0; a.path = null;
      return bd ? +bd.toFixed(1) : 0;
    };
    const drive = (a, ghost) => {
      const p0 = [a.x, a.y];
      g.waves.length = 0;
      for (let n = 0; n < 400; n++) {
        if (ghost) t.aiGhostTick(a.i, 1, 0.05); else t.aiTick(a.i, 1, 0.05);
      }
      return { moved: +Math.hypot(a.x - p0[0], a.y - p0[1]).toFixed(2),
        steps: g.waves.filter(w => w.kind === 'step').length };
    };
    /* 声纹只对玩家 14 格内的动静生效：把人放到离玩家远处，对照组就会 0 圈而误判。
       所以驱动活人前，先把玩家挪到他旁边（找 8 格内的可站点）。 */
    const near = (a) => {
      for (const r of [4, 5, 6, 7, 8]) {
        for (let i = 0; i < 12; i++) {
          const ang = i / 12 * Math.PI * 2;
          const x = a.x + Math.cos(ang) * r, y = a.y + Math.sin(ang) * r;
          if (t.free(x, y)) { t.tp(0, x, y); return; }
        }
      }
      t.tp(0, 41, 33);
    };
    /* 必须挑人类：异形幽灵是"直接待机"的，走不动就证明不了脚步被过滤 */
    const dead = g.agents.find(a => a.i !== 0 && a.alive && !a.downed && !a.alien);
    sendFar(dead);
    t.tp(0, 30, 32);
    t.kill(dead.i, 'knife');
    sendFar(dead);
    near(dead);
    const ghost = drive(dead, true);
    const live = g.agents.find(a => a.i !== 0 && a.alive && !a.downed && !a.alien && a !== dead);
    sendFar(live);
    near(live);
    const human = drive(live, false);
    return { alive: dead.alive, ghost, human, inv: t.inv() };
  });
  ok(GWAVE.alive === false && GWAVE.ghost.moved > 1 && GWAVE.ghost.steps === 0,
    '幽灵走了 ' + GWAVE.ghost.moved + ' 格，声纹 0 圈（脚步不计幽灵）');
  ok(GWAVE.human.moved > 1 && GWAVE.human.steps > 0,
    '对照组：活人走 ' + GWAVE.human.moved + ' 格仍留下 ' + GWAVE.human.steps + ' 圈脚步声纹');
  ok(GWAVE.inv && GWAVE.inv.fails.length === 0, '声纹测试后不变量全过' +
    (GWAVE.inv.fails.length ? '（失败项：' + GWAVE.inv.fails.slice(0, 4).map(f => f.code + ':' + f.msg).join(' | ') + '）' : ''));
  ok(GWAVE.alive === false && GWAVE.ghost.moved > 1 && GWAVE.ghost.steps === 0,
    '幽灵走了 ' + GWAVE.ghost.moved + ' 格，声纹 0 圈（脚步不计幽灵）');
  ok(GWAVE.human.moved > 1 && GWAVE.human.steps > 0,
    '对照组：活人走 ' + GWAVE.human.moved + ' 格仍留下 ' + GWAVE.human.steps + ' 圈脚步声纹');
  ok(GWAVE.inv && GWAVE.inv.fails.length === 0, '声纹测试后不变量全过' +
    (GWAVE.inv.fails.length ? '（失败项：' + GWAVE.inv.fails.slice(0, 4).map(f => f.code + ':' + f.msg).join(' | ') + '）' : ''));

  section('视野 · 暗处不能隔空开枪');
  await fresh(false);
  const VIS0 = await T(() => {
    const t = SKV3._t, g = t.G();
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== g.me && a !== k) t.tp(a.i, 30,32);
    /* 放在医疗间南侧、远离悬停在房间正中央的医疗无人机：枪口贴近机器人会被判成打机器人，
       这条测的是「暗处看不见的人不能隔空打中」，不要让它被无人机抢走命中 */
    t.tp(0, 49,88.4); t.tp(k.i, 54, 88.4);
    g.me.bullet = 1;
    t.breaker(); /* 断电后只有 2.8 格近身视野 + 7 格手电锥；目标在 5 格背后 */
    g.aimX = g.me.x - 1; g.aimY = g.me.y;
    t.shoot();
    const dark = { bullet: g.me.bullet, downed: g.agents[k.i].downed, msg: g.msg,
      light: t.lights().state };
    g.aimX = g.me.x + 1; g.aimY = g.me.y;
    t.shoot();
    const lit = { bullet: g.me.bullet, downed: g.agents[k.i].downed, msg: g.msg };
    return { dark, lit, inv: t.inv() };
  });
  ok(VIS0.dark.light === 2 && VIS0.dark.bullet === 1 && !VIS0.dark.downed &&
    VIS0.dark.msg.indexOf('视野内没有目标') >= 0,
    '暗处背对目标：子弹不消耗、目标不受伤');
  ok(VIS0.lit.bullet === 0 && VIS0.lit.downed,
    '同一距离把手电转向目标：正常命中');
  ok(VIS0.inv && VIS0.inv.fails.length === 0, '视野射击判定后不变量全过');

  section('异形身份 · 互不知道 / 行为推断 / 互刀 / 统一移速 / 保安识别范围');
  await fresh(false);
  const AB = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    /* 玩家变异形：降级一名 AI 异形，保持 4 异形 / 11 人类 */
    const demoted = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    demoted.alien = false;
    g.me.alien = true;
    const actor = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const human = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    /* 同一处亲眼目击一次异形专属破坏：只有人类写入 suspect */
    t.tp(actor.i, 57.2, 85);
    t.tp(human.i, 58.1, 85.5);
    actor.sabUsed = false; g.dmg = [];
    const okDmg = t.damageRoom(actor.i, 'med');
    return { okDmg, actor: actor.i, human: human.i,
      humanSuspect: human.suspect, humanAllies: human.allies || null,
      range: t.secRange(), speed: t.speed(),
      role: document.getElementById('role').textContent,
      tip: document.getElementById('tip').textContent, inv: t.inv() };
  });
  ok(AB.speed === 4.2, '全场统一移动速度常量 = ' + AB.speed + ' 格/秒');
  ok(AB.range === 10.5, '保安机器人行凶识别半径 = ' + AB.range + ' 格（14 → 10.5，削 1/4）');
  ok(AB.okDmg && AB.humanSuspect === AB.actor, '人类目击异形专属破坏 → 写入嫌疑人');
  ok(AB.humanAllies == null, '人类不会被写入盟友表（只有 suspect）');
  ok(AB.role.indexOf('天眼') < 0 && AB.tip.indexOf('天眼') < 0, '玩家异形没有天眼 / 队友透视 UI');
  ok(AB.inv && AB.inv.fails.length === 0, '行为推断状态不变量全过');
  const AIP = await T(() => {
    const t = SKV3._t, g = t.G();
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive && !a.downed);
    const mate = g.agents.find(a => a.alien && a.i !== 0 && a.alive && a !== k);
    for (const a of g.agents) if (a !== k && a !== mate) { a.path = null; a.x = 28.2; a.y = 44.0; }
    t.tp(k.i, 34,34); t.tp(mate.i, 36,34);
    k.target = null; k.sabUsed = true; k._delay = 0; k.doing = 0;
    k._doing = null; k.path = null; k.knife = 1; k.detained = false;
    t.aiTickAlien(k.i, 1, 0.05);
    const targetIsMate = !!(k.target && k.target.i === mate.i);
    /* 所有人类放倒，异形只能互相指控/投票：不允许队友豁免 */
    for (const h of g.agents) if (!h.alien) { h.downed = true; h.downAt = g.t; h.path = null; }
    t.openMeeting('night');
    const acc = g.agents.filter(a => a.alien && a.alive && !a.downed)
      .map(a => ({ i: a.i, accuse: a.accuse }));
    const accTargetsAliens = acc.filter(x => x.accuse != null && g.agents[x.accuse].alien).length;
    t.startVote();
    const votes = Object.entries(g.meet.votes)
      .filter(([k]) => g.agents[+k].alien)
      .map(([k, v]) => ({ voter: +k, target: +v, targetAlien: !!(g.agents[v] && g.agents[v].alien) }));
    t.finishMeeting();
    return { targetIsMate, mate: mate.i, acc, accTargetsAliens, votes,
      distinct: new Set(votes.map(v => v.target)).size, inv: t.inv() };
  });
  ok(AIP.targetIsMate, 'AI 异形没有队友信息：最近的同类也会成为目标');
  ok(AIP.accTargetsAliens >= 1, '会议指控可以指向异形（没有队友豁免）');
  ok(AIP.votes.length >= 3 && AIP.votes.every(v => v.targetAlien),
    '异形投票可以投队友，不再系统性避开同类');
  ok(AIP.distinct >= 2, '异形投票目标不统一，避免串通感');
  ok(AIP.inv && AIP.inv.fails.length === 0, 'AI 投票独立性不变量全过');

  section('异形开枪 · B 键独立于出刀');
  await fresh(false);
  const AS0 = await T(() => {
    const t = SKV3._t, g = t.G();
    const demoted = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    demoted.alien = false;
    g.me.alien = true; g.me.bullet = 1; g.me.knife = 1;
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== g.me && a !== v) { a.path = null; a.x = 28.2; a.y = 44.0; }
    t.tp(0, 34.8,33.8); t.tp(v.i, 32.0,33.8);
    g.aimX = 32; g.aimY = 11.8;
    return { v: v.i, bullet: g.me.bullet, knife: g.me.knife };
  });
  await page.keyboard.press('b');
  await page.waitForTimeout(160);
  const AS1 = await T(o => ({ bullet: SKV3._t.G().me.bullet, knife: SKV3._t.G().me.knife,
    downed: SKV3._t.state()[o.v].downed, msg: SKV3._t.G().msg, inv: SKV3._t.inv() }), AS0);
  ok(AS1.bullet === 0 && AS1.knife === 1 && AS1.downed && AS1.msg.indexOf('开枪') >= 0,
    '异形有子弹时按 B 可以开枪（子弹 -1，刀保留）');
  ok(AS1.inv && AS1.inv.fails.length === 0, '异形开枪后不变量全过');
  await fresh(false);
  const AS2 = await T(() => {
    const t = SKV3._t, g = t.G();
    const demoted = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    demoted.alien = false;
    g.me.alien = true; g.me.bullet = 1; g.me.knife = 1;
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== g.me && a !== v) { a.path = null; a.x = 28.2; a.y = 44.0; }
    t.tp(0, 34.8,33.8); t.tp(v.i, 35.6,33.8);
    g.aimX = 35.6; g.aimY = 11.8;
    return { v: v.i };
  });
  await page.keyboard.press('q');
  await page.waitForTimeout(160);
  const AS3 = await T(o => ({ bullet: SKV3._t.G().me.bullet, knife: SKV3._t.G().me.knife,
    downed: SKV3._t.state()[o.v].downed, msg: SKV3._t.G().msg, inv: SKV3._t.inv() }), AS2);
  ok(AS3.bullet === 1 && AS3.knife === 0 && AS3.downed && AS3.msg.indexOf('出刀') >= 0,
    '异形按 Q 仍只出刀，不会消耗子弹');
  ok(AS3.inv && AS3.inv.fails.length === 0, '异形出刀后不变量全过');
  const SPD = await T(() => {
    const t = SKV3._t, g = t.G();
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    h._delay = 999; h._rest = 0; h.doing = 0; h._doing = null; h.detained = false;
    t.tp(h.i, 30.4,33.8); h.path = [[33.4, 11.8]];
    const h0 = [h.x, h.y];
    t.aiTick(h.i, 4, 0.05);
    const humanD = Math.hypot(h.x - h0[0], h.y - h0[1]);
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive && !a.detained);
    k._delay = 999; k.doing = 0; k._doing = null; k.detained = false;
    t.tp(k.i, 30.4,35.4); k.path = [[33.4, 13.4]];
    const k0 = [k.x, k.y];
    t.aiTickAlien(k.i, 4, 0.05);
    const alienD = Math.hypot(k.x - k0[0], k.y - k0[1]);
    return { humanD, alienD, inv: t.inv() };
  });
  ok(Math.abs(SPD.humanD - 0.8) < 0.06 && Math.abs(SPD.alienD - 0.8) < 0.06,
    '玩家 / AI 人类 / AI 异形同速（4 格/秒）：0.2 秒位移 ' + SPD.humanD.toFixed(2) + ' / ' + SPD.alienD.toFixed(2) + ' 格');
  ok(SPD.inv && SPD.inv.fails.length === 0, '统一移速后不变量全过');
  const DRG = await T(() => ({ drag: SKV3._t.dragSpeed() }));
  ok(DRG.drag === 2.7, '拖拽尸体统一 2.7 格/秒（当前 ' + DRG.drag + '）');

  section('AI 认知 · 反常拖尸 / 藏尸避人');
  await fresh(false);
  const DS0 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.noReport = true; g.dmg = []; g.paused = true;
    g.secbotDead = true; g.medbotDead = true;
    const w = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== w);
    for (const a of g.agents) if (a !== w && a !== v && a !== g.me) t.tp(a.i, 30, 54);
    t.tp(v.i, 50, 86); t.kill(v.i, 'knife');
    t.tp(0, 50, 86); t.tp(w.i, 50, 33);
    g.me.path = null; g.me.doing = 0; g.me._doing = null;
    const started = t.dragStart(0, v.i);
    t.tp(0, 55, 33);          /* 把尸体从医疗间拖向桥楼：远离医疗间 */
    g.paused = false;
    return { started, w: w.i, v: v.i };
  });
  await page.waitForTimeout(220);
  const DS1 = await T(ids => {
    const t = SKV3._t, g = t.G(); g.paused = true;
    const w = g.agents[ids.w];
    const mem = (w.mind.mem || []).filter(e => e.kind === 'saw_drag_away');
    const evs = t.events().filter(e => e.kind === 'drag_away');
    t.dragRelease(0);
    return { n: mem.length, sus: w.mind.sus[0] || 0,
      known: !!(w.mind.known && w.mind.known[0]), evs: evs.length, inv: t.inv() };
  }, DS0);
  ok(DS0.started && DS1.n >= 1 && DS1.sus > 0.25 && !DS1.known,
    '看见有人把尸体拖离医疗间 → 记「反常拖尸」嫌疑，但不写确证（sus=' +
    DS1.sus.toFixed(2) + '）');
  ok(DS1.evs >= 1, '反常拖尸也进事件流，复盘能看到');
  ok(DS1.inv && DS1.inv.fails.length === 0, '反常拖尸嫌疑结算后不变量全过');

  const HIDE = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const M = window.SKMapData;
    for (const a of g.agents) if (a.alive) t.tp(a.i, 41, 8);     /* 仓库挤满活人 */
    const crowded = [];
    for (let i = 0; i < 40; i++) crowded.push(t.hideRoomFor('med', 50, 85));
    for (const a of g.agents) if (a.alive) t.tp(a.i, 30, 54);    /* 全员回桥楼 */
    const free = [];
    for (let i = 0; i < 40; i++) free.push(t.hideRoomFor('med', 50, 85));
    return { crowded, free, uniq: [...new Set(free)] };
  });
  ok(HIDE.crowded.indexOf('warehouse') < 0,
    '藏尸目的地避开有活人的房间（仓库有人时不选仓库）');
  ok(HIDE.uniq.length >= 2 && HIDE.uniq.indexOf('med') < 0 && HIDE.uniq.indexOf('bridge') < 0,
    '藏尸目的地不再固定仓库：多个远离医疗间的空房间随机（' + HIDE.uniq.join('/') + '）');

  const DDROP = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true; g.dmg = [];
    g.secbotDead = true; g.medbotDead = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const w = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== v);
    for (const a of g.agents) if (a !== k && a !== v && a !== w) t.tp(a.i, 30, 54);
    t.tp(k.i, 50, 85); t.tp(v.i, 50, 85); t.tp(w.i, 52, 85);
    t.kill(v.i, 'knife');
    t.resetAiState(k.i);
    k._delay = 0; k._rest = 0;
    t.dragStart(k.i, v.i);
    k.knife = 0; k.sabUsed = true;
    const r = t.aiTickAlien(k.i, 1, 0.05);
    const res = { drag: k.drag, hideCD: k._hideCD || 0, r };
    t.clearDrags();
    /* 下一个用例仍按“玩家是异形、场上仍是 4 异形”的准备执行 */
    const demoted = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    if (demoted) demoted.alien = false;
    g.me.alien = true; g.me.knife = 1; g.me.alive = true; g.me.downed = false;
    return res;
  });
  ok(DDROP.drag === null && DDROP.hideCD >= 6,
    '异形拖尸遇到活人目击会松手走开（不拖着尸体穿过人堆）');

  const ST = await T(() => {
    const t = SKV3._t, g = t.G();
    const v = g.agents.find(a => a.alien && a.i !== 0 && a.alive && !a.downed && !a.detained);
    for (const a of g.agents) if (a !== g.me && a !== v) { a.path = null; a.x = 28.2; a.y = 44.0; }
    t.tp(0, 34.8,33.8);
    t.tp(v.i, 35.55,33.8);
    g.me.knife = 1; g.me.doing = 0; g.me._doing = null; g.me.path = null;
    v._delay = 999; v.path = null; v.doing = 0; v._doing = null; v.detained = false;
    const r = t.attack();
    return { v: v.i, r, st: t.state()[v.i], inv: t.inv() };
  });
  ok(ST.st.downed && ST.r.knife === 0, '异形可以对比邻的异形队友出刀（' + (ST.st.downed ? '目标濒死' : '未命中') + '）');
  ok(ST.inv && ST.inv.fails.length === 0, '异形互刀后不变量全过');

  await fresh(false);
  const SR0 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const sec = t.setBot('secbot', 80, 75);
    const sb = g.bots && g.bots.secbot;
    if (sb) { sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = 0; }
    let spot = null;
    for (let r = 0.4; r <= 2.4 && !spot; r += 0.2)
      for (let i = 0; i < 24 && !spot; i++) {
        const a = i / 24 * Math.PI * 2, x = 86.5 + Math.cos(a) * r, y = 76.5 + Math.sin(a) * r;
        if (t.free(x, y)) spot = [x, y];
      }
    t.tp(k.i, spot[0], spot[1]);
    t.tp(v.i, 86.0,75.6);
    k.knife = 1;
    t.knife(k.i, v.i);
    return { k: k.i, sec, dist: Math.hypot(spot[0] - sec[0], spot[1] - sec[1]), inv: t.inv() };
  });
  await page.waitForTimeout(220);
  const SR1 = await T(o => {
    SKV3._t.botTick(2.0);          /* 追捕 → 压制：新动画需要时间推进 */
    return { detained: SKV3._t.detained(), used: SKV3._t.robots().sec.used, inv: SKV3._t.inv() };
  }, SR0);
  ok(SR0.dist > 6 && SR0.dist < 9 && SR1.detained.some(d => d.i === SR0.k) && SR1.used,
    '保安识别范围增强：' + SR0.dist.toFixed(1) + ' 格外行凶仍被拘留');
  ok(SR1.inv && SR1.inv.fails.length === 0, '远距离拘留后不变量全过');
  await fresh(false);
  const SR2 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const sec = t.setBot('secbot', 75, 53);
    const sb = g.bots && g.bots.secbot;
    if (sb) { sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = 0; }
    t.tp(k.i, 90.5,75);
    t.tp(v.i, 89.9,74.5);
    k.knife = 1;
    t.knife(k.i, v.i);
    t.botTick(0.2);
    return { k: k.i, dist: Math.hypot(90.5 - sec[0], 53 - sec[1]),
      detained: t.detained(), used: t.robots().sec.used, inv: t.inv() };
  });
  ok(SR2.dist > 14 && SR2.detained.length === 0 && !SR2.used,
    '超出识别半径（' + SR2.dist.toFixed(1) + ' 格）行凶不会被拘留');
  ok(SR2.inv && SR2.inv.fails.length === 0, '超距行凶后不变量全过');
  await fresh(false);
  const KIN = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const h1 = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const h2 = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== h1);
    for (const a of g.agents) if (a !== k && a !== h1 && a !== h2) t.tp(a.i, 28.2,44);
    t.tp(k.i, 34,34); t.tp(h1.i, 36,34); t.tp(h2.i, 36,36);
    h1.detained = true; h1.detainedT = 60;
    k.target = null; k.knife = 1; k.sabUsed = true; k._delay = 0;
    k.doing = 0; k._doing = null; k.path = null;
    t.aiTickAlien(k.i, 1, 0.05);
    return { target: k.target ? k.target.i : null, h1: h1.i, h2: h2.i };
  });
  ok(KIN.target === KIN.h2, 'AI 异形会回避被拘留者，优先找其他活人');
  await fresh(false);
  const SARC = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const sec = t.setBot('secbot', 80, 75, 0);
    const sb = g.bots.secbot; if (sb) { sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = 0; }
    const freeNear = (x, y) => {
      for (let r = 0.4; r <= 2.4; r += 0.2)
        for (let i = 0; i < 20; i++) {
          const a = i / 20 * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
          if (t.free(px, py)) return [px, py];
        }
      return [x, y];
    };
    const kp = freeNear(76.5, 75), vp = freeNear(76.5, 76);
    t.tp(k.i, kp[0], kp[1]); t.tp(v.i, vp[0], vp[1]);
    k.knife = 1; t.knife(k.i, v.i); t.botTick(0.2);
    return { dist: Math.hypot(kp[0] - sec[0], kp[1] - sec[1]),
      detained: t.detained(), used: t.robots().sec.used, inv: t.inv() };
  });
  ok(SARC.dist < 14 && SARC.detained.length === 0 && !SARC.used,
    '保安背后 180° 弧形外行凶（' + SARC.dist.toFixed(1) + ' 格）不会被拘留');
  ok(SARC.inv && SARC.inv.fails.length === 0, '弧形外行凶后不变量全过');
  await fresh(false);

  section('声纹 · 附近多声源同时可见');
  await fresh(false);
  const WV = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const me = g.me;
    const n0 = g.waves.length;
    t.hear(me.x + 2, me.y, 'pipe', 1);
    t.hear(me.x - 2, me.y + 1, 'robot', 1);
    t.hear(me.x, me.y + 2.5, 'alarm', 1);
    return { n0, ws: t.waves(), pos: [me.x, me.y] };
  });
  const wKinds = WV.ws.map(w => w.kind);
  ok(WV.ws.length >= WV.n0 + 3 && ['pipe', 'robot', 'alarm'].every(k => wKinds.includes(k)),
    '3 个方向的声音同时生成 3 条声纹（' + WV.n0 + ' → ' + WV.ws.length + '）');
  await T(() => {
    const g = SKV3._t.G();
    g.waves.forEach(w => { w.t = Math.min(w.t, 0.2); w.dur = 6; });
    g.fx.length = 0;
  });
  await page.waitForTimeout(140);
  await shotClip('46_声纹.png', { x: 460, y: 250, width: 520, height: 400 });
  await T(() => { SKV3._t.G().waves.forEach(w => { w.t = 99; }); });
  await page.waitForTimeout(180);
  const WV2 = await T(() => SKV3._t.waves().map(w => w.kind));
  ok(!WV2.includes('pipe') && !WV2.includes('alarm'), '声纹按时间自动消散，不会堆在屏幕上');

  section('CC0 音效采样 · 枪 / 刀 / 环境材质分离');
  await page.waitForFunction(() => {
    const d = SKV3._t.sfx();
    const ks = Object.keys(d);
    return ks.length === 12 && ks.every(k => d[k].every(a => a.ready >= 1 || a.err));
  }, null, { timeout: 8000 }).catch(() => {});
  const AU = await T(() => SKV3._t.sfx());
  const auKeys = Object.keys(AU);
  const auBad = auKeys.flatMap(k => AU[k].filter(a => a.ready < 1 || a.err)
    .map(a => k + ':' + a.src + ' ready=' + a.ready + ' err=' + a.err));
  ok(auKeys.length === 12 && auKeys.every(k => AU[k].length >= 2),
    '12 类采样全部建立音频池（枪 / 刀 / 命中 / 脚步 / 交互 / 维修 / 结算…）');
  const gunSrc = (AU.gun || []).map(a => a.src);
  const knifeSrc = (AU.knife || []).map(a => a.src);
  ok(gunSrc.length >= 2 && gunSrc.every(x => x === 'audio/sfx-gun.ogg') &&
    knifeSrc.every(x => x !== 'audio/sfx-gun.ogg') &&
    !!AU.flesh && !!AU.ui && !!AU.work && !!AU.win && !!AU.lose,
    '枪声用独立 gun 采样（刀声不再共用），命中/交互/维修/胜负各有专属池');
  ok(auBad.length === 0, '采样在 file:// 下全部加载，无解码错误' + (auBad.length ? '：' + auBad.join(' | ') : ''));
  const PL = await T(() => ['knife', 'shot', 'flesh', 'step', 'ui', 'work', 'drag', 'report', 'win', 'lose']
    .map(n => SKV3._t.playSfx(n)));
  ok(PL.every(Boolean), '出刀 / 开枪 / 命中 / 脚步 / 交互 / 维修 / 拖拽 / 报告 / 胜负 音效可触发');
  const KL = await T(() => {
    const t = SKV3._t, g = t.G();
    const k = g.agents.find(a => a.alien && a !== g.me && a.alive && !a.downed);
    const v = g.agents.find(a => !a.alien && a !== g.me && a.alive && !a.downed);
    k.knife = 1;
    t.sfxClear();
    t.knife(k.i, v.i);
    return { log: t.sfxLog(), kinds: t.fx() };
  });
  ok(KL.log.length === 1 && KL.log[0] === 'knife',
    '一次出刀只响一次（播放日志：' + KL.log.join(',') + '）');
  const SL = await T(() => {
    SKV3._t.sfxClear();
    SKV3._t.playSfx('step');
    SKV3._t.playSfx('drag');
    SKV3._t.playSfx('step');
    return SKV3._t.sfxLog();
  });
  ok(SL.join(',') === 'step,drag,step', '脚步 / 拖拽 / 出刀走独立音源与日志');

  section('设置面板 · 音乐 / 音效 / 暂停 / 退出');
  await fresh(false);
  const SET1 = await T(() => {
    const sid = document.getElementById('settings');
    return { hasMenuBtn: !!document.getElementById('btn-settings'),
      z: +(getComputedStyle(sid).zIndex || 0),
      hasBgm: !!document.getElementById('bgm') };
  });
  ok(SET1.hasMenuBtn && SET1.z >= 10000,
    '开始页有设置入口，设置层层级高于游戏根节点（z=' + SET1.z + '）');
  ok(SET1.hasBgm, '背景音乐元素已挂载（audio/music-bgm.m4a）');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(160);
  await page.click('#p-set');
  const SET2 = await T(() => ({
    open: !document.getElementById('settings').classList.contains('hide'),
    paused: SKV3.isPaused(),
    label: document.getElementById('set-pause').textContent
  }));
  ok(SET2.open && SET2.paused, '暂停面板「设置」打开设置层，游戏保持暂停');
  const SET3 = await T(() => {
    const s = document.getElementById('set-sfx');
    s.value = 25; s.dispatchEvent(new Event('input'));
    const m = document.getElementById('set-music');
    m.value = 40; m.dispatchEvent(new Event('input'));
    let ls = null; try { ls = JSON.parse(localStorage.getItem('sk.settings.v1')); } catch (e) {}
    return { sfx: SKV3.getSfxVolume(), ls,
      sfxLabel: document.getElementById('set-sfx-v').textContent };
  });
  ok(Math.abs(SET3.sfx - 0.25) < 0.01 && SET3.ls && Math.abs(SET3.ls.sfx - 0.25) < 0.01,
    '音效滑杆实时生效并写入 localStorage（master=' + SET3.sfx + '）');
  ok(SET3.ls && Math.abs(SET3.ls.music - 0.4) < 0.01,
    '音乐滑杆同样持久化（music=' + (SET3.ls && SET3.ls.music) + '）');
  await page.keyboard.press('Escape');
  const SET4 = await T(() => ({
    open: !document.getElementById('settings').classList.contains('hide'),
    paused: SKV3.isPaused()
  }));
  ok(!SET4.open && SET4.paused, 'ESC 先关设置层，游戏仍保持暂停');
  const SET5 = await T(() => {
    SKV3.setSfxVolume(0.8);
    document.getElementById('set-sfx').value = 80;
    document.getElementById('set-sfx').dispatchEvent(new Event('input'));
    return { v: SKV3.getSfxVolume() };
  });
  ok(Math.abs(SET5.v - 0.8) < 0.01, '音效音量可恢复（不影响后续音频断言）');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(140);
  ok((await T(() => SKV3.isPaused())) === false, '再按 ESC 继续游戏');

  section('视野 · 异形与人类同款手电锥 + 近身感知 ×10/9');
  await fresh(false);
  const VIS2 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k && a !== h && a !== g.me) t.tp(a.i, 30,32);
    t.tp(k.i, 64,32); t.tp(h.i, 64,32);
    const alienFar = t.aiSee(k.i, 74, 32, 8);   /* 10 格，同一走廊：双方都超出 8 格 */
    const humanFar = t.aiSee(h.i, 74, 32, 8);
    const light = t.breaker();                  /* 断电：走廊灯熄灭，只剩近身视野 */
    const alienNear = t.aiSee(k.i, 67, 32, 8);  /* 3 格：异形近身 3.11 内可见 */
    const humanNear = t.aiSee(h.i, 67, 32, 8);  /* 3 格：人类 2.8 外不可见 */
    t.tp(0, 70,32);
    g.me.alien = false; g.aimX = 72; g.aimY = 32;
    const humanCone = t.visible(75, 32);        /* 手电朝东 5 格 */
    const humanBack = t.visible(68, 32);        /* 背后 2 格：人类近身 2.8 内 */
    const humanBackFar = t.visible(67, 32);     /* 背后 3 格：人类看不见 */
    g.me.alien = true;
    const alienCone = t.visible(75, 32);        /* 同款手电锥 */
    const alienBack = t.visible(67, 32);        /* 背后 3 格：异形近身 3.11 内 */
    const alienBackMid = t.visible(66, 32);     /* 背后 4 格：削短后异形也看不见 */
    const alienBackFar = t.visible(63.5, 32);   /* 背后 6.5 格：异形也看不见 */
    return { alienFar, humanFar, alienNear, humanNear, light,
      humanCone, humanBack, humanBackFar, alienCone, alienBack, alienBackMid, alienBackFar };
  });
  ok(!VIS2.alienFar && !VIS2.humanFar,
    '同样 10 格：异形与人类都超出 8 格视距，异形不再有 ×1.5 远视野');
  ok(VIS2.light.state === 2 && VIS2.alienNear && !VIS2.humanNear,
    '断电后 3 格：异形近身 3.11 格看得见，人类 2.8 格外看不见');
  ok(VIS2.alienCone && VIS2.humanCone,
    '同款手电锥：朝向 5 格内的目标都看得见');
  ok(VIS2.humanBack && !VIS2.humanBackFar,
    '人类近身 2.8 格：背后 2 格可见、3 格不可见');
  ok(VIS2.alienBack && !VIS2.alienBackMid && !VIS2.alienBackFar,
    '异形近身 3.11 格：背后 3 格可见、4 格与 6.5 格都不可见');

  section('视野 · 亮房整间可见 / 暗房才受视野限制');
  await fresh(false);
  const VIS3 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== h && a !== g.me) t.tp(a.i, 30,54);
    /* 中央会议室是亮房：圆桌挡在中间，旧逻辑会因家具挡视线而看不到人 */
    t.tp(0, 30,33); t.tp(h.i, 54,33);
    const litRoom = { vis: t.visible(h.x, h.y), los: t.los(30, 33, 54, 33),
      room: t.state()[0].room };
    /* 引擎舱是暗房：同房间 9 格外的目标超出视野，不可见 */
    const v2 = g.agents.find(a => a.i !== 0 && a.i !== h.i && a.alive && !a.alien);
    t.tp(v2.i, 14,53); t.tp(0, 5,53);
    const darkRoom = { vis: t.visible(14, 53), room: t.state()[0].room,
      dist: +Math.hypot(14 - 5, 53 - 53).toFixed(1) };
    return { litRoom, darkRoom };
  });
  ok(VIS3.litRoom.room === 'bridge' && VIS3.litRoom.vis && !VIS3.litRoom.los,
    '亮房整间可见：隔着圆桌也能看到 24 格外的队友（旧逻辑被家具挡住）');
  ok(VIS3.darkRoom.room === 'engine' && !VIS3.darkRoom.vis,
    '暗房仍受视野限制：同房间 ' + VIS3.darkRoom.dist + ' 格外的目标不可见');

  section('视野 · 亮走廊整条可见（走廊默认有灯）');
  await fresh(false);
  const VIS4 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== h && a !== g.me) t.tp(a.i, 30, 54);
    /* c3 是桥楼→监控室的 16 格直走廊：人站 64,32，目标 76,32（12 格），手电朝西背对目标 */
    t.tp(0, 64, 32); t.tp(h.i, 76, 32);
    g.aimX = 55; g.aimY = 32;
    const lit = { state: t.lights().state, corr: t.lights().corr };
    const far = t.visible(h.x, h.y);
    t.breaker();
    const dark = { state: t.lights().state, corr: t.lights().corr };
    const farDark = t.visible(h.x, h.y);
    return { lit, far, dark, farDark, dist: +Math.hypot(h.x - 64, h.y - 32).toFixed(1) };
  });
  ok(VIS4.lit.state !== 2 && VIS4.lit.corr && VIS4.far,
    '走廊默认有灯：站在亮走廊里能看清 ' + VIS4.dist + ' 格外的同廊目标（不必转手电）');
  ok(VIS4.dark.state === 2 && !VIS4.dark.corr && !VIS4.farDark,
    '断电后走廊不再整条可见：同廊 ' + VIS4.dist + ' 格外目标看不见');

  section('旁观者模式 · 第 16 人');
  await T(() => { SKV3.stop(); SKV3.start('spect'); });
  await page.waitForFunction(() => window.SKV3 && SKV3._t && SKV3._t.assets().base, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const SP1 = await T(() => ({
    spect: SKV3._t.spect(), role: document.getElementById('role').textContent,
    fog: SKV3._t.fog(), dev: !document.getElementById('dev').classList.contains('hide'),
    personal: document.getElementById('personal').classList.contains('hide'),
    tip: document.getElementById('tip').textContent, inv: SKV3._t.inv()
  }));
  ok(SP1.spect.mode && SP1.spect.agents === 15 && !SP1.fog,
    '旁观者不占席位：仍是 15 人，全知无雾');
  ok(SP1.role.indexOf('旁观者') >= 0 && SP1.personal,
    'HUD 切成旁观者：隐藏个人任务与背包');
  ok(SP1.dev && SP1.tip.indexOf('旁观者') >= 0,
    '旁观者强制显示全知总览面板与专属提示');
  const SP1b = await T(() => {
    const star = SKV3._t.G().agents[0].name;
    const row = [...document.querySelectorAll('#dev-rows .dr')]
      .map(e => e.textContent).find(s => s.indexOf(star) >= 0) || '';
    return { row, hasAI: row.indexOf('（AI）') >= 0, hasYou: row.indexOf('（你）') >= 0 };
  });
  ok(SP1b.hasAI && !SP1b.hasYou, '旁观模式下 0 号星尘标注为 AI，而不是“你”');
  ok(SP1.inv.fails.length === 0, '旁观者开局不变量全过');
  /* 先把相机幽灵放到地图中央（相机不贴边），再点屏幕右侧 5 格处 */
  const SP2 = await T(() => { SKV3._t.spectTo(49, 30); return { before: [49, 30] }; });
  await page.mouse.click(960, 450);
  /* 旁观幽灵 SPECT_SPEED=9 格/秒，但 update() 的 dt 有钳制：机器忙时（后台在烘图/出图）
     模拟时间会落后墙钟，430ms 只能走出 2 格。等到 900ms 再量，阈值不变，
     这样测的是"点哪直飞哪"，不是"这台机器此刻有多少帧预算"。 */
  await page.waitForTimeout(900);
  const SP3 = await T(o => ({ after: [SKV3._t.spect().x, SKV3._t.spect().y] }), SP2);
  const dist = Math.hypot(SP3.after[0] - SP2.before[0], SP3.after[1] - SP2.before[1]);
  ok(dist > 3, '旁观者点击直线飞行：0.43 秒移动 ' + dist.toFixed(1) + ' 格');
  const SP4 = await T(() => {
    const a = SKV3._t.G().agents[0];
    return { x: a.x, y: a.y };
  });
  await page.waitForTimeout(1600);
  const SP5 = await T(o => {
    const a = SKV3._t.G().agents[0];
    return { moved: Math.hypot(a.x - o.x, a.y - o.y) > 0.4, alive: a.alive,
      busy: !!a.doing || !!a.moving || !!a.path || a.tIdx > 0 || a._delay > 0 || a._rest > 0 };
  }, SP4);
  ok(SP5.moved || SP5.busy || !SP5.alive, '0 号席位由 AI 托管，旁观者不操控它');
  await page.keyboard.press('e'); await page.keyboard.press('x'); await page.keyboard.press('g');
  await page.waitForTimeout(260);
  const SP6 = await T(() => {
    const g = SKV3._t.G();
    return { do: g.me._doing, wheel: !!g.wheel, drag: g.drag, inspect: g.inspect };
  });
  ok(!SP6.do && !SP6.wheel && !SP6.drag && SP6.inspect === null,
    '旁观者不能交互 / 搜尸 / 收尸（按键全部无效）');
  await T(() => { SKV3._t.openMeeting('day', 0, null); });
  await page.waitForTimeout(900);
  const SP6b = await T(() => {
    const g = SKV3._t.G(), t = SKV3._t;
    const star = g.agents[0].name;
    return { star, aiCands: t.meetCtx().aiCands,
      lines: t.meetLines().map(l => l.who) };
  });
  ok(SP6b.aiCands.indexOf(0) >= 0 && SP6b.lines.indexOf(SP6b.star) >= 0,
    '0 号星尘进入 AI 发言池并实际发言');
  const SP7 = await T(() => ({
    input: document.getElementById('m-text').disabled,
    skipHidden: document.getElementById('m-skip').classList.contains('hide'),
    skipText: document.getElementById('m-skip').textContent,
    who: document.querySelectorAll('#m-who button').length
  }));
  ok(SP7.input && !SP7.skipHidden && /跳过讨论/.test(SP7.skipText) && SP7.who === 0,
    '旁观者会议只读，但保留「跳过讨论」按键');
  await T(() => document.getElementById('m-skip').click());
  await page.waitForTimeout(160);
  const SP8 = await T(() => ({
    phase: SKV3._t.G().meet ? SKV3._t.G().meet.phase : null,
    input: document.getElementById('m-text').disabled,
    who: document.querySelectorAll('#m-who button').length,
    starVote: SKV3._t.G().meet ? SKV3._t.G().meet.votes[0] : undefined
  }));
  ok(SP8.phase === 'vote' && SP8.input && SP8.who === 0 && SP8.starVote !== undefined,
    '旁观者跳过讨论后进入投票：星尘作为 AI 独立投票，旁观者仍只读');
  await T(() => SKV3._t.finishMeeting());
  await T(() => { SKV3.stop(); SKV3.start('human'); });
  await page.waitForFunction(() => window.SKV3 && SKV3._t && SKV3._t.assets().base, null, { timeout: 30000 });
  await page.waitForTimeout(320);
  ok((await T(() => SKV3._t.spect().mode)) === false, '退出旁观者后恢复人类对局');

  section('事件流 · 谁在哪做了什么（复盘数据源）');
  await T(() => { SKV3.stop(); SKV3.start('alien'); });
  await page.waitForFunction(() => window.SKV3 && SKV3._t && SKV3._t.assets().base, null, { timeout: 30000 });
  await page.waitForTimeout(320);
  const EV0 = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G();
    const evs = t.events();
    return { meAlien: !!g.me.alien, n: evs.length, first: evs[0] && evs[0].kind };
  });
  ok(EV0.meAlien && EV0.n === 1 && EV0.first === 'game_start',
    '新开一局事件流重新计数：只有开局一条（' + EV0.n + ' 条）');
  const EV1 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.paused = true; g.noReport = true; g.dmg = [];
    g.secbotDead = true; g.medbotDead = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const h1 = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== v);
    const h2 = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== v && a !== h1);
    const v2 = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== v && a !== h1 && a !== h2);
    for (const a of g.agents)
      if (a !== k && a !== v && a !== h1 && a !== h2 && a !== v2) t.tp(a.i, 30, 54);
    t.resetAiState(k.i);
    k.knife = 1;
    t.tp(k.i, 48, 84); t.tp(v.i, 50, 84);
    t.knife(k.i, v.i);
    t.dragStart(k.i, v.i);
    t.tp(k.i, 54, 85); t.tp(v.i, 54, 85);
    t.dragRelease(k.i);
    const off = t.breaker();
    const on = t.breaker();
    const sab = t.damageRoom(k.i, 'engine');
    const fixStart = t.startFix(h1.i, 'engine');
    t.aiTick(h1.i, 400, 0.05);
    const dmgLeft = t.dmg().length;
    const spot = t.taskSpot(h2.i);
    h2._delay = 0; h2._rest = 0; h2.doing = 0; h2.path = null;
    h2.doing = 0; h2._doing = null;
    /* 医疗间刚发生刀击：清掉这名 AI 的听觉现场，避免它 45 秒都在跑去围观而不做任务 */
    if (h2.mind) { h2.mind.alert = 0; h2.mind.noise = null; }
    h2._look = null; h2.suspect = null; h2.accuse = null;
    t.tp(h2.i, spot.x, spot.y);
    const tIdx0 = h2.tIdx;
    t.aiTick(h2.i, 900, 0.05);
    const tIdx1 = h2.tIdx;
    const pipes = t.pipes();
    t.tp(0, pipes[0].x, pipes[0].y);
    const pipeOpen = t.openPipe();
    const pipeGo = t.pickPipe(1);
    k.knife = 1;
    t.tp(k.i, 48, 84); t.tp(v2.i, 50, 84);
    t.knife(k.i, v2.i);
    return { k: k.i, v: v.i, v2: v2.i, h1: h1.i, h2: h2.i,
      off, on, sab, fixStart, dmgLeft, spot, tIdx0, tIdx1, pipeOpen, pipeGo,
      pipeFrom: pipes[0].room, pipeTo: pipes[1].room };
  });
  ok(EV1.off.state === 2 && EV1.on.corr === true, '事件流夹具：断电 → 合闸都实际生效');
  ok(EV1.h1 !== EV1.h2 && EV1.tIdx1 > EV1.tIdx0 && EV1.pipeOpen && EV1.pipeGo,
    '事件流夹具：AI 完成 1 个任务（tIdx ' + EV1.tIdx0 + '→' + EV1.tIdx1 + '），玩家钻管道成功');
  /* 把夜里最后 1.1 秒跑完：天亮失血死亡 → kill 事件必须记下凶手（killedBy） */
  await T(() => {
    const t = SKV3._t, g = t.G();
    g.phase = SKClock.newPhase('night', performance.now() - (120 - 1.1) * 1000, 120000);
    g.paused = false;
  });
  await page.waitForTimeout(1700);
  const EV2 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.paused = true;
    const evs = t.events();
    return { meet: !!g.meet, over: !!g.over, evs,
      frames: t.frames(), replay: t.replay(),
      inv: t.inv() };
  });
  const hasEv = (kind, pred) => EV2.evs.some(e => e.kind === kind && (!pred || pred(e)));
  const knifeEv = EV2.evs.find(e => e.kind === 'knife' && e.victim === EV1.v);
  ok(!!knifeEv && knifeEv.actor === EV1.k && knifeEv.room === 'med' &&
    Math.abs(knifeEv.x - 50) < 1.5 && Math.abs(knifeEv.y - 84) < 1.5,
    '出刀事件记全：谁 / 谁被刀 / 舱室 / 时间点 / 坐标（'
    + (knifeEv ? knifeEv.room + ' ' + knifeEv.x + ',' + knifeEv.y : '缺失') + '）');
  const dragS = EV2.evs.find(e => e.kind === 'drag_start' && e.victim === EV1.v);
  const dragE = EV2.evs.find(e => e.kind === 'drag_end' && e.victim === EV1.v);
  ok(!!dragS && !!dragE && dragS.actor === EV1.k && dragS.room === 'med' && dragE.room === 'med',
    '拖尸事件成对记录：谁拖谁 / 在哪拖起 / 在哪放下');
  ok(EV2.evs.filter(e => e.kind === 'breaker').some(e => e.state === 2) &&
    EV2.evs.filter(e => e.kind === 'breaker').some(e => e.state !== 2),
    '拉闸 / 合闸都进事件流');
  ok(hasEv('sabotage', e => e.actor === EV1.k && e.room === 'engine' && e.label) &&
    hasEv('fix', e => e.actor === EV1.h1 && e.room === 'engine') && EV1.dmgLeft === 0,
    '破坏舱室与修好故障都记到手（含舱室与设备名）');
  ok(hasEv('task', e => e.actor === EV1.h2 && e.room && e.label && e.pts >= 1),
    '任务完成事件带任务名 / 舱室 / 分数');
  ok(hasEv('pipe', e => e.actor === 0 && e.from === EV1.pipeFrom && e.to === EV1.pipeTo),
    '钻管道事件记录起点与终点舱室');
  const bledKill = EV2.evs.find(e => e.kind === 'kill' && e.victim === EV1.v2);
  ok(!!bledKill && bledKill.actor === EV1.k && bledKill.method === 'knife' && bledKill.room === 'med',
    '天亮失血死亡也归因：凶手 / 凶器 / 死亡舱室（'
    + (bledKill ? bledKill.method + ' by ' + bledKill.actor : '缺失') + '）');
  ok(EV2.frames >= 2 && EV2.replay.frames.length === EV2.frames,
    '位置帧按 0.5 秒采样（本次 ' + EV2.frames + ' 帧）');
  ok(EV2.replay.roster.length === 15 && EV2.replay.roster.filter(r => r.alien).length === 4 &&
    EV2.replay.events.length === EV2.evs.length && EV2.replay.map.rooms === 10,
    '回放包：15 席位 / 4 异形 / 事件与地图统计齐全');
  ok(EV2.inv && EV2.inv.all.length === 0, '事件流与天亮结算后不变量零失败');

  const RE1 = await T(() => {
    const p = SKV3._t.replay();
    const opened = SKReplay.open(p);
    const on = document.querySelectorAll('#rp-ship .room.on').length;
    return { opened, open: SKReplay.isOpen(), rows: SKReplay.count(),
      rooms: document.querySelectorAll('#rp-ship .room').length,
      pipes: document.querySelectorAll('#rp-ship .pipe').length,
      dots: document.querySelectorAll('#rp-dots .rp-dot').length,
      sub: document.getElementById('rp-sub').textContent, on };
  });
  ok(RE1.opened && RE1.open && RE1.rows >= 8 && RE1.rooms === 10 && RE1.pipes === 6 &&
    RE1.dots === 15, '复盘页打开：' + RE1.rows + ' 条事件 / 10 舱 / 6 管道口 / 15 个席位点');
  await shot('46_对局复盘.png');
  const RE2 = await T(() => {
    const p = SKReplay.payload();
    const i = p.events.findIndex(e => e.room);
    const row = document.querySelector('.rp-ev[data-i="' + i + '"]');
    if (i < 0 || !row) return { missing: true };
    row.click();
    const on = document.querySelectorAll('#rp-ship .room.on');
    return { room: p.events[i].room, n: on.length,
      data: on.length ? on[0].getAttribute('data-room') : null,
      seek: +document.getElementById('rp-seek').value };
  });
  ok(!RE2.missing && RE2.n === 1 && RE2.data === RE2.room,
    '时间轴点击事件 → 高亮对应舱室（' + RE2.data + '）');
  const RE3 = await T(() => {
    const p = JSON.parse(JSON.stringify(SKV3._t.replay()));
    SKReplay.close();
    const reopened = SKReplay.open(p);
    const saved = SKReplay.save(p);
    return { reopened, open: SKReplay.isOpen(), saved, rows: SKReplay.count() };
  });
  ok(RE3.reopened && RE3.open && RE3.saved && RE3.rows >= 8,
    '回放包 JSON 往返后可再次打开并导出（' + RE3.rows + ' 条）');
  await T(() => SKReplay.close());

  const ENDR = await T(() => {
    const t = SKV3._t, g = t.G();
    g.prog = t.winPts();
    const won = t.checkWin();
    return { won, end: !document.getElementById('end').classList.contains('hide'),
      rep: !!document.getElementById('e-rep'), save: !!document.getElementById('e-save'),
      title: document.getElementById('e-t').textContent };
  });
  ok(ENDR.won && ENDR.end && ENDR.rep && ENDR.save && ENDR.title.indexOf('人类') >= 0,
    '结束页提供「复盘 / 保存回放」两个入口');
  await page.click('#e-rep');
  await page.waitForTimeout(200);
  const ENDR2 = await T(() => ({
    open: SKReplay.isOpen(), rows: SKReplay.count(),
    hiddenEnd: document.getElementById('end').classList.contains('hide')
  }));
  ok(ENDR2.open && ENDR2.rows >= 8, '结束页「复盘」直接打开本局事件回放');
  await page.click('#rp-close');
  await page.waitForTimeout(120);
  ok((await T(() => SKReplay.isOpen())) === false, '复盘页可关闭并回到结束页');
  const replayJson = await T(() => JSON.stringify(SKV3._t.replay()));
  await page.setInputFiles('#home-replay-file', {
    name: 'replay.json', mimeType: 'application/json', buffer: Buffer.from(replayJson)
  });
  await page.waitForTimeout(350);
  const IMP = await T(() => ({ open: SKReplay.isOpen(), rows: SKReplay.count(),
    title: document.getElementById('rp-t').textContent }));
  ok(IMP.open && IMP.rows >= 8, '开始页「载入回放」可读回保存的 JSON 并打开复盘（' +
    IMP.rows + ' 条 / ' + IMP.title + '）');
  await T(() => SKReplay.close());
  await T(() => { SKV3.stop(); SKV3.start('human'); });
  await page.waitForFunction(() => window.SKV3 && SKV3._t && SKV3._t.assets().base, null, { timeout: 30000 });
  await page.waitForTimeout(320);

  section('暂停 / 重开 / 退出');
  await fresh(false);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const PZ = await T(() => ({
    paused: SKV3._t.paused(), ui: !document.getElementById('pause').classList.contains('hide'),
    info: document.getElementById('p-info').textContent, t: SKV3._t.G().t
  }));
  ok(PZ.paused && PZ.ui && PZ.info.indexOf('第 1 夜') >= 0, 'ESC 暂停：面板显示第 1 夜与进度');
  await page.waitForTimeout(700);
  const PZ2 = await T(() => SKV3._t.G().t);
  ok(Math.abs(PZ.t - PZ2) < 0.2, '暂停期间夜计时冻结');
  await shot('38_暂停面板.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const R1 = await T(() => SKV3._t.G().t);
  await page.waitForTimeout(500);
  const R2 = await T(() => ({ t: SKV3._t.G().t, paused: SKV3._t.paused(), ui: !document.getElementById('pause').classList.contains('hide') }));
  ok(!R2.paused && !R2.ui && R2.t < R1 - 0.3, '再按 ESC 继续，夜计时接着走');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  await page.click('#p-restart');
  await page.waitForTimeout(300);
  const RS = await T(() => ({
    paused: SKV3._t.paused(), ui: !document.getElementById('pause').classList.contains('hide'),
    night: SKV3._t.G().night, t: SKV3._t.G().t, n: SKV3._t.state().length
  }));
  ok(!RS.paused && !RS.ui && RS.night === 1 && RS.t > 110 && RS.n === 15, '暂停面板「重开本局」：回到第 1 夜');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  await page.click('#p-exit');
  await page.waitForTimeout(300);
  const EX = await T(() => ({
    open: SKV3.isOpen(), root: !!document.getElementById('v3-root'),
    pick: getComputedStyle(document.getElementById('pick')).display !== 'none'
  }));
  ok(!EX.open && !EX.root && EX.pick, '暂停面板「退出到开始页」：覆盖层移除，开始页恢复');

  section('收尾');
  ok(errors.length === 0, '控制台零报错' + (errors.length ? '：' + errors.join(' | ') : ''));
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
