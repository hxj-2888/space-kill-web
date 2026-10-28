/* =============================================================
 * 新返航录 · 决策 → 物件 映射表（批 UI-5 · 2026-10-26）
 * -------------------------------------------------------------
 * 用户原话：「进入游戏页面的的 hud 界面应当全部删除，所有交互改为和对应物品交互，
 *            这里需要映射表」。
 *
 * 所以这份文件就是那张**映射表本身**：每个决策 kind（引擎 `g.pending.kind`）
 * 唯一对应「哪间房 + 哪件物件 + 物件叫什么」。
 *
 * 为什么单独成文件（而不是写进 ui-scene.js）：
 *   ① 它是**数据**，不是渲染逻辑 —— 换映射不该碰渲染器；
 *   ② 门禁可以只测这张表（纯数据）：每个引擎会产生的 kind 都必须有条目、
 *      条目指向的房间与物件必须真实存在于 js/space.js —— 不需要起浏览器；
 *   ③ 渲染器（ui-scene.js）与书记官记录（ui.js）都读它，杜绝"两处各写一份"。
 *
 * 不变量（改这个文件时逐条守）：
 *   · 纯数据 + 纯函数，**零 DOM、零规则**（不读 g，不读 Game）；
 *   · 映射**不得**泄露阵营：它只说明"这个动作在哪做"，不说明"谁能做"；
 *   · kind 的取值来自引擎（js/engine/steps.js / js/engine.js 的 `kind:` 字面量），
 *     新增 kind 必须同批补进本表，否则 test-hudmap 会红。
 * ============================================================= */
(function (global) {
  'use strict';

  /* 每一条：room = js/space.js 的房间 id；hit = 该房间道具的 k（交互键）；label = 物件中文名
     ⚠ hit 必须是 space.js 里真实存在的 `k`，否则点不到 —— 门禁 test-hudmap 逐个核对。 */
  const MAP = {
    /* ---- 舰桥：圆桌 / 通讯台 / 投票箱 / 航海日志 ---- */
    alienAct:   { room: 'bridge', hit: 'round_table', label: '圆桌' },   // 异形出刀/感染：围桌议事
    awaken:     { room: 'bridge', hit: 'round_table', label: '圆桌' },
    branch:     { room: 'bridge', hit: 'round_table', label: '圆桌' },
    ferry:      { room: 'bridge', hit: 'nav',         label: '导航台' },  // 摆渡人调查：航线台
    invite:     { room: 'bridge', hit: 'comms',       label: '通讯台' },
    inviteAccept:{ room: 'bridge', hit: 'comms',      label: '通讯台' },
    meeting:    { room: 'bridge', hit: 'comms',       label: '通讯台' },  // 紧急会议 = 广播
    speech:     { room: 'bridge', hit: 'comms',       label: '通讯台' },  // 验票官专属发言
    talk:       { room: 'bridge', hit: 'comms',       label: '通讯台' },
    chat:       { room: 'bridge', hit: 'comms',       label: '通讯台' },  // 私聊 / 白天密谈
    vote:       { room: 'bridge', hit: 'ballot',      label: '投票箱' },
    will:       { room: 'bridge', hit: 'logbook',     label: '航海日志' }, // 留言
    xenoKill:   { room: 'bridge', hit: 'round_table', label: '圆桌' },

    /* ---- 查证室 ---- */
    detective:  { room: 'verify', hit: 'board',       label: '证据板' },
    info:       { room: 'verify', hit: 'terminal',    label: '档案终端' },
    xenoCheck:  { room: 'verify', hit: 'fingerprint', label: '指纹仪' },

    /* ---- 医疗室 ---- */
    clean:      { room: 'medical', hit: 'sink',       label: '洗手池' },  // 清洗血迹
    convert:    { room: 'medical', hit: 'surgery',    label: '手术台' },
    doctor:     { room: 'medical', hit: 'surgery',    label: '手术台' },
    revive:     { room: 'medical', hit: 'bed1',       label: '病床一' },  // 死囚复生
    suppress:   { room: 'medical', hit: 'suppressor', label: '抑制器' },
    xenoCure:   { room: 'medical', hit: 'medicine',   label: '药柜' },

    /* ---- 制药室 ---- */
    evolve:     { room: 'pharma', hit: 'bench1',      label: '实验台一' },

    /* ---- 巡逻岗 ---- */
    patrol:     { room: 'patrol', hit: 'patrol_map',  label: '巡逻图' },
    sniff:      { room: 'patrol', hit: 'security',    label: '安防台' },
    wiretapReport:{ room: 'patrol', hit: 'monitor_wall', label: '监控墙' },
    xenoSilence:{ room: 'patrol', hit: 'monitor_wall', label: '监控墙' },

    /* ---- 船舱 ---- */
    crewAction: { room: 'repair', hit: 'parts',       label: '零件台' },
    crewRepair: { room: 'repair', hit: 'engine',      label: '引擎组' },
    repair:     { room: 'repair', hit: 'engine',      label: '引擎组' },
    escape:     { room: 'repair', hit: 'escapepod',   label: '逃生舱' },

    /* ---- 军械库 ---- */
    craft:      { room: 'armory', hit: 'workbench',   label: '工作台' },
    shoot:      { room: 'armory', hit: 'weapon_rack', label: '枪架' },

    /* ---- 安全室 ---- */
    guard:      { room: 'safe', hit: 'shelter_seat',  label: '避难座椅' },
    safeRoom:   { room: 'safe', hit: 'oxygen',        label: '氧气监测' },

    /* ---- 宿舍 ---- */
    disguise:   { room: 'dorms', hit: 'locker',       label: '储物柜' },
    morph:      { room: 'dorms', hit: 'locker',       label: '储物柜' },
    transfer:   { room: 'dorms', hit: 'locker',       label: '储物柜' },
  };

  /* 新增的 5 件物件（无现成素材，渲染时用 cozy 家具 + 同色角标，见 ui-scene.js）
     icon 只是角标里的一个字符，不是 emoji（用户明确排斥 emoji 图标）。 */
  const NEW_PROPS = {
    comms:     { label: '通讯台',   base: 'console',  tint: '#4dd0e1', mark: '通' },
    ballot:    { label: '投票箱',   base: 'crate',    tint: '#ffd43b', mark: '票' },
    suppressor:{ label: '抑制器',   base: 'terminal', tint: '#5ce6a8', mark: '抑' },
    escapepod: { label: '逃生舱',   base: 'cryopod',  tint: '#ff922b', mark: '逃' },
    logbook:   { label: '航海日志', base: 'bookshelf',tint: '#b197fc', mark: '志' },
  };

  const KINDS = Object.keys(MAP);

  function of(kind) { return MAP[kind] || null; }
  function roomOf(kind) { const m = MAP[kind]; return m ? m.room : null; }
  function hitOf(kind) { const m = MAP[kind]; return m ? m.hit : null; }
  function labelOf(kind) { const m = MAP[kind]; return m ? m.label : ''; }
  function isNewProp(hit) { return !!NEW_PROPS[hit]; }
  function newProp(hit) { return NEW_PROPS[hit] || null; }

  global.SKHudMap = {
    MAP: MAP, NEW_PROPS: NEW_PROPS, KINDS: KINDS,
    of: of, roomOf: roomOf, hitOf: hitOf, labelOf: labelOf,
    isNewProp: isNewProp, newProp: newProp,
  };
})(typeof window !== 'undefined' ? window : globalThis);
