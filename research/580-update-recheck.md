# 研究：现有更新链路复核与抽包清单（#580）

> 归属地图：#579《可复用更新系统：抽成独立 npm 包，当前插件做第一个用户》。
> 本报告只给证据与清单，不写实现代码，不改地图正文。
> 读法约定：每个结论后面跟的括号是第一手来源（文件路径加行号），行号以本分支基线（main，插件版本 1.7.17）为准。
> 用词沿地图 #579：包指装着更新系统的 npm 包；电话指宿主对外提供的方法；使用范围指 profile（一套隔离的插件安装位置，默认名 web）。

## 1. 现有链路一句话复核

链路分四段，首尾都在本仓，中间一段已经是独立形态：

1. 面板（`src/client/views/SettingsPage.js`）：设置页标题行按钮，三态文案（检查更新 / 更新至某版本 / 待手动重启），点开先读状态，用户点了才联网，开始更新后每秒轮询到待重启（SettingsPage.js:128、155-230、257-289）。
2. 电话（`src/host/index.js:318-322`、`src/host/update.js:188-216`）：三个电话 `wf.updateStatus`（只读本地）、`wf.updateCheck`（点一次联网一次）、`wf.updateInstall`（拿检查编号加请求编号提交），动态引入胶水，无静态引用（verify-update-panel.js:27-30 断言）。
3. 核心（`update-core/src/` 四个 TS，经转译落在 `src/shared/update/` 三个 JS）：只记得规矩不动手装，零导入，依赖全当参数传（service.ts:1-7）。
4. 跑腿（`src/host/updateReader.js` 看现场、`src/host/updateStore.js` 落盘加执行）：读版本、判环境、落任务盘、拼命令执行，不知道流程（update.js:1-7、updateStore.js:1-8）。

通用方案（`docs/research/534-plugin-update-scheme.md`）的六步在本仓全部落地：看本地（service.ts:310-314 `status`）、问远端（service.ts:316-348 `check`，2 秒复用窗口 service.ts:319）、用户点头（SettingsPage.js:274-289 对话框）、动手装（service.ts:384-426 `install`，锁加去重加复核加备份）、进度可查（UpdateJob 六态 ports.ts:62，轮询 SettingsPage.js:226-230）、重启确认（service.ts:265-278 `healJob`）。

门禁现状（2026-09-10 实跑）：`tests/verify-update-freshness.js` 全部通过（逐字一致、tsc、只读契约、命令抽查共 30 余项 PASS）。更新相关门禁共五件：新鲜度（freshness）、标题行入口（panel，#541）、安装闭环（install，#542）、执行路由（routes，#548）、五行为回归（regression，#543），全部挂在 `npm run verify` 链上（package.json `verify` 脚本）。

## 2. 抽包清单：哪些拎走、哪些不拎

### 2.1 原样拎走（逻辑与 DSH 插件无关）

| 拎走对象 | 来源 | 为什么能原样走 |
|---|---|---|
| 插口定义 `ports.ts`（203 行）：环境种类、装不了的 8 种原因、错误码表、六字段快照、任务形状、检查凭证、发行信息、安装配方、最小网络形状、全部插口、三个对外方法 | update-core/src/ports.ts:13-197 | 只放类型，唯一运行时内容是一行模块标识（ports.ts:203 `PORTS_SOURCE`）；转译出的是空壳，第二家直接吃 TS 源码（ports.ts:2-11） |
| 业务流程 `service.ts`（429 行）：版本号小工具、Node 范围判定、问官方源、核心工厂（查状态、查新版、装更新、后台跑、自愈） | update-core/src/service.ts:23-429 | 零导入，依赖全当参数传；不碰硬盘、网络、子进程（service.ts:1-7）。注意文件内有两处写死常量，见第 3 章第 1、2 点，拎走时改成配置项 |
| 命令拼接 `commands.ts`（109 行）：`installRecipe` 按宿主种类选路由、`manualCommand` 手工兜底文案 | update-core/src/commands.ts:68-109 | 自包含零引用，类型引用只用 `import type`（commands.ts:9-13）。注意两处写死常量，见第 3 章 |
| 运行时形状 `runtime.d.ts`（22 行）：TextEncoder、URL | update-core/src/runtime.d.ts:9-22 | 只有两边宿主都有的能力才允许出现，Node 与浏览器专属一律不许加（runtime.d.ts:1-7） |
| 编译与类型口径：esbuild 只转译不打包（目标 ES2020）加 `tsc --noEmit` 只做类型检查 | update-core/build.mjs:32-60、update-core/tsconfig.json:1-17 | 地图 #579 已定新包沿用这套口径（ES2020、严格模式、esbuild 转译加 tsc 不产出检查） |
| 错误码表与快照形状 | ports.ts:27-57 | 码表由核心定，适配器只做翻译（ports.ts:26）；电话层白名单原样返回已知码（update.js:147-152） |

### 2.2 改写后拎走（骨架通用，写死点要参数化）

