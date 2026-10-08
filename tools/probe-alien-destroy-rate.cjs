'use strict';
/* ============================================================================
 * 异形破坏（destroy）率实测 —— 裁定③「记录在案即可」，故只量不改。
 *
 * 卡载（tools/card-audit.cjs CARD.alien）：
 *   「每夜出刀／感染／破坏／结茧四选一（破坏／结茧在步骤 4b，出刀／感染在步骤 7）」
 *   破坏配额：未进化 ＋1.5~2.0、破坏进化 ＋2.0~3.0（全局 1 次，触发停转夜）。
 *
 * 要回答的问题：4b 的四选一里，破坏实际被选中的比例是多少？
 * 此前对账报告记的是 {destroy:14, cocoon:82, none:368} ⇒ 破坏≈3%、结茧≈18%，
 * 结茧是破坏的 6 倍。本次在报数区（种子 241 起）重测，给出可复现的现值。
 *
 * 用法：node tools/probe-alien-destroy-rate.cjs <REPO_ROOT> [局数] [起始种子]
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || process.cwd();
const SeatMode = require(path.join(ROOT, 'tools', 'seat-mode.cjs'));
const N = +(process.argv[3] || 260);
const SEED0 = +(process.argv[4] || 241);

const src = fs.readFileSync(path.join(ROOT, 'tools', 'load-order.cjs'), 'utf8');
const m = { exports: {} };
new Function('require', 'module', 'exports', '__dirname', '__filename', src)(
  require, m, m.exports, path.join(ROOT, 'tools'), 'x');
const { makeCtx, loadInto, profiles } = m.exports;
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { Engine, Setup, AI } = ctx;

const tally = { destroy: 0, cocoon: 0, none: 0, noDispatch: 0 };
const byRole = {};
const perNightTotal = () => tally.destroy + tally.cocoon + tally.none;
let games = 0, errs = 0;
let gamesWithDestroy = 0, gamesWithCocoon = 0;

const origDecide = AI.decide;
AI.decide = function (g, req) {
  const res = origDecide.call(AI, g, req);
  try {
    if (!req || req.kind !== 'branch') return res;
    const p = g.players.find(x => x.id === req.pid);
    if (!p || p.role !== 'alien') return res;
    const b = res && res.branch;
    if (b === 'destroy' || b === 'cocoon' || b === 'none' || b == null) {
      const k = b == null ? 'none' : b;
      tally[k] = (tally[k] || 0) + 1;
      byRole[p.id] = byRole[p.id] || { destroy: 0, cocoon: 0, none: 0 };
      byRole[p.id][k]++;
    }
  } catch (e) { }
  return res;
};

for (let i = 0; i < N; i++) {
  try {
    const g = SeatMode.seatGame(Setup, SEED0 + i);
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    Engine.begin(g);
    let k = 0, sawDestroy = false, sawCocoon = false;
    while (!g.over && k < 5000) {
      k++;
      const before = JSON.stringify(Object.assign({}, tally));
      Engine.stepOnce(g);
      if (tally.destroy > JSON.parse(before).destroy) sawDestroy = true;
      if (tally.cocoon > JSON.parse(before).cocoon) sawCocoon = true;
      if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
    }
    if (sawDestroy) gamesWithDestroy++;
    if (sawCocoon) gamesWithCocoon++;
    games++;
  } catch (e) { errs++; }
}
AI.decide = origDecide;

const tot = perNightTotal();
const pct = n => tot ? (100 * n / tot).toFixed(1) + '%' : 'n/a';
const out = {
  games, errs, seedFrom: SEED0, seedTo: SEED0 + N - 1,
  seatMode: SeatMode.seatMode(),
  seatNote: '外星人席位有 50% 概率掷出死囚（convict）；那类局里没有经典外星人，'
    + '故 branch 决策分母与全经典局不同口径，读数必须与 seatMode 一起引用。',
  branchDecisions: tot,
  tally,
  share: { destroy: pct(tally.destroy), cocoon: pct(tally.cocoon), none: pct(tally.none) },
  ratioCocoonToDestroy: tally.destroy ? (tally.cocoon / tally.destroy).toFixed(2) : 'n/a',
  gamesWithDestroy, gamesWithCocoon,
  destroyPerGame: (gamesWithDestroy / (games || 1)).toFixed(2),
  note: '裁定③：记录在案即可，不改策略权重。改动前的观察是 destroy≈3%、结茧≈18%（结茧为破坏的 6 倍）。',
};
console.log(JSON.stringify(out, null, 1));
/* 产物按口径分流（tools/seat-mode.cjs）：经典口径沿用历史名，variants 加 -variants 后缀。
   写进 tools/ 是为了让 verify-handover-doc.cjs 能核对到 —— 铁律二：报出的数字必须能
   从落盘产物读出来。经典口径仍额外留一份 TEMP 副本（旧路径，勿删）。 */
try {
  const art = path.join(ROOT, 'tools', SeatMode.artifactFor('alien-destroy-rate-' + SEED0 + '-' + (SEED0 + N - 1)));
  fs.writeFileSync(art, JSON.stringify(out, null, 1));
  console.log('已写出 ' + art);
  fs.writeFileSync((process.env.TEMP || '.') + '/alien-destroy-rate.json', JSON.stringify(out, null, 1));
} catch (e) { }