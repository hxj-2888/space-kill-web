/* =============================================================
 * 太空杀 · 强度轴声明（v6.6 重构 K2「强度维度可加」· 阶段 2 声明层）
 *
 * 职责：把「性格轴 θ」的**档位与每档参数**从散落 8 个文件的手写字面量收进一处声明，
 *       并给未知档位一个**声明缺省**——于是「新增一档性格」不再需要在消费点逐个补表，
 *       也不会落成 undefined/NaN（K2 的验收口径：新增强度维度后消费点 diff 为空）。
 *
 * 规则与方案依据：
 *   · 方案 §2「西塔三档」：25 激进 / 50 中性 / 75 保守；开局 roll 一次、整局不变
 *   · 清单 K2：连续值非档位枚举；新增强度维度不改引擎
 *   · v21 改动 #6：性格只经「阈值 + 容忍」两条路径传导，不调制客观量（τ 固定）
 *   · 各参数的数值来源逐条标注（迁移前所在文件与行），迁移为**纯结构改造**：
 *     已知档（25/50/75）取值逐项不变，仅未知档从 undefined 变为声明缺省。
 *
 * 消费纪律（与 D6 能力标签同制）：
 *   调用点写 `TR.traitOf(p).<参数名>` 或 `TR.traitValue('theta', '<参数名>', θ)`，
 *   **不得再写 `{25:…,50:…,75:…}[θ]` 形式的档位表**（回归断言强制，棘轮 → 零）。
 * ============================================================= */
