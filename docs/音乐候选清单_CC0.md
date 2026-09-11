# 背景音乐候选清单（CC0 / 纯音乐 / 悬疑·太空恐怖向）

> 用途：替换 `audio/music-space-ambience.ogg`（当前 BGM）。
> 项目纪律：`audio/CREDITS.md` 已声明**全部音频必须 CC0 1.0**，并明确拒绝过 CC-BY-SA 3.0 / CC-BY 3.0。
> 选定后请把来源补写进 `CREDITS.md`。

## 选定曲目（每类一首，共三首）

| 类别 | 曲名 | 作者 | 许可 | 实测时长 | 原始体积 | 页面 | 直链 |
|---|---|---|---|---|---|---|---|
| 太空悬疑 | Space Graveyard | TinyWorlds | CC0 1.0 | 5:13 | 3.63 MB | [页面](https://opengameart.org/content/space-graveyard-ambient-track) | [直链](https://opengameart.org/sites/default/files/space_graveyard_4.mp3) |
| 科幻恐怖 | The Surreal Truth | Joth | CC0 1.0 | 0:59 | 1.13 MB | [页面](https://opengameart.org/content/ambience-pack-1-sci-fi-horror) | [直链](https://opengameart.org/sites/default/files/The%20Surreal%20Truth.mp3) |
| 绝望压抑 | Chasing Despair | Emma_MA | CC0 1.0 | 3:02 | 6.96 MB | [页面](https://opengameart.org/content/chasing-despair) | [直链](https://opengameart.org/sites/default/files/chasing%20despair_0.mp3) |

> 此前约 45 条候选条目已按决定移除，仅保留上述三首（每类一首）。
> 许可纪律备忘：仅采用 **CC0 1.0**；FMA 的 `music-license=cc0` 过滤器不可信、Pixabay 非 CC0、Incompetech 为 CC-BY——
> 均不得入库。商业版权 OST 一律禁止。详见 `audio/CREDITS.md`。

## 落地说明

1. **转换与归一**：先用 ffmpeg 转 OGG，按 `audio/CREDITS.md` 约定做 **-18 LUFS 响度归一 + 首尾 0.5s / 1.2s 淡入淡出**。
   三首原始合计约 11.7 MB，转码后可压至约 1/3。
2. **体积与懒加载**：`Audio` 元素用 `preload='none'`，仅在开始播放 / 切曲时才设置 `src`，避免页面一打开就下载整首。
3. **持久化**：沿用项目 `sk_*` 约定（如 `sk_bgm`），并 try/catch 兼容隐私模式。
4. **接入后留档**：把「曲名 / 作者 / 页面链接 / 许可」补写进 `audio/CREDITS.md`（该文件是许可来源留档）。
