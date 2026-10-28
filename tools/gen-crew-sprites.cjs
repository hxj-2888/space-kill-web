/* =============================================================
 * 新返航录 · 15 套角色行走图生成器（批 UI-2，2026-10-26）
 * -------------------------------------------------------------
 * 用户要求：「把 15 个人物做差异化」+「角色也要重做」。
 *
 * 为什么要生成而不是手画 / 用 Blender：
 *   ① CC-BY 的 Walking Crew 只有 8 套，15 个人循环复用 ⇒ 1 号与 9 号穿同一件衣服；
 *   ② Blender 做**带骨骼的行走循环**比静态摆件复杂一个量级，且产出是 3D 渲染，
 *      与 cozy 的 16px 像素房间不是一套语言；
 *   ③ 程序生成能在门禁里断言（15 个文件、尺寸、帧数、互不相同），
 *      手画或 Blender 产出都做不到「可机械验证」。
 *
 * 不变量（红线）：
 *   · 外观与本局身份**完全无关**（只按席位号派生）——否则等于泄露阵营（7.0 防透视）；
 *   · 帧版式与旧版**逐项相同**：4 列 × 5 行，单帧 96×160（4x），
 *     行序 0 下走 / 1 上走 / 2 待机 / 3 左走 / 4 右走 —— ui-scene.js 与 CSS 帧动画零改动；
 *   · 素材本仓自绘（随仓库 LICENSE），替代 CC-BY 的 Walking Crew。
 *
 * 输出：assets/scene/crew/crew-01.png … crew-15.png + manifest.json
 * 用法：node tools/gen-crew-sprites.cjs [--force]
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const PNG = require('./_png.cjs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'scene', 'crew');
const FORCE = process.argv.includes('--force');

/* ---- 版式（与旧版逐项相同，勿改 —— ui-scene.js 与 06-scene.css 依赖它） ---- */
const FRAME_W = 96, FRAME_H = 160;
const COLS = 4, ROWS = 5;
const SCALE = 4;                       /* 4x：逻辑 24×40 → 96×160 */
const LW = FRAME_W / SCALE;            /* 24 */
const LH = FRAME_H / SCALE;            /* 40 */
const ROW_DOWN = 0, ROW_UP = 1, ROW_IDLE = 2, ROW_LEFT = 3, ROW_RIGHT = 4;

/* ---- 15 席配色（与 ui-scene.js 的 PALETTE 同序，只做视觉辨识） ---- */
const SEAT_COLORS = [
  '#ff6b6b', '#ff922b', '#fcc419', '#c0eb75', '#69db7c', '#38d9a9', '#3bc9db',
  '#4dabf7', '#748ffc', '#9775fa', '#da77f2', '#e64980', '#f783ac', '#ffe066', '#94d82d',
];

/* ---- 15 种「配件」——差异化主力。
   同一套身体轮廓 + 不同头饰/背包，保证远看是同一族群、近看各不相同。
   全部与身份无关（只按席位号取）。 ---- */
const HEADS = [
  'bare', 'antenna', 'cap', 'headset', 'crest', 'helmet', 'bun', 'spike',
  'halo', 'visor-strip', 'horn', 'topknot', 'sidegear', 'wing', 'dome',
];
const PACKS = ['flat', 'tall', 'round', 'twin', 'none'];

/* =============================================================
 * 栅格工具：逻辑坐标绘制，最后整体放大 SCALE 倍
 * ============================================================= */
