/* =============================================================
 * 太空杀 · 引擎投递原语（自 js/engine.js 解耦，v27 模块化第四批）
 *
 * 职责：所有「信息出站」都从这里走，是公开/私有分叉的唯一收口点：
 *   · log()          复盘+日志（scope=all，无 batch）
 *   · announce()     公开公告（加批次号，聚合成本步公告盒给 UI）
 *   · priv()         私有投递（p.inbox + 复盘 scope=priv）—— 投递侧过滤的天然位置
 *   · god()          仅复盘可见（真实行动与隐藏结果）
 *   · applyThreat()  讨论结束清算（指控入账 + 船员公开查验锁定 + AI.reason）
 *   · banner()       顶部横幅
 *
 * 身份揭示（原 revealPublic）已移交 js/v66/reveal/revealService.js（B5 揭示统一服务，
 * v6.6 阶段 1.5）：known 写入的阵营字段按揭示路径配置，六路径口径见该文件 PATHS 表。
 *
 * 依赖：global.AIUtil（byId/…）；运行时调用 global.AI.onReveal / onAccuse / reason
 *       （延迟绑定：本文件先于 engine.js 加载，调用发生在对局中）。
 * ============================================================= */
(function (global) {
  const U = global.AIUtil;
  const P = U.byId, alive = U.alive;
  function log(g, text, kind) {
    const e = { night: g.night, step: g.step, batch: null, text, kind: kind || '', scope: 'all' };
    g.log.push(e); g.replay.push(e);
  }
  function announce(g, batch, text, scope) {
    const e = { night: g.night, step: g.step, batch, text, scope: scope || 'all', kind: 'pub' };
    g.log.push(e); g.replay.push(e);
    /* 公告推送：按「夜次/步骤」聚合成本步公告盒，UI 在决策栏顶部即时展示（到下一步为止） */
    const stamp = g.night + '/' + g.step;
    if (!g.announceBox || g.announceBox.stamp !== stamp)
      g.announceBox = { stamp, night: g.night, step: g.step, items: [] };
    g.announceBox.items.push({ batch, text, scope: e.scope });
  }
  function priv(g, p, text) {
    if (!p) return;
    p.inbox.push({ night: g.night, step: g.step, text });
    g.replay.push({ night: g.night, step: g.step, batch: null, text, scope: 'priv', who: p.id });
  }
  /* 仅复盘可见：真实行动与隐藏结果 */
  function god(g, text) {
    g.replay.push({ night: g.night, step: g.step, batch: null, text, scope: 'god' });
  }

  /* 公开身份声称冲突（同一独占职业多人声称）→ 对跳事件的推理入账。
     v26：原实现只写死 Map `p.sus`（全仓 0 处消费，纯死代码），现已删除；
     对跳的真正入账在 ai.js 的 reason() → R12（双方各 +A−，公开事实、不衰减）。 */

  /* 讨论结束的推理清算：指控→威胁度事件、船员公开查验结论、R12/R34、群体威胁度快照 */
  function applyThreat(g) {
    for (const p of g.players) {
      if (!p.lastAccuse) continue;
      global.AI.onAccuse(g, p.id, [p.lastAccuse]);
      p.lastAccuse = null;
    }
    /* 船员公开分享的查验结论（发言即公开，全体可获得）。
       v31 裁定（用户拍板）：**口头汇报不等于 ③ 官方公告** —— 此前这里给全场写硬锁
       （`o.known.set(...)`，等价于官方确认），现改为按【可伪造的宣称】入账：
       方向明确时写目标侧证据（档位取自 Tiers.RULE.lockEnemy / lockHuman，与 pipeline 同口径），
       硬锁只保留给官方 ③ 公告与角色自身的私有查验（p.crewChecks）。 */
    for (const p of g.players) {
      const info = p.pendingPublic;
      if (!info) continue;
      p.pendingPublic = null;
      const t = P(g, info.id);
      if (!t || t.out) continue;
      if (info.kind === 'lock') {
        const T = global.Tiers, AI = global.AI;
        if (T && AI && AI.addEvent) {
          const tier = info.faction === 'human' ? T.RULE.lockHuman : T.RULE.lockEnemy;
          const signed = (info.faction === 'human' ? -1 : 1) * T.SCORE[tier];
          for (const o of g.players) {
            if (o.out || o.id === p.id || o.id === t.id) continue;
            /* v32 批 4′（统一入账口）：路径③改道 MoE.absorb（参数透传）；批 5′ 补 evt=verify。
               D3 降级运行：MoE 缺席（noBridge/minimal 剖面＝Bridge 未装配）时必须与其他
               调用点同口径短路，而不是抛 TypeError 打断整局——本处曾缺守卫，是
               SK_NO_BRIDGE=1 同种子对照臂唯一的运行时崩溃源。 */
            if (global.MoE && global.MoE.absorb)
              global.MoE.absorb(g, o.id, [{ target: t.id, delta: signed, grudge: false,
                src: `shareSay:${p.id}:${t.id}:${g.night}`, kind: 'claim', tier, speakerId: p.id }], { path: 'announce', evt: 'verify' });
          }
        }
        if (info.faction !== 'human') global.AI.onAccuse(g, p.id, [t.id]);
      }
    }
    global.AI.reason(g);
  }
  function banner(g, text) { g.banner = text; }
  global.EngineAnnounce = { log, announce, priv, god, applyThreat, banner };
})(typeof window !== 'undefined' ? window : globalThis);
