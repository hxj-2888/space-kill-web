/* =============================================================
 * 新返航录 · 整船图（船体几何 + 通道节点图 + 寻路 + 相机）〔批 SHIP · 2026-10-27〕
 * -------------------------------------------------------------
 * 用户原话（本轮拍板，逐条对应）：
 *   ① 「主视图是整船图，小地图上会显示整张地图的布局，
 *      但是玩家屏幕里面并不会显示整张船，相当于一个视野范围会覆盖一小部分，玩家会看到近景」
 *   ② 「相机只跟我，走动是甲（点目标自动寻路）」
 *   ③ 「通道连接房间」
 *   ④ 「只看到自己」（其他 14 人不显示在整船图上）
 *   ⑤ 房间语义：**(乙) 保留现有 9 间房语义，只换几何骨架**
 *
 * 所以本文件只做「骨架」这一件事，而且必须是**纯数据 + 纯函数**：
 *   · 不读 g / 不读 DOM / 不碰随机流（红线 3）；
 *   · 房间内部的家具、墙面、座位仍然由 js/space.js 声明，本文件一个字都不改它们；
 *   · 渲染器（js/ui-scene.js）只是消费者，门禁（tools/test-ship.cjs）可以直接量这份数据。
 *
 * 坐标系：**船体格**（1 格 = 56px = 渲染器的 TILE）。
 *   原点在船体左上角，x 向右、y 向下。房间矩形与通道折线都用这套坐标。
 *   房间本地坐标（space.js 的 0..30 / 0..11）→ 船体坐标：
 *     shipX = roomRect.x + localX
 *     shipY = roomRect.y + localY
 *
 * 布局为什么是「一条横脊 + 上下各一间」：
 *   space.js 的门是**按侧声明的**（bridge.l=verify / bridge.r=patrol /
 *   bridge.t=safe / bridge.b=dorms），而 medical 的 pharma 门在 l、verify 门在 r……
 *   也就是说 7 间房被门的侧向串成一条链：
 *     pharma – medical – verify – bridge – patrol – repair – armory
 *   要保住「语义不动、只换骨架」，最省事且**不会自相矛盾**的做法就是让这条链
 *   水平排开、舰桥居中，safe 在舰桥上方、dorms 在下方 —— 通道全部是直的短廊。
 *   若强行折成方阵，就得给通道加折角，而折角通道会从房间中间穿过去（等于穿墙）。
 *   这条取舍写进 改动说明.md，不留给下一个人猜。
 * ============================================================= */