function makeCanvas(w, h) {
  return { w, h, px: new Uint8Array(w * h * 4) };
}
function hex2rgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function put(c, x, y, rgb, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  c.px[i] = rgb[0]; c.px[i + 1] = rgb[1]; c.px[i + 2] = rgb[2];
  c.px[i + 3] = a == null ? 255 : a;
}
function rect(c, x, y, w, h, rgb, a) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(c, xx, yy, rgb, a);
}
function ellipse(c, cx, cy, rx, ry, rgb, a) {
  for (let yy = Math.floor(cy - ry); yy <= Math.ceil(cy + ry); yy++) {
    for (let xx = Math.floor(cx - rx); xx <= Math.ceil(cx + rx); xx++) {
      const dx = (xx - cx) / rx, dy = (yy - cy) / ry;
      if (dx * dx + dy * dy <= 1) put(c, xx, yy, rgb, a);
    }
  }
}
/* 圆角矩形（胶囊体）：radius 以逻辑像素计 */
function roundRect(c, x, y, w, h, r, rgb, a) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const cx = Math.min(Math.max(xx, x + r), x + w - 1 - r);
      const cy = Math.min(Math.max(yy, y + r), y + h - 1 - r);
      const dx = xx - cx, dy = yy - cy;
      if (dx * dx + dy * dy <= r * r + 0.01) put(c, xx, yy, rgb, a);
    }
  }
}
/* 描边：把已有不透明像素的**外缘**染深一档（像素画的"勾边"，让角色从地板里跳出来）。
   ⚠ 只对「与画布外缘连通」的透明区域描边。
   首版对任意透明像素都描，结果两腿之间的缝隙被当成外缘涂黑 ——
   实测像素图 dump 出来，正面帧第 18~25 行中间有一道 3px 宽的 `BBB` 竖条，
   看起来像"身体中间穿了个管子"。这里用泛洪把「内部空洞」排除掉。 */
function outline(c, rgb) {
  const src = c.px.slice();
  const W = c.w, H = c.h;
  const alphaAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : src[(y * W + x) * 4 + 3];
  /* 泛洪：从画布四边出发，标记所有可达的透明像素 = 真外缘 */
  const outside = new Uint8Array(W * H);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const k = y * W + x;
    if (outside[k] || alphaAt(x, y) !== 0) return;
    outside[k] = 1; stack.push(k);
  };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (stack.length) {
    const k = stack.pop(), x = k % W, y = (k - x) / W;
    push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      if (alphaAt(x, y) !== 0 || !outside[k]) continue;   /* 只描真外缘的透明格 */
      if (alphaAt(x - 1, y) > 0 || alphaAt(x + 1, y) > 0 || alphaAt(x, y - 1) > 0 || alphaAt(x, y + 1) > 0) {
        put(c, x, y, rgb, 255);
      }
    }
  }
}

/* =============================================================
 * 画一个角色的一帧
 *   dir: 'down' | 'up' | 'left' | 'right'
 *   phase: 0..3（行走帧相位；待机时传 1）
 * ============================================================= */
const DARK = hex2rgb('#0d1520');
const SHADOW = hex2rgb('#000000');
const SKIN = hex2rgb('#d9a066');
const LEG = hex2rgb('#2b3a4d');
const VISOR = hex2rgb('#9fe8ff');
const VISOR_HI = hex2rgb('#e8fbff');

function shade(rgb, k) {
  /* ⚠ 必须钳到 0..255。首版漏了这一步：shade(#ff6b6b, 1.22) 里 R 通道算出 311，
     写进 Uint8Array 时**回绕成 55** ⇒ 本该是"受光高光"的浅红变成深青色，
     在身体左侧画出一条 3px 竖条，远看像"身体中间穿了根管子"。
     这类 bug 不会报错，只会静默画错颜色 —— 已用像素 dump 定位（见改动说明）。 */
  const cl = v => Math.max(0, Math.min(255, Math.round(v)));
  return [cl(rgb[0] * k), cl(rgb[1] * k), cl(rgb[2] * k)];
}

