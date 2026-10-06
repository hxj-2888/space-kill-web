/* =============================================================
 * 太空杀 · 揭示统一服务（v6.6 重构 B5 · 阶段 1.5 骨架）
 *
 * 职责：一切「身份揭示」的唯一收口点。六条揭示路径（表 3-1）的出参
 *       由本服务按 v6.6 口径构造——路径配置表决定「允许揭示什么」，
 *       调用方从出参取文本素材，结构上拿不到被禁止的字段（防透视：
 *       不是调用方「不报」阵营，而是出参里根本没有阵营）。
 *
 * 规则依据（v6.6 正文，唯一权威源）：
 *   · 2.8.1③之二 / 附录 B 表 1 —— 判定基准三模式 check | presented | faction
 *   · 2.8.12③ —— 既有差量仅四处（v66.1 已改正；驱逐公告所载三项即 ① 之默认范围），
 *                 各路径只声明相对默认「编号+呈现身份」的差量
 *   · 2.8.12④ —— 暴露公告不揭示真实阵营与真实职业，known 不写阵营（2.8.9(17)）
 *   · 4.7.1 —— 神探查验恒得当前职业，不报阵营、无附加信息
 *   · 4.7.2/4.7.5 —— 神探公告限于编号与呈现职业两项；转职者固定标注原职业
 *   · 6.1.1① —— 蛰伏查验报编号与呈现职业（不报阵营），转职者标注原职业
 *   · 2.3.4 / 4.10.6 —— 驱逐与死亡揭示保留真实阵营；原职业标注删除（B2）
 *
 * AI 侧契约：known 硬源仍由 knownLockOf 读取；不写阵营的路径，阵营由
 *   ROLE2FACTION 从呈现职业确定性推论（belief.js §5.3，不读 p.faction 透视）。
 *   〔A19 落地 2026-10-05〕乔装已实装（步骤 1）——按 2.8.1③之三②，乔装对本服务
 *   全部路径不生效，presentedRole 保持 t.role；唯一待改读点＝死囚变形（6.8.3，随 A6 convict）。
 * ============================================================= */
