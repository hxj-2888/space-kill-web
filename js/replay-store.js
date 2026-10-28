/* =============================================================
 * 新返航录 · 对局回放存档（批 UI-8c · 2026-10-27）
 * -------------------------------------------------------------
 * 用户原话：「对局回放速览，只有玩家要求下载的时候才存储，最多存储三局」，
 *           「点一下保存本局，第四局来了覆盖最旧的那局，用户可选择删除其中一局或多局」。
 *
 * 三条纪律（都不许破）：
 *   ① **不自动存**。只有玩家点了「保存本局」才写入 —— 开局、结束一律不动存档。
 *   ② **最多 3 局**。满了以后覆盖**最旧**的那一局（按 savedAt 排）。
 *   ③ **K3 红线**：回放内容只能经 View.replayOf(g) 取得（仅终局后非 null）。
 *      本模块不读 g.replay，只接收调用方已经取到的数组。
 *
 * 存什么 / 不存什么
 * -------------------
 * 存： nightly 回放流（scope/text/batch/night/step/who）+ 结果摘要 + 15 人身份快照。
 *   身份快照是**事后上帝视角**用的（终局后本来就公开，2.6.3），不是对局中泄露。
 * 不存：玩家改名记录、聊天原文之外的私有节点、任何 AIMemory。
 *
 * 为什么用 localStorage 而不是 IndexedDB：
 *   3 局 × 约 40~120KB ≈ 最多 400KB，localStorage 的 5MB 富余足够；
 *   而 IndexedDB 是异步 API，会让「主页点回放」变成一个需要 await 的状态机，
 *   对一个"最多 3 条记录"的列表来说是过度设计。
 * ============================================================= */
(function (global) {
  'use strict';

  const KEY = 'sk_replays_v1';
  const MAX = 3;

  function store() {
    try { return global.localStorage; } catch (_) { return null; }
  }

  /** 读出全部存档（永远返回数组；坏数据一律当空，不让主页因为一条脏记录打不开） */
  function list() {
    const ls = store();
    if (!ls) return [];
    let raw = null;
    try { raw = ls.getItem(KEY); } catch (_) { return []; }
    if (!raw) return [];
    let arr;
    try { arr = JSON.parse(raw); } catch (_) { return []; }
    if (!Array.isArray(arr)) return [];
    /* 逐条验形：缺 id / 缺 replay 的条目直接丢掉（宁缺毋滥，避免渲染时崩） */
    return arr.filter(function (x) {
      return x && typeof x === 'object' && x.id && Array.isArray(x.replay);
    }).sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
  }

  function persist(arr) {
    const ls = store();
    if (!ls) return false;
    try { ls.setItem(KEY, JSON.stringify(arr)); return true; }
    catch (e) {
      /* 配额满：先砍到 1 条再试一次（宁可少存，不要静默失败） */
      try { ls.setItem(KEY, JSON.stringify(arr.slice(0, 1))); return true; } catch (_) { return false; }
    }
  }

  /** 从一局终局数据里抽出一份紧凑存档。**不做任何裁决**，只搬运。 */
  function pack(g, replay) {
    if (!g || !Array.isArray(replay)) return null;
    const when = Date.now();
    const players = (g.players || []).map(function (p) {
      return {
        id: p.id, name: p.name, role: p.role, roleName: p.roleName,
        faction: p.faction, out: !!p.out, outNight: p.outNight != null ? p.outNight : null,
        outType: p.outType || null,
      };
    });
    return {
      id: 'r' + when.toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      savedAt: when,
      /* 结果摘要：主页列表上要能一眼分辨是哪一局 */
      seed: g.seed != null ? g.seed : null,
      night: g.night != null ? g.night : null,
      phase: g.phase || null,
      winner: (g.result && (g.result.winner || g.result.faction)) || g.winner || null,
      nights: (function () {
        const s = {};
        replay.forEach(function (e) { if (e && e.night != null) s[e.night] = 1; });
        return Object.keys(s).length;
      })(),
      humanId: g.humanId != null ? g.humanId : null,
      players: players,
      replay: replay,
    };
  }

  /** 保存一局。返回 { ok, id, evicted } 或 { ok:false, reason } */
  function save(g, replay) {
    const rec = pack(g, replay);
    if (!rec) return { ok: false, reason: '没有可保存的回放' };
    const arr = list();
    arr.unshift(rec);
    const evicted = [];
    while (arr.length > MAX) evicted.push(arr.pop());
    const ok = persist(arr);
    return ok ? { ok: true, id: rec.id, evicted: evicted }
              : { ok: false, reason: '浏览器存储不可用或已满' };
  }

  /** 按 id 删一局或多局 */
  function remove(ids) {
    const set = {};
    (Array.isArray(ids) ? ids : [ids]).forEach(function (x) { if (x) set[x] = 1; });
    const arr = list().filter(function (r) { return !set[r.id]; });
    return persist(arr);
  }

  function get(id) {
    const arr = list();
    for (let i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  function clear() { return remove(list().map(function (r) { return r.id; })); }

  global.SKReplayStore = {
    KEY: KEY, MAX: MAX,
    list: list, save: save, remove: remove, get: get, clear: clear,
    /* 纯函数导出，便于门禁在 Node 侧直接量 */
    pack: pack,
  };
})(typeof window !== 'undefined' ? window : globalThis);
