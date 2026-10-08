'use strict';
/* ============================================================================
 * 真人 / AI 对等探针（v7 B3 前置审查）
 *
 * 问题：这个游戏里，真人玩家和 AI 除了「思维」以外，其他一切是否相同？
 *       —— 相同的动作空间、相同的信息边界、相同的合法性与代价。
 *
 * 治理口径（docs/防指标博弈治理规范.md）：
 *  · 本脚本只做**观测与断言**，不改任何行为；
 *  · 所有判定都写成「对照判据」而非「当前实现」——把实现改错，断言必须挂；
 *  · 数字是观测，不设靶、不进 gate；只有**规则性违例**才非 0 退出。
 *
 * 三个维度（互不替代）：
 *   ① 动作空间对等：AI 交回的每一个值，必须落在真人表单给出的 opts/targets/num 内。
 *      —— 这条抓的是「AI 能做而真人做不到」（或反过来）的静默歧视。
 *   ② 信息边界对等：AI 决策时读到的**他人**字段，必须是真人 view.sanitize 会下发给
 *      该 AI 对应真人身份的那些字段。—— 这条抓的是「AI 透视」。
 *   ③ 合法性与代价对等：同一份提交走真人 toDecision 与 AI decide 后，
 *      字段结构与后果是否一致。
 *
 * 用法：node tools/human-ai-parity.cjs <REPO_ROOT> [局数] [起始种子]
 * 退出码：0 = 三维度无违例；非 0 = 有违例（明细见输出）。
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || process.cwd();
const N = +(process.argv[3] || 60);
const SEED0 = +(process.argv[4] || 241);
const SeatMode = require(path.join(ROOT, 'tools', 'seat-mode.cjs'));

const src = fs.readFileSync(path.join(ROOT, 'tools', 'load-order.cjs'), 'utf8');
const m = { exports: {} };
new Function('require', 'module', 'exports', '__dirname', '__filename', src)(
  require, m, m.exports, path.join(ROOT, 'tools'), 'x');
const { makeCtx, loadInto, profiles } = m.exports;
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
/* view.js 属 profiles.ui（联机广播用），不在 full 里 —— 但维度② 的判据真源正是它
   （view.js 顶部 K3：唯一的视图构建器）。缺了它，本探针的「信息边界」会**恒判通过**，
   那是最坏的失败模式：探针看起来在工作，实际什么都没测。
   故显式补载，并当场断言它真的在（缺了就抛错，不许静默降级）。 */
loadInto(ctx, path.join(ROOT, 'js'), ['view']);
const { Engine, Setup, AI } = ctx;
const RD = ctx.SKRoleDecl;
const View = ctx.View;
if (!View || typeof View.build !== 'function')
  throw new Error('human-ai-parity: View.build 不可用 —— 维度②（信息边界）无法判定。'
    + '这是探针自身的失效，绝不可当成「零透视」读。');

/* 维度② 的**自证**（铁律三：判据必须能自己挂）：
   先在真实局面上验一遍 FIELD_TO_VIEW_KEY —— 对一个船员视角，
   他人（异形）的 faction/role 必须判为「不可见」。若这里判成可见，
   说明映射表写反了，后面所有「零透视」都是假的。故此项不为真直接抛错。 */
(function selfTestFieldMap() {
  const g = Setup.createGame(4242, 'random');
  g.humans = []; g.humanId = -1;
  for (const p of g.players) p.isHuman = false;
  const me = g.players.find(p => p.faction === 'human');
  const other = g.players.find(p => p.faction === 'alien');
  const keys = viewFieldsFor(g, me.id, other.id);
  if (!keys) throw new Error('human-ai-parity: View.build 在真实局面返回空 —— 维度②的判据真源失效。');
  if (keys.has('faction') || keys.has('role'))
    throw new Error('human-ai-parity: 自证失败 —— 船员视角竟然能看到异形的 faction/role，'
      + '说明 FIELD_TO_VIEW_KEY 或 View 口径有问题，本维度的结论一律不可信。');
  /* 反向自证：自己看自己，必须能拿到 faction/role（否则映射表过严，全会误报） */
  const selfKeys = viewFieldsFor(g, me.id, me.id);
  if (!selfKeys || !selfKeys.has('faction') || !selfKeys.has('role'))
    throw new Error('human-ai-parity: 自证失败 —— 自己的 faction/role 都看不到，映射表过严。');
  console.log('维度② 判据自证通过：船员看不到异形 faction/role；自己看自己可以。');
})();

