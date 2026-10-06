/* =============================================================
 * 太空杀 · 能力注册表生成器（v6.6 重构 C2 · 阶段 2 声明层）
 *
 * 用途：把「九关核验」提取数据（逐字 + 行号）转成程序可读的声明表
 *       js/v66/declaration/capabilityRegistry.js。
 *
 * 为什么用生成器而不是手抄：九关取值是规则权威文本，逐字保真是硬要求；
 *   机器搬运可消除人工转写误差，规则侧修订后重跑即可再生成
 *   （与 tools/build-engine-docx.cjs 同惯例：改内容重跑生成，不手改产物）。
 *
 * 输入（默认）：C:\Users\ASUS\Desktop\太空杀v6.6规则文本\_九关核验_提取数据.json
 *   该 JSON 由「九关核验提取任务」自《太空杀V6.6正文_改造v3.txt》(3489 行) 逐字提取，
 *   含 10 个核验块 × 12 字段槽 + 附录二速查卡 + 35 条歧义清单。
 * 用法：node tools/gen-capability-registry.cjs [输入JSON] [输出JS]
 *
 * 本文件内的「策展层」= 人工核定的三件事，除此之外一律机器搬运：
 *   ① 机制键（身份式命名，D4：不用 R01/E13 之类编号）
 *   ② owner 角色键（英文键属代码层事项，提取数据不推定，故在此核定）
 *   ③ 对提取数据的更正项（见 CORRECTIONS，每条须带规则依据）
 * ============================================================= */
const fs = require('fs');
const path = require('path');

const IN = process.argv[2] || 'C:\\Users\\ASUS\\Desktop\\太空杀v6.6规则文本\\_九关核验_提取数据.json';
const OUT = process.argv[3] || path.join(__dirname, '..', 'js', 'v66', 'declaration', 'capabilityRegistry.js');

/* ---------- 策展层：块 → 机制键 + owner 角色键 ----------
   steps ＝ 该机制的行动位（九关①的结构化形态）。九关①在正文里是**散文**
   （如「步骤3（与保镖保护（4.8）∕工匠护甲（4.11）同行动位）」），无法直接机器消费；
   此处把散文化为步骤键数组，逐条对照同块的 actionStep 原文核定（生成器会做一致性断言）。
   多行动位者（如猎手：开枪 6 / 嗅探 3.5）取全部。 */
const CURATION = {
  '4.3.1-九': { key: 'engineer.safeRoom',        owner: 'engineer', mech: '安全室（限定技）',            steps: ['3'] },
  '4.4.9':    { key: 'hunter.sniffAmmo',         owner: 'hunter',   mech: '开枪 / 嗅探 / 攒弹',          steps: ['6', '3.5'] },
  '4.6.4⑦':   { key: 'poisoner.poison',          owner: 'poisoner', mech: '毒药 / 解药',                steps: ['8'] },
  '4.9.7':    { key: 'inspector.votesMeeting',   owner: 'inspector', mech: '票源可见 / 紧急会议 / 专属发言', steps: ['10', 'day'] },
  '4.11.6':   { key: 'artisan.armor',            owner: 'artisan',  mech: '护甲（常规与速成）',          steps: ['3'] },
  '4.12.5':   { key: 'listener.wiretap',         owner: 'listener', mech: '窃听与报告',                 steps: ['0.2'] },
  '5.7-九':   { key: 'alien.cocoon',             owner: 'alien',    mech: '结茧护盾',                   steps: ['4b'] },
  '5.9⑧':     { key: 'alien.cleanse',            owner: 'alien',    mech: '清洗（昼末清理阶段）',        steps: ['P-clean'] },
  '6.8.7':    { key: 'convict.deformRevive',     owner: 'convict',  mech: '变形 / 复生（死囚局）',       steps: ['P-id', '8'] },
  '7.3.8':    { key: 'disguise.global',          owner: ['alien', 'xeno'], mech: '乔装（通则 7.3）',     steps: ['1'] },
};

/* ---------- 策展层：对提取数据的更正（须带规则依据） ---------- */
const CORRECTIONS = {
  '5.7-九': {
    field: 'coveredRoles',
    from: ['xeno'], to: ['alien'],
    reason: '正文第 5 章为异形章；5.7 上下文 2476-2477「多只异形同夜分别选破坏与结茧时，同在 4b 内…串行结算」，故结茧属异形（alien）。提取数据标 xeno 系英文键映射推定，其自身亦声明「键名映射属代码层事项，不推定」。',
  },
  '5.9⑧': {
    field: 'coveredRoles',
    from: ['xeno'], to: ['alien'],
    reason: '正文第 5 章为异形章；2537-2538「清洗对异形队友可见，属队内共享信息」，故清洗属异形（alien）。',
  },
};

