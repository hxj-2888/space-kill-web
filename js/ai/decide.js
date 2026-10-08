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
  const RD = global.SKRoleDecl;                 // v6.6 阶段 2（D6）：能力分发表 / 转职方向池
  const ACT = global.SKDerivation;              // v6.6 阶段 2（H21）：查证池推导（4.1.1 ①②③）
  const TR = global.SKTrait;                    // v6.6 阶段 2（K2）：性格轴声明（档位参数唯一真源）
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
    return !x.out && x.faction === 'human' && x.repairExposed && RD.hasGrant(x.role, 'repair');   // D6
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
      if (k && RD.hasGrant(k.role, 'repair')) { n += 1; continue; }        // D6：能力标签（工程师系）
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
  /* 〔批次 37 · U1 变体 AI 策略〕三个变体/规则主动技能的策略参数（decide 派发 case 消费）。
     此前 sniff／wiretapReport／disguise 恒缓发（批次 28/29 注释「随批次 22」）——本批接上。
     θ 档发动率（sniffRate/disguiseRate/disguiseProactive）在 traits.js 声明轴（K2 纪律：
     档位知识只在声明层），本表只留**非 θ 维度**的选角权重与攒弹倾向；额度、互斥与池外
     不生效仍由引擎侧收口（steps.js run 段）。导出以便门禁做回退验证。 */
  const VA = {
    gatherRate:   0.40,                              // 4.4.7①：无可射目标时改攒弹（而非放弃）的倾向
    /* 7.3.1 加权选角：只从人类职业里挑（伪装成异形/外星人 = 自曝）；crew 最重（最不显眼），
       关键位低权（口头冒领有 N400 追责链，机制乔装虽不公告但查验口径会背书，仍须谨慎）。
       未列出的池内人类角色取缺省权 3。 */
    disguiseW: { crew: 45, bio: 8, rescue: 4, tempdoc: 3, engineer: 12, assistant: 4,
                 sheriff: 8, bodyguard: 4, artisan: 3, detective: 5, inspector: 2, hunter: 2 },
    disguiseWDefault: 3,
  };
  function confOf(g, p, id) {
    if (id == null) return 0;
    const d = suspDist(g, p, id);
    return BEL.distMax(d);                                   // 主观置信度 = 分布最大项（D2：维度开放）
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

  /* ============ 拟人层 B · 推理链发言 ============
     人指控时几乎总会给出理由，而理由来自**自己记得的**具体事。函数从说话者
     合法持有的信息中取一条最强的「因为」，取不到时返回 null（调用方回落到
     旧的无理由模板——不强凑，避免生成无依据的话）。

     口径纪律（关键）：只引**自己确实持有**的信息——
       · 硬源（p.known：自己查验所得或官方公告所报）；
       · 长期记忆（自己听过的发言：自称、承诺、改口、立场）；
       · 证据链（自己 tEvents 里的积累条数，只报条数不报内容）。
     **不泄露任何隐藏字段**（他人真实身份/阵营/私有额度）——那不是推理，是透视。 */
  function reasoningChain(g, p, target) {
    const t = (target && typeof target === 'object') ? target.id : (target != null ? target : p.lastAccuse);
    if (t == null) return null;
    const D2 = global.SKData;
    const roleName = k => (D2 && D2.ROLES[k] ? D2.ROLES[k].name : k);
    const MEM = global.AIMemory;
    const nid = p.id;

    /* ① 硬源：自己查过的人，最硬的理由（4.1.1/4.7 查验是本人合法持有） */
    if (p.crewChecks && p.crewChecks.get) {
      const rec = p.crewChecks.get(t);
      if (rec && rec.results && rec.results.length) {
        const yes = rec.results.filter(r => r.ans);
        if (yes.length) return `我查过 ${t} 号，${yes[yes.length - 1].id ? roleName(yes[yes.length - 1].id) : '他的身份'}。所以我投他。`;
        return `我查过 ${t} 号，他不是他自称的那个。`;
      }
    }
    if (p.checkPool && p.checkPool.get) {
      const r = p.checkPool.get(t);
      if (r && r.role) return `${t} 号的查验在我这儿，是${roleName(r.role)}。`;
    }
    const k = p.known.get(t);
    if (k && k.faction) return `${t} 号的身份是明摆着的——公告白纸黑字写着。`;

    /* ② 长期记忆：改口（人脑最强烈的一类记忆） */
    if (MEM) {
      const m = p.mem;
      if (m) {
        const e = m.saidRole.get(t);
        if (e && e.conflictWith)
          return `他第 ${e.nights[0]} 夜说自己是${roleName(e.prevRole)}，第 ${e.nights[e.nights.length - 1]} 夜又说自己${roleName(e.conflictWith)}。一个人两张脸，我不信他。`;
        /* 单次自称也值得说——「我记着他说过自己是X」正是人建立怀疑的起点，
           无需等到改口才开口（此前的窄口径使链条几乎恒为 null，实测 0/84）。 */
        if (e && e.role && e.times >= 1)
          return `${t} 号自称${roleName(e.role)}——我记着这话，等他露馅。`;
        const ps = m.promise.get(t);
        if (ps && ps.length) {
          const last = ps[ps.length - 1];
          return `他第 ${last.night} 夜答应过${last.tier === 'strong' ? '一定查他' : '不会带节奏'}，结果呢？`;
        }
        const st = m.stance.get(t);
        if (st && Math.abs(st.score) >= 3)
          return `这几天他一直在${st.score > 0 ? '帮别人站台' : '带节奏'}，我记着呢。`;
      }
    }

    /* ③ 证据链：只报条数（说「我攒了 N 条对不上的地方」而非泄露内容）。
       门槛 2 条：实测多数对局中人对单个目标的证据量在这个量级，
       门槛过高会使本通道形同虚设（治理：以读数校验通道真跑，而非以观感设门槛）。 */
    const ev = p.tEvents && p.tEvents.get ? p.tEvents.get(t) : null;
    if (ev && ev.length >= 2) {
      return `我对 ${t} 号的怀疑不是一天两天了，攒了 ${ev.length} 条对不上的地方。`;
    }
    return null;
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
      /* 拟人层 B · 推理链发言：空口指控最不拟人——人指控时**总要给一条理由**，
         且理由来自自己**记得**的东西。此处按优先级取一条可引用的「因为」：
           ① 硬源（自己查验/官方公告摆在那）② 长期记忆（他自称过什么、改过口）
           ③ 证据链（我这些天积累的证据条数）④ 立场（他一直站谁那边）
         口径纪律：只引**自己合法持有**的信息（7.0 推理自由），不泄露隐藏字段。 */
      const chain = reasoningChain(g, p, top);
      if (chain) {
        text = chain;
      } else {
        text = pick(rng, [
          `${why} 我怀疑他是异形。`,
          `我的票在 ${top.id} 号身上。`,
          `投 ${top.id} 号，错杀也比全灭强。`,
          night0 ? `${top.id} 号开局就 sus，我先记一笔。` : `${top.id} 号这几晚太划水了，盘不出深浅还占位置。`,
          `${top.id} 号的发言我踩一下，节奏不对。`,
        ]);
      }
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
        `${top.id} 号，开局这套发言太保守了，全是场面话。`,
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
      if (pool.length && rng.chance(TR.traitValue('theta', 'claimRate', p.theta))) {   // K2：档位表由声明给出
        const rec = rng.pick(pool);
        /* B5（4.7.1）：查验只得知呈现职业——宣称方向由职业确定性推论（职业→阵营同口径） */
        const lf = D.ROLES[rec.role] ? D.ROLES[rec.role].faction : null;
        if (IR) p.outClaims.push(IR.mk('lock', [rec.id], { faction: lf, role: rec.role, good: lf === 'human' }, meta));
        text = `我查过 ${rec.id} 号，他的职业是（${D.ROLES[rec.role].name}）。`;
        claimRole = 'detective';
      } else text = '我手里的查验结果先压一夜。';
    } else if (!evilIntent(p) && p.role === 'crew' && p.crewChecks.size && rng.chance(0.6)) {
      const rec = [...p.crewChecks.entries()].map(([id, v]) => ({ id: +id, v })).filter(x => !byId(g, x.id).out);
      if (rec.length) {
        const r0 = rng.pick(rec);
        /* A13（4.1.1 验证式）：口头汇报验证结果——按最近一次「是」作答宣称身份；
           「否」是统一口径，不区分「是人类但非该身份」与「不是人类」，故不上报。
           4.1.2：口头汇报属可伪造宣称，不写全场硬锁（硬锁只认官方 ③ 公告）。 */
        const yeses = (r0.v.results || []).filter(x => x.ans);
        if (yeses.length) {
          const ry = yeses[yeses.length - 1];
          const rf = D.ROLES[ry.id] ? D.ROLES[ry.id].faction : null;
          text = `我查过 ${r0.id} 号，他是${D.ROLES[ry.id].name}。`;
          p.pendingPublic = { id: r0.id, kind: 'lock', faction: rf };
          if (IR) p.outClaims.push(IR.mk('lock', [r0.id], { faction: rf, role: ry.id, good: rf === 'human' }, meta));
        } else {
          /* 全部为「否」：只报「已验证」，不展开否决了哪些身份——否证清单本身即情报 */
          text = `我验证过 ${r0.id} 号的身份，和我说的对不上。`;
        }
        claimRole = 'crew';
      } else text = '我这轮先听大家的信息。';
    } else if (!evilIntent(p) && RD.hasGrant(p.role, 'shoot') && rng.chance(TR.traitValue('theta', 'shootRate', p.theta))) {   // D6/K2
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
      /* 〔第三十批 拟人层〕队内/伪装语料池 2 条 → 5 条：这两条是异形/外星人的「非公开语料」，
         出现频率高（每夜约 30% 概率触发），池小必然复读。内容仍受 2.8.7 约束
         ——不泄露己方身份与计划，只做带节奏/稳住阵线这类公开可见的表层动作。 */
      const mate = p.faction === 'alien' ? aliveF(g, 'alien').find(x => x.id !== p.id && !x.out) : null;
      text = mate ? pick(rng, [`${mate.id} 号跟我对过信息，他没问题。`, '别急着投人，先看死因。',
                                `${mate.id} 号那边的说法我信一半。`, '先压一轮节奏，别让人带跑。',
                                '今晚死因是关键，其他先放放。'])
                  : pick(rng, ['我是普通船员，我这轮先稳住。', '这么快带节奏，正中对方下怀。',
                                '我先不表态，看谁先露破绽。', '这一轮我站边，但不急。',
                                '你们吵，我听着就行。']);
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
          /* B5（4.7.1）：查验只得知呈现职业——私下交底按职业口径，不代报阵营 */
          p.lastShare = { id: rec.id, role: rec.role };
          text = `私下跟你说：我查过 ${rec.id} 号，他的职业是（${D.ROLES[rec.role].name}）。`;
        }
      } else if (p.crewChecks && p.crewChecks.size) {
        /* A13：验证式私聊交底——只报「是」结果（否证清单不上报） */
        const yes = [...p.crewChecks.entries()].map(([id, v]) => ({ id: +id, v }))
          .filter(x => !byId(g, x.id).out && (x.v.results || []).some(r => r.ans));
        if (yes.length) {
          const r0 = rng.pick(yes);
          const ry = r0.v.results.filter(r => r.ans).pop();
          const rf = D.ROLES[ry.id] ? D.ROLES[ry.id].faction : null;
          p.lastShare = { id: r0.id, faction: rf, role: ry.id };
          text = `私下跟你说：我验证过 ${r0.id} 号，他的职业是（${D.ROLES[ry.id].name}）。`;
        }
      }
    }
    /* v26：异形队内频道（quiet）不应产出「我是普通船员」这类对外伪装话术——队友当然知道你是谁，
       这句话在队内既无意义又会污染复盘。改为按计划沟通的口径，并撤销本次身份声称。 */
    if (quiet && claimRole && evilIntent(p)) {
      text = pick(rng, ['按计划走，别乱。', '我这边稳住，你们看情况。', '别急着表态，先看死因。',
                        '我先不动，等下一个窗口。', '今晚别单独出头，等我信号。', '目标我心里有数，别点我。']);
      claimRole = null;
    }
    if (claimRole) { p.claimedRole = claimRole; }   /* accuseHistory 由 onAccuse 统一记录，此处不再手动 push（避免双计） */
    if (quiet) { p.lastAccuse = null; if (claimRole) p.claimedRole = null; }
    else if (claimRole) onClaim(g, p, claimRole);
    /* 〔批次 35 · 定制发言〕语气层（拟人层 Ⅲ）：θ 档决定「怎么说」——公开发言按 voiceRate
       概率带 θ 档开场/口头禅；私聊只替换交底开场白。只包装不改内容：指控对象、IR 意图
       （p.outClaims 已在上面 push 完）与声称语义均不受影响。rng 消耗发生在出口处，
       顺序确定（开场 roll → 口头禅 roll），可复算。 */
    if (global.Voice) text = global.Voice.tone(p, text, rng, { quiet });
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
      : -5 + TR.traitValue('theta', 'abstainBias', me.theta);          // K2：性格偏置由声明给出
    /* v22 性格化行动门槛：危险度基线随性格偏移（激进 30/保守 70），行动门槛须反向联动——
       激进低门槛 + 低基线 = 敢投；保守高门槛 + 高基线 = 慎重。固定 20 会让激进者整体哑火。 */
    const actLine = TR.traitValue('theta', 'actLine', me.theta);        // K2：行动线由声明给出
    const opts = [{ v: null, U: abstain }];                       // 5.1：弃票同为候选，防止过度行动
    for (const x of al) {
      const Dg = dangerOf(g, me, x.id);
      if (Dg < actLine) continue;                                 // 性格化门槛（队友锁 0 天然排除）
      let U;
      if (me.faction === 'alien') {
        const param = TR.traitValue('theta', 'voteParam', me.theta);        // K2：票型参数由声明给出
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
      RD.hasGrant(x.role, 'treat') || RD.hasGrant(x.claimedRole, 'treat')).length);   // D6：能力标签（医生系）

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
        /* D6：转职方向池由声明层派生（transferred:true 的角色，声明序 = 历史字面量顺序
           armed,assistant,tempdoc）——顺序敏感（rng.pick 的输入），故由声明序保证等价。 */
        const dir = sheriffDead ? 'armed' : docDead ? 'tempdoc' : urg > 0.5 ? 'assistant' : rng.pick(RD.transferRoles());
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
          /* A13（4.1.1 验证式）：提交 1~2 个待查证身份——优先验证目标宣称（抓谎），其余按敌情假设。
             第 1 次（查验者×目标）仅提交人类职业池身份；第 2 次起可加验「异形/外星人」假设。
             H21（4.1.1 ①②③ + I3）：两个池都由推导层给出（随本局构成浮动、且移除全部持有者
             已出局的职业）——此前 AI 侧不做任何过滤，会提交「已无真实持有者」的身份，
             与 ③「系统仅提供可查范围内的职业供选，故不存在无效查证」相悖。 */
          const prev = t ? p.crewChecks.get(t.id) : null;
          const isFirst = !prev || prev.n === 0;
          const humanPool = ACT.verifyPool(g, { first: true });
          const fullPool = ACT.verifyPool(g);
          const activePool = isFirst ? humanPool : fullPool;
          if (!activePool.length) return { mode: 'none' };          // 可查范围为空：不提交（4.1.1③）
          const id1 = (t && t.claimedRole && activePool.includes(t.claimedRole))
            ? t.claimedRole
            : (isFirst ? humanPool[Math.floor(rng.next() * humanPool.length)]
                       : (rng.chance(0.45) || humanPool.length === 0 ? 'alien' : humanPool[Math.floor(rng.next() * humanPool.length)]));
          const ids = [id1];
          if (!isFirst && rng.chance(0.4)) ids.push(id1 === 'xeno' ? 'alien' : 'xeno');
          return { mode: 'check', target: t ? t.id : null, ids };
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
          /* B5（4.7.1）：池内只存呈现职业——公告价值由职业确定性推论阵营后判读 */
          const values = pool.map(x => {
            const f = D.ROLES[x.role] ? D.ROLES[x.role].faction : null;
            return f === 'alien' ? 60 : f === 'xeno' ? 50 : -30;
          });
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
        /* v6.6 2.3 表 #5/#6：维修与追加维修各 −1.0~1.5 六档自选——紧迫度越高越拉满，含风险折价 */
        const aOpts = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5]
          .map(v => ({ v, U: urg * ((v - 1.0) / 0.5) * 50 - riskTerm * 0.3 }));
        const ap = argmax(g, aOpts, EPS.main);
        const extra = p.role === 'engineer' && p.extraRepair > 0 && urg > 0.4 &&
                      (g.net10 < 30 ? (30 - g.net10) < 5 : g.net10 < 60 && (60 - g.net10) < 5) &&
                      rng.chance(0.7);
        return { do: doIt, extra,
                 value: doIt && ap ? ap.v : 1.0,
                 extraValue: extra ? (urg > 0.6 ? 1.5 : 1.0) : 1.0 };
      }
      case 'safeRoom': {                                   // 4.3.1 工程师限定技（全局 1 次）
        /* 代价是当夜放弃维修：仅在高威胁（自身危险度高 / 临近暴露阈值）或残局时使用 */
        const nearExpose = p.repairTotal >= (p.role === 'engineer' ? 3.0 : 2.0);
        const use = !p.safeRoomUsed && (dangerOf(g, p, p.id) > 55 || nearExpose || al.length <= 4);
        return { use };
      }
      case 'awaken': {
        /* 6.2：觉醒可选不强制——残局/激进性格更早觉醒 */
        const dc = TR.traitValue('theta', 'destroyChance', p.theta);        // K2：档位表由声明给出
    const doIt = al.length <= 6 ? true : dc >= 1 ? true : rng.chance(dc);   // ≥1 = 必然（不消耗随机数，与迁移前一致）
        return { do: doIt };
      }
      case 'branch': {                                     // 4b 破坏/结茧（A7：0.7 预提交已删，四选一拆至 0.1/4b/5/8 各步）
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
            /* v6.6 2.3 表 #4：未进化破坏量 1.5~2.0（六档，步长 0.1）；破坏进化 2.0~3.0 不变 */
            const lo = big ? 20 : 15, hi = big ? 30 : 20;
            const next10 = g.net10 < 30 ? 30 : g.net10 < 60 ? 60 : 90;
            const gap10 = next10 - g.net10;
            const cross = [];
            if (gap10 > 0) for (let v = lo; v <= hi; v++) if (g.net10 + v >= next10) cross.push(v);
            if (p.alien.destroyTotal10 >= 60) sabAmount = hi;            // N92：已暴露无代价 → 最大档
            else if (cross.length && rng.chance(0.5)) sabAmount = cross[0];  // N49：恰好跨档
            else sabAmount = rng.chance(0.9) ? lo : lo + rng.int(hi - lo + 1);  // N367：未暴露以最小档保隐蔽（总表 N367 判据），10% 噪声防众数指纹（N74/N84）——v25 C2：删「实测显著优于」的循环论证表述，策略依据回归总表条目
          }
          /* A14/5.7①：结茧可指定任意存活玩家——未选破坏时按威胁自保或掩护濒危队友 */
          if (!go && p.shield <= 0 && rng.chance(0.3)) {
            const matesAtRisk = g.players.filter(x => x.faction === 'alien' && !x.out && x.id !== p.id && x.shield <= 0);
            const risky = matesAtRisk.length
              ? matesAtRisk.reduce((a, b) => (dangerOf(g, p, b.id) > dangerOf(g, p, a.id) ? b : a)) : null;
            const useSelf = !risky || dangerOf(g, p, p.id) >= dangerOf(g, p, risky.id) || rng.chance(0.5);
            return { branch: 'cocoon', cocoonTarget: useSelf || !risky ? p.id : risky.id };
          }
          return { branch: go ? 'destroy' : 'none', num: sabAmount };
        }
        /* 外星人破坏（6.3，全局 1 次）：于 4b 决策——蛰伏已在 0.1 自行决定（branch='check' 者
           req 已排除、不会进入本步），击杀在步骤 5 自行决定。破坏 → 次夜停转 + 当夜放弃击杀/自疗。 */
        if (g.extinction || p.destroyLeft <= 0) return { branch: 'none' };
        {
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
        return { branch: 'none' };
      }
      case 'xenoCheck': {                                  // U(i) = Dg_i，已确认异形 ×1.5（v21：ε-greedy）
        /* 6.1：蛰伏与否 = 外星人当夜四选一之一（vs 4b 破坏 / 5 击杀 / 8 自疗）——保持约 1/4 蛰伏率 */
        if (!rng.chance(0.25)) return {};
        const copts = al.map(x => {
          const k = p.known.get(x.id);
          let U = dangerOf(g, p, x.id);
          /* B5：known 不再为揭示路径携带阵营字段（2.8.12④），硬源阵营经 knownLockOf 推论 */
          if ((k && k.faction === 'alien') || knownLockOf(p, x.id) === 'alien') U *= 1.5;
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
        /* 6.1.2(a)：上一夜已被沉默者本夜不可再沉默 */
        if (!t || t.out || t.lastSilenceNight === g.night - 1) return { silence: false };
        const val = { detective: 40, inspector: 38, sheriff: 34, bio: 30, rescue: 30, armed: 30,
                      tempdoc: 24, engineer: 22, assistant: 20, bodyguard: 14, crew: 8 }[t.role] || 10;
        /* B5（6.1.1①）：蛰伏查验不报阵营——按呈现职业判读（呈现为异形 ⇒ 队友，降权） */
        const U = val - TR.traitValue('theta', 'killBase', p.theta) + (rec.role === 'alien' ? -25 : 0);   // K2
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
        /* 〔批次 37 · U1〕嗅探反哺：猎手当夜 3.5 的结构化结果（steps.js 写 p.sniffLog）——
           确认「呈现保护状态」的目标从开枪名单剔除（省子弹；玩家同一信息在 priv 文本里，
           AI 用结构化形态，无新增知情）。警长无 sniffLog，集合恒空 → 行为不变。 */
        const guarded36 = new Set((p.sniffLog || []).filter(s => s.night === g.night && s.guarded).map(s => s.id));
        const scored = al.map(x => ({ x, U: 1.4 * dangerOf(g, p, x.id) - 1.4 * th }))
          .sort((a, b) => b.U - a.U);
        const targets = [];
        for (const s of scored) {
          if (targets.length >= p.bullets) break;
          if (s.U > 0 && !guarded36.has(s.x.id)) targets.push(s.x.id);
        }
        /* 〔批次 37 · U1〕攒弹分支（4.4.7①②b）：无可射目标且今夜未嗅探 → 按倾向改攒弹
           （2 夜后 +1 发），而非放弃——三选一的真实使用。 */
        if (p.role === 'hunter' && !targets.length && !p.sniffedTonight && rng.chance(VA.gatherRate))
          return { opt: 'gather' };
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

        /* 感染效用（v4 2.4）：抑制/救援挤兑收益 + 抵挡层惩罚（删除「绕过保护」错误前提）
           批⑫撤除（2026-10-04，3.3.7「任何玩家均无从得知清除类出手次数」）：used 不再含
           g.actCounts.cure（全场清除累计，AI 不可读）——感染致死数（⑥ 调查报告公开口径）
           是异形估计抑制压力的唯一合法公开来源；抑制人数本身不予通报（3.3.7(11)）。 */
        const suppressDepletion = (() => {
          const preyAlive = aliveF(g, 'human').length + aliveF(g, 'xeno').length;
          const used = (g.infectedDeaths || 0);   // 感染致死（⑥ 公开），不再读全场清除累计
          return clamp(1 - used / Math.max(1, preyAlive * 3), 0, 1);        // 剩余抑制充裕度 0~1
        })();
        const suppressValue = suppressDepletion > 0 ? 10 : 25;  // 抑制耗尽 → 感染转为真实致死
        const estBlock = t => (t.repairExposed ? 1 : 0) + (doctorsAlive > 0 ? 1 : 0);   // 可见信息估计
        const uInfectV = best
          ? best.T * 0.6 * kInfect - doctorsAlive * 8 - estBlock(best.x) * 12 + suppressValue
          : -Infinity;

        /* 〔v7 速查卡修正 · 2026-10-08〕**结茧不是步骤 7 的动作。**
           速查卡（异形条）明载：「每夜出刀／感染／破坏／结茧四选一（破坏／结茧在步骤 4b，
           出刀／感染在步骤 7）」；引擎步 '7' 的表单也只有 kill / infect / none
           （js/engine/steps.js:1146-1151，寂灭期 desc 写明「菜单收敛为出刀/感染」）。
           原实现把 'cocoon' 放进步 7 的选项池并返回 { act:'cocoon' }（decide.js:1117），
           后果有两处，都已实测：
             ① 引擎步 7 的提交处理只有 kill / infect 两个分支（steps.js:1163/1172），
                'cocoon' 落入 else 被**当作「放弃行动」**——异形的结茧意图被静默丢弃；
             ② steps.js:1189 的 `p.guardStreak = (act==='kill'||act==='infect') ? 0 : +1`
                因而被连带 +1 ⇒ 一个「连续未被抵挡」的无关状态被非法选项污染。
           实测：150 局共 169 次 ILLEGAL@7:cocoon（其余互斥动作 0 违规）。
           处置：步 7 选项池回归 [kill, infect, none]；结茧只在 4b 产生
           （见上方 branch 选择器的 `return { branch: 'cocoon', ... }`）。

           ⚠ 遗留待决（本批**不做**，因属策略权重的独立设计题）：
             v4 6.2「反拖延」机制（guardStreak 疲劳，随连续不出手而抬升惩罚）原本挂在步 7 的
             uCocoon 上（v26 批次的「修复」建立在「结茧属步 7」这一**误读**之上）。本修正后
             该机制在步 7 无处附着。按卡，结茧在 4b，故其正确归属应是 4b 的结茧闸门
             （`!go && p.shield<=0 && rng.chance(0.3)`）。但改它会直接改变破坏/结茧的发生频率，
             属策略权重，须单独一批 + 同种子 A/B 后再动。 */
        const opts = [
          { v: 'kill', U: canKill(p) && best ? uKill0 : -Infinity },
          { v: 'infect', U: g.extinction ? -Infinity : uInfectV },
          { v: 'none', U: 0 },
        ];
        if (g.extinction) { opts.length = 0; opts.push({ v: 'kill', U: canKill(p) && best ? uKill0 * kKill : -Infinity }, { v: 'infect', U: -Infinity }, { v: 'none', U: 0 }); }   // 寂灭收敛（1.4）：与步 7 表单一致（结茧已于 4b）
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
        /* 〔v7 速查卡修正〕'cocoon' 分支已删：结茧属步骤 4b，步 7 选项池不含它（见上方注释）。
           若此处仍有 c.v === 'cocoon'，说明选项池被回改——步 7 表单不接该值。 */
        return { act: 'none', targets: [] };
      }
      case 'doctor': {                                     // ⑤ 三类
        const infected = g.players.filter(x => !x.out && x.infection);
        const dying = g.players.filter(x => !x.out && x.dying);
        const canRescue = RD.hasGrant(p.role, 'save');                   // D6：能力标签（救援族）
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
        /* A6 批次 31 · 4.6.4：毒师的毒药/解药进入同场 argmax（五选一互斥，2.5.3）。
           · 下毒目标＝敌方阵营中危险度最高者（毒药要 2 夜才发作，押注对象价值高）；
             额度有限（全局 3），故只在敌营存在候选时出手，不浪费在无信息的第 1 夜。
           · 解药目标＝当前带毒药标记者（唯一起作用的对象），优先救队友。
           ε 沿用 EPS.survival——与医生其余分支同口径，策略强度随批次 22 拟人化再调。 */
        if (RD.hasGrant(p.role, 'poison')) {
          if (p.poisonLeft > 0) {
            const prey = al.filter(x => x.faction !== p.faction && !x.poison && !x.dying)
              .sort((a, b) => dangerOf(g, p, b.id) - dangerOf(g, p, a.id));
            if (prey.length && g.night >= 2)
              opts.push({ v: 'poison', U: 30 + dangerOf(g, p, prey[0].id) * 0.4 + gauss(g) * 10, targets: [prey[0].id] });
          }
          if (p.antidoteLeft > 0) {
            const poisoned = g.players.filter(x => !x.out && x.poison);
            if (poisoned.length) {
              const mine = poisoned.filter(x => x.faction === p.faction);
              const tgt = (mine[0] || poisoned[0]);
              opts.push({ v: 'antidote', U: 45 + (mine.length ? 15 : 0) + gauss(g) * 8, targets: [tgt.id] });
            }
          }
        }
        const c = argmax(g, opts, EPS.survival);   // 生存决策：ε=0.15（v21 改动 #10）
        if (c.v === 'heal' || c.v === 'rescue' || c.v === 'selfsave') return { act: c.v, targets: c.targets };
        if (c.v === 'poison' || c.v === 'antidote') return { act: c.v, targets: c.targets };
        if (c.v === 'brew') return { act: 'brew', targets: [], product: rng.chance(0.5) ? 'rescue' : 'heal' };
        return { act: 'none', targets: [] };
      }
      /* A6 批次 31 · 工匠（4.11.2）：常规铸造（2 夜）／速成铸造（1 夜）／分配 三者择一。
         U 口径（本批取保守初值，标定留批次 23 分阵营读数）：
           · 分配 ≫ 铸造：库存护甲立刻生效，收益不延迟；
           · 常规 vs 速成：速成 1 夜即成、但只生效 2 夜且到期消失；常规 2 夜成、永续。
             故「今夜是关键夜（已被点名/高危）」偏向速成，否则常规。
           · 分配目标：优先无甲者，按危险度降序（给最可能被攻击的人），含自身。 */
      case 'craft': {
        const opts = [{ v: 'none', U: 0 }];
        const castSt = global.SKProcessEngine && global.SKProcessEngine.stateOf(p, 'cast');
        const fastSt = global.SKProcessEngine && global.SKProcessEngine.stateOf(p, 'castFast');
        if (!fastSt) {
          /* 在进进度 2/2 的一步：续投（不重置） */
          if (castSt) opts.push({ v: 'cast', U: 55 + gauss(g) * 8 });
          else if (p.armorStock >= 2) opts.push({ v: 'cast', U: 8, });    // 满仓铸造＝浪费（4.11.3①）
          else opts.push({ v: 'cast', U: 22 + gauss(g) * 6 });
        }
        if (!castSt) {
          const hot = al.filter(x => dangerOf(g, p, x.id) >= 60).length;
          opts.push({ v: 'castFast', U: 18 + hot * 12 + gauss(g) * 8 });
        }
        if (p.armorStock > 0) {
          const bare = al.filter(x => !(x.armor && x.armor.mode))
            .sort((a, b) => dangerOf(g, p, b.id) - dangerOf(g, p, a.id));
          const selfBare = !(p.armor && p.armor.mode);
          const picks = bare.slice(0, p.armorStock).map(x => x.id);
          if (selfBare) picks.push(p.id);
          if (picks.length) opts.push({ v: 'give', U: 62 + bare.length * 4 + gauss(g) * 10, targets: picks.slice(0, 2) });
        }
        const c = argmax(g, opts, EPS.main);
        return { opt: c.v, targets: c.targets || [] };
      }
      /* A6 批次 32 · 死囚变形（6.8.3）：池＝本局在场人类职业 ∪ 异形。
         效用口径：变形是**战术切换**——夜晚免疫/保命能力在残局价值最高；前期变形收益低
         （会被查验、暴露职业），故按夜次与自身处境加权。异形克隆项在有队友时降权
         （队内互认不克隆，可能自伤队友，6.8.3⑧）。策略强度随批次 22 拟人化再调。 */
      case 'morph': {
        const M = global.SKMirror;
        const pool = M.morphPool(g, alive(g).map(x => x.originRole || x.role));
        const lateNight = g.night >= 5;
        const score = r => {
          let U = 12;
          if (r === 'alien') U = g.night >= 4 ? 34 : 14;                 // 克隆异形：出刀/破坏强，且有护盾
          else if (r === 'sheriff' || r === 'hunter') U = 20 + (lateNight ? 10 : 0);
          else if (r === 'detective') U = 16 + (g.night >= 3 ? 6 : 0);
          else if (r === 'bodyguard' || r === 'artisan') U = 18 + (lateNight ? 8 : 0);
          else if (r === 'engineer') U = 10;
          else if (r === 'crew') U = 6;                                   // 收益最低
          else U = 14;
          return U + gauss(g) * 8;
        };
        const ranked = pool.map(r => ({ v: r, U: score(r) })).sort((a, b) => b.U - a.U);
        const c = argmax(g, ranked.concat([{ v: 'none', U: lateNight ? 40 : 22 }]), EPS.main);
        return { opt: c.v };
      }
      /* A6 批次 32 · 死囚复生（6.8.4）：目标＝当夜濒死者，优先救人类（少一个敌人即多一分胜算），
         不救异形队友（无互认）。额度稀缺（全局 2），故只在濒死者为人类时出手。 */
      case 'revive': {
        const dying = alive(g).filter(x => x.dying);
        if (!dying.length || p.reviveLeft <= 0) return { use: false };
        const mine = dying.filter(x => x.faction === 'human');
        if (!mine.length) return { use: false };
        const best = mine.sort((a, b) => a.faction === b.faction ? 0 : 0)[0];
        return { use: true, targets: [best.id] };
      }
      case 'xenoCure': return { use: !!(p.infection && p.infection.real && p.cureSelf > 0) };
      case 'meeting': {                                    // U = 揭穿收益 − 暴露代价×(θ/50)
        if (alive(g).length < 5) return { call: false };
        const strong = alive(g).some(x => dangerOf(g, p, x.id) >= 60);
        const U = (strong ? 55 : 15) - 40 * (p.theta / 50) + gauss(g) * 18;
        return { call: U > 0 };
      }
      case 'clean': return { do: true };
      /* 〔批次 37 · U1〕嗅探策略（4.4.8，猎手专属）：此前恒缓发。现在按 θ 档概率发动——
         目标＝威胁降序的前两名（嗅探回答「是否呈现保护状态」，对高威胁目标最有价值：
         ① 今夜可能开枪的对象——确认无保护再开枪，省子弹（结果经 sniffLog 反哺 'shoot'）；
         ② 全场威胁最高者——推断保镖/工匠「在看守谁」。
         名额策略：第一名额恒给最高威胁；第二名额只在次高威胁也过「开枪效用线」时才用满
         （省着用——全局仅 2 夜）。不发动返回 {}（不耗次数，req 层已保证 sniffLeft>0）。 */
      case 'sniff': {
        const rate = TR.traitValue('theta', 'sniffRate', p.theta);
        if (!(rate > 0) || !rng.chance(rate)) return {};
        const cands = al.slice().sort((a, b) => dangerOf(g, p, b.id) - dangerOf(g, p, a.id));
        if (!cands.length) return {};
        const targets = [cands[0].id];
        const shootTh = p.theta + 35 - (alive(g).length <= 6 ? 30 : 0);
        if (cands[1] && 1.4 * dangerOf(g, p, cands[1].id) - 1.4 * shootTh > 0) targets.push(cands[1].id);
        return { targets };
      }
      /* 〔批次 37 · U1〕窃听报告（4.12.5⑦）：此前恒提交第 1 组。多组时按
         「成员威胁分 + 内容量」择优（报告关于高危者的私聊，对人类阵营价值最大），
         gauss 抖动破平；单组恒提交（现状）。text 恒空＝原样提交——改写/虚构属语言层
         策略，随拟人化批次（边界：本批只做择组）。不提交无收益（读取不跨夜累积）。 */
      case 'wiretapReport': {
        const gs = (p.wiretap && p.wiretap.groups) || [];
        if (!gs.length) return { opt: 'none' };
        if (gs.length === 1) return { opt: 'g0', text: '' };
        let best = 0, bestS = -Infinity;
        gs.forEach((gp, i) => {
          const s = dangerOf(g, p, gp.a) + dangerOf(g, p, gp.b) + gp.lines.length * 2 + gauss(g) * 4;
          if (s > bestS) { bestS = s; best = i; }
        });
        return { opt: 'g' + best, text: '' };
      }
      /* 〔批次 37 · U1〕乔装（7.3）：此前恒不发动。现在**压力驱动为主**——近 3 夜被公开
         指控才按 θ 档概率发动；无压力时仅激进档以低概率主动洗身份（实测被指控窗口命中率
         仅 ~4.5% 请求，纯压力门在整局尺度几乎不可见——拟真与可观测的折中）。
         伪装对象从人类职业里加权抽签（伪装成异形/外星人 = 自曝，剔除；crew 最重，关键位
         低权）。额度/每夜 1 次/池外不生效由引擎 run 段收口。边界：只动机制层（p.disguise）
         ——白天口头宣称仍走既有 claim 逻辑，不与之强行对齐。注意：本分支在经典局每夜被
         询问，发动会改变船员查验答案 → 行为指纹（按硬纪律 4 重建基线，见交接 §五）。 */
      case 'disguise': {
        if (p.disguiseLeft <= 0) return {};
        const accused = g.players.some(o => o.id !== p.id && !o.out &&
          (o.accuseHistory || []).some(a => a.id === p.id && a.night >= g.night - 3));
        const rate = TR.traitValue('theta', 'disguiseRate', p.theta);
        const pro = TR.traitValue('theta', 'disguiseProactive', p.theta);
        const go = accused ? (rate > 0 && rng.chance(rate)) : (pro > 0 && rng.chance(pro));
        if (!go) return {};
        const pool = ACT.verifyPool(g).filter(r => D.ROLES[r] && D.ROLES[r].faction === 'human');
        if (!pool.length) return {};
        const weighted = [];
        for (const r of pool) {
          const w = VA.disguiseW[r] != null ? VA.disguiseW[r] : VA.disguiseWDefault;
          for (let k = 0; k < w; k++) weighted.push(r);
        }
        return { opt: weighted[rng.int(weighted.length)] };
      }
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
    urgency, exposedEngineer, knownRepairers, EPS, VA, confOf, argmax, argmaxProtect, speak, evilIntent, vote, inviteUtility, decide, canKill, clearedK, threatTop, dirOcc, exposeRiskInc, rankLow, reasoningChain,
  };
})(typeof window !== 'undefined' ? window : globalThis);
