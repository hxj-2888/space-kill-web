#!/usr/bin/env node
/* =============================================================
 * 太空杀 · 复盘叙事人审工具（叙事层 N1）
 *
 * 用途：跑若干局，对每局调 Narrator.chronicle → renderDoc，打印复盘文本供人工判读。
 *       同时报告「出口校验」与「纯读性」两项自检——两者是 narrator 的不可破约束，
 *       在批量尺度上复核一次（单局由 test-fix §24 断言把守）。
 *
 * 与 trace-game 的分工：trace-game 看**过程**（AI 每一步在想什么）；
 * 本工具看**事后**（系统把这局讲成什么故事）。
 *
 * 治理（docs/防指标博弈治理规范.md）：只读观察，不产出断言、不进 gate。
 *
 * 用法：
 *   node tools/replay-narrate.cjs              # 默认 10 局，种子 1-10
 *   node tools/replay-narrate.cjs 30 101       # 30 局，种子 101-130（验证区间）
 *   node tools/replay-narrate.cjs 1 7          # 打印种子 7 的完整复盘
 *   node tools/replay-narrate.cjs 20 --quiet   # 只报自检统计，不打文本
 * ============================================================= */
'use strict';
const path = require('path');
const { makeCtx, loadInto, profiles } = require('./load-order.cjs');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith('--')));
const nums = argv.filter(a => !a.startsWith('--'));
const N = parseInt(nums[0] || '10', 10);
const SEED0 = parseInt(nums[1] || '1', 10);
const QUIET = flags.has('--quiet');

const ctx = makeCtx({ RegExp });
loadInto(ctx, path.join(__dirname, '..', 'js'), profiles.full);
const { Setup, Engine, Narrator, Taboo } = ctx;

function play(seed) {
  const g = Setup.createGame(seed, 'random');
  g.humans = []; g.humanId = -1;                    // 全 AI（与 mc/sim 同口径）
  for (const p of g.players) p.isHuman = false;
  Engine.begin(g);
  let st = 0;
  while (!g.over && st++ < 5000) {
    Engine.stepOnce(g);
    if (g.pending) {
      const f = g.pending, d = { opt: null, targets: [], num: null, text: '' };
      if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) d.opt = u[0].v; }
      if (f.targets) { const l = Engine.alive(g); if (l.length) d.targets.push(l[0].id); }
      if (f.num) d.num = f.num.options[0].v;
      d.text = '';
      Engine.submit(g, d);
    }
  }
  return g;
}

/* 纯读性自检：序列化整个对局在 chronicle 前后是否逐字节一致 */
const snapshot = g => JSON.stringify({
  log: g.log.length, replay: g.replay.length, players: g.players.map(p => ({
    id: p.id, out: p.out, outNight: p.outNight, cause: p.cause, faction: p.faction, role: p.role,
    known: [...p.known.entries()].length, tE: [...((p.tEvents) || new Map()).entries()].map(([k, v]) => k + ':' + v.length),
  })),
  night: g.night, winner: g.winner, countdown: g.countdown, net10: g.net10,
});

let pureViolations = 0, notOver = 0, tabFail = 0, emptyChapters = 0;
const winners = {};

for (let i = 0; i < N; i++) {
  const seed = SEED0 + i;
  const g = play(seed);

  /* 约束②：未终局时必须返回 null（这里人为造一个中途态来验） */
  const mid = Setup.createGame(seed + 100000, 'random');
  mid.humans = []; mid.humanId = -1; for (const p of mid.players) p.isHuman = false;
  Engine.begin(mid);
  Engine.stepOnce(mid);
  if (Narrator.chronicle(mid) !== null) notOver++;

  const before = snapshot(g);
  const doc = Narrator.chronicle(g);
  const after = snapshot(g);
  if (before !== after) { pureViolations++; if (pureViolations <= 2) console.log(`  ⚠ 纯读性违例 seed=${seed}`); }

  winners[g.winner] = (winners[g.winner] || 0) + 1;
  if (!doc || !doc.nights.length) emptyChapters++;

  let text = '';
  try { text = Narrator.renderDoc(doc); }
  catch (e) { tabFail++; if (tabFail <= 2) console.log(`  ⚠ 出口校验抛错 seed=${seed}: ${e.message}`); }

  if (!QUIET || N <= 2) {
    console.log('\n' + '='.repeat(70));
    console.log(text || '（无输出）');
  }
}

console.log('\n' + '='.repeat(70));
console.log('自检汇总（' + N + ' 局，种子 ' + SEED0 + '–' + (SEED0 + N - 1) + '）');
console.log('  纯读性违例（chronicle 改动了对局）：' + pureViolations + '  ← 必须为 0');
console.log('  未终局却产出叙事：' + notOver + '  ← 必须为 0');
console.log('  出口校验抛错（Taboo checkClaim）：' + tabFail + '  ← 必须为 0');
console.log('  无章节的局：' + emptyChapters + '  ← 0 为正常（有夜必有事）');
console.log('  胜局分布：' + JSON.stringify(winners));
console.log('  ⚠ 观察侧工具：以上数字不进 gate；文本质量须人工判读。');