/* =============================================================
 * 太空杀 · 通用进程引擎（v6.6 重构 C11 · 执行层）
 *
 * 职责：只跑 2.9 的通用状态机，**不认识任何具体机制名**——
 *   invest()  投入一夜：进度 +1；达 nights 即完成 → 记入待发放状态 + 私反馈
 *   deliver() 次夜到账：把待发放产物按**声明的资源增量**落到玩家对象 + 私反馈
 *   stateOf() 读进度（供表单/UI 显示）
 *
 * 规则依据：2.9② 进度只记「已投入几个夜晚、不锁定后续选择」；2.9③ 可中断、进度保留；
 *          完成时定产物 + 次夜到账；3.3③ 产物以完成时之选为准。
 *
 * 依赖方向：执行层 → 声明层（SKProcess / SKRoleDecl），**反向为零引用**。
 * 加进程只改 js/v66/declaration/processRegistry.js（断言 H26：本文件 diff 为空）。
 * 文案由声明层的模板生成（含「产物到账」由资源标签拼装），故新进程无需新代码。
 * ============================================================= */
(function (global) {
  const REG = global.SKProcess;

  /** 读某进程的进行中状态（未开始返回 null） */
  function stateOf(p, procId) {
    const d = REG.get(procId);
    if (!d || !p) return null;
    return p[d.progressKey] || null;
  }
  /** 是否已完成、待次夜发放 */
  function pendingOf(p, procId) {
    const d = REG.get(procId);
    if (!d || !p) return null;
    return p[d.doneKey] || null;
  }

  /**
   * 投入一夜。
   * @param g 对局；p 玩家；procId 进程键；product 产物键（缺省沿用既有选择；首次缺省取首个可选项）
   * @param opts.say 私反馈投递函数（注入，避免执行层直接依赖引擎的 priv）
   * @returns {invested, completed, progress, product} ；未登记的进程返回 null（fail loud 由调用方判定）
   */
  function invest(g, p, procId, product, opts) {
    const d = REG.get(procId);
    if (!d) return null;
    /* T22（2026-10-05 文本审查第二遍）：owner 校验——进程的合法持有者由声明层给出。
       当前各调用点在表单/req 侧已按能力标签门控（brew 走 treat 授予＝医生族，与
       owner:['bio','rescue','tempdoc'] 等价 ⇒ 本校验行为中性），此处作为第二道防线：
       未来新进程/新角色接线时，越权投入在此 fail loud，不再静默生效。 */
    if (d.owner && d.owner.indexOf(p.role) < 0) return { invested: false, denied: 'owner' };
    /* 2.9⑤ 独占性（2026-10-05）：同一时期仅可存在**一个**未完成进程——声明 exclusiveGroup 的
       进程之间互斥（如常规铸造与速成铸造，4.11.2① / ①之二：二者不得同夜并进）。
       本检查只认「组名相等」，不认识任何具体机制名，故新增进程无需改本文件（H26 仍成立）。
       ⚠ 「未完成」含**已投满待发放**态（progressKey 已清空但 doneKey 仍在）：产物按 2.9 于次夜
       到账，该机制仍占着工匠的行动与库存（4.11.3① 上限 2 件、每夜三择一），故到账前不得并进。
       首版只查 progressKey ⇒ 完成当夜即可并进，是漏的；此处一并计入 doneKey。 */
    if (d.exclusiveGroup) {
      for (const other of REG.keys()) {
        if (other === procId) continue;
        const od = REG.get(other);
        if (od && od.exclusiveGroup === d.exclusiveGroup && (p[od.progressKey] || p[od.doneKey])) {
          return { invested: false, denied: 'exclusive', by: other };
        }
      }
    }
    const say = (opts && opts.say) || function () {};
    const key = d.progressKey;
    if (!p[key]) p[key] = { progress: 0, product: product || d.defaultProduct || d.productChoices[0] };
    if (product) p[key].product = product;              // 2.9②：选定投入仅约束该当夜，不锁后续
    p[key].progress += 1;
    p[key].lastNight = g.night;
    const n = p[key].progress;
    if (n >= d.nights) {
      p[d.doneKey] = p[key].product;                    // 完成时定产物（3.3③）→ 次夜到账（3.3⑨）
      say(d.messages.complete);
      p[key] = null;
      return { invested: true, completed: true, progress: d.nights, product: p[d.doneKey] };
    }
    say(d.messages.progress.replace('{n}', String(n)).replace('{nights}', String(d.nights))
      .replace('{product}', (d.messages.shortLabels || {})[p[key].product] || p[key].product));
    return { invested: true, completed: false, progress: n, product: p[key].product };
  }

  /**
   * 次夜到账：把该玩家全部「已完成待发放」的进程产物落实。
   * @returns 实际发放的进程键数组
   */
  function deliver(g, p, opts) {
    const say = (opts && opts.say) || function () {};
    const done = [];
    for (const id of REG.keys()) {
      const d = REG.get(id);
      const product = p[d.doneKey];
      if (!product) continue;
      const deltas = (d.products || {})[product];
      if (deltas) {
        for (const [resKey, amount] of Object.entries(deltas)) {
          if (typeof p[resKey] === 'number') p[resKey] += amount;
          else p[resKey] = amount;
        }
        const txt = REG.deliverText(id, product);
        if (txt) say(txt);
      }
      p[d.doneKey] = null;
      done.push(id);
    }
    return done;
  }

  global.SKProcessEngine = { stateOf, pendingOf, invest, deliver };
})(typeof window !== 'undefined' ? window : globalThis);