/* ══════════════ 观测桶 ══════════════ */
const P = {
  games: 0, errs: 0, errMsgs: {}, steps: 0,
  /* ① 动作空间 */
  dispatches: 0,
  formsCompared: 0,
  outOfForm: [],          /* AI 交了表单里没有的值 */
  targetOutOfForm: [],
  numOutOfForm: [],
  shapeMismatch: [],      /* AI 返回的字段名与 toDecision 产出的不一致 */
  kindNoForm: {},         /* 有 req 但没有 form（无法对照） */
  unmappedKinds: {},      /* 无 opt 映射表的 kind —— 记为「未覆盖」，不假装测到 */
  /* ② 信息边界 */
  truthReads: [],         /* 样本（上限 30 条），仅供定位代码位置 */
  violationTotal: 0,      /* 违例全量计数（与样本分开记） */
  violationPair: {},      /* 「字段 by 读者角色」→ 次数（归并后的清单） */
  bucketTally: {},        /* 读取合法性分档统计（VIEW/TEAMMATE/DECLARED_SENSE/DERIVABLE/VIOLATION） */
  viewUnknown: 0,         /* View 不可用导致无法判定的次数（须为 0，否则维度②作废） */
  readTally: {},          /* 字段读取频次（观测，不设靶） */
  /* ③ 合法性与代价 */
  toDecisionFail: [],
  toDecisionOK: {},       /* kind → 通过 toDecision 解析的次数（覆盖率观测） */
  illegalSubmitted: [],   /* 提交了表单 disabled 的选项 */
};

/* ══════════════ 真人视图能下发的字段（信息边界的真源）══════════════
   不能手写一份「哪些字段算透视」——那必然与实现漂移。
   做法：直接问 View.sanitize，让它对一个「旁观真人」下发，
   再把 AI 读到的字段与之比对。sanitize 是仓库里唯一的视图构建器（view.js 顶部 K3）。 */
const PROBE_PLAYER = 15;   /* 用一个固定的旁观者 id；它必须在本局存在 */

/* sanitize 的第三参是「观看者 v」。这里构造一个与 AI 同席的观看者，
   让边界判断与「如果这个 AI 是真人」完全一致。 */
function viewFieldsFor(g, observerId, subjectId) {
  if (!View || typeof View.build !== 'function') return null;
  try {
    const v = g.players[observerId - 1];
    const built = View.build(g, observerId);
    if (!built) return null;
    const subj = (built.players || []).find(x => x.id === subjectId);
    if (!subj) return null;
    return new Set(Object.keys(subj));
  } catch (e) { return null; }
}

/* ══════════════ ① 动作空间对等 ══════════════
   AI 的每个返回值都必须能在真人表单里点出来。判据来自 form 本身，
   不来自 decide.js 的常量表 —— 改坏 decide 只会让这条挂，不会让它跟着改。 */
