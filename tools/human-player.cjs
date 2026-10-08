/* =============================================================
 * 玩家模型（真人视角）—— 只吃「视图」，拿不到对局状态
 * =============================================================
 *
 * 为什么单独成文件：这是**防火墙的结构保证**，不是运行期监控。
 * 本模块导出的 play() 签名里没有 g，闭包里也没有 g —— 所以它**不可能**读到真相。
 * 若日后有人在这里加一个 g 参数，防火墙当场失效且很难被察觉。
 * 对照：tools/parity-sim.cjs 是反过来做的（用 getter 记录越界读取），
 * 那管的是「AI 读了什么」；这里管的是「玩家能知道什么」，两件事不要混。
 *
 * ⚠ 它**不是人**。它是一个「只用玩家可见信息、照规则办事」的推理器。
 *   所以它能回答的是：**界面与规则有没有把该给的信息给足**，
 *   回答不了「好不好玩」「刺不刺激」这类主观感受 —— 报告里已按此分栏。
 *
 * 可见信息只有三处，全部来自 view：
 *   view.players[i]      —— 经 view.js sanitize 裁剪后的他人视图（无 faction/role）
 *   view.announceBox     —— 本步公告（已按 SKVisible 过滤）
 *   view.log / inbox / talks —— 公开日志、私人反馈、公开发言
 *   view.players[me]     —— 自己的完整状态
 * ============================================================= */
'use strict';

/* 从视图里数一数：我这局手上「有几条可用的硬信息」。这是信息充分性的度量底座。 */
function hardFacts(v, meId) {
  const out = [];
  for (const p of v.players) {
    if (p.out) continue;
    /* 神探已查验池 = 硬事实（视图里明文下发，不是推断） */
    if (p.id === meId && Array.isArray(p.checkPool) && p.checkPool.length) {
      for (const c of p.checkPool) out.push({ kind: 'check', about: c.id, says: c.role });
    }
    /* 已揭示身份（出局/被驱逐公告带来） */
    if (p.revealed && p.revealed.role) out.push({ kind: 'revealed', about: p.id, says: p.revealed.role });
    /* 官方暴露（维修/破坏） */
    if (p.repairExposed) out.push({ kind: 'exposed', about: p.id });
    if (p.destroyedExposed) out.push({ kind: 'exposed', about: p.id });
    /* 公开指控数 */
    if (p.accusers && p.accusers.length) out.push({ kind: 'accused', about: p.id, n: p.accusers.length });
  }
  return out;
}

/* 从公开发言里抠出「谁自称了什么」。这是玩家唯一能自己攒的推理原料。
   ⚠ 只用 NLP.parse 的结构化输出，不用任何真相字段。 */
function claimsFromTalks(v, mem) {
  const NLP = mem.nlp;
  if (!NLP) return mem;
  for (const t of (v.talks || [])) {
    if (mem.claimOf[t.id] != null && mem.saidLen[t.id] == null) continue;
    const sig = NLP.parse(t.text, { speaker: t.id });
    if (!sig) continue;
    mem.saidLen[t.id] = (t.text || '').length;
    if (sig.role) mem.claimOf[t.id] = sig.role;
    if (sig.accuse != null) mem.accuseBy[t.id] = sig.accuse;
    if (sig.ask != null) mem.askBy[t.id] = sig.ask;
  }
  return mem;
}

function newMem(nlp) {
  return { nlp, claimOf: {}, accuseBy: {}, askBy: {}, saidLen: {}, notes: [], blind: 0, total: 0, friction: [],
    /* 玩家主动性：我说的话有没有被语言层认出来。
       —— 这是「我说话有没有用」的直接度量，不是观感。 */
    speech: { said: 0, parsedAsClaim: 0, parsedAsAccuse: 0, ignored: 0, samples: [] } };
}

/* 玩家自己的小随机源（与对局 rng 无关，只用于「看不出差别时随便选」，
   那正是玩家在信息不足时的真实行为）。 */
function pickRnd(mem) {
  mem.__r = ((mem.__r || 12345) * 1103515245 + 12345) & 0x7fffffff;
  return mem.__r / 0x7fffffff;
}

