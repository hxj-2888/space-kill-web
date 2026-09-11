/* =============================================================
 * 太空杀 · 证据域模块 E8：身份推断·宣称总量对账族（首批接线：B01 / B03，universal）
 *
 * 资产出处：总表 v20 E8 名下 B01~B20（「宣称数 vs 官方公开数」的总量对账族）。
 * 效用档位：A（两条都是证群体不证个体——匿名撒谎只能定位到「群体中有假」，写单体层无意义）。
 * 判据全部可机械评估：宣称数来自结构化落盘（claimedExperience / declaredAbstain），
 * 官方数来自公告口径（g.log ⑫ 批次 / voteHistory.src）。
 * 注意：registry 旧描述把 A10/A11/A16 归 E8，总表实际归属 E7（自证闭环）——本模块
 * 按总表为准，E8 = B 系总量对账 + N263~N281 结构事实（后者 target:'结构事实'，暂不接线）。
 * 依赖：global.SKPred（onceChan——本域按夜幂等，由执行器 _chanFired 键承担，不用 onceChan）。
 * ============================================================= */
(function (global) {

  /* B01（B+，E8·全场）：⑫ 扣除救援后 vs 治疗宣称数 --------------------------------
     推论：宣称「我治疗了 X」的人数 > 官方 ⑫ 清除公告数 − 宣称救援数 ⇒ 有人编造治疗体验。
     形态：总量对账（证群体不证个体）⇒ universal，不指向个体。 */
  function cureFabricated(g) {
    const claimN = g.players.filter(p => (p.claimedExperience || [])
      .some(e => e.kind === 'cure' && e.night === g.night)).length;
    if (!claimN) return false;
    const rescueN = g.players.filter(p => (p.claimedExperience || [])
      .some(e => e.kind === 'rescue' && e.night === g.night)).length;
    const actualCure = (g.log || []).filter(e => e.batch === '⑫' && e.night === g.night).length;
    return claimN > Math.max(0, actualCure - rescueN);
  }

  /* B03（B+，E8·全场）：弃票宣称数 ＞ 官方 ⑨ 显示的弃票总数 ⇒ 宣称者中必有人撒谎 -------
     数据源：declaredAbstain（弃票宣称，pipeline 'abstain' 落盘）vs voteHistory 最近回合
     的 src 空值计数（⑨ 总票数公开口径）。总量对账 ⇒ universal。 */
  function abstainOverTotal(g) {
    const hist = g.voteHistory || [];
    const round = hist[hist.length - 1];
    if (!round) return false;
    const declarers = g.players.filter(x => !x.out &&
      (x.declaredAbstain || []).some(d => d.night === round.night)).length;
    if (!declarers) return false;
    const abstained = Object.keys(round.src).filter(k => round.src[k] == null).length;
    return declarers > abstained;
  }

  const acc = global.SKChanGates = global.SKChanGates || {};
  Object.assign(acc, {
    B01: { expert: 'E8', universal: true, tier: 'B+',
           gate: g => cureFabricated(g) },
    B03: { expert: 'E8', universal: true, tier: 'B+',
           gate: g => abstainOverTotal(g) },
  });
})(typeof window !== 'undefined' ? window : globalThis);
