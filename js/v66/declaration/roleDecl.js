/* =============================================================
 * 太空杀 · 角色声明表 RoleDecl（v6.6 重构 C2 / 阶段 2 声明层）
 *
 * 性质：纯数据 + 纯函数。**声明层是唯一真相源**——角色属性只在此声明一次，
 *       其余（查证池、组位、注意力权重、能力分发表、可见性）全部由此推导，
 *       以满足 K1「角色集合开放」：加角色只改本文件，其余文件 diff 为空。
 *
 * 规则依据（v6.6 正文，唯一权威源）：
 *   · 附录 C（清单 v1.1）＝ 2.8.10 九关 × RoleDecl 字段映射（本文件 SCHEMA 逐关对应）
 *   · 2.8.10 接入检查（九关）—— ①行动位｜①之二席位｜②判定基准｜③伤害侧层序｜
 *            ④感染侧层序｜⑤可见性｜⑥封锁｜⑦额度记账｜⑧公告批次｜⑨重复阐述
 *   · 2.8.14 组位通则 —— 组位依职能划归、依真实身份判定、单归取主职能、不推定能力；
 *            异形与外星人不设组位（⑤）；组位表（本文件 GROUP_TABLE 逐项转录）
 *   · 2.8.15 自指原则 —— 致死/感染类技能对自身默认合法，明文排除除外
 *   · 2.9 资源生产通则 —— 进程型产出（投入 N 夜 / 可中断 / 完成时定产物 / 次夜到账）
 *   · 4.1.1① —— 普通船员查证池＝开局公告之人类职业（＝本文件 baseHumanRoles()）
 *   · 2.1.6 / 附录 A —— 公告批次与步骤窗（事件族名见 js/v66/contract/eventFamily.js）
 *
 * 降级运行（D3，K1 第三层验收）：未声明 spec 的角色用 DEFAULTS 跑完整局，不报错、
 *   不静默失效——默认只可见公开信息、默认注意力 1.0、默认无能力。断言见 tests。
 * ============================================================= */
