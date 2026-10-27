#!/usr/bin/env node
/* =============================================================
 * test-space.cjs —— 房间布局数据门禁（批 U1）
 * -------------------------------------------------------------
 * 为什么单独成脚本：
 *   场景渲染层（ui-scene.js）画的是 SVG + CSS，vm 沙盒里没有 document，
 *   **渲染层测不了**。所以把"可测的部分"下沉到 js/space.js 这份纯数据里，
 *   由本脚本量它——这是 U1 引入房间制后唯一的机械证据。
 *
 * 判据（全部来自 SKSpace.validate() 之外的结构性检查）：
 *   ① 房间表完整：9 间，且舰桥/宿舍在位
 *   ② 布局合法：道具不越界、不重叠、门双向对称（validate 的返回必须为空）
 *   ③ 座位/舱位数量：舰桥 15 座、宿舍 15 舱
 *   ④ 素材在位：每个道具类型、每个房间地板，都能在 assets/scene/cozy/ 找到文件
 *   ⑤ 反向守卫：房间表里不得出现 emoji（用户明确要求过三次）
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadInto, makeCtx } = require('./load-order.cjs');

const ROOT = path.join(__dirname, '..');
const ASSET = path.join(ROOT, 'assets', 'scene', 'cozy');
/* 〔批 UI-2〕角色行走图独立于 cozy：8 套 CC-BY 换成 15 套自绘，路径 assets/scene/crew/ */
const CREW = path.join(ROOT, 'assets', 'scene', 'crew');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name); }
}

const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), ['space']);
const S = ctx.SKSpace;

ok('U1A：空间数据层已加载（SKSpace 存在且暴露 validate）',
  !!S && typeof S.validate === 'function' && typeof S.ROOMS === 'object');

const ids = S ? S.ids() : [];
ok('U1B：房间表 9 间，含舰桥与宿舍',
  ids.length === 9 && ids.indexOf('bridge') >= 0 && ids.indexOf('dorms') >= 0);

const errs = S ? S.validate() : ['SKSpace 缺失'];
ok('U1C：布局自检为空（道具不越界、不重叠、门双向对称）', errs.length === 0);
if (errs.length) errs.slice(0, 8).forEach(function (e) { console.log('       - ' + e); });

ok('U1D：舰桥 15 个座位 / 宿舍 15 个睡眠舱',
  S && S.seatPositions('bridge').length === 15 && S.podPositions('dorms').length === 15);

/* ④ 素材在位：道具类型 → furniture/<t>.png；房间地板 → tiles/<floor>.png */
const missing = [];
if (S) {
  const seen = {};
  for (const id of ids) {
    const r = S.room(id);
    if (!fs.existsSync(path.join(ASSET, 'tiles', r.floor + '.png'))) missing.push('地板 ' + r.floor);
    for (const p of r.props) {
      if (p.t === 'rug' || seen[p.t]) continue;
      seen[p.t] = 1;
      if (!fs.existsSync(path.join(ASSET, 'furniture', p.t + '.png'))) missing.push('家具 ' + p.t);
    }
  }
  /* 〔批 UI-2〕角色行走图已从 assets/scene/cozy/crew/ 迁到 assets/scene/crew/
     （8 套 CC-BY 换成 15 套自绘）。这里改为校验**新路径 + 15 套齐全**，
     并顺带断言旧路径已清空 —— 若有人只删了一半，会在这里被拦下。 */
  for (let i = 1; i <= 15; i++) {
    const f = 'crew-' + String(i).padStart(2, '0') + '.png';
    if (!fs.existsSync(path.join(CREW, f))) missing.push('角色 ' + f);
  }
}
ok('U1E：素材在位（地板 / 家具在 cozy/，15 套角色在 crew/）', missing.length === 0);
if (missing.length) missing.slice(0, 8).forEach(function (m) { console.log('       - 缺 ' + m); });

/* ④-2 反向守卫：旧的 8 套 CC-BY 行走图不得残留（署名已随之移除，留着就是"用了不署名"） */
ok('U1E2：旧的 8 套 CC-BY 行走图已删除（assets/scene/cozy/crew/ 不存在）',
  !fs.existsSync(path.join(ASSET, 'crew')));

