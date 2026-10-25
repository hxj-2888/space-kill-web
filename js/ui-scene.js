/* =============================================================
 * 太空杀 · 场景化 UI 渲染器（2026-10-25 批 S1，只读层）
 * -------------------------------------------------------------
 * 职责：把对局状态画成「圆桌 + 15 席」场景（玩家名单的视觉替身）。
 *   · 数据只读：g.phase / g.pending（仅用于判断「轮到自己」）+ V = View.viewFor
 *     裁剪视图（V.players[].out/outType、V.id）。不读任何真相字段——
 *     视图里没有的（他人身份/濒死/私有）这里就看不见。
 *   · 可见性纪律（7.1 最小信息）：
 *       - 夜眼只表达【观察者视角】：夜间除「自己（且轮到自己提交）」外全部闭眼；
 *         绝不显示其他席位正在行动——引擎的 pending 只为真人步骤存在（AI 步骤即时结算），
 *         故「pending 存在 = 轮到我」是合法判据，不产生任何泄露。
 *       - 出局是公开信息（⑥⑩揭示）→ 灰度 + ✕ + 倾斜离席；濒死是私有信息 → 零视觉
 *         （4.10.4/5.3.1：不得移除或置灰，本层照常在桌、照常可点）。
 *   · 渲染策略：innerHTML 字符串模板（与 ui.js 同族，uismoke DOM 桩安全）+ 结构签名——
 *     签名不变不重绘，CSS 动画与 <image> 不受 200ms tick 干扰。
 *   · 素材：assets/scene/characters/a-crew/seat-XX.svg（CC0，座位号种子，S0 拍板方案A）。
 * 本层不接任何交互（点击/菜单/气泡 = S3a/S3b）。
 * ============================================================= */
