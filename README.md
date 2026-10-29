# 新返航录 · 返航录V1

> **11 人类 vs 4 异形**的实时太空船对抗网页游戏（试玩版）。
> 零依赖前端 · 无构建步骤 · 双击 `index.html` 即玩 · 单机 AI 托管对局

- **版本**：返航录V1（`package.json` 语义化镜像 `1.0.0`）
- **仓库**：[GitHub](https://github.com/hxj-2888/space-kill-web) · [Gitee](https://gitee.com/hxj-2888/space-kill-web)
- **许可**：代码 MIT；音效 CC0；场景素材 CC-BY 4.0（详见[素材与许可](#素材与许可)）

## 快速开始

| 方式 | 做法 |
|---|---|
| 直接运行 | 双击 `index.html`（推荐 Chrome / Edge；手机请横屏） |
| 本地服务 | `npm start` → <http://127.0.0.1:5173> |
| 回归门禁 | `npm test`（需要 `playwright-core`，见[开发与测试](#开发与测试)） |

开始页选择「人类」或「异形」即可进入一局；每局 15 席（11 人类 + 4 异形），其余席位由 AI 托管。

## 玩法概要

- **人类**：完成 4 个维修任务（1 高难 + 3 普通），把全船维修进度推到 40 分；或清剿全部异形。
- **异形**：出刀、钻管道、破坏设施（电闸 / 保安机器人 / 医疗机器人），削减人类数量。
- **会议**：发现尸体按 `R` 报告，或点击尸体搜尸后报告；自由发言阶段 AI 会盘口供、质疑与作证，随后投票驱逐并**公布身份**。
- **设施**：配电室电闸（全船熄灯）、监控室 9 路画面、医疗机器人（自动施救）、保安机器人（拘留凶手）。
- **濒死与拖尸**：被击倒后进入濒死，可被医疗机器人救起；尸体可拖拽藏匿，搜尸可得到死因与移动痕迹。

## 操作

| 按键 | 作用 |
|---|---|
| 鼠标左键 | 移动 / 点选交互 |
| `E` | 交互（维修、监控台、地道、取医疗包） |
| `Q` | 出刀 / 开枪（按身份与装备） |
| `F` | 施救（人类）/ 破坏设施（异形） |
| `V` | 监控台开关 |
| `R` | 报告尸体 |
| `X` | 搜尸 |
| `G` | 拖拽 / 放下尸体 |
| `T` | 视野切换（手电筒 / 全亮） |
| `C` | 相机切换（跟随 / 全图） |
| `M` | 音效开关 |
| `P` / `ESC` | 暂停 / 关闭弹层 |
| `F2` | DEV 调试面板（仅调试用） |

## 项目结构

```text
index.html                 入口页面（唯一的 script 加载清单）
js/
  config/version.js        版本与元信息（返航录V1 单一真源）
  data/map.js              舰船地图静态数据（房间/走廊/家具/任务点/管道/墙体）
  ui/templates.js          游戏界面 CSS / HTML 模板
  engine/
    clock.js               相位时钟 / 个人技能槽 / 动作请求队列
    invariants.js          对局不变量断言（只读检查）
    geo.js                 几何 / 可行走网格 / A* 寻路 / 视线
  game.js                  对局编排：状态、AI、会议、渲染、输入
  main.js                  开始页绑定与版本号填充
assets/                    场景、角色、底图等素材（许可见各子目录 LICENSE）
audio/                     音效与来源记录（CREDITS.md）
tools/
  serve.cjs                零依赖静态服务器（npm start）
  test-v3.cjs              浏览器断言门禁（Playwright）
```

分层约定：**数据（js/data）→ 引擎（js/engine）→ 编排（js/game.js）→ 入口（js/main.js）**。
所有脚本都是有顺序的经典脚本（IIFE + `window.SK*` 命名空间），不使用 ES Module 与构建步骤。

## 开发与测试

- 无构建：改完源码刷新浏览器即可；新增模块必须同步更新 `index.html` 的加载顺序（依赖自上而下）。
- 门禁：`node tools/test-v3.cjs` 会用 Playwright 跑完整浏览器断言（170 条，含不变量、寻路、会议、音效、暂停等）。
  默认查找本地 `node_modules` 中的 `playwright-core`，找不到时用环境变量指定：

  ```bash
  PLAYWRIGHT_CORE=/path/to/playwright-core node tools/test-v3.cjs
  SHOT_DIR=./tools/screenshots node tools/test-v3.cjs
  ```

- 测试截图默认写入 `tools/screenshots/`（已忽略，不会入库）。
- 调试入口：`index.html?test`（跳过开局会议直接进夜）、`index.html?dev`、`index.html&strict`。

## 素材与许可

| 范围 | 许可 | 说明 |
|---|---|---|
| 代码（`js/`、`index.html`、`tools/`） | MIT | 见根目录 [LICENSE](LICENSE) |
| 音效（`audio/`） | CC0 1.0 | 来源与作者见 [audio/CREDITS.md](audio/CREDITS.md) |
| 房间/内衬素材（`assets/scene/cozy`、`assets/scene/rooms`） | **CC-BY 4.0（必须署名）** | 署名信息见各目录 `LICENSE.txt`，不可删除 |
| 角色行走图（`assets/scene/crew`） | 本仓自绘 | 随仓库 LICENSE |
| 空间站素材（`assets/scene/station`） | Kenney（CC0） | 见 `LICENSE-Kenney.txt` |

> 二次分发时请保留上述署名文件。音频包原始来源与替换说明见 `audio/CREDITS.md`。

## 版本与记录

- 版本口径：**返航录V1**，单一真源为 [`js/config/version.js`](js/config/version.js)；
  `package.json` 的 `version`（1.0.0）与 `gameVersion`（返航录V1）为镜像，改版本需同批更新。
- 修改记录：[CHANGELOG.md](CHANGELOG.md)。
- 工程约定与红线：[AGENTS.md](AGENTS.md)。
