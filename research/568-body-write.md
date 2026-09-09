# 研究：正文写回链路与系统差异实证（#568）

本票只做事实调查，不给方案、不改业务代码。下面每个结论后面都注明一手来源文件与函数名。行号是本次在工作区读到的实际行号，仓库根为相对起点。

## 1. 写正文的两条路

### 1.1 终端手敲：人直接调 gh 命令，走 shell 解析

约定入口在 `docs/agents/issue-tracker.md`：新建用 `gh issue create` 加 `--title` 与 `--body`，多行正文用 heredoc 承载；评论用 `gh issue comment <n> --body`；打标签用 `gh issue edit <n> --add-label` 或 `--remove-label`；关闭用 `gh issue close`。

制图期实测补充在 `docs/research/RESEARCH-NOTES.md` 第 1.5 节：建子票用 `gh issue create --parent <map 号>`；补挂父用 `gh issue edit <子票号> --parent <map 号>`；阻塞用 `gh issue edit <子票号> --add-blocked-by` 或 `--add-blocking`；认领用 `gh issue edit <子票号> --add-assignee @me`；评论用 `gh issue comment <n> --body-file <路径>`；关闭用 `gh issue close <n>`。

这条路的特点是命令先经过人所用的 shell（例如 Windows PowerShell 或 cmd）再到达 gh，所以引号与特殊字符的吃法由 shell 决定，细节见第 6 章。

### 1.2 宿主写接口：面板与后端经函数调 gh，走参数数组直传

写 issue 的实现集中在 `src/host/tracker/backends/github/issues-write.js`：`createIssue` 先尝试 `gh api` 加 `--input -`，失败则回落到 `gh issue create --title ... --body ...`；`updateIssue` 拼出 `gh issue edit <号> --repo <owner/name>` 再按需追加 `--title` 与 `--body`；`closeIssue` 与 `reopenIssue` 分别调 `gh issue close` 与 `gh issue reopen`；`setAssignees` 先读当前认领再用 `--add-assignee` 与 `--remove-assignee` 做差量同步。读路径留在同目录 `issues.js`（`getIssue` 等），写路径由 `#440` 从该文件纯结构移出，行为零变化。

写评论的实现在 `src/host/tracker/backends/github/comments.js` 的 `addComment`：优先调 `gh api repos/<owner>/<repo>/issues/<n>/comments --method POST -f body=...`，失败则回落到 `gh issue comment <号> --repo ... --body ...`。

两处都经过同目录 `client.js` 的 `ghClient`：`execGh` 与 `execJson` 经 `ctx.exec('gh', args, { cwd, timeout, signal })` 执行，超时 30 秒，错误经 `classifyGhError` 归一。`resolveGh` 先问 `platform.resolveExecutable('gh')`，找不到时再用 `gh --version` 探活回落到字面 `gh`。因为 `ctx.exec` 收的是参数数组，命令不经过 shell 拼串，所以没有 PowerShell 引号坑。这一点在 `docs/research/RESEARCH-NOTES.md` 第 4 节末尾有原话：宿主插件内跑 gh 用 spawn，不经 PowerShell，无此坑，此坑只影响调试与自测命令。

事实差集：宿主写接口当前全部用行内 `--body` 参数传正文，在 `src/host/tracker/backends/github` 下搜不到任何 `--body-file` 用法。文件方式目前只出现在约定层（`src/client/kernel/prompts.js` 的正文格式契约第 3 条，以及 `docs/research/RESEARCH-NOTES.md` 第 4 节第 3 条规避措施），尚未在宿主写代码里落地。

## 2. 正规化逻辑在哪些文件里

### 2.1 剥开头不可见字符：三处同一写法，各管一摊

`src/shared/parser.js` 的 `normalizeBody` 是唯一真源加测试基准，文件头注释写明 host 与 package 仍保留各自内联副本，阶段 1 零行为变化。`src/host/mapBody.js` 里 `createMapBody` 闭包内的 `normalizeBody` 是宿主运行时刻的副本。`src/host/tracker/detection/parseIssueTracker.js` 的 `parseIssueTracker` 与 `normalizeTrackerText` 做主锚文本的同类清理，注释写明与宿主 `normalizeBody` 互补。

