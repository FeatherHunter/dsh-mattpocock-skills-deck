# 研究：dsh-im 检查更新与帮用户更新的实现细节（#532）

> 地图子票 #532 · 只做事实调查，不做方案拍板
> 落盘日期 2026-09-08 · 分支 research/532-dsh-im-update
> 核实基线：目标仓库 https://github.com/xmanrui/dsh-im 主分支 main，本地浅克隆当时头为 `1c7c2d7`，包版本 `4.15.0`
> 下面每条结论都注明了来源文件与行号，行号以该基线为准；凡写“目标仓库”的路径，都是指 dsh-im 仓库里的路径，不是本仓库的路径。

## 0 结论先行（七句话）

- 面板入口在设置页标题栏：设置页右上角 GitHub 链接左侧有一颗按钮，平时显示“检查更新”，发现新版后变成“更新至 v版本号”，点开是更新对话框。（来源：`plugin-src/client/index.js:253-258`、`plugin-src/client/update-panel.js:401-418`）
- 宿主侧三个文件分工明确：`update-rpc.mjs` 只做接线与参数校验，`update-service.mjs` 管检查与安装的完整业务流程，`update-runtime.mjs` 管看清当前环境与真正执行安装命令。（来源：三个文件各自的导出函数，见第 2 章）
- 三个远程调用端点都走同一条通道 `/dsh-im`：`update.status` 只读当前状态不联网，`update.check` 联网查一次 npm 最新版，`update.install` 拿着检查凭证提交一次安装任务；三者都返回同一形状的快照。（来源：`plugin-src/host/update-rpc.mjs:4-5,24-40`）
- 版本号有三个来源：运行版本读宿主自带清单里的版本号，磁盘已装版本读当前 profile 目录下已安装包里的版本号，最新版本问 npm 官方源的 `latest` 接口。（来源：`plugin-src/host/update-service.mjs:6,122`、`plugin-src/host/update-runtime.mjs:281-285`、`plugin-src/host/update-service.mjs:24`）
- 安装命令由宿主拼好并直接执行，大致等于 `dsh plugin --profile 名字 add -w --save-exact @xmanrui/dsh-im@版本号 --registry=https://registry.npmjs.org/`；桌面版走桌面内置的包管理服务，效果一样。（来源：`plugin-src/host/update-runtime.mjs:329-335`，用户文档：`docs/checking-and-installing-updates.md:9-13`、`docs/检查与安装更新.md:9-13`）
- 安装过程的状态记在当前电脑的 `DSH_HOME/updates/dsh-im/短指纹/` 目录下，里面有三个文件：记录任务的 `state.json`、防重复安装的 `install.lock`、装前备份的 `before.json`。（来源：`plugin-src/host/update-service.mjs:67-77`，用户文档：`docs/检查与安装更新.md:19`）
- 安装完必须手动重启，更新功能自己不重启、不热更新、不刷新页面；重启后运行版本等于目标版本，状态才算真正完成。（来源：`plugin-src/host/update-service.mjs:119,296`、`plugin-src/client/update-panel.js:231-232`、用户文档：`docs/checking-and-installing-updates.md:5`、`docs/检查与安装更新.md:5`）

## 1 面板里的检查更新入口

- 入口位置：设置页（标题写着 IM 机器人设置）顶部标题栏右侧的操作区里，更新面板挂在 GitHub 链接前面。（来源：`plugin-src/client/index.js:253-259`，更新面板先出现，GitHub 链接在后）
- 按钮平时显示“检查更新”，正在检查显示“检查中…”，正在安装显示“正在更新…”，发现新版显示“更新至 v版本号”，装完待重启显示“待手动重启”。（来源：`plugin-src/client/update-panel.js:401-405`）
- 第一次点按钮（还没有可安装的新版、也没有正在跑的任务时），面板会自动发起一次检查；对话框里还有“重新检查”按钮可以再查。（来源：`plugin-src/client/update-panel.js:413-417,454-460`）
- 面板打开时先读一次 `update.status` 拿到当前状态，检查按钮调 `update.check`，安装按钮调 `update.install`。（来源：`plugin-src/client/update-panel.js:272-291` 打开时读状态，`361-363` 检查与刷新，`364-391` 安装）
- 安装进行中（正在安装或正在校验）时，面板每 1 秒轮询一次 `update.status`，直到任务离开进行中状态；关掉页面只会停掉读状态的请求，已经提交给宿主的安装不会被取消。（来源：`plugin-src/client/update-panel.js:298-330` 轮询，`377` 关页面不取消安装的注释）
- 对话框里写明“仅更新 DSH-IM。安装完成后需手动重启后台；本功能不会自动重启或主动刷新页面。”（来源：`plugin-src/client/update-panel.js:231-232`）
- 对话框下方有“手工更新”区，会按当前 profile 生成一条精简命令，例如 `dsh plugin --profile web add -w @xmanrui/dsh-im@3.1.1`，可以一键复制到终端执行；这条手工命令沿用本机自己的 npm 源配置，没有强制官方源，也没有锁定精确版本写法。（来源：`plugin-src/client/update-panel.js:90-113` 生成命令，`115-184` 复制界面；行为说明见 `docs/checking-and-installing-updates.md:15`、`docs/检查与安装更新.md:15`）
- 源码或链接安装、无法安全确认的 profile，不生成可能覆盖安装的手工命令。（来源：`plugin-src/client/update-panel.js:90-95,181-183`）