(function (global) {
  /* 每档参数表：表必须齐备全部档位（audit 强制，防「漏一档 → 该档 undefined」） */
  const AXES = {
    theta: {
      id: 'theta',
      name: '性格（风险偏好）',
      rule: '方案 §2 西塔三档 / 清单 K2',
      keys: [25, 50, 75],
      /* 开局抽样分布（迁移前 state.js:128 `r < 0.15 ? 25 : r < 0.85 ? 50 : 75`）：
         用「累计下界 → 档位」声明，抽样只消耗**一次** rng.next()，与迁移前逐位等价。
         新增一档性格时只改这里（含其出现权重），消费点零改动 —— 这是 K2 的完整形态。 */
      roll: [{ value: 25, upto: 0.15 }, { value: 50, upto: 0.85 }, { value: 75, upto: 1 }],
      params: {
        /* 说话/宣称开合概率（迁移前：state.js:132 `p.w`；speakable.js:7 `OPEN_RATE`；
           decide.js:264 三元链） */
        wOpen:       { 25: 0.7, 50: 0.4, 75: 0.2 },
        claimRate:   { 25: 0.8, 50: 0.5, 75: 0.2 },
        /* 枪手发言/开庭概率（decide.js:292 `θ===75 ? 0.15 : 0.5`） */
        shootRate:   { 25: 0.5, 50: 0.5, 75: 0.15 },
        /* 投票：弃票偏置（decide.js:454）· 行动线（:457）· 票型参数（:464） */
        abstainBias: { 25: -10, 50: 0, 75: 8 },
        actLine:     { 25: 10, 50: 20, 75: 30 },
        voteParam:   { 25: 0, 50: 25, 75: 55 },
        /* 破坏决断概率（decide.js:747；75 档为「必然」——消费点按 >=1 短路，不消耗随机数） */
        destroyChance: { 25: 0.3, 50: 0.6, 75: 1.0 },
        /* 击杀效用基线（decide.js:893） */
        killBase:    { 25: 8, 50: 18, 75: 28 },
        /* 救援概率（perceive.js:213） */
        rescueRate:  { 25: 0.7, 50: 0.4, 75: 0.15 },
        /* 破坏性格项（tiers.js:102 `SAB.thetaShift`；消费点 decide.js:797） */
        thetaShift:  { 25: 12, 50: 0, 75: -10 },
        /* 记仇权重（util.js:24 `GRUDGE_W`） */
        grudgeW:     { 25: 0.5, 50: 0.3, 75: 0.15 },
        /* 危险度基线（tiers.js:44 `BASE_DANGER`；当前零读取点，仅登记） */
        baseDanger:  { 25: 30, 50: 50, 75: 70 },
        /* 专家 gate 阈值偏置（registry.js:70 `THETA_BIAS`，按专家分列） */
        gateBiasE7:  { 25: -0.15, 50: 0, 75: 0.15 },
        gateBiasE8:  { 25: -0.15, 50: 0, 75: 0.15 },
        gateBiasE9:  { 25: 0.10, 50: 0, 75: -0.10 },
        gateBiasE10: { 25: 0.10, 50: 0, 75: -0.10 },
        /* 〔批次 35 · 注意力挡位化〕弱事件漏进概率：低于注意力 floor 的事件不再一律丢弃，
           按此概率小概率「漏进」（人走神也会瞥见不关心的事）。
           方向：激进广而浅（杂音也听得进），保守窄而深（聚焦）。须 < 1（否则挡位失效）。 */
        attCatch:    { 25: 0.30, 50: 0.15, 75: 0.08 },
        /* 〔批次 35〕每夜注意力容量（缓存）：按「当夜正在关注的目标数」计——一夜里同时
           装得下几个人的账。新目标占名额、装满后截流；**已关注目标的后续事件不占新名额**
           （人的注意力本来就是新面孔贵、熟面孔免费）。夜推进清零＝缓存换页；
           私有源不经此口（红线 3）。开局日新面孔 14 人 ⇒ 三档都触顶（拟真：记不全 14 个
           陌生人的自称）；日常新目标 ≈2~5 ⇒ 多数日不触顶。 */
        attCap:      { 25: 12, 50: 10, 75: 8 },
        /* 〔批次 35〕长期记忆容量（内存行数）：AIMemory 各容器按此裁剪，超出按「最旧先忘」
           驱逐（记忆是内存：比缓存大、跨夜存续，但不是无限）。 */
        memCap:      { 25: 14, 50: 10, 75: 7 },
        /* 〔批次 35 · 定制发言〕语气层出现率：公开发言按此概率带 θ 档专属开场/口头禅。
           θ 决定「怎么说」（本参数），claimRate/wOpen 决定「说不说」——两层正交。 */
        voiceRate:   { 25: 0.50, 50: 0.35, 75: 0.30 },
        /* 〔批次 37 · U1 变体 AI 策略〕三个发动率（decide 派发 case 消费；此前恒缓发）。
           数值为量级拍板（发动可观测、不泛滥），标定留探针批次；额度、互斥与池外不生效
           仍由引擎侧收口。K2 纪律：θ 档位知识只住本文件——decide 只经 traitValue 读取。 */
        sniffRate:   { 25: 0.55, 50: 0.40, 75: 0.25 },  // 4.4.8 嗅探：全局 2 夜，按 θ 档的「今夜要查」率
        disguiseRate: { 25: 0.50, 50: 0.35, 75: 0.22 }, // 7.3 乔装：全局 2 次，压力驱动 + θ 调制
        disguiseProactive: { 25: 0.12, 50: 0, 75: 0 },  // 乔装：无压力时仅激进档低概率主动洗身份
      },
      /* 未知档位的声明缺省（K2 降级：取中性档语义，绝不 undefined/NaN） */
      defaults: {
        wOpen: 0.4, claimRate: 0.5, shootRate: 0.5, abstainBias: 0, actLine: 20,
        voteParam: 25, destroyChance: 0.6, killBase: 18, rescueRate: 0.4,
        thetaShift: 0, grudgeW: 0.3, baseDanger: 50,
        gateBiasE7: 0, gateBiasE8: 0, gateBiasE9: 0, gateBiasE10: 0,
        attCatch: 0.15, attCap: 10, memCap: 10, voiceRate: 0.35,
        sniffRate: 0.40, disguiseRate: 0.35, disguiseProactive: 0,
      },
    },
  };

  const axis = id => AXES[id] || null;
  /** 某参数的「档位表」副本（供整表消费的调用点，如 SAB.thetaShift / GRUDGE_W） */
  function table(axisId, key) {
    const a = AXES[axisId];
    if (!a || !a.params[key]) return null;
    return Object.assign({}, a.params[key]);
  }
  /** 单点取值：已知档精确查表（行为不变）；未知档/缺参 → 声明缺省（K2 降级） */
  function traitValue(axisId, key, value) {
    const a = AXES[axisId];
    if (!a) return null;
    const t = a.params[key];
    if (t) {
      const v = t[value];
      if (typeof v === 'number') return v;
    }
    const d = a.defaults[key];
    return typeof d === 'number' ? d : null;
  }
  /** 把某档位的全部参数解析为对象（挂到玩家上，避免逐点查表；缺 θ 的玩家得到全缺省） */
  function resolveAll(axisId, value) {
    const a = AXES[axisId];
    if (!a) return {};
    const out = { value };
    for (const k of Object.keys(a.params)) out[k] = traitValue(axisId, k, value);
    return out;
  }
  /** 玩家 → 该轴的参数对象（懒解析并缓存；无 θ 的临时对象也安全） */
  function traitOf(p, axisId) {
    const id = axisId || 'theta';
    if (!p) return resolveAll(id, undefined);
    const cacheKey = '__trait_' + id;
    if (!p[cacheKey]) p[cacheKey] = resolveAll(id, p[id === 'theta' ? 'theta' : id]);
    return p[cacheKey];
  }
  const keysOf = axisId => (AXES[axisId] || { keys: [] }).keys.slice();
  /** 按声明分布抽样一档（只消耗一次 rng.next()；缺声明时退化为首个档位） */
  function roll(axisId, rng) {
    const a = AXES[axisId];
    if (!a || !a.roll || !a.roll.length) return (a && a.keys[0]) || null;
    const r = rng.next();
    for (const e of a.roll) if (r < e.upto) return e.value;
    return a.roll[a.roll.length - 1].value;
  }

  /** 自检：返回违规清单（空数组＝合规） */
  function audit() {
    const bad = [];
    for (const id of Object.keys(AXES)) {
      const a = AXES[id];
      if (!a.keys.length) bad.push(`${id}: 档位为空`);
      if (a.keys.some(k => typeof k !== 'number')) bad.push(`${id}: 档位必须是数值（K2：连续值非字符串枚举）`);
      for (const [k, t] of Object.entries(a.params)) {
        for (const key of a.keys)
          if (typeof t[key] !== 'number') bad.push(`${id}.${k}: 缺档位 ${key} 的取值`);
        if (typeof a.defaults[k] !== 'number') bad.push(`${id}.${k}: 缺声明缺省（未知档无法降级）`);
      }
      for (const k of Object.keys(a.defaults))
        if (!a.params[k]) bad.push(`${id}.${k}: 有缺省但无参数表`);
      /* 抽样分布：档位覆盖齐备且累计上界递增（新增档位时漏改此处 → 该档永不出现） */
      if (!a.roll || !a.roll.length) bad.push(`${id}: 缺抽样分布 roll`);
      else {
        const covered = a.roll.map(e => e.value);
        for (const key of a.keys) if (covered.indexOf(key) < 0) bad.push(`${id}.roll: 档位 ${key} 永不被抽到`);
        let prev = -Infinity;
        for (const e of a.roll) {
          if (typeof e.upto !== 'number' || e.upto <= prev) bad.push(`${id}.roll: 累计上界非递增（${e.value}）`);
          prev = e.upto;
        }
      }
    }
    return bad;
  }

  global.SKTrait = { AXES, axis, table, traitValue, resolveAll, traitOf, keysOf, roll, audit };
})(typeof window !== 'undefined' ? window : globalThis);
