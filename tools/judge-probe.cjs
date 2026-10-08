/* ============================================================================
 * 太空杀 · AI 判官探针（judge probe）
 * ----------------------------------------------------------------------------
 * 跑完整对局，把每个 AI 当真人来审：推理 / 发言 / 出手三路独立取证，
 * 按「真人严苛度」量表判罚并输出可复核样本。
 *
 * 纪律（对齐 docs/防指标博弈治理规范.md）：
 *   · 只观测不设靶——不改任何游戏文件，不参与 gate，只出读数与证据。
 *   · 每条判罚附「原始样本」，不接受无法定位的聚合数字。
 *   · 判据分「已复核」与「易误报」两档，易误报者必须按阵营/后果豁免后才计数。
 *     前一版探针的三条判罚经复核后被推翻，见 docs 判据校准记录：
 *       E6  裸指        735 命中里仅 197 真裸指（假阳性 74%）
 *       E9  认错人      异形把票推向已确证人类是**正确打法**，不是缺陷
 *       异形投队友     31 次里 0 次导致队友被驱逐（原始计数 51 判「严重」不成立）
 *
 * 用法：node judge-probe.cjs <项目绝对路径> [局数]
 * =========================================================================*/
'use strict';
const path = require('path');
const ROOT = process.argv[2] || process.cwd();
const N = +(process.argv[3] || 100);
const { makeCtx, loadInto, profiles } = require(path.join(ROOT, 'tools', 'load-order.cjs'));
const ctx = makeCtx({});
loadInto(ctx, path.join(ROOT, 'js'), profiles.full);
const { AI, Engine, Setup, Tactics } = ctx;

/* ================================ 判官量表 =================================
 * 档位：P0 作弊/胡言（不可接受） · P1 严重失格 · P2 不拟人 · P3 瑕疵
 * track: '推理' | '发言' | '出手'
 */
const VERDICTS = [];
function V(id, track, sev, title, test) { VERDICTS.push({ id, track, sev, title, test }); }
const samples = {};
function sample(id, obj) { (samples[id] || (samples[id] = [])).push(obj); }

/* ========================= 一、推理层判据 ================================ */

/* R1 [P0] 推理链伪造硬源：自称"我查过 X 号"但账本里没有这次查验 */
V('R1', '推理', 'P0', '推理链声称查验某人而本人无查验记录',
  (g, p, s) => {
    const m = /我查过\s*(\d{1,2})\s*号/.exec(s);
    if (!m) return false;
    const t = +m[1];
    if (p.crewChecks && p.crewChecks.get && p.crewChecks.get(t)) return false;
    if (p.checkPool && p.checkPool.get && p.checkPool.get(t)) return false;
    if (p.known && p.known.get && p.known.get(t) && p.known.get(t).faction) return false;
    return true;
  });

/* R2 [P0] 推理链拿"公告"当硬源，但该人身份并未公开 */
V('R2', '推理', 'P0', '推理链引用"公告白纸黑字"但该玩家身份从未公开',
  (g, p, s) => {
    if (!/公告白纸黑字/.test(s)) return false;
    const m = /(\d{1,2})\s*号的身份是明摆着/.exec(s);
    if (!m) return false;
    const t = +m[1];
    const tp = g.players.find(x => x.id === t);
    return !!(tp && !(tp.revealed && tp.revealed.faction));
  });

/* R3 [P2] 指控时推理链恒空：真人极少无理由开口 */
V('R3', '推理', 'P2', '发起指控却给不出任何推理链',
  (g, p, s) => {
    if (!/投\s*\d{1,2}\s*号|我指|我疑|查杀|带节奏/.test(s)) return false;
    return true;   // 由推理链钩子补判：chain 为 null 即命中
  });

/* R4 [P2] 改口遗忘：记忆里已记录对方前后自称冲突，却从不引用 */
V('R4', '推理', 'P2', '对方已改口自相矛盾，AI 全程未引用该矛盾',
  (g, p, s) => {
    const m = p.mem && p.mem.saidRole && p.mem.saidRole.get ? null : null;
    return false;   // 由结算阶段统计，不在句级判定
  });

/* ========================= 二、发言层判据 ================================ */

