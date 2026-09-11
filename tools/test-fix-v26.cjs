/* v26 全面修复 · 回归断言（每条对应一处缺陷，失败即视为修复失效）
   用法：node tools/test-fix-v26.cjs
   载入顺序与 mc.cjs 一致（无 DOM / 无 UI），直接调用 AI / Bridge 的公开接口。 */
const fs = require('fs');
const path = require('path');
const { makeCtx, loadInto, profiles } = require('./load-order.cjs');

const base = path.join(__dirname, '..', 'js');
const ctx = makeCtx({ RegExp });
loadInto(ctx, base, profiles.full);

const { Setup, Engine, AI, Bridge, IR, Tiers, MoE, Channels, Tactics } = ctx;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  → ' + extra : ''}`); }
}
const newGame = seed => {
  const g = Setup.createGame(seed, 'random');
  g.humans = []; g.humanId = -1;
  for (const p of g.players) p.isHuman = false;      // 全 AI，便于直接检查证据表
  return g;
};
const evsOf = (p, id) => (p.tEvents.get(id) || []);

/* ---------- 1. P0-② knownLockOf：硬源锁定对「人类」不再失效 ---------- */
{
  const g = newGame(1);
  const viewer = g.players[0];                        // 人类观察者
  const human = g.players.find(p => p.faction === 'human' && p.id !== viewer.id);
  const enemy = g.players.find(p => p.faction === 'alien');
  viewer.known.set(human.id, { faction: 'human', role: null });
  viewer.known.set(enemy.id, { faction: 'alien', role: 'alien' });
  ok('已知「人类」→ 怀疑度归零（旧实现查表得 undefined → 返回先验 ~28.6）',
    AI.suspOf(g, viewer, human.id) === 0, 'susp=' + AI.suspOf(g, viewer, human.id));
  ok('已知「异形」→ 怀疑度 100（非回归）',
    AI.suspOf(g, viewer, enemy.id) === 100, 'susp=' + AI.suspOf(g, viewer, enemy.id));
}

/* ---------- 2. P0-① 透视：船员双查池不再按真相阵营排除异形 ---------- */
{
  const g = newGame(2);
  const crew = g.players.find(p => p.role === 'crew');
  const others = g.players.filter(p => p.id !== crew.id && p.faction !== 'alien');
  for (const o of others) crew.crewChecks.set(o.id, { n: 1, excludes: [], locked: null });   // 只剩异形未查
  const d = AI.decide(g, { pid: crew.id, kind: 'crewAction' });
  const tgt = d && d.target != null ? AI.byId(g, d.target) : null;
  ok('船员查验池含异形（旧实现 x.faction !== \'alien\' 把异形全部排除）',
    !!(tgt && tgt.faction === 'alien'), 'target=' + (tgt ? tgt.id + '/' + tgt.faction : 'null'));
}

/* ---------- 3. P0-① / ③ 文本路径：查验汇报产生「目标侧」证据 + 同句指控不被吞 ---------- */
{
  const g = newGame(3);
  const speaker = g.players.find(p => p.faction === 'human');
  const target = g.players.find(p => p.id !== speaker.id);
  Bridge.say(g, speaker.id, `我查过 ${target.id} 号，能确定他的阵营是异形。`, { kind: '讨论' });
  const side = g.players.filter(p => !p.isHuman && p.id !== speaker.id && p.id !== target.id)
    .some(p => evsOf(p, target.id).some(e => String(e.src).indexOf('locksay:') === 0));
  ok('查验汇报 → 观察者对【目标】产生证据（旧实现只给说话者记自证）', side);
  const acc = g.players.some(p => (speaker.accuseHistory || []).some(a => a.id === target.id));
  ok('「汇报 + 指控同句」不再被汇报分支吞掉', acc === true || g.players.some(p =>
    evsOf(p, target.id).some(e => String(e.src).indexOf('accuse:') === 0)));
}

/* ---------- 4. P1 adjudicate：档位不再退化为「目标热度」 ---------- */
{
  const g = newGame(4);
  const a = g.players[1], b = g.players[2], t = g.players[3];
  const none = AI.adjudicate(g, a.id, t.id, 'med');
  ok('裸指控（无任何来源）→ C-', none.band === 'C-', none.band);
  a.accuseHistory = [{ night: 1, id: t.id }];                    // 场上已有他人指控 t
  const relay = AI.adjudicate(g, b.id, t.id, 'med');
  ok('仅转述（他人指控过）→ C（旧实现自动升 B-）', relay.band === 'C', relay.band);
  b.checkPool.set(t.id, { id: t.id, faction: 'alien', role: 'alien', night: 1 });
  const solid = AI.adjudicate(g, b.id, t.id, 'med');
  ok('自有查验 + 转述 → B-', solid.band === 'B-', solid.band);
  const soft = AI.adjudicate(g, b.id, t.id, 'soft');
  ok('轻度措辞 → 降一档 C', soft.band === 'C', soft.band);
  const hard = AI.adjudicate(g, a.id, t.id, 'hard');
  ok('强硬且无自有来源 → C（旧实现措辞强度被整体丢弃）', hard.band === 'C', hard.band);
}

/* ---------- 5. P1 承诺兑现：判据 = 承诺者本人的投票 ---------- */
{
  const g = newGame(5);
  const sp = g.players.find(p => p.faction === 'human');
  const tgt = g.players.find(p => p.id !== sp.id);
  const viewer = g.players.find(p => p.id !== sp.id && p.id !== tgt.id);
  sp.promises = [{ night: g.night, tier: 'mid', targets: [tgt.id], verifiable: true }];
  g.voteSources = { [sp.id]: tgt.id };
  AI.onVoteSettle(g, {});                                        // 目标零票，但承诺者确实投了它
  const credited = (viewer.cred.get(sp.id) || 0.5) > 0.5;
  const punished = evsOf(viewer, sp.id).some(e => String(e.src).indexOf('promiseMiss:') === 0);
  ok('兑现判据用「本人投票」→ 记入可信度 C', credited);
  ok('不因「目标零票」误判违约', !punished);
}

/* ---------- 6. P1 K2 护队指纹：不再把「指控已揭示的敌人」误判为互保 ---------- */
{
  const g = newGame(6);
  const E = g.players.find(p => p.faction === 'alien');
  const b = g.players.find(p => p.faction === 'human');
  const t = g.players.find(p => p.faction === 'human' && p.id !== b.id);
  E.out = true; E.outNight = 3; E.revealed = { faction: 'alien', role: 'alien' };
  b.accuseHistory = [{ night: 2, id: E.id }];                    // b 在揭示前揭发了 E
  t.accuseHistory = [{ night: 4, id: b.id }];                    // t 在揭示后反咬揭发者
  AI.reason(g);
  const viewer = g.players.find(p => p.id !== t.id && p.id !== E.id && p.id !== b.id);
  const hit = evsOf(viewer, t.id).some(e => String(e.src).indexOf('kingGuard:') === 0);
  ok('反咬揭发者 → 记录互保指纹', hit);

  const g2 = newGame(7);
  const E2 = g2.players.find(p => p.faction === 'alien');
  const t2 = g2.players.find(p => p.faction === 'human' && p.id !== E2.id);
  const b2 = g2.players.find(p => p.faction === 'human' && p.id !== E2.id && p.id !== t2.id);
  E2.out = true; E2.outNight = 3; E2.revealed = { faction: 'alien', role: 'alien' };
  b2.accuseHistory = [{ night: 2, id: E2.id }];
  t2.accuseHistory = [{ night: 4, id: E2.id }];                  // 指控已被揭示的敌人 = 最正常行为
  AI.reason(g2);
  const v2 = g2.players.find(p => p.id !== t2.id && p.id !== E2.id && p.id !== b2.id);
  const fp = evsOf(v2, t2.id).some(e => String(e.src).indexOf('kingGuard:') === 0);
  ok('指控已揭示敌人 → 不再误报（旧判据正好相反）', !fp);
}

