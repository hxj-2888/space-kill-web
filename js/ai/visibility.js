/* =============================================================
 * AI 可见性闸门（v7 · 2026-10-08 用户裁定「AI 与真人同角色时可见性统一」）
 *
 * 问题：AI 决策层直接读权威状态字段（`q.silenceNight` / `q.dying` / `q.infection` …），
 *       而真人玩家只能看到 view.js sanitize 下发的内容。⇒ AI 严格优于真人。
 *       tools/parity-referee.cjs 实测 60 局报出 6986 次越界，其中：
 *         silenceNight 4972 · dying 1157 · infection 694 · alien 162 · poison 1
 *
 * 裁定：**同角色时，AI 能看到的必须与该角色的真人完全相同。**
 *   ⇒ 判据真源就是 view.js 的 sanitize —— 不是另写一张「AI 该知道什么」的表。
 *      另写一张表 = 本仓库反复踩过的漂移源（duty.senses / visibility / view 三处
 *      各说各话，本批实测 bio 的濒死授权就是例证）。
 *
 * 用法：把「读他人字段」一律改成读本模块的闸门：
 *     VIS.of(g, me, target)      → 目标在本角色视角下的**可见投影**（不是原对象）
 *     VIS.field(g, me, target, 'dying')  → 该字段；不可见时返回 undefined
 *
 * ⚠ 三条纪律（写在这里，因为它们是这个模块存在的全部理由）：
 *   1. **不可见 ⇒ 返回 undefined，不返回默认值。** 返回 0/false 等于替 AI 编造了
 *      「我确认他没被沉默」这种事实，那是另一种形式的透视。
 *   2. **可见性判定一律走 view.js。** 本模块只做缓存与降级，不复制它的规则。
 *      若 view.js 未加载（纯 AI 剖面），退化为「只可见自己」——
 *      保守方向正确：看不见比看得见安全。
 *   3. **不得在本模块里改对局状态。** 纯读。
 *
 * 加载序：view.js 在 profiles.ui 而非 full/full 的 AI_STACK 里，
 *   故本模块**运行时**取 global.View，取不到即降级（纪律 2）。
 * ============================================================= */
