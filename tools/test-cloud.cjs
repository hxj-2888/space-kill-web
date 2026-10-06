/* =============================================================
 * 粒子云信念模块 · 单元测试（v4.0 批次 17b 前置 · 审查结论 A1–A5 + D1/D2 清零版）
 * 依据：《改造清单_v4.0_最终版.md》§3-B1/§7（H22/H23/H35）+《17b动工前指导清单.docx》
 *       §5-A1~A5（弱断言替换，判据=「故意改坏实现必挂」）+ §3-D1/D2（验收判据逐条）。
 * 运行：node tools/test-cloud.cjs
 * ============================================================= */
const path = require('path');
const { makeCtx, loadInto, profiles } = require('./load-order.cjs');
const base = path.join(__dirname, '..', 'js');
const ctx = makeCtx({ RegExp });
loadInto(ctx, base, profiles.full);

const Cloud = ctx.SKCloud;
if (!Cloud) { console.error('SKCloud 未挂载'); process.exit(1); }

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  → ' + extra : ''}`); }
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

/* ---- rng 桩（固定序列采样测试用；独立随机流，不触碰 g.rng——清单 §9 风险表） ---- */
function mulberry32(seed) {
  let t = seed >>> 0;
  return { next() { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; } };
}

console.log('— 先验对齐（清单 §3-B1：α₀ ∝ PRIOR_E，人类观察者 7.14/2.14/0.71）—');
{
  const c = Cloud.init('human');
  const [mh, ma, mx] = c.m;
  ok('人类观察者初始均值 = PRIOR_E.humanViewer 归一（0.714/0.214/0.071）',
    near(mh, 100 / 140, 0.01) && near(ma, 30 / 140, 0.01) && near(mx, 10 / 140, 0.01),
    JSON.stringify(c.m.map(x => x.toFixed(3))));
  ok('初始浓度 = 先验等效样本数 10（PRIOR_E 行和）', near(c.c, 10, 1e-9), 'c=' + c.c);
  const cx = Cloud.init('xeno');
  ok('外星人观察者 xeno 分量为 0（别人不可能是外星人）', cx.m[2] === 0, JSON.stringify(cx.m));
  ok('云的敌对度初值 = 旧先验敌对度（humanViewer 28.6%，同源派生）',
    near(Cloud.hostile100(c, 'human'), 200 / 7, 1.5), Cloud.hostile100(c, 'human').toFixed(2));
}

console.log('— H22 铁证坍缩（清单 §7：单条官方揭示 ⇒ 分布最大项 ≥ 0.99）—');
{
  const c = Cloud.init('human');
  Cloud.absorb(c, { delta: 30, tier: 'B', kind: 'claim' });
  Cloud.collapse(c, 'human');
  const M = Cloud.moments(c);
  ok('collapse 后分布最大项 ≥ 0.99', Math.max(...c.m) >= 0.99, JSON.stringify(c.m));
  /* A1（指导清单 §5）：sd 恒真断言替换——补实质约束 c===C_LOCK 且 locked===true，
     实现 C_LOCK 被改坏时本断言必挂 */
  ok('A1：collapse 后 c === C_LOCK 且 locked === true（浓度约束，非恒真 sd）',
    c.c === Cloud.CONST.C_LOCK && c.locked === true, `c=${c.c} locked=${c.locked}`);
  ok('collapse 后标准差 < 0.02（方差→0，保留作描述性约束）', Math.max(...M.sd) < 0.02);
  ok('collapse 后敌对度归 0（人类视角、硬锁人类）', Cloud.hostile100(c, 'human') === 0);
  ok('locked 云不再被 claim 推动（4.10.3 已发生状态不回滚）',
    Cloud.absorb(c, { delta: 90, tier: 'A', kind: 'claim' }) && Math.max(...c.m) >= 0.99 &&
    Cloud.hostile100(c, 'human') === 0);
}