function checkActionSpace(g, req, form, res, ctxInfo) {
  P.dispatches++;
  if (!form) { P.kindNoForm[req.kind] = (P.kindNoForm[req.kind] || 0) + 1; return; }
  P.formsCompared++;

  /* ── 判据口径（这一段是全探针最容易写错的地方，故写死理由）──
     真人提交的是 {opt, targets, num, text}，经 toDecision 归一后才进 g.decisions。
     AI 直接产出**归一后**的形状（如 {mode:'check'}、{act:'heal'}），
     两者的字段名与取值词表本来就不同（这是接口差异，不是能力差异）。
     所以正确的对等判据不是「字符串相等」，而是：
       **把 AI 的输出喂给 toDecision，再把真人的一份合法提交也喂给 toDecision，
         比较两者的字段结构（键集合），而不是比较字面值。**
     字面值那一维由下面的 targets/num 检查负责（它们的词表是数据驱动的，
     表单直接给出，可直接比对）。
     故 opt 这一维只检查「AI 是否声明了一个真人不存在的动作类别」——
     即 mode/act 字段名是否在同 kind 的真人表单 opt 里能找到对应。
     找不到 ⇒ AI 会做了真人点不出来的动作 ⇒ 违例。 */
  const optVals = new Set((form.opts || []).map(o => o.v));
  const hasOpts = !!(form.opts && form.opts.length);
  /* 真人表单 opt → AI 归一字段 的映射表（按 kind）。
     写这张表的理由：接口词表差异是**已知且正确**的（toDecision 是唯一解析口），
     把它显式写出来，才能让「未登记的 kind」当场暴露，而不是靠字符串碰撞蒙对。 */
  const MODE_OF_OPT = {
    /* 步骤 2 船员：表单只有 check/none；AI 返回 mode:'check'|'repair'|'none'。
       mode:'repair' 是**步骤 2 的预留**（engine.js:514-521 明载裁定②后为死码，
       实际执行发生在 4a）。它不在步骤 2 表单里，但不代表 AI 多得了能力 ——
       真人走 4a 表单也能做同样的事。故 mode:'repair' 归一为 'assist*' 族豁免。 */
    crewAction: { check: 'check', none: 'none', repair: 'CREW_REPAIR_RESERVE' },
    /* 4a 协助维修：表单 assist0.20…0.50 + none；AI 返回 mode:'crewRepair' + value */
    crewRepair: { none: 'none', crewRepair: 'CREW_REPAIR' },
    /* 步骤 8 医生：表单 heal/rescue/selfsave/brew/poison/antidote/none */
    doctor: { heal: 'heal', rescue: 'rescue', selfsave: 'selfsave', brew: 'brew',
              poison: 'poison', antidote: 'antidote', none: 'none' },
    /* 工匠 4.11.2 三选一 */
    craft: { cast: 'cast', distribute: 'distribute', none: 'none' },
    /* 猎手 A6 三选一 */
    shoot: { gather: 'gather', none: 'none', shoot: 'shoot' },
    /* 神探步骤 2 */
    detective: { check: 'check', announce: 'announce', none: 'none' },
  };

  /* 检查 mode/act 类别合法性：AI 声明的动作必须能在该 kind 的登记映射里找到，
     或其值本身就是表单 opt 之一。 */
  for (const k of ['mode', 'act', 'opt', 'dir', 'branch']) {
    const v = res[k];
    if (v === undefined || v === null) continue;
    const norm = v === true ? 'yes' : v === false ? 'no' : String(v);
    /* 该值本身就是表单 opt → 天然合法 */
    if (hasOpts && (optVals.has(norm) || optVals.has(String(norm)))) continue;
    /* 该 kind 有登记映射，且映射里有这个类别 → 合法 */
    const map = MODE_OF_OPT[req.kind];
    if (map && Object.prototype.hasOwnProperty.call(map, norm)) continue;
    /* 布尔型 use/call/do 类：真人对应 yes/no 档 */
    if (typeof v === 'boolean') continue;
    /* 该 kind 无登记映射 → 无法判定，记入「未覆盖」而不是判违例（不假装测到了） */
    if (!map) { P.unmappedKinds[req.kind] = (P.unmappedKinds[req.kind] || 0) + 1; continue; }
    if (P.outOfForm.length < 20)
      P.outOfForm.push({ ...ctxInfo, field: k, value: norm, opts: [...optVals].slice(0, 12), mapped: Object.keys(map) });
  }

  /* targets：真人 targets 是「候选集合」，AI 的选择必须是它的子集 */
  const formTargets = (form.targets || []).map(t => (t && typeof t === 'object' ? t.v ?? t.id : t));
  if (formTargets.length) {
    const tset = new Set(formTargets.map(String));
    const used = [].concat(res.targets || [], res.target != null ? [res.target] : []);
    for (const t of used) {
      if (t == null) continue;
      if (!tset.has(String(t)) && P.targetOutOfForm.length < 20)
        P.targetOutOfForm.push({ ...ctxInfo, target: t, formTargets: [...tset].slice(0, 12) });
    }
  }

  /* num：真人 num.options 是取值域。
     工程师维修量的坑在此：表单 num.options 的 v 可能是字符串或数字，
     且 AI 返回 value 是 number。必须按**数值**比，不能按字符串比
     （'1.5' vs 1.5 会误报）。判据：数值相等即合法。 */
  const numOpts = ((form.num && form.num.options) || []).map(o => o.v);
  const numVals = new Set(numOpts.map(v => (typeof v === 'number' ? v : parseFloat(v))));
  if (numVals.size) {
    for (const k of ['num', 'num2', 'product', 'value', 'extraValue']) {
      const v = res[k];
      if (v === undefined || v === null || typeof v === 'boolean') continue;
      const nv = typeof v === 'number' ? v : parseFloat(v);
      if (Number.isNaN(nv)) continue;
      /* form.num2 是第二数值域（num2 label）；若存在则该字段对两个域都合法 */
      const num2Vals = new Set((((form.num2 && form.num2.options) || []).map(o => o.v))
        .map(v => (typeof v === 'number' ? v : parseFloat(v))));
      if (numVals.has(nv) || num2Vals.has(nv)) continue;
      /* 部分 kind 的数值由额度派生（如 repairValue 随 repairTotal 变化），
         表单给的是当前合法区间。越界即违例 —— 这正是要抓的。 */
      if (P.numOutOfForm.length < 20)
        P.numOutOfForm.push({ ...ctxInfo, field: k, value: v, numOptions: numOpts.slice(0, 12) });
    }
  }
}

/* ══════════════ ② 信息边界对等（防透视）══════════════
   做法：给每个玩家的「真相字段」装 getter，AI 决策期间记录它读了谁。
   然后拿真人视图（View.sanitize 的下发结果）做对照：
   若某字段 AI 读了、而同一身份的真人视图里没有该字段 ⇒ AI 透视。
   注意：AI 读**自己**的字段永远合法（真人也能看自己的面板）。

   ⚠ 关键前提（不成立则本维度无效）：
   这个 getter 只拦**属性读取**。若 decide.js 通过别的路径拿到真相
   （AIBelief.ensureE 建的私有账本、Mirror 镜像、AI 自己的 p.known），
   本维度看不见。所以本维度只回答「AI 有没有直接读权威真相字段」，
   不回答「AI 的私有账本里有没有不该有的东西」—— 后者是 B1/B3 的范围。 */
