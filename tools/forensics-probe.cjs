/* ============================================================================
 * 太空杀 · AI 法医探针（forensics probe）—— 第二层，取证「夜间行动与机制层」
 * ----------------------------------------------------------------------------
 * judge-probe 审的是【发言与投票】；本探针审【夜间行动 / 职业履职 / 机制接线】。
 * 立场：AI 要按真人标准履职——该开枪就开枪、该破坏就破坏、该救就救、
 *      神探要出结果、异形要清除威胁。凡"整局零产出"者，一律记为渎职。
 *
 * 只读：不修改任何游戏文件。
 * 用法：node forensics-probe.cjs <项目根> [局数]
 * ==========================================================================*/
'use strict';
const path = require('path');
const ROOT = process.argv[2];
const N = +(process.argv[3] || 200);
const { makeCtx, loadInto, profiles } = require(path.join(ROOT, 'tools', 'load-order.cjs'));
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { AI, Engine, Setup, MoE, Tiers, SKData, Tactics } = ctx;

const out = [];
const line = (s) => { out.push(String(s)); };

/* ============================ 取证容器 ============================ */
const R = {
  decideKinds: {},          // 每种 decide kind 被请求的次数
  decidedKinds: {},         // 其中真正产生了动作的次数（按返回值的非平凡字段判定）
  sabDecide: 0, sabGo: 0,   // 破坏决策 / 真正破坏
  net10MovedGames: 0,       // 净破坏量发生变化的局数
  stopNightGames: 0,        // 出现停转夜的局数
  extGames: 0,              // 出现 9.0 停摆的局
  kill: 0, killOnAlly: 0, killOnKeyRole: 0, killTargetIds: {},
  shoot: 0, shootHit: 0, shootEmpty: 0,
  guard: 0,
  doctorAct: { cure: 0, rescue: 0, brew: 0, treat: 0 },
  infectionEver: 0, infectGames: 0,
  detectiveCheck: 0, detectivePublish: 0,
  crewCheck: 0, crewSubmit: 0,
  patrol: 0, sheriffDeadBeforePatrol: 0,
  promiseSettle: { hit: 0, miss: 0, void: 0 },
  sabEval: [],
  roundTotal: 0, roundWithSab: 0, roundWithKill: 0,
  keyRoleKilled: [], aliveAtEnd: {},
  windowsZero: 0, windowsTotal: 0,
  detZeroGames: 0, sheriffGames: 0, sheriffShotGames: 0, sheriffAmmoStarved: 0,
  keyRoleStreakDeath: 0, meetingsNoInfo: 0,
  revealAnnounce: 0,
  // 每局汇总
  perGame: [],
};

/* ---------------- 包住 AI.decide：全量记录夜间行动 ---------------- */
const KINDS = new Set();
const origDecide = AI.decide;
let CUR = null;   // 当前局

function nonTrivial(kind, d) {
  if (!d || typeof d !== 'object') return false;
  for (const k of Object.keys(d)) {
    const v = d[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'num' && v === 0) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (k === 'text' && !String(v).trim()) continue;
    return true;
  }
  return false;
}

