# -*- coding: utf-8 -*-
"""职业速查卡 / 术语表 / 判定流程图 → js/data/rules.js（批 UI-8c）

用户要求：
  · 游戏内直接看三份子文件的内容，不新增站点文件、不嵌 PDF；
  · 不需要一字不差全文，「改写成玩家能看懂的形式」；
  · 把 V6.6 的援引全部移除，以 v1preview1.0 为准。

三条纪律：
  ① **只做抽取 + 排版**，不改写任何判定（红线 5：正文是唯一权威）。
  ② 真源是 PDF；本脚本是派生物生成器，产物可随时重建。
  ③ 产物是纯数据（JSON 结构），零 DOM、零规则 —— UI 只消费。

解析要点（都是量出来的，不是猜的）：
  · 职业卡标题是**普通 7.5pt 行**，形如「工程师人类· 1名（与猎手同席位）」——
    靠字号分不出来（阵营标题才是 9.4pt）。判据用「行内含 人类/异形/外星人
    + · + N名 或 与…同席位」。
  · 字段标签（夜间行动/核心能力/…）是**行内前缀**，不是独立一行
    （PDF 把「夜间行动」与它的内容拼在同一行）。所以按前缀切，不按行切。
  · 术语表是**三列表格**，必须按 x 坐标分列，否则会切出 500 多条碎片。
"""
import io, os, re, sys, json
import fitz

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

SRC = r"C:\Users\ASUS\Documents\xwechat_files\wxid_6zst4zjefbzm22_8cbf\msg\file\2026-10"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'js', 'data', 'rules.js')

PDFS = {
    'card':  '返航录三阵营对抗规则·职业速查卡v1preview1.0.pdf',
    'gloss': '返航录三阵营对抗规则·术语表v1preview1.0.pdf',
    'flow':  '返航录三阵营对抗规则·判定流程图v1preview1.0.pdf',
}

# 卡面字段（顺序固定）。注意 PDF 会把标签与内容拼在一行，故按**前缀**匹配。
FIELDS = ['夜间行动', '核心能力', '额度与到账', '目标限制', '可见性', '封锁',
          '额度', '自救',
          # 摆渡人/保镖∥工匠/验票官∥窃听者 这几张用的是另一组行内标签
          '次数', '对象', '判定基准', '层序', '要点']

# 标题的真实形态（实测第三种）：
#   「保镖 ∕ 工匠人类 · 同属步骤 3 行动位，二者同席位」
#   —— 席位描述可以是任意短句，不能只匹配「N名」或「与…」。
#   判据收成：**以阵营名结尾的「·」之后、整行不超过 70 字**。
# 标题的真实形态（实测四种，**必须都覆盖**）：
#   ① 普通船员（×4 ）人类 · 4 名（…）          —— 名 + 阵营 + · + 名额
#   ② 疫苗研究员人类 · 与生化医师同席位（4.14） —— 名紧贴阵营
#   ③ 保镖 ∕ 工匠人类 · 同属步骤 3 行动位…      —— 席位是任意短句
#   ④ 异形（×3 ）互相知晓队友身份，队内私聊无限制 —— **没有「·」**，说明跟在阵营后
#   ⑤ 外星人（ ×1）独立阵营、隐藏身份；变体席位：… —— 同上，且阵营在括号后
# 所以判据不能要求「·」：只要**以阵营名结尾、且括号里是席位名额**，或**阵营后紧跟说明**都算。
# 上面那条正则宽松到"任何提到阵营名的行都算标题"，实测抓出 49 张假卡。
# 真正的结构信号是：**标题行后面紧跟「项」**（表头）。用它做闸门最稳，
# 因为卡面每张卡都是「标题 / 项 / 口径 / …」这个形状，而正文里没有这种排列。
HEAD_RE = re.compile(
    r'^(.{1,26}?)'
    r'(?:\(\s*×\s*\d+\s*\))?'
    r'(人类|异形|外星人)'
    r'\s*(?:·)?\s*'
    r'(.{0,60})$'
)


def norm(s):
    s = s.replace('\u2212', '-').replace('\u00a0', ' ')
    s = re.sub(r'[ \t]+', ' ', s)
    return s.strip()


