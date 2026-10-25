# backup/ · 表单式 UI 归档（2026-10-25）

> **用途**：这次重新设计把「表单式」交互整体退役（发言流水、公告列表、右侧三页签、
> 场景外的一切面板），旧实现按用户要求**备份到这里**再从产品里清除。
> **本目录不入构建、不参与加载**（`tools/load-order.cjs` 不含任何 backup 路径）。

## 归档内容

| 文件 | 归档时的状态 |
|---|---|
| `index.html` | 场景化 S0~S4 之后的完整页面（含右栏三页签 `#nb-tabs`、`#stage-body` 行动面板、`#chatlog` 已退役但 CSS 仍在） |
| `css/` | 全部分片 01~07（含 07 开始页船桥主题） |
| `ui.js` | 表单式渲染主体：`renderForm` / `renderSide` / `renderStage` / 书记官档案 / 日记本 |
| `ui-scene.js` | 场景渲染器（圆桌 15 席 + 房间环 + 书记官 + 气泡） |

## 取回方式

```powershell
Copy-Item backup\form-ui-20261025\index.html .\index.html -Force
Copy-Item backup\form-ui-20261025\css\* .\css\ -Force
Copy-Item backup\form-ui-20261025\ui.js .\js\ui.js -Force
Copy-Item backup\form-ui-20261025\ui-scene.js .\js\ui-scene.js -Force
```

⚠ 取回后必须重跑 `npm run test:all`：新设计已删除的 DOM id 若被断言引用，会出现
「文件级断言通过但页面空白」的假绿（这是本仓踩过的坑，见 `docs/交接文档_20261025.md` §七）。
