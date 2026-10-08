'use strict';
/* ============================================================================
 * 角色差异化量测：voice 接入后，每个角色是否真的有了「自己的想法和发言」
 * 口径（全部可独立复核）：
 *   ① 发言形状分布：按 Bridge.say 捕获的实际文本，按角色分组
 *   ② 角色间发言重叠：任意两角色共享的句子数（越高＝越同质）
 *   ③ 话题命中率：AIVoice.thought 返回非 null 的比例（按角色）——「有料可说」的程度
 *   ④ 心声分布：各角色最常引用的 duty.senses 键（是否真的在用自己独有的情报）
 *   ⑤ 关键约束核对：异形是否泄露队友（claim 必须为 null）
 * 用法：node tools/voice-probe.cjs <REPO_ROOT> [局数] [起始种子] [输出json]
 * ==========================================================================*/
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || process.cwd();
const SeatMode = require(path.join(ROOT, 'tools', 'seat-mode.cjs'));
const N = +(process.argv[3] || 120);
const SEED0 = +(process.argv[4] || 1);
const OUTF = process.argv[5] || null;

function loadOrder(root) {
  const src = fs.readFileSync(path.join(root, 'tools', 'load-order.cjs'), 'utf8');
  const m = { exports: {} };
  new Function('require', 'module', 'exports', '__dirname', '__filename', src)(
    require, m, m.exports, path.join(root, 'tools'), 'x');
  return m.exports;
}
const { makeCtx, loadInto, profiles } = loadOrder(ROOT);
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { AI, Engine, Setup, Bridge } = ctx;
const RD = ctx.SKRoleDecl;

const S = {
  games: 0, errs: 0, errMsgs: {},
  linesByRole: {},                       // 角色 → { 句子: 次数 }
  allLines: {},
  thoughtCalls: 0, thoughtHit: 0,
  senseUsed: {},                         // 角色 → { sense: 次数 }
  thoughtByRole: {},                     // 角色 → {hit,total}
  topicHasMaterial: {},                  // sense → 次数（不短路探测下确有素材）
  topicProbeCalls: {},                   // sense → 探测次数
  alienLeak: 0, alienClaims: 0, alienGuardDone: false, alienGuardSample: null,
  hedgeUsed: 0,
};
const origSay = Bridge.say;
Bridge.say = function (g, pid, text, opts) {
  const r = origSay.apply(this, arguments);
  try {
    const p = g.players.find(x => x.id === pid);
    const rk = (p && p.role) || '?';
    const t = String(text || '').trim();
    if (t) {
      S.linesByRole[rk] = S.linesByRole[rk] || {};
      S.linesByRole[rk][t] = (S.linesByRole[rk][t] || 0) + 1;
      S.allLines[t] = (S.allLines[t] || 0) + 1;
      const lt = p && p._lastThought;
      if (lt && lt.sense) {
        S.senseUsed[rk] = S.senseUsed[rk] || {};
        S.senseUsed[rk][lt.sense] = (S.senseUsed[rk][lt.sense] || 0) + 1;
      }
      if (p && p._lastThought && p._lastThought.hedged) S.hedgeUsed++;
    }
  } catch (e) { }
  return r;
};

const origThought = ctx.AIVoice.thought;
ctx.AIVoice.thought = function (g, p, opts) {
  S.thoughtCalls++;
  let v = null;
  try { v = origThought.call(ctx.AIVoice, g, p, opts); } catch (e) { v = null; }
  const rk = (p && p.role) || '?';
  S.thoughtByRole[rk] = S.thoughtByRole[rk] || { hit: 0, total: 0 };
  S.thoughtByRole[rk].total++;
  /* 不短路探测：逐个情报面看「到底有没有素材」。这能把「零命中」拆成两种性质不同的
     情况 —— 有素材却没排到它（被前序话题遮挡）vs 压根没素材（载体引擎从未写入）。
     thought() 自己短路，所以单看它的命中率无法区分这两者。 */
  try {
    const all = ctx.AIVoice.probeAll ? ctx.AIVoice.probeAll(g, p) : null;
    if (all) for (const k of Object.keys(all)) {
      S.topicProbeCalls[k] = (S.topicProbeCalls[k] || 0) + 1;
      if (all[k] === 'hasMaterial') S.topicHasMaterial[k] = (S.topicHasMaterial[k] || 0) + 1;
    }
  } catch (e) { }
  if (v) {
    S.thoughtByRole[rk].hit++;
    S.thoughtHit++;
    /* 关键约束：异形的队友类话题不得产出宣称 */
    if (p && p.faction === 'alien' && (v.sense === 'teammateIdentities' || v.sense === 'teammateBallots')) {
      S.alienLeak++;
      if (v.claimKind) S.alienClaims++;
    }
  }
  return v;
};