def page_rows(page):
    """取 PDF **自带的 line 结构**，不要自己按 y 聚类。
    -------------------------------------------------------------
    第一版用 @round(bbox[1]/3)@ 当行键 —— 3pt 的分桶把「生化医师人类 · 1名」
    和紧邻的正文行并进了同一桶，标题被截成「化医师」，而排在它后面、
    恰好落在别处的「保镖∕工匠」「验票官∕窃听者」等卡则整张丢失。
    实测：那样只认到 9 张卡（应为 13）。
    PDF 的 line 本身已经是"同一基线上的文字"，直接用即可。"""
    out = []
    for b in page.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            t = ''.join(sp['text'] for sp in l['spans'])
            t = norm(t)
            if t:
                out.append(t)
    return out


def parse_cards(doc):
    """一张卡 = 一个标题行 + 其后直到下一个标题行之间的所有行。"""
    lines = []
    for pno in range(doc.page_count):
        rows = page_rows(doc[pno])
        # 去页脚（两种形态都见过：「第1页/共7页」与「第 1 页 / 共 7 页」）
        rows = [r for r in rows if not re.match(r'^第\s*\d+\s*页\s*/\s*共\s*\d+\s*页$', r)]
        lines.extend(rows)

    heads = []
    for i, s in enumerate(lines):
        if len(s) > 70:
            continue
        # 闸门：下一行必须是表头「项」，否则不算卡标题（正文里到处都有阵营名）
        nxt = lines[i + 1] if i + 1 < len(lines) else ''
        if nxt != '项':
            continue
        m = HEAD_RE.match(s)
        if m and m.group(1).strip() and not m.group(1).startswith('●'):
            heads.append((i, norm(m.group(1)), m.group(2), norm(m.group(3))))

    cards = []
    for n, (i, name, fac, seat) in enumerate(heads):
        end = heads[n + 1][0] if n + 1 < len(heads) else len(lines)
        body = lines[i + 1:end]
        fields, notes = {}, []
        cur = None
        buf = []
        for t in body:
            if t.startswith('●'):
                if cur:
                    fields[cur] = norm(''.join(buf)); cur, buf = None, []
                notes.append(norm(t.lstrip('●')))
                continue
            if t in ('项口径', '项', '口径'):
                continue
            # 同席位双职业的卡会用「保镖 · 核心」「工匠 · 额度」这种**子标签**。
            # 它既不是标准字段名，也不能当正文（否则会粘进上一个字段）。
            # 处理：拆成「子职业 + 字段」，字段名去掉前缀后照常归位。
            sub = re.match(r'^(.{2,8})\s*·\s*(核心|额度|要点|次数|对象|判定基准|层序)(.*)$', t)
            if sub:
                if cur:
                    fields[cur] = norm(''.join(buf))
                hitname = sub.group(2)
                cur, buf = hitname, [(sub.group(1) + ' — ' if False else '') + sub.group(3)]
                continue
            # 字段前缀命中？（允许两个标签粘连，取最后一个命中）
            hit = None
            for f in sorted(FIELDS, key=len, reverse=True):
                if t.startswith(f):
                    hit = f
                    break
            if hit:
                if cur:
                    fields[cur] = norm(''.join(buf))
                cur, buf = hit, [t[len(hit):]]
                continue
            if cur:
                buf.append(t)
        if cur:
            fields[cur] = norm(''.join(buf))
        cards.append({
            'name': name, 'faction': fac, 'seat': seat,
            'fields': fields, 'notes': notes,
        })

    # 名字规整：标题里可能粘着席位说明（「外星人（ ×1）独立阵营、隐藏身份；变体席位：…」）。
    # 只保留**职业名本体**，席位说明另存到 seat 字段。
    for c in cards:
        nm = c['name']
        cut = re.split(r'（\s*×|\s*\(', nm)[0].strip()
        if cut:
            c['name'] = cut
        c['seat'] = norm(c['seat'])

    # 同一张卡可能跨页重复（外星人 p5/p6、毒师 p3/p4）：按名字合并，取字段最全的
    best = {}
    for c in cards:
        k = c['name']
        if k not in best:
            best[k] = c
        else:
            old = best[k]
            if len(c['fields']) > len(old['fields']):
                old['fields'] = c['fields']
                old['seat'] = c['seat'] or old['seat']
            old['notes'] = old['notes'] + [n for n in c['notes'] if n not in old['notes']]
    return list(best.values())


