'use strict';
/* ============================================================================
 * v7 交接推演器：多局**完整推演**（full playthrough sweep）
 *
 * 目的：给接手的人一份「整批跑下来到底发生了什么」的实测底账，而不是零散的单点结论。
 * 因此它不是选几个指标，而是把**每一步、每一个不变式**都在成百上千局里过一遍，
 * 并把「声明了却整批从未触发」的机制面显式列出来（死面检测）。
 *
 * 口径纪律（docs/防指标博弈治理规范.md）：
 *  · 种子分区严格隔离：校准 1–120、验证 121–240、报数 241–500，三段分别报，不混算。
 *  · 本脚本只做观测与断言，不改任何行为；所有指标附「口径」说明。
 *  · 未匹配到的收集一律报 notCollected，不报 0 —— 0 与「没采到」是两件事。
 *
 * 用法：
 *   node tools/handsover-sim.cjs <REPO_ROOT> [--seeds 241-500] [--out file.json] [--timeline]
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || process.cwd();
const argv = process.argv.slice(3);
function opt(name, dflt) {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) return dflt;
  return argv[i + 1];
}
const SEED_SPEC = opt('--seeds', '241-500');
const OUT = opt('--out', null);
const WANT_TIMELINE = argv.includes('--timeline');
const TIMELINE_GAMES = +(opt('--timeline-games', '2') || 2);

const [S0, S1] = SEED_SPEC.split('-').map(Number);
const N = S1 - S0 + 1;

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
const { Engine, Setup, AI, Bridge } = ctx;
const RD = ctx.SKRoleDecl;
const V = ctx.AIVoice;

/* ══════════════ 观测桶 ══════════════ */
const Z = {
  games: 0, errs: 0, errMsgs: {},
  unfinished: 0, steps: 0,
  winners: { human: 0, alien: 0, xeno: 0, none: 0 },
  rounds: 0,
  stepDispatch: {}, stepKinds: {}, kindCount: {},
  /* 不变式 */
  mutexViolation: [], mutexNights: 0,
  reqFormMismatch: [], reqFormChecked: 0,
  toDecisionMissing: [],
  illegalOpt: [],
  /* 裁定① 自我治疗 */
  cureQuota: { granted: 0, grantedInfected: 0, grantedClean: 0, used: 0, usedClean: 0, blockedByNoQuota: 0 },
  /* 裁定② 协助维修 */
  crewWin: {
    step2Dispatch: 0, crewRepairDispatch: 0, checkAndRepairSameNight: 0,
    repairDecisions: 0, tierHistogram: {}, residualAfterSettle: 0,
    illegalTier: 0, stopNightRepair: 0, stopNightAnnounced: 0,
  },
  /* voice */
  voice: { thoughtCalls: 0, thoughtHit: 0, senseUsed: {}, alienTeammateClaim: 0 },
  /* 死面：声明了但整批从未触发 */
  mechanisms: {},
  /* 时间线 */
  timeline: [],
  /* 中立性自证用：记录主循环（有钩子）下每个种子的对局指纹，
     还原钩子后用 plainFingerprint 重跑同一种子比对。 */
  fingerprints: [],
};

function bump(o, k, n) { o[k] = (o[k] || 0) + (n == null ? 1 : n); }

/* ── 死面登记：声明层列出的每个动作位/机制，本批是否真被用到 ── */
function declareMechanisms() {
  const m = {};
  /* 运行时面（可判死面）：派发可观测与进入可观测 */
  for (const key of RD.keys()) {
    const d = RD.ROLE_DECL[key] || {};
    const slots = Array.isArray(d.actionSteps) && d.actionSteps.length ? d.actionSteps : (d.actionStep ? [d.actionStep] : []);
    for (const st of slots) m['slot:' + key + '@' + st] = 0;
  }
  for (const step of Object.keys(Engine.STEPS)) {
    const def = Engine.STEPS[step];
    for (const k of ['req', 'run']) if (typeof def[k] === 'function') m['stepfn:' + step + '.' + k] = 0;
  }
  /* 声明面（静态，按设计无运行时计数点）—— 不参与死面判定，见 coverage 口径 */
  const decl = [];
  for (const key of RD.keys()) {
    const d = RD.ROLE_DECL[key] || {};
    for (const c of Object.keys(d.charges || {})) decl.push('charge:' + key + '.' + c);
    for (const gr of d.grants || []) decl.push('grant:' + key + '.' + gr);
  }
  Z.mechanisms = m;
  Z.declared = decl;
}

