/* =============================================================
 * 太空杀 · 行为等价指纹（重构安全网）
 *
 * 用途：任何「不改行为」的模块化 / 解耦 / 搬移，都必须满足
 *       「逐局指纹与基线一致」。指纹含两部分：
 *         ① 结局线：winner / 阶段 / 夜数 / 驱逐序 / 死因序 / 停摆档
 *         ② 状态摘要：每夜对全体存活观察者×存活目标采样
 *            suspDist(p_human,p_alien,p_king) 与 dangerOf（6 位小数）
 *            → 估值数学只要动了一位小数就会爆红
 *
 * 用法：node tools/fingerprint.cjs [对局数] [起始种子] [输出文件]
 * 输出：控制台打印总哈希；结果写 ../.tmp_docs/fingerprint.json
 * ============================================================= */
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { profiles, makeCtx, loadInto } = require('./load-order.cjs');

const N = parseInt(process.argv[2] || '200', 10);
const SEED0 = parseInt(process.argv[3] || '1', 10);
const OUT = process.argv[4] || path.join(__dirname, '..', '..', '.tmp_docs', 'fingerprint.json');

const base = path.join(__dirname, '..', 'js');
const ctx = makeCtx({ RegExp });
loadInto(ctx, base, profiles.full);
const { Setup, Engine, AI, MoE } = ctx;

const ghash = createHash('sha256');
const lines = [];
let errs = 0, stateSamples = 0;

function stream(str) { ghash.update(str); }

for (let i = 0; i < N; i++) {
  const seed = SEED0 + i;
  let line;
  try {
    const g = Setup.createGame(seed, 'random');
    g.humans = [];
    g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    Engine.begin(g);

    /* 状态摘要：每夜采样一次（与 mc.cjs 的采样时机一致） */
    const stateParts = [];
    let lastNight = -1;
    let steps = 0;
    while (!g.over && steps < 5000) {
      steps++;
      Engine.stepOnce(g);
      if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
      if (g.night !== lastNight) {
        lastNight = g.night;
        const al = g.players.filter(p => !p.out);
        for (const p of al) {
          if (p.isHuman) continue;
          for (const x of al) {
            if (x.id === p.id) continue;
            const d = AI.suspDist(g, p, x.id);
            stateParts.push(
              'N' + g.night + '.' + p.id + '>' + x.id + ':' +
              d.p_human.toFixed(6) + ',' + d.p_alien.toFixed(6) + ',' + d.p_king.toFixed(6) + ':' +
              AI.dangerOf(g, p, x.id).toFixed(6));
          }
        }
        stateSamples += stateParts.length;
      }
    }

    const outs = g.players.filter(p => p.out)
      .sort((a, b) => (a.outNight || 0) - (b.outNight || 0) || a.id - b.id)
      .map(p => `${p.id}/${p.outType || '-'}/${p.outNight || 0}/${p.cause || '-'}`).join(',');
    const stateHash = createHash('sha256').update(stateParts.join('|')).digest('hex').slice(0, 16);
    const evTotal = g.players.reduce((s, p) => s + [...((p.tEvents) || new Map()).values()].reduce((a, ev) => a + ev.length, 0), 0);
    line = [
      'seed=' + seed,
      'winner=' + g.winner,
      'phase=' + (g.extinction ? '寂灭' : g.duel ? '决斗' : '常规'),
      'night=' + g.night,
      'tiers=' + [3, 6, 9].map(k => (g.tiers[k] ? 1 : 0)).join(''),
      'log=' + g.log.length,
      'tev=' + evTotal,
      'chan=' + ((g._chanFired && g._chanFired.size) || 0),
      'shadow=' + (MoE && MoE.stats && MoE.stats.shadow ? MoE.stats.shadow.calls + '/' + MoE.stats.shadow.applied : '-'),
      'state=' + stateHash,
      'outs=' + (outs || '无'),
    ].join(' ');
    stream(line + '\n');
    lines.push(line);
  } catch (e) {
    errs++;
    line = 'seed=' + seed + ' ERROR ' + (e && e.message);
    stream(line + '\n');
    lines.push(line);
    if (errs <= 3) console.log('  [异常] ' + line);
  }
}

const hash = ghash.digest('hex');
try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (e) {}
fs.writeFileSync(OUT, JSON.stringify({ N, SEED0, hash, errs, stateSamples, lines }, null, 1));
console.log(JSON.stringify({ N, SEED0, hash, errs, stateSamples, out: OUT }, null, 2));
