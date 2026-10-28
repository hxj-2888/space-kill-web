# AGENTS.md — 新返航录（太空杀游戏-完整版）

> **当前版本**：V2preview（规则口径 **v1preview1.0**，2026-10-17 换版；2026-10-25 起发布号升 V2）· `androidVersionCode` 11
> **一句话**：15 人三阵营身份博弈的可玩网页版规则引擎（零依赖前端 + AI 托管 + 蒙特卡洛推演）。
> **接手入口**：[`docs/交接文档_20261027_总览.md`](docs/交接文档_20261027_总览.md)（**最新·总览**：本轮 4 批全景 / 3 个「此前没人发现」的问题 / 38 条新断言 / 6 条教训 / 10 条遗留 / 下一批=整船图）→ [`docs/交接文档_20261027_UI7.md`](docs/交接文档_20261027_UI7.md)（素材质量批：12 张零引用瓦片接线 / 9 间房按中线重排 / 角色 32px→64px）→ [`docs/交接文档_20261026_总览.md`](docs/交接文档_20261026_总览.md)（总览：6 批 + 3 个 P0 全景 / 47 条新断言 / 15 条遗留）→ [`docs/交接文档_20261026_UI6.md`](docs/交接文档_20261026_UI6.md)（布局批：整体布局——房间 30×11 吃满主区 / 行动面板改贴底抽屉 / 五条「门禁没在测东西」的教训）→ [`docs/交接文档_20261026_UI5.md`](docs/交接文档_20261026_UI5.md)（删顶部 HUD → 桌子中央书记官记录 / 交互改为点物件 / P0 待机帧全员不可见）→ [`docs/交接文档_20261026.md`](docs/交接文档_20261026.md)（站点白名单收口 2 个 P0 / 弹层归位 / 15 套角色重做 / 去「绿色方框」）→ [`docs/交接文档_20261025_H1.md`](docs/交接文档_20261025_H1.md)（主页 = 游戏预览页）→ [`docs/交接文档_20261025_R2R5.md`](docs/交接文档_20261025_R2R5.md)（场景交互深化 R2~R5）→ [`docs/交接文档_20261025.md`](docs/交接文档_20261025.md)（同日早批：AI 7 批 + S0~S5 + 批 A/B/S4）→ [`docs/交接文档_20261021.md`](docs/交接文档_20261021.md) → [`docs/v7_交接文档_20261008.md`](docs/v7_交接文档_20261008.md)（完整结构）→ [`docs/README.md`](docs/README.md) → 本文。

---

## 一、开工前必读（顺序固定）

1. [`docs/v7_交接文档_20261008.md`](docs/v7_交接文档_20261008.md) —— 项目地图 / 红线 / 上手 SOP / 基线 / 回滚点
2. [`docs/返航录v1preview1.0_改动面清单_20261017.md`](docs/返航录v1preview1.0_改动面清单_20261017.md) —— 当前规则口径的逐条改动面
3. [`docs/README.md`](docs/README.md) —— 36 篇专题按性质分组，不要凭文件名猜
4. 本文 §三 红线 —— 违反其中任何一条，改动一律不接受

---

## 二、命令与门禁

### 2.1 常用命令

| 目的 | 命令 |
|---|---|
| 本地起服务 | `npm start`（`node server/server.js`） |
| **全量门禁** | `npm run test:all` |
| 规则回归（614 断言） | `npm run test:fix` |
| 站点白名单（部署/服务共用清单） | `npm run test:site` |
| 决策→物件映射表 | `npm run test:hudmap` |
| 加角色只改声明层（K1 验收） | `npm run test:addrole` |
| 加机制只改声明层 | `npm run test:addmechanism` |
| 夜间步位覆盖审计 | `npm run test:coverage` |
| UI 冒烟（真实浏览器 30 局） | `npm run test:ui` |
| 移动端布局（横屏锁定口径） | `npm run test:mobile` |
| 蒙特卡洛（500 局 / 种子 1） | `npm run mc -- 500 1` |
| 单局推演 | `npm run sim` / `npm run sim:human` |
| 轨迹与复盘叙事 | `npm run trace` / `npm run narrate` |
| 文档死链 | `node tools/check-docs.cjs` |
| 房间布局 + 素材 + 刷新 + 行走（29 条） | `npm run test:space` |
| 回放存档（12 条） | `npm run test:replay` |
| 规则数据（8 条） | `npm run test:rules` |
| 重新生成 15 套角色行走图（自带帧幅度自检） | `node tools/gen-crew-sprites.cjs --force` |
| 重新生成规则数据（三份 PDF → `js/data/rules.js`） | `python tools/gen-rules-data.py` |
| 重新生成内衬瓦片 | `node tools/gen-bg-tile.cjs --force` |
| 复核"这次会上传什么"（不上传） | `node tools/deploy-pages.cjs --dry-run` |