写法都是只剥开头的第一个 `U+FEFF`，正则为只锚定行首的一个字符。非该字符输入逐字节透传。另有 `src/host/skillProbe.js` 的 `isSkillCardValid` 在判技能名片前同样先剥一个开头 `U+FEFF`，但那是名片有效性加固，不管正文还原，见第 4 章。

### 2.2 字面转义还原的触发条件：真实换行极少且字面转义存在时才动

`normalizeBody` 在两个副本里逐字一致：先数真实换行符个数，再数字面转义（反斜杠后面跟字母 n 的两个字符）出现次数；当真实换行少于 2 个、且字面转义至少出现 1 次时，把全部字面转义替换为真实换行；否则原样返回。注释原话是避免误伤正常正文。

`normalizeTrackerText` 用同一阈值处理主锚文本。`parseIssueTracker` 本体只做去首不可见字符加首尾空白清理，注释写明字面转义已在 `normalizeBody` 层处理。

### 2.3 接线与测试钉住点

`parseMapBody` 在 `src/shared/parser.js` 与 `src/host/mapBody.js` 里都是先调 `normalizeBody(body)` 再按行切分。`tests/verify-progress.js` 的 T16 段用坏格式正文（开头不可见字符加整篇字面转义、零真实换行）断言剥头、还原换行、不再含字面转义、不误伤正常正文、空串安全，以及端到端恢复 `Destination` 与 `Notes`。`tests/verify-parse-leaf.js` 用同一坏格式输入断言叶子与两份构建产物逐项一致。

## 3. 按行切时对两种换行的兼容写法

`parseMapBody` 在上述两个文件里都用同一正则切行，同时接受 `LF` 与 `CRLF`。同类兼容写法散见多处：`src/host/bootstrap.js` 的 frontmatter 匹配用首尾分隔线加可选回车；`src/host/skillProbe.js` 的 `isSkillCardValid` 用同样的首尾分隔线加可选回车匹配；`src/host/remotePredicates.js`、`src/shared/tracker/sync.js`、`src/host/issueList.js`、`src/host/namingGuardian.js`、`src/client/views/shared/md.js` 的按行切分同样用兼容两种换行的正则。

反例同样是事实：`src/host/tracker/backends/markdown` 下的 `issues-labels.js`、`issues-status.js`、`issues-patch.js` 与 `parse.js` 用只切 `LF` 的写法，`CRLF` 输入会留下行尾回车。本票不评价好坏，只记录差异。

提示词模板另有一道换行门禁。`tests/verify-prompt-newlines.js`（`#430` 根因门禁）要求模板源码写单层转义，运行时注入真实换行；写成双层转义会在运行时留下字面反斜杠加 n，换行失效。唯一允许的字面提及是正文格式契约里描述反斜杠加 n 本身的固定短语，文件内的允许清单逐条列出。`CHANGELOG.md` 与提交 `3d1e64a` 记录了地图空态检查按钮模板因此修复并补门禁。

## 4. Windows 编辑器另存带头的历史加固点

加固点在 `src/host/skillProbe.js` 的 `isSkillCardValid`。注释写明来源 `#295`：Windows 编辑器另存的技能名片带隐形开头字符，前 matter 本身合法，此前被误判为名片无效。修复只剥开头的第一个该字符，非带头输入逐字节透传，名称精确匹配防冒名机制不变。frontmatter 匹配本身兼容两种换行。

验收在 `tests/verify-skill-probe-redcard-and-waiting.js` 第 3.6 节：真实磁盘上的带头合法名片经文件系统通道与直读通道都判绿；带头加错名仍判红牌，细节含无效字样。`CHANGELOG.md` 的 `v1.7.7` 条目同步记录了技能名片带头兼容（对应提交 `b459deb`）。

注意区分：第 2 章的剥头管正文解析容错，本章的剥头管技能名片有效性判定。两者正则相同，触发位置与目的不同。

## 5. 平台抽象层管的四样与三个系统底座的配方

### 5.1 通用层单点拥有的四样

入口在 `src/host/platform/index.js`：`createPlatform` 按当前系统名查静态注册表（`darwin`、`win32`、`linux` 三个静态引入，禁用变量路径动态引入以便打包静态分析），`composePlatform` 做通用包装。`src/host/platform/README.md` 与文件头注释把职责定为四样，外加本机可见打开的统一调起。