/* ---------- 不在 RoleDecl 中已实装的角色（A6 待落地，登记为 pendingRole） ---------- */
const IMPLEMENTED = ['crew', 'engineer', 'sheriff', 'bio', 'rescue', 'detective', 'bodyguard',
                     'inspector', 'armed', 'assistant', 'tempdoc', 'alien', 'xeno'];

const GATES = ['actionStep', 'seat', 'judgeMode', 'damageLayer', 'infectLayer', 'visibility',
               'blocked', 'exempt', 'charges', 'process', 'batchDelta', 'restatement'];

const j = JSON.parse(fs.readFileSync(IN, 'utf8'));
const lines = [];
const w = s => lines.push(s);

const jsonify = v => JSON.stringify(v);

w('/* =============================================================');
w(' * 太空杀 · 能力注册表 Capability Registry（v6.6 重构 C2 · 阶段 2 声明层）');
w(' *');
w(' * ⚠️ 本文件由 tools/gen-capability-registry.cjs 自九关核验提取数据生成，请勿手改；');
w(' *    规则侧修订后重跑生成器：node tools/gen-capability-registry.cjs');
w(' *');
w(' * 数据来源：《太空杀V6.6正文_改造v3.txt》(3489 行，唯一权威源) 的十处「九关核验」块，');
w(' *   经逐字提取为 _九关核验_提取数据.json（每值附行号）。本表字段槽＝附录 C 的九关 schema');
w(' *   （①行动位 / ①之二席位 / ②判定基准 / ③伤害侧层序 / ④感染侧层序 / ⑤可见性 / ⑥封锁 /');
w(' *    ⑦额度记账 / ⑧公告批次 / ⑨重复阐述）。');
w(' *');
w(' * 性质：纯数据。K1 的落点——**加机制只在本表加一条**；推导层据 gates 自动长出该角色的');
w(' *   行动位、私有节点、可见性授予与事件族，执行层不认识任何具体机制名（H1 验收）。');
w(' *');
w(' * ── 提取阶段的三条前提修正（与改动清单 v1.1 不一致处，以正文为准）────────────');
w(' *  P1 九关核验实为 **10 块**，非 9 块：正文 5.9⑧ 末句 (2544) 自述「全文九关核验共九处」');
w(' *     并列举 9 条，**漏列 4.6.4（毒师）**；该块位于 1948 行、标题仅作「⑦九关核验」无条款前缀。');
w(' *  P2 2.8.10 段内实为 **10 个字段**（①+①之二+②~⑨）；而 2.8.9 称第⑨关为「2.8.10第九关」，');
w(' *     两套序号口径无法直接对齐（提取歧义 A3）。');
w(' *  P3 ③④两关在 2.8.10 (1063) **没有「核对项名称」**（原文仅「③伤害侧层序（2.8.2）｜');
w(' *     ④感染侧层序（5.3.3）」），故 damageLayer / infectLayer 两个字段名出自改动清单');
w(' *     附录 C（1307/1310），非正文用词。');
w(' *');
w(' * ── 附录二《职业速查卡》的结构修正 ───────────────────────────────');
w(' *  实际列名（3343-3346 逐字）：职业 ｜ 核心能力 ｜ 关键额度 ｜ 暴露风险∕定位。');
w(' *  改动清单 609 行所称「速查卡每职业六行（夜间行动/核心能力/额度与到账/目标限制/');
w(' *  可见性/封锁）」在正文附录二中**无对应物**——速查卡不含封锁列、不含判定基准列；');
w(' *  猎手 (4.4.7) 与毒师 (4.6.4) 在附录二**无条目**。故本表全部取值只取九关核验块，');
w(' *  速查卡仅作交叉校验（冲突见 META.cheatsheetConflicts）。');
w(' *');
w(' * ── owner 角色键与实现状态 ───────────────────────────────────');
w(' *  owner 为英文角色键（正文不含英文键，属代码层事项）。hunter/poisoner/artisan/listener/');
w(' *  convict 为 v6.6 新增角色（A6 尚未实装），以 pendingRole 标注，不阻塞本表登记。');
w(' *  5.7 / 5.9 两块在提取数据中标为 xeno，经正文核对（2476-2477 / 2537-2538，第 5 章为异形章）');
w(' *  更正为 alien，见文件末 CORRECTIONS。');
w(' * ============================================================= */');
w('(function (global) {');
w('  /* ---------- 九关 schema（附录 C）：字段名即契约 ---------- */');
w('  const GATE_SCHEMA = {');
w("    actionStep:  { gate: '①',      rule: '2.8.6',  desc: '行动位归属：步骤名或前置阶段名（图 2）' },");
w("    seat:        { gate: '①之二',  rule: '1.1.1',  desc: '席位归属；不占席位者 null（正文作「不适用」）' },");
w("    judgeMode:   { gate: '②',      rule: '2.8.1',  desc: '判定基准（正文十块均作「字面身份（2.8.1①）」）' },");
w("    damageLayer: { gate: '③',      rule: '2.8.2',  desc: '伤害侧层序：全额减免|时限类|存续类|不参与＋类内序号' },");
w("    infectLayer: { gate: '④',      rule: '5.3.3',  desc: '感染侧层序：同上；抗体为感染侧专属时限类' },");
w("    visibility:  { gate: '⑤',      rule: '2.8.7',  desc: '可见性授予清单（批次/私反馈/仅本人/队内）' },");
w("    blocked:     { gate: '⑥',      rule: '2.8.3',  desc: '是否受封锁（沉默与感染抑制；总清单③）' },");
w("    exempt:      { gate: '⑥',      rule: '2.8.3④', desc: '明文豁免 / 时序确认（非例外者无须登记 2.8.9）' },");
w("    charges:     { gate: '⑦',      rule: '2.5',    desc: '额度记账（2.5 获取侧）' },");
w("    process:     { gate: '⑦',      rule: '2.9',    desc: '进程型产出（投入 N 夜/可中断/产物/次夜到账）' },");
w("    batchDelta:  { gate: '⑧',      rule: '2.1.6',  desc: '是否新增或改变任一公告批次' },");
w("    restatement: { gate: '⑨',      rule: '0.3/2.8.9', desc: '重复阐述：重申|适用|例外（例外须登记 2.8.9）' },");
w('  };');
w('');
w('  /* ---------- 机制声明表（10 条，逐字取自九关核验块） ---------- */');
w('  const MECHANISMS = {');

