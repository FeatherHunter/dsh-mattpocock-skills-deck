# ADR：更新模块的安装执行端口 — 桌面服务优先 + 普通 DSH 兜底（#548）

> 日期：2026-09-08 定版（维护者拍板 Q2「两种宿主都支持」与 Q4「下载量必须被正确统计」；承接 #534 通用方案与 #542 安装闭环落地）
> 地位：更新模块（update-core，未来对外共享的 TS 模块）执行安装的唯一执行端口约定；#548 落地按本文件执行，凡与本文冲突的旧写法以本文为准。
> 版本与效力：本文件落盘后，凡与本决策冲突的旧方案/契约/讨论，以本文件（更新日期者）为准；未来任何讨论若改动本决策，以未来版本为准（CONTEXT.md 同款两条规则）。

---

## 1. 背景与实测依据

三层分工已在 #537 定版：核心只出政策（拼什么命令、走哪条路由），跑腿在适配器。#542 把安装闭环落地时，真执行器留了一个 Windows 缺口——`platform === 'win32'` 直接报安装失败转手工命令。2026-09-08 在本机（Windows + DSH Desktop）实测：

| 写法 | 结果 |
| --- | --- |
| `spawn('dsh', ['--version'])` | `ENOENT`：PATH 上是 `dsh.cmd`，不是可执行文件 |
| `spawn('…\dsh.cmd', ['--version'])` | `EINVAL`：Node 不带 shell 不能执行 `.cmd` / `.bat` |
| `spawn('cmd.exe', ['/d', '/s', '/c', 'dsh --version'])` | 退出码 0：能跑，但这是拼 shell 文本 |
| `spawn(垫片全路径, ['--version'], { shell: true })` | 退出码 0，同时 Node 报 `DEP0190`：带 shell 传参数不转义、只拼接 |

同时确认：DSH 自己的子进程能力内部就是 `spawn(程序, 参数数组, …)`，**没有 shell 选项**；它的可执行文件解析会按 `PATHEXT` 找到 `dsh.cmd`，但拿到路径照样执行不了。DSH Desktop 的公开契约也写明：插件作者无需发现 `.cmd` shim，也不应拼接 shell 文本。

另一处实测：本机 `~/.npmrc` 的默认源是镜像（`registry=https://registry.npmmirror.com`）。npm 的下载量统计来自官方源返回的 tarball 响应（见 §4），所以**不带 `--registry=https://registry.npmjs.org/` 的安装不计入下载量**。

## 2. 决策

### 2.1 宿主决定路由，使用范围决定目标

- 宿主分两种，判断信号只有一个：`ctx.get('desktopProfiles')` 是否有值（DSH Desktop 的 launcher 在 Loader entry 挂载前就注册它）。**不得用使用范围名判断宿主**——本机桌面端当前激活的使用范围就是 `web`。
- 安装目标始终是「本插件当前所在的那个使用范围」，与宿主无关；每个使用范围各有一份安装与一份更新状态目录，互不影响。

### 2.2 一律「程序 + 参数数组」，不拼 shell、不走 PATH 上的命令名

- 执行安装只用「明确的程序路径 + 参数数组」，经宿主注入的子进程能力起进程。
- 禁止三件事：把命令拼成字符串再按空格拆回参数；经 shell 执行；用 PATH 上的 `dsh` 命令名（Windows 上是 `.cmd` 垫片，且 PATH 上可能有多个来源）。
- 理由见 §1 实测；字符串拆分还会把含空格或非 ASCII 的使用范围名切错或带上字面引号。

### 2.3 桌面宿主：复用 DSH Desktop 的公开服务

- 用 `desktopPnpm.runPlugin(参数, 使用范围目录, signal)`：由桌面端自己用参数数组拉起打包好的 DSH CLI，`.cmd` 垫片与进程树归属都由它处理。
- 只依赖公开服务 `desktopProfiles` 与 `desktopPnpm`；`desktopPnpmBootstrap` 等 launcher 私有值不得读取（官方契约明列）。
- 跨环境写法：`ctx.get('desktopProfiles')` 为空即普通 DSH；有值再嵌套 `ctx.inject(['desktopPnpm'], …)`，不把桌面服务放进顶层依赖声明。

