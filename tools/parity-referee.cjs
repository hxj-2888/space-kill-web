'use strict';
/* ============================================================================
 * 裁判探针（v7 对等审查 · 裁判臂）
 *
 * ⚠ 纪律（2026-10-08 用户裁定，写在最前面，因为它是本文件的**存在前提**）：
 *   「裁判探针可以有上帝视角，模拟 AI 探针不可以。」
 *   本文件是**裁判**：它读真相、判对错，可以看全知信息。
 *   但它**只能读模拟器写下来的账本**（tools/parity-sim-*.json），绝不自己跑对局、
 *   绝不把任何读数写回对局状态 —— 裁判看的是赛后记录，不是场上的作弊器。
 *   模拟臂见 tools/parity-sim.cjs：那个文件**不许**出现任何真相读取。
 *   两者用同一种子的产物对拍，并由 sim 臂自证「裁判在场与否，逐位相同」。
 *
 * 裁判的职责：拿模拟账本回答「AI 与真人除思维外是否相同」，三个维度：
 *   ① 动作空间：AI 交回的每个值，真人的表单上点得到吗？
 *   ② 信息边界：AI 读到的字段，真人视图（view.js sanitize）会下发吗？
 *   ③ 合法性：toDecision 对每个 kind 都登记了吗？
 *
 * 判据真源（不自己维护清单）：
 *   · 表单 = 模拟器记下的 form 摘要（真人手上那张菜单，模拟器读它是合法的）
 *   · 可见性 = js/view.js 的 sanitize（仓库唯一的视图构建器）
 *   · 情报授权 = js/v66/declaration/roleDecl.js 的 duty.senses（速查卡 sensesQuote 的落点）
 *
 * 用法：node tools/parity-referee.cjs <REPO_ROOT> <账本路径>
 * 退出码：0 = 三维度无违例；非 0 = 有违例（明细见输出与产物）
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || process.cwd();
const LEDGER = process.argv[3] || path.join(ROOT, 'tools', 'parity-sim-241-300-variants.json');
const SeatMode = require(path.join(ROOT, 'tools', 'seat-mode.cjs'));

const src = fs.readFileSync(path.join(ROOT, 'tools', 'load-order.cjs'), 'utf8');
const m = { exports: {} };
new Function('require', 'module', 'exports', '__dirname', '__filename', src)(
  require, m, m.exports, path.join(ROOT, 'tools'), 'x');
const { makeCtx, loadInto, profiles } = m.exports;
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
/* view.js 属 profiles.ui（联机广播用）。裁判臂需要它作可见性判据真源 ——
   缺了它「信息边界」会恒判通过，那是最坏的失败模式（看起来在工作、实际什么都没测）。 */
loadInto(ctx, path.join(ROOT, 'js'), ['view']);
const { Engine } = ctx;
const RD = ctx.SKRoleDecl;
const View = ctx.View;
if (!View || typeof View.build !== 'function')
  throw new Error('parity-referee: View.build 不可用 —— 维度②（信息边界）无法判定。'
    + '裁判失效绝不可被读成「零透视」。');

/* ══════════════ 账本读取 ══════════════ */
if (!fs.existsSync(LEDGER))
  throw new Error('parity-referee: 账本不存在 ' + LEDGER + '。先跑 tools/parity-sim.cjs。');
const L = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
if (L.meta && L.meta.seatMode && L.meta.seatMode !== SeatMode.seatMode())
  throw new Error('口径不一致：账本是 ' + L.meta.seatMode + '，裁判跑的是 ' + SeatMode.seatMode()
    + '。拿一种口径的账本判另一种口径 = 制造假缺陷。');

/* ══════════════ 判据真源：声明层派生的情报授权 ══════════════
   「谁被授权看到 infection / dying / poison」在速查卡的 sensesQuote 里，
   转录于 tools/card-audit.cjs 的 CARD，经 card-audit 对齐到 roleDecl 的 duty.senses。
   ⇒ 从声明层现场派生，不手写可见性表（手写必然与实现漂移）。 */