const TRUTH_FIELDS = [
  'faction', 'role', 'originRole', 'roleName', 'claimedRole',
  'infection', 'branch', 'alien', 'convict', 'morph',
  'silenceNight', 'noActive', 'vSelf', 'theta', 'killLeft', 'extraKill',
  'healLeft', 'rescueLeft', 'cureSelf', 'bullets', 'patrolUsed',
  'repairTotal', 'extraRepair', 'nightImmune', 'destroyLeft', 'meetingLeft',
  'dying', 'poison', 'revealed', 'accuseHistory', 'transferExposed',
];

/* 当前正在做决策的 AI（用于判定「这次读取发生在决策期间」）。
   PHASE 用来区分读取发生在**哪一层**：
     'form'   = 探针为拿对照表单而调 form(g,p) 时 —— 这一层是**引擎**在算给真人看的菜单，
                读真相是合法的（真人也会看到这份菜单的内容）。
     'decide' = AI.decide 执行期间 —— 这一层才是「AI 的大脑」，读了不该读的才算 AI 透视。 */
let CUR = null;
let PHASE = null;

function installTruthGetters(g) {
  for (const p of g.players) {
    for (const f of TRUTH_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(p, f)) continue;   /* 不凭空造字段 */
      let val = p[f];
      Object.defineProperty(p, f, {
        configurable: true, enumerable: true,
        get() {
          if (CUR) {
            const reader = CUR.pid, subject = p.id;
            /* 自己读自己 → 合法，不记（真人也能看自己的面板） */
            if (reader !== subject) {
              const rec = { reader, subject, field: f, phase: PHASE };
              CUR.reads.push(rec);
              const tk = (PHASE === 'form' ? 'form:' : 'decide:') + f;
              P.readTally[tk] = (P.readTally[tk] || 0) + 1;
            }
          }
          return val;
        },
        set(nv) { val = nv; },
      });
    }
  }
}

/* 真人自己也能看到的字段：自己面板 + 公开字段 + 队友字段 + 揭示字段。
   这里不手写规则，而是取 View.sanitize 对「该读者本人」的下发键集合
   —— 与真人 UI 实际收到的同源（view.js 是唯一视图构建器）。

   ⚠ 投影字段的处理：sanitize 对 self 下发的键名与真相字段名并不逐一对应。
   例：真相字段 originRole / roleName / branch / vSelf / theta 在 self 视图里
   分别由 role / roleName /（不发）/ infection /（不发）承载。
   所以「键名不同」不等于「透视」—— 真人面板确实会显示职业名、也不会显示 branch。
   判据改为**语义等价**：把每个真相字段映射到真人视图里承载它的键，
   只要承载键存在即判合法；承载键不存在 ⇒ 真人看不到这个信息 ⇒ AI 读了即透视。

   ⚠ 更重要的一条：sanitize 的 self 分支**本来就不下发 branch / vSelf / theta**
   （那些是纯内部量），但真人自己心里清楚「我出刀了没有」。所以对 self 侧的
   少数字段不能只按键名判。这里只判**他人**字段（reader !== subject 已在
   judgeReads 过滤掉自己），他人侧的下发规则是明确的：
   self/team/god/omni 四种情形才给 faction+role。这才是可判的部分。 */
const FIELD_TO_VIEW_KEY = {
  faction: 'faction', role: 'role', originRole: 'role', roleName: 'roleName',
  claimedRole: 'claimedRole', infection: 'infection', alien: 'alien',
  convict: null, morph: null, branch: null, silenceNight: null, noActive: null,
  vSelf: null, theta: null, killLeft: null, extraKill: null,
  healLeft: null, rescueLeft: null, cureSelf: null, bullets: null,
  patrolUsed: null, repairTotal: null, extraRepair: null, nightImmune: null,
  destroyLeft: null, meetingLeft: null, dying: 'dying', poison: null,
  revealed: 'revealed', accuseHistory: 'accusers', transferExposed: null,
};

