# =============================================================
# sfx-audit.py · 音效量化体检（响度 / 峰值 / 时长 / 动态）
# -------------------------------------------------------------
# 职责：   把 audio/ 下每条音效测成可比的数字，解决「哪条都凭耳朵调」的问题。
# 指标：   peak  峰值 dBFS（满刻度余量，> -1 会削顶）
#          rms   平均能量 dBFS（听感响度的粗略代理）
#          crest 峰值 - 均方根（动态范围；太小=被压扁，太大=忽响忽轻）
#          lead  起始静音长度（秒；太长会让"出刀"听起来慢半拍）
# 用法：   python tools/sfx-audit.py                     # 只出报告
#          python tools/sfx-audit.py --report tools/sfx-report.md
#          python tools/sfx-audit.py --normalize -18 --only knife-01 knife-02
# 依赖：   ffmpeg（解码 OGG，不引入 Python 音频库）+ numpy
# 注意：   --normalize 会就地改写 audio/ 下的文件（git 跟踪，可回退），
#          并按 CREDITS.md 的口径保留来源信息。
# =============================================================
import argparse
import json
import os
import subprocess
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO = os.path.join(ROOT, 'audio')
SR = 48000


def decode(path):
    """ffmpeg 解码成单声道 float32。"""
    p = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR),
         '-f', 'f32le', '-'],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode('utf-8', 'ignore').strip() or 'ffmpeg 解码失败')
    return np.frombuffer(p.stdout, dtype=np.float32)


