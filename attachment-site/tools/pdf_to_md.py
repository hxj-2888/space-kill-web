#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pdf_to_md.py — 规则正文 PDF → 站点用 Markdown

用途：把《太空杀V6.6正文_v66修订版》PDF 抽成 Markdown，作为附件站 rules 页的新来源，
      替换旧的「公测 3.0 规则.md」。抽取只做版式还原（标题/列表/段落），不做任何改写。

已知坑：PDF 首页是三栏目录，pdfplumber 按视觉行输出会把三栏串成一行（读起来是乱的）。
      故默认跳过首页（--keep-toc 可保留），正文页抽取质量正常、条款号完整。

用法: python tools/pdf_to_md.py <输入.pdf> <输出.md> [--keep-toc]
"""
import os
import re
import sys

import pdfplumber

RE_CHAPTER = re.compile(r'^第[0-9一二三四五六七八九十百零两]+[章节篇部回]')
RE_SUB = re.compile(r'^\d+\.\d+[^0-9]')
RE_SECTION = re.compile(r'^[一二三四五六七八九十]+、')
RE_HR = re.compile(r'^[—\-*_=]{3,}$')
TITLE = '# 太空杀三阵营对抗规则 · 正文 v6.6（v66 修订版）'


def main():
    src = sys.argv[1]
    dst = sys.argv[2]
    keep_toc = '--keep-toc' in sys.argv
    out = [TITLE, '']
    with pdfplumber.open(src) as pdf:
        pages = pdf.pages if keep_toc else pdf.pages[1:]
        for page in pages:
            txt = page.extract_text() or ''
            for raw in txt.split('\n'):
                line = raw.rstrip()
                if not line.strip():
                    continue
                # 页眉（书名行，带版号后缀如「…正文 v6.6 v6.6」）与页码行直接丢
                if RE_HR.match(line.strip()):
                    continue
                if re.match(r'^太空杀三阵营对抗规则\s*[·・]?\s*正文', line.strip()):
                    continue
                if re.match(r'^\s*[-—–]?\s*\d{1,3}\s*[-—–]?\s*$', line):
                    continue
                s = line.strip()
                # 标题层级：第X章 / 一、 / 1.1（1.1.1 归入同档，站点层级不追求 PDF 目录树）
                if RE_CHAPTER.match(s):
                    out.append('## ' + s)
                elif RE_SECTION.match(s):
                    out.append('### ' + s)
                elif RE_SUB.match(s):
                    out.append('#### ' + s)
                elif re.match(r'^[-•·*]\s*', s):
                    out.append('- ' + re.sub(r'^[-•·*]\s*', '', s))
                else:
                    out.append(s)
                out.append('')
    body = '\n'.join(out)
    # 折叠 3+ 连续空行为 1 个
    body = re.sub(r'\n{3,}', '\n\n', body).strip() + '\n'
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(body)
    print('written: %s  %d 字符 / %d 行' % (dst, len(body), body.count('\n')))


if __name__ == '__main__':
    main()