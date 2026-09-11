# 音频素材来源与许可

全部素材均为 **CC0 1.0（公有领域）**，可自由商用、无需署名。本文件仅作来源留档。

## 背景音乐

| 文件 | 原名 | 作者 | 来源 | 许可 |
|---|---|---|---|---|
| `music-space-ambience.ogg` | sfx_19a.ogg | rubberduck | [60 CC0 Sci-Fi SFX · OpenGameArt](https://opengameart.org/content/60-cc0-sci-fi-sfx) | CC0 |

（已处理：响度归一 -18 LUFS / 首尾 0.5s·1.2s 淡入淡出柔化循环接缝）

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

（音效已统一响度归一 -16 LUFS；Kenney 文件经 [soundcn 镜像](https://github.com/kapishdima/soundcn)取用）

## 角色映射（js/audio.js SFX_GAIN）

click=点击 · submit=提交/结算 · notify=公告/新发言 · death=死亡揭示 ·
vote=投票（备用） · win=胜利 · lose=失败 · tick=倒计时（备用）

## 换风格指引

原始素材包（重新下载即可）：
- 60 CC0 Sci-Fi SFX 全包（60 条 ogg）：`https://opengameart.org/sites/default/files/60-sci-fi-sfx_0.zip`
- Kenney Sci-Fi Sounds（75 条 ogg）：`https://kenney.nl/assets/sci-fi-sounds`（或 soundcn 镜像 raw 直链）
- 注意：OpenGameArt 的 Dark Ambience Soundscapes（CC-BY-SA 3.0）与 Background Rumble Noise（CC-BY 3.0）
  因许可（SA 传染 / 需署名）**未采用**。

替换方法：把新文件覆盖 `audio/` 下同名文件即可，无需改代码；若换格式/改名，同步改 `js/audio.js` 里的 `BASE` 路径与 `SFX_GAIN` 键名。