(function (global) {
  const RD = global.SKRoleDecl;

  /* sanitize 对「自己」下发的一批 self 专属字段。真人看自己的面板时确实看得到，
     故 AI 读自己的这些字段合法 —— 但仍走闸门，不开后门（开后门就会有人从后门进来）。 */
  const SELF_FIELDS = new Set([
    'faction', 'role', 'roleName', 'infection', 'dying', 'suppressLeft', 'antibodyNight',
    'silenceNight', 'shield', 'bullets', 'patrolUsed', 'bulletLog', 'repairTotal',
    'extraRepair', 'healLeft', 'selfSaveLeft', 'rescueLeft', 'cureLeft', 'cureSelf',
    'nightImmune', 'destroyLeft', 'awakened', 'meetingLeft', 'alien', 'checkPool',
    'crewChecks', 'known', 'inbox', 'notes', 'brew', 'lastProtected', 'lastInvite',
    'revealed', 'claimedRole', 'accusers', 'repairExposed', 'destroyedExposed', 'out',
  ]);

  /* 他人视图里，字段名与真相字段不同的投影（sanitize 用另一套键名下发）。
     这一张表**必须**与 view.js 同步 —— 故下面有自检：真源缺失时它只会让读取
     变保守（拿不到 → undefined），不会让 AI 看到更多。 */
  const PROXY_OF = {
    originRole: ['role'], roleName: ['roleName'],
    accuseHistory: ['accusers'],
  };

  /* 投影键 → 真相字段（sanitize 只给投影，AI 要的是原字段，故反查）。 */
  const TRUTH_OF = (() => {
    const m = {};
    for (const [truth, alts] of Object.entries(PROXY_OF)) for (const a of alts) m[a] = truth;
    return m;
  })();

  /* 视图缓存：同一 (步, 读者) 的 sanitize 结果只算一次。
     ⚠ 缓存键用 g.step 是安全的 —— g.step 由 beginStep 在调 req/decide **之前**设成本步
     （engine.js:701），故决策期读到的 g.step 已是本步。缓存**不跨步**：对局状态每步都变。

     ⚠⚠ **闸门自己会读真相，这件事必须对裁判可见，不能藏着**：
     View.build 是投影计算，它遍历全员字段（view.js sanitize 逐个读 p.faction/p.role/…）。
     若在决策期现算，这些读取会出现在 AI 的读取账本里 —— 看起来像 AI 又在透视。
     真相是：**投影读取 ≠ 决策读取**。真人客户端也要算同一份投影才能渲染，
     差别只在于 AI 不该把投影之外的真相当决策输入。
     故本闸门在算投影期间立一个标记（_GATE_DEPTH），让裁判能把两类读取分开：
       · 标记内的读取 → GATE 档（投影计算，与真人客户端同性质）
       · 标记外的读取 → 才进 AI 决策账本
     ⚠ 闸门**只暴露布尔可见性与投影键集**，从不把原值吐出去 —— 这一点是纪律 1/3 的落点。 */
  let _cache = null;
  let _GATE_DEPTH = 0;

  function visibleSet(g, readerId) {
    if (_cache && _cache.step === g.step && _cache.reader === readerId) return _cache.set;
    let set = null;
    const V = global.View;
    if (V && typeof V.build === 'function') {
      _GATE_DEPTH++;
      try {
        const built = V.build(g, readerId);
        if (built && built.players) {
          set = new Map();
          for (const s of built.players) set.set(s.id, new Set(Object.keys(s)));
        }
      } catch (e) { set = null; }
      finally { _GATE_DEPTH--; }
    }
    _cache = { step: g.step, reader: readerId, set };
    return set;
  }

  /** 供观测探针区分「投影读取」与「AI 决策读取」。生产代码不调用。 */
  function inGate() { return _GATE_DEPTH > 0; }

  /** 本角色能否看到 target 的该字段。判据全部来自 view.js。 */
  function canSee(g, me, target, field) {
    if (!me || !target) return false;
    if (me.id === target.id) return SELF_FIELDS.has(field) || field in PROXY_OF;
    const set = visibleSet(g, me.id);
    /* view.js 未加载 ⇒ 只可见自己（纪律 2：保守方向）。 */
    if (!set) return false;
    const keys = set.get(target.id);
    if (!keys) return false;
    if (keys.has(field)) return true;
    /* 投影字段：sanitize 下了 role/roleName/accusers，AI 要的是 originRole/… */
    for (const a of (PROXY_OF[field] || [])) if (keys.has(a)) return true;
    return false;
  }

  /** 读字段；不可见 ⇒ undefined（纪律 1：不编造默认值）。 */
  function field(g, me, target, name) {
    if (!target) return undefined;
    if (!canSee(g, me, target, name)) return undefined;
    return target[name];
  }

  /** 可见投影：目标在本角色视角下的**字段白名单**（不是原对象的拷贝）。
      ⚠ 返回白名单而非值 —— 值仍要经 field() 取，这样「拿了投影就去读原对象」不成立。
        本模块管不了「拿到对象后乱读」，那要靠 referee 探针持续盯着。 */
  function of(g, me, target) {
    if (!target) return new Set();
    if (me && target && me.id === target.id)
      return new Set([...SELF_FIELDS, ...Object.keys(PROXY_OF)]);
    const set = me ? visibleSet(g, me.id) : null;
    const keys = set && set.get(target.id);
    if (!keys) return new Set();
    const out = new Set(keys);
    /* 把投影键换回真相字段名，调用方只需问真相字段。 */
    for (const [proj, truth] of Object.entries(TRUTH_OF)) if (out.has(proj)) out.add(truth);
    return out;
  }

  /** 批量可见性谓词：筛出「me 看得见其 X 状态」的玩家。 */
  function filterVisible(g, me, list, name) {
    return list.filter(x => canSee(g, me, x, name));
  }

  /** 丢弃缓存（每步结束调；不调也不会错，只是可能重复算）。 */
  function invalidate() { _cache = null; }

  global.AIVisible = { canSee, field, of, filterVisible, invalidate, inGate, SELF_FIELDS, PROXY_OF };
})(typeof window !== 'undefined' ? window : globalThis);