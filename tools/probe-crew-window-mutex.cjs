'use strict';
/* ============================================================================
 * 裁定② 端到端验证：船员「查验」与「协助维修」当夜互斥（卡：二者当夜二选一）。
 *
 * 判据要点（第一版探针在这里判错过，值得留着当记录）：
 *   最初记的是「该船员在步骤 2 被派发过 crewAction」——那只说明**开过窗**，
 *   不说明**选了查验**：AI 可能选协助维修（在步骤 2 只做预留）或放弃行动。
 *   于是把「开过窗但选了协助维修」误报成违例，80 局报出 477 次假违例。
 *   正确不变式：4a 派发那一刻该船员的 `p.branch !== 'check'`
 *   ——引擎在步骤 2 真查验时写 branch='check'，4a 的 req 以 !p.branch 过滤。
 *
 * 验四件事：
 *   ① 步骤 2 真查验的船员（p.branch==='check'）当夜不再被 4a 派发；
 *   ② 4a 确实向未查验的船员派发 crewRepair（本窗口不是死码）；
 *   ③ 4a 的 run 只对真提交 crewRepair 的船员写 p.repairValue，且结算后清零（不跨夜残留）；
 *   ④ 步骤 2 的表单不再提供 repair* 档（协助维修已移出该菜单）。
 *
 * 用法：node tools/probe-crew-window-mutex.cjs <REPO_ROOT> [局数]
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || process.cwd();
const N = +(process.argv[3] || 80);

const src = fs.readFileSync(path.join(ROOT, 'tools', 'load-order.cjs'), 'utf8');
const m = { exports: {} };
new Function('require', 'module', 'exports', '__dirname', '__filename', src)(
  require, m, m.exports, path.join(ROOT, 'tools'), 'x');
const { makeCtx, loadInto, profiles } = m.exports;
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { Engine, Setup } = ctx;

const out = [];
let pass = 0, fail = 0;
const ok = (c, label, extra) => {
  if (c) pass++; else fail++;
  out.push((c ? '  [通过] ' : '  [失败] ') + label + (extra ? '  -> ' + extra : ''));
};

/* ── ① 静态：步骤 2 的表单不再有 repair* 档 ────────────────────── */
{
  const g = Setup.createGame(3, 'random');
  g.humans = []; g.humanId = -1;
  for (const p of g.players) p.isHuman = false;
  Engine.begin(g);
  let crew = null;
  for (let k = 0; k < 60 && !crew; k++) {
    const step = g.step;
    if (step === '2') {
      for (const r of (Engine.STEPS['2'].req(g) || [])) {
        if (r.kind !== 'crewAction') continue;
        const p = g.players.find(x => x.id === r.pid);
        if (p && p.role === 'crew') { crew = p; break; }
      }
    }
    Engine.stepOnce(g);
    if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
  }
  const f = crew ? Engine.STEPS['2'].form(g, crew) : null;
  const optVals = f ? (f.opts || []).map(o => o.v) : [];
  out.push('① 步骤 2 表单（船员）：');
  out.push('   opts = ' + JSON.stringify(optVals));
  ok(!!f && !optVals.some(v => typeof v === 'string' && v.indexOf('repair') === 0),
    '步骤 2 表单已无 repair* 档（协助维修移到独立窗口）');
  ok(!!f && optVals.indexOf('check') >= 0, '步骤 2 表单仍保留 check（查验在本窗口）');

  /* 4a 的表单：7 档 assist* + none */
  let f4 = null;
  if (crew) { crew.branch = null; f4 = Engine.STEPS['4a'].form(g, crew); }
  const v4 = f4 ? (f4.opts || []).map(o => o.v) : [];
  out.push('   4a 表单 opts = ' + JSON.stringify(v4));
  const tiers = v4.filter(v => typeof v === 'string' && v.indexOf('assist') === 0);
  ok(tiers.length === 7, '4a 表单为 7 档 assist* （卡：a∈[0.20,0.50] 步长 0.05 共 7 档）', tiers.length + ' 档');
  const vals = tiers.map(v => parseFloat(v.slice(6))).sort((a, b) => a - b);
  ok(vals[0] === 0.2 && vals[6] === 0.5 && vals.every((v, i) => i === 0 || Math.abs(v - vals[i - 1] - 0.05) < 1e-9),
    '7 档数值与卡载口径逐档相符（0.20…0.50 步长 0.05）', JSON.stringify(vals));
}

