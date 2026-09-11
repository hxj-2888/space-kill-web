/* 推理库 MoE 架构（v22 方案落地：批次 1 + 2 + 4 + 批次 8 部分）
   13 专家 · Claim 单一插槽 · 三档仲裁 · 软路由 gate · 性格调制 · 饱和疲劳 · 重合度统计
   核心约束（§2.1）：专家不许直接写 E——全部专家只输出 Claim，由唯一仲裁器调用 addEvent 写入。
   并罚（sourceId 分组）、宣称衰减 ×0.85、(0.4+0.6C) 缩放、硬源覆盖四件事只有 ai.js 一份实现。 */
(function (global) {
  const T = global.Tiers;
  /* 档位序：三档仲裁的比较基准（A± > B± > C± > D± > F） */
  /* ============ 配置与专家注册表：已解耦至 js/infer/registry.js ============
     搬移原则：配置/专家定义进模块，运行时机制（route/仲裁/影子/执行器）留本文件。 */
  const REG = global.MoERegistry;
  const RANK = REG.RANK, EXPERTS = REG.EXPERTS, HARD_ROUTE = REG.HARD_ROUTE, RELEVANCE = REG.RELEVANCE;
  const GATES = REG.GATES, BASE_GATE = REG.BASE_GATE, THETA_BIAS = REG.THETA_BIAS, gateThreshold = REG.gateThreshold;

  /* ============ 重合度统计（v25 批次 2：C(n,2) 全两两 Jaccard，按事件分列）============
     同一 (事件, 夜, 步) 内【所有】观察者的激活集合两两求 |A∩B|/|A∪B|——
     旧实现只和「直接前驱」比一次（A2 缺陷：既非两两，96.6% 样本还全来自 reveal）。
     指标只统计不设靶（v25 §三）：不设健康区间、不进 gate、只进 mc_result.json。
     分叉的唯一合法来源 = gate 读到的真实状态差异 + θ 调制（v25 批次 1 已删 ID 哈希假分叉）。 */
  const stats = { events: 0, pairSum: 0, pairs: 0, actSum: 0, byEvt: {},
                 arb: { n: 0, multi: 0, same: 0, gap1: 0, gap2: 0 },          // v25 指标组 B
                 /* v25 指标组 C；v27 增 n/nonzero/min/max/_sample（A1 修复后才有意义） */
                 shadow: { calls: 0, applied: 0, n: 0, nonzero: 0, min: null, max: null, _sample: [] },
                 /* v32 批 4′（统一入账口）：四类写入路径改道计数仪器（只观测不设靶）。
                    reason = ②R 规则链（perceive）· speak = ①发言/宣称（pipeline）·
                    announce = ③公告清算（announce/steps）· chan / chanUniv = ④通道门禁（channels.run） */
                 rerouted: { reason: 0, speak: 0, announce: 0, chan: 0, chanUniv: 0, private: 0 },
                 /* v32 批 5′：被 ATTEND 调制（权重 ≠ 1）的写入条数（只观测不设靶） */
                 attended: 0 };

  function route(g, evt, self) {
    const hard = HARD_ROUTE[evt] || [];
    const rel = RELEVANCE[evt] || {};
    const active = [];
    for (const id of Object.keys(EXPERTS)) {
      if (id === 'E13') continue;                       // E13 = 第二遍运行标记，不参与正向路由
      if (hard.includes(id)) { active.push(id); continue; }
      if (EXPERTS[id].constant) { active.push(id); continue; }
      const gate = GATES[id];
      let score = gate ? gate(g, self, { evt })
        : (rel[id] != null ? rel[id] : (EXPERTS[id].relevance != null ? EXPERTS[id].relevance : 0.15));
      /* v25 批次 1：已删除 ID 哈希微扰（A1 缺陷：用座位号制造「个体差异」是假分叉，
         注释原文「让重合度脱离 1.0」属于先射箭再画靶）。个体激活差异现在只来自
         ① gate 的真实状态差异（随批次 6 逐条接线而增长）② θ 阈值调制（E7/E8/E9/E10）。
         重合度若因此变成 1.0，那就是当前架构的真实读数——修 gate，不是修指标。 */
      const th = gateThreshold(id, self);
      if (score >= th) active.push(id);
    }
    /* 统计：同一 (evt,night,step) 内全部观察者激活集合的 C(n,2) 两两重合度（v25 批次 2） */
    if (g && g.players) {
      stats.events++; stats.actSum += active.length;
      const rec = stats.byEvt[evt] = stats.byEvt[evt] || { pairs: 0, sum: 0 };
      g._moeRouteSets = g._moeRouteSets || {};
      const key = evt + ':' + g.night + ':' + g.step;
      const sets = g._moeRouteSets[key] = g._moeRouteSets[key] || [];
      for (const prev of sets) {
        const inter = prev.filter(x => active.includes(x)).length;
        const union = new Set(prev.concat(active)).size;
        const j = union ? inter / union : 1;
        stats.pairSum += j; stats.pairs++;
        rec.pairs++; rec.sum += j;
      }
      sets.push(active);
    }
    return active;
  }

  /* ============ 饱和疲劳（§9）：inc = base / (1 + λ × recentActivations)，跨事件恢复 ============
     按（观察者 × 专家 × target × 夜）计数——饱和针对「同一专家对同一目标的反复入账」
     （批次 5 通道灌入后的钻牛角尖防护）；不同 target 之间互不挤压，跨夜自然恢复。
     v25 批次 3：已删除「行为不变由此保证」的短路设计（B 类缺陷：迁移事件被人为限成
     每 (viewer,target) 一条、饱和恒不介入——为过验收而让机制成为死代码）。
     现在饱和对【所有】仲裁生效：首条入账 sat=1（数学上自然无衰减），同一夜同一
     (viewer,expert,target) 的后续 Claim 才被压缩——机制在不在场由 arb_multi_rate 直接可见。 */
  const SAT_LAMBDA = 0.5;
  function saturation(g, viewerId, expert, target) {
    if (!g._moeSat) g._moeSat = new Map();
    const key = viewerId + ':' + expert + ':' + target + ':' + g.night;
    const n = g._moeSat.get(key) || 0;
    g._moeSat.set(key, n + 1);
    return 1 / (1 + SAT_LAMBDA * n);
  }

  /* ============ 仲裁器（§5 三档规则，不取平均）============
     同一 target 上收集全部 Claim，按档位排序，取最高两档：
     同档（A vs A）  → 保留分歧，两者都入账；语言只出陈述句，不下结论
     差一档（A vs B） → 取 A，B 降权 ×0.5 入账；语气降级
     差两档（A vs C） → 取 A，C 进待验证队列：提升该 target 的查验优先级，不公开表达
     仲裁器输出的不只是选哪个值，还有怎么说话（speak 字段随 Claim 供语言库消费）。 */
  function arbitrate(g, viewerId, claims, opts) {
    const AI = global.AI;
    if (!AI || !claims || !claims.length) return;
    /* v32 批 4′（统一入账口）：直通模式 —— 逐条写入、不裁剪、不饱和（饱和系数恒 1）、
       fold 关闭、queueVerify 只记录不消费。原因：四类改道路径现状是「每条事件都写」，
       若 4′ 就打开三档裁剪，写入集合改变 ⇒ 指纹必变 ⇒ 验收必挂（交接文档 §6 批 4′）。
       裁剪在批 8′ 打开：届时直通分支整体下线，所有路径统一走下方三档仲裁。 */
    if (opts && opts.passthrough) {
      for (const c of claims) {
        if (c.target == null) continue;
        writeRaw(g, viewerId, c);
      }
      return;
    }
    const byTarget = new Map();
    for (const c of claims) {
      if (c.target == null) continue;
      if (!byTarget.has(c.target)) byTarget.set(c.target, []);
      byTarget.get(c.target).push(c);
    }
    /* v31 批 1（B4）：档位比较前先按【本观察者】解析——tier 可能是视角依赖声明对象 */
    const viewer = AI.byId(g, viewerId);
    const rank = c => RANK[(T && T.tierFor ? T.tierFor(c.tier, viewer) : c.tier)] || 0;
    for (const [target, cs] of byTarget) {
      cs.sort((x, y) => rank(y) - rank(x));
      const top = cs[0];
      /* v25 指标组 B：仲裁输入分布（arb_input_size / arb_multi_rate / arb_tier），只统计不设靶 */
      stats.arb.n++;
      if (cs.length > 1) stats.arb.multi++;
      /* v25 批次 3：饱和疲劳对【所有】仲裁恒在（首条自然 sat=1，见上注释） */
      const sat = saturation(g, viewerId, top.expert, target);
      write(g, viewerId, top, sat);
      if (cs.length > 1) {
        const second = cs[1];
        const gap = rank(top) - rank(second);
        if (gap <= 0) { write(g, viewerId, second, 1); stats.arb.same++; }        // 同档：保留分歧
        else if (gap === 1) { write(g, viewerId, second, 0.5); stats.arb.gap1++; } // 差一档：降权入账
        else { queueVerify(g, viewerId, target, second); stats.arb.gap2++; }       // 差两档：待验证队列
      }
      /* 同档保留分歧的语言表现：标记给语言库（speak 字段消费，本批次仅入台账）。
       * v32 语义收窄：不按 isHuman gate——真人席位同样记录（数据同构；真人发言不走
       * 仲裁 speak 消费，挂着无害），规则层从此不读决策来源。 */
      if (cs.length > 1 && rank(top) - rank(cs[1]) === 0) {
        const o = global.AI && global.AI.byId(g, viewerId);
        if (o) {
          if (!o.tiedClaims) o.tiedClaims = [];
          o.tiedClaims.push({ night: g.night, target, tiers: [top.tier, cs[1].tier], speak: [top.speak, cs[1].speak] });
        }
      }
    }
  }
  function write(g, viewerId, c, weight) {
    const AI = global.AI;
    if (!AI) return;
    /* v25 批次 4（D1 修复·架构红线）：增量【幅度】唯一来源 = T.SCORE[tier]——
       旧写法 delta 优先于 tier，11 条 EXEC 通道里 9 条 delta 与 SCORE 不符（N04 甚至方向相反），
       完全脱离档位体系（并罚 / C 缩放 / 衰减算的是与档位表无关的数）。
       delta 现在只承载【方向】（负值 = 信任类证据，投影时写反向通道 §4.1.3），
       不再承载幅度；mult 仅 reserved 给总表【明示】的系数（如 R17「B+ × 阶段系数」）。
       「某条通道需要特殊权重」的唯一合法做法仍是改档位定义（v24 红线原文）。 */
    /* v31 批 1（B4）：档位按【本观察者】解析——c.tier 可以是字符串，也可以是
       { def, byRole, byFaction }（视角依赖档，定案 9）。幅度仍唯一来自 SCORE 表。 */
    const viewer = AI.byId(g, viewerId);
    const tierKey = T && T.tierFor ? T.tierFor(c.tier, viewer) : c.tier;
    const mag = (T && T.SCORE[tierKey] != null ? T.SCORE[tierKey] : 0) * (c.mult || 1);
    const sgn = c.delta != null && c.delta < 0 ? -1 : 1;
    const base = mag * sgn;
    const delta = weight === 1 ? base : base * weight;
    AI.addEvent(g, viewerId, c.target, delta, c.grudge, c.src, c.kind, tierKey, c.speakerId, c.chan, c.expert);
  }
  /* v32 批 4′：直通写入（改道不改值）—— 调用点原值逐字段透传（delta / tier / src / grudge /
     kind / speakerId / chan / expert 全部保持原样），不走 write() 的「幅度 = SCORE[tierFor] × mult」
     重算。原因：部分改道调用点的 delta 不是裸 SCORE[tier]（如 R38 自证的 −round((v−bias)×half)、
     R31 记仇的 min(base, 25−sum)、私聊的 ×(0.4+0.6C) 缩放、promiseMiss 的 PV.miss 表），
     4′ 的验收是「指纹逐字节不变」，幅度与档位表的对账（收编进 mult 或改档位定义）留给 8′。 */
  function writeRaw(g, viewerId, c) {
    const AI = global.AI;
    if (!AI) return;
    AI.addEvent(g, viewerId, c.target, c.delta, c.grudge, c.src, c.kind, c.tier, c.speakerId, c.chan, c.expert);
  }
  /* ============ v32 批 4′：统一入账口 ============
     四类写入路径（①发言宣称 pipeline · ②R 规则链 perceive · ③公告清算 announce/steps ·
     ④通道门禁 channels.run）全部改道本入口：计数 → （可选）route 求值 → arbitrate 直通写入。
     与 emit 的分工：emit 是「Claim 产出 → 路由 → 裁剪仲裁」的正向管线（onExpose/onReveal 在用）；
     absorb 是「既有直接 addEvent 调用点的收口」——本批只完成「统一入口 + 计数」，行为逐字节等价。
     opts.path：改道计数分组（rerouted 仪器）；opts.route + opts.evt：让本批事件参与 route 求值
     （仅通道路径开启——验收「chan 求值/命中计数应变化」；其余路径的 route 评估依赖 5′ 的
     角色注意力维度，开启会改写入集合语义，留到 5′/7′）。 */
  function absorb(g, viewerId, claims, opts) {
    if (!claims || !claims.length) return;
    const self = global.AI && global.AI.byId(g, viewerId);
    if (!self || self.out) return;                        // v32 机制对等：isHuman 排除移除（玩家同权入账）
    const path = (opts && opts.path) || 'other';
    stats.rerouted[path] = (stats.rerouted[path] || 0) + claims.length;
    if (opts && opts.route) route(g, opts.evt || path, self);
    /* v32 批 5′（角色注意力）：写入侧连续权重（方案 §3.2 ★ 注意力必须在写入侧）——
       按「观察者挂载的角色专家 × 事件族」乘 Tiers.ATTEND 权重（连续、乘性、非硬阈值，红线 1）。
       opts.evt 缺省（未归族事件）= def 1，行为不变。通道路径不传 evt（7′ 二维绑定时一次到位）。
       与批 4′「原值透传」的关系：4′ 验收是指纹不变故原值直通；5′ 是方案明文的第一个
       改变写入幅度的批次（验收 = 指纹会变 + 分叉度上升），ATTEND 是幅度的新维度
       （正交于档位表：档位 = 方法维度「怎么解读」，ATTEND = 视角维度「要不要进账」）。 */
    const w = (opts && opts.evt && T) ? T.attend(self.roleExpert != null ? self.roleExpert : self.role, opts.evt) : 1;
    if (w !== 1) {
      claims = claims.map(c => Object.assign({}, c, { delta: (c.delta || 0) * w }));
      stats.attended = (stats.attended || 0) + claims.length;
    }
    arbitrate(g, viewerId, claims, { passthrough: true });
  }
  /* ============ v32 批 5′：私有源入账器（单人私有流水）============
     方案 §3.3 / §4.1：「私有源 = 分叉度的全部来源」「该角色必入账（红线 3 豁免）」。
     角色绑定的感知事件只写【该角色本人】的 tEvents —— src 前缀 own:<Role>:<what>:<night>
     保证 ① 并罚单元独立（project() 按源分组）② 分叉度仪器识别为单人私有。
     批 5′ 的流水 delta 占位 0：幅度唯一来源 = 档位表（红线），量级接管留 7′ 接线/标定——
     先让流水存在（「不入账 = 流水不存在」的反面：入账了才有资格被后续批解读）。
     delta=0 对估值层（project/suspOf/dangerOf）无影响 ⇒ 本批除 ATTEND 调制外行为中性。 */
  function absorbPrivate(g, viewerId, target, src, kind, tier) {
    const self = global.AI && global.AI.byId(g, viewerId);
    if (!self || self.out) return;
    stats.rerouted.private = (stats.rerouted.private || 0) + 1;
    const AI = global.AI;
    if (AI && AI.addEvent) AI.addEvent(g, viewerId, target, 0, false, src, kind || 'fact', tier || null, viewerId, null, null);
  }
  /* 普适层收口（N406 等证群体不证个体的通道）：addUniversal 不走 tEvents，
     无仲裁语义 —— 只计数 + 透传（交接文档 §6 对账点 1 的例外项）。 */
  function absorbUniversal(g, viewerId, delta, tier, src, kind, expert) {
    stats.rerouted.chanUniv = (stats.rerouted.chanUniv || 0) + 1;
    const AI = global.AI;
    if (AI && AI.addUniversal) AI.addUniversal(g, viewerId, delta, tier, src, kind, expert);
  }
  /* 待验证队列：提升查验优先级（ai.js 查验目标选择消费），不公开表达 */
  function queueVerify(g, viewerId, target, c) {
    const o = global.AI && global.AI.byId(g, viewerId);
    /* v32 语义收窄：真人席位同样记录（verifyQueue 是待验证清单的数据结构；真人查验目标
       由本人决策，队列挂着不被消费——同构，新增写入通道无需记得跳过真人）。 */
    if (!o) return;
    if (!o.verifyQueue) o.verifyQueue = [];
    if (!o.verifyQueue.some(v => v.target === target)) o.verifyQueue.push({ target, tier: c.tier, night: g.night, speak: c.speak });
  }

  /* ============ 对外入口：emit = 路由 + 仲裁 ============
     claims 数组经激活专家过滤后进仲裁器；E13 标记的影子 Claim 直接放行（第二遍产出） */
  function emit(g, evt, viewerId, claims) {
    if (!claims || !claims.length) return;
    const self = global.AI && global.AI.byId(g, viewerId);
    if (!self || self.out) return;                        // v32 机制对等：isHuman 排除移除
    const active = route(g, evt, self);
    const kept = claims.filter(c => c.expert === 'E13' || active.includes(c.expert));
    arbitrate(g, viewerId, kept);
  }

  /* ============ 影子层机制（§2.2，批次 6 的机器部分）============
     同一批专家跑第二遍，只换输入：正向 expert.run(evt, self=自己)，影子 expert.run(evt, self=j)。
     Risk(陈述) = project(说出后) 的 p_alien(i) 增量 − project(说出前)。
     产出标 origin='shadow'，权重 ×SHADOW_FACTOR（tiers.js，待标定）。 */
  function shadowRisk(g, selfId, claim) {
    const AI = global.AI;
    if (!AI || !T) return 0;
    const self = AI.byId(g, selfId);
    /* v27 修复（A1）：IR.mk 产出的是 targets[]，没有 target 单数字段——
       旧守卫读 claim.target（恒 undefined）→ 1536/1536 次调用全部返回 0，
       影子层在结构上是死代码（指标组 C 的 calls>0 而 applied 恒 0 由此而来）。
       目标解析统一走 tid，缺失才返回 0。 */
    if (!self || !claim) return 0;
    const tid = claim.target != null ? claim.target : (claim.targets && claim.targets[0]);
    if (tid == null) return 0;
    const before = AI.suspDist(g, self, tid);
    const sf = T.SHADOW_FACTOR != null ? T.SHADOW_FACTOR : 0.5;
    /* 模拟「说出后」：把 Claim 以影子权重写入（SCORE[tier] × SHADOW_FACTOR，v25 批次 4 同口径），算完即回滚。
       注意必须先确保 tEvents 里存在该 target 的槽位：project() 只读 p.tEvents.get(id)，
       对着一个「尚无任何证据」的目标探针时，临时数组不进 Map → 前后读数恒等 → 又静默返回 0。 */
    if (!self.tEvents) self.tEvents = new Map();
    if (!self.tEvents.has(tid)) self.tEvents.set(tid, []);
    const evs = self.tEvents.get(tid);
    const probe = { night: g.night, delta: (T.SCORE[claim.tier] || 0) * sf, grudge: false, src: 'shadow-probe', kind: claim.kind || 'claim', tier: claim.tier || null, spk: selfId, chan: claim.chan || null, exp: 'E13' };
    evs.push(probe);
    let after;
    try { after = AI.suspDist(g, self, tid); } finally { evs.pop(); }
    /* v27：返回值分布入 stats（C1 仪器三件套之二）——修 A1 之前这里恒 0，
       任何关于影子层量级的讨论都是空谈；分布让「标定对象是否存在」可验证。 */
    const inc = after.p_alien - before.p_alien;
    statsShadow(inc);
    return inc;
  }
  /* 影子返回值分布：n / 非零数 / min / max / 有界样本（p50·p90，只观测不设靶）。
     样本上限 20000 条——500 局 × 每次 2 探针，全量存会撑爆内存。 */
  const SHADOW_SAMPLE_CAP = 20000;
  function statsShadow(v) {
    const s = stats.shadow;
    s.n = (s.n || 0) + 1;
    if (v !== 0) s.nonzero = (s.nonzero || 0) + 1;
    if (s.min == null || v < s.min) s.min = v;
    if (s.max == null || v > s.max) s.max = v;
    (s._sample = s._sample || []).length < SHADOW_SAMPLE_CAP && s._sample.push(v);
  }
  /** 影子返回值分布摘要（供 mc / 文档读取；样本不足时按样本算） */
  function shadowSummary() {
    const s = stats.shadow;
    const a = (s._sample || []).slice().sort((x, y) => x - y);
    const q = k => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * k))] : null);
    return {
      calls: s.calls, applied: s.applied, n: s.n || 0, nonzero: s.nonzero || 0,
      min: s.min != null ? +s.min.toFixed(6) : null,
      p50: q(0.5) != null ? +q(0.5).toFixed(6) : null,
      p90: q(0.9) != null ? +q(0.9).toFixed(6) : null,
      max: s.max != null ? +s.max.toFixed(6) : null,
    };
  }

  /* ============ 通道执行器（v25 批次 6：注册表驱动 + gate 框架）============
     架构：GATE_IMPL[id] = { expert, gate(g,p), targetOf?(g,p), universal?, kind? }。
     执行时【遍历 Channels.CHANNELS（499 条总表）】——档位 tier 一律取总表条目
     （红线：某条通道需要特殊权重 → 改总表档位定义，不加权重字段）。
     未注册 gate 的通道保持 dormant（可追溯资产 + 工作清单），逐条接线让
     chan_wired 单调上升（v25 验收口径：只观测单调性，不设目标值）。 */
  /* ============ 通道门禁表 + 执行器：已解耦至 js/infer/channels.run.js ============
     该文件在加载末尾 Object.assign(global.MoE, { GATE_IMPL, runChannelsAll, wiredCount,
     unmounted, mountedIds })，因此 MoE.* 的对外接口与调用点保持零改动。 */

  global.MoE = {
    EXPERTS, HARD_ROUTE, RELEVANCE, RANK,
    route, arbitrate, emit, absorb, absorbPrivate, absorbUniversal, writeRaw, shadowRisk, stats, shadowSummary,
    claim: c => c,     // Claim 工厂：保持字段显式
  };
  /* 门禁面（GATE_IMPL / runChannelsAll / wiredCount / unmounted / mountedIds）
     由 js/infer/channels.run.js 在加载末尾 Object.assign 挂回本对象。 */
})(typeof window !== 'undefined' ? window : globalThis);