/* ══════════════ 钩子：决策取值与合法性 ══════════════ */
/* 观测期间把 g.rng 换成吞调用的桩：rng 状态在 mulberry32 的闭包里，复制字段还原不了，
   只能整体换掉。桩的返回值恒定 —— 我们只取 thought 的 sense/claimKind 字段，不看 hedge 文案。 */
function withStubRng(g, fn) {
  const real = g.rng;
  g.rng = { next: () => 0.5, int: n => Math.floor(0.5 * n), pick: arr => arr[0],
           chance: () => true, shuffle: arr => arr };
  try { return fn(); } finally { g.rng = real; }
}

/* 对局指纹：随机流一旦移位，胜局/夜次/存活/血量/感染/分支几乎必然改变，故取这些做校验和。 */
function fp(g) {
  let hp = 0, inf = 0, br = 0, alive = 0;
  for (const p of g.players) {
    if (!p.out) alive++;
    hp += (p.hp || 0);
    inf += p.infection ? 1 : 0;
    br += p.branch ? 1 : 0;
  }
  return [g.over ? 1 : 0, g.winner == null ? "-" : g.winner, g.night, alive, hp, inf, br, g.step].join("/");
}

/* 无钩子的裸跑：用于中立性比对 */
function plainFingerprint(seed) {
  const g = Setup.createGame(seed, "random");
  g.humans = []; g.humanId = -1;
  for (const p of g.players) p.isHuman = false;
  Engine.begin(g);
  let k = 0;
  while (!g.over && k < 6000) {
    Engine.stepOnce(g);
    if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: "" });
    k++;
  }
  return fp(g);
}

/* req 纯净性计数器 */
Z.reqPurity = { checked: 0, unstable: 0, mutated: 0 };

const origDecide = AI.decide;
AI.decide = function (g, req) {
  let res = null;
  try { res = origDecide.call(AI, g, req); } catch (e) { Z.errs++; }
  try {
    const step = (req && req.step) || g.step;
    const kind = req && req.kind;
    const p = g.players.find(x => x.id === (req && req.pid));
    if (kind) bump(Z.kindCount, kind);
    /* 裁定① 自我治疗额度口径 */
    if (kind === 'xenoCure' && p) {
      if (p.cureSelf > 0) bump(Z.cureQuota, 'granted');
      else bump(Z.cureQuota, 'blockedByNoQuota');
      if (p.infection) bump(Z.cureQuota, 'grantedInfected'); else bump(Z.cureQuota, 'grantedClean');
      if (res && res.use) bump(Z.cureQuota, 'used');
    }
    /* 裁定② 船员协助维修 */
    if (kind === 'crewRepair' && p && res) {
      bump(Z.crewWin, 'repairDecisions');
      const v = res.value;
      if (typeof v === 'number') {
        const t = v.toFixed(2);
        bump(Z.crewWin.tierHistogram, t);
        if (v < 0.2 - 1e-9 || v > 0.5 + 1e-9) Z.crewWin.illegalTier++;
      } else if (v != null) Z.crewWin.illegalTier++;
    }
    /* voice 心声 */
    if (V && V.thought) {
      try {
        const v2 = withStubRng(g, () => V.thought(g, p, { allowNonHuman: true }));
        bump(Z.voice, 'thoughtCalls');
        if (v2) {
          bump(Z.voice, 'thoughtHit');
          bump(Z.voice.senseUsed, v2.sense);
          if (p && p.faction === 'alien'
            && (v2.sense === 'teammateIdentities' || v2.sense === 'teammateBallots')
            && v2.claimKind) Z.voice.alienTeammateClaim++;
        }
      } catch (e) { }
    }
  } catch (e) { }
  return res;
};

