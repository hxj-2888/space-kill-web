/* =============================================================
 * 太空杀 · 证据域模块 E2：感染记忆族（N139 / N141 / N149 / N407，expert:'E2'，观察者私有）
 *
 * 资产出处：总表 v20 §12.2（医生私有「隐形清除：锁定非人类」）+ v31 批 3.5 N407。
 * 效用档位：A（N407）/ B 挂起（N141/N149 三方条件苛刻）。
 * 观测素材 = 医生自己的 markEverSeen / antibodyFired——全部为「按时间线推理」，
 * 不读 x.infection.real 这类隐藏状态（那才是透视）。
 * 依赖：global.SKPred（onceChan）。
 * ============================================================= */
(function (global) {
  const P = global.SKPred;

  const MARKS_OVERDUE = 5;      // N148：自首见夜 n 起最晚应死夜 = n+5（普通 n+2／加速 n+1，抑制最多再延后 3）
  function doctorMarkCase(g, p) {
    if (!p.markEverSeen || !p.markEverSeen.size) return null;
    for (const [id, ever] of p.markEverSeen) {
      const x = g.players.find(q => q.id === id);
      if (!x || x.out) continue;
      if (x.infection) {                     // 标记仍在身上
        if (g.night - ever.night > MARKS_OVERDUE) return { id, kind: 'fakeMark' };      // N149
        continue;
      }
      if (ever.goneNight == null || !ever.noCure) continue;   // 消失且那一夜 ⑫ = 0（非医生清除）
      /* 消失前是否已逾期：逾期 ⇒ 该标记必为假 ⇒ 消失只能是异形清洗 ⇒ 确证异形（N141） */
      if (ever.goneNight - ever.night > MARKS_OVERDUE) return { id, kind: 'confirmAlien' };
      return { id, kind: 'nonHuman' };                                                       // N139
    }
    return null;
  }

  /* N407（B，E2·生化医师私有）：抗体生效 × 目标存续（三方对账）--------------------
     ★ 口径偏差（已在 channels.data N407 note 与台账同步记录）：
       总表原文结论是「⇒ X 为异形（效果免疫）」，而本引擎层序是
       抗体 → 保镖 → 巡逻 → 效果免疫（engine.js applyInfection），抗体在效果免疫**之前**结算
       ⇒ 即便 X 是异形，该夜同样不会留下假标记 ⇒「据标记缺失判 X 为异形」在本实现不成立。
       落地为可判定的部分：抗体生效 ⇒ 该夜确有一次感染施加于 X（私有确证），且 X 此后
       没有标记落地 ⇒ 按【信任】方向记 B 档（异形对队友施感无收益，N360 欺诈感染是例外）。 */
  function antibodyReconcile(g, p) {
    if (p.role !== 'bio') return null;
    const rec = (p.antibodyFired || []).filter(r => r.night === g.night).pop();
    if (!rec) return null;
    const x = g.players.find(q => q.id === rec.target);
    if (!x || x.out || x.dying) return null;               // 「X 未死」
    if (g.cureHands > 0) return null;                      // 「⑫ 清除计数未增」
    const ever = p.markEverSeen && p.markEverSeen.get(x.id);
    if (ever && ever.night >= rec.night) return null;      // 生效夜之后出现过标记 ⇒ 不是「未落地」
    return x.id;
  }

  const acc = global.SKChanGates = global.SKChanGates || {};
  Object.assign(acc, {
    N139: { expert: 'E2', universal: false,
            gate: (g, p) => { const c = doctorMarkCase(g, p); return !!c && c.kind === 'nonHuman' && P.onceChan(g, p, 'N139:' + c.id); },
            targetOf: (g, p) => { const c = doctorMarkCase(g, p); return c && c.kind === 'nonHuman' ? c.id : null; } },
    N141: { expert: 'E2', universal: false,
            gate: (g, p) => { const c = doctorMarkCase(g, p); return !!c && c.kind === 'confirmAlien' && P.onceChan(g, p, 'N141:' + c.id); },
            targetOf: (g, p) => { const c = doctorMarkCase(g, p); return c && c.kind === 'confirmAlien' ? c.id : null; } },
    N149: { expert: 'E2', universal: false,
            gate: (g, p) => { const c = doctorMarkCase(g, p); return !!c && c.kind === 'fakeMark' && P.onceChan(g, p, 'N149:' + c.id); },
            targetOf: (g, p) => { const c = doctorMarkCase(g, p); return c && c.kind === 'fakeMark' ? c.id : null; } },
    N407: { expert: 'E2', universal: false, neg: true, tier: 'B',
            gate: (g, p) => { const id = antibodyReconcile(g, p); return id != null && P.onceChan(g, p, 'N407:' + id); },
            targetOf: (g, p) => antibodyReconcile(g, p) },
  });
})(typeof window !== 'undefined' ? window : globalThis);