/* 把「我说的话」丢回语言层，看它被理解成什么。
   ⚠ 用的是**生产用的同一个解析器**（ctx.NLP / infer），不是我另写的一套 ——
   否则量出来的是「我的模型说得对不对」，不是「游戏认不认」。 */
function scoreSpeech(mem, text, myId) {
  if (!text) return;
  mem.speech.said++;
  const sig = mem.nlp ? mem.nlp.parse(text, { speaker: myId }) : null;
  if (!sig) return;
  if (sig.claim) mem.speech.parsedAsClaim++;
  if (sig.accuse && sig.accuse.length) mem.speech.parsedAsAccuse++;
  if (!sig.claim && !(sig.accuse && sig.accuse.length) && !(sig.report && sig.report.length)) {
    mem.speech.ignored++;
    if (mem.speech.samples.length < 5) mem.speech.samples.push('（未被理解）' + text.slice(0, 40));
  }
  /* 自我误伤：话里把自己也列成指控对象 */
  if (sig.accuse && sig.accuse.indexOf(myId) >= 0) {
    mem.speech.selfAccuse = (mem.speech.selfAccuse || 0) + 1;
    if (mem.speech.samples.length < 8) mem.speech.samples.push('（自指指控）' + text.slice(0, 40));
  }
}

/* —— 怀疑度：只用玩家能攒到的三类证据 ——
   ① 硬事实（查验/揭示） ② 被指控次数 ③ 几乎不说话（发言长度极短） */
function suspicion(v, mem) {
  const s = {};
  for (const p of v.players) if (!p.out && p.id !== v.humanId) s[p.id] = 0;
  for (const p of v.players) {
    if (p.out || p.id === v.humanId) continue;
    if (p.revealed && p.revealed.faction === 'alien') s[p.id] += 100;
    if (p.accusers && p.accusers.length) s[p.id] += 6 * p.accusers.length;
    const len = mem.saidLen[p.id];
    if (len != null && len < 6) s[p.id] += 8;
  }
  const me = v.players[v.humanId - 1];
  if (me && Array.isArray(me.checkPool)) {
    for (const c of me.checkPool) if (s[c.id] != null) s[c.id] += (c.role === 'alien' || c.role === 'xeno') ? 90 : -40;
  }
  return s;
}

/* —— 目标池：**只用视图**重建。这是防火墙的关键一处。
   表单给的是「池描述 + 上限」，而**名单**必须由玩家从视图里自己列出来 ——
   真人在界面上看到的也是一份名单，不是对象引用。 */
function targetPool(v, spec) {
  if (!spec) return null;
  let list = v.players.filter(p => !p.out && p.id !== v.humanId);
  if (spec.list === 'aliveNotAlien') list = list.filter(p => p.revealed && p.revealed.faction !== 'alien' || false);
  const ex = spec.exclude || [];
  return list.filter(p => ex.indexOf(p.id) < 0);
}