/* ---------- 7. P1 R38 幂等 + 并罚源去夜次 ---------- */
{
  const g = newGame(8);
  const sp = g.players.find(p => p.faction === 'human');
  const viewer = g.players.find(p => p.id !== sp.id);
  AI.onClaim(g, sp, 'crew');
  g.night = g.night + 1;
  AI.onClaim(g, sp, 'crew');
  const hits = evsOf(viewer, sp.id).filter(e => e.src === `claim:${sp.id}:crew`);
  ok('同一（宣称者,职业）每局只入账一次（旧实现跨夜重复入账）', hits.length === 1, 'hits=' + hits.length);
}

/* ---------- 8. cron：sabTau 必须逐人 roll（旧实现恒 null） ---------- */
{
  const g = newGame(9);
  const vals = new Set(g.players.map(p => p.sabTau));
  ok('破坏个体阈值已 roll 且个体间有差异', vals.size > 1, 'distinct=' + vals.size);
}

/* ---------- 9. 通道执行器：幂等键必须带观察者（否则证据只落给座位序最前的一个 AI） ---------- */
{
  const g = newGame(10);
  const X = g.players.find(p => p.faction === 'alien').id;
  const obs = g.players.filter(p => p.faction === 'human').slice(0, 2);
  for (const o of obs) o.attackLog = [{ night: 3, target: X, res: 'blocked' }, { night: 4, target: X, res: 'blocked' }];
  g.night = 4;
  MoE.runChannelsAll(g);
  const hits = obs.filter(o => evsOf(o, X).some(e => String(e.src).indexOf('chan:N306:') === 0));
  ok('通道证据按观察者各自入账（旧幂等键每夜只放行一次 → 只有 1 人拿得到）',
    hits.length === 2, 'hits=' + hits.length);
  ok('N306 连续两夜攻击无效 → 目标按结茧护盾判为异形（私有源）', hits.length > 0);
}

/* ---------- 10. 接线必须挂得上：GATE_IMPL 的编号都要存在于 499 条总表 ---------- */
{
  const un = MoE.unmounted ? MoE.unmounted() : ['<无接口>'];
  ok('已接线通道编号全部存在于总表（旧实现 ZONE1~ZONE4/GATE45 永久挂不上却计入 wiredCount）',
    un.length === 0, un.join(','));
  const bad = [];
  for (const id of Object.keys(MoE.GATE_IMPL)) {
    const ch = (Channels.CHANNELS || []).find(c => c.id === id);
    if (ch && (Tiers.SCORE[ch.tier] == null || Tiers.SCORE[ch.tier] === 0)) bad.push(id + '/' + ch.tier);
  }
  ok('接线档位均为数值档（P/Z/F 是语义标记，接线只会写 0 分证据）', bad.length === 0, bad.join(','));
}

/* ---------- 11. 量纲：破坏量通道用真值（T=1.5 应命中 N05，而不是要求 T=0.1） ---------- */
{
  const g = newGame(11);
  g._prevNet10 = 0; g.net10 = 15;                      // 当夜净破坏量 1.5（×10 存储 → 15）
  g.night = 5;
  MoE.runChannelsAll(g);
  const o = g.players.find(p => p.faction === 'human');
  const u = (o.uEvents || []).map(e => e.src || '');
  ok('T=1.5 → N05 命中（旧实现拿 ×10 的 15 与 1.5 比，永远不命中）',
    u.some(s => s.indexOf('chan:N05:') === 0), u.filter(s => s.indexOf('chan:') === 0).join(','));
  ok('T=1.5 → N10（T>4.5）不命中', !u.some(s => s.indexOf('chan:N10:') === 0));
}

/* ---------- 12. N318 转职探测：公告职业 ≠ 池内查验职业 → 确认目标出身（信任类，负值） ---------- */
{
  const g = newGame(12);
  const det = g.players.find(p => p.role === 'detective');
  const X = g.players.find(p => p.faction === 'human' && p.id !== det.id);
  det.checkPool.set(X.id, { id: X.id, faction: 'human', role: 'crew', night: 2, published: true });
  X.role = 'armed';                                    // 查验后转职
  g.night = 6;
  MoE.runChannelsAll(g);
  const e = evsOf(det, X.id).find(x => String(x.src).indexOf('chan:N318:') === 0);
  ok('转职探测命中且为信任类证据（delta < 0 → 走 human 通道）', !!e && e.delta < 0, e ? 'delta=' + e.delta : 'none');
}

/* ---------- 13. D03 弃票声明对账：验票官用票源抓「宣称弃票却投了人」 ---------- */
{
  const g = newGame(13);
  const ins = g.players.find(p => p.role === 'inspector');
  const liar = g.players.find(p => p.id !== ins.id);
  const tgt = g.players.find(p => p.id !== ins.id && p.id !== liar.id);
  liar.declaredAbstain = [{ night: 7 }];
  g.voteHistory = [{ night: 7, round: '白天', src: { [liar.id]: tgt.id } }];
  g.night = 7;
  MoE.runChannelsAll(g);
  ok('弃票声明对账命中（仅验票官可见票源）',
    evsOf(ins, liar.id).some(e => String(e.src).indexOf('chan:D03:') === 0));
}

/* ---------- 14. E2 医生私有：标记消失而 ⑫=0 ⇒ 持有人非人类（N139 / N141） ---------- */
{
  const g = newGame(14);
  const doc = g.players.find(p => p.role === 'bio');
  const X = g.players.find(p => p.id !== doc.id);
  X.infection = null;
  doc.markEverSeen = new Map([[X.id, { night: 3, lastSeen: 4, goneNight: 5, noCure: true }]]);
  g.night = 5;
  MoE.runChannelsAll(g);
  ok('N139 标记隐形消失（⑫=0）→ 持有人非人类',
    evsOf(doc, X.id).some(e => String(e.src).indexOf('chan:N139:') === 0));

  const g141 = newGame(15);
  const doc2 = g141.players.find(p => p.role === 'bio');
  const Y = g141.players.find(p => p.id !== doc2.id);
  Y.infection = null;
  doc2.markEverSeen = new Map([[Y.id, { night: 2, lastSeen: 8, goneNight: 9, noCure: true }]]);
  g141.night = 9;                                     // 消失夜 - 首见夜 = 7 > 5（逾期）
  MoE.runChannelsAll(g141);
  ok('N141 逾期未死 + 消失 ⇒ 确证异形（A−）',
    evsOf(doc2, Y.id).some(e => String(e.src).indexOf('chan:N141:') === 0));
  ok('N141 与 N139 互斥（同一事实不重复入账）',
    !evsOf(doc2, Y.id).some(e => String(e.src).indexOf('chan:N139:') === 0));
}

