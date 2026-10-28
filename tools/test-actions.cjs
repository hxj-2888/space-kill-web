#!/usr/bin/env node
/* =============================================================
 * test-actions.cjs —— 动作映射表门禁（批 RTA-0 / R0 · 2026-10-28）
 * -------------------------------------------------------------
 * 这张表将来会被引擎、UI、AI 三方同时读取，所以它必须"自洽且可达"：
 *   ① kind 双向覆盖：引擎派发过的 kind 都要有动作；表里的 kind 都要还在引擎里；
 *   ② 场所真实：房间在 space.js 里、物件在该房间里真的存在（`any` 除外）；
 *   ③ 权能可解析：每个权能键都在 action-map 的 CAPS 里，且 src='grant' 的必须
 *      逐字出现在 roleDecl.grants 里（声明层是唯一真源）；
 *   ④ 反向覆盖：声明层 grants 里有、表里没有任何动作的键 ⇒ 判红（防"声明了点不出来"）；
 *   ⑤ 数值合法：时长/冷却/距离/结算/争夺域都在允许集合内；
 *   ⑥ 计数一致：生成产物与 md 行数一致，且 js/action-map.js 与 md 同步（防手改）。
 *
 * 为什么不用浏览器：这张表是纯数据，vm 沙盒足够；真正的"能不能点"由后续批次的
 * 浏览器读数（shots-*）负责 —— 这里只守"数据自洽"，不假装测了交互。
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadInto, makeCtx } = require('./load-order.cjs');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');
const MD = path.join(ROOT, 'docs', '动作映射表_实时行动_20261028.md');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' —— ' + detail : '')); }
}

/* ---- 载入被检查的两份数据 ---- */
const ctx = makeCtx({});
loadInto(ctx, JS, ['space', 'action-map']);
const A = ctx.SKActionMap;
const S = ctx.SKSpace;
const actions = (A && A.ACTIONS) || [];

/* ---- 引擎侧：kind 集合（从实现里抠，不手抄） ---- */
const engineSrc = ['engine/steps.js', 'engine.js']
  .map(f => fs.readFileSync(path.join(JS, f), 'utf8')).join('\n');
const engineKinds = new Set();
for (const m of engineSrc.matchAll(/kind:\s*'([A-Za-z][A-Za-z0-9]*)'/g)) engineKinds.add(m[1]);

