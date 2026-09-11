/* 把游戏引擎（模块化架构 + AI 独立运行模块 + 蒙特卡洛结果 + 全部源码）打包成 docx 到桌面 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  Footer, PageNumber, PageBreak, TableOfContents,
} = require('docx');

const ROOT = path.join(__dirname, '..');
const OUT = 'C:\\Users\\ASUS\\Desktop\\太空杀游戏引擎.docx';
/* 读取路径与 tools/mc.cjs 的写出路径保持一致（Desktop/.tmp_docs），修正此前多一层 .. 导致读到旧快照 */
const MC = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, '..', '.tmp_docs', 'mc_result.json'), 'utf8')); } catch (e) { return null; } })();

const border = { style: BorderStyle.SINGLE, size: 1, color: 'BFC9D9' };
const borders = { top: border, bottom: border, left: border, right: border };
const CONTENT_W = 9360;

function h1(t) { return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] }); }
function h2(t) { return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] }); }
function p(t, opts = {}) { return new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: t, ...opts })] }); }
function bullet(t) { return new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 40 }, children: [new TextRun(t)] }); }
function codePara(line) {
  return new Paragraph({
    spacing: { before: 0, after: 0, line: 260, lineRule: 'exact' },
    shading: { fill: 'F5F7FA', type: ShadingType.CLEAR },
    children: [new TextRun({ text: line.length ? line : ' ', font: 'Consolas', size: 15 })],
  });
}
function codeBlock(file, title) {
  const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
  return { title, lines: src, n: src.length };
}
function pushCode(children, heading, block) {
  children.push(new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_2, children: [new TextRun(`${heading}（${block.n} 行）`)] }));
  for (const line of block.lines) children.push(codePara(line));
}
function cell(w, text, bold, fill) {
  return new TableCell({
    borders, width: { size: w, type: WidthType.DXA },
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 60, bottom: 60, left: 110, right: 110 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: !!bold, size: 19 })] })],
  });
}
function table(rows, widths) {
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths,
    rows: rows.map((r, i) => new TableRow({ children: r.map((c, j) => cell(widths[j], c, i === 0, i === 0 ? 'DCE6F1' : undefined)) })),
  });
}
const pct = v => MC && MC.done ? (100 * v / MC.done).toFixed(1) + '%' : '—';

/* ============ 源码模块分组（v27 模块化解耦后的分层） ============ */
const JS = f => codeBlock(path.join(ROOT, 'js', f), f);
const TOOL = f => codeBlock(path.join(ROOT, 'tools', f), f);
const G = {
  config: ['rng.js', 'data.js'].map(JS),
  state:  ['state.js'].map(JS),
  lang:   ['nlp.js', 'lang/ir.js', 'lang/renderer.js'].map(JS),
  ai:     ['ai/util.js', 'ai/belief.js', 'ai/perceive.js', 'ai/decide.js', 'ai.js'].map(JS),
  infer:  ['infer/tiers.js', 'infer/registry.js', 'infer/moe.js', 'infer/channels.run.js',
           'infer/visible.js', 'infer/speakable.js', 'infer/pipeline.js'].map(JS),
  corpus: ['corpus/tactics.js', 'corpus/channels.data.js', 'corpus/channels.js'].map(JS),
  core:   ['engine/announce.js', 'engine/steps.js', 'engine.js'].map(JS),
  view:   ['view.js', 'ui.js'].map(JS),
  drive:  ['main.js', 'audio.js', 'net.js'].map(JS),
  server: [codeBlock(path.join(ROOT, 'server', 'server.js'), 'server.js')],
  mc:     [TOOL('mc.cjs')],
  reg:    [TOOL('test-fix-v26.cjs')],
  tool:   ['load-order.cjs', 'sync-html.cjs', 'fingerprint.cjs'].map(TOOL),
};
const srcBlocks = [...G.config, ...G.state, ...G.lang, ...G.ai, ...G.infer, ...G.corpus, ...G.core, ...G.view, ...G.drive, ...G.server];
const totalLines = srcBlocks.reduce((a, b) => a + b.n, 0);
const fileCount = srcBlocks.length + G.mc.length + G.reg.length + G.tool.length;
const srcCount = f => codeBlock(path.join(ROOT, 'js', f), f).n;

/* ============ 通道接线进度（v26：从源码推导，避免手写清单漂移） ============
   已接线 = moe.js 里注册了 gate 的编号 ∩ 506 条总表中的编号 ∩ 数值档（Z/F 是零值语义标记，不接线；
   P 自 v31 批 1 起有显式强度映射 SCORE['P']=10，批 3.5 起更可由门禁用 impl.tier 声明真实强度档）。 */
const SCORE_TIERS = (() => {
  const s = fs.readFileSync(path.join(ROOT, 'js', 'infer', 'tiers.js'), 'utf8');
  const body = /const SCORE = \{([\s\S]*?)\};/.exec(s);
  const set = new Set();
  if (body) for (const k of body[1].matchAll(/'([^']+)':\s*(\d+)/g)) if (+k[2] !== 0) set.add(k[1]);
  return set;
})();
const CH_TABLE = (() => {
  /* v27：总表数据已解耦到 corpus/channels.data.js（v31 批 3.5 后 506 条） */
  const s = fs.readFileSync(path.join(ROOT, 'js', 'corpus', 'channels.data.js'), 'utf8');
  const m = {};
  const re = /\{ id: '([^']+)', expert: '([^']*)', tier: '([^']*)', target: '([^']*)', on: '([^']*)'/g;
  let x; while ((x = re.exec(s)) !== null) m[x[1]] = { expert: x[2], tier: x[3], target: x[4], on: x[5] };
  return m;
})();
const WIRED = (() => {
  /* v27：门禁表已解耦到 infer/channels.run.js */
  const s = fs.readFileSync(path.join(ROOT, 'js', 'infer', 'channels.run.js'), 'utf8');
  const ids = new Set(); let x;
  const re = /^\s{4}([A-Z]+\d+):\s*\{/gm;
  while ((x = re.exec(s)) !== null) ids.add(x[1]);
  const mounted = [...ids].filter(id => CH_TABLE[id] && SCORE_TIERS.has(CH_TABLE[id].tier));
  const unmounted = [...ids].filter(id => !CH_TABLE[id]);
  return { mounted: mounted.sort(), unmounted };
})();
const SCORE_BY_EXPERT = () => {
  const by = {};
  for (const id of WIRED.mounted) (by[CH_TABLE[id].expert] = by[CH_TABLE[id].expert] || []).push(id);
  return by;
};

const children = [];

/* 封面 */
children.push(
  new Paragraph({ spacing: { before: 2200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: '太空杀 · 三阵营对抗', bold: true, size: 56 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '游戏引擎技术文档（模块化 · 含 AI 独立运行模块）', size: 30, color: '555F6E' })] }),
  new Paragraph({ spacing: { before: 160 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: '正式版 v4.1 规则实现 · v25 反靶向架构优化 · v26 阶段②接线 · v27 模块化解耦 · v28 交接落地（A1/A5/A6 + 仪器）· v28b B 类裁定（B1/B2/B3）· v28c 标定（B6/B7）· v31 三合一（批 0~3：清理 / B4+B2′ / A3 / 战术库接线）+ 三项裁定（口头汇报≠公告 / AI 加否认 / 自证调档位）+ 批 3.5 人类侧保护专项（N401~N407 / N414~N417）', size: 22, color: '8a93a3' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `生成日期：2026-09-10　共 ${fileCount} 个源文件 / ${totalLines} 行　通道接线 ${WIRED.mounted.length}/${Object.keys(CH_TABLE).length}`, size: 22, color: '8a93a3' })] }),
  new Paragraph({ children: [new PageBreak()] }),
);
children.push(h1('目录'), new TableOfContents('目录', { hyperlink: true, headingStyleRange: '1-2' }), new Paragraph({ children: [new PageBreak()] }));

