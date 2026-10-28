'use strict';
/* =============================================================
 * 新返航录 · 船体内衬平铺图生成器〔批 UI-8a · 2026-10-27〕
 * -------------------------------------------------------------
 * 为什么自己画：用户要求把「用不到的那张开源社区背景图」剥离引用
 * （assets/scene/bg/spaceship-interior-1600.jpg，CC0 / OpenGameArt）。
 * 它是写实 3D 走廊，和像素房间不是一套语言 —— 批 UI-6 当时就记过
 * 「背景压太黑 = 另一种黑区」，靠调 brightness 硬撑。
 *
 * 本生成器产出一张**可四面无缝平铺**的像素舱壁纹理，用在：
 *   · 对局页 scene-mount 的上下边条（房间之外的那圈）
 *   · 开始页 #screen-start 的全屏底
 *
 * 设计约束（照抄房间素材的语言）：
 *   · 32px 单元格网格，与 assets/scene/cozy/tiles/*.png 同尺度
 *   · 深蓝灰主色（#141d2b 一档），比房间地板暗一档 ⇒ 房间仍然"浮"在上面
 *   · 横向面板缝 + 四角铆钉 + 一条竖向肋：远看是结构，近看是像素
 *   · **四面无缝**：所有绘制都按 32 取模，接缝处左右/上下对得上
 *
 * 用法：node tools/gen-bg-tile.cjs [--force]
 * 产物：assets/scene/bg/hull-tile.png（128×128，= 4×4 个 32px 单元格）
 *
 * 将来若换成扩散模型生成的图：直接替换 hull-tile.png 即可，
 * CSS 那边用的是 @background-repeat: repeat@，不依赖尺寸。
 * ============================================================= */
const fs = require('fs');
const path = require('path');
const PNG = require('./_png.cjs');

const OUT = path.join(__dirname, '..', 'assets', 'scene', 'bg', 'hull-tile.png');
const FORCE = process.argv.includes('--force');

const CELL = 32;          /* 与 cozy 瓦片同尺度 */
const GRID = 4;           /* 4×4 单元格 */
const SCALE = 4;          /* 输出放大 4 倍（像素图不糊） */
const W = CELL * GRID, H = CELL * GRID;

/* 调色板：与房间地板同族（冷蓝灰），但整体**压暗一档**而不是压成黑。
   -------------------------------------------------------------
   第一版调色板太暗（平均 RGB 23,32,46 / 亮度 31），而房间地板压暗后亮度约 143 ——
   差 4.6 倍，开始页整屏读作"纯黑"（正是用户反复说的黑区）。
   现在把这组值提到"房间地板的 45% 左右"：平均亮度约 62，
   再从 CSS 视情况压一档，就不会再读成黑。 */
const C = {
  base:   [56, 72, 96],    /* 主色（比房间地板暗一档，仍是同一个冷蓝灰族） */
  dark:   [34, 46, 64],    /* 缝隙 / 阴影 */
  light:  [84, 104, 132],  /* 受光面 */
  rivet:  [104, 126, 156], /* 铆钉（高光点） */
  rib:    [68, 86, 112],   /* 竖向肋 */
};

function makeCanvas(w, h) {
  const px = Buffer.alloc(w * h * 4);
  return { w, h, px };
}
function put(img, x, y, c) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const i = (y * img.w + x) * 4;
  img.px[i] = c[0]; img.px[i + 1] = c[1]; img.px[i + 2] = c[2]; img.px[i + 3] = 255;
}
function rect(img, x0, y0, w, h, c) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(img, x, y, c);
}

