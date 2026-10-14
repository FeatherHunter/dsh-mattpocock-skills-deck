# Agent Instructions

This file gives an agent working in this repo the context it needs to operate well.

## Agent skills

### Issue tracker

Issues live as GitHub issues, driven through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles (`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`) plus five wayfinder labels (`wayfinder:map` / `research` / `prototype` / `grilling` / `task`). The **mandatory label set** is `bug` / `needs-triage` / `wayfinder:grilling`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.

### 提问方式

需要人拿主意时，把问题直接写在对话正文里，不用弹窗式提问工具——弹窗会挡住正文解释，人看不到完整的来龙去脉。

### Human-first wording

执行任务中写下的所有文字——对话回复、issue 标题与正文、markdown 文档、代码注释、任何文件——都以「人类第一次阅读就能准确理解」为第一标准：只使用 CONTEXT.md 词典或此前交流中已确立含义的词语；确需表达新概念时，写成完整、平实的描述，而不是造一个需要另行解释的简称或比喻。先满足人的可读性，再谈机器的便利——AI 能读懂平实的完整句，却会替读者造出只有当次会话才明白的速记。

**发出去之前，都停一秒问自己：**
1. 没看过前文的人，能直接看懂这句话在说什么吗？
2. 有没有用了只有我们这次对话才懂的叫法？有就改成大白话。
3. 新东西是不是用一整句话说清楚了，而不是只扔一个词让别人去猜？

### 提交信息规范

所有 `git commit` 信息必须用中文，用通顺的完整句子说清“这次改了什么、为什么改”。标题至少 10 个字，不要只写 `fix` / `update`。详见 `docs/agents/commit-convention.md`。

### 及时提交与推送

每个可以独立交付的模块开发完成后，就马上把代码提交并推送到远端，避免本地改动因为误操作或换机器而丢失。不要把多个模块攒在一起一次性提交。

只用不会丢文件、不改写历史的命令，例如 `git status`、`git diff`、`git log`、`git add`、`git commit`、`git push`、`git pull --ff-only`。提交信息遵守上面“提交信息规范”里的中文要求。

不要用任何可能丢文件或改写历史的命令，例如 `git reset --hard`、`git checkout .`、`git clean -f`、`git push --force`、`git rebase`、`git filter-branch`。拿不准某条命令会不会丢数据时，先停下来问人，不要自己试。

### TypeScript 优先，旧 JS 随改随迁，最终只留 TS

最终目标是项目里手写代码只有 TypeScript，没有手写 JavaScript（构建产物和派生文件生成的 `.js` 不算）。以后凡是需求、修 bug、做规划、写设计时动到本插件的手写代码，一律优先用 TypeScript 写；存量 JavaScript 不单独立项重写，采取“动到哪里就转到哪里”的方式转，直到清零。本条继承 `tsconfig.client.json` 里“摸到谁再转谁，不搞大爆炸”的口径，并把它推广到全仓。

1. 以文件为单位，先修后转、两次提交，不再新增手写 JS：先提交一次纯修复，再提交一次把这个文件转成 TypeScript，转完行为零变化。只转本次真正动到的文件；以后新增文件一律写 `.ts`（含 `.mts`/`.d.ts`）。派生文件（例如 `scripts/generated/*`）、自动检查本身、临时目录永不转。清零口径是手写 `.js` 归零，构建产物不计。
2. 转完要接上构建：同步登记到对应 `tsconfig` 的 `include` 与 `scripts/build.mjs` 清单（不登记会静默不编译），沿用 `target ES2020`、`strict`、`noEmit` 加 `esbuild` 转译，然后把 `tsc -p`、构建、相关 `tests/verify-*` 与冒烟跑通才算完。
3. 转完要把注释补足：公开函数、类型、关键分支用中文完整句写清为什么、什么约定不能改、什么反例，不要复述类型名。样板看 `src/shared/label-color/src/colors.ts` 开头。
4. 转完顺手加日志，走下一节“日志埋点纪律”，以排查优先、多记但无垃圾为准。