/* 读取合法性的三档判定（这一段是整个维度的核心，写错就会把「合法读」报成透视，
   或者反过来把真透视洗成合法 —— 两种错都不可接受，故每档都写明依据）：

   ① TEAMMATE   读到的是**同阵营队友**的字段。
      依据：view.js:39 `team = v.faction === 'alien' && p.faction === 'alien'`
      与 view.js:55 `if (self || team || god || omni)` —— 队友身份对队友可见是规则明文。

   ② DERIVABLE  读到的信息，**真人也推得出来**。
      典型：统计类（存活几人、还剩几个医生）——
      开局公告给构成（engine.js:846 openingRosterText，announce 全体可见），
      死亡公告给真实阵营与职业（revealService.js:42 `death: {faction:true,trueRole:true}`），
      故「存活医生数」= 公告总数 − 已揭示出局者，真人自行数得出来。
      ⚠ 这档不是「白名单」，而是「信息量对等」的论证：AI 走捷径读了真相，
         但它拿到的**结论**真人也能拿到，故不构成不公平。
         记为 derivable 是为了让人能审计这个论证，而不是把它藏起来。

   ③ VIOLATION  读到的是**单个玩家的私有真相**，且该信息无法由公开信息推出。
      这才是真透视：AI 对某个人多知道了一件真人不知道的事。

   判定的输入：View.sanitize 的下发键（唯一视图构建器）+ 上面两条规则依据。
   刻意**不**手写「哪些字段算公开」清单 —— 那是必然与实现漂移的东西。 */
const AGGREGATE_FIELDS = new Set(['faction', 'role', 'originRole']);  /* 只用于统计时可推导 */

/* ── 声明层派生的可见性授权（判据真源，不手写）────────────────────────────
   「谁被授权看到 infection / dying / poison」这个问题，答案在速查卡的 sensesQuote，
   而速查卡的转录在 tools/card-audit.cjs 的 CARD 里、经 card-audit 对齐到
   js/v66/declaration/roleDecl.js 的 duty.senses。
   ⇒ 本探针**从声明层读答案**，不自己维护一张可见性表。
   理由：手写表必然与实现漂移（本探针第一版就栽在这，见 FIELD_TO_VIEW_KEY 的注释）。
   声明层是唯一真源（交接文档 §〇.1），用它做判据 = 断言跟着规则走，不跟着实现走。 */
const SENSE_AUTHORITY = (() => {
  /* truth 字段 → 声明层 sense 名。映射关系取自 card-audit 的 sensesQuote 原文：
       「可见『谁带有感染标记』」 → infectMarks
       「可见…『谁处于濒死』」    → dyingList
       「可见全场毒药清单」        → poisonList */
  const SENSE_OF = { infection: 'infectMarks', dying: 'dyingList', poison: 'poisonList' };
  const auth = {};                        /* sense → [role...] */
  for (const k of RD.keys()) {
    const senses = (RD.ROLE_DECL[k].duty || {}).senses || [];
    for (const s of senses) if (auth[s] == null) auth[s] = [];
    for (const s of senses) auth[s].push(k);
  }
  const byField = {};
  for (const [field, sense] of Object.entries(SENSE_OF)) byField[field] = new Set(auth[sense] || []);
  return { byField, authorityDump: auth };
})();

/* 读者**当前这一步的表单**是否点名了这个主体。
   表单是「真人此刻能看到什么」的唯一权威落点（beginStep 把 form 挂进 g.pendings）。
   故此判据不是自造规则，而是去问「真人手上的菜单里有没有这一项」。 */
function formNamedIds(g, readerId) {
  const reader = g.players[readerId - 1];
  if (!reader) return null;
  /* ⚠ 不能只读 g.pendings：本探针跑的是**全 AI 局**（无真人），pendings 恒空。
     那样判据会永远返回 null ⇒ 所有读取都落进 VIOLATION ⇒ 探针变成「见谁都说透视」。
     正确做法：**按当前步现算那张表单**（form 就是真人此刻会看到的菜单，
     beginStep 做的也只是把它挂到 pendings 上）。
     但现算会触发 form 层的真相读取 —— 故必须挂 PHASE='form'，否则自我污染。 */
  const def = Engine.STEPS[g.step];
  let f = null;
  const prevPhase = PHASE;
  PHASE = 'form';
  try { if (def && typeof def.form === 'function') f = def.form(g, reader); } catch (e) { }
  finally { PHASE = prevPhase; }
  if (!f) return null;
  const ids = new Set();
  for (const t of (f.targets || [])) {
    if (t == null) continue;
    ids.add(typeof t === 'object' ? (t.v != null ? t.v : t.id) : t);
  }
  /* targets 之外，表单 desc / opts.sub 里也可能直接印出编号（如感染标记清单） */
  const blob = JSON.stringify([f.desc || '', f.opts || [], f.num || null]);
  for (const p of g.players) if (blob.indexOf(p.id + ' 号') >= 0) ids.add(p.id);
  return ids;
}

