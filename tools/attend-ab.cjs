#!/usr/bin/env node
/* =============================================================
 * 太空杀 · 注意力系数标定探针（批次 34）
 *
 * 用途：对 ATTEND 的两类系数做**单变量 A/B**——一次只动一个，其余固定——
 *       读「非异形观察者 AUC」与其分阶段细分，按验证集（种子 101-500）出数。
 *
 * 治理纪律（docs/防指标博弈治理规范.md）：
 *   · 指标**只读不进 gate**：本工具产出数字，不产出断言；
 *   · **单变量**：一次只调一族/一个参数，禁止多变量同时动（否则归因不可分）；
 *   · **分阵营读数**：主判据为非异形观察者（human / xeno 分列，alien 组因私有队友
 *     硬锁优势不作判据，仅列作对照）；
 *   · **种子隔离**：验证集 101-500，与指纹集（1-200）零重叠 ⇒ 标定不得回灌指纹集；
 *   · **如实报告恶化项**：三项皆变坏亦照实列出，不择优汇报。
 *
 * 用法：
 *   node tools/attend-ab.cjs                     # 基线读数（当前系数）
 *   node tools/attend-ab.cjs floor 0.85          # 单变量：改 floor 闸门
 *   node tools/attend-ab.cjs away 0.6            # 单变量：整体 away 系数
 *   node tools/attend-ab.cjs main 1.2            # 单变量：整体主业系数
 *   node tools/attend-ab.cjs 200 floor 0.9       # 指定局数与变量
 * ============================================================= */
'use strict';
const path = require('path');
const { makeCtx, loadInto, profiles } = require('./load-order.cjs');

const argv = process.argv.slice(2);
const N = parseInt(argv[0] || '120', 10);
const VAR = argv[1] || null;            // 'floor' | 'away' | 'main'
const VAL = argv[2] != null ? parseFloat(argv[2]) : null;
const SEED0 = 101;                      // D4：验证集 101-500

const ctx = makeCtx({ RegExp });
loadInto(ctx, path.join(__dirname, '..', 'js'), profiles.full);
const { Setup, Engine, AI, SKRoleDecl: RD } = ctx;

/* ---------- 应用单变量覆写（只动一处） ---------- */
const ORIG = {
  floor: RD.attendFloor,
  away: JSON.parse(JSON.stringify({})),
  main: null,
};
for (const k of RD.keys()) {
  const d = RD.ROLE_DECL[k];
  if (d && d.attend) for (const [f, v] of Object.entries(d.attend)) ORIG.main = ORIG.main || {}, ORIG.main[k + '.' + f] = v;
  if (d && d.attendAway) for (const [f, v] of Object.entries(d.attendAway)) ORIG.away[k + '.' + f] = v;
}

if (VAR === 'floor') {
  /* floor 是声明层常量（roleDecl.ATTEND_FLOOR），读取方为 Tiers.attendFloor()。
     覆写点必须打在**读取方**上——Tiers 已在此之前完成求值，直接改 roleDecl 的导出
     属性不会影响 Tiers 内部已绑定的引用（首版探针即栽在此，读数两臂全同）。 */
  ctx.Tiers.attendFloor = () => VAL;
} else if (VAR === 'away' && VAL != null) {
  for (const k of RD.keys()) {
    const d = RD.ROLE_DECL[k];
    if (!d || !d.attendAway) continue;
    for (const f of Object.keys(d.attendAway)) d.attendAway[f] = VAL;
  }
} else if (VAR === 'main' && VAL != null) {
  for (const k of RD.keys()) {
    const d = RD.ROLE_DECL[k];
    if (!d || !d.attend) continue;
    for (const f of Object.keys(d.attend)) d.attend[f] = VAL;
  }
}

