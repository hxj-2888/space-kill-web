/* =============================================================
 * SKInvariants · 对局不变量断言（批 V3.1 · 2026-10-28）
 * -------------------------------------------------------------
 * 职责：   只做**只读检查**：给定一局状态 G 与几何函数，返回
 *          { checks, fails }。不修状态、不读 DOM、不掷随机。
 * 不变量： · 15 人 / 4 异形 / 11 人类恒定；
 *          · 活人必须站在可走地面（管道口/贴边容差除外）；
 *          · 死者必有死因与尸体坐标（驱逐除外），濒死必是活人；
 *          · 投票只能由活人投、不能投自己、票数必须与结果表对账；
 *          · 拖拽双方必须互相指向且距离 ≤ 3.2 格；
 *          · 结算态必须有原因、且会议已关闭。
 * 依赖：   无（几何函数由调用方注入，Node 门禁可直接跑）。
 * 对外：   global.SKInvariants = { check, MAX_PROG }
 * ============================================================= */
(function (global) {
  'use strict';

  const MAX_PROG = 40;
  const CAUSES = { knife: 1, shot: 1, bled: 1, vote: 1 };
  const PHASES = { discuss: 1, vote: 1, reveal: 1 };

  function check(G, env) {
    const fails = [];
    let checks = 0;
    function ok(cond, code, msg) {
      checks++;
      if (!cond) fails.push({ code: code, msg: msg });
    }
    if (!G || !env) {
      ok(false, 'G0', '缺少对局状态或几何环境');
      return { checks: checks, fails: fails };
    }

    const M = env.M;
    const NIGHT = env.NIGHT;
    const agents = G.agents || [];
    const me = G.me;

    /* ---------- 人 / 阵营 ---------- */
    ok(agents.length === 15, 'A1', '人数 ' + agents.length + ' ≠ 15');
    const names = new Set();
    let aliens = 0, humans = 0;
    for (const a of agents) {
      names.add(a.name);
      if (a.alien) aliens++; else humans++;
      ok(a.i >= 0 && a.i < 15, 'A2', (a.name || '?') + ' 席位号越界 ' + a.i);
      ok(Number.isFinite(a.x) && Number.isFinite(a.y), 'A3', a.name + ' 坐标非有限数');
      ok(a.x >= -1 && a.x <= M.bounds.w + 1 && a.y >= -1 && a.y <= M.bounds.h + 1,
        'A4', a.name + ' 越出船体边界');
      ok(Array.isArray(a.tasks) && a.tasks.length === 4, 'A5', a.name + ' 任务数 ≠ 4');
      const uniq = new Set(a.tasks || []);
      ok(uniq.size === (a.tasks || []).length, 'A6', a.name + ' 任务点重复');
      for (const t of a.tasks || []) {
        ok(Number.isInteger(t) && t >= 0 && t < M.points.length, 'A7', a.name + ' 任务索引越界 ' + t);
      }
      ok(a.tIdx >= 0 && a.tIdx <= a.tasks.length, 'A8', a.name + ' 任务进度越界 ' + a.tIdx);
      ok(!(a.doing > 0) || (Number.isFinite(a.doing) && a.doing < 400), 'A9', a.name + ' 动作计时异常');

      /* ---------- 生 / 死 / 濒死 ---------- */
      ok(!a.downed || a.alive, 'A10', a.name + ' 濒死但已不在场');
      ok(a.knife >= 0 && a.knife <= 1, 'A11', a.name + ' 刀数异常 ' + a.knife);
      ok(a.qual >= 0 && a.qual <= 2, 'A12', a.name + ' 资格异常 ' + a.qual);
      ok(a.bullet >= 0 && a.bullet <= 1, 'A13', a.name + ' 子弹异常 ' + a.bullet);
      ok(a.medkit >= 0 && a.medkit <= 1, 'A14', a.name + ' 医疗包异常 ' + a.medkit);
      if (!a.alive) {
        ok(CAUSES[a.deathCause] === 1, 'A15', a.name + ' 死亡但无合法死因');
        ok(a.deathCause === 'vote' || (Number.isFinite(a.bodyX) && Number.isFinite(a.bodyY)),
          'A16', a.name + ' 死亡但缺尸体坐标');
      }
      if (a.alive && !a.downed) {
        ok(env.walkableNear(a.x, a.y) || env.nearPipe(a.x, a.y), 'A17', a.name + ' 站在不可走位置');
      }
      ok(a.detained !== true || !a.path || a.path.length === 0, 'A18', a.name + ' 被擒拿但仍有路径');
      if (a.path) {
        ok(Array.isArray(a.path), 'A19', a.name + ' 路径不是数组');
        if (a.path.length) {
          const p = a.path[a.path.length - 1];
          ok(Number.isFinite(p[0]) && Number.isFinite(p[1]), 'A20', a.name + ' 路径终点非有限数');
        }
      }
    }
    ok(names.size === agents.length, 'A21', '存在重名席位');
    ok(aliens === 4, 'A22', '异形 ' + aliens + ' ≠ 4');
    ok(humans === 11, 'A23', '人类 ' + humans + ' ≠ 11');
    ok(me === agents[0], 'A24', 'me 不是 0 号席位');

    /* ---------- 全局 ---------- */
    ok(G.prog >= 0 && G.prog <= MAX_PROG, 'G1', '维修进度越界 ' + G.prog);
    ok(G.night >= 1, 'G2', '夜数 < 1');
    ok(Number.isFinite(G.t) && G.t >= -1 && G.t <= NIGHT + 1, 'G3', '夜间计时越界 ' + G.t);
    ok(G.lightState === 0 || G.lightState === 1 || G.lightState === 2, 'G4', '灯光态非法 ' + G.lightState);
    const bright = M.rooms.filter(function (r) { return r.light === 'bright'; }).length;
    let litCount = 0;
    for (const r of M.rooms) if (G.lit[r.id]) litCount++;
    const wantLit = G.lightState === 1 ? M.rooms.length : (G.lightState === 2 ? 1 : bright);
    ok(litCount === wantLit, 'G5', '点灯房数 ' + litCount + ' ≠ ' + wantLit);

    /* ---------- 拖拽（玩家与 AI 共用） ---------- */
    for (const a of agents) {
      if (a.drag != null) {
        const b = agents[a.drag];
        ok(!!b, 'D1', a.name + ' 拖拽目标不存在');
        if (b) {
          ok(b !== a, 'D1b', a.name + ' 拖拽了自己');
          ok(b.draggedBy === a.i, 'D2', a.name + ' 拖拽标记未与目标互指');
          ok(a.alive && !a.downed && !a.detained, 'D3', a.name + ' 当前状态不能拖拽');
          const bp = env.bodyPos(b);
          ok(!!bp, 'D4', a.name + ' 拖拽目标没有尸体/濒死者');
          if (bp) ok(Math.hypot(bp[0] - a.x, bp[1] - a.y) <= 3.2, 'D5', a.name + ' 拖拽距离过远');
        }
      }
      if (a.draggedBy != null) {
        const d = agents[a.draggedBy];
        ok(!!d && d.drag === a.i, 'D6', a.name + ' 被拖标记没有对应拖拽者');
      }
    }
    ok((G.drag == null) === (me.drag == null) && G.drag === me.drag, 'D7', 'G.drag 与玩家拖拽状态不同步');

    /* ---------- 会议 / 投票 ---------- */
    if (G.meet) {
      const m = G.meet;
      ok(PHASES[m.phase] === 1, 'M1', '会议阶段非法 ' + m.phase);
      ok(Number.isFinite(m.t), 'M2', '会议计时非有限数');
      if (m.phase === 'vote') {
        for (const k in m.votes) {
          const vi = +k, target = m.votes[k];
          const voter = agents[vi];
          ok(!!voter, 'M3', '未知投票人 ' + k);
          if (voter) ok(voter.alive && !voter.downed, 'M4', voter.name + ' 已不能投票却投了票');
          ok(target === -1 || (target >= 0 && target < agents.length), 'M5', '票目标越界 ' + target);
          if (target >= 0) ok(target !== vi, 'M6', (voter ? voter.name : k) + ' 投了自己');
        }
      }
      if (m.phase === 'reveal' && m.tally) {
        let sum = m.tally.abstain, votes = 0;
        for (const k in m.tally.tally) sum += m.tally.tally[k];
        for (const k in m.votes) votes++;
        ok(sum === votes, 'M7', '票数对账 ' + sum + ' ≠ ' + votes);
      }
    }

    /* ---------- 结算 ---------- */
    if (G.over) {
      ok(!!G.overWhy, 'W1', '已结束但没有原因');
      ok(G.meet == null, 'W2', '已结束但会议仍开着');
    }

    return { checks: checks, fails: fails };
  }

  global.SKInvariants = { check: check, MAX_PROG: MAX_PROG };
})(typeof window !== 'undefined' ? window : globalThis);
