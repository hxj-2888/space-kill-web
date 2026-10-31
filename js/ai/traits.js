/* =============================================================
 * 新返航录 · 性格轴声明层（Traits）
 *
 * 职责：**只声明「倾向 → 系数」的映射**，不写任何判定流程。
 *   game.js 里所有「激进一点的 AI 会怎样」都只能调 SKTrait.C.*，
 *   不允许在业务代码里再散写 12 / 0.55 / 0.7 这类魔法数。
 *
 * 设计来源：本项目的太空杀旧分支（form-ui-original / 过渡版）里
 *   有一套 SKTrait + 效用函数的做法（档位声明 + 性格化门槛），
 *   这里**只继承结构、不继承数值**——旧分支是给表单式对局调的手感，
 *   搬进实时对抗会毁节奏，所以阈值按实时对局重写（见各 COEF 注释）。
 *
 * 四条轴（0~100，中性 50）：
 *   aggr 激进：更敢出刀 / 开枪 / 投票 / 更快开工 / 更不服软
 *   caut 谨慎：更容易弃权、更容易被目击吓退
 *   soc  社交：更爱发言、替人辩护、跟票
 *   cur  好奇：更爱搜尸、绕路查看
 *
 * 抽档用三档分布（28 / 50 / 72，概率 30 / 40 / 30），
 * 保证每局都有敢冲的、怂的、和事佬，而不是全员 50 的均匀噪声。
 * ============================================================= */
(function (global) {
  const AXES = ['aggr', 'caut', 'soc', 'cur'];
  const NEUTRAL = 50;
  const BANDS = [[28, 0.30], [50, 0.40], [72, 0.30]];

  function pick(rnd) {
    const r = (rnd || Math.random)();
    let acc = 0;
    for (const [v, p] of BANDS) { acc += p; if (r <= acc) return v; }
    return NEUTRAL;
  }
  function roll(rnd) {
    const o = {};
    for (const k of AXES) o[k] = pick(rnd);
    return o;
  }
  /* 档位 → [-1, 1]：0 = 中性，+1 = 该轴拉满 */
  function b(a, axis) {
    const t = a && a.trait;
    const v = t && t[axis] != null ? t[axis] : NEUTRAL;
    return (v - NEUTRAL) / 50;
  }

  /* 具名系数：**唯一真源**。注释里的数值是「中性档（50）」的基线，
     改动时只需要保证中性档回到原行为，A/B 才可比。 */
  const C = {
    /* 异形挑目标：有人在 6 格内看着时的惩罚（基线 12 格）。
       激进的人不太在乎被看见（×0.45），谨慎的人会躲得更远（×1.45）。 */
    knifeWatcherPenalty: a => 12 * (1 - 0.55 * b(a, 'aggr') + 0.45 * b(a, 'caut')),
    /* 异形挑目标：对「正在站桩做事的人」的优先度（基线 -12 格） */
    knifeBusyBonus: a => -12 * (1 + 0.35 * b(a, 'aggr')),
    /* 异形：贴脸出刀的距离门槛（基线 1.3 格，见 aiTickAlien 的 td<1.3 判定） */
    knifeReach: a => 1.3 * (1 + 0.22 * b(a, 'aggr')),
    /* 异形：旁边有目击者时仍然出手的胆量（基线 0.55，>= 2 人时基线必定放弃） */
    knifeBold: a => Math.max(0.12, Math.min(0.95,
      0.55 + 0.35 * b(a, 'aggr') - 0.25 * b(a, 'caut'))),
    /* 异形：目击者人数的硬上限（基线 2；够激进就敢在 2 个人面前动手） */
    knifeWatcherCap: a => (b(a, 'aggr') > 0.30 ? 3 : 2),
    /* 人类开枪：需要的嫌疑分（基线 0.50）。激进 0.36 就敢打，谨慎要 0.60 */
    shootSus: a => 0.50 - 0.14 * b(a, 'aggr') + 0.10 * b(a, 'caut'),
    /* 投票弃权率。基线 0.52（比旧版 0.42 略高：性格化之后人类整体更敢投人，
       若基线不变，异形会被冤枉到 73:26 的雪崩局——2026-10-31 实测后回调）。
       激进仍 0.18 就敢投，谨慎 0.70。 */
    voteAbstain: a => Math.max(0, 0.52 - 0.34 * b(a, 'aggr') + 0.18 * b(a, 'caut')),
    /* 开局错峰延迟缩放（基线 1.0 = 2~8 秒）。激进的人一进夜就冲 */
    delayScale: a => Math.max(0.25, 1 - 0.45 * b(a, 'aggr') + 0.30 * b(a, 'caut')),
    /* 弃修阈值缩放（基线 1.0）：激进的人在危险里多站一会儿也不跑 */
    fleeThreshold: a => 1 + 0.60 * b(a, 'aggr'),
    /* 搜尸/看一眼的意愿 */
    lootScale: a => 1 + 0.70 * b(a, 'cur'),
    /* 替人辩护概率（基线 0.55，见 decideHumanDefend） */
    defendChance: a => Math.min(0.92, 0.55 + 0.30 * b(a, 'soc') + 0.10 * b(a, 'aggr')),
    /* 跟票概率（有人带头指控时，基线 0.60，见 startChatter 的 supporter 段） */
    followChance: a => Math.min(0.95, 0.60 + 0.28 * b(a, 'soc') + 0.15 * b(a, 'aggr')),
    /* 情绪：被指控后记仇的强度（见 grudgeAdd） */
    grudgeGain: a => 1 + 0.45 * b(a, 'aggr') + 0.20 * b(a, 'caut'),
    /* 情绪：被辩护后记恩的强度（见 trustAdd） */
    trustGain: a => 1 + 0.40 * b(a, 'soc'),
    /* 情绪影响投票：对「欠人情 / 有仇」的目标的附加分（格） */
    voteGrudgePull: a => 6 * (1 + 0.5 * b(a, 'aggr')),
    voteTrustPush: a => 5 * (1 + 0.5 * b(a, 'soc')),
  };

  function label(a) {
    const t = a && a.trait;
    if (!t) return '中性';
    if (t.aggr >= 65 && t.caut <= 45) return '激进';
    if (t.caut >= 65) return '谨慎';
    if (t.soc >= 65) return '健谈';
    if (t.cur >= 65) return '好奇';
    return '中性';
  }

  global.SKTrait = { AXES, NEUTRAL, BANDS, roll, pick, b, C, label };
})(window);