/* 1 概述与模块化 */
children.push(
  h1('1. 概述'),
  p('本文档收录《太空杀 · 三阵营对抗》网页原型的完整游戏引擎，并按「可割裂运行」原则做模块化切割：AI 运行模块（nlp + ai）与引擎核心（engine）只依赖配置层与状态层，不接触任何 DOM / UI / 网络代码，可在纯 Node 沙盒中独立运行蒙特卡洛模拟（见第 5 章实测）。'),
  h2('1.1 模块分层'),
  table([
    ['层级', '模块', '职责', '可独立运行'],
    ['L1 配置层', 'rng.js / data.js', '确定性随机源、职业表、决策窗口时长（B 类运营参数）', '✓'],
    ['L2 状态层', 'state.js', '玩家初始状态（额度/西塔/E 三通道先验/C 表）、对局级状态', '随引擎'],
    ['L3 引擎核心', 'engine/announce.js（投递原语）· engine/steps.js（26 个步骤条目）· engine.js（状态机与驱动，617 行）', '步骤状态机、表单决策、全部结算规则、胜负判定', '✓（headless）'],
    ['L4 语言层', 'nlp.js / lang/ir.js / lang/renderer.js', '语义识别、Claim IR 交换格式、发言渲染', '✓（随 L1~L3）'],
    ['L5 AI 运行层', 'ai/util.js · ai/belief.js（估值）· ai/perceive.js（入账）· ai/decide.js（决策）· ai.js（门面 54 行）', 'E 三通道证据分模型、投影与危险度、推理链 R1~R41 入账、效用 + ε-greedy、发言与票型协调', '✓（随 L1~L3）'],
    ['L6 推理层', 'infer/tiers.js · infer/registry.js（专家/门禁注册表）· infer/moe.js（路由/仲裁/影子）· infer/channels.run.js（门禁表 + 执行器）· infer/visible.js · infer/speakable.js · infer/pipeline.js', '专家路由与三档仲裁、通道门禁执行、可见性过滤、可说性候选、统一发言管道', '✓（随 L1~L5）'],
    ['L7 语料层', 'corpus/tactics.js（战术库 + 人类侧保护优先级池 N414~N416）· corpus/channels.data.js（506 条数据）· corpus/channels.js（查询 API）', '战术库、推断通道总表', '✓'],
    ['L8 视图层', 'view.js / ui.js', '信息可见性裁剪（SKVisible 投递侧）、界面渲染', '浏览器'],
    ['L9 驱动层', 'main.js / audio.js / net.js', '单机时钟、静默检测、音频、联机客户端（开发中）', '浏览器'],
    ['L10 服务器', 'server/server.js', '房间与广播（联机，开发中）', 'Node'],
  ], [1400, 3200, 3260, 1500]),
  h2('1.2 运行方式'),
  bullet('单机对局：静态打开 index.html，其余 14 人由 AI 接管。'),
  bullet('蒙特卡洛：npm run mc（= node tools/mc.cjs 500 1）——只加载纯逻辑栈（24 个文件），无任何 DOM 依赖。'),
  bullet('回归套件：npm run test:all（缺陷回归 test-fix-v26 → 语言库 round-trip → UI 冒烟 → 60 局模拟）。'),
  bullet('行为等价指纹：node tools/fingerprint.cjs 200 1 —— 逐局比对结局线 + 每夜估值采样，任何"不该改行为"的重构都必须与基线 hash 一致。'),
  bullet('加载清单一致性：node tools/sync-html.cjs --check —— 校验 index.html 的脚本块与 tools/load-order.cjs 清单一致。'),
  bullet('联机（开发中）：npm start（= node server/server.js）。'),
  h2('1.3 数据流'),
  p('main.js 时钟 → Engine.stepOnce（beginStep 生成决策窗：真人得表单、AI 由 ai.decide 即时求解）→ 全员提交/超时 → finishStep 按当夜随机结算顺序执行 run() → view 信息裁剪 → ui 渲染。寂灭/决斗切换队列；威胁度经 R17/R17b/R29/R30 在死亡与驱逐揭示时闭环追责。'),
  h2('1.4 v26 变更（摘要，详见第 4 章）'),
  bullet('三处 P0 断点修复：推理链空心化（宣称类补目标侧入账）· 硬源锁定对「人类」失效（knownLockOf 阵营校验表）· 玩家与 AI 不对等（文本路径产不出 faction、汇报分支吞掉同句指控）。'),
  bullet('阶段②通道接线两批：执行器幂等键补观察者维度、编号挂载校验、量纲统一；接线 14（含 5 条死编号）→ 32/499，触发通道 5 → 16。'),
  bullet('仪器：通道分叉度 / 证据层分叉度 / 分阵营 AUC / 宣称侧计数；共识热度改「名次口径」（被驱逐者 43% 为投票前第 1 名）。'),
  h2('1.5 v27 变更：模块化解耦（本次）'),
  p('目的：在动「语义与约束 / 私有硬源 / 通道接线」之前，先把两个千行单闭包与散落的加载清单拆开。原则是只搬移、不改写——被搬移代码块字节级不变，对外导出面（AI.* / MoE.* / Channels.* / Engine.*）零改动。'),
  bullet('八个切分（均已验证行为等价）：加载契约单点化 → ai.js 拆 belief（估值）→ moe.js 拆 registry（注册表）→ channels.js 拆 data（499 条数据）→ ai.js 拆 util/perceive/decide（入账/决策分层）→ engine.js 拆 announce（投递原语）→ moe.js 拆 channels.run（门禁表 + 执行器）→ engine.js 拆 steps（STEPS 表 1165 行，工厂注入）。'),
  bullet('加载契约：原先 20 个 js 的加载顺序在 7 处（index.html + 6 个工具）各自硬编码，现收敛为 tools/load-order.cjs 单一真源（6 个剖面），index.html 由 tools/sync-html.cjs 生成。'),
  bullet('依赖方向（单向无环）：ai/util → ai/belief → ai/perceive → ai/decide → ai（门面）；engine/announce + engine/steps → engine；infer/registry → infer/moe → infer/channels.run。跨层共用的 GRUDGE_W / BAND_DOWN 下沉到 ai/util.js 单点定义。'),
  bullet('规模变化：js/ai.js 1709 → 54 行（纯门面）；js/engine.js 1777 → 617；js/infer/moe.js 524 → 188；js/corpus/channels.js 1029 → 19；新增 12 个模块，js 文件 23 → 29。'),
  bullet('验收方式：tools/fingerprint.cjs 对固定种子 200 局做「结局线 + 每夜全体观察者×目标的 suspDist/dangerOf 六位小数采样」哈希，八步的 hash 全程恒为 9ee5c4ae…（逐局 0/200 差异），mc 读数一字未变（chan_wired 32/499、证据层分叉度 0.2957）。'),
  bullet('顺带修复：tools/dbg1.cjs 与 SK_NO_BRIDGE 剖面的加载清单缺 infer/tiers（自 v22 引入档位表起，一运行即崩），已修并新增 aiOnly/minimal 剖面。'),
  h2('1.6 v28 变更：按 v27 交接内容落地（本次）'),
  p('依据：v27 交接文档第 12 章「未修复点」+ 第 14 章「交接要点」+ 当时的未修复点清单 §7 建议顺序。原则：只做不需要设计裁定的项（A 类代码缺陷 + C 类仪器）。逐条实施记录见 docs/v31执行台账.md（v26~v29 时代的历史文档已归档 _archive_docs_v26-v29/）。'),
  bullet('A1 影子层字段名 bug（1 行）：moe.js 的 shadowRisk 守卫读 claim.target，而 IR.mk 产出 targets[] → 1536/1536 次调用返回 0（影子层结构上是死代码）。修后 500 局 calls 3487 · 采纳率 0 → 3.07%，返回值分布首次可读（p50 −0.0120 / p90 0.0168 / max 0.2946）。'),
  bullet('C1 / C3 仪器三件套：① 硬源三分类计数（直接按 knownLockOf 读 p.known，绕开 project() 短路导致的 srcKind.fact 盲区）② MoE.shadowSummary() 影子返回值分布 ③ 每 gate「求值次数 / 命中次数」——17 条「求值>0 而 0 命中」的接线首次可见。'),
  bullet('A6 宣称语义与约束：R38 族全部经 Tiers.RULE 查表（旧实现是函数体内硬编码字典，违反「幅度唯一来源 = 档位表」）；R38crew 由 B(20) 下调 D+(7)（「我是普通船员」的减疑收益 −15 → −8）；crew 不再豁免对证链（可被 cross A− 击穿）；doc → bio 口径四处收口 + pipeline 兜底（旧实现宣称医生完全不产证据）。'),
  bullet('A5 K1 沉默指纹：档位入 Tiers.RULE.kingSilent = C（旧实现硬编码 SCORE[\'D\']，且 D 档还要再乘 (0.4+0.6C)）；触发面收紧为 actF(g,t) === 0（零公开行为）；频次 2 夜 → 3 夜；排除被蛰伏沉默压制者（不误伤受害者）。'),
  bullet('D2 / A4 只交付评估：D2 私有硬源诊断 + 量级警告（排除信息若按最小档 D− 接线会产生 +12~18pp 偏移，远超文档实测 +4.7pt → 方向与量级须一起裁定）；A4 结论为「不建议为指标好看放开跨专家分组」，要可达需改产出面。'),
  bullet('回归断言 29 → 40 条（新增覆盖 A1 / C3 / A6① ② ③ / A5）。行为指纹新基线 9a600934…（v27 的 9ee5c4ae… 因有意的行为改动作废）。'),
  bullet('★ v28b（B 类裁定落地，同日第二批）：B1 破坏决策改为「推理库 + 引擎状态」实时自主评估（不加硬推——停摆三档全部可达）；B2 把全部怀疑度/危险度调用值统一到 Tiers 常量表（行为中性，指纹逐字节一致）；B3 新增专用最弱档 D-- 并接线排除信息（私有 + 公开两路）。回归断言 40 → 51 条，指纹新基线 120d2cdc…。详见 4.8。'),
  h2('1.7 v31 变更：三合一优化总方案 批 0~3（本次）'),
  p('依据《太空杀 · 三合一优化总方案 v31》（MoE 架构 · 信息推理 · 推理库激活）§8.1 分批计划。逐批台账见 docs/v31执行台账.md。方案首批顺序为「0 清理 → 1 B4+B2′ → 2 A3 → 3 战术库 37 条 → 4 方案A（入账走 MoE）→ 5 方案D（全局注意力池）→ 6 E1 接线 → 7 D1/D3/D4」。'),
  bullet('批 0 清理（行为中性，指纹逐字节一致）：删 threatOf 别名（名实不符：名字叫威胁度、实际返回怀疑度）并把 3 处 DEV 调用点改为显式 suspOf；DEV 文案「群体威胁度共识（基准 28.6 + 公开指控增量）」→「怀疑度共识（先验 28.6 + 各 AI 私有增量均值）」；pipeline 注释口径修正。'),
  bullet('批 1a（中性）：B4 视角依赖档位能力（tiers.tierFor / magFor，tier 支持 {def, byRole, byFaction}，在 moe.write / moe.arbitrate / channels.run 三处按观察者解析）+ B2′ P 档显式映射（SCORE[\'P\'] = 10，TIER_BY_VAL 排除 P）。总表带视角注解的条目共 15 条（+3 条 cond 级），是批 6 的接线素材。'),
  bullet('批 1b（行为）：N216 视角档生效——该门禁只对验票官触发 ⇒ 解析恒为 A−（此前按总表单值 D 写，档位低估 6.6 倍）。指纹 fb1acf61…'),
  bullet('批 2（行为）：A3 带目标强承诺——Tiers.PROMISE 词表统一（此前判据要 strong、生产者只产 mid/weak ⇒ A01/A02 永久 0 命中）；真神探公开指名预告（kind=announce，承诺夜 +2 按「是否发布该目标公告」结算）；承诺者/目标出局 ⇒ 失效不判违约。**连带修复两处**：① A01/A02 方向写反（总表 note 明写「全场人类侧最强单点」= 信任信号，门禁漏标 neg ⇒ 写成 +A+ 可疑）；② uCheck 为 const，履行链 += 80 抛异常导致 72/500 局崩。按 B1 裁定移除强制履行。'),
  bullet('v31 批 0~2 验收：A01 命中 0 → **160**（方案验收达成）· 回归 54 → **64 条** · 500 局 0 异常 人类 27.0 / 异形 60.6 / 外星人 12.4 · AUC .438/.434/.508 · 证据层分叉度 0.3173 · 指纹 91e2f543… '),
  bullet('诚实记录：预告机制当前让人类 −4.7pp（300 局同种子二分：机制关闭 34.7% → 开启 30.0% → 加强制履行 27.0%）。原因是神探公开预告即暴露身份、异形优先刀他（57 次预告 56 次神探先死），而**暴露代价尚未进入发言决策的效用**。下一批正面对攻项（与 exposeRiskInc 同族）。'),
  bullet('批 3 战术库接线（本次）：`corpus/tactics.js` 的 37 条（N349~N386）此前是**纯字符串注释、全仓零引用点**——异形的全部专属手段一件没接，是台账 D1/D2 的直接根因。现改造为结构化选项池（id / risk / when / say / act / note）+ 唯一消费者入口 `Tactics.pickTactic`，由 `decide.speak()` 在非人类阵营分支消费，Claim 仍过 `filterClaims`（Z 档禁区在生成前拦截）。500 局出口 **30 条 / 5896 次**：冒领船员 N357 **344** · 外星人冒领 N382 **34** · 卖队友 N358 **27** · 牺牲队友 N359 **47** · 欺诈感染 N360 **219** · 三只分工 N372 **59** — 方案验收口径「异形出现冒领 / 卖队友 / 分工行为」达成。'),
  bullet('批 3 的方法论修正（写进条目注释）：卖队友的门禁**不能用己方怀疑度**——异形对自己队友的怀疑恒为 0（认知层知道是队友，hostile 只对其他阵营计数），用 susp 当门禁在结构上不可达（探针实测 21136 次异形发言 0 命中）。改为读【公开可见的队友处境】（被指控 ≥2 次 / 已公开暴露 / 已被揭示）后可达。'),
  bullet('裁定一（用户拍板）：**神探口头汇报 ≠ ③ 官方公告**。此前真神探在讨论里说一句「我查过 X，他是异形」就给全场写硬锁（p.known，与官方公告同权）；现改：口头汇报只按【可伪造的宣称】入账（目标侧 `locksay` 证据 + 说话者自证），**硬锁只保留给官方 ③ 公告**（steps.js 的 announce(\'③\') + revealPublic）与角色自身私有查验。同一口径同时收口船员公开分享查验结论的路径（announce.applyThreat）。读数：全场硬锁 0.9 → **0.7** 条/局 · 单人私有 0.52 → **0.59** · 证据层分叉度 0.3173 → **0.3239**（D2 方向）。'),
  bullet('裁定二（用户拍板）：**AI 加「否认」话术**。`decide.speak()` 在被指控时产出证伪型宣称（A12~A15：`deny` about=checked / infection），其独特价值是**可被观察者的私有知识当场证伪**（真查过的人才知道是谎 → pipeline 的 denyLie → A⁻）。此前 AI 生成端 `IR.mk(\'deny\')` = 0 处，全 AI 局 denyLie 必然为 0（只有玩家人工输入才产生）= A2 的根因。读数：证伪型对账 **0 → 86**（500 局）。'),
  bullet('裁定三（用户拍板「调档位」）：`Tiers.SELF_CLAIM` **删除 crewBias 特例**——原先「我是普通船员」的强度被调节两次（档位 D+ 一次、bias −10 一次），两套真源互相掩盖。现在只剩档位一个旋钮：幅度 = −round((7−5)×0.5) = **−1**（旧 −8，再经 D 档可信度缩放 0.7 后有效 −5.6 → 现 ≈ −0.7）。语义正确：空口自称船员几乎不产生减疑。'),
  bullet('v31 批 3 验收：回归 64 → **71 条**（新增 7 条：战术库结构 / N357 动作 / N400 生成前拦截 / N372 分工 / 口头汇报不写硬锁 / 口头汇报仍入账 / AI 否认）· round-trip 0 失败（断言数 94~96，随随机语料浮动）· UI 冒烟 30 局 · **500 局 0 异常** · 人类 27.2 / 异形 59.6 / 外星人 13.2 · AUC(人类) .432/.412/.477 · 指纹 **4fa952e7…**'),
  h2('1.8 文档与交接（v31 批 3 起）'),
  p('接手者的唯一入口是项目内的 **docs/交接文档_v31.md**（项目地图 / 上手 SOP / 十条红线 / 当前基线 / 常见坑 / 回滚点 / 下一批 SOP），逐批改动台账为 docs/v31执行台账.md，当前版本改动说明为 改动说明.md。'),
  bullet('v26~v29 时代的 12 份历史文档（v26 全面修复说明 / 通道接线进度与口径 / v27 交接文档与模块化解耦 / v27 与 v28 未修复点清单 / v28 修复说明与可行性审查 / AI 与推理层全面审查 / v29 方案可行性审查 / 早期对齐审查报告与改动方案）已移出 docs/，归档于 <本地>/CodeBuddy/20260910112441/_archive_docs_v26-v29/（含 改动说明 与 README 的历史全文）。'),
  bullet('本章（第 4 章）保留各版本变更的技术叙述作为演进记录；**当前状态以 docs/交接文档_v31.md §0 的基线表为准**（指纹 / 回归 / 500 局读数），避免"文档里三处数字互相打架"。'),
);

