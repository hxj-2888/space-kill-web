/* =============================================================
 * 真人视角推演：让一个「只用玩家可见信息」的模型当人类席位，打 N 局。
 * =============================================================
 *
 * 目的：**站到玩家那一侧看**。此前所有量测都是 AI 对真相（parity-sim/referee），
 * 从来没有人从「玩家能看见什么」的角度检验过这游戏。
 *
 * ⚠ 三条纪律：
 *   ① **玩家模型拿不到 g。** tools/human-player.cjs 的 play/decide 签名里没有 g，
 *      它拿到的唯一输入是 View.build(g, myId) 的返回值 —— 防火墙是**结构保证**，
 *      不是运行期监控。谁往那儿塞一个 g 参数，防火墙当场失效。
 *   ② **目标名单也从视图重建。** 表单只给「池描述 + 上限」，名单由玩家自己从
 *      view.players 里列（真人在界面上看到的也是一份名单）。
 *      ⚠ 首版探针在这里犯过错：它用 Engine.alive(g) 取名单，顺手 print 了每个人的
 *      真实职业，看起来像游戏在泄露，其实是我在作弊。
 *   ③ **只报玩家侧的事实，不报「好不好玩」。** 玩家模型不是人，问不出体验。
 *      报告里把「界面/规则的缺陷」与「模型能力不足」分栏，两者不可混。
 *
 * 驱动说明：讨论流（`D-talk`/`M-talk`）的发言排程只由 Game.tick 推进
 *（main.js:97 调 Engine.streamPump）；本驱动直接用引擎，故自行调用
 * `Engine.streamPump(g, Infinity)` 把发言一次跑完 —— 否则没人发言。
 * ⚠ 但**不能**在「本步有 pending」时也去 pump：真人提交的表单里带 `text`
 *   （他的发言），pump 会让 AI 抢先发言、真人的发言反而落在 AI 之后。
 *   故只在无 pending 时 pump —— 那正是「真人已经说完，该 AI 说了」的时点。
 *
 * 运行：node tools/play-human.cjs <仓库根> <局数> <起始种子>
 * 退出：0 正常；1 有玩家侧摩擦命中（不视为失败，只作报告）
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = (process.argv[2] || process.cwd()).replace(/[\\/]+$/, '');
const N = Number(process.argv[3] || 100);
const SEED0 = Number(process.argv[4] || 1200);
const OUT = path.join(ROOT, 'tools', 'play-human-report.json');

const lo = require(path.join(ROOT, 'tools', 'load-order.cjs'));
const ctx = lo.makeCtx({ RegExp });
lo.loadInto(ctx, path.join(ROOT, 'js'), lo.profiles.full);
/* view.js 是玩家视角的唯一构建器（profiles.ui 里的第一件）。不在 full 里，必须补载 ——
   与 parity-sim 同因：不补载就等于在量一个产品里不存在的路径。 */
lo.loadInto(ctx, path.join(ROOT, 'js'), ['view']);
if (!ctx.View || typeof ctx.View.build !== 'function') throw new Error('View.build 不可用 —— 玩家侧无从谈起');

const { Setup, Engine, View } = ctx;
const P = require(path.join(ROOT, 'tools', 'human-player.cjs'));
const NLP = ctx.NLP;

/* 一步一步地只把表单交给玩家。表单本身也是玩家能看见的东西（真人看得见菜单）。 */
function pendingOf(g) { return g.pending || null; }

const agg = {
  games: [], totals: {}, friction: {}, blind: 0, decisions: 0,
  kindCount: {}, descClause: 0, descTotal: 0, descSamples: [],
  hardInfo: {}, inboxKinds: {}, unknowns: {}, notesSample: [],
  roleWin: {}, roleGames: {}, roleDecisions: {},
  speech: { said: 0, parsedAsClaim: 0, parsedAsAccuse: 0, ignored: 0, selfAccuse: 0, samples: [] },
  inboxTexts: {},
};

/* 描述里带条款号的表单 —— 玩家没法查条款号，这是「界面在引手册而不是在解释」的代理指标 */
const CLAUSE_RE = /[（(]?\s*\d+\.\d+(\.\d+)?\s*[）)]?\s*[、，,。；;]?/;

function tally(t, k) { t[k] = (t[k] || 0) + 1; }

