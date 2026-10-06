/* =============================================================
 * 太空杀 · 公告 IR —— 系统公告的结构化节点与确定性渲染
 * （叙事层前置 P1-a，2026-10-05；交接文档 §七.1）
 *
 * 与 lang/ir.js（玩家 Claim）平行：公告是系统产物——无说话者、无随机、
 * 无门禁上下文，故独立建 IR，不改 Claim renderer。引擎调用点只构造节点，
 * 模板渲染统一走本文件：2.8.12③ 的差量登记由此收敛到 SCHEMA 一处，
 * 调用点不再手拼揭示字段。
 *
 * 规则依据（v66.1 正文，唯一权威源）：
 *   · 2.8.12① —— 默认揭示范围＝编号＋呈现身份（真实阵营＋呈现职业＋真实职业）
 *   · 2.8.12③ —— 既有差量仅四处；各节点只声明相对默认的差量字段
 *   · 2.8.12④ —— 暴露公告只报「编号＋呈现职业」，不揭示真实阵营与真实职业
 *                 （〔通则 2.8.12① 之例外，登记于 2.8.9(17)〕）
 *   · 4.7.2/4.7.5 —— 神探公告限于编号与呈现职业；转职者固定标注原职业（差量③）
 *   · 2.3.4/4.10.6 —— 驱逐与死亡揭示保留真实阵营与真实职业（⑥⑩）
 *
 * 结构即防线（与 revealService「结构上拿不到」同原则）：
 *   工厂只拷贝 SCHEMA 允许的字段——即便调用方把 factionName 递进来，
 *   暴露/神探节点里也没有这个键；render 前再跑 validate 兜底，
 *   越权字段或缺失必填字段一律抛错（fail loud）。
 * ============================================================= */
(function (global) {
  const KINDS = ['announceDeath', 'announceExpel', 'announceExpose', 'announceDetective'];

  /* 2.8.12③ 差量登记表（唯一权威·一处登记）。
     字段名即差量语义：factionName（真实阵营）与 trueRole（真实职业）属默认范围，
     但对 ④⑤ 暴露为禁止项（2.8.12④）、对 ③ 神探公告不适用（4.7.2 只报两项）；
     originRole（原职业标注）是 ③ 的固定格式差量（4.7.5，B2 后仅此一处保留）。 */
  const SCHEMA = {
    announceDeath:     ['id', 'factionName', 'presentedRole', 'trueRole', 'report'], // ⑥ 4.10.6/2.3.4
    announceExpel:     ['id', 'factionName', 'presentedRole', 'trueRole'],           // ⑩ 2.3.4
    announceExpose:    ['label', 'items'],                                           // ④⑤ 2.8.12④〔2.8.9(17)〕
    announceDetective: ['id', 'presentedRole', 'originRole'],                        // ③ 4.7.2/4.7.5
  };

  const REQUIRED = {
    announceDeath:     ['id', 'factionName', 'presentedRole', 'trueRole', 'report'],
    announceExpel:     ['id', 'factionName', 'presentedRole', 'trueRole'],
    announceExpose:    ['label', 'items'],
    announceDetective: ['id', 'presentedRole'],
  };

  /* 节点校验：kind 已登记、顶层字段不越 SCHEMA、必填字段齐全。
     本函数即 2.8.12③ 差量登记的**可执行形态**——手工构造的节点若夹带
     越权字段（如暴露节点带 factionName），render 时当场抛错而非静默泄露。 */
  function validate(node) {
    if (!node || KINDS.indexOf(node.kind) < 0)
      throw new Error('AnnounceIR: 未登记的公告节点 ' + (node && node.kind));
    const allowed = SCHEMA[node.kind];
    const extra = Object.keys(node).filter(k => k !== 'kind' && allowed.indexOf(k) < 0);
    if (extra.length)
      throw new Error('AnnounceIR: ' + node.kind + ' 携带越权字段 ' + extra.join(',') +
        '（2.8.12③ 差量登记只允许 ' + allowed.join(',') + '）');
    const lack = REQUIRED[node.kind].filter(k => node[k] === undefined || node[k] === null);
    if (lack.length)
      throw new Error('AnnounceIR: ' + node.kind + ' 缺必填字段 ' + lack.join(','));
    return true;
  }

  /* 工厂共用骨架：只拷贝 SCHEMA 允许且非空的字段 */
  function build(kind, fields) {
    const node = { kind };
    for (const k of SCHEMA[kind]) {
      const v = fields[k];
      if (v !== undefined && v !== null) node[k] = v;
    }
    return node;
  }

  /* ⑥ 死亡（4.10.6）：report 为调查报告的致死来源类别名数组（已映射中文、去重不带次数），
     渲染时以「、」连接；空数组渲染为【】——与旧模板行为一致（正常路径必有至少一项）。 */
  function death(cr, factionName, reportNames) {
    return build('announceDeath', {
      id: cr.id, factionName,
      presentedRole: cr.roleName, trueRole: cr.trueRoleName,
      report: Array.isArray(reportNames) ? reportNames : [reportNames],
    });
  }

  /* ⑩ 驱逐（2.3.4） */
  function expel(cr, factionName) {
    return build('announceExpel', {
      id: cr.id, factionName,
      presentedRole: cr.roleName, trueRole: cr.trueRoleName,
    });
  }

  /* ④⑤ 暴露（2.8.12④）：items 为 [{id, roleName}]；逐项同样只保留两字段，
     调用方递入 faction 等多余键会被剥掉。label 为批次内条款名（「维修者暴露」∕「破坏者暴露」）。 */
  function expose(label, items) {
    return build('announceExpose', {
      label,
      items: (items || []).map(it => ({ id: it.id, roleName: it.roleName })),
    });
  }

  /* ③ 神探公告（4.7.2）：originRole 仅转职者非空（checkResult 已按路径配置给出） */
  function detective(cr) {
    return build('announceDetective', {
      id: cr.id, presentedRole: cr.roleName, originRole: cr.originRole,
    });
  }

  /* 确定性渲染：输出与既有调用点模板逐字节一致（零行为变化的硬前提）。 */
  function render(node) {
    validate(node);
    switch (node.kind) {
      case 'announceDeath':
        return `${node.id} 号死亡，${node.factionName}` +
          `（呈现职业：${node.presentedRole}／真实职业：${node.trueRole}），尸体调查报告：【${node.report.join('、')}】`;
      case 'announceExpel':
        return `${node.id} 号被驱逐，${node.factionName}` +
          `（呈现职业：${node.presentedRole}／真实职业：${node.trueRole}）`;
      case 'announceExpose':
        return `${node.label}：` + node.items.map(it => `${it.id} 号（${it.roleName}）`).join('、');
      case 'announceDetective':
        return `${node.id} 号是（职业：${node.presentedRole}` +
          (node.originRole ? `；原职业：${node.originRole}` : '') + '）';
      default:
        throw new Error('AnnounceIR: 未登记的公告节点 ' + node.kind);
    }
  }

  global.AnnounceIR = { KINDS, SCHEMA, validate, death, expel, expose, detective, render };
})(typeof window !== 'undefined' ? window : globalThis);
