/* =============================================================
 * 场景化 UI · 素材生成器（批 S0，一次性/可重复执行）
 * -------------------------------------------------------------
 * 职责：
 *   1. 从 DiceBear 10.x API 按「座位号种子 + 15 色板」预生成 15 席角色 SVG
 *      （三个候选方案 + 书记官），全部选用 CC0 风格（licenses 页核对过）；
 *   2. 生成 assets/scene/CREDITS.md（出处与许可证登记）；
 *   3. 组装自包含预览页 assets/scene/preview.html（头像与背景全部内嵌，
 *      单文件可直接双击打开 / 拷给他人评审，无网络依赖）。
 *
 * 素材落地后为静态文件入库，**产品运行时零网络依赖**（红线：前端零依赖）。
 * 重跑安全：已存在的 SVG 不重复下载（--force 强制重下）。
 *
 * 用法：node tools/gen-scene-assets.cjs [--force]
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCENE_DIR = path.join(ROOT, 'assets', 'scene');
const API = 'https://api.dicebear.com/10.x';
const FORCE = process.argv.includes('--force');

/* 15 席固定色板（座位号 → 颜色，局内稳定；深色背景下可辨识） */
const PALETTE = [
  '#ff6b6b', '#ff922b', '#fcc419', '#c0eb75', '#69db7c',
  '#38d9a9', '#3bc9db', '#4dabf7', '#748ffc', '#9775fa',
  '#da77f2', '#e64980', '#f783ac', '#ffe066', '#94d82d',
];

/* 三个候选方案（全部 CC0，dicebear.com/licenses 核对） */
const SCHEMES = [
  { key: 'a-crew',   slug: 'open-peeps', label: '方案A · 卡通船员（open-peeps）' },
  { key: 'b-bot',    slug: 'voxel-bot',  label: '方案B · 机器人（voxel-bot）' },
  { key: 'c-critter', slug: 'critters',  label: '方案C · 生物（critters）' },
];
/* 书记官（非玩家 NPC）：notionists 风格 + 灰底，与 15 席明显区分 */
const SCRIBE = { key: 'scribe', slug: 'notionists', bg: '#868e96' };

async function fetchText(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'spacekill-asset-gen/1.0' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(res => setTimeout(res, 800 * (i + 1)));
    }
  }
}

async function ensureAvatar(dir, file, slug, seed, bg) {
  const p = path.join(dir, file);
  if (!FORCE && fs.existsSync(p) && fs.statSync(p).size > 200) return 'cached';
  const url = `${API}/${slug}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${encodeURIComponent(bg)}&radius=50`;
  const svg = await fetchText(url);
  fs.writeFileSync(p, svg, 'utf8');
  return 'ok';
}

async function ensureCharacters() {
  let n = 0;
  for (const s of SCHEMES) {
    const dir = path.join(SCENE_DIR, 'characters', s.key);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 1; i <= 15; i++) {
      const st = await ensureAvatar(dir, `seat-${String(i).padStart(2, '0')}.svg`, s.slug, `seat-${i}`, PALETTE[i - 1]);
      if (st === 'ok') n++;
    }
    console.log(`characters/${s.key}/ 15 席就绪（${s.label}）`);
  }
  const sdir = path.join(SCENE_DIR, 'characters', SCRIBE.key);
  fs.mkdirSync(sdir, { recursive: true });
  await ensureAvatar(sdir, 'scribe.svg', SCRIBE.slug, 'scribe-official', SCRIBE.bg);
  console.log('characters/scribe/ 书记官就绪');
  return n;
}