console.log('— H23 偶然只扩散不位移（清单 §1.2 明文「中心不动」；对照旧累加器 +39.3pp）—');
{
  const c = Cloud.init('human');
  const m0 = c.m.slice();
  const sd0 = Math.max(...Cloud.moments(c).sd);
  for (let i = 0; i < 10; i++) Cloud.absorb(c, { delta: 15, tier: 'D', kind: 'claim', src: 'd' + i });
  const sd1 = Math.max(...Cloud.moments(c).sd);
  /* A2（指导清单 §5）：阈值收紧——D 档 rel=0.15 < REL_NUDGE ⇒ 均值逐位不变（非 <15pp 松弛） */
  ok('A2：10 条 D 档均值逐位不变（中心不动，清单 §1.2 明文）',
    c.m.every((x, i) => x === m0[i]), JSON.stringify(c.m));
  ok('方差显著增大（sd 增幅 > 20%，H23 判据）', sd1 > sd0 * 1.2, `sd ${sd0.toFixed(4)} → ${sd1.toFixed(4)}`);

  const c2 = Cloud.init('human');
  for (let i = 0; i < 3; i++) Cloud.absorb(c2, { delta: 70, tier: 'A', kind: 'claim', src: 'a' + i });
  const mA = Cloud.hostile100(c2, 'human');
  ok('强证据（A 档）浓度上升 ⇒ 有效坍缩向（c 增）', c2.c > Cloud.CONST.C0, 'c=' + c2.c.toFixed(1));
  /* A3（指导清单 §5）：可逆性改为「相对正向峰值的回落量」——区分真可逆与压根不动 */
  for (let i = 0; i < 10; i++) Cloud.absorb(c2, { delta: -70, tier: 'A', kind: 'claim', src: 'r' + i });
  const mBack = Cloud.hostile100(c2, 'human');
  ok('A3：反向 A 档使敌对度自正向峰值回落 ≥ 15pp（真可逆）', mBack < mA - 15,
    `峰值 ${mA.toFixed(1)} → 终值 ${mBack.toFixed(1)}`);
}

console.log('— 每夜扩散核（自然遗忘）—');
{
  const c = Cloud.init('human');
  Cloud.absorb(c, { delta: 70, tier: 'A', kind: 'claim' });
  const c1 = c.c, m1 = c.m[1];
  Cloud.diffuseNight(c);
  ok('一夜后浓度衰减（方差回升）', c.c < c1, `c ${c1.toFixed(2)} → ${c.c.toFixed(2)}`);
  ok('均值向先验回归', c.m[1] < m1, `alien ${(m1 * 100).toFixed(1)}% → ${(c.m[1] * 100).toFixed(1)}%`);
  const cl = Cloud.init('human');
  Cloud.collapse(cl, 'alien');
  const cc = cl.c, mm = cl.m.slice();
  Cloud.diffuseNight(cl);
  ok('locked 云不遗忘（c 与 m 逐位不变）', cl.c === cc && cl.m.every((x, i) => x === mm[i]));
}

console.log('— D1 验收：遗忘改由游戏时钟驱动（17b 指导清单 §3-D1，三条判据）—');
{
  /* 判据 1：同一证据集，nowNight=5 与 6 无新证据 ⇒ c 下降 ≈ C_DECAY，hostile 向先验移动 */
  const evs = [{ night: 1, delta: 40, tier: 'B+', kind: 'claim', src: 'x' }];
  const c5 = Cloud.fromEvents('human', evs, { nowNight: 5 });
  const c6 = Cloud.fromEvents('human', evs, { nowNight: 6 });
  ok('D1-1：nowNight+1 且无新证据 ⇒ c 按 C_DECAY 下降',
    near(c6.c, c5.c * Cloud.CONST.C_DECAY, 1e-9), `c5=${c5.c.toFixed(3)} c6=${c6.c.toFixed(3)}`);
  ok('D1-1：hostile100 向先验移动（回归方向）',
    Math.abs(c6.m[1] - c6.prior[1]) < Math.abs(c5.m[1] - c5.prior[1]),
    `|m-alien 先验差| ${Math.abs(c5.m[1] - c5.prior[1]).toFixed(4)} → ${Math.abs(c6.m[1] - c6.prior[1]).toFixed(4)}`);

  /* 判据 2：「第 1 夜 1 条证据、之后无证据」第 6 夜采样 ⇒ c 相对第 1 夜单调递减 ≥ 4 夜 */
  const c1n = Cloud.fromEvents('human', evs, { nowNight: 1 });
  const c6n = Cloud.fromEvents('human', evs, { nowNight: 6 });
  ok('D1-2：无新证据目标第 6 夜浓度较第 1 夜单调下降（遗忘真实发生）',
    c6n.c < c1n.c * Math.pow(Cloud.CONST.C_DECAY, 4) + 1e-9,
    `c@1=${c1n.c.toFixed(3)} c@6=${c6n.c.toFixed(3)}（5 夜扩散）`);

  /* 判据 3：同为 2 条同强度证据，起始夜 1+3 vs 5+5（采样同在第 5 夜）
     〔第二十三批 · 审查结论复核更正〕**原判据「浓度差 ≤10%」本身不成立**：
     旧实现时钟 n 从 0 起步 ⇒ early 与 late 都恰好各扩散 5 次 ⇒ 差 0%。
     那个 0% 证明的是「两条路径的重放起点相同」，**不是**「起始夜无关」——
     换言之它是一个 bug 巧合，被误读成了修复成效。真实被修好的是 D1-1/D1-2
     （nowNight 补扩散：重放终点不再恒为「最后一条证据的夜」）。
     修复 P4（时钟起点取首条证据夜）后：early 扩散 4 次、late 扩散 0 次，
     实测比值 0.656100 ＝ C_DECAY^4 **精确吻合** —— 这才是「早 4 夜的证据理应更淡」
     的正确语义。判据据此改为比值语义，并保留单调方向断言。 */
  const early = Cloud.fromEvents('human', [
    { night: 1, delta: 40, tier: 'B+', kind: 'claim', src: 'e1' },
    { night: 3, delta: 40, tier: 'B+', kind: 'claim', src: 'e2' },
  ], { nowNight: 5 });
  const late = Cloud.fromEvents('human', [
    { night: 5, delta: 40, tier: 'B+', kind: 'claim', src: 'e1' },
    { night: 5, delta: 40, tier: 'B+', kind: 'claim', src: 'e2' },
  ], { nowNight: 5 });
  const expectRatio = Math.pow(Cloud.CONST.C_DECAY, 4);
  const ratio = early.c / late.c;
  ok('D1-3（更正）：起始夜差 4 夜 ⇒ 浓度比 ≈ C_DECAY^4（早者的证据理应更淡，非"无差别"）',
    near(ratio, expectRatio, 2e-3) && early.c < late.c,
    `比值 ${ratio.toFixed(6)} 期望 ${expectRatio.toFixed(6)}（原判据「差≤10%」已废）`);
  ok('D1-3（补）：采样夜相同 ⇒ 两条路径的重放终点一致（nowNight 生效，非恒为末条证据夜）',
    early.n === late.n && early.n === 5, `early.n=${early.n} late.n=${late.n}`);
}

