/* =============================================================
 * 太空杀 · 证据域模块 E4：查验自证族（A01 / A02 指名与匿名预告 + A08 对跳碰撞）
 *
 * 资产出处：总表 v20 §14（查验分析，E4 名下）+ A08（E8 身份推断，判据同源故同文件）。
 * 效用档位：A（A01）/ B 挂起（A02 无生产者、A08 对跳 0 发生）。
 * v31 批 2 方向修正（A3）：A01/A02 是【自证闭环】通道——神探做出可验证的预告
 * ⇒ 对全场是【信任】信号（neg=true 写 human 通道）；未兑现由 E7 兑现链另行追责。
 * 依赖：global.SKPred（onceChan / strongPromises / strongPromiser）。
 * ============================================================= */
(function (global) {
  const P = global.SKPred;

  /* E8 身份推断：A08 对跳碰撞——两个存活者宣称同一独占职业（与 ai.js R12 同一判据：
     claimedRole 非 crew/doc 即独占职业），证伪型：给先声称者挂「其一为假」的档位证据。 */
  function claimConflictPair(g) {
    const groups = {};
    for (const p of g.players) {
      if (p.out || !p.claimedRole || p.claimedRole === 'crew' || p.claimedRole === 'doc') continue;
      (groups[p.claimedRole] = groups[p.claimedRole] || []).push(p.id);
    }
    for (const k of Object.keys(groups)) if (groups[k].length >= 2) return [groups[k][0], groups[k][1]];
    return null;
  }

  const acc = global.SKChanGates = global.SKChanGates || {};
  Object.assign(acc, {
    /* 幂等说明：A01/A02/A08 不用 onceChan——幂等由执行器 _chanFired 的按夜键
       （chan:id:night:pid）承担，与其他观察者私有通道（跨夜一次）语义不同，勿混用。 */
    A01: { expert: 'E4', universal: false, neg: true,
           gate: (g, p) => { const d = P.strongPromiser(g, p.id); return !!d && P.strongPromises(d).some(pr => (pr.targets || []).length > 0); },
           targetOf: (g, p) => { const d = P.strongPromiser(g, p.id); return d ? d.id : null; } },   // 指名预告
    A02: { expert: 'E4', universal: false, neg: true,
           gate: (g, p) => { const d = P.strongPromiser(g, p.id); return !!d && P.strongPromises(d).some(pr => !(pr.targets || []).length); },
           targetOf: (g, p) => { const d = P.strongPromiser(g, p.id); return d ? d.id : null; } },   // 匿名公告预告
    A08: { expert: 'E8', universal: false,
           gate: (g, p) => { const pr = claimConflictPair(g); return !!pr && pr.indexOf(p.id) < 0; },
           targetOf: (g, p) => { const pr = claimConflictPair(g); return pr ? pr[0] : null; } },
  });
})(typeof window !== 'undefined' ? window : globalThis);
