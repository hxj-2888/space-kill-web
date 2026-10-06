/* =============================================================
 * 太空杀 · 定制发言（语气层，拟人层 Ⅲ / 批次 35）
 *
 * 职责：让「怎么说」也随性格分化。此前 θ 只决定「说不说」（claimRate/wOpen 控制开合
 *       概率），说得出来的话全池共享——两个激进 AI 说话同音。本层给三档 θ 各一套
 *       开场白 / 口头禅 / 私聊开场，把「语气」变成可声明的个体差异。
 *
 * 纪律：
 *   · **只包装不改内容**——tone() 不新增事实、不改指控对象与档位；信息语义与包装前
 *     逐字保留（开场前缀 + 口头禅后缀，正文原样）。
 *   · 模板只引「说话者自身态度」，不引用任何事实数字（事实由上游分支填充），也不含
 *     职业/阵营词——与 T18 出口门禁同一口径，天然过 Taboo。
 *   · 出现率由 traits.voiceRate 声明（θ 档）；rng 由调用方传入（g.rng），决定论可复算。
 *   · 未知 θ 档取中性池（与 traits.defaults 同口径）。
 *   · 私聊（quiet）只替换交底开场白「私下跟你说：」的固定前缀——队内频道语料有独立的
 *     伪装纪律，不在本层包装。
 * ============================================================= */
(function (global) {

  const POOLS = {
    25: {
      /* 〔批次 36 情绪降档〕激进档收一档：保留果断/不耐烦的语气，去威胁性措辞
         （「听好了」「别逼我点名」「不服的站出来」类）。强度棘轮见门禁 §29。 */
      open: ['我把话挑明——', '直说了，', '先把话说透，', '这话说在前头，'],
      tag:  ['就这样。', '信不信随你。', '我话说完了。', '先这样。'],
      priv: ['跟你交个底：', '跟你说实话：', '只跟你说：'],
    },
    50: {
      open: ['我的看法是，', '先说结论，', '说一下我的判断，', '从我看的情况，'],
      tag:  ['先看着。', '再观察观察。', '先记一笔。', '暂且这么说。'],
      priv: ['私下跟你说：', '跟你说个事：', '跟你同步一下：'],
    },
    75: {
      open: ['容我多嘴一句，', '我谨慎说一句，', '话别说死，', '我多虑一句，'],
      tag:  ['不急。', '慢点来。', '再看看吧。', '姑且存疑。'],
      priv: ['小声跟你说一句：', '这话别外传：', '悄悄跟你说：'],
    },
  };
  const NEUTRAL = 50;

  function poolOf(p) { return POOLS[p && p.theta] || POOLS[NEUTRAL]; }
  /** 语气出现率（θ 档声明；未知档 0＝不包装，行为可回退） */
  function rateOf(p) {
    const T = global.SKTrait;
    const v = (T && p && p.theta != null) ? T.traitValue('theta', 'voiceRate', p.theta) : null;
    return typeof v === 'number' ? v : 0;
  }

  /** 语气包装唯一入口：p=说话者，text=分支产出的正文，rng=g.rng，opts.quiet=私聊/队内频道 */
  function tone(p, text, rng, opts) {
    if (!text) return text;
    const pool = poolOf(p);
    if (opts && opts.quiet) {
      /* 私聊：仅替换交底固定前缀；队内语料与其余私聊文本原样返回 */
      const PRE = '私下跟你说：';
      if (text.indexOf(PRE) === 0) return pool.priv[rng.int(pool.priv.length)] + text.slice(PRE.length);
      return text;
    }
    const rate = rateOf(p);
    if (!(rate > 0) || !rng || !rng.chance(rate)) return text;
    let out = pool.open[rng.int(pool.open.length)] + text;
    if (rng.chance(0.4)) out += pool.tag[rng.int(pool.tag.length)];
    return out;
  }

  global.Voice = { POOLS, tone, poolOf, rateOf };
})(typeof window !== 'undefined' ? window : globalThis);
