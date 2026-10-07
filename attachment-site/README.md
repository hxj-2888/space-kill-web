# 附件站（规则 / 剧情 / 模拟成果）

本目录是**太空杀附件站**的完整内容：规则正文、三条胜利线剧情、平衡性模拟成果。
线上站点：<https://space-kill.pages.dev>

它与游戏本体（仓库根目录的 `index.html` / `js/` / `css/`）是**两个站点**：

| | 游戏本体 | 附件站 |
|---|---|---|
| 线上 | <https://space-kill-web.pages.dev> | <https://space-kill.pages.dev> |
| 入口 | 仓库根 `index.html` | 本目录 `site/index.html` |
| 部署 | `android/sync-www.cjs` → APK；`tools/deploy-pages.cjs` → Pages | 由 Cloudflare Pages 直接托管 `site/` |

两站的部署白名单互不重叠，所以本目录**不会**被打进 APK，也不会出现在游戏站上。

---

## 为什么它在这个仓库里

附件站原先的源码仓库 `hxj-2888/space-kill` 在 GitHub 上**不存在**（404 已搁置），
唯一存在的 Gitee 同名仓库是**另一个项目**（Python 附件站工具，非本项目）。
本地克隆的 `origin` 因此指向一个不存在的地址 —— 也就是说附件站的改动长期无处可推，
这直接导致了一次真源与产物脱节（见下）。

把内容并入游戏仓库 `space-kill-web`，使其与游戏代码一起进 GitHub、一起版本化。

## 目录结构（保持原样，`tools/build_site.py` 的路径依赖它）

```
attachment-site/
├─ tools/          生成器（build_site.py / gen_mc_report.py / pdf_to_md.py / inspect_docx.py）
├─ 剧情/           三条胜利线 docx + 规则正文 PDF 原件（构建输入）
├─ 公测3.1/        规则正文 markdown + sim_output/（模拟原始数据与报告）
└─ site/           构建产物 —— 部署的就是这个目录
```

`build_site.py` 用 `ROOT = dirname(dirname(__file__))` 定位根目录，因此放在
`attachment-site/tools/` 下即可原样运行，无需改任何路径。

## 重建

```bash
cd attachment-site
python tools/build_site.py          # 源（docx / md / pdf）→ site/ 静态页
```

需要 `python-docx==1.2.0`（版本锁定，防上游大版本破坏构建）。

蒙特卡洛报告是**两段式**的：游戏引擎产出原始 JSON，再由本目录的脚本转成页面。

```bash
# 1) 在游戏仓库根目录跑引擎（10 万局级耗时约 13 分钟）
node tools/mc.cjs 10000 1
#    → 产物写到 <游戏仓>/../.tmp_docs/mc_result.json
# 2) 用它刷新真源并重新生成报告
cp ../.tmp_docs/mc_result.json 公测3.1/sim_output/mc_10000_result.json
python tools/gen_mc_report.py 公测3.1/sim_output/mc_10000_result.json
python tools/build_site.py
```

**数字未经手工修改** —— 报告页的每个数值都由 `gen_mc_report.py` 从 JSON 渲染。
改了 JSON 就必须重新生成，直接编辑 `site/*.html` 会与真源脱节。

## 踩坑：规则 PDF 带 ReadOnly 属性

`site/` 与 `剧情/` 里的 `太空杀V6.6正文_v66修订版.pdf` 在 Windows 上带 **ReadOnly**
属性，`build_site.py` 最后一步的 `os.remove(pdf_dst)` 会抛
`PermissionError: [WinError 5] 拒绝访问`。

脚本里那句注释写的是「Windows 上直接 copy2 覆盖会被占用拒绝」——**归因写错了**，
不是文件被别的进程占用，而是文件属性。清除只读即可：

```powershell
Get-ChildItem -Recurse -File | Where-Object { $_.IsReadOnly } | ForEach-Object { $_.IsReadOnly = $false }
```

Linux CI 跑在容器里没有这个属性，所以从未暴露。新克隆本目录后若在 Windows 上重建，
先执行上面这行。

## 已知的迁出遗留

以下内容在原附件站仓库里存在，**本次未并入**（构建链不需要）：

- `公测1.0/`、`公测3.0/` —— 旧版本门户。`build_site.py` 里 `SRC3`（指向 `公测3.0`）
  是**死变量**，全文从未被引用，可证构建不依赖它们。
- `公测3.0/sim_output/` 的旧模拟产物。
- `.github/workflows/deploy.yml` —— 原 GitHub Actions 部署脚本。因对应 GitHub 仓库
  404，该工作流从未真正执行过；本目录改为直接托管 `site/`。

如需一并保留，把上述目录复制进本目录即可（`build_site.py` 不受影响）。

## 版权与授权

规则正文与剧情为《太空杀》原创内容，随站分发以供查阅。