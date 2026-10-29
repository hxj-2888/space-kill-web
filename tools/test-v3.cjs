/* 新返航录 · 返航录V1 · 浏览器断言门禁
 * ------------------------------------------------------------
 * 用法： node tools/test-v3.cjs
 * 依赖： playwright-core（优先本地 node_modules；找不到时可用
 *        PLAYWRIGHT_CORE 指定安装目录）
 * 覆盖： 2.5D 底图、搜尸、拖拽、幽灵态、DEV 无敌/全知、报告会议、
 *        不变量断言（SKInvariants）、监控室/电闸、地道选择、驱逐公布身份、
 *        音效日志/声纹、维修 10s 无限制、保安/医疗机器人、HUD 存活人数、
 *        AI 夜间能力（拉闸/停摆机器人/破坏舱室/钻管道/开枪/救人/补给）、
 *        破坏技选舱/60 秒故障/-3 进度/连续 10 秒维修、幽灵不可破坏、
 *        暗处不可隔空开枪、暂停/退出、控制台零报错、帧率。
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
  const powerR = MAPA.rs.find(r => r.id === 'power'), engineR = MAPA.rs.find(r => r.id === 'engine'),
    transitR = MAPA.rs.find(r => r.id === 'transit');
  ok(powerR.area === 148 && powerR.cls === '小' && engineR.area === 216 && engineR.cls === '中',
    '配电室 148 格（小型）/ 引擎 216 格（中型）');
  ok(transitR.area === 102 && transitR.cls === '小',
    '中转间缩为小型：102 格');
  ok(MAPA.ps.length === 4 && MAPA.pipeFree && MAPA.pipeRooms.join(',') === 'armory,bridge,cam,engine',
    '4 个管道口全部可站立：engine / cam / armory / bridge（配电室已移除）');
  const bridgePipe = MAPA.ps.find(p => p.room === 'bridge');
  ok(bridgePipe && bridgePipe.x > 56 && bridgePipe.y < 9,
    '中央会议室管道移到右上角（' + (bridgePipe ? bridgePipe.x + ',' + bridgePipe.y : '缺') + '）');
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
    const spot = t.taskSpot(0);
    t.tp(0, spot.x, spot.y); g.me.path = null;
    return { pos: t.pos(), spot };
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
  await T(() => { SKV3._t.tp(0, 28.2, 21.1); });
  await page.waitForTimeout(350);
  await page.keyboard.press('x');
  await page.waitForTimeout(600);
  ok(!(await T(() => !document.getElementById('body').classList.contains('hide'))), '幽灵无法搜尸');
  await shot('28_幽灵态.png');

  section('幽灵任务 · 乱序 / 故障维修');
  await fresh(false);
  const GO = await T(() => {
    const t = SKV3._t, g = t.G();
    t.tp(0, 28.2, 22); t.kill(0, 'knife');
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
  ok(GO1.do === 'task' && GO1.pt === 11 && GO1.doing > 15.5,
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

  section('刀者红身 · 3 秒');
  await fresh(false);
  const RED = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const k = g.agents.find(a => a.alien && a !== g.me && a.alive);
    const v = g.agents.find(a => !a.alien && a !== g.me && a.alive);
    for (const a of g.agents) if (a !== g.me && a !== k && a !== v) {
      a.knife = 0; a.path = null; a.x = 28.2; a.y = 22.0;
    }
    t.tp(k.i, 34.8, 11.8); t.tp(v.i, 35.7, 11.8); t.tp(0, 33.2, 11.8);
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

  section('专属动画 · 维修 / 领取物资申请单 / 领取补给');
  await fresh(false);
  const DURS = await T(() => SKV3._t.taskDurs());
  ok(DURS.length === 25 && DURS.every(d => d.kind !== 'normal' || d.dur === 10),
    '16 个普通任务全部 10 秒（高难仍为 15–20 秒）');
  const W0 = await T(() => {
    const t = SKV3._t, g = t.G();
    for (const a of g.agents) if (a !== g.me) { a.path = null; a.x = 28.2; a.y = 22.0; }
    t.tp(0, 60.6, 47.4);
    g.me.tasks = [16, 17, 18, 19]; g.me.tIdx = 0; g.me.progress = 2;
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
  ok(W1.do === 'task' && W1.doing > 9.4 && W1.dur === 10, '维修：进入工作态（普通任务 ' + W1.dur + 's 倒计时）');
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
  ok(W3.do === 'task' && W3.doing > 9.4, '重新按 E 继续维修（计时从 10 秒重来）');
  await T(() => { SKV3._t.G().me.doing = 0.02; });
  await page.waitForTimeout(240);
  const Q = await T(() => {
    const g = SKV3._t.G();
    return { prog: g.prog, qual: g.me.qual, pending: g.me.qualPending, progress: g.me.progress,
      tIdx: g.me.tIdx, fx: SKV3._t.fx(),
      ql: document.getElementById('ql').textContent, qp: document.getElementById('qp').textContent,
      qpPop: document.getElementById('qp').classList.contains('pop'),
      doneFx: !!g.fx.find(f => f.type === 'done'), qualFx: !!g.fx.find(f => f.type === 'qual') };
  });
  ok(Q.tIdx === 1 && Q.progress >= 3, '完成维修：任务索引 +1，积分累加');
  ok(Q.qual === 0 && Q.pending === 1 && Q.qp === '1' && Q.ql === '0',
    '积分到 3 → 生成 1 份待领取物资申请单（HUD 待领 1 / 申请单 0）');
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
  ok(Q3.do === 'task' && Q3.dur === 10 && Q3.tIdx === 1,
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
    t.tp(0, q.x, q.y);
    return { q, room: t.state()[0].room };
  });
  await page.keyboard.press('e');
  await page.waitForTimeout(170);
  const CL = await T(() => { const g = SKV3._t.G(); return { do: g.me._doing, doing: g.me.doing }; });
  ok(QD.room === 'bridge' && CL.do === 'qual' && CL.doing > 2.4,
    '中央会议室圆桌：按 E 进入 3 秒领取物资申请单动作');
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
    const P = t.points()[11];                 // 中转间 升降台（列表第 3 个）
    g.me.tasks = [0, 4, 11, 8]; g.me.tIdx = 0; g.me.progress = 0;
    g.me.doing = 0; g.me._doing = null; g.me.path = null; g.me._taskPt = null;
    t.tp(0, P.x, P.y);
    const it = t.interact();                  // 只刷出任务项 → 直接开修
    const started = { do: g.me._doing, doing: g.me.doing, pt: g.me._taskPt };
    const fin = t.finishDoing(0);
    return { P: P.label, it, started, fin,
      tIdx: g.me.tIdx, prog: g.prog, progress: g.me.progress,
      left: g.me.tasks.slice(g.me.tIdx).map(i => t.points()[i].label) };
  });
  ok(ORD.started.do === 'task' && ORD.started.pt === 11,
    '乱序开工：记录实际任务点「' + ORD.P + '」（不是列表首个任务）');
  ok(ORD.fin.msg.indexOf('升降台') >= 0 && ORD.fin.msg.indexOf('引擎组同步') < 0,
    '结算播报按实际点位：' + ORD.fin.msg);
  ok(ORD.tIdx === 1 && ORD.prog === 1 && ORD.progress === 1,
    '乱序维修计分正确：普通任务 +1，任务索引 +1');
  ok(ORD.left.length === 3 && ORD.left.indexOf('升降台') < 0 && ORD.left.indexOf('引擎组同步') >= 0,
    '任务列表：已修的升降台移除，未修的引擎组同步保留');

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
  ok(AI2.tIdx === 1 && AI2.rest > 0 && AI2.rest <= 11.5 && AI2.do !== 'task',
    'AI 完成第一个任务后进入休息（剩余 ' + (AI2.rest || 0).toFixed(1) + 's，已减半）');
  const AI3 = await T(i => {
    const t = SKV3._t, g = t.G();
    const a = g.agents[i];
    a._rest = 0; a.path = null;
    const spot = t.taskSpot(i);
    t.tp(i, spot.x, spot.y);
    const next = t.aiTick(i, 1, 0.05);
    return { spot, next };
  }, AI0.i);
  ok(AI3.next.do === 'task' && AI3.next.tIdx === 1 && Math.abs(AI3.next.doing - AI3.spot.dur) < 0.05,
    '休息结束后能接着修下一个任务（不再限一夜一个）');
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
    t.tp(k.i, 56, 51); t.tp(v.i, 57.2, 51); t.tp(w1.i, 55, 51); t.tp(w2.i, 56, 53);
    t.tp(0, 58.5, 51.2);
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

  section('寻路 · 硬掩体阻挡 / 绕行 / 围墙兜底');
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
      outFree: t.free(0.5, 0.5), room: t.state()[0].room,
      tableFree: t.free(41, 10.8), consoleFree: t.free(27, 4), audit: t.coverAudit() };
  });
  ok(PF.rMed && PF.rMed.ratio < 1.35, '会议室→医疗间绕行比 ' + (PF.rMed && PF.rMed.ratio.toFixed(2)));
  ok(PF.rArm && PF.rArm.ratio < 1.45, '会议室→军械库绕行比 ' + (PF.rArm && PF.rArm.ratio.toFixed(2)));
  ok(PF.rTable && PF.rTable.len > 9.2 && PF.rTable.len < 12,
    '圆桌是硬掩体：A* 绕最短边（路径 ' + (PF.rTable && PF.rTable.len.toFixed(1)) + ' 格）');
  ok(!PF.tableFree && !PF.consoleFree, '掩体阻挡行走：圆桌与控制台不可穿越');
  ok(PF.audit && PF.audit.gaps.length === 0 && PF.audit.dead.length === 0,
    '硬掩体布局无窄夹缝 / 无掩体死路');
  ok(PF.outside === null && !PF.outFree, '船体外目标不可达');
  ok(PF.pfree && PF.p[1] > 2.8 && PF.p[1] < 19, '撞墙后被兜底拉回会议室，不会走出船体');

  section('自动门 · 无人闭合 / 靠近开启 / 阻挡移动与视线');
  await fresh(false);
  const DR0 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    for (const a of g.agents) { a.path = null; a.x = 34.8; a.y = 11.8; a._delay = 9e9; }
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
  await fresh(false);

  section('AI 拐角寻路 · 不卡死');
  const CW0 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const a = g.agents.find(x => !x.alien && x.i !== 0 && x.alive);
    t.tp(a.i, 34.8, 11.8);
    a.path = t.astar(34.8, 11.8, 58, 23);
    const r = t.walkAgent(a.i, 260, 0.05);
    return { i: a.i, r, inv: t.inv() };
  });
  ok(CW0.r && CW0.r.left === 0 && Math.hypot(CW0.r.x - 58, CW0.r.y - 23) < 3,
    'AI 拐角寻路 260 步不卡死（终点 ' + CW0.r.x.toFixed(1) + ',' + CW0.r.y.toFixed(1) + '）');
  ok(CW0.inv && CW0.inv.fails.length === 0, '拐角寻路后不变量全过');

  section('E 交互轮盘 · 多项选择');
  await fresh(false);
  const WH0 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    g.me.tasks = [8, 9, 10, 21]; g.me.tIdx = 0;
    g.me.doing = 0; g.me._doing = null; g.me.path = null;
    const p = t.points()[8];
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

  section('AI 认知 · 伤口/搜尸/听觉/证据链');
  await fresh(false);
  const COG = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = false;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const w = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== v);
    for (const a of g.agents) if (a !== k && a !== v && a !== w) t.tp(a.i, 30, 10);
    t.tp(k.i, 56, 51); t.tp(v.i, 57.2, 51); t.tp(w.i, 55.5, 51);
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
    for (const a of g.agents) if (a !== v1 && a !== v2 && a !== r1 && a !== r2) t.tp(a.i, 30, 10);
    t.tp(v1.i, 28.4, 22); t.kill(v1.i, 'knife'); t.tp(r1.i, 28.4, 24.6);
    r1._delay = 0; r1.doing = 0; r1._doing = null; r1.path = null;
    let m1 = null; for (let i = 0; i < 100; i++) { m1 = t.aiScan(r1.i, 0.1); if (m1.meet) break; }
    const used1 = t.aiReportUsed();
    t.finishMeeting();
    t.tp(v2.i, 28.4, 22); t.kill(v2.i, 'knife'); t.tp(r2.i, 28.4, 24.6);
    r2._delay = 0; r2.doing = 0; r2._doing = null; r2.path = null;
    let m2 = null; for (let i = 0; i < 100; i++) { m2 = t.aiScan(r2.i, 0.1); if (m2.meet) break; }
    return { meet1: !!(m1 && m1.meet), used1, used2: t.aiReportUsed(), meet2: !!t.G().meet };
  });
  ok(RPT.meet1 && RPT.used1, '第一次 AI 尸体报告成功，并置位本夜报告上限');
  ok(!RPT.meet2 && RPT.used2, '同一夜第二次 AI 报告被夜上限拦住（不再吞第二次 30 秒）');

  await fresh(false);
  const ALR = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = false; g.aiReportUsed = false;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k && a !== v) t.tp(a.i, 85, 55);
    t.tp(v.i, 28.4, 22); t.kill(v.i, 'knife'); t.tp(k.i, 28.4, 24.6);
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
    for (const a of g.agents) if (a !== k && a !== v && a !== w) t.tp(a.i, 30, 10);
    t.tp(k.i, 56, 51); t.tp(v.i, 57.2, 51); t.tp(w.i, 55.5, 51);
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
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== v);
    /* 把保安机器人摆到军械库东南角：离设施初始位 >6 格，只有读运行时坐标才会擒拿 */
    const sec = t.setBot('secbot', 88.5, 54.5, Math.PI);
    const sb = g.bots && g.bots.secbot;
    if (sb) { sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = Math.PI; }
    const kp = freeNear(86, 54), vp = freeNear(86, 53.2);
    t.tp(k.i, kp[0], kp[1]);
    t.tp(v.i, vp[0], vp[1]); t.tp(h.i, 84.8, 52.2);
    k.knife = 1;
    t.knife(k.i, v.i);
    return { k: k.i, v: v.i, h: h.i, jail: t.jail(), kp, vp, sec, inv: t.inv() };
  });
  await page.waitForTimeout(200);
  const SB1 = await T(o => {
    const t = SKV3._t, g = t.G();
    const a = g.agents[o.k];
    return { detained: t.detained(), st: t.state()[o.k], fx: t.fx(), pos: [a.x, a.y],
      used: t.robots().sec.used, jail: t.jail(), msg: g.msg, inv: t.inv(),
      bots: t.bots(), uses: t.robots().sec.uses, sus: t.mind(o.h) ? (t.mind(o.h).sus[o.k] || 0) : 0 };
  }, SB0);
  ok(SB0.sec && Math.hypot(SB0.kp[0] - SB0.sec[0], SB0.kp[1] - SB0.sec[1]) < 6 &&
    Math.hypot(SB0.kp[0] - 80, SB0.kp[1] - 53) > 6 && SB0.inv.fails.length === 0,
    '行凶点离保安机器人初始位 >6 格：仍按巡逻坐标擒拿');
  ok(SB1.detained.some(d => d.i === SB0.k) && SB1.st.detained && SB1.st.detainedT > 55,
    '保安机器人擒拿凶手：拘留倒计时 ' + (SB1.st.detainedT || 0).toFixed(1) + 's');
  ok(SB1.used && SB1.uses >= 1 && SB1.st.room === 'armory' && SB1.jail &&
    Math.hypot(SB1.pos[0] - SB1.jail[0], SB1.pos[1] - SB1.jail[1]) < 0.01,
    '凶手被拽到军械库角落拘留位');
  ok(SB1.fx.includes('detain') && SB1.fx.includes('alarm'), '拘留拖拽线 + 红色警报环特效');
  ok(SB1.msg.indexOf('保安机器人擒拿') >= 0, '播报点名说明被谁擒拿');
  ok(SB1.sus >= 0.5, '被拘留者被附近人类优先怀疑（sus=' + SB1.sus.toFixed(2) + '）');
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
  ok(SB2.detained.length === 0 && !SB2.st.detained, '60 秒拘留结束：自动释放');
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

  section('异形 F/H 分离 · 施救与破坏');
  await fresh(false);
  const FR = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true;
    g.me.alien = true; g.me.medkit = 1; g.me.sabUsed = false;
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && !a.downed);
    t.tp(v.i, 56, 51); t.tp(0, 57.1, 51);
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
    const med = t.setBot('medbot', 52, 46);
    t.tp(0, med[0] + 2, med[1]);
    g.me.bullet = 1; g.aimX = med[0]; g.aimY = med[1];
    t.shoot();
    return { dead: t.robots().med.dead, hp: t.robots().med.hp,
      bullet: g.me.bullet, msg: g.msg, inv: t.inv() };
  });
  ok(BMED.dead && BMED.hp === 0 && BMED.bullet === 0,
    '玩家开枪可以摧毁医疗机器人（子弹 -1）');
  ok(BMED.inv && BMED.inv.fails.length === 0, '摧毁医疗机器人后不变量全过');

  await fresh(false);
  const BSEC = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true; g.secbotUsed = true;
    const sec = t.setBot('secbot', 80, 53, 0);
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
    const sec = t.setBot('secbot', 80, 53, 0);
    const sb = g.bots.secbot; if (sb) { sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = 0; }
    let p = [80.8, 53];
    for (let r = 0.4; r <= 1.4; r += 0.1)
      for (let i = 0; i < 20; i++) {
        const a = i / 20 * Math.PI * 2, x = 80 + Math.cos(a) * r, y = 53 + Math.sin(a) * r;
        if (t.free(x, y)) { p = [x, y]; r = 99; break; }
      }
    t.tp(0, p[0], p[1]);
    g.me.bullet = 1; g.aimX = sec[0]; g.aimY = sec[1];
    t.shoot();
    const hp = t.robots().sec.hp, pending = g.pendingCrime;
    t.botTick(0.2);
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
    const sec = t.setBot('secbot', 80, 53, 0);
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
    t.botTick(0.2);
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
    const sec = t.setBot('secbot', 80, 53, 0);
    const sb = g.bots.secbot; if (sb) { sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = 0; }
    t.tp(k.i, 80.8, 53);
    k.knife = 1;
    t.knife(k.i, 0);                 // DEV 免伤：不产生濒死
    const pending = g.pendingCrime;
    t.botTick(0.2);
    return { pending, downed: g.me.downed, detained: g.agents[k.i].detained,
      uses: t.robots().sec.uses, inv: t.inv() };
  });
  ok(BDEV.pending != null, 'DEV 免伤的攻击仍写入危险行为');
  ok(!BDEV.downed && BDEV.detained && BDEV.uses === 1,
    '未造成濒死的出刀也会被保安机器人擒拿');
  ok(BDEV.inv && BDEV.inv.fails.length === 0, '未致濒死拘留后不变量全过');

  await fresh(false);
  const BCAP = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true;
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const sec = t.setBot('secbot', 80, 53, 0);
    const sb = g.bots.secbot; if (sb) { sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = 0; }
    t.tp(h.i, 80.8, 53);
    g.secbotUsed = true; g.secbotUses = 3; g.pendingCrime = h.i;
    t.botTick(0.2);
    return { detained: t.detained(), uses: t.robots().sec.uses, inv: t.inv() };
  });
  ok(BCAP.detained.length === 0 && BCAP.uses === 3,
    '保安机器人每夜最多擒拿 3 人：第 4 次不再触发');
  ok(BCAP.inv && BCAP.inv.fails.length === 0, '擒拿上限后不变量全过');

  await fresh(false);
  const BSHOOT = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true;
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && !a.downed);
    const sec = t.setBot('secbot', 80, 53, 0);
    const sb = g.bots.secbot; if (sb) { sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = 0; }
    let p = [80.8, 53];
    for (let r = 0.4; r <= 1.4; r += 0.1)
      for (let i = 0; i < 20; i++) {
        const a = i / 20 * Math.PI * 2, x = 80 + Math.cos(a) * r, y = 53 + Math.sin(a) * r;
        if (t.free(x, y)) { p = [x, y]; r = 99; break; }
      }
    t.tp(0, p[0], p[1]);
    let vp = [80.4, 54.3];
    for (let r = 0.2; r <= 1.2; r += 0.1)
      for (let i = 0; i < 20; i++) {
        const a = i / 20 * Math.PI * 2, x = 80.4 + Math.cos(a) * r, y = 54.3 + Math.sin(a) * r;
        if (t.free(x, y)) { vp = [x, y]; r = 99; break; }
      }
    t.tp(v.i, vp[0], vp[1]);
    g.me.bullet = 1; g.aimX = vp[0]; g.aimY = vp[1];
    t.shoot();
    t.botTick(0.2);
    return { v: v.i, downed: g.agents[v.i].downed, detained: g.me.detained,
      uses: t.robots().sec.uses, inv: t.inv() };
  });
  ok(BSHOOT.downed && BSHOOT.detained && BSHOOT.uses === 1,
    '玩家开枪后即使目标已经濒死，保安也会拘留开枪者');
  ok(BSHOOT.inv && BSHOOT.inv.fails.length === 0, '开枪拘留后不变量全过');

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
  await fresh(false);
  const MB1 = await T(() => {
    const t = SKV3._t, g = t.G(); g.noReport = true;
    t.setBot('medbot', 52, 46);
    const freeNear = (x, y) => {
      for (let r = 0.4; r <= 2.4; r += 0.2)
        for (let i = 0; i < 20; i++) {
          const a = i / 20 * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
          if (t.free(px, py)) return [px, py];
        }
      return [x, y];
    };
    const vs = g.agents.filter(a => !a.alien && a.i !== 0 && a.alive && !a.downed).slice(0, 3);
    const ps = vs.map((a, n) => { const p = freeNear(51.5 + n * 1.2, 47.5); t.tp(a.i, p[0], p[1]); return p; });
    for (const v of vs) { v.downed = true; v.downAt = g.t; v.path = null; }
    const b1 = t.botTick(3.05);
    const b2 = t.botTick(3.05);
    const b3 = t.botTick(3.05);
    return { vs: vs.map(v => v.i), ps, b1, b2, b3, left: t.robots().med.left,
      used: t.robots().med.used, downed: vs.map(v => v.downed), inv: t.inv() };
  });
  ok(MB1.b1.medLeft === 1 && MB1.b2.medLeft === 0 && MB1.used,
    '医疗机器人每夜可救 2 人（第二次后电量 0）');
  ok(MB1.downed[0] === false && MB1.downed[1] === false && MB1.downed[2] === true && MB1.left === 0,
    '电量耗尽后第三个濒死者不会被继续施救');
  ok(MB1.inv && MB1.inv.fails.length === 0, '两次施救后不变量全过');
  await T(() => {
    const t = SKV3._t, g = t.G();
    g.fx.forEach(f => { f.dur = Math.max(6, f.dur); f.t = f.dur * 0.4; });
    t.tp(0, 53.2, 48.6);
  });
  await page.waitForTimeout(140);
  await shot('45_医疗机器人施救.png');

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
    for (const h of g.agents) if (!h.alien && h.alive) t.tp(h.i, 30, 10);
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a.alien && a !== k) a.sabUsed = true;
    g.breakerSaboteur = k.i;
    const p = freeNear(50.8, 32.1, 2.2, 3.8);
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
    for (const h of g.agents) if (!h.alien && h.alive) t.tp(h.i, 30, 10);
    const sp = t.setBot('secbot', 80, 53);
    const p = freeNear(sp[0], sp[1], 2.4, 3.6);
    t.tp(k.i, p[0], p[1]);
    k.sabUsed = false; k.path = null; k.target = null; k.doing = 0; k._doing = null;
    t.clearDrags(); t.resetAiState(k.i); k.sabUsed = false;
    k.knife = 0;   /* 本节只验"破坏技停摆机器人"：先把刀用完，才轮到每夜一次的破坏技 */
    const r = t.aiTickAlien(k.i, 100, 0.05);
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
    for (const h of g.agents) if (!h.alien && h.alive) t.tp(h.i, 30, 10);
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
    Math.abs(AIK2.dmg[0].left - 60) < 0.01 && AIK2.sab,
    'AI 异形抵达引擎舱后损毁设备：60 秒故障倒计时，消耗本夜破坏技');
  ok(AIK2.dmg[0] && AIK2.dmg[0].label === AIK2.sp.label &&
    AIK2.fx.includes('spark') && AIK2.fx.includes('alarm') &&
    AIK2.msg.indexOf('被损毁') >= 0,
    '破坏落点是该舱室设备（带名字）：火花 + 警报特效 + 全船播报');
  ok(AIK2.inv && AIK2.inv.fails.length === 0, 'AI 破坏舱室后不变量全过');
  const AIK3 = await T(o => {
    const t = SKV3._t, g = t.G();
    for (const h of g.agents) if (!h.alien && h.alive) t.tp(h.i, 85, 55);
    const k = g.agents[o.i];
    for (const a of g.agents) if (a.alien && a !== k) t.tp(a.i, 85, 55);
    t.tp(k.i, 12.2, 35.2);
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

  /* AI 异形有刀时：砍机器人必须走玩家 Q 同一条结算——消耗刀数、按装甲 HP 掉血，不能一刀拆死 */
  const AIKB = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k) { a.knife = 0; t.tp(a.i, 30, 10); }
    g.breakerSaboteur = -1;
    t.clearDrags(); t.resetAiState(k.i);
    const sec = t.setBot('secbot', 80, 53, 0);
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
    const before = { knife: k.knife, sab: k.sabUsed, hp: t.robots().sec.hp, dead: t.robots().sec.dead };
    const r1 = t.aiTickAlien(k.i, 3, 0.05);
    const after = { knife: r1.knife, sab: r1.sab, hp: t.robots().sec.hp, dead: t.robots().sec.dead,
      red: k.redT, acts: t.acts(), crime: g.pendingCrime };
    return { before, after, k: k.i, inv: t.inv() };
  });
  ok(AIKB.before.hp === 2 && AIKB.after.knife === 0,
    'AI 异形对机器人出刀：消耗刀数（不再是白得的停摆）');
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
    t.tp(h.i, 56, 51); t.tp(k.i, 57.2, 51);
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
    for (const a of g.agents) if (a !== h && a !== k) t.tp(a.i, 30, 10);
    t.tp(h.i, 56, 51); t.tp(k.i, 62, 51);
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
    t.tp(h.i, 56, 51); t.tp(v.i, 57.2, 51);
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
    t.tp(0, 57.2, 51); t.tp(h.i, 56, 51);
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
    t.tp(h.i, 56, 51); t.tp(v.i, 57.2, 51);
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
    h.bullet = 0; h.qual = 1; h.suspect = null; h.medkit = 0;
    h.doing = 0; h._doing = null; h.path = null; h._delay = 0; h._rest = 0;
    const a1 = t.aiTick(h.i, 210, 0.05);
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
    'AI 子弹有限：开枪后归零，不会凭申请单无限补弹');
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
  ok(AIQ.inv && AIQ.inv.fails.length === 0, 'AI 领取申请单状态不变量全过');

  section('AI 拖拽 · 濒死者送医疗间复活');
  await fresh(false);
  const ADR = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true; g.dmg = [];
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && a !== v);
    for (const a of g.agents) if (a !== k && a !== v && a !== h) t.tp(a.i, 30, 10);
    t.clearDrags();
    [k, v, h].forEach(a => {
      t.resetAiState(a.i);
      a._delay = 0; a._rest = 0; a.knife = 0; a.bullet = 0; a.medkit = 0;
      a.qual = 0; a.qualPending = 0; a.suspect = null; a.tIdx = a.tasks.length;
    });
    k.knife = 1;
    t.tp(v.i, 58, 41); t.tp(h.i, 58.4, 40.4);
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
    for (let i = 0; i < 40; i++) t.botTick(0.2);
    const st = t.state()[o.v];
    return { downed: st.downed, alive: st.alive, left: t.robots().med.left, inv: t.inv() };
  }, ADR);
  ok(ADR3.alive && !ADR3.downed, '医疗机器人把 AI 拖来的伤者救活');
  ok(ADR3.left === 1, '医疗机器人电量按次扣减（剩 ' + ADR3.left + '/2）');
  ok(ADR3.inv.fails.length === 0, 'AI 拖尸→医疗间复活链路不变量全过');

  section('AI 异形 · 藏尸');
  await fresh(false);
  const HID = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k && a !== v) t.tp(a.i, 30, 10);
    t.clearDrags(); t.resetAiState(k.i);
    g.secbotDead = true;
    k.knife = 0; k.sabUsed = true; k._delay = 0; k._rest = 0;
    t.tp(v.i, 84, 32); t.kill(v.i, 'knife');
    t.tp(k.i, 84.6, 32.6);
    const b0 = t.bodyOf(v.i);
    let dragSeen = false, last = null;
    for (let i = 0; i < 900; i++) {
      last = t.aiTickAlien(k.i, 1, 0.05);
      if (last.drag === v.i) dragSeen = true;
      if (dragSeen && last.drag === null) break;
    }
    const b1 = t.bodyOf(v.i);
    return { k: k.i, v: v.i, dragSeen, b0, b1,
      dist: Math.hypot(b1[0] - b0[0], b1[1] - b0[1]),
      hides: last.hides, draggedBy: t.state()[v.i].draggedBy,
      moved: t.bodyInfo(v.i).moved, room: t.state()[v.i].room,
      spot: t.hideSpot('fun'), inv: t.inv() };
  });
  ok(HID.dragSeen, 'AI 异形会把尸体拖走藏起来（不必等玩家发现）');
  ok(HID.dist > 2 && HID.moved === true,
    '尸体被拖动 ' + HID.dist.toFixed(2) + ' 格并写入 bodyMoved');
  ok(HID.draggedBy === null && HID.hides === 1, '藏到角落后松手，本夜藏尸计数 +1');
  ok(HID.room === 'fun' && HID.spot && Math.hypot(HID.b1[0] - HID.spot[0], HID.b1[1] - HID.spot[1]) < 2.2,
    '藏尸点落在远离门与任务点的舱室角落');
  ok(HID.inv.fails.length === 0, 'AI 藏尸后不变量全过');

  section('AI 异形 · 避开保安扇形');
  await fresh(false);
  const SEC = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true;
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== k && a !== v) t.tp(a.i, 30, 10);
    t.clearDrags(); t.resetAiState(k.i);
    const sec = t.setBot('secbot', 66, 32, 0);
    const sb = g.bots.secbot; sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = 0;
    t.tp(k.i, 69, 32); t.tp(v.i, 70, 32);
    k.knife = 1; k.sabUsed = true; k._delay = 0; k._rest = 0;
    k._botCD = 999;              /* 本节只验"保安扇形回避"，机器人砍击另有 AIKB 用例 */
    const seen = t.secWouldSee(69, 32);
    const r1 = t.aiTickAlien(k.i, 20, 0.05);
    const blocked = { downed: t.state()[v.i].downed, avoid: r1.secAvoid, knife: k.knife };
    t.setBot('secbot', sec[0], sec[1], Math.PI);
    t.tp(k.i, 69, 32); t.tp(v.i, 70, 32);   /* 回避阶段可能走开：复位后再验补刀 */
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

  section('AI 人类 · 断电后主动合闸');
  await fresh(false);
  const LB = await T(() => {
    const t = SKV3._t; t.newGame();
    const g = t.G(); g.paused = true; g.noReport = true; g.dmg = [];
    const h = g.agents.find(a => !a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== h) { a.knife = 0; t.tp(a.i, 30, 10); }
    t.clearDrags(); t.resetAiState(h.i);
    h.medkit = 0; h.bullet = 0; h.qual = 0; h.qualPending = 0; h.suspect = null;
    h.tIdx = h.tasks.length; h._delay = 0; h._rest = 0;
    t.breaker();
    const st0 = t.lights().state;
    let hp = null;
    for (let r = 0.4; r <= 3.2 && !hp; r += 0.2)
      for (let i = 0; i < 24 && !hp; i++) {
        const a = i / 24 * Math.PI * 2, x = 50.8 + Math.cos(a) * r, y = 32.1 + Math.sin(a) * r;
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
    for (const a of g.agents) if (a !== k && a !== v) t.tp(a.i, 30, 10);
    t.clearDrags(); t.resetAiState(k.i);
    k.knife = 1; k.sabUsed = true; k._delay = 0; k._rest = 0; k._pipeCD = 0;
    let kp = null;
    for (let r = 0; r <= 3.2 && !kp; r += 0.2)
      for (let i = 0; i < 24 && !kp; i++) {
        const a = i / 24 * Math.PI * 2, x = 8 + Math.cos(a) * r, y = 30 + Math.sin(a) * r;
        if (t.free(x, y)) kp = [x, y];
      }
    t.tp(k.i, kp[0], kp[1]); t.tp(v.i, 84, 9);
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

  section('破坏技 · 选舱 / 60 秒 / 连续 10 秒维修');
  await fresh(false);
  const SAB0 = await T(() => {
    const t = SKV3._t, g = t.G();
    g.noReport = true;
    const swap = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    swap.alien = false; /* 保持 4 异形 / 11 人类，不触发不变量 */
    g.me.alien = true; g.me.sabUsed = false;
    g.me.doing = 0; g.me._doing = null; g.me.path = null;
    g.dmg = []; g.sabTarget = null;
    t.tp(0, 30, 10);
    const open = t.openSab();
    return { open, pick: t.sabPick(), msg: g.msg, inv: t.inv() };
  });
  await page.waitForTimeout(150);
  const SAB0b = await T(() => ({
    ui: !document.getElementById('sabot').classList.contains('hide'),
    buttons: document.querySelectorAll('#sabot-list button').length,
    tip: document.getElementById('tip').textContent
  }));
  ok(SAB0.open && SAB0.pick.rooms.length === 8 && SAB0.pick.rooms.indexOf('bridge') < 0,
    '玩家异形按 F 打开舱室列表：8 个舱室，中央会议室被排除');
  ok(SAB0b.ui && SAB0b.buttons === 8 && SAB0b.tip.indexOf('破坏选择') >= 0,
    '破坏面板：8 个按钮 + 提示栏切换到破坏说明');
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
    SAB1.dmg[0].label === SAB1.sp.label && SAB1.sab && !SAB1.after,
    '抵达目标舱室损毁对应设备：消耗本夜破坏技并清除目标');
  ok(SAB1.fx.includes('spark') && SAB1.fx.includes('alarm') &&
    SAB1.msg.indexOf('60 秒') >= 0, '破坏反馈：火花 + 警报环 + 60 秒维修窗口播报');
  ok(SAB1.inv && SAB1.inv.fails.length === 0, '破坏舱室后不变量全过');
  await page.waitForTimeout(180);
  const SAB1b = await T(() => ({
    dmg: SKV3._t.dmg(),
    hud: document.getElementById('dmgline').textContent,
    show: !document.getElementById('dmgline').classList.contains('hide'),
    room: SKV3._t.roomName('power')
  }));
  ok(SAB1b.show && SAB1b.hud.indexOf('故障') >= 0 && SAB1b.hud.indexOf(SAB1b.room) >= 0 &&
    SAB1b.dmg[0] && SAB1b.dmg[0].left < 60,
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
  ok(SAB3.prog === 7 && SAB3.dmg === 0 && SAB3.msg.indexOf('维修进度 -3') >= 0,
    '60 秒内未修复且仍在天黑：维修进度 -3');
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
  await fresh(false);

  section('视野 · 暗处不能隔空开枪');
  await fresh(false);
  const VIS0 = await T(() => {
    const t = SKV3._t, g = t.G();
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive);
    for (const a of g.agents) if (a !== g.me && a !== k) t.tp(a.i, 30, 10);
    t.tp(0, 56, 51); t.tp(k.i, 60, 51);
    g.me.bullet = 1;
    t.breaker(); /* 断电后只能靠 7 格手电锥 */
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
    t.tp(actor.i, 57.2, 51);
    t.tp(human.i, 58.1, 51.5);
    actor.sabUsed = false; g.dmg = [];
    const okDmg = t.damageRoom(actor.i, 'med');
    return { okDmg, actor: actor.i, human: human.i,
      humanSuspect: human.suspect, humanAllies: human.allies || null,
      range: t.secRange(), speed: t.speed(),
      role: document.getElementById('role').textContent,
      tip: document.getElementById('tip').textContent, inv: t.inv() };
  });
  ok(AB.speed === 5, '全场统一移动速度常量 = ' + AB.speed + ' 格/秒');
  ok(AB.range === 14, '保安机器人行凶识别半径 = ' + AB.range + ' 格');
  ok(AB.okDmg && AB.humanSuspect === AB.actor, '人类目击异形专属破坏 → 写入嫌疑人');
  ok(AB.humanAllies == null, '人类不会被写入盟友表（只有 suspect）');
  ok(AB.role.indexOf('天眼') < 0 && AB.tip.indexOf('天眼') < 0, '玩家异形没有天眼 / 队友透视 UI');
  ok(AB.inv && AB.inv.fails.length === 0, '行为推断状态不变量全过');
  const AIP = await T(() => {
    const t = SKV3._t, g = t.G();
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive && !a.downed);
    const mate = g.agents.find(a => a.alien && a.i !== 0 && a.alive && a !== k);
    for (const a of g.agents) if (a !== k && a !== mate) { a.path = null; a.x = 28.2; a.y = 22.0; }
    t.tp(k.i, 34, 12); t.tp(mate.i, 36, 12);
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
    for (const a of g.agents) if (a !== g.me && a !== v) { a.path = null; a.x = 28.2; a.y = 22.0; }
    t.tp(0, 34.8, 11.8); t.tp(v.i, 32.0, 11.8);
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
    for (const a of g.agents) if (a !== g.me && a !== v) { a.path = null; a.x = 28.2; a.y = 22.0; }
    t.tp(0, 34.8, 11.8); t.tp(v.i, 35.6, 11.8);
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
    t.tp(h.i, 30.4, 11.8); h.path = [[33.4, 11.8]];
    const h0 = [h.x, h.y];
    t.aiTick(h.i, 4, 0.05);
    const humanD = Math.hypot(h.x - h0[0], h.y - h0[1]);
    const k = g.agents.find(a => a.alien && a.i !== 0 && a.alive && !a.detained);
    k._delay = 999; k.doing = 0; k._doing = null; k.detained = false;
    t.tp(k.i, 30.4, 13.4); k.path = [[33.4, 13.4]];
    const k0 = [k.x, k.y];
    t.aiTickAlien(k.i, 4, 0.05);
    const alienD = Math.hypot(k.x - k0[0], k.y - k0[1]);
    return { humanD, alienD, inv: t.inv() };
  });
  ok(Math.abs(SPD.humanD - 1) < 0.06 && Math.abs(SPD.alienD - 1) < 0.06,
    '玩家 / AI 人类 / AI 异形同速：0.2 秒位移 ' + SPD.humanD.toFixed(2) + ' / ' + SPD.alienD.toFixed(2) + ' 格');
  ok(SPD.inv && SPD.inv.fails.length === 0, '统一移速后不变量全过');
  const ST = await T(() => {
    const t = SKV3._t, g = t.G();
    const v = g.agents.find(a => a.alien && a.i !== 0 && a.alive && !a.downed && !a.detained);
    for (const a of g.agents) if (a !== g.me && a !== v) { a.path = null; a.x = 28.2; a.y = 22.0; }
    t.tp(0, 34.8, 11.8);
    t.tp(v.i, 35.55, 11.8);
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
    const sec = t.setBot('secbot', 80, 53);
    const sb = g.bots && g.bots.secbot;
    if (sb) { sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = 0; }
    let spot = null;
    for (let r = 0.4; r <= 2.4 && !spot; r += 0.2)
      for (let i = 0; i < 24 && !spot; i++) {
        const a = i / 24 * Math.PI * 2, x = 86.5 + Math.cos(a) * r, y = 54.5 + Math.sin(a) * r;
        if (t.free(x, y)) spot = [x, y];
      }
    t.tp(k.i, spot[0], spot[1]);
    t.tp(v.i, 86.0, 53.6);
    k.knife = 1;
    t.knife(k.i, v.i);
    return { k: k.i, sec, dist: Math.hypot(spot[0] - sec[0], spot[1] - sec[1]), inv: t.inv() };
  });
  await page.waitForTimeout(220);
  const SR1 = await T(o => ({ detained: SKV3._t.detained(),
    used: SKV3._t.robots().sec.used, inv: SKV3._t.inv() }), SR0);
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
    t.tp(k.i, 90.5, 53);
    t.tp(v.i, 89.9, 52.5);
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
    for (const a of g.agents) if (a !== k && a !== h1 && a !== h2) t.tp(a.i, 28.2, 22);
    t.tp(k.i, 34, 12); t.tp(h1.i, 36, 12); t.tp(h2.i, 36, 14);
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
    const sec = t.setBot('secbot', 80, 53, 0);
    const sb = g.bots.secbot; if (sb) { sb.wps = [[sec[0], sec[1]]]; sb.wp = 0; sb.ang = 0; }
    const freeNear = (x, y) => {
      for (let r = 0.4; r <= 2.4; r += 0.2)
        for (let i = 0; i < 20; i++) {
          const a = i / 20 * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
          if (t.free(px, py)) return [px, py];
        }
      return [x, y];
    };
    const kp = freeNear(76.5, 53), vp = freeNear(76.5, 54);
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

  section('CC0 音效采样 · 三类材质');
  await page.waitForFunction(() => {
    const d = SKV3._t.sfx();
    const ks = Object.keys(d);
    return ks.length === 7 && ks.every(k => d[k].every(a => a.ready >= 1 || a.err));
  }, null, { timeout: 8000 }).catch(() => {});
  const AU = await T(() => SKV3._t.sfx());
  const auKeys = Object.keys(AU);
  const auBad = auKeys.flatMap(k => AU[k].filter(a => a.ready < 1 || a.err)
    .map(a => k + ':' + a.src + ' ready=' + a.ready + ' err=' + a.err));
  ok(auKeys.length === 7 && auKeys.every(k => AU[k].length >= 2), '7 类采样全部建立音频池（每类 ≥2 条）');
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