### 2.2 什么算"绿"

- `npm run test:all` **全过**；出现新失败一律当回归处理，不许写"历史问题"了事。
- `npm run mc -- 500 1` 的三阵营胜率与上一版**漂移 ≤ 3 个百分点**；超了必须解释是哪个机制导致的。
- `node tools/check-docs.cjs` 退出码 0。
- 历史基线（`303f9f8` 提交注明）：v26 570/0/30 · round-trip 102/0 · 加角色 9/0 · 加机制 9/0 · uismoke 30 局 0 异常。**新版本以最近一次提交的读数为准，并在记录里写明。**
  最近一次（2026-10-27，批 UI-8c）：v26 **614/0/31**（合计 645） · 房间布局 **29/0** · 决策→物件映射 **18/0** · 回放存档 **12/0**（新）· 规则数据 **8/0**（新）· 站点白名单 8/0 · round-trip 102/0 · 加角色 9/0 · 加机制 9/0 · uismoke 30 局 0 异常 · mobile 全过 · sim 60 异常 0 · 行为指纹 `f987ee99…0a43fb`（纯 UI/内容改动，逐位不变）。
  上一条（2026-10-27，批 UI-8a + UI-8b）：v26 614/0/31 · 房间布局 29/0（新增 T1~T3 + W1/W2）· 指纹逐位不变。
  上一条（2026-10-27，批 UI-7 素材质量）：v26 614/0/31 · 房间布局 21/0 · 指纹逐位不变。
  再上（2026-10-26，批 UI-6 整体布局）：v26 614/0/31 · 房间布局 11/0 · mobile 全过。
  ⚠ **读数必须来自本次实跑**：2026-10-25 交接文档曾把 AI 批 7 的 588/0/30 沿用到 S5 之后，
  实际 S5 已让 42.6 组 5 条变红（工具改了、断言没改）。接手先跑一遍再信文档。
- `npm run mc` 自 2026-10-21 起**缺省跑席位变体局**（`variants`）；要与历史读数比较必须显式
  `SK_MEASURE_SEATS=classic`。两套口径的产物分开落盘（`mc_result-variants.json` / `mc_result.json`），**不得混算**。

---

## 三、红线（违反即回退）

1. **声明层是唯一真相源。** 加/改角色只允许动 `js/v66/declaration/roleDecl.js`；
   其余文件 diff 必须为空，`npm run test:addrole` 就是这条的机械证据。需要动第二个文件 = 架构被破坏，先停下来说明。
2. **`life: 'archived'` 的字段零消费，不许"顺手接线"。** 它们是九关合规留痕；接上了会改变对局而不自知。
   `pending` 字段等机制上线再接。字段的 `life` 只能按"有无消费点"改，不许按"看起来没用"删。
3. **观测不得扰动随机流。** `g.rng` 是游戏级共享流，任何多调一次随机（哪怕在探针里）都会让整条流移位，
   推演结论与裸跑不同源。写探针时必须给随机流打桩——这条已经付过一次昂贵学费（见 v7 交接 §6.5）。