/* Mann-Whitney AUC（与 mc.cjs / trace-game 同式，保证读数可比） */
function auc(pos, neg) {
  if (!pos.length || !neg.length) return null;
  const all = pos.map(s => ({ s, p: 1 })).concat(neg.map(s => ({ s, p: 0 }))).sort((a, b) => a.s - b.s);
  let r = 1, rankSumPos = 0, i = 0;
  while (i < all.length) {
    let j = i; while (j < all.length && all[j].s === all[i].s) j++;
    const avg = r + (j - i - 1) / 2;
    for (let k = i; k < j; k++) if (all[k].p) rankSumPos += avg;
    r += j - i; i = j;
  }
  const n1 = pos.length, n0 = neg.length;
  return (rankSumPos - n1 * (n1 + 1) / 2) / (n1 * n0);
}
const phaseOf = n => (n <= 3 ? '开局' : n <= 5 ? '中期' : '残局');
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const f3 = v => (v == null ? '—' : v.toFixed(3));

const buf = { human: { 开局: [], 中期: [], 残局: [] }, alien: [], xeno: [] };
const win = { human: 0, alien: 0, xeno: 0, draw: 0 };
let errs = 0;

for (let i = 0; i < N; i++) {
  try {
    const g = Setup.createGame(SEED0 + i, 'random');
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    Engine.begin(g);
    let steps = 0, lastNight = -1;
    while (!g.over && steps < 5000) {
      steps++;
      Engine.stepOnce(g);
      if (g.pending) {
        const fm = g.pending, d = { opt: null, targets: [], num: null, text: '' };
        if (fm.opts) { const u = fm.opts.filter(o => !o.disabled); if (u.length) d.opt = u[0].v; }
        if (fm.targets) { const al = Engine.alive(g); if (al.length) d.targets.push(al[0].id); }
        if (fm.num) d.num = fm.num.options[0].v;
        d.text = '';
        Engine.submit(g, d);
      }
      if (g.night !== lastNight && g.night >= 1) {
        lastNight = g.night;
        const al = Engine.alive(g);
        /* 每名观察者一次取「pos 全集 vs neg 全集」的 AUC（mc.cjs 口径：逐夜逐观察者一个值），
           而非逐对采样——逐对会把 pos/neg 各限成单元素，AUC 恒为 null。 */
        for (const p of al) {
          const others = al.filter(x => x.id !== p.id);
          let pos, neg;
          if (p.faction === 'human') { pos = others.filter(y => y.faction !== 'human'); neg = others.filter(y => y.faction === 'human'); }
          else if (p.faction === 'alien') { pos = others.filter(y => y.faction === 'human'); neg = others.filter(y => y.faction === 'xeno'); }
          else { pos = others.filter(y => y.faction === 'alien'); neg = others.filter(y => y.faction === 'human'); }
          if (!pos.length || !neg.length) continue;
          const a = auc(pos.map(y => AI.suspOf(g, p, y.id)), neg.map(y => AI.suspOf(g, p, y.id)));
          if (a == null || !isFinite(a)) continue;
          if (p.faction === 'human') buf.human[phaseOf(g.night)].push(a);
          else buf[p.faction].push(a);
        }
      }
    }
    win[g.winner] = (win[g.winner] || 0) + 1;
  } catch (e) { errs++; }
}

const humanAll = buf.human.开局.concat(buf.human.中期, buf.human.残局);
const nonAlien = humanAll.concat(buf.xeno);
console.log('=== 注意力系数标定探针（验证集 ' + SEED0 + '-' + (SEED0 + N - 1) + '，' + N + ' 局，异常 ' + errs + '）===');
console.log('  变量：' + (VAR ? VAR + '=' + VAL : '基线（当前系数）'));
console.log('  —— 主判据：非异形观察者 AUC（human 分阶段 + xeno；alien 仅作对照）——');
console.log('    human 开局    ' + f3(mean(buf.human.开局)));
console.log('    human 中期    ' + f3(mean(buf.human.中期)));
console.log('    human 残局    ' + f3(mean(buf.human.残局)));
console.log('    human 合计    ' + f3(mean(humanAll)));
console.log('    xeno          ' + f3(mean(buf.xeno)));
console.log('    非异形合计    ' + f3(mean(nonAlien)) + '   ← 主判据');
console.log('    [对照] alien  ' + f3(mean(buf.alien)) + '   （私有队友硬锁优势，不作判据）');
console.log('  胜局分布：' + JSON.stringify(win));
console.log('  ⚠ 指标只读不进 gate；标定不得使用指纹集（1-200），本工具固定用 101+。');