#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gen_mc_report.py — 把蒙特卡洛原始结果转成站点用的 Markdown 报告

输入：蒙特卡洛原始 JSON（由网页版引擎的 tools/mc.cjs 产出）
输出：公测3.1/sim_output/蒙特卡洛<N>局.md（供 tools/build_site.py 的 SIM31 清单收录）

为什么单独一步：站点由 build_site.py 从 Markdown 生成，且 CI 会「重建并与提交内容比对」。
把 JSON → Markdown 的转换固化在脚本里，报告就与原始数据保持可追溯，而不是手写数字。

用法:
  python tools/gen_mc_report.py <mc_result.json> [输出 Markdown 路径]
默认输出：公测3.1/sim_output/蒙特卡洛<N>局.md
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT_DIR = os.path.join(ROOT, '公测3.1', 'sim_output')

FAC = [('human', '人类'), ('alien', '异形'), ('xeno', '外星人'), ('draw', '平局')]
CAUSE = [('驱逐', '驱逐'), ('alien', '异形袭击'), ('xeno', '外星人击杀'),
         ('gun', '警长开枪'), ('infect', '感染致死')]


def pct(n, total):
    return '%.1f%%' % (100.0 * n / total) if total else '—'


def table(headers, rows):
    out = ['| ' + ' | '.join(headers) + ' |',
           '|' + '|'.join(['---'] * len(headers)) + '|']
    for r in rows:
        out.append('| ' + ' | '.join(str(c) for c in r) + ' |')
    return '\n'.join(out)


def dist_table(d, label_key='项', value_key='次数', total=None, order=None):
    keys = order if order else sorted(d.keys(), key=lambda k: (len(str(k)), str(k)))
    rows = []
    for k in keys:
        v = d.get(k)
        if v is None:
            continue
        rows.append([k, v, pct(v, total) if total else '—'])
    return table([label_key, value_key, '占比'], rows)


