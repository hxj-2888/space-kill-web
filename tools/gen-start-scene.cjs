/* =============================================================
 * 开始页「返航环」静态素材生成器（批 S4）
 *
 * 产物：assets/scene/bg/departure-ring.svg（一次性生成，静态文件，运行时不生成）
 *
 * 为什么是静态 SVG 而不是运行时渲染：
 *   · 开始页在**开局前**，此时没有任何对局状态（无 g / 无 View），
 *     SKScene 的三段结构（席位/房间/书记官）全部依赖 viewFor，套不上；
 *   · 静态素材零 JS、零随机、零渲染开销，指纹天然不变（红线 3 的顺证）。
 *
 * 几何与 ui-scene 的等弧长座次同口径（椭圆周长 2400 段积分 + 二分）——
 * 手摆坐标在椭圆上必然角密度不均，这正是 S0 预览踩过的坑。
 *
 * 用法：node tools/gen-start-scene.cjs [--force]
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'assets', 'scene', 'bg', 'departure-ring.svg');
const FORCE = process.argv.includes('--force');

/* ---- 几何（viewBox 400×300：横向舷窗视野，比圆桌场景更宽） ----
   ⚠ 参数不是随手填的：15 席挤在一个椭圆上，**短轴方向必然最密**。
   实测（.tmp_shots/_tune-ring.cjs）：rx/ry = 132/92 时最小中心距只有 33.1px，
   而席位半径 19 ⇒ 直径 38 > 33.1，圆会重叠（首版就是这么错的，肉眼在缩略图上不明显）。
   取 160/112 ⇒ 最小中心距 40.3，半径 19 时留 2.3px 缝；半径上限 19.2 是硬约束，
   再大就必须继续放大椭圆（会顶出 viewBox 宽度）。 */
const VB = { w: 400, h: 300 };
const CX = 200, CY = 152;
const RX = 160, RY = 112;         /* 座圈（椭圆，透视压缩） */
const SEAT_R = 19;
const N = 15;

/* 等弧长座次：与 js/ui-scene.js 的 ANG 同算法（勿改成均匀角度——椭圆上会角密度不均） */
function evenArcAngles(n, rx, ry) {
  const steps = 2400, acc = [0];
  for (let k = 1; k <= steps; k++) {
    const t = k / steps * Math.PI * 2;
    const dx = rx * Math.sin(t), dy = ry * Math.cos(t);
    acc.push(acc[k - 1] + Math.hypot(dx, dy) / steps);
  }
  const total = acc[steps], out = [];
  for (let j = 0; j < n; j++) {
    const target = j / n * total;
    let lo = 0, hi = steps;
    while (lo < hi) { const m = (lo + hi) >> 1; if (acc[m] < target) lo = m + 1; else hi = m; }
    const prev = lo > 0 ? acc[lo - 1] : 0;
    const f = (target - prev) / Math.max(1e-9, acc[lo] - prev);
    out.push(((lo - 1) + f) / steps * Math.PI * 2 + Math.PI / 2);
  }
  return out;
}

/* 三阵营配色（与 06-scene.css / 设计令牌同源：人类蓝 / 异形红 / 外星人绿） */
const PALETTE = [
  '#4aa8ff', '#4aa8ff', '#4aa8ff', '#ff5a7a', '#4aa8ff', '#4aa8ff', '#4aa8ff', '#ff5a7a',
  '#4aa8ff', '#5ce6a8', '#4aa8ff', '#4aa8ff', '#4aa8ff', '#ff5a7a', '#4aa8ff',
];

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

const angles = evenArcAngles(N, RX, RY);

let seats = '';
for (let i = 1; i <= N; i++) {
  const a = angles[i - 1];
  const x = (CX + Math.cos(a) * RX).toFixed(1);
  const y = (CY + Math.sin(a) * RY).toFixed(1);
  const ring = PALETTE[i - 1];
  /* 远景席位：只画环 + 编号，不画头像（开始页还没分配身份，画脸=暗示席位角色） */
  seats += '  <g transform="translate(' + x + ' ' + y + ')">\n'
    + '    <circle r="' + SEAT_R + '" fill="#0a1220" stroke="' + ring + '" stroke-width="2.2" opacity=".92"/>\n'
    + '    <text y="4.5" text-anchor="middle" font-size="11" font-weight="800" fill="#cfe0f7">' + i + '</text>\n'
    + '  </g>\n';
}