第一样是路径：同步方法全部委托系统自带路径库（Windows 用其 Windows 变体，其余用其 POSIX 变体），各系统底座不得重实现路径拼接；唯一异步成员是按主目录拼接。 deck 永不手写反斜杠拼接。

第二样是主目录：结果在平台实现内部缓存，进程内默认终身有效，不设强制刷新口。

第三样是找程序：包装宿主的程序解析服务，找不到时抛错转空值。`gh` 的备用路径兜底自 2026-08-29 起由通用层单点拥有：按参数解析失败时读 `DSH_GH_PATH` 并用文件系统校验存在才返回，三个系统底座行为一致。此前 Linux 适配器自带的兜底已于同日移除，不再重复实现。

第四样是读写文件走沙箱：`fs` 直接透传宿主文件服务（读穿透沙箱、写有栅栏），不提供新建目录方法。实现者须区分路径形参与目标形参两类用法，裸路径串不直接喂给目标形方法。环境变量只给只读视图（取值与判有），不改也不外发。

统一调起是开目录与开文件两个意图函数，调用方只说意图不分支系统。调起一律即发即忘，参数用数组直传，引号由调起层按需加。

### 5.2 三个系统底座各自的配方

Windows 底座在 `src/host/platform/win32/index.js`（`#161` 定版）：路径数学全委托 Windows 变体；主目录先用系统主目录函数，形态不符合盘符开头时回退到用户配置目录，再退到盘符加家路径组合，从不读家目录环境变量；程序别名只认 `cmd` 到 `cmd.exe`；本机可见打开经 `cmd start` 显式可视，含壳元字符一律拒绝，文件名含空格或特殊字符时放弃选中改为打开上级目录。

macOS 底座在 `src/host/platform/darwin/index.js`（`#165` 落地）：路径全委托 POSIX 变体；主目录直接采用系统主目录函数，空串与抛异常都归一为空值，不二次读家目录环境变量；别名只有自身恒等，`gh` 不做别名；本机可见打开沿用 `open`，目录与文件同一路；反斜杠视为合法文件名字符，不作分隔符。

Linux 底座在 `src/host/platform/linux/index.js`（`#169` 落地）：路径全委托 POSIX 变体；主目录口径与 macOS 相同，覆盖容器最小镜像与无账户场景；不对 shell 程序做别名；`gh` 非常规安装的备用路径逻辑已上收到通用层，本文件只做直透；本机可见打开沿用 `xdg-open`；家目录缩写与变量展开一律不做，归调用方。

接线佐证：`src/host/platformChannel.js` 的 `getPlatform` 做平台单点解析与注入回退；`src/host/repoKeys.js` 的找 `gh`、找 `git` 与取主目录都经平台层；`src/host/skillProbe.js` 的找项目根与拼技能名片路径都经平台路径与平台主目录。

## 6. 终端下传正文时转义吃法不同的实证

实证全部来自 `docs/research/RESEARCH-NOTES.md` 的真机记录，对端为 `gh 2.97.0`，宿主契约以安装目录类型定义为准。

第一条是 PowerShell 引号坑。该文件第 4 节记录：Windows PowerShell 5.1 调原生命令会吞掉参数内嵌的双引号，查询表达式里的字符串字面量会变成无引号而报语法错，`gh api graphql` 行内传查询同样被吞。规避三件套是查询表达式里避开字符串字面量、GraphQL 查询改用文件输入且变量内联进文件、长正文一律用正文文件参数。该节末尾明确宿主内跑 gh 用进程直启，不经 PowerShell，所以无此坑，此坑只影响调试与自测命令。第 1.4 节的 GraphQL 单查询推荐写法就是该规避的实例：查询与变量先写进文件，再用文件输入加查询过滤取数，文件内附了 6 张子票的状态与阻塞计数实测输出。

第二条是 `@me` 被吞。该文件第 5 节遗留项记录：`gh issue edit --add-assignee @me` 语法可用，但 PowerShell 直调会吞掉 `@me` 而报缺参数，需引号包裹；宿主侧参数数组无此问题。