/* ---- 画一格 ---- */
function draw(img) {
  /* 1. 铺底 */
  rect(img, 0, 0, W, H, C.base);

  /* 2. 每格：左上受光 / 右下阴影（2px 像素描边语言）
     -------------------------------------------------------------
     关键：**必须环绕绘制**。第一版直接画在 0..W 上，于是最外圈的
     "下沿阴影 / 右沿阴影" 被画在 W-1、H-1 上，而相邻瓦片（另一份自己）
     在同一条接缝上画的是"上沿受光" —— 亮暗撞在一起，接缝差 23，肉眼就是一道线。
     实测：接缝列平均差 23.13 vs 内部 0.00。
     修法：所有绘制都按 W/H 取模（wrap），让接缝两侧的像素本来就是一体的。 */
  const wrapPut = (x, y, c) => put(img, ((x % W) + W) % W, ((y % H) + H) % H, c);
  const wrapRect = (x0, y0, w, h, c) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) wrapPut(x, y, c);
  };
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const x = gx * CELL, y = gy * CELL;
      wrapRect(x, y, CELL, 2, C.light);              /* 上沿受光 */
      wrapRect(x, y, 2, CELL, C.light);              /* 左沿受光 */
      wrapRect(x, y + CELL - 2, CELL, 2, C.dark);    /* 下沿阴影 */
      wrapRect(x + CELL - 2, y, 2, CELL, C.dark);    /* 右沿阴影 */
      /* 四角铆钉（内缩 5px） */
      const rr = 5;
      wrapPut(x + rr, y + rr, C.rivet);
      wrapPut(x + CELL - rr - 1, y + rr, C.rivet);
      wrapPut(x + rr, y + CELL - rr - 1, C.rivet);
      wrapPut(x + CELL - rr - 1, y + CELL - rr - 1, C.rivet);
    }
  }

  /* 3. 竖向肋：每 2 格一条 4px 宽的暗带 + 1px 高光边（结构感） */
  for (let gx = 0; gx < GRID; gx += 2) {
    const x = gx * CELL + CELL / 2 - 2;
    wrapRect(x, 0, 4, H, C.rib);
    wrapRect(x, 0, 1, H, C.light);
  }

  /* 4. 全图压一层极轻的横向渐变（模拟舱内顶灯），周期严格 = 1 格 ⇒ 天然无缝 */
  for (let y = 0; y < H; y++) {
    const t = Math.sin((y / CELL) * Math.PI * 2) * 0.5 + 0.5;   /* 0..1，整周期 */
    const k = Math.round(t * 5);
    for (let x = 0; x < W; x++) {
      const i = (y * img.w + x) * 4;
      img.px[i] = Math.min(255, img.px[i] + k);
      img.px[i + 1] = Math.min(255, img.px[i + 1] + k);
      img.px[i + 2] = Math.min(255, img.px[i + 2] + k);
    }
  }
}

/* ---- 最近邻放大（保持像素锐利） ---- */
function upscale(img, s) {
  const out = makeCanvas(img.w * s, img.h * s);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 4;
      for (let sy = 0; sy < s; sy++) {
        for (let sx = 0; sx < s; sx++) {
          const j = ((y * s + sy) * out.w + (x * s + sx)) * 4;
          out.px[j] = img.px[i]; out.px[j + 1] = img.px[i + 1];
          out.px[j + 2] = img.px[i + 2]; out.px[j + 3] = 255;
        }
      }
    }
  }
  return out;
}

if (fs.existsSync(OUT) && !FORCE) {
  console.log('已存在（加 --force 覆盖）：' + path.relative(path.join(__dirname, '..'), OUT));
  process.exit(0);
}

const small = makeCanvas(W, H);
draw(small);
const big = upscale(small, SCALE);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
/* _png 的 encode 要的是 {width,height,data}，本文件的画布是 {w,h,px} —— 这里适配一次 */
fs.writeFileSync(OUT, PNG.encode({ width: big.w, height: big.h, data: big.px }));
console.log('已生成 ' + path.relative(path.join(__dirname, '..'), OUT)
  + '（' + big.w + '×' + big.h + '，' + GRID + '×' + GRID + ' 格 ×' + SCALE + '）');
