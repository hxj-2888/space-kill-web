/* 语言库双向一致性测试（round-trip）：render → parse → IR 必须回到同一个 Claim。
   这条不变式是「语言库 ⇄ 推理链」联动的地基：AI 说得出的每句话，
   都必须能被自家解析器读回同一个意图，否则推理链接收到的就是噪声。
   用法：node tools/test-lang.cjs */
const fs = require('fs');
const path = require('path');
const { makeCtx, loadInto, profiles } = require('./load-order.cjs');

const base = path.join(__dirname, '..', 'js');
const ctx = makeCtx({ RegExp });
loadInto(ctx, base, profiles.lang);
const { IR, Lang } = ctx;

const NIGHT = 3, SPEAKER = 1;
const claim = (kind, targets, payload) => IR.mk(kind, targets, payload, { night: NIGHT, step: 'D-talk', speaker: SPEAKER });

/* expect 为 null 表示「该类型尚未进词表」，只验证能渲染出非空句子（待 P2 补词后转为有断言） */
/* keys：需要参与深比较的 payload 字段。
   v26：此前只比 kind + targets——`lock` 的 faction、`accuse` 的 tier 在 render→parse 后即使
   丢失也照样通过，于是「AI 与玩家走同一条管道」这条地基不变式实际只验证了意图类别。
   faction 是目标侧证据与硬源锁定的唯一载体，tier 是措辞强度的载体，必须一起锁死。 */
const CASES = [
  { c: claim('accuse', [3], { tier: 'hard' }), expect: 'accuse', keys: ['tier'] },
  { c: claim('accuse', [12], { tier: 'soft' }), expect: 'accuse', keys: ['tier'] },
  { c: claim('claimRole', [], { role: 'detective' }), expect: 'claimRole', keys: ['role'] },
  { c: claim('claimRole', [], { role: 'sheriff' }), expect: 'claimRole', keys: ['role'] },
  { c: claim('exclusion', [5], { excludes: ['engineer', 'sheriff'] }), expect: 'exclusion' },
  /* lock 的 faction 必须显式给出：它是目标侧证据（lockEnemy/lockHuman）与硬源锁定的唯一载体，
     解析器可从 good / 阵营词恢复它——这条断言正是 v26 补的（旧测试只比 kind+targets 时，
     faction 在 IR 层丢失也照样通过）。 */
  { c: claim('lock', [7], { good: true, faction: 'human' }), expect: 'lock', keys: ['good', 'faction'] },
  { c: claim('lock', [9], { good: false, faction: 'alien' }), expect: 'lock', keys: ['good', 'faction'] },
  /* 注：faction 缺省的 lock 无法无损 round-trip——渲染出的否定句（「不是自己人」）必然携带
     阵营语义、被解析回 'alien'。因此生成侧（AI / 文本模板）必须始终显式给出 faction。 */
  { c: claim('ask', [4], {}), expect: 'ask' },
  { c: claim('quote', [5], { by: 3 }), expect: 'quote', keys: ['by'] },
  { c: claim('vote', [6], {}), expect: 'vote' },
  { c: claim('abstain', [], {}), expect: 'abstain' },
  { c: claim('rally', [8], {}), expect: 'rally' },
  { c: claim('defend', [2], {}), expect: 'defend' },
  /* bind 的 payload.role 会被解析器归一化（'doc' 不是合法 role 键，词表统一归到 'bio'） */
  { c: claim('bind', [11], { role: 'bio' }), expect: 'bind', keys: ['role'] },
  /* v20 推理库对应族：证伪 / 承诺 / 私有体验 */
  /* 【条数留档 · 2026-10-05】断言数由 103 变为 **102 并恒定**（审查结论 P4 建议留档）：
     被合并的两条原断言测的是**同一模板的两个措辞变体**——renderer 的 `deny/cured`
     原先有「我没有抗体，也没被治疗过」与「我昨晚没进过濒死」两句，第二十批因该句
     泄露私有治疗/抗体状态（3.3.11 结果无反馈红线）被删除，只留一句；覆盖面未下降，
     是**恒定化**（同一 Commit 起连跑多次恒为 102），非断言流失。 */
  { c: claim('deny', [], { about: 'checked' }), expect: 'deny', keys: ['about'] },
  { c: claim('deny', [], { about: 'cured' }), expect: 'deny', keys: ['about'] },
  { c: claim('deny', [], { about: 'infection' }), expect: 'deny', keys: ['about'] },
  { c: claim('promise', [5], { tier: 'mid' }), expect: 'promise', keys: ['tier'] },
  { c: claim('promise', [7], { tier: 'strong' }), expect: 'promise', keys: ['tier'] },
  { c: claim('promise', [], { tier: 'weak' }), expect: 'promise', keys: ['tier'] },
  { c: claim('suppress', [], {}), expect: 'suppress' },
  { c: claim('repair', [], {}), expect: 'repair' },
  { c: claim('cure', [5], {}), expect: 'cure' },
  { c: claim('rescue', [5], {}), expect: 'rescue' },
  { c: claim('brew', [], {}), expect: 'brew' },
  { c: claim('infection', [], {}), expect: 'infection' },
  { c: claim('pass', [], {}), expect: 'pass' },
];

