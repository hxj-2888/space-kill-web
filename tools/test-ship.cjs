#!/usr/bin/env node
/* =============================================================
 * test-ship.cjs —— 整船图门禁（批 SHIP · 2026-10-27）
 * -------------------------------------------------------------
 * 为什么单独成脚本：
 *   整船图的几何（9 间房在船上的位置、8 条通道、寻路折线、相机夹紧）全部是
 *   **纯数据 + 纯函数**，落在 js/ship-map.js 里。渲染层（ui-scene.js）只消费它。
 *   所以这里量两件事：
 *     A 组（SH1~SH6）：ship-map 的数据本身对不对（不需要浏览器）；
 *     B 组（SH7~SH13）：渲染器真的**消费**了它没有。
 *   「几何对不对」与「有没有画出来」必须分开守 —— 批 UI-7 的 S3 就是混在一起写，
 *   结果 5 个判据串 && 之后整条断言空转（见交接文档 §4.2）。
 *
 * ★ 本文件的一条硬规矩（第一批反向自检逼出来的）：
 *   B 组判据一律落在**函数体内部**（bodyOf），不许落在整个文件上。
 *   原因：同一个 token 在文件里往往出现多次 ——
 *     `cam.x * TILE` 在 render 和 paintWalk 里各有一份；
 *     `for (const L of M.LINKS)` 在 corridorHtml 和 minimapHtml 里各有一份；
 *     `CREW_BOX.w()` 在 crewHtml 和 seatRects 里各有一份。
 *   用"文件里有没有"判，改坏其中一处，另一处还在 ⇒ 断言照样绿。
 *   第一批反向自检正是这样漏掉 6 条（SH9/SH10/SH11/SH13 全空转）。
 *
 * 用户这一轮拍板的口径（逐条对应断言）：
 *   「主视图是整船图，小地图显示整张地图，屏幕只显示一小部分近景」 → SH4 / SH9 / SH10
 *   「相机只跟我」                                                 → SH4 / SH9
 *   「走动是甲：点目标自动寻路」                                    → SH5 / SH11
 *   「通道连接房间」                                               → SH2 / SH3 / SH8
 *   「只看到自己（其他 14 人不显示）」                              → SH12
 *   「房间语义保留，只换几何骨架」                                  → SH1 / SH6（与 space.js 双向核对）
 *
 * 每条都做过反向自检，见 tools/_selfcheck-ship.cjs 与 tools/_selfcheck-ship2.cjs。
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadInto, makeCtx } = require('./load-order.cjs');
const { rawOf, srcOf, cssAll: cssAllOf } = require('./gate-src.cjs');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (detail ? '  ← ' + detail : '')); }
}

const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), ['space', 'ship-map']);
const S = ctx.SKSpace, M = ctx.SKShip;
/* 〔批 ART-0 · 2026-10-28〕源码按**逻辑模块名**取（tools/gate-src.cjs 是唯一真源）。
   此前这里写死读 js/ui-scene.js：一动文件，二十多条断言同时失去对象
   （不是变红，是判到空串上）。拆分时只改 gate-src 的 MODULES 表，本文件一个字不用动。
   `sceneSrc` 保留原样（含注释）供 U1F 之类的"整文件"判据使用；
   剥注释版本给所有"函数体内部"判据 —— 注释里会提到被删的写法，那不是实现。 */
const sceneSrc = rawOf('scene');
const sceneCode = srcOf('scene');
const cssAll = cssAllOf();

/* ---- 抠函数体：从 signature 起，按大括号配平截出整个函数 ----
   找不到返回空串（调用方一律 `!!body && ...`，缺函数即判红，不会静默通过）。 */
function bodyOf(src, signature) {
  const i = src.indexOf(signature);
  if (i < 0) return '';
  const b = src.indexOf('{', i);
  if (b < 0) return '';
  let depth = 0;
  for (let k = b; k < src.length; k++) {
    const c = src[k];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(b, k + 1); }
  }
  return '';
}

/* =============================================================
 * A 组：几何数据
 * ============================================================= */
ok('SH0：船体数据层已加载（SKShip 暴露 validate / path / camera）',
  !!M && typeof M.validate === 'function' && typeof M.path === 'function'
  && typeof M.camera === 'function' && typeof M.BOUNDS === 'object');

const errs = M ? M.validate(S) : ['SKShip 缺失'];
ok('SH1：船体自检为空（房间不重叠/不越界、通道不穿墙、全连通、与 space.js 门双向一致）',
  errs.length === 0, errs.slice(0, 4).join(' ; '));
if (errs.length) errs.slice(0, 8).forEach(e => console.log('       - ' + e));

/* SH2：9 间房 + 8 条通道（树），且每条通道两端都真实存在 */
/* SH2：拓扑 —— 轮图 W8 + 外环（批 M2）
   -------------------------------------------------------------
   用户拍板：「中心就是会议室，以中心为支点外接所有房间，每相邻两个房间之间也有一个通道」。
   判据从"树"换成三条硬性质：
     ① 16 条通道（8 辐条 + 8 环边）；
     ② 每间房度数 ≥ 2（只有一条出口的房间在实时制里会被堵死）；
     ③ 图连通，且**直径 = 2**（任意两间房最多中转一次）—— 这是米字布局的核心体验承诺；
     ④ 门锚点必须带偏移解析（舰桥同侧 3 扇：at=8/15/22）。 */
