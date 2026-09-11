/* 语言库（生成侧）：Claim IR → 中文句子。
   与 lang 的理解侧（nlp.js）互为逆运算：renderer 产出的句子必须能被 parser 读回同一个 Claim，
   这条 round-trip 不变式由 tools/test-lang.cjs 全量校验。
   本文件只负责「怎么说」，不含任何规则数值与推理逻辑。 */
(function (global) {
  /* rng 为引擎的可复现随机源（g.rng）：脱机渲染时也允许省略，退化为 Math.random */
  const idx = (n, rng) => (rng && rng.int ? rng.int(n) : Math.floor(Math.random() * n));
  const pick = (arr, rng) => arr[idx(arr.length, rng)];

  function num(id, rng) {
    /* 三成概率用中文数字写法（「十二号」），用于反向压测解析器对中文数字的识别 */
    return (rng && rng.next ? rng.next() : Math.random()) < 0.3 ? numCN(id) : `${id} 号`;
  }
  const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五'];
  /* 两种写法都自带「号」字，调用方不得再补后缀 */
  const numCN = id => (CN[id] ? `${CN[id]}号` : `${id}号`);

  const roleCN = key => (global.NLP && global.NLP.ROLE_NAME[key]) || key;
  const factionCN = k => ({ human: '人类', alien: '异形', xeno: '外星人' }[k] || k);

  /* ctx: { rng, g, speaker } —— rng 缺失时退化为 Math.random（仅影响排版，不影响可复现性以外的内容） */
  function render(c, ctx) {
    ctx = ctx || {};
    const rng = ctx.rng || Math.random;
    const t = c.targets && c.targets[0];
    const who = t ? num(t, rng) : '';
    const role = c.payload && c.payload.role ? roleCN(c.payload.role) : '';

    switch (c.kind) {
      case 'accuse': {
        const hard = c.payload && c.payload.tier === 'hard';
        const soft = c.payload && c.payload.tier === 'soft';
        return pick(hard
          ? [`${who} 就是异形，这点不用再讨论了。`, `${who} 聊爆了，不用再辩。`, `我咬死 ${who}，信息对不上。`]
          : soft
            ? [`${who} 有点可疑，我记一笔。`, `${who} 说得太顺了，我先盯着。`, `${who} 这套发言有问题。`]
            : [`我怀疑 ${who}。`, `我推 ${who}，理由后面补。`, `${who} 大概率是敌。`], rng);
      }
      case 'claimRole': return pick([`我是${role}。`, `我跳${role}。`, `我认${role}。`], rng);
      case 'exclusion': {
        const ex = (c.payload && c.payload.excludes) || [];
        /* 必须用「不是 A，也不是 B」句式——解析器只认这个模式（LEX.excl） */
        const names = ex.length >= 2 ? `${roleCN(ex[0])}，也不是${roleCN(ex[1])}`
                    : ex.length === 1 ? roleCN(ex[0]) : '';
        return names ? `我查过 ${who}，他不是${names}。` : `我查过 ${who}，排除信息先不全说。`;
      }
      case 'lock': {
        const good = c.payload && c.payload.good;
        const f = c.payload && c.payload.faction;
        return good
          ? pick([`${who} 是我验过的金水。`, `${who} 的阵营我能确认是人类。`, `我给 ${who} 发金水。`], rng)
          : f
            ? `我查过 ${who}，能确定他的阵营是${factionCN(f)}。`
            : pick([`${who} 我锁定了，不是自己人。`, `${who} 的阵营我确认了。`], rng);
      }
      case 'reveal': {
        const f = c.payload && c.payload.faction;
        return `我查过 ${who}，他是${factionCN(f)}（${role}）。`;
      }
      case 'ask': {
        /* v32 语言层修复：开局讨论（night=0）没有「昨晚」可问——时间情境感知（与 decide.speak 同口径）。
           两套模板都必须过 round-trip：开局句式仍含「质询/说清楚」关键词（nlp LEX.ask 识别面）。 */
        const night0 = !!(ctx.g && ctx.g.night === 0);
        return pick(night0
          ? [`${who}，开局先把你的立场说清楚。`, `我质询 ${who}：第一轮别划水，说点干货。`, `${who}，你开局打算跟谁走？给我个说法。`]
          : [`${who}，你昨晚做了什么？当着大家说清楚。`, `我质询 ${who}：你的职业和昨晚行动，别绕。`, `${who}，你昨晚在哪？给我个说法。`], rng);
      }
      case 'quote': {
        const by = c.payload && c.payload.by;
        /* 解析器只认「X 号说/咬 Y 号」的紧邻结构（nlp 的转述归因正则） */
        return pick([`${num(by, rng)}说${who}是异形，这话我记下了。`, `${num(by, rng)}咬${who}，我记一笔。`], rng);
      }
      case 'vote': return pick([`这一票我投 ${who}。`, `票给 ${who}。`, `我投 ${who}，错杀也比全灭强。`], rng);
      case 'abstain': return pick(['这轮我压手。', '信息不够，我弃票。', '这一票我不投。'], rng);
      case 'rally': return pick([`都投 ${who}，票别散。`, `统一投 ${who}。`, `票别散了，一起投 ${who}。`], rng);
      case 'split': return pick(['票太散了，这样谁都出不去。', '再分票就白给一夜。'], rng);
      case 'defend': return pick([`我保${who}。`, `我挺${who}。`, `我信${who}，他没问题。`], rng);
      case 'bind': return `${who} 是${role}。`;
      case 'deny': {
        const a = c.payload && c.payload.about;
        return a === 'checked' ? pick(['我昨晚没被查验。', '没人查过我。'], rng)
             : a === 'cured'   ? pick(['我没有抗体，也没被治疗过。', '我昨晚没进过濒死。'], rng)
             : pick(['我身上没有感染标记。', '我没感染。'], rng);
      }
      case 'promise': {
        const tier = c.payload && c.payload.tier;
        return tier === 'strong'
          ? `我今晚查${who}，明晚公告${who}是异形。`
          : tier === 'mid' ? pick([`我今晚查${who}。`, `我今晚要验${who}。`], rng)
          : pick(['我可能会查验，看情况。', '我或许会投，先听一轮。'], rng);
      }
      case 'infection': return pick(['我身上有感染标记，还剩两夜就死。', '我被感染了，撑不了几夜。'], rng);
      case 'pass': return pick(['我这轮先不表态，信息不足。', '没信息，我先听大家。', '看不清，先听你们。'], rng);
      /* 私有体验类宣称（无第二类验证者，对应总表 D−/Z 档：本阶段只登记，不改估值） */
      case 'suppress': return pick(['我昨晚用了抑制，动不了。', '昨夜我被感染逼着用了抑制。'], rng);
      case 'repair': return pick(['我昨晚修过。', '昨晚我在维修。'], rng);
      case 'destroy': return pick(['昨晚的破坏有我一份。', '我在破坏那边出了力。'], rng);
      case 'cure': return pick([`我治疗了 ${who}。`, `我清了 ${who} 的感染。`], rng);
      case 'rescue': return pick([`${who} 昨晚是我捞回来的。`, `我救了 ${who}。`], rng);
      case 'brew': return pick(['我这两夜在制药，进度还没走完。', '我在制药，出手不了。'], rng);
      default: return '';
    }
  }

  /* ---------- 讯问句池（前端「自动生成语句」用） ----------
     全部取自已过 round-trip 的模板：生成的话必然能被解析器读回同一意图，
     真人也可以在此基础上自行改写来测试 AI 的识别能力。 */
  const PROBE = {
    ask: [
      t => `${t} 号，你昨晚做了什么？当着大家说清楚。`,
      t => `我质询 ${t} 号：你的职业和昨晚行动，别绕。`,
      t => `${t} 号，你昨晚在哪？给我个说法。`,
    ],
    soft: [
      t => `${t} 号有点可疑，我记一笔。`,
      t => `${t} 号这套发言有问题。`,
      t => `${t} 号说得太顺了，我先盯着。`,
    ],
    med: [
      t => `我怀疑 ${t} 号。`,
      t => `我推 ${t} 号，理由后面补。`,
      t => `${t} 号大概率是敌。`,
    ],
    hard: [
      t => `${t} 号就是异形，这点不用再讨论了。`,
      t => `我咬死 ${t} 号，信息对不上。`,
      t => `${t} 号聊爆了，不用再辩。`,
    ],
  };
  function probe(pid, tier) {
    const pool = PROBE[tier] || PROBE.ask;
    return pool[idx(pool.length)](pid);
  }

  global.Lang = { render, num, numCN, roleCN, factionCN, probe };
})(typeof window !== 'undefined' ? window : globalThis);