| 对象 | 通用骨架（可拎） | 写死点（必须改，见第 3 章） |
|---|---|---|
| 看现场 `updateReader.js`（206 行） | 向上找包 `containingPackage`（41-54）、使用范围名合法性 `profileNameValid`（57-60）、源安装判定 `registrySpec`（63-67）、包完好三入口校验 `validPackage`（70-95，主入口、客户端入口、补丁入口）、环境指纹算法 sha256（169-180）、阻拦判定链（181-187） | 包名（17）、家目录默认规则 `DSH_HOME`（98-103）、默认范围算法 |
| 落盘 `updateStore.js` 三件套（57-134） | 任务记录读写（59-80，原子写 0o600 加换名）、防重锁抢放（81-117，锁残留自愈）、装前备份（118-132，三份清单、单文件 3MB 上限）、读坏收敛（34-42，10MB 上限） | 状态目录段 `updates/dsh-mattpocock-skills-deck`（30，地图要求按插件标识派生） |
| 执行器 `updateStore.js`（136-322） | 双路由形态（桌面走 `desktopPnpm.runPlugin` 参数数组 255-270；普通走运行时加 CLI 入口加参数数组经注入的子进程能力起进程 273-292，不经 shell、不用 PATH 上的命令名）、CLI 入口反查（184-216，必须是包声明的可执行入口）、超时终止整棵进程树（219-238）、有界输出（142）、跨边界日志只记路由与退出事实（241-252） | CLI 包名 `@deepseek-ai/dsh`（137，DSH 标准，可保留或参数化，落点票 #581 拍板） |
| 电话工厂 `update.js`（188-216） | 三电话形态（读状态、查新版、装更新）、单例复用（查状态能看到查新版的结果）、错误收敛（147-152）、快照配手工命令一起回（160-166）、调用日志行（167-186） | 模块单例无标识（25-28，地图禁止无标识单例，要按键隔离）；电话名前缀 `wf.`（212-214，地图要求前缀参数化，默认 wf 保零变化） |
| 面板逻辑（状态机思路） | 按钮五态（235）、点开先读状态（225）、安装中每秒轮询（226-230）、对话框两行字加开始更新（274-289）、装不了给原因加手工命令（277-284） | 面板界面本身不进包（地图范围外，见 2.3） |

### 2.3 不拎走（留在本仓冻结）

- 设置页标题行界面全部（SettingsPage.js:128-289）：地图明确包只装核心，面板界面不进包。
- 宿主注册三行（index.js:318-322）与动态引入形态：新包由各插件自己接，电话名前缀参数化后默认仍为 `wf.`。
- 日志事件名与字段：复用常驻事件（`host.call`、`host.call.fail`、`update.install.exec`），新包字段要带插件标识（地图日志纪律），旧事件留在本仓不动。
- 测试里的本插件字面量（包名、源地址、版本号 1.7.14 等）：门禁模板票 #584 按清单重写，新包自带一套以配置项为唯一来源的门禁。

## 3. 三处写死参数化点（抽包不做这三改就不能给第二家用）

1. **包名** `dsh-mattpocock-skills-deck`：核心两处（service.ts:23 `PACKAGE_NAME`、commands.ts:15），连带包地址形状断言（service.ts:192-199 拼 `/${包名}/-/${包名}-${版本}.tgz`）、读取器（updateReader.js:17、41-46、71）、接线标记（update.js:82）、状态目录（updateStore.js:30）、全部更新门禁的期望字面量。改为必填配置项 `packageName`，校验规则沿用现有包名隐含假设（非空、不含空格，落点票定细则）。
2. **官方源** `https://registry.npmjs.org/`：核心两处（service.ts:24 `NPM_REGISTRY`、commands.ts:16），连带源同源断言（service.ts:192-194 `tarball.origin === registryOrigin`）与按钮强制源政策（commands.ts:83 `--registry=`）。改为配置项 `registryBaseUrl`（默认官方源保零变化），包地址模板由包名加源派生，不再逐字写死。
3. **目录根**：状态目录段 `updates/<包名>`（updateStore.js:30 `join(homeDir, 'updates', 'dsh-mattpocock-skills-deck', 短指纹)`）、开发目录默认范围 `profiles/web`（update.js:94 `join(homeDirDefault, 'profiles', 'web')`）、家目录默认规则（updateReader.js:98-103 环境变量优先、支持 `~` 写法）。改为配置项：状态目录名由插件标识派生（地图多插件隔离要求之一），默认范围与家目录规则保留但可覆盖。

附带两处同类参数化（地图 #579 已点名，一并列出）：电话名前缀默认 `wf.`（update.js:212-214、index.js:320-322）；模块单例加标识隔离（update.js:25-28 `sharedReader`/`sharedReaderKey` 无插件标识，地图禁止）。

## 4. 旧路径冻结点（地图铁律：默认旧路径冻结一字不差）

以下路径与名字在迁移完成前冻结，抽包只新增、不改旧：

- `src/shared/update/ports.js`、`service.js`、`commands.js`（生成物，与 `update-core/src/` 逐字对应，新鲜度门禁断言见 5.2）。
- `src/host/update.js`、`updateReader.js`、`updateStore.js`（薄胶水加跑腿）。
- 电话名 `wf.updateStatus`、`wf.updateCheck`、`wf.updateInstall`（index.js:320-322）与面板调用形状（SettingsPage.js:160、181、206）。
- 快照六字段与错误码字面量（ports.ts:44-57、27-41），面板按字段名消费（SettingsPage.js:139-154），改名即断面板。

