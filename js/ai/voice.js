/* =============================================================
 * 太空杀 · 角色心声与发言层（Voice）
 *
 * 职责：让每个角色**按自己独有的情报面**产生「现在在想什么」，并把那个想法
 *       说成人话——而不是所有人共用一张模板池。
 *
 * 为什么需要它（实测依据，见 docs/v7_B0后对局侦察报告_20261008.md）：
 *   · B0 后各角色「见过的证据家族数」普降且趋同（detective 5.0→3.5、crew 5.5→4.0，
 *     仅 inspector 变宽），角色差异化在退化；
 *   · 发言层句子多样性仅 11.8~12.6%，最高频单句被重复 800~900 次；
 *   · 根因是 decide.speak 的取材与模板池**按 faction 而非按角色**分支，
 *     9 个人类角色共用同一批 pick(rng, [...]) 句子。
 *
 * 设计纪律：
 *   ① **声明层仍是唯一真源**。本文件按 roleDecl.DUTY_SENSE 的键组织，每个键一个
 *      「话题」（probe 取料 + line 成句），不新增任何角色知识。auditTopics() 强制
 *      「声明了的每个情报面都必须有话题实现」——防止声明与实现漂移（与 duty.mutex
 *      的交叉核对同一路数）。
 *   ② **只说自己有权知道的**。probe 只读该角色合法持有的数据（卡·可见性列即白名单），
 *      不读隐藏字段、不跨角色。
 *   ③ **明文代价进发言**（duty.cost）：卡里写明的代价（神探查验自我暴露、毒师容错为零、
 *      会议发动即暴露编号、嗅探不显示全额减免…）让该角色说话时会犹豫/留一手——
 *      这是「有想法」的一半；另一半是有料可说。
 *   ④ 取不到料就**返回 null**，由 speak 落回原有通用分支。不制造噪声。
 * ============================================================= */
