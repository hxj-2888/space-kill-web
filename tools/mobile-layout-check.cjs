/* =============================================================
 * tools/mobile-layout-check.cjs — 移动端横屏布局自检（v35 适配门禁）
 *
 * 为什么需要：#screen-game 曾写死 min-width:1080px，手机横屏根本进不去对局，
 * 而「看着像没问题」证明不了——必须拿真实手机视口量一遍。
 *
 * 做法：用 Playwright 打开本地页面，按手机横屏/竖屏视口切到对局页，
 *       量关键元素的 getBoundingClientRect，检查是否溢出视口 / 被裁切。
 * 依赖：playwright（未装则跳过并提示，不阻塞其他门禁）
 *
 * 用法：node tools/mobile-layout-check.cjs
 * 退出：0 = 全部通过；1 = 有溢出/不可见项
 * ============================================================= */
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg', '.json': 'application/json',
};

/* 覆盖三档常见手机 + 竖屏 + 桌面回归对照 */
const DEVICES = [
  { name: 'iPhone 14 横屏', width: 844, height: 390, touch: true },
  { name: 'iPhone SE 横屏', width: 667, height: 375, touch: true },
  { name: 'Android 横屏', width: 915, height: 412, touch: true },
  { name: 'iPhone 14 竖屏（应提示旋转）', width: 390, height: 844, touch: true, portrait: true },
  { name: '桌面（回归对照）', width: 1440, height: 900, touch: false },
];

function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, () => r(srv)));
}