/* S1 [P1] 空发言：轮到发言却产出空串 */
V('S1', '发言', 'P1', '轮到发言却产出空串',
  (g, p, s) => s.trim() === '');

/* S2 [P2] 第 0 夜引用"昨晚"——开局无昨晚 */
V('S2', '发言', 'P2', '第 0 夜引用"昨晚"（开局不存在昨晚）',
  (g, p, s) => g.night === 0 && /昨晚|昨夜/.test(s));

/* S3 [P0] 「昨夜无人死亡」当夜有人出局——事实性胡言 */
V('S3', '发言', 'P0', '宣称"昨夜无人死亡"但当夜确有人出局',
  (g, p, s) => {
    if (!/昨夜无人死亡|昨晚没人死|昨夜没死/.test(s)) return false;
    const died = g.players.filter(x => x.out && x.outNight === g.night);
    return died.length > 0;
  });

/* S4 [P0] 声称查验结果但无任何查验记录 */
V('S4', '发言', 'P0', '发言引用查验结果但本人无查验记录',
  (g, p, s) => {
    if (!/我查过|我的查验|验过|查出来|查验结果/.test(s)) return false;
    if (p.crewChecks && p.crewChecks.get) {
      for (const k of p.crewChecks.get.keys ? p.crewChecks.get.keys() : []) return false;
      if (p.crewChecks.size) return false;
    }
    if (p.checkPool && p.checkPool.size) return false;
    return true;
  });

/* S5 [P2] 复读：同一玩家第三次说出完全相同的话 */
V('S5', '发言', 'P2', '复读：同一玩家重复完全相同的句子',
  (g, p, s) => dupCount(p.id, s) >= 3);

/* S6 [P2] 裸指：指名道姓地投某人却零依据（校准后——必须含具体编号） */
V('S6', '发言', 'P2', '指名投某人却未给出任何依据',
  (g, p, s) => {
    if (!/(投|指|怀疑|盯着|咬|查杀)\s*(?:给)?\s*(\d{1,2})\s*号/.test(s)) return false;
    const hasReason = /因为|查过|验过|我记|说过|自称|第\s*\d+\s*夜|昨夜|昨晚|条对不上|一直|公告|白纸黑字|对不上|两次|两张脸/.test(s);
    return !hasReason;
  });

/* S7 [P1] 指控凭空：被指目标在该说话者账本里无任何负面证据 */
V('S7', '发言', 'P1', '指控凭空：账本里对被指者无任何负面证据',
  (g, p, s) => {
    const m = /(?:投|指|怀疑|盯着|咬|查杀)\s*(\d{1,2})\s*号/.exec(s);
    if (!m) return false;
    const t = +m[1];
    if (p.crewChecks && p.crewChecks.get) {
      const rec = p.crewChecks.get(t);
      if (rec && rec.results && rec.results.some(r => !r.ans)) return false;  // 查杀硬证据
    }
    if (p.mem && p.mem.contradiction && p.mem.contradiction.some(c => c && (c.id === t || c.pid === t))) return false;
    return true;
  });

/* S8 [P2] 战术空条目：pickTactic 选中却既无文本也无 claim */
V('S8', '发言', 'P2', '战术库死条目：选中后既无文本也无动作',
  (g, p, s) => false);   // 由 pickTactic 钩子计数，见下

/* ========================= 三、出手层判据 ================================ */

/* A1 [P1] 发言承诺与实际投票不自洽（异形豁免——撒谎是正确打法） */
V('A1', '出手', 'P1', '人类口称投 X 号却实投他人',
  (g, p, s) => false);   // 由 decide 钩子统计，见下

/* A2 [P2] 异形投票导致队友被驱逐（按后果计数，不按原始次数） */
V('A2', '出手', 'P2', '异形投票把队友送上驱逐台',
  (g, p, s) => false);   // 由结算阶段统计，见下

/* ============================ 探针状态 =================================== */
const lineSeen = {};        // pid -> [句子]
const promise = {};         // pid -> [{night, target, text}]
const stat = {
  speakTotal: 0, speakEmpty: 0,
  tacPick: 0, tacDead: 0, tacDeadIds: {},
  chainNull: 0, chainTotal: 0,
  a1Human: 0, a1Alien: 0,
  a2Harm: 0, a2Raw: 0,
  dupThirdPlus: 0,
  conflictSeen: 0, conflictCited: 0,
  r4_games: 0, r4_games_uncited: 0, r4_conflicts: 0, r4_cited: 0,
};
const citedKeys = {};

