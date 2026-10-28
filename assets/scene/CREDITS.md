# assets/scene · 素材出处与许可证（批 S0）

| 素材 | 出处 | 许可证 | 生成方式 |
|---|---|---|---|
| 15 席角色 · 方案A | [DiceBear open-peeps](https://www.dicebear.com/styles/) | CC0 1.0 | `api.dicebear.com/10.x/open-peeps/svg?seed=seat-N&backgroundColor=…&radius=50`（座位号种子，局内稳定） |
| 15 席角色 · 方案B | DiceBear voxel-bot | CC0 1.0 | 同上 |
| 15 席角色 · 方案C | DiceBear critters | CC0 1.0 | 同上 |
| 书记官 NPC | DiceBear notionists | CC0 1.0 | seed=scribe-official |
| 船体内衬 · bg/hull-tile.png | **本仓自绘** | 随仓库 LICENSE | `node tools/gen-bg-tile.cjs [--force]`（512×512，4×4 格 32px 网格，四面无缝；对局页边条 / 开始页 / 结算页共用） |
| ~~太空船内景背景~~（**已停用**，文件仍留仓） | [Spaceship Interior — OpenGameArt / Parker West](https://opengameart.org/content/spaceship-interior)（源自 Pixabay） | CC0 1.0 | 〔批 UI-8a〕**已从产品撤除全部引用**（写实 3D 走廊与像素房间不是一套语言）。CC0 无署名义务，故本行保留仅作来源留痕；文件 bg/spaceship-interior-v1.jpg / -1600.jpg 仍在仓库内，未删。 |
| 其余（圆桌/椅子/气泡/房间门/叠加件） | 本仓自绘 | 随仓库 LICENSE | 场景 SVG 组合件，非角色素材 |
| 开始页「返航环」bg/departure-ring.svg | 本仓自绘 | 随仓库 LICENSE | `node tools/gen-start-scene.cjs [--force]`（15 席等弧长座次，与对局页同算法；纯装饰，不含角色暗示） |
| 太空站房间道具 · station/*.png（97 件） | [Kenney · Space Station Kit](https://kenney.nl/assets/space-station-kit) | **CC0 1.0**（见 `station/LICENSE-Kenney.txt`） | 官方 2D 预览图（64×64 等距小件）**原尺寸入库，不放大**；用于 8 个技能室的场景拼装 |

- DiceBear 风格许可证逐档核对：https://www.dicebear.com/licenses/ （open-peeps / voxel-bot / critters / notionists 均为 CC0 1.0，无署名义务）
- 生成脚本：`node tools/gen-scene-assets.cjs [--force]`；产物为静态文件，**产品运行时不访问任何外部服务**。
- 生产接入（S2 批）前将把背景压至 Web 尺寸（~1600px/JPEG q82），原图保留作母版。
- 〔S4〕开始页与结算页只**复用**上面已登记的素材（同一张内景 + 自绘返航环），未新增第三方资源。
- 〔批 ART-0 · 2026-10-28〕**设计参考图不在这里登记**：它们放在 `assets/refs/`（见该目录 `README.md`），
  属于"不发布、不被代码引用"的一类。本台账只登记**产品素材**。
  机器台账：`node tools/asset-catalog.cjs --write` → `assets/MANIFEST.json`，`npm run test:assets` 校验一致性。
