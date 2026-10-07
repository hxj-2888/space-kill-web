#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build_site.py — 太空杀静态站生成器
规则取 测试3.1 的 v66 修订版抽取稿（由 tools/pdf_to_md.py 从权威 PDF 抽出，勿手改），
剧情（三条胜利线）取 剧情/ 的 docx，统一转成 site/ 下的静态 HTML。
只用标准库 + python-docx；只收录「剧情 / 规则」，其余文档（调试、模拟、策略）不入站。
用法: python tools/build_site.py
"""
import html
import os
import re
import shutil
import sys

import docx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC2 = os.path.join(ROOT, '剧情')
SRC3 = os.path.join(ROOT, '公测3.0')
OUT = os.path.join(ROOT, 'site')

# 规则正文：唯一权威源是《太空杀V6.6正文_v66修订版》PDF，站点展示其抽取稿
RULES_MD = os.path.join('公测3.1', '太空杀V6.6正文_v66修订版_规则.md')
# PDF 原件随站分发（在线阅读 / 下载），构建时复制到 site/
RULES_PDF_SRC = os.path.join(SRC2, '太空杀V6.6正文_v66修订版.pdf')
RULES_PDF_NAME = '太空杀V6.6正文_v66修订版.pdf'

DOCS = [
    # (来源路径, 输出文件名, 栏目, 短标题, 副标题, 转换器)
    (RULES_MD, 'rules.html', 'rules',
     '游戏规则', '三阵营对抗 · 正文 v6.6（v66 修订版）', 'md'),
    (os.path.join('剧情', '人类胜利线.docx'), 'story-human.html', 'story',
     '星途归航 · 人类胜利线', '剧情 · 最终版', 'docx'),
    (os.path.join('剧情', '外星人胜利线.docx'), 'story-alien.html', 'story',
     '星途归航 · 外星人胜利线', '剧情 · 修订版', 'docx'),
    (os.path.join('剧情', '异形胜利线.docx'), 'story-xeno.html', 'story',
     '星途归航 · 异形胜利线', '剧情', 'docx'),
]

# 平衡性模拟成果（测试3.1 最新策略层升级）——最新版官网展示，取缔旧版模拟文档
SIM31 = [
    # (来源路径, 输出文件名, 短标题, 副标题)
    (os.path.join('公测3.1', 'sim_output', '策略矩阵报告.md'), 'sim31-matrix.html',
     '策略矩阵报告', '测试 3.1 · 18 组合 × 2000 局 · 异形三流派与均衡解'),
    (os.path.join('公测3.1', 'sim_output', '异形流派核验.md'), 'sim31-flows.html',
     '异形流派核验', '测试 3.1 · 击杀 / 破坏 / 感染 · 12/12 行为判据'),
    # 网页版引擎的大规模蒙特卡洛（由 tools/gen_mc_report.py 从原始 JSON 生成，勿手改数字）
    (os.path.join('公测3.1', 'sim_output', '蒙特卡洛10000局.md'), 'mc-10000.html',
     '蒙特卡洛模拟 · 10000 局', '网页版引擎离线跑完整对局 · 胜负 / 节奏 / 证据链'),
    (os.path.join('公测3.1', 'sim_output', 'cross_convergence.md'), 'sim31-cross.html',
     '策略交叉收敛报告', '测试 3.1 · 12 组合交叉对打 · Phase A/B 收敛验证'),
]

# 公测3.1 的静态成品随站分发（自包含 HTML / 原始数据），构建时复制——
# 与二维码同理：必须由构建产出，否则「产物可由源确定性重建」门禁失败
SIM31_STATIC = [
    # (来源路径, 输出文件名, 缺失时的处理)
    (os.path.join('公测3.1', 'sim_output', 'report.html'), 'sim31-report.html'),
    (os.path.join('公测3.1', 'sim_output', 'perspective_report.csv'), 'sim31-perspective.csv'),
]

RE_CHAPTER = re.compile(r'^第[0-9一二三四五六七八九十百零两]+[章节篇部回]')
RE_SUB = re.compile(r'^\d+\.\d+[^0-9]')
RE_SECTION = re.compile(r'^[一二三四五六七八九十]+、')
HR_SET = {'---', '———', '————', '***', '***'}


def is_short_label(text):
    """无标点结尾的短行视为小节标题（如「前情提要」「尾声」）。"""
    t = text.strip()
    if len(t) > 30:
        return False
    if t.startswith(('“', '"', '「', '『')):  # 对话行不是标题
        return False
    if t.endswith(('。', '！', '？', '；', '，', '、', '：', '"', '”')):
        return False
    return True


def docx_to_fragment(path):
    """docx → (title, body_html)。启发式：首行为 h1，章节/短标签行转标题。"""
    d = docx.Document(path)
    title = ''
    body = []
    first = True
    for p in d.paragraphs:
        text = p.text.strip()
        if not text:
            continue
        if first:
            title = text
            body.append('<h1>' + html.escape(text) + '</h1>')
            first = False
            continue
        if text in HR_SET:
            body.append('<hr>')
            continue
        if RE_CHAPTER.match(text) or RE_SUB.match(text) or RE_SECTION.match(text):
            body.append('<h2>' + html.escape(text) + '</h2>')
            continue
        if is_short_label(text):
            body.append('<h2>' + html.escape(text) + '</h2>')
            continue
        body.append('<p>' + html.escape(text) + '</p>')
    return title, '\n'.join(body)


PAGE_TMPL = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} · 太空杀</title>
<meta name="description" content="{desc}">
<style>
:root {{ --bg:#0a0a0f; --card:#141420; --line:#252535; --text:#e0e0ea; --muted:#8888a0; --accent:#818cf8; }}
* {{ margin:0; padding:0; box-sizing:border-box }}
body {{ background:var(--bg); color:var(--text); font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif; line-height:1.9 }}
nav {{ position:sticky; top:0; z-index:10; display:flex; align-items:center; gap:14px; padding:14px 22px; background:rgba(10,10,15,.92); backdrop-filter:blur(8px); border-bottom:1px solid var(--line) }}
nav .brand {{ font-weight:700; letter-spacing:.02em; color:#fff; text-decoration:none; margin-right:auto }}
nav a.tab {{ color:var(--muted); text-decoration:none; font-size:14px; padding:5px 12px; border-radius:999px; transition:.15s }}
nav a.tab:hover {{ color:#fff }}
nav a.tab.on {{ color:#fff; background:var(--line) }}
.wrap {{ max-width:52rem; margin:0 auto; padding:48px 22px 96px }}
.filebox {{ background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px 18px; margin:10px 0; text-decoration:none; color:var(--text); display:block }}
.filebox:hover {{ border-color:var(--accent) }}
.filebox .t {{ font-weight:700; color:#fff }}
.filebox .s {{ color:var(--muted); font-size:13px; margin-top:3px }}
.kicker {{ font-size:12px; letter-spacing:.18em; text-transform:uppercase; color:var(--accent); margin-bottom:10px }}
h1 {{ font-size:clamp(26px,4.6vw,38px); letter-spacing:-.02em; margin-bottom:28px; color:#fff }}
h2 {{ font-size:20px; color:#fff; margin:44px 0 14px; padding-left:12px; border-left:3px solid var(--accent) }}
p {{ margin:12px 0; color:#c9c9d9; font-size:16px }}
hr {{ border:none; border-top:1px solid var(--line); margin:32px 0 }}
table {{ border-collapse:collapse; width:100%; margin:18px 0; font-size:14.5px }}
th, td {{ border:1px solid var(--line); padding:8px 12px; text-align:left; vertical-align:top; color:#c9c9d9 }}
th {{ background:#181826; color:#fff; white-space:nowrap }}
ul, ol {{ margin:12px 0 12px 26px; color:#c9c9d9; font-size:16px }}
li {{ margin:6px 0 }}
blockquote {{ margin:18px 0; padding:12px 18px; border-left:3px solid var(--accent); background:#12121e; border-radius:0 10px 10px 0 }}
blockquote p {{ color:var(--muted); font-size:15px }}
code {{ background:#1c1c2c; border:1px solid var(--line); border-radius:5px; padding:1px 6px; font-size:13.5px; color:#a5b4fc }}
pre {{ background:#12121e; border:1px solid var(--line); border-radius:10px; padding:14px; overflow-x:auto; color:#c9c9d9; font-size:13px }}
.foot {{ margin-top:64px; padding-top:20px; border-top:1px solid var(--line); color:var(--muted); font-size:13px; display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap }}
.foot a {{ color:var(--accent); text-decoration:none }}
</style>
</head>
<body>
<nav>
  <a class="brand" href="index.html">🚀 太空杀 · 星途归航</a>
  <a class="tab{on_story}" href="story-human.html">剧情</a>
  <a class="tab{on_rules}" href="rules.html">规则</a>
  <a class="tab{on_sim}" href="sim31-matrix.html">平衡性</a>
  <a class="tab" href="mc-10000.html">蒙特卡洛</a>
  <a class="tab" href="https://space-kill-web.pages.dev" rel="noopener" target="_blank">可玩网页版 ↗</a>
</nav>
<div class="wrap">
{body}
<div class="foot"><span>太空杀 · 三阵营身份博弈 · 规则正文 v6.6（v66 修订版）</span><span><a href="https://github.com/hxj-2888/space-kill-web/tree/main/attachment-site" rel="noopener" target="_blank">GitHub 源码</a></span></div>
</div>
</body>
</html>
"""

