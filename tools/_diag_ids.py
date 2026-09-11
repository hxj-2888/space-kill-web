# 诊断：提取 ui.js/main.js/view.js 中 el('xxx') 引用的 id，与 index.html 现有 id 对比，找缺失（用后即删）
import io, re

html = io.open('index.html', encoding='utf-8').read()
have = set(re.findall(r'id="([^"]+)"', html))
missing = {}
for f in ['js/ui.js', 'js/main.js', 'js/view.js']:
    s = io.open(f, encoding='utf-8').read()
    for m in re.finditer(r"el\('([^']+)'\)", s):
        mid = m.group(1)
        if mid not in have:
            line = s[:m.start()].count('\n') + 1
            missing.setdefault(f + ':' + mid, []).append(line)
for k, v in sorted(missing.items()):
    print('MISSING', k, 'lines', v[:6])
if not missing:
    print('no missing ids')
