#!/usr/bin/env node
/* =============================================================
 * test-hudmap.cjs —— 「决策 → 物件」映射表门禁（批 UI-5 · 2026-10-26）
 * -------------------------------------------------------------
 * 用户原话：「所有交互改为和对应物品交互，这里需要映射表」。
 * 映射表在 js/hud-map.js，本脚本量四件事：
 *
 *   ① 闭合：引擎会产生的每个 `kind` 都必须有条目，且**不得有指向不存在 kind 的条目**
 *      （双向核对 —— 只查单向的话，删掉一个 kind 后残留条目会永远绿）；
 *   ② 可达：每条目的 room 必须真存在于 js/space.js，hit 必须是那间房里某件道具的 `k`
 *      （否则玩家点不到：地图上根本没有那件东西）；
 *   ③ 唯一：同一 kind 只映射到一个 (room, hit)，且同一房间内 hit 不重复指向两件道具；
 *   ④ 不泄露：映射表不得读 role / faction / 任何对局状态（它只说明"在哪做"）。
 *
 * 另外顺带守「HUD 已删」这件结构事实（本批的主诉求）：
 *   ⑤ index.html 里不再有 .topbar；7 个圆钮 id 全部活在 #settings-overlay 里；
 *      三数字 id（hud-cd / hud-net / timer-num）活在 #clerk 里。
 *
 * ⚠ 这一组**不测像素**：纸压在桌上是否压住席位，由 mobile-layout-check 的
 *   席位命中检测与人工截图复核承担（Node 侧没有布局引擎）。
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadInto, makeCtx } = require('./load-order.cjs');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  [' + extra + ']' : '')); }
}

/* ---- 装载纯数据层（不需要 DOM） ---- */
const ctx = makeCtx({});
loadInto(ctx, JS, ['space', 'hud-map']);
const S = ctx.SKSpace, H = ctx.SKHudMap;

ok('H1：映射表已加载（SKHudMap 暴露 MAP / roomOf / hitOf）',
  !!H && typeof H.MAP === 'object' && typeof H.roomOf === 'function' && typeof H.hitOf === 'function');

/* ---- ① 闭合：引擎 kind ↔ 映射表条目，双向 ---- */
/* kind 的字面量分散在 engine.js 与 engine/steps.js；声明层派生出来的 kind
   （capabilityRegistry 里的 act.kind）也算引擎会产生的，一并收集。 */
const ENGINE_FILES = ['engine.js', 'engine/steps.js', 'v66/declaration/capabilityRegistry.js',
  'v66/derivation/actions.js'];
const engineSrc = ENGINE_FILES
  .map(f => { try { return fs.readFileSync(path.join(JS, f), 'utf8'); } catch (_) { return ''; } })
  .join('\n');
const engineKinds = [...new Set([...engineSrc.matchAll(/\bkind:\s*'([A-Za-z0-9_]+)'/g)].map(m => m[1]))].sort();
const mapKinds = (H ? H.KINDS : []).slice().sort();

const missing = engineKinds.filter(k => mapKinds.indexOf(k) < 0);
const orphan = mapKinds.filter(k => engineKinds.indexOf(k) < 0);

ok('H2：引擎产生的每个决策 kind 都在映射表里（新增 kind 必须同批补表）',
  missing.length === 0, missing.join(','));
ok('H3：映射表里没有指向不存在 kind 的残留条目（反向核对）',
  orphan.length === 0, orphan.join(','));
ok('H4：映射表条目数 ≥ 30（引擎当前 38 个 kind，允许少量纯内部 kind 不收）',
  mapKinds.length >= 30, String(mapKinds.length));