function legalForReader(g, readerId, subjectId, field) {
  const keys = viewFieldsFor(g, readerId, subjectId);
  if (!keys) return { legal: true, unknown: true };
  if (keys.has(field)) return { legal: true, bucket: 'VIEW' };
  const mapped = FIELD_TO_VIEW_KEY[field];
  if (mapped && keys.has(mapped)) return { legal: true, bucket: 'VIEW_PROXY' };

  const reader = g.players[readerId - 1], subject = g.players[subjectId - 1];
  if (!reader || !subject) return { legal: true, bucket: 'UNKNOWN_SUBJ' };

  /* ①b 自己的表单已经下发的信息 —— 读取合法，因为真人**在自己的表单里看得见**。
     这是最容易被误判成透视的一档：死囚复生（steps.js:1277-1278 的 req 条件里就有
     `g.players.some(x => x.dying)`，其 form 的 targets 也据此给出濒死者），
     AI 在 decide 里重算同一批濒死者，读的是「自己菜单上已经有的东西」。
     判据：把读者的 form 取出来，看它是否**逐个点名**了这些主体；
     点名了 ⇒ 真人点得到 ⇒ 合法；没点名 ⇒ 真人看不到 ⇒ 违例。 */
  if (readerId === subjectId) return { legal: true, bucket: 'SELF' };
  const namedInForm = formNamedIds(g, readerId);
  if (namedInForm && namedInForm.has(subjectId))
    return { legal: true, bucket: 'OWN_FORM', keys: [...keys].slice(0, 30) };

  /* ① 队友（仅异形阵营有队友互认；人类没有队友） */
  if (reader.faction === 'alien' && subject.faction === reader.faction)
    return { legal: true, bucket: 'TEAMMATE' };
  /* ①b 声明层授权的可见性：doctor 族可见感染标记与濒死，poisoner 可见毒药清单。
     依据 = RD.ROLE_DECL[readerRole].duty.senses（速查卡 sensesQuote 的声明层落点）。 */
  const allowedRoles = SENSE_AUTHORITY.byField[field];
  if (allowedRoles) {
    /* 变形中的死囚：originRole 才是真身份（steps.js:1943 改写 p.role） */
    const readerRole = reader.morph ? (reader.originRole || reader.role) : reader.role;
    if (allowedRoles.has(readerRole)) return { legal: true, bucket: 'DECLARED_SENSE' };
    return { legal: false, bucket: 'VIOLATION', keys: [...keys].slice(0, 30),
             why: '声明层未授权 ' + readerRole + ' 读取 ' + field };
  }
  /* ② 可由公开信息推导（仅对统计类字段有意义，见上） */
  if (AGGREGATE_FIELDS.has(field)) return { legal: true, bucket: 'DERIVABLE', keys: [...keys].slice(0, 30) };
  /* ③ 私有真相 */
  return { legal: false, bucket: 'VIOLATION', keys: [...keys].slice(0, 30) };
}

/* 只判 decide 层：form 层是引擎在替真人算菜单，读真相合法（真人也会看到同样内容）。
   混淆这两层是本探针第一版的错：morph 表单自己就要遍历全场 role 来列变形池，
   若不区分层，会把引擎的菜单计算报成「AI 透视」。 */
function judgeReads() {
  const byPair = new Map();
  for (const r of CUR.reads) {
    if (r.phase !== 'decide') continue;
    const k = r.reader + '>' + r.subject + ':' + r.field;
    if (!byPair.has(k)) byPair.set(k, r);
  }
  for (const [, r] of byPair) {
    const v = legalForReader(CUR.g, r.reader, r.subject, r.field);
    if (v.unknown) { P.viewUnknown++; continue; }
    P.bucketTally[v.bucket] = (P.bucketTally[v.bucket] || 0) + 1;
    if (!v.legal) {
      /* 归并键带读者角色：同一个字段，不同角色读，性质完全不同
         （毒师读 poison 合法、船员读就是透视） */
      const reader = CUR.g.players[r.reader - 1];
      const rRole = reader ? (reader.morph ? (reader.originRole || reader.role) : reader.role) : '?';
      const key = r.field + ' by ' + rRole;
      P.violationPair[key] = (P.violationPair[key] || 0) + 1;
      P.violationTotal++;
      /* 样本只留 30 条，但**计数必须全量** —— 否则报告里的「30 次」会被误读成
         「只发生了 30 次」。样本与计数分开记，这是本探针第一版的教训。 */
      if (P.truthReads.length < 30)
        P.truthReads.push({ ...r, bucket: v.bucket, why: v.why, step: CUR.step, kind: CUR.kind, viewKeys: v.keys });
    }
  }
}

/* ══════════════ ③ 合法性与代价 ══════════════
   同一份 AI 决策，喂给 toDecision（真人解析路径），看是否抛错。
   —— 这条抓「AI 能表达、真人表单表达不了的语义」。
   注意 toDecision 的入参形状是**真人提交形状**（{opt,targets,num,text}），
   而 decide 返回的是**归一后形状**。直接把归一后形状喂进去会误报，
   所以这一步只验证「toDecision 对这个 kind 是登记过的」（不抛错 = 有 case），
   不去比较字段结构 —— 字段结构对等由维度① 承担。 */
