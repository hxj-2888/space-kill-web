/* ============================================================================
 * 威胁量化探针 · 第一步：拆解「怀疑度/危险度」的每一个构成项的判别力
 * ----------------------------------------------------------------------------
 * 问题：为什么 AUC ≈ 0.50（随机），人类观察者 0.371（反向）？
 * 方法：对每个 (观察者 o, 目标 x) 采样点，把 dangerOf / suspOf 拆成独立分量，
 *       逐个算 AUC。判别力 < 0.5 的分量是【主动有害】的，必须消除。
 *
 * 只读。用法：node threat-decompose.cjs <项目根> [局数]
 * ==========================================================================*/
'use strict';
const path = require('path');
const ROOT = process.argv[2];
const N = +(process.argv[3] || 150);
const { makeCtx, loadInto, profiles } = require(path.join(ROOT, 'tools', 'load-order.cjs'));
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { AI, Engine, Setup, Tiers, SKData, SKTrait, SKRoleDecl } = ctx;
const BEL = ctx.AIBelief;

/* ---------- AUC 累加器 ---------- */
const CAND = {
  dangerOf:      '危险度 Dg（行动层·投票实际读它）',
  suspOf:        '怀疑度 S（认知层）',
  capOnly:       '  └ 能力项 0.3×capability（读 claimedRole）',
  hostileOnly:   '  └ 敌对度 0.6×hostileOf',
  actOnly:       '  └ 活跃度 0.1×actF（读公开指控/质询次数）',
  baseDanger:    '  └ 性格危险度基线偏移',
  evMass:        '证据质量（tEvents 溯源和·衰减·注意力·可信度）',
  evMassNoAtt:   '证据质量（去掉注意力权重）',
  tierMass:      '证据档位质量（只看 tier 名，不看 delta）',
  negOnly:       '证据负向质量（只算 delta>0 的条目）',
  memContra:     '长期记忆·矛盾条数',
  memStance:     '长期记忆·立场分 |score|',
  memRoleChange: '长期记忆·自称改口',
  knownHard:     '硬源确证（已确证非人类=1）',
};
const acc = {};
for (const k of Object.keys(CAND)) acc[k] = { s: 0, n: 0 };

/* ---------- 分量提取（复刻 belief.js 的口径，保证可对照） ---------- */
const PRIOR = Tiers.PRIOR, PRIOR_E = Tiers.PRIOR_E, DG_W = Tiers.DG_W, CAP = Tiers.CAP;
function priorOf(g, p) {
  return p.faction === 'human' ? PRIOR.human : p.faction === 'xeno' ? PRIOR.xeno : PRIOR.alienVsOther;
}
function capability(g, t) {
  let c = CAP.base;
  const cr = (t.claimedRole && t.claimedRole !== 'crew') ? t.claimedRole : (t.revealed && t.revealed.role) || null;
  const cc = SKRoleDecl.capClassOf(cr);
  if (cc === 'high') c = CAP.high; else if (cc === 'mid') c = CAP.mid; else if (cc === 'low') c = CAP.low;
  if (t.repairExposed) c = Math.max(c, CAP.repairExposed);
  return c;
}
function actF(g, p) {
  let n = 0;
  n += (p.accuseHistory || []).length;
  n += (p.askHistory || []).length;
  n += (p.promises || []).length;
  if (p.claimedRole) n += 2;
  if (p.repairExposed) n += 3;
  if (p.silenceNight != null && p.silenceNight >= g.night) n = Math.max(0, n - 2);
  if (!n) return 0;
  const A = Math.log(1 + n);
  return A / (A + 1);
}
function baseDanger(p) {
  const v = SKTrait.traitValue('theta', 'baseDanger', p.theta);
  return v == null ? 50 : v;
}

/* 注意力权重（复刻 moe.js absorb 的写入侧口径） */
const EVT_FAMILY = [
  [/^settle:N01/, 'infra'], [/^(R17|R17b|askVerify|grudge|rescue)/, 'lethal'],
  [/^(cross|crossRole|ansCross|R12|claim)/, 'verify'], [/^(R27|R28|R29|R40|R64|promiseMiss)/, 'ballot'],
  [/^(repair|destroy)/, 'infra'], [/^(cure|infection|brew|rescue|suppress)/, 'infect'],
  [/^(lock|exclusion|denyLie|ask|accuse|quote|ans)/, 'verify'],
];
function familyOf(src) { if (!src) return null; for (const [re, f] of EVT_FAMILY) if (re.test(src)) return f; return null; }

/* ---------- 证据质量：溯源式（不看自称，只看"我观察到什么"） ---------- */
function evidence(g, o, t, useAtt) {
  const evs = (o.tEvents && o.tEvents.get(t.id)) || [];
  let mass = 0, neg = 0, tierMass = 0;
  for (const e of evs) {
    const age = Math.max(0, g.night - e.night);
    const decay = e.kind === 'fact' ? 1 : Math.pow(e.grudge ? Tiers.GRUDGE_DECAY : Tiers.CLAIM_DECAY, age);
    // 注意力：按观察者角色的关注度调制（连续权重，缺省 1）
    let w = 1;
    if (useAtt) { const f = familyOf(e.src); if (f) { const a = Tiers.attend(o.role || o.roleExpert, f); if (typeof a === 'number') w = a; } }
    // 可信度：D 档证据按"我有多信说话者"缩放
    const cscale = (e.tier && e.tier[0] === 'D') ? (0.4 + 0.6 * BEL.credOf(o, e.spk || t.id)) : 1;
    const amt = Math.abs(e.delta || 0) * decay * w * cscale;
    mass += amt;
    if ((e.delta || 0) > 0) neg += amt;
    if (e.tier) tierMass += (Tiers.SCORE[e.tier] || 0) * decay * w;
  }
  return { evMass: mass, evMassNoAtt: mass, negOnly: neg, tierMass };
}

