/* =============================================================
 * 太空杀 · 粒子云信念模块（v4.0 批次 17a→17b 前置 · 与旧累加器 belief.js 并存）
 *
 * 设计依据：《改造清单_v4.0_最终版.md》§3-B1 + 《防指标博弈治理规范.md》
 *          + 《第十七批17a粒子云_审查结论.docx》P1 缺陷修复 + 《17b动工前指导清单.docx》D1/D2/D6。
 * 状态形态：每个（观察者, 目标）一朵云 = Dirichlet 参数 (α_human, α_alien, α_xeno)，
 * 以「均值 m（阵营单纯形）× 浓度 c（等效样本数）」参数化 —— α = c·m。
 *   · 铁证（官方揭示/硬源）→ collapse：均值坍缩向该阵营、浓度升至 C_LOCK ⇒ 方差→0（H22）
 *   · 排除式证据 → excludeFaction：被排除分量恒 0，其余按 prior 重分配（N404「非人类」=
 *     alien ∪ xeno 的正确表达；与单点坍缩分开标记 lockedExclude / locked，17b 指导清单 D2）
 *   · 偶然证据（低可靠 claim）→ absorb：均值完全不动 + 浓度下降（方差注入）⇒ 只扩散不位移（H23）
 *   · 每夜扩散核 → diffuseNight / stepToNight：浓度衰减 + 向先验回归 = 自然遗忘（官方揭示不遗忘）
 *   · 遗忘时钟（审查 P1·4 修复）：云自带时钟 n，stepToNight/fromEvents({nowNight}) 由
 *     【游戏时钟】驱动遗忘——旧版只按证据时间戳扩散，「第 1 夜有证据、之后无证据」的目标
 *     永不遗忘（c 停在初值），浓度失真 52%。17b 指导清单 B2/D1。
 *   · 敌对度下限 → floor(cloud, v)：hardFloor（R30 假冒/R7 假标记，belief.js setHardFloor）
 *     的语义是【怀疑度数值下限】（suspOf: s = max(s, fl.v)），不带阵营——云侧以 fl 字段
 *     同语义对齐（max 钳制），不是 excludeFaction（那是阵营排除，两回事）。
 *   · 决策采样 → sample：仅当叙事势均力敌时调用（批次 20 叙事层；H35 采样克制），
 *     17a/17b 前置阶段不进入任何运行时决策路径 —— 本模块与旧 belief 并存，零接线。
 *
 * 并存与回退（治理规范 §2）：本模块为新增文件，不修改任何既有运行时行为；
 * SK_CLOUD 开关在 17b 接线时启用，SK_CLOUD=0 可整批回退旧累加器。
 *
 * 先验对齐：初始 α₀ 直接取 Tiers.PRIOR_E（humanViewer {7.14, 2.14, 0.71} 等，
 * 和恰为 10 ⇒ c₀=10），与 v4.0 清单 B1 的数值逐项一致，不另设第二份先验表。
 * ============================================================= */
