/* =============================================================
 * 正文 v6.6 ↔ 声明层 情报出处对账（text-align.cjs）
 *
 * 存在理由（一次真实的判错逼出来的）：
 *   2026-10-08 我据「速查卡未授权」把 AI 的异形感染排除读法删掉了，
 *   而速查卡只是**没转录**正文 3.3.10④。漏的是卡，不是权。
 *   当时整条授权在声明层里连键都不存在，「这条情报有没有出处」在代码里无处可查。
 *
 * 本工具补上这个「无处可查」，并且**双向**对账：
 *   正向（编造）：每个 duty.senses 键都要在 SENSE_SOURCE 里有出处，
 *                 且 clause 号必须在正文提取件里真实存在。
 *   反向（漏项）：正文里明文授予可见性的条款，必须在声明层有对应 sense。
 *                 反向靠 WATCH 表 —— 这张表必须人工维护，且**写清每条为什么
 *                 在或不在**；新增正文版本时要逐条重核。
 *
 * ⚠ 三条纪律（否则本工具会变成新的漂移源）：
 *   1. **不改任何产品代码。** 只读、只报。缺口报到人，由人裁定。
 *   2. **不新增 sense 键。** 新键 = 新授权 = 产品裁定，不是对账工具的权限。
 *   3. **提取件不在库**（gitignored）。缺件时报错并给重建命令，**不静默跳过** ——
 *      静默跳过会让「全绿」变成「什么都没查」。
 *
 * 运行：node tools/text-align.cjs <仓库根>
 * 退出：0 = 无 P0；1 = 有 P0（编造 / 漏项）；2 = 提取件缺失（未对账）
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || process.cwd();
const EXTRACT = path.join(ROOT, 'docs', '_v66正文_提取.txt');
const PDF_SHA = 'EE5F95CE16C63042F25282BC99A29D82566017F66EE34C2D9373233E84E6834F';
const PDF_HINT = 'C:\\Users\\ASUS\\Documents\\xwechat_files\\wxid_6zst4zjefbzm22_8cbf'
  + '\\msg\\file\\2026-10\\太空杀V6.6正文_v66修订版.pdf';

/* ---------- 载入声明层 ---------- */
const lo = require(path.join(ROOT, 'tools', 'load-order.cjs'));
const ctx = lo.makeCtx({});
lo.loadInto(ctx, path.join(ROOT, 'js'), lo.profiles.full);
const RD = ctx.SKRoleDecl;
const SRC = RD.SENSE_SOURCE;


