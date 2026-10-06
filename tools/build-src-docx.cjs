/* =============================================================
 * 太空杀 · 源代码合集 docx 生成器
 *
 * 用途：把工程目录的全部【文本源文件】按固定口径打包成一份 Word，供规则方/交接方
 *       离线审阅。生成口径与 2026-10-03 首版（87 文件）完全一致，本文件只是把那次
 *       一次性脚本固化为可复跑的工具——以后每次改代码后重跑即可「同步修改内容」。
 *
 * 用法：node tools/build-src-docx.cjs [输出路径] [版本]
 *   默认输出 C:\Users\ASUS\Desktop\太空杀v6.6阶段2_源代码合集.docx
 *   版本缺省取 package.json 的 version（升版本号请改 package.json，勿硬编码）
 *
 * 收录口径（勿随意放宽）：
 *   · 扩展名白名单：js / cjs / mjs / md / json / yml / yaml / html / css / txt
 *   · 排除目录：node_modules · .git · dist · build · .wrangler · .codebuddy
 *               · android/assets（构建镜像，由 android/sync-www.cjs 生成，非源）
 *   · 排除文件：.env 及密钥/证书类（pem / key / crt / p12 / jks / pfx / keystore）
 *   · 排序：localeCompare('zh-CN')，与首版逐项一致
 * ============================================================= */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  Footer, PageNumber, PageBreak, LevelFormat,
} = require('docx');

const ROOT = path.join(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const OUT = process.argv[2] || 'C:\\Users\\ASUS\\Desktop\\太空杀v6.6阶段2_源代码合集.docx';
const VERSION = process.argv[3] || PKG.version;
const DATE = new Date().toISOString().slice(0, 10);

/* ---------- 收录口径 ---------- */
const EXT_OK = new Set(['.js', '.cjs', '.mjs', '.md', '.json', '.yml', '.yaml', '.html', '.css', '.txt']);
const EX_DIR = new Set(['node_modules', '.git', 'dist', 'build', '.wrangler', '.codebuddy']);
const EX_PATH = ['android/assets'];                       // 构建镜像，非源
const EX_FILE = new Set(['.env']);
const EX_EXT_SECRET = new Set(['.pem', '.key', '.crt', '.p12', '.jks', '.pfx', '.keystore']);

function collect(dir, rel = '', out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (EX_PATH.some(p => r === p || r.startsWith(p + '/'))) continue;
    if (e.isDirectory()) {
      if (EX_DIR.has(e.name)) continue;
      collect(path.join(dir, e.name), r, out);
      continue;
    }
    if (EX_FILE.has(e.name)) continue;
    if (!EXT_OK.has(path.extname(e.name).toLowerCase())) continue;
    if (EX_EXT_SECRET.has(path.extname(e.name).toLowerCase())) continue;
    out.push(r);
  }
  return out;
}

const files = collect(ROOT).sort((a, b) => a.localeCompare(b, 'zh-CN'));
const stat = f => {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
  return { lines: s.split('\n').length, kb: Buffer.byteLength(s, 'utf8') / 1024, text: s };
};
const metas = files.map(stat);
const totalKb = metas.reduce((a, m) => a + m.kb, 0);
const totalLines = metas.reduce((a, m) => a + m.lines, 0);

/* ---------- 排版常量（与首版逐项一致） ---------- */
const YH = 'Microsoft YaHei', CO = 'Consolas';
const border = { style: BorderStyle.SINGLE, size: 1, color: 'BFBFBF' };
const borders = { top: border, bottom: border, left: border, right: border };
const COLS = [700, 6619, 700, 1007];                       // 合计 9026
const cell = (i, text, bold, fill) => new TableCell({
  borders, width: { size: COLS[i], type: WidthType.DXA },
  shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
  margins: { top: 60, bottom: 60, left: 110, right: 110 },
  children: [new Paragraph({ spacing: { before: 0, after: 0, line: 280 },
    children: [new TextRun({ text, bold: !!bold, font: YH, size: 18 })] })],
});
const para = (t, o = {}) => new Paragraph({
  spacing: { after: o.after == null ? 80 : o.after, before: o.before == null ? 0 : o.before },
  alignment: o.center ? AlignmentType.CENTER : undefined,
  children: [new TextRun({ text: t, font: o.font || YH, size: o.size || 21, color: o.color })],
});
const codePara = line => new Paragraph({
  spacing: { before: 0, after: 0, line: 240, lineRule: 'exact' },
  shading: { fill: 'F7F7F7', type: ShadingType.CLEAR },
  children: [new TextRun({ text: line.length ? line : ' ', font: CO, size: 16 })],
});
/* XML 不允许的控制字符（制表符保留，按 4 空格展开以保持缩进可读） */
const sanitize = s => s.replace(/\t/g, '    ').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/* ---------- 本批改动摘要（随批次维护） ---------- */
const CHANGES = [
  '第十八批 · 17b 前置清零：D1 遗忘改由游戏时钟驱动（stepToNight/nowNight）· D2 新增 excludeFaction/floor 排除式原语 · D3 主判据换「非异形观察者 AUC」（禁 pooled 全局口径）· D4 种子隔离（调试 1–100 / 指纹 1–200 / 验证 501–700）· D5 残局归因三臂分离（证明与 hardFloor 无关）· D6 十个常量补机制依据 · A1–A5 五处弱断言替换为会随实现变坏而失败的断言。',
  '第十八批 · 重新裁决：非异形 AUC 0.514（旧 0.499）高于旧侧但未达 0.55 判定门 ⇒ 改判「先调模型」，17b 接线不予放行。三方向候选：PRIOR_REG 每夜回归先验 / W_CAP 饱和位移 / C 档位移幅度过小——逐项须机制论证，禁止 AUC 反推。',
  '第十九批 · 文本审查第一遍修复：删「第 1 夜全能免疫」幽灵 UI（v6.6 2.3 表 #8 已废）· 规则速览整页 v4.1→v6.6（停摆 +2.5/+5.0、破坏 1.5~2.0、抵挡层补护甲与全额减免、生路三项、补残局与平局）· 子弹到账夜改第 7 夜 · 职业别名卡补 4 席位变体。',
  '第二十批 · 文本审查第二遍 P0/P1：T18 AI 出口门禁（renderer 说话者视角/能力门禁 + speakable 删 guard-backing + tactics N372/N365）· T20 步骤 0.5 补沉默门禁（实现缺陷：文案承诺覆盖自 0.5 起而实现未校验）· T19 占位步静默（0.2/1/3.5 不再每夜泄漏未实装机制名）· T21/T23/T24 文案 · T22 制药 owner 校验。**有意行为改动 ⇒ 指纹作废重建 62a402fb…**',
  '第二十一批 · 文本审查第二遍 P2/P3（行为中性，指纹逐位不变）：T25 channels.data 十二处过时判据更正/标注退役（第 1 夜全能免疫、第 5 夜子弹、第 10 夜免疫、助理维修档、原职业同制说、批⑫ F 档两处、④ 维修粒度等）· T26 渲染层删「还剩两夜」「这两夜在制药」硬编码 · T28 中文数字压测分支显式化为 CN_NUM_RATE 常量且可覆盖 · T29 无目标不再产出破句（「我保。」「都投 ，票别散。」）· T30 中文数字表扩至二十 · T31/T32 过时引用与「它」指称修正。',
  '第二十一批 · 门禁与取证：回归 292 → **304/304**（+12 条 T25–T32 断言）· round-trip 102/102 · 云单测 35/35 · H1/H3 各 9/9 · uismoke 30 局 · 行为指纹 **62a402fb…（1038328）逐位不变** · 注入测试：改坏 CN_NUM_RATE / 删破句守卫 / 恢复「还剩两夜」⇒ 3 条断言真挂（已还原）。',
  '本批变坏指标（治理规范铁律五）：无。本批为文案/知识库层，对局行为、三阵营读数（human 55 / alien 121 / xeno 24）与平均夜数 7.3 均逐位不变。',
];

