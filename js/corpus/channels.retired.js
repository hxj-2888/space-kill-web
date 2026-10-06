/* =============================================================
 * 太空杀 · 通道判据失效台账（第二十四批 · 闲置资源领出）
 *
 * 问题：总表 506 条里 462 条 dormant，其中 **38 条的判据所依赖的机制已被撤销或改值**——
 *   它们在总表里与「只是还没接线」的条目**长得一模一样**（同样 dormant: true、同样有
 *   完整的 cond/note 原文），于是批次 19 接线时极易被误当成可接线资产，注入永不成立的
 *   判据（写了 gate 也永不命中，纯属死代码；更坏的是被误读为"已实现"）。
 *
 * 处置：**不改动总表数据**（506 条是 v20 底本逐条转录，改它会破坏与底本的可追溯性），
 *   另立本台账声明「哪些条目的判据已失效、为什么失效」，由 Channels.staleVerdict() 暴露，
 *   执行器与门禁据此**明确拒用**。这样：
 *   ① 死判据从「看不出来」变成「明确不可用」；
 *   ② 真闲置（判据仍然成立、只是没写 gate）保持可领出，候选池不被污染；
 *   ③ 机制若将来恢复（如批⑫复原），从本台账移除即可复活，无需重翻总表。
 *
 * 三类退役原因（cause）：
 *   batch12  —— 判据依赖批次⑫（医生清除感染出手公告），第十六批依 3.3.7 撤除该批次
 *   ruleGone —— 判据依赖**已删除的机制**（如第 1 夜被动全能免疫，v6.6 2.3 表 #8 改为限定技）
 *   valueOld —— 判据依赖**已改值的数值**（如警长子弹第 5→第 7→第 5 夜、破坏档位、停摆档位）
 *              ⚠ 这一类**不是死的**，只是 cond 原文过时；接线时须按新值重写判据，不可照抄。
 * ============================================================= */
(function (global) {
  const RETIRED = {
    /* ---- 批次⑫撤除（3.3.7）：判据主体永不成立，永久归档 ---- */
    B01: 'batch12', B10: 'batch12', B15: 'batch12', B20: 'batch12',
    C13: 'batch12', C14: 'batch12', C19: 'batch12', C22: 'batch12',
    C54: 'batch12', C70: 'batch12', F03: 'batch12', F07: 'batch12',
    P16: 'batch12', N69: 'batch12', N131: 'batch12', N132: 'batch12',
    N133: 'batch12', N134: 'batch12', N135: 'batch12', N136: 'batch12',
    N139: 'batch12', N141: 'batch12', N143: 'batch12', N144: 'batch12',
    N169: 'batch12', N220: 'batch12', N262: 'batch12', N273: 'batch12', N286: 'batch12',

    /* ---- 依赖已删除的机制：永久归档（机制不恢复则永不成立） ---- */
    C05: 'ruleGone',   // 工程师第 1 夜被动全能免疫 → v6.6 改「安全室」限定技
    N322: 'ruleGone',  // 同上（感染侧全额减免口径）

    /* ---- 依赖已改值的数值：判据仍可成立，但 cond 原文过时，接线时须按新值重写 ---- */
    C01: 'valueOld', C41: 'valueOld', C46: 'valueOld', C68: 'valueOld',
    N115: 'valueOld', N120: 'valueOld', N130: 'valueOld',
  };
  const CAUSE_TEXT = {
    batch12: '批次⑫（医生清除感染出手公告）已依 3.3.7 撤除 ⇒ 判据永不成立',
    ruleGone: '判据依赖的机制已被删除（第 1 夜被动全能免疫 → 限定技「安全室」）⇒ 永不成立',
    valueOld: '判据引用的数值已改（警长子弹夜次 / 破坏档位 / 停摆档位）⇒ 判据仍可成立但 cond 须按新值重写',
  };
  const of = id => RETIRED[id] || null;
  const isStale = id => !!RETIRED[id];
  const dead = id => RETIRED[id] === 'batch12' || RETIRED[id] === 'ruleGone';  // 永不可用
  const ids = () => Object.keys(RETIRED);
  /** 接线候选池：dormant 且判据未失效 —— 这才是「真正可领出的闲置资源」 */
  function wireable(list) {
    return (list || global.Channels.CHANNELS).filter(c => c.dormant === false && !RETIRED[c.id]);
  }
  global.SKChannelsRetired = { RETIRED, CAUSE_TEXT, of, isStale, dead, ids, wireable };
})(typeof window !== 'undefined' ? window : globalThis);
