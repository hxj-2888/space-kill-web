# =============================================================
# gen-materials.py · 家具/掩体材质生成（本地 SDXL 出图）
# -------------------------------------------------------------
# 职责：   为 tools/blender-ship.py 的家具生成表面材质，使掩体与地板/墙面
#          使用同一套「暗色金属 + 琥珀/青色指示」的科幻配色。
# 产出：   assets/scene/v4/tex/panel-metal.png    暗色金属板（机器/柜体/立柱）
#          assets/scene/v4/tex/crate-steel.png    货箱钢板（带磨损与琥珀描边）
#          assets/scene/v4/tex/fabric-weave.png   深色织物（沙发/座椅/床品）
#          assets/scene/v4/tex/table-composite.png 实验台面（暗色磨砂）
#          assets/scene/v4/tex/panel-white.png    医疗设备白色面板
#          assets/scene/v4/tex/ao-soft.png        接地软阴影（RGBA，程序化）
#          assets/scene/v4/tex/hazard-stripe.png  琥珀警戒斜纹（程序化，可平铺）
# 用法：   python tools/gen-materials.py --mode sdxl --size 768 --steps 26
#          python tools/gen-materials.py --mode sdxl --only panel-metal crate-steel
#          python tools/gen-materials.py --mode reuse      # 无显卡兜底：场景素材派生
# 依赖：   本地 SDXL（默认 D:\ai-models\sdxl-base），可用环境变量覆盖：
#            SDXL_MODEL / SDXL_VAE
# 关键实现：· SDXL 的 fp16 UNet 是 5.13GB，diffusers 默认走 safetensors mmap，
#             在 16GB 内存的机器上会在 torch/storage.py 里 access violation 段错误；
#             这里改成"逐张量读文件 + 直接灌进显存"，CPU 峰值只有单个张量。
#           · 先编码所有提示词，再把两个文本编码器踢出显存，给去噪循环腾激活空间
#             （8GB 显存实测 768px 可出图）。
#           · 出图后统一「降饱和 + 冷调 + 四向镜像拼贴 + 回缩 1024」，
#             保证 REPEAT 平铺无接缝，色温压到与现有地板/墙面同一档。
# =============================================================
import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX = os.path.join(ROOT, 'assets', 'scene', 'v4', 'tex')
MODEL = os.environ.get('SDXL_MODEL', r'D:\ai-models\sdxl-base')
VAE = os.environ.get('SDXL_VAE', r'D:\ai-models\vae-fp16-fix')
SIZE = 1024

# 与 assets/scene/v4/tex 现有地板/墙面一致的冷暗基调（线性 0~1）
TINT = (0.80, 0.86, 0.98)

