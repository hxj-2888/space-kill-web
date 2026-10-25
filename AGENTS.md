# AGENTS.md — 返航录（太空杀游戏-完整版）

> **当前版本**：V1preview（规则口径 **v1preview1.0**，2026-10-17 换版）· `androidVersionCode` 9
> **一句话**：15 人三阵营身份博弈的可玩网页版规则引擎（零依赖前端 + AI 托管 + 蒙特卡洛推演）。
> **接手入口**：[`docs/交接文档_20261025.md`](docs/交接文档_20261025.md)（**最新**：AI 推理优化 7 批 + 场景化 UI 改造 S0~S5——圆桌场景即主页面、表单式三栏退役；含 V.humanId 等 7 条踩坑实录）→ [`docs/交接文档_20261021.md`](docs/交接文档_20261021.md) → [`docs/v7_交接文档_20261008.md`](docs/v7_交接文档_20261008.md)（完整结构）→ [`docs/README.md`](docs/README.md) → 本文。

---

## 一、开工前必读（顺序固定）

1. [`docs/v7_交接文档_20261008.md`](docs/v7_交接文档_20261008.md) —— 项目地图 / 红线 / 上手 SOP / 基线 / 回滚点
2. [`docs/返航录v1preview1.0_改动面清单_20261017.md`](docs/返航录v1preview1.0_改动面清单_20261017.md) —— 当前规则口径的逐条改动面
3. [`docs/README.md`](docs/README.md) —— 30 篇专题按性质分组，不要凭文件名猜
4. 本文 §三 红线 —— 违反其中任何一条，改动一律不接受

---

## 二、命令与门禁

### 2.1 常用命令

| 目的 | 命令 |
|---|---|
| 本地起服务 | `npm start`（`node server/server.js`） |
| **全量门禁** | `npm run test:all` |
| 规则回归（588 断言） | `npm run test:fix` |
| 加角色只改声明层（K1 验收） | `npm run test:addrole` |
| 加机制只改声明层 | `npm run test:addmechanism` |
| 夜间步位覆盖审计 | `npm run test:coverage` |
| UI 冒烟（真实浏览器 30 局） | `npm run test:ui` |
| 移动端布局（横屏锁定口径） | `npm run test:mobile` |
| 蒙特卡洛（500 局 / 种子 1） | `npm run mc -- 500 1` |
| 单局推演 | `npm run sim` / `npm run sim:human` |
| 轨迹与复盘叙事 | `npm run trace` / `npm run narrate` |
| 文档死链 | `node tools/check-docs.cjs` |

### 2.2 什么算"绿"

- `npm run test:all` **全过**；出现新失败一律当回归处理，不许写"历史问题"了事。
- `npm run mc -- 500 1` 的三阵营胜率与上一版**漂移 ≤ 3 个百分点**；超了必须解释是哪个机制导致的。
- `node tools/check-docs.cjs` 退出码 0。
- 历史基线（`303f9f8` 提交注明）：v26 570/0/30 · round-trip 102/0 · 加角色 9/0 · 加机制 9/0 · uismoke 30 局 0 异常。**新版本以最近一次提交的读数为准，并在记录里写明。**
  最近一次（2026-10-24 AI 批 7）：v26 **588/0/30** · round-trip 102/0 · 加角色 9/0 · 加机制 9/0 · uismoke 30 局 0 异常 · text-align P0 0 · card-audit 0 处差异 · 行为指纹 `f987ee99…`（批 3 语音派生流；批 4 `Tiers.DECIDE` 收口；批 5 project 记忆化；批 6 心声主源；批 7 mind 三轴实装 + dangerOf attend 角色项）。
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
   裁定结果写进记录。游戏名已改「返航录」，**但 URL 与包名不动**。
6. **加载顺序只改一处。** 新增/删减 js 文件时改 `tools/load-order.cjs`，再 `node tools/sync-html.cjs`
   重生成 `index.html` 的 `<script>` 标签；**不要手改 index.html 的标签顺序**。
7. **版本口径单一。** `package.json` 的 `version`（`V1preview`）+ `androidVersionCode`（9）是真源；
   APK 经 `SpaceKill.apk.zip` 302 分发（`.apk` 不进 CDN 缓存，Pages 免费版不支持 Range）。
8. **改完 docs 必跑死链检查。** 删除任何文档时，同一次提交内修掉所有指向它的链接。

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
| `js/ai/{util,belief,perceive,decide}.js` | AI 决策 | `ai.js` 只是门面转发 |
| `js/lang/*` | 叙事层 | 公告 IR / 禁语 / 复盘叙事 |
| `tools/load-order.cjs` | **唯一加载清单** | 浏览器与 Node 沙盒共用 |
| `tools/test-*.cjs` | 门禁 | 见 §2.1 |
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
