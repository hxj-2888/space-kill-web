/* =============================================================
 * 太空杀 · 能力注册表 Capability Registry（v6.6 重构 C2 · 阶段 2 声明层）
 *
 * ⚠️ 本文件由 tools/gen-capability-registry.cjs 自九关核验提取数据生成，请勿手改；
 *    规则侧修订后重跑生成器：node tools/gen-capability-registry.cjs
 *
 * 数据来源：《太空杀V6.6正文_改造v3.txt》(3489 行，唯一权威源) 的十处「九关核验」块，
 *   经逐字提取为 _九关核验_提取数据.json（每值附行号）。本表字段槽＝附录 C 的九关 schema
 *   （①行动位 / ①之二席位 / ②判定基准 / ③伤害侧层序 / ④感染侧层序 / ⑤可见性 / ⑥封锁 /
 *    ⑦额度记账 / ⑧公告批次 / ⑨重复阐述）。
 *
 * 性质：纯数据。K1 的落点——**加机制只在本表加一条**；推导层据 gates 自动长出该角色的
 *   行动位、私有节点、可见性授予与事件族，执行层不认识任何具体机制名（H1 验收）。
 *
 * ── 提取阶段的三条前提修正（与改动清单 v1.1 不一致处，以正文为准）────────────
 *  〔2026-10-05 v66.1 已落地：P1／P2 由「代码假定」升级为「与正文一致」〕
 *  P1 九关核验实为 **10 块**，非 9 块：正文 5.9⑧ 末句 (2544) 自述「全文九关核验共九处」
 *     并列举 9 条，**漏列 4.6.4（毒师）**；该块位于 1948 行、标题仅作「⑦九关核验」无条款前缀。
 *     ▸ **v66.1 已改正**：5.9⑧ 改为「共十处」并补列 `4.6.4⑦`；连带 4.3.1-九 / 5.7-九 / 5.9⑧
 *       三处「与其余**八**处核验格式统一」改为「其余**九**处」。本表 blockCount=10 与之相符。
 *  P2 2.8.10 段内实为 **10 个字段**（①+①之二+②~⑨）；而 2.8.9 称第⑨关为「2.8.10第九关」，
 *     两套序号口径无法直接对齐（提取歧义 A3）。
 *     ▸ **v66.1 已改正**：2.8.10 标题改为「接入检查（九关·含 ①之二 共十项）」，明示十项。
 *  P3 ③④两关在 2.8.10 (1063) **没有「核对项名称」**（原文仅「③伤害侧层序（2.8.2）｜
 *     ④感染侧层序（5.3.3）」），故 damageLayer / infectLayer 两个字段名出自改动清单
 *     附录 C（1307/1310），非正文用词。
 *
 * ── 附录二《职业速查卡》的结构修正 ───────────────────────────────
 *  实际列名（3343-3346 逐字）：职业 ｜ 核心能力 ｜ 关键额度 ｜ 暴露风险∕定位。
 *  改动清单 609 行所称「速查卡每职业六行（夜间行动/核心能力/额度与到账/目标限制/
 *  可见性/封锁）」在正文附录二中**无对应物**——速查卡不含封锁列、不含判定基准列；
 *  猎手 (4.4.7) 与毒师 (4.6.4) 在附录二**无条目**。故本表全部取值只取九关核验块，
 *  速查卡仅作交叉校验（冲突见 META.cheatsheetConflicts）。
 *
 * ── owner 角色键与实现状态 ───────────────────────────────────
 *  owner 为英文角色键（正文不含英文键，属代码层事项）。hunter/poisoner/artisan/listener/
 *  convict 为 v6.6 新增角色（A6 尚未实装），以 pendingRole 标注，不阻塞本表登记。
 *  5.7 / 5.9 两块在提取数据中标为 xeno，经正文核对（2476-2477 / 2537-2538，第 5 章为异形章）
 *  更正为 alien，见文件末 CORRECTIONS。
 * ============================================================= */
