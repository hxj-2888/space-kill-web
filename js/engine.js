/* 规则引擎：夜间步骤机 + 白天流程 + 结算与胜负判定 */
(function (global) {
  const D = global.SKData;

  /* v24 规则 6.1：蛰伏分两步——①查验 → 结算并给出结果 → ②可选沉默（看到结果后再行使）。
     故步序拆出 '1b'（沉默窗口），否则「选目标时同时勾选沉默」违反规则时序。 */
  const NORMAL  = ['0a','0b','0c','0.5','0.55','0.6','0.7','1','1b','2','2b','3','4a','4b','5','6','7','8','9','10','11'];
  const EXTINCT = ['0.5','0.55','0.6','0.7','5','7','8','9'];   // 1.4：0.5/0.55 保留——寂灭期无医生，真标记必死
  const DUEL    = ['0.6','0.7','5','7','3','8','9','11'];       // 决斗仅取消白天流程；步骤 3 保留（4.8 连续保护无豁免）

  const STEP_NAME = {
    '0a':'私聊·发起邀请','0b':'私聊·处理邀请','0c':'私聊·正文',
    '0.5':'感染抑制','0.55':'感染致死','0.6':'进化 / 转化 / 转职','0.7':'行动预提交',
    '1':'外星人查验','1b':'外星人沉默','2':'查验','2b':'巡逻','3':'保镖保护','4a':'维修','4b':'破坏',
    '5':'外星人行动','6':'开枪','7':'异形行动','8':'医生','9':'死亡结算','10':'紧急会议','11':'倒计时结算',
    'M-talk':'会议讨论','M-vote':'会议投票','M-speech':'验票官专属发言','D-will':'遗言','D-talk':'自由讨论','D-vote':'投票','D-clean':'昼末清洗',
    'D-open':'开局公开讨论',
  };

  /* ============ 基础工具 ============ */
  const alive  = g => g.players.filter(p => !p.out);
  const aliveF = (g, f) => alive(g).filter(p => p.faction === f);
  const P      = (g, id) => g.players.find(p => p.id === id);
  const canAct = (g, p) => !p.out && !p.dying && p.silenceNight !== g.night && !p.noActive;

  /* ============ 投递原语：已解耦至 js/engine/announce.js ============
     公开/私有分叉的唯一收口点；本文件内调用点与 Engine.* 导出面零改动。 */
  const ANN = global.EngineAnnounce;
  const log = ANN.log, announce = ANN.announce, priv = ANN.priv, god = ANN.god;
  const revealPublic = ANN.revealPublic, applyThreat = ANN.applyThreat, banner = ANN.banner;

  /* ============ 伤害 / 感染 ============ */
  function applyLethal(g, t, type, attacker) {
    /* 保镖受袭感知：被保护者被指定为攻击目标并结算即触发（含对濒死目标的无效攻击） */
    if (t && t.guard && t.guardedBy) {
      const bg = P(g, t.guardedBy);
      if (bg && !bg.out) {
        priv(g, bg, `受袭感知：你保护的对象遭到攻击，伤害类型为「${D.CAUSE_NAME[type]}」。`);
        /* v32 批 5′（角色注意力 / 私有源流水）：R04「受袭感知：伤害类型三分」此前只有 priv() 文本
           （交接文档 §3 点名的两条缺落盘之一）。以单人私有流水入账（own:bodyguard:hit，delta=0 占位，
           量级留 7′），伤害类型进 src 供后续通道判据读取。 */
        if (global.MoE && global.MoE.absorbPrivate)
          global.MoE.absorbPrivate(g, bg.id, t.id, `own:bodyguard:hit:${g.night}:${type}`, 'fact');
      }
    }

    let res = 'wasted';
    let immuneUsed = false;
    if (t && !t.out && !t.dying) {
      /* 4.4⑤：记录「当夜对该目标出过枪击的攻击方」——悬赏与死因归属解耦，各自独立触发 */
      if (type === 'gun' && attacker && attacker.id !== t.id) {
        (t.gunAttackers = t.gunAttackers || []).push(attacker.id);
      }
      res = 'hit';
      if (t.role === 'engineer' && g.night === 1) res = 'blocked';           // 第 1 夜全能免疫
      else if (t.guard) { t.guard = false; res = 'blocked'; }
      else if (t.patrol) { t.patrol = false; res = 'blocked'; }
      else if (t.shield > 0) { t.shield -= 1; res = 'blocked'; }
      else if (t.faction === 'xeno') {
        if (t.immuneActiveNight === g.night) res = 'blocked';
        else if (t.nightImmune > 0) {
          t.nightImmune -= 1; t.immuneActiveNight = g.night; res = 'blocked'; immuneUsed = true;
        }
      }

      if (res === 'hit') {
        t.dying = true; t.dyingCause = type; t.killedBy = attacker ? attacker.id : null;
        /* v24 规则修正：沉默是【蛰伏专属】（6.1），已移到步骤 1b——
           此前挂在「已觉醒外星人双刀命中附带」（注释称 6.2⑤），但 6.2 只讲刀数与时点，
           全文无沉默；规则与实现正好挂反，现已按 6.1 归位。 */

      }
    }
    /* 4.10⑥/7.2.2：每次出手即时反馈——对濒死/出局目标 = 无效；额度照扣、不得改选 */
    if (attacker && !attacker.out) {
      priv(g, attacker, res === 'hit' ? '你的攻击生效。' : '你的攻击无效。');
      /* v26：攻击反馈【结构化】落盘（私有源，只写攻击方本人）——
         总表 N302~N307 族的唯一载体。此前只有 priv() 文本，AI 无从推理
         「连续两夜攻击同一目标均无效 ⇒ 目标持结茧护盾 ⇒ 异形」（N306 ★★★）。 */
      (attacker.attackLog = attacker.attackLog || []).push({ night: g.night, target: t ? t.id : null, type, res });
    }
    /* 7.2.4：夜晚免疫消耗即时告知本人——只报已消耗/路径/剩余，不含任何来源 */
    if (immuneUsed && t) {
      priv(g, t, `夜晚免疫消耗：已消耗 1 次（伤害侧），剩余 ${t.nightImmune} 次。`);
    }
    god(g, `${attacker ? attacker.id + ' 号' : '系统'} → ${t.id} 号：${D.CAUSE_NAME[type] || type}，` +
          `${res === 'hit' ? '命中（进入濒死）' : res === 'blocked' ? '被抵挡层拦下' : '目标已濒死/出局（无效）'}`);
    return res;
  }

  function applyInfection(g, t, infector) {
    if (!t || t.out) return 'none';
    if (t.role === 'engineer' && g.night === 1) return 'blocked';            // 全能免疫（全额）
    if (t.antibodyNight === g.night) {
      t.antibodyNight = null;
      const b = t.antibodyBy ? P(g, t.antibodyBy) : null;
      if (b && !b.out && b.role === 'bio') {
        priv(g, b, '你赋予的抗体生效了。');   // 不报来源/真假
        /* v31 批 3.5（N407 输入）：P15「抗体生效」结构化落盘（私有源，只写该生化医师本人）——
           此前只有 priv() 文本，AI 无从推理「我这夜确实被施加过一次感染」，
           于是总表自评的「全场唯一能识别 N360 欺诈感染的私有路径」在实现上是空的。
           注意层序：抗体在【效果免疫之前】结算 ⇒ 真假标记皆不会落地（4.5 明文，N407 note 已记录）。 */
        (b.antibodyFired = b.antibodyFired || []).push({ night: g.night, target: t.id });
        /* v32 批 5′：R05 抗体生效流水（单人私有，delta=0 占位） */
        if (global.MoE && global.MoE.absorbPrivate)
          global.MoE.absorbPrivate(g, b.id, t.id, `own:bio:antibody:${g.night}`, 'fact');
      }
      return 'blocked';
    }
    if (t.guard) { t.guard = false; return 'blocked'; }
    if (t.patrol) { t.patrol = false; return 'blocked'; }
    if (t.infection) return 'none';                                          // 标记天然互斥
    const fast = infector && infector.faction === 'alien' && infector.alien.dir === 'infect';
    let out;
    if (t.faction === 'alien') {                                             // 效果免疫 → 假标记
      t.infection = { real: false, appliedNight: g.night, deathNight: null };
      out = 'fake';
    } else {
      t.infection = { real: true, appliedNight: g.night, deathNight: g.night + (fast ? 1 : 2) };
      if (t.faction === 'xeno') t.cureSelf = Math.min(1, t.cureSelf + 1);
      priv(g, t, `你身上出现感染标记，将于第 ${t.infection.deathNight} 夜致死。`);
      out = 'real';
    }
    god(g, `${infector ? infector.id + ' 号' : '系统'}感染 ${t.id} 号 → ` +
          (out === 'real' ? `真标记，第 ${t.infection.deathNight} 夜致死` : '假标记（受体为异形）'));
    /* v32 批 5′：R09 标记清单流水（规则 3.3④：异形可见标记清单且可辨真伪）。
       流水只记「该目标当夜被施加标记」——真伪辨读走既有合法视野（x.infection 真值读），
       src 不携带真伪字段（AI 不读真相红线）；delta=0 占位，量级留 7′。 */
    if (out === 'real' || out === 'fake') {
      for (const a of g.players) {
        if (a.out || a.faction !== 'alien') continue;
        if (global.MoE && global.MoE.absorbPrivate)
          global.MoE.absorbPrivate(g, a.id, t.id, `own:alien:mark:${g.night}`, 'fact');
      }
    }
    return out;
  }

  /* 清除感染的唯一入口：外星人的感染治疗额度随感染消失而作废（6.5⑥） */
  function clearInfection(g, t) {
    t.infection = null;
    if (t.faction === 'xeno') t.cureSelf = 0;
  }

  /* ============ 转职 ============ */
  function doTransfer(g, p, dir) {
    p.transferred = true;
    p.role = dir; p.roleName = D.ROLES[dir].name;
    /* v32 批 5′（角色注意力）：转职 = 换眼睛 —— 挂载新角色专家、卸载原职业的（规则 120）。
       已入账的 p.tEvents 不删除（留记忆，规则 118）；技能层额度重置引擎已按规则 120 处理，
       本批只动「入账资格」（挂载），不碰技能层（交接文档 §1.3）。 */
    p.roleExpert = dir;
    if (dir === 'armed') {
      p.bullets = 1;
      (p.bulletLog = p.bulletLog || []).push({ night: g.night, delta: 1, src: '转职初始 1 发' });
      const sheriff = g.players.find(x => x.role === 'sheriff' && !x.out);
      if (sheriff) {
        p.known.set(sheriff.id, { faction: 'human', role: 'sheriff' });
        sheriff.known.set(p.id, { faction: 'human', role: 'armed' });
        priv(g, sheriff, `武装识别：${p.id} 号已成为武装船员。`);
        priv(g, p, `武装识别：警长是 ${sheriff.id} 号。`);
      }
    } else if (dir === 'assistant') {
      p.repairTotal = 0;
    } else if (dir === 'tempdoc') {
      p.rescueLeft = 1; p.cureLeft = 2;
    }
    log(g, `${p.id} 号完成转职 → ${p.roleName}`, 'info');
  }

  /* ============ 额度发放 ============ */
  function grants(g) {
    const n = g.night;
    for (const p of g.players) {
      if (p.out) continue;
      if (p.role === 'bio' && n <= 3) { p.healLeft += 1; priv(g, p, '你获得 1 次治疗额度。'); }
      if (p.role === 'rescue' && n <= 2) { p.rescueLeft += 1; priv(g, p, '你获得 1 次救援额度。'); }
      if (p.role === 'sheriff' && n === 5) {
        p.bullets += 1;
        (p.bulletLog = p.bulletLog || []).push({ night: g.night, delta: 1, src: '第 5 夜 +1' });
        priv(g, p, '第 5 夜：额外获得 1 发子弹。');
      }
      if (p.role === 'xeno' && n === 10) { p.nightImmune = Math.min(2, p.nightImmune + 1); priv(g, p, '第 10 夜：额外获得 1 次夜晚免疫。'); }
      if (p.bounty > 0) {
        p.bullets += p.bounty;
        (p.bulletLog = p.bulletLog || []).push({ night: g.night, delta: p.bounty, src: '悬赏（击杀敌方）' });
        priv(g, p, `悬赏：回复 ${p.bounty} 发子弹。`);
        p.bounty = 0;
      }
      if (p.brewDone) {
        if (p.brewDone === 'rescue') { p.rescueLeft += 1; priv(g, p, '制药产物到账：获得 1 次救援额度。'); }
        else { p.cureLeft += 2; priv(g, p, '制药产物到账：获得 2 次治疗额度。'); }
        p.brewDone = null;
      }
    }
    if (!g.lowPopGiven && alive(g).length <= 6) {
      g.lowPopGiven = true;
      const s = g.players.find(x => x.role === 'sheriff' && !x.out);
      if (s) {
        s.bullets += 1;
        (s.bulletLog = s.bulletLog || []).push({ night: g.night, delta: 1, src: '全场存活≤6 +1' });
        priv(g, s, '全场存活≤6：额外获得 1 发子弹。');
      }
    }
  }

  /* ============ 阶段切换 ============ */
  function nextNight(g) {
    g.night += 1;
    g.day = g.day || 0;
    g.phase = 'night';
    g.step = null;
    g.sub = null;
    g.suppressCount = 0; g.cureHands = 0;
    g.checkCount = 0; g.patrolCount = 0;
    g.stopNight = g.pendingStop; g.pendingStop = false;
    g.skipCountdown = false;
    g.lastAliveCount = alive(g).length;
    for (const p of g.players) {
      p.guard = false; p.patrol = false; p.noActive = false; p.guardedBy = null;
      p.killedBy = null; p.repairedTonight = 0; p.branch = null; p.gunAttackers = null; p.sabAmount = null;
      p.patroledTonight = false; p.repairValue = null;

      /* 转化：新方向于次夜生效；次夜步骤 0.6 前死亡 → 回滚（不公告、不计次数，5.5） */
      if (p.alien && p.alien.pendingDir) {
        if (p.out) { p.alien.converts -= 1; g.pendingEvolve = Math.max(0, (g.pendingEvolve || 0) - 1); }
        else {
          p.alien.dir = p.alien.pendingDir;
          if (p.alien.dir !== 'kill') p.alien.extraKill = 0;   // 离开击杀方向：额外出刀作废（5.4）
          priv(g, p, `转化完成，当前方向：${{ destroy: '破坏', infect: '感染', kill: '击杀' }[p.alien.dir]}。`);
        }
        p.alien.pendingDir = null;
      }
      /* 击杀进化：额外出刀自进化后的下一个夜晚起可用（5.4） */
      if (p.alien && p.alien.dir === 'kill' && p.alien.evoNight === g.night - 1 && !p.alien.extraGiven) {
        p.alien.extraKill = 1; p.alien.extraGiven = true;
      }
    }
    grants(g);
    g.nightOrder = g.rng.shuffle(g.players.map(p => p.id));   // 每夜独立随机结算顺序（2.1，与编号解耦）
    g.queue = g.extinction ? EXTINCT.slice()
            : g.duel ? DUEL.slice()
            : NORMAL.slice();
    log(g, `—— 第 ${g.night} 夜开始 ——`, 'info');
  }

  /* 按「当夜结算顺序」遍历（决策并行、结算串行） */
  function orderedPlayers(g) {
    return (g.nightOrder || g.players.map(p => p.id)).map(id => P(g, id));
  }

  function startDay(g) {
    g.phase = 'day'; g.day += 1; g.step = null;
    g.queue = ['D-will', 'D-talk', 'D-vote', 'D-clean'];
    log(g, `—— 第 ${g.day} 个白天 ——`, 'info');
  }

  function nextPhase(g) {
    if (g.over) return;
    if (g.phase === 'open') { nextNight(g); return; }   // 开局讨论结束 → 第 1 夜
    if (g.phase === 'night') {
      if (g.extinction || g.duel) nextNight(g);
      else startDay(g);
    } else {
      nextNight(g);
    }
  }

  function updatePhases(g) {
    const al = alive(g);
    const h = al.filter(p => p.faction === 'human').length;
    const a = al.filter(p => p.faction === 'alien').length;
    const x = al.filter(p => p.faction === 'xeno').length;
    if (!g.extinction && h === 0 && a > 0 && x > 0) {
      g.extinction = true; g.queue.length = 0;
      for (const p of g.players) if (p.infection && !p.infection.real) p.infection = null;  // 假标记一并移除（1.4）
      banner(g, '人类全灭 → 进入【寂灭时刻】；倒计时胜利线已取消。');
      log(g, '人类全灭，进入寂灭时刻。', 'bad');
    }
    const factions = new Set(al.map(p => p.faction));
    if (!g.duel && al.length === 2 && factions.size === 2) {
      g.duel = true; g.queue.length = 0;
      banner(g, '存活仅剩 2 名敌对玩家 → 进入【决斗时刻】，白天流程取消。');
      log(g, '进入决斗时刻。', 'bad');
    }
  }

  function checkWin(g) {
    /* 1.2/1.5 判定顺序⓪：加时用满（第 999 夜）全局平局，优先级最高，先于①②③④ */
    if (g.night >= 999) return 'draw';
    const al = alive(g);
    const h = al.filter(p => p.faction === 'human').length;
    const a = al.filter(p => p.faction === 'alien').length;
    const x = al.filter(p => p.faction === 'xeno').length;
    if (a === 0 && x === 0) return 'human';
    if (h === 0 && x === 0) return 'alien';
    if (h === 0 && a === 0) return 'xeno';
    if (g.countdown <= 0 && h > 0 && !g.tiers[9] && !g.extinction) return 'human';
    return null;
  }

  function endGame(g, w) {
    g.over = true; g.winner = w; g.queue.length = 0; g.pending = null;
    const name = { human: '人类', alien: '异形', xeno: '外星人', draw: '平局' }[w];
    log(g, `对局结束：${name}${w === 'draw' ? '' : ' 获胜'}。`, w === 'draw' ? '' : 'good');
  }

  /* ============ 表单（玩家决策） ============ */
  function formPlayers(list, max, min, exclude, label) {
    return { list: list || 'aliveOthers', max: max, min: min || 0, exclude: exclude || [], label };
  }
  function toDecision(kind, d) {
    d = d || {};
    const t = d.targets || [];
    switch (kind) {
      case 'invite':    return { invite: t[0] != null ? t[0] : null };
      /* v25 遗留修复：此前缺 inviteAccept / chat 两个 case → 真人走到私聊步骤时
         toDecision 返回 {} → 0b 的 d.accept 与 0c 的 d.text 永远缺失 = 真人私聊 100% 失效 */
      case 'inviteAccept': return { accept: d.opt || 'none' };
      case 'chat':      return { text: d.text || '' };
      case 'suppress':  return { use: d.opt === 'yes' };
      case 'evolve':    return { dir: d.opt === 'none' ? null : d.opt };
      case 'convert':   return { do: d.opt !== 'none', dir: d.opt === 'none' ? null : d.opt };
      case 'transfer':  return { dir: d.opt === 'none' ? null : d.opt };
      case 'crewAction':return d.opt === 'check' ? { mode: 'check', target: t[0] }
                            : d.opt === 'repair' ? { mode: 'repair', value: d.num } : { mode: 'none' };
      case 'detective': return { mode: d.opt || 'none', target: t[0] };
      case 'patrol':    return { use: d.opt === 'yes', targets: t };
      case 'guard':     return { target: t[0] != null ? t[0] : null };
      case 'repair':    return { do: d.opt === 'repair' || d.opt === 'extra', extra: d.opt === 'extra' };
      case 'branch':    return { branch: d.opt, num: d.num };
      case 'xenoCheck': return { target: t[0] };
      case 'xenoSilence': return { silence: d.opt === 'yes' };   // v24：蛰伏沉默字段（真人通道此前缺）
      case 'xenoKill':  return { targets: t };
      case 'shoot':     return { targets: t };
      case 'alienAct':  return { act: d.opt || 'none', targets: t };
      case 'doctor':    return { act: d.opt || 'none', targets: t, product: d.num };
      case 'xenoCure':  return { use: d.opt === 'yes' };
      case 'meeting':   return { call: d.opt === 'yes' };
      case 'vote':      return { target: t[0] != null ? t[0] : null };
      case 'clean':     return { do: d.opt === 'yes' };
      case 'talk':      return { text: d.text || '' };
      case 'will':      return { text: d.text || '' };
      /* v32：验票官专属发言（M-speech）此前未登记 → 玩家提交专属发言时被旧 default 静默吞成
         {}（正文恒缺失）。探测器（default throw）在回归冒烟中当场炸出——正是它该抓的东西。 */
      case 'speech':    return { text: d.text || '' };
    }
    /* v32（isHuman 语义收窄 · 探测器）：default 从静默 `return {}` 改为立刻失败——
       上一处缺 case（inviteAccept/chat）曾让真人私聊 100% 静默失效，断言全绿、只能靠游玩撞见。
       新增步骤/决策类型时若漏登记 case，这里当场炸出来，而不是留一处新的静默歧视。 */
    throw new Error('toDecision: 未登记的决策类型 kind=' + kind + '（真人表单会被静默吞掉，必须显式登记）');
  }

  /* ============ 步骤定义 ============ */
  /* ============ 步骤定义表 STEPS：已解耦至 js/engine/steps.js（工厂注入）============
     1165 行 / 26 个步骤条目在 steps.js；本文件末尾用全部顶层作用域名注入工厂。
     STEPS 的对外导出与全部读取点（beginStep / finishStep / stepOnce / Engine.STEPS）零改动。 */
  let STEPS = null;

  /* ============ 投票结算 ============ */
  function resolveVote(g, isMeeting) {
    const voters = alive(g);
    g.voteSources = {};
    const counts = {};
    for (const v of voters) {
      const d = g.decisions[v.id];
      const t = d && d.target != null ? d.target : null;
      v.lastVote = t;
      g.voteSources[v.id] = t;
      if (t != null) counts[t] = (counts[t] || 0) + 1;
      god(g, `${v.id} 号 投给 ${t == null ? '（弃票）' : t + ' 号'}`);
    }
    const total = Object.keys(counts).reduce((a, k) => a + counts[k], 0);
    (g.voteHistory = g.voteHistory || []).push({ night: g.night, round: isMeeting ? '会议' : '白天', src: Object.assign({}, g.voteSources) });
    /* R64 投票声明对账第一段：宣称投 X 而 X 零票 → 必定撒谎 +25（得票数为⑨公开信息） */
    if (global.AI.onVoteSettle) global.AI.onVoteSettle(g, counts);

    let out = null;
    const keys = Object.keys(counts);
    /* ⑨ 公示：总票数 + 每名被投玩家的得票数（票数公开；票源仍仅验票官可见） */
    const detail = keys.slice().sort((a, b) => counts[b] - counts[a])
      .map(k => `${k} 号 ${counts[k]} 票`).join('、');
    const abstain = voters.length - total;
    announce(g, '⑨', `本轮投票总票数：${total}（弃票 ${abstain}）。得票：${detail || '无人得票'}`);
    if (keys.length) {
      const max = Math.max(...keys.map(k => counts[k]));
      const tops = keys.filter(k => counts[k] === max);
      if (tops.length === 1 && max >= 2) out = +tops[0];
    }
    if (out != null) {
      const p = P(g, out);
      p.out = true; p.outType = 'vote'; p.outNight = g.night;
      revealPublic(g, p, p.faction, p.role);
      announce(g, '⑩', `${p.id} 号被驱逐，${D.FACTION[p.faction].name}（职业：${p.roleName}）` +
                        (p.transferred ? '（原职业：普通船员）' : ''));
    } else {
      announce(g, '⑩', '本轮无人被驱逐（未满足最高票 / 无平票 / 至少 2 票）。');
    }
    const w = checkWin(g);
    if (w) endGame(g, w);
    return out;
  }

  /* ============ 实时讨论流 ============ */
  /* 每条公开发言在入库时即做 NLP 解析（sig 随条目存储）：
     UI 用它渲染「原意」小字翻译，AI 威胁度链用它做结构化反应 */
  function addTalk(g, id, text, kind, sig) {
    const s = sig || (global.NLP ? global.NLP.parse(text, { speaker: id }) : null);
    g.talks.push({ id, text });
    g.chatLog.push({ night: g.night, kind, id, text, sig: s });
  }

  /* 公开发言的唯一入口（玩家实时输入 / AI 流式发言共用）：
     内容处理全部交给结合层 Bridge —— 语言产出 Claim IR → 推理链 → 影响后续发言与投票行为。 */
  function talk(g, pid, text, accuseId, askId) {
    const p = P(g, pid);
    /* §8.1 验票官专属发言期间：其余玩家禁言 */
    if (g.step === 'M-speech' && (!p || p.role !== 'inspector')) return false;
    if (!p || p.out) return false;
    /* 只点质询、无正文：自动合成质询句 */
    if ((!text || !text.trim()) && askId && askId !== pid)
      text = '质询 ' + askId + ' 号：请解释一下你的身份和行动。';
    if (!text || !text.trim()) return false;
    const clean = text.trim();
    const kind = g.step === 'M-talk' ? '会议' : g.step === 'D-open' ? '开局' : '讨论';
    /* 下拉菜单的点名（指控 / 质询）并入 IR，与文本解析结果合并处理 */
    const extra = [];
    if (global.IR) {
      const base = { speaker: pid, night: g.night, step: g.step, channel: 'public' };
      if (accuseId && accuseId !== pid) extra.push(global.IR.mk('accuse', [accuseId], { tier: 'hard' }, base));
      if (askId && askId !== pid) extra.push(global.IR.mk('ask', [askId], {}, base));
    }
    if (global.Bridge) return global.Bridge.say(g, pid, clean, { kind, extra, markTarget: accuseId });
    addTalk(g, pid, clean, kind);                      // Bridge 缺失时的兜底
    return true;
  }

  /* 驱动按 elapsedMs 调用：让 AI 依排程逐条发言，返回本 tick 是否有新发言 */
  function streamPump(g, elapsedMs) {
    const s = g.stream;
    if (!s) return false;
    let said = false;
    while (s.idx < s.speakers.length) {
      const sp = s.speakers[s.idx];
      if (elapsedMs < sp.at) break;
      const p = P(g, sp.pid);
      if (p && !p.out && alive(g).length > 1) {
        const kind = g.step === 'M-talk' ? '会议' : '讨论';
        const text = global.AI.speak(g, p);            // speak 同时产出 p.outClaims（说话意图）
        if (global.Bridge) {
          /* AI 发言与玩家发言同管道：Claim IR → 推理链 → 后续行为 */
          global.Bridge.say(g, p.id, text, { kind, claims: p.outClaims, aiSource: true });
        } else {                                        // 兜底：旧的直连路径
          addTalk(g, p.id, text, kind);
          if (p.lastAccuse) { global.AI.onAccuse(g, p.id, [p.lastAccuse]); p.lastAccuse = null; }
          if (p.lastAsk != null) {
            const target = P(g, p.lastAsk);
            if (target && !target.out) global.AI.onAsk(g, p.id, [p.lastAsk]);
            if (target && !target.out && !target.isHuman) {
              const ans = global.AI.answerQuestion(g, target, p.id);
              addTalk(g, target.id, ans.text, kind);
              global.AI.evaluateAnswer(g, target, ans.quality);
            } else if (target && target.isHuman) {
              g.pendingAsk = { night: g.night, target: target.id, asker: p.id };
            }
            const key = p.id + ':' + p.lastAsk + ':' + g.night;
            g.askTally = g.askTally || {};
            g.askTally[key] = (g.askTally[key] || 0) + 1;
            p.lastAsk = null;
          }
        }
        global.AI.updatePublicThreat(g);
        said = true;
      }
      s.idx += 1;
    }
    return said;
  }

  /* ============ 驱动 ============ */
  function beginStep(g, step) {
    g.step = step;
    g.decisions = {};
    g.pendings = {};
    g.pending = null;
    g.stepSkipped = false;
    const def = STEPS[step];
    const hasReq = !!def.req;                        // 自动结算步（0.55/4b/9/11）无 req，必须照常执行
    const reqs = hasReq ? def.req(g) : [];
    /* 0.4「无决策权跳过」：本步定义了决策者但全员已出局/无权限（且非实时讨论步）→ 整步跳过，0 秒推进 */
    if (hasReq && reqs.length === 0 && !def.stream) {
      log(g, `步骤 ${step}（${STEP_NAME[step] || step}）无决策者，整步跳过。`, 'info');
      g.stepSkipped = true;
      return false;
    }
    const humSet = new Set(g.humans && g.humans.length ? g.humans : [g.humanId]);
    let tm = D.STEP_TIME[step] || {};
    /* B 类运营参数覆盖：会议次日讨论减半至 90 秒（§5.7）；决斗时刻行动决策 10 秒并行（§5.3.2） */
    if (step === 'D-talk' && g.talkHalved) tm = Object.assign({}, tm, { duration: 90 });
    if (g.duel && (step === '5' || step === '7')) tm = Object.assign({}, tm, { duration: 10 });
    for (const r of reqs) {
      if (humSet.has(r.pid) && (!P(g, r.pid).out || def.allowOut)) {
        const f = def.form(g, P(g, r.pid));
        f.kind = r.kind; f.pid = r.pid;
        f.duration = tm.duration || 0;
        f.auto = tm.auto || false;
        f.stream = !!def.stream;
        f.allowOut = !!def.allowOut;
        g.pendings[r.pid] = f;
      } else {
        g.decisions[r.pid] = global.AI.decide(g, r);
      }
    }
    /* AI「分散提交」模拟：用于提前跳秒与「决策中 N 人」显示（显示方案 0.4/1.1） */
    const aiN = Object.keys(g.decisions).length;
    g.aiTotal = aiN;
    g.aiSubmitAt = aiN ? (0.3 + g.rng.next() * 0.45) * (tm.duration || 30) * 1000 : 0;
    if (def.stream) {
      /* AI 发言排程：在窗口的前 3/4 时段内逐条出现（soloTalk = 专属发言，无 AI 发言） */
      const speakers = def.soloTalk ? [] : alive(g).filter(p => !humSet.has(p.id)).map(p => p.id);
      g.rng.shuffle(speakers);
      const win = (tm.duration || 60) * 1000;
      const n = speakers.length;
      g.stream = {
        idx: 0,
        speakers: speakers.map((pid, i) => ({ pid, at: ((i + 0.6) / (n + 0.9)) * win * 0.75 })),
      };
      g.talks = [];
      if (!Object.keys(g.pendings).length) streamPump(g, Infinity);   // 无人（观战）时一次性完成发言
    }
    if (step === 'D-talk') g.talkHalved = false;   // 减半只作用于会议次日这一次讨论
    const ids = Object.keys(g.pendings);
    if (ids.length) g.pending = g.pendings[ids[0]];   // 兼容单机（取首个待决策席位）
  }

  function finishStep(g) {
    const def = STEPS[g.step];
    if (def && def.run) def.run(g);
    g.stepDone = g.step;
  }

  function pendingCount(g) { return Object.keys(g.pendings || {}).length; }

  /* elapsedMs 内已"提交"决策的 AI 数量（决策中人数显示用） */
  function decisionProgress(g, elapsedMs) {
    const total = g.aiTotal || 0, at = g.aiSubmitAt || 0;
    const ready = !total || elapsedMs >= at ? total : Math.floor(total * elapsedMs / at);
    return { ready, total };
  }

  function stepOnce(g) {
    if (g.over || pendingCount(g)) return;
    if (!g.queue.length) {
      nextPhase(g);
      if (g.over || !g.queue.length) return;
    }
    const step = g.queue.shift();
    if (beginStep(g, step) === false) { g.stepDone = step; return; }   // 无决策者：整步跳过，不执行 run
    if (!pendingCount(g)) finishStep(g);
  }

  /* 记录某席位决策（不结算）；全员提交即跳秒 */
  function setDecisionFor(g, pid, data) {
    const f = g.pendings && g.pendings[pid];
    if (!f) return false;
    g.decisions[pid] = toDecision(f.kind, data);
    delete g.pendings[pid];
    if (pid === g.humanId) g.pending = null;
    return true;
  }

  function setDecision(g, data) {
    const ids = Object.keys(g.pendings || {});
    if (!ids.length) return false;
    return setDecisionFor(g, +ids[0], data);
  }

  function submit(g, data) {
    const ids = Object.keys(g.pendings || {});
    if (!ids.length) return;
    setDecisionFor(g, +ids[0], data);
    if (!pendingCount(g)) finishStep(g);
  }

  function finishIfReady(g) {
    if (!g.over && !pendingCount(g) && g.step) finishStep(g);
  }

  /* 开局公开讨论（2.3）：第 1 夜前全场唯一一次无投票讨论 */
  function begin(g) {
    g.phase = 'open';
    g.night = 0; g.day = 0;
    g.queue = ['D-open'];
    if (global.AI) global.AI.updatePublicThreat(g);   // 开局即有威胁度共识基准
    log(g, '—— 开局公开讨论（无投票、无公告，仅发言）——', 'info');
  }

  /* 依赖注入：把本文件的顶层作用域交给工厂，装配出 STEPS（顺序与拆分前一致） */
  STEPS = global.EngineSteps({
    D,
    NORMAL,
    EXTINCT,
    DUEL,
    STEP_NAME,
    alive,
    aliveF,
    P,
    canAct,
    ANN,
    log,
    announce,
    priv,
    god,
    revealPublic,
    applyThreat,
    banner,
    applyLethal,
    applyInfection,
    clearInfection,
    doTransfer,
    grants,
    nextNight,
    orderedPlayers,
    startDay,
    nextPhase,
    updatePhases,
    checkWin,
    endGame,
    formPlayers,
    toDecision,
    STEPS,
    resolveVote,
    addTalk,
    talk,
    streamPump,
    beginStep,
    finishStep,
    pendingCount,
    decisionProgress,
    stepOnce,
    setDecisionFor,
    setDecision,
    submit,
    finishIfReady,
    begin,
  });

  global.Engine = {
    STEP_NAME, NORMAL, EXTINCT, STEPS,
    begin, stepOnce, submit, setDecision, setDecisionFor, toDecision, pendingCount, finishIfReady,
    talk, streamPump, decisionProgress,
    alive, aliveF, P, canAct, checkWin, log, announce, priv, god,
  };
})(typeof window !== 'undefined' ? window : globalThis);
