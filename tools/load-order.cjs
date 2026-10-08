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

/* v66 声明层（纯数据 + 纯函数，必须先于 data.js：data 的 ROLES / HUMAN_BASE_ROLES /
   HUMAN_SETUP 由角色声明表派生，D1 单一真相源）。
   顺序：角色声明表 → 事件族契约（两者无相互依赖） */
const DECL_STACK = ['v66/declaration/traits', 'v66/declaration/roleDecl', 'v66/declaration/capabilityRegistry', 'v66/contract/eventFamily', 'v66/declaration/processRegistry', 'v66/execution/process', 'v66/derivation/actions', 'v66/derivation/mirror'];

/* —— 有序清单：新增文件只改这一处——
 *〔v7 B0 · 2026-10-08〕推理引擎拆除：infer/{registry,predicates,moe,channels.run,visible}、
 *   infer/modules/e1~e11、corpus/{channels.data,channels.retired,channels} 共 16 项已移入
 *   _retired/ 归档（可追溯，见 git branch v7-pre-teardown @709acd7），并自本清单摘除。
 *   依据：通道库三档消融边际贡献 +0.002（full 0.500 vs off 0.498，top1 反升）；
 *        dangerOf AUC 0.4999 / 全量负向 0.3378 —— 评分制无可保留成果。
 *   注意：引擎侧 10 处 absorbPrivate 调用点与 AI 层对 MoE 的 50 处引用属 B1+ 改造对象，
 *        本批只归档与摘除加载，不改逻辑。 */
const ORDER = [
  'rng',
  ...DECL_STACK,
  'data',
  'state',
  'nlp',
  'lang/ir',
  'lang/renderer',
  'lang/announceIR',   /* P1-a 公告 IR：系统公告的结构化节点与确定性渲染（引擎调用点构造节点） */
  'lang/taboo',        /* P1-b 禁语规则引擎：4.10.6／2.8.12④／4.7.1 三条硬约束的叙事层校验 */
  'lang/narrator',     /* N1 复盘叙事：终局编年史（终局后才运行，引擎零消费——故不进 ENGINE_STACK） */
  'infer/speakable',
  'infer/tiers',
  /* v33 模块化：跨域谓词 → 六个证据域模块 → 执行器（channels.run 只合并与执行） */
  'corpus/tactics',
  'corpus/voice',      /* 〔批次 35〕定制发言语气层（θ 档开场/口头禅/私聊开场；decide.speak 出口调用） */
    'infer/pipeline',
    'infer/visible',   /* 〔v7 B0 回退〕可见性过滤（防透视投递侧唯一实现）：
                        view.js:101/123 与 ui.js:655 的 SKVisible.canSee 来源。
                        它是**防透视层**而非通道机制，B0 误归档，已回退。 */
  'ai/visibility',      /* 〔v7 2026-10-08〕可见性闸门：AI 与真人同角色时可见性统一。
                          判据真源 = view.js sanitize（仓库唯一视图构建器）；
                          view 未加载时降级为「只可见自己」（保守方向）。
                          必须最先：belief/perceive/decide 都要问它。 */
  'ai/util',
  'ai/memory',          /* 拟人层 A：长期记忆（跨夜归并的印象；decide/perceive 于读时取用） */
  'ai/cloud',          /* v4.0 批次 17a：粒子云（与旧 belief 并存，17a 零接线；依赖 tiers 的 PRIOR_E） */
  'ai/belief',
  'ai/perceive',
  'ai/voice',
          /* 〔v7〕角色心声与发言层：按 roleDecl.duty.senses 取材、按 duty.cost 留一手。
             必须先于 ai/decide（decide.speak 读 AIVoice.thought）；只依赖声明层与 state。 */
  'ai/decide',
  'ai',
  /* v66 声明层：事件族契约（G1，纯数据）与角色声明表已在 DECL_STACK 中前置加载；
     B5 揭示统一服务（运行期调用，加载序只要求先于首局） */
  'v66/reveal/revealService',
  'engine/announce',
  'engine/steps',
  'engine',
];