### 测试怎么直接加载 .ts（Node 下限与装包守卫）

旧测试与旧源码是「按单元分批」从 `.js` 转成 `.ts` 的：一个文件改名之后，引用它的地方仍然写着 `./x.js`。`scripts/ts-hook.mjs` 就是这件事的装载钩子——它把这类说明符改指同目录下的同名 `.ts`；同名 `.ts` 不存在时原样交给 Node，所以没迁移的文件行为与今天完全一样。用法是把钩子挂在要跑的脚本前面：

```
node --import ./scripts/ts-hook.mjs tests/你的测试.ts
```

`npm test`（经 `scripts/verify-chain.js`）、`npm run verify:parallel`（经 `scripts/verify-parallel.mjs`）、`node scripts/verify-all.mjs`（CI 的 `.github/workflows/verify.yml` 跑的就是它，逐道跑完再汇总）三个入口跑测试时都会自动挂上这个钩子，写测试的人不用自己加；`npm run test:smoke`（六条冒烟）从 #1178 起也走 `scripts/verify-chain.js`（`--script smoke` 读 `package.json` 的 `scripts.smoke` 那串清单），钩子判定跟着那一条路走。同一个判定分散在这三处加上链执行器这一处，改一处必须全改——漏掉哪个入口，哪个入口里的 `.ts` 迁移就会跟别处表现不一样，典型症状是「本机 `npm test` 全绿、CI 红」。

**Node 下限怎么来的**：钩子用的是同步的 `module.registerHooks()`，它同时管 ESM 的 `import` 与 CommonJS 的 `require`；异步的 `module.register()` 管不到 `require`，替代不了它。同步的 `registerHooks()` 从 Node 22.15 才有，这是这条线的起点——但 22.15 不等于能跑：钩子开着的时候测试加载的是 `.ts` 源码，而 Node 默认开启 TypeScript 类型剥离要到 22.18，再往上还有依赖自己的硬线（`jsdom` 声明 `^22.22.2 || ^24.15.0 || >=26.0.0`，8 个用例在用它）。所以根 `package.json` 的 `engines.node` 写的是 `"^22.22.2 || ^24.15.0 || >=26.0.0"`：22 线要 22.22.2 及以上，24 线要 24.15 及以上，26 及以上任意（23、25 是短命版本线，不单独支持）。这个范围是从最严的那个依赖抄来的，依赖一升要跟着复核；写窄了人会卡在「根项目通过、依赖拒绝」的信息里。

**装包守卫分两处，缺一个就漏一半人**：用 npm 的人靠 `.npmrc` 的 `engine-strict=true`；用 pnpm 的人靠 `pnpm-workspace.yaml` 的 `engineStrict: true`——实测 pnpm 不认 `.npmrc` 里的 `engine-strict`（只打一条警告就继续装，退出码 0），只有 `pnpm-workspace.yaml` 那一处是硬拦截（退出码 1）。两处都会连整棵依赖树一起查。钩子自己还做一次能力检测：Node 太旧时抛出能指路的一句话，而不是难懂的 `TypeError`。

**已知代价（不算故障）**：挂着钩子加载 `.ts` 时，Node 会打一条 `MODULE_TYPELESS_PACKAGE_JSON` 警告，提示可以给 `package.json` 加 `"type": "module"`。这条警告今天加载 `.js` 产物时同样会出现（原因相同：最近的 `package.json` 没有 `type` 字段），所以钩子没有引入新一类噪音。

**「同名 `.ts` 优先」意味着测试加载的是源码，不是构建产物**：`src/client/views/**` 那 34 组同名文件里的 `.js` 是构建产物，钩子开着的时候测试加载的是 `.ts` 源码。产物有没有跟上源码，是 `verify-*-freshness` 那几条门禁的职责，不是这里的。

