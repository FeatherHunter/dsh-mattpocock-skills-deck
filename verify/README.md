# 真机验证接入

这份目录把 base 仓的 real-machine-verification（下称 base，命令行是 `dsh-verify`）接进本插件。
通用能力——复制隔离 home、起停实例、隔离探针、冻结候选、批次身份、证据归档、清理、场景机制——
都在 base 里，本仓只声明「这个插件长什么样」并写插件特有的场景与检查；2026-11 起旧的真机工具台
（`scripts/real-machine/commands/` 里的通用命令与对应 `lib/`）已删除，只留插件特有命令。

## 目录

- `profile.ts`：base 读取的声明。包名、默认 profile、客户端入口、插件缓存/设置目录、随包技能数、
  Playwright 适配器、五种工作区后端、构建命令、实例环境放行名单和五个插件检查。
- `browser.mjs`：Playwright 适配器，只负责驱动浏览器；尺寸判据与截图证据由 base 的 `page-check`
  负责。它比 `BrowserPageHandle` 多一个 `goto(url)`：DSH 的 token URL 要先换成会话 cookie，
  用 `window.location.assign` 从 `about:blank` 跳转会在 cookie 生效前发出重定向请求，页面收到 401。
  适配器还过滤 `Failed to load resource: ... status of 404/405` 这类网络噪声（本机 `dsh-im-companion`
  会稳定产生），只把真正的 `pageerror` 与 `console.error` 记进 `pageErrors()`。
- `checks/`：五个插件特有检查（glab 可用、GitLab 沙箱项目、种子票池、工作区夹具、日志目录）。
- `hooks.ts`：场景钩子 `prepareHome`——home 刚复制完、宿主进程还没启动的那一瞬间，把验证工作区写进
  `storages/workspace.json`。这是唯一可靠的时机：`beforeLaunch` 时 home 还不存在；`afterLaunch` 时
  DSH 已经启动，它会在首次页面加载时把内存里的默认工作区整份写回磁盘，覆盖钩子先写入的条目。
- `scenarios/ui.ts`：界面主场景。启动 → 核对启动时种下的工作区与 home 注册表 → 通过 RPC 建会话 →
  断言正文、工作区按钮（存在 / 在视口内 / 中心点命中）、菜单、首开遮罩已消失、页面无报错 → 截图入证据 → 停止。
- `scenarios/smoke.ts`：双实例冒烟。起两个实例，断言 home / 启动目录 / 端口 / pid 两两不同、两页可开且
  各自指向自己的实例，最后一条 `stop` 不带 id 把两个一起停掉、确认没有残留。
- `presets.mjs`、`windows.mjs`：有头验证用的三款窗口预设与真全屏判据（见下）。

## 两个工作目录，别混

| 命令 | 工作目录 | 原因 |
| --- | --- | --- |
| `freeze` | `package/`（带 `--declaration ../verify/profile.ts`） | `freeze` 在当前目录读 `package.json` 并 `npm pack`；`package/` 才是发布包的根 |
| `install`、`self-check`、`single-instance`、`concurrent`、`batch`、`evidence`、`run`、`cleanup` | 仓库根 | `install` 要读仓库根的包身份；声明在 `verify/profile.ts`，插件检查读仓库里的 `scripts/real-machine/` |

## 批次 home 与 DSH_HOME

真实 home（`C:/Users/辰辰洋洋/.dsh`）只读：不要对它跑任何 `dsh-verify` 命令。写入目标是真实 home 本身或它里面
（含子目录、junction）时，`install`、`model --fix` 与任何显式写目标（`--work-root` / `--out` / `--archive-root`）都会被硬拒（exit 2）；
`--dry-run` 只警告、不写盘。每次验证先复制一份 `profiles/web` 到批次 home，再让 `DSH_HOME`
指向批次 home 的**父目录**：

```powershell
$real = "C:/Users/辰辰洋洋/.dsh"
$batch = "D:/Temp/matt-batch-home"
New-Item -ItemType Directory -Force -Path "$batch/profiles" | Out-Null
Copy-Item -Recurse -Force "$real/profiles/web" "$batch/profiles/web"
$env:DSH_HOME = $batch
```