/* ---------- 条款索引器（自检与正式路径共用同一份实现）---------- */
const ITEM_HEAD = /^[①-⑳0-9]/;
function buildIndex(text) {
  const clauseNumbers = new Set();
  const clausePos = new Map();
  const clauseTitle = new Map();
  let flat = '';
  /* ⚠ 两条纪律，都是被 PDF 提取噪声逼出来的：
   *   ① 平铺与偏移必须**一起**算。flat 是去空白的文本；偏移若改用「trim 后行长累加」，
   *      行内那个空格会被多计，越走越偏 —— 首版正是这样，于是 3.3.10 的④ 与 6.8.4 的⑥
   *      明明在正文里，却被判成「查无此项」。
   *   ② 两种噪声必须挡掉，否则条款定位整个错位：
   *      噪声① 标题行把条款号**重复印了一遍**（`6.8.3 6.8.3 变形`）⇒ 标题开头若又是
   *            条款号样式的 token，剥掉它；
   *      噪声② 「以条款号开头」的行里混着**分项续行**（`6.8.3⑧克隆取得清洗）…`）。
   *            它们标题极短，若按「取最短标题」会赢过真标题，把窗口指到无关位置 ——
   *            首版正是这样，6.8.3 的真标题被 `⑧` 顶掉。
   *      排除判据：标题以**圈号（①…⑳）或阿拉伯数字**开头 ⇒ 分项续行，不是标题。 */
  for (const line of text.split('\n')) {
    const m = /^(\d+\.\d+(?:\.\d+)?)\s*(\S.*)$/.exec(line.trim());
    /* ⚠ 顺序不可调换：**先剥重复条款号，再判分项续行**。
     *   自检抓到过这个反例：噪声①那行「6.8.3 6.8.3 变形」的 rest 是「6.8.3 变形」，
     *   它以数字开头 ⇒ 若先判 ITEM_HEAD，真标题会被当成续行丢掉，6.8.3 于是在合成
     *   正文里根本不在册。反过来先剥号就对了：剥完剩「变形」；而真续行
     *   「6.8.3⑧克隆…」剥不动（⑧ 不是 N.N），仍被 ITEM_HEAD 拦下。 */
    const rest = m && m[2].replace(/^\d+\.\d+(?:\.\d+)?\s*/, '').trim();
    if (m && m[2].length <= 44 && rest && !ITEM_HEAD.test(rest)) {
      const num = m[1];
      const title = rest;
      {
        clauseNumbers.add(num);
        if (!clausePos.has(num) || title.length < clauseTitle.get(num).length) {
          clausePos.set(num, flat.length);
          clauseTitle.set(num, title);
        }
      }
    }
    flat += line.replace(/\s+/g, '');
  }
  /* 条款正文 = 本条款起点到「下一个同级或更高级条款号」之间的区段 */
  function clauseBody(c) {
    const from = clausePos.get(c);
    if (from == null) return null;
    const depth = c.split('.').length;
    const rx = /(\d+\.\d+(?:\.\d+)?)/g;
    let m, end = flat.length;
    rx.lastIndex = from + c.length;
    while ((m = rx.exec(flat))) {
      const num = m[1];
      const pos = clausePos.get(num);
      /* ⚠ 必须 `pos <= from` 而不是 `pos < from`：重复条款号那行的平铺文本是
       *   「6.8.36.8.3变形…」，末位「6.8.3」正好落在 `from + c.length` 上，
       *   它会被正则先命中，而它的 pos 就等于 from —— 若只排 `<`，窗口立刻
       *   塌成空串，6.8.3 的正文（含③）整段读不到。自检第④条抓的就是这个。 */
      if (pos == null || pos <= from) continue;
      if (num.split('.').length <= depth) { end = pos; break; }
    }
    return flat.slice(from, end);
  }
  /* 条款号必须真的存在；带 item 时，item 标记还必须出现在该条款正文里。
   * ⚠ 分开校验是必要的：`3.3.10①` 整体不是条款号，`3.3.10` 才是，`①` 是条款内的项。
   *   首版把两者拼在一起当条款号，本工具立刻报出 10 处 P0 —— 这正是它该干的活。 */
  function clauseExists(c, item) {
    if (!clauseNumbers.has(c)) return false;
    if (item == null) return true;
    const body = clauseBody(c);
    return body != null && body.indexOf(item) >= 0;
  }
  return { clauseNumbers, clausePos, clauseTitle, clauseBody, clauseExists };
}


const P0 = [], P1 = [];


/* ---------- 自检：证明本工具**会挂** ----------
 *
 * 一个从没报过错的检查器等于没有检查器。本段用合成正文逐条喂「故意写坏」的引用，
 * 断言每一种坏法都被拒。**它与正式路径共用 buildIndex**，所以自检通过 ≠ 索引逻辑对，
 * 只说明「这些坏法确实被覆盖」。
 *
 * 覆盖的坏法（每条都对应一次真实踩坑或一次真实的判错风险）：
 *   ① 编造条款号      —— 声明层引用了正文里没有的条款
 *   ② 编造项标记      —— 条款在，但那一项不存在（3.3.10⑤ 是真实存在的反例）
 *   ③ 条款号当项      —— 把 `3.3.10①` 整体当条款号（首版就是这么写的）
 *   ④ 续行冒充标题    —— `6.8.3⑧…` 把窗口指到无关位置
 *   ⑤ 重复条款号      —— `6.8.3 6.8.3 变形` 未剥号导致标题判空
 */
