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

/* ── 口径闸门（2026-10-08 批次：席位口径接入量测）──
   铁律一/五：指标只读、口径必须写在产物里、报出的数字要能被别人复现。
   这一段核对的不是「数字好不好看」，而是**两套口径有没有被混算**：
   产物必须自带 seatMode，经典产物不许长出变体读数，变体产物不许冒充历史基线。 */
const SV = rd('handover-calib-1-120-variants.json');   // 变体口径·校准区
const SVV = rd('handover-valid-121-240-variants.json'); // 变体口径·验证区
const SVR = rd('handover-report-241-500-variants.json');// 变体口径·报数区
const SDV = rd('alien-destroy-rate-241-500-variants.json');

add('产物带席位口径栏（classic 侧）',
  C.meta.seatMode === 'classic' && V.meta.seatMode === 'classic' && R.meta.seatMode === 'classic');
add('产物带席位口径栏（variants 侧）',
  [SV, SVV, SVR].every(r => r.meta.seatMode === 'variants'));
add('两个口径产物文件名不同（不会互相覆盖）',
  fs.existsSync(ROOT + 'tools/handover-report-241-500.json')
  && fs.existsSync(ROOT + 'tools/handover-report-241-500-variants.json'));
add('变体产物带席位构成普查（证明变体真的掷出来了）',
  [SV, SVV, SVR].every(r => r.meta.seatCensus && typeof r.meta.seatCensus.games === 'number'
    && r.meta.seatCensus.allClassic < r.meta.seatCensus.games));
add('报数区五个变体席位都掷出约 50%',
  (() => {
    const by = SVR.meta.seatCensus.bySeat, n = SVR.meta.games;
    const want = ['sheriff→hunter', 'inspector→listener', 'rescue→poisoner', 'xeno→convict', 'bodyguard→artisan'];
    return want.every(k => by[k] != null && Math.abs(100 * by[k] / n - 50) < 12);
  })());
add('裁定③ 产物带席位口径栏', D.seatMode === 'classic' && SDV.seatMode === 'variants');

/* ── 观测口径自证（§6.5 的延续）：钩位必须对，否则整批读数错位一格 ── */
add('钩位自证：三区 hookMisaligned 均为 0',
  [SV, SVV, SVR].every(r => r.invariants.hookMisaligned === 0));
add('req 纯净性自证：三区 0/0',
  [SV, SVV, SVR].every(r => r.invariants.reqPurity.unstable === 0 && r.invariants.reqPurity.mutated === 0));
add('rng 中立性自证：三区 8/0',
  [SV, SVV, SVR].every(r => r.invariants.rngNeutrality.compared === 8 && r.invariants.rngNeutrality.mismatches === 0));
add('toDecision 覆盖：三区无缺失',
  [SV, SVV, SVR].every(r => r.invariants.toDecisionMissing.length === 0));
add('三区规模与健康度：0 异常 / 0 未终局',
  [SV, SVV, SVR].every(r => r.meta.games > 0 && r.meta.errs === 0 && r.meta.unfinished === 0));

/* ── 变体口径下的死面（§五 的重测）── */
add('变体口径死面仅 2 项', [SV, SVV, SVR].every(r => r.coverage.deadCount === 2));
add('变体口径三区死面清单相同',
  JSON.stringify(SV.coverage.dead) === JSON.stringify(SVR.coverage.dead)
  && JSON.stringify(SVV.coverage.dead) === JSON.stringify(SVR.coverage.dead));
add('变体口径死面 = listener@0.2 + xeno@8',
  SVR.coverage.dead.includes('slot:listener@0.2') && SVR.coverage.dead.includes('slot:xeno@8'));
add('变体口径下旧口径的 4 个假死面全部消失（钩位修正的收益）',
  ['slot:crew@0.6', 'slot:sheriff@2', 'slot:xeno@5', 'slot:listener@D-report']
    .every(k => !SVR.coverage.dead.includes(k)));

/* ── 变体口径下 req↔form 分叉：全部同源于死囚复生（§6.1 已登记）── */
const misAll = [SV, SVV, SVR].flatMap(r => r.invariants.reqFormMismatch);
add('变体口径出现 req↔form 分叉（不得粉饰为 0）', misAll.length > 0);
add('分叉全部是 步骤8 revive→doctor 且 convict=true（同源）',
  misAll.length > 0 && misAll.every(m => m.step === '8' && m.reqKind === 'revive'
    && m.formKind === 'doctor' && m.convict === true));

/* ── 规模与健康度 ──
   ⚠ 2026-10-08 变更（**断言判据修改，理由如下**，铁律三要求单列）：
   `reqFormChecked` 一列的数字变了（27788→30442 / 27524→30150 / 57465→63061），
   原因**不是**被测对象变了，而是观测方式变了 —— 派发观测从「stepOnce 外层读 g.step
   再自己调 req」改成「按步包住 req 本身」。旧口径每次 stepOnce 只记到**上一步**的派发，
   新口径记到本次步（见实施报告 §三）。局数、步数、分叉数、结局三阵营、
   crewRepair 派发数**全部逐位不变**，可证明被测对局同源。
   故此处的判据改为「从产物读数」而非硬编码旧值，并新增 classic↔variants 的
   规模不变量断言（下面），避免同类漂移再次悄悄通过。 */
add('校准 120 局 / 0 异常 / 20099 步',
  C.meta.games === 120 && C.meta.errs === 0 && C.meta.steps === 20099);
add('验证 120 局 / 0 异常 / 19688 步',
  V.meta.games === 120 && V.meta.errs === 0 && V.meta.steps === 19688);
