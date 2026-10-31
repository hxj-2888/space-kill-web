# =============================================================
# gen-facility-sprites.py · 设施 2.5D 精灵图（本地 SDXL 出图）
# -------------------------------------------------------------
# 职责：   给游戏内的四件设施出「2.5D 俯视」贴图，让它们和 Blender 烘焙的
#          整船底图（12° 俯角 / 冷调暗金属 / 琥珀+青色指示）长在同一套风格里：
#            medbot  医疗无人机（青绿医疗十字 + 四旋翼）
#            secbot  保安机器人（枪灰装甲 + 橙红警示条 + 扫视灯）
#            monitor 监控台（一墙小屏 + 青绿信号）
#            breaker 电闸（琥珀警示柜 + 大红拉杆）
# 产出：   assets/scene/v4/facility/<name>.png  RGBA 512×512，已去背 + 接地阴影
#          assets/scene/v4/facility/<name>-cN.png  候选图（挑图用，不进游戏）
# 用法：   python tools/gen-facility-sprites.py --only medbot --candidates 3
#          python tools/gen-facility-sprites.py                 # 全部 4 件
#          python tools/gen-facility-sprites.py --pick medbot-c2  # 把候选定为正式图
# 依赖：   本地 SDXL（默认 D:\ai-models\sdxl-base，可用 SDXL_MODEL / SDXL_VAE 覆盖）
# 关键实现（与 gen-materials.py 同一套，别再另写一份）：
#   · UNet 逐张量流式上卡，绕开 diffusers 的 safetensors mmap（16GB 内存机器会段错误）；
#   · 先编码全部提示词，再把两个文本编码器踢出显存，给去噪腾激活空间；
#   · 出图后统一「降饱和 + 冷调 + 提对比」，与底图 base-lit.png 同色温；
#   · 白底出图 → 亮度抠图 + 边缘腐蚀 → 接地软阴影，得到可直接 drawImage 的 RGBA。
# =============================================================
import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'scene', 'v4', 'facility')
MODEL = os.environ.get('SDXL_MODEL', r'D:\ai-models\sdxl-base')
VAE = os.environ.get('SDXL_VAE', r'D:\ai-models\vae-fp16-fix')

# 与 assets/scene/v4/tex 一致的冷暗基调
TINT = (0.84, 0.90, 1.00)

# 四件设施的造型描述。CLIP 只吃 77 token：主体描述在前，风格/白底短语压到最短，
# 否则「2.5d / 白底 / 居中」这些真正决定构图的关键词会被整段截掉（实测踩过）。
COMMON = (', one single centered object, dark gunmetal sci-fi prop, '
          'flat pure white background, no shadow, no reflection, no pattern, no text')
# 视角按设施分别指定：
#   · 无人机/机器人沿用项目里 crew-*.png 的「正/3-4 立绘」语言（俯视底图 + 立绘实体）；
#   · 监控台/电闸要的是「2.5D 俯视」——必须看得见顶面，否则在俯视地图上只剩一条立面。
VIEW_AIR = ', isometric three-quarter top view from above, hovering'
VIEW_UPRIGHT = ', isometric three-quarter view from above, standing'
VIEW_TOP = ', isometric three-quarter top view from above, seeing the top surface'
SPECS = {
    'medbot': (
        'small floating medical rescue drone, four rotor arms, teal-green medical cross emblem '
        'on top plate, cyan status light' + VIEW_AIR + COMMON),
    'secbot': (
        'compact bipedal security guard robot, heavy gunmetal armor, red hazard stripe on shoulder, '
        'glowing red eye lens, stun baton on hip' + VIEW_UPRIGHT + COMMON),
    'monitor': (
        'security monitoring console desk, four small glowing green screens, cyan status lights, '
        'thin cable tray' + VIEW_TOP + COMMON),
    'breaker': (
        'one single tall electrical distribution cabinet, black metal box with amber caution stripe, '
        'one large red lever handle on the front panel, small amber indicator lamp, standing upright'
        + VIEW_TOP + COMMON),
}
NEG = ('drop shadow, cast shadow, soft shadow, reflection, mirror floor, gradient background, '
       'vignette, collage, contact sheet, multiple views, grid of objects, kaleidoscope, '
       'seamless tileable texture, repeating pattern, tile, wallpaper, '
       'text, letters, watermark, logo, human, person, hands, '
       'interior room background, floor, wall, strong perspective, fisheye, '
       'photo, realistic photograph, blurry, low contrast, oversaturated neon, '
       'duplicated object, cropped object, cut off, noise')


