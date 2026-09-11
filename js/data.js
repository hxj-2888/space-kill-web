/* 角色 / 职业静态数据 */
(function (global) {
  const FACTION = {
    human: { key: 'human', name: '人类', cls: 'f-h' },
    alien: { key: 'alien', name: '异形', cls: 'f-a' },
    xeno:  { key: 'xeno',  name: '外星人', cls: 'f-x' },
  };

  const ROLES = {
    crew:      { name: '普通船员', faction: 'human', desc: '每夜「查验」或「协助维修」二选一；存活≤6 或第 6 夜起可转职。' },
    engineer:  { name: '工程师',   faction: 'human', desc: '每夜维修 −1.0；追加维修 −1.0（全局 3 次）；第 1 夜全能免疫。' },
    sheriff:   { name: '警长',     faction: 'human', desc: '持枪：初始 1 发；前 3 夜可巡逻 1 次（1~3 人）；击杀敌方回复子弹。' },
    bio:       { name: '生化医师', faction: 'human', desc: '治疗 3 次（清感染并赋予抗体）、自救 1 次；可见感染标记清单。' },
    rescue:    { name: '救援医师', faction: 'human', desc: '救援 2 次（可救任意濒死者）、治疗 1 次；可见濒死者清单。' },
    detective: { name: '神探',     faction: 'human', desc: '每夜查验 1 人真实身份，或发布一条官方公告。' },
    bodyguard: { name: '保镖',     faction: 'human', desc: '每夜保护 1 人（挡 1 伤害 + 1 感染）；不可连续两夜保同一人。' },
    inspector: { name: '验票官',   faction: 'human', desc: '可见全部票源；可发动 1 次紧急会议（存活≥5）。' },
    armed:     { name: '武装船员', faction: 'human', desc: '1 发子弹，击杀敌方回复；由普通船员转职而来。' },
    assistant: { name: '助理工程师', faction: 'human', desc: '每夜维修 −1.0；累计维修 3.0 即暴露。' },
    tempdoc:   { name: '临时医生', faction: 'human', desc: '救援 1 次、治疗 2 次；可见感染标记与濒死者。' },
    alien:     { name: '异形',     faction: 'alien', desc: '每夜出刀／感染／破坏／结茧四选一；第 3 夜起可进化。' },
    xeno:      { name: '外星人',   faction: 'xeno',  desc: '查验／击杀／破坏三选一；夜晚免疫；第 6 夜起可觉醒双刀。' },
  };

  /* 普通船员查验用的「有效排除池」= 8 个初始人类职业 */
  const HUMAN_BASE_ROLES = ['crew', 'engineer', 'sheriff', 'bio', 'rescue', 'detective', 'bodyguard', 'inspector'];

  const NAMES = ['星尘', '银翼', '北极', '磷火', '铁砧', '罗盘', '苍鹭', '玄武岩', '游隼',
                 '回声', '子夜', '砂岩', '灯塔', '青霜', '归零'];

  const HUMAN_SETUP = ['crew', 'crew', 'crew', 'crew', 'engineer', 'sheriff', 'bio', 'rescue',
                       'detective', 'bodyguard', 'inspector'];

  const CAUSE_NAME = { alien: '异形出刀', xeno: '外星人出刀', gun: '枪击', infect: '感染' };

  /* B 类运营参数：各决策窗口秒数（显示方案 5.1 的「典型」值，可标定调整）。
     duration 为该步开窗时长；auto 表示无输入的自动结算展示时长（可点继续跳过）。 */
  const STEP_TIME = {
    /* 夜间决策窗口（B 类运营参数，上限值，对齐显示方案 §5.1 表） */
    '0a': { duration: 15 }, '0b': { duration: 15 }, '0c': { duration: 30 },
    '0.5': { duration: 15 }, '0.6': { duration: 30 }, '0.7': { duration: 30 },
    '1': { duration: 30 }, '1b': { duration: 20 }, '2': { duration: 30 }, '2b': { duration: 20 },
    '3': { duration: 15 }, '4a': { duration: 25 }, '4b': { duration: 12, auto: true },
    '5': { duration: 15 }, '6': { duration: 22 }, '7': { duration: 25 },
    '8': { duration: 25 }, '9': { duration: 0, auto: 10 },
    '10': { duration: 20 }, '11': { duration: 0, auto: 8 },
    '0.55': { duration: 0, auto: 6 },
    'M-talk': { duration: 150 }, 'M-vote': { duration: 30 }, 'M-speech': { duration: 30 },
    'D-open': { duration: 60 },
    'D-will': { duration: 30 }, 'D-talk': { duration: 180 },
    'D-vote': { duration: 30 }, 'D-clean': { duration: 10 },
  };

  global.SKData = { FACTION, ROLES, HUMAN_BASE_ROLES, NAMES, HUMAN_SETUP, CAUSE_NAME, STEP_TIME };
})(typeof window !== 'undefined' ? window : globalThis);
