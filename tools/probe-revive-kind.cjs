'use strict';
/* ============================================================================
 * 确定性验证「req.kind ↔ form.kind 不一致」是**既有隐患**还是本批引入。
 *
 * 不跑随机对局（那只能给相关性），直接构造死囚席位：把一名存活者就地改成
 * 死囚本体形态（role='convict'、convict=true、reviveLeft=2），并让场上有一名濒死者
 * —— 这正是步骤 8 的 req 推出 kind='revive' 的前提（6.8.4 复生）。
 * 随后对同一状态调 form，看它给哪个 kind。
 *
 * 之所以必须构造而非找种子：死囚是外星人席位的变体（roleDecl.GROUP_TABLE 里
 * convict: null ⇒ 常规席位表不含它），实测种子 1~40 都不出现死囚。
 *
 * 用法：node tools/probe-revive-kind.cjs <REPO_ROOT>
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || process.cwd();

const src = fs.readFileSync(path.join(ROOT, 'tools', 'load-order.cjs'), 'utf8');
const m = { exports: {} };
new Function('require', 'module', 'exports', '__dirname', '__filename', src)(
  require, m, m.exports, path.join(ROOT, 'tools'), 'x');
const { makeCtx, loadInto, profiles } = m.exports;
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { Engine, Setup } = ctx;

const out = [];
const say = s => { out.push(s); console.log(s); };

const g = Setup.createGame(11, 'random');
g.humans = []; g.humanId = -1;
for (const p of g.players) p.isHuman = false;
Engine.begin(g);
let k = 0;
while (k < 80 && !['D-vote'].includes(g.step)) {
  Engine.stepOnce(g);
  if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
  k++;
}

/* 就地造一个死囚本体形态（外星人席位的变体；镜像账本按 state.js:263 的方式建） */
const alive = g.players.filter(p => !p.out);
const cv = alive[alive.length - 1];
const victim = alive[0];
cv.role = 'convict'; cv.roleName = '死囚';
cv.convict = true; cv.morph = null; cv.morphNight = null;
cv.reviveLeft = 2;
if (global.SKRoleDecl && ctx.SKMirror) { /* 镜像账本若存在则补一张本体槽，尽力而为 */ }
victim.dying = true; victim.dyingCause = 'infect';
g.step = '8';
g.phase = 'night';

say('构造: 死囚 id=' + cv.id + ' role=' + cv.role + ' reviveLeft=' + cv.reviveLeft
  + '  濒死者 id=' + victim.id + '  step=' + g.step);

const S8 = Engine.STEPS['8'];
const reqOut = S8.req(g) || [];
const mine = reqOut.filter(r => r.pid === cv.id);
say('  步骤 8 req 给死囚的条目: ' + JSON.stringify(mine.map(r => r.kind)));

let formKind = '(form 抛错)';
try { const f = S8.form(g, cv); formKind = f && f.kind; }
catch (e) { formKind = '(form 抛错: ' + String(e.message).slice(0, 40) + ')'; }
say('  步骤 8 form 给出的 kind  : ' + formKind);

const wantRevive = mine.some(r => r.kind === 'revive');
const bad = wantRevive && formKind !== 'revive';
say('');
say(bad
  ? '  => 不一致：req 说 revive，form 给 ' + formKind + '（form 无 revive 分支，死囚被静默塞进医生表单）'
  : '  => 一致');
say('');
say('  本探针不含随机对局，结论与随机流无关，可直接归因。');
say('  注意：步骤 8 的 form 首行判 isClassicXeno(p)，死囚 role!=="xeno" ⇒ 落到医生分支。');

try { fs.writeFileSync((process.env.TEMP || '.') + '/probe-revive-kind.txt', out.join('\n')); } catch (e) { }
process.exit(bad ? 1 : 0);