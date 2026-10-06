/* =============================================================
 * v4.0 批次 17b 前置 · 重测探针（审查结论 §七 + 17b 指导清单 D3/D4/D5 清零版）
 *
 * 与旧版（17a）的差异：
 *   · D3 判据切换——主判据 = 非异形观察者 AUC（human 与 xeno 分列，不 pooled）；
 *     pooled 全局 AUC 降级为对照行，禁止作放行判据（审查 §三·1：异形组 0.999 来自
 *     「知道队友」的私有信息优势，占样本 21.8%，混入全局既稀释又扭曲）；
 *   · D4 种子切换——验证集 501–700，与指纹集（1–200）、调试集（1–100）零重叠；
 *   · D5 三臂分离归因——臂1 旧累加器 / 臂2 云（时钟遗忘 D1 + known 坍缩）/
 *     臂3 云+hardFloor 下限对齐（belief.hardFloor.v 同刻度 max 钳制）。
 *     残局退化（0.708→0.563）的归因由臂2 vs 臂3 的差值分离，不再由假设充当结论；
 *   · 接口修复——fromEvents 传 { nowNight: g.night }（遗忘由游戏时钟驱动，审查 P1·4）。
 *
 * 治理规范声明：指标只读不进 gate（铁律一）；结果如实报告含恶化项（铁律五）；
 * 「回到随机线以上」≠「具备推理能力」——判定门见文末，未达标即判「先调模型」。
 * ============================================================= */
const path = require('path');
const { makeCtx, loadInto, profiles } = require('./load-order.cjs');

const base = path.join(__dirname, '..', 'js');
const ctx = makeCtx();
loadInto(ctx, base, profiles.full);

const { Setup, Engine, AI, SKCloud, SKData, SKRoleDecl } = ctx;
const N = parseInt(process.argv[2] || '200', 10);
const SEED0 = parseInt(process.argv[3] || '501', 10);      // D4：验证集 501–700，与指纹/调试集零重叠

const ROLE2FACTION = {};
for (const k of SKRoleDecl.keys()) ROLE2FACTION[k] = SKRoleDecl.ROLE_DECL[k].faction;

function knownLockOf(p, id) {
  const k = p.known.get(id);
  if (!k || k.viaPrivate) return null;
  if (k.role && ROLE2FACTION[k.role]) return ROLE2FACTION[k.role];
  if (k.faction && SKData.FACTION[k.faction]) return k.faction;
  return null;
}

/* AUC（Mann-Whitney，含并列 0.5） */
function auc(samples) {
  const pos = [], neg = [];
  for (const s of samples) (s.label === 1 ? pos : neg).push(s.score);
  if (!pos.length || !neg.length) return null;
  pos.sort((a, b) => a - b); neg.sort((a, b) => a - b);
  let u = 0, j = 0;
  for (const p of pos) {
    while (j < neg.length && neg[j] < p) j++;
    let k = j, eq = 0;
    while (k < neg.length && neg[k] === p) { k++; eq++; }
    u += j + eq * 0.5;
  }
  return u / (pos.length * neg.length);
}
function fmt(name, arr) {
  const v = auc(arr);
  return `${name} 样本 ${String(arr.length).padStart(6)}${v == null ? '  (无样本)' : `  AUC ${v.toFixed(3)}`}`;
}
function line(tag, o, c, cF) {
  console.log(`  ${tag.padEnd(10, '　')} 旧 ${auc(o) == null ? '—' : auc(o).toFixed(3)}  云 ${auc(c) == null ? '—' : auc(c).toFixed(3)}  云+floor ${auc(cF) == null ? '—' : auc(cF).toFixed(3)}`);
}

const S = { old: [], cloud: [], cloudF: [] };
const PH = ['open', 'mid', 'late'];
const SP = { old: {}, cloud: {}, cloudF: {} };
for (const k of PH) { SP.old[k] = []; SP.cloud[k] = []; SP.cloudF[k] = []; }
const SV = { old: { human: [], xeno: [] }, cloud: { human: [], xeno: [] }, cloudF: { human: [], xeno: [] } };
const SA = { old: [], cloud: [], cloudF: [] };                 // 异形组（仅对照）
const top = { old: [0, 0], cloud: [0, 0], cloudF: [0, 0] };
let errs = 0;