const SENSE_AUTHORITY = (() => {
  const SENSE_OF = { infection: 'infectMarks', dying: 'dyingList', poison: 'poisonList' };
  const auth = {};
  for (const k of RD.keys()) for (const s of ((RD.ROLE_DECL[k].duty || {}).senses || [])) {
    if (!auth[s]) auth[s] = [];
    auth[s].push(k);
  }
  const byField = {};
  for (const [field, sense] of Object.entries(SENSE_OF)) byField[field] = new Set(auth[sense] || []);
  return { byField, authorityDump: auth };
})();

/* 真相字段 → 视图里的承载键。null = 视图从不下发（真私有）。
   只收「视图确实用投影字段承载」的项；其余一律 null，避免自我宽容。 */
const FIELD_TO_VIEW_KEY = {
  faction: 'faction', role: 'role', roleName: 'roleName',
  claimedRole: 'claimedRole', infection: 'infection', alien: 'alien',
  dying: 'dying', revealed: 'revealed', accuseHistory: 'accusers',
  originRole: null, convict: null, morph: null, branch: null, silenceNight: null,
  noActive: null, vSelf: null, theta: null, killLeft: null, extraKill: null,
  healLeft: null, rescueLeft: null, cureSelf: null, bullets: null,
  patrolUsed: null, repairTotal: null, extraRepair: null, nightImmune: null,
  destroyLeft: null, meetingLeft: null, poison: null, transferExposed: null,
};

/* ══════════════ 判据自证（铁律三：判据必须能自己挂）══════════════
   裁判自己也得先证明自己的判据没写反，否则「零违例」是假的。
   在一个构造局面上验两件事：
     ① 船员视角看不到异形的 faction/role（映射表若写反，这条会挂）
     ② 自己看自己能看到 faction/role（映射表若过严，这条会挂） */
(function selfTest() {
  const g = ctx.Setup.createGame(4242, 'random');
  g.humans = []; g.humanId = -1;
  for (const p of g.players) p.isHuman = false;
  const me = g.players.find(p => p.faction === 'human');
  const other = g.players.find(p => p.faction === 'alien');
  const keysFor = (readerId, subjectId) => {
    const b = View.build(g, readerId);
    if (!b) return null;
    const s = (b.players || []).find(x => x.id === subjectId);
    return s ? new Set(Object.keys(s)) : null;
  };
  const otherKeys = keysFor(me.id, other.id);
  if (!otherKeys) throw new Error('parity-referee: View.build 返回空 —— 判据真源失效。');
  if (otherKeys.has('faction') || otherKeys.has('role'))
    throw new Error('parity-referee: 自证失败 —— 船员视角竟能看到异形 faction/role。');
  const selfKeys = keysFor(me.id, me.id);
  if (!selfKeys || !selfKeys.has('faction') || !selfKeys.has('role'))
    throw new Error('parity-referee: 自证失败 —— 自己看自己都看不到 faction/role，映射表过严。');
  console.log('裁判判据自证通过：船员看不到异形 faction/role；自己看自己可以。');
})();

/* ══════════════ 裁判臂：重放取状态 ══════════════
   裁判要看上帝视角，就得有一份完整对局状态。而模拟器**不该**把整个状态交出来
   （那是模拟器把上帝视角交出去 = 纪律破口）。
   故：裁判自己按同种子重放一遍 —— 对局是确定性的，重放得到的状态与模拟器当时**逐位相同**。
   裁判重放只读不写（不装任何记录器、不调 decide），对局状态零影响。
   ⚠ 重放时**不得**装 getter：那会让重放偏离裸跑，等于裁判改了对局。 */
const viewKeySets = new Map();   /* "seed|step|reader>subject" → Set(键) */
const roleOfAt = new Map();      /* "seed|step|reader" → {role, faction, morph} */