SPECS = {
    'panel-metal': (
        'seamless tileable texture, dark gunmetal spacecraft interior hull plating, '
        'brushed metal with panel seams and small rivets, subtle scratches and dust, '
        'industrial sci-fi surface, flat even studio lighting, no text, no logo, no watermark'),
    'crate-steel': (
        'seamless tileable texture, industrial cargo crate steel panel, dark graphite '
        'ribbed metal surface with worn amber painted edge band, dents and chipped paint, '
        'sci-fi shipping container, flat even lighting, no text, no logo'),
    'fabric-weave': (
        'seamless tileable texture, dark slate teal woven upholstery fabric, tight weave, '
        'slight wear and lint, soft matte, flat even lighting, no text, no pattern repeat artifacts'),
    'table-composite': (
        'seamless tileable texture, dark composite laboratory worktop, fine mineral speckle, '
        'micro scratches, low sheen, sci-fi equipment surface, flat even lighting, no text'),
    'panel-white': (
        'seamless tileable texture, white medical equipment panel, clean matte plastic with '
        'fine grain, subtle grey seam lines, slight scuffs, sci-fi hospital surface, '
        'flat even lighting, no text'),
    'cafeteria-floor': (
        'seamless tileable texture, dark spacecraft cafeteria deck flooring, warm charcoal '
        'terrazzo with fine steel flecks and subtle amber inlay lines, worn but clean, '
        'flat even lighting, no text, no logo, no perspective'),
    'warehouse-floor': (
        'seamless tileable texture, dark industrial spacecraft warehouse floor, reinforced '
        'gunmetal deck plates with worn edges, scuffs and faint amber hazard markings, '
        'flat even lighting, no text, no logo, no perspective'),
    'cafeteria-top': (
        'seamless tileable texture, dark warm composite cafeteria counter top, subtle '
        'speckled stone and brushed metal edge, faint tray rings, matte finish, '
        'flat even lighting, no text, no logo'),
    'warehouse-rack': (
        'seamless tileable texture, heavy industrial warehouse shelving steel, dark graphite '
        'rack uprights with worn amber labels and bolt heads, scratched powder coat, '
        'flat even lighting, no text, no logo'),
    # 舱室专属地板：监控室 / 娱乐室 / 配电室 / 引擎原来两两共用同一张地板，房间读不出身份
    'floor-monitor': (
        'seamless tileable texture, dark spacecraft control room server deck flooring, '
        'charcoal anti-static tile panels with thin cyan inlay seams and small perforated '
        'vent grids, clean and slightly reflective, flat even lighting, no text, no logo, '
        'no perspective'),
    'floor-lounge': (
        'seamless tileable texture, dark spacecraft recreation room flooring, deep slate '
        'carpet tiles with warm amber geometric inlay accents and subtle foot wear patterns, '
        'cozy sci-fi lounge surface, flat even lighting, no text, no logo, no perspective'),
    'floor-power': (
        'seamless tileable texture, dark high voltage electrical room dielectric flooring, '
        'charcoal rubber matting with embossed diamond grid and faded amber caution bands, '
        'scuffed and dusty, flat even lighting, no text, no logo, no perspective'),
    'floor-engine': (
        'seamless tileable texture, dark starship engine room deck, heavy steel grating '
        'panels with oil stains, heat discolouration and bolted edge rails, industrial and '
        'grimy, flat even lighting, no text, no logo, no perspective'),
    # 设施专用（2026-10-31）：电闸柜体面板 / 监控屏幕内容。
    # 这两张是「监控与电闸统一到 2.5D 管线」的关键——材质进 Blender 模型，
    # 而不是在 Canvas 上再叠一张精灵图（那样会和底图里的模型叠成两台设备）。
    'facility-panel': (
        'seamless tileable texture, dark industrial electrical cabinet metal panel, brushed '
        'gunmetal with fine countersunk screws, worn amber edge stripe and chipped paint, '
        'faint scratches dust and fingerprint smudges, sci-fi equipment surface, flat even '
        'lighting, no text, no logo, no perspective'),
    'facility-screen': (
        'seamless tileable texture, sci-fi security monitoring screen contents, very dark glass '
        'with faint teal grid lines, thin data traces and small glowing readout bars, subtle '
        'scanlines and vignette, no readable words, flat even lighting, no logo'),
}
# reuse 模式：家具直接派生自场景已有素材，天然同风格、同精度、同明度层级
REUSE = {
    'panel-metal': ('wall-panel.png', (1.02, 1.08, 1.18), 1.06, 0.030),
    # 货箱用墙板（带拼板/通风口）打底 + 暖色偏置，避免整块警戒斜纹抢戏
    'crate-steel': ('wall-panel.png', (1.22, 1.10, 0.86), 1.02, 0.035),
    'fabric-weave': ('floor-carpet.png', (0.90, 1.02, 1.12), 0.92, 0.020),
    'table-composite': ('floor-steel.png', (1.00, 1.04, 1.10), 1.00, 0.018),
    'panel-white': ('floor-lab.png', (0.92, 0.97, 1.03), 0.98, 0.012),
    'cafeteria-floor': ('floor-steel.png', (1.10, 1.00, 0.88), 1.00, 0.020),
    'warehouse-floor': ('floor-grate.png', (1.04, 1.02, 0.98), 1.02, 0.024),
    'cafeteria-top': ('table-composite.png', (1.10, 1.02, 0.90), 1.00, 0.016),
    'warehouse-rack': ('panel-metal.png', (1.02, 0.96, 0.86), 1.04, 0.028),
    'floor-monitor': ('floor-steel.png', (0.86, 0.98, 1.14), 1.06, 0.016),
    'floor-lounge': ('floor-carpet.png', (1.10, 0.98, 0.90), 0.98, 0.018),
    'floor-power': ('floor-grate.png', (0.96, 0.98, 1.04), 1.08, 0.022),
    'floor-engine': ('floor-grate.png', (1.06, 0.96, 0.84), 1.06, 0.026),
    'facility-panel': ('panel-metal.png', (1.00, 1.02, 1.10), 1.10, 0.020),
    'facility-screen': ('floor-monitor.png', (0.80, 1.06, 1.10), 0.96, 0.014),
}
NEG = ('text, letters, watermark, logo, photograph of a room, furniture object, '
       'strong perspective, glossy reflection, bright saturated color, blur, noise bands')