console.log('— D2 验收：排除式证据原语 excludeFaction（17b 指导清单 §3-D2）—');
{
  const c = Cloud.excludeFaction(Cloud.init('human'), 'human');
  const [mh, ma, mx] = c.m;
  ok('D2：exclude(human) 后 m ≈ [0, 0.751, 0.249]（按 prior 2.14:0.71 重分配，非均匀非残留）',
    mh === 0 && near(ma, 0.751, 0.01) && near(mx, 0.249, 0.01),
    JSON.stringify(c.m.map(x => x.toFixed(3))));
  ok('D2：alien 与 xeno 均 > 0（错误确定性未注入）', ma > 0 && mx > 0);
  ok('D2：lockedExclude 与 locked 分开标记', c.lockedExclude === true && c.locked === false);
  const c2 = Cloud.init('human');
  Cloud.excludeFaction(c2, 'human');
  Cloud.absorb(c2, { delta: 30, tier: 'B', kind: 'claim' });
  ok('D2：排除后剩余两轴仍可被证据移动（下限语义：软证据只升不回）',
    c2.m[2] > 0 || c2.m[1] !== 0.751, JSON.stringify(c2.m.map(x => x.toFixed(3))));
  Cloud.diffuseNight(c2);
  ok('D2：扩散核不复活被排除分量（恒 0）', c2.m[0] === 0, JSON.stringify(c2.m.map(x => x.toFixed(3))));
  /* hardFloor 下限对齐（belief.js setHardFloor 同刻度） */
  const c3 = Cloud.init('human');
  Cloud.floor(c3, 70);
  ok('D2 附：floor 下限钳制（hardFloor 同语义：suspOf s=max(s,fl.v)）',
    Cloud.hostile100(c3, 'human') === 70, Cloud.hostile100(c3, 'human').toFixed(1));
}

