/* =============================================================
 * 太空杀 · AI 长期记忆（拟人层 A）
 *
 * 人为什么「记得」某个玩家？因为他把跨夜的行为**归并成印象**——
 * 谁说过自己是几号、谁承诺过什么、谁说过的话被证伪、谁一直站我这边。
 * 本模块把这种「印象」做成结构化账本，供发言层（推理链发言）与叙事层读取。
 *
 * 与既有设施的分工（避免三处并行维护同一件事）：
 *   · tEvents      —— 单夜的证据事件流（推理输入，**不归并**）
 *   · claims       —— 发言原文流水（复现与 NLP 解析用）
 *   · ★本模块★     —— 跨夜**归并后的印象**（发言时能引用的那一句「因为」）
 *
 * 纪律：本模块只记 AI **合法持有**的信息（7.0 推理自由）——
 * 公开公告、他人发言、自身查验结果、私聊所得。**不记任何隐藏字段**
 * （他人真实身份/阵营/私有额度），否则记忆即透视。
 * ============================================================= */
(function (global) {

  /* 记忆分四类，对应人脑的四类印象： */
  const KINDS = ['saidRole', 'promise', 'contradiction', 'stance'];

  function empty() {
    return { saidRole: new Map(), promise: new Map(), contradiction: [], stance: new Map(), said: [] };
  }

  /* 〔批次 35 · 记忆容量（内存分档）〕注意力是缓存（每夜清零、入口截流），记忆是内存：
     比缓存大、跨夜存续，但同样有限——memCap 按 θ 档给出（激进 14 / 中性 10 / 保守 7），
     超出按「最旧先忘」驱逐。拟真依据：人记不全所有人的印象，遗忘从最久没更新的开始；
     刚写下的印象（当夜最新）永不被本轮驱逐挤出。 */
  function capOf(p) {
    const T = global.SKTrait;
    const v = (T && p && p.theta != null) ? T.traitValue('theta', 'memCap', p.theta) : null;
    return (typeof v === 'number' && v > 0) ? v : Infinity;
  }
  /* Map 容器裁剪：驱逐 lastOf 最早者（最久未更新先忘） */
  function trimMap(m, cap, lastOf) {
    if (!isFinite(cap) || m.size <= cap) return;
    const arr = Array.from(m.entries()).sort((a, b) => lastOf(a[1]) - lastOf(b[1]));
    for (let i = 0; i < m.size - cap; i++) m.delete(arr[i][0]);
  }
  /* 承诺容器裁剪：容量按「条数」计（跨所有说话者合并），逐条删最旧 */
  function trimPromises(m, cap) {
    let total = 0;
    for (const arr of m.values()) total += arr.length;
    if (!isFinite(cap) || total <= cap) return;
    const all = [];
    for (const [sid, arr] of m) for (let i = 0; i < arr.length; i++) all.push({ sid, i, night: arr[i].night });
    all.sort((a, b) => a.night - b.night);
    const drop = new Set(all.slice(0, total - cap).map(x => x.sid + ':' + x.i));
    for (const [sid, arr] of m) {
      const kept = arr.filter((x, i) => !drop.has(sid + ':' + i));
      if (kept.length) m.set(sid, kept); else m.delete(sid);
    }
  }

  /* ① 某人自称是什么（claimedRole 记忆：跨夜累积，可被翻旧账） */
  function noteRole(p, speakerId, roleKey, night) {
    if (!p.mem) p.mem = empty();
    let e = p.mem.saidRole.get(speakerId);
    if (!e) { e = { role: roleKey, firstNight: night, times: 0, nights: [] }; p.mem.saidRole.set(speakerId, e); }
    /* 同一夜改口只记最后一次（人不会把同一夜的两次自称当成两件事） */
    if (e.nights[e.nights.length - 1] !== night) e.nights.push(night);
    e.role = roleKey;
    e.times += 1;
    trimMap(p.mem.saidRole, capOf(p), x => x.nights[x.nights.length - 1]);
    return e;
  }

  /* ② 某人的承诺（promises 已有结算，这里只做「我记得他承诺过」的索引） */
  function notePromise(p, speakerId, night, tier, targets) {
    if (!p.mem) p.mem = empty();
    const arr = p.mem.promise.get(speakerId) || [];
    arr.push({ night, tier, targets: (targets || []).slice() });
    p.mem.promise.set(speakerId, arr);
    trimPromises(p.mem.promise, capOf(p));
    return arr;
  }

  /* ③ 矛盾/翻车（两种来源：自称冲突、承诺未兑现）——人脑最强烈的记忆 */
  function noteContradiction(p, subjectId, night, kind, detail) {
    if (!p.mem) p.mem = empty();
    /* 去重：同一夜同一类型对同一人只记一次（人不会为同一件事反复生气） */
    if (p.mem.contradiction.some(c => c.night === night && c.subject === subjectId && c.kind === kind)) return null;
    p.mem.contradiction.push({ subject: subjectId, night, kind, detail: detail || '' });
    /* 裁剪：按夜升序排列后从最旧端截断（pickCitable 取末位＝最近，语义一致） */
    const cap = capOf(p);
    if (isFinite(cap) && p.mem.contradiction.length > cap) {
      p.mem.contradiction.sort((a, b) => a.night - b.night);
      p.mem.contradiction.splice(0, p.mem.contradiction.length - cap);
    }
    return p.mem.contradiction[p.mem.contradiction.length - 1];
  }

  /* ④ 立场印象（他这些天一直投谁 / 一直保谁）——用于「我观察他很久了」类发言 */
  function noteStance(p, subjectId, night, delta) {
    if (!p.mem) p.mem = empty();
    const e = p.mem.stance.get(subjectId) || { score: 0, votesFor: 0, votesAgainst: 0, firstNight: night, lastNight: night };
    e.score += delta;
    e.lastNight = night;
    p.mem.stance.set(subjectId, e);
    trimMap(p.mem.stance, capOf(p), x => x.lastNight);
    return e;
  }

  /* 发言前挑一条「可引用的记忆」——优先级：矛盾 > 翻脸的口头禅 > 自称 > 立场。
     这是人说话的真实结构：先说最有情绪价值的那条，而不是最新鲜的那条。 */
  function pickCitable(p, night) {
    const m = p.mem;
    if (!m) return null;
    /* ① 矛盾（最近一条，且不超过 3 夜——太久远的不值得翻） */
    const cs = m.contradiction.filter(c => night - c.night <= 3);
    if (cs.length) {
      const c = cs[cs.length - 1];
      return { kind: 'contradiction', subject: c.subject, night: c.night, detail: c.kind, weight: 3 };
    }
    /* ② 自称改口（同一玩家自称过两个不同身份） */
    for (const [sid, e] of m.saidRole) {
      if (e.nights.length >= 2) return { kind: 'saidRole', subject: sid, role: e.role, nights: e.nights, weight: 2 };
    }
    /* ③ 立场鲜明（长期站队） */
    let best = null;
    for (const [sid, e] of m.stance) {
      if (Math.abs(e.score) >= 3 && (!best || Math.abs(e.score) > Math.abs(best.e.score))) best = { sid, e };
    }
    if (best) return { kind: 'stance', subject: best.sid, score: best.e.score, weight: 1 };
    return null;
  }

  /* 自称冲突检测：同一人自称过两个不同身份 ⇒ 矛盾。注册在 onClaim 之后调用。 */
  function checkRoleConflict(p, night) {
    const m = p.mem; if (!m) return null;
    for (const [sid, e] of m.saidRole) {
      if (e.conflictWith) return noteContradiction(p, sid, night, 'roleConflict', e.role + ' / ' + e.conflictWith);
    }
    return null;
  }

  function stats(p) {
    const m = p.mem;
    if (!m) return { saidRole: 0, promise: 0, contradiction: 0, stance: 0 };
    return {
      saidRole: m.saidRole.size, promise: m.promise.size,
      contradiction: m.contradiction.length, stance: m.stance.size,
    };
  }

  global.AIMemory = { KINDS, empty, noteRole, notePromise, noteContradiction, noteStance, pickCitable, checkRoleConflict, stats };
})(typeof window !== 'undefined' ? window : globalThis);