# ---------------- 程序化贴图 ----------------
def procedural_ao(path):
    """接地软阴影：中间实、边缘羽化的圆角矩形 alpha 遮罩（黑色 RGB）。"""
    from PIL import Image, ImageDraw, ImageFilter
    s = 512
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = int(s * 0.16)
    d.rounded_rectangle([m, m, s - m, s - m], radius=int(s * 0.14), fill=(0, 0, 0, 210))
    img = img.filter(ImageFilter.GaussianBlur(34))
    a = img.split()[3].point(lambda v: int(v * 0.85))
    img.putalpha(a)
    img.save(path)
    print('  wrote', os.path.basename(path))


def procedural_hazard(path):
    """琥珀警戒斜纹：45° 条纹 + 磨损噪点，整数周期保证可平铺。"""
    import math
    import numpy as np
    from PIL import Image
    s = 512
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
    period = 64.0
    t = ((xx + yy) % period) / period
    stripe = (t < 0.5)
    base = np.array([20, 19, 17], np.float32) / 255.0
    amber = np.array([126, 84, 26], np.float32) / 255.0
    img = np.where(stripe[..., None], amber[None, None, :], base[None, None, :])
    # 磨损：低频噪声 + 高频颗粒
    rng = np.random.default_rng(20261029)
    grain = rng.normal(0.0, 0.055, (s, s, 1)).astype(np.float32)
    big = rng.normal(0.0, 1.0, (16, 16, 1)).astype(np.float32)
    from PIL import Image as I
    bigim = I.fromarray(((big[..., 0] * 0.5 + 0.5) * 255).astype('uint8')).resize((s, s), I.BICUBIC)
    lowc = (np.asarray(bigim, np.float32)[..., None] / 255.0 - 0.5) * 0.30
    img = np.clip(img * (1.0 + grain + lowc), 0, 1)
    Image.fromarray((img * 255).astype('uint8')).convert('RGB').save(path)
    print('  wrote', os.path.basename(path))


# ---------------- 后处理 ----------------
def grade(arr):
    """降饱和 + 冷调，让 AI 素材与场景同色温、同明度层级（不要比地板亮）。"""
    import numpy as np
    a = arr.astype(np.float32) / 255.0
    lum = (a[..., 0:1] * 0.299 + a[..., 1:2] * 0.587 + a[..., 2:3] * 0.114)
    a = lum * 0.52 + a * 0.48
    a = (a - 0.5) * 0.92 + 0.44
    a = a * np.array(TINT, np.float32)[None, None, :]
    rng = np.random.default_rng(7)
    a = a + rng.normal(0.0, 0.012, a.shape).astype(np.float32)
    return (np.clip(a, 0, 1) * 255.0).astype(np.uint8)


def mirror_tile(arr, out_size):
    """四向镜像拼成 2×2 后回缩，REPEAT 平铺时不会出现接缝。"""
    import numpy as np
    from PIL import Image
    h, w = arr.shape[:2]
    left = np.concatenate([arr, arr[:, ::-1]], axis=1)
    top = np.concatenate([left, left[::-1]], axis=0)
    im = Image.fromarray(top)
    im = im.resize((out_size, out_size), Image.BOX)
    return np.asarray(im)


def stream_safetensors_to_gpu(path, model):
    """逐张量读 safetensors 并直接灌进 GPU。

    为什么不用 from_pretrained：SDXL 的 fp16 UNet 是 5.13GB，diffusers 走
    safetensors 的 mmap 视图，在本机（16GB 内存 / 空闲 ~4GB）会在
    torch/storage.py __getitem__ 里 access violation 直接段错误。
    这里改成顺序读文件 + 逐个 set_module_tensor_to_device，
    CPU 峰值只有单个张量（几十 KB），9 秒就能把 1680 个张量搬完。
    """
    import json
    import struct
    import torch
    from accelerate.utils import set_module_tensor_to_device
    DT = {'F16': torch.float16, 'F32': torch.float32, 'BF16': torch.bfloat16}
    n_read = 0
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
            set_module_tensor_to_device(model, name, device='cuda', value=v,
                                    dtype=torch.float16)
            n_read += 1
    print('[materials] UNet 流式上卡：%d 个张量' % n_read)
    return model