/* ---------- 15. E2：标记跨过最晚应死夜仍在 ⇒ 假标记 ⇒ 异形（N149） ---------- */
{
  const g = newGame(16);
  const doc = g.players.find(p => p.role === 'rescue');
  const X = g.players.find(p => p.id !== doc.id);
  X.infection = { real: false, appliedNight: 2, deathNight: null };   // 门只用时间线，不读 real
  doc.markEverSeen = new Map([[X.id, { night: 2, lastSeen: 8 }]]);
  g.night = 8;                                        // 8 - 2 = 6 > 5
  MoE.runChannelsAll(g);
  ok('N149 逾期未死 ⇒ 假标记 ⇒ 持有人必为异形',
    evsOf(doc, X.id).some(e => String(e.src).indexOf('chan:N149:') === 0));
}

/* ---------- 16. E3：真验票官已出局后仍有人自称验票官 ⇒ 假冒（N188） ---------- */
{
  const g = newGame(17);
  const ins = g.players.find(p => p.role === 'inspector');
  ins.out = true; ins.outNight = 4; ins.revealed = { faction: 'human', role: 'inspector' };
  const fake = g.players.find(p => p.faction === 'alien');
  fake.claimedRole = 'inspector';
  const obs = g.players.find(p => p.faction === 'human' && p.id !== fake.id);
  g.night = 6;
  MoE.runChannelsAll(g);
  ok('N188 验票官死后冒称验票官 → 假冒（A−）',
    evsOf(obs, fake.id).some(e => String(e.src).indexOf('chan:N188:') === 0));
}

/* ---------- 17. v27 / A1：影子层字段名（旧守卫读 claim.target，而 IR.mk 产出 targets[]，
   导致 1536/1536 次调用全部返回 0——影子层在结构上是死代码） ---------- */
{
  const g = newGame(18);
  const self = g.players.find(p => p.faction === 'human');
  const tgt = g.players.find(p => p.id !== self.id);
  /* 与 decide.js 的 mkProbe 同形态：tier 必须是档位字符串（'soft' 是措辞强度，不是档位） */
  const claim = Object.assign(IR.mk('accuse', [tgt.id], { tier: 'soft' }, { night: g.night }), { tier: Tiers.RULE.accuse });
  const risk = MoE.shadowRisk(g, self.id, claim);
  ok('IR.mk 形态的 Claim（只有 targets[]）也能算出影子风险（旧实现恒 0）',
    typeof risk === 'number' && Math.abs(risk) > 1e-9, 'risk=' + risk);
  const none = IR.mk('accuse', [], {}, { night: g.night });
  ok('无目标 Claim 仍安全返回 0（守卫未被破坏）', MoE.shadowRisk(g, self.id, none) === 0);
  const dist = MoE.shadowSummary ? MoE.shadowSummary() : null;
  ok('影子返回值分布可读（C1 仪器三件套之二）',
    !!dist && dist.n >= 1 && dist.nonzero >= 1, dist ? JSON.stringify(dist) : 'no summary');
}

/* ---------- 18. v27 / C3：通道「求值-命中」计数（chan_fired 只知道谁响过，
   不知道注册了却一次没响的是条件过严还是根本没被求值） ---------- */
{
  const g = newGame(19);
  g._prevNet10 = 0; g.net10 = 0; g.night = 3;            // 当夜零破坏 → N04 必命中
  MoE.runChannelsAll(g);
  ok('执行器记录每通道求值次数 g._chanEval（v27 新增）',
    !!g._chanEval && (g._chanEval.N04 || 0) >= 1, JSON.stringify(g._chanEval || {}));
  ok('求值与命中成对可读（N04 命中）', (g._chanFires.N04 || 0) >= 1);
}

/* ---------- 19. v27 / A6-①③：空口宣称不再零代价 + doc→bio 口径统一 ---------- */
{
  const g = newGame(20);
  const liar = g.players.find(p => p.faction === 'alien');
  const viewer = g.players.find(p => p.faction === 'human');
  AI.onClaim(g, liar, 'crew');
  const ev = evsOf(viewer, liar.id).find(e => String(e.src).indexOf('claim:') === 0);
  /* v31 裁定「调档位」：删除 crew 专属偏置后，强度只由档位 D+ 决定 → −round((7−5)×0.5) = −1
     （v27 为 −8，再经 D 档可信度缩放 0.7 → 有效 −5.6；现在有效 ≈ −0.7）。
     语义：空口「我是普通船员」几乎不产生减疑——最廉价、最不可验证的宣称。
     v32 批 5′：幅度 = 档位 × 角色注意力（Tiers.ATTEND.verify，观察者为核查主业角色 → 权重 >1）。 */
  ok('crew 自证幅度由档位 × 角色注意力决定（v31 调档位：−8 → −1；v32 批 5′ ×ATTEND）',
    !!ev && ev.delta === -1 * Tiers.attend(viewer.roleExpert != null ? viewer.roleExpert : viewer.role, 'verify'),
    ev ? 'delta=' + ev.delta : 'none');
  ok('crew 自证档位取自 Tiers.RULE.R38crew', !!ev && ev.tier === Tiers.RULE.R38crew,
    ev ? 'tier=' + ev.tier : 'none');

  const g2 = newGame(21);
  const doc = g2.players.find(p => p.faction === 'human');
  const v2 = g2.players.find(p => p.id !== doc.id);
  AI.onClaim(g2, doc, 'doc');                                  // 语言层旧别名
  ok('宣称「医生」（旧别名 doc）现在产证据（旧 selfTiers 无 doc 键 → 恒不产）',
    evsOf(v2, doc.id).some(e => String(e.src) === `claim:${doc.id}:doc`));
}

/* ---------- 20. v27 / A6-②：crew 空口宣称可被对证推翻（旧实现整条豁免 crew） ---------- */
{
  const g = newGame(22);
  const liar = g.players.find(p => p.faction === 'alien');
  const viewer = g.players.find(p => p.faction === 'human');
  liar.claimedRole = 'crew';
  viewer.known.set(liar.id, { faction: 'alien', role: 'alien' });   // 观察者私有硬锁
  AI.reason(g);
  ok('谎称船员 + 观察者私有硬锁为异形 → 对证不符（cross A−）',
    evsOf(viewer, liar.id).some(e => String(e.src).indexOf('cross:') === 0));
}

/* ---------- 21. v27 / A5：K1 沉默指纹（提档 / 收紧 / 不误伤被沉默者） ---------- */
{
  const g = newGame(23);
  const quiet = g.players.find(p => p.faction === 'xeno');
  const viewer = g.players.find(p => p.faction === 'human');
  for (const p of g.players) { p.accuseHistory = []; p.askHistory = []; p.claimedRole = null; p.promises = []; }
  viewer.accuseHistory = [{ night: 1, id: g.players[0].id }];
  g.night = 6;
  AI.reason(g);
  const hit = evsOf(viewer, quiet.id).find(e => String(e.src).indexOf('kingSilent:') === 0);
  ok("K1 档位取自 Tiers.RULE.kingSilent（旧实现硬编码 SCORE['D']=5）",
    !!hit && hit.tier === Tiers.RULE.kingSilent, hit ? 'tier=' + hit.tier : 'none');

  const g2 = newGame(24);
  const silenced = g2.players.find(p => p.faction === 'xeno');
  const v2 = g2.players.find(p => p.faction === 'human');
  for (const p of g2.players) { p.accuseHistory = []; p.askHistory = []; p.claimedRole = null; p.promises = []; }
  v2.accuseHistory = [{ night: 1, id: g2.players[0].id }];
  silenced.silenceNight = 10;                                  // 本夜正被蛰伏沉默压制
  g2.night = 6;
  AI.reason(g2);
  ok('被蛰伏沉默压制者不算「自愿沉默」（判据不误伤受害者）',
    !evsOf(v2, silenced.id).some(e => String(e.src).indexOf('kingSilent:') === 0));
}