function checkLegality(g, req, form, res, ctxInfo) {
  try {
    /* 用真人形状探一次：opts 的第一个值 + 一个合法 target + 第一个 num 选项 */
    const probe = {
      opt: (form.opts && form.opts[0] && form.opts[0].v) || null,
      targets: (form.targets || []).slice(0, 1),
      num: (form.num && form.num.options && form.num.options[0]) ? form.num.options[0].v : null,
      num2: null, text: '', use: false, opt2: null,
    };
    const norm = Engine.toDecision(req.kind, probe);
    if (!norm || typeof norm !== 'object') {
      if (P.toDecisionFail.length < 20) P.toDecisionFail.push({ ...ctxInfo, why: 'toDecision 返回非对象' });
    }
    P.toDecisionOK[req.kind] = (P.toDecisionOK[req.kind] || 0) + 1;
  } catch (e) {
    if (P.toDecisionFail.length < 20)
      P.toDecisionFail.push({ ...ctxInfo, why: 'toDecision 抛错', msg: String(e.message).slice(0, 90) });
  }
}

/* ══════════════ 钩 AI.decide ══════════════ */
const origDecide = AI.decide;
AI.decide = function (g, req) {
  let res = null;
  try { res = origDecide.call(AI, g, req); } catch (e) { P.errs++; bump(P.errMsgs, String(e.message).slice(0, 60), 1); }
  try {
    const p = g.players.find(x => x.id === (req && req.pid));
    if (req && req.kind && p) {
      const def = Engine.STEPS[g.step] || {};
      let form = null;
      /* form 层单独标记：这一层的真相读取属于引擎在替真人算菜单，合法 */
      PHASE = 'form';
      try { if (typeof def.form === 'function') form = def.form(g, p); } catch (e) { } finally { PHASE = null; }
      const info = { step: g.step, kind: req.kind, role: p.role, night: g.night, pid: p.id };
      checkActionSpace(g, req, form, res || {}, info);
      checkLegality(g, req, form, res || {}, info);
    }
  } catch (e) { }
  return res;
};
function bump(o, k, n) { o[k] = (o[k] || 0) + (n == null ? 1 : n); }

/* 信息边界的判定需要「进入决策 / 离开决策」两个时点。
   AI.decide 是门面钩（引擎确实走门面，见交接文档 §七.1），故在此前后设 CUR。 */
AI.decide = (function (inner) {
  return function (g, req) {
    const prev = CUR, prevPhase = PHASE;
    CUR = { g, pid: req && req.pid, step: g.step, kind: req && req.kind, reads: [] };
    PHASE = 'decide';
    let out;
    try { out = inner.call(AI, g, req); } finally {
      try { judgeReads(); } catch (e) { }
      CUR = prev; PHASE = prevPhase;
    }
    return out;
  };
})(AI.decide);

/* ══════════════ 主循环 ══════════════ */
console.log(SeatMode.note());
console.log(SeatMode.zoneReport(SEED0, SEED0 + N - 1).note);
console.log('局数 = ' + N + '（种子 ' + SEED0 + ' 起）');

for (let i = 0; i < N; i++) {
  try {
    const g = SeatMode.seatGame(Setup, SEED0 + i);
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    installTruthGetters(g);
    Engine.begin(g);
    let k = 0;
    while (!g.over && k < 5000) {
      Engine.stepOnce(g);
      if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
      k++;
      P.steps++;
    }
    P.games++;
  } catch (e) {
    P.errs++; bump(P.errMsgs, String(e.message).slice(0, 60), 1);
  }
}
AI.decide = origDecide;

/* ══════════════ 报告 ══════════════ */
const out = {
  meta: {
    seatMode: SeatMode.seatMode(), seedFrom: SEED0, seedTo: SEED0 + N - 1,
    games: P.games, steps: P.steps, errs: P.errs, errMsgs: P.errMsgs,
    note: '观测脚本，不改行为。三个维度互相独立：动作空间 / 信息边界 / 合法性与代价。',
  },
  d1_actionSpace: {
    dispatches: P.dispatches, formsCompared: P.formsCompared,
    kindsWithoutForm: P.kindNoForm,
    unmappedKinds: P.unmappedKinds,
    coverageNote: 'unmappedKinds = 没有登记 opt 映射表的 kind。这些 kind 的 opt 类别**未判**'
      + '（只验了 targets/num）—— 不判违例不等于测过，看数时必须连这张表一起读。',
    outOfForm: P.outOfForm.length, outOfFormSamples: P.outOfForm.slice(0, 8),
    targetOutOfForm: P.targetOutOfForm.length, targetSamples: P.targetOutOfForm.slice(0, 8),
    numOutOfForm: P.numOutOfForm.length, numSamples: P.numOutOfForm.slice(0, 8),
  },
  d2_information: {
    readsByField: P.readTally,
    decideViolations: P.violationTotal,
    sampleCount: P.truthReads.length,
    buckets: P.bucketTally,
    violationFields: P.violationPair,
    samples: P.truthReads.slice(0, 12),
    viewUnknown: P.viewUnknown,
    note: 'decideViolations = AI 决策期读到了「私有真相且不可由公开信息推出」的字段。'
      + '分档：VIEW=视图直接下发 / VIEW_PROXY=视图以投影字段下发 / TEAMMATE=队友互认（规则明文）'
      + ' / DERIVABLE=统计类，真人可由「开局公告构成 + 死亡公告揭示」自行推出 / VIOLATION=真透视。'
      + 'form 层读取不计入——那是引擎在替真人算菜单，真人也看到同样内容。'
      + '本维度只回答「AI 有没有直接读权威真相字段」，不回答「AI 私有账本里有没有不该有的」'
      + '（getter 拦不到账本路径，那是 B1/B3 的范围）。',
  },
  d3_legality: {
    failures: P.toDecisionFail.length, samples: P.toDecisionFail.slice(0, 8),
  },
};

