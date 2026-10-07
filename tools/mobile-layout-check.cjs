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
      /* 灌最小内容：15 人名单 + 4 条发言，验证真实内容下的挤压 */
      const r = document.getElementById('roster');
      if (r) for (let i = 1; i <= 15; i++) {
        const d2 = document.createElement('div');
        d2.className = 'pl';
        d2.innerHTML = '<div class="did">' + i + ' 号</div><div class="tags"><span class="tag">船员</span></div>';
        r.appendChild(d2);
      }
      const c = document.getElementById('chatlog');
      if (c) for (let i = 0; i < 4; i++) {
        const s = document.createElement('div');
        s.className = 'say';
        s.innerHTML = '<span class="ava">3</span><div class="say-main"><div class="who">3 号</div>我怀疑 7 号是外星人，昨晚的查验方向不对。</div></div>';
        c.appendChild(s);
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

    /* ---------- 〔43〕主区相位扫描 ----------
       主区改为 f(阶段) 后，「对局页不溢出」这条老断言已不足够：它只量一种布局。
       这里对四个布局键各扫一遍，判定两件事：
         ① 夜间发言区必须**真的收起**（display:none），否则又变成半屏死区
         ② 流程区必须吃掉全部可用高度（不能因为改 flex 而留出一大块空）
       布局键由 UI.stageLayout 裁决 —— 门禁直接调它，不复述判定逻辑，
       避免「门禁和实现各写一份、两边漂移」。 */
    const PHASES = [
      { label: '白天·自由讨论', g: { phase: 'day', night: 2, pending: { kind: 'talk', stream: true } }, chat: true },
      { label: '白天·投票', g: { phase: 'day', night: 2, pending: { kind: 'vote' } }, chat: true },
      { label: '白天·自动步骤', g: { phase: 'day', night: 2, pending: null }, chat: true },
      { label: '夜间·决策', g: { phase: 'night', night: 3, pending: { kind: 'repair' } }, chat: false },
      { label: '夜间·自动步骤', g: { phase: 'night', night: 3, pending: null }, chat: false },
      { label: '夜间·紧急会议', g: { phase: 'night', night: 3, pending: { kind: 'chat', stream: true } }, chat: true },
    ];
    const phaseErrs = [];
    for (const ph of PHASES) {
      const m = await page.evaluate((g) => {
        const L = UI.applyStageLayout(g);
        const st = document.getElementById('seg-stage');
        const dockEl = document.querySelector('#screen-game .input-dock');
        const dcs = getComputedStyle(dockEl);
        const cs = getComputedStyle(st);
        const rce = document.getElementById('region-chat');
        const rde = document.getElementById('region-dec');
        const a = rce.getBoundingClientRect(), b = rde.getBoundingClientRect();
        const dockTotal = dockEl.offsetHeight + parseFloat(dcs.marginTop) + parseFloat(dcs.marginBottom);
        const avail = st.getBoundingClientRect().height - parseFloat(cs.paddingTop)
          - parseFloat(cs.paddingBottom) - dockTotal;
        return {
          key: L.key, chatVis: getComputedStyle(rce).display !== 'none',
          decVis: getComputedStyle(rde).display !== 'none',
          chatH: Math.round(a.height), fill: Math.round(((a.height || 0) + (b.height || 0)) / avail * 100),
        };
      }, ph.g);
      if (m.chatVis !== ph.chat) phaseErrs.push(ph.label + '：发言区' + (m.chatVis ? '应收起却仍在' : '被误收起'));
      if (!m.decVis) phaseErrs.push(ph.label + '：流程区不可见');
      /* 发言区保留时必须够高（否则讨论窗口被压成一条缝） */
      if (m.chatVis && m.chatH < 70) phaseErrs.push(ph.label + '：发言区仅 ' + m.chatH + 'px');
      /* 流程区必须占满可用高度 —— 低于 90% 即出现明显留空 */
      if (m.fill < 90) phaseErrs.push(ph.label + '：主区只占 ' + m.fill + '%（留空过多）');
    }
    if (phaseErrs.length) {
      fail++;
      console.log('✗ ' + d.name + ' ' + d.width + '×' + d.height + '（主区相位扫描）');
      phaseErrs.forEach(e => console.log('    · ' + e));
    } else {
      console.log('✓ ' + d.name + ' ' + d.width + '×' + d.height +
        '（主区相位 6 态：夜间收发言区 / 白天保发言区 / 流程区占满）');
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
      ['#screen-game', '.topbar', '.orb-bar', '#roster', '.seg-stage', '#chatlog', '#f-text', '#btn-send']
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
      const r = document.getElementById('roster');
      let rosterScrollable = false, rosterH = 0;
      if (r) {
        rosterH = r.getBoundingClientRect().height;
        const cs = getComputedStyle(r);
        rosterScrollable = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
      }
      const tg = document.getElementById('btn-side-toggle');
      const rot = document.getElementById('rot-hint');
      return {
        out, rosterScrollable, rosterH,
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
      if (d.touch && !res.rosterScrollable) errs.push('名单未横向滚动（手机横屏必须是横条）');
      if (d.touch && res.rosterH > 60) errs.push('名单横条高度异常：' + Math.round(res.rosterH) + 'px');
      if (d.touch) {
        /* 抽屉打开态必须完整落在视口内（等transition 结束再量，否则量到动画中间态） */
        await page.evaluate(() => { const s = document.querySelector('.seg-side'); if (s) s.classList.add('open'); });
        await page.waitForTimeout(500);
        const dr = await page.evaluate(() => {
          const el = document.querySelector('.seg-side');
          const r = el.getBoundingClientRect();
          return { l: Math.round(r.left), r: Math.round(r.right), tf: getComputedStyle(el).transform };
        });
        if (dr.tf !== 'none') errs.push('抽屉未完全展开（transform=' + dr.tf + '）');
        if (dr.l < -1 || dr.r > d.width + 1) errs.push('抽屉打开态溢出 ' + JSON.stringify(dr));
        await page.evaluate(() => { const s = document.querySelector('.seg-side'); if (s) s.classList.remove('open'); });
      }
    }
    if (errs.length) {
      fail++;
      console.log('✗ ' + d.name + ' ' + d.width + '×' + d.height);
      errs.forEach(e => console.log('    · ' + e));
    } else {
      console.log('✓ ' + d.name + ' ' + d.width + '×' + d.height +
        (d.touch ? '（名单横条 ' + Math.round(res.rosterH) + 'px，抽屉按钮 ' + (res.toggleShown || 'none') + '）' : ''));
    }
    await ctx.close();
  }
  await browser.close();
  srv.close();
  console.log(fail ? '\n移动端布局自检：' + fail + ' 档失败' : '\n移动端布局自检：全部通过');
  process.exit(fail ? 1 : 0);
})();