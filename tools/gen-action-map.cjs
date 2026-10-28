#!/usr/bin/env node
/* =============================================================
 * gen-action-map · 由「动作映射表.md」生成 js/action-map.js（批 RTA-0 / R0 · 2026-10-28）
 * -------------------------------------------------------------
 * 为什么用生成器而不是手抄：
 *   这张表还在高频迭代（数值每轮都改），手抄两份必然漂移。
 *   约定：**md 是唯一可编辑源**，`js/action-map.js` 是派生物（文件头写明"勿手改"）。
 *
 * 用法：node tools/gen-action-map.cjs [--check]
 *   --check：只比对磁盘上的 js 与"现在生成的结果"是否一致（门禁用；不一致即红）
 *
 * 权能指纹（§一之二）：md 里那一列是中文说明，真正的**键**在下面的 CAP_OF 表里；
 *   CAPS 表登记每个键的来源（grant / mechanism / base），供 test-actions 校验。
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MD = path.join(ROOT, 'docs', '动作映射表_实时行动_20261028.md');
const OUT = path.join(ROOT, 'js', 'action-map.js');

/* ---- 动作 → 权能键（44+2 行逐条登记；新增动作必须在这里补一行，否则生成器报错）---- */
const CAP_OF = {
  'alien.knife': 'alien.kill',
  'alien.infect': 'alien.infect',
  'alien.destroy': 'alien.destroy',
  'alien.weave': 'alien.weave',
  'alien.convert': 'alien.convert',
  'xeno.kill': 'xeno.kill',
  'crew.shoot': 'shoot',
  'crew.guard': 'protect',
  'crew.safeRoom': 'safeRoom',
  'crew.takeAmmo': 'shoot',
  'crew.craftAmmo': 'craft',
  'doctor.medicine': 'brew',
  'doctor.surgery': 'treat',
  'doctor.revive': 'revive',
  'doctor.save': 'save',
  'poisoner.poison': 'poison',
  'doctor.suppress': 'vaccine',
  'doctor.clean': 'alien.clean',
  'crew.repair': 'repair',
  'crew.crewAction': 'crew.chore',
  'crew.crewRepair': 'assistRepair',
  'crew.extraRepair': 'extraRepair',
  'crew.escape': 'crew.escape',
  'detective.check': 'detective.check',
  'crew.info': 'crew.info',
  'xeno.check': 'xeno.check',
  'crew.patrol': 'sheriff.patrol',
  'crew.sniff': 'sniff',
  'crew.wiretap': 'wiretap',
  'xeno.silence': 'xeno.silence',
  'alien.ferry': 'ferry',
  'xeno.destroy': 'xeno.destroy',
  'alien.morph': 'morph',
  'alien.disguise': 'alien.disguise',
  'alien.transfer': 'transfer',
  'xeno.evolve': 'xeno.evolve',
  'xeno.cure': 'xeno.cure',
  'moon.awaken': 'convict.awaken',
  'moon.branch': 'convict.branch',
  'all.chat': 'base.chat',
  'all.talk': 'base.talk',
  'all.invite': 'base.chat',
  'all.inviteAccept': 'base.chat',
  'all.meeting': 'base.meeting',
  'all.vote': 'base.vote',
  'clerk.speech': 'base.speech',
  'all.will': 'base.will',
};

/* ---- 权能键来源：grant（roleDecl.grants 里逐字存在）/ mechanism（引擎按 kind 派发）/ base（人人共有）---- */
const CAPS = {
  /* grants 16 键里被本表用到的 14 个 */
  shoot: 'grant', craft: 'grant', brew: 'grant', treat: 'grant', revive: 'grant', save: 'grant',
  vaccine: 'grant', protect: 'grant', safeRoom: 'grant', repair: 'grant', extraRepair: 'grant',
  sniff: 'grant', wiretap: 'grant', morph: 'grant', transfer: 'grant', poison: 'grant',
  /* 非 grant：声明层没有 grants 条目，能力由引擎按 kind/步骤派发 */
  'alien.kill': 'mechanism', 'alien.infect': 'mechanism', 'alien.destroy': 'mechanism', 'alien.weave': 'mechanism',
  'alien.clean': 'mechanism', 'alien.disguise': 'mechanism', 'alien.convert': 'mechanism',
  'xeno.kill': 'mechanism', 'xeno.check': 'mechanism', 'xeno.destroy': 'mechanism',
  'xeno.evolve': 'mechanism', 'xeno.cure': 'mechanism', 'xeno.silence': 'mechanism',
  'detective.check': 'mechanism', 'sheriff.patrol': 'mechanism', ferry: 'mechanism',
  'crew.chore': 'mechanism', assistRepair: 'charge', 'crew.escape': 'mechanism', 'crew.info': 'mechanism',
  'convict.awaken': 'mechanism', 'convict.branch': 'mechanism',
  /* 人人共有 */
  'base.chat': 'base', 'base.talk': 'base', 'base.meeting': 'base', 'base.vote': 'base',
  'base.speech': 'base', 'base.will': 'base',
};

const DISTS = ['触', '房', '远', '视野内', '—'];
const SETTLES = ['即', '进', '实时', '窗'];