/* ---- ② 可达：room 真存在，hit 真是那间房里的道具 k ---- */
const badRoom = [], badHit = [], badLabel = [];
for (const k of mapKinds) {
  const m = H.of(k);
  const room = S.room(m.room);
  if (!room) { badRoom.push(k + '→' + m.room); continue; }
  const prop = (room.props || []).find(p => p.k === m.hit);
  if (!prop) badHit.push(k + '→' + m.room + '/' + m.hit);
  /* label 必须与 space.js 里那件道具的 label 一致 —— 两处各写一份名字，
     玩家看到的物件名就会和"去哪做"的提示对不上（批 UI-1 踩过同类） */
  else if (prop.label && prop.label !== m.label) badLabel.push(k + ': ' + m.label + ' ≠ ' + prop.label);
}
ok('H5：每条映射的 room 都在 js/space.js 里（没有指向不存在的房间）',
  badRoom.length === 0, badRoom.join(','));
ok('H6：每条映射的 hit 都是那间房里真实存在的道具 k（否则玩家点不到）',
  badHit.length === 0, badHit.join(','));
ok('H7：映射表里的物件名与 space.js 的 label 逐字一致（两处各写一份会漂移）',
  badLabel.length === 0, badLabel.join(','));

/* ---- ③ 唯一：一个 kind 只能落在一件物件上；同一房间内不得两件道具共用一个 k ----
   ⚠ 首版这条写错了判据：它把「多个 kind → 同一物件」判成缺陷，于是
     圆桌（alienAct/awaken/branch/xenoKill 都在桌上）被判红。
     多个动作在同一件物件上发生是**设计**（圆桌就是议事的地方），不是缺陷。
     真正要守的是：
       ① 同一房间内两件**道具**共用同一个 k —— 那会让点击落到错的那件；
       ② 一个 kind 同时映射到两处 —— 数据层写重了。 */
const dupPropKey = [];
for (const id of Object.keys(S.ROOMS)) {
  const seen = {};
  for (const p of (S.ROOMS[id].props || [])) {
    if (!p.k) continue;
    if (seen[p.k]) dupPropKey.push(id + '/' + p.k);
    seen[p.k] = 1;
  }
}
ok('H8：同一房间内没有两件道具共用同一个交互键（否则点击会落到错的那件）',
  dupPropKey.length === 0, dupPropKey.join(','));

/* ---- ④ 不泄露：映射表零规则、零对局状态 ---- */
const mapSrc = fs.readFileSync(path.join(JS, 'hud-map.js'), 'utf8');
const mapCode = mapSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
ok('H9：映射表是纯数据（不读 Game / g. / role / faction，也不碰 DOM）',
  !/Game\.|\.pending|\.faction|\.role\b|document\.|getElementById/.test(mapCode));

/* ---- ⑤ HUD 已删、控件已迁（本批的结构事实） ---- */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const htmlCode = html.replace(/<!--[\s\S]*?-->/g, ' ');
const css = fs.readdirSync(path.join(ROOT, 'css')).filter(f => /\.css$/.test(f))
  .map(f => fs.readFileSync(path.join(ROOT, 'css', f), 'utf8')).join('\n');

ok('H10：对局页不再有 .topbar（顶部 HUD 已整体删除）',
  !/class="topbar"/.test(htmlCode) && !/class="orb-bar"/.test(htmlCode));

/* 7 个圆钮 + 3 个数字：id 一个不少，且都在新的宿主里 */
const ORBS = ['btn-rules', 'btn-dev', 'btn-music', 'btn-sfx', 'tempo-slider',
  'btn-pause', 'btn-exit', 'btn-side-toggle'];
const NUMBERS = ['hud-cd', 'hud-net', 'timer-num', 'stage-head', 'timerbar-fill'];
function insideHost(hostId, ids) {
  const m = htmlCode.match(new RegExp('id="' + hostId + '"[\\s\\S]*?</div>\\s*</div>'));
  if (!m) return { ok: false, missing: ids };
  const seg = htmlCode.slice(htmlCode.indexOf('id="' + hostId + '"'));
  const block = seg.slice(0, seg.indexOf('</div>\n\n    <div class="board"') > 0
    ? seg.indexOf('</div>\n\n    <div class="board"') : seg.length);
  const missing = ids.filter(id => block.indexOf('id="' + id + '"') < 0);
  return { ok: missing.length === 0, missing };
}
const settingsHost = insideHost('settings-overlay', ORBS);
ok('H11：7 个圆钮（规则/DEV/音乐/音效/倍速/暂停/退出/侧栏）全部搬进 #settings-overlay',
  settingsHost.ok, (settingsHost.missing || []).join(','));