for (let i = 0; i < ((L.meta && L.meta.games) || 0); i++) {
  const seed = (L.meta.seedFrom || 0) + i;
  try {
    const g = SeatMode.seatGame(ctx.Setup, seed);
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    Engine.begin(g);
    let k = 0;
    while (!g.over && k < 6000) {
      /* ⚠ 要建视图的步**不能读 g.step** —— 它是上一步（beginStep 内部才设成本步，
         engine.js:701）。读它会让裁判整体错位一格，代价是 934 次「无法判定」。
         正确读法是 g.queue[0]（即将执行的那一步），与 handsover-sim 的修法同源。 */
      const ahead = (g.queue && g.queue.length) ? g.queue[0] : null;
      const wanted = (L.readSteps || {})[seed] || [];
      /* 两个候选都要试：queue[0] 是「即将执行的步」，g.step 是「上一步」。
         收尾步（队列已空、最后一批 decide 在 finishStep 里派发）只有 g.step 对得上 ——
         只认 queue[0] 会漏掉它们（实测 898 次「无法判定」就是这么来的）。
         两个都建，键里带步号，不会互相覆盖。 */
      const steps = [];
      if (ahead != null && wanted.indexOf(ahead) >= 0) steps.push(ahead);
      if (g.step != null && wanted.indexOf(g.step) >= 0 && g.step !== ahead) steps.push(g.step);
      for (const step of steps) {
        for (const p of g.players) {
          /* identity：role 是当前呈现、originRole 是原职业。裁判需要两个都拿到 ——
             死囚变形时 role 是伪装目标、情报权却属 originRole（6.8.3 不改变额度归属），
             归因错了就会把「死囚复生」报成「猎手偷看濒死名单」。 */
          roleOfAt.set(seed + '|' + step + '|' + p.id,
            { role: p.role, originRole: p.originRole, faction: p.faction, morph: p.morph });
        }
        for (const reader of g.players) {
          if (reader.out) continue;
          let built = null;
          try { built = View.build(g, reader.id); } catch (e) { }
          if (!built) continue;
          for (const s of (built.players || []))
            viewKeySets.set(seed + '|' + step + '|' + reader.id + '>' + s.id, new Set(Object.keys(s)));
        }
      }
      Engine.stepOnce(g);
      if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
      k++;
    }
  } catch (e) { /* 重放失败 → 该种子的读取判为「无法判定」，由 viewUnknown 计数 */ }
}

/* ══════════════ 判定 ══════════════ */
const P = {
  decisions: 0,
  outOfForm: [], targetOutOfForm: [], numOutOfForm: [],
  unmappedKinds: {}, kindsWithoutForm: {},
  /* ② 信息边界 */
  buckets: {}, violations: {}, violationTotal: 0, samples: [],
  viewUnknown: 0,
  /* ③ 合法性 */
  toDecisionFail: [],
};

/* 维度①：AI 交回的值必须落在真人表单的词表里。
   判据只用模拟器记下的 form 摘要 —— 模拟器读 form 是合法的（它就是真人那张菜单）。 */