function drawCrew(c, seat, dir, phase, opts) {
  const body = hex2rgb(SEAT_COLORS[(seat - 1) % SEAT_COLORS.length]);
  const bodyLo = shade(body, 0.70);
  const bodyHi = shade(body, 1.22);
  const pack = shade(body, 0.50);
  const head = opts.head;
  const packKind = opts.pack;
  const walking = opts.walking;

  /* 逻辑画布 24 宽 × 40 高。角色的竖直分层（**不能再随意挪动**）：
     ┌ 6..11   头饰
     │ 12..18  面罩（含黑边）
     │ 15..31  身体（顶端与面罩重叠 4px，让面罩"嵌进"身体而不是浮在外面）
     │ 29..37  腿（顶端插进身体 2px，否则 outline 会在腰上描一道黑线）
     │ 37..39  鞋 / 阴影
     首版把面罩画在身体**上方**、腿与身体**齐平**、背包画进躯干，
     三个问题叠加起来读作"蛋形 + 腰断 + 胸口穿管"。 */
  const cx = 12;
  const BODY_X = cx - 6, BODY_Y = 15, BODY_W = 12, BODY_H = 16;

  /* ---- 脚下阴影（最先画，被身体压住一部分） ---- */
  ellipse(c, cx, 37.5, 6.5, 1.8, SHADOW, 55);

  /* ---- 腿：顶端 29 插进身体 2px ----
     〔批 UI-8b · 2026-10-27〕迈步幅度**加大**。
     -------------------------------------------------------------
     旧版 `swing = [0, 1, 0, -1]`：腿只横移 **1px**（逻辑像素）。
     在 96×160 的帧里，1px 放大 4 倍也只有 4 个物理像素，而角色在场景里
     只有约 64px 宽 —— 肉眼完全看不出腿在动，读作"整个人在平移"。
     用户原话：「现在小人行走完全没有动画，是一个完全平移的状态」（判断是对的）。

     现在改成**双轴**摆动，并且三档幅度都用上：
       · 横向 swing  ∈ [-3, +3]：迈步跨出去（3 逻辑 px = 12 物理 px，看得见）
       · 纵向 liftL/liftR ∈ [0, 2]：抬脚离地（配合脚下阴影的"离地感"）
       · 身体 bob ∈ [0, 1]：上下起伏一格（步频的视觉锚点）
     帧序列保持 4 帧 1-2-3-2，相位仍是 phase%4 —— 版式不变，只改幅度。 */
  const SWING = [0, 3, 0, -3];          /* 左右腿的横向张开 */
  const LIFT  = [0, 1, 2, 1];           /* 抬起腿的高度（0 = 落地） */
  const BOB   = [0, 0, 1, 0];           /* 身体起伏：只有"双脚并拢"那帧往下沉 */
  const swing = walking ? SWING[phase % 4] : 0;
  const liftL = walking ? LIFT[phase % 4] : 0;
  const liftR = walking ? LIFT[(phase + 2) % 4] : 0;   /* 两腿反相 */
  const LEG_TOP2 = 29;
  const legY = LEG_TOP2 - (walking ? BOB[phase % 4] : 0);
  /* 左腿：向外张 swing，抬起 liftL；右腿反相 */
  const lL = cx - 4 - swing, lR = cx + 1 + swing;
  roundRect(c, lL, legY - liftL, 3, 8, 1, LEG);
  roundRect(c, lR, legY - liftR, 3, 8, 1, LEG);
  rect(c, lL - 1, legY + 8 - liftL, 5, 2, DARK);
  rect(c, lR - 1, legY + 8 - liftR, 5, 2, DARK);

  /* ---- 背包：**只在背面画整块**；侧面画在身体轮廓之外的一窄条；正面不画 ----
     首版正面在 cx±8 画了"背带"，那两个位置在身体外沿之外，
     结果看起来像"肩胛骨上贴了两个深色方块"。正面一律不画。 */
  const packH = packKind === 'tall' ? 13 : (packKind === 'round' ? 9 : 11);
  const packY = 17;
  if (packKind !== 'none') {
    if (dir === 'up') {
      roundRect(c, cx - 5, packY, 10, packH, 3, pack);
      roundRect(c, cx - 4, packY + 1, 8, packH - 2, 2, shade(pack, 1.16));
      rect(c, cx - 1, packY + 3, 2, packH - 6, shade(pack, 0.72));
    } else if (dir === 'left') {
      roundRect(c, cx + 3, packY + 1, 4, packH - 2, 2, pack);
    } else if (dir === 'right') {
      roundRect(c, cx - 7, packY + 1, 4, packH - 2, 2, pack);
    }
  }

  /* ---- 身体：胶囊 ---- */
  roundRect(c, BODY_X, BODY_Y, BODY_W, BODY_H, 4, body);
  /* 受光：左上一条竖高光 */
  roundRect(c, BODY_X + 1, BODY_Y + 3, 3, 8, 1, bodyHi, 130);
  /* 暗部：右侧 */
  roundRect(c, BODY_X + BODY_W - 4, BODY_Y + 5, 3, BODY_H - 8, 1, bodyLo, 120);
  /* 腹部横线 */
  rect(c, BODY_X + 1, BODY_Y + 11, BODY_W - 2, 1, bodyLo, 90);

  /* ---- 面罩：**压在身体上缘之上**（先画身体再画面罩），
     这样面罩的深色外圈自然吃掉身体顶端，不会出现"面罩与身体之间一条黑缝"。
     位置 y=15 / 半高 3.0 → 覆盖 12..18，身体从 15 开始 ⇒ 重叠 3px。 */
  if (dir === 'down') {
    ellipse(c, cx, 15.5, 4.6, 3.2, DARK);
    ellipse(c, cx, 15.5, 3.7, 2.4, VISOR);
    rect(c, cx + 1, 14, 2, 1, VISOR_HI);
  } else if (dir === 'left') {
    ellipse(c, cx - 2.5, 15.5, 3.2, 2.7, DARK);
    ellipse(c, cx - 2.5, 15.5, 2.5, 2.0, VISOR);
    rect(c, cx - 3, 14, 1, 1, VISOR_HI);
  } else if (dir === 'right') {
    ellipse(c, cx + 2.5, 15.5, 3.2, 2.7, DARK);
    ellipse(c, cx + 2.5, 15.5, 2.5, 2.0, VISOR);
    rect(c, cx + 3, 14, 1, 1, VISOR_HI);
  }

  /* ---- 头饰（最后画，压在面罩上沿之上） ---- */
  drawHeadgear(c, head, dir, body, bodyHi);

  /* ---- 勾边 ---- */
  outline(c, DARK);
}

