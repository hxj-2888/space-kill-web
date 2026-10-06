/* =============================================================
 * 太空杀 · 事件族命名空间契约（v6.6 重构 G1 · 阶段 2 声明层）
 *
 * 职责：给「所有信息出站事件」一个唯一权威命名，供后续四件事共用同一份真源：
 *   · C4 emits 倒排（观测 → 机制）—— 种子＝附录 A 步骤 × 批次表
 *   · C5 actions 倒排（机制 → 候选发出者）
 *   · B4 私有节点只读门控（粒度＝7.2 六类）
 *   · G2 adapter 的事件流契约（UI 只认族名，不认写死的 g.xxx 形状）
 *
 * 规则依据（v6.6 正文，唯一权威源）：
 *   · 2.1.6 公告批次一览 —— 批次〇~⑪ 的内容与发布时点（本表 BATCH 逐条转录）
 *   · 2.1.7 各批次统计口径 —— ③按「查验出手人次」计（不去重）、⑤合并口径、
 *            「当夜为 0 时不发布」＝不发布即为 0（2.1.7 反向表达）
 *   · 7.2 私人反馈（单向知情）—— 7.2.1~7.2.6 六类，不产生公告、不占批次时点、
 *            不列入批次；「以次计」的合并口径依各类 timing
 *   · 7.1.2 / 2.8.7 —— 凡未列入 2.1.6 批次且未经专门条文明文授予可见性者，
 *            一律不公开、不产生公告、不进任何批次
 *   · 附录 A（清单 v1.1 对图 2 的转录）—— 夜间步骤 × 公告批次
 *
 * 设计约定：
 *   · 批次键沿用引擎既有的圈码字符串（'④' 等），与 registry.js HARD_ROUTE /
 *     RELEVANCE 的既有键一致，避免一次性改名污染推理层读数。
 *   · 「非公告统计口径」单列 NON_BATCH：它是 2.1.6 表内被明文排除于公告之外的
 *     条目（感染抑制人数），必须存在以便断言「不发布」，不属于事件族。
 * ============================================================= */
