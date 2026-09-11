/* 中文发言语义识别 v2：意图模型 + 社区黑话语料对齐。
   语料来源：狼人杀通用黑话体系（金水/查杀/悍跳/划水/压手/抗推/归票/分票/踩/抬/站边/带节奏等）
   与 Among Us 中文社区用语（sus/假任务/谁在附近等）——联网检索对齐后收编入库。
   设计：先把发言按标点切成子句，再逐子句做意图判定 + 目标抽取；
   支持：数字（阿拉伯/中文/号位/玩家）、职业别名与数字+职业绑定、指控三档、
   查验汇报（排除/锁定/金水/查杀）、身份声称（含悍跳/对跳标记）、公开质询、转述归因、
   投票意向（归票/跟票/分票/弃票）、辩护（挺/信/站边）、划水、否定翻转、假设降权。
   解析结果只增不减地喂给威胁度链；同时输出「原意」摘要供 UI 小字展示，玩家可随时核对 AI 的理解。 */
(function (global) {
  const D = global.SKData;

  /* ---------- 数字：阿拉伯 + 中文（1~15） ---------- */
  const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  function cnToInt(s) {
    if (!s) return NaN;
    if (s.length === 1) { if (s === '十') return 10; return CN_NUM[s] || NaN; }
    if (s[0] === '十') { const d = s[1] ? CN_NUM[s[1]] : NaN; return d ? 10 + d : NaN; }
    const i = s.indexOf('十');
    if (i > 0) {
      const a = CN_NUM[s[i - 1]] || NaN; if (isNaN(a)) return NaN;
      const b = s[i + 1] ? (CN_NUM[s[i + 1]] || 0) : 0;
      return a * 10 + b;
    }
    return NaN;
  }

  /* 编号模式：「十一~十五」必须整体匹配（十 不可被跳过），否则 十二号 会误读成 二号 */
  const ID_PAT = String.raw`(?:(?:[一二两三四五六七八九]{1,2})?十[一二三四五]?|[一二两三四五六七八九])\s*号(?:位|玩家)?|\d{1,2}\s*号(?:位|玩家)?`;

  /* 中文编号会带着「号/号位/号玩家」后缀进来，必须先剥掉再转数字，
     否则 cnToInt('五号') 得 NaN，转述归因（X 号说 Y 号）整体失效。 */
  function idOf(m) {
    if (/\d/.test(m)) { const d = m.match(/\d{1,2}/); return d ? +d[0] : NaN; }
    return cnToInt(String(m).replace(/号(?:位|玩家)?\s*$/, ''));
  }

  /* 抽取子句内全部编号（阿拉伯/中文），升序去重 */
  function idsIn(s) {
    const ids = []; let m;
    const re1 = /(\d{1,2})\s*号(?:位|玩家)?/g;
    while ((m = re1.exec(s)) !== null) { const v = +m[1]; if (v >= 1 && v <= 15) ids.push(v); }
    const re2 = /((?:[一二两三四五六七八九]{1,2})?十[一二三四五]?|[一二两三四五六七八九])\s*号(?:位|玩家)?/g;
    while ((m = re2.exec(s)) !== null) { const v = cnToInt(m[1]); if (v >= 1 && v <= 15) ids.push(v); }
    return [...new Set(ids)];
  }

  /* ---------- 职业别名表（社区叫法 → 引擎 roleKey） ---------- */
  const ROLE_ALIAS = {
    '普通船员': 'crew', '船员': 'crew', '平民': 'crew', '普通人': 'crew', '白板': 'crew',
    '警长': 'sheriff', '船长': 'sheriff',
    '工程师': 'engineer', '维修工': 'engineer', '修船的': 'engineer', '技工': 'engineer', '扳手': 'engineer',
    '助理工程师': 'assistant', '副工程师': 'assistant', '助理': 'assistant',
    '生化医师': 'bio', '生化医': 'bio', '生化': 'bio',
    '救援医师': 'rescue', '救援医': 'rescue', '救援兵': 'rescue', '救援': 'rescue',
    '神探': 'detective', '侦探': 'detective', '预言家': 'detective', '警察': 'detective',
    '查杀位': 'detective', '查验位': 'detective', '验人位': 'detective',
    '保镖': 'bodyguard', '护卫': 'bodyguard', '守卫': 'bodyguard', '盾位': 'bodyguard',
    '验票官': 'inspector', '查票官': 'inspector', '验票的': 'inspector', '票务': 'inspector', '验票': 'inspector',
    '武装船员': 'armed', '武装': 'armed', '枪位': 'armed', '带枪的': 'armed', '猎人': 'armed',
    '临时医生': 'tempdoc', '代医': 'tempdoc', '临时奶': 'tempdoc',
    /* v22 缺陷修复：'doc' 不是 D.ROLES 的合法键（只有 bio/rescue/tempdoc）——
       旧别名把「医生」解析成 'doc' 后写入 claimedRole/known，UI 的 D.ROLES[k.role]
       会直接崩。统一归到 'bio'（ai.js 私聊路径原有 doc→bio 转换的等价前移）。 */
    '医生': 'bio', '大夫': 'bio', '医师': 'bio', '医疗兵': 'bio', '奶妈': 'bio', '奶': 'bio',
  };
  /* 长别名优先匹配，避免「助理工程师」被「助理」截胡 */
  const ROLE_ALT = Object.keys(ROLE_ALIAS).sort((a, b) => b.length - a.length).join('|');
  const ROLE_NAME = { crew: '船员', sheriff: '警长', engineer: '工程师', assistant: '助理工程师', bio: '生化医师', rescue: '救援医师', detective: '神探', bodyguard: '保镖', inspector: '验票官', armed: '武装船员', tempdoc: '临时医生', doc: '医生' };

  /* 阵营词（不进职业表，专用于指控） */
  const ENEMY_WORDS = /(异形|外星人|内鬼|铁狼|是狼|像狼|鬼|敌方|坏人|坏蛋|叛徒)/;

  /* ---------- 意图词库（黑话 → 意图） ---------- */
  const LEX = {
    /* 指控·重度（判定为「直接咬死」） */
    hard: /(是异形|是外星人|就是异形|就是外星人|查杀|说谎|说假话|谎报|骗子|骗人|造假|编的|内鬼|敌方阵营|坏人|坏蛋|叛徒|聊爆|装不下去了|假冒|冒充|咬死|实锤)/,
    /* 指控·中度 */
    med: /(怀疑|指控|有嫌疑|嫌疑|大概率|应该是敌|我推|盘出来|盘他|像狼|像异形|sus|有鬼|是鬼|真正的异形|破坏者就是|感染者就是|节奏点|重点关照|最像敌)/,
    /* 指控·轻度（仅表达不舒服的感觉） */
    soft: /(可疑|奇怪|不对劲|看不惯|盯上?|盯紧|挂一下|踩|留意|观察一下|感觉有问题|有点虚|说不通|有问题|有问题吧|很怪)/,
    /* 投票意向 */
    vote: /(投|票给|票投|出他|出掉|推出局|送走|抬走|踢出|放逐|票出|冲票|绑票|拉出去|处决)/,
    rally: /(归票|统一投|都投|一起投|集中票|票别散|冲票|绑票|票全给|归给)/,
    split: /(分票|票散了|票被分|票太散|别让票散)/,
    abstain: /(弃票|压手|不投|跳过|弃权|skip|这一票不投|这票弃|投弃)/,
    /* 辩护（为他人背书 / 自证清白） */
    defend: /(相信|我信|我担保|担保|作证|可以作证|清白|不是异形|不是外星人|不是敌方|不是坏人|没(有)?问题|站边|我站|金水位|(他|她|它)?号?是好人|是真神|是真船员)/,
    defendT: /(挺|保|信)\s*(?:一下)?\s*(?:(\d{1,2})|([一二两三四五六七八九十]{1,3}))\s*号/,
    /* 划水 / 弃权发言 */
    pass: /(不知道|不清楚|看不清|没想法|没什么想法|听大家的|听你们|我过|划水|没信息|信息不足|先不表态|看后续)/,
    /* 质询（公开追问） */
    ask: /(解释|说明|交代|回答|说清楚|讲清楚|什么职业|哪个职业|你是干什么的|干什么的|别装|少装|摊牌|报身份|起跳|跳出来|昨晚在哪|昨晚干嘛|你昨晚|在哪|谁在附近|谁看见了|有想法吗|什么意见|怎么看|质询|给我个说法|给个交代)/,
    /* 查验汇报 */
    excl: /(排除|不是.*也不是|肯定不是|已排除)/,
    lock: /(确认|锁定|能确定|能确认|金水|验过|查过|扫过|扫了|查验结果|给.*金水|发金水)/,
    /* 悍跳 / 对跳（冒充神职的声称） */
    jump: /(悍跳|对跳|抢身份|抢跳)/,
  };

  /* ---------- v20 推理库对应词表（语料取自总表 v20 的宣称形态） ----------
     证伪型宣称（A12~A15）：目标私有状态的否认——使查验/治疗类宣称从零成本编造变为有风险 */
  const DENY = [
    { re: /(没被?[^。！？]{0,6}(查验|查|验|蛰伏|盯)|没人?查(过)?我|昨晚没(被)?查)/, about: 'checked' },
    { re: /(没被?(治疗|救)|没有抗体|没进过濒死|没人(治疗|救)(过)?我|身上没有抗体)/, about: 'cured' },
    { re: /(没有感染标记|没带感染|身上(没有|没)标记|我没感染)/, about: 'infection' },
  ];
  /* 承诺宣称（E7 承诺系统，v20 §5.7）：弱/中/强三档，强承诺不吞同句指控（A01 预告+指控并存） */
  const PROMISE = [
    { re: /(今晚|今夜)[^。！？]{0,10}(查|验)[^。！？]{0,14}(公告|宣布|公开)/, tier: 'strong' },
    { re: /我(今晚|今夜|明天晚上?)(就|要|先)?(查|验|投|保|救|开枪|出刀|刀|修)/, tier: 'mid' },
    { re: /(可能会|或许会|看情况|说不定)(查|验|投|保|救)/, tier: 'weak' },
  ];
  /* 私有体验宣称（D 档：suppress/repair/destroy/cure/rescue/brew/infection——无第二类验证者或部分可证伪） */
  const EXP = [
    { re: /(用了|使用)(感染)?抑制|抑制(了|过)/, kind: 'suppress' },
    { re: /我[^。！？]{0,6}(维修|修了|修过|在做维修|在维修)/, kind: 'repair' },
    { re: /我(昨晚|今夜|昨夜)?(参与|做了|出了)?(破坏|搞破坏)/, kind: 'destroy' },
    { re: /我(治疗了?|治了|清了|清除了?)(感染)?|我给[^。！？]{0,6}(治了?|治疗)/, kind: 'cure' },
    { re: /我救(了|过)|是我捞(回来|起)的|被我救/, kind: 'rescue' },
    { re: /在制药|制(了)?(一|半)?(瓶|半)?药|制药(进程|中)/, kind: 'brew' },
    { re: /我(身上)?有感染标记|我被感染|我(还剩|还有)[^。！？]{0,3}夜(就)?死|我要死了/, kind: 'infection' },
  ];

  const NEG = /(不是|没指控|没有指控|别怀疑|无意指控|并非|不算|谈不上)/;
  const ASSUME = /(如果|假如|万一|要是|假设|或许|可能吧|说不定)/;

  /* ---------- 子句级解析 ---------- */
  function parseClause(cl, out, meta) {
    const ids = idsIn(cl);
    if (!cl.trim()) return;
    const assumed = ASSUME.test(cl);
    const negated = NEG.test(cl);

    /* 证伪型宣称（A12~A15）：否认自身私有状态——优先级最高，避免「没被查验」被吞进其他意图 */
    for (const d of DENY) {
      if (d.re.test(cl)) {
        out.deny.push({ about: d.about });
        out.intents.push(`否认：${d.about === 'checked' ? '被查验' : d.about === 'cured' ? '被治疗/濒死' : '带感染标记'}`);
        return;
      }
    }

    /* v33 复审 P0（方向反转级修复）：否定极性收口——
       此前 negated 只用于身份声称，导致三处误判（实测复现见 docs/审查_推理库与语言库复审_2026-09-11.md §2）：
       ① 「3号不是异形」被 hard 词「是异形」的子串命中成 查杀+重度指控（辩护→假证据）；
       ② 「4号没有问题」被 soft 词「有问题」的子串命中成轻度指控；
       ③ 「5号是好人」零识别（defend 词表全带代词/动词前提）。
       clNeg = 剥除「否定+敌方/极性短语」后的干净子句，用于指控/查杀类 cue 判定；
       原句 cl 仍用于辩护词表（「不是异形」「没有问题」本身是合法辩护表达）。 */
    const clNeg = cl
      .replace(/(?:不是|并非|没|非|不像)\s*像?\s*(?:异形|外星人|内鬼|坏人|狼|敌方|骗子|说谎)/g, '。')
      .replace(/没有\s*问题/g, '。');
    const negEnemy = /(?:不是|并非|没|非|不像)\s*像?\s*(?:异形|外星人|内鬼|坏人|狼|敌方|骗子)/.test(cl);
    const negHuman = /(不是|非)\s*(自己人|好人|人类|船员)/.test(cl);

    /* 转述归因：「X号说Y号是异形 / X号咬Y号」优先级最高，避免误判为发言人自己的指控 */
    let m;
    const reQ = new RegExp('(' + ID_PAT + ')(?:说|咬|怀疑|点名|指控|盯|报了?|给(?:出)?)\\s*[^。！？]{0,8}?(' + ID_PAT + ')', 'g');
    while ((m = reQ.exec(cl)) !== null) {
      const v1 = idOf(m[1]), v2 = idOf(m[2]);
      if (v1 >= 1 && v1 <= 15 && v2 >= 1 && v2 <= 15 && v1 !== v2) {
        out.quote.push({ by: v1, target: v2 });
        out.intents.push(`转述：${v1} 号指控 ${v2} 号`);
        return;
      }
    }

    /* 承诺宣称（E7）：预判今晚/明晚的行动——强承诺不 return，同句指控（A01）仍要解析 */
    for (const pr of PROMISE) {
      if (pr.re.test(cl)) {
        const tg = ids.filter(x => x !== meta.speaker).slice(0, 2);
        out.promise.push({ tier: pr.tier, targets: tg });
        out.intents.push(`承诺(${pr.tier === 'strong' ? '强' : pr.tier === 'mid' ? '中' : '弱'})${tg.length ? '：涉及 ' + tg.join('、') + ' 号' : ''}`);
        if (pr.tier !== 'strong') return;
        break;
      }
    }

    /* 身份声称：「我是神探 / 我跳预言家 / 底牌是医生」（否定句不作声称） */
    const reClaim = new RegExp('我(?:就|其实|真实身份|就是|要跳|来跳)?(?:是|跳|认|表|报)\\s*(?:个)?\\s*(' + ROLE_ALT + ')|底牌(?:是|为)\\s*(' + ROLE_ALT + ')|身份(?:是|为)\\s*(' + ROLE_ALT + ')', 'g');
    if ((m = reClaim.exec(cl)) !== null && !negated) {
      const role = ROLE_ALIAS[m[1] || m[2] || m[3]];
      if (role) {
        if (!out.claim) out.claim = role;
        const jumped = LEX.jump.test(cl);
        out.intents.push(`自称${ROLE_NAME[role]}${jumped ? '（悍跳/对跳）' : ''}`);
        /* 不 return：同句中的查验汇报/指控仍需解析（「我是神探，昨晚查了7号是金水」） */
      }
    }

    /* 数字+职业绑定：「12号是医生 / 5号自称验票官 / 医生12号」——供对照与冲突检测 */
    const reBind1 = new RegExp('(' + ID_PAT + ')\\s*(?:是|就是|自称|声称|跳|说自己是|身份是|应该是|好像是)?\\s*(' + ROLE_ALT + ')', 'g');
    while ((m = reBind1.exec(cl)) !== null) {
      const v = idOf(m[1]), role = ROLE_ALIAS[m[2]];
      if (v >= 1 && v <= 15 && role && v !== meta.speaker) {
        out.roleBind.push({ id: v, role });
        out.intents.push(`指认 ${v} 号为${ROLE_NAME[role]}`);
      }
    }
    const reBind2 = new RegExp('(' + ROLE_ALT + ')\\s*(' + ID_PAT + ')', 'g');
    while ((m = reBind2.exec(cl)) !== null) {
      const v = idOf(m[2]), role = ROLE_ALIAS[m[1]];
      if (v >= 1 && v <= 15 && role && v !== meta.speaker &&
          !out.roleBind.some(b => b.id === v)) {
        out.roleBind.push({ id: v, role });
        out.intents.push(`指认 ${v} 号为${ROLE_NAME[role]}`);
      }
    }

    /* 查验汇报：排除 / 锁定（金水=好人、查杀=敌方）
       v26 修复两处：
       ① 补 `faction`——文本路径此前【永远产不出阵营】，于是「真神探口头查杀/金水」既进不了
          目标侧证据、也触发不了硬源锁定（pipeline 要求 payload.faction），玩家比 AI 少一条管道；
       ② 汇报与指控同句时不再无条件 return——旧行为把「我查过 7 号，能确定他是异形」整句吞成
          汇报，指控链完全收不到（这正是"玩家与 AI 对等"被破坏的地方）。 */
    const gold = /(金水|银水)/.test(cl);
    /* v33：查杀判定改用 clNeg（剥除否定短语）——「不是异形」不再是查杀 */
    const chasha = /(查杀|实锤|验出)/.test(clNeg) ||
      (LEX.hard.test(clNeg) && /(异形|外星人|内鬼|敌方|坏人|叛徒|是狼)/.test(clNeg));
    /* 否定式优先：「不是自己人 / 非好人」= 敌方；其次 negEnemy（不是异形等）= 人类 */
    const facWord = /(不是|非)\s*(自己人|好人|人类|船员)/.test(cl) ? 'alien'
                  : negEnemy ? 'human'
                  : /(人类|好人|自己人|平民)/.test(clNeg) ? 'human'
                  : /(异形|外星人|内鬼|敌方|坏人|叛徒|是狼)/.test(clNeg) ? 'alien' : null;
    if (LEX.excl.test(cl)) {
      for (const id of ids.slice(0, 2)) {
        out.report.push({ id, kind: 'exclude' });
        out.intents.push(`汇报：排除 ${id} 号`);
      }
      return;
    }
    if (gold || chasha || LEX.lock.test(cl)) {
      const fac = chasha ? 'alien' : (gold ? 'human' : facWord);
      const goodFlag = !chasha && (gold || fac === 'human');
      for (const id of ids.slice(0, 2)) {
        out.report.push({ id, kind: 'lock', good: goodFlag, faction: fac });
        out.intents.push(`汇报：${chasha ? '查杀' : '锁定'} ${id} 号` +
          (chasha ? '（敌方）' : goodFlag ? '（好人/金水）' : fac ? `（${fac === 'alien' ? '敌方' : '人类'}）` : ''));
      }
      /* 纯汇报才终止；与指控同句时继续走指控判定（不互斥） */
      const cue = LEX.hard.test(cl) || LEX.med.test(cl) || LEX.soft.test(cl);
      if (ids.length && !cue) return;
    }

    /* 指控三档：v33 改用 clNeg 判定（否定短语「不是异形/没有问题」不再构成指控 cue） */
    const accT = LEX.hard.test(clNeg) ? '重度' : LEX.med.test(clNeg) ? '中度' : LEX.soft.test(clNeg) ? '轻度' : null;
    if (accT && ids.length) {
      let targets = ids.filter(x => x !== meta.speaker);
      if (accT === '重度') {
        /* 无编号的重度指控（「就是异形」）→ 若上句刚点名，继承最近提及 */
        if (!targets.length && meta.lastIds) targets = meta.lastIds.filter(x => x !== meta.speaker);
      }
      for (const id of targets.slice(0, 2)) {
        out.accuse.push(id);
        out.accTiers[id] = accT;
        out.intents.push(`${accT}指控 ${id} 号${assumed ? '（假设，降权）' : ''}`);
      }
      meta.lastIds = ids;
      return;
    }

    /* 私有体验宣称（D 档）：抑制/维修/破坏/治疗/救援/制药/带标记——无第二类验证者或部分可证伪 */
    for (const e of EXP) {
      if (e.re.test(cl)) {
        const tg = ids.filter(x => x !== meta.speaker).slice(0, 2);
        out.exp.push({ kind: e.kind, targets: tg });
        out.intents.push(`体验宣称(${e.kind})${tg.length ? '：' + tg.join('、') + ' 号' : ''}`);
        return;
      }
    }

    /* 投票意向：归票 / 分票 / 弃票 / 一般投票 */
    if (LEX.rally.test(cl)) {
      out.rally = ids[0] || out.rally;
      out.intents.push(ids.length ? `归票 ${ids[0]} 号` : '主张归票');
      return;
    }
    if (LEX.split.test(cl)) { out.intents.push('警告分票'); return; }
    if (LEX.abstain.test(cl)) { out.abstain = true; out.intents.push('主张弃票/压手'); return; }
    if (LEX.vote.test(cl) && ids.length) {
      for (const id of ids.filter(x => x !== meta.speaker).slice(0, 2)) {
        out.voteIds.push(id);
        out.intents.push(`投票意向：${id} 号`);
      }
      return;
    }

    /* 辩护：挺/信/站边 + 编号，或纯清白表达。
       v33：辩护词表在【原句 cl】上判定（「不是异形/没有问题」是合法辩护表达）；
       但「不是好人/自己人/人类/船员」（negHuman，指向敌方）不得触发辩护——中性处理。 */
    if ((LEX.defend.test(cl) || LEX.defendT.test(cl)) && !negHuman) {
      let dt = [];
      const md = LEX.defendT.exec(cl);
      if (md) dt = [md[2] ? +md[2] : cnToInt(md[3])].filter(v => v >= 1 && v <= 15);
      if (!dt.length) dt = ids.filter(x => x !== meta.speaker);
      for (const id of dt.slice(0, 2)) {
        out.defend.push(id);
        out.intents.push(`辩护/背书 ${id} 号`);
      }
      if (!dt.length) out.intents.push('自证清白');
      return;
    }

    /* 质询：追问产生公开压力 */
    if (LEX.ask.test(cl)) {
      let at = ids.filter(x => x !== meta.speaker);
      if (!at.length && meta.lastIds) at = meta.lastIds.filter(x => x !== meta.speaker);
      for (const id of at.slice(0, 2)) {
        out.ask.push(id);
        out.intents.push(`质询 ${id} 号`);
      }
      if (!at.length) out.intents.push('要求说明');
      meta.lastIds = ids.length ? ids : meta.lastIds;
      return;
    }

    /* 划水 */
    if (LEX.pass.test(cl)) { out.pass = true; out.intents.push('划水'); return; }

    /* 仅提及：记住编号供下一子句继承（「5号…他绝对是异形」跨逗号） */
    if (ids.length) { out.intents.push(`提及 ${ids.join('、')} 号`); meta.lastIds = ids; }
  }

  /* ctx.speaker（v26 修复）：此前说话者恒为 -1，所有「排除说话者自己」的过滤（指控/质询/绑定）
     都是空操作——解析器会把「我投我自己」「我怀疑我」这类自指也当成对他人。 */
  function parse(text, ctx) {
    const out = {
      raw: text || '', mention: [], accuse: [], accTiers: {}, claim: null, ask: [],
      report: [], quote: [], voteIds: [], defend: [], rally: null, abstain: false,
      pass: false, roleBind: [], deny: [], promise: [], exp: [], intents: [], conf: 1,
    };
    if (!text) return out;
    const s = String(text);
    out.mention = idsIn(s);
    const meta = { speaker: (ctx && ctx.speaker != null) ? +ctx.speaker : -1, lastIds: null };
    /* 逗号/顿号不切，句末标点切——「5号，他绝对是异形」仍归一个子句 */
    const clauses = s.split(/(?<=[。！？!?；;\n])/).map(c => c.trim()).filter(Boolean);
    if (!clauses.length) clauses.push(s);
    for (const cl of clauses) parseClause(cl, out, meta);
    /* 合并去重 */
    out.accuse = [...new Set(out.accuse)].slice(0, 2);
    out.ask = [...new Set(out.ask)].slice(0, 2);
    /* 假设句降权：整句均带假设词且仅轻度指控 → 置信度下调 */
    if (out.intents.length && out.intents.every(t => t.includes('假设')) ) out.conf = 0.5;
    if (out.accuse.length && ASSUME.test(s) && !LEX.hard.test(s)) out.conf = Math.min(out.conf, 0.6);
    if (!out.intents.length && !out.claim && !out.mention.length) out.pass = true;
    /* 去噪：若编号已在指控/汇报/辩护/意向中体现，纯「提及 X 号」不再重复展示 */
    const other = out.intents.filter(t => !/^提及 /.test(t)).join(' ');
    out.intents = out.intents.filter(t => {
      if (!/^提及 /.test(t)) return true;
      const ids = (t.match(/\d+/g) || []);
      return !ids.every(id => other.includes(id + ' 号'));
    });
    return out;
  }

  /* 「原意」摘要：供 UI 在每条发言下以小字展示，玩家可核对 AI 对这句话的理解 */
  function summarize(sig) {
    if (!sig || !sig.intents || !sig.intents.length) return '';
    const seen = new Set(), parts = [];
    for (const t of sig.intents) {
      if (!seen.has(t)) { seen.add(t); parts.push(t); }
      if (parts.length >= 4) break;
    }
    return parts.join(' · ');
  }

  global.NLP = { parse, summarize, cnToInt, idsIn, ROLE_ALIAS, ROLE_NAME };
})(typeof window !== 'undefined' ? window : globalThis);