ok('SH2：9 间房 + 16 条通道（轮图 W8 + 外环），每房度数 ≥2 且直径 = 2',
  (function () {
    if (!M || M.ids().length !== 9 || M.LINKS.length !== 16) return false;
    if (!M.LINKS.every(L => M.ROOMS[L.a] && M.ROOMS[L.b] &&
      M.doorPoint(L.a, L.sa, L.aAt) && M.doorPoint(L.b, L.sb, L.bAt))) return false;
    const deg = {};
    for (const id of M.ids()) deg[id] = 0;
    for (const L of M.LINKS) { deg[L.a]++; deg[L.b]++; }
    if (M.ids().some(id => deg[id] < 2)) return false;
    /* 直径：BFS 从每间房出发，最远距离必须 ≤ 2 */
    for (const src of M.ids()) {
      const dist = {}; dist[src] = 0;
      const q = [src];
      while (q.length) {
        const cur = q.shift();
        for (const L of M.LINKS) {
          const to = L.a === cur ? L.b : (L.b === cur ? L.a : null);
          if (!to || dist[to] != null) continue;
          dist[to] = dist[cur] + 1; q.push(to);
        }
      }
      if (Object.keys(dist).length !== 9) return false;      /* 不连通 */
      if (Math.max.apply(null, Object.keys(dist).map(k => dist[k])) > 2) return false;
    }
    return true;
  })());

/* SH3：通道必须真的**连在门上**（两端点与两侧房间的门锚点逐位相等） */
const offDoor = [];
for (const L of M.LINKS) {
  const pts = M.linkPoints(L);
  /* 〔批 M2〕必须带 aAt/bAt：米字布局里舰桥同侧有 3 扇门，不带偏移就永远对不上 */
  const p0 = M.doorPoint(L.a, L.sa, L.aAt), p1 = M.doorPoint(L.b, L.sb, L.bAt);
  const A = pts[0], B = pts[pts.length - 1];
  if (Math.abs(A.x - p0.x) > 1e-6 || Math.abs(A.y - p0.y) > 1e-6) offDoor.push(L.a + '→' + L.b + ' 起点不在门上');
  if (Math.abs(B.x - p1.x) > 1e-6 || Math.abs(B.y - p1.y) > 1e-6) offDoor.push(L.a + '→' + L.b + ' 终点不在门上');
}
ok('SH3：每条通道的两端都精确落在两侧房间的门锚点上（廊不会接在门旁边）',
  offDoor.length === 0, offDoor.slice(0, 3).join('; '));

/* SH4：相机 —— 在房间里时视窗必须**整块落在房间内**（近景的机械定义） */
const camBad = [];
for (const id of M.ids()) {
  const c = M.roomCenter(id);
  const r = M.roomRect(id);
  const cam = M.camera(c.x, c.y, 30, 12, 0.5, r);
  /* 房间比视窗小的轴：居中；比视窗大的轴：夹紧。两种都不许越出房间 */
  if (cam.w <= r.w && (cam.x < r.x - 1e-6 || cam.x + cam.w > r.x + r.w + 1e-6))
    camBad.push(id + ' 视窗横向越出房间');
  if (cam.h <= r.h && (cam.y < r.y - 1e-6 || cam.y + cam.h > r.y + r.h + 1e-6))
    camBad.push(id + ' 视窗纵向越出房间');
  /* 房间比视窗小的轴：必须居中（不许贴边，否则半屏露舱外） */
  if (r.h < cam.h && Math.abs(cam.y - (r.y + (r.h - cam.h) / 2)) > 1e-6)
    camBad.push(id + ' 房间比视窗矮时未居中');
  if (r.w < cam.w && Math.abs(cam.x - (r.x + (r.w - cam.w) / 2)) > 1e-6)
    camBad.push(id + ' 房间比视窗窄时未居中');
  /* anchorY 必须生效（批 SHIP-2 的教训：这条分支曾整个被"房间居中"覆盖，没人发现）。
     用比房间**高**的视窗测：房间 11 格 < 视窗 20 格 ⇒ 走 anchorY 分支，
     cam.y = py − vh×0.34（再夹进船体）。 */
  const camA = M.camera(c.x, c.y, 30, 20, 0.34, r);
  const wantY = Math.max(M.BOUNDS.y, Math.min(M.BOUNDS.h - 20, c.y - 20 * 0.34));
  if (Math.abs(camA.y - wantY) > 1e-6) camBad.push(id + ' anchorY 未生效');
}
ok('SH4：相机在房间里时视窗整块落在该房间内（房间铺满屏幕，不漏出空船体）',
  camBad.length === 0, camBad.slice(0, 3).join('; '));

/* SH5：寻路 —— 任意两间房都能算出折线，**廊里的那几段**必须水平或垂直。
   -------------------------------------------------------------
   ⚠ 这条判据改过两次，两次都是判据写错而不是实现错（记在 改动说明.md）：
     ① 第一版："折线不得穿进除起点终点外的任何房间" —— 错。
        跨两间房的路线本来就是「廊 → 门 → 穿过中转房间 → 门 → 廊」。
     ② 第二版："所有段都必须水平或垂直" —— 也错。
        房间**内部**从站位走到门口本来就是斜线（房间里是空地，没有墙），
        实测把 pharma→safe 判红。
   现在只查**廊段**：取段中点，若它不在任何房间里，这段就在廊里，必须轴对齐。
   这才是"沿通道走"的机械定义 —— 房间里随便走，出了房间必须走廊。 */
