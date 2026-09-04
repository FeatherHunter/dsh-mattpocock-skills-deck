# dsh-mattpocock-skills-deck

> DSH（DeepSeek Harness）Web 界面的 **Matt Skills Deck 控制面板**插件（Client + Host 双端）——**非官方** Matt Pocock 技能套件（mattpocock/skills）配套工具：wayfinder 地图/票务/进度、triage / grilling / handoff 动作注入。
> **设计理念**：Matt 的 map 拨开迷雾看到终点；本插件再加一层游戏式任务栏——接任务、推进一步、随时存档交接，每一步都清晰可见。
> **配合 [Matt Pocock skills](https://github.com/mattpocock/skills) 的 wayfinder / triage / grilling / handoff 等技能使用**：
> 输入区状态栏胶囊（可接/阻塞/沉淀/交接/环境/更新）+ 右侧 details 列面板（列表 / 技能 / 环境检查三视图，
> 唯一打开形式）+ GitHub issue 动作注入（诊断 / 修复 / 讨论 / 执行，均带 `/wayfinder` `/triage` 技能命令）
> + 交接开新会话。

- **插件包名**: `dsh-mattpocock-skills-deck`（可分发 npm 包，见 `package/`，当前 **v1.7.14**（`latest`，品牌迁移自 dsh-waystation v1.5.0，`npm view` 已验）：v1.4 详情页（#441）+ v1.5 升级 map 全量落地 —— 状态栏 BUG/诊断过滤 + 设置直达 + 删 panelHeight + Matt 引导 + 新增 wayfinder + 仓库身份 + 双语 + 仓库级缓存架构（git 根检测 → 磁盘缓存秒开 → 自动探测刷新）+ 进度契约与阶段闸门 + 正文格式容错 + markdown 白名单渲染 + 3 项 bug 修复 + T10 自动刷新机制（变化行高亮/即时转圈反馈））
- **动态版 pluginId**: `wfst-1`（v9–v24 迭代产物）
- **平台**: Client（浏览器页面）+ Host（Node 进程，gh CLI 数据层）
- **配套**: [mattpocock/skills](https://github.com/mattpocock/skills)（wayfinder / triage / grilling / handoff / ask-matt 等）
- **两种形态**: ① 正式安装（npm 一条命令，开机自启，推荐）；② 动态加载（进程内，会话级）
## 功能

| 模块 | 说明 |
|---|---|
| 状态栏胶囊 | 输入区上方：可接 / 阻塞 / 沉淀（零丢失快照）/ 交接 / 环境 / 更新，点击直达对应面板视图 |
| 面板 · 列表 | GitHub issue 全列表（map 置顶 + 子票迷你圆环进度）、标签过滤 chips（GitHub 配置色）、阻塞筛选、已关闭折叠、行级动作按钮；行布局 = 两行结构（编号/map 竖排 + 标题占满整宽限 2 行 + 标签/按钮行） |
| 标签贪心折叠 | 单行不换行：宽面板显示多标签、窄面板少标签（最少 1 个），放不下的折叠为 +N 弹窗（fixed 定位 · 自适应面板左右边界 · 内容完整可见） |
| 进度显示 | map 行右侧 18px 迷你圆环 + n/total（等宽数字右缘对齐，圆环零间隙） |
| 面板 · 技能 | 技能雷达（推荐 / 列表 / 圆环），点击注入 /skill |
| 面板 · 环境检查 | 8 项前置检查（仓库定位 / setup / tracker / gh CLI / 登录 / API / 技能探测），红黄绿分组 + 一键处理 |
| tabs 行 | 列表 / 技能 / 环境检查 + 右侧刷新按钮 + 最右侧版本号（如 v1.7.14），便于核对已更新 |
| 行级动作 | 按 label 四选一：诊断(/triage) / 修复(/wayfinder) / 讨论(/wayfinder) / 执行(/wayfinder)，按钮色 = GitHub label 配置色，点击预填输入框；执行/新会话按钮常显（复制/外链也常显） |
| map 详情 | 顶部「执行」+ 任务按状态动作、可接/已认领/被阻塞/已关闭垂直走廊、Decision/Fog/Out-of-scope 折叠 |
| 交接 | 第一击注入 /handoff 时间戳模板；第二击预填 /read + 复述确认 prompt 并开新会话 |
| 统一引导句 | 动作注入统一带「从第一性原理出发完成任务，并对抗式审查。」 |

## 使用方式

### 第 0 步：安装 DSH CLI（仅首次 · 一次性）

DSH CLI 提供 `dsh` 命令行工具（用于安装/更新/卸载插件、查看 DSH 状态）。
本插件的安装/更新/卸载都通过 `dsh` 命令完成。

**推荐一 · npm 全局安装（最常用）**

```bash
npm install -g @deepseek-ai/dsh
```

验证安装成功：

```bash
dsh --version
# 期望输出类似 dsh@1.0.x 或更新版本
```

⚠️ 如果 `dsh` 命令找不到（PATH 未配置）：
- **Windows**：npm 会自动把全局 bin 加到 `%APPDATA%\npm`，重启 cmd/终端即可
- **macOS / Linux**：可能需要手动加 `$(npm config get prefix)/bin` 到 `~/.bashrc` 或 `~/.zshrc`

**推荐二 · 不装 CLI，用 npx 临时跑**（不需要全局装）

```bash
npx --yes @deepseek-ai/dsh --version
```

`npx --yes @deepseek-ai/dsh` 等价于 `dsh`（每次首次会缓存包）。

### 方式一：正式安装（推荐 · 一条命令 · 装进整个 Harness · 开机自启）

用 DSH CLI（`dsh`）或 npx 临时命令（跨平台，Windows / macOS / Linux 同一句；
`~/.dsh` = DSH 的家，`DSH_HOME` 自定义过就换成它的路径）：

**前置推荐（可选但强烈建议 · 已装可跳过）——[dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)**：VSCode 风右侧边栏，面板在侧边栏并排打开效果最好；不装则回退到右侧 details 列打开。

```bash
dsh plugin --profile desktop add dsh-better-sidebar   # 与插件同一个 profile（web 服务用户换 --profile web）
```

**安装（已装过 DSH CLI）**——`--profile` 必填：装进你实际使用的 DSH 入口对应的 profile，**装错 profile 等于没装**（重启也不会加载）：

```bash
dsh plugin --profile desktop add dsh-mattpocock-skills-deck   # DSH Desktop 桌面应用（对应 desktop profile，绝大多数人）
# dsh plugin --profile web add dsh-mattpocock-skills-deck     # 自启 web 服务（dsh web）用户
```

**安装（未装 DSH CLI，用 npx）**：

```bash
npx --yes @deepseek-ai/dsh plugin --profile desktop add dsh-mattpocock-skills-deck   # DSH Desktop 桌面应用
# npx --yes @deepseek-ai/dsh plugin --profile web add dsh-mattpocock-skills-deck     # 自启 web 服务用户
```

**或者：把安装交给你的 AI**（复制下面提示词发给 AI，它会读仓库、检查环境、按需安装，已装步骤自动跳过）：

```text
请帮我安装 DeepSeek Harness 插件 dsh-mattpocock-skills-deck（MattSkills）。
先读仓库 README：https://github.com/FeatherHunter/dsh-mattpocock-skills-deck
先确认我实际使用的 DSH 入口对应哪个 profile（DSH Desktop 桌面应用 → desktop；自启 web 服务 → web），把插件装进正确的 profile；
然后自行检查环境并按需安装（已装的跳过），完成后简要汇报结果。
```

- 命令把插件装进 **指定的 profile**（`~/.dsh/profiles/<profile>/node_modules`），同步该 profile 的 `package.json`
  并自动 reconcile 注册（bundle 装配）。**各 profile 互相独立、互不同步**——两个入口都想用就各装一次。
  装完**重启对应的 DSH 入口**生效（桌面应用：完全退出并重开 DSH Desktop；web：重启 `dsh web` 后刷新页面），之后每次 DSH 启动自动加载。
- 🩺 **装了重启还是没面板？九成是 profile 没对上**：核对 `~/.dsh/profiles/<你的profile>/package.json`——
  `dependencies` 里应有 `dsh-mattpocock-skills-deck`，且 `dsh.profile.bundles` 数组里应有同名条目。
  桌面应用当前选中的 profile 见 `%APPDATA%\DSH Desktop\profile-selection\state.json` 的 `"active"` 字段。
- ✅ **一键装完即用（bundle 装配）**：本包声明 `dsh.bundle.patch`（包根 `cordis.patch.yml`），
  `dsh plugin add` 自动把包加入 profile 的 `dsh.profile.bundles`，启动时 loadProfile 自动应用——
  **无构建脚本**（pnpm v10 不再拦截），无需手动编辑任何文件；`dsh plugin remove` 自动移除。

- ⛔ **千万不要用 `npm install --prefix ~/.dsh/profiles` 安装**：`profiles/node_modules` 是 DSH 的
  **扁平回退软链区**（启动时 `healProfilesModuleFallback` 自动重建，装的是 npx 全家桶），
  npm `--prefix` 会把它当新项目，把 package.json 未声明的包（含你的插件）**全部 prune 掉**。
  **2026-08-14 实测事故**：一次安装插件连带删掉 511 个包，DSH 插件全部加载失败。
  插件正确安装位 = `profiles/web/node_modules`（官方命令负责），注册写 `web/cordis.patch.yml`。
- 为什么不用 `npm install -g`：`-g` 装到 `%APPDATA%\npm\node_modules`，而 Node 的默认解析链
  **不包含该目录**（本机实测 `require.resolve` 失败）——DSH 进程 require 不到，装了也白装。
  独立 CLI 应用（如 `dsh-feishu-bot`）靠 bin 快捷方式运行所以能 `-g`；**插件必须被 DSH 进程
  解析**，所以装 Harness 自己的 profile。

**升级**（desktop profile 用户把 `--profile web` 换成 `--profile desktop`）：

```bash
dsh plugin --profile web update dsh-mattpocock-skills-deck
# 或用 npx：npx --yes @deepseek-ai/dsh plugin --profile web update dsh-mattpocock-skills-deck
```

> **⚠️ 更新后仍显示旧版本？（DSH 平台问题，非本插件 BUG）**
> 这是 **DSH 桌面端**的 `pnpm` 供应链策略 `minimumReleaseAge` 导致——刚发布的新版本会被 `dsh plugin update` / 插件市场的“更新”按钮**静默忽略**（`pnpm update` 不报错但也不更新，需等待数小时）。**更新后请务必完全退出 DSH 再重开，并 Ctrl+F5 刷新页面**才能看到新版本（如 `v1.6.14`）。若刚发布后立即更新仍不生效，请显式执行：
> ```bash
> dsh plugin --profile web add dsh-mattpocock-skills-deck@latest --registry https://registry.npmjs.org
> ```
> 或等待数小时后重试。此为 DSH 平台行为，已实测复现（`pnpm update` → `Packages: -2` 仍 `1.0.0`；`pnpm add @1.6.14` → `Added 1` 才成功）。

**卸载**（同样注意 profile 对应）：

```bash
dsh plugin --profile web remove dsh-mattpocock-skills-deck
# 或用 npx：npx --yes @deepseek-ai/dsh plugin --profile web remove dsh-mattpocock-skills-deck
# 并手动删除 cordis.patch.yml 里的 dsh-mattpocock-skills-deck insert 块（或保留，DSH 找不到包会忽略）
```

> 原理：DSH 的 `dsh.client` 插件机制（`dsh-client-modules`）会扫描组合里声明了
> `dsh.client: { platform: 'web' }` 的包，把 `exports["./client"]` 指向的 bundle
> 伺服为 `/plugins/<id>/client.js` 并注入 `window.__DSH_BOOT__`，浏览器内核在启动
> 时自动挂载该插件条目。宿主半 `lib/index.js` 通过 `ctx.connection.rpc` 注册
> `/dsws` RPC 通道（gh CLI 数据层），Client 半经同一通道取数。

### 方式二：动态加载（零安装 · 会话级 · 重启失效）

在 DSH 会话中由 Agent 通过 Cordis 工具链加载：

1. `cordis_define` —— plugin 用 `kind: new`、`idPrefix: wfst`，code.host 填入
   [host.js](./host.js) 的内容、code.client 填入 [client.js](./client.js) 的内容。
2. `cordis_run` —— 首次运行需在界面批准（安全机制，Client 代码要在页面执行）。
3. 生效后输入区出现 Matt Skills Deck 胶囊；Run 卡片内出现控制面板。

## 数据层说明（宿主半）

- 依赖：`gh` CLI（兜底路径 `DSH_GH_PATH` 环境变量（未设置时走系统 `gh`））+ git 仓库工作目录（默认
  `D:\2Study\StudyNotes\SKILLS`，可随会话 cwd 切换）。
- 数据流：`gh issue list` 枚举全量 issues（map 列表从中过滤 `wayfinder:map`）→ **GraphQL aliases 一次查询全部 map 详情**（subIssues + labels + assignees + blockedBy）→ 组装快照（map 五区块解析 + tickets + stats）。
- RPC 通道 `/dsws`：`status` / `snapshot` / `refresh` / `cwd` / `handoffLatest` / `claim`。
- 刷新策略：纯手动（状态栏「更新」/ 列表「刷新」/ 打开面板即刷）+ **60s 快照缓存**、30s 环境检查缓存。
- 性能：v1.3.3 起快照加载 ~35s → ~12s（aliases 批量 8 次 GraphQL → 1 次）。

## 作者的其他作品

喜欢这个插件的话，这些可能你也用得上：

- [**dsh-opencode-palette**](https://github.com/FeatherHunter/dsh-opencode-palette) —— 喜欢 opencode 的配色？让 DSH 也穿上它 —— 34 款经典主题，眼睛舒服了，码字也开心。
- [**dsh-prompt**](https://github.com/FeatherHunter/dsh-prompt) —— 写 Prompt 卡壳的时候，里面有 24 条深度模板，点一下直接进输入框。

## v1.3.3 新增（2026-08-15）

- 13 项用户 bug 修复（配置面板全展开 / textarea 自适应 / 占用→阻塞 / 按钮常显 / map 完成态 / 双 loading 修复等）
- UI 逐版定稿：C 卡片式两行结构、编号/map 竖排、18px 迷你圆环进度、标签贪心折叠 +N 弹窗（自适应面板）、窄屏按钮正方形
- tabs 行刷新按钮 + 最右侧版本号 v1.3.3
- 快照性能提速 ~35s → ~12s（GraphQL aliases 批量 + 合并 fetchMaps + 缓存 60s）
- 开发工作流文档 docs/workflow/DEV-WORKFLOW.md（改 bug → 实时生效完整流程）

## v1.5.0 新增（2026-08-16/17）

- 状态栏「BUG / 诊断」一键过滤（带计数）+ 设置左侧直达 + 删「面板默认高度」
- Matt 技能安装引导（设置页 + 环境检查页）+「新增 wayfinder」按钮（prompt 带仓库信息）+ 仓库身份组件
- 全量中英双语 + 进度契约（## 进度：N%）与阶段闸门（needs-triage 前置诊断）
- 仓库级缓存数据架构：git 根上溯检测 → 宿主磁盘缓存 → 打开/重启秒开 → 自动探测刷新（probe + 轮询 + focus + 动作后）
- 正文格式容错自愈（字面 \n + BOM 还原）+ 正文格式契约 + issue 正文 markdown 白名单渲染
- 3 项 bug 修复（setup 误报 / 新会话 prompt 缺 issue 标识 / 完成态按钮配色）+ 手动刷新去遮罩（按钮即时转圈反馈 · 文字恒定）+ 变化行高亮/新增绿闪/删除提示

完整变更历史见 [CHANGELOG.md](./CHANGELOG.md)。

## 文件

- `host.js` / `client.js` —— 动态版源码（cordis_define 的 `code.host` / `code.client` 函数体）
- `package/` —— **可分发插件包**（正式安装用，标准 npm 包结构）
  - `package.json` —— 包声明：`dsh.client`（platform web / immediately）+ `dsh.bundle.patch`（装配）
  - `cordis.patch.yml` —— bundle 装配 patch（`dsh plugin add` 自动应用，无构建脚本）
  - `lib/index.js` —— 宿主半（ESM：gh 数据层 + `/dsws` RPC 通道注册）
  - `lib/client.js` —— 浏览器半 bundle（`window.__ModuleLoader__.load` 注册格式）
- `README.md` —— 本说明
- `issues-checklist.html` —— 迭代需求清单（v9–v24，43+ 项）
- `docs/DESIGN.md` / `prototype.html` —— 设计定稿与原型
- `tests/` —— host 逻辑测试（verify-status / verify-panel）

## 备注

- 若动态版（方式二）与正式安装版同时生效，两套 UI 会同时出现（同名插槽注册），
  建议保留正式安装版即可，动态版 `cordis_stop` 掉。
- 本插件需要 GitHub 仓库工作目录（wayfinder 地图仓库）才能取到数据；
  非仓库目录下环境检查会提示「仓库定位」未就绪。
- 用户界面偏好（开始模板等）存浏览器 localStorage，与动态版共用同一 key。