/* 2 关键机制 */
children.push(
  new Paragraph({ children: [new PageBreak()] }),
  h1('2. 关键机制速览'),
  h2('2.1 夜间步骤与决策窗口（上限值，B 类运营参数）'),
  table([
    ['步骤', '决策人', '上限(s)', '说明'],
    ['0a/0b/0c', '全体 / 被邀者 / 配对', '15/15/30', '私聊三段：发起 → 处理 → 正文'],
    ['0.5 / 0.55', '带真感染者 / 自动', '15', '感染抑制 / 感染致死（外星人可消耗夜晚免疫拦截）'],
    ['0.6 / 0.7', '异形·达标船员', '30', '进化三方向 / 转化 / 转职；预提交仅锁「是否破坏」分支'],
    ['1 / 1b', '外星人 / 外星人', '30/20', '蛰伏查验 → 【看到结果之后】再决定是否沉默（v24 规则 6.1：沉默是蛰伏专属，不是双刀附带）'],
    ['2 / 2b', '船员·神探 / 警长', '30/20', '查验（分别提交、分别结算）/ 巡逻（前 3 夜 1 次）'],
    ['3', '保镖', '15', '保护（不可连续两夜同一目标）'],
    ['4a / 4b', '工程师系 / 已选破坏者', '25/12', '维修（暴露阈值 4.0/3.0）/ 破坏（未进化 1.0~1.5、破坏进化 2.0~3.0，步长 0.1 自选）'],
    ['5 / 6', '外星人 / 警长·武装', '15/22', '击杀（觉醒后双刀，7.4 允许第二刀指同一目标）/ 开枪（悬赏独立回复）'],
    ['7 / 8', '异形 / 医生', '25', '出刀（刀数冷却）/ 感染 / 结茧；治疗·救援·自救·制药'],
    ['9 / 10 / 11', '自动 / 验票官 / 自动', '—', '死亡结算（⑥⑪⑫）/ 紧急会议 / 倒计时结算'],
  ], [1300, 2400, 1000, 4660]),
  h2('2.2 伤害、感染与暴露'),
  bullet('单次出手 = 1 点伤害；全额减免：工程师第 1 夜全能免疫、外星人夜晚免疫（伤害侧消耗 1 次当夜全额；感染侧仅 0.55 致死时消耗拦截）。'),
  bullet('单次抵免层序（伤害）：保镖保护 → 警长巡逻 → 结茧护盾；感染侧：抗体 → 保护 → 巡逻。第 2 点突破即濒死；濒死可被指定但伤害判 0、额度照扣。'),
  bullet('暴露：维修 4.0/3.0、破坏 6.0 随批次全场公告；净破坏 3.0/6.0/9.0 三档停摆；停转夜由外星人破坏引发、次夜维修无效。'),
  bullet('胜负：人类=清场或倒计时归零；异形=人类全灭且外星人已灭（寂灭）；外星人=残局独存或决斗僵持满 3 夜后第 4 夜判定；第 999 夜平局优先级最高。'),
  h2('2.3 证据分与 AI 管线'),
  p('记事本(事实) → 推理链 R1~R41 → E 三通道证据分 E(i,j,f) ∈ {human, alien, king}（只增不减，负值事件写反向通道；硬源 override；并罚单元 = 独立信息源事件，同源取最强、多源公比 0.5）→ 怀疑度三阵营分布 S(p_human, p_alien, p_king) 与独立危险度 Dg（能力项 + 敌对度 + 活跃度，与 S 解耦）→ 效用函数 → ε-greedy。先验：人类敌对度 28.6% / 外星人 p_alien 21.4% / 异形对非队友 50%；宣称类证据每夜 ×0.85、公开事实不衰减；D 档增量按可信度 C（0.4+0.6C）缩放；硬源（⑥⑩揭示 / ④⑤暴露 / 查验锁定 / 真神探公告）直接锁定通道；R30/R7 硬源置位。发言经 Bridge.say() 统一管道解析为 Claim IR 入台账；死亡与驱逐揭示触发 R17/R17b/R29/R30 追责闭环。'),
  h2('2.4 v26 对证据链的改动（数值语义）'),
  bullet('R38 职业自证的替代口径：原实现读宣称者【真相阵营】（与已修复的 actF 同类透视），现改为【对称弱背书】——职业宣称对全体观察者一视同仁记为减疑，可被对跳 R12 / 暴露 ④⑤ / 兑现 E7 / 对证链推翻。同种子 300 局 A/B：对称弱背书人类 33.0% / 弱可疑 19.0% / 全额可疑 14.3%。'),
  bullet('宣称类的目标侧入账：lock 类查验汇报（faction 明确时）按 lockEnemy B− / lockHuman C− 记在目标头上，kind=claim 可衰减；此前只给说话者记「自证」，观察者对「X 是异形」零反应（IR.meta.band/evidence 恒为 null）。'),
  bullet('证伪型宣称落地：deny「我没被查验」由观察者自己的查验池/双查记录做对账 → denyLie A−；弃票声明落 declaredAbstain 供 N182/D03 对账。'),
  bullet('指控档位三层计价：自有（check/crewcheck）与公开黑板（⑤④conflict）才升档，单靠转述只到 C；措辞强度（hard/med/soft）接入（soft 降一档）；假设句按 soft 处理。'),
  bullet('承诺兑现判据改用【承诺者本人投票】（旧实现用「目标是否被任何人投」→ C 表奖励/惩罚近似随机）。'),
  bullet('普适层饱和化：偏移由 Σ 经饱和曲线映射到 ±25（×DG_W.uni 0.15 → ±3.75 危险度），使接线规模与群体基线强度解耦（线性累加会在数夜内顶到 clamp 上限）。'),
  bullet('硬源校验修正：knownLockOf 的阵营合法性改用 {human, alien, xeno} 白名单（旧实现拿职业→阵营表兼任校验，导致「已确认为人类」永远锁不住）；引擎侧医生记忆 markEverSeen、攻击反馈 attackLog 落盘（私有源）。'),
  h2('2.5 v28 对证据链的改动（数值语义）'),
  bullet('R38 自证族档位化：档位字典从函数体移入 tiers.js 的 RULE 表（R38crew = D+ / R38divine = A− / R38medic = B+ / R38support = B+ / R38guard = B）。crew 的减疑幅度 −15 → −8（对齐 D+ 附近）——「我是普通船员」原先是成本最低、最无法验证、却收益最大的一类宣称。'),
  bullet('空口宣称可被对证击穿：对证链不再豁免 claimedRole === \'crew\'。观察者只要持有与该宣称冲突的私有硬源（④⑤暴露 / ⑥⑩揭示 / 查验锁定 / 真神探公告），即按 Tiers.RULE.cross（A−，证伪型）击穿；幂等键为每人每目标每局一次。'),
  bullet('doc → bio 口径统一：语言层历史别名 doc 在 pipeline 入账前归一为 bio，推理层 R38 / R12 / R13 / R30 / capability / 医生存活估算全部改用 bio/rescue/tempdoc 三键；R30 假冒判定改为「医生系家族内互换不算撒谎」。'),
  bullet('K1 沉默指纹：Tiers.RULE.kingSilent = C（提档），触发面 = actF(g,t) === 0（含承诺与维修暴露），频次每 3 夜一次，排除本夜被蛰伏沉默压制者。它是 D1 归因链中「让沉默付代价」的唯一对口机制。'),
  h2('2.6 v28b 对证据链与决策的改动（B 类裁定）'),
  bullet('B2 调用值统一：怀疑度/危险度的全部结构性常量上移到 js/infer/tiers.js（PRIOR / PRIOR_E / DG_W / CAP / UNIVERSAL / SUSP_RANGE / CONSENSUS / FLOOR / SELF_CLAIM），另有 9 条原字面档位串入 RULE 表（checkLie / settleHit / settleMiss / grudge / grudgeSoft / rescueBack / privSame / expClaim / mateHeat）。属行为中性重构（指纹逐字节一致），目的是消灭「改一处要全仓搜常量」。'),
  bullet('B3 新增最弱档 D--（=1）：用于「方向明确但贝叶斯极弱」的信号。标定依据——E 先验为 human 7.14 / alien 2.14 / king 0.71，D−(3) 会让 p_alien 抬升 12~18pp（远超总表实测 +4.7pt），D-- 经 D 档可信度缩放 (0.4+0.6C) 后实际 +5.1pp。已登记 RANK（低于 D−、高于 F），仲裁可正确排序。'),
  bullet('排除信息双路接线（方向 = 贝叶斯：排除人类专属职业 ⇒ 目标轻微更不像人类）：① 私有——船员首次查验的排除结果写入本人敌方通道（steps.js，kind=fact 不衰减，仅人类观察者，避免异形视角语义反转）；② 公开——排除类宣称对全体观察者写目标侧弱证据（pipeline.js，kind=claim 可衰减，仅当排除项全为人类职业）。500 局：私有 4249 条 · 公开 1914 条（此前均为 0）。'),
  bullet('B1 破坏效用扩项（不加硬推）：uDestroy = 倒计时压力×100 + 未触发档位价值 gain×0.25（原死变量归位）− 暴露风险×(θ/50) − AI 已知的对手维修能力 repairKnown×8 + 性格项 + 队友协同×4。新增 knownRepairers() 只读合法信息（④ 暴露 / known 台账 / 高可信职业宣称）。500 局：⑤ 公告 15.0% → 38.0%，停摆 3.0 6 → 67 局 / 6.0 0 → 8 局 / 9.0 0 → 1 局。'),
  h2('2.7 v28c 对破坏决策的修正（B6 仪器先于标定）'),
  bullet('修复「协同项与队内节流是死代码」：旧写法读 x.branch，而 p.branch 要到 0.7 步骤的 run()（steps.js:348）才写入——决策阶段恒为 null。改为读决策期真实可读的队内信号：本局已实际破坏过的存活队友数（x.alien.destroyTotal10 > 0，异形自有信息、不涉透视）。'),
  bullet('修复「节流与协同奖励方向互斥」：节流配额由「按 countdown 取 1/2/3」改为「存活异形数 − quotaSlack(=1)」，只在几乎全队都在破坏时收手；协同奖励保持 mates × 4（封顶 2）。首版二者抵消后净效果是「队友破坏过 ⇒ 我更不破坏」，与设计意图相反。'),
  bullet('四路信号全部入表：Tiers.SAB = { satK, satJitter, gainW, resistPer, matesW, riskThetaDiv, noise, quotaTail, quotaSlack }，可被环境变量 SK_SAB 覆盖做同种子 A/B（与 v26 的 R38 A/B 同口径）。'),
);

