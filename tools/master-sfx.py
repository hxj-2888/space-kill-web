# =============================================================
# master-sfx.py · 用公共 CC0 素材混出游戏音效
# -------------------------------------------------------------
# 为什么需要这一步：tools/_sfx/ 里留着当年下载的原始 CC0 包，但转成游戏素材时
# 只做了"截取 + 转码"，没有做电平与频段管理。实测（tools/sfx-audit.py）：
#   · rpg 包三条 blade_* 全都在 +1.8 ~ +2.6 dBFS（播放端削顶），
#     且 97~99% 能量在 2kHz 以上 —— 只有"嘶"没有"切"；
#   · 单换一条同源采样解决不了，所以这里把**破风层 + 入肉层**分层混音，
#     再统一归一到短窗 -13 dBFS / 峰值 -3 dBFS。
# 素材全部来自公共领域包，不引入合成音：
#   rpg/  = OpenGameArt「80 CC0 RPG SFX」        CC0
#   许可与来源见 audio/CREDITS.md
# 用法：   python tools/master-sfx.py                 # 混音并写入 audio/
#          python tools/master-sfx.py --out-dir /tmp  # 只写到别处试听
#          python tools/master-sfx.py --list          # 看配方
# 依赖：   numpy + ffmpeg
# =============================================================
import argparse
import os
import subprocess
import sys

import math

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'tools', '_sfx')
SR = 48000
TARGET_RMS_DB = -13.0     # 与 sfx-gun(-15.2) / sfx-metal(-12.0) 同一档听感响度
PEAK_DB = -3.0            # 峰值上限：Vorbis 编码有约 1.5dB 过冲，这里先留足余量