def parse_glossary(doc):
    terms = []
    for pno in range(doc.page_count):
        page = doc[pno]
        # 列边界是**量出来的**，不是按比例猜的。
        # 实测（页宽 594.96，p2 的 span 左边界直方图）：
        #   x=30   术语列（23 次）
        #   x=211  含义列（76 次，最长）
        #   x=392  出处列（22 次）
        # 第一版用 W*0.33 / W*0.70 = 196 / 416，含义列被切在 392 之后，
        # 于是「含义」与「出处」合并成一列、术语列也混进了续行。
        c1, c2 = 200.0, 380.0
        rows = {}
        for b in page.get_text('dict')['blocks']:
            for l in b.get('lines', []):
                for sp in l.get('spans', []):
                    t = sp['text'].strip()
                    if not t:
                        continue
                    key = round(sp['bbox'][1] / 3.0)
                    rows.setdefault(key, []).append((sp['bbox'][0], t))
        for k in sorted(rows):
            ws = sorted(rows[k], key=lambda z: z[0])
            name = norm(''.join(w[1] for w in ws if w[0] < c1))
            mean = norm(''.join(w[1] for w in ws if c1 <= w[0] < c2))
            ref = norm(''.join(w[1] for w in ws if w[0] >= c2))
            if re.match(r'^第\d+页', name):
                continue
            if re.match(r'^(返航录|.*术语表|一、|二、|三、|四、|五、|六、|七、|八、)', name):
                continue
            if name and name not in ('术语', '含义（要点 · 例外）', '出处'):
                terms.append({'term': name, 'mean': mean, 'ref': ref})
            elif terms and (mean or ref):
                if mean:
                    terms[-1]['mean'] = norm(terms[-1]['mean'] + mean)
                if ref:
                    terms[-1]['ref'] = norm(terms[-1]['ref'] + ' ' + ref)
    # 丢掉首页的目录性噪声：第一版把导语（「…等相关词条。每条由「术语+含义+出处」三部分构成」）
    # 当成了术语，还配了个假的「含义」列。判据：术语太长/含标点/含叙述词。
    def _junk(t):
        term = t['term']
        if len(term) > 18 or re.search(r'[。，；]', term):
            return True
        if re.search(r'(构成|如下|本表|相关词条)', term):
            return True
        return term in ('含义（要点·例外）', '含义', '出处', '术语')
    return [t for t in terms if t['term'] and t['mean'] and not _junk(t)]


def parse_flow(doc):
    out = []
    for pno in range(doc.page_count):
        rows = page_rows(doc[pno])
        rows = [r for r in rows if not re.match(r'^第\d+页/共\d+页$', r)]
        out.append({
            'page': pno + 1,
            'title': rows[0] if rows else ('第 %d 页' % (pno + 1)),
            'lines': rows[1:],
        })
    return out


def main():
    dc = fitz.open(os.path.join(SRC, PDFS['card']))
    dg = fitz.open(os.path.join(SRC, PDFS['gloss']))
    df = fitz.open(os.path.join(SRC, PDFS['flow']))

    cards = parse_cards(dc)
    glossary = parse_glossary(dg)
    flow = parse_flow(df)

    bad = [c['name'] for c in cards if len(c['fields']) < 4]
    print('职业卡 %d 张 · 术语 %d 条 · 流程图 %d 页' % (len(cards), len(glossary), len(flow)))
    print('字段不足 4 个的卡（解析可疑）：%s' % (bad or '无'))

    data = {
        'version': 'v1preview1.0',
        'source': '返航录三阵营对抗规则 v1preview1.0 · 三份子文件',
        'note': '本文件只呈现 v1preview1.0 口径。',
        'generatedBy': 'tools/gen-rules-data.py',
        'cards': cards,
        'glossary': glossary,
        'flow': flow,
    }
    dc.close(); dg.close(); df.close()

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    js = ('/* 自动生成，请勿手改 —— 改 tools/gen-rules-data.py 后重跑\n'
          ' * 真源：返航录三阵营对抗规则 v1preview1.0（职业速查卡 / 术语表 / 判定流程图）\n'
          ' * 口径：v1preview1.0\n'
          ' */\n'
          '(function (global) {\n'
          "  'use strict';\n"
          '  var DATA = ' + json.dumps(data, ensure_ascii=False, indent=1) + ';\n'
          '  global.SKRules = DATA;\n'
          "})(typeof window !== 'undefined' ? window : globalThis);\n")
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(js)
    print('已生成 %s' % os.path.relpath(OUT, ROOT))
    for c in cards:
        print('   - %-14s %-4s 字段 %d / 备注 %d'
              % (c['name'], c['faction'], len(c['fields']), len(c['notes'])))


if __name__ == '__main__':
    main()
