/* ============================================================================
 * 角色差异化探针
 * ----------------------------------------------------------------------------
 * 问题：声明层给了每个角色 grants / capClass / attend / 能力差异，
 *       这些差异有多少真正兑现为【信息差】与【决策差】？
 *
 * 三个层次分别测：
 *   L1 信息差：各角色持有的私有信息种类/数量是否不同
 *   L2 决策差：各角色的夜间行动是否不同
 *   L3 表达差：各角色的发言内容是否不同
 *
 * 只读。用法：node role-divergence.cjs <项目根> [局数]
 * ==========================================================================*/
'use strict';
const path = require('path');
const ROOT = process.argv[2];
const N = +(process.argv[3] || 200);
const { makeCtx, loadInto, profiles } = require(path.join(ROOT, 'tools', 'load-order.cjs'));
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { AI, Engine, Setup, SKData, SKRoleDecl: RD, Tiers, SKTrait, MoE } = ctx;

/* ============================ 容器 ============================ */
const ROLES = RD.keys().filter(k => SKData.ROLES[k]);
const S = {};      // per-role stats
for (const r of ROLES) S[r] = {
  games: 0, nights: 0,
  // L1 信息
  infoKinds: {},        // 私有信息来源种类计数
  checkCount: 0, crewCheck: 0, knownHard: 0, ballotSeen: 0, dmgTakenSeen: 0,
  infectSeen: 0, dyingSeen: 0, sniffs: 0, repairTotal: 0, reveals: 0,
  // L2 决策
  acts: {},             // decide kind 计数
  actNights: {},        // 该角色"有产出"的夜数
  voteTotal: 0, voteHit: 0, shootFired: 0, shootAsked: 0, kill: 0,
  // L3 表达
  speaks: 0, empty: 0, accuse: 0, ask: 0, claimRole: 0, lock: 0, deny: 0,
  lines: {},            // 该角色说过的句子（去重后用于组间相似度）
};
const FACTION_OF = k => (SKData.ROLES[k] ? SKData.ROLES[k].faction : null);

// 角色内信息"广度"：该角色夜里持有的不同私有信息通道数
const INFO_SRC = ['check', 'crewCheck', 'known', 'ballot', 'dmg', 'infect', 'dying', 'sniff', 'infectList', 'dyingList'];

let CUR = true;   // 恒真开关（分角色聚合，无需按局上下文）

const od = AI.decide;
AI.decide = function (g, req) {
  const d = od.apply(this, arguments);
  if (!CUR || !req) return d;
  const p = g.players.find(x => x.id === req.pid);
  if (!p) return d;
  const s = S[p.role]; if (!s) return d;
  const k = req.kind;
  s.acts[k] = (s.acts[k] || 0) + 1;
  if (k === 'vote') {
    const t = d && d.target;
    if (t != null) {
      s.voteTotal++;
      const tp = g.players.find(x => x.id === t);
      if (tp && (tp.faction === 'alien' || tp.faction === 'xeno')) s.voteHit++;
    }
  }
  if (k === 'shoot') {
    s.shootAsked++;
    if (d && d.targets && d.targets.length) s.shootFired += d.targets.length;
  }
  if (k === 'alienAct' && d && d.act === 'kill') s.kill++;
  if (k === 'xenoKill' && d && (d.target != null || d.targets)) s.kill++;
  if (k === 'detective') { if (d && d.mode === 'check') s.checkCount++; if (d && d.mode === 'announce') s.reveals++; }
  if (k === 'crewAction') { if (d && d.mode === 'check') s.crewCheck++; if (d && d.mode === 'repair') s.repairTotal++; }
  if (k === 'sniff') s.sniffs++;
  return d;
};

const os = AI.speak;
AI.speak = function (g, p, q) {
  const t = os.apply(this, arguments);
  if (!CUR) return t;
  const s = S[p.role]; if (!s) return t;
  s.speaks++;
  const str = String(t || '');
  if (!str.trim()) { s.empty++; return t; }
  s.lines[str] = (s.lines[str] || 0) + 1;
  const claimKinds = (p.outClaims || []).map(c => c.kind);
  for (const ck of claimKinds) s[ck] = (s[ck] || 0) + 1;
  return t;
};

/* 每夜末：统计各角色持有的私有信息 */
function sampleInfo(g) {
  const forp = {};
  for (const p of g.players) {
    const s = S[p.role]; if (!s) continue;
    forp[p.id] = s;
    s.nights++;
    const kinds = [];
    if (p.checkPool && p.checkPool.size) { kinds.push('check'); }
    if (p.crewChecks && p.crewChecks.size) { kinds.push('crewCheck'); }
    if (p.known && p.known.size) kinds.push('known');
    if (g.voteHistory && g.voteHistory.length && p.role === 'inspector') kinds.push('ballot');
    if (p.sniffLog && p.sniffLog.length) kinds.push('sniff');
    // 医生可见清单
    if (p.markSeen && p.markSeen.size) kinds.push('infectList');
    if (RD.hasGrant(p.role, 'rescue') && p.dyingSeen) kinds.push('dyingList');
    for (const kk of kinds) { s.infoKinds[kk] = (s.infoKinds[kk] || 0) + 1; s[kk] = (s[kk] || 0) + (kk === 'check' ? p.checkPool.size : kk === 'known' ? p.known.size : 1); }
    for (const kk of kinds) s.infoKinds[kk] = s.infoKinds[kk];
  }
}

