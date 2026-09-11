/* =============================================================
 * 太空杀 · AI 事件入账层（自 js/ai.js 解耦，v27 模块化第三批）
 *
 * 职责：把「发生的事」变成「某个观察者账本里的证据」，不产出话语、不做决策。
 *   · 推理链事件：onClaim（R38 职业自证）/ onAccuse（R17/R27/R29/R31 指控与追责）
 *     / onExpose（R22/R23 暴露）/ onReveal（R30 假冒 + 揭示清算）/ onVoteSettle（R64 票型对账）
 *   · 询问链：onAsk / onQuote / answerQuestion / evaluateAnswer / onReport / onCheckClaim
 *   · 私有源：onPrivate / onPrivateShare（私聊一律降档 0.4+0.6C，永不进硬源）
 *   · 指纹与批处理：emitKingSignals（K1/K2）/ reason（夜末批处理）/ updatePublicThreat / settleClaims / settlePromises
 *   · 计价：holds（支撑者）/ adjudicate（三层计价：私有源 / 公开黑板 / 交流源）/ grudgeLevel / phaseTag
 *
 * 依赖：global.AIUtil（工具+共享常量）/ global.AIBelief（估值与账本）；
 *       另使用 IR / Tactics / MoE / Lang / Bridge 等全局（与浏览器同口径）。
 * 被谁调用：engine.js（结算出口）· pipeline.js（Claim 路由）· js/ai/decide.js（3 处）。
 * ============================================================= */