(function (global) {
  'use strict';

  const ROOM_W = 30, ROOM_H = 11;
  /* 通道：水平间隔 4 格（够一条 3.2 格宽的廊 + 两侧各 0.4 格墙脚），
     垂直间隔 6 格（上下各留一条廊，且不压房间的顶墙 2 格）。 */
  const GAP_X = 4, GAP_Y = 6;
  const CORRIDOR_W = 3.2;

  /* ---- 房间在船体上的位置（船体格，左上角）—— 米字 + 环形〔批 M2 · 2026-10-28〕----
     -------------------------------------------------------------
     用户拍板：「中心就是会议室，以中心为支点外接所有房间，每相邻两个房间之间也有一个通道」
     + 「必须新增斜向走廊，几何图形的端点数等于仓室数目」。

     拓扑 = **轮图 W8 + 外环**：中心舰桥接 8 间（辐条，米字的八笔），
     外圈相邻两间再连一条（环，8 条）⇒ 共 **16 条通道**，任意两间房最多中转一次（直径 2）。

     坐标：中心 (63,54)，外圈**半径 48、45° 等分**。
       正四向 = (±48, 0) / (0, ±48)；斜四向 = 48/√2 ≈ 33.94 ⇒ (±33.94, ±33.94)。
     为什么是 48 而不是更小：房间是 30×11 的**轴对齐**矩形，斜向那四间若离得太近
       会与正四向那四间在 y 上重叠（半径 42 时只剩 1.8 格缝，3.2 宽的廊塞不进去）。
       48 时最小缝隙 **3.1 格**（斜向房上沿 14.56 − 正北房下沿 11.5），刚好容一走廊。
     船体：**126 × 108**（旧版是 234×45 的横长条；换成近方形，小地图比例随之变化）。 */
  const ROOMS = {
    /* 中心：会议室 / 讨论与投票 */
    bridge:  { x: 48,     y: 48.5 },
    /* 正四向 */
    verify:  { x: 48,     y: 0.5 },     /* 北 · 查证室 */
    repair:  { x: 96,     y: 48.5 },    /* 东 · 维修站 */
    dorms:   { x: 48,     y: 96.5 },    /* 南 · 宿舍 */
    pharma:  { x: 0,      y: 48.5 },    /* 西 · 制药室 */
    /* 斜四向（48/√2 = 33.941） */
    patrol:  { x: 81.941, y: 14.559 },  /* 东北 · 巡逻岗 */
    armory:  { x: 81.941, y: 82.441 },  /* 东南 · 军械库 */
    safe:    { x: 14.059, y: 82.441 },  /* 西南 · 安全室 */
    medical: { x: 14.059, y: 14.559 },  /* 西北 · 医疗室 */
  };

  const W = 126, H = 108;
  const BOUNDS = { x: 0, y: 0, w: W, h: H };

  /* ---- 通道（16 条 = 8 辐条 + 8 环边）----
     aAt / bAt = 门在墙上的偏移（格，从该墙起点算；缺省居中）。
     舰桥四侧各要接 2~3 条，所以它的门必须带偏移：
       顶边 x=8/15/22、底边 x=8/15/22、左边 y=5.5、右边 y=5.5。
     ⚠ 每一条都必须能在 space.js 两端 doors 里找到同 side + 同 at 的声明，
       反之亦然 —— 门禁 SH3 与 space.validate 双向核对。 */
  const LINKS = [
    /* ── 8 条辐条（中心 ↔ 外圈）── */
    { a: 'bridge', sa: 't', aAt: 8,  b: 'medical', sb: 'r' },
    { a: 'bridge', sa: 't', aAt: 15, b: 'verify',  sb: 'b' },
    { a: 'bridge', sa: 't', aAt: 22, b: 'patrol',  sb: 'l' },
    { a: 'bridge', sa: 'r', aAt: 5.5, b: 'repair', sb: 'l' },
    { a: 'bridge', sa: 'b', aAt: 22, b: 'armory',  sb: 'l' },
    { a: 'bridge', sa: 'b', aAt: 15, b: 'dorms',   sb: 't' },
    { a: 'bridge', sa: 'b', aAt: 8,  b: 'safe',    sb: 'r' },
    { a: 'bridge', sa: 'l', aAt: 5.5, b: 'pharma', sb: 'r' },
    /* ── 8 条环边（外圈相邻两间；全部是斜段）── */
    { a: 'verify',  sa: 'r', b: 'patrol',  sb: 't' },
    { a: 'patrol',  sa: 'b', b: 'repair',  sb: 't' },
    { a: 'repair',  sa: 'b', b: 'armory',  sb: 'r' },
    { a: 'armory',  sa: 'b', b: 'dorms',   sb: 'r' },
    { a: 'dorms',   sa: 'l', b: 'safe',    sb: 'b' },
    { a: 'safe',    sa: 'l', b: 'pharma',  sb: 'b' },
    { a: 'pharma',  sa: 't', b: 'medical', sb: 'l' },
    { a: 'medical', sa: 't', b: 'verify',  sb: 'l' },
  ];

  /* ---- 门在船体上的锚点（船体格）----
     与 space.js 的 doorAnchor 同口径：t/b 在水平中线、l/r 在垂直中线。 */
  /* ---- 门在船体上的锚点（船体格）----
     〔批 M1 · 2026-10-28〕第三参数 at = **沿墙偏移**（格，从该墙起点算；缺省居中）。
     为什么需要它：米字+环布局下，舰桥要接 8 条辐条 ⇒ 四侧各两扇门，
     一间房最多 3 扇（2 环 + 1 辐）——"每侧一扇"的旧约定装不下。
     space.js 的 doorAnchor 用同一个 at 口径（door.at 缺省 = 居中）。 */
  function doorPoint(roomId, side, at) {
    const r = ROOMS[roomId];
    if (!r) return null;
    const off = (at == null) ? null : at;
    switch (side) {
      case 't': return { x: r.x + (off == null ? ROOM_W / 2 : off), y: r.y };
      case 'b': return { x: r.x + (off == null ? ROOM_W / 2 : off), y: r.y + ROOM_H };
      case 'l': return { x: r.x, y: r.y + (off == null ? ROOM_H / 2 : off) };
      case 'r': return { x: r.x + ROOM_W, y: r.y + (off == null ? ROOM_H / 2 : off) };
      default: return null;
    }
  }

  /* ---- 房间矩形（船体格） ---- */
  function roomRect(id) {
    const r = ROOMS[id];
    if (!r) return null;
    return { x: r.x, y: r.y, w: ROOM_W, h: ROOM_H };
  }

  /* ---- 房间中心（船体格）—— 走动落点 / 寻路端点 ---- */
  function roomCenter(id) {
    const r = ROOMS[id];
    if (!r) return null;
    return { x: r.x + ROOM_W / 2, y: r.y + ROOM_H / 2 };
  }

  /* ---- 点在哪个房间（不在任何房间返回 null）---- */
  function roomAt(x, y) {
    for (const id in ROOMS) {
      const r = ROOMS[id];
      if (x >= r.x && x <= r.x + ROOM_W && y >= r.y && y <= r.y + ROOM_H) return id;
    }
    return null;
  }

  /* ---- 通道折线（船体格）：[起点门, …bend…, 终点门] ---- */
  function linkPoints(link) {
    const p0 = doorPoint(link.a, link.sa, link.aAt), p1 = doorPoint(link.b, link.sb, link.bAt);
    if (!p0 || !p1) return null;
    const mid = (link.bend || []).map(p => ({ x: p[0], y: p[1] }));
    return [p0].concat(mid, [p1]);
  }

  /* ---- 走廊 = **折线 + 宽度**（批 M1 · 2026-10-28）----
     -------------------------------------------------------------
     旧口径是"轴对齐矩形"：只能水平或垂直，斜廊无法表达（validate 直接判红）。
     米字+环布局里，外圈相邻两间房之间必然是斜的，所以必须换成
     "一条带宽度的折线" —— 直廊只是两点折线，斜廊只是角度不为 0 的两点折线，
     折角廊是多点折线，三种情形一套表示。

     两条消费方都只认 { a, b, w }：
       · walkable()（碰撞/寻路）：点到线段距离 ≤ w/2；
       · 渲染：<path stroke-width=w>（描边天然支持任意角度与转角）。
     返回单段时也返回数组，调用方不必区分"直/斜/折"。 */
  function corridorSegs(link) {
    const pts = linkPoints(link);
    if (!pts) return [];
    const out = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) continue;   /* 退化段（重复点）直接丢 */
      out.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, w: CORRIDOR_W });
    }
    return out;
  }
  function corridorSegsAll() {
    const out = [];
    for (const L of LINKS) for (const g of corridorSegs(L)) out.push(g);
    return out;
  }

  /* 点到线段距离（碰撞与视线都以它为准） */
  function distToSeg(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    if (L2 < 1e-12) return Math.hypot(px - a.x, py - a.y);
    let t = ((px - a.x) * dx + (py - a.y) * dy) / L2;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }

  /* ---- 房间邻接图（无向）：{ roomId: [ {to, link, side, side2} … ] } ---- */
  function adjacency() {
    const g = {};
    for (const id in ROOMS) g[id] = [];
    for (const L of LINKS) {
      if (!ROOMS[L.a] || !ROOMS[L.b]) continue;
      g[L.a].push({ to: L.b, link: L, side: L.sa, side2: L.sb });
      g[L.b].push({ to: L.a, link: L, side: L.sb, side2: L.sa });
    }
    return g;
  }

  /* ---- 房间之间的门序列（BFS，返回 [{from,to,link,side,side2}…]，不可达返回 null）----
     为什么不用 Dijkstra：每条通道长度相近且图是树（9 间房 8 条通道），
     最短跳数就是最短路径；引入权重只会让「为什么这么走」更难解释。 */
  function route(fromRoom, toRoom) {
    if (fromRoom === toRoom) return [];
    const adj = adjacency();
    if (!adj[fromRoom] || !adj[toRoom]) return null;
    const prev = {}; prev[fromRoom] = null;
    const q = [fromRoom];
    while (q.length) {
      const cur = q.shift();
      for (const e of adj[cur]) {
        if (prev[e.to] !== undefined) continue;
        prev[e.to] = { from: cur, edge: e };
        if (e.to === toRoom) {
          /* 回溯 */
          const hops = [];
          let node = toRoom;
          while (prev[node]) {
            const p = prev[node];
            hops.unshift({ from: p.from, to: node, link: p.edge.link, side: p.edge.side, side2: p.edge.side2 });
            node = p.from;
          }
          return hops;
        }
        q.push(e.to);
      }
    }
    return null;
  }

  /* ---- 完整行走折线（船体格）----
     起点 → （若起点不在起点房间的中心）直线到起点房间的中心 →
      逐跳：门 → 廊 → 门 →
      → 终点。
     每一跳里的「廊」段由 linkPoints 给出，所以玩家走的是**通道**，
     不是从房间 A 斜穿到房间 B（那条直线会穿过房间墙）。 */
  function path(fromRoom, toRoom, from, to) {
    if (!ROOMS[fromRoom] || !ROOMS[toRoom]) return null;
    const hops = route(fromRoom, toRoom);
    if (!hops) return null;
    const start = from ? { x: from.x, y: from.y } : roomCenter(fromRoom);
    const end = to ? { x: to.x, y: to.y } : roomCenter(toRoom);
    const pts = [start];
    const push = (p) => {
      const last = pts[pts.length - 1];
      if (!last || Math.abs(last.x - p.x) > 1e-6 || Math.abs(last.y - p.y) > 1e-6) pts.push({ x: p.x, y: p.y });
    };
    let curRoom = fromRoom;
    for (const h of hops) {
      /* 先走到本房间的门口（房间内部是空地，直线可达） */
      push(doorPoint(curRoom, h.side));
      /* 再沿通道走到对面门口 */
      const lp = linkPoints(h.link);
      const ordered = (lp[0].x === pts[pts.length - 1].x && lp[0].y === pts[pts.length - 1].y) ? lp : lp.slice().reverse();
      for (const p of ordered) push(p);
      curRoom = h.to;
    }
    push(end);
    /* 长度（格） */
    let len = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    }
    return { pts: pts, len: len, rooms: [fromRoom].concat(hops.map(h => h.to)) };
  }

  /* =============================================================
   * 〔批 WALK · 2026-10-28〕自由行走：可行走面 + 点任意处寻路
   * -------------------------------------------------------------
   * 用户原话：「调整人物行走逻辑，现在可在地图中自由行走」。
   *
   * 上一版只有一种移动方式：点门（或等游戏把你带去决策房），人沿
   * 「房间中心 → 门 → 廊 → 门 → 房间中心」这一条预先算好的折线走。
   * 也就是说**人站在哪由游戏决定，玩家只能选"去哪间房"**。
   * 现在补两件事，人的坐标才开始由玩家决定：
   *   ① 可行走面（walkRects / walkable）：房间内部任意位置 + 通道带；
   *   ② 点任意处寻路（walkPath）：0.5 格网格上的 A*，再按视线拉直 ——
   *      既不穿墙，也不会贴着墙角一格一格地抖。
   *
   * 为什么放在数据层（而不是渲染器里）：
   *   与 roomRect / camera 同性质 —— 它是**几何真源**。渲染器只负责"人动起来"，
   *   门禁（tools/test-ship.cjs 的 SH19~SH20）可以直接量这份数据：房间必须连通、
   *   通道带必须伸进门里。后者是这一版最容易写错的一处，见下方 WALK_DOOR_REACH。
   *
   * 【为什么房间要内缩、通道要外伸】
   *   墙面是画在房间矩形**内部**的（上壁 2 格、左右壁 0.55 格，见 ui-scene.js 的
   *   floorWallShell）。若可行走面直接用房间矩形，人会走进墙里；
   *   而内缩之后，房间边与门之间就多出一道死缝（内缩 0.75 格 vs 门在房间边界上），
   *   人会在门口卡住 —— 所以通道带必须**穿过那道缝伸进房间**（WALK_DOOR_REACH）。
   *   这两个数是成对的，改一个必须重算另一个；SH19 守"每个门都能走通"。
   * ============================================================= */
  const WALK_INSET_X = 0.75;      /* 距左右壁（壁面 0.55 格宽，再留 0.2 余量） */
  const WALK_INSET_TOP = 2.1;     /* 距上壁（墙高 2 格 —— 走进墙里比走进墙边更明显） */
  const WALK_INSET_BOTTOM = 0.5;  /* 距下壁（只有 0.28 格踢脚线） */
  const WALK_CORR_INSET = 0.3;    /* 廊宽 3.2 ⇒ 可走 2.6 格；人可见宽 1.15 格 */
  const WALK_DOOR_REACH = 2.6;    /* 通道带两端伸进房间的深度（> WALK_INSET_TOP，见上） */
  const WALK_STEP = 0.5;          /* A* 网格边长（格） */

  /* ---- 可行走矩形集合（房间内缩矩形 + 通道带）----
     一次性算好并缓存：它是纯数据，不随对局变化。 */
  let WALK_RECTS = null;
  /* 房间内缩矩形（只有房间；走廊不再是矩形，见 walkable） */
  function walkRects() {
    if (WALK_RECTS) return WALK_RECTS;
    const out = [];
    for (const id in ROOMS) {
      const r = ROOMS[id];
      out.push({
        x: r.x + WALK_INSET_X,
        y: r.y + WALK_INSET_TOP,
        w: ROOM_W - WALK_INSET_X * 2,
        h: ROOM_H - WALK_INSET_TOP - WALK_INSET_BOTTOM,
        kind: 'room', id: id,
      });
    }
    WALK_RECTS = out;
    return out;
  }

  /* 这个点能不能站人：房间内缩矩形 ∪ 走廊折线（点到线段 ≤ 半宽）。
     〔批 M1〕走廊部分必须用**线段距离**——轴对齐矩形的判据在斜廊上会把
     "斜着能走的路"判成墙（反过来也会让墙角穿过去）。 */
  const WALK_HALF = CORRIDOR_W / 2 - WALK_CORR_INSET;
  /* 走廊线段**两端各向外延伸 WALK_DOOR_REACH** 再判距离。
     为什么必须延伸（批 WALK 的老坑，换成折线后仍然成立）：
       走廊端点落在门锚点（房间边界线）上，而房间可行走面是内缩矩形
       （上壁让 2.1、左右让 0.75）—— 两者之间有一道死缝，不补人就卡在门口。
       旧版用"通道矩形加长 mouth"实现，折线版直接延长线段，斜廊同样有效。 */
  let WALK_SEGS = null;
  function walkSegs() {
    if (WALK_SEGS) return WALK_SEGS;
    const src = corridorSegsAll();
    const out = [];
    for (const g of src) {
      const dx = g.b.x - g.a.x, dy = g.b.y - g.a.y;
      const L = Math.hypot(dx, dy);
      if (L < 1e-9) continue;
      const ux = dx / L, uy = dy / L;
      /* 延伸长度要**按方向放大**：房间内缩量是按轴给的（上壁 2.1 / 左右 0.75），
         斜廊沿 45° 延伸 2.6 格，在 y 上只有 1.84 格 —— 够不到内缩边，
         门内侧就会留下一个\"两头可走、中间不可走\"的缺口（A* 化简后的折线会卡在那儿）。
         所以按 max(|ux|,|uy|) 折算，保证**每个轴**都伸够 WALK_DOOR_REACH。 */
      const k = WALK_DOOR_REACH / Math.max(Math.abs(ux), Math.abs(uy), 0.34);
      out.push({
        a: { x: g.a.x - ux * k, y: g.a.y - uy * k },
        b: { x: g.b.x + ux * k, y: g.b.y + uy * k },
        w: g.w,
      });
    }
    WALK_SEGS = out;
    return out;
  }

  /* ---- 门洞垫片（door pad）----
     为什么斜廊光靠"延长线段"还不够：走廊覆盖是以线段为轴的**圆形扫掠**（半径 1.3），
     而房间可走面是内缩矩形 —— 斜着进门时，两者在门内侧会留下一条
     \"两头可走、中间不可走\"的缝（实测差 0.04 格就卡住化简后的折线）。
     所以在每个门锚点再铺一块**轴对齐垫片**：沿墙 ±半廊宽、向房内深 WALK_DOOR_REACH。
     这块垫片就是\"门洞\"本身，与走廊角度无关。 */
  let WALK_PADS = null;
  function doorPads() {
    if (WALK_PADS) return WALK_PADS;
    const out = [];
    /* 垫片横向取 1.6 倍廊宽（不是 1 倍）：斜廊以 45° 进门时，走廊扫掠在门的一侧
       会斜斜地出去很远，1 倍宽的垫片仍可能在门侧留下窄缝（实测 0.5 格就够卡人）。
       1.6 倍仍是"门洞"量级（5.1 格 ≈ 房门宽），不会把墙变成可走。 */
    const half = CORRIDOR_W * 1.15;   /* 沿墙各 3.68 格：斜廊贴墙进来时实测需要 3.3 格（余量 0.4） */
    const ends = [];
    for (const L of LINKS) {
      ends.push([L.a, L.sa, L.aAt]);
      ends.push([L.b, L.sb, L.bAt]);
    }
    for (const e of ends) {
      const p = doorPoint(e[0], e[1], e[2]);
      if (!p) continue;
      const side = e[1];
      /* 垫片向房内深 WALK_DOOR_REACH，向走廊侧也**外延 1.2 格**：
         房间的墙脚带（下壁 0.5 格）与走廊扫掠边缘之间还有一条 0.06 格的细缝，
         A* 沿墙走的折线恰好会踩上去 —— 外延一块就把缝盖掉（门洞本来就该比门宽）。 */
      const OUT = 1.2;
      if (side === 't') out.push({ x: p.x - half, y: p.y - OUT, w: half * 2, h: WALK_DOOR_REACH + OUT });
      else if (side === 'b') out.push({ x: p.x - half, y: p.y - WALK_DOOR_REACH, w: half * 2, h: WALK_DOOR_REACH + OUT });
      else if (side === 'l') out.push({ x: p.x - OUT, y: p.y - half, w: WALK_DOOR_REACH + OUT, h: half * 2 });
      else out.push({ x: p.x - WALK_DOOR_REACH, y: p.y - half, w: WALK_DOOR_REACH + OUT, h: half * 2 });
    }
    WALK_PADS = out;
    return out;
  }

  function walkable(x, y) {
    const rs = walkRects();
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
    }
    const pads = doorPads();
    for (let i = 0; i < pads.length; i++) {
      const r = pads[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
    }
    const segs = walkSegs();
    for (let i = 0; i < segs.length; i++) {
      const g = segs[i];
      if (distToSeg(x, y, g.a, g.b) <= WALK_HALF) return true;
    }
    return false;
  }

  /* ---- A* 网格（延迟构建：门禁/主页用不到，不占启动时间）---- */
  let WALK_GRID = null;
  function walkGrid() {
    if (WALK_GRID) return WALK_GRID;
    const cols = Math.ceil(BOUNDS.w / WALK_STEP);
    const rows = Math.ceil(BOUNDS.h / WALK_STEP);
    const cell = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) * WALK_STEP, y = (r + 0.5) * WALK_STEP;
        cell[r * cols + c] = walkable(x, y) ? 1 : 0;
      }
    }
    WALK_GRID = { cols: cols, rows: rows, cell: cell };
    return WALK_GRID;
  }

  /* 离 (x,y) 最近的可走格子（由近及远按"环"扫，最多 4 格）。
     点在地板外（墙上/家具上/船体外）时，玩家想表达的仍是"走到那附近"。 */
  function nearestCell(x, y) {
    const G = walkGrid();
    const c0 = Math.max(0, Math.min(G.cols - 1, Math.floor(x / WALK_STEP)));
    const r0 = Math.max(0, Math.min(G.rows - 1, Math.floor(y / WALK_STEP)));
    if (G.cell[r0 * G.cols + c0]) return { c: c0, r: r0 };
    const MAXR = Math.ceil(4 / WALK_STEP);
    for (let rad = 1; rad <= MAXR; rad++) {
      let best = null, bestD = Infinity;
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          const r = r0 + dr, c = c0 + dc;
          if (r < 0 || c < 0 || r >= G.rows || c >= G.cols) continue;
          if (!G.cell[r * G.cols + c]) continue;
          const d = dc * dc + dr * dr;
          if (d < bestD) { bestD = d; best = { c: c, r: r }; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /* 最近的可站位置（点地面用）。原样可站就原样返回 —— 不要四舍五入到格子中心，
     否则"点到哪就停在哪"会差半格，看着像点歪了。 */
  function nearestWalkable(x, y) {
    if (walkable(x, y)) return { x: x, y: y };
    const c = nearestCell(x, y);
    if (!c) return null;
    return { x: (c.c + 0.5) * WALK_STEP, y: (c.r + 0.5) * WALK_STEP };
  }

  /* ---- 二进制小顶堆（A* 的开表；42k 格子上线性找最小会明显卡） ---- */
  function heapPush(h, node) {
    h.push(node);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p].f <= h[i].f) break;
      const t = h[p]; h[p] = h[i]; h[i] = t; i = p;
    }
  }
  function heapPop(h) {
    const top = h[0], last = h.pop();
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < h.length && h[l].f < h[m].f) m = l;
        if (r < h.length && h[r].f < h[m].f) m = r;
        if (m === i) break;
        const t = h[m]; h[m] = h[i]; h[i] = t; i = m;
      }
    }
    return top;
  }

  /* 直线可走吗（每 0.2 格采一次；用于把 A* 的锯齿拉直） */
  function lineClear(a, b) {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(d / 0.2));
    for (let i = 1; i < steps; i++) {
      const k = i / steps;
      if (!walkable(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k)) return false;
    }
    return true;
  }

  function samePt(a, b) {
    return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
  }

  /* 折线化简：贪心地"能直着走到最远的那一点就先到那一点"。
     网格路径是 8 向锯齿，直接拿去走会左右抖；化简之后每一段都是直线可达。 */
  function simplifyPts(pts) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) if (!samePt(pts[i], out[out.length - 1])) out.push(pts[i]);
    if (out.length < 3) return out;
    const res = [out[0]];
    let cur = 0;
    while (cur < out.length - 1) {
      let next = cur + 1;
      for (let j = out.length - 1; j > cur + 1; j--) {
        if (lineClear(out[cur], out[j])) { next = j; break; }
      }
      res.push(out[next]);
      cur = next;
    }
    return res;
  }

  /* ---- 自由行走寻路：任意点 → 任意点，沿可行走面，不穿墙 ----
     返回 { pts, len }；走不通返回 null（渲染器据此提示"这里走不过去"）。
     与 path() 的分工：
       · path()     = 房间级折线（门 → 廊 → 门），是"点门"与自动化走的几何；
       · walkPath() = 格子级寻路，是"点地面 / 键盘走位"的几何。
     两者都返回船体格折线，渲染器的 runner 共用一份（walkAlong）。 */
  function walkPath(from, to) {
    if (!from || !to) return null;
    const G = walkGrid();
    const s = nearestCell(from.x, from.y), t = nearestCell(to.x, to.y);
    if (!s || !t) return null;
    const cols = G.cols, cell = G.cell, n = cols * G.rows;
    const cost = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    const si = s.r * cols + s.c, ti = t.r * cols + t.c;
    const hcost = function (i) {
      const dr = Math.abs(((i / cols) | 0) - t.r), dc = Math.abs((i % cols) - t.c);
      return (dr + dc) + (Math.SQRT2 - 2) * Math.min(dr, dc);   /* octile */
    };
    const heap = [];
    cost[si] = 0;
    heapPush(heap, { i: si, f: hcost(si) });
    /* 邻居：4 正 + 4 斜（斜走的代价 √2） */
    const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    while (heap.length) {
      const cur = heapPop(heap).i;
      if (done[cur]) continue;
      done[cur] = 1;
      if (cur === ti) break;
      const cr = (cur / cols) | 0, cc = cur % cols;
      for (let k = 0; k < NB.length; k++) {
        const nr = cr + NB[k][1], nc = cc + NB[k][0];
        if (nr < 0 || nc < 0 || nr >= G.rows || nc >= cols) continue;
        const ni = nr * cols + nc;
        if (!cell[ni] || done[ni]) continue;
        /* 斜走不许切墙角（两条正交邻格都得能走，否则人会擦着墙角穿过去） */
        if (NB[k][0] && NB[k][1] && (!cell[cr * cols + nc] || !cell[nr * cols + cc])) continue;
        const ng = cost[cur] + NB[k][2];
        if (ng < cost[ni]) {
          cost[ni] = ng; prev[ni] = cur;
          heapPush(heap, { i: ni, f: ng + hcost(ni) });
        }
      }
    }
    if (!done[ti]) return null;
    const raw = [];
    for (let i = ti; i >= 0; i = prev[i]) {
      raw.push({ x: ((i % cols) + 0.5) * WALK_STEP, y: (((i / cols) | 0) + 0.5) * WALK_STEP });
      if (i === si) break;
    }
    raw.reverse();
    /* 端点用玩家给的原坐标（点击点通常不在格子中心），不能站就退回最近格子 */
    const start = walkable(from.x, from.y) ? { x: from.x, y: from.y } : raw[0];
    const end = walkable(to.x, to.y) ? { x: to.x, y: to.y } : raw[raw.length - 1];
    const pts = simplifyPts([start].concat(raw, [end]));
    let len = 0;
    for (let i = 0; i + 1 < pts.length; i++) len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    return { pts: pts, len: len };
  }

  /* ---- 相机：以「我」为中心，夹紧在船体内 ----
     vw/vh = 视窗尺寸（格）。船比视窗小的时候居中，不让画面贴边。
     anchorY = 我落在视窗高度的百分之几处（缺省 0.5 = 正中）。
       行动面板展开时传 0.34：把我抬到画面上半部，抽屉就压不到人。
     clampRect = 可选：把视窗**整块**夹进这个矩形（房间）。
       这是"近景"的关键：房间正好 30×11 = 视窗尺寸时，夹进房间 ⇒ 视窗 == 房间，
       一间房铺满屏幕。若只按"我居中"算，人站在房间下半部时视窗会越出房间，
       屏幕下半截就是空船体 —— 实测截图正是这样（半屏黑色地砖、角色挤在上半部）。
       某一轴比视窗小时（走廊只有 3.2 格高）该轴不夹，退回"我居中"：
       走廊本来就要能看到两头的房间。

     〔批 SHIP-2 · 2026-10-27〕★ anchorY 曾经**完全没生效**，而且没人发现
     -------------------------------------------------------------
     上面那行"行动面板展开时传 0.34"写了两批，实现里却先按 anchorY 算出 y，
     紧接着 `clampRect` 那一支把 y **整个覆盖**成"房间居中"：
         y = clampRect.y + (clampRect.h - vh) / 2
     房间 11 格、视窗 12 格 ⇒ 11 < 12 恒成立 ⇒ 每一帧都走这一支 ⇒ anchorY 白传。
     实测（1600×900，真对局）：面板展开时「我」的绘制矩形 600~712，
     面板顶边 559~672 ⇒ **被盖住 65%~100%**，也就是"轮到我做决策时看不见自己"。
     门禁 SH4 当时只量了"视窗整块落在房间内"，而"房间居中"恰好满足它 ——
     一条断言守住了几何、却守不住**玩家要看见的那个点**。

     现在的规则（逐轴）：
       · 房间比视窗大：夹紧（旧行为不变）；
       · 房间比视窗小 **且 anchorY 非 0.5**：以 anchorY 为准，允许越出房间边界
         （越出的那部分就是船体，代价可接受；人被抽屉盖住才是缺陷）；
         但整块仍夹在船体内，不让画面出现船外的空白。
       · 房间比视窗小 **且 anchorY 是 0.5**：居中（旧行为不变，一间房铺满屏幕）。 */
  function camera(px, py, vw, vh, anchorY, clampRect) {
    const ay = anchorY == null ? 0.5 : anchorY;
    const wantsAnchor = Math.abs(ay - 0.5) > 1e-6;
    let x = px - vw / 2, y = py - vh * ay;
    if (BOUNDS.w <= vw) x = (BOUNDS.w - vw) / 2;
    else x = Math.max(BOUNDS.x, Math.min(BOUNDS.w - vw, x));
    if (BOUNDS.h <= vh) y = (BOUNDS.h - vh) / 2;
    else y = Math.max(BOUNDS.y, Math.min(BOUNDS.h - vh, y));
    if (clampRect) {
      /* 逐轴两种处理，这是"一间房铺满屏幕"的关键：
           · 房间那一轴**比视窗大** ⇒ 夹紧（视窗在房间内部滑动，不越界）；
           · 房间那一轴**比视窗小** ⇒ **居中**（房间整块可见，两侧/上下均分余量）。
         第一版只做了"夹紧"这一半，于是 30×12 的视窗对上 30×11 的房间时，
         y 轴因 11 < 12 被判为"不用夹" ⇒ 相机继续跟着人 ⇒ 屏幕下半截露出舱外
         （实测截图：房间只占上面 63%，下面全是船体内衬）。 */
      if (clampRect.w >= vw) x = Math.max(clampRect.x, Math.min(clampRect.x + clampRect.w - vw, x));
      else if (!wantsAnchor) x = clampRect.x + (clampRect.w - vw) / 2;
      if (clampRect.h >= vh) y = Math.max(clampRect.y, Math.min(clampRect.y + clampRect.h - vh, y));
      else if (!wantsAnchor) y = clampRect.y + (clampRect.h - vh) / 2;
    }
    /* 越出房间之后仍不许越出船体（否则画面边缘会出现"船外"的空白）。
       ⚠ 只在**故意越出房间**（wantsAnchor）时才夹：否则会把"房间居中"算出来的
         -0.5 格夹回 0，SH4 的"房间比视窗矮时必须居中"就挂了
         （safe 房间在 y=0，居中必然算出负的相机 y —— 那 0.5 格是船体顶沿，不是缺陷）。 */
    if (wantsAnchor) {
      x = Math.max(BOUNDS.x, Math.min(BOUNDS.x + BOUNDS.w - vw, x));
      y = Math.max(BOUNDS.y, Math.min(BOUNDS.y + BOUNDS.h - vh, y));
    }
    return { x: x, y: y, w: vw, h: vh };
  }

  /* ---- 小地图投影：把整船等比塞进 mapW × mapH（px），返回缩放与偏移 ---- */
  function mapProjection(mapW, mapH, pad) {
    const p = pad == null ? 4 : pad;
    const s = Math.min((mapW - p * 2) / BOUNDS.w, (mapH - p * 2) / BOUNDS.h);
    return {
      s: s,
      ox: (mapW - BOUNDS.w * s) / 2,
      oy: (mapH - BOUNDS.h * s) / 2,
      toMap: function (x, y) { return { x: this.ox + x * this.s, y: this.oy + y * this.s }; },
    };
  }

  /* ---- 自检：几何合法性（门禁直接调用，不需要浏览器）----
     判据：
       ① 9 间房都在船体内、互不重叠
       ② 每条通道两端的房间存在、侧向合法
       ③ 通道线段不得穿进任何房间内部（端点那一点除外）—— 穿进去就是穿墙
       ④ 从舰桥出发所有房间可达
       ⑤ 与 space.js 的门声明双向一致（给了 S 才查）
     ⑥ 任意两间房之间都能算出路径，且路径长度 ≥ 直线距离（不许"瞬移"） */
  /* 线段 × 矩形：Liang–Barsky 裁剪。
     〔批 M1〕旧实现拿**线段包围盒**和矩形比 —— 轴对齐线段没问题，
     斜段会误报（包围盒很大，实际只是掠过角上），于是斜廊永远"穿过"某间房。 */
  function segHitsRect(a, b, r, eps) {
    const e = eps == null ? 1e-6 : eps;
    const x0 = r.x + e, x1 = r.x + r.w - e, y0 = r.y + e, y1 = r.y + r.h - e;
    if (x1 <= x0 || y1 <= y0) return false;
    let t0 = 0, t1 = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    const edge = [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]];
    for (let i = 0; i < 4; i++) {
      const p = edge[i][0], q = edge[i][1];
      if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return t0 <= t1;
  }

  function validate(S) {
    const errs = [];
    const ids = Object.keys(ROOMS);

    /* ① 在船体内 + 互不重叠 */
    for (const id of ids) {
      const r = roomRect(id);
      if (r.x < BOUNDS.x || r.y < BOUNDS.y || r.x + r.w > BOUNDS.x + BOUNDS.w || r.y + r.h > BOUNDS.y + BOUNDS.h)
        errs.push(id + ' 越出船体边界');
    }
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const A = roomRect(ids[i]), B = roomRect(ids[j]);
        if (A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h)
          errs.push(ids[i] + ' 与 ' + ids[j] + ' 重叠');
      }
    }

    /* ②③ 通道 */
    for (const L of LINKS) {
      if (!ROOMS[L.a] || !ROOMS[L.b]) { errs.push('通道指向不存在的房间 ' + L.a + '→' + L.b); continue; }
      if (!doorPoint(L.a, L.sa) || !doorPoint(L.b, L.sb)) { errs.push('通道侧向非法 ' + L.a + '/' + L.sa); continue; }
      const pts = linkPoints(L);
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        /* 〔批 M1〕斜段**允许**（米字必用斜廊）：改为逐段与每间房的内缩矩形求交，
           穿过（端点房间除外）即判红 —— 这比"禁斜"强：它能真的证明"没穿墙"。 */
        if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) { errs.push('通道 ' + L.a + '→' + L.b + ' 有零长段'); continue; }
        for (const id of ids) {
          /* 端点所在的房间不算"穿进去"：门锚点本来就在房间边界上 */
          if (id === L.a || id === L.b) continue;
          if (segHitsRect(a, b, roomRect(id))) errs.push('通道 ' + L.a + '→' + L.b + ' 穿过 ' + id);
        }
      }
    }

    /* ④ 连通性 */
    const adj = adjacency();
    const seen = { bridge: 1 };
    const q = ['bridge'];
    while (q.length) {
      const cur = q.shift();
      for (const e of adj[cur]) if (!seen[e.to]) { seen[e.to] = 1; q.push(e.to); }
    }
    for (const id of ids) if (!seen[id]) errs.push(id + ' 与舰桥不连通');

    /* ⑥ 任意两间房都要能算出路径 */
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const p = path(a, b);
        if (!p || p.pts.length < 2) { errs.push(a + '→' + b + ' 无路径'); continue; }
        const straight = Math.hypot(roomCenter(b).x - roomCenter(a).x, roomCenter(b).y - roomCenter(a).y);
        if (p.len < straight - 1e-6) errs.push(a + '→' + b + ' 路径短于直线（几何异常）');
      }
    }

    /* ⑤ 与 space.js 双向一致 */
    if (S && S.ROOMS) {
      for (const id in S.ROOMS) {
        if (!ROOMS[id]) { errs.push('space.js 的房间 ' + id + ' 在船体上没有位置'); continue; }
        const declared = (S.ROOMS[id].doors || []).map(d => d.to + ':' + d.side).sort().join(',');
        const linked = LINKS.filter(L => L.a === id || L.b === id)
          .map(L => (L.a === id ? L.b + ':' + L.sa : L.a + ':' + L.sb)).sort().join(',');
        if (declared !== linked)
          errs.push(id + ' 的门与通道不一致（space.js: [' + declared + '] / 船体: [' + linked + ']）');
      }
      for (const id in ROOMS) if (!S.ROOMS[id]) errs.push('船体上的房间 ' + id + ' 在 space.js 里不存在');
    }
    return errs;
  }

  /* ---- 房间锚点：渲染器给每间房加房名/门标签用的「相对房间左上角的偏移」 ----
     之所以放在数据层：房名压在房间左上角、门标签压在门洞上，
     这两个位置以前写死在 ui-scene.js 里，换成整船图之后每间房的位置都变了，
     再写死一次就会重复漂移。 */
  const LABEL = { dx: 0.45, dy: 1.15, doorDy: 0.62 };

  global.SKShip = {
    ROOM_W: ROOM_W, ROOM_H: ROOM_H, GAP_X: GAP_X, GAP_Y: GAP_Y,
    CORRIDOR_W: CORRIDOR_W, BOUNDS: BOUNDS, ROOMS: ROOMS, LINKS: LINKS,
    LABEL: LABEL,
    ids: function () { return Object.keys(ROOMS); },
    roomRect: roomRect, roomCenter: roomCenter, roomAt: roomAt,
    doorPoint: doorPoint, linkPoints: linkPoints,
    adjacency: adjacency, route: route, path: path,
    /* 〔批 WALK〕自由行走：可行走面 + 点任意处寻路（渲染器的键盘走位与点地面共用） */
    WALK_STEP: WALK_STEP,
    walkRects: walkRects, walkable: walkable, nearestWalkable: nearestWalkable,
    /* 〔批 M1〕走廊 = 折线 + 宽度：渲染与碰撞共用（斜廊/折角廊/直廊一套表示） */
    corridorSegs: corridorSegs, corridorSegsAll: corridorSegsAll, CORRIDOR_W: CORRIDOR_W,
    walkPath: walkPath,
    /* 〔批 R1〕视线：两点之间是否无墙遮挡（渲染视野与将来的 AI 目击共用同一份几何）。
       实现就是寻路用的 lineClear —— 沿线段采样，任一点不在可行走面 ⇒ 被墙挡住。
       合成：能看见 ⇔ 距离 ≤ 视野半径 ∧ losClear。 */
    losClear: lineClear,
    camera: camera, mapProjection: mapProjection,
    /* 〔批 M2〕线段 × 矩形（Liang–Barsky）：门禁用它证明"斜廊没穿房" */
    segHitsRect: segHitsRect,
    validate: validate,
  };
})(typeof window !== 'undefined' ? window : globalThis);