function strip(s) { return String(s == null ? '' : s).replace(/`/g, '').replace(/\*\*/g, '').trim(); }

function parseDur(s) {
  const m = strip(s).match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? Math.round(parseFloat(m[1]) * 1000) : null;
}

function parseCd(s) {
  const t = strip(s);
  if (!t || t === '0') return { type: 'none' };
  let m = t.match(/^夜×([0-9]+)(?:\((G[0-9]+)\))?/);
  if (m) return { type: 'night', n: parseInt(m[1], 10), group: m[2] || null };
  m = t.match(/全局\s*([0-9]+)\s*次/);
  if (m) return { type: 'once', n: parseInt(m[1], 10) };
  m = t.match(/^([0-9]+(?:\.[0-9]+)?)/);
  if (m) return { type: 'sec', v: parseFloat(m[1]) };
  return { type: 'text', raw: t };
}

/* 距离列在 md 里常带补充说明（"视野内（射程=视野）"）：归一成四档，原文另存 distText */
function parseDist(s) {
  const t = strip(s);
  const head = t.split('（')[0].trim();
  const known = ['触', '房', '远', '视野内'];
  for (const k of known) if (head.indexOf(k) === 0) return k;
  return '—';
}

function parsePlace(s) {
  let t = strip(s).split('（')[0].trim();
  if (t.indexOf('/') > 0) {
    const p = t.split('/');
    return { raw: strip(s), room: p[0].trim(), prop: p[1].trim() };
  }
  return { raw: strip(s), room: t === '任意' ? 'any' : (t || 'any'), prop: null };
}

function parseMd() {
  const src = fs.readFileSync(MD, 'utf8').replace(/\r\n/g, '\n');
  const rows = src.split('\n').filter(l => /^\|\s*`[a-z]/i.test(l));
  const out = [];
  for (const line of rows) {
    const c = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(strip);
    if (c.length < 14) continue;
    const id = c[0];
    const cap = CAP_OF[id];
    if (!cap) throw new Error('gen-action-map：动作 ' + id + ' 没有登记权能键（CAP_OF）');
    if (!CAPS[cap]) throw new Error('gen-action-map：权能键 ' + cap + ' 没有登记来源（CAPS）');
    out.push({
      id: id,
      kind: c[1],
      cap: cap,
      capText: c[2],
      place: parsePlace(c[3]),
      target: c[4],
      dist: parseDist(c[5]),
      distText: c[5],
      durMs: parseDur(c[6]),
      cd: parseCd(c[7]),
      cost: c[8],
      settle: c[9],
      counter: c[10],
      witness: c[11],
      contest: c[12],
      ai: c[13],
    });
  }
  return out;
}

function render(actions) {
  const body = actions.map(a => '    ' + JSON.stringify(a)).join(',\n');
  return `/* =============================================================
 * SKActionMap · 动作映射表（**派生物，勿手改**）（批 RTA-0 / R0 · 2026-10-28）
 * -------------------------------------------------------------
 * 源文件：docs/动作映射表_实时行动_20261028.md（改参数只改那里，再跑生成器）
 * 生成器：node tools/gen-action-map.cjs     校验：node tools/gen-action-map.cjs --check
 *
 * 职责：   把"谁能做什么、在哪里做、离多远、做多久、冷却多少、被谁看见、和谁抢"
 *          变成**可执行的数据**；引擎、UI、AI 都读它，不再各自散落硬编码。
 * 不变量： · 纯数据 + 纯函数：零 DOM、零状态、不读任何业务对象；
 *          · 每条动作的 kind 必须仍在旧引擎的 kind 集合里（过渡期兼容）；
 *          · 权能键只引用声明层（roleDecl.grants）或本文件登记的机制位/基础能力；
 *          · **本文件由生成器产出**：手改会在下一次生成时被覆盖，门禁也会判红。
 * 门禁：   tools/test-actions.cjs（kind 覆盖 / 场所真实 / 权能可解析 / 反向覆盖 / 数值合法 / 计数一致）
 * ============================================================= */
(function (global) {
  'use strict';

  /* 权能键来源（生成器与门禁共用同一份真源） */
  const CAPS = ${JSON.stringify(CAPS, null, 2).replace(/\n/g, '\n  ')};

  const ACTIONS = [
${body}
  ];

  const BY_ID = {};
  for (const a of ACTIONS) BY_ID[a.id] = a;

  function all() { return ACTIONS; }
  function get(id) { return BY_ID[id] || null; }
  function byKind(kind) { return ACTIONS.filter(a => a.kind === kind); }
  function byCap(cap) { return ACTIONS.filter(a => a.cap === cap); }
  /* 某角色能做哪些动作：角色 grants（声明层）+ 本表登记的机制位/基础能力 */
  function forCaps(caps) {
    const set = {};
    for (const c of (caps || [])) set[c] = 1;
    return ACTIONS.filter(a => set[a.cap]);
  }

  global.SKActionMap = {
    ACTIONS: ACTIONS, CAPS: CAPS,
    all: all, get: get, byKind: byKind, byCap: byCap, forCaps: forCaps,
  };
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

const actions = parseMd();
const text = render(actions);

if (process.argv[2] === '--check') {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== text) {
    console.log('✗ js/action-map.js 与 md 不同步（跑 node tools/gen-action-map.cjs 重新生成）');
    process.exitCode = 1;
  } else {
    console.log('✓ js/action-map.js 与 md 同步（' + actions.length + ' 条动作）');
  }
} else {
  fs.writeFileSync(OUT, text.replace(/\n/g, '\r\n'), 'utf8');
  console.log('已生成 js/action-map.js：' + actions.length + ' 条动作 / ' + Object.keys(CAPS).length + ' 个权能键');
}