/* ---------- 长期记忆信号 ---------- */
function memSignals(o, t) {
  const m = o.mem;
  if (!m) return { memContra: 0, memStance: 0, memRoleChange: 0 };
  let contra = 0;
  for (const c of m.contradiction) if (c.subject === t.id) contra++;
  const sr = m.saidRole.get(t.id);
  const st = m.stance.get(t.id);
  return {
    memContra: contra,
    memStance: st ? Math.abs(st.score) : 0,
    memRoleChange: (sr && sr.conflictWith) ? 1 : 0,
  };
}

/* ---------- 主循环：采样 + 算 AUC ---------- */
function sample(g) {
  for (const o of g.players) {
    if (o.out) continue;
    const al = g.players.filter(x => !x.out && x.id !== o.id);
    if (al.length < 2) continue;
    const hostileSet = new Set(o.faction === 'alien' ? ['human', 'xeno'] : o.faction === 'xeno' ? ['alien'] : ['alien', 'xeno']);
    // 取 o 的视角分量（对 al 全体取一次，避免逐目标重算）
    const hostileOfDist = {}; // 占位
    const rows = al.map(x => {
      let danger = 0, susp = 0, host = 0;
      try { danger = AI.dangerOf(g, o, x.id); } catch (e) {}
      try { susp = AI.suspOf(g, o, x.id); } catch (e) {}
      // 敌对度：从分布取
      try { const d = AI.suspDist(g, o, x.id); const f = SKData.FACTION[o.faction] || SKData.FACTION.human;
        host = (f.hostileTo || SKData.FACTION.human.hostileTo).reduce((a, k) => a + AI.distGet(d, k), 0); } catch (e) {}
      const cap = capability(g, x);
      const act = actF(g, x);
      const bd = baseDanger(x);
      const ev = evidence(g, o, x, true);
      const mem = memSignals(o, x);
      // 硬源确证非人类
      let kh = 0;
      try { const kl = AI.knownLockOf ? null : null; const k = o.known && o.known.get(x.id);
        const rd = k && k.role && SKData.ROLES[k.role];
        const conf = (x.revealed && x.revealed.faction && x.revealed.faction !== 'human') || (k && k.faction && k.faction !== 'human') || (rd && rd.faction && rd.faction !== 'human');
        kh = conf ? 1 : 0; } catch (e) {}
      return { truth: hostileSet.has(x.faction), v: {
        dangerOf: danger, suspOf: susp,
        capOnly: cap * 100, hostileOnly: host * 100, actOnly: act * 100, baseDanger: bd,
        evMass: ev.evMass, evMassNoAtt: ev.evMassNoAtt, tierMass: ev.tierMass, negOnly: ev.negOnly,
        memContra: mem.memContra, memStance: mem.memStance, memRoleChange: mem.memRoleChange, knownHard: kh,
      } };
    });
    for (const k of Object.keys(CAND)) {
      const pos = rows.filter(r => r.truth).map(r => r.v[k]);
      const neg = rows.filter(r => !r.truth).map(r => r.v[k]);
      if (!pos.length || !neg.length) continue;
      let w = 0;
      for (const a of pos) for (const b of neg) w += a > b ? 1 : a === b ? 0.5 : 0;
      acc[k].s += w / (pos.length * neg.length); acc[k].n++;
    }
  }
}

for (let seed = 1; seed <= N; seed++) {
  const g = Setup.createGame(seed, 'random');
  g.humans = []; g.humanId = -1; for (const p of g.players) p.isHuman = false;
  Engine.begin(g);
  let steps = 0;
  while (!g.over && steps < 5000) {
    steps++; Engine.stepOnce(g);
    if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
    if (g.step === '9' || g.step === 'D-vote' || g.step === 'M-vote') sample(g);
  }
}

/* ---------- 报告 ---------- */
console.log('=== 怀疑度/危险度 构成项判别力拆解（%d 局）===', N);
console.log('AUC：0.5=随机  >0.5=会识别威胁  <0.5=【主动有害·反着指】\n');
const rows = Object.keys(CAND).map(k => ({ k, a: acc[k].n ? acc[k].s / acc[k].n : NaN, n: acc[k].n }));
rows.sort((x, y) => y.a - x.a);
for (const r of rows) {
  const bar = r.a >= 0.5 ? '+'.repeat(Math.round((r.a - 0.5) * 100)) : '-'.repeat(Math.round((0.5 - r.a) * 100));
  const flag = r.a < 0.5 ? '  ← 反向！' : '';
  console.log('  ' + CAND[r.k].padEnd(38) + ' AUC=' + r.a.toFixed(4) + '  ' + bar + flag);
}
console.log('\n采样组数 n =', rows[0].n);