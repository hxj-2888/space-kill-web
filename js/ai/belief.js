/* =============================================================
 * 太空杀 · AI 信念与估值模型（自 js/ai.js 解耦，v27 模块化第一批）
 *
 * 职责（只做数学，不做决策、不产出话语）：
 *   ① 证据账本：addEvent / setHardFloor / credAdd / once（幂等键）
 *   ② 三通道投影：ensureE 先验 → project（并罚/衰减/C 缩放/硬源短路）
 *   ③ 估值：hostileOf（敌对度）/ suspOf（怀疑度 S）/ suspDist（分布）/ dangerOf（危险度 Dg）
 *   ④ 构成项：capability（能力项）/ actF（活跃度）/ universalOf（普适层饱和偏移）/ priorOf
 *
 * 依赖：仅 global.Tiers（档位分值表）。全部状态挂在玩家对象上
 *   （p.evidence / p.tEvents / p.hardFloor / p.cred / p.uEvents），无模块私有状态。
 * 调用点：js/ai.js 以 const X = AIBelief.X 别名转发 —— 本文件不含任何决策逻辑。
 * ============================================================= */
(function (global) {
  const T = global.Tiers;                        // 档位分值表（A35/B20/C10/D5，±2）
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const byId = (g, id) => g.players.find(p => p.id === id);
  /* ============ 证据分 E 三通道模型（v21 规格 §4.1）============
     E(i,j,f)，f ∈ {human, alien, king}：只增不减；硬源 override；宣称类按夜衰减。
     怀疑度 S 的正式定义 = 三阵营分布（纵向）：p_f = E_f / ΣE_f；
     敌对度 = 分布的推导量：人类 p_alien+p_king / 异形 p_human+p_king / 外星人 p_alien（§3.5）。
     baseRate 已废（改动 #1）：其数值回收为先验（人类 28.6 / 外星人 21.4 / 异形对非队友 50）。 */
  const ROLE2FACTION = { crew: 'human', detective: 'human', inspector: 'human', bio: 'human', rescue: 'human', tempdoc: 'human', bodyguard: 'human', sheriff: 'human', engineer: 'human', armed: 'human', assistant: 'human', alien: 'alien', xeno: 'xeno' };
  /* 阵营字面量白名单（v26 修复 P0-②）：known 记录只带 faction（无 role）时的合法性校验。
     此前用 ROLE2FACTION 兼任校验表——而该表是「职业→阵营」映射、没有 'human' 这个键，
     导致 {faction:'human', role:null} 恒被判为非法 → 硬源锁定对「已确认为人类」整体失效
     （船员双查锁定 / 船员公开分享金水 / 真神探口头金水三条链路的锁定全部丢失）。 */
  const FACTION_SET = { human: 1, alien: 1, xeno: 1 };
  /* v28（B2 裁定）：下列常量全部上移到 js/infer/tiers.js，本文件只引用——
     调用点不再出现裸数值（衰减 / 先验 / 饱和 / 权重 / 系数 / 值域 / 置位）。 */
  const CLAIM_DECAY = T.CLAIM_DECAY;       // §4.3：宣称类每夜 ×0.85（半衰期约 4.3 夜）
  const GRUDGE_DECAY = T.GRUDGE_DECAY;     // 记仇通道衰减更慢（τGrudge=8 > τ=4）
  const DG_W = T.DG_W;                     // §4.1.4 Dg 构成权重（uni = 普适层偏移项，v20 双层估值）
  const PRIOR = T.PRIOR, PRIOR_E = T.PRIOR_E, CAP = T.CAP, SUSP = T.SUSP_RANGE;
  const TIER_BY_VAL = {};
  /* v31 批 1（B2′）：排除 'P' —— 它是「私有源标记」而非强度档，虽然 SCORE['P'] 有映射值，
     但不应参与「按数值反查档位」的兜底（否则 magnitude 恰为 10 的无 tier 事件会被误标成 P）。 */
  if (T) for (const k of Object.keys(T.SCORE)) if (k !== 'P') TIER_BY_VAL[T.SCORE[k]] = k;

  /* 先验（改动 #1：baseRate 数值回收），按观察者阵营读取 */
  function priorOf(g, p) {
    return p.faction === 'human' ? PRIOR.human : p.faction === 'xeno' ? PRIOR.xeno : PRIOR.alienVsOther;
  }

  /* 懒初始化兜底（正常路径由 state.js createGame 完成） */
  function ensureE(g, p) {
    if (p.evidence && p.hardFloor && p.cred) return;
    p.evidence = p.evidence || new Map();
    p.hardFloor = p.hardFloor || new Map();
    p.cred = p.cred || new Map();
    if (p.evidence.size) return;
    for (const o of g.players) {
      if (o.id === p.id) continue;
      let e;
      if (p.faction === 'human') e = Object.assign({}, PRIOR_E.humanViewer);
      else if (p.faction === 'xeno') e = Object.assign({}, PRIOR_E.xenoViewer);
      else if (o.faction === 'alien') e = Object.assign({}, PRIOR_E.alienMate);
      else e = Object.assign({}, PRIOR_E.alienVsOther);
      p.evidence.set(o.id, e);
    }
  }

  /* 活跃度 log 调制（3.5）：v21 裁定 §3.4 后【仅作 Dg 调制项】。
     v25 遗留修复：旧实现读目标真相阵营 + 全局阵营累计计数（actCounts 按 faction 分桶）——
     等于「所有异形共享同一活跃度」，既透视又退化。现只读【公开可观测的个体行为量】：
     公开指控 / 质询 / 承诺次数、宣称身份、④ 官方暴露、当前是否被沉默。 */
  function actF(g, p) {
    let n = 0;
    n += (p.accuseHistory || []).length;
    n += (p.askHistory || []).length;
    n += (p.promises || []).length;
    if (p.claimedRole) n += 2;
    if (p.repairExposed) n += 3;
    if (p.silenceNight != null && p.silenceNight >= g.night) n = Math.max(0, n - 2);   // 沉默压制活跃度
    if (!n) return 0;
    const A = Math.log(1 + n);
    return A / (A + 1);
  }

  /* §4.3 衰减口径（cumDecay 已删，改动 #5）：
     宣称类每夜 ×0.85；记仇通道衰减更慢；公开事实类（fact，C/F 档恒真指纹）不衰减 */
  function claimDecay(ev, age) {
    if (ev.kind === 'fact') return 1;
    return Math.pow(ev.grudge ? GRUDGE_DECAY : CLAIM_DECAY, age);
  }

  /* §4.4 可信度 C：C(i,k) ∈ [0,1]，不归一化，初始 0.5，每个观察者对每个说话者持一份。
     D 档增量按 (0.4+0.6C) 缩放——直接实现「编造零成本 → 价值极低」；承诺奖励发给 C。 */
  function credOf(p, speakerId) {
    if (!p.cred) p.cred = new Map();
    return p.cred.has(speakerId) ? p.cred.get(speakerId) : 0.5;
  }
  function credAdd(g, viewerId, speakerId, dv) {
    const v = byId(g, viewerId);
    /* v32 机制对等：isHuman 排除移除——玩家席位与 AI 席位同权入账（可信度表对玩家同样生效） */
    if (!v || v.out) return;
    ensureE(g, v);
    v.cred.set(speakerId, clamp(credOf(v, speakerId) + dv, 0, 1));
  }

  /* 硬源置位（改动 #9）：R30 假冒揭示 / R7 假标记滞留——下限钳制，不衰减、不可被软证据反向 */
  function setHardFloor(g, viewerId, targetId, v) {
    const vv = byId(g, viewerId);
    /* v32 机制对等：R30 假冒 / R7 假标记的硬源置位对玩家席位同样生效 */
    if (!vv || vv.out) return;
    ensureE(g, vv);
    const cur = vv.hardFloor.get(targetId);
    if (!cur || v > cur.v) vv.hardFloor.set(targetId, { v, night: g.night });
  }

  /* 硬源唯一路径 = knownLockOf（v21 实现审查 #7 收敛）：此前 setHardLock 与 knownLockOf
     两条并行实现并存（双写风险）。现统一为一条——硬源事实（⑥⑩揭示 / ④⑤暴露 / ⑦验票官 /
     查验锁定 / 异形互认 / 真神探公告）全部由 engine / pipeline 写入 p.known，
     AI 侧只经 knownLockOf 读取。覆盖后不可撤销、不衰减；E 仍继续累积但不参与投影（可追溯）。 */

  /* 通道映射（§4.1.3 负值事件写反向通道）：可疑 → 敌方通道；可信 → human 通道。
     异形视角：非队友的一切信息都指向「人类/敌方」通道（敌对度 = p_human+p_king，
     异形已知队友名单，非队友不可能是异形）。
     v21 审查 P0-1：king 不再是死通道——判据表事件（emitKingSignals）经 hint='king'
     显式指向 king 通道，使观察者能形成「此人是外星人（第三方）」的独立判断，
     而非把外星人当成「最像异形的人」优先清除。 */
  function chanFor(viewer, delta, hint) {
    if (hint === 'king' || hint === 'alien' || hint === 'human') return hint;
    if (viewer.faction === 'alien') return 'human';
    return delta >= 0 ? 'alien' : 'human';
  }

  /* 查验/揭示硬源（§4.2）：known 中带阵营且非私聊弱记录的条目 = 规则背书的硬源
     （⑥⑩出局/驱逐揭示、④维修暴露、⑤破坏者暴露、⑦验票官、查验锁定、异形互认、真神探公告）。
     §5.3：硬源是「公布职业」，阵营由职业→阵营确定性推论得出（不读 p.faction 透视）。 */
  function knownLockOf(p, id) {
    const k = p.known.get(id);
    if (!k || k.viaPrivate) return null;
    if (k.role && ROLE2FACTION[k.role]) return ROLE2FACTION[k.role];
    if (k.faction && FACTION_SET[k.faction]) return k.faction;
    return null;
  }

  /* E → 三阵营分布投影（改动 #2）：
     并罚按独立信息源事件（§4.3，依赖 sourceId）：同源取最强；多源最强全额、第二 ×0.5、第三起 ×0.25 */
  function project(g, p, id) {
    ensureE(g, p);
    /* 自视角硬锁：自己所属阵营恒真（敌对度推导为 0，Dg 钳制项归零）——evidence 表不含自己 */
    if (id === p.id)
      return { p_human: p.faction === 'human' ? 1 : 0, p_alien: p.faction === 'alien' ? 1 : 0, p_king: p.faction === 'xeno' ? 1 : 0 };
    const ev = p.evidence.get(id);
    if (!ev) return { p_human: 1 / 3, p_alien: 1 / 3, p_king: 1 / 3 };
    let h = ev.human, a = ev.alien, k = ev.king;
    const kl = knownLockOf(p, id);
    if (kl === 'human') return { p_human: 1, p_alien: 0, p_king: 0 };
    if (kl === 'alien') return { p_human: 0, p_alien: 1, p_king: 0 };
    if (kl === 'xeno') return { p_human: 0, p_alien: 0, p_king: 1 };
    const evs = p.tEvents.get(id) || [];
    const groups = new Map();
    evs.forEach((e, i) => {
      const key = e.src || '#' + i;                       // 无 sourceId 的事件各算独立源
      const cur = groups.get(key);
      if (!cur || Math.abs(e.delta) > Math.abs(cur.delta)) groups.set(key, e);
    });
    const ranked = [...groups.values()].map(e => ({ e, mag: Math.abs(e.delta) })).sort((x, y) => y.mag - x.mag);
    ranked.forEach((r, idx) => {
      const mult = idx === 0 ? 1 : idx === 1 ? 0.5 : 0.25;   // 并罚公比 0.5
      const e = r.e;
      if (mult < 1) {                                        // v25 指标组 D：被并罚折叠的条数（按 viewer|target|src 去重——投影会反复重算）
        (g._foldSet || (g._foldSet = new Set())).add(p.id + '|' + id + '|' + (e.src || ''));
      }
      const age = Math.max(0, g.night - e.night);
      /* v21 审查 #6：档位优先取事件自带 tier（原值反查在 R17 阶段系数 / onClaim 半值 /
         R30/R7 置位等非档位原值上必然落空，C 缩放静默失效）；反查仅作兜底 */
      const tier = e.tier || TIER_BY_VAL[r.mag];
      /* v21 审查 P0-2：C 的定义是「我有多信说话者」——按事件的 speakerId 取，
         缺省退化为按 target（系统事实类无说话者，D 档缩放对无主事实本就不适用） */
      const cscale = tier && tier[0] === 'D' ? (0.4 + 0.6 * credOf(p, e.spk || id)) : 1;
      const amt = r.mag * mult * claimDecay(e, age) * cscale;
      const ch = chanFor(p, e.delta, e.chan);
      if (ch === 'alien') a += amt; else if (ch === 'king') k += amt; else h += amt;
    });
    const sum = h + a + k;
    if (sum <= 0) return { p_human: 1 / 3, p_alien: 1 / 3, p_king: 1 / 3 };
    /* v22 批次 8：E8 置信上限——证据全部来自身份推断（E8）时，最大项 clamp 到 0.85，
       留 15% 给「我可能想错了」。任一非 E8 来源在场即不触发。 */
    const allEvs = p.tEvents.get(id) || [];
    if (allEvs.length && allEvs.every(e => e.exp === 'E8')) {
      const d = { p_human: h / sum, p_alien: a / sum, p_king: k / sum };
      const keys = ['p_human', 'p_alien', 'p_king'];
      const mk = keys.reduce((x, y) => (d[y] > d[x] ? y : x), 'p_human');
      if (d[mk] > 0.85) {
        const excess = d[mk] - 0.85;
        const restKeys = keys.filter(x => x !== mk);
        const restSum = restKeys.reduce((acc, x) => acc + d[x], 0);
        for (const x of restKeys) d[x] += restSum > 0 ? excess * (d[x] / restSum) : excess / 2;
        d[mk] = 0.85;
        return d;
      }
    }
    return { p_human: h / sum, p_alien: a / sum, p_king: k / sum };
  }

  /* ============ v20 定案「双层估值」：普适层（全场群体基线）============
     普适层与单体层（per-pair E）并行：普适层承载「证群体不证个体」的通道
     （针对：全场 / 结构事实），不指向个体，以基线偏移调制全体候选的危险度。
     A 档硬事实与 C 档群体指纹走这里；D 档只改相信者的单体值（不经普适层）。 */
  function addUniversal(g, viewerId, delta, tier, src, kind, expert) {
    const v = byId(g, viewerId);
    /* v32 机制对等：普适层对玩家席位同样生效 */
    if (!v || v.out) return;
    if (!v.uEvents) v.uEvents = [];
    v.uEvents.push({ night: g.night, delta, tier: tier || null, src: src || null, kind: kind || 'claim', exp: expert || null });
  }
  function universalOf(g, p) {
    if (!p.uEvents || !p.uEvents.length) return priorOf(g, p);
    let s = 0;
    for (const e of p.uEvents) {
      const age = Math.max(0, g.night - e.night);
      const decay = e.kind === 'fact' ? 1 : Math.pow(CLAIM_DECAY, age);   // 宣称类衰减 / 事实不衰减（§4.3 同口径）
      s += e.delta * decay;
    }
    /* v26 饱和化：普适层要承载数百条通道的群体基线偏移，线性累加会在几夜内顶到 clamp 上限 ——
       任何一个观察者只要看到十几条 C 档通道，偏移就被抬到 +70，再乘 DG_W.uni=0.15 就是
       全体候选危险度 +10（投票门槛被动下降）。旧行为之所以没暴露，是因为执行器的幂等键写错，
       每条普适层通道只有座位序最前的那个 AI 收得到（见 moe.js runChannelsAll 注释）。
       通道接线一旦铺开，必须给"偏移"一个饱和边界：把 Σ 映射到 ±25（×0.15 → ±3.75 危险度），
       与「偏移调制」的语义一致，也让接线规模与基线强度解耦。 */
    const U = T.UNIVERSAL;
    const shift = U.cap * (s / (Math.abs(s) + U.k));
    return clamp(priorOf(g, p) + shift, SUSP.lo, SUSP.hi);
  }

  /* 敌对度（§4.1.2 推导量）：外星人排序量取 p_alien（裁定 §3.5，不用 hostile） */
  function hostileOf(p, d) {
    if (p.faction === 'alien') return d.p_human + d.p_king;
    if (p.faction === 'xeno') return d.p_alien;
    return d.p_alien + d.p_king;
  }

  /* 怀疑度 S（改动 #2）：三通道分布的敌对度投影 ×100，绝对私有。
     认知层用量——共识快照/DEV 显示读它；行动层（投票/攻击/指控）读 dangerOf。 */
  function suspOf(g, p, id) {
    const t = byId(g, id);
    if (!t || t.out) return 0;
    ensureE(g, p);
    let s = hostileOf(p, project(g, p, id)) * 100;
    const fl = p.hardFloor.get(id);
    if (fl) s = Math.max(s, fl.v);           // 硬源置位（R30/R7）
    return clamp(s, SUSP.lo, SUSP.hi);
  }

  /* 怀疑度三阵营分布（改动 #2 验收口径）：返回 {p_human, p_alien, p_king}，和为 1 */
  function suspDist(g, p, id) {
    const t = byId(g, id);
    if (!t || t.out) return { p_human: 0, p_alien: 0, p_king: 0 };
    ensureE(g, p);
    return project(g, p, id);
  }

  /* 危险度 Dg（改动 #3，§4.1.4）：独立模型，与 S 解耦——
     Dg = w_cap×能力项 + w_host×敌对度 + w_act×活跃度 − 钳制项；CONV 换算作废（tiers.js 已删）。
     三档性格作用于 Dg 的行动阈值（基线 30/50/70，登记在 Tiers.BASE_DANGER；
     实际消费点在 decide.js 的 actLine(10/20/30) 等），不作用于构成权重。
     本函数只算 Dg，不读 θ。行动层（投票 / 出刀 / 感染 / 指控门限）一律读它。 */
  function dangerOf(g, p, id) {
    const t = byId(g, id);
    if (!t || t.out) return 0;
    ensureE(g, p);
    /* v32（用户拍板「公告/暴露一律硬锁，危险度拉满」）：人类观察者对【官方确证】的
       异形/外星人危险度直接钳满（异形 100 / 外星人 90）——③④⑤⑥⑩ 全部走 revealPublic
       写 known 硬锁，估值层叠加已无意义：公告的意义就是「这个人不用再算了」。
       确证己方（kl === p.faction）走下方 hostile ≤ 0 的既有钳制归零。 */
    if (p.faction === 'human') {
      const klock = knownLockOf(p, id);
      if (klock === 'alien') return 100;
      if (klock === 'xeno') return 90;
    }
    const hostile = hostileOf(p, project(g, p, id));
    if (hostile <= 0) return 0;               // 钳制项：硬源确证为己方 → Dg 归零
    let dg = DG_W.cap * capability(g, t) * 100 + DG_W.host * hostile * 100 + DG_W.act * actF(g, t) * 100;
    /* v20 双层估值：普适层偏移（群体基线相对先验的偏离）调制全体候选的危险度——
       局势紧张（群体指纹抬升）则全员危险度同步上移，投票门槛相对下降 */
    dg += (DG_W.uni || 0.15) * (universalOf(g, p) - priorOf(g, p));
    const fl = p.hardFloor.get(id);
    if (fl) dg = Math.max(dg, fl.v);
    return clamp(dg, SUSP.lo, SUSP.hi);
  }

  /* 能力项（§4.1.4）：只读公开可推信息（宣称/揭示职业的神职价值、维修暴露），
     不读隐藏资源（刀数/感染名额/破坏档位）——§7.1 最小信息原则 */
  function capability(g, t) {
    let c = CAP.base;
    /* v27（A6-③）：删除 `!== 'doc'` 死条件——doc→bio 口径已统一（D.ROLES 无 'doc' 键），
       原条件在语言层不再产出 'doc' 之后恒真，留着只会误导「医生系宣称不走能力项」的读者。
       v28（B2）：三种档位与 repairExposed 系数取自 Tiers.CAP（调用点不再出现裸数值）。 */
    const cr = (t.claimedRole && t.claimedRole !== 'crew') ? t.claimedRole
      : (t.revealed && t.revealed.role) || null;
    if (CAP.highRoles.indexOf(cr) >= 0) c = CAP.high;
    else if (CAP.midRoles.indexOf(cr) >= 0) c = CAP.mid;
    else if (CAP.lowRoles.indexOf(cr) >= 0) c = CAP.low;
    if (t.repairExposed) c = Math.max(c, CAP.repairExposed);
    return c;
  }

  function addEvent(g, viewerId, targetId, delta, grudge, src, kind, tier, speakerId, chan, expert) {
    const v = byId(g, viewerId);
    /* v32 机制对等（用户拍板「玩家在时机制不生效、人机占位生效」）：移除 isHuman 排除——
       玩家席位与 AI 席位同权持有证据台账（tEvents）。makePlayer 对全员初始化了
       tEvents/evidence/hardFloor/cred，此前只是被这里的守卫整体废掉。
       玩家台账经 UI「账本」页消费（与 AI 同一份资产，不是摆设）。 */
    if (!v || v.out) return;
    if (!v.tEvents.has(targetId)) v.tEvents.set(targetId, []);
    /* 改动 #4 + v21 审查 #2/#6 + v22 批次 2：事件携带 sourceId（并罚单元 = 独立信息源）、
       kind（claim 衰减 / fact 不衰减）、tier（档位字符串，废数值反查）、speakerId
       （C 的取值主体）、chan（通道显式指向）、expert（产出专家，E8 置信上限判定用）。
       E 只增不减：负值在投影时写入反向通道（§4.1.3），日志保留原符号以维持 R31 记仇对账。 */
    v.tEvents.get(targetId).push({ night: g.night, delta, grudge: !!grudge, src: src || null, kind: kind || 'claim', tier: tier || null, spk: speakerId || null, chan: chan || null, exp: expert || null });
  }

  /* 幂等键：reason() 在一局内被多次调用（讨论收束 / 步骤 9 / 会议），
     推理链事件必须每「事件实例」只入账一次，否则威胁度线性通胀 */
  function once(g, key) {
    if (!g.reasonKeys) g.reasonKeys = new Set();
    if (g.reasonKeys.has(key)) return false;
    g.reasonKeys.add(key);
    return true;
  }
  global.AIBelief = {
    ROLE2FACTION, FACTION_SET, CLAIM_DECAY, GRUDGE_DECAY, DG_W, TIER_BY_VAL, priorOf, ensureE, actF, claimDecay, credOf, credAdd, setHardFloor, chanFor, knownLockOf, project, addUniversal, universalOf, hostileOf, suspOf, suspDist, dangerOf, capability, addEvent, once,
  };
})(typeof window !== 'undefined' ? window : globalThis);
