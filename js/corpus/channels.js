/* 推断通道表（v20 总表·合并版 结构化落地）
   来源：《太空杀·推断通道与噪声·总表（合并版 v20）》——由 tools 解析器从底本逐条抽取，
   每条保留 编号 / 判据（cond）/ 档位（tier）/ 针对（target）/ 说明（note）/ 所属章节。
   expert 按 v22 §6.1 映射表归组：N01~130→E1、N131~170→E2、N171~220→E3、N221~262→E13（影子）、
   N263~281→E8、N282~301→E9（Z 档负样本）、N302~322→E11、N324~335→E13；存量编号按档位归组
   （A→E7 承诺 / B→E8 身份 / C·F→E10 汇聚 / D→E11 社会 / P→E13 私有源 / Z→E9）。
   ★ dormant = true 表示：已录入但未接可执行 gate（判据为自然语言，需逐条实现 gate 函数）。
      dormant 条目不进估值层，仅作为可追溯资产与后续录入的工作清单。 */
(function (global) {
  /* ============ 通道数据：已解耦至 js/corpus/channels.data.js（纯数据 499 条）============
     接线阶段只改数据文件；本文件保留查询/派生接口，对外仍是 global.Channels。 */
  const CHANNELS = global.SKChannelsData.CHANNELS;

  const byId = new Map(CHANNELS.map(c => [c.id, c]));
  function of(expert) { return CHANNELS.filter(c => c.expert === expert); }
  function on(evt) { return CHANNELS.filter(c => c.on === evt); }

  global.Channels = { CHANNELS, byId, of, on, count: CHANNELS.length };
})(typeof window !== 'undefined' ? window : globalThis);
