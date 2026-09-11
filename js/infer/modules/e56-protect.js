/* =============================================================
 * 太空杀 · 证据域模块 E5/E6：保护结算族（N401 维修暴露 / N406 濒死对账）
 *
 * 资产出处：v31 批 3.5 人类侧保护专项 N401~N407（《增补第二十二章》）。
 * 效用档位：A（两条都是 100 局触发破百的主力）。
 * 依赖：无跨域谓词（判据各自独立）。
 * ============================================================= */
(function (global) {
  const P = global.SKPred;

  /* --- N401（C+，E5·全场）：④ 维修者暴露 ⇒ 必为工程师系且必为人类 ----------------
     ★ 覆盖说明：④ 暴露在引擎里已走 revealPublic → 全场 p.known 硬源，本条不追求增量强度，
     落地的是①可追溯推断通道登记 ②「原职业」连带推论（公告补标原职业后）。 */
  function repairExposedKeyHuman(g, selfId) {
    const x = g.players.find(q => !q.out && q.id !== selfId && q.repairExposed &&
      (q.role === 'engineer' || q.role === 'assistant'));
    return x ? x.id : null;
  }

  /* --- N406（B+，E6·救援医师私有）：濒死名单 × ⑥ 对账 --------------------------------
     推论：濒死名单 − 死亡名单 = 被救回者 ⇒ 敌方今夜至少命中 |濒死名单| 次。
     形态：证群体不证个体（总量对账）⇒ 走普适层（B+），不指向任何个体。
     （被救回者 ≠ 好人：异形会用「自伤队友」制造濒死诱饵。） */
  function dyingSeenOf(g, p) {
    if (p.role !== 'rescue' && p.role !== 'tempdoc') return null;
    const seen = p.dyingSeen;
    if (!seen || seen.night !== g.night || !seen.ids || !seen.ids.length) return null;
    const deadIds = new Set();
    for (const x of g.players) if (x.out && x.outNight === g.night) deadIds.add(x.id);
    if (seen.ids.every(id => deadIds.has(id))) return null;   // 全死了 ⇒ 无「被救回」可对账
    return { hits: seen.ids.length, saved: seen.ids.filter(id => !deadIds.has(id)).length };
  }

  const acc = global.SKChanGates = global.SKChanGates || {};
  Object.assign(acc, {
    N401: { expert: 'E5', universal: false, neg: true, tier: 'C+',
            gate: (g, p) => { const id = repairExposedKeyHuman(g, p.id); return id != null && P.onceChan(g, p, 'N401:' + id); },
            targetOf: (g, p) => repairExposedKeyHuman(g, p.id) },
    N406: { expert: 'E6', universal: true, tier: 'B+',
            gate: (g, p) => !!dyingSeenOf(g, p) && P.onceChan(g, p, 'N406:' + g.night) },
  });
})(typeof window !== 'undefined' ? window : globalThis);