AI.decide = function (g, req) {
  const kind = req && req.kind;
  const d = origDecide.apply(this, arguments);
  KINDS.add(kind);
  if (!CUR) return d;
  R.decideKinds[kind] = (R.decideKinds[kind] || 0) + 1;
  const acted = nonTrivial(kind, d);
  if (acted) R.decidedKinds[kind] = (R.decidedKinds[kind] || 0) + 1;

  const p = g.players.find(x => x.id === req.pid);
  if (!p) return d;

  switch (kind) {
    case 'suppress':
      if (d && d.use) { R.suppressAct = (R.suppressAct || 0) + 1; if (CUR) CUR.suppress++; }
      break;
    case 'branch':
      R.sabDecide++;
      if (d && d.branch === 'destroy') { R.sabGo++; if (CUR) CUR.sab++; }
      break;
    case 'alienAct': {
      const act = d && d.act;
      const tgt = d && d.targets && d.targets[0] != null ? d.targets[0] : (d && d.target);
      if (act === 'kill' && tgt != null) {
        R.kill++;
        const tp = g.players.find(x => x.id === tgt);
        if (tp) {
          R.killTargetIds[tgt] = (R.killTargetIds[tgt] || 0) + 1;
          if (tp.faction === 'alien') R.killOnAlly++;
          if (['sheriff', 'engineer', 'assistant', 'detective', 'inspector', 'bodyguard'].includes(tp.role))
            R.killOnKeyRole++;
          if (CUR) { CUR.kills++; if (['sheriff','engineer','detective','inspector'].includes(tp.role)) CUR.killedKey++; }
        }
      }
      if (act === 'infect') { R.infectActs = (R.infectActs || 0) + 1; if (CUR) CUR.infects++; }
      break;
    }
    case 'xenoKill': {
      const tgt = d && (d.target != null ? d.target : (d.targets && d.targets[0]));
      if (tgt != null) {
        R.kill++;
        const tp = g.players.find(x => x.id === tgt);
        if (tp) { if (tp.faction === 'alien' || tp.faction === 'xeno') R.killOnAlly++;
          R.killTargetIds[tgt] = (R.killTargetIds[tgt] || 0) + 1; if (CUR) CUR.kills++; }
      }
      break;
    }
    case 'shoot':
      R.shoot++; if (CUR) CUR.shotReq++;
      if (d && d.opt === 'gather') R.shootGather = (R.shootGather || 0) + 1;
      const st = (d && d.targets) || [];
      if (st.length) { R.shootHit++; if (CUR) CUR.shots += st.length; }
      else R.shootEmpty++;
      break;
    case 'guard':
      R.guard++;
      if (d && d.target != null && CUR) CUR.guards++;
      break;
    case 'doctor':
      R.doctorAct.treat++;
      if (d) {
        const m = d.mode || d.kind || d.doctor;
        const acted = (d.target != null || d.targets && d.targets.length || d.use === true || d.amount != null);
        if (acted) R.doctorAct.act++;
        if (m === 'cure') R.doctorAct.cure++;
        if (m === 'rescue') R.doctorAct.rescue++;
        if (d.opts) R.doctorAct.opts++;
      }
      break;
    case 'craft':
      R.doctorAct.brew++;
      if (d && (d.do || d.use || d.amount != null || d.num != null)) { R.doctorAct.craftAct++; if (CUR) CUR.crafts++; }
      break;
    case 'detective':
      if (d && d.mode === 'announce') { R.detectivePublish++; if (CUR) CUR.detPub++; }
      if (d && d.mode === 'check') R.detectiveCheck++;
      if (CUR && d && d.mode === 'check') CUR.detCheck++;
      break;
    case 'crewAction':
      if (d && d.mode === 'check') { R.crewCheck++; if (CUR) CUR.crewCheck++; }
      if (d && d.mode === 'repair' && CUR) CUR.repairs++;
      break;
    case 'patrol':
      R.patrol++;
      break;
    case 'meeting':
      if (CUR) CUR.meetings++;
      break;
  }
  return d;
};

/* ============================ 跑对局 ============================ */
let errs = 0;
for (let seed = 1; seed <= N; seed++) {
  let g;
  CUR = { seed, sab: 0, kills: 0, killedKey: 0, shots: 0, guards: 0, detCheck: 0, detPub: 0, crewCheck: 0, repairs: 0, meetings: 0,
    net10Min: 99, net10Max: -99, infectedEver: false };
  try {
    g = Setup.createGame(seed, 'random');
    g.humans = []; g.humanId = -1; for (const p of g.players) p.isHuman = false;
    Engine.begin(g);
    let steps = 0;
    while (!g.over && steps < 5000) {
      steps++;
      Engine.stepOnce(g);
      if (g.pending) { try { Engine.submit(g, { opt: null, targets: [], num: null, text: '' }); } catch (e) {} }
      if (typeof g.net10 === 'number') { CUR.net10Min = Math.min(CUR.net10Min, g.net10); CUR.net10Max = Math.max(CUR.net10Max, g.net10); }
      if (g.infectedDeaths > 0 || g.players.some(p => p.infection && p.infection.real)) CUR.infectedEver = true;
    }
    const win = g.winner || (g.over ? 'unknown' : 'timeout');
    R.perGame.push({ seed, win, sab: CUR.sab, kills: CUR.kills, killedKey: CUR.killedKey, shots: CUR.shots,
      guards: CUR.guards, shotReq: CUR.shotReq, shotGame: CUR.shotReq > 0, detCheck: CUR.detCheck, detPub: CUR.detPub, crewCheck: CUR.crewCheck, repairs: CUR.repairs,
      meetings: CUR.meetings, netMin: CUR.net10Min, netMax: CUR.net10Max, nights: g.night,
      inf: CUR.infectedEver, stopNight: !!g.stopNight });
    if (CUR.net10Max > 0) R.net10MovedGames++;
    if (CUR.sab > 0) R.roundWithSab++;
    if (CUR.kills > 0) R.roundWithKill++;
    if (CUR.infectedEver) R.infectGames++;
    if (g.stopNight) R.stopNightGames++;
    if (g.extinction) R.extGames++;
  } catch (e) { errs++; }
  // 承诺结算
  try { if (g && g._promiseSettle) { for (const k of ['hit','miss','void']) R.promiseSettle[k] += (g._promiseSettle[k] ? Object.keys(g._promiseSettle[k]).length : 0); } } catch (e) {}
  if (g && g._sabEval) R.sabEval.push.apply(R.sabEval, g._sabEval);
}

