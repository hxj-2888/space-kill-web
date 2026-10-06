/* 对局状态初始化 */
(function (global) {
  const D = global.SKData;

  function makePlayer(id, name, roleKey) {
    const info = D.ROLES[roleKey];
    const p = {
      id, name, role: roleKey, roleName: info.name, faction: info.faction,
      originRole: roleKey,          // 原职业底册（转职不改其人，只换其业；排除池清理用）
      roleExpert: roleKey,          // v32 批 5′：当前挂载的角色专家（R01~R13，= 角色键）。转职即换挂载（换眼睛），tEvents 不删（留记忆，规则 118/120）
      isHuman: false,

      /* 出局 / 濒死 */
      out: false, outNight: null, outType: null, cause: null,
      revealed: null,              // 已被公开揭示的身份 {faction, role}
      dying: false, dyingCause: null,

      /* 状态 */
      infection: null,             // {real, appliedNight, deathNight}
      /* A6 批次 31：毒药（4.6.4③）——第四种伤害类型，独立计时、**非感染标记**（3.3 全章不适用）。
         落身当夜为第 1 夜，第 3 夜步骤 0.55 致濒死；同一目标至多 1 份标记（重复下毒不落身、
         不叠加、不刷新计时，仍耗额度不返还——比照 4.10.4③④）。落身即知（被下毒者本人），
         治疗/救援/自救均不能清除，唯一清除途径是毒师解药。 */
      poison: null,                // { night, by, source }  source='poisoner'|'mirror'
      antidotedNights: null,        // 被解药清除的夜（仅供 god 复盘，推理不读）
      suppressLeft: info.faction === 'alien' ? 0 : 3,
      antibodyNight: null,
      silenceNight: null, lastSilenceNight: null,   // A15：沉默当夜生效；lastSilenceNight 供 6.1.2(a) 禁连两夜判定
      guardDmg: false, guardInf: false, patrolDmg: false, patrolInf: false, shield: 0,
      safeRoomUsed: false, safeRoomNight: null,   // 4.3.1 工程师限定技（v6.6 2.3 表 #8）
      noActive: false,             // 当夜使用过感染抑制
      immuneActiveNight: null,     // 外星人夜晚免疫已在哪一夜触发（null=未触发；初值不可用 0——与 g.night 0 碰撞）

      /* 资源 */
      bullets: (roleKey === 'sheriff' || roleKey === 'hunter') ? 1 : 0,   // 猎手初始 1 发（4.4.7①）
      patrolUsed: false,
      repairTotal: 0, extraRepair: roleKey === 'engineer' ? 3 : 0, repairExposed: false,
      healLeft: 0, selfSaveLeft: roleKey === 'bio' ? 1 : 0,
      rescueLeft: 0, cureLeft: roleKey === 'rescue' ? 1 : 0,
      cureSelf: 0,                 // 外星人感染治疗额度
      nightImmune: roleKey === 'xeno' ? 1 : 0,
      destroyLeft: roleKey === 'xeno' ? 1 : 0,
      awakened: false,
      /* A6 批次 31：工匠护甲（4.11）——**仅工匠**开局自带 1 件常规护甲，已装备于自身、
         不可发配、不计入库存上限（4.11.1③/4.11.3①）；其余角色一律 mode:null（无甲），
         这是本字段最容易出错之处——初值若对全员生效，等于全场免疫一层。
         armorStock＝未分配库存（cast/castFast 次夜到账时 +1，上限 2）。
         护甲为「存量资产」：发出即锁死、不可收回/转移，持有者出局则消失（4.11.3②③）。
         armorExpireNight：速成护甲的到期夜（铸造夜为第 1 夜且当夜不生效，第 2/3 夜生效、
         第 4 夜消失），null＝常规护甲（存续型，无期限）。 */
      armor: { mode: roleKey === 'artisan' ? 'normal' : null, expireNight: null },
      armorStock: 0,                                  // 未分配库存（cast/castFast 次夜到账时 +1）
      /* A6 批次 31：毒师额度（4.6.4⑥）——毒药 3 / 解药 3，第 1、3、5 夜各到账 1 份（依 2.1.5
         默认时序：白天投票之后、当夜步骤 0 之前），当夜即可用；无击杀回复、无补充途径。 */
      poisonLeft: roleKey === 'poisoner' ? 1 : 0,     // 初始 1，第 3/5 夜各 +1 ⇒ 全局合计 3
      antidoteLeft: roleKey === 'poisoner' ? 1 : 0,
      /* A6 批次 32 · 死囚外星人（6.8）：不持经典外星人任何技能，能力仅三项——变形＋复生＋
         作为外星人阵营成员参与清场。镜像账本自开局即建立、全程并行（2.8.5/6.8.3⑤）；
         morph 为当前呈现身份（null＝本体形态），morphNight 为实际变形夜（用于 2 夜冷却，6.8.3③）；
         reviveLeft 为复生全局额度（初始 2，6.8.4④）；prisoner 恒为真——不持蛰伏/双刀/破坏/
         夜晚免疫/感染治疗额度，且本局无沉默源、无停转夜（6.8.2/6.8.6）。 */
      convict: roleKey === 'convict',
      morph: null, morphNight: null, reviveLeft: roleKey === 'convict' ? 2 : 0,
      mirror: null,                                   // 镜像账本（SKMirror.build，见 2.8.5）
      /* A6 批次 29：hunter 嗅探（全局 2 个夜晚，4.4.8③）／listener 窃听报告（全局 2 次，4.12.5⑦） */
      sniffLeft: roleKey === 'hunter' ? 2 : 0, sniffedTonight: false,
      reportLeft: roleKey === 'listener' ? 2 : 0,
      wiretap: null,               // 窃听读取 {night, groups:[{a,b,lines}]}——保留至次日 D-report，逾期作废
      meetingLeft: roleKey === 'inspector' ? 1 : 0,
      alien: { dir: null, evoNight: 0, kills: 1, extraKill: 0, destroyTotal10: 0, converts: 0, dirs: {} },   // 破坏个体累计（×10 整数）
      guardStreak: 0,              // 反拖延：连续结茧/放弃夜数（v4 6.2）
      sabTau: 0.5,                 // 破坏个体阈值（v4 第五章）——v26：由 createGame 逐人 roll（旧实现从未赋值）

      /* 认知 */
      checkPool: new Map(),        // 神探：id -> { role, night, published }（B5/4.7.3：不存阵营，I9 待拍板）
      crewChecks: new Map(),       // 船员：id -> { n, results:[{night,id,ans}] }（A13 验证式，查验者×目标独立留存）
      bulletLog: roleKey === 'sheriff' ? [{ night: 0, delta: 1, src: '初始 1 发' }] : [],
      known: new Map(),            // id -> {faction?, role}（合法获知；B5：非 faction 揭示路径无 faction 键）
      claims: [],                  // 公开声称
      inbox: [],                   // 私人反馈
      notes: '',

      /* 其它 */
      branch: null,
      lastProtected: null, lastInvite: null,
      transferred: false, brew: null, bounty: 0,
      /* A19 乔装（7.3）：disguise 仅发动当夜有效（船员查验基准 2.8.1③之三①），按夜限定、
         白天不延续——crew 查验只发生在同夜步骤 2，夜号比对即完成失效，无须显式清除。
         次数：每个体全局 2 次（7.3.1；经典局 3×2＋外星人 1×2＝8）。 */
      disguise: null, disguiseLeft: (roleKey === 'alien' || roleKey === 'xeno') ? 2 : 0,
      /* 西塔性格三档（AI 规格 4.x）：局内独立抽取，与职业无关。
         v26：删除 tau / tauGrudge / pBase 三个【只写不读】的死字段——
         衰减口径已由 ai.js 的 CLAIM_DECAY(0.85) / GRUDGE_DECAY(0.90) 常量统一承载
         （v21 改动 #6 已裁定「τ 固定、不随性格变」，per-player 的 τ 因此失去意义）；
         pBase（提问概率）从未被任何决策分支引用。 */
      theta: 50, vSelf: 70, w: 0.4,
      tEvents: new Map(),            // 证据事件日志（v21 #4：含 sourceId/kind；绝对私有，不写回记事本）
      /* 拟人层 A：AI 长期记忆（js/ai/memory.js）——跨夜**归并后的印象**，
         与 tEvents（单夜证据流）、claims（发言原文流水）三分。只记合法持有信息，
         不记任何隐藏字段（否则记忆即透视）。 */
      mem: null,
      evidence: null,                // E 三通道：id -> {human, alien, king}（createGame 初始化，§4.1）
      uEvents: [],                   // v20 定案「双层估值」普适层：群体基线事件（针对全场/结构事实的通道）
      hardFloor: null,               // 硬源置位下限：id -> {v, night}（R30/R7，改动 #9）
      cred: null,                    // 可信度 C 表：speakerId -> [0,1]，初始 0.5（§4.4）
      markSeen: new Map(),           // 医生 R7：感染标记首次可见夜（当前仍带标记者）
      markEverSeen: null,            // v26 医生记忆（N148「须自记」的 AI 等价物）：id -> {night,lastSeen}（批⑫撤除后 goneNight/noCure 已废）
      dyingSeen: null,               // v31 批 3.5（N406 输入）：救援医师／临时医生的当夜濒死名单快照 {night, ids}（P13）
      antibodyFired: null,           // v31 批 3.5（N407 输入）：生化医师「抗体生效」记录 [{night, target}]（P15）
      repairedTonight: 0, cureHands: 0,
    };
    return p;
  }

  /* A6/A17 席位变体（1.1.1「同席位开局定其一」）：
     变体映射 = 被替换的席位Occupant → 变体角色（值须与 roleDecl 组位 members 一致）；
     READY = 引擎已实装其机制的变体（未实装席位拒绝非经典取值——fail loud，防「组进来的
     角色没有行为」）。经典局（不传 opts）走原路径：不消耗任何额外 rng，行为与席位表逐字节同。 */
  const SEAT_VARIANTS = { sheriff: 'hunter', inspector: 'listener', rescue: 'poisoner', bodyguard: 'artisan', xeno: 'convict' };
  const SEAT_VARIANT_READY = { sheriff: true, inspector: true, rescue: true, bodyguard: true, xeno: true };   // 批次 29/31/32 全部放开

  function createGame(seed, prefFaction, opts) {
    const rng = new RNG(seed);
    /* D8（v6.6 阶段 2）：非人类席位组成由声明层派生（roleDecl.nonHumanSetup = 按阵营声明序
       展开各阵营的 seats：异形 ×3 → 外星人 ×1），取代此前的字面量 ['alien','alien','alien','xeno']。
       派生结果与原字面量**逐项同序**，故 rng.shuffle 的输入完全一致（行为中性）。 */
    const roles = global.SKRoleDecl.nonHumanSetup().concat(D.HUMAN_SETUP);
    /* A6 席位变体：替换发生在 shuffle 之前且不改变数组长度 ⇒ 消耗的 rng 序列与
       经典局完全一致——变体局的差异只来自角色本身，不来自组局抽选（opts 显式给定）。 */
    const picks = opts && opts.seatPicks;
    if (picks) {
      for (const from of Object.keys(picks)) {
        const to = picks[from];
        if (SEAT_VARIANTS[from] !== to)
          throw new Error('createGame: ' + from + ' 席位的变体是 ' + SEAT_VARIANTS[from] + '，不接受 ' + to);
        if (!SEAT_VARIANT_READY[from])
          throw new Error('createGame: ' + to + ' 变体尚未实装（本批 READY：' +
            Object.keys(SEAT_VARIANT_READY).filter(k => SEAT_VARIANT_READY[k]).join('/') + '）');
        const i = roles.indexOf(from);
        if (i < 0) throw new Error('createGame: 席位表中找不到 ' + from);
        roles[i] = to;
      }
    }
    rng.shuffle(roles);
    const names = D.NAMES.slice();
    rng.shuffle(names);

    const g = {
      rng, seed,
      night: 0, day: 0, step: null, queue: [], sub: null,
      countdown: 24, net10: 0, tiers: { 3: false, 6: false, 9: false },   // v4.1 定案43：净破坏量整数存储（×10）
      stopNight: false, pendingStop: false,
      repairCutNext: 0,         // A20（3.2.6）：次夜维修效力削减%（4b 设定、4a 消费即清零，不递补）
      players: [],
      log: [],
      replay: [],               // 上帝视角全量事件流（含私人反馈与隐藏结果），供复盘使用
      chatLog: [],              // 公开发言记录（讨论 / 遗言 / 会议），全体可见
      humans: [],               // 真人席位（联机时多人；单机为 [humanId]）
      pendings: {},             // 待决策表单：pid -> form
      threat: {},               // 威胁度：由公开发言中的点名指控累积，全体可见（系统方案 8.2 术语）
      humanId: 0,
      extinction: false, duel: false, stalemate: 0, lastAliveCount: 15,
      winner: null, over: false,
      pending: null, decisions: {},
      dev: false,                    // 开发者视角（威胁度表 / 票型可见，原型专用）
      privateChats: [],              // 私聊正文记录（开发者视角可见）
      lowPopGiven: false,
      suppressCount: 0, cureHands: 0, meeting: null,
      skipCountdown: false,
      autoLog: [],
    };

    for (let i = 0; i < 15; i++) g.players.push(makePlayer(i + 1, names[i], roles[i]));

    /* A6 批次 32 · 6.8.3⑤ 镜像账本：死囚的可变形身份**自开局即建立并全程并行运行**——
       每张镜像于额度到账时点已依其自身身份独立领取当夜应得的被动额度（「稻草人先领、
       变形仅转移操作权」6.8.3④），故变形当夜即可使用新身份已到账的额度。
       变形池＝本局实际在场的人类职业 ∪ 异形（随席位变体浮动，不写死 9 项，6.8.3①）。
       经典局无死囚 ⇒ 本段整段不执行，对局状态与席位表逐字节同。 */
    for (const p of g.players) {
      if (p.role !== 'convict') continue;
      const M = global.SKMirror;
      p.mirror = M.build(M.morphPool(g, roles.filter((r, k) => roles.indexOf(r) === k)));
      M.enter(p.mirror, 'convict', 0);              // 本体形态自开局在位
      p.morph = null;                               // 本体形态（未变形）
    }

    /* 指定玩家席位 */
    let hid;
    if (prefFaction && prefFaction !== 'random') {
      const cand = g.players.filter(p => p.faction === prefFaction);
      hid = rng.pick(cand).id;
    } else {
      hid = 1 + rng.int(15);
    }
    g.humanId = hid;
    g.humans = [hid];
    g.players.forEach(p => { p.isHuman = (p.id === hid); });

    /* 西塔独立抽取：激进 25 / 正常 50 / 保守 75，人群比例 15:70:15（v22）。
       每局独立随机分配，不做硬兜底——可以出现全激进或全保守（用户方案）。 */
    for (const p of g.players) {
      /* K2：档位与出现权重由性格轴声明给出（含抽样分布；只消耗一次 rng.next()，与迁移前逐位等价） */
      p.theta = global.SKTrait.roll('theta', rng);
      /* v21 改动 #6：τ 固定，不随性格变（旧版 τ=200/θ 让激进记仇 8 夜、保守只记 2.67 夜，
         属未文档化的性格传导，违反「性格不调制客观量」）。性格只经 §4.5 的阈值与容忍两条路径传导。 */
      p.vSelf = 70 * (p.theta / 50);
      p.w = global.SKTrait.traitValue('theta', 'wOpen', p.theta);   // K2：说话开合率由性格轴声明给出
      /* v26：破坏个体阈值补 roll——旧代码注释写「开局 roll 一次，整局不变」，实际从未赋值，
         ai.js 的 uDestroy 里 (0.5 - p.sabTau) 恒等于 0.5 → 恒定 +0.15（+15 分），
         既没有"个体差异"，又对全体异形施加了未标定的固定偏置。 */
      p.sabTau = 0.2 + rng.next() * 0.6;
    }

    /* v21 §4.1：E 三通道先验初始化（改动 #1：baseRate 数值回收为先验——
       人类观察者敌对度 (3+1)/14 = 28.6%、外星人 3/14 = 21.4%、异形对非队友 50%）。
       先验只使用公开的阵营构成（3 异形 / 1 外星人 / 11 人类）与观察者自身阵营推得，
       不读取他人真实阵营（§7.1 最小信息原则）；异形对队友的互认属合法获知。 */
    /* v28（B2 裁定）：先验分向量上移到 Tiers.PRIOR_E（唯一真源）。
       本文件先于 tiers.js 加载，但 createGame 只在对局开始时调用 —— 此时 Tiers 必已就位。 */
    const PE = global.Tiers.PRIOR_E;
    for (const p of g.players) {
      p.evidence = new Map();
      p.hardFloor = new Map();
      for (const o of g.players) {
        if (o.id === p.id) continue;
        let e;
        if (p.faction === 'human')      e = Object.assign({}, PE.humanViewer);      // 敌对度 (3+1)/14 = 28.6%
        else if (p.faction === 'xeno')  e = Object.assign({}, PE.xenoViewer);       // 敌对度 3/14 = 21.4%
        else if (o.faction === 'alien') e = Object.assign({}, PE.alienMate);        // 队友：异形通道拉满（硬锁）
        else                            e = Object.assign({}, PE.alienVsOther);     // 非队友：敌对度先验 50%
        p.evidence.set(o.id, e);
      }
    }

    g.actCounts = { repair: 0, check: 0, cure: 0, destroy: 0, otherDestroy: 0, death: 0 };

    /* 异形互认队友 */
    const aliens = g.players.filter(p => p.faction === 'alien');
    for (const a of aliens) for (const b of aliens) {
      if (a.id !== b.id) a.known.set(b.id, { faction: 'alien', role: 'alien' });
    }

    return g;
  }

  global.Setup = { createGame, makePlayer };
})(typeof window !== 'undefined' ? window : globalThis);