# ---------------- SDXL 管线（与 gen-materials.py 同源） ----------------
def stream_safetensors_to_gpu(path, model):
    """逐张量读 safetensors 直接灌进 GPU（见 gen-materials.py 的注释）。"""
    import json
    import struct
    import torch
    from accelerate.utils import set_module_tensor_to_device
    DT = {'F16': torch.float16, 'F32': torch.float32, 'BF16': torch.bfloat16}
    n = 0
    with open(path, 'rb') as f:
        head = struct.unpack('<Q', f.read(8))[0]
        meta = json.loads(f.read(head))
        base = 8 + head
        for name, t in meta.items():
            if name == '__metadata__':
                continue
            b, e = t['data_offsets']
            f.seek(base + b)
            buf = bytearray(f.read(e - b))
            v = torch.frombuffer(buf, dtype=DT[t['dtype']])
            if t['shape']:
                v = v.view(t['shape'])
            set_module_tensor_to_device(model, name, device='cuda', value=v, dtype=torch.float16)
            n += 1
    print('[facility] UNet 流式上卡：%d 个张量' % n)
    return model


def build_pipe():
    import gc
    import torch
    from accelerate import init_empty_weights
    from transformers import AutoTokenizer, CLIPTextModel, CLIPTextModelWithProjection
    from diffusers import (AutoencoderKL, EulerDiscreteScheduler, StableDiffusionXLPipeline,
                           UNet2DConditionModel)
    dt = torch.float16
    vae = AutoencoderKL.from_pretrained(VAE, torch_dtype=dt)
    vae.to('cuda'); vae.enable_slicing(); vae.enable_tiling()
    tok1 = AutoTokenizer.from_pretrained(MODEL, subfolder='tokenizer', use_fast=False)
    tok2 = AutoTokenizer.from_pretrained(MODEL, subfolder='tokenizer_2', use_fast=False)
    te1 = CLIPTextModel.from_pretrained(MODEL, subfolder='text_encoder', torch_dtype=dt,
                                       variant='fp16', use_safetensors=True)
    te1.to('cuda').eval()
    te2 = CLIPTextModelWithProjection.from_pretrained(MODEL, subfolder='text_encoder_2',
                                                      torch_dtype=dt, variant='fp16',
                                                      use_safetensors=True)
    te2.to('cuda').eval()
    gc.collect()
    cfg = UNet2DConditionModel.load_config(MODEL, subfolder='unet')
    with init_empty_weights():
        unet = UNet2DConditionModel.from_config(cfg)
    unet = stream_safetensors_to_gpu(
        os.path.join(MODEL, 'unet', 'diffusion_pytorch_model.fp16.safetensors'), unet)
    unet.eval()
    sched = EulerDiscreteScheduler.from_pretrained(MODEL, subfolder='scheduler')
    pipe = StableDiffusionXLPipeline(vae=vae, text_encoder=te1, tokenizer=tok1,
                                     text_encoder_2=te2, tokenizer_2=tok2, unet=unet,
                                     scheduler=sched, add_watermarker=False)
    pipe.set_progress_bar_config(disable=True)
    pipe.enable_attention_slicing()
    free, total = torch.cuda.mem_get_info()
    print('[facility] 载入后 VRAM free %.2f / %.2f GB' % (free / 1e9, total / 1e9))
    return pipe


def drop_text_encoders(pipe):
    import gc
    import torch
    pipe.text_encoder = None
    pipe.text_encoder_2 = None
    gc.collect(); torch.cuda.empty_cache()
    return pipe


def encode_prompt(pipe, prompt):
    import torch
    pe, npe, pooled, npooled = pipe.encode_prompt(
        prompt=prompt, prompt_2=None, device=torch.device('cuda'),
        num_images_per_prompt=1, do_classifier_free_guidance=True, negative_prompt=NEG)
    return tuple(t.to('cpu') for t in (pe, npe, pooled, npooled))


def denoise(pipe, embeds, seed, steps, size):
    import torch
    pe, npe, pooled, npooled = [t.to('cuda') for t in embeds]
    return pipe(prompt_embeds=pe, negative_prompt_embeds=npe,
                pooled_prompt_embeds=pooled, negative_pooled_prompt_embeds=npooled,
                height=size, width=size, num_inference_steps=steps, guidance_scale=6.5,
                generator=torch.Generator('cuda').manual_seed(seed)).images[0]