(function (global) {
  const RD = global.SKRoleDecl;

  /* ---- 小工具：取存活 / 阵营 / 人数 ---- */
  const alive = g => g.players.filter(p => !p.out);
  const others = (g, p) => alive(g).filter(x => x.id !== p.id);
  const roster = (ids) => {
    const a = ids.filter(i => i != null);
    if (!a.length) return '';
    if (a.length === 1) return a[0] + ' 号';
    return a[0] + ' 号和 ' + a.slice(1).join('、') + ' 号';
  };
  /* 说话前的自检：本席是否处于禁言（沉默/感染抑制）。被封锁者本就无主动发言。 */
  const muted = (g, p) => p.silenceNight === g.night || p.noActive;

  /* ---- 私信箱读取器 ----
     卡上「仅本人可见」的那几类情报（受袭感知 / 协助维修人数 / 致死来源清单 / 嗅探结果 /
     蛰伏查验）在引擎里的唯一载体是 priv() 文本：priv() 把 {night, step, text} 压进 p.inbox
     （engine/announce.js priv 定义）。B0 拆除后 MoE.absorbPrivate 已归档（own:* 归零），
     所以这些情报**只剩 p.inbox 一个落点**——voice 只能从那里取。
     ⚠ 这是本轮的第二处「卡载而实现落点薄弱」的证据，已登记为待补（见报告 §遗留）。 */
  const inbox = (g, p, re) => {
    if (!p || !p.inbox) return [];
    return p.inbox.filter(m => m && m.night === g.night && re.test(String(m.text || '')));
  };

  /* =============================================================
   * 话题表：键＝roleDecl.DUTY_SENSE 的键（声明层唯一真源）
   *   probe(g,p) → 素材对象或 null（null＝此刻无料可讲）
   *   line(g,p,m) → 一句话（自述视角，第一人称，可含编号）
   *   用于「自述」型发言；被指认/对质场景仍走原通用分支。
   * ============================================================= */
  const SENSE_TOPIC = {
    /* —— 船员：自己的查验记录 ——————————————————————————————— */
    selfClaimLog: {
      /* defer：decide.speak 已有 crew 专有分支会报 crewChecks 并写 lock claim。
         若 voice 也抢这个话题，会顶掉那条分支 ⇒ 既发言，又丢证据。故让位。 */
      defer: true,
      probe(g, p) {
        if (!p.checkPool || typeof p.checkPool.entries !== 'function') return null;
        const list = [...p.checkPool.entries()]
          .filter(([, v]) => v && (v.role || v.answer === true))
          .map(([id, v]) => ({ id, role: v.role, ok: v.answer }));
        return list.length ? { list } : null;
      },
      line(g, p, m) {
        const hit = m.list.find(x => x.ok);
        if (hit) return `我这儿的查验记录摆着：${hit.id} 号是${global.SKData.ROLES[hit.role] ? global.SKData.ROLES[hit.role].name : '某个职业'}，我照实说。`;
        const n = m.list.length;
        return `查了 ${n} 个人，${roster(m.list.map(x => x.id))}，都不是我池子里的职业——我照实答「否」。`;
      },
    },
    repairAssistN: {
      /* 载体：priv() 文本「本夜共有 N 名普通船员协助维修。」（steps.js:1039）
         ——卡载「当夜协助维修者可见人数 N（不附编号）」。此前读 p._repairN，
         该字段引擎从未写入（0 命中）⇒ 话题永不触发。 */
      probe(g, p) {
        const m = inbox(g, p, /有\s*(\d+)\s*名普通船员协助维修/);
        if (!m.length) return null;
        const n = +((String(m[m.length - 1].text).match(/(\d+)\s*名/) || [])[1]);
        return n ? { n } : null;
      },
      line(g, p, m) { return `昨晚有 ${m.n} 个人跟我一起搭了把手——人数我有感觉，编号我没有。`; },
    },

    /* —— 工程师：自己的维修账与暴露线 ——————————————————————— */
    ownRepairTotal: {
      probe(g, p) { return (p.repairTotal != null) ? { v: +p.repairTotal.toFixed(1) } : null; },
      line(g, p, m) { return `我自己修了 ${m.v}，账我清楚，别拿维修多少来编排我。`; },
    },
    ownExposeRemain: {
      probe(g, p) {
        const at = RD.repairExposeAtOf(p.role);
        if (at == null || p.repairTotal == null) return null;
        const left = +(at - p.repairTotal).toFixed(1);
        if (left <= 0) return null;
        return { left, at, total: +p.repairTotal.toFixed(1) };
      },
      line(g, p, m) {
        return m.left <= 0.6
          ? `我离暴露就差 ${m.left} 了——这活儿再往下修我就得被点名。`
          : `离暴露还有 ${m.left}，够用。`;
      },
    },

    /* —— 警长 / 猎手 / 武装：子弹与身份识别 ——————————————— */
    ownAmmo: {
      probe(g, p) {
        /* 〔D6〕持枪者一律走能力标签 'shoot'（警长／猎手／武装船员均已声明），
           不手写角色数组——D6 lint 禁止族判定链，且手写会随加角色漏改。 */
        if (!RD.hasGrant(p.role, 'shoot')) return null;
        /* 是否受 2 发存储上限约束：猎手〔通则 4.4.6 之例外〕不受限。
           用猎手专属标签 'sniff' 区分，而不是再手写一个角色键。 */
        const uncapped = RD.hasGrant(p.role, 'sniff');
        return { n: p.bullets, max: uncapped ? Infinity : 2 };
      },
      line(g, p, m) {
        if (m.max === Infinity) return `我手里 ${m.n} 发，不受两发上限管——但我得留神，别一口气打空。`;
        return m.n <= 0 ? `我一发都没有了，这一轮我只能看着。`
          : `我还有 ${m.n} 发，打谁我心里有数。`;
      },
    },
    armedCrewIds: {
      probe(g, p) {
        /* 〔D6〕任何持枪者（grant 'shoot'）都能看见其他持枪者——
           卡·武装船员「与警长双向识别」。用标签表达「同为持枪」而非角色数组。 */
        if (!RD.hasGrant(p.role, 'shoot')) return null;
        const ids = alive(g).filter(x => x.id !== p.id && RD.hasGrant(x.role, 'shoot')).map(x => x.id);
        return ids.length ? { ids } : null;
      },
      line(g, p, m) { return `${roster(m.ids)} 是武装，跟我一样带枪——我开枪前先排掉自己人。`; },
    },
    sniffResult: {
      /* 载体：p.sniffLog = [{night, id, guarded}]（steps.js:552）。
         卡：「查目标是否呈现保护状态 … 不区分何种保护、不报层数与来源」。 */
      probe(g, p) {
        if (p.role !== 'hunter' || !p.sniffLog || !p.sniffLog.length) return null;
        const tonight = p.sniffLog.filter(x => x && x.night === g.night);
        const rows = tonight.length ? tonight : p.sniffLog.slice(-2);
        const list = rows.filter(x => x && x.guarded).map(x => x.id);
        const bare = rows.filter(x => x && !x.guarded).map(x => x.id);
        return (list.length || bare.length) ? { list, bare, night: rows[0] && rows[0].night } : null;
      },
      line(g, p, m) {
        const parts = [];
        if (m.list.length) parts.push(`${roster(m.list)} 身上有保护`);
        if (m.bare.length) parts.push(`${roster(m.bare)} 看着没保护`);
        return parts.length ? `我嗅过：${parts.join('；')}。` : null;
      },
    },

    /* —— 医生族：感染标记 / 濒死 / 抗体 ——————————————————————— */
    infectMarks: {
      probe(g, p) {
        if (!RD.hasGrant(p.role, 'treat')) return null;
        const ids = alive(g).filter(x => x.infection).map(x => x.id);
        return ids.length ? { ids } : null;
      },
      line(g, p, m) {
        return `${roster(m.ids)} 身上带感染标记。我只能说有标记，标记是真是假我不清楚。`;
      },
    },
    antibodyFeedback: {
      probe(g, p) {
        if (!RD.hasGrant(p.role, 'treat')) return null;
        if (p.role === 'xeno') return p.antibodyNight ? { n: p.antibodyNight } : null;
        const fired = (p.antibodyFired || []).filter(x => x && !x.used);
        return fired.length ? { n: fired.length } : null;
      },
      line(g, p, m) {
        return p.role === 'xeno'
          ? `我自己清掉了感染，顺手拿了抗体——不多，就一次。`
          : `我给的抗体生效了，别问我给的谁。`;
      },
    },
    dyingList: {
      /* 〔卡载但本层无消费者——显式登记，不留静默死话题〕
         dyingList 不是引擎缺载体：p.dying 夜间真实有效（置真 steps.js:273/288、
         engine.js:148；救援或死亡后清 steps.js:1365/1404/1418/1475）。
         问题是**信息窗与消费窗不重叠**——濒死只存在于夜间，而发言在白天讨论会，
         那时濒死者要么已被救、要么已出局。实测 probeAll 探测 744 次、有素材 0 次。
         要让它有用，需把「谁正在濒死」记进跨夜留存（像 markEverSeen 那样的档案）；
         那是引擎补充项，超出本批「不改既有行为」的授权，故登记待办而非硬凑实现。 */
      notApplicable: {
        carrierAlive: true,
        reason: '信息窗（夜间）与消费窗（白天讨论会）不重叠',
        needs: '把濒死名单做跨夜留存，否则无从说起；属引擎补充项，待办',
      },
      probe(g, p) {
        /* 〔D6〕救援族一律走 grant 'save'，不手写角色数组 */
        if (!RD.hasGrant(p.role, 'save')) return null;
        const ids = alive(g).filter(x => x.dying).map(x => x.id);
        return ids.length ? { ids } : null;
      },
      line(g, p, m) { return `${roster(m.ids)} 濒死了。这条我不说，全场就没人说得出来。`; },
    },
    deathSourceAfterSave: {
      /* 载体：priv() 文本「N 号落身致死来源：…」（steps.js:1401，条件是实际消耗了救援额度）
         ——与卡「落身致死来源清单仅在实际执行救援、消耗救援额度后才可见」逐字对应。 */
      probe(g, p) {
        const m = inbox(g, p, /号落身致死来源/);
        if (!m.length) return null;
        const ids = m.map(x => +((String(x.text).match(/^\s*(\d+)\s*号/) || [])[1])).filter(Boolean);
        return ids.length ? { ids } : null;
      },
      line(g, p, m) {
        return `救过之后才看得见致死来源：${roster(m.ids)}。这信息是我出手换来的。`;
      },
    },

    /* —— 毒师：毒药清单与自身标记 ——————————————————————— */
    poisonList: {
      probe(g, p) {
        if (p.role !== 'poisoner') return null;
        const ids = alive(g).filter(x => x.poison).map(x => x.id);
        return { ids, left: p.poisonLeft, anti: p.antidoteLeft };
      },
      line(g, p, m) {
        const who = m.ids.length ? `眼下带毒的是 ${roster(m.ids)}。` : '眼下没人带毒。';
        return `${who} 我手上毒药 ${m.left} 份、解药 ${m.anti} 份——用错一次就没得救。`;
      },
    },
    selfPoisoned: {
      probe(g, p) { return p.poison ? { id: p.id } : null; },
      line(g, p, m) { return `我自己身上带毒——这事我不能替我瞒着，但我也不能说是我下的。`; },
    },

    /* —— 神探：查验池与「只报呈现职业」 ————————————————————— */
    checkPool: {
      /* defer：decide.speak 已有 detective 专有分支会按 claimRate 报查验并写 lock claim；
         同 selfClaimLog，顶掉它会丢证据。故让位，只保留 presentedRoleOnly 这个新话题。 */
      defer: true,
      probe(g, p) {
        if (p.role !== 'detective') return null;
        if (!p.checkPool || typeof p.checkPool.entries !== 'function') return null;
        const list = [...p.checkPool.entries()]
          .filter(([, v]) => v && v.role)
          .map(([id, v]) => ({ id, role: v.role }));
        return list.length ? { list } : null;
      },
      line(g, p, m) {
        const a = m.list[0], b = m.list[1];
        const nm = r => (global.SKData.ROLES[r] ? global.SKData.ROLES[r].name : '某职业');
        return b
          ? `我查过 ${roster(m.list.map(x => x.id))}——呈现职业分别是${nm(a.role)}和${nm(b.role)}。我只报职业，不报阵营。`
          : `我查过 ${a.id} 号，呈现职业是${nm(a.role)}。`;
      },
    },
    presentedRoleOnly: {
      probe(g, p) {
        if (p.role !== 'detective') return null;
        const n = p.checkPool && typeof p.checkPool.size === 'number' ? p.checkPool.size : 0;
        return n >= 2 ? { n } : null;
      },
      line(g, p, m) {
        return `池子里有 ${m.n} 条了。提醒一句：呈现职业未必是他本来的身份——变形的人照样能报出职业。`;
      },
    },

    /* —— 保镖：受袭感知与自我知情 ——————————————————————— */
    guardFeedback: {
      /* 载体：priv() 文本（engine.js:98「受袭感知：你保护的对象遭到攻击，伤害类型为「X」」）
         ——卡·保镖核心「受袭感知——被保护时获知伤害类型」。
         ⚠ 该 priv 送达的是**保护者**，故本话题只对 bodyguard 有效。 */
      probe(g, p) {
        if (p.role !== 'bodyguard') return null;
        const m = inbox(g, p, /受袭感知|你保护的对象遭到攻击/);
        return m.length ? { night: g.night, text: String(m[m.length - 1].text) } : null;
      },
      line(g, p, m) { return `我这夜护的人挨了一下——这条我比谁都先知道。`; },
    },
    attackTypeOnGuard: {
      probe(g, p) {
        if (p.role !== 'bodyguard') return null;
        const m = inbox(g, p, /伤害类型为「(.+?)」/);
        if (!m.length) return null;
        const t = (String(m[m.length - 1].text).match(/伤害类型为「(.+?)」/) || [])[1];
        return t ? { type: t } : null;
      },
      line(g, p, m) { return `我这夜挨的那一下是${m.type}——凶手编号我不报，报了也没用。`; },
    },

    /* —— 工匠：护甲库存 ——————————————————————————————— */
    ownArmorStock: {
      probe(g, p) {
        if (p.role !== 'artisan') return null;
        return { stock: p.armorStock == null ? 0 : p.armorStock, shield: p.shield || 0 };
      },
      line(g, p, m) {
        return `我库存里还有 ${m.stock} 件护甲。谁需要我给一件，说一声——但我不会说我给了谁。`;
      },
    },

    /* —— 验票官 / 窃听者：票源与私聊 ————————————————————— */
    allVoteSources: {
      probe(g, p) {
        if (p.role !== 'inspector') return null;
        const rec = (g.voteHistory || [])[g.voteHistory.length - 1];
        if (!rec || !rec.src) return null;
        const ids = [...new Set(Object.values(rec.src).filter(v => v != null))];
        return ids.length >= 2 ? { ids, n: Object.keys(rec.src).length } : null;
      },
      line(g, p, m) {
        return `票源我看得见：${m.n} 个人投的，最集中在 ${roster(m.ids)}。谁投的谁——我看得一清二楚。`;
      },
    },
    allBallotCounts: {
      probe(g, p) {
        if (p.role !== 'inspector') return null;
        const rec = (g.voteHistory || [])[g.voteHistory.length - 1];
        if (!rec || !rec.src) return null;
        return { n: Object.keys(rec.src).length };
      },
      line(g, p, m) {
        return `票型图我公开过了：${m.n} 张票的来源已经记档，谁也别想改。`;
      },
    },
    pairedPrivateChats: {
      probe(g, p) {
        if (p.role !== 'listener') return null;
        const g2 = g._wiretapToday;
        return (g2 && g2.length) ? { lines: g2 } : null;
      },
      line(g, p, m) {
        const t = (m.lines[0] || '').replace(/\s+/g, ' ').slice(0, 18);
        return t ? `我昨晚读到一段私聊，开头是「${t}…」——细节我不保证保真。` : `我读到东西了，但我不能说保真。`;
      },
    },

    /* —— 非人类：队友与票型 ———————————————————————————
       ⚠ 异形对其他阵营**一律不公开**队友身份（卡·乔装条可见性 / 7.0 推理自由）。
       故这两个话题 claim=null（不写任何可被交叉验证的宣称），且话术必须**可否认**：
       只给「体感」不给「证据」，被追问时可完全收回。 */
    teammateIdentities: {
      claim: null,
      probe(g, p) {
        if (p.faction !== 'alien') return null;
        const ids = alive(g).filter(x => x.faction === 'alien' && x.id !== p.id).map(x => x.id);
        return ids.length ? { ids } : null;
      },
      line(g, p, m) {
        const n = m.ids.length;
        return n === 1 ? '我总觉得这场上不止我一个「自己人」。'
          : `这局有 ${n} 个人走路的方式跟我像。`;
      },
    },
    teammateBallots: {
      claim: null,
      probe(g, p) {
        if (p.faction !== 'alien') return null;
        const rec = (g.voteHistory || [])[g.voteHistory.length - 1];
        if (!rec || !rec.src) return null;
        const mates = new Set(alive(g).filter(x => x.faction === 'alien').map(x => x.id));
        const tally = {};
        for (const v of Object.keys(rec.src)) if (mates.has(+v)) { const t = rec.src[v]; tally[t] = (tally[t] || 0) + 1; }
        const ids = Object.keys(tally).filter(t => tally[t] >= 2).map(Number);
        return ids.length ? { ids } : null;
      },
      line(g, p, m) {
        /* 只说「有人跟我投了一致」，不报编号——编号一旦出口就成了可核验的宣称 */
        return `我注意到有人跟我投了同一个。说不上是谁，我不点名。`;
      },
    },
    ownNightImmuneRemain: {
      probe(g, p) {
        if (p.role !== 'xeno') return null;
        return p.nightImmune > 0 ? { n: p.nightImmune } : null;
      },
      line(g, p, m) { return `我手上还剩 ${m.n} 次夜晚免疫——留着救命，不乱花。`; },
    },
    lurkTargetPresented: {
      /* 载体：p.lastXenoCheckRes = {id, role, roleName}（steps.js:407）
         ——卡·蛰伏「查验 1 名目标」，判据同 presentedRoleOnly（只报呈现职业）。 */
      probe(g, p) {
        if (p.role !== 'xeno') return null;
        const r = p.lastXenoCheckRes;
        if (!r || r.id == null) return null;
        return { id: r.id, role: r.role, roleName: r.roleName };
      },
      line(g, p, m) {
        if (m.id == null) return null;
        return `我盯过 ${m.id} 号——他呈现的是${m.roleName || m.role || '某个职业'}。`;
      },
    },

    /* —— 死囚：镜像与变形池 ————————————————————————— */
    mirrorLedger: {
      probe(g, p) {
        if (p.role !== 'convict') return null;
        return p.mirror ? { role: p.mirror } : null;
      },
      line(g, p, m) {
        const nm = r => (global.SKData.ROLES[r] && global.SKData.ROLES[r].name) || r;
        return `我这会儿是${nm(m.role)}。`;
      },
    },
    morphTargetPool: {
      probe(g, p) {
        if (p.role !== 'convict') return null;
        const n = p.morphLeft != null ? p.morphLeft : null;
        return { n };
      },
      line(g, p, m) {
        return m.n ? `我能变的东西还剩 ${m.n} 份。你猜我现在是不是我。` : null;
      },
    },
  };

  /* =============================================================
   * 明文代价（duty.cost）→ 说话时的犹豫/留一手
   * 卡里写明代价的角色不会痛快话：神探怕暴露、毒师怕误伤、会议怕暴露编号…
   * 代价只压低「主动出手型发言」的倾向，不改目标选择（那是行为层，见 decide.js）。
   * ============================================================= */
  const COST_HEDGE = {
    checkRevealsSelf: rng => (rng && rng.chance(0.35)
      ? '……但我这一问出去，对面就知道场上有神探了。' : null),
    meetingRevealsSelf: rng => (rng && rng.chance(0.4)
      ? '不过我真要发动紧急会议，开场就报我编号——值不值我再想想。' : null),
    poisonHitsAlly: rng => (rng && rng.chance(0.45)
      ? '我下毒不看阵营，手要稳。' : null),
    canHitFriendlies: rng => (rng && rng.chance(0.3)
      ? '枪不长眼，人是。' : null),
    sniffMissesSafeRoom: rng => (rng && rng.chance(0.35)
      ? '嗅探看不到全额减免那类——「没有保护」不等于「一枪能死」。' : null),
    reportNotFaithful: rng => (rng && rng.chance(0.5)
      ? '这段是我改写过的，不保真，你们自己掂量。' : null),
    canSaveAnyone: rng => (rng && rng.chance(0.3)
      ? '救援不挑阵营——包括不该救的那个。' : null),
    noAttackFeedback: rng => (rng && rng.chance(0.4)
      ? '我穿了护甲，但我不知道谁在打我。' : null),
  };

  /* ---- 本席此刻最想说的「自己的想法」 ----
   * 顺序：按 duty.senses 声明顺序逐个取料，第一个有料的即为主导话题。
   * 返回 { sense, topic, material, line, hedge } 或 null。 */
  function thought(g, p, opts) {
    if (!p || p.out || muted(g, p)) return null;
    /* 非人类阵营**默认**不在此层取地板：它们已有卡内的专属语料层（拟人层 N349~N386、
       N351 情绪句），由 decide.speak 的 Tactics 分支配发。若 speak 也走这里，
       会把那条分支整条顶掉（实测：情绪句命中归零，拟人Ⅳ 断言变红）。
       两个阵营各走各的层，职责不重叠。
       ⚠ 但队友类话题本身是**卡载且已实现**的（duty.senses 里 teammateIdentities /
         teammateBallots），不能因为 speak 不用就成了死代码 —— 故保留 opts.allowNonHuman
         入口，供探针与断言独立复核（也是「异形队友不得产出宣称」这条守卫的验证入口）。 */
    if (p.faction !== 'human' && !(opts && opts.allowNonHuman)) return null;
    const senses = RD.sensesOf(p.role);
    if (!senses.length) return null;
    for (const key of senses) {
      const t = SENSE_TOPIC[key];
      if (!t) continue;
      /* defer：decide.speak 已有该角色的专有分支会报同一件事并写对应 claim。
         voice 抢它 ⇒ 顶掉那条分支、既换了话术又丢了证据。故让位。 */
      if (t.defer) continue;
      let m = null;
      try { m = t.probe(g, p); } catch (e) { m = null; }
      if (!m) { noteTopicMiss(key); continue; }
      noteTopicHit(key);
      let line = null;
      try { line = t.line(g, p, m); } catch (e) { line = null; }
      if (!line) continue;
      const cost = RD.costOf(p.role);
      let hedge = null;
      if (cost && COST_HEDGE[cost]) { try { hedge = COST_HEDGE[cost](g.rng); } catch (e) { hedge = null; } }
      /* claim：话题自报要写哪一种 Claim。缺省＝不写宣称（纯私聊式发言）。
         显式 null（如异形队友类）＝**禁止**写宣称——卡·可见性要求对其他阵营不公开。 */
      const claimKind = Object.prototype.hasOwnProperty.call(t, 'claim') ? t.claim : 'report';
      return {
        sense: key, topic: t, material: m, line,
        hedge: hedge ? line + hedge : line,
        claimKind: claimKind || null,
      };
    }
    return null;
  }

  /* 零命中话题登记：某个情报面「声明了、有话题实现，但在一批对局里从未取到料」。
   * 这不是违规——可能是该情报面本局没触发（如无感染则无「谁带感染标记」）。
   * 但若长期为 0 而非本局偶然，说明**载体字段引擎从未写入**，话题是死的。
   * 故把它单列出来，而不是混进 audit 的合规判断里。
   * ⚠ 「零命中」有两种性质，必须靠 probeAll 拆开（见下），否则真缺陷会被当成排序问题放过。 */
  const _zeroHit = {};
  function noteTopicHit(sense) { _zeroHit[sense] = false; }
  function noteTopicMiss(sense) { if (!(sense in _zeroHit)) _zeroHit[sense] = true; }
  function topicCoverage() { return Object.assign({}, _zeroHit); }

  /** 逐个情报面探料（**不按 thought 的顺序短路**）——只为把「零命中」拆成两种性质
   *  完全不同的情况，混成一个数会掩盖真问题：
   *    · 这里是 hasMaterial、但 thought() 那次没命中 → 被**前序话题遮挡**
   *      （素材确实在，只是没排到它；载体是活的，是排序问题）。
   *    · 这里是 noMaterial → **载体从未被引擎写入**（素材根本不存在；这是真缺陷）。
   *  例：bodyguard 的 guardFeedback 与 attackTypeOnGuard 读同一条 priv 文本，
   *  前者先命中就轮到不到后者 —— 那属遮挡，不是「伤害类型感知」没实现。
   *  返回 { senseKey: 'hasMaterial' | 'noMaterial' | 'deferred' }。 */
  function probeAll(g, p) {
    const out = {};
    for (const key of RD.sensesOf(p.role)) {
      const t = SENSE_TOPIC[key];
      if (!t) { out[key] = 'noTopic'; continue; }
      if (t.defer) { out[key] = 'deferred'; continue; }
      if (t.notApplicable) { out[key] = 'notApplicableByCard'; continue; }
      let m = null;
      try { m = t.probe(g, p); } catch (e) { m = null; }
      out[key] = m ? 'hasMaterial' : 'noMaterial';
    }
    return out;
  }

  /** 话题覆盖率自检：声明层每个 duty.senses 键都必须有话题实现（防声明漂移）。
   *  返回违规清单（空数组＝合规）。 */
  function auditTopics() {
    const bad = [];
    const seen = new Set();
    for (const k of RD.keys()) {
      for (const s of RD.sensesOf(k)) {
        if (seen.has(s)) continue;
        seen.add(s);
        const t = SENSE_TOPIC[s];
        if (!t) { bad.push(`${k}.duty.senses 的 ${s} 没有话题实现（SENSE_TOPIC 缺键）`); continue; }
        if (typeof t.probe !== 'function' || typeof t.line !== 'function')
          bad.push(`${s}: 话题必须同时有 probe(g,p) 与 line(g,p,m)`);
        /* 声明「本层无消费者」的情报面，必须写清原因与补救方向——
           否则「没实现」和「不适用」就分不清，审计也拦不住。 */
        if (t.notApplicable && !t.notApplicable.reason)
          bad.push(`${s}: 标了 notApplicable 却没有 reason——必须说明为何本层用不上`);
      }
    }
    for (const c of Object.keys(COST_HEDGE)) {
      if (Object.keys(RD.DUTY_COST || {}).indexOf(c) < 0)
        bad.push(`COST_HEDGE 的 ${c} 未登记于 DUTY_COST`);
    }
    return bad;
  }

  global.AIVoice = {
    thought, auditTopics, topicCoverage, probeAll,
    senseTopicKeys: () => Object.keys(SENSE_TOPIC),
    costHedgeKeys: () => Object.keys(COST_HEDGE),
    _SENSE_TOPIC: SENSE_TOPIC,
    _COST_HEDGE: COST_HEDGE,
  };
})(typeof window !== 'undefined' ? window : globalThis);