# 配方：每条游戏音效 = 若干「源文件 + 起止 + 延迟 + 增益」层
RECIPES = {
    'sfx-knife-01': [
        dict(src='rpg/blade_03.ogg', a=0.00, b=0.17, at=0.000, gain=0.52),   # 破风（压住高频）
        dict(src='rpg/misc_01.ogg',  a=0.01, b=0.30, at=0.034, gain=1.45),   # 入肉闷响（提上来）
    ],
    'sfx-knife-02': [
        dict(src='rpg/blade_01.ogg', a=0.00, b=0.16, at=0.000, gain=0.92),
        dict(src='rpg/creature_hurt_01.ogg', a=0.04, b=0.24, at=0.046, gain=0.55),
    ],
    # 拉铃报告：原 sfx-notify.ogg（rubberduck 60 CC0 Sci-Fi SFX）实测是**纯静音**，
    # 而 SND.report 的 play() 只有"文件加载失败"才回退到 beep()，
    # 静音文件解码成功 ⇒ 兜底永远不触发，报告一直没有声音。
    # 这里用同一个 CC0 包体系里的双铃叠击补上（报告要压过全场，目标响度略高）。
    'sfx-notify': [
        dict(src='rpg/item_gem_01.ogg', a=0.00, b=0.26, at=0.000, gain=1.00),
        dict(src='rpg/item_gem_02.ogg', a=0.00, b=0.22, at=0.085, gain=0.72),
    ],
    # 枪声：旧文件是 22 Pistol 的第一发，但**开头 140ms 是静音**，听感只剩一段噪声，
    # 和刀风的频段又都在 3~6kHz ⇒ 玩家报告“枪声和刀声一样”。
    # 现在从第一声枪响的瞬态（0.115s）直接起，再叠一层同一发采样降速 + 低通做“炮口闷响”，
    # 枪声变成 低频冲击 + 高频脆响；刀声保持 2kHz 以上的破风 + 入肉。
    'sfx-gun': [
        dict(src='pistol.wav', a=0.115, b=0.455, at=0.000, gain=1.00),
        dict(src='pistol.wav', a=0.115, b=0.340, at=0.006, gain=0.85, rate=0.52, lp=750),
        dict(src='sfx100/sfx100v2_hit_02.ogg', a=0.00, b=0.14, at=0.000, gain=0.42, lp=520),
    ],
    # 结算音：旧 win/lose 是纯静音文件且游戏内没引用；用公共 CC0 包补两个可辨识的提示
    'sfx-win': [
        dict(src='rpg/item_gem_01.ogg', a=0.00, b=0.24, at=0.000, gain=1.00),
        dict(src='rpg/item_gem_02.ogg', a=0.00, b=0.20, at=0.090, gain=0.85),
        dict(src='rpg/item_gem_03.ogg', a=0.00, b=0.22, at=0.185, gain=0.70),
    ],
    'sfx-lose': [
        dict(src='rpg/creature_die_01.ogg', a=0.02, b=0.55, at=0.000, gain=1.00, rate=0.72, lp=1600),
        dict(src='rpg/metal_02.ogg', a=0.00, b=0.45, at=0.030, gain=0.65, rate=0.80),
    ],
    # 交互 / 维修 / 命中 / 脚步：把“只有刀声”的场面补齐
    'sfx-ui': [
        dict(src='sfx100/sfx100v2_lock_open_01.ogg', a=0.00, b=0.10, at=0.000, gain=0.85, lp=5000),
        dict(src='rpg/item_misc_02.ogg', a=0.00, b=0.09, at=0.012, gain=0.45, lp=4500),
    ],
    'sfx-work': [
        dict(src='rpg/metal_02.ogg', a=0.00, b=0.075, at=0.000, gain=0.80, lp=5200),
        dict(src='sfx100/sfx100v2_metal_hit_01.ogg', a=0.00, b=0.05, at=0.010, gain=0.35, lp=6000),
    ],
    'sfx-step-01': [
        dict(src='sfx100/sfx100v2_footstep_wood_01.ogg', a=0.00, b=0.22, at=0.000, gain=1.00),
    ],
    'sfx-step-02': [
        dict(src='sfx100/sfx100v2_footstep_wood_02.ogg', a=0.00, b=0.21, at=0.000, gain=1.00),
    ],
    'sfx-door': [
        dict(src='sfx100/sfx100v2_door_01.ogg', a=0.00, b=0.35, at=0.000, gain=1.00),
        dict(src='sfx100/sfx100v2_lock_open_01.ogg', a=0.00, b=0.11, at=0.015, gain=0.42, lp=5000),
    ],
    'sfx-metal': [
        dict(src='rpg/metal_02.ogg', a=0.00, b=0.32, at=0.000, gain=1.00),
        dict(src='rpg/metal_01.ogg', a=0.00, b=0.18, at=0.010, gain=0.45),
    ],
    'sfx-flesh': [
        dict(src='rpg/creature_hurt_02.ogg', a=0.02, b=0.48, at=0.000, gain=1.00, rate=0.92, lp=3000),
    ],
    'sfx-scream-01': [
        dict(src='rpg/creature_die_01.ogg', a=0.00, b=0.85, at=0.000, gain=1.00, rate=0.96, lp=3200),
    ],
    'sfx-scream-02': [
        dict(src='rpg/creature_hurt_02.ogg', a=0.00, b=0.60, at=0.000, gain=1.00, rate=0.98, lp=3400),
    ],
}

# 个别音效的响度目标（报告要压过全场，脚步要贴地）
RMS_TARGET = {'sfx-notify': -11.0, 'sfx-gun': -8.5, 'sfx-win': -13.0, 'sfx-lose': -13.5}
# 枪声要“炸”一点：更强的软限幅压掉瞬态尖峰，让 30ms 短窗 RMS 顶上去
DRIVE = {'sfx-gun': 3.4}
# 脚步要贴地但不至于听不见（旧文件短窗 RMS -19.6 / -28.2，两档差 8.6dB）
LEVELS = {'sfx-step-01': -20.0, 'sfx-step-02': -20.0, 'sfx-ui': -18.0, 'sfx-work': -22.0,
          'sfx-door': -16.0, 'sfx-metal': -16.0, 'sfx-flesh': -16.0,
          'sfx-scream-01': -14.0, 'sfx-scream-02': -14.0}
RMS_TARGET.update(LEVELS)