## 2 宿主侧三个更新文件的分工

### 2.1 `plugin-src/host/update-rpc.mjs`：只做接线与参数校验

- 导出通道名 `UPDATE_RPC_CHANNEL = '/dsh-im'` 与端点表 `UPDATE_ENDPOINTS = ['update.status', 'update.check', 'update.install']`。（来源：`plugin-src/host/update-rpc.mjs:4-5`）
- `validPayload` 做参数校验：查状态与检查只允许空对象；安装必须带且只带 `checkId` 与 `requestId` 两个字符串。（来源：`plugin-src/host/update-rpc.mjs:7-14`）
- `createUpdateRpcHandler` 按端点名分发：`update.install` 调业务层的 `install`，`update.check` 调 `check`，其余调 `status`；业务层抛出的已知错误码原样返回，未知错误统一收敛为 `update-failed`。（来源：`plugin-src/host/update-rpc.mjs:24-40`，已知错误码白名单见 `16-22`）
- `installUpdateRpc` 把接线装到宿主连接上：用 `createUpdateRuntime` 造环境适配器，用 `createUpdateService` 造业务服务，再以 `loopback` 权限注册到 `/dsh-im` 通道；宿主关闭时调业务服务的 `close` 收尾。（来源：`plugin-src/host/update-rpc.mjs:42-50`）
- 注册时机：宿主插件启动、确认有远程调用连接后，就启动更新管理；启动失败只记一条错误日志，不影响聊天通道继续启动。（来源：`plugin-src/host/index.mjs:130-135`，引入见 `19`，可替换点见 `36-37`）

### 2.2 `plugin-src/host/update-service.mjs`：管检查与安装的完整业务流程

- 导出 `createUpdateService`（状态查询、检查、安装三个方法加关闭方法）、`fetchNpmRelease`（问 npm 要最新版）、`updateError`（按错误码造错误）。（来源：`plugin-src/host/update-service.mjs:16-18,21,120-129,386`）
- 默认超时：查 npm 10 秒，检查凭证有效 10 分钟，安装 15 分钟。（来源：`plugin-src/host/update-service.mjs:126-128`）
- `check` 的流程：先看清当前环境，再问 npm 要最新版，生成一个随机检查编号记下当时看到的环境指纹；2 秒内的重复点击直接复用上次结果，不重新联网。（来源：`plugin-src/host/update-service.mjs:220-250`，去重见 `223-224`）
- `install` 的流程：先看清当前环境并读磁盘上的旧任务，同一个 `requestId` 的重复提交直接返回旧快照；检查凭证对不上或过期就报 `check-expired`；环境变了就报 `installation-changed`；正在装或待重启时再点就报 `update-busy`。（来源：`plugin-src/host/update-service.mjs:321-335`）
- 真正开工前，先建状态目录、加防重复锁，再重新问一次 npm 并逐字比对版本信息（防止检查完到安装前这段时间 npm 变了），再看一次环境，备份 profile 的三个清单文件，最后才落盘任务并后台执行。（来源：`plugin-src/host/update-service.mjs:344-376`，备份文件清单见 `13`）
- 后台执行完先标“正在校验”，重新看环境：目录或 profile 对不上就报安装状态变了，磁盘版本与目标不一致或包校验不过就报校验失败；都通过才标“待重启”，并且从头到尾不替用户重启。（来源：`plugin-src/host/update-service.mjs:277-319`，执行结果见 `285-297`，“从不替用户重启”是 `119` 注释的原话含义）
- 读旧任务时有自我修正：宿主重启后发现磁盘上还标着“正在安装”但锁已经没了，就改成“已中断，需人工确认”；待重启或已完成的任务，会拿磁盘版本与运行版本重新核对，对不上就标安装状态变了，运行版本追上目标版本才算完成。（来源：`plugin-src/host/update-service.mjs:144-184`）

### 2.3 `plugin-src/host/update-runtime.mjs`：看清当前环境与真正执行安装命令