/* ============================ 报告 ============================ */
line('╔══════════════════════════════════════════════════════════════════╗');
line('║      太空杀 · AI 法医探针（夜间行动 / 职业履职 / 机制接线）           ║');
line('╚══════════════════════════════════════════════════════════════════╝');
line(`局数：${N}　对局异常：${errs}`);

const G = R.perGame.length || 1;
const pct = (a) => (100 * a / G).toFixed(1) + '%';

line('\n════ 一、破坏线（核心紧张轴）════');
line(`  异形破坏决策 ${R.sabDecide} 次，其中真正破坏 ${R.sabGo} 次 (${R.sabGo ? (100 * R.sabGo / R.sabDecide).toFixed(1) : 0}%)`);
line(`  有任何破坏的局：${R.roundWithSab} / ${G} = ${pct(R.roundWithSab)}`);
line(`  净破坏量 net10 曾上升的局：${R.net10MovedGames} / ${G} = ${pct(R.net10MovedGames)}`);
line(`  出现停转夜的局：${R.stopNightGames} / ${G} = ${pct(R.stopNightGames)}`);
line(`  出现 9.0 停摆/寂灭的局：${R.extGames} / ${G} = ${pct(R.extGames)}`);
const avgNetSpan = R.perGame.reduce((a, x) => a + (Math.max(0, x.netMax - x.netMin)), 0) / G;
line(`  每局净破坏量跨度(0~net10max) 平均 = ${avgNetSpan.toFixed(2)}`);
if (R.sabEval.length) {
  const g2 = R.sabEval.filter(x => x.go), g0 = R.sabEval.filter(x => !x.go);
  line(`  _sabEval 样本 ${R.sabEval.length}：破坏 ${g2.length} / 不破坏 ${g0.length}`);
  const avg = (arr, k) => arr.length ? (arr.reduce((a, x) => a + (x[k] || 0), 0) / arr.length) : NaN;
  line(`    破坏组  uDestroy=${avg(g2,'uDestroy').toFixed(1)} uAct=${avg(g2,'uAct').toFixed(1)} pressure=${avg(g2,'pressure').toFixed(2)} repairKnown=${avg(g2,'repairKnown').toFixed(1)}`);
  line(`    不破坏组 uDestroy=${avg(g0,'uDestroy').toFixed(1)} uAct=${avg(g0,'uAct').toFixed(1)} pressure=${avg(g0,'pressure').toFixed(2)} repairKnown=${avg(g0,'repairKnown').toFixed(1)}`);
}

line('\n════ 二、击杀瞄准（异形是否清除威胁）════');
line(`  击杀总数 ${R.kill}　砍中自己阵营 ${R.killOnAlly}　砍中关键职位(警长/工程/神探/验票/保镖) ${R.killOnKeyRole}`);
const kt = Object.entries(R.killTargetIds).sort((a,b)=>b[1]-a[1]).slice(0,8);
line(`  热门目标：${kt.map(([k,v])=>k+'号×'+v).join('  ')}`);

line('\n════ 三、职业履职（每局平均次数）════');
const per = (k) => (R.perGame.reduce((a, x) => a + (x[k] || 0), 0) / G).toFixed(2);
line(`  神探查验 ${per('detCheck')}　神探公告 ${per('detPub')}　船员查验 ${per('crewCheck')}　船员维修 ${per('repairs')}`);
line(`  警长开枪 ${per('shots')}　保镖保护 ${per('guards')}　紧急会议 ${per('meetings')}　击杀 ${per('kills')}`);
const zeroDet = R.perGame.filter(x => x.detCheck === 0 && x.detPub === 0).length;
const zeroMeet = R.perGame.filter(x => x.meetings === 0).length;
line(`  神探零产出(既不查也不公告)的局：${zeroDet} / ${G} = ${pct(zeroDet)}`);
line(`  神探【有查验但零公告】的局：${R.perGame.filter(x => x.detCheck > 0 && x.detPub === 0).length} / ${G}`);
const sheriffGs = R.perGame.filter(x => x.shotGame);
line(`  警长存活的局：${R.shotReqGames || 0}；警长【开过枪】的局：${R.perGame.filter(x => x.shots > 0).length}`);
line(`  警长开枪请求 ${R.shoot} 次：命中目标 ${R.shootHit} 次（空枪/无目标 ${R.shootEmpty}）攒弹 ${R.shootGather || 0}`);
line(`  ⚠ 警长开枪请求不为 0 却【从未开出一枪】的局：${R.perGame.filter(x => x.shotReq > 0 && x.shots === 0).length}`);
const killedKeyG = R.perGame.filter(x => x.killedKey > 0).length;
line(`  异形成功击杀关键职位(警长/工程/神探/验票)的局：${killedKeyG} / ${G} = ${pct(killedKeyG)}`);
line(`  全局零紧急会议的局：${zeroMeet} / ${G} = ${pct(zeroMeet)}`);