(function (global) {
  /* ---------- 广播事件族：2.1.6 公告批次一览（逐条转录） ---------- */
  const BATCH = {
    '〇': { key: '〇', name: '开局职业公告', timing: '职业选定后·第 1 夜之前',
            content: '本局全部职业构成，含外星人变体', rule: '2.3.0' },
    '①': { key: '①', name: '私聊配对', timing: '步骤 0 后',
            content: '配对关系公开，内容不公开', rule: '2.1.6' },
    '②': { key: '②', name: '异形进化只数', timing: '步骤 0.6 后',
            content: '进化只数（转化不并入、不予公告）', rule: '2.1.6' },
    '③': { key: '③', name: '查验人次与神探公告', timing: '步骤 2 后',
            content: '全部阵营查验出手人次、巡逻统计与神探公告；只报人次，不含结果、目标编号与来源',
            rule: '2.1.6/2.1.7' },
    '④': { key: '④', name: '维修总量与维修者暴露', timing: '步骤 4a 后',
            content: '当夜实际结算维修总量（已计入 2.8.13 削减；削减本身不予通报）＋维修者暴露（编号与呈现职业，不揭示真实阵营与真实职业）',
            rule: '2.1.6/2.8.12④' },
    '⑤': { key: '⑤', name: '破坏总量与停摆', timing: '步骤 4b 后',
            content: '当夜总破坏量（单一数值，不区分来源、不公布执行只数）、净破坏量与停摆触发',
            rule: '2.1.6/2.1.7' },
    '⑥': { key: '⑥', name: '死亡名单与调查报告', timing: '步骤 9 后',
            content: '死亡名单（格式见 4.10）；并附「本夜发生 N 次复生」及剩余次数（不公开被复生者编号）',
            rule: '2.1.6/4.10' },
    '⑦': { key: '⑦', name: '紧急会议背书', timing: '步骤 10 开始时（会议开场）',
            content: '紧急会议召开与验票官编号及身份', rule: '2.1.6/4.9.2' },
    '⑧': { key: '⑧', name: '倒计时值', timing: '步骤 11 后',
            content: '公告显示值，保留 1 位小数，仅供展示；一切判定以内部实际值为准',
            rule: '2.1.6/3.1' },
    '⑨': { key: '⑨', name: '投票总票数', timing: '白天投票后 / 步骤 10 会议投票',
            content: '总票数（不含弃票）', rule: '2.1.6' },
    '⑩': { key: '⑩', name: '驱逐结果', timing: '白天投票后 / 步骤 10 会议投票',
            content: '被驱逐者编号与身份（含真实阵营与呈现职业，2.3.4）', rule: '2.1.6/2.3.4' },
    '⑪': { key: '⑪', name: '窃听报告', timing: '次日白天首次发言前',
            content: '窃听者择定并提交的私聊内容（可经其改写；不暴露窃听者编号），附「不保真」性质标注',
            rule: '2.1.6/4.12.2' },
  };

  /* 2.1.6 表内被明文排除于公告之外的条目（存在但不可见，用于「不发布」断言） */
  const NON_BATCH = {
    '感染抑制人数': { name: '感染抑制人数（非公告统计口径·仅供索引）', visibleTo: '任何阵营均不可见',
                      rule: '2.1.6/3.3.7' },
  };

  /* ---------- 在案待裁决批次（登记 ≠ 认可；用于把「未登记即发布」变成可审计项） ----------
     批⑫（医生清除感染出手）已于 2026-10-04 依正文 3.3.7 逐字拍板撤除——
     「医生的清除类出手次数——不设公告批次、不产生任何反馈，任何玩家均无从直接得知」；
     连带 N139/N141（判据=消失夜全场清除次数=0）、B01/C14/C22（读⑫公告）退役，
     N407 收紧为纯私有判据（见 js/infer/modules/ 各文件头注记）。
     本表现为空；新增此类条目必须同时写清裁决项与影响面，禁止悄悄新增批次。 */
  const PENDING_BATCH = {};

  /* ---------- 私有事件族：7.2 私人反馈六类（单向知情） ---------- */
  const PRIVATE = {
    '7.2.1': { key: '7.2.1', name: '被查验者的查验来源反馈',
               triggerStep: ['0.1', '2'],
               content: '仅显示查验来源类别三种——「普通船员」/「神探」/「外星人」；不显示查验者编号、结果与次数',
               timing: '随该查验所在步骤结算完成后立即送达；同一步骤内按类别合并一条，步骤 0.1 与 2 各自独立',
               rule: '7.2.1/167~172' },
    '7.2.2': { key: '7.2.2', name: '攻击方的攻击结果反馈',
               triggerStep: ['5', '6', '7'],
               content: '仅二值——使目标进入濒死→「你的攻击生效」；未造成濒死→「你的攻击无效」；不区分原因、不揭示抵抗来源',
               timing: '攻击结算完成后送达；同一次出手内各份合并为一条汇总并逐份标注；不同出手各自独立',
               rule: '7.2.2/173~176' },
    '7.2.3': { key: '7.2.3', name: '被沉默者的沉默告知',
               triggerStep: ['0.1'],
               content: '告知已被沉默及覆盖期间（当夜夜间主动技能被封锁，投票与私聊不受影响）；不含来源、施加者编号与阵营',
               timing: '施加当夜步骤 0.1 结算后送达；若该玩家当夜步骤 9 死亡结算，本反馈随之失效不补发',
               rule: '7.2.3/177~180' },
    '7.2.4': { key: '7.2.4', name: '外星人的夜晚免疫消耗告知',
               triggerStep: ['0.55', '7'],
               content: '仅三件事——消耗已发生、消耗路径（伤害侧/毒药侧/感染侧）、剩余次数',
               timing: '随该次消耗所在步骤结算后送达；毒药侧与感染侧于步骤 0.55 后，伤害侧于步骤 7 后；同夜多来源仅送达一次',
               rule: '7.2.4/181~184' },
    '7.2.5': { key: '7.2.5', name: '被保护者的保护告知',
               triggerStep: ['3'],
               content: '仅告知「你今夜被保护」；不含是否遭攻击、不含伤害类型、不揭示保护者编号与职业',
               timing: '每执行一次保护即送达一次（以次计，不因对象重复而合并）',
               rule: '7.2.5/185~186' },
    '7.2.6': { key: '7.2.6', name: '结茧护盾的施加告知',
               triggerStep: ['4b'],
               content: '仅告知「你获得一层护盾」；不含施加者编号与职业、不含来源',
               timing: '仅于施加当夜送达一次，存续期间不重复；护盾被打破后再次施加则另行送达',
               rule: '7.2.6/5.7②⑧' },
  };

  /* ---------- 附录 A：夜间步骤 × 公告批次（图 2 转录）----------
     batches=[] 表示该步骤不设批次（含「不予通报」与「归 7.1 不公开」两种口径），
     private 列出该步骤送达的 7.2 私反馈族。 */
  const STEPS = [
    { step: '〇',  phase: 'pre',  what: '开局职业公告：本局全部职业构成，含外星人变体（2.3.0）',
      batches: ['〇'], private: [] },
    { step: 'P-id', phase: 'pre', what: '前置·身份改变：死囚变形 6.8.3③、外星人觉醒 6.2',
      batches: [], private: [] },
    { step: 'P-clean', phase: 'pre', what: '前置·昼末清理：异形清洗 5.9（不占行动与私聊额度）',
      batches: [], private: [], noReport: true },
    { step: '0',   phase: 'night', what: '私聊：每人 1 发起 + 1 接受；异形队内不限',
      batches: ['①'], private: [], participants: 'alive',
      note: '0/0a 面向全体存活非濒死者（社交行动，非职业能力）；0b/0c 由邀请与配对驱动' },
    { step: '0a',  phase: 'night', what: '私聊·发起（配对公告于步骤 0 后随批次①发布）',
      batches: ['①'], private: [], participants: 'alive' },
    { step: '0b',  phase: 'night', what: '私聊·接受（配对成立后随批次①发布配对关系）',
      batches: ['①'], private: [], participants: 'engaged',
      note: '2.1.6 记「步骤 0 后发布」；引擎的实际发布点在本步（配对成立时）——契约按**实际发布点**登记，供步位×批次一致性审计' },
    { step: '0c',  phase: 'night', what: '私聊·异形队内频道（队内不限次数）',
      batches: [], private: [], participants: 'engaged' },
    { step: '0.1', phase: 'night', what: '外星人蛰伏：查验 1 名 + 可选沉默（当夜生效）',
      batches: [], private: ['7.2.1', '7.2.3'], mergeInto: '③' },
    { step: '0.1s', phase: 'night', what: '蛰伏·沉默窗口（A7：蛰伏归 0.1，沉默独立成窗，当夜生效）',
      batches: [], private: ['7.2.3'] },
    { step: '0.2', phase: 'night', what: '窃听者窃听 4.12：读取当夜已公告配对组',
      batches: [], private: [], mergeInto: '⑪' },
    { step: '0.5', phase: 'night', what: '感染抑制：抢先使用可延后 0.55 致死',
      batches: [], private: [], noReport: true,
      capability: 'suppress', factions: ['human', 'xeno'],
      note: '阵营级能力（非职业能力）：非异形阵营每人持有抑制额度 3 次，且须真有感染标记才可出手（state.js:20 / steps.js 步骤 0.5）' },
    { step: '0.55', phase: 'night', what: '感染致死 / 毒药致死：触发者当夜进入濒死',
      batches: [], private: ['7.2.4'] },
    { step: '0.6', phase: 'night', what: '进化 / 转化 / 转职',
      batches: ['②'], private: [] },
    { step: '1',   phase: 'night', what: '乔装 7.3：伪装身份；不占行动窗口',
      batches: [], private: [] },
    { step: '2',   phase: 'night', what: '查验 / 巡逻：船员验证式、神探查验或公告、警长巡逻',
      batches: ['③'], private: ['7.2.1'] },
    { step: '3',   phase: 'night', what: '保镖保护 / 工匠护甲',
      batches: [], private: ['7.2.5'] },
    { step: '3.5', phase: 'night', what: '嗅探（猎手专属 4.4.8）：每夜至多 2 名，全局限 2 夜',
      batches: [], private: [], selfOnly: true },
    { step: '4a',  phase: 'night', what: '维修：工程师 / 助理 −1.0~1.5；船员协助；停转夜无效；破坏进化次夜削减 25%/50%',
      batches: ['④'], private: [] },
    { step: '4b',  phase: 'night', what: '破坏 / 结茧：未进化 +1.5~2.0、破坏进化 +2.0~3.0；异形选此跳过步骤 7',
      batches: ['⑤'], private: ['7.2.6'] },
    { step: '5',   phase: 'night', what: '外星人击杀 / 双刀：两刀连续结算，一次性提交',
      batches: [], private: ['7.2.2'] },
    { step: '6',   phase: 'night', what: '警长 / 猎手 / 武装枪击：可双发、猎手可多发',
      batches: [], private: ['7.2.2'] },
    { step: '7',   phase: 'night', what: '异形行动：未于 4b 行动者，出刀 / 感染二选一',
      batches: [], private: ['7.2.2', '7.2.4'] },
    { step: '8',   phase: 'night', what: '医生 / 毒师 / 死囚复生：治疗/救援/自救/制药/毒药/解药',
      batches: [], private: [], mergeInto: '⑥' },
    { step: '9',   phase: 'night', what: '死亡结算：死亡硬结算点，濒死绝不延续次日',
      batches: ['⑥'], private: [],
      note: '批⑫（医生清除感染出手）已于 2026-10-04 依 3.3.7 撤除——2.1.6 无此批次且「不产生任何反馈」明文；曾以 pendingBatches 在案' },
    { step: '10',  phase: 'night', what: '验票官紧急会议：全场唯一 1 次；召开该夜跳过 11',
      batches: ['⑦', '⑨', '⑩'], private: [] },
    { step: '11',  phase: 'night', what: '倒计时结算：寂灭 / 决斗时刻冻结（拍板 I2 已裁：不冻）；停转夜自然流逝 0',
      batches: ['⑧'], private: [] },
    /* 白天与会议：批次⑨⑩ 在白天另发一次（2.1.6「各发一次」）；
       批次⑪ 窃听报告于「次日白天首次发言前」发布（4.12.2②/2.3.2：先于〇留言与自由
       讨论）——引擎实现为独立的条件性阶段 D-report（无待提交读取时整段不挂队列），
       〔批次 29〕契约按实际发布点登记于 D-report（此前挂 D-talk 系实装前的预置）。
       白天/会议步位同样是「决策窗口」，故纳入同一张表并声明参与者规则
       ——清单 C5 的覆盖口径为「引擎实际派发决策的步位 ⊆ 声明」，白天段不可留白。 */
    { step: 'D-report', phase: 'day', what: '窃听报告提交与发布（条件性阶段：仅窃听者持有当夜读取时挂入）',
      batches: ['⑪'], private: [], roles: ['listener'] },
    { step: 'D-open',  phase: 'day', what: '白天开场（死亡名单与公告宣读）',
      batches: [], private: [], participants: 'alive' },
    { step: 'D-talk',  phase: 'day', what: '白天自由讨论',
      batches: [], private: [], participants: 'alive' },
    { step: 'D-vote',  phase: 'day', what: '白天常规投票（出局者不参与）',
      batches: ['⑨', '⑩'], private: [], participants: 'alive' },
    { step: 'M-talk',  phase: 'day', what: '紧急会议·发言（会议开场后）',
      batches: [], private: [], participants: 'alive' },
    { step: 'M-speech', phase: 'day', what: '验票官专属发言（4.9；会议发起者的专属窗口）',
      batches: [], private: [], roles: ['inspector'] },
    { step: 'M-vote',  phase: 'day', what: '白天常规投票',
      batches: ['⑨', '⑩'], private: [], participants: 'alive' },
  ];

  const STEP_INDEX = {};
  for (const s of STEPS) STEP_INDEX[s.step] = s;

  /** 该步骤发布的广播批次（副本，防调用方改写真源） */
  function batchesOfStep(step) {
    const s = STEP_INDEX[step];
    return s ? s.batches.slice() : [];
  }
  /** 该步骤发布的批次**含在案待裁决批次**（供步位 × 批次一致性审计；正式口径见 batchesOfStep） */
  function batchesOfStepAll(step) {
    const s = STEP_INDEX[step];
    if (!s) return [];
    return s.batches.concat(s.pendingBatches || []);
  }
  /** 该步骤送达的私有反馈族（副本） */
  function privateOfStep(step) {
    const s = STEP_INDEX[step];
    return s ? s.private.slice() : [];
  }
  /** 观测（广播批次键）的权威定义；未登记返回 null（在案待裁决项走 pendingBatch） */
  function batch(key) { return BATCH[key] || null; }
  /** 在案待裁决批次（登记在册但未获规则方批准，禁止再新增此类条目） */
  function pendingBatch(key) { return PENDING_BATCH[key] || null; }
  function privateFamily(key) { return PRIVATE[key] || null; }
  function isPrivateFamily(key) { return Object.prototype.hasOwnProperty.call(PRIVATE, key); }

  /** 命名空间自检：返回违规清单（空数组＝合规）。供 H 组断言调用，不在运行期抛错。 */
  function audit() {
    const bad = [];
    /* 1. 批次键与私反馈键不得重名（两个命名空间须可判别） */
    for (const k of Object.keys(BATCH))
      if (isPrivateFamily(k)) bad.push(`批次键与私反馈键重名：${k}`);
    /* 2. STEPS 里引用的批次/私反馈键必须已登记（防手写错键） */
    for (const s of STEPS) {
      for (const b of s.batches)
        if (!BATCH[b]) bad.push(`步骤 ${s.step} 引用了未登记批次 ${b}`);
      for (const p of s.private)
        if (!PRIVATE[p]) bad.push(`步骤 ${s.step} 引用了未登记私反馈 ${p}`);
      if (s.mergeInto && !BATCH[s.mergeInto] && !NON_BATCH[s.mergeInto])
        bad.push(`步骤 ${s.step} 的 mergeInto 未登记：${s.mergeInto}`);
    }
    /* 3. 每批次必须至少被一个步骤引用（否则该族永不产生，属死配置） */
    for (const k of Object.keys(BATCH)) {
      if (k === '〇') continue;                       // 〇 属开局，不在夜间队列表内
      if (!STEPS.some(s => s.batches.indexOf(k) >= 0)) bad.push(`批次 ${k} 无任何步骤引用`);
    }
    /* 4. 在案待裁决批次不得与正式批次重键，且必须写清裁决项与影响面（防悄悄新增批次） */
    for (const k of Object.keys(PENDING_BATCH)) {
      const p = PENDING_BATCH[k];
      if (BATCH[k]) bad.push(`待裁决批次 ${k} 与正式批次重键`);
      if (!p.status || !p.rule) bad.push(`待裁决批次 ${k} 缺裁决项或规则出处`);
      if (!p.affects || !p.affects.length) bad.push(`待裁决批次 ${k} 未标注影响面（撤除会波及哪些判据）`);
    }
    /* 5. 步位上登记的 pendingBatches 必须确实是在案待裁决批次（防把正式批次塞进 pending 绕开审计） */
    for (const s of STEPS) {
      for (const b of (s.pendingBatches || [])) {
        if (!PENDING_BATCH[b]) bad.push(`步骤 ${s.step} 的 pendingBatches 含未登记的待裁决批次 ${b}`);
        if (BATCH[b]) bad.push(`步骤 ${s.step} 把正式批次 ${b} 写进了 pendingBatches`);
      }
    }
    return bad;
  }

  global.SKEventFamily = {
    BATCH, NON_BATCH, PRIVATE, PENDING_BATCH, STEPS, STEP_INDEX,
    batchesOfStep, batchesOfStepAll, privateOfStep, batch, pendingBatch, privateFamily, isPrivateFamily, audit,
  };
})(typeof window !== 'undefined' ? window : globalThis);
