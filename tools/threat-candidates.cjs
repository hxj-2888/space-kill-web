/* ============================================================================
 * 威胁量化探针 · 第二步：两个致命假设的验证 + 候选威胁指标实测
 * ----------------------------------------------------------------------------
 * H1 可见性偏置：「负面证据越多」≈「越显眼」≈「越像人类」 ⇒ 证据量反向
 * H2 硬源说谎：known 台账里若有错 faction，则最高信任通道本身是污染源
 *
 * 然后实测候选指标，挑出真正能识别威胁的量化口径。
 * 只读。用法：node threat-candidates.cjs <项目根> [局数]
 * ==========================================================================*/
'use strict';
const path = require('path');
const ROOT = process.argv[2];
const N = +(process.argv[3] || 150);
const { makeCtx, loadInto, profiles } = require(path.join(ROOT, 'tools', 'load-order.cjs'));
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { AI, Engine, Setup, Tiers, SKData, SKRoleDecl, AIBelief: BEL } = ctx;

/* ============================ H1：可见性偏置 ============================ */
const H1 = { humanEv: 0, humanN: 0, alienEv: 0, alienN: 0, humanNeg: 0, alienNeg: 0, humanPos: 0, alienPos: 0, spoken: { human: 0, alien: 0 }, accused: { human: 0, alien: 0 } };

/* ============================ H2：硬源锁定正确性 ============================ */
const H2 = { total: 0, match: 0, wrong: 0, samples: [] };

/* ============================ 候选威胁指标 ============================ */
const CAND = {
  M0_susp:      'M0 怀疑度 suspOf（现行认知层）',
  M1_danger:    'M1 危险度 dangerOf（现行行动层）',
  M2_highTier:  'M2 只用 A/B 档证据（高置信·低噪）',
  M3_relRank:   'M3 账本内相对排名（按观察者自身归一）',
  M4_attHi:     'M4 注意力加权的高档证据',
  M5_crime:     'M5 犯罪类证据（破坏/冒领/感染/维修矛盾）',
  M6_talkPure:  'M6 纯发言类证据（对照：应当反向）',
  M7_indep:     'M7 独立信息源计数（并罚前的去重源数）',
  M8_hardOnly:  'M8 仅硬源（已确证非人类）',
};
const acc = {}; for (const k of Object.keys(CAND)) acc[k] = { s: 0, n: 0 };

const FACTION_OF_ROLE = k => (SKData.ROLES[k] ? SKData.ROLES[k].faction : null);

function evidenceProfile(g, o, t) {
  const evs = (o.tEvents && o.tEvents.get(t.id)) || [];
  let neg = 0, pos = 0, hi = 0, indep = 0, crime = 0, talk = 0;
  const srcs = new Set();
  for (const e of evs) {
    const age = Math.max(0, g.night - e.night);
    const decay = e.kind === 'fact' ? 1 : Math.pow(e.grudge ? Tiers.GRUDGE_DECAY : Tiers.CLAIM_DECAY, age);
    const cscale = (e.tier && e.tier[0] === 'D') ? (0.4 + 0.6 * BEL.credOf(o, e.spk || t.id)) : 1;
    const amt = Math.abs(e.delta || 0) * decay * cscale;
    if ((e.delta || 0) > 0) neg += amt; else if ((e.delta || 0) < 0) pos += amt;
    const sc = Tiers.SCORE[e.tier] || 0;
    if ((e.tier === 'A' || e.tier === 'A+' || e.tier === 'A-' || e.tier === 'B' || e.tier === 'B+' || e.tier === 'B-') && (e.delta || 0) > 0) hi += sc * decay * cscale;
    if (e.src) srcs.add(e.src);
    const s = String(e.src || '');
    if (/^(settle:N01|destroy|repair:|infect|suppress|grudge|exclusion|cross|lockEnemy|denyLie|R30|checkLie|R12|settle:F02)/.test(s)) crime += amt;
    if (/^(accuse|ask|quote|ans|R27|R28|R29|R40|R64|claim:|lockHuman|promiseMiss)/.test(s)) talk += amt;
  }
  return { neg, pos, hi, indep: srcs.size, crime, talk, n: evs.length };
}