line('\n════ 四、治疗/感染/破坏-维修三角════');
line(`  医生行动(总) ${R.doctorAct.treat}　制药 ${R.doctorAct.brew}　救援 ${R.doctorAct.rescue}`);
line(`  出现过真实感染的局：${R.infectGames} / ${G} = ${pct(R.infectGames)}`);
line(`  医生决策 ${R.doctorAct.treat} 次，其中实际出手 ${R.doctorAct.act || 0}（治愈 ${R.doctorAct.cure} / 救援 ${R.doctorAct.rescue}）`);
line(`  制药 craft 决策 ${R.doctorAct.brew} 次，实际出手 ${R.doctorAct.craftAct || 0}`);
line(`  感染抑制 suppress 请求 ${R.decideKinds.suppress || 0} 次，实际使用 ${R.suppressAct || 0}`);
line(`  感染动作(alienAct infect) ${R.infectActs || 0}`);

line('\n════ 五、承诺结算（E7）════');
line(`  hit=${R.promiseSettle.hit}　miss=${R.promiseSettle.miss}　void=${R.promiseSettle.void}`);

line('\n════ 六、decide 分支覆盖（哪些机制真正在跑）════');
const kinds = Object.keys(R.decideKinds).sort();
for (const k of kinds) {
  const req = R.decideKinds[k], act = R.decidedKinds[k] || 0;
  const bar = '█'.repeat(Math.min(30, Math.round(100 * act / Math.max(1, req))));
  line(`  ${String(k).padEnd(14)} 请求 ${String(req).padStart(6)}　产生动作 ${String(act).padStart(6)} (${(100*act/Math.max(1,req)).toFixed(0)}%) ${bar}`);
}
const never = [...KINDS].filter(k => !R.decidedKinds[k] || R.decidedKinds[k] === 0);
if (never.length) line(`  ⚠ 请求过但从未产生任何动作的分支：${never.join(', ')}`);

line('\n════ 七、MoE 机制接线 ════');
try {
  const total = (ctx.Channels && ctx.Channels.CHANNELS) ? ctx.Channels.CHANNELS.length : null;
  const wired = MoE.wiredCount ? MoE.wiredCount() : null;
  line(`  通道总表 ${total}　已挂载 GATE_IMPL ${wired}${total ? ' = ' + (100 * wired / total).toFixed(1) + '%' : ''}`);
  const un = MoE.unmounted ? MoE.unmounted() : [];
  line(`  未挂载 gate：${un.length}`);
} catch (e) { line('  通道口径读取失败：' + e.message); }
const st = MoE.stats;
line(`  仲裁输入组 ${st.arb.n}　多Claim ${st.arb.multi}　同档 ${st.arb.same}　差一档 ${st.arb.gap1}　差两档 ${st.arb.gap2}`);
line(`  影子层 调用 ${st.shadow.calls} 采用 ${st.shadow.applied}`);
line(`  并入账口 rerouted=${JSON.stringify(st.rerouted)}`);
line(`  注意力 调制 ${st.attended} 漏进 ${st.leaked||0} 闸门丢弃 ${st.ignored||0} 缓存截流 ${st.capped||0}`);

line('\n════ 八、终局画像 ════');
const win = {};
for (const g of R.perGame) win[g.win] = (win[g.win] || 0) + 1;
line('  胜负：' + JSON.stringify(win));
const nights = R.perGame.reduce((a,x)=>a+x.nights,0)/G;
line(`  平均夜数 ${nights.toFixed(2)}`);
line('══════════════════════════════════════════════════════════════════');

require('fs').writeFileSync(path.join(__dirname, 'forensics-report.txt'),
  out.join('\n'), 'utf8');
console.log('written: forensics-report.txt');
