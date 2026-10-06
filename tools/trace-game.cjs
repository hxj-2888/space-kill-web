#!/usr/bin/env node
/* =============================================================
 * 太空杀 · 单局轨迹推演（观察侧探针，非门禁）
 *
 * 用途：把一整局跑完并把**推理链的每一步**打印出来——夜间决策（AI 选了什么、
 *       效用多少）、公开发言（含 Claim 意图）、推理读数（怀疑度/危险度/信念分布）、
 *       证据表（tEvents）、通道命中、投票与出局揭示，最后给结算读数（AUC 分阵营/分阶段）。
 *
 * 与 mc.cjs 的分工：mc 是**批量统计**（AUC/盲区/败法分布），本工具是**单局可读性**——
 * 回答「这一局 AI 到底在想什么、想对了没有」。
 *
 * 治理口径（docs/防指标博弈治理规范.md）：
 *   · 本工具**只读不写**：不改对局状态、不产出断言、不进任何 gate；读数仅供人工判读。
 *   · AUC 计算与 mc.cjs **同源同式**（Mann-Whitney，同一辅助函数），保证两处读数可比。
 *   · 种子约定：1-100 为调试区间（本工具默认种子 7），101-500 为验证区间。
 *
 * 用法：
 *   node tools/trace-game.cjs                      # 默认种子 7，经典局
 *   node tools/trace-game.cjs 42                   # 指定种子
 *   node tools/trace-game.cjs 42 --verbose         # 追加：逐人推理快照 + 证据表
 *   node tools/trace-game.cjs 42 --hunter          # 猎杀席位变体为猎手
 *   node tools/trace-game.cjs 42 --listener        # 社交席位变体为窃听者
 *   node tools/trace-game.cjs 42 --quiet           # 只打摘要（跳过逐夜细节）
 * ============================================================= */
'use strict';
const path = require('path');
const { makeCtx, loadInto, profiles } = require('./load-order.cjs');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith('--')));
const positional = argv.filter(a => !a.startsWith('--'));
const SEED = parseInt(positional[0] || '7', 10);
const VERBOSE = flags.has('--verbose');
const QUIET = flags.has('--quiet');

/* 席位变体（1.1.1 同席位开局定其一） */
const picks = {};
if (flags.has('--hunter')) picks.sheriff = 'hunter';
if (flags.has('--listener')) picks.inspector = 'listener';
if (flags.has('--poisoner')) picks.rescue = 'poisoner';

const base = path.join(__dirname, '..', 'js');
const ctx = makeCtx({ RegExp });
loadInto(ctx, base, profiles.full);
const { Setup, Engine, AI, MoE } = ctx;
const D = ctx.SKData;

/* ---------- Mann-Whitney AUC（与 mc.cjs 同式，保证读数可比） ---------- */
function auc(pos, neg) {
  if (!pos.length || !neg.length) return null;
  const all = pos.map(s => ({ s, p: 1 })).concat(neg.map(s => ({ s, p: 0 }))).sort((a, b) => a.s - b.s);
  let r = 1, rankSumPos = 0, i = 0;
  while (i < all.length) {
    let j = i; while (j < all.length && all[j].s === all[i].s) j++;
    const avg = r + (j - i - 1) / 2;
    for (let k = i; k < j; k++) if (all[k].p) rankSumPos += avg;
    r += j - i; i = j;
  }
  const n1 = pos.length, n0 = neg.length;
  return (rankSumPos - n1 * (n1 + 1) / 2) / (n1 * n0);
}
const phaseOfNight = n => (n <= 3 ? '开局' : n <= 5 ? '中期' : '残局');
const frac = v => (v === null || v === undefined ? '—' : v.toFixed(3));

/* ---------- 输出原语 ---------- */
const L = (s = '') => { if (!QUIET) console.log(s); };
const H1 = s => console.log('\n' + '═'.repeat(78) + '\n  ' + s + '\n' + '═'.repeat(78));
const H2 = s => { if (!QUIET) console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 74 - s.length))); };