function checkActionSpace(d) {
  P.decisions++;
  const f = d.form;
  if (!f) { P.kindsWithoutForm[d.kind] = (P.kindsWithoutForm[d.kind] || 0) + 1; return; }
  const res = d.res || {};

  /* opt 词表 */
  const optVals = new Set((f.opts || []).map(o => o.v));
  const hasOpts = !!(f.opts && f.opts.length);
  /* 真人表单的 opt → AI 归一字段的类别映射。
     为什么要这张表：真人提交 {opt,targets,num}，toDecision 归一后才进 g.decisions；
     AI 直接产出归一后形状（如 mode:'check'、act:'heal'）。两者的字段名与取值词表
     本来就不同 —— 那是接口差异，不是能力差异。故判据是「AI 声明的动作类别能否
     在该 kind 的登记映射里找到」，而不是字符串相等。
     未登记的 kind 记 unmappedKinds（**不判违例 ≠ 测过了**，看数时必须连这张表读）。 */
  const MODE_OF_OPT = {
    crewAction: { check: 'check', none: 'none', repair: 'CREW_REPAIR_RESERVE' },
    crewRepair: { none: 'none', crewRepair: 'CREW_REPAIR' },
    doctor: { heal: 'heal', rescue: 'rescue', selfsave: 'selfsave', brew: 'brew',
              poison: 'poison', antidote: 'antidote', none: 'none' },
    craft: { cast: 'cast', distribute: 'distribute', none: 'none' },
    shoot: { gather: 'gather', none: 'none', shoot: 'shoot' },
    detective: { check: 'check', announce: 'announce', none: 'none' },
  };
  for (const k of ['mode', 'act', 'opt', 'dir', 'branch']) {
    const v = res[k];
    if (v === undefined || v === null) continue;
    const norm = v === true ? 'yes' : v === false ? 'no' : String(v);
    if (hasOpts && (optVals.has(norm) || optVals.has(String(norm)))) continue;
    const map = MODE_OF_OPT[d.kind];
    if (map && Object.prototype.hasOwnProperty.call(map, norm)) continue;
    if (typeof v === 'boolean') continue;                 // use/call/do 类对应 yes/no 档
    if (!map) { P.unmappedKinds[d.kind] = (P.unmappedKinds[d.kind] || 0) + 1; continue; }
    if (P.outOfForm.length < 20)
      P.outOfForm.push({ seed: d.seed, step: d.step, kind: d.kind, role: d.role, field: k, value: norm, opts: [...optVals].slice(0, 12) });
  }

  /* targets：必须是表单候选的子集 */
  const ft = (f.targets || []).map(t => (t && typeof t === 'object' ? t.v ?? t.id : t));
  if (ft.length) {
    const tset = new Set(ft.map(String));
    for (const t of [].concat(res.targets || [], res.target != null ? [res.target] : [])) {
      if (t == null) continue;
      if (!tset.has(String(t)) && P.targetOutOfForm.length < 20)
        P.targetOutOfForm.push({ seed: d.seed, step: d.step, kind: d.kind, role: d.role, target: t, formTargets: [...tset].slice(0, 12) });
    }
  }

  /* num：按**数值**比（'1.5' vs 1.5 会误报 —— 第一版就栽在这）。
     ⚠ 但**只有当这个字段真的是数值档位时才查**：表单的 num.options 在不同步里
       含义完全不同 —— 步骤 2 船员的 num.options 是**待查证身份池**（"crew"/"bio"…），
       而 AI 在那一步返回的 `value` 是 4a 协助维修的预留档值（0.25~0.50，engine.js:514-521
       明载该分支已是死码、实际执行发生在 4a）。拿身份池去比维修档值 ⇒ 20 次假违例。
       判据：**num.options 全是数字 ⇒ 是数值域，查；否则是身份池，不查。** */
  const isMagnitude = arr => arr.length > 0 && arr.every(v => typeof v === 'number' || !Number.isNaN(parseFloat(v)) && String(v).trim() !== '' && /^-?\d+(\.\d+)?$/.test(String(v)));
  const numOpts = ((f.num && f.num.options) || []).map(o => o.v);
  const num2Opts = ((f.num2 && f.num2.options) || []).map(o => o.v);
  const numVals = isMagnitude(numOpts) ? new Set(numOpts.map(v => (typeof v === 'number' ? v : parseFloat(v)))) : new Set();
  const num2Vals = isMagnitude(num2Opts) ? new Set(num2Opts.map(v => (typeof v === 'number' ? v : parseFloat(v)))) : new Set();
  if (!numVals.size && !num2Vals.size) return;      /* 非数值域（身份池等）→ 本步不判 num */
  for (const k of ['num', 'num2', 'product', 'value', 'extraValue']) {
    const v = res[k];
    if (v === undefined || v === null || typeof v === 'boolean') continue;
    const nv = typeof v === 'number' ? v : parseFloat(v);
    if (Number.isNaN(nv)) continue;
    if (numVals.has(nv) || num2Vals.has(nv)) continue;
    if (P.numOutOfForm.length < 20)
      P.numOutOfForm.push({ seed: d.seed, step: d.step, kind: d.kind, role: d.role, field: k, value: v, numOptions: numOpts.slice(0, 12) });
  }
}

/* 维度②：裁判用上帝视角判定「这一读是否越界」。
   判据四档：
     VIEW          视图直接下发
     OWN_FORM      读者自己表单里已点名（真人点得到）
     TEAMMATE      队友互认（view.js:39/55 规则明文）
     DECLARED_SENSE 声明层 duty.senses 明确授权（速查卡 sensesQuote）
     DERIVABLE     统计类，真人可由公开信息推出
     VIOLATION     私有真相且不可公开推导 = 真透视 */
