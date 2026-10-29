# 音频素材来源与许可

音效素材均为 **CC0 1.0（公有领域）**，可自由商用、无需署名。本文件仅作来源留档。

## 背景音乐

| 文件 | 来源 | 许可 |
|---|---|---|
| `music-bgm.m4a` | 用户提供的录音（2026-10-06，微信文件「录音机-20261006-1131(1).m4a」），替换原 CC0 `music-space-ambience.ogg`（〔批次 38〕音乐资源清理时移除） | 用户自有素材 |

（背景音乐文件目前仅留档，未接入游戏；当前版本只播放音效。）

## 音效

| 文件 | 原名 | 作者 | 来源 | 许可 |
|---|---|---|---|---|
| `sfx-click.ogg` | sfx_09a.ogg | rubberduck | 60 CC0 Sci-Fi SFX | CC0 |
| `sfx-notify.ogg` | sfx_02a.ogg | rubberduck | 60 CC0 Sci-Fi SFX | CC0 |
| `sfx-win.ogg` | sfx_18a.ogg | rubberduck | 60 CC0 Sci-Fi SFX | CC0 |
| `sfx-tick.ogg` | sfx_20a.ogg | rubberduck | 60 CC0 Sci-Fi SFX | CC0 |
| `sfx-submit.ogg` | forceField_000.ogg | Kenney | [Kenney Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | CC0 |
| `sfx-death.ogg` | explosionCrunch_002.ogg | Kenney | 同上 | CC0 |
| `sfx-vote.ogg` | impactMetal_003.ogg | Kenney | 同上 | CC0 |
| `sfx-lose.ogg` | lowFrequency_explosion_000.ogg | Kenney | 同上 | CC0 |
| `sfx-gun.ogg` | 22 Pistol.wav | [OpenGameArt「Gunshots」](https://opengameart.org/content/gunshots) | 截取首发 + 淡出，转 44.1kHz OGG | CC0 |
| `sfx-knife-01.ogg` | blade_01.ogg | [OpenGameArt「80 CC0 RPG SFX」](https://opengameart.org/content/80-cc0-rpg-sfx) | 出刀挥砍 | CC0 |
| `sfx-knife-02.ogg` | blade_02.ogg | 同上 | 出刀挥砍变体 | CC0 |
| `sfx-flesh.ogg` | creature_hurt_02.ogg | 同上 | 刀/枪命中血肉 | CC0 |
| `sfx-step-01.ogg` | sfx100v2_footstep_01.ogg | [OpenGameArt「100 CC0 SFX #2」](https://opengameart.org/content/100-cc0-sfx-2) | 脚步（截 0.32s） | CC0 |
| `sfx-step-02.ogg` | sfx100v2_footstep_02.ogg | 同上 | 脚步变体（截 0.30s） | CC0 |
| `sfx-metal.ogg` | sfx100v2_metal_hit_01.ogg | 同上 | 电闸/破坏/机器人金属撞击 | CC0 |
| `sfx-door.ogg` | sfx100v2_door_01.ogg | 同上 | 交互/投票确认/气闸 | CC0 |

（音效已统一响度归一；新增采样经 ffmpeg 转 44.1kHz OGG，游戏内由 `<audio>` 元素池播放，加载失败自动退回 WebAudio 合成。原始下载包在 `tools/_sfx/`。）

## 游戏内映射（js/game.js `SND`）

knife=出刀（双变体，附带血肉命中） · gun=开枪 · step=脚步（双变体，按距离衰减） ·
metal=电闸/破坏/机器人 · door=交互/投票/驱逐 · notify=尸体报告 ·
其余 UI 音（维修完成、资格、治疗等）仍由 WebAudio 合成。

## 换风格指引

原始素材包（重新下载即可）：
- 60 CC0 Sci-Fi SFX 全包（60 条 ogg）：`https://opengameart.org/sites/default/files/60-sci-fi-sfx_0.zip`
- Kenney Sci-Fi Sounds（75 条 ogg）：`https://kenney.nl/assets/sci-fi-sounds`（或 soundcn 镜像 raw 直链）
- 80 CC0 RPG SFX：`https://opengameart.org/content/80-cc0-rpg-sfx`
- 100 CC0 SFX #2：`https://opengameart.org/content/100-cc0-sfx-2`
- 注意：OpenGameArt 的 Dark Ambience Soundscapes（CC-BY-SA 3.0）与 Background Rumble Noise（CC-BY 3.0）
  因许可（SA 传染 / 需署名）**未采用**。

替换方法：把新文件覆盖 `audio/` 下同名文件即可，无需改代码；若换格式/改名，同步改 `js/game.js` 里 `SND` 的 `FILE` 路径表。