/* 阵营真相标记（仅观察者视角，非 AI 可读信息） */
const truthMark = p => (p.faction === 'human' ? ' ' : p.faction === 'alien' ? '◆' : '★');
const FNAME = { human: '人类', alien: '异形', xeno: '外星人' };
const bar = v => '█'.repeat(Math.round(v / 5)).padEnd(20, '·');

/* ---------- 玩家展示（观察者视角） ---------- */
const tag = p => `${String(p.id).padStart(2)}号 ${truthMark(p)}${p.roleName}`;

/* 硬源锁定的可见性来源（供证据表标注「这条推理有硬源背书」） */
const hardSourceOf = (g, viewer, id) => {
  const k = viewer.known.get(id);
  if (!k) return null;
  return k.faction ? FNAME[k.faction] + (k.role ? '·' + (D.ROLES[k.role] ? D.ROLES[k.role].name : k.role) : '')
                    : (k.role ? '职业·' + (D.ROLES[k.role] ? D.ROLES[k.role].name : k.role) : '职业');
};

/* 夜间决策的可见摘要：AI 到底选了什么 */
const decisionSummary = (g, p, step) => {
  const d = g.decisions[p.id];
  if (!d) return null;
  switch (step) {
    case '2':
      if (p.role === 'crew') return d.mode === 'check' ? `查验 ${d.target} 号·问「${(d.ids || []).join('/')}」`
        : d.mode === 'repair' ? `协助维修 −${d.value}` : '放弃';
      if (p.role === 'detective') return d.mode === 'check' ? `查验 ${d.target} 号`
        : d.mode === 'announce' ? `公告 ${d.target} 号` : '放弃';
      if (p.role === 'sheriff') return d.patrol ? `巡逻 ${(d.targets || []).join('/')}` : '不巡逻';
      return null;
    case '6': return d.mode === 'gather' ? '攒弹' : d.mode === 'none' ? '放弃'
      : `开枪 → ${(d.targets || []).join('/')}（${(d.targets || []).length} 发）`;
    case '3.5': return (d.targets || []).length ? `嗅探 ${d.targets.join('/')}` : '不嗅探';
    case '4a': return d.do ? `维修 ${(d.value ?? 1).toFixed(1)}${d.extra ? '+追加' : ''}` : '不维修';
    case '3': return d.target != null ? `保护 ${d.target} 号` : (d.opt === 'yes' ? '进安全室' : '放弃');
    case '4b': return d.branch === 'destroy' ? `破坏 +${((d.num || 20) / 10).toFixed(1)}`
      : d.branch === 'cocoon' ? `结茧 → ${d.cocoonTarget}` : '保留步骤 7';
    case '8': return d.act === 'none' ? '放弃' : `${d.act}${d.product ? '·' + d.product : ''} → ${(d.targets || []).join('/') || '—'}`;
    case '9': case '0.55': case '11': case '0.6': return null;
    case '1': return d.opt && d.opt !== 'none' ? `乔装为「${D.ROLES[d.opt] ? D.ROLES[d.opt].name : d.opt}」` : '不乔装';
    default: return null;
  }
};

const BRIEF_STEPS = new Set(['1', '2', '3', '3.5', '4a', '4b', '8', '6', '7']);

/* ---------- 主流程 ---------- */
const g = Setup.createGame(SEED, 'random', Object.keys(picks).length ? { seatPicks: picks } : undefined);
g.humans = []; g.humanId = -1;
for (const p of g.players) p.isHuman = false;

/* AUC 采样：怀疑度排序的 Mann-Whitney AUC（0.5＝瞎猜，1.0＝透视）。
   口径**与 mc.cjs 逐条对齐**——队友是硬信息，必须排除在 pos/neg 之外，否则 AUC 恒为 1：
     人类观察者：pos＝异形+外星人，neg＝人类
     异形观察者：pos＝人类，        neg＝外星人（非队友）
     外星人观察者：pos＝异形，      neg＝人类 */
