# 分支 form-ui-original · 表单式纯正原版（2026-10-25）

> **用途**：保存**表单式交互**的完整原版，供随时对照 / 取回 / 二次开发。
> **起点**：`bdf9b3d`（批 B，**批 R2「表单式设计彻底清除」之前**的最后一个提交）。
> **不是** backup 目录的副本 —— 这个分支是**可直接运行的整仓快照**（含引擎、AI、门禁、素材）。

## 一、这个版本长什么样

| 维度 | 表单式原版（本分支） | 现状 main（V2preview） |
|---|---|---|
| 主画面 | 圆桌场景 + **右侧三页签**（书记官档案 / 我的日记 / 阵营日记） | **房间制**：一次只画一间房，点门切换 |
| 行动提交 | 底部**表单面板**（`.opt` 选项块 + 提交按钮） | 点道具/席位 → 白框 → 委托同一套表单控件 |
| 发言 | 右栏**逐行流水** + 场景气泡 | 只有场景气泡（流水已删） |
| 公告 | 右栏按夜分组列表 | 行动面板逐条浮现 |
| 房间 | 8 个技能室 = 四角**文字卡** | 9 间房 = **真房间**（地板/墙/家具/门） |
| 角色 | DiceBear **矢量卡通** SVG | Cozy Space **像素小人**（4 方向行走图） |
| 账本 | 右栏 / DEV 里的**方框表格**（`.kv`） | 手写纸面账本 |

## 二、跑起来

```powershell
git checkout form-ui-original
npm start                      # → http://localhost:8766
npm run test:all               # 本分支自带当时的门禁（不含 test:space）
```

> ⚠ 本分支的 `package.json` 里 `version` 仍是 `V1preview`。若要基于它发版，记得升版本号
> （见 main 的 `AGENTS.md` §三 红线 7）。

## 三、常被问到的三件事

**⑴ 它和 `backup/form-ui-20261025/` 什么关系？**
那个目录**只归档了 4 类文件**（index.html / css / js/ui.js / js/ui-scene.js），**不含引擎与 AI**，
只能用来"取回视图层"，跑不起来一整局。本分支是**完整可运行**的整仓快照。

**⑵ 归档目录里的文件和这个分支一致吗？**
一致（已核对：`index.html` 与 `ui.js` 忽略换行符后**逐字节相同**，各 16750 / 82890 字符）。

**⑶ 从 main 切回本分支要注意什么？**
`js/space.js`、`assets/scene/cozy/`、`tools/test-space.cjs` 只在 main 存在，切回后它们会被移除
（git 安全保留，切回去就回来）。**不要在切到本分支时跑 main 的 `test:all`** ——
它会因为缺 `test:space` 而报找不到文件。

## 四、想把它变成一条独立产品线

```powershell
git checkout -b form-ui-revival form-ui-original   # 从原版开新线，不影响 main
```

再按需把 main 上**与视图无关**的改进 cherry-pick 过来（规则/AI/门禁都在
`js/engine*`、`js/v66/`、`js/ai/`、`tools/test-fix-v26.cjs`，与表单式/房间制**解耦**）。
