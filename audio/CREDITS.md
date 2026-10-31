# 音频素材来源与许可

音效素材均为 **CC0 1.0（公有领域）**，可自由商用、无需署名。本文件仅作来源留档。

## 背景音乐

| 文件 | 来源 | 许可 |
|---|---|---|
| `music-bgm.m4a` | 用户自有录音（2026-10-06），替换原 CC0 `music-space-ambience.ogg`（〔批次 38〕音乐资源清理时移除） | 用户自有素材 |

（背景音乐文件目前仅留档，未接入游戏；当前版本只播放音效。）

## 音效

| 文件 | 素材来源 | 处理 | 许可 |
|---|---|---|---|
| `sfx-knife-01.ogg` | 80 CC0 RPG SFX：`blade_03.ogg` + `misc_01.ogg` | 破风层 + 入肉层分层；短窗 RMS -13 / 峰值 -3 | CC0 |
| `sfx-knife-02.ogg` | 80 CC0 RPG SFX：`blade_01.ogg` + `creature_hurt_01.ogg` | 更闷、更短的出刀变体 | CC0 |
| `sfx-gun.ogg` | OpenGameArt「Gunshots」`22 Pistol.wav` + 100 CC0 SFX #2 `hit_02.ogg` | 从第一声枪响瞬态 0.115s 起（去掉 140ms 前导静音）；同一发降速 + 低通做炮口闷响，再叠一层低频冲击；短窗 RMS -11 / 峰值 -3 | CC0 |
| `sfx-flesh.ogg` | 80 CC0 RPG SFX：`creature_hurt_02.ogg` | 降速 + 低通的血肉命中层 | CC0 |
| `sfx-step-01/02.ogg` | 100 CC0 SFX #2：`footstep_wood_01/02.ogg` | 木地板脚步，统一到短窗 -20（旧文件的第二变体低到 -28，几乎听不见） | CC0 |
| `sfx-door.ogg` | 100 CC0 SFX #2：`door_01.ogg` + `lock_open_01.ogg` | 气闸滑门 + 锁扣 | CC0 |
| `sfx-metal.ogg` | 80 CC0 RPG SFX：`metal_02.ogg` + `metal_01.ogg` | 电闸 / 破坏 / 机器人金属撞击 | CC0 |
| `sfx-ui.ogg` | 100 CC0 SFX #2：`lock_open_01.ogg` + 80 CC0 RPG SFX `item_misc_02.ogg` | 交互 / 领申请单 / 确认的短促 UI 声 | CC0 |
| `sfx-work.ogg` | 80 CC0 RPG SFX：`metal_02.ogg` + 100 CC0 SFX #2 `metal_hit_01.ogg` | 站桩维修火花，压低到短窗 -22 | CC0 |
| `sfx-notify.ogg` | 80 CC0 RPG SFX：`item_gem_01/02.ogg` | 双铃报告音（旧文件是纯数字静音，已替换） | CC0 |
| `sfx-scream-01/02.ogg` | 80 CC0 RPG SFX：`creature_die_01.ogg` / `creature_hurt_02.ogg` | 被击倒喊叫双变体 | CC0 |
| `sfx-win.ogg` | 80 CC0 RPG SFX：`item_gem_01/02/03.ogg` | 人类胜利三音上行 | CC0 |
| `sfx-lose.ogg` | 80 CC0 RPG SFX：`creature_die_01.ogg` + `metal_02.ogg` | 异形胜利的降调丧钟 | CC0 |
| `sfx-click.ogg` / `sfx-tick.ogg` / `sfx-submit.ogg` / `sfx-vote.ogg` / `sfx-death.ogg` | 60 CC0 Sci-Fi SFX（rubberduck）/ Kenney Sci-Fi Sounds | 旧文件留档；本版未引用（其中 click/tick/submit/vote/win/lose 实测是纯静音，已不再使用） | CC0 |
| `music-bgm.m4a` | 用户自有录音（2026-10-06） | 仅留档，未接入游戏 | 用户自有 |

> 2026-10-31 重做：`sfx-gun` 旧文件从 22 Pistol 截取首发时保留了 **140ms 前导静音**，
> 频段与出刀同落在 3~6kHz，玩家听感是“枪和刀一样”。现在改成 **低频炮口闷响（<500Hz 占 31%）+
> 高频脆响**，并把短窗 RMS 提到 -11（出刀 -13），枪声比刀声更重更低。
> 同时补齐交互（`sfx-ui`）、维修（`sfx-work`）、胜利 / 失败结算音，并把门 / 金属 / 血肉 / 喊叫
> 从削顶（+0.7 ~ +1.6 dBFS）重新母带到 -3 dBFS 峰值以下。
> 所有处理由 `tools/master-sfx.py` 完成，素材仍是公共领域采样，原始包留档在 `tools/_sfx/`。

## 游戏内映射（js/game.js `SND`）

knife=出刀（双变体） · gun=开枪 · flesh=刀/枪命中血肉 · step=脚步（双变体，按距离衰减） ·
scream=被击倒喊叫（双变体） · metal=电闸/破坏/机器人 · door=自动门/投票/驱逐 ·
ui=交互/领取申请单/合闸确认 · work=站桩维修火花 · notify=尸体报告 · win/lose=结算 ·
其它即时提示（完成、领取、医疗包、子弹、救助、警报、搜索）仍由 WebAudio 合成，但增益已提高到可听见的一档。

## 换风格指引

原始素材包（重新下载即可）：
- 60 CC0 Sci-Fi SFX 全包（60 条 ogg）：`https://opengameart.org/sites/default/files/60-sci-fi-sfx_0.zip`
- Kenney Sci-Fi Sounds（75 条 ogg）：`https://kenney.nl/assets/sci-fi-sounds`（或 soundcn 镜像 raw 直链）
- 80 CC0 RPG SFX：`https://opengameart.org/content/80-cc0-rpg-sfx`
- 100 CC0 SFX #2：`https://opengameart.org/content/100-cc0-sfx-2`
- 注意：OpenGameArt 的 Dark Ambience Soundscapes（CC-BY-SA 3.0）与 Background Rumble Noise（CC-BY 3.0）
  因许可（SA 传染 / 需署名）**未采用**。

替换方法：把新文件覆盖 `audio/` 下同名文件即可，无需改代码；若换格式/改名，同步改 `js/game.js` 里 `SND` 的 `FILE` 路径表。