/* —— 决策：按表单 kind 分派。每个分支都只引用 view。 —— */
function decide(v, f, mem) {
  mem.total++;
  const out = { opt: null, targets: [], num: null, num2: null, text: '' };
  const enabled = (f.opts || []).filter(o => !o.disabled);
  const pool = targetPool(v, f.targets);

  /* 【摩擦记账】表单本身给玩家造成的困难。计数不是判据，是要报给人看的东西。 */
  if (f.targets && pool && pool.length === 0) mem.friction.push({ type: 'no-target', kind: f.kind, step: v.step });
  if (f.opts && enabled.length === 0) mem.friction.push({ type: 'all-opts-disabled', kind: f.kind, step: v.step });
  for (const k of ['num', 'num2']) {
    if (f[k] && (!Array.isArray(f[k].options) || f[k].options.length === 0))
      mem.friction.push({ type: 'no-option', kind: f.kind, step: v.step, field: k, label: f[k].label });
  }
  /* 【盲目决策】有 N 个等价候选时，玩家是在掷骰子而不是在推理。
   * ⚠ 这里只**置标志**，不做累加 —— 首版在 decide() 里 mem.blind++，
   *   而驱动每步又把 mem.blind 的**累计值**加进总账，于是
   *   2183 次决策报出 7157 次「盲目决策」（327.9%）。
   *   累加必须在驱动侧做「本步增量」，否则必然重复计数。
   *   这条与铁律一同一性质：指标算错时最容易被当成「游戏很难」而放过。 */
  const blindKind = { vote: 1, crewAction: 1, detective: 1, patrol: 1, alienAct: 1, doctor: 1, shoot: 1 }[f.kind];
  if (blindKind && pool && pool.length > 1) {
    const s = suspicion(v, mem);
    const vals = pool.map(p => s[p.id] || 0);
    const spread = Math.max(...vals) - Math.min(...vals);
    if (spread === 0) mem.blindMark = (mem.blindMark || 0) + 1;
  }

  switch (f.kind) {
    /* —— 白天发言 —— */
    case 'talk': {
      out.text = speakLine(v, mem);
      scoreSpeech(mem, out.text, v.humanId);
      out.targets = accusedTarget(v, mem, f);
      return out;
    }
    /* —— 投票 —— */
    case 'vote': {
      out.opt = 'yes';
      if (!pool || !pool.length) { out.opt = 'abstain'; return out; }
      const s = suspicion(v, mem);
      const best = pool.slice().sort((a, b) => (s[b.id] || 0) - (s[a.id] || 0))[0];
      out.targets = [best.id];
      mem.notes.push('第' + v.day + '昼 投 ' + best.id + '号（怀疑度 ' + (s[best.id] || 0) + '）');
      return out;
    }
    /* —— 私聊邀请 —— */
    case 'invite': {
      out.opt = (enabled[0] || {}).v || null;
      /* 邀「我怀疑的那个人」——玩家唯一有理由私聊的对象 */
      const s = suspicion(v, mem);
      const t = pool && pool.length ? pool.slice().sort((a, b) => (s[b.id] || 0) - (s[a.id] || 0))[0] : null;
      out.targets = t ? [t.id] : [];
      return out;
    }
    /* —— 神探查验 / 公告 —— */
    case 'detective': {
      const wantAnnounce = f.opts && f.opts.some(o => o.v === 'announce');
      const poolK = f.kind === 'detective';
      out.opt = (enabled.find(o => o.v === 'check') || enabled[0] || {}).v || null;
      if (!pool || !pool.length) return out;
      /* 优先查没被查过的人，其次查被指控最多的人 */
      const me = v.players[v.humanId - 1];
      const done = new Set((me.checkPool || []).map(c => c.id));
      const fresh = pool.filter(p => !done.has(p.id));
      const from = fresh.length ? fresh : pool;
      const s = suspicion(v, mem);
      out.targets = [from.slice().sort((a, b) => (s[b.id] || 0) - (s[a.id] || 0))[0].id];
      if (f.num) {
        const opts = f.num.options || [];
        out.num = opts.length ? opts[0].v : null;
        if (!opts.length) mem.friction.push({ type: 'no-option', kind: f.kind, step: v.step, field: 'num', label: f.num.label });
      }
      return out;
    }
    /* —— 船员查验 / 协助维修 —— */
    case 'crewAction': {
      out.opt = (enabled[0] || {}).v || null;
      if (!pool || !pool.length) return out;
      const s = suspicion(v, mem);
      out.targets = [pool.slice().sort((a, b) => (s[b.id] || 0) - (s[a.id] || 0))[0].id];
      if (f.num) {
        const opts = f.num.options || [];
        out.num = opts.length ? opts[0].v : null;
      }
      if (f.num2) {
        const opts = f.num2.options || [];
        out.num2 = opts.length ? opts[0].v : null;
      }
      return out;
    }
    /* —— 私聊窗口（0c）：玩家在这里真正能问出东西 —— */
    case 'chat': {
      /* 问「我怀疑的人」昨晚干了什么 —— 这是私聊唯一有信息量的用法 */
      const t = accusedTarget(v, mem, f);
      const who = t ? t.id : (pool && pool.length ? pool[0].id : null);
      out.text = who
        ? '我是' + v.humanId + '号' + (v.players[v.humanId - 1].roleName || '')
        + '，你昨晚' + (who === v.humanId ? '' : who + '号 ') + '做了什么？给个说法。'
        : '';
      scoreSpeech(mem, out.text, v.humanId);
      if (pool && pool.length) out.targets = [pool[0].id];
      return out;
    }
    /* —— 乔装（7.3）：我要伪装成谁 —— */
    case 'disguise': {
      const opts = enabled.filter(o => o.v && o.v !== 'none');
      /* 玩家不知道谁可信，故随机一个合法伪装（这正是规则允许的用法） */
      const pick = opts.length ? opts[Math.floor(pickRnd(mem) * opts.length)] : enabled[0];
      out.opt = pick ? pick.v : null;
      return out;
    }
    /* —— 其余「选一个 + 可能指定目标」的表单：统一按「最可疑的人」处理。
     *   单独列出来而不是丢进 default，是为了**不让它们污染 unknownKind** ——
     *   unknownKind 是「玩家模型没能力处理」的清单，把已处理的塞进去
     *   会让报告里的「模型盲区」这一栏失真。 —— */
    case 'will': case 'repair': case 'revive': case 'suppress': case 'safeRoom':
    case 'inviteAccept': case 'heal': case 'rescue': case 'selfSave':
    case 'lurk': case 'cocoon': case 'protect': case 'brew': case 'xenoEvolve':
    /* 外星人的蛰伏拆成了两个独立步（查验 / 附加沉默），同理单列 */
    case 'xenoCheck': case 'xenoSilence': case 'wiretapReport': case 'awaken':
    case 'transfer': case 'meeting': {
      out.opt = (enabled[0] || {}).v || null;
      if (pool && pool.length) {
        const s = suspicion(v, mem);
        out.targets = [pool.slice().sort((a, b) => (s[b.id] || 0) - (s[a.id] || 0))[0].id];
      }
      if (f.num) { const o = f.num.options || []; out.num = o.length ? o[0].v : null; }
      if (f.num2) { const o = f.num2.options || []; out.num2 = o.length ? o[0].v : null; }
      return out;
    }
    /* —— 异形分支（4b：破坏 / 结茧 二选一）—— */
    case 'branch': {
      /* 结茧优先给「我怀疑的人」挡刀 —— 玩家看得见队友与感染标记，别的看不见 */
      out.opt = (enabled.find(o => /cocoon|结茧/.test(o.v + o.label)) || enabled[0] || {}).v || null;
      const s = suspicion(v, mem);
      if (pool && pool.length) out.targets = [pool.slice().sort((a, b) => (s[b.id] || 0) - (s[a.id] || 0))[0].id];
      if (f.num) { const o = f.num.options || []; out.num = o.length ? o[0].v : null; }
      return out;
    }
    /* —— 外星人夜间三选一（蛰伏/击杀/自疗）—— */
    case 'guard': {
      /* 蛰伏：查验一名并可附加沉默。玩家挑最可疑的 */
      out.opt = (enabled.find(o => /lurk|蛰伏/.test(o.v + o.label)) || enabled[0] || {}).v || null;
      const s = suspicion(v, mem);
      if (pool && pool.length) out.targets = [pool.slice().sort((a, b) => (s[b.id] || 0) - (s[a.id] || 0))[0].id];
      return out;
    }
    /* —— 夜警：开枪 / 巡逻 / 嗅探 —— */
    case 'shoot': case 'patrol': case 'sniff': {
      out.opt = (enabled[0] || {}).v || null;
      if (pool && pool.length) out.targets = [pool[0].id];
      return out;
    }
    /* —— 异形行动 —— */
    case 'alienAct': {
      /* 玩家能看见的只有感染标记清单（3.3.10④）；濒死者**看不见**，也不该假装看得见 */
      const marked = [];
      for (const p of v.players) {
        if (p.out || p.id === v.humanId) continue;
        if (p.infection) marked.push(p);
      }
      const act = (enabled.find(o => o.v === 'infect') || enabled[0] || {}).v;
      out.opt = act;
      const cap = act === 'infect' ? 2 : 1;
      const cand = (marked.length ? marked : (pool || [])).slice(0, cap);
      out.targets = cand.map(p => p.id);
      return out;
    }
    /* —— 医生 —— */
    case 'doctor': {
      const act = (enabled.find(o => /heal|rescue|selfsave/i.test(o.v)) || enabled[0] || {}).v;
      out.opt = act;
      /* 视图里 `infection` 只对医生下发 {exists:true}；濒死者视图有 dying */
      const cand = [];
      for (const p of v.players) {
        if (p.out || p.id === v.humanId) continue;
        if (/rescue|selfsave/i.test(act) ? p.dying : p.infection) cand.push(p);
      }
      out.targets = cand.length ? [cand[0].id] : (pool && pool.length ? [pool[0].id] : []);
      if (f.num) { const o = f.num.options || []; out.num = o.length ? o[0].v : null; }
      return out;
    }
    /* —— 破坏 —— */
    case 'destroy': {
      out.opt = (enabled[0] || {}).v || null;
      const s = suspicion(v, mem);
      if (pool && pool.length) out.targets = [pool.slice().sort((a, b) => (s[b.id] || 0) - (s[a.id] || 0))[0].id];
      if (f.num) { const o = f.num.options || []; out.num = o.length ? o[0].v : null; }
      return out;
    }
    /* —— 结茧 / 保护 / 变形 / 邀请加入 —— */
    case 'cocoon': case 'protect': case 'morph': case 'join': case 'xenoLurk':
    case 'xenoCure': case 'revive': case 'convert': case 'evolve': case 'craft': case 'xenoEvolve': {
      out.opt = (enabled[0] || {}).v || null;
      if (pool && pool.length) out.targets = [pool[0].id];
      if (f.num) { const o = f.num.options || []; out.num = o.length ? o[0].v : null; }
      if (f.num2) { const o = f.num2.options || []; out.num2 = o.length ? o[0].v : null; }
      return out;
    }
    default: {
      /* 未覆盖的 kind：老实交代，不猜。记下来以便报告「哪些步骤玩家模型没能力处理」。 */
      mem.unknownKind = mem.unknownKind || {};
      mem.unknownKind[f.kind] = (mem.unknownKind[f.kind] || 0) + 1;
      out.opt = (enabled[0] || {}).v || null;
      if (pool && pool.length) out.targets = [pool[0].id];
      if (f.num) { const o = f.num.options || []; out.num = o.length ? o[0].v : null; }
      return out;
    }
  }
}