4. **禁止以"让胜率好看"为由改权重。** 残余偏差来自机制与接线缺口，属推理层问题，不许用调参掩盖。
5. **规则以正文 v1preview1.0 为唯一权威。** 代码与正文冲突时以正文为准；正文未写明处先裁定再实现，
   裁定结果写进记录。游戏名 2026-10-28 由「返航录」改为「新返航录」，**但 URL 与包名不动**（规则正文 PDF 标题与文件名仍为「返航录…」，属权威文件，不改名）。
6. **加载顺序只改一处。** 新增/删减 js 文件时改 `tools/load-order.cjs`，再 `node tools/sync-html.cjs`
   重生成 `index.html` 的 `<script>` 标签；**不要手改 index.html 的标签顺序**。
7. **版本口径单一。** `package.json` 的 `version`（`V2preview`）+ `androidVersionCode`（11）是真源；
   APK 经 `SpaceKill.apk.zip` 302 分发（`.apk` 不进 CDN 缓存，Pages 免费版不支持 Range）。
8. **改完 docs 必跑死链检查。** 删除任何文档时，同一次提交内修掉所有指向它的链接。
9. **「元素存在」≠「像素可见」。** 断言量的是结构与包围盒；一个把画面裁空的缺陷
   （2026-10-26 的 `clipPath` 坐标错位，待机帧 15 人全不可见）可以让 614 条断言全绿。
   动场景/角色/纸片的改动，**必须自己截图看**，不能只靠门禁。
10. **包围盒不是绘制范围。** 嵌套 `<svg class="sk-frame">` 的 `getBoundingClientRect`
   是 124×258（含整张 384×800 行走图的溢出），实际只画 57×95。
   判「有没有挡住人」一律用 `SKScene.seatRects()`（getScreenCTM 还原），不要拿包围盒。

---

## 四、文件地图（改之前先确认改的是哪一层）

| 路径 | 层 | 说明 |
|---|---|---|
| `js/v66/declaration/roleDecl.js` | **声明层（真相源）** | 角色属性只在这里声明一次 |
| `js/v66/declaration/{traits,capabilityRegistry,processRegistry}.js` | 声明层 | 特性 / 能力标签 / 进程形态 |
| `js/v66/contract/eventFamily.js` | 契约层 | 事件族命名 |
| `js/v66/derivation/` · `js/v66/execution/` · `js/v66/reveal/` | 派生 / 执行 / 可见性 | 由声明层推导，正常情况不该改 |
| `js/engine.js` | 规则引擎 | 夜间步骤机 + 白天流程 + 胜负判定（67KB） |
| `js/state.js` | 状态 | 对局状态与持久化 |
| `js/ui.js` | 渲染 | 112KB，**只改视图，不要在这里塞规则** |
| `js/ui-scene.js` | 场景渲染 | 房间/席位/角色/气泡/书记官记录板；`CREW_FILE(id)` 一对一派生行走图 |
| `js/hud-map.js` | **映射表（唯一真源）** | 决策 kind → (房间, 物件)；新 kind 必须同批补表，`npm run test:hudmap` 守 |
| `js/arena.js` | 主页交互 | 铭牌 / 设置 / 我这席 / **指定角色（两级）** |
| `js/ai/{util,belief,perceive,decide}.js` | AI 决策 | `ai.js` 只是门面转发 |
| `js/lang/*` | 叙事层 | 公告 IR / 禁语 / 复盘叙事 |
| `tools/site-entries.cjs` | **站点清单唯一真源** | deploy / server / android 三处共用 |
| `tools/load-order.cjs` | **唯一加载清单** | 浏览器与 Node 沙盒共用 |
| `tools/gen-crew-sprites.cjs` | 角色生成器 | 15 套行走图，改头饰见 `HEADS`；**自带帧幅度自检**（`auditSheet`，行走帧差异 < 400px 直接报错） |
| `tools/gen-bg-tile.cjs` | 内衬生成器 | 自绘无缝舱壁瓦片（`assets/scene/bg/hull-tile.png`）；换扩散模型图时直接覆盖产物即可 |
| `tools/gen-rules-data.py` | 规则数据生成器 | 三份 v1preview1.0 PDF → `js/data/rules.js`（职业卡 14 / 术语 164 / 流程图 8 页）。**改解析逻辑只改这里** |
| `js/data/rules.js` | **规则内容（派生物）** | 自动生成，勿手改；规则速览三页签的唯一数据源；不含任何 V6.6 |
| `js/replay-store.js` | 回放存档 | 纯 localStorage 读写，最多 3 局、满了覆盖最旧；**只接收经 `View.replayOf()` 取到的数组** |
| `tools/test-*.cjs` | 门禁 | 见 §2.1 |
| `assets/scene/crew/` | 角色行走图 | **本仓自绘**（见该目录 `LICENSE.txt`） |
| `assets/scene/cozy/` | 房间瓦片/家具 | **CC-BY 4.0，署名不可删** |
| `docs/` | 专题 | 索引见 `docs/README.md` |