function judgeRead(r) {
  const sk = r.seed + '|' + r.step;
  const keys = viewKeySets.get(sk + '|' + r.reader + '>' + r.subject);
  if (!keys) { P.viewUnknown++; return; }
  const field = r.field;
  if (keys.has(field)) { P.buckets.VIEW = (P.buckets.VIEW || 0) + 1; return; }
  const mapped = FIELD_TO_VIEW_KEY[field];
  if (mapped && keys.has(mapped)) { P.buckets.VIEW_PROXY = (P.buckets.VIEW_PROXY || 0) + 1; return; }
  /* 读者自己表单里点名了 ⇒ 真人点得到 */
  const named = (L.namedByReader[r.seed] || {})[r.reader];
  if (named && named.indexOf(r.subject) >= 0) { P.buckets.OWN_FORM = (P.buckets.OWN_FORM || 0) + 1; return; }
  /* 队友互认（view.js:39/55 规则明文） */
  const rr = roleOfAt.get(sk + '|' + r.reader), sr = roleOfAt.get(sk + '|' + r.subject);
  if (rr && sr && rr.faction === 'alien' && rr.faction === sr.faction) { P.buckets.TEAMMATE = (P.buckets.TEAMMATE || 0) + 1; return; }
  /* 声明层授权（速查卡 sensesQuote）
     ⚠ 读者的身份必须取 **originRole**：死囚变形会改写 p.role（steps.js:1943），
       变形后 role 是伪装目标、而它的情报权仍属死囚本体（6.8.3 变形不改变额度归属）。
       用 role 判会把「死囚变形后复生」报成「猎手在偷看濒死名单」—— 假归因。 */
  const allowed = SENSE_AUTHORITY.byField[field];
  if (allowed) {
    const rRole = rr ? (rr.originRole || rr.role) : '?';
    if (allowed.has(rRole)) { P.buckets.DECLARED_SENSE = (P.buckets.DECLARED_SENSE || 0) + 1; return; }
    return record(r, '声明层未授权 ' + rRole + ' 读取 ' + field + (rr && rr.morph ? '（变形态，真身份 ' + rRole + '）' : ''));
  }
  /* 统计类可由公开信息推出 */
  if (field === 'faction' || field === 'role' || field === 'originRole') { P.buckets.DERIVABLE = (P.buckets.DERIVABLE || 0) + 1; return; }
  return record(r, '私有真相且不可公开推导');
}

function record(r, why) {
  const rr = roleOfAt.get(r.seed + '|' + r.step + '|' + r.reader);
  const rRole = rr ? (rr.originRole || rr.role) : '?';
  const disp = rr && rr.morph ? (rRole + '(变形为' + rr.role + ')') : rRole;
  const k = r.field + ' by ' + disp;
  P.violations[k] = (P.violations[k] || 0) + 1;
  P.violationTotal++;
  if (P.samples.length < 30)
    P.samples.push({ seed: r.seed, step: r.step, kind: r.kind, reader: r.reader, subject: r.subject, field: r.field, why });
}

/* 维度③：toDecision 是否登记了该 kind */
function checkLegality(d) {
  if (!d.form) return;
  const probe = {
    opt: (d.form.opts && d.form.opts[0] && d.form.opts[0].v) || null,
    targets: (d.form.targets || []).slice(0, 1),
    num: (d.form.num && d.form.num.options && d.form.num.options[0]) ? d.form.num.options[0].v : null,
    num2: null, text: '', use: false,
  };
  try {
    const norm = Engine.toDecision(d.kind, probe);
    if (!norm || typeof norm !== 'object') P.toDecisionFail.push({ kind: d.kind, why: '返回非对象' });
  } catch (e) {
    P.toDecisionFail.push({ kind: d.kind, why: String(e.message).slice(0, 90) });
  }
}

/* ══════════════ 跑 ══════════════ */
for (const d of (L.decisions || [])) { checkActionSpace(d); checkLegality(d); }
/* 读取去重后判定：同一 (seed,reader,subject,field) 只判一次，
   否则 60 局的重复读取会把「次数」放大到没有意义（计数是观测，不是判据）。
   ⚠ 闸门内的**投影读取**（via='gate'）单列成 GATE 档，不参与越界判定：
      View.build 是投影计算，真人客户端渲染时也要算同一份。混算会把
      「AI 用了 AI 视角外的信息」这个结论被探针自己污染。 */
