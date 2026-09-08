# 研究：dsh-im 更新链路复核与复用到 deck 的对照（#536）

> 地图子票 #536 · 只做事实调查，不做方案拍板
> 落盘日期 2026-09-08 · 分支 research/536-dsh-im-recheck
> 核实基线：目标仓库 https://github.com/xmanrui/dsh-im 主分支 main，远端头仍为 `1c7c2d7`（2026-09-07，包版本 `4.15.0`，与分支 research/532-dsh-im-update 的研究报告基线完全一致）
> 下面每条结论都注明了来源文件与行号；凡写“目标仓库”的路径，都是指 dsh-im 仓库里的路径，不是本仓库的路径；凡写“本仓库”的路径，都是指 deck 本仓库的路径。

## 0 结论先行（八句话）

- 532 基线仍然有效：远端主分支头没有动过（还是 `1c7c2d7`，包还是 `4.15.0`），四个更新链路文件自基线之后零改动，下面第 1 章逐项复核。（来源：`gh api repos/xmanrui/dsh-im/commits/main`、`gh api repos/xmanrui/dsh-im/contents/package.json?ref=main`、`gh api repos/xmanrui/dsh-im/compare/bda4be6...main`，见第 1 章）
- 检查新版落在 `plugin-src/host/update-service.mjs` 的 `check`（第 220–250 行）与 `fetchNpmRelease`（第 21–65 行），检查凭证就是 `check` 里记下的那组值（编号加当时看到的环境指纹，有效期 10 分钟）。（来源：目标仓库同文件对应行）
- 安装落在两处：`update-service.mjs` 的 `install`（第 321–378 行，管流程：去重、验凭证、加锁、备份、后台执行）与 `update-runtime.mjs` 的 `install`（第 316–335 行，管动手：三道关加拼安装命令）。（来源：目标仓库同文件对应行）
- 状态查询落在 `update-service.mjs` 的 `status`（第 214–218 行，读本地不联网）加 `readJob`（第 144–184 行，重启后自愈残留任务），接线落在 `update-rpc.mjs` 的 `createUpdateRpcHandler`（第 24–40 行）与 `installUpdateRpc`（第 42–50 行）。（来源：目标仓库同文件对应行）
- 面板展示落在 `plugin-src/client/update-panel.js` 的 `UpdatePanel`（第 239–468 行）：按钮五态（第 401–418 行）、打开先读状态（第 272–291 行）、安装中每 1 秒轮询（第 298–330 行）、手工命令（第 90–113 行）。（来源：目标仓库同文件对应行）
- deck 同样走 npm 分发（`npm view dsh-mattpocock-skills-deck version` 回 `1.7.14`，包名无作用域），所以“问官方源、凭证加指纹、装前复核、按使用范围隔离状态、三端点同一快照”整套思路可直接复用，只换包名与通道名。（来源：`npm view` 回显、本仓库 `package/package.json` 第 1–26 行）
- 必须按 deck 重写的是四类：包名与包地址校验（含无作用域的包文件地址形状）、宿主接线（并入本仓库现有的 `/dsws` 分发表，不另起通道）、面板落点（走本仓库的叶子拼接与设置页标题行，不独立成文件）、状态目录名与用户文案（避开 `dsh-im` 字样）。（来源：本仓库 `src/host/index.js` 第 327–343 行、`scripts/build.mjs` 第 240–323 行，见第 5 章）
- 拿不准的三件事（见第 7 章）：宿主侧有没有版本比对库可用、桌面版执行器服务在本仓库宿主是否存在、npm 上本包的包文件地址主机是哪一个。

## 1 基线复核（532 基线是否仍然有效：有效）

