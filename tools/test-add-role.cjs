#!/usr/bin/env node
/* =============================================================
 * 太空杀 · H1 验收：加角色只改声明层（K1「角色集合开放」的机械证据）
 *
 * 做法（清单 §8 的 diff 为空型断言）：
 *   ① 把 js/ 整树复制到临时目录；
 *   ② **只**改副本里的 js/v66/declaration/roleDecl.js——追加一个角色声明（猎手 hunter）；
 *   ③ 用副本加载完整对局栈，检查派生结构是否自动跟上（ROLES / 查证池 / 组位自检）；
 *   ④ 跑整局（含该角色在场）确认不崩，并按 D3 检查未实装能力时的降级；
 *   ⑤ 逐文件比对副本与源树：**除 roleDecl.js 外必须逐字节一致**（这就是「只改声明层」）。
 *
 * 判定：任一环节失败即视为 K1 破口（新增角色被迫改第二个文件）。
 * 用法：node tools/test-add-role.cjs
 * ============================================================= */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeCtx, loadInto, profiles } = require('./load-order.cjs');

const ROOT = path.join(__dirname, '..');
const SRC_JS = path.join(ROOT, 'js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-addrole-'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  → ' + extra : ''}`); }
};

/* ---------- ① 复制整树 ---------- */
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}
const TMP_JS = path.join(TMP, 'js');
copyTree(SRC_JS, TMP_JS);

/* ---------- ② 只改声明层：追加新角色声明 ---------- */
const DECL_FILE = path.join(TMP_JS, 'v66', 'declaration', 'roleDecl.js');
const declSrc = fs.readFileSync(DECL_FILE, 'utf8');
/* 插到 ROLE_DECL 表内首个角色（crew）之前，锚点缺失即 fail loud（防 fixture 静默失效） */
const ANCHOR = "    crew: {";
if (declSrc.indexOf(ANCHOR) < 0) {
  console.error('fixture 锚点缺失：roleDecl.js 中找不到 ' + JSON.stringify(ANCHOR));
  process.exit(2);
}
/* 〔批次 29〕fixture 角色由 hunter 改为合成探针 prober——hunter 已随 A6 实装进真树，
   再以 fixture 名义追加会同键撞车（声明表重复键静默覆盖，测试失真）。探针沿用
   猎杀位组位与同形字段，验证口径不变（容器开放 + 派生跟上 + 降级不崩）。 */
const NEW_ROLE = `    prober: {
      /* H1 fixture：新增角色只改本文件——猎杀位合成探针（非规则角色）。
         不实装其能力（actionStep 借用 6 但引擎无对应 grants 分支），只验证
         「容器开放 + 派生跟上 + 降级不崩」。 */
      name: '探针员', faction: 'human', group: 'hunt', isBase: true,
      desc: 'H1 fixture 角色：合成探针，无实装能力。',
      actionStep: '6', judgeMode: 'presented', attend: { lethal: 1.1 },
      charges: { gun: 1 }, visibility: { batch: ['③'], private: ['7.2.2'], selfOnly: false },
      source: 'H1-fixture',
    },
`;
fs.writeFileSync(DECL_FILE, declSrc.replace(ANCHOR, NEW_ROLE + ANCHOR), 'utf8');

/* ---------- ③ 用副本加载完整栈，检查派生结构 ---------- */
const ctx = makeCtx({ RegExp });
loadInto(ctx, TMP_JS, profiles.full);
const D = ctx.SKData, RD = ctx.SKRoleDecl, AI = ctx.AI, Setup = ctx.Setup, Engine = ctx.Engine;

ok('H1：新增角色已进声明表与 ROLES（无需改 data.js）',
  RD.has('prober') && !!D.ROLES.prober && D.ROLES.prober.faction === 'human',
  JSON.stringify(D.ROLES.prober));
ok('H1：查证池（HUMAN_BASE_ROLES）自动纳入新角色（D1 推导，无需改硬编码表）',
  D.HUMAN_BASE_ROLES.indexOf('prober') >= 0, D.HUMAN_BASE_ROLES.join(','));