- 导出包名常量 `PACKAGE_NAME = '@xmanrui/dsh-im'` 与官方源常量 `NPM_REGISTRY = 'https://registry.npmjs.org/'`；导出 `createUpdateRuntime`，只给 `inspect`（看环境）与 `install`（执行安装）两个方法。（来源：`plugin-src/host/update-runtime.mjs:9-10,169,338`）
- `inspect` 看这些事：当前是桌面还是命令行环境、电脑主目录与 profile 目录、运行版本与磁盘已装版本、包是否完整、是不是源码安装、有没有被换过安装位置、有没有待重启。（来源：`plugin-src/host/update-runtime.mjs:271-314`）
- 以下情况不给装，只给原因：profile 认不出、执行器不可用、包坏了、源码安装、安装位置变了、待重启、npm 源配置与官方不一致、Node 版本不满足新版要求。（来源：`plugin-src/host/update-runtime.mjs:279,300-306` 判定，`update-service.mjs:238-239` 的 Node 检查，面板文案见 `plugin-src/client/update-panel.js:12-20`）
- 标准 Windows 命令行目前不支持按钮安装，会报执行器不可用；桌面版用自己的执行器。（来源：`plugin-src/host/update-runtime.mjs:217-220` 把 Windows 命令行排除，用户文档：`docs/检查与安装更新.md:17`、`docs/checking-and-installing-updates.md:17`）
- `install` 执行前三道关：版本号必须是合法正式版；安装前看的环境指纹必须与提交时一致；先查 npm 源配置再装，装前再看一次环境。（来源：`plugin-src/host/update-runtime.mjs:316-328`）
- 安装命令本体是 `add -w --save-exact @xmanrui/dsh-im@版本号 --registry=https://registry.npmjs.org/`；桌面版调桌面内置包管理服务，命令行版包成 `dsh plugin --profile 名字 …` 用当前 Harness 的入口执行。（来源：`plugin-src/host/update-runtime.mjs:329-335`）
- 备注：任务清单里提到的 `harness-command-executor.mjs` 经核实与更新无关，它是聊天命令网关的适配器（把宿主的命令网关转给频道的 Harness 客户端），更新链路没有用到它。（来源：`plugin-src/host/harness-command-executor.mjs:1-48` 全文）

## 3 三个远程调用端点各自返回什么

- 三个端点都走 `/dsh-im` 通道，面板侧与宿主侧的通道名字母相同。（来源：面板 `plugin-src/client/update-panel.js:9`，宿主 `plugin-src/host/update-rpc.mjs:4`，面板实际发出调用见 `plugin-src/client/index.js:410-411`）
- `update.status`：只读当前状态，不联网问 npm；返回快照（见下）。（来源：`plugin-src/host/update-service.mjs:214-218`，面板“刷新状态”只读宿主不查 npm，见 `plugin-src/client/update-panel.js:458-459`，文档见 `docs/checking-and-installing-updates.md:7`）
- `update.check`：联网问一次 npm 最新版，成功返回快照；失败把当次检查凭证作废并抛错。（来源：`plugin-src/host/update-service.mjs:220-250`，失败作废见 `242-243`）
- `update.install`：提交一次安装任务，成功返回快照（任务状态为正在安装）；重复提交用 `requestId` 去重。（来源：`plugin-src/host/update-service.mjs:321-326,370-376`）
- 快照里固定有这些字段：运行版本、磁盘已装版本、npm 最新版本、profile 名、环境类型（桌面或命令行）、是否源码安装、能不能装、装不了的原因、上次检查时间、检查编号、当前任务（编号、状态、目标版本、说明）。（来源：`plugin-src/host/update-service.mjs:198-211`）
- “能不能装”为真的条件：环境允许、无阻拦原因、不正忙、有没过期的检查编号、检查时看到的环境指纹与现在一致、运行版本合法且 npm 最新版确实更新。（来源：`plugin-src/host/update-service.mjs:195-197`）
- 任务状态一共七种：正在安装、正在校验、待重启、已完成、失败、已中断；面板把“待重启”当最高优先级展示。（来源：`plugin-src/host/update-service.mjs:10-11` 定义，面板展示见 `plugin-src/client/update-panel.js:68-84`）

## 4 版本号从哪里查