- 远端主分支头：`gh api repos/xmanrui/dsh-im/commits/main` 回 `1c7c2d7`（2026-09-07T23:18:16Z，标题为按机器人分设推理强度，Refs #167），与 532 基线记录的头完全一致。（来源：该接口回显）
- 远端包版本：`gh api repos/xmanrui/dsh-im/contents/package.json?ref=main` 解码后 `version` 为 `4.15.0`，`npm view @xmanrui/dsh-im version` 同样回 `4.15.0`，与基线一致。（来源：该接口回显与 `npm view` 回显）
- 本地快照说明：本地 `D:\dsh-plugin\dsh-im-main` 头为 `bda4be6`（2026-09-06，包 `4.13.0`），比远端头早一天，是旧快照，不是新基线；但 `gh api repos/xmanrui/dsh-im/compare/bda4be6...main` 列出的变更文件里没有四个更新链路文件（`update-rpc.mjs`、`update-service.mjs`、`update-runtime.mjs`、`update-panel.js` 均未出现），且 `update-service.mjs` 最近一次变动为 2026-08-28（`gh api repos/xmanrui/dsh-im/commits?path=plugin-src/host/update-service.mjs`）。（来源：上述两个接口回显、本地 `git log`）
- 行号抽查：远端 `update-rpc.mjs` 前 14 行解码后与基线引用逐字一致（通道名第 4 行、端点表第 5 行、参数校验第 7–14 行）；本地四个文件总行数（`update-rpc.mjs` 51 行、`update-service.mjs` 387 行、`update-runtime.mjs` 339 行、`update-panel.js` 468 行）与基线引用的最大行号（50、386、335、460）全部对得上。（来源：`gh api .../contents/plugin-src/host/update-rpc.mjs?ref=main` 解码、本地文件行数）
- 结论：532 基线仍然有效，本报告的更新链路部分不再重复造新结论，只在第 2–4 章按票面要的五块（检查新版、检查凭证、安装、状态查询、面板展示）重述落点，行号沿用基线。

## 2 检查新版与检查凭证的落点

- 问远端最新版：`fetchNpmRelease`（目标仓库 `plugin-src/host/update-service.mjs:21-65`）请求 `https://registry.npmjs.org/@xmanrui/dsh-im/latest`，只接受名字对得上、版本号合法正式版、包文件地址与完整性校验串都合规的返回，否则按版本信息无效处理；查源超时默认 10 秒（第 126 行 `checkTimeoutMs`）。（来源：同文件对应行）
- 查一次的流程：`check`（同文件第 220–250 行）先看清当前环境，再问远端，生成随机检查编号并记下当时看到的环境指纹；2 秒内的重复点击复用上次结果，不重新联网（第 223–224 行）；失败把当次检查凭证作废并抛错（第 242–243 行）。（来源：同文件对应行）
- 检查凭证的内容：`checked = { release, checkId, checkedAt, expiresAt, installationKey, profileDir, blockedReason }`（第 231–240 行），有效期 10 分钟（第 127 行 `confirmationTtlMs`）；新版要的运行环境不满足时，凭证里记 `incompatible-node`（第 238–239 行）。（来源：同文件对应行）
- 能不能装的判定：`snapshot`（第 186–212 行）里 `canInstall` 为真要求环境允许、无阻拦原因、不正忙、有没过期的检查编号、检查时的环境指纹与现在一致、运行版本合法且远端新版确实更新（第 195–197 行）；检查编号只在能装时才随快照返回（第 209 行）。（来源：同文件对应行）

## 3 安装的落点