for (let gi = 0; gi < N; gi++) {
  const seed = SEED0 + gi;
  const seat = 1 + (gi % 12);
  /* ⚠⚠ **三处必须一起改**，这是本工具踩过的最深的一个坑：
   *   state.js:308-310 把它们当一个整体写：
   *     g.humanId = hid;  g.humans = [hid];  g.players.forEach(p => p.isHuman = p.id === hid)
   *   而引擎**两处读法不同**：
   *     · `req` 用 `alive(g).filter(p => p.isHuman)`      —— 决定「谁拿到表单」
   *     · `humSet` 用 `g.humans || [g.humanId]`           —— 决定「谁不算 AI 发言者」
   *   只改 isHuman 不改 humans ⇒ 表单**一个都不派发**（因为 req 过滤的是 isHuman，
   *   而预置的 isHuman 已被我关掉了），同时 AI 替那个被 humSet 排除的席位发言。
   *   实测症状：`talk` 表单一局都不出现，白天讨论里 AI 冒充玩家说话。
   *   首版正是这个错，而且**不报错、不抛异常，只是安静地量错了东西**。
   *   这与仓库已登记的 `g.step` 时点、view.js 不在 profiles.full 是同一族陷阱：
   *   **身份/时点/剖面错了不会崩，只会安静地给出错的数。**
   *   这三行照抄 state.js:308-310，且都在 createGame 之后 —— 不消耗 rng，指纹中性。 */
  const g = Setup.createGame(seed, 'random', { seatPicks: Setup.rollSeatPicks(seed) });
  g.humanId = seat;
  g.humans = [seat];
  for (const p of g.players) p.isHuman = (p.id === seat);
  Engine.begin(g);

  let mem = P.newMem(NLP);
  const rec = { seed, seat, turns: 0, kinds: {}, blind: 0, friction: [], inbox: [], steps: 0, firstTurn: null };
  let guard = 0;

  while (!g.over && guard++ < 6000) {
    Engine.stepOnce(g);
    rec.steps++;
    const f = pendingOf(g);
    if (!f) {
      if (g.stream && g.stream.idx < g.stream.speakers.length) Engine.streamPump(g, Infinity);
      continue;
    }
    /* —— 玩家只看得到视图 —— */
    const v = View.build(g, seat);
    if (!v) break;
    mem = claimsFromTalksSafe(v, mem);
    const roleName = v.players[seat - 1].roleName || '?';
    if (!rec.firstTurn) rec.firstTurn = { kind: f.kind, role: roleName };

    const ans = P.decide(v, f, mem);
    rec.turns++;
    tally(rec.kinds, f.kind);
    tally(agg.kindCount, f.kind);
    agg.decisions++;
    /* 盲目计数取**本步增量**：decide() 只置标志，累加在这里做。
       首版在这里加 mem.blind 的累计值，2183 次决策报出 7157 次（327.9%）。 */
    const blindNow = mem.blindMark || 0;
    if (blindNow > (mem.__blindMark || 0)) {
      const d = blindNow - (mem.__blindMark || 0);
      rec.blind += d; agg.blind += d;
      mem.__blindMark = blindNow;
    }
    agg.friction = mergeCount(agg.friction, mem.friction.slice(mem.__mark || 0));
    mem.__mark = mem.friction.length;
    tally(agg.roleDecisions, roleName);

    /* 描述可读性代理指标 */
    if (f.desc) {
      agg.descTotal++;
      if (CLAUSE_RE.test(f.desc)) {
        agg.descClause++;
        if (agg.descSamples.length < 6 && agg.descSamples.every(s => s.kind !== f.kind))
          agg.descSamples.push({ kind: f.kind, desc: String(f.desc).replace(/\s+/g, ' ').slice(0, 120) });
      }
    }
    /* 私人反馈：玩家这局到底拿到了什么可用的情报 */
    const me = v.players[seat - 1];
    if (me && Array.isArray(me.inbox)) {
      for (const m of me.inbox.slice(-1)) {
        const raw = String((m && m.text) || JSON.stringify(m));
        const k = inboxKind(raw);
        tally(agg.inboxKinds, k);
        const tpl = raw.replace(/[0-9]+/g, '#').replace(/「[^」]*」/g, '「X」').slice(0, 46);
        agg.inboxTexts[tpl] = (agg.inboxTexts[tpl] || 0) + 1;
        if (rec.inbox.length < 6) rec.inbox.push(String((m && m.text) || JSON.stringify(m)).slice(0, 80));
      }
    }
    const facts = P.hardFacts(v, seat);
    rec.lastFacts = facts.length;

    Engine.submit(g, ans);
  }

  const meRole = (g.players[seat - 1].originRole || g.players[seat - 1].role);
  tally(agg.roleGames, meRole);
  const won = g.winner === 'human' || (meRole !== 'alien' && meRole !== 'xeno');
  /* 胜负归属按阵营判：异形/外星人席位属于该阵营 */
  const myFaction = g.players[seat - 1].faction;
  const win = g.winner === myFaction;
  tally(agg.roleWin, meRole + (win ? ':win' : ':lose'));
  rec.role = meRole; rec.faction = myFaction;
  rec.winner = g.winner; rec.win = win; rec.night = g.night;
  rec.aliveEnd = g.players.filter(p => !p.out).length;
  rec.over = !!g.over;
  for (const k of ['said', 'parsedAsClaim', 'parsedAsAccuse', 'ignored', 'selfAccuse'])
    agg.speech[k] = (agg.speech[k] || 0) + ((mem.speech && mem.speech[k]) || 0);
  if (mem.speech && mem.speech.samples) for (const x of mem.speech.samples) {
    if (agg.speech.samples.length < 10) agg.speech.samples.push(x);
  }
  if (mem.unknownKind) for (const k of Object.keys(mem.unknownKind)) tally(agg.unknowns, k);
  if (agg.notesSample.length < 8) for (const n of mem.notes.slice(0, 2)) agg.notesSample.push('种子' + seed + ' ' + n);
  agg.games.push(rec);
}

