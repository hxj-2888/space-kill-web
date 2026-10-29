/* =============================================================
 * SKSceneCrew · 角色**行走图**的取图与帧切换（批 ART-0/B1b · 2026-10-28）
 * -------------------------------------------------------------
 * 职责：   ① 席位号 → 行走图文件名（一对一，不取模复用旧素材）；
 *          ② 朝向 → 行走图的行（下/上/待机/左/右），换行时改 `svg.sk-frame` 的 viewBox；
 *          ③ 行走状态 → `.sk-crew-layer.sk-walking` 与 `--step-ms`
 *             （腿的摆动频率与前进速度唯一的同步点）。
 * 不变量： · **外观与本局身份无关**：这里只吃"席位号"，不读 role / faction（违 7.0 防透视）；
 *          · 帧版式固定 4 列 × 5 行、单帧 96×160（见 js/scene/const.js 的 CREW_W/CREW_H）；
 *          · 纯 DOM 操作 + 纯函数，**零业务状态**（站位/相机/房间都不在这里）。
 * 依赖：   js/scene/const.js（版式常量）、CSS 的 @keyframes sk-walk-frames。
 * 状态：   无。
 * 对外：   global.SKSceneCrew = { CREW_FILE, ROW_OF, SET_CREW_ROW, setCrewFrame }
 *          setCrewFrame(g, dir, walking, stepMs) —— stepMs 由调用方按 WALK_SPEED 算，
 *          这样"走多快"仍然只有一个真源（js/ui-scene.js 的 WALK_SPEED）。
 * 门禁：   test:space 的 U2A2（四向选行）/ T2（--step-ms 真的写出来）、
 *          v26 的 UI2-c/UI2-d（一对一取图 + 不读 role/faction）。
 * ============================================================= */
(function (global) {
  'use strict';

  const C = global.SKSceneConst;
  if (!C) throw new Error('scene/crew：缺少 js/scene/const.js（加载顺序见 tools/load-order.cjs）');

  const CREW_W = C.CREW_W, CREW_H = C.CREW_H, CREW_COUNT = C.CREW_COUNT;
  const ROW_IDLE = C.ROW_IDLE;
  /* 行序：0 下走 / 1 上走 / 2 待机 / 3 左走 / 4 右走（与 tools/gen-crew-sprites.cjs 同序） */
  const ROW_OF = { down: 0, up: 1, left: 3, right: 4 };

  /* 席位号 → 文件名（1..15 一对一；不读 role/faction —— 外观与身份必须解耦） */
  const CREW_FILE = id => 'crew-' + String(((id - 1) % CREW_COUNT) + 1).padStart(2, '0');

  /* 某一朝向该取行走图的哪一行（待机 = ROW_IDLE） */
  function SET_CREW_ROW(dir, walking) {
    return walking ? (ROW_OF[dir] == null ? ROW_IDLE : ROW_OF[dir]) : ROW_IDLE;
  }

  /* 切换一个角色节点的帧 + 行走类 + 步频。
     g     = <g class="sk-crew"> 节点
     dir   = 'down' | 'up' | 'left' | 'right'
     walking = 是否在走（false ⇒ 待机行，并摘掉 .sk-walking）
     stepMs  = 4 帧循环时长（毫秒）；调用方按"1 格走多久"算，见 ui-scene 的 setCrewFrame 包装 */
  function setCrewFrame(g, dir, walking, stepMs) {
    const fr = g && g.querySelector ? g.querySelector('svg.sk-frame') : null;
    if (!fr) return;
    const row = SET_CREW_ROW(dir, walking);
    fr.setAttribute('viewBox', '0 ' + (CREW_H * row) + ' ' + CREW_W + ' ' + CREW_H);
    const layer = g.closest ? g.closest('.sk-crew-layer') : null;
    if (layer && layer.classList) {
      layer.classList.toggle('sk-walking', !!walking);
      if (walking) {
        const ms = stepMs == null ? Math.round((1 / 7.5) * 1000) : stepMs;
        if (layer.style && layer.style.setProperty) layer.style.setProperty('--step-ms', ms + 'ms');
      }
    }
  }

  global.SKSceneCrew = {
    CREW_FILE: CREW_FILE,
    ROW_OF: ROW_OF,
    SET_CREW_ROW: SET_CREW_ROW,
    setCrewFrame: setCrewFrame,
  };
})(typeof window !== 'undefined' ? window : globalThis);
