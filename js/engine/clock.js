/* =============================================================
 * SKClock / SKSlots / SKActions · 实时化的三块地基（批 RTA-0 / R2 · 2026-10-28）
 * -------------------------------------------------------------
 * 职责：
 *   ① 相位时钟：夜 90s / 昼 60s，tick 0.25s —— 取代"每步等人决策"；
 *   ② 个人技能槽：一夜用掉任一"夜技" ⇒ **本人**其余夜技本夜不可用（不影响别人）；
 *   ③ 动作请求队列：六道校验（动作/权能/场所/距离/视线/冷却）→ 入队 → 按固定键排序结算。
 *
 * 不变量（违反必红，见 tools/test-clock.cjs）：
 *   · **纯逻辑**：不读 DOM、不读 global 业务对象、不自己起定时器（时间由调用方注入），
 *     这样 Node 门禁与浏览器可以跑出**逐位相同**的结果；
 *   · **随机只在结算时抽**，且顺序由固定键 (room, playerId, actionId) 决定 ——
 *     不允许"谁点得快谁先结算"（那会把 g.rng 的抽取顺序变成玩家手速，毁掉复盘/蒙特卡洛）；
 *   · 个人技能槽**按人隔离**：一个人用掉，不影响其他人。
 *
 * 说明：本批**不接入引擎**（R4 才接），所以行为指纹不变；这里只把"时钟/槽位/队列"
 * 做成可单独测试的纯函数。
 * ============================================================= */