/* AI 层清单（顺序敏感：visibility → util → memory → cloud → belief → perceive → voice → decide → 门面 ai）。
   decide 依赖 perceive（onClaim / grudgeLevel / phaseTag 三处），反向为零引用。
   ai/visibility 排最前：它是**可见性闸门**，belief/perceive/decide 都要问它
   （2026-10-08 裁定「AI 与真人同角色时可见性统一」）。它自身在运行时取 global.View，
   故不要求 view.js 在它之前 —— view 未加载时它降级为「只可见自己」（保守方向）。
   ⚠ 本清单必须与 ORDER 里的 ai/* 段**逐项同序**（§七.5：两处必须一致）。
     2026-10-08 实测漂移过：ORDER 有 ai/cloud 而本清单漏了它 ⇒ noBridge/minimal/aiOnly
     三个剖面拿不到 SKCloud。现由 tools/load-order 自检拦住。 */
const AI_STACK = ['ai/visibility', 'ai/util', 'ai/memory', 'ai/cloud', 'ai/belief', 'ai/perceive', 'ai/voice', 'ai/decide', 'ai'];
/* AI 栈顺序说明：memory 无相互依赖，置于最前以便 decide/perceive 于读时取用（记忆是它们的输入）。 */
/* 引擎层：B5 揭示服务 + 投递原语（公开/私有分叉收口点）+ 步骤表工厂必须先于 engine.js。
   注意：这里必须写完整模块路径 'v66/reveal/revealService'——曾误写为目录名 'v66/reveal'，
   导致 noBridge/minimal/aiOnly 三个剖面尝试加载不存在的 js/v66/reveal.js 而 ENOENT
   整体失败（SK_NO_BRIDGE=1 同种子对照臂、dbg/dbg1 调试脚本全部不可用）。 */
const ENGINE_STACK = ['v66/reveal/revealService', 'lang/announceIR', 'engine/announce', 'engine/steps', 'engine'];

/* UI 侧文件（浏览器与 uismoke 需要；纯 AI 工具不需要） */
const ORDER_UI = ['view', 'audio', 'ui', 'net', 'main'];

/* —— 常用剖面 —— */
const profiles = {
  /** 完整对局栈（AI + 引擎 + 结合层）：所有仿真/回归工具的默认值 */
  full: ORDER.slice(),
  /** 无结合层：Bridge 缺席时的退化栈（SK_NO_BRIDGE=1 对照）。
   *  注意：infer/tiers 必须在内——AI 层全程读 T.SCORE，缺它会在 reason() 首夜即崩
   *  （此缺陷最早由已删除的临时调试脚本 dbg1.cjs 暴露，属改动前既有缺陷，本批修正）。 */
  noBridge: ['rng', ...DECL_STACK, 'data', 'state', 'nlp', 'infer/tiers', ...AI_STACK, ...ENGINE_STACK],
  /** 最小栈：调试脚本用（无 nlp / 无结合层） */
  minimal: ['rng', ...DECL_STACK, 'data', 'state', 'infer/tiers', ...AI_STACK, ...ENGINE_STACK],
  /** AI+引擎冒烟栈（含 nlp，无结合层）：调试脚本默认 */
  aiOnly: ['rng', ...DECL_STACK, 'data', 'state', 'nlp', 'infer/tiers', ...AI_STACK, ...ENGINE_STACK],
  /** 语言库 round-trip 只需这些（声明层随 data 一同加载；rng 供 render 的确定性变体生成） */
  lang: ['rng', ...DECL_STACK, 'data', 'nlp', 'lang/ir', 'lang/renderer', 'lang/announceIR', 'lang/taboo', 'lang/narrator'],
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

/* 导出 AI_STACK：加载序自检要核对「index.html 的标签顺序」与本清单一致
   （§七.5：改加载链必须核对标签都在 + 顺序正确 + 标签数未减少）。 */
module.exports = { ORDER, ORDER_UI, AI_STACK, profiles, makeCtx, loadInto, browserTags };