const pathBad = [];
const ids = M.ids();
for (const a of ids) {
  for (const b of ids) {
    if (a === b) continue;
    const p = M.path(a, b);
    if (!p || p.pts.length < 3) { pathBad.push(a + '→' + b + ' 折线过短'); continue; }
    for (let i = 0; i + 1 < p.pts.length; i++) {
      const p0 = p.pts[i], p1 = p.pts[i + 1];
      const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      if (M.roomAt(mid.x, mid.y)) continue;          /* 房间里：怎么走都行 */
      const dx = Math.abs(p1.x - p0.x), dy = Math.abs(p1.y - p0.y);
      /* 〔批 M2〕斜段**允许**（米字布局的外环全是斜廊）——
         原来的"禁斜"判据在这里已经没有意义，真正的守卫是下面的逐段求交。 */
    }
    /* 折线不得穿进"不在路线上"的房间（路线上的房间是必经之地，穿它是设计） */
    const onRoute = {};
    for (const id of p.rooms) onRoute[id] = 1;
    for (const id of ids) {
      if (onRoute[id]) continue;
      const r = M.roomRect(id);
      for (let i = 0; i + 1 < p.pts.length; i++) {
        const p0 = p.pts[i], p1 = p.pts[i + 1];
        /* 〔批 M2〕用真正的线段×矩形求交：旧的包围盒判据在斜段上会把
           "只是从房间角外掠过"判成穿房（斜廊一开始全被误报）。 */
        if (M.segHitsRect(p0, p1, r)) { pathBad.push(a + '→' + b + ' 穿进路线外的 ' + id); i = 1e9; break; }
      }
    }
  }
}
ok('SH5：任意两间房之间都能沿通道寻路（允许斜廊，但不得穿进路线外的房间）',
  pathBad.length === 0, pathBad.slice(0, 3).join('; '));

/* SH6：房间语义没动 —— 船体上的房间集合与 space.js 完全一致（不是另起一套） */
const shipIds = M.ids().slice().sort().join(',');
const spaceIds = Object.keys(S.ROOMS).sort().join(',');
ok('SH6：船体房间集合与 space.js 完全一致（只换几何骨架，不重造房间语义）',
  shipIds === spaceIds, shipIds + ' vs ' + spaceIds);

/* =============================================================
 * B 组：渲染器真的消费了这份数据（一律落在函数体内）
 * ============================================================= */