- 运行版本：默认值取宿主自带清单（`package.json`）里的版本号；面板标题栏平时显示的也是这个版本，收到宿主快照后改用快照里的运行版本。（来源：`plugin-src/host/update-service.mjs:6` 引入清单，`122` 默认值；面板见 `plugin-src/client/index.js:68,190,205-207`）
- 磁盘已装版本：读当前 profile 目录下 `node_modules/@xmanrui/dsh-im` 里清单文件的版本号，并校验包里三个入口文件都在包目录内且是文件。（来源：`plugin-src/host/update-runtime.mjs:281-286` 读版本，`91-105` 校验完整性）
- npm 最新版本：请求 `https://registry.npmjs.org/@xmanrui/dsh-im/latest`，只接受名字对得上、版本号合法正式版、包文件地址与完整性校验串都合规的返回，否则按版本信息无效处理。（来源：`plugin-src/host/update-service.mjs:21-65`，请求地址见 `24`，校验规则见 `42-58`）
- 当前包版本以核实基线为准是 `4.15.0`。（来源：目标仓库 `package.json:2-3`）

## 5 安装命令与状态目录

- 按钮安装执行的命令相当于（把示例 profile 与版本换成确认值）：`dsh plugin --profile web add -w --save-exact @xmanrui/dsh-im@3.1.0 --registry=https://registry.npmjs.org/`。（来源：`plugin-src/host/update-runtime.mjs:329-335` 拼命令，`docs/checking-and-installing-updates.md:9-13`、`docs/检查与安装更新.md:9-13` 示例）
- 装前先查本机 `@xmanrui` 作用域的 npm 源配置：没配或配的正是官方源才继续，配了别的源就报源冲突不装。（来源：`plugin-src/host/update-runtime.mjs:256-269` 查配置，`107-116` 判定官方源）
- 状态目录在当前电脑的 `DSH_HOME/updates/dsh-im/短指纹/` 下，短指纹是 profile 目录算出的 24 位散列的前 24 位；每个 profile 各存各的，互不干扰。（来源：`plugin-src/host/update-service.mjs:67-77`，目录用途见用户文档 `docs/检查与安装更新.md:19`、`docs/checking-and-installing-updates.md:19`）
- 目录里三个文件：`state.json` 存最近一次任务，`install.lock` 是防两个宿主同时装的锁（含任务编号、进程号、开始时间），`before.json` 存装前 profile 的三个清单文件内容（只做回滚参考，不复制机器人凭据）。（来源：路径见 `plugin-src/host/update-service.mjs:71-76`，锁内容见 `349`，备份内容见 `257-270`，不复制凭据见 `docs/检查与安装更新.md:19`）
- 输出与诊断：子进程输出只截最后 16KB，原始报错不穿过远程调用边界，只返回错误码；安装超时按 15 分钟算。（来源：`plugin-src/host/update-runtime.mjs:14,118-163`，安装超时见 `12,330-335`）

## 6 安装后是否需要重启

- 需要手动重启。更新服务只把任务标成“待重启”，从不替用户重启。（来源：`plugin-src/host/update-service.mjs:119` 注释、 `296` 标待重启；文档：`docs/checking-and-installing-updates.md:5`、`docs/检查与安装更新.md:5`）
- 重启后宿主发现运行版本已等于目标版本，任务才从“待重启”变成“已完成”；磁盘版本对不上就标安装状态变了。（来源：`plugin-src/host/update-service.mjs:177-182`）
- 面板上“已安装，待手动重启”以宿主报告的运行版本为准；宿主自带的模块监视可能自己刷新插件界面，但界面变了不代表后台新版本已生效。（来源：`docs/checking-and-installing-updates.md:5`、`docs/检查与安装更新.md:5`，面板版本不一致提示见 `plugin-src/client/update-panel.js:443`）
- 重启后如果老页面还显示待重启，点对话框里的“刷新状态”或重新打开窗口，只重读宿主状态，不查 npm 也不刷新页面。（来源：`docs/checking-and-installing-updates.md:7`、`docs/检查与安装更新.md:7`，面板实现见 `plugin-src/client/update-panel.js:332-363`）

## 7 设计背景（只作出处，不复述二手结论）

- 更新功能的设计方案原文在 `docs/方案/Issue-61-npm更新检查与手动更新方案.md`（首期范围：只更新本插件、只问 npm、用户点击才查、装完待手动重启、不做自动重启与热更新）。
- 用户级说明在 `docs/checking-and-installing-updates.md` 与 `docs/检查与安装更新.md`，两份内容对应，本研究两处都核对过。
- 更新链路另有四份自动化检查作证：`test/update-rpc.test.mjs`、`test/update-runtime.test.mjs`、`test/update-service.test.mjs`、`test/update-ui.test.mjs`（本研究未逐行核对测试断言，只确认文件存在）。

## 8 本研究没做的事

- 只核实了主分支当前实现，没有评估方案好坏，也没有拍板本仓库该怎么抄。
- 引用的行号以基线 `1c7c2d7` 为准，目标仓库后续提交可能移动行号，按文件路径与函数名重新定位即可。
