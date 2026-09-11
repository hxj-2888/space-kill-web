/* =============================================================
 * 太空杀 · AI 决策层（自 js/ai.js 解耦，v27 模块化第三批）
 *
 * 职责：把「账本」变成「动作」——发言 / 投票 / 夜间行动，全部经 ε-greedy 效用选择。
 *   · 效用基座：EPS（0.4/0.65/0.15，下限 0.05）/ argmax / confOf / urgency / threatTop
 *   · 白天发言：speak（事实驱动 + 西塔门限 + Speakable 候选 + Tactics 排错）
 *   · 投票：vote（人类/异形读 dangerOf；外星人读 p_alien；「不做」同为候选）
 *   · 决策总入口：decide（夜间行动 / 投票 / 质询 / 邀请 / 自曝等全部 case）
 *   · 辅助：inviteUtility / evilIntent / canKill / clearedK / dirOcc / exposeRiskInc / rankLow / exposedEngineer
 *
 * 依赖：global.AIPerceive（3 处：onClaim 宣称入账 / grudgeLevel 记仇权重 / phaseTag 阶段系数）·
 *       AIUtil · AIBelief；另使用 IR / Speakable / Tactics / MoE / Lang / Bridge 等全局。
 * 被谁调用：engine.js（每步决策请求）· Bridge（发言）· js/ai.js 门面导出。
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
  const addEvent = BEL.addEvent, once = BEL.once;
  /* 入账层依赖（3 处，静态扫描确认无反向依赖） */
  const PER = global.AIPerceive;
  const onClaim = PER.onClaim, grudgeLevel = PER.grudgeLevel, phaseTag = PER.phaseTag;

  /* ============ 紧迫度（5.3，★时间尺度修复：基础项 0.35） ============ */
  function urgency(g) {
    if (g.extinction || g.tiers[9]) return 0;
    const cd = clamp(1 - g.countdown / 24, 0, 1);
    const nextTier10 = g.net10 < 30 ? 30 : g.net10 < 60 ? 60 : 90;   // v4.1 定案43：net 整数（×10）
    const gap = Math.max(0, nextTier10 - g.net10) / 10;
    const tier = gap < 0.5 ? 1 : clamp(1 - gap / 3, 0, 1) * 0.6;
    const prog = clamp(g.night / 7, 0, 1);
    return 0.35 + 0.5 * cd + 0.3 * tier + 0.2 * prog;
  }

  /* 已达维修暴露阈值的人类工程师／助理工程师（R22 双向锚点） */
  function exposedEngineer(g, x) {
    return !x.out && x.faction === 'human' && x.repairExposed && (x.role === 'engineer' || x.role === 'assistant');
  }

  /* v28（B1 裁定）：「对手方还剩多少维修能力」——全部来自【合法信息】，不读真相阵营/职业：
     ① ④ 维修暴露（官方公示，公开黑板事实）              → 权重 1
     ② p.known 台账里带职业的记录（⑥⑩揭示 / 查验锁定）  → 权重 1（工程师/助理）/ 0.5（普通船员）
     ③ 存活者的公开职业宣称，按【对说话者的可信度 C】折扣 → C ≥ 0.6 才计入（宣称可伪造）
     用途：作为破坏效用里的「阻力项」——对手方维修能力越强，破坏的期望收益越低。
     这是「让 AI 依据推理库实时评估破坏」的核心输入之一（旧实现完全没看这一项）。 */
  function knownRepairers(g, p) {
    let n = 0;
    for (const x of g.players) {
      if (x.out || x.id === p.id || isAlly(p, x)) continue;
      if (x.repairExposed) { n += 1; continue; }
      const k = p.known.get(x.id);
      if (k && (k.role === 'engineer' || k.role === 'assistant')) { n += 1; continue; }
      if (k && k.role === 'crew') { n += 0.5; continue; }
      if ((x.claimedRole === 'engineer' || x.claimedRole === 'assistant') && credOf(p, x.id) >= 0.6) n += 0.5;
      else if (x.claimedRole === 'crew' && credOf(p, x.id) >= 0.6) n += 0.25;
    }
    return n;
  }

  /* ============ ε-greedy（v21 改动 #10 / §4.5，取代 gauss 噪声）============
     劣解池加权采样：全部选项 → 过滤说不通的（-Infinity）→ 60% 取最优 → ε 在其余按效用加权采样。
     ε 是硬配额：不管效用差距多大都要分叉（gauss 按效用差加权，差距大时退化为 argmax，做不到这点）。
     ε 绑主观置信度（分布最大项，非熵）：信息不全时赌一把是理性的，信息闭环时还赌是犯蠢；
     被误导的 AI 果断做错选择是好剧情，错误可归因。硬源确证（conf=1）时归零——那不是推理，是事实。
     硬下限 0.05 防信息茧房。ε 不随性格变（激进是敢冒险不是乱来）。 */
  const EPS = { main: 0.4, phenotype: 0.65, survival: 0.15, floor: 0.05 };
  function confOf(g, p, id) {
    if (id == null) return 0;
    const d = suspDist(g, p, id);
    return Math.max(d.p_human, d.p_alien, d.p_king);        // 主观置信度 = 分布最大项
  }
  function argmax(g, opts, eps, floor) {
    const rng = g.rng;
    const valid = opts.filter(o => isFinite(o.U));
    if (!valid.length) return opts.find(o => o.v === 'none') || opts[0] || null;
    valid.sort((a, b) => b.U - a.U);
    const conf = valid[0].conf != null ? valid[0].conf : 0;
    /* v21 审查 #3：floor 钳制移到乘法之后——原顺序下高置信（conf=0.99，非硬源）时
       e = 0.4×0.01 = 0.004 已低于硬下限，下限形同虚设。
       仅硬源确证（conf=1，分布退化为单点，来自 knownLock 硬锁）允许归零——那不是推理，是事实。 */
    /* v31 批 3.5（N417）：floor 参数只给「保护型选择」（argmaxProtect）用——
       它把下界提为 Tiers.PROTECT.floor 并**取消 conf=1 的归零**。语义见 argmaxProtect。 */
    const base = floor == null ? EPS.floor : Math.max(EPS.floor, floor);
    let e = (conf >= 1 && floor == null) ? 0 : Math.max(base, (eps == null ? EPS.main : eps) * clamp(1 - conf, 0, 1));
    if (valid.length > 1 && rng.chance(e)) {
      const rest = valid.slice(1);
      const mn = Math.min(...rest.map(o => o.U));
      const ws = rest.map(o => 0.05 + Math.exp((o.U - mn) / 8));   // 劣解池按效用差加权
      let r = rng.next() * ws.reduce((a, b) => a + b, 0);
      for (let i = 0; i < rest.length; i++) { r -= ws[i]; if (r <= 0) return rest[i]; }
      return rest[rest.length - 1];
    }
    return valid[0];
  }

  /* v31 批 3.5（N417，人类侧保护专项 5.2 / 噪声章 20.4）：保护型目标选择的专用入口。
     与 argmax 的唯一差别 = 「硬源确证（conf=1）时也保留 ≥ PROTECT.floor 的次要选项概率」。
     为什么必须这样：保护决策问的是「要不要保他」，与「他是不是敌人」的置信度无关；
     若沿用 conf=1 → ε=0，硬锁为人类的关键职位（④ 暴露的工程师、③ 公告过的金水）
     会被机械地夜夜保护，保护优先级就退化成硬规则（违反 20.1「效用必须连续算出来」与
     「不制造最优」）。下界 5% 由 Tiers.PROTECT.floor 承载（唯一真源）。 */
  function argmaxProtect(g, opts, eps) {
    const floor = (T.PROTECT && T.PROTECT.floor) || EPS.floor;
    return argmax(g, opts, eps == null ? EPS.main : eps, floor);
  }

  /* ============ 白天发言（事实驱动 + 西塔门限）============
     原则：所有模板必须引用真实事实（昨夜死亡、自身查验、真实指控记录、真实数字），
     上下文不满足的模板一律不进候选——杜绝「第 0 夜谈昨晚」「无人指控却说被点名」。 */
  function speak(g, p, quiet) {
    const rng = g.rng;
    const al = alive(g).filter(x => x.id !== p.id);
    let top = null, topT = -1;
    for (const x of al) { const dv = dangerOf(g, p, x.id); if (dv > topT) { topT = dv; top = x; } }
    let text = '', claimRole = null;
    let prep = null;                                   // 由 Speakable 选中的「可说材料」
    p.lastAccuse = null; p.lastShare = null; p.lastAsk = null;
    /* v26：仲裁器「同档保留分歧」的 tiedClaims 只保留当夜（此前只写不读，属死数据） */
    p.tiedClaims = (p.tiedClaims || []).filter(x => x.night === g.night);
    /* 说话意图（Claim IR）：AI 发言与玩家发言从此走同一条 Bridge 管道 */
    p.outClaims = [];
    const IR = global.IR;
    const meta = { speaker: p.id, night: g.night, step: g.step, channel: quiet ? 'private' : 'public' };
    let tac = null;   // v31 批 3：战术库选择结果（非人类阵营出口，见下方 else-if 链）

    /* 事实集（带守卫） */
    const isDay = g.phase !== 'night';
    const lastDeaths = isDay ? g.players.filter(x => x.out && x.outNight === g.night && x.outType === 'death') : [];
    const lastEvict = isDay ? g.players.filter(x => x.out && x.outNight === g.night && x.outType === 'vote') : [];
    const accuseMe = g.players.filter(o => o.id !== p.id && (o.accuseHistory || []).some(a => a.id === p.id));
    /* 3.5：v21 §3.4 裁定——活跃度移出发言阈值（只进 Dg），指控门限回归纯西塔；
       7.1：指控 = 门限决策，≥θ+20 转入持续指控。
       异形的社交门限用【增量分】T−先验(50)（v4 定案 7）——目标积累可疑增量时才指控 */
    const socialT = top && p.faction === 'alien' ? topT - priorOf(g, p) : topT;
    const thEff = p.theta;
    const canAccuse = top && socialT >= thEff;
    const mustAccuse = top && socialT >= p.theta + 20;
    const night0 = g.night === 0;

    if (accuseMe.length && rng.chance(0.35)) {
      /* 响应真实指控：accuseMe 来自 accuseHistory，绝不凭空引用 */
      const a = pick(rng, accuseMe);
      text = pick(rng, [
        `${a.id} 号一直咬着我不放，我反而觉得他最想带节奏。`,
        `又被 ${a.id} 号点名？我的身份经得起查。`,
      ]);
      if (canAccuse && top.id !== a.id) {
        text += ` 我反倒盯 ${top.id} 号。`; p.lastAccuse = top.id;
        if (IR) p.outClaims.push(IR.mk('accuse', [top.id], { tier: 'med' }, meta));
      }
    } else if (mustAccuse || (canAccuse && (socialT - thEff) + gauss(g) * 12 > 0 &&
                              rng.chance(1 - EPS.phenotype))) {
      /* v21 审查 #4：表型层接入 ε-greedy——指控是效用最优分支，但 EPS.phenotype=0.65
         的硬分歧配额强制 65% 的可指控局面转入下位分支（质询 / 做戏 / 中性），
         杜绝「最优分支单一化」；mustAccuse（持续指控）不受配额约束 */
      p.lastAccuse = top.id;
      if (IR) p.outClaims.push(IR.mk('accuse', [top.id], { tier: mustAccuse ? 'hard' : 'med' }, meta));
      const k = p.known.get(top.id);
      const why = k && k.faction === 'alien' ? `信息摆在这，${top.id} 号对不上。`
                : k && k.excludes ? `${top.id} 号跟我的查验对不上。`
                : night0 ? `${top.id} 号开局这套发言我记下了。`
                : `${top.id} 号到现在一点干货没有。`;
      text = pick(rng, [
        `${why} 我怀疑他是异形。`,
        `我的票在 ${top.id} 号身上。`,
        `投 ${top.id} 号，错杀也比全灭强。`,
        night0 ? `${top.id} 号开局就 sus，我先记一笔。` : `${top.id} 号这几晚太划水了，盘不出来人还占位置。`,
        `${top.id} 号的发言我踩一下，节奏不对。`,
      ]);
    } else if (top && (p.faction === 'human' ? (socialT >= thEff - 15) : rng.chance(0.18))) {
      /* v4 7.4 质询（提问曲线）：疑似目标进入 [θ−15, θ] 中段 → 公开质询而非指控。
         异形也低频反向质询（试探/带节奏，合法策略）。回答与对证由 streamPump/talk 驱动。 */
      p.lastAsk = top.id;
      if (IR) p.outClaims.push(IR.mk('ask', [top.id], {}, meta));
      /* v32 语言层修复（用户拍板）：时间情境感知——开局讨论（第 0 夜）没有「昨晚」可问，
         必须用开局语境的质询模板（此前第 0 天就问「你昨晚做了什么」，死板穿帮）。 */
      text = pick(rng, night0 ? [
        `${top.id} 号，开局先把你的立场说清楚，别急着站队。`,
        `我质询 ${top.id} 号：第一轮就想好你要跟谁走。`,
        `${top.id} 号，开局这套发言太保守了，亮点干货。`,
      ] : [
        `${top.id} 号，你昨晚到底做了什么？当着大家的面说清楚。`,
        `${top.id} 号，报一下你的职业和昨晚行动，别绕。`,
        `我质询 ${top.id} 号：你凭什么自证清白？`,
        `${top.id} 号，别光划水，摊牌吧。`,
      ]);
    } else if (p.faction !== 'human' && top && rng.chance(0.25)) {
      /* 做戏指控（规则允许的合法策略）：异形低频构陷，事后由 R17 追责链暴露——
         这是人类识别异形的核心信息渠道（v4 9.2：指控是高阶策略，误指会被追责）。
         v25 批次 8：影子层接线（§2.2 伪装收益评估）——frame 目标用 shadowRisk 复核：
         inf = 镜像观察者视角「这句话能把目标 p_alien 顶高多少」。在危险度前二候选间
         选「危险度 + 影响力×100」更高者；影子只参与【选目标】，不否决（实测否决会把
         做戏全灭 = 拔掉 R17 反噬通道，人类彻底失明）。计数进 MoE.stats.shadow。 */
      const ranked = al.map(x => ({ x, dv: dangerOf(g, p, x.id) })).sort((a, b) => b.dv - a.dv);
      let frame = ranked[0];
      const M = global.MoE;
      if (M && M.shadowRisk && IR && ranked.length > 1) {
        M.stats.shadow.calls++;
        const mkProbe = x => Object.assign({}, IR.mk('accuse', [x.id], { tier: 'soft' }, meta), { tier: T.RULE.accuse });
        const a1 = M.shadowRisk(g, p.id, mkProbe(ranked[0].x));
        const a2 = M.shadowRisk(g, p.id, mkProbe(ranked[1].x));
        const alt = (ranked[1].dv + a2 * 100) > (frame.dv + a1 * 100) ? ranked[1] : frame;
        if (alt !== frame) { frame = alt; M.stats.shadow.applied++; }
      }
      top = frame.x;
      p.lastAccuse = top.id;
      if (IR) p.outClaims.push(IR.mk('accuse', [top.id], { tier: 'soft' }, meta));
      text = pick(rng, [
        `${top.id} 号的发言全是空话，我的票在犹豫要不要给他。`,
        `盯一下 ${top.id} 号，他的票型有问题。`,
        `${top.id} 号聊爆了吧，这种话也敢往外说。`,
        `大家别被 ${top.id} 号带节奏，票稳住。`,
      ]);
    } else if (!quiet && IR && accuseMe.length && rng.chance(0.5)) {
      /* v31 裁定（用户拍板「可以加否认」）：被指控时产出【证伪型宣称】A12~A15——
         「我昨晚没被查验。／没人查过我。」（神探/船员）/「我身上没有感染标记。」（外星人）。
         它的独特价值是【可被观察者的私有知识当场证伪】：真的查过我的人，方才知道这句是谎
         （pipeline 的 denyLie → A⁻）。此前 AI 生成端 `IR.mk('deny')` = 0 处 —— 全 AI 局
         denyLie 必然为 0（只有玩家人工输入才会产生），这是 A2 的根因。 */
      const about = p.faction === 'xeno' ? 'infection' : 'checked';
      const dc = IR.mk('deny', [], { about }, meta);
      text = (global.Speakable && global.Lang)
        ? global.Lang.render(dc, { g, p, rng })
        : (about === 'checked' ? '我昨晚没被查验。' : '我身上没有感染标记。');
      p.outClaims.push(dc);
    } else if (!evilIntent(p) && p.role === 'detective' && !quiet && rng.chance(0.15) && al.length > 1 && g.night >= 2 &&
               (!p.promiseCheck || p.promiseCheck.night <= g.night - 2)) {
      /* v31 批 2（A3）：神探【指名预告】——全仓唯一产出 tier=strong 承诺的地方。
         病灶（v31 §6.2）：判据要 strong、生产者只产 mid/weak，三处词表不一致 →
         全仓没有任何一处产出 strong ⇒ A01/A02 永久 0 命中。现统一到 Tiers.PROMISE，
         由真神探在讨论中公开预告「今晚查 X，明晚公告结果」：
           · 严格可验证（有目标 + 有兑现判据）→ verifiable = true
           · 结算方式 kind = 'announce'（按是否真的发布该目标的公告判兑现，不看投票）
           · 代价与收益对称：预告会把自己暴露给全场（N400 冒领/定案 20 的博弈由此成立） */
      /* 目标取「最可疑且尚未查验」的存活者——预告必须在行为上可兑现（次夜查验 → 再一夜公告），
         否则承诺机制只是发惩罚红包。同一时间只留一份未结算预告。 */
      const cands = al.filter(x => x.id !== p.id && !p.checkPool.has(x.id));
      const pool2 = cands.length ? cands : al.filter(x => x.id !== p.id);
      const t = pool2.slice().sort((a, b) => dangerOf(g, p, b.id) - dangerOf(g, p, a.id))[0];
      if (t) {
        p.promiseCheck = { id: t.id, night: g.night };
        /* v33 复审 O6：A02 匿名预告生产端——约 1/4 的预告不点名（E4 的 A02 gate 读
           strongPromises 中无 targets 的条目，此前全仓无生产者 → A02 永久 0 命中）。
           匿名预告无 targets ⇒ settlePromises 的「无指向不结算」跳过——不可核验即不可违约，语义自洽。 */
        const anon = rng.chance(0.25);
        if (IR) p.outClaims.push(IR.mk('promise', anon ? [] : [t.id], { tier: T.PROMISE.STRONG, kind: 'announce' }, meta));
        text = anon ? '我今晚查一个人，明晚公告结果。' : `我今晚查 ${t.id} 号，明晚公告结果。`;
      } else text = '我手里的查验结果先压一夜。';
    } else if (!evilIntent(p) && p.role === 'detective') {
      const pool = [...p.checkPool.values()].filter(x => !byId(g, x.id).out);
      if (pool.length && rng.chance(p.theta === 25 ? 0.8 : p.theta === 50 ? 0.5 : 0.2)) {
        const rec = rng.pick(pool);
        if (IR) p.outClaims.push(IR.mk('lock', [rec.id], { faction: rec.faction, role: rec.role, good: rec.faction === 'human' }, meta));
        text = `我查过 ${rec.id} 号，他是${D.FACTION[rec.faction].name}（${D.ROLES[rec.role].name}）。`;
        claimRole = 'detective';
      } else text = '我手里的查验结果先压一夜。';
    } else if (!evilIntent(p) && p.role === 'crew' && p.crewChecks.size && rng.chance(0.6)) {
      const rec = [...p.crewChecks.entries()].map(([id, v]) => ({ id: +id, v })).filter(x => !byId(g, x.id).out);
      if (rec.length) {
        const r0 = rng.pick(rec);
        if (r0.v.locked) {
          text = `我查了两次 ${r0.id} 号，能确认他的阵营是${D.FACTION[r0.v.locked].name}。`;
          p.pendingPublic = { id: r0.id, kind: 'lock', faction: r0.v.locked };
          if (IR) p.outClaims.push(IR.mk('lock', [r0.id], { faction: r0.v.locked, good: r0.v.locked === 'human' }, meta));
        } else {
          const ex = r0.v.excludes;
          text = ex.length >= 2
            ? `${r0.id} 号不是${D.ROLES[ex[0]].name}，也不是${D.ROLES[ex[1]].name}。`
            : `${r0.id} 号不是${D.ROLES[ex[0]].name}。`;
          p.pendingPublic = { id: r0.id, kind: 'exclude' };
          if (IR) p.outClaims.push(IR.mk('exclusion', [r0.id], { excludes: ex }, meta));
        }
        claimRole = 'crew';
      } else text = '我这轮先听大家的信息。';
    } else if (!evilIntent(p) && (p.role === 'sheriff' || p.role === 'armed') && rng.chance(p.theta === 75 ? 0.15 : 0.5)) {
      text = p.bullets > 0 ? `我是${D.ROLES[p.role].name}，枪口对着谁不用报备。` : '子弹打出去了，结果看今晚名单。';
      claimRole = p.role;
    } else if (p.faction !== 'human' && rng.chance(0.55) && global.Tactics &&
               (tac = global.Tactics.pickTactic(g, p, rng, {
                 accusedBy: () => accuseMe,
                 susp: id => suspOf(g, p, id),
                 topSuspect: () => (top ? top.id : null),
               }))) {
      /* v31 批 3（战术库接线）：浑水摸鱼 v21 的 37 条（N349~N386）此前【零消费者】——
         异形的全部专属手段都没接（台账 D1/D2 的直接根因）。现由 Tactics.pickTactic 出口：
           · 只产【语言层语料】的条目不写证据（say），需要落成行为的条目产 Claim（act）
           · Claim 仍要过 filterClaims（Z 档：N397~N400 的禁区/指纹/冒领窗口在生成前拦截）
           · 上下文 ctx 全部是「该 AI 自己算得出的量」（己方怀疑度 / 被指控记录 / 首疑目标） */
      if (tac.text) text = tac.text;
      if (tac.claim && IR) {
        const cl = IR.mk(tac.claim.kind, [], tac.claim.payload, meta);
        const kept = global.Tactics.filterClaims([cl], p, { night: g.night, detectiveAnnounceRecent: global.Tactics.detectiveAnnounceRecent(g) });
        if (kept.length) {
          p.outClaims.push(cl);
          if (tac.claim.kind === 'claimRole') claimRole = tac.claim.payload.role;
        } else {
          /* Z 档拦截：本条战术在生成前被禁（禁区/指纹/公告窗口）→ 回退到安全发言 */
          text = tac.text || '我先听一轮。';
        }
      }
      (g._tacticUse = g._tacticUse || {})[tac.opt.id] = (g._tacticUse[tac.opt.id] || 0) + 1;
    } else if (p.faction !== 'human' && rng.chance(0.3)) {
      const mate = p.faction === 'alien' ? aliveF(g, 'alien').find(x => x.id !== p.id && !x.out) : null;
      text = mate ? pick(rng, [`${mate.id} 号跟我对过信息，他没问题。`, '别急着投人，先看死因。'])
                  : pick(rng, ['我是普通船员，我这轮先稳住。', '这么快带节奏，正中对方下怀。']);
      if (text.startsWith('我是普通船员')) claimRole = 'crew';
    } else if (IR && global.Speakable && global.Lang && !quiet && g.night > 0 &&
               !global.SK_NO_SPEAKABLE && (prep = global.Speakable.pick(g, p, rng))) {
      /* 推理 → 语言：只说自己确实持有的私有体验（无持有就不开口，属选项生成层的 Z 过滤） */
      text = global.Lang.render(prep.claim, { g, p, rng });
      if (text) p.outClaims.push(prep.claim);
      else text = '我这轮没什么可说的。';
    } else if (global.Tactics && !global.SK_NO_TACTICS && g.night > 0 && rng.chance(0.25)) {
      /* N336~N348 安全宣称池：零风险话术（附和/复述公开信息/情绪/认错/概率化）。
         N348 红线：安全宣称只维持基线不建强信任——无意图产出，不进推理链，纯存在感。
         位置在中性评论之前：只替换无信息的垫场话，不抢做戏指控（异形的节奏武器）的频率。
         v32 语言库激活（用户拍板）：不再限异形——人类 AI 同样使用安全话术池（黑话不再只属于坏人阵营）。 */
      /* v26：安全宣称池改为按【条目】选取（旧实现把文案拍平成 pool，条目自带的 kind 被丢掉）：
         N337 弃票声明 → 产出 abstain Claim（正是 D03「宣称弃票却投了人」对账通道的输入）；
         N336 票型承诺 → 产出 weak 承诺（E7 兑现链）；其余条目维持 N348 红线——只维持基线、
         不进推理链（附和行为若无 Claim，就是纯存在感，符合总表口径）。 */
      const entry = pick(rng, global.Tactics.SAFE);
      text = entry ? pick(rng, entry.say) : '';
      if (IR && entry) {
        if (entry.kind === 'abstain') p.outClaims.push(IR.mk('abstain', [], {}, meta));
        else if (entry.kind === 'vote-promise') p.outClaims.push(IR.mk('promise', [], { tier: 'weak' }, meta));
      }
    } else if (p.tiedClaims.length && rng.chance(0.5)) {
      /* v26：消费仲裁器「同档保留分歧」（tiedClaims）——同一目标上两条同档证据并存时，
         说话者应当表现出「两种说法都成立、暂不站队」，而不是随机挑一条当作结论。
         此前 tiedClaims 只写不读（MoE → 语言库的这条回路是断的）。 */
      const rec = p.tiedClaims[p.tiedClaims.length - 1];
      text = pick(rng, [
        `${rec.target} 号身上两种说法都讲得通，这轮我不站队。`,
        `${rec.target} 号这事我拿不准，先记着，别急着定性。`,
        `对 ${rec.target} 号我保留意见——证据还没分出高下。`,
      ]);
      p.tiedClaims.pop();
    } else {
      /* 中性评论：全部走真实数字，且不跨夜引用 */
      const roll = rng.next();
      if (night0) {
        text = pick(rng, [
          '开局先把自己的节奏立住，信息后面慢慢对。',
          '第一晚什么都没发生，发言态度就是唯一的线索。',
          '都别急着定性，先听一轮。',
        ]);
      } else if (roll < 0.45 && (lastDeaths.length || lastEvict.length)) {
        const gone = (lastDeaths.length ? lastDeaths : lastEvict).map(x => x.id + ' 号').join('、');
        text = lastDeaths.length
          ? `第 ${g.night} 夜倒了 ${gone}，都想想这意味着什么。`
          : `${gone} 被投出去了，这一票大家都要复盘。`;
      } else if (roll < 0.6 && g.night > 0 && !lastDeaths.length) {
        text = '昨夜无人死亡，对方在蓄力。';
      } else if (roll < 0.8) {
        text = pick(rng, [
          `倒计时只剩 ${Math.max(0, g.countdown).toFixed(0)} 了，人类再不清场就全完了。`,
          `净破坏量已经 ${(g.net10 / 10).toFixed(1)}，机器再停大家陪葬。`,
          `场上还剩 ${alive(g).length} 个人，每一票都金贵。`,
        ]);
      } else text = pick(rng, [
        '我先听完再表态。',
        '信息共享优先，别互相消耗。',
        /* v32 语言库激活（用户拍板「AI 怎么不说黑话」）：高频垫场话注入行话措辞——
           全部是 NLP 已支持的行话（归票/划水/盘/踩/sus），玩家可从「原意」小字核对解析。 */
        '都别划水了，先归票，票散了白给。',
        '有没有人盘一下目前最 sus 的两个人？',
        '我先听，谁在裸坐谁心里清楚。',
      ]);
    }

    /* v26：公开发言的 p.claims 记录统一交给 Bridge.say（公开发言唯一入口）；
       旧实现 speak 与 Bridge.say 各 push 一次（同一句双写）。仅在无 Bridge 的兜底路径补记。 */
    if (!quiet && !global.Bridge) p.claims.push({ night: g.night, text });
    /* 私聊（quiet）：有真实查验信息时主动交底（8.2 四类内容之一），供 onPrivateShare 影响对方决策 */
    if (quiet && !evilIntent(p) && !p.lastShare) {
      if (p.role === 'detective' && p.checkPool.size) {
        const pool = [...p.checkPool.values()].filter(x => !byId(g, x.id).out);
        if (pool.length) {
          const rec = rng.pick(pool);
          p.lastShare = { id: rec.id, faction: rec.faction, role: rec.role };
          text = `私下跟你说：我查过 ${rec.id} 号，他是${D.FACTION[rec.faction].name}（${D.ROLES[rec.role].name}）。`;
        }
      } else if (p.crewChecks && p.crewChecks.size) {
        const locked = [...p.crewChecks.entries()].map(([id, v]) => ({ id: +id, v })).filter(x => x.v.locked && !byId(g, x.id).out);
        if (locked.length) {
          const r0 = rng.pick(locked);
          p.lastShare = { id: r0.id, faction: r0.v.locked, role: null };
          text = `私下跟你说：我两次查验锁了 ${r0.id} 号，阵营是${D.FACTION[r0.v.locked].name}。`;
        }
      }
    }
    /* v26：异形队内频道（quiet）不应产出「我是普通船员」这类对外伪装话术——队友当然知道你是谁，
       这句话在队内既无意义又会污染复盘。改为按计划沟通的口径，并撤销本次身份声称。 */
    if (quiet && claimRole && evilIntent(p)) {
      text = pick(rng, ['按计划走，别乱。', '我这边稳住，你们看情况。', '别急着表态，先看死因。']);
      claimRole = null;
    }
    if (claimRole) { p.claimedRole = claimRole; }   /* accuseHistory 由 onAccuse 统一记录，此处不再手动 push（避免双计） */
    if (quiet) { p.lastAccuse = null; if (claimRole) p.claimedRole = null; }
    else if (claimRole) onClaim(g, p, claimRole);
    return text;
  }
  function evilIntent(p) { return p.faction !== 'human'; }

  /* ---------- 公开质询 / 转述 / 汇报（NLP 新信号 → 威胁度链） ---------- */
  /* 公开质询：AI 观察者对被质询者小幅加压（公开追问的合理代价），量级低于指控 */
  /* ---------- 投票（8.1 / 8.3；v21：ε-greedy 取代 gauss，外星人排序量改 p_alien） ---------- */
  function vote(g, me) {
    const al = alive(g).filter(x => x.id !== me.id);
    if (me.faction === 'xeno') {                                  // 8.3 外星人：排序量 = p_alien（v21 裁定 §3.5）
      const r = aliveF(g, 'alien').length / Math.max(1, aliveF(g, 'human').length);
      const coef = clamp(3 * r, 0.5, 2.0);
      const W = { detective: 80, inspector: 80, sheriff: 65, armed: 60, bio: 55, rescue: 55, tempdoc: 55, engineer: 45, assistant: 45, bodyguard: 35, crew: 30 };
      const opts = [{ v: null, U: 0 }];                           // 5.1：「不做」同为候选
      for (const x of al) {
        const hasEv = (me.tEvents.get(x.id) || []).length > 0;
        let U;
        if (hasEv) U = suspOf(g, me, x.id) - 25;                  // 有证据：p_alien 排序量（suspOf 对外星人即 p_alien×100）
        else {
          const k = me.known.get(x.id);                           // 无信息兜底：职业威胁启发式（W 表降级用途，裁定 §3.5）
          U = (k && k.role && W[k.role] != null ? W[k.role] * coef : 40) - 25;
        }
        opts.push({ v: x.id, U, conf: confOf(g, me, x.id) });
      }
      const c = argmax(g, opts, EPS.main);
      return c ? c.v : null;
    }
    /* 2026-09-10 注：本分支三处（abstain/actLine/param）曾改为读 Tiers.PERSONALITY 并按 k 等比缩放，
       实测人类 27.0% → 25.4% ⇒ 已整体回退，现为字面量表（与 BASE_DANGER 只登记、不缩放同口径）。 */
    const abstain = me.faction === 'alien' ? 0
      : -5 + ({ 25: -10, 50: 0, 75: 8 }[me.theta] || 0);          // v22 性格：激进更少弃票、保守更多弃票
    /* v22 性格化行动门槛：危险度基线随性格偏移（激进 30/保守 70），行动门槛须反向联动——
       激进低门槛 + 低基线 = 敢投；保守高门槛 + 高基线 = 慎重。固定 20 会让激进者整体哑火。 */
    const actLine = { 25: 10, 50: 20, 75: 30 }[me.theta] != null ? { 25: 10, 50: 20, 75: 30 }[me.theta] : 20;
    const opts = [{ v: null, U: abstain }];                       // 5.1：弃票同为候选，防止过度行动
    for (const x of al) {
      const Dg = dangerOf(g, me, x.id);
      if (Dg < actLine) continue;                                 // 性格化门槛（队友锁 0 天然排除）
      let U;
      if (me.faction === 'alien') {
        const param = { 25: 0, 50: 25, 75: 55 }[me.theta];
        U = Dg - param;
      } else {
        if (exposedEngineer(g, x)) continue;                      // 官方确证自家人：人类一律 U=−∞
        U = Dg - priorOf(g, me) + (50 - me.theta) * 0.5;          // v21：baseRate → 先验（改动 #1）
      }
      /* v23 批次 3：报复心行为项——R31 报复心转化为「优先投他」（异形对队友除外） */
      if (!(me.faction === 'alien' && isAlly(me, x))) U += GRUDGE_W[me.theta] * grudgeLevel(g, me, x.id);
      opts.push({ v: x.id, U, conf: confOf(g, me, x.id) });
    }
    const c = argmax(g, opts, EPS.main);
    let best = c ? c.v : null;
    /* 弃保跟票（v21 改动 #8）：不再读公开共识 g.threat（聚合派生量，AI 决策禁读），
       改用私有估值——自己观察到的「对队友的指控流」强度（近两夜非队友的指控按 C+ 档累加） */
    if (me.faction === 'alien') {
      const mate = al.find(x => isAlly(me, x));
      if (mate) {
        let heat = 0;
        for (const o of g.players) {
          if (o.out || o.id === me.id || isAlly(me, o)) continue;
          for (const a of (o.accuseHistory || []))
            if (a.id === mate.id && a.night >= g.night - 1) heat += T.SCORE[T.RULE.mateHeat];
        }
        if (heat >= 22) best = mate.id;                           // ≈一条 B 档或两条 C 档指控
      }
    }
    /* 2.3 例外二 · 本方票型协调：无强信息（增量 <30）时跟随队内计划票，避免三票分散 */
    if (me.faction === 'alien' && best != null) {
      g.alienVotePlan = g.alienVotePlan || [];
      const planT = g.alienVotePlan.find(id => id !== me.id && byId(g, id) && !byId(g, id).out);
      const myInc = dangerOf(g, me, best) - 50;   // 增量相对异形基准 50（v4）
      if (planT != null && myInc < 30) best = planT;
      else if (!g.alienVotePlan.length || myInc >= 30) {
        g.alienVotePlan = [best].concat(g.alienVotePlan.filter(id => id !== best));
      }
    }
    return best;
  }

  /* ---------- 私聊（5.2⑥ / 8.2） ---------- */
  function inviteUtility(g, me, t) {
    const Dg = dangerOf(g, me, t);
    return ((100 - Dg) * (1 - me.w) + Dg * me.w) * 0.4;
  }
  /* ============ 各决策效用函数（第 5 章） ============ */
  function decide(g, req) {
    const p = byId(g, req.pid);
    const rng = g.rng;
    const al = alive(g).filter(x => x.id !== p.id);
    const urg = urgency(g);
    /* v27（A6-③）：claimedRole 的第三项由死别名 'doc' 改为 'tempdoc'——医生系三职业
       （bio / rescue / tempdoc）在语言层与推理层现在同一套键，不再有 'doc' 这个空洞。 */
    const doctorsAlive = Math.max(1, alive(g).filter(x =>
      x.role === 'bio' || x.role === 'rescue' || x.role === 'tempdoc' ||
      x.claimedRole === 'bio' || x.claimedRole === 'rescue' || x.claimedRole === 'tempdoc').length);

    switch (req.kind) {
      case 'invite': {                                     // 5.2⑥
        const cands = al.filter(x => x.id !== p.lastInvite);
        if (!cands.length) return { invite: null };
        const opts = cands.map(x => ({ v: x.id, U: inviteUtility(g, p, x) }));
        const c = argmax(g, opts, EPS.main);                // v21：ε-greedy 取代 gauss
        return { invite: c && rng.chance(0.85) ? c.v : null };
      }
      case 'inviteAccept': {                               // 8.2 有效真实率
        const froms = (g.invites[p.id] || []).map(id => byId(g, id)).filter(x => x && !x.out);
        if (!froms.length) return { accept: 'none' };
        const h = aliveF(g, 'human').length / alive(g).length;
        let R = clamp(2 * h - 0.6, 0.2, 0.9);
        if (p.faction === 'alien') R *= 0.6;
        let best = null, bestE = -1;
        for (const s of froms) {
          const eff = R * (1 - dangerOf(g, p, s.id) / 100 * 0.6);
          if (eff > bestE) { bestE = eff; best = s; }
        }
        return { accept: best && rng.chance(Math.min(0.9, bestE + 0.2)) ? String(best.id) : 'none' };
      }
      case 'chat': return { text: speak(g, p, true) };

      case 'suppress': {                                   // U = 延后价值 − V_self×(θ/50)
        const inf = p.infection;
        if (!inf || !inf.real || p.suppressLeft <= 0) return { use: false };
        const delay = inf.deathNight === g.night ? 60 : inf.deathNight === g.night + 1 ? 30 : 10;
        return { use: delay - p.vSelf * (p.theta / 50) + gauss(g) * 6 > 0 };
      }

      case 'evolve': {
        /* v4 4.1 进化概率制：基础 50%，随紧迫度升至 80% 常态、极端 100%；第 3 夜起 */
        if (g.night < 3 || p.alien.dir) return { dir: null };
        const occ = dirOcc(g);
        const dirVal = d => {
          const base = { destroy: 34, infect: 32, kill: 38 }[d];
          return base + (d === 'destroy' ? urg * 20 : 0) - (d === 'infect' ? doctorsAlive * 4 : 0);
        };
        const vals = ['destroy', 'infect', 'kill'].filter(d => occ[d] < 2).map(dirVal);
        const spread = vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : 0;
        const evoProb = clamp(0.50 + 0.50 * ((g.night - 3) / 4 + spread / 40), 0.50, 1.0);
        if (!rng.chance(evoProb)) return { dir: null };
        /* 方向选择：dirValue + 个体噪声（DIR_SIGMA=0.15）后 argmax */
        const opts = ['destroy', 'infect', 'kill'].filter(d => occ[d] < 2)
          .map(d => ({ v: d, U: dirVal(d) * (1 + gauss(g) * 0.15) }));
        opts.push({ v: 'none', U: 0 });
        const c = argmax(g, opts, EPS.main);
        return { dir: c.v === 'none' ? null : c.v };
      }
      case 'convert': {
        /* v4 4.2 转化系统（TRANSFORM_COST_K = 1.5）：仅当方向价值剧变、收益 > 一夜产出 × 1.5 */
        if (!p.alien.dir || g.night <= p.alien.evoNight || p.alien.converts >= 2) return { do: false };
        const occ = dirOcc(g);
        const dirVal = d => {
          const base = { destroy: 34, infect: 32, kill: 38 }[d];
          return base + (d === 'destroy' ? urg * 20 : 0) - (d === 'infect' ? doctorsAlive * 4 : 0)
            + (d === 'kill' ? 0.5 * clearedK(g) * 20 : 0);
        };
        /* 一夜产出（失去行动的机会成本，典型 45~80） */
        const lost = Math.max(
          (threatTop(g, p) || 0) * 0.9, urg * 50,
          p.alien.destroyTotal < 6 ? 30 : 0, p.vSelf * 0.3);
        let best = null;
        for (const d of ['kill', 'destroy', 'infect']) {
          if (d === p.alien.dir || occ[d] >= 2) continue;
          const gain = dirVal(d) * (1 + gauss(g) * 0.15) - dirVal(p.alien.dir);   // DIR_SIGMA 0.15
          if (gain > lost * 1.5 * (0.8 + g.rng.next() * 0.4)) {
            if (!best || gain > best.gain) best = { dir: d, gain };
          }
        }
        /* 第 3 夜 15% 概率延后一夜再评估（v4 4.3 随机性保障） */
        if (best && g.night === 3 && rng.chance(0.15)) return { do: false };
        return best ? { do: true, dir: best.dir } : { do: false };
      }
      case 'transfer': {                                   // 按场上缺口
        const sheriffDead = !g.players.some(x => x.originRole === 'sheriff' && !x.out);
        const docDead = !g.players.some(x => (x.originRole === 'bio' || x.originRole === 'rescue') && !x.out);
        const dir = sheriffDead ? 'armed' : docDead ? 'tempdoc' : urg > 0.5 ? 'assistant' : rng.pick(['armed', 'assistant', 'tempdoc']);
        return { dir };
      }

      case 'crewAction': {                                 // U_查验 vs U_维修 vs 不做（★暴露惩罚 30→15）
        const checked = p.crewChecks.size;
        const uCheck = 40 * ((al.length - checked) / Math.max(1, al.length));
        const uRepair = urg * 50 - 15 * (50 / p.theta);
        const opts = [{ v: 'check', U: uCheck }, { v: 'repair', U: uRepair }, { v: 'none', U: 0 }];
        const c = argmax(g, opts, EPS.main);
        if (c.v === 'check') {
          /* v26 修复（P0-① 透视）：旧实现 `x.faction !== 'alien'` —— 船员按【真相阵营】把异形
             排除出双查目标池，等于「船员永远不会查到异形」（locked 恒为人类），人类方唯一
             能自证的查验手段被系统性废掉。现在只按「自己是否已查过」过滤。 */
          const pool = al.filter(x => !p.crewChecks.has(x.id));
          if (!pool.length) return { mode: 'none' };
          /* v21：查验目标按危险度 ε-greedy 选取；v22 仲裁器待验证队列目标 +15 优先级 */
          const q = (p.verifyQueue || []).map(v => v.target);
          const topts = pool.map(x => ({ x, v: x.id, U: dangerOf(g, p, x.id) + (q.includes(x.id) ? 15 : 0), conf: confOf(g, p, x.id) }))
            .sort((a, b) => b.U - a.U);
          const tpick = argmax(g, topts, EPS.main);
          const t = tpick ? tpick.x : al[0];
          return { mode: 'check', target: t ? t.id : null };
        }
        if (c.v === 'repair') {
          /* 5.2③：7 档维修值 argmax（σ=6），U = 紧迫度×(a/0.50)×50 − 15×(50/θ) */
          const aOpts = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5]
            .map(a => ({ v: a, U: urg * (a / 0.5) * 50 - 15 * (50 / p.theta) }));
          aOpts.push({ v: null, U: 0 });
          const ap = argmax(g, aOpts, EPS.main);
          return { mode: 'repair', value: ap.v == null ? 0.3 : ap.v };
        }
        return { mode: 'none' };
      }
      case 'detective': {                                  // ④ 查验 vs 发布
        const unchecked = al.filter(x => !p.checkPool.has(x.id));
        let uCheck = 40 * (unchecked.length / Math.max(1, al.length));   // v31 批 2：let（预告履行链会加权重）
        const pool = [...p.checkPool.values()].filter(x => !byId(g, x.id).out);
        let uPub = -Infinity, pubT = null;
        if (pool.length) {
          const values = pool.map(x => x.faction === 'alien' ? 60 : x.faction === 'xeno' ? 50 : -30);
          /* v32 语言层修复（用户拍板「公告有啥用」）：旧公式对公告【扣减】敌方存活数 ×10 ——
             方向反了：敌方活着越多，官方 ③ 公告的硬源价值越大（全体人类立刻锁定 + 警长开枪 + 投票聚焦）。
             旧读数下 uPub ≈ 60−3×10−1×10 = 20 < uCheck ≈ 32 ⇒ AI 神探几乎从不公告，
             查验结果只走白天口头汇报（v31 裁定：不写硬锁）⇒ ③ 公告在 AI 局里形同虚设。
             现改为正向紧迫度：查杀 60 + 敌方存活 ×10 ×(θ/50)——保守神探更谨慎（θ=75 时加成减半）。 */
          const enemyAlive = aliveF(g, 'alien').length + aliveF(g, 'xeno').length;
          uPub = Math.max(...values) + enemyAlive * 10 * (p.theta / 50);
          pubT = pool[values.indexOf(Math.max(...values))].id;
        }
        /* v31 批 2（A3）：预告机制**不加强制履行**——与 B1 裁定「让 AI 根据推理库和引擎实时选择，
           不做强制要求」保持一致。实测：若强制神探按预告查验/公告（uCheck +80 / uPub = 200），
           会把神探的夜间最优选择钉死，人类胜率再降 2.7pp（34.7% → 29.7% → 27.0%，300 局同种子二分）。
           因此这里只保留「承诺 + 兑现判据」的机制本身，是否真的去查/去公告仍由效用函数决定。 */
        const c = argmax(g, [{ v: 'check', U: uCheck }, { v: 'publish', U: uPub }, { v: 'none', U: 0 }], EPS.main);
        if (c.v === 'check' && unchecked.length) {
          /* v22 仲裁器待验证队列：差两档的 target 提升查验优先级（不公开表达） */
          const q = (p.verifyQueue || []).map(v => v.target);
          const queued = unchecked.filter(x => q.includes(x.id));
          return { mode: 'check', target: (queued.length ? queued[0] : unchecked[rng.int(unchecked.length)]).id };
        }
        if (c.v === 'publish') return { mode: 'announce', target: pubT };
        return { mode: 'none' };
      }
      case 'patrol': {                                     // ⑦ 巡逻 vs 开枪（★N415：投向最可能被刀且最不可替换者）
        if (g.night > 3 || p.patrolUsed) return { use: false, targets: [] };
        let bestShoot = -Infinity;
        for (const x of al) bestShoot = Math.max(bestShoot, 1.4 * dangerOf(g, p, x.id) - 1.4 * (p.theta + 35));
        /* v31 批 3.5（N415）：巡逻全局 1 次、限前 3 夜 ⇒ 投向「最可能被刀且最不可替换」者。
           两轴合并成【连续效用】：① 越不像敌人越该保护（-dangerOf）；
           ② 保护优先级权重（已预告／④ 暴露的关键职位 ＞ 已确证人类的关键职位 ＞ 高价值未确证）。
           旧实现把「已暴露工程师」硬插名单最前、其余按 dangerOf 升序取 1 人 ——
           同样是硬阈值写法，且完全忽略「不可替换性」（技能位置与普通船员同权）。 */
        const PT = global.Tactics;
        const popts = al.concat([p]).map(x => ({
          x, v: x.id,
          U: -dangerOf(g, p, x.id) + (PT ? PT.protectionBonus(g, p, x, 'patrol') : 0),
          conf: confOf(g, p, x.id),
        })).sort((a, b) => b.U - a.U);
        const prot = popts.slice(0, 3).map(o => o.v);
        const uPatrol = p.vSelf * 0.5 + prot.length * 8;
        if (uPatrol + gauss(g) * 6 > bestShoot) return { use: true, targets: prot.slice(0, 3) };
        return { use: false, targets: [] };
      }
      case 'guard': {                                      // 候选 = 威胁度 < N(25,4²)，argmin（6.3 B 档 σ=12）
        /* v31 批 3.5（N414）：保护优先级从【硬规则】改为【效用权重】——
           旧实现是 `if (exposed.length) return exposed[0].id`，等于「必须优先保护 ④ 暴露者」，
           违反噪声章 20.1（效用必须连续算出来，不是硬阈值切的）与「不制造最优」。
           现在由 Tactics.protectionBonus 提供连续权重：已预告／④ 暴露的关键职位 ＞
           已确证人类的关键职位 ＞ 高价值未确证 ＞ 其余；自保另有固定权重
           （文档 5.1 明列「自保」是 AI 可以不合规地不保护预告者的理由之一）。
           选择入口是 argmaxProtect（N417 下界：次要选项选择率 ≥ 5%，硬源确证时也不归零）。 */
        const pool = al.concat([p]);                       // 7.2：保镖可自保（受连续两夜限制约束）
        const guardLine = clamp(25 + gauss(g) * 4, 5, 45);
        const cands = pool.filter(x => x.id !== p.lastProtected && dangerOf(g, p, x.id) < guardLine);
        /* 连续限制内无可保目标 → 本夜无输入（返回 null，引擎按放弃处理并解除限制） */
        if (!cands.length) return { target: p.lastProtected === p.id ? null : p.id };
        const PT = global.Tactics;
        const gopts = cands.map(c => ({
          v: c.id,
          U: -dangerOf(g, p, c.id) + (PT ? PT.protectionBonus(g, p, c, 'guard') : 0),   // argmin → 负效用
          conf: confOf(g, p, c.id),
        }));
        const gc = argmaxProtect(g, gopts);
        return { target: gc ? gc.v : p.id };
      }
      case 'repair': {                                     // ③ 工程师 / 追加（★已暴露改取保护收益 +20）
        const riskTerm = p.repairExposed ? -20 : exposeRiskInc(p) * (p.theta / 50);
        const doIt = urg * 50 - riskTerm + gauss(g) * 6 > 0;
        const extra = p.role === 'engineer' && p.extraRepair > 0 && urg > 0.4 &&
                      (g.net10 < 30 ? (30 - g.net10) < 5 : g.net10 < 60 && (60 - g.net10) < 5) &&
                      rng.chance(0.7);
        return { do: doIt, extra };
      }
      case 'branch': {                                     // 0.7 预提交（v4 第五章：破坏三层随机）
        if (p.faction === 'alien') {
          /* ① 个体阈值（开局 roll 一次，整局不变——p.sabTau 在 state 初始化） */
          /* ② 倒计时反比例压力：base = raw/(raw+SAB_K)，raw = 24/max(cd,0.5) − 1 */
          const SAB = T.SAB;   // v28b（B6）：四项系数统一到 Tiers.SAB（标定对象，唯一真源）
          const raw = 24 / Math.max(g.countdown, 0.5) - 1;
          const pressure = raw / (raw + SAB.satK) + (0.5 - p.sabTau) * SAB.satJitter;
          /* ③ 队内软节流 + 协同信号。
             v28b（B6 仪器发现并修复）：旧写法读 `x.branch === 'destroy'`，而 `p.branch` 要到
             0.7 步骤的 run() 里才写入（steps.js:348），**决策阶段恒为 null** —— 于是「本夜已破坏
             队友数」恒 0，协同项与队内节流双双是死代码（60 局实测 mates 恒 0）。
             改用决策阶段真实可读的队内信号：本局【已实际破坏过】的存活队友数
             （`x.alien.destroyTotal10 > 0`；同为异形自有信息，不涉透视）。 */
          const mateSaboteurs = g.players.filter(x => x.faction === 'alien' && !x.out && x.id !== p.id &&
            (x.alien && x.alien.destroyTotal10 || 0) > 0).length;
          const sabCount = mateSaboteurs;
          /* v28b（B6）：配额改「存活异形数 − slack」——只在几乎全队都在破坏时收手，
             避免与下方的协同奖励（mates × 4）方向互斥（首版按 countdown 取 1/2/3，
             实测「队友破坏过 → 我更不破坏」的方向反转）。 */
          const aliensAliveN = g.players.filter(x => x.faction === 'alien' && !x.out).length;
          const quota = Math.max(1, aliensAliveN - SAB.quotaSlack);
          const gain = (!g.tiers[3] ? 30 : 0) + (!g.tiers[6] ? 40 : 0) + (!g.tiers[9] ? 50 : 0);
          const risk = p.alien.destroyTotal10 >= 60 ? 0
            : (60 - p.alien.destroyTotal10) <= 15 ? 35 : (60 - p.alien.destroyTotal10) <= 30 ? 5 : 0;
          /* v25 批次 9（C1 修复）：已删除 timePress 60/35/15 硬编码阶梯——「看到停摆空转
             就加压力项硬推」是结果反推过程。时间压力统一由 pressure 项平滑承载：
             raw = 24/cd − 1，pressure = raw/(raw+6)，cd=6 时 0.33、cd=2 时 0.65、cd=1 时 0.79
             （与外星人 pSab 同一族饱和曲线）。量纲统一：uDestroy 与 uAct 都在 0~100 轴上竞争
             （uDestroy = 100×pressure − 风险项 ± 性格；uAct = threatTop×衰减系数）。 */
          /* ---- v28（B1 裁定）：让 AI 依据推理库与引擎状态实时自主选择，不做强制要求 ----
             裁定原文：「让 ai 根据推理库和引擎实时选择，不做强制要求」——即不加硬推、不设保底，
             但必须让 AI 真的「看得到局势」。旧实现有两处让 uDestroy 系统性偏低：
               ① 上面已经算好的 gain（未触发停摆档位的价值）是个【死变量】，从未进入效用；
               ② 完全没看对手方还剩多少维修能力（AI 明明有 ④ 暴露 / known 台账 / 可信宣称可读）。
             于是 500 局停摆 3.0 只触发 6 局、6.0/9.0 为 0 —— 破坏成了摆设。
             现在四项全部来自【引擎公开状态】或【AI 自己的推理台账】：
               ① pressure×100  倒计时饱和压力（原样）
               ② tierGain      未触发档位价值 gain × 0.25（死变量归位，缩放进 0~100 轴）
               ③ resist        已知维修者数 × 8（knownRepairers：④暴露 / known / 高可信宣称）
               ④ mates         本夜已选择破坏的队友数 × 4（协同；原来 sabCount 只用于节流）
             不设阈值、不给保底：最终仍是 uDestroy 与 uAct 的同轴比较 + 有界噪声。 */
          const mates = Math.min(2, Math.max(0, sabCount));   // 协同奖励封顶 2（避免多人同夜叠加过头）
          const repairKnown = knownRepairers(g, p);
          const tierGain = gain * SAB.gainW;
          const resist = repairKnown * SAB.resistPer;
          /* v22 性格：激进更偏向攻击（+12）、保守更少破坏（−10） */
          let uDestroy = (pressure * 100 + tierGain - risk * (p.theta / SAB.riskThetaDiv) - resist)
            + (SAB.thetaShift[p.theta] || 0) + mates * SAB.matesW;   // 0~100 轴（v25 批次 9；v28 B1 扩项）
          /* v23 批次 5：PHASES 调度——局势策略标签调制破坏决策（战术库从死资产变成策略） */
          const atag = phaseTag(g, 'alien');
          if (atag === 'zero-only' || atag === 'none') uDestroy *= 0.15;                        // 前 3 夜禁欲 / 决斗期收束
          else if (atag === 'low') uDestroy *= 0.8;
          else if (atag === 'sacrifice') uDestroy += 10;                                        // 残局牺牲：主动吸引火力
          else if (atag === 'stop-destroy' || atag === 'kill-cocoon-only') uDestroy = -Infinity; // 9.0 已停摆 / 寂灭收敛：破坏无意义
          /* 与「本夜行动」的期望效用同场比较——两者现已统一在 0~100 轴（v25 批次 9）：
             threatTop ∈ [0,100]，破坏侧 pressure×100 ∈ [0,100]——同轴竞争，不再靠时间硬推 */
          const uAct = threatTop(g, p) * 0.9 * (1 + 0.5 * clearedK(g)) * (0.5 + 0.5 * Math.max(g.countdown, 0) / 24);
          let go = !g.extinction && uDestroy > uAct + gauss(g) * SAB.noise;
          if (go && sabCount >= quota) go = rng.chance(SAB.quotaTail);
          /* v28b（B6 仪器）：把每次破坏决策的【输入局势 + 输出】落盘，供 mc 统计
             「AI 是否按局势合理选择」——这才是不设靶的验收口径（旧口径是看破坏发生率）。
             记录字段：选择结果 go · 压力/档位收益/暴露风险/维修阻力/协同 五路输入 ·
             距下一档位的真实距离 gapT · 两路效用（含 PHASES 标签调制后的终值）。 */
          const next10v = g.net10 < 30 ? 30 : g.net10 < 60 ? 60 : 90;
          (g._sabEval = g._sabEval || []).push({
            night: g.night, go: !!go, theta: p.theta, atag,
            pressure: +pressure.toFixed(4), tierGain: +tierGain.toFixed(2), risk,
            repairKnown: +repairKnown.toFixed(2), mates,
            gapT: +((next10v - g.net10) / 10).toFixed(2),
            uDestroy: isFinite(uDestroy) ? +uDestroy.toFixed(2) : null, uAct: +uAct.toFixed(2),
          });
          /* v4.1 §3.2 破坏量自选档（N367 保隐蔽 / N49 跨档计算 / N92 已暴露选最大——占位策略，待数值方案标定） */
          let sabAmount = null;
          if (go) {
            const big = p.alien.dir === 'destroy';
            const lo = big ? 20 : 10, hi = big ? 30 : 15;
            const next10 = g.net10 < 30 ? 30 : g.net10 < 60 ? 60 : 90;
            const gap10 = next10 - g.net10;
            const cross = [];
            if (gap10 > 0) for (let v = lo; v <= hi; v++) if (g.net10 + v >= next10) cross.push(v);
            if (p.alien.destroyTotal10 >= 60) sabAmount = hi;            // N92：已暴露无代价 → 最大档
            else if (cross.length && rng.chance(0.5)) sabAmount = cross[0];  // N49：恰好跨档
            else sabAmount = rng.chance(0.9) ? lo : lo + rng.int(hi - lo + 1);  // N367：未暴露以最小档保隐蔽（总表 N367 判据），10% 噪声防众数指纹（N74/N84）——v25 C2：删「实测显著优于」的循环论证表述，策略依据回归总表条目
          }
          return { branch: go ? 'destroy' : 'act', num: sabAmount };
        }
        /* 外星人：全局 1 次（6.3），平时低率、倒计时 ETA 临近爆发 */
        if (g.extinction) return { branch: 'kill' };
        if (p.destroyLeft > 0) {
          const repairRate = Math.max(1, (g.actCounts.repair || 0) / Math.max(1, g.night));  // 估算每晚维修量
          const eta = Math.max(g.countdown, 0.5) / repairRate;
          const raw2 = 24 / Math.max(g.countdown, 0.5) - 1;
          let pSab = clamp(0.05 + 0.95 * (raw2 / (raw2 + 6)) + gauss(g) * 0.10, 0, 1);       // ALIEN_BASE=0.05
          /* v25 批次 9（C3 修复）：已删除 ALIEN_PANIC 硬下限（eta≤2 强制 0.85）——
             无规则依据的「结果反推」短路。饱和曲线 raw2/(raw2+6) 在 cd=2 时已是 0.79，
             本就覆盖「临近爆发」；只剩 eta（维修速率）信息未用——把它作为连续调制并入，
             而不是台阶式钳制：修复慢 → 曲线整体左移，等效提前紧张。 */
          pSab = clamp(pSab * (eta <= 2.0 ? 1.1 : 1.0), 0, 1);                                // eta 连续调制（v25 批次 9）
          /* v23 批次 5：xeno 局势标签——lurk 压低破坏、wait/kingmaker 不破坏（决斗期坐收渔利） */
          const xtag = phaseTag(g, 'xeno');
          if (xtag === 'lurk') pSab *= 0.4;
          else if (xtag === 'wait' || xtag === 'kingmaker') pSab = 0;
          if (g.night >= 2 && rng.chance(pSab)) {
            /* v4.1 §6.3：2.0~3.0 自选（N377 偏小值换隐蔽，待数值方案标定） */
            return { branch: 'destroy', num: rng.chance(0.7) ? 20 : 20 + rng.int(11) };
          }
        }
        if (rng.chance(0.25)) return { branch: 'check' };
        return { branch: 'kill' };
      }
      case 'xenoCheck': {                                  // U(i) = Dg_i，已确认异形 ×1.5（v21：ε-greedy）
        const copts = al.map(x => {
          const k = p.known.get(x.id);
          let U = dangerOf(g, p, x.id);
          if (k && k.faction === 'alien') U *= 1.5;
          return { v: x.id, U, conf: confOf(g, p, x.id) };
        });
        const cc = argmax(g, copts, EPS.main);
        return { target: cc ? cc.v : null };
      }
      case 'xenoSilence': {
        /* v24 规则 6.1：蛰伏专属沉默——选择权在【看到查验结果之后】行使。
           战术含义（N375 三重战术的前提）：看到是人类再决定封不封。
           效用 = 职业价值（神职/武力最值得封）− 性格谨慎度；异形目标降权（封它会削弱异形清人）。 */
        const rec = p.lastXenoCheckRes;
        const t = rec && byId(g, rec.id);
        if (!t || t.out || t.silencedOnce) return { silence: false };
        const val = { detective: 40, inspector: 38, sheriff: 34, bio: 30, rescue: 30, armed: 30,
                      tempdoc: 24, engineer: 22, assistant: 20, bodyguard: 14, crew: 8 }[t.role] || 10;
        const U = val - ({ 25: 8, 50: 18, 75: 28 }[p.theta] || 18) + (rec.faction === 'alien' ? -25 : 0);
        return { silence: U + gauss(g) * 6 > 0 };
      }
      case 'xenoKill': {                                   // 双刀：同目标合法（突破用；v21：ε-greedy）
        const ranked = al.map(x => ({ x, U: dangerOf(g, p, x.id), conf: confOf(g, p, x.id) }))
          .sort((a, b) => b.U - a.U);
        const kc = argmax(g, ranked.map(r => ({ v: r.x.id, U: r.U, conf: r.conf })), EPS.survival);
        const top = ranked.find(r => r.x.id === (kc && kc.v)) || ranked[0];
        const targets = top ? [top.x.id] : [];
        if (p.awakened && top) {
          /* 7.4：觉醒后第二刀允许指向同一目标（突破一次性保护层的预期用法） */
          if (top.U > 60 || ranked.length === 1) targets.push(top.x.id);
          else if (ranked[1]) targets.push(ranked[1].x.id);
        }
        return { targets };
      }
      case 'shoot': {                                      // 1.4×Dg − 1.4×(θ+35)，终局 −30（v21：去 gauss 加噪）
        const th = p.theta + 35 - (alive(g).length <= 6 ? 30 : 0);
        const scored = al.map(x => ({ x, U: 1.4 * dangerOf(g, p, x.id) - 1.4 * th }))
          .sort((a, b) => b.U - a.U);
        const targets = [];
        for (const s of scored) { if (targets.length >= p.bullets) break; if (s.U > 0) targets.push(s.x.id); }
        return { targets };
      }
      case 'alienAct': {
        /* v4 第二章：四选一随机倾向（击杀偏多/感染偏少，无价值导向）+ 抑制挤兑收益 + 反拖延疲劳 */
        const noCd = p.alien.dir === 'kill';
        const hRatio = aliveF(g, 'human').length / 11;
        const protPen = t => exposedEngineer(g, t) ? 15 + 10 * hRatio : 0;
        const ranked = al.filter(x => !isAlly(p, x))
          .map(x => ({ x, T: dangerOf(g, p, x.id) })).sort((a, b) => b.T - a.T);
        const best = ranked[0];

        /* —— 随机倾向系数（v4 2.2）：每夜每只独立采样 —— */
        const kKill = 1.00 + g.rng.next() * 0.30;               // KILL_BIAS [1.00, 1.30]
        const kInfect = 0.70 + g.rng.next() * 0.30;             // INFECT_BIAS [0.70, 1.00]

        /* 击杀效用（v4 2.5）：T×0.9×击杀加成×时间衰减×kKill − 暴露保护惩罚 */
        const cleared = (11 - aliveF(g, 'human').length) / 11;
        const killWeight = 1 + 0.5 * cleared;                   // KILL_RAMP = 0.5
        const timeDecay = 0.5 + 0.5 * (Math.max(g.countdown, 0) / 24);   // KILL_TIME_DECAY = 0.5
        /* v23 批次 3：报复心转化为咬人倾向——被冤枉的异形优先反咬指控者 */
        const uKill0 = best ? best.T * 0.9 - protPen(best.x) + GRUDGE_W[p.theta] * grudgeLevel(g, p, best.x.id) : -Infinity;

        /* 感染效用（v4 2.4）：抑制/救援挤兑收益 + 抵挡层惩罚（删除「绕过保护」错误前提） */
        const suppressDepletion = (() => {
          const preyAlive = aliveF(g, 'human').length + aliveF(g, 'xeno').length;
          const used = (g.infectedDeaths || 0) + (g.actCounts.cure || 0);   // 感染致死 + 医生清除（⑫）
          return clamp(1 - used / Math.max(1, preyAlive * 3), 0, 1);        // 剩余抑制充裕度 0~1
        })();
        const suppressValue = suppressDepletion > 0 ? 10 : 25;  // 抑制耗尽 → 感染转为真实致死
        const estBlock = t => (t.repairExposed ? 1 : 0) + (doctorsAlive > 0 ? 1 : 0);   // 可见信息估计
        const uInfectV = best
          ? best.T * 0.6 * kInfect - doctorsAlive * 8 - estBlock(best.x) * 12 + suppressValue
          : -Infinity;

        /* 结茧 / 放弃：反拖延疲劳（v4 6.2，不含保镖自保与医生自救） */
        const streak = p.guardStreak || 0;
        const fatigue = streak >= 2 ? (streak >= 3 ? -Infinity : -30) : -streak * 15;   // ANTI_STALL_MAX=2 / PEN=15
        const pAtt = p.destroyedExposed ? 0.6 : 0.3;
        const uCocoon = p.shield <= 0 ? pAtt * p.vSelf + fatigue : -Infinity;

        const opts = [
          { v: 'kill', U: canKill(p) && best ? uKill0 : -Infinity },
          { v: 'infect', U: g.extinction ? -Infinity : uInfectV },
          /* v26 修复：此处原为 `pAtt * p.vSelf`（不含疲劳）——含反拖延疲劳的 uCocoon 只在寂灭分支
             被使用，导致 v4 6.2 的反拖延机制在常规对局中整体失效（结茧可无限期拖延）。 */
          { v: 'cocoon', U: uCocoon },
          { v: 'none', U: 0 },
        ];
        if (g.extinction) { opts.length = 0; opts.push({ v: 'kill', U: canKill(p) && best ? uKill0 * kKill : -Infinity }, { v: 'cocoon', U: uCocoon }, { v: 'none', U: 0 }); }   // 寂灭收敛（1.4）
        const c = argmax(g, opts, EPS.survival);   // 生存决策：ε=0.15（v21 改动 #10）
        if (c.v === 'kill' && best) {
          /* 6.4 队内协调：先按已占用目标过滤，撞车改选次优（g.alienPlan 由步骤 7 req 重置） */
          const taken = new Set(g.alienPlan || []);
          let pickT = best.x;
          if (taken.has(pickT.id)) {
            const alt = ranked.find(r => !taken.has(r.x.id));
            if (alt) pickT = alt.x;
          }
          const targets = [pickT.id];
          if (p.alien.extraKill > 0) {
            const alt2 = ranked.find(r => r.x.id !== pickT.id && !taken.has(r.x.id));
            if (alt2) targets.push(alt2.x.id);
          }
          g.alienPlan = (g.alienPlan || []).concat(targets);
          return { act: 'kill', targets };
        }
        if (c.v === 'infect') {
          const cap = p.alien.dir === 'infect' ? 3 : 2;
          /* v4 2.3：目标默认选满上限，偶尔因怕信息暴露少选或不选（盲选分布） */
          const r = g.rng.next();
          const dist = cap === 3 ? [[3, 0.62], [2, 0.26], [1, 0.10], [0, 0.02]]
                                 : [[2, 0.70], [1, 0.22], [0, 0.08]];
          let n = cap, acc = 0;
          for (const [cnt, prob] of dist) { acc += prob; if (r < acc) { n = cnt; break; } }
          /* 候选 = 存活非异形（盲选，按威胁度排序，濒死除外）+ 假标记队友（稀有战术 ≤5%） */
          const pool = ranked.filter(x => !x.x.dying && !x.x.infection).map(x => x.x.id);
          const mates = aliveF(g, 'alien').filter(x => x.id !== p.id && !x.out && !x.infection)
            .map(x => ({ id: x.id, U: doctorsAlive > 0 ? 25 : 5 }));
          const fake = g.rng.chance(0.05) ? mates.sort((a, b) => b.U - a.U)[0] : null;
          let tg = pool.slice(0, n);
          if (fake && tg.length < cap) tg = tg.concat([fake.id]);
          return tg.length ? { act: 'infect', targets: tg } : { act: 'none', targets: [] };
        }
        if (c.v === 'cocoon') return { act: 'cocoon', targets: [] };
        return { act: 'none', targets: [] };
      }
      case 'doctor': {                                     // ⑤ 三类
        const infected = g.players.filter(x => !x.out && x.infection);
        const dying = g.players.filter(x => !x.out && x.dying);
        const canRescue = p.role === 'rescue' || p.role === 'tempdoc';
        const blocked = p.silenceNight === g.night || p.noActive;
        if (blocked) return { act: 'none', targets: [] };
        const opts = [{ v: 'none', U: 0 }];
        /* 5.2⑤：自救与治疗/救援同场 argmax，U = V_self×(濒死?1:0.5) */
        if (p.dying && ((p.role === 'bio' && p.selfSaveLeft > 0) || (canRescue && p.rescueLeft > 0)))
          opts.push({ v: 'selfsave', U: p.vSelf * (p.dying ? 1 : 0.5), targets: [p.id] });
        if ((p.role === 'bio' && p.healLeft > 0) || (p.role !== 'bio' && p.cureLeft > 0)) {
          const pool = p.role === 'bio' ? p.healLeft : p.cureLeft;
          const PT = global.Tactics;
          /* v31 批 3.5（N416）：抗体优先给预告者（抵 1 次感染）。两条落地要点：
               ① 治疗【即】赋予抗体（steps.js '8' 的 had=false 分支照样授予）⇒ 允许对
                  「尚未感染」的关键预告者预投抗体 —— 这正是「抵 1 次感染」的真实语义；
               ② 优先级走【连续权重】（Tactics.protectionBonus），不是硬规则；
                  医生分支的 ε = EPS.survival(0.15) 保证次要选项仍有选择率（N417 口径）。
             候选池 = 感染者 ∪ 关键预告者（仅生化医师有抗体，故只对其扩容）。 */
          const fore = (p.role === 'bio' && PT)
            ? al.filter(x => !x.infection && !x.dying && PT.protectPriority(g, p, x, 'bio') >= 3) : [];
          const cand = infected.concat(fore);
          if (cand.length) {
            /* P(真) 由标记清单逐夜比对得出（R7 回流）：滞留时间超过预期致死间隔 → 大概率假标记。
               v31 批 3.5 补 `!x.infection` 分支：N416 的预投目标身上没有标记，
               旧写法会在 `x.infection.deathNight` 上抛 TypeError。 */
            const pReal = x => {
              if (!x.infection) return 0.5;                      // 无标记（N416 预投抗体）：中性
              const seen = p.markSeen && p.markSeen.get(x.id);
              if (seen == null || !x.infection.deathNight) return 0.6;
              const expect = x.infection.deathNight - seen;      // 2 = 普通感染、1 = 感染进化
              return (g.night - seen) >= expect ? 0.1 : 0.8;
            };
            const best = cand.map(x => ({
              x,
              U: pReal(x) * 60 - (1 - pReal(x)) * 10 + gauss(g) * 12 +
                 (p.role === 'bio' && PT ? PT.protectionBonus(g, p, x, 'bio') : 0),
            })).sort((a, b) => b.U - a.U);
            opts.push({ v: 'heal', U: best[0].U, targets: best.slice(0, Math.min(pool, 3)).map(b => b.x.id) });
          }
        }
        if (canRescue && p.rescueLeft > 0 && dying.length) {
          const scored = dying.map(x => ({ x, U: (1 - dangerOf(g, p, x.id) / 100) * 60 - (dangerOf(g, p, x.id) / 100) * 40 }))
            .sort((a, b) => b.U - a.U);
          opts.push({ v: 'rescue', U: scored[0].U, targets: scored.slice(0, Math.min(p.rescueLeft, 2)).map(s => s.x.id) });
        }
        if (!p.brew) opts.push({ v: 'brew', U: p.healLeft + p.cureLeft + p.rescueLeft <= 0 ? 30 : 8 });
        const c = argmax(g, opts, EPS.survival);   // 生存决策：ε=0.15（v21 改动 #10）
        if (c.v === 'heal' || c.v === 'rescue' || c.v === 'selfsave') return { act: c.v, targets: c.targets };
        if (c.v === 'brew') return { act: 'brew', targets: [], product: rng.chance(0.5) ? 'rescue' : 'heal' };
        return { act: 'none', targets: [] };
      }
      case 'xenoCure': return { use: !!(p.infection && p.infection.real && p.cureSelf > 0) };
      case 'meeting': {                                    // U = 揭穿收益 − 暴露代价×(θ/50)
        if (alive(g).length < 5) return { call: false };
        const strong = alive(g).some(x => dangerOf(g, p, x.id) >= 60);
        const U = (strong ? 55 : 15) - 40 * (p.theta / 50) + gauss(g) * 18;
        return { call: U > 0 };
      }
      case 'clean': return { do: true };
      case 'vote': return { target: vote(g, p) };
    }
    return {};
  }

  function canKill(p) { return p.alien.dir === 'kill' || p.alien.kills >= 1; }
  function clearedK(g) { return (11 - aliveF(g, 'human').length) / 11; }
  function threatTop(g, p) {
    let m = 0;
    for (const x of alive(g)) if (x.id !== p.id) m = Math.max(m, dangerOf(g, p, x.id));
    return m;
  }
  function dirOcc(g) {
    const occ = { destroy: 0, infect: 0, kill: 0 };
    for (const a of g.players) if (a.faction === 'alien')
      for (const k of ['destroy', 'infect', 'kill']) if (a.alien.dirs[k]) occ[k]++;
    return occ;
  }
  function exposeRiskInc(p) {
    const gap = 4 - p.repairTotal;
    return gap <= 0 ? 0 : gap <= 0.5 ? 45 : gap <= 1 ? 25 : 8;
  }
  function rankLow(g, p, list, n) {
    return list.slice().sort((a, b) => dangerOf(g, p, a.id) - dangerOf(g, p, b.id)).slice(0, n);
  }


  global.AIDecide = {
    urgency, exposedEngineer, knownRepairers, EPS, confOf, argmax, argmaxProtect, speak, evilIntent, vote, inviteUtility, decide, canKill, clearedK, threatTop, dirOcc, exposeRiskInc, rankLow,
  };
})(typeof window !== 'undefined' ? window : globalThis);
