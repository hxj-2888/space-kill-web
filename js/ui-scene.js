/* =============================================================
 * 返航录 · 场景化 UI 渲染器（2026-10-25 重设计 R2）
 * -------------------------------------------------------------
 * 这一版按用户拍板重做，与旧版（backup/form-ui-20261025/ui-scene.js）的差别：
 *   ① **横版大场景**：viewBox 1400×760（旧版 400×480 竖版）。旧版圆桌 rx/ry=96/120
 *      配 15 席 152/182 的座圈 —— 桌子比座圈小太多，15 个角色贴着桌子边缘，
 *      这就是"桌子太小、围得太挤"的根因。新版桌面 rx/ry=268/160，座圈 400/240，
 *      席位半径 44，相邻席位中心距 ≈136px（直径 88），留 48px 净空。
 *   ② **8 个技能室进角落**：旧版是一排 8 个文字方块横在场景上方（"十分呆板"）。
 *      新版每间是一张**独立场景卡**（Kenney CC0 太空站道具拼装），分列左右两侧
 *      上下四角，各 2 张 —— 既在"主页角落"，又不再挤占中央主视觉。
 *   ③ **无 emoji**：房间标识改用道具图 + 文字（用户明确要求）。
 *   ④ **气泡为唯一发言载体**：不再有"一行一行"的流水列表（那部分已随旧设计删除）。
 *
 * 数据纪律（沿用旧版，未放宽）：
 *   · 只读 g.phase / g.pending（判断"轮到我"）+ V = View.viewFor 裁剪视图。
 *   · 夜眼只表达观察者视角；出局是公开信息 → 灰度离席；濒死是私有信息 → 零视觉。
 *   · 气泡正文分流：公开发言全员可见；0c 私聊只冒己方配对组；队内频道零气泡。
 * ============================================================= */
