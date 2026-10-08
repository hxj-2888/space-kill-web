'use strict';
/* ============================================================================
 * 太空杀 · 对局侦察探针 v3（Post-B0）
 * ----------------------------------------------------------------------------
 * 设计纪律：本探针只钩**已验证可拦截**的入口。上一版有两个计数器是坏的——
 *   ① AI.reasoningChain：decide.js:262 调的是模块内同名局部函数，钩门面无效
 *      （与先前 AI.vote 同类错误）⇒ 该指标作废，本版改用「可观测替代量」测推理层。
 *   ② g.pending 在本驱动下恒为 null（引擎内部自动结算）⇒ 不能靠它抓投票，
 *      改读 g.voteHistory。
 * 用法：node tools/scout.cjs <REPO_ROOT> [局数] [起始种子] [输出json]
 * ==========================================================================*/
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || process.cwd();
const N = +(process.argv[3] || 200);
const SEED0 = +(process.argv[4] || 1);
const OUT = process.argv[5] || null;

function loadOrder(root) {
  const src = fs.readFileSync(path.join(root, 'tools', 'load-order.cjs'), 'utf8');
  const m = { exports: {} };
  new Function('require', 'module', 'exports', '__dirname', '__filename', src)(
    require, m, m.exports, path.join(root, 'tools'), 'x');
  return m.exports;
}

const { makeCtx, loadInto, profiles } = loadOrder(ROOT);
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { AI, Engine, Setup, Bridge, Tactics, Tiers } = ctx;

const bump = (o, k, n) => { o[k] = (o[k] || 0) + (n == null ? 1 : n); };
const roleKey = p => (p && (p.originRole || p.role)) || '?';
const zone = n => n >= 45 ? '残局' : n >= 20 ? '中期' : '前期';

const S = {
  games: 0, errs: 0, errMsgs: {},
  winner: {}, endNight: {}, phase: {}, extinction: 0, duel: 0,

  /* 发言层 */
  speak: 0, speakEmpty: 0,
  claimKind: {},                 // Claim kind 分布
  claimKindByFaction: { human: {}, alien: {}, xeno: {} },
  claimByRole: {},
  sentence: {}, sentenceN: 0,    // 句子模板（剥数字后的骨架）
  speakByRole: {},
  speakEmptyByRole: {},
  citeSeatN: 0,                  // 发言中出现的「N 号」次数
  accuseN: 0, quoteN: 0, askN: 0, reportN: 0,

  /* 推理层（可观测替代量） */
  memSaidRole: 0, memPromise: 0, memContradiction: 0, memStance: 0,
  memCiteSaidRole: 0, memCitePromise: 0, memCiteStance: 0, memCiteConflict: 0,
  gamesWithConflict: 0, gamesConflictUncited: 0,

  /* 证据层 */
  evTotal: 0, evBySrcFamily: {}, evByViewerRole: {},
  evPerViewerKinds: {},          // 每个观察者见过的 src 家族数

  /* 行动层 */
  decideCalls: 0, decideNonEmpty: 0, decideEmptyByRole: {},
  actByRole: {},
  alienDestroy: 0, alienKill: 0, alienInfect: 0,
  humanSkills: 0,

  /* 投票层 */
  voteRounds: 0, voteSeats: 0,
  distinctSum: 0, maxShareSum: 0, unanimous: 0,
  humanVoteN: 0, humanVoteHit: 0,
  alienVoteN: 0, alienVoteHuman: 0, alienVoteAlly: 0,
  voteByRole: {},                // 角色 → {n, hit}

  /* 战术层 */
  tacticCalls: 0, tacticDead: 0, tacticDeadIds: {},
};

const origSay = Bridge.say;
const origDecide = AI.decide;

/* 真实签名：say(g, pid, text, opts)，opts.extra = IR Claim 数组
   （pipeline.js:279 `if (!clean && !(opts.extra && opts.extra.length)) return false`） */