第三条是宿主侧标准姿势。该文件第 6.3 节记录：宿主调 gh 用参数数组直启，参数不经过 shell；输出经收集器按偏移读取，完成态给退出码；宿主无中止控制器全局量，超时用计时器竞速加终止句柄实现。`src/host/tracker/backends/github/client.js` 的 `ghClient` 是该姿势的代码落点。

第四条是文件方式的约定链。终端侧：`docs/agents/issue-tracker.md` 要求多行正文用 heredoc；`docs/research/RESEARCH-NOTES.md` 第 4 节要求长正文一律用正文文件参数。面板侧：`src/client/kernel/prompts.js` 的正文格式契约（第 3 版）要求真实换行、禁字面转义与禁开头不可见字符、写回以文件方式提交且文件内为真实换行；`src/client/kernel/router.js` 把该契约挂到新建需求与新增缺陷两个建图入口（各追加一次），另有两个执行与完成模板自包含该契约；`tests/verify-prompts.js` 门禁检查三要点且要求工具无关表述；`tests/verify-progress.js` 门禁检查追加点个数与自包含内嵌。事实差集见第 1 章末尾：宿主写代码当前仍用行内参数，未用正文文件参数。

## 事实清单

- 终端新建与评论约定：`docs/agents/issue-tracker.md`，无函数（文档约定）。
- 终端建子票、挂父、阻塞、认领、评论、关闭实测：`docs/research/RESEARCH-NOTES.md` 第 1.5 节与第 6.1 节，无函数（实测记录）。
- 宿主新建、更新、关闭、重开、改认领：`src/host/tracker/backends/github/issues-write.js` 的 `createIssue`、`updateIssue`、`closeIssue`、`reopenIssue`、`setAssignees`。
- 宿主写评论：`src/host/tracker/backends/github/comments.js` 的 `addComment`。
- 宿主命令执行与找程序：`src/host/tracker/backends/github/client.js` 的 `ghClient`、`execGh`、`execJson`、`resolveGh`。
- 正文正规化真源：`src/shared/parser.js` 的 `normalizeBody`。
- 正文正规化宿主副本：`src/host/mapBody.js` 里 `createMapBody` 闭包内的 `normalizeBody`。
- 主锚文本清理：`src/host/tracker/detection/parseIssueTracker.js` 的 `parseIssueTracker` 与 `normalizeTrackerText`。
- 正文解析接线：`src/shared/parser.js` 与 `src/host/mapBody.js` 的 `parseMapBody`。
- 技能名片带头加固：`src/host/skillProbe.js` 的 `isSkillCardValid`，验收在 `tests/verify-skill-probe-redcard-and-waiting.js` 第 3.6 节。
- 平台通用层：`src/host/platform/index.js` 的 `createPlatform`、`composePlatform`、`buildPath`、`buildEnv`。
- Windows 配方：`src/host/platform/win32/index.js` 的默认导出适配器函数内 `getHome`、`resolveExecutable`、`shellOpen`。
- macOS 配方：`src/host/platform/darwin/index.js` 的默认导出适配器函数内 `getHome`、`resolveExecutable`、`shellOpen`。
- Linux 配方：`src/host/platform/linux/index.js` 的默认导出适配器函数内 `getHome`、`resolveExecutable`、`shellOpen`。
- 平台接线：`src/host/platformChannel.js` 的 `getPlatform`，`src/host/repoKeys.js` 的找程序与取主目录函数。
- 终端转义实证：`docs/research/RESEARCH-NOTES.md` 第 4 节、第 1.4 节、第 5 节、第 6.3 节。
- 模板换行门禁：`tests/verify-prompt-newlines.js`，修复提交 `3d1e64a`（对应 `#430`）。
- 正文格式契约：`src/client/kernel/prompts.js` 的 `bodyFormat` 条目与 `BODY_FORMAT` 函数，挂载点在 `src/client/kernel/router.js` 的 `newWayfinderText` 与 `newBugWayfinderText`，门禁在 `tests/verify-prompts.js` 与 `tests/verify-progress.js`。

## 进度：95%

下一步：待真人确认本份事实清单是否覆盖 `#568` 提问的全部六项、以及文件与函数归属有无错漏。未确认不得 close。