const aucBuf = { byFaction: { human: [], alien: [], xeno: [] }, byPhase: { 开局: [], 中期: [], 残局: [] } };
const phaseOf = n => phaseOfNight(n);
function sampleAUC(force) {
  const al = Engine.alive(g);
  for (const p of al) {
    const others = al.filter(x => x.id !== p.id);
    let pos, neg;
    if (p.faction === 'human') { pos = others.filter(x => x.faction !== 'human'); neg = others.filter(x => x.faction === 'human'); }
    else if (p.faction === 'alien') { pos = others.filter(x => x.faction === 'human'); neg = others.filter(x => x.faction === 'xeno'); }
    else { pos = others.filter(x => x.faction === 'alien'); neg = others.filter(x => x.faction === 'human'); }
    if (!pos.length || !neg.length) continue;
    /* 冷启动夜全员先验相同、无人有信息 → AUC 恒等于 0.5 的噪声样本，默认跳过 */
    if (!force && !p.known.size && !p.tEvents.size) continue;
    const a = auc(pos.map(x => AI.suspOf(g, p, x.id)), neg.map(x => AI.suspOf(g, p, x.id)));
    if (a == null || !isFinite(a)) continue;
    aucBuf.byFaction[p.faction].push(a);
    if (p.faction === 'human') aucBuf.byPhase[phaseOf(g.night)].push(a);
  }
}

Engine.begin(g);

H1(`太空杀 · 单局轨迹推演　种子 ${SEED}${Object.keys(picks).length ? '　变体：' + Object.keys(picks).join(',') : '　（经典局）'}`);
L('【说明】◆ 异形　★ 外星人　—— 该标记为观察者视角的真实阵营，AI 不可读。');
H2('开局构成（批次〇）');
for (const e of g.log.filter(e => e.batch === '〇')) L('  ' + e.text);
L('');
for (const p of g.players) {
  const known = [...p.known.entries()].map(([id, k]) => {
    const nm = D.ROLES[k.role] ? D.ROLES[k.role].name : (k.role || '');
    return `${id}号(${k.faction ? FNAME[k.faction] : '职业'}${nm ? '·' + nm : ''})`;
  });
  L(`  ${tag(p)}  ${known.length ? '已知：' + known.join('、') : '已知：无'}`);
}
sampleAUC(true);

/* ---------- 逐夜推进 ----------
   驱动原则：日志游标（logCursor）＋阶段检测，而非「比对上一步」——
   后者会在同一 stepDone 上反复命中，把同一条公告打印多次（首版即如此）。 */
let steps = 0;
let logCursor = g.log.length;          // begin() 的开局公告已单独打印过
let chatCursor = (g.chatLog || []).length;
let lastPhase = g.phase;               // 'open' —— 开局讨论尚未打印
let lastNight = g.night;

/* 把新增日志按「夜/阶段」分组打印：输出顺序即真实发生顺序 */
function flushLog() {
  while (logCursor < g.log.length) {
    const e = g.log[logCursor++];
    if (!e.batch && e.kind !== 'info') continue;
    const pre = e.batch ? `【${e.batch}】` : '';
    L(`  ${pre}${e.text}`);
  }
}
function flushTalks() {
  while (chatCursor < (g.chatLog || []).length) {
    const c = g.chatLog[chatCursor++];
    const p = Engine.P(g, c.id);
    if (!p || p.out) continue;
    if (c.kind === '讨论' || c.kind === '会议') {
      const claims = (p.outClaims || []).map(x => x.kind).join(',');
      L(`    ${String(c.id).padStart(2)}号${truthMark(p)}(${p.roleName})：${c.text}${claims ? '　⟨' + claims + '⟩' : ''}`);
    }
  }
}

