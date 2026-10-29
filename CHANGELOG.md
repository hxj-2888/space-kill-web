# 修改记录（CHANGELOG）

本文件记录《新返航录》试玩版的所有可见变更。版本口径：**返航录V1**。
格式参考 Keep a Changelog；日期使用本地时间（Asia/Shanghai）。

## [返航录V1] — 2026-10-29

### 新增

- 工程化基线：MIT `LICENSE`、`README.md`、`AGENTS.md`、`CHANGELOG.md`、`package.json`、
  `.gitignore`、`.editorconfig`、`.gitattributes`。
- 版本单一真源 `js/config/version.js`（`SKConfig.version = '返航录V1'`）；
  开始页与暂停面板显示版本号。
- 零依赖静态服务器 `tools/serve.cjs`（`npm start` / `npm run dev`）。
- 模块化拆分：
  - `js/data/map.js` —— 地图静态数据（原 `game.js` 内联 MAP，约 11KB）；
  - `js/ui/templates.js` —— 界面 CSS/HTML 模板（约 11.7KB）；
  - `js/engine/geo.js` —— 几何 / 可行走网格 / A* / 视线（约 5KB，纯逻辑，加载时烘焙网格）；
  - `js/main.js` —— 开始页按钮绑定与版本填充。
- 门禁工具支持 `PLAYWRIGHT_CORE` / `SHOT_DIR` 环境变量；截图默认落 `tools/screenshots/`（已忽略）。

### 变更

- `index.html`：脚本加载顺序显式化为 8 个模块；开始页角色按钮由内联 `onclick` 改为
  `data-role` + 事件绑定；补充页面描述与版本标识。
- `js/game.js`：收敛为对局编排层（3497 → 3185 行），几何与数据不再内联。
- 全仓文本统一 LF 行尾（`.gitattributes`），素材二进制显式标记。

### 验证

- `node tools/test-v3.cjs`（返航录V1，2026-10-29）：**170 通过 / 0 失败**。
- 浏览器冒烟：开始页显示「返航录V1」→ 人类开局 15 席、297 项不变量全过 → 控制台零报错。

## 2026-10-29

### 变更

- 以《新返航录》试玩版（11 人类 vs 4 异形，SKV3 独立引擎）替换 `space-kill-web` 仓库 `main`，
  旧版完整工程保留在 git 历史中（替换前 HEAD：`ec1a517`）。
- 推送 GitHub（`hxj-2888/space-kill-web`）与 Gitee（`hxj-2888/space-kill-web`）main。
