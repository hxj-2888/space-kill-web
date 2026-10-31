# =============================================================
# gen-qr.py · 安卓安装包下载二维码（构建期生成静态 PNG）
# -------------------------------------------------------------
# 为什么不挂在线二维码服务：不外传访问数据、离线可复现、三站共用同一张图不会漂移。
# 内容恒为 GitHub Release 的稳定直链（不带版本号），换版本不用换二维码：
#   https://github.com/hxj-2888/xin-fan-hang-lu/releases/latest/download/ReturnLog.apk
# 依赖：qrcode + Pillow
# 产出：assets/portfolio/returnlog-qr.png（370×370，深色码 + 白底，与作品集其他二维码同规格）
# =============================================================
import os

import qrcode
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'https://github.com/hxj-2888/space-kill-web/releases/download/returnlog-v3/ReturnLog.apk'
OUT = os.path.join(ROOT, 'assets', 'portfolio', 'returnlog-qr.png')
SIZE = 370


def main():
    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M,
                       box_size=10, border=2)
    qr.add_data(URL)
    qr.make(fit=True)
    img = qr.make_image(fill_color='#141420', back_color='white').convert('RGB')
    img = img.resize((SIZE, SIZE), Image.NEAREST)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT)
    print('qr -> %s (%d bytes)' % (OUT, os.path.getsize(OUT)))


if __name__ == '__main__':
    main()