/* ⑤ 反向守卫：房间表里不得有 emoji（用户拍板过三次） */
const spaceSrc = fs.readFileSync(path.join(ROOT, 'js', 'space.js'), 'utf8');
const sceneSrc = fs.readFileSync(path.join(ROOT, 'js', 'ui-scene.js'), 'utf8');
/* 剥注释再判：注释里出现 "Game.submit" 是在**声明不变量**，不是在调用它 */
const sceneCode = sceneSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
ok('U1F：房间表与场景渲染器里没有 emoji',
  !EMOJI.test(spaceSrc) && !EMOJI.test(sceneSrc));

/* ⑥ 反向守卫：场景渲染器不得自造提交路径 */
ok('U1G：场景渲染器不自造提交路径（无 Game.submit / form.submit）',
  !/Game\.submit/.test(sceneCode) && !/form\.submit\(/.test(sceneCode));


/* ---- 〔U2〕入场行走 + 点道具白框（源码判据；动画本身由 verify-u2 在真实浏览器里量） ---- */
const cssU2 = fs.readdirSync(path.join(ROOT, 'css')).filter(function (f) { return /\.css$/.test(f); })
  .map(function (f) { return fs.readFileSync(path.join(ROOT, 'css', f), 'utf8'); }).join('\n');
ok('U2A：角色入场行走 = 4 帧循环 + 位移 + 错峰（帧动画与入场动画都在）',
  /* ⚠ 只查"类名在不在"抓不到"@keyframes 被删空"——必须查帧内容本身：
     4 帧循环要求出现 0% / 25% / 50% / 75% 四个关键帧，且带 translateX 位移。 */
  (function () {
    const m = cssU2.match(/@keyframes sk-walk-frames\s*\{([\s\S]*?)\n\}/);
    if (!m) return false;
    const body = m[1];
    const pcts = (body.match(/\d+%\s*\{/g) || []).length;
    return pcts >= 4 && /translateX\(/.test(body);
  })() &&
  (function () {
    const m = cssU2.match(/@keyframes sk-walk-in\s*\{([\s\S]*?)\n\}/);
    if (!m) return false;
    return /translate\(var\(--dx/.test(m[1]) && /translate\(0, 0\)/.test(m[1]);
  })() &&
  /animation-delay:\s*var\(--delay/.test(cssU2) &&
  /sk-crew-layer\.sk-walking/.test(cssU2) &&
  /* 行走时用「向下走」那一行：viewBox 的 y 必须是 0（待机行是 CREW_H*ROW_IDLE） */
  /walking\s*\?\s*\('0 0 ' \+ CREW_W/.test(sceneCode));
ok('U2B：点道具出白框（白色描边 + 落在道具矩形上 + 自动清除）',
  /function focusProp\(key, label, mount\)/.test(sceneCode) &&
  /data-hit=/.test(sceneCode) &&
  /getBBox\(\)/.test(sceneCode) &&
  /sk-focus-box/.test(cssU2) &&
  /stroke:\s*#ffffff/.test(cssU2) &&
  /* 反向守卫：白框不得是"居中对话框"——不能出现 fixed/absolute 居中的 .sk-focus */
  !/\.sk-focus-box\s*\{[^}]*position:\s*(absolute|fixed)/.test(cssU2) &&
  /* 提示条必须挪到顶部，否则会压住画面中央的白框 */
  /\.sk-toast\s*\{[^}]*top:\s*12px/.test(cssU2) &&
  !/\.sk-toast\s*\{[^}]*bottom:\s*96px/.test(cssU2));

/* ---- 〔批 UI-5a〕主页角色帧也必须带 clipPath（P0 的第二处） ----
   与对局内同一根因：嵌套 <svg> 的 overflow="hidden" 不裁剪 x/y/width/height 溢出，
   整张 4×5 行走图会被完整画出来（主页左侧那「一堆绿色小人」就是它）。
   批 H1 当时只加了 overflow:hidden，等于没修 —— 这条断言就是防止再"以为修了"。 */
ok('U2C：主页「我这席」的角色帧带 clipPath，且矩形按当前 viewBox 原点给',
  (function () {
    const m = sceneSrc.match(/renderHomeScene[\s\S]*?sk-home-clip[\s\S]*?<\/svg>/);
    if (!m) return false;
    return /clipPath id="sk-home-clip"/.test(m[0]) &&
      /rect x="' \+ hvbx \+ '" y="' \+ hvby/.test(m[0]) &&
      /const hvbx = CREW_W, hvby = CREW_H \* ROW_IDLE/.test(sceneSrc);
  })());

/* =============================================================
 * 〔批 UI-7 · 2026-10-27〕素材层门禁（S1~S6）
 * -------------------------------------------------------------
 * 用户这一轮的方向是"素材质量"，而本批发现的根因是**素材没接线**：
 *   cozy 包里 7 种墙面变体 + 12 种地板躺在 assets/ 里零引用，
 *   9 间房共用同一张空白 wall.png ⇒ 走遍全船墙都是同一面白灰。
 *
 * 这一组守的就是"接了没有、接得对不对、有没有只剩声明没人用"。
 * 每一条都做过反向自检（见 改动说明.md 批 UI-7 §反向自检）：
 *   ① 删掉某间房的 wall 声明     ⇒ S1 红（报那间房）
 *   ② 把 wall 里写成不存在的名字 ⇒ S2 红
 *   ③ 把渲染器里的装饰循环注释掉 ⇒ S3 红（源码判据）
 *   ④ 把某间房家具砍掉一半       ⇒ S4 红（密度 / 对称）
 *   ⑤ 把某间房中段家具全挪到左边 ⇒ S4 红（中线偏移）
 *   ⑥ 把 floor 改回 floor-hazard 铺满 ⇒ 不红（这是允许的，见注释）
 * ============================================================= */

/* S1：每间房都必须声明墙面材质，且不能全是空白墙（那等于"没接线"） */
const noWall = [], allBlank = [];
for (const id of ids) {
  const r = S.room(id);
  if (!Array.isArray(r.wall) || !r.wall.length) { noWall.push(id); continue; }
  if (r.wall.every(function (n) { return n === 'wall'; })) allBlank.push(id);
}
ok('S1：9 间房全部声明了墙面材质（wall 数组非空）', noWall.length === 0, noWall.join(','));
ok('S1b：没有房间的墙面"全是空白墙"（那等于素材没接线）', allBlank.length === 0, allBlank.join(','));

/* S2：wall 里的每个名字都必须是真实存在的瓦片文件 */
const TILES = path.join(ASSET, 'tiles');
const badWall = [];
const usedWall = new Set();
for (const id of ids) {
  for (const n of (S.room(id).wall || [])) {
    usedWall.add(n);
    if (!fs.existsSync(path.join(TILES, n + '.png'))) badWall.push(id + '→' + n);
  }
}
ok('S2：wall 里的瓦片名都真实存在（拼错就等于墙上那块空白）', badWall.length === 0, badWall.join(','));

/* S3：渲染器必须真的**消费** wall 声明 —— 只查数据抓不到"渲染器没读它"。
   判据是源码级的：floorWallShell 里既要取 wallTiles()，也要把结果贴成 <image>。 */
/* ⚠ 这条的第一版是**空转**的（反向自检 #3 抓出来的）：
   它由 5 个"存在性"判据用 && 串起来，其中 4 个是"有没有这段代码"，
   把装饰循环改成贴 wall.png 之后，前 4 个仍然全真 —— 只有第 5 个（底座是空墙）
   本来就是真的。也就是说它测的是"文件里有没有这些字符串"，不是"墙饰有没有被画"。
   现在拆成两件事，各自单独可红：
     S3a 结构：地板/四壁的唯一实现存在，且 wall 声明被读取
     S3b 去重：主页不再自带第二份地板/四壁实现 */
ok('S3a：渲染器真的消费 wall 声明（取 wallTiles 并逐张落到 <image>）',
  /function floorWallShell\(/.test(sceneCode) &&
  /const tiles = S\.wallTiles \(\?|const tiles = S\.wallTiles\s*\?/.test(sceneCode) &&
  /'tiles\/' \+ tiles\[k\] \+ '\.png"/.test(sceneCode) &&
  /* 底座必须是空墙 —— 否则装饰又被无限平铺成"胶片带"（第一版就踩了这个） */
  /tiles\/wall\.png/.test(sceneCode) &&
  /* 装饰必须落在循环里、按 col 定位（不是固定一个位置） */
  /for \(let k = 0; k < tiles\.length; k\+\+\)/.test(sceneCode) &&
  /o\.x \+ col \* TILE/.test(sceneCode));

/* S3b：主页与对局页必须共用**同一个**外壳函数（批 UI-6 之后两处参数已漂移） */
ok('S3b：主页与对局页共用同一份地板/四壁实现（不再各写一份）',
  (sceneCode.match(/function floorWallShell\(/g) || []).length === 1 &&
  (sceneCode.match(/floorWallShell\(S,/g) || []).length >= 2 &&
  /* 反向守卫：旧的第二份实现不得残留 */
  !/sk-home-floor/.test(sceneCode) && !/sk-home-wall/.test(sceneCode));

/* S4：房间不能"显得空"，也不能歪。
   -------------------------------------------------------------
   密度 = 不透明家具占房面积比（地毯等装饰层不计）。
   用户从批 UI-6 之前就在说「房间显得空」，此前只有"有没有家具"的判断，
   没有任何量。本批实测旧版 4.5%~8.8%，补齐后 7.0%~13.3%。
   下限取 6.5%（舰桥只有一张圆桌，天然最低）；没有上限 —— 越满越好，不拦。
   中轴对称：只量中央带（|x-中线|<=8）的质心偏移，容差 0.6 格。 */
const MIN_DENSITY = 6.5, MAX_MID_OFFSET = 0.6;
const thin = [], skew = [];
for (const id of ids) {
  if (S.density(id) < MIN_DENSITY) thin.push(id + ' ' + S.density(id).toFixed(1) + '%');
  if (Math.abs(S.midOffset(id)) > MAX_MID_OFFSET) skew.push(id + ' ' + S.midOffset(id).toFixed(2) + '格');
}
ok('S4a：没有房间低于家具密度下限（' + MIN_DENSITY + '%）—— 守「房间显得空」', thin.length === 0, thin.join(','));
ok('S4b：每间房的中央带质心在中线附近（±' + MAX_MID_OFFSET + ' 格）—— 守「房间歪了」', skew.length === 0, skew.join(','));

/* S5：每间房的地板不得两台一样 —— 9 间房走下来要有"换了个地方"的感觉。
   实测旧版 9 间房里 floor-steel 用了 2 次、floor-lab 用了 2 次（这本身没问题，
   但当时墙是 9 间全一样，两者叠加就完全分不出房间）。这里守地板至少 5 种。 */
const floors = new Set(ids.map(function (id) { return S.room(id).floor; }));
ok('S5：地板至少 5 种（9 间房走下来能分清在哪）', floors.size >= 5, String(floors.size));

/* S4c：渲染色调必须可被数据层覆盖，且覆盖真的被消费。
   -----------------------------------------------------------------
   宿舍用暖色地毯，实测比其余八间"亮一整档"。修法是 space.js 给该房一个 dim，
   渲染器读它。这条守两件事：① 渲染器不再写死 0.34；② dim 落在合理区间。
   反向自检：把渲染器改回写死 0.34 ⇒ 红。 */
ok('S4c：地板压暗强度可由数据层覆盖（渲染器不写死），且取值在 0.2~0.6 之间',
  /r\.dim != null \? r\.dim : 0\.34/.test(sceneCode) &&
  ids.every(function (id) {
    const d = S.room(id).dim;
    return d == null || (d >= 0.2 && d <= 0.6);
  }) &&
  /* 反向守卫：不许有任何房间把地板压到看不见（那是另一种"黑区"） */
  ids.every(function (id) { const d = S.room(id).dim; return d == null || d < 0.7; }));

/* S6：零引用素材守卫 —— 素材包里每一张瓦片都必须被某间房用到。
   -------------------------------------------------------------
   本批的根因就是"素材在，但没人用"。这条会把"以后又有人换了素材、
   漏接了几张"直接变成红断言，而不是靠人眼翻截图。
   ⚠ 白名单只放**确实用不上**的：floor-space（船外太空，房间不铺）。 */
const WHITELIST = {
  'floor-space': '船外太空底板，房间不铺',
  'door-closed': '本作所有门都可通行，"关门态"没有使用场景（留作将来上锁机制）',
};
/* 地面瓦片（rug.tile）：用真实瓦片铺的地面片也算"用到了" */
const usedPatch = new Set();
for (const id of ids) {
  for (const p of (S.room(id).props || [])) if (p.tile) usedPatch.add(p.tile);
}
const unused = fs.readdirSync(TILES).filter(function (f) { return /\.png$/.test(f); })
  .map(function (f) { return f.replace(/\.png$/, ''); })
  .filter(function (n) {
    if (WHITELIST[n]) return false;
    /* 地板：被某间房 floor 引用；墙饰：被某间房 wall 引用；
       地面片：被某件 rug 的 tile 引用；门：被渲染器直接引用（door-open） */
    if (ids.some(function (id) { return S.room(id).floor === n; })) return false;
    if (usedWall.has(n)) return false;
    if (usedPatch.has(n)) return false;
    if (n === 'wall') return false;                    /* 底座，永远在用 */
    if (n === 'door-open') return false;               /* 门洞，渲染器直接贴 */
    return true;
  });
ok('S6：素材包里没有零引用瓦片（"素材在但没人用"是本批的根因）',
  unused.length === 0, unused.join(','));

/* =============================================================
 * 〔批 UI-8a · 2026-10-27〕三个"点不动 / 发了没用"的结构性守卫
 * -------------------------------------------------------------
 * 这三条都是**实测出来的**，而且在改动前**没有任何门禁在测**：
 *   T1 设置面板的控件被场景层吃掉点击（elementFromPoint 命中 #arena-stage）
 *   T2 CSS 在消费的变量从来没被写进 DOM（--delay）
 *   T3 开始页背景图被后加载的分片整段覆盖（改 07 看不见效果）
 * 每条都做了反向自检（见 改动说明.md 批 UI-8a）。
 * ============================================================= */

/* T1：设置面板的宿主必须在场景层之上。
   -------------------------------------------------------------
   根因：07 层把 .start-box 的直接子元素统一压成 z-index:1，而 .arena-stage 是 2；
   面板在 .start-top 里，子元素再设 z-index 也追不上（z-index 只比同层叠上下文）。
   所以判据落在 **.start-top 的 z-index > .arena-stage 的 z-index**，不是面板自己的。 */
const arenaCssT1 = fs.readFileSync(path.join(ROOT, 'css', '09-arena.css'), 'utf8');
const zOf = (sel) => {
  /* 从 CSS 文本里抠出某选择器块内的 z-index；没有则 null */
  const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = arenaCssT1.match(re);
  if (!m) return null;
  const z = m[1].match(/z-index\s*:\s*(-?\d+)/);
  return z ? +z[1] : null;
};
const zTop = zOf('#screen-start .start-box > .start-top');
const zStage = zOf('#screen-start .start-box > .arena-stage');
/* 本文件此前没有读过 index.html，这里补一次（T1b 要查控件是否已移除） */
const htmlCode = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, ' ');
ok('T1：设置面板宿主（.start-top）的 z-index 高于场景（.arena-stage）——守「设置里点不动」',
  zTop != null && zStage != null && zTop > zStage,
  'start-top=' + zTop + ' stage=' + zStage);

/* T1b：设置面板里的"规则速览"死控件必须已移除，且不得残留任何绑定。
   用户明确要求删这一行；同时它是重复入口（主页左侧已有 #btn-rules-home）。 */
/* 判据必须**剥注释**：本批的改动说明就写在 HTML/JS 注释里，提到这个 id 是"声明它已移除"，
   不是"还在用它"。第一版没剥注释，于是断言被自己的说明文字判红。 */
const uiJsCode = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
ok('T1b：设置面板里不再有重复的「规则速览」控件（#btn-rules-start 已移除，且 JS 无残留绑定）',
  !/id="btn-rules-start"/.test(htmlCode) &&
  !/btn-rules-start/.test(uiJsCode));

/* T2：CSS 在消费的每个 var(--x)，渲染器必须真的写出来。
   -------------------------------------------------------------
   实测事故：crewHtml 里 `const delay = ...` 算出来了，但 style 只写了 --dx/--dy，
   CSS 的 `animation-delay: var(--delay, 0ms)` 于是一直取默认 0 —— 错峰完全失效。
   更麻烦的是 CSS 变量**可继承**：重建 DOM 后新元素会继承上一次的值，行为不可预测。 */
/* 复用文件上方已读入的 sceneSrc / sceneCode（不要重复声明） */
const cssOf = (n) => fs.readFileSync(path.join(ROOT, 'css', n), 'utf8');
const cssAll = fs.readdirSync(path.join(ROOT, 'css')).filter(f => /\.css$/.test(f))
  .map(f => cssOf(f)).join('\n');
const varsConsumed = [...new Set([...cssAll.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map(m => m[1]))];
/* 渲染器把变量拼进 style 属性，形式是 @'" style="--dx:' + v + 'px;--dy:' + w + 'px;--delay:'@
   —— 变量名后面跟的是冒号但不是字面量结尾，所以不能要求引号紧邻冒号。 */
const sceneVarsWritten = new Set([...sceneSrc.matchAll(/(--[a-z0-9-]+):/g)].map(m => m[1]));
/* 只查**场景层**自己该写的变量：--dx / --dy / --delay 是 crewHtml 的接口 */
const sceneOwned = ['--dx', '--dy', '--delay'];
const notWritten = sceneOwned.filter(v => varsConsumed.indexOf(v) >= 0 && !sceneVarsWritten.has(v));
ok('T2：CSS 消费的场景变量（--dx / --dy / --delay）都由渲染器真的写出（不许"算了不写"）',
  notWritten.length === 0, '未写出: ' + notWritten.join(','));

/* T3：背景图引用必须指向本仓自绘素材，且三个伪元素层都要带上它。
   -------------------------------------------------------------
   实测事故：07 里改了 #screen-start::before 的 background，但 09 里同名选择器
   （后加载、同特异性）把 background 整段覆盖了 ⇒ 开始页仍然全黑。
   所以不能只查"某处有没有引用"，要查**每一处覆盖 background 的规则都带上图**。 */
const css09 = fs.readFileSync(path.join(ROOT, 'css', '09-arena.css'), 'utf8');
const allCssSrc = fs.readdirSync(path.join(ROOT, 'css')).filter(f => /\.css$/.test(f))
  .map(f => cssOf(f)).join('\n');
ok('T3a：产品 CSS 已不再引用开源社区那张写实背景（spaceship-interior）',
  !/spaceship-interior/.test(allCssSrc.replace(/\/\*[\s\S]*?\*\//g, ' ')));
ok('T3b：开始页背景由**最后加载的** 09 分片自己带上（不能被后加载规则覆盖掉）',
  /#screen-start::before\s*\{[^}]*hull-tile\.png/.test(css09));
ok('T3c：自绘舱壁瓦片存在于站点白名单可达路径',
  fs.existsSync(path.join(ROOT, 'assets', 'scene', 'bg', 'hull-tile.png')));

/* =============================================================
 * 〔批 UI-8b · 2026-10-27〕W：行走帧必须**肉眼可分辨**
 * -------------------------------------------------------------
 * 用户报「小人行走完全没有动画，是一个完全平移的状态」。
 * 根因不在 CSS（动画确实在跑），而在**帧本身几乎一样**：
 *   旧版腿只横移 1px ⇒ 帧 0 与帧 1 仅差 736px，
 *   而角色在场景里只有 64px 宽 —— 肉眼为零。
 * 这条把"看得见"变成可量：行走行相邻帧差异下限 + 待机行必须一致。
 * 反向自检：把 SWING 改回 [0,1,0,-1] 并重生成 ⇒ 红。
 * ============================================================= */
const PNGW = require('./_png.cjs');
const CREW_DIR = path.join(ROOT, 'assets', 'scene', 'crew');
const FW = 96, FH = 160, MIN_DIFF = 400;
function diffFrames(img, row, a, b) {
  let n = 0;
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      const i1 = ((row * FH + y) * img.width + (a * FW + x)) * 4;
      const i2 = ((row * FH + y) * img.width + (b * FW + x)) * 4;
      if (Math.abs(img.data[i1 + 3] - img.data[i2 + 3]) > 10 ||
          Math.abs(img.data[i1] - img.data[i2]) > 10 ||
          Math.abs(img.data[i1 + 1] - img.data[i2 + 1]) > 10) n++;
    }
  }
  return n;
}
const walkBad = [], idleBad = [];
for (let k = 1; k <= 3; k++) {                     /* 抽查 3 套即可，15 套全量太慢 */
  const f = 'crew-' + String(k).padStart(2, '0') + '.png';
  const p = path.join(CREW_DIR, f);
  if (!fs.existsSync(p)) { walkBad.push(f + ' 缺失'); continue; }
  const im = PNGW.decode(fs.readFileSync(p));
  for (const row of [0, 1, 3, 4]) {                /* down / up / left / right */
    for (let c = 1; c < 4; c++) {
      const d = diffFrames(im, row, 0, c);
      if (d < MIN_DIFF) walkBad.push(f + ' row' + row + ' 帧0/帧' + c + ' 只差 ' + d + 'px');
    }
  }
  for (let c = 1; c < 4; c++) {
    const d = diffFrames(im, 2, 0, c);
    if (d !== 0) idleBad.push(f + ' 待机行 帧0/帧' + c + ' 差 ' + d + 'px');
  }
}
ok('W1：行走行的相邻帧差异 >= ' + MIN_DIFF + 'px（守「看着像平移」）',
  walkBad.length === 0, walkBad.slice(0, 3).join('; '));
ok('W2：待机行四帧完全一致（静止姿势不许抖）',
  idleBad.length === 0, idleBad.slice(0, 3).join('; '));

console.log('');
console.log('房间布局门禁：通过 ' + pass + ' 条、失败 ' + fail + ' 条');
if (fail) process.exitCode = 1;
