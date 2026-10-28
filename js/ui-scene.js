/* =============================================================
 * 新返航录 · 房间场景渲染器（批 U1 · 重写）
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
  /* 〔批 SHIP · 2026-10-27〕一格 56；画布 = **相机视窗**，不是房间。
     -------------------------------------------------------------
     整船图之后，屏幕里显示的是「船的一小部分」（用户原话：「相当于一个视野范围
     会覆盖一小部分，玩家会看到近景」）。所以 viewBox 不再等于房间尺寸，
     而是 = 相机视窗（格）× TILE。

     相机视窗的**大小**（几格）决定了"近景有多近"：
       30 × 12 —— 正好一间房（房间是 30×11，多出的 1 格给上下墙沿）。
       在房间里时相机夹进房间 ⇒ 一间房铺满屏幕；走通道时视窗跟着人。

     【为什么是 30×12 而不是 30×11】
       画布宽高比 = 30/12 = 2.5，而主区（1600×900 下）约 1568×581 = 2.70。
       SVG 用 meet 等比缩放 ⇒ 画布比主区"更方"时，宽度吃满、上下各留黑边。
       30×11 = 2.73 与主区几乎相等，但那样视窗高度恰好等于房间高度，
       相机一点点夹紧抖动就会把房间的顶墙/踢脚切掉（实测截图：上壁被削平）。
       取 12 让视窗比房间高 1 格，房间始终完整，而黑边由 CSS 的船体内衬吃掉
       （.scene-mount::before 本来就是无缝舱壁瓦片，黑边读作"舱外结构"）。

     【为什么不再更大】船体 234×45 格，若视窗给到 60×22，同屏就是四间房，
       角色只有 1.15 格宽 ⇒ 在 1600px 宽的画布上只剩 30px，读作"点"。
       批 UI-7 花了整整一批把角色从 32px 修到 64px，不能在这里退回去。 */
  /* 〔批 ART-0/B1a · 2026-10-28〕常量表已搬到 `js/scene/const.js`（零状态，先拆它打通链路：
     const 文件 → tools/load-order.cjs → tools/sync-html.cjs → index.html → 门禁源码解析）。
     下面整体解构，**调用点一个字不改**；新增常量请加到那个文件，不要在这里再写一份。 */
  if (!global.SKSceneConst) {
    throw new Error('ui-scene：缺少 js/scene/const.js —— 加载顺序见 tools/load-order.cjs 的 ORDER_UI');
  }
  const {
    TILE, ASSET, VIEW_TILES, VB, PALETTE, MINE,
    CREW_W, CREW_H, CREW_COUNT,
    CREW_VIS_W, CREW_VIS_H, CREW_VIS_TILES, CREW_BOX, ROW_IDLE, VISION_R,
  } = global.SKSceneConst;

  /* 〔批 ART-0/B1b · 2026-10-28〕取图名（席位号 → crew-NN）与帧切换都已搬到
     `js/scene/crew.js`：**外观与身份解耦**那条不变量在那边守（不读 role / faction）。
     这里只引用，不再留第二份实现 —— 两处各写一份取模逻辑正是"1 号与 9 号撞衣服"的老病根。 */
  if (!global.SKSceneCrew) {
    throw new Error('ui-scene：缺少 js/scene/crew.js —— 加载顺序见 tools/load-order.cjs 的 ORDER_UI');
  }
  const CREW_FILE = global.SKSceneCrew.CREW_FILE;

  /* 〔批 ART-0/B2a · 2026-10-28〕房间外壳（地板/四壁/墙饰）与走廊带在 js/scene/shell.js：
     那是零交互、零状态的纯 HTML 构建，对局页与主页共用同一份（批 UI-7 的唯一一份约定继续有效）。 */
  if (!global.SKSceneShell) {
    throw new Error('ui-scene：缺少 js/scene/shell.js —— 加载顺序见 tools/load-order.cjs 的 ORDER_UI');
  }
  const SHELL = global.SKSceneShell;

  function escAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function el(id) { const d = global.document; return d && d.getElementById ? d.getElementById(id) : null; }
  function now() { return (global.performance && global.performance.now) ? global.performance.now() : Date.now(); }

  /* =============================================================
   * 〔批 SHIP · 2026-10-27〕船体坐标：房间不再是"整块画布"，而是船体上的一块
   * -------------------------------------------------------------
   * 旧版 roomOrigin() 把当前房间**居中铺满**画布 —— 因为那时一次只画一间房。
   * 整船图之后，9 间房各有固定的船体位置（js/ship-map.js 的 ROOMS），
   * 相机决定看哪一块，房间位置**不再随当前房间变化**。
   *
   * 所以这里只保留一个换算：房间本地格 → 船体格。
   *   ship = roomRect.x + localX ,  roomRect.y + localY
   * 渲染器里所有几何都先落到船体格，最后统一减去相机偏移。
   * ============================================================= */
  const ROOM_ID_DEFAULT = 'bridge';
  let curRoom = ROOM_ID_DEFAULT;

  function shipOf() { return global.SKShip || null; }

  /* 房间矩形（船体格）。ship-map 缺席时退化成一个居中矩形 ——
     门禁会在那种情况下判红（test-ship 的 SH0），这里只保证不崩。 */
  function roomOrigin(S, roomId) {
    const M = shipOf();
    const id = roomId || curRoom;
    const r = (S && S.room(id)) || (S && S.room(ROOM_ID_DEFAULT));
    const rect = M ? M.roomRect(id) : null;
    const x = rect ? rect.x : 0, y = rect ? rect.y : 0;
    const w = r ? r.size[0] : 30, h = r ? r.size[1] : 11;
    return { x: x, y: y, w: w, h: h, r: r, id: id };
  }

  /* 相机：由「我在哪」推出视窗（船体格）。渲染与门禁共用这一份。
     -------------------------------------------------------------
     〔批 SHIP〕两条规则叠在一起，缺一不可：
       ① **在房间里**（静止时总是如此）：视窗夹进**那间房** ⇒ 一间房铺满屏幕。
          这是"近景"的定义：房间 30×11 = 视窗 30×11，一格不多一格不少。
          若只按"我居中"算，人站房间下半部时视窗会越出房间，屏幕下半截是空船体。
       ② **在走廊里**（走动途中）：不夹，视窗跟着人 —— 这样两头房间各露一半，
          玩家能看见"我正在从舰桥走向查证室"，而不是盯着一堵墙。

     〔批 SHIP-2 · 2026-10-27〕面板展开时的让位：**按面板实测位置算，不写死 0.34**
     -------------------------------------------------------------
     上一版注释写"面板展开时把我抬到 0.34"，但 camera() 里 clampRect 的
     "房间比视窗小 ⇒ 居中"分支把 anchorY 整个覆盖掉了（见 ship-map.js 的注释），
     实测「我」被面板盖住 65%~100% —— 轮到自己做决策时看不见自己。
     修好 anchorY 之后又发现固定 0.34 是**过量**的：夜里「我」本来站在房间底部
     （anchorInRoom 的兜底落点），抬到 34% 会把房间上半截（桌子与整圈座位）推出屏幕，
     等于为了"不被人挡住"牺牲掉"看不见桌子"。
     所以这里改成**按需**：只抬到"脚底刚好让开面板顶边 + 14px"为止，上限是居中（0.5）。
     面板越高 ⇒ 需要的 ay 越小（相机越高）；面板够低时 ay 就是 0.5，一像素都不多抬。 */
  let panelTopPx = 0;   /* 面板顶边（视口坐标 px）；0 = 没量到 / 没展开 */

  function measurePanelTop() {
    panelTopPx = 0;
    if (!panelOpen || panelIsModal()) return;
    const p = el('region-dec');
    if (!p || !p.getBoundingClientRect) return;
    try {
      const cs = global.getComputedStyle ? global.getComputedStyle(p) : null;
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return;
      const r = p.getBoundingClientRect();
      if (r.height > 4) panelTopPx = r.top;
    } catch (_) { /* 量不到就退回常量 */ }
  }

  /* 面板展开时的 anchorY：把「我」的下沿抬到面板顶边之上，且**不多抬**。
     -------------------------------------------------------------
     全部在屏幕像素里推，且**只读当前帧已有的量**（viewBox / getScreenCTM / seatRects），
     不回头调 cameraNow() —— 否则就是"算相机时又要相机"，会递归。

     为什么用二分而不是解析式：
       相机 y 对 ay 是**分段**函数（船体夹紧 / 房间夹紧 / 房间居中三支），
       房间 11 格 < 视窗 12 格时，ay=0.5 那一支走的是"房间居中"，
       解析式 `camY = me.y - vh·ay` 在那里**根本不成立**。
       第一版就是按解析式写的，实测算出来"人本来就露着"，于是永远返回 0.5 ——
       症状与没改一模一样（712 仍在面板 639 之下）。
       二分只依赖"ay 越大 ⇒ 人越靠下"这一条单调性，对任何夹紧分支都成立。

     单调性：ay↑ ⇒ camY↓ ⇒ 内容↓ ⇒ 屏幕 y↑。所以要找的是
     「人仍完整露在面板之上」的**最大** ay（最大 ay = 抬得最少）。 */
  function panelAnchorY(me) {
    if (!panelTopPx) return 0.34;                    /* 量不到面板：退回旧常量 */
    const M = shipOf();
    if (!M) return 0.34;
    const mount = el('scene-mount');
    const svg = mount && mount.querySelector ? mount.querySelector('svg.sk-scene') : null;
    if (!svg || !svg.getScreenCTM) return 0.34;
    let ctm = null;
    try { ctm = svg.getScreenCTM(); } catch (_) { ctm = null; }
    if (!ctm || !(ctm.d > 0.01)) return 0.34;
    const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (vb.length < 4 || !isFinite(vb[1])) return 0.34;
    const camYNow = vb[1] / TILE;
    let footNow = 0;
    try {
      const rects = seatRects();
      if (rects && rects.length) footNow = rects[0].bottom;
    } catch (_) { footNow = 0; }
    if (!footNow) return 0.34;

    const here = M.roomAt(me.x, me.y);
    const clamp = here ? M.roomRect(here) : null;
    const pxPerTile = TILE * ctm.d;
    const target = panelTopPx - 14;                  /* 脚底最多到面板顶边之上 14px */
    const footAt = (ay) => {
      const cam = M.camera(me.x, me.y, VIEW_TILES.w, VIEW_TILES.h, ay, clamp);
      return footNow + (camYNow - cam.y) * pxPerTile;
    };
    /* 已经露着 ⇒ 一像素都不抬 */
    if (footAt(0.5) <= target) return 0.5;
    /* 抬到下限还压着 ⇒ 就给下限（再低房间上半截全出屏，反而更糟） */
    const LO = 0.20;
    if (footAt(LO) > target) return LO;
    let lo = LO, hi = 0.5;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (footAt(mid) <= target) lo = mid; else hi = mid;
    }
    return lo;
  }

  function cameraNow() {
    const M = shipOf();
    if (!M) return { x: 0, y: 0, w: VIEW_TILES.w, h: VIEW_TILES.h };
    const me = myPos();
    const ay = (panelOpen && !panelIsModal()) ? panelAnchorY(me) : 0.5;
    const here = M.roomAt(me.x, me.y);
    const clamp = here ? M.roomRect(here) : null;
    return M.camera(me.x, me.y, VIEW_TILES.w, VIEW_TILES.h, ay, clamp);
  }

  /* 「我」在船体上的位置（格）。相机、小地图、角色落点都读它。 */
  function myPos() {
    const M = shipOf();
    const S = global.SKSpace;
    const r = roomOrigin(S, curRoom);
    if (!M || !S) return { x: r.x + r.w / 2, y: r.y + r.h / 2, room: curRoom };
    /* 走到一半时用插值位置（见 walkState），否则就是房间里的锚点 */
    const ws = walkState;
    if (ws && ws.pts && ws.pts.length) {
      const p = pointOnPath(ws.pts, ws.t);
      return { x: p.x, y: p.y, room: M.roomAt(p.x, p.y) || curRoom };
    }
    /* 〔批 WALK · 2026-10-28〕自由行走之后的落点优先于锚点。
       -------------------------------------------------------------
       旧版没有任何"人站在哪"的状态：位置永远由 anchorInRoom 按房间推出来
       （舰桥=我的席位 / 宿舍=我的睡眠舱 / 其他=房间中央偏下）。
       所以只要一停，人就弹回座位 —— 玩家在房间里走两步再停下会立刻被弹回去。
       freePos 就是补上这个状态：玩家自己走过之后，站位由玩家决定；
       只有它为空（还没走过 / 换了昼夜）时才退回锚点，既有语义一字不改。 */
    if (freePos) return { x: freePos.x, y: freePos.y, room: M.roomAt(freePos.x, freePos.y) || curRoom };
    const a = anchorInRoom(S, curRoom);
    return { x: r.x + a.x, y: r.y + a.y, room: curRoom };
  }

  /* 房间内的站位锚点（房间本地格）：
       舰桥白天 = 我那一席；宿舍 = 我的睡眠舱；其他房间 = 房间中央偏下。
     与旧版 crewHtml 的落点规则**逐条一致**，只是不再乘 TILE 也不再加房间偏移。 */
  function anchorInRoom(S, roomId) {
    const me = (lastV && lastV.humanId) || 1;
    if (roomId === 'bridge' && lastG && lastG.phase !== 'night') {
      const seats = S.seatPositions('bridge');
      const s = seats[(me - 1) % seats.length];
      if (s) return { x: s.x, y: s.y };
    }
    if (roomId === 'dorms') {
      const pods = S.podPositions('dorms');
      const q = pods[(me - 1) % pods.length];
      if (q) return { x: q.x + 0.5, y: q.y + 1 };
    }
    const r = S.room(roomId) || { size: [30, 11] };
    return { x: r.size[0] / 2, y: r.size[1] - 1.6 };
  }

  /* =============================================================
   * 〔批 SHIP · 2026-10-27〕走动：沿通道逐帧插值（替换 walkUntil 时间戳）
   * -------------------------------------------------------------
   * 用户拍板「点目标房间 → 沿通道自动寻路」。所以走动不再是"从门口滑到座位"的
   * 一次性入场动画，而是**一条由 ship-map 算出来的折线**，角色沿线走。
   *
   * 为什么用插值而不是 CSS 位移：
   *   · 折线有 5~9 个拐点，CSS 的 translate 只能走直线；
   *   · 相机要跟着人走 —— 相机位置必须和人的位置同源，否则人会被"甩"出画面。
   *
   * 时间模型：requestAnimationFrame 驱动，位置 = pointOnPath(pts, t)，t ∈ [0,1]。
   *   t 按**路径长度**分配（不是按段数），所以长短段速度一致。
   *   没有 rAF 的环境（vm 沙盒 / 门禁）里 walk 只更新状态，不启动动画 —— 渲染仍正确。
   * ============================================================= */
  /* 〔批 DEMO · 2026-10-28〕移速降到 5 格/秒：一间房 30 格要走 6 秒，
     跨两间（经舰桥）约 12 秒 —— 追逐与"赶路被看见"才有张力（7.5 时走廊 2 秒就穿完了）。 */
  const WALK_SPEED = 5;        /* 格/秒 */
  let walkState = null;        /* { pts, t, len, room } */
  let walkRaf = 0;

  /* 折线参数化：按**长度**均匀取点。pts 至少两点。 */
  function segLens(pts) {
    const seg = [];
    let total = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      seg.push(d); total += d;
    }
    return { seg: seg, total: total };
  }
  function pointOnPath(pts, t) {
    if (!pts || !pts.length) return { x: 0, y: 0 };
    if (pts.length === 1) return { x: pts[0].x, y: pts[0].y };
    const L = segLens(pts);
    if (L.total <= 0) return { x: pts[0].x, y: pts[0].y };
    let want = Math.max(0, Math.min(1, t)) * L.total;
    for (let i = 0; i < L.seg.length; i++) {
      if (want <= L.seg[i] || i === L.seg.length - 1) {
        const k = L.seg[i] > 0 ? Math.min(1, want / L.seg[i]) : 0;
        return {
          x: pts[i].x + (pts[i + 1].x - pts[i].x) * k,
          y: pts[i].y + (pts[i + 1].y - pts[i].y) * k,
        };
      }
      want -= L.seg[i];
    }
    const last = pts[pts.length - 1];
    return { x: last.x, y: last.y };
  }

  /* 朝哪个方向走（决定用行走图的哪一行）。
     用户看不到别人（只渲染我），但**我自己**的朝向要跟得上，
     否则"向左走却面朝下"会立刻被看出来。 */
  function dirOnPath(pts, t) {
    if (!pts || pts.length < 2) return 'down';
    const L = segLens(pts);
    let want = Math.max(0, Math.min(1, t)) * L.total;
    for (let i = 0; i < L.seg.length; i++) {
      if (want <= L.seg[i] || i === L.seg.length - 1) {
        const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;
        if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
        return dy >= 0 ? 'down' : 'up';
      }
      want -= L.seg[i];
    }
    return 'down';
  }

  function stopWalk() {
    walkState = null;
    if (walkRaf && global.cancelAnimationFrame) { try { global.cancelAnimationFrame(walkRaf); } catch (_) {} }
    walkRaf = 0;
  }

  /* 沿通道走到另一间房。target 可以是房间 id，也可以是船体格坐标 {x,y}。 */
  function walkTo(target, opts) {
    const M = shipOf();
    if (!M) return null;
    const from = myPos();
    const fromRoom = from.room || curRoom;
    const toRoom = typeof target === 'string' ? target : (M.roomAt(target.x, target.y) || curRoom);
    const p = M.path(fromRoom, toRoom, { x: from.x, y: from.y });
    if (!p) return null;
    walkState = { pts: p.pts, t: 0, len: p.len, room: toRoom };
    if (opts && opts.silent) return p;
    startWalkAnim();
    return p;
  }

  function startWalkAnim() {
    if (!global.requestAnimationFrame) return;
    /* 〔批 WALK〕已经有一条折线在跑（玩家又点了别处 / 键盘接管）时，换线必须**重置计时**：
       否则新的折线沿用旧的 t0，第一帧算出来的 dt 已经是好几秒 ⇒ 人瞬间滑到终点。 */
    if (walkRaf && global.cancelAnimationFrame) { try { global.cancelAnimationFrame(walkRaf); } catch (_) {} }
    walkRaf = 0;
    const t0 = now();
    const step = function () {
      if (!walkState) { walkRaf = 0; return; }
      const dt = (now() - t0) / 1000;
      const need = walkState.len / WALK_SPEED;
      walkState.t = need > 0 ? Math.min(1, dt / need) : 1;
      const pos = pointOnPath(walkState.pts, walkState.t);
      paintWalk(pos);
      if (walkState.t >= 1) {
        const dest = walkState.room;
        /* 〔批 WALK〕落点：点地面 → 停在点击点（end）；点门/自动导航 → end 为空 ⇒ 回锚点。
           旧版一律回锚点，于是"点地面走过去"最后会弹回房间中央，看着像没走到。 */
        const end = walkState.end || null;
        walkState = null; walkRaf = 0;
        curRoom = dest;
        freePos = end;
        sig = null;
        if (lastG && lastV) render(lastG, lastV);
        else { const m = el('scene-mount'); if (m) m.__skBuilt = false; }
        return;
      }
      walkRaf = global.requestAnimationFrame(step);
    };
    walkRaf = global.requestAnimationFrame(step);
  }

  /* 每帧只动三样东西：角色 transform、相机 viewBox、小地图上的我。
     不重建 DOM（整船重绘每帧会掉到个位数帧率）。 */
  function paintWalk(pos) {
    const mount = el('scene-mount');
    if (!mount) return;
    const svg = mount.querySelector('svg.sk-scene');
    const M = shipOf();
    if (!svg || !M) return;
    const cam = cameraNow();
    svg.setAttribute('viewBox', [cam.x * TILE, cam.y * TILE, cam.w * TILE, cam.h * TILE].join(' '));
    const meId = (lastV && lastV.humanId) || 1;
    const g = svg.querySelector('.sk-crew[data-seat="' + meId + '"]');
    if (g) {
      g.setAttribute('transform', 'translate(' + (pos.x * TILE).toFixed(1) + ','
        + (pos.y * TILE + TILE * 0.34).toFixed(1) + ')');
      const dir = walkState ? dirOnPath(walkState.pts, walkState.t) : (freeDir || 'down');
      setCrewFrame(g, dir, true);
    }
    paintMinimap(mount, cam, pos);
  }

  /* 角色帧：viewBox 取行走图对应的那一行（下/上/左/右），列由 CSS 逐帧平移。
     〔批 SHIP〕旧版只有"向下走"一行在用（ROW_IDLE 待机），因为入场动画是横向的。
     整船图要 4 向，这里按 ship-map 的折线方向选行 —— 生成器的 5 行本来就是
     下/上/待机/左/右（见 tools/gen-crew-sprites.cjs），W1 门禁已经在守每行都有真实差异。
     同时写出 --step-ms：4 帧循环时长 = 1 格 / WALK_SPEED 秒 × 1000。
     这是"腿的摆动频率"与"人的前进速度"唯一的同步点（见 css 的注释）。 */
  /* 〔批 ART-0/B1b · 2026-10-28〕角色帧已搬到 js/scene/crew.js（零业务状态：
     取图名 + 换行 + 行走类 + 步频）。这里只留一层包装，把 WALK_SPEED 换算成 --step-ms ——
     "走多快"仍只有一个真源（本文件的 WALK_SPEED）。 */
  function setCrewFrame(g, dir, walking) {
    const C = global.SKSceneCrew;
    if (!C) return;
    C.setCrewFrame(g, dir, walking, Math.round((1 / WALK_SPEED) * 1000));
  }

  /* =============================================================
   * 〔批 WALK · 2026-10-28〕自由行走：键盘连续走位 + 点地面走过去
   * -------------------------------------------------------------
   * 用户原话：「调整人物行走逻辑，现在可在地图中自由行走」。
   *
   * 上一版只有一个移动入口：点门（或等游戏把你带去决策房），人沿
   * 「房间中心 → 门 → 廊 → 门 → 房间中心」那条折线走。玩家的坐标**不由玩家决定**，
   * 停下来的位置也由 anchorInRoom 推（座位 / 睡眠舱 / 房间中央）。
   *
   * 这一版补两个入口，二者共用同一份碰撞、相机与落点状态：
   *   ① 键盘：WASD / 方向键，速度 WALK_SPEED（与折线走动同速），
   *      逐轴滑动 —— 撞墙时沿墙走，而不是整个人卡住；
   *   ② 点地面：ship-map.walkPath() 用 0.5 格网格 A* 找一条不穿墙的折线再走过去。
   *
   * 三条不变量（改这里时必须守）：
   *   · **碰撞只有一个判据**：SKShip.walkable()。渲染器不自己算墙体。
   *   · **位置只有一个来源**：freePos（自由行走后）> walkState（折线中）> anchorInRoom。
   *   · **不重建 DOM 也要动**：每帧只改角色 transform / 相机 viewBox / 小地图三个点
   *     （重建整船 DOM 每帧会掉到个位数帧率，见 paintWalk 的注释）。
   * ============================================================= */
  let freePos = null;        /* 玩家自己走出来的落点（船体格）；null = 还没走过/换了昼夜 */
  let freeDir = 'down';      /* 键盘走位的朝向（paintWalk 用它选行走图的行） */
  let freeRaf = 0;
  let freePrevT = 0;
  let freeDirty = false;     /* 走动途中换了房间 ⇒ 停下来要重绘一次（家具可点性靠它） */

  const KEY_DIR = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', a: 'left', s: 'down', d: 'right',
    W: 'up', A: 'left', S: 'down', D: 'right',
  };
  const KEY_HELD = { up: 0, down: 0, left: 0, right: 0 };
  let keysBound = false;

  /* 焦点在输入框里时不许抢键（发言输入框、私聊、笔记……） */
  function isTypingTarget(t) {
    if (!t) return false;
    const tag = String(t.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return !!t.isContentEditable;
  }
  /* 只有对局页才接管键盘：主页/结算页按方向键不该让场景里的人走起来 */
  function sceneLive() {
    if (!lastG || !lastV) return false;
    const sc = el('screen-game');
    if (sc && sc.classList && sc.classList.contains('hidden')) return false;
    /* 弹层打开时不抢键：规则速览/席位弹窗要用方向键滚动，被走路吞掉就成了"按了没反应" */
    const ov = ['rules-overlay', 'role-overlay'];
    for (let i = 0; i < ov.length; i++) {
      const n = el(ov[i]);
      if (n && n.classList && !n.classList.contains('hidden')) return false;
    }
    return !!el('scene-mount');
  }
  function keyVector() {
    let x = 0, y = 0;
    if (KEY_HELD.up) y -= 1;
    if (KEY_HELD.down) y += 1;
    if (KEY_HELD.left) x -= 1;
    if (KEY_HELD.right) x += 1;
    if (x && y) { const k = Math.SQRT1_2; x *= k; y *= k; }   /* 斜向不许更快 */
    return { x: x, y: y };
  }
  function keyMoving() { const v = keyVector(); return !!(v.x || v.y); }

  /* 逐轴滑动：先试 x、再试 y。
     撞墙时另一轴仍然生效 ⇒ 沿着墙擦过去（斜着撞墙不会整个人停住）。
     判据只有 SKShip.walkable()（房间内缩矩形 + 通道带，见 ship-map.js 的批 WALK 段）。 */
  function slideMove(from, dx, dy) {
    const M = shipOf();
    if (!M || !M.walkable) return { x: from.x, y: from.y };
    let x = from.x, y = from.y;
    if (dx && M.walkable(x + dx, y)) x += dx;
    if (dy && M.walkable(x, y + dy)) y += dy;
    return { x: x, y: y };
  }

  function startFreeWalk() {
    if (freeRaf || !global.requestAnimationFrame || !sceneLive()) return;
    freePrevT = now();
    const step = function () {
      freeRaf = 0;
      if (!keyMoving()) { settleFreeWalk(); return; }
      const t = now();
      const dt = Math.max(0, Math.min(0.08, (t - freePrevT) / 1000));   /* 掉帧/切后台时别瞬移 */
      freePrevT = t;
      stepFreeWalk(dt);
      freeRaf = global.requestAnimationFrame(step);
    };
    freeRaf = global.requestAnimationFrame(step);
  }

  function stepFreeWalk(dt) {
    const M = shipOf();
    if (!M) return;
    const v = keyVector();
    let from = myPos();
    /* 起点先收敛到可站位置。
       -------------------------------------------------------------
       锚点不一定站得住：宿舍 1/2/4/5 号舱位的落点算出来是 y = 房间顶 + 2.0，
       而可行走面的上沿是 +2.1（墙高 2 格再留 0.1 余量）—— 差 0.1 格。
       从这种位置起步时，逐轴滑动会判"四个方向都撞墙"，人就**完全动不了**。
       所以和点地面一样，先取最近的可站位置（SKShip.nearestWalkable）。 */
    if (!M.walkable(from.x, from.y) && M.nearestWalkable) {
      const q = M.nearestWalkable(from.x, from.y);
      if (q) from = { x: q.x, y: q.y };
    }
    /* 键盘接管：正在沿折线走的话，先把当前位置落成 freePos 再打断 ——
       否则 walkState 与 freePos 两套位置源同时存在，人会被折线拽回去。 */
    if (walkState) { freePos = { x: from.x, y: from.y }; stopWalk(); }
    const to = slideMove(from, v.x * WALK_SPEED * dt, v.y * WALK_SPEED * dt);
    if (Math.abs(v.x) >= Math.abs(v.y) && v.x) freeDir = v.x > 0 ? 'right' : 'left';
    else if (v.y) freeDir = v.y > 0 ? 'down' : 'up';
    freePos = to;
    paintWalk(to);
    const here = M.roomAt(to.x, to.y);
    if (here && here !== curRoom) {
      /* 走进另一间房：curRoom 立刻跟着变（家具可点性、门高亮、小地图房名都读它），
         但**不在走动中重建 DOM** —— 重建会打断这一帧的 transform。
         记一个脏标记，等按键松开、人停下时重绘一次。 */
      curRoom = here;
      freeDirty = true;
      sig = null;
    }
  }

  function settleFreeWalk() {
    freeRaf = 0;
    paintWalk(myPos());
    setIdleFrame();
    if (!freeDirty) return;
    freeDirty = false;
    sig = null;
    if (lastG && lastV) render(lastG, lastV);
    else { const m = el('scene-mount'); if (m) m.__skBuilt = false; }
  }

  /* 停下来的姿态 = 待机帧（腿不摆），并摘掉 .sk-walking */
  function setIdleFrame() {
    const mount = el('scene-mount');
    const svg = mount && mount.querySelector ? mount.querySelector('svg.sk-scene') : null;
    if (!svg) return;
    const meId = (lastV && lastV.humanId) || 1;
    const g = svg.querySelector('.sk-crew[data-seat="' + meId + '"]');
    if (g) setCrewFrame(g, 'down', false);
  }

  /* ---- 沿一条折线走（自由行走与点门共用同一个 runner）----
     end 非空 = 走到终点后**停在 end**（点地面）；为空 = 回房间锚点（点门 / 自动导航）。
     起点会接到人现在的位置上：A* 是从最近的格子中心出发的，差半格会让起步抖一下。 */
  function walkAlong(p, room, end) {
    if (!p || !p.pts || p.pts.length < 2) return null;
    const from = myPos();
    const pts = p.pts.slice();
    if (Math.hypot(pts[0].x - from.x, pts[0].y - from.y) > 1e-6) pts.unshift({ x: from.x, y: from.y });
    let len = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    }
    walkState = { pts: pts, t: 0, len: len, room: room || curRoom, end: end || null };
    startWalkAnim();
    return walkState;
  }

  /* 点地面 → 走过去。走不通返回 false（调用方给提示，不假装成功）。 */
  function walkToPoint(pt) {
    const M = shipOf();
    if (!M || !pt || !M.walkable) return false;
    const from = myPos();
    const p = M.walkPath(from, pt);
    if (!p || !p.pts || p.pts.length < 2) return false;
    walkAlong(p, M.roomAt(pt.x, pt.y) || curRoom, pt);
    return true;
  }

  /* 点场景空地：先找最近的可站位置（点到墙上/家具上 = 走到它旁边），再走过去。 */
  function onGroundClick(pt, mount) {
    const M = shipOf();
    if (!M || !M.nearestWalkable) return;
    const q = M.nearestWalkable(pt.x, pt.y);
    if (!q) { toast(mount, '那里走不过去'); return; }
    if (!walkToPoint(q)) toast(mount, '那里走不过去');
  }

  /* 屏幕坐标 → 船体格坐标（格）。viewBox 就是船体坐标 × TILE，所以这里只除 TILE。 */
  function shipPointFromEvent(e, mount) {
    const svg = mount && mount.querySelector ? mount.querySelector('svg.sk-scene') : null;
    if (!svg || !svg.getScreenCTM) return null;
    let ctm = null;
    try { ctm = svg.getScreenCTM(); } catch (_) { return null; }
    if (!ctm || !ctm.a) return null;
    let pt = null;
    try {
      const inv = ctm.inverse();
      if (global.DOMPoint && global.DOMPoint) {
        pt = new global.DOMPoint(e.clientX, e.clientY).matrixTransform(inv);
      } else if (svg.createSVGPoint) {
        const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
        pt = p.matrixTransform(inv);
      }
    } catch (_) { pt = null; }
    if (!pt || !isFinite(pt.x) || !isFinite(pt.y)) return null;
    return { x: pt.x / TILE, y: pt.y / TILE };
  }

  /* 键盘绑定：只在第一次渲染时挂一次（重复挂会让一次按键被处理多遍） */
  function bindKeys() {
    if (keysBound || !global.addEventListener) return;
    keysBound = true;
    global.addEventListener('keydown', function (e) {
      if (!e || e.ctrlKey || e.metaKey || e.altKey) return;
      const dir = KEY_DIR[e.key];
      if (!dir) return;
      if (isTypingTarget(e.target)) return;
      if (!sceneLive()) return;
      /* preventDefault：方向键会把面板/页面滚走，人却在走，画面跟着跳 */
      if (e.preventDefault) e.preventDefault();
      KEY_HELD[dir] = 1;
      startFreeWalk();
    });
    global.addEventListener('keyup', function (e) {
      const dir = e && KEY_DIR[e.key];
      if (dir) KEY_HELD[dir] = 0;
    });
    /* 切窗口/失焦时必须清键：否则 alt-tab 回来人还在一直走 */
    global.addEventListener('blur', function () {
      KEY_HELD.up = 0; KEY_HELD.down = 0; KEY_HELD.left = 0; KEY_HELD.right = 0;
    });
  }

  /* 〔批 ART-0/B2a · 2026-10-28〕房间外壳（地板/四壁/墙饰）与走廊带已搬到
     `js/scene/shell.js`（零交互、零状态的纯 HTML 构建，对局页与主页共用同一份）。
     这里只经 SHELL.* 调用，不再留第二份实现。 */

  /* 通道：船体骨架的连接带（用户原话「通道连接房间」）。
     -------------------------------------------------------------
     为什么通道要画成"走廊"而不是一条细线：玩家点目标房间之后**自己会沿它走**，
     走的时候必须看得出"我在廊里"。所以廊面铺地砖（floor-grate），
     两侧加壁线，转角处不铺（本布局没有折角廊）。
     数据全部来自 js/ship-map.js 的 corridorRects —— 渲染器不自己算几何。

     【注意】廊面用**自己的一份 pattern**（sk-floor-corridor），不复用房间的。
       第一版直接写 fill="url(#sk-floor-corridor)" 却**没有定义这个 pattern** ——
       实测截图上走廊整条是空的（露出船体内衬），读作"房间浮在虚空里"。
       这是 AGENTS 红线 9「元素存在 ≠ 像素可见」的又一次：DOM 里 <rect> 在、
       包围盒也在，但它的 fill 取不到，画出来是透明的 —— 614 条断言一条都不会报。
       test-ship 的 SH8 现在守这条：走廊 pattern 必须被定义，且 id 与引用一致。 */

  /* 房间背景：地板平铺 + 四壁 + 门。**现在画的是全部 9 间房**（整船图），
     当前房间只是"我站在哪"，不再是"画哪一间"。 */
  function roomHtml(S) {
    const M = shipOf();
    let html = '<g class="sk-room-floor">';
    /* 通道先画（压在房间下面，房间外圈光会盖住接缝） */
    if (M) html += SHELL.corridorHtml(M);

    for (const id of (S.ids ? S.ids() : [])) {
      const o = roomOrigin(S, id);
      const r = o.r;
      if (!r) continue;
      /* 每间房可用 space.js 的 dim 覆盖地板压暗强度（暖色地板需要压得更深） */
      html += SHELL.floorWallShell(S, o, r, id, r.dim != null ? r.dim : 0.34);

      /* ---- 门：墙面上的开口 + 可点热区 ----
         〔批 UI-7〕旧版门只是一块描边矩形（fill #0b1424），读作"墙上贴了张蓝框标签"。
         现在先贴 cozy 的 door-open 素材做**开口**，再在上面盖热区。
         上下两侧的门按 side 旋转 90°（素材是竖版 32×64）。
         〔批 UI-6 的约束仍然有效〕热区必须整块落在房间内 —— 见下方按 side 收边。
         〔批 SHIP〕门锚点改走 ship-map 的 doorPoint（船体格），与通道端点同源，
           这样"门在哪"与"廊连到哪"永远是同一个数，不会出现廊接在门旁边。 */
      for (const d of r.doors) {
        const a = S.doorAnchor(id, d);
        if (!a) continue;
        const px = o.x + a.x, py = o.y + a.y;
        const horiz = (d.side === 't' || d.side === 'b');
        const dw = horiz ? 2 : 0.7, dh = horiz ? 0.7 : 2;
        /* 门热区**必须整块落在房间内**（批 UI-6 的教训：一半在画布外会被裁掉）。 */
        let rx, ry;
        if (d.side === 'l') { rx = o.x; ry = py - dh / 2; }
        else if (d.side === 'r') { rx = o.x + o.w - dw; ry = py - dh / 2; }
        else if (d.side === 't') { rx = px - dw / 2; ry = o.y; }
        else { rx = px - dw / 2; ry = o.y + o.h - dh; }
        /* 转成像素 */
        const RX = rx * TILE, RY = ry * TILE, DW = dw * TILE, DH = dh * TILE;
        /* 门洞素材：竖门直接贴；横门**旋转 90°**，不是把 32×64 拉成 2:0.7。
           注意：第一版是"交换 width/height"——那是拉伸，门框与门板的像素比例会被拉歪，
             截图上门变成一片浅色长方形。这里用 rotate 围绕矩形中心转，保持像素比例。 */
        if (horiz) {
          const cx = RX + DW / 2, cy = RY + DH / 2;
          html += '<image class="sk-door-art" pointer-events="none" href="' + ASSET
            + 'tiles/door-open.png" x="' + (cx - DH / 2) + '" y="' + (cy - DW / 2)
            + '" width="' + DH + '" height="' + DW
            + '" transform="rotate(90 ' + cx + ' ' + cy + ')"'
            + ' image-rendering="pixelated" opacity="0.95"/>';
        } else {
          html += '<image class="sk-door-art" pointer-events="none" href="' + ASSET
            + 'tiles/door-open.png" x="' + RX + '" y="' + RY + '" width="' + DW + '" height="' + DH
            + '" image-rendering="pixelated" opacity="0.95"/>';
        }
        html += '<rect class="sk-door" data-door="' + escAttr(d.to) + '" data-room="' + escAttr(id)
          + '" x="' + RX + '" y="' + RY + '" width="' + DW + '" height="' + DH
          + '" fill="none" stroke="#4dabf7" stroke-width="2" rx="4"/>';
        /* 〔批 SHIP-2 · 2026-10-27〕标签不再压在门洞正中，而是**向房内让开**。
           -------------------------------------------------------------
           旧写法把标签放在门矩形中心（RX+DW/2, RY+DH/2+4）。左右两侧的门只有
           0.7 格宽（39px），而"查证室"三个字在 12px 字号下约 40px —— 字直接压在
           门框描边与门洞暗部上，实测「查证室」在左侧门上读成「查证室」压成一团深色
           （截图放大后只有中间一个字清楚）。上下两扇门更糟：门洞本身 2 格宽，
           但标签 y 落在墙脚线，与壁线叠在一起。
           现在按 side 把标签推到**房内一侧**（离门 0.55 格），并加一层描边
           （paint-order:stroke，见 CSS），压在深色地板/家具上也读得出来。
           这不是"更好看"，是"读不读得出"：玩家要靠它判断这扇门通向哪间房。 */
        const off = TILE * 0.55;
        let tx = RX + DW / 2, ty = RY + DH / 2 + 4, anchor = 'middle';
        if (d.side === 'l') { tx = RX + DW + off; ty = RY + DH / 2 + 4; anchor = 'start'; }
        else if (d.side === 'r') { tx = RX - off; ty = RY + DH / 2 + 4; anchor = 'end'; }
        else if (d.side === 't') { tx = RX + DW / 2; ty = RY + DH + TILE * 0.5; }
        else { tx = RX + DW / 2; ty = RY - TILE * 0.28; }
        html += '<text class="sk-door-t" x="' + tx + '" y="' + ty + '" text-anchor="' + anchor
          + '" data-side="' + escAttr(d.side) + '">'
          + escAttr((S.room(d.to) || {}).name || d.to) + '</text>';
      }

      /* 房名：钉在**房间右上角**，不再钉左上角。
         -------------------------------------------------------------
         左上角是书记官记录板的位置（layoutClerk 把小地图与记录板都放在场景左上），
         实测「舰桥」与记录板「书记官记录」重叠 798px² —— 两个词叠在一起谁也读不清。
         记录板是浮层、位置由 JS 按桌面包围盒算；房名是 SVG 文本、位置写死在这里。
         让 SVG 那一份避开浮层，比让浮层记住"左上角还有字"更可靠
         （浮层还要避让小地图、席位、提交路径，约束已经够多）。
         房名靠右对齐，右边界留 0.45 格，与门的标签也不会撞。 */
      html += '<text class="sk-room-name" x="' + ((o.x + o.w) * TILE - TILE * 0.45)
        + '" y="' + (o.y * TILE + 34) + '" text-anchor="end">'
        + escAttr(r.name) + '</text>';
    }
    html += '</g>';
    return html;
  }

  /* 家具层 —— 整船图下**全部 9 间房的家具一起画**（它们是船的一部分）。
     只有当前房间的家具可点：其余房间的 data-hit 一律不加，
     否则玩家会隔着两间房点到别人的手术台（交互必须"人到了才能做"）。 */
  function propsHtml(S) {
    let html = '<g class="sk-props">';
    const ids = S.ids ? S.ids() : [];
    for (const id of ids) {
      const o = roomOrigin(S, id);
      const r = o.r;
      if (!r) continue;
      const here = id === curRoom;
      html += '<g class="sk-props-room" data-room="' + escAttr(id) + '">';
      html += propsOfRoom(S, o, r, here);
      html += '</g>';
    }
    html += '</g>';
    return html;
  }

  function propsOfRoom(S, o, r, here) {
    let html = '';
    for (const p of r.props) {
      const d = S.PROP[p.t];
      if (!d) continue;
      const w = (p.w || d.w) * TILE, h = (p.h || d.h) * TILE;
      const x = o.x * TILE + p.x * TILE, y = o.y * TILE + p.y * TILE;
      /* 只有本房间的物件可交互 */
      const k = here ? p.k : null;
      const cls = 'sk-prop' + (k ? ' sk-hit' : '') + (p.t === 'rug' ? ' sk-decal' : '');
      html += '<image class="' + cls + '" '
        + (k ? 'data-hit="' + escAttr(k) + '" data-label="' + escAttr(p.label || '') + '" ' : '')
        + 'href="' + ASSET + 'furniture/' + p.t + '.png" '
        + 'x="' + x + '" y="' + (y + h - (p.t === 'rug' ? h : 0)) + '" width="' + w
        + '" height="' + h + '" preserveAspectRatio="none" image-rendering="pixelated"/>';
      if (p.t === 'rug' && p.tile) {
        /* 〔批 UI-7〕带 `tile` 的地毯 = **用真实瓦片铺的地面片**（升降台 / 顶灯亮面）。
           为什么不复用 furniture/rug.png：那张是"地毯"素材（自带边框），
           铺 4×2 会被拉伸成一块布；而这里要的是"地上这块贴了不同的地砖"。
           所以直接平铺 tiles/<tile>.png（32px → TILE），一格一张，不做拉伸。
           它仍然是装饰层：不带 data-hit 时只是地皮；带 k 时可点（升降台）。 */
        html = html.replace(/<image class="sk-prop sk-decal"[^>]*\/>/, '');
        for (let gy = 0; gy < (p.h || d.h); gy++) {
          for (let gx = 0; gx < (p.w || d.w); gx++) {
            html += '<image class="sk-prop sk-decal" href="' + ASSET + 'tiles/' + p.tile + '.png" x="'
              + (x + gx * TILE) + '" y="' + (y + gy * TILE) + '" width="' + TILE
              + '" height="' + TILE + '" image-rendering="pixelated"/>';
          }
        }
        /* 可交互的地面片：热区用一块透明矩形盖住整片（瓦片本身不宜带 data-hit，
           否则点击会落到其中一格上，白框只框住 1/16 的面积） */
        if (p.k && here) {
          html += '<rect class="sk-prop sk-decal" x="' + x + '" y="' + y + '" width="' + w
            + '" height="' + h + '" fill="none" pointer-events="all"'
            + ' data-hit="' + escAttr(p.k) + '" data-label="' + escAttr(p.label || '') + '"/>';
        }
      } else if (p.t === 'rug') {
        /* 地毯是纯色块，不用素材。
           〔批 UI-6〕**分两种画法**，因为语义不同：
             · 舰桥那张（anchor='clerk'）= 玩家眼里的「大桌子」⇒ 实心底色；
             · 其他房间的装饰地毯 ⇒ 只画**虚线轮廓**。
           实测：装饰地毯画成实心深色时，在亮地板房里读作「地上挖了个洞」，
           比空着还难看（宿舍右侧那一大块就是这样）。
           这个教训主页场景已经付过一次（批 H1：整块实心会把桌子与座位全盖住），
           当时只改了主页那处，对局内这处没跟着改。 */
        html = html.replace(/<image class="sk-prop sk-decal"[^>]*\/>/, '');
        const isDeck = p.anchor === 'clerk';
        html += '<rect class="sk-prop sk-decal" x="' + x + '" y="' + y + '" width="' + w
          + '" height="' + h + '" rx="' + (isDeck ? 6 : 18) + '"'
          + (isDeck
            ? ' fill="' + (p.tint === 'warn' ? '#8a6a2a' : '#16233a') + '" opacity="0.85"'
            : ' fill="none" stroke="#2f5178" stroke-width="2" opacity="0.55" stroke-dasharray="10 8"')
          + (k ? ' data-hit="' + escAttr(p.k) + '" data-label="' + escAttr(p.label || '') + '"' : '')
          + (p.anchor ? ' data-anchor="' + escAttr(p.anchor) + '"' : '')
          + '/>';
      }
      /* 〔批 UI-5〕新增的 5 件交互道具（通讯台 / 投票箱 / 抑制器 / 逃生舱 / 航海日志）
         没有正式素材，用 cozy 家具打底 + **同色角标**（角标里一个字），
         让玩家一眼分辨"这件东西能点、叫什么"。角标不是 emoji（用户排斥 emoji 图标）。 */
      const np = here && global.SKHudMap && global.SKHudMap.newProp(p.k);
      if (np) {
        html += '<g class="sk-mark" pointer-events="none">'
          + '<rect x="' + (x + w - 26) + '" y="' + (y + h - 26) + '" width="24" height="24" rx="6"'
          + ' fill="' + np.tint + '" opacity="0.92" stroke="#04080f" stroke-width="2"/>'
          + '<text x="' + (x + w - 14) + '" y="' + (y + h - 9) + '" text-anchor="middle"'
          + ' class="sk-mark-t">' + escAttr(np.mark) + '</text></g>';
      }
    }

    /* 15 席（舰桥）：座椅底座 + 编号。
       〔批 SHIP〕座圈不再压扁让位 —— 整船图里相机负责让位（见 cameraNow）。
       压扁是"房间铺满画布"时代的补丁：那时人没法躲开贴底抽屉，只能把人压扁。
       现在相机把我抬到画面上部 0.34 处，人不变形也不会被抽屉压住。
       【注意】squashSeatY 保留（主页与旧断言仍引用它），但整船图下它的系数恒为 1。 */
    const bridgeO = roomOrigin(S, 'bridge');
    const seats = S.seatPositions('bridge');
    for (const s of seats) {
      const px = bridgeO.x * TILE + s.x * TILE, py = bridgeO.y * TILE + squashSeatY(S, s.y) * TILE;
      html += '<g class="sk-seat' + (s.i === 1 ? '' : '') + '" data-seatpos="' + s.i + '">'
        + '<ellipse cx="' + px + '" cy="' + py + '" rx="' + (TILE * 0.46) + '" ry="' + (TILE * 0.28)
        + '" fill="#0b1424" stroke="' + PALETTE[s.i - 1] + '" stroke-width="2"/>'
        + '<text x="' + px + '" y="' + (py + 6) + '" text-anchor="middle" class="sk-seat-n">'
        + s.i + '</text></g>';
    }

    /* 15 个睡眠舱（宿舍） */
    const dormsO = roomOrigin(S, 'dorms');
    const pods = S.podPositions('dorms');
    for (const p of pods) {
      const px = dormsO.x * TILE + p.x * TILE, py = dormsO.y * TILE + p.y * TILE;
      html += '<image class="sk-prop" href="' + ASSET + 'furniture/cryopod.png" x="' + px
        + '" y="' + py + '" width="' + TILE + '" height="' + (TILE * 2)
        + '" image-rendering="pixelated"/>'
        + '<text class="sk-pod-n" x="' + (px + TILE / 2) + '" y="' + (py + TILE * 2 + 12)
        + '" text-anchor="middle">' + p.i + '</text>';
    }
    return html;
  }

  /* =============================================================
   * 席位：把 15 个玩家放到座位/睡眠舱/房间空位
   *   白天（讨论/投票）：全部入座舰桥
   *   夜间：玩家在各自编号的睡眠舱（宿舍）；「我」在自己舱位
   * 出局：灰度 + 半透明（公开信息）
   * ============================================================= */
  /* 〔批 UI-6 · 2026-10-26〕行动面板展开时，座位圈怎么让位
     -------------------------------------------------------------
     面板改成贴底抽屉后不再挤压场景（桌面档场景恒 789px，改前只有 543px），
     代价是它会盖住房间下沿那一排 —— 30×11 新房里是 1/2/15 号。

     【两种档位必须分开处理】这是量出来的，不是拍脑袋：
       桌面档（1440×900）：场景 1408×827，座圈占 245~632，面板顶边 560
         ⇒ 差 82px。把座圈**纵向压扁**（锚定上沿）即可让开，且永不越出房间。
       矮横屏（844×390）：场景 824×356，座圈占 76~303（227px），面板 226px
         ⇒ 场景总高还不够"座圈 + 面板"，**几何上不可能共存**。
         这时面板做成**模态抽屉**（盖住场景、场景压暗）：
         这一步玩家要做的就是在面板里点目标，场景此刻不是必要信息。

     【为什么是压扁而不是平移】
       平移受房间上沿限制：座圈上沿在 2.1 格，最多抬 1.5 格 ≈ 84px，而桌面档需要 98px
       —— 抬不动（实测抬到上限仍压住 1/2/15）。压扁把 [cy-ry, cy+ry] 映射到
       [cy-ry, cy+0.1ry]，上沿不动、下沿抬 0.9·ry（≈3 格），一次就够且永不越界。 */
  const PANEL_MODAL_MAX_H = 560;   /* 与 CSS 的 @media (max-height:560px) 同口径 */

  /* 矮屏 ⇒ 走模态抽屉档（用视口高度判定，与 CSS 断点同一口径） */
  function panelIsModal() {
    try { return (global.innerHeight || 900) <= PANEL_MODAL_MAX_H; } catch (_) { return false; }
  }

  /* 座圈纵向压缩比：面板展开且非模态时压扁，其余原样 */
  function seatSquash() {
    return (panelOpen && !panelIsModal()) ? 0.55 : 1;
  }
  /* 按"锚定上沿"的方式压扁一个座圈 y（格） */
  function squashSeatY(S, y) {
    const k = seatSquash();
    if (k === 1) return y;
    const s = (S.room('bridge') || {}).seats;
    if (!s) return y;
    const top = s.cy - s.ry;
    return top + (y - top) * k;
  }
  function crewHtml(g, V, S) {
    const players = (V && V.players) || [];
    /* 走动中 = 沿折线走 或 键盘正在按方向键（两种都要腿动起来） */
    const walking = !!walkState || keyMoving();
    let html = '<g class="sk-crew-layer' + (walking ? ' sk-walking' : '') + '">';

    /* 〔批 RTA-0 / R1 · 2026-10-28〕**全员渲染，但只画"看得见"的人**。
       -------------------------------------------------------------
       用户原话：「信息并不能看到全船，只能看到以自身为中心的一个小圈」+
       「消除掉玩家消失系统」「枪击和目击不可以跨墙」。

       旧口径（批 SHIP）是**只画我**：整船图里出现别人 = 把"谁在哪"白送。
       新口径不改这条**意图**，只改实现：**看不见的人不进 DOM**，
       判据 = 距我 ≤ VISION_R（9 格）∩ 两人之间无墙（`SKShip.losClear`）。

       为什么把判据放在数据层：视线与可行走面共用同一份几何（房间内缩 + 通道带），
       渲染器自己再写一套 raycast 必然出现"能走过去但看不见"这种不一致。
       为什么看不见的人**不生成节点**而不是 display:none：
       否则 F12 一开就能读 DOM 里 15 个人的坐标 —— 那是另一种"白送"。 */
    const me = players.filter(p => p.id === V.humanId)[0];
    if (!me) { return html + '</g>'; }

    /* 位置：船体格 → 像素。走动中由 walkState 决定（paintWalk 每帧改 transform），
       静止时落在房间锚点（舰桥座位 / 宿舍舱位 / 其他房间中央）。 */
    const pos = myPos();

    /* 〔批 UI-7〕角色尺寸按**帧内实际内容**算，不按 96×160 的帧框算 —— 见 CREW_BOX。 */
    const w = CREW_BOX.w(), h = CREW_BOX.h();
    const vbIdle = CREW_W + ' ' + (CREW_H * ROW_IDLE) + ' ' + CREW_W + ' ' + CREW_H;

    /* 一个角色节点的 HTML（我 / 别人 共用；只是光环色、class 与编号不同） */
    function oneCrewHtml(p, at, isMe) {
      const ring = isMe ? MINE : PALETTE[(p.id - 1) % PALETTE.length];
      const file = CREW_FILE(p.id);
      return '<g class="sk-crew' + (isMe ? ' sk-mine' : ' sk-other') + (p.out ? ' sk-out' : '')
        + '" data-seat="' + p.id + '" transform="translate(' + (at.x * TILE).toFixed(1) + ','
        + (at.y * TILE + TILE * 0.34).toFixed(1) + ')">'
        + '<g class="sk-enter">'
        + '<ellipse cx="0" cy="0" rx="' + (TILE * 0.42) + '" ry="' + (TILE * 0.17)
        + '" fill="' + ring + '" opacity="0.35"/>'
        + '<svg class="sk-frame" x="' + (-w / 2).toFixed(1) + '" y="' + (-h * 0.62).toFixed(1)
        + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1)
        + '" viewBox="' + vbIdle + '" overflow="hidden" preserveAspectRatio="xMidYMax meet">'
        + '<g class="sk-frames">'
        + '<image href="assets/scene/crew/' + file + '.png" x="0" y="0" width="'
        + (CREW_W * 4) + '" height="' + (CREW_H * 5) + '" image-rendering="pixelated"/>'
        + '</g></svg>'
        + '<text class="sk-crew-n" x="0" y="' + (TILE * 0.62).toFixed(1)
        + '" text-anchor="middle">' + p.id + '</text>'
        + '</g></g>';
    }

    /* 我自己：永远画（否则玩家找不到自己） */
    html += oneCrewHtml(me, pos, true);

    /* 其他人：只画视野内且无墙遮挡的。顺序即玩家序号，保证 DOM 稳定（关掉重开不乱跳）。 */
    const M2 = shipOf();
    for (let k = 0; k < players.length; k++) {
      const p = players[k];
      if (!p || p.id === V.humanId) continue;
      const at = crewPos(p.id);
      if (!inSight(pos, at, M2)) continue;   /* 看不见 ⇒ 不生成节点（不是 display:none） */
      html += oneCrewHtml(p, at, false);
    }

    html += '</g>';
    return html;
  }

  /* ---- 〔批 R1〕视野：半径 ∩ 不跨墙 --------------------------------------
     `inSight` 是渲染层唯一的可见性判据；将来 AI 的"目击"必须调**同一个**函数
     （否则玩家和 AI 的视野不一致，等于一方作弊）。 */
  function inSight(from, to, M) {
    if (!from || !to) return false;
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    if (d > VISION_R) return false;
    if (!M || typeof M.losClear !== 'function') return true;   /* 数据层未加载时退化为"只判距离" */
    return M.losClear(from, to);
  }

  /* ---- 〔批 R1〕别人站在哪 -------------------------------------------------
     现在 AI 还没有空间状态（那是 R3），所以默认所有人**集合在舰桥各自席位**；
     R3 起由 AI 每帧写入真实坐标（`SKScene.setCrewPos`），渲染层不改。 */
  const CREW_POS = {};
  function crewPos(id) {
    if (CREW_POS[id]) return CREW_POS[id];
    const S2 = global.SKSpace;
    if (!S2) return { x: 0, y: 0 };
    const o = roomOrigin(S2, 'bridge');
    const seats = S2.seatPositions ? S2.seatPositions('bridge') : [];
    const st = seats[(id - 1) % (seats.length || 1)];
    return st ? { x: o.x + st.x, y: o.y + st.y } : { x: o.x + 15, y: o.y + 5.5 };
  }
  function setCrewPos(id, at) {
    if (id == null) return;
    if (at == null) { delete CREW_POS[id]; return; }
    CREW_POS[id] = { x: at.x, y: at.y };
    sig = null;   /* 位置变了 ⇒ 下一次 render 要重建（别人没有逐帧 paint 通道） */
  }

  /* =============================================================
   * 〔批 RTA-0 / R3 · 2026-10-28〕别人的闲逛与**逐帧绘制**
   * -------------------------------------------------------------
   * 用户原话：「他们闲置的时候不再待在宿舍或静默，也会进行行动」。
   *
   * 这一批只做**表现层**的行走：引擎侧还没有 AI 空间状态（那要连 witness/decide 一起改），
   * 所以这里给每个非我角色一个"闲逛计划"——随机挑一个可站的点，沿 walkPath 走过去，
   * 停 1~3 秒，再挑下一个。它**不进存档、不影响规则**（纯视图，行为指纹不变）。
   *
   * 三条不变量：
   *   · **逐帧只改 transform**（paintCrew）：每帧重建整船 DOM 会掉到个位数帧率；
   *   · **只有"进出视野"才重建**（sig = null）：那才需要增删节点；
   *   · **不在对局页就停**（sceneLive 为假时不跑）—— 主页/结算页不该有人在动。
   * ============================================================= */
  const WANDER = {};        /* id → { pts, t, len, wait } */
  let wanderRaf = 0, wanderPrev = 0, wanderRepaintAt = 0;

  /* 挑一个"看起来合理"的落脚点：随机房间里的随机点（走不到就退回房间中心） */
  function pickWanderDest() {
    const M = shipOf();
    if (!M || !M.ids || !M.ids().length) return null;
    const ids = M.ids();
    const room = ids[Math.floor(Math.random() * ids.length)];
    const r = M.roomRect(room);
    if (!r) return null;
    for (let k = 0; k < 20; k++) {
      const x = r.x + 2 + Math.random() * (r.w - 4);
      const y = r.y + 3 + Math.random() * (r.h - 4.5);
      if (M.walkable(x, y)) return { x: x, y: y };
    }
    return M.roomCenter(room);
  }

  /* 逐帧只改 transform（+ 行走帧），不碰 DOM 结构 */
  function paintCrew(id, pos, walking, dir) {
    const mount = el('scene-mount');
    const svg = mount && mount.querySelector ? mount.querySelector('svg.sk-scene') : null;
    if (!svg) return;
    const g = svg.querySelector('.sk-crew[data-seat="' + id + '"]');
    if (!g) return;   /* 不在 DOM 里 = 此刻看不见，正常 */
    g.setAttribute('transform', 'translate(' + (pos.x * TILE).toFixed(1) + ','
      + (pos.y * TILE + TILE * 0.34).toFixed(1) + ')');
    setCrewFrame(g, dir || 'down', !!walking);
  }

  /* 一人一步：沿当前折线前进；走完就等一会儿再挑新目标 */
  function stepOneCrew(id, dt) {
    const M = shipOf();
    if (!M) return;
    let w = WANDER[id];
    if (!w || !w.pts) {
      const from = crewPos(id);
      const to = pickWanderDest();
      if (!to) return;
      const p = M.walkPath(from, to);
      w = WANDER[id] = p && p.pts && p.pts.length > 1
        ? { pts: p.pts, t: 0, len: p.len, wait: 0 }
        : { pts: null, wait: 1 + Math.random() * 2 };
    }
    if (w.wait > 0) {
      w.wait -= dt;
      if (w.wait <= 0) WANDER[id] = null;   /* 休息完，下次循环重新挑目标 */
      return;
    }
    const need = w.len > 0 ? w.len / WALK_SPEED : 0;
    w.t = need > 0 ? Math.min(1, w.t + dt / need) : 1;
    const pos = pointOnPath(w.pts, w.t);
    const dir = dirOnPath(w.pts, w.t);
    const before = crewPos(id);
    const visBefore = inSight(myPos(), before, M);
    setCrewPosRaw(id, pos);
    const visAfter = inSight(myPos(), pos, M);
    paintCrew(id, pos, true, dir);
    /* 只有"进出视野"才需要重建 DOM（增删节点）；同视野内移动一律逐帧改 transform */
    if (visBefore !== visAfter) {
      sig = null;
      const now2 = now();
      if (now2 - wanderRepaintAt > 400) {
        wanderRepaintAt = now2;
        if (lastG && lastV) render(lastG, lastV);
      }
    }
    if (w.t >= 1) { w.pts = null; w.t = 0; w.wait = 1 + Math.random() * 2; WANDER[id] = w; }
  }

  /* 只写坐标、不置 sig（逐帧用；置 sig 会让每次移动都重建整船 DOM） */
  function setCrewPosRaw(id, at) {
    if (id == null || !at) return;
    CREW_POS[id] = { x: at.x, y: at.y };
  }

  function startWander() {
    if (wanderRaf || !global.requestAnimationFrame) return;
    wanderPrev = now();
    const loop = function () {
      wanderRaf = 0;
      if (!sceneLive()) { wanderRaf = global.requestAnimationFrame(loop); return; }
      const t = now();
      const dt = Math.max(0, Math.min(0.1, (t - wanderPrev) / 1000));
      wanderPrev = t;
      const V = lastV;
      const ids = (V && V.players) ? V.players.map(p => p.id) : [];
      for (let i = 0; i < ids.length; i++) {
        if (ids[i] === V.humanId) continue;
        stepOneCrew(ids[i], dt);
      }
      wanderRaf = global.requestAnimationFrame(loop);
    };
    wanderRaf = global.requestAnimationFrame(loop);
  }
  function stopWander() {
    if (wanderRaf && global.cancelAnimationFrame) { try { global.cancelAnimationFrame(wanderRaf); } catch (_) {} }
    wanderRaf = 0;
  }

  /* =============================================================
   * 〔批 SHIP · 2026-10-27〕小地图（左上角）
   * -------------------------------------------------------------
   * 用户原话：「小地图上会显示整张地图的布局」。
   *
   * 它是**唯一能看到全船**的地方，所以必须画全 9 间房 + 8 条通道；
   * 屏幕上那层（主视图）只显示相机视窗内的一小块近景。
   *
   * 画法：ship-map 的 mapProjection 把 234×45 格等比塞进固定像素框，
   *   房间 = 描边矩形（当前房间高亮），通道 = 细线，
   *   我 = 一个亮点，视野框 = 相机矩形（让玩家知道"我看到的范围有多大"）。
   * 它**不显示别人**（与主视图同一条口径：只看到自己）。
   * ============================================================= */
  /* 〔批 M2 · 2026-10-28〕小地图比例跟着船体走：126:108 ≈ 1.167 ⇒ 112×96（不留左右黑边）。
     旧值 216×64 是为 234:45 的横长条定死的 —— 米字布局下会左右大片留白。 */
  const MAP_W = 112, MAP_H = 96;   /* 像素；近方形，与船体 126:108 的比例一致 */

  /* =============================================================
   * 〔批 RTA-0 / R4-lite · 2026-10-28〕相位倒计时 HUD
   * -------------------------------------------------------------
   * 用户拍板：夜 90s / 昼讨论 60s / tick 0.25s（见 js/engine/clock.js）。
   * 这一版先把**时钟显示**接上：换相位就重开一个 SKClock 相位，每 250ms 刷新文本。
   * 【为什么先只做显示】引擎侧"到点自动推进"要改 steps.js 的派发（R4 主线），
   *   在那之前先把"还剩多久"摆到玩家眼前，规则仍按旧步骤走 —— 不会出现
   *   "界面说还剩 3 秒、引擎却在等你决策"这种自相矛盾。
   * ============================================================= */
  let PHASE_CLOCK = null;

  function clockOf(g) {
    const C = global.SKClock;
    if (!C) return null;
    const nowMs = now();
    if (!PHASE_CLOCK || PHASE_CLOCK.phase !== g.phase) {
      PHASE_CLOCK = C.newPhase(g.phase === 'night' ? 'night' : 'day', nowMs);
    }
    return PHASE_CLOCK;
  }

  function clockHtml(g) {
    const C = global.SKClock;
    const st = C ? clockOf(g) : null;
    if (!st) return '';
    return '<div class="sk-clock" aria-label="相位剩余时间"><b>'
      + (st.phase === 'night' ? '夜' : '昼') + '</b><span>'
      + C.fmt(C.remaining(st, now())) + '</span></div>';
  }

  /* 只改文本，不重建 DOM（每帧重建会打断角色动画） */
  let clockTimer = 0;
  function startClock() {
    if (clockTimer || !global.setInterval) return;
    clockTimer = global.setInterval(function () {
      const mount = el('scene-mount');
      const box = mount && mount.querySelector ? mount.querySelector('.sk-clock span') : null;
      if (!box || !lastG) return;
      const C = global.SKClock;
      if (!C) return;
      const st = clockOf(lastG);
      const txt = C.fmt(C.remaining(st, now()));
      if (box.textContent !== txt) box.textContent = txt;
    }, 250);
  }

  function minimapHtml(M) {
    const P = M.mapProjection(MAP_W, MAP_H, 3);
    const me = myPos();
    const cam = cameraNow();
    let html = '<div class="sk-minimap" role="img" aria-label="整船小地图">';
    html += '<svg viewBox="0 0 ' + MAP_W + ' ' + MAP_H + '" preserveAspectRatio="xMidYMid meet">';
    /* 通道 */
    for (const L of M.LINKS) {
      const a = M.doorPoint(L.a, L.sa), b = M.doorPoint(L.b, L.sb);
      const A = P.toMap(a.x, a.y), B = P.toMap(b.x, b.y);
      html += '<line class="sk-mm-link" x1="' + A.x.toFixed(1) + '" y1="' + A.y.toFixed(1)
        + '" x2="' + B.x.toFixed(1) + '" y2="' + B.y.toFixed(1) + '"/>';
    }
    /* 房间 */
    for (const id of M.ids()) {
      const r = M.roomRect(id);
      const A = P.toMap(r.x, r.y);
      const w = r.w * P.s, h = r.h * P.s;
      const cur = id === curRoom ? ' sk-mm-here' : '';
      html += '<rect class="sk-mm-room' + cur + '" x="' + A.x.toFixed(1) + '" y="' + A.y.toFixed(1)
        + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1"/>';
    }
    /* 视野框：让玩家看懂"屏幕上只显示这一小块" */
    const V = P.toMap(cam.x, cam.y);
    html += '<rect class="sk-mm-view" x="' + V.x.toFixed(1) + '" y="' + V.y.toFixed(1)
      + '" width="' + (cam.w * P.s).toFixed(1) + '" height="' + (cam.h * P.s).toFixed(1) + '"/>';
    /* 我 */
    const MP = P.toMap(me.x, me.y);
    html += '<circle class="sk-mm-me" cx="' + MP.x.toFixed(1) + '" cy="' + MP.y.toFixed(1) + '" r="2.6"/>';
    html += '</svg>';
    /* 房名：小地图太小放不下 9 个中文标签，改成"我在哪"一行 */
    const S = global.SKSpace;
    const nm = (S && S.room(curRoom) && S.room(curRoom).name) || curRoom;
    html += '<b class="sk-mm-name">' + escAttr(nm) + '</b>';
    html += '</div>';
    return html;
  }

  /* 走动时只更新小地图上的三个点（不重建整张小地图） */
  function paintMinimap(mount, cam, pos) {
    const M = shipOf();
    if (!M || !mount) return;
    const box = mount.querySelector('.sk-minimap');
    if (!box) return;
    const P = M.mapProjection(MAP_W, MAP_H, 3);
    const me = P.toMap(pos.x, pos.y);
    const dot = box.querySelector('.sk-mm-me');
    if (dot) { dot.setAttribute('cx', me.x.toFixed(1)); dot.setAttribute('cy', me.y.toFixed(1)); }
    const v = P.toMap(cam.x, cam.y);
    const vb = box.querySelector('.sk-mm-view');
    if (vb) {
      vb.setAttribute('x', v.x.toFixed(1)); vb.setAttribute('y', v.y.toFixed(1));
      vb.setAttribute('width', (cam.w * P.s).toFixed(1));
      vb.setAttribute('height', (cam.h * P.s).toFixed(1));
    }
    /* 当前房间高亮跟着人走 */
    const room = M.roomAt(pos.x, pos.y);
    if (room) {
      const rects = box.querySelectorAll('.sk-mm-room');
      const ids = M.ids();
      for (let i = 0; i < rects.length && i < ids.length; i++) {
        rects[i].classList.toggle('sk-mm-here', ids[i] === room);
      }
    }
    /* 〔批 WALK〕房名那一行也跟着走：键盘跨进另一间房时若等重绘，房名会停在上一间 */
    const nmEl = box.querySelector('.sk-mm-name');
    if (nmEl) {
      const S = global.SKSpace;
      const here = room || curRoom;
      const nm = (S && S.room(here) && S.room(here).name) || here;
      if (nmEl.textContent !== nm) nmEl.textContent = nm;
    }
  }

  /* =============================================================
   * 〔批 UI-5 · 2026-10-26〕席位的**真实绘制矩形**（屏幕坐标）
   * -------------------------------------------------------------
   * 为什么不直接 getBoundingClientRect()：嵌套 <svg> 的包围盒包含整张
   * 384×800 行走图（实测 124×258px，而实际画出来只有 57×95px），
   * 拿它做遮挡判定会把「纸上其实什么都没有」的地方判成压住人。
   * 这是交接文档 §3.2 记过的坑，本批又踩了一次（第一版书记官记录板因此被
   * 挤到屏幕角落）。
   *
   * 做法：读 <g class="sk-crew"> 的 transform（用户空间里的落点），
   * 再用 svg.getScreenCTM() 映射到屏幕坐标，按 crewHtml 里 sk-frame 的
   * x/y/width/height 还原那个矩形。与渲染代码逐项一致，不另写一份几何。
   *
   * 〔批 UI-7 · 2026-10-27〕再加一条：**返回的是可见内容矩形，不是帧框**。
   *   帧框 96×160 里有 30% 是透明的（见 CREW_VIS_*）。UI-6 的教训是
   *   "包围盒不是绘制范围"——当时踩的是外层 <g> 的包围盒（含整张 384×800），
   *   这次踩的是**帧框本身**：帧框已经比包围盒准了，但仍比角色实际画出来的
   *   区域大一圈。纸的避让判定用它 ⇒ 会把"纸上其实什么都没有"的地方判成压住人。
   *   所以按 CREW_VIS_W / CREW_VIS_H 把帧框收成内容矩形。
   *
   *   尺寸必须走 CREW_BOX（与 crewHtml 同一份），不许在这里再写一次 TILE*0.92——
   *     那正是本次两个数对不上的原因。
   * ============================================================= */
  function seatRects() {
    const mount = el('scene-mount');
    if (!mount) return [];
    const svg = mount.querySelector('svg.sk-scene');
    if (!svg || typeof svg.getScreenCTM !== 'function') return [];
    const ctm = svg.getScreenCTM();
    if (!ctm) return [];
    const w = CREW_BOX.w(), h = CREW_BOX.h();
    /* 内容在帧内的相对位置（0..1）：由实测 bbox 得出，与 CREW_VIS_* 同源 */
    const fx0 = 20 / CREW_W, fx1 = 79 / CREW_W;
    const fy0 = 48 / CREW_H, fy1 = 1;
    const out = [];
    const gs = mount.querySelectorAll('[data-seat]');
    for (const g of gs) {
      const m = /translate\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/.exec(g.getAttribute('transform') || '');
      if (!m) continue;
      const px = +m[1], py = +m[2];
      /* 帧框：与 crewHtml 的 <svg class="sk-frame" x=-w/2 y=-h*0.62 width=w height=h> 完全一致 */
      const bx = px - w / 2, by = py - h * 0.62;
      const x0 = bx + fx0 * w, x1 = bx + fx1 * w;
      const y0 = by + fy0 * h, y1 = by + fy1 * h;
      const L = x0 * ctm.a + ctm.e, T = y0 * ctm.d + ctm.f;
      const R = x1 * ctm.a + ctm.e, B = y1 * ctm.d + ctm.f;
      out.push({ seat: +g.getAttribute('data-seat'), left: L, top: T, right: R, bottom: B, width: R - L, height: B - T });
    }
    return out;
  }

  /* =============================================================
   * 〔批 UI-5 · 2026-10-26〕书记官记录板归位
   * -------------------------------------------------------------
   * 顶部 HUD 删除后，阶段名 / 倒计时 / 净破坏 / 决策窗口落在**桌子中央的纸**上。
   * 那张纸是 #clerk（#scene-mount 的兄弟节点，见 index.html），这里负责把它摆好。
   *
   * 摆放规则（一条，按优先级）：
   *   ① 首选圆桌正中（用户要的「桌子中央书记官记录」）；
   *   ② 若纸比桌面大（矮横屏 / 小屏，桌面只有 100 多像素），硬居中会压住 1/2/15 号
   *      席位 —— 玩家点不到人。此时在**一组候选位置**里挑「压席位最少、离桌子最近」
   *      的那个：桌心上下左右、场景四角、场景上/下居中。
   *      实测四档视口：桌面档仍落在桌心；844×390 落到场景左上角（那里是空地）。
   *   ③ 全都会压住时，取压得最少的那个 —— 宁可少压一个，也不要压在正中间。
   *
   * 非舰桥房间没有圆桌：锚点改地板，纸落在房间中央偏上。
   * ============================================================= */
  /* =============================================================
   * 〔批 SHIP · 2026-10-27〕书记官记录板：整船图下的定位重写
   * -------------------------------------------------------------
   * 旧规则是"钉在圆桌正中"—— 那是"一次只画一间房"时代的口径：
   * 舰桥铺满整块画布，桌心就在屏幕正中，纸钉上去正好。
   *
   * 整船图之后舰桥只是船体上的一块（234 格里的 30 格），相机还跟着人走，
   * 于是"桌心"可能根本不在视窗里 —— 实测截图上纸被夹到画面右边缘、
   * 半个身子压在墙外（那张图就是本批最直接的证据）。
   *
   * 新规则（按优先级，全部以**屏幕像素**为准）：
   *   ① 纸是**固定信息面**，不是场景装饰 ⇒ 优先钉在场景左上角（小地图右侧）；
   *   ② 若左上角会压住「我」（seatRects 的真实绘制矩形）或行动面板/输入框，
   *      就依次试：右上、左下、右下、上中；
   *   ③ 仍然全压时取压得最少的那个 —— 宁可压一点点，也不要跑到画面外。
   *
   * 为什么不再跟桌子走：整船图里"桌子"已经不是画面的主体，
   * 玩家要看的是**我在船的哪一段**。纸跟着桌子跑会在每次换房间时跳一下，
   * 读作"界面在抖"。固定在一个角落反而是稳定的。
   * ============================================================= */
  function layoutClerk() {
    const mount = el('scene-mount');
    const paper = el('clerk');
    if (!mount || !paper) return;
    const svg = mount.querySelector('svg.sk-scene');
    /* 【注意】取不到场景时**不要 .add('hidden')**：ResizeObserver 会在切屏（#screen-game
       被隐藏 → 尺寸归零）时触发一次，隐藏是粘性的 —— 回到对局后纸就再也不出现
       （实测：移动端门禁在 844×390 直接判成"未挂载"）。留着上一次的位置即可。 */
    if (!svg) return;
    const sb = mount.getBoundingClientRect();
    if (!sb.width) return;
    paper.classList.remove('hidden');
    /* 坐标系：纸是 #screen-game 的绝对定位子节点（不是 #scene-mount 的子节点），
       所以 left/top 必须相对**它的 offsetParent** 算，而不是相对场景挂载点。 */
    const host = paper.offsetParent || mount;
    const hb = host.getBoundingClientRect();
    /* 纸宽：整船图里不再由桌面宽度决定（桌面可能不在视窗内）。
       取场景宽的 26%，夹在 190~300px —— 再窄「倒计时 24.0」会折行，
       再宽会挡住小地图或角色。 */
    const w = Math.max(190, Math.min(300, sb.width * 0.26));
    paper.style.width = Math.round(w) + 'px';
    const ph = paper.offsetHeight || 96;

    const m = 10;
    const rel = (x, y) => ({ left: x - hb.left, top: y - hb.top });
    /* 左上角要让开小地图（它在 left:10 / top:10，宽 216 或矮屏 132） */
    const mm = mount.querySelector('.sk-minimap');
    const mmb = mm ? mm.getBoundingClientRect() : null;
    const reserveTop = mmb ? Math.max(m, mmb.bottom - sb.top + 8) : m;
    const cands = [
      rel(sb.left + m, sb.top + reserveTop),                        /* ① 左上（小地图下方） */
      rel(sb.right - w - m, sb.top + m),                            /* ② 右上 */
      rel(sb.left + m, sb.bottom - ph - m),                         /* ③ 左下 */
      rel(sb.right - w - m, sb.bottom - ph - m),                    /* ④ 右下 */
      rel(sb.left + (sb.width - w) / 2, sb.top + m),                /* ⑤ 上中 */
      rel(sb.left + (sb.width - w) / 2, sb.bottom - ph - m),        /* ⑥ 下中 */
    ];

    /* ---- 逐个量：压住几个「我」的真实绘制矩形 + 是否压住提交路径 ---- */
    const rects = seatRects();
    const hitSel = ['#region-dec', '#talkbar'];
    const overlapAt = (pos) => {
      const L = hb.left + pos.left, T = hb.top + pos.top;
      const R = L + w, B = T + ph;
      let n = 0;
      for (const r of rects) {
        if (r.left < R && L < r.right && r.top < B && T < r.bottom) n += 2;   /* 压人比压面板更糟 */
      }
      for (const sel of hitSel) {
        const e = mount.parentNode && mount.parentNode.querySelector
          ? (global.document && global.document.querySelector(sel)) : null;
        if (!e) continue;
        const cs = global.getComputedStyle ? global.getComputedStyle(e) : null;
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) continue;
        const r = e.getBoundingClientRect();
        if (!r.width) continue;
        if (r.left < R && L < r.right && r.top < B && T < r.bottom) n += 1;
      }
      return n;
    };
    let best = cands[0], bestN = overlapAt(best);
    for (const c of cands) {
      if (c === best) continue;
      const n = overlapAt(c);
      if (n < bestN) { best = c; bestN = n; }
      if (bestN === 0) break;
    }
    /* 最后一道夹紧：任何候选都不许把纸推出场景。 */
    const minL = sb.left - hb.left + m, maxL = sb.right - hb.left - w - m;
    const minT = sb.top - hb.top + m, maxT = sb.bottom - hb.top - ph - m;
    const left = Math.min(Math.max(best.left, minL), Math.max(minL, maxL));
    const top = Math.min(Math.max(best.top, minT), Math.max(minT, maxT));
    paper.style.left = Math.round(left) + 'px';
    paper.style.top = Math.round(top) + 'px';
  }

  /* 〔批 UI-5〕场景尺寸变化（行动面板展开 / 输入框浮出 / 窗口缩放）后，纸要重新归位。
     用 ResizeObserver 而不是"每次 render 都算一遍"：render 不在布局变化时触发，
     而纸的位置依赖场景的**像素**尺寸。没有 ResizeObserver 的环境（老浏览器 / vm 沙盒）
     静默跳过 —— 此时纸停在最后一次显式布局的位置，不会崩。 */
  let roBound = false;
  function observeScene(mount) {
    if (roBound || !mount || typeof global.ResizeObserver !== 'function') return;
    roBound = true;
    try {
      const ro = new global.ResizeObserver(function () { layoutClerk(); });
      ro.observe(mount);
      global.__skClerkRO = ro;
    } catch (_) { roBound = false; }
  }

  /* 渲染入口（接口与旧版一致：render(g, V)） */
  let sig = null, lastG = null, lastV = null, lastMount = null, lastPhaseKey = null;
  /* 〔批 WALK〕上一帧的昼夜（首次渲染为 null ⇒ 不触发"换昼夜清落点"） */
  let phaseSeen = null;
  /* 〔批 UI-5〕上一次「按待决策自动跳房间」去过的房间：只在 kind 变化时跳一次，
     否则玩家一点门就被拽回去（那会让人以为门坏了）。 */
  let lastAutoRoom = null;
  /* 〔批 UI-6〕行动面板是否展开 —— 决定座圈压扁与模态态（见 seatSquash / panelIsModal） */
  let panelOpen = false;
  /* 面板展开时给场景容器加类：模态档（矮屏）下 CSS 用它压暗场景，
     非模态档只是状态标记（座圈压扁由 squashSeatY 直接算，不依赖 CSS）。 */
  function mountPanelUp(v) {
    const m = el('scene-mount');
    if (!m) return;
    m.classList.toggle('panel-up', !!v);
    m.classList.toggle('panel-modal', !!v && panelIsModal());
  }
  function setPanelOpen(v) {
    const nv = !!v;
    if (nv === panelOpen) return;
    panelOpen = nv;
    mountPanelUp(nv);
    /* 〔批 SHIP-2〕面板高度会随决策种类变化（投票 15 个目标 vs 只点一个按钮），
       相机要让位就必须**先量**面板顶边。量不到时 panelAnchorY 退回常量 0.34。 */
    measurePanelTop();
    /* 座圈位置变了（压扁 / 还原），必须重建场景。
       不需要"先量后算"的两趟渲染 —— 压扁比是常量，不依赖量测结果。 */
    sig = null;
    if (lastG && lastV) render(lastG, lastV);
  }

  function render(g, V) {
    if (!g || !V || !V.players) return;
    const S = global.SKSpace;
    if (!S) return;
    const mount = el('scene-mount');
    if (!mount) return;

    /* 〔批 SHIP-2〕先量面板，再算相机。
       面板高度随决策种类变化（投票 15 目标 ≈ 400px，只点一个按钮 ≈ 210px），
       相机让位的量必须跟着它走，否则"矮面板"那一档会被抬得过头（房间上半截出屏）。 */
    measurePanelTop();

    const key = [V.humanId, g.phase, curRoom,
      V.players.map(p => (p.out ? 1 : 0)).join(''),
      g.pending && !g.pending.stream ? (g.pending.kind || '') : '',
      panelOpen ? 'P1' : 'P0'].join('|');
    /* 〔批 UI-8b · 2026-10-27〕什么时候才该"走"？
       -------------------------------------------------------------
       用户原话：「每次决策的时候，小人都会突然冒出来，然后站住 15 个座位，
       然后下一步决策的时候又突然冒出来站住 15 个座位……没有轮到这名玩家决策的时候，
       其他玩家都是不动的，不需要新决策就刷新一遍新帧」。

       旧逻辑把 `pending.kind` 也算进"阶段"，于是 **每换一个决策就重播一次入场动画**：
       15 个人凭空出现在门口，再滑回座位 —— 那就是"突然冒出来"。
       但换决策**不是移动**。真正算移动的只有两种：
         ① 房间变了（我走了门 / 被自动带去该做事的房间）
         ② 昼夜阶段变了（白天回圆桌 / 夜里回睡眠舱）
       所以这里把 kind 从判据里**拿掉**，只留 phase 与房间。 */
    /* 顺序很重要：**先**决定"这一步要去哪"，**再**比较 phaseKey。
       -------------------------------------------------------------
       第一版把 phaseKey 算在自动跳房之前，于是"被带去另一个房间"这件事
       永远体现在**下一次** render 上；而这一步的 walkUntil 是旧的（可能是 0）——
       实测：换决策后 15 个角色瞬间跳到新座位、一帧动画都没有（"凭空出现"）。
       现在先解析目标房间并落定 curRoom，再拿它组 phaseKey。 */

    /* 〔批 UI-5 · 2026-10-26〕待决策时自动回到「该做这件事的房间」。
       用户要的是"交互跟着物件走"：轮到我私聊，就该在舰桥的通讯台前，而不是
       上一步停在制药室里对着空气点。

       〔批 SHIP · 2026-10-27〕【本批要点】这里**不再直接改 curRoom**，改成沿通道走过去。
       -------------------------------------------------------------
       整船图里"换房间"是一次可见的移动（用户拍板「点目标自动寻路」），
       直接改 curRoom 会让人凭空出现在另一间房 —— 那正是批 UI-8b 修掉的
       "突然冒出来"，只是换了个触发点。

       所以：需要换房且当前没在走 ⇒ 启动走动，**这一帧先不重建 DOM**
       （走动中重建会把角色拍回起点），走完由 startWalkAnim 的收尾自己 render。
       【注意】必须在启动走动前把 lastG/lastV 落定：走动收尾的 render(lastG,lastV)
         要读它们，否则第一次渲染就换房时收尾拿到 null，画面会停在半路。
       【注意】没有 rAF 的环境（vm 沙盒 / 门禁）仍走"直接落定"这条老路，
         否则门禁里永远等不到收尾，curRoom 就一直是旧的。 */
    /* 〔批 WALK · 2026-10-28〕昼夜一变，站位回锚点（白天圆桌 / 夜里睡眠舱）。
       -------------------------------------------------------------
       freePos 是"玩家自己走出来的落点"。若跨昼夜还留着，夜里人会站在白天的座位旁，
       而引擎侧此刻正是"回舱睡觉"的语义 —— 所以昼夜切换时清空它，让 anchorInRoom 接手。
       这也是本批唯一允许"人自己动位置"的地方：只在昼夜切换这一条路径上，
       且是既有语义（批 UI-8b 的"白天回圆桌 / 夜里回睡眠舱"）的延续，不是新增搬运动作。 */
    if (phaseSeen !== null && phaseSeen !== g.phase) {
      freePos = null;
      if (keyMoving()) { KEY_HELD.up = 0; KEY_HELD.down = 0; KEY_HELD.left = 0; KEY_HELD.right = 0; }
      if (freeRaf && global.cancelAnimationFrame) { try { global.cancelAnimationFrame(freeRaf); } catch (_) {} }
      freeRaf = 0;
      sig = null;
    }
    phaseSeen = g.phase;

    if (g.pending && !g.pending.stream && global.SKHudMap) {
      const want = global.SKHudMap.roomOf(g.pending.kind || '');
      /* 〔批 WALK〕玩家自己走过（freePos 非空）之后，**不再**被"带去做决策的房"。
         -------------------------------------------------------------
         自由行走的意义就是坐标由玩家决定；若每到一步决策就把人拽走，
         刚走到的位置立刻失效（而且是在玩家还在按方向键的时候被拽）。
         引导没有丢：该去的房间门会亮（updateInteractive 的 sk-lit）、
         书记官记录板上写着「去 X · 动作」、点那件物件仍然会自己走过去（walkToProp）。 */
      if (want && want !== curRoom && !freePos) {
        lastAutoRoom = want;
        if (global.requestAnimationFrame && !walkState) {
          lastG = g; lastV = V; lastMount = mount;
          walkTo(want);
          return;
        }
        curRoom = want;
        sig = null;
      }
    } else if (!g.pending) {
      lastAutoRoom = null;
    }

    /* 〔批 SHIP〕【本批要点】删掉了「phaseKey 变了就 walkTo」那条。
       -------------------------------------------------------------
       它是上一版（walkUntil 时间戳）的写法：换房/换昼夜就播一次入场动画。
       整船图里走动**自己**就是移动（walkTo 内部已经把 curRoom 落定在终点），
       再按 phaseKey 补一次会立刻触发第二次走动 ——
       实测症状：到达房间后 isWalking() 一直是 true，角色被拍回路径起点，
       相机也跟着跳一下（截图 03-arrived 里人站在房间中央、却在"走路"）。
       现在只保留 phaseKey 的记录，用于判断"昼夜变了要换站位"，
       那件事由下面的 myPos/anchorInRoom 直接算，不需要走动。 */
    lastPhaseKey = g.phase + '|' + curRoom;

    if (key !== sig || !mount.__skBuilt) {
      const M = shipOf();
      const cam = cameraNow();
      /* 〔批 SHIP〕画布 = 相机视窗。整船坐标是 234×45 格（13104×2520px），
         一次性全塞进 viewBox 会让角色只有几像素 —— 所以只框住视窗那一块。
         其余房间照样在 DOM 里（滚出视口即不绘制），点门/寻路都靠它们算几何。 */
      const vbStr = [cam.x * TILE, cam.y * TILE, cam.w * TILE, cam.h * TILE].join(' ');
      mount.innerHTML =
        '<svg class="sk-scene" viewBox="' + vbStr + '" preserveAspectRatio="xMidYMid meet">'
        + roomHtml(S) + propsHtml(S) + crewHtml(g, V, S) + '</svg>'
        + minimapHtml(M)
        + clockHtml(g)
        + '<div id="sk-room-stage" class="sk-room-stage" aria-label="房间"></div>';
      mount.__skBuilt = true;
      bind(mount);
      sig = key;
    }
    lastG = g; lastV = V; lastMount = mount;
    updateInteractive(g, V, mount);
    /* 〔批 SHIP-2〕相机**每次渲染都要重算并写回 viewBox**，不能只在重建 DOM 时写。
       -------------------------------------------------------------
       面板高度是渲染之后才定的（renderStage 填表单 → 面板变高），
       而 key 里只有 panelOpen 的开关，没有"面板多高"。
       于是"面板从 208px 变成 400px"时 key 不变 ⇒ 不重建 ⇒ viewBox 停在旧值
       ⇒ 人还是被盖住。实测算到过：同一间房里 6 帧中有 2 帧仍被压 38%~65%。
       相机只是改一个属性，代价可忽略；重建 DOM 才是贵的。 */
    applyCamera(mount);
    layoutClerk();
    observeScene(mount);
    /* 〔批 R3〕把"别人会走动"接上：只在有 rAF 且对局页可见时才跑 */
    startWander();
    startClock();   /* 〔批 R4-lite〕相位倒计时每 250ms 刷新文本 */
  }

  /* 把当前相机写进 viewBox（不动 DOM 结构） */
  function applyCamera(mount) {
    try {
      const m = mount || el('scene-mount');
      if (!m) return;
      const svg = m.querySelector('svg.sk-scene');
      if (!svg) return;
      const cam = cameraNow();
      svg.setAttribute('viewBox', [cam.x * TILE, cam.y * TILE, cam.w * TILE, cam.h * TILE].join(' '));
      /* 小地图上的"我"与视野框也要跟着（它们不随重建更新） */
      const M = shipOf();
      if (M) paintMinimap(m, cam, myPos());
    } catch (_) { /* 视图层异常不阻塞对局 */ }
  }

  /* ---- 交互：点门切房间；点道具/席位委托既有控件 ---- */
  function bind(mount) {
    /* 键盘只挂一次：重复挂会让一次按键被处理多遍（走路速度翻倍） */
    bindKeys();
    if (!mount.addEventListener || mount.__skBound) return;
    mount.__skBound = true;
    mount.addEventListener('click', function (e) {
      try {
        const t = e.target;
        if (!t || !t.closest) return;

        const door = t.closest('[data-door]');
        if (door) { goto(door.getAttribute('data-door')); return; }

        /* 〔批 DEMO · 2026-10-28〕**席位点击已拆除**：人物只是"会走动的身体"，
           点它 = 走过去（落到 ground 分支）。是谁、什么职业，一律从交互与机制里推 ——
           旧的 openPlayerPop（身份弹窗）与"帮 pending 选中并自动提交"都随全员技能重做退役。 */
        const hit = t.closest('[data-hit]');
        if (hit) {
          /* 〔批 R4-step1〕万物可交互，但**指纹决定是否生效**（见 capGate 的注释） */
          const key = hit.getAttribute('data-hit');
          if (!capGate(key, mount)) return;
          onPropClick(key, hit.getAttribute('data-label'), mount);
          return;
        }

        /* 〔U1〕旧笔记本道具已随场景退役；账本入口改由 HUD / 席位弹窗承担，
           这里保留 openLedger 的委托点，供将来在房间内加「日志终端」时接回。 */
        if (t.closest('[data-hit="ledger"]')) { if (global.UI && global.UI.openLedger) global.UI.openLedger(); }

        /* 〔批 WALK · 2026-10-28〕点空地 → 自由走过去。
           -------------------------------------------------------------
           必须排在门/席位/道具之后：那三类是既有交互，不能被"走路"抢走。
           落到这里说明点的是地板、廊面、墙或家具（家具只有本房带 data-hit，
           别房的家具不带 ⇒ 点它 = "走到那件家具旁边"，这也正是玩家想要的）。
           点到墙上/船体外时由 nearestWalkable 收敛到最近的可站位置。 */
        const pt = shipPointFromEvent(e, mount);
        if (pt) onGroundClick(pt, mount);
      } catch (_) { /* 交互层异常不外抛 */ }
    });
  }

  /* 切房间：**沿通道走过去**（不触发任何规则）。
     〔批 SHIP〕用户拍板「点目标房间 → 沿通道自动寻路」。所以这里不再直接改 curRoom：
     先算出折线，人沿线走，走完（walkState.t 到 1）才落定 curRoom 并重绘。
     走的过程中每帧调 paintWalk（角色 transform + 相机 viewBox + 小地图）。
     【注意】立刻把 curRoom 落定会在半路上把相机拽到终点 —— 那就是"瞬移"。
       所以 curRoom 只在**到达后**更新；走的过程中"我在哪间房"由 ship-map.roomAt 回答。 */
  function goto(roomId) {
    const S = global.SKSpace;
    const M = shipOf();
    if (!S || !S.room(roomId) || roomId === curRoom) return;
    /* 玩家手动走门后，别在同一步里再被"自动回房间"拽回去 */
    lastAutoRoom = roomId;
    if (!M || !global.requestAnimationFrame) {
      /* 没有 rAF 的环境（vm 沙盒 / 门禁）：直接落定，几何仍正确 */
      stopWalk(); curRoom = roomId; sig = null;
      if (lastG && lastV) render(lastG, lastV);
      else { const m = el('scene-mount'); if (m) m.__skBuilt = false; }
      layoutClerk();
      return;
    }
    const p = walkTo(roomId);
    if (!p) { curRoom = roomId; sig = null; if (lastG && lastV) render(lastG, lastV); return; }
    /* 到达后才重绘（重绘会重建 DOM，所以不能边走边重绘） */
    sig = null;
  }

  /* 走到某件物件前（点别的房间的物件 → 走过去）。
     与 goto 同一条路径，只是终点取物件的船体坐标而不是房间中心。 */
  function walkToProp(roomId, hitKey) {
    const S = global.SKSpace;
    const M = shipOf();
    if (!S || !M) return;
    const r = S.room(roomId);
    if (!r) return;
    let target = null;
    for (const p of r.props) {
      if (p.k === hitKey) {
        const d = S.PROP[p.t] || { w: 1, h: 1 };
        target = { x: M.roomRect(roomId).x + p.x + (p.w || d.w) / 2,
          y: M.roomRect(roomId).y + p.y + (p.h || d.h) / 2 };
        break;
      }
    }
    if (!target) { goto(roomId); return; }
    lastAutoRoom = roomId;
    if (!global.requestAnimationFrame) { stopWalk(); curRoom = roomId; sig = null; if (lastG && lastV) render(lastG, lastV); return; }
    walkTo(target);
    sig = null;
  }

  /* 需要补参数的行动（勾选目标后不能立即提交），沿用旧版判定 */
  const NEEDS_MORE = ['branch', 'disguise', 'craft', 'doctor', 'repair', 'crewRepair',
    'crewAction', 'morph', 'transfer', 'evolve', 'convert', 'awaken', 'suppress',
    'talk', 'chat', 'will', 'speech', 'xenoCheck', 'clean', 'meeting', 'inviteAccept'];

  /* 〔U2〕点道具 = 开始一次交互。
     白框（sk-focus）落在道具矩形上 —— 这是"交互已开始"的视觉锚点，
     而不是弹一个居中的方框对话框（用户明确排斥那种"雷霆方框"）。
     之后仍委托既有控件：能选就选，不能选就说明为什么。

     〔批 UI-5 · 2026-10-26〕顶栏删除后，道具成了**唯一入口**，所以要分三种情况：
       ① 这件道具正是「当前待决策」的那件（映射表说 kind → 本房本物件）：
          → 展开行动面板（#region-dec），白框落在物件上；
       ② 这件道具属于「本局该做、但现在不在这间房」的动作：→ 直接走过去（goto）；
       ③ 其余：说明现在为什么用不了（不假装成功）。
     判据全部来自 js/hud-map.js，渲染器里不再自己写"哪个 kind 在哪间房"。 */
  /* =============================================================
   * 〔批 RTA-0 / R4-step1 · 2026-10-28〕万物可交互，**指纹决定是否生效**
   * -------------------------------------------------------------
   * 设计哲学（纲要 §2.1）：任何玩家都能点任何物件、点了都有反馈；
   *   是否"真的生效"取决于该动作声明的权能指纹与本人角色的能力是否匹配。
   *
   * 两个必须守住的细节：
   *   ① **中性反馈**：绝不写"你没有权限" —— 那等于告诉旁人"我不是这个职业"（纲要 §2.2）；
   *   ② **判不了就放行**：`mechanism` / `base` 型能力（异形出刀、普通船员协助维修…）
   *      在声明层没有 grants 条目，场景层不许拦（拦了主玩法就死），交给引擎判。
   *      只有"该物件对应的动作**全部**是 grant 型、且本人一个都不具备"时才拒绝。
   */
  function myRole() {
    const V = lastV;
    if (!V || !V.players) return null;
    const me = V.players.filter(p => p.id === V.humanId)[0];
    return me ? (me.role || null) : null;
  }

  function capGate(hitKey, mount) {
    const A = global.SKActionMap, RD = global.SKRoleDecl;
    if (!A || !RD || !mount || !hitKey) return true;
    const list = A.all().filter(a => a.place && a.place.room === curRoom && a.place.prop === hitKey);
    if (!list.length) return true;                              /* 表里没登记 ⇒ 交引擎 */
    /* 声明层能判的两类："grant"（grants 数组）与 "charge"（额度键，例：crew 的 assistRepair）。
       mechanism / base 判不了（声明层没有对应条目）⇒ 交给引擎。 */
    const decisive = list.filter(a => A.CAPS[a.cap] === 'grant' || A.CAPS[a.cap] === 'charge');
    if (!decisive.length || decisive.length < list.length) return true;   /* 混着机制位 ⇒ 交引擎 */
    const role = myRole();
    if (!role) return true;
    const d = (RD.get ? RD.get(role) : null) || {};
    const ch = d.charges || {};
    if (decisive.some(a => RD.hasGrant(role, a.cap) || ch[a.cap] != null)) return true;
    toast(mount, '设备没有响应');   /* 中性：不提权限、不提身份 */
    return false;
  }

  function onPropClick(key, label, mount) {
    const g = global.Game && global.Game.g;
    if (!g) return;
    const H = global.SKHudMap;
    const myTurn = !!(g.pending && !g.pending.stream);
    const kind = myTurn ? (g.pending.kind || '') : '';
    const wantHit = myTurn && H ? H.hitOf(kind) : null;

    /* ① 就是现在该点的那件：开面板（表单在 #region-dec 里，控件语义不变） */
    if (wantHit && wantHit === key) {
      focusProp(key, label, mount);
      if (global.UI && global.UI.openDockPanel) global.UI.openDockPanel();
      toast(mount, (label || key) + ' · ' + (g.pending.title || '开始行动'));
      return;
    }

    /* ② 现在该做的动作在别的房间：沿通道走过去，而不是干瞪眼 */
    if (myTurn) {
      const room = H ? H.roomOf(kind) : null;
      if (room && room !== curRoom) {
        const dest = global.SKSpace && global.SKSpace.room(room);
        walkToProp(room, H ? H.hitOf(kind) : null);
        toast(mount, '正在前往「' + ((dest && dest.name) || room) + '」· 这一步在那里完成');
        return;
      }
      /* 本房内的其他道具：说明本次用不到 */
      focusProp(key, label, mount);
      toast(mount, (label || key) + '：本次行动用不到它（这一步在'
        + (H ? (H.labelOf(kind) || kind) : kind) + '）');
      return;
    }

    /* ③ 不在决策时间：给一句"它是什么"，而不是沉默 */
    const np = H && H.newProp(key);
    if (np) {
      focusProp(key, label, mount);
      toast(mount, (label || np.label) + '：轮到对应行动时才用得上');
      return;
    }
    focusProp(key, label, mount);
    toast(mount, (label || key) + '：现在不是决策时间');
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

  /* 〔批 DEMO〕onSeatClick（席位身份弹窗 + 代选目标自动提交）已拆除。
     拆它的原因见 bind() 里席位点击分支的注释；等全员技能重做落地后，
     "指向某人"由新的动作校验（SKActions.validate 的 target）承担。 */


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
  /* 〔批 UI-5〕房间表退役：决策 → 房间 的唯一来源改为 js/hud-map.js（用户要的「映射表」）。
     这里保留一个薄转发，避免调用点散落两份数据。 */
  function kindRoom(kind) {
    const H = global.SKHudMap;
    return H ? H.roomOf(kind) : null;
  }
  function updateInteractive(g, V, mount) {
    try {
      const myTurn = !!(g.pending && !g.pending.stream);
      const kind = myTurn ? (g.pending.kind || '') : '';
      const lit = myTurn ? kindRoom(kind) : null;
      const doors = mount.querySelectorAll('[data-door]');
      for (const d of doors) d.classList.toggle('sk-lit', !!lit && d.getAttribute('data-door') === lit);
      /* 〔批 UI-5〕轮到我在别的房间做这件事时，把「去那间房」写进书记官记录板，
         而不是在顶栏挂一条提示（顶栏已经删了）。 */
      const goHint = el('clerk-go');
      if (goHint) {
        const S = global.SKSpace;
        const destName = lit && S && S.room(lit) ? S.room(lit).name : '';
        const here = lit && lit === curRoom;
        goHint.textContent = lit ? (here ? '' : '去 ' + destName + ' · ' + (global.SKHudMap.labelOf(kind) || '')) : '';
        goHint.classList.toggle('hidden', !lit || here);
      }
      /* 当前该点的物件：轮到谁、在哪间房，就把那件道具点亮（点它 = 发起这次行动） */
      const hit = myTurn && lit === curRoom ? (global.SKHudMap ? global.SKHudMap.hitOf(kind) : null) : null;
      const props = mount.querySelectorAll('[data-hit]');
      for (const p of props) p.classList.toggle('sk-need', !!hit && p.getAttribute('data-hit') === hit);
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

    /* 地板 + 四壁：与游戏内**同一个函数**（floorWallShell），不再各写一份。
       主页只是把压暗强度提到 .42 —— 让"预览"读作尚未入场，而不是已经开打。
       〔批 UI-7〕此前这里是手抄的第二份实现，两处参数已经漂移（.42 vs .34）。
       〔批 SHIP〕floorWallShell 的参数统一改成**格**（它内部乘 TILE），
         所以这里传 {0,0,w,h} 而不是像素尺寸 —— 主页画布仍是"舰桥一间房"，
         因为主页是"登船前看一眼席位"，不是整船图。 */
    html += SHELL.floorWallShell(S, { x: 0, y: 0, w: w, h: h }, r, 'home', 0.42);

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
        /* 〔批 UI-5a · 2026-10-26〕主页也踩了同一个坑（P0 的第二处）：
           `overflow="hidden"` 对嵌套 <svg> 的 x/y/width/height 溢出**无效**，
           整张 4×5 行走图会被完整画出来 —— 主页左侧那"一堆绿色小人"就是它。
           批 H1 的注释写着"不裁剪时画面上是一堆红小人"，但当时只加了 overflow:hidden，
           等于没修。这里补 clipPath，且矩形按**当前 viewBox 的原点**给
           （待机帧的 viewBox y = CREW_H*ROW_IDLE，不是 0 —— 与对局内同一处根因）。 */
        const hvbx = CREW_W, hvby = CREW_H * ROW_IDLE;
        html += '<svg x="' + (cx - w2 / 2) + '" y="' + (cy - h2 * 0.62) + '" width="' + w2
          + '" height="' + h2 + '" viewBox="' + hvbx + ' ' + hvby + ' ' + CREW_W + ' ' + CREW_H
          + '" overflow="hidden" preserveAspectRatio="xMidYMax meet">'
          + '<defs><clipPath id="sk-home-clip"><rect x="' + hvbx + '" y="' + hvby
          + '" width="' + CREW_W + '" height="' + CREW_H + '"/></clipPath></defs>'
          + '<g clip-path="url(#sk-home-clip)">'
          + '<image href="assets/scene/crew/crew-15.png"'
          + ' x="0" y="0" width="' + (CREW_W * 4) + '" height="' + (CREW_H * 5) + '" image-rendering="pixelated"/>'
          + '</g></svg>';
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
    /* 〔批 UI-5〕席位的真实绘制矩形（屏幕坐标）：书记官记录板的避让与门禁共用这一份，
       免得"渲染器按真实矩形算、门禁按包围盒算"两边各说各话。 */
    seatRects: seatRects,
    layoutClerk: layoutClerk,
    /* 〔批 UI-6〕行动面板展开/收起 → 相机让位（整船图下座圈已不压扁，见 cameraNow） */
    setPanelOpen: setPanelOpen,
    isPanelOpen: function () { return panelOpen; },
    /* 〔批 SHIP〕整船图的对外接口：门禁与调试都要能问"我在哪、相机看哪、走到哪"。
       一律返回**格**（船体格），要像素自己乘 _tile —— 免得又出现"两边单位不同"。 */
    myPos: myPos,
    camera: cameraNow,
    minimapSize: function () { return { w: MAP_W, h: MAP_H }; },
    viewTiles: function () { return { w: VIEW_TILES.w, h: VIEW_TILES.h }; },
    isWalking: function () { return !!walkState; },
    /* 〔批 WALK〕自由行走的对外接口：
         walkToPoint(pt)  — 让「我」沿可行走面走到船体格的某点（点地面走的就是它）；
         isFreeWalking()  — 键盘此刻是否在走（腿在摆 = true）；
         position()       — 我现在的落点；fromAnchor=true 表示还没被玩家自己走过。
       门禁与截图脚本靠这三个问"人到底在哪、是不是真的在走"。 */
    walkToPoint: walkToPoint,
    /* 〔批 R1〕视野与"别人在哪"的对外接口：
         inSight(from,to)   — 半径 ∩ 不跨墙的唯一判据（将来 AI 目击必须调它）
         setCrewPos(id,at)  — 写入某人的位置（R3 由 AI 每帧写；现在默认集合在舰桥席位）
         crewPos(id)        — 读某人的当前位置 */
    inSight: inSight, setCrewPos: setCrewPos, crewPos: crewPos, _visionR: VISION_R,
    _capGate: capGate, _myRole: myRole,
    /* 〔批 R3〕别人的闲逛（表现层）：startWander/stopWander 供 main 在切页时收放 */
    startWander: startWander, stopWander: stopWander, paintCrew: paintCrew,
    isFreeWalking: function () { return keyMoving(); },
    position: function () { const p = myPos(); p.fromAnchor = !freePos && !walkState; return p; },
    _tile: TILE, _vb: VB, _palette: PALETTE,
  };
})(typeof window !== 'undefined' ? window : globalThis);
