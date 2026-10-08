'use strict';
/* ============================================================================
 * v7 · 速查卡 × 声明层（roleDecl.js）逐条对账
 * 依据源：docs/太空杀规则职业速查卡v6.6_依正文同步.pdf（7 页，34833 B）
 * 真源地位：roleDecl.js:4 「声明层是唯一真相源」——故速查卡与声明层不一致时，
 *           修声明层（前提是卡为正文口径），不改引擎。
 * 本脚本只做审计与落表，不改引擎行为。
 * ==========================================================================*/
const fs = require('fs');
const path = require('path');
const repo = 'C:/Users/ASUS/Desktop/太空杀游戏-完整版';

function loadOrder(root) {
  const src = fs.readFileSync(path.join(root, 'tools', 'load-order.cjs'), 'utf8');
  const m = { exports: {} };
  new Function('require', 'module', 'exports', '__dirname', '__filename', src)(
    require, m, m.exports, path.join(root, 'tools'), 'x');
  return m.exports;
}
const { makeCtx, loadInto, profiles } = loadOrder(repo);
const ctx = makeCtx({});
loadInto(ctx, path.join(repo, 'js'), profiles.full);
const RD = ctx.SKRoleDecl;

/* ---------------------------------------------------------------------------
 * 速查卡逐角色要点（人工转录，每条附卡内原句关键词以便复核）
 * mutex：卡片明写的「当夜 X 选一」；senses：卡片「可见性」行明写的可查知项；
 * steps：卡片「夜间行动」行明写的步骤号。
 * -------------------------------------------------------------------------*/
