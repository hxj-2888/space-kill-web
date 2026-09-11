/* =============================================================
 * 太空杀 · 证据域模块 E1：破坏算术族（N04~N22 / N95~N100，共 20 条，expert:'E1'，universal）
 *
 * 资产出处：总表 v20 §11.1~11.3（破坏量区间 → 参与者构成约束）。
 * 效用档位：A（N95~N100 是 AI 破坏决策的压力感知输入）。
 * 判据全部「纯公开量推导，写普适层」：v25 批次 4 delta 字段全部删除，增量 = SCORE[tier]。
 * v26 修复三处致命问题（编号必须在总表 / 量纲统一 ×10 / 自检类不接线）——判据注释随行保留。
 * 依赖：global.SKPred（dmgT / distNext / aliensAlive）。
 * ============================================================= */
(function (global) {
  const P = global.SKPred;

  const EXEC_GATES = {
    /* N04「当夜无任何破坏」——效用档 C（候选改造项，见 docs/推理库模块化与效用清单 §二）。
       ★ v33 标定与回退记录（同日）：曾改为「连续 ≥2 夜无破坏才入账」（_n04Run streak，
       执行器 T 块结算），100 局实测：命中 5,272 → 3,819（连续 streak 仍逐夜命中，改造语义
       应为 run===2 单次）；人类胜率 36.0% → 30.0%（在 100 局方差 ±4.8pp 内，但方向不利），
       且 v26 回归断言「N04 命中」依赖单夜场景 ⇒ 按项目纪律（BASE_DANGER 同款）**整体回退**。
       将来若再动，必须：① run===2 单次语义 ② 500 局对照 ③ 同步改该回归断言。 */
    N04:  { gate: g => P.dmgT(g) === 0 },                                              // 当夜无任何破坏
    N95:  { gate: g => P.distNext(g) < 1.0 },                                       // 距下一档 <1.0：单只即可跨档
    N96:  { gate: g => P.distNext(g) >= 1.0 && P.distNext(g) <= 1.5 },
    N97:  { gate: g => P.distNext(g) > 1.5 && P.distNext(g) <= 2.0 },                 // 单只不可能，需 2 只或大贡献者
    N98:  { gate: g => P.distNext(g) > 3.0 && P.distNext(g) <= 4.5 },
    N100: { gate: g => { const d = P.distNext(g); return d > 0 && d <= 0.5; } },    // 距下一档 ≤0.5：故意不跨档
    /* --- 11.2　分解类（N04~N14）：T 区间 → 参与者构成约束 --- */
    N05:  { gate: g => P.dmgT(g) >= 1.0 && P.dmgT(g) <= 1.5 },                              // 恰好 1 只非破坏进化异形参与
    N07:  { gate: g => P.dmgT(g) >= 2.0 && P.dmgT(g) < 3.0 },                               // 三选一
    N08:  { gate: g => P.dmgT(g) === 3.0 },                                            // 六选一（全局最模糊点）
    N09:  { gate: g => P.dmgT(g) > 3.0 && P.dmgT(g) < 4.0 },                                // 排除 2 个大贡献者
    N10:  { gate: g => P.dmgT(g) > 4.5 },                                              // 至少 1 个大贡献者
    N11:  { gate: g => P.dmgT(g) > 7.5 },                                              // 至少 2 个大贡献者
    N12:  { gate: g => P.dmgT(g) > 9.0 },                                              // 恰 3 个大贡献者（唯一解，s 必为 3）
    /* --- 11.3　条件于存活异形数 s（N15~N22）--- */
    N15:  { gate: g => P.aliensAlive(g) === 1 && P.dmgT(g) >= 1.0 && P.dmgT(g) <= 1.5 },      // 该异形非破坏进化、外星人未参与
    N17:  { gate: g => P.aliensAlive(g) === 1 && P.dmgT(g) > 3.0 && P.dmgT(g) < 4.0 },        // 异形非进化 + 外星人同夜破坏
    N18:  { gate: g => P.aliensAlive(g) === 1 && P.dmgT(g) > 4.5 && P.dmgT(g) <= 6.0 },       // 异形破坏进化 + 外星人同夜破坏
    N19:  { gate: g => P.aliensAlive(g) === 2 && P.dmgT(g) > 7.5 && P.dmgT(g) <= 9.0 },       // 2 只破坏进化 + 外星人
    N20:  { gate: g => P.aliensAlive(g) === 3 && P.dmgT(g) >= 1.0 && P.dmgT(g) <= 1.5 },      // 另 2 只未参与破坏
    N21:  { gate: g => P.dmgT(g) > 1.5 * P.aliensAlive(g) },                             // 必有至少 1 个大贡献者
    N22:  { gate: g => P.dmgT(g) > 1.5 * P.aliensAlive(g) + 3.0 },                       // 至少 2 个大贡献者（含外星人可能）
  };
  for (const k of Object.keys(EXEC_GATES)) EXEC_GATES[k] = Object.assign({ expert: 'E1', universal: true }, EXEC_GATES[k]);

  const acc = global.SKChanGates = global.SKChanGates || {};
  Object.assign(acc, EXEC_GATES);
})(typeof window !== 'undefined' ? window : globalThis);