/* ---- 声明层：grants 词表 ---- */
const declSrc = fs.readFileSync(path.join(JS, 'v66', 'declaration', 'roleDecl.js'), 'utf8');
const grants = new Set();
for (const m of declSrc.matchAll(/grants:\s*\[([^\]]*)\]/g)) {
  for (const t of m[1].split(',')) {
    const k = t.trim().replace(/'/g, '').trim();
    if (k) grants.add(k);
  }
}
/* ---- 声明层：charges 词表（额度的键名也是一类能力，例如 crew 的 assistRepair）---- */
const chargeKeys = new Set();
for (const m of declSrc.matchAll(/charges:\s*\{([^}]*)\}/g)) {
  for (const part of m[1].split(',')) {
    const k = part.split(':')[0].trim().replace(/'/g, '');
    if (k) chargeKeys.add(k);
  }
}

console.log('\n动作映射表门禁：');

/* ⓪ 基本存在性 */
ok('AC0：action-map 已加载且非空（46 条量级）',
  !!A && actions.length >= 40, '实有 ' + actions.length + ' 条');

/* ① kind 双向覆盖（`kind: '—'` = 引擎尚未实装，单独计数，不允许悄悄增多） */
{
  const PENDING_OK = ['save', 'poison'];   /* 濒死救援（本轮新增）/ 毒师（A6 pending） */
  const usedKinds = new Set(actions.filter(a => a.kind !== '—').map(a => a.kind));
  const pending = actions.filter(a => a.kind === '—').map(a => a.id);
  const missing = [...engineKinds].filter(k => !usedKinds.has(k));
  const unknown = [...usedKinds].filter(k => !engineKinds.has(k));
  const pendingOk = pending.length === PENDING_OK.length &&
    pending.every(id => PENDING_OK.some(p => id.indexOf(p) >= 0));
  ok('AC1：引擎派发过的 kind 全被覆盖，且表里的 kind 都还在引擎里（双向；kind=— 的未实装项单独计数）',
    missing.length === 0 && unknown.length === 0 && pendingOk,
    (missing.length ? '缺动作：' + missing.join(',') + ' ' : '')
    + (unknown.length ? '引擎无此 kind：' + unknown.join(',') + ' ' : '')
    + (pendingOk ? '' : '未实装项异常：' + pending.join(',')));
}

/* ② 场所真实 */
{
  const ids = S ? S.ids() : [];
  const bad = [];
  for (const a of actions) {
    const room = a.place.room;
    if (!room || room === 'any') continue;
    if (ids.indexOf(room) < 0) { bad.push(a.id + '→房间 ' + room + ' 不存在'); continue; }
    if (a.place.prop) {
      const r = S.room(room);
      const hit = r && (r.props || []).some(p => p.k === a.place.prop);
      if (!hit) bad.push(a.id + '→物件 ' + room + '/' + a.place.prop + ' 不存在');
    }
  }
  ok('AC2：每条动作的场所（房间 + 物件）在 space.js 里真实存在',
    bad.length === 0, bad.slice(0, 5).join(' ; '));
}

/* ③ 权能可解析 */
{
  const bad = [];
  for (const a of actions) {
    const src = A.CAPS[a.cap];
    if (!src) { bad.push(a.id + '→权能 ' + a.cap + ' 未在 CAPS 登记'); continue; }
    if (['grant', 'charge', 'mechanism', 'base'].indexOf(src) < 0) bad.push(a.id + '→来源非法 ' + src);
    if (src === 'grant' && !grants.has(a.cap)) bad.push(a.id + '→grant 键 ' + a.cap + ' 不在 roleDecl.grants');
    /* charge：声明层里以「额度键」形式声明（例：crew 的 assistRepair: Infinity）。 */
    if (src === 'charge' && !chargeKeys.has(a.cap)) bad.push(a.id + '→charge 键 ' + a.cap + ' 不在任何 roleDecl.charges');
  }
  ok('AC3：每条动作的权能键都能解析（grant 进 grants、charge 进 charges、其余登记为机制位/基础能力）',
    bad.length === 0, bad.slice(0, 5).join(' ; '));
}

/* ④ 反向覆盖：grants 有键但表里没动作 */
{
  const used = new Set(actions.map(a => a.cap));
  const orphan = [...grants].filter(g => !used.has(g));
  ok('AC4：声明层 grants 的每个键都有对应动作（防"声明了却点不出来"）',
    orphan.length === 0, '无动作：' + orphan.join(','));
}

/* ④-b 协助维修：声明层与动作表必须同时存在（缺一边就"点不出来"或"点了没人接"） */
{
  const hasAction = actions.some(a => a.cap === 'assistRepair');
  const declared = chargeKeys.has('assistRepair');
  ok('AC7：协助维修在两边都在位（声明层 charges.assistRepair + 动作表 crew.crewRepair）',
    declared && hasAction, '声明=' + declared + ' 动作=' + hasAction);
}

/* ⑤ 数值合法 */
{
  const DISTS = ['触', '房', '远', '视野内', '—'];
  const SETTLES = ['即', '进', '实时', '窗'];
  const CD_TYPES = ['none', 'sec', 'night', 'once'];
  const contests = new Set(actions.map(a => a.contest).filter(c => c && c !== '—'));
  const bad = [];
  for (const a of actions) {
    if (a.durMs != null && !(a.durMs > 0)) bad.push(a.id + ' 时长非法');
    if (CD_TYPES.indexOf(a.cd.type) < 0) bad.push(a.id + ' 冷却类型非法(' + a.cd.type + ')');
    if (DISTS.indexOf(a.dist) < 0) bad.push(a.id + ' 距离档非法(' + a.dist + ')');
    if (!SETTLES.some(s => String(a.settle).indexOf(s) >= 0)) bad.push(a.id + ' 结算方式未登记');
    if (a.contest && a.contest !== '—' && !contests.has(a.contest)) bad.push(a.id + ' 争夺域未定义');
  }
  ok('AC5：时长/冷却/距离/结算/争夺域全部落在允许集合内',
    bad.length === 0, bad.slice(0, 5).join(' ; '));
}

/* ⑥ 生成产物与 md 同步（防手改派生物） */
{
  /* 只数**14 列的动作行**：md 里还有争夺域/冷却组等表格，首列也常以反引号开头，
     用"单元格数 = 16"（首尾空 + 14 列）把它们排掉，避免把别的表也数进来。 */
  const mdRows = fs.readFileSync(MD, 'utf8').replace(/\r\n/g, '\n')
    .split('\n').filter(l => /^\|\s*`[a-z]/i.test(l) && l.split('|').length === 16).length;
  const same = fs.readFileSync(path.join(JS, 'action-map.js'), 'utf8').replace(/\r\n/g, '\n');
  const probe = require('child_process').spawnSync(process.execPath,
    [path.join(__dirname, 'gen-action-map.cjs'), '--check'], { encoding: 'utf8' });
  ok('AC6：js/action-map.js 与 md 行数一致且内容同步（生成器 --check 通过）',
    mdRows === actions.length && probe.status === 0,
    'md ' + mdRows + ' 行 / js ' + actions.length + ' 条；' + (probe.stdout || '').trim());
}

console.log('\n动作映射表门禁：通过 ' + pass + ' 条、失败 ' + fail + ' 条');
if (fail) process.exitCode = 1;