复制要包含 `node_modules`；实例能否启动取决于这份依赖。如果复制后的 profile 起不来，改为只复制
`package.json`、`cordis.yml`、`cordis.patch.yml` 等配置文件，再在批次 home 里重新安装依赖。

## 依赖：钉 npm 上的精确版本

根 `package.json` 的 `devDependencies` 钉的是 npm 上发布的**精确版本**（当前 `"dsh-featherhunter-plugin-base": "0.1.7"`），
不用 `file:` / `link:`：发布产物要能被 CI 和其它机器原样安装，路径依赖解析不到；五仓接入规则也要求精确版本。

在仓库根跑 `pnpm install` 后即可用 `node node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js`
（或 `node_modules/.bin/dsh-verify`）；`playwright` 也从根依赖里来。核对实际装的版本：

```powershell
node -e "console.log(require('dsh-featherhunter-plugin-base/package.json').version)"
```

base 的能力变化不会自动流进来。要在本地试未发布的 base 改动，可以临时 `pnpm link` / `file:` 指过去，
**只留在工作树里、不提交**；要让改动进入本仓（含 CI 与发布），先给 base 发新版本，再把这里的精确版本号升上去。

需要看 base 命令的完整参数时，直接对已安装的 CLI 跑 `node_modules/.bin/dsh-verify describe --json`。

## 完整命令序列

先构建发布包（不提交产物）：

```powershell
cd package
node ../verify/build.mjs --pkg-only
cd ..
```

这个包装调用原构建脚本 `node ../scripts/build.mts --pkg-only`，再做两件 base `freeze` 要求的事：

- 在 `lib/client.js` 首行写入 `/*! dsh-mattpocock-skills-deck v<版本> */` 身份横幅。产物里第一处
  这种横幅原本来自内联的 base 包，`freeze` 会据此误判包名与版本。
- 校验产物里的 `DSW_BUILD_COMMIT` 与当前 HEAD 一致；构建缓存命中导致提交号过期时，用
  `--force` 重建一次，而不是改写产物里的提交号。

然后按顺序跑。批次是两段式：先开批（此时还没有候选）、把候选冻进批次目录、再封存——顺序反了会被候选准入拒掉（「不在批次目录」/「早于批次」）。所有命令都在仓库根，只有 `freeze` 例外（它必须在 `package/` 下跑）。

```powershell
# 1. 开批次（prepare）：只写 batch.json（candidate 为 null）并打印基线行。
node <baseCli> batch open --name <批次名> --base-ref HEAD --work-root D:/Temp/matt-batches --json

# 2. 冻结候选，必须冻进批次目录（工作区 dirty，必须 --allow-dirty）。
#    freeze 会在 pkg/ 下建一个 <提交前缀>-<时间戳>/ 目录，candidate.json 与 tgz 都在里面。
cd package
node <baseCli> freeze --declaration ../verify/profile.ts --out D:/Temp/matt-batches/batches/<批次名>/pkg --allow-dirty --json
cd ..

# 3. 封存（seal）：--candidate 指向 freeze 打印的 candidatePath 所在目录；通过才写身份行。
$candidateDir = (Get-ChildItem D:/Temp/matt-batches/batches/<批次名>/pkg -Directory | Select-Object -Last 1).FullName
node <baseCli> batch open --name <批次名> --candidate $candidateDir --work-root D:/Temp/matt-batches --json
node <baseCli> batch status --name <批次名> --work-root D:/Temp/matt-batches --json

# 4. 把候选装进批次 home 的 web profile（cwd 必须是仓库根）。
$env:DSH_HOME = "D:/Temp/matt-batch-home"
$tgz = (Get-ChildItem $candidateDir -Filter *.tgz | Select-Object -First 1).FullName
node <baseCli> install --tgz $tgz --profile web --method extract --candidate $candidateDir

# 5. 自检。必须 exit 0；红检查按 hint 修 verify/ 里的文件，不改 base。
node <baseCli> self-check --profile web --json

# 6. 单实例验收。页面检查在无头模式下可能 blocked（exit 2），其余必须 pass。
node <baseCli> single-instance --profile web --json

# 7. 双实例隔离。instances-distinct 与 teardown-clean 必须 pass。
node <baseCli> concurrent --count 2 --work-root D:/Temp/matt-concurrent --json

# 8. 场景：界面主场景与双实例冒烟（scenario 是位置参数，不是 --scenario）。
node <baseCli> run verify/scenarios/ui.ts --profile web --json
node <baseCli> run verify/scenarios/smoke.ts --profile web --json

# 9. 收尾：先报账再删。
node <baseCli> cleanup --yes --keep-batches 5 --keep-homes 2 --json
```