for (let seed = 1; seed <= N; seed++) {
  let g;
  try {
    g = Setup.createGame(seed, 'random');
    g.humans = []; g.humanId = -1; for (const p of g.players) p.isHuman = false;
    for (const p of g.players) { const s = S[p.role]; if (s) s.games++; }
    Engine.begin(g);
    let steps = 0, lastNight = -1;
    while (!g.over && steps < 5000) {
      steps++; Engine.stepOnce(g);
      if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
      if (g.night !== lastNight) { lastNight = g.night; sampleInfo(g); }
    }
  } catch (e) { /* ignore */ }
}

/* ============================ 报告 ============================ */
const pad = (s, n) => String(s).padEnd(n);
const out = [];
const L = s => { out.push(s); console.log(s); };

L('=== 角色差异化探针（%d 局，%d 个角色）===\n', N, ROLES.length);
L('── L1 信息差：每角色平均持有的私有信息通道种类 ──');
L('  ' + pad('角色', 12) + pad('阵营', 6) + pad('局数', 6) + pad('夜次', 7) + '通道种类/夜  ' + '明细');
const breadth = {};
for (const r of ROLES) {
  const s = S[r];
  const kinds = Object.keys(s.infoKinds).length;
  breadth[r] = kinds;
  const det = Object.keys(s.infoKinds).map(k => k + ':' + (s.infoKinds[k] / Math.max(1, s.nights)).toFixed(2)).join(' ');
  L('  ' + pad(r, 12) + pad(FACTION_OF(r), 6) + pad(s.games, 6) + pad(s.nights, 7)
    + pad(kinds, 12) + det);
}
const bvals = ROLES.map(r => breadth[r]);
L('\n  信息通道种类：min=' + Math.min(...bvals) + ' max=' + Math.max(...bvals)
  + ' 均值=' + (bvals.reduce((a, b) => a + b, 0) / bvals.length).toFixed(2)
  + '  极差=' + (Math.max(...bvals) - Math.min(...bvals)));

L('\n── L2 决策差：每角色每局的夜间行动 ──');
L('  ' + pad('角色', 12) + pad('查验', 7) + pad('船员查', 8) + pad('维修', 7) + pad('开枪', 7) + pad('击杀', 7) + pad('投票', 7) + pad('投票命中', 10));
for (const r of ROLES) {
  const s = S[r], G = Math.max(1, s.games);
  L('  ' + pad(r, 12)
    + pad((s.checkCount / G).toFixed(2), 7) + pad((s.crewCheck / G).toFixed(2), 8)
    + pad((s.repairTotal / G).toFixed(2), 7) + pad((s.shootFired / G).toFixed(2), 7)
    + pad((s.kill / G).toFixed(2), 7) + pad((s.voteTotal / G).toFixed(2), 7)
    + pad(s.voteTotal ? (100 * s.voteHit / s.voteTotal).toFixed(1) + '%' : '-', 10));
}

L('\n── L3 表达差：各角色发言的 Claim 类型分布（每角色发言数归一）──');
const CLAIMS = ['accuse', 'ask', 'claimRole', 'lock', 'deny', 'promise', 'abstain', 'quote', 'vote'];
L('  ' + pad('角色', 12) + pad('发言数', 8) + pad('空发言', 8) + CLAIMS.map(c => pad(c.slice(0, 7), 9)).join(''));
for (const r of ROLES) {
  const s = S[r];
  const uniq = Object.keys(s.lines).length;
  L('  ' + pad(r, 12) + pad(s.speaks, 8) + pad(s.speaks ? (100 * s.empty / s.speaks).toFixed(1) + '%' : '-', 8)
    + CLAIMS.map(c => pad(s.speaks ? (100 * (s[c] || 0) / s.speaks).toFixed(0) : '-', 9)).join(''));
  s._uniq = uniq;
}

L('\n── 表达相似度（两两 Jaccard：越高越像克隆体）──');
const keys = ROLES.filter(r => S[r].speaks > 20);
const sims = [];
for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
  const a = new Set(Object.keys(S[keys[i]].lines)), b = new Set(Object.keys(S[keys[j]].lines));
  if (!a.size || !b.size) continue;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  sims.push({ p: keys[i] + '/' + keys[j], j: inter / (a.size + b.size - inter) });
}
sims.sort((x, y) => y.j - x.j);
L('  组数=' + sims.length + '  平均 Jaccard=' + (sims.reduce((a, b) => a + b.j, 0) / Math.max(1, sims.length)).toFixed(3));
L('  最像的 6 对：');
sims.slice(0, 6).forEach(s => L('    ' + pad(s.p, 26) + s.j.toFixed(3)));
L('  最不像的 3 对：');
sims.slice(-3).forEach(s => L('    ' + pad(s.p, 26) + s.j.toFixed(3)));

require('fs').writeFileSync(path.join(__dirname, 'role-divergence-report.txt'), out.join('\n'), 'utf8');