const CARD = {
  crew: {
    steps: ['2', '4a'],
    quote: '夜间行动：步骤 2 查验 ｜ 步骤 4a 协助维修（二者当夜二选一，亦可依 2.4 放弃行动）',
    mutex: ['verify', 'assistRepair'],
    mutexQuote: '二者当夜二选一',
    senses: ['selfClaimLog'],
    sensesQuote: '仅查验者本人可见其对该目标的历次查证问题与结论；当夜协助维修者可见人数 N（不附编号）',
    quotas: '每夜 1 次（查验与协助维修二选一）；协助维修值 a ∈ [0.20,0.50] 步长 0.05 共 7 档',
    cost: null,
  },
  engineer: {
    steps: ['4a', '3'],
    quote: '夜间行动：步骤 4a 维修（＋ 追加维修）；亦可放弃行动 ／ 安全室（限定技·全局 1 次·步骤 3）',
    mutex: null, mutexQuote: null,
    senses: ['ownRepairTotal', 'ownExposeRemain'],
    sensesQuote: '可自行查看累计维修量、距暴露阈值剩余量与「已暴露」状态（仅本人可见）',
    quotas: '维修每夜 −1.0~1.5（步长 0.1，共 6 档），当夜合计最高 −3.0；追加维修全局 3 次',
    cost: null,
  },
  sheriff: {
    steps: ['6', '2'],
    quote: '夜间行动：步骤 6 开枪 ｜ 步骤 2 巡逻；两者同一夜二选一（互斥不永久）',
    mutex: ['shoot', 'patrol'],
    mutexQuote: '两者同一夜二选一（互斥不永久）',
    senses: ['ownAmmo', 'armedCrewIds'],
    sensesQuote: '可见自己的子弹余量 … 可见武装船员编号',
    quotas: '初始 1 发；第 5 夜 ＋1（全局仅此 1 次）；全场存活 ≤ 6 名 ＋1（全局仅此 1 次）；两项独立可叠加，但到账后存量不得超过 2 发',
    cost: 'canHitFriendlies（枪击可命中任何存活角色，含人类队友）',
  },
  hunter: {
    steps: ['6', '3.5'],
    quote: '夜间行动：步骤 6 开枪 … 亦可于步骤 3.5 发动嗅探（不占行动窗口，可与开枪并用）',
    mutex: null,
    mutexQuote: '嗅探不占行动窗口，可与开枪并用 ⇒ 6 与 3.5 不互斥',
    senses: ['ownAmmo', 'sniffResult'],
    sensesQuote: '可见自己的子弹余量；嗅探结果仅本人可见，不区分何种保护、不报层数与来源',
    quotas: '子弹初始 1 发，不受 2 发存储上限约束；攒弹制式同制药（固定投入 2 个夜晚，可中断、进度保留）；嗅探全局 2 个夜晚、每夜至多 2 名',
    cost: 'sniffMissesSafeRoom（嗅探不显示全额减免，「未呈现保护状态」不等于「可以一击致死」）',
  },
  bio: {
    steps: ['8'],
    quote: '夜间行动：步骤 8：治疗 ／ 自救 ／ 制药三者互斥（亦可整晚不出手）',
    mutex: ['treat', 'selfSave', 'brew'],
    mutexQuote: '治疗／自救／制药三者互斥',
    senses: ['infectMarks', 'antibodyFeedback'],
    sensesQuote: '可见「谁带有感染标记」（仅编号清单，不显真伪、施加时间与剩余致死夜数）；抗体生效时获「你赋予的抗体生效了」之反馈',
    quotas: '治疗额度按夜上限 3 次（第 1、2、3 夜各 1，第 4 夜不获得），被动到账，未使用可跨夜累积；制药产出属额外来源，不受该上限约束',
    cost: null,
  },
  rescue: {
    steps: ['8'],
    quote: '夜间行动：步骤 8：救援（含自救）／ 治疗 ／ 制药三者互斥',
    mutex: ['save', 'treat', 'brew'],
    mutexQuote: '救援（含自救）／治疗／制药三者互斥',
    senses: ['infectMarks', 'dyingList', 'deathSourceAfterSave'],
    sensesQuote: '可见「谁带有感染标记」与「谁处于濒死」；但落身致死来源清单仅在实际执行救援、消耗救援额度后才可见',
    quotas: '救援额度上限 2 次（第 1、2 夜各 1，第 3、4 夜不获得），被动到账，未使用可跨夜累积；治疗额度 1 次',
    cost: 'canSaveAnyone（救援可救任意濒死角色，不限阵营，含自身、异形、外星人）',
  },
  poisoner: {
    steps: ['8'],
    quote: '夜间行动：步骤 8：制药 ／ 毒药 ／ 解药 ／ 制药产出的救援 ／ 治疗——五选一（毒师无自救额度）',
    mutex: ['brew', 'poison', 'antidote', 'brewSave', 'treat'],
    mutexQuote: '五选一（毒师无自救额度）',
    senses: ['poisonList', 'infectMarks', 'dyingList'],
    sensesQuote: '毒师本人可见全场毒药清单；被下毒者本人可见自身中毒；其余一律不公开。另依医生族通有：可见感染标记清单与当夜濒死者',
    quotas: '毒药 3（第 1、3、5 夜各 1）、解药 3（同制）；依 2.1.5 默认时序到账，到账当夜即可使用。无击杀回复、无补充途径，容错为零',
    cost: 'poisonHitsAlly（毒药不辨阵营——队友与自身皆为合法目标，误伤无第三方补救）',
  },
  detective: {
    steps: ['2'],
    quote: '夜间行动：步骤 2：查验 或 发布官方公告（二者二选一）',
    mutex: ['verify', 'announce'],
    mutexQuote: '二者二选一',
    senses: ['checkPool', 'presentedRoleOnly'],
    sensesQuote: '已查验池存储「查验当夜所显示的职业」，不随此后转职而更新；池为神探个人所有，神探死亡后其池作废 ／ 恒依呈现职业如实作答、不作假（不报阵营）',
    quotas: '每夜 1 次（查验与发布公告二选一）',
    cost: 'checkRevealsSelf（明文代价：被查验者会依 7.2.1 收到来源类别为「神探」的私人反馈，故神探每查验一人即向该目标暴露「场上有神探在活动」）',
  },
  bodyguard: {
    steps: ['3'],
    quote: '每夜保护 1 人：抵挡 1 点伤害，同时抵挡 1 次感染（双计数独立）；受袭感知',
    mutex: null,
    senses: ['guardFeedback', 'attackTypeOnGuard'],
    sensesQuote: '受袭感知——被保护时获知伤害类型 ／ 保镖只报伤害类型、不报凶手编号；被保护者本人可见其被保护（7.2.5）',
    quotas: '每夜 1 次；不可连续两夜保护同一目标',
    cost: null,
  },
  artisan: {
    steps: ['3'],
    quote: '工匠 · 核心：三选一：常规铸造〔投入 2 夜〕／ 速成铸造〔投入 1 夜〕／ 分配护甲',
    mutex: ['cast', 'castFast', 'distribute'],
    mutexQuote: '三选一',
    senses: ['ownArmorStock'],
    sensesQuote: '（卡内未列主动可见项；护甲为「不公开而持有者自知，无受袭感知」）',
    quotas: '初始自带 1 件常规护甲已装备于自身，不可发配，不计入库存；库存上限 2（仅约束未分配部分）；同一目标至多持有 1 件护甲。护甲抵挡 1 点伤害与 1 次感染',
    cost: 'noAttackFeedback（工匠护甲 … 不公开而持有者自知，无受袭感知）',
  },
  inspector: {
    steps: ['10'],
    quote: '核心能力：白天可见全部票源编号；可发动紧急会议（步骤 10，全场唯一 1 次）',
    mutex: null,
    senses: ['allVoteSources', 'allBallotCounts'],
    sensesQuote: '白天可见全部票源编号 ／ 公开票源图 全局 1 次，随会议发动，可选择场次与数目；公开即永久、官方背书',
    quotas: '紧急会议：全场唯一 1 次，存活 ≥ 5 且自身存活时发动，于该夜步骤 10 发动，发动当夜跳过步骤 11；会议中获 30 秒专属发言；公开票源图 全局 1 次',
    cost: 'meetingRevealsSelf（会议开场即公告其编号与身份（批次⑦），故发动即暴露身份）',
  },
  listener: {
    steps: ['0.2'],
    quote: '窃听者 · 核心：步骤 0.2 读取当夜批次①已公告配对组之私聊内容，可读取当夜全部分组（不设组数上限）；每夜可提交 1 次',
    mutex: ['report', 'publish'],
    mutexQuote: '每夜可提交 1 次——择一组改写为「报告」，或择一组原样「公示」其私聊内容，二者共用该每夜 1 次',
    senses: ['pairedPrivateChats'],
    sensesQuote: '读取当夜批次①已公告配对组之私聊内容，可读取当夜全部分组（不设组数上限）',
    quotas: '读取每夜可发动、不设组数上限；报告每夜 1 次（卡内未载全局上限，roleDecl 写 report:2 全局 2 次 → 需正文确认）',
    cost: 'reportNotFaithful（报告可自由改写，系统不校正；报告与公示均附「不保真」性质标注；不暴露窃听者编号）',
  },
  alien: {
    steps: ['7', '4b', '1'],
    quote: '每夜出刀／感染／破坏／结茧四选一（破坏／结茧在步骤 4b，出刀／感染在步骤 7）；另可清洗（独立阶段）与乔装（步骤 1）',
    mutex: ['kill', 'infect', 'destroy', 'cocoon'],
    mutexQuote: '每夜出刀／感染／破坏／结茧四选一',
    senses: ['teammateIdentities', 'teammateBallots'],
    sensesQuote: '互相知晓队友身份，队内私聊无限制 ／ 异形阵营可见本方队友票型分布',
    quotas: '出刀 1 点伤害（可对自己出刀＝自杀）；感染每夜至多 2 名，仅感染进化者至多 3 名；破坏未进化 ＋1.5~2.0、破坏进化 ＋2.0~3.0；结茧可指定任意 1 名存活玩家（不限阵营），每目标同时至多 1 层、被打破后可再施加',
    cost: null,
    layerNote: '结茧：存续型，抵挡 1 点伤害、不抵挡感染',
  },
  xeno: {
    steps: ['0.1', '5', '4b', '8'],
    quote: '夜间行动：蛰伏（步骤 0.1）／ 击杀（步骤 5）／ 破坏（步骤 4b）／ 自我治疗（步骤 8）四选一；觉醒后步骤 5 可出双刀',
    mutex: ['lurk', 'kill', 'destroy', 'selfHeal'],
    mutexQuote: '四选一',
    senses: ['ownNightImmuneRemain', 'lurkTargetPresented'],
    sensesQuote: '夜晚免疫额度被消耗时送达，告知消耗已发生、消耗路径与剩余次数，使其可核算余量 ／ 蛰伏：查验 1 名目标并可附加沉默（当夜生效）；允许连续两夜查验同一目标',
    quotas: '夜晚免疫 开局 1 次 ＋ 第 7 夜 1 次，全局共 2 次（仅于致死一刻消耗额度拦截）；破坏全局 1 次，触发停转夜；觉醒后每夜至多 2 刀；乔装全局 2 次',
    cost: null,
    layerNote: '夜晚免疫＝全额减免层（先于一切抵挡层，且不消耗任何其他层）',
  },
  convict: {
    steps: ['P-id', '8'],
    quote: '变形：可变为任意非转职职业，可骗过神探；任一夜晚均可变形，变形后 2 夜冷却 ／ 复生：步骤 8，全场 2 次，可自救',
    mutex: null,
    senses: ['mirrorLedger', 'morphTargetPool'],
    sensesQuote: '呈现异形时克隆除社交与队内共享外的一切技能与被动',
    quotas: '变形：2 夜冷却（未变形不冷却）；复生 全场 2 次',
    cost: null,
  },
  armed: {
    steps: ['6'], quote: '开枪（规则同警长）', mutex: null, senses: ['ownAmmo'],
    sensesQuote: '与警长双向识别；因仅 1 发，每夜至多指定 1 名；持有量恒 ≤ 1，不适用 2 发上限',
    quotas: '1 发；悬赏回复同警长',
    cost: null,
  },
  assistant: {
    steps: ['4a'], quote: '每夜维修 −1.0~1.5（自选，步长 0.1）', mutex: null, senses: ['ownRepairTotal', 'ownExposeRemain'],
    sensesQuote: '累计维修 3.0 即暴露（正牌工程师为 4.0）；暴露只报「编号＋呈现职业」，不报真实阵营；转职前累积的协助维修量不并入',
    quotas: '无追加维修', cost: null,
  },
  tempdoc: {
    steps: ['8'], quote: '救援（不限阵营）＋ 治疗（不赋抗体）；可见谁处于濒死',
    mutex: ['save', 'treat', 'brew'],
    mutexQuote: '每晚仅一类出手；救援后可见该目标濒死原因',
    senses: ['infectMarks', 'dyingList', 'deathSourceAfterSave'],
    sensesQuote: '可见感染标记清单与当夜濒死者；落身致死来源清单仍以实际执行救援为条件',
    quotas: '救援 1 次；治疗 2 次', cost: null,
  },
};

