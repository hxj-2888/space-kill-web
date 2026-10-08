'use strict';
/* 逐条核对交接文档里的数字与落盘产物是否一致。
 * 治理铁律：每个报出的数字都必须能被独立探针复现 —— 所以先核对产物，再谈文档。
 * 锚点全用 ASCII，数字全从产物读，不从文档反推。
 */
const fs = require('fs');
const ROOT = (process.argv[2] || process.cwd()).replace(/[\\/]+$/, '') + '/';
const doc = fs.readFileSync(ROOT + 'docs/v7_交接文档_20261008.md', 'utf8');
const rd = f => JSON.parse(fs.readFileSync(ROOT + 'tools/' + f, 'utf8'));
const C = rd('handover-calib-1-120.json'), V = rd('handover-valid-121-240.json'), R = rd('handover-report-241-500.json');
const D = rd('alien-destroy-rate-241-500.json');

const ck = [];
const add = (n, ok) => ck.push([n, !!ok]);

/* ── 规模与健康度 ── */
add('校准 120 局 / 0 异常 / 20099 步 / 27788 检查',
  C.meta.games === 120 && C.meta.errs === 0 && C.meta.steps === 20099 && C.invariants.reqFormChecked === 27788);
add('验证 120 局 / 0 异常 / 19688 步 / 27524 检查',
  V.meta.games === 120 && V.meta.errs === 0 && V.meta.steps === 19688 && V.invariants.reqFormChecked === 27524);
add('报数 260 局 / 0 异常 / 40863 步 / 57465 检查',
  R.meta.games === 260 && R.meta.errs === 0 && R.meta.steps === 40863 && R.invariants.reqFormChecked === 57465);
add('三区未终局均为 0',
  C.meta.unfinished === 0 && V.meta.unfinished === 0 && R.meta.unfinished === 0);
add('req↔form 分叉合计 0',
  C.invariants.reqFormMismatch.length + V.invariants.reqFormMismatch.length + R.invariants.reqFormMismatch.length === 0);
add('req↔form 检查合计 112777',
  C.invariants.reqFormChecked + V.invariants.reqFormChecked + R.invariants.reqFormChecked === 112777);
add('toDecision 三区均无缺失',
  [C, V, R].every(r => r.invariants.toDecisionMissing.length === 0));

/* ── 自证 ── */
add('校准自证 20099/0/0 且 8/0',
  C.invariants.reqPurity.checked === 20099 && C.invariants.reqPurity.unstable === 0
  && C.invariants.reqPurity.mutated === 0 && C.invariants.rngNeutrality.compared === 8
  && C.invariants.rngNeutrality.mismatches === 0);
add('验证自证 19688/0/0 且 8/0',
  V.invariants.reqPurity.checked === 19688 && V.invariants.reqPurity.unstable === 0
  && V.invariants.reqPurity.mutated === 0 && V.invariants.rngNeutrality.compared === 8
  && V.invariants.rngNeutrality.mismatches === 0);
add('报数自证 40863/0/0 且 8/0',
  R.invariants.reqPurity.checked === 40863 && R.invariants.reqPurity.unstable === 0
  && R.invariants.reqPurity.mutated === 0 && R.invariants.rngNeutrality.compared === 8
  && R.invariants.rngNeutrality.mismatches === 0);

/* ── 结局 ── */
add('校准 70.8/18.3/10.8',
  C.outcome.humanWinPct === 70.8 && C.outcome.alienWinPct === 18.3 && C.outcome.xenoWinPct === 10.8);
add('验证 70.0/15.8/14.2',
  V.outcome.humanWinPct === 70 && V.outcome.alienWinPct === 15.8 && V.outcome.xenoWinPct === 14.2);
add('报数 68.8/20.4/10.8',
  R.outcome.humanWinPct === 68.8 && R.outcome.alienWinPct === 20.4 && R.outcome.xenoWinPct === 10.8);
add('三区未定均 0%', [C, V, R].every(r => r.outcome.unresolvedPct === 0));