/* 3 蒙特卡洛 */
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('3. 蒙特卡洛模拟（AI 模块独立运行实测）'));
children.push(p('工具 tools/mc.cjs 在 Node 沙盒（vm）中按 tools/load-order.cjs 的清单加载纯逻辑栈共 24 个文件（rng / data / state / nlp / lang/ir / lang/renderer / infer/speakable / infer/tiers / infer/registry / infer/moe / infer/channels.run / corpus/tactics / corpus/channels.data / corpus/channels / infer/pipeline / infer/visible / ai/util / ai/belief / ai/perceive / ai/decide / ai / engine/announce / engine/steps / engine，无任何 DOM 依赖）即可驱动完整对局——结合层必须在场，否则 Bridge 缺席会使 Claim 路由全失效。这验证了 AI 运行模块与 UI 层的割裂性。以下为一次 500 局模拟的实测结果（每局随机种子复现确定性对局）。'));
if (MC) {
  children.push(h2('3.1 运行环境'));
  children.push(table([
    ['项目', '值'],
    ['对局数', `${MC.done} / ${MC.N}（种子 ${MC.seed0} ~ ${MC.seedEnd}）`],
    ['耗时', (MC.elapsedMs / 1000).toFixed(1) + ' 秒'],
    ['运行异常', String(MC.errs.length)],
    ['全部 AI', '是（g.humans = []，真人席位 0）'],
  ], [2600, 6760]));
  children.push(h2('3.2 胜负与阶段分布'));
  children.push(table([
    ['维度', '分布'],
    ['胜负', `人类 ${pct(MC.wins.human)} | 异形 ${pct(MC.wins.alien)} | 外星人 ${pct(MC.wins.xeno)} | 平局 ${pct(MC.wins.draw || 0)}`],
    ['终局阶段', `常规 ${pct(MC.phases['常规'])} | 寂灭 ${pct(MC.phases['寂灭'])} | 决斗 ${pct(MC.phases['决斗'])}`],
    ['平均夜数', String(MC.avgNights)],
    ['场均驱逐 / 夜死', `${MC.avgEvictions} / ${MC.avgDeaths}`],
    ['场均查验', MC.avgChecks + ' 人次'],
    ['死因分布', Object.keys(MC.outByCause).map(k => `${k === 'vote' ? '驱逐' : k} ${MC.outByCause[k]}`).join(' · ')],
    ...(MC.sabGames != null ? [['破坏 / 停摆', `出现 ⑤ 破坏公告 ${MC.sabGames}/${MC.done} 局（${(100 * MC.sabGames / MC.done).toFixed(1)}%）· ⑤ 共 ${MC.sab5Total} 条 · 停摆 3.0: ${MC.tiersHit[3]} 局 / 6.0: ${MC.tiersHit[6]} 局 / 9.0: ${MC.tiersHit[9]} 局`]] : []),
  ], [2600, 6760]));
  const nights = Object.keys(MC.nightHist || {}).map(Number).sort((a, b) => a - b);
  if (nights.length) {
    children.push(h2('3.3 夜数分布'));
    children.push(table(
      [['夜数', ...nights.map(n => n + '')], ['局数', ...nights.map(n => MC.nightHist[n] + '')]],
      [1200, ...(nights.map(() => Math.floor(8160 / nights.length)))].slice(0, nights.length + 1),
    ));
  }
} else {
  children.push(p('（未找到 mc_result.json——请先运行 node tools/mc.cjs 500 1 生成模拟结果后重新导出本文档。）'));
}

/* 3.4 指标体系（v26：只观测不设靶） */
if (MC && MC.metrics) {
  const A = MC.metrics.A_接入度, B = MC.metrics.B_仲裁, C = MC.metrics.C_影子, D = MC.metrics.D_证据结构;
  children.push(h2('3.4 指标体系（v26，只观测不设靶）'));
  children.push(table([
    ['组', '指标', '读数'],
    ['A 接入度', 'chan_wired / chan_total', `${A.chan_wired} / ${A.chan_total}`],
    ['', 'chan_fired（实际触发过的通道）', `${A.chan_fired.length} 条：${A.chan_fired.join(' ') || '—'}`],
    ['', '通道分叉度（私有 / 全部通道 src）', `${A.chan_src_private} / ${A.chan_src_total} = ${A.chan_divergence}`],
    ['', '证据层分叉度（单一观察者持有 / 全部 src）', `${A.src_private} / ${A.src_total} = ${A.evidence_divergence}`],
    ['', 'expert_active', `${A.expert_active.length} / 13：${A.expert_active.join(' ')}`],
    ...(B ? [['B 仲裁', '输入 / 多 Claim 率 / 三档', `${B.arb_input_total} · ${B.arb_multi_rate} · 同档 ${B.arb_tier['同档保留分歧']} / 差一档 ${B.arb_tier['差一档降权']} / 差两档 ${B.arb_tier['差两档待验证']}`]] : []),
    ...(C ? [['C 影子', 'calls / 采纳率', `${C.shadow_calls} · ${C.shadow_hit_rate}`]] : []),
    ...(C && C.shadow_dist ? [['', '影子返回值分布（v28，n / 非零 / min / p50 / p90 / max）',
      `${C.shadow_dist.n} / ${C.shadow_dist.nonzero} / ${C.shadow_dist.min} / ${C.shadow_dist.p50} / ${C.shadow_dist.p90} / ${C.shadow_dist.max}`]] : []),
    ...(MC.metrics.C1_硬源 ? [['C1 硬源（v28 修正口径）', '硬源锁定条/局（中位）· 单人私有 / 小组 / 全场',
      `${MC.metrics.C1_硬源.lock_pairs_per_game}（中位 ${MC.metrics.C1_硬源.lock_pairs_median}）· ${MC.metrics.C1_硬源.solo_per_game} / ${MC.metrics.C1_硬源.group_per_game} / ${MC.metrics.C1_硬源.global_per_game}`]] : []),
    ...(A.gate_eval_hit ? [['', '接线求值 / 命中（v28 新增）',
      `${A.gate_eval_hit.reduce((s, x) => s + x.eval, 0)} / ${A.gate_eval_hit.reduce((s, x) => s + x.fired, 0)}` + (A.gate_never_fired && A.gate_never_fired.length ? ` · 求值>0 而 0 命中 ${A.gate_never_fired.length} 条：${A.gate_never_fired.join(' ')}` : '')]] : []),
    ['D 证据结构', 'expert_marked / fold_rate', `${D.expert_marked} · ${D.fold_rate}`],
    ['', 'src 构成（硬源 : 宣称 : 普适层）', `${D.src_kind.fact} : ${D.src_kind.claim} : ${D.src_kind.universal}`],
    ['', '宣称侧（v26）', `目标侧查验汇报 ${D.say_side.locksay} · 证伪对账 ${D.say_side.denyLie} · 承诺违约 ${D.say_side.promiseMiss} · Z 档拦截 ${D.z_filtered}`],
    ...(D.say_side.crewExclude != null ? [['', '排除类证据（v28b / B3+D2）',
      `私有（船员查验）${D.say_side.crewExclude} · 公开（排除宣称）${D.say_side.excludesay || 0}`]] : []),
  ], [1400, 3200, 4760]));
  if (MC.aucByFaction) {
    const f = MC.aucByFaction;
    children.push(table([
      ['AUC（分阵营视角）', '开局', '中期', '残局'],
      ['人类观察者（pos=异形+外星人 / neg=人类）', String(f.human['开局']), String(f.human['中期']), String(f.human['残局'])],
      ['异形观察者（pos=人类 / neg=外星人）', String(f.alien['开局']), String(f.alien['中期']), String(f.alien['残局'])],
      ['外星人观察者（pos=异形 / neg=人类）', String(f.xeno['开局']), String(f.xeno['中期']), String(f.xeno['残局'])],
    ], [3960, 1800, 1800, 1800]));
    children.push(p('0.5 = 瞎猜，1.0 = 透视。队友是硬信息（异形知队友），故一律排除在 pos/neg 之外——否则 AUC 恒为 1。', { size: 18, color: '555F6E' }));
  }
  if (MC.metrics.E_结局 && MC.metrics.E_结局.defeat_mode) {
    children.push(h2('3.5 败法分布（死因 × 阶段）'));
    const dm = MC.metrics.E_结局.defeat_mode;
    const keys = Object.keys(dm).sort((a, b) => dm[b] - dm[a]);
    children.push(table(
      [['败法', ...keys], ['局数', ...keys.map(k => String(dm[k]))]],
      [1200, ...(keys.map(() => Math.floor(8160 / keys.length)))].slice(0, keys.length + 1),
    ));
  }
}

/* 3.6 通道接线进度（v26：从源码推导） */
children.push(h2('3.6 通道接线进度与红线（v26 阶段②）'));
children.push(p(`已接线 ${WIRED.mounted.length} / ${Object.keys(CH_TABLE).length} 条（可执行集合 = 总表 506 − 未接线 P 档 41 − Z 档 26 − F 档 16 = 423；` +
  '★ v31 批 3.5 起 **P 档不再是「全部不接线」** —— N403~N407 五条私有源以 `impl.tier` 声明强度档接线，`SCORE[\'P\']` 仍不参与数值反查）。' +
  '执行器五条红线：① 编号必须存在于总表（否则永不执行，旧实现有 5 条死编号却被计入进度）；② 量纲统一为真值（旧破坏量通道拿 ×10 的值与 1.0/1.5 比较，物理不可达）；' +
  '③ 档位必须是数值档（Z/F 是零值语义标记，接线只会写 0 分证据；P 需配 impl.tier 才接线）；④ 幂等键必须带观察者（旧键每夜只放行一次 → 证据只落给座位序最前的 AI，普适层同理，等于「接线了也不可能分叉」）；⑤ 方向用 neg 表达，幅度永远取总表档位。'));
children.push(table([
  ['专家', '已接线通道'],
  ...Object.keys(SCORE_BY_EXPERT()).sort().map(e => [e, SCORE_BY_EXPERT()[e].join(' ')]),
  ['（未挂载）', WIRED.unmounted.length ? WIRED.unmounted.join(' ') : '无'],
], [1200, 8160]));
children.push(p('逐条分诊（E3 票型 50 条 → 只有 6 条是可接线的个体证据）与下一批候选见 docs/通道接线进度与口径_v26.md。', { size: 18, color: '555F6E' }));

children.push(h2('3.7 模拟器源码'));
pushCode(children, 'tools/mc.cjs', G.mc[0]);

