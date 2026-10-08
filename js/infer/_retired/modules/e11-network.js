/* =============================================================
 * 太空杀 · 证据域模块 E11：攻击反馈族（N306 / N318 / N403 / N404 / N405，攻击方/神探私有）
 *
 * 资产出处：总表 v20 §15（社会网络）+ v31 批 3.5 人类侧保护专项（N403~N405）。
 * 效用档位：A（N403 是分叉度主力）/ B 挂起（N306/N404/N405 需 patrolSpent 前提 + 稀有事件）。
 * ★ 核心裁定（保护专项文档第四章）：凡由私有攻击反馈推出的目标身份推断，一律不进普适层。
 * 共同素材 = 攻击方自己的 p.attackLog（引擎只对【伤害】落盘；感染施加不落盘）。
 * 依赖：global.SKPred（onceChan / patrolSpentPublic）。
 * ============================================================= */
(function (global) {
  const P = global.SKPred;

  /* N306（C+，E11）：连续两夜攻击同一目标均「无效」⇒ 目标持存续型抵挡层（结茧护盾）⇒ 异形。
     总表判据已逐条排除其它解释：保镖不可连保同一人（无豁免）、巡逻全局仅 1 次、
     抗体只挡感染不挡伤害、工程师全能免疫仅第 1 夜、外星人夜晚免疫仅 1 次。 */
  function blockedTwiceTarget(g, p) {
    if (!p.attackLog || !p.attackLog.length) return null;
    const by = {};
    for (const a of p.attackLog)
      if (a.res === 'blocked' && a.target != null) (by[a.target] = by[a.target] || []).push(a.night);
    for (const id of Object.keys(by)) {
      const ns = by[id].slice().sort((x, y) => x - y);
      for (let i = 1; i < ns.length; i++) if (ns[i] - ns[i - 1] === 1) return +id;
    }
    return null;
  }

  /* N318（C+，E11·负向）：转职探测——公告显示的「发布当夜职业」与池内「查验当夜职业」不一致
     ⇒ 目标在查验之后转职 ⇒ 其出身必为普通船员（人类）。转职只发生在普通船员身上，
     所以这是「确认人类」的证据（neg=true 走 human 通道）。仅神探本人能察觉。 */
  function transferProbeTarget(g, p) {
    if (p.role !== 'detective' || !p.checkPool) return null;
    for (const rec of p.checkPool.values()) {
      if (!rec.published || !rec.role) continue;
      const t = g.players.find(x => x.id === rec.id);
      if (t && !t.out && t.role !== rec.role) return t.id;
    }
    return null;
  }

  /* --- N403 / N404 / N405：攻击方私有的「抵挡层收敛」 --------------------------------
     触发面互斥（同一 pair 不会三条同时入账）：
       once    : 本夜首见被挡（该 pair 仅 1 个被挡夜次）      → N403（C+）
       consec  : 出现连续两夜被挡（保镖不可连保，无豁免）      → N404（C+）
       persist : 被挡 ≥3 个夜次且无连续两夜（存续型抵挡指纹）  → N405（C） */
  function blockCases(g, p) {
    if (!p.attackLog || !p.attackLog.length) return [];
    const by = new Map();
    for (const a of p.attackLog) {
      if (a.res !== 'blocked' || a.target == null || a.night == null) continue;
      if (!by.has(a.target)) by.set(a.target, new Set());
      by.get(a.target).add(a.night);
    }
    const out = [];
    for (const [id, set] of by) {
      const ns = [...set].sort((x, y) => x - y);
      if (ns.indexOf(g.night) < 0) continue;               // 只处理「本夜亲历」的观测
      let consec = false;
      for (let i = 1; i < ns.length; i++) if (ns[i] - ns[i - 1] === 1) consec = true;
      out.push({ id, ns, consec });
    }
    return out;
  }
  /* 攻击方侧共用过滤：
     · 只对【非人类攻击方】生效 —— 警官被挡时「有人保他」更指向人类（保镖），方向相反，故排除。
     · 队友（异形视角下经 p.known 合法获知）不入账 —— 硬锁会把分布打成单点，等于白写。
     · 需要 patrolSpentPublic（N402 前提）：否则「连续两夜被挡」可由 保镖(n)+巡逻(n+1) 解释。 */
  function blockCaseFor(g, p, level) {
    if (p.faction === 'human') return null;
    if (!P.patrolSpentPublic(g)) return null;
    for (const c of blockCases(g, p)) {
      const t = g.players.find(q => q.id === c.id);
      if (!t || t.out) continue;
      const k = p.known && p.known.get(c.id);
      if (k && k.faction === 'alien') continue;            // 队友：硬信息，不重复计分
      if (level === 'once' && c.ns.length === 1) return c.id;
      if (level === 'consec' && c.consec) return c.id;
      if (level === 'persist' && c.ns.length >= 3 && !c.consec) return c.id;
    }
    return null;
  }

  const acc = global.SKChanGates = global.SKChanGates || {};
  Object.assign(acc, {
    N306: { expert: 'E11', universal: false,
            gate: (g, p) => { const id = blockedTwiceTarget(g, p); return id != null && P.onceChan(g, p, 'N306:' + id); },
            targetOf: (g, p) => blockedTwiceTarget(g, p) },
    N318: { expert: 'E11', universal: false, neg: true,
            gate: (g, p) => { const id = transferProbeTarget(g, p); return id != null && P.onceChan(g, p, 'N318:' + id); },
            targetOf: (g, p) => transferProbeTarget(g, p) },
    N403: { expert: 'E11', universal: false, tier: 'C+',
            gate: (g, p) => { const id = blockCaseFor(g, p, 'once'); return id != null && P.onceChan(g, p, 'N403:' + id); },
            targetOf: (g, p) => blockCaseFor(g, p, 'once') },
    N404: { expert: 'E11', universal: false, tier: 'C+',
            gate: (g, p) => { const id = blockCaseFor(g, p, 'consec'); return id != null && P.onceChan(g, p, 'N404:' + id); },
            targetOf: (g, p) => blockCaseFor(g, p, 'consec') },
    N405: { expert: 'E11', universal: false, tier: 'C',
            gate: (g, p) => { const id = blockCaseFor(g, p, 'persist'); return id != null && P.onceChan(g, p, 'N405:' + id); },
            targetOf: (g, p) => blockCaseFor(g, p, 'persist') },
  });
})(typeof window !== 'undefined' ? window : globalThis);