function dupCount(pid, s) {
  const arr = lineSeen[pid] || (lineSeen[pid] = []);
  const c = arr.filter(x => x === s).length + 1;
  arr.push(s);
  return c;
}

/* ============================ 钩子：发言 ================================= */
const origSpeak = AI.speak;
AI.speak = function (g, p, quiet) {
  const raw = origSpeak.apply(this, arguments);
  const s = String(raw == null ? '' : raw);
  stat.speakTotal++;
  if (!s.trim()) stat.speakEmpty++;
  dupCount(p.id, s);
  if (dupCount(p.id, s) >= 3) stat.dupThirdPlus++;

  // 记录投票承诺
  const pm = /投\s*(\d{1,2})\s*号/.exec(s);
  if (pm) (promise[p.id] || (promise[p.id] = [])).push({ night: g.night, target: +pm[1], text: s });

  // R4 改口是否被引用：账本已记下「此人自称前后矛盾」，发言时有没有拿出来用
  if (p.mem && p.mem.saidRole && p.mem.saidRole.get) {
    for (const [tid, rec] of p.mem.saidRole.get.entries ? p.mem.saidRole.get.entries() : []) {
      if (!rec || !rec.conflictWith) continue;
      stat.conflictSeen++;                                   // 账本里有改口
      const cited = new RegExp('(?:' + tid + '\\s*号|他|这个人)').test(s)
        && /两张脸|说自己是|又说自己|改口|前后不一|两次自称/.test(s);
      if (cited) {
        stat.conflictCited++;
        const key = g._seed + ':' + p.id + ':' + tid;
        if (!citedKeys[key]) { citedKeys[key] = true; }
      }
    }
  }

  // 句级判罚
  for (const v of VERDICTS) {
    if (v.track !== '发言' && v.track !== '推理') continue;
    if (v.track === '推理' && v.id !== 'R1' && v.id !== 'R2') continue;
    let hit = false;
    try { hit = !!v.test(g, p, s); } catch (e) { }
    if (hit) {
      v.hits = (v.hits || 0) + 1;
      if ((samples[v.id] || []).length < 4) {
        sample(v.id, {
          seed: g._seed, night: g.night, step: g.step, pid: p.id,
          role: p.role, fac: p.faction, text: s.slice(0, 80),
          died: g.players.filter(x => x.out && x.outNight === g.night).map(x => x.id + '号/' + x.outType),
        });
      }
    }
  }
  return raw;
};

/* ============================ 钩子：推理链 =============================== */
const origChain = AI.reasoningChain;
AI.reasoningChain = function (g, p, target) {
  const r = origChain.apply(this, arguments);
  stat.chainTotal++;
  if (!r) stat.chainNull++;
  return r;
};

/* ============================ 钩子：战术 ================================ */
const origPick = Tactics.pickTactic;
Tactics.pickTactic = function () {
  const r = origPick.apply(this, arguments);
  stat.tacPick++;
  if (r && !r.text && !r.claim) {
    stat.tacDead++;
    const id = (r.opt && r.opt.id) || '?';
    stat.tacDeadIds[id] = (stat.tacDeadIds[id] || 0) + 1;
    if ((samples.S8 || []).length < 6) sample('S8', { tactic: id });
  }
  return r;
};

/* ============================ 钩子：投票 ================================ */
const origDecide = AI.decide;
AI.decide = function (g, req) {
  const d = origDecide.apply(this, arguments);
  if (req && req.kind === 'vote') {
    const p = g.players.find(x => x.id === req.pid);
    const t = (d && d.target != null) ? d.target : null;
    if (p) {
      const list = promise[p.id] || [];
      let hit = null;
      for (let i = list.length - 1; i >= 0; i--) if (list[i].night === g.night) { hit = list[i]; break; }
      if (hit && hit.target != null) {
        if (t === hit.target) {
          v_hit('A1');
        } else if (p.faction === 'human') {
          stat.a1Human++; v_hit('A1');
          if ((samples.A1 || []).length < 6) sample('A1', {
            seed: g._seed, night: g.night, pid: p.id, role: p.role, fac: p.faction,
            said: hit.target, voted: t == null ? '弃票' : t + '号', text: hit.text.slice(0, 60),
          });
        } else {
          stat.a1Alien++;
        }
      }
      const tp = t != null ? g.players.find(x => x.id === t) : null;
      if (p.faction === 'alien' && tp && tp.faction === 'alien') stat.a2Raw++;
    }
  }
  return d;
};
function v_hit(id) {
  const v = VERDICTS.find(x => x.id === id);
  if (v) v.hits = (v.hits || 0) + 1;
}