---

## 五、记录要求

- 变更记录写在 [`改动说明.md`](改动说明.md)（历史命名，保留；格式同 `CHANGELOG`）。
- 每条按 `YYYY-MM-DD · 主题`（二级标题）+ 四类归档 + 五要素（现象/根因/改动/验证/未覆盖）。
- 尾部固定三节：`未做（本轮范围外）` / `已知遗留` / `已否决`。
- 模板与判据见桌面共享文档 `文档规范.md`（**不入库**，避免多仓副本漂移；本仓结构以 AGENTS.md 为准）。

---

## 六、提交前自检

- [ ] 改的是声明层还是实现层？加角色有没有只动 `roleDecl.js`？
- [ ] 有没有碰 `life: 'archived'` 的字段？
- [ ] 探针是否会多消费随机流？
- [ ] `npm run test:all` 全绿？新失败解释过没有？
- [ ] `npm run mc -- 500 1` 漂移在 3pp 内？
- [ ] 规则改动是否能在正文 v1preview1.0 里找到条款号？
- [ ] 新增/删除 js 文件是否更新了 `tools/load-order.cjs`？
- [ ] 文档链接是否还有效（`node tools/check-docs.cjs`）？
- [ ] 记录写了「未做」和「已知遗留」吗？
---

## 七、素材待更新（2026-10-25 用户留痕）

> 用户原话：「内衬素材先别管，留到 md 留痕，后续将会更新素材」；
> 「房间显得空的问题暂时搁置和内衬素材一起改」。

**当前状态**：批 U1 已把场景切到房间制（`js/space.js` + `js/ui-scene.js`），
素材统一到 Cozy Space 三件套（Interiors / Furniture / Walking Crew，**CC-BY 4.0，署名不可删**，
见 `assets/scene/cozy/LICENSE.txt`）。

**〔批 UI-7 · 2026-10-27〕"房间显空"已结案，但结论与当初的假设不同**：

量下来发现**素材并不缺**，缺的是接线 —— cozy 包里 7 种墙面变体 + 5 种地板（12 张瓦片）
一直零引用，9 间房共用同一张空白 `wall.png`。本批做的事：
1. 12 张瓦片全部接线（每间房声明 `wall[]`，**S6 反向守卫"没有零引用瓦片"**）；
2. 9 间房按中线 15 重排，中段补成对家具，密度 **4.5%→9.1%+**（**S4a 守下限**）；
3. 角色尺寸按帧内**可见内容**算，从 32px 修到 64px（`CREW_BOX`）；
4. 地板/四壁抽成唯一一份 `floorWallShell()`，主页与对局页共用。

**若要真的"换新素材"（而不是接线），仍需注意**：
1. 按新素材重做 `js/space.js` 的 `PROP` 尺寸表与各房 `props` 坐标；
2. 重跑 `node tools/test-space.cjs`（21 条：U1C 布局 + U1E 素材在位 + S1~S6 素材层）；
3. 换素材时注意：若新素材不再是 Cozy Space，**旧的 CC-BY 署名要一并移除**（漏署名整份素材不能用）；
4. **别再用"整块地板瓦片"当叠加层**做高光（批 UI-7 试了两版，见该批 §五.2）。
