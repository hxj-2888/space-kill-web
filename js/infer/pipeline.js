/* 结合层（Bridge）：语言 ⇄ 推理 ⇄ 行为的唯一咽喉。
   全部公开发言——无论出自玩家还是 AI——都必须经过 Bridge.say()：
     语言层产出 Claim IR → 推理层按 kind 路由到既有 AI 钩子（不新增权重）→ 写入证据台账
     → 由 AI 的 suspOf（认知层怀疑度）/ dangerOf（行动层危险度）影响其投票 / 决策 / 下一轮发言（行为）。
      （v31 批 0 口径修正：旧注释写的 `threatOf` 是 suspOf 的历史别名，名字与行为层实际读取的
        dangerOf 不符，已删除别名并把调用点显式化。）
   设计约束：
     ① 玩家与 AI 走同一条管道，杜绝「同一句话两种效力」；
     ② 本阶段只做类型路由，已经存在的钩子照原样调用，缺席钩子的类型（defend/rally/abstain/
        bind/各类私有体验）只进证据台账、不改估值——等待后续数值方案给出权重；
     ③ 质询-应答闭环在这里闭合，不再散落在引擎与 AI 两侧。 */
(function (global) {
  const emptySig = () => ({
    mention: [], accuse: [], accTiers: {}, claim: null, ask: [], report: [], quote: [],
    voteIds: [], defend: [], rally: null, abstain: false, pass: false, roleBind: [], intents: [], conf: 1,
  });
  const P = (g, id) => g.players.find(p => p.id === id);

  /* 证据台账：v20 待办 #4 —— 每 AI 一份私有台账（p.evidenceLog），绝不共享：
     共享台账等于制造「公开怀疑度」。DEV 面板/复盘按需聚合各 AI 的私有台账。
     v21（P0-② / 改动 #4 配套）：台账条目携带 sourceId——并罚单元 = 独立信息源事件，
     同一 sourceId 的多条推断在 ai.js project() 中只取最强参与并罚。 */
  function recordEvidence(g, speakerId, c, note) {
    const sp = P(g, speakerId);
    if (!sp) return;
    if (!sp.evidenceLog) sp.evidenceLog = [];
    sp.evidenceLog.push({
      night: g.night, step: g.step, speaker: speakerId,
      sourceId: `${c.kind}:${speakerId}:${g.night}:${g.step || ''}`,
      kind: c.kind, targets: c.targets.slice(), payload: c.payload, note: note || '',
    });
  }

  /* ---------- 语言 → 推理：Claim.kind 路由 ----------
     诊断开关 SK_LEGACY_AI_ROUTE=1：AI 侧只走改造前的 accuse/ask 两路，用于回归对照。
     正常使用（开关关闭）时，AI 与玩家完全同管道。数值方案落地后可删除本分支。 */
  function absorb(g, speakerId, claims, opts) {
    const AI = global.AI;
    const p = P(g, speakerId);
    if (!AI || !p) return;
    const legacy = !!(opts && opts.legacyRoute);
    for (const c of claims) {
      if (legacy && c.kind !== 'accuse' && c.kind !== 'ask') {
        recordEvidence(g, speakerId, c, '仅入台账（legacy 对照通路）');
        continue;
      }
      switch (c.kind) {
        case 'accuse': {
          /* v26：措辞强度接进推理层（此前 payload.tier 被整体丢弃），并消费 NLP 的假设句降权
             （sig.conf<1 → 按 soft 处理：整句带「如果/假如」的假设性指控不再与断言同权）。 */
          const rawTier = (c.payload && c.payload.tier) || 'med';
          const softByConf = !!(opts && opts.sig && opts.sig.conf < 1);
          const tier = softByConf && rawTier !== 'hard' ? 'soft' : rawTier;
          for (const id of c.targets.slice(0, 2)) {
            const t = P(g, id);
            if (!t || t.out || id === speakerId) continue;
            AI.onAccuse(g, speakerId, [id], tier);
            recordEvidence(g, speakerId, c, `指控入威胁度链（档位=${tier}${softByConf ? '·假设句降权' : ''}）`);
          }
          p.lastAccuse = null;                        // 已入账，防止讨论收束时二次计入
          break;
        }
        case 'claimRole': {
          /* v27（A6-③）：统一 doc→bio 口径的兜底收口——D.ROLES 里没有 'doc'，
             任何路径（历史文本 / 旧别名 / 外部数据）产出的 'doc' 都在这里归一，
             推理层与 UI 层从此只见 bio/rescue/tempdoc 三个合法键。
             v32 机制对等（用户拍板「玩家亲自发言就识别不出来」）：旧实现 `!p.claimedRole`
             把【先说过的身份】钉死——玩家只要说过一句「我查过 X」就被 onReport 隐式
             自证为船员，之后真正跳神探/医生被静默吞掉（AI 有 decide 分支不受此限）。
             现允许改口：不同身份仍产出 claimRole（R38 自证照记），对跳/假冒由
             R12 唯一性冲突与 R30 揭示置位对账——改口有代价，但不再被吞。 */
          const role = c.payload.role === 'doc' ? 'bio' : c.payload.role;
          if (role && p.claimedRole !== role) {
            const switched = !!p.claimedRole;
            p.claimedRole = role;
            AI.onClaim(g, p, role);
            recordEvidence(g, speakerId, c, switched ? `身份改口（原声称已被记录）→R38 自证链 + R12/R30 对账` : '身份声称→R38 自证链');
          }
          break;
        }
        case 'exclusion':
        case 'lock': {
          /* v21 §5.1 口径修正：能执行查验的只有普通船员/神探/外星人三类；
             异形无任何查验能力（5.8）——宣称「我查了 X」→ A⁻ +33（来源致命）。
             神探 / 外星人宣称查验不构成暴露，反而成立。 */
          if (p.faction === 'alien') {
            AI.onCheckClaim(g, p);
            recordEvidence(g, speakerId, c, '异形谎称查验→A⁻（来源致命，§5.1）');
          } else {
            AI.onReport(g, p);
            /* v31 裁定（用户拍板）：**神探【口头汇报】不等于 ③ 官方公告**——
               此前真神探在讨论里说一句「我查过 X，他是异形」就给全场写硬锁（p.known），
               与官方公告同权。现改：口头汇报只走【可伪造的宣称】入账（下面的目标侧证据
               Tiers.RULE.lockEnemy/lockHuman + 说话者自证），**不再写全场硬锁**。
               硬锁的唯一来源保留为官方 ③ 公告（steps.js 的 announce('③') + revealPublic）
               以及角色自身的私有查验（`p.checkPool`）；冒领者与真神探在证据层同权，
              这正是定案 20 / N400「冒领与清零」博弈成立的前提。 */
            recordEvidence(g, speakerId, c, p.role === 'detective'
              ? '神探口头汇报→按宣称档位入账（v31 裁定：非官方公告，不写硬锁）'
              : '查验汇报→R38 隐式自证');
          }
          /* v26（P0 修复）：宣称类的【目标侧】入账。
             此前 lock/exclusion 只触发「说话者自证」，观察者对「X 是异形 / X 是好人」这句话
             在估值层零反应——总表 A/B 档的查验汇报通道在推理端没有落点，AI 与玩家说出同一句话
             都不改变任何人的判断（这也是"AI 手里证据很多、能区分好坏的极少"的直接原因）。
             方向由 payload 决定：faction 明确按阵营；faction 缺省时用 good（true=好人 / false=敌方）。
             档位取 Tiers.RULE.lockEnemy(B−) / lockHuman(C−)：均为【可伪造的宣称】，
             按 claim 衰减，不与官方 ④⑤ 硬源同级。
             未做 exclusion：排除人类职业在贝叶斯上轻微指向非人类，与「查验清人」的语用相反，
             方向需裁定，暂只入台账（见修复说明"待裁定项"）。 */
          if (c.kind === 'lock' && c.targets[0] != null) {
            const T = global.Tiers;
            const f = c.payload.faction || (c.payload.good === true ? 'human' : c.payload.good === false ? 'alien' : null);
            if (T && f) {
              const tier = f === 'human' ? T.RULE.lockHuman : T.RULE.lockEnemy;
              const signed = (f === 'human' ? -1 : 1) * T.SCORE[tier];
              for (const o of g.players) {
                if (o.out || o.id === speakerId || o.id === c.targets[0]) continue;
                /* v32 批 4′（统一入账口）：路径①改道 MoE.absorb（参数透传）；批 5′ 补 evt=verify（宣称对账族） */
                global.MoE.absorb(g, o.id, [{ target: c.targets[0], delta: signed, grudge: false,
                  src: `locksay:${speakerId}:${c.targets[0]}:${g.night}`, kind: 'claim', tier, speakerId }], { path: 'speak', evt: 'verify' });
              }
              recordEvidence(g, speakerId, c, `查验汇报→目标侧入账（${f} / ${tier}）`);
            }
          }
          /* v28（B3 裁定，方向 (a) 贝叶斯）：排除类宣称的【目标侧】入账（此前只入台账）。
             判据：「他不是 X/Y」（X/Y 为人类专属职业）在贝叶斯上轻微指向非人类。
             幅度取 Tiers.RULE.exclusion = D--（专用最弱档）——直接沿用 D− 会让 p_alien 抬升
             12~18pp，远超总表实测的 +4.7pt；仅当被排除项全部为人类职业时方向才确定。
             宣称可伪造，故 kind='claim'（按夜衰减），与 lock 类同口径。 */
          if (c.kind === 'exclusion' && c.targets[0] != null) {
            const T = global.Tiers, D0 = global.SKData;
            const ex = (c.payload && c.payload.excludes) || [];
            const humanOnly = ex.length > 0 && ex.every(r => D0 && D0.ROLES[r] && D0.ROLES[r].faction === 'human');
            if (T && humanOnly) {
              const tier = T.RULE.exclusion, mag = T.SCORE[tier];
              for (const o of g.players) {
                if (o.out || o.id === speakerId || o.id === c.targets[0]) continue;
                /* v32 批 4′（统一入账口）：路径①改道 MoE.absorb（参数透传）；批 5′ 补 evt=verify */
                global.MoE.absorb(g, o.id, [{ target: c.targets[0], delta: mag, grudge: false,
                  src: `excludesay:${speakerId}:${c.targets[0]}:${g.night}`, kind: 'claim', tier, speakerId }], { path: 'speak', evt: 'verify' });
              }
              recordEvidence(g, speakerId, c, `排除宣称→目标侧弱证据（${tier}，B3 方向 a）`);
            }
          }
          break;
        }
        case 'quote':
          for (const b of c.targets.slice(0, 2)) {
            if (!c.payload.by) continue;
            AI.onQuote(g, speakerId, [{ by: c.payload.by, target: b }]);
            recordEvidence(g, speakerId, c, '转述归因');
          }
          break;
        case 'vote':
          (p.declaredVotes = p.declaredVotes || []).push({ night: g.night, ids: c.targets.slice(0, 2) });
          recordEvidence(g, speakerId, c, '投票意向声明（R64 对账用）');
          break;
        /* 以下类型本阶段只入台账：原有实现中没有对应钩子，权重待数值方案给出 */
        case 'defend':
          recordEvidence(g, speakerId, c, '辩护/背书（待估值）'); break;
        case 'rally':
          recordEvidence(g, speakerId, c, '归票号召（待估值）'); break;
        case 'abstain':
          /* v26：弃票声明留结构化记录——D03 通道判据（验票官用票源对账「宣称弃票却投了人」） */
          (p.declaredAbstain = p.declaredAbstain || []).push({ night: g.night });
          recordEvidence(g, speakerId, c, '弃票声明（D03 对账用）'); break;
        case 'split':
          recordEvidence(g, speakerId, c, '分票警告（待估值）'); break;
        case 'bind':
          recordEvidence(g, speakerId, c, '编号+职业绑定（对证素材，待估值）');
          if (!p.roleBindClaims) p.roleBindClaims = [];
          p.roleBindClaims.push({ night: g.night, id: c.targets[0], role: c.payload.role });
          break;
        case 'suppress': case 'repair': case 'destroy':
        case 'cure': case 'rescue': case 'brew': case 'infection': {
          const T = global.Tiers;
          if (!p.claimedExperience) p.claimedExperience = [];
          p.claimedExperience.push({ night: g.night, kind: c.kind });
          /* v22 批次 5 第三阶段：私有体验宣称 D 档入账（单体层，target = 说话者）——
             D 档定义「编造零成本」→ D−；价值仅在跨夜一致。
             破坏宣称另挂延迟兑现结算（N01/N02/N03 + F02，见 ai.settleClaims）。 */
          for (const o of g.players) {
            if (o.out || o.id === speakerId) continue;
            /* v32 批 4′（统一入账口）：路径①改道 MoE.absorb（参数透传）；批 5′ 补 evt：破坏/维修宣称 → infra，治疗/感染/制药/救援宣称 → infect */
            global.MoE.absorb(g, o.id, [{ target: speakerId, delta: T.SCORE[T.RULE.expClaim], grudge: false,
              src: `exp:${c.kind}:${speakerId}:${g.night}`, kind: 'claim', tier: T.RULE.expClaim, speakerId }],
              { path: 'speak', evt: (c.kind === 'destroy' || c.kind === 'repair') ? 'infra'
                : (c.kind === 'cure' || c.kind === 'infection' || c.kind === 'brew' || c.kind === 'rescue') ? 'infect' : null });
          }
          if (c.kind === 'destroy') {
            if (!p.pendingDestroy) p.pendingDestroy = [];
            p.pendingDestroy.push({ night: g.night, kind: 'destroy' });
          }
          recordEvidence(g, speakerId, c, '私有体验宣称（D− 单体层入账；destroy 挂延迟兑现）');
          break;
        }
        case 'deny': {
          recordEvidence(g, speakerId, c, '证伪型宣称 A12~A15（对宣称者 A⁻）');
          if (!p.denyClaims) p.denyClaims = [];
          p.denyClaims.push({ night: g.night, about: c.payload.about });
          /* v26：证伪型宣称落地（此前只挂一个没人读的数组）。
             「我没被查验」是【可被观察者私有知识当场证伪】的断言——只有真正查过他的人才知道。
             about='checked'：观察者自己的神探查验池 / 船员双查里出现过说话者 → 他在说谎（A⁻）。
             收益：这是极少见的【真正依赖观察者私有信息】的通道来源，天然产生个体分叉。
             about='cured'/'infection' 需要医生侧的状态跟踪（markSeen 覆盖不全），留待后续批次。 */
          if (c.payload.about === 'checked') {
            const T = global.Tiers;
            for (const o of g.players) {
              if (o.out || o.id === speakerId) continue;
              const caught = (o.checkPool && o.checkPool.has(speakerId)) || (o.crewChecks && o.crewChecks.has(speakerId));
              if (!caught) continue;
              /* v32 批 4′（统一入账口）：路径①改道 MoE.absorb（参数透传）；批 5′ 补 evt=verify（证伪型对账族） */
              global.MoE.absorb(g, o.id, [{ target: speakerId, delta: T ? T.SCORE[T.RULE.denyLie] : 33, grudge: false,
                src: `denyLie:${speakerId}:${o.id}:${g.night}`, kind: 'claim', tier: T ? T.RULE.denyLie : 'A-', speakerId }], { path: 'speak', evt: 'verify' });
            }
          }
          break;
        }
        case 'promise':
          recordEvidence(g, speakerId, c, '承诺宣称 E7（弱/中/强，兑现追踪待 C 表落地）');
          if (!p.promises) p.promises = [];
          /* v21 §4.4/§5.2：承诺奖励发给 C（弱 +0.05 / 中 +0.15 / 强 +0.30）；
             惩罚只适用于可验证的承诺——保镖「我保护 X」公开不可验证、施术者私有可感，
             不适用未兑现惩罚，verifiable=false 标记。 */
          /* v31 批 2（A3）：补 kind 字段——结算方式按承诺类型分派（vote / announce），
             不再一律用「承诺者本人投票」判兑现（预告类承诺与投票无关，会被误判违约）。 */
          p.promises.push({ night: g.night, tier: c.payload.tier, targets: c.targets.slice(),
            kind: c.payload.kind || 'vote',
            verifiable: c.payload.kind !== 'protect' });
          break;
        default:
          recordEvidence(g, speakerId, c, '其他');
      }
    }
  }

  /* ---------- 质询-应答闭环：语言 → 语言 → 推理 ---------- */
  function dispatchAsk(g, speakerId, targets, kind, aiSource) {
    const AI = global.AI;
    AI.onAsk(g, speakerId, targets);
    for (const tid of targets) {
      const t = P(g, tid);
      if (!t || t.out || tid === speakerId) continue;
      const key = speakerId + ':' + tid + ':' + g.night;
      g.askTally = g.askTally || {};
      g.askTally[key] = (g.askTally[key] || 0) + 1;
      if (t.isHuman) { g.pendingAsk = { night: g.night, target: t.id, asker: speakerId }; continue; }
      const ans = AI.answerQuestion(g, t, speakerId);
      /* 应答者必为 AI，应答内容同样是一句「发言」——继承 aiSource，便于 legacy 对照 */
      say(g, t.id, ans.text, { kind: kind || '讨论', noAskChain: true, aiSource: !!aiSource });
      AI.evaluateAnswer(g, t, ans.quality);
    }
  }

  /* ---------- 统一发言入口 ---------- */
  function say(g, pid, text, opts) {
    opts = opts || {};
    const IR = global.IR;
    const p = P(g, pid);
    if (!p) return false;
    const clean = (text == null ? '' : String(text).trim());
    if (!clean && !(opts.extra && opts.extra.length)) return false;

    /* 1) 语言层：Claim IR（AI 自带意图优先；否则由 parser 从文本理解） */
    let list = [], sig = null;
    if (opts.claims && opts.claims.length) {
      list = opts.claims.slice();
      sig = global.NLP ? global.NLP.parse(clean, { speaker: pid }) : emptySig();
    } else if (clean) {
      const r = IR ? IR.fromText(clean, { night: g.night, step: g.step, speaker: pid, channel: opts.channel || 'public' }) : { claims: [], sig: null };
      list = r.claims || [];
      sig = r.sig || emptySig();
    }
    if (!sig) sig = emptySig();
    let all = (opts.extra || []).concat(list);
    all = IR ? IR.sortClaims(all) : all;
    /* v21 战术库排错条目（N397~N400）：AI 侧生成前过滤——Z 档「根本不生成」而非事后检测 */
    if (opts.aiSource && global.Tactics) {
      all = global.Tactics.filterClaims(all, p, {
        night: g.night,
        detectiveAnnounceRecent: global.Tactics.detectiveAnnounceRecent(g),
      });
    }

    /* 2) 4.9 验票官公开指控标记：纯展示，不进推理 */
    if (opts.markTarget && p.role === 'inspector' && g.meeting) {
      g.accuseMark = { by: pid, target: opts.markTarget };
      all = all.filter(c => !(c.kind === 'accuse' && c.targets.indexOf(opts.markTarget) >= 0));
    }

    /* 3) 公开发言记录（UI 小字「原意」读 sig） */
    const kind = opts.kind || '讨论';
    (g.talks = g.talks || []).push({ id: pid, text: clean });
    g.chatLog.push({ night: g.night, kind, id: pid, text: clean, sig });
    p.claims.push({ night: g.night, text: clean });

    /* 4) 语言 → 推理（sig 一并带给推理层：假设句降权 conf 需要它） */
    const legacyRoute = !!(opts.aiSource && global.SK_LEGACY_AI_ROUTE);
    absorb(g, pid, all, Object.assign({ legacyRoute, sig }, opts));

    /* 5) 真人应答评估（被 AI 质询后的首次发言） */
    if (g.pendingAsk && g.pendingAsk.target === pid) {
      let quality = 'vague';
      if (sig.claim) quality = 'truth';
      else if (/(拒绝|无可奉告|不回答|保密|不想说|凭什么|闭嘴)/.test(clean)) quality = 'refuse';
      else if (/(查验|维修|保护|昨晚我|我在|我做了|我守护|我开枪|我救)/.test(clean)) quality = 'truth';
      global.AI.evaluateAnswer(g, p, quality);
      g.pendingAsk = null;
    }

    /* 6) 公开质询 → 当场应答（闭环回到语言层） */
    if (!opts.noAskChain) {
      const asks = all.filter(c => c.kind === 'ask').map(c => c.targets[0]).filter(x => x != null);
      if (asks.length) dispatchAsk(g, pid, asks.slice(0, 2), kind, !!opts.aiSource);
    }
    p.lastAsk = null;
    return true;
  }

  /* ---------- 私聊频道（v22 批次 3）：priv() 旁路 → 一等公民 ----------
     私聊 → IR(channel=private) → 档位全面降 D（§2.3 裁定：私聊档一律取 D——
     堵住「神探私聊定向交底 → 接收方拿到硬信息」的捷径）→ Z 档排错过滤
     → 证据台账（仅接收方一份，sourceId 标记 pm，并罚单元 = 一次私聊）。
     硬源侧不放开：viaPrivate 永不进 knownLockOf（ai.js），私聊声称不是官方背书。
     注意：弱化层钩子（onPrivate / onPrivateShare）仍由引擎步骤 0c 调用，此处不重复触发。 */
  function privateSay(g, receiverId, speakerId, text) {
    const IR = global.IR, sp = P(g, speakerId), rcv = P(g, receiverId);
    if (!sp || !rcv || !text) return;
    const clean = String(text).trim();
    if (!clean) return;
    const r = IR ? IR.fromText(clean, { night: g.night, step: g.step, speaker: speakerId, channel: 'private' }) : { claims: [] };
    let claims = r.claims || [];
    claims = claims.map(c => Object.assign({}, c, { tier: 'D', channel: 'private' }));
    if (!sp.isHuman && global.Tactics) {
      claims = global.Tactics.filterClaims(claims, sp, { night: g.night, detectiveAnnounceRecent: global.Tactics.detectiveAnnounceRecent(g) });
    }
    if (!rcv.evidenceLog) rcv.evidenceLog = [];
    for (const c of claims) {
      rcv.evidenceLog.push({
        night: g.night, step: g.step, speaker: speakerId,
        sourceId: `pm:${c.kind}:${speakerId}:${g.night}:${(c.targets || [])[0]}`,
        kind: c.kind, targets: (c.targets || []).slice(), payload: c.payload,
        note: '私聊频道（v22 批次 3，档 D）',
      });
    }
  }

  global.Bridge = { say, absorb, dispatchAsk, recordEvidence, emptySig, privateSay };
})(typeof window !== 'undefined' ? window : globalThis);
