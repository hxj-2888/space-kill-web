/* 推断等级分值表（v21 规格落地）。
   一、档位分值：A35 B20 C10 D5，+号加二、-号减二；
       F（默认事实/零值）= 0（v21 裁定 3.2：零值、负信号——默认事实不产生增量，
       仅作并罚单元的语义标记与可追溯占位，不参与 E 累加；给 15 会与 D 档倒挂）。
   二、推断与影子推断分级：影子推理（M4）产出的证据 origin='shadow'，权重 ×SHADOW_FACTOR（占位，待标定）。
   三、怀疑度→危险度转换：CONV 已删除（v21 改动 #15 / 裁定 §4.1.4）——
       Dg 重定义为「放任 j 对我方造成多大损害」的独立模型，不再是 S 的 0.6/1.0 换算。
   四、性格危险度基线：激进 30 / 正常 50 / 保守 70（危险度中值，保留）。
      ★ 现状（2026-09-10 普查）：本常量是「性格危险度基线」的【唯一真源】，但当前 `js/` 内
         **零读取点** —— 性格真正生效的旋钮是 decide.js 的 actLine(10/20/30) ·
        abstain(−15/−5/+3) · param(0/25/55) · GRUDGE_W · SAB.thetaShift(12/0/−10)
        与 registry.THETA_BIAS。改它**不改变行为**（行为指纹不变）。
      ★ 标定与回退记录（同日）：曾拍板 30/50/70 → 40/55/70，并把危险度同轴的分档值按
        k = {25:4/3, 50:1.1, 75:1} 等比放大（actLine/voteParam/abstain/swapOff/vSelf/thetaShift），
        实测人类胜率 27.0% → 25.4%（异形 60.4% → 61.6%）⇒ **用户裁定整体回退**，
        现已恢复原值。若将来要再动，请连同 500 局读数一起决策（详见 docs/v31执行台账.md）。
   五、R 规则 → 档位映射（RULE 表为初步标定，每条注明总表依据，待数值方案复核）。 */