`<baseCli>` 就是上面那条 `node .../dist/real-machine-verification/cli/main.js`；也可以直接用
`node_modules/.bin/dsh-verify`。`npm run verify:ui` / `npm run verify:smoke` 是 8 的便捷入口
（带 `--import ./scripts/ts-hook.mts`，让 base 能直接执行 `.ts` 场景文件）。

场景启动的页面默认停在 `about:blank`，`primitives.page()` 不会自动导航；场景要先通过适配器的
`goto(tokenUrl)` 打开实例（在场景里拿 `page.value.page` 原始句柄调 `goto`，再读 `page()` 的
`url()` / `text()`），不要假设 `page()` 已经打开登录页。

## 发布门禁

发布前的六条判据由 base 的 `runReleaseGate` 一次裁决，本仓只接线，不复制规则：

- `scripts/lib/release-preflight-gate.mts`：组合根，也是全仓唯一 import `runReleaseGate` 的文件。它读
  `verify/profile.ts`、取发布提交（`git rev-parse HEAD`）、把候选清单与票面适配器传进门禁，再把报告
  渲染成人类可读行与 `PREFLIGHT-*` 标记。
- `scripts/release-preflight.mts`：薄命令行，只认 `--version` / `--candidate`（外加 `--help`）；没有
  `--soft` 之类跳过开关。退出码四态：0 通过、1 票面或候选要人改、2 无法判定
  （`PREFLIGHT-BLOCKED` / `PREFLIGHT-ENV`）。用 `process.exitCode` 收尾，避免 Node 24 在 Windows 上
  截断 stdout。
- `verify/ticket-face.mts`：gh CLI + git 的票面适配器（`kind: github-gh-cli`），在方法里才做 IO；环境
  问题抛 `ReleaseEnvError` 归 blocked，内容问题归规则层 fail；`isAncestor` 三态，git 答不了时返回
  `"unknown"`，不拿 `false` 冒充。
- 两条发布路径（`scripts/publish-token.ps1` 与 `scripts/wizard-release.sh`）都调同一个
  `scripts/release-preflight.mts`，按退出码四态分流；`-DryRun` / `--dry-run` 只改「要不要中止发布」，
  不改门禁结论。
- 回归门禁 `tests/verify-release-gate.ts`：六条规则的输入用假票面适配器 + 假 git 命令端口驱动
  （A–J 组），接线用源码静态断言（K 组：只有组合根 import `runReleaseGate`、CLI 没有跳过开关、
  两条发布路径都调它、适配器形状交给 base 的 `validateTicketFaceAdapter`），再跑一次薄 CLI 的
  `--help` 与参数错误（L 组）。不碰真 gh、不发网络请求。改这些文件后跑
  `node scripts/gate-map.mts` 重生成归属表，再跑 `tests/verify-gate-map.ts`。

不传 `--candidate` 时只核对票面与身份行，不证明要发的字节（输出里会写明）；传入时，候选提交等于发布
提交打 `PREFLIGHT-CANDIDATE-OK`，候选提交不同但票面有差异审计打 `PREFLIGHT-CANDIDATE-AUDIT`
（`publish-token.ps1` 据此放行后面的字节对账）。

## 有头验证与三款窗口尺寸

base 的场景原语固定无头，所以「浮层会不会被别的界面元素盖住」「提示贴到屏幕边缘会不会越界」这类
空间问题仍由本仓的有头脚本回答，判据与执行都留在 `verify/`：

