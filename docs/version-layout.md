# 版本来源与保留

## 默认系统 A

- 交付仓库：`https://github.com/Chris-topher-jpg/julebu-base.git`，只向此仓库推送。
- 根目录与 `main` 现在运行系统 A，按[需求文档](https://docs.qq.com/doc/DVHFNRFJRSVJBakpq)简化，属于 A/B/C 三档最低档。功能范围见 [system-a.md](system-a.md)。
- `npm start`、`npm run dev`、`npm run preview` 默认运行 A。之后“拉取主支并预览”也使用 A。
- 默认业务数据库仍为 `data/club.sqlite`，原有订单、账号、消息与财务记录不删除；`CLUB_DATABASE` 可指定独立数据库。

```powershell
$env:PORT='4175'
npm run preview
```

打开 `http://127.0.0.1:4175/#/`。

## A 调整前的完整版本

- 保留分支：`codex/full-preserved-2026-10-09`，提交 `b238d508d73554f1ce768b55fe1a60df593dc7ae`。
- 该分支已推送到 base 仓库，保存 A 版调整之前的整个工作区，包括语音派单大厅和动态广场。
- 完整版本来源：只读仓库 `https://github.com/sssyyyyy111/julebuguanli.git` 的 `main`，快照提交 `7929033115855b0f189e0811107fe9c834f4ea82`（`feat: add public moments feed`）。不向来源仓库提交或推送，也不自动同步其后续提交。
- 完整体验需从该分支建立独立工作区并运行，A 根目录的前端不会通过参数恢复完整体验。预览时指定另一个端口和独立数据库副本，避免并发操作根目录业务库。
- Git 保留源码，业务数据库不在 Git 内；实际业务数据由本地持久化库及数据库备份保存。

## 最基础原始版

此版本是同步完整系统之前的原始基础版，与本次系统 A 不同。

- 保留提交：`30c01ff`（`feat: upload and preview game cover images`）。
- 全部 12 个已跟踪文件保存在 `editions/basic/`，源码、资源、配置示例、文档与测试保持原样。
- 原始提交另有分支 `codex/basic-preserved-2026-10-09` 保留。
- 用户说“最基础原始版本”时才使用此存档。
- 本地原订单、账号和上传封面保存在 `data/club-basic.sqlite`，未导入根目录业务库。

```powershell
npm run preview:basic
```

默认地址 `http://127.0.0.1:4176/#/`。启动器只读取 `BASIC_PORT`、`BASIC_CLUB_DATABASE`，避免继承 A 版的 `PORT` 或 `CLUB_DATABASE`。直接在 `editions/basic` 运行会使用该子目录的新数据库；接着查看原数据请使用根目录启动器。

## 验证与数据边界

```powershell
npm run build
npm test
npm run build:basic
npm run test:basic
```

数据库、凭据、日志和测试输出由 `.gitignore` 排除，不进入 Git。不得清空或混用两份业务库，不向来源 `julebuguanli` 推送。
