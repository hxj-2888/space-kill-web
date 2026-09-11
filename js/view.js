/* 视图层：把权威对局状态裁剪成「某个玩家按规则应当看到的样子」，用于联机广播 */
(function (global) {
  const D = global.SKData;

  function sanitize(g, p, v) {
    const self = p.id === v.id;
    const god = !!g.dev;                                        // 开发者视角：上帝视角
    const isDoc = v.role === 'bio' || v.role === 'rescue' || v.role === 'tempdoc';
    const isRescuer = v.role === 'rescue' || v.role === 'tempdoc';
    const team = v.faction === 'alien' && p.faction === 'alien';

    const o = {
      id: p.id, name: p.name,
      out: p.out, outType: p.outType, cause: p.cause, outNight: p.outNight,
      revealed: p.revealed || null,
      repairExposed: !!p.repairExposed, destroyedExposed: !!p.destroyedExposed,
      transferred: !!p.transferred, claimedRole: p.claimedRole || null,
      accusers: (p.accuseHistory || []).map(a => a.id),   // 公开发言中的指控，全体可知
    };

    if (self || team || god) { o.faction = p.faction; o.role = p.role; o.roleName = p.roleName; }
    if (p.revealed) {
      o.faction = o.faction != null ? o.faction : p.revealed.faction;
      if (p.revealed.role) { o.role = o.role != null ? o.role : p.revealed.role; o.roleName = D.ROLES[o.role].name; }
    }

    if (self) {
      o.faction = p.faction; o.role = p.role; o.roleName = p.roleName;
      o.infection = p.infection ? { real: p.infection.real, deathNight: p.infection.deathNight } : null;
      o.dying = p.dying;
      o.suppressLeft = p.suppressLeft;
      o.antibodyNight = p.antibodyNight;
      o.silenceNight = p.silenceNight;
      o.shield = p.shield;
      o.bullets = p.bullets; o.patrolUsed = p.patrolUsed;
      o.bulletLog = p.bulletLog || [];
      o.repairTotal = p.repairTotal; o.extraRepair = p.extraRepair;
      o.healLeft = p.healLeft; o.selfSaveLeft = p.selfSaveLeft;
      o.rescueLeft = p.rescueLeft; o.cureLeft = p.cureLeft;
      o.cureSelf = p.cureSelf; o.nightImmune = p.nightImmune; o.destroyLeft = p.destroyLeft;
      o.awakened = p.awakened; o.meetingLeft = p.meetingLeft;
      o.alien = p.alien;
      o.checkPool = [...p.checkPool.values()];
      o.crewChecks = [...p.crewChecks.entries()].map(([id, x]) => ({ id: +id, n: x.n, excludes: x.excludes, locked: x.locked }));
      o.known = [...p.known.entries()];
      o.inbox = p.inbox; o.notes = p.notes;
      o.brew = p.brew;
      o.lastProtected = p.lastProtected; o.lastInvite = p.lastInvite;
    } else {
      if (isRescuer) o.dying = !!p.dying;
      if (isDoc) o.infection = p.infection ? { exists: true } : null;
      else if (team) o.infection = p.infection ? { exists: true, real: p.infection.real } : null;
      if (team) { o.shield = p.shield; o.alien = { dir: p.alien.dir, kills: p.alien.kills, destroyTotal: p.alien.destroyTotal }; }
    }
    return o;
  }

  function build(g, pid) {
    const v = g.players[pid - 1];
    if (!v) return null;
    const isDoc = v.role === 'bio' || v.role === 'rescue' || v.role === 'tempdoc';

    /* v21 改动 #11：可见性过滤收敛到投递侧唯一实现 infer/visible.js（SKVisible.canSee） */
    const log = g.log.filter(e => global.SKVisible.canSee(v, e));

    const votes = {};
    if (v.role === 'inspector' || g.dev) { if (g.voteSources) Object.assign(votes, g.voteSources); }
    else if (v.faction === 'alien' && g.voteSources) {
      for (const p of g.players) if (p.faction === 'alien') votes[p.id] = g.voteSources[p.id];
    }

    return {
      view: true, humanId: pid,
      night: g.night, day: g.day, phase: g.phase, step: g.step, stepDone: g.stepDone,
      countdown: g.countdown, net: (g.net10 || 0) / 10, threat: g.threat,
      banner: g.banner || null, over: g.over, winner: g.winner,
      extinction: g.extinction, duel: g.duel, stalemate: g.stalemate,
      meeting: !!g.meeting, alive: g.players.filter(p => !p.out).length,
      accuseMark: g.accuseMark || null,
      pendingAsk: (g.pendingAsk && g.pendingAsk.target === pid) ? g.pendingAsk : undefined,
      /* 本步公告盒（可见性过滤走 SKVisible 投递侧唯一实现，v21 改动 #11） */
      announceBox: g.announceBox ? {
        night: g.announceBox.night, step: g.announceBox.step,
        items: g.announceBox.items.filter(e => global.SKVisible.canSee(v, e)),
      } : undefined,
      players: g.players.map(p => sanitize(g, p, v)),
      log, chatLog: g.chatLog, inbox: v.inbox,
      talks: g.talks || [], wills: g.wills || [], pairs: g.pairs || [],
      votes,
      voteHistory: (v.role === 'inspector' || g.dev) ? (g.voteHistory || []) : undefined,
      /* 开发者视角：威胁度表（各 AI 私有 + 群体共识）、当轮与历史票型、技能状态、私聊记录 */
      dev: g.dev ? {
        threat: g.threat || {},
        agents: g.players.filter(p => !p.isHuman && !p.out).map(a => ({
          id: a.id, faction: a.faction, role: a.role, roleName: a.roleName, theta: a.theta,
          top: Engine.alive(g).filter(t => t.id !== a.id)
            .map(t => ({ id: t.id, T: Math.round(global.AI ? global.AI.suspOf(g, a, t.id) : 0) }))
            .sort((x, y) => y.T - x.T),
        })),
        votes: g.voteSources || {},
        history: g.voteHistory || [],
        skills: g.players.map(p => ({
          id: p.id, name: p.name, faction: p.faction, role: p.role, roleName: p.roleName,
          out: p.out, dying: p.dying, theta: p.theta,
          bullets: p.bullets, patrolUsed: p.patrolUsed, bulletLog: p.bulletLog || [],
          repairTotal: p.repairTotal, extraRepair: p.extraRepair, repairExposed: !!p.repairExposed,
          healLeft: p.healLeft, selfSaveLeft: p.selfSaveLeft, rescueLeft: p.rescueLeft, cureLeft: p.cureLeft,
          kills: p.alien ? p.alien.kills : null, extraKill: p.alien ? p.alien.extraKill : null,
          destroyTotal: p.alien ? p.alien.destroyTotal : null, dir: p.alien ? p.alien.dir : null,
          shield: p.shield, nightImmune: p.nightImmune, cureSelf: p.cureSelf, awakened: p.awakened,
          infection: p.infection ? { real: p.infection.real, deathNight: p.infection.deathNight } : null,
          silenceNight: p.silenceNight, suppressLeft: p.suppressLeft, meetingLeft: p.meetingLeft,
          antibodyNight: p.antibodyNight, brew: p.brew,
          known: [...p.known.entries()], accusers: (p.accuseHistory || []).map(a => a.id),
        })),
        chats: g.privateChats || [],
        /* 上帝视角：全员私人反馈（inbox）——私聊正文、攻击结果、查验通知、免疫消耗等 */
        inboxes: g.players.map(p => ({
          id: p.id, name: p.name,
          items: (p.inbox || []).slice(-8).map(e => ({ night: e.night, step: e.step, text: e.text })),
        })).filter(x => x.items.length),
      } : undefined,
      pending: (g.pendings && g.pendings[pid]) || null,
      pendingCount: Object.keys(g.pendings || {}).length,
      seed: undefined,
    };
  }

  /* JSON 传输后的还原：数组 → Map，保证 UI 直接可用 */
  function hydrate(view) {
    for (const p of view.players) {
      if (p.known) p.known = new Map(p.known); else p.known = new Map();
      if (p.infection && p.infection.exists && p.real === undefined && p.deathNight === undefined && p.real == null) {
        /* 医生视角：仅可见存在性 */
      }
    }
    return view;
  }

  global.View = { build, hydrate };
})(typeof window !== 'undefined' ? window : globalThis);
