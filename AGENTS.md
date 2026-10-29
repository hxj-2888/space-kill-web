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
| `js/engine/geo.js` | 引擎 | 几何、可行走网格（硬掩体）、A*、视线 |
| `js/game.js` | 编排 | 状态、AI、动作结算、会议/投票、渲染、输入（`window.SKV3`） |
| `js/main.js` | 入口 | 开始页按钮绑定 + `[data-version]` 填充 |
| `tools/serve.cjs` | 工具 | 零依赖静态服务器 |
| `tools/test-v3.cjs` | 门禁 | Playwright 浏览器断言（360 条） |
| `tools/blender-ship.py` | 美术工具 | 2.5D 底图烘焙（需 Blender，读 `js/data/map.js`） |
| `tools/gen-materials.py` | 美术工具 | 家具/掩体表面材质生成（本地 SDXL 流式上卡；`--mode reuse` 为无显卡兜底） |
| `assets/` · `audio/` | 素材 | 许可与署名见各子目录 `LICENSE*` 与 `audio/CREDITS.md` |

## 四、架构约定

- **模块形态**：经典 script + IIFE，只向 `window.SK*` 暴露一个冻结对象；
  纯引擎模块不得读取 DOM、不得读写对局状态、不得掷随机（随机只在 `game.js` 的对局状态里）。
- **坐标系**：1 格 ≈ 56px 底图；`geo.js` 以 0.6 格烘焙可行走网格；家具 / 掩体是**硬阻挡**，不能穿越。
- **渲染与模拟**：`game.js` 内 `update(dt)` 驱动模拟，`draw(dt)` 负责渲染；
  会议、搜尸、暂停时模拟冻结，但特效/动画按真实时间收尾（门禁有对应断言）。
- **不变量**：15 席 / 4 异形 / 11 人类恒定；尸体必留坐标（驱逐除外）；拖拽双向互指且 ≤ 3.2 格；
  投票对账一致。改动模拟逻辑后必须让 `SKInvariants` 零失败。
- **机器人与坐标**：`M.facility` 里的 `x/y` 只是初始坞位；巡逻中的实时坐标在 `G.bots`。
  拘留、施救、交互、绘制、小地图一律用 `botPos(kind)` 读取，新增逻辑不得再直接读设施坐标。
- **开枪结算**：玩家与 AI 共用 `fireShot(shooter,target)`；对机器人使用 `fireShotBot()`；
  新增开枪入口必须走同一函数，保证子弹消耗、犯罪记录、声纹与目击者逻辑一致。`Q` 只出刀（异形），`B` 才是开枪；
  异形有子弹时同样可以开枪。DEV 免伤也必须先扣子弹，杜绝无限连射。
- **统一移速**：所有活人（玩家 / AI 人类 / AI 异形）统一使用 `MOVE_SPEED = 5`；
  拖拽尸体 `DRAG_SPEED = 3.0` 格/秒（玩家与 AI 共用 `moveSpeed(a)`）、玩家幽灵 6.5 格/秒是显式例外。
  新增移动入口必须走 `moveSpeed(a)`，不要手写常量，否则 AI 会出现“拖着尸体满速跑”。
- **拖拽是通用状态**：拖拽关系存在拖拽者身上（`a.drag` = 被拖席位），被拖者 `draggedBy` 指回；
  玩家额外用 `G.drag` 做 UI 别名（不变量 D7 会校验两者同步）。
  玩家与 AI 都必须走 `startDrag / releaseDragBy / syncDragOf / releaseAllDrags`，
  禁止再直接改 `G.drag` 或 `draggedBy`；尸体跟随在 `stepMove()` 内触发，保证门禁的
  `aiTick / aiTickAlien` 单步模拟也能拖动尸体。
- **刀者红身**：`knife()` 命中后给出手者 `redT = 3.0`，在 `tickActs()` 里按 dt 递减，
  绘制端用 `tintedSheet()` 缓存的红色染色图叠加。红身是**纯表现层**，不得参与任何判定、
  证据或会议发言；新增攻击入口若要给红身，必须在真实扣刀分支里赋值。
- **任务提示不用边框**：自己的任务点所在掩体由 `drawTaskCoverFlash()` 从底图裁出物体像素做金色
  `screen` 脉冲（`G.gfx.coverFlashes` 计数），不得再画黄色虚线矩形；`G.gfx.dashedBorders`
  只允许在无掩体的空地分支上增长，门禁据此回归。改底图烘焙尺寸/对齐会同时影响这个取样框。