(function (global) {
  const KEYS = ['human', 'alien', 'xeno'];

  /* ---- 常数及依据（17b 指导清单 D6：每条注明 规则条款号 / 机制论证 / 实测编号 三者之一；
     全部常数为可标定项，批次 23 标定时使用独立标定种子集，禁止用 AUC/胜率反推——治理规范铁律一、硬约束 4 ---- */
  const CONST = {
    /* C0=10 —— 实测依据：PRIOR_E 各行分量和恰为 10（humanViewer 100/14+30/14+10/14）。
       先验等效样本数 = 既有证据表的初始刻度，非自由参数。 */
    C0: 10,
    /* C_LOCK=60 —— 机制论证：正文 4.7.5② 定性分层「神探公告属系统发布，但神探本人亦可能被骗」
       ——官方揭示以呈现职业为准、非绝对真理。c=60 时 exclude 重分配后的剩余分量
       sd=√(m(1−m)/61)≈5.5%（m=0.75 时），为「官方背书第二档仍可被骗」保留质量裕度；
       单点 collapse 的 sd 恒 0（oneHot），C_LOCK 只约束 exclude 后与后续算子的确定度上限。 */
    C_LOCK: 60,
    /* C_DECAY=0.9 —— 机制论证：遗忘应慢于宣称衰减（旧累加器 CLAIM_DECAY=0.85/夜，§4.3，
       衰减对象=证据强度；云衰减对象=确定性）。0.9/夜 ⇒ 浓度半衰期 6.6 夜，覆盖典型局
       7.4 夜的大半，与「7±2 信息处理」的拟人约束相容（人不会一夜忘掉上周的判断）。 */
    C_DECAY: 0.9,
    /* PRIOR_REG=0.05 —— 机制论证：单夜均值向先验回归 ≤5% ⇒ 平滑回归一夜不可翻转主叙事
       （H34 顿悟只能由证伪跳变产生，不能由回归产生）；14 夜回到先验一半，慢于典型局长。 */
    PRIOR_REG: 0.05,
    /* W_CAP=0.35 —— 机制论证：单条证据效应封顶，对应正文 7.1.3 最小必要可见性下
       「单次观测不足以定案」——最强单条（rel≈0.95）位移后目标仍保有 ≥0.6 的其余阵营质量；
       亦与正文 2.5.2「单次出手效果有限」的额度制精神同构。 */
    W_CAP: 0.35,
    /* K_SAT=30 —— 量纲适配：Tiers.SCORE 档位值域中档（A 档 ≈2/3 饱和、C 档 ≈1/3 饱和），
       使 rel×sat 合成后各档位保有分辨率；具体标定待批次 23（独立标定种子集）。 */
    K_SAT: 30,
    /* VAR_INJECT=0.06 —— 实测编号依据：H23 判据（清单 §7「方差显著 ↑」=sd 增幅 >20%）
       ⇒ 10 条 D 档需 c×0.94^10≈0.54，单条注入 6%。依据来源=清单断言，非 AUC。 */
    VAR_INJECT: 0.06,
    /* GAIN=0.12 —— 机制论证：与 C_DECAY 对偶。单条强证据浓度增量 ≤ +4.2%（0.35×0.12），
       一条 A 档 ≈ 抵 2.4 夜自然遗忘（10%/夜）——新证据抑制遗忘但不冻结遗忘。 */
    GAIN: 0.12,
    /* REL_NUDGE=0.3 —— 规则依据：清单 §1.2「偶然证据→中心不动」二分 + TIER_REL 的 C 档(0.4)
       与 D 档(0.15) 之间的间隙中点 —— 偶然/可靠的分界落在 C/D 档之间。 */
    REL_NUDGE: 0.3,
    /* TIER_REL 全表 —— 规则依据：正文 4.7.5 定性分层四档（结算数据类保真 > 神探公告可被骗 >
       窃听报告可改写 > 玩家发言不保真）与 7.2「最小可判定结论」。排序对齐该分层，
       数值为档位间距均匀刻度的占位；批次 18 的 Claim 自带 rel 字段（B2）就绪后本表退役。 */
    TIER_REL: { A: 0.9, 'A-': 0.85, 'B+': 0.75, B: 0.7, 'B-': 0.6, 'C+': 0.5, C: 0.4, 'C-': 0.3, 'D+': 0.2, D: 0.15, 'D-': 0.1, F: 0.05, P: 0.95, Z: 0 },
  };
  const { C0, C_LOCK, C_DECAY, PRIOR_REG, W_CAP, K_SAT, VAR_INJECT, GAIN, REL_NUDGE, TIER_REL } = CONST;

  const T = () => global.Tiers;
  const D = () => global.SKData;

  /** 初始均值向量（按观察者阵营取 Tiers.PRIOR_E 对应行，逐项对齐既有先验） */
  function priorMean(viewerFaction) {
    const PE = T().PRIOR_E;
    const row = viewerFaction === 'human' ? PE.humanViewer
      : viewerFaction === 'xeno' ? PE.xenoViewer
      : PE.alienVsOther;                                  // 异形对非队友（队友走 collapse 硬锁）
    return KEYS.map(k => (row[k] || 0));
  }

  /** 新建一朵云：{ m, c, prior, locked, lockedExclude, excluded, fl, n }
   *  n = 云的时钟（已演化到的游戏夜，遗忘由它驱动——审查 P1·4 修复） */
  function init(viewerFaction) {
    const p = priorMean(viewerFaction);
    const sum = p.reduce((a, b) => a + b, 0) || 1;
    const m = p.map(x => x / sum);
    return { m, c: sum || C0, prior: m.slice(), locked: false, lockedExclude: false, excluded: [], fl: 0, n: 0 };
  }

  /** 单纯形投影：被排除分量恒 0，其余归一（无剩余质量时退回先验剔除被排除项） */
  function normalize(cloud) {
    const m = cloud.m.map((x, i) => (cloud.excluded.indexOf(KEYS[i]) >= 0 ? 0 : Math.max(0, x)));
    let s = 0;
    for (const x of m) s += x;
    if (s <= 0) {
      const pr = cloud.prior.map((x, i) => (cloud.excluded.indexOf(KEYS[i]) >= 0 ? 0 : x));
      const ps = pr.reduce((a, b) => a + b, 0) || 1;
      cloud.m = pr.map(x => x / ps);
    } else cloud.m = m.map(x => x / s);
    return cloud;
  }

  /** 铁证坍缩（H22）：官方揭示/硬源 —— 均值 oneHot、浓度 C_LOCK、锁定（不再遗忘） */
  function collapse(cloud, faction) {
    cloud.m = KEYS.map(k => (k === faction ? 1 : 0));
    cloud.c = C_LOCK;
    cloud.locked = true;
    return cloud;
  }

  /** 排除式证据原语（17b 指导清单 D2）：hardFloor/N404「非人类」的阵营排除语义——
   *  被排除分量置 0，其余分量按【prior 重分配】（不是均匀、不是归一残留）。
   *  语义裁定（依据 4.10.3 已发生状态不回滚）：排除一经置位不可撤销（lockedExclude），
   *  但与单点坍缩 locked 分开标记——排除后剩余两轴仍可被后续证据移动（hardFloor 是
   *  「下限」语义：软证据可把怀疑度抬得更高，不可拉回），单点坍缩则完全冻结。 */
  function excludeFaction(cloud, faction) {
    if (cloud.excluded.indexOf(faction) < 0) cloud.excluded.push(faction);
    cloud.lockedExclude = true;
    const i = KEYS.indexOf(faction);
    if (i >= 0) cloud.m[i] = 0;
    normalize(cloud);
    return cloud;
  }

  /** 敌对度下限（hardFloor 对齐，D5）：v ∈ [0,100] 与 belief.hardFloor.v 同刻度 */
  function floor(cloud, v) {
    cloud.fl = Math.max(cloud.fl, v);
    return cloud;
  }

  /** 单条证据的可靠度（批次 18 前：按档位映射占位；Claim 自带 rel 后改读 ev.rel） */
  function relOf(ev) {
    if (typeof ev.rel === 'number') return Math.max(0, Math.min(1, ev.rel));
    return TIER_REL[ev.tier] != null ? TIER_REL[ev.tier] : 0.3;
  }

  /** 偶然/普通证据吸收（清单 §1.2 明文：「偶然证据 → 小权重 + 方差注入 ⇒ 扩散，中心不动」）：
   *  · 低可靠（rel < REL_NUDGE，D/F 档）：均值完全不动，只做方差注入（浓度下降）；
   *  · 可靠证据：位移 w = rel × |delta|/(|delta|+K_SAT)（饱和封顶），沿 delta 符号方向在
   *    human↔alien 两轴移动（与旧 E 通道 chanFor 同构）；被排除阵营不接收位移；
   *    浓度 c += w·c·GAIN（更确定），低可靠另乘方差注入。
   *  locked 云不受 claim 影响（官方揭示不可撤销，4.10.3）。 */
  function absorb(cloud, ev) {
    if (cloud.locked) return cloud;
    const rel = relOf(ev);
    if (rel <= 0) return cloud;
    const mag = Math.min(Math.abs(ev.delta || 0), 200);
    if (rel >= REL_NUDGE) {
      const w = Math.min(W_CAP, rel * (mag / (mag + K_SAT)));
      if (w > 0) {
        const dir = (ev.delta || 0) >= 0 ? 'alien' : 'human';   // 与 belief.chanFor 同构：正=敌对方向
        if (cloud.excluded.indexOf(dir) < 0) {
          const i = KEYS.indexOf(dir);
          cloud.m[i] += w;
          normalize(cloud);
        }
      }
      cloud.c = Math.min(C_LOCK, cloud.c * (1 + w * GAIN));
    }
    const inject = VAR_INJECT * (1 - rel);
    if (inject > 0) cloud.c = Math.max(0.5, cloud.c * (1 - inject));
    return cloud;
  }

  /** 一步扩散核：浓度衰减（方差回升）+ 向先验回归（自然遗忘）。
   *  locked 云不遗忘；lockedExclude 云仅剩余两轴回归（被排除项恒 0）。 */
  function diffuseNight(cloud) {
    if (cloud.locked) return cloud;
    cloud.c = Math.max(0.5, cloud.c * C_DECAY);
    for (let i = 0; i < KEYS.length; i++) {
      if (cloud.excluded.indexOf(KEYS[i]) >= 0) continue;
      cloud.m[i] = cloud.m[i] * (1 - PRIOR_REG) + cloud.prior[i] * PRIOR_REG;
    }
    normalize(cloud);
    return cloud;
  }

  /** 把云的时钟拨到 night（17b 指导清单 D1）：逐夜补扩散——遗忘由游戏时钟驱动，
   *  与「最后一条证据在第几夜」无关。 */
  function stepToNight(cloud, night) {
    while (cloud.n < night) { diffuseNight(cloud); cloud.n++; }
    return cloud;
  }

  /** 敌对度（0–100，量纲与旧 suspOf 一致）：hostileTo 集合求和 ×100，再钳 hardFloor 下限 */
  function hostile100(cloud, viewerFaction) {
    const F = D().FACTION[viewerFaction] || D().FACTION.human;
    const tbl = F.hostileTo || D().FACTION.human.hostileTo;
    let s = 0;
    KEYS.forEach((k, i) => { if (tbl.indexOf(k) >= 0) s += cloud.m[i]; });
    return Math.max(s * 100, cloud.fl || 0);
  }

  /** 云的矩：均值、各分量标准差 Var=m(1−m)/(c+1)、浓度 */
  function moments(cloud) {
    const sd = cloud.m.map(x => Math.sqrt(Math.max(0, x * (1 - x)) / (cloud.c + 1)));
    return { mean: cloud.m.slice(), sd, c: cloud.c };
  }

  /* ---- Dirichlet 采样（Marsaglia-Tsang Gamma；仅叙事势均力敌时由批次 20 调用） ---- */
  function gammaSample(a, rng) {
    if (a < 1) return gammaSample(a + 1, rng) * Math.pow(rng.next(), 1 / a);
    const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x, v;
      do { x = normal(rng); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = rng.next();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  function normal(rng) {                     // Box-Muller（消耗 2 个均匀数）
    let u1 = rng.next(), u2 = rng.next();
    if (u1 < 1e-12) u1 = 1e-12;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** 从云采样一个阵营分布样本（返回和为 1 的三分量）。rng 须提供 next()（独立随机流，
   *  禁止传 g.rng——采样会改变指纹随机序列，v4.0 清单 §9 风险表）。 */
  function sample(cloud, rng) {
    const xs = cloud.m.map(x => gammaSample(Math.max(1e-6, cloud.c * x), rng));
    const s = xs[0] + xs[1] + xs[2] || 1;
    return xs.map(x => x / s);
  }

  /** 便捷：采样出「阵营键」（按样本最大项） */
  function sampleFaction(cloud, rng) {
    const xs = sample(cloud, rng);
    let bi = 0;
    for (let i = 1; i < xs.length; i++) if (xs[i] > xs[bi]) bi = i;
    return KEYS[bi];
  }

  /** 两叙事是否势均力敌（批次 20 用；17a 供采样克制的判据原语）：最大两项均值差 < gap */
  function contested(cloud, gap) {
    const s = cloud.m.slice().sort((a, b) => b - a);
    return (s[0] - s[1]) < (gap == null ? 0.25 : gap);
  }

  /** 从旧 E 证据表构建云（批次 17b/19 接线用；接线前不进运行时）：
   *  opts.nowNight —— 游戏当前夜（D1）：重放结束后补扩散到该夜，「无新证据也遗忘」；
   *  证据可带 faction 字段（fact 类）：显式指明官方揭示指向的阵营（含 xeno——
   *  修复审查 §五「fromEvents 只按 delta 符号坍缩、无法到 xeno」的语义缺口）。 */
  function fromEvents(viewerFaction, evs, opts) {
    const cloud = init(viewerFaction);
    const sorted = (evs || []).slice().sort((a, b) => a.night - b.night);
    /* 〔第二十三批 · 审查 P4 整改〕时钟起点缺省取**首条证据的夜**，不再是 0。
       旧写法 n=0 时，若首条证据在第 1 夜，则吸收它之前会先 stepToNight(1) 扩散一次
       ⇒ 开局凭空先遗忘一夜（c: C0 → C0·C_DECAY，浓度基线系统性 −10%）。
       语义上「第 1 夜吸收第 1 夜的证据」不该先扩散。显式 given sinceNight 时仍从调用点取值。 */
    const firstNight = sorted.length ? sorted[0].night : 0;
    cloud.n = (opts && opts.sinceNight != null) ? opts.sinceNight : firstNight;
    for (const e of sorted) {
      if (e.night > cloud.n) stepToNight(cloud, e.night);        // 证据间的夜：时钟驱动遗忘
      if (e.kind === 'fact') collapse(cloud, e.faction || ((e.delta || 0) >= 0 ? 'alien' : 'human'));
      else absorb(cloud, e);
    }
    if (opts && opts.nowNight != null) stepToNight(cloud, Math.max(opts.nowNight, cloud.n));
    return cloud;
  }

  global.SKCloud = {
    KEYS, init, collapse, excludeFaction, floor, absorb, diffuseNight, stepToNight,
    hostile100, moments, sample, sampleFaction, contested, fromEvents, priorMean, CONST,
  };
})(typeof window !== 'undefined' ? window : globalThis);
