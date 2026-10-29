# assets/scene/v4 · 2.5D 底图与门素材

- `base-lit.png` / `hull-deck.png`：由 `tools/blender-ship.py` 从 `js/data/map.js` 的房间、墙体、门、
  走廊与 `tex/` 纹理烘焙（Blender 5.2.2，正交 12° 俯角，4704×2817）。
  改了地图几何后必须重新执行：

  ```bash
  blender -b -P tools/blender-ship.py
  ```

- `tex/floor-*.png`、`tex/wall-panel.png`：本仓飞船地面 / 墙面纹理，随仓库 MIT。
- `tex/door-panel.png`：自动门门板纹理，本仓扩散模型生成（2026-10-29），仅用于本项目；
  游戏内的立式 / 贴地门板由 `js/game.js` 的 `drawDoors()` 动态绘制。
- `_preview.png`：Blender `--test` 预览图，可随时重新生成，不参与运行时加载。
