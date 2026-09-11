/* Claim IR —— 语言库与推理链之间的唯一交换格式（结合层）。
   设计要点：
   ① Claim 只能由语言层产出（lang/parser 的文本理解，或 ai/speaker 的表达意图），
      二者走同一条管道进入推理层，AI 与玩家因此完全对等；
   ② Fact（由引擎产出）与 Claim（由语言产出）严格分离，二者都不含面向玩家的定式文案；
   ③ 本阶段「只定义结构与路由」，不新增任何权重数值——推理侧的数值由后续数值方案统一给出。
*/
(function (global) {
  /* v33（复审 P0）：'reveal' 收编白名单——tactics N397 判据与 renderer 模板早已引用它，
     此前唯独 KINDS 没有，导致「4 套 kind 枚举不一致 + validate 无法放行」的漂移。 */
  const KINDS = [
    'accuse', 'defend', 'claimRole', 'bind', 'exclusion', 'lock',
    'ask', 'quote', 'vote', 'abstain', 'rally', 'split', 'pass',
    'deny', 'promise', 'reveal',
    'suppress', 'repair', 'destroy', 'cure', 'rescue', 'brew', 'infection',
  ];

  let seq = 0;
  function mk(kind, targets, payload, meta) {
    return {
      id: 'C' + (++seq),
      night: (meta && meta.night) || 0,
      step: (meta && meta.step) || null,
      channel: (meta && meta.channel) || 'public',
      speaker: (meta && meta.speaker) || null,
      kind,
      targets: targets || [],
      payload: payload || {},
      meta: meta || {},
      band: null,          // 由推理层回填（MVP 阶段为 null，仅占位）
      evidence: [],        // 该断言命中了哪些推理通道（由 infer 回填）
    };
  }

  /* Sig（语言库旧产物）→ Claim[]：把扁平意图升级为带 Fusia 与视角信息的断言 */
  function fromSig(sig, ctx) {
    const out = [];
    if (!sig) return out;
    const base = {
      night: ctx && ctx.night,
      step: ctx && ctx.step,
      channel: (ctx && ctx.channel) || 'public',
      speaker: ctx && ctx.speaker,
    };
    const push = (kind, targets, payload, extra) =>
      out.push(mk(kind, targets, payload, Object.assign({}, base, extra || {})));

    /* 指控三档：NLP 的「重度/中度/轻度」→ 推理层口径 hard/med/soft
       （v26：此前 payload.tier 在推理层被整体丢弃，措辞强度对权重零影响） */
    const ACC_TIER = { '重度': 'hard', '中度': 'med', '轻度': 'soft' };
    if (sig.accuse && sig.accuse.length) {
      for (const id of sig.accuse) push('accuse', [id], { tier: ACC_TIER[sig.accTiers[id]] || 'med' });
    }
    /* 身份声称 */
    if (sig.claim) {
      push('claimRole', [], { role: sig.claim }, { modality: { predict: false, exclusive: true, cashout: 'none' } });
    }
    /* 查验汇报：排除 / 锁定（金水=好、查杀=敌）。v26：透传 faction——
       它是目标侧证据与硬源锁定的唯一载体，此前在 IR 层就丢了。 */
    for (const r of (sig.report || [])) {
      if (r.kind === 'exclude') push('exclusion', [r.id], {});
      else push('lock', [r.id], { good: !!r.good, faction: r.faction || null });
    }
    /* 公开质询 */
    if (sig.ask && sig.ask.length) {
      for (const id of sig.ask) push('ask', [id], {});
    }
    /* 转述归因 */
    for (const q of (sig.quote || [])) push('quote', [q.target], { by: q.by });
    /* 投票意向 / 归票 / 分票 / 弃票 */
    if (sig.rally != null) push('rally', [sig.rally], {});
    if (sig.abstain) push('abstain', [], {});
    if (sig.voteIds && sig.voteIds.length) push('vote', sig.voteIds.slice(0, 2), {});
    /* 辩护背书 */
    for (const id of (sig.defend || [])) push('defend', [id], {});
    /* 编号+职业绑定 */
    for (const b of (sig.roleBind || [])) push('bind', [b.id], { role: b.role });
    /* 划水 */
    if (sig.pass) push('pass', [], {});
    /* 证伪型宣称（A12~A15） */
    for (const d of (sig.deny || [])) push('deny', [], { about: d.about });
    /* 承诺宣称（E7）：弱/中/强 */
    for (const pr of (sig.promise || [])) push('promise', pr.targets, { tier: pr.tier });
    /* 私有体验宣称（D 档，v20 N 系列体验族） */
    for (const e of (sig.exp || [])) push(e.kind, e.targets, {});

    if (ctx && ctx.speaker) for (const c of out) if (!c.targets.length && c.meta) c.meta.selfScope = true;
    return out;
  }

  function fromText(text, ctx) {
    /* v26：把 ctx.speaker 传给解析器——否则「排除说话者自己」的判定全部失效 */
    const sig = global.NLP ? global.NLP.parse(text, ctx) : null;
    return { claims: fromSig(sig, ctx), sig };
  }

  function validate(c) {
    return !!c && KINDS.indexOf(c.kind) >= 0 && Array.isArray(c.targets) && typeof c.payload === 'object';
  }

  /* 信息量排序：宣示类 > 指控类 > 互动类 > 自述类（供 UI 摘要与说话选单使用） */
  const WEIGHT = {
    reveal: 10, claimRole: 9, exclusion: 8, lock: 8, accuse: 7, quote: 6, bind: 6,
    deny: 6, vote: 5, rally: 4, defend: 4, ask: 4, promise: 4, abstain: 3,
    suppress: 3, repair: 3, destroy: 3, cure: 3, rescue: 3, brew: 3, infection: 3,
    split: 2, pass: 1,
  };
  const sortClaims = cs => cs.slice().sort((a, b) => (WEIGHT[b.kind] || 0) - (WEIGHT[a.kind] || 0));

  function id() { return 'C' + (++seq); }

  global.IR = { mk, fromSig, fromText, validate, sortClaims, KINDS, WEIGHT, nextId: id };
})(typeof window !== 'undefined' ? window : globalThis);