def build_pipe():
    """分组件加载并全部直接放 GPU；文本编码器在编码完提示词后会再释放出来。"""
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
    te1 = CLIPTextModel.from_pretrained(MODEL, subfolder='text_encoder',
                                        torch_dtype=dt, variant='fp16', use_safetensors=True)
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
    print('[materials] 载入后 VRAM free %.2f / %.2f GB' % (free / 1e9, total / 1e9))
    return pipe


def drop_text_encoders(pipe):
    """提示词编码完就把两个文本编码器踢出显存，给去噪循环腾出激活空间。"""
    import gc
    import torch
    pipe.text_encoder = None
    pipe.text_encoder_2 = None
    gc.collect()
    torch.cuda.empty_cache()
    free, total = torch.cuda.mem_get_info()
    print('[materials] 释放文本编码器后 VRAM free %.2f / %.2f GB' % (free / 1e9, total / 1e9))
    return pipe


def encode_all(pipe, jobs):
    """一次性把所有正/负提示词编码好（此时文本编码器还在显存里）。"""
    outs = []
    for prompt in jobs:
        pe, npe, pooled, npooled = pipe.encode_prompt(
            prompt=prompt, prompt_2=None, device=__import__('torch').device('cuda'),
            num_images_per_prompt=1, do_classifier_free_guidance=True, negative_prompt=NEG)
        outs.append(tuple(t.to('cpu') for t in (pe, npe, pooled, npooled)))
    return outs


def gen_ai(pipe, name, prompt_embeds, seed, steps, size):
    import numpy as np
    import torch
    from PIL import Image
    pe, npe, pooled, npooled = [t.to('cuda') for t in prompt_embeds]
    img = pipe(prompt_embeds=pe, negative_prompt_embeds=npe,
               pooled_prompt_embeds=pooled, negative_pooled_prompt_embeds=npooled,
               height=size, width=size, num_inference_steps=steps, guidance_scale=6.0,
               generator=torch.Generator('cuda').manual_seed(seed)).images[0]
    arr = np.asarray(img.convert('RGB'))
    arr = grade(arr)
    arr = mirror_tile(arr, SIZE)
    Image.fromarray(arr).save(os.path.join(TEX, name + '.png'))
    print('  wrote %s (SDXL %dpx)' % (name + '.png', size))