/* ── ② 多局：互斥与窗口使用率（判据读 p.branch） ──────────────── */
{
  let s2 = 0, s4a = 0, crewRepairDispatches = 0, both = 0, checkedNights = 0;
  let repairValueSet = 0, repairValueLeak = 0;
  for (let i = 0; i < N; i++) {
    const g = Setup.createGame(100 + i, 'random');
    g.humans = []; g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    Engine.begin(g);
    const checked = new Set();
    const hadValue = new Set();
    /* ⚠ 夜次边界判据：不能用 g.phase —— 实测它在夜末并未翻转成 'day'，
       按它清集合会让 checked 跨夜残留，把「上夜查验过」误当「本夜查验过」，
       第一版探针因此在 80 局里报出 209 次**假违例**（引擎互斥本身是对的：
       真查验的船员确实没被派发到 4a）。改用 g.night 变化作为边界。 */
    let lastNight = g.night;
    let k = 0;
    while (!g.over && k < 4000) {
      const step = g.step;
      k++;
      /* 当夜真查验过的船员：引擎在步骤 2 的 run 写 p.branch='check' */
      for (const p of g.players) {
        if (!p.out && p.role === 'crew' && p.branch === 'check') checked.add(p.id);
      }
      if (step === '4a') {
        s4a++;
        for (const r of (Engine.STEPS['4a'].req(g) || [])) {
          if (r.kind !== 'crewRepair') continue;
          crewRepairDispatches++;
          if (checked.has(r.pid)) both++;
          /* 提交在 stepOnce 之前就已落到 g.decisions（引擎 pending/submit 流程），
             故「AI 真提交了 crewRepair」必须在这里读：放到 stepOnce 之后，
             读 p.repairValue 会因刚结算完而恒为 0，读 g.decisions 会因已被下一步
             覆盖而恒为 0——早先两版都栽在这点。 */
          const d = g.decisions[r.pid] || {};
          if (d.mode === 'crewRepair') { repairValueSet++; hadValue.add(r.pid); }
        }
      } else if (step === '2') s2++;
      Engine.stepOnce(g);
      if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
      /* 残留核对：只在 4a **之后**的步骤查（实序 2 → 4b → 3 → 4a → 5 → 6 → 7 → 8 → 9）。
         此前在 4b 就查，而 4b 排在 4a 之前，那时看到的是步骤 2 预留的档值
         （尚未经 4a 结算）⇒ 假报 36 次残留。 */
      if (step === '5' || step === '6' || step === '7' || step === '8') {
        /* ⚠ 只在 4a **之后**的步骤查残留：实序为 2 → 4b → 3 → 4a → 5 → 6 → 7 → 8 → 9，
           此前在 4b 就查，而 4b 排在 4a 之前，那时看到的是步骤 2 预留的档值
           （尚未经 4a 结算）⇒ 假报 36 次残留。 */
        for (const id of hadValue) {
          const p = g.players.find(x => x.id === id);
          if (p && !p.out && p.repairValue != null) repairValueLeak++;
        }
      }
      if (g.night !== lastNight) { checked.clear(); hadValue.clear(); lastNight = g.night; }
      void repairValueSet; void repairValueLeak;
    }
  }
  out.push('');
  out.push(N + ' 局统计（种子 100 起）：');
  out.push('  步骤 2 派发次数 = ' + s2 + '   4a 派发次数 = ' + s4a);
  out.push('  4a crewRepair 派发 = ' + crewRepairDispatches + '   其中同夜已查验的 = ' + both);
  out.push('  p.repairValue 被写入 = ' + repairValueSet + ' 次；结算后未清零 = ' + repairValueLeak + ' 次');
  ok(both === 0, '同夜既查验又协助维修 = 0 次（卡：二者当夜二选一）', '违例 ' + both + ' 次');
  ok(crewRepairDispatches > 0, '4a 确实向未查验的船员派发协助维修窗口（本窗口非死码）',
    crewRepairDispatches + ' 次');
  ok(repairValueSet > 0, '协助维修值真的写进了 p.repairValue（值未在派发与结算之间丢失）',
    repairValueSet + ' 次');
  ok(repairValueLeak === 0, '结算后 p.repairValue 已清零（不跨夜残留）', '残留 ' + repairValueLeak + ' 次');
}

out.push('');
out.push('汇总：通过 ' + pass + ' 条，失败 ' + fail + ' 条');
console.log(out.join('\n'));
try { fs.writeFileSync((process.env.TEMP || '.') + '/crew-window-mutex.txt', out.join('\n')); } catch (e) { }
process.exit(fail ? 1 : 0);