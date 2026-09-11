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
      revealPublic,
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
      req: g => g.players.filter(p => !p.out && p.infection && p.infection.real && p.suppressLeft > 0)
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
          if (!d || !d.use || p.out || !p.infection || !p.infection.real || p.suppressLeft <= 0) continue;
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
          if (p.out || !p.infection || !p.infection.real) continue;
          if (p.infection.deathNight !== g.night) continue;
          if (p.faction === 'xeno' && p.nightImmune > 0) {
            p.nightImmune -= 1; p.immuneActiveNight = g.night;
            p.infection = null; p.cureSelf = 0;
            priv(g, p, '夜晚免疫触发：本次感染致死被拦下，感染标记同时清除。');
          } else {
            p.dying = true; p.dyingCause = 'infect';
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
          if (p.role === 'crew' && !p.transferred && (alive(g).length <= 6 || g.night >= 6))
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

    '0.7': {
      req: g => alive(g).filter(p => (p.faction === 'alien' || p.faction === 'xeno') && canAct(g, p))
                        .map(p => ({ pid: p.id, kind: 'branch' })),
      form(g, p) {
        if (p.faction === 'alien') {
          /* v4.1 §3.2：破坏量由破坏者提交行动时自选——未进化 6 档（1.0~1.5）、破坏进化 11 档（2.0~3.0），内部整数（×10） */
          const big = p.alien.dir === 'destroy';
          const lo = big ? 20 : 10, hi = big ? 30 : 15;
          const sabOpts = [];
          for (let v = lo; v <= hi; v++) sabOpts.push({ v, label: (v / 10).toFixed(1) });
          return {
            kind: 'branch', title: '步骤 0.7 · 行动预提交',
            desc: '仅锁定「本夜是否走破坏路线」。选破坏将在步骤 4b 结算并跳过步骤 7；具体行动仍于步骤 7 决定。' +
                  (big ? '破坏进化：破坏量 2.0~3.0 自选。' : '破坏量 1.0~1.5 自选。'),
            opts: [{ v: 'destroy', label: '本夜破坏', sub: '步骤 4b 结算，跳过步骤 7', disabled: !!g.extinction || !!g.duel },
                   { v: 'act', label: '本夜不破坏', sub: '步骤 7 再决定出刀 / 感染 / 结茧' }],
            num: { label: '破坏量（自选档）', options: sabOpts },
          };
        }
        const sabOpts = [];
        for (let v = 20; v <= 30; v++) sabOpts.push({ v, label: (v / 10).toFixed(1) });
        return {
          kind: 'branch', title: '步骤 0.7 · 行动预提交',
          desc: '外星人当夜只能在「查验 / 击杀 / 破坏」中选一项。破坏量 2.0~3.0 自选，全局仅 1 次。',
          opts: [
            { v: 'kill', label: '本夜击杀', sub: '步骤 5 结算' },
            { v: 'check', label: '本夜查验', sub: '步骤 1 结算，当夜不能击杀' },
            { v: 'destroy', label: '本夜破坏', sub: '次夜停转（唯一公开足迹）；剩余 1 次', disabled: p.destroyLeft <= 0 || g.extinction || g.duel },
          ],
          num: { label: '破坏量（自选档）', options: sabOpts },
        };
      },
      run(g) {
        for (const p of g.players) {
          const d = g.decisions[p.id]; if (!d || p.out) continue;
          p.branch = d.branch || null;
          p.sabAmount = (d.branch === 'destroy' && d.num) ? d.num : null;   // v4.1：破坏量随行动提交，整数（×10）
          /* 决斗时刻无步骤 4b（破坏冻结）；寂灭期破坏冻结；外星人额度耗尽——三者均不得保留破坏分支 */
          if (p.branch === 'destroy' && (p.destroyLeft <= 0 && p.faction === 'xeno' || g.extinction || g.duel))
            p.branch = p.faction === 'xeno' ? 'kill' : 'act';
        }
      },
    },

    '1': {
      req: g => g.players.filter(p => p.faction === 'xeno' && !p.out && p.branch === 'check' && canAct(g, p))
                         .map(p => ({ pid: p.id, kind: 'xenoCheck' })),
      form: (g, p) => ({
        kind: 'xenoCheck', title: '步骤 1 · 外星人查验',
        desc: '查验 1 名其他存活玩家的真实阵营与职业。当夜不能击杀或破坏。不可连续两晚对同一目标发动蛰伏。',
        /* v24 规则 6.1：不可连续两夜对同一目标发动蛰伏 */
        targets: formPlayers('aliveOthers', 1, 1,
          p.lastXenoCheck && p.lastXenoCheck.night === g.night - 1 ? [p.lastXenoCheck.target] : []),
      }),
      run(g) {
        for (const p of g.players) {
          if (p.faction !== 'xeno' || p.out) continue;
          const d = g.decisions[p.id]; if (!d || !d.target) continue;
          const t = P(g, d.target); if (!t || t.out) continue;
          p.known.set(t.id, { faction: t.faction, role: t.role });
          /* v26：删除 p.sus.set(...)——sus 是 v21 前的旧可疑度 Map，全仓 0 处消费（死写入）。
             查验结果经 known（+ v26 修好的 knownLockOf）进入 E 三通道模型。 */
          /* v24 规则 6.1：记录蛰伏目标与结果——沉默窗口（步骤 1b）据此询问，
             并把结果交给 AI/真人做「看到结果之后」的选择 */
          p.lastXenoCheck = { night: g.night, target: t.id };
          p.lastXenoCheckRes = { id: t.id, faction: t.faction, role: t.role, roleName: t.roleName };
          /* v32 批 5′：R10 蛰伏结果流水（单人私有，delta=0 占位） */
          if (global.MoE && global.MoE.absorbPrivate)
            global.MoE.absorbPrivate(g, p.id, t.id, `own:xeno:check:${g.night}`, 'fact');
          priv(g, p, `查验结果：${t.id} 号是${D.FACTION[t.faction].name}（职业：${t.roleName}）` +
                     (t.transferred ? '（原职业：普通船员）' : ''));
          priv(g, t, '你被『外星人』查验。');
          g.checkCount = (g.checkCount || 0) + 1;
        }
      },
    },

    /* v24 规则 6.1 蛰伏专属沉默：选择权在【看到查验结果之后】行使——必须拆成独立步骤，
       否则在不知道对方是谁的情况下决定沉默，违反规则时序（N375 沉默三重战术的前提）。
       沉默只能指向本次查验的该目标，不可转指他人；已被沉默过的目标选项不再出现。 */
    '1b': {
      req: g => g.players.filter(p => p.faction === 'xeno' && !p.out && p.branch === 'check' &&
                                      p.lastXenoCheck && p.lastXenoCheck.night === g.night &&
                                      (() => { const t = P(g, p.lastXenoCheck.target); return t && !t.out && !t.silencedOnce; })())
                         .map(p => ({ pid: p.id, kind: 'xenoSilence' })),
      form: (g, p) => {
        const r = p.lastXenoCheckRes || {};
        return {
          kind: 'xenoSilence', title: '步骤 1b · 蛰伏 · 可选沉默',
          desc: `查验结果：${r.id} 号是${D.FACTION[r.faction] ? D.FACTION[r.faction].name : '—'}（职业：${r.roleName || '—'}）。
                 是否对该目标施加【沉默】？（沉默于次夜封锁其夜间主动技能；选择权在看到结果之后行使）`,
          opts: [{ v: 'no', label: '不施加沉默' }, { v: 'yes', label: `对 ${r.id} 号施加沉默` }],
        };
      },
      run(g) {
        for (const p of g.players) {
          if (p.faction !== 'xeno' || p.out) continue;
          const d = g.decisions[p.id];
          if (!d || !d.silence || !p.lastXenoCheck || p.lastXenoCheck.night !== g.night) continue;
          const t = P(g, p.lastXenoCheck.target);
          if (!t || t.out || t.silencedOnce) continue;
          t.silencedOnce = true;
          t.silenceNight = g.night + 1;
          priv(g, t, '你已被【沉默】：次夜的夜间主动技能被封锁（投票与私聊不受影响）。');
          god(g, `蛰伏沉默：${p.id} 号对 ${t.id} 号施加沉默（次夜生效）`);
        }
      },
    },

    '2': {
      req(g) {
        const out = [];
        for (const p of alive(g)) {
          if (!canAct(g, p)) continue;
          if (p.role === 'crew') out.push({ pid: p.id, kind: 'crewAction' });
          if (p.role === 'detective') out.push({ pid: p.id, kind: 'detective' });
        }
        return out;
      },
      form(g, p) {
        if (p.role === 'crew') {
          return {
            kind: 'crewAction', title: '步骤 2 · 船员行动',
            desc: '每夜在「查验」与「协助维修」之间二选一。首次查验给出 2 个排除职业，同一目标累计 2 次锁定阵营。' +
                  (g.stopNight ? ' ⚠ 停转夜（来源：外星人破坏）：本夜维修无效、倒计时不流逝。' : ''),
            opts: [{ v: 'check', label: '查验 1 名玩家' },
                   { v: 'repair', label: '协助维修', sub: '仅削减倒计时，不削减净破坏量' + (g.stopNight ? '（停转夜无效）' : '') },
                   { v: 'none', label: '放弃行动' }],
            targets: formPlayers('aliveOthers', 1, 0),
            num: { label: '协助维修值', options: [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5].map(v => ({ v, label: v.toFixed(2) })) },
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
          pool: pool.map(x => ({ id: x.id, label: `${x.id} 号 · ${D.FACTION[x.v.faction].name}（${D.ROLES[x.v.role].name}）· 第 ${x.v.night} 夜查验` })),
        };
      },
      run(g) {
        let checks = 0;
        for (const p of g.players) {
          const d = g.decisions[p.id]; if (!d || p.out) continue;

          if (p.role === 'crew' && d.mode === 'repair') p.repairValue = d.value || 0.3;

          if (p.role === 'crew' && d.mode === 'check' && d.target) {
            const t = P(g, d.target); checks += 1;
            let rec = p.crewChecks.get(t.id);
            if (!rec) { rec = { n: 0, excludes: [], locked: null }; p.crewChecks.set(t.id, rec); }
            rec.n += 1;
            if (rec.n === 1 && !rec.locked) {
              /* 有效排除池：某职业全部持有者出局即移除（4.1②③）；不足 2 个按实际数量发放，无项可排除直接锁定 */
              let poolList = D.HUMAN_BASE_ROLES.filter(r =>
                r !== t.role && g.players.some(o => o.originRole === r && !o.out));
              g.rng.shuffle(poolList);
              if (poolList.length >= 2) {
                rec.excludes = poolList.slice(0, 2);
                p.known.set(t.id, { excludes: rec.excludes.slice() });
                priv(g, p, `${t.id} 号不是${D.ROLES[rec.excludes[0]].name}，也不是${D.ROLES[rec.excludes[1]].name}。`);
              } else if (poolList.length === 1) {
                rec.excludes = poolList.slice(0, 1);
                p.known.set(t.id, { excludes: rec.excludes.slice() });
                priv(g, p, `${t.id} 号不是${D.ROLES[rec.excludes[0]].name}。`);
              } else {
                rec.locked = t.faction;
                p.known.set(t.id, { faction: t.faction, role: null });
                priv(g, p, `排除池已空，直接锁定：${t.id} 号阵营为${D.FACTION[t.faction].name}。`);
                /* v32 批 5′：R01 二查锁定流水（单人私有，delta=0 占位） */
                if (global.MoE && global.MoE.absorbPrivate)
                  global.MoE.absorbPrivate(g, p.id, t.id, `own:crew:lock:${g.night}`, 'fact');
              }
            } else if (rec.n >= 2 && !rec.locked) {
              rec.locked = t.faction;
              p.known.set(t.id, { faction: t.faction, role: null });
              priv(g, p, `${t.id} 号阵营锁定：${D.FACTION[t.faction].name}。`);
              /* v32 批 5′：R01 二查锁定流水（单人私有，delta=0 占位） */
              if (global.MoE && global.MoE.absorbPrivate)
                global.MoE.absorbPrivate(g, p.id, t.id, `own:crew:lock:${g.night}`, 'fact');
            } else {
              priv(g, p, `对 ${t.id} 号的查验没有产生新信息。`);
            }
            /* v28（B3 裁定方向 (a) + D2 私有硬源）：船员的【私有】排除结果此前只写 p.known
               （不含 faction → knownLockOf 返回 null）与私信文本，证据层零落点 —— 这正是
               「私有硬源稀缺 / AI 同质化」的直接成因。
               排除的是【人类专属职业】⇒ 目标在贝叶斯上轻微更不像人类 → 写敌方通道；
               幅度取总表档位（Tiers.RULE.exclusion = D--，v28 新增的专用最弱档，
               标定见 tiers.js SCORE['D--']）。仅对【人类观察者本人】入账，避免异形视角下
               「非人类 = 队友」的语义反转；src 含双方 id，重复查验不重复计分（并罚同源取最强）。 */
            const TT = global.Tiers, AIx = global.AI;
            if (rec.n === 1 && rec.excludes.length && p.faction === 'human' && TT && AIx && AIx.addEvent) {
              /* v32 批 4′（统一入账口）：路径③改道 MoE.absorb（参数透传，行为等价） */
              global.MoE.absorb(g, p.id, [{ target: t.id, delta: TT.SCORE[TT.RULE.exclusion], grudge: false,
                src: `crewExclude:${p.id}:${t.id}`, kind: 'fact', tier: TT.RULE.exclusion, speakerId: null, chan: 'alien', expert: 'E8' }], { path: 'announce' });
            }
            priv(g, t, '你被『普通船员』查验。');
          }

          if (p.role === 'detective' && d.mode === 'check' && d.target) {
            const t = P(g, d.target); checks += 1;
            p.checkPool.set(t.id, { id: t.id, faction: t.faction, role: t.role, night: g.night, published: false });
            /* v32 批 5′：R02 已查验池流水（单人私有，delta=0 占位，量级留 7′） */
            if (global.MoE && global.MoE.absorbPrivate)
              global.MoE.absorbPrivate(g, p.id, t.id, `own:detective:check:${g.night}`, 'fact');
            priv(g, p, `查验结果：${t.id} 号是${D.FACTION[t.faction].name}（职业：${t.roleName}）` +
                       (t.transferred ? '（原职业：普通船员）' : ''));
            priv(g, t, '你被『神探』查验。');
          }

          if (p.role === 'detective' && d.mode === 'announce' && d.target) {
            const rec = p.checkPool.get(d.target);
            const t = P(g, d.target);
            if (rec && t && !t.out) {   /* 池内目标出局即移除，不可再发布（4.7③） */
              rec.published = true;     /* 4.7：只置发布标记，不改写池内快照——转职探测的前提 */
              rec.pubNight = g.night;   /* v31 批 2（A3）：发布夜次——神探预告类承诺（A01/A02）的兑现判据 */
              const txt = `${t.id} 号是${D.FACTION[t.faction].name}（职业：${D.ROLES[t.role].name}` +
                          (t.transferred ? '；原职业：普通船员）' : '）');
              announce(g, '③', `【神探公告】${txt}`);
              revealPublic(g, t, t.faction, t.role);   // v26：硬源经 known（带 role）写入全体观察者，已是唯一路径
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

    '2b': {
      req: g => g.players.filter(p => p.role === 'sheriff' && !p.out && !p.patrolUsed && g.night <= 3 && canAct(g, p))
                         .map(p => ({ pid: p.id, kind: 'patrol' })),
      form: () => ({
        kind: 'patrol', title: '步骤 2b · 巡逻',
        desc: '全局 1 次，仅限前 3 夜。指定 1~3 名玩家获得当夜保护（各挡 1 点伤害 + 1 次感染）。与当夜开枪互斥。',
        opts: [{ v: 'yes', label: '使用巡逻' }, { v: 'no', label: '不使用（保留开枪）' }],
        targets: formPlayers('alive', 3, 0),
      }),
      run(g) {
        for (const p of g.players) {
          const d = g.decisions[p.id];
          if (p.role !== 'sheriff' || p.out || !d || !d.use) continue;
          p.patrolUsed = true; p.patroledTonight = true;
          for (const id of d.targets || []) { const t = P(g, id); if (t && !t.out) t.patrol = true; }
          g.patrolCount = (d.targets || []).length;
          priv(g, p, `巡逻生效：${(d.targets || []).join('、') || '（无人）'} 号获得当夜保护。`);
          /* v32 批 5′：R03 巡逻结果流水（单人私有，delta=0 占位） */
          if (global.MoE && global.MoE.absorbPrivate) {
            for (const id of (d.targets || [])) { const t = P(g, id); if (t && !t.out) global.MoE.absorbPrivate(g, p.id, t.id, `own:sheriff:patrol:${g.night}`, 'fact'); }
          }
        }
      },
    },

    '3': {
      req: g => g.players.filter(p => p.role === 'bodyguard' && !p.out && canAct(g, p))
                         .map(p => ({ pid: p.id, kind: 'guard' })),
      form: (g, p) => ({
        kind: 'guard', title: '步骤 3 · 保镖保护',
        desc: '每夜保护 1 人（可为自己），抵挡 1 点伤害与 1 次感染。不可连续两夜保护同一目标。',
        targets: formPlayers('alive', 1, 0, [p.lastProtected]),
        skipLabel: '今夜放弃保护',
      }),
      run(g) {
        for (const p of orderedPlayers(g)) {
          const d = g.decisions[p.id];
          if (p.role !== 'bodyguard' || p.out) { continue; }
          /* 4.8：放弃保护（或未指定）即解除连续限制，隔夜后可再保原目标 */
          if (!d || d.target == null) { p.lastProtected = null; continue; }
          const t = P(g, d.target);
          if (!t || t.out) { p.lastProtected = null; continue; }
          t.guard = true; t.guardedBy = p.id;
          p.lastProtected = t.id;
          priv(g, p, `你保护了 ${t.id} 号。`);
          /* v32 批 5′：R04 保护目标流水（单人私有，delta=0 占位） */
          if (global.MoE && global.MoE.absorbPrivate)
            global.MoE.absorbPrivate(g, p.id, t.id, `own:bodyguard:guard:${g.night}`, 'fact');
        }
      },
    },

    '4a': {
      /* 3.2 停转夜：维修选项保持可选（保留「放弃行动」与「行动无效」的可区分性），结算时判无效并随 ④ 公告 */
      req: g => alive(g).filter(p => (p.role === 'engineer' || p.role === 'assistant') && canAct(g, p))
                        .map(p => ({ pid: p.id, kind: 'repair' })),
      form(g, p) {
        const opts = [{ v: 'repair', label: '维修（−1.0）', sub: '倒计时 −1.0，净破坏量 −1.0' }];
        if (p.role === 'engineer')
          opts.push({ v: 'extra', label: '维修 + 追加维修（−2.0）', sub: `工程师独属，剩余 ${p.extraRepair}/3（基础 + 追加当夜一并结算）`, disabled: p.extraRepair <= 0 });
        opts.push({ v: 'none', label: '放弃维修' });
        return {
          kind: 'repair', title: '步骤 4a · 维修',
          desc: `累计维修量 ${p.repairTotal.toFixed(1)} / ${(p.role === 'engineer' ? 4 : 3).toFixed(1)}（达阈值即向全场暴露编号与职业）。` +
                (g.stopNight ? ' ⚠ 停转夜：本夜维修无效、倒计时不流逝。' : ''),
          opts,
        };
      },
      run(g) {
        if (g.stopNight) { announce(g, '④', '停转夜（来源：外星人破坏）：本夜维修无效、倒计时不流逝。'); return; }
        let total = 0, crewTotal = 0, crewN = 0;
        const exposed = [], crewIds = [];
        for (const p of g.players) {
          if (p.out) continue;
          if (p.role === 'engineer' || p.role === 'assistant') {
            const d = g.decisions[p.id];
            if (!d || !d.do) continue;
            let amt = 1;
            if (d.extra && p.role === 'engineer' && p.extraRepair > 0) { amt = 2; p.extraRepair -= 1; }
            g.countdown -= amt;
            g.net10 = Math.max(0, g.net10 - amt * 10);
            p.repairTotal += amt;
            /* v32 批 5′：R08/R12 维修累计流水（单人私有，delta=0 占位） */
            if (global.MoE && global.MoE.absorbPrivate)
              global.MoE.absorbPrivate(g, p.id, p.id, `own:${p.role}:repair:${g.night}`, 'fact');
            total += amt;
            god(g, `${p.id} 号维修 −${amt.toFixed(1)}（倒计时/净破坏）`);
            const th = p.role === 'engineer' ? 4 : 3;
            if (!p.repairExposed && p.repairTotal >= th) {
              p.repairExposed = true;
              /* ④ 维修暴露 = 官方公告（编号与职业向全场公开）→ v32 补硬锁：
                 revealPublic 把 faction/role 写入全员 known（knownLockOf 唯一路径）——
                 此前只写 A/A− 事件，官方确证被当软证据衰减，人类观察者对已暴露工程师
                 的怀疑度不清零（用户拍板「所有公告/暴露改为硬锁机制」）。 */
              revealPublic(g, p, 'human', p.role);
              global.AI.onExpose(g, p.id, 30, 'repair');   // R22 维修暴露（双向）→ 威胁度事件
              /* v31 批 3.5（N401 连带，定案 1 的落地缺口）：④ 暴露公告固定标注原职业 ——
                 ⑥⑩ 揭示公告早已这么写（engine.js ⑩ / 本文件 '9'），④ 一直漏。
                 补上后「职业：助理工程师；原职业：普通船员」即向全场泄露
                 「转职已发生 ⇒ 存活≤6 或已过第 6 夜」（正是 N401 cond 的连带推论）。 */
              exposed.push(`${p.id} 号（${p.roleName}${p.transferred ? '；原职业：普通船员' : ''}）`);
              priv(g, p, '你已暴露：编号与职业已向全体玩家公开。');
            }
          }
          if (p.role === 'crew' && p.repairValue) {
            g.countdown -= p.repairValue;
            crewTotal += p.repairValue; crewN += 1;
            crewIds.push(p.id);
            god(g, `${p.id} 号协助维修 −${p.repairValue.toFixed(2)}（仅倒计时）`);
            p.repairValue = null;
          }
        }
        g.countdown = Math.round(g.countdown * 100) / 100;
        g.actCounts.repair += total;
        let txt = `维修总量 ${(total + crewTotal).toFixed(2)}（工程维修 ${total.toFixed(1)}，船员协助 ${crewTotal.toFixed(2)}）`;
        if (exposed.length) txt += `；维修者暴露：${exposed.join('、')}`;
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

    '4b': {
      run(g) {
        let alienN = 0, other = 0, total10 = 0;    // v4.1 定案43：破坏量整数存储（×10）
        const exposed = [];
        for (const p of g.players) {
          if (p.out) continue;
          if (p.faction === 'alien' && p.branch === 'destroy') {
            /* v4.1 §3.2：量值=提交时自选档（未进化 10~15 / 破坏进化 20~30），越界档回退区间下限并留审计 */
            const big = p.alien.dir === 'destroy';
            let amt10 = p.sabAmount || (big ? 20 : 10);
            if (amt10 < (big ? 20 : 10) || amt10 > (big ? 30 : 15)) amt10 = big ? 20 : 10;
            g.net10 += amt10; p.alien.destroyTotal10 += amt10; alienN += 1; total10 += amt10;
            p.guardStreak = 0;                                              // 破坏属主动行为：疲劳归零
            god(g, `${p.id} 号破坏 +${(amt10 / 10).toFixed(1)}（个人累计 ${(p.alien.destroyTotal10 / 10).toFixed(1)}）`);
            if (!p.destroyedExposed && p.alien.destroyTotal10 >= 60) {      // 3.2 破坏者暴露阈值 6.0
              p.destroyedExposed = true;
              revealPublic(g, p, 'alien', null);
              global.AI.onExpose(g, p.id, 32, 'destroy');  // R23 破坏者暴露 → 威胁度事件
              exposed.push(`${p.id} 号`);
            }
          }
          if (p.faction === 'xeno' && p.branch === 'destroy' && p.destroyLeft > 0) {
            let amt10 = p.sabAmount || 20;                                  // v4.1 §6.3：2.0~3.0 自选
            if (amt10 < 20 || amt10 > 30) amt10 = 20;
            g.net10 += amt10; p.destroyLeft -= 1; other += 1; total10 += amt10;
            g.pendingStop = true;
          }
        }
        const fired = [];
        for (const tier of [3, 6]) {
          if (g.net10 >= tier * 10 && !g.tiers[tier]) {
            g.tiers[tier] = true;
            g.countdown += (tier === 3 ? 1.5 : 3.0);
            fired.push(`净破坏量达 ${(tier / 10).toFixed(1)} → 倒计时 +${tier === 3 ? 1.5 : 3.0}`);
          }
        }
        if (g.net10 >= 90 && !g.tiers[9]) {
          g.tiers[9] = true;
          fired.push('净破坏量达 9.0 → 人类倒计时胜利永久失效');
          banner(g, '净破坏量达 9.0：人类倒计时胜利永久失效，只能靠清场取胜。');
        }
        g.actCounts.destroy += alienN;
        if (other) g.actCounts.otherDestroy += 1;
        /* v4.1 批次⑤合并口径：只报当夜总破坏量 T，不报只数、不分来源；T=0 不发布（不发布即该夜无破坏） */
        let txt = `本夜破坏总量：${(total10 / 10).toFixed(1)}`;
        if (exposed.length) txt += `；破坏者暴露：${exposed.join('、')}（异形）`;
        if (fired.length) txt += `；${fired.join('；')}`;
        if (total10 > 0) announce(g, '⑤', txt);
      },
    },

    '5': {
      req: g => g.players.filter(p => p.faction === 'xeno' && !p.out && p.branch === 'kill' && canAct(g, p))
                         .map(p => ({ pid: p.id, kind: 'xenoKill' })),
      form(g, p) {
        const max = p.awakened ? 2 : 1;
        return {
          kind: 'xenoKill', title: '步骤 5 · 外星人行动',
          desc: p.awakened ? '已觉醒：每夜至多 2 刀，命中濒死附带沉默。'
            : '未觉醒：每夜至多 1 刀。觉醒条件：第 6 夜起或全场存活≤6 名，自动达成、不可逆（与异形的击杀进化方向无关）。',
          targets: formPlayers('aliveOthers', max, 0),
          skipLabel: '今夜不出刀',
        };
      },
      run(g) {
        for (const p of g.players) {
          if (p.faction !== 'xeno' || p.out) continue;
          if (!p.awakened && (g.night >= 6 || alive(g).length <= 6)) {
            p.awakened = true;
            priv(g, p, '你已觉醒：自本夜起可使用双刀（命中濒死附带沉默）。');
          }
          const d = g.decisions[p.id];
          if (!d || !d.targets || !d.targets.length) continue;
          /* 结算端硬上限：未觉醒 1 刀，觉醒后 2 刀（与表单上限一致，防越权提交） */
          const shots = (d.targets || []).slice(0, p.awakened ? 2 : 1);
          for (const id of shots) applyLethal(g, P(g, id), 'xeno', p);
        }
      },
    },

    '6': {
      req: g => alive(g).filter(p => ((p.role === 'sheriff' && p.bullets > 0 && !p.patroledTonight) ||
                                      (p.role === 'armed' && p.bullets > 0)) && canAct(g, p))
                        .map(p => ({ pid: p.id, kind: 'shoot' })),
      form(g, p) {
        const max = p.role === 'sheriff' ? Math.min(2, p.bullets) : 1;
        return {
          kind: 'shoot', title: '步骤 6 · 开枪',
          desc: `剩余子弹 ${p.bullets} 发。指定即结算，可能误伤队友；击杀敌方单位下夜回复子弹。`,
          targets: formPlayers('aliveOthers', max, 0),
          skipLabel: '今夜不开枪',
        };
      },
      run(g) {
        for (const p of orderedPlayers(g)) {
          const d = g.decisions[p.id];
          if (p.out || !d || !d.targets || !d.targets.length) continue;
          if (p.role !== 'sheriff' && p.role !== 'armed') continue;
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
        return alive(g).filter(p => p.faction === 'alien' && p.branch !== 'destroy' && canAct(g, p))
                       .map(p => ({ pid: p.id, kind: 'alienAct' }));
      },
      form(g, p) {
        const maxInf = p.alien.dir === 'infect' ? 3 : 2;
        const noCd = p.alien.dir === 'kill';
        const extraMax = (noCd ? 1 : 0) + (p.alien.extraKill > 0 ? 1 : 0);
        return {
          kind: 'alienAct', title: '步骤 7 · 异形行动',
          desc: g.extinction
            ? `寂灭时刻：行动收敛为「出刀 / 结茧」二选一。刀数 ${noCd ? '出刀无冷却' : p.alien.kills + '/2'}；护盾 ${p.shield} 层。`
            : `刀数 ${noCd ? '出刀无冷却' : p.alien.kills + '/2'}；感染上限 ${maxInf} 名（濒死者不可感染）；结茧护盾 ${p.shield} 层。` +
              ' 注意：出刀每次仅结算「1 刀 + 额外刀数」，多选目标时多余目标不会生效。',
          opts: [
            { v: 'kill', label: '出刀', sub: noCd ? '击杀进化：无冷却' : '需刀数 ≥1',
              disabled: !noCd && p.alien.kills < 1 },
            { v: 'infect', label: '感染', sub: `至多 ${maxInf} 名（可含队友欺诈标记）`,
              disabled: !!g.extinction },
            { v: 'cocoon', label: '结茧', sub: '获得 1 层护盾，跨夜保留', disabled: p.shield > 0 },
            { v: 'none', label: '放弃行动', sub: '不出刀则刀数 +1' },
          ],
          targets: formPlayers('aliveOthers', Math.max(extraMax, maxInf), 0),
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
          } else if (d.act === 'infect' && !g.extinction) {
            const max = p.alien.dir === 'infect' ? 3 : 2;
            let used = 0;
            for (const id of (d.targets || [])) {
              if (used >= max) break;
              const t = P(g, id);
              if (!t || t.out || t.dying) continue;      // 濒死者不可感染（5.3 目标限制）
              used += 1;
              const r = applyInfection(g, t, p);
              if (r === 'fake') g.log.push({ night: g.night, step: g.step, batch: null,
                text: `（队内可见）${p.id} 号为 ${id} 号打上了欺诈标记。`, kind: 'info', scope: 'alien' });
            }
          } else if (d.act === 'cocoon') {
            if (p.shield <= 0) { p.shield = 1; priv(g, p, '结茧：获得 1 层护盾（跨夜保留）。'); }
          }
          /* v4 6.2 反拖延：出刀/感染/破坏 → 疲劳归零；结茧/放弃 → 疲劳 +1 */
          p.guardStreak = (d.act === 'kill' || d.act === 'infect' || d.act === 'destroy') ? 0 : (p.guardStreak || 0) + 1;
        }
      },
    },

    '8': {
      req(g) {
        const out = [];
        for (const p of alive(g)) {
          const blocked = p.silenceNight === g.night || p.noActive;
          if (['bio', 'rescue', 'tempdoc'].indexOf(p.role) >= 0) {
            /* 自救属濒死状态下的被动救命，不受沉默 / 感染抑制封锁（2.4④） */
            const selfSave = p.dying && ((p.role === 'bio' && p.selfSaveLeft > 0) || (p.rescueLeft > 0 && p.role !== 'bio'));
            if (!blocked || selfSave) out.push({ pid: p.id, kind: 'doctor' });
          }
          if (p.faction === 'xeno' && p.infection && p.infection.real && p.cureSelf > 0 && canAct(g, p))
            out.push({ pid: p.id, kind: 'xenoCure' });
        }
        return out;
      },
      form(g, p) {
        if (p.faction === 'xeno') {
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
        const canRescue = p.role === 'rescue' || p.role === 'tempdoc';
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
          opts.push({ v: 'selfsave', label: '自救', sub: '解除自身濒死、清感染' + (isBio ? '并获得抗体' : '（不赋予抗体）') });
        if (!blocked)
          opts.push({ v: 'brew', label: '制药', sub: p.brew
            ? `进度 ${p.brew.progress}/2（${p.brew.product === 'rescue' ? '救援药剂' : '治疗药剂'}）` +
              (p.brew.lastNight !== g.night - 1 ? '；已暂停，不回退' : '')
            : '放弃 2 个夜晚的行动产出药剂（两夜可不连续，中断不回退）' });
        opts.push({ v: 'none', label: '今夜不出手' });
        return {
          kind: 'doctor', title: '步骤 8 · 医生',
          desc: '每晚仅一类出手（治疗 / 救援 / 自救 / 制药互斥）。感染标记清单：' +
                (infected.length ? infected.map(x => x.id + ' 号').join('、') : '（空）') +
                (canRescue && dying.length ? '。⚠ 风险提示：救援不限阵营，你看不到被救者身份——异形会用「自伤队友」制造濒死诱饵。' : ''),
          opts,
          targets: formPlayers('alive', 3, 0),
          num: { label: '制药产物', options: [{ v: 'rescue', label: '1 瓶救援药剂（+1 救援额度）' }, { v: 'heal', label: '2 瓶治疗药剂（+2 治疗额度）' }] },
        };
      },
      run(g) {
        /* 医生 R7：更新感染标记首次可见夜（假标记识别素材）。
           v26 追加 markEverSeen（**AI 的记事本等价物**）：总表 N148 明写「医生须自记标记首见夜 n，
           规则不代为记录（3.3①）」——人在记事本上记，AI 就必须有对应状态。
           与 markSeen 的区别：markSeen 随标记消失而删除（「当前有没有标记」），
           markEverSeen 保留「我曾在第 n 夜见过他带标记」以及它【何时消失】，
           这正是 N139（标记消失而 ⑫ 未增 ⇒ 持有人非人类）与 N141（逾期未死 + 消失 ⇒ 确证异形）
           的前置条件——没有它，这两条医生侧最强的通道在实现上无法评估。 */
        for (const doc of g.players) {
          /* v32 机制对等：玩家扮演医生时同样拥有标记记忆（markSeen/markEverSeen）——此前玩家医生零资产 */
          if (doc.out || ['bio', 'rescue', 'tempdoc'].indexOf(doc.role) < 0) continue;
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
              const ever = doc.markEverSeen.get(x.id);
              /* 首次观察到「标记没了」：记下消失夜与【上一夜的 ⑫ 清除次数】（公开公告口径）——
                 g.lastCureHands 由步骤 9 落账（上一夜的值），据此区分「被医生清掉」与「W/I/Q 隐形清除」 */
              if (ever && ever.lastSeen < g.night && ever.goneNight == null) {
                ever.goneNight = g.night;
                ever.noCure = (g.lastCureHands === 0);
              }
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
          if (doc.role !== 'rescue' && doc.role !== 'tempdoc') continue;
          doc.dyingSeen = { night: g.night, ids: g.players.filter(x => !x.out && x.dying).map(x => x.id) };
          /* v32 批 5′：R06/R13 濒死名单流水（单人私有，delta=0 占位） */
          if (global.MoE && global.MoE.absorbPrivate) {
            for (const id of doc.dyingSeen.ids) global.MoE.absorbPrivate(g, doc.id, id, `own:${doc.role}:dying:${g.night}`, 'fact');
          }
        }
        for (const p of orderedPlayers(g)) {
          const d = g.decisions[p.id];
          if (p.out || !d) continue;

          if (p.faction === 'xeno') {
            if (d.use && p.infection && p.infection.real && p.cureSelf > 0) {
              clearInfection(g, p);
              priv(g, p, '你使用感染治疗额度清除了自身感染。');
            }
            continue;
          }
          if (['bio', 'rescue', 'tempdoc'].indexOf(p.role) < 0) continue;
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
              priv(g, t, had ? '医生为你清除了感染。' : '医生对你进行了一次清除感染的出手。');
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
              god(g, `${p.id} 号救援 ${t.id} 号：解除濒死（濒死原因 ${D.CAUSE_NAME[cause] || '未知'}）`);
              priv(g, t, '你被医生救回。');
              if (p.role === 'rescue' || p.role === 'tempdoc')
                priv(g, p, `${t.id} 号本次濒死原因：${D.CAUSE_NAME[cause] || '未知'}`);
            }
          } else if (d.act === 'selfsave' && p.dying &&
                     ((p.role === 'bio' && p.selfSaveLeft > 0) || (p.rescueLeft > 0 && p.role !== 'bio'))) {
            p.dying = false; p.dyingCause = null;
            clearInfection(g, p);
            if (p.role === 'bio') { p.antibodyNight = g.night + 1; p.antibodyBy = p.id; p.selfSaveLeft -= 1; }
            else p.rescueLeft -= 1;
            priv(g, p, '自救成功：解除濒死、清除感染' + (p.role === 'bio' ? '并获得抗体。' : '。'));
          } else if (d.act === 'brew' && !blocked && !p.dying) {
            if (!p.brew) p.brew = { progress: 0, product: d.product || 'heal' };
            if (!p.brew) p.brew = { progress: 0, product: d.product || 'heal' };
            p.brew.product = d.product || p.brew.product;   /* 产物以完成时之选为准（3.3③） */
            p.brew.progress += 1;
            p.brew.lastNight = g.night;
            if (p.brew.progress >= 2) {
              p.brewDone = p.brew.product;                  /* 产物于次夜到账（3.3⑨） */
              priv(g, p, '制药完成：产物将于下一夜发放。');
              p.brew = null;
            } else priv(g, p, `制药进度 ${p.brew.progress}/2（${p.brew.product === 'rescue' ? '救援药剂' : '治疗药剂'}）。`);
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
          revealPublic(g, p, p.faction, p.role);
          deaths.push(p);
          /* 悬赏（4.4⑤）：当夜对该目标出过枪击的警长/武装船员，各独立回复 1 发（含未取得死因归属者） */
          if (p.cause === 'gun' && p.faction !== 'human' && p.gunAttackers) {
            for (const aid of [...new Set(p.gunAttackers)]) {
              const k = P(g, aid);
              if (k && !k.out && (k.role === 'sheriff' || k.role === 'armed')) k.bounty += 1;
            }
          }
        }
        for (const p of deaths)
          announce(g, '⑥', `${p.id} 号死亡，${D.FACTION[p.faction].name}（职业：${p.roleName}` +
                            `${p.transferred ? '；原职业：普通船员' : ''}），死于${D.CAUSE_NAME[p.cause]}`);
        if (!deaths.length) announce(g, '⑥', '今夜无人死亡。');
        /* v21 改动 #13：⑪ 感染抑制通道整体删除（规则硬违规）——v4.1 明文「不予通报、任何阵营均不可见」，
           此前把抑制人数做成公告发给异形。speakable.js 中「⑪ 不予通报 → 不可验证，属 D 档」口径因此成立。 */
        if (g.cureHands) announce(g, '⑫', `医生清除感染出手：${g.cureHands} 次。`, 'non-alien');   /* 数量为 0 不发布（2.1） */
        g.actCounts.death += deaths.length;
        g.actCounts.cure += g.cureHands;
        /* v26：把本夜 ⑫ 计数留给下一夜使用——医生在步骤 8 观察到「标记消失」时，
           需要的是【消失那一夜】的清除次数（⑫ 为公开公告口径，属合法信息），
           用于区分「被医生清掉」（⑫>0）与「W/I/Q 隐形清除」（⑫=0）。 */
        g.lastCureHands = g.cureHands;
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
        const w = checkWin(g);
        if (w) { endGame(g, w); return; }
      },
    },

    '10': {
      req: g => g.players.filter(p => p.role === 'inspector' && !p.out && p.meetingLeft > 0 &&
                                      canAct(g, p) && alive(g).length >= 5 && !g.extinction && !g.duel)
                         .map(p => ({ pid: p.id, kind: 'meeting' })),
      form: () => ({
        kind: 'meeting', title: '步骤 10 · 紧急会议',
        desc: '全场唯一一次，错过不再出现。发动即公开你的编号与身份（官方背书），当夜召开一场与白天同等的会议（遗言→讨论→投票→驱逐），并跳过步骤 11（倒计时不减）。',
        opts: [{ v: 'no', label: '不召开（保留，下夜可再决定）' },
               { v: 'yes', label: '召开紧急会议', sub: '立即公开你的验票官身份' }],
      }),
      run(g) {
        for (const p of g.players) {
          const d = g.decisions[p.id];
          if (p.role !== 'inspector' || p.out || !d || !d.call) continue;
          p.meetingLeft -= 1;
          revealPublic(g, p, 'human', 'inspector');
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
        const w = checkWin(g);
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
        desc: '实时讨论中：你发送的发言会立即显示给所有人，AI 也会陆续表态。可在下方点名一名玩家进行公开指控（计入威胁度，影响他人投票）。',
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
        desc: '实时讨论中：你发送的发言会立即显示给所有人，AI 也会陆续表态。可在下方点名一名玩家进行公开指控（计入威胁度，影响他人投票）。也可以直接结束讨论。',
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

    'D-clean': {
      req: g => alive(g).filter(p => p.faction === 'alien' && p.infection && !p.infection.real && canAct(g, p))
                        .map(p => ({ pid: p.id, kind: 'clean' })),
      form: () => ({
        kind: 'clean', title: '昼末清洗',
        desc: '独立窗口（不占当夜行动）：清除自身身上的假感染标记。真标记不可清洗。',
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
