# assets/scene/v4 · 2.5D 底图与门素材

- `base-lit.png`：由 `tools/blender-ship.py` 从 `js/data/map.js` 的房间、墙体、门、
  走廊与 `tex/` 纹理烘焙（Blender 4.5.9 / 5.x 均可，正交 12° 俯角，4704×3850 = 98×82 格）。
  改了地图几何或家具材质后必须重新执行：

  ```bash
  blender -b -P tools/blender-ship.py          # 全分辨率底图
  blender -b -P tools/blender-ship.py -- --test # 960×575 预览（_preview.png）
  ```

- `hull-deck.png`：船体底板，由 `tools/gen-hull.py` 程序化生成（2352×1968 = 98×82 格 × 24px），随仓库 MIT。
- `tex/floor-*.png`、`tex/wall-panel.png`、`tex/cafeteria-floor.png`、`tex/warehouse-floor.png`：
  本仓飞船地面 / 墙面纹理（后两张为 2026-10-30 SDXL 新生成），随仓库 MIT。
- `tex/panel-metal.png`、`tex/crate-steel.png`、`tex/fabric-weave.png`、`tex/table-composite.png`、
  `tex/panel-white.png`、`tex/cafeteria-top.png`、`tex/warehouse-rack.png`：家具 / 掩体表面材质，由 `tools/gen-materials.py` 用本地 **SDXL**
  （`sdxl-base`，768px 出图）生成（2026-10-29），再统一「降饱和 + 冷调 + 四向镜像拼贴 + 回缩 1024」，
  保证 `REPEAT` 平铺无接缝且色温压到既有地板 / 墙面同一档；随仓库 MIT。
- `tex/hazard-stripe.png`、`tex/ao-soft.png`：同工具生成的程序化贴图（琥珀警戒斜纹、接地软阴影 alpha），
  不依赖显卡；随仓库 MIT。
  该工具另有 `--mode reuse` 兜底路径：在没有 SDXL / 显存不足时直接从 `wall-panel`、`floor-carpet`、
  `floor-steel`、`floor-lab` 派生材质，保证 Blender 端始终能出图。
- `tex/door-panel.png`：自动门门板纹理，本仓扩散模型生成（2026-10-29），仅用于本项目；
  游戏内的立式 / 贴地门板由 `js/game.js` 的 `drawDoors()` 动态绘制。
- `_preview.png`：Blender `--test` 预览图，可随时重新生成，不参与运行时加载。