const SYNTH = [
  '3.3.10 感染标记可见性',
  '项',
  '说明',
  '77.①医生可见',
  '「谁带有感染标记」对医生可见，不显示真伪。',
  '78.②本人知晓',
  '被感染者本人知晓自身带有的感染标记。',
  '79.③对他人不公开',
  '除医生与本人外，一律不公开。',
  '80.④异形阵营可见',
  '异形于当夜选择感染目标时，可见并可分辨真伪。',
  '81.⑤适用范围声明',
  '本通则仅适用于感染标记。',
  '3.3.11 感染的结果无反馈',
  '感染施加结果不向被施加者反馈。',
  '6.8.3 6.8.3 变形',
  '①触发与时点',
  '②对象与次数',
  '③目标',
  '变形目标为本局实际在场的人类职业或异形。',
  '6.8.4 复生',
  '③濒死可见性：明文授予「可见当夜濒死者」。',
  '⑥留痕：公开「本夜发生 N 次复生」，不公开被复生者编号。',
].join('\n');

const si = buildIndex(SYNTH);
const cases = [
  { name: '① 编造条款号 9.9.9',        ok: si.clauseExists('9.9.9'),        want: false },
  { name: '① 真实条款 3.3.11',          ok: si.clauseExists('3.3.11'),       want: true  },
  { name: '② 项不存在 3.3.10⑥',        ok: si.clauseExists('3.3.10', '⑥'),  want: false },
  { name: '② 项存在 3.3.10⑤',          ok: si.clauseExists('3.3.10', '⑤'),  want: true  },
  { name: '③ 条款号当项 3.3.10①',      ok: si.clauseExists('3.3.10①'),      want: false },
  { name: '④ 续行未被当标题（6.8.3 项③可定位）', ok: si.clauseExists('6.8.3', '③'), want: true },
  { name: '⑤ 重复条款号已剥号（6.8.3 在册）', ok: si.clauseNumbers.has('6.8.3'), want: true },
  { name: '⑤ 剥号后标题非空',          ok: si.clauseTitle.get('6.8.3'),     want: '变形' },
  { name: '3.3.10 标题未被续行顶掉',    ok: si.clauseTitle.get('3.3.10'),    want: '感染标记可见性' },
];
console.log('── 自检：故意写坏的引用必须被拒 ──');
let selftestBad = 0;
for (const c of cases) {
  const pass = c.ok === c.want;
  if (!pass) selftestBad++;
  console.log('  ' + (pass ? '✓' : '✗') + ' ' + c.name.padEnd(34)
    + ' 实得=' + JSON.stringify(c.ok) + ' 期望=' + JSON.stringify(c.want));
}
if (selftestBad) {
  console.log('');
  console.log('✗ 自检挂了 ' + selftestBad + ' 条 —— 本工具的判据本身有问题，先修工具。');
  process.exit(3);
}
console.log('');
console.log('✓ 自检 ' + cases.length + '/' + cases.length + ' 通过：本工具确实会拒绝写坏的引用。');

/* ---------- 载入正文 ---------- */
if (!fs.existsSync(EXTRACT)) {
  console.error('正文提取件缺失：' + EXTRACT);
  console.error('这是**有意不入库**的（复制规则文本进仓库等于制造第二份规则，见 .gitignore）。');
  console.error('重建命令：');
  console.error('  python -c "import fitz,sys; d=fitz.open(r\'' + PDF_HINT
    + '\'); sys.stdout.write(\'\'.join(\'\\n===== PAGE %d =====\\n\'%(i+1)+p.get_text(\'text\') for i,p in enumerate(d)))\" > docs\\_v66正文_提取.txt');
  console.error('预期 SHA256（正文 PDF）：' + PDF_SHA);
  console.error('');
  console.error('⚠ 未对账就退出 —— 不静默跳过，否则「全绿」会变成「什么都没查」。');
  process.exit(2);
}
const txt = fs.readFileSync(EXTRACT, 'utf8').replace(/\r/g, '');
const idx = buildIndex(txt);
const clauseNumbers = idx.clauseNumbers;
const clauseExists = idx.clauseExists;
const row = (s) => console.log(s);

/* ============ 正向：声明层的每条情报都要有出处，且出处要真的存在 ============ */
row('══ 正文 v6.6 ↔ 声明层 · 情报出处对账 ══');
row('正文提取件：' + txt.length + ' 字，条款号 ' + clauseNumbers.size + ' 个');
row('声明层：' + RD.keys().length + ' 个角色，SENSE_SOURCE ' + Object.keys(SRC).length + ' 条');
row('');

