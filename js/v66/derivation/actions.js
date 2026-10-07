/* =============================================================
 * 太空杀 · 推导层：行动位与事件族倒排（v6.6 重构 C5 / C4 · 阶段 2）
 *
 * 职责：把「声明」翻成引擎与推理层能直接消费的两个倒排索引——
 *   C5 机制 → 候选发出者：某行动位上谁能出手（取代「谁能干这事」的手写枚举）
 *   C4 观测 → 产出处：某公告批次 / 私反馈族在哪个步骤产生（取代「这反映什么行为」的手写判据）
 *
 * 规则依据（v6.6 正文，唯一权威源）：
 *   · 2.8.6 / 图 2（附录 A 转录）—— 行动位归属：每个机制/角色在哪个步骤出手
 *   · 2.1.6 公告批次一览 + 7.2 私人反馈 —— 观测族与产出时点
 *   · 附录 C 九关①—— RoleDecl.actionStep 与机制 steps 都来自这一关
 *
 * 分层纪律（清单 §3 三层架构）：
 *   本模块属【推导层】：只做「声明 → 索引」的机械推导，不含任何具体机制名与业务判断。
 *   加角色/加机制只改声明层，本文件与执行层零改动（K1）。
 *   完整版「观测 → 机制」的推理侧倒排（哪条证据指向哪个机制）属【执行层】C6/C7，
 *   在阶段 3a/3b 落地；本模块提供它所需的规范种子（步骤 × 批次 × 行动位）。
 *
 * 未实装角色的处理（D3）：hunter/poisoner/artisan/listener/convict 尚无 RoleDecl 条目，
 *   但其机制已在能力注册表登记——倒排索引照常把它们列为候选发出者（pendingRole），
 *   引擎侧的动作池只需在实装时读同一索引，不必再改过滤条件。
 * ============================================================= */