for (const b of j.blocks) {
  const c = CURATION[b.id];
  if (!c) throw new Error('策展表缺块：' + b.id);
  const owners = Array.isArray(c.owner) ? c.owner : [c.owner];
  const pending = owners.filter(o => IMPLEMENTED.indexOf(o) < 0);
  w(`    /* ${b.id} —— ${c.mech}（${owners.join(' + ')}） */`);
  w(`    ${jsonify(c.key)}: {`);
  w(`      clause: ${jsonify(b.id)},`);
  w(`      owner: ${jsonify(c.owner)},`);
  w(`      mechanism: ${jsonify(c.mech)},`);
  w(`      lines: ${jsonify(b.lines)},`);
  w(`      steps: ${jsonify(c.steps)},        // 九关① 的结构化形态（策展核定，与同块 actionStep 原文一致）`);
  const corr = CORRECTIONS[b.id];
  if (corr) {
    w(`      /* 更正：提取数据 ${corr.field}=${jsonify(corr.from)} → ${jsonify(corr.to)}。${corr.reason} */`);
    w(`      coveredRolesExtracted: ${jsonify(corr.from)},`);
  }
  w(`      pendingRole: ${pending.length ? jsonify(pending) : '[]'},`);
  w(`      gates: {`);
  for (const g of GATES) {
    const v = (b.values || {})[g];
    w(`        ${g}: ${jsonify(v)},`);
  }
  w('      },');
  w('    },');
}
w('  };');
w('');
w('  /* ---------- 提取阶段的元信息与冲突清单（供审核与断言引用） ---------- */');
w('  const META = {');
w("    sourceLines: " + (j._meta && j._meta.sourceTotalLines ? j._meta.sourceTotalLines : 3489) + ",");
w("    blockCount: " + j.blocks.length + ",");
w("    gateCount: 10,");
w("    blockCountNote: '正文 5.9⑧ (2544) 自述共九处并列举 9 条，漏列 4.6.4（毒师）块 → 实为 10 块',");
w("    gateCountNote: '2.8.10 (1060-1066) 含 ①+①之二+②~⑨ 共 10 字段；2.8.9 称第⑨关为「2.8.10第九关」，序号口径不可对齐',");
w("    cheatsheetColumns: ['职业', '核心能力', '关键额度', '暴露风险∕定位'],");
w("    cheatsheetSixRowStructureAbsent: true,");
w("    cheatsheetNote: '改动清单 609 行所称六行结构在正文附录二无对应物；速查卡不含封锁列/判定基准列',");
w("    cheatsheetMissingRoles: ['hunter', 'poisoner'],");
w("    cheatsheetConflicts: [");
w("      { id: 'D1', role: '警长', appendixTwo: { lines: '3305-3306', verbatim: '存储上限 2发（仅约束 4.4.3额外子弹；悬赏回复守恒不增量）' }, body: { lines: ['1642', '1646-1648'], verbatim: '警长的子弹存量设上限 2 发：任何来源的子弹（初始 1 发、4.4.3 的额外子弹、4.4.2 的悬赏回复）到账后，存量一律不得超过2发' }, nature: '实质冲突：上限约束对象（仅额外子弹 vs 任何来源/约束存量）' },");
w("      { id: 'D3', role: '工程师', appendixTwo: { lines: '3291-3292', verbatim: '每夜维修−1.0~1.5（自选，步长0.1）（倒计时与净破坏量各1.0）' }, body: { lines: ['1536', '1537'], verbatim: '维修量：每夜−1.0~1.5（自选，步长 0.1，共 6 档）……①倒计时−（当夜实际结算值）；②净破坏量−（同值）' }, nature: '括注冲突：「各1.0」与「自选值/实际结算值」不一致' },");
w("      { id: 'D14', role: '神探', appendixTwo: { lines: '3315', verbatim: '恒真查验' }, body: { lines: '1957', verbatim: '结论可能不成立' }, nature: '实质冲突：速查卡称恒真、正文称结论可能不成立' },");
w("    ],");
w("    pendingVerification: [");
w("      { item: '外星人夜晚免疫全局 2 次', appendixTwo: '3369', body: '2614 起（6.4，无九关核验块）', status: '未判定：无九关块可交叉验证' },");
w("      { item: '异形感染 2 名（感染进化 3 名）', appendixTwo: '3365-3366', body: '2304 起（5.3，无九关核验块）', status: '未判定：无九关块可交叉验证' },");
w("    ],");
w("    seatPointerMirrorBug: '4.11.6 写「与保镖同席位（4.11）」、4.12.5 写「与验票官同席位（4.12）」，括注指向自身章号；4.9.7 写「与窃听者同席位（4.12）」指向配对方 → 同一写法语义不一致，不可直接作配对席位出处',");
w('  };');
w('');
w('  /* ---------- 更正记录（数据保真链：正文 → 提取 → 本表） ---------- */');
w('  const CORRECTIONS = {');
for (const [id, c] of Object.entries(CORRECTIONS)) {
  w(`    ${jsonify(id)}: { field: ${jsonify(c.field)}, from: ${jsonify(c.from)}, to: ${jsonify(c.to)},`);
  w(`      reason: ${jsonify(c.reason)} },`);
}
w('  };');
w('');
w('  /* 步骤键 → 正文中的书写形态（用于「策展的 steps 必须能在同块 actionStep 原文里找到」的核对） */');
w('  const STEP_TEXT = {');
w("    '3': ['步骤3', '步骤 3'], '3.5': ['步骤 3.5'], '4b': ['步骤 4b'], '6': ['步骤6', '步骤 6'],");
w("    '8': ['步骤 8'], '10': ['步骤 10'], '0.2': ['步骤 0.2'], 'day': ['白天流程'],");
w("    'P-clean': ['昼末清理阶段'], 'P-id': ['身份改变子步骤'], '1': ['步骤 1'], '0.1': ['步骤 0.1'],");
w("    '2': ['步骤 2'], '4a': ['步骤 4a'], '7': ['步骤 7'], '0.55': ['步骤 0.55'], '11': ['步骤 11'],");
w('  };');
w('');
w('  /* ---------- 查询与自检 ---------- */');
w('  const keys = () => Object.keys(MECHANISMS);');
w('  const get = key => MECHANISMS[key] || null;');
w('  /** 某角色声明了哪些机制（owner 为数组者亦命中） */');
w('  function ofRole(roleKey) {');
w('    return keys().filter(k => {');
w('      const o = MECHANISMS[k].owner;');
w('      return Array.isArray(o) ? o.indexOf(roleKey) >= 0 : o === roleKey;');
w('    });');
w('  }');
w('  /** 抽取某关的全部取值（供推导层批量消费，如全机制的行动位集合） */');
w('  function gate(g) {');
w('    const out = {};');
w('    for (const k of keys()) out[k] = MECHANISMS[k].gates[g];');
w('    return out;');
w('  }');
w('  /** C5 倒排：某行动位上声明的全部机制键（机制 → 行动位 的逆向查询） */');
w('  function mechanismsAt(step) {');
w('    return keys().filter(k => (MECHANISMS[k].steps || []).indexOf(step) >= 0);');
w('  }');
w('  /** 全部被声明的行动位（去重，按首次出现序） */');
w('  function allSteps() {');
w('    const seen = [];');
w('    for (const k of keys()) for (const s of (MECHANISMS[k].steps || [])) if (seen.indexOf(s) < 0) seen.push(s);');
w('    return seen;');
w('  }');
w('  /** 自检：返回违规清单（空数组＝合规） */');
w('  function audit() {');
w('    const bad = [];');
w('    for (const k of keys()) {');
w('      const m = MECHANISMS[k];');
w('      /* 1. 十关必须齐备（正文十块每关均有明文，故不允许缺槽） */');
w('      for (const g of Object.keys(GATE_SCHEMA))');
w('        if (!m.gates || !Object.prototype.hasOwnProperty.call(m.gates, g)) bad.push(k + ": 缺关 " + g);');
w('      /* 2. 每条须可溯源：条款号 + 行号 */');
w('      if (!m.clause) bad.push(k + ": 缺条款号");');
w('      if (!m.lines) bad.push(k + ": 缺行号");');
w('      /* 3. owner 必须非空（键即身份，D4） */');
w('      const owners = Array.isArray(m.owner) ? m.owner : [m.owner];');
w('      if (!owners.length || owners.some(o => !o)) bad.push(k + ": owner 缺失");');
w('      /* 4. 机制键不得含纯编号段（D4：去编号，键即身份） */');
w('      if (/(^|[.:_-])[RE]?\\d+(\\.\\d+)?$/.test(k) || /^[RE]\\d+$/.test(k)) bad.push(k + ": 键名含编号（违反 D4）");');
w('      /* 5. 结构化 steps 必须非空，且每个步骤键都能在同块 actionStep 原文里找到（策展 × 正文核对） */');
w('      if (!Array.isArray(m.steps) || !m.steps.length) bad.push(k + ": 缺结构化 steps");');
w('      else {');
w('        const verbatim = (m.gates && m.gates.actionStep && m.gates.actionStep.verbatim) || "";');
w('        for (const s of m.steps) {');
w('          const forms = STEP_TEXT[s];');
w('          if (!forms) { bad.push(k + ": 未登记的步骤键 " + s); continue; }');
w('          if (!forms.some(f => verbatim.indexOf(f) >= 0))');
w('            bad.push(k + ": steps 含 " + s + "，但 actionStep 原文里找不到对应书写（" + forms.join("/") + "）");');
w('        }');
w('      }');
w('    }');
w('    /* 5. 条数不得**少于**转录条数（防有人删掉转录条目）；允许更多——K1：按声明新增机制是合法增长，');
w('          本项曾在 H3 验收中被抓出「禁止新增」的设计冲突，故由「必须等于」改为「不得少于」。 */');
w('    if (keys().length < META.blockCount) bad.push("机制条数 " + keys().length + " 少于转录条数 " + META.blockCount + "（转录条目被删？）");');
w('    return bad;');
w('  }');
w('');
w('  global.SKCapability = { GATE_SCHEMA, MECHANISMS, META, CORRECTIONS, STEP_TEXT, keys, get, ofRole, gate, mechanismsAt, allSteps, audit };');
w("})(typeof window !== 'undefined' ? window : globalThis);");

fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
console.log('已生成 ' + OUT);
console.log('  机制条数 ' + j.blocks.length + ' · 关卡槽 ' + GATES.length + ' · 行数 ' + lines.length);
