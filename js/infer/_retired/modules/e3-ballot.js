/* =============================================================
 * 太空杀 · 证据域模块 E3：票型对账族（N182 / N188 / N216 / D03，观察者=验票官私有）
 *
 * 资产出处：总表 v20 §13（票型）+ N188（C15 同构假冒）。
 * 效用档位：A（N182/N216）/ B 挂起（N188 需验票官死后冒称）。
 * 共同点：票源（g.voteHistory）仅验票官可见（2.3 例外一）——天然单人私有源。
 * 依赖：global.SKPred（onceChan）。
 * ============================================================= */
(function (global) {
  const P = global.SKPred;

  /* D03（D，E11）：弃票声明对账——验票官可见票源；宣称弃票者当夜却投了人 ⇒ 伪证。
     回合取【最近一次投票】并按该回合的 night 匹配声明（步骤 9 早于当夜白天投票，
     故不能按 g.night 直接匹配）。只有验票官能验证（私有源）。 */
  function abstainLiar(g, p) {
    if (p.role !== 'inspector') return null;
    const hist = g.voteHistory || [];
    const round = hist[hist.length - 1];
    if (!round) return null;
    for (const sp of g.players) {
      if (sp.out || sp.id === p.id) continue;
      if (!(sp.declaredAbstain || []).some(d => d.night === round.night)) continue;
      if (round.src[sp.id] != null) return sp.id;
    }
    return null;
  }

  /* N188（A−，E11）：真验票官已出局（⑦ 公告过身份，属公开事实）仍有人宣称验票官身份 ⇒ 必为假冒。
     与 C15「神探死后新公告必为伪造」同构。 */
  function fakeInspectorClaim(g, selfId) {
    if (g.players.some(x => !x.out && x.role === 'inspector')) return null;   // 真身在世 → 属对跳（A08）
    const c = g.players.find(x => !x.out && x.id !== selfId && x.claimedRole === 'inspector');
    return c ? c.id : null;
  }

  /* N216（D，E11·视角依赖）：宣称「我投了 X」而票源显示实际投的是别人 ⇒ 说谎。
     总表口径：对全场 D（不可验证）／对验票官 A⁻（可验证）——
     v31 批 1（B4，定案 9）：视角依赖档位首次真正生效，本 gate 只对验票官触发，
     解析结果恒为 A−：旧实现按单值 D 写，档位被低估 6.6 倍。 */
  function voteClaimLiar(g, p) {
    if (p.role !== 'inspector') return null;
    const hist = g.voteHistory || [];
    const round = hist[hist.length - 1];        // 最近一轮（步骤 9 早于当夜白天投票，故不能按 g.night 匹配）
    if (!round) return null;
    for (const sp of g.players) {
      if (sp.out || sp.id === p.id) continue;
      const decl = (sp.declaredVotes || []).filter(d => d.night === round.night);
      if (!decl.length) continue;
      const actual = round.src[sp.id];
      if (actual == null) continue;
      if (decl.some(d => (d.ids || []).indexOf(actual) < 0)) return sp.id;
    }
    return null;
  }

  /* N182（C，E3）：本轮「我弃票了」的宣称数 > 实际弃票数 A ⇒ 必有人说谎。
     来源是公开口径（A 由 ⑨ 直显，宣称是公开发言），但只有【唯一宣称者且 A=0】时可个体定位；
     多人宣称时只能得出"有人在说谎"，不可定罪 —— 不接线（避免不可归因的证据）。 */
  function abstainOverClaim(g, selfId) {
    const hist = g.voteHistory || [];
    const round = hist[hist.length - 1];
    if (!round) return null;
    const abstainedN = Object.keys(round.src).filter(k => round.src[k] == null).length;
    const declarers = g.players.filter(x => !x.out && x.id !== selfId &&
      (x.declaredAbstain || []).some(d => d.night === round.night));
    if (declarers.length !== 1 || abstainedN !== 0) return null;   // 唯一宣称者 + 全场无人真弃票
    return declarers[0].id;
  }

  const acc = global.SKChanGates = global.SKChanGates || {};
  Object.assign(acc, {
    D03:  { expert: 'E11', universal: false,
            gate: (g, p) => { const id = abstainLiar(g, p); return id != null && P.onceChan(g, p, 'D03:' + id); },
            targetOf: (g, p) => abstainLiar(g, p) },
    N182: { expert: 'E3', universal: false,
            gate: (g, p) => { const id = abstainOverClaim(g, p.id); return id != null && P.onceChan(g, p, 'N182:' + id); },
            targetOf: (g, p) => abstainOverClaim(g, p.id) },
    N188: { expert: 'E11', universal: false,
            gate: (g, p) => { const id = fakeInspectorClaim(g, p.id); return id != null && P.onceChan(g, p, 'N188:' + id); },
            targetOf: (g, p) => fakeInspectorClaim(g, p.id) },
    N216: { expert: 'E11', universal: false,
            /* v31 批 1（B4，定案 9）：视角依赖档位首次真正生效（幅度仍查 SCORE 表，无新数值） */
            tier: { byRole: { inspector: 'A-' }, def: 'D' },
            gate: (g, p) => { const id = voteClaimLiar(g, p); return id != null && P.onceChan(g, p, 'N216:' + id); },
            targetOf: (g, p) => voteClaimLiar(g, p) },
  });
})(typeof window !== 'undefined' ? window : globalThis);