(function (global) {
  const RD = global.SKRoleDecl, CAP = global.SKCapability, EF = global.SKEventFamily;

  /* ================= C5：机制 → 候选发出者 ================= */

  /** 某行动位上**已声明**的角色键（主行动位 actionStep；顺序 = 声明序）
      引擎派发过滤（canActAt）以此为准 —— 主行动位单一，故新增「次要行动位」不会改变既有派发 */
  function rolesAt(step) {
    if (!RD) return [];
    return RD.keys().filter(k => RD.ROLE_DECL[k].actionStep === step);
  }
  /** 某角色的全部行动位（actionSteps 缺省＝[actionStep]） */
  function actionSlots(roleKey) {
    if (!RD || !RD.has(roleKey)) return [];
    const d = RD.ROLE_DECL[roleKey];
    return Array.isArray(d.actionSteps) && d.actionSteps.length ? d.actionSteps.slice() : (d.actionStep ? [d.actionStep] : []);
  }
  /** 某行动位上的全部已声明角色（含多行动位角色的**次要**行动位）——供覆盖审计与 C1 收口 */
  function rolesAtAll(step) {
    if (!RD) return [];
    return RD.keys().filter(k => actionSlots(k).indexOf(step) >= 0);
  }
  /** 某行动位的「参与者规则」展开（0a 私聊＝全体存活；0b/0c 依赖驱动＝任意角色；
      白天/会议步位同为 alive；阵营级能力按 factions 展开；角色专属窗口按 roles 展开） */
  function participantsOf(step) {
    const s = EF ? EF.STEP_INDEX[step] : null;
    if (!s) return [];
    const out = [];
    const add = r => { if (out.indexOf(r) < 0) out.push(r); };
    if (s.participants === 'alive' || s.participants === 'engaged') { for (const k of (RD ? RD.keys() : [])) add(k); }
    if (s.capability && s.factions) {                          // 阵营级能力（如感染抑制）
      for (const f of s.factions) for (const k of (RD ? RD.keys() : []))
        if (RD.ROLE_DECL[k].faction === f) add(k);
    }
    for (const r of (s.roles || [])) add(r);                   // 角色专属窗口（如验票官专属发言）
    return out;
  }
  /** 某行动位上**声明所覆盖**的全部角色（角色行动位 ∪ 机制 owner ∪ 参与者规则）——覆盖审计基准 */
  function declaredActors(step) {
    const out = rolesAtAll(step).slice();
    const add = arr => { for (const r of arr) if (out.indexOf(r) < 0) out.push(r); };
    for (const m of (CAP ? CAP.mechanismsAt(step) : [])) {
      const o = CAP.get(m).owner;
      add(Array.isArray(o) ? o : [o]);
    }
    add(participantsOf(step));
    return out;
  }
  /** 覆盖审计：引擎实际派发了决策、而声明未覆盖的角色（空数组＝声明完整） */
  function coverageGap(step, actualRoles) {
    const declared = declaredActors(step);
    return (actualRoles || []).filter(r => declared.indexOf(r) < 0);
  }
  /** 某行动位上的全部候选发出者 = 已声明角色（含次要行动位）∪ 机制 owner ∪ 参与者规则（含未实装 owner） */
  function sendersAt(step) {
    const out = rolesAtAll(step).slice();
    for (const m of (CAP ? CAP.mechanismsAt(step) : [])) {
      const o = CAP.get(m).owner;
      for (const r of (Array.isArray(o) ? o : [o])) if (out.indexOf(r) < 0) out.push(r);
    }
    for (const r of participantsOf(step)) if (out.indexOf(r) < 0) out.push(r);
    return out;
  }
  /** 某机制（能力）的候选发出者：其 owner 声明（未实装角色也保留，标 pendingRole） */
  function sendersOf(mechanismKey) {
    const m = CAP ? CAP.get(mechanismKey) : null;
    if (!m) return [];
    const arr = Array.isArray(m.owner) ? m.owner : [m.owner];
    return arr.map(r => ({ role: r, declared: !!(RD && RD.has(r)), pendingRole: (m.pendingRole || []).indexOf(r) >= 0 }));
  }
  /** 具备某能力标签的角色键（直通声明层；本处提供统一入口便于执行层单一依赖） */
  function grantSenders(grant) { return RD ? RD.rolesWith(grant) : []; }
  /** 判定：某角色是否可在该行动位出手（执行层唯一入口，替代 role=== 枚举） */
  function canActAt(roleKey, step) { return rolesAt(step).indexOf(roleKey) >= 0; }

  /* ---------- 阵营成员 ≠ 能力持有者（6.8.2 / 6.8.3 的关键分野） ----------
     死囚外星人全程 `faction === 'xeno'`（它**是**外星人阵营成员，参与清场与胜负判定，
     engine.js 的胜负统计必须继续按 faction 判），但它**不持经典外星人的任何技能**：
     蛰伏查验 / 蛰伏沉默 / 破坏 / 双刀击杀 / 夜晚免疫 / 感染治疗额度 / 乔装。
     变形后 `p.role` 变成所变形身份、`p.faction` 仍是 xeno —— 于是**凡是按 faction 派发
     经典外星人技能的步位，都会同时漏给「未变形的死囚」和「变形后的死囚」**。
     这正是「死囚没有经典外星人技能却能发动」与「变形成神探却还能开医生表单」的同一个根因。

     正确判据是**按 role 判**：经典外星人的能力只在 `role === 'xeno'` 时成立。
     死囚本体形态 role==='convict'、变形后 role===<所变形身份>，两者都自动不成立 ——
     既不必到处打 convict 补丁，也天然覆盖变形后的每一种身份。 */
  function isClassicXeno(p) { return !!p && p.role === 'xeno'; }

  /** 反向：是否为「外星人阵营成员」（胜负、清场等**阵营**语义用这个，切勿与上面混用） */
  function isXenoCamp(p) { return !!p && p.faction === 'xeno'; }

  /** 变形者：死囚变形后不得转职（6.8.3⑦）——转职是普通船员自身的能力，不是通用能力 */
  function isMorphed(p) { return !!p && !!(p.convict || p.morph != null); }

  /* ================= C4：观测 → 产出处 ================= */

  /** 某广播批次由哪些步骤产出（2.1.6 时点 × 附录 A 步骤表） */
  function stepsOfBatch(batch) {
    if (!EF) return [];
    return EF.STEPS.filter(s => s.batches.indexOf(batch) >= 0).map(s => s.step);
  }
  /** 某广播批次的产出机制（产出步骤上登记的机制；系统批（如死亡名单）可能为空） */
  function mechanismsProducing(batch) {
    const out = [];
    for (const st of stepsOfBatch(batch))
      for (const m of (CAP ? CAP.mechanismsAt(st) : []))
        if (out.indexOf(m) < 0) out.push(m);
    return out;
  }
  /** 某私有反馈族（7.2.x）的送达步骤 */
  function stepsOfPrivate(fam) {
    if (!EF) return [];
    return EF.STEPS.filter(s => s.private.indexOf(fam) >= 0).map(s => s.step);
  }
  /** 观测总线上某步骤的全部产出（广播批次 + 私反馈族） */
  function observationsOf(step) {
    if (!EF) return { batch: [], private: [] };
    return { batch: EF.batchesOfStep(step), private: EF.privateOfStep(step) };
  }

  /* ================= H21：查证池推导（4.1.1 ①②③ + I3 浮动口径） ================= */

  /** 本局「开局公告职业构成」＝ 全部玩家的初始职业（去重，按首次出现序）
      —— 4.1.1①「本局开局公告所列」、②「本局开局公告的全职业池」、I3「池随构成浮动」。 */
  function compositionOf(g) {
    const seen = [];
    if (!g || !g.players) return seen;
    for (const p of g.players) {
      const r = p.originRole || p.role;
      if (r && seen.indexOf(r) < 0) seen.push(r);
    }
    return seen;
  }
  /** 某职业是否仍有**真实持有者**在场（4.1.1③：变形产生的呈现实例不产生新的真实持有者） */
  function hasAliveHolder(g, roleKey) {
    if (!g || !g.players) return false;
    return g.players.some(o => o.originRole === roleKey && !o.out);
  }
  /**
   * 普通船员验证式查验的候选池（唯一入口）。
   *   首次（4.1.1①）= 开局公告的**人类职业**（不含转职衍生职业）；
   *   其后（4.1.1②）= 开局公告的**全职业池**（项数随构成浮动，仍不含转职衍生职业）；
   *   两者都再按 ③ 移除「全部真实持有者均已出局」的职业。
   * @param opts.first true＝首次池（查验者×目标独立计次，由调用方给出）
   * 返回值顺序 = 声明层目录序（首次＝基础人类职业序；其后＝基础人类职业序 + 非人类阵营序）。
   */
  function verifyPool(g, opts) {
    const first = !!(opts && opts.first);
    const catalog = first ? RD.baseHumanRoles() : RD.verifyPoolAll();
    const comp = compositionOf(g);
    return catalog.filter(id => comp.indexOf(id) >= 0 && hasAliveHolder(g, id));
  }
  /** 判定某身份是否在可查范围内（运行侧唯一收口：池外提交不作答，4.1.1③「不存在无效查证」） */
  function inVerifyPool(g, identity, opts) {
    return verifyPool(g, opts).indexOf(identity) >= 0;
  }

  /* ================= 契约自检（声明 × 契约 交叉核对） ================= */
  function audit() {
    const bad = [];
    const steps = EF ? EF.STEPS.map(s => s.step) : [];
    /* 1. 角色与机制的行动位都必须是事件族步骤表里已登记的步位（防手写错步位名） */
    for (const k of RD.keys()) {
      const a = RD.ROLE_DECL[k].actionStep;
      if (a && a !== 'day' && steps.indexOf(a) < 0) bad.push(`角色 ${k} 的行动位 ${a} 未登记于事件族步骤表`);
    }
    for (const m of (CAP ? CAP.keys() : [])) {
      for (const s of CAP.get(m).steps || [])
        if (s !== 'day' && steps.indexOf(s) < 0) bad.push(`机制 ${m} 的行动位 ${s} 未登记于事件族步骤表`);
    }
    /* 2. 每个广播批次必须至少有一个产出步骤（否则该族永不产生＝死配置） */
    if (EF) for (const b of Object.keys(EF.BATCH)) {
      if (b === '〇') continue;                        // 开局职业公告不在夜间/白天步骤序列内
      if (!stepsOfBatch(b).length) bad.push(`批次 ${b} 无产出步骤`);
    }
    /* 3. 多行动位机制的每一个步位都必须真的被引用（防「声明了却不存在」） */
    for (const m of (CAP ? CAP.keys() : [])) {
      const st = CAP.get(m).steps || [];
      if (new Set(st).size !== st.length) bad.push(`机制 ${m} 的行动位有重复项`);
    }
    return bad;
  }

  global.SKDerivation = {
    rolesAt, rolesAtAll, actionSlots, declaredActors, participantsOf, coverageGap,
    sendersAt, sendersOf, grantSenders, canActAt,
    isClassicXeno, isXenoCamp, isMorphed,
    stepsOfBatch, mechanismsProducing, stepsOfPrivate, observationsOf,
    compositionOf, hasAliveHolder, verifyPool, inVerifyPool,
    audit,
  };
})(typeof window !== 'undefined' ? window : globalThis);