def detail_pass(name, a):
    """程序化细节：拼板缝 / 铆钉 / 拉丝 / 织纹 / 磨损。

    只用在 reuse 兜底路径上：那条路径直接拿场景已有素材打底，
    补一层规则图案才有"材质精度"，否则家具会糊成一块纯色板。
    """
    import numpy as np
    rng = np.random.default_rng(20261029 + len(name))
    s = a.shape[0]
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)

    def band(coord, period, width, soft=2.0):
        t = (coord % period) / period
        d = np.minimum(t, 1 - t) * period
        return np.clip((width - d) / max(soft, width * 0.5), 0, 1)

    def rivets(x0, y0, step, r=5.0, gain=0.16):
        m = np.zeros((s, s), np.float32)
        for oy in range(0, s, step):
            for ox in range(0, s, step):
                x, y = (x0 + ox) % s, (y0 + oy) % s
                d = np.hypot(xx - x, yy - y)
                m += np.clip(1 - d / r, 0, 1) * gain
                m += np.clip(1 - np.abs(d - r * 1.35) / 1.6, 0, 1) * gain * 0.7
        return np.clip(m, 0, 0.5)

    if name == 'panel-metal':
        seam = band(yy, 256.0, 2.2, 1.4) + band(xx, 512.0, 1.6, 1.2)
        a -= seam[..., None] * 0.16
        a += rivets(64, 128, 128)[..., None]
        brush = rng.normal(0, 1, (1, s)).astype(np.float32)
        a += np.repeat(brush, s, 0)[..., None] * 0.030
        a += band(xx, 128.0, 0.9, 0.8)[..., None] * 0.02
    elif name == 'crate-steel':
        rib = band(xx, 86.0, 5.0, 3.0)
        a += rib[..., None] * 0.10
        a -= band(yy, 341.0, 2.0, 1.4)[..., None] * 0.14
        a += rivets(30, 30, 86, r=4.2, gain=0.14)[..., None]
        wear = rng.normal(0, 1, (s // 8 + 1, s // 8 + 1)).astype(np.float32)
        from PIL import Image as _I
        big = _I.fromarray(((wear * 0.5 + 0.5) * 255).clip(0, 255).astype('uint8')).resize((s, s), _I.BICUBIC)
        a += (np.asarray(big, np.float32)[..., None] / 255.0 - 0.5) * 0.10
    elif name == 'fabric-weave':
        w1 = np.sin(xx * (np.pi / 1.6)) * 0.5 + 0.5
        w2 = np.sin(yy * (np.pi / 1.6)) * 0.5 + 0.5
        a += (w1 * 0.5 + w2 * 0.5 - 0.5)[..., None] * 0.075
        a += rng.normal(0, 0.022, (s, s, 1)).astype(np.float32)
    elif name == 'table-composite':
        a += rng.normal(0, 0.018, (s, s, 1)).astype(np.float32)
        speck = (rng.random((s, s)).astype(np.float32) > 0.9985).astype(np.float32)
        a += speck[..., None] * 0.10
        a -= band(xx, 512.0, 1.2, 1.0)[..., None] * 0.05
        a -= band(yy, 512.0, 1.2, 1.0)[..., None] * 0.05
    elif name == 'panel-white':
        a -= band(yy, 341.0, 1.6, 1.2)[..., None] * 0.10
        a -= band(xx, 341.0, 1.6, 1.2)[..., None] * 0.07
        a += rivets(40, 40, 170, r=3.4, gain=0.07)[..., None]
        a += rng.normal(0, 0.010, (s, s, 1)).astype(np.float32)
    return np.clip(a, 0, 1)


def gen_reuse(name):
    """从场景既有素材派生：同一套图素 ⇒ 家具与地板/墙面天然同风格、同精度。"""
    import numpy as np
    from PIL import Image
    src, tint, contrast, grain = REUSE[name]
    p = os.path.join(TEX, src)
    if not os.path.exists(p):
        print('  [skip] 缺源素材', src)
        return False
    a = np.asarray(Image.open(p).convert('RGB')).astype(np.float32) / 255.0
    lum = (a[..., 0:1] * 0.299 + a[..., 1:2] * 0.587 + a[..., 2:3] * 0.114)
    a = lum * 0.50 + a * 0.50                       # 轻度去色，保留素材本身的色相
    a = np.clip((a - 0.5) * contrast + 0.5, 0, 1)
    a = a * np.array(tint, np.float32)[None, None, :]
    rng = np.random.default_rng(11 + len(name))
    a = a + rng.normal(0.0, grain, a.shape).astype(np.float32)
    a = detail_pass(name, a)
    Image.fromarray((a * 255).astype('uint8')).save(os.path.join(TEX, name + '.png'))
    print('  wrote %s (派生自 %s + 程序化细节)' % (name + '.png', src))
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', nargs='*', default=[])
    ap.add_argument('--steps', type=int, default=28)
    ap.add_argument('--size', type=int, default=768,
                    help='SDXL 出图边长（8GB 显存建议 768；512 更稳，1024 需要更大显存）')
    ap.add_argument('--seed', type=int, default=20261029)
    ap.add_argument('--mode', choices=('sdxl', 'reuse'), default='sdxl',
                    help='sdxl=本地 SDXL 出图（默认，失败自动退回派生）；'
                         'reuse=直接从场景已有素材派生（不吃显卡）')
    a = ap.parse_args()
    os.makedirs(TEX, exist_ok=True)

    procedural_ao(os.path.join(TEX, 'ao-soft.png'))
    procedural_hazard(os.path.join(TEX, 'hazard-stripe.png'))
    names = [n for n in (a.only or list(SPECS)) if n in SPECS]

    if a.mode == 'reuse':
        for n in names:
            gen_reuse(n)
        return 0

    try:
        import torch
        if not torch.cuda.is_available():
            raise RuntimeError('no cuda')
        pipe = build_pipe()
    except Exception as e:
        import traceback; traceback.print_exc()
        print('[materials] SDXL 不可用（%s：%s），改用场景素材派生' % (type(e).__name__, e))
        for n in names:
            gen_reuse(n)
        return 0

    embeds = encode_all(pipe, [SPECS[n] for n in names])
    drop_text_encoders(pipe)
    for n, emb in zip(names, embeds):
        try:
            gen_ai(pipe, n, emb, a.seed + len(n), a.steps, a.size)
        except Exception as e:
            print('  SDXL 出图失败 %s（%s），改用派生' % (n, e))
            gen_reuse(n)
    return 0


if __name__ == '__main__':
    sys.exit(main())
