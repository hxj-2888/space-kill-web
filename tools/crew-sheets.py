# 把 tools/_crew_raw 的 192×320 渲染帧拼成 384×800 的 4×5 角色行走图。
# 用法：python tools/crew-sheets.py [--test] [--seats 1,2]
import os, sys, json, shutil
from PIL import Image, ImageEnhance

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'tools', '_crew_raw')
CREW = os.path.join(ROOT, 'assets', 'scene', 'crew')
BAK = os.path.join(CREW, '_pixel-backup')
ARGS = sys.argv[1:]
TEST = '--test' in ARGS
SEATS = None
if '--seats' in ARGS:
    i = ARGS.index('--seats')
    SEATS = {int(x) for x in ARGS[i + 1].split(',')}

ROW = [('down', 0), ('up', 1), ('idle', 2), ('left', 3), ('right', 4)]


def grade(src):
    """轻微压暗 + 降饱和 + 冷色偏移：让 Blender 角色贴近深蓝色船舱底色。"""
    rgb = src.convert('RGB')
    rgb = ImageEnhance.Brightness(rgb).enhance(0.90)
    rgb = ImageEnhance.Color(rgb).enhance(0.88)
    rgb = ImageEnhance.Contrast(rgb).enhance(1.05)
    r, g, b = rgb.split()
    r = r.point(lambda x: min(255, int(x * 0.95)))
    g = g.point(lambda x: min(255, int(x * 0.98)))
    b = b.point(lambda x: min(255, int(x * 1.02)))
    rgb = Image.merge('RGB', (r, g, b))
    return Image.merge('RGBA', (*rgb.split(), src.getchannel('A')))

manifest = json.load(open(os.path.join(CREW, 'manifest.json'), encoding='utf-8'))
os.makedirs(BAK, exist_ok=True)
os.makedirs(os.path.join(ROOT, 'tools', '_crew_sheets_test'), exist_ok=True)

for cfg in manifest['seats']:
    seat = cfg['seat']
    if TEST and seat != 1:
        continue
    if SEATS and seat not in SEATS:
        continue
    dst = os.path.join(CREW, cfg['file'])
    if os.path.exists(dst) and not os.path.exists(os.path.join(BAK, cfg['file'])):
        shutil.copy2(dst, os.path.join(BAK, cfg['file']))
    sheet = Image.new('RGBA', (384, 800), (0, 0, 0, 0))
    for name, row in ROW:
        for fr in range(4):
            p = os.path.join(RAW, 's%02d_%s_%d.png' % (seat, name, fr))
            if not os.path.exists(p):
                raise SystemExit('missing ' + p)
            im = Image.open(p).convert('RGBA')
            im = im.resize((96, 160), Image.LANCZOS)
            im = grade(im)
            sheet.paste(im, (fr * 96, row * 160), im)
    out = os.path.join(ROOT, 'tools', '_crew_sheets_test', cfg['file']) if (TEST or SEATS) else dst
    sheet.save(out)
    print('sheet', out, 'alpha bbox', sheet.getbbox())