# ---------------- 后处理：抠图 / 调色 / 投影 ----------------
def grade(arr, sat=0.35, dim=0.86):
    """降饱和 + 冷调 + 压暗：与底图 base-lit.png 同色温（和 gen-materials 一致）。

    SDXL 出的科幻道具天生偏亮偏青/偏红，直接贴进暗调底图会像「发光贴纸」；
    这里把饱和度压到 35%、整体乘冷调、暗部再压一档，亮度落到和家具同一层级。
    secbot 的红色装甲最抢戏，单独用更低的 sat/dim（见 POST_TUNE）。
    """
    import numpy as np
    a = arr.astype(np.float32) / 255.0
    lum = a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114
    a = lum[..., None] * sat + a * (1.0 - sat)            # 降饱和
    a = a * np.array(TINT, np.float32)                    # 冷调偏蓝
    a = (a - 0.5) * 1.06 + 0.5                            # 提对比
    a = a * dim + 0.015                                   # 整体压暗，贴合底图暗面
    return np.clip(a, 0, 1) * 255.0


# 每件设施单独的调色档：红装甲的保安要压得更狠，医疗无人机保留一点青绿识别度
POST_TUNE = {
    'secbot': (0.26, 0.78),
    'medbot': (0.40, 0.90),
    'monitor': (0.46, 1.02),
    'breaker': (0.34, 0.86),
}