/* —— 发言：**按真人会怎么说**来说，不是按解析器喜欢什么来说。
   这一条是刻意的：早先版本写成「我是X号Y」时我以为这样最像人，
   后来才发现恰恰是这句被解析器拒收。**要让量测反映玩家的真实困境，
   就不能替玩家优化措辞去迎合解析器** —— 那样量出来的是「怎么说话才有用」，
   而不是「正常说话有没有用」。 */
function speakLine(v, mem) {
  const me = v.players[v.humanId - 1];
  const bits = [];
  if (me && me.roleName) bits.push('我是' + v.humanId + '号' + me.roleName);
  if (me && Array.isArray(me.checkPool) && me.checkPool.length) {
    const c = me.checkPool[me.checkPool.length - 1];
    bits.push('我昨晚查了' + c.id + '号，结果是' + c.role);
  }
  const t = accusedTarget(v, mem, null);
  if (t) bits.push('我怀疑' + t.id + '号');
  return bits.join('，') + '。';
}

function accusedTarget(v, mem, f) {
  const s = suspicion(v, mem);
  let pool = v.players.filter(p => !p.out && p.id !== v.humanId);
  if (f && f.targets) {
    const ex = f.targets.exclude || [];
    pool = pool.filter(p => ex.indexOf(p.id) < 0);
  }
  if (!pool.length) return null;
  return pool.slice().sort((a, b) => (s[b.id] || 0) - (s[a.id] || 0))[0];
}

module.exports = { newMem, decide, hardFacts, suspicion, targetPool, speakLine, scoreSpeech };