/* =============================================================
 * 太空杀 · 证据域模块 E2：感染记忆族（N149 / N407，expert:'E2'，观察者私有）
 *
 * 资产出处：总表 v20 §12.2（医生私有「隐形清除：锁定非人类」）+ v31 批 3.5 N407。
 * 效用档位：A（N407）/ B 挂起（N149 三方条件苛刻）。
 * 观测素材 = 医生自己的 markEverSeen / antibodyFired——全部为「按时间线推理」，
 * 不读 x.infection.real 这类隐藏状态（那才是透视）。
 * 依赖：global.SKPred（onceChan）。
 * 批⑫撤除（2026-10-04，正文 3.3.7 逐字拍板）：N139/N141 原以「标记消失夜全场清除
 * 次数=0（⑫公告）」为判据——该公告已撤，「本人未清除」推不出「非医生清除」
 * （医生族 4 人，他人清除无从得知），两通道随之退役（channels.data 已标 dormant）。
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
      /* 标记已消失：原 N139/N141 判据（消失夜全场清除次数=0）随批⑫公告退役（3.3.7）——
         医生的私有信息只剩「标记曾存在、现已消失」本身，不足以指向任何结论。 */
      continue;
    }
    return null;
  }

  /* N407（B，E2·生化医师私有）：抗体生效 × 目标存续（三方对账）--------------------
     ★ 口径偏差（已在 channels.data N407 note 与台账同步记录）：
       总表原文结论是「⇒ X 为异形（效果免疫）」，而本引擎层序是
       抗体 → 保镖 → 巡逻 → 效果免疫（engine.js applyInfection），抗体在效果免疫**之前**结算
       ⇒ 即便 X 是异形，该夜同样不会留下假标记 ⇒「据标记缺失判 X 为异形」在本实现不成立。
       落地为可判定的部分：抗体生效 ⇒ 该夜确有一次感染施加于 X（私有确证），且 X 此后
       没有标记落地 ⇒ 按【信任】方向记 B 档（异形对队友施感无收益，N360 欺诈感染是例外）。
     ★ 批⑫撤除（2026-10-04）：原「⑫ 清除计数未增」判据退役——该计数已无从得知（3.3.7）。
       收紧为纯私有口径：X 曾出现在本人标记记忆（markEverSeen）中 ⇒ 存在「标记被清除」
       的窗口 ⇒ 退回保守不判；仅 X 从未带过任何标记时才入账。 */
  function antibodyReconcile(g, p) {
    if (p.role !== 'bio') return null;
    const rec = (p.antibodyFired || []).filter(r => r.night === g.night).pop();
    if (!rec) return null;
    const x = g.players.find(q => q.id === rec.target);
    if (!x || x.out || x.dying) return null;               // 「X 未死」
    if (x.infection) return null;                          // X 当前带标记（含假标记）：对账域外
    if (p.markEverSeen && p.markEverSeen.get(x.id)) return null;   // X 曾带过标记 ⇒ 存在清除窗口，保守不判
    return x.id;
  }

  const acc = global.SKChanGates = global.SKChanGates || {};
  Object.assign(acc, {
    N149: { expert: 'E2', universal: false,
            gate: (g, p) => { const c = doctorMarkCase(g, p); return !!c && c.kind === 'fakeMark' && P.onceChan(g, p, 'N149:' + c.id); },
            targetOf: (g, p) => { const c = doctorMarkCase(g, p); return c && c.kind === 'fakeMark' ? c.id : null; } },
    N407: { expert: 'E2', universal: false, neg: true, tier: 'B',
            gate: (g, p) => { const id = antibodyReconcile(g, p); return id != null && P.onceChan(g, p, 'N407:' + id); },
            targetOf: (g, p) => antibodyReconcile(g, p) },
  });
})(typeof window !== 'undefined' ? window : globalThis);