- 业务流程 `install`（目标仓库 `plugin-src/host/update-service.mjs:321-378`）：同一个请求编号重复提交直接返回旧快照（第 326 行）；凭证对不上或过期报检查凭证过期（第 328–331 行）；环境变了报安装状态变了（第 332–334 行）；正在装或待重启再点报正在更新（第 327 行）。（来源：同文件对应行）
- 开工前的复核：建状态目录、加防重复锁（第 344–352 行），再问一次远端并逐字比对版本信息（第 353–354 行），再看一次环境（第 355–359 行），备份使用范围的三个清单文件（第 361 行，清单见第 13 行），最后落盘任务并后台执行（第 362–376 行）。（来源：同文件对应行）
- 后台执行 `execute`（第 277–319 行）：完事先标正在校验，重新看环境并比对磁盘版本与目标版本，都通过才标待重启，从头到尾不替用户重启（第 119 行注释原话含义、第 296 行）。（来源：同文件对应行）
- 真正执行 `install`（目标仓库 `plugin-src/host/update-runtime.mjs:316-335`）：三道关（版本号合法正式版、环境指纹一致、装前再看一次环境，第 317–328 行）；安装命令本体是 `add -w --save-exact @xmanrui/dsh-im@版本号 --registry=https://registry.npmjs.org/`（第 329 行）；桌面版调桌面内置包管理服务，命令行版包成 `dsh plugin --profile 名字 …` 用当前入口执行（第 330–334 行）。（来源：同文件对应行）
- 装不了的八种情形：使用范围认不出、执行器不可用、包坏了、源码安装、安装位置变了、待重启、源配置冲突、新版要求的运行环境不满足（`update-runtime.mjs:279,300-306` 判定、`update-service.mjs:238-239` 的运行环境检查、面板文案 `update-panel.js:12-20`）。其中标准 Windows 命令行目前不支持按钮安装（`update-runtime.mjs:217-220`）。（来源：同文件对应行，复述 532 基线，复核无变化）

## 4 状态查询与面板展示的落点

- 三个调用端点同走一条通道 `/dsh-im`（目标仓库 `update-rpc.mjs:4-5`，面板侧同名见 `update-panel.js:9`）：查状态只读本地不联网（`update-service.mjs:214-218`），查新版联网问一次（第 220–250 行），装更新拿检查凭证加请求编号提交（第 321–378 行）；三者返回同一快照形状（运行版本、磁盘已装版本、远端最新版本、能不能装、装不了的原因、当前任务，第 198–211 行）。（来源：同文件对应行，复述 532 基线，复核无变化）
- 接线校验 `createUpdateRpcHandler`（`update-rpc.mjs:24-40`）：按端点名分发，安装必须带且只带检查编号与请求编号两个字符串（第 7–14 行），已知错误码原样返回、未知收敛为更新失败（第 16–22 行白名单、第 36 行）。（来源：同文件对应行）
- 启动接线：宿主插件启动、确认有远程调用连接后装通道，失败只记一条日志不影响主流程（目标仓库 `plugin-src/host/index.mjs:130-135`，引入见第 19 行）。（来源：532 基线，本次未重拉该文件，行号以基线为准）
- 面板入口在设置页标题栏：更新面板挂在 GitHub 链接前面（`plugin-src/client/index.js:253-259`），按钮平时显示检查更新，发现新版显示更新至加版本号（`update-panel.js:401-418`）；点开自动查一次，对话框有重新检查按钮（第 413–417、454–460 行）。（来源：同文件对应行，复述 532 基线，复核无变化）
- 安装中面板每 1 秒轮询查状态（第 298–330 行），关页面只停读状态的请求、不取消已提交的安装（第 377 行注释）；对话框写明仅更新本插件、装完需手动重启、不会自动重启或刷新页面（第 231–232 行）；手工命令按当前使用范围生成并可一键复制（第 90–113 行），源码安装等不安全情形不生成（第 90–95 行）。（来源：同文件对应行，复述 532 基线，复核无变化）
- 状态记在本地磁盘按使用范围隔离的目录（`DSH_HOME/updates/dsh-im/短指纹/`，`update-service.mjs:67-77`），三个文件：任务记录、防重锁、装前备份（第 71–76 行）；任务状态七种：正在安装、正在校验、待重启、已完成、失败、已中断（第 10–11 行）。（来源：同文件对应行，复述 532 基线，复核无变化）

## 5 可直接复用到 deck 的思路（发行形态一致：同走 npm 分发）

> 复用口径：通用方案（本仓库 `docs/research/534-plugin-update-scheme.md`，只做参考不是照抄）里的六步三层三条硬性要求直接引用——六步即看本地、问远端、用户点头、动手装、进度可查、重启确认；三层即接线校验、业务流程、环境执行；三条即更新功能永远不替用户重启、重启后运行版本等于目标版本才算完成、按钮装不了的环境必须给一条手工命令兜底。下面每条注明对照的 dsh-im 落点。