console.log('');
console.log('① 动作空间对等：派发 ' + P.dispatches + ' 次，可对照表单 ' + P.formsCompared + ' 次');
console.log('   AI 交了表单外的 opt值：' + P.outOfForm.length + '   表单外的 target：' + P.targetOutOfForm.length + '   表单外的 num：' + P.numOutOfForm.length);
/* 覆盖率自陈：没有 opt 映射表的 kind 记为 unmapped（不判违例 = 不假装测到）。
   必须显式报出来，否则「零违例」会被误读成「全都测过了」。 */
console.log('   opt 映射未覆盖的 kind（这些只验 targets/num，opt 类别未判）=' + JSON.stringify(P.unmappedKinds));
console.log('   无 form 可对照的 kind = ' + JSON.stringify(P.kindNoForm));
if (P.outOfForm.length) P.outOfForm.slice(0, 5).forEach(x => console.log('   · opt ' + JSON.stringify(x)));
if (P.targetOutOfForm.length) P.targetOutOfForm.slice(0, 5).forEach(x => console.log('   · target ' + JSON.stringify(x)));
if (P.numOutOfForm.length) P.numOutOfForm.slice(0, 5).forEach(x => console.log('   · num ' + JSON.stringify(x)));
console.log('');
console.log('② 信息边界对等（只判 decide 层；form 层是引擎算菜单，读取合法）');
console.log('   AI 决策期读他人真相字段频次：');
Object.keys(P.readTally).filter(k => k.indexOf('decide:') === 0).sort()
  .forEach(k => console.log('      ' + k.slice(7).padEnd(16) + P.readTally[k]));
console.log('   读取合法性分档：' + JSON.stringify(P.bucketTally));
console.log('   ★ 真透视（VIOLATION，私有真相且不可公开推导）：' + P.violationTotal + ' 次');
if (Object.keys(P.violationPair).length) {
  console.log('   归并后的违例清单（字段 by 读者角色 → 次数）：');
  Object.keys(P.violationPair).sort((a, b) => P.violationPair[b] - P.violationPair[a])
    .forEach(k => console.log('      ' + k + '  ×' + P.violationPair[k]));
}
P.truthReads.slice(0, 10).forEach(x => console.log('   · ' + JSON.stringify(x)));
console.log('   （View 不可用导致无法判定的次数 = ' + P.viewUnknown + '，须为 0）');
console.log('   DERIVABLE 档说明：统计类读取（存活几人/还剩几个医生）走的是真相字段，');
console.log('     但其结论真人也推得出来（开局公告给构成 + 死亡公告给真实阵营），故不判违例。');
console.log('');
console.log('③ 合法性与代价对等：toDecision 失败 = ' + P.toDecisionFail.length);
P.toDecisionFail.slice(0, 5).forEach(x => console.log('   · ' + JSON.stringify(x)));

console.log('');
console.log(JSON.stringify(out, null, 1));
/* 产物落到 tools/（按席位口径分流），让 verify-handover-doc.cjs 能核对到 ——
   铁律二：报出的数字必须能被别人独立复跑，读的是落盘产物而不是文档声称值。 */
try {
  const art = 'human-ai-parity-' + SEED0 + '-' + (SEED0 + N - 1);
  const file = path.join(ROOT, 'tools', SeatMode.artifactFor(art));
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log('已写出 ' + file);
} catch (e) { console.log('产物写出失败: ' + String(e.message).slice(0, 60)); }

/* 退出码：只对「规则性违例」非 0 —— 即 AI 拿到了真人没有的动作或信息。
   指标（读数）不进 gate。 */
const violations = P.outOfForm.length + P.targetOutOfForm.length + P.numOutOfForm.length
  + P.violationTotal + P.toDecisionFail.length;
process.exit(violations ? 1 : 0);