(function (global) {
  const SCORE = {
    'A': 35, 'A+': 37, 'A-': 33,
    'B': 20, 'B+': 22, 'B-': 18,
    'C': 10, 'C+': 12, 'C-': 8,
    'D': 5,  'D+': 7,  'D-': 3,
    /* v28（B3 裁定）：比 D− 更弱的【专用档】——「方向明确但贝叶斯极弱」的信号，
       用于排除类信息（排除人类专属职业 ⇒ 目标轻微更不像人类）。
       标定依据：E 三通道先验为 human 7.14 / alien 2.14 / king 0.71（人类观察者），
       D−(3) 会让 p_alien 抬升 +12~18pp（远超交接文档实测的 +4.7pt）；
       本档取 1，再经 D 档可信度缩放 (0.4+0.6C)=0.7 → 实际 +5.1pp，与文档实测对齐。
       语义上它是「D 族的第三级」，不是新家族（F 仍是零值语义标记）。 */
    'D--': 1,
    /* v31 批 1（B2′，定案 14）：P 档的【显式强度映射】。
       P 的语义是「私有源标记」（总表 41 条：只有特定身份的观察者能看到），
       此前 SCORE['P'] 不存在 → 这 41 条全部零落点。现按 C 档取强度（10），
       使「私有源通道」在接线时有一个可追溯的幅度来源。
       注意：P 档通道当前全部 dormant（无 GATE_IMPL），因此本行不改变任何行为；
       同时 TIER_BY_VAL 需排除 'P'（它是语义标记，不参与「按数值反查档位」）。 */
    'P': 10,
    'F': 0,
  };
  const SHADOW_FACTOR = 0.5;
  /* 性格危险度基线（唯一真源，2026-09-10 已回退为原值）：激进 30 / 正常 50 / 保守 70。
     ★ 尚无消费点：真正读 θ 的行动阈值在 decide.js（actLine/abstain/param），
       本表登记的是「基线的官方取值」，将来若接线，从这里取，不要在各调用点另写字面量（红线 1）。 */
  const BASE_DANGER = { 25: 30, 50: 50, 75: 70 };

  /* ============ 怀疑度 / 危险度的全部调用值（v28 / B2 裁定：统一到本表）============
     裁定原文：「把所有怀疑度和危险度的调用值统一到 score」。
     此前这些数值散落在 belief.js / perceive.js / decide.js 的调用点上（先验 28.6、
     置位 95/85、普适层饱和 25/60、共识基准与钳制、DG_W、能力项系数、R38 自证偏置…），
     改一处要全仓搜常量。现在**唯一真源 = 本模块**，调用点只引用名字。
     注意区分三层语义：SCORE = 证据【幅度】（档位）；本表 = 模型的【结构性常量】。 */

  /* 先验（改动 #1：baseRate 数值回收）。priorOf 按观察者阵营读 PRIOR；
     PRIOR_E 是 E 三通道的初始分布（按观察者对每个目标的初始证据量）。 */
  const PRIOR = { human: 28.6, xeno: 21.4, alienVsOther: 50 };
  const PRIOR_E = {
    humanViewer:  { human: 100 / 14, alien: 30 / 14, king: 10 / 14 },
    xenoViewer:   { human: 110 / 14, alien: 30 / 14, king: 0 },
    alienMate:    { human: 0, alien: 10, king: 0 },          // 异形观察者的队友
    alienVsOther: { human: 5, alien: 5, king: 0 },           // 异形观察者的非队友
  };

  /* 危险度 Dg 构成权重（§4.1.4；uni = 普适层偏移项，v20 双层估值） */
  const DG_W = { cap: 0.3, host: 0.6, act: 0.1, uni: 0.15 };
  /* 能力项系数（§4.1.4：只读公开可推信息） */
  const CAP = {
    base: 0.15,
    high: 0.8,        // 神探 / 验票官 / 警长 / 武装
    mid: 0.6,         // 医生系（bio / rescue / tempdoc）
    low: 0.5,         // 工程师 / 助理
    repairExposed: 0.5,
    highRoles: ['detective', 'inspector', 'sheriff', 'armed'],
    midRoles: ['bio', 'rescue', 'tempdoc'],
    lowRoles: ['engineer', 'assistant'],
  };
  /* 普适层饱和化（v26）：Σ → ±cap，曲线 s/(|s|+k) */
  const UNIVERSAL = { cap: 25, k: 60 };
  /* 怀疑度取值域 */
  const SUSP_RANGE = { lo: 0, hi: 100 };
  /* 共识快照（DEV 展示口径，AI 决策禁读）：基准 + 增量钳制 */
  const CONSENSUS = { base: 28.6, incLo: -60, incHi: 100 };

  /* 证据幅度衰减（§4.3）与硬源置位（改动 #9：超档位 → 下限置位，不衰减、不可被软证据反向） */
  const CLAIM_DECAY = 0.85;
  const GRUDGE_DECAY = 0.90;
  const FLOOR = { R30fakeRole: 95, R7fakeMark: 85 };

  /* 破坏决策（v28b / B1 裁定）的四项系数 —— 标定对象，唯一真源。
     口径：只承载「AI 能看到什么局势」，不承载「希望破坏发生多少次」；
     因此本表没有「目标发生率」类的参数，标定方式与 B6/B7 的现状见 docs/交接文档_v31.md §4.2。 */
  const SAB = {
    satK: 6,            // 倒计时饱和曲线的 SAB_K：pressure = raw/(raw+K)，raw = 24/cd − 1
    satJitter: 0.3,     // 个体阈值 p.sabTau 对压力的偏置强度：(0.5 − sabTau) × jitter
    gainW: 0.25,        // 未触发档位价值 gain 的缩放（gain = 30/40/50 × 未触发档位数）
    resistPer: 8,       // 每名「AI 已知的维修者」抵扣的破坏效用
    matesW: 4,          // 本夜已预提交破坏的队友，每个 +4（协同）
    riskThetaDiv: 50,   // 暴露风险的 θ 归一化分母
    thetaShift: { 25: 12, 50: 0, 75: -10 },   // 性格项：激进更偏向攻击
    noise: 6,           // 同轴比较的噪声幅度（gauss × noise）
    quotaTail: 0.08,    // 队内软节流：超出配额后仍继续的概率
    /* 队内节流配额（v28b 修正）：旧口径按 countdown 取 1/2/3，而节流信号本身曾是死代码；
       改用「存活异形数 − slack」——节流只在【几乎全队都在破坏】时生效，
       以免与协同奖励项（mates × 4）互相抵消（A/B 实测该互斥会使方向反转）。 */
    quotaSlack: 1,
  };

  /* ============ v31 批 2（A3）：承诺（E7）词表 —— 唯一真源 ============
     此前 strong / mid / weak 三档散在三处：判据（channels.run.strongPromises 要 'strong'）、
     生产者（steps.js 产 'mid'、N336 安全宣称池产 'weak'）、结算（perceive 自带 TIER_C/S/NAME 三张表）
     —— 结果「全仓没有任何一处产出 strong」，A01/A02 永久 0 命中。
     这里把词表、兑现奖励、违约惩罚、档位名、结算方式全部收口：
       cred  = 兑现时发给「承诺者可信度 C」的增量（§5.2 弱 +0.05 / 中 +0.15 / 强 +0.30）
       miss  = 未兑现时对观察者记的 S 类证据（弱 +8 / 中 +20 / 强 +35）
       name  = 该档对应的证据档位（写进 addEvent 的 tier 字段，供 D 档可信度缩放与仲裁排序）
       settle= 结算方式：vote（按承诺者本人投票，v26 判定）· announce（按是否发布公告，
               批 2 新增：神探预告类）· none（公开不可验证，不结算） */
  const PROMISE = {
    tiers: ['weak', 'mid', 'strong'],
    STRONG: 'strong', MID: 'mid', WEAK: 'weak',
    cred: { weak: 0.05, mid: 0.15, strong: 0.30 },
    miss: { weak: 8, mid: 20, strong: 35 },
    name: { strong: 'A-', mid: 'B', weak: 'C' },
    settle: { vote: 'vote', announce: 'announce', protect: 'none' },
  };

  /* ============ v31 批 3.5（人类侧保护专项 N414~N417）：保护侧效用权重 ============
     依据《太空杀·人类侧保护专项（增补第二十二章）》第五章 + 噪声章：
       20.1 效用函数必须【连续算出来】，不是硬阈值切的 → 保护优先级只能是权重，不能是 if 分支；
       20.3 上界 = 玩家能否为该行为编出一句自洽动机（「他是工程师，暴露过，保他值」成立；
            「我每夜都保同一个人」不成立——硬限制已在规则层置灰）；
       20.4 下界 = 次要保护选项选择率 ≥ 5%（N417 硬约束）。
     这些是【结构性常量】（与 SAB / DG_W 同族），不是证据档位——保护行为改变的是行动效用，
     不是证据，因此 N414~N417 不进 channels.data（当通道等于给保护目标选择加一个硬阈值）。
     权重写成常数是为了可标定、可追溯；AI 仍可因自保／误判／保护队友而不照做。 */
  const PROTECT = {
    floor: 0.05,                        // N417：次要保护选项选择率的硬下界（与 EPS.floor 同源口径）
    w: { guard: 45, patrol: 40, bio: 30 },   // N414 保镖 / N415 警长巡逻 / N416 医生抗体：每档优先级的加成
    self: 25,                           // 保护自己（保镖可自保、警长巡逻含自身）的额外权重
  };

  /* R38 自证的幅度成形（空口宣称族）：
     d = −round((SCORE[tier] − bias) × half)
     v31 裁定（用户拍板「调档位」）：**删除 crewBias 特例**——原先 crew 的强度被调节两次
     （一次是档位 D+，一次是 bias −10），两套真源互相掩盖。现在只有档位一个旋钮：
     自称船员仍是最弱档 D+，幅度 = −round((7−5)×0.5) = −1，再经 D 档可信度缩放 ≈ −0.7。
     语义正确：空口「我是普通船员」几乎不产生减疑（最廉价、最不可验证的宣称）。 */
  const SELF_CLAIM = { bias: 5, half: 0.5 };

  /* R 规则 → 档位映射（初步标定） */
  const RULE = {
    'R17':        'B+',   // 错误指控被证伪：指控=半闭环，22×阶段系数
    'R17b':       'C',    // 指控验证正确减免：事后指名公开兑现（C）
    'askVerify':  'C-',   // 质询者验证闭环 −8
    'R12':        'A-',   // 对跳碰撞：证伪型 A⁻ 不立信只击穿
    'R22human':   'A',    // 维修暴露：官方确证自家人（全额 A，负向）
    'R22enemy':   'A-',   // 暴露方位：A−
    'R23':        'A-',   // 破坏者暴露
    'R27':        'B-',   // 早期投票活跃（验票官）
    'R28':        'B-',   // 抱团指纹
    'R29human':   'C+',   // 投票追责：投对人类（验票官）
    'R29enemy':   'C',    // 投对敌方可信减免
    /* v27（A6）：R38 自证族全部登记为可追溯档位（此前 onClaim 自带一份硬编码字典，
       违反「幅度唯一来源 = 档位表」；且 `doc` 键缺失 → 宣称医生系完全不产证据）。
       R38crew 由 B(20) 下调为 D+(7)：「我是普通船员」是成本最低、最无法验证的宣称，
       旧值让它成为零代价洗白（对人类观察者敌对度 −17.2pp、危险度 −10.3）。 */
    'R38crew':    'D+',   // 船员自证（空口宣称：最弱档）
    'R38divine':  'A-',   // 神探/验票官自证（高价值宣称）
    'R38medic':   'B+',   // 医生系自证（bio / rescue / tempdoc，含旧别名 doc→bio）
    'R38support': 'B+',   // 警长 / 工程师 / 武装 / 助理（支持系）
    'R38guard':   'B',    // 保镖
    /* v27（A5）：K1 沉默指纹档位。旧实现硬编码 SCORE['D'](5)，且 D 档还要再乘 (0.4+0.6C)
       → 实际压力近乎为零；提档到 C(10) 并收紧触发面（每 3 夜 + 零公开行为 + 排除被沉默者）后，
       它才是「让沉默付代价」的对口机制（D1 归因链的正面对攻项）。 */
    'kingSilent': 'C',    // K1 隐身第三方指纹（king 通道）
    'R40':        'B-',   // 言行不一（指控 A 却投 B）
    'R64lie':     'B+',   // 宣称投 X 而 X 零票（带节奏造假）
    'R64trust':   'B-',   // 投对敌方可信减免
    'accuse':     'C+',   // 凭空指控当场
    'ansTruth':   'D-',   // 应答如实
    'ansVague':   'C-',   // 应答含糊
    'ansRefuse':  'C+',   // 应答拒绝
    'ansLie':     'B-',   // 应答说谎
    'askPress':   'D',    // 公开质询加压
    'quote':      'D+',   // 转述归因
    'privClaim':  'B-',   // 私聊声称
    'privShare':  'C+',   // 私聊共享验证
    'cross':      'A-',   // 对证不符（声称阵营与私有已知冲突）
    'crossRole':  'B+',   // 同阵营职业不符
    'R39':        'D',    // 质询过频
    /* v26 新增：宣称类的【目标侧】入账（此前 lock/exclusion/deny 只产生说话者自证，
       观察者对「X 是异形 / X 是好人」零反应——总表 A/B 档查验汇报通道无落点） */
    'lockEnemy':  'B-',   // 查验汇报「X 是异形」（查杀）：可伪造，与 L1 引用指控同档
    'lockHuman':  'C-',   // 查验汇报「X 是人类」（金水）：弱证据（编造零成本，靠兑现升档）
    'denyLie':    'A-',   // 证伪型宣称被观察者私有知识当场证伪（A12~A15 落地）
    /* v26：总表 N219 的裁定——验票官转述「死去的 3 号当时投了 4 号」对全场是 B−，**不是 A**：
       它有 ⑦ 身份背书，但票型永不公开 ⇒ 无公开兑现源，不满足 A 档三要件（极易误判为 A）。
       等票型转述类 claim 落地时直接取用本条，不要临时给 A。 */
    'voteQuote':  'B-',   // 票型转述（N219 / 2.6.1③）
    /* ---- v28（B2 裁定）「把所有怀疑度/危险度的调用值统一到 score」：以下规则的档位
       原先作为字面档位字符串散落在调用点（T.SCORE['C+'] / 'B-' / 'D-' …），现全部入表。
       数值与原字面量逐一对应，属行为中性重构。 ---- */
    'checkLie':    'A-',   // 异形谎称查验（无查验能力 → 来源致命，§5.1 裁定）
    'settleHit':   'B-',   // N01 破坏宣称兑现（停转夜来源唯一＝外星人）
    'settleMiss':  'D-',   // F02 破坏宣称落空（可能被维修抵消，非必然撒谎）
    'grudge':      'B-',   // R31 报复心：被冤枉（好人）愤怒硬辩全额
    'grudgeSoft':  'C+',   // R31：被咬对（异形）警觉低强度报复 ×0.5
    'rescueBack':  'C+',   // N372 异形营救者反咬指控者（只写 E 不写 Dg）
    'privSame':    'C',    // 私聊声称同阵营（按声明职业推阵营，乘以可信度 C）
    'expClaim':    'D-',   // 私有体验宣称（编造零成本 → 最弱档，价值只在跨夜一致）
    'mateHeat':    'C+',   // 队友被指控的热度累计（投票协调用，非证据）
    /* v28（B3 裁定，方向 (a) 贝叶斯）：exclusion（排除职业）的目标侧信号——
       「目标不是某个人类专属职业」在贝叶斯上轻微指向【非人类】。档位取 D--（专用最弱档），
       量级标定见 SCORE['D--'] 处的说明。它与 R38 自证无关，是【目标侧】证据。 */
    'exclusion':   'D--',
  };
  /* 置位特例（超档位 → 硬源置位，v21 改动 #9 / §4.2）：R30 假冒揭示 → 置位 95、
     R7 假标记滞留 → 置位 85——「确证型置位」，语义为硬源下限：不衰减、不可被软证据反向，
     在 ai.js 以 hardFloor 实现（不再是 addEvent 增量，旧的增量写法会被衰减侵蚀）。 */

  /* ============ v31 批 1（B4，定案 9）：视角依赖档位 ============
     总表里有若干条通道的档位随【接收者身份】而变（例：N216「宣称我投了 X 而票源显示投了别人」
     对全场是 D（不可验证），对验票官是 A⁻（可验证））。此前 tier 只有单值，这类注解被丢弃。
     tierFor() 是唯一解析器：tier 声明可以是字符串（全员同档），也可以是
       { def: 'D', byRole: { inspector: 'A-' }, byFaction: { xeno: 'D+' } }
     解析顺序：byRole → byFaction → def。**不动任何已有的 tier 值**。 */
  function tierFor(spec, viewer) {
    if (spec == null) return null;
    if (typeof spec === 'string') return spec;
    if (viewer) {
      if (spec.byRole && viewer.role != null && spec.byRole[viewer.role] != null) return spec.byRole[viewer.role];
      if (spec.byFaction && viewer.faction != null && spec.byFaction[viewer.faction] != null) return spec.byFaction[viewer.faction];
    }
    return spec.def != null ? spec.def : null;
  }
  /** 解析后的档位对应的幅度（SCORE 查表；未登记返回 0） */
  function magFor(spec, viewer) {
    const t = tierFor(spec, viewer);
    return t != null && SCORE[t] != null ? SCORE[t] : 0;
  }

  /* ============ v32 批 5′（角色注意力）：Tiers.ATTEND 连续权重表（唯一真源）============
     方案 §3.1/§六批 5′：角色专家（视角维度）决定「这件事要不要进我的账」，
     产出【连续】attention(evt)，权重进 Tiers.ATTEND。红线 1：注意力是连续权重不是硬阈值
     ——乘性系数，不是 if 分支；未归族事件 = def（1），行为不变。
     事件族（evt）与初值的规则依据（温和偏移，标定留后续批次；判别法 5.4：先定义后系数）：
       infra  破坏/维修/停转周边 —— 工程师系生计攸关（4.3 / R12 阈值独立）
       lethal 死亡·追责·报复链 —— 保镖/警长/武装的保护与报复对象管理（4.8/4.4）
       infect 感染/治疗周边 —— 医生系主业（4.5 / P15）
       verify 对证/宣称对账 —— 神探·验票官·船员的核查主业（4.7 / 2.3）
       ballot 票型/承诺对账 —— 验票官主业（2.3 例外一）
     通道路径（chan:*）不在本表：7′ 做二维绑定时一次到位，避免返工（§6.1 顺序硬约束）。 */
  const ATTEND = {
    def: 1,
    focus: {
      infra:  { engineer: 1.3, assistant: 1.3, crew: 1.15 },
      lethal: { bodyguard: 1.25, sheriff: 1.15, armed: 1.15 },
      infect: { bio: 1.3, rescue: 1.1, tempdoc: 1.1 },
      verify: { detective: 1.25, inspector: 1.2, crew: 1.1 },
      ballot: { inspector: 1.3 },
    },
  };
  /** 角色注意力解析器（唯一入口）：attend(roleKey, evt) → 连续权重，缺省 def */
  function attend(roleKey, evt) {
    if (!evt) return ATTEND.def;
    const f = ATTEND.focus[evt];
    if (!f) return ATTEND.def;
    const w = roleKey != null ? f[roleKey] : undefined;
    return w != null ? w : ATTEND.def;
  }

  global.Tiers = {
    SCORE, SHADOW_FACTOR, BASE_DANGER, RULE,
    /* v28（B2）：怀疑度 / 危险度的结构性常量（唯一真源，调用点只引用名字） */
    PRIOR, PRIOR_E, DG_W, CAP, UNIVERSAL, SUSP_RANGE, CONSENSUS,
    CLAIM_DECAY, GRUDGE_DECAY, FLOOR, SELF_CLAIM, SAB, PROMISE,
    /* v31 批 3.5（人类侧保护专项）：N414~N417 的保护优先级权重与下界 */
    PROTECT,
    /* v32 批 5′：角色注意力连续权重表 + 解析器 */
    ATTEND, attend,
    /* v31 批 1（B4）：视角依赖档位解析器（唯一入口） */
    tierFor, magFor,
  };
})(typeof window !== 'undefined' ? window : globalThis);