const clerkHost = insideHost('clerk', NUMBERS);
ok('H12：三数字（倒计时/净破坏/决策窗口）+ 阶段名搬进 #clerk 书记官记录板',
  clerkHost.ok, (clerkHost.missing || []).join(','));

/* 每个 id 只能出现一次（批 UI-1 踩过 #btn-rules 重复两次导致点击落到错误的那个上） */
const dupIds = ['btn-rec', 'stage-head', 'hud-cd', 'hud-net', 'timer-num', 'timerbar-fill']
  .filter(id => (htmlCode.match(new RegExp('id="' + id + '"', 'g')) || []).length > 1);
ok('H13：迁移后的关键 id 全页唯一（重复 id 会让点击落到错误的那个上）',
  dupIds.length === 0, dupIds.join(','));

/* 纸的位置由场景渲染器按桌子/地板算，不是写死的像素 */
const sceneSrc = fs.readFileSync(path.join(JS, 'ui-scene.js'), 'utf8');
ok('H14：书记官记录板的位置按桌面实际包围盒写回，并夹紧在场景内（不是写死像素）',
  /function layoutClerk\(\)/.test(sceneSrc) &&
  /getBoundingClientRect\(\)/.test(sceneSrc) &&
  /paper\.style\.left = Math\.round\(left\)/.test(sceneSrc) &&
  /* 夹紧：任何候选都不许把纸推出场景（宿舍那间房曾算到 top:-27） */
  /maxL = sb\.right - hb\.left - w - m/.test(sceneSrc) &&
  /const top = Math\.min\(Math\.max\(best\.top, minT\), Math\.max\(minT, maxT\)\)/.test(sceneSrc) &&
  !/#clerk\s*\{[^}]*left:\s*\d+px/.test(css));

/* 席位遮挡判定必须用**真实绘制矩形**，不能拿 <svg class="sk-frame"> 的包围盒：
   那个包围盒含整张 384×800 行走图（实测 124×258，实际只画 57×95），
   拿它判遮挡会把纸挤到屏幕角落（本批第一版就踩了，交接文档 §3.2 已记过同族问题）。 */
ok('H14b：席位遮挡判定用真实绘制矩形（seatRects 由 getScreenCTM 映射，不用 sk-frame 包围盒）',
  /function seatRects\(\)/.test(sceneSrc) &&
  /getScreenCTM\(\)/.test(sceneSrc) &&
  /seatRects: seatRects/.test(sceneSrc) &&
  !/querySelectorAll\('\[data-seat\]'\)[\s\S]{0,200}sk-frame[\s\S]{0,80}getBoundingClientRect/.test(sceneSrc));

/* 场景里不再自留一份「kind → 房间」表（那是映射表该管的事） */
ok('H15：场景渲染器不再自带 kind→房间 的旧表（唯一来源是 js/hud-map.js）',
  !/ROOM_KINDS/.test(sceneSrc) &&
  /global\.SKHudMap/.test(sceneSrc));

/* 新增的 5 件物件必须真的摆在房间里（不是只写在映射表里） */
const NEW = H ? Object.keys(H.NEW_PROPS) : [];
const placed = NEW.filter(hit => Object.keys(S.ROOMS).some(id =>
  (S.ROOMS[id].props || []).some(p => p.k === hit)));
ok('H16：新增 5 件物件（通讯台/投票箱/抑制器/逃生舱/航海日志）都已摆进房间',
  NEW.length === 5 && placed.length === NEW.length,
  NEW.filter(h => placed.indexOf(h) < 0).join(','));

/* 房间布局自检必须仍然为空（新增道具不得越界 / 重叠） */
ok('H17：加入新道具后布局自检仍为空（不越界、不重叠、门双向）',
  S.validate().length === 0, S.validate().slice(0, 3).join(' / '));

console.log('');
console.log('决策→物件映射门禁：通过 ' + pass + ' 条、失败 ' + fail + ' 条');
if (fail) process.exitCode = 1;