function writeCredits() {
  const c = `# assets/scene · 素材出处与许可证（批 S0）

| 素材 | 出处 | 许可证 | 生成方式 |
|---|---|---|---|
| 15 席角色 · 方案A | [DiceBear open-peeps](https://www.dicebear.com/styles/) | CC0 1.0 | \`${API.replace('https://', '')}/open-peeps/svg?seed=seat-N&backgroundColor=…&radius=50\`（座位号种子，局内稳定） |
| 15 席角色 · 方案B | DiceBear voxel-bot | CC0 1.0 | 同上 |
| 15 席角色 · 方案C | DiceBear critters | CC0 1.0 | 同上 |
| 书记官 NPC | DiceBear notionists | CC0 1.0 | seed=scribe-official |
| 太空船内景背景 | [Spaceship Interior — OpenGameArt / Parker West](https://opengameart.org/content/spaceship-interior)（源自 Pixabay） | CC0 1.0 | 原图直存 bg/spaceship-interior-v1.jpg（2.1MB；SHA256 a1b98506…） |
| 其余（圆桌/椅子/气泡/房间门/叠加件） | 本仓自绘 | 随仓库 LICENSE | 场景 SVG 组合件，非角色素材 |

- DiceBear 风格许可证逐档核对：https://www.dicebear.com/licenses/ （open-peeps / voxel-bot / critters / notionists 均为 CC0 1.0，无署名义务）
- 生成脚本：\`node tools/gen-scene-assets.cjs [--force]\`；产物为静态文件，**产品运行时不访问任何外部服务**。
- 生产接入（S2 批）前将把背景压至 Web 尺寸（~1600px/JPEG q82），原图保留作母版。
`;
  fs.writeFileSync(path.join(SCENE_DIR, 'CREDITS.md'), c, 'utf8');
  console.log('CREDITS.md 就绪');
}

/* ---------- 预览页组装（自包含单文件） ---------- */
function readSvg(dir, file) {
  const s = fs.readFileSync(path.join(SCENE_DIR, dir, file), 'utf8');
  return 'data:image/svg+xml;base64,' + Buffer.from(s, 'utf8').toString('base64');
}

const ROOMS = [
  { id: 'verify',  name: '查证室', grant: '神探 查验·公告' },
  { id: 'patrol',  name: '巡逻岗', grant: '警长 巡逻' },
  { id: 'medical', name: '医疗室', grant: '治疗·救援' },
  { id: 'pharma',  name: '制药室', grant: '医生族 制药' },
  { id: 'repair',  name: '维修室', grant: '工程师 维修' },
  { id: 'safe',    name: '安全室', grant: '全额减免' },
  { id: 'meeting', name: '议事厅', grant: '紧急会议' },
  { id: 'armory',  name: '军械库', grant: '枪械与弹药' },
];