- **AI 规则利用**：AI 与玩家共用结算入口——救人走 `fireShot/finishDoing('revive')`、
  拖尸走 `startDrag`、合闸走 `pullBreaker`、钻管道走 `witnessAlienAction + aiHear('pipe')`；
  出刀 / 破坏前用 `secbotWouldSee(x,y)`（与 `botTick` 同源：14 格 + 180° 扇形 + `losWalls`）预判。
  新增 AI 能力必须复用这些入口，否则会出现“AI 有特权、玩家没有”的失衡。
- **AI 认知与证据链**：每个 AI 的 `mind` 只记录自己看见/听见/搜查到的事实
  （`saw_* / heard_* / env_* / saw_body / search_result`），并换算成 `sus` 嫌疑分；
  **禁止读取 `alien` 身份**。新增动作或环境提示必须调用 `noticeAction()` / `aiHear()` / `envNotice()`，
  同步 `EV_W` 权重与门禁，否则 AI 会“看得见但不会想”。
- **AI 报告与会议**：每夜最多 1 次 AI 报告（`G.aiReportUsed`）；AI 异形也允许报告；
  人类发现濒死先搜尸，未检查的 `searched=false` 尸体不能被当作已取证；
  没有证据的 AI 人类会议投票必须弃权（-1），异形保持独立随机投票，不得按阵营过滤。
- **身体状态**：刀/枪必须写入 `woundCause` 与 `downRoom`；搜尸必须置 `searched=true`；
  拖拽必须置 `bodyMoved` 且双向互指；尸体卡、`_t.bodyInfo()`、会议报告都要读同一套字段。
- **AI 认知**：`mind` 每夜清空（无跨夜记忆），`suspect` 每夜重置；新增行为必须同时更新
  `_t.mind()` / `_t.bodyInfo()` / 门禁断言，并避免让 AI 通过 `killedBy`、`alien` 或队友表获得隐藏身份。
- **异形身份信息**：异形之间**不共享身份**；AI **不得读取任何队友信息**，目标、会议指控和投票都不能按 `alien` 阵营过滤。
  人类只有目击异形专属行为（出刀 / 钻管道 / 破坏设备 / 停摆机器人 / 开枪）才写入 `suspect`；
  `witnessAlienAction()` 只服务人类目击，禁止恢复盟友表或队友透视。
- **物资申请单**：任务积分到 3 / 5 → `qualPending` 待领取 → 中央会议室**圆桌** `_doing='qual'` 站桩 3 秒领取
  1 张申请单 → 军械 / 医疗**专用补给点**消耗 `qual` 换子弹 / 医疗包。未领取时补给点必须拒绝。
- **硬掩体布局**：`M.cover` 是硬阻挡。任何掩体改动必须满足：房间连通、任务点可命中、
  同房间掩体间距 ≥1.2 格或贴墙、掩体不制造尽端死路；跑 `_t.coverAudit()` 必须 `gaps=[]`、`dead=[]`。
  改完必须用 Blender 重渲底图。
- **自动门**：`G.doors` 由房间门 + 走廊端点生成（当前 22 扇）；`doorTick()` 负责开合，
  `doorBlockedSegment()` / `losNow()` 负责移动与视线。门板纹理由扩散模型生成，门框由 Blender 烘焙；
  改门口几何后必须重跑 `tools/blender-ship.py`。
- **交互轮盘**：`E` 收集附近交互，`F` 统一施救（任何角色，需医疗包），`H` 才是异形破坏技（靠近机器人时给出「停摆机器人 / 破坏舱室」两项）；多项必须打开 `#wheel`，不得用固定优先级吞掉选择。
- **幽灵任务**：玩家幽灵可执行自己的剩余任务和故障维修，任务/故障均 1.6×，仍受 `tickDoing()` 移动打断；
  每只幽灵最多获得 **2 分**任务进度（`ghostPts` 跨夜保留，额度用尽后不能再接任务）；
  不能报告、搜尸、拖尸、施救、破坏或使用补给；AI 幽灵目前只随机飘动，不执行任务（欲开放需单独做平衡与门禁）。
- **站桩动作**：`tickDoing()` 对所有 `_doing` 一移动就打断；开始任务 / 维修 / 领取时必须清空 `path` 与 `moving`。
- **保安识别**：`SEC_RANGE = 14`、`SEC_ARC = π/2`（180° 前方半圆），行凶/攻击点必须在半径内、`losWalls` 无遮挡且在朝向扇形内；
  拘留 `60` 秒、每夜最多 `3` 次；改半径/弧形/次数需同步交互提示、绘制与门禁。