/* 4 v26 更新摘要 */
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('4. v26 更新摘要（缺陷修复 + 阶段②通道接线）'));
children.push(h2('4.1 P0：主闭环的三处断点'));
children.push(table([
  ['缺陷', '病灶', '修复'],
  ['推理链空心化', 'Bridge.absorb 里只有 accuse/quote 会对目标入账；lock/exclusion/deny 只产生说话者自证 → 观察者对「X 是异形 / X 是好人」零反应，IR.meta.band/evidence 恒为 null',
   '补目标侧入账（lockEnemy B− / lockHuman C−，主体=说话者、可衰减）；deny 用观察者私有查验池对账（denyLie A−）；exclusion 方向待裁定，暂只入台账'],
  ['硬源锁定对「人类」失效', 'knownLockOf 拿「职业→阵营」表兼任阵营合法性校验，而该表没有 human 键 → {faction:human, role:null} 恒判非法（船员双查锁定／公开金水／神探口头金水三条链路全部锁不住）',
   '改用 {human, alien, xeno} 白名单校验（1 行）'],
  ['玩家与 AI 不对等', '文本路径永远产不出 payload.faction；nlp 的汇报分支还会 return 掉同句指控（「我查过 7 号，能确定他是异形」整句被吞）；round-trip 只比 kind+targets，字段丢失也通过',
   'nlp 补阵营词表（含否定式）＋汇报与指控不再互斥；ir 透传 faction；test-lang 升级为 payload 深比较（升级后立即抓出两处问题）'],
], [1500, 4400, 3460]));
children.push(h2('4.2 P1 / P2 修复要点'));
children.push(bullet('透视漏网 4 处：R38（观察者读宣称者真相阵营）· onPrivate · onPrivateShare · 船员双查目标池（按真相阵营排除异形 → 船员永远查不到异形）。'));
children.push(bullet('adjudicate 档位去目标属性化（旧实现里 4/6 个源与说话者无关 → 任何人第二次指控同一目标都自动升档）；措辞 tier 接入。'));
children.push(bullet('K2 护队指纹判据写反（保留的是「揭露后才指控已暴露敌人」这种最正常行为）→ 改为「反咬揭示前的揭发者」。'));
children.push(bullet('死机制：sabTau 从未赋值（恒 +15 偏置）→ 逐人 roll；反拖延疲劳在常规局面被绕过 → 统一 uCocoon；state.js 删 sus/pBase/tau/tauGrudge；engine 删 claimConflicts 死写入。'));
children.push(bullet('证据层：onClaim 幂等 + 并罚源去夜次、R40 按指控当夜票型对账、私聊按可信度缩放、meta.speaker 传入解析器、仲裁器 tiedClaims 接入发言。'));
children.push(h2('4.3 R38 替代口径的同种子 A/B（300 局，其余代码完全相同）'));
children.push(table([
  ['口径', '人类', '异形', '外星人', '说明'],
  ['对称弱背书（采用）', '33.0%', '53.0%', '14.0%', '保留自证语义、不读真相、不给说谎者额外收益'],
  ['全体弱可疑（D+）', '19.0%', '73.7%', '7.3%', '神探公布查杀等于自证有罪，语义失真'],
  ['全体全额可疑（+档）', '14.3%', '80.3%', '5.3%', '真神探公开身份反被全员 +33 怀疑，方向错误'],
], [2200, 1100, 1100, 1100, 3860]));
children.push(h2('4.4 阶段②通道接线（两批）'));
children.push(table([
  ['批次', '内容', '结果'],
  ['第一批', '执行器三处致命缺陷：幂等键补观察者维度 · 编号挂载校验（5 条死编号）· 破坏量量纲统一；新增 E1 分解类与条件于 s 共 12 条；E11 私有源 3 条（N306 结茧指纹 / N318 转职探测 / D03 弃票对账）——**v31 批 3.5 再增 E11 三条（N403/N404/N405 抵挡层收敛）**',
   'chan_wired 14（含 5 条死的）→ 26；chan_fired 5 → 12；证据层分叉度首次可测（0.296）'],
  ['第二批', 'E2 感染医生私有 3 条（N139 标记隐形消失 ⇒ 持有人非人类 / N141 逾期+消失 ⇒ 确证异形 / N149 逾期未死 ⇒ 假标记 ⇒ 异形）+ E3 三条（N188 验票官死后冒称者必假 / N182 弃票宣称对账 / N216 票型宣称对账）；引擎侧补 p.markEverSeen（医生记忆）与 g.lastCureHands；E3 50 条完成分诊（只有 6 条可接线）',
   'chan_wired → 32/499；chan_fired → 16；expert_active 9/13（E2 激活）'],
], [900, 5600, 2860]));
children.push(h2('4.5 工具链与仪器'));
children.push(bullet('tools/test-fix-v26.cjs（v26 新增 29 条断言 → 现 **100 条**）：每条对应一处缺陷——硬源锁定／透视／宣称目标侧证据／档位三层计价／承诺兑现／K2 判据／执行器幂等与量纲／通道挂载／医生与验票官私有通道／战术库结构（批 3）／保护侧 7 条通道与 N417 下界（批 3.5）。'));
children.push(bullet('tools/mc.cjs：新增 chan_unmounted、chan_fires、通道分叉度、证据层分叉度、分阵营 AUC、宣称侧计数；补印 defeat_mode / nightHist / avgRepair。'));
children.push(bullet('tools/verify-heat.js：自 v22 起因加载列表缺 tiers.js 而一运行就崩，已修；读数改「投票前共识榜名次」——被驱逐者中 43.1% 为第 1 名、73.8% 前三（随机基线约 14%/43%），此前「被驱逐者热度更低」是幸存者偏差 + 快照时点双重伪影。'));
children.push(bullet('package.json 补齐 scripts（README 里写的 npm start / npm run sim 此前并不存在），新增 npm run test:all。'));
children.push(h2('4.6 待裁定（v26 遗留）'));
children.push(bullet('P 档 41 条的强度：P 是「私有源」标记而非强度档（SCORE 无 P），而这批正是私有源最丰富的家族；三条已由 Tiers.RULE（R28/R40/R27 = B−）内联覆盖，说明强度有记但记在 R 规则表，建议给 P 显式映射。→ **【已结案】** v31 批 1 给出 SCORE[\'P\']=10 + TIER_BY_VAL 排除 P；v31 批 3.5 更进一步：私有源不再需要「把 P 当强度档」——表内 tier 写 \'P\'（语义标记）+ 门禁 impl.tier 声明真实强度档（N403~N407 即此制）。'));
children.push(bullet('exclusion（排除职业）目标侧方向：贝叶斯上轻微指向非人类，与「查验清人」的语用相反，暂只入台账。→ **【v28b 已落地】** 方向 (a) + 专用最弱档 D--(1)。'));
children.push(bullet('视角依赖型档位（N216 对全场 D / 对验票官 A−；A12/D12 同构）：现按总表档位实现，等 per-observer tier 能力落地后再改。→ **【v31 批 1 已落地】** tiers.tierFor/magFor 支持 {def, byRole, byFaction}，N216 已按注解生效（对验票官 A−）；总表另有 15 条视角注解随批 6 逐条接线。'));
children.push(bullet('★ 影子层采纳率 0 —— v27 更正：先前记为「量级失配、属阶段⑤标定问题」是误判。实测（120 局）1536 次调用返回值 min=p50=max=0，根因是字段名不匹配：moe.js 的守卫读 claim.target，而 lang/ir.js 的 IR.mk 产出的是 targets[]。属死代码，放大任何量级都无效；修法为 1 行（claim.target ?? targets[0]），修后探针增量 ≈ +0.295。**v28 已按此修复（含 tEvents 槽位补全）：500 局 calls 3487 · 采纳率 3.07% · max 0.2946。**'));
children.push(h2('4.7 v28 更新摘要（交接落地四批）'));
children.push(table([
  ['批次', '内容', '验收读数'],
  ['A1 影子层字段名', 'moe.js shadowRisk 目标解析走 claim.target ?? targets[0]，并确保 tEvents 存在该 target 槽位',
   'calls 3487 · 采纳率 0 → 3.07% · 分布 p50 −0.0120 / p90 0.0168 / max 0.2946'],
  ['C1 / C3 仪器三件套', '硬源三分类（按 knownLockOf 直读 p.known）· 影子返回值分布 · 每 gate 求值/命中计数',
   '硬源 2.22 条/局（私有 0.53 / 小组 0.79 / 全场 0.89）· 求值 880,448 / 命中 29,503 · 17 条 0 命中'],
  ['A6 + A5 语义与约束', 'R38 族入 RULE 表 + R38crew B→D+ · crew 不再豁免对证 · doc→bio 收口 · K1 提档至 C 并收紧（actF===0 / 3 夜 / 排除被沉默者）',
   '回归 29 → 40 条 · 证据层分叉度 0.290 → 0.307 · 通道分叉度 0.333 → 0.400'],
  ['D2 / A4 评估', 'D2 私有硬源诊断（含 B3 量级警告 +12~18pp ≫ 文档实测 +4.7pt）· A4 结论「不建议放开跨专家分组」',
   '只出结论，不改数值'],
], [1800, 4400, 3160]));
children.push(p('500 局联合复测（种子 1~500，0 异常）：人类 31.2% / 异形 57.8% / 外星人 11.0% · 平均 6.90 夜 · 停摆 3.0 6 局 / 6.0 0 局 / 9.0 0 局 · AUC（人类）0.440 / 0.431 / 0.484。' +
  '行为指纹新基线 9a600934…（v27 的 9ee5c4ae… 因有意的行为改动作废，存档 _baseline_fingerprint_200_v28.json）。', { size: 18, color: '555F6E' }));
children.push(h2('4.8 v28b 更新摘要（B 类裁定落地）'));
children.push(table([
  ['裁定', '内容', '验收读数'],
  ['B1 破坏路径', '「让 AI 根据推理库和引擎实时选择，不做强制要求」→ 破坏效用扩为四项实时评估（倒计时压力 + 未触发档位价值 gain 归位 − 暴露风险 − AI 已知的对手维修能力 repairKnown×8 + 协同），不设阈值不给保底',
   '⑤ 公告 15.0% → 38.0% · 停摆 3.0 6 → 67 局 / 6.0 0 → 8 局 / 9.0 0 → 1 局'],
  ['B2 调用值统一', '「把所有怀疑度和危险度的调用值统一到 score」→ Tiers 常量表（9 组）+ 9 条字面档位串入 RULE；行为中性',
   '指纹逐字节一致（9a600934…）· 回归 40/40'],
  ['B3 exclusion', '方向 (a) 贝叶斯 + 专用最弱档 D--(1)（D− 会 +12~18pp，D-- 实际 +5.1pp）；私有（船员查验）+ 公开（排除宣称）双路接线',
   '排除类证据 0 → 私有 4249 / 公开 1914 条（500 局）· 证据层分叉度 0.307 → 0.315'],
], [1600, 4600, 3160]));
children.push(p('v28b 联合复测（500 局，0 异常）：人类 32.8% / 异形 56.0% / 外星人 11.2% · 平均 6.94 夜 · chan_fired 20 · AUC（人类）0.440 / 0.432 / 0.494 · 回归 51/51 · 行为指纹 120d2cdc…（存档 _baseline_fingerprint_200_v28b.json）。', { size: 18, color: '555F6E' }));
children.push(h2('4.9 v28c 更新摘要（B6 / B7 标定——仪器抓出两个真 bug）'));
children.push(p('口径不变：不设靶（不给破坏发生率定目标、不按胜率挑系数），只回答「方向对不对」与「系数是否可标定」。', { size: 18, color: '555F6E' }));
children.push(table([
  ['项', '内容', '读数'],
  ['B6 仪器发现的死代码（#1）', '协同项与队内节流读 x.branch，而 p.branch 要到 0.7 步骤的 run()（steps.js:348）才写入 → 决策阶段恒 null，60 局实测 mates 恒 0',
   '改读 alien.destroyTotal10 > 0（决策期可读）；修复后「已破坏队友数 1」组 go 率 9.1% vs 基线 2.8%'],
  ['B6 仪器发现的方向互斥（#2）', '节流配额按 countdown 取 1/2/3，与协同奖励 mates×4 抵消 → 净效果「队友破坏过 ⇒ 我更不破坏」（0% vs 3.2%）',
   '配额改「存活异形数 − 1」，只在几乎全队都在破坏时收手'],
  ['B6 仪器自身的退化（#3）', '固定阈值分档在实战里退化成单桶（pressure 恒 ≤0.4；gapT 多为 3.0）→ 读数零信息',
   '改三分位自适应分档 + 均值对照（go 组 vs 全样本）'],
  ['B6 系数 A/B（300 局同种子）', '默认 0.25/8 → ⑤ 39.3%·停摆 36/3/1·方向全对；弱收益强阻力 0.15/12 → 23.0%；强收益弱阻力 0.40/4 → 70.7% 但「维修者数」方向反转',
   '采用默认：理由不是胜率（C 的人类胜率反而更高），而是 C 破坏了「维修者多 ⇒ 少破坏」的理性；gainW/resistPer 是总开关（±60% → 23%~71%）'],
  ['B7 SHADOW_FACTOR A/B（300 局同种子）', 'SF 0.2 / 0.5 / 0.8 → 采纳率 1.05% / 3.12% / 5.97%；SF 上调明显利好异形（53.3% → 57.3%）',
   '保留 0.5，语义定为「听众折扣（按半价采信）」；标定对象已是活函数'],
], [2300, 4400, 2660]));
children.push(p('v28c 验收：回归 54/54 · round-trip 94/0 · UI 冒烟 30 局 · 500 局人类 32.8% / 异形 56.0% / 外星人 11.2% · ⑤ 38.0% · 停摆 65/6/1 · 行为指纹 4a5fb176…（存档 _baseline_fingerprint_200_v28c.json）。', { size: 18, color: '555F6E' }));
children.push(h2('4.10 v31 更新摘要（三合一方案 批 0~2）'));
children.push(table([
  ['批', '内容', '验收 / 读数'],
  ['0 清理', '删 threatOf 别名（3 处 DEV 调用点改 suspOf）· DEV 文案改「怀疑度共识」· pipeline 注释口径修正', '行为中性：指纹逐字节一致（4a5fb176…）'],
  ['1a B4+B2′', 'tierFor/magFor 视角依赖档位能力（在 write / arbitrate / channels.run 三处生效）· SCORE[\'P\']=10 + TIER_BY_VAL 排除 P', '行为中性：指纹不变 · 新增 5 条断言 · 总表视角注解 15 条已普查'],
  ['1b N216', '视角档真正生效：该门禁只对验票官触发 ⇒ 恒 A−（此前按单值 D 写，低估 6.6 倍）', '指纹 fb1acf61… · AUC 残局 0.494 → 0.498'],
  ['2 A3', 'Tiers.PROMISE 词表统一 · 真神探指名预告（kind=announce，承诺夜 +2 按公告判兑现）· 承诺者/目标出局 ⇒ 失效不判违约 · 连带修 A01/A02 方向（漏 neg ⇒ +A+ 写成可疑）与 uCheck const 崩溃（72/500 局）',
   '**A01 命中 0 → 160** · 回归 64/64 · 500 局人类 27.0 / 异形 60.6 / 外星人 12.4 · 指纹 91e2f543…'],
], [1300, 4600, 2260]));
children.push(p('诚实记录：预告机制当前让人类 −4.7pp（300 局同种子：机制关闭 34.7% → 开启 30.0% → 加强制履行 27.0%）。神探公开预告即暴露身份、异形优先刀他（57 次预告 56 次神探先死），而暴露代价尚未进入发言决策的效用 —— 列为下一批正面对攻项（与 exposeRiskInc 同族）。方案附录 B 已预告「接推理库不能改善平衡」，本批只是把 A01 点亮。', { size: 18, color: '555F6E' }));
children.push(h2('4.11 v31 批 3 + 三项裁定 更新摘要'));
children.push(table([
  ['项', '内容', '验收 / 读数'],
  ['批 3 战术库接线', 'corpus/tactics.js 的 37 条（N349~N386）从纯字符串注释 → 结构化选项池（id/risk/when/say/act/note）+ 唯一消费者 Tactics.pickTactic（decide.speak 非人类分支）· Claim 仍过 filterClaims（Z 档生成前拦截）· mc 新增每条目出口计数',
   '出口 **30 条 / 5896 次**：N357 冒领 344 · N382 外星人冒领 34 · N358 卖队友 27 · N359 牺牲队友 47 · N360 欺诈感染 219 · N372 三只分工 59（验收口径达成）'],
  ['批 3 方法论修正', '卖队友/牺牲队友的门禁读【公开可见的队友处境】而非己方怀疑度——异形对自己队友的怀疑恒为 0（认知层知道是队友），用 susp 当门禁结构上不可达（探针：21136 次异形发言 0 命中）',
   'N358/N359 由恒 0 → 27 / 47 次'],
  ['裁定一：口头汇报 ≠ ③ 公告', '神探/船员的口头查验汇报不再写全场硬锁（p.known），只按可伪造的宣称入账（目标侧 locksay + 说话者自证）；硬锁只留给官方 ③ 公告（announce(\'③\') + revealPublic）与角色私有查验',
   '全场硬锁 0.9 → **0.7** 条/局 · 单人私有 0.52 → **0.59** · 证据层分叉度 0.3173 → **0.3239**'],
  ['裁定二：AI 加「否认」', 'decide.speak 在被指控时产证伪型宣称（deny about=checked/infection）——可被观察者私有知识当场证伪（denyLie → A⁻）。此前生成端 0 处 ⇒ 全 AI 局恒 0（A2 根因）',
   '证伪型对账 **0 → 86**（500 局）'],
  ['裁定三：自证调档位', 'Tiers.SELF_CLAIM 删除 crewBias 特例（旧实现 crew 强度被调两次：档位 D+ 与 bias −10，两套真源互相掩盖）；只剩档位一个旋钮',
   'crew 自证幅度 −8 → **−1**（有效 −5.6 → −0.7）· 回归断言随之更新'],
], [1500, 4500, 2160]));
children.push(p('v31 批 3 验收：回归 **71/71** · round-trip 0 失败 · UI 冒烟 30 局 · 500 局 **0 异常** · 人类 27.2% / 异形 59.6% / 外星人 13.2% · AUC(人类) .432/.412/.477 · 证据层分叉度 0.3239 · 行为指纹 **4fa952e7…**（存档 _baseline_fingerprint_200_v31b3.json）。', { size: 18, color: '555F6E' }));