## 5. 构建管线 inventory（新包照抄的对象）

### 5.1 转译脚本 `update-core/build.mjs`（81 行）

- 输入输出：一对一，`update-core/src/` 三个 TS → `src/shared/update/` 同名 JS（build.mjs:21-25 `UNITS`；注意 `runtime.d.ts` 只做类型约束，不产出 JS）。
- 口径：esbuild `transformSync`（loader ts、格式 esm、目标 es2020），包头 `AUTO-GENERATED` 加换行归一加末尾恰好一个换行（build.mjs:27-43）。同一口径被门禁复用，永不漂移（verify-update-freshness.js:31-40）。
- 类型检查：另跑 `tsc -p update-core/tsconfig.json`（`noEmit`，严格模式，`types: []`，见 tsconfig.json:1-17；build.mjs:45-60）。
- 生成物提交到 git，改了 TS 没重新生成就红（build.mjs:1-9 注释）。

### 5.2 新鲜度门禁 `tests/verify-update-freshness.js`（228 行）

1. 逐字一致：三个生成物与转译期望逐字比对（33-57）；插口生成物带 `PORTS_SOURCE`（58-59）；核心与命令生成物零相对引用（61-65）。
2. `tsc --noEmit` 通过（67-74）。
3. 只读行为契约（离线假适配器，直接调生成物）：查状态不联网、快照恰好六字段且不带钥匙、查新版两种情形、凭证另交且不带指纹、2 秒复用、坏发行信息判无效、环境不满足给原因、无凭证安装报过期（76-199）。
4. 命令抽查：双路由配方、参数数组三要素（精确版本、`--save-exact`、官方源）、未知宿主无配方、手工命令同政策、源码安装不给手工（201-215）；版本号小工具（217-219）。

### 5.3 双产物断言清单 `tests/verify-build-artifacts.js`

- `package/shared` 与 `src/shared` 双向差集为 0（109-117）。
- 逐文件 sha256 一致（120-125）。
- 两边各 21 个文件计数断言（含 `src/shared/update/` 三个生成物，注释点名 #540 加 2、#542 加 1：131-138）。
- `files` 白名单含 `shared`（210-215）；README 明确成品包白名单不动（update-core/README.md:47）。

含义：同一份逻辑以两种产物形态同时存在——TS 源码（给第二家吃）与转译 JS（给本插件跑），两边都有门禁看守。新包照抄：包内同时带 TS 源码与转译 JS（宿主标准模块加文本拼接形态由落点票 #581 按地图默认拍板），逐字一致断言保留。

## 6. 包名初查结论（2026-09-10，npm 官方源实查）

| 候选 | 结果 | 结论 |
|---|---|---|
| `dsh-update`（地图主选） | 已被占（`npm view dsh-update version` 返回 `0.0.1`） | 主选不可用 |
| `dsh-plugin-update`（地图 fallback） | 未被占（`npm view` 返回 404 `Not found`） | 按地图规则 fallback 可用，发布前复查（地图要求） |
| `@feather_wch` 范围（地图防抢注前缀，不用 featherhunter） | 存在（组织接口返回 200；已有 `@feather_wch/dsh-im@0.15.4`、`@feather_wch/dsh-plugin-ui-debug` 等包，维护者 feather_wch） | 防抢注可用，是否启用由落点票 #581 拍板 |

## 7. 双读迁移方向（给 #586 的输入，沿用本仓先例）

本仓已有一次同类迁移：#564 日志切包——优先走包派生（`./logFromPackage.js`），失败回退旧实现，旧文件留而不搬（index.js:308-310 注释与代码）。

更新包迁移照抄该方向：新包优先、旧实现回退、旧文件不动。验收线是地图铁律：当前插件迁移行为零变化，现有五件更新门禁全绿。面板强化（#587）走新包接口，不直接读旧路径。

## 8. 后继票输入索引

- 落点与底座（#581）：第 3 章三处参数化、第 5 章管线口径、第 6 章包名结论（fallback 可用，发布前复查）、CLI 包名 `@deepseek-ai/dsh` 去留（updateStore.js:137）。
- 接口与配置面（#582）：第 2.1 表（插口即接口初稿）、电话名前缀参数化、单例标识隔离、日志字段带插件标识。
- 核心抽离（#583）：第 2.1 加 2.2 表即拎取顺序；先拎 2.1（零改动），再做 2.2（三改）。
- 门禁模板（#584）：5.2 加 5.3 即模板初稿，字面量改由配置项派生。
- 集成文档（#585）：通用方案 `docs/research/534-plugin-update-scheme.md` 加本报告第 1 章链路复核。
- 迁移验收（#586）：第 4 章冻结点加第 7 章双读方向。
- 面板强化（#587）：SettingsPage.js:128-289 现状（标题行按钮 266、对话框 274-289、轮询 226-230）。