const used = new Map();
for (const k of RD.keys()) for (const s of (RD.sensesOf(k) || [])) {
  if (!used.has(s)) used.set(s, []);
  used.get(s).push(k);
}

const byKind = { own: 0, granted: 0, derived: 0 };
row('── 正向：每个在用 sense 键的出处 ──');
for (const s of [...used.keys()].sort()) {
  const e = SRC[s];
  const roles = used.get(s).join(',');
  if (!e) {
    P0.push(`sense「${s}」无出处登记（用它的角色：${roles}）`);
    row(`  ✗ ${s.padEnd(22)} 无 SENSE_SOURCE 登记  ← P0`);
    continue;
  }
  if (!['own', 'granted', 'derived'].includes(e.kind)) {
    P0.push(`sense「${s}」的 kind「${e.kind}」不合法（须 own/granted/derived）`);
    row(`  ✗ ${s.padEnd(22)} kind=${e.kind} 非法  ← P0`);
    continue;
  }
  byKind[e.kind]++;
  const cite = e.clause + (e.item || '');
  if (!clauseExists(e.clause, e.item)) {
    const why = !clauseNumbers.has(e.clause)
      ? '正文查无此条款号'
      : ('条款存在但正文里未见「' + e.item + '」这一项');
    P0.push(`sense「${s}」引用 ${cite} —— ${why}`);
    row(`  ✗ ${s.padEnd(22)} 引用 ${cite.padEnd(10)} ${why}  ← P0`);
    continue;
  }
  row(`  ✓ ${s.padEnd(22)} ${e.kind.padEnd(8)} ${cite.padEnd(10)} ← ${roles}`);
}
row('');
row('  三类计数：own ' + byKind.own + ' / granted ' + byKind.granted + ' / derived ' + byKind.derived);
row('');

/* ============ 反向：正文里的可见性授权条款，声明层有没有接住 ============
 * WATCH 是**人工维护的观察名单**，每条必须写清「为什么在声明层有／没有对应 sense」。
 * 它的作用不是穷举正文（那做不到），而是把「已知的、容易漏的那几条」钉在案上：
 * 每次出新的越界或新的授权争议，都往这里加一条，并注明它为什么值得钉。
 */
const WATCH = [
  { clause: '3.3.10', item: '①', why: '医生可见感染标记清单，不显真伪',   want: ['infectMarks'] },
  { clause: '3.3.10', item: '②', why: '被感染者本人知晓自身标记与剩余致死时点，不辨真伪', want: [], selfOnly: true },
  { clause: '3.3.10', item: '③', why: '除医生与本人外一律不公开 —— 红线，无 sense 是对的', want: [] },
  { clause: '3.3.10', item: '④', why: '异形施加方视野：清单且可辨真伪（曾漏转录 → 判错一次）', want: ['infectMarksTrueFalse'] },
  { clause: '3.3.12', why: '医生可见当夜濒死者（治疗/救援所需的最低可见性）',   want: ['dyingList'] },
  { clause: '6.8.4', item: '③', why: '死囚明文授予可见当夜濒死者（曾漏转录 → 149 次误判）', want: ['dyingListForRevive'] },
  { clause: '6.8.4', item: '⑥', why: '复生留痕只公开 N 次，不公开被复生者编号 —— 红线，无 sense 是对的', want: [] },
  { clause: '2.3.5',  why: '票型可见的两项例外（验票官票源 / 异形队友票型）',    want: ['allVoteSources', 'allBallotCounts', 'teammateBallots'] },
  { clause: '2.8.7',  why: '默认不公开原则 —— 通则，无需逐条转录',               want: [] },
  { clause: '4.10.4', why: '濒死者须留在可选列表、不得移除或置灰（否则广播濒死）', want: [], note: 'UI 侧义务，非 sense' },
  { clause: '4.11.4', why: '工匠护甲不公开，持有者自知',                         want: ['ownArmorStock'] },
  { clause: '4.6.1',  why: '救援医师见濒死；致死来源清单仅实际救援后可见',         want: ['dyingList', 'deathSourceAfterSave'] },
  { clause: '7.1.3',  why: '最低必要可见性；明列死囚可见当夜濒死者',               want: ['dyingListForRevive'] },
  { clause: '7.2.2',  why: '攻击方只报生效/无效，不报原因 —— 红线，无 sense 是对的', want: [] },
  { clause: '7.2.4',  why: '外星人夜晚免疫消耗告知：已消耗/路径/剩余',            want: ['ownNightImmuneRemain'] },
];