INDEX_TMPL = """
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>太空杀 · 星途归航 — 任务档案终端</title>
<meta name="description" content="太空杀：15 人三阵营身份博弈的剧情、规则 v6.6 与平衡性模拟档案终端。">
<style>
:root{
  --bg:#070C18;
  --panel:#0E172B;
  --panel-2:#111d33;
  --ink:#C8D4E8;
  --dim:#6B7A99;
  --line:#1d2c4a;
  --line-b:#2b3f66;
  --human:#4FD1FF;
  --alien:#FFB547;
  --xeno:#FF4D5E;
  --sto:#A78BFA;
  --dat:#7BD88F;
  --mono:"JetBrains Mono","SFMono-Regular",Menlo,Consolas,monospace;
  --sans:"Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:
    radial-gradient(1100px 620px at 18% -12%, #16294a 0%, transparent 62%),
    radial-gradient(900px 520px at 92% 8%, #1a1430 0%, transparent 60%),
    var(--bg);
  color:var(--ink);
  font-family:var(--sans);
  font-size:15px;
  line-height:1.7;
  min-height:100vh;
  overflow-x:hidden;
}
/* 纯 CSS 星空：多层平铺星点，替代原 canvas 动画（本站 CSP 禁 JS） */
body::before{
  content:"";position:fixed;inset:0;z-index:0;pointer-events:none;
  background-image:
    radial-gradient(1px 1px at 25px 45px, rgba(207,228,255,.9), transparent 2px),
    radial-gradient(1px 1px at 155px 120px, rgba(207,228,255,.55), transparent 2px),
    radial-gradient(1.5px 1.5px at 90px 200px, rgba(207,228,255,.4), transparent 2px),
    radial-gradient(1px 1px at 210px 260px, rgba(207,228,255,.7), transparent 2px);
  background-size:260px 300px, 340px 380px, 420px 460px, 300px 340px;
}
.scan{
  position:fixed;inset:0;z-index:2;pointer-events:none;
  background:repeating-linear-gradient(0deg,rgba(255,255,255,.028) 0 1px,transparent 1px 3px);
  mix-blend-mode:overlay;
}
.vignette{
  position:fixed;inset:0;z-index:2;pointer-events:none;
  background:radial-gradient(120% 90% at 50% 45%,transparent 55%,rgba(0,0,0,.55) 100%);
}
.wrap{position:relative;z-index:3;max-width:1080px;margin:0 auto;padding:clamp(14px,3vw,28px)}

/* ---------- 顶部任务简报条 ---------- */
.brief{
  border:1px solid var(--line);
  background:linear-gradient(180deg,rgba(20,34,62,.9),rgba(10,17,32,.9));
  border-radius:12px;
  padding:14px clamp(14px,3vw,20px);
  display:flex;align-items:center;gap:14px;flex-wrap:wrap;
  position:relative;overflow:hidden;
}
.brief::before{
  content:"";position:absolute;inset:0;pointer-events:none;opacity:.35;
  background-image:
    linear-gradient(rgba(79,209,255,.07) 1px,transparent 1px),
    linear-gradient(90deg,rgba(79,209,255,.07) 1px,transparent 1px);
  background-size:26px 26px;
  -webkit-mask-image:linear-gradient(90deg,#000,transparent 70%);
  mask-image:linear-gradient(90deg,#000,transparent 70%);
}
.brief > *{position:relative}
.dot{
  width:9px;height:9px;border-radius:50%;background:var(--human);
  box-shadow:0 0 10px var(--human);animation:pulse 1.8s ease-in-out infinite;flex:none;
}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.82)}}
.brief h1{margin:0;font-size:clamp(16px,4.4vw,21px);letter-spacing:.14em;font-weight:600}
.brief .sub{font-family:var(--mono);font-size:11.5px;color:var(--dim);letter-spacing:.18em}
.spacer{flex:1 1 auto}
.tag{
  font-family:var(--mono);font-size:11px;letter-spacing:.14em;
  border:1px solid var(--line-b);color:var(--dim);
  padding:3px 9px;border-radius:999px;white-space:nowrap;
}
.tag.on{color:var(--human);border-color:rgba(79,209,255,.45);background:rgba(79,209,255,.07)}

/* ---------- 通用 ---------- */
.num{font-family:var(--mono);letter-spacing:.05em}
.sec{margin-top:clamp(22px,5vw,34px)}
.sec-h{
  display:flex;align-items:center;gap:12px;margin:0 0 14px;
  font-size:12px;letter-spacing:.22em;color:var(--dim);font-family:var(--mono);
}
.sec-h::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--line),transparent)}
.card{
  position:relative;background:var(--panel);border:1px solid var(--line);
  border-radius:10px;padding:16px;overflow:hidden;
}
.card::before,.card::after{
  content:"";position:absolute;width:11px;height:11px;pointer-events:none;
}
.card::before{top:6px;left:6px;border-top:1px solid var(--line-b);border-left:1px solid var(--line-b)}
.card::after{bottom:6px;right:6px;border-bottom:1px solid var(--line-b);border-right:1px solid var(--line-b)}

/* ---------- 阵营配比阵列 ---------- */
.roster{display:grid;grid-template-columns:1fr;gap:14px}
.crew{
  border:1px solid var(--line);border-radius:10px;padding:14px;
  background:linear-gradient(180deg,var(--panel),rgba(8,13,24,.9));
}
.crew-top{display:flex;align-items:baseline;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.crew-name{font-size:14px;letter-spacing:.1em}
.crew-n{font-family:var(--mono);font-size:20px;font-weight:600}
.crew-hint{font-family:var(--mono);font-size:11px;color:var(--dim);letter-spacing:.1em}
.icons{display:flex;flex-wrap:wrap;gap:7px}
.icons svg{width:26px;height:26px;display:block}
.crew.h .crew-n,.crew.h .crew-name{color:var(--human)}
.crew.a .crew-n,.crew.a .crew-name{color:var(--alien)}
.crew.x .crew-n,.crew.x .crew-name{color:var(--xeno)}
.crew.h{border-left:3px solid var(--human)}
.crew.a{border-left:3px solid var(--alien)}
.crew.x{border-left:3px solid var(--xeno)}

/* ---------- 阵营卡片 ---------- */
.factions{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}
.f{
  border:1px solid var(--line);border-radius:10px;background:var(--panel);
  padding:15px;position:relative;overflow:hidden;
}
.f[data-f="human"]{border-left:3px solid var(--human)}
.f[data-f="alien"]{border-left:3px solid var(--alien)}
.f[data-f="xeno"]{border-left:3px solid var(--xeno)}
.f-top{display:flex;align-items:center;gap:8px;margin-bottom:2px}
.f-id{font-family:var(--mono);font-size:10.5px;color:var(--dim);letter-spacing:.16em}
.f-title{font-size:16px;letter-spacing:.08em;margin:0 0 8px}
.f[data-f="human"] .f-title{color:var(--human)}
.f[data-f="alien"] .f-title{color:var(--alien)}
.f[data-f="xeno"] .f-title{color:var(--xeno)}
.f-body{font-size:13.5px;color:#9FB0CC;min-height:96px;white-space:pre-wrap}
.f-body .cur{display:inline-block;width:7px;background:currentColor;animation:blink .9s steps(1) infinite;vertical-align:-1px}
@keyframes blink{50%{opacity:0}}
.stamp{
  position:absolute;top:10px;right:10px;font-family:var(--mono);font-size:9.5px;
  letter-spacing:.18em;color:var(--xeno);border:1px solid rgba(255,77,94,.5);
  padding:2px 6px;border-radius:3px;transform:rotate(6deg);opacity:.85;
}
/* 纯 CSS 解密：hidden checkbox + label，:checked ~ 兄弟选择器（CSP 禁 JS 的替代） */
.f .dc:checked ~ .f-body{filter:none}
.f .dc:checked ~ .stamp{display:none}
.f.locked .f-body{filter:blur(2.4px) brightness(.62);user-select:none}
.btn{
  display:inline-block;margin-top:12px;font-family:var(--mono);font-size:11px;letter-spacing:.14em;
  background:transparent;color:var(--ink);border:1px solid var(--line-b);
  border-radius:6px;padding:6px 12px;cursor:pointer;transition:.2s;
}
.btn:hover{background:rgba(79,209,255,.1);border-color:var(--human);color:var(--human)}

/* ---------- 胜利线线索墙 ---------- */
.wall{overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:6px}
.wall svg{display:block;min-width:860px;width:100%;height:auto}
.wall text{font-family:var(--mono);font-size:11px;fill:var(--dim);letter-spacing:.08em}
.wall .lbl{font-family:var(--sans);font-size:12.5px;letter-spacing:.06em}
.path{fill:none;stroke-width:1.6;stroke-dasharray:1400;stroke-dashoffset:1400;animation:draw 2.4s ease .3s forwards}
@keyframes draw{to{stroke-dashoffset:0}}
.node{fill:#0b1424;stroke-width:1.4}

/* ---------- 档案柜 ---------- */
.files{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
.file{
  display:block;text-decoration:none;color:inherit;
  border:1px solid var(--line);border-radius:10px;background:var(--panel);
  padding:15px;position:relative;overflow:hidden;transition:.25s;
}
.file::after{
  content:">";position:absolute;right:14px;top:50%;transform:translate(10px,-50%);
  font-family:var(--mono);color:var(--human);opacity:0;transition:.25s;font-size:15px;
}
.file:hover{border-color:var(--line-b);background:var(--panel-2);transform:translateY(-2px)}
.file:hover::after{opacity:1;transform:translate(0,-50%)}
.file-id{font-family:var(--mono);font-size:10.5px;color:var(--dim);letter-spacing:.18em}
.file-title{font-size:15px;margin:6px 0 4px;letter-spacing:.04em}
.file-meta{font-family:var(--mono);font-size:11px;color:var(--dim);letter-spacing:.08em}
.badge{
  display:inline-block;font-family:var(--mono);font-size:10px;letter-spacing:.12em;
  border:1px solid var(--line-b);color:var(--dim);padding:1px 6px;border-radius:3px;margin-top:10px;
}
.badge.pdf{color:var(--xeno);border-color:rgba(255,77,94,.4)}
.badge.html{color:var(--human);border-color:rgba(79,209,255,.4)}
.badge.rep{color:var(--alien);border-color:rgba(255,181,71,.4)}
.badge.story{color:var(--sto);border-color:rgba(167,139,250,.4)}
.badge.dat{color:var(--dat);border-color:rgba(123,216,143,.4)}
.badge.app{color:var(--ink);border-color:var(--line-b)}
.badge.live{color:var(--human);border-color:rgba(79,209,255,.4);background:rgba(79,209,255,.07)}

/* ---------- 底部 ---------- */
.status{
  margin:clamp(24px,5vw,36px) 0 10px;border-top:1px solid var(--line);
  padding-top:12px;display:flex;gap:16px;flex-wrap:wrap;
  font-family:var(--mono);font-size:11px;color:var(--dim);letter-spacing:.14em;
}
.status a{color:#818cf8;text-decoration:none}
@media (max-width:600px){
  .icons svg{width:22px;height:22px}
  .f-body{min-height:120px}
}
@media (prefers-reduced-motion: reduce){
  *{animation:none!important;transition:none!important}
  .path{stroke-dashoffset:0}
}
</style>
</head>
<body>
<div class="scan"></div>
<div class="vignette"></div>

<div class="wrap">

  <!-- ===== 顶部任务简报条 ===== -->
  <div class="brief">
    <span class="dot"></span>
    <div>
      <h1>MISSION · 星途归航</h1>
      <div class="sub">CLASSIFIED LEVEL-2 &nbsp;/&nbsp; SECTOR 07-B &nbsp;/&nbsp; CREW <span class="num">15</span></div>
    </div>
    <div class="spacer"></div>
    <span class="tag on">LINK OK</span>
    <span class="tag">BUILD v6.6</span>
    <span class="tag">3 FACTION</span>
  </div>

  <!-- ===== 阵营配比阵列 ===== -->
  <section class="sec">
    <h2 class="sec-h">FILE 00 — 船员编制 / ROSTER</h2>
    <div class="roster">
      <div class="crew h">
        <div class="crew-top">
          <span class="crew-name">人类</span>
          <span class="crew-n num">11</span>
          <span class="crew-hint">HUMAN · 多数方</span>
        </div>
        <div class="icons">
          <svg viewBox="0 0 24 24" fill="none" stroke="#4FD1FF" stroke-width="1.5"><circle cx="12" cy="7" r="3.2"/><path d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/></svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="#4FD1FF" stroke-width="1.5"><circle cx="12" cy="7" r="3.2"/><path d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/></svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="#4FD1FF" stroke-width="1.5"><circle cx="12" cy="7" r="3.2"/><path d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/></svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="#4FD1FF" stroke-width="1.5"><circle cx="12" cy="7" r="3.2"/><path d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/></svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="#4FD1FF" stroke-width="1.5"><circle cx="12" cy="7" r="3.2"/><path d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/></svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="#4FD1FF" stroke-width="1.5"><circle cx="12" cy="7" r="3.2"/><path d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/></svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="#4FD1FF" stroke-width="1.5"><circle cx="12" cy="7" r="3.2"/><path d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/></svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="#4FD1FF" stroke-width="1.5"><circle cx="12" cy="7" r="3.2"/><path d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/></svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="#4FD1FF" stroke-width="1.5"><circle cx="12" cy="7" r="3.2"/><path d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/></svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="#4FD1FF" stroke-width="1.5"><circle cx="12" cy="7" r="3.2"/><path d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/></svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="#4FD1FF" stroke-width="1.5"><circle cx="12" cy="7" r="3.2"/><path d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/></svg>
        </div>
      </div>
      <div class="crew x">
        <div class="crew-top">
          <span class="crew-name">异形</span>
          <span class="crew-n num">03</span>
          <span class="crew-hint">XENO · 潜伏方</span>
        </div>
        <div class="icons">
          <svg viewBox="0 0 24 24" fill="none" stroke="#FF4D5E" stroke-width="1.5"><path d="M12 3c4.5 0 7.5 3.2 7.5 7.6 0 3.2-1.4 5-2.6 6.6-1 1.3-1.4 2.4-1.6 3.8"/><path d="M12 3c-4.5 0-7.5 3.2-7.5 7.6 0 3.2 1.4 5 2.6 6.6 1 1.3 1.4 2.4 1.6 3.8"/><path d="M8.6 12.4 10.2 15M15.4 12.4 13.8 15"/></svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="#FF4D5E" stroke-width="1.5"><path d="M12 3c4.5 0 7.5 3.2 7.5 7.6 0 3.2-1.4 5-2.6 6.6-1 1.3-1.4 2.4-1.6 3.8"/><path d="M12 3c-4.5 0-7.5 3.2-7.5 7.6 0 3.2 1.4 5 2.6 6.6 1 1.3 1.4 2.4 1.6 3.8"/><path d="M8.6 12.4 10.2 15M15.4 12.4 13.8 15"/></svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="#FF4D5E" stroke-width="1.5"><path d="M12 3c4.5 0 7.5 3.2 7.5 7.6 0 3.2-1.4 5-2.6 6.6-1 1.3-1.4 2.4-1.6 3.8"/><path d="M12 3c-4.5 0-7.5 3.2-7.5 7.6 0 3.2 1.4 5 2.6 6.6 1 1.3 1.4 2.4 1.6 3.8"/><path d="M8.6 12.4 10.2 15M15.4 12.4 13.8 15"/></svg>
        </div>
      </div>
      <div class="crew a">
        <div class="crew-top">
          <span class="crew-name">外星人</span>
          <span class="crew-n num">01</span>
          <span class="crew-hint">ALIEN · 第三方</span>
        </div>
        <div class="icons">
          <svg viewBox="0 0 24 24" fill="none" stroke="#FFB547" stroke-width="1.5"><path d="M12 3c3.6 0 5.6 2.6 5.6 5.9 0 4.6-2.5 8.2-5.6 8.2s-5.6-3.6-5.6-8.2C6.4 5.6 8.4 3 12 3Z"/><ellipse cx="9.3" cy="9.4" rx="1.5" ry="2.2" transform="rotate(-18 9.3 9.4)"/><ellipse cx="14.7" cy="9.4" rx="1.5" ry="2.2" transform="rotate(18 14.7 9.4)"/><path d="M12 17v2.4"/></svg>
        </div>
      </div>
    </div>
  </section>

  <!-- ===== 三阵营档案卡 ===== -->
  <section class="sec">
    <h2 class="sec-h">FILE 01-03 — 阵营档案 / FACTIONS</h2>
    <div class="factions">

      <div class="f" data-f="human">
        <div class="f-top"><span class="f-id">FILE-01</span><span class="f-id">· 已解密</span></div>
        <h3 class="f-title">人类 <span class="num" style="font-size:13px">×11</span></h3>
        <div class="f-body">维持飞船各舱段运转，完成维修任务；在会议阶段通过证词与线索比对，找出并放逐潜伏者。人数占优，但信息不对称——每一次错误投票都在削减自己。<span class="cur">&nbsp;</span></div>
      </div>

      <div class="f locked" data-f="xeno">
        <input type="checkbox" id="dc-x" class="dc" hidden>
        <span class="stamp">ENCRYPTED</span>
        <div class="f-top"><span class="f-id">FILE-02</span><span class="f-id">· 权限不足</span></div>
        <h3 class="f-title">异形 <span class="num" style="font-size:13px">×3</span></h3>
        <div class="f-body">以船员身份潜伏于人类之中，在黑暗区淘汰目标并伪造现场；操纵会议议程，让怀疑落在他人身上。生存依赖于叙事——谁的故事更可信，谁就能活到下一轮。</div>
        <label class="btn" for="dc-x">申请解密 ▸</label>
      </div>

      <div class="f locked" data-f="alien">
        <input type="checkbox" id="dc-a" class="dc" hidden>
        <span class="stamp">ENCRYPTED</span>
        <div class="f-top"><span class="f-id">FILE-03</span><span class="f-id">· 权限不足</span></div>
        <h3 class="f-title">外星人 <span class="num" style="font-size:13px">×1</span></h3>
        <div class="f-body">独狼第三方，不属于任一阵营，拥有独立的达成条件与行动节奏。既可以被人类利用，也可以借异形之手清场——真正的变量永远只有一个人。</div>
        <label class="btn" for="dc-a">申请解密 ▸</label>
      </div>

    </div>
  </section>

  <!-- ===== 胜利线线索墙 ===== -->
  <section class="sec">
    <h2 class="sec-h">FILE 04 — 胜利线 / WIN CONDITIONS</h2>
    <div class="card wall">
      <svg viewBox="0 0 900 280" role="img" aria-label="三条胜利线分支图">
        <circle class="node" cx="70" cy="140" r="9" stroke="#2b3f66"/>
        <text x="70" y="170" text-anchor="middle">出发 · DAY 01</text>
        <path class="path" d="M79,140 C210,140 230,44 400,44 L790,44" stroke="#4FD1FF"/>
        <circle class="node" cx="240" cy="80" r="4" stroke="#4FD1FF"/>
        <text x="240" y="66" text-anchor="middle" fill="#4FD1FF">维修推进</text>
        <circle class="node" cx="520" cy="44" r="4" stroke="#4FD1FF"/>
        <text x="520" y="30" text-anchor="middle" fill="#4FD1FF">投票放逐</text>
        <rect x="790" y="28" width="96" height="32" rx="4" fill="#0b1424" stroke="#4FD1FF"/>
        <text class="lbl" x="838" y="48" text-anchor="middle" fill="#4FD1FF">人类胜利</text>
        <path class="path" d="M79,140 C300,140 320,140 790,140" stroke="#FFB547"/>
        <circle class="node" cx="330" cy="140" r="4" stroke="#FFB547"/>
        <text x="330" y="126" text-anchor="middle" fill="#FFB547">外星人暗线</text>
        <circle class="node" cx="600" cy="140" r="4" stroke="#FFB547"/>
        <text x="600" y="126" text-anchor="middle" fill="#FFB547">终局判定</text>
        <rect x="790" y="124" width="96" height="32" rx="4" fill="#0b1424" stroke="#FFB547"/>
        <text class="lbl" x="838" y="144" text-anchor="middle" fill="#FFB547">外星人胜利</text>
        <path class="path" d="M79,140 C210,140 230,236 400,236 L790,236" stroke="#FF4D5E"/>
        <circle class="node" cx="240" cy="200" r="4" stroke="#FF4D5E"/>
        <text x="240" y="222" text-anchor="middle" fill="#FF4D5E">黑暗区淘汰</text>
        <circle class="node" cx="520" cy="236" r="4" stroke="#FF4D5E"/>
        <text x="520" y="258" text-anchor="middle" fill="#FF4D5E">数量压制</text>
        <rect x="790" y="220" width="96" height="32" rx="4" fill="#0b1424" stroke="#FF4D5E"/>
        <text class="lbl" x="838" y="240" text-anchor="middle" fill="#FF4D5E">异形胜利</text>
      </svg>
    </div>
  </section>

  <!-- ===== 档案柜 ===== -->
  <section class="sec">
    <h2 class="sec-h">FILE 05-17 — 规则与模拟档案 / ARCHIVE</h2>
    <div class="files">
      <a class="file" href="rules.html">
        <div class="file-id">FILE-05 · LOG-001</div>
        <div class="file-title">游戏规则 v6.6</div>
        <div class="file-meta">在线阅读 · 全部条款与【消歧】注释</div>
        <div><span class="badge html">HTML</span></div>
      </a>
      <a class="file" href="太空杀V6.6正文_v66修订版.pdf">
        <div class="file-id">FILE-06 · LOG-002</div>
        <div class="file-title">规则正文 PDF</div>
        <div class="file-meta">45 页权威原件 · 打印友好</div>
        <div><span class="badge pdf">PDF</span></div>
      </a>
      <a class="file" href="story-human.html">
        <div class="file-id">FILE-07 · LOG-003</div>
        <div class="file-title">人类胜利线</div>
        <div class="file-meta">星途归航 · 最终版</div>
        <div><span class="badge story">STORY</span></div>
      </a>
      <a class="file" href="story-alien.html">
        <div class="file-id">FILE-08 · LOG-004</div>
        <div class="file-title">外星人胜利线</div>
        <div class="file-meta">星途归航 · 修订版</div>
        <div><span class="badge story">STORY</span></div>
      </a>
      <a class="file" href="story-xeno.html">
        <div class="file-id">FILE-09 · LOG-005</div>
        <div class="file-title">异形胜利线</div>
        <div class="file-meta">寄生、觉醒与破壳之夜</div>
        <div><span class="badge story">STORY</span></div>
      </a>
      <a class="file" href="sim31-matrix.html">
        <div class="file-id">FILE-10 · LOG-006</div>
        <div class="file-title">策略矩阵报告</div>
        <div class="file-meta">测试 3.1 · 18 组合 × 2000 局</div>
        <div><span class="badge rep">REPORT</span></div>
      </a>
      <a class="file" href="sim31-flows.html">
        <div class="file-id">FILE-11 · LOG-007</div>
        <div class="file-title">异形流派核验</div>
        <div class="file-meta">测试 3.1 · 12/12 行为判据</div>
        <div><span class="badge rep">REPORT</span></div>
      </a>
      <a class="file" href="sim31-report.html" target="_blank" rel="noopener">
        <div class="file-id">FILE-12 · LOG-008</div>
        <div class="file-title">认知模型模拟报告</div>
        <div class="file-meta">公测 3.1 · 5000 局 · 95% CI</div>
        <div><span class="badge rep">REPORT</span></div>
      </a>
      <a class="file" href="sim31-cross.html">
        <div class="file-id">FILE-13 · LOG-009</div>
        <div class="file-title">策略交叉收敛报告</div>
        <div class="file-meta">测试 3.1 · Phase A/B</div>
        <div><span class="badge rep">REPORT</span></div>
      </a>
      <a class="file" href="mc-10000.html">
        <div class="file-id">FILE-14 · LOG-010</div>
        <div class="file-title">蒙特卡洛 · 10000 局</div>
        <div class="file-meta">网页版引擎离线完整对局</div>
        <div><span class="badge rep">REPORT</span></div>
      </a>
      <a class="file" href="sim31-perspective.csv" download>
        <div class="file-id">FILE-15 · LOG-011</div>
        <div class="file-title">视角行为数据</div>
        <div class="file-meta">逐动作准确率 / 后验 · CSV</div>
        <div><span class="badge dat">DATA</span></div>
      </a>
      <a class="file" href="space-kill-apk-qr.png">
        <div class="file-id">FILE-16 · LOG-012</div>
        <div class="file-title">安卓下载二维码</div>
        <div class="file-meta">扫码安装 · 版本号在应用内</div>
        <div><span class="badge app">APP</span></div>
      </a>
      <a class="file" href="https://space-kill-web.pages.dev">
        <div class="file-id">FILE-17 · LOG-013</div>
        <div class="file-title">可玩网页版</div>
        <div class="file-meta">浏览器直接开局 · AI 托管</div>
        <div><span class="badge live">LIVE</span></div>
      </a>
    </div>
  </section>

  <div class="status">
    <span>CREW 15</span><span>HUMAN 11</span><span>XENO 03</span><span>ALIEN 01</span>
    <span>BUILD v6.6</span><span class="spacer"></span>
    <a href="https://github.com/hxj-2888/space-kill-web/tree/main/attachment-site">GitHub 源码</a>
    <span>© 星途归航 · 档案终端</span>
  </div>
</div>

</body>
</html>

"""