/* ---------- 22. v28 / B2：怀疑度与危险度的调用值统一到档位表 ---------- */
{
  const need = ['PRIOR', 'PRIOR_E', 'DG_W', 'CAP', 'UNIVERSAL', 'SUSP_RANGE', 'CONSENSUS', 'FLOOR', 'SELF_CLAIM'];
  const missing = need.filter(k => !Tiers[k]);
  ok('怀疑度/危险度常量全部登记在 Tiers（旧实现散落在 belief / perceive / decide 调用点）',
    missing.length === 0, missing.join(','));
  ok('先验与置位值可单点读取（28.6 / 21.4 / 50 · 95 / 85）',
    Tiers.PRIOR.human === 28.6 && Tiers.PRIOR.xeno === 21.4 && Tiers.PRIOR.alienVsOther === 50 &&
    Tiers.FLOOR.R30fakeRole === 95 && Tiers.FLOOR.R7fakeMark === 85);
  const literals = ['settleHit', 'settleMiss', 'grudge', 'grudgeSoft', 'rescueBack', 'privSame', 'expClaim', 'mateHeat', 'checkLie'];
  ok('原先散落的字面档位串已入 RULE 表（B2 统一）',
    literals.every(k => !!Tiers.RULE[k]), literals.filter(k => !Tiers.RULE[k]).join(','));
}

/* ---------- 23. v28 / B3：排除类宣称的目标侧入账（方向 a：轻微指向非人类） ---------- */
{
  const g = newGame(25);
  const sp = g.players.find(p => p.faction === 'human');
  const tgt = g.players.find(p => p.id !== sp.id);
  const viewer = g.players.find(p => p.id !== sp.id && p.id !== tgt.id);
  Bridge.say(g, sp.id, '我查过 3 号，他不是神探，也不是验票官。', {
    kind: '讨论',
    claims: [IR.mk('exclusion', [tgt.id], { excludes: ['detective', 'inspector'] }, { night: g.night, speaker: sp.id })],
  });
  const ev = evsOf(viewer, tgt.id).find(e => String(e.src).indexOf('excludesay:') === 0);
  /* v32 批 5′：幅度 = 档位 × 角色注意力（Tiers.ATTEND.verify） */
  ok('排除类宣称 → 目标侧弱证据（v28 B3 落地；v32 批 5′ ×ATTEND）',
    !!ev && ev.delta === Tiers.SCORE[Tiers.RULE.exclusion] * Tiers.attend(viewer.roleExpert != null ? viewer.roleExpert : viewer.role, 'verify'),
    ev ? 'delta=' + ev.delta : 'none');

  const g2 = newGame(26);
  const sp2 = g2.players.find(p => p.faction === 'human');
  const tgt2 = g2.players.find(p => p.id !== sp2.id);
  const v2 = g2.players.find(p => p.id !== sp2.id && p.id !== tgt2.id);
  Bridge.say(g2, sp2.id, '我查过 3 号，他不是异形。', {       // 排除项非人类职业 → 方向不定
    kind: '讨论',
    claims: [IR.mk('exclusion', [tgt2.id], { excludes: ['alien'] }, { night: g2.night, speaker: sp2.id })],
  });
  ok('排除项非「人类专属职业」时不入账（方向不定，避免灌噪声）',
    !evsOf(v2, tgt2.id).some(e => String(e.src).indexOf('excludesay:') === 0));
}

/* ---------- 24. v28 / B3 量级：D-- 是最弱档且排位在 D- 之下 ---------- */
{
  ok("新增专用弱档 D--（值 1，用于「方向明确但贝叶斯极弱」的排除类信号）",
    Tiers.SCORE['D--'] === 1 && Tiers.SCORE['D--'] < Tiers.SCORE['D-'] && Tiers.SCORE['D--'] > Tiers.SCORE['F'],
    `D--=${Tiers.SCORE['D--']} D-=${Tiers.SCORE['D-']} F=${Tiers.SCORE['F']}`);
  ok('D-- 已进入仲裁档位序（RANK），且低于 D-',
    ctx.MoERegistry.RANK['D--'] === 1 && ctx.MoERegistry.RANK['D--'] < ctx.MoERegistry.RANK['D-']);
}

/* ---------- 25. v28 / B1：破坏效用接入「AI 已知的维修能力」（推理库驱动，不读真相） ---------- */
{
  const g = newGame(27);
  const alien = g.players.find(p => p.faction === 'alien');
  const humans = g.players.filter(p => p.faction === 'human');
  const h1 = humans[0], h2 = humans[1], h3 = humans[2];
  ok('未知局面下阻力项为 0（只读公开/台账信息，不读 x.role 真相）',
    AI.knownRepairers(g, alien) === 0, String(AI.knownRepairers(g, alien)));
  h1.repairExposed = true;                                            // ④ 维修暴露（公开黑板）
  ok('④ 维修暴露者计入（权重 1）', AI.knownRepairers(g, alien) === 1);
  alien.known.set(h2.id, { role: 'engineer', faction: 'human' });      // 台账已知（⑥⑩/查验锁定）
  ok('known 台账里的工程师计入（权重 1）', AI.knownRepairers(g, alien) === 2);
  h3.claimedRole = 'crew';                                            // 空口宣称：可信度不足不计
  const before = AI.knownRepairers(g, alien);
  alien.cred.set(h3.id, 0.9);                                         // 可信度 ≥ 0.6 → 计入折扣权重
  ok('职业宣称按可信度 C 折扣（C<0.6 不计，C≥0.6 计）',
    AI.knownRepairers(g, alien) > before, `before=${before} after=${AI.knownRepairers(g, alien)}`);
}

/* ---------- 26. v28c / B6：破坏效用系数入表 + 决策期可读的协同信号 + 仪器落盘 ---------- */
{
  const need = ['satK', 'satJitter', 'gainW', 'resistPer', 'matesW', 'riskThetaDiv', 'noise', 'quotaTail', 'quotaSlack'];
  ok('破坏效用系数全部登记在 Tiers.SAB（B6 标定对象唯一真源）',
    need.every(k => Tiers.SAB[k] != null), need.filter(k => Tiers.SAB[k] == null).join(','));

  const g = newGame(28);
  const alien = g.players.find(p => p.faction === 'alien');
  for (const x of g.players) x.branch = null;      // 决策阶段：p.branch 尚未写入（steps.js 0.7 的 run 才写）
  const d = AI.decide(g, { pid: alien.id, kind: 'branch' });
  ok('破坏决策在「全队 branch 均未写入」的决策阶段仍能求解（旧实现的协同项与队内节流恒 0）',
    !!d && (d.branch === 'act' || d.branch === 'destroy'), JSON.stringify(d));
  ok('破坏决策样本落盘（B6 仪器：局势输入 + 输出）',
    !!g._sabEval && g._sabEval.length >= 1 && g._sabEval[0].repairKnown != null && g._sabEval[0].gapT != null,
    JSON.stringify((g._sabEval && g._sabEval[0]) || null));
}

