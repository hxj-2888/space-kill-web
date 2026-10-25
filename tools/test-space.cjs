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
  for (const f of ['crew-navy', 'crew-teal', 'crew-gray', 'crew-slate']) {
    if (!fs.existsSync(path.join(ASSET, 'crew', f + '.png'))) missing.push('角色 ' + f);
  }
}
ok('U1E：素材在位（地板 / 家具 / 角色都在 assets/scene/cozy/）', missing.length === 0);
if (missing.length) missing.slice(0, 8).forEach(function (m) { console.log('       - 缺 ' + m); });

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

console.log('');
console.log('房间布局门禁：通过 ' + pass + ' 条、失败 ' + fail + ' 条');
if (fail) process.exitCode = 1;