children.push(h2('4.12 v31 批 3.5 人类侧保护专项（N401~N407 ＋ N414~N417）'));
children.push(p('依据《太空杀·人类侧保护专项（增补第二十二章）》。**本批是保护侧首轮开垦**——总表 v20 的 402 条几乎全是「识破知识」（这个人可不可疑），浑水摸鱼 v21 的 65 条是「异形与外星人有什么话可以说」；而**保镖保护谁 / 警长巡逻谁 / 医生先治谁，此前无人管**：guard / patrol / doctor 三个分支的目标选择只有通用 dangerOf，没有任何保护侧优先级。'));
children.push(p('保护侧的根本限制（铜水问题）：被保护者全盲——保护与抵挡**不产生目标感知、也不产生公告** ⇒ 保护侧**不可能出现 A 档**（既有 B05 保镖受袭感知已定为 D+）。因此 7 条通道全部从两处开采：① 抵挡层失效时泄露的目标状态信息；② 保护行为本身的时序与轮换构成的指纹。'));
children.push(table([
  ['编号', '强度', '落地形态'],
  ['N401', 'C+', '④ 暴露 ⇒ 必为工程师系且必为人类。④ 暴露**已是硬源**（revealPublic 写全场 known），本条增量在定案 1 的落地缺口：④ 公告此前不标原职业（⑥⑩ 早已标），补上后「职业：助理工程师；原职业：普通船员」即向全场泄露「转职已发生 ⇒ 存活≤6 或已过第 6 夜」'],
  ['N402', 'C+', '巡逻一次性（全局 1 次、限前 3 夜）。**不单独入账**——不指向个体、方向中性，写给普适层只会是噪声；以公共前提 MoE.patrolSpentPublic(g) 交付，供 N403~N405 的排除链消费'],
  ['N403', 'C+', '第 4 夜起单次被挡 ⇒ 层收敛（巡逻层永久消失）⇒ 抵挡只能来自 {保镖(人类)、护盾(非人类)、免疫(非人类)} ⇒ 贝叶斯上轻微指向非人类'],
  ['N404', 'C+', '连续两夜被挡 ⇒ 非人类（保镖不可连保无豁免）。**口径纠正**：既有 N306 结论写「X 是异形」，本条只到「非人类」（护盾与免疫不设区分通道）'],
  ['N405', 'C', '同一目标被挡 ≥3 个**非连续**夜次 ⇒ 存续型抵挡层指纹（护盾跨夜保留，保护/抗体是时限型）'],
  ['N406', 'B+', '濒死名单 − ⑥ 死亡名单 = 被救回者 ⇒ 实际攻击次数。**证群体不证个体 ⇒ 走普适层**，不指向任何个体（被救回者不等于好人：异形会用「自伤队友」制造濒死诱饵）'],
  ['N407', 'B', '抗体生效 × 目标存续（三方对账）⇒ 该夜确有一次感染施加于 X 且 X 其后无标记落地'],
], [900, 700, 6560]));
children.push(p('★ 核心裁定（专项文档第四章，上升为通则）：**凡由私有攻击反馈推出的目标身份推断，一律不进普适层**——留单体层（写该攻击方对目标的敌对度）、不写 universalOf、不设强档（≤C+），使其「可推理、不许收敛」，与噪声章 20.5 的分布平坦要求同一口径。N403/N404/N405 已用回归断言锁死 universal:false。'));
children.push(p('★ 触发面互斥：N403/N404/N405 共用攻击方私有的 p.attackLog，按「被挡夜次形状」分派（once → N403 · consec → N404 · persist → N405），同一（观察者, 目标）只入账一条。'));
children.push(table([
  ['编号', '旧实现', '新实现（效用权重，非硬规则）'],
  ['N414 保镖', 'if (exposed.length) return exposed[0].id —— 硬规则，等于「必须优先保护 ④ 暴露者」', 'U = −dangerOf + protectionBonus(...,\'guard\')，经 argmaxProtect 选择'],
  ['N415 警长', '[自己, 已暴露工程师, dangerOf 最低 1 人] —— 硬插队且忽略「不可替换性」', 'U = −dangerOf + protectionBonus(...,\'patrol\') 取前 3'],
  ['N416 医生', '治疗候选仅「感染者」', '候选扩为 感染者 ∪ 关键预告者（**预投抗体**——治疗即赋抗体，steps.js \'8\' 的 had=false 分支照样授予，这才是「抵 1 次感染」的真实语义）'],
  ['N417 下界', '—', 'argmaxProtect：ε ≥ Tiers.PROTECT.floor(0.05)，且**硬源确证（conf=1）时也不归零**'],
], [1200, 5000, 1960]));
children.push(p('为什么 N417 必须有独立入口：通用 argmax 在 conf=1（分布退化为单点，来自 knownLock 硬锁）时 ε=0。保护决策问的是「要不要保他」，与「他是不是敌人」的置信度无关——沿用通用入口的话，硬锁为人类的关键职位（④ 暴露的工程师、③ 公告过的金水）会被机械地夜夜保护，保护优先级退化成硬规则，直接违反噪声章 20.1「效用必须连续算出来」与「不制造最优」。回归断言用 400 次抽样锁死「conf=1 下次要选项选择率 ≥5%」且「通用 argmax 仍归零」。'));
children.push(p('保护优先级阶梯（Tactics.protectPriority，只读公开事实）：3 已预告（可验证强承诺者）／④ 暴露的关键职位 ＞ 2 已被官方确证为人类的关键职位 ＞ 1 高价值未确证 ＞ 0 其余；自保另有固定权重 Tiers.PROTECT.self（专项文档 5.1 明列「自保」是 AI 可以不合规地不保护预告者的理由之一）。N414~N417 **不进 channels.data**（它们改变行动效用而非证据；塞进总表当通道等于给保护目标选择加一个硬阈值）。'));
children.push(table([
  ['引擎侧落盘缺口', '位置', '原因'],
  ['④ 暴露公告补标原职业', 'steps.js \'4a\'', '定案 1（暴露公告固定标注原职业）在 ④ 一直漏（⑥⑩ 早已标）⇒ N401 的连带推论没有输入'],
  ['p.dyingSeen（濒死名单）', 'steps.js \'8\'（救援结算**之前**）', 'P13「每夜免费见全场濒死名单」此前只出现在表单 desc 与视图层，**AI 侧零落点**（总表自评「本轮最大漏记」）⇒ N406 无法变现'],
  ['p.antibodyFired（抗体生效）', 'engine.js applyInfection', 'P15 此前只有 priv() 文本 ⇒ N407 无素材'],
], [1900, 2100, 4160]));
children.push(p('v31 批 3.5 验收：回归 **100/100**（71 → +29）· round-trip 0 失败 · UI 冒烟 30 局 · 500 局 **0 异常** · 人类 **27.0%** / 异形 **60.4%** / 外星人 **12.6%** · AUC(人类) .434/.410/.486 · 证据层分叉度 0.3217 · 硬源锁定 2.43 条/局 · 通道接线 **32 → 38 / 506**（chan_fired 27）· 保护侧出口 N401 773 · N403 260 · N404 2 · N405 1 · N406 979 · N407 26 · 行为指纹 **6c04657a…**（存档 _baseline_fingerprint_200_v31b35.json）。', { size: 18, color: '555F6E' }));
children.push(p('诚实记录：① 人类 −0.2pp（27.2% → 27.0%）——N416 让生化医师把 3 次额度反复预投同一预告者（抗体只持续 1 夜），异形不选感染方向时是纯损耗；N403~N405 对「异形刀人类」也会写非人类证据（层收敛在贝叶斯上确实指向非人类，但保镖保护人类是最常见的解释）。按红线 4 **不用胜率反推权重**，量级留待专项文档 8.2 的单体层增量标定。② N404/N405 出口极少（2 / 1 次，判据本就稀有，文档预期「更锋利也更稀有」）。③ **N407 的结论方向被修正为「信任」**——总表原文是「⇒ X 为异形（效果免疫）」，但本引擎层序是 抗体→保镖→巡逻→**效果免疫**（抗体抢先结算）⇒ 异形同样不会留下假标记 ⇒ 原文结论不可判定；落地为「抗体生效 ⇒ 该夜确有一次感染施加于 X，且 X 其后无标记落地」，身份判定仍留给 N149/N139。**此口径需拍板**。④ N402 无独立出口（前提型通道的必然结果）。', { size: 18, color: '555F6E' }));