for (let i = 0; i < N; i++) {
  try {
    const g = SeatMode.seatGame(Setup, SEED0 + i);
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    Engine.begin(g);
    let k = 0;
    while (!g.over && k < 5000) {
      k++; Engine.stepOnce(g);
      if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
      /* 异形队友话题的守卫：speak 层对非人类不走 voice（各层职责不重叠），
         故显式走 allowNonHuman 入口验证「该话题存在、且不产出任何宣称」。 */
      if (!S.alienGuardDone && g.step === 'D-talk') {
        for (const al of g.players.filter(x => x.faction === 'alien' && !x.out)) {
          const v = origThought.call(ctx.AIVoice, g, al, { allowNonHuman: true });
          if (v && (v.sense === 'teammateIdentities' || v.sense === 'teammateBallots')) {
            S.alienGuardDone = true;
            S.alienLeak++;
            if (v.claimKind) S.alienClaims++;
            S.alienGuardSample = { sense: v.sense, line: v.line };
          }
        }
      }
    }
    S.games++;
  } catch (e) { S.errs++; S.errMsgs[String(e.message).slice(0, 50)] = 1; }
}
Bridge.say = origSay;
ctx.AIVoice.thought = origThought;

/* ---- ② 角色间句子重叠矩阵（只在两个角色都发过 ≥20 句时计）---- */
const roles = Object.keys(S.linesByRole);
const overlap = [];
for (let i = 0; i < roles.length; i++) {
  for (let j = i + 1; j < roles.length; j++) {
    const a = S.linesByRole[roles[i]], b = S.linesByRole[roles[j]];
    const na = Object.values(a).reduce((x, y) => x + y, 0);
    const nb = Object.values(b).reduce((x, y) => x + y, 0);
    if (na < 20 || nb < 20) continue;
    const shared = Object.keys(a).filter(t => b[t]);
    if (!shared.length) continue;
    const worst = shared.map(t => [t, a[t], b[t]]).sort((x, y) => (y[1] + y[2]) - (x[1] + x[2]))[0];
    overlap.push({
      a: roles[i], b: roles[j], shared: shared.length,
      worstLine: worst[0].slice(0, 40), worstA: worst[1], worstB: worst[2],
    });
  }
}
overlap.sort((x, y) => (y.worstA + y.worstB) - (x.worstA + x.worstB));

/* ---- ① 各角色发言形状 Top3 ---- */
const topN = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n)
  .map(([t, c]) => ({ line: t.slice(0, 46), n: c }));

const out = {
  games: S.games, errs: S.errs, errMsgs: S.errMsgs,
  thought: {
    calls: S.thoughtCalls, hit: S.thoughtHit,
    hitRate: (100 * S.thoughtHit / (S.thoughtCalls || 1)).toFixed(1) + '%',
    byRole: S.thoughtByRole,
  },
  alienLeakGuard: { teammateTopicHits: S.alienLeak, ofWhichProducedClaim: S.alienClaims, sample: S.alienGuardSample },
  speechByRole: Object.fromEntries(Object.keys(S.linesByRole).map(r => [
    r, { total: Object.values(S.linesByRole[r]).reduce((x, y) => x + y, 0),
         unique: Object.keys(S.linesByRole[r]).length,
         diversity: (100 * Object.keys(S.linesByRole[r]).length /
           (Object.values(S.linesByRole[r]).reduce((x, y) => x + y, 0) || 1)).toFixed(1) + '%',
         top: topN(S.linesByRole[r], 3) },
  ])),
  senseUsage: S.senseUsed,
  overlapTop: overlap.slice(0, 12),
  /* 逐话题：本批是否至少命中过一次（true ⇒ 本批零命中，载体可能从未被引擎写入） */
  topicCoverage: ctx.AIVoice.topicCoverage ? ctx.AIVoice.topicCoverage() : 'notCollected',
  /* 零命中的性质拆分（不短路探测）：
       素材数 > 0 而「零命中」为 true ⇒ 被**前序话题遮挡**，载体是活的（排序问题）；
       素材数 = 0                   ⇒ **载体引擎从未写入**，是真缺陷（需补引擎）。 */
  topicZeroCause: (() => {
    const cov = ctx.AIVoice.topicCoverage ? ctx.AIVoice.topicCoverage() : {};
    const o = {};
    for (const k of Object.keys(cov)) {
      if (!cov[k]) continue;
      const probed = S.topicProbeCalls[k] || 0, has = S.topicHasMaterial[k] || 0;
      let cause;
      if (has > 0) cause = 'shadowedByEarlierTopic';       // 素材在，只是排序没轮到
      else if (!has && !probed) cause = 'neverProbed';     // probeAll 未覆盖到该键
      else cause = 'noMaterialInThisLayer';               // 本层确实取不到料
      o[k] = { probed, hasMaterial: has, cause };
      if (cause === 'shadowedByEarlierTopic')
        o[k].note = '载体是活的，属排序问题，不是缺陷';
      else if (cause === 'noMaterialInThisLayer')
        o[k].note = '本层取不到料：需查是载体未写入，还是信息窗与消费窗不重叠';
    }
    return Object.keys(o).length ? o : 'noZeroHitTopics';
  })(),
  /* 显式声明「本层无消费者」的情报面（须带 reason，否则 auditTopics 会拦） */
  topicsNotApplicable: (() => {
    const T = ctx.AIVoice._SENSE_TOPIC || {};
    const o = {};
    for (const k of Object.keys(T)) if (T[k].notApplicable)
      o[k] = T[k].notApplicable;
    return Object.keys(o).length ? o : 'none';
  })(),
  globalUniqueLines: Object.keys(S.allLines).length,
  globalTotalLines: Object.values(S.allLines).reduce((x, y) => x + y, 0),
};
if (OUTF) fs.writeFileSync(OUTF, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));