/* =============================================================
 * SKSceneConst · 场景渲染的**常量表**（批 ART-0/B1a · 2026-10-28）
 * -------------------------------------------------------------
 * 职责：   只放"不随对局变化"的常量：格寸、素材根路径、视窗格数、
 *          席位调色板、角色行走图的版式与可见内容比例。
 * 不变量： · 纯常量，**零状态、零 DOM、零函数副作用**（CREW_BOX 是纯派生函数）；
 *          · 本文件不许读 global 上任何业务对象（SKSpace / SKShip / g / V）；
 *          · 改数值 = 改画面，必须配截图核对（AS2 / SH9 / W1 只守一部分）。
 * 依赖：   无（全站最底层之一，只被场景层读）。
 * 状态：   无。
 * 对外：   global.SKSceneConst（ui-scene.js 在 IIFE 顶部整体解构，调用点一个字不改）。
 * 门禁：   test:ship（SH9/SH10/SH13 间接依赖 TILE / CREW_BOX）、test:space（U2A2/U2A3/W1）。
 *
 * 为什么先拆这一块（而不是先拆 render）：
 *   它是**唯一一块零状态**的东西 —— 搬走不涉及任何闭包变量，
 *   正好用来打通"新目录 → load-order → index.html → 门禁源码解析"这条链路；
 *   把有状态的模块（walk / render）留给后面的批次，风险分开付。
 * ============================================================= */
(function (global) {
  'use strict';

  /* 一格 = 56px（批 SHIP 定的：30×12 格视窗铺满主区，见 ui-scene.js 的注释） */
  const TILE = 56;
  const ASSET = 'assets/scene/cozy/';
  const VIEW_TILES = { w: 30, h: 12 };
  /* 画布像素 = 视窗格数 × TILE。渲染时 viewBox 由相机实时改写（见 ui-scene.js 的 render）。 */
  const VB = { w: VIEW_TILES.w * TILE, h: VIEW_TILES.h * TILE };

  /* 席位 15 色（与 space.js 的座位顺序对齐；仅用于底座光环） */
  const PALETTE = ['#ff6b6b', '#ff922b', '#fcc419', '#c0eb75', '#69db7c', '#38d9a9', '#3bc9db',
    '#4dabf7', '#748ffc', '#9775fa', '#da77f2', '#e64980', '#f783ac', '#ffe066', '#94d82d'];
  const MINE = '#ffd43b';

  /* 角色行走图：4 列 × 5 行，单帧 96×160
     〔批 UI-2〕15 席各有独立行走图（assets/scene/crew/crew-NN.png），
     外观与本局身份**完全无关**（只按席位号取，不读 role/faction —— 否则等于泄露阵营）。 */
  const CREW_W = 96, CREW_H = 160;
  const CREW_COUNT = 15;
  /* 注：`CREW_FILE(id)`（席位号 → 文件名）暂时留在 js/ui-scene.js。
     v26 的 UI2-c/UI2-d 直接断言它在那个文件里（"一对一取图、不读 role/faction"），
     搬它必须同批改 v26 的判据 —— 那属于 B1b（与 crew 帧一起拆），本批不掺。 */

  /* 〔批 UI-7〕行走图的**可见内容**占比（实测，不是估计）：
     待机帧 y 48..159（112/160）、x 20..79（60/96）。
     按可见宽定尺寸（= 1.15 格），再把帧框反推回去 —— 换图只改这里。 */
  const CREW_VIS_W = 60 / CREW_W;   /* 可见宽 / 帧宽 */
  const CREW_VIS_H = 112 / CREW_H;  /* 可见高 / 帧高（待机行） */
  const CREW_VIS_TILES = 1.15;      /* 可见宽 = 多少格 */
  const CREW_BOX = {
    w: function () { return (TILE * CREW_VIS_TILES) / CREW_VIS_W; },
    h: function () { return ((TILE * CREW_VIS_TILES) / CREW_VIS_W) * (CREW_H / CREW_W); },
    visW: function () { return TILE * CREW_VIS_TILES; },
    visH: function () { return ((TILE * CREW_VIS_TILES) / CREW_VIS_W) * (CREW_H / CREW_W) * CREW_VIS_H; },
  };
  /* 行序：0 下走 / 1 上走 / 2 待机 / 3 左走 / 4 右走 */
  const ROW_IDLE = 2;

  /* 〔批 R1〕视野半径（格）：以自身为圆心的小圈；**不跨墙**由 SKShip.losClear 判。
     9 格 ≈ 半屏（视窗 30×12），也就是"看得见隔壁走廊，看不见隔壁房间"。
     它同时是枪的射程（射程 = 视野）—— 改这个数会同时改射击距离。 */
  const VISION_R = 9;

  global.SKSceneConst = {
    TILE: TILE, ASSET: ASSET, VIEW_TILES: VIEW_TILES, VB: VB,
    PALETTE: PALETTE, MINE: MINE,
    CREW_W: CREW_W, CREW_H: CREW_H, CREW_COUNT: CREW_COUNT,
    CREW_VIS_W: CREW_VIS_W, CREW_VIS_H: CREW_VIS_H, CREW_VIS_TILES: CREW_VIS_TILES,
    CREW_BOX: CREW_BOX,
    ROW_IDLE: ROW_IDLE,
    VISION_R: VISION_R,
  };
})(typeof window !== 'undefined' ? window : globalThis);