row('── 反向：正文可见性授权条款 ↔ 声明层（人工观察名单）──');
for (const w of WATCH) {
  const cite = w.clause + (w.item || '');
  if (!clauseExists(w.clause, w.item)) {
    const why = !clauseNumbers.has(w.clause)
      ? '正文查无此条款号'
      : ('条款存在但正文里未见「' + w.item + '」这一项');
    P0.push(`WATCH 条目 ${cite} ${why}（观察名单失效）`);
    row(`  ✗ ${cite.padEnd(10)} ${why} —— 观察名单失效  ← P0`);
    continue;
  }
  const miss = w.want.filter(s => !used.has(s));
  if (miss.length) {
    P0.push(`正文 ${cite}（${w.why}）在声明层无对应 sense：${miss.join(',')}`);
    row(`  ✗ ${cite.padEnd(10)} 声明层缺 ${miss.join(',').padEnd(24)} ← P0  ${w.why}`);
  } else if (w.note) {
    row(`  ○ ${cite.padEnd(10)} ${w.why} —— ${w.note}`);
  } else if (w.selfOnly) {
    row(`  ○ ${cite.padEnd(10)} ${w.why}`);
  } else {
    row(`  ✓ ${cite.padEnd(10)} ${w.why}`);
  }
}
row('');

/* ============ 红线清单：这些条款**不应**产生 sense ============ */
/* 它们的共同形态是「规则明文要求不得透露」。若日后有人给它们加了 sense，
   那是把红线当成了可授权项 —— 故单独钉住，比夹在 WATCH 里更醒目。 */
const REDLINES = [
  { clause: '3.3.10③', text: '除医生与本人外一律不公开' },
  { clause: '5.3.1',    text: '濒死者须留在可选列表，不得移除或置灰（移除即广播濒死）' },
  { clause: '6.8.4⑥',   text: '复生留痕不公开被复生者编号' },
  { clause: '7.2.2',    text: '攻击结果只报生效/无效，不报原因' },
  { clause: '3.3.8',    text: '抗体仅获得者本人可见' },
];
row('── 红线清单：以下条款明文要求「不得透露」，不应存在对应 sense ──');
/* 把 SENSE_SOURCE 的 note 里提到红线条款号的键挑出来，反查它们是否越界授权 */
const redlineKeys = [];
for (const [s, e] of Object.entries(SRC)) {
  for (const r of REDLINES) if ((e.note || '').indexOf(r.clause) >= 0) redlineKeys.push(s + '(' + e.clause + ')');
}
if (!redlineKeys.length) row('  ✓ 无 sense 的 note 引用红线条款（正常）');
else row('  · 引用到红线条款的 sense：' + redlineKeys.join(' '));
row('  ⚠ 本工具**不能**自动判定「某 sense 是否越界授权」—— 那需要按角色×字段逐条推演，');
row('    属 tools/parity-referee.cjs 的职责。此处只保证红线条款本身在正文里站得住。');
row('');

/* ============ 结论 ============ */
row('══ 结论 ══');
row('P0（编造 / 漏项 / 观察名单失效）：' + P0.length + ' 处');
for (const p of P0) row('  · ' + p);
row('P1（提示）：' + P1.length + ' 处');
for (const p of P1) row('  · ' + p);
row('');
row(P0.length ? '判定：✗ 有 P0 —— 情报出处对不上账，先查清再改产品代码。'
  : '判定：✓ 每条情报都能追到正文里一条真实存在的条款，观察名单无失效项。');
process.exit(P0.length ? 1 : 0);