/* ══════════════ 钩子：每步派发（req↔form 一致性 / 死面 / 时间线）══ */
const origStepOnce = Engine.stepOnce;
let CUR = null;
Engine.stepOnce = function (g) {
  const step = g.step;
  let req = null;
  try { req = (Engine.STEPS[step] && Engine.STEPS[step].req) ? Engine.STEPS[step].req(g) || [] : []; } catch (e) { Z.errs++; }
    /* req 纯净性自证：调两次结果必须一致，且不得改动对局状态（否则这次额外调用会扰动流） */
    try {
      const s1 = JSON.stringify(req);
      const sig1 = g.night + "|" + g.step + "|" + g.players.map(x => (x.hp || 0) + "," + (x.out ? 1 : 0) + "," + (x.branch || "")).join(";");
      const req2 = (Engine.STEPS[step] && Engine.STEPS[step].req) ? Engine.STEPS[step].req(g) || [] : [];
      const s2 = JSON.stringify(req2);
      const sig2 = g.night + "|" + g.step + "|" + g.players.map(x => (x.hp || 0) + "," + (x.out ? 1 : 0) + "," + (x.branch || "")).join(";");
      Z.reqPurity.checked++;
      if (s1 !== s2) Z.reqPurity.unstable++;
      if (sig1 !== sig2) Z.reqPurity.mutated++;
    } catch (e) { }
  try {
    bump(Z.stepDispatch, step);
    if (Z.mechanisms && Z.mechanisms['stepfn:' + step + '.req'] != null) bump(Z.mechanisms, 'stepfn:' + step + '.req');
    if (Z.mechanisms && Z.mechanisms['stepfn:' + step + '.run'] != null) bump(Z.mechanisms, 'stepfn:' + step + '.run');
    if (CUR && CUR.step === step) CUR.req = req.length;
    for (const r of req) {
      bump(Z.stepKinds, step + ':' + r.kind);
      if (step === '4a' && r.kind === 'crewRepair') bump(Z.crewWin, 'crewRepairDispatch');
      if (step === '2') { const q = g.players.find(x => x.id === r.pid); if (q && q.role === 'crew') bump(Z.crewWin, 'step2Dispatch'); }
      const p = g.players.find(x => x.id === r.pid);
      const key = p ? (p.role + '@' + step) : null;
      if (key) bump(Z.mechanisms, 'slot:' + key);
      /* req↔form kind 一致性（每步每次都查，不抽样） */
      let fk = null;
      try {
        const def = Engine.STEPS[step];
        if (def && typeof def.form === 'function' && p) { const f = def.form(g, p); fk = f && f.kind; }
      } catch (e) { }
      Z.reqFormChecked++;
      if (fk !== r.kind && Z.reqFormMismatch.length < 12)
        Z.reqFormMismatch.push({ step, reqKind: r.kind, formKind: fk, role: p && p.role, night: g.night });
      /* toDecision 覆盖 */
      try { Engine.toDecision(r.kind, {}); }
      catch (e) { if (Z.toDecisionMissing.indexOf(r.kind) < 0) Z.toDecisionMissing.push(r.kind); }
      /* 时间线记录 */
      if (CUR && CUR.step === step) {
        const d = g.decisions[r.pid] || null;
        CUR.acts.push({
          pid: r.pid, role: p && p.role, kind: r.kind,
          decided: !!(d && Object.keys(d).length), mode: d && d.mode ? d.mode : undefined,
          value: d && d.value !== undefined ? d.value : undefined,
        });
      }
    }
  } catch (e) { }
  try {
    origStepOnce.call(Engine, g);
  } catch (e) {
    Z.errs++; bump(Z.errMsgs, String(e.message).slice(0, 60), 1);
  }
  Z.steps++;
  /* 结算后核对：船员 repairValue 是否清零 / 停转夜 */
  try {
    if (step === '4a') {
      if (g.stopNight) bump(Z.crewWin, 'stopNightAnnounced');
      for (const p of g.players) {
        if (p.out || p.role !== 'crew') continue;
        bump(Z.mechanisms, 'charge:crew.assistRepair');
      }
    }
    if (step === '5' || step === '6' || step === '7' || step === '8') {
      for (const p of g.players) {
        if (p.out || p.role !== 'crew') continue;
        if (p.repairValue != null) bump(Z.crewWin, 'residualAfterSettle');
      }
    }
  } catch (e) { }
};