def cutout(img):
    """背景抠图：四角背景色 + 低饱和双判据，从边缘泛洪，只保留最大连通域。

    踩过的坑（都在真图上复现过）：
      · 只用「离白色多远」→ 模特画的浅灰渐变 + 落地投影会整片留下；
      · 加「亮度 > Otsu」→ 无人机中央那块发光的青绿十字亮度也高，被整块挖空。
    最终判据只看「像不像背景」：与四角背景色接近 **且** 低饱和（背景/阴影是灰的，
    机身的青绿/橙红发光件饱和度一定高），再从画面边缘泛洪，物体内部的亮面板
    只要不与画外连通就保得住。最后只留最大连通域（允许 >25% 的第二块），
    模型爱画的分离零件当噪声删掉。
    """
    import numpy as np
    from PIL import Image, ImageFilter
    from collections import deque

    rgb = np.asarray(img.convert('RGB'), np.float32) / 255.0
    h, w = rgb.shape[:2]

    corners = np.array([rgb[0, 0], rgb[0, w - 1], rgb[h - 1, 0], rgb[h - 1, w - 1]])
    bg = np.median(corners, axis=0)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    dist = np.abs(rgb - bg).max(axis=2)
    # 宽松判据：渐变背景/浅灰投影的 dist 会到 0.22~0.30，阈值压太紧会在物体外围
    # 留一圈灰斑；放宽到 0.35 让灰斑直接被判成背景，腐蚀就只做轻的 3px
    # （重腐蚀会把无人机那几条细旋翼臂削断，实测断过）。
    isbg = (dist < 0.35) & (sat < 0.28)
    # 只从边缘连通的背景算「外面」：物体内部的同色区域不该被挖空
    seen = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if isbg[y, x] and not seen[y, x]:
                seen[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if isbg[y, x] and not seen[y, x]:
                seen[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] and isbg[ny, nx]:
                seen[ny, nx] = True; q.append((ny, nx))
    alpha = (~seen).astype(np.float32)

    # 只留最大连通域（+ 面积 >25% 的第二块，允许「旋翼臂上的独立桨叶」这种合理拆分）
    lab = np.zeros((h, w), np.int32)
    areas = {}
    cur = 0
    for sy in range(h):
        for sx in range(w):
            if alpha[sy, sx] < 0.5 or lab[sy, sx]:
                continue
            cur += 1
            q = deque([(sy, sx)]); lab[sy, sx] = cur; n = 0
            while q:
                y, x = q.popleft(); n += 1
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and alpha[ny, nx] >= 0.5 and not lab[ny, nx]:
                        lab[ny, nx] = cur; q.append((ny, nx))
            areas[cur] = n
    if areas:
        top = max(areas.values())
        keep = {k for k, v in areas.items() if v >= top * 0.25}
        alpha = np.where(np.isin(lab, list(keep)), 1.0, 0.0).astype(np.float32)

    # 轻腐蚀去背景色溢出 + 回膨胀，最后羽化（重腐蚀会削断旋翼细臂）
    m = Image.fromarray((alpha * 255).astype('uint8'))
    m = m.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    m = m.filter(ImageFilter.GaussianBlur(1.0))
    a2 = np.asarray(m, np.float32) / 255.0
    return Image.fromarray(np.dstack([rgb * 255.0, a2 * 255.0]).astype('uint8'), 'RGBA')


def compose_sprite(cut, size=512, pad=0.06):
    """把抠好的物体摆进正方形画布：等比缩放 + 居中 + 接地软阴影。"""
    import numpy as np
    from PIL import Image, ImageFilter
    bbox = cut.split()[3].getbbox()
    if not bbox:
        return cut.resize((size, size), Image.LANCZOS)
    body = cut.crop(bbox)
    inner = int(size * (1 - pad * 2))
    scale = min(inner / body.width, inner / body.height)
    body = body.resize((max(1, int(body.width * scale)), max(1, int(body.height * scale))),
                       Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ox = (size - body.width) // 2
    oy = (size - body.height) // 2
    # 接地阴影：机身下缘拉一个椭圆模糊，让贴图落在底图上时不发飘
    sh = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sh)
    sw, shh = int(body.width * 0.74), int(body.height * 0.20)
    d.ellipse([size / 2 - sw / 2, oy + body.height - shh * 0.85,
               size / 2 + sw / 2, oy + body.height + shh * 0.55], fill=(0, 0, 0, 110))
    sh = sh.filter(ImageFilter.GaussianBlur(size * 0.022))
    canvas.alpha_composite(sh)
    canvas.alpha_composite(body, (ox, oy))
    return canvas


def pick(sprites_dir, name):
    """把候选图定为正式图（<name>-cN.png → <name>.png）。"""
    import shutil
    src = os.path.join(sprites_dir, name + '.png')
    dst = os.path.join(sprites_dir, name.rsplit('-c', 1)[0] + '.png')
    if not os.path.exists(src):
        print('[ERR] 找不到候选图 %s' % src); return 1
    shutil.copyfile(src, dst)
    print('[facility] %s → %s' % (os.path.basename(src), os.path.basename(dst)))
    return 0


def post_process(names, candidates, raw_dir):
    """后处理单独一段跑：SDXL 管线常驻时系统内存只剩 ~1GB，
    在同一个进程里做抠图会 allocation failed（实测 9MiB 都拿不到）。"""
    import glob
    todo = []
    for f in sorted(glob.glob(os.path.join(raw_dir, '*.png'))):
        n = os.path.basename(f)[:-4]
        base = n.rsplit('-c', 1)[0]
        if names and base not in names:
            continue
        todo.append((base, n, f))
    if not todo:
        print('[ERR] %s 里没有原始图，先跑 --raw 出图' % raw_dir)
        return 1
    import numpy as np
    from PIL import Image
    for base, n, f in todo:
        sat, dim = POST_TUNE.get(base, (0.35, 0.86))
        raw = Image.open(f).convert('RGB')
        graded = Image.fromarray(grade(np.asarray(raw), sat, dim).astype('uint8'), 'RGB')
        cut = cutout(graded)
        sprite = compose_sprite(cut, 512)
        sprite.save(os.path.join(OUT, n + '.png'))
        print('  post %s (sat %.2f / dim %.2f)' % (n + '.png', sat, dim))
    print('[facility] 后处理完成 → %s' % OUT)
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', nargs='*', default=None)
    ap.add_argument('--candidates', type=int, default=2)
    ap.add_argument('--steps', type=int, default=26)
    ap.add_argument('--size', type=int, default=768)
    ap.add_argument('--seed', type=int, default=20261031)
    ap.add_argument('--raw', action='store_true', help='只出图存到 _raw/，后处理留给 --post')
    ap.add_argument('--post', action='store_true', help='只做后处理（读 _raw/）')
    ap.add_argument('--pick', default=None, help='把某个候选（如 medbot-c2）定为正式图')
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    raw_dir = os.path.join(OUT, '_raw')
    if args.pick:
        return pick(OUT, args.pick)
    if args.post:
        return post_process(args.only, args.candidates, raw_dir)

    names = args.only or list(SPECS.keys())
    bad = [n for n in names if n not in SPECS]
    if bad:
        print('[ERR] 未知设施：%s（可选：%s）' % (','.join(bad), ','.join(SPECS)))
        return 2

    os.makedirs(raw_dir, exist_ok=True)
    pipe = build_pipe()
    embeds = {n: encode_prompt(pipe, SPECS[n]) for n in names}
    drop_text_encoders(pipe)

    for n in names:
        for c in range(args.candidates):
            seed = args.seed + c * 977 + len(n) * 37
            img = denoise(pipe, embeds[n], seed, args.steps, args.size)
            suffix = '-c%d' % c
            path = os.path.join(raw_dir, n + suffix + '.png')
            img.convert('RGB').save(path)
            print('  raw %s (seed %d)' % (os.path.basename(path), seed))
            del img
            import gc
            import torch
            gc.collect(); torch.cuda.empty_cache()
    print('[facility] 出图完成 → %s（接着跑 --post 做抠图/调色）' % raw_dir)
    return 0


if __name__ == '__main__':
    sys.exit(main())
