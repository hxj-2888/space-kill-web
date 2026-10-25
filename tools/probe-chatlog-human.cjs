/* =============================================================
 * chatLog 可见性探针 · 真人路径（交接文档 2026-10-25 §五 第 2 项的正题）
 *
 * 为什么需要第二个探针：
 *   probe-chatlog-visibility.cjs 全程 `p.isHuman=false`（纯 AI 对局），
 *   它证明的是「AI 产出的发言不会混进 chatLog」——但交接文档点名的口径是
 *   「**0c 私聊正文不进 chatLog**（走 form 的 text 槽）」，那是**真人提交**路径。
 *   AI 对局里 0c 走 `AI.speak(...,true)`，真人走 `Engine.submit({text})`→`decisions.text`，
 *   两条路径在 steps.js 的 0c run 里汇合但**入口不同**——不覆盖就等于没测。
 *
 * 设计（含阳性对照，防止"探针本身失效"伪装成"无泄露"）：
 *   · 真人席位每一局都注入**带唯一标记的正文**：
 *       私聊/队内（kind=chat）→ 标记 A（**不得**出现在 chatLog）
 *       公开发言              → 标记 B（**必须**出现在 chatLog，阳性对照）
 *   · 对局结束后：
 *       ① 在 chatLog 里搜标记 A —— 命中即泄露（FAIL）
 *       ② 在 chatLog 里搜标记 B —— 未命中说明探针没跑通（FAIL，避免假阴性）
 *   · 只读：不包装任何游戏函数，不消费随机流（红线 3）。
 *
 * ⚠ 投递入口不是同一个（首版探针在这里搞错过，阳性对照直接 0 命中）：
 *     · 0c 私聊/队内（chat）：走 `Engine.submit({text})` → `decisions.text` → steps.js 0c run 读它；
 *     · 白天讨论（talk）：走 **`Engine.talk(g, hid, text)` 实时入口**（main.js 的 Game.talk 同款），
 *       D-talk 的 run **根本不读 decisions.text** —— 把正文塞进 submit 会被静默丢弃。
 *     · 验票官专属发言（speech）：走 submit 的 text 槽（toDecision 有 'speech' 分支）。
 *
 * 用法：node tools/probe-chatlog-human.cjs [对局数=60] [起始种子=1]
 * 退出：0 = 无泄露且阳性对照成立；2 = 泄露；3 = 阳性对照未成立（探针失效）
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

/* 标记必须足够独特，且**不能**含会被 NLP/清洗改写的字符（否则搜不到是探针的问题） */
const MARK_PM = 'ZQPM';     // 私聊 / 队内正文
const MARK_PUB = 'ZQPUB';   // 公开发言（阳性对照）

let leakRows = 0, ctrlRows = 0, pmSubmitted = 0, pubSubmitted = 0;
const leakSamples = [];
let games = 0, errs = 0, gamesWithPm = 0, gamesWithCtrl = 0;

for (let i = 0; i < N; i++) {
  const seed = SEED0 + i;
  let g;
  try {
    g = SeatMode.seatGame(Setup, seed, 'random');
    const hid = g.humanId;
    Engine.begin(g);
    let steps = 0;
    let pmSent = 0, pubSent = 0;
    while (!g.over && steps < 5000) {
      steps++;
      Engine.stepOnce(g);
      const p = g.pending;
      if (p) {
        /* 只处理**真人自己的**表单；其余 pending 交空决策（引擎会跳过 AI 的） */
        const mine = p.pid == null || p.pid === hid || g.pendings[hid];
        let data = { opt: null, targets: [], num: null, text: '' };
        if (mine && p.kind === 'chat') {
          data.text = MARK_PM + '-' + seed + '-' + (++pmSent);
        } else if (mine && p.kind === 'talk') {
          /* ⚠ 讨论走实时入口 Engine.talk，不经 submit 的 text 槽（见文件头） */
          const txt = MARK_PUB + '-' + seed + '-' + (++pubSent);
          if (Engine.talk(g, hid, txt, null, null)) pubSubmitted++;
        } else if (mine && p.kind === 'speech') {
          data.text = MARK_PUB + '-' + seed + '-' + (++pubSent);
        } else if (mine && p.kind === 'inviteAccept') {
          data.opt = 'yes';                       // 尽量促成配对，让 0c 私聊真的发生
        } else if (mine && p.kind === 'invite') {
          const others = Engine.alive(g).filter(x => x.id !== hid);
          if (others.length) data.targets = [others[0].id];
        }
        Engine.submit(g, data);
      }
    }
    games++;
    if (pmSent) { gamesWithPm++; pmSubmitted += pmSent; }
    if (pubSent) { gamesWithCtrl++; pubSubmitted += pubSent; }

    /* ① 泄露检查：私聊/队内正文不得出现在 chatLog */
    for (const row of (g.chatLog || [])) {
      if (String(row.text || '').indexOf(MARK_PM) >= 0) {
        leakRows++;
        if (leakSamples.length < 10) leakSamples.push({ seed, night: row.night, kind: row.kind, text: String(row.text).slice(0, 70) });
      }
      if (String(row.text || '').indexOf(MARK_PUB) >= 0) ctrlRows++;
    }
  } catch (e) {
    errs++;
    console.error('seed ' + seed + ' 异常: ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : String(e)));
  }
}

console.log('===== chatLog 可见性探针 · 真人路径 =====');
console.log('对局 ' + games + '（种子 ' + SEED0 + '~' + (SEED0 + N - 1) + '）  异常 ' + errs);
console.log('真人私聊/队内提交 ' + pmSubmitted + ' 条（' + gamesWithPm + '/' + games + ' 局有提交）');
console.log('真人公开发言提交 ' + pubSubmitted + ' 条（' + gamesWithCtrl + '/' + games + ' 局有提交）');
console.log('① 私聊/队内正文混入 chatLog：' + leakRows + ' 条' + (leakRows ? '（泄露）' : '（无泄露）'));
console.log('② 阳性对照：公开发言进入 chatLog：' + ctrlRows + ' 条' + (ctrlRows ? '（探针有效）' : '（探针失效）'));
if (leakSamples.length) {
  console.log('泄露样本：');
  for (const s of leakSamples) console.log('  seed ' + s.seed + ' · 第' + s.night + '夜 · ' + s.kind + '：' + s.text);
}

if (leakRows > 0) {
  console.log('结论：真人私聊/队内正文**混入** chatLog —— 书记官档案会泄露（FAIL）');
  process.exit(2);
}
if (ctrlRows === 0) {
  console.log('结论：阳性对照未成立 —— 探针没跑到公开发言路径，本次结果不可信（FAIL）');
  process.exit(3);
}
console.log('结论：真人私聊/队内正文不进 chatLog，公开发言正常进入（口径成立）');
process.exit(0);
