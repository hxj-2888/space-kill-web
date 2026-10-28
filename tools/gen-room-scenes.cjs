/* =============================================================
 * 新返航录 · 8 个技能室「房间场景图」生成器（批 R3）
 *
 * 为什么是生成器而不是手摆：
 *   8 间房 × 每间数十块瓦片，手写坐标既不可维护也无法保证贴格（瓦片必须严格对齐）。
 *   本脚本用「房间模板 + 主题参数」拼装，改一间只改一处配置。
 *
 * 素材：Cozy Space Interiors（Bramble & Byte，**CC-BY 4.0**）
 *   来源 https://opengameart.org/content/cozy-space-interiors-16-px-top-down-sci-fi-tileset
 *   署名要求见 assets/scene/rooms/LICENSE.txt —— CC-BY 的硬性条件，**不可删**。
 *
 * ⚠ 瓦片尺寸不统一（这是拼装的第一道坑）：
 *   · 地板 / 框件 32×32
 *   · 墙面 / 门 32×64（占两行高）
 *   首版把行高统一当 64，结果地板之间出现横向接缝 —— 用 P.decode 量过才发现。
 *
 * 输出：assets/scene/rooms/<room>.png（14×10 格 → 448×320）
 * 用法：node tools/gen-room-scenes.cjs [--force]
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const PNG = require('./_png.cjs');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, '.tmp_shots', 'kenney', 'cozy', 'cozy-space-interiors', 'tiles', '2x');
const OUT = path.join(ROOT, 'assets', 'scene', 'rooms');
const FORCE = process.argv.includes('--force');

const CELL = 32;            /* 网格单位 */
const COLS = 14, ROWS = 10; /* 14×10 格 = 448×320 */
const W = COLS * CELL, H = ROWS * CELL;

/* 每间：floor 地板 / wallRow 墙面装饰（画在 r=1 的 32×64 墙上）/ accent 高亮地板
   props = [瓦片名, 列, 行]（行按 32 网格；墙面件会自动向上占 2 行） */
const ROOMS = {
  verify: {
    name: '查证室',
    floor: 'floor-steel', accent: 'floor-light-panel',
    wall: ['wall-screen', 'wall-light', 'wall-screen', 'wall-light'],
    props: [
      ['floor-light-panel', 2, 4], ['floor-light-panel', 5, 4],
      ['floor-light-panel', 8, 4], ['floor-light-panel', 11, 4],
      ['wall-screen', 4, 3], ['wall-screen', 9, 3],
    ],
  },
  patrol: {
    name: '巡逻岗',
    floor: 'floor-grate', accent: 'floor-hazard',
    wall: ['wall-window-planet', 'wall-window-planet', 'wall-window-planet'],
    props: [
      ['door-open', 6, 2],
      ['floor-hazard', 1, 8], ['floor-hazard', 2, 8], ['floor-hazard', 11, 8], ['floor-hazard', 12, 8],
    ],
  },
  medical: {
    name: '医疗室',
    floor: 'floor-lab', accent: 'floor-carpet-blue',
    wall: ['wall-light', 'wall-screen', 'wall-light', 'wall-vent'],
    props: [
      ['floor-carpet-blue', 2, 5], ['floor-carpet-blue', 3, 5],
      ['floor-carpet-blue', 9, 5], ['floor-carpet-blue', 10, 5],
      ['wall-vent', 6, 3],
    ],
  },
  pharma: {
    name: '制药室',
    floor: 'floor-lab', accent: 'floor-hatch',
    wall: ['wall-pipes', 'wall-pipes', 'wall-vent', 'wall-pipes'],
    props: [
      ['floor-hatch', 2, 6], ['floor-hatch', 3, 6],
      ['floor-hatch', 10, 6], ['floor-hatch', 11, 6],
      ['wall-pipes', 7, 3],
    ],
  },
  repair: {
    name: '维修室',
    floor: 'floor-steel-vent', accent: 'floor-grate',
    wall: ['wall-pipes', 'wall-vent', 'wall-pipes', 'wall-vent'],
    props: [
      ['floor-grate', 3, 6], ['floor-grate', 10, 6],
      ['door-4f', 5, 2],
    ],
  },
  safe: {
    name: '安全室',
    floor: 'floor-steel-bolts', accent: 'floor-hazard',
    wall: ['wall-window', 'wall-window', 'wall-window', 'wall-window'],
    props: [
      ['door-closed', 6, 2],
      ['floor-hazard', 0, 9], ['floor-hazard', 1, 9],
      ['floor-hazard', 12, 9], ['floor-hazard', 13, 9],
    ],
  },
  meeting: {
    name: '议事厅',
    floor: 'floor-carpet-beige', accent: 'floor-carpet-beige',
    wall: ['wall-sign', 'wall-light', 'wall-sign', 'wall-light'],
    props: [
      ['floor-carpet-beige', 3, 4], ['floor-carpet-beige', 4, 4],
      ['floor-carpet-beige', 9, 4], ['floor-carpet-beige', 10, 4],
      ['wall-sign', 6, 3],
    ],
  },
  armory: {
    name: '军械库',
    floor: 'floor-steel', accent: 'floor-hazard',
    wall: ['wall-vent', 'wall-screen', 'wall-vent', 'wall-screen'],
    props: [
      ['floor-hatch', 2, 6], ['floor-hatch', 3, 6],
      ['floor-hatch', 10, 6], ['floor-hatch', 11, 6],
      ['floor-hazard', 6, 9],
    ],
  },
};

/* 墙体：r=0 一行纯墙（32×64 会向上溢出，但会被画布裁掉上半，视觉上仍是墙头）；
   r=1 起为装饰墙面。两者都用 32×64，因此墙面区域总高 96px = 3 格。 */
function baseTile(r, c, cfg) {
  if (r <= 1) {
    if (r === 1 && c >= 1 && c <= COLS - 2) return cfg.wall[c % cfg.wall.length];
    return 'wall';
  }
  return cfg.floor;
}

function loadTile(name) {
  const p = path.join(SRC, name + '.png');
  if (!fs.existsSync(p)) throw new Error('缺瓦片：' + name);
  return PNG.decode(fs.readFileSync(p));
}

fs.mkdirSync(OUT, { recursive: true });
const cache = new Map();
const get = n => { if (!cache.has(n)) cache.set(n, loadTile(n)); return cache.get(n); };

for (const [id, cfg] of Object.entries(ROOMS)) {
  const file = path.join(OUT, id + '.png');
  if (fs.existsSync(file) && !FORCE) { console.log('跳过（加 force 覆盖）' + id); continue; }

  const out = PNG.blank(W, H);
  /* 铺底：按 32 网格逐格贴。墙面件 32×64 会向下多盖一格，正好形成墙头厚度 */
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = get(baseTile(r, c, cfg));
      PNG.blit(out, t, c * CELL, r * CELL);
    }
  }
  /* 叠道具 */
  for (const [name, c, r] of cfg.props) {
    PNG.blit(out, get(name), c * CELL, r * CELL);
  }
  fs.writeFileSync(file, PNG.encode(out));
  console.log('已生成 ' + path.relative(ROOT, file) + '（' + W + '×' + H + '，' + cfg.name + '）');
}
