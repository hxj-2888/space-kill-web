# 新返航录 · 蒙特卡洛对抗报告

> 生成：2026-10-31T02:01:18.059Z · 局数：1000 / 1000 · seed：20261030 · dt：0.1 · 上限：15 夜

## 胜率

| 阵营 | 胜局 | 胜率 |
|---|---:|---:|
| 人类 | 431 | 43.1% |
| 异形 | 568 | 56.8% |
| 超时未决 | 1 | 0.1% |

人类胜率 95% Wilson 区间：40.06% ~ 46.19%

## 结束原因

- timeout：1
- 人类全灭：568
- 异形全部出局：131
- 维修 45 分达成：300

## 每局均值 / 中位数

| 指标 | 均值 | 中位数 |
|---|---:|---:|
| nights | 6.232 | 6 |
| prog | 38.917 | 41 |
| steps | 5093.335 | 4742 |
| meetings | 14.758 | 15 |
| knives | 11.192 | 11 |
| shots | 2.189 | 2 |
| sabotages | 7.822 | 8 |
| exiles | 2.012 | 2 |
| humanExiles | 1.087 | 1 |
| alienExiles | 0.925 | 1 |
| searches | 6.31 | 6 |
| loots | 4.045 | 4 |
| bulletsLooted | 1.053 | 1 |
| medkitsLooted | 1.171 | 1 |
| qualsLooted | 2.534 | 2 |
| humanLoots | 3.076 | 3 |
| alienLoots | 3.234 | 3 |
| humanShots | 0.475 | 0 |
| alienShots | 1.714 | 1.5 |
| fakeRepairs | 0.138 | 0 |
| fakeTasks | 1.008 | 1 |
| alienTasks | 0.413 | 0 |
| revives | 0.59 | 0 |
| alienPipes | 5.616 | 5 |
| alienPipePlans | 10.182 | 10 |
| humans | 2.343 | 0 |
| aliens | 1.225 | 1 |
| downed | 0.194 | 0 |

## 方法说明

- 夜会议按 30 秒扣夜；白天会议不占夜。
- 讨论台词不逐条播放，会议决策与传闻嫌疑在开会时同步结算。
- 跳过渲染/HUD/音效/自动不变量；对局逻辑与正式版一致。
- 统计口径：searches/loots 为搜尸次数与真正取到物资的次数；humanLoots/alienLoots 按阵营拆分；alienPipes 为实际钻管道次数，fakeRepairs/fakeTasks 为异形假装维修与假装做任务次数，alienTasks 为真做任务次数。