const children = [];
children.push(
  new Paragraph({ spacing: { before: 240, after: 120 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: '太空杀 v6.6 阶段 2 · 源代码合集', font: YH, size: 36, bold: true })] }),
  para(`版本 v${VERSION} · 生成日期 ${DATE} · 由 tools/build-src-docx.cjs 生成`, { size: 20, center: true, color: '555F6E' }),
  para(`来源：工程目录 ${ROOT} · ${files.length} 个文本源文件 · ${(totalKb / 1024).toFixed(2)} MB · ${totalLines} 行`, { size: 20 }),
  para('已排除：node_modules/.git/dist/build/android 镜像/.wrangler 及 .env/密钥/证书类文件', { size: 18, color: '555F6E' }),
  para('本批同步的改动（第十七批 · v4.0 批次 17a 粒子云 · 2026-10-04）', { size: 21, before: 160, after: 40 }),
  ...CHANGES.map(t => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 40 },
    children: [new TextRun({ text: t, font: YH, size: 20 })] })),
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: '文件清单', font: YH })] }),
  new Table({
    width: { size: 9026, type: WidthType.DXA }, columnWidths: COLS,
    rows: [
      new TableRow({ tableHeader: true, children: ['序号', '路径', '行数', '大小'].map((t, i) => cell(i, t, true, 'DCE6F1')) }),
      ...files.map((f, i) => new TableRow({
        children: [cell(0, String(i + 1)), cell(1, f), cell(2, String(metas[i].lines)), cell(3, metas[i].kb.toFixed(1) + ' KB')],
      })),
    ],
  }),
);

files.forEach((f, i) => {
  children.push(
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: f, font: CO })] }),
    para(`路径 ${f} · ${metas[i].lines} 行 · ${metas[i].kb.toFixed(1)} KB`, { size: 18, color: '555F6E', after: 120 }),
  );
  for (const line of metas[i].text.split('\n')) children.push(codePara(sanitize(line)));
});

const doc = new Document({
  creator: '太空杀项目组',
  title: '太空杀 v6.6 阶段 2 源代码合集',
  description: `工程目录完整源码文本集合（v${VERSION}，${DATE}）`,
  numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•',
    alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 260 } } } }] }] },
  styles: {
    default: { document: { run: { font: YH, size: 21 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: YH }, paragraph: { spacing: { before: 280, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: CO }, paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 1 } },
    ],
  },
  sections: [{
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: '第 ', font: YH, size: 18, color: '808080' }),
                 new TextRun({ children: [PageNumber.CURRENT], font: YH, size: 18, color: '808080' }),
                 new TextRun({ text: ' 页 / 共 ', font: YH, size: 18, color: '808080' }),
                 new TextRun({ children: [PageNumber.TOTAL_PAGES], font: YH, size: 18, color: '808080' }),
                 new TextRun({ text: ' 页', font: YH, size: 18, color: '808080' })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log('written:', OUT, (buf.length / 1024 / 1024).toFixed(2) + ' MB');
  console.log(`文件 ${files.length} 个 · ${totalLines} 行 · ${(totalKb / 1024).toFixed(2)} MB · 版本 v${VERSION}`);
  files.forEach((f, i) => console.log(' ', String(i + 1).padStart(2), f, metas[i].lines, metas[i].kb.toFixed(1) + ' KB'));
});
