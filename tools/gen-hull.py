# =============================================================
# gen-hull.py · 船体底板（base-lit.png 下面那层深色装甲板）
# -------------------------------------------------------------
# 职责：   生成 assets/scene/v4/hull-deck.png，作为整船底图背后的深色底板；
#          base-lit.png 是透明背景的 2.5D 舱室，外围露出的就是这张板。
# 产出：   assets/scene/v4/hull-deck.png（默认 24 px/格 × 98×82 = 2352×1968）
# 用法：   python tools/gen-hull.py [--scale 24]
# 依赖：   Pillow + numpy（本仓美术工具统一依赖）
# 说明：   纯程序化，不依赖模型；分块装甲板 + 接缝 + 散热格栅 + 管线 +
#          警戒斜纹 + 暗角，色温与 tex/panel-metal.png 一致。
# =============================================================
import argparse
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAP = os.path.join(ROOT, 'js', 'data', 'map.js')
OUT = os.path.join(ROOT, 'assets', 'scene', 'v4', 'hull-deck.png')


def read_bounds():
    src = open(MAP, encoding='utf-8').read()
    i = src.index('"bounds"')
    j = src.index('{', i)
    k = src.index('}', j)
    return json.loads(src[j:k + 1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scale', type=int, default=24, help='每格像素数')
    ap.add_argument('--seed', type=int, default=20261030)
    a = ap.parse_args()
    b = read_bounds()
    W, H = b['w'] * a.scale, b['h'] * a.scale
    rng = np.random.default_rng(a.seed)

    img = Image.new('RGB', (W, H), (11, 14, 18))
    d = ImageDraw.Draw(img, 'RGBA')

    # 装甲板分块：不规则的横竖分割，色阶在 #0b0f13 ~ #1a2028 之间
    y = 0
    rows = []
    while y < H:
        hh = int(rng.integers(90, 260))
        rows.append((y, min(H, y + hh)))
        y += hh
    for (y0, y1) in rows:
        x = 0
        while x < W:
            ww = int(rng.integers(140, 420))
            x1 = min(W, x + ww)
            tone = int(rng.integers(10, 26))
            d.rectangle([x, y0, x1, y1], fill=(tone, tone + 3, tone + 6, 255))
            # 板缝
            d.rectangle([x, y0, x1, y0 + 1], fill=(4, 5, 7, 255))
            d.rectangle([x, y0, x + 1, y1], fill=(4, 5, 7, 255))
            # 高光边
            d.rectangle([x + 2, y1 - 2, x1 - 2, y1 - 1], fill=(38, 44, 52, 90))
            x = x1

    # 散热格栅
    for _ in range(46):
        gx = int(rng.integers(0, W - 60))
        gy = int(rng.integers(0, H - 60))
        gw = int(rng.integers(26, 64))
        gh = int(rng.integers(18, 40))
        d.rectangle([gx, gy, gx + gw, gy + gh], fill=(7, 9, 12, 255))
        for i in range(6):
            yy = gy + 3 + i * (gh - 6) / 6
            d.rectangle([gx + 3, yy, gx + gw - 3, yy + 1], fill=(30, 36, 44, 200))

    # 管线：沿横竖走的暗色管 + 端头法兰
    for _ in range(26):
        if rng.random() < 0.5:
            py = int(rng.integers(0, H))
            x0 = int(rng.integers(0, W - 200))
            x1 = min(W, x0 + int(rng.integers(160, 520)))
            d.rectangle([x0, py, x1, py + 5], fill=(24, 28, 34, 255))
            d.rectangle([x0, py, x1, py + 1], fill=(48, 55, 64, 120))
            for fx in (x0, x1 - 7):
                d.rectangle([fx, py - 3, fx + 7, py + 8], fill=(34, 39, 46, 255))
        else:
            px = int(rng.integers(0, W))
            y0 = int(rng.integers(0, H - 200))
            y1 = min(H, y0 + int(rng.integers(160, 520)))
            d.rectangle([px, y0, px + 5, y1], fill=(24, 28, 34, 255))
            d.rectangle([px, y0, px + 1, y1], fill=(48, 55, 64, 120))
            for fy in (y0, y1 - 7):
                d.rectangle([px - 3, fy, px + 8, fy + 7], fill=(34, 39, 46, 255))

    # 少量警戒斜纹块（和舱内 hazard-stripe 同色系，但压暗）
    for _ in range(9):
        hx = int(rng.integers(0, W - 90))
        hy = int(rng.integers(0, H - 40))
        hw, hh = 84, 26
        d.rectangle([hx, hy, hx + hw, hy + hh], fill=(22, 18, 12, 255))
        for i in range(0, hw + hh, 12):
            d.line([(hx + i, hy + hh), (hx + i - hh, hy)], fill=(58, 44, 20, 210), width=5)

    arr = np.asarray(img).astype(np.float32) / 255.0
    # 大尺度明暗起伏 + 细颗粒
    low = rng.normal(0, 1, (H // 48 + 2, W // 48 + 2)).astype(np.float32)
    low = np.asarray(Image.fromarray(((low * 0.5 + 0.5) * 255).clip(0, 255).astype('uint8'))
                     .resize((W, H), Image.BICUBIC), np.float32) / 255.0 - 0.5
    arr = arr * (1.0 + low[..., None] * 0.35)
    arr += rng.normal(0, 0.012, arr.shape).astype(np.float32)

    # 暗角：四周压暗，让船体轮廓更突出
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    nx = (xx / W - 0.5) * 2
    ny = (yy / H - 0.5) * 2
    vig = np.clip(1.0 - 0.55 * (nx ** 2 + ny ** 2) ** 1.15, 0.25, 1.0)
    arr = arr * vig[..., None]

    arr = np.clip(arr, 0, 1)
    img = Image.fromarray((arr * 255).astype('uint8'))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img.save(OUT)
    print('wrote', OUT, img.size)


if __name__ == '__main__':
    main()