(function (global) {
  /* ---------- 附录 C：九关 × RoleDecl 字段映射（字段名即契约） ----------
   * 【第二十四批 · 模块化标准化】每个字段新增 life（生命周期）标注——此前声明层只声明
   * 「有什么字段」，没有声明「这个字段有没有人用」，于是出现两种静默漂移：
   *   ① 零消费的字段看起来像已接线（实测 5 个：exempt/batchDelta/restatement/selfTarget
   *      与 visibility.selfOnly，全仓 0 读取点）；
   *   ② 有消费点的字段若被误当闲置清理，会直接打断对局。
   * life 三值：
   *   wired    —— 有运行时消费点，改动会影响对局行为
   *   archived —— 合规/审计留痕，运行时**零消费**（九关核验的合规记录，非死代码）
   *   pending  —— 声明已就位、等机制上线后接线（如 A6 五变体相关）
   * 纪律：archived 的字段若将来真的有了消费点，**必须**改回 wired 并在 desc 注明消费方；
   *      否则「闲置」会被误读成「已接线」，这类漂移最难查（audit 强制 life 合法且互斥）。 */
  const LIFE = ['wired', 'archived', 'pending'];
  const SCHEMA = {
    faction:     { gate: '[阵营]',   life: 'wired',    desc: '真实阵营键，取自 SKData.FACTION' },
    group:       { gate: '[2.8.14]', life: 'wired',    desc: '组位键，单归取主职能；异形/外星人为 null（⑤）' },
    isBase:      { gate: '[4.1.1①]', life: 'wired',   desc: '是否初始职业（转职系为 false）——D1 查证池由此推导' },
    seat:        { gate: '①之二',    life: 'wired',    desc: '席位归属（1.1.1）；不占席位填 null' },
    actionStep:  { gate: '①',        life: 'wired',    desc: '**主**行动位归属（2.8.6 / 图 2）：步骤名或前置阶段名' },
    actionSteps: { gate: '①',        life: 'wired',    desc: '全部行动位（多行动位角色；缺省＝[actionStep]）。主行动位供引擎派发过滤，全列表供覆盖审计与 C1 收口' },
    judgeMode:   { gate: '②',        life: 'wired',    desc: '判定基准（2.8.1）：check | presented | faction' },
    damageLayer: { gate: '③',        life: 'wired',    desc: '伤害侧层序（2.8.2）：{cls,ord} 或 null＝不参与' },
    infectLayer: { gate: '④',        life: 'wired',    desc: '感染侧层序（5.3.3）：同上；抗体为感染侧专属时限类' },
    visibility:  { gate: '⑤',        life: 'wired',    desc: '可见性授予（2.8.7）：{batch:[批次], private:[私反馈族], selfOnly:bool}。batch/private 有消费点；**selfOnly 子键 archived**（九关留痕，运行时以各路径配置为准，见 revealService.PATHS）' },
    blocked:     { gate: '⑥',        life: 'wired',    desc: '是否受封锁（2.8.3 总清单）' },
    exempt:      { gate: '⑥',        life: 'archived', desc: '明文豁免项（2.8.3 附：明文豁免仅指该动作本身可主动选择行使）。**零消费**：运行时封锁判定走 blocked + canAct；本字段是 2.8.3⑥ 的合规留痕' },
    charges:     { gate: '⑦',        life: 'wired',    desc: '额度记账（2.5）：{键:次数}，Infinity 表「每夜不限」' },
    process:     { gate: '⑦',        life: 'archived', desc: '进程形态（2.9）。**零消费**：进程由 processRegistry 独立声明（SKProcess），本字段是 2.9⑦ 在角色侧的对应留痕；A6 实装时以 processRegistry 为唯一真源' },
    batchDelta:  { gate: '⑧',        life: 'archived', desc: '相对默认「编号+呈现身份」的公告批次差量（2.8.12③ 仅五处）。**零消费**：实际差量由 revealService.PATHS 逐路径配置，本字段是 2.8.12③ 的合规留痕' },
    restatement: { gate: '⑨',        life: 'archived', desc: '重复阐述（§0.4）：重申 | 适用 | 例外。**零消费**：复读三分法是正文裁决工具，运行时不据此分支' },
    selfTarget:  { gate: '[2.8.15]', life: 'archived', desc: '自指：默认 true；专门条款明文排除者 false。**零消费**：自指已在目标池构造时默认含自身（formPlayers 的 alive/all），本字段是 2.8.15 的合规留痕' },
    attend:      { gate: '[D7/K2]',  life: 'wired',    desc: '注意力权重表：缺失即 1.0（不是 undefined）' },
    attendAway:  { gate: '[批次34]',  life: 'wired',    desc: '非主业族的注意力衰减（<1）：低于 attendFloor 者不进账——注意力「选择化」的载体' },
    grants:      { gate: '[D6/K1]',  life: 'wired',    desc: '能力标签（能力分发表的键）：调用点问「谁能做这件事」，不问「你是不是某个职业」' },
    capClass:    { gate: '[D6]',     life: 'wired',    desc: '能力档（危险度 Dg 的能力项系数档）：high|mid|low，缺失即 base' },
    seats:       { gate: '[D8]',     life: 'wired',    desc: '阵营席位常数（非人类阵营的开局名额；人类席位由组位表给出）' },
    repairExposeAt: { gate: '[4.3.6]', life: 'wired', desc: '累计维修暴露阈值（工程师 4.0 / 助理 3.0）；缺失即不适用。经 repairExposeAtOf() 读取（steps.js 结算 / ui.js 进度条）' },
    /* 〔v7 · 速查卡定制〕AI 职责面：三张卡内字段，是 AI 决策的直接依据。
       动机：速查卡对每个角色都明写了三件「规则面」的事，而声明层此前无法表达它们——
         mutex  当夜互斥（「治疗／自救／制药三者互斥」）。引擎虽各自实现，但**声明层不表达**
               ⇒ AI 无从知道同夜不可连做，只能靠 form 里的分支偶然规避。
         senses 可主动查知项（「可见谁带有感染标记」「可见全部票源编号」…）。
               与 visibility（公告批次／私反馈族）是两件事：visibility 是「规则授予的被动可见」，
               senses 是「该角色专属的主动情报面」。
         cost   明文代价与陷阱（「神探每查验一人即暴露场上有神探在活动」）。
               这是 AI 权衡的依据：卡片把代价写在正文里，AI 此前完全看不到。
       词表见 DUTY_ACTION / DUTY_SENSE / DUTY_COST，audit() 强制取值合法。 */
    duty:       { gate: '[速查卡]', life: 'wired', desc: 'AI 职责面：{mutex:[当夜互斥动作], senses:[可主动查知项], cost:明文代价键|null}；缺失即该角色无互斥/无专属情报面/无明文代价' },
  };
  /* 角色声明里 schema 之外的字段（同样须标 lifecycle，否则视为未声明语义） */
  const EXTRA_FIELDS = {
    name:     { life: 'wired',    desc: '中文名（UI 展示）' },
    desc:     { life: 'wired',    desc: '职业说明（UI 展示）' },
    source:   { life: 'archived', desc: '规则出处标注。**零消费**：仅供人读与审计追溯' },
    pending:  { life: 'archived', desc: '⚠ **与对局状态 g.pending（待决策席位）同名但完全无关**。本字段语义＝「该角色的九关能力尚未全部实装」。全仓零消费——引擎用的是 g.pending；保留它会让人误以为 g.pending 由此驱动' },
  };

  /* ---------- D3 缺省值：未声明/未登记字段的降级口径 ---------- */
  const DEFAULTS = {
    faction: 'human', group: null, isBase: false, seat: null, actionStep: null, actionSteps: null,
    judgeMode: 'presented', damageLayer: null, infectLayer: null,
    visibility: { batch: [], private: [], selfOnly: false },
    blocked: false, exempt: [], charges: {}, process: null,
    batchDelta: [], restatement: null, selfTarget: true, attend: {},
    grants: [], capClass: null, seats: 0, repairExposeAt: null,
    duty: { mutex: [], senses: [], cost: null },
  };

  /* ---------- 〔v7 · 速查卡〕AI 职责面词表 ----------
     duty.mutex 的取值＝「当夜动作身份」，不是内部字段名。取自速查卡各角色「夜间行动」行的
     「X 选一」表述。审计只校验落在本词表内（不校验与该角色 charges/grants 的对应关系：
     医生族的 brew 是 grant 而非 charge，两套命名空间本就不同）。 */
  const DUTY_ACTION = {
    verify: '查验', assistRepair: '协助维修', transfer: '转职',
    repair: '维修', extraRepair: '追加维修', safeRoom: '安全室',
    shoot: '开枪', patrol: '巡逻', gatherAmmo: '攒弹', sniff: '嗅探',
    treat: '治疗', selfSave: '自救', brew: '制药', save: '救援',
    poison: '毒药', antidote: '解药',
    cast: '常规铸造', castFast: '速成铸造', distribute: '分配护甲', protect: '保护',
    announce: '发布官方公告', report: '窃听报告', publish: '原样公示', meeting: '紧急会议',
    kill: '出刀', infect: '感染', destroy: '破坏', cocoon: '结茧', disguise: '乔装',
    lurk: '蛰伏', selfHeal: '自我治疗', morph: '变形', revive: '复生', wiretap: '窃听读取',
  };
  /* duty.senses ＝ 角色专属的主动情报面（速查卡「可见性」行逐条转录）。
     与 visibility（规则授予的公告批次／私反馈族）分列：前者是「我这张牌能查到什么」。 */
  const DUTY_SENSE = {
    selfClaimLog: '本角色对该目标的历次查证问题与结论（仅自己）',
    repairAssistN: '当夜协助维修的人数 N（不附编号）',
    ownRepairTotal: '本人累计维修量',
    ownExposeRemain: '距暴露阈值剩余量与「已暴露」状态',
    ownAmmo: '本人子弹余量',
    armedCrewIds: '武装船员编号（与警长双向识别）',
    sniffResult: '嗅探结果：目标是否呈现保护状态（不区分种类、不报层数与来源）',
    infectMarks: '谁带有感染标记（仅编号，不显真伪／施加时间／剩余致死夜数）',
    antibodyFeedback: '抗体生效反馈（不含编号与真伪）',
    dyingList: '谁处于濒死',
    deathSourceAfterSave: '落身致死来源清单（仅在实际消耗救援额度后才可见）',
    poisonList: '全场毒药清单（仅毒师本人）',
    selfPoisoned: '自身是否带毒药标记',
    checkPool: '已查验池：查验当夜所显示的职业（不随此后转职更新；死亡即作废）',
    presentedRoleOnly: '查验恒依呈现职业如实作答、不报阵营',
    guardFeedback: '自己今夜被保护了',
    attackTypeOnGuard: '受袭感知：被保护时获知伤害类型（不报凶手编号）',
    ownArmorStock: '本人护甲库存与已分配情况',
    allVoteSources: '全部票源编号（白天）',
    allBallotCounts: '公开票源图（全局 1 次）',
    pairedPrivateChats: '当夜批次①已公告配对组的私聊正文（可读全部分组）',
    teammateIdentities: '队友身份',
    teammateBallots: '本方队友票型分布',
    ownNightImmuneRemain: '夜晚免疫剩余次数与已发生的消耗路径',
    lurkTargetPresented: '蛰伏查验所得：目标的呈现职业（并可附加沉默）',
    mirrorLedger: '镜像账本（呈现身份并行结算）',
    morphTargetPool: '变形目标池（本局实际在场的人类职业或异形）',
  };
  /* duty.cost ＝ 速查卡明写的代价与陷阱。这是 AI 权衡的另一半：
     收益（能做什么）已由 charges/grants 表达，代价此前完全没有表达。 */
  const DUTY_COST = {
    canHitFriendlies: '枪击可命中任何存活角色，含人类队友与自身（误伤／自杀）',
    sniffMissesSafeRoom: '嗅探不显示全额减免（安全室／夜晚免疫）⇒「未呈现保护」≠「可一击致死」',
    canSaveAnyone: '救援可救任意濒死者，不限阵营（含自身、异形、外星人）⇒ 救敌是合法选项',
    poisonHitsAlly: '毒药不辨阵营，队友与自身皆为合法目标；误伤无第三方补救，容错为零',
    checkRevealsSelf: '被查验者会收到来源类别为「神探」的私人反馈 ⇒ 每查验一人即向该目标暴露场上唯一的神探神探',
    meetingRevealsSelf: '紧急会议开场即公告其编号与身份（批次⑦）⇒ 发动即暴露身份',
    reportNotFaithful: '窃听报告可自由改写、系统不校正，且附「不保真」标注 ⇒ 引用它需自担可信度',
    noAttackFeedback: '工匠护甲不公开而持有者自知、无受袭感知',
  };

  /* ---------- D6 能力标签词表（能力分发表的键空间）----------
     调用点只问「谁能做这件事」（rolesWith / hasGrant），不问「你是不是某个职业」——
     这是「漏一处 = 该角色没能力」这类框死点的结构性修法（清单 D6）。
     纪律：① 只登记**当前有消费点**的标签（避免又造一套死声明）；
           ② 标签名不得与任何角色键或阵营键同名（D5 命名空间，audit 强制）——
              故救援用 `save` 而非 `rescue`（后者已是角色键）。 */
  const GRANT_VOCAB = {
    treat:       '治疗 / 清感染 / 持有感染标记记忆（4.5）',
    /* 〔批次 31〕制药：医生族通有（3.3.1 药剂进程），生化医师/救援医师/临时医生/毒师
       皆可投入。与 treat 分列——制药是**生产**（进程型产出、2.9）而非即时清除（治疗）。 */
    /* 【注】上面「医生职���族通有」一句的中间有 3 个字符丢失且无法确证原文（可能是「职业」也可能是「职能」），故重写为「医生族通有」并不臆造具体字；与卡里的「医生族通有制药」一致。 */
    brew:        '制药·药剂生产（3.3.1；医生族通有，含毒师，进程型产出 2.9⑧不新增批次）',
    repair:      '维修 / 协助维修（4.3 / 4.1.2①；含累计维修暴露口径）',
    extraRepair: '追加维修（4.3.3；工程师独属，合计上限 −3.0）',
    safeRoom:    '限定技·安全室（4.3.1）',
    protect:     '保护类（4.8 保镖保护；4.11 工匠护甲同行动位）',
    shoot:       '枪击 / 悬赏回复（4.4.6；警长与武装）',
    save:        '救援濒死者 / 持有濒死名单（4.5；救援医师与临时医生）',
    transfer:    '可转职（4.2.1①；普通船员）',
    /* 〔批次 29 A6〕猎手嗅探与窃听者窃听——两个标签均**不进 dangerOf 的能力档**：
       sniff/wiretap 不构成任何攻防或信息优势（嗅探只是保护状态的存在性查询、窃听只读
       当夜私聊），故 CAP 三档与 dangerOf capability 项对两角色恒回落 base（0.15），
       与迁移前「未声明 ⇒ base」的旧行为逐项相等。登记于词表是为让九关 audit 与
       grants 消费点有据可依，不代表它们是「能力标签类」效用项。 */
    sniff:       '嗅探·保护状态查询（4.4.8；猎手专属，不计入危险度能力档）',
    wiretap:     '窃听·读取配对私聊（4.12.1；窃听者专属，不计入危险度能力档）',
    /* 〔批次 31〕工匠与毒师的能力标签。craft 含铸造/分配/护甲三层（均为存量或进程型产出，
       不构成攻防优势）；poison 含下毒/解药（信息优势为主：毒师可见全场毒药清单，但下毒与
       解药各只有 3 次、可被识破）。二者**均不进 dangerOf 的能力档**——毒师的威胁来自
       有限额度的精确操作而非持续压制，与既有三档语义不同。 */
    craft:       '护甲·铸造/分配（4.11；工匠专属，不计入危险度能力档）',
    poison:      '毒药/解药（4.6.4；毒师专属，不计入危险度能力档）',
    /* 〔批次 32〕死囚的两项能力。morph ＝ 转移操作权（镜像账本并行，2.8.5），revive ＝ 抢救
       （步骤 8 同医生窗口，全局 2 次）。二者**均不进 dangerOf 能力档**——死囚的威胁来自
       「随时可能变成任一职业」这一**信息不确定性**，而非某项持续压制能力；
       恒定档位会把它算成一个可预测的高威胁角色，与设计意图相反。 */
    morph:       '变形·转移操作权（6.8.3；死囚专属，不计入危险度能力档）',
    revive:      '复生·抢救濒死者（6.8.4；死囚专属，全局 2 次，不计入危险度能力档）',
  };

  /* ---------- 2.8.14 组位表（逐项转录；capacity=null 表「随转职变动」） ----------
     members ＝ 规则上可归属该组位的全部职业（含 v6.6 新增、尚未实装者）；
     seats   ＝ 本局开局席位的实际组成（A3：组位表驱动 HUMAN_SETUP，逐项与 2.8.14 一致）；
     seatOrder ＝ 席位装配顺序（保持与历史 HUMAN_SETUP 字面量同序，避免扰动同种子读数）。 */
  const GROUP_TABLE = {
    'base':      { name: '基础位',       members: ['crew'],                       seats: ['crew', 'crew', 'crew', 'crew'], capacity: 4,    seatOrder: 0, rule: '2.8.14' },
    'engineer':  { name: '工程位',       members: ['engineer'],                   seats: ['engineer'],                     capacity: 1,    seatOrder: 1, rule: '2.8.14' },
    'hunt':      { name: '猎杀位',       members: ['sheriff', 'hunter'],          seats: ['sheriff'],                      capacity: 1,    seatOrder: 2, rule: '2.8.14' },
    'doctor':    { name: '医生位',       members: ['bio', 'rescue', 'poisoner'],  seats: ['bio', 'rescue'],                capacity: 2,    seatOrder: 3, rule: '2.8.14' },
    'verify':    { name: '查证位',       members: ['detective'],                  seats: ['detective'],                    capacity: 1,    seatOrder: 4, rule: '2.8.14' },
    'defense':   { name: '防御位',       members: ['bodyguard', 'artisan'],       seats: ['bodyguard'],                    capacity: 1,    seatOrder: 5, rule: '2.8.14' },
    'social':    { name: '社交位',       members: ['inspector', 'listener'],      seats: ['inspector'],                    capacity: 1,    seatOrder: 6, rule: '2.8.14' },
    'base:eng':  { name: '基础位·工程',  members: ['assistant'],                  seats: [],                               capacity: null, seatOrder: null, rule: '2.8.14②⑥' },
    'base:arms': { name: '基础位·武装',  members: ['armed'],                      seats: [],                               capacity: null, seatOrder: null, rule: '2.8.14②⑥' },
    'base:doc':  { name: '基础位·医生',  members: ['tempdoc'],                    seats: [],                               capacity: null, seatOrder: null, rule: '2.8.14②⑥' },
  };
  /* 转职分支（2.8.14②：转职为真实职业变化，组位随之变更，形态属基础位之三分支） */
  const TRANSFER_BRANCHES = ['base:eng', 'base:arms', 'base:doc'];

  /* ---------- 角色可选性门槛（自选身份面板的唯一数据源） ----------
     自选身份面板（首页单机区）需要「哪些角色可选 / 哪些置灰」的判据。按声明层纪律，
     门槛必须在这里声明一次，UI 只读不判 —— 与 faction/group/seats 同一套规矩。

     取值 null ＝ 无门槛（当前全部角色均可选）。将来要加养成门槛，只改本表，
     UI 与 state.js 零改动。形状：{ wins: 累计获胜场次下限 }。

     ⚠ 与 2.3.0②附二 的边界：本表只能**限制玩家能选哪个已有角色**，
       绝不能用来增删席位 —— 「人类 11 / 玩家 15」是结构常量（1.1）。 */
  const ROLE_UNLOCK = {
    crew: null, engineer: null, detective: null, sheriff: null, hunter: null,
    bio: null, rescue: null, poisoner: null, bodyguard: null, artisan: null,
    inspector: null, listener: null,
    alien: null, xeno: null, convict: null,
    /* 转职系（assistant / armed / tempdoc）不在席位表内，恒不可直接选 ——
       它们只能经 0.6 转职获得（4.2.1）。此处显式标注，避免 UI 误列为可选。 */
    assistant: { transferOnly: true }, armed: { transferOnly: true }, tempdoc: { transferOnly: true },
  };
  /** 某角色的可选性门槛；未声明者按「无门槛」处理（加角色不必改这里） */
  function unlockOf(key) {
    if (!has(key)) return null;
    return Object.prototype.hasOwnProperty.call(ROLE_UNLOCK, key) ? ROLE_UNLOCK[key] : null;
  }
  /** 是否可由玩家在开局界面直接选择（转职系与被门槛锁住的角色不可） */
  function selectable(key) {
    const u = unlockOf(key);
    return !u || u.transferOnly !== true;
  }

  /* ---------- 角色声明表（13 个已实装角色） ----------
     说明：本表 faction/group/isBase/seat/actionStep/judgeMode/charges/process/
     blocked/visibility 等字段的取值来源逐条标注；尚未逐条核对完九关的字段以
     `pending: true` 标注，由后续转录批次补全（不填猜测值）。 */
  const ROLE_DECL = {
    crew: {
      name: '普通船员', faction: 'human', group: 'base', isBase: true,
      desc: '每夜「查验」或「协助维修」二选一；存活≤6 或第 6 夜起可转职。',
      grants: ['transfer'],
      attend: { infra: 1.15, verify: 1.1 },                      // D7：自 tiers.js ATTEND.focus 迁入
      attendAway: { lethal: 0.7, infect: 0.7 },
      actionStep: '2', actionSteps: ['2', '4a', '0.6'],   // 2 查验；4a 协助维修（卡载独立窗口，与 2 当夜互斥，见下方备注）；0.6 转职（4.2.1①）
      judgeMode: 'check',                                         // 4.1.1 船员查证＝check 模式（唯一可被乔装欺骗）
      /* 【v7 裁定② · 2026-10-08】协助维修落位已对齐卡序：拆成独立窗口步骤 4a。
         初版实现把它折进步骤 2 的 crewAction 菜单（前缀式 opt 'repair'+a），
         二选一靠「同一张菜单」隐式成立，落位差异曾登记为 informational。
         现按裁定拆出：步骤 2 只开查验（kind='crewAction'），步骤 4a 开协助维修窗口
         （kind='crewRepair'，7 档 a∈[0.20,0.50] 步长 0.05，与卡载逐档相符）。
         互斥现为真互斥：步骤 2 真查验者写 p.branch=「check」，被 4a 的 !p.branch 过滤掉。
         ⚠ 三路效用比较（uCheck / uRepair / 不做）**仍留在步骤 2**不动，
           使行动组合与改动前逐字一致，变的只是「行动在哪一步花掉」；
           若改成两步各自重新决策，uCheck 与 uRepair 不再互相比较，会系统性偏向查验 ——
           属策略权重的系统性偏移，超出本批授权，未做。 */
      charges: { verify: Infinity, assistRepair: Infinity },   // assistRepair 已实装（独立窗口 4a，kind='crewRepair'，7 档 assist+value opt）
      visibility: { batch: ['③'], private: ['7.2.1'], selfOnly: false },
      /* 【v7 裁定②】卡：「步骤 2 查验 ｜ 步骤 4a 协助维修（二者当夜二选一，亦可依 2.4 放弃行动）」。assistRepair 已实装且落位已对齐（独立窗口 4a，kind='crewRepair'）——此前此处写「未实装」是第三轮对账时基于标识符检索的误判，早已更正。 */
      duty: { mutex: ['verify', 'assistRepair'],
              senses: ['selfClaimLog', 'repairAssistN'],
              cost: null },
      source: '4.1.1/4.1.2',
    },
    engineer: {
      name: '工程师', faction: 'human', group: 'engineer', isBase: true,
      desc: '每夜维修 −1.0~1.5 自选；追加维修 −1.0~1.5（全局 3 次）；限定技「安全室」（全局 1 次）。',
      grants: ['repair', 'extraRepair', 'safeRoom'], capClass: 'low', repairExposeAt: 4,
      actionSteps: ['4a', '3'],   // 4a 维修；3 限定技安全室（4.3.1）
      attend: { infra: 1.3 },
      attendAway: { lethal: 0.7, infect: 0.7, ballot: 0.75 },
      actionStep: '4a', charges: { repair: Infinity, repairExtra: 3, safeRoom: 1 },
      visibility: { batch: ['④'], private: [], selfOnly: false },
      /* 〔v7 速查卡 · AI 职责面〕卡：「可自行查看累计维修量、距暴露阈值剩余量与「已暴露」状态（仅本人可见）」。追加维修须紧接本人维修的当夜——属时序约束，非互斥。 */
      duty: { mutex: [],
              senses: ['ownRepairTotal', 'ownExposeRemain'],
              cost: null },
      source: '4.3.1/4.3.6', pending: true,
    },
    sheriff: {
      name: '警长', faction: 'human', group: 'hunt', isBase: true,
      desc: '持枪：初始 1 发（存储上限 2 发）；第 5 夜与全场存活≤6 时各额外 +1 发（各自全局仅一次）；前 3 夜可巡逻 1 次（1~3 人）；击杀敌方回复子弹。',
      capClass: 'high', grants: ['shoot'],
      attend: { lethal: 1.15 },
      attendAway: { infect: 0.7, ballot: 0.75 },
      actionStep: '6', actionSteps: ['6', '2'],   // 6 开枪；2 巡逻（4.4.4）
      charges: { gun: 2, patrol: 1 },
      visibility: { batch: ['③'], private: ['7.2.2'], selfOnly: false },
      /* 〔v7 速查卡 · AI 职责面〕卡：「步骤 6 开枪 ｜ 步骤 2 巡逻；两者同一夜二选一（互斥不永久）」+「可见武装船员编号」+「枪击可命中任何存活角色，含人类队友」。 */
      duty: { mutex: ['shoot', 'patrol'],
              senses: ['ownAmmo', 'armedCrewIds'],
              cost: 'canHitFriendlies' },
      source: '4.4/4.4.6', pending: true,
    },
    hunter: {
      /* A6 批次 29 实装（4.4.7~4.4.9）：猎杀位变体，与警长同席位开局定其一（1.1.1）。
         纯枪手——无巡逻（4.4.4 不适用）；〔通则 4.4.6 之例外〕子弹不设 2 发存储上限
         （登记于 2.8.9(14)），成长靠攒弹（进程 gatherAmmo：2 夜 +1 发、可反复）与
         悬赏（4.4.2 同制）；4.4.3 两项额外子弹为警长专属，猎手不适用。
         嗅探（4.4.8）：步骤 3.5，每夜至多查 2 名、全局 2 个夜晚，查「是否呈现保护状态」
         （一切非全额减免类；安全室/夜晚免疫不在查询范围）。 */
      name: '猎手', faction: 'human', group: 'hunt', isBase: true,
      desc: '纯枪手：初始 1 发、不受 2 发上限约束（4.4.7③）；攒弹（2 夜 +1 发，可反复）；嗅探（全局 2 夜、每夜至多 2 名，4.4.8）；悬赏与武装识别同警长（4.4.7④⑤）。',
      capClass: 'high', grants: ['shoot', 'sniff'],
      attend: { lethal: 1.15 },
      attendAway: { infect: 0.7 },
      actionStep: '6', actionSteps: ['6', '3.5'],   // 6 开枪/攒弹；3.5 嗅探（4.4.9①）
      charges: { gun: 1, sniff: 2 },
      visibility: { batch: [], private: ['7.2.2'], selfOnly: true },
      /* 〔v7 速查卡 · AI 职责面〕卡：「嗅探不占行动窗口，可与开枪并用」⇒ 不互斥；「嗅探不显示全额减免（安全室、夜晚免疫）」是明文陷阱。 */
      duty: { mutex: [],
              senses: ['ownAmmo', 'sniffResult'],
              cost: 'sniffMissesSafeRoom' },
      source: '4.4.7/4.4.8/4.4.9', pending: true,
    },
    bio: {
      name: '生化医师', faction: 'human', group: 'doctor', isBase: true,
      desc: '治疗 3 次（清感染并赋予抗体）、自救 1 次；可见感染标记清单。',
      grants: ['treat', 'brew'], capClass: 'mid',   // 〔v7 速查卡〕制药为医生族通有（3.3.1；卡载三者互斥含制药）
      attend: { infect: 1.3 },
      attendAway: { lethal: 0.75, ballot: 0.75 },
      actionStep: '8', charges: { heal: 3, selfSave: 1 },
      /* 〔v7 速查卡 · AI 职责面〕卡：「步骤 8：治疗 ／ 自救 ／ 制药三者互斥（亦可整晚不出手）」+「可见谁带有感染标记（仅编号清单，不显真伪…）」。 */
      duty: { mutex: ['treat', 'selfSave', 'brew'],
              senses: ['infectMarks', 'antibodyFeedback'],
              cost: null },
      visibility: { batch: [], private: ['7.2.4'], selfOnly: true },
      source: '4.5', pending: true,
    },
    rescue: {
      name: '救援医师', faction: 'human', group: 'doctor', isBase: true,
      desc: '救援 2 次（可救任意濒死者）、治疗 1 次；可见濒死者清单。',
      grants: ['treat', 'save', 'brew'], capClass: 'mid',   // 〔v7 速查卡〕制药为医生族通有（3.3.1）
      attend: { infect: 1.1 },
      attendAway: { lethal: 0.75, ballot: 0.75 },
      actionStep: '8', charges: { rescue: 2, heal: 1 },
      /* 〔v7 速查卡 · AI 职责面〕卡：「步骤 8：救援（含自救）／ 治疗 ／ 制药三者互斥」+「可见谁带有感染标记与谁处于濒死」+「救援可救任意濒死角色，不限阵营」。 */
      duty: { mutex: ['save', 'treat', 'brew'],
              senses: ['infectMarks', 'dyingList', 'deathSourceAfterSave'],
              cost: 'canSaveAnyone' },
      visibility: { batch: [], private: [], selfOnly: true },
      source: '4.5', pending: true,
    },
    artisan: {
      /* A6 批次 31 实装（4.11）：防御位变体，与保镖同席位（1.1.1）、同行动位（步骤 3）。
         护甲（4.11.1）：挡 1 点伤害 ＋ 挡 1 次感染（双计数独立）；初始自带 1 件常规护甲
         （不可发配、不计库存上限）；同一目标至多 1 件，重复分配依 2.5 落空。
         行动（4.11.2）：常规铸造（2 夜）∕速成铸造（1 夜，限期：第 2/3 夜生效、第 4 夜消失）
         ∕分配（1 夜，份数＝库存）三者择一；铸造属进程型产出（cast / castFast，2.9⑧ 不新增批次）。
         库存上限 2 件（仅约束未分配部分）；发出即锁死不可收回/转移（4.11.3②③）。
         限制（4.11.5）：无受袭感知（不享 4.8.3）、无连续分配限制。 */
      name: '工匠', faction: 'human', group: 'defense', isBase: true,
      desc: '护甲：挡 1 伤 ＋ 1 感染（双计数独立），开局自带 1 件；每夜于常规铸造（2 夜）／速成铸造（1 夜，限期 2 夜生效）／分配（库存上限 2）三者择一。',
      grants: ['craft'], capClass: 'mid',
      attend: { infra: 1.15, lethal: 1.1 },
      attendAway: { infect: 0.7, verify: 0.85, ballot: 0.7 },
      actionStep: '3',
      charges: { armorStock: 2 },
      visibility: { batch: [], private: [], selfOnly: true },
      /* 〔v7 速查卡 · AI 职责面〕卡：「工匠 · 核心：三选一：常规铸造／速成铸造／分配护甲」+「护甲…不公开而持有者自知，无受袭感知」。 */
      duty: { mutex: ['cast', 'castFast', 'distribute'],
              senses: ['ownArmorStock'],
              cost: 'noAttackFeedback' },
      source: '4.11.1/4.11.2/4.11.3', pending: true,
    },
    poisoner: {
      /* A6 批次 31 实装（4.6.4）：医生位变体，与救援医师同席位（1.1.1）、同行动位（步骤 8）。
         继承制药（3.3.1，二选一产出 1 瓶救援 ∕ 2 瓶治疗）；**不继承**救援 2 次 / 治疗 1 次 /
         尸检清单（4.6.4②）。毒药＝第四种伤害类型（非感染标记，3.3 全章不适用）：步骤 8 投放，
         落身当夜为第 1 夜、第 3 夜 0.55 致濒死；〔通则 2.8.2⑥ 之例外，2.8.9(18)〕**仅全额减免层可挡**
         （安全室 / 夜晚免疫），庇护类（保护 / 巡逻 / 工匠护甲 / 结茧护盾）一律不防。
         清除：治疗 / 救援 / 自救均不可，唯一途径是解药（4.6.4④）。额度：毒药 3 / 解药 3，
         第 1、3、5 夜各到账 1 份（2.1.5 默认时序），无击杀回复（4.6.4⑥）。 */
      name: '毒师', faction: 'human', group: 'doctor', isBase: true,
      desc: '制药（继承）＋毒药 ＋解药：毒药为第四种伤害类型，落身第 3 夜致濒死（仅全额减免可挡）；解药是毒药唯一清除途径。额度各 3，第 1/3/5 夜各到账 1 份。',
      grants: ['treat', 'brew', 'poison'], capClass: 'mid',
      attend: { infect: 1.1, lethal: 1.1 },
      attendAway: { lethal: 0.75, ballot: 0.7 },
      actionStep: '8', charges: { brew: Infinity, poison: 3, antidote: 3 },
      visibility: { batch: [], private: ['7.2.4'], selfOnly: true },
      /* 〔v7 速查卡 · AI 职责面〕卡：「步骤 8：制药 ／ 毒药 ／ 解药 ／ 制药产出的救援 ／ 治疗——五选一（毒师无自救额度）」+「毒药不辨阵营…容错为零」。五选一在 duty.mutex 里落为 brew/poison/antidote/treat 四键（制药产出的救援与治疗共用 brew、treat 两个动作身份）。 */
      duty: { mutex: ['brew', 'poison', 'antidote', 'treat'],
              senses: ['poisonList', 'selfPoisoned', 'infectMarks', 'dyingList'],
              cost: 'poisonHitsAlly' },
      source: '4.6.4', pending: true,
    },
    convict: {
      /* A6 批次 32 实装（6.8）：外星人位变体，与经典外星人同席位（1.1.1）。
         **不持经典外星人的任何技能**（6.8.2）——蛰伏（含沉默）、双刀、破坏、夜晚免疫、
         感染治疗额度一概不持；乔装 2 次于呈现异形时依 6.8.3⑧ 克隆取得（全局次数按本体计）。
         能力仅三项：①变形（P-id 身份改变子步骤）②复生（步骤 8，与医生救援同窗口）③作为
         外星人阵营成员参与清场与胜负（出局判定按真实阵营＝第三阵营，6.8.5②）。
         变形：可变为本局实际在场的人类职业或异形（不可变外星人／转职衍生职业），2 夜冷却，
         不受沉默封锁（早于覆盖期，6.8.3⑥）。呈现异形＝克隆除社交与队内共享外的一切异形能力
         （6.8.3⑧）。复生：全局 2 次，可自救，不占行动权。 */
      name: '死囚外星人', faction: 'xeno', group: null, isBase: false,
      desc: '精通各项技能的前船长：每夜可变形为本局任一人类职业或异形（2 夜冷却，镜像账本并行）；复生 2 次（含自救）；不持经典外星人的蛰伏/双刀/破坏/夜晚免疫。',
      capClass: 'high', grants: ['morph', 'revive'],
      attend: { lethal: 1.2, infect: 1.1 },
      attendAway: { verify: 0.85, ballot: 0.7 },
      actionSteps: ['P-id', '8'],
      charges: { morph: Infinity, revive: 2 },
      visibility: { batch: [], private: ['7.2.4'], selfOnly: true },
      /* 〔v7 速查卡 · AI 职责面〕卡：「变形…可骗过神探」+「复生…可自救」+「呈现异形时克隆除社交与队内共享外的一切技能与被动」。变形与复生分处 P-id 与 8，不互斥。 */
      duty: { mutex: [],
              senses: ['mirrorLedger', 'morphTargetPool'],
              cost: null },
      source: '6.8.1/6.8.3/6.8.4/6.8.5', pending: true,
    },
    detective: {
      name: '神探', faction: 'human', group: 'verify', isBase: true,
      desc: '每夜查验 1 人真实身份，或发布一条官方公告。',
      capClass: 'high',
      attend: { verify: 1.25 },
      attendAway: { infra: 0.7, lethal: 0.7, infect: 0.7, ballot: 0.75 },
      actionStep: '2', judgeMode: 'presented',                    // 4.7.1 恒得当前职业、不报阵营
      charges: { verify: Infinity, announce: Infinity },
      visibility: { batch: ['③'], private: ['7.2.1'], selfOnly: false },
      batchDelta: ['神探公告另附转职者原职业标注（4.7.5）'],
      /* 〔v7 速查卡 · AI 职责面〕卡：「步骤 2：查验 或 发布官方公告（二者二选一）」+「恒依呈现职业如实作答、不作假（不报阵营）」+「每查验一人即向该目标暴露场上唯一的神探神探」。 */
      duty: { mutex: ['verify', 'announce'],
              senses: ['checkPool', 'presentedRoleOnly'],
              cost: 'checkRevealsSelf' },
      source: '4.7.1/4.7.2/4.7.5', pending: true,
    },
    bodyguard: {
      name: '保镖', faction: 'human', group: 'defense', isBase: true,
      desc: '每夜保护 1 人（挡 1 伤害 + 1 感染）；不可连续两夜保同一人。',
      grants: ['protect'],
      attend: { lethal: 1.25 },
      attendAway: { infect: 0.7, verify: 0.85, ballot: 0.7 },
      actionStep: '3',
      damageLayer: { cls: '主动保护类', ord: 1 },                 // 2.8.2 F 层序
      infectLayer: { cls: '主动保护类', ord: 1 },
      charges: { protect: Infinity },
      visibility: { batch: [], private: ['7.2.5'], selfOnly: false },
      /* 〔v7 速查卡 · AI 职责面〕卡：「每夜保护 1 人…受袭感知——被保护时获知伤害类型」「保镖只报伤害类型、不报凶手编号」。另有「不可连续两夜保护同一目标」，属自限而非互斥。 */
      duty: { mutex: [],
              senses: ['guardFeedback', 'attackTypeOnGuard'],
              cost: null },
      source: '4.8/4.8.1', pending: true,
    },
    inspector: {
      name: '验票官', faction: 'human', group: 'social', isBase: true,
      desc: '可见全部票源；可发动 1 次紧急会议（存活≥5）。',
      capClass: 'high',
      attend: { verify: 1.2, ballot: 1.3 },
      attendAway: { infra: 0.7, lethal: 0.7, infect: 0.7 },
      actionStep: '10', charges: { meeting: 1 },
      visibility: { batch: ['⑦', '⑨', '⑩'], private: [], selfOnly: false },
      /* 〔v7 速查卡 · AI 职责面〕卡：「白天可见全部票源编号」+「公开票源图 全局 1 次」+「会议开场即公告其编号与身份（批次⑦），故发动即暴露身份」。 */
      duty: { mutex: [],
              senses: ['allVoteSources', 'allBallotCounts'],
              cost: 'meetingRevealsSelf' },
      source: '4.9.2', pending: true,
    },
    listener: {
      /* A6 批次 29 实装（4.12）：社交位变体，与验票官同席位开局定其一。
         窃听（步骤 0.2）：读取当夜批次①已公告配对组的私聊正文（队内私聊明文排除，
         4.12.3①）；早于沉默覆盖期故不受封锁（2.8.3④附——时序确认，非豁免）。
         报告（D-report 白天条件阶段，先于〇留言，4.12.2②/2.3.2）：择定提交、可改写、
         可虚构，系统不比对不校正，随批次⑪发布并附「不保真」性质标注（官方背书第四档）。
         额度：读取每夜可发动、不设组数上限；报告每夜 1 次、全局 2 次（4.12.5⑦）。 */
      name: '窃听者', faction: 'human', group: 'social', isBase: true,
      desc: '窃听（步骤 0.2）：读取当夜已公告配对组的私聊内容（不设组数上限）；次日白天可择定提交为报告（可改写、系统不保真，批次⑪），全局 2 次。',
      capClass: 'mid', grants: ['wiretap'],
      attend: { ballot: 1.2 },
      attendAway: { infra: 0.7, lethal: 0.7, infect: 0.7 },
      actionStep: '0.2', actionSteps: ['0.2', 'D-report'],
      charges: { wiretap: Infinity, report: 2 },
      visibility: { batch: ['⑪'], private: [], selfOnly: false },
      /* 〔v7 速查卡 · AI 职责面〕卡：「每夜可提交 1 次——择一组改写为「报告」，或择一组原样「公示」…二者共用该每夜 1 次」+「报告可自由改写，系统不校正」+「读取…不设组数上限」。 */
      duty: { mutex: ['report', 'publish'],
              senses: ['pairedPrivateChats'],
              cost: 'reportNotFaithful' },
      source: '4.12.1/4.12.2/4.12.5', pending: true,
    },
    armed: {
      name: '武装船员', faction: 'human', group: 'base:arms', isBase: false,
      desc: '1 发子弹，击杀敌方回复；由普通船员转职而来。',
      capClass: 'high', grants: ['shoot'],
      attend: { lethal: 1.15 },
      attendAway: { infect: 0.7 },
      actionStep: '6', charges: { gun: 1 }, transferred: true,
      visibility: { batch: [], private: ['7.2.2'], selfOnly: false },
      /* 〔v7 速查卡 · AI 职责面〕卡：「因仅 1 发，每夜至多指定 1 名；持有量恒 ≤ 1，不适用 2 发上限」——属额度自限，非互斥。 */
      duty: { mutex: [],
              senses: ['ownAmmo'],
              cost: null },
      source: '4.2/4.4', pending: true,
    },
    assistant: {
      name: '助理工程师', faction: 'human', group: 'base:eng', isBase: false,
      desc: '每夜维修 −1.0~1.5 自选；累计维修 3.0 即暴露。',
      grants: ['repair'], capClass: 'low', repairExposeAt: 3,
      attend: { infra: 1.3 },
      attendAway: { lethal: 0.7, infect: 0.7, ballot: 0.75 },
      actionStep: '4a', charges: { repair: Infinity }, transferred: true,
      visibility: { batch: ['④'], private: [], selfOnly: false },
      /* 〔v7 速查卡 · AI 职责面〕卡：「累计维修 3.0 即暴露…转职前累积的协助维修量不并入」——暴露阈值低于正牌工程师（3.0 vs 4.0）。 */
      duty: { mutex: [],
              senses: ['ownRepairTotal', 'ownExposeRemain'],
              cost: null },
      source: '4.2/4.3.6', pending: true,
    },
    tempdoc: {
      name: '临时医生', faction: 'human', group: 'base:doc', isBase: false,
      desc: '救援 1 次、治疗 2 次；可见感染标记与濒死者。',
      grants: ['treat', 'save', 'brew'], capClass: 'mid',   // 〔v7 速查卡〕制药为医生族通有（3.3.1；卡载「每晚仅一类出手」含制药）
      attend: { infect: 1.1 },
      attendAway: { lethal: 0.75, verify: 0.85, ballot: 0.7 },
      actionStep: '8', charges: { rescue: 1, heal: 2 }, transferred: true,
      visibility: { batch: [], private: [], selfOnly: true },
      /* 〔v7 速查卡 · AI 职责面〕卡：「每晚仅一类出手；救援后可见该目标濒死原因」⇒ 互斥含制药（医生族通有）。 */
      duty: { mutex: ['save', 'treat', 'brew'],
              senses: ['infectMarks', 'dyingList', 'deathSourceAfterSave'],
              cost: null },
      source: '4.2/4.5', pending: true,
    },
    alien: {
      name: '异形', faction: 'alien', group: null, isBase: false,   // 2.8.14⑤ 不设组位
      desc: '每夜出刀／感染／破坏／结茧四选一；第 3 夜起可进化。',
      seats: 3,
      /* 〔v7 速查卡修正〕补登记 '1'（乔装）：引擎步位 '1'.req 按身份派发给异形与经典外星人
         （steps.js:488-492 `p.role === 'alien' || ACT.isClassicXeno(p) && p.disguiseLeft > 0`），
         卡载「另可…乔装（步骤 1）」。声明原缺 ⇒ C1 覆盖审计此前扫不到该派发。 */
      actionStep: '7', actionSteps: ['7', '0.6', '4b', '1'],   // 7 出刀/感染；0.6 进化/转化（6.2）；4b 破坏/结茧（5.7）；1 乔装（7.3）
      charges: { kill: Infinity, infect: Infinity, destroy: Infinity, cocoon: Infinity },
      visibility: { batch: ['②', '⑤'], private: ['7.2.2'], selfOnly: false },
      /* 〔v7 速查卡 · AI 职责面〕卡：「每夜出刀／感染／破坏／结茧四选一」+「异形阵营可见本方队友票型分布」+「互相知晓队友身份」。 */
      duty: { mutex: ['kill', 'infect', 'destroy', 'cocoon'],
              senses: ['teammateIdentities', 'teammateBallots'],
              cost: null },
      source: '5.1~5.9', pending: true,
    },
    xeno: {
      name: '外星人', faction: 'xeno', group: null, isBase: false,  // 2.8.14⑤ 不设组位
      desc: '查验／击杀／破坏三选一；夜晚免疫；第 6 夜起可觉醒双刀。',
      seats: 1,
      /* 〔v7 B0 顺带修正 · 声明与引擎派发不一致，非本批引入〕
         引擎步位 'P-id'（身份改变子步骤 2.1.1）的 req 会向**经典外星人**派发 awaken
         （6.2 觉醒：第 6 夜起或存活≤6；见 js/engine/steps.js 'P-id'.req），
         但本行原只登记 ['0.1','0.1s','4b','5']，缺 'P-id' ⇒ C1 覆盖审计判为缺口
         （coverageGap('P-id',['xeno']) = ['xeno']）。
         该缺口在**拆除前的基线**同样存在（基线 declaredActors('P-id') 亦只有 ['convict']），
         只是当时采样未命中；B0 后通道不再消费 rng、随机序列前移，才被审计扫到。
         故属既有声明缺陷被暴露，不是 B0 引入的回归。
         无行为风险：按 roleDecl.js:42 的契约，actionSteps 全列表「供覆盖审计与 C1 收口」，
         引擎派发过滤读的是主行动位 actionStep（本行仍为 '0.1'，未改）。
         死囚（上一段）已按同一口径登记 'P-id'，此处补齐即两角色对齐。 */
      /* 〔v7 速查卡修正〕补登记 '1'（乔装）与 '8'（自我治疗）：
         · '1' 引擎 steps.js:488-492 与异形共用同一 req（ACT.isClassicXeno 分支），
           卡载外星人「乔装全局 2 次」；声明原缺。
         · '8' 引擎 steps.js:1213 派发 kind='xenoCure'（isClassicXeno && !branch && infection.real
           && cureSelf > 0），卡载外星人当夜四选一含「自我治疗（步骤 8）」；声明原缺。
         · 顺带确认：外星人「夜晚免疫」属全额减免层而非行动位，故不在 actionSteps 内（正确）。 */
      actionStep: '0.1', actionSteps: ['0.1', '0.1s', '4b', '5', 'P-id', '1', '8'],   // 0.1 蛰伏；0.1s 沉默窗；4b 破坏；5 击杀/双刀（6.1/6.6）；P-id 觉醒（6.2）；1 乔装（7.3）；8 自我治疗（6.3）
      judgeMode: 'presented',                   // 蛰伏查验 6.1.1① 报编号与呈现职业
      /* 〔v7 速查卡补充〕cureSelf ＝ 自我治疗额度。卡的外星人「额度」行未列自我治疗，
         只说它「占用当夜行动名额」；引擎按每夜到账 1 次、用尽即止实现
         （engine.js 夜间到账区）。故此处登记 Infinity（每夜可用 1 次，非终身计数）。
         ⚠ 卡未明写额度，此为**推断**；若正文另有终身 N 次口径，改 engine.js 的到账常量
           并把此处改为该数值即可，机制与 req/结算分支不动。 */
      charges: { check: Infinity, kill: Infinity, destroy: Infinity, nightImmune: 2, cureSelf: Infinity },
      /* C13（2026-10-04）：此处曾有 process:{nights:2,on:'0.6',product:'doubleBlade'} 的错误
         进程声明——觉醒（6.2）于身份改变子步骤即时生效，非进程型产出；该字段全仓零消费，
         属误导性死数据，删除（回落 DEFAULTS.process=null）。 */
      visibility: { batch: ['③'], private: ['7.2.1', '7.2.4'], selfOnly: false },
      /* 〔v7 速查卡 · AI 职责面〕卡：「蛰伏（0.1）／ 击杀（5）／ 破坏（4b）／ 自我治疗（8）四选一；觉醒后步骤 5 可出双刀」+「夜晚免疫…消耗路径与剩余次数可核算余量」。 */
      duty: { mutex: ['lurk', 'kill', 'destroy', 'selfHeal'],
              senses: ['ownNightImmuneRemain', 'lurkTargetPresented'],
              cost: null },
      source: '6.1~6.6', pending: true,
    },
  };

  const keys = () => Object.keys(ROLE_DECL);
  const has = key => Object.prototype.hasOwnProperty.call(ROLE_DECL, key);

  /* ---------- D5 命名空间隔离：faction 键与 role 键的冲突登记 ----------
     2.8.14⑤ 等条款按「阵营/职业」两套语义使用键名，同名会让「加死囚时两类判断必然混淆」
     （清单 D5/G 类）。此处把现存冲突**显式登记**（而非静默容忍），并给出重命名计划：
        · 冲突键 'alien'：既是 FACTION.alien（异形阵营）又是 ROLE_DECL.alien（异形职业）。
        · 计划：物理重命名（role 侧加前缀）需一次覆盖约 270 处裸词/引号引用，风险高于收益，
          故按「先登记、再门禁、后改名」推进——新增冲突由 namespaceAudit 断言直接拦下；
          所有按阵营语义的判断一律读 FACTION，按职业语义的一律读 ROLE_DECL（本表 keyed by role）。
     · 反向别名：E 通道历史键 'king' = 阵营 'xeno'，由 AIBelief.chanFor 兼容，不再新增此类别名。 */
  const NAMESPACE = {
    collisions: {
      alien: {
        factions: ['alien'], roles: ['alien'],
        plan: '两义并存（阵营与其「主职业」同名，历史命名）。真正的风险不是今天，而是加同阵营职业时：' +
              '死囚（convict）亦属异形阵营，此后 `.role === \'alien\'` 与 `.faction === \'alien\'` 必然混淆。' +
              '物理重命名待独立批次（需全仓替换 role 侧引用并跑满回归 + 行为指纹）。',
      },
      xeno: {
        factions: ['xeno'], roles: ['xeno'],
        plan: '同上（外星人阵营与其主职业同名）。本轮由 namespaceAudit 首次机械发现：' +
              '改动清单 D5/G 类只点了 alien，实际同名冲突为 alien + xeno 两处。',
      },
    },
    legacyAliases: { king: 'xeno' },   // E 通道历史键 → 阵营键
  };

  /** 命名空间自检：返回「未登记的冲突」清单（空数组＝合规；已登记冲突不算违规） */
  function namespaceAudit() {
    const bad = [];
    const factionKeys = (global.SKData && global.SKData.FACTION) ? Object.keys(global.SKData.FACTION) : [];
    const roleKeys = keys();
    for (const k of roleKeys) {
      if (factionKeys.indexOf(k) < 0) continue;
      const reg = NAMESPACE.collisions[k];
      if (!reg) { bad.push(`未登记的命名冲突：'${k}' 同时是阵营键与角色键（D5）`); continue; }
      if (reg.roles.indexOf(k) < 0 || reg.factions.indexOf(k) < 0)
        bad.push(`冲突登记不完整：'${k}'`);
    }
    for (const k of Object.keys(NAMESPACE.collisions)) {
      if (roleKeys.indexOf(k) < 0 || factionKeys.indexOf(k) < 0)
        bad.push(`已登记的冲突 '${k}' 实际已不存在，请清理登记表（防登记表变成垃圾）`);
    }
    return bad;
  }

  /* ---------- D3 降级解析：未声明角色得到一份「可跑完整局」的声明 ---------- */
  function resolveDecl(key) {
    const raw = has(key) ? ROLE_DECL[key] : null;
    if (!raw) {
      /* 未知角色：默认人类阵营、无组位、无能力、只可见公开信息（K1 第三层） */
      return Object.assign({}, DEFAULTS, {
        key, name: key, undeclared: true,
        visibility: Object.assign({}, DEFAULTS.visibility),
        charges: {}, exempt: [], attend: {},
      });
    }
    return Object.assign({}, DEFAULTS, raw, {
      key,
      /* 注意力权重：缺失即 1.0（D7/K2 —— 不是 undefined，不写死档位） */
      attend: Object.assign({}, raw.attend),
      visibility: Object.assign({}, DEFAULTS.visibility, raw.visibility || {}),
      charges: Object.assign({}, raw.charges),
    });
  }

  /* ---------- D1 单一真相源：基础人类职业由 faction + isBase 推导 ----------
     等价于 4.1.1①「查证池＝开局公告之人类职业」；旧 data.js 的 8 项硬编码
     HUMAN_BASE_ROLES 即本函数的输出（断言校验二者逐项相等）。 */
  function baseHumanRoles() {
    return keys().filter(k => ROLE_DECL[k].faction === 'human' && ROLE_DECL[k].isBase === true);
  }
  /** 全部人类职业（含转职系） */
  function humanRoles() { return keys().filter(k => ROLE_DECL[k].faction === 'human'); }
  /** A13 验证式查验的「全职业池」（4.1.1②：第 2 次起可提交的完整池，当前 10 项）
      ＝ 开局公告的人类职业（基础位 8）+ 各非人类阵营的职业（异形 / 外星人）。
      顺序 = 基础人类职业序 → 非人类阵营声明序，与迁移前的 [..HUMAN_BASE_ROLES, 'alien','xeno'] 逐项同序。 */
  function verifyPoolAll() {
    /* 〔批次 32 修正〕非人类部分改由**本局实际构成**给出，而非「所有非人类角色」。
       此前是静态收全部：外星人席位「xeno ∕ convict 定其一」（1.1.1），静态收会让
       **未上场的 convict 进入经典局的查证池**——既违反 1.1.1（未上场者不入任何候选池），
       又使「加变体」变成对经典局的行为变更（指纹漂移的根因）。
       构成由调用方给出（verifyPool → SKDerivation.compositionOf），未给时退回静态口径。 */
    const nonHuman = keys().filter(k => ROLE_DECL[k].faction !== 'human');
    return baseHumanRoles().concat(nonHuman);
  }
  /** 同上，但按本局实际构成裁剪（4.1.1②：全职业池＝开局公告所列，变体席位取实际在场者） */
  function verifyPoolOf(composition) {
    const comp = composition || null;
    const keep = k => !comp || comp.indexOf(k) >= 0;
    return verifyPoolAll().filter(keep);
  }
  /** 某阵营的角色键 */
  function rolesOfFaction(f) { return keys().filter(k => ROLE_DECL[k].faction === f); }
  /** 组位成员（依声明，非依组位表静态成员——后者含未实装角色） */
  function rolesOfGroup(g) { return keys().filter(k => ROLE_DECL[k].group === g); }
  /* 注意力权重（D7 真源）：三层结构——
       attend      主业族偏移（>1）：这件事我格外上心
       attendAway  非主业族衰减（<1）：这件事我不太关心；**低于 attendFloor 者不进账**
       缺省 1.0    （中性：不特别关心也不特别忽略）
     〔批次 34〕attendAway 是「注意力选择化」的载体：此前全部为 1.0，语义上「不关心」与
     「同等关心」无从分辨；低值 + floor 闸门使差别体现为**是否形成证据**。
     衰减幅度待标定（当前为温和占位值，与 attend 的 1.1~1.3 同量级，由标定轮统一校）。 */
  const ATTEND_FLOOR = 0.8;                 // floor 闸门：低于此值的事件不进账（可标定）
  function attendWeight(key, focus) {
    const d = has(key) ? ROLE_DECL[key] : null;
    if (!d) return 1.0;
    const main = (d.attend || {})[focus];
    if (typeof main === 'number') return main;
    const away = (d.attendAway || {})[focus];
    if (typeof away === 'number') return away;
    return 1.0;
  }
  /** 组位解析：依真实身份（2.8.14②：乔装/变形不改组位、转职随之变更） */
  function groupOf(key) {
    const d = has(key) ? ROLE_DECL[key] : null;
    return d ? (d.group === undefined ? null : d.group) : null;
  }

  /* ---------- D6 能力分发表：调用点问「谁能做这件事」 ---------- */
  /** 具备某能力标签的角色键（按声明序；未声明角色不影响既有集合） */
  function rolesWith(grant) {
    return keys().filter(k => (ROLE_DECL[k].grants || []).indexOf(grant) >= 0);
  }
  /** 单点判定：比「数组 indexOf 角色键」更难写漏——未声明/未知角色一律 false，不抛错（D3） */
  function hasGrant(key, grant) {
    const d = has(key) ? ROLE_DECL[key] : null;
    return !!(d && (d.grants || []).indexOf(grant) >= 0);
  }
  /** 能力档（危险度 Dg 能力项）：未声明即 null → 调用点回落 base */
  function capClassOf(key) {
    const d = has(key) ? ROLE_DECL[key] : null;
    return d ? (d.capClass || null) : null;
  }
  /* ---------- 〔v7 速查卡〕AI 职责面访问器 ---------- */
  /** 某角色的当夜互斥动作组（速查卡「X 选一」）。缺省＝[]＝无互斥约束 */
  function mutexOf(key) {
    const d = has(key) ? ROLE_DECL[key] : null;
    return (d && d.duty && d.duty.mutex) || [];
  }
  /** 某角色的专属主动情报面（速查卡「可见性」行）。缺省＝[] */
  function sensesOf(key) {
    const d = has(key) ? ROLE_DECL[key] : null;
    return (d && d.duty && d.duty.senses) || [];
  }
  /** 某角色的明文代价键（速查卡）；无则 null */
  function costOf(key) {
    const d = has(key) ? ROLE_DECL[key] : null;
    return (d && d.duty) ? (d.duty.cost || null) : null;
  }
  /** 该角色是否知道某项专属情报（调用点只问「谁知道」，不问「你是不是某职业」） */
  function hasSense(key, sense) { return sensesOf(key).indexOf(sense) >= 0; }
  /** 同夜是否已用过互斥组中的某个动作（AI 决策前的自查口） */
  function mutexBlocked(key, usedActions) {
    const mx = mutexOf(key);
    if (!mx.length || !usedActions) return null;
    const used = usedActions instanceof Set ? usedActions : new Set(usedActions);
    for (const a of mx) if (used.has(a)) return a;
    return null;
  }
  /* ---------- 〔v7 速查卡对账〕卡与实现的差异台账 ----------
     卡载但引擎零实现的规则面：**不补声明**（补了即造幽灵步位），登记在此，
     以免「声明里写着」被误读为「已经能用」。 */
  const IMPL_GAP = {
    /* 〔v7 裁定③ · 2026-10-08〕异形「破坏」实际占用率极低。**记录在案，不改策略权重。**
       卡载四选一（破坏／结茧在步骤 4b，出刀／感染在步骤 7）：破坏未进化 ＋1.5~2.0、
       破坏进化 ＋2.0~3.0，全局 1 次、触发停转夜。实测（报数区，种子 241-500，260 局）：
       4b 决策 2866 次中 destroy 仅 63 次＝**2.2%**，cocoon 534 次＝18.6%，none 79.2%；
       结茧 : 破坏 = 8.48 : 1；260 局里只有 37 局出现过破坏。
       复现：node tools/probe-alien-destroy-rate.cjs <ROOT> 260 241。
       ⚠ 成因线索（未验证、未修）：decide.js 的 alienAct / branch 效用里 uDestroy 从未压过
         uAct（出刀）与 uCocoon，即破坏的期望收益恒低于另外两支。是否属策略设定或权重错误，
         **本批未判定**——裁定③只要求记录，故不做任何推断性改动。 */
    'alien.destroyRate': {
      card: '破坏／结茧在步骤 4b，出刀／感染在步骤 7，四选一；破坏全局 1 次、触发停转夜',
      measured: '报数区 241-500（260 局）：4b 决策 2866 次 → destroy 63（2.2%）、cocoon 534（18.6%）、none 2269（79.2%）；结茧:破坏 = 8.48:1；仅 37/260 局出现破坏',
      verdict: 'recorded（裁定③：记录在案即可，不改策略权重）',
      repro: 'node tools/probe-alien-destroy-rate.cjs <REPO_ROOT> 260 241',
      openQuestion: '成因未判定：decide.js 里 uDestroy 似从未压过 uAct/uCocoon。属策略设定还是权重错误需单独判定；若要动必须单独批次 + 同种子 A/B。',
    },
    /* 〔既有缺陷 · 2026-10-08 由裁定①的副作用暴露〕步骤 8 的 req 对死囚可推出 kind=revive
       （6.8.4 复生：role=convict 且 reviveLeft>0 且场上有濒死者），但 form 的首行判
       isClassicXeno(p)，死囚 role 不是 xeno ⇒ 落到医生分支返回 kind=doctor；**form 根本没有
       revive 分支**，于是死囚被静默塞进医生表单，能拿到治疗／救援／制药／毒药——
       与 43 号注释描述的外星人那次是同一类病（req 与 form 的 kind 不一致，静默换了一套技能）。
       确定性复现：tools/probe-revive-kind.cjs（就地构造死囚本体形态，不跑随机对局），
       在 8dd0d17（voice 批次，早于裁定①②）上同样复现 ⇒ **先于本批存在**。
       本批为何变红：裁定①把自我治疗额度改为「有感染标记才到账」，外星人在步骤 8 的派发变少 ⇒
       取随机次数减少 ⇒ g.rng 整条流移位 ⇒ 这个潜伏缺陷在随机对局采样里被撞了出来。
       另一条方法论教训：**随机探针对这类缺陷不可靠**（流一动就变红/变绿），确定性探针才靠得住。
       修法：给步骤 8 的 form 补 revive 分支。但那会改死囚行为（当前它错误地拿到了医生技能），
       超出本批裁定①②的授权，故未做。断言处置见 test-fix-v26 的 __V7_PRESURFACED__ 登记表。 */
    'convict.revive.form': {
      card: '6.8.4 复生：与医生救援同窗口（步骤 8），全局 2 次，每夜至多用当前持有额度；不占当夜行动权',
      declared: 'convict.actionSteps 含 8；charges 有 revive 全局次数（state.js:63 reviveLeft 初始 2）',
      impl: 'req 侧已实装（steps.js 步骤 8 推 kind=revive）；**form 侧无 revive 分支**，一律落医生表单',
      verdict: 'gap（既有缺陷，先于 2026-10-08 裁定①②；确定性可复现）',
      repro: 'node tools/probe-revive-kind.cjs <REPO_ROOT>  —— req=revive 而 form=doctor',
      impact: '死囚被静默赋予医生技能（治疗／救援／制药／毒药），且真正的复生能力无法发动',
      openQuestion: '修法＝给步骤 8 的 form 补 revive 分支。属死囚行为改动，需单独批次与用户确认。',
    },
    /* 〔v7 速查卡对账 · 第三轮更正〕本条初版结论「引擎零实现」是**错的**，已更正。
       错因：检索用了标识符 assistRepair，而实现采「前缀式 opt 命名」
       （steps.js:584-586 `({ v: 'repair' + v.toFixed(2), label: '协助维修 −' + ... })`），
       全仓再无 assistRepair 字面量 ⇒ 只命中 roleDecl 本处，被我误判为未实装。
       实际已实装且与卡一致的部分：
         · 7 档自选值 a ∈ [0.20,0.50] 步长 0.05 —— 与卡载口径逐档相符；
         · 结算 steps.js:1012-1039：等额削减倒计时与净破坏量（v6.6 2.3 表 #7）、
           ④ 公告、协助人数私聊（不附编号）—— 卡「可见性」行要求齐备；
         · 与查验同夜互斥 —— 由「同属步骤 2 表单的一张菜单」天然保证（已写入 duty.mutex）。
       真正与卡不一致的只有**落位**：卡载协助维修属步骤 4a，实现折进了步骤 2 的菜单。
       这是实现简化（互斥语义未变），故 **不补 actionSteps 的 '4a'**（引擎不在 4a 派发船员，
       补了即造幽灵步位），但须留痕以免日后被误读为「卡与实现一致」。 */
    'crew.assistRepair.stepPlacement': {
      card: '步骤 4a 协助维修（与步骤 2 查验当夜二选一；值 a ∈ [0.20,0.50] 步长 0.05 共 7 档）',
      impl: '已实装且落位已对齐：步骤 2 只开 crewAction（查验），步骤 4a 开 crewRepair（协助维修）；互斥由 p.branch=「check」 与 4a 的 !p.branch 实现',
      verdict: 'done（裁定② · 2026-10-08 让协助维修拆成独立窗口，与查验互斥）',
      note: '行动组合未变：三路效用比较（uCheck/uRepair/不做）仍在步骤 2，4a 只执行预留。若日后要「两步各自重新决策」的语义，需单独批次并单独 A/B。',
    },
    /* 〔v7 速查卡对账 · 第二轮发现〕外星人自我治疗（步骤 8，kind='xenoCure'）：
       声明层未登记额度，全仓检索 cureSelf 只有三处——state.js:40 初始化为 0、
       steps.js:285 使用后置 0、steps.js:1211/1336 读取 `p.cureSelf > 0`。
       **从无任何一处赋正值** ⇒ 该动作在引擎中永久不可用。
       速查卡明载外星人当夜四选一含「自我治疗（步骤 8）：清除自身感染并赋予抗体，
       占用当夜行动名额」，故这是**实现缺口**而非声明错误：补额度声明也不会让它可用。
       实装时须同步：① 每夜到账（卡内未给全局上限 ⇒ 疑为每夜回复，v 待正文确认）
                     ② 赋予抗体（卡内明示，当前 steps.js:1336 分支未见赋予）
                     ③ 与蛰伏／击杀／破坏的当夜互斥（已写入 duty.mutex） */
    /* 〔v7 速查卡补充 · 2026-10-08〕已补齐。保留此条不改名，作为「补引擎」的落地留痕：
        · 额度到账：engine.js 夜间到账区赋 cureSelf —— 原先 cureSelf 全仓从无赋正值
          （state.js:40 初始化 0、steps.js:285 使用后置 0），导致 req（:1211）与
          结算（:1336）恒不命中、自我治疗为死代码；
        · 赋予抗体：steps.js 自我治疗结算补写 antibodyNight/antibodyBy
          （卡两处明写：§外星人核心能力、§v6.5 修订要点⑩抗体赋予主体含外星人自我治疗）。
        [ruling] 额度口径已由用户裁定（2026-10-08），不再是推断：
          **每夜有感染标记自动赋予一次额度**。卡的外星人额度行未列自我治疗，
          初版按「疑为每夜回复」无条件赋 1；现改为以感染标记为前置条件。 */
    'xeno.cureSelf': {
      card: '自我治疗（步骤 8）：清除自身感染并赋予抗体，占用当夜行动名额；与蛰伏/击杀/破坏四选一',
      declared: 'charges.cureSelf = Infinity（额度按裁定随感染标记逐夜发放）；duty.mutex 含 selfHeal',
      impl: '已实装：engine.js 在有感染标记的夜晚到账 cureSelf=1；steps.js 结算写 antibodyNight 并清感染',
      verdict: 'done（额度口径已裁定，见 ruling）',
      ruling: '用户裁定 2026-10-08：每夜有感染标记自动赋予一次额度。理由——自我治疗的效果是「清除自身感染并赋予抗体」，无感染标记时该动作无对象，额度与效果同条件成立才自洽。行为变化：无感染标记的外星人当夜不再得到额度（窗口收窄，属裁定的直接后果而非副作用）。',
      openQuestion: '额度是否跨夜累积未规定。当前实现＝只在有标记时赋值、不清零，故未用额度保留到下一夜。若裁定要求累积或到期作废，改 engine.js 一行即可。',
    },
    /* 〔v7 速查卡对账 · 第二轮发现〕毒师制药：角色声明层 grants 已含 'brew'（卡内明载
       医生族通有制药 3.3.1），但进程注册表 SKProcess.brew.owner = [bio, rescue, tempdoc]
       **未含 poisoner** ⇒ 毒师即使坐上席位也开不了制药。
       当前不可观测（医生位 seats 固定 ['bio','rescue']，毒师不在开局席位内，见 GROUP_TABLE），
       故为潜伏缺口：席位表一旦改为三选一即暴露。 */
    /* 〔v7 速查卡补充 · 2026-10-08〕已补齐。保留此条作为「声明与进程引擎对齐」的留痕。 */
    'poisoner.brewProcess': {
      card: '步骤 8：制药／毒药／解药／制药产出的救援／治疗——五选一（毒师无自救额度）；制药为医生族通有（3.3.1）',
      declared: "ROLE_DECL.poisoner.grants 含 'brew'（上一轮依卡补入）",
      impl: "已实装：processRegistry.brew.owner 已补 'poisoner'（原缺 ⇒ 声明说能制药而进程引擎不认）",
      verdict: 'done（潜伏缺陷已消除；毒师不在开局席位故此前不可观测）',
    },
  };
  /** 累计维修暴露阈值（4.3.6）：工程师 4.0 / 助理 3.0；未声明即 null（不适用） */
  function repairExposeAtOf(key) {
    const d = has(key) ? ROLE_DECL[key] : null;
    return d && typeof d.repairExposeAt === 'number' ? d.repairExposeAt : null;
  }
  /** 某个能力档的全部角色键（声明序；供仍以「清单」形态消费的调用点保持等价） */
  function rolesWithCapClass(cc) {
    return keys().filter(k => ROLE_DECL[k].capClass === cc);
  }
  /** 转职方向池（声明序；顺序敏感——rng.pick 的输入，必须与历史字面量逐项同序） */
  function transferRoles() {
    return keys().filter(k => ROLE_DECL[k].transferred === true);
  }
  /** 非人类阵营的开局席位组成（按阵营声明序展开；state.js 组局基座） */
  function nonHumanSetup() {
    const out = [];
    for (const f of Object.keys((global.SKData && global.SKData.FACTION) || {})) {
      if (f === 'human') continue;
      for (const k of keys()) {
        if (ROLE_DECL[k].faction !== f) continue;
        const n = ROLE_DECL[k].seats || 0;
        for (let i = 0; i < n; i++) out.push(k);
      }
    }
    return out;
  }
  /** 职业余额表（UI 显示方案 1.3）：每个角色的开局名额 = 人类席位 + 阵营席位 */
  function roleTotals() {
    const t = {};
    for (const k of keys()) t[k] = ROLE_DECL[k].seats || 0;
    for (const k of humanSetup()) t[k] = (t[k] || 0) + 1;
    return t;
  }

  /* ---------- A3 组位表驱动：开局人类席位组成（替代 data.js 的 11 项硬编码） ----------
     规则依据 2.8.14 组位表：基础位合计恒 4、查证位 1、工程位 1、猎杀位 1、社交位 1、
     防御位 1、医生位 2 ＝ 11 席；转职分支（基础位·X）随转职变动、不占开局席位。 */
  function humanSetup() {
    return Object.keys(GROUP_TABLE)
      .filter(g => GROUP_TABLE[g].seatOrder !== null)
      .sort((a, b) => GROUP_TABLE[a].seatOrder - GROUP_TABLE[b].seatOrder)
      .reduce((acc, g) => acc.concat(GROUP_TABLE[g].seats), []);
  }
  /** 席位容量核（与 2.8.14 组位表逐项比对；返回违规清单） */
  function seatAudit() {
    const bad = [];
    for (const g of Object.keys(GROUP_TABLE)) {
      const t = GROUP_TABLE[g];
      if (t.capacity === null) continue;
      if (t.seats.length !== t.capacity) bad.push(`组位 ${g}: 席位 ${t.seats.length} ≠ 2.8.14 容量 ${t.capacity}`);
      /* 席位成员必须是该组位规则成员的子集（不推定能力，但不得越组） */
      for (const s of t.seats) if (t.members.indexOf(s) < 0) bad.push(`组位 ${g}: 席位 ${s} 不在 2.8.14 成员表内`);
    }
    return bad;
  }

  /* ---------- 自检：返回违规清单（空数组＝合规），不在运行期抛错 ---------- */
  function audit() {
    const bad = [];
    const factions = (global.SKData && global.SKData.FACTION) ? Object.keys(global.SKData.FACTION) : null;
    for (const k of keys()) {
      const d = ROLE_DECL[k];
      /* 1. 阵营键必须已登记 */
      if (factions && factions.indexOf(d.faction) < 0) bad.push(`${k}: 未登记阵营键 ${d.faction}`);
      /* 2. 组位键必须存在于 2.8.14 组位表；异形/外星人须为 null（⑤） */
      if (d.group !== null && !GROUP_TABLE[d.group]) bad.push(`${k}: 未登记组位 ${d.group}`);
      if ((d.faction === 'alien' || d.faction === 'xeno') && d.group !== null)
        bad.push(`${k}: 非人类阵营不得设组位（2.8.14⑤）`);
      if (d.faction === 'human' && d.group === null)
        bad.push(`${k}: 人类角色缺组位声明（2.8.14③ 单归取主职能）`);
      /* 3. 判定基准取值必须合法（2.8.1） */
      if (['check', 'presented', 'faction'].indexOf(d.judgeMode) < 0 && d.judgeMode !== undefined)
        bad.push(`${k}: judgeMode 非法取值 ${d.judgeMode}`);
      /* 4. 组位单归：一个角色只能出现在一个组位里（本表结构天然保证，防手改重复声明） */
      const hits = Object.keys(GROUP_TABLE).filter(g => rolesOfGroup(g).indexOf(k) >= 0);
      if (hits.length > 1) bad.push(`${k}: 组位多重归属 ${hits.join('/')}（2.8.14③）`);
      /* 5. 转职系角色必须落在基础位分支（2.8.14②） */
      if (d.transferred && TRANSFER_BRANCHES.indexOf(d.group) < 0)
        bad.push(`${k}: 转职系角色组位应为基础位分支，实为 ${d.group}`);
      /* 6. 声明不得与 DEFAULTS 的键冲突（防新字段漏进 schema）；
            〔第二十四批〕改为按 EXTRA_FIELDS 白名单判定——白名单本身即「字段语义已登记」的声明 */
      for (const f of Object.keys(d)) {
        if (Object.prototype.hasOwnProperty.call(SCHEMA, f)) continue;
        if (Object.prototype.hasOwnProperty.call(EXTRA_FIELDS, f)) continue;
        if (f === 'key' || f === 'undeclared' || f === 'transferred') continue;
        bad.push(`${k}: 字段 ${f} 未登记于 SCHEMA/EXTRA_FIELDS（附录 C）`);
      }
    }
    /* 6.5 〔第二十四批 · 声明-消费契约〕每个已登记字段必须声明 life 且取值合法。
           这条门禁的作用是：让「零消费的声明」从**看不出来**变成**必须写明**——
           否则 archived 字段与 wired 字段长得一模一样，谁也不知道哪个真的在跑。 */
    for (const [name, spec] of Object.entries(SCHEMA))
      if (LIFE.indexOf(spec.life) < 0) bad.push(`SCHEMA.${name}: life 非法或缺失（须为 ${LIFE.join('/')}）`);
    for (const [name, spec] of Object.entries(EXTRA_FIELDS))
      if (LIFE.indexOf(spec.life) < 0) bad.push(`EXTRA_FIELDS.${name}: life 非法或缺失`);
    /* 6.6 archived 字段必须在 desc 里写明「零消费」的理由（防止无主闲置） */
    for (const [name, spec] of [...Object.entries(SCHEMA), ...Object.entries(EXTRA_FIELDS)])
      if (spec.life === 'archived' && spec.desc.indexOf('零消费') < 0)
        bad.push(`${name}: life=archived 但 desc 未说明「零消费」理由（闲置须有主）`);
    /* 7. 组位容量：人类席位总数须等于 HUMAN_SETUP 长度（2.8.14 组位表核算） */
    const cap = Object.keys(GROUP_TABLE)
      .filter(g => TRANSFER_BRANCHES.indexOf(g) < 0)          // 转职分支不占基础席位（随转职变动）
      .reduce((s, g) => s + (GROUP_TABLE[g].capacity || 0), 0);
    if (global.SKData && global.SKData.HUMAN_SETUP && cap !== global.SKData.HUMAN_SETUP.length)
      bad.push(`组位容量核算 ${cap} ≠ HUMAN_SETUP 长度 ${global.SKData.HUMAN_SETUP.length}`);
    /* 8. 组位席位表自检（逐项对 2.8.14） */
    for (const v of seatAudit()) bad.push(v);
    /* 9. D6：能力标签必须在词表内（防手写错标签 → 静默无人命中）；能力档取值合法；
          标签名不得与角色键/阵营键同名（D5 命名空间——同名会让「问能力」与「问身份」混淆） */
    for (const k of keys()) {
      for (const g of (ROLE_DECL[k].grants || [])) {
        if (!GRANT_VOCAB[g]) bad.push(`${k}: 能力标签 ${g} 未登记于 GRANT_VOCAB`);
        if (has(g)) bad.push(`能力标签 '${g}' 与角色键同名（D5）`);
        if (factions && factions.indexOf(g) >= 0) bad.push(`能力标签 '${g}' 与阵营键同名（D5）`);
      }
      const cc = ROLE_DECL[k].capClass;
      if (cc !== undefined && cc !== null && ['high', 'mid', 'low'].indexOf(cc) < 0)
        bad.push(`${k}: capClass 非法取值 ${cc}`);
      const re = ROLE_DECL[k].repairExposeAt;
      if (re !== undefined && re !== null && (typeof re !== 'number' || re <= 0))
        bad.push(`${k}: repairExposeAt 非法 ${re}`);
    }
    /* 11. 〔v7 速查卡〕duty 取值须落在三张词表内（防手写错键 → 静默无人命中） */
    for (const k of keys()) {
      const du = ROLE_DECL[k].duty;
      if (!du) continue;
      for (const f of Object.keys(du))
        if (['mutex', 'senses', 'cost'].indexOf(f) < 0) bad.push(`${k}: duty.${f} 不是合法子键（须为 mutex/senses/cost）`);
      for (const a of (du.mutex || []))
        if (!DUTY_ACTION[a]) bad.push(`${k}: duty.mutex 的 ${a} 未登记于 DUTY_ACTION`);
      for (const sn of (du.senses || []))
        if (!DUTY_SENSE[sn]) bad.push(`${k}: duty.senses 的 ${sn} 未登记于 DUTY_SENSE`);
      if (du.cost && !DUTY_COST[du.cost]) bad.push(`${k}: duty.cost 的 ${du.cost} 未登记于 DUTY_COST`);
      /* 互斥组去重：重复登记说明抄错，无语义价值 */
      if (new Set(du.mutex || []).size !== (du.mutex || []).length) bad.push(`${k}: duty.mutex 有重复项`);
    }
    /* 12. 互斥组里出现该角色根本不具备的动作 ⇒ 声明自相矛盾（mutex ⊆ charges∪grants 的动作身份） */
    /* mutex 的动作身份有**四类**合法来源，缺一即误报：
       ① 该角色的 charges 键（多数）
       ② 该角色的 grants 标签（医生族的 brew 是 grant 不是 charge）
       ③ **进程注册表所有者**（roleDecl.js:50 明载：进程型产出由 SKProcess 声明、
          不进 charges —— 工匠的 cast/castFast 正属此类，第一轮口径漏了它）
       ④ **IMPL_GAP 已登记者**（声明就位、等机制上线：卡载而引擎零实现，
          补声明也不会让它可用，但 mutex 仍须按卡登记 —— 如 xeno.selfHeal） */
    const PROC_OWNER = {};
    if (global.SKProcess && global.SKProcess.keys) {
      for (const pid of global.SKProcess.keys()) {
        const e = global.SKProcess.get(pid);
        for (const o of (e.owner || [])) (PROC_OWNER[o] = PROC_OWNER[o] || []).push(pid);
      }
    }
    const GAP_KEYS = Object.keys(IMPL_GAP);
    const ALIAS = { assistRepair: 'assistRepair', treat: 'treat', selfSave: 'selfSave', brew: 'brew',
      save: 'save', poison: 'poison', antidote: 'antidote', verify: 'verify', shoot: 'gun',
      patrol: 'patrol', kill: 'kill', infect: 'infect', destroy: 'destroy', cocoon: 'cocoon',
      lurk: 'check', selfHeal: 'cureSelf', revive: 'revive', meeting: 'meeting', report: 'report',
      cast: 'cast', castFast: 'castFast', distribute: 'armorStock', protect: 'protect',
      announce: 'announce', publish: 'report', wiretap: 'wiretap', morph: 'morph', disguise: 'disguise' };
    for (const k of keys()) {
      for (const a of mutexOf(k)) {
        const internal = ALIAS[a] || a;
        const ch = ROLE_DECL[k].charges || {}, gr = ROLE_DECL[k].grants || [];
        const procOwned = (PROC_OWNER[k] || []).indexOf(a) >= 0 || (PROC_OWNER[k] || []).indexOf(internal) >= 0;
        const gapKnown = GAP_KEYS.some(gk => gk.indexOf(k + '.') === 0);
        if (!(internal in ch) && gr.indexOf(a) < 0 && !procOwned && !gapKnown)
          bad.push(`${k}: duty.mutex 含「${a}」，但该动作不在 charges / grants / 进程注册表 / IMPL_GAP 任何一处（自相矛盾）`);
      }
    }
    /* 10. D8：席位常数须为非负整数；人类阵营不得用 seats（人类席位由组位表给出） */
    for (const k of keys()) {
      const s = ROLE_DECL[k].seats;
      if (s === undefined) continue;
      if (typeof s !== 'number' || s < 0 || s % 1 !== 0) bad.push(`${k}: seats 非法 ${s}`);
      if (ROLE_DECL[k].faction === 'human') bad.push(`${k}: 人类阵营不得声明 seats（改用组位表席位）`);
    }
    return bad;
  }

  /* ---------- 闲置资源台账（idleLedger）----------
     〔第二十四批 · 模块化标准化〕把「声明了但没人用」的东西**显式列出来并分类**，
     而不是让它们混在声明里看不出来。分类：
       archived —— 合规留痕，永久零消费（改了也不影响对局；删了会丢审计线索）
       pending  —— 等机制上线后接线（A6 五变体等），接线前不算闲置也不算可用
     输出一份可直接进交接文档的清单，使「闲置」可被审计、可被交接、可被定期清理。 */
  function idleLedger() {
    const archFields = [], pendFields = [];
    for (const [n, s] of Object.entries(SCHEMA)) (s.life === 'archived' ? archFields : s.life === 'pending' ? pendFields : []).push(n);
    for (const [n, s] of Object.entries(EXTRA_FIELDS)) (s.life === 'archived' ? archFields : s.life === 'pending' ? pendFields : []).push(n);
    const undeclared = keys().filter(k => ROLE_DECL[k].undeclared);
    const noProcRole = keys().filter(k => !ROLE_DECL[k].process);   // process 字段 archived ⇒ 全员为零
    /* owner 指向未声明角色的进程（真正的「待机制上线」闲置，须随角色实装才接线） */
    const REG = global.SKProcess;
    const orphanProcs = REG ? REG.keys().filter(id =>
      (REG.get(id).owner || []).some(o => !has(o))) : [];
    return {
      archivedFields: archFields,
      pendingFields: pendFields,
      undeclaredRoles: undeclared,
      orphanProcesses: orphanProcs,
      note: 'archived＝永久零消费（合规留痕）；pending＝等机制上线；orphanProcesses 的 owner 角色尚未声明',
    };
  }

  global.SKRoleDecl = {
    SCHEMA, EXTRA_FIELDS, LIFE, DEFAULTS, GROUP_TABLE, TRANSFER_BRANCHES, ROLE_DECL, NAMESPACE, GRANT_VOCAB,
    DUTY_ACTION, DUTY_SENSE, DUTY_COST, IMPL_GAP, mutexOf, sensesOf, costOf, hasSense, mutexBlocked,
    keys, has, resolveDecl, audit, seatAudit, namespaceAudit, idleLedger,
    baseHumanRoles, humanRoles, verifyPoolAll, verifyPoolOf, rolesOfFaction, rolesOfGroup, attendWeight, attendFloor: ATTEND_FLOOR, groupOf, humanSetup,
    rolesWith, hasGrant, capClassOf, rolesWithCapClass, transferRoles, nonHumanSetup, roleTotals, repairExposeAtOf,
    unlockOf, selectable, ROLE_UNLOCK,
  };
})(typeof window !== 'undefined' ? window : globalThis);
