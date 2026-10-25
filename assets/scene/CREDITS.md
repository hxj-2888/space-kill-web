# assets/scene · 素材出处与许可证（批 S0）

| 素材 | 出处 | 许可证 | 生成方式 |
|---|---|---|---|
| 15 席角色 · 方案A | [DiceBear open-peeps](https://www.dicebear.com/styles/) | CC0 1.0 | `api.dicebear.com/10.x/open-peeps/svg?seed=seat-N&backgroundColor=…&radius=50`（座位号种子，局内稳定） |
| 15 席角色 · 方案B | DiceBear voxel-bot | CC0 1.0 | 同上 |
| 15 席角色 · 方案C | DiceBear critters | CC0 1.0 | 同上 |
| 书记官 NPC | DiceBear notionists | CC0 1.0 | seed=scribe-official |
| 太空船内景背景 | [Spaceship Interior — OpenGameArt / Parker West](https://opengameart.org/content/spaceship-interior)（源自 Pixabay） | CC0 1.0 | 原图直存 bg/spaceship-interior-v1.jpg（2.1MB；SHA256 a1b98506…） |
| 其余（圆桌/椅子/气泡/房间门/叠加件） | 本仓自绘 | 随仓库 LICENSE | 场景 SVG 组合件，非角色素材 |
| 开始页「返航环」bg/departure-ring.svg | 本仓自绘 | 随仓库 LICENSE | `node tools/gen-start-scene.cjs [--force]`（15 席等弧长座次，与对局页同算法；纯装饰，不含角色暗示） |

- DiceBear 风格许可证逐档核对：https://www.dicebear.com/licenses/ （open-peeps / voxel-bot / critters / notionists 均为 CC0 1.0，无署名义务）
- 生成脚本：`node tools/gen-scene-assets.cjs [--force]`；产物为静态文件，**产品运行时不访问任何外部服务**。
- 生产接入（S2 批）前将把背景压至 Web 尺寸（~1600px/JPEG q82），原图保留作母版。
- 〔S4〕开始页与结算页只**复用**上面已登记的素材（同一张内景 + 自绘返航环），未新增第三方资源。
