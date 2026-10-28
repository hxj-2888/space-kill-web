/* =============================================================
 * gate-src · 门禁源码解析（批 ART-0 · 2026-10-28）
 * -------------------------------------------------------------
 * 为什么需要它：
 *   `test-ship.cjs` / `test-space.cjs` 的判据原先全部写死"读 js/ui-scene.js"。
 *   于是 **一动文件，20+ 条断言同时失去对象**（不是变红，是判到空串上）——
 *   这是本仓模块化的第一道卡口，必须先在门禁侧解决。
 *
 * 现在门禁按**逻辑模块名**取源码；模块拆分时只改下面的 MODULES 表，断言一个字不用动。
 *
 * 用法：
 *   const { srcOf, rawOf, bodyOf, cssAll } = require('./gate-src.cjs');
 *   const shell = srcOf('scene.shell');          // 已剥注释
 *   bodyOf(shell, 'function roomHtml(S)');
 *
 * 规矩（与 AGENTS 红线 11 一致）：
 *   · 一个逻辑模块可以对应**多个物理文件**（拆分过渡期两边都在），按数组顺序拼接；
 *   · `srcOf` 一律剥注释 —— 注释里会写"不再用 xxx"，那是声明不是实现；
 *   · 模块名不存在时**直接抛错**，不许静默返回空串（空串会让断言"判到空气上还绿"）。
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* 逻辑模块 → 物理文件（**唯一真源**；拆分/搬家只改这张表） */
const MODULES = {
  /* 场景渲染层：**逻辑模块可以跨多个物理文件**。
     过渡期把拆出去的文件按加载顺序追加进数组即可 —— 这是"拆文件不用改断言"的关键：
     `bodyOf(src, 'function setCrewFrame(...)')` 在拼接后的源码里照样找得到。 */
  scene: ['js/ui-scene.js', 'js/scene/crew.js', 'js/scene/shell.js'],
  /* 已拆出的子模块（单独断言某个文件本身时用） */
  'scene.const': ['js/scene/const.js'],
  'scene.crew': ['js/scene/crew.js'],
  'scene.shell': ['js/scene/shell.js'],
  /* 交互/视图层 */
  ui: ['js/ui.js'],
  arena: ['js/arena.js'],
  /* 数据层 */
  space: ['js/space.js'],
  ship: ['js/ship-map.js'],
  hudmap: ['js/hud-map.js'],
};

function abs(rel) { return path.join(ROOT, rel); }

function stripComments(s) {
  return String(s).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

/* 原样源码（含注释）：文件缺失即抛错 */
function rawOf(name) {
  const files = MODULES[name];
  if (!files || !files.length) throw new Error('gate-src：未登记的模块 "' + name + '"');
  return files.map(function (rel) {
    const p = abs(rel);
    if (!fs.existsSync(p)) throw new Error('gate-src：模块 "' + name + '" 的文件不存在 → ' + rel);
    return fs.readFileSync(p, 'utf8');
  }).join('\n');
}

/* 剥注释后的源码（门禁判据一律用它） */
function srcOf(name) { return stripComments(rawOf(name)); }

/* 全站 CSS 合并（与拆分前同口径） */
function cssAll() {
  return fs.readdirSync(abs('css')).filter(function (f) { return /\.css$/.test(f); })
    .map(function (f) { return fs.readFileSync(abs('css/' + f), 'utf8'); }).join('\n');
}

/* 抠函数体：从 signature 起按大括号配平截出整个函数；找不到返回空串
   （调用方一律 `!!body && ...`，缺函数即判红，不会静默通过） */
function bodyOf(src, signature) {
  const i = src.indexOf(signature);
  if (i < 0) return '';
  const b = src.indexOf('{', i);
  if (b < 0) return '';
  let depth = 0;
  for (let k = b; k < src.length; k++) {
    const c = src[k];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(b, k + 1); }
  }
  return '';
}

/* 有向子序列判定：seq 里的片段必须**按顺序**出现（比单 token 强，抗"同一 token 在别处还有"） */
function hasSeq(body, seq) {
  let i = 0;
  for (let k = 0; k < seq.length; k++) {
    const at = body.indexOf(seq[k], i);
    if (at < 0) return false;
    i = at + seq[k].length;
  }
  return true;
}

module.exports = { ROOT, MODULES, rawOf, srcOf, cssAll, bodyOf, hasSeq, stripComments };
