/* =============================================================
 * 太空杀 · AI 层共享工具与跨层常量（v27 模块化第三批）
 *
 * 工具：clamp / alive / aliveF / byId / isAlly / pick / gauss / knownOf
 * 常量：BAND_DOWN（档位降一档表，adjudicate 用）· GRUDGE_W（记仇权重 0.5/0.3/0.15，
 *       入账层 grudgeLevel 与决策层 decide 共用 —— 单点定义，避免两处漂移）
 * 依赖：无（纯函数与字面量）。
 * ============================================================= */
(function (global) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const alive = g => g.players.filter(p => !p.out);
  const aliveF = (g, f) => alive(g).filter(p => p.faction === f);
  const byId = (g, id) => g.players.find(p => p.id === id);
  const isAlly = (a, b) => a.faction === 'alien' && b.faction === 'alien';
  const pick = (rng, arr) => arr[rng.int(arr.length)];
  function gauss(g) {                          // Box-Muller
    let u = 0, v = 0;
    while (u === 0) u = g.rng.next();
    while (v === 0) v = g.rng.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const knownOf = (g, me, t) => me.known.get(t.id) || t.revealed || null;
  const BAND_DOWN = { 'A-': 'B-', 'B-': 'C', 'C': 'C-', 'C-': 'D+' };
  const GRUDGE_W = { 25: 0.5, 50: 0.3, 75: 0.15 };

  global.AIUtil = { clamp, alive, aliveF, byId, isAlly, pick, gauss, knownOf, BAND_DOWN, GRUDGE_W };
})(typeof window !== 'undefined' ? window : globalThis);