### 2.4 普通 DSH 宿主：自己起进程

- 用「当前运行时的可执行文件 + CLI 的 JS 入口 + 参数数组」：`[当前运行时, …运行时参数, CLI 入口, 'plugin', '--profile', 使用范围名, …]`。
- CLI 入口必须来自「正在运行的这份 CLI」（由运行入口反查 `@deepseek-ai/dsh` 包并校验），不用 PATH 上的命令名——否则可能装到别的使用范围或用错版本。
- mac / linux 本票落地并加门禁；**Windows 待真机验证**（真机由维护者跑）。跑不通按 §2.6 降级。

### 2.5 官方源与精确版本是硬要求

- 所有会触发真实安装的路径——按钮（桌面宿主）、按钮（普通 DSH）、手工兜底命令文本——一律带 `--registry=https://registry.npmjs.org/`，并加门禁断言。
- 一律带 `--save-exact`：pnpm 默认把 `包@1.0.0` 写成 `^1.0.0`，与本模块「精确版本」政策不符（社区市场与 dsh-im 都显式加了这个参数）。
- 官方源不可达时报诚实失败，**不静默回退镜像**——回退就丢下载量统计。
- 手工命令附带「网络受限时可去掉 `--registry=`」的说明，避免兜底失效。

### 2.6 探测不到或跑不通：诚实失败转手工命令

- 拿不到宿主信号、拿不到 CLI 入口、起进程失败、退出码非零——一律报安装失败并给出手工命令，不猜、不静默换源、不静默换 CLI。

## 3. 后果

- 正向：三系统共用同一套参数数组，Windows 不再有「必走手工命令」的死角；核心保持纯（只出政策）；端口边界与 deck 的具体接线无关，可被其他 DSH 插件项目复用；下载量统计覆盖到按钮安装路径。
- 代价：适配器要接宿主注入的子进程能力与平台层的可执行文件解析；新增门禁断言（路由选择 + 参数形态 + 官方源）。
- 风险与缓解：普通 DSH 的 Windows 路线未验证 → 先实现并加门禁，真机不通就按 §2.6 降级，并在本文件变更记录里写明；`--registry=` 被后人当冗余删掉 → 由门禁断言兜住；桌面服务契约变化 → 只依赖公开 service 名与契约模块。

## 4. 上游依据与引用

- 通用方案：`docs/research/534-plugin-update-scheme.md`（更新功能的整体方案；本文只定执行端口）
- 接口决议：#537（核心只出政策，跑腿在适配器）
- 安装闭环落地：#542（本文补的正是它刻意留下的 Windows 缺口）
- DSH Desktop 公开契约：https://github.com/anywhere-labs/dsh-desktop/blob/master/dsh-plugin-desktop/docs/plugin-services.zh.md （`desktopProfiles` / `desktopPnpm`；Windows 上 provider 用 argv 启动打包好的 pnpm entry，插件作者无需发现 `.cmd` shim）
- 对照实现：dsh-im 的 `plugin-src/host/update-runtime.mjs`（用运行中的 CLI 入口加参数数组；Windows 命令行路线它直接拒绝）
- npm 下载量统计口径：https://blog.npmjs.org/post/92574016600/numeric-precision-matters-how-npm-download-counts-work.html （统计 = 官方源返回的 tarball 200 响应；镜像不计入）
- 落地：本票 #548（实施记录写回票内）

## 5. 变更记录

- 2026-09-08 初版（维护者拍板 Q2 / Q4 后落盘，早于 #548 落地）。
- 2026-09-08 落地记录（#548）：本 ADR 的口径未调整，按原文实现。三条落地事实写在这里备查：
  (1) 桌面路由额外加一道「激活使用范围必须等于本插件所在使用范围」的校验——桌面服务固定装进激活范围，对不上就诚实失败，不装错范围；
  (2) 手工兜底命令按 §2.5 补上 `--registry=https://registry.npmjs.org/` 与 `--save-exact`，面板在命令下方给一句「网络受限可去掉源参数」的说明；
  (3) 普通 DSH 的 Windows 路线已实现（不按操作系统分支），真机验证仍由维护者跑，见 #548 待确认事项 Q1。
