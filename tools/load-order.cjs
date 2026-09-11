/* =============================================================
 * 太空杀 · 源码加载清单（唯一真源）
 *
 * 背景：此前 20 个 js 文件的加载顺序在 7 处被各自硬编码
 *       （index.html + mc / sim / test-lang / test-fix-v26 / dbg / dbg1 / uismoke），
 *       任何一次拆分文件都要改 7 个地方，是模块化的第一道卡口。
 *       本文件把「顺序 + 分组」收敛为一份清单，浏览器标签由 tools/sync-html.cjs 生成。
 *
 * 用法：
 *   const { profiles, loadInto, makeCtx } = require('./load-order.cjs');
 *   const ctx = makeCtx({ RegExp });            // 沙盒上下文（可选注入额外全局）
 *   loadInto(ctx, base, profiles.full);          // 按清单顺序求值
 * ============================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* —— 有序清单：新增文件只改这一处 —— */
const ORDER = [
  'rng',
  'data',
  'state',
  'nlp',
  'lang/ir',
  'lang/renderer',
  'infer/speakable',
  'infer/tiers',
  'infer/registry',
  /* v33 模块化：跨域谓词 → 六个证据域模块 → 执行器（channels.run 只合并与执行） */
  'infer/predicates',
  'infer/modules/e1-destroy',
  'infer/modules/e2-infection',
  'infer/modules/e3-ballot',
  'infer/modules/e4-verify',
  'infer/modules/e11-network',
  'infer/modules/e56-protect',
  'infer/modules/e8-claims',
  'infer/modules/e10-aggregate',
  'infer/moe',
  'infer/channels.run',
  'corpus/tactics',
  'corpus/channels.data',
  'corpus/channels',
  'infer/pipeline',
  'infer/visible',
  'ai/util',
  'ai/belief',
  'ai/perceive',
  'ai/decide',
  'ai',
  'engine/announce',
  'engine/steps',
  'engine',
];

/* AI 层五件套（顺序敏感：util → belief → perceive → decide → 门面 ai）。
   decide 依赖 perceive（onClaim / grudgeLevel / phaseTag 三处），反向为零引用。 */
const AI_STACK = ['ai/util', 'ai/belief', 'ai/perceive', 'ai/decide', 'ai'];
/* 引擎层：投递原语（公开/私有分叉收口点）+ 步骤表工厂必须先于 engine.js */
const ENGINE_STACK = ['engine/announce', 'engine/steps', 'engine'];

/* UI 侧文件（浏览器与 uismoke 需要；纯 AI 工具不需要） */
const ORDER_UI = ['view', 'audio', 'ui', 'net', 'main'];

/* —— 常用剖面 —— */
const profiles = {
  /** 完整对局栈（AI + 引擎 + 结合层）：所有仿真/回归工具的默认值 */
  full: ORDER.slice(),
  /** 无结合层：Bridge 缺席时的退化栈（SK_NO_BRIDGE=1 对照）。
   *  注意：infer/tiers 必须在内——AI 层全程读 T.SCORE，缺它会在 reason() 首夜即崩
   *  （旧 dbg1.cjs 的清单就漏了 tiers，属改动前既有缺陷，本次一并修正）。 */
  noBridge: ['rng', 'data', 'state', 'nlp', 'infer/tiers', ...AI_STACK, ...ENGINE_STACK],
  /** 最小栈：调试脚本用（无 nlp / 无结合层） */
  minimal: ['rng', 'data', 'state', 'infer/tiers', ...AI_STACK, ...ENGINE_STACK],
  /** AI+引擎冒烟栈（含 nlp，无结合层）：调试脚本默认 */
  aiOnly: ['rng', 'data', 'state', 'nlp', 'infer/tiers', ...AI_STACK, ...ENGINE_STACK],
  /** 语言库 round-trip 只需这四个 */
  lang: ['data', 'nlp', 'lang/ir', 'lang/renderer'],
  /** 浏览器 / uismoke：完整栈 + UI */
  ui: ORDER.concat(ORDER_UI),
};

/** 与浏览器一致的沙盒上下文 */
function makeCtx(extra) {
  const ctx = {
    console, Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean,
    parseInt, parseFloat, isNaN, isFinite,
    ...(extra || {}),
  };
  ctx.globalThis = ctx;
  return ctx;
}

/** 按清单顺序把源码求值进上下文（require 语义的替代品） */
function loadInto(ctx, base, files) {
  vm.createContext(ctx);
  for (const f of files) {
    const file = f.endsWith('.js') ? f : f + '.js';
    vm.runInContext(fs.readFileSync(path.join(base, file), 'utf8'), ctx, { filename: file });
  }
  return ctx;
}

/** 生成 index.html 的 <script> 标签块（供 sync-html.cjs 使用） */
function browserTags(indent) {
  const pad = indent == null ? '  ' : indent;
  return profiles.ui.map(f => `${pad}<script src="js/${f}.js"></script>`).join('\n');
}

module.exports = { ORDER, ORDER_UI, profiles, makeCtx, loadInto, browserTags };