(function (global) {
  const D = global.SKData;
  const T = global.Tiers;                       // 档位分值表（A35/B20/C10/D5，±2）
  const U = global.AIUtil, BEL = global.AIBelief;
  const clamp = U.clamp, alive = U.alive, aliveF = U.aliveF, byId = U.byId;
  const isAlly = U.isAlly, pick = U.pick, gauss = U.gauss, knownOf = U.knownOf;
  const BAND_DOWN = U.BAND_DOWN, GRUDGE_W = U.GRUDGE_W;
  const ROLE2FACTION = BEL.ROLE2FACTION, FACTION_SET = BEL.FACTION_SET;
  const CLAIM_DECAY = BEL.CLAIM_DECAY, GRUDGE_DECAY = BEL.GRUDGE_DECAY;
  const DG_W = BEL.DG_W, TIER_BY_VAL = BEL.TIER_BY_VAL;
  const priorOf = BEL.priorOf, ensureE = BEL.ensureE, actF = BEL.actF, claimDecay = BEL.claimDecay;
  const credOf = BEL.credOf, credAdd = BEL.credAdd, setHardFloor = BEL.setHardFloor, chanFor = BEL.chanFor;
  const knownLockOf = BEL.knownLockOf, project = BEL.project;
  const addUniversal = BEL.addUniversal, universalOf = BEL.universalOf, hostileOf = BEL.hostileOf;
  const suspOf = BEL.suspOf, suspDist = BEL.suspDist, dangerOf = BEL.dangerOf, capability = BEL.capability;
  const once = BEL.once;
  /* v32 批 5′（角色注意力）：R 规则链事件的【事件族】归组 —— src 前缀 → ATTEND 族 key，
     集中一处（唯一映射源），供 MoE.absorb 查 Tiers.ATTEND 做写入侧注意力调制。
     未命中的 src（accuse/ask/quote/ans/king、priv 等公共货币族）返回 null → 权重 def 1，行为不变。
     settle:N01（破坏宣称兑现）→ infra；R17 族/追责 → lethal；对证/自证 → verify；票型/承诺 → ballot。 */
  const EVT_FAMILY = [
    [/^settle:N01/, 'infra'],
    [/^(R17|R17b|askVerify|grudge|rescue)/, 'lethal'],
    [/^(cross|crossRole|ansCross|R12|claim)/, 'verify'],
    [/^(R27|R28|R29|R40|R64|promiseMiss)/, 'ballot'],
  ];
  function evtFamilyOf(src) {
    if (!src) return null;
    for (const [re, fam] of EVT_FAMILY) if (re.test(src)) return fam;
    return null;
  }
  /* v32 批 4′（统一入账口）：本文件的全部 R 规则链写入（路径②）改道 MoE.absorb ——
     参数逐字段透传为 Claim（raw 直通写），本批只完成「统一入口 + 改道计数」，行为逐字节等价。
     原名 addEvent 保持不变 ⇒ 约 25 处调用点零改动；MoE 未加载时回退 BEL.addEvent
     （onExpose/onReveal 的无 MoE 降级分支依赖此兜底）。
     v32 批 5′：补传 evt = evtFamilyOf(src)，公开/推理事件进入角色注意力调制。 */
  const addEvent = (g, viewerId, targetId, delta, grudge, src, kind, tier, speakerId, chan, expert) =>
    (global.MoE && global.MoE.absorb)
      ? global.MoE.absorb(g, viewerId,
          [{ target: targetId, delta, grudge, src, kind, tier, speakerId, chan, expert }],
          { path: 'reason', evt: evtFamilyOf(src) })
      : BEL.addEvent(g, viewerId, targetId, delta, grudge, src, kind, tier, speakerId, chan, expert);
  /* 注：BAND_DOWN / GRUDGE_W 已下沉至 js/ai/util.js（跨层共用，单点定义） */

  /* v27（A6）：R38 自证族的档位不再硬编码在函数体内——全部经 Tiers.RULE 查表（红线：幅度唯一来源
     = 档位表；新增/调整规则必须先在 RULE 表登记，否则不可追溯）。同时统一 `doc → bio` 口径
     （D.ROLES 里没有 'doc'，旧 selfTiers 也没有 'doc' 键 → 语言层产 doc、推理层认 bio，
     宣称医生系完全不产证据）。 */
  const R38_RULE = {
    detective: 'R38divine', inspector: 'R38divine',
    bio: 'R38medic', rescue: 'R38medic', tempdoc: 'R38medic',
    sheriff: 'R38support', engineer: 'R38support', armed: 'R38support', assistant: 'R38support',
    bodyguard: 'R38guard', crew: 'R38crew',
  };
  function r38Tier(roleKey) {
    const key = roleKey === 'doc' ? 'bio' : roleKey;
    const rule = R38_RULE[key];
    return rule ? T.RULE[rule] : null;
  }
  /* 医生系家族（R30 假冒判定用：bio/rescue/tempdoc 之间互换口径不算撒谎）*/
  function medicFamily(r) { return r === 'bio' || r === 'rescue' || r === 'tempdoc'; }

  function onClaim(g, p, roleKey) {
    const tierKey = r38Tier(roleKey);
    if (tierKey == null) return;
    if (!once(g, `claim:${p.id}:${roleKey}`)) return;
    const v = T.SCORE[tierKey];
    const src = `claim:${p.id}:${roleKey}`;
    /* v31 裁定「调档位」：删除 crew 专属偏置——强度只由档位决定（R38crew = D+ 即最弱档）。
       幅度 = −round((7−5)×0.5) = −1（旧值 −8，经 D 档缩放后有效 −5.6 → 现 −0.7）。
       这是「幅度唯一来源 = 档位表」的彻底化：公式只剩一个共享旋钮（bias/half）。 */
    const SC = T.SELF_CLAIM;
    const d = Math.round(-(v - SC.bias) * SC.half);
    for (const o of g.players) {
      if (o.out || o.id === p.id) continue;
      addEvent(g, o.id, p.id, d, false, src, 'claim', tierKey, p.id, null, 'E8');
    }
  }

  /* ============ v23 批次 1：防透视闸门与证据回填 ============
     三类激活源不可混（§2.3）：① 黑板（公告/公开记录，全体可引用）② 交流（公开/私聊 Claim）
     ③ 自有（查验/受袭/互认——可支撑推理，不得原样输出，异形不能说「我知道 3 号是异形」= N354 禁区）。
     holds() = 防透视闸门：声称的依据必须是说话者确实掌握的信息，fail-closed（未知前缀一律不持有）。
     「系统不喂答案，但不禁止推理」——不阻止 AI 引用，只阻止引用它本不该知道的东西。 */
  function holds(g, speaker, src) {
    if (!speaker || !src) return false;
    const parts = String(src).split(':');
    const t = byId(g, +parts[1]);
    switch (parts[0]) {
      case '⑤': return !!t && !!t.destroyedExposed;                    // ⑤ 破坏者暴露（黑板）
      case '④': return !!t && !!t.repairExposed;                       // ④ 维修暴露（黑板）
      case '⑥': return !!t && !!t.out;                                 // 死亡揭示（黑板）
      case 'conflict': return !!t && !!t.hardConflict;                 // R13/R16 硬矛盾（黑板）
      case 'accuse': return g.players.some(x => x.id !== speaker.id && (x.accuseHistory || []).some(a => a.id === +parts[1]));   // 公开指控史（交流）
      case 'check': return !!(speaker.checkPool && speaker.checkPool.has(+parts[1]));                                        // 自有：神探查验
      case 'crewcheck': { const cc = speaker.crewChecks && speaker.crewChecks.get(+parts[1]); return !!(cc && cc.locked); }  // 自有：船员双查锁定
      default: return false;
    }
  }

  /* v23 批次 1：adjudicate——指控档位裁决。独立源计数（裁定 §6.1-2：同一源多条只算一条）：
     ≥2 条独立源 → L2 推理链指控 A−(33)；1 条可验证 → L1 引用指控 B−(18)；0 条 → L0 裸指控 C−(8)。
     band/evidence 回填进 IR 预留插槽（ir.js band/evidence，注释明写「由推理层回填」）。

     v26 修复（P1）：旧实现把 6 个源一律计价，其中 `accuse:` 的定义是「场上【任何人】的指控史里
     有没有该目标」——于是第一次之后的任何指控都自动升到 B−，叠加 ⑤/④ 即 A−，档位退化为
     「目标热度」的函数（与说话者掌握什么无关）→ 指控档位通胀、个体分叉消失（正是 v25 想修的
     「AI 是克隆体」反向恶化）。现在分三层计价：
       ① 说话者私有源：check: / crewcheck:（真正的「自有」激活源）
       ② 公开黑板源：⑤ / ④ / conflict:（全体可引用的官方公告事实）
       ③ 交流源：accuse:（转述）。单靠转述【不】升档（只到 C），必须与 ①/② 组合才构成引用/推理链指控。
       ④ 措辞调制（v26 新增）：NLP 三档 / IR payload.tier 此前被整体丢弃——
          soft 降一档；hard 且无任何来源时小幅升档（态度强硬但无据）。 */
  function adjudicate(g, speakerId, targetId, tier) {
    const sp = byId(g, speakerId), t = byId(g, targetId);
    if (!sp || !t) return { evidence: [], count: 0, band: 'C-' };
    const own = [];
    if (holds(g, sp, `check:${t.id}`)) own.push(`check:${t.id}`);
    if (holds(g, sp, `crewcheck:${t.id}`)) own.push(`crewcheck:${t.id}`);
    const board = [];
    if (holds(g, sp, `⑤:${t.id}`)) board.push(`⑤:${t.id}`);
    if (holds(g, sp, `④:${t.id}`)) board.push(`④:${t.id}`);
    if (holds(g, sp, `conflict:${t.id}`)) board.push(`conflict:${t.id}`);
    const relay = holds(g, sp, `accuse:${t.id}`);
    const ev = own.concat(board);
    if (relay) ev.push(`accuse:${t.id}`);
    const solid = own.length + board.length;                  // 非转述来源数
    let band = solid >= 2 ? 'A-' : solid === 1 ? 'B-' : relay ? 'C' : 'C-';
    if (tier === 'soft') band = BAND_DOWN[band] || band;
    else if (tier === 'hard' && solid === 0) band = relay ? 'C+' : 'C';
    return { evidence: ev, count: ev.length, band };
  }

  /* v23 批次 3：报复心行为项——grudge 事件累计（×0.9 跨夜衰减）转化为「优先投他 / 咬他」，
     不再只停在数字层面。GRUDGE_W 受性格调制：激进高、保守低。 */
  function grudgeLevel(g, p, id) {
    const evs = p.tEvents.get(id) || [];
    return evs.filter(e => e.grudge).reduce((a, e) => a + Math.abs(e.delta) * Math.pow(0.9, Math.max(0, g.night - e.night)), 0);
  }

  /* v23 批次 5：PHASES 调度——当前局势策略标签（tactics.phaseOf，特判条目优先） */
  function phaseTag(g, faction) {
    const ph = global.Tactics && global.Tactics.phaseOf ? global.Tactics.phaseOf(g) : null;
    return ph ? ph[faction] : null;
  }

  /* ============ v22 批次 5 第三阶段：宣称类延迟兑现结算（N01/N02/N03 + F02）============
     N01 外星人「我今夜破坏了」＋次夜停转夜 → 兑现（B−：兑现主体唯一＝外星人，代价是自报身份）；
     落空 → F02 未兑现即负信号（D−，claim 类衰减——可能被维修抵消，非必然撒谎）。
     兑现判据：宣称次夜 g.stopNight 为真（停转夜来源唯一＝外星人破坏）。 */
  function settleClaims(g) {
    for (const sp of g.players) {
      const pend = (sp.pendingDestroy || []).filter(x => x.night === g.night - 1);
      if (!pend.length) continue;
      sp.pendingDestroy = sp.pendingDestroy.filter(x => x.night !== g.night - 1);
      const cashed = !!g.stopNight;   // 本夜是否停转夜
      for (const o of g.players) {
        if (o.out || o.id === sp.id) continue;
        if (cashed) addEvent(g, o.id, sp.id, T.SCORE[T.RULE.settleHit], false, `settle:N01:${sp.id}:${g.night}`, 'fact', T.RULE.settleHit, sp.id);
        else addEvent(g, o.id, sp.id, T.SCORE[T.RULE.settleMiss], false, `settle:F02:${sp.id}:${g.night}`, 'claim', T.RULE.settleMiss, sp.id);
      }
    }
  }

  /* 指控（v23 批次 2：三档分级。此前全部等价 C+——神探「我查过 3 号」与划水
     「3 号开局这套发言我记下了」权重相同，且与总表「兑现是 A 档构成要件」自相矛盾）：
     L0 裸指控 C−(8) / L1 引用指控 B−(18) / L2 推理链指控 A−(33)——两者差距 1.0× → 4.1×。
     异形观察者差异化（批次 4）：指控落在我方队友头上时降档采信 ×0.5——不全额跟票加速错误共识。 */
  function onAccuse(g, accuserId, targetIds, tier) {
    const accuser = byId(g, accuserId);
    for (const tid of targetIds) {
      const t = byId(g, tid);
      if (!t || t.out || tid === accuserId) continue;
      const adj = adjudicate(g, accuserId, tid, tier);
      for (const o of g.players) {
        if (o.out || o.id === accuserId || o.id === tid) continue;
        const amt = T.SCORE[adj.band] * (o.faction === 'alien' && t.faction === 'alien' ? 0.5 : 1);
        addEvent(g, o.id, tid, amt, false, `accuse:${accuserId}:${tid}:${g.night}`, 'claim', adj.band, accuserId);
      }
      /* R31 报复心（v23 批次 3：区分两种报复 §3.1）——被冤枉（好人）愤怒硬辩全额 B−；
         被咬对（异形）警觉低强度报复 ×0.5，避免把注意力锁死在自己身上 */
      if (!t.out) {
        const evs = t.tEvents.get(accuserId) || [];
        const grudgeSum = evs.filter(e => e.grudge).reduce((a, e) => a + e.delta, 0);
        const base = t.faction === 'alien' ? Math.round(T.SCORE[T.RULE.grudge] * 0.5) : T.SCORE[T.RULE.grudge];
        if (grudgeSum < 25) addEvent(g, tid, accuserId, Math.min(base, 25 - grudgeSum), true, `grudge:${accuserId}:${tid}:${g.night}`, 'claim', t.faction === 'alien' ? T.RULE.grudgeSoft : T.RULE.grudge, accuserId);
      }
      /* v23 批次 4：异形阵营联动——分工响应（N372 三只分工），只写 E 不写 Dg（MoE 架构：
         专家不许直接写 Dg，Dg 由 hostile 项自然上升，保留可追溯性）。
         营救与自曝的两难（§4.1）显式建模：反咬指控者会留下指控记录 → R28 抱团指纹可检测。
         分工：被咬者本人低强度报复（上文 R31）＋一名营救者反咬指控者＋其余装不认识（N356）。
         营救者由性格决定：激进（容忍 ≤33）敢营救，保守（≤10）装不认识。 */
      if (t.faction === 'alien') {
        const mates = g.players.filter(x => x.faction === 'alien' && !x.out && !x.isHuman && x.id !== t.id && x.id !== accuserId);
        const rescuer = mates.slice().sort((a, b) => a.theta - b.theta)[0];
        if (rescuer && g.rng.chance({ 25: 0.7, 50: 0.4, 75: 0.15 }[rescuer.theta] || 0.4)) {
          addEvent(g, rescuer.id, accuserId, T.SCORE[T.RULE.rescueBack], false, `rescue:${t.id}:${accuserId}:${g.night}`, 'claim', T.RULE.rescueBack, accuserId, 'human', 'E12');
        }
      }
      (accuser.accuseHistory = accuser.accuseHistory || []).push({ night: g.night, id: tid });
    }
  }

  /* R22/R23 暴露（R22 为双向，必须分阵营实现）：
     repair → 人类评估者 −A（官方确证自家人）；敌方 +A−（定点清除目标）
     destroy → 全体 A−（破坏者暴露）
     v22 批次 2：E5（维修 ④）/ E1（破坏 ⑤）迁成专家输出——两事件均硬路由，行为等价 */
  function onExpose(g, targetId, delta, kind) {
    const evt = kind === 'repair' ? '④' : '⑤';
    const expert = kind === 'repair' ? 'E5' : 'E1';
    const M = global.MoE;
    for (const o of g.players) {
      if (o.out || o.id === targetId) continue;
      let d = delta;
      let tierKey = T.RULE.R23;
      /* v22 档位化：维修暴露人类 A（官方确证自家人，负向）/ 暴露方位 A− */
      if (kind === 'repair') { tierKey = o.faction === 'human' ? T.RULE.R22human : T.RULE.R22enemy; d = o.faction === 'human' ? -T.SCORE[tierKey] : T.SCORE[tierKey]; }
      else d = T.SCORE[T.RULE.R23] || delta;
      if (M) {
        M.emit(g, evt, o.id, [M.claim({
          expert, target: targetId, tier: tierKey, delta: d,
          src: `${kind}:${targetId}:${g.night}`, kind: 'fact', speakerId: targetId,
          speak: kind === 'repair' ? '④ 维修暴露：公布编号与职业' : '⑤ 破坏者暴露：累计破坏达 6.0',
        })]);
      } else addEvent(g, o.id, targetId, d, false, `${kind}:${targetId}:${g.night}`, 'fact', tierKey, targetId);
    }
  }

  /* 揭示时清算：R17 追责 / R17b 减免 / R29 投票追责 / R30 假冒（3.3 A/D/E）
     v22 批次 2：E6（死亡分析·指控验证）/ E4（质询验证）/ E3（票型 R64/R29）迁成专家输出——
     'reveal' 事件族全部硬路由（E4/E6/E3/E8），行为等价。
     v25 批次 5：emit 改为【按观察者累积、按 target 分组】一次性投递——旧写法每条
     Claim 单独 emit（arb_input_size 恒为 {1:100%}，三档仲裁与饱和疲劳结构上永不触发）。
     现在同一观察者对同一 target 的多条 Claim（如 R17+R64 同指一人）进同一仲裁。 */
  function onReveal(g, p) {
    const M = global.MoE;
    const nightFactor = g.night <= 2 ? 0.3 : g.night <= 4 ? 0.6 : 1.0;
    const pending = new Map();                             // viewerId -> claims[]
    const push = (viewerId, claim) => {
      if (!pending.has(viewerId)) pending.set(viewerId, []);
      pending.get(viewerId).push(claim);
    };
    const accusers = g.players.filter(x =>
      x.id !== p.id && (x.accuseHistory || []).some(a => a.id === p.id));
    for (const o of g.players) {
      if (o.out) continue;
      for (const a of accusers) {
        if (p.faction === 'human') {
          if (M) push(o.id, M.claim({ expert: 'E6', target: a.id, tier: T.RULE.R17, mult: Math.round(T.SCORE[T.RULE.R17] * nightFactor) / T.SCORE[T.RULE.R17], src: `R17:${a.id}:${p.id}`, kind: 'claim', speakerId: a.id, speak: `${a.id} 号的指控被证伪了` }));
          else { const d = Math.round(T.SCORE[T.RULE.R17] * nightFactor); addEvent(g, o.id, a.id, d, false, `R17:${a.id}:${p.id}`, 'claim', T.RULE.R17, a.id); }   // R17 错误指控（B+ × 阶段系数）
        } else {
          if (M) push(o.id, M.claim({ expert: 'E6', target: a.id, tier: T.RULE.R17b, src: `R17b:${a.id}:${p.id}`, kind: 'claim', speakerId: a.id, speak: `${a.id} 号咬对人了吧` }));
          else addEvent(g, o.id, a.id, -T.SCORE[T.RULE.R17b], false, `R17b:${a.id}:${p.id}`, 'claim', T.RULE.R17b, a.id);   // R17b 指控验证正确（C）
        }
      }
    }
    /* 质询者验证闭环：被质询者揭示为敌方 → 质询判断得到验证，观察者对质询者 −8；
       揭示为人类 → 质询≠指控，不追责（R39 只约束单夜过度质询） */
    if (p.faction !== 'human') {
      const askers = g.players.filter(x =>
        x.id !== p.id && (x.askHistory || []).some(a => a.id === p.id));
      for (const o of g.players) {
        if (o.out) continue;
        for (const a of askers) if (o.id !== a.id) {
          if (M) push(o.id, M.claim({ expert: 'E4', target: a.id, tier: T.RULE.askVerify, src: `askVerify:${a.id}:${p.id}`, kind: 'claim', speakerId: a.id, speak: `${a.id} 号问对人了` }));
          else addEvent(g, o.id, a.id, -T.SCORE[T.RULE.askVerify], false, `askVerify:${a.id}:${p.id}`, 'claim', T.RULE.askVerify, a.id);
        }
      }
    }
    /* R30 假冒身份被揭示 → 硬源置位 95（v21 改动 #9：不再做超档位增量——增量会被衰减侵蚀，
       与 tiers.js 置位语义不符；置位后不衰减、不可被软证据反向） */
    /* v27（A6-③）：统一 doc→bio 口径后，旧守卫 `p.claimedRole !== 'doc'` 变成死条件。
       真正要豁免的是【医生系内部互换】（宣称 bio 而真实是 rescue/tempdoc —— 三者同族，
       按「医生」声称不算撒谎）；跨族不符才触发 R30 假冒置位。 */
    if (p.claimedRole && !(medicFamily(p.role) && medicFamily(p.claimedRole)) && p.role !== p.claimedRole) {
      for (const o of g.players) {
        if (o.out || o.id === p.id) continue;
        setHardFloor(g, o.id, p.id, T.FLOOR.R30fakeRole);
      }
    }
    /* R64 投票声明对账：宣称投 p 的人 → p 为敌方 −15（投对可信）/ p 为人类 +20（带节奏/跟票）。
       只结算「本轮（当夜白天）」的声明，避免历史声明在每次揭示时重复触发。 */
    for (const sp of g.players) {
      if (sp.out) continue;
      const hit = (sp.declaredVotes || []).some(d => d.night === g.night && d.ids.includes(p.id));
      if (!hit) continue;
      for (const o of g.players) {
        if (o.out || o.id === sp.id) continue;
        if (M) push(o.id, M.claim({ expert: 'E3', target: sp.id, tier: p.faction === 'human' ? T.RULE.R64lie : T.RULE.R64trust, src: `R64:${sp.id}:${p.id}:${g.night}`, kind: 'claim', speakerId: sp.id, speak: `${sp.id} 号的投票声明对不上` }));
        else addEvent(g, o.id, sp.id, p.faction === 'human' ? T.SCORE[T.RULE.R64lie] : -T.SCORE[T.RULE.R64trust], false, `R64:${sp.id}:${p.id}:${g.night}`, 'claim', p.faction === 'human' ? T.RULE.R64lie : T.RULE.R64trust, sp.id);
      }
    }
    /* R29 投票追责：验票官视角（票源私有） */
    const hist = g.voteHistory || [];
    for (const round of hist) {
      for (const voter of Object.keys(round.src)) {
        if (+round.src[voter] === p.id) {
          for (const o of g.players) {
            if (o.out || o.role !== 'inspector') continue;
            if (M) push(o.id, M.claim({ expert: 'E3', target: +voter, tier: p.faction === 'human' ? T.RULE.R29human : T.RULE.R29enemy, src: `R29:${voter}:${p.id}:${round.night}`, kind: 'claim', speakerId: +voter, speak: `${voter} 号这一票投对了` }));
            else addEvent(g, o.id, +voter, p.faction === 'human' ? T.SCORE[T.RULE.R29human] : -T.SCORE[T.RULE.R29enemy], false, `R29:${voter}:${p.id}:${round.night}`, 'claim', p.faction === 'human' ? T.RULE.R29human : T.RULE.R29enemy, +voter);
          }
        }
      }
    }
    /* v25 批次 5：按 (观察者, target, expert) 分组一次性 emit——多 Claim 进同一仲裁。
       分组键含 expert：R17/R17b（E6）、askVerify（E4）、R64/R29（E3）是【总表规则事件】，
       跨专家的同 target 证据不是「专家分歧」——不能让三档仲裁吞掉规则减疑奖励
       （实测跨专家分组会把 R17b/askVerify 差两档吞进待验证队列，300 局 1400 条信任奖励蒸发，
       人类互信链断裂）。同专家同 target 的真分歧才进仲裁（多 Claim 率仍 > 0）。 */
    if (M) {
      for (const [viewerId, claims] of pending) {
        const byGroup = new Map();
        for (const c of claims) {
          const key = c.target + ':' + (c.expert || '?');
          if (!byGroup.has(key)) byGroup.set(key, []);
          byGroup.get(key).push(c);
        }
        for (const cs of byGroup.values()) M.emit(g, 'reveal', viewerId, cs);
      }
    }
  }

  /* 每日/每夜推理：R12/R36 唯一性冲突、R27/R28/R34 票型与沉默（验票官视角票型）、R7 假标记（医生）
     本函数一局内被多处调用（claimConflicts / 步骤 9 / M-speech），所有事件块均以幂等键去重 */
  function reason(g) {
    /* R12/R36 唯一性冲突：存活者中同一独占职业多人声称 → 双方各 +30（每冲突组合一次） */
    const groups = {};
    for (const p of alive(g)) {
      /* v27：`!== 'doc'` 为死条件（doc→bio 已统一；D.ROLES 无 'doc' 键）——对跳只豁免 crew */
      if (p.claimedRole && p.claimedRole !== 'crew')
        (groups[p.claimedRole] = groups[p.claimedRole] || []).push(p.id);
    }
    for (const role of Object.keys(groups)) {
      if (groups[role].length < 2) continue;
      const key = `R12:${groups[role].slice().sort((a, b) => a - b).join('-')}`;
      if (!once(g, key)) continue;
      for (const o of g.players) {
        if (o.out) continue;
        for (const id of groups[role]) if (id !== o.id) addEvent(g, o.id, id, T.SCORE[T.RULE.R12], false, `R12:${groups[role].slice().sort((a, b) => a - b).join('-')}`, 'fact', T.RULE.R12, id, null, 'E8');   // 公开对跳事实，不衰减；说话者 = 对跳者；专家 = E8
      }
    }
    /* R34 已删除（v20 待办 #3）：「沉默可疑 +12」与定案 10「沉默代价微小」直接冲突，
       且惩罚异形的合法生存策略。沉默的压力信号改由被质询后的应答评级承担（evaluateAnswer）。 */
    /* R27 早期投票活跃 + R28 抱团 + R40 言行不一致：验票官视角（票源私有），逐条幂等 */
    for (const ins of g.players) {
      if (ins.out || ins.role !== 'inspector') continue;
      for (const round of (g.voteHistory || [])) {
        for (const voter of Object.keys(round.src)) {
          const tgt = round.src[voter];
          if (tgt == null) continue;
          if (round.night <= 2 && once(g, `R27:${round.night}:${voter}`))
            addEvent(g, ins.id, +voter, T.SCORE[T.RULE.R27], false, `R27:${voter}:${round.night}`, 'claim', T.RULE.R27, +voter);          // R27
          const again = (g.voteHistory || []).filter(r => r.src[voter] === tgt).length;
          if (again >= 2 && once(g, `R28:${voter}:${tgt}`))
            addEvent(g, ins.id, +voter, T.SCORE[T.RULE.R28], false, `R28:${voter}:${tgt}`, 'claim', T.RULE.R28, +voter);          // R28 抱团
        }
      }
      /* R40 指控 A 却投 B（验票官可见票源）：每「指控-投票」组合一次。
         v26 修复：旧实现用当代的 g.voteSources 去对任意历史夜的指控做「言行不一」判定——
         指控发生在第 N 夜、票源取的是最新一轮 → 跨轮误报。改为按【指控当夜】的票型记录取源。 */
      for (const p of alive(g)) {
        for (const a of (p.accuseHistory || [])) {
          const round = (g.voteHistory || []).filter(r => r.night === a.night).pop();   // 同夜可能有白天/会议两轮，取后一轮
          if (!round || round.src[p.id] == null || round.src[p.id] === a.id) continue;
          if (once(g, `R40:${p.id}:${a.id}:${a.night}`))
            addEvent(g, ins.id, p.id, T.SCORE[T.RULE.R40], false, `R40:${p.id}:${a.id}:${a.night}`, 'claim', T.RULE.R40, p.id);
        }
      }
    }
    /* R7 假标记识别（医生）：标记滞留 ≥4 夜未致死 → 硬源置位 85（v21 改动 #9：不再做超档位增量，
       置位后不衰减、不可被软证据反向；每标记一次，非累加） */
    for (const doc of g.players) {
      if (doc.out || ['bio', 'rescue', 'tempdoc'].indexOf(doc.role) < 0) continue;
      for (const [id, seen] of (doc.markSeen || new Map())) {
        const t = byId(g, id);
        if (t && !t.out && t.infection && g.night - seen >= 4 && once(g, `R7:${doc.id}:${id}:${seen}`))
          setHardFloor(g, doc.id, id, T.FLOOR.R7fakeMark);
      }
    }
    /* 对证链（人类推理核心）：公开声称 vs 各观察者私有已知（查验/公告/私聊所得）
       —— 阵营冲突 → +40；同阵营但职业不符（转职豁免）→ +25。每对观察关系只对证一次 */
    for (const o of g.players) {
      if (o.out) continue;
      for (const c of alive(g)) {
        /* v27（A6-②）：crew 不再豁免对证——「我是普通船员」正是最廉价的空口宣称，
            旧写法把它整条跳过，于是谎称船员永远不会被对证击穿（零代价洗白）。
            D.ROLES 里没有 'doc'，非法/旧别名由下面的 `if (!rd) continue` 兜住。 */
        if (c.id === o.id || !c.claimedRole) continue;
        const k = o.known.get(c.id);
        if (!k || !k.faction) continue;
        const rd = D.ROLES[c.claimedRole];
        if (!rd) continue;
        if (k.faction !== rd.faction && once(g, `cross:${o.id}:${c.id}`)) {
          addEvent(g, o.id, c.id, T.SCORE[T.RULE.cross], false, `cross:${o.id}:${c.id}`, 'claim', T.RULE.cross, c.id);            // 对证不符：声称阵营与私有已知冲突（A−）
        } else if (k.role && rd.faction === k.faction && k.role !== c.claimedRole &&
                   !c.transferred && D.ROLES[k.role] && D.ROLES[k.role].faction === k.faction &&
                   once(g, `crossRole:${o.id}:${c.id}`)) {
          addEvent(g, o.id, c.id, T.SCORE[T.RULE.crossRole], false, `crossRole:${o.id}:${c.id}`, 'claim', T.RULE.crossRole, c.id);        // 同阵营职业不符（B+）
        }
      }
    }
    /* R39 质询过频：单夜对同一目标质询 >3 次的提问者 → +5（骚扰无信息量） */
    for (const [key, n] of Object.entries(g.askTally || {})) {
      if (n > 3 && once(g, `R39:${key}`)) {
        const asker = byId(g, +key.split(':')[0]);
        if (asker && !asker.out) for (const o of g.players) {
          if (o.out || o.id === asker.id) continue;
          addEvent(g, o.id, asker.id, T.SCORE[T.RULE.R39], false, `R39:${key}`, 'claim', T.RULE.R39, asker.id);
        }
      }
    }
    /* R13/R16 硬矛盾层（2.5，最高优先级）：公开声称的职业阵营与系统揭示（⑥⑩/神探公告）冲突 → 置位 */
    for (const t of alive(g)) {
      /* v27：'doc' 为死条件（见 A6-③ 口径统一）*/
      if (!t.claimedRole || t.claimedRole === 'crew' || t.hardConflict) continue;
      const rd = D.ROLES[t.claimedRole];
      if (!rd || !t.revealed || !t.revealed.faction) continue;
      if (t.revealed.faction !== rd.faction && once(g, `R13:${t.id}:${t.claimedRole}`)) {
        t.hardConflict = true;
      }
    }
    emitKingSignals(g);           // v21 审查 P0-1：king 通道判据表（每夜评估，幂等）
    /* v22 批次 5 第二阶段：可执行通道评估（普适层第一批——破坏算术族，仅夜间结算后一次） */
    if (g.step === '9' && global.MoE && global.MoE.runChannelsAll) global.MoE.runChannelsAll(g);
    /* v22 批次 5 第三阶段：宣称类延迟兑现结算（N01/N02/N03 + F02），仅夜间结算后 */
    if (g.step === '9') settleClaims(g);
    updatePublicThreat(g);
  }

  /* 群体威胁度共识（原型审查用快照；规格中怀疑度绝对私有，AI 决策不得读取它——见 vote 弃保跟票）。
     口径：共识 = 统一基准（先验，v21 改动 #1 回收自 baseRate）+ 各 AI 的【增量】均值。
     好处：①开局全体一致，不因异形先验 50 / 队友硬锁 0 而产生阵营性偏置；
     ②榜单只反映公开指控、暴露、追责等「公开可推」的增量，符合显示方案 8.2 定位 */
  /* v28（B2）：共识快照的基准与钳制上移到 Tiers.CONSENSUS（DEV 展示口径，AI 决策禁读） */
  const CONSENSUS_BASE = T.CONSENSUS.base;
  function updatePublicThreat(g) {
    /* v32 语义收窄注记：此处 isHuman 是【显示口径】（共识快照只聚合 AI 增量，供 DEV/威胁度榜
       展示），不是机制 gate——AI 决策禁止读取 g.threat（规格定案），真人增量不进显示均值。
       属「渲染什么」职责（ui 语义），不在禁区清理范围。 */
    const agents = g.players.filter(p => !p.isHuman && !p.out);
    g.threat = {};
    if (!agents.length) return;
    for (const t of alive(g)) {
      let s = 0;
      for (const a of agents) {
        s += clamp(suspOf(g, a, t.id) - priorOf(g, a), T.CONSENSUS.incLo, T.CONSENSUS.incHi);   // 仅取私有增量（怀疑度共识）
      }
      g.threat[t.id] = Math.round(clamp(CONSENSUS_BASE + s / agents.length, T.CONSENSUS.incLo, T.CONSENSUS.incHi));
    }
  }

  function onAsk(g, speakerId, targetIds) {
    const sp = byId(g, speakerId);
    for (const tid of targetIds) {
      const t = byId(g, tid);
      if (!t || t.out || tid === speakerId) continue;
      for (const o of g.players) {
        if (o.out || o.id === speakerId || o.id === tid) continue;
        addEvent(g, o.id, tid, T.SCORE[T.RULE.askPress], false, `ask:${speakerId}:${tid}:${g.night}`, 'claim', T.RULE.askPress, speakerId, null, 'E4');
      }
      /* 质询史：目标揭示后参与验证闭环（指控史的同款机制，量级更低——质询≠指控） */
      (sp.askHistory = sp.askHistory || []).push({ night: g.night, id: tid });
    }
  }
  /* 转述指控：「X 说 Y 是异形」→ Y 承受 +6，X 记入 accuseHistory（事后随揭示参与 R17 验证） */
  function onQuote(g, speakerId, quotes) {
    for (const q of quotes) {
      const t = byId(g, q.target), by = byId(g, q.by);
      if (!t || !by || t.out || by.out || q.target === speakerId) continue;
      for (const o of g.players) {
        if (o.out || o.id === q.target) continue;
        addEvent(g, o.id, q.target, T.SCORE[T.RULE.quote], false, `quote:${q.by}:${q.target}:${g.night}`, 'claim', T.RULE.quote, q.by);
      }
      (by.accuseHistory = by.accuseHistory || []).push({ night: g.night, id: q.target, quoted: true });
    }
  }
  /* ---------- 质询-应答闭环（v4 7.4/7.5）：被质询者当场作答，观察者按应答质量调整威胁度 ---------- */
  /* 生成应答：quality ∈ truth(−3) / vague(+8) / refuse(+12) / lie(+15)，异形倾向含糊与谎言 */
  function answerQuestion(g, p, askerId) {
    const rng = g.rng;
    const evil = p.faction !== 'human';
    const roll = rng.next();
    let quality, text;
    if (evil) {
      if (roll < 0.40) { quality = 'vague'; text = pick(rng, [`我昨晚在忙自己的事，细节没必要全交代。`, `这问题我answered过类似的，翻记录去。`, `轮到你审我？先把你自己说清楚。`]); }
      else if (roll < 0.65) { quality = 'refuse'; text = pick(rng, [`我拒绝回答这种带预设的质询。`, `等你拿出证据再来问我。`]); }
      else if (roll < 0.90) { quality = 'lie'; text = pick(rng, [`我是普通船员，昨晚协助维修，不信拉倒。`, `我一直在做维修，场上有记录的不过是我没说话而已。`]); }
      else { quality = 'truth'; text = pick(rng, [`问就问吧，我昨晚的行踪经得起查。`, `我没什么可藏的，票该投谁投谁。`]); }
      if (quality === 'lie') p.claimedRole = p.claimedRole || 'crew';
    } else {
      if (roll < 0.70) {
        quality = 'truth';
        if (p.role === 'crew' && p.crewChecks.size) {
          const r0 = [...p.crewChecks.entries()][0];
          text = `我是普通船员，查过 ${+r0[0]} 号：` + (r0[1].locked ? `阵营是${D.FACTION[r0[1].locked].name}。` : `排除了${(r0[1].excludes || []).map(x => D.ROLES[x].name).join('、')}。`);
        } else if (p.role === 'detective') {
          text = `我是神探，查验结果暂不公布，但我的链路是干净的。`;
        } else text = pick(rng, [`我是${D.ROLES[p.role] ? D.ROLES[p.role].name : '船员'}，昨晚的行踪可以跟任何人互对。`, `我如实回答：昨晚我在做本职工作，细节私下可对。`]);
      } else if (roll < 0.90) { quality = 'vague'; text = pick(rng, [`细节我记不全了，但我的行动对得起自己阵营。`, `这个问题明天再谈，今天先聚焦更可疑的人。`]); }
      else { quality = 'refuse'; text = pick(rng, [`公开说我立场没问题，具体细节保留。`, `我不习惯被当堂审问，拒绝回答。`]); }
    }
    return { text, quality };
  }
  /* 应答质量评估：全体 AI 观察者按 quality 调整对应答者的威胁度（7.5 增量表） */
  function evaluateAnswer(g, answerer, quality) {
    if (answerer.out) return;
    /* v21 审查 #6：应答评级直接携带档位字符串（truth 是负值 → 反向通道，档位照记） */
    const qmap = { truth: [-T.SCORE[T.RULE.ansTruth], T.RULE.ansTruth], vague: [T.SCORE[T.RULE.ansVague], T.RULE.ansVague], refuse: [T.SCORE[T.RULE.ansRefuse], T.RULE.ansRefuse], lie: [T.SCORE[T.RULE.ansLie], T.RULE.ansLie] };
    const [delta, tierKey] = qmap[quality] || [T.SCORE['C-'], 'C-'];
    for (const o of g.players) {
      if (o.out || o.id === answerer.id) continue;
      addEvent(g, o.id, answerer.id, delta, false, `ans:${quality}:${answerer.id}:${g.night}`, 'claim', tierKey, answerer.id);
    }
    /* 对证：应答中的声称与观察者私有已知冲突 → 重罚（人类的对证链核心） */
    if (answerer.claimedRole) {
      const cf = D.ROLES[answerer.claimedRole] ? D.ROLES[answerer.claimedRole].faction : null;
      if (cf) for (const o of g.players) {
        if (o.out || o.id === answerer.id) continue;
        const k = o.known.get(answerer.id);
        if (k && k.faction && k.faction !== cf && once(g, `ansCross:${o.id}:${answerer.id}`)) {
          addEvent(g, o.id, answerer.id, T.SCORE[T.RULE.cross], false, `ansCross:${o.id}:${answerer.id}`, 'claim', T.RULE.cross, answerer.id);       // 当场对证不符（A−）
        }
      }
    }
  }

  /* 汇报查验（无身份声称时视为隐式自证）：触发 R38 船员自证链，且每局每人只触发一次 */
  function onReport(g, p) {
    if (p.claimedRole) return;
    if (!once(g, `selfReport:${p.id}`)) return;
    p.claimedRole = 'crew';
    onClaim(g, p, 'crew');
  }
  /* v21 §5.1 口径修正：异形没有任何查验能力（5.8 行动菜单仅出刀/感染/破坏/结茧）——
     异形宣称「我查了 X」→ 对全体观察者 A⁻ +33（来源致命，与 A− 档同量级才有击穿力，裁定 §3.1）；
     神探 / 外星人宣称查验不构成暴露（二者本就有查验能力，v4.1 4.7 / 6.1）。 */
  function onCheckClaim(g, p) {
    /* v28（B2）：档位字符串 'A-' 上移到 Tiers.RULE.checkLie（唯一真源，便于标定与追溯） */
    const tier = T.RULE.checkLie;
    for (const o of g.players) {
      if (o.out || o.id === p.id) continue;
      addEvent(g, o.id, p.id, T.SCORE[tier], false, `checkClaim:${p.id}:${g.night}`, 'claim', tier, p.id);
    }
  }

  /* ============ king 通道判据表（v21 实现审查 P0-1）============
     此前 chanFor 只产出 human/alien，king 通道除先验外永远收不到证据——人类 AI 永远
     无法形成「此人是外星人」的判断，外星人恒被当成「最像异形的那个人」优先清除
     （实测外星人胜率 6.4% 的可归因因果链）。以下判据全部基于 AI 合法可见的公开行为
     （指控史 / 质询史 / 公开宣称），不读任何隐藏状态：
     K1 隐身第三方指纹：存活 ≥3 夜却从不指控、从不质询、从不宣称身份——异形有强烈的
        咬人 / 构陷 / 带节奏动机（指控是其核心武器），外星人无此约束。零阵营贡献的
        存活者向 king 通道累积 D 档证据（每目标每 2 夜一次，观察者为人类/外星人视角）。
     K2 互保链指纹（v26 判据修正）：一名非人类 E 被公开揭示（夜 R）之后，仍去指控
        【在 R 之前就指控过 E 的人】（= 反咬揭发者）→ alien 通道加压（参与异形互保链）。
        旧判据保留的是「揭示之后才指控 E 本人」——敌人已被官方公布，指控他毫无风险，
        是最正常的平民行为，把它记为异形指纹属系统性误报（判据写反）。 */
  function emitKingSignals(g) {
    for (const t of alive(g)) {
      /* v27（A5）三处口径修正：
         ① 档位走 Tiers.RULE.kingSilent（C），不再硬编码 SCORE['D']——D 档=5 还要再乘
            (0.4+0.6C) 的可信度缩放，实际压力近乎为零，等于机制在场但不起作用；
         ② 触发面收紧：「沉默」的定义改为【零公开行为】actF(g,t)===0（含承诺、维修暴露），
            旧的「未指控/未质询/未宣称」会把「只做承诺」「只维修」的人也误算进去；
         ③ 频次由每 2 夜收紧为每 3 夜，并排除【本夜正被蛰伏沉默压制】的目标——
            被外星人封口不是它自己选择的沉默，罚它是判据误伤。 */
      const silenced = t.silenceNight != null && t.silenceNight >= g.night;
      const silent = !silenced && actF(g, t) === 0;
      if (silent && g.night >= 3 && once(g, `kingSilent:${t.id}:${g.night - (g.night % 3)}`)) {
        for (const o of g.players) {
          if (o.out || o.id === t.id || o.faction === 'alien') continue;
          addEvent(g, o.id, t.id, T.SCORE[T.RULE.kingSilent], false, `kingSilent:${t.id}:${g.night - (g.night % 3)}`, 'claim', T.RULE.kingSilent, t.id, 'king');
        }
      }
      /* K2：t 是否「反咬揭发者」——对每个已被揭示的敌人 E，找出在揭示前指控过 E 的人 b，
         再看 t 是否在揭示后指控了 b。命中则该「护队」对冒烟（每对每局一次）。 */
      for (const E of g.players) {
        if (!E.out || !E.revealed || E.revealed.faction === 'human') continue;
        const R = E.outNight || 0;
        for (const b of g.players) {
          if (b.out || b.id === E.id || b.id === t.id) continue;
          if (!(b.accuseHistory || []).some(x => x.id === E.id && x.night < R)) continue;   // b = 揭示前的揭发者
          if (!(t.accuseHistory || []).some(x => x.id === b.id && x.night >= R)) continue;  // t 在揭示后反咬 b
          if (!once(g, `kingGuard:${t.id}:${b.id}:${E.id}`)) continue;
          for (const o of g.players) {
            if (o.out || o.id === t.id) continue;
            addEvent(g, o.id, t.id, T.SCORE[T.RULE.ansVague], false, `kingGuard:${t.id}:${b.id}:${E.id}`, 'claim', T.RULE.ansVague, t.id, 'alien');
          }
        }
      }
    }
  }
  /* 私聊信号：仅对接收方 AI 生效（弱化幅度），可写入 known 弱记录影响投票权重 */
  function onPrivate(g, receiverId, speakerId, sig) {
    const r = byId(g, receiverId);
    if (!r || r.out) return;
    if (sig.claim && !r.known.get(speakerId)) {
      const role = sig.claim === 'doc' ? 'bio' : sig.claim;
      r.known.set(speakerId, { faction: null, role, viaPrivate: true });
      /* v26 修复（P0-① 透视）：旧实现 `sp.faction === r.faction` 读说话者【真相阵营】。
         现改为按【声明的职业】推阵营（ROLE2FACTION），与接收者自身阵营比较——接收者知道自己的
         阵营，这是合法推论；私聊内容一律按 claim 处理并按可信度 C 缩放（v22 批次 3「私聊降 D 档」落地）。 */
      const cs = 0.4 + 0.6 * credOf(r, speakerId);
      const cf = ROLE2FACTION[role] || null;
      const same = !!(cf && cf === r.faction);
      addEvent(g, receiverId, speakerId, (same ? -T.SCORE[T.RULE.privSame] : T.SCORE[T.RULE.privClaim]) * cs, false, `privClaim:${speakerId}:${g.night}`, 'claim', same ? T.RULE.privSame : T.RULE.privClaim, speakerId);
    }
    for (const tid of (sig.accuse || [])) {
      if (tid === receiverId) continue;
      addEvent(g, receiverId, tid, T.SCORE[T.RULE.askPress], false, `privAccuse:${speakerId}:${tid}:${g.night}`, 'claim', T.RULE.askPress, speakerId);
    }
  }
  /* 私聊共享（AI 主动交底）：接收方写入弱 known + 威胁度调整。
     v26：share.faction 是【交底内容】（说话者自己的查验结果），不是说话者的真相阵营——
     接收者拿到的是一条 claim，因此按可信度 C 缩放（0.4+0.6C），落实「私聊一律降档」的裁定；
     同时经 viaPrivate 标记，永不进入 knownLockOf 的硬源。 */
  function onPrivateShare(g, receiverId, share) {
    const r = byId(g, receiverId);
    if (!r || r.out || !share) return;
    const cur = r.known.get(share.id);
    if (!cur || !cur.faction) {
      r.known.set(share.id, { faction: share.faction, role: share.role || null, viaPrivate: true });
      const cs = 0.4 + 0.6 * credOf(r, share.id);
      addEvent(g, receiverId, share.id, (share.faction === 'human' ? -T.SCORE[T.RULE.privShare] : T.SCORE[T.RULE.privClaim]) * cs, false, `privShare:${share.id}:${g.night}`, 'claim', share.faction === 'human' ? T.RULE.privShare : T.RULE.privClaim, share.id);
    }
  }


  /* R64 投票声明对账（§7.4，第一段）：宣称投 X 而 X 零票 → 必定撒谎（⑨得票公开可查），
     观察者对声明者 +25。X 出局的 −15/+20 在 onReveal 结算（需揭示身份）。 */
  function onVoteSettle(g, counts) {
    for (const sp of g.players) {
      if (sp.out || !(sp.declaredVotes || []).length) continue;
      const fired = (sp.declaredVotes || []).some(d => d.night === g.night &&
        d.ids.some(x => !counts[x]));
      if (!fired) continue;
      for (const o of g.players) {
        if (o.out || o.id === sp.id) continue;
        addEvent(g, o.id, sp.id, T.SCORE[T.RULE.R64lie], false, `R64lie:${sp.id}:${g.night}`, 'claim', T.RULE.R64lie, sp.id);
      }
    }
    settlePromises(g, counts);   // v21 审查 P0-2：承诺兑现 → C 表 / 未兑现 → S
  }

  /* 承诺兑现结算（v21 审查 P0-2 附带，规格 §4.4）：C 表落地路径。
     兑现 → 奖励发给 C：弱 +0.05 / 中 +0.15 / 强 +0.30（先押可信度，再放大后续 D 档权重）；
     未兑现（可验证承诺）→ 反向惩罚 S：弱 +8 / 中 +20 / 强 +35。
     兑现判据（v26 修复 P1）：必须看【承诺者本人是否投了承诺目标】（g.voteSources[sp.id]）。
     旧实现用「承诺目标本夜是否得票 > 0（counts）」——那是【别人】的行为：只要目标被任何人投中，
     承诺者即使自己弃票也算「兑现」；目标零票则惩罚承诺者，与他做没做无关 → 奖励/惩罚近似随机，
     C 表（可信度）随之失去意义，而 D 档缩放 (0.4+0.6C) 全靠它。
     无目标的承诺（「我可能会查验」这类弱承诺）不参与结算。
     保镖「我保护 X」公开不可验证、施术者私有可感（§5.2）——verifiable=false，不适用结算。 */
  function settlePromises(g, counts) {
    /* v31 批 2（A3）：词表与三张幅度表上移到 Tiers.PROMISE（唯一真源）。
       并新增结算方式分派：vote（承诺者本人投票，v26 判定）· announce（是否发布公告，批 2 新增）·
       none（公开不可验证，verifiable=false 已在过滤阶段排除）。 */
    const PV = T.PROMISE;
    for (const sp of g.players) {
      /* v31 批 2 时序修正：预告类承诺（announce）在【承诺次夜】才结算——公告只能在次夜步骤 2 发布，
         按当夜结算等于「发出预告的瞬间就判违约」（首轮实测 500 局 632 次误判违约）。
         投票类承诺（vote）仍是当夜结算（发言与投票在同一白天周期内）。 */
      const ps = (sp.promises || []).filter(x => x.verifiable !== false &&
        ((x.kind || 'vote') === 'announce'
          ? (!x.settled && x.night <= g.night - 2)      /* 预告：留出「次夜查验 + 再一夜公告」两个夜晚 */
          : x.night === g.night));
      if (!ps.length) continue;
      for (const pr of ps) {
        const tier = pr.tier || PV.WEAK;
        if (!(pr.targets || []).length) continue;                     // 无指向的承诺不可核验，不结算
        /* v31 批 2 口径修正（实测驱动）：预告类承诺在【承诺者或目标已出局】时失效，不判违约——
           神探一旦公开预告「我今晚查 X」，异形下一夜就会优先刀他（500 局实测 57 次预告里
           56 名神探在结算前出局）。死人无法履约，再判 A− 违约等于双重惩罚，
           并会把人类胜率从 32.8% 直接压到 24.6%。目标出局同理（对一具尸体无从查验/公告）。 */
        if ((pr.kind || 'vote') === 'announce') {
          const t0 = byId(g, pr.targets[0]);
          if (sp.out || !t0 || t0.out) {
            pr.settled = true;
            if (!g._promiseSettle) g._promiseSettle = { hit: {}, miss: {}, void: {} };
            g._promiseSettle.void = g._promiseSettle.void || {};
            g._promiseSettle.void[tier] = (g._promiseSettle.void[tier] || 0) + 1;
            continue;
          }
        }
        let fulfilled;
        if ((pr.kind || 'vote') === 'announce') {
          /* 神探预告（A01/A02）的兑现判据 = 该目标是否【在承诺夜之后】被公开发布过；
             steps.js 在发布时写 rec.published / rec.pubNight（批 2 新增字段）。
             预告只结算一次（settled 标记）。 */
          pr.settled = true;
          const rec = sp.checkPool && sp.checkPool.get(pr.targets[0]);
          fulfilled = !!(rec && rec.published && (rec.pubNight || 0) > pr.night);
        } else {
          const myVote = g.voteSources ? g.voteSources[sp.id] : null;
          fulfilled = myVote != null && (pr.targets || []).indexOf(myVote) >= 0;
        }
        /* v31 批 2 仪器：兑现 / 违约分档计数（旧口径只有「违约」能从事后证据里数出来，
           兑现走的是 credAdd、没有事件，因此长期显示为 0 —— 属仪器缺口，不是机制没跑） */
        if (!g._promiseSettle) g._promiseSettle = { hit: {}, miss: {} };
        (g._promiseSettle[fulfilled ? 'hit' : 'miss'])[tier] = (g._promiseSettle[fulfilled ? 'hit' : 'miss'])[tier] + 1 || 1;
        if (fulfilled) {
          for (const o of g.players) {
            if (o.out || o.id === sp.id) continue;
            credAdd(g, o.id, sp.id, PV.cred[tier] != null ? PV.cred[tier] : 0.05);
          }
        } else {
          for (const o of g.players) {
            if (o.out || o.id === sp.id) continue;
            addEvent(g, o.id, sp.id, PV.miss[tier] != null ? PV.miss[tier] : 8, false, `promiseMiss:${sp.id}:${g.night}`, 'claim', PV.name[tier] || 'C', sp.id);
          }
        }
      }
    }
  }

  /* 注：全局导出在文件末尾统一做一次（v26：此处原有第二份 global.AI 赋值，
     与末尾那份重复且被后者整体覆写，属死代码——已删除，避免两处清单漂移）。 */


  global.AIPerceive = {
    onClaim, holds, adjudicate, grudgeLevel, phaseTag, settleClaims, onAccuse, onExpose, onReveal, reason, updatePublicThreat, onAsk, onQuote, answerQuestion, evaluateAnswer, onReport, onCheckClaim, emitKingSignals, onPrivate, onPrivateShare, onVoteSettle, settlePromises,
  };
})(typeof window !== 'undefined' ? window : globalThis);