- 三端点同一快照：查状态只读、查新版联网、装更新提交，共用同一快照形状（对照 `update-rpc.mjs:4-5,24-40` 与 `update-service.mjs:198-211`）；通道名与快照字段按 deck 自家契约改（deck 现有通道见下章）。
- 检查凭证加环境指纹：编号加当时看到的环境指纹、有效期约 10 分钟（对照 `update-service.mjs:231-240`）；超时与间隔做成可调参数，不硬编码（查源超时、凭证有效期、安装超时、轮询间隔）。
- 装前复核与请求编号去重：远端版本与检查时一致、当前环境允许装、同一使用范围同时只装一个、重复提交直接返回旧结果（对照 `update-service.mjs:321-359`）。
- 状态隔离与启动自愈：状态记在本地磁盘按使用范围隔离的目录，三件套为任务记录、防重锁、装前备份；宿主启动时自愈残留任务（锁消失的正在安装改为已中断需人工确认，待重启或已完成的用磁盘版本与运行版本重新核对，对照 `update-service.mjs:67-77,144-184`）。
- 双执行器分支：桌面走内置包管理服务，命令行走 `dsh plugin --profile 名字 …`（对照 `update-runtime.mjs:329-335`）；拼命令的包名与版本换成 deck 的，源固定官方、精确版本。
- 面板状态机与轮询：按钮平时显示检查更新、有新版显示更新至某版本、装完显示待手动重启；打开面板先读状态、用户点了才联网检查；安装中轮询状态、关页面不取消已提交的安装（对照 `update-panel.js:272-330,401-418`）；对话框写明只更新本插件、装完需手动重启、不会自动重启或刷新页面。
- 构建侧零改动：宿主新增文件放在 `src/host` 树下即自动随原样复制进入发布包（本仓库 `scripts/build.mjs:380-427` 整树复制加逐字节校验），`files` 白名单（本仓库 `package/package.json:21-26`：`lib`、`shared`、`cordis.patch.yml`、`bundled-skills`）不用加项；`esbuild` 只做语法校验（`build.mjs:137-150`），更新逻辑不经打包改写。

## 6 必须按 deck 的构建与分发重写的清单