/* 5 AI 运行模块（独立） */
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('5. AI 运行模块（独立切割）'));
children.push(p('本章单独收录 AI 运行代码。其与引擎的接口仅有两处：① ai.decide(g, req) 在每个决策步被引擎调用，返回结构化决策（不含任何 DOM 操作）；② 引擎在揭示/发言/讨论收束时回调 onAccuse / onClaim / onReveal / onAsk / onQuote / onReport / onPrivate 等威胁度事件入口。除此之外 AI 不感知视图与驱动层——这正是第 3 章蒙特卡洛可以脱离浏览器运行的原因。'));
children.push(p('v27 解耦为四层 + 门面（合计 ' + G.ai.reduce((a, b) => a + b.n, 0) + ' 行）：ai/util.js（共享工具与跨层常量）→ ai/belief.js（证据账本与估值数学：project / hostileOf / suspOf / dangerOf / capability / actF / universalOf / addEvent）→ ai/perceive.js（事件入账：onAccuse / onClaim / onReveal / reason / emitKingSignals / onPrivate* …）→ ai/decide.js（决策：speak / vote / decide / argmax / urgency）→ ai.js（54 行门面，只做别名转发，AI.* 接口不变）。依赖单向无环：perceive → decide 引用为 0，decide → perceive 仅 3 处（onClaim / grudgeLevel / phaseTag）。'));
children.push(bullet('证据分模型：E(i,j,f) 三通道只增不减——负值事件写反向通道；投影出怀疑度分布 S(p_human,p_alien,p_king) 与敌对度（人类 p_alien+p_king / 异形 p_human+p_king / 外星人 p_alien）；危险度 Dg 独立构成（能力+敌对度+活跃度），硬源确证己方归零。'));
children.push(bullet('推理链：R1~R41 按档位增量入账，全部幂等键去重（一局内每事件实例只入账一次）；宣称类每夜 ×0.85 衰减、公开事实不衰减；并罚按独立信息源（sourceId）。'));
children.push(bullet('决策：ε-greedy 劣解池加权采样（主干 0.4 / 生存 0.15，绑主观置信度、硬下限 0.05、硬源确证归零），「不做」同为候选；西塔三档（25/50/75，15:70:15）驱动行动阈值、暴露容忍、投票参数。性格危险度基线的唯一真源 = `Tiers.BASE_DANGER`（30/50/70，**当前零读取点，仅登记**）；真正生效的是 decide.js 的 actLine(10/20/30) / abstain / param 等 **10 个 θ 旋钮**（清单与 2026-09-10 的「标定→回退」全过程见 docs/v31执行台账.md）。'));
children.push(bullet('社交：发言语料事实驱动（不引用不存在的事件）、指控/自证/质询/转述五类 NLP 信号、私聊四类内容与真实率、异形队内 Top-k 出刀协调与票型计划。'));
for (const b of G.ai) pushCode(children, '5.' + (G.ai.indexOf(b) + 1) + '  js/' + b.title, b);

/* 6 引擎核心源码 */
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('6. 引擎核心源码'));
children.push(p(`v27 解耦为三件套（合计 ${G.core.reduce((a, b) => a + b.n, 0)} 行）：engine/announce.js 收敛全部「信息出站」（公开/私有分叉的唯一收口点）；engine/steps.js 承载 26 个步骤条目（1165 行，工厂 + 依赖注入，表内处理器不反向依赖引擎）；engine.js 保留驱动与结算（${G.core[2].n} 行）。与 AI 的耦合点仅限第 5 章的两处接口。`));
G.core.forEach((b, i) => pushCode(children, `6.${i + 1}  js/${b.title}`, b));

/* 7 状态层与配置层源码 */
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('7. 状态层与配置层源码'));
G.state.forEach((b, i) => pushCode(children, '7.' + (i + 1) + '  js/' + b.title, b));
G.config.forEach((b, i) => pushCode(children, '7.' + (G.state.length + i + 1) + '  js/' + b.title, b));

/* 8 结合层源码（语言 ⇄ 推理 ⇄ 行为） */
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('8. 结合层源码（语言 ⇄ 推理 ⇄ 行为）'));
children.push(p('公开发言——无论出自玩家还是 AI——只有一个入口 Bridge.say()：语言层产出 Claim IR → 推理层按 kind 路由到既有 AI 钩子 → 写入证据台账（含 sourceId）→ 影响投票 / 决策 / 下一轮发言。可见性过滤收敛到 infer/visible.js 投递侧唯一实现。'));
children.push(p('v27 解耦后本章按「语言层 → 推理层 → 语料层」三段收录：语言层（nlp / ir / renderer）· 推理层（tiers 档位表 / registry 配置与专家注册表 / moe 路由与仲裁 / channels.run 门禁表与执行器 / visible / speakable / pipeline）· 语料层（tactics（含人类侧保护优先级池 N414~N416）/ channels.data 506 条 / channels 查询 API）。'));
[...G.lang, ...G.infer, ...G.corpus].forEach((b, i) => pushCode(children, '8.' + (i + 1) + '  js/' + b.title, b));

/* 9 视图与驱动层源码 */
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('9. 视图与驱动层源码'));
[...G.view, ...G.drive].forEach((b, i) => pushCode(children, '9.' + (i + 1) + '  js/' + b.title, b));

/* 10 服务器源码 */
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('10. 联机服务器源码（开发中）'));
pushCode(children, '10.1  server/server.js', G.server[0]);

/* 11 附录：缺陷回归断言 */
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('11. 附录：缺陷回归断言（tools/test-fix-v26.cjs）'));
children.push(p('64 条断言（v26 的 29 条 + v28 系列 25 条 + v31 批 1~2 新增 10 条），每条对应一处已修缺陷：硬源锁定 / 透视四处 / 宣称类目标侧证据 / 指控档位三层计价 / 承诺兑现判据 / K2 护队指纹 / 执行器幂等与量纲 / 通道编号挂载 / 医生记忆通道（N139/N141/N149）/ 验票官通道（N188/N216）/ 影子层与仪器 / 破坏局势相关性 / P 档映射与视角依赖档位 / 承诺词表与 A01 命中 / 预告类结算；' +
  'v28 新增：影子层 targets[] 形态可算 + 无目标安全返 0 + 返回值分布可读（A1/C1）· 执行器求值计数（C3）· crew 自证幅度与档位来源（A6①）· 宣称医生（旧别名 doc）产证据（A6③）· 谎称船员被对证击穿（A6②）· K1 档位来源与被沉默者豁免（A5）。' +
  '运行：node tools/test-fix-v26.cjs —— 失败即视为修复失效。'));
pushCode(children, '11.1  tools/test-fix-v26.cjs', G.reg[0]);