- **机器人受击**：保安 / 医疗机器人是实体目标；新增攻击入口必须走 `damageBot()` / `fireShotBot()`，
  同步 HP（保安 2 / 医疗 1）、`secbotDead` / `medbotDead`、`pendingCrime` 与目击证据。
  保安被攻击时会转向袭击者并尝试反制拘留；即使未造成濒死，危险行为也要写入 `pendingCrime`。
- **地图与底图**：改 `js/data/map.js` 的房间 / 墙体 / 门 / 走廊后，逻辑碰撞立即生效，
  但 `assets/scene/v4/base-lit.png` 必须用 `tools/blender-ship.py` 重新烘焙；无 Blender 时须在交付说明中标注底图未更新。
  改家具**材质**（`assets/scene/v4/tex/panel-metal|crate-steel|fabric-weave|table-composite|panel-white|hazard-stripe|ao-soft.png`）
  同样要重烘一次；材质由 `tools/gen-materials.py --mode sdxl` 用本地 SDXL 生成
  （768px 出图 → 降饱和冷调 → 四向镜像拼贴 → 回缩 1024）。
  该工具刻意**不走 diffusers 默认的 safetensors mmap 加载**（5.13GB fp16 UNet 在 16GB 内存机器上
  会 access violation 段错误），而是逐张量流式上卡 + 先编码提示词再释放文本编码器；
  没有显卡时用 `--mode reuse` 从场景已有素材派生兜底。
- **破坏与故障**：每个异形每夜一次破坏技；故障统一存 `G.dmg`，60 秒倒计时只在 `update` 里走。
  新增破坏入口必须走 `damageRoom()`，新增维修入口必须走 `startFix()`（`doing='fix'`，连续 10 秒，
  移动打断）。幽灵不可破坏；天亮清空故障且不扣分。

## 五、改动流程

1. 先读 `README.md`、本文件、`CHANGELOG.md` 最近条目。
2. 小步修改；涉及地图/寻路/会议/输入的改动，先 `npm start` 或直接 `file://` 冒烟。
3. 跑 `npm test`，确认「X 通过 / 0 失败」，并抽查 `tools/screenshots/` 的截图（元素存在 ≠ 像素可见）。
4. 更新 `CHANGELOG.md`（版本号 + 日期 + 实测读数）。
5. 提交并推送 GitHub / Gitee 的 `main`，仓库简介保持「新返航录 · 返航录V1」口径。

## 六、当前基线（返航录V1）

- 门禁：`node tools/test-v3.cjs` —— **360 通过 / 0 失败**（2026-10-29 实跑，Edge headless）。
- 门禁覆盖：地图全连通 / 4 管道口 / 25 任务点（中转间 102 格 / 配电室 148 格 / 引擎 216 格 / 会议室管道右上角）、
  22 扇自动门开合与视线/移动阻挡、机器人 4 点巡逻与运行时判定、
  AI 夜间能力（拉闸 / 停摆机器人 / 破坏舱室 / 钻管道 / 开枪 / 救人 / 补给）、
  破坏技选舱 / 60 秒故障 / -3 进度 / 连续 10 秒维修 / 幽灵不可破坏、暗处不可隔空开枪、
  异形互不知道身份 / AI 不读取队友信息 / 互刀 / 投票可投队友、统一移速、
  保安 14 格 180° 弧形 / 60 秒 / 每夜 3 次、机器人受击与摧毁、医疗机器人两次施救、站桩维修移动打断、
  物资申请单待领 → 圆桌领取 → 军械/医疗专用补给点、硬掩体阻挡/绕行 + coverAudit 零夹缝零死路、
  E/H 交互轮盘多项选择、人类管道禁用、AI 拐角寻路不卡死、异形投票目标不统一、
  任务乱序维修按实际点位结算、幽灵乱序任务/故障维修/2 分额度、AI 认知/证据链/搜尸/伤口状态/报告上限/异形自报/证据投票/
  Q 出刀 / B 开枪分离、7 类 CC0 音效采样。
- 浏览器冒烟：开始页版本号「返航录V1」→ 人类开局 15 席 / 303 项不变量全过 / 22 扇自动门 / 控制台零报错（2026-10-29）。
