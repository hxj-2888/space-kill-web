/* =============================================================
 * 通道库降级效用探针（第二十五批）
 *
 * 命题：「检查新推理机制（粒子云）的效用，并降级原通道——原通道不能再作为推理的首要素材」。
 *
 * 关键前提（先查清，否则整个命题会做错）：**云与通道库不是互斥替代关系**。
 *   云臂的输入是 `p.tEvents`（AI 私有证据台账），而通道库正往 tEvents 写 universal 证据
 *   （消融实测：200 局 1186 条）。⇒ 停掉通道，云的输入也变少。所以「降级通道」不能靠
 *   读数断言，必须做**真消融**；且不能用「删代码」的方式验证。
 *
 * 方法：三档各自**独立沙箱**（每档重新 loadInto，避免 gate 注册表被清空后不可恢复），
 *   同种子 501–700（验证集，与指纹 1–200 / 调试 1–100 零重叠），各跑 N 局：
 *     档位 full —— 现状（通道全程运行）
 *     档位 late —— **降级档（默认）**：仅存活≤6 或第 6 夜及以后运行，开局/中期不跑
 *     档位 off  —— 全关（对照）
 *   每档读两个分数：旧累加器 suspOf、云 hostile100。
 *
 * 治理规范：指标只读不进 gate（铁律一）；如实报告恶化项（铁律五）；
 *   「回到随机线以上」≠「具备推理能力」；主判据＝非异形观察者 AUC（human/xeno 分列，禁 pooled）。
 * ============================================================= */
const path = require('path');
const { makeCtx, loadInto, profiles } = require('./load-order.cjs');

const N = parseInt(process.argv[2] || '200', 10);
const SEED0 = parseInt(process.argv[3] || '501', 10);
const BASE = path.join(__dirname, '..', 'js');

const ROLE2FACTION = {};
function mkctx(mode) {
  const ctx = makeCtx({ RegExp });
  loadInto(ctx, BASE, profiles.full);
  ctx.SK_CHAN_MODE = mode;                      // 注入档位（沙箱内读不到 process.env）
  for (const k of ctx.SKRoleDecl.keys()) ROLE2FACTION[k] = ctx.SKRoleDecl.ROLE_DECL[k].faction;
  return ctx;
}
function knownLockOf(ctx, p, id) {
  const k = p.known.get(id);
  if (!k || k.viaPrivate) return null;
  if (k.role && ROLE2FACTION[k.role]) return ROLE2FACTION[k.role];
  if (k.faction && ctx.SKData.FACTION[k.faction]) return k.faction;
  return null;
}
function auc(s) {
  const pos = [], neg = [];
  for (const x of s) (x.label === 1 ? pos : neg).push(x.score);
  if (!pos.length || !neg.length) return null;
  pos.sort((a, b) => a - b); neg.sort((a, b) => a - b);
  let u = 0, j = 0;
  for (const p of pos) {
    while (j < neg.length && neg[j] < p) j++;
    let k = j, eq = 0;
    while (k < neg.length && neg[k] === p) { k++; eq++; }
    u += j + eq * 0.5;
  }
  return u / (pos.length * neg.length);
}
const A = v => v == null ? '  —  ' : v.toFixed(3);

const MODES = ['full', 'late', 'off'];
const R = {};                                   // R[mode] = {susp,cloud} × {all,human,xeno} + PH + top + 用量
for (const m of MODES) R[m] = {
  susp: { all: [], human: [], xeno: [] }, cloud: { all: [], human: [], xeno: [] },
  PH: { open: { susp: [], cloud: [] }, mid: { susp: [], cloud: [] }, late: { susp: [], cloud: [] } },
  top: { susp: [0, 0], cloud: [0, 0] }, eval: 0, uni: 0, own: 0, err: 0, nightSum: 0, expSum: 0,
};