while (!g.over && steps < 5000) {
  steps++;

  /* 阶段切换：夜间开局 */
  if (g.phase === 'night' && (lastPhase !== 'night' || g.night !== lastNight)) {
    lastNight = g.night;
    H2(`第 ${g.night} 夜开始　倒计时 ${g.countdown.toFixed(1)}　净破坏 ${(g.net10 / 10).toFixed(1)}${g.stopNight ? '　【停转夜】' : ''}${g.extinction ? '　【寂灭时刻】' : ''}${g.duel ? '　【决斗时刻】' : ''}`);
  }
  /* 阶段切换：进入白天 */
  if (g.phase === 'day' && lastPhase !== 'day' && lastPhase !== 'day-talk' && lastPhase !== 'day-vote') {
    H2(`第 ${g.day} 个白天`);
  }

  const stepBefore = g.step, doneBefore = g.stepDone;
  Engine.stepOnce(g);

  /* 该步刚跑完 → 打印本步 AI 决策（brief 级） */
  if (g.step === stepBefore && g.stepDone !== doneBefore && BRIEF_STEPS.has(g.step) && !QUIET) {
    const lines = [];
    for (const p of Engine.alive(g)) {
      const s = decisionSummary(g, p, g.step);
      if (s) lines.push(`${String(p.id).padStart(2)}号${truthMark(p)}(${p.roleName})　${s}`);
    }
    if (lines.length) { L(`  〔步骤 ${g.step} · 夜间行动〕`); for (const x of lines) L('    ' + x); }
  }

  flushLog();

  /* 白天讨论：进入 D-talk 时把该段发言打出来 */
  if (g.phase === 'day' && g.step === 'D-talk' && lastPhase !== 'day-talk') {
    lastPhase = 'day-talk';
    L('  〔讨论发言〕');
    flushTalks();
    if (VERBOSE) { sampleAUC(false); printSnapshots(); }
  }
  /* 白天投票：进入 D-vote 时打票型与「投票—推理一致性」
     ⚠ 一致性读数取**投票发生前**的怀疑度快照：applyThreat/结算会即时改写证据，
     投票后再读会把「投票结果本身」算进推理依据里，恒得高一致（循环论证）。 */
  if (g.phase === 'day' && g.step === 'D-vote' && lastPhase !== 'day-vote') {
    const preTop = {};
    for (const p of Engine.alive(g)) {
      const others = Engine.alive(g).filter(x => x.id !== p.id);
      if (others.length) {
        const rank = others.slice().sort((a, b) => AI.suspOf(g, p, b.id) - AI.suspOf(g, p, a.id));
        preTop[p.id] = rank[0].id;
      }
    }
    lastPhase = 'day-vote';
    flushTalks();
    const votes = (g.voteHistory || [])[(g.voteHistory || []).length - 1];
    if (votes && votes.night === g.night) {
      const byTarget = {};
      for (const [voter, tgt] of Object.entries(votes.src)) (byTarget[tgt] = byTarget[tgt] || []).push(voter);
      const top = Object.entries(byTarget).sort((a, b) => b[1].length - a[1].length);
      for (const [tgt, vs] of top) {
        const t = Engine.P(g, +tgt);
        L(`  票型：${String(tgt).padStart(2)}号${truthMark(t)}(${t.roleName}) 得 ${vs.length} 票 ← ${vs.join(',')}`);
      }
      if (top.length) {
        const topId = top[0][0];
        let agree = 0, n = 0;
        for (const v of top[0][1]) {
          const vp = Engine.P(g, +v);
          if (!vp || vp.out || preTop[vp.id] == null) continue;
          n++;
          if (String(preTop[vp.id]) === topId) agree++;
        }
        const t = Engine.P(g, +topId);
        L(`  投票—推理一致性（投票前快照）：投给 ${topId} 号${truthMark(t)} 的 ${n} 人中，${agree} 人在投票前已认为他是自己最可疑目标（${agree}/${n}）`);
      }
    }
  }
  if (g.phase !== 'day') lastPhase = g.phase === 'night' ? 'night' : lastPhase;

  if (g.pending) {
    const f = g.pending, d = { opt: null, targets: [], num: null, text: '' };
    if (f.opts) { const u = f.opts.filter(o => !o.disabled); if (u.length) d.opt = u[0].v; }
    if (f.targets) { const al = Engine.alive(g); if (al.length) d.targets.push(al[0].id); }
    if (f.num) d.num = f.num.options[0].v;
    d.text = '';
    Engine.submit(g, d);
  }
}
flushLog(); flushTalks();