**测试侧只能写可剥离的 TypeScript**：`enum`、构造函数参数属性（`constructor(private x: T)`）这类需要真正转换的写法，在测试与链上脚本里会直接报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`——Node 的剥离模式只删类型标注，不做语法转换。构建侧由 esbuild 转译，能吃这些写法，所以「同一份源码两边都过」不能想当然。仓里目前没有这类写法，也没有门禁拦它，靠的就是这条规矩。

**链上脚本 spawn 出去的子进程不带钩子**：`tests/` 里有十几处直接用 `child_process` 起 `node` 进程（其中 5 处会重跑门禁脚本），子进程不会再挂钩子。等这些脚本自己转成 `.ts` 的时候，要么给子进程也加 `--import`，要么把它们改成同进程调用。

### 日志埋点纪律（先读总纲票 #502：日志体系采用总纲与查阅入口）

目标：穿过不透明边界的流程做完，不用人补话，AI 只看本地诊断日志就能说出走到哪一步、停在哪个环节。日志多多益善，但只收信号、不收垃圾。

1. 只在三类边界留整趟轨迹：进程或模块边界、持久化边界、时间边界。每趟含起点输入摘要、分支原因、外部调用结果加耗时、状态变化、终点结论；异常行写清环节名、输入摘要、期望和实际差在哪、上游原因。老口径五种是这三类的例子。同一趟先用现有键串起来（工作区短指纹、方法名、时间），不够串再单独立票做真正的请求 ID。
2. 垃圾四种，一律不加：无变化的心跳重复记、只记结果不记原因、把整个对象倒进日志、高频不判开关直接记。加前只问一句：这行能排除哪种故障、指到下一步查哪里，答不上就不加。事件名与字段含义稳定，改含义发新事件。
3. 量与内容分两层：常驻最小够用，按需可放宽，采样节流与开关外层判断按 `docs/design/335-logging-contract.md` 第 3 章。硬红线只有一条：可重放的凭证原文永不落盘（令牌、口令键值、授权头）。路径标题错误在按需里放宽到能定位为止，但门和表没改成按档松紧前，先按现行白名单记，例外单独立票改门改表。
4. 验收分级：新流程与核心链路用当天导出包走一遍只看日志定位，走不通就是埋点缺；纯重构注释类型迁移免演练。动手前跑通相关 `tests/verify-log-*`，增删事件同步改 `research/489-appendix.md` 第 1 章对照表，现行条数以该附录为准。变红先补日志点，再谈功能。

### 终端纪律

手工跑命令用 DSH 原生的侧栏终端（右侧栏那颗「终端」标签页，标签标题写成 `<票号>-<用途>`，方便事后回看）。这套终端由 DSH 自带，与 better-sidebar 无关——better-sidebar 从 0.21 版起已经把自己带的那套终端删掉了。

AI 这边没有可用的终端工具（better-sidebar 删掉了它自带的 `terminal_*` 工具，DSH 侧对应的 `dsh-tool-terminal` 本机也没安装），开不出侧栏终端，所以 AI 的命令一律用系统原生的 `pwsh` 工具跑；跑什么、为什么跑，在对话正文里写清楚。

### Release 发布

Publish `package` (the main plugin; skills ship inside it, never separately). `dsh-log` and `dsh-plugin-update` now live in standalone repos and are only consumed from npm, never published from here (#878, #892). Private package shells are skipped automatically.

Token unattended path (prefer it when a write-capable token exists — no human clicks needed): set `$env:NODE_AUTH_TOKEN` (variable name only, never paste the token value) → run `pwsh -NoProfile -File scripts\publish-token.ps1 -Probe` first (it must say PROBE-OK) → run `pwsh -NoProfile -File scripts\publish-token.ps1` (gates → publish → one-pass sampling; add `-FullPost` before announcing). Accepted is not the same as visible: `E409 previously-staged` means the registry received the package, so wait a few minutes instead of republishing or bumping the version. The old interactive flow (`scripts\publish-all-window.ps1` via schtasks) stays as fallback. Publishing ends the job; installing is always done by the user (marketplace upgrade, in-app upgrade, or their own install command).