/* 新返航录 · 返航录V1 · 浏览器断言门禁
 * ------------------------------------------------------------
 * 用法： node tools/test-v3.cjs
 * 依赖： playwright-core（优先本地 node_modules；找不到时可用
 *        PLAYWRIGHT_CORE 指定安装目录）
 * 覆盖： 2.5D 底图、地图全连通/管道/任务点、搜尸、拖拽、幽灵态、DEV 无敌/全知、报告会议、
 *        不变量断言（SKInvariants）、监控室/电闸、地道选择、驱逐公布身份、
 *        音效日志/声纹、维修 10s 无限制、保安/医疗机器人（4 点巡逻 / 停摆 / 运行时坐标）、
 *        HUD 存活人数、暂停/退出、控制台零报错、帧率。
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
  await page.click('.role.h');
  await page.waitForFunction(() => window.SKV3 && SKV3._t && SKV3._t.assets().base, null, { timeout: 30000 });
  await page.waitForTimeout(400);

  section('底图 / 基线');
  const A = await T(() => {
    const t = SKV3._t;
    return { a: t.assets(), n: t.state().length, inv: t.inv(), role: document.getElementById('role').textContent,
      tip: document.getElementById('tip').textContent, meet: !document.getElementById('meet').classList.contains('hide') };
  });
  ok(A.a.base && A.a.w === 4704 && A.a.h === 2817, 'Blender 2.5D 底图已加载 ' + A.a.w + '×' + A.a.h);
  ok(A.n === 15, '15 个席位');
  ok(A.inv && A.inv.fails.length === 0 && A.inv.checks > 200, '不变量基线 ' + (A.inv && A.inv.checks) + ' 项检查全过');
  ok(A.role.indexOf('人类') >= 0, 'HUD 显示人类');
  ok(A.tip.indexOf('X 搜尸') >= 0 && A.tip.indexOf('G 拖拽') >= 0, '提示栏含搜尸/拖拽');
  ok(!A.meet, '?test 跳过开局会议，直接进夜');
  await T(() => { SKV3._t.tp(0, 34.8, 11.8); });
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
  ok(MAPA.rs.length === 9 && MAPA.bad.length === 0,
    '9 间房两两 A* 可达' + (MAPA.bad.length ? ' :: ' + MAPA.bad.join(',') : ''));
  const powerR = MAPA.rs.find(r => r.id === 'power'), engineR = MAPA.rs.find(r => r.id === 'engine');
  ok(powerR.area === 124 && engineR.area === 187 && engineR.cls === '中',
    '配电室 124 格 / 引擎 187 格（中型）');
  ok(MAPA.ps.length === 4 && MAPA.pipeFree && MAPA.pipeRooms.join(',') === 'armory,bridge,cam,engine',
    '4 个管道口全部可站立：engine / cam / armory / bridge（配电室已移除）');
  ok(MAPA.pts.length === 25 && MAPA.pts.every(p => p.d <= 2.6),
    '25 个任务点全部能被 nearPoint 命中');

  section('搜尸');
  await fresh(false);
  const S = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    /* 测试隔离：本节只验搜尸/拖拽，先卸掉异形 AI 的刀，避免它把测试玩家击倒 */
    for (const a of g.agents) if (a.alien) { a.knife = 0; a.target = null; a.path = null; }
    t.tp(1, 28.2, 22.0);
    t.kill(1, 'knife');
    const b = t.bodyOf(1);
    t.tp(0, b[0] + 0.5, b[1] + 0.5);
    return { b, st: t.state()[1], dur: t.inv() };
  });
  ok(S.b && Math.abs(S.b[0] - 28.2) < 0.01 && Math.abs(S.b[1] - 22.0) < 0.01, '尸体留在死亡点 (28.2,22.0)');
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
  await T(() => { SKV3._t.tp(0, 28.3, 19.7); });
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

  section('幽灵态');
  await fresh(false);
  const G0 = await T(() => {
    const t = SKV3._t;
    t.tp(0, 28.2, 22.0);
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
    t.tp(0, 6, 28.5); g.me.path = null;
    return { pos: t.pos() };
  });
  await page.keyboard.press('e');
  await page.waitForTimeout(200);
  const GD = await T(() => ({ doing: SKV3._t.G().me.doing, prog: SKV3._t.G().prog }));
  ok(GD.doing > 25 && GD.doing <= 28.9, '幽灵维修耗时 1.6×（' + GD.doing.toFixed(1) + 's）');
  await T(() => { SKV3._t.G().me.doing = 0.03; });
  await page.waitForTimeout(300);
  const GR2 = await T(() => ({ prog: SKV3._t.G().prog, tIdx: SKV3._t.G().me.tIdx, inv: SKV3._t.inv() }));
  ok(GR2.prog >= 2 && GR2.tIdx === 1, '幽灵维修可完成并计分（prog=' + GR2.prog + '）');
  ok(GR2.inv && GR2.inv.fails.length === 0, '幽灵修完不变量全过');
  await T(() => { SKV3._t.tp(0, 28.2, 21.1); });
  await page.waitForTimeout(350);
  await page.keyboard.press('x');
  await page.waitForTimeout(600);
  ok(!(await T(() => !document.getElementById('body').classList.contains('hide'))), '幽灵无法搜尸');
  await shot('28_幽灵态.png');

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
  const K = await T(() => { SKV3._t.knife(1, 0); return { st: SKV3._t.state()[0], inv: SKV3._t.inv() }; });
  ok(K.st.alive && !K.st.downed, 'DEV 无敌：AI 出刀对玩家无效');
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
    t.tp(2, 28.2, 22.0);
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
    t.tp(k.i, 34.8, 11.8); t.tp(v.i, 35.75, 11.8); t.tp(0, 33.4, 11.8);
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
    for (const a of g.agents) if (a !== g.me && a !== k && a !== v2) { a.path = null; a.x = 28.2; a.y = 22.0; }
    t.tp(0, 33.4, 11.8);
    t.tp(k.i, 34.8, 11.8); k.knife = 1; k.detained = false; k.path = null;
    t.tp(v2.i, 35.75, 11.8);
    t.knife(k.i, v2.i);
  }, KN);
  await page.waitForTimeout(90);
  await freezeFx();
  await shotClip('31_出刀动画.png', { x: 440, y: 220, width: 600, height: 460 });

  section('专属动画 · 开枪');
  await fresh(false);
  const SH = await T(() => {
    const t = SKV3._t, g = t.G();
    t.tp(0, 34.8, 11.8);
    for (const a of g.agents) if (a !== g.me) { a.path = null; a.x = 28.2; a.y = 22.0; }
    t.tp(2, 30.5, 11.8);
    g.me.bullet = 1;
    t.shoot();
    return { fx: t.fx(), acts: t.acts(), bullet: g.me.bullet, downed: t.state()[2].downed,
      target: 2, tracer: g.fx.find(f => f.type === 'tracer'),
      muzzle: !!g.fx.find(f => f.type === 'muzzle'),
      impact: !!g.fx.find(f => f.type === 'impact'),
      blood: !!g.fx.find(f => f.type === 'blood') };
  });
  ok(SH.tracer && Math.abs(SH.tracer.x2 - 30.5) < 0.01 && Math.abs(SH.tracer.y2 - 11.8) < 0.01,
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

  section('专属动画 · 维修 / 领取资格 / 领取补给');
  await fresh(false);
  const DURS = await T(() => SKV3._t.taskDurs());
  ok(DURS.length === 25 && DURS.every(d => d.kind !== 'normal' || d.dur === 10),
    '16 个普通任务全部 10 秒（高难仍为 15–20 秒）');
  const W0 = await T(() => {
    const t = SKV3._t, g = t.G();
    for (const a of g.agents) if (a !== g.me) { a.path = null; a.x = 28.2; a.y = 22.0; }
    t.tp(0, 60.6, 47.4);
    g.me.tasks = [16, 17, 18, 19]; g.me.tIdx = 0; g.me.progress = 2; g.me.qual = 0;
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
  ok(W1.do === 'task' && W1.doing > 9.4 && W1.dur === 10, '维修：进入工作态（普通任务 ' + W1.dur + 's 倒计时）');
  ok(W1.fx.includes('workSpark'), '维修：工具接触点持续冒火花');
  await T(() => { const g = SKV3._t.G(); g.me.doing = 40; g.me._dur = 60; });
  await freezeFx();
  await shotClip('33_维修动画.png', { x: 440, y: 220, width: 600, height: 460 });
  await T(() => { SKV3._t.G().me.doing = 0.02; });
  await page.waitForTimeout(220);
  const Q = await T(() => {
    const g = SKV3._t.G();
    const qf = g.fx.find(f => f.type === 'qual');
    return { prog: g.prog, qual: g.me.qual, progress: g.me.progress, tIdx: g.me.tIdx,
      fx: SKV3._t.fx(), ql: document.getElementById('ql').classList.contains('pop'),
      qlText: document.getElementById('ql').textContent, qualFx: qf ? qf.n : null,
      doneFx: !!g.fx.find(f => f.type === 'done') };
  });
  ok(Q.tIdx === 1 && Q.progress >= 3, '完成维修：任务索引 +1，积分累加');
  ok(Q.qual === 1 && Q.qlText === '1', '维修积分到 3 → 资格升到 1 级，HUD 同步');
  ok(Q.qualFx === 1 && Q.doneFx, '领取资格：金色徽章 + 完工对勾特效');
  ok(Q.ql, 'HUD 资格数字弹跳（.pop）');
  await freezeFx();
  await shotClip('34_领取资格动画.png', { x: 440, y: 220, width: 600, height: 460 });
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
  ok(Q3.do === 'task' && Q3.dur === 10 && Q3.tIdx === 1,
    '取消夜修限制：同一夜可以继续开工第二个任务（' + Q2.spot.label + '）');
  await T(() => { SKV3._t.G().me.doing = 0.02; });
  await page.waitForTimeout(220);
  const Q4 = await T(() => ({ tIdx: SKV3._t.G().me.tIdx, progress: SKV3._t.G().me.progress, prog: SKV3._t.G().prog }));
  ok(Q4.tIdx === 2 && Q4.progress >= 4, '第二个任务同样能完成（任务 2/4，个人积分 ' + Q4.progress + '）');
  await T(() => {
    const t = SKV3._t, g = t.G();
    g.fx.length = 0;
    g.me.doing = 0; g.me._doing = null; g.me.path = null;
    g.me.qual = 1; g.me.medkit = 0;
    t.tp(0, 59.2, 50.4);
  });
  await page.waitForTimeout(120);
  await page.keyboard.press('e');
  await page.waitForTimeout(120);
  const P0 = await T(() => ({ do: SKV3._t.G().me._doing, doing: SKV3._t.G().me.doing }));
  ok(P0.do === 'med' && P0.doing > 4, '医疗间按 E：进入取医疗包动作');
  await T(() => { SKV3._t.G().me.doing = 0.02; });
  await page.waitForTimeout(220);
  const P = await T(() => {
    const g = SKV3._t.G();
    return { med: g.me.medkit, qual: g.me.qual, fx: SKV3._t.fx(),
      act: g.me.act && g.me.act.kind, md: document.getElementById('md').classList.contains('pop'),
      mdText: document.getElementById('md').textContent };
  });
  ok(P.med === 1 && P.qual === 0 && P.mdText === '1', '领取补给：医疗包 +1、资格 -1，HUD 同步');
  ok(P.fx.includes('pickup') && P.act === 'pickup', '领取补给：拾取光柱 + 下蹲拾取动作');
  ok(P.md, 'HUD 医疗包数字弹跳（.pop）');
  await freezeFx();
  await shotClip('35_领取补给动画.png', { x: 440, y: 220, width: 600, height: 460 });

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
  ok(AI0.first.do === 'task' && Math.abs(AI0.first.doing - AI0.spot.dur * 1.55) < 0.05,
    'AI 开工耗时 = 任务时长 ×1.55（' + AI0.spot.dur + 's → ' + (AI0.spot.dur * 1.55).toFixed(1) + 's）');
  const AI1 = await T(i => SKV3._t.aiTick(i, 180, 0.05), AI0.i);
  ok(AI1.doing > 0 && AI1.tIdx === 0, 'AI 开工 9s 仍在同一任务（不再瞬间刷完）');
  const AI2 = await T(i => {
    const a = SKV3._t.G().agents[i];
    const steps = Math.ceil(((a.doing || 1) + 1.2) / 0.05);
    return SKV3._t.aiTick(i, steps, 0.05);
  }, AI0.i);
  ok(AI2.tIdx === 1 && AI2.rest > 0 && AI2.do !== 'task',
    'AI 完成第一个任务后进入休息（剩余 ' + (AI2.rest || 0).toFixed(1) + 's）');
  const AI3 = await T(i => {
    const t = SKV3._t, g = t.G();
    const a = g.agents[i];
    a._rest = 0; a.path = null;
    const spot = t.taskSpot(i);
    t.tp(i, spot.x, spot.y);
    const next = t.aiTick(i, 1, 0.05);
    return { spot, next };
  }, AI0.i);
  ok(AI3.next.do === 'task' && AI3.next.tIdx === 1 && Math.abs(AI3.next.doing - AI3.spot.dur * 1.55) < 0.05,
    '休息结束后能接着修下一个任务（不再限一夜一个）');
  ok((await T(() => SKV3._t.G().prog)) >= 1, 'AI 维修计入全局维修进度');

  section('会议发言 · 上下文连贯');
  await fresh(false);
  const MS = await T(() => {
    const t = SKV3._t, g = t.G();
    const aliens = g.agents.filter(a => a.alien && a.alive);
    const humans = g.agents.filter(a => !a.alien && a.alive && a !== g.me);
    const k = aliens[0], v = humans[0], w1 = humans[1], w2 = humans[2];
    t.tp(k.i, 56, 51); t.tp(v.i, 57.2, 51); t.tp(w1.i, 55, 51); t.tp(w2.i, 56, 53);
    t.tp(0, 58.5, 52.5);
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
    t.tp(v.i, 28.4, 22);
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
  await T(() => { SKV3._t.tp(0, 30.4, 45.0); });
  await page.keyboard.press('c');
  await page.waitForTimeout(350);
  await shot('37_拉闸全船变暗.png');
  await page.keyboard.press('c');
  await T(() => SKV3._t.breaker());
  await page.waitForTimeout(150);

  section('寻路 · 家具不挡路 / 围墙兜底');
  await fresh(false);
  const PF = await T(() => {
    const t = SKV3._t;
    const plen = p => p ? p.reduce((s, q, i) => i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0, 0) : 0;
    const ratio = (a, b) => {
      const p = t.astar(a[0], a[1], b[0], b[1]);
      return p ? { n: p.length, len: plen(p), ratio: plen(p) / Math.hypot(b[0] - a[0], b[1] - a[1]) } : null;
    };
    const rMed = ratio([34.8, 11.8], [56.5, 49]);
    const rArm = ratio([34.8, 11.8], [83.5, 48]);
    const rTable = ratio([39, 15.5], [39, 6.5]);
    const outside = t.astar(34.8, 11.8, 0.5, 0.5);
    t.tp(0, 34.8, 6);
    const p = t.stepTo(34.8, 0.5);
    return { rMed, rArm, rTable, outside, p, pfree: t.free(p[0], p[1]),
      outFree: t.free(0.5, 0.5), room: t.state()[0].room };
  });
  ok(PF.rMed && PF.rMed.ratio < 1.35, '会议室→医疗间绕行比 ' + (PF.rMed && PF.rMed.ratio.toFixed(2)));
  ok(PF.rArm && PF.rArm.ratio < 1.45, '会议室→军械库绕行比 ' + (PF.rArm && PF.rArm.ratio.toFixed(2)));
  ok(PF.rTable && PF.rTable.len < 10.5, '穿过圆桌不被家具挡路（路径 ' + (PF.rTable && PF.rTable.len.toFixed(1)) + ' 格）');
  ok(PF.outside === null && !PF.outFree, '船体外目标不可达');
  ok(PF.pfree && PF.p[1] > 2.8 && PF.p[1] < 19, '撞墙后被兜底拉回会议室，不会走出船体');

  section('AI 尸体报告');
  await fresh(false);
  const AR = await T(() => {
    const t = SKV3._t, g = t.G();
    const v = g.agents.find(a => a.i !== 0 && !a.alien && a.alive);
    t.tp(v.i, 28.4, 22.0);
    t.kill(v.i, 'knife');
    const rep = g.agents.find(a => a.i !== 0 && !a.alien && a.alive && a !== v);
    t.tp(rep.i, 28.4, 24.6);
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

  section('监控室 · 9 路画面 / 电闸断信号');
  await fresh(false);
  const C0 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    t.tp(0, 84, 8.6);
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
  ok(C1.cams.open && C1.cams.room && C1.cams.feeds === 9 && C1.open,
    'E 打开监控台：9 路画面全覆盖');
  ok(C1.state.indexOf('9 路在线') >= 0 && C1.tip.indexOf('监控台') >= 0,
    '状态条显示 9 路在线，提示栏切换为监控操作');
  await shot('40_监控室9路.png');
  const C2 = await T(() => { const t = SKV3._t; const r = t.breaker(); return { r, cams: t.cams() }; });
  await page.waitForTimeout(360);
  const C3 = await T(() => ({
    cut: SKV3._t.cams().cut,
    state: document.getElementById('cam-state').textContent,
    cls: document.getElementById('cam-state').className,
    open: !document.getElementById('cam').classList.contains('hide')
  }));
  ok(C2.r.state === 2 && C3.cut && C3.open, '配电室拉闸：监控遮罩仍在，9 路全部断信号');
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
  ok(PD.p.open && PD.p.opts.length === 3 && PD.open, '异形按 E 打开地道出口列表：3 个可选目的地');
  ok(PD.p.fromRoom === '监控室' && PD.btns.length === 3 && PD.btns[0].indexOf('1') === 0,
    '列表标出当前管道口与 1–3 快捷键');
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
  const PT0 = await T(() => ({ b: SKV3._t.bots() }));
  ok(PT0.b.medbot && PT0.b.secbot &&
    PT0.b.medbot.patrol.length === 4 && PT0.b.secbot.patrol.length === 4,
    '医疗 / 保安机器人各有 4 点巡逻路线');
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
  ok(medStep > 1.2 && medStep < 1.75 && secStep > 1.2 && secStep < 1.75,
    '巡逻速度 1.6 格/秒（1s 位移 ' + medStep.toFixed(2) + ' / ' + secStep.toFixed(2) + ' 格）');
  ok(PT1.medFree && PT1.secFree, '巡逻中的机器人始终站在可行走格上');
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
  await T(() => SKV3._t.tp(0, 84, 50));
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
    /* 把保安机器人摆到军械库东南角：离设施初始位 >6 格，只有读运行时坐标才会擒拿 */
    const sec = t.setBot('secbot', 88.5, 54.5);
    const kp = freeNear(86, 54), vp = freeNear(86, 53.2);
    t.tp(k.i, kp[0], kp[1]);
    t.tp(v.i, vp[0], vp[1]);
    k.knife = 1;
    t.knife(k.i, v.i);
    return { k: k.i, v: v.i, jail: t.jail(), kp, vp, sec, inv: t.inv() };
  });
  await page.waitForTimeout(200);
  const SB1 = await T(o => {
    const t = SKV3._t, g = t.G();
    const a = g.agents[o.k];
    return { detained: t.detained(), st: t.state()[o.k], fx: t.fx(), pos: [a.x, a.y],
      used: t.robots().sec.used, jail: t.jail(), msg: g.msg, inv: t.inv(),
      bots: t.bots() };
  }, SB0);
  ok(SB0.sec && Math.hypot(SB0.kp[0] - SB0.sec[0], SB0.kp[1] - SB0.sec[1]) < 6 &&
    Math.hypot(SB0.kp[0] - 80, SB0.kp[1] - 53) > 6 && SB0.inv.fails.length === 0,
    '行凶点离保安机器人初始位 >6 格：仍按巡逻坐标擒拿');
  ok(SB1.detained.some(d => d.i === SB0.k) && SB1.st.detained && SB1.st.detainedT > 15,
    '保安机器人擒拿凶手：拘留倒计时 ' + (SB1.st.detainedT || 0).toFixed(1) + 's');
  ok(SB1.used && SB1.st.room === 'armory' && SB1.jail &&
    Math.hypot(SB1.pos[0] - SB1.jail[0], SB1.pos[1] - SB1.jail[1]) < 0.01,
    '凶手被拽到军械库角落拘留位');
  ok(SB1.fx.includes('detain') && SB1.fx.includes('alarm'), '拘留拖拽线 + 红色警报环特效');
  ok(SB1.msg.indexOf('保安机器人擒拿') >= 0, '播报点名说明被谁擒拿');
  ok(SB1.inv && SB1.inv.fails.length === 0, '拘留状态不变量全过');
  await T(() => {
    const t = SKV3._t, g = t.G();
    g.fx.forEach(f => { f.dur = Math.max(6, f.dur); f.t = f.dur * 0.55; });
    const p = t.jail();
    t.tp(0, 85.2, 51.2);
  });
  await page.waitForTimeout(140);
  await shot('44_保安机器人拘留.png');
  await T(o => { SKV3._t.G().agents[o.k].detainedT = 0.12; }, SB0);
  await page.waitForTimeout(420);
  const SB2 = await T(o => ({ detained: SKV3._t.detained(), st: SKV3._t.state()[o.k], inv: SKV3._t.inv() }), SB0);
  ok(SB2.detained.length === 0 && !SB2.st.detained, '18 秒拘留结束：自动释放');
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
  await page.waitForTimeout(320);
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
  await page.keyboard.press('f');
  await page.waitForTimeout(200);
  const SS1 = await T(() => ({
    robots: SKV3._t.robots(), fx: SKV3._t.fx(), msg: SKV3._t.G().msg, inv: SKV3._t.inv()
  }));
  ok(SS0.dist < 1.5 && SS1.robots.sec.dead, '异形贴近巡逻中的保安机器人按 F：当晚停摆');
  ok(SS1.fx.includes('spark') && SS1.msg.indexOf('保安机器人今晚停摆') >= 0, '破坏反馈：火花 + 明确播报');
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

  section('医疗机器人 · 拖进医疗间自动施救');
  await fresh(false);
  const MB0 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    /* 医疗机器人推到医疗间西北角：离初始坞位 (58,53.5) 约 10 格，验证按运行时坐标施救 */
    const med = t.setBot('medbot', 52, 46);
    let p = [52.5, 47.5];
    for (let r = 0.4; r <= 2.4; r += 0.2)
      for (let i = 0; i < 20; i++) {
        const a = i / 20 * Math.PI * 2, x = 52.5 + Math.cos(a) * r, y = 47.5 + Math.sin(a) * r;
        if (t.free(x, y)) { p = [x, y]; r = 99; break; }
      }
    t.tp(v.i, p[0], p[1]);
    v.downed = true; v.downAt = g.t; v.path = null; v.doing = 0; v._doing = null;
    const b = t.botTick(3.05);
    return { v: v.i, p, med, b, st: t.state()[v.i], fx: t.fx(), msg: g.msg, inv: t.inv(),
      room: t.state()[v.i].room };
  });
  ok(MB0.room === 'med' && !MB0.st.downed, '濒死者躺在医疗间：医疗机器人 3 秒后救起');
  ok(Math.hypot(MB0.p[0] - MB0.med[0], MB0.p[1] - MB0.med[1]) < 7 &&
    Math.hypot(MB0.p[0] - 58, MB0.p[1] - 53.5) > 7,
    '施救按巡逻坐标判定：离初始坞位 >7 格仍能救人');
  ok(MB0.b.med === true && MB0.fx.includes('healBeam') && MB0.fx.includes('heal'),
    '施救特效：机械臂光束 + 治疗环');
  ok(MB0.msg.indexOf('医疗机器人救起了') >= 0, '播报点名说明获救者');
  ok(MB0.inv && MB0.inv.fails.length === 0, '施救后不变量全过');
  await T(() => {
    const t = SKV3._t, g = t.G();
    g.fx.forEach(f => { f.dur = Math.max(6, f.dur); f.t = f.dur * 0.4; });
    t.tp(0, 53.2, 48.6);
  });
  await page.waitForTimeout(140);
  await shot('45_医疗机器人施救.png');

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

  section('CC0 音效采样 · 三类材质');
  await page.waitForFunction(() => {
    const d = SKV3._t.sfx();
    const ks = Object.keys(d);
    return ks.length === 6 && ks.every(k => d[k].every(a => a.ready >= 1 || a.err));
  }, null, { timeout: 8000 }).catch(() => {});
  const AU = await T(() => SKV3._t.sfx());
  const auKeys = Object.keys(AU);
  const auBad = auKeys.flatMap(k => AU[k].filter(a => a.ready < 1 || a.err)
    .map(a => k + ':' + a.src + ' ready=' + a.ready + ' err=' + a.err));
  ok(auKeys.length === 6 && auKeys.every(k => AU[k].length >= 2), '6 类采样全部建立音频池（每类 ≥2 条）');
  ok(!auKeys.includes('flesh'), '刀声只保留单层刀风，不再叠血肉采样');
  ok(auBad.length === 0, '采样在 file:// 下全部加载，无解码错误' + (auBad.length ? '：' + auBad.join(' | ') : ''));
  const PL = await T(() => ['knife', 'shot', 'step', 'drag', 'report'].map(n => SKV3._t.playSfx(n)));
  ok(PL.every(Boolean), '出刀 / 开枪 / 脚步 / 拖拽 / 报告 音效可触发');
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
