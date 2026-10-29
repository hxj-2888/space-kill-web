# AGENTS.md — 新返航录（试玩版 · 返航录V1）

> **当前版本**：返航录V1（2026-10-29）· `package.json` 1.0.0
> **一句话**：11 人类 vs 4 异形的实时太空船对抗网页游戏；零依赖前端、无构建、`file://` 可直接运行。
> **接手顺序**：README.md → 本文件 → CHANGELOG.md → 再动代码。

## 一、红线（违反即回退）

1. **`file://` 必须可玩。** 禁止 `fetch()`、ES Module（`<script type="module">`）、构建/打包步骤，
   以及任何需要本地服务器才能加载的资源。所有脚本按顺序用经典 `<script>` 加载。
2. **`index.html` 是唯一加载清单。** 新增模块必须按依赖顺序插入，并同步更新 README 的「项目结构」；
   禁止在别处动态注入 `<script>`。当前顺序：`version → map → templates → clock → invariants → geo → game → main`。
3. **版本单一真源是 `js/config/version.js`（`SKConfig.version = '返航录V1'`）。**
   改版本必须同批改 `package.json`（`version` / `gameVersion`）并在 `CHANGELOG.md` 记录；
   界面版本号一律用 `[data-version]` 占位，由脚本填充，禁止散落硬编码。
4. **门禁必须全绿。** 改任何逻辑/数据后跑 `node tools/test-v3.cjs`，失败一律按回归处理；
   报告里必须写本次实跑的「X 通过 / Y 失败」，不得沿用旧读数。
5. **`window.SKV3._t` 调试 API 是门禁契约。** 可以新增方法，但不得删除/改名/改变现有方法语义
   （`state()`、`inv()`、`newGame()`、`kill()`、`tp()`、`openMeeting()` 等被 test-v3.cjs 直接依赖）。
6. **素材署名不可删。** `assets/scene/cozy`、`assets/scene/rooms` 为 CC-BY 4.0，
   `audio/` 为 CC0；对应的 `LICENSE.txt` / `CREDITS.md` 必须保留，二次分发同样适用。
7. **模块边界不许穿透。** 地图数据只放 `js/data/map.js`；几何/寻路只放 `js/engine/geo.js`；
   界面模板只放 `js/ui/templates.js`。不要在 `game.js` 里复制粘贴这些内容，也不要反向依赖对局状态。
8. **不引运行时第三方依赖。** 游戏必须是 0 依赖静态页面；Node 只用于本地服务器与测试工具。
9. **DOM id 双处同步。** 模板里的 id 在 `js/ui/templates.js` 与 `js/game.js` 都有引用；
   改名必须同批改两处并跑门禁。
10. **中文记录。** 提交信息、文档、注释一律中文；提交格式：`type(scope): 摘要`（feat / fix / docs / chore）。

## 二、命令

| 目的 | 命令 |
|---|---|
| 直接试玩 | 双击 `index.html` |
| 本地服务 | `npm start`（`node tools/serve.cjs`，默认 5173） |
| 全量门禁 | `npm test`（即 `node tools/test-v3.cjs`） |
| 指定 Playwright | `PLAYWRIGHT_CORE=/path/to/playwright-core npm test` |
| 指定截图目录 | `SHOT_DIR=./tools/screenshots npm test` |
| 调试模式 | `index.html?test`（跳过开局会议）/ `?dev`（DEV 面板）/ `&strict` |

## 三、文件地图

| 路径 | 层 | 说明 |
|---|---|---|
| `index.html` | 入口 | 开始页 + 唯一的脚本加载清单 |
| `js/config/version.js` | 配置 | **版本单一真源**（返航录V1）与仓库地址 |
| `js/data/map.js` | 数据 | 地图静态数据（房间/走廊/家具/任务点/管道/设施/墙体） |
| `js/ui/templates.js` | 视图数据 | `#v3-root` 的 CSS 与 HTML 模板 |
| `js/engine/clock.js` | 引擎 | 相位时钟 / 个人技能槽 / 动作请求队列（纯逻辑） |
| `js/engine/invariants.js` | 引擎 | 对局不变量断言（只读，`SKInvariants.check`） |
| `js/engine/geo.js` | 引擎 | 几何、可行走网格（家具软代价）、A*、视线 |
| `js/game.js` | 编排 | 状态、AI、动作结算、会议/投票、渲染、输入（`window.SKV3`） |
| `js/main.js` | 入口 | 开始页按钮绑定 + `[data-version]` 填充 |
| `tools/serve.cjs` | 工具 | 零依赖静态服务器 |
| `tools/test-v3.cjs` | 门禁 | Playwright 浏览器断言（170 条） |
| `assets/` · `audio/` | 素材 | 许可与署名见各子目录 `LICENSE*` 与 `audio/CREDITS.md` |

## 四、架构约定

- **模块形态**：经典 script + IIFE，只向 `window.SK*` 暴露一个冻结对象；
  纯引擎模块不得读取 DOM、不得读写对局状态、不得掷随机（随机只在 `game.js` 的对局状态里）。
- **坐标系**：1 格 ≈ 56px 底图；`geo.js` 以 0.6 格烘焙可行走网格；家具是软代价（+2.2）而非硬墙。
- **渲染与模拟**：`game.js` 内 `update(dt)` 驱动模拟，`draw(dt)` 负责渲染；
  会议、搜尸、暂停时模拟冻结，但特效/动画按真实时间收尾（门禁有对应断言）。
- **不变量**：15 席 / 4 异形 / 11 人类恒定；尸体必留坐标（驱逐除外）；拖拽双向互指且 ≤ 3.2 格；
  投票对账一致。改动模拟逻辑后必须让 `SKInvariants` 零失败。

## 五、改动流程

1. 先读 `README.md`、本文件、`CHANGELOG.md` 最近条目。
2. 小步修改；涉及地图/寻路/会议/输入的改动，先 `npm start` 或直接 `file://` 冒烟。
3. 跑 `npm test`，确认「X 通过 / 0 失败」，并抽查 `tools/screenshots/` 的截图（元素存在 ≠ 像素可见）。
4. 更新 `CHANGELOG.md`（版本号 + 日期 + 实测读数）。
5. 提交并推送 GitHub / Gitee 的 `main`，仓库简介保持「新返航录 · 返航录V1」口径。

## 六、当前基线（返航录V1）

- 门禁：`node tools/test-v3.cjs` —— **170 通过 / 0 失败**（2026-10-29 实跑，Edge headless）。
- 浏览器冒烟：开始页版本号「返航录V1」→ 人类开局 15 席 / 297 项不变量全过 / 控制台零报错（2026-10-29）。