def build(json_path):
    with open(json_path, encoding='utf-8') as f:
        r = json.load(f)

    n = r['N']
    done = r.get('done', n)
    wins = r.get('wins', {})
    phases = r.get('phases', {})
    m = r.get('metrics', {})

    L = []
    L.append('# 蒙特卡洛模拟 · %d 局' % n)
    L.append('')
    L.append('> 由**网页版游戏引擎**（`js/engine.js` 与结合层全量模块）离线跑完整对局，'
             '无 DOM、无 UI、无联机层——即玩家实际对战的那套规则与 AI。')
    L.append('')
    L.append('| 项目 | 值 |')
    L.append('|---|---|')
    L.append('| 对局数 | %d / %d |' % (done, n))
    L.append('| 种子区间 | %s ~ %s |' % (r.get('seed0'), r.get('seedEnd')))
    L.append('| 耗时 | %.1f 秒 |' % (r.get('elapsedMs', 0) / 1000.0))
    L.append('| **运行时异常** | **%d** |' % len(r.get('errs', [])))
    L.append('')

    L.append('## 胜负分布')
    L.append('')
    rows = [[name, wins.get(key, 0), pct(wins.get(key, 0), done)] for key, name in FAC]
    L.append(table(['阵营', '胜场', '占比'], rows))
    L.append('')
    non_draw = sum(wins.get(k, 0) for k, _ in FAC[:3])
    if non_draw:
        L.append('非平局口径：人类 %.1f%% · 异形 %.1f%% · 外星人 %.1f%%' % (
            100.0 * wins.get('human', 0) / non_draw,
            100.0 * wins.get('alien', 0) / non_draw,
            100.0 * wins.get('xeno', 0) / non_draw))
        L.append('')

    L.append('## 阶段分布（残局类型）')
    L.append('')
    rows = [[k, v, pct(v, done)] for k, v in phases.items()]
    L.append(table(['阶段', '局数', '占比'], rows))
    L.append('')

    L.append('## 对局节奏')
    L.append('')
    L.append('| 指标 | 均值 |')
    L.append('|---|---|')
    L.append('| 平均夜数 | %.2f |' % r.get('avgNights', 0))
    L.append('| 场均驱逐 | %.2f |' % r.get('avgEvictions', 0))
    L.append('| 场均夜死 | %.2f |' % r.get('avgDeaths', 0))
    L.append('| 场均查验 | %.2f 人次 |' % r.get('avgChecks', 0))
    L.append('| 场均维修 | %.2f |' % r.get('avgRepair', 0))
    L.append('')

    hist = r.get('nightHist', {})
    if hist:
        L.append('### 夜数分布')
        L.append('')
        keys = sorted(hist.keys(), key=lambda k: int(k))
        L.append(table(['夜数', '局数', '占比'], [[k, hist[k], pct(hist[k], done)] for k in keys]))
        L.append('')

    cause = r.get('outByCause', {})
    if cause:
        L.append('## 出局原因分布')
        L.append('')
        total_d = sum(cause.values())
        order = [k for k, _ in CAUSE if k in cause]
        order += [k for k in cause if k not in order]
        rows = []
        for k in order:
            label = dict(CAUSE).get(k, k)
            rows.append([label, cause[k], pct(cause[k], total_d)])
        L.append(table(['死因', '次数', '占比'], rows))
        L.append('')

    # 破坏 / 停摆
    L.append('## 破坏与停摆')
    L.append('')
    sab_games = r.get('sabGames', 0)
    tiers = r.get('tiersHit', {})
    L.append('| 指标 | 值 |')
    L.append('|---|---|')
    L.append('| 出现 ⑤ 破坏公告的局数 | %d / %d（%s） |' % (sab_games, done, pct(sab_games, done)))
    L.append('| ⑤ 公告总条数 | %s |' % r.get('sab5Total', 0))
    L.append('| 停摆 3.0 触发 | %s 局 |' % tiers.get('3', 0))
    L.append('| 停摆 6.0 触发 | %s 局 |' % tiers.get('6', 0))
    L.append('| 停摆 9.0 触发 | %s 局 |' % tiers.get('9', 0))
    L.append('')

    # AUC
    auc = r.get('auc', {})
    aucf = r.get('aucByFaction', {})
    if auc:
        L.append('## 推理区分度（AUC）')
        L.append('')
        L.append('> AUC = 敌对方在怀疑度排序中的排前概率；0.5 等于瞎猜。**只观测、不设靶**，'
                 '用于判断「证据链是否真的带来区分度」。')
        L.append('')
        stages = list(auc.keys())
        rows = []
        for key, name in FAC[:3]:
            d = aucf.get(key) or (auc if key == 'human' else None)
            if d:
                rows.append([name] + [('%.3f' % d.get(s, 0)) for s in stages])
        L.append(table(['阵营'] + stages, rows))
        L.append('')

    # 接入度
    a = m.get('A_接入度', {})
    if a:
        def brief(v):
            if isinstance(v, list):
                return '%d 个：%s' % (len(v), ', '.join(str(x) for x in v))
            return v
        L.append('## 通道接入度')
        L.append('')
        L.append('| 指标 | 值 |')
        L.append('|---|---|')
        L.append('| 已接线通道 | %s / %s |' % (a.get('chan_wired'), a.get('chan_total')))
        L.append('| 本批触发过的通道 | %s |' % brief(a.get('chan_fired')))
        L.append('| 激活专家 | %s |' % brief(a.get('expert_active')))
        L.append('| 通道分叉度 | %s |' % a.get('chan_divergence'))
        L.append('| 证据层分叉度 | %s |' % a.get('evidence_divergence_per_game'))
        L.append('')

    # 证据结构
    d = m.get('D_证据结构', {})
    if d:
        L.append('## 证据链')
        L.append('')
        L.append('| 指标 | 值 |')
        L.append('|---|---|')
        sk = d.get('src_kind', {})
        for k, v in sk.items():
            L.append('| 证据源 · %s | %s |' % (k, v))
        L.append('| 折叠率 | %s |' % d.get('fold_rate'))
        L.append('| 专家标记 | %s |' % d.get('expert_marked'))
        L.append('')

    # 仲裁 / 硬源 / 影子
    b = m.get('B_仲裁', {})
    b1 = m.get('B1_改道', {})
    c = m.get('C_影子', {})
    c1 = m.get('C1_硬源', {})
    if b:
        L.append('## 仲裁与影子')
        L.append('')
        L.append('| 指标 | 值 |')
        L.append('|---|---|')
        L.append('| 仲裁输入 | %s |' % b.get('arb_input_total'))
        L.append('| 多 Claim 率 | %s |' % b.get('arb_multi_rate'))
        if c:
            L.append('| 影子调用 | %s |' % c.get('shadow_calls'))
            L.append('| 影子采纳率 | %s |' % c.get('shadow_hit_rate'))
        L.append('')
    if b1:
        L.append('## 改道计数')
        L.append('')
        L.append(table(['改道类型', '次数'], [[k, v] for k, v in b1.items()]))
        L.append('')
    if c1:
        L.append('## 硬源锁定')
        L.append('')
        L.append('| 指标 | 值 |')
        L.append('|---|---|')
        L.append('| 每局锁定对数 | %s（中位 %s） |' % (c1.get('lock_pairs_per_game'), c1.get('lock_pairs_median')))
        L.append('| 每夜样本 | %s |' % c1.get('lock_pairs_per_night'))
        L.append('| 单人私有 | %s |' % c1.get('solo_per_game'))
        L.append('| 小组共享 | %s |' % c1.get('group_per_game'))
        L.append('| 全场共享 | %s |' % c1.get('global_per_game'))
        L.append('')

    e = m.get('E_结局', {})
    if e:
        L.append('## 结局统计')
        L.append('')
        L.append('| 项目 | 值 |')
        L.append('|---|---|')
        wn = e.get('win', {})
        for k, v in wn.items():
            L.append('| 胜利 · %s | %s |' % (dict(FAC).get(k, k), v))
        L.append('')

    if r.get('errs'):
        L.append('## 异常清单')
        L.append('')
        for line in r['errs'][:50]:
            L.append('- `%s`' % line)
        L.append('')
    else:
        L.append('## 异常清单')
        L.append('')
        L.append('**无异常** —— 全部 %d 局完整跑完。' % done)
        L.append('')

    L.append('---')
    L.append('')
    L.append('本页由 `tools/gen_mc_report.py` 从蒙特卡洛原始结果（JSON）生成，'
             '数字未经手工修改；站点由 `tools/build_site.py` 重建，CI 会比对重建结果与提交内容。')
    L.append('')
    return '\n'.join(L)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    src = sys.argv[1]
    with open(src, encoding='utf-8') as f:
        n = json.load(f)['N']
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        DEFAULT_OUT_DIR, '蒙特卡洛%d局.md' % n)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    md = build(src)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(md)
    print('已生成: %s（%d 字符）' % (out, len(md)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