(function (global) {
  'use strict';
  const N = 15;
  /* 15 席固定色板（座位号 → 颜色，局内稳定；与 S0 预览一致） */
  const PALETTE = ['#ff6b6b', '#ff922b', '#fcc419', '#c0eb75', '#69db7c', '#38d9a9', '#3bc9db',
    '#4dabf7', '#748ffc', '#9775fa', '#da77f2', '#e64980', '#f783ac', '#ffe066', '#94d82d'];
  const MINE = '#ffd43b';                       /* 自己席位：金环 */
  const ASSET = 'assets/scene/characters/a-crew/seat-XX.svg';

  /* 等弧长座次：椭圆按【弧长】均分（等角度分布会让上下极拥挤——S0 预览实测结论）。
     数值积分弧长表 + 二分反解，模块加载时算一次（N=15 静态表）。 */
  const ANG = (function () {
    const steps = 2400, rx = 1.25, ry = 0.72, acc = [0];
    let total = 0;
    for (let k = 1; k <= steps; k++) {
      const tm = ((k - 0.5) / steps) * Math.PI * 2;
      total += Math.hypot(rx * Math.sin(tm), ry * Math.cos(tm)) * (Math.PI * 2 / steps);
      acc.push(total);
    }
    const out = [];
    for (let j = 0; j < N; j++) {
      const target = j / N * total;
      let lo = 0, hi = steps;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (acc[mid] < target) lo = mid + 1; else hi = mid; }
      /* ⚠ target=0 时 lo=0，acc[-1] 为 undefined → f=NaN → 席位坐标 NaN（S0 预览曾被
         CSS 初始位掩盖、S1 的 SVG 坐标直接暴露）——prev 必须兜底 0 */
      const prev = lo > 0 ? acc[lo - 1] : 0;
      const f = (target - prev) / Math.max(1e-9, acc[lo] - prev);
      out.push(((lo - 1) + f) / steps * Math.PI * 2 + Math.PI / 2);   /* 旋转 π/2：1 号在正下方 */
    }
    return out;
  })();

  /* 场景几何（viewBox 坐标）：座圈 + 出局外圈 + 中央圆桌/船核心 */
  const VB = { w: 400, h: 480 };
  const GEO = { cx: 200, cy: 244, rx: 152, ry: 182, seatR: 27, outRx: 176, outRy: 207, tableRx: 96, tableRy: 120, coreS: 36 };
  const CORE_POINTS = (function () {
    const s = GEO.coreS, cx = GEO.cx, cy = GEO.cy, pts = [];
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + k * Math.PI / 3;      /* 尖角朝上下 */
      pts.push((cx + Math.cos(a) * s).toFixed(1) + ',' + (cy + Math.sin(a) * s).toFixed(1));
    }
    return pts.join(' ');
  })();

  function escAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* 单席：<g> 以 translate(x,y) 定位（子元素全部相对 0,0）——
     〔S3b〕散桌动画的前提：布局切换只改 g 的 CSS transform，交由 transition 补间 */
  function seatSvg(p, i, st) {
    const r = GEO.seatR;
    const clip = 'sk-clip-' + i;
    const img = ASSET.replace('XX', String(i).padStart(2, '0'));
    const ring = st.mine ? MINE : PALETTE[i - 1];
    return '<g id="sk-seat-' + i + '" data-seat="' + i + '" class="sk-seat'
      + (st.mine ? ' sk-mine' : '') + (st.out ? ' sk-out' : '') + (st.closed ? ' sk-closed' : '') + '">'
      + '<defs><clipPath id="' + clip + '"><circle cx="0" cy="0" r="' + (r - 2) + '"/></clipPath></defs>'
      + '<circle cx="0" cy="0" r="' + r + '" fill="#0a0f18" stroke="' + ring + '" stroke-width="' + (st.mine ? 4 : 3) + '"/>'
      + '<image href="' + escAttr(img) + '" xlink:href="' + escAttr(img) + '" x="' + (2 - r) + '" y="' + (2 - r)
      + '" width="' + (2 * r - 4) + '" height="' + (2 * r - 4) + '" clip-path="url(#' + clip + ')" preserveAspectRatio="xMidYMid slice"/>'
      + (st.closed
        ? '<circle cx="0" cy="0" r="' + (r - 2) + '" class="sk-lids"/>'
          + '<text x="0" y="4" text-anchor="middle" class="sk-lids-t">‿‿</text>'
        : '')
      + (st.out ? '<text x="' + (r - 5) + '" y="' + (2 - r + 8) + '" text-anchor="middle" class="sk-out-x">✕</text>' : '')
      + '<circle cx="0" cy="' + (1 - r) + '" r="11" class="sk-num-bg" stroke="' + ring + '"/>'
      + '<text x="0" y="' + (5 - r) + '" text-anchor="middle" class="sk-num">' + i + '</text>'
      + '</g>';
  }

  /* 〔S2〕人类工具舱（房间环）：**只含工具型技能**——异形/外星人的天赋（出刀/感染/结茧/
     蛰伏/双刀）是卡载能力，S3a 起直接点目标发动，不经房间（正文依据见各 grant 注记）。
     S2 全部呈信息态（title 提示 + 锁定样式）；点亮（轮到自己 + 待决策 kind 匹配）= S3a。 */
  const ROOMS = [
    { id: 'verify',  ico: '🔍', name: '查证室', tip: '神探 · 每夜查验 / 发布官方公告（4.7）' },
    { id: 'patrol',  ico: '🚓', name: '巡逻岗', tip: '警长 · 全局 1 次巡逻保护（4.4.4）' },
    { id: 'medical', ico: '⚕️', name: '医疗室', tip: '医生族 · 治疗 / 救援 / 自救（4.5/4.6）' },
    { id: 'pharma',  ico: '💊', name: '制药室', tip: '医生族 / 疫苗研究员 · 制药攒额度（3.3.1/4.14）' },
    { id: 'repair',  ico: '🔧', name: '维修室', tip: '工程师系 / 船员 · 维修与协助维修（4.3/4.1.2）' },
    { id: 'safe',    ico: '🛡️', name: '安全室', tip: '进入安全室 · 全额减免层（4.3.1）' },
    { id: 'meeting', ico: '📢', name: '议事厅', tip: '验票官 · 发动紧急会议（4.9.2）' },
    { id: 'armory',  ico: '🔫', name: '军械库', tip: '警长 / 猎手 / 武装 · 枪械与嗅探（4.4.7）' },
  ];
  function roomsHtml() {
    let h = '<div id="scene-rooms" class="sk-rooms" aria-label="飞船功能舱">';
    for (const r of ROOMS) {
      h += '<div class="sk-room" data-room="' + r.id + '" title="' + escAttr(r.tip) + '">'
        + '<span class="sk-room-ico">' + r.ico + '</span><b>' + r.name + '</b></div>';
    }
    return h + '</div>';
  }

  /* 〔S2〕书记官：非玩家 NPC 摆件——只记录公开信息（公告/公开发言/投票/公开揭示），
     不参与游戏进程；档案面板 = S3b 接线。形象与 15 席明显区分（无编号、灰底）。 */
  function scribeHtml() {
    return '<div id="scene-scribe" class="sk-scribe" title="书记官：只记公开信息，不参与游戏">'
      + '<img src="assets/scene/characters/scribe/scribe.svg" alt="书记官" draggable="false">'
      + '<div class="sk-scribe-t"><b>书记官 · 公开档案</b><i>公告 / 发言 / 票决 · 不参与游戏</i></div>'
      + '</div>';
  }

  function svgFor(g, V, myTurn) {
    const night = g.phase === 'night';
    let seats = '';
    for (let i = 1; i <= N; i++) {
      const p = V.players[i - 1];
      if (!p || p.id !== i) return '';               /* 防御：视图席位必须按 1..15 顺序 */
      const out = !!p.out;
      const mine = p.id === V.id;
      /* 夜眼（观察者视角）：夜间闭眼；例外 = 轮到自己提交时的自己；出局者无眼态 */
      const closed = night && !out && !(mine && myTurn);
      seats += seatSvg(p, i, { out, mine, closed });
    }
    return '<svg class="sk-scene" viewBox="0 0 ' + VB.w + ' ' + VB.h + '" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" role="img" aria-label="圆桌场景（15 席）">'
      + '<ellipse class="sk-table" cx="' + GEO.cx + '" cy="' + GEO.cy + '" rx="' + GEO.tableRx + '" ry="' + GEO.tableRy + '"/>'
      + '<polygon class="sk-core' + (night ? ' sk-core-night' : '') + '" points="' + CORE_POINTS + '"/>'
      + '<text x="' + GEO.cx + '" y="' + (GEO.cy + 4) + '" text-anchor="middle" class="sk-core-t">核心</text>'
      + seats
      + '</svg>';
  }

  /* =============================================================
   * 〔S3b〕布局态与散桌：seated（圆桌）/ scattered（0c 私聊散开）
   * 配对关系公开（批次①公告「谁和谁配对」）→ 散开时各组结伴；正文气泡只给己方组。
   * 配对数据源 g.nightChats（{a,b,lines} 全量组，正文只在其中；2.2 口径）。
   * ============================================================= */
  function pairGroups(g) {
    const groups = [];
    const seen = {};
    for (const c of (g.nightChats || [])) {
      if (seen[c.a] || seen[c.b]) continue;
      seen[c.a] = seen[c.b] = true;
      groups.push([c.a, c.b]);
    }
    /* 未入组的存活席位（无配对/单人）单独散点 */
    const loners = [];
    for (let i = 1; i <= N; i++) if (!seen[i]) loners.push(i);
    return { groups, loners };
  }
  /* 席位中心坐标：mode = seated / scattered */
  function seatPos(g, i, mode) {
    const rx = GEO.rx * 1.25, ry = GEO.ry * 0.72;
    if (mode !== 'scattered') {
      const a = ANG[i - 1];
      const out = g && g.players[i - 1] && g.players[i - 1].out;
      return {
        x: GEO.cx + Math.cos(a) * (out ? GEO.outRx : rx),
        y: GEO.cy + Math.sin(a) * (out ? GEO.outRy : ry),
      };
    }
    const { groups, loners } = pairGroups(g);
    const unit = groups.concat(loners.map(x => [x]));
    const gi = unit.findIndex(grp => grp.indexOf(i) >= 0);
    const ga = gi / unit.length * Math.PI * 2 - Math.PI / 2;
    const gx = GEO.cx + Math.cos(ga) * rx * 1.02;
    const gy = GEO.cy + Math.sin(ga) * ry * 0.86 - 14;
    const grp = unit[gi], k = grp.indexOf(i), n = grp.length;
    const off = (k - (n - 1) / 2) * (GEO.seatR * 2 + 6);
    return { x: gx + Math.cos(ga + Math.PI / 2) * off, y: gy + Math.sin(ga + Math.PI / 2) * off * 0.4 };
  }
  /* 布局态切换（每 tick 幂等）：只写 g 的 CSS transform，散桌/回桌由 transition 补间 */
  let lastMode = '';
  function updateLayout(g, V, mount) {
    try {
      const svg = mount.querySelector('.sk-scene');
      if (!svg) return;
      const mode = (g.step === '0c') ? 'scattered' : 'seated';
      if (mode === lastMode && mount.__skMode) return;
      for (let i = 1; i <= N; i++) {
        const s = svg.querySelector('#sk-seat-' + i);
        if (!s) continue;
        const p = seatPos(g, i, mode);
        s.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px)';
      }
      mount.__skMode = mode;
      lastMode = mode;
      /* 首布局落定后才启用补间（sk-anim），避免重建时席位从 (0,0) 飞入 */
      if (!svg.classList.contains('sk-anim')) {
        void svg.getBoundingClientRect();
        svg.classList.add('sk-anim');
      }
    } catch (_) { /* 桩环境静默 */ }
  }

  let sig = null;
  /** 渲染入口（ui.render 每 tick 调）：签名不变则零结构写入；交互态（点亮/选中环）每 tick 增量 toggle。 */
  function render(g, V) {
    if (!g || !V || !V.players || V.players.length !== N) return;
    const doc = global.document;
    const mount = doc && doc.getElementById ? doc.getElementById('scene-mount') : null;
    if (!mount) return;
    /* pending 只为真人步骤存在（AI 步骤即时结算）⇒ 「pending 非 stream = 轮到我」 */
    const myTurn = !!(g.pending && !g.pending.stream);
    const kind = myTurn ? (g.pending.kind || '') : '';
    const key = [V.id, g.phase === 'night' ? 1 : 0, myTurn ? 1 : 0,
      V.players.map(p => (p.out ? 1 : 0)).join('')].join('|');
    if (key !== sig || !mount.__skBuilt) {
      const svg = svgFor(g, V, myTurn);
      if (!svg) return;
      /* 〔S2〕三段结构：房间环（上）+ 圆桌场景（中）+ 书记官（下）+ 气泡层（S3b） */
      mount.innerHTML = roomsHtml() + svg + scribeHtml()
        + '<div id="sk-bubbles" class="sk-bubbles" aria-live="polite"></div>';
      mount.__skBuilt = true;
      bindEvents(mount);
      lastMode = '';                             /* 重建后强制全量写席位 transform（首布局免动画） */
      sig = key;
    }
    updateLayout(g, V, mount);
    updateBubbles(g, V, mount);
    updateInteractive(g, V, myTurn, kind, mount);
    lastG = g; lastV = V; lastMount = mount;
  }

  /* =============================================================
   * 〔S3b〕发言气泡（气泡纪律——正文可见性严格分流）：
   *   · 公开发言（讨论/会议）：talks 尾条 → 作者席位头顶冒泡，全员可见；
   *   · 0c 私聊：只冒【己方配对组】的双向气泡（nightChats 己组 lines + inbox 私聊行）；
   *     他人组、异形队内频道 —— 零气泡（2.2 / 3.3④）。
   * 气泡走 SVG foreignObject（viewBox 坐标精确定位），5s 自动淡出。
   * ============================================================= */
  let lastTalkKey = '';
  let lastPmKey = '';
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /* pt = 气泡锚点（viewBox 坐标，气泡底部中心） */
  function popBubble(g, V, mount, pt, label, text, isMe) {
    try {
      const box = mount.querySelector('#sk-bubbles');
      if (!box) return;
      while (box.childNodes.length >= 6) box.removeChild(box.firstChild);   /* 上限防堆积 */
      const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
      fo.setAttribute('x', Math.max(2, Math.min(VB.w - 194, pt.x - 96)).toFixed(1));
      fo.setAttribute('y', Math.max(2, pt.y - 74).toFixed(1));
      fo.setAttribute('width', 192);
      fo.setAttribute('height', 76);
      fo.setAttribute('class', 'sk-fo');
      fo.innerHTML = '<div xmlns="http://www.w3.org/1999/xhtml" class="sk-bubble' + (isMe ? ' sk-me' : '') + '">'
        + (label ? '<span class="who">' + escHtml(label) + '</span>' : '') + escHtml(text)
        + '</div>';
      box.appendChild(fo);
      setTimeout(() => { try { fo.remove(); } catch (_) {} }, 5200);
    } catch (_) { /* 桩环境静默 */ }
  }
  function updateBubbles(g, V, mount) {
    try {
      /* 公开发言：g.talks 只增，尾条变化即冒泡 */
      const talks = g.talks || [];
      const tk = g.night + ':' + talks.length;
      if (tk !== lastTalkKey) {
        lastTalkKey = tk;
        if (talks.length) {
          const t = talks[talks.length - 1];
          if (t && t.text) {
            const p = seatPos(g, t.id, 'seated');
            popBubble(g, V, mount, { x: p.x, y: p.y - GEO.seatR - 4 }, t.id + ' 号' + (t.id === V.id ? '（我）' : ''), t.text, t.id === V.id);
          }
        }
      }
      /* 0c 私聊：只冒【己方配对组】的中性气泡（定位组中心上方）；
         nightChats.lines 无作者标记 ⇒ 不标谁说的（与 nightChatHtml「N 号 ↔ 我」口径一致）；
         他人组、异形队内频道 —— 零气泡（2.2 / 3.3④，队内内容归阵营日记本） */
      if (g.step === '0c') {
        const me = g.players[V.id - 1];
        let tail = null, myGroup = null;
        for (const c of (g.nightChats || [])) {
          if (c.a !== V.id && c.b !== V.id) continue;
          myGroup = [c.a, c.b];
          const ls = c.lines || [];
          if (ls.length) tail = ls[ls.length - 1];
        }
        for (const e of (me.inbox || [])) {
          if (e.night !== g.night) continue;
          if (/（队内）：/.test(e.text || '')) continue;          /* 队内零气泡 */
          const m = /^(\d+) 号（私聊）：(.*)$/.exec(e.text || '');
          if (m) { tail = m[2]; if (!myGroup) myGroup = [V.id, +m[1]]; }
        }
        const pk = g.night + '|' + (tail != null ? tail : '');
        if (pk !== lastPmKey && tail != null && myGroup) {
          lastPmKey = pk;
          const p1 = seatPos(g, myGroup[0], 'scattered');
          const p2 = seatPos(g, myGroup[1], 'scattered');
          const mid = { x: (p1.x + p2.x) / 2, y: Math.min(p1.y, p2.y) - 6 };
          popBubble(g, V, mount, mid, '私聊', tail, false);
        }
      } else if (lastPmKey) {
        lastPmKey = '';
      }
    } catch (_) { /* 桩环境静默 */ }
  }

  /* =============================================================
   * 〔S3a〕交互层：场景点击 100% 委托给既有表单控件与弹窗——
   *   · 席位点击：表单态（有目标区）= 委托点击对应目标 input（复用 onchange → formState）；
   *     非表单态 = 打开玩家详情弹窗（与旧名单卡片同行为，讯问句在弹窗内）。
   *   · 房间点击：待决策 kind 匹配该舱 ⇒ 滚到表单并闪烁提示；否则 toast 说明。
   *   · 核心点击：对船动作（破坏/逃亡等）同理。
   * 不新建任何提交路径——提交仍只有 renderForm 的「提交」按钮（Game.submit 协议不变）。
   * ============================================================= */
  const ROOM_KINDS = {
    verify: ['detective'], patrol: ['patrol'], medical: ['doctor'],
    pharma: ['doctor'], repair: ['crewAction', 'crewRepair', 'repair'],
    safe: ['safeRoom'], meeting: ['meeting'], armory: ['shoot'],
  };
  const CORE_KINDS = ['branch', 'escape', 'xenoCure'];
  function kindRoom(kind) {
    for (const r in ROOM_KINDS) if (ROOM_KINDS[r].indexOf(kind) >= 0) return r;
    return null;
  }

  let toastTimer = null;
  function toast(mount, msg) {
    try {
      let t = mount.querySelector('.sk-toast');
      if (!t) {
        mount.insertAdjacentHTML('beforeend', '<div class="sk-toast"></div>');
        t = mount.querySelector('.sk-toast');
      }
      t.textContent = msg;
      t.classList.add('show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { t.classList.remove('show'); }, 1800);
    } catch (_) { /* 桩环境静默 */ }
  }

  function flashForm() {
    try {
      const body = document.getElementById('stage-body');
      if (!body) return;
      body.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      body.classList.remove('sk-flash');
      void body.offsetWidth;                     /* 重启动画 */
      body.classList.add('sk-flash');
      setTimeout(() => body.classList.remove('sk-flash'), 900);
    } catch (_) { }
  }

  function bindEvents(mount) {
    if (!mount.addEventListener || mount.__skBound) return;
    mount.__skBound = true;
    mount.addEventListener('click', e => {
      try {
        const t = e.target && e.target.closest ? e.target : null;
        if (!t) return;
        const seat = t.closest('[data-seat]');
        if (seat) { onSeatClick(+seat.getAttribute('data-seat'), mount); return; }
        const room = t.closest('[data-room]');
        if (room) { onRoomClick(room.getAttribute('data-room'), mount); return; }
        if (t.closest('.sk-core')) { onCoreClick(mount); return; }
        if (t.closest('#scene-scribe')) { toast(mount, '书记官档案将在下一批开放（S3b）'); }
      } catch (_) { /* 交互层异常不外抛 */ }
    });
  }

  /* 席位点击：表单态委托目标 input；其余打开详情弹窗（ui.openPlayerPop，S3a 起 ui.js 导出） */
  function onSeatClick(pid, mount) {
    const g = global.Game && global.Game.g;
    if (!g) return;
    if (g.pending && !g.pending.stream) {
      const body = document.getElementById('stage-body');
      const inp = body && body.querySelector('#f-targets input[value="' + pid + '"]:not([disabled])');
      const inpPool = body && body.querySelector('#f-pool input[value="' + pid + '"]:not([disabled])');
      const pick = inp || inpPool;
      if (pick) {
        pick.click();                              // 复用 renderForm 的 onchange → formState
        refresh();                                 /* 决策等待期 tick 不跑 UI.render——场景环即时联动 */
        if (body) body.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      toast(mount, '当前决策不需要选择 ' + pid + ' 号（在表单里选择行动）');
      return;
    }
    if (global.UI && global.UI.openPlayerPop) global.UI.openPlayerPop(pid);
  }

  function onRoomClick(roomId, mount) {
    const g = global.Game && global.Game.g;
    const kind = g && g.pending && !g.pending.stream ? (g.pending.kind || '') : '';
    const room = ROOMS.find(r => r.id === roomId);
    if (kind && ROOM_KINDS[roomId] && ROOM_KINDS[roomId].indexOf(kind) >= 0) {
      flashForm();
      toast(mount, room ? room.name + ' · 在右侧表单完成本次行动' : '完成本次行动');
    } else {
      toast(mount, (room ? room.name : roomId) + '：现在没有待办的相关行动');
    }
  }

  function onCoreClick(mount) {
    const g = global.Game && global.Game.g;
    const kind = g && g.pending && !g.pending.stream ? (g.pending.kind || '') : '';
    if (kind && CORE_KINDS.indexOf(kind) >= 0) {
      flashForm();
      toast(mount, '船核心 · 在表单完成对船行动');
    } else {
      toast(mount, '船核心：对船行动（破坏/逃亡）在对应夜晚窗口开放');
    }
  }

  /* 交互态增量：房间点亮 + 席位选中环（读表单 checked 态，幂等 toggle 不重绘） */
  let lastG = null, lastV = null, lastMount = null;
  /** 即时刷新交互态（ui.js 表单 onchange 调用；决策等待期 tick 不跑 UI.render，必须由此补） */
  function refresh() {
    if (lastG && lastV && lastMount) {
      const myTurn = !!(lastG.pending && !lastG.pending.stream);
      updateInteractive(lastG, lastV, myTurn, myTurn ? (lastG.pending.kind || '') : '', lastMount);
    }
  }
  function updateInteractive(g, V, myTurn, kind, mount) {
    try {
      const lit = myTurn ? kindRoom(kind) : null;
      mount.querySelectorAll('.sk-room').forEach(r => {
        r.classList.toggle('sk-lit', !!lit && r.getAttribute('data-room') === lit);
      });
      const core = mount.querySelector('.sk-core');
      if (core) core.classList.toggle('sk-lit', myTurn && CORE_KINDS.indexOf(kind) >= 0);
      let sel = [];
      const body = document.getElementById('stage-body');
      if (body && myTurn) {
        sel = [...body.querySelectorAll('#f-targets input:checked, #f-pool input:checked')].map(x => +x.value);
      }
      for (let i = 1; i <= N; i++) {
        const s = document.getElementById('sk-seat-' + i);
        if (s && s.classList) s.classList.toggle('sk-sel', sel.indexOf(i) >= 0);
      }
    } catch (_) { /* 桩环境静默 */ }
  }

  global.SKScene = { render, refresh, _ang: ANG, _palette: PALETTE };
})(typeof window !== 'undefined' ? window : globalThis);