def encode(path, samples):
    """float32 单声道 → OGG（与现有素材同为 Vorbis）。"""
    p = subprocess.run(
        ['ffmpeg', '-y', '-v', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
         '-c:a', 'libvorbis', '-qscale:a', '6', path],
        input=samples.astype(np.float32).tobytes(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode('utf-8', 'ignore').strip())


def db(v):
    return 20.0 * np.log10(max(v, 1e-9))


def lead_in(a, thr=0.004):
    idx = np.flatnonzero(np.abs(a) > thr)
    return (idx[0] / SR) if idx.size else len(a) / SR


def measure(name, path):
    a = decode(path)
    win = int(0.030 * SR)
    frames = np.lib.stride_tricks.sliding_window_view(a, win)
    rms_f = np.sqrt(np.mean(np.square(frames, dtype=np.float64), axis=1)) if frames.size else np.zeros(1)
    peak = float(np.max(np.abs(a))) if a.size else 0.0
    top_rms = float(np.max(rms_f)) if rms_f.size else 0.0
    return dict(
        name=name,
        file=os.path.basename(path),
        dur=round(len(a) / SR, 3),
        peak_db=round(db(peak), 1),
        rms_db=round(db(float(np.sqrt(np.mean(np.square(a, dtype=np.float64)))) if a.size else 0), 1),
        short_rms_db=round(db(top_rms), 1),
        crest_db=round(db(peak) - db(top_rms), 1),
        lead=round(lead_in(a), 3),
        kb=round(os.path.getsize(path) / 1024.0, 1),
    )


def targets(rows, only):
    if not only:
        return rows
    keys = [o.lower() for o in only]
    return [r for r in rows if any(k in r['name'].lower() for k in keys)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--report', default=os.path.join(ROOT, 'tools', 'sfx-report.md'))
    ap.add_argument('--normalize', type=float, default=None,
                    help='把 short-RMS 拉到该 dBFS（如 -18），就地改写文件')
    ap.add_argument('--gain-cap', type=float, default=12.0, help='单条最大增益 dB，防止把噪声底抬起来')
    ap.add_argument('--only', nargs='*', default=[])
    ap.add_argument('--check', action='store_true',
                    help='回归模式：游戏里引用到的音效若为静音 / 削顶 / 起始静音过长则退出码 1')
    ap.add_argument('--json', default=None)
    a = ap.parse_args()

    files = sorted(f for f in os.listdir(AUDIO) if f.startswith('sfx-') and f.endswith('.ogg'))
    if not files:
        print('audio/ 下没有 sfx-*.ogg')
        return 1
    rows = [measure(f[4:-4], os.path.join(AUDIO, f)) for f in files]
    todo = targets(rows, a.only) if a.normalize else []

    if a.normalize is not None:
        for r in todo:
            need = a.normalize - r['short_rms_db']
            if abs(need) < 0.6:
                print('  %-22s 已在目标 ±0.6dB，跳过' % r['file'])
                continue
            need = max(-a.gain_cap, min(a.gain_cap, need))
            path = os.path.join(AUDIO, r['file'])
            s = decode(path)
            peak = float(np.max(np.abs(s))) if s.size else 0.0
            g = 10 ** (need / 20.0)
            if peak * g > 0.999:                      # 削顶保护：改按峰值留 -1dBFS 余量
                g = 0.999 / max(peak, 1e-6)
            encode(path, np.clip(s * g, -1.0, 1.0))
            print('  %-22s 增益 %+.2f dB' % (r['file'], 20 * np.log10(max(g, 1e-9))))
        rows = [measure(f[4:-4], os.path.join(AUDIO, f)) for f in files]

    hdr = ('%-22s %7s %8s %8s %9s %8s %7s %7s' %
           ('音效', '时长s', '峰值dB', '短窗RMS', '均方根dB', '动态dB', '起始ms', '体积KB'))
    lines = [hdr, '-' * len(hdr)]
    for r in rows:
        lines.append('%-22s %7.2f %8.1f %8.1f %9.1f %8.1f %7.0f %7.1f' % (
            r['file'], r['dur'], r['peak_db'], r['short_rms_db'], r['rms_db'],
            r['crest_db'], r['lead'] * 1000, r['kb']))
    table = '\n'.join(lines)
    print(table)

    spread = max(r['short_rms_db'] for r in rows) - min(r['short_rms_db'] for r in rows)
    hot = [r['file'] for r in rows if r['peak_db'] > -1.0]
    lazy = [r['file'] for r in rows if r['lead'] > 0.08]
    print('\n短窗响度跨度 %.1f dB · 峰值超 -1dBFS: %s · 起始静音 >80ms: %s' % (
        spread, hot or '无', lazy or '无'))

    if a.report:
        with open(a.report, 'w', encoding='utf-8', newline='\n') as f:
            f.write('# 音效量化报告\n\n')
            f.write('由 `python tools/sfx-audit.py` 生成，指标口径见该文件头部注释。\n\n')
            f.write('```\n' + table + '\n```\n\n')
            f.write('- **短窗响度跨度**：%.1f dB（30ms 窗最大 RMS 的极差，衡量"哪条最响"）\n' % spread)
            f.write('- **峰值超 -1dBFS**：%s\n' % ('、'.join(hot) if hot else '无'))
            f.write('- **起始静音 > 80ms**：%s\n' % ('、'.join(lazy) if lazy else '无'))
            f.write('  （反应型音效——出刀 / 开枪——起始静音越长，玩家越觉得"慢半拍"）\n')
        print('报告写入', a.report)
    if a.json:
        with open(a.json, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(rows, f, ensure_ascii=False, indent=2)
        print('数据写入', a.json)
    rc = 0
    if a.check:
        import re
        js = open(os.path.join(ROOT, 'js', 'game.js'), encoding='utf-8').read()
        used = set(re.findall(r'audio/(sfx-[a-z0-9-]+\.ogg)', js))
        by_file = {r['file']: r for r in rows}
        print('\n== 回归检查（仅游戏内引用到的 %d 条）==' % len(used))
        for fn in sorted(used):
            r = by_file.get(fn)
            if not r:
                print('  FAIL  %s 被引用但解码失败/不存在' % fn)
                rc = 1
                continue
            why = []
            if r['peak_db'] < -70:
                why.append('纯静音（峰值 %.1f dBFS）' % r['peak_db'])
            if r['peak_db'] > -0.5:
                why.append('削顶风险（峰值 %.1f dBFS）' % r['peak_db'])
            if r['lead'] > 0.10:
                why.append('起始静音 %.0fms' % (r['lead'] * 1000))
            if why:
                print('  FAIL  %-22s %s' % (fn, ' · '.join(why)))
                rc = 1
            else:
                print('  PASS  %-22s 峰值%.1f 短窗RMS%.1f 起始%.0fms' % (
                    fn, r['peak_db'], r['short_rms_db'], r['lead'] * 1000))
    return rc


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
