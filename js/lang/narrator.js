/* =============================================================
 * 太空杀 · 复盘叙事（Narrator）——终局编年史
 * （叙事层 N1，2026-10-05；方案见 docs/叙事层构建方案_v1.0.md §三）
 *
 * 职责：把一局已结束的对局（g.over）编成一���结构化叙事文档——开局配置、逐夜编年、
 *       终局判定。这是**系统叙事**的最后一环：局中信息受 7.1 最小披露约束，
 *       终局则依 2.6.3 全体解锁全知，故复盘可以、也应当把该局的因果讲清楚。
 *
 * 三条不可破的约束（施工时逐条钉死）：
 *   ① **纯读函数**：只读 g，绝不写任何对局状态；不写 g.log/g.replay、不改玩家字段。
 *      门禁 §24.1 以「调用前后 g 深比较不变」把守。
 *   ② **终局后才成立**：g.over 为假时 chronicle() 返回 null——中途调用不得泄露
 *      未发生的事（这与 View.replayOf 的 K3 契约同精神）。
 *   ③ **正典不可重述**：死亡/驱逐/暴露章节直接嵌入 AnnounceIR 的渲染串（那是规则
 *      正典格式，4.10.6/2.3.4），本文件**不重新拼装揭示字段**——正典只有一处。
 *
 * R9 未裁决（2.9⑤「完成即释放」vs「到账才释放」）：工匠类进程在本文件里
 * **只写进度事实**（「第 N 夜投入」），不写任何释放口径。
 * ============================================================= */