(function (global) {
  'use strict';
  const N = 15;
  const PALETTE = ['#ff6b6b', '#ff922b', '#fcc419', '#c0eb75', '#69db7c', '#38d9a9', '#3bc9db',
    '#4dabf7', '#748ffc', '#9775fa', '#da77f2', '#e64980', '#f783ac', '#ffe066', '#94d82d'];
  const MINE = '#ffd43b';
  const ASSET = 'assets/scene/characters/a-crew/seat-XX.svg';
  const PROP = 'assets/scene/station/';
  const ROOM_ART = 'assets/scene/rooms/';   /* 〔R3〕每间房的像素场景图（Cozy Space Interiors, CC-BY） */

  /* ---- 场景几何（viewBox 坐标，横版 1600×900）----
     ⚠ 这组数不是随手填的。用户点名两个问题：「桌子太小，15 个角色围在桌子旁边显得非常挤」。
     判据（.tmp 自检脚本与 tools 门禁同口径）：
       ① 相邻席位最小中心距 ≥ 直径 + 12px（不重叠且留呼吸）
       ② 席位边缘到桌缘 ≥ 45px（旧版桌面 96×120 配座圈 152×182，桌面比座圈小得多，
          角色全贴在桌边——"围在桌子旁边非常挤"的根因之一）
       ③ 座圈左右各留 ≥ 165px 给 8 个技能室（分列四角）
       ④ 座圈下缘距画布底 ≥ 250px，给行动面板与输入 dock 让位（否则底部席位被面板压住）
     椭圆用接近正圆（ry/rx≈0.81）：越扁则短轴方向越密，净空反而变小（实测过 0.6 的极端值）。
     实测取值：净空 20.8px · 离桌 76px · 左右各 236px · 桌面/座圈 53%。 */
  const VB = { w: 1600, h: 900 };
  const GEO = {
    cx: 800, cy: 328,
    rx: 540, ry: 250,          /* 座圈 */
    outRx: 570, outRy: 270,    /* 出局者外圈 */
    seatR: 46,                 /* 席位半径：直径 92（40 太小认不清，48 会把净空压到 8px） */
    tableRx: 268, tableRy: 126,
    coreS: 64,
  };

  /* ---- 座次算法：**参数角均分**（不是等弧长）----
     ⚠ 这是本次重设计修掉的一个**从 S1 起就存在的方法错误**：
     旧实现按"等弧长"放席位，理由是"等角度会让椭圆上下极拥挤"。实测（15 席，弦长 =
     相邻席位中心距，即"挤不挤"的直接判据）：

       rx/ry      等弧长 最小弦长 / 离散度      参数角 最小弦长 / 离散度
       500/248    80.8 / 3.78                 104.8 / 1.98
       520/250    80.9 / 4.00                 105.8 / 2.04
       470/380   144.3 / 1.51                 158.5 / 1.23

     **等弧长在所有情形下都更差**（离散度 1.9~4.0 倍）。原因：弧长与弦长不是线性关系，
     椭圆短轴附近弧长密度高，等弧长反而把席位挤到短轴两侧。参数角均分才是均匀的。
     这条同时解释了用户"15 个角色围在桌子旁边显得非常挤"的一半原因（另一半是桌子太小）。 */
  const ANG = (function () {
    const out = [];
    for (let j = 0; j < N; j++) out.push(j / N * Math.PI * 2 + Math.PI / 2);
    return out;
  })();

  const CORE_POINTS = (function () {
    const s = GEO.coreS, cx = GEO.cx, cy = GEO.cy, pts = [];
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + k * Math.PI / 3;
      pts.push((cx + Math.cos(a) * s).toFixed(1) + ',' + (cy + Math.sin(a) * s).toFixed(1));
    }
    return pts.join(' ');
  })();

  function escAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* =============================================================
   * 8 个技能室：每间 = 一张场景卡（道具拼装 + 房名 + 提示）
   * corner 决定它贴在场景的哪个角：lt/rt/lb/rb（left/right × top/bottom）
   * 旧版是 8 个纯文字方块横排，用户判为"十分呆板"——这里每间都有道具视觉。
   * ============================================================= */
  const ROOMS = [
    { id: 'verify', corner: 'lt', slot: 0, name: '查证室', tip: '神探 · 每夜查验 / 发布官方公告（4.7）',
      props: ['computer-wide', 'display-wall', 'table-display'] },
    { id: 'patrol', corner: 'lt', slot: 1, name: '巡逻岗', tip: '警长 · 全局 1 次巡逻保护（4.4.4）',
      props: ['door-double', 'rail', 'wall-switch'] },
    { id: 'medical', corner: 'lb', slot: 0, name: '医疗室', tip: '医生族 · 治疗 / 救援 / 自救（4.5/4.6）',
      props: ['bed-single', 'container', 'computer'] },
    { id: 'pharma', corner: 'lb', slot: 1, name: '制药室', tip: '医生族 / 疫苗研究员 · 制药攒额度（3.3.1/4.14）',
      props: ['container-tall', 'container-wide', 'table-inset'] },
    { id: 'repair', corner: 'rt', slot: 0, name: '维修室', tip: '工程师系 / 船员 · 维修与协助维修（4.3/4.1.2）',
      props: ['pipe', 'pipe-bend', 'structure-panel'] },
    { id: 'safe', corner: 'rt', slot: 1, name: '安全室', tip: '进入安全室 · 全额减免层（4.3.1）',
      props: ['door-single', 'wall-window', 'structure-barrier'] },
    { id: 'meeting', corner: 'rb', slot: 0, name: '议事厅', tip: '验票官 · 发动紧急会议（4.9.2）',
      props: ['table-large', 'chair', 'wall-banner'] },
    { id: 'armory', corner: 'rb', slot: 1, name: '军械库', tip: '警长 / 猎手 / 武装 · 枪械与嗅探（4.4.7）',
      props: ['container-flat', 'structure', 'wall-detail'] },
  ];

  /* 〔R3〕房间卡 = 一扇通往该房间的舱门：
     卡面直接用该房间的场景图（裁成横幅），下方房名。不再是"三件道具 + 文字"的方框。 */
  function roomCard(r) {
    return '<div class="sk-room sk-room-' + r.corner + ' sk-slot-' + r.slot
      + '" data-room="' + r.id + '" title="' + escAttr(r.tip) + '">'
      + '<div class="sk-room-art"><img class="sk-room-thumb" src="' + ROOM_ART + r.id + '.png" alt="" draggable="false" /></div>'
      + '<div class="sk-room-cap"><b>' + escAttr(r.name) + '</b></div>'
      + '</div>';
  }
  function roomsHtml() {
    return '<div class="sk-rooms" aria-label="飞船技能室">' + ROOMS.map(roomCard).join('') + '</div>';
  }

  /* ---- 单席 ---- */
  function seatSvg(p, i, st) {
    const r = GEO.seatR;
    const clip = 'sk-clip-' + i;
    const img = ASSET.replace('XX', String(i).padStart(2, '0'));
    const ring = st.mine ? MINE : PALETTE[i - 1];
    return '<g id="sk-seat-' + i + '" data-seat="' + i + '" class="sk-seat'
      + (st.mine ? ' sk-mine' : '') + (st.out ? ' sk-out' : '') + (st.closed ? ' sk-closed' : '') + '">'
      + '<defs><clipPath id="' + clip + '"><circle cx="0" cy="0" r="' + (r - 3) + '"/></clipPath></defs>'
      /* 席位底座：外圈光晕让角色从深色背景里浮起来 */
      + '<circle cx="0" cy="0" r="' + (r + 6) + '" class="sk-seat-halo" stroke="' + ring + '"/>'
      + '<circle cx="0" cy="0" r="' + r + '" fill="#0a0f18" stroke="' + ring + '" stroke-width="' + (st.mine ? 5 : 3.5) + '"/>'
      + '<image href="' + escAttr(img) + '" xlink:href="' + escAttr(img) + '" x="' + (3 - r) + '" y="' + (3 - r)
      + '" width="' + (2 * r - 6) + '" height="' + (2 * r - 6) + '" clip-path="url(#' + clip + ')" preserveAspectRatio="xMidYMid slice"/>'
      + (st.closed
        ? '<circle cx="0" cy="0" r="' + (r - 3) + '" class="sk-lids"/>'
          + '<text x="0" y="6" text-anchor="middle" class="sk-lids-t">‿‿</text>'
        : '')
      + (st.out ? '<text x="' + (r - 8) + '" y="' + (4 - r) + '" text-anchor="middle" class="sk-out-x">✕</text>' : '')
      /* 编号徽章：定宽，压在席位下缘 */
      + '<circle cx="0" cy="' + (r - 6) + '" r="17" class="sk-num-bg" stroke="' + ring + '"/>'
      + '<text x="0" y="' + (r + 1) + '" text-anchor="middle" class="sk-num">' + i + '</text>'
      + '</g>';
  }

  function svgFor(g, V, myTurn) {
    const night = g.phase === 'night';
    /* preserveAspectRatio 固定用 xMidYMin meet：15 席必须完整可见。
       ⚠ 曾试过矮屏改 slice —— 实测直接裁掉顶部 5/6/7 号与底部 1 号席位，
       比"场景变小"严重得多。矮屏的正确解法是**压面板高度**（CSS 13vh），不是裁场景。
       这是 <svg> 属性，不是 CSS 属性（写进 CSS 会被忽略，踩过）。 */
    const par = 'xMidYMin meet';
    let seats = '';
    for (let i = 1; i <= N; i++) {
      const p = V.players[i - 1];
      if (!p || p.id !== i) return '';
      const out = !!p.out;
      const mine = p.id === V.humanId;
      const closed = night && !out && !(mine && myTurn);
      seats += seatSvg(p, i, { out, mine, closed });
    }
    /* 桌面摆件（Kenney CC0 原尺寸 64px，不放大）：让桌子不是一块空板。
       这些是纯装饰，不承载任何游戏信息，也不可点击。 */
    /* 〔R4〕桌面笔记本：点开是我的账本（不再是 DEV 里的方框表格） */
    const notebook = '<g id="sk-notebook" class="sk-notebook" transform="translate(' + (GEO.cx + 96) + ',' + (GEO.cy + 58) + ')">'
      + '<rect x="-34" y="-22" width="68" height="44" rx="4" fill="#2b2116" stroke="#6b563a" stroke-width="2"/>'
      + '<rect x="-30" y="-18" width="60" height="36" rx="3" fill="#e8dcc0"/>'
      + '<line x1="-22" y1="-8" x2="22" y2="-8" stroke="#b9a882" stroke-width="1.5"/>'
      + '<line x1="-22" y1="0" x2="22" y2="0" stroke="#b9a882" stroke-width="1.5"/>'
      + '<line x1="-22" y1="8" x2="10" y2="8" stroke="#b9a882" stroke-width="1.5"/>'
      + '<text x="0" y="-30" text-anchor="middle" class="sk-notebook-t">账本</text>'
      + '</g>';
    const deck = [
      ['table-display', GEO.cx - 210, GEO.cy - 42],
      ['computer-wide', GEO.cx - 92, GEO.cy - 64],
      ['table-display-small', GEO.cx + 30, GEO.cy - 56],
      ['container-flat', GEO.cx + 132, GEO.cy - 34],
      ['chair', GEO.cx - 150, GEO.cy + 34],
      ['chair', GEO.cx + 96, GEO.cy + 40],
    ].map(([p, x, y]) =>
      '<image class="sk-deck" href="' + PROP + p + '.png" x="' + x.toFixed(0) + '" y="' + y.toFixed(0)
      + '" width="64" height="64" opacity=".9"/>').join('');
    return '<svg class="sk-scene" viewBox="0 0 ' + VB.w + ' ' + VB.h + '" preserveAspectRatio="' + par + '" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" role="img" aria-label="飞船圆桌场景（15 席）">'
      + '<ellipse class="sk-table-shadow" cx="' + GEO.cx + '" cy="' + (GEO.cy + 12) + '" rx="' + GEO.tableRx + '" ry="' + GEO.tableRy + '"/>'
      + '<ellipse class="sk-table" cx="' + GEO.cx + '" cy="' + GEO.cy + '" rx="' + GEO.tableRx + '" ry="' + GEO.tableRy + '"/>'
      + '<ellipse class="sk-table-inner" cx="' + GEO.cx + '" cy="' + GEO.cy + '" rx="' + (GEO.tableRx - 22) + '" ry="' + (GEO.tableRy - 14) + '"/>'
      + '<ellipse class="sk-table-rim" cx="' + GEO.cx + '" cy="' + GEO.cy + '" rx="' + GEO.tableRx + '" ry="' + GEO.tableRy + '"/>'
      + deck
      + notebook
      + '<polygon class="sk-core' + (night ? ' sk-core-night' : '') + '" points="' + CORE_POINTS + '"/>'
      + '<text x="' + GEO.cx + '" y="' + (GEO.cy + 5) + '" text-anchor="middle" class="sk-core-t">船核心</text>'
      + seats
      + '</svg>';
  }

  /* ---- 席位坐标（seated / scattered）---- */
  function pairGroups(g) {
    const groups = [];
    const seen = {};
    for (const c of (g.nightChats || [])) {
      if (seen[c.a] || seen[c.b]) continue;
      seen[c.a] = seen[c.b] = true;
      groups.push([c.a, c.b]);
    }
    const loners = [];
    for (let i = 1; i <= N; i++) if (!seen[i]) loners.push(i);
    return { groups, loners };
  }
  function seatPos(g, i, mode) {
    if (mode !== 'scattered') {
      const a = ANG[i - 1];
      const out = g && g.players[i - 1] && g.players[i - 1].out;
      return {
        x: GEO.cx + Math.cos(a) * (out ? GEO.outRx : GEO.rx),
        y: GEO.cy + Math.sin(a) * (out ? GEO.outRy : GEO.ry),
      };
    }
    const { groups, loners } = pairGroups(g);
    const unit = groups.concat(loners.map(x => [x]));
    const gi = unit.findIndex(grp => grp.indexOf(i) >= 0);
    const ga = gi / unit.length * Math.PI * 2 - Math.PI / 2;
    const gx = GEO.cx + Math.cos(ga) * GEO.rx * 0.86;
    const gy = GEO.cy + Math.sin(ga) * GEO.ry * 0.82;
    const grp = unit[gi], k = grp.indexOf(i), n = grp.length;
    const off = (k - (n - 1) / 2) * (GEO.seatR * 2 + 10);
    return { x: gx + Math.cos(ga + Math.PI / 2) * off, y: gy + Math.sin(ga + Math.PI / 2) * off * 0.4 };
  }

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
      if (!svg.classList.contains('sk-anim')) {
        void svg.getBoundingClientRect();
        svg.classList.add('sk-anim');
      }
    } catch (_) { /* 桩环境静默 */ }
  }

  let sig = null;
  function render(g, V) {
    if (!g || !V || !V.players || V.players.length !== N) return;
    const doc = global.document;
    const mount = doc && doc.getElementById ? doc.getElementById('scene-mount') : null;
    if (!mount) return;
    const myTurn = !!(g.pending && !g.pending.stream);
    const kind = myTurn ? (g.pending.kind || '') : '';
    const key = [V.humanId, g.phase === 'night' ? 1 : 0, myTurn ? 1 : 0,
      V.players.map(p => (p.out ? 1 : 0)).join('')].join('|');
    if (key !== sig || !mount.__skBuilt) {
      const svg = svgFor(g, V, myTurn);
      if (!svg) return;
      /* 气泡容器由 popBubble 按需注入到 <svg> 内部（见其注释） */
      mount.innerHTML = roomsHtml() + svg
        + '<div id="sk-room-stage" class="sk-room-stage" aria-label="房间"></div>';
      mount.__skBuilt = true;
      bindEvents(mount);
      lastMode = '';
      sig = key;
    }
    updateLayout(g, V, mount);
    updateBubbles(g, V, mount);
    updateInteractive(g, V, myTurn, kind, mount);
    lastG = g; lastV = V; lastMount = mount;
  }

  /* =============================================================
   * 气泡：唯一的发言载体（旧版的"发言流水列表"已删除）
   *   · 公开发言（讨论/会议）：talks 尾条 → 作者席位头顶冒泡
   *   · 0c 私聊：只冒己方配对组（2.2）；队内频道零气泡（3.3④）
   * 气泡走 foreignObject，尺寸随内容，8s 淡出。
   * ============================================================= */
  let lastTalkKey = '';
  let lastPmKey = '';
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const BUB = { w: 340, h: 120 };

  function popBubble(g, V, mount, pt, label, text, isMe) {
    try {
      /* ⚠ 气泡容器必须是 <svg> 内的 <g>（与席位同坐标系），不能是 mount 下的 HTML div：
         div 按 CSS 像素定位，而 foreignObject 用 viewBox 坐标（1600×900）⇒ 气泡画到页面外。
         实测症状：DOM 里节点在、截图上什么都没有。 */
      const svg = mount.querySelector('.sk-scene');
      if (!svg) return;
      let box = svg.querySelector('#sk-bubbles');
      if (!box) {
        box = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        box.setAttribute('id', 'sk-bubbles');
        box.setAttribute('class', 'sk-bubbles');
        svg.appendChild(box);
      }
      while (box.childNodes.length >= 5) box.removeChild(box.firstChild);
      const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
      fo.setAttribute('x', Math.max(6, Math.min(VB.w - BUB.w - 6, pt.x - BUB.w / 2)).toFixed(1));
      fo.setAttribute('y', Math.max(4, pt.y - BUB.h - 10).toFixed(1));
      fo.setAttribute('width', BUB.w);
      fo.setAttribute('height', BUB.h);
      fo.setAttribute('class', 'sk-fo');
      fo.innerHTML = '<div xmlns="http://www.w3.org/1999/xhtml" class="sk-bubble' + (isMe ? ' sk-me' : '') + '">'
        + (label ? '<span class="who">' + escHtml(label) + '</span>' : '') + escHtml(text)
        + '</div>';
      box.appendChild(fo);
      setTimeout(() => { try { fo.remove(); } catch (_) {} }, 14000);
    } catch (_) { /* 桩环境静默 */ }
  }

  function updateBubbles(g, V, mount) {
    try {
      const talks = g.talks || [];
      const tk = g.night + ':' + talks.length;
      if (tk !== lastTalkKey) {
        lastTalkKey = tk;
        if (talks.length) {
          const t = talks[talks.length - 1];
          if (t && t.text) {
            const p = seatPos(g, t.id, g.step === '0c' ? 'scattered' : 'seated');
            popBubble(g, V, mount, { x: p.x, y: p.y - GEO.seatR - 6 },
              t.id + ' 号' + (t.id === V.humanId ? '（我）' : ''), t.text, t.id === V.humanId);
          }
        }
      }
      if ((g.nightChats || []).length) {
        let tail = null, myGroup = null;
        for (const c of g.nightChats) {
          if (c.a !== V.humanId && c.b !== V.humanId) continue;
          myGroup = [c.a, c.b];
          const ls = c.lines || [];
          if (ls.length) tail = ls[ls.length - 1];
        }
        const pk = g.night + '|' + (myGroup ? myGroup.join('-') : '') + '|' + (tail != null ? tail : '');
        if (pk !== lastPmKey && tail != null && myGroup) {
          lastPmKey = pk;
          const mode = g.step === '0c' ? 'scattered' : 'seated';
          const p1 = seatPos(g, myGroup[0], mode);
          const p2 = seatPos(g, myGroup[1], mode);
          const mid = { x: (p1.x + p2.x) / 2, y: Math.min(p1.y, p2.y) - GEO.seatR - 8 };
          popBubble(g, V, mount, mid, '私聊', tail, false);
        }
      } else if (lastPmKey) {
        lastPmKey = '';
      }
    } catch (_) { /* 桩环境静默 */ }
  }

  /* ---- 交互：点击 100% 委托既有控件（引擎零改动）---- */
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
      toastTimer = setTimeout(() => { t.classList.remove('show'); }, 2000);
    } catch (_) { /* 桩环境静默 */ }
  }

  function flashForm() {
    try {
      const body = document.getElementById('stage-body');
      if (!body) return;
      body.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      body.classList.remove('sk-flash');
      void body.offsetWidth;
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
        if (t.closest('#sk-notebook')) { if (global.UI && global.UI.openLedger) global.UI.openLedger(); return; }
      } catch (_) { /* 交互层异常不外抛 */ }
    });
  }

  /* =============================================================
   * 〔R3〕点角色头像 = 直接发起指向该角色的行动
   * -------------------------------------------------------------
   * 判据与分流（全部基于既有表单结构，不新增协议）：
   *   ① 目标集合里含该席位（#f-targets / #f-pool 有对应 input）→ 勾选它；
   *   ② 若该行动「只需选一个目标」且没有额外参数（无 num / num2 / text 输入），
   *      勾选后**自动提交** —— 投票、击杀、感染、查验这类选人即完成的行动；
   *   ③ 若还需补参数（破坏量、乔装身份、维修对象数等）→ 只勾选，并提示去房间补完；
   *   ④ 不在目标集合里 → 打开玩家详情弹窗（查看/讯问），而不是报错。
   * 这样"点头像"在投票时是投票、在出刀时是出刀、在平时是看人，一套手势覆盖三类意图。
   * ============================================================= */
  /* 需要补参数的行动（勾选目标后不能立即提交）：num=数量、text=正文、opts=选项组 */
  const NEEDS_MORE = ['branch', 'disguise', 'craft', 'doctor', 'repair', 'crewRepair',
    'crewAction', 'morph', 'transfer', 'evolve', 'convert', 'awaken', 'suppress',
    'talk', 'chat', 'will', 'speech', 'xenoCheck', 'clean', 'meeting', 'inviteAccept'];

  function onSeatClick(pid, mount) {
    const g = global.Game && global.Game.g;
    if (!g) return;
    if (!(g.pending && !g.pending.stream)) {
      /* 非决策态：点头像 = 看人（详情弹窗，内含自动讯问） */
      if (global.UI && global.UI.openPlayerPop) global.UI.openPlayerPop(pid);
      return;
    }
    const f = g.pending;
    const body = document.getElementById('stage-body');
    const inp = body && body.querySelector('#f-targets input[value="' + pid + '"]:not([disabled])');
    const inpPool = body && body.querySelector('#f-pool input[value="' + pid + '"]:not([disabled])');
    const pick = inp || inpPool;
    if (!pick) {
      /* 不在本次目标集合里：说明为什么，并给"看人"的出口 */
      toast(mount, '本次行动不能指向 ' + pid + ' 号 · 点头像可查看他的公开信息');
      if (global.UI && global.UI.openPlayerPop) global.UI.openPlayerPop(pid);
      return;
    }
    pick.click();
    refresh();

    /* 判定能否「点一下即完成」：单选目标 + 无附加参数 */
    const max = (f.targets && f.targets.max) || 1;
    const needsMore = NEEDS_MORE.indexOf(f.kind) >= 0 || f.num || f.num2 || f.text;
    if (max === 1 && !needsMore) {
      const btn = document.getElementById('btn-submit');
      if (btn && !btn.disabled) {
        /* 让玩家看到"已选中该席位"再提交（一帧），避免瞬间跳转像误触 */
        setTimeout(() => {
          try { btn.click(); } catch (_) {}
        }, 160);
        toast(mount, '已对 ' + pid + ' 号发动：' + (f.title || f.kind));
        return;
      }
    }
    toast(mount, '已选中 ' + pid + ' 号' + (needsMore ? ' · 在房间里补完剩余选项再提交' : ''));
  }

  /* =============================================================
   * 〔R3〕房间近景：点房间 → 场景放大到该房间，整笔行动在房间里完成
   * -------------------------------------------------------------
   * 实现要点（不改引擎协议）：
   *   · 进入时把 #region-dec（内含 renderForm 渲染的表单）**搬进** #sk-room-stage；
   *     退出时搬回原处。DOM 搬移不重建节点 ⇒ 控件状态、onchange 绑定、formState 全部保留。
   *   · 提交仍走表单自带的「提交」按钮（Game.submit），房间层不新增任何提交路径。
   *   · 只有「待决策 kind 与该房间匹配」才允许进入；否则给明确说明（避免空房间）。
   *   · 退出：ESC / 点房间外空白 / 点「离开房间」按钮。
   * ============================================================= */
  let roomOpen = null;

  function roomMatches(roomId) {
    const g = global.Game && global.Game.g;
    const kind = g && g.pending && !g.pending.stream ? (g.pending.kind || '') : '';
    return !!(kind && ROOM_KINDS[roomId] && ROOM_KINDS[roomId].indexOf(kind) >= 0);
  }

  function openRoom(roomId, mount) {
    const room = ROOMS.find(r => r.id === roomId);
    if (!room) return;
    if (!roomMatches(roomId)) {
      /* 不匹配时给出「这里现在没有你要办的事」的具体说明，而不是空白房间 */
      toast(mount, room.name + '：现在没有待办的相关行动');
      return;
    }
    if (roomOpen) closeRoom(mount);
    const stage = mount.querySelector('#sk-room-stage');
    const dec = document.getElementById('region-dec');
    if (!stage || !dec) return;

    stage.innerHTML =
      '<div class="sk-rs-bg" style="background-image:url(' + ROOM_ART + roomId + '.png)"></div>'
      + '<div class="sk-rs-head"><b>' + escAttr(room.name) + '</b>'
      + '<button class="sk-rs-close" data-room-close="1">离开房间</button></div>'
      + '<div class="sk-rs-body"></div>';
    const body = stage.querySelector('.sk-rs-body');
    /* 把行动面板整体搬进房间（DOM 搬移，不重建） */
    body.appendChild(dec);
    dec.classList.add('in-room');
    stage.classList.add('open');
    mount.classList.add('room-open');
    roomOpen = roomId;
    bindRoomEvents(stage, mount);
    refresh();
  }

  function closeRoom(mount) {
    const stage = mount.querySelector('#sk-room-stage');
    const dec = document.getElementById('region-dec');
    const dock = document.querySelector('#screen-game .ops-dock');
    /* 搬回底部操作区（原位置：ops-dock 的第一个子节点） */
    if (dec && dock) {
      dec.classList.remove('in-room');
      dock.insertBefore(dec, dock.firstChild);
    }
    if (stage) {
      stage.classList.remove('open');
      stage.innerHTML = '';
    }
    mount.classList.remove('room-open');
    roomOpen = null;
  }

  function bindRoomEvents(stage, mount) {
    if (stage.__bound) return;
    stage.__bound = true;
    stage.addEventListener('click', e => {
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('[data-room-close]')) { closeRoom(mount); return; }
      /* 点房间背景（不在表单内）= 离开 */
      if (t.classList && (t.classList.contains('sk-rs-bg') || t.classList.contains('sk-rs-body'))) {
        closeRoom(mount);
      }
    });
  }

  function onRoomClick(roomId, mount) {
    openRoom(roomId, mount);
  }

  function onCoreClick(mount) {
    const g = global.Game && global.Game.g;
    const kind = g && g.pending && !g.pending.stream ? (g.pending.kind || '') : '';
    if (kind && CORE_KINDS.indexOf(kind) >= 0) {
      flashForm();
      toast(mount, '船核心 · 在行动面板完成对船行动');
    } else {
      toast(mount, '船核心：对船行动（破坏/逃亡）在对应夜晚窗口开放');
    }
  }

  let lastG = null, lastV = null, lastMount = null;
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

  /* ESC 退出房间近景（与规则速览同款手势） */
  try {
    global.addEventListener('keydown', e => {
      if (e && e.key === 'Escape' && roomOpen && lastMount) closeRoom(lastMount);
    });
  } catch (_) {}

  global.SKScene = { render, refresh, _ang: ANG, _palette: PALETTE, _geo: GEO,
    _openRoom: openRoom, _closeRoom: closeRoom, _roomOpen: () => roomOpen };
})(typeof window !== 'undefined' ? window : globalThis);