function claimsFromTalksSafe(v, mem) {
  if (!NLP) return mem;
  for (const t of (v.talks || [])) {
    if (mem.saidLen[t.id] != null) continue;
    const sig = NLP.parse(t.text, { speaker: t.id });
    if (!sig) continue;
    mem.saidLen[t.id] = (t.text || '').length;
    if (sig.role) mem.claimOf[t.id] = sig.role;
  }
  return mem;
}
function inboxKind(s) {
  /* 分类表按**玩家实际收到的文本**写（样本由本工具实地收集），不按代码里的函数名写 ——
     前者才是玩家能感知到的东西。分四层：情报 / 自身状态 / 自身进程 / 结算告知。
     为什么要分层：前四类之外的「进度 #/#」类通知占了未归类的大头，
     而它们**不是情报** —— 把进度通知算成「玩家拿到了情报」会高估信息量。 */
  /* —— 情报：关于别人的、能改变判断的 —— */
  if (/查验结果：/.test(s)) return '情报·查验结果（神探）';
  if (/吗——/.test(s)) return '情报·查验作答（船员）';
  if (/落身致死来源/.test(s)) return '情报·致死来源（救援后）';
  if (/嗅探：/.test(s)) return '情报·嗅探结果';
  if (/武装识别/.test(s)) return '情报·武装识别';
  if (/被『|被「/.test(s) && /查验/.test(s)) return '情报·被查验告知';
  if (/\(私聊\)|（私聊）/.test(s)) return '情报·私聊内容';
  if (/（队内）/.test(s)) return '情报·队内频道';
  if (/你身上出现感染标记|将于第.*夜致死/.test(s)) return '情报·自己被感染';
  if (/下毒|毒已被解除/.test(s)) return '情报·被下毒/解毒';
  if (/已暴露：编号与职业已向全体/.test(s)) return '情报·自己暴露';
  /* —— 自身状态变更（不是情报，是后果）—— */
  if (/自救成功|你被医生救回|清除感染并获得抗体/.test(s)) return '状态·治疗/救援结果';
  if (/夜晚免疫消耗/.test(s)) return '状态·夜晚免疫消耗';
  if (/护甲被打破|你获得一件护甲/.test(s)) return '状态·护甲变动';
  if (/你已转职为/.test(s)) return '状态·转职完成';
  if (/你已觉醒/.test(s)) return '状态·觉醒';
  if (/你已进入安全室/.test(s)) return '状态·进入安全室';
  if (/感染抑制生效/.test(s)) return '状态·感染抑制生效';
  if (/沉默/.test(s)) return '状态·被沉默';
  if (/保护/.test(s)) return '状态·保护告知';
  if (/濒死/.test(s)) return '状态·濒死告警';
  if (/你的攻击生效|无效/.test(s)) return '状态·攻击结果';
  if (/你已进化为|转化完成|转化进行中/.test(s)) return '状态·进化/转化';
  if (/你已变形为/.test(s)) return '状态·变形完成';
  /* —— 自身进程与额度（长夜里反复出现的进度条）—— */
  if (/进度.*#\/#/.test(s)) return '进程·进度推进';
  if (/产物|到账|获得.*次|获得.*发|额外获得/.test(s)) return '进程·产物到账';
  if (/驱逐|投票|票/.test(s)) return '结算·投票相关';
  if (/出局|死亡/.test(s)) return '结算·出局相关';
  return '进程·其他';
}
function mergeCount(acc, arr) {
  for (const x of arr) { const k = x.type + '/' + x.kind + (x.field ? '.' + x.field : ''); acc[k] = (acc[k] || 0) + 1; }
  return acc;
}

/* ---------- 汇总 ---------- */
const g0 = agg.games;
const finished = g0.filter(r => r.over).length;
const humanWins = g0.filter(r => r.win).length;
const totalTurns = g0.reduce((a, r) => a + r.turns, 0);

console.log('══ 真人视角推演 ══');
console.log('局数 ' + N + '（种子 ' + SEED0 + '..' + (SEED0 + N - 1) + '），人类席位 1..12 轮换');
console.log('正常终局 ' + finished + '/' + N + '；人类侧胜 ' + humanWins + '/' + N
  + '（' + (100 * humanWins / N).toFixed(1) + '%）');
console.log('决策总数 ' + agg.decisions + '，平均每局 ' + (totalTurns / N).toFixed(1) + ' 次');
console.log('');
console.log('—— 决策种类分布 ——');
Object.entries(agg.kindCount).sort((a, b) => b[1] - a[1]).forEach(([k, n]) =>
  console.log('  ' + k.padEnd(14) + n));
console.log('');
console.log('—— 玩家侧摩擦（表单让玩家没法好好填）——');
const fr = Object.entries(agg.friction).sort((a, b) => b[1] - a[1]);
if (!fr.length) console.log('  （本次未命中）');
fr.forEach(([k, n]) => console.log('  ' + k.padEnd(30) + n));
console.log('');
console.log('—— 盲目决策（候选之间无任何可分辨信息，等于掷骰子）——');
console.log('  ' + agg.blind + ' / ' + agg.decisions + ' = ' + (100 * agg.blind / agg.decisions).toFixed(1) + '%');
console.log('');
console.log('—— 私人反馈种类（玩家这局到底拿到了什么情报）——');
Object.entries(agg.inboxKinds).sort((a, b) => b[1] - a[1]).forEach(([k, n]) =>
  console.log('  ' + k.padEnd(14) + n));
console.log('');
console.log('—— 玩家主动性：我说的话被语言层认出来了吗 ——');
const sp = agg.speech;
console.log('  发言 ' + sp.said + ' 条：被认成身份声称 ' + (sp.parsedAsClaim || 0)
  + '  指控 ' + (sp.parsedAsAccuse || 0) + '  完全没被理解 ' + (sp.ignored || 0)
  + '  其中**把自己也列成指控对象** ' + (sp.selfAccuse || 0));
for (const x of sp.samples) console.log('    ' + x);
console.log('');
console.log('—— 私人反馈文本模板（掩码后，玩家这局到底被告知了什么）——');
Object.entries(agg.inboxTexts).sort((a, b) => b[1] - a[1]).slice(0, 14)
  .forEach(([k, n]) => console.log('  ' + String(n).padStart(4) + '  ' + k));
console.log('');
console.log('—— 表单描述带条款号的比例（玩家没法查条款号）——');
console.log('  ' + agg.descClause + ' / ' + agg.descTotal + ' = '
  + (100 * agg.descClause / Math.max(1, agg.descTotal)).toFixed(1) + '%');
for (const s of agg.descSamples) console.log('    ' + s.kind + '：' + s.desc);
console.log('');
console.log('—— 玩家模型未覆盖的 kind（模型能力不足，不是游戏缺陷）——');
const uk = Object.keys(agg.unknowns);
console.log(uk.length ? '  ' + uk.map(k => k + '×' + agg.unknowns[k]).join('  ') : '  （无）');
console.log('');
console.log('—— 各职业被真当人玩的局数与胜率 ——');
for (const r of Object.keys(agg.roleGames).sort()) {
  const w = agg.roleWin[r + ':win'] || 0;
  console.log('  ' + r.padEnd(12) + agg.roleGames[r] + ' 局，胜 ' + w
    + '（' + (100 * w / agg.roleGames[r]).toFixed(0) + '%）');
}
console.log('');
fs.writeFileSync(OUT, JSON.stringify(agg, null, 1), 'utf8');
console.log('已写出 ' + OUT);
process.exitCode = 0;