add('报数 260 局 / 0 异常 / 40863 步',
  R.meta.games === 260 && R.meta.errs === 0 && R.meta.steps === 40863);
add('三区未终局均为 0',
  C.meta.unfinished === 0 && V.meta.unfinished === 0 && R.meta.unfinished === 0);
add('req↔form 分叉合计 0（classic 口径）',
  C.invariants.reqFormMismatch.length + V.invariants.reqFormMismatch.length + R.invariants.reqFormMismatch.length === 0);
add('classic 口径三区席位普查全为「无变体」',
  [C, V, R].every(r => r.meta.seatCensus.allClassic === r.meta.seatCensus.games));
add('变体口径步数不少于 classic（变体带来更多行动窗口）',
  SVR.meta.steps >= R.meta.steps && SV.meta.steps >= C.meta.steps && SVV.meta.steps >= V.meta.steps);
add('toDecision 三区均无缺失',
  [C, V, R].every(r => r.invariants.toDecisionMissing.length === 0));

/* ── 自证（classic 侧；变体侧见上文「观测口径自证」段）── */
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
/* step2Dispatch 仍为 3800：船员步骤 2 派发在两种钩位下同源（步骤 2 的 req 在
   beginStep 内被调，外层那次「上一步」的重复调用恰好也是步骤 2 自己，故计数相同）。
   局数/步数/结局不变。 */
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

/* ── 覆盖率（classic 口径；2026-10-08 钩位修正后：运行时面 172 / 触达 161 / 死面 11）──
   死面从 14 降到 11：消失的 3 项（crew@0.6 / sheriff@2 / xeno@5）经实测是**探针读错时点**
   造成的假死面，引擎确实派发（实施报告 §三）。文档 §五 的对应结论需据此更正。 */
add('报数 运行时面 172 / 触达 161 / 死面 11',
  R.coverage.runtimeSurfaces === 172 && R.coverage.runtimeTouched === 161 && R.coverage.deadCount === 11);
add('触达率 93.6%', Math.abs(100 * R.coverage.runtimeTouched / R.coverage.runtimeSurfaces - 93.6) < 0.05);
add('校准 168/157/11', C.coverage.runtimeSurfaces === 168 && C.coverage.runtimeTouched === 157 && C.coverage.deadCount === 11);
add('验证 168/157/11', V.coverage.runtimeSurfaces === 168 && V.coverage.runtimeTouched === 157 && V.coverage.deadCount === 11);
add('三区死面清单相同',
  JSON.stringify(C.coverage.dead) === JSON.stringify(R.coverage.dead)
  && JSON.stringify(V.coverage.dead) === JSON.stringify(R.coverage.dead));
add('死面含 2 个 D-report（窃听报告步，listener 从未上场）',
  R.coverage.dead.filter(k => /^stepfn:D-report/.test(k)).length === 2);
/* 11 项死面逐项归因（不得有「未解释的死面」混过去）：
   10 项由「变体角色在 classic 口径下从未上场」解释（含 2 个 D-report，listener 未上场），
   剩 1 项 xeno@8 = 自我治疗，因 6.5④ 四选一互斥使名额被占 —— 已判定非缺陷。 */
add('classic 口径 11 项死面归因齐备（10 项变体未上场 + 1 项互斥非缺陷）',
  R.coverage.dead.filter(k => /hunter@|artisan@|poisoner@|convict@|listener@|^stepfn:D-report/.test(k)).length === 10
  && R.coverage.dead.includes('slot:xeno@8') && R.coverage.dead.length === 11);

/* ── 文档自身的健康度 ── */
/* ── 文档自身的健康度 ── */
add('文档无 U+FFFD', (doc.match(/\uFFFD/g) || []).length === 0);
add('文档引用 tools/ 下的文件全部存在',
  [...new Set(doc.match(/tools\/[A-Za-z0-9._-]+/g) || [])]
    .filter(t => /\.(cjs|json)$/.test(t))
    .every(t => fs.existsSync(ROOT + t)));
add('文档不再声称「变体从未生效」（已纠正）',
  !/席位变体从未生效/.test(doc) && /本地\/UI 对局 \| \*\*是\*\*/.test(doc));
add('文档记录了云端不掷变体', /云端对局 \| \*\*否\*\*/.test(doc));
add('文档写明不要改 createGame 默认值', /\*\*没有\*\*改成/.test(doc));
add('文档含探针自证一节', /观测会扰动随机流/.test(doc));
add('文档含代表性推演轨迹', /crewRepair=0\.3/.test(doc));
/* 文档必须把 §4.1 的状态从「未修」更新到「已接入量测」，并给出新口径读数 */
add('文档写明席位口径已接入量测', /已接入量测|量测口径闸门|seat-mode/.test(doc));
add('文档记录 seat-mode 单一开关', /seat-mode/.test(doc));
add('文档记录钩位错一格的教训（派发观测必须包住 req 函数本体）',
  /包住 req 函数本体/.test(doc) && /hookMisaligned/.test(doc));
add('文档记录变体口径的新报数（65.4%）', /65\.4/.test(doc));
add('文档记录裁定③ 两口径读数之差（2\.2% → 3\.4%）', /3\.4%/.test(doc));

let bad = 0;
ck.forEach(([n, ok]) => { if (!ok) bad++; console.log('  ' + (ok ? 'OK  ' : 'BAD ') + n); });
console.log('');
console.log('  核对项 ' + ck.length + '　不一致 ' + bad);
process.exit(bad ? 1 : 0);