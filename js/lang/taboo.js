/* =============================================================
 * 太空杀 · 禁语规则引擎 —— v66.1 固化的三条硬约束的结构化校验
 * （叙事层前置 P1-b，2026-10-05；交接文档 §七.2）
 *
 * 叙事层（公告文案、复盘叙事、后续的引导文案）的产出必须内建校验，
 * 不能靠提示词。三条硬约束（v66.1 正文，唯一权威源）：
 *
 *   A. report     调查报告只列不同类别、不带次数（4.10.6【去重·不带次数】）
 *                 ⇒ 叙事不得出现「被砍了两刀」「双刀」等可反推份数的措辞；
 *   B. expose     暴露公告只报「编号＋呈现职业」（2.8.12④，登记于 2.8.9(17)）
 *                 ⇒ 叙事不得出现真实阵营∕真实职业措辞；
 *   C. checkClaim 神探查验结论可能不成立（4.7.1／4.7.5②：呈现职业可能系变形所致）
 *                 ⇒ 叙事不得把查验结论断言为硬事实。
 *
 * 适用对象＝**系统叙事文本**。玩家（含 AI 玩家）的推测性发言受 7.0 推理自由
 * 保护——「他被砍了两刀」出自玩家之口是合法推理，出自系统叙事即违规；
 * 本引擎 therefore 只在叙事层出口调用，不进玩家发言门禁（那是 T18 的关注点）。
 *
 * 口径说明：
 *   · 6.8.4⑥「本夜发生 N 次复生」及剩余次数是明文披露，不属 A 的检查对象，
 *     调用方须将其与调查报告文本分开校验；
 *   · expose 检查先剥离「N 号（X）」条目形态——X 为呈现职业名，其本身可能
 *     含阵营字样（未实装乔装时异形的呈现职业就是「异形」，2.8.12④ 管的是
 *     字段不越界， AIR.SCHEMA 已在结构层保证），只对条目之外的措辞扫描。
 * ============================================================= */
(function (global) {
  /* 词表即登记处：新增禁语在 RULES 里加一条并附规则出处，不散落调用点。 */
  const RULES = {
    /* A. 份数词与份数措辞（4.10.6）——调查报告去重后只有类别，叙述中出现份数即泄露 */
    report: [
      { re: /(?:两|二|三|四|五|六|七|八|九|十|\d+)\s*(?:刀|发|枪|次|份|回)/, cite: '4.10.6', why: '份数词可反推攻击份数' },
      { re: /双刀/, cite: '4.10.6', why: '「双刀」暗示两次攻击' },
      { re: /补刀/, cite: '4.10.6', why: '「补刀」暗示多次落身' },
      { re: /又[^。！？]{0,4}(?:挨|被|中|吃)[^。！？]{0,3}(?:刀|枪|一击)/, cite: '4.10.6', why: '「又」暗示重复攻击' },
    ],
    /* B. 阵营与真实职业措辞（2.8.12④）——暴露叙事只允许「编号＋呈现职业」 */
    expose: [
      { re: /人类|异形|外星人|第三阵营|异类阵营|人类阵营/, cite: '2.8.12④', why: '暴露叙事不得出现阵营措辞' },
      { re: /真实阵营|真实职业/, cite: '2.8.12④', why: '暴露叙事不得出现真实身份措辞' },
    ],
    /* C. 查验结论断言为硬事实（4.7.1/4.7.5②）——呈现职业可能系变形，结论可能不成立 */
    checkClaim: [
      { re: /(?:查验|查验结果|查出|验出)[^。！？]{0,12}(?:一定|肯定|必然|确实|绝对|百分之百|千真万确|无误|保真)/, cite: '4.7.1/4.7.5②', why: '查验结论不得断言为硬事实' },
      { re: /(?:一定|肯定|必然|绝对|百分之百)[^。！？]{0,8}(?:是|为)[^。！？]{0,10}(?:查验|查证|验证)(?:结果|结论)?/, cite: '4.7.1/4.7.5②', why: '查验结论不得断言为硬事实' },
    ],
  };

  const KIND_OF = { report: 'report', expose: 'expose', checkClaim: 'checkClaim' };

  /* expose 文本先剥离「N 号（X）」条目形态再扫描（X＝呈现职业名，非阵营断言） */
  const ITEM_RE = /\d+\s*号（[^（）]*）/g;
  function prepare(text, kind) {
    return kind === 'expose' ? String(text || '').replace(ITEM_RE, '▒') : String(text || '');
  }

  /* 校验入口：check(text, kind) → 违规数组（空数组＝通过）。
     每条违规含命中片段、规则出处与理由，供叙事层上报与门禁断言使用。 */
  function check(text, kind) {
    if (!KIND_OF[kind]) throw new Error('Taboo: 未登记的检查类别 ' + kind);
    const src = prepare(text, kind);
    const out = [];
    for (const r of RULES[kind]) {
      const m = src.match(r.re);
      if (m) out.push({ kind, rule: r.cite, hit: m[0], why: r.why });
    }
    return out;
  }

  function report(text) { return check(text, 'report'); }
  function expose(text) { return check(text, 'expose'); }
  function checkClaim(text) { return check(text, 'checkClaim'); }

  /* 断言入口：叙事层出口用——违规即抛错（fail loud），附全部违规明细。 */
  function assert(text, kind) {
    const vs = check(text, kind);
    if (vs.length)
      throw new Error('Taboo[' + kind + ']: ' + vs.map(v => `「${v.hit}」违反 ${v.rule}（${v.why}）`).join('；'));
    return true;
  }

  global.Taboo = { RULES, check, report, expose, checkClaim, assert };
})(typeof window !== 'undefined' ? window : globalThis);
