/* =============================================================
 * SKActionMap · 动作映射表（**派生物，勿手改**）（批 RTA-0 / R0 · 2026-10-28）
 * -------------------------------------------------------------
 * 源文件：docs/动作映射表_实时行动_20261028.md（改参数只改那里，再跑生成器）
 * 生成器：node tools/gen-action-map.cjs     校验：node tools/gen-action-map.cjs --check
 *
 * 职责：   把"谁能做什么、在哪里做、离多远、做多久、冷却多少、被谁看见、和谁抢"
 *          变成**可执行的数据**；引擎、UI、AI 都读它，不再各自散落硬编码。
 * 不变量： · 纯数据 + 纯函数：零 DOM、零状态、不读任何业务对象；
 *          · 每条动作的 kind 必须仍在旧引擎的 kind 集合里（过渡期兼容）；
 *          · 权能键只引用声明层（roleDecl.grants）或本文件登记的机制位/基础能力；
 *          · **本文件由生成器产出**：手改会在下一次生成时被覆盖，门禁也会判红。
 * 门禁：   tools/test-actions.cjs（kind 覆盖 / 场所真实 / 权能可解析 / 反向覆盖 / 数值合法 / 计数一致）
 * ============================================================= */
(function (global) {
  'use strict';

  /* 权能键来源（生成器与门禁共用同一份真源） */
  const CAPS = {
    "shoot": "grant",
    "craft": "grant",
    "brew": "grant",
    "treat": "grant",
    "revive": "grant",
    "save": "grant",
    "vaccine": "grant",
    "protect": "grant",
    "safeRoom": "grant",
    "repair": "grant",
    "extraRepair": "grant",
    "sniff": "grant",
    "wiretap": "grant",
    "morph": "grant",
    "transfer": "grant",
    "poison": "grant",
    "alien.kill": "mechanism",
    "alien.infect": "mechanism",
    "alien.destroy": "mechanism",
    "alien.weave": "mechanism",
    "alien.clean": "mechanism",
    "alien.disguise": "mechanism",
    "alien.convert": "mechanism",
    "xeno.kill": "mechanism",
    "xeno.check": "mechanism",
    "xeno.destroy": "mechanism",
    "xeno.evolve": "mechanism",
    "xeno.cure": "mechanism",
    "xeno.silence": "mechanism",
    "detective.check": "mechanism",
    "sheriff.patrol": "mechanism",
    "ferry": "mechanism",
    "crew.chore": "mechanism",
    "assistRepair": "charge",
    "crew.escape": "mechanism",
    "crew.info": "mechanism",
    "convict.awaken": "mechanism",
    "convict.branch": "mechanism",
    "base.chat": "base",
    "base.talk": "base",
    "base.meeting": "base",
    "base.vote": "base",
    "base.speech": "base",
    "base.will": "base"
  };

  const ACTIONS = [
    {"id":"alien.knife","kind":"alienAct","cap":"alien.kill","capText":"异形·出刀 ⟂","place":{"raw":"任意（近身）","room":"any","prop":null},"target":"other","dist":"触","distText":"触","durMs":500,"cd":{"type":"night","n":1,"group":"G1"},"cost":"刀数 1","settle":"即（拽回 + 硬控，不可打断）","counter":"护盾 / 保镖（击杀前判定）·不可打断·0.5s 内吃枪击⇒杀完转濒死（可救）","witness":"动","contest":"—","ai":"高"},
    {"id":"alien.infect","kind":"alienAct","cap":"alien.infect","capText":"异形·感染 ⟂","place":{"raw":"任意（近身）","room":"any","prop":null},"target":"other","dist":"触","distText":"触","durMs":2000,"cd":{"type":"night","n":1,"group":"G1"},"cost":"感染额度 1","settle":"即","counter":"药柜治疗 / 净血","witness":"动","contest":"—","ai":"中"},
    {"id":"alien.destroy","kind":"alienAct","cap":"alien.destroy","capText":"异形·破坏 ⟂","place":{"raw":"repair/engine（暂不动结构点）","room":"repair","prop":"engine"},"target":"prop","dist":"房","distText":"房","durMs":5000,"cd":{"type":"night","n":1,"group":"G1"},"cost":"破坏额度","settle":"即（净破坏量 +1.5~2.0（未进化）/ +2.0~3.0（进化）；跨 3.0/6.0 ⇒ 进度 −2.5/−5.0；跨 9.0 ⇒ 人类进度胜利永久失效）","counter":"同机器被占用时不可交互","witness":"动","contest":"sabotage","ai":"中"},
    {"id":"alien.weave","kind":"alienAct","cap":"alien.weave","capText":"异形·结茧 ⟂","place":{"raw":"任意（近身）","room":"any","prop":null},"target":"other","dist":"触","distText":"触","durMs":5000,"cd":{"type":"night","n":1,"group":"G1"},"cost":"—","settle":"即","counter":"打断","witness":"动","contest":"—","ai":"低"},
    {"id":"alien.convert","kind":"convert","cap":"alien.convert","capText":"异形·转化 ⟂","place":{"raw":"pharma/bench1","room":"pharma","prop":"bench1"},"target":"self","dist":"房","distText":"房","durMs":5000,"cd":{"type":"once","n":2},"cost":"转化额度 1","settle":"即（转化当夜无行动；方向：击杀/感染/破坏）","counter":"打断","witness":"动","contest":"—","ai":"中"},
    {"id":"xeno.kill","kind":"xenoKill","cap":"xeno.kill","capText":"外星人·击杀 ⟂","place":{"raw":"任意（近身）","room":"any","prop":null},"target":"other","dist":"触","distText":"触","durMs":500,"cd":{"type":"night","n":1,"group":"G2"},"cost":"击杀额度 1","settle":"即（同\"近身击杀\"全套规则）","counter":"护盾 / 保镖·不可打断·0.5s 内吃枪击⇒转濒死（可救）","witness":"动","contest":"—","ai":"高"},
    {"id":"crew.shoot","kind":"shoot","cap":"shoot","capText":"人类·武装 ⟂","place":{"raw":"任意（持枪，初始自带）","room":"any","prop":null},"target":"other","dist":"视野内","distText":"视野内（射程=视野）","durMs":1000,"cd":{"type":"sec","v":8},"cost":"弹药 1","settle":"即（子弹实体飞行 30 格/秒；脱视野后沿切线；可误伤）","counter":"目标在引导期内脱离视野即失去锁定 · 掩体 / 安全室 / 对射","witness":"声（20 格）","contest":"—","ai":"高"},
    {"id":"crew.guard","kind":"guard","cap":"protect","capText":"人类·保镖 ⟂","place":{"raw":"safe/shelter_seat","room":"safe","prop":"shelter_seat"},"target":"other（同房）","dist":"房","distText":"房","durMs":5000,"cd":{"type":"night","n":1,"group":"G3"},"cost":"—","settle":"即","counter":"—","witness":"动","contest":"—","ai":"中"},
    {"id":"crew.safeRoom","kind":"safeRoom","cap":"safeRoom","capText":"人类·安全室 ⟂","place":{"raw":"safe/oxygen","room":"safe","prop":"oxygen"},"target":"self","dist":"房","distText":"房","durMs":5000,"cd":{"type":"night","n":1,"group":"G3"},"cost":"—","settle":"即","counter":"—","witness":"半（进房可见）","contest":"—","ai":"中"},
    {"id":"crew.takeAmmo","kind":"craft","cap":"shoot","capText":"人类·武装 ⟂","place":{"raw":"armory/weapon_rack","room":"armory","prop":"weapon_rack"},"target":"self","dist":"房","distText":"房","durMs":5000,"cd":{"type":"none"},"cost":"—","settle":"即","counter":"不可被抢（初始枪弹已随身，这里只补弹）","witness":"动","contest":"box#1","ai":"高"},
    {"id":"crew.craftAmmo","kind":"craft","cap":"craft","capText":"人类·武装 ⟂","place":{"raw":"armory/workbench","room":"armory","prop":"workbench"},"target":"prop","dist":"房","distText":"房","durMs":5000,"cd":{"type":"none"},"cost":"—","settle":"进","counter":"打断清进度","witness":"动","contest":"craft#1","ai":"中"},
    {"id":"doctor.medicine","kind":"doctor","cap":"brew","capText":"医生·制药 ⟂","place":{"raw":"pharma/bench1","room":"pharma","prop":"bench1"},"target":"prop","dist":"房","distText":"房","durMs":5000,"cd":{"type":"sec","v":0},"cost":"—","settle":"进","counter":"打断清进度","witness":"动","contest":"craft#3","ai":"中"},
    {"id":"doctor.surgery","kind":"doctor","cap":"treat","capText":"医生·治疗 ⟂","place":{"raw":"medical/surgery","room":"medical","prop":"surgery"},"target":"other","dist":"触","distText":"触","durMs":5000,"cd":{"type":"night","n":1,"group":"G3"},"cost":"—","settle":"即","counter":"打断","witness":"动","contest":"—","ai":"中"},
    {"id":"doctor.revive","kind":"revive","cap":"revive","capText":"医生·复生 ⟂","place":{"raw":"medical/bed1","room":"medical","prop":"bed1"},"target":"corpse","dist":"触","distText":"触","durMs":5000,"cd":{"type":"night","n":1,"group":"G3"},"cost":"药剂 1","settle":"即","counter":"打断","witness":"动","contest":"—","ai":"低"},
    {"id":"doctor.save","kind":"—","cap":"save","capText":"医生·濒死救援 ⟂","place":{"raw":"medical/bed1","room":"medical","prop":"bed1"},"target":"other（濒死）","dist":"触","distText":"触","durMs":5000,"cd":{"type":"night","n":1,"group":"G3"},"cost":"药剂 1","settle":"即（救起濒死者；时限到次日白天讨论前）","counter":"打断","witness":"动","contest":"—","ai":"高"},
    {"id":"doctor.suppress","kind":"suppress","cap":"vaccine","capText":"医生·抑制 ⟂","place":{"raw":"medical/suppressor","room":"medical","prop":"suppressor"},"target":"other","dist":"触","distText":"触","durMs":5000,"cd":{"type":"night","n":1,"group":"G3"},"cost":"—","settle":"即","counter":"—","witness":"动","contest":"—","ai":"中"},
    {"id":"poisoner.poison","kind":"—","cap":"poison","capText":"毒师·下毒 ⟂","place":{"raw":"medical/surgery","room":"medical","prop":"surgery"},"target":"other","dist":"触","distText":"触","durMs":5000,"cd":{"type":"night","n":1,"group":"G3"},"cost":"毒药 1","settle":"即（落毒后独立计时，不随施毒者出局取消）","counter":"打断","witness":"动","contest":"—","ai":"中"},
    {"id":"doctor.clean","kind":"clean","cap":"alien.clean","capText":"医生·清理 ⟂","place":{"raw":"medical/sink","room":"medical","prop":"sink"},"target":"prop","dist":"房","distText":"房","durMs":5000,"cd":{"type":"sec","v":0},"cost":"—","settle":"即","counter":"—","witness":"动","contest":"—","ai":"高"},
    {"id":"crew.repair","kind":"repair","cap":"repair","capText":"人类·维修 ⟂","place":{"raw":"repair/engine","room":"repair","prop":"engine"},"target":"prop","dist":"房","distText":"房","durMs":5000,"cd":{"type":"night","n":1,"group":null},"cost":"—","settle":"即（维修进度 +1.0~1.5，拉条 6 档、默认最高；只削已累计破坏量）","counter":"同机器被占用时不可交互","witness":"动","contest":"sabotage","ai":"高"},
    {"id":"crew.crewAction","kind":"crewAction","cap":"crew.chore","capText":"人类·零件 ⟂","place":{"raw":"repair/parts","room":"repair","prop":"parts"},"target":"prop","dist":"房","distText":"房","durMs":5000,"cd":{"type":"sec","v":0},"cost":"—","settle":"进","counter":"打断","witness":"动","contest":"craft#4","ai":"中"},
    {"id":"crew.crewRepair","kind":"crewRepair","cap":"assistRepair","capText":"人类·引擎 ⟂","place":{"raw":"repair/engine","room":"repair","prop":"engine"},"target":"prop","dist":"房","distText":"房","durMs":5000,"cd":{"type":"night","n":1,"group":null},"cost":"—","settle":"即（维修进度 +0.20~0.50，拉条 7 档、默认最高）","counter":"同上","witness":"动","contest":"sabotage","ai":"中"},
    {"id":"crew.extraRepair","kind":"crewRepair","cap":"extraRepair","capText":"工程师·追加维修 ⟂","place":{"raw":"repair/engine","room":"repair","prop":"engine"},"target":"prop","dist":"房","distText":"房","durMs":5000,"cd":{"type":"once","n":3},"cost":"—","settle":"即（维修进度 +1.0~1.5，拉条 6 档、默认最高）","counter":"同上","witness":"动","contest":"sabotage","ai":"中"},
    {"id":"crew.escape","kind":"escape","cap":"crew.escape","capText":"人类·逃生 ⟂","place":{"raw":"repair/escapepod","room":"repair","prop":"escapepod"},"target":"self","dist":"房","distText":"房","durMs":5000,"cd":{"type":"none"},"cost":"—","settle":"即","counter":"打断 / 追上","witness":"动","contest":"—","ai":"低"},
    {"id":"detective.check","kind":"detective","cap":"detective.check","capText":"侦探·查验 ⟂","place":{"raw":"verify/board","room":"verify","prop":"board"},"target":"other","dist":"房","distText":"房","durMs":5000,"cd":{"type":"night","n":1,"group":"G3"},"cost":"—","settle":"即","counter":"—","witness":"动","contest":"—","ai":"高"},
    {"id":"crew.info","kind":"info","cap":"crew.info","capText":"人类·档案 ⟂","place":{"raw":"verify/terminal","room":"verify","prop":"terminal"},"target":"prop","dist":"房","distText":"房","durMs":5000,"cd":{"type":"night","n":1,"group":"G3"},"cost":"—","settle":"即","counter":"—","witness":"动","contest":"terminal#1","ai":"中"},
    {"id":"xeno.destroy","kind":"alienAct","cap":"xeno.destroy","capText":"外星人·破坏 ⟂","place":{"raw":"repair/engine","room":"repair","prop":"engine"},"target":"prop","dist":"房","distText":"房","durMs":5000,"cd":{"type":"once","n":1},"cost":"破坏额度 1","settle":"即（净破坏量 +2.0~3.0；触发停转夜：次夜维修无效、进度 +0）","counter":"同机器被占用时不可交互","witness":"动","contest":"sabotage","ai":"中"},
    {"id":"xeno.check","kind":"xenoCheck","cap":"xeno.check","capText":"外星人·指纹 ⟂","place":{"raw":"verify/fingerprint","room":"verify","prop":"fingerprint"},"target":"other","dist":"触","distText":"触","durMs":5000,"cd":{"type":"night","n":1,"group":"G2"},"cost":"—","settle":"即","counter":"—","witness":"动","contest":"—","ai":"中"},
    {"id":"crew.patrol","kind":"patrol","cap":"sheriff.patrol","capText":"人类·巡逻 ⟂","place":{"raw":"patrol/patrol_map","room":"patrol","prop":"patrol_map"},"target":"area","dist":"房","distText":"房","durMs":5000,"cd":{"type":"night","n":1,"group":"G3"},"cost":"—","settle":"即","counter":"—","witness":"动","contest":"—","ai":"中"},
    {"id":"crew.sniff","kind":"sniff","cap":"sniff","capText":"人类·嗅探 ⟂","place":{"raw":"patrol/security","room":"patrol","prop":"security"},"target":"area","dist":"房","distText":"房","durMs":5000,"cd":{"type":"night","n":1,"group":"G3"},"cost":"—","settle":"即","counter":"—","witness":"动","contest":"—","ai":"低"},
    {"id":"crew.wiretap","kind":"wiretapReport","cap":"wiretap","capText":"人类·监听 ⟂","place":{"raw":"patrol/monitor_wall","room":"patrol","prop":"monitor_wall"},"target":"area","dist":"房","distText":"房","durMs":5000,"cd":{"type":"night","n":1,"group":"G3"},"cost":"—","settle":"即","counter":"—","witness":"动","contest":"—","ai":"低"},
    {"id":"xeno.silence","kind":"xenoSilence","cap":"xeno.silence","capText":"外星人·静默 ⟂","place":{"raw":"patrol/monitor_wall","room":"patrol","prop":"monitor_wall"},"target":"prop","dist":"房","distText":"房","durMs":5000,"cd":{"type":"night","n":1,"group":"G2"},"cost":"—","settle":"即","counter":"被复修","witness":"动","contest":"sabotage","ai":"低"},
    {"id":"alien.ferry","kind":"ferry","cap":"ferry","capText":"摆渡人·调查 ⟂","place":{"raw":"bridge/nav","room":"bridge","prop":"nav"},"target":"other","dist":"房","distText":"房","durMs":5000,"cd":{"type":"night","n":1,"group":"G3"},"cost":"—","settle":"即","counter":"—","witness":"动","contest":"—","ai":"中"},
    {"id":"alien.morph","kind":"morph","cap":"morph","capText":"异形·变形 ⟂","place":{"raw":"dorms/locker","room":"dorms","prop":"locker"},"target":"self","dist":"房","distText":"房","durMs":5000,"cd":{"type":"night","n":2,"group":null},"cost":"—","settle":"即","counter":"—","witness":"动","contest":"—","ai":"中"},
    {"id":"alien.disguise","kind":"disguise","cap":"alien.disguise","capText":"异形·乔装 ⟂","place":{"raw":"dorms/locker","room":"dorms","prop":"locker"},"target":"self","dist":"房","distText":"房","durMs":5000,"cd":{"type":"night","n":1,"group":"G1"},"cost":"—","settle":"即","counter":"—","witness":"动","contest":"—","ai":"中"},
    {"id":"alien.transfer","kind":"transfer","cap":"transfer","capText":"异形·转移 ⟂","place":{"raw":"dorms/locker","room":"dorms","prop":"locker"},"target":"other","dist":"触","distText":"触","durMs":5000,"cd":{"type":"night","n":1,"group":"G1"},"cost":"—","settle":"即","counter":"—","witness":"动","contest":"—","ai":"低"},
    {"id":"xeno.evolve","kind":"evolve","cap":"xeno.evolve","capText":"外星人·进化 ⟂","place":{"raw":"pharma/bench1","room":"pharma","prop":"bench1"},"target":"self","dist":"房","distText":"房","durMs":5000,"cd":{"type":"night","n":1,"group":"G2"},"cost":"—","settle":"即","counter":"打断","witness":"动","contest":"—","ai":"中"},
    {"id":"xeno.cure","kind":"xenoCure","cap":"xeno.cure","capText":"外星人·解药 ⟂","place":{"raw":"medical/medicine","room":"medical","prop":"medicine"},"target":"self","dist":"房","distText":"房","durMs":5000,"cd":{"type":"night","n":1,"group":"G2"},"cost":"—","settle":"即","counter":"—","witness":"动","contest":"—","ai":"低"},
    {"id":"moon.awaken","kind":"awaken","cap":"convict.awaken","capText":"死囚·唤醒 ⟂","place":{"raw":"bridge/round_table","room":"bridge","prop":"round_table"},"target":"self","dist":"房","distText":"房","durMs":null,"cd":{"type":"none"},"cost":"—","settle":"窗","counter":"—","witness":"动","contest":"—","ai":"低"},
    {"id":"moon.branch","kind":"branch","cap":"convict.branch","capText":"分支裁定 ⟂","place":{"raw":"bridge/round_table","room":"bridge","prop":"round_table"},"target":"self","dist":"房","distText":"房","durMs":null,"cd":{"type":"none"},"cost":"—","settle":"窗","counter":"—","witness":"无","contest":"—","ai":"低"},
    {"id":"all.chat","kind":"chat","cap":"base.chat","capText":"任何人","place":{"raw":"任意（行走中）","room":"any","prop":null},"target":"other","dist":"—","distText":"—","durMs":null,"cd":{"type":"none"},"cost":"—","settle":"实时（气泡）","counter":"—","witness":"泡","contest":"—","ai":"中"},
    {"id":"all.talk","kind":"talk","cap":"base.talk","capText":"任何人","place":{"raw":"bridge/comms","room":"bridge","prop":"comms"},"target":"—","dist":"房","distText":"房","durMs":null,"cd":{"type":"none"},"cost":"—","settle":"窗","counter":"—","witness":"无","contest":"—","ai":"高"},
    {"id":"all.invite","kind":"invite","cap":"base.chat","capText":"任何人","place":{"raw":"bridge/comms","room":"bridge","prop":"comms"},"target":"other","dist":"房","distText":"房","durMs":null,"cd":{"type":"none"},"cost":"—","settle":"窗","counter":"—","witness":"无","contest":"—","ai":"中"},
    {"id":"all.inviteAccept","kind":"inviteAccept","cap":"base.chat","capText":"任何人","place":{"raw":"bridge/comms","room":"bridge","prop":"comms"},"target":"other","dist":"房","distText":"房","durMs":null,"cd":{"type":"none"},"cost":"—","settle":"窗","counter":"—","witness":"无","contest":"—","ai":"—"},
    {"id":"all.meeting","kind":"meeting","cap":"base.meeting","capText":"任何人","place":{"raw":"bridge/comms","room":"bridge","prop":"comms"},"target":"—","dist":"房","distText":"房","durMs":null,"cd":{"type":"sec","v":60},"cost":"—","settle":"窗","counter":"—","witness":"声（全员）","contest":"—","ai":"高"},
    {"id":"all.vote","kind":"vote","cap":"base.vote","capText":"任何人","place":{"raw":"bridge/ballot","room":"bridge","prop":"ballot"},"target":"other","dist":"房","distText":"房","durMs":null,"cd":{"type":"none"},"cost":"—","settle":"窗","counter":"—","witness":"无","contest":"—","ai":"高"},
    {"id":"clerk.speech","kind":"speech","cap":"base.speech","capText":"验票官 ⟂","place":{"raw":"bridge/comms","room":"bridge","prop":"comms"},"target":"—","dist":"房","distText":"房","durMs":null,"cd":{"type":"none"},"cost":"—","settle":"窗","counter":"—","witness":"无","contest":"—","ai":"中"},
    {"id":"all.will","kind":"will","cap":"base.will","capText":"任何人","place":{"raw":"bridge/logbook","room":"bridge","prop":"logbook"},"target":"—","dist":"房","distText":"房","durMs":null,"cd":{"type":"none"},"cost":"—","settle":"窗","counter":"—","witness":"无","contest":"—","ai":"低"}
  ];

  const BY_ID = {};
  for (const a of ACTIONS) BY_ID[a.id] = a;

  function all() { return ACTIONS; }
  function get(id) { return BY_ID[id] || null; }
  function byKind(kind) { return ACTIONS.filter(a => a.kind === kind); }
  function byCap(cap) { return ACTIONS.filter(a => a.cap === cap); }
  /* 某角色能做哪些动作：角色 grants（声明层）+ 本表登记的机制位/基础能力 */
  function forCaps(caps) {
    const set = {};
    for (const c of (caps || [])) set[c] = 1;
    return ACTIONS.filter(a => set[a.cap]);
  }

  global.SKActionMap = {
    ACTIONS: ACTIONS, CAPS: CAPS,
    all: all, get: get, byKind: byKind, byCap: byCap, forCaps: forCaps,
  };
})(typeof window !== 'undefined' ? window : globalThis);
