/* =============================================================
 * 太空杀 · 通道门禁执行器（v33 模块化：判据已拆分至 js/infer/modules/）
 *
 * 职责（只剩两件事）：
 *   · 合并：六个证据域模块（e1-destroy / e2-infection / e3-ballot / e4-verify /
 *           e11-network / e56-protect）在加载时把各自的 GATE_IMPL 片段写入
 *           global.SKChanGates，本文件在此合并为 GATE_IMPL；
 *   · 执行：runChannelsAll(g)（逐观察者调用 gate(g, p)，命中即经 MoE.absorb 入账）
 *           + wiredCount / mountedIds / unmounted 接线口径。
 * 判据本体与注释请看各域模块文件；跨域共享谓词在 js/infer/predicates.js。
 * 与运行时机制（route / 仲裁 / 影子 / stats）不直接耦合——只依赖：
 *   global.Tiers · global.Channels（506 条总表）· global.AI · global.MoERegistry（表结构）
 * 挂载：文件末尾 Object.assign(global.MoE, …) —— 对外 MoE.* 接口保持零改动。
 * ============================================================= */
(function (global) {
  const T = global.Tiers;

  /* 六个证据域模块已按 load-order 在本文件之前加载并写入累加器 */
  const GATE_IMPL = global.SKChanGates || {};

  function runChannelsAll(g) {
    const AI = global.AI;
    if (!AI || !global.Channels) return;
    if (!g._chanFired) g._chanFired = new Set();
    if (!g._chanFires) g._chanFires = {};
    /* v27 仪器（C3）：每条接线通道的「求值次数 / 命中次数」。
       只计入【真实参与求值】的次数（P/Z/F 语义档在执行器入口就被跳过，不计求值）。 */
    if (!g._chanEval) g._chanEval = {};
    /* 当夜破坏总量：每夜首个 reason 调用时结算一次（net10 差值），供 T 族 gate 使用 */
    const tkey = 'T:' + g.night;
    if (!g._chanFired.has(tkey)) {
      g._t10Night = g._prevNet10 != null ? (g.net10 - g._prevNet10) : 0;
      g._prevNet10 = g.net10;
      g._chanFired.add(tkey);
    }
    let fired = 0;
    const table = global.Channels.CHANNELS || [];
    for (const ch of table) {
      const impl = GATE_IMPL[ch.id];
      if (!impl) continue;                                    // 未接线 = dormant（总表原状）
      /* v31 批 1（B4，定案 9）：档位声明可以是字符串（全员同档），也可以是
         { def, byRole, byFaction }（视角依赖档）。门禁可用 impl.tier 覆盖总表条目。
         幅度仍唯一来自 SCORE 表（红线）——这里只解析「该观察者看哪一档」。 */
      const spec = impl.tier != null ? impl.tier : ch.tier;
      const magBase = T && T.magFor ? T.magFor(spec, null) : (T ? T.SCORE[ch.tier] : 0);
      /* Z（26 条）是排错负样本、F（16 条）是零值语义标记：都写 0 分证据，不接线。
         P（41 条）自 v31 批 1 起有显式强度映射（SCORE['P'] = C 档），因此不再在入口跳过。 */
      if (magBase == null || magBase === 0) continue;
      for (const p of g.players) {
        /* v32 机制对等：通道证据对玩家席位同样求值/入账（玩家神探/医生的私有字段同样真实存在） */
        if (p.out) continue;
        /* v26 修复：幂等键必须带观察者 id——否则通道证据只落到座位序最前的那个 AI 手里。 */
        const key = 'chan:' + ch.id + ':' + g.night + ':' + p.id;
        if (g._chanFired.has(key)) continue;
        g._chanEval[ch.id] = (g._chanEval[ch.id] || 0) + 1;
        let hit = false;
        try { hit = !!impl.gate(g, p); } catch (e) { hit = false; }
        if (!hit) continue;
        g._chanFired.add(key);
        g._chanFires[ch.id] = (g._chanFires[ch.id] || 0) + 1;
        fired++;
        /* delta 只承载方向（红线）：impl.neg = true → 信任类证据，投影时写反向通道。 */
        const tierP = T && T.tierFor ? T.tierFor(spec, p) : ch.tier;
        const mag = T && tierP != null && T.SCORE[tierP] != null ? T.SCORE[tierP] : magBase;
        const signed = impl.neg ? -mag : mag;
        if (impl.universal) {
          /* v32 批 4′（统一入账口）：普适层收口 —— addUniversal 不走 tEvents、无仲裁语义。 */
          if (global.MoE && global.MoE.absorbUniversal)
            global.MoE.absorbUniversal(g, p.id, signed, tierP, 'chan:' + ch.id + ':' + g.night, impl.kind || 'claim', impl.expert);
          else AI.addUniversal(g, p.id, signed, tierP, 'chan:' + ch.id + ':' + g.night, impl.kind || 'claim', impl.expert);
        } else {
          const tgt = impl.targetOf ? impl.targetOf(g, p) : (ch.target != null ? ch.target : null);
          /* v32 批 4′（统一入账口）：路径④改道 MoE.absorb（参数透传 + route 求值；
             直通模式不过滤激活集 ⇒ 写入集合不变）。 */
          if (global.MoE && global.MoE.absorb) {
            if (tgt != null) global.MoE.absorb(g, p.id, [{ target: tgt, delta: signed, grudge: false,
              src: 'chan:' + ch.id + ':' + g.night, kind: impl.kind || 'claim', tier: tierP,
              speakerId: null, chan: ch.id, expert: impl.expert }], { path: 'chan', route: true, evt: ch.id });
          }
          else if (tgt != null) AI.addEvent(g, p.id, tgt, signed, false, 'chan:' + ch.id + ':' + g.night, impl.kind || 'claim', tierP, null, ch.id, impl.expert);
        }
      }
    }
    return fired;
  }
  /* v26：只有「编号存在于总表」的接线才会被执行器遍历到——进度指标不得虚高。 */
  function mountedIds() {
    const all = (global.Channels && global.Channels.CHANNELS) || [];
    const ids = new Set(all.map(c => c.id));
    return Object.keys(GATE_IMPL).filter(id => ids.has(id));
  }
  function wiredCount() { return mountedIds().length; }
  function unmounted() {
    const m = new Set(mountedIds());
    return Object.keys(GATE_IMPL).filter(id => !m.has(id));
  }
  /* 挂回 MoE 命名空间（moe.js 先加载并已建 global.MoE） */
  Object.assign(global.MoE, { GATE_IMPL, runChannelsAll, wiredCount, unmounted, mountedIds,
    /* v31 批 3.5：N402 的公共前提（可供审计/断言读取；谓词本体在 infer/predicates.js） */
    patrolSpentPublic: global.SKPred ? global.SKPred.patrolSpentPublic : null });
})(typeof window !== 'undefined' ? window : globalThis);
