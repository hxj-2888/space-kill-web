/* =============================================================
 * 太空杀 · 通道共享谓词层（v33 模块化：自 channels.run.js 抽出）
 *
 * 只放「跨证据域共用」的纯函数；域内私有判据留在各模块文件。
 * 依赖：仅 global.Tiers。加载顺序：tiers/registry 之后、各证据域模块之前。
 * 搬移纪律：此处出现第二份同名拷贝即视为回归（详见 docs/推理库模块化与效用清单_2026-09-11.md §三）。
 * ============================================================= */
(function (global) {
  /* E1 破坏算术族共用：存活异形数 / 当夜总破坏量（×10 整数与真值）/ 距下一停摆档位 */
  function aliensAlive(g) { return g.players.filter(p => !p.out && p.faction === 'alien').length; }
  function T10(g) { return g._t10Night != null ? g._t10Night : 0; }                 // 当夜总破坏量（×10 整数）
  function dmgT(g) { return (g._t10Night != null ? g._t10Night : 0) / 10; }        // 当夜总破坏量（真值，非 ×10）
  function distNext(g) { const nt = g.net10 < 30 ? 30 : g.net10 < 60 ? 60 : 90; return (nt - g.net10) / 10; }

  /* 观察者私有通道的幂等键：同一 (观察者, 通道, 目标) 一局只入账一次 */
  function onceChan(g, p, key) {
    if (!p._chanOnce) p._chanOnce = new Set();
    if (p._chanOnce.has(key)) return false;
    p._chanOnce.add(key);
    return true;
  }

  /* N402 公共前提：巡逻层是否已永久消失（本函数自身不入账，供 N403~N405 排除链使用）。
     口径：巡逻全局仅 1 次、限前 3 夜（steps.js '2b' req），③ 公布「巡逻指定 N 名」；
     第 4 夜起巡逻必为 0 属硬规则；规则 2.1「总人次为 0 不发布」⇒ 从「③ 未发布巡逻数字」
     亦可反推为 0。 */
  function patrolSpentPublic(g) {
    if (g.night >= 4) return true;                        // 硬规则：第 4 夜起巡逻不可用
    for (const e of (g.log || []))
      if (e.batch === '③' && String(e.text || '').indexOf('巡逻指定') >= 0) return true;
    return false;
  }

  /* E4 查验自证族共用：神探的【强承诺】（A01/A02 判据 = 神探身份 + promises.verifiable）。
     v26 修正接线口径：runChannelsAll 逐观察者调用——观察者是 p，行为主体是场上
     非 p本人的神探（旧写法「只有神探自己给自己记账」导致 A01/A02 从不出现）。 */
  function strongPromises(p) { return (p.promises || []).filter(pr => pr.tier === 'strong'); }
  function strongPromiser(g, selfId) {
    return g.players.find(x => !x.out && x.id !== selfId && x.role === 'detective' && strongPromises(x).length);
  }

  global.SKPred = { aliensAlive, T10, dmgT, distNext, onceChan, patrolSpentPublic, strongPromises, strongPromiser };
})(typeof window !== 'undefined' ? window : globalThis);