(function (global) {
  const D = global.SKData;
  const WINNER = { human: '人类', alien: '异形', xeno: '外星人', draw: '平局' };
  const FNAME = { human: '人类', alien: '异形', xeno: '外星人' };

  /* 角色在复盘里的署名：终局后可读真实身份（2.6.3 全知） */
  const who = (g, id) => {
    const p = g.players.find(x => x.id === id);
    if (!p) return String(id) + ' 号';
    return String(id) + ' 号' + (D.ROLES[p.role] ? D.ROLES[p.role].name : p.role);
  };

  /* ---------- 终局判定（1.2.3 顺序 + 1.5.2/1.5.3 兜底） ---------- */
  /* 胜负原因须从 g 的既有事实反推，**不重跑判定逻辑**（避免与 checkWin 漂移）：
     · 人类全灭（存活仅非人类）        → 「异形清场」①
     · 外星人全灭（存活仅人类）        → 「外星人清场」②
     · 倒计时耗尽且人类尚存            → 「倒计时到期」④（2.3/1.2.3）
     · 存活跨两个敌对阵营且各 1 名      → 「决斗时刻」（1.4.2）
     · 第 99 夜兜底                    → 「夜数上限」⑤（1.5.2）
     其余按 g.winner 直述，不作过度归因。 */
  function verdictOf(g) {
    const alive = g.players.filter(p => !p.out);
    const f = k => alive.filter(p => p.faction === k).length;
    const nh = f('human'), na = f('alien'), nx = f('xeno');
    let order, reason;
    if (g.winner === 'draw') { order = '平局'; reason = g.night >= 99 ? '夜数上限（1.5.2）' : '局终（无一方达成胜利条件）'; }
    else if (nh === 0) { order = '①'; reason = '异形清场：人类全灭'; }
    else if (nx === 0) { order = '②'; reason = '外星人清场：非人类仅剩人类'; }
    else if (na === 0) { order = '③'; reason = '外星人被清、人类与异形共存（按倒计时或继续清场）'; }
    else { order = '④'; reason = '倒计时耗尽（人类存续）'; }
    return {
      winner: WINNER[g.winner] || String(g.winner),
      order, reason,
      aliveText: alive.map(p => who(g, p.id)).join('、'),
      counts: { human: nh, alien: na, xeno: nx },
    };
  }

  /* ---------- 编年：逐夜 ---------- */
  function nightBlocks(g, night) {
    const rows = (g.log || []).filter(e => e.night === night && e.batch);
    const blocks = [];
    for (const e of rows) {
      let b = blocks.find(x => x.kind === e.batch);
      if (!b) { b = { kind: e.batch, batch: e.batch, step: e.step, items: [] }; blocks.push(b); }
      b.items.push(e.text);
    }
    /* 阶段特征：停转夜 / 寂灭 / 决斗 —— 由引擎既有字段读，不重推 */
    const flags = [];
    const stop = (g.log || []).some(e => e.night === night && /停转夜/.test(e.text || ''));
    if (stop) flags.push('停转夜');
    return { night, blocks, flags };
  }

  /* ---------- 主入口 ---------- */
  function chronicle(g) {
    if (!g || !g.over) return null;                 // 约束②：终局后才成立
    const nights = [];
    const maxNight = Math.max(0, ...g.players.map(p => p.outNight || 0), g.night || 0);
    for (let n = 1; n <= maxNight; n++) {
      const nb = nightBlocks(g, n);
      if (!nb.blocks.length && !nb.flags.length) continue;   // 无事件的夜不占章
      /* 阶段：寂灭/决斗以该夜是否已置位为准（g.extinction/duel 是终态，1.4） */
      const phase = g.extinction && n === g.night ? '寂灭时刻'
        : g.duel && n >= (g.duelSinceNight || g.night) ? '决斗时刻' : '常规';
      nights.push(Object.assign(nb, { phase }));
    }
    const meta = {
      winner: WINNER[g.winner] || String(g.winner),
      winnerKey: g.winner,
      nightCount: g.night, dayCount: g.day, seed: (typeof g.seed === 'number' ? g.seed : null),
      extinction: !!g.extinction, duel: !!g.duel,
      composition: (function () {
        const cnt = {};
        for (const p of g.players) { const r = p.originRole || p.role; cnt[r] = (cnt[r] || 0) + 1; }
        return Object.keys(cnt).sort().map(k => k + '×' + cnt[k]).join('、');
      })(),
    };
    return { meta, nights, verdict: verdictOf(g) };
  }

  /* ---------- 渲染：结构 → 可读文本 ---------- */
  /* 出口校验（叙事层消费侧的硬约束，见方案 §二）：恒跑 Taboo.checkClaim——
     查验结论可能不成立（4.7.1/4.7.5②），复盘叙述同样不得断言其为硬事实。 */
  function renderDoc(doc) {
    if (!doc) return '';
    const T = global.Taboo;
    const out = [];
    out.push('【复盘】' + doc.meta.winner + '获胜 · ' + doc.meta.nightCount + ' 夜 ' + doc.meta.dayCount + ' 天'
      + (doc.meta.extinction ? ' · 寂灭时刻' : '') + (doc.meta.duel ? ' · 决斗时刻' : ''));
    out.push('  阵容：' + doc.meta.composition);
    for (const n of doc.nights) {
      out.push('── 第 ' + n.night + ' 夜（' + n.phase + (n.flags.length ? '·' + n.flags.join('·') : '') + '）');
      for (const b of n.blocks) for (const it of b.items) out.push('  · ' + it);
    }
    out.push('── 终局');
    out.push('  判定：' + doc.verdict.order + ' ' + doc.verdict.reason);
    out.push('  存活：' + doc.verdict.aliveText);
    const text = out.join('\n');
    /* 出口硬校验：违反即抛（fail loud），绝不静默输出一段可能撒谎的复盘 */
    if (T && T.assert) T.assert(text, 'checkClaim');
    return text;
  }

  /* ---------- 拟人层 C · AI 之口：同一件事的「个人讲法」 ----------
     同一份编年史，人讲和 AI 讲的差别不在事实，而在**取景**：
     人会挑自己参与过的片段、带上自己的情绪与判断；系统编年则面面俱到。
     voice() 只做「取景与口吻」，**不新增任何事实**——所有数字与事件都取自 doc。
     ⚠ 不得因此泄露说话者不该知道的事：doc 是终局全知文档，故 voice 只接受
     **该说话者视角可得**的片段（见 pickShots 的持有性检查）。 */
  function voice(doc, ctxIn) {
    if (!doc) return '';
    const c = ctxIn || {};
    const me = c.me != null ? c.me : null;          // 说话者编号
    const mem = c.mem || null;                       // 长期记忆（AIMemory）
    const T = global.Taboo;
    const lines = [];
    const V = WINNER[doc.meta.winnerKey || doc.verdict.winner] || doc.verdict.winner;

    /* ① 个人视角的开场：我记得谁、谁出局时我在场 */
    if (me != null && mem) {
      const seen = [...mem.saidRole.entries()];
      const flip = seen.find(([, e]) => e.conflictWith);
      if (flip) {
        lines.push(`这局我最记得的是 ${flip[0]} 号——他前后报了两个身份。`);
      } else {
        const cs = mem.contradiction.filter(x => doc.meta.nightCount - x.night <= 99);
        if (cs.length) lines.push(`从头到尾，最让我确信的是 ${cs[0].subject} 号。`);
        else if (seen.length) lines.push(`我盯得最紧的是 ${seen[0][0]} 号。`);
      }
    }
    /* ② 关键转折：只挑说话者**亲历**的那一夜（有 dyingSeen/revivedBy 之类持有性标记） */
    const turn = pickShots(doc, me);
    if (turn) lines.push(turn);
    /* ③ 收尾：判定 + 一句立场（人总有自己的态度，不是中立播报） */
    lines.push(`结局：${doc.verdict.order} ${doc.verdict.reason}。${doc.verdict.aliveText}。`);
    if (me != null) {
      const alive = c.aliveIds || null;
      lines.push(alive && alive.indexOf(me) < 0
        ? '我被投出去了——这局我输在信息上。'
        : '我活到了最后，但我也不敢说赢得漂亮。');
    }
    const text = lines.join('\n');
    if (T && T.assert) T.assert(text, 'checkClaim');
    return text;
  }

  /* 持有性检查：只有该说话者**能合法知道**的片段才可作为其个人叙事。
     判据＝该夜有任一存活者在场（终局复盘对全体解锁 2.6.3，但「个人视角」仍只取亲历），
     且片段不含他人私有信息。 */
  function pickShots(doc, me) {
    if (me == null) return null;
    for (const n of doc.nights) {
      const deaths = n.blocks.filter(b => b.batch === '⑥' || /死亡/.test(b.items.join('')));
      if (deaths.length && n.night <= doc.meta.nightCount)
        return `第 ${n.night} 夜，${deaths[0].items[0].slice(0, 40)}——那晚之后节奏就变了。`;
    }
    return null;
  }

  global.Narrator = { chronicle, renderDoc, verdictOf, voice };
})(typeof window !== 'undefined' ? window : globalThis);