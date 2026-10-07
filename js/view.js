/* 视图层：把权威对局状态裁剪成「某个玩家按规则应当看到的样子」，用于联机广播 */
(function (global) {
  const D = global.SKData;
  const RD = global.SKRoleDecl;                 // v6.6 阶段 2（D6）：能力分发表（视角裁剪按能力判定）

  /* =============================================================
   * K3 防透视架构化（v6.6 阶段 4 · B3/B4/G6）——本文件是**唯一的视图构建器**，
   * 三条能力边界在此集中实现，调用点不得绕过：
   *   · B3/H13：对局进行中，任何视图都不含 replay（隐藏历史）。完整回放只在终局后
   *     经 View.replayOf(g) 发放（2.6.3：终局后全体可看完整回放）。
   *   · B4：私有节点只对持有者出现（他人的 inbox/known/checkPool/crewChecks/notes 一律不下发）。
   *   · G6：出局者解锁「全知当前态 + 完整公告历史」（公告历史＝log 本就按投递侧过滤累积），
   *     但**仍不含 replay**；且视图构建是纯函数、不改对局状态（判定基数不变）。
   * ============================================================= */

  /** 出局者视角（G6）：出局且对局未结束 —— 解锁全知当前态 */
  function isOmniscient(g, v) { return !!(v && v.out && g && !g.over); }

  /** 全知当前态的单人投影：只含「现在是什么」与当前资源，**不含**历史与他人的私有节点 */
  function currentState(p) {
    return {
      faction: p.faction, role: p.role, roleName: p.roleName, out: !!p.out, outNight: p.outNight || null,
      dying: !!p.dying, infection: p.infection ? { real: p.infection.real, deathNight: p.infection.deathNight } : null,
      shield: p.shield, bullets: p.bullets, nightImmune: p.nightImmune, awakened: !!p.awakened,
      healLeft: p.healLeft, selfSaveLeft: p.selfSaveLeft, rescueLeft: p.rescueLeft, cureLeft: p.cureLeft,
      repairTotal: p.repairTotal, extraRepair: p.extraRepair, repairExposed: !!p.repairExposed,
      meetingLeft: p.meetingLeft, silenceNight: p.silenceNight, suppressLeft: p.suppressLeft,
      antibodyNight: p.antibodyNight, repairValue: p.repairValue,
      alien: p.alien ? { dir: p.alien.dir, kills: p.alien.kills, destroyTotal: p.alien.destroyTotal } : null,
    };
  }

  function sanitize(g, p, v) {
    const self = p.id === v.id;
    const god = !!g.dev;                                        // 开发者视角：上帝视角
    const omni = isOmniscient(g, v);                            // G6：出局者视角
    const isDoc = RD.hasGrant(v.role, 'treat');                 // D6：能力标签（医生系）
    const isRescuer = RD.hasGrant(v.role, 'save');              // D6：能力标签（救援族）
    const team = v.faction === 'alien' && p.faction === 'alien';

    const o = {
      id: p.id, name: p.name,
      /* 真人席位标记：非规则信息，仅供 UI 决定「自动讯问」按钮等交互是否可用 */
      isHuman: !!p.isHuman,
      out: p.out, outType: p.outType, cause: p.cause, outNight: p.outNight,
      revealed: p.revealed || null,
      repairExposed: !!p.repairExposed, destroyedExposed: !!p.destroyedExposed,
      /* 〔42〕transferred 不再下发：转职依 2.8.7 一律不公开（批次〇也不随转职更新，2.3.0⑤），
         谁转过职、转到哪，一律不得进入他人视图。此前 ui.js 的两处显示都在 god 分支内、
         读的是本地权威状态，故移除下发不影响 DEV 与己身面板。 */
      claimedRole: p.claimedRole || null,
      accusers: (p.accuseHistory || []).map(a => a.id),   // 公开发言中的指控，全体可知
    };

    if (self || team || god || omni) { o.faction = p.faction; o.role = p.role; o.roleName = p.roleName; }
    if (p.revealed) {
      /* B5：非 faction 路径的揭示无阵营字段（2.8.12④），不下发 null/undefined 阵营 */
      if (p.revealed.faction != null && o.faction == null) o.faction = p.revealed.faction;
      if (p.revealed.role && o.role == null) { o.role = p.revealed.role; o.roleName = D.ROLES[o.role].name; }
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
      /* G6：出局者视角对**他人**也只下发「全知当前态」（身份 + 当前资源），仍不下发其私有节点与历史 */
      if (omni) o.omniscient = currentState(p);
    }
    return o;
  }

  function build(g, pid) {
    const v = g.players[pid - 1];
    if (!v) return null;
    const isDoc = RD.hasGrant(v.role, 'treat');                    // D6：能力标签（医生系）

    /* v21 改动 #11：可见性过滤收敛到投递侧唯一实现 infer/visible.js（SKVisible.canSee） */
    const log = g.log.filter(e => global.SKVisible.canSee(v, e));

    const votes = {};
    if (v.role === 'inspector' || g.dev) { if (g.voteSources) Object.assign(votes, g.voteSources); }
    else if (v.faction === 'alien' && g.voteSources) {
      for (const p of g.players) if (p.faction === 'alien') votes[p.id] = g.voteSources[p.id];
    }

    return {
      view: true, humanId: pid,
      /* G6：出局者视角标识（UI 可据此标注「全知当前态（不含历史）」；挂机接管不显示标识） */
      omniscient: isOmniscient(g, v) || undefined,
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

  /* ---------- K3 契约：replay 的唯一发放口 + 视图审计 ---------- */

  /* 〔42〕单机路径的可见性收口（2026-10-06）
     背景：此前单机模式的 UI 直接读权威状态 g（见 ui.js render/ renderRoster），完全不经过
     sanitize —— 于是「濒死 / 感染标记（含真伪）/ 蛰伏沉默」这些只有医生系、救援族与异形队友
     可见的信息（3.3.12 / 4.5 / 4.10.4④ / 6.1.2）在单机界面全量可见。联机侧一直是干净的
     （本文件的 sanitize 就是为它写的），单机是个漏口。
     修法不是「在 UI 补几把锁」，而是让单机也走同一条出口：UI 一律渲染 viewFor() 的结果。
     viewFor 对已经是视图的载荷（联机 hydrate 后的对象）原样返回，故本函数是幂等的收口点，
     也让 auditView() 对单机与联机同时生效。 */
  function viewFor(g, pid) {
    if (!g) return null;
    if (g.view) return g;                 // 已是视图载荷（联机）——不再二次裁剪
    return hydrate(build(g, pid != null ? pid : g.humanId));
  }

  /** 完整回放的**唯一**发放口：仅终局后（2.6.3）；对局进行中返回 null。
      调用点（server 的 end 消息 / main 的 endData）一律经此，不得直接读 g.replay。 */
  function replayOf(g) {
    return (g && g.over) ? (g.replay || []) : null;
  }

  /** 视图审计（B3/B4/G6 契约）：返回违规清单（空数组＝合规）。
      可被回归断言直接调用，也可在联机侧作为「下发前自检」使用。 */
  function auditView(view) {
    const bad = [];
    if (!view) return ['空视图'];
    /* B3：任何视图都不含 replay（隐藏历史） */
    if (Object.prototype.hasOwnProperty.call(view, 'replay')) bad.push('视图含 replay（违 B3）');
    /* B3：可见日志里不得出现上帝作用域条目 */
    for (const e of (view.log || [])) if (e.scope === 'god') bad.push('视图 log 含 scope=god 条目（违 B3）');
    /* B4：私有节点只对持有者出现 */
    const me = view.humanId;
    for (const p of (view.players || [])) {
      if (p.id === me) continue;
      /* 〔42〕空容器不算违规：hydrate 会给每个玩家补 known=new Map() 以便 UI 直接调用 .get()，
         空 Map 不携带任何信息，B4 要禁的是「有内容的他人私有节点」。此前 auditView 只在
         JSON 载荷（hydrate 之前）上跑，故未暴露这条误报；现在单机也经 viewFor → hydrate，
         断言会恒报 14 条噪声。 */
      for (const f of ['inbox', 'known', 'checkPool', 'crewChecks', 'notes']) {
        if (!Object.prototype.hasOwnProperty.call(p, f)) continue;
        const v = p[f];
        const empty = v == null || (typeof v.size === 'number' && v.size === 0) ||
                      (Array.isArray(v) && !v.length) || v === '';
        if (!empty) bad.push(`${p.id} 号出现他人的私有节点 ${f}（违 B4）`);
      }
    }
    /* B4：他人现成状态的投影不得含历史字段 */
    for (const p of (view.players || [])) {
      if (p.id === me || !p.omniscient) continue;
      for (const f of ['known', 'inbox', 'notes', 'checkPool'])
        if (Object.prototype.hasOwnProperty.call(p.omniscient, f)) bad.push(`全知当前态含历史字段 ${f}（违 G6/B4）`);
    }
    /* G6：非出局者不得拿到全知标识 */
    if (view.omniscient && me != null) {
      const self = (view.players || []).find(p => p.id === me);
      if (self && !self.out) bad.push('未出局者却带全知标识（违 G6）');
    }
    /* 〔42〕隐藏态字段守卫（2.8.7 默认不公开 + 各自专门条款）：
       下列字段只对「本人 / 医生系 / 救援族 / 异形队友 / 全知视角」可出现，
       出现在任何其他玩家的视图里即为越界。此前单机 UI 直读权威状态，此类越界根本不会被
       任何断言看见 —— 现在单机也经 viewFor，本守卫对单机与联机同时生效。 */
    const self2 = (view.players || []).find(p => p.id === me);
    if (self2) {
      const viewerRole = self2.role, viewerFac = self2.faction;
      const isDoc = RD.hasGrant(viewerRole, 'treat');
      const isRescuer = RD.hasGrant(viewerRole, 'save');
      const omniHere = !!view.omniscient;
      for (const p of (view.players || [])) {
        if (p.id === me) continue;
        const team = viewerFac === 'alien' && p.faction === 'alien';
        /* 医生见感染存在性但真伪不可辨（4.5）；异形队友可辨真伪（3.3④）——故真值出现即越界 */
        if (p.infection && p.infection.real !== undefined && !(team && !isDoc))
          bad.push(`${p.id} 号的感染标记真伪外泄（违 2.8.7 / 4.5）`);
        if (p.dying === true && !(isRescuer || team || omniHere || view.dev))
          bad.push(`${p.id} 号的濒死状态外泄（违 3.3.12 / 4.10.4④）`);
        /* 蛰伏沉默只对施加者本人可见（6.1.2）；医生系也无此可见性 */
        if (p.silenceNight != null && !team)
          bad.push(`${p.id} 号的蛰伏沉默状态外泄（违 2.8.7 / 6.1.2）`);
        /* 转职一律不公开（2.8.7 / 2.3.0⑤）——包括「是否转职过」这个事实本身 */
        if (p.transferred !== undefined)
          bad.push(`${p.id} 号的转职状态外泄（违 2.8.7）`);
        /* 原职业底册同理 */
        if (p.originRole !== undefined)
          bad.push(`${p.id} 号的原职业底册外泄（违 2.8.12④）`);
      }
    }
    return bad;
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

  global.View = { build, hydrate, replayOf, auditView, isOmniscient, currentState, viewFor };
})(typeof window !== 'undefined' ? window : globalThis);
