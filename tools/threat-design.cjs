/* ============================================================================
 * 威胁量化 · 设计验证：既然「证据量 ∝ 可见度 ∝ 是人类」，
 * 就必须对可见度去偏。此处实测若干去偏形式 + 通道子集组合，
 * 找出判别力最高、且不需要改规则层语料的量化口径。
 *
 * 只读。用法：node threat-design.cjs <项目根> [局数]
 * ==========================================================================*/
'use strict';
const path = require('path');
const ROOT = process.argv[2];
const N = +(process.argv[3] || 120);
const { makeCtx, loadInto, profiles } = require(path.join(ROOT, 'tools', 'load-order.cjs'));
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { AI, Engine, Setup, Tiers, SKData, AIBelief: BEL } = ctx;

const CHANRE = [
  ['accuse',  /^accuse:/],
  ['ask',     /^ask|ans|askVerify/],
  ['quote',   /^quote/],
  ['claim',   /^claim:/],
  ['lock',    /^locksay:|R38|privClaim|privSame|privShare/],
  ['exclusion', /^excludesay:/],
  ['deny',    /^denyLie:/],
  ['expose',  /^repair:|destroy:|R22|R23/],
  ['settle',  /^settle:/],
  ['grudge',  /^grudge:/],
  ['rescue',  /^rescue:/],
  ['cross',   /^cross|crossRole|ansCross|R12|conflict/],
  ['ballot',  /^R27|R28|R29|R40|R64|promiseMiss/],
  ['king',    /^king|emitKing/],
  ['chan',    /^chan:/],
  ['private', /^pm:|priv/],
];
function chanOf(src) { const s = String(src || ''); for (const [n, re] of CHANRE) if (re.test(s)) return n; return 'other'; }

const GROUPS = [];   // { pos:[row], neg:[row] }
let gTalk = {};      // 全局可见度：每个目标被多少人谈论过（跨观察者）

function sample(g) {
  // 先算全局可见度（这一夜、这一批目标）
  const talk = {};
  for (const x of g.players) {
    if (x.out) continue;
    let t = (x.accuseHistory || []).length + (x.askHistory || []).length
          + (x.claims || []).length + (x.accuseHistory || []).length * 1.0;
    for (const o of g.players) {
      if (o.out || o.id === x.id) continue;
      const evs = (o.tEvents && o.tEvents.get(x.id)) || [];
      t += evs.length;
    }
    talk[x.id] = t;
  }
  gTalk = talk;

  for (const o of g.players) {
    if (o.out || o.faction !== 'human') continue;
    const al = g.players.filter(x => !x.out && x.id !== o.id);
    if (al.length < 2) continue;
    const hostileSet = new Set(['alien', 'xeno']);
    const pos = [], neg = [];
    for (const x of al) {
      const evs = (o.tEvents && o.tEvents.get(x.id)) || [];
      const b = {}; let all = 0, negAll = 0, hard = 0;
      for (const e of evs) {
        const age = Math.max(0, g.night - e.night);
        const decay = e.kind === 'fact' ? 1 : Math.pow(e.grudge ? Tiers.GRUDGE_DECAY : Tiers.CLAIM_DECAY, age);
        const cscale = (e.tier && e.tier[0] === 'D') ? (0.4 + 0.6 * BEL.credOf(o, e.spk || x.id)) : 1;
        const amt = Math.abs(e.delta || 0) * decay * cscale;
        if ((e.delta || 0) > 0) {
          negAll += amt;
          const c = chanOf(e.src); b[c] = (b[c] || 0) + amt;
        }
        all += amt;
        const sc = Tiers.SCORE[e.tier] || 0;
        if (sc >= 20 && (e.delta || 0) > 0) hard += amt;      // B 档及以上
      }
      const k = o.known && o.known.get(x.id);
      const rd = k && k.role && SKData.ROLES[k.role];
      const f = (x.revealed && x.revealed.faction) || (k && k.faction) || (rd && rd.faction);
      const kh = (f && f !== 'human') ? 1 : 0;
      const row = { b, all, negAll, hard, kh, talk: talk[x.id] || 0,
        accused: (x.accuseHistory || []).length, asked: (x.askHistory || []).length,
        spoke: (x.claims || []).length };
      (hostileSet.has(x.faction) ? pos : neg).push(row);
    }
    if (pos.length && neg.length) GROUPS.push({ pos, neg });
  }
}

const METRICS = {
  'A0 全量负向（现行）':        r => r.negAll,
  'A1 剔除 ask+accuse':         r => { let s = 0; for (const k of Object.keys(r.b)) if (k !== 'ask' && k !== 'accuse') s += r.b[k]; return s; },
  'A2 仅 king（沉默指纹）':     r => r.b.king || 0,
  'A3 仅 B档以上硬证据':        r => r.hard,
  'A4 仅 crime 族(expose/settle/cross/deny/exclusion)': r => (r.b.expose || 0) + (r.b.settle || 0) + (r.b.cross || 0) + (r.b.deny || 0) + (r.b.exclusion || 0),
  'A5 全量/可见度（去偏）':     r => r.negAll / (1 + r.talk),
  'A6 全量 − 0.5×可见度':       r => r.negAll - 0.5 * r.talk,
  'A7 剔除ask+accuse，再/可见度': r => { let s = 0; for (const k of Object.keys(r.b)) if (k !== 'ask' && k !== 'accuse') s += r.b[k]; return s / (1 + r.talk); },
  'A8 被质询次数（对照·应反向）': r => r.asked,
  'A9 发言条数（对照·应反向）':  r => r.spoke,
  'A10 被指控次数（对照）':      r => r.accused,
  'B1 king + 可见度去偏':       r => (r.b.king || 0) / (1 + 0.3 * r.talk),
  'B2 king + crime':            r => (r.b.king || 0) + ((r.b.expose || 0) + (r.b.settle || 0) + (r.b.cross || 0) + (r.b.deny || 0)),
  'B3 硬源 + king':             r => r.kh * 1000 + (r.b.king || 0),
  'B4 硬源×1000 + crime':       r => r.kh * 1000 + ((r.b.expose || 0) + (r.b.settle || 0) + (r.b.cross || 0)),
};

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

function aucOf(get) {
  let s = 0, n = 0;
  for (const g of GROUPS) {
    const P = g.pos.map(get), Nn = g.neg.map(get);
    if (!P.length || !Nn.length) continue;
    let w = 0; for (const a of P) for (const b of Nn) w += a > b ? 1 : a === b ? 0.5 : 0;
    s += w / (P.length * Nn.length); n++;
  }
  return n ? s / n : NaN;
}

console.log('=== 威胁量化口径实测（人类观察者视角，%d 局，%d 组）===\n', N, GROUPS.length);
const rows = Object.keys(METRICS).map(k => ({ k, a: aucOf(METRICS[k]) }));
rows.sort((x, y) => y.a - x.a);
for (const r of rows) {
  const d = r.a - 0.5;
  const bar = (d >= 0 ? '+' : '-').repeat(Math.min(34, Math.round(Math.abs(d) * 100)));
  const tag = r.a >= 0.55 ? '✔ 可用' : r.a >= 0.5 ? '· 勉强' : r.a >= 0.45 ? '✗ 噪声区' : '✖✖ 反向/有毒';
  console.log('  ' + r.k.padEnd(42) + ' AUC=' + r.a.toFixed(4) + '  ' + bar + '  ' + tag);
}