Bridge.say = function (g, pid, text, opts) {
  let r;
  try { r = origSay.apply(this, arguments); } catch (e) { S.errs++; bump(S.errMsgs, 'Bridge.say:' + String(e.message).slice(0, 40)); }
  try {
    S.speak++;
    const p = g.players.find(x => x.id === pid);
    const fk = p ? p.faction : '?';
    const rk = roleKey(p);
    bump(S.speakByRole, rk);
    let hasContent = false;
    const txt = String(text || '');
    if (txt.trim()) {
      hasContent = true;
      const sk = txt.replace(/[0-9０-９]+/g, '#').replace(/\s+/g, ' ').trim();
      bump(S.sentence, sk); S.sentenceN++;
      S.citeSeatN += (txt.match(/[0-9０-９]+\s*号/g) || []).length;
      if (/自称|说自己是/.test(txt)) S.memCiteSaidRole++;
      if (/答应过|一定会|不会带节奏/.test(txt)) S.memCitePromise++;
      if (/一直在.*(站台|带节奏)/.test(txt)) S.memCiteStance++;
      if (/两张脸|不信他|又自称/.test(txt)) S.memCiteConflict++;
    }
    if (!hasContent) { S.speakEmpty++; bump(S.speakEmptyByRole, rk); }
  } catch (e) { bump(S.errMsgs, 'sayStat:' + String(e.message).slice(0, 40)); }
  return r;
};

AI.decide = function (g, req) {
  S.decideCalls++;
  let res;
  try { res = origDecide.call(AI, g, req); } catch (e) { bump(S.errMsgs, 'decide:' + String(e.message).slice(0, 40)); }
  try {
    const p = g.players.find(x => x.id === (req && req.pid));
    if (p) {
      const rk = roleKey(p);
      const kind = String((req && req.kind) || '?');
      const mk = kind + '|' + rk;
      if (!res || !(res.act || (res.targets && res.targets.length) || res.opt)) {
        bump(S.decideEmptyByRole, rk);
      } else {
        S.decideNonEmpty++;
        bump(S.actByRole, mk);
        if (p.faction !== 'human') {
          if (/destroy|破坏/.test(kind)) S.alienDestroy++;
          else if (/kill|刺杀|出刀/.test(kind)) S.alienKill++;
          else if (/infect|感染|转化/.test(kind)) S.alienInfect++;
        } else S.humanSkills++;
      }
    }
  } catch (e) { bump(S.errMsgs, 'decStat:' + String(e.message).slice(0, 40)); }
  return res;
};

const fam = src => {
  const s = String(src || '');
  if (s.indexOf('own:') === 0) return 'own(角色私有)';
  const h = s.split(':')[0] || s;
  if (/^(claim|locksay|excludesay|exp|denyLie|accuse|ask|report|quote|defend|vote)/.test(h)) return 'speech(公开发言)';
  if (/^(verify|check|patrol|guard|mark|repair|antibody|hit|cleared)/.test(h)) return 'own(引擎事件)';
  if (/^(chan|universal|univ)/.test(h)) return 'channel(通道)';
  return h || '(空)';
};

