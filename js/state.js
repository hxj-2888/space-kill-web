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
      suppressLeft: info.faction === 'alien' ? 0 : 3,
      antibodyNight: null,
      silenceNight: null, silencedOnce: false,
      guard: false, patrol: false, shield: 0,
      noActive: false,             // 当夜使用过感染抑制
      immuneActiveNight: 0,        // 外星人夜晚免疫已在当夜触发

      /* 资源 */
      bullets: roleKey === 'sheriff' ? 1 : 0,
      patrolUsed: false,
      repairTotal: 0, extraRepair: roleKey === 'engineer' ? 3 : 0, repairExposed: false,
      healLeft: 0, selfSaveLeft: roleKey === 'bio' ? 1 : 0,
      rescueLeft: 0, cureLeft: roleKey === 'rescue' ? 1 : 0,
      cureSelf: 0,                 // 外星人感染治疗额度
      nightImmune: roleKey === 'xeno' ? 1 : 0,
      destroyLeft: roleKey === 'xeno' ? 1 : 0,
      awakened: false,
      meetingLeft: roleKey === 'inspector' ? 1 : 0,
      alien: { dir: null, evoNight: 0, kills: 1, extraKill: 0, destroyTotal10: 0, converts: 0, dirs: {} },   // 破坏个体累计（×10 整数）
      guardStreak: 0,              // 反拖延：连续结茧/放弃夜数（v4 6.2）
      sabTau: 0.5,                 // 破坏个体阈值（v4 第五章）——v26：由 createGame 逐人 roll（旧实现从未赋值）

      /* 认知 */
      checkPool: new Map(),        // 神探：id -> {faction, role, night, published}
      crewChecks: new Map(),       // 船员：id -> {excludes:[], locked}
      bulletLog: roleKey === 'sheriff' ? [{ night: 0, delta: 1, src: '初始 1 发' }] : [],
      known: new Map(),            // id -> {faction, role}（合法获知）
      claims: [],                  // 公开声称
      inbox: [],                   // 私人反馈
      notes: '',

      /* 其它 */
      branch: null,
      lastProtected: null, lastInvite: null,
      transferred: false, brew: null, bounty: 0,
      /* 西塔性格三档（AI 规格 4.x）：局内独立抽取，与职业无关。
         v26：删除 tau / tauGrudge / pBase 三个【只写不读】的死字段——
         衰减口径已由 ai.js 的 CLAIM_DECAY(0.85) / GRUDGE_DECAY(0.90) 常量统一承载
         （v21 改动 #6 已裁定「τ 固定、不随性格变」，per-player 的 τ 因此失去意义）；
         pBase（提问概率）从未被任何决策分支引用。 */
      theta: 50, vSelf: 70, w: 0.4,
      tEvents: new Map(),            // 证据事件日志（v21 #4：含 sourceId/kind；绝对私有，不写回记事本）
      evidence: null,                // E 三通道：id -> {human, alien, king}（createGame 初始化，§4.1）
      uEvents: [],                   // v20 定案「双层估值」普适层：群体基线事件（针对全场/结构事实的通道）
      hardFloor: null,               // 硬源置位下限：id -> {v, night}（R30/R7，改动 #9）
      cred: null,                    // 可信度 C 表：speakerId -> [0,1]，初始 0.5（§4.4）
      markSeen: new Map(),           // 医生 R7：感染标记首次可见夜（当前仍带标记者）
      markEverSeen: null,            // v26 医生记忆（N148「须自记」的 AI 等价物）：id -> {night,lastSeen,goneNight,noCure}
      dyingSeen: null,               // v31 批 3.5（N406 输入）：救援医师／临时医生的当夜濒死名单快照 {night, ids}（P13）
      antibodyFired: null,           // v31 批 3.5（N407 输入）：生化医师「抗体生效」记录 [{night, target}]（P15）
      repairedTonight: 0, cureHands: 0,
    };
    return p;
  }

  function createGame(seed, prefFaction) {
    const rng = new RNG(seed);
    const roles = ['alien', 'alien', 'alien', 'xeno'].concat(D.HUMAN_SETUP);
    rng.shuffle(roles);
    const names = D.NAMES.slice();
    rng.shuffle(names);

    const g = {
      rng, seed,
      night: 0, day: 0, step: null, queue: [], sub: null,
      countdown: 24, net10: 0, tiers: { 3: false, 6: false, 9: false },   // v4.1 定案43：净破坏量整数存储（×10）
      stopNight: false, pendingStop: false,
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
      const r = rng.next();
      p.theta = r < 0.15 ? 25 : r < 0.85 ? 50 : 75;
      /* v21 改动 #6：τ 固定，不随性格变（旧版 τ=200/θ 让激进记仇 8 夜、保守只记 2.67 夜，
         属未文档化的性格传导，违反「性格不调制客观量」）。性格只经 §4.5 的阈值与容忍两条路径传导。 */
      p.vSelf = 70 * (p.theta / 50);
      p.w = { 25: 0.7, 50: 0.4, 75: 0.2 }[p.theta];
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