/* ---------------------- 对账 ---------------------- */
const rows = [];
const NL = String.fromCharCode(10);
for (const key of Object.keys(CARD)) {
  if (!RD.has(key)) { rows.push({ key, sev: 'P0', kind: '声明缺失', detail: `速查卡有此角色，roleDecl 未声明` }); continue; }
  const d = RD.ROLE_DECL[key];
  const declared = Array.isArray(d.actionSteps) && d.actionSteps.length ? d.actionSteps
    : (d.actionStep ? [d.actionStep] : []);

  // ① 行动位
  for (const s of CARD[key].steps) {
    if (declared.indexOf(s) < 0)
      rows.push({ key, sev: 'P0', kind: '行动位缺登记', detail: `卡载步骤 ${s}（${CARD[key].quote.slice(0, 40)}…），声明 actionSteps=[${declared.join(',')}] 未含` });
  }
  // ② 互斥
  if (CARD[key].mutex && !d.duty)
    rows.push({ key, sev: 'P1', kind: '互斥未建模', detail: `卡载「${CARD[key].mutexQuote}」（${CARD[key].mutex.join('/')}），声明层无该字段 ⇒ AI 无从知道同夜不可连做` });
  // ③ 主动感知
  if (CARD[key].senses && !d.duty)
    rows.push({ key, sev: 'P1', kind: '感知面未建模', detail: `卡「可见性」载 ${CARD[key].senses.join('/')}，声明层无对应字段` });
  // ④ 代价
  if (CARD[key].cost && !d.duty)
    rows.push({ key, sev: 'P1', kind: '代价未建模', detail: `卡载明文代价/陷阱：${CARD[key].cost}` });
  // ⑤ 能力标签与卡内能力对齐
  const g = d.grants || [];
  const need = { bio: ['brew'], rescue: ['brew'], tempdoc: ['brew'] }[key];
  if (need) for (const x of need) if (g.indexOf(x) < 0)
    rows.push({ key, sev: 'P1', kind: '能力标签缺', detail: `卡载「制药」为医生族通有（3.3.1），声明 grants=[${g.join(',')}] 缺 '${x}'` });
}

const bySev = { P0: [], P1: [] };
rows.forEach(r => bySev[r.sev].push(r));
const out = [];
out.push('速查卡 × 声明层 对账：共 ' + rows.length + ' 处差异'
  + '（P0 阻断 ' + bySev.P0.length + ' · P1 缺失 ' + bySev.P1.length + '）');
for (const sev of ['P0', 'P1']) {
  out.push(NL + '── ' + sev + ' ──');
  for (const r of bySev[sev]) out.push('  [' + r.key + '] ' + r.kind + '：' + r.detail);
}
fs.writeFileSync('C:/Users/ASUS/AppData/Local/Temp/opencode/card-audit.txt', out.join(NL));
console.log(out.join(NL));