/* ---------- 27. v31 批 1：B2′ P 档显式映射 + B4 视角依赖档位解析器 ---------- */
{
  ok('B2′：SCORE[\'P\'] 有显式强度映射（旧实现不存在 → 41 条私有源通道零落点）',
    Tiers.SCORE['P'] === 10, 'P=' + Tiers.SCORE['P']);
  ok('B2′：P 不污染「按数值反查档位」的兜底（TIER_BY_VAL[10] 仍是 C）',
    ctx.AIBelief.TIER_BY_VAL[10] === 'C', 'TIER_BY_VAL[10]=' + ctx.AIBelief.TIER_BY_VAL[10]);

  const spec = { def: 'D', byRole: { inspector: 'A-' } };
  ok('B4：视角依赖档按接收者身份解析（N216 对验票官 A− / 对全场 D）',
    Tiers.tierFor(spec, { role: 'inspector' }) === 'A-' &&
    Tiers.tierFor(spec, { role: 'crew' }) === 'D' &&
    Tiers.tierFor(spec, {}) === 'D');
  ok('B4：字符串档位与旧行为完全一致（不动已有 tier 值）',
    Tiers.tierFor('B+', { role: 'inspector' }) === 'B+' && Tiers.tierFor(null, {}) === null);
  ok('B4：幅度仍唯一来自 SCORE 表（magFor 解析后可查表）',
    Tiers.magFor(spec, { role: 'inspector' }) === Tiers.SCORE['A-'] &&
    Tiers.magFor(spec, { role: 'crew' }) === Tiers.SCORE['D']);
}

/* ---------- 28. v31 批 2（A3）：承诺词表统一 + strong 生产者 + A01/A02 命中 + 预告类结算 ---------- */
{
  const PV = Tiers.PROMISE;
  ok('A3：承诺词表已收口到 Tiers.PROMISE（档位 / 兑现奖励 / 违约惩罚 / 档位名 / 结算方式）',
    !!PV && PV.tiers.join(',') === 'weak,mid,strong' && PV.cred.strong === 0.30 && PV.miss.strong === 35 && PV.name.strong === 'A-',
    PV ? JSON.stringify(PV) : 'none');

  /* 语言库不变式：神探预告的措辞必须能被自家解析器读回同一个意图（strong + 目标） */
  const sig = ctx.NLP.parse('我今晚查 3 号，明晚公告结果。', { speaker: 1 });
  const pr = (sig.promise || [])[0];
  ok('A3：预告措辞可被 NLP 读回 strong 承诺且带目标（渲染与解析互逆）',
    !!pr && pr.tier === 'strong' && (pr.targets || []).indexOf(3) >= 0,
    JSON.stringify(sig.promise || null));

  /* A01 命中：真神探做出「带目标的 strong 承诺」→ 全体观察者拿到预告证据 */
  const g = newGame(31);
  const det = g.players.find(p => p.role === 'detective');
  const X = g.players.find(p => p.faction === 'human' && p.id !== det.id);
  const viewer = g.players.find(p => p.id !== det.id && p.id !== X.id);
  det.promises = [{ night: g.night, tier: 'strong', targets: [X.id], kind: 'announce', verifiable: true }];
  g.night = Math.max(3, g.night);
  MoE.runChannelsAll(g);
  ok('A3：A01（神探指名预告）命中——旧实现全仓无 strong 生产者，此条永久 0 命中',
    evsOf(viewer, det.id).some(e => String(e.src).indexOf('chan:A01:') === 0));

  /* 预告类承诺的结算：按「是否真的发布了该目标的公告」判定，而不是按投票 */
  const g2 = newGame(32);
  const det2 = g2.players.find(p => p.role === 'detective');
  const Y = g2.players.find(p => p.id !== det2.id);
  const v2 = g2.players.find(p => p.id !== det2.id && p.id !== Y.id);
  det2.promises = [{ night: 1, tier: 'strong', targets: [Y.id], kind: 'announce', verifiable: true }];
  det2.checkPool.set(Y.id, { id: Y.id, faction: 'human', role: 'crew', night: 1, published: false });
  g2.night = 3;                                   // 预告在承诺夜 +2 结算（留出查验 + 公告两个夜晚）
  v2.cred = new Map([[det2.id, 0.5]]);
  AI.settlePromises(g2, {});
  ok('A3：预告未发布 → 按违约记 S 类证据（不再用「承诺者投票」误判）',
    evsOf(v2, det2.id).some(e => String(e.src).indexOf('promiseMiss:') === 0));

  const g3 = newGame(33);
  const det3 = g3.players.find(p => p.role === 'detective');
  const Z = g3.players.find(p => p.id !== det3.id);
  const v3 = g3.players.find(p => p.id !== det3.id && p.id !== Z.id);
  det3.promises = [{ night: 1, tier: 'strong', targets: [Z.id], kind: 'announce', verifiable: true }];
  det3.checkPool.set(Z.id, { id: Z.id, faction: 'human', role: 'crew', night: 1, published: true, pubNight: 2 });
  g3.night = 3;
  v3.cred = new Map([[det3.id, 0.5]]);
  AI.settlePromises(g3, {});
  ok('A3：预告已发布（pubNight 在承诺夜之后）→ 按兑现加可信度 C（strong +0.30）',
    Math.abs((v3.cred.get(det3.id) || 0) - 0.8) < 1e-9, 'cred=' + v3.cred.get(det3.id));
}

/* ---------- 29. v31 批 3：战术库 37 条接线（此前零消费者） ---------- */
{
  const TAC = ctx.Tactics;
  ok('战术库已结构化：ALIEN_OPTS / XENO_OPTS 具备 id / risk / when|act（旧实现是纯字符串，全仓无引用点）',
    TAC.ALIEN_OPTS.length >= 20 && TAC.XENO_OPTS.length >= 6 &&
    TAC.ALIEN_OPTS.every(o => 'id' in o && 'risk' in o && ('when' in o || 'act' in o || 'say' in o)) &&
    TAC.ALIEN_OPTS.filter(o => o.act).length >= 2 && TAC.ALIEN_OPTS.filter(o => o.when).length >= 6,
    `ALIEN_OPTS=${TAC.ALIEN_OPTS.length} XENO_OPTS=${TAC.XENO_OPTS.length} act=${TAC.ALIEN_OPTS.filter(o => o.act).length} when=${TAC.ALIEN_OPTS.filter(o => o.when).length}`);

  /* 冒领船员（N357）：公告沉默期 + 未宣称 → 可被选中并产 claimRole: crew */
  const g = newGame(40);
  const al = g.players.find(p => p.faction === 'alien');
  al.claimedRole = null;
  let pickN357 = null;
  for (let i = 0; i < 400 && !pickN357; i++) {
    const t = TAC.pickTactic(g, al, g.rng, {});
    if (t && t.opt.id === 'N357') pickN357 = t;
  }
  ok('N357 冒领船员可被选中且带 claimRole(crew) 动作（旧实现零消费者）',
    !!pickN357 && pickN357.claim && pickN357.claim.kind === 'claimRole' && pickN357.claim.payload.role === 'crew',
    JSON.stringify(pickN357 && pickN357.claim || null));

  /* Z 档兜底：公告密集期冒领必须被 filterClaims 拦掉（N400） */
  {
    const blocked = TAC.filterClaims([IR.mk('claimRole', [], { role: 'crew' }, {})], al,
      { night: g.night, detectiveAnnounceRecent: 2 });
    ok('N400：神探公告密集期，冒领船员在生成前被拦截', blocked.length === 0);
  }
  /* 分工（N372）：队内三只存活时可产出分工文案 */
  ok('N372 三只分工：squadRoles 只读己方信息并给出分工',
    !!TAC.squadRoles(g, al) && typeof TAC.squadRoles(g, al).destroy === 'object');
}