/* ============================== 跑对局 =================================== */
const games = [];
let errors = 0;
for (let seed = 1; seed <= N; seed++) {
  const g = Setup.createGame(seed, 'random');
  g.humans = []; g.humanId = -1;
  for (const p of g.players) p.isHuman = false;
  g._seed = seed;
  try {
    Engine.begin(g);
    let steps = 0;
    while (!g.over && steps < 5000) {
      steps++;
      Engine.stepOnce(g);
      if (g.pending) { try { Engine.submit(g, { opt: null, targets: [], num: null, text: '' }); } catch (e) { } }
    }
  } catch (e) { errors++; continue; }

  // A2 按后果结算：异形投出的票是否真的把队友驱逐了
  for (const r of (g.voteHistory || [])) {
    const src = r.src || {};
    for (const k of Object.keys(src)) {
      const voter = g.players.find(x => x.id === +k);
      const tgt = g.players.find(x => x.id === src[k]);
      if (!voter || !tgt || voter.faction !== 'alien' || tgt.faction !== 'alien') continue;
      if (tgt.out && tgt.outType === '驱逐') { stat.a2Harm++; }
    }
  }

  // R4 逐局收口：本局出现过改口却一次都没被任何 AI 引用 → 记为「改口未被利用」
  let sawConflict = 0, sawCited = 0;
  for (const p of g.players) {
    const m = p.mem;
    if (!m || !m.saidRole || !m.saidRole.get) continue;
    for (const [tid, rec] of m.saidRole.get.entries()) {
      if (!rec || !rec.conflictWith) continue;
      sawConflict++;
      if (citedKeys[seed + ':' + p.id + ':' + tid]) sawCited++;
    }
  }
  if (sawConflict > 0) {
    stat.r4_games++;
    if (sawCited === 0) { stat.r4_games_uncited++; }
    stat.r4_conflicts += sawConflict;
    stat.r4_cited += sawCited;
  }

  // 投票集中度
  for (const r of (g.voteHistory || [])) {
    const cnt = {};
    for (const v of Object.keys(r.src || {})) { const t = r.src[v]; if (t != null) cnt[t] = (cnt[t] || 0) + 1; }
    const total = Object.values(cnt).reduce((a, b) => a + b, 0);
    if (total >= 4) {
      const max = Math.max(...Object.values(cnt));
      (games.shareSamples || (games.shareSamples = [])).push(max / total);
    }
  }
  games.push({ seed, winner: g.winner || null, night: g.night });
}

const allText = [];
for (const k of Object.keys(lineSeen)) for (const s of lineSeen[k]) if (s.trim()) allText.push(s);
const distinct = new Set(allText);
const topFreq = {};
for (const s of allText) topFreq[s] = (topFreq[s] || 0) + 1;
const top = Object.entries(topFreq).sort((a, b) => b[1] - a[1]).slice(0, 8);

const shares = games.shareSamples || [];
const avgShare = shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : 0;
const herd = shares.filter(x => x >= 0.7).length;

const wins = {};
for (const g of games) wins[g.winner] = (wins[g.winner] || 0) + 1;

const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '—';

/* ============================== 输出 ===================================== */
const bar = n => '█'.repeat(Math.min(40, n)) || (n ? '·' : '');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║       太空杀 · AI 判官探针 v2（真人严苛度·已校准）           ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('局数：' + N + '　完成：' + games.length + '　异常：' + errors + '\n');

