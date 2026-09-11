/* 推理 → 语言：AI「能安全说出什么」的候选发生器。
   定位：这是总表 hundreds 通道的 speakable 字段在本阶段的雏形——
   只有【发言者自己确实持有、且规则允许其声张】的信息才会成为候选，
   从源头杜绝「说出 AI 不该知道的事」（总表判据：AI 不蠢，属选项生成层过滤）。
   本阶段不新增任何权重，发言开合概率沿用 ai/speak 里既有的西塔三档口径 0.8/0.5/0.2。 */
(function (global) {
  const OPEN_RATE = { 25: 0.8, 50: 0.5, 75: 0.2 };   // 与 ai.js:speak 侦探/船员分支同口径，未新建数值

  function candidatesFor(g, p) {
    const IR = global.IR;
    const out = [];
    if (!p || p.out || !IR) return out;
    const night = g.night;
    /* v32 语言层修复（时间情境）：开局讨论（第 0 夜）不存在任何「昨晚体验」，
       私有体验宣称在此全部失格——否则第 0 天就会说「昨晚用了抑制」这类穿帮话。 */
    if (night === 0) return out;

    /* ① 感染抑制：只有真正用过的人才会有此体验（⑪ 不予通报 → 不可验证，属 D 档） */
    if (p.noActive) {
      out.push({
        source: 'suppress-experience', verifiable: false, cost: '不可验证，任何人都能这样说',
        claim: IR.mk('suppress', [], {}, { speaker: p.id, night, step: g.step, channel: 'public' }),
      });
    }
    /* ② 维修体验：工程师 / 助理工程师当夜确有维修记录时才能说 */
    if ((p.role === 'engineer' || p.role === 'assistant') && (p.repairedTonight || 0) > 0) {
      out.push({
        source: 'repair-experience', verifiable: 'partial', cost: '④ 维修总量可被部分对账',
        claim: IR.mk('repair', [], {}, { speaker: p.id, night, step: g.step, channel: 'public' }),
      });
    }
    /* ③ 制药进度：进度本身私有（B21/D18），但「我在制药」是当事人可以合法声张的体验 */
    if (p.brew && (p.brew.progress || 0) > 0) {
      out.push({
        source: 'brew-progress', verifiable: false, cost: '进度不可验证',
        claim: IR.mk('brew', [], {}, { speaker: p.id, night, step: g.step, channel: 'public' }),
      });
    }
    /* ④ v32 语言层（角色黑话出口）：保镖的公开背书——「我保 X / 我挺 X」。
       说话者确实在保护 X（lastProtected = 步骤 3 落盘）时才是合法声张；
       用 defend 类型（已有 IR 类型 + 渲染 + 解析链），承诺公开化会把自己暴露
       （N400 同构：保护承诺 → 被保护对象成为集火点），与 R38 自证同档风险。 */
    if (p.role === 'bodyguard' && p.lastProtected != null) {
      const t = g.players.find(x => x.id === p.lastProtected);
      if (t && !t.out) {
        out.push({
          source: 'guard-backing', verifiable: false, cost: '保护不可验证（§5.2 verifiable=false 同构），但背书会招火',
          claim: IR.mk('defend', [t.id], {}, { speaker: p.id, night, step: g.step, channel: 'public' }),
        });
      }
    }
    /* ⑤ v32 语言层（角色黑话出口）：验票官的票源观察——「X 号在跟 Y 号的票」。
       票源是验票官私有（2.3 例外一），公开转述票型 = N219（B−）的正主出口；
       用 quote 类型（转述归因，已有解析链）：「X 说/咬 Y」句式，票源转述共用该结构。 */
    if (p.role === 'inspector' && (g.voteHistory || []).length) {
      const round = g.voteHistory[g.voteHistory.length - 1];
      const src = round && round.src ? round.src : null;
      if (src) {
        const voter = Object.keys(src).find(v => +v !== p.id && src[v] != null);
        if (voter) {
          out.push({
            source: 'ballot-relay', verifiable: 'partial', cost: '票源不公开 ⇒ 只能对票数对账（⑨），说话者无从自证',
            claim: IR.mk('quote', [src[voter]], { by: +voter }, { speaker: p.id, night, step: g.step, channel: 'public' }),
          });
        }
      }
    }
    return out;
  }

  /* 挑一条说出来（按西塔性格开口率；不开口返回 null） */
  function pick(g, p, rng) {
    const list = candidatesFor(g, p);
    if (!list.length) return null;
    const rate = OPEN_RATE[p.theta] != null ? OPEN_RATE[p.theta] : 0.5;
    if (rng && rng.chance ? !rng.chance(rate) : Math.random() >= rate) return null;
    /* 优先说「可被部分验证」的那条——不可验证的空话价值最低 */
    list.sort((a, b) => (b.verifiable ? 1 : 0) - (a.verifiable ? 1 : 0));
    return list[0];
  }

  global.Speakable = { candidatesFor, pick };
})(typeof window !== 'undefined' ? window : globalThis);