def decode(path):
    p = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1',
                        '-ar', str(SR), '-'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        raise RuntimeError('%s: %s' % (path, p.stderr.decode('utf-8', 'ignore').strip()))
    return np.frombuffer(p.stdout, dtype=np.float32).astype(np.float64)


def encode(path, x):
    p = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '1',
                        '-i', '-', '-c:a', 'libvorbis', '-qscale:a', '6', path],
                       input=x.astype(np.float32).tobytes(),
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode('utf-8', 'ignore').strip())


def shape(x, fade_in=0.003, fade_out=0.012):
    """首尾极短淡入淡出：消除切片边界爆音，但不吃掉瞬态。"""
    n = len(x)
    fi, fo = int(fade_in * SR), int(fade_out * SR)
    if fi:
        x[:fi] *= np.linspace(0, 1, fi)
    if fo:
        x[-fo:] *= np.linspace(1, 0, fo)
    return x


def build(layers, target_db=None, name=None):
    tgt = TARGET_RMS_DB if target_db is None else target_db
    end = max((l['at'] + (l['b'] - l['a']) / float(l.get('rate') or 1.0)) for l in layers)
    buf = np.zeros(int(end * SR) + SR // 50)
    for l in layers:
        s = decode(os.path.join(RAW, l['src']))
        seg = s[int(l['a'] * SR):min(len(s), int(l['b'] * SR))]
        i0 = int(l['at'] * SR)
        if seg.size == 0:
            continue
        rate = float(l.get('rate') or 1.0)
        if abs(rate - 1.0) > 1e-3:
            # rate < 1 = 降速/降调：按源位置 j*rate 线性重采样，时长变长、频率变低
            src = np.arange(0, seg.size - 1e-9, rate)
            seg = np.interp(src, np.arange(seg.size), seg)
        lp = l.get('lp')
        if lp:
            alpha = 1.0 - math.exp(-2.0 * math.pi * float(lp) / SR)
            y = np.empty_like(seg)
            acc = 0.0
            for k, v in enumerate(seg):
                acc += alpha * (v - acc)
                y[k] = acc
            seg = y
        buf[i0:i0 + seg.size] += seg * l['gain']
    buf = shape(buf)
    # 软限幅先压瞬态峰值，再做响度归一：顺序反过来会让"动态大"的那条
    # 被峰值上限整条拖小，两条变体之间差出 4~5dB，连刀听得出忽响忽轻。
    drive = float(DRIVE.get(name, 1.6))
    buf = np.tanh(buf * drive) / np.tanh(drive)
    win = int(0.03 * SR)
    frames = np.lib.stride_tricks.sliding_window_view(buf, win)
    short = float(np.sqrt(np.max(np.mean(np.square(frames), axis=1))))
    g = 10 ** ((tgt - 20 * np.log10(max(short, 1e-9))) / 20.0)
    buf *= g
    peak = float(np.max(np.abs(buf))) or 1.0
    cap = 10 ** (PEAK_DB / 20.0)
    if peak > cap:
        buf *= cap / peak
    return np.clip(buf, -1, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out-dir', default=os.path.join(ROOT, 'audio'))
    ap.add_argument('--only', nargs='*', default=[])
    ap.add_argument('--list', action='store_true')
    a = ap.parse_args()
    names = [n for n in RECIPES if not a.only or any(o in n for o in a.only)]
    if a.list:
        for n in names:
            print(n)
            for l in RECIPES[n]:
                print('    %-28s %.2f-%.2fs @+%.3fs gain=%.2f' % (
                    l['src'], l['a'], l['b'], l['at'], l['gain']))
        return 0
    os.makedirs(a.out_dir, exist_ok=True)
    for n in names:
        x = build(RECIPES[n], RMS_TARGET.get(n), n)
        out = os.path.join(a.out_dir, n + '.ogg')
        encode(out, x)
        print('wrote %-26s %4.0fms peak=%5.1f dBFS 目标RMS=%.1f' % (
            n + '.ogg', len(x) / SR * 1000, 20 * np.log10(max(np.max(np.abs(x)), 1e-9)),
            RMS_TARGET.get(n, TARGET_RMS_DB)))
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
