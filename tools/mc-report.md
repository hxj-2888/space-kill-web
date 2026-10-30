# 新返航录 · 蒙特卡洛对抗报告

> 生成：2026-10-30T10:58:17.415Z · 局数：1000 / 1000 · seed：20261030 · dt：0.1 · 上限：15 夜

## 胜率

| 阵营 | 胜局 | 胜率 |
|---|---:|---:|
| 人类 | 487 | 48.7% |
| 异形 | 512 | 51.2% |
| 超时未决 | 1 | 0.1% |

人类胜率 95% Wilson 区间：45.61% ~ 51.8%

## 结束原因

- timeout：1
- 人类全灭：512
- 异形全部出局：129
- 维修 45 分达成：358

## 每局均值 / 中位数

| 指标 | 均值 | 中位数 |
|---|---:|---:|
| nights | 5.608 | 5 |
| prog | 39.774 | 42 |
| steps | 4394.422 | 4038.5 |
| meetings | 13.332 | 13 |
| knives | 10.213 | 11 |
| shots | 1.953 | 2 |
| sabotages | 7.247 | 7 |
| exiles | 1.958 | 2 |
| humanExiles | 0.95 | 1 |
| alienExiles | 1.008 | 1 |
| searches | 5.395 | 5 |
| loots | 3.75 | 4 |
| bulletsLooted | 0.963 | 1 |
| medkitsLooted | 1.133 | 1 |
| qualsLooted | 2.336 | 2 |
| humanLoots | 2.507 | 2 |
| alienLoots | 2.888 | 3 |
| humanShots | 0.532 | 0 |
| alienShots | 1.421 | 1 |
| fakeRepairs | 0.164 | 0 |
| fakeTasks | 1.161 | 1 |
| alienTasks | 0.519 | 0 |
| revives | 0.643 | 0 |
| alienPipes | 3.302 | 3 |
| alienPipePlans | 5.637 | 5 |
| humans | 2.7 | 0 |
| aliens | 1.324 | 1 |
| downed | 0.247 | 0 |

## 方法说明

- 夜会议按 30 秒扣夜；白天会议不占夜。
- 讨论台词不逐条播放，会议决策与传闻嫌疑在开会时同步结算。
- 跳过渲染/HUD/音效/自动不变量；对局逻辑与正式版一致。
- 统计口径：searches/loots 为搜尸次数与真正取到物资的次数；humanLoots/alienLoots 按阵营拆分；alienPipes 为实际钻管道次数，fakeRepairs/fakeTasks 为异形假装维修与假装做任务次数，alienTasks 为真做任务次数。
