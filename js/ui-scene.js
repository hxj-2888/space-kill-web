/* =============================================================
 * 返航录 · 房间场景渲染器（批 U1 · 重写）
 * -------------------------------------------------------------
 * 与旧版（备份在 backup/ui-scene-R2.js）的差别：
 *   ① **房间制**：一次只画一个房间，不再是"圆桌 + 8 张房间卡"的拼盘；
 *   ② **素材统一**：地板/墙/家具/角色全部来自 assets/scene/cozy/
 *      （同一作者 Bramble & Byte，同一调色板 16px 网格，CC-BY 必须署名）；
 *   ③ **数据驱动**：布局来自 js/space.js 的 SKSpace（道具坐标、门、座位），
 *      本文件只负责"把数据画成 DOM"；
 *   ④ **点击导航**：点房间里的门 → 切场景；点道具 → 委托既有表单控件。
 *
 * 不变量（红线，改这个文件时逐条守）：
 *   · 只读 g.phase / g.pending + V = View.viewFor 的裁剪视图，不读引擎内部；
 *   · **不新建提交路径**：点道具只 click 既有 #f-targets / #btn-submit，
 *     房间层里出现 Game.submit 即判红（门禁 主区O 守这条）；
 *   · 控件语义零变更：input 的 id/name/value/disabled 一律不碰。
 *
 * 坐标系：场景用 viewBox 1600×1000（与 R2 的 1600×900 兼容，多 100 给房间底部信息条）。
 *   房间本地坐标（格）× TILE(44) 平移到房间偏移。
 * ============================================================= */