for (let i = 0; i < N; i++) {
  const seed = SEED0 + i;
  const g = Setup.createGame(seed, 'random');
  g.humans = []; g.humanId = -1;
  try {
    Engine.begin(g);
    let steps = 0, sampledNight = 0;
    while (!g.over && steps < 4000) {
      Engine.stepOnce(g);
      steps++;
      if (g.step === '9' && g.night >= 1 && g.night > sampledNight && !g.pending) {
        sampledNight = g.night;
        const ph = g.night <= 2 ? 'open' : g.night <= 5 ? 'mid' : 'late';
        for (const v of g.players) {
          if (v.out) continue;
          const hostile = SKData.FACTION[v.faction].hostileTo;
          const alive = g.players.filter(p => !p.out && p.id !== v.id);
          const rank = { old: [], cloud: [], cloudF: [] };
          for (const t of alive) {
            const label = hostile.indexOf(t.faction) >= 0 ? 1 : 0;
            const so = AI.suspOf(g, v, t.id);
            S.old.push({ score: so, label });
            SP.old[ph].push({ score: so, label });
            rank.old.push({ score: so, label });
            /* 云臂：时钟驱动遗忘（nowNight）+ known 官方揭示坍缩（信息面与旧侧 knownLockOf 一致） */
            const cl = SKCloud.fromEvents(v.faction, v.tEvents.get(t.id) || [], { nowNight: g.night });
            const kl = knownLockOf(v, t.id);
            if (kl) SKCloud.collapse(cl, kl);
            const sc = SKCloud.hostile100(cl, v.faction);
            S.cloud.push({ score: sc, label });
            SP.cloud[ph].push({ score: sc, label });
            rank.cloud.push({ score: sc, label });
            /* 云+floor 臂：再对齐 hardFloor 数值下限（belief.setHardFloor 同刻度 max 钳制） */
            const fl = v.hardFloor && v.hardFloor.get(t.id);
            if (fl) SKCloud.floor(cl, fl.v);
            const scF = SKCloud.hostile100(cl, v.faction);
            S.cloudF.push({ score: scF, label });
            SP.cloudF[ph].push({ score: scF, label });
            rank.cloudF.push({ score: scF, label });
            /* 分观察者阵营：主判据（非异形 human/xeno 分列）；异形组仅对照 */
            if (v.faction === 'human') { SV.old.human.push({ score: so, label }); SV.cloud.human.push({ score: sc, label }); SV.cloudF.human.push({ score: scF, label }); }
            else if (v.faction === 'xeno') { SV.old.xeno.push({ score: so, label }); SV.cloud.xeno.push({ score: sc, label }); SV.cloudF.xeno.push({ score: scF, label }); }
            else { SA.old.push({ score: so, label }); SA.cloud.push({ score: sc, label }); SA.cloudF.push({ score: scF, label }); }
          }
          for (const arm of ['old', 'cloud', 'cloudF']) {
            const r = rank[arm];
            if (r.length) {
              const best = r.reduce((a, b) => (b.score > a.score ? b : a), r[0]);
              top[arm][1]++; if (best.label === 1) top[arm][0]++;
            }
          }
        }
      }
    }
  } catch (e) {
    errs++;
    console.log('  [异常] seed', seed, e && e.message);
    if (errs > 3) break;
  }
}

const pct = x => (100 * x[0] / Math.max(1, x[1])).toFixed(1) + '%';
console.log(`\n=== 17b 前置重测（D3/D4/D5）=== 局数 ${N}（种子 ${SEED0}–${SEED0 + N - 1}，验证集 501–700 段）异常 ${errs}`);
console.log('指标只读声明：以下数字不进任何 gate；云参数为占位值（D6 依据见 cloud.js 注释），未用 AUC 调参。');
console.log('\n— 主判据：非异形观察者 AUC（human / xeno 分列，不 pooled）—');
line('human', SV.old.human, SV.cloud.human, SV.cloudF.human);
line('xeno ', SV.old.xeno, SV.cloud.xeno, SV.cloudF.xeno);
const nonAlienOld = SV.old.human.concat(SV.old.xeno);
const nonAlienCloud = SV.cloud.human.concat(SV.cloud.xeno);
const nonAlienCloudF = SV.cloudF.human.concat(SV.cloudF.xeno);
line('非异形合计', nonAlienOld, nonAlienCloud, nonAlienCloudF);
console.log('— 辅判据：分阶段（开局 1–2 / 中期 3–5 / 残局 ≥6 夜）—');
for (const ph of PH) line(`[${ph}]`, SP.old[ph], SP.cloud[ph], SP.cloudF[ph]);
console.log('— 对照：异形观察者组（私有队友硬锁优势，不作推理判据）—');
line('[alien]', SA.old, SA.cloud, SA.cloudF);
console.log(`— 每夜 top1 是否真为敌方 — 旧 ${pct(top.old)}  云 ${pct(top.cloud)}  云+floor ${pct(top.cloudF)}`);
const aOld = auc(nonAlienOld), aCloud = auc(nonAlienCloud), aCloudF = auc(nonAlienCloudF);
console.log(`\n— D5 残局归因分离 —`);
console.log(`  残局：旧 ${auc(SP.old.late) == null ? '—' : auc(SP.old.late).toFixed(3)} / 云 ${auc(SP.cloud.late) == null ? '—' : auc(SP.cloud.late).toFixed(3)} / 云+floor ${auc(SP.cloudF.late) == null ? '—' : auc(SP.cloudF.late).toFixed(3)}`);
console.log(`  归因读法：若「云+floor」修复残局而「云」未修复 ⇒ hardFloor 缺失为主因；`);
console.log(`  若两云臂同差 ⇒ 遗忘时钟/其他接口缺陷为主因（本轮 D1 已修，预期改善由臂2 体现）。`);
console.log(`\n— 判定门（D3）：非异形 AUC ≥ 0.55 且不低于旧侧 ⇒ 方向成立；否则判「先调模型」—`);
console.log(`  非异形：旧 ${aOld == null ? '—' : aOld.toFixed(3)}  云 ${aCloud == null ? '—' : aCloud.toFixed(3)}  云+floor ${aCloudF == null ? '—' : aCloudF.toFixed(3)}`);