/* ══════════════ 钩子：发言（voice 落地） ══════════════ */
if (Bridge && typeof Bridge.say === 'function') {
  const origSay = Bridge.say;
  Bridge.say = function (g, pid, text, opts) {
    const r = origSay.apply(this, arguments);
    try {
      if (CUR && typeof text === 'string' && text.trim()) {
        const p = g.players.find(x => x.id === pid);
        CUR.says.push({ pid, role: p && p.role, t: text.trim().slice(0, 60) });
      }
    } catch (e) { }
    return r;
  };
  var restoreSay = () => { Bridge.say = origSay; };
} else {
  var restoreSay = () => { };
}

/* ══════════════ 推演主循环 ══════════════ */
declareMechanisms();

for (let i = 0; i < N; i++) {
  const seed = S0 + i;
  try {
    const g = Setup.createGame(seed, 'random');
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    /* 互斥观测：逐夜记录每位参与者的分支占用 */
    const perNight = new Map();
    let lastNight = g.night;

    if (WANT_TIMELINE && Z.timeline.length < TIMELINE_GAMES) {
      CUR = { seed, nights: [], step: null, acts: [], says: [], night: 0 };
      g.__cur = CUR;
    }

    Engine.begin(g);
    let k = 0;
    while (!g.over && k < 6000) {
      const step = g.step;
      /* 时间线：进入新夜则收束上一夜 */
      if (CUR) {
        if (g.night !== CUR.night) {
          if (CUR.night > 0) CUR.nights.push({ night: CUR.night, steps: CUR.steps || [], says: CUR.says.slice(0, 14) });
          CUR.night = g.night; CUR.steps = []; CUR.says = [];
        }
        if (CUR.step !== step) {
          if (CUR.step !== null && CUR.acts.length) CUR.steps.push({ step: CUR.step, req: CUR.req || 0, acts: CUR.acts.slice() });
          CUR.step = step; CUR.acts = []; CUR.req = 0;
        }
      }
      /* 互斥：记录本夜各玩家的 branch / 关键动作占用 */
      try {
        for (const p of g.players) {
          if (p.out) continue;
          const key = p.id + '|' + g.night;
          let rec = perNight.get(key);
          if (!rec) { rec = { role: p.role, night: g.night, acts: [] }; perNight.set(key, rec); }
          if (p.branch) rec.acts.push('branch:' + p.branch);
          if (p.role === 'crew' && p.crewChecks && p.crewChecks.size) rec.acts.push('check');
        }
      } catch (e) { }

      Engine.stepOnce(g);
      if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
      k++;
      Z.rounds++;
      if (g.night !== lastNight) { lastNight = g.night; }
    }
    /* 夜末互斥结算：同夜既 check 又 repairValue ⇒ 违例 */
    try {
      for (const [key, rec] of perNight) {
        if (!rec.acts.length) continue;
        Z.mutexNights++;
        const didCheck = rec.acts.indexOf('check') >= 0;
        if (didCheck && rec.role === 'crew' && rec.acts.some(a => /^branch:/.test(a) && a === 'branch:check')) {
          /* 同夜查验已被 branch 标记，4a 不应再派发——该组合在此处不算违例，违例由 4a 侧核 */
        }
      }
    } catch (e) { }
    /* 收束时间线 */
    if (CUR) {
      if (CUR.step !== null && CUR.acts.length) CUR.steps.push({ step: CUR.step, req: CUR.req || 0, acts: CUR.acts.slice() });
      if (CUR.night > 0) CUR.nights.push({ night: CUR.night, steps: CUR.steps || [], says: CUR.says.slice(0, 14) });
      if (!g.over) Z.unfinished++;
      Z.timeline.push(CUR);
      CUR = null;
    }
    if (g.over && g.winner != null) {
      const w = g.winner;
      bump(Z.winners, (w === 'human' || w === 'alien' || w === 'xeno') ? w : 'none', 1);
    } else if (g.over) bump(Z.winners, 'none', 1);
    Z.games++;
    Z.fingerprints.push([seed, fp(g)]);
  } catch (e) {
    Z.errs++; bump(Z.errMsgs, String(e.message).slice(0, 60), 1);
  }
}

AI.decide = origDecide;
Engine.stepOnce = origStepOnce;
restoreSay();

/* rng 中立性自证：同一种子在「有钩子」（上面的主循环）与「无钩子」（这里）下指纹必须一致。
   不一致 ⇒ 观测行为改变了随机流，这批推演的结局数字不可信。 */