def md_inline(text):
    """行内 Markdown：转义 + **加粗** + `代码`。"""
    t = html.escape(text, quote=False)
    t = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    return t


def md_to_fragment(path):
    """Markdown → (title, body_html)。支持标题/表格/列表/引用/分隔线/段落。"""
    with open(path, encoding='utf-8') as f:
        lines = f.read().splitlines()
    title = ''
    out = []
    i = 0
    first = True
    while i < len(lines):
        line = lines[i].rstrip()
        if not line.strip():
            i += 1
            continue
        if line.startswith('```'):  # 代码块（规则文本中无，兜底整块收进 pre）
            i += 1
            block = []
            while i < len(lines) and not lines[i].startswith('```'):
                block.append(lines[i])
                i += 1
            i += 1
            out.append('<pre>' + html.escape('\n'.join(block)) + '</pre>')
            continue
        if line.startswith('#'):
            level = len(line) - len(line.lstrip('#'))
            text = line.lstrip('#').strip()
            if first:
                title = text
                out.append('<h1>' + md_inline(text) + '</h1>')
                first = False
            else:
                out.append('<h%d>' % min(level + 1, 4) + md_inline(text) + '</h%d>' % min(level + 1, 4))
            i += 1
            continue
        if set(line.strip()) <= {'-', '*'} and len(line.strip()) >= 3:
            out.append('<hr>')
            i += 1
            continue
        if line.lstrip().startswith('|'):  # 表格（下一行是分隔行）
            rows = []
            while i < len(lines) and lines[i].lstrip().startswith('|'):
                cells = [c.strip() for c in lines[i].strip().strip('|').split('|')]
                if not all(set(c) <= {'-', ':', ' '} for c in cells):
                    rows.append(cells)
                i += 1
            if rows:
                t = ['<table>', '<tr>' + ''.join('<th>' + md_inline(c) + '</th>' for c in rows[0]) + '</tr>']
                for r in rows[1:]:
                    t.append('<tr>' + ''.join('<td>' + md_inline(c) + '</td>' for c in r) + '</tr>')
                t.append('</table>')
                out.append('\n'.join(t))
            continue
        if line.lstrip().startswith('- '):  # 无序列表
            items = []
            while i < len(lines) and lines[i].lstrip().startswith('- '):
                items.append('<li>' + md_inline(lines[i].lstrip()[2:].strip()) + '</li>')
                i += 1
            out.append('<ul>' + ''.join(items) + '</ul>')
            continue
        if re.match(r'^\d+\.\s', line.lstrip()):  # 有序列表
            items = []
            while i < len(lines) and re.match(r'^\d+\.\s', lines[i].lstrip()):
                items.append('<li>' + md_inline(re.sub(r'^\d+\.\s', '', lines[i].lstrip())) + '</li>')
                i += 1
            out.append('<ol>' + ''.join(items) + '</ol>')
            continue
        if line.lstrip().startswith('>'):  # 引用块
            quote = []
            while i < len(lines) and lines[i].lstrip().startswith('>'):
                quote.append(lines[i].lstrip()[1:].strip())
                i += 1
            out.append('<blockquote><p>' + md_inline(' '.join(q for q in quote if q)) + '</p></blockquote>')
            continue
        if first:
            title = line.strip()
            out.append('<h1>' + md_inline(line.strip()) + '</h1>')
            first = False
            i += 1
            continue
        out.append('<p>' + md_inline(line.strip()) + '</p>')
        i += 1
    return title, '\n'.join(out)