/* ---------- 30. v31 裁定：口头汇报 ≠ 官方公告（全场硬锁只留给 ③ 官方公告） ---------- */
{
  const g = newGame(41);
  const det = g.players.find(p => p.role === 'detective');
  const tgt = g.players.find(p => p.faction === 'alien');
  const viewer = g.players.find(p => p.id !== det.id && p.id !== tgt.id && p.faction === 'human');
  viewer.known.delete(tgt.id);
  Bridge.say(g, det.id, '我查过 3 号，他是异形。', {
    kind: '讨论',
    claims: [IR.mk('lock', [tgt.id], { faction: 'alien' }, { night: g.night, speaker: det.id })],
  });
  ok('神探【口头】汇报不再写全场硬锁（裁定：不等于 ③ 官方公告）',
    !viewer.known.get(tgt.id), JSON.stringify(viewer.known.get(tgt.id) || null));
  ok('口头汇报仍按【可伪造的宣称】入账（目标侧证据 locksay）',
    evsOf(viewer, tgt.id).some(e => String(e.src).indexOf('locksay:') === 0));
}

/* ---------- 31. v31 裁定：AI 加「否认」话术（A2：denyLie 恒 0 的根因是生成端 0 处） ---------- */
{
  const g = newGame(42);
  const p2 = g.players.find(p => p.faction === 'alien');
  const accuser = g.players.find(p => p.id !== p2.id);
  accuser.accuseHistory = [{ night: 1, id: p2.id }];      // 我被指控 → 触发否认分支
  g.night = 3;
  let got = null;
  for (let i = 0; i < 60 && !got; i++) {
    try { AI.speak(g, p2); } catch (e) { /* 忽略状态不完整 */ }
    got = (p2.outClaims || []).find(c => c.kind === 'deny') || null;
  }
  ok('AI 在被指控时产出【证伪型宣称】（旧实现生成端 IR.mk(\'deny\') = 0 处 → 全 AI 局恒 0）',
    !!got && !!got.payload.about, JSON.stringify(got || null));
}

/* ---------- 32. v31 批 3.5（人类侧保护专项）：N401~N407 数据与接线 ---------- */
{
  ok('总表条数 499 → 506（新增第二十二章 7 条）', Channels.count === 506, 'count=' + Channels.count);
  const ids = ['N401', 'N402', 'N403', 'N404', 'N405', 'N406', 'N407'];
  const missing = ids.filter(id => !Channels.byId.has(id));
  ok('N401~N407 已录入总表（第二十二章）', missing.length === 0, missing.join(','));
  /* N402 按 N182 的处置口径以【公共前提】交付（不指向个体、方向中性），不单独入账 */
  const noImpl = ids.filter(id => id !== 'N402' && !MoE.GATE_IMPL[id]);
  ok('N401/N403~N407 已接线（N402 作为公共前提而非证据通道）', noImpl.length === 0, noImpl.join(','));
  /* v33：接线进度 40 → 49（E10 汇聚层首批 9 条：C07/C09/C14/C22/C42/C43/C45/C55/C56） */
  ok('接线进度 40 → 49 mounted', MoE.wiredCount() === 49, 'wired=' + MoE.wiredCount());
  ok('N402 公共前提可用（第 4 夜起巡逻必为 0；③ 报过「巡逻指定」同样成立）',
    MoE.patrolSpentPublic({ night: 4, log: [] }) === true &&
    MoE.patrolSpentPublic({ night: 2, log: [{ batch: '③', text: '今夜查验出手 1 人次；巡逻指定 2 名' }] }) === true &&
    MoE.patrolSpentPublic({ night: 2, log: [{ batch: '③', text: '今夜查验出手 1 人次' }] }) === false);
}

/* ---------- 33. N401：④ 暴露 ⇒ 工程师系 + 人类；④ 公告补标原职业（定案 1 缺口） ---------- */
{
  const g = newGame(101);
  const eng = g.players.find(p => p.role === 'engineer');
  eng.repairExposed = true;
  g.night = 3;
  MoE.runChannelsAll(g);
  const viewer = g.players.find(p => p.faction === 'human' && p.id !== eng.id);
  const ev = evsOf(viewer, eng.id).find(e => String(e.src).indexOf('chan:N401:') === 0);
  ok('N401 ④ 暴露者 → 全场目标侧信任证据（neg ⇒ 写 human 通道）', !!ev && ev.delta < 0, JSON.stringify(ev || null));
  ok('N401 档位取 C+（impl.tier 声明，幅度仍唯一来自 SCORE 表）', !!ev && ev.tier === 'C+', ev && ev.tier);
}
{
  const g = newGame(112);
  const eng = g.players.find(p => p.role === 'engineer');
  eng.repairTotal = 3.5;                       // +1.0 后越过工程师阈值 4.0 ⇒ 触发 ④ 暴露
  eng.transferred = true;                      // 转职已发生（原职业：普通船员）
  g.night = 3; g.step = '4a'; g.decisions = {};
  g.decisions[eng.id] = { do: true, extra: false };
  Engine.STEPS['4a'].run(g);
  const ann = (g.log || []).filter(e => e.batch === '④').map(e => e.text).join(' ');
  ok('④ 暴露公告补标原职业（定案 1 的落地缺口，N401 的连带推论基础）',
    ann.indexOf('原职业：普通船员') >= 0, ann.slice(0, 120));
  ok('普通船员协助维修不产生 ④ 暴露（口径一：暴露主体收窄为工程师系）',
    (g.log || []).filter(e => e.batch === '④').every(e => String(e.text).indexOf('维修者暴露') < 0 || eng.repairExposed));
}