function buildPreview() {
  const bg = fs.readFileSync(path.join(SCENE_DIR, 'bg', 'spaceship-interior-v1.jpg'));
  const bgUri = 'data:image/jpeg;base64,' + bg.toString('base64');
  const av = {};
  for (const s of SCHEMES) {
    av[s.key] = [];
    for (let i = 1; i <= 15; i++) av[s.key].push(readSvg(path.join('characters', s.key), `seat-${String(i).padStart(2, '0')}.svg`));
  }
  const scribe = readSvg(path.join('characters', 'scribe'), 'scribe.svg');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>新返航录 · 场景化 UI 预览（S0 拍板稿）</title>
<style>
  :root{
    --panel:#0e1420; --panel2:#151d2e; --line:#2a3550; --txt:#dbe4f3; --dim:#8a97b0;
    --gold:#ffd43b; --cyan:#4dabf7; --danger:#ff6b6b; --ok:#51cf66;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#070b13;color:var(--txt);font:14px/1.6 "Microsoft YaHei",system-ui,sans-serif;padding:14px}
  h1{font-size:18px;margin-bottom:2px}
  .sub{color:var(--dim);font-size:12px;margin-bottom:10px}
  .bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin-bottom:10px}
  .bar .sp{flex:1}
  .seg{display:flex;gap:0;border:1px solid var(--line);border-radius:8px;overflow:hidden}
  .seg button{background:var(--panel2);color:var(--txt);border:0;padding:6px 12px;cursor:pointer;font-size:13px}
  .seg button.on{background:var(--cyan);color:#04101f;font-weight:700}
  .hint{font-size:12px;color:var(--dim)}
  .stage-wrap{position:relative;border:1px solid var(--line);border-radius:14px;overflow:hidden;aspect-ratio:16/9.8;min-height:540px;background:#04070d}
  .bgimg{position:absolute;inset:0;background:url(${bgUri}) center/cover no-repeat;filter:brightness(.52) saturate(.85)}
  .veil{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 44%, transparent 32%, rgba(3,6,12,.58) 86%)}
  .stars{position:absolute;inset:0;opacity:.5;background-image:radial-gradient(1px 1px at 12% 18%,#fff,transparent),radial-gradient(1px 1px at 78% 8%,#cfe6ff,transparent),radial-gradient(1.5px 1.5px at 88% 64%,#fff,transparent),radial-gradient(1px 1px at 6% 72%,#ffe9a8,transparent),radial-gradient(1px 1px at 42% 4%,#fff,transparent)}

  /* 房间环（上层甲板弧排） */
  .rooms{position:absolute;left:50%;top:10px;transform:translateX(-50%);display:flex;gap:8px;flex-wrap:nowrap}
  .room{width:86px;text-align:center;background:rgba(14,20,32,.82);border:1px solid var(--line);border-radius:9px;padding:5px 4px 6px;cursor:pointer;transition:.25s;backdrop-filter:blur(2px)}
  .room .ico{font-size:17px;line-height:1.2}
  .room b{display:block;font-size:12px}
  .room i{display:block;font-style:normal;font-size:10px;color:var(--dim)}
  .room.lit{border-color:var(--gold);box-shadow:0 0 10px rgba(255,212,59,.25)}
  .room.lit b{color:var(--gold)}
  .room:hover{border-color:var(--cyan)}

  /* 圆桌与船核心 */
  .table{position:absolute;left:50%;top:56%;transform:translate(-50%,-50%);width:min(46%,430px);aspect-ratio:2/1;border-radius:50%;background:radial-gradient(ellipse at 50% 38%, #243248 0%, #16202f 55%, #0d1521 100%);border:3px solid #33445f;box-shadow:0 10px 40px rgba(0,0,0,.55), inset 0 0 60px rgba(77,171,247,.06)}
  .core{position:absolute;left:50%;top:56%;transform:translate(-50%,-50%) rotate(0deg);width:80px;height:80px;clip-path:polygon(25% 3%,75% 3%,98% 50%,75% 97%,25% 97%,2% 50%);background:linear-gradient(160deg,#1d3b57,#0f2338);border:0;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:.3s}
  .core span{font-size:11px;color:var(--cyan);letter-spacing:1px}
  .core.night{box-shadow:0 0 18px rgba(77,171,247,.5);animation:breathe 2.4s ease-in-out infinite}
  @keyframes breathe{50%{box-shadow:0 0 34px rgba(77,171,247,.85)}}

  /* 席位 */
  .seat{position:absolute;left:50%;top:56%;width:74px;margin:-92px 0 0 -37px;transition:transform 1.05s cubic-bezier(.5,.05,.3,1);cursor:pointer;text-align:center;z-index:3;filter:drop-shadow(0 7px 10px rgba(0,0,0,.55))}
  .seat .av{position:relative;width:58px;height:58px;margin:0 auto;border-radius:50%;border:3px solid var(--ring,#3a4a68);overflow:hidden;background:#0a0f18;transition:.3s}
  .seat .av img{width:100%;height:100%;display:block}
  .seat .chair{width:42px;height:14px;margin:2px auto 0;border-radius:0 0 42px 42px;background:linear-gradient(#52688f,#33445f);border:1px solid #5d76a3;border-top:0}
  .seat .num{position:absolute;top:-8px;left:50%;transform:translateX(-50%);background:#0d1524;border:1.5px solid var(--ring,#56688c);color:#fff;font-weight:800;font-size:11.5px;line-height:1;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;z-index:2}
  .seat.closed .av img{filter:grayscale(.9) brightness(.5)}
  .seat.closed .lids{position:absolute;inset:0;background:linear-gradient(rgba(4,8,15,.28),rgba(4,8,15,.55));display:flex;align-items:center;justify-content:center}
  .seat.closed .lids::after{content:"– ‿ –";color:#c7d4ec;font-size:11px;text-shadow:0 1px 2px #000}
  .seat.mine{z-index:5}
  .seat.mine .av{border-color:var(--gold);box-shadow:0 0 16px rgba(255,212,59,.55);animation:minePulse 1.8s ease-in-out infinite}
  @keyframes minePulse{50%{box-shadow:0 0 30px rgba(255,212,59,.9)}}
  .seat.out .av img{filter:grayscale(1) brightness(.45)}
  .seat.out .av{border-color:#39415a}
  .seat.out .num{background:#2a1f22;border-color:#6b4550}
  .seat.out .tag{position:absolute;right:-4px;top:-6px;font-size:11px;color:var(--danger);font-weight:800}
  .seat .sel-ring{position:absolute;inset:-7px;border:2px dashed transparent;border-radius:50%;transition:.2s}
  .seat.selected .sel-ring{border-color:var(--cyan)}

  /* 气泡 */
  .bubble{position:absolute;max-width:190px;background:rgba(233,240,252,.96);color:#12203a;border-radius:12px;padding:7px 10px;font-size:12.5px;line-height:1.5;box-shadow:0 4px 14px rgba(0,0,0,.45);z-index:9;animation:pop .25s ease-out}
  .bubble.me{background:rgba(255,222,125,.97)}
  .bubble::after{content:"";position:absolute;left:24px;bottom:-8px;border:9px solid transparent;border-top-color:rgba(233,240,252,.96);border-bottom:0}
  .bubble.me::after{border-top-color:rgba(255,222,125,.97)}
  .bubble .who{font-weight:800;font-size:11px;color:#33507e;margin-right:4px}
  .bubble.me .who{color:#7a5b00}
  @keyframes pop{from{transform:scale(.7) translateY(6px);opacity:0}}
  .pair-line{position:absolute;height:2px;background:linear-gradient(90deg,transparent,#5d7396,transparent);opacity:.55;transform-origin:0 50%;z-index:2}

  /* 书记官台 */
  .scribe{position:absolute;right:12px;bottom:12px;display:flex;align-items:center;gap:9px;background:rgba(10,15,25,.88);border:1px solid var(--line);border-radius:12px;padding:8px 12px;cursor:pointer;z-index:6}
  .scribe img{width:44px;height:44px;border-radius:50%;border:2px solid #7a8699}
  .scribe b{font-size:13px;display:block}
  .scribe i{font-style:normal;font-size:11px;color:var(--dim)}
  .scribe:hover{border-color:var(--gold)}

  /* 浮层菜单 */
  .menu{position:absolute;background:rgba(12,18,30,.97);border:1px solid var(--line);border-radius:12px;padding:8px;min-width:170px;z-index:20;box-shadow:0 10px 34px rgba(0,0,0,.6);display:none}
  .menu.show{display:block;animation:pop .18s ease-out}
  .menu h4{font-size:12.5px;color:var(--gold);margin:2px 4px 7px}
  .menu button{display:block;width:100%;text-align:left;background:var(--panel2);color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:7px 10px;margin:5px 0;cursor:pointer;font-size:12.5px}
  .menu button:hover{border-color:var(--cyan);color:#fff}
  .menu .note{font-size:10.5px;color:var(--dim);margin:4px 2px 0}
  .menu button.danger{border-color:#5c3038}
  .menu button.danger:hover{border-color:var(--danger)}

  /* 顶相位说明与侧注 */
  .phase-tag{position:absolute;left:12px;top:12px;background:rgba(10,15,25,.85);border:1px solid var(--line);border-radius:9px;padding:5px 11px;font-size:12.5px;z-index:6}
  .phase-tag b{color:var(--gold)}
  .legend{position:absolute;left:14px;bottom:12px;background:rgba(10,15,25,.88);border:1px solid var(--line);border-radius:9px;padding:7px 12px;font-size:12px;color:var(--dim);z-index:6;line-height:1.8}
  .legend em{font-style:normal;color:var(--txt)}

  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;margin-top:12px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:11px 13px;font-size:12.5px}
  .card h3{font-size:13.5px;color:var(--gold);margin-bottom:6px}
  .card ul{padding-left:18px}
  .card li{margin:3px 0}
  .card a{color:var(--cyan)}
  .demoBtn{background:var(--panel2);border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px}
  .demoBtn:hover{border-color:var(--cyan)}
  .ok{color:var(--ok)} .warn{color:var(--gold)}
</style>
</head>
<body>
<h1>新返航录 · 场景化 UI 预览 <span class="hint">S0 拍板稿（素材全部 CC0 开源，非最终产品）</span></h1>
<div class="sub">切换下方按钮体验各相位 · 点击场上人物 / 房间 / 船核心 / 书记官查看交互示意 · 编号即座位号（正式版由 View 视角数据驱动）</div>

<div class="bar">
  <div class="seg" id="schemeSeg"></div>
  <div class="sp"></div>
  <div class="seg" id="phaseSeg">
    <button data-ph="day" class="on">☀️ 白天会议</button>
    <button data-ph="night">🌙 夜间·全员闭眼</button>
    <button data-ph="myturn">👁 夜间·轮到你</button>
    <button data-ph="pm"> whisper 私聊散桌</button>
  </div>
  <button id="btnOut" class="demoBtn">出局示例</button>
  <button id="btnBubble" class="demoBtn">发言气泡演示</button>
</div>

<div class="stage-wrap" id="stage">
  <div class="bgimg"></div><div class="veil"></div><div class="stars"></div>
  <div class="rooms" id="rooms"></div>
  <div class="table"></div>
  <div class="core" id="core"><span>船核心</span></div>
  <div id="seats"></div>
  <div id="pairLines"></div>
  <div id="bubbles"></div>
  <div class="phase-tag" id="phaseTag"></div>
  <div class="legend">
    <em>👁 金圈</em>＝轮到你 · <em>灰暗+闭眼条</em>＝夜间闭眼 · <em>✕</em>＝出局(公开) · 濒死无任何视觉(私有)<br>
    配对关系公开(批次①) · 私聊正文只冒自己那组 · 队内频道零气泡
  </div>
  <div class="scribe" id="scribe">
    <img src="${scribe}" alt="书记官">
    <div><b>书记官 · 公开档案</b><i>只记公开信息 · 不参与游戏 · 点击查看</i></div>
  </div>
  <div class="menu" id="menu"></div>
</div>

<div class="cards">
  <div class="card"><h3>拍板清单（请逐项选）</h3><ul>
    <li>① 角色方案：<b>A 卡通船员</b> / <b>B 机器人</b> / <b>C 生物</b>（顶栏切换）</li>
    <li>② 座位识别：圆形头像 + 15 色环 + 头顶编号徽章（是否需要更大编号/名字浮层）</li>
    <li>③ 房间环：上层甲板弧排 8 间工具舱（金框＝可用，灰＝锁定）——布局是否 OK</li>
    <li>④ 背景：本页为 CC0 相片感内景 + 压暗；可选纯矢量内构（更风格化）</li>
    <li>⑤ 气泡样式：白天白底 / 自己黄底（私聊）——大小与位置是否 OK</li>
  </ul></div>
  <div class="card"><h3>素材出处（全部 CC0，无署名义务）</h3><ul>
    <li>角色 A/B/C + 书记官：<a href="https://www.dicebear.com/styles/">DiceBear</a>（open-peeps / voxel-bot / critters / notionists，<a href="https://www.dicebear.com/licenses/">许可证页</a> CC0）</li>
    <li>背景：<a href="https://opengameart.org/content/spaceship-interior">Spaceship Interior · OpenGameArt（Parker West，源自 Pixabay）</a> CC0</li>
    <li>圆桌/椅子/气泡/房间门：本仓自绘组合件</li>
    <li>清单已写入 <em>assets/scene/CREDITS.md</em></li>
  </ul></div>
  <div class="card"><h3>与正式实现的对应（示意 → S1~S3 落地）</h3><ul>
    <li>席位/睁闭眼/出局 → S1 场景渲染器（数据走 View.viewFor，观察者视角）</li>
    <li>房间环/背景/书记官 → S2（grants 派生，无感染/观察舱）</li>
    <li>点人/点房/点船核心 → S3a（菜单选项由待决策表单派生）</li>
    <li>散桌动画/双向气泡/档案与日记 → S3b</li>
  </ul></div>
</div>

<script>
/* ---------- 数据 ---------- */
var AV = ${JSON.stringify(av)};
var SCHEMES = ${JSON.stringify(SCHEMES.map(s => ({ key: s.key, label: s.label })))};
var ROOMS = ${JSON.stringify(ROOMS)};
var PAIRING = [[1,7],[2,9],[3,12],[4,8],[5,14],[6,10],[11,13],[15]]; /* 示意配对(批次①公开) */
var ME = 1, MY_PARTNER = 7;
var scheme = SCHEMES[0].key, phase = 'day', showOut = false, bubbleTimer = null;

var stage = document.getElementById('stage'), seatsEl = document.getElementById('seats');
var menu = document.getElementById('menu');

/* ---------- 席位 ---------- */
/* 椭圆等弧长分布：把 15 席按弧长均分（等角度分布在椭圆上下极会显得拥挤） */
var SEAT_ANGLES = (function(){
  var n = 15, N = 2400, rx = 1.25, ry = 0.72, acc = [0], total = 0;
  for (var k = 1; k <= N; k++){
    var t0 = (k-1)/N*Math.PI*2, t1 = k/N*Math.PI*2, tm = (t0+t1)/2;
    total += Math.hypot(rx*Math.sin(tm), ry*Math.cos(tm)) * (t1-t0);
    acc.push(total);
  }
  var out = [];
  for (var j = 0; j < n; j++){
    var target = j/n*total, lo = 0, hi = N;
    while (lo < hi){ var mid = (lo+hi) >> 1; if (acc[mid] < target) lo = mid+1; else hi = mid; }
    var a0 = (lo-1)/N*Math.PI*2, a1 = lo/N*Math.PI*2;
    var f = (target - acc[lo-1]) / Math.max(1e-9, acc[lo] - acc[lo-1]);
    out.push(a0 + (a1-a0)*f + Math.PI/2);   /* 旋转使 1 号在正下方，顺时针排开 */
  }
  return out;
})();
function seatPos(i, mode){ /* i:1..15 */
  var W = stage.clientWidth, H = stage.clientHeight, cx = W/2, cy = H*0.56;
  var R = Math.min(W*0.395, H*0.42);
  if (mode === 'seated'){
    var a = SEAT_ANGLES[i-1];
    return { x: cx + Math.cos(a)*R*1.25, y: cy + Math.sin(a)*R*0.72 };
  }
  /* 散桌：按配对组分散到外圈 8 个散点位 */
  var g = PAIRING.findIndex(p => p.indexOf(i) >= 0);
  var ga = g/PAIRING.length*Math.PI*2 - Math.PI/2 + 0.2;
  var gx = cx + Math.cos(ga)*(R*1.05), gy = cy + Math.sin(ga)*(R*0.85) - H*0.04;
  var grp = PAIRING[g], k = grp.indexOf(i), n = grp.length;
  var off = (k - (n-1)/2) * 74;
  var tx = Math.cos(ga + Math.PI/2)*off, ty = Math.sin(ga + Math.PI/2)*off*0.45;
  return { x: gx + tx, y: gy + ty + 26 };
}
function renderSeats(){
  seatsEl.innerHTML = '';
  for (var i = 1; i <= 15; i++){
    var d = document.createElement('div');
    d.className = 'seat'; d.dataset.i = i;
    var ring = ${JSON.stringify(PALETTE)}[i-1];
    d.innerHTML = '<div class="sel-ring"></div><div class="av" style="--ring:'+ring+'"><img alt="'+i+'号"></div><div class="chair"></div><div class="num" style="--ring:'+ring+'">'+i+'</div><div class="lids"></div>';
    d.querySelector('img').src = AV[scheme][i-1];
    seatsEl.appendChild(d);
  }
  layout();
}
function layout(){
  var mode = (phase === 'pm') ? 'scatter' : 'seated';
  var seats = seatsEl.children;
  for (var j = 0; j < 15; j++){
    var el = seats[j], i = +el.dataset.i;
    var p = seatPos(i, mode);
    el.style.transform = 'translate(' + (p.x - stage.clientWidth/2) + 'px,' + (p.y - stage.clientHeight*0.56 - 92) + 'px)';
    /* 夜眼纪律（观察者视角）：夜间除「自己(1号)」外全部闭眼；私聊相位自己与配对者醒着 */
    el.classList.toggle('closed', phase !== 'day' && i !== ME && !(phase === 'pm' && i === MY_PARTNER));
    el.classList.toggle('mine', (phase === 'myturn' && i === ME) || (phase === 'pm' && i === ME));
    el.classList.toggle('out', showOut && (i === 4 || i === 11));
  }
  var tag = { day:'☀️ <b>白天</b> · 全员睁眼 · 会议圆桌（点人物=投票/讯问）',
              night:'🌙 <b>夜间</b> · 除你(1号)外全员闭眼 · 桌心呼吸灯=流程进行中（不指向任何席位）',
              myturn:'👁 <b>轮到你</b> · 1号睁眼 · 点击人物/房间/船核心即可行动',
              pm:'whisper <b>配对私聊</b> · 全员散开 · 配对结伴(公开) · 正文气泡仅你与'+MY_PARTNER+'号' }[phase];
  document.getElementById('phaseTag').innerHTML = tag;
  document.getElementById('core').classList.toggle('night', phase === 'night' || phase === 'myturn');
  drawPairLines(mode === 'scatter');
}
function drawPairLines(show){
  var el = document.getElementById('pairLines'); el.innerHTML = '';
  if (!show) return;
  PAIRING.forEach(function(p){
    if (p.length < 2) return;
    var a = seatPos(p[0],'scatter'), b = seatPos(p[1],'scatter');
    var L = Math.hypot(b.x-a.x, b.y-a.y);
    var d = document.createElement('div'); d.className = 'pair-line';
    d.style.left = a.x+'px'; d.style.top = a.y+'px'; d.style.width = L+'px';
    d.style.transform = 'rotate('+Math.atan2(b.y-a.y, b.x-a.x)+'rad)';
    el.appendChild(d);
  });
}

/* ---------- 房间环 ---------- */
var roomsEl = document.getElementById('rooms');
ROOMS.forEach(function(r, idx){
  var d = document.createElement('div');
  d.className = 'room' + (idx === 3 && phase === 'myturn' ? ' lit' : '');
  d.innerHTML = '<div class="ico">'+['🔍','🚓','⚕️','💊','🔧','🛡️','📢','🔫'][idx]+'</div><b>'+r.name+'</b><i>'+r.grant+'</i>';
  d.onclick = function(e){ e.stopPropagation(); openMenu(d, 'room:'+idx); };
  roomsEl.appendChild(d);
});
function refreshRooms(){ [].forEach.call(roomsEl.children, function(c, i){ c.classList.toggle('lit', phase==='myturn' && i===3); }); }

/* ---------- 气泡 ---------- */
var LINES = [
  { i:3,  t:'5 号昨晚的行动对不上，我的票先记着他。' },
  { i:11, t:'别急着归票，先听查验位的说法。' },
  { i:7,  t:'我只想说：这一轮谁划水，下一轮谁先走。' },
];
function popBubble(i, text, isMe, x, y){
  var b = document.createElement('div');
  b.className = 'bubble' + (isMe ? ' me' : '');
  b.innerHTML = '<span class="who">'+i+' 号'+(isMe?'（我）':'')+'</span>'+text;
  b.style.left = x+'px'; b.style.top = y+'px';
  document.getElementById('bubbles').appendChild(b);
  setTimeout(function(){ b.style.transition='opacity .5s'; b.style.opacity='0'; setTimeout(function(){ b.remove(); }, 520); }, 2600);
}
function seatBubble(i, text, isMe){
  var p = seatPos(i, phase==='pm'?'scatter':'seated');
  popBubble(i, text, isMe, Math.min(Math.max(p.x-40, 8), stage.clientWidth-210), Math.max(p.y-78, 8));
}
document.getElementById('btnBubble').onclick = function(){
  var k = 0;
  (function next(){ if (phase==='day'||phase==='pm') seatBubble(LINES[k%3].i, LINES[k%3].t, false); k++; if(k<6) bubbleTimer=setTimeout(next, 1500); })();
  if (phase==='pm'){ setTimeout(function(){ seatBubble(ME,'我跟你说，别声张。',true); }, 500); setTimeout(function(){ seatBubble(MY_PARTNER,'收到，我这边稳住。',false); }, 1700); }
};

/* ---------- 菜单 ---------- */
function openMenu(anchor, kind){
  var rect = anchor.getBoundingClientRect(), sRect = stage.getBoundingClientRect();
  menu.classList.add('show');
  var x = rect.left - sRect.left, y = rect.bottom - sRect.top + 6;
  if (kind === 'room:'+kind.slice(5)) {}
  if (kind.indexOf('room:') === 0){
    var r = ROOMS[+kind.slice(5)];
    menu.innerHTML = '<h4>'+r.name+' · '+r.grant+'</h4>'
      + '<button>使用技能（示意）</button><button>查看说明</button>'
      + '<div class="note">正式版：仅当「轮到你 + 待决策 kind 匹配」时点亮；选项由待决策表单派生。</div>';
  } else if (kind === 'core'){
    menu.innerHTML = '<h4>船核心 · 对船行动</h4>'
      + '<button class="danger">破坏（异形 4b / 外星人 · 示意）</button><button>逃亡（外星人 6.9 · 示意）</button>'
      + '<div class="note">目标是船/自身资格的动作走船核心，不经房间。</div>';
  } else if (kind === 'scribe'){
    menu.innerHTML = '<h4>书记官 · 公开档案</h4>'
      + '<button>批次公告流</button><button>公开发言全文</button><button>投票结果</button>'
      + '<div class="note">只收录公开信息；私人→我的日记本，阵营→阵营日记本。</div>';
  } else {
    var i = +kind;
    var alien = (scheme === 'b-bot'); /* 仅为演示两套菜单样式，与真实阵营无关 */
    menu.innerHTML = '<h4>对 '+i+' 号 · 情境动作</h4>'
      + (alien
        ? '<button class="danger">出刀（示意）</button><button class="danger">感染（示意）</button><button>结茧护盾（示意）</button><div class="note">异形/外星人天赋：直接点目标发动，不经房间。</div>'
        : '<button>查验（示意）</button><button>讯问</button><button>投票 '+i+' 号</button><button>私聊邀请</button><div class="note">选项由当前待决策表单派生（示意）。</div>');
  }
  menu.style.left = Math.min(x, sRect.width-190)+'px';
  menu.style.top = Math.min(y, sRect.height-170)+'px';
}
document.getElementById('core').onclick = function(e){ e.stopPropagation(); openMenu(this,'core'); };
document.getElementById('scribe').onclick = function(e){ e.stopPropagation(); openMenu(this,'scribe'); };
seatsEl.addEventListener('click', function(e){
  var s = e.target.closest('.seat'); if (!s) return;
  openMenu(s, s.dataset.i);
});
document.addEventListener('click', function(){ menu.classList.remove('show'); });
menu.addEventListener('click', function(e){ e.stopPropagation(); });

/* ---------- 控制条 ---------- */
var schemeSeg = document.getElementById('schemeSeg');
SCHEMES.forEach(function(s, i){
  var b = document.createElement('button'); b.textContent = s.label.split(' · ')[0];
  if (!i) b.classList.add('on');
  b.onclick = function(){ scheme = s.key; renderSeats(); refreshRooms(); [].forEach.call(schemeSeg.children, function(c){ c.classList.remove('on'); }); b.classList.add('on'); };
  schemeSeg.appendChild(b);
});
var phaseSeg = document.getElementById('phaseSeg');
[].forEach.call(phaseSeg.children, function(b){
  b.onclick = function(){ phase = b.dataset.ph; [].forEach.call(phaseSeg.children, function(c){ c.classList.remove('on'); }); b.classList.add('on'); layout(); refreshRooms();
    if (phase==='pm'){ setTimeout(function(){ seatBubble(ME,'情报只到你我这。',true); }, 900); setTimeout(function(){ seatBubble(MY_PARTNER,'明白，白天见。',false); }, 2100); } };
});
document.getElementById('btnOut').onclick = function(){ showOut = !showOut; layout(); };
window.addEventListener('resize', layout);

renderSeats(); refreshRooms();
</script>
</body>
</html>`;
  const out = path.join(SCENE_DIR, 'preview.html');
  fs.writeFileSync(out, html, 'utf8');
  console.log('preview.html 就绪（' + (fs.statSync(out).size / 1024 / 1024).toFixed(2) + ' MB，自包含单文件）');
}

(async () => {
  try {
    fs.mkdirSync(path.join(SCENE_DIR, 'characters'), { recursive: true });
    const n = await ensureCharacters();
    writeCredits();
    buildPreview();
    console.log(`完成（新下载 ${n} 个头像；--force 可全量重下）`);
  } catch (e) {
    console.error('生成失败：', e.message);
    process.exit(1);
  }
})();