def build():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(INDEX_TMPL)
    for rel, out_name, kind, short, sub, conv in DOCS:
        path = os.path.join(ROOT, rel)
        if conv == 'md':
            title, body = md_to_fragment(path)
        else:
            title, body = docx_to_fragment(path)
        on_story = ' on' if kind == 'story' else ''
        on_rules = ' on' if kind == 'rules' else ''
        on_sim = ''
        page = PAGE_TMPL.format(
            title=short, desc=sub, body=body,
            on_story=on_story, on_rules=on_rules, on_sim=on_sim,
        )
        out = os.path.join(OUT, out_name)
        with open(out, 'w', encoding='utf-8') as f:
            f.write(page)
        print('%-40s -> site/%s  (%d paras)' % (rel, out_name, body.count('<p>')))
    # 平衡性模拟成果页（测试3.1）——最新版，取缔旧模拟
    for rel, out_name, short, sub in SIM31:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            print('SKIP(缺文件) %s' % rel)
            continue
        title, body = md_to_fragment(path)
        page = PAGE_TMPL.format(
            title=short, desc=sub, body=body,
            on_story='', on_rules='', on_sim=' on',
        )
        with open(os.path.join(OUT, out_name), 'w', encoding='utf-8') as f:
            f.write(page)
        print('%-40s -> site/%s  (%d paras)' % (rel, out_name, body.count('<p>')))
    # 规则 PDF 原件随站分发（首页有下载卡片）。缺失只告警不失败——抽取稿已足够阅读
    pdf_src = os.path.join(ROOT, RULES_PDF_SRC)
    if os.path.exists(pdf_src):
        pdf_dst = os.path.join(OUT, RULES_PDF_NAME)
        if os.path.exists(pdf_dst):
            os.remove(pdf_dst)          # Windows 上直接 copy2 覆盖会被占用拒绝
        shutil.copy2(pdf_src, pdf_dst)
        print('%-40s -> site/%s  (%.2f MB)' % (RULES_PDF_SRC, RULES_PDF_NAME,
      os.path.getsize(pdf_src) / 1048576.0))
    else:
        print('WARN 规则 PDF 原件缺失，跳过复制：%s' % pdf_src)

    # 安卓下载二维码：随站分发，但它是**静态资源**而非生成产物 ——
    # 必须由构建复制，不能只躺在 site/ 里。否则「产物可由源确定性重建」这道门禁必然失败
    # （重建时 build 不会生成二维码，site/ 里那份会被覆盖掉）。
    # 同时修掉一个线上缺陷：该二维码此前只存在于作品集副本里，附件站自己的 site/ 没有，
    # 首页「扫码下载应用」卡片点进去落到 index.html 回退（Content-Type: text/html，而非图片）。
    APK_QR_SRC = os.path.join(ROOT, 'assets', 'space-kill-apk-qr.png')
    APK_QR_NAME = 'space-kill-apk-qr.png'
    if os.path.exists(APK_QR_SRC):
        qr_dst = os.path.join(OUT, APK_QR_NAME)
        if os.path.exists(qr_dst):
            os.remove(qr_dst)
        shutil.copy2(APK_QR_SRC, qr_dst)
        print('%-40s -> site/%s  (%.2f KB)' % ('assets/' + APK_QR_NAME, APK_QR_NAME,
              os.path.getsize(APK_QR_SRC) / 1024.0))
    else:
        print('WARN 安卓二维码缺失，跳过复制：%s' % APK_QR_SRC)

    # 公测3.1 静态成品（自包含报告 HTML / 原始数据 CSV）：缺失只告警不失败，与 PDF 同策略
    for rel, out_name in SIM31_STATIC:
        src = os.path.join(ROOT, rel)
        if os.path.exists(src):
            dst = os.path.join(OUT, out_name)
            if os.path.exists(dst):
                os.remove(dst)
            shutil.copy2(src, dst)
            print('%-40s -> site/%s  (%.1f KB)' % (rel, out_name, os.path.getsize(src) / 1024.0))
        else:
            print('WARN 公测3.1 静态成品缺失，跳过复制：%s' % src)

    print('SITE_BUILD_OK -> site/')


if __name__ == '__main__':
    sys.exit(build())
