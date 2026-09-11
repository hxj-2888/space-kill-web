/* =============================================================
 * Markdown → Word 渲染器（项目文档转 Word 用）
 * 用法：node tools/md2docx.cjs <输入.md> <输出.docx> ["文档副标题"]
 * 支持：# / ## / ### 标题 · 列表 · 表格 · ``` 代码块 · --- 分页
 * ============================================================= */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  Footer, PageNumber, PageBreak, TableOfContents,
} = require('docx');

const IN = process.argv[2];
const OUT = process.argv[3];
const SUB = process.argv[4] || '';
if (!IN || !OUT) { console.error('用法：node tools/md2docx.cjs <输入.md> <输出.docx> [副标题]'); process.exit(2); }

const border = { style: BorderStyle.SINGLE, size: 1, color: 'BFC9D9' };
const borders = { top: border, bottom: border, left: border, right: border };
const CONTENT_W = 9360;

const h1 = t => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const h2 = t => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const h3 = t => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const p = (t, o = {}) => new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: t, ...o })] });
const bullet = t => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 40 }, children: [new TextRun(t)] });
const codePara = line => new Paragraph({
  spacing: { before: 0, after: 0, line: 260, lineRule: 'exact' },
  shading: { fill: 'F5F7FA', type: ShadingType.CLEAR },
  children: [new TextRun({ text: line.length ? line : ' ', font: 'Consolas', size: 15 })],
});
const cell = (w, text, bold, fill) => new TableCell({
  borders, width: { size: w, type: WidthType.DXA },
  shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
  margins: { top: 60, bottom: 60, left: 110, right: 110 },
  children: [new Paragraph({ children: [new TextRun({ text, bold: !!bold, size: 18 })] })],
});
/* **粗体** / `代码` 标记在 Word 里退化为纯文本（保持可读，不做富文本切分） */
const clean = s => s.replace(/\*\*/g, '').replace(/`/g, '').trim();

const md = fs.readFileSync(IN, 'utf8').replace(/\r\n/g, '\n').split('\n');
const children = [];

/* 封面 */
const titleLine = (md.find(l => /^# /.test(l)) || '# 文档').replace(/^# /, '');
children.push(
  new Paragraph({ spacing: { before: 2400 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: titleLine, bold: true, size: 52 })] }),
  ...(SUB ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: SUB, size: 26, color: '555F6E' })] })] : []),
  new Paragraph({ spacing: { before: 160 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: '生成日期：' + new Date().toISOString().slice(0, 10) + '　由 tools/md2docx.cjs 渲染', size: 20, color: '8a93a3' })] }),
  new Paragraph({ children: [new PageBreak()] }),
  h1('目录'), new TableOfContents('目录', { hyperlink: true, headingStyleRange: '1-2' }),
  new Paragraph({ children: [new PageBreak()] }),
);

let i = 1;                       // 跳过已做封面的第一行标题
while (i < md.length) {
  const line = md[i];

  /* 代码块 */
  if (/^```/.test(line)) {
    i++;
    while (i < md.length && !/^```/.test(md[i])) { children.push(codePara(md[i])); i++; }
    i++;
    continue;
  }
  /* 表格 */
  if (/^\s*\|/.test(line)) {
    const rows = [];
    while (i < md.length && /^\s*\|/.test(md[i])) {
      const cells = md[i].trim().replace(/^\||\|$/g, '').split('|').map(s => clean(s));
      if (!cells.every(c => /^:?-{2,}:?$/.test(c) || c === '')) rows.push(cells);
      i++;
    }
    if (rows.length) {
      const cols = Math.max(...rows.map(r => r.length));
      const w = Math.floor(CONTENT_W / cols);
      children.push(new Table({
        width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: rows[0].map(() => w),
        rows: rows.map((r, ri) => new TableRow({
          children: Array.from({ length: cols }, (_, ci) => cell(w, r[ci] || '', ri === 0, ri === 0 ? 'DCE6F1' : undefined)),
        })),
      }));
      children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun('')] }));
    }
    continue;
  }
  if (/^### /.test(line)) { children.push(h3(clean(line.slice(4)))); i++; continue; }
  if (/^## /.test(line)) { children.push(h2(clean(line.slice(3)))); i++; continue; }
  if (/^# /.test(line)) { children.push(new Paragraph({ children: [new PageBreak()] }), h1(clean(line.slice(2)))); i++; continue; }
  if (/^---+$/.test(line.trim())) { children.push(new Paragraph({ children: [new PageBreak()] })); i++; continue; }
  if (/^\s*[-*] /.test(line)) { children.push(bullet(clean(line.replace(/^\s*[-*] /, '')))); i++; continue; }
  if (/^\s*\d+\. /.test(line)) { children.push(bullet(clean(line.replace(/^\s*\d+\. /, '')))); i++; continue; }
  if (!line.trim()) { i++; continue; }
  children.push(p(clean(line)));
  i++;
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 21 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, font: 'Arial', color: '1F3864' },
        paragraph: { spacing: { before: 260, after: 180 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 25, bold: true, font: 'Arial', color: '2E75B6' },
        paragraph: { spacing: { before: 200, after: 140 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 22, bold: true, font: 'Arial', color: '404040' },
        paragraph: { spacing: { before: 160, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [{ reference: 'bullets', levels: [{ level: 0, format: 'bullet', text: '•', alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 560, hanging: 280 } } } }] }],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1200, right: 1100, bottom: 1200, left: 1100 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: '太空杀 · 技术文档 — 第 ', size: 16, color: '8a93a3' }),
      new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '8a93a3' }),
      new TextRun({ text: ' 页', size: 16, color: '8a93a3' }),
    ] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf);
  console.log('written:', OUT, (buf.length / 1024).toFixed(0) + ' KB');
});
