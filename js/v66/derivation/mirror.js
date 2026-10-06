/* =============================================================
 * 太空杀 · 镜像账本（2.8.5 / 6.8.3⑤）
 *
 * 规则依据（v66.1 正文 2.8.5）：死囚变形为「转移操作权」而非「换人」——
 *   ① 各可变形身份的镜像账本**自开局即建立并全程并行运行**；
 *   ② **被动资源持续累积**（不受是否呈现影响），**主动资源仅于实际处于该身份期间产生**；
 *   ③ 离开即封存、切回即恢复当时状态；
 *   ④ 变形不改已到账额度——变形当夜即可使用新身份**已到账**的额度
 *      （「稻草人先领、变形仅转移操作权」，6.8.3④）。
 *
 * 本文件只管「账本存在与存取」，不判胜负、不读阵营——变形合法性由调用点收口。
 * 死囚局之外的普通玩家无镜像（accounts 为空），本模块对经典局零影响。
 * ============================================================= */
(function (global) {
  const D = global.SKData;

  /* 镜像键的规范化：按 originRole 取（转职系不设镜像——6.8.3⑦ 变形者不得转职，
     且变形池只含开局公告的人类职业与异形，无转职衍生职业）。 */
  const keyOf = roleKey => String(roleKey || 'crew');

  /* 建立镜像账本：每个可变形身份一张。call 为该身份的**运行期字段集合**（惰性建槽）。 */
  function build(keys) {
    const accounts = {};
    for (const k of keys) accounts[keyOf(k)] = { role: k, slots: {}, active: false, since: null };
    return accounts;
  }

  /* 槽位读写：镜像与本体共用同一套字段名，读写均走此处以免两处漂移 */
  function get(acc, k, field) { const a = acc[keyOf(k)]; return a ? a.slots[field] : undefined; }
  function set(acc, k, field, v) { const a = acc[keyOf(k)]; if (a) a.slots[field] = v; }
  function has(acc, k) { return !!acc[keyOf(k)]; }
  function keysOf(acc) { return Object.keys(acc || {}); }

  /* 进入/离开：主动资源的产生窗口由 active 标记界定（2.8.5②） */
  function enter(acc, k, night) {
    const a = acc[keyOf(k)]; if (!a) return false;
    a.active = true; a.since = night; return true;
  }
  function leave(acc, k) {
    const a = acc[keyOf(k)]; if (!a) return false;
    a.active = false; a.since = null; return true;
  }
  function activeKey(acc) {
    for (const k of keysOf(acc)) if (acc[k].active) return acc[k].role;
    return null;
  }

  /* 变形可选项池（6.8.3①）：本局开局公告所列全部人类职业 ∪ 异形——
     人类职业项随本局席位实际选定而变动（猎手局含猎手不含警长…），故运行时从本局构成取，
     不写死 9 项；不可变为外星人，亦不可变为转职衍生职业。 */
  function morphPool(g, comp) {
    const base = (comp || (global.SKDerivation ? global.SKDerivation.compositionOf(g) : [])) || [];
    const humanRoles = global.SKRoleDecl.baseHumanRoles();
    const pool = [];
    for (const r of humanRoles) if (base.indexOf(r) >= 0) pool.push(r);   // 本局实际在场的人类职业
    if (base.indexOf('alien') >= 0) pool.push('alien');                   // 异形（克隆）
    return pool;
  }

  global.SKMirror = { build, get, set, has, keysOf, enter, leave, activeKey, morphPool, keyOf };
})(typeof window !== 'undefined' ? window : globalThis);