/* SH7：渲染器必须读 SKShip（房位/通道/寻路/相机），而不是自己再写一份几何 */
ok('SH7：渲染器从 js/ship-map.js 取几何（不自己再写一份船体）',
  (function () {
    const ship = bodyOf(sceneCode, 'function shipOf()');
    const origin = bodyOf(sceneCode, 'function roomOrigin(S, roomId)');
    const cam = bodyOf(sceneCode, 'function cameraNow()');
    return !!ship && /global\.SKShip/.test(ship) &&
      !!origin && /M\.roomRect\(/.test(origin) &&
      !!cam && /M\.camera\(/.test(cam) &&
      /* 反向守卫：渲染器里不得出现硬编码的船体房间表（那是"两份几何"的开端） */
      !/const ROOMS = \{/.test(sceneCode);
  })());

/* SH8：通道必须**画出来**，而且廊面 pattern 必须真的被定义。
   -------------------------------------------------------------
   ⚠ 这条是截图抓出来的：第一版写了 fill="url(#sk-floor-corridor)" 却没定义 pattern，
   实测截图上走廊整条是空的（露出船体内衬）。DOM 里 <rect> 在、包围盒也在，
   614 条断言一条都不会报 —— 这就是红线 9「元素存在 ≠ 像素可见」。
   所以判据必须是「引用」与「定义」成对出现，且都在 corridorHtml 体内。 */
ok('SH8：走廊被真的画出来，且廊面 pattern 有定义（引用与定义成对）',
  (function () {
    const body = bodyOf(sceneCode, 'function corridorHtml(M)');
    if (!body) return false;
    const refs = [...body.matchAll(/url\(#(sk-floor-corridor)\)/g)].length;
    const defs = [...body.matchAll(/<pattern id="(sk-floor-corridor)"/g)].length;
    /* 〔批 M1 · 2026-10-28〕走廊从"轴对齐矩形"改成"折线描边"（斜廊必须支持）：
       判据从 corridorRects 改成 corridorSegs + <path ... stroke>。
       **本条的意图不变**：定义（pattern）与引用（stroke="url(#…)")必须成对。 */
    return refs > 0 && defs > 0
      && /M\.corridorSegs\(L\)/.test(body)
      && /<path class="sk-corridor"/.test(body)
      && /stroke="url\(#sk-floor-corridor\)"/.test(body);
  })());

/* SH9：主视图 viewBox 必须由相机决定（不是写死整张船，也不是写死一间房） */
ok('SH9：主视图 viewBox 由相机实时决定（近景，不是整船、也不是写死一间房）',
  (function () {
    const body = bodyOf(sceneCode, 'function render(g, V)');
    if (!body) return false;
    return /const cam = cameraNow\(\)/.test(body) &&
      /const vbStr = \[cam\.x \* TILE, cam\.y \* TILE, cam\.w \* TILE, cam\.h \* TILE\]/.test(body) &&
      /viewBox="' \+ vbStr/.test(body) &&
      /* 反向守卫：不许再出现"整船一次画完"的写死 viewBox */
      !/viewBox="0 0 ' \+ VB\.w/.test(body);
  })());

/* SH10：小地图必须显示**整张地图**（9 间房 + 8 条通道），且只有它显示全船 */
ok('SH10：小地图显示整张地图（9 间房 + 8 条通道 + 我的位置 + 视野框）',
  (function () {
    const body = bodyOf(sceneCode, 'function minimapHtml(M)');
    if (!body) return false;
    return /M\.mapProjection\(MAP_W, MAP_H/.test(body) &&
      /for \(const id of M\.ids\(\)\)/.test(body) &&
      /for \(const L of M\.LINKS\)/.test(body) &&
      /sk-mm-room/.test(body) && /sk-mm-view/.test(body) && /sk-mm-me/.test(body) &&
      /class="sk-minimap"/.test(body) &&
      /* 小地图是纯信息层：不得抢走点击 */
      /\.sk-minimap \{[^}]*pointer-events: none/.test(cssAll);
  })());

/* SH11：走动必须沿通道插值（点目标 → 自动寻路），且**到达后才落定房间**。
   -------------------------------------------------------------
   ⚠ 这条判据改过四次，前三次都是判据被变异绕过（不是实现错）：
     ① "goto 里有 curRoom = roomId 就要求同时有 !requestAnimationFrame"
        ⇒ 变异在 walkTo 前插一句 curRoom = roomId，仍然绿。
     ② "直接落定的位置必须晚于 !requestAnimationFrame" ⇒ 仍然绿。
     ③ "从 guard 到第一次赋值之间括号要配平" ⇒ 仍然绿（找到的是兜底分支里的那处）。
     ④ 逐个检查每一处都必须落在兜底 if 块里 ⇒ **基线就红了** ——
        因为"算不出路径时直接落定"那一处合法地不在 if 里（它自己就是一个兜底）。
   现在的判据把两种**合法的直接落定**枚举出来，其余一律判红：
     (a) 无 rAF 兜底分支里（`!global.requestAnimationFrame` 的 if 块内）；
     (b) "无路径/无目标"兜底里（同一行里带着 `if (!p)` 或 `if (!target)`）。
   这两处都是"走不了，那就直接到"，不是瞬移。任何**别处**的直接落定都是瞬移。 */
ok('SH11：点目标沿通道自动寻路（逐帧插值 + 到达后才落定房间，不瞬移）',
  (function () {
    const walk = bodyOf(sceneCode, 'function walkTo(target, opts)');
    const point = bodyOf(sceneCode, 'function pointOnPath(pts, t)');
    const gotoB = bodyOf(sceneCode, 'function goto(roomId)');
    const prop = bodyOf(sceneCode, 'function walkToProp(roomId, hitKey)');
    if (!walk || !point || !gotoB || !prop) return false;
    if (!/M\.path\(/.test(walk) || !/requestAnimationFrame/.test(sceneCode)) return false;
    if (!/walkTo\(roomId\)/.test(gotoB)) return false;

    /* 逐行检查：出现 curRoom = roomId 的每一行，都必须是上面两种兜底之一 */
    const bad = [];
    for (const fn of [gotoB, prop]) {
      const lines = fn.split('\n');
      for (const ln of lines) {
        if (!/curRoom = roomId/.test(ln)) continue;
        const okLine = /!global\.requestAnimationFrame/.test(ln)   /* (a) 无 rAF 兜底 */
          || /if \(!p\)/.test(ln) || /if \(!target\)/.test(ln)     /* (b) 无路径/无目标兜底 */
          || /stopWalk\(\); curRoom = roomId/.test(ln);            /* 同 (a) 的写法 */
        if (!okLine) bad.push(ln.trim());
      }
    }
    return bad.length === 0;
  })());

/* SH12：全员渲染，但**只画看得见的人**（批 R1 换了判据，守护的是同一条意图）
   -------------------------------------------------------------
   旧口径（批 SHIP）：「只画我」—— 别人一律不进场景。
   新口径（批 R1，用户拍板「只能看到以自身为中心的一个小圈」）：
   所有人都在，但**看不见的人不进 DOM**（不是 display:none —— 否则 F12 就能读出 15 个人的坐标）。
   判据 = 距我 ≤ VISION_R ∩ 两人之间无墙（SKShip.losClear）。

   ⚠ 这条断言的意图必须保住：**不能退化成"全画"**。所以既要求"遍历所有人 + 逐个过可见性"，
     也要求 inSight 本体真的同时用半径与视线（只判距离 = 隔墙透视）。 */
ok('SH12：全员渲染但只画视野内的人（看不见的不进 DOM；判据 = 半径 ∩ 不跨墙）',
  (function () {
    const body = bodyOf(sceneCode, 'function crewHtml(g, V, S)');
    const sight = bodyOf(sceneCode, 'function inSight(from, to, M)');
    if (!body || !sight) return false;
    const loopsAll = /for \(let k = 0; k < players\.length; k\+\+\)/.test(body) ||
      /for \(const p of players\)/.test(body);
    const culls = /if \(!inSight\(pos, at, M2\)\) continue;/.test(body);
    const selfAlways = /html \+= oneCrewHtml\(me, pos, true\);/.test(body);
    const distOk = /if \(d > VISION_R\) return false;/.test(sight);
    const wallOk = /return M\.losClear\(from, to\);/.test(sight);
    return loopsAll && culls && selfAlways && distOk && wallOk;
  })());

/* SH24：视线判据确实存在于数据层，且"墙内一点"看不见（批 R1 新增）
   -------------------------------------------------------------
   为什么必须单独测：SH12 是源码级断言，它只能证明"调用了 losClear"，
   证明不了 losClear 真的会挡住墙。用两个点做运行期验证：
     · 同房间内 3 格 ⇒ 可见（否则视野小到没法玩）；
     · 落在房间上壁里的一点（y = 房间顶 + 1，墙高 2 格）⇒ 不可见。 */
ok('SH24：losClear 真的挡墙（同房间可见 / 墙内不可见）',
  (function () {
    if (!M || typeof M.losClear !== 'function') return false;
    const a = M.roomCenter('bridge');
    const same = { x: a.x + 3, y: a.y };
    /* 上壁 2 格之内，且**避开所有门洞垫片** —— 米字布局下舰桥顶边有 3 扇门
       （at = 8/15/22，门洞垫片各向两侧铺 3.68 格），x=70 那扇的垫片一直铺到 x≈73.7，
       第一版取的 (a.x+5, 墙内) 正好被它盖住 ⇒ "墙内一点"变成了可走。
       x=a.x+27（=75）在两扇门垫片之间，才是真正的墙。 */
    const inWall = { x: a.x + 27, y: M.roomRect('bridge').y + 1 };
    return M.losClear(a, same) === true && M.losClear(a, inWall) === false;
  })());

/* SH13：席位遮挡判定的对外接口仍在（书记官记录板要靠它避让；批 UI-5 的教训） */
ok('SH13：seatRects 仍按"我"的真实绘制矩形给出屏幕坐标（记录板避让依赖它）',
  (function () {
    const body = bodyOf(sceneCode, 'function seatRects()');
    if (!body) return false;
    return /getScreenCTM\(\)/.test(body) &&
      /const w = CREW_BOX\.w\(\), h = CREW_BOX\.h\(\)/.test(body) &&
      /seatRects: seatRects/.test(sceneCode);
  })());

/* =============================================================
 * 〔批 SHIP-2 · 2026-10-27〕玩家能不能**看见自己**：相机让位 + 标签可读
 * -------------------------------------------------------------
 * 本批的三条断言都来自"实测发现、原断言全绿"的缺陷：
 *   SH14 相机 anchorY 被 clampRect 的居中分支吃掉 ⇒ 面板展开时「我」被盖住 65%~100%；
 *   SH15 相机只在重建 DOM 时写 viewBox ⇒ 面板变高时 viewBox 不跟着变（仍被盖）；
 *   SH16 房名钉左上角，正好压在书记官记录板下（重叠 798px²）。
 * 三条都不是"新功能"，而是"原来的实现里有一半没生效" —— 这类缺陷正是
 * 反向自检最容易漏的：断言量的是它想量的东西，但那个东西本来就没接线。
 * ============================================================= */

/* SH14：anchorY 必须真的生效。
   判据直接调 camera()（纯函数），而不是读源码 —— 这样"分支把它覆盖掉"会被抓。
   方向推导（容易写反，这里写清楚）：
     cam.y = 我.y − 视窗高 × ay  ⇒  ay 越小 ⇒ cam.y **越大**（相机越往下看）
     屏幕 y = (船体 y − cam.y) × 缩放  ⇒  cam.y 越大 ⇒ 屏幕 y **越小** ⇒ 人在画面里越高。
   所以「ay 从 0.5 减到 0.34 ⇒ 把人抬起来」等价于 `up.y > half.y`。
   旧实现里房间 11 格 < 视窗 12 格 ⇒ 恒走"居中" ⇒ 两个 ay 得到完全相同的 y。 */
ok('SH14：相机 anchorY 真的生效（面板展开时把人抬起来，不被夹紧分支吃掉）',
  (function () {
    if (!M || typeof M.camera !== 'function') return false;
    const r = M.roomRect('bridge');
    const c = M.roomCenter('bridge');
    const half = M.camera(c.x, c.y, 30, 12, 0.5, r);
    const up = M.camera(c.x, c.y, 30, 12, 0.34, r);
    /* 两者必须不同，且 ay 更小 ⇒ cam.y 更大（相机下移 = 内容上移 = 人更高） */
    return Math.abs(up.y - half.y) > 1e-6 && up.y > half.y;
  })());

/* SH15：相机必须**每次渲染**都写回 viewBox（不能只在重建 DOM 时写）。
   面板高度是渲染之后才定的（renderStage 填表单），key 里只有开关没有高度，
   所以"面板变高但 key 没变"时不会重建 —— 相机必须单独应用一次。

   ⚠ 判据改过一次（反向自检抓出来的）：第一版只判「render 尾部有没有
     `applyCamera(mount)`」，而变异把它包进 `if (key !== sig)` 之后**子串还在** ⇒
     断言照样绿。这正是 AGENTS 红线 11 说的"判据被绕过"。
     现在逐行检查：applyCamera 那一行**不得**带任何条件前缀。 */
ok('SH15：每次渲染都重算并写回相机（面板变高时 viewBox 跟着变，人不会被盖）',
  (function () {
    const render = bodyOf(sceneCode, 'function render(g, V)');
    const apply = bodyOf(sceneCode, 'function applyCamera(mount)');
    if (!render || !apply) return false;
    /* 只取 render 里「lastG = g;」之后的部分：那是"每次渲染都会执行"的收尾段 */
    const tail = render.slice(render.lastIndexOf('lastG = g;'));
    if (!tail) return false;
    const lines = tail.split('\n').filter(ln => /applyCamera\s*\(/.test(ln));
    if (!lines.length) return false;
    /* 每一处调用都必须是"裸调用"：行首直接是标识符，不许 if/else/?/&& 包着 */
    const bare = lines.every(ln => /^\s*applyCamera\s*\(/.test(ln));
    return bare && /setAttribute\('viewBox'/.test(apply);
  })());

/* SH16：房名不得钉在左上角（那里是书记官记录板/小地图的地盘）。
   判据：房名的 x 必须由**房间右边界**推出，且 text-anchor="end"。
   实测旧写法 x = o.x*TILE + 14、无 anchor ⇒ 与记录板重叠 798px²。 */
ok('SH16：房名钉在房间右上角（避开左上角的书记官记录板与小地图）',
  (function () {
    const body = bodyOf(sceneCode, 'function roomHtml(S)');
    if (!body) return false;
    const m = /class="sk-room-name" x="' \+ \(([^)]*)\)/.exec(body);
    if (!m) return false;
    const expr = m[1];
    return /o\.x \+ o\.w/.test(expr) && /text-anchor="end"/.test(body);
  })());

/* SH17：门标签必须落在**房间内侧**，并且有描边（否则压在浅色地板上读不出）。
   判据两半：渲染器按 side 把标签推进房内 + CSS 里 .sk-door-t 带 paint-order:stroke。

   ⚠ 判据改过一次（反向自检抓出来的）：第一版只判「body 里有没有
     `d.side === 'l'`」，而 roomHtml 里**门热区收边**本来就有同一个 token
     （`if (d.side === 'l') { rx = o.x; … }`）⇒ 把标签那支改坏，另一支还在，断言照样绿。
     这正是本文件开头那条规矩（B 组判据落在函数体内）的**同源错误**：
     落在函数体内还不够，还要落在**正确的那一小段**里。 */
ok('SH17：门标签推进房间内侧并带描边（"这扇门通向哪间房"要读得出来）',
  (function () {
    const body = bodyOf(sceneCode, 'function roomHtml(S)');
    if (!body) return false;
    /* 抠出"标签让位"那一段：从 const off 到 data-side 输出 */
    const i = body.indexOf('const off = TILE');
    const j = body.indexOf('data-side=');
    if (i < 0 || j < 0 || j < i) return false;
    const seg = body.slice(i, j);
    /* 左右两侧都必须把标签推离门洞（RX + DW + off / RX - off） */
    const left = /d\.side === 'l'\)\s*\{[^}]*RX \+ DW \+ off/.test(seg);
    const right = /d\.side === 'r'\)\s*\{[^}]*RX - off/.test(seg);
    const css = /\.sk-door-t \{[^}]*paint-order:\s*stroke/.test(cssAll);
    return left && right && css;
  })());

/* SH18：规则速览的"打开"必须同时渲染（首局自动弹出走的是这条路）。
   实测缺陷：ui.js openRules() 只 remove('hidden')，首局自动弹出后正文永远停在
   「正在载入规则数据…」（3 页签 / 0 张卡）。渲染器在 arena.js，必须被 openRules 调到。

   ⚠ 判据改过一次（反向自检抓出来的）：第一版只判「body 里有没有
     `global.SKArena.renderRules`」，而下面的兜底分支里还写着同一段 ——
     把主分支改成 `if (false && …)`，兜底那句仍在 ⇒ 断言照样绿。
     现在要求：**第一处**提到 renderRules 的那一行必须是裸 if（不带 false/0/null 之类）。 */
ok('SH18：规则速览「打开即渲染」（首局自动弹出的那条路也能看到内容）',
  (function () {
    const src = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    const body = bodyOf(src, 'function openRules()');
    if (!body) return false;
    const lines = body.split('\n').filter(ln => /renderRules/.test(ln));
    if (!lines.length) return false;
    /* 第一处调用必须是可执行的 if 条件：不许 false/0/null/void 打头 */
    const first = lines[0];
    const disabled = /if\s*\(\s*(false|0|null|undefined|''|"")\s*(\|\||&&)/.test(first)
      || /if\s*\(\s*!\s*global\.SKArena/.test(first);
    return !disabled && /global\.SKArena\s*&&\s*global\.SKArena\.renderRules/.test(first);
  })());

/* =============================================================
 * 〔批 WALK · 2026-10-28〕自由行走：可行走面 + 点任意处寻路
 * -------------------------------------------------------------
 * 用户原话：「调整人物行走逻辑，现在可在地图中自由行走」。
 * 上一版人只能"点门 → 沿固定的房间级折线走"，站位由 anchorInRoom 推出来。
 * 本批补了键盘连续走位与点地面寻路，于是多了两组必须守的东西：
 *   · 数据层（SH19/SH20）：可行走面必须覆盖房间与通道、门口必须走得通、
 *     任意两点之间必须真能算出**不穿墙**的折线；
 *   · 渲染层（SH21~SH23）：键盘/点击/落点三条路径必须真的接上了，
 *     且"玩家自己走过之后不再被自动搬运"（否则自由行走名存实亡）。
 * ============================================================= */

/* SH19：可行走面 —— 房间内部、通道、门口三者都要通。
   ⚠ 这一条守的是本批最容易写错的那个数：房间内缩（避墙）之后，
     门与内缩边之间会多出一道死缝，必须靠通道带**伸进房间**（WALK_DOOR_REACH）补上。
     只测"房间中心可走"抓不到这个缺陷（中心离门 15 格），所以必须单独测"门内 1.2 格"。 */
ok('SH19：可行走面覆盖 9 间房 + 8 条通道，且每个门口都走得通（人不会卡在门里）',
  (function () {
    if (!M || typeof M.walkable !== 'function' || typeof M.walkRects !== 'function') return false;
    /* 〔批 M1 · 2026-10-28〕走廊不再是"矩形"，walkRects 只返回房间内缩矩形；
       走廊改成 corridorSegs（折线 + 宽度），所以这里分开数：
         · 房间数必须等于 ids（每间房都要能站）；
         · 每条通道至少要有一段（零段 = 那条廊根本不存在）。 */
    const rects = M.walkRects();
    if (rects.length !== M.ids().length) return false;
    if (typeof M.corridorSegs !== 'function') return false;
    for (const L of M.LINKS) if (!M.corridorSegs(L).length) return false;
    const bad = [];
    for (const id of M.ids()) {
      const r = M.roomRect(id), c = M.roomCenter(id);
      if (!M.walkable(c.x, c.y)) bad.push(id + ' 中心不可走');
      /* 房间两角（内缩后）：只测中心会让"整间房只剩一个小圈能走"漏过 */
      if (!M.walkable(r.x + 1.3, r.y + 3.2)) bad.push(id + ' 左上角不可走');
      if (!M.walkable(r.x + r.w - 1.3, r.y + r.h - 1.2)) bad.push(id + ' 右下角不可走');
    }
    for (const L of M.LINKS) {
      /* 门锚点必须带偏移（米字布局下同侧可能有两扇门） */
      const a = M.doorPoint(L.a, L.sa, L.aAt), b = M.doorPoint(L.b, L.sb, L.bAt);
      if (!a || !b) { bad.push(L.a + '→' + L.b + ' 门锚点缺失'); continue; }
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      if (!M.walkable((a.x + b.x) / 2, (a.y + b.y) / 2)) bad.push(L.a + '→' + L.b + ' 廊中点不可走');
      /* 门内 **1.8 格**（不是 1.2）：a 端朝房内是 −u，b 端朝房内是 +u。
         〔批 M1〕1.2 测不出死缝 —— 走廊半宽 1.3 格，端点就在房间边界上，
         \"门内 1.2 格\"离线段只有 1.2 < 1.3，即使通道不带伸进房间也照样判可走，
         于是 SH19 会在\"门口真的卡人\"时仍然全绿。1.8 > 1.3 才真正要求延伸段。 */
      if (!M.walkable(a.x - ux * 1.8, a.y - uy * 1.8)) bad.push(L.a + ' 门内不可走');
      if (!M.walkable(b.x + ux * 1.8, b.y + uy * 1.8)) bad.push(L.b + ' 门内不可走');
    }
    return bad.length === 0;
  })());

/* SH20：任意两间房之间都能**自由走过去**：A* 折线全程落在可行走面上。
   判据不是"有没有返回值"，而是**逐段采样**：折线穿墙时返回值照样存在、
   长度也照样比直线长 —— 只判存在性的话，"直线穿墙"这种最严重的错误会全绿。 */
ok('SH20：任意两间房之间都能走过去，且折线全程不穿墙（逐段采样）',
  (function () {
    if (!M || typeof M.walkPath !== 'function') return false;
    const ids = M.ids();
    const bad = [];
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const A = M.roomCenter(a), B = M.roomCenter(b);
        const p = M.walkPath(A, B);
        if (!p || !p.pts || p.pts.length < 2) { bad.push(a + '→' + b + ' 无路'); continue; }
        if (p.len < Math.hypot(B.x - A.x, B.y - A.y) - 1e-6) { bad.push(a + '→' + b + ' 比直线还短'); continue; }
        let hit = false;
        for (let i = 0; i + 1 < p.pts.length && !hit; i++) {
          const s = p.pts[i], t = p.pts[i + 1];
          for (let k = 0; k <= 10; k++) {
            const q = k / 10;
            if (!M.walkable(s.x + (t.x - s.x) * q, s.y + (t.y - s.y) * q)) {
              bad.push(a + '→' + b + ' 穿墙'); hit = true; break;
            }
          }
        }
      }
    }
    return bad.length === 0;
  })());

/* SH21：键盘真的是**连续速度移动 + 逐轴滑动**，不是"四向瞬移"。
   判据全部落在函数体里（AGENTS 红线 11），并且分开判三个函数：
     · stepFreeWalk：读方向向量、逐轴滑动、写落点、更新所在房间；
     · slideMove：撞墙判据只认 SKShip.walkable（不自己算墙）；
     · bindKeys：只挂一次、输入框里不抢键、非对局页不抢键。 */
ok('SH21：键盘自由行走 = 逐帧速度移动 + 逐轴滑动（撞墙沿墙走，不瞬移）',
  (function () {
    const step = bodyOf(sceneCode, 'function stepFreeWalk(dt)');
    const slide = bodyOf(sceneCode, 'function slideMove(from, dx, dy)');
    const keys = bodyOf(sceneCode, 'function bindKeys()');
    if (!step || !slide || !keys) return false;
    const stepOk = /keyVector\(\)/.test(step) && /slideMove\(from,/.test(step) &&
      /paintWalk\(to\)/.test(step) && /freePos = to/.test(step) && /M\.roomAt\(to\.x, to\.y\)/.test(step) &&
      /* 起步先收敛到可站位置：宿舍 1/2/4/5 号舱位的锚点正好在可行走面上沿之外 0.1 格，
         不收敛的话从舱位按方向键会被判成"四向撞墙"，人一动不动。 */
      /!M\.walkable\(from\.x, from\.y\) && M\.nearestWalkable/.test(step);
    /* 两个轴必须是**各自独立的两句**：合成成一句 "两轴都通才动" 会让撞墙时整个人停住
       （斜着撞墙 = 走不动），而这一条正是自由行走的手感所在。 */
    const slideOk = /if \(dx && M\.walkable\(x \+ dx, y\)\) x \+= dx;/.test(slide) &&
      /if \(dy && M\.walkable\(x, y \+ dy\)\) y \+= dy;/.test(slide);
    const keysOk = /KEY_DIR\[e\.key\]/.test(keys) && /isTypingTarget\(e\.target\)/.test(keys) &&
      /sceneLive\(\)/.test(keys) && /startFreeWalk\(\)/.test(keys) && /keyup/.test(keys);
    return stepOk && slideOk && keysOk;
  })());

/* SH22：点地面 → ship-map.walkPath → walkAlong（与点门共用同一条 runner），
   且**不得抢走**门/席位/道具的既有交互。
   顺序判据：bind 的点击处理里 onGroundClick 必须出现在 data-door 之后 ——
   反过来写的话，点门会先被"走到那扇门"吃掉，房间就再也切不过去了。 */
ok('SH22：点场景空地会走过去（A* 折线），且不抢门/道具/席位的既有交互',
  (function () {
    const pt = bodyOf(sceneCode, 'function walkToPoint(pt)');
    const ground = bodyOf(sceneCode, 'function onGroundClick(pt, mount)');
    const bd = bodyOf(sceneCode, 'function bind(mount)');
    const along = bodyOf(sceneCode, 'function walkAlong(p, room, end)');
    if (!pt || !ground || !bd || !along) return false;
    if (!/M\.walkPath\(from, pt\)/.test(pt) || !/walkAlong\(p,/.test(pt)) return false;
    if (!/M\.nearestWalkable\(pt\.x, pt\.y\)/.test(ground) || !/walkToPoint\(q\)/.test(ground)) return false;
    /* runner 必须吃到 end（点地面要停在点击点，不许走完弹回锚点） */
    if (!/end: end \|\| null/.test(along) || !/walkState = \{ pts: pts/.test(along)) return false;
    /* 〔批 DEMO〕席位点击已拆除 —— 顺序只剩 门 < 道具 < 走路（点人物落到走路分支） */
    const iDoor = bd.indexOf("closest('[data-door]')");
    const iHit = bd.indexOf("closest('[data-hit]')");
    const iGround = bd.indexOf('onGroundClick(');
    return iDoor > 0 && iHit > iDoor && iGround > iHit;
  })());

/* SH23：落点真源 —— freePos。
   三处必须同时在：
     ① myPos：freePos 分支必须**优先于** anchorInRoom（否则一停下就弹回座位）；
     ② startWalkAnim：到达时把 end 落进 freePos（点地面停在原地）；
     ③ render：玩家自己走过（freePos 非空）之后，不再被"带去决策房"（否则自由行走名存实亡）。 */
ok('SH23：玩家走过之后的落点由 freePos 决定（不再停一下就弹回座位 / 被自动拽走）',
  (function () {
    const pos = bodyOf(sceneCode, 'function myPos()');
    const anim = bodyOf(sceneCode, 'function startWalkAnim()');
    const rnd = bodyOf(sceneCode, 'function render(g, V)');
    if (!pos || !anim || !rnd) return false;
    const iFree = pos.indexOf('if (freePos) return');
    const iAnchor = pos.indexOf('anchorInRoom(S, curRoom)');
    const posOk = iFree > 0 && iAnchor > iFree;
    const animOk = /const end = walkState\.end \|\| null;/.test(anim) && /freePos = end;/.test(anim);
    const rndOk = /want !== curRoom && !freePos/.test(rnd);
    return posOk && animOk && rndOk;
  })());

/* SH25：别人的走动必须**逐帧只改 transform**，只有"进出视野"才重建 DOM
   -------------------------------------------------------------
   用户原话：「他们闲置的时候不再待在宿舍或静默，也会进行行动」。
   实现要点（改这里必须先读）：
     · 每帧给 14 个人重建整船 DOM ⇒ 掉到个位数帧率，所以有 paintCrew 直改 transform；
     · 只有"进/出视野"才需要增删节点 ⇒ 只有那条分支允许 sig = null；
     · 非对局页不跑（sceneLive）—— 主页/结算页不该有人在动。 */
ok('SH25：别人的走动逐帧只改 transform（重建只发生在进出视野时，且非对局页停跑）',
  (function () {
    const step = bodyOf(sceneCode, 'function stepOneCrew(id, dt)');
    const raw2 = bodyOf(sceneCode, 'function setCrewPosRaw(id, at)');
    const loop = bodyOf(sceneCode, 'function startWander()');
    const paint = bodyOf(sceneCode, 'function paintCrew(id, pos, walking, dir)');
    if (!step || !raw2 || !loop || !paint) return false;
    const paints = /paintCrew\(id, pos, true, dir\);/.test(step);
    const onlyOnFlip = /if \(visBefore !== visAfter\) \{/.test(step) &&
      (step.match(/sig = null;/g) || []).length <= 1;
    const rawNoSig = !/sig = null/.test(raw2);
    const live = /if \(!sceneLive\(\)\)/.test(loop);
    const transform = /setAttribute\('transform'/.test(paint);
    return paints && onlyOnFlip && rawNoSig && live && transform;
  })());

/* SH26：相位倒计时必须由 SKClock 驱动，且**只改文本**（批 R4-lite）
   -------------------------------------------------------------
   用户拍板：夜 90s / 昼 60s / tick 0.25s（js/engine/clock.js）。
   这里守两件事：① 文本来自 `SKClock.fmt(SKClock.remaining(...))`（不是自己算秒）；
   ② 定时刷新只改 `textContent` —— 每 250ms 重建整船 DOM 会打断角色动画与行走。 */
ok('SH26：相位倒计时由 SKClock 驱动，刷新只改文本（不重建 DOM）',
  (function () {
    const clock = bodyOf(sceneCode, 'function clockHtml(g)');
    const start = bodyOf(sceneCode, 'function startClock()');
    if (!clock || !start) return false;
    /* ⚠ 必须数"两处"：初次渲染（clockHtml）与定时刷新（startClock）都要问时钟。
       第一版只判 clockHtml 里有没有这句，把刷新那行写成 '0:00' 仍然全绿 —— 是空转。 */
    const driven = (sceneCode.match(/C\.fmt\(C\.remaining\(st, now\(\)\)\)/g) || []).length;
    return driven >= 2 &&
      /setInterval\(function \(\)/.test(start) &&
      /\}, 250\);/.test(start) &&
      /box\.textContent = txt/.test(start) &&
      !/innerHTML/.test(start) &&
      /\+ clockHtml\(g\)/.test(sceneCode);
  })());

/* SH27：万物可交互，但**指纹决定是否生效**（批 R4-step1）
   -------------------------------------------------------------
   用户拍板的设计哲学（纲要 §2.1/§2.2）：
     · 所有玩家都能点任何物件、点了都有反馈；
     · 是否生效看该动作的权能指纹与本人能力是否匹配；
     · **失败反馈必须中性**（写"你没有权限"就等于暴露身份）。
   场景层只拦"该物件对应的动作**全部**是 grant 型、本人一个都不具备"的情况；
   mechanism / base 型（异形出刀、船员协助维修…）声明层没有 grants，必须放行给引擎判。 */
ok('SH27：指纹闸门 —— grant 型物件按能力拦截，机制位放行，失败文案中性',
  (function () {
    const gate = bodyOf(sceneCode, 'function capGate(hitKey, mount)');
    const click = bodyOf(sceneCode, 'function bind(mount)') || sceneCode;
    if (!gate) return false;
    const grantOnly = /A\.CAPS\[a\.cap\] === 'grant' \|\| A\.CAPS\[a\.cap\] === 'charge'/.test(gate);
    const mixedPass = /if \(!decisive\.length \|\| decisive\.length < list\.length\) return true;/.test(gate);
    const byCap = /decisive\.some\(a => RD\.hasGrant\(role, a\.cap\) \|\| ch\[a\.cap\] != null\)/.test(gate);
    const neutral = /toast\(mount, '设备没有响应'\)/.test(gate) &&
      !/没有权限|无权限|你不是/.test(gate);
    const wired = /if \(!capGate\(key, mount\)\) return;/.test(click);
    return grantOnly && mixedPass && byCap && neutral && wired;
  })());

console.log('');
console.log('整船图门禁：通过 ' + pass + ' 条、失败 ' + fail + ' 条');
if (fail) process.exitCode = 1;