const seen = new Set();
let gatePairs = 0;
for (const r of (L.reads || [])) {
  if (r.via === 'gate') { gatePairs++; continue; }
  const k = r.seed + '|' + r.reader + '|' + r.subject + '|' + r.field;
  if (seen.has(k)) continue;
  seen.add(k);
  judgeRead(r);
}

console.log('裁判账本 = ' + LEDGER);
console.log(SeatMode.note());
console.log('');
console.log('① 动作空间对等：账本 ' + (L.decisions || []).length + ' 条决策，可对照表单 '
  + (L.decisions || []).filter(d => d.form).length + ' 条');
console.log('   AI 交了表单外的 opt=' + P.outOfForm.length + '  target=' + P.targetOutOfForm.length + '  num=' + P.numOutOfForm.length);
console.log('   opt 映射未覆盖的 kind（opt 类别未判，不等于测过）= ' + JSON.stringify(P.unmappedKinds));
console.log('   无 form 可对照的 kind = ' + JSON.stringify(P.kindsWithoutForm));
console.log('');
console.log('② 信息边界对等：判定 ' + seen.size + ' 个去重读取对（另 ' + gatePairs
  + ' 条为闸门内的投影读取，不参与判定）');
console.log('   分档 = ' + JSON.stringify(P.buckets));
console.log('   ★ 真透视 = ' + P.violationTotal + ' 次');
Object.keys(P.violations).sort((a, b) => P.violations[b] - P.violations[a])
  .forEach(k => console.log('      ' + k + '  ×' + P.violations[k]));
P.samples.slice(0, 6).forEach(x => console.log('   · ' + JSON.stringify(x)));
console.log('   无法判定（视图不可用）= ' + P.viewUnknown + '，须为 0');
console.log('');
console.log('③ 合法性与代价对等：toDecision 失败 = ' + P.toDecisionFail.length);
P.toDecisionFail.slice(0, 5).forEach(x => console.log('   · ' + JSON.stringify(x)));

const out = {
  meta: {
    role: '裁判臂（可读上帝视角；模拟臂见 tools/parity-sim.cjs，不许读真相）',
    ledger: path.basename(LEDGER), seatMode: SeatMode.seatMode(),
    seedFrom: L.meta && L.meta.seedFrom, seedTo: L.meta && L.meta.seedTo,
    note: '本探针不跑对局，只读模拟器写下的账本。判定用 view.js sanitize（唯一视图构建器）'
      + '与 roleDecl duty.senses（速查卡 sensesQuote 落点）两个真源，不自维护可见性表。',
  },
  d1_actionSpace: {
    decisions: (L.decisions || []).length, compared: (L.decisions || []).filter(d => d.form).length,
    outOfForm: P.outOfForm.length, outOfFormSamples: P.outOfForm,
    targetOutOfForm: P.targetOutOfForm.length, targetSamples: P.targetOutOfForm,
    numOutOfForm: P.numOutOfForm.length, numSamples: P.numOutOfForm,
    unmappedKinds: P.unmappedKinds, kindsWithoutForm: P.kindsWithoutForm,
  },
  d2_information: {
    pairsJudged: seen.size, gateProjectionReads: gatePairs, buckets: P.buckets,
    violations: P.violationTotal, violationFields: P.violations, samples: P.samples,
    viewUnknown: P.viewUnknown,
    declaredAuthority: SENSE_AUTHORITY.authorityDump,
    gateNote: 'gateProjectionReads = 可见性闸门算 View.build 投影时的读取。'
      + '与真人客户端渲染同一份投影同性质，故不参与越界判定；但计数在此公开，不藏。',
  },
  d3_legality: { failures: P.toDecisionFail.length, samples: P.toDecisionFail.slice(0, 12) },
};

console.log('');
const art = 'parity-referee-' + (L.meta && L.meta.seedFrom) + '-' + (L.meta && L.meta.seedTo);
try {
  const file = path.join(ROOT, 'tools', SeatMode.artifactFor(art));
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log('已写出 ' + file);
} catch (e) { console.log('产物写出失败: ' + String(e.message).slice(0, 60)); }

const violations = P.outOfForm.length + P.targetOutOfForm.length + P.numOutOfForm.length
  + P.violationTotal + P.toDecisionFail.length;
process.exit(violations ? 1 : 0);