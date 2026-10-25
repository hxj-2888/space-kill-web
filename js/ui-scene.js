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

  /* 单席：<g> = 裁剪头像 + 色环 + 编号徽章 + 状态叠加件（闭眼暗幕 / 出局✕） */
  function seatSvg(p, i, st) {
    const a = ANG[i - 1];
    const x = GEO.cx + Math.cos(a) * (st.out ? GEO.outRx : GEO.rx);
    const y = GEO.cy + Math.sin(a) * (st.out ? GEO.outRy : GEO.ry);
    const r = GEO.seatR;
    const clip = 'sk-clip-' + i;
    const img = ASSET.replace('XX', String(i).padStart(2, '0'));
    const ring = st.mine ? MINE : PALETTE[i - 1];
    const tilt = st.out ? ' transform="rotate(-8 ' + x.toFixed(1) + ' ' + y.toFixed(1) + ')"' : '';
    return '<g id="sk-seat-' + i + '" data-seat="' + i + '" class="sk-seat'
      + (st.mine ? ' sk-mine' : '') + (st.out ? ' sk-out' : '') + (st.closed ? ' sk-closed' : '') + '"' + tilt + '>'
      + '<defs><clipPath id="' + clip + '"><circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (r - 2) + '"/></clipPath></defs>'
      + '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r + '" fill="#0a0f18" stroke="' + ring + '" stroke-width="' + (st.mine ? 4 : 3) + '"/>'
      + '<image href="' + escAttr(img) + '" xlink:href="' + escAttr(img) + '" x="' + (x - r + 2).toFixed(1) + '" y="' + (y - r + 2).toFixed(1)
      + '" width="' + (2 * r - 4) + '" height="' + (2 * r - 4) + '" clip-path="url(#' + clip + ')" preserveAspectRatio="xMidYMid slice"/>'
      + (st.closed
        ? '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (r - 2) + '" class="sk-lids"/>'
          + '<text x="' + x.toFixed(1) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="middle" class="sk-lids-t">‿‿</text>'
        : '')
      + (st.out ? '<text x="' + (x + r - 5).toFixed(1) + '" y="' + (y - r + 8).toFixed(1) + '" text-anchor="middle" class="sk-out-x">✕</text>' : '')
      + '<circle cx="' + x.toFixed(1) + '" cy="' + (y - r + 1).toFixed(1) + '" r="11" class="sk-num-bg" stroke="' + ring + '"/>'
      + '<text x="' + x.toFixed(1) + '" y="' + (y - r + 5).toFixed(1) + '" text-anchor="middle" class="sk-num">' + i + '</text>'
      + '</g>';
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

  let sig = null;
  /** 渲染入口（ui.render 每 tick 调）：签名不变则零 DOM 写入。 */
  function render(g, V) {
    if (!g || !V || !V.players || V.players.length !== N) return;
    const doc = global.document;
    const mount = doc && doc.getElementById ? doc.getElementById('scene-mount') : null;
    if (!mount) return;
    /* pending 只为真人步骤存在（AI 步骤即时结算）⇒ 「pending 非 stream = 轮到我」 */
    const myTurn = !!(g.pending && !g.pending.stream);
    const key = [V.id, g.phase === 'night' ? 1 : 0, myTurn ? 1 : 0,
      V.players.map(p => (p.out ? 1 : 0)).join('')].join('|');
    if (key === sig && mount.__skBuilt) return;
    const svg = svgFor(g, V, myTurn);
    if (!svg) return;
    mount.innerHTML = svg;
    mount.__skBuilt = true;
    sig = key;
  }

  global.SKScene = { render, _ang: ANG, _palette: PALETTE };
})(typeof window !== 'undefined' ? window : globalThis);