for (let i = 0; i < N; i++) {
  const seed = SEED0 + i;
  try {
    const g = Setup.createGame(seed, 'random');
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    Engine.begin(g);
    let steps = 0;
    while (!g.over && steps < 5000) {
      steps++;
      Engine.stepOnce(g);
      if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
    }
    S.games++;
    bump(S.winner, g.winner || '(none)');
    bump(S.endNight, zone(g.night));
    if (g.extinction) S.extinction++;
    if (g.duel) S.duel++;
    bump(S.phase, g.extinction ? '寂灭' : g.duel ? '决斗' : '常规');

    /* Claim 分布：走 p.outClaims（Bridge.say 的 opts.extra 在 AI 路径上为空，
       Claim 是由 text 经 IR 解析后落到玩家身上的，见 pipeline.js recordEvidence）。 */
    for (const p of g.players) {
      const cl = p.outClaims || [];
      if (!cl.length) continue;
      const fk = p.faction;
      const rk = roleKey(p);
      bump(S.claimByRole, rk);
      for (const c of cl) {
        if (!c) continue;
        bump(S.claimKind, c.kind || '?');
        bump(S.claimKindByFaction[fk] || (S.claimKindByFaction[fk] = {}), c.kind || '?');
        if (c.targets && c.targets.length) S.accuseN += c.targets.length;
        if (c.ask && c.ask.length) S.askN += c.ask.length;
        if (c.report && c.report.length) S.reportN += c.report.length;
        if (c.quote && c.quote.length) S.quoteN += c.quote.length;
      }
    }

    /* 记忆层写入量 */
    let conflict = 0;
    for (const p of g.players) {
      const m = p.mem;
      if (!m) continue;
      if (m.saidRole) S.memSaidRole += m.saidRole.size;
      if (m.promise) S.memPromise += m.promise.size;
      if (m.contradiction) S.memContradiction += m.contradiction.length;
      if (m.stance) S.memStance += m.stance.size;
      if (m.saidRole) for (const [, e] of m.saidRole) if (e && e.conflictWith) conflict++;
    }
    if (conflict > 0) { S.gamesWithConflict++; }

    /* 证据层：按观察者统计 src 家族 */
    for (const p of g.players) {
      if (!p.tEvents) continue;
      const kinds = new Set();
      let mine = 0;
      for (const [, evs] of p.tEvents) {
        for (const e of evs) {
          S.evTotal++;
          mine++;
          bump(S.evBySrcFamily, fam(e.src));
          const f = fam(e.src);
          if (f !== kinds.has(f) && !kinds.has(f)) kinds.add(f);
        }
      }
      const rk = roleKey(p);
      bump(S.evPerViewerKinds, rk + ':' + kinds.size);
    }

    /* 投票层 */
    for (const rec of (g.voteHistory || [])) {
      const src = rec.src || {};
      const ids = Object.keys(src);
      if (!ids.length) continue;
      S.voteRounds++; S.voteSeats += ids.length;
      const tally = {};
      for (const v of ids) { const t = src[v]; if (t == null) continue; tally[t] = (tally[t] || 0) + 1; }
      const tot = Object.values(tally).reduce((a, b) => a + b, 0);
      if (tot) {
        S.distinctSum += Object.keys(tally).length;
        S.maxShareSum += Math.max(...Object.values(tally)) / tot;
        if (Object.keys(tally).length === 1) S.unanimous++;
      }
      for (const v of ids) {
        const t = src[v];
        if (t == null) continue;
        const vp = g.players.find(x => x.id === Number(v));
        const tp = g.players.find(x => x.id === t);
        if (!vp || !tp) continue;
        const rk = roleKey(vp);
        const hostile = tp.faction === 'alien' || tp.faction === 'xeno';
        if (!S.voteByRole[rk]) S.voteByRole[rk] = { n: 0, hit: 0, ally: 0 };
        const rec2 = S.voteByRole[rk];
        rec2.n++;
        if (vp.faction === 'human') {
          S.humanVoteN++;
          if (hostile) { S.humanVoteHit++; rec2.hit++; }
        } else {
          S.alienVoteN++;
          if (vp.faction === 'human') S.alienVoteHuman++;
          if (vp.faction === tp.faction) { S.alienVoteAlly++; rec2.ally++; }
        }
      }
    }
  } catch (e) {
    S.errs++; bump(S.errMsgs, 'game:' + String(e.message).slice(0, 50));
  }
}

Bridge.say = origSay;
AI.decide = origDecide;

/* ── 战术库死条目（一次性抽样，非每局）── */
try {
  let dead = 0, tot = 0;
  const ids = {};
  for (let s = SEED0; s < SEED0 + 30; s++) {
    const g = Setup.createGame(s, 'random');
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    Engine.begin(g);
    let k = 0;
    while (!g.over && k < 900) {
      k++; Engine.stepOnce(g);
      if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
      if (Tactics && Tactics.pickTactic) {
        try {
          const p = g.players.find(x => !x.out);
          if (p) {
            const t = Tactics.pickTactic(g, p);
            if (t) {
              tot++;
              const txt = t.text || t.speak || t.line || '';
              const act = t.act || t.target != null || t.opt;
              if (!String(txt).trim() && !act) { dead++; bump(ids, t.id || '?'); }
            }
          }
        } catch (e) { }
      }
    }
  }
  S.tacticCalls = tot; S.tacticDead = dead; S.tacticDeadIds = ids;
} catch (e) { }