function sample(g) {
  for (const o of g.players) {
    if (o.out) continue;
    const al = g.players.filter(x => !x.out && x.id !== o.id);
    if (al.length < 2) continue;
    const hostileSet = new Set(o.faction === 'alien' ? ['human', 'xeno'] : o.faction === 'xeno' ? ['alien'] : ['alien', 'xeno']);

    /* ---- H2：本观察者对每个目标的硬源锁定 vs 真相 ---- */
    for (const x of al) {
      const kl = o.known && o.known.get(x.id);
      if (!kl) continue;
      let claimed = null;
      if (kl.role && FACTION_OF_ROLE(kl.role)) claimed = FACTION_OF_ROLE(kl.role);
      else if (kl.faction) claimed = kl.faction;
      if (!claimed) continue;
      H2.total++;
      if (claimed === x.faction) H2.match++; else { H2.wrong++; if (H2.samples.length < 8) H2.samples.push({ seed: g._seed, night: g.night, obs: o.id, obsF: o.faction, tgt: x.id, claimed, truth: x.faction, via: kl.role || kl.faction, priv: !!kl.viaPrivate }); }
    }

    /* ---- 候选指标 ---- */
    const rows = al.map(x => {
      const ep = evidenceProfile(g, o, x);
      let susp = 0, danger = 0, kh = 0;
      try { susp = AI.suspOf(g, o, x.id); } catch (e) {}
      try { danger = AI.dangerOf(g, o, x.id); } catch (e) {}
      const k = o.known && o.known.get(x.id);
      const rd = k && k.role && SKData.ROLES[k.role];
      const f = (x.revealed && x.revealed.faction) || (k && k.faction) || (rd && rd.faction);
      if (f && f !== 'human') kh = 1;
      return { truth: hostileSet.has(x.faction), ep, susp, danger, kh };
    });

    // H1：证据条数/正负量 按阵营分组（以 human 观察者的视角看人类 vs 异形）
    if (o.faction === 'human') {
      for (const r of rows) {
        const t = r.truth ? 'human' : 'nonhuman';
        H1[t === 'human' ? 'humanEv' : 'alienEv'] += r.ep.n;
        H1[t === 'human' ? 'humanN' : 'alienN']++;
        H1[t === 'human' ? 'humanNeg' : 'alienNeg'] += r.ep.neg;
        H1[t === 'human' ? 'humanPos' : 'alienPos'] += r.ep.pos;
      }
    }

    // 相对排名归一（每个观察者内部按 neg 排序取分位）
    const byNeg = rows.slice().sort((a, b) => b.ep.neg - a.ep.neg);
    const rankOf = {}; byNeg.forEach((r, i) => { rankOf[al[rows.indexOf(r)].id] = 1 - i / Math.max(1, byNeg.length - 1); });

    for (const k of Object.keys(CAND)) {
      const pos = [], neg = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i], x = al[i];
        let v = 0;
        switch (k) {
          case 'M0_susp': v = r.susp; break;
          case 'M1_danger': v = r.danger; break;
          case 'M2_highTier': v = r.ep.hi; break;
          case 'M3_relRank': v = rankOf[x.id]; break;
          case 'M4_attHi': {
            const f = r.ep.hi; const fam = 'verify';
            const a = Tiers.attend(o.role || o.roleExpert, fam);
            v = f * (typeof a === 'number' ? a : 1); break;
          }
          case 'M5_crime': v = r.ep.crime; break;
          case 'M6_talkPure': v = r.ep.talk; break;
          case 'M7_indep': v = r.ep.indep; break;
          case 'M8_hardOnly': v = r.kh; break;
        }
        (r.truth ? pos : neg).push(v);
      }
      if (!pos.length || !neg.length) continue;
      let w = 0; for (const a of pos) for (const b of neg) w += a > b ? 1 : a === b ? 0.5 : 0;
      acc[k].s += w / (pos.length * neg.length); acc[k].n++;
    }
  }
}

for (let seed = 1; seed <= N; seed++) {
  const g = Setup.createGame(seed, 'random');
  g._seed = seed;
  g.humans = []; g.humanId = -1; for (const p of g.players) p.isHuman = false;
  Engine.begin(g);
  let steps = 0;
  while (!g.over && steps < 5000) {
    steps++; Engine.stepOnce(g);
    if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
    if (g.step === '9' || g.step === 'D-vote' || g.step === 'M-vote') sample(g);
  }
}

/* ============================ 报告 ============================ */
console.log('=== H1 · 可见性偏置（人类观察者视角，%d 局）===', N);
const f = (a, b) => b ? (a / b).toFixed(2) : '0';
console.log('  人类目标：人均证据条数 %s　人均负向量 %s　人均正向量 %s',
  f(H1.humanEv, H1.humanN), f(H1.humanNeg, H1.humanN), f(H1.humanPos, H1.humanN));
console.log('  异形目标：人均证据条数 %s　人均负向量 %s　人均正向量 %s',
  f(H1.alienEv, H1.alienN), f(H1.alienNeg, H1.alienN), f(H1.alienPos, H1.alienN));
console.log('  比率 人类/异形：条数 %s×　负向 %s×',
  (H1.alienEv ? (H1.humanEv / H1.alienEv).toFixed(2) : '-'), (H1.alienNeg ? (H1.humanNeg / H1.alienNeg).toFixed(2) : '-'));

console.log('\n=== H2 · 硬源锁定正确性 ===');
console.log('  known 台账里有阵营/职业锁定的条目：%d 条', H2.total);
console.log('  与真相一致 %d 条（%.1f%%），不一致 %d 条（%.1f%%）',
  H2.match, 100 * H2.match / Math.max(1, H2.total), H2.wrong, 100 * H2.wrong / Math.max(1, H2.total));
if (H2.samples.length) { console.log('  错锁样本：'); H2.samples.forEach(s => console.log('    ', JSON.stringify(s))); }

console.log('\n=== 候选威胁指标 AUC ===');
const rows = Object.keys(CAND).map(k => ({ k, a: acc[k].n ? acc[k].s / acc[k].n : NaN, n: acc[k].n }));
rows.sort((x, y) => y.a - x.a);
for (const r of rows) {
  const d = r.a - 0.5;
  const bar = (d >= 0 ? '+' : '-').repeat(Math.min(30, Math.round(Math.abs(d) * 100)));
  console.log('  ' + CAND[r.k].padEnd(32) + ' AUC=' + r.a.toFixed(4) + '  ' + bar + (r.a < 0.5 ? '  ←反向' : ''));
}