# =============================================================
# gen-apk-icon.py · 安卓图标（程序化，风格跟游戏同一套令牌）
# -------------------------------------------------------------
# 设计：深空底 #050A14 + 青绿同心环（呼应首页 departure-ring）+ 中心星尘点 +
#       外圈一撇异形红，一眼能认出是「返航录」而不是通用安卓图标。
# 产出：android/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png
#       assets/portfolio/icon-512.png（作品集用）
# 依赖：Pillow
# =============================================================
import math
import os

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
BASE = 512

BG = (5, 10, 20)
TEAL = (0, 229, 176)
TEAL_DIM = (0, 150, 120)
AMBER = (240, 198, 116)
ALIEN = (224, 87, 79)


def draw_icon(size):
    s = BASE
    img = Image.new('RGBA', (s, s), BG + (255,))
    d = ImageDraw.Draw(img, 'RGBA')
    c = s / 2

    # 外发光：青绿径向（用多层同心圆近似）
    glow = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow, 'RGBA')
    for i in range(60, 0, -1):
        r = s * 0.47 * i / 60
        a = int(2 + 26 * (i / 60) ** 2)
        gd.ellipse([c - r, c - r, c + r, c + r], fill=TEAL + (a,))
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.03))
    img.alpha_composite(glow)

    # 三圈同心环（外粗内细，断口 40°）
    rings = [(0.44, 0.020, 235), (0.31, 0.013, 150), (0.19, 0.009, 90)]
    for rr, lw, alpha in rings:
        r = s * rr
        w = max(2, int(s * lw))
        d.arc([c - r, c - r, c + r, c + r], start=-58, end=302,
              fill=TEAL + (alpha,), width=w)

    # 内环上的一撇异形红：暗示「有东西混进来了」
    r = s * 0.31
    d.arc([c - r, c - r, c + r, c + r], start=196, end=238, fill=ALIEN + (225,),
          width=max(2, int(s * 0.013)))

    # 中心星尘：实心点 + 十字微光 + 琥珀高亮
    d.ellipse([c - s * 0.055, c - s * 0.055, c + s * 0.055, c + s * 0.055], fill=TEAL + (255,))
    d.ellipse([c - s * 0.022, c - s * 0.022, c + s * 0.022, c + s * 0.022], fill=(235, 255, 250, 255))
    for ang in (0, 90, 180, 270):
        a = math.radians(ang)
        d.line([c + math.cos(a) * s * 0.065, c + math.sin(a) * s * 0.065,
                c + math.cos(a) * s * 0.115, c + math.sin(a) * s * 0.115],
               fill=AMBER + (170,), width=max(1, int(s * 0.008)))

    # 四个方向的短刻度：像航向标
    for ang in (45, 135, 225, 315):
        a = math.radians(ang)
        d.line([c + math.cos(a) * s * 0.36, c + math.sin(a) * s * 0.36,
                c + math.cos(a) * s * 0.395, c + math.sin(a) * s * 0.395],
               fill=TEAL + (110,), width=max(1, int(s * 0.007)))

    if size != s:
        img = img.resize((size, size), Image.LANCZOS)
    return img


def main():
    for dpi, px in SIZES.items():
        out = os.path.join(ROOT, 'android', 'res', 'mipmap-' + dpi)
        os.makedirs(out, exist_ok=True)
        draw_icon(px).save(os.path.join(out, 'ic_launcher.png'))
        print('icon %-8s %dpx' % (dpi, px))
    port = os.path.join(ROOT, 'assets', 'portfolio')
    os.makedirs(port, exist_ok=True)
    draw_icon(512).save(os.path.join(port, 'icon-512.png'))
    print('icon 512 -> assets/portfolio/icon-512.png')


if __name__ == '__main__':
    main()