const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
const pc = (a, b) => (b ? (100 * a / b).toFixed(1) : '0.0') + '%';

/* 采集有效性守卫：某一组计数器若全程为 0，说明钩子/参数没匹配上，
   此时报 'notCollected' 而不是 0 —— 0 与「没采到」是两件事，不能混。 */
const nc = v => (v ? v : 'notCollected');

const R = {
  meta: { ROOT, N, SEED0, games: S.games, errs: S.errs, errMsgs: S.errMsgs },
  outcome: {
    winner: S.winner, endNight: S.endNight,
    extinction: S.extinction, duel: S.duel,
    humanWin: pc(S.winner.human || 0, S.games),
    alienWin: pc(S.winner.alien || 0, S.games),
    xenoWin: pc(S.winner.xeno || 0, S.games),
  },
  speech: {
    calls: S.speak, empty: S.speakEmpty, emptyPct: pc(S.speakEmpty, S.speak),
    claimKind: S.claimKind,
    claimKindByFaction: S.claimKindByFaction,
    claimByRole: S.claimByRole,
    sentences: S.sentenceN, unique: Object.keys(S.sentence).length,
    diversity: pc(Object.keys(S.sentence).length, S.sentenceN),
    topSentences: top(S.sentence, 12),
    speakByRole: S.speakByRole,
    emptyByRole: S.speakEmptyByRole,
    accuseN: S.accuseN, askN: nc(S.askN), reportN: nc(S.reportN), quoteN: nc(S.quoteN),
    citeSeatN: S.citeSeatN,
  },
  reasoning: {
    note: 'AI.reasoningChain 钩子无效（decide.js:262 调模块内局部函数），该计数器已作废；',
    note2: '以下为可观测替代量：记忆写入量 vs 发言中的引用量。',
    memSaidRole: S.memSaidRole, memPromise: S.memPromise,
    memContradiction: S.memContradiction, memStance: S.memStance,
    citeSaidRole: S.memCiteSaidRole, citePromise: S.memCitePromise,
    citeStance: S.memCiteStance, citeConflict: S.memCiteConflict,
    gamesWithConflict: S.gamesWithConflict,
  },
  evidence: {
    total: S.evTotal, bySrcFamily: S.evBySrcFamily,
    kindsByRole: S.evPerViewerKinds,
  },
  action: {
    note: 'alienDestroy/Kill/Infect 与 tactic* 的抽取依赖 req.kind 字面量与 pickTactic 签名，',
    note2: '本次未匹配上（返回 0）⇒ 按采集有效性守卫报 notCollected，勿读作「异形不出手」。',
    note3: '异形实际出手量请用 tools/ab-actions.cjs（已验证：异形每局 6.93 次击杀决策）。',
    calls: S.decideCalls, nonEmpty: S.decideNonEmpty,
    emptyByRole: S.decideEmptyByRole,
    alienDestroy: nc(S.alienDestroy), alienKill: nc(S.alienKill), alienInfect: nc(S.alienInfect),
    humanSkills: S.humanSkills,
    tacticCalls: nc(S.tacticCalls), tacticDead: nc(S.tacticDead),
    tacticDeadPct: S.tacticCalls ? pc(S.tacticDead, S.tacticCalls) : 'notCollected',
    tacticDeadIds: Object.keys(S.tacticDeadIds).length ? S.tacticDeadIds : 'notCollected',
  },
  vote: {
    rounds: S.voteRounds, seats: S.voteSeats,
    distinctPerRound: (S.distinctSum / (S.voteRounds || 1)).toFixed(2),
    maxShare: pc(S.maxShareSum, S.voteRounds),
    unanimousPct: pc(S.unanimous, S.voteRounds),
    humanHitPct: pc(S.humanVoteHit, S.humanVoteN),
    humanVoteN: S.humanVoteN,
    alienVoteHumanPct: pc(S.alienVoteHuman, S.alienVoteN),
    alienVoteAllyPct: pc(S.alienVoteAlly, S.alienVoteN),
    byRole: S.voteByRole,
  },
};

if (OUT) fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
console.log(JSON.stringify(R, null, 1));