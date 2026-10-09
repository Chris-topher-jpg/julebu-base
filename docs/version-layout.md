# 版本来源与基础版保留

## 默认版本

- 交付仓库：`https://github.com/Chris-topher-jpg/julebu-base.git`。
- 同步日期：2026-10-09。
- 只读来源：`https://github.com/sssyyyyy111/julebuguanli.git` 的 `main`。
- 来源提交：`7929033115855b0f189e0811107fe9c834f4ea82`（`feat: add public moments feed`）。
- 根目录运行该完整版本；`npm start`、`npm run dev`、`npm run preview` 均使用完整版本。
- 同步保留来源应用、资源及测试。仅调整根目录 `AGENTS.md`、`README.md`、`package.json`，补充本仓库的推送边界、版本说明及基础版启动命令；不将来源仓库的交付目标套用到本仓库。
- 本次为源代码快照同步，不读取或迁移源仓库之外的业务数据库，也不会自动同步来源后续提交。

本地完整版本预览：

```powershell
$env:PORT='4175'
npm run preview
```

打开 `http://127.0.0.1:4175/#/`。默认数据库为仓库根目录的 `data/club.sqlite`；可用 `CLUB_DATABASE` 指定独立的完整版本数据库，不能指向基础版数据库。

## 同步前的基础原始版

- 保留提交：`30c01ff`（`feat: upload and preview game cover images`）。
- 全部 12 个已跟踪文件逐一保存在 `editions/basic/`，应用源码、图片、配置示例、文档与测试保持原样。
- 原始 Git 提交另有分支 `codex/basic-preserved-2026-10-09` 保留，可独立取回。
- 用户说“最基础原始版本”时使用此版本；其余预览默认使用根目录完整版本。
- 原有本地订单、账号和上传封面仍保存在 `data/club-basic.sqlite`，未导入完整版本。

需要基础版时，在仓库根目录执行：

```powershell
npm run preview:basic
```

默认使用 `http://127.0.0.1:4176/#/` 及原来的 `data/club-basic.sqlite`。启动器只读取 `BASIC_PORT`、`BASIC_CLUB_DATABASE` 作为端口与数据库覆盖项，避免继承完整版本的 `PORT` 或 `CLUB_DATABASE` 而误用数据库。无需切换分支或替换根目录源码。

直接在 `editions/basic` 内运行原版启动命令会使用该子目录下的新数据库。如需接着查看原有基础版数据，应使用根目录的 `npm run preview:basic`。

## 验证与同步边界

```powershell
npm run build
npm test
npm run build:basic
npm run test:basic
```

只向本仓库的 `origin/main` 和基础版保留分支推送，不向来源 `julebuguanli` 推送。数据库、凭据、日志和备份文件继续由 `.gitignore` 排除，不进入 Git。