function drawHeadgear(c, head, dir, body, bodyHi) {
  const cx = 12;
  /* 头饰区：y 6..13（面罩在 13..19，不能压）。全部按「戴在头顶」而非「套住整颗头」，
     因为这套画风没有独立头部——面罩就是脸。 */
  switch (head) {
    case 'bare': break;
    case 'antenna': {
      rect(c, cx + 2, 9, 1, 5, DARK);
      ellipse(c, cx + 2, 8, 1.6, 1.6, hex2rgb('#ffd43b'));
      break;
    }
    case 'cap': {
      roundRect(c, cx - 6, 9, 12, 4, 2, bodyHi);
      rect(c, cx - 7, 12, 13, 2, shade(body, 0.85));   /* 帽檐（向左伸出一点） */
      break;
    }
    case 'headset': {
      /* 耳机：细头梁（只有 1px 粗，不是实心块）+ 两个耳罩。
         首版用 roundRect(cx-7,10,14,2) 画头梁，但那块与 outline 的外圈叠在一起
         变成 14×3 的实心黑条，远看像"头上顶了块板"。 */
      rect(c, cx - 5, 10, 10, 1, DARK);          /* 头梁 */
      rect(c, cx - 6, 11, 1, 2, DARK);
      rect(c, cx + 5, 11, 1, 2, DARK);
      roundRect(c, cx - 7, 12, 3, 4, 1, hex2rgb('#4dd0e1'));
      roundRect(c, cx + 4, 12, 3, 4, 1, hex2rgb('#4dd0e1'));
      break;
    }
    case 'crest': {
      /* 三根竖鳍，中间最高 —— 总高 ≤5px，不侵入面罩区（12 起） */
      roundRect(c, cx - 4, 9, 2, 3, 0, bodyHi);
      roundRect(c, cx - 1, 7, 2, 5, 0, bodyHi);
      roundRect(c, cx + 2, 9, 2, 3, 0, bodyHi);
      break;
    }
    case 'helmet': {
      /* 半罩式：只盖住头顶 2px，不整颗包住（首版 14×7 把头压没了） */
      roundRect(c, cx - 6, 10, 12, 3, 1, shade(body, 0.88));
      rect(c, cx - 5, 10, 4, 1, shade(body, 1.25));
      break;
    }
    case 'bun': {
      ellipse(c, cx, 8, 3.6, 3, bodyHi);
      break;
    }
    case 'spike': {
      /* 四根短刺：中间两根略高（总高 ≤5px，落在 7..12） */
      for (let i = 0; i < 4; i++) {
        const h = (i === 1 || i === 2) ? 5 : 3;
        roundRect(c, cx - 5 + i * 3, 12 - h, 2, h, 0, bodyHi);
      }
      break;
    }
    case 'halo': {
      /* 光环：细扁椭圆，压在 8..9 行，与面罩（12 起）不冲突 */
      ellipse(c, cx, 9, 5.5, 1.2, hex2rgb('#ffe066'));
      break;
    }
    case 'visor-strip': {
      /* 横贯前额的灯带（压在最上层，不占头饰高度） */
      rect(c, cx - 6, 12, 12, 2, hex2rgb('#4dd0e1'));
      break;
    }
    case 'horn': {
      roundRect(c, cx - 6, 8, 2, 5, 1, hex2rgb('#e8e8e8'));
      roundRect(c, cx + 4, 8, 2, 5, 1, hex2rgb('#e8e8e8'));
      break;
    }
    case 'topknot': {
      ellipse(c, cx, 8, 2.8, 3.4, DARK);
      rect(c, cx - 1, 11, 2, 3, bodyHi);
      break;
    }
    case 'sidegear': {
      /* 侧挂模块：放在耳侧（y=14），只向外伸 2px，不压面罩 */
      ellipse(c, cx + 6.5, 14, 2, 2.4, DARK);
      ellipse(c, cx + 6.5, 14, 1.2, 1.5, hex2rgb('#5ce6a8'));
      break;
    }
    case 'wing': {
      /* 两侧短翼：y=13 起，向外伸 3px */
      roundRect(c, cx - 9, 13, 3, 3, 1, bodyHi);
      roundRect(c, cx + 6, 13, 3, 3, 1, bodyHi);
      break;
    }
    case 'dome': {
      /* 玻璃罩：薄薄一层盖头顶，留出高光点 */
      roundRect(c, cx - 5, 9, 10, 4, 2, hex2rgb('#bfe9ff'), 200);
      rect(c, cx - 3, 10, 2, 1, hex2rgb('#ffffff'), 170);
      break;
    }
    default: break;
  }
}