(async () => {
  let chromium;
  /* 优先 playwright（自带浏览器）；退回 playwright-core + 系统 Chrome/Edge。
     不做浏览器下载——为一个布局门禁拉 150MB 不划算。 */
  try { ({ chromium } = require('playwright')); }
  catch (e) {
    try { ({ chromium } = require('playwright-core')); }
    catch (e2) {
      console.log('SKIP 未安装 playwright / playwright-core，跳过移动端布局自检（不影响其他门禁）');
      process.exit(0);
    }
  }
  const CANDIDATES = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  const exePath = CANDIDATES.find(p => fs.existsSync(p));
  const srv = await serve();
  /* 默认测本地；--url=https://… 改测线上（部署后核验专用：
     线上与本地可能因部署遗漏、CDN 缓存而不同步，这个开关就是为抓那种漂移） */
  const argUrl = process.argv.find(a => a.startsWith('--url='));
  const base = argUrl ? argUrl.slice(6) : 'http://127.0.0.1:' + srv.address().port;
  const remote = !!argUrl;
  console.log('目标：' + base + (remote ? '（线上）' : '（本地）'));
  const browser = await chromium.launch(exePath ? { executablePath: exePath } : {});
  let fail = 0;

  for (const d of DEVICES) {
    const ctx = await browser.newContext({
      viewport: { width: d.width, height: d.height },
      isMobile: d.touch, hasTouch: d.touch, deviceScaleFactor: d.touch ? 3 : 1,
    });
    const page = await ctx.newPage();
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    /* 线上核验时给静态资源加时间戳，绕开 CDN 边缘缓存（否则量到的是旧版布局） */
    if (remote) {
      await page.evaluate(() => {
        const t = Date.now();
        document.querySelectorAll('link[rel=stylesheet],script[src]').forEach(function (el) {
          const u = new URL(el.href || el.src, location.href);
          u.searchParams.set('nocache', t);
          if (el.href) el.href = u.toString(); else el.src = u.toString();
        });
      });
      await page.waitForTimeout(500);
    }
    /* 直接进对局页：开始页要选阵营+开局，这里只验对局页布局 */
    await page.evaluate(() => {
      document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
      const g = document.getElementById('screen-game');
      if (g) g.classList.remove('hidden');
      /* 〔S1〕圆桌场景：用真实 SKScene 渲染 mock 裁剪视图（15 席、含 1 个出局态）——
         mock 只构造 SKScene 的读取面（g.phase/pending + V.id/players[].id/out），不复制渲染逻辑 */
      try {
        const mkV = { id: 1, players: Array.from({ length: 15 }, (_, k) => ({ id: k + 1, name: (k + 1) + ' 号', out: k === 3 })) };
        if (window.SKScene) window.SKScene.render({ phase: 'day', pending: null }, mkV);
      } catch (e) { /* 渲染失败由下方 sceneSvg 断言暴露 */ }
      /* 灌最小内容：行动面板一条事件，验证真实内容下的挤压（〔S5〕发言流退役、名单由场景承担） */
      const dec = document.getElementById('stage-body');
      if (dec) {
        dec.innerHTML = '<div class="evt info">夜间流程 · 私聊 / 决策 / 公告（示例内容，验证面板高度预算）。</div>';
      }
      const tb = document.getElementById('talkbar');
      if (tb) tb.classList.remove('hidden');
    });
    await page.waitForTimeout(150);

    /* 〔42〕开始页单独验一次：撑满改造后，极矮横屏（844×390）走的是「页面不滚 + 卡片内滚」，
       这是最容易出现「整页被撑破 / CTA 掉出视口 / 页面不会滚」三种坏状态的地方。
       对局页的门禁只量 game 屏，量不到这里。 */
    if (!d.portrait) {
      /* .start-box 入场有 rise 动画（transform:translateY(14px) → none，500ms）。
         门禁在「刚显示」后立刻量会量到动画中间态（曾误报溢出 4px）。数值检查必须量终态，
         故先注入 style 关掉动画 —— 与 v35 段「抽屉要等 transition 结束再量」同源教训。 */
      await page.addStyleTag({ content: '*,*::before,*::after{animation:none !important;transition:none !important}' });
      await page.evaluate(() => {
        document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
        document.getElementById('screen-start').classList.remove('hidden');
      });
      await page.waitForTimeout(120);
      const home = await page.evaluate((vp) => {
        const st = document.getElementById('screen-start');
        const box = st.querySelector('.start-box');
        const cta = st.querySelector('button.cta');
        const out = [];
        if (document.documentElement.scrollHeight > vp.h + 2)
          out.push('开始页被撑出视口（document 高度 ' + document.documentElement.scrollHeight + ' > ' + vp.h + '）');
        const br = box.getBoundingClientRect();
        if (br.bottom > vp.h + 1 || br.top < -1)
          out.push('.start-box 溢出视口 {t:' + Math.round(br.top) + ',b:' + Math.round(br.bottom) + '}');
        const cr = cta.getBoundingClientRect();
        /* CTA 必须**可达**：要么整体在视口内，要么位于可滚动区之内且卡片本身可滚 */
        const scrolls = getComputedStyle(box).overflowY === 'auto' || getComputedStyle(box).overflowY === 'scroll';
        if (cr.top < vp.h && cr.bottom > vp.h && !scrolls)
          out.push('「开始对局」被截断且容器不可滚（玩家无法开局）');
        if (cr.top >= vp.h && !scrolls)
          out.push('「开始对局」完全在视口外且容器不可滚（玩家无法开局）');
        return { out, scrolls, boxH: Math.round(br.height), scrollH: box.scrollHeight,
                 ctaBottom: Math.round(cr.bottom) };
      }, { w: d.width, h: d.height });
      if (home.out.length) {
        fail++;
        console.log('✗ ' + d.name + ' ' + d.width + '×' + d.height + '（开始页）');
        home.out.forEach(e => console.log('    · ' + e));
      } else {
        console.log('✓ ' + d.name + ' ' + d.width + '×' + d.height +
          '（开始页 卡片 ' + home.boxH + 'px' +
          (home.scrolls ? ' / 内容 ' + home.scrollH + 'px 可滚' : '') + '，CTA 可见）');
      }
      await page.evaluate(() => {
        document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
        document.getElementById('screen-game').classList.remove('hidden');
      });
    }

    /* ---------- 〔44〕自选身份面板（首页） ----------
       断言的是**真实渲染与真实点击**，不是源码：面板是覆盖层，卡片由 ui.js 按声明层
       现场派生，任何一处选择器或类名漂移都会让它整块失效而源码看着没问题。
       覆盖：可打开 / 角色数与声明层一致 / 转职系不外露 / 点选后 chip 与阵营联动 /
             清除按钮的出现时机 / 手机横屏下不撑破视口。 */
    if (!d.portrait) {
      await page.evaluate(() => {
        document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
        document.getElementById('screen-start').classList.remove('hidden');
      });
      const rp = await page.evaluate((vp) => {
        const out = [];
        const ov = document.getElementById('role-overlay');
        if (!ov) return { out: ['#role-overlay 不存在（面板未挂载）'], skip: true };
        const chip = document.getElementById('role-chip');
        const vis = () => !ov.classList.contains('hidden');
        if (vis()) { out.push('面板初始应为关闭态'); return { out, skip: true }; }
        chip.click();
        if (!vis()) { out.push('点「未选择」未打开面板'); return { out, skip: true }; }

        const cards = [...ov.querySelectorAll('.rp-card')];
        /* 角色数必须与声明层 selectable 数一致 —— 面板漏渲染一个角色 = 玩家选不到它 */
        const want = SKRoleDecl.keys().filter(k => SKRoleDecl.selectable(k)).length;
        if (cards.length !== want)
          out.push('面板列出 ' + cards.length + ' 个角色，声明层可选 ' + want + ' 个');
        /* 转职系只能经步骤 0.6 获得，绝不能出现在自选面板里 */
        ['tempdoc', 'assistant', 'armed'].forEach(k => {
          if (cards.some(c => c.dataset.role === k)) out.push('转职系 ' + k + ' 不应出现在自选面板');
        });
        /* 每个角色都要有阵营色条与说明，否则卡片是一块空白 */
        const bare = cards.filter(c => !c.querySelector('.rp-ds') || !c.querySelector('.rp-nm')).length;
        if (bare) out.push(bare + ' 张角色卡缺少名称/说明');

        /* 点选：chip 文案要变、active 要落在这张卡上、清除按钮要出现 */
        const target = cards.find(c => c.dataset.role === 'detective') || cards[0];
        target.click();
        if (vis()) out.push('点选角色后面板未关闭（应选完即关）');
        if (UI.preferredRole() !== target.dataset.role)
          out.push('preferredRole() = ' + UI.preferredRole() + '，与点选的 ' + target.dataset.role + ' 不符');
        if (chip.textContent.indexOf('未选择') >= 0) out.push('chip 未反映已选身份');
        const clr = document.getElementById('role-clear');
        if (clr.hidden) out.push('已选身份后「清除」按钮未出现');
        /* 双向联动的正向：选身份应带上阵营 */
        const fac = (SKRoleDecl.ROLE_DECL[target.dataset.role] || {}).faction;
        const checked = document.querySelector('input[name=fac]:checked');
        if (!checked || checked.value !== fac)
          out.push('选身份后阵营未跟随（期望 ' + fac + '，实际 ' + (checked && checked.value) + '）');

        /* 清除后回到未选态，且不残留 active 卡 */
        clr.click();
        if (UI.preferredRole() !== null) out.push('「清除」后 preferredRole() 未复位');
        if (chip.textContent.indexOf('未选择') < 0) out.push('「清除」后 chip 未回到未选态');

        /* 重新打开量几何：极矮横屏下卡片必须够点、面板自身可滚、不得撑破视口宽 */
        chip.click();
        const box = ov.getBoundingClientRect();
        if (box.width > vp.w + 1) out.push('面板宽 ' + Math.round(box.width) + ' 超出视口 ' + vp.w);
        const cs = getComputedStyle(ov);
        if (!(cs.overflowY === 'auto' || cs.overflowY === 'scroll'))
          out.push('面板不可内部滚动（矮屏下角色卡会看不全）');
        const cardH = ov.querySelector('.rp-card').getBoundingClientRect().height;
        if (cardH < 60) out.push('角色卡仅 ' + Math.round(cardH) + 'px（触摸目标过小）');
        const cols = getComputedStyle(ov.querySelector('.rp-grid')).gridTemplateColumns.split(' ').length;
        document.getElementById('role-close').click();
        if (vis()) out.push('「✕」未能关闭面板');
        return { out, cards: cards.length, cols, cardH: Math.round(cardH) };
      }, { w: d.width, h: d.height });
      if (rp.out.length) {
        fail++;
        console.log('✗ ' + d.name + ' ' + d.width + '×' + d.height + '（自选身份）');
        rp.out.forEach(e => console.log('    · ' + e));
      } else {
        console.log('✓ ' + d.name + ' ' + d.width + '×' + d.height +
          '（自选身份 ' + rp.cards + ' 卡 / ' + rp.cols + ' 列 / 卡高 ' + rp.cardH + 'px）');
      }
      /* 复位成未选态：否则这一档的选择会漏进后面的相位扫描 */
      await page.evaluate(() => {
        const m = document.getElementById('role-overlay');
        if (m) m.classList.add('hidden');
        UI.rpPick(null);
        document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
        document.getElementById('screen-game').classList.remove('hidden');
      });
    }

    /* ---------- 〔S5〕场景主区扫描 ----------
       布局收敛后主区 = 场景（主视觉）+ 行动面板 + 输入 dock，恒定布局（无相位显隐）。
       六相位仍逐个过 applyStageLayout（幂等回归）＋ 断言：场景可见、主区吃满、面板不挤没 dock。 */
    const PHASES = [
      { label: '白天·自由讨论', g: { phase: 'day', night: 2, pending: { kind: 'talk', stream: true } } },
      { label: '白天·投票', g: { phase: 'day', night: 2, pending: { kind: 'vote' } } },
      { label: '白天·自动步骤', g: { phase: 'day', night: 2, pending: null } },
      { label: '夜间·决策', g: { phase: 'night', night: 3, pending: { kind: 'repair' } } },
      { label: '夜间·自动步骤', g: { phase: 'night', night: 3, pending: null } },
      { label: '夜间·紧急会议', g: { phase: 'night', night: 3, pending: { kind: 'chat', stream: true } } },
    ];
    const phaseErrs = [];
    for (const ph of PHASES) {
      const m = await page.evaluate((g) => {
        UI.applyStageLayout(g);
        const main = document.querySelector('.seg-main');
        const sc = document.getElementById('scene-mount');
        const dec = document.getElementById('region-dec');
        const dockEl = document.querySelector('#screen-game .input-dock');
        const mainH = main.getBoundingClientRect().height;
        const dockH = dockEl ? dockEl.offsetHeight : 0;
        const scH = sc ? sc.getBoundingClientRect().height : 0;
        const decH = dec ? dec.getBoundingClientRect().height : 0;
        return {
          mainH: Math.round(mainH), scH: Math.round(scH), decH: Math.round(decH),
          sceneVis: sc && getComputedStyle(sc).display !== 'none',
          decVis: dec && getComputedStyle(dec).display !== 'none',
          /* 〔批 UI-3a〕面板的两种可见性来源：有待决策表单（has-actions）或用户手动展开（open） */
          decHasActions: dec ? dec.classList.contains('has-actions') : false,
          decOpen: dec ? dec.classList.contains('open') : false,
        };
      }, ph.g);
      if (!m.sceneVis) phaseErrs.push(ph.label + '：圆桌场景不可见');
      /* 〔批 UI-3a · 2026-10-26〕原来的断言是「行动面板必须可见」——
         那是面板**常驻**时代的规则。现在面板默认收起（用户：「把绿色方框去掉」），
         常驻可见反而成了缺陷。改守新的不变量：
           ① 场景必须吃满主区（这是真正要保护的：玩家看得见 15 席）；
           ② 面板若可见，不得挤压场景超过一半；
           ③ 面板**不许无理由常驻**：可见时必须能说明来源（有表单 或 用户展开）。 */
      if (m.decVis && !(m.decHasActions || m.decOpen)) {
        phaseErrs.push(ph.label + '：行动面板在无表单、未展开时仍然常驻（应收起）');
      }
      if (m.mainH < d.height * 0.6) phaseErrs.push(ph.label + '：主区仅 ' + m.mainH + 'px（未吃满）');
      if (m.scH < 100) phaseErrs.push(ph.label + '：场景仅 ' + m.scH + 'px（过小）');
      if (m.decH > d.height * 0.5) phaseErrs.push(ph.label + '：行动面板挤压场景（' + m.decH + 'px）');
    }
    if (phaseErrs.length) {
      fail++;
      console.log('✗ ' + d.name + ' ' + d.width + '×' + d.height + '（场景主区扫描）');
      phaseErrs.forEach(e => console.log('    · ' + e));
    } else {
      console.log('✓ ' + d.name + ' ' + d.width + '×' + d.height +
        '（场景主区 6 相位：场景可见 / 面板与输入不挤压）');
    }

    const res = await page.evaluate((vp) => {
      const out = [];
      const bad = (name, el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;          /* 隐藏元素跳过 */
        if (r.right > vp.w + 1 || r.left < -1 || r.bottom > vp.h + 1 || r.top < -1) {
          out.push(name + ' 溢出 ' + JSON.stringify({
            l: Math.round(r.left), t: Math.round(r.top),
            r: Math.round(r.right), b: Math.round(r.bottom),
          }));
        }
      };
      ['#screen-game', '.topbar', '.orb-bar', '#scene-mount', '.seg-main', '#region-dec', '#f-text', '#btn-send']
        .forEach(s => { const e = document.querySelector(s); if (e) bad(s, e); });
      /* 侧栏抽屉关闭时故意 translateX 到视口外，不算溢出；打开时必须在视口内 */
      const sd = document.querySelector('.seg-side');
      if (sd) {
        const open = sd.classList.contains('open');
        const r = sd.getBoundingClientRect();
        if (open && (r.left < -1 || r.right > vp.w + 1)) {
          out.push('.seg-side 打开态溢出 ' + JSON.stringify({ l: Math.round(r.left), r: Math.round(r.right) }));
        }
      }
      /* 〔S1〕名单 → 场景：量两者，按「哪个可见」断言——
         桌面/常规横屏/竖屏 = 场景可见；矮横屏 = 06-scene.css 切回旧名单横条（S5 做移动场景专项） */
      const sc = document.getElementById('scene-mount');
      const rr = document.getElementById('roster');
      let sceneSvg = false, sceneOverflow = false, sceneH = 0, sceneVisible = false;
      let rosterScrollable = false, rosterH = 0, rosterVisible = false;
      if (sc) {
        sceneVisible = getComputedStyle(sc).display !== 'none';
        sceneSvg = !!sc.querySelector('svg');
        sceneH = sc.getBoundingClientRect().height;
        if (sc.getBoundingClientRect().width > 0) sceneOverflow = sc.scrollWidth > sc.clientWidth + 1;
      }
      if (rr) {
        rosterVisible = getComputedStyle(rr).display !== 'none';
        rosterH = rr.getBoundingClientRect().height;
        const cs = getComputedStyle(rr);
        rosterScrollable = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
      }
      const tg = document.getElementById('btn-side-toggle');
      const rot = document.getElementById('rot-hint');
      return {
        out, sceneSvg, sceneOverflow, sceneH, sceneVisible, rosterScrollable, rosterH, rosterVisible,
        rotShown: !!rot && getComputedStyle(rot).display !== 'none',
        toggleShown: tg ? tg.style.display : 'missing',
      };
    }, { w: d.width, h: d.height });

    const errs = d.portrait ? [] : res.out.slice();
    if (d.portrait) {
      /* 竖屏刻意不适配（旋转提示遮罩已覆盖），故不查溢出——底层溢出对用户不可见 */
      if (!res.rotShown) errs.push('竖屏未显示旋转提示');
      if (res.toggleShown !== 'none') errs.push('竖屏不应显示抽屉按钮（当前 ' + res.toggleShown + '）');
    } else {
      /* 〔S1〕场景/名单双轨断言：场景可见 → 场景三查；矮横屏回退 → 旧名单横条两查 */
      if (res.sceneVisible) {
        if (!res.sceneSvg) errs.push('圆桌场景未渲染（#scene-mount 无 SVG）');
        if (res.sceneOverflow) errs.push('场景横向溢出');
        /* 〔批 UI-3a · 2026-10-26〕原断言「触屏下场景不得高于视口 60%」——
           它是为了给**常驻**的行动面板留位置（面板挤掉一半屏幕时场景若还超高，
           说明整页在滚动）。面板已默认收起，场景吃满才是目标（用户要求）。
           改守：触屏下场景可以吃满，但**页面本身不得纵向滚动**
           （滚动 = 操作区被推出视口 = 手机上点不到输入框）。 */
        if (d.touch) {
          const over = await page.evaluate(() =>
            (document.documentElement.scrollHeight - window.innerHeight));
          if (over > 2) errs.push('触屏下页面纵向溢出 ' + Math.round(over) + 'px（操作区被推出视口）');
        }
      } else if (d.touch && !res.rosterScrollable) {
        errs.push('名单未横向滚动（手机横屏必须是横条）');
      }
      if (d.touch && res.rosterVisible && res.rosterH > 60) errs.push('名单横条高度异常：' + Math.round(res.rosterH) + 'px');
      /* 〔U1 迁移〕房间制之后，场景一次只画**一间**房，旧的 8 张四角房间卡已退役。
         矮屏真正会坏的地方变了，断言随之改测：
           ① 场景 SVG 必须在位且按画布等比缩放（不溢出、不变形）；
           ② 房间地板矩形必须落在视口内（矮屏最容易把房间底部切掉）；
           ③ 门热区必须可点（矮屏上曾被行动面板压住）。 */
      if (d.touch) {
        const rooms = await page.evaluate((vp) => {
          const out = [];
          const svg = document.querySelector('#scene-mount svg.sk-scene');
          if (!svg) { out.push('场景 SVG 不在位'); return { out, n: 0 }; }
          const sr = svg.getBoundingClientRect();
          if (sr.width < 40 || sr.height < 40) out.push('场景 SVG 尺寸异常 ' + Math.round(sr.width) + '×' + Math.round(sr.height));
          if (sr.left < -1 || sr.right > vp.w + 1 || sr.top < -1 || sr.bottom > vp.h + 1)
            out.push('场景 SVG 出视口 ' + JSON.stringify({ l: Math.round(sr.left), r: Math.round(sr.right), t: Math.round(sr.top), b: Math.round(sr.bottom) }));
          /* 门热区：至少要有一扇可点的门，且不越界 */
          const doors = [...document.querySelectorAll('#scene-mount [data-door]')];
          if (!doors.length) out.push('房间没有门热区（无法离开房间）');
          const boxes = doors.map(e => {
            const r = e.getBoundingClientRect();
            return { id: e.getAttribute('data-door'), l: r.left, t: r.top, r: r.right, b: r.bottom };
          });
          for (const b of boxes) {
            if (b.l < -1 || b.r > vp.w + 1 || b.t < -1 || b.b > vp.h + 1)
              out.push('门 ' + b.id + ' 出视口 ' + JSON.stringify({ l: Math.round(b.l), r: Math.round(b.r), t: Math.round(b.t), b: Math.round(b.b) }));
          }
          /* 家具不得超出房间地板（矮屏缩放过小时最容易挤出去） */
          const floor = document.querySelector('#scene-mount .sk-room-floor');
          const fr = floor && floor.getBoundingClientRect ? floor.getBoundingClientRect() : null;
          if (fr) {
            for (const p of document.querySelectorAll('#scene-mount .sk-prop')) {
              const r = p.getBoundingClientRect();
              if (r.width < 1 || r.height < 1) continue;
              if (r.left < fr.left - 2 || r.right > fr.right + 2)
                out.push('家具越出房间边界 ' + (p.getAttribute('href') || '').split('/').pop());
            }
          }
          return { out, n: doors.length };
        }, { w: d.width, h: d.height });
        rooms.out.forEach(m => errs.push(m));
        res.roomCount = rooms.n;
      }
    }
    /* ---------- 〔批 UI-5 · 2026-10-26〕书记官记录板不压席位 ----------
       顶部 HUD 删除后，阶段名/倒计时/净破坏/决策窗口改成压在圆桌上的**一张纸**
       （#clerk，位置由 SKScene.layoutClerk 按桌面包围盒写回）。
       这是本批唯一一处"新增覆盖层"，因此必须实测：
         ① 纸在视口内（矮屏上不能掉出去）；
         ② 纸不压住任何角色的**绘制区域**（用角色帧框量，不用包围盒 ——
            批 UI-3a 记过：内层 svg 的包围盒比实际绘制大一圈，会误报）；
         ③ 纸不压住行动面板与输入框（它们仍是玩家唯一的提交路径）。
       反向自检：把 layoutClerk 的"座位让位"循环删掉 → 桌面档应当报「压住 N 席」。 */
    if (!d.portrait) {
      const clerk = await page.evaluate((vp) => {
        const out = [];
        const p = document.getElementById('clerk');
        if (!p) return { out: ['#clerk 不存在（书记官记录板未挂载）'], skip: true };
        if (p.classList.contains('hidden')) return { out, skip: true };
        const pr = p.getBoundingClientRect();
        if (pr.width < 80) out.push('书记官记录板宽 ' + Math.round(pr.width) + 'px（过窄，数字读不出来）');
        if (pr.left < -1 || pr.right > vp.w + 1 || pr.top < -1 || pr.bottom > vp.h + 1)
          out.push('书记官记录板出视口 ' + JSON.stringify({ l: Math.round(pr.left), r: Math.round(pr.right), t: Math.round(pr.top), b: Math.round(pr.bottom) }));
        const hit = (r) => r.width > 0 && r.left < pr.right && pr.left < r.right && r.top < pr.bottom && pr.top < r.bottom;
        /* 纸不得跑出场景（实测「宿舍」那间房曾算到 top:-27，一半在场景外，
           「当夜记录」按钮点不到）。视口检查拦不住这种情况 —— 场景本身就在视口内。 */
        const sr = document.getElementById('scene-mount').getBoundingClientRect();
        if (pr.left < sr.left - 1 || pr.right > sr.right + 1 || pr.top < sr.top - 1 || pr.bottom > sr.bottom + 1)
          out.push('书记官记录板跑出场景 ' + JSON.stringify({ paper: [Math.round(pr.left), Math.round(pr.top), Math.round(pr.right), Math.round(pr.bottom)], scene: [Math.round(sr.left), Math.round(sr.top), Math.round(sr.right), Math.round(sr.bottom)] }));
        /* 席位的**真实绘制矩形**由渲染器给出（SKScene.seatRects）：
           直接用 <svg class="sk-frame"> 的 getBoundingClientRect 会拿到 124×258 的
           包围盒（整张 384×800 行走图），而实际画出来只有 57×95 —— 用它判遮挡
           会把"纸上其实什么都没有"的地方算成压住人（交接文档 §3.2 的坑）。 */
        const rects = (window.SKScene && SKScene.seatRects) ? SKScene.seatRects() : [];
        let nSeat = 0;
        for (const r of rects) {
          if (r.left < pr.right && pr.left < r.right && r.top < pr.bottom && pr.top < r.bottom) nSeat++;
        }
        if (nSeat) out.push('书记官记录板压住 ' + nSeat + ' 个席位（玩家点不到自己/别人）');
        for (const sel of ['#region-dec', '#talkbar']) {
          const e = document.querySelector(sel);
          if (!e) continue;
          const cs = getComputedStyle(e);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          if (hit(e.getBoundingClientRect())) out.push('书记官记录板压住 ' + sel + '（提交路径被挡）');
        }
        return { out, box: [Math.round(pr.width), Math.round(pr.height)], nSeat };
      }, { w: d.width, h: d.height });
      if (clerk.out.length) {
        fail++;
        console.log('✗ ' + d.name + ' ' + d.width + '×' + d.height + '（书记官记录板）');
        clerk.out.forEach(e => console.log('    · ' + e));
      } else if (!clerk.skip) {
        console.log('✓ ' + d.name + ' ' + d.width + '×' + d.height +
          '（书记官记录板 ' + clerk.box[0] + '×' + clerk.box[1] + '，不压席位）');
      }
    }

    /* ---------- 〔批 UI-6 · 2026-10-26〕行动面板展开时不得压住席位 ----------
       本批把 #region-dec 从「流内挤压场景」改成「贴底抽屉浮层」：
         · 收益：场景恒 789px（改前有面板时只有 543px）；
         · 代价：不处理就会盖住房间下沿那一排（30×11 新房里是 1/2/15 号）。
       处理方式是 ui.js 广播 SKScene.setPanelOpen → 场景层把座圈上移 SEAT_LIFT 格。

       ★ 探针必须复现**真实面板高度**，否则这条断言是假的。
         第一版只注入了一个按钮 ⇒ 面板只有 82px 高 ⇒ 永远压不到人 ⇒
         把 SEAT_LIFT 改成 0 也不会变红（反向自检两次都没红，才发现问题）。
         真实决策表单是「15 个头像目标 + 公告 + 提示」，实测 1600×900 下约 400px。
         这里按真实结构灌 15 个 tgt-avatar（与 ui.js 的 renderForm 同款 DOM）。

       反向自检：把 SEAT_LIFT 改成 0 → 本档必须报「压住 3 个席位」。 */
    if (!d.portrait) {
      const panel = await page.evaluate(async (vp) => {
        const out = [];
        const rd = document.getElementById('region-dec');
        if (!rd) return { out: ['#region-dec 不存在'], skip: true };
        /* 按 renderForm 的真实结构造面板：公告块 + 说明 + 15 个头像目标 + 提交行。
           只造 DOM 结构，不碰表单协议（这里验的是布局，不是提交）。 */
        const body = document.getElementById('stage-body');
        const acts = document.getElementById('stage-actions');
        const avatars = Array.from({ length: 15 }, (_, k) =>
          '<label class="opt tgt-avatar" data-v="' + (k + 1) + '">'
          + '<input type="radio" name="ftgtAll" value="' + (k + 1) + '"/>'
          + '<span class="ta-face"><b>' + (k + 1) + '</b></span>'
          + '<span class="ta-name">' + (k + 1) + ' 号</span></label>').join('');
        if (body) {
          body.innerHTML = '<div class="annbox"><div class="sec">本步公告</div>'
            + '<div class="an">布局探针：用真实结构量面板高度</div></div>'
            + '<p class="hint">选择一个目标（最多 1 名）</p>'
            + '<div class="sec">选择目标（最多 1 名）</div>'
            + '<div class="opts grid3 tgt-avatars" id="f-targets">' + avatars + '</div>';
        }
        if (acts) acts.innerHTML = '<b id="timer-live" class="live"></b><span class="hint">提交后立即结算</span>'
          + '<select id="f-num"><option>1</option></select>'
          + '<button class="act primary" id="btn-submit">提交</button>';
        if (window.UI && UI.applyStageLayout) UI.applyStageLayout(window.Game && Game.g ? Game.g : { phase: 'day', night: 1, pending: null });
        await new Promise(r => setTimeout(r, 320));   /* 等 transition 与 ResizeObserver */
        const cs = getComputedStyle(rd);
        if (cs.display === 'none') return { out: ['面板未展开（探针没生效）'], skip: true };
        const pr = rd.getBoundingClientRect();
        if (pr.left < -1 || pr.right > vp.w + 1 || pr.top < -1 || pr.bottom > vp.h + 1)
          out.push('行动面板出视口 ' + JSON.stringify({ l: Math.round(pr.left), t: Math.round(pr.top), r: Math.round(pr.right), b: Math.round(pr.bottom) }));
        /* 探针自检：面板必须够高，否则这条断言又在空转 */
        if (pr.height < 140) out.push('探针面板只有 ' + Math.round(pr.height) + 'px（没复现真实表单高度，断言会空转）');
        const rects = (window.SKScene && SKScene.seatRects) ? SKScene.seatRects() : [];
        const hit = [];
        for (const r of rects) {
          if (r.left < pr.right && pr.left < r.right && r.top < pr.bottom && pr.top < r.bottom) hit.push(r.seat);
        }
        /* 〔批 UI-6〕两档判定：
           桌面档（>560px 高）面板是**非模态抽屉**，必须 0 压席位（座圈会压扁让位）；
           矮横屏（≤560px）面板是**模态抽屉**，遮挡是设计的一部分 —— 那时改为断言
             「场景确实被压暗（panel-modal 类在位）」+「面板够高能点 15 个目标」。
           这样两档各有各的真实约束，而不是用一个阈值糊过去。 */
        const modal = !!(document.getElementById('scene-mount') || {}).classList
          && document.getElementById('scene-mount').classList.contains('panel-modal');
        if (modal) {
          if (vp.h > 560) out.push('桌面档不该走模态（视口 ' + vp.h + 'px 高于 560 断点）');
          if (pr.height < 180) out.push('模态面板只有 ' + Math.round(pr.height) + 'px（点不到 15 个目标）');
        } else {
          if (vp.h <= 560) out.push('矮横屏未走模态档（panel-modal 类缺失，座圈躲不开面板）');
          if (hit.length) out.push('行动面板压住 ' + hit.length + ' 个席位（' + hit.join('/') + ' 号点不到）');
        }
        const scene = document.getElementById('scene-mount');
        const sceneH = scene ? Math.round(scene.getBoundingClientRect().height) : 0;
        if (sceneH < vp.h * 0.5) out.push('面板展开时场景只剩 ' + sceneH + 'px（面板又在挤压场景了）');
        return { out, hit: hit.length, sceneH, panelH: Math.round(pr.height), modal };
      }, { w: d.width, h: d.height });
      if (panel.out.length) {
        fail++;
        console.log('✗ ' + d.name + ' ' + d.width + '×' + d.height + '（行动面板与席位）');
        panel.out.forEach(e => console.log('    · ' + e));
      } else if (!panel.skip) {
        console.log('✓ ' + d.name + ' ' + d.width + '×' + d.height +
          (panel.modal
            ? '（行动面板·模态档 高 ' + panel.panelH + 'px，场景压暗让位）'
            : '（行动面板·抽屉档 0 压席位，场景仍 ' + panel.sceneH + 'px）'));
      }
    }

    /* ---------- 〔批 UI-5 · 2026-10-26〕主页「我这席」名字牌必须真的在视口内、且可点 ----------
       实测（1600×900）踩了两个坑，都只有截图能发现：
         ① 名字牌被 07-start-scene.css 的 `.start-box > *` 压成**流内 relative flex 子项**，
            拉成 1600px 宽，再叠加 JS 写的 left/top ⇒ 落到 (x=-209, y=1061) 视口外；
         ② 就算位置对了，z-index:1 也会让场景 SVG（z-index:2）把它**盖住**，
            elementFromPoint 命中的是 SVG 而不是名字牌。
       断言：位置在视口内 + 顶层层级上真能点到它。 */
    if (!d.portrait) {
      await page.evaluate(() => {
        document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
        document.getElementById('screen-start').classList.remove('hidden');
      });
      await page.waitForTimeout(200);
      const tag = await page.evaluate((vp) => {
        const out = [];
        const t = document.getElementById('seat-tag');
        if (!t) return { out: ['#seat-tag 不存在'], skip: true };
        if (t.classList.contains('hidden')) return { out: ['#seat-tag 仍是 hidden（场景未渲染？）'], skip: true };
        const b = t.getBoundingClientRect();
        if (b.left < -1 || b.right > vp.w + 1 || b.top < -1 || b.bottom > vp.h + 1)
          out.push('名字牌在视口外 ' + JSON.stringify({ l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }));
        if (b.width > vp.w * 0.6)
          out.push('名字牌宽 ' + Math.round(b.width) + 'px（被拉成整行 = 定位被通用子元素规则压掉了）');
        const cx = Math.min(vp.w - 2, Math.max(2, b.left + b.width / 2));
        const cy = Math.min(vp.h - 2, Math.max(2, b.top + b.height / 2));
        const hit = document.elementFromPoint(cx, cy);
        if (!hit || !hit.closest || !hit.closest('#seat-tag'))
          out.push('名字牌被盖住（命中 ' + (hit ? (hit.id || hit.tagName) : 'null') + '，点不到「我这席」）');
        return { out, box: [Math.round(b.width), Math.round(b.height)] };
      }, { w: d.width, h: d.height });
      if (tag.out.length) {
        fail++;
        console.log('✗ ' + d.name + ' ' + d.width + '×' + d.height + '（我这席名字牌）');
        tag.out.forEach(e => console.log('    · ' + e));
      } else if (!tag.skip) {
        console.log('✓ ' + d.name + ' ' + d.width + '×' + d.height +
          '（我这席名字牌 ' + tag.box[0] + '×' + tag.box[1] + '，在视口内且可点）');
      }
    }

    if (errs.length) {
      fail++;
      console.log('✗ ' + d.name + ' ' + d.width + '×' + d.height);
      errs.forEach(e => console.log('    · ' + e));
    } else {
      console.log('✓ ' + d.name + ' ' + d.width + '×' + d.height +
        (d.touch ? '（' + (res.sceneVisible ? '场景 ' + Math.round(res.sceneH) + 'px' : '名单横条 ' + Math.round(res.rosterH) + 'px')
          + '，抽屉按钮 ' + (res.toggleShown || 'none') + '）' : ''));
    }
    await ctx.close();
  }
  await browser.close();
  srv.close();
  console.log(fail ? '\n移动端布局自检：' + fail + ' 档失败' : '\n移动端布局自检：全部通过');
  process.exit(fail ? 1 : 0);
})();