/* ---------- 34. N403/N404/N405：攻击方私有的抵挡层收敛（不进普适层） ---------- */
{
  const g = newGame(102);
  const atk = g.players.find(p => p.faction === 'xeno');
  const tgt = g.players.find(p => p.faction === 'human');
  g.night = 4;
  atk.attackLog = [{ night: 4, target: tgt.id, type: 'xeno', res: 'blocked' }];
  MoE.runChannelsAll(g);
  const ev = evsOf(atk, tgt.id).find(e => String(e.src).indexOf('chan:N403:') === 0);
  ok('N403 第 4 夜起单次被挡 → 层收敛（排除巡逻层）证据，C+ 档', !!ev && ev.tier === 'C+', JSON.stringify(ev || null));
  ok('N403 不进普适层（第四章裁定：不写 universalOf）',
    !(atk.uEvents || []).some(e => String(e.src).indexOf('chan:N403:') === 0));
  /* 巡逻窗口未关闭时不成立：「连续两夜被挡」可由 保镖(n)+巡逻(n+1) 解释 */
  const g0 = newGame(113);
  const atk0 = g0.players.find(p => p.faction === 'xeno');
  const t0 = g0.players.find(p => p.faction === 'human');
  g0.night = 2;
  atk0.attackLog = [{ night: 2, target: t0.id, res: 'blocked' }];
  MoE.runChannelsAll(g0);
  ok('N403 在巡逻窗口未关闭（第 ≤3 夜且无公开读数）时不入账',
    !evsOf(atk0, t0.id).some(e => String(e.src).indexOf('chan:N403:') === 0));
}
{
  const g = newGame(104);
  const atk = g.players.find(p => p.faction === 'xeno');
  const tgt = g.players.find(p => p.faction === 'human');
  g.night = 5;
  atk.attackLog = [{ night: 4, target: tgt.id, res: 'blocked' }, { night: 5, target: tgt.id, res: 'blocked' }];
  MoE.runChannelsAll(g);
  const ev = evsOf(atk, tgt.id).find(e => String(e.src).indexOf('chan:N404:') === 0);
  ok('N404 连续两夜被挡 → 非人类（口径纠正：只到「非人类」，不写「异形」）', !!ev && ev.tier === 'C+');
  ok('N403/N404 触发面互斥（同一 pair 不重复入账）',
    !evsOf(atk, tgt.id).some(e => String(e.src).indexOf('chan:N403:') === 0));
  ok('N404 与 N306 同判据（N306 是七矿区原条目，两条都命中即为「幅度受限」的有意设计）',
    evsOf(atk, tgt.id).some(e => String(e.src).indexOf('chan:N306:') === 0));
}
{
  const g = newGame(105);
  const atk = g.players.find(p => p.faction === 'xeno');
  const tgt = g.players.find(p => p.faction === 'human');
  g.night = 8;
  atk.attackLog = [{ night: 4, target: tgt.id, res: 'blocked' }, { night: 6, target: tgt.id, res: 'blocked' },
                   { night: 8, target: tgt.id, res: 'blocked' }];
  MoE.runChannelsAll(g);
  const ev = evsOf(atk, tgt.id).find(e => String(e.src).indexOf('chan:N405:') === 0);
  ok('N405 三个非连续被挡夜 → 存续型抵挡层指纹（C 档，跨夜累积）', !!ev && ev.tier === 'C');
}
{
  const g = newGame(106);
  const atk = g.players.find(p => p.faction === 'alien');
  const mate = g.players.find(p => p.faction === 'alien' && p.id !== atk.id);
  g.night = 5;
  atk.attackLog = [{ night: 4, target: mate.id, res: 'blocked' }, { night: 5, target: mate.id, res: 'blocked' }];
  MoE.runChannelsAll(g);
  ok('N403~N405 对异形队友不入账（硬锁短路；文档 4.2 要求保持在分布上平坦）',
    !evsOf(atk, mate.id).some(e => /chan:N40[345]:/.test(String(e.src))));
}
{
  const g = newGame(114);
  const sher = g.players.find(p => p.role === 'sheriff');
  const tgt = g.players.find(p => p.faction === 'alien');
  g.night = 4;
  sher.attackLog = [{ night: 4, target: tgt.id, type: 'gun', res: 'blocked' }];
  MoE.runChannelsAll(g);
  ok('N403~N405 对【人类攻击方】不入账（警官被挡时「有人保他」指向人类，方向相反）',
    !evsOf(sher, tgt.id).some(e => /chan:N40[345]:/.test(String(e.src))));
}

/* ---------- 35. N406：濒死名单 × ⑥ 对账（普适层，证群体不证个体） ---------- */
{
  const g = newGame(107);
  const doc = g.players.find(p => p.role === 'rescue');
  const a = g.players.find(p => p.faction === 'human' && p.id !== doc.id);
  const b = g.players.find(p => p.faction === 'human' && p.id !== doc.id && p.id !== a.id);
  g.night = 5;
  doc.dyingSeen = { night: 5, ids: [a.id, b.id] };      // 步骤 8 观察快照（P13）
  a.out = true; a.outNight = 5;                          // ⑥ 公告：a 死了
  MoE.runChannelsAll(g);
  const ev = (doc.uEvents || []).find(e => String(e.src).indexOf('chan:N406:') === 0);
  ok('N406 濒死名单 − ⑥ 死亡名单 = 被救回者 → 普适层群体信号（B+）',
    !!ev && ev.tier === 'B+' && ev.delta > 0, JSON.stringify(ev || null));
  ok('N406 不指向个体（不写 tEvents —— 被救回者不等于好人：自伤诱饵）',
    !evsOf(doc, a.id).concat(evsOf(doc, b.id)).some(e => String(e.src).indexOf('chan:N406:') === 0));
  /* 名单与死亡名单完全一致（无人被救回）⇒ 无可对账 */
  const g2 = newGame(115);
  const doc2 = g2.players.find(p => p.role === 'rescue');
  const c = g2.players.find(p => p.faction === 'human' && p.id !== doc2.id);
  g2.night = 5;
  doc2.dyingSeen = { night: 5, ids: [c.id] };
  c.out = true; c.outNight = 5;
  MoE.runChannelsAll(g2);
  ok('N406 无人被救回（名单 ≡ 死亡名单）时不入账',
    !(doc2.uEvents || []).some(e => String(e.src).indexOf('chan:N406:') === 0));
}

/* ---------- 36. N407：抗体生效 × 目标存续（生化医师私有，信任方向） ---------- */
{
  const g = newGame(108);
  const bio = g.players.find(p => p.role === 'bio');
  const x = g.players.find(p => p.faction === 'human' && p.id !== bio.id);
  g.night = 4; g.cureHands = 0;
  bio.antibodyFired = [{ night: 4, target: x.id }];        // P15：抗体生效（引擎结构化落盘）
  bio.markEverSeen = new Map();
  MoE.runChannelsAll(g);
  const ev = evsOf(bio, x.id).find(e => String(e.src).indexOf('chan:N407:') === 0);
  ok('N407 抗体生效 × 无标记落地 × ⑫=0 → 目标侧信任证据（B 档）',
    !!ev && ev.tier === 'B' && ev.delta < 0, JSON.stringify(ev || null));
  const g2 = newGame(109);
  const bio2 = g2.players.find(p => p.role === 'bio');
  const x2 = g2.players.find(p => p.faction === 'human' && p.id !== bio2.id);
  g2.night = 4; g2.cureHands = 1;                           // ⑫ 有清除 ⇒ 正常链路，不入账
  bio2.antibodyFired = [{ night: 4, target: x2.id }];
  bio2.markEverSeen = new Map();
  MoE.runChannelsAll(g2);
  ok('N407 三方对账：⑫ 计数增加时不入账（不与正常清除链路重复计分）',
    !evsOf(bio2, x2.id).some(e => String(e.src).indexOf('chan:N407:') === 0));
  const g3 = newGame(116);
  const bio3 = g3.players.find(p => p.role === 'bio');
  const x3 = g3.players.find(p => p.faction === 'human' && p.id !== bio3.id);
  g3.night = 4; g3.cureHands = 0;
  bio3.antibodyFired = [{ night: 4, target: x3.id }];
  bio3.markEverSeen = new Map([[x3.id, { night: 4, lastSeen: 4 }]]);   // 标记落地过
  MoE.runChannelsAll(g3);
  ok('N407 三方对账：标记曾落地时不入账（那是 N139/N149 的判定域）',
    !evsOf(bio3, x3.id).some(e => String(e.src).indexOf('chan:N407:') === 0));
}