/* =============================================================
 * 一张行走图表：4 列 × 5 行
 * ============================================================= */
function makeSheet(seat, opts) {
  const sheet = makeCanvas(FRAME_W * COLS, FRAME_H * ROWS);
  const plan = [
    [ROW_DOWN, 'down', true],
    [ROW_UP, 'up', true],
    [ROW_IDLE, 'down', false],
    [ROW_LEFT, 'left', true],
    [ROW_RIGHT, 'right', true],
  ];
  for (const [row, dir, walking] of plan) {
    for (let col = 0; col < COLS; col++) {
      const frame = makeCanvas(LW, LH);
      /* 待机只用第 2 帧（与旧素材一致：静止时取待机行第 2 列），其余列画同一姿势 */
      const phase = walking ? col : 1;
      drawCrew(frame, seat, dir, phase, { head: opts.head, pack: opts.pack, walking });
      blitScaled(sheet, frame, col * FRAME_W, row * FRAME_H);
    }
  }
  return sheet;
}

/* 逻辑帧 → 目标画布（最近邻放大 SCALE 倍，保持像素锐利） */
function blitScaled(dst, src, ox, oy) {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      const a = src.px[i + 3];
      if (!a) continue;
      const r = src.px[i], g = src.px[i + 1], b = src.px[i + 2];
      for (let sy = 0; sy < SCALE; sy++) {
        for (let sx = 0; sx < SCALE; sx++) {
          const dx = ox + x * SCALE + sx, dy = oy + y * SCALE + sy;
          if (dx < 0 || dy < 0 || dx >= dst.w || dy >= dst.h) continue;
          const j = (dy * dst.w + dx) * 4;
          dst.px[j] = r; dst.px[j + 1] = g; dst.px[j + 2] = b; dst.px[j + 3] = 255;
        }
      }
    }
  }
}

