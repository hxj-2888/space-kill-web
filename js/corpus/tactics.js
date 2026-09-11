/* 浑水摸鱼系统 · 异形与外星人战术库（v21，N336~N400）数据化。
   定位（原文件附录）：本库是「语言库的语料规格」与「AI 行为选项池」，
   不作为推断通道进入估值层；排错条目（N397~N400）并入 Z 档负样本库，
   由 infer/filter.js 在**生成前**统一拦截——先生成再删除是浪费，且语气犹疑。
   核心公式：实际生存力 ＝ 评估能力 × 安全选项数量。
   平衡红线：安全宣称只能维持基线，不能建立强信任（N348）。 */
(function (global) {
  /* ---------- 一、安全宣称库 N336~N348：任何身份可安全使用（异形的唯一话术空间） ---------- */
  const SAFE = [
    { id: 'N336', kind: 'vote-promise', risk: 0, note: '票型承诺：不绑定能力，异形少数能兑现的承诺',
      say: ['我的票会投给最可疑的那个。', '这一票我跟着信息走。'] },
    { id: 'N337', kind: 'abstain', risk: 0, note: '弃票声明：不泄露能力',
      say: ['信息不够我就弃票。', '这轮我压手，正常权利。'] },
    { id: 'N338', kind: 'vote-reason', risk: 0, note: '投票理由：可建立立场一致性',
      say: ['我投他是基于他昨夜的发言，不是跟风。', '我的票只看行为，不看立场。'] },
    { id: 'N339', kind: 'attach', risk: 0, note: '附和他人：低风险低收益，维持存在感',
      say: ['这点我同意上面那位。', '有道理，我先记下这个说法。'] },
    { id: 'N340', kind: 'argue', risk: 1, note: '对线：暴露立场但不暴露职业',
      say: ['你这套逻辑我不认，别把节奏带偏。', '我不这么看，咱们走着瞧。'] },
    { id: 'N341', kind: 'ask-safe', risk: 0, note: '质疑与提问：不泄露自身信息，保守 AI 的天然选择',
      say: ['谁昨晚看到什么了，出来说说。', '有谁能对一下昨晚的时间线？'] },
    { id: 'N342', kind: 'hedge', risk: 0, note: '概率性表述比断言安全：同时降低暴露风险与承诺强度',
      say: ['我猜昨晚不太平，说不上来哪里怪。', '我感觉有问题，但说不准是谁。'] },
    { id: 'N343', kind: 'quote-public', risk: 0, note: '引用公开信息：完全不增加私有暴露',
      say: ['昨夜的破坏量大家都看到了。', '死亡名单摆在那，自己品。', '净破坏量又涨了，都在一条船上。'] },
    { id: 'N344', kind: 'summarize', risk: 0, note: '总结他人观点：与附和配套',
      say: ['目前场上的说法就两种，都还没对上。', '先把大家的点归拢一下。'] },
    { id: 'N345', kind: 'concede', risk: 0, note: '承认错误：安全且大幅提升可信度（C−），异形亦可用',
      say: ['这点我之前确实想错了，认。', '我昨天判断有偏差，修正一下。'] },
    { id: 'N346', kind: 'hedge', risk: 0, note: '表达不确定性：安全且提升可信度',
      say: ['我现在的判断没什么把握。', '说实话我也没看清。'] },
    { id: 'N347', kind: 'emote', risk: 0, note: '情绪表达：不含信息量故无暴露风险',
      say: ['这局势太难受了。', '每晚都睡不好，谁懂。'] },
  ];
  const SAFE_LIMIT = { id: 'N348', note: '★★★ 安全宣称的局限：只能维持基线，不能建立强信任——本库的地基' };

  /* ---------- 二、异形伪装战术 N349~N372：按风险四档（选项池，供策略层引用） ----------
     v31 批 3 改造：原实现是【纯字符串注释】——`Tactics.ALIEN` 全仓无引用点，
     37 条（N349~N386）是死数据，异形工具箱一件没接（台账 D1/D2 的直接根因）。
     现在改为结构化选项表：
       risk  : zero / low / mid / high（沿用原分档）
       when  : (g, p, ctx) => bool   —— 该战术在当前局势是否可用（全部只读公开信息或己方自有信息）
       say   : [文本池]               —— 出口发言（语言层语料规格，不产 Claim）
       act   : {kind, payload} | null —— 需要落成 Claim 的行为（经 IR.mk 出口，再受 filterClaims 过滤）
       note  : 原条目注释（保留可追溯性）
     认知类条目（N361/N366/N369/N370/N371/N385…）没有出口动作，它们的作用是【门禁与调度】，
     act = null 并保留 note —— 这不是「没接」，而是它们的语义本来就是「什么时候别做什么」。 ---------- */
  const A = (id, label, risk, extra) => Object.assign({ id, label, risk, act: null }, extra);
  const ALIEN_OPTS = [
    /* 零风险：只维持存在感，任何身份可用（与 SAFE 池同族） */
    A('N349', '主动附和', 'zero', { act: null, say: ['这点我同意。', '上面说的有道理。'] }),
    A('N350', '引用公开信息并复述', 'zero', { act: null, say: ['净破坏量又涨了，大家都看到了。', '死亡名单摆在那，自己品。'] }),
    A('N351', '情绪表态', 'zero', { act: null, say: ['这局势太难受了。', '每晚都睡不好。'] }),
    /* 低风险：怀疑但不硬咬 */
    A('N352', '假意怀疑队友（轮换）', 'low', {
      when: (g, p) => matesOf(g, p).length > 1 && g.night >= 3,
      act: null, say: ['我对他有点感觉，但先不下结论。', '那边那位我不太放心，先记下。'] }),
    A('N353', '数字模糊化', 'low', { act: null, say: ['感觉昨晚不太平，说不上哪里怪。', '昨晚动静不小，但我说不准。'] }),
    A('N355', '承认错误与自我修正', 'low', { act: null, say: ['我昨天判断有偏差，修正一下。', '这点我之前想错了，认。'] }),
    A('N356', '对队友轻微怀疑而非强指控', 'low', {
      when: (g, p) => matesOf(g, p).length > 0 && g.night >= 3,
      act: null, say: ['我对他只是有点疑问，不到指控的程度。'] }),
    /* 中风险：真正的高价值变现 */
    A('N357', '冒领船员', 'mid', {
      /* 门禁 = 神探公告沉默期（N400 在 filterClaims 里还有一道兜底：公告密集期直接拦掉）*/
      when: (g, p) => !p.claimedRole && detectiveAnnounceRecent(g) === 0,
      act: { kind: 'claimRole', payload: { role: 'crew' } },
      say: null, note: '限神探公告沉默期（定案 20：公告密集期冒领会被清零）' }),
    A('N358', '卖队友（延迟结算）', 'mid', {
      /* 唯一的高价值变现：把已被怀疑的队友抛出去换可信度。延迟结算 = 收益在后续夜兑现。
         ★ 门禁必须是【公开可见的队友处境】，不能用己方怀疑度——异形对自己队友的怀疑恒为 0
         （认知层知道是队友，hostile 只对其他阵营计数），用 susp 当门禁在本局永远不可达
         （v31 批 3 实测：21136 次异形发言 0 命中）。公开信号 = 被指控次数 / 已公开暴露 / 已被揭示。 */
      when: (g, p) => {
        const mates = matesOf(g, p);
        if (!mates.length || g.night < 4) return false;
        return mates.some(m => (m.accuseHistory || []).length >= 2 || m.repairExposed || m.revealed);
      },
      act: null, say: ['我知道这话难听，但我觉得他不对劲。', '我不想保他了，他的位置很奇怪。'] }),
    A('N359', '牺牲队友（被动抛出）', 'mid', {
      when: (g, p) => {
        const mates = matesOf(g, p);
        if (!mates.length) return false;
        /* 同上：判据是队友【在公开场上】已被架到火上（被指控 ≥ 2 次），而非己方怀疑度 */
        return mates.some(m => (m.accuseHistory || []).length >= 2);
      },
      act: null, say: ['他这轮躲不掉了，我跟着投。'] }),
    A('N360', '欺诈感染（消耗医生额度）', 'mid', {
      when: (g, p) => g.night >= 2 && doctorsAlive(g) >= 1,
      /* 注意：私有体验类宣称的 Claim.kind 就是体验类型本身（pipeline 按 kind 入账），
         payload 无需再带 kind —— 旧写法 kind:'exp' 会落进 pipeline 的 default 分支（静默丢弃）。 */
      act: { kind: 'infection', payload: {} },
      say: null, note: '谎称带感染标记 → 逼医生花额度治疗（医生额度=人类资源）' }),
    A('N362', '利用公告间歇', 'mid', {
      when: g => detectiveAnnounceRecent(g) === 0, act: null,
      say: ['趁着没有新公告，先把昨天的线对一遍。'] }),
    /* 高风险：残局/已暴露才用 */
    A('N363', '制造对跳（仅残局）', 'high', {
      when: (g, p) => !p.claimedRole && aliveN(g) <= 6,
      act: null, say: ['他那个身份我也有份，他在冒领。'], note: '赌真身不应战' }),
    A('N364', '伪装被冤枉者', 'high', {
      when: (g, p, ctx) => !!(ctx && ctx.accusedBy && ctx.accusedBy().length), act: null,
      say: ['你们冲我来的这套我见多了，我是被冤枉的那个。'] }),
    A('N365', '主动提供部分真相', 'high', {
      when: (g, p) => (p.alien && p.alien.destroyTotal10 >= 30) && p.repairExposed !== true,
      act: null, say: ['破坏的事我承认看到过一点，但不是我干的。'],
      note: '已积累破坏量时，先自曝"看到"以解释痕迹' }),
    A('N366', '轮换破坏规避暴露', 'high', { act: null, note: '调度条目：由破坏档位选择（decide.js 的 N367/N49 档位逻辑）承担' }),
    A('N367', '破坏量选小值换隐蔽', 'high', { act: null, note: '调度条目：decide.js 的 sabAmount 自选档已实现' }),
    A('N368', '结茧自保（队内留痕）', 'high', { act: null, note: '调度条目：PHASES 的 kill-cocoon-only 已实现' }),
    A('N369', '信息优势无法变现', 'high', { act: null, note: '认知条目：说出攻击反馈 = 承认出过刀，故不产出' }),
    A('N370', '沉默的战术价值', 'high', { act: null, note: '认知条目：沉默也在被 K1 指纹计价（v28 A5 提档后生效）' }),
    A('N371', '冒领窗口 = 两次公告之间', 'high', { act: null, note: '认知条目：与 N357 的门禁同源（detectiveAnnounceRecent）' }),
    A('N372', '三只分工：伪装/破坏/潜伏', 'high', {
      /* 分工不是硬性指派（B1 裁定：让 AI 自主选择），而是【报告队内现状 + 提示缺口】：
         伪装位 = 本轮没破坏且常发言者；破坏位 = 本局已积累破坏量者；潜伏位 = 两者皆无者。 */
      when: (g, p) => matesOf(g, p).length >= 2 && g.night >= 2,
      act: null, say: null, note: '协调条目：由 squadRoles() 输出，供 decide 的战术分支使用' }),
  ];

  /* ---------- 三、外星人隐蔽战术 N373~N386 ---------- */
  const XENO_OPTS = [
    A('N373', '第三方红利', 'zero', { act: null, say: ['你们先清内部的，我跟着走。'] }),
    A('N374', '蛰伏信息只能暗示不能明说', 'low', {
      act: null, say: ['我这边的感觉很奇怪，暂时说不清。'], note: '明说蛰伏获知的身份 = 承认蛰伏过（N399 已由 filterClaims 拦截）' }),
    A('N375', '沉默的三重战术', 'low', { act: null, note: '认知条目：沉默的代价由 K1 计价' }),
    A('N378', '夜晚免疫余额管理', 'mid', { act: null, note: '调度条目：免疫余额在 steps.js 执行' }),
    A('N382', '冒充人类（不受清零约束）', 'high', {
      /* 与异形 N357 同形但更安全：外星人冒领船员不受「神探公告清零」约束（定案 20 的对称条款） */
      when: (g, p) => !p.claimedRole,
      act: { kind: 'claimRole', payload: { role: 'crew' } },
      say: null, note: '★ 外星人在语言层的真实优势：冒领不受神探公告清零（channels.data N212 族）' }),
    A('N383', '决斗造王', 'high', { act: null, note: '调度条目：PHASES 的 kingmaker 已实现' }),
    A('N385', '第三方不能赢太多', 'high', { act: null, note: '认知条目：由 settleClaim / 胜负判定承担' }),
    A('N386', '蛰伏与沉默的取舍', 'high', { act: null, note: '调度条目：decide 的 xenoSilence 已实现' }),
  ];

  /* 原字符串清单保留为【未接线台账】（可追溯性）：真正有出口动作的条目已在上面结构化。
     其中 N354 / N376 / N377 / N379 / N380 / N381 / N384 属规则约束或调度条目，
     没有独立出口（分别由 filterClaims 的 N397/N399、steps 的觉醒公告、破坏档位、
     免疫链、双刀冷却、寂灭胜负承担）——清单保留，避免"看起来漏了"。 */
  const ALIEN_UNWIRED = {
    zero: [], low: [],
    mid: ['N361 清洗两难（洗则泄露非人类）'],
    high: ['N354 禁区：不能说「X 号是人类」', 'N376 觉醒公告的时机', 'N377 破坏选小值（停转夜是唯一足迹）',
           'N379 抗感染手段隐蔽性排序：抑制＞免疫＞自清除＞求医', 'N380 被真感染=身份泄露定时炸弹',
           'N381 双刀的代价', 'N384 寂灭只需清异形'],
  };
  /* 兼容旧调用点：ALIEN / XENO 仍是「分档清单」形态（字符串），只用于文档与审计 */
  const ALIEN = {
    zero: ALIEN_OPTS.filter(o => o.risk === 'zero').map(o => o.id + ' ' + o.label),
    low: ALIEN_OPTS.filter(o => o.risk === 'low').map(o => o.id + ' ' + o.label),
    mid: ALIEN_OPTS.filter(o => o.risk === 'mid').map(o => o.id + ' ' + o.label).concat(ALIEN_UNWIRED.mid),
    high: ALIEN_OPTS.filter(o => o.risk === 'high').map(o => o.id + ' ' + o.label).concat(ALIEN_UNWIRED.high),
  };
  const XENO = XENO_OPTS.map(o => o.id + ' ' + o.label);

  /* ---------- 工具：己方队友 / 存活数 / 医生数（只读己方自有信息与公开信息） ---------- */
  function matesOf(g, p) {
    if (p.faction !== 'alien') return [];
    return g.players.filter(x => x.faction === 'alien' && !x.out && x.id !== p.id && !x.isHuman);
  }
  function aliveN(g) { return g.players.filter(x => !x.out).length; }
  function doctorsAlive(g) {
    return g.players.filter(x => !x.out && (x.role === 'bio' || x.role === 'rescue' || x.role === 'tempdoc')).length;
  }
  /* 队内分工现状（N372）：伪装 / 破坏 / 潜伏 —— 只读异形自有信息（alien.dir 与破坏累计） */
  function squadRoles(g, p) {
    const team = [p].concat(matesOf(g, p));
    const out = { disguise: [], destroy: [], lurk: [] };
    for (const m of team) {
      const dmg = (m.alien && m.alien.destroyTotal10) || 0;
      if (dmg > 0 || (m.alien && m.alien.dir === 'destroy')) out.destroy.push(m.id);
      else if ((m.accuseHistory || []).length || m.claimedRole) out.disguise.push(m.id);
      else out.lurk.push(m.id);
    }
    return out;
  }

  /* ---------- 战术选择器（批 3 的唯一消费者入口） ----------
     输入：局势 + 己方视角上下文（ctx.susp / ctx.accusedBy / ctx.topSuspect 由 decide 注入，
     全部是「这个 AI 自己算得出来的量」，不读真相）。
     输出：{ opt, text, claim } | null ——
       text  = 出口发言（语言层语料）
       claim = 需要落成证据的动作（IR.mk 由调用方完成，以便带 meta）
     挑选规则：按 risk 分层随机（zero→high 权重 3/2/2/1），只在 when 通过的条目里选；
     一次最多产 1 条（避免一开口就是战术广播）。 */
  function pickTactic(g, p, rng, ctx) {
    const pool = p.faction === 'alien' ? ALIEN_OPTS : p.faction === 'xeno' ? XENO_OPTS : null;
    if (!pool) return null;
    const W = { zero: 3, low: 2, mid: 2, high: 1 };
    const cand = [];
    for (const o of pool) {
      let ok = true;
      if (o.when) { try { ok = !!o.when(g, p, ctx || {}); } catch (e) { ok = false; } }
      if (!ok) continue;
      /* 有出口动作的条目优先（行为 > 发言），但每个条目每次只出一份 */
      cand.push(o);
      for (let i = 1; i < (W[o.risk] || 1); i++) cand.push(o);
    }
    if (!cand.length) return null;
    const opt = rng.pick(cand);
    let text = null, claim = null;
    if (opt.act) claim = { kind: opt.act.kind, payload: opt.act.payload };
    if (opt.say && opt.say.length) text = rng.pick(opt.say);
    if (opt.id === 'N372') {
      const r = squadRoles(g, p);
      text = `我们三个分开走：${r.destroy.length ? '他去压机器' : '没人压机器'}，` +
             `${r.disguise.length ? '他在场上混' : '场上没人接话'}，剩下的继续趴着。`;
    }
    (p.tacticLog = p.tacticLog || []).push({ night: g.night, id: opt.id, risk: opt.risk });
    return { opt, text, claim };
  }

  /* ---------- 四、人类侧保护优先级 N414~N417（行为选项池，v31 批 3.5）----------
     依据《太空杀·人类侧保护专项（增补第二十二章）》第五章 + 噪声章：
       20.1 效用必须【连续算出来】，不是硬阈值切的；
       20.3 上界 = 能否为该行为编出一句自洽动机（「他是工程师，暴露过，保他值」成立，可保；
            「我每夜都保同一个人」不成立——硬限制已在规则层置灰：保镖不可连保）；
       20.4 下界 = 次要保护选项选择率 ≥ 5%（N417 硬约束，见 decide.js argmaxProtect）。
     ★ 归属（文档 5.4）：与浑水摸鱼同制 —— 改变的是【行动效用】，不是【证据】，
       因此**不进 channels.data**（塞进总表当通道 = 给保护目标选择加了一个硬阈值）。
     ★ 正确形态是效用权重：AI 仍可能因保护队友、自保、误判等理由不保护预告者（文档 5.1）。 */
  const PROTECT_OPTS = [
    { id: 'N414', role: 'bodyguard', label: '保镖保护优先级',
      note: '已预告／④ 暴露的关键职位 ＞ 神探公告指向 ＞ 高价值未确证（效用权重，非硬规则）' },
    { id: 'N415', role: 'sheriff', label: '警长巡逻优先级',
      note: '全局 1 次、限前 3 夜 ⇒ 投向「最可能被刀且最不可替换」者（效用权重）' },
    { id: 'N416', role: 'bio', label: '医生抗体优先级',
      note: '优先给预告者（抵 1 次感染）（效用权重）' },
    /* N417 不在本池：它是【下界硬约束】，由 Tiers.PROTECT.floor + decide.js 的 argmaxProtect 承载 */
  ];
  const PROTECT_FLOOR_ID = 'N417';

  /* 公开可推的「关键职位」名单：CAP 三族岗位 = 人类侧不可替换的岗位
     （神探/验票官/警长/武装 · 医生系 · 工程师系）。唯一真源在 tiers.js。 */
  function keyRolesOf() {
    const CAP = global.Tiers && global.Tiers.CAP;
    return CAP ? CAP.highRoles.concat(CAP.midRoles, CAP.lowRoles) : [];
  }
  /* 观察者 p 视角下「X 已被官方确证为人类」——读 p.known（硬源唯一路径的等价读法，不读真相）。 */
  function officiallyHuman(p, x) {
    if (x.revealed && x.revealed.faction === 'human') return true;
    const k = p.known && p.known.get(x.id);
    if (!k) return false;
    if (k.faction === 'human') return true;
    const rd = k.role && global.SKData && global.SKData.ROLES[k.role];
    return !!(rd && rd.faction === 'human');
  }
  /* 保护优先级（N414~N416 的共用权重输入）：3 / 2 / 1 / 0
       3 = 已预告（可验证强承诺的预告者 = 全场最可能被刀的人，A 档闭环；当前唯一 strong
           生产者是神探预告 A01/A02）或 ④ 暴露的关键职位（官方公示，必为人类工程师系，
           且已成为刀口）—— 对应文档「已预告／④ 暴露的关键职位」
       2 = 已被官方确证为人类的关键职位（⑥⑩ 揭示 / ③ 神探公告 / 查验锁定）—— 对应「神探公告指向」
       1 = 高价值未确证（公开宣称／揭示为关键岗位，尚无确证）
       0 = 其余（不排除保护，只是不加权） */
  function protectPriority(g, p, x, channel) {
    if (!x || x.out || x.id === p.id) return 0;
    const exposedKey = !!x.repairExposed && (x.role === 'engineer' || x.role === 'assistant');
    const forecaster = (x.promises || []).some(pr => pr.tier === 'strong');
    if (exposedKey || forecaster) return 3;
    const pubRole = x.claimedRole || (x.revealed && x.revealed.role) || null;
    const key = pubRole != null && keyRolesOf().indexOf(pubRole) >= 0;
    if (officiallyHuman(p, x)) return key ? 2 : 1;
    return key ? 1 : 0;
  }
  /* 保护优先级的效用加成（唯一消费者入口，供 decide.js 三处保护型目标选择调用）：
     channel ∈ {guard, patrol, bio}，权重取自 Tiers.PROTECT.w；自保另有固定权重
     （文档 5.1 明列「自保」是 AI 可以不合规地不保护预告者的理由之一）。 */
  function protectionBonus(g, p, x, channel) {
    const P0 = (global.Tiers && global.Tiers.PROTECT) || null;
    if (!P0) return 0;
    const pri = protectPriority(g, p, x, channel);
    let b = pri * ((P0.w && P0.w[channel]) || 0);
    if (x && x.id === p.id) b += P0.self || 0;
    return b;
  }

  /* ---------- 五、时机与阶段库 N387~N396（调度层：何时用哪套） ---------- */
  const PHASES = [
    { id: 'N387', when: g => g.night <= 3, alien: 'zero-only', xeno: 'lurk' },
    { id: 'N388', when: g => g.night >= 4 && g.night <= 5, alien: 'low', xeno: 'decide-awaken' },
    { id: 'N390', when: g => g.players.filter(p => !p.out).length <= 6 || g.night >= 6, alien: 'transfer-chaos', xeno: 'transfer-chaos' },
    { id: 'N393', when: g => g.tiers[9], alien: 'stop-destroy', xeno: 'wait' },
    { id: 'N394', when: g => g.players.filter(p => !p.out).length <= 4, alien: 'sacrifice', xeno: 'kingmaker' },
    { id: 'N395', when: g => g.extinction, alien: 'kill-cocoon-only', xeno: 'clear-aliens' },
    { id: 'N396', when: g => g.duel, alien: 'none', xeno: 'kingmaker' },
  ];

  /* ---------- 六、排错条目 N397~N400：Z 档负样本，生成前过滤 ---------- */
  const BANNED = [
    { id: 'N397/N354', rule: 'alien-faction-claim',
      test: (c, sp) => sp.faction === 'alien' &&
        ((c.kind === 'lock' && (c.payload.faction === 'human' || c.payload.good)) ||
         (c.kind === 'reveal' && c.payload.faction === 'human')),
      why: '异形宣称「X 号是人类」——只有异形能确定队友之外无人可确证，内容为真来源致命（N354）' },
    { id: 'N398', rule: 'exact-number-fingerprint',
      test: (c, sp) => sp.faction === 'alien' && c.kind === 'destroy' && c.targets.length >= 2,
      why: '异形精确报出多人行动数字=来源指纹（N239），模糊化为「感觉昨晚不太平」' },
    { id: 'N399', rule: 'xeno-lurk-expose',
      test: (c, sp) => sp.faction === 'xeno' && (c.kind === 'lock' && c.payload.faction) ,
      why: '外星人明说蛰伏获知的身份=承认蛰伏过（N374），只能暗示' },
    { id: 'N400', rule: 'claim-crew-window',
      test: (c, sp, ctx) => sp.faction === 'alien' && c.kind === 'claimRole' && c.payload.role === 'crew' &&
        ctx && ctx.detectiveAnnounceRecent >= 1,
      why: '神探公告密集期冒领会被清零（定案 20），改在沉默期（N357）' },
  ];

  /* 生成前过滤：对将要出口的 Claim 逐条检查，返回放行列表（拦截项记入 note 供审计） */
  function filterClaims(claims, speaker, ctx) {
    if (!claims || !claims.length) return claims;
    const out = [];
    for (const c of claims) {
      const hit = BANNED.find(b => { try { return b.test(c, speaker, ctx); } catch (e) { return false; } });
      if (hit) {
        (speaker.filteredClaims = speaker.filteredClaims || []).push({
          night: ctx && ctx.night, id: c.id || hit.id, why: hit.why,
        });
        continue;   // Z 档：根本不生成
      }
      out.push(c);
    }
    return out;
  }

  /* 神探公告密度（N400 的 ctx 输入）：最近 2 夜的神探公告数——从公告流统计，属于公开信息 */
  function detectiveAnnounceRecent(g) {
    let n = 0;
    for (const e of (g.log || []))
      if (e.batch === '③' && String(e.text || '').indexOf('神探公告') >= 0 &&
          g.night - e.night <= 2) n++;
    return n;
  }

  /* v23 批次 5：PHASES 调度器——按 when 匹配当前局势（倒序匹配：extinction / duel /
     9.0 停摆等特判条目优先于常规夜段），取 {alien, xeno} 策略标签喂给 ai.decide() 选项池。
     只差这一个消费者，48 条战术资产就从死数据变成可执行策略。 */
  function phaseOf(g) {
    for (let i = PHASES.length - 1; i >= 0; i--) {
      let hit = false;
      try { hit = !!PHASES[i].when(g); } catch (e) { hit = false; }
      if (hit) return PHASES[i];
    }
    return null;
  }

  global.Tactics = {
    SAFE, SAFE_LIMIT, ALIEN, XENO, PHASES, BANNED,
    ALIEN_OPTS, XENO_OPTS, ALIEN_UNWIRED,          // v31 批 3：结构化选项池（旧 ALIEN/XENO 保留为审计清单）
    pickTactic, squadRoles, matesOf,               // v31 批 3：选择器（唯一消费者入口）
    /* v31 批 3.5：人类侧保护优先级选项池 N414~N417（不进估值层；N417 由 floor 承载） */
    PROTECT_OPTS, PROTECT_FLOOR_ID, protectPriority, protectionBonus,
    filterClaims, detectiveAnnounceRecent, phaseOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