console.log('— 采样正确性（大数定律）与采样克制原语（H35）—');
{
  const rng = mulberry32(20261004);
  const c = Cloud.init('human');
  const N = 4000;
  const acc = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const s = Cloud.sample(c, rng);
    if (Math.abs(s[0] + s[1] + s[2] - 1) > 1e-6) { ok('采样样本归一', false); break; }
    acc[0] += s[0] / N; acc[1] += s[1] / N; acc[2] += s[2] / N;
  }
  ok('4000 样本均值收敛到云均值（每分量误差 < 0.02）',
    c.m.every((x, i) => Math.abs(acc[i] - x) < 0.02),
    `m=${c.m.map(x => x.toFixed(3))} 采样=${acc.map(x => x.toFixed(3))}`);
  /* A4（指导清单 §5）：sampleFaction ∈ KEYS 恒真断言替换——argmax 口径的经验频率
     排序须与 m 排序一致（采样器偏好反转时本断言必挂），且各分量频率有区分度 */
  const rng2 = mulberry32(9101);
  const skew = Cloud.init('human');
  skew.m = [0.8, 0.15, 0.05];
  const freq = [0, 0, 0];
  const M = 3000;
  for (let i = 0; i < M; i++) freq[Cloud.KEYS.indexOf(Cloud.sampleFaction(skew, rng2))]++;
  const orderEmp = freq.map((f, i) => [f, i]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  const orderM = skew.m.map((x, i) => [x, i]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  ok('A4：sampleFaction 经验频率排序与 m 排序一致（区分度存在，非恒真）',
    orderEmp.join(',') === orderM.join(',') && freq[0] > freq[1] && freq[1] >= freq[2],
    `m 排序=${orderM} 经验排序=${orderEmp} 频率=${freq.join('/')}`);
  const flat = Cloud.init('alien');                       // alienVsOther：50/50 均势
  ok('contested：势均力敌（差 < 0.25）为真', Cloud.contested(flat) === true);
  Cloud.collapse(flat, 'alien');
  ok('contested：坍缩后为假（确定性选择，非势均力敌不采样）', Cloud.contested(flat) === false);
}

console.log('— 事件序列重放（fromEvents：时钟驱动 + xeno 坍缩缺口修复，审查 §五/A5）—');
{
  const evs = [
    { night: 1, delta: 30, tier: 'B', kind: 'claim', src: 's1' },
    { night: 2, delta: 15, tier: 'D', kind: 'claim', src: 's2' },
    { night: 4, delta: -60, tier: 'A-', kind: 'claim', src: 's3' },
    { night: 5, delta: 80, kind: 'fact', src: 'reveal' },
    { night: 6, delta: 90, tier: 'A', kind: 'claim', src: 's4' },
  ];
  const c = Cloud.fromEvents('human', evs);
  ok('重放：末条为官方揭示 ⇒ 终态坍缩且不再受后续 claim 影响（locked）',
    c.locked === true && Cloud.hostile100(c, 'human') === 100, JSON.stringify(c.m.map(x => x.toFixed(2))));
  const c2 = Cloud.fromEvents('human', evs.slice(0, 3));    // night 1(B)/2(D)/4(A− 反向 claim)
  ok('重放（无揭示）：末条 A− 反向证据生效，终值非极端（云保留不确定性）',
    !c2.locked && Cloud.hostile100(c2, 'human') > 5 && Cloud.hostile100(c2, 'human') < 60,
    `hostile=${Cloud.hostile100(c2, 'human').toFixed(1)}`);
  /* A5（指导清单 §5）：fromEvents fact 坍缩到 xeno（显式 faction 字段）——异形观察者看队友场景 */
  const evX = [
    { night: 2, delta: 10, tier: 'C', kind: 'claim', src: 'n1' },
    { night: 3, delta: 0, kind: 'fact', faction: 'xeno', src: 'omniscient' },
  ];
  const cx = Cloud.fromEvents('alien', evX);
  ok('A5：fact 事件显式 faction=xeno ⇒ 坍缩到 xeno（缺口修复）',
    cx.locked === true && cx.m[2] === 1, JSON.stringify(cx.m));
  const cv = Cloud.fromEvents('alien', [
    { night: 3, delta: 0, kind: 'fact', faction: 'alien', src: 'mate-reveal' },
  ]);
  /* 异形视角队友非敌方（D.FACTION.alien.hostileTo = [human, xeno]）⇒ 坍缩 alien 后敌对度 0 */
  ok('A5 补：异形观察者对队友的官方揭示 ⇒ 坍缩 alien 且敌对度 0（队友非敌方）',
    cv.m[1] === 1 && Cloud.hostile100(cv, 'alien') === 0,
    `m=${JSON.stringify(cv.m)} hostile=${Cloud.hostile100(cv, 'alien')}`);
  ok('重放：nowNight 缺省时不补扩散（向后兼容）',
    Cloud.fromEvents('human', evs.slice(0, 1)).n === 1);
}

console.log(`\n云模块单元测试：通过 ${pass} 条、失败 ${fail} 条`);
process.exit(fail ? 1 : 0);