(function (global) {
  'use strict';
  const N = 15;
  const TILE = 62;                      /* 一格在场景里的像素尺寸（22 格 × 62 ≈ 1364，占满画宽） */
  const ASSET = 'assets/scene/cozy/';
  const VB = { w: 1460, h: 980 };

  /* 席位 15 色（与 space.js 的座位顺序对齐；仅用于底座光环） */
  const PALETTE = ['#ff6b6b', '#ff922b', '#fcc419', '#c0eb75', '#69db7c', '#38d9a9', '#3bc9db',
    '#4dabf7', '#748ffc', '#9775fa', '#da77f2', '#e64980', '#f783ac', '#ffe066', '#94d82d'];
  const MINE = '#ffd43b';

  /* 角色行走图：4 列 × 5 行，单帧 96×160（4x） */
  const CREW_W = 96, CREW_H = 160;
  const CREW_FILES = ['crew-navy', 'crew-teal', 'crew-gray', 'crew-slate', 'crew-plum',
    'crew-bridge-white', 'crew-lab-coat', 'crew-commander-red'];
  /* 行序：0 下走 / 1 上走 / 2 待机 / 3 左走 / 4 右走 */
  const ROW_IDLE = 2;

  function escAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function el(id) { const d = global.document; return d && d.getElementById ? d.getElementById(id) : null; }
  function now() { return (global.performance && global.performance.now) ? global.performance.now() : Date.now(); }

  /* =============================================================
   * 房间几何：把 space.js 的格坐标换算成场景坐标
   * ============================================================= */
  const ROOM_ID_DEFAULT = 'bridge';
  let curRoom = ROOM_ID_DEFAULT;
  /* 〔U2〕入场行走：切换房间/阶段时，角色从门快步走到落点。
     用时间戳而不是 setTimeout —— 重绘是幂等的，重绘时按剩余时长决定是否还在走。 */
  const WALK_MS = 900;
  let walkUntil = 0;

  function roomOrigin(S) {
    const r = S.room(curRoom) || S.room(ROOM_ID_DEFAULT);
    const [w, h] = r.size;
    return { x: (VB.w - w * TILE) / 2, y: 74, w: w * TILE, h: h * TILE, r };
  }

  /* 房间背景：地板平铺 + 四壁 + 门 */
  function roomHtml(S) {
    const o = roomOrigin(S);
    const r = o.r;
    let html = '<g class="sk-room-floor">';
    /* 地板平铺（32px 素材，场景里放大到 TILE） */
    /* 瓦片 32px 是 2 格(16px 网格的 2x)，所以一个 pattern 单元 = 2 格 = TILE*2，
       里面铺 2×2 张 32px 素材；否则 32px 素材被拉到 62px 会变成"发虚的方块"。 */
    const PT = TILE;   /* 一张素材在场景里的边长 = 1 格 */
    html += '<defs><pattern id="sk-floor-pat" width="' + PT + '" height="' + PT
      + '" patternUnits="userSpaceOnUse">'
      + '<image href="' + ASSET + 'tiles/' + r.floor + '.png" width="' + PT + '" height="' + PT
      + '" image-rendering="pixelated"/></pattern></defs>';
    html += '<rect x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + o.h
      + '" fill="url(#sk-floor-pat)"/>';
    /* 暗色罩：地砖本身很亮，压一层让家具与角色浮出来（仍保留纹理） */
    html += '<rect x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + o.h
      + '" fill="#0a1524" opacity="0.34"/>';
    /* 房间外圈光：把场景从背景里"托"起来 */
    html += '<rect x="' + (o.x - 8) + '" y="' + (o.y - 8) + '" width="' + (o.w + 16)
      + '" height="' + (o.h + 16) + '" fill="none" stroke="#2a4a6e" stroke-width="3" rx="8"/>';

    /* 四壁：上壁两格高（制造高低差），左右下各一格 */
    const wt = TILE;
    const wall = (x, y, w, h) => '<rect x="' + x + '" y="' + y + '" width="' + w
      + '" height="' + h + '" fill="url(#sk-wall-pat)"/>';
    html += '<defs><pattern id="sk-wall-pat" width="' + TILE + '" height="' + (TILE * 2)
      + '" patternUnits="userSpaceOnUse"><image href="' + ASSET + 'tiles/wall.png" width="'
      + TILE + '" height="' + (TILE * 2) + '" image-rendering="pixelated"/></pattern></defs>';
    /* 墙：素材是 32×64（墙顶 1 格 + 墙面 1 格），所以上壁画 2 格高；
       左右壁 1 格宽；下壁只留一条暗色踢脚（否则会挡住房间底部的角色）。 */
    html += wall(o.x, o.y, o.w, TILE * 1.35);
    html += wall(o.x, o.y, TILE * 0.55, o.h);
    html += wall(o.x + o.w - TILE * 0.55, o.y, TILE * 0.55, o.h);
    html += '<rect x="' + o.x + '" y="' + (o.y + o.h - TILE * 0.28) + '" width="' + o.w
      + '" height="' + (TILE * 0.28) + '" fill="#0a1220" opacity="0.9"/>';

    /* 门：墙上的缺口 + 发光门垫（可点） */
    for (const d of r.doors) {
      const a = S.doorAnchor(curRoom, d);
      if (!a) continue;
      const px = o.x + a.x * TILE, py = o.y + a.y * TILE;
      const horiz = (d.side === 't' || d.side === 'b');
      const dw = horiz ? TILE * 2 : TILE * 0.7, dh = horiz ? TILE * 0.7 : TILE * 2;
      html += '<rect class="sk-door" data-door="' + escAttr(d.to) + '" x="' + (px - dw / 2)
        + '" y="' + (py - dh / 2) + '" width="' + dw + '" height="' + dh
        + '" fill="#0b1424" stroke="#4dabf7" stroke-width="2" rx="4"/>';
      html += '<text class="sk-door-t" x="' + px + '" y="' + (py + 5)
        + '" text-anchor="middle">' + escAttr((S.room(d.to) || {}).name || d.to) + '</text>';
    }

    /* 房名 */
    html += '<text class="sk-room-name" x="' + (o.x + 14) + '" y="' + (o.y + 34) + '">'
      + escAttr(r.name) + '</text>';
    html += '</g>';
    return html;
  }

  /* 家具层 */
  function propsHtml(S) {
    const o = roomOrigin(S);
    const r = o.r;
    let html = '<g class="sk-props">';
    for (const p of r.props) {
      const d = S.PROP[p.t];
      if (!d) continue;
      const w = (p.w || d.w) * TILE, h = (p.h || d.h) * TILE;
      const x = o.x + p.x * TILE, y = o.y + p.y * TILE;
      const cls = 'sk-prop' + (p.k ? ' sk-hit' : '') + (p.t === 'rug' ? ' sk-decal' : '');
      html += '<image class="' + cls + '" '
        + (p.k ? 'data-hit="' + escAttr(p.k) + '" data-label="' + escAttr(p.label || '') + '" ' : '')
        + 'href="' + ASSET + 'furniture/' + p.t + '.png" '
        + 'x="' + x + '" y="' + (y + h - (p.t === 'rug' ? h : 0)) + '" width="' + w
        + '" height="' + h + '" preserveAspectRatio="none" image-rendering="pixelated"/>';
      if (p.t === 'rug') {
        /* 地毯是纯色块，不用素材 */
        html = html.replace(/<image class="sk-prop sk-decal"[^>]*\/>/, '');
        html += '<rect class="sk-prop sk-decal" x="' + x + '" y="' + y + '" width="' + w
          + '" height="' + h + '" rx="6" fill="' + (p.tint === 'warn' ? '#8a6a2a' : '#16233a')
          + '" opacity="0.85"'
          + (p.k ? ' data-hit="' + escAttr(p.k) + '" data-label="' + escAttr(p.label || '') + '"' : '')
          + '/>';
      }
    }

    /* 15 席（舰桥）：座椅底座 + 编号 */
    const seats = S.seatPositions(curRoom);
    for (const s of seats) {
      const px = o.x + s.x * TILE, py = o.y + s.y * TILE;
      html += '<g class="sk-seat' + (s.i === 1 ? '' : '') + '" data-seatpos="' + s.i + '">'
        + '<ellipse cx="' + px + '" cy="' + py + '" rx="' + (TILE * 0.46) + '" ry="' + (TILE * 0.28)
        + '" fill="#0b1424" stroke="' + PALETTE[s.i - 1] + '" stroke-width="2"/>'
        + '<text x="' + px + '" y="' + (py + 6) + '" text-anchor="middle" class="sk-seat-n">'
        + s.i + '</text></g>';
    }

    /* 15 个睡眠舱（宿舍） */
    const pods = S.podPositions(curRoom);
    for (const p of pods) {
      const px = o.x + p.x * TILE, py = o.y + p.y * TILE;
      html += '<image class="sk-prop" href="' + ASSET + 'furniture/cryopod.png" x="' + px
        + '" y="' + py + '" width="' + TILE + '" height="' + (TILE * 2)
        + '" image-rendering="pixelated"/>'
        + '<text class="sk-pod-n" x="' + (px + TILE / 2) + '" y="' + (py + TILE * 2 + 12)
        + '" text-anchor="middle">' + p.i + '</text>';
    }
    html += '</g>';
    return html;
  }

  /* =============================================================
   * 席位：把 15 个玩家放到座位/睡眠舱/房间空位
   *   白天（讨论/投票）：全部入座舰桥
   *   夜间：玩家在各自编号的睡眠舱（宿舍）；「我」在自己舱位
   * 出局：灰度 + 半透明（公开信息）
   * ============================================================= */
  function crewHtml(g, V, S) {
    const o = roomOrigin(S);
    const players = (V && V.players) || [];
    const seats = S.seatPositions('bridge');
    const pods = S.podPositions('dorms');
    const walking = walkUntil > 0;
    let html = '<g class="sk-crew-layer' + (walking ? ' sk-walking' : '') + '">';

    /* 入场起点 = 房间的第一扇门（无门则从下缘外进） */
    const doors = (S.room(curRoom) || {}).doors || [];
    const da = doors.length ? S.doorAnchor(curRoom, doors[0]) : null;
    const baseX = da ? o.x + da.x * TILE : o.x + o.w / 2;
    const baseY = da ? o.y + da.y * TILE : o.y + o.h + TILE * 1.4;

    for (const p of players) {
      const isMe = p.id === V.humanId;
      const isDay = g.phase !== 'night';
      let px, py;
      if (curRoom === 'bridge' && isDay) {
        const s = seats[(p.id - 1) % seats.length];
        px = o.x + s.x * TILE; py = o.y + s.y * TILE;
      } else if (curRoom === 'dorms') {
        const q = pods[(p.id - 1) % pods.length];
        px = o.x + q.x * TILE + TILE / 2; py = o.y + q.y * TILE + TILE;
      } else {
        /* 其他房间：只画「我」，站在房间中央偏下 */
        if (!isMe) continue;
        px = o.x + o.w / 2; py = o.y + o.h - TILE * 1.6;
      }

      const w = TILE * 0.92, h = w * (CREW_H / CREW_W);
      const file = CREW_FILES[(p.id - 1) % CREW_FILES.length];
      const ring = isMe ? MINE : PALETTE[(p.id - 1) % PALETTE.length];

      /* 入场起点：沿门横向散开 + 纵向错开，避免 15 人叠在同一个门口点
         （实测：全部同起点时画面是一坨人）。每人再用 --delay 错峰出发。 */
      const spread = ((p.id - 1) % 5 - 2) * TILE * 0.85;
      const row = Math.floor((p.id - 1) / 5);
      const entryX = baseX + spread;
      const entryY = baseY + (da && da.y === 0 ? -row * TILE * 0.6 : TILE * 0.6 + row * TILE * 0.6);
      const dx = (entryX - px).toFixed(1), dy = (entryY - py).toFixed(1);
      const delay = ((p.id * 37) % 220);

      /* 行走图截帧：
           行走 = viewBox 框住「向下走」那一行的第 1 帧，CSS 在 4 帧列之间平移（1-2-3-2 循环）
           待机 = viewBox 框住「待机」行第 2 列 */
      const vb = walking
        ? ('0 0 ' + CREW_W + ' ' + CREW_H)
        : (CREW_W + ' ' + (CREW_H * ROW_IDLE) + ' ' + CREW_W + ' ' + CREW_H);

      html += '<g class="sk-crew' + (isMe ? ' sk-mine' : '') + (p.out ? ' sk-out' : '')
        + '" data-seat="' + p.id + '" transform="translate(' + px.toFixed(1) + ','
        + (py + TILE * 0.34).toFixed(1) + ')" style="--dx:' + dx + 'px;--dy:' + dy + 'px">'
        + '<g class="sk-enter">'
        + '<ellipse cx="0" cy="0" rx="' + (TILE * 0.42) + '" ry="' + (TILE * 0.17)
        + '" fill="' + ring + '" opacity="0.35"/>'
        + '<svg x="' + (-w / 2).toFixed(1) + '" y="' + (-h * 0.62).toFixed(1)
        + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1)
        + '" viewBox="' + vb + '" overflow="hidden" preserveAspectRatio="xMidYMax meet">'
        + '<g class="sk-frames">'
        + '<image href="' + ASSET + 'crew/' + file + '.png" x="0" y="0" width="'
        + (CREW_W * 4) + '" height="' + (CREW_H * 5) + '" image-rendering="pixelated"/>'
        + '</g></svg>'
        + '<text class="sk-crew-n" x="0" y="' + (TILE * 0.62).toFixed(1)
        + '" text-anchor="middle">' + p.id + '</text>'
        + '</g></g>';
    }
    html += '</g>';
    return html;
  }

  /* =============================================================
   * 渲染入口（接口与旧版一致：render(g, V)）
   * ============================================================= */
  let sig = null, lastG = null, lastV = null, lastMount = null, lastPhaseKey = null;

  function render(g, V) {
    if (!g || !V || !V.players) return;
    const S = global.SKSpace;
    if (!S) return;
    const mount = el('scene-mount');
    if (!mount) return;

    const key = [V.humanId, g.phase, curRoom,
      V.players.map(p => (p.out ? 1 : 0)).join(''),
      g.pending && !g.pending.stream ? (g.pending.kind || '') : ''].join('|');
    /* 阶段变化（昼↔夜）也触发一次入场行走 —— 这正是"回宿舍/去圆桌"的动作 */
    const phaseKey = g.phase + '|' + (g.pending && !g.pending.stream ? (g.pending.kind || '') : '');
    if (lastPhaseKey && lastPhaseKey !== phaseKey) walkUntil = now() + WALK_MS;
    lastPhaseKey = phaseKey;

    if (key !== sig || !mount.__skBuilt) {
      mount.innerHTML =
        '<svg class="sk-scene" viewBox="0 0 ' + VB.w + ' ' + VB.h + '" preserveAspectRatio="xMidYMid meet">'
        + roomHtml(S) + propsHtml(S) + crewHtml(g, V, S) + '</svg>'
        + '<div id="sk-room-stage" class="sk-room-stage" aria-label="房间"></div>';
      mount.__skBuilt = true;
      bind(mount);
      sig = key;
    }
    lastG = g; lastV = V; lastMount = mount;
    updateInteractive(g, V, mount);

    /* 还在行走 → 到时重绘一次，切回待机帧（避免角色永远在迈步） */
    if (walkUntil > now()) {
      if (walkTimer) clearTimeout(walkTimer);
      walkTimer = setTimeout(function () {
        walkUntil = 0; sig = null;
        if (lastG && lastV) render(lastG, lastV);
      }, walkUntil - now() + 20);
    }
  }
  let walkTimer = null;

  /* ---- 交互：点门切房间；点道具/席位委托既有控件 ---- */
  function bind(mount) {
    if (!mount.addEventListener || mount.__skBound) return;
    mount.__skBound = true;
    mount.addEventListener('click', function (e) {
      try {
        const t = e.target;
        if (!t || !t.closest) return;

        const door = t.closest('[data-door]');
        if (door) { goto(door.getAttribute('data-door')); return; }

        const seat = t.closest('[data-seat]');
        if (seat) { onSeatClick(+seat.getAttribute('data-seat'), mount); return; }

        const hit = t.closest('[data-hit]');
        if (hit) { onPropClick(hit.getAttribute('data-hit'), hit.getAttribute('data-label'), mount); return; }

        /* 〔U1〕旧笔记本道具已随场景退役；账本入口改由 HUD / 席位弹窗承担，
           这里保留 openLedger 的委托点，供将来在房间内加「日志终端」时接回。 */
        if (t.closest('[data-hit="ledger"]')) { if (global.UI && global.UI.openLedger) global.UI.openLedger(); }
      } catch (_) { /* 交互层异常不外抛 */ }
    });
  }

  /* 切房间：只改 curRoom 并重绘（不触发任何规则） */
  function goto(roomId) {
    const S = global.SKSpace;
    if (!S || !S.room(roomId) || roomId === curRoom) return;
    curRoom = roomId;
    walkUntil = now() + WALK_MS;
    sig = null;
    if (lastG && lastV) render(lastG, lastV);
    else { const m = el('scene-mount'); if (m) m.__skBuilt = false; }
  }

  /* 需要补参数的行动（勾选目标后不能立即提交），沿用旧版判定 */
  const NEEDS_MORE = ['branch', 'disguise', 'craft', 'doctor', 'repair', 'crewRepair',
    'crewAction', 'morph', 'transfer', 'evolve', 'convert', 'awaken', 'suppress',
    'talk', 'chat', 'will', 'speech', 'xenoCheck', 'clean', 'meeting', 'inviteAccept'];

  /* 〔U2〕点道具 = 开始一次交互。
     白框（sk-focus）落在道具矩形上 —— 这是"交互已开始"的视觉锚点，
     而不是弹一个居中的方框对话框（用户明确排斥那种"雷霆方框"）。
     之后仍委托既有控件：能选就选，不能选就说明为什么。 */
  function onPropClick(key, label, mount) {
    const g = global.Game && global.Game.g;
    if (!g) return;
    /* ① 白框落在被点的道具上 */
    focusProp(key, label, mount);

    /* ② 委托既有控件：找同名 input（#f-targets / #f-pool / 选项组） */
    const body = el('stage-body');
    const inp = body && body.querySelector('input[value="' + key + '"]');
    if (inp && !inp.disabled) {
      inp.click();
      toast(mount, '开始行动：' + (label || key));
      return;
    }
    /* ③ 没有对应控件：说明当前能不能用，不假装成功 */
    const myTurn = !!(g.pending && !g.pending.stream);
    toast(mount, (label || key) + (myTurn ? '：本次行动用不到它' : '：现在不是决策时间'));
  }

  /* 白框：用一个独立 <rect> 叠在道具上，带呼吸动画；再次点击别处则清除 */
  let focusTimer = null;
  function focusProp(key, label, mount) {
    try {
      const svg = mount.querySelector('svg.sk-scene');
      if (!svg) return;
      let box = svg.querySelector('#sk-focus');
      if (!box) {
        box = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        box.setAttribute('id', 'sk-focus');
        box.setAttribute('style', 'pointer-events:none');
        svg.appendChild(box);   /* 追加到最后 = 压在所有图层之上 */
      }
      box.innerHTML = '';
      const hit = svg.querySelector('[data-hit="' + key + '"]');
      if (hit) {
        const r = hit.getBBox();
        const pad = 9;
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', r.x - pad); rect.setAttribute('y', r.y - pad);
        rect.setAttribute('width', r.width + pad * 2); rect.setAttribute('height', r.height + pad * 2);
        rect.setAttribute('rx', 6);
        rect.setAttribute('class', 'sk-focus-box');
        box.appendChild(rect);
        /* 标签：贴着白框上方，不是方框对话框 */
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', r.x + r.width / 2);
        t.setAttribute('y', r.y - pad - 10);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('class', 'sk-focus-t');
        t.textContent = label || key;
        box.appendChild(t);
      }
      if (focusTimer) clearTimeout(focusTimer);
      focusTimer = setTimeout(function () { box.innerHTML = ''; }, 2600);
    } catch (_) {}
  }

  function onSeatClick(pid, mount) {
    const g = global.Game && global.Game.g;
    if (!g) return;
    if (!(g.pending && !g.pending.stream)) {
      if (global.UI && global.UI.openPlayerPop) global.UI.openPlayerPop(pid);
      return;
    }
    const f = g.pending;
    const body = el('stage-body');
    const inp = body && body.querySelector('#f-targets input[value="' + pid + '"]:not([disabled])');
    const inpPool = body && body.querySelector('#f-pool input[value="' + pid + '"]:not([disabled])');
    const pick = inp || inpPool;
    if (!pick) {
      toast(mount, '本次行动不能指向 ' + pid + ' 号');
      if (global.UI && global.UI.openPlayerPop) global.UI.openPlayerPop(pid);
      return;
    }
    pick.click();
    refresh();
    const max = (f.targets && f.targets.max) || 1;
    const needsMore = NEEDS_MORE.indexOf(f.kind) >= 0 || f.num || f.num2 || f.text;
    if (max === 1 && !needsMore) {
      const btn = el('btn-submit');
      if (btn && !btn.disabled) {
        setTimeout(function () { try { btn.click(); } catch (_) {} }, 160);
        toast(mount, '已对 ' + pid + ' 号发动：' + (f.title || f.kind));
        return;
      }
    }
    toast(mount, '已选中 ' + pid + ' 号' + (needsMore ? ' · 在房间里补完剩余选项再提交' : ''));
  }

  let toastTimer = null;
  /* 〔U2〕提示条贴在场景顶部（不是屏幕中央）—— 白框在道具上，中央留给它 */
  function toast(mount, msg) {
    try {
      let t = mount.querySelector('.sk-toast');
      if (!t) { mount.insertAdjacentHTML('beforeend', '<div class="sk-toast"></div>'); t = mount.querySelector('.sk-toast'); }
      t.textContent = msg;
      t.classList.add('show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2000);
    } catch (_) {}
  }

  /* 高亮：轮到我时，把匹配当前行动的房间门点亮 */
  const ROOM_KINDS = {
    verify: ['detective'], patrol: ['patrol'], medical: ['doctor'],
    pharma: ['doctor'], repair: ['crewAction', 'crewRepair', 'repair'],
    safe: ['safeRoom'], meeting: ['meeting'], armory: ['shoot'],
  };
  function kindRoom(kind) {
    for (const r in ROOM_KINDS) if (ROOM_KINDS[r].indexOf(kind) >= 0) return r;
    return null;
  }
  function updateInteractive(g, V, mount) {
    try {
      const myTurn = !!(g.pending && !g.pending.stream);
      const lit = myTurn ? kindRoom(g.pending.kind || '') : null;
      const doors = mount.querySelectorAll('[data-door]');
      for (const d of doors) d.classList.toggle('sk-lit', !!lit && d.getAttribute('data-door') === lit);
      let sel = [];
      const body = el('stage-body');
      if (body && myTurn) sel = [].map.call(body.querySelectorAll('#f-targets input:checked, #f-pool input:checked'), function (x) { return +x.value; });
      const crews = mount.querySelectorAll('[data-seat]');
      for (const c of crews) c.classList.toggle('sk-sel', sel.indexOf(+c.getAttribute('data-seat')) >= 0);
    } catch (_) {}
  }

  function refresh() {
    if (lastG && lastV) updateInteractive(lastG, lastV, lastMount);
  }

  /* ESC：退出到舰桥（与规则速览同款手势） */
  try {
    global.addEventListener('keydown', function (e) {
      if (e && e.key === 'Escape' && curRoom !== 'bridge') goto('bridge');
    });
  } catch (_) {}

  /* =============================================================
   * 〔H1〕主页场景：俯视圆桌 + 15 席（与游戏内同一套绘制代码）
   * -------------------------------------------------------------
   * 用户拍板「主页就是游戏预览页」「俯视圆桌」。
   * 复用 roomOrigin / propsHtml 的数据来源（js/space.js），但**不读 g/V**：
   *   主页阶段没有对局状态，只有 15 个空席位 + 我这席的名字牌。
   * 输出：一个 <svg>，其中「我这席」带 data-home-seat="me"，供名字牌定位。
   * ============================================================= */
  function renderHomeScene(host, opt) {
    const S = global.SKSpace;
    if (!host || !S) return;
    const o = global.document;
    const r = S.room('bridge');
    if (!r) return;
    const [w, h] = r.size;
    const W2 = w * TILE, H2 = h * TILE;
    const OX = 0, OY = 0;
    const myId = 3;                      /* 主页固定展示「我这席」坐在 3 号位 */
    const myName = (opt && opt.myName) || '玄武岩';

    let html = '<svg class="sk-scene sk-home" viewBox="0 0 ' + (W2 + 40) + ' ' + (H2 + 40)
      + '" preserveAspectRatio="xMidYMid meet">';
    /* 底板 */
    html += '<rect x="0" y="0" width="' + (W2 + 40) + '" height="' + (H2 + 40)
      + '" fill="none"/>';
    html += '<g transform="translate(20,20)">';

    /* 地板：与游戏内同一张 pattern */
    html += '<defs><pattern id="sk-home-floor" width="' + TILE + '" height="' + TILE
      + '" patternUnits="userSpaceOnUse"><image href="' + ASSET + 'tiles/' + r.floor
      + '.png" width="' + TILE + '" height="' + TILE + '" image-rendering="pixelated"/></pattern></defs>';
    html += '<rect x="0" y="0" width="' + W2 + '" height="' + H2
      + '" fill="url(#sk-home-floor)" rx="10"/>';
    html += '<rect x="0" y="0" width="' + W2 + '" height="' + H2
      + '" fill="#0a1524" opacity="0.42" rx="10"/>';

    /* 四壁（同游戏内：上壁两格高） */
    html += '<defs><pattern id="sk-home-wall" width="' + TILE + '" height="' + (TILE * 2)
      + '" patternUnits="userSpaceOnUse"><image href="' + ASSET + 'tiles/wall.png" width="'
      + TILE + '" height="' + (TILE * 2) + '" image-rendering="pixelated"/></pattern></defs>';
    html += '<rect x="0" y="0" width="' + W2 + '" height="' + (TILE * 1.35) + '" fill="url(#sk-home-wall)"/>';
    html += '<rect x="0" y="0" width="' + (TILE * 0.55) + '" height="' + H2 + '" fill="url(#sk-home-wall)"/>';
    html += '<rect x="' + (W2 - TILE * 0.55) + '" y="0" width="' + (TILE * 0.55) + '" height="' + H2 + '" fill="url(#sk-home-wall)"/>';
    html += '<rect x="0" y="' + (H2 - TILE * 0.28) + '" width="' + W2 + '" height="' + (TILE * 0.28) + '" fill="#0a1220" opacity="0.9"/>';

    /* 家具（复用 space.js 的桥房道具表，跳过地毯与座位） */
    for (const p of r.props) {
      const d = S.PROP[p.t];
      if (!d) continue;
      const pw = (p.w || d.w) * TILE, ph = (p.h || d.h) * TILE;
      const px = p.x * TILE, py = p.y * TILE;
      if (p.t === 'rug') {
        /* 地毯只画**细边框轮廓**：整块实心会把桌子与座位全盖住（批 H1 实测） */
        html += '<rect x="' + px + '" y="' + py + '" width="' + pw + '" height="' + ph
          + '" rx="18" fill="none" stroke="#2f5178" stroke-width="2" opacity="0.55" stroke-dasharray="10 8"/>';
        continue;
      }
      html += '<image href="' + ASSET + 'furniture/' + p.t + '.png" x="' + px + '" y="' + py
        + '" width="' + pw + '" height="' + ph + '" preserveAspectRatio="none" image-rendering="pixelated"/>';
    }

    /* 15 席 */
    const seats = S.seatPositions('bridge');
    for (const s of seats) {
      const cx = s.x * TILE, cy = s.y * TILE;
      const isMe = s.i === myId;
      const col = PALETTE[(s.i - 1) % PALETTE.length];
      html += '<g data-home-seat="' + (isMe ? 'me' : 'seat-' + s.i) + '">';
      html += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + (TILE * 0.34) + '" ry="'
        + (TILE * 0.20) + '" fill="#0b1424" stroke="' + (isMe ? MINE : col)
        + '" stroke-width="' + (isMe ? 2.5 : 1.6) + '"/>';
      if (isMe) {
        /* 我这席：画一个小人站在座前（用 crew 素材的待机帧）。其余 14 席留空椅 ——
           主页是"预览"，不是"已经坐满了"。 */
        const w2 = TILE * 1.15, h2 = w2 * (CREW_H / CREW_W);
        /* 注意（批 H1 实测）：嵌套 <svg> 的裁剪不可靠，整张 4×5 行走图可能被完整画出来
           （批 H1 实测：不裁剪时画面上是"一堆红小人"）。 */
        html += '<svg x="' + (cx - w2 / 2) + '" y="' + (cy - h2 * 0.62) + '" width="' + w2
          + '" height="' + h2 + '" viewBox="' + CREW_W + ' ' + (CREW_H * ROW_IDLE) + ' ' + CREW_W + ' ' + CREW_H
          + '" overflow="hidden" preserveAspectRatio="xMidYMax meet"><image href="' + ASSET + 'crew/crew-commander-red.png"'
          + ' x="0" y="0" width="' + (CREW_W * 4) + '" height="' + (CREW_H * 5) + '" image-rendering="pixelated"/></svg>';
      }
      /* 编号放到椅面下方一点：与椅面椭圆同心会糊成一团（实测像"一堆小人"） */
      html += '<text x="' + cx + '" y="' + (cy + TILE * 0.40) + '" text-anchor="middle" class="sk-seat-n">'
        + s.i + '</text></g>';
    }

    /* 中央船核心：全息环（与游戏内同一套观感） */
    const hx = w / 2 * TILE, hy = h / 2 * TILE;
    html += '<circle cx="' + hx + '" cy="' + hy + '" r="' + (TILE * 0.9)
      + '" fill="#0a3350" opacity="0.9"/>';
    html += '<circle cx="' + hx + '" cy="' + hy + '" r="' + (TILE * 0.9)
      + '" fill="none" stroke="#4dd0e1" stroke-width="2" opacity="0.85"/>';
    html += '<circle class="sk-home-core" cx="' + hx + '" cy="' + hy + '" r="' + (TILE * 0.42)
      + '" fill="#2fd8e8" opacity="0.2"/>';

    html += '</g></svg>';

    host.innerHTML = html;
    /* 点击任意席位 → 打开「我这席」面板（可改身份+名字） */
    host.onclick = function (e) {
      const t = e.target;
      if (t && t.closest && t.closest('[data-home-seat]') && opt && opt.onSeatClick) opt.onSeatClick();
    };
  }

  global.SKScene = {
    render: render,
    renderHomeScene: renderHomeScene,
    refresh: refresh,
    goto: goto,
    currentRoom: function () { return curRoom; },
    _tile: TILE, _vb: VB, _palette: PALETTE,
  };
})(typeof window !== 'undefined' ? window : globalThis);