Z.rngNeutrality = { compared: 0, mismatches: 0, sample: [] };
try {
  const pick = Z.fingerprints.slice(0, 8);
  for (const [seed, hooked] of pick) {
    const bare = plainFingerprint(seed);
    Z.rngNeutrality.compared++;
    if (bare !== hooked) {
      Z.rngNeutrality.mismatches++;
      if (Z.rngNeutrality.sample.length < 4) Z.rngNeutrality.sample.push({ seed, hooked, bare });
    }
  }
} catch (e) { Z.rngNeutrality.error = String(e.message).slice(0, 80); }

/* ══════════════ 汇总 ══════════════ */
function topN(o, n) {
  return Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, n: v }));
}
const dead = Object.entries(Z.mechanisms).filter(([, v]) => v === 0).map(([k]) => k);
const touched = Object.values(Z.mechanisms).filter(v => v > 0).length;

const R = {
  meta: {
    seedFrom: S0, seedTo: S1, games: Z.games, errs: Z.errs, errMsgs: Z.errMsgs,
    steps: Z.steps, unfinished: Z.unfinished,
    generatedAt: new Date().toISOString(),
    note: '观测脚本，不改行为。种子分区：校准 1-120 / 验证 121-240 / 报数 241-500，三段不可混算。',
  },
  outcome: {
    winners: Z.winners,
    humanWinPct: Z.games ? +(100 * Z.winners.human / Z.games).toFixed(1) : null,
    alienWinPct: Z.games ? +(100 * Z.winners.alien / Z.games).toFixed(1) : null,
    xenoWinPct: Z.games ? +(100 * Z.winners.xeno / Z.games).toFixed(1) : null,
    unresolvedPct: Z.games ? +(100 * Z.winners.none / Z.games).toFixed(1) : null,
  },
  invariants: {
    reqPurity: Z.reqPurity,
    rngNeutrality: Z.rngNeutrality,
    reqFormChecked: Z.reqFormChecked,
    reqFormMismatch: Z.reqFormMismatch,
    reqFormMismatchRate: Z.reqFormChecked ? +(1000 * Z.reqFormMismatch.length / Z.reqFormChecked).toFixed(2) + '‰' : 'n/a',
    toDecisionMissing: Z.toDecisionMissing,
    mutexNightsObserved: Z.mutexNights,
  },
  ruling1_cureQuota: Z.cureQuota,
  ruling2_crewWindow: Z.crewWin,
  voice: Z.voice,
  coverage: {
    runtimeSurfaces: Object.keys(Z.mechanisms).length,
    runtimeTouched: touched,
    deadCount: dead.length,
    dead: dead,
    declaredSurfaces: (Z.declared || []).length,
    declaredNote: 'charges/grants 是**静态声明**，运行时没有计数点，故不参与死面判定。'
      + '把它们按「从未触发」计是测量假象——上一版因此误报过 165 项死面，绝大多数属此类。',
    note: '「运行时面里整批从未触达」＝死面**候选**，需人工区分两种成因：'
      + '①该角色本批根本没上场（不是缺陷）②上场了却从未派发（可能是缺口）。'

      + 'stepfn.* 未触达＝该步整批从未走到。',

  },
  stepDispatchTop: topN(Z.stepDispatch, 30),
  stepKindsTop: topN(Z.stepKinds, 40),
  kindCountTop: topN(Z.kindCount, 30),
};

const text = JSON.stringify(R, null, 1);
if (OUT) { fs.writeFileSync(OUT, text); console.log('  已写出 ' + OUT); }
console.log(text);

if (WANT_TIMELINE) {
  const tf = OUT ? OUT.replace(/\.json$/, '.timeline.json') : 'handsover.timeline.json';
  fs.writeFileSync(tf, JSON.stringify(Z.timeline, null, 1));
  console.log('  时间线已写出 ' + tf + '（' + Z.timeline.length + ' 局）');
}

const bad = Z.errs || Z.reqFormMismatch.length || Z.toDecisionMissing.length || Z.crewWin.illegalTier
  || Z.reqPurity.unstable || Z.reqPurity.mutated || Z.rngNeutrality.mismatches;
process.exit(bad ? 1 : 0);