- 必须真全屏：页面视口与外框（`innerWidth`/`outerWidth`、`innerHeight`/`outerHeight`）都要等于
  `screen.width`/`screen.height`，容差 2px，NaN 直接拒绝。2026-10-29 验 1655-01 时 Playwright 的
  `--start-fullscreen` 被忽略、窗口只有 1083 像素宽，再用 `setViewportSize` 强设页面视口，截图看起来
  铺满屏幕，据此得出的结论后来被真全屏复核推翻；`verify/windows.mjs` 就是那次事故的判据与
  CDP `Browser.setWindowBounds` 执行函数。
- 三款窗口尺寸：`wide` 真全屏、`narrow` 外框宽 800 且高铺满屏幕（插件面板落在 300–359 像素）、
  `short` 外框宽铺满屏幕且高 600，定义在 `verify/presets.mjs` 的 `VIEWPORT_PRESETS`。窄窗是 800
  不是 720：窗口宽与面板宽不线性，720 宽时宿主把右侧面板切成整宽覆盖，反而进不了插件窄态。

## 插件特有命令（保留在 scripts/real-machine/）

通用命令迁走后，下面这些只服务本插件的 GitLab / deck / 日志场景，仍按旧写法跑：

```powershell
node --import ./scripts/ts-hook.mts scripts/real-machine/commands/<命令>.mts <参数>
```

- `gitlab-sandbox create|delete`：在 gitlab.com 建/删带批次标记的私有空项目，删除按 id 读回
  `marked_for_deletion_at` 才算掉。
- `seed-gitlab`：幂等种票池（默认 101 张票、两张地图、5 个标签、父子与阻塞关系），重跑按正文稳定键认回。
- `log-query`：按事件名、级别、字段过滤插件日志。
- `report-index`：把 `evidence-archive/index.jsonl` 与 `conditions.jsonl` 汇总成报告能用的数字与 Markdown。
- `deck-write` / `deck-readback`：隔离实例里直调一次 deck 写工具，再用 `glab api` 独立读回，写读两条路径一致
  才算数。提交门禁是 `tests/verify-1709-deck-entry.ts`。
- 门禁：`tests/verify-1706-gitlab-project.ts`、`verify-1708-seed-data.ts`、`verify-1709-deck-entry.ts`、
  `verify-1711-report-index.ts` 与 `tests/verify-windows.ts`、`tests/verify-verify-checks.ts` 都在主链上；
  删改这些库以后跑 `node scripts/gate-map.mts` 重生成归属表再跑 `tests/verify-gate-map.ts`。

## 退出码语义

| 退出码 | 含义 |
| --- | --- |
| 0 | 所有硬检查 pass；`skip` 与软检查失败不改变退出码 |
| 1 | 至少一个硬检查 fail |
| 2 | 没有硬失败，但至少一个检查 blocked（缺浏览器、缺屏幕、缺环境等） |

blocked 不是失败：`self-check` 的自定义检查可以用 `CheckObservation.status` 表达 `pass` / `fail` / `skip` / `blocked`
（`blocked` 可带 `blockedReason`，三码之一：adapter-missing / prerequisite-missing / platform-unsupported），旧写法 `ok: true|false` 仍兼容。
但页面、日志内容这类需要真实实例的断言仍应放进场景（用 `ScenarioObservation.status` 表达），不要塞进 self-check。

## development 候选

当前 `package.json` 版本是 `1.9.0-beta.34` 时，工作区未提交改动意味着：

- `freeze` 必须带 `--allow-dirty`；
- 候选是 development 性质，`validity` / `sourceStable` 不是 release 结论；
- 不要把这个候选当成可发布产物，也不要在开发验证阶段做 `npm publish`。

## 迁移后仍存在的边界

- 需要**有头**浏览器（真全屏、多窗口预设）时，base 的场景原语固定 headless；这类检查留在本仓的
  `verify/windows.mjs` / `verify/presets.mjs`，不要塞进场景硬跑。
- 票面适配器是本仓的 `verify/ticket-face.mts`，由 `profile.ticketFace` 指过去；换 tracker 时按 base
  的适配器接口另写一份并在声明里换掉，不要私改 base 核心。没有适配器时 `release-gate` 记 blocked
  并给出注入方法。
- 真实 home 的 `mattskillsdeck/settings.yaml` 要在验证前后做 sha256 复核；任何检查都不要写真实 home，
  日志目录检查在 `DSH_HOME` 等于真实 home 时只读跳过。
