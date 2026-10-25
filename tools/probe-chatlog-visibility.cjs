/* =============================================================
 * chatLog 可见性探针（交接文档 2026-10-25 §五 第 2 项 / 独立调查项）
 *
 * 背景：S3b-3 把「发言」页签并入「书记官档案」，档案读 `g.chatLog` **无 visible 过滤**。
 *   交接文档登记待查：「chatLog 是否含其他非公开行（异形队内等）」——若含则是既有泄露。
 *
 * 本探针只读、零随机流扰动（不改写任何游戏函数，只在对局结束后扫描数据结构）：
 *   ① 按 `kind` 统计 chatLog 条目来源，逐条判定它是否属于「公开发言」；
 *   ② 用引擎自己的唯一公开发言入口（engine.addTalk / Bridge.say 落库路径）建立
 *      「合法 kind 白名单」的**证据**，而不是凭注释猜；
 *   ③ 对每条非白名单条目，抓一条正文样本，便于人工核对泄露面。
 *
 * 判定依据（正文 v1preview1.0）：
 *   · 2.2 私聊正文不公开 —— 0c 私聊走 inbox + nightChats，不入 chatLog；
 *   · 3.3④ / 5.10 队内共享仅队内可见 —— 0c 队内频道与白天队内密谈走 inbox + factionLog；
 *   · 只有「讨论 / 会议 / 开局 / 留言（遗言）」这类公开发言才该进 chatLog。
 *
 * 用法：node tools/probe-chatlog-visibility.cjs [对局数=60] [起始种子=1]
 * ============================================================= */
'use strict';
const path = require('path');
const { makeCtx, loadInto, profiles } = require('./load-order.cjs');
const SeatMode = require('./seat-mode.cjs');

const N = parseInt(process.argv[2] || '60', 10);
const SEED0 = parseInt(process.argv[3] || '1', 10);

const ctx = makeCtx();
loadInto(ctx, path.join(__dirname, '..', 'js'), profiles.full);
const { Setup, Engine } = ctx;

/* 合法 kind 白名单：来自 addTalk 的三个调用点与 Bridge.say 的 kind 取值
   （engine.talk 传 '会议'/'开局'/'讨论'；steps 留言传 '留言'；M-speech 传 '会议'）。
   注意这是**当前实现**的证据，不是规范——规范只认「公开发言」这一语义。 */
const PUBLIC_KINDS = new Set(['讨论', '会议', '开局', '留言']);

const kindCount = new Map();
const badSamples = [];
let totalRows = 0, badRows = 0, games = 0, errs = 0;
/* 顺带量：chatLog 与 inbox 的重合度（若队内/私聊正文同时出现在 chatLog，重合会非零） */
let inboxOverlap = 0;

for (let i = 0; i < N; i++) {
  const seed = SEED0 + i;
  let g;
  try {
    g = SeatMode.seatGame(Setup, seed, 'random');
    g.humans = [];
    g.humanId = -1;
    for (const p of g.players) p.isHuman = false;
    Engine.begin(g);
    let steps = 0;
    while (!g.over && steps < 5000) {
      steps++;
      Engine.stepOnce(g);
      if (g.pending) Engine.submit(g, { opt: null, targets: [], num: null, text: '' });
    }
    games++;
    for (const row of (g.chatLog || [])) {
      totalRows++;
      kindCount.set(row.kind, (kindCount.get(row.kind) || 0) + 1);
      if (!PUBLIC_KINDS.has(row.kind)) {
        badRows++;
        if (badSamples.length < 12) badSamples.push({ seed, night: row.night, kind: row.kind, id: row.id, text: row.text });
      }
    }
    /* inbox 重合：把每个玩家的私聊/队内 inbox 行与 chatLog 正文比对（同夜同文） */
    const texts = new Set((g.chatLog || []).map(r => r.night + '|' + String(r.text)));
    for (const p of g.players) {
      for (const e of (p.inbox || [])) {
        if (!/（私聊）：|（队内）：|（队内·白天）：/.test(e.text)) continue;
        if (texts.has(e.night + '|' + String(e.text))) inboxOverlap++;
      }
    }
  } catch (e) {
    errs++;
    console.error('seed ' + seed + ' 异常: ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : String(e)));
  }
}

console.log('===== chatLog 可见性探针 =====');
console.log('对局 ' + games + '（种子 ' + SEED0 + '~' + (SEED0 + N - 1) + '）  异常 ' + errs);
console.log('chatLog 总条目 ' + totalRows + ' 条');
console.log('按 kind 分布: ' + [...kindCount.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + '=' + v).join(' · '));
console.log('非公开发言 kind 条目 ' + badRows + ' 条（占 ' + (totalRows ? (badRows / totalRows * 100).toFixed(2) : '0') + '%）');
console.log('私聊/队内 inbox 与 chatLog 正文重合 ' + inboxOverlap + ' 条（>0 即 chatLog 混入非公开行）');
if (badSamples.length) {
  console.log('样本（前 ' + badSamples.length + ' 条）:');
  for (const s of badSamples) console.log('  seed ' + s.seed + ' · 第' + s.night + '夜 · ' + s.kind + ' · ' + s.id + ' 号：' + String(s.text).slice(0, 60));
}
console.log(badRows === 0 && inboxOverlap === 0 ? '结论：chatLog 只含公开发言（无泄露）' : '结论：chatLog 含非公开发言（泄露）');
process.exit(badRows === 0 && inboxOverlap === 0 ? 0 : 2);