/* ── 裁定② ── */
const w = R.ruling2_crewWindow;
add('报数 step2 派发 3800', w.step2Dispatch === 3800);
add('报数 crewRepair 派发 1542', w.crewRepairDispatch === 1542);
add('报数 crewRepair 提交 1542', w.repairDecisions === 1542);
add('报数 非法档 0 / 残留 0', w.illegalTier === 0 && w.residualAfterSettle === 0);
const T = w.tierHistogram;
add('档值 7 档', Object.keys(T).length === 7);
add('档值 0.20×37', T['0.20'] === 37);
add('档值 0.25×32', T['0.25'] === 32);
add('档值 0.30×127', T['0.30'] === 127);
add('档值 0.35×64', T['0.35'] === 64);
add('档值 0.40×82', T['0.40'] === 82);
add('档值 0.45×118', T['0.45'] === 118);
add('档值 0.50×657', T['0.50'] === 657);
add('档值全落在 [0.20,0.50]',
  Object.keys(T).every(k => +k >= 0.2 - 1e-9 && +k <= 0.5 + 1e-9));

/* ── 裁定③（独立探针产物） ── */
add('破坏 63 / 2866', D.tally.destroy === 63 && D.branchDecisions === 2866);
add('破坏率 2.2%', D.share.destroy === '2.2%' && Math.abs(100 * D.tally.destroy / D.branchDecisions - 2.2) < 0.05);
add('结茧 534 = 18.6%', D.tally.cocoon === 534 && D.share.cocoon === '18.6%');
add('无动作 79.2%', D.share.none === '79.2%');
add('结茧:破坏 = 8.48', D.ratioCocoonToDestroy === '8.48');
add('260 局里 37 局见破坏', D.games === 260 && D.gamesWithDestroy === 37);

/* ── voice ── */
add('报数 voice 命中率 55.8%',
  Math.abs(100 * R.voice.thoughtHit / R.voice.thoughtCalls - 55.8) < 0.05);
add('异形队友宣称 0', R.voice.alienTeammateClaim === 0);

/* ── 覆盖率 ── */
add('报数 运行时面 170 / 触达 156 / 死面 14',
  R.coverage.runtimeSurfaces === 170 && R.coverage.runtimeTouched === 156 && R.coverage.deadCount === 14);
add('触达率 91.8%', Math.abs(100 * R.coverage.runtimeTouched / R.coverage.runtimeSurfaces - 91.8) < 0.05);
add('校准 167/153/14', C.coverage.runtimeSurfaces === 167 && C.coverage.runtimeTouched === 153 && C.coverage.deadCount === 14);
add('验证 167/153/14', V.coverage.runtimeSurfaces === 167 && V.coverage.runtimeTouched === 153 && V.coverage.deadCount === 14);
add('三区死面清单相同',
  JSON.stringify(C.coverage.dead) === JSON.stringify(R.coverage.dead)
  && JSON.stringify(V.coverage.dead) === JSON.stringify(R.coverage.dead));
add('死面 14 项含 4 个真候选',
  ['slot:crew@0.6', 'slot:sheriff@2', 'slot:xeno@5', 'slot:xeno@8'].every(k => R.coverage.dead.includes(k)));
add('死面含 8 个未上场 + 2 个 D-report',
  R.coverage.dead.filter(k => /hunter@|artisan@|poisoner@|convict@|listener@/.test(k)).length === 8
  && R.coverage.dead.filter(k => /^stepfn:D-report/.test(k)).length === 2);

/* ── 文档自身的健康度 ── */
add('文档无 U+FFFD', (doc.match(/\uFFFD/g) || []).length === 0);
add('文档引用 tools/ 下的文件全部存在',
  [...new Set(doc.match(/tools\/[A-Za-z0-9._-]+/g) || [])]
    .filter(t => /\.(cjs|json)$/.test(t))
    .every(t => fs.existsSync(ROOT + t)));
add('文档不再声称「变体从未生效」（已纠正）',
  !/席位变体从未生效/.test(doc) && /本地\/UI 对局 \| \*\*是\*\*/.test(doc));
add('文档记录了云端不掷变体', /云端对局 \| \*\*否\*\*/.test(doc));
add('文档写明不要改 createGame 默认值', /不要\*\*改成/.test(doc));
add('文档含探针自证一节', /观测会扰动随机流/.test(doc));
add('文档含代表性推演轨迹', /crewRepair=0\.3/.test(doc));

let bad = 0;
ck.forEach(([n, ok]) => { if (!ok) bad++; console.log('  ' + (ok ? 'OK  ' : 'BAD ') + n); });
console.log('');
console.log('  核对项 ' + ck.length + '　不一致 ' + bad);
process.exit(bad ? 1 : 0);