(function (global) {
  'use strict';

  const PHASE_MS = { night: 90000, day: 60000 };
  const TICK_MS = 250;          /* 砍到 0.25s：0.5s 的出刀 = 2 tick，1s 的枪击 = 4 tick */
  const MAX_CATCHUP = 8;        /* 一帧最多补 8 个 tick（切后台回来不许一次结算 360 个） */

  /* ---------------- ① 相位时钟 ---------------- */
  /* durMs 可选：V3 规则要 120s 的夜 / 60s 的开局讨论，而老口径是 90/60。
     给一个**可选覆盖**而不是改 PHASE_MS —— 老口径与 test:clock 的读数必须逐位不变。 */
  function newPhase(phase, nowMs, durMs) {
    const dur = durMs || PHASE_MS[phase] || PHASE_MS.night;
    return { phase: phase, startedAt: nowMs, endsAt: nowMs + dur, dur: dur, tickMs: TICK_MS, lastTick: -1 };
  }
  function remaining(st, nowMs) { return Math.max(0, st.endsAt - nowMs); }
  function expired(st, nowMs) { return nowMs >= st.endsAt; }
  /* 自上次推进以来应该结算的 tick 序号（含补帧，但不超过 MAX_CATCHUP） */
  function dueTicks(st, nowMs) {
    /* tick k 在 (k+1)*tickMs **走完**时才算到期 —— 否则 0.5s 会算出 3 个（含刚开始的那个）。
       这条边界错一次，整局的结算次数就多 1/3。 */
    const done = Math.floor((Math.min(nowMs, st.endsAt) - st.startedAt) / st.tickMs) - 1;
    const upto = Math.max(-1, done);
    const out = [];
    for (let k = st.lastTick + 1; k <= upto && out.length < MAX_CATCHUP; k++) out.push(k);
    if (out.length) st.lastTick = out[out.length - 1];
    return out;
  }
  function fmt(ms) {
    const t = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(t / 60), s = t % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---------------- ② 个人技能槽 ---------------- */
  /* 一夜一个"夜技槽"：动作用的冷却类型来自动作映射表（cd.type === 'night'）。
     劳务型（repair/craft 等 cd.type !== 'night'）不吃这个槽 —— 与表里的规定一致。 */
  const SLOTS = {};
  function resetSlots(g) { SLOTS.night = {}; return SLOTS; }
  function nightOf(g) {
    if (!SLOTS.night || SLOTS.night.__night !== (g && g.night)) {
      SLOTS.night = { __night: (g && g.night) || 0 };
    }
    return SLOTS.night;
  }
  /* 只把"带共享组的夜技"计入槽位：带 group 的才是"技能"（G1/G2/G3）；
     维修这类"个人每夜 1 次"的劳务虽然也是 night 冷却，但**不占技能槽**（否则工程师的
     追加维修会被自己的维修挡掉，与原文冲突）。 */
  function isNightSkill(action) {
    return !!(action && action.cd && action.cd.type === 'night' && action.cd.group);
  }
  function canUse(g, playerId, action) {
    if (!isNightSkill(action)) return true;              /* 劳务不受槽位限制 */
    const n = nightOf(g);
    return !n[playerId];                                  /* 本夜还没用掉自己的槽 */
  }
  function useSlot(g, playerId, action) {
    if (!isNightSkill(action)) return false;
    const n = nightOf(g);
    if (n[playerId]) return false;
    n[playerId] = action.id;
    return true;
  }
  function usedBy(g, playerId) { return nightOf(g)[playerId] || null; }

  /* ---------------- ③ 动作请求：六道校验 ---------------- */
  /* req = {
   *   actor: { id, caps: string[]|Set, room: string, pos: {x,y} },
   *   actionId, target: { id?, pos?, room?, alive?, out? },
   *   place: { room, prop },            // 实际交互的物件（由场景点击给出）
   *   now, los: fn(a,b)=>bool,          // 由调用方注入几何
   * }
   * 返回 { ok:true, action } 或 { ok:false, reason }
   * reason ∈ no-action | cap | place | dist | los | cd | target | phase
   */
  const MELEE = 1.2;
  const EYE = 9;      /* 视野半径（= 枪的射程）；由调用方用 VISION_R 覆盖 */
  function hasCap(actor, cap) {
    const c = actor && actor.caps;
    if (!c) return false;
    if (typeof c.has === 'function') return c.has(cap);
    if (Array.isArray(c)) return c.indexOf(cap) >= 0;
    return false;
  }
  function validate(req) {
    const A = global.SKActionMap;
    if (!A) return { ok: false, reason: 'no-action' };
    const action = A.get(req.actionId);
    if (!action) return { ok: false, reason: 'no-action' };
    const actor = req.actor || {};
    const target = req.target || {};

    /* ① 权能（指纹） */
    if (!hasCap(actor, action.cap)) return { ok: false, reason: 'cap' };

    /* ② 场所：动作绑定的房间/物件必须与"实际点的东西"一致（`any` 除外） */
    if (action.place.room && action.place.room !== 'any') {
      if (!req.place || req.place.room !== action.place.room) return { ok: false, reason: 'place' };
      if (action.place.prop && req.place.prop !== action.place.prop) return { ok: false, reason: 'place' };
    }

    /* ③ 距离 */
    const R = req.eye || EYE;
    const d = (actor.pos && target.pos) ? Math.hypot(target.pos.x - actor.pos.x, target.pos.y - actor.pos.y) : null;
    if (action.dist === '触') {
      if (d == null || d > MELEE) return { ok: false, reason: 'dist' };
    } else if (action.dist === '房') {
      if (actor.room == null || target.room == null || actor.room !== target.room) return { ok: false, reason: 'dist' };
    } else if (action.dist === '远' || action.dist === '视野内') {
      if (d == null || d > R) return { ok: false, reason: 'dist' };
    }

    /* ④ 视线（近身不需要；远程必须） */
    if ((action.dist === '远' || action.dist === '视野内') && typeof req.los === 'function') {
      if (!req.los(actor.pos, target.pos)) return { ok: false, reason: 'los' };
    }

    /* ⑤ 冷却（个人技能槽：只影响本人） */
    if (!canUse(req.g, actor.id, action)) return { ok: false, reason: 'cd' };

    /* ⑥ 目标 */
    if (action.target === 'other') {
      if (!target || target.id == null) return { ok: false, reason: 'target' };
      if (target.out) return { ok: false, reason: 'target' };
      if (target.id === actor.id && action.id !== 'alien.knife') return { ok: false, reason: 'target' };
    }
    return { ok: true, action: action };
  }

  /* 入队：只有校验通过的请求才进队列 */
  function request(queue, req) {
    const r = validate(req);
    if (!r.ok) return r;
    queue.push({
      actorId: req.actor.id, actionId: req.actionId,
      room: (req.place && req.place.room) || req.actor.room || '',
      tick: req.tick == null ? 0 : req.tick,
    });
    return { ok: true, action: r.action };
  }

  /* 结算顺序：固定键（tick → 房间 → 玩家编号 → actionId）——
     与点击顺序无关，保证同种子复现。原地排序后返回。 */
  function flush(queue) {
    const out = queue.slice().sort(function (a, b) {
      if (a.tick !== b.tick) return a.tick - b.tick;
      if (a.room !== b.room) return a.room < b.room ? -1 : 1;
      if (a.actorId !== b.actorId) return a.actorId - b.actorId;
      return a.actionId < b.actionId ? -1 : (a.actionId > b.actionId ? 1 : 0);
    });
    queue.length = 0;
    return out;
  }

  global.SKClock = {
    PHASE_MS: PHASE_MS, TICK_MS: TICK_MS, MAX_CATCHUP: MAX_CATCHUP,
    newPhase: newPhase, remaining: remaining, expired: expired, dueTicks: dueTicks, fmt: fmt,
  };
  global.SKSlots = {
    resetSlots: resetSlots, canUse: canUse, useSlot: useSlot, usedBy: usedBy, isNightSkill: isNightSkill,
  };
  global.SKActions = {
    MELEE: MELEE, EYE: EYE,
    validate: validate, request: request, flush: flush, hasCap: hasCap,
  };
})(typeof window !== 'undefined' ? window : globalThis);