/* ---------- 推理快照（--verbose） ---------- */
function printSnapshots() {
  const al = Engine.alive(g);
  for (const p of al) {
    if (p.role === 'xeno') continue;                  // 外星人以异形为敌，标尺不同
    const others = al.filter(x => x.id !== p.id);
    if (!others.length) continue;
    const ranked = others.slice().sort((a, b) => AI.suspOf(g, p, b.id) - AI.suspOf(g, p, a.id));
    const top = ranked.slice(0, 4).map(x => {
      const s = AI.suspOf(g, p, x.id), dgr = AI.dangerOf(g, p, x.id);
      const dist = AI.suspDist(g, p, x.id);
      /* 分布经门面访问器读（D2：序列化顺序固定为 human/alien/xeno） */
      const ds = dist ? AI.distEntries(dist).map(([k, v]) => k.slice(0, 4) + ':' + (v * 100).toFixed(0)).join(' ') : '';
      const hs = hardSourceOf(g, p, x.id);
      return `${String(x.id).padStart(2)}号${truthMark(x)} 疑${String(Math.round(s)).padStart(3)} 危${String(Math.round(dgr)).padStart(3)}` +
        (ds ? ` [${ds}]` : '') + (hs ? ` ⟨硬源:${hs}⟩` : '');
    });
    L(`  ${tag(p)} → ${top.join('　')}`);
    if (VERBOSE) {
      const tev = [...(p.tEvents || new Map()).entries()].filter(([, v]) => v && v.length);
      if (tev.length) {
        L(`      证据表（${tev.length} 个目标）：`);
        for (const [tid, evs] of tev.slice(0, 6)) {
          const t = Engine.P(g, tid);
          const last = evs[evs.length - 1];
          L(`        → ${String(tid).padStart(2)}号${truthMark(t)}：${evs.length} 条，最近「${(last.desc || last.note || last.kind || '').slice(0, 46)}」`);
        }
      }
      const chan = (g._chanFired && g._chanFired.get) ? [...(g._chanFired.entries ? g._chanFired.entries() : [])] : null;
      if (chan && chan.length) L(`      本夜通道命中 ${chan.length} 条`);
    }
  }
}

/* ---------- 结局与结算读数 ---------- */
H1('结局');
L(`  ${({ human: '人类', alien: '异形', xeno: '外星人', draw: '平局' })[g.winner]} 获胜　历经 ${g.night} 夜 / ${g.day} 个白天`);
L('');
L('  出局顺序：');
for (const p of g.players.filter(x => x.out).sort((a, b) => (a.outNight || 0) - (b.outNight || 0) || a.id - b.id))
  L(`    第 ${String(p.outNight).padStart(2)} 夜 ${tag(p)} ${p.outType === 'vote' ? '被驱逐' : '死亡'}（${p.cause || '—'}）`);
L('');
L('  存活：' + Engine.alive(g).map(tag).join('　'));

H2('结算读数（观察者视角，指标只读）');
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
L('  怀疑度排序 AUC（Mann-Whitney，0.5＝瞎猜／1.0＝透视；口径与 mc.cjs 对齐）');
L(`    人类观察者    ${frac(mean(aucBuf.byFaction.human))}   样本 ${aucBuf.byFaction.human.length}`);
L(`    异形观察者    ${frac(mean(aucBuf.byFaction.alien))}   样本 ${aucBuf.byFaction.alien.length}`);
L(`    外星人观察者  ${frac(mean(aucBuf.byFaction.xeno))}   样本 ${aucBuf.byFaction.xeno.length}`);
L('    人类观察者按阶段：');
for (const ph of ['开局', '中期', '残局'])
  L(`      ${ph}　　${frac(mean(aucBuf.byPhase[ph]))}   样本 ${aucBuf.byPhase[ph].length}`);
L('');
const chanFired = g._chanFired ? (g._chanFired.size || (g._chanFired instanceof Set ? g._chanFired.size : 0)) : 0;
const tevTotal = g.players.reduce((s, p) => s + [...((p.tEvents) || new Map()).values()].reduce((a, ev) => a + ev.length, 0), 0);
L(`  证据总量 ${tevTotal}　通道命中 ${chanFired}　发言 ${g.chatLog.length} 条　公告 ${g.log.filter(e => e.batch).length} 条`);
if (MoE && MoE.stats && MoE.stats.shadow) L(`  影子层调用/采纳 ${MoE.stats.shadow.calls}/${MoE.stats.shadow.applied}`);
L('');
L('  ⚠ 本工具为观察侧探针：以上读数不进任何 gate；调参须按治理规范走分阵营读数 + 验证集（种子 101-500）。');