- 包名常量与包文件地址校验：`PACKAGE_NAME` 从 `@xmanrui/dsh-im` 换成 `dsh-mattpocock-skills-deck`（本仓库 `package/package.json:2`），`fetchNpmRelease` 里写死的包文件地址形状（`/…/-/…-版本号.tgz`，目标仓库 `update-service.mjs:54`）与 `validPackage` 的入口清单（`main`、`exports`、`dsh.bundle.patch`，目标仓库 `update-runtime.mjs:91-105`）按 deck 的 `package.json`（`main: lib/index.js`、`exports`、`dsh.bundle.patch`，本仓库 `package/package.json:9-20`）重写。（来源：双方 `package.json` 与目标仓库对应行）
- 磁盘已装版本读取路径：从 `node_modules/@xmanrui/dsh-im` 换成 `node_modules/dsh-mattpocock-skills-deck`（对照目标仓库 `update-runtime.mjs:282`）。（来源：同文件第 282 行）
- 使用范围的源配置检查：`@xmanrui:registry` 改为本包对应的作用域或包级源键（对照目标仓库 `update-runtime.mjs:257`）。（来源：同文件第 257 行）
- 宿主接线：不另起 `/dsh-im` 式独立通道，并入本仓库现有的 `/dsws` 分发表（`harness.handle('wf.方法')` 加 `connection.rpc.handle('/dsws')` 按名分发，本仓库 `src/host/index.js:224-291,327-343`），新增三个调用端点；本仓库现无更新端点（`src` 全树搜 `update.status|update.check|update.install` 零命中）。（来源：本仓库对应行与全树搜索结果）
- 同进程串行锁：目标仓库 `install` 用 `withSessionBindingLock`（目标仓库 `update-service.mjs:7,322` 引自其 `src/channels/shared/session-binding-lock.mjs`）；本仓库 `src/host` 下无此文件（本仓库 `src/host` 共 24 个文件，无 `channels` 目录），锁机制按 deck 形态重写。（来源：目标仓库对应行、本仓库 `src/host` 目录清单）
- 面板落点：不独立成 `update-panel.js` 式文件，走本仓库的叶子拼接（`LEAF_MODULES` 登记加 `src/client/index.js` 标记位，本仓库 `scripts/build.mjs:240-323`；未登记的新叶子构建直接报错），挂载点放在设置页标题同行右侧（本仓库 `src/client/views/SettingsPage.js:140` 已有标题同行右侧按钮形态）；客户端通道为 `conn.rpc.call('/dsws', 端点)`（本仓库 `src/seam/rpc.js:23`）。（来源：本仓库对应行）
- 状态目录名：`updates/dsh-im` 换成 deck 短名，避免与已装的 dsh-im 共用一处（对照目标仓库 `update-service.mjs:70`）。（来源：同文件第 70 行）
- 手工命令模板：沿用本机源配置的兜底命令按本仓库安装口径生成（本仓库 `README.md` 现有口径为 `dsh plugin --profile web add dsh-mattpocock-skills-deck@版本号 --registry https://registry.npmjs.org`），包名与版本号占位替换；源码安装等不安全情形不生成（对照目标仓库 `update-panel.js:90-95`）。（来源：本仓库 `README.md`、目标仓库对应行）
- 用户文案：仅更新本插件、装完需手动重启、不自动重启不刷新页面三句按 deck 产品改写，重启口径与本仓库已有注记一致（本仓库 `README.md` 有更新后需完全重启的说明）。（来源：本仓库 `README.md`、目标仓库 `update-panel.js:231-232`）
- 日志点：按本仓库日志纪律，凡涉及跨边界调用等五类动因同步加日志点（查阅入口见日志总纲票），令牌与登录态原文永不落盘（本仓库 `CONTEXT.md` 日志体系词条、通用方案第 74 行落地提醒）。（来源：本仓库 `CONTEXT.md` 第 85–92 行）

## 7 不确定（拿不准的，不拍板，供后续票确认）

- 宿主侧版本比对库：目标仓库 `plugin-src` 用 `semver` 包（目标仓库 `update-service.mjs:4`、`update-runtime.mjs:7`）；本仓库宿主为原样复制的 ESM（`node --check` 全树加入口 `import` 冒烟，本仓库 `scripts/build.mjs:453-477`），`src/host` 与 `src/shared` 下有无版本比对可用，本次未查，需后续票确认后决定自研比对还是引入依赖。（来源：目标仓库对应行、本仓库 `scripts/build.mjs` 对应行）
- 桌面版执行器服务：目标仓库 `environment` 读宿主的桌面专有服务（目标仓库 `update-runtime.mjs:184-186`）；这些服务在本仓库宿主是否存在，本次未查，桌面版按钮安装是否可用待后续票实测。（来源：目标仓库对应行）
- npm 上本包的包文件地址主机：目标仓库校验包文件地址必须同官方源同主机（目标仓库 `update-service.mjs:50-55`）；本包（`dsh-mattpocock-skills-deck@1.7.14`）的包文件地址主机，本次只查了版本号、未查包文件地址字段，写校验式之前需先看一眼。（来源：`npm view` 本次回显范围、目标仓库对应行）

## 8 本研究没做的事

- 只复核了基线有效性并补了复用对照，没有评估方案好坏，也没有拍板本仓库该怎么写代码。
- 目标仓库 `plugin-src/host/index.mjs` 的启动接线行号沿用 532 基线（本次未重拉该文件）；其余行号已按本地与远端一致的源码复核。
- 引用的行号以基线 `1c7c2d7` 为准，目标仓库后续提交可能移动行号，按文件路径与函数名重新定位即可。