ok('H1：开局席位表（HUMAN_SETUP）不受影响（新角色未声明席位，组位表驱动）',
  D.HUMAN_SETUP.join(',') === 'crew,crew,crew,crew,engineer,sheriff,bio,rescue,detective,bodyguard,inspector',
  D.HUMAN_SETUP.join(','));
ok('H1：声明层自检仍为空（组位/席位/命名空间三张表一致）',
  RD.audit().length === 0 && RD.seatAudit().length === 0 && RD.namespaceAudit().length === 0,
  RD.audit().concat(RD.seatAudit(), RD.namespaceAudit()).join('；'));
ok('H1：注意力权重按声明生效（新角色 attend.lethal 可读；未声明族仍缺省 1.0）',
  ctx.Tiers.attend('prober', 'lethal') === 1.1 && ctx.Tiers.attend('prober', 'infra') === 1,
  ctx.Tiers.attend('prober', 'lethal') + '/' + ctx.Tiers.attend('prober', 'infra'));

/* ---------- ④ 整局运行：角色在场 + 降级 ---------- */
const play = (seed, forceRole) => {
  const g = Setup.createGame(seed, 'random');
  g.humanId = -1; g.humans = [];
  for (const p of g.players) p.isHuman = false;
  if (forceRole) {
    const p = g.players.find(x => x.role === 'crew') || g.players[0];
    p.role = 'prober'; p.roleName = '探针员'; p.roleExpert = 'prober';
  }
  Engine.begin(g);
  let steps = 0;
  while (!g.over && steps < 4000) {
    Engine.stepOnce(g);
    steps++;
    if (g.pending) {
      const f = g.pending, data = { opt: null, targets: [], num: null, text: '' };
      if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) data.opt = u[0].v; }
      if (f.targets) { const list = Engine.alive(g); if (list.length) data.targets.push(list[0].id); }
      if (f.num) data.num = f.num.options[0].v;
      Engine.submit(g, data);
    }
  }
  return g;
};
let err = null;
try { play(8101, true); } catch (e) { err = e.message; }
ok('H1：新角色在场整局跑通（未实装能力时按 D3 降级，不抛错）', err === null, err || '');
const errs = [];
for (let i = 0; i < 20; i++) { try { play(8200 + i, false); } catch (e) { errs.push('seed ' + (8200 + i) + ': ' + e.message); } }
ok('H1：新角色声明存在时，20 局常规对局零异常（声明不污染既有角色）', errs.length === 0, errs.slice(0, 2).join(' | '));

/* 未知角色进一步降级：声明表里完全没有的键也必须能跑（K1 第三层） */
const unknownDecl = RD.resolveDecl('neverDeclared');
ok('D3：完全未声明的角色解析为缺省声明（不抛错、注意力 1.0、无能力）',
  unknownDecl.undeclared === true && unknownDecl.attend && Object.keys(unknownDecl.attend).length === 0);

/* ---------- ⑤ 逐文件比对：除 roleDecl.js 外必须逐字节一致 ---------- */
const diffs = [];
(function compare(a, b, rel) {
  for (const e of fs.readdirSync(a, { withFileTypes: true })) {
    const sa = path.join(a, e.name), sb = path.join(b, e.name), r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { if (!fs.existsSync(sb)) { diffs.push(r + '（副本缺失目录）'); continue; } compare(sa, sb, r); }
    else {
      if (!fs.existsSync(sb)) { diffs.push(r + '（副本缺失）'); continue; }
      const ba = fs.readFileSync(sa), bb = fs.readFileSync(sb);
      if (!ba.equals(bb)) diffs.push(r);
    }
  }
})(SRC_JS, TMP_JS, '');
ok('H1（核心）：加角色后**唯一**被改动的文件是 v66/declaration/roleDecl.js',
  diffs.length === 1 && diffs[0] === 'v66/declaration/roleDecl.js', diffs.join(', '));

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nH1 加角色验收：通过 ${pass} 条、失败 ${fail} 条`);
process.exit(fail ? 1 : 0);