/* ---------- 37. N414~N417：人类侧保护优先级（行为选项池，不进估值层） ---------- */
{
  const ids = Tactics.PROTECT_OPTS.map(o => o.id);
  ok('N414~N416 已登记为行为选项池（与浑水摸鱼同制：改行动效用，不进 channels.data）',
    ids.join(',') === 'N414,N415,N416' && !Channels.byId.has('N414') && !Channels.byId.has('N417'),
    ids.join(','));
  ok('N417 下界硬约束的数值真源在档位表（Tiers.PROTECT.floor = 5%）',
    !!Tiers.PROTECT && Tiers.PROTECT.floor === 0.05, JSON.stringify(Tiers.PROTECT));
  const g = newGame(110);
  const me = g.players.find(p => p.faction === 'human');
  const eng = g.players.find(p => p.role === 'engineer' && p.id !== me.id);
  const crew = g.players.find(p => p.role === 'crew' && p.id !== me.id);
  eng.repairExposed = true;
  ok('保护优先级 3：④ 暴露的关键职位（0 级之上）；普通船员为 0 级',
    Tactics.protectPriority(g, me, eng, 'guard') === 3 && Tactics.protectPriority(g, me, crew, 'guard') === 0);
  /* N417：硬源确证（conf=1）时也要保留 ≥5% 的次要选项选择率。若沿用通用 argmax
     （conf=1 → ε=0），硬锁为人类的关键职位会被机械地夜夜保护 ⇒ 保护优先级退化成硬规则。 */
  const g2 = newGame(111);
  const opts = [{ v: 'A', U: 100, conf: 1 }, { v: 'B', U: 10, conf: 1 }];
  let alt = 0, altOld = 0;
  for (let i = 0; i < 400; i++) {
    if (AI.argmaxProtect(g2, opts).v === 'B') alt++;
    if (AI.argmax(g2, opts, AI.EPS.main).v === 'B') altOld++;
  }
  ok('N417 保护型选择在 conf=1 下仍保留次要选项选择率 ≥ 5%', alt >= 8, 'alt=' + alt + '/400');
  ok('通用 argmax 对 conf=1 仍归零（N417 未污染既有选择器）', altOld === 0, 'altOld=' + altOld);
}

/* ---------- 99. v32 isHuman 语义收窄：assertHumanAiParity（机制对等探测器） ----------
   原则（用户拍板）：isHuman 只允许出现在 engine.beginStep（决策来源）与 ui.js（渲染）。
   规则层（belief/perceive/decide/moe/channels/steps 的机制段）一律禁止读取。
   本断言做两件事：
   ① 静态源码扫描：规则层文件不得出现 isHuman（白名单：标注「显示口径/决策来源」的合法点）；
   ② 动态 kind 覆盖：所有 STEPS req 产出的决策类型必须被 Engine.toDecision 显式登记——
      default 已从静默 return {} 改为 throw，任何新增步骤漏登记当场炸出。 */
{
  /* ① 源码扫描：规则层禁读 isHuman。合法白名单（决策来源 ① / 显示口径）必须逐条带注释说明。 */
  const RULE_FILES = ['js/ai/belief.js', 'js/ai/perceive.js', 'js/ai/decide.js', 'js/infer/moe.js', 'js/infer/channels.run.js', 'js/infer/pipeline.js', 'js/infer/registry.js'];
  const root = path.join(__dirname, '..');
  const offenders = [];
  for (const f of RULE_FILES) {
    const lines = fs.readFileSync(path.join(root, f), 'utf8').split(/\r?\n/);
    lines.forEach((l, i) => {
      /* 只扫代码：跳过块注释行（/* 与 * 开头）与行内 // 注释——注释里的 isHuman 是文档 */
      const t = l.trim();
      if (t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/')) return;
      const code = l.replace(/\/\/.*$/, '');
      if (!code.includes('isHuman')) return;
      /* 白名单（两条合法语义，均带行内注释）：
         a. 显示口径：perceive.updatePublicThreat 的共识快照（AI 决策禁读 g.threat）；
         b. 决策来源：perceive.onAccuse 的异形队友自动营救（替 AI 角色执行行动，真人异形
            走自己的步骤决策）；
         c. 决策来源：pipeline 的真人应答转交（pendingAsk）与生成侧过滤（Z 档只拦 AI 生成的
            意图，玩家自由发言不被拦）——gate 的是「谁产生决策」，不是「规则适不适用」。 */
      const legal =
        (f.endsWith('perceive.js') && (code.includes('agents = g.players.filter') || code.includes('mates = g.players.filter'))) ||
        (f.endsWith('pipeline.js') && (code.includes('t.isHuman') || code.includes('sp.isHuman')));
      if (!legal) offenders.push(`${f}:${i + 1}`);
    });
  }
  ok('assertHumanAiParity ①：规则层文件零非法 isHuman 读取（语义收窄）',
    offenders.length === 0, offenders.join(', ') || 'clean');

  /* ② 动态 kind 覆盖：每个步骤 req 产出的决策类型必须能被 toDecision 处理（default 会 throw） */
  const gK = newGame(1);
  const kinds = new Set();
  for (const def of Object.values(Engine.STEPS)) {
    if (!def.req) continue;
    try { for (const r of def.req(gK)) kinds.add(r.kind); } catch (e) { /* 依赖局面的 req 跳过 */ }
  }
  const missing = [];
  for (const k of kinds) {
    try { Engine.toDecision(k, {}); } catch (e) { missing.push(k); }
  }
  ok('assertHumanAiParity ②：全部决策类型已登记 toDecision（无静默吞决策）',
    kinds.size > 0 && missing.length === 0,
    `kinds=[${[...kinds].sort().join(',')}] missing=[${missing.join(',')}]`);

  /* ③ 真人席位证据机制链路：直接驱动事件（不依赖讨论流的自然事件量——node 无 UI 无 streamPump），
     断言玩家席位与 AI 席位对同一事件产生同构入账 */
  {
    const gm = Setup.createGame(9, 'human');       // 注意：不用 newGame（它会把真人改成 AI）
    Engine.begin(gm);
    const me = gm.players[gm.humanId - 1];
    /* 注意：ctx 沙箱的 Map/Array 构造器与主环境不同，不能用 instanceof——用特征检查 */
    const struct = me && me.tEvents && typeof me.tEvents.forEach === 'function' && typeof me.tEvents.has === 'function'
      && me.uEvents && typeof me.uEvents.length === 'number'
      && me.hardFloor && typeof me.hardFloor.has === 'function'
      && me.evidence && typeof me.evidence.get === 'function';
    const count = p => { let n = 0; p.tEvents.forEach(v => n += v.length); return n; };
    const beforeMe = count(me), beforeAi = count(gm.players[3]);
    AI.onAccuse(gm, 1, [2]);                        // 1 号指控 2 号：全体观察者（含真人）入账
    AI.addUniversal(gm, me.id, 5, 'C+', 'parity-univ', 'claim', 'E10');
    AI.setHardFloor(gm, me.id, 6, 85);
    const grew = count(me) > beforeMe;              // 玩家作为观察者收到指控事件
    const aiGrew = count(gm.players[3]) > beforeAi; // 无关 AI 同样收到（对等；指控者/被指控者按规则排除）
    ok('assertHumanAiParity ③：真人席位机制链路对等（结构同构 + 指控/普适/硬源全生效）',
      !!struct && grew && aiGrew && me.uEvents.length > 0 && me.hardFloor.has(6),
      `struct=${!!struct} grew=${grew} aiGrew=${aiGrew} univ=${me.uEvents.length} floor=${me.hardFloor.size}`);
  }
}

console.log(`\nv26 回归断言：通过 ${pass} 条、失败 ${fail} 条`);
process.exit(fail ? 1 : 0);