(function (global) {
  const D = global.SKData;

  /* 揭示路径配置（表 3-1 六路径 × 2.8.12③ 差量；v66.1 差量四处，公告节点的字段白名单
     另登记于 js/lang/announceIR.js SCHEMA——两表必须同向，test-fix §21 有交叉断言）：
     faction    真实阵营是否允许进入 known / p.revealed（仅 ⑥死亡 ⑩驱逐 为 true）
     originNote 转职者「原职业：普通船员」标注是否允许（神探公告 / 蛰伏查验保留，B2）
     〔歧义①裁决 2026-10-03〕出局揭示含真实阵营——依 2.3.4「驱逐公告…真实阵营+呈现职业+
     真实职业」、4.10 末死亡公告格式、2.8.12① 括号定义三处明文；2.8.1③之二统一表把
     「出局揭示」列在 presented 行与之相悖，按 §0.3「专门条款明文优先于通则」取明文，
     该表已列入规则侧勘误（docs/改动方案_v66施工落地_v1.0.md 第 10 章）。 */
  const PATHS = {
    expose:            { faction: false, originNote: false, trueRole: false },  // ④维修者暴露 / ⑤破坏者暴露
    detectiveAnnounce: { faction: false, originNote: true,  trueRole: false },  // ③神探公告（4.7.2/4.7.5）
    detectiveCheck:    { faction: false, originNote: false, trueRole: false },  // 神探查验私反馈（4.7.1 无附加信息）
    xenoCheck:         { faction: false, originNote: true,  trueRole: false },  // 蛰伏查验私反馈（6.1.1①）
    meeting:           { faction: false, originNote: false, trueRole: false },  // ⑦紧急会议开场背书（4.9.2）
    expel:             { faction: true,  originNote: false, trueRole: true  },  // ⑩驱逐公告（2.3.4）
    death:             { faction: true,  originNote: false, trueRole: true  },  // ⑥死亡公告（4.10.6）
  };

  /* 呈现职业（presented 模式，2.8.1③之二②）：不含乔装。〔A19 落地口径 2026-10-05〕
     乔装仅改「查证呈现身份」（2.8.1③之三①，船员查验唯一可被骗），对本服务全部
     ②呈现职业类路径不生效（③之三②：神探、蛰伏、暴露、出局揭示按真实呈现职业作答），
     故本函数在乔装实装后仍读 t.role 不变；待改读点只有死囚变形（6.8.3——变形同时
     改变真实呈现职业，骗神探），随 A6 convict 实装。 */
  function presentedRole(t) { return t.role; }

  /* 真实职业（C6 2026-10-04）：与「呈现职业」相对，乔装（7.3）与死囚变形（6.8.3）二者
     分叉时二者不同值；当前二者均未实装 ⇒ presentedRole === trueRole，出参无信息差异。
     ⚠ 与 originRole 是【两个不同概念】，严禁复用同一槽位：
       · originRole 原职业 —— 转职前的职业，2.8.12④ 已明文删除，公告不得出现（B2）
       · trueRole   真实职业 —— 当前真实职业，2.3.4/4.10.6 明文要求（出局揭示三项之一）
     故此处新增独立的 trueRole 槽位，物理分离，不复用 originNote/originRole。 */
  function trueRole(t) { return t.role; }

  /* 公开揭示：写 p.revealed + 全员 known（knownLockOf 唯一硬源路径），
     并保留 AI.onReveal 揭示清算（R17/R17b/R29/R30），与旧 revealPublic 行为对齐——
     唯一差异是阵营字段按路径配置写入：非 faction 路径 known/revealed 均无 faction 键。 */
  function reveal(g, t, path) {
    const cfg = PATHS[path];
    if (!cfg) throw new Error('RevealService: 未登记的揭示路径 ' + path);
    const role = presentedRole(t);
    /* L1（批次 28）：出局揭示两路径的 known 硬锁补 trueRole——⑥⑩公告已呈现
       「呈现职业／真实职业」双字段（4.10.6/2.3.4），硬源台账须同形，否则变形类机制
       （6.8.3，A6 convict）实装后 AI 硬锁与公告自相矛盾。当前 trueRole(t)===t.role，
       追加字段对现有消费者不可见（belief/ui 只读 role/faction）。 */
    const tr = cfg.trueRole ? trueRole(t) : null;
    const rec = cfg.faction ? { faction: t.faction, role, trueRole: tr } : { role };
    t.revealed = rec;
    /* 非 faction 路径的 known 条目不含 faction 键（不是 null——null 会被
       「known 有条目」的 UI/AI 判空逻辑当成已持有阵营信息） */
    for (const o of g.players) o.known.set(t.id, cfg.faction ? { faction: t.faction, role, trueRole: tr } : { role });
    if (global.AI && global.AI.onReveal) global.AI.onReveal(g, t);
    return rec;
  }

  /* 私反馈 / 公告文本出参：字段即「本路径允许揭示的全部」。
     originRole 仅在路径配置允许且目标确已转职时非空（B2：暴露/死亡/驱逐恒 null）；
     trueRole 仅在出局揭示两路径（⑥死亡 / ⑩驱逐）非空（2.3.4/4.10.6 三项之一）。 */
  function checkResult(t, path) {
    const cfg = PATHS[path];
    if (!cfg) throw new Error('RevealService: 未登记的揭示路径 ' + path);
    const role = presentedRole(t);
    const tr = cfg.trueRole ? trueRole(t) : null;
    return {
      id: t.id,
      roleKey: role,
      roleName: D.ROLES[role] ? D.ROLES[role].name : role,
      trueRoleKey: tr,
      trueRoleName: tr ? (D.ROLES[tr] ? D.ROLES[tr].name : tr) : null,
      originRole: cfg.originNote && t.transferred ? '普通船员' : null,
    };
  }

  global.RevealService = { PATHS, reveal, checkResult, presentedRole, trueRole };
})(typeof window !== 'undefined' ? window : globalThis);