(function (global) {
  /* ---------- 九关 schema（附录 C）：字段名即契约 ---------- */
  const GATE_SCHEMA = {
    actionStep:  { gate: '①',      rule: '2.8.6',  desc: '行动位归属：步骤名或前置阶段名（图 2）' },
    seat:        { gate: '①之二',  rule: '1.1.1',  desc: '席位归属；不占席位者 null（正文作「不适用」）' },
    judgeMode:   { gate: '②',      rule: '2.8.1',  desc: '判定基准（正文十块均作「字面身份（2.8.1①）」）' },
    damageLayer: { gate: '③',      rule: '2.8.2',  desc: '伤害侧层序：全额减免|时限类|存续类|不参与＋类内序号' },
    infectLayer: { gate: '④',      rule: '5.3.3',  desc: '感染侧层序：同上；抗体为感染侧专属时限类' },
    visibility:  { gate: '⑤',      rule: '2.8.7',  desc: '可见性授予清单（批次/私反馈/仅本人/队内）' },
    blocked:     { gate: '⑥',      rule: '2.8.3',  desc: '是否受封锁（沉默与感染抑制；总清单③）' },
    exempt:      { gate: '⑥',      rule: '2.8.3④', desc: '明文豁免 / 时序确认（非例外者无须登记 2.8.9）' },
    charges:     { gate: '⑦',      rule: '2.5',    desc: '额度记账（2.5 获取侧）' },
    process:     { gate: '⑦',      rule: '2.9',    desc: '进程型产出（投入 N 夜/可中断/产物/次夜到账）' },
    batchDelta:  { gate: '⑧',      rule: '2.1.6',  desc: '是否新增或改变任一公告批次' },
    restatement: { gate: '⑨',      rule: '0.3/2.8.9', desc: '重复阐述：重申|适用|例外（例外须登记 2.8.9）' },
  };

  /* ---------- 机制声明表（10 条，逐字取自九关核验块） ---------- */
  const MECHANISMS = {
    /* 4.3.1-九 —— 安全室（限定技）（engineer） */
    "engineer.safeRoom": {
      clause: "4.3.1-九",
      owner: "engineer",
      mechanism: "安全室（限定技）",
      lines: {"title":1522,"body":"1522-1528","range":"1522-1528"},
      steps: ["3"],        // 九关① 的结构化形态（策展核定，与同块 actionStep 原文一致）
      pendingRole: [],
      gates: {
        actionStep: {"verbatim":"步骤3（与保镖保护（4.8）∕工匠护甲（4.11）同行动位）","lines":"1522-1523"},
        seat: {"verbatim":"不适用，不另设行动位（2.8.6）","lines":"1523"},
        judgeMode: {"verbatim":"字面身份（2.8.1①）","lines":"1523"},
        damageLayer: {"verbatim":"属全额减免，先于一切抵挡层且不消耗其他层，依 2.8.2⑥〔通则 2.8.2⑥ 之例外，登记于 2.8.9④〕","lines":"1524"},
        infectLayer: {"verbatim":"同全额减免之口径，一并抵挡感染，不参与 5.3.3的逐层消耗","lines":"1525"},
        visibility: {"verbatim":"依 2.8.7 不予通报，仅工程师本人可见其进入状态与余量，不新增可见性授予","lines":"1525-1526"},
        blocked: {"verbatim":"属主动技能，受沉默与感染抑制封锁（2.8.3③）；进入后已获得的当夜全额减免不受影响","lines":"1526-1527"},
        exempt: {"verbatim":"进入后已获得的当夜全额减免不受影响（属封锁内说明，非 2.8.3④ 明文豁免）","lines":"1526-1527"},
        charges: {"verbatim":"限定技，全局 1次，不与他人共享、不因转职或出局转移（2.5、2.8.5）","lines":"1527-1528"},
        process: {"verbatim":null,"status":"未明文（⑦未标 2.9 进程型）","lines":null},
        batchDelta: {"verbatim":"不新增公告批次（2.1.6）","lines":"1528"},
        restatement: {"verbatim":"已标注〔例外〕并登记入2.8.9④，未重复阐述 2.8.2⑥ 之外的通则","lines":"1528","nonTriadWording":true},
      },
    },
    /* 4.4.9 —— 开枪 / 嗅探 / 攒弹（hunter） */
    "hunter.sniffAmmo": {
      clause: "4.4.9",
      owner: "hunter",
      mechanism: "开枪 / 嗅探 / 攒弹",
      lines: {"title":1715,"body":"1715-1722","range":"1715-1722"},
      steps: ["6","3.5"],        // 九关① 的结构化形态（策展核定，与同块 actionStep 原文一致）
      pendingRole: ["hunter"],
      gates: {
        actionStep: {"verbatim":"开枪归步骤6（与警长同行动位，2.8.6）｜嗅探归步骤 3.5，位于步骤 3之后、4a之前，系明文新增行动位并同步 2.1.1 与 2.1.6","lines":"1715-1717","multiValued":true},
        seat: {"verbatim":"与警长同席位（4.4）","lines":"1716"},
        judgeMode: {"verbatim":"字面身份（2.8.1①）","lines":"1717"},
        damageLayer: {"verbatim":"依2.8.2，枪击不另设层序、不另立抵挡层","lines":"1717"},
        infectLayer: {"verbatim":"不参与（枪击与嗅探均不施加感染，亦不产生抵免）","lines":"1718"},
        visibility: {"verbatim":"依2.8.7，嗅探结果仅猎手本人可见，子弹余量仅本人可见，均不产生公告、不进入任何批次","lines":"1718"},
        blocked: {"verbatim":"开枪与嗅探均属夜间主动技能，受沉默与感染抑制封锁（2.8.3③）","lines":"1719"},
        exempt: {"verbatim":"（⑥关内无豁免项）〔通则 4.4.6 之例外〕不受 2发存储上限约束（登记于 2.8.9）——该例外写于⑦额度记账内，非⑥内","lines":"1720"},
        charges: {"verbatim":"子弹初始 1 发，〔通则 4.4.6 之例外〕不受 2发存储上限约束（登记于 2.8.9），攒弹制式同制药、固定投入2个夜晚且不必连续、投入夜不可开枪与嗅探；嗅探以「夜晚数」计，全局 2 个夜晚（2.5）","lines":"1720-1721"},
        process: {"verbatim":"攒弹制式同制药、固定投入2个夜晚且不必连续（进程型，2.9）","lines":"1720-1721","explicit29":false,"note":"正文写「制式同制药」而未直接标 2.9；2.9 的现行合形态者清单（1130行）将「猎手攒弹（4.4.7②）」列入"},
        batchDelta: {"verbatim":"不新增公告批次——开枪结果依7.2.2私人反馈，嗅探不设批次","lines":"1721-1722"},
        restatement: {"verbatim":"已标注〔例外〕并登记入 2.8.9；其余各款均为对 2.5∕2.8.3∕2.8.7 的〔适用〕","lines":"1722"},
      },
    },
    /* 4.6.4⑦ —— 毒药 / 解药（poisoner） */
    "poisoner.poison": {
      clause: "4.6.4⑦",
      owner: "poisoner",
      mechanism: "毒药 / 解药",
      lines: {"title":1948,"body":"1949-1953","range":"1948-1953"},
      steps: ["8"],        // 九关① 的结构化形态（策展核定，与同块 actionStep 原文一致）
      pendingRole: ["poisoner"],
      gates: {
        actionStep: {"verbatim":"步骤 8","lines":"1949"},
        seat: {"verbatim":"与救援医师同席位（4.6）（2.8.6）","lines":"1949"},
        judgeMode: {"verbatim":"字面身份（2.8.1①）","lines":"1949"},
        damageLayer: {"verbatim":"毒伤仅由全额减免层拦截，庇护类不参与〔通则 2.8.2⑥之例外，登记于 2.8.9(18)〕","lines":"1949-1950"},
        infectLayer: {"verbatim":"毒药非感染标记，不适用5.3.3（适用范围之外）","lines":"1950"},
        visibility: {"verbatim":"毒师本人与被下毒者本人可见，其余依 2.8.7 不公开","lines":"1951"},
        blocked: {"verbatim":"毒药与解药属主动技能，依2.8.3③ 受沉默与感染抑制封锁；自救依 2.8.3④豁免","lines":"1951-1952"},
        exempt: {"verbatim":"自救依 2.8.3④豁免","lines":"1952","exemptionClass":"2.8.3④ 明文豁免清单"},
        charges: {"verbatim":"毒药 3、解药 3，属 2.5额度，不计入制药产出","lines":"1952"},
        process: {"verbatim":null,"status":"未明文（⑦仅标 2.5，未标 2.9）","lines":null},
        batchDelta: {"verbatim":"不新增公告批次（2.1.6）","lines":"1953"},
        restatement: {"verbatim":"已标注〔例外〕并登记入 2.8.9(18)","lines":"1953"},
      },
    },
    /* 4.9.7 —— 票源可见 / 紧急会议 / 专属发言（inspector） */
    "inspector.votesMeeting": {
      clause: "4.9.7",
      owner: "inspector",
      mechanism: "票源可见 / 紧急会议 / 专属发言",
      lines: {"title":2071,"body":"2071-2076","range":"2071-2076"},
      steps: ["10","day"],        // 九关① 的结构化形态（策展核定，与同块 actionStep 原文一致）
      pendingRole: [],
      gates: {
        actionStep: {"verbatim":"白天流程＋步骤 10（紧急会议）","lines":"2072"},
        seat: {"verbatim":"与窃听者同席位（4.12）","lines":"2073"},
        judgeMode: {"verbatim":"字面身份（2.8.1①）","lines":"2073"},
        damageLayer: {"verbatim":"不参与层序（非减免层、非攻击）","lines":"2073","mergedWith":"④","mergedNotationVerbatim":"③④不参与层序（非减免层、非攻击）"},
        infectLayer: {"verbatim":"不参与层序（非减免层、非攻击）","lines":"2073","mergedWith":"③","mergedNotationVerbatim":"③④不参与层序（非减免层、非攻击）"},
        visibility: {"verbatim":"会议开场公告其编号与身份（批次⑦，属 2.8.9⑥明文授予）；票源可见仅本人，依 7.1.2","lines":"2073-2075"},
        blocked: {"verbatim":"受沉默封锁（依2.8.3③，紧急会议的发动与专属发言均在总清单内）","lines":"2075"},
        exempt: {"verbatim":null,"status":"未明文（⑥仅记受封锁，无豁免或时序确认项）","lines":null},
        charges: {"verbatim":"无额度记账（会议全局 1次，属一次性资源）","lines":"2075-2076"},
        process: {"verbatim":null,"status":"未明文","lines":null},
        batchDelta: {"verbatim":"新增批次⑦","lines":"2076"},
        restatement: {"verbatim":"已标注〔适用〕","lines":"2076"},
      },
    },
    /* 4.11.6 —— 护甲（常规与速成）（artisan） */
    "artisan.armor": {
      clause: "4.11.6",
      owner: "artisan",
      mechanism: "护甲（常规与速成）",
      lines: {"title":2233,"body":"2233-2238","range":"2233-2238"},
      steps: ["3"],        // 九关① 的结构化形态（策展核定，与同块 actionStep 原文一致）
      pendingRole: ["artisan"],
      gates: {
        actionStep: {"verbatim":"步骤 3（与保镖同行动位）","lines":"2234"},
        seat: {"verbatim":"与保镖同席位（4.11）","lines":"2234-2235","citationAnomaly":"括注 4.11 为工匠自身章号，非配对方保镖所在章 4.8（歧义 A11）"},
        judgeMode: {"verbatim":"字面身份（2.8.1①）","lines":"2235"},
        damageLayer: {"verbatim":"存续类，层序依2.8.2⑥（护甲先于护盾）","lines":"2235","gateNameAbbreviated":"③伤害侧＝"},
        infectLayer: {"verbatim":"依 5.3.3第四层","lines":"2235-2236","gateNameAbbreviated":"④感染侧＝","note":"九块中唯一给出具体类内序号「第四层」的④"},
        visibility: {"verbatim":"不公开（2.8.7），持有者自知带甲、不知来源，被击破时知情、速成护甲到期消失时知情","lines":"2236"},
        blocked: {"verbatim":"受沉默封锁（2.8.3③）","lines":"2236"},
        exempt: {"verbatim":null,"status":"未明文（⑥无豁免项）","lines":null},
        charges: {"verbatim":"额度记账依 2.5（份数＝库存，库存上限 2为排除项而非额度）；铸造属进程型产出，记账依2.9","lines":"2237"},
        process: {"verbatim":"铸造属进程型产出，记账依2.9","lines":"2237","explicit29":true},
        batchDelta: {"verbatim":"不新增批次","lines":"2238","pointerTo216":false},
        restatement: {"verbatim":"已标注〔适用〕〕（4.11.2① 与①之二均标〔适用 2.9〕，未标〔例外〕）","lines":"2238"},
      },
    },
    /* 4.12.5 —— 窃听与报告（listener） */
    "listener.wiretap": {
      clause: "4.12.5",
      owner: "listener",
      mechanism: "窃听与报告",
      lines: {"title":2280,"body":"2280-2287","range":"2280-2287","trailingContamination":"2287 行末串入下一章首「五、异类阵营·异形（人物技能）异形共 3」"},
      steps: ["0.2"],        // 九关① 的结构化形态（策展核定，与同块 actionStep 原文一致）
      pendingRole: ["listener"],
      gates: {
        actionStep: {"verbatim":"步骤 0.2（明文新增行动位，并同步 2.1.1 与 2.1.6，2.8.6）","lines":"2281"},
        seat: {"verbatim":"与验票官同席位（4.12）并同步 2.1.1 与 2.1.6（2.8.6）","lines":"2281-2282","citationAnomaly":"括注 4.12 为窃听者自身章号，非配对方验票官所在章 4.9（歧义 A11）"},
        judgeMode: {"verbatim":"字面身份（2.8.1①）","lines":"2282"},
        damageLayer: {"verbatim":"不参与层序（非减免层、非攻击）","lines":"2282","mergedWith":"④","mergedNotationVerbatim":"③④不参与层序（非减免层、非攻击）"},
        infectLayer: {"verbatim":"不参与层序（非减免层、非攻击）","lines":"2282","mergedWith":"③","mergedNotationVerbatim":"③④不参与层序（非减免层、非攻击）"},
        visibility: {"verbatim":"读取结果依 2.8.7 仅本人可见；报告随批次⑪公开，属 2.8.9⑥明文授予","lines":"2282-2283"},
        blocked: {"verbatim":false,"value":"不受封锁","detail":"依 2.8.3④附，读取结算于覆盖期之前故不受封锁，属时序确认而非例外、不登记于 2.8.9","lines":"2283-2285"},
        exempt: {"verbatim":"时序确认：读取结算于覆盖期之前故不受封锁（2.8.3④附），非例外、不登记于 2.8.9","lines":"2283-2285","exemptionClass":"2.8.3④附 时序确认（非豁免）"},
        charges: {"verbatim":"读取不设组数上限（上限为该夜已公告之全部配对组），报告全局 2 次，二者独立（2.5）","lines":"2285-2286"},
        process: {"verbatim":null,"status":"未明文","lines":null},
        batchDelta: {"verbatim":"新增公告批次⑪（2.1.6）","lines":"2286"},
        restatement: {"verbatim":"已标注〔例外〕并登记入 2.8.9(16)；⑥之不受封锁部分依 2.8.3④附为时序确认，非例外，无须登记","lines":"2286-2287","dualExceptionUsage":true,"note":"⑨中两个「例外」所指不同：「登记入2.8.9(16)」指窃听报告保真性例外（2.8.9 项16，1046-1048行）；「非例外」指封锁（歧义 A12）"},
      },
    },
    /* 5.7-九 —— 结茧护盾（alien） */
    "alien.cocoon": {
      clause: "5.7-九",
      owner: "alien",
      mechanism: "结茧护盾",
      lines: {"title":2478,"body":"2478-2484","range":"2478-2484"},
      steps: ["4b"],        // 九关① 的结构化形态（策展核定，与同块 actionStep 原文一致）
      /* 更正：提取数据 coveredRoles=["xeno"] → ["alien"]。正文第 5 章为异形章；5.7 上下文 2476-2477「多只异形同夜分别选破坏与结茧时，同在 4b 内…串行结算」，故结茧属异形（alien）。提取数据标 xeno 系英文键映射推定，其自身亦声明「键名映射属代码层事项，不推定」。 */
      coveredRolesExtracted: ["xeno"],
      pendingRole: [],
      gates: {
        actionStep: {"verbatim":"步骤 4b 结茧分支（与破坏同步骤、当夜二选一，不另设行动位，2.8.6）","lines":"2479"},
        seat: {"verbatim":"不适用，不另设行动位（2.8.6）","lines":"2479-2480"},
        judgeMode: {"verbatim":"字面身份（2.8.1①），目标合法性依呈现身份计，不因真实阵营另设排除","lines":"2480"},
        damageLayer: {"verbatim":"存续类末位，依2.8.2⑥，且后于全额减免与一切时限类","lines":"2480-2481"},
        infectLayer: {"verbatim":"不参与（护盾不抵挡感染，5.3.3）","lines":"2481"},
        visibility: {"verbatim":"不公开（2.8.7），仅持有者自知带盾、不知来源，施加者不知盾被打破；施加告知属 7.2.6明文授予","lines":"2481-2483"},
        blocked: {"verbatim":"属夜间主动技能，受沉默与感染抑制封锁（2.8.3③），寂灭期仍可选（1.4.1）","lines":"2483"},
        exempt: {"verbatim":null,"status":"未明文（⑥无豁免项；「寂灭期仍可选」为可用性附注）","lines":null},
        charges: {"verbatim":"每目标同时至多 1层，属个体额度约束，被打破后可再施加；结茧占当夜全部行动（2.5）","lines":"2483-2484"},
        process: {"verbatim":null,"status":"未明文","lines":null},
        batchDelta: {"verbatim":"不新增公告批次（2.1.6）","lines":"2484"},
        restatement: {"verbatim":"已标注〔适用〕","lines":"2484"},
      },
    },
    /* 5.9⑧ —— 清洗（昼末清理阶段）（alien） */
    "alien.cleanse": {
      clause: "5.9⑧",
      owner: "alien",
      mechanism: "清洗（昼末清理阶段）",
      lines: {"title":2540,"body":"2540-2544","range":"2540-2544","trailingContent":"2544 行末含全九处清单"},
      steps: ["P-clean"],        // 九关① 的结构化形态（策展核定，与同块 actionStep 原文一致）
      /* 更正：提取数据 coveredRoles=["xeno"] → ["alien"]。正文第 5 章为异形章；2537-2538「清洗对异形队友可见，属队内共享信息」，故清洗属异形（alien）。 */
      coveredRolesExtracted: ["xeno"],
      pendingRole: [],
      gates: {
        actionStep: {"verbatim":"昼末清理阶段（独立阶段，2.8.6 明文新增并同步 2.1.1）","lines":"2540-2541"},
        seat: {"verbatim":"不适用","lines":"2541","pointerTo286":false,"note":"与 4.3.1-九／5.7-九 的「不适用，不另设行动位（2.8.6）」写法不同（歧义 B7）"},
        judgeMode: {"verbatim":"字面身份（2.8.1①）","lines":"2542"},
        damageLayer: {"verbatim":"不参与层序","lines":"2542","mergedWith":"④","mergedNotationVerbatim":"③④不参与层序","note":"九块中唯一无理由括注的合并写法（歧义 B1）"},
        infectLayer: {"verbatim":"不参与层序","lines":"2542","mergedWith":"③","mergedNotationVerbatim":"③④不参与层序","note":"同上"},
        visibility: {"verbatim":"不予通报（2.8.7；队内可见属 2.8.9⑥明文授予）","lines":"2542-2543"},
        blocked: {"verbatim":false,"value":"不受沉默封锁","detail":"依 2.8.3④附，位于覆盖期之前","lines":"2543","registrationStatementPresent":false},
        exempt: {"verbatim":"不受沉默封锁（依 2.8.3④附，位于覆盖期之前）","lines":"2543","exemptionClass":"2.8.3④附 时序确认（非豁免）"},
        charges: {"verbatim":"每夜1 次、无全局上限，依 2.5","lines":"2543"},
        process: {"verbatim":null,"status":"未明文","lines":null},
        batchDelta: {"verbatim":"不新增批次","lines":"2543","pointerTo216":false},
        restatement: {"verbatim":"已标注〔适用〕","lines":"2543-2544"},
      },
    },
    /* 6.8.7 —— 变形 / 复生（死囚局）（convict） */
    "convict.deformRevive": {
      clause: "6.8.7",
      owner: "convict",
      mechanism: "变形 / 复生（死囚局）",
      lines: {"title":2772,"body":"2772-2778","range":"2772-2778"},
      steps: ["P-id","8"],        // 九关① 的结构化形态（策展核定，与同块 actionStep 原文一致）
      pendingRole: ["convict"],
      gates: {
        actionStep: {"verbatim":"身份改变子步骤（变形）＋步骤 8（复生）","lines":"2773","multiValued":true},
        seat: {"verbatim":"与经典外星人同席位（6.8）","lines":"2773-2774"},
        judgeMode: {"verbatim":"字面身份（2.8.1①），出局判定按真实阵营（2.8.1②）；对查验的效力依2.8.1③之三","lines":"2774-2775","coversMultipleEnumValues":["presented(①)","faction(②)","check(③之三)"]},
        damageLayer: {"verbatim":"呈现异形时克隆结茧护盾，层序依 2.8.2⑥","lines":"2775","gateNameAbbreviated":"③伤害侧＝"},
        infectLayer: {"verbatim":"呈现异形时取得效果免疫，依5.3.2③（不参与层序）","lines":"2775-2776","gateNameAbbreviated":"④感染侧＝","note":"引 5.3.2③ 而非 5.3.3"},
        visibility: {"verbatim":"不公开（2.8.7）；复生留痕随批次⑥公开次数、不公开编号","lines":"2776","hazard":"「批次⑥」中的 ⑥ 是公告批次号，与紧随其后的九关⑥（封锁）同形（歧义 A9）"},
        blocked: {"verbatim":"变形不受沉默封锁（依 2.8.3④附，位于覆盖期之前；且死囚局无沉默源，6.8.6①）；复生受封锁（2.8.3③总清单内）","lines":"2776-2777","splitWithinBlock":true},
        exempt: {"verbatim":"变形不受沉默封锁（依 2.8.3④附，位于覆盖期之前）","lines":"2776-2777","exemptionClass":"2.8.3④附 时序确认（非豁免）","registrationStatementPresent":false},
        charges: {"verbatim":"额度记账依 2.8.5镜像账本（被动累积、主动不代执行）","lines":"2777-2778"},
        process: {"verbatim":null,"status":"未明文","lines":null},
        batchDelta: {"verbatim":"不新增批次（复生并入⑥）","lines":"2778","pointerTo216":false},
        restatement: {"verbatim":"已标注〔适用〕∕〔例外〕见2.8.9⑨⑩","lines":"2778","suffixIs289ItemNumbers":true,"suffixNote":"「⑨⑩」指 2.8.9 的项 ⑨（1021-1023，6.8.3⑧ 克隆不含社交与队内共享）与项 ⑩（1024-1026，6.8.6② 死囚局无停转夜），非九关的第十关（歧义 A10）"},
      },
    },
    /* 7.3.8 —— 乔装（通则 7.3）（alien + xeno） */
    "disguise.global": {
      clause: "7.3.8",
      owner: ["alien","xeno"],
      mechanism: "乔装（通则 7.3）",
      lines: {"title":3085,"body":"3085-3089","range":"3085-3089","trailingContent":"3089 行末与「附录一术语表」标题同处一行"},
      steps: ["1"],        // 九关① 的结构化形态（策展核定，与同块 actionStep 原文一致）
      pendingRole: [],
      gates: {
        actionStep: {"verbatim":"步骤 1（不占行动窗口）","lines":"3086"},
        seat: {"verbatim":"不适用","lines":"3086","pointerTo286":false},
        judgeMode: {"verbatim":"依 2.8.1③之三（唯一权威源，乔装仅改查证呈现身份）","lines":"3086","enumValueImplied":"check","note":"本块②的取值属「查证呈现身份」态，与其余块「字面身份（2.8.1①）」不属同一枚举层级（歧义 B8）"},
        damageLayer: {"verbatim":"不参与层序（非减免层）","lines":"3086-3087","mergedWith":"④","mergedNotationVerbatim":"③④不参与层序（非减免层）"},
        infectLayer: {"verbatim":"不参与层序（非减免层）","lines":"3086-3087","mergedWith":"③","mergedNotationVerbatim":"③④不参与层序（非减免层）","note":"括注「非减免层」系③的理由，对④而言未另作说明"},
        visibility: {"verbatim":"不公开（2.8.7）；异形队内互见、外星人仅本人可见，属 2.8.9⑥明文授予","lines":"3087-3088"},
        blocked: {"verbatim":"受沉默封锁（依2.8.3③，已在总清单内）","lines":"3088"},
        exempt: {"verbatim":null,"status":"未明文（⑥无豁免项）","lines":null},
        charges: {"verbatim":"全局 2 次∕个体，不占行动窗口，依 2.5 与 2.8.5","lines":"3088-3089"},
        process: {"verbatim":null,"status":"未明文","lines":null},
        batchDelta: {"verbatim":"不新增批次","lines":"3089","pointerTo216":false},
        restatement: {"verbatim":"已标注〔适用〕","lines":"3089"},
      },
    },
  };

  /* ---------- 提取阶段的元信息与冲突清单（供审核与断言引用） ---------- */
  const META = {
    sourceLines: 3489,
    blockCount: 10,
    gateCount: 10,
    blockCountNote: '正文 5.9⑧ (2544) 自述共九处并列举 9 条，漏列 4.6.4（毒师）块 → 实为 10 块',
    gateCountNote: '2.8.10 (1060-1066) 含 ①+①之二+②~⑨ 共 10 字段；2.8.9 称第⑨关为「2.8.10第九关」，序号口径不可对齐',
    cheatsheetColumns: ['职业', '核心能力', '关键额度', '暴露风险∕定位'],
    cheatsheetSixRowStructureAbsent: true,
    cheatsheetNote: '改动清单 609 行所称六行结构在正文附录二无对应物；速查卡不含封锁列/判定基准列',
    cheatsheetMissingRoles: ['hunter', 'poisoner'],
    cheatsheetConflicts: [
      { id: 'D1', role: '警长', appendixTwo: { lines: '3305-3306', verbatim: '存储上限 2发（仅约束 4.4.3额外子弹；悬赏回复守恒不增量）' }, body: { lines: ['1642', '1646-1648'], verbatim: '警长的子弹存量设上限 2 发：任何来源的子弹（初始 1 发、4.4.3 的额外子弹、4.4.2 的悬赏回复）到账后，存量一律不得超过2发' }, nature: '实质冲突：上限约束对象（仅额外子弹 vs 任何来源/约束存量）' },
      { id: 'D3', role: '工程师', appendixTwo: { lines: '3291-3292', verbatim: '每夜维修−1.0~1.5（自选，步长0.1）（倒计时与净破坏量各1.0）' }, body: { lines: ['1536', '1537'], verbatim: '维修量：每夜−1.0~1.5（自选，步长 0.1，共 6 档）……①倒计时−（当夜实际结算值）；②净破坏量−（同值）' }, nature: '括注冲突：「各1.0」与「自选值/实际结算值」不一致' },
      { id: 'D14', role: '神探', appendixTwo: { lines: '3315', verbatim: '恒真查验' }, body: { lines: '1957', verbatim: '结论可能不成立' }, nature: '实质冲突：速查卡称恒真、正文称结论可能不成立' },
    ],
    pendingVerification: [
      { item: '外星人夜晚免疫全局 2 次', appendixTwo: '3369', body: '2614 起（6.4，无九关核验块）', status: '未判定：无九关块可交叉验证' },
      { item: '异形感染 2 名（感染进化 3 名）', appendixTwo: '3365-3366', body: '2304 起（5.3，无九关核验块）', status: '未判定：无九关块可交叉验证' },
    ],
    seatPointerMirrorBug: '4.11.6 写「与保镖同席位（4.11）」、4.12.5 写「与验票官同席位（4.12）」，括注指向自身章号；4.9.7 写「与窃听者同席位（4.12）」指向配对方 → 同一写法语义不一致，不可直接作配对席位出处',
  };

  /* ---------- 更正记录（数据保真链：正文 → 提取 → 本表） ---------- */
  const CORRECTIONS = {
    "5.7-九": { field: "coveredRoles", from: ["xeno"], to: ["alien"],
      reason: "正文第 5 章为异形章；5.7 上下文 2476-2477「多只异形同夜分别选破坏与结茧时，同在 4b 内…串行结算」，故结茧属异形（alien）。提取数据标 xeno 系英文键映射推定，其自身亦声明「键名映射属代码层事项，不推定」。" },
    "5.9⑧": { field: "coveredRoles", from: ["xeno"], to: ["alien"],
      reason: "正文第 5 章为异形章；2537-2538「清洗对异形队友可见，属队内共享信息」，故清洗属异形（alien）。" },
  };

  /* 步骤键 → 正文中的书写形态（用于「策展的 steps 必须能在同块 actionStep 原文里找到」的核对） */
  const STEP_TEXT = {
    '3': ['步骤3', '步骤 3'], '3.5': ['步骤 3.5'], '4b': ['步骤 4b'], '6': ['步骤6', '步骤 6'],
    '8': ['步骤 8'], '10': ['步骤 10'], '0.2': ['步骤 0.2'], 'day': ['白天流程'],
    'P-clean': ['昼末清理阶段'], 'P-id': ['身份改变子步骤'], '1': ['步骤 1'], '0.1': ['步骤 0.1'],
    '2': ['步骤 2'], '4a': ['步骤 4a'], '7': ['步骤 7'], '0.55': ['步骤 0.55'], '11': ['步骤 11'],
  };

  /* ---------- 查询与自检 ---------- */
  const keys = () => Object.keys(MECHANISMS);
  const get = key => MECHANISMS[key] || null;
  /** 某角色声明了哪些机制（owner 为数组者亦命中） */
  function ofRole(roleKey) {
    return keys().filter(k => {
      const o = MECHANISMS[k].owner;
      return Array.isArray(o) ? o.indexOf(roleKey) >= 0 : o === roleKey;
    });
  }
  /** 抽取某关的全部取值（供推导层批量消费，如全机制的行动位集合） */
  function gate(g) {
    const out = {};
    for (const k of keys()) out[k] = MECHANISMS[k].gates[g];
    return out;
  }
  /** C5 倒排：某行动位上声明的全部机制键（机制 → 行动位 的逆向查询） */
  function mechanismsAt(step) {
    return keys().filter(k => (MECHANISMS[k].steps || []).indexOf(step) >= 0);
  }
  /** 全部被声明的行动位（去重，按首次出现序） */
  function allSteps() {
    const seen = [];
    for (const k of keys()) for (const s of (MECHANISMS[k].steps || [])) if (seen.indexOf(s) < 0) seen.push(s);
    return seen;
  }
  /** 自检：返回违规清单（空数组＝合规） */
  function audit() {
    const bad = [];
    for (const k of keys()) {
      const m = MECHANISMS[k];
      /* 1. 十关必须齐备（正文十块每关均有明文，故不允许缺槽） */
      for (const g of Object.keys(GATE_SCHEMA))
        if (!m.gates || !Object.prototype.hasOwnProperty.call(m.gates, g)) bad.push(k + ": 缺关 " + g);
      /* 2. 每条须可溯源：条款号 + 行号 */
      if (!m.clause) bad.push(k + ": 缺条款号");
      if (!m.lines) bad.push(k + ": 缺行号");
      /* 3. owner 必须非空（键即身份，D4） */
      const owners = Array.isArray(m.owner) ? m.owner : [m.owner];
      if (!owners.length || owners.some(o => !o)) bad.push(k + ": owner 缺失");
      /* 4. 机制键不得含纯编号段（D4：去编号，键即身份） */
      if (/(^|[.:_-])[RE]?\d+(\.\d+)?$/.test(k) || /^[RE]\d+$/.test(k)) bad.push(k + ": 键名含编号（违反 D4）");
      /* 5. 结构化 steps 必须非空，且每个步骤键都能在同块 actionStep 原文里找到（策展 × 正文核对） */
      if (!Array.isArray(m.steps) || !m.steps.length) bad.push(k + ": 缺结构化 steps");
      else {
        const verbatim = (m.gates && m.gates.actionStep && m.gates.actionStep.verbatim) || "";
        for (const s of m.steps) {
          const forms = STEP_TEXT[s];
          if (!forms) { bad.push(k + ": 未登记的步骤键 " + s); continue; }
          if (!forms.some(f => verbatim.indexOf(f) >= 0))
            bad.push(k + ": steps 含 " + s + "，但 actionStep 原文里找不到对应书写（" + forms.join("/") + "）");
        }
      }
    }
    /* 5. 条数不得**少于**转录条数（防有人删掉转录条目）；允许更多——K1：按声明新增机制是合法增长，
          本项曾在 H3 验收中被抓出「禁止新增」的设计冲突，故由「必须等于」改为「不得少于」。 */
    if (keys().length < META.blockCount) bad.push("机制条数 " + keys().length + " 少于转录条数 " + META.blockCount + "（转录条目被删？）");
    return bad;
  }

  global.SKCapability = { GATE_SCHEMA, MECHANISMS, META, CORRECTIONS, STEP_TEXT, keys, get, ofRole, gate, mechanismsAt, allSteps, audit };
})(typeof window !== 'undefined' ? window : globalThis);