/* =============================================================
 * 〔批 UI-8b · 2026-10-27〕生成后自检：4 帧必须**肉眼可分辨**
 * -------------------------------------------------------------
 * 用户报「小人行走完全没有动画，是一个完全平移的状态」。
 * 根因不在 CSS（动画确实在跑），而在**帧本身几乎一样**：
 *   旧版腿只横移 1px ⇒ 帧 0 与帧 1 仅差 736 个像素，
 *   而角色在场景里只有 64px 宽，那点差异肉眼为零。
 * Node 侧没有眼睛，所以把"看得见"变成可量的一条：行走行相邻帧差异下限。
 * ============================================================= */
const MIN_FRAME_DIFF = 400;   /* 96×160 帧内，两帧至少要有这么多像素不同 */

/* ⚠ makeSheet 返回的是本文件的画布形状 {w, h, px}（不是 _png 的 {width,height,data}）。
   第一版按 {width,data} 写，直接读到 undefined —— 自检当场崩了（也算它起了作用）。 */
function frameDiff(img, row, a, b) {
  const W = img.w, D = img.px;
  let n = 0;
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      const i1 = ((row * FRAME_H + y) * W + (a * FRAME_W + x)) * 4;
      const i2 = ((row * FRAME_H + y) * W + (b * FRAME_W + x)) * 4;
      if (Math.abs(D[i1 + 3] - D[i2 + 3]) > 10 ||
          Math.abs(D[i1] - D[i2]) > 10 ||
          Math.abs(D[i1 + 1] - D[i2 + 1]) > 10) n++;
    }
  }
  return n;
}

/** 返回问题清单（空 = 通过）。门禁 test-space 的 W 组与它同口径。 */
function auditSheet(img) {
  const bad = [];
  for (const row of [ROW_DOWN, ROW_UP, ROW_LEFT, ROW_RIGHT]) {
    for (let c = 1; c < COLS; c++) {
      const d = frameDiff(img, row, 0, c);
      if (d < MIN_FRAME_DIFF) bad.push('row' + row + ' 帧0/帧' + c + ' 只差 ' + d + 'px（< ' + MIN_FRAME_DIFF + '）');
    }
  }
  /* 待机行**必须**四帧一致：它是静止姿势，抖了就是"站着也在动" */
  for (let c = 1; c < COLS; c++) {
    const d = frameDiff(img, ROW_IDLE, 0, c);
    if (d !== 0) bad.push('待机行 帧0/帧' + c + ' 不该有差异（差 ' + d + 'px）');
  }
  return bad;
}

/* =============================================================
 * 主流程
 * ============================================================= */
function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = { version: 1, frame: [FRAME_W, FRAME_H], grid: [COLS, ROWS], scale: SCALE, seats: [] };
  let wrote = 0;
  for (let seat = 1; seat <= 15; seat++) {
    const head = HEADS[(seat - 1) % HEADS.length];
    const pack = PACKS[(seat - 1) % PACKS.length];
    const file = 'crew-' + String(seat).padStart(2, '0') + '.png';
    const abs = path.join(OUT, file);
    if (!FORCE && fs.existsSync(abs)) {
      manifest.seats.push({ seat, file, head, pack, skipped: true });
      continue;
    }
    const sheet = makeSheet(seat, { head, pack });
    /* 转成 _png.encode 需要的 { width, height, data: Buffer } */
    const buf = Buffer.from(sheet.px.buffer, sheet.px.byteOffset, sheet.px.length);
    fs.writeFileSync(abs, PNG.encode({ width: sheet.w, height: sheet.h, data: buf }));
    manifest.seats.push({ seat, file, head, pack, color: SEAT_COLORS[(seat - 1) % 15] });
    wrote++;
    /* 生成即自检：宁可在这里报错，也不要产出一套"看着会走其实是平移"的图 */
    const bad = auditSheet(sheet);
    if (bad.length) {
      console.error('✗ ' + file + ' 帧幅度不合格：\n  ' + bad.join('\n  '));
      process.exitCode = 1;
    }
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log('已生成 ' + wrote + ' 套行走图 → assets/scene/crew/（共 15 席，版式 '
    + FRAME_W + '×' + FRAME_H + ' × ' + COLS + '帧 × ' + ROWS + '行）');
}

main();
