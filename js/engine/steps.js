/* =============================================================
 * 太空杀 · 步骤定义表 STEPS（自 js/engine.js 解耦，v27 模块化第六批）
 *
 * 规模：1165 行 / 26 个步骤条目 —— engine.js 里最大的单块。
 * 形态：工厂 + 依赖注入。表内处理器引用的引擎函数（伤害/转职/结算/投递/阶段）
 *       由 engine.js 在文件末尾一次性注入，因此本文件不反向依赖 engine.js。
 *
 * 调用方：engine.js 的 beginStep/finishStep/stepOnce 等驱动函数读 STEPS[step]；
 *        Engine.STEPS 对外导出的对象与拆分前完全同源。
 * 依赖：global.SKData（D）；其余引擎函数与常量全部来自 deps。
 * ============================================================= */
(function (global) {
  function createSteps(deps) {
    /* v6.6 阶段 2（D6 能力分发表）：能力判定一律问声明层「谁能做这件事」，
       不再写死角色键清单——清单散落多处时，漏一处即该角色静默失去能力。 */
    const RD = global.SKRoleDecl;
    const ACT = global.SKDerivation;      // v6.6 阶段 2（C5 倒排）：行动位 → 候选发出者
    const PROC = global.SKProcessEngine;  // v6.6 阶段 2（C11 进程注册表）：制药等进程型产出
    const PROCD = global.SKProcess;       // 进程声明（表单文案由声明生成）
    /* 【v7 裁定②】协助维修持有者判定。
       SKRoleDecl **未导出** chargeOf 访问器（只有 hasGrant 读 grants），charges 只能按
       ROLE_DECL[role].charges 直读——与 derivation/actions.js 的 rolesAt 读 actionStep 同一路。
       ⚠ 此前这里写 `RD.chargeOf && RD.chargeOf(...)`：因 chargeOf 为 undefined，守卫短路为假，
         船员表单永不出现（互斥探针实测 crewRepair 命中 0 次才暴露）。
       req 与 form 共用本函数，两者判据因此**按构造同源**，不会像上次那样各自漂移。 */
    const hasAssistRepair = p => {
      const d = RD.ROLE_DECL[p.role];
      return !!(d && d.charges && d.charges.assistRepair != null);
    };
    const {
      D,
      NORMAL,
      EXTINCT,
      DUEL,
      STEP_NAME,
      alive,
      aliveF,
      faction,
      P,
      id,
      canAct,
      ANN,
      log,
      announce,
      priv,
      god,
      applyThreat,
      banner,
      applyLethal,
      applyInfection,
      clearInfection,
      doTransfer,
      grants,
      nextNight,
      orderedPlayers,
      startDay,
      nextPhase,
      updatePhases,
      checkWin,
      endGame,
      formPlayers,
      toDecision,
      STEPS,
      resolveVote,
      addTalk,
      talk,
      streamPump,
      beginStep,
      finishStep,
      pendingCount,
      decisionProgress,
      stepOnce,
      setDecisionFor,
      setDecision,
      submit,
      finishIfReady,
      begin,
    } = deps;

    /* 4.10.6 尸体调查报告 / 4.6.1 救援可见清单（C7，2026-10-04）：
       「逐项列出该尸体于当夜查明的全部致死来源，而非判定单一死因」+【去重·不带次数】
       ——同一来源重复出现只记一项，不记次数、不记先后、不记份数（故无从反推双刀/额外出刀）。
       t.deathCauses 于「落身即记」时收集（engine.js applyLethal）并已去重，感染致死由步骤
       0.55 单列补记；此处只做展示映射，不改任何状态。
       〔N3 裁决 2026-10-04 · 读法甲〕「报告所有致死来源」= 所有【不同类别】的落身来源，
       相对于「只报单一死因」而言；不改为逐次累加——那会破坏 4.10.6 的防反推设计。 */
    function causeList(t) {
      const arr = (t && t.deathCauses && t.deathCauses.length) ? t.deathCauses
                : (t && t.dyingCause ? [t.dyingCause] : []);
      return arr.map(c => D.CAUSE_NAME[c] || c);
    }
    function causeReport(t) { return causeList(t).join('、'); }

    return {

    '0a': {
      req: g => alive(g).filter(p => !p.dying).map(p => ({ pid: p.id, kind: 'invite' })),
      form: (g, p) => ({
        kind: 'invite', title: '步骤 0a · 私聊 · 发起邀请',
        desc: '选择今夜想私聊的对象（不可连续两晚邀请同一人）。对方接受后才会进入步骤 0c 的私聊窗口。',
        /* v22 C25/C50：异形队内另有每晚自动开启的队内频道——mate 不占邀请名额 */
        targets: formPlayers('aliveOthers', 1, 0, [p.lastInvite].concat(
          p.faction === 'alien'
            ? g.players.filter(x => !x.out && x.faction === 'alien' && x.id !== p.id).map(x => x.id)
            : [])),
        skipLabel: '今夜不发起',
      }),
      run(g) {
        g.invites = {};
        /* v22 缺陷修复（两轮制·简式）：发起方在 0a 已表达意愿，0b 不再接受他人——
           否则「邀请方自己也接受了别人的邀请」时按 id 序先配者胜，另一位接受者的
           同意被静默吞掉（实测 13.2% 的接受被吞，100% 源于此因） */
        g.inviterIds = new Set();
        for (const p of g.players) {
          const d = g.decisions[p.id]; if (!d || d.invite == null || p.out) continue;
          p.lastInvite = d.invite;
          g.inviterIds.add(p.id);
          const t = P(g, d.invite); if (!t || t.out) continue;
          god(g, `${p.id} 号邀请 ${t.id} 号私聊`);
          (g.invites[t.id] = g.invites[t.id] || []).push(p.id);
        }
      },
    },

    '0b': {
      req: g => {
        const inviter = g.inviterIds || new Set();
        return g.players.filter(p => !p.out && (g.invites[p.id] || []).length && !inviter.has(p.id))
                        .map(p => ({ pid: p.id, kind: 'inviteAccept' }));
      },
      form(g, p) {
        const froms = (g.invites[p.id] || []).filter(id => { const o = P(g, id); return o && !o.out; });
        return {
          kind: 'inviteAccept', title: '步骤 0b · 私聊 · 处理邀请',
          desc: '你收到了邀请。只能接受其中一位（双向确认才配对），也可全部拒绝。',
          opts: froms.map(id => ({ v: String(id), label: `接受 ${id} 号的邀请` }))
                     .concat([{ v: 'none', label: '全部拒绝' }]),
        };
      },
      run(g) {
        const pairs = [], done = new Set();
        for (const p of g.players) {
          const d = g.decisions[p.id];
          if (!d || !d.accept || d.accept === 'none' || p.out) continue;
          const from = +d.accept;
          if ((g.invites[p.id] || []).indexOf(from) < 0) continue;
          const o = P(g, from); if (!o || o.out || done.has(p.id) || done.has(from)) continue;
          pairs.push([from, p.id]); done.add(from); done.add(p.id);
        }
        g.pairs = pairs;
        announce(g, '①', pairs.length
          ? '私聊配对：' + pairs.map(([a, b]) => `${a} 号 ↔ ${b} 号`).join('，')
          : '本夜无人私聊。');
      },
    },

    '0c': {
      req: g => {
        const ids = new Set();
        for (const [a, b] of (g.pairs || [])) { ids.add(a); ids.add(b); }
        /* v22 C25/C50：异形队内频道每晚自动开启——不占私聊额度、不进 ① 公告 */
        for (const p of g.players) if (!p.out && p.faction === 'alien') ids.add(p.id);
        return [...ids].map(pid => ({ pid, kind: 'chat' }));
      },
      form: (g, p) => {
        const inPair = (g.pairs || []).some(([a, b]) => a === p.id || b === p.id);
        if (p.faction === 'alien' && !inPair) return {
          kind: 'chat', title: '步骤 0c · 队内私聊',
          desc: '异形队内频道：每晚自动开启，不占私聊额度，不进入 ① 公告（队内不留痕）。发言仅队友可见。',
          text: { label: '队内发言（可留空）' },
        };
        return {
          kind: 'chat', title: '步骤 0c · 私聊 · 正文',
          desc: '配对成功。写下你想说的话（内容不公开，配对本身已于批次①公告）。提交后对方会立即回复，回复显示在本页与「私人反馈」页签。',
          text: { label: '私聊内容（可留空）' },
        };
      },
      run(g) {
        const said = {};   // v22：同一句正文供配对与队内频道共用（AI 不双生成）
        for (const [a, b] of (g.pairs || [])) {
          const pa = P(g, a), pb = P(g, b);
          const da = g.decisions[a], db = g.decisions[b];
          /* 真人留空 = 不发言，AI 不代打；AI 留空才由系统生成一句模糊表态 */
          const sa = da && da.text ? da.text : (pa.isHuman ? null : global.AI.speak(g, pa, true));
          const sb = db && db.text ? db.text : (pb.isHuman ? null : global.AI.speak(g, pb, true));
          if (sa) priv(g, pb, `${a} 号（私聊）：${sa}`);
          if (sb) priv(g, pa, `${b} 号（私聊）：${sb}`);
          said[a.id] = sa || null; said[b.id] = sb || null;
          /* A6 批次 29（4.12.1）：配对私聊正文的结构化副本——0.2 窃听者的读取源。
             仅配对组正文入副本；异形队内频道走下方 council 分支、明文不入（4.12.3①）。 */
          (g.nightChats = g.nightChats || []).push({
            a, b,
            lines: [sa ? `${a} 号：${sa}` : null, sb ? `${b} 号：${sb}` : null].filter(Boolean),
          });
          /* v22 批次 3：私聊接 Bridge——正文产出 Claim（档一律 D）、进接收方证据台账（sourceId=pm）。
             priv() 的 inbox/replay 展示行为保留；弱化层钩子（onPrivate/onPrivateShare）保持不变。 */
          if (sa && global.Bridge) global.Bridge.privateSay(g, b, a, sa);
          if (sb && global.Bridge) global.Bridge.privateSay(g, a, b, sb);
          /* 8.2 私聊信息网络：接收方 AI 按内容弱化调整 known / 威胁度（claim / 指控 / 查验共享） */
          const NLP = global.NLP;
          if (sa) {
            if (pa.lastShare) global.AI.onPrivateShare(g, b, pa.lastShare);
            /* v32 机制对等：接收方是玩家时同样调用 onPrivate——私聊声称/指控进入玩家的
               known 弱记录与证据台账（此前玩家只看到文本，机制零落点）。 */
            if (NLP) global.AI.onPrivate(g, b, a, NLP.parse(sa, { speaker: a }));
          }
          if (sb) {
            if (pb.lastShare) global.AI.onPrivateShare(g, a, pb.lastShare);
            if (NLP) global.AI.onPrivate(g, a, b, NLP.parse(sb, { speaker: b }));
          }
          pa.lastShare = null; pb.lastShare = null;
          (g.privateChats = g.privateChats || []).push({ night: g.night, a, b, ta: sa, tb: sb });
          god(g, `私聊 ${a}↔${b}：${sa || '（沉默）'} / ${sb || '（沉默）'}`);
        }
        /* v22 C25/C50：异形队内私聊——每晚自动开启、不占额度、不进 ① 公告（不留公开痕）。
           与配对发言共用同一句正文（AI 不双生成）；仅队友 inbox 与 god 复盘可见。 */
        const council = g.players.filter(p => !p.out && p.faction === 'alien');
        for (const a of council) {
          const d = g.decisions[a.id];
          let text = said[a.id] != null ? said[a.id]
            : (d && d.text ? d.text : (a.isHuman ? null : global.AI.speak(g, a, true)));
          said[a.id] = text || null;
          if (!text) continue;
          for (const b of council) {
            if (b.id === a.id) continue;
            b.inbox.push({ night: g.night, step: g.step, text: `${a.id} 号（队内）：${text}` });
          }
          god(g, `队内私聊（不进①）：${a.id} 号：${text}`);
        }
      },
    },

    '0.5': {
      /* T20（2026-10-04 文本审查第二遍·实现缺陷修复）：A15/6.1.2① 明文沉默覆盖期为
         施加当夜【自步骤 0.5 起】的全部编号步骤——被沉默者不得使用感染抑制。
         此前 req/run 均未检查 silenceNight，被沉默者仍可抑制（实现与文案承诺相悖）。 */
      req: g => g.players.filter(p => !p.out && p.silenceNight !== g.night &&
                                     p.infection && p.infection.real && p.suppressLeft > 0)
                         .map(p => ({ pid: p.id, kind: 'suppress' })),
      form: (g, p) => ({
        kind: 'suppress', title: '步骤 0.5 · 感染抑制',
        desc: `你身上的感染将于第 ${p.infection.deathNight} 夜致死。使用抑制可延后 1 夜，但今夜失去全部主动技能。剩余 ${p.suppressLeft}/3 次。`,
        opts: [{ v: 'yes', label: '使用感染抑制', sub: '致死夜延后 1 夜，今夜不能行动' },
               { v: 'no', label: '不使用' }],
        skipLabel: null,
      }),
      run(g) {
        for (const p of g.players) {
          const d = g.decisions[p.id];
          /* 防御性复检：与 req 同门禁（被沉默者即便有残留决策也不生效） */
          if (!d || !d.use || p.out || p.silenceNight === g.night ||
              !p.infection || !p.infection.real || p.suppressLeft <= 0) continue;
          p.infection.deathNight += 1;
          p.suppressLeft -= 1;
          p.noActive = true;
          g.suppressCount += 1;
          priv(g, p, `感染抑制生效：致死延后至第 ${p.infection.deathNight} 夜，今夜失去主动技能。`);
        }
      },
    },

    '0.55': {
      run(g) {
        for (const p of g.players) {
          if (p.out) continue;
          /* A6 批次 31 · 4.6.4③：毒药致死——落身当夜为第 1 夜，**第 3 夜**步骤 0.55 致濒死，
             与感染致死同一时点、各自独立判定（2.1.4）。毒药标记于致濒死时**消耗并移除**，
             此后为纯濒死问题（4.6.4③表「消耗」）。〔通则 2.8.2⑥ 之例外 2.8.9(18)〕
             仅全额减免层可挡：安全室已于 applyLethal 判过；此处补外星人夜晚免疫，
             且**不消耗任何庇护类**（保护/巡逻/护甲/护盾一概不防）。 */
          if (p.poison && !p.dying && p.poison.night + 2 === g.night) {
            let blocked = false;
            /* 〔43〕夜晚免疫是经典外星人的**全额减免层**（6.4），按 role 判 —— 死囚不持（6.8.2） */
            if (ACT.isClassicXeno(p)) {
              if (p.immuneActiveNight != null && p.immuneActiveNight === g.night) blocked = true;
              else if (p.nightImmune > 0) { p.nightImmune -= 1; p.immuneActiveNight = g.night; blocked = true; }
            }
            if (blocked) {
              p.poison = null;
              priv(g, p, '夜晚免疫触发：本次毒药致死被拦下，毒药标记同时清除。');
            } else {
              p.poison = null;
              p.dying = true; p.dyingCause = 'poison';
              if (!p.deathCauses) p.deathCauses = [];
              if (p.deathCauses.indexOf('poison') < 0) p.deathCauses.push('poison');
              priv(g, p, '毒药发作，你进入濒死，须在步骤 8 被救援，否则步骤 9 死亡结算。');
              god(g, `${p.id} 号毒药发作致濒死（第 3 夜）`);
            }
          }
          if (!p.infection || !p.infection.real) continue;
          if (p.infection.deathNight !== g.night) continue;
          /* 〔43〕同 6.4：夜晚免疫按 role 判（死囚不持） */
          if (ACT.isClassicXeno(p) && p.nightImmune > 0) {
            p.nightImmune -= 1; p.immuneActiveNight = g.night;
            p.infection = null; p.cureSelf = 0;
            priv(g, p, '夜晚免疫触发：本次感染致死被拦下，感染标记同时清除。');
          } else {
            p.dying = true; p.dyingCause = 'infect';
            /* 4.10.6【感染单列】：感染致死单独记一项「感染」，与出刀／枪击／中毒并列，
               不并入任何一类；感染未致死（被夜晚免疫拦截／被抑制延后／被清除）者不记入。 */
            if (!p.deathCauses) p.deathCauses = [];
            if (p.deathCauses.indexOf('infect') < 0) p.deathCauses.push('infect');
            priv(g, p, '你因感染进入濒死，须在步骤 8 被救援，否则步骤 9 死亡结算。');
          }
        }
      },
    },

    '0.6': {
      req(g) {
        const out = [];
        for (const p of alive(g)) {
          if (!canAct(g, p)) continue;
          if (p.faction === 'alien') {
            if (!p.alien.dir) { if (g.night >= 3) out.push({ pid: p.id, kind: 'evolve' }); }
            else if (p.alien.converts < 2 && g.night > p.alien.evoNight) out.push({ pid: p.id, kind: 'convert' });
          }
          /* 〔43〕转职是**普通船员自身**的能力（4.2.1），变形者不得转职（6.8.3⑦）。
             死囚变形后 p.role 会变成 'crew'，hasGrant 照样为真 —— 不加这道门，它就能
             「不发动变形以外的方式」再切一次身份。 */
          if (RD.hasGrant(p.role, 'transfer') && !p.transferred && !ACT.isMorphed(p) &&
              (alive(g).length <= 6 || g.night >= 6))   // D6
            out.push({ pid: p.id, kind: 'transfer' });
        }
        return out;
      },
      form(g, p) {
        /* 永久占位制：占位不随死亡/转化释放（1.5），按 dirs 统计 */
        const occ = { destroy: 0, infect: 0, kill: 0 };
        for (const a of g.players) if (a.faction === 'alien')
          for (const k of ['destroy', 'infect', 'kill']) if (a.alien.dirs[k]) occ[k]++;
        if (p.faction === 'alien') {
          if (!p.alien.dir) {
            return {
              kind: 'evolve', title: '步骤 0.6 · 进化',
              desc: '第 3 夜起可进化，方向三选一，每方向全局最多 2 只占用（永久占位，不随死亡/转化释放）。',
              opts: [
                { v: 'destroy', label: '破坏进化', sub: '破坏量 +3.0/夜，推停摆', disabled: occ.destroy >= 2 },
                { v: 'infect', label: '感染进化', sub: '每夜至多感染 3 名，致死提前', disabled: occ.infect >= 2 },
                { v: 'kill', label: '击杀进化', sub: '出刀无冷却，额外出刀 1 次（次夜起可用）', disabled: occ.kill >= 2 },
                { v: 'none', label: '今夜不进化' },
              ],
            };
          }
          return {
            kind: 'convert', title: '步骤 0.6 · 转化',
            desc: `当前方向：${p.alien.dir}。转化剩余 ${2 - p.alien.converts}/2 次；转化当夜无任何行动，新方向次夜生效；次夜步骤 0.6 前死亡则回滚。`,
            opts: [
              { v: 'destroy', label: '转为破坏', disabled: occ.destroy >= 2 || p.alien.dir === 'destroy' },
              { v: 'infect', label: '转为感染', disabled: occ.infect >= 2 || p.alien.dir === 'infect' },
              { v: 'kill', label: '转为击杀', disabled: occ.kill >= 2 || p.alien.dir === 'kill' },
              { v: 'none', label: '不转化' },
            ],
          };
        }
        return {
          kind: 'transfer', title: '步骤 0.6 · 转职',
          desc: '你已获得转职资格（存活≤6 或第 6 夜）。转职一次性，当夜生效。转职后已获得的排除信息与阵营锁定结论继续保留，并在新职业界面沿用。',
          opts: [
            { v: 'armed', label: '武装船员', sub: '1 发子弹，击杀敌方回复', disabled: p.role === 'armed' },
            { v: 'assistant', label: '助理工程师', sub: '每夜维修 −1.0，累计 3.0 暴露' },
            { v: 'tempdoc', label: '临时医生', sub: '救援 1 次、治疗 2 次' },
            { v: 'none', label: '暂不转职' },
          ],
        };
      },
      run(g) {
        let evo = 0, conv = 0;
        for (const p of g.players) {
          const d = g.decisions[p.id]; if (!d || p.out) continue;
          if (d.dir && p.faction === 'alien' && !p.alien.dir) {
            p.alien.dir = d.dir; p.alien.evoNight = g.night; p.alien.dirs[d.dir] = true;
            evo += 1;   /* 额外出刀于次夜发放（5.4：进化当夜不可使用） */
            priv(g, p, `你已进化为「${{ destroy: '破坏', infect: '感染', kill: '击杀' }[d.dir]}」方向。`);
          } else if (d.do && d.dir && p.faction === 'alien' && d.dir !== p.alien.dir) {
            p.alien.dirs[d.dir] = true; p.alien.pendingDir = d.dir; p.alien.converts += 1;
            p.noActive = true;   /* 转化当夜无任何行动（5.5），刀数照常回复 */
            conv += 1;
            priv(g, p, `转化进行中，新方向将于次夜生效（今夜无行动；次夜步骤 0.6 前死亡则回滚）。`);
          } else if (d.dir && p.role === 'crew') {
            doTransfer(g, p, d.dir);
          }
        }
        let n = evo + (g.pendingEvolve || 0);
        g.pendingEvolve = conv;
        if (n > 0) announce(g, '②', `今夜有 ${n} 只异形进化。`);
      },
    },

    /* ===== A7 步位对齐（v6.6 2.1.1）：0.1 蛰伏（原步骤 1）=====
       6.1.1 蛰伏两步：①查验 → 结算给出结果 → ②可选沉默（'0.1s' 窗口）。
       蛰伏当夜不能击杀/破坏/自我治疗——以 p.branch='check' 提交，封锁 4b/5/8 相应选项；
       未蛰伏则 branch 保持 null，4b（破坏）与步骤 5（击杀）照常可选。
       6.1.1②：允许连续两夜对同一目标发动蛰伏（不设连夜限制，沉默侧限制见 0.1s）。 */
    '0.1': {
      /* 〔43〕蛰伏是**经典外星人技能**（6.1），按 role 判而非 faction —— 死囚阵营成员但无此技能（6.8.2） */
      req: g => g.players.filter(p => ACT.isClassicXeno(p) && !p.out && !p.branch && canAct(g, p))
                         .map(p => ({ pid: p.id, kind: 'xenoCheck' })),
      form: (g, p) => ({
        kind: 'xenoCheck', title: '步骤 0.1 · 外星人蛰伏 · 查验',
        desc: '查验 1 名其他存活玩家的编号与呈现职业（不报阵营，6.1.1①）。蛰伏当夜不能破坏（4b）、击杀（5）或自我治疗（8）。允许连续两夜对同一目标发动。',
        targets: formPlayers('aliveOthers', 1, 0),
        skipLabel: '今夜不蛰伏（保留破坏 / 击杀 / 自我治疗）',
      }),
      run(g) {
        for (const p of g.players) {
          if (p.faction !== 'xeno' || p.out) continue;
          const d = g.decisions[p.id]; if (!d || !d.target) continue;
          const t = P(g, d.target); if (!t || t.out) continue;
          p.branch = 'check';   /* 6.1.1：使用蛰伏的当夜不能击杀∕破坏∕自我治疗 */
          /* B5（6.1.1①）：蛰伏查验只揭示编号与呈现职业，不报阵营——known 只写职业，
             AI 侧阵营由 knownLockOf 依 ROLE2FACTION 从职业确定性推论（不透视） */
          p.known.set(t.id, { role: t.role });
          /* v24 规则 6.1：记录蛰伏目标与结果——沉默窗口（步骤 0.1s）据此询问，
             并把结果交给 AI/真人做「看到结果之后」的选择 */
          p.lastXenoCheck = { night: g.night, target: t.id };
          p.lastXenoCheckRes = { id: t.id, role: t.role, roleName: t.roleName };
          /* v32 批 5′：R10 蛰伏结果流水（单人私有，delta=0 占位） */
          if (global.MoE && global.MoE.absorbPrivate)
            global.MoE.absorbPrivate(g, p.id, t.id, `own:xeno:check:${g.night}`, 'fact');
          /* B5（6.1.1①/表 3-1）：不报阵营；转职者固定标注原职业 */
          const xc = global.RevealService.checkResult(t, 'xenoCheck');
          priv(g, p, `查验结果：${xc.id} 号（职业：${xc.roleName}）` +
                     (xc.originRole ? `（原职业：${xc.originRole}）` : ''));
          priv(g, t, '你被『外星人』查验。');
          g.checkCount = (g.checkCount || 0) + 1;
        }
      },
    },

    /* 6.1.2 沉默机制（蛰伏专属）：选择权在【看到查验结果之后】行使——拆成实现子步位，
       否则在不知道对方是谁的情况下决定沉默，违反规则时序。沉默只能指向本次查验的该目标。
       A15（6.1.2 152）：沉默【当夜生效】——覆盖期为施加当夜自步骤 0.5 起的全部编号步骤
       （0.2 窃听位于覆盖期之前不受封锁，2.8.3④附）；6.1.2(a)：不得连续两夜受沉默。 */
    '0.1s': {
      /* 〔43〕沉默是蛰伏的衍生物（6.1.2），同按 role 判 —— 死囚无蛰伏故无沉默 */
      req: g => g.players.filter(p => ACT.isClassicXeno(p) && !p.out &&
                                      p.lastXenoCheck && p.lastXenoCheck.night === g.night &&
                                      (() => { const t = P(g, p.lastXenoCheck.target);
                                               return t && !t.out && t.lastSilenceNight !== g.night - 1; })())
                         .map(p => ({ pid: p.id, kind: 'xenoSilence' })),
      form: (g, p) => {
        const r = p.lastXenoCheckRes || {};
        return {
          kind: 'xenoSilence', title: '步骤 0.1s · 蛰伏 · 可选沉默',
          desc: `查验结果：${r.id} 号（职业：${r.roleName || '—'}）。
                 是否对该目标施加【沉默】？（A15：沉默于【当夜】生效，封锁其自步骤 0.5 起的全部夜间主动技能；投票与私聊不受影响；该目标若昨夜已被沉默则本夜不可再沉默）`,
          opts: [{ v: 'no', label: '不施加沉默' }, { v: 'yes', label: `对 ${r.id} 号施加沉默` }],
        };
      },
      run(g) {
        for (const p of g.players) {
          if (p.faction !== 'xeno' || p.out) continue;
          const d = g.decisions[p.id];
          if (!d || !d.silence || !p.lastXenoCheck || p.lastXenoCheck.night !== g.night) continue;
          const t = P(g, p.lastXenoCheck.target);
          if (!t || t.out || t.lastSilenceNight === g.night - 1) continue;
          t.silenceNight = g.night;        /* A15：当夜生效（覆盖自步骤 0.5 起的编号步骤） */
          t.lastSilenceNight = g.night;    /* 6.1.2(a)：禁连两夜 */
          priv(g, t, '你已被【沉默】：当夜自步骤 0.5 起的夜间主动技能被封锁（投票与私聊不受影响）。');
          god(g, `蛰伏沉默：${p.id} 号对 ${t.id} 号施加沉默（当夜生效）`);
        }
      },
    },

    /* ===== A7 占位步（角色未实装，req 恒空自动跳过）===== */
    '0.2': {
      /* A6 批次 29 窃听（4.12.1，步骤 0.2 行动位）：位于 0c 私聊之后、0.5 之前——早于沉默
         覆盖期，故不受沉默与感染抑制封锁（2.8.3④附，时序确认非例外、不登记 2.8.9）。
         对象＝当夜批次①已公告配对组（g.pairs）∩ 当夜私聊正文（g.nightChats，0c 落副本）；
         异形队内频道不入副本故天然被排除（4.12.3①）。
         读取为无代价、无泄密面（被窃听者无察觉、不产生任何反馈）——引擎自动行使（读取的
         「可选择不读」策略空间随批次 22 拟人化），不设决策帧、零 rng。
         保留：wiretap={night, groups} 保留至次日白天 D-report 提交窗口，逾期作废（4.12.1④）。 */
      run(g) {
        const ls = g.players.find(p => p.role === 'listener' && !p.out);
        if (!ls) return;
        const chatOf = (a, b) => (g.nightChats || []).find(c =>
          (c.a === a && c.b === b) || (c.a === b && c.b === a));
        const groups = [];
        for (const [a, b] of (g.pairs || [])) {
          const c = chatOf(a, b);
          if (c && c.lines.length) groups.push({ a, b, lines: c.lines.slice() });
        }
        ls.wiretap = { night: g.night, groups };   // 每夜覆盖——上一夜读取随之作废（不跨夜累积）
        if (groups.length) god(g, `窃听：${ls.id} 号读取 ${groups.length} 组配对私聊（仅本人可见）`);
      },
    },
    '1': {
      /* A19 乔装（7.3，步骤 1 行动位）：位于 0.6 之后、步骤 2 之前，不占行动窗口，
         可与当夜任何行动并用（7.3.4）。每夜至多发动 1 次、每个体全局 2 次（7.3.1）。
         封锁：属夜间主动技能，受沉默与感染抑制封锁、濒死不可发动——canAct 全覆盖（2.8.3③/7.3.5）。
         效力：仅改当夜船员查验的判定基准（2.8.1③之三①——唯一可被乔装欺骗的查验）；
         神探查验、蛰伏查验、暴露、出局揭示均按真实呈现职业作答（7.3.2，本步不触碰 revealService）。
         伪装身份池＝船员第 2 次查证池（同步自适应，7.3.1/H21：ACT.verifyPool 全池）。
         可见性：异形队内互见、外星人仅本人可见（2.8.9⑥ 明文授予），不产生公告——god 留痕仅供复盘。
         1.4.1 明文寂灭期不冻乔装，故 EXTINCT 队列保留本步；人类全灭后乔装无收益但仍合法。 */
      /* 乔装（7.3）按**身份**判：异形与经典外星人各 2 次；死囚阵营成员但不持（6.8.2） */
      req(g) {
        return alive(g).filter(p => (p.role === 'alien' || ACT.isClassicXeno(p)) &&
                                    p.disguiseLeft > 0 && canAct(g, p))
                       .map(p => ({ pid: p.id, kind: 'disguise' }));
      },
      form(g, p) {
        const pool = ACT.verifyPool(g);
        return {
          kind: 'disguise', title: '步骤 1 · 乔装',
          desc: `伪装一个身份，今晚的船员查验将以此为准（每夜至多 1 次；剩余 ${p.disguiseLeft}/2）。` +
                '仅发动当夜有效；神探查验、暴露与出局揭示不受欺骗（7.3.2）。',
          opts: [{ v: 'none', label: '今晚不乔装' }]
            .concat(pool.map(r => ({ v: r, label: `伪装为「${D.ROLES[r].name}」` }))),
        };
      },
      run(g) {
        for (const p of orderedPlayers(g)) {
          const d = g.decisions[p.id];
          if (!d || p.out || !d.opt || d.opt === 'none') continue;
          if (p.disguiseLeft <= 0) continue;
          if (!D.ROLES[d.opt] || !ACT.inVerifyPool(g, d.opt)) continue;   // 池外不生效（运行侧收口，同 4.1.1③）
          p.disguise = { night: g.night, role: d.opt };
          p.disguiseLeft -= 1;
          god(g, `${p.id} 号乔装为「${D.ROLES[d.opt].name}」（剩余 ${p.disguiseLeft} 次）`);
        }
      },
    },
    '3.5': {
      /* A6 批次 29 嗅探（4.4.8，猎手专属）：步骤 3 之后、4a 之前，不占行动窗口、可与开枪并用。
         ①全局仅限 2 个夜晚（sniffLeft，用满永久不可用）；②每夜至多 2 名存活玩家（含自己）；
         ③查询「是否呈现保护状态」——一切非全额减免类抵挡层（保镖保护 guardDmg／警长巡逻
         patrolDmg／结茧护盾 shield＞0；工匠护甲随 artisan 实装补入）；
         ④不显示项：不区分何种保护、不报层数、不报来源与施加者编号；全额减免（工程师安全室
         safeRoomNight／外星人夜晚免疫）不在查询范围、不呈现保护状态（4.4.8⑤）；
         ⑤结果仅猎手本人可见（priv），不产生公告（2.8.7）；⑥受沉默与感染抑制封锁（canAct）。
         与攒弹的时序绑定：嗅探先于步骤 6 结算，故「攒弹当夜不可嗅探」（4.4.7②b）实现为
         「当晚已嗅探者步骤 6 的攒弹项置灰」——同一约束自另一侧表达。 */
      req(g) {
        return alive(g).filter(p => p.role === 'hunter' && p.sniffLeft > 0 && canAct(g, p))
                       .map(p => ({ pid: p.id, kind: 'sniff' }));
      },
      form(g, p) {
        return {
          kind: 'sniff', title: '步骤 3.5 · 嗅探（剩余 ' + p.sniffLeft + '/2 夜）',
          desc: '查询至多 2 名存活玩家当夜是否呈现保护状态（不区分是何种保护、不报来源）。全额减免（安全室/夜晚免疫）不在此列。与今夜开枪并用互不妨碍；但选了嗅探的夜晚不可再选攒弹。',
          targets: formPlayers('alive', 2, 0),
          skipLabel: '今夜不嗅探（不耗次数）',
        };
      },
      run(g) {
        for (const p of orderedPlayers(g)) {
          const d = g.decisions[p.id];
          if (!d || p.out || !d.targets || !d.targets.length) continue;
          if (p.role !== 'hunter' || p.sniffLeft <= 0) continue;
          p.sniffLeft -= 1;                       // 按「夜晚」计消耗（4.4.8⑧），与目标数无关
          p.sniffedTonight = true;
          for (const id of d.targets) {
            const t = P(g, id);
            if (!t || t.out) continue;
            const guarded = !!(t.guardDmg || t.patrolDmg || t.shield > 0);
            priv(g, p, `嗅探：${t.id} 号${guarded ? '呈现保护状态' : '未呈现保护状态'}。`);
            /* 〔批次 37 · U1〕结构化留档：同一信息玩家在 priv 文本里、AI 决策层读结构形态
               （decide 'shoot' 反哺开枪名单）——不新增知情，只是机读形态。 */
            (p.sniffLog = p.sniffLog || []).push({ night: g.night, id: t.id, guarded });
            god(g, `嗅探：${p.id} 号查 ${t.id} 号 → ${guarded ? '有保护' : '无保护'}（不报何种/来源）`);
          }
        }
      },
    },

    '2': {
      /* A7：2b 巡逻并入步骤 2（v6.6 2.1.1——步骤 2 = 查验/巡逻：船员查验、神探查验或公告、警长巡逻） */
      req(g) {
        const out = [];
        for (const p of alive(g)) {
          if (!canAct(g, p)) continue;
          if (p.role === 'crew') out.push({ pid: p.id, kind: 'crewAction' });
          if (p.role === 'detective') out.push({ pid: p.id, kind: 'detective' });
          if (p.role === 'sheriff' && !p.patrolUsed && g.night <= 3) out.push({ pid: p.id, kind: 'patrol' });
        }
        return out;
      },
      form(g, p) {
        if (p.role === 'crew') {
          /* A13（4.1.1 验证式）：提交待查证身份→系统答「是/否」。第 1 次池=开局公告人类职业
             （仅 1 个身份）；第 2 次起=全职业池，可提交 1~2 个。两池均由推导层给出
             （H21：随本局构成浮动 + 移除全部持有者已出局的职业）。 */
          const firstPool = ACT.verifyPool(g, { first: true });
          const laterPool = ACT.verifyPool(g);
          const idOpts = laterPool.map(r => ({ v: r, label: D.ROLES[r].name }));
          return {
            kind: 'crewAction', title: '步骤 2 · 船员行动',
            desc: '每夜「查验」（验证式：提交待查证身份，系统答是/否）。协助维修属卡载的独立窗口（步骤 4a），二者当夜二选一：此处查验即当夜不再有协助维修窗口。' +
                  '身份①为必答项；身份②仅第 2 次及以后对该目标的查验生效（可提交 1~2 个，各自独立作答）。' +
                  (g.stopNight ? ' ⚠ 停转夜（来源：外星人破坏）：本夜维修无效、倒计时不流逝。' : ''),
            opts: [{ v: 'check', label: '查验 1 名玩家（验证式）' }]
              .concat([{ v: 'none', label: '放弃行动（本夜不协助维修）' }]),
            targets: formPlayers('aliveOthers', 1, 0),
            num: { label: '待查证身份①（第 1 次查验限开局公告人类职业）',
                   options: firstPool.map(r => ({ v: r, label: D.ROLES[r].name })) },   // H21：首次池（不再误用全池）
            num2: { label: '待查证身份②（不提交 / 第 2 次起可用）',
                    options: [{ v: 'none', label: '不提交' }].concat(idOpts) },
          };
        }
        if (p.role === 'sheriff') {
          return {
            kind: 'patrol', title: '步骤 2 · 巡逻',
            desc: '全局 1 次，仅限前 3 夜。指定 1~3 名玩家获得当夜保护（各挡 1 点伤害 + 1 次感染，双计数独立）。与当夜开枪互斥。',
            opts: [{ v: 'yes', label: '使用巡逻' }, { v: 'no', label: '不使用（保留开枪）' }],
            targets: formPlayers('alive', 3, 0),
          };
        }
        const pool = [...p.checkPool.entries()].map(([id, v]) => ({ id: +id, v }))
          .filter(x => !P(g, x.id).out);
        return {
          kind: 'detective', title: '步骤 2 · 神探',
          desc: '每夜在「查验 1 人真实身份」与「发布一条官方公告」之间二选一。',
          opts: [{ v: 'check', label: '查验 1 名玩家' },
                 { v: 'announce', label: '发布公告', sub: '从已查验池选 1 名仍存活者公开身份', disabled: !pool.length },
                 { v: 'none', label: '放弃行动' }],
          targets: formPlayers('aliveOthers', 1, 0),
          /* B5（4.7.3，待拍板 I9）：池内只存查验当夜呈现职业、不标注阵营（4.7.1 明文查验不报阵营） */
          pool: pool.map(x => ({ id: x.id, label: `${x.id} 号 · ${D.ROLES[x.v.role].name} · 第 ${x.v.night} 夜查验` })),
        };
      },
      run(g) {
        let checks = 0;
        for (const p of g.players) {
          const d = g.decisions[p.id]; if (!d || p.out) continue;

          if (p.role === 'crew' && d.mode === 'repair') p.repairValue = d.value || 0.3;
        /* 【v7 裁定②】查验与协助维修当夜互斥（卡：二者当夜二选一）。
           本行不设置任何新判断——上面的三路效用比较（uCheck / uRepair / 不做）与改动前逐字一致，
           此处只把「若本夜真查验」这一事实登记为 branch，供 4a 的 !p.branch 过滤使用。
           二者互斥由此真正成立（而非靠「同一张菜单」的隐式保证）。
           p.branch 每夜由 engine.js 的到账后重置清零，不会跨夜残留。 */
        if (p.role === 'crew' && d.mode === 'check') p.branch = 'check';

          if (p.role === 'crew' && d.mode === 'check' && d.target) {
            const t = P(g, d.target); checks += 1;
            let rec = p.crewChecks.get(t.id);
            if (!rec) { rec = { n: 0, results: [] }; p.crewChecks.set(t.id, rec); }
            rec.n += 1;
            /* A19（2.8.1③之三①）：判定基准＝查证呈现身份——目标当夜处于乔装状态时以其
               伪装身份为基准（唯一可被乔装欺骗的查验，查验者无从察觉被欺骗）；
               无乔装即当前职业。转职者身份底册仍含「普通船员」，查「普通船员」恒答「是」
               （4.1.1/4.2.1①）。「否」为统一口径，不区分「是人类但非该身份」与「根本不是人类」。
               4.1.1①/②/③：第 1 次池=开局公告人类职业（8 项）；第 2 次起=开局公告全职业池
               （随构成浮动，I3 拍板），已出局职业自池移除（按真实持有者 originRole 判）。
               池外提交不作答（实现限制：表单候选静态，run 侧收口，不消耗额外额度——同一夜
               1~2 个身份合计计 1 次查验）。 */
            const basis = (t.disguise && t.disguise.night === g.night) ? t.disguise.role : t.role;
            const ansOf = id => (t.transferred && id === 'crew') || id === basis;
            for (const id of (Array.isArray(d.ids) ? d.ids : [])) {
              /* H21（4.1.1 ①②③）：候选池由推导层统一给出——首次＝开局公告人类职业，
                 其后＝开局公告全职业池；两者都移除「全部真实持有者均已出局」的职业，
                 故不存在无效查证（池外提交不作答）。 */
              if (!D.ROLES[id] || !ACT.inVerifyPool(g, id, { first: rec.n <= 1 })) continue;
              const ans = ansOf(id);
              rec.results.push({ night: g.night, id, ans });
              priv(g, p, `${t.id} 号是「${D.ROLES[id].name}」吗——${ans ? '是' : '否'}。`);
            }
            /* v28 排除类证据通道随排除式一并退役（A13）：验证式答案为查验者私有信息（7.0），
               不写 known 排除/锁定；被查验者侧 7.2.1 反馈保留。 */
            priv(g, t, '你被『普通船员』查验。');
          }

          /* 2b 并入 2（A7）：警长巡逻——全局 1 次、限前 3 夜、指定 1~3 名当夜保护（4.4.4，可含自己）；
             与当夜开枪互斥（patroledTonight 于步骤 6 排除开枪）。A12：伤害侧/感染侧双计数独立。 */
          if (p.role === 'sheriff' && d.use) {
            p.patrolUsed = true; p.patroledTonight = true;
            for (const id of d.targets || []) { const t = P(g, id); if (t && !t.out) { t.patrolDmg = true; t.patrolInf = true; } }
            g.patrolCount = (d.targets || []).length;
            priv(g, p, `巡逻生效：${(d.targets || []).join('、') || '（无人）'} 号获得当夜保护。`);
            /* v32 批 5′：R03 巡逻结果流水（单人私有，delta=0 占位） */
            if (global.MoE && global.MoE.absorbPrivate) {
              for (const id of (d.targets || [])) { const t = P(g, id); if (t && !t.out) global.MoE.absorbPrivate(g, p.id, t.id, `own:sheriff:patrol:${g.night}`, 'fact'); }
            }
          }

          if (p.role === 'detective' && d.mode === 'check' && d.target) {
            const t = P(g, d.target); checks += 1;
            /* B5（4.7.3，待拍板 I9）：池内只存查验当夜呈现职业，不报阵营 */
            p.checkPool.set(t.id, { id: t.id, role: t.role, night: g.night, published: false });
            /* v32 批 5′：R02 已查验池流水（单人私有，delta=0 占位，量级留 7′） */
            if (global.MoE && global.MoE.absorbPrivate)
              global.MoE.absorbPrivate(g, p.id, t.id, `own:detective:check:${g.night}`, 'fact');
            /* B5（4.7.1）：恒得当前职业，不报阵营、无任何附加信息（无原职业标注） */
            const dc = global.RevealService.checkResult(t, 'detectiveCheck');
            priv(g, p, `查验结果：${dc.id} 号（职业：${dc.roleName}）`);
            priv(g, t, '你被『神探』查验。');
          }

          if (p.role === 'detective' && d.mode === 'announce' && d.target) {
            const rec = p.checkPool.get(d.target);
            const t = P(g, d.target);
            if (rec && t && !t.out) {   /* 池内目标出局即移除，不可再发布（4.7③） */
              rec.published = true;     /* 4.7：只置发布标记，不改写池内快照——转职探测的前提 */
              rec.pubNight = g.night;   /* v31 批 2（A3）：发布夜次——神探预告类承诺（A01/A02）的兑现判据 */
              /* B5（4.7.2/4.7.5）：限于编号与呈现职业两项，不报阵营；转职者固定标注原职业。
                 P1-a 公告 IR：节点由揭示出参构造，模板渲染统一走 AnnounceIR——
                 2.8.12③ 差量在 AIR.SCHEMA 一处登记，调用点不再手拼揭示字段。 */
              const cr = global.RevealService.checkResult(t, 'detectiveAnnounce');
              announce(g, '③', '【神探公告】' + global.AnnounceIR.render(global.AnnounceIR.detective(cr)));
              /* v26→B5：硬源经 known 写入全体观察者（knownLockOf 唯一路径；不写阵营，2.8.12④） */
              global.RevealService.reveal(g, t, 'detectiveAnnounce');
            }
          }
        }
        g.checkCount = (g.checkCount || 0) + checks;
        g.actCounts.check += checks;
        if (g.checkCount > 0 || g.patrolCount)
          announce(g, '③', `今夜查验出手 ${g.checkCount} 人次` +
            (g.patrolCount ? `；巡逻指定 ${g.patrolCount} 名` : ''));
      },
    },

    /* ===== A7：2b 巡逻已并入步骤 2（v6.6 2.1.1 步骤 2 = 查验/巡逻）===== */

    '4b': {
      /* v6.6 2.1.1/5.8.1：破坏与结茧于步骤 4b 结算（第 4 步的两个分支，当夜二选一），选此者跳过步骤 7
         （p.branch 标记）。外星人选破坏 → 跳过蛰伏(0.1)与击杀(5)；异形选破坏/结茧 → 跳过步骤 7。
         寂灭期（拍板 I1/1.4.1）：破坏分支冻结（表单禁用），结茧分支仍可选；决斗期破坏照常（1.4.2 仅取消白天）。
         结茧目标任意存活玩家（A14/5.7①），每目标同时至多 1 层，施加当夜依 7.2.6 告知。 */
      /* 〔43〕外星人分支按 role 判（死囚无破坏额度 6.8.2）；异形按 faction 判（变形可克隆异形）
         —— 变形为异形者 faction 仍是 xeno，但 role==='alien'，故异形分支必须走 role 判，
         否则「变形为异形的死囚」会掉进外星人破坏分支。 */
      req: g => alive(g).filter(p => (p.role === 'alien' || (ACT.isClassicXeno(p) && p.destroyLeft > 0)) &&
                                     !p.branch && canAct(g, p))
                         .map(p => ({ pid: p.id, kind: 'branch' })),
      form(g, p) {
        if (ACT.isClassicXeno(p)) {
          const sabOpts = [];
          for (let v = 20; v <= 30; v++) sabOpts.push({ v, label: (v / 10).toFixed(1) });
          return {
            kind: 'branch', title: '步骤 4b · 破坏',
            desc: '全局 1 次：破坏量 2.0~3.0 自选；破坏后次夜停转（停转夜是外星人破坏唯一留下的公开足迹，3.2.5）。本夜已蛰伏者不可破坏（6.1.1）。',
            opts: [{ v: 'destroy', label: '本夜破坏', sub: '次夜停转；当夜不能击杀/自我治疗', disabled: !!g.extinction },
                   { v: 'none', label: '不破坏' }],
            num: { label: '破坏量（自选档）', options: sabOpts },
          };
        }
        const big = p.alien.dir === 'destroy';
        const lo = big ? 20 : 15, hi = big ? 30 : 20;
        const sabOpts = [];
        for (let v = lo; v <= hi; v++) sabOpts.push({ v, label: (v / 10).toFixed(1) });
        return {
          kind: 'branch', title: '步骤 4b · 破坏 / 结茧',
          desc: (g.extinction ? '寂灭时刻：破坏冻结，仅可结茧或保留步骤 7（出刀/感染）。' : '破坏与结茧于本步结算（当夜二选一），选此者跳过步骤 7。') +
                (big ? '破坏量 2.0~3.0 自选。' : '破坏量 1.5~2.0 自选。'),
          opts: [
            { v: 'destroy', label: '破坏', sub: '计入个体累计，达 6.0 暴露', disabled: !!g.extinction },
            { v: 'cocoon', label: '结茧', sub: '指定任意 1 名存活玩家施加护盾（A14/5.7①）' },
            { v: 'none', label: '都不选（保留步骤 7）' },
          ],
          num: { label: '破坏量（自选档）', options: sabOpts },
          targets: formPlayers('alive', 1, 0),
        };
      },
      run(g) {
        let alienN = 0, other = 0, total10 = 0, destroyEvoN = 0;    // 破坏量整数存储（×10）；A20 破坏进化只数
        const exposed = [];
        for (const p of orderedPlayers(g)) {
          const d = g.decisions[p.id];
          if (p.out || !d || !d.branch || d.branch === 'none') continue;
          p.branch = d.branch;                     /* 选定破坏/结茧 → 跳过步骤 7（5.8.1） */
          if (d.branch === 'destroy') {
            /* 〔43〕两侧都改按 role 判。外星人侧：死囚 destroyLeft 恒 0，按 faction 判会在
               「变形为异形的死囚」上走进 xeno 分支却因额度为 0 而**整个破坏落空**（选了没反应）。
               异形侧：变形为异形的死囚 faction 仍是 xeno，按 faction 判拿不到异形破坏分支。 */
            if (ACT.isClassicXeno(p) && p.destroyLeft > 0) {
              let amt10 = typeof d.num === 'number' ? d.num : 20;
              if (amt10 < 20 || amt10 > 30) amt10 = 20;
              g.net10 += amt10; p.destroyLeft -= 1; other += 1; total10 += amt10;
              /* 6.8.6②〔通则 3.2.5 之例外〕：死囚呈现异形时破坏，按**字面身份**为异形，
                 故不触发停转夜——停转夜的触发主体仅为经典外星人的破坏。 */
              if (!p.convict) g.pendingStop = true;
              god(g, `${p.id} 号（外星人）破坏 +${(amt10 / 10).toFixed(1)}${p.convict ? '（死囚，不触发停转夜 6.8.6②）' : '（次夜停转）'}`);
            } else if (p.role === 'alien') {
              const big = p.alien.dir === 'destroy';
              let amt10 = typeof d.num === 'number' ? d.num : (big ? 20 : 15);
              if (amt10 < (big ? 20 : 15) || amt10 > (big ? 30 : 20)) amt10 = big ? 20 : 15;
              g.net10 += amt10; p.alien.destroyTotal10 += amt10; alienN += 1; total10 += amt10;
              if (big) destroyEvoN += 1;           /* A20（3.2.6①）：破坏进化异形执行破坏 → 次夜维修效力削减 */
              p.guardStreak = 0;                   /* 破坏属主动行为：疲劳归零 */
              god(g, `${p.id} 号破坏 +${(amt10 / 10).toFixed(1)}（个人累计 ${(p.alien.destroyTotal10 / 10).toFixed(1)}）`);
              if (!p.destroyedExposed && p.alien.destroyTotal10 >= 60) {      // 3.2 破坏者暴露阈值 6.0
                p.destroyedExposed = true;
                /* B5（2.8.12④）：只报「编号＋呈现职业」，不写阵营——乔装实装后
                   公告随其当夜呈现身份报出（伪金水路径 6.8.3⑧ 的前提） */
                global.RevealService.reveal(g, p, 'expose');
                global.AI.onExpose(g, p.id, 32, 'destroy');  // R23 破坏者暴露 → 威胁度事件
                /* P1-a 公告 IR：结构化收集（id＋呈现职业名），条款文本由 AnnounceIR 渲染 */
                exposed.push({ id: p.id, roleName: D.ROLES[p.role].name });
              }
            }
          } else if (d.branch === 'cocoon' && p.role === 'alien') {
            /* A14/5.7①：结茧指定任意 1 名存活玩家（不限阵营，含自身）；每目标同时至多 1 层，
               被打破后可再施加。目标已持盾/非法 → 落空：仍耗当夜行动、不返还、不获提示（5.7⑨）。
               7.2.6：施加当夜向被施加者送达「你获得一层护盾」，不含施加者信息。 */
            const t = d.cocoonTarget != null ? P(g, d.cocoonTarget) : null;
            if (t && !t.out && t.shield <= 0) {
              t.shield = 1;
              priv(g, t, '你获得一层护盾。');
              god(g, `${p.id} 号结茧 → ${t.id} 号获得护盾`);
            } else {
              god(g, `${p.id} 号结茧落空（目标非法或已持盾）`);
            }
          }
        }
        /* A20（3.2.6①）：当夜执行破坏的破坏进化异形只数 → 次夜（紧随其后的一夜）维修效力削减比例。
           1 只→25%、2 只→50%（1.5.1 每方向至多 2 只占位，上限即 50%）；未进化异形与外星人不触发。
           可见性依 2.8.13⑤：不公告、不进批次、不提示（7.0 由玩家依破坏总量骤增与次夜维修偏低自行推断）。
           停转夜优先级在 4a 消费侧结算（2.8.13③：停转夜视为 100%，不叠加不递补）。 */
        g.repairCutNext = destroyEvoN >= 2 ? 50 : (destroyEvoN === 1 ? 25 : 0);
        const fired = [];
        /* v6.6 2.3 表 #1/#2：停摆 3.0 档 +2.5、6.0 档 +5.0；#3 9.0 永久失效不变。
           1.3.2：同夜跨越多档奖励累加；已触发的奖励不回滚。 */
        for (const tier of [3, 6]) {
          if (g.net10 >= tier * 10 && !g.tiers[tier]) {
            g.tiers[tier] = true;
            g.countdown += (tier === 3 ? 2.5 : 5.0);
            fired.push(`净破坏量达 ${(tier / 10).toFixed(1)} → 倒计时 +${tier === 3 ? 2.5 : 5.0}`);
          }
        }
        if (g.net10 >= 90 && !g.tiers[9]) {
          g.tiers[9] = true;
          fired.push('净破坏量达 9.0 → 人类倒计时胜利永久失效');
          banner(g, '净破坏量达 9.0：人类倒计时胜利永久失效，只能靠清场取胜。');
        }
        g.actCounts.destroy += alienN;
        if (other) g.actCounts.otherDestroy += 1;
        /* 批次⑤合并口径：只报当夜总破坏量 T，不报只数、不分来源；T=0 不发布（不发布即该夜无破坏）。
           破坏者暴露条款走公告 IR（2.8.12④：节点无阵营字段，2.8.12③ 差量登记于 AIR.SCHEMA）。 */
        let txt = `本夜破坏总量：${(total10 / 10).toFixed(1)}`;
        if (exposed.length) txt += '；' + global.AnnounceIR.render(global.AnnounceIR.expose('破坏者暴露', exposed));
        if (fired.length) txt += `；${fired.join('；')}`;
        if (total10 > 0) announce(g, '⑤', txt);
      },
    },

    '3': {
      /* v6.6 2.3 表 #8：工程师第 1 夜被动全能免疫移除，改限定技「安全室」（4.3.1，全局 1 次），
         与保镖保护同属步骤 3 防御类判定 */
      /* C5：行动位声明驱动。此处必须用 sendersAt（角色主行动位 ∪ **机制声明行动位**）：
         工程师的主行动位是 4a，而「安全室」由机制声明在步骤 3 —— 只用 rolesAt('3')
         会把工程师的安全室整个滤掉（本处曾是行为指纹抓到的真实回退）。 */
      req: g => g.players.filter(p => !p.out && canAct(g, p) &&
                          ACT.sendersAt('3').indexOf(p.role) >= 0 &&
                          (RD.hasGrant(p.role, 'protect') || RD.hasGrant(p.role, 'craft') || !p.safeRoomUsed))
                         .map(p => ({ pid: p.id, kind: p.role === 'bodyguard' ? 'guard' : (RD.hasGrant(p.role, 'craft') ? 'craft' : 'safeRoom') })),
      form(g, p) {
        if (p.role === 'bodyguard') return {
          kind: 'guard', title: '步骤 3 · 保镖保护',
          desc: '每夜保护 1 人（可为自己），抵挡 1 点伤害与 1 次感染。不可连续两夜保护同一目标。',
          targets: formPlayers('alive', 1, 0, [p.lastProtected]),
          skipLabel: '今夜放弃保护',
        };
        /* A6 批次 31 · 工匠（4.11.2）：每夜于「常规铸造 / 速成铸造 / 分配」三者择一，不可兼选。
           2.9⑤ 独占性：两种铸造是投入夜数不同的两个独立进程，同一时期仅可存在一个未完成进程
           （表单据此置灰在进者）；2.9⑩ 铸造仅在其投入夜与分配互斥，中断夜不受此限。 */
        if (RD.hasGrant(p.role, 'craft')) {
          const castSt = PROC.stateOf(p, 'cast');
          const fastSt = PROC.stateOf(p, 'castFast');
          const busy = castSt || fastSt;
          const opts = [
            { v: 'cast', label: '常规铸造（2 夜 → 1 件常规护甲）',
              sub: castSt ? `进度 ${castSt.progress}/2（已暂停，不回退）` : '存续型：铸成后不因夜末失效',
              disabled: !!fastSt },
            { v: 'castFast', label: '速成铸造（1 夜 → 1 件速成护甲）',
              sub: '第 2/3 夜生效、第 4 夜自动消失（不返还不折算）',
              disabled: !!castSt },
            { v: 'give', label: `分配（库存 ${p.armorStock}/2）`,
              sub: '占用 1 夜；可一次性分配给多名（含自身），份数＝当前库存；发出即锁死不可收回',
              disabled: p.armorStock <= 0 },
            { v: 'none', label: '今夜不行动' },
          ];
          return {
            kind: 'craft', title: '步骤 3 · 工匠（铸造 / 分配）',
            desc: '护甲：挡 1 点伤害 ＋ 挡 1 次感染（双计数独立），对毒伤无效（4.6.4③）。'
                  + '你当前持有：' + (p.armor && p.armor.mode
                      ? (p.armor.mode === 'fast' ? `速成护甲（第 ${p.armor.expireNight} 夜到期）` : '常规护甲')
                      : '无')
                  + `。库存 ${p.armorStock} 件（上限 2，不含你自带的那件）。`
                  + (busy ? ' ※ 同一时期仅可存在一个未完成铸造进程（2.9⑤）。' : ''),
            opts,
            targets: formPlayers('alive', Math.max(1, Math.min(2, p.armorStock)), 0),
          };
        }
        return {
          kind: 'safeRoom', title: '步骤 3 · 安全室（限定技 · 全局 1 次）',
          desc: '进入安全室：当夜所有伤害免疫、同时抵挡感染，不消耗任何其他抵挡层（4.3.1）。代价：当夜放弃维修与追加维修。',
          opts: [{ v: 'yes', label: '进入安全室' }, { v: 'no', label: '不进入（保留维修）' }],
          skipLabel: '今夜不进入',
        };
      },
      run(g) {
        for (const p of orderedPlayers(g)) {
          const d = g.decisions[p.id];
          /* A6 批次 31 · 工匠三选一结算（4.11.2）：铸造/分配互斥，取当夜单次出手。
             分配份数＝当前库存（2.5 额度制）；同一目标至多持有 1 件，重复分配依 2.5 落空、
             不转他人（4.11.1④）。 */
          if (RD.hasGrant(p.role, 'craft') && !p.out && d) {
            if (d.opt === 'cast' || d.opt === 'castFast') {
              const pid = d.opt === 'cast' ? 'cast' : 'castFast';
              const other = pid === 'cast' ? 'castFast' : 'cast';
              if (!PROC.stateOf(p, other)) {          // 2.9⑤ 独占性：另一铸造在进则不得并进
                PROC.invest(g, p, pid, PROCD.get(pid).productChoices[0], { say: t => priv(g, p, t) });
                if (pid === 'castFast') god(g, `${p.id} 号速成铸造投入（第 1 夜，当夜不生效）`);
              }
            } else if (d.opt === 'give') {
              const ids = (d.targets || []).slice(0, p.armorStock);
              /* 速成/常规由**库存里实际的产物形态**决定，而非"在进的进程"：
                 到账前的那件存在 doneKey（castFastDone / castDone）里，尚不占库存、不可分配。 */
              const fastDone = !!(p.castFastDone && p.castFastDone !== 'normal');
              let gave = 0, wasted = 0;
              for (const id of ids) {
                if (p.armorStock <= 0) break;
                const t = P(g, id);
                if (!t || t.out) { wasted += 1; continue; }          // 落空仍消耗额度、不返还（2.5）
                if (t.armor && t.armor.mode) { wasted += 1; continue; }  // 4.11.1④ 至多 1 件，不转赠
                p.armorStock -= 1; gave += 1;
                t.armor = { mode: fastDone ? 'fast' : 'normal', expireNight: fastDone ? g.night + 3 : null };
                t.armorBy = p.id;
                priv(g, t, fastDone ? '你获得一件速成护甲（第 4 夜消失）。' : '你获得一件护甲。');
                god(g, `${p.id} 号分配护甲 → ${t.id} 号${fastDone ? '（速成）' : ''}`);
              }
              if (gave) priv(g, p, `你分配了 ${gave} 件护甲${wasted ? `，${wasted} 次落空（不返还）` : ''}。`);
            }
          }
          if (p.role === 'bodyguard' && !p.out) {
            /* 4.8：放弃保护（或未指定）即解除连续限制，隔夜后可再保原目标 */
            if (!d || d.target == null) { p.lastProtected = null; }
            else {
              const t = P(g, d.target);
              if (!t || t.out) { p.lastProtected = null; }
              else {
                /* A12 双计数独立（2.8.2⑤/4.8.1）：保护在伤害侧与感染侧各计 1 单位、独立消耗 */
                t.guardDmg = true; t.guardInf = true; t.guardedBy = p.id;
                p.lastProtected = t.id;
                priv(g, p, `你保护了 ${t.id} 号。`);
                /* v32 批 5′：R04 保护目标流水（单人私有，delta=0 占位） */
                if (global.MoE && global.MoE.absorbPrivate)
                  global.MoE.absorbPrivate(g, p.id, t.id, `own:bodyguard:guard:${g.night}`, 'fact');
              }
            }
          }
          /* 4.3.1：安全室——当夜全额减免（engine.js 层序首位）；当夜放弃维修与追加维修
             经 noActive 封锁 4a（canAct 判定） */
          if (RD.hasGrant(p.role, 'safeRoom') && !p.out && d && d.use && !p.safeRoomUsed) {   // D6：能力标签
            p.safeRoomUsed = true; p.safeRoomNight = g.night; p.noActive = true;
            priv(g, p, '你已进入安全室：当夜所有伤害免疫、同时抵挡感染；今夜维修与追加维修不可用。');
            god(g, `${p.id} 号进入安全室（当夜全额减免）`);
          }
        }
      },
    },

  /* 【v7 裁定②】协助维修持有者判定。
     SKRoleDecl **未导出** chargeOf 访问器（只有 hasGrant 读 grants），charges 只能按
     ROLE_DECL[role].charges 直读——与 derivation/actions.js 的 rolesAt 读 actionStep 同一路。
     ⚠ 此前这里写 `RD.chargeOf && RD.chargeOf(...)`：因 chargeOf 为 undefined，守卫短路为假，
       船员表单永不出现（互斥探针实测 crewRepair 命中 0 次才暴露）。
     req 与 form 共用本函数，两者判据因此**按构造同源**，不会像上次那样各自漂移。 */
    '4a': {
      /* 3.2 停转夜：维修选项保持可选（保留「放弃行动」与「行动无效」的可区分性），结算时判无效并随 ④ 公告 */
      /* 【v7 裁定②】派发过滤改用 actionSlots 而非 canActAt：
         canActAt 只认**主**行动位（derivation/actions.js 的 rolesAt 按 actionStep === step 过滤），
         次要行动位对它无效 ⇒ 声明了的 '4a' 只落在纸面，派发认不到（等于造一个报不出的幽灵步位）。
         改用 actionSlots 后，本步会同时接纳「主行动位属 4a」与「次要行动位含 4a」的角色；
         今日除船员外无任何角色把 4a 列为次要位 ⇒ 此改动当前行为保持。
         !p.branch 即卡上的互斥：步骤 2 真查验的船员已写 branch='check'，本步不再向他派发。 */
      req: g => alive(g).filter(p => ACT.actionSlots(p.role).indexOf('4a') >= 0 && !p.branch && canAct(g, p))
        /* kind 必须与 form 用**同一个判据**（hasAssistRepair），否则 req.kind ↔ form.kind 会分叉
           （探针断言「死囚O：req.kind ↔ form.kind 逐次一致」即为此存在）。
           assistRepair 持有者（含变形成船员的死囚——按 role 判，变身后即成立）走 crewRepair。 */
        .map(p => ({ pid: p.id, kind: hasAssistRepair(p) ? 'crewRepair' : 'repair' })),
      form(g, p) {
        /* 【v7 裁定②】船员协助维修：卡载独立窗口步骤 4a，与步骤 2 的查验当夜互斥。
           7 档自选值 a ∈ [0.20,0.50] 步长 0.05（卡载逐档相符）；已真做了查验的船员被本步
           req 的 !p.branch 过滤掉，故不会同时出现在两个窗口。
           引擎不手写角色键（D6）：以 charge 键 assistRepair 的持有者为唯一判据。 */
        /* 判据与 req.map 共用 hasAssistRepair（见其定义处注释）。 */
        if (hasAssistRepair(p)) {
          return {
            kind: 'crewRepair', title: '步骤 4a · 协助维修',
            desc: '协助维修：同时削减倒计时与净破坏量（步骤 2 已用查验的船员当夜不会出现在此处）。' +
                  (g.stopNight ? ' ⚠ 停转夜：本夜维修无效、倒计时不流逝。' : ''),
            opts: [0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50]
              .map(v => ({ v: 'assist' + v.toFixed(2), label: `协助维修 −${v.toFixed(2)}`,
                sub: '同时削减倒计时与净破坏量' + (g.stopNight ? '（停转夜无效）' : '') }))
              .concat([{ v: 'none', label: '放弃协助维修' }]),
          };
        }
        /* v6.6 2.3 表 #5/#6：维修与追加维修各 −1.0~1.5 六档自选（工程师合计最高 −3.0） */
        const tiers = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5].map(v => ({ v, label: v.toFixed(1) }));
        const opts = [{ v: 'repair', label: '维修（−1.0~1.5 自选）', sub: '倒计时与净破坏量同额削减' }];
        if (RD.hasGrant(p.role, 'extraRepair'))                                // D6：能力标签
          opts.push({ v: 'extra', label: '维修 + 追加维修（各 −1.0~1.5 自选）', sub: `工程师独属，剩余 ${p.extraRepair}/3（合计最高 −3.0）`, disabled: p.extraRepair <= 0 });
        opts.push({ v: 'none', label: '放弃维修' });
        return {
          kind: 'repair', title: '步骤 4a · 维修',
          desc: `累计维修量 ${p.repairTotal.toFixed(1)} / ${(RD.repairExposeAtOf(p.role) || 0).toFixed(1)}（达阈值即向全场暴露编号与职业）。` +   // D6：阈值声明化
                (g.stopNight ? ' ⚠ 停转夜：本夜维修无效、倒计时不流逝。' : ''),
          opts,
          num: { label: '维修量（自选档）', options: tiers },
          num2: { label: '追加维修量（自选档，仅「维修 + 追加维修」生效）', options: tiers },
        };
      },
      run(g) {
        /* A20（3.2.6③）：停转夜优先于维修效力削减（2.8.13③ 视为 100%）——本夜削减随停转夜
           一并失效，不递补至再下一夜，故消费（清零）必须先于提前返回。 */
        const cut = g.repairCutNext || 0;
        g.repairCutNext = 0;
      if (g.stopNight) {
        announce(g, '④', '停转夜（来源：外星人破坏）：本夜维修无效、倒计时不流逝。');
        /* 〔v7 裁定②〕作废船员在步骤 2 预留的协助维修档值。本行原就提前 return，
           在玩家循环之前，故那批预留值既没结算也没清零（实测残留 48 次，
           且**全部**发生在停转夜、非停转夜 0 次，与本提前 return 完全吻合）。
           停转夜维修本就无效 ⇒ 正确处置是消费掉它，而不是让它悬着。 */
        for (const q of g.players) if (!q.out && q.role === 'crew') q.repairValue = null;
        return;
      }
        /* A20（3.2.6②/2.8.13⑥）：次夜维修效力削减——上夜破坏进化异形执行破坏所设定（g.repairCutNext），
           作用于本夜 4a 全部维修类产出（工程师维修/追加维修/协助维修），于自选值之上按比例折算，
           结果保留 2 位小数即实际结算值，同额计入倒计时削减、净破坏量削减与维修暴露累计。 */
        const fac = (100 - cut) / 100;
        const r2 = v => Math.round(v * 100) / 100;
        let total = 0, crewTotal = 0, crewN = 0;
        const exposed = [], crewIds = [];
        for (const p of g.players) {
          if (p.out) continue;
          if (RD.hasGrant(p.role, 'repair')) {                                   // D6：能力标签
            const d = g.decisions[p.id];
            if (!d || !d.do) continue;
            let amt = r2((typeof d.value === 'number' ? d.value : 1.0) * fac);   // 4.3.2：−1.0~1.5 自选，A20 折算
            let extraAmt = 0;
            if (d.extra && RD.hasGrant(p.role, 'extraRepair') && p.extraRepair > 0) {   // D6：能力标签
              extraAmt = r2((typeof d.extraValue === 'number' ? d.extraValue : 1.0) * fac);  // 4.3.3：个人全局 3 次，A20 折算
              p.extraRepair -= 1;
            }
            const sum = Math.min(3.0, amt + extraAmt);                           // 与追加叠加时合计最高 −3.0（4.3.3）
            g.countdown -= sum;
            g.net10 = Math.max(0, g.net10 - Math.round(sum * 10));
            p.repairTotal += sum;
            /* v32 批 5′：R08/R12 维修累计流水（单人私有，delta=0 占位） */
            if (global.MoE && global.MoE.absorbPrivate)
              global.MoE.absorbPrivate(g, p.id, p.id, `own:${p.role}:repair:${g.night}`, 'fact');
            total += sum;
            god(g, `${p.id} 号维修 −${sum.toFixed(1)}（倒计时/净破坏${extraAmt ? `，含追加 −${extraAmt.toFixed(1)}` : ''}）`);
            const th = RD.repairExposeAtOf(p.role);                            // D6：阈值声明化
            if (!p.repairExposed && p.repairTotal >= th) {
              p.repairExposed = true;
              /* ④ 维修暴露 = 官方公告 → B5 统一服务（2.8.12④）：known 硬锁保留
                 （knownLockOf 依职业确定性推论阵营），但 known 不写阵营——
                 暴露揭示的是「谁在刷分」这一行为事实，非「该玩家是何阵营」。 */
              global.RevealService.reveal(g, p, 'expose');
              global.AI.onExpose(g, p.id, 30, 'repair');   // R22 维修暴露（双向）→ 威胁度事件
              /* B2（v6.6 2.8.12④）：暴露公告只报「编号＋呈现职业」，原职业标注删除。
                 v31 定案 1 的「④ 补标原职业」依 v4.1 所设，已被 v6.6 取代——
                 标注会向全场泄露「转职已发生 ⇒ 存活≤6 或已过第 6 夜」（N401 cond 连带）。
                 P1-a 公告 IR：结构化收集（id＋呈现职业名），条款文本由 AnnounceIR 渲染。 */
              exposed.push({ id: p.id, roleName: p.roleName });
              priv(g, p, '你已暴露：编号与职业已向全体玩家公开。');
            }
          }
        /* 【v7 裁定②】协助维修的值现在从**本步**的决策取：
           步骤 2 只在三路比较里预留档值（见上方 repair 预留行），真正的开窗与提交在步骤 4a。
           此处再从 g.decisions 取一次：若本步未收到 crewRepair 提交（如硬编码直接设
           repairValue 的旧路径）则保留原值，以允许既有确定性验证继续通过。 */
        if (p.role === 'crew' && g.decisions[p.id] && g.decisions[p.id].mode === 'crewRepair')
          p.repairValue = g.decisions[p.id].value;
          if (p.role === 'crew' && p.repairValue) {
            const rv = r2(p.repairValue * fac);            // A20：协助维修同折算（3.2.6②）
            g.countdown -= rv;
            /* v6.6 2.3 表 #7（4.1.2①）：协助维修同时等额削减净破坏量（此前仅减倒计时） */
            g.net10 = Math.max(0, g.net10 - Math.round(rv * 10));
            crewTotal += rv; crewN += 1;
            crewIds.push(p.id);
            god(g, `${p.id} 号协助维修 −${rv.toFixed(2)}（倒计时/净破坏）`);
            p.repairValue = null;
          }
        }
        g.countdown = Math.round(g.countdown * 100) / 100;
        g.actCounts.repair += total;
        /* 批次④合并口径（v6.6 2.1.6 / 2.8.7）：**只发布维修总量这一个数值**。
           此前报「工程维修 X，船员协助 Y」把来源拆开了 —— 任何人都能据此反推当夜有没有人
           协助维修、协助了多少，而「谁在修、修多少」是隐藏的行动选择（4.1.2① / 4.3），
           不属任何公告批次。拆分口径已改为：分项只落 god()（复盘可见），公告只留合计。
           个体暴露仍按 4.3.6 阈值触发一次，只报「编号＋呈现职业」（2.8.12④）。
           T=0 时不发布（不发布即该夜无人维修）。 */
        /* 分项明细降级为复盘可见：来源拆分（工程维修 vs 船员协助）是隐藏的行动选择，
           公开批次不得携带；但复盘需要它做结算核对，故落 god() 而非丢弃。 */
        if (total > 0 || crewTotal > 0)
          god(g, `维修分项：工程维修 ${total.toFixed(1)}，船员协助 ${crewTotal.toFixed(2)}（协助 ${crewN} 人）`);
        let txt = `维修总量 ${(total + crewTotal).toFixed(2)}`;
        if (exposed.length) txt += '；' + global.AnnounceIR.render(global.AnnounceIR.expose('维修者暴露', exposed));
        announce(g, '④', txt);
        if (crewN > 0) {
          for (const id of crewIds) {
            priv(g, P(g, id), `本夜共有 ${crewN} 名普通船员协助维修。`);
            /* v32 批 5′：R01 维修人数 N 流水（此前只有 priv() 文本未落盘——交接文档 §3 点名缺落盘之一） */
            if (global.MoE && global.MoE.absorbPrivate)
              global.MoE.absorbPrivate(g, id, id, `own:crew:repairN:${g.night}:${crewN}`, 'fact');
          }
        }
      },
    },

    '5': {
      /* 觉醒已前置至 'P-id' 身份改变子步骤（6.2：于身份改变子步骤声明，可选不强制）。
         〔43〕外星人击杀是经典外星人技能，按 role 判 —— 死囚无此技能（6.8.2） */
      req: g => g.players.filter(p => ACT.isClassicXeno(p) && !p.out && !p.branch && canAct(g, p))
                         .map(p => ({ pid: p.id, kind: 'xenoKill' })),
      form(g, p) {
        const max = p.awakened ? 2 : 1;
        return {
          kind: 'xenoKill', title: '步骤 5 · 外星人击杀',
          desc: (p.awakened ? '已觉醒：每夜至多 2 刀，两刀于步骤 5 连续结算，决策须一次性提交。'
                            : '未觉醒：每夜至多 1 刀。') +
                '目标可为任意阵营（人类/异形/自己均可，6.6）；本夜已蛰伏或破坏者不可出刀。',
          targets: formPlayers('alive', max, 0),   /* A16（2.8.15）：含自己 */
          skipLabel: '今夜不出刀',
        };
      },
      run(g) {
        for (const p of g.players) {
          if (p.faction !== 'xeno' || p.out) continue;
          const d = g.decisions[p.id];
          if (!d || !d.targets || !d.targets.length) continue;
          p.branch = 'kill';   /* 6.6：击杀与自我治疗互斥——当夜出刀即放弃步骤 8 自疗 */
          /* 结算端硬上限：未觉醒 1 刀，觉醒后 2 刀（与表单上限一致，防越权提交） */
          const shots = (d.targets || []).slice(0, p.awakened ? 2 : 1);
          for (const id of shots) applyLethal(g, P(g, id), 'xeno', p);
        }
      },
    },

    '6': {
      req: g => alive(g).filter(p => ACT.canActAt(p.role, '6') &&
                                      (p.bullets > 0 || p.role === 'hunter') &&          // A6：猎手 0 弹也可选攒弹（4.4.7②）
                                      !(p.role === 'sheriff' && p.patroledTonight) && canAct(g, p))   // C5：行动位声明驱动
                        .map(p => ({ pid: p.id, kind: 'shoot' })),
      form(g, p) {
        if (p.role === 'hunter') {
          /* A6 批次 29（4.4.7②）：猎手「开枪∕攒弹∕放弃」三选一。攒弹当夜不可开枪、
             不可嗅探（②b）——嗅探先于本步结算，故当晚已嗅探者攒弹项置灰（同一约束的
             另一侧表达，见 3.5 步注释）。子弹不受 2 发存储上限约束（4.4.7③）。 */
          return {
            kind: 'shoot', title: '步骤 6 · 开枪 / 攒弹',
            desc: `剩余子弹 ${p.bullets} 发（不受 2 发存储上限约束，4.4.7③）。开枪可指定目标数＝剩余子弹数（2.5 额度即上限），可命中任何存活角色（含队友与自己）；击杀敌方单位下夜回复 1 发（4.4.2）。攒弹：本夜放弃开枪，2 夜后 +1 发、可反复（4.4.7②）。` +
                  (p.sniffedTonight ? ' ⚠ 今夜已嗅探，不可选攒弹（4.4.7②b）。' : ''),
            opts: [
              { v: 'shoot', label: `开枪（${p.bullets} 发）`, disabled: p.bullets <= 0 },
              { v: 'gather', label: '攒弹（本夜不开枪）', disabled: p.sniffedTonight },
              { v: 'none', label: '放弃' },
            ],
            targets: formPlayers('alive', Math.max(1, p.bullets), 0),   /* A16：含自己 */
          };
        }
        const max = p.bullets;   /* 警长 4.4.6 存量上限 2 已在发放侧钳制 ⇒ 目标数＝存量（2.5 额度即上限） */
        return {
          kind: 'shoot', title: '步骤 6 · 开枪',
          /* T23（2026-10-05 文本审查第二遍）：把「代码有、文案没说」的隐藏能力写进表单——
             额外子弹到账夜与多发口径。〔2026-10-05 规则方裁决〕4.4.3 到账夜为第 5 夜（引擎 n===5 实装）。 */
          desc: `剩余子弹 ${p.bullets} 发（存储上限 2 发，4.4.6；第 5 夜 +1、全场存活≤6 名时再 +1，达上限到账即作废）。指定即结算，可命中任何存活角色（含队友与自己，4.4.1）；一夜可开多枪——可指定目标数＝剩余子弹数（2.5 额度即上限）；击杀敌方单位下夜回复子弹。`,
          targets: formPlayers('alive', max, 0),   /* A16（4.4.1）：含自己 */
          skipLabel: '今夜不开枪',
        };
      },
      run(g) {
        for (const p of orderedPlayers(g)) {
          const d = g.decisions[p.id];
          if (p.out || !d) continue;
          if (!RD.hasGrant(p.role, 'shoot')) continue;                           // D6：能力标签（枪手族）
          /* A6 批次 29（4.4.7②）：攒弹＝推进 gatherAmmo 进程（2 夜 +1 发、可反复），
             当夜不开枪；放弃不消耗任何额度。警长决策无 mode 键，走下方开枪路径。 */
          if (d.mode === 'gather') {
            if (p.role !== 'hunter' || p.sniffedTonight) continue;
            PROC.invest(g, p, 'gatherAmmo', 'bullet', { say: t => priv(g, p, t) });
            continue;
          }
          if (d.mode === 'none' || !d.targets || !d.targets.length) continue;
          const n = Math.min(d.targets.length, p.bullets);
          for (let i = 0; i < n; i++) {
            p.bullets -= 1;
            applyLethal(g, P(g, d.targets[i]), 'gun', p);
          }
        }
      },
    },

    '7': {
      req: g => {
        g.alienPlan = [];                    /* 6.4 队内协调：每夜重置已占用目标表 */
        return alive(g).filter(p => p.faction === 'alien' && !p.branch && canAct(g, p))
                       .map(p => ({ pid: p.id, kind: 'alienAct' }));
      },
      form(g, p) {
        const maxInf = p.alien.dir === 'infect' ? 3 : 2;
        const noCd = p.alien.dir === 'kill';
        const extraMax = (noCd ? 1 : 0) + (p.alien.extraKill > 0 ? 1 : 0);
        return {
          kind: 'alienAct', title: '步骤 7 · 异形行动',
          desc: (g.extinction
            ? `寂灭时刻：菜单收敛为「出刀 / 感染」（结茧已于 4b）。刀数 ${noCd ? '出刀无冷却' : p.alien.kills + '/2'}；护盾 ${p.shield} 层。`
            : `刀数 ${noCd ? '出刀无冷却' : p.alien.kills + '/2'}；感染上限 ${maxInf} 名；护盾 ${p.shield} 层。`) +
              ' 出刀目标含友方异形与自己（5.6.3）；感染目标含友方异形与自己（5.3.4），指向异形者为欺诈标记；对濒死目标的投放按落空消耗。',
          opts: [
            { v: 'kill', label: '出刀', sub: noCd ? `击杀进化：无冷却${extraMax >= 2 ? '，本夜至多 2 刀（含额外出刀 5.4.2，可同目标）' : ''}` : '需刀数 ≥1',
              disabled: !noCd && p.alien.kills < 1 },
            { v: 'infect', label: '感染', sub: `至多 ${maxInf} 名（可含队友/自己欺诈标记）` },
            { v: 'none', label: '放弃行动', sub: '不出刀则刀数 +1' },
          ],
          targets: formPlayers('alive', Math.max(extraMax, maxInf), 0),   /* A16（5.6.3/5.3.4）：含自己 */
        };
      },
      run(g) {
        for (const p of orderedPlayers(g)) {
          if (p.faction !== 'alien' || p.out) continue;
          const d = g.decisions[p.id];
          const usedKill = d && d.act === 'kill';
          if (!usedKill) p.alien.kills = Math.min(2, p.alien.kills + 1);
          if (!d) continue;
          if (d.act === 'kill') {
            const noCd = p.alien.dir === 'kill';
            let shots = (d.targets || []).slice(0, 1 + (p.alien.extraKill > 0 ? 1 : 0));
            for (const id of shots) {
              if (!noCd && p.alien.kills < 1) break;
              if (!noCd) p.alien.kills -= 1;
              else if (p.alien.extraKill > 0 && shots.indexOf(id) > 0) p.alien.extraKill -= 1;
              applyLethal(g, P(g, id), 'alien', p);
            }
          } else if (d.act === 'infect') {
            /* 寂灭期感染照常（1.4.1 菜单含感染；指向外星人者为真感染 5.3.4①）。
               5.3.1：不可选濒死者仅约束结算合法性——对濒死目标的投放按落空通则消耗名额。 */
            const max = p.alien.dir === 'infect' ? 3 : 2;
            let used = 0;
            for (const id of (d.targets || [])) {
              if (used >= max) break;
              const t = P(g, id);
              if (!t || t.out) continue;
              used += 1;                               /* 落空亦消耗名额（2.5.2） */
              if (t.dying) { god(g, `${p.id} 号感染 ${t.id} 号 → 落空（目标濒死，额度照耗）`); continue; }
              const r = applyInfection(g, t, p);
              if (r === 'fake') g.log.push({ night: g.night, step: g.step, batch: null,
                text: `（队内可见）${p.id} 号为 ${id} 号打上了欺诈标记。`, kind: 'info', scope: 'alien' });
            }
          }
          /* v4 6.2 反拖延：出刀/感染/破坏 → 疲劳归零；放弃 → 疲劳 +1（结茧已移至 4b） */
          p.guardStreak = (d.act === 'kill' || d.act === 'infect') ? 0 : (p.guardStreak || 0) + 1;
        }
      },
    },

    '8': {
      req(g) {
        const out = [];
        for (const p of alive(g)) {
          const blocked = p.silenceNight === g.night || p.noActive;
          if (ACT.canActAt(p.role, '8')) {                               // C5：行动位声明驱动（医生/毒师/死囚复生）
            /* 自救属濒死状态下的被动救命，不受沉默 / 感染抑制封锁（2.4④） */
            const selfSave = p.dying && ((p.role === 'bio' && p.selfSaveLeft > 0) || (p.rescueLeft > 0 && p.role !== 'bio'));
            if (!blocked || selfSave) out.push({ pid: p.id, kind: 'doctor' });
          }
          /* 6.5④：自我治疗与蛰伏(0.1)/击杀(5)/破坏(4b)共同构成外星人当夜四选一——
             本夜已选其一者（p.branch 已提交）不可再用感染治疗额度 */
          /* 〔43〕感染治疗额度按 role 判。此前按 faction 判 ⇒ 死囚被派发 kind='xenoCure'，
             而下方 form 的分派条件是 `!p.convict`，于是 form 落到**医生表单**分支 ——
             请求说「感染治疗」、表单给的是「治疗/救援/制药/毒药」。这正是玩家报的
             「我明明是神探，却还能发动医生的技能」：req 与 form 的 kind 不一致，
             静默地换了一套技能出来。 */
          if (ACT.isClassicXeno(p) && !p.branch && p.infection && p.infection.real && p.cureSelf > 0 && canAct(g, p))
            out.push({ pid: p.id, kind: 'xenoCure' });
          /* A6 批次 32 · 6.8.4 复生：与医生救援同窗口（步骤 8，晚于 7 早于 9），
             故属抢救而非起死回生。明文授予「可见当夜濒死者」；对象为当夜任一濒死且
             未被救活者（含真异形、含自己）；全局 2 次，每夜至多用「当前持有额度」次。
             不占当夜行动权（与呈现身份的职业行动并存，6.8.4⑤）。 */
          if (p.convict && p.reviveLeft > 0 && g.players.some(x => !x.out && x.dying) && canAct(g, p))
            out.push({ pid: p.id, kind: 'revive' });
        }
        return out;
      },
      form(g, p) {
        if (ACT.isClassicXeno(p)) {
          return {
            kind: 'xenoCure', title: '步骤 8 · 感染治疗额度',
            desc: '仅可自用：清除自身感染，不赋予抗体。受沉默 / 感染抑制封锁时不可用；寂灭时刻中照常可用。',
            opts: [{ v: 'yes', label: '使用感染治疗额度' }, { v: 'no', label: '不使用' }],
          };
        }
        const isBio = p.role === 'bio';
        const blocked = p.silenceNight === g.night || p.noActive;
        const infected = g.players.filter(x => !x.out && x.infection);
        const dying = g.players.filter(x => !x.out && x.dying);
        const canRescue = RD.hasGrant(p.role, 'save');                           // D6：能力标签（救援族）
        const opts = [];
        if (!blocked) {
          if (p.healLeft > 0 || p.cureLeft > 0)
            opts.push({ v: 'heal', label: `治疗（剩余 ${isBio ? p.healLeft : p.cureLeft} 次）`,
                        sub: isBio ? '清除感染并赋予抗体' : '清除感染，不赋予抗体',
                        disabled: !infected.length });
          if (canRescue && p.rescueLeft > 0)
            opts.push({ v: 'rescue', label: `救援（剩余 ${p.rescueLeft} 次）`,
                        sub: '解除濒死并清除感染，不限阵营', disabled: !dying.length });
        }
        if (p.dying && ((isBio && p.selfSaveLeft > 0) || (canRescue && p.rescueLeft > 0)))
          /* T24（2026-10-05 文本审查第二遍）：非生化医师的自救消耗的是救援额度（实码扣
             p.rescueLeft），表单必须写明，防止误解为独立自救额度。 */
          opts.push({ v: 'selfsave', label: '自救', sub: '解除自身濒死、清感染' + (isBio ? '并获得抗体（消耗自救额度）' : '（消耗 1 次救援额度，不赋予抗体）') });
        if (!blocked)
          opts.push({ v: 'brew', label: '制药', sub: PROC.stateOf(p, 'brew')
            ? `进度 ${PROC.stateOf(p, 'brew').progress}/${PROCD.get('brew').nights}（${PROCD.get('brew').messages.shortLabels[PROC.stateOf(p, 'brew').product || PROCD.get('brew').productChoices[0]]}）`
              + (PROC.stateOf(p, 'brew').lastNight !== g.night - 1 ? '；已暂停，不回退' : '')
            : '放弃 2 个夜晚的行动产出药剂（两夜可不连续，中断不回退）' });
        /* A6 批次 31 · 4.6.4⑤ 出手互斥：毒师每夜于「救援／治疗／制药／毒药／解药」五类中择一，
           不可兼选（2.5.3）。不继承 4.6.3 的「救援/治疗/制药三者互斥」表述——该条为救援医师专属。
           毒药/解药额度第 1、3、5 夜各到账 1 份（全局各 3）；毒药可见全场清单（4.6.4③可见性）。 */
        if (RD.hasGrant(p.role, 'poison') && !blocked) {
          const poisoned = g.players.filter(x => !x.out && x.poison);
          opts.push({ v: 'poison', label: `下毒（剩余 ${p.poisonLeft} 份）`,
            sub: '落身当夜为第 1 夜，第 3 夜致濒死；仅全额减免可挡（安全室/夜晚免疫）',
            disabled: p.poisonLeft <= 0 });
          opts.push({ v: 'antidote', label: `解药（剩余 ${p.antidoteLeft} 份）`,
            sub: '清除目标的毒药标记——毒药的唯一清除途径',
            disabled: p.antidoteLeft <= 0 || !poisoned.length });
        }
        opts.push({ v: 'none', label: '今夜不出手' });
        const poisonList = RD.hasGrant(p.role, 'poison')
          ? '。毒药清单：' + (g.players.filter(x => !x.out && x.poison).map(x => x.id + ' 号').join('、') || '（空）')
          : '';
        return {
          kind: 'doctor', title: '步骤 8 · 医生',
          desc: (RD.hasGrant(p.role, 'poison')
                 ? '每晚仅一类出手（救援 / 治疗 / 制药 / 毒药 / 解药 五选一，互斥）。'
                 : '每晚仅一类出手（治疗 / 救援 / 自救 / 制药互斥）。')
                + '感染标记清单：' +
                (infected.length ? infected.map(x => x.id + ' 号').join('、') : '（空）') +
                poisonList +
                (canRescue && dying.length ? '。⚠ 风险提示：救援不限阵营，你看不到被救者身份——异形会用「自伤队友」制造濒死诱饵。' : ''),
          opts,
          targets: formPlayers('alive', 3, 0),
          num: { label: '制药产物', options: PROCD.get('brew').productChoices.map(k => ({ v: k, label: PROCD.get('brew').messages.choiceLabels[k] })) },
        };
      },
      run(g) {
        /* 医生 R7：更新感染标记首次可见夜（假标记识别素材）。
           v26 追加 markEverSeen（**AI 的记事本等价物**）：总表 N148 明写「医生须自记标记首见夜 n，
           规则不代为记录（3.3①）」——人在记事本上记，AI 就必须有对应状态。
           与 markSeen 的区别：markSeen 随标记消失而删除（「当前有没有标记」），
           markEverSeen 保留「我曾在第 n 夜见过他带标记」以及它【何时消失】——
           这是 N149（标记逾期未死 ⇒ 假标记 ⇒ 异形）的前置条件；
           N139/N141（原以「消失夜全场清除次数=0」为判据）已随批⑫公告退役（3.3.7，
           2026-10-04），N407 改读本记忆的「从未带过标记」口径。 */
        for (const doc of g.players) {
          /* v32 机制对等：玩家扮演医生时同样拥有标记记忆（markSeen/markEverSeen）——此前玩家医生零资产 */
          if (doc.out || !RD.hasGrant(doc.role, 'treat')) continue;      // D6：能力标签取代手写角色清单
          if (!doc.markEverSeen) doc.markEverSeen = new Map();
          for (const x of g.players) {
            if (x.out) { doc.markSeen.delete(x.id); doc.markEverSeen.delete(x.id); continue; }
            if (x.infection) {
              if (!doc.markSeen.has(x.id)) doc.markSeen.set(x.id, g.night);
              /* v32 批 5′：R05 标记记忆流水（单人私有，delta=0 占位；首见夜记一条） */
              if (doc.markSeen.get(x.id) === g.night && global.MoE && global.MoE.absorbPrivate)
                global.MoE.absorbPrivate(g, doc.id, x.id, `own:${doc.role}:mark:${g.night}`, 'fact');
              const ever = doc.markEverSeen.get(x.id);
              if (!ever) doc.markEverSeen.set(x.id, { night: g.night, lastSeen: g.night });
              else ever.lastSeen = g.night;
            } else {
              doc.markSeen.delete(x.id);
              /* v26 批⑫撤除（2026-10-04）：原在此记录「消失夜 + 上一夜全场清除次数」（goneNight/noCure），
                 供 N139/N141 区分「被医生清掉」与「隐形清除」——判据信息随批⑫公告退役：
                 3.3.7 明文任何玩家均无从得知清除类出手次数，医生只能依本人标记记忆（3.3.10①）与
                 标记消失这一自身观察（7.0 推理）行事。N149（逾期未死）仅依 night 首见夜，不受影响。 */
            }
          }
        }
        /* v31 批 3.5（N406 输入）：救援医师／临时医生的「每夜免费濒死名单」（P13）落盘。
           总表自评 P13 为「本轮最大漏记」——这份名单此前只出现在表单 desc 与 view 层，
           AI 侧零落点，于是「濒死名单 − ⑥ 死亡名单 = 被救回者 ⇒ 实际攻击次数」无法变现。
           在【救援结算之前】记录观察快照（本夜谁处于濒死），步骤 9 的 ⑥ 公告出来后即可对账。 */
        for (const doc of g.players) {
          /* v32 机制对等：玩家扮演救援/临时医生时同样拥有濒死名单资产（dyingSeen） */
          if (doc.out) continue;
          if (!RD.hasGrant(doc.role, 'save')) continue;                        // D6：能力标签（濒死名单）
          doc.dyingSeen = { night: g.night, ids: g.players.filter(x => !x.out && x.dying).map(x => x.id) };
          /* v32 批 5′：R06/R13 濒死名单流水（单人私有，delta=0 占位） */
          if (global.MoE && global.MoE.absorbPrivate) {
            for (const id of doc.dyingSeen.ids) global.MoE.absorbPrivate(g, doc.id, id, `own:${doc.role}:dying:${g.night}`, 'fact');
          }
        }
        for (const p of orderedPlayers(g)) {
          const d = g.decisions[p.id];
          if (p.out || !d) continue;

          /* 〔43〕感染治疗额度的结算按 role 判（与 req 的 isClassicXeno 同口径） */
          if (ACT.isClassicXeno(p)) {
            if (d.use && p.infection && p.infection.real && p.cureSelf > 0) {
              p.branch = 'cure';   /* 6.5④：四选一承诺标记 */
              clearInfection(g, p);
              /* 〔v7 速查卡补充 · 2026-10-08〕赋予抗体——卡两处明写：
                 ① §外星人·核心能力：「自我治疗：清除自身感染并**赋予抗体**」
                 ② §v6.5 修订要点⑩抗体赋予：「主体依 3.3.9：生化医师的治疗与自救、
                    **外星人的自我治疗**；救援医师／临时医生不赋予」
                 原实现只 clearInfection 不写 antibodyNight ⇒ 自我治疗后下一夜不再
                 抵挡感染，与卡不符。抗体为感染侧专属时限类（5.3.3）：仅存在于获得后的
                 下一个夜晚，该夜抵挡 1 次感染，夜末失效、不结转（卡·生化医师页注）。
                 写入方式与生化医师两处（steps.js:1378 / 1408）逐字一致，故到期与层序
                 判定（engine.js applyInfection）自动适用，无需另写。
                 不发「抗体生效」私反馈：卡·私人反馈六类无此项，该措辞仅见于
                 生化医师可见性行，engine.js:187 的 role==='bio' 门控保持不动。 */
              p.antibodyNight = g.night + 1; p.antibodyBy = p.id;
              priv(g, p, '你使用感染治疗额度清除了自身感染，并获得抗体。');
            }
            continue;
          }
          /* A6 批次 32 · 6.8.4 复生：与医生救援于步骤 8 依**当夜结算顺序串行**结算，
             先结算者生效；后结算者因「目标已被处理」而落空——仍消耗额度、不返还、不提示
             （6.8.4② / 2.5.2）。医生在 orderedPlayers 中按 nightOrder 先于或后于死囚，
             故此处的判据是「目标当下是否仍处于濒死」。 */
          if (p.convict) {
            const d2 = g.decisions[p.id];
            if (d2 && d2.use && p.reviveLeft > 0) {
              const dying = g.players.filter(x => !x.out && x.dying).slice(0, p.reviveLeft);
              for (const t of dying) {
                p.reviveLeft -= 1;
                t.dying = false; t.dyingCause = null; t.revivedBy = p.id;
                clearInfection(g, t);
                priv(g, t, '你被救回了。');
                god(g, `${p.id} 号复生 ${t.id} 号（余 ${p.reviveLeft} 次）`);
              }
              /* 6.8.4⑥ 留痕：公开「本夜发生 N 次复生」及剩余次数，**不公开被复生者编号**——
                 公开编号即等于向全场广播某人曾濒死，违反濒死仅对医生与死囚可见（3.3.12/4.10.4④）。
                 该留痕随⑥死亡名单一并公开（步骤 9 之后），本步只记数。 */
              if (dying.length) {
                g.reviveCount = (g.reviveCount || 0) + dying.length;
                god(g, `本夜发生 ${g.reviveCount} 次复生（死囚余 ${p.reviveLeft} 次）`);
              }
            }
            continue;
          }
          if (!RD.hasGrant(p.role, 'treat')) continue;                   // D6：能力标签取代手写角色清单
          const blocked = p.silenceNight === g.night || p.noActive;

          if (d.act === 'heal' && !blocked) {
            const pool = p.role === 'bio' ? p.healLeft : p.cureLeft;
            let used = 0;
            for (const id of (d.targets || [])) {
              if (used >= pool) break;
              const t = P(g, id); if (!t || t.out) continue;
              const had = !!t.infection;
              if (p.role === 'bio') { t.antibodyNight = g.night + 1; t.antibodyBy = p.id; }
              clearInfection(g, t);
              used += 1; g.cureHands += 1;
              god(g, `${p.id} 号治疗 ${t.id} 号：${had ? '感染清除' : '落空（无标记）'}${p.role === 'bio' ? '，并赋予抗体' : ''}`);
              /* 3.3.7（2026-10-04 批⑫撤除同批）：医生的清除类出手「不设公告批次、不产生任何反馈」——
                 被清除目标亦不送达私反馈；目标本人依自身标记消失（3.3.10②）与清单变动自行推断（7.0）。 */
            }
            if (p.role === 'bio') p.healLeft -= used; else p.cureLeft -= used;
          } else if (d.act === 'rescue' && !blocked) {
            let used = 0;
            for (const id of (d.targets || [])) {
              if (used >= p.rescueLeft) break;
              const t = P(g, id); if (!t || t.out || !t.dying) continue;
              const cause = t.dyingCause;                        // 以实际执行救援为前提可见（4.6）
              t.dying = false; t.dyingCause = null;
              clearInfection(g, t);
              used += 1; p.rescueLeft -= 1; g.cureHands += 1;
              god(g, `${p.id} 号救援 ${t.id} 号：解除濒死（落身来源 ${causeReport(t) || '未知'}）`);
              priv(g, t, '你被医生救回。');
              /* 4.6.1：救援医师可见该目标【截至救援时】的落身致死来源清单，口径与 4.10.6
                 调查报告完全一致（逐项列出、去重不带次数、含感染、不含被抵挡而未落身者）；
                 救援于步骤 8 结算，晚于步骤 5∕6∕7，故当夜全部攻击均已结算完毕 ⇒ 与死者
                 最终所得的调查报告内容相同。不含攻击者编号与身份。 */
              if (RD.hasGrant(p.role, 'save'))                                 // D6：能力标签（仅救援族获此清单）
                priv(g, p, `${t.id} 号落身致死来源：${causeReport(t) || '未知'}`);
            }
          } else if (d.act === 'selfsave' && p.dying &&
                     ((p.role === 'bio' && p.selfSaveLeft > 0) || (p.rescueLeft > 0 && p.role !== 'bio'))) {
            p.dying = false; p.dyingCause = null;
            clearInfection(g, p);
            if (p.role === 'bio') { p.antibodyNight = g.night + 1; p.antibodyBy = p.id; p.selfSaveLeft -= 1; }
            else p.rescueLeft -= 1;
            priv(g, p, '自救成功：解除濒死、清除感染' + (p.role === 'bio' ? '并获得抗体。' : '。'));
          } else if (d.act === 'brew' && !blocked && !p.dying) {
            /* C11（进程注册表）：制药走通用进程引擎——投入夜计数、产物定于完成时、次夜到账、
               私反馈文案全部来自 js/v66/declaration/processRegistry.js 的声明。 */
            PROC.invest(g, p, 'brew', d.product, { say: t => priv(g, p, t) });
          } else if (RD.hasGrant(p.role, 'poison') && d.act === 'poison' && !blocked && !p.dying && p.poisonLeft > 0) {
            /* A6 批次 31 · 4.6.4③ 下毒：步骤 8 投放（晚于全部攻击结算，毒师须先活过步骤 7）。
               · 毒药不辨阵营，队友与自身皆为合法目标；对自己下毒属攻击、非自救（④）。
               · 已带毒药者不得再被下毒：不落身、不叠加、不刷新计时，仍耗额度、不返还、不得改选
                 （比照 4.10.4③④）。
               · 濒死者可指定为毒药目标但**无任何效果**（不落身/不计时/不消耗原有标记），
                 仍耗额度不返还，UI 保留其可选性（4.10.4④）。
               · 可见性：毒师本人可见全场毒药清单、被下毒者本人可见（〔连锁〕若其为异形，
                 经队内私聊当夜即全队知晓有毒师存在），其余依 2.8.7 不公开。 */
            let used = 0;
            for (const id of (d.targets || [])) {
              if (used >= p.poisonLeft) break;
              const t = P(g, id); if (!t) continue;
              /* 落空（出局/濒死/已有毒药）依 4.10.4③ 仍照常消耗额度、不返还、不得改选——
                 故额度扣减与「是否落身」无关，统一在循环末执行（v31 修复：此处曾漏扣）。 */
              used += 1; p.poisonLeft -= 1;
              if (t.out || t.dying || t.poison) continue;                  // 落空：无效果
              t.poison = { night: g.night, by: p.id, source: 'poisoner' };
              priv(g, t, '你身上被下了毒：将于第 ' + (g.night + 2) + ' 夜发作进入濒死。');
              god(g, `${p.id} 号对 ${t.id} 号下毒（第 1 夜，${g.night + 2} 夜致濒死）`);
            }
            if (used) priv(g, p, `你投出了 ${used} 份毒药（剩 ${p.poisonLeft} 份）。`
              + (p.faction === 'alien' ? '（队内私聊不设公告——队友已知你出手）' : ''));
          } else if (RD.hasGrant(p.role, 'poison') && d.act === 'antidote' && !blocked && !p.dying && p.antidoteLeft > 0) {
            /* 4.6.4④ 解药：毒药的**唯一**清除途径。目标须当前带毒药标记，否则属落空
               （仍耗额度、不返还、不得改选 2.5）；不清除感染标记；不解除任何原因的濒死。 */
            let used = 0;
            for (const id of (d.targets || [])) {
              if (used >= p.antidoteLeft) break;
              const t = P(g, id); if (!t) continue;
              if (!t.poison) { used += 1; continue; }                        // 落空仍耗额度
              t.poison = null; t.antidotedNights = g.night;
              used += 1; p.antidoteLeft -= 1;
              priv(g, t, '你身上的毒已被解除。');
              god(g, `${p.id} 号以解药清除 ${t.id} 号的毒药`);
            }
            if (used) priv(g, p, `你使用 ${used} 份解药（剩 ${p.antidoteLeft} 份）。`);
          }
        }
      },
    },

    '9': {
      run(g) {
        const deaths = [];
        for (const p of g.players) {
          if (p.out || !p.dying) continue;
          p.out = true; p.outType = 'death'; p.outNight = g.night; p.cause = p.dyingCause;
          p.dying = false;
          /* B5：死亡揭示保留真实阵营（4.10.6），走统一服务 */
          global.RevealService.reveal(g, p, 'death');
          deaths.push(p);
          /* 悬赏（4.4⑤）：当夜对该目标出过枪击的警长/武装船员，各独立回复 1 发（含未取得死因归属者） */
          if (p.cause === 'gun' && p.faction !== 'human' && p.gunAttackers) {
            for (const aid of [...new Set(p.gunAttackers)]) {
              const k = P(g, aid);
              if (k && !k.out && RD.hasGrant(k.role, 'shoot')) k.bounty += 1;          // D6：能力标签（悬赏回复）
            }
          }
        }
        /* 4.10.6 死亡公告格式「X 号死亡，真实阵营（呈现职业：A∕真实职业：B），尸体调查报告：【…】」
           ——C6：真实职业走揭示服务的独立 trueRole 槽位（与已删的「原职业」物理分离，B2）。
           C7：死因由单一 p.cause 改为调查报告（全部落身来源，去重不带次数）。
           报告为空时退回当夜死因（防御性，正常路径必有至少一项）。 */
        for (const p of deaths) {
          const dr = global.RevealService.checkResult(p, 'death');
          /* P1-a 公告 IR：节点由揭示出参＋调查报告类别数组构造——报告以数组进节点
             （4.10.6 去重·不带次数），渲染拼接统一在 AnnounceIR。 */
          announce(g, '⑥', global.AnnounceIR.render(
            global.AnnounceIR.death(dr, D.FACTION[p.faction].name, causeList(p))));
        }
        if (!deaths.length) announce(g, '⑥', '今夜无人死亡。');
        /* 6.8.4⑥：复生留痕随⑥死亡名单一并公开（2.1.6）——只报次数与死囚剩余次数，
           **不报被复生者编号**（公开即等于向全场广播某人曾濒死）。 */
        if (g.reviveCount) {
          const cv = g.players.find(p => p.convict && !p.out);
          announce(g, '⑥', `本夜发生 ${g.reviveCount} 次复生`
            + (cv ? `（死囚复生剩余 ${cv.reviveLeft} 次）` : ''));
          g.reviveCount = 0;
        }
        /* v21 改动 #13：⑪ 感染抑制通道整体删除（规则硬违规）——v4.1 明文「不予通报、任何阵营均不可见」，
           此前把抑制人数做成公告发给异形。speakable.js 中「⑪ 不予通报 → 不可验证，属 D 档」口径因此成立。 */
        /* 批⑫ 撤除（2026-10-04，正文 3.3.7 逐字拍板）：「医生的清除类出手次数——不设公告批次、
           不产生任何反馈，任何玩家（含人类、异形、外星人）均无从直接得知」——步骤 9 不再发布。
           连带：N139/N141（判据=消失夜全场清除次数=0）、B01/C14/C22（读⑫公告）一并退役，
           N407 收紧为纯私有判据（见 js/infer/modules/e2-infection.js / e8-claims.js / e10-aggregate.js）；
           decide.js 感染效用不再读全场清除累计（同条「任何玩家均无从得知」）。 */
        g.actCounts.death += deaths.length;
        g.actCounts.cure += g.cureHands;   // 内部统计仅供复盘/开发者视角，AI 不得消费（3.3.7）
        g.infectedDeaths = (g.infectedDeaths || 0) + deaths.filter(p => p.cause === 'infect').length;   // v4 1.3：抑制充裕度统计
        global.AI.reason(g);          // 每夜推理链更新（R12/R27/R28/R34/R7 等）

        /* 决斗僵局判定（1.4）：连续 3 个僵持夜后，于【第 4 夜】步骤 9 结算后判定 */
        if (g.duel && (g.tiers[9] || g.extinction)) {
          if (alive(g).length === g.lastAliveCount) {
            g.stalemate += 1;
            if (g.stalemate === 3) g.stalemate3Night = g.night;   // 满 3 夜后，下一夜步骤 9 判定
          } else g.stalemate = 0;
          if (g.stalemate >= 3 && g.stalemate3Night != null && g.night > g.stalemate3Night) {
            const x = aliveF(g, 'xeno').length > 0;
            endGame(g, x ? 'xeno' : 'human');
            return;
          }
        }
        updatePhases(g);
        /* 1.2.3：步骤 9 死亡结算末尾统一检查胜利。node='9' 供 1.5.2 夜数兜底判定节点守卫
           （寂灭时刻步骤 11 冻结，步骤 9 即该夜最后节点 ⇒ 第 99 夜在此判平；常规阶段不判）。 */
        const w = checkWin(g, '9');
        if (w) { endGame(g, w); return; }
      },
    },

    '10': {
      req: g => g.players.filter(p => ACT.canActAt(p.role, '10') && !p.out && p.meetingLeft > 0 &&   // C5：行动位声明驱动
                                      canAct(g, p) && alive(g).length >= 5 && !g.extinction && !g.duel)
                         .map(p => ({ pid: p.id, kind: 'meeting' })),
      form: () => ({
        kind: 'meeting', title: '步骤 10 · 紧急会议',
        /* T23（2026-10-05 文本审查第二遍）：发动门槛（全场存活≥5，req 侧已过滤）写进表单，
           消除「能力静默消失」的困惑。 */
        desc: '全场唯一一次，须全场存活≥5 名时方可发动（人数不足时本能力不可用）；错过不再出现。发动即公开你的编号与身份（官方背书），当夜召开一场与白天同等的会议（遗言→讨论→投票→驱逐），并跳过步骤 11（倒计时不减）。',
        opts: [{ v: 'no', label: '不召开（保留，下夜可再决定）' },
               { v: 'yes', label: '召开紧急会议', sub: '立即公开你的验票官身份' }],
      }),
      run(g) {
        for (const p of g.players) {
          const d = g.decisions[p.id];
          if (p.role !== 'inspector' || p.out || !d || !d.call) continue;
          p.meetingLeft -= 1;
          /* B5：会议开场背书（批次⑦，4.9.2）只公告编号与验票官职业，不写阵营 */
          global.RevealService.reveal(g, p, 'meeting');
          announce(g, '⑦', `${p.id} 号（验票官）召开了紧急会议。`);
          g.meeting = true; g.accuseMark = null;
          g.queue.length = 0;
          g.queue.push('M-will', 'M-speech', 'M-talk', 'M-vote');
        }
      },
    },

    '11': {
      run(g) {
        if (g.skipCountdown) { announce(g, '⑧', '紧急会议夜：本夜倒计时不结算。'); return; }
        if (g.stopNight) {
          announce(g, '⑧', `停转夜：倒计时不流逝，当前 ${g.countdown.toFixed(1)}。`);
        } else {
          g.countdown -= 1;
          announce(g, '⑧', `倒计时结算：剩余 ${g.countdown.toFixed(1)} 昼夜。`);
        }
        /* 1.2.3：步骤 11 倒计时结算末尾统一检查胜利。node='11' ⇒ 第 99 夜（常规∕决斗）在此判平。 */
        const w = checkWin(g, '11');
        if (w) endGame(g, w);
      },
    },

    /* ---------- 会议 ---------- */
    'D-open': {
      stream: true,
      req: g => alive(g).filter(p => p.isHuman).map(p => ({ pid: p.id, kind: 'talk' })),
      form: () => ({
        kind: 'talk', title: '开局公开讨论',
        desc: '进入第 1 夜前，全场唯一一次「无任何前置信息」的讨论：尚无死亡、维修、破坏等数据。可以自称任何身份（此刻无人能验证），也可以直接开始。无投票、无驱逐。',
        text: { label: '输入发言…' },
        targets: formPlayers('aliveOthers', 1, 0),
      }),
      run(g) {
        applyThreat(g);   // v26：claimConflicts（对跳 +3 死写入）已删除，对跳由 AI.reason() R12 入账
        g.stream = null;
      },
    },

    'M-will': {
      allowOut: true,
      /* 2.6.1②：遗言一律于「次一遗言阶段」发表——凡出局未发表者统一补发，不再按 outNight 过滤 */
      req: g => g.players.filter(p => p.out && !p.willDone && p.isHuman)
                        .map(p => ({ pid: p.id, kind: 'will' })),
      form: () => ({
        kind: 'will', title: '遗言（会议）',
        desc: '这是你的一次性遗言：内容不受限制（可谎报），也可沉默。留空提交 = 不发表；AI 不会替你发言。',
        text: { label: '你的遗言（可留空）' },
      }),
      run(g) {
        g.wills = [];
        for (const p of g.players) {
          if (!p.out || p.willDone) continue;
          p.willDone = true;
          if (p.isHuman) {
            const d = g.decisions[p.id];
            const text = d && d.text && d.text.trim();
            if (text) g.wills.push({ id: p.id, text });
            continue;
          }
          const wt = global.AI.speak(g, p);
          const rec = { id: p.id, text: wt, viaBridge: false };
          g.wills.push(rec);
          if (global.Bridge) rec.viaBridge = !!global.Bridge.say(g, p.id, wt, { kind: '遗言', claims: p.outClaims, aiSource: true });
        }
        for (const t of g.wills) if (!t.viaBridge) g.chatLog.push({ night: g.night, kind: '遗言', id: t.id, text: t.text });
        applyThreat(g);
      },
    },

    /* ---------- 验票官专属发言 30 秒（§8.1：期间其余玩家禁言，A 类硬规则） ---------- */
    'M-speech': {
      stream: true, soloTalk: true,
      req: g => alive(g).filter(p => p.role === 'inspector' && p.isHuman).map(p => ({ pid: p.id, kind: 'speech' })),
      form: () => ({
        kind: 'talk', title: '验票官专属发言',
        desc: '你拥有 30 秒专属发言（正文 4.9 硬规则）：期间其余玩家禁言，全体可见你的发言。可直接点名公开指控标记（纯展示，不影响计票），或点「结束发言」提前进入自由讨论。',
        text: { label: '专属发言…' },
        targets: formPlayers('aliveOthers', 1, 0),
      }),
      run(g) {
        const ins = alive(g).find(p => p.role === 'inspector');
        if (ins && !ins.isHuman) {                          // AI 验票官：由系统代为发言
          const it = global.AI.speak(g, ins);
          if (global.Bridge) global.Bridge.say(g, ins.id, it, { kind: '会议', claims: ins.outClaims, aiSource: true });
          else addTalk(g, ins.id, it, '会议');
        }
        global.AI.reason(g);
        g.stream = null;
      },
    },

    'M-talk': {
      stream: true,
      req: g => alive(g).filter(p => p.isHuman).map(p => ({ pid: p.id, kind: 'talk' })),
      form: () => ({
        kind: 'talk', title: '紧急会议 · 讨论',
        desc: '实时讨论中：你发送的发言会立即显示给所有人，AI 也会陆续表态。可在发言中点名一名玩家（如「我怀疑 3 号」），会被识别为公开指控（计入威胁度，影响他人投票）。',
        text: { label: '输入发言，回车或点「发送」' },
        targets: formPlayers('aliveOthers', 1, 0),
      }),
      run(g) {
        applyThreat(g);   // v26：claimConflicts（对跳 +3 死写入）已删除，对跳由 AI.reason() R12 入账
        /* 被质询的真人若始终未回答 → 按「含糊」评估（沉默也是信息） */
        if (g.pendingAsk) {
          const t = P(g, g.pendingAsk.target);
          if (t && !t.out) global.AI.evaluateAnswer(g, t, 'vague');
          g.pendingAsk = null;
        }
        g.stream = null;
      },
    },

    'M-vote': {
      req: g => { g.alienVotePlan = []; return alive(g).map(p => ({ pid: p.id, kind: 'vote' })); },
      form: () => ({
        kind: 'vote', title: '紧急会议 · 投票',
        desc: '每名存活玩家 1 票，不可投自己，可弃票。驱逐需同时满足：最高票、无平票、至少 2 票。',
        targets: formPlayers('aliveOthers', 1, 0),
        skipLabel: '弃票',
      }),
      run(g) {
        const res = resolveVote(g, true);
        g.skipCountdown = true;
        g.accuseMark = null;          // 会议结束，公开指控标记自动清除（4.9）
        g.talkHalved = true;          // 会议次日自由讨论减半至 90 秒（§5.7，B 类运营参数）
        if (!g.over) { g.meeting = false; }
        return res;
      },
    },

    /* ---------- 白天 ---------- */
    'D-report': {
      /* A6 批次 29 窃听报告（4.12.2，白天条件性阶段）：先于〇留言与自由讨论（2.3.2——
         全场首次发言之前）。队列由 startDay 按条件挂入（无待提交读取则整段跳过）。
         ①提交者对内容享有完全改写自由（可增删/改写/拼接/虚构），系统不比对、不校正、
         不作真伪判定，依所提交者原样发布（4.12.2①）；②公示与报告为同一发布位之两种
         形态（4.12.2⑦），引擎以单一提交通道实现——共用每夜 1 次与全局 2 次额度；
         ③随批次⑪发布：不暴露窃听者编号、附固定格式「不保真」性质标注（4.12.2④，
         官方背书第四档——系统仅担保「该内容确由窃听者提交」）；④未提交/超时读取作废
         （4.12.1④），提交或放弃后 wiretap 即清（不跨夜累积）。 */
      req: g => g.players.filter(p => p.role === 'listener' && !p.out &&
                                      p.reportLeft > 0 && p.wiretap && p.wiretap.night === g.night)
                         .map(p => ({ pid: p.id, kind: 'wiretapReport' })),
      form(g, p) {
        const gs = p.wiretap.groups;
        return {
          kind: 'wiretapReport', title: '窃听报告（剩余 ' + p.reportLeft + '/2 次）',
          desc: '择定提交的内容将随批次⑪向全体发布（附「不保真」标注——系统不担保其与私聊原貌一致）。不提交则本次读取作废。改写栏留空＝原样提交。',
          opts: [{ v: 'none', label: '不提交（读取作废）' }]
            .concat(gs.map((gp, i) => ({
              v: 'g' + i,
              label: `提交 ${gp.a}-${gp.b} 组（原样 ${gp.lines.length} 句）：${(gp.lines[0] || '').slice(0, 24)}…`,
            }))),
          text: { label: '改写内容（可选——增删/改写/拼接/虚构均可，系统不比对）' },
        };
      },
      run(g) {
        for (const p of orderedPlayers(g)) {
          const d = g.decisions[p.id];
          if (!d || p.out || p.role !== 'listener') continue;
          if (d.opt === 'none' || !d.opt) { p.wiretap = null; continue; }   // 作废（4.12.1④）
          const gs = (p.wiretap && p.wiretap.groups) || [];
          const gi = /^g(\d+)$/.exec(d.opt);
          const gp = gi ? gs[+gi[1]] : null;
          if (!gp) { p.wiretap = null; continue; }
          const custom = d.text && d.text.trim();
          const content = custom || gp.lines.join('；');
          announce(g, '⑪', `【窃听报告】${content}（内容不保真）`);
          p.reportLeft -= 1;
          p.wiretap = null;
          god(g, `${p.id} 号提交窃听报告（${gp.a}-${gp.b} 组${custom ? '，经改写' : '，原样'}；余 ${p.reportLeft} 次）`);
        }
      },
    },

    'D-will': {
      allowOut: true,           // 出局者仍需填写遗言
      req: g => g.players.filter(p => p.out && !p.willDone && p.isHuman)
                        .map(p => ({ pid: p.id, kind: 'will' })),
      form: () => ({
        kind: 'will', title: '遗言',
        desc: '这是你的一次性遗言：内容不受限制（可谎报），也可沉默。留空提交 = 不发表；AI 不会替你发言。',
        text: { label: '你的遗言（可留空）' },
      }),
      run(g) {
        g.wills = [];
        for (const p of g.players) {
          if (!p.out || p.willDone) continue;
          p.willDone = true;
          if (p.isHuman) {                     // 真人遗言必须出自本人，AI 不代写
            const d = g.decisions[p.id];
            const text = d && d.text && d.text.trim();
            if (text) g.wills.push({ id: p.id, text });
            continue;
          }
          const wt = global.AI.speak(g, p);
          const rec = { id: p.id, text: wt, viaBridge: false };
          g.wills.push(rec);
          if (global.Bridge) rec.viaBridge = !!global.Bridge.say(g, p.id, wt, { kind: '遗言', claims: p.outClaims, aiSource: true });
        }
        for (const t of g.wills) if (!t.viaBridge) g.chatLog.push({ night: g.night, kind: '遗言', id: t.id, text: t.text });
        applyThreat(g);
      },
    },

    'D-talk': {
      stream: true,
      req: g => alive(g).filter(p => p.isHuman).map(p => ({ pid: p.id, kind: 'talk' })),
      form: () => ({
        kind: 'talk', title: '白天 · 自由讨论',
        desc: '实时讨论中：你发送的发言会立即显示给所有人，AI 也会陆续表态。可在发言中点名一名玩家（如「我怀疑 3 号」），会被识别为公开指控（计入威胁度，影响他人投票）。也可以直接结束讨论。',
        text: { label: '输入发言，回车或点「发送」' },
        targets: formPlayers('aliveOthers', 1, 0),
      }),
      run(g) {
        applyThreat(g);   // v26：claimConflicts（对跳 +3 死写入）已删除，对跳由 AI.reason() R12 入账
        if (g.pendingAsk) {
          const t = P(g, g.pendingAsk.target);
          if (t && !t.out) global.AI.evaluateAnswer(g, t, 'vague');
          g.pendingAsk = null;
        }
        /* v32（用户拍板「异形公开讨论时的专属阵营讨论栏」）：白天讨论收尾时，
           AI 异形低概率在队内频道密谈一句（quiet 语料）——与玩家的队内输入行共用
           factionLog/队内投递通道，白天不再只有夜间 0c 一次队内机会。 */
        for (const a of g.players) {
          if (a.isHuman || a.out || a.faction !== 'alien') continue;
          if (!g.rng.chance(0.22)) continue;
          const text = global.AI.speak(g, a, true);
          if (!text) continue;
          for (const b of g.players) {
            if (b.faction !== 'alien' || b.out || b.id === a.id) continue;
            b.inbox.push({ night: g.night, step: g.step, text: `${a.id} 号（队内·白天）：${text}` });
            if (!b.isHuman && global.Bridge) global.Bridge.privateSay(g, b.id, a.id, text);   // D 档入账 AI 队友
          }
          (g.factionLog = g.factionLog || []).push({ night: g.night, from: a.id, text });
        }
        g.stream = null;
      },
    },

    'D-vote': {
      req: g => { g.alienVotePlan = []; return alive(g).map(p => ({ pid: p.id, kind: 'vote' })); },
      form: () => ({
        kind: 'vote', title: '白天 · 投票',
        desc: '每名存活玩家 1 票，不可投自己，可弃票。驱逐需同时满足：最高票、无平票、至少 2 票。',
        targets: formPlayers('aliveOthers', 1, 0),
        skipLabel: '弃票',
      }),
      run(g) { return resolveVote(g, false); },
    },

    /* ===== 2.1.1 前置子阶段（A7）===== */
    'P-id': {
      /* 前置子阶段①：身份改变——位于「白天投票驱逐之后、当夜步骤 0 之前」（2.1.1），
         早于额度到账之后的沉默覆盖期，故不受沉默封锁（2.8.3④附·时序确认）。
         外星人觉醒（6.2）：可选不强制、全局不可逆，条件达成（第 6 夜起或存活≤6）即出选项。
         死囚变形（6.8.3）：仅死囚席位出此选项；死囚局无经典外星人，故不与觉醒同现。 */
      req(g) {
        const out = [];
        for (const p of g.players) {
          if (p.out) continue;
          if (p.convict) {
            /* 6.8.3③：自实际变形之次夜起 2 夜冷却；第 1 夜即可选择（不受「必须某夜变形」约束） */
            if (p.morphNight != null && p.morphNight + 2 >= g.night) continue;
            if (!canAct(g, p)) continue;
            out.push({ pid: p.id, kind: 'morph' });
            continue;                              // 死囚局无经典外星人，故不与觉醒同现
          }
          /* 经典外星人觉醒（6.2）：第 6 夜起或全场存活≤6 名时派发（AI 在此被询问）。
             〔43〕按 role 判 —— 死囚是无双刀的经典外星人（6.8.2） */
          if (ACT.isClassicXeno(p) && !p.awakened && canAct(g, p) &&
              (g.night >= 6 || alive(g).length <= 6))
            out.push({ pid: p.id, kind: 'awaken' });
        }
        return out;
      },
      form(g, p) {
        /* 经典外星人觉醒（6.2）——本步须保留该分支：req 仍会为经典外星人派发 awaken。 */
        if (!p.convict) return {
          kind: 'awaken', title: '身份改变子步骤 · 觉醒（双刀）',
          desc: '觉醒可选（不强制）、全局不可逆：觉醒后每夜至多 2 刀（两刀于步骤 5 连续结算，决策一次性提交）。条件已达成（第 6 夜起或全场存活≤6 名）。',
          opts: [{ v: 'yes', label: '觉醒（不可逆）' }, { v: 'no', label: '今夜不觉醒（可留待后续夜晚）' }],
        };
        /* 6.8.3①：变形池＝本局实际在场的人类职业 ∪ 异形——变体席位取实际在场者
           （猎手局含猎手不含警长…），故可选项数随局而定，不固定 9 项。 */
        const M = global.SKMirror;
        const pool = M.morphPool(g, ACT.compositionOf(g));
        return {
          kind: 'morph', title: '身份改变子步骤 · 变形（6.8.3）',
          desc: '变形＝转移操作权，不改已到账额度：各身份的镜像账本自开局并行运行，被动额度各自领取，'
              + '变形当夜即可使用新身份已到账的额度。变形同时改变真实呈现职业，'
              + '故对船员查验与神探查验**均**生效（2.8.1③之三）；呈现异形时克隆其除社交与队内共享外的一切能力。'
              + `冷却中（下次可变形：${p.morphNight != null ? p.morphNight + 3 : '—'}）。`,
          opts: [{ v: 'none', label: '今夜不变形' }].concat(pool.map(r => ({
            v: r, label: '变形为「' + (D.ROLES[r] ? D.ROLES[r].name : r) + '」',
            sub: r === 'alien' ? '克隆异形（不含队内互认与私聊）' : '取得该职业的行动与额度使用权',
          }))),
        };
      },
      run(g) {
        const M = global.SKMirror;
        for (const p of g.players) {
          const d = g.decisions[p.id];
          if (p.out || !d || !d.opt || d.opt === 'none') continue;
          if (p.role !== 'convict' || !p.mirror) continue;         // 觉醒路径见下
          if (p.morphNight != null && p.morphNight + 2 >= g.night) continue;   // 冷却中
          const target = d.opt;
          if (!M.has(p.mirror, target)) continue;                  // 池外不生效（运行侧收口）
          /* 离开旧身份即封存、切回即恢复当时状态（2.8.5③）：把本体现行的可回写字段存入旧镜像 */
          const cur = p.morph || 'convict';
          if (M.has(p.mirror, cur)) {
            M.set(p.mirror, cur, 'bullets', p.bullets);
            M.set(p.mirror, cur, 'patrolUsed', p.patrolUsed);
            M.set(p.mirror, cur, 'healLeft', p.healLeft);
            M.set(p.mirror, cur, 'cureLeft', p.cureLeft);
            M.set(p.mirror, cur, 'rescueLeft', p.rescueLeft);
            M.set(p.mirror, cur, 'repairTotal', p.repairTotal);
            M.set(p.mirror, cur, 'extraRepair', p.extraRepair);
            M.set(p.mirror, cur, 'nightImmune', p.nightImmune);
            M.set(p.mirror, cur, 'safeRoomUsed', p.safeRoomUsed);
            M.leave(p.mirror, cur);
          }
          /* 切回：恢复该镜像离开时的状态（不是全局初始值——2.8.5③） */
          M.enter(p.mirror, target, g.night);
          p.role = target; p.roleName = D.ROLES[target] ? D.ROLES[target].name : target;
          p.roleExpert = target;                                  // 换眼睛（v32 批 5′ 口径）
          for (const [field, slot] of [['bullets', 'bullets'], ['patrolUsed', 'patrolUsed'],
                                       ['healLeft', 'healLeft'], ['cureLeft', 'cureLeft'],
                                       ['rescueLeft', 'rescueLeft'], ['repairTotal', 'repairTotal'],
                                       ['extraRepair', 'extraRepair'], ['nightImmune', 'nightImmune'],
                                       ['safeRoomUsed', 'safeRoomUsed']]) {
            const v = M.get(p.mirror, target, slot);
            if (v !== undefined) p[field] = v;
          }
          p.morph = target; p.morphNight = g.night;
          priv(g, p, '你已变形为「' + p.roleName + '」。变形当夜即可使用该身份已到账的额度；'
              + '自次夜起 2 夜冷却。');
          god(g, `${p.id} 号变形为 ${p.roleName}（第 ${g.night} 夜，冷却至第 ${g.night + 2} 夜）`);
          continue;
        }
        /* 觉醒（经典外星人专有，6.2） */
        for (const p of g.players) {
          const d = g.decisions[p.id];
          if (p.faction !== 'xeno' || p.convict || p.out || p.awakened || !d || !d.do) continue;
          p.awakened = true;
          priv(g, p, '你已觉醒：自本夜起可使用双刀（两刀于步骤 5 连续结算）。');
          god(g, `${p.id} 号觉醒（双刀）`);
        }
      },
    },
    'P-clean': {
      /* 前置子阶段②：昼末清理阶段（5.9）——位于白天流程全部结束之后、当夜步骤 0 之前，
         独立于白天流程；不占行动菜单与私聊额度；清洗结果自当夜步骤 0 起生效。
         〔裁决③ 2026-10-03〕寂灭与决斗两阶段拔除本窗口（进入时假标记即被清除，无可清洗对象）——
         本步已从 EXTINCT/DUEL 队列移除；5.9「寂灭时刻与决斗时刻中假标记已于进入时清空」
         原引 1.4.1，而 1.4.2 决斗时刻并未写明，此扩及按就近明文采信并登记勘误。 */
      req: g => alive(g).filter(p => p.faction === 'alien' && p.infection && !p.infection.real && canAct(g, p))
                        .map(p => ({ pid: p.id, kind: 'clean' })),
      form: () => ({
        kind: 'clean', title: '昼末清理阶段 · 清洗（5.9）',
        desc: '独立窗口（不占当夜行动菜单与私聊额度）：清除自身假感染标记，每夜至多 1 次。真标记不可被清洗；仅可清除自身标记。',
        opts: [{ v: 'yes', label: '清洗自身假标记' }, { v: 'no', label: '不清洗' }],
      }),
      run(g) {
        for (const p of g.players) {
          const d = g.decisions[p.id];
          if (p.out || !d || !d.do) continue;
          if (p.infection && !p.infection.real) {
            p.infection = null;
            priv(g, p, '你清洗掉了自身的假标记。');
            g.log.push({ night: g.night, step: g.step, batch: null, text: `（队内可见）${p.id} 号清洗了假标记。`, kind: 'info', scope: 'alien' });
            god(g, `${p.id} 号昼末清洗：移除自身假标记`);
          }
        }
      },
    },
    };
  }

  global.EngineSteps = createSteps;
})(typeof window !== 'undefined' ? window : globalThis);