const ROUNDS = 30;                       // 每种渲染 30 次，覆盖全部措辞变体
let fail = 0, checked = 0, pending = 0;

/* v33 复审 P0：否定极性三用例（parse 直连，不走 render——玩家辩护句的否定式）。
   修复前：「3号不是异形」被解析成 查杀+重度指控（方向反转）、「4号没有问题」成轻度指控、
   「5号是好人」零识别。这三条断言锁死修复，防止词表再往回漂。 */
const NEG_CASES = [
  { text: '3号不是异形，我信他', defend: [3], accuse: [] },
  { text: '4号没有问题', defend: [4], accuse: [] },
  { text: '5号是好人', defend: [5], accuse: [] },
  { text: '3号不是好人', defend: [], accuse: [] },   // 否定好人词：中性（不指控也不辩护）
  { text: '3号说5号不是异形', quote: [{ by: 3, target: 5 }] },  // 转述归因不受影响
];
const { NLP } = ctx;

const payloadOf = (c, keys) => {
  const o = {};
  for (const k of keys) o[k] = (c.payload || {})[k];
  return o;
};

/* 确定性变体生成（2026-10-03 修正）：render 在 ctx.rng 缺失时退化为 Math.random
   （js/lang/renderer.js:24），故此前每轮跑出的变体集合不同，断言数在 100~103 之间浮动
   ——同一个提交可能报出三个不同的「通过条数」，回归门禁失去可比性。现改为显式传入
   定种子 RNG：变体集合逐字节可复现，条数恒定。 */
const renderRng = new ctx.RNG(20261003);

for (const t of CASES) {
  const variants = new Set();
  for (let i = 0; i < ROUNDS; i++) variants.add(Lang.render(t.c, { rng: renderRng }));
  for (const text of variants) {
    if (!text) { console.log(`  [空句] ${t.c.kind} 渲染为空`); fail++; continue; }
    if (!t.expect) { pending++; continue; }
    checked++;
    const back = IR.fromText(text, { night: NIGHT, step: 'D-talk', speaker: SPEAKER }).claims;
    const ok = back.some(x =>
      x.kind === t.expect &&
      JSON.stringify(x.targets) === JSON.stringify(t.c.targets) &&
      (!t.keys || JSON.stringify(payloadOf(x, t.keys)) === JSON.stringify(payloadOf(t.c, t.keys))));
    if (!ok) {
      fail++;
      const got = back.map(b => b.kind + '(' + b.targets + (t.keys ? '/' + JSON.stringify(payloadOf(b, t.keys)) : '') + ')').join(',') || '无';
      console.log(`  [失败] ${t.c.kind}${t.keys ? '/' + JSON.stringify(payloadOf(t.c, t.keys)) : ''} ← 「${text}」 → ${got}`);
    }
  }
}

/* v33 否定极性用例执行：parse 直连断言 */
for (const t of NEG_CASES) {
  checked++;
  const sig = NLP.parse(t.text, { speaker: SPEAKER });
  const got = { defend: sig.defend, accuse: sig.accuse, report: sig.report, quote: sig.quote };
  const okDefend = t.defend ? JSON.stringify(sig.defend) === JSON.stringify(t.defend) : true;
  const okAccuse = t.accuse ? sig.accuse.length === 0 : true;
  const okQuote = t.quote ? JSON.stringify(sig.quote) === JSON.stringify(t.quote) : true;
  const okReport = !sig.report.length;   // 否定辩护句不得产生查验汇报（查杀）
  if (!(okDefend && okAccuse && okQuote && okReport)) {
    fail++;
    console.log(`  [失败] 「${t.text}」 → ${JSON.stringify(got)}`);
  }
}

console.log(`\nround-trip：断言 ${checked} 条、失败 ${fail} 条；待补词表的句子 ${pending} 条`);
process.exit(fail ? 1 : 0);