const ORDER = { 'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3 };
const sorted = VERDICTS.slice().sort((a, b) => (ORDER[a.sev] - ORDER[b.sev]) || ((a.hits || 0) > (b.hits || 0) ? -1 : 1));
for (const track of ['推理', '发言', '出手']) {
  const rows = sorted.filter(v => v.track === track);
  if (!rows.length) continue;
  console.log('──────── ' + track + '层判罚 ────────');
  for (const v of rows) {
    const h = v.hits || 0;
    console.log('  [' + v.sev + '] ' + v.id + ' ' + v.title);
    console.log('        命中 ' + String(h).padStart(5) + '  ' + bar(Math.round(h / Math.max(1, games.length) / 2)));
  }
  console.log('');
}

console.log('──────── 判罚样本（可独立复核）────────');
for (const v of sorted) {
  const ss = samples[v.id];
  if (!ss || !ss.length) continue;
  console.log('');
  console.log('  ▸ ' + v.id + ' [' + v.sev + '] ' + v.title);
  for (const s of ss) {
    if (v.id === 'S8') { console.log('      战术条目 ' + s.tactic); continue; }
    let line = '      seed' + s.seed + ' N' + s.night + ' ' + s.step + ' ' + s.pid + '号(' + s.fac + '/' + s.role + ')';
    if (s.died && s.died.length) line += ' 当夜出局:' + s.died.join(',');
    if (s.said !== undefined) line += ' 口称投' + s.said + '号 → 实投' + s.voted;
    console.log(line);
    console.log('        「' + s.text + '」');
  }
}

console.log('\n──────── 发言层结构 ────────');
console.log('  speak 总调用        : ' + stat.speakTotal);
console.log('  空发言              : ' + stat.speakEmpty + ' (' + pct(stat.speakEmpty, stat.speakTotal) + ')');
console.log('  第三次及以上复读    : ' + stat.dupThirdPlus + ' (' + pct(stat.dupThirdPlus, stat.speakTotal) + ')');
console.log('  句子多样性          : ' + pct(distinct.size, allText.length) + '  (' + allText.length + ' 句 / ' + distinct.size + ' 唯一)');
console.log('  最高频句子：');
for (const [s, c] of top) console.log('      ' + String(c).padStart(4) + '×  「' + s.slice(0, 50) + '」');

console.log('\n──────── 推理层 ────────');
console.log('  reasoningChain 调用 : ' + stat.chainTotal);
console.log('  返回空(null)        : ' + stat.chainNull + ' (' + pct(stat.chainNull, stat.chainTotal) + ')');
console.log('  账本记录的改口次数  : ' + stat.conflictSeen);
console.log('  其中被发言引用      : ' + stat.conflictCited + ' (' + pct(stat.conflictCited, stat.conflictSeen) + ')');
console.log('  出现过改口的局      : ' + stat.r4_games + '，其中一次都没被引用: ' + stat.r4_games_uncited
  + ' (' + pct(stat.r4_games_uncited, stat.r4_games) + ')  ← 手里有牌不打的局');

console.log('\n──────── 战术库 ────────');
console.log('  pickTactic 调用     : ' + stat.tacPick);
console.log('  死条目(无文本无动作): ' + stat.tacDead + ' (' + pct(stat.tacDead, stat.tacPick) + ')');
for (const [k, c] of Object.entries(stat.tacDeadIds).sort((a, b) => b[1] - a[1])) {
  console.log('      ' + k + ': ' + c);
}

console.log('\n──────── 出手层 ────────');
console.log('  A1 人类口称与投票不符: ' + stat.a1Human + '  ← 真人会被当场抓');
console.log('  A1 异形口称与投票不符: ' + stat.a1Alien + '  （豁免·撒谎是正确打法）');
console.log('  A2 异形投队友 原始次数: ' + stat.a2Raw);
console.log('  A2 其中导致队友被驱逐: ' + stat.a2Harm + ' (' + pct(stat.a2Harm, stat.a2Raw) + ')');

console.log('\n──────── 投票集中度 ────────');
console.log('  有效轮次(≥4票)      : ' + shares.length);
console.log('  平均最高票占比      : ' + (100 * avgShare).toFixed(1) + '%');
console.log('  ≥70% 从众轮次       : ' + herd + ' (' + pct(herd, shares.length) + ')');

console.log('\n──────── 胜负分布 ────────');
console.log('  ' + JSON.stringify(wins));
console.log('\n══════════════════════════════════════════════════════════════');
