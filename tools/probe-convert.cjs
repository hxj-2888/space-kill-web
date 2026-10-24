/* =============================================================
 * 转化（5.5）决策探针：统计 convert 请求 / 决策(do:true) / 实际成功数。
 *
 * 背景（2026-10-24 批 2）：旧实现的「一夜产出」错接 threatTop 与全局 urg×50，
 * 门槛恒在收益差上限之上 —— 1252 次请求 0 成功（机制性不可达）。修复为
 * 同量纲比值判据后，用本探针验证可达性（对应疫苗制药修复用 brewDone 验收的先例）。
 *
 * 纪律：包装只透传（不新增任何 rng 消费、不读真相字段），p.alien.converts
 * 是引擎 run 侧自记的权威计数 —— 本探针只读不写，随机流零扰动。
 * 用法：node tools/probe-convert.cjs [对局数=60] [起始种子=1]
 * ============================================================= */
'use strict';
const path = require('path');
const { makeCtx, loadInto, profiles } = require('./load-order.cjs');
const SeatMode = require('./seat-mode.cjs');

const N = parseInt(process.argv[2] || '60', 10);
const SEED0 = parseInt(process.argv[3] || '1', 10);

const ctx = makeCtx();
loadInto(ctx, path.join(__dirname, '..', 'js'), profiles.full);
const { Setup, Engine } = ctx;

let reqCount = 0, doCount = 0;
const origDecide = ctx.AI.decide;
ctx.AI.decide = function (g, req) {
  if (req && req.kind === 'convert') {
    reqCount++;
    const r = origDecide(g, req);
    if (r && r.do) doCount++;
    return r;
  }
  return origDecide(g, req);
};

const wins = { human: 0, alien: 0, xeno: 0, draw: 0 };
let errs = 0, succTotal = 0, gamesWithSucc = 0, nights = 0;
const dirAfter = { destroy: 0, infect: 0, kill: 0 };

for (let i = 0; i < N; i++) {
  const seed = SEED0 + i;
  let g;
  try {
    g = SeatMode.seatGame(Setup, seed, 'random');
    g.humans = [];
    g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    Engine.begin(g);
    let steps = 0;
    while (!g.over && steps < 5000) { steps++; Engine.stepOnce(g); if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' }); }
    let succ = 0;
    for (const p of g.players) {
      const cv = (p.alien && p.alien.converts) || 0;
      if (cv) { succ += cv; succTotal += cv; }
      if (p.alien && p.alien.dir && dirAfter[p.alien.dir] != null) dirAfter[p.alien.dir]++;
    }
    if (succ) gamesWithSucc++;
    nights += g.night;
    wins[g.winner] = (wins[g.winner] || 0) + 1;
  } catch (e) {
    errs++;
    console.error('seed ' + seed + ' 异常: ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : String(e)));
  }
}

console.log('===== 转化（5.5）决策探针 =====');
console.log('对局 ' + N + '（种子 ' + SEED0 + '~' + (SEED0 + N - 1) + '）  异常 ' + errs);
console.log('convert 请求 ' + reqCount + ' 次 · 决策 do:true ' + doCount + ' 次 · 实际成功 ' + succTotal + ' 次（' + gamesWithSucc + '/' + N + ' 局至少一次）');
console.log('终局方向分布（异形）: ' + JSON.stringify(dirAfter));
console.log('胜负: ' + JSON.stringify(wins) + ' · 平均夜数 ' + (N ? (nights / N).toFixed(2) : '—'));