/* 12 未修复点与待裁定（v27 全量台账） */
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('12. 未修复点与待裁定（截至 v31 批 3）'));
children.push(p('本章是交接用的现状台账（逐条位置/实证/修法见 docs/交接文档_v31.md §4.2 与 docs/v31执行台账.md）：A 类 → A1/A5/A6/A3 已修，A2/A4 已由 v31 批 3 收口 · B 类 → B1/B2/B3/B6/B7 已完成、B2′ 已给显式映射与接法（P=10 + impl.tier，批 3.5 起 P 档可接线）、B4 能力已就位（N216 已生效），剩 B4 的其余样本（15 条视角注解随批 6 接线）/ B8 · **B9~B11 为 v31 批 3.5 新增待拍板（N407 的结论方向 / N403~N405 的幅度与假阳性 / N416 抗体存续口径）**、**B12 为 2026-09-10 性格基线标定（曾标定 40/55/70 并整族缩放同轴值，实测人类 −1.6pp ⇒ 已整体回退，现为原值）** · C 类 → C1/C3 已修 · D 类 → D2 的「船员排除信息」已接线，其余未动 · E 类 backlog 3 项。'));
children.push(h2('12.1 A 类：代码缺陷（可直接修，无需裁定）'));
children.push(table([
  ['#', '问题', '位置 / 实证 / 状态'],
  ['A1', '影子层 100% 空转（字段名 bug）', '【v28 已修】moe.js shadowRisk 目标解析改走 claim.target ?? targets[0]（并补 tEvents 槽位）。旧实现 1536/1536 次返回 0；修后 500 局 calls 3487 · 采纳率 3.07%'],
  ['A2', 'denyLie 恒 0', "AI 生成端 IR.mk('deny') = 0 处（只有 nlp 解析人类文本会产 deny）→ 全 AI 局必然 0。属【新机制】而非 bug：是否给 AI 加「否认」话术需裁定"],
  ['A3', 'promiseMiss / PromiseHit 恒 0', 'AI 只产弱承诺（无目标），又被 v26「无指向不结算」过滤；连带 A01/A02 两条接线在 C3 仪器里显示为「求值>0 而 0 命中」。建议随 D2 批次一起做'],
  ['A4', '三档仲裁「差一档/差两档」不可达', '【v28 已评估】arb.n=161836 / 同档 419 / 差一档 0 / 差两档 0 / arb_multi_rate 0.0026；根因 = emit 按 (target, expert) 分组且每次多只带 1 条 Claim，而跨专家分组是 v25 刻意保守（放开 300 局吞掉约 1400 条规则减疑）。结论：不建议为指标好看放开；要可达需改产出面或重新设计「专家分歧」表达'],
  ['A5', "K1 沉默指纹三处口径", "【v28 已修】档位入 Tiers.RULE.kingSilent = C；触发面收紧为 actF(g,t) === 0；频次 2 夜 → 3 夜；排除被蛰伏沉默压制者（异形观察者的排除保留未动，属 D3）"],
  ['A6', 'crew / doc 宣称「零代价洗白」', '【v28 已修】R38 族全部经 RULE 表；R38crew B(20) → D+(7)（d −15 → −8）；crew 不再豁免对证链（可被 cross A− 击穿）；doc→bio 四处收口 + pipeline 兜底（旧实现宣称医生完全不产证据）'],
], [700, 3000, 5660]));
children.push(h2('12.2 B 类：需设计裁定'));
children.push(table([
  ['#', '议题', '现状读数 / 说明'],
  ['B1', '破坏路径：异形该靠刀赢还是靠停摆赢？', '【v28b 已落地】裁定「让 AI 根据推理库和引擎实时选择，不做强制要求」→ 破坏效用扩为四项实时评估（含死变量 gain 归位 + 新增 knownRepairers 阻力项），不加硬推。⑤ 公告 15.0% → 38.0%；停摆 3.0 6 → 67 局 / 6.0 0 → 8 / 9.0 0 → 1'],
  ['B2', '把所有怀疑度/危险度的调用值统一到 score', '【v28b 已落地】Tiers 新增 9 组常量表 + 9 条字面档位串入 RULE；行为中性（指纹逐字节一致）。注：原 B2 议题「P 档 41 条强度未定」仍未解决（见 B2′）'],
  ['B2′', 'P 档 41 条强度', "【v31 批 1 给显式映射 + 批 3.5 给出接法】SCORE['P'] = 10 + TIER_BY_VAL 排除 P；批 3.5 起私有源以「表内 tier='P'（语义标记）+ 门禁 impl.tier（真实强度档）」接线，N403~N407 五条已接（P 档已接线 5 / 46 条，其余 41 条仍 dormant）"],
  ['B3', 'exclusion（排除职业）目标侧方向 + 量级', '【v28b 已落地】方向 (a) 贝叶斯 + 新增专用最弱档 D--(1)（D− 会 +12~18pp，D-- 实际 +5.1pp，对齐实测 +4.7pt）；私有（船员查验）+ 公开（排除宣称）双路接线，500 局产出 4249 + 1914 条'],
  ['B4', 'per-observer tier（视角依赖档位）', '【v31 批 1 已实现能力并首次生效】tiers.tierFor/magFor 支持 {def, byRole, byFaction}，在 write / arbitrate / channels.run 三处按观察者解析；N216 已按总表注解生效（对验票官 A−）。总表另有 15 条视角注解（A03~A06/B14/B19/D13…），随批 6 逐条接线'],
  ['B5', 'N219 档位裁定（验票官转述死者票型 = B−）', '已于 v26.c 写入 Tiers.RULE.voteQuote = B−，等票型转述类 claim 实现时生效'],
  ['B6', 'sabTau / SCORE 幅度标定', '【v28c 已标定】系数入 Tiers.SAB（可 SK_SAB 覆盖 A/B）；新增「局势相关性」仪器（三分位自适应分档 + 均值对照）。验收口径 = 方向：四路信号（压力↑ / 距档位↓ / 已知维修者↓ / 已破坏队友↑）在选中破坏的样本里全部符合理性。A/B 三组：默认(0.25/8) 39.3%·停摆 36/3/1·方向全对；弱收益强阻力(0.15/12) 23.0%；强收益弱阻力(0.40/4) 70.7% 但维修者数方向反转 → 采用默认。仪器同时抓出并修掉两处真 bug（协同项读决策期不可读的 p.branch；节流与协同互斥）'],
  ['B7', 'SHADOW_FACTOR 标定', '【v28c 已标定】三档 A/B（300 局同种子，SK_SHADOW_FACTOR 覆盖）：SF 0.2/0.5/0.8 → 采纳率 1.05% / 3.12% / 5.97%，分布 p90 0.0074 / 0.0166 / 0.0342。保留 0.5，语义定为「听众折扣（按半价采信）」；SF 上调明显利好异形（53.3% → 57.3%），无明确设计意图前不上调'],
  ['B8', '「活跃即死」是否保留', 'dangerOf 含 0.1×actF（上限 +10 分）：越活跃越容易被投/被刀，同时是「发言有代价」的机制 → 建议先保留'],
  ['B9', 'N407 的结论方向（批 3.5 新增，**需拍板**）', '总表原文是「抗体生效 × 目标存续 ⇒ X 为异形（效果免疫）」，但本引擎层序是 **抗体 → 保镖 → 巡逻 → 效果免疫**（engine.js applyInfection），抗体在效果免疫**之前**结算 ⇒ 即便 X 是异形也不会留下假标记 ⇒ 原文结论在本实现**不可判定**。批 3.5 落为可判定部分：「抗体生效 ⇒ 该夜确有一次感染施加于 X 且 X 其后无标记落地」按【信任】方向记 B 档；身份判定仍留给 N149（假标记滞留）/ N139（标记消失而 ⑫ 未增）。**待定**：接受该口径，或改为只做 P15 结构化落盘、判定完全交给 N149/N139'],
  ['B10', 'N403~N405 的幅度与假阳性（批 3.5 新增）', '层收敛后抵挡可能来自 保镖(人类) / 结茧护盾 / 夜晚免疫，批 3.5 按文档判为「贝叶斯上轻微指向非人类」（C+/C）——但「保镖保护人类」是最常见的解释，存在假阳性（500 局人类 27.2% → 27.0%）。**待定**：按专项文档 8.2 做单体层增量标定；并决定是否把人类攻击方（警长/武装，被挡时方向相反）也纳入（当前排除）'],
  ['B11', 'N416 抗体的存续口径（批 3.5 新增）', '抗体只持续 1 夜（engine.js `antibodyNight = g.night + 1`）⇒「优先给预告者（抵 1 次感染）」意味着治疗额度要在多夜**反复预投**，异形不选感染方向时是纯损耗。**待定**：是否改为「抗体存续到被消耗」（属规则层变更）'],
  ['B12', '性格危险度基线标定（2026-09-10，**已整体回退**）', '过程：① 拍板把 Tiers.BASE_DANGER 由 30/50/70 → 40/55/70（该常量**零读取点** ⇒ 行为中性）；② 再按 k = {25:4/3, 50:1.1, 75:1} 等比放大 6 项「危险度同轴」分档值（actLine/voteParam/abstain/swapOff/vSelf/SAB.thetaShift）⇒ 实测 **人类 27.0% → 25.4%、异形 60.4% → 61.6%**（性格轴整族放大 = 人类投票更保守/出手更少）；③ **用户裁定整体回退（基线一并回退）**。现状：全部为原值，回归 100/100 · 指纹 6c04657a… 与批 3.5 逐字节一致 · 500 局 27.0/60.4/12.6。**保留两条结论**：BASE_DANGER 仅登记不生效；真正生效的是 10 个 θ 旋钮（actLine · abstain · param · swapOff · vSelf · SAB.thetaShift · GRUDGE_W · OPEN_RATE · THETA_BIAS · p.w · θ/50 族），下次调性格请**逐旋钮 A/B**，不要整族等比缩放'],
], [700, 3200, 5460]));
children.push(h2('12.3 C 类：仪器 / 口径'));
children.push(bullet('C1 硬源计数盲区：【v28 已修】project() 命中 knownLockOf 时短路返回、不读 tEvents → mc 的 srcKind.fact 漏掉全部硬源锁定。仪器改为直接按 knownLockOf 读 p.known 并三分类：500 局 2.22 条/局（中位 1）· 单人私有 0.53 · 小组 0.79 · 全场 0.89。'));
children.push(bullet('C2 chan_wired 可被空转 gate 刷高（11 条 E1 算术族写普适层、不分叉）→ 已加 divergence 读数缓解（v28：0.333 → 0.400），建议与 chan_fires 成对读。'));
children.push(bullet('C3 已接线但 0 触发：【v28 已修】执行器新增每通道「求值 / 命中」计数（只统计真正参与求值的次数，P/Z/F 语义档在入口即跳过）。500 局：求值 880,448 / 命中 29,503；17 条「求值>0 而 0 命中」——N98 N09 N10 N11 N12 N17 N18 N19 N20 N22（T 族高破坏量，⑤ 仅 15%）· A01 A02（需带目标强承诺 = A3）· A08（需两人宣称同一独占职业）· N318 N141 N149 N188（稀有事件）。结论：不是接线写错，而是上游事件未出现。'));
children.push(h2('12.4 D 类：结构性缺口（设计缺口，非 bug）'));
children.push(bullet('D1 AUC 敌友倒置：v28 复测 人类 0.440 / 0.431 / 0.484、异形 0.455 / 0.473 / 0.419、外星人 0.439 / 0.418 / 0.643（开局/中期 < 0.5）。归因 = 先验对称 + 79% 友军火力（人类视角敌方仅 4/14）+ 宣称无对账 + 沉默无代价。v28 的 A5+A6 已补上「让沉默与空口宣称付代价」的一半，但 AUC 中期仍未过 0.5 → 说明另一半（让好人被更快确证）尚未补上，落点见 D2。仪器口径已核（suspOf = hostileOf×100 与 AUC 的 pos/neg 一致）→ 是真实读数，不是量错。'));
children.push(bullet('D2 AI 同质化：v28b 复测 证据层分叉度 0.315（v27 0.29）、私有硬源 0.52 条/局。全场共享的硬锁（⑥⑩揭示 / ④公告 / 神探公告 / 工程师与异形暴露）是规则设计的公开锁，不是缺陷；真缺口在私有信息优势。**已落地一条**：「船员查验的排除信息不进估值」（原先只写 p.known（不含 faction）→ knownLockOf 返回 null → 证据层零落点）已按 B3 接线，500 局产出私有 4249 + 公开 1914 条。**剩两条**：外星人查验私有性（已是硬锁，产出受规则约束）· 神探公告共享面（口头汇报是否等同 ③ 官方公告，属规则解释，需裁定）。'));
children.push(bullet('D3 异形观察者的 king 通道恒 0（先验 king=0 + chanFor 全归 human）→ K1/K2 对其完全不可见，无法区分人类与外星人。'));
children.push(bullet('D4 三处「真值形状」的良性读取（非硬透视）：decide.js 的 exposedEngineer（x.faction / x.role）· 神探发布决策（x.faction，等于自查验结果）· 破坏协调（队友 x.branch）。建议改读 known / 协调通道。'));
children.push(h2('12.5 E 类：backlog（工作量，不是缺陷）'));
children.push(bullet('E1 通道接线 38/506（可执行集合 ≈423）：落点 js/infer/channels.run.js + js/corpus/channels.data.js。'));
children.push(bullet('E2 前端未审查：ui.js / main.js / view.js（按项目要求「暂时忽略前端」）。'));
children.push(bullet('E3 一致性校验类通道（N06/N13/N14/N177）刻意不接线：它们是实现自检，接线只会往普适层灌噪声。'));

/* 13 v27 新增工具源码 */
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('13. v27 新增工具源码'));
children.push(p('三件套构成「加载契约单一真源 + 重构安全网」：load-order.cjs（唯一加载清单，6 个剖面）→ sync-html.cjs（由清单生成 index.html 脚本块，--check 可作门禁）→ fingerprint.cjs（行为等价指纹：结局线 + 每夜全体观察者×目标的 suspDist/dangerOf 六位小数采样）。'));
G.tool.forEach((b, i) => pushCode(children, '13.' + (i + 1) + '  tools/' + b.title, b));

/* 14 交接要点 */
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('14. 交接要点'));
children.push(p('给接手者的十一条（每条的背景都在前 12 章里）：'));
children.push(bullet('① 开工前先跑三件事确认环境：node tools/test-fix-v26.cjs（应为 **100/100**）· node tools/fingerprint.cjs 200 1（当前基线 hash 应为 **6c04657a…**；此前的 4fa952e7… / 91e2f543… / 4a5fb176… / 120d2cdc… / 9a600934… / 9ee5c4ae… 均已因有意的行为改动作废）· node tools/sync-html.cjs --check（应为一致）。'));
children.push(bullet('② 改「不应改变行为」的东西（搬移 / 重命名 / 加注释）：必须过 fingerprint 的 200 局逐局比对；hash 不一致就回滚，不要凭感觉判断。'));
children.push(bullet('③ 改行为（数值 / 判据 / 通道）：先存档一次 fingerprint，再改动；然后看 mc 500 的三组读数——胜负分布 · 分叉度 · 分阵营 AUC。'));
children.push(bullet('④ 新增 js 文件：只改 tools/load-order.cjs 的 ORDER，然后跑 node tools/sync-html.cjs；不要手改 index.html 的脚本块。'));
children.push(bullet('⑤ AI 层别名约定：模块自带依赖（util 提供 clamp / alive / byId / gauss / knownOf 与 BAND_DOWN / GRUDGE_W），ai.js 只做 const X = MODULE.X 转发，不要再往里写逻辑。'));
children.push(bullet('⑥ 档位红线：任何证据幅度只能写 Tiers.SCORE[Tiers.RULE.xxx]（幅度唯一来源 = 档位表）；新增规则要在 RULE 表登记，否则不可追溯。'));
children.push(bullet('⑦ 防透视红线：禁止读他人 p.faction 做判断；可读的只有 p.known / p.revealed / 公开黑板（现存三处待收口见 12.4 D4）。'));
children.push(bullet('⑧ 接线只在两个文件里做：js/infer/channels.run.js（门禁表）+ js/corpus/channels.data.js（506 条总表），每接一条在 test-fix-v26.cjs 补一条挂载断言。**私有源（总表档位 P）的接法**：表内 tier 写 \'P\'（语义标记）+ 门禁里 impl.tier 声明强度档（见 N403~N407），不要直接把表内 tier 改成 C+/B+ 而丢掉「私有源」语义。'));
children.push(bullet('⑨ 诊断脚本一律走 profiles（full / noBridge / aiOnly / minimal / lang / ui）；清单缺 infer/tiers 会首夜抛 TypeError（历史坑，见 1.5 末条）。'));
children.push(bullet('⑩ 回滚点：v28b 源码快照 ../_backup_v28b/js/ · v28b 指纹 ../_baseline_fingerprint_200_v28b.json（120d2cdc…）· v28b 模拟快照 ../_mc_result_v28b.json；v28 首批 ../_backup_v28/ + _baseline_fingerprint_200_v28.json（9a600934…）；解耦前全量 ../_backup_pre_modular/ + v27 指纹 9ee5c4ae…；逐步指纹 _after_e1..e8.json。'));
children.push(bullet('⑪ v31 批 3 与批 3.5 已落地（批 3：战术库 30 条 / 6026 次出口 + 三项裁定；批 3.5：人类侧保护专项 7 条通道 + 4 条保护优先级）。之后按方案 §8.1 继续：批 4 证据入账统一走 MoE（A4 的唯一解）→ 批 5 全局注意力池（证据层分叉度当前 0.3217）→ 批 6 E1 接线 38→423（带视角维度，15 条视角注解已就绪）→ 批 7 D1/D3/D4。**待拍板项**：① 战术库剩余的认知类条目（N361/N369/N370/N385 等无出口动作，语义是「什么时候别做什么」）是否需要显式门禁；② 批 2 遗留的预告暴露代价是否推广到全部自曝型发言；③ **批 3.5 新增三项**：N407 的结论方向（原文「⇒ X 为异形」在本引擎层序下不可判定，已落为「信任」方向）/ N403~N405 的幅度与「保镖保护人类」的假阳性 / N416 抗体只持续 1 夜导致的反复预投。完整台账见 docs/v31执行台账.md。'));

/* ---------- 文档 ---------- */
const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 21 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Arial', color: '1F3864' },
        paragraph: { spacing: { before: 280, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial', color: '2E75B6' },
        paragraph: { spacing: { before: 220, after: 160 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [{ reference: 'bullets', levels: [{ level: 0, format: 'bullet', text: '•', alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 560, hanging: 280 } } } }] }],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1200, right: 1100, bottom: 1200, left: 1100 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: '太空杀 · 游戏引擎技术文档  —  第 ', size: 16, color: '8a93a3' }),
      new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '8a93a3' }),
      new TextRun({ text: ' 页', size: 16, color: '8a93a3' }),
    ] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log('written:', OUT, (buf.length / 1024 / 1024).toFixed(2) + ' MB');
});