for (const mode of MODES) {
  const ctx = mkctx(mode);
  const { Setup, Engine, AI, SKCloud, SKData } = ctx;
  const r = R[mode];
  for (let i = 0; i < N; i++) {
    const g = Setup.createGame(SEED0 + i, 'random');
    g.humans = []; g.humanId = -1;
    try {
      Engine.begin(g);
      let steps = 0, sampled = 0;
      const topBy = {};
      while (!g.over && steps < 4000) {
        Engine.stepOnce(g); steps++;
        if (g.step === '9' && g.night >= 1 && g.night > sampled && !g.pending) {
          sampled = g.night;
          const ph = g.night <= 2 ? 'open' : g.night <= 5 ? 'mid' : 'late';
          for (const v of g.players) {
            if (v.out) continue;
            const hostile = SKData.FACTION[v.faction].hostileTo;
            for (const t of g.players.filter(p => !p.out && p.id !== v.id)) {
              const label = hostile.indexOf(t.faction) >= 0 ? 1 : 0;
              const so = AI.suspOf(g, v, t.id);
              const cl = SKCloud.fromEvents(v.faction, v.tEvents.get(t.id) || [], { nowNight: g.night });
              const kl = knownLockOf(ctx, v, t.id);
              if (kl) SKCloud.collapse(cl, kl);
              const sc = SKCloud.hostile100(cl, v.faction);
              for (const k of ['susp', 'cloud']) {
                const rec = { score: k === 'susp' ? so : sc, label };
                r[k].all.push(rec); r.PH[ph][k].push(rec);
                if (v.faction === 'human') r[k].human.push(rec);
                else if (v.faction === 'xeno') r[k].xeno.push(rec);
                (topBy[v.id + '|' + k] = topBy[v.id + '|' + k] || []).push(rec);
              }
            }
          }
        }
      }
      for (const key of Object.keys(topBy)) {
        const k = key.split('|')[1];
        const arr = topBy[key].sort((a, b) => b.score - a.score);
        if (arr.length && arr[0].label === 1) r.top[k][0]++;
        r.top[k][1]++;
      }
      if (g._chanEval) for (const k of Object.keys(g._chanEval)) r.eval += g._chanEval[k];
      for (const p of g.players) {
        if (!p.tEvents) continue;
        for (const arr of p.tEvents.values()) for (const e of arr) {
          const s = String((e && e.src) || '');
          if (s.indexOf('chan:') === 0) r.uni++;
          else if (s.indexOf('own:') === 0) r.own++;
        }
      }
      r.nightSum += g.night; r.expSum += (g.players || []).filter(p => !p.out).length;
    } catch (e) { r.err++; }
  }
}

const main = (m, k) => auc(R[m][k].human.concat(R[m][k].xeno));
const top = (m, k) => { const t = R[m].top[k][1]; return t ? (100 * R[m].top[k][0] / t).toFixed(1) + '%' : '—'; };

console.log('=== 通道库降级效用探针（指标只读，不进任何 gate）===');
console.log(`每档 ${N} 局，种子 ${SEED0}~${SEED0 + N - 1}（验证集段，与指纹 1–200 / 调试 1–100 零重叠）`);
console.log('三档各自独立沙箱，同种子对照；档位经 ctx.SK_CHAN_MODE 注入（沙箱读不到 process.env）\n');

console.log('— 主判据：非异形观察者 AUC（human / xeno 分列，禁 pooled）—');
console.log('  档位        旧累加器                              云');
for (const m of MODES)
  console.log('  ' + m.padEnd(9) +
    A(auc(R[m].susp.human)) + ' / ' + A(auc(R[m].susp.xeno)) + '  ＝ ' + A(main(m, 'susp')) +
    '        ' + A(auc(R[m].cloud.human)) + ' / ' + A(auc(R[m].cloud.xeno)) + '  ＝ ' + A(main(m, 'cloud')));

console.log('\n— 辅判据：分阶段（旧累加器 / 云）—');
for (const p of ['open', 'mid', 'late'])
  console.log('  [' + p.padEnd(5) + '] ' + MODES.map(m => m + ' ' + A(auc(R[m].PH[p].susp)) + '/' + A(auc(R[m].PH[p].cloud))).join('   '));

console.log('\n— top1 是否真为敌方（按观察者取最高分目标）—');
for (const m of MODES) console.log('  ' + m.padEnd(9) + '旧 ' + top(m, 'susp') + '   云 ' + top(m, 'cloud'));

console.log('\n— 机制用量（降级是否真的生效）—');
console.log('  档位        gate 求值      universal 证据   own: 私有证据   平均夜数   平均存活');
for (const m of MODES)
  console.log('  ' + m.padEnd(9) + String(R[m].eval).padStart(10) + String(R[m].uni).padStart(15) +
    String(R[m].own).padStart(15) + (R[m].nightSum / N).toFixed(2).padStart(12) + (R[m].expSum / N).toFixed(2).padStart(11));

console.log('\n— 结论数据 —');
const dAUC = main('full', 'susp') - main('late', 'susp');
const dTop = parseFloat(top('full', 'susp')) - parseFloat(top('late', 'susp'));
console.log('  通道库边际贡献（full − late，旧累加器主判据）＝ ' + dAUC.toFixed(3));
console.log('  降级对 top1 的影响（full − late）　　　　　　　＝ ' + dTop.toFixed(1) + 'pp（正＝降级后更高）');
console.log('  降级后通道运行量　　　　　　　　　　　　　　＝ ' + (100 * R.late.eval / (R.full.eval || 1)).toFixed(0) + '%（full 基准）');
console.log('  云在 late 档的主判据　　　　　　　　　　　　　＝ ' + A(main('late', 'cloud')) + '（判定门 0.55 ⇒ ' + (main('late', 'cloud') >= 0.55 ? '达标' : '未达标') + '）');
console.log('  ⚠ 治理规范：以上数字只进报告，不作任何 gate；「回到随机线以上」≠「具备推理能力」。');