/* 中央船核心（六边形，与对局页同形；这里更小、更暗，只作视觉锚点） */
const CORE_S = 24;
const corePts = [];
for (let k = 0; k < 6; k++) {
  const a = Math.PI / 6 + k * Math.PI / 3;
  corePts.push((CX + Math.cos(a) * CORE_S).toFixed(1) + ',' + (CY + Math.sin(a) * CORE_S).toFixed(1));
}

/* ⚠ XML 注释里**不许出现连续两个减号**（XML 规范硬约束），且这条错误会让整份 SVG
   解析失败、`<img>` 的 naturalWidth 变成 0 —— 在页面上表现为「装饰层静默消失」，
   不报错、不警告（首版就是这么写的，靠调试脚本量 naturalWidth 才抓到）。
   故这里用「·」代替破折号，且生成后自检（见文件末尾 assertNoDoubleHyphen）。 */
const svg = '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<!-- 返航录 · 开始页「返航环」装饰件（CC0 / 本仓自绘）\n'
  + '     生成器：tools/gen-start-scene.cjs · 勿手改，改几何请改生成器后重跑（加 force 参数覆盖）。\n'
  + '     纪律：本件是纯装饰（开始页尚无对局状态），不含任何玩家数据、不含任何角色暗示。 -->\n'
  + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + VB.w + ' ' + VB.h + '" role="presentation" aria-hidden="true">\n'
  + '  <defs>\n'
  + '    <radialGradient id="glow" cx="50%" cy="50%" r="50%">\n'
  + '      <stop offset="0%" stop-color="#2a6ea8" stop-opacity=".38"/>\n'
  + '      <stop offset="100%" stop-color="#2a6ea8" stop-opacity="0"/>\n'
  + '    </radialGradient>\n'
  + '  </defs>\n'
  /* 底部光晕：让环从背景里浮起来 */
  + '  <ellipse cx="' + CX + '" cy="' + CY + '" rx="' + (RX + 34) + '" ry="' + (RY + 30) + '" fill="url(#glow)"/>\n'
  /* 座圈导轨（椭圆细线，虚线 = 航线刻度） */
  + '  <ellipse cx="' + CX + '" cy="' + CY + '" rx="' + RX + '" ry="' + RY + '" fill="none" stroke="#2f4a6d" stroke-width="1" stroke-dasharray="3 7" opacity=".55"/>\n'
  /* 圆桌 */
  + '  <ellipse cx="' + CX + '" cy="' + CY + '" rx="78" ry="52" fill="#101a2a" stroke="#2c4460" stroke-width="1.6" opacity=".9"/>\n'
  /* 船核心 */
  + '  <polygon points="' + corePts.join(' ') + '" fill="#122a40" stroke="#3d6b96" stroke-width="1.6"/>\n'
  + '  <text x="' + CX + '" y="' + (CY + 4) + '" text-anchor="middle" font-size="9" letter-spacing="1.5" fill="#4dabf7">核心</text>\n'
  + seats
  + '</svg>\n';

/* 生成后自检：注释里出现 '--' 会让整份 SVG 解析失败（静默消失，最难查的那种）。
   ⚠ 切片边界：注释体是 `<!--` 之后、结尾 `-->` **之前**，故 slice(4, -3)。
   首版写成 slice(4,-3) 却仍误报，是因为当时注释体里确实还有一处 `——`（中文破折号
   不是 ASCII，不算），真正命中的是「后 --force 重跑」里那个 `--force`。 */
(function assertNoDoubleHyphen(s) {
  const m = s.match(/<!--[\s\S]*?-->/g) || [];
  for (const c of m) {
    const body = c.slice(4, c.length - 3);
    if (body.includes('--')) {
      throw new Error('SVG 注释含双连字符（XML 非法）：' + body.slice(0, 80));
    }
  }
})(svg);

if (!FORCE && fs.existsSync(OUT)) {
  console.log('已存在，跳过（--force 覆盖）：' + path.relative(path.join(__dirname, '..'), OUT));
  process.exit(0);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, svg, 'utf8');
console.log('已生成 ' + path.relative(path.join(__dirname, '..'), OUT) + '（' + svg.length + ' 字节，' + N + ' 席）');
