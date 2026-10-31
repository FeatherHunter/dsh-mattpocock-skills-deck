# 真机验证工具台

这套命令用来在一台真实机器上验证「这一版插件装进 DSH 以后到底能不能用」：复制一份隔离的 DSH home、
造出带真实仓库形状的工作区、起一个或两个实例、用无头浏览器点进界面核对、把截图与日志收成证据包，
最后把候选包冻结成带逐文件 SHA256 的清单。

它原先住在被忽略的临时目录里（#1474 那次验收），换一次版本就要从头重搭一次；#1645 把这套东西提升进仓库，
现在的新会话只需要读这一份 README 就能直接发现并调用，不用再问人「上次那个启动脚本在哪」。
仓库里与真机验证有关的规则（什么算通过、批次怎么记、清单票怎么开）在
[docs/agents/real-machine-verification.md](../../docs/agents/real-machine-verification.md)；
这份 README 只讲工具怎么用。

## 先看三件事

1. **命令一律从仓库根目录跑**，统一写法是：

   ```
   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/<命令>.mts <参数>
   ```

   `--import ./scripts/ts-hook.mts` 让 Node 直接跑 `.mts` 源码，不用先构建。命令成功时 stdout 只有一段 JSON，
   失败时退出码非 0、stderr 用一句中文说清为什么。要堆栈时加环境变量 `HARNESS_DEBUG=1`。

2. **所有产物都写在工作根里，默认是 `<仓库>/.scratch/verify-run/`**。这个目录被 `.gitignore` 忽略，
   批次产物（复制出来的 home、截图、日志、临时工作区）不会进版本库。换位置用环境变量
   `DSH_VERIFY_WORK_ROOT`，或在单条命令上加 `--out` / `--batch` / `--root`。
   工具只往三个地方写：工作根、系统临时目录、显式传给命令的目录；写别处会被拒绝（`lib/paths.mts` 的
   `assertWritableTarget`），这是为了防止手滑把证据写进真实用户目录。

3. **不会碰真实的 DSH 配置**。每个实例用自己复制出来的 `DSH_HOME`、自己的启动目录、自己的
   `USERPROFILE`/`HOME`；插件日志写在各自的启动目录下，插件设置写在各自的 `USERPROFILE` 里。
   `isolation-probe` 这条命令专门用来证明这件事：它对比真实用户设置文件在探针前后的 SHA256，没变才算通过。

4. **门禁走进程接口，不 import 命令内部函数**。`tests/lib/real-machine-process.ts` 是给门禁用的夹具：
   它在系统临时目录（或 `DSH_VERIFY_WORK_ROOT` 指定的位置）里开一个隔离工作根，用上面第 1 条的同一种写法
   起命令，直接拿回 stdout 那段 JSON、退出码、stderr 和工作根里的文件；`home`、临时目录、`DSH_REAL_HOME`
   都指进沙箱，假 `glab` 放在 PATH 最前面、同时用 `GLAB_BIN` 指过去，每次调用的 argv 与工作目录记进
   JSONL 供测试断言。整个过程不改宿主环境的变量，也不碰真实 DSH 配置。现成的例子是
   `tests/verify-1705-real-machine-fixture.ts`：
   ```
   node --import ./scripts/ts-hook.mts tests/verify-1705-real-machine-fixture.ts            # 正例，应退出 0
   node --import ./scripts/ts-hook.mts tests/verify-1705-real-machine-fixture.ts --negative # 负例，应退出 1
   ```
   负例故意写错两条期望，用来证明这扇门禁真的会红；新门禁也按这个约定带一个能单独触发的负例。

## 有头验证：窗口必须是真全屏

无头断言用固定视口（默认 1600x1000）没问题；但要判断「浮层会不会被别的界面元素盖住」「提示贴到屏幕边缘会不会越界」这类空间问题，必须让真实浏览器窗口真的全屏。2026-10-29 验 1655-01 时就错过一次：Playwright 的 `--start-fullscreen` 被忽略，真实窗口只有 1083 像素宽；用 `setViewportSize` 把页面视口强设成 2195 后截图看起来铺满屏幕，据此判「关闭整个 deck 的跟随浮层被右侧面板盖住、确认键鼠标点不到」。后来用 CDP 切真全屏复核，遮挡并不存在——错的是验证方法，不是产品。

现在这层保护做在 `lib/browser.mts` 里：

```js
// 有头：自动切真全屏并核对尺寸；切不成直接抛错
// 本机只装了 chromium_headless_shell 时补 channel: 'chrome'，改用系统装的 Chrome
const opened = await openInstance(instance.tokenUrl, { headless: false, channel: 'chrome' })
// opened.fullscreen 记着 innerWidth/innerHeight/outerWidth/outerHeight/screen 与判定结果
// page-diagnostics.json 里也有同一份 fullscreen 测量
```

- 切全屏走 Chrome DevTools Protocol 的 `Browser.setWindowBounds({ windowState: 'fullscreen' })`，不依赖 `--start-fullscreen`。
- 切完必须核对 `innerWidth/innerHeight/outerWidth/outerHeight` 都等于 `screen.width/height`（默认允许 2 像素误差），做不到就抛中文错误，不会留下「看起来很大、其实没全屏」的窗口。
- 要自己控制窗口时用 `newPage(browser, { fullscreen: true })` 或 `enterFullscreen(page)`；`openInstance({ headless: false })` 已默认打开全屏。
- 判定函数是纯函数 `judgeFullscreen(measurement, tolerance)`，门禁 `tests/verify-real-machine-fullscreen.ts` 用构造出来的测量数守住口径。

## 三款窗口尺寸：全屏宽 / 窄窗 / 宽矮窗

2026-10-29 定版：真机验证只跑这三款窗口形态，其它分辨率不再单测。三款各压一类布局分支，定义在 `lib/presets.mts` 的 `VIEWPORT_PRESETS`：

| 编号 | 窗口 | 本机实测（2195×1235 屏幕、设备像素比 1.75） | 压的是哪一支 |
| --- | --- | --- | --- |
| `wide` | 真全屏 | 页面视口 2195×1235、面板约 988 像素、无窄态 | 宽布局 |
| `narrow` | 外框宽 800、高铺满屏幕 | 页面视口 787×1142、面板约 331 像素、`.dsws-narrow` 生效 | 面板 300–359 的窄态 |
| `short` | 外框宽铺满屏幕、高 600 | 页面视口 2182×507、面板约 988 像素 | 垂直方向（宽而矮） |

用 `applyViewportPreset` 一次完成「设窗口 + 核对分支」：

```js
const opened = await openInstance(instance.tokenUrl, { headless: false, channel: 'chrome' })
const viewport = await applyViewportPreset(opened.page, 'narrow') // 也可传 VIEWPORT_PRESETS[1] 或 presetById('short')
// 分支不对时直接抛中文错误，不会留下一个「看起来是窄窗、其实没进窄态」的窗口
writePageDiagnostics({ ...opened, viewport }, evidenceDir)
```

为什么窄窗是 800 宽而不是直觉上的 720：窗口宽与插件面板宽不是线性的。DSH 宿主在窄窗口会把右侧面板从「右列」切成「整宽覆盖」——外框 720 宽时页面视口 707、面板宽约 707 像素、`.dsws-narrow` 反而不在场；外框 800 宽时视口 787、面板约 331 像素、窄态生效。2026-10-29 的实测数据在批次证据 `beta32-batch3/s1653/evidence-mapping/mapping-window.json`。

三条硬规矩：

- 不要用 `setViewportSize` 改页面视口来假装窗口尺寸；要改就改真实窗口（`applyViewportPreset` 内部用 CDP `Browser.setWindowBounds`）。
- 调预设前先把 MattSkillsDeck 面板打开：要核对 `.dsws-narrow` 与面板宽，页面里得先有 `.dsws-body`，没有就直接报错（只想设窗口时传 `requirePanel: false`）。
- 空间类结论的证据里要有 `page-diagnostics.json` 的 `viewport` 字段（含实测面板宽与窄态），只贴截图不算。

## 三条常用命令

### 冻结候选包：`freeze-candidate`

一条命令做完全部动作：构建 → `npm pack` → 写逐文件 SHA256 清单 → 装进隔离 home → 起实例核对界面版本串。

```
node --import ./scripts/ts-hook.mts scripts/real-machine/commands/freeze-candidate.mts --ticket 1645
```

产物在 `<工作根>/pkg/`：

- `candidate.json`：候选清单。记着提交、分支、工作树是否干净、包版本、tgz 的字节数与 SHA256、
  包内每个文件的字节数与 SHA256、清单摘要，以及装进隔离 home 和界面核对的结论。
- `dsh-mattpocock-skills-deck-<版本>.tgz`：npm 打出来的候选包。
- `evidence/ui-loaded.png`、`evidence/ui-probe.json`：界面里插件 client 包真的加载出来时的截图与核对数据。

几个要点：

- **工作树不干净时默认拒绝冻结**，因为「同一提交得到同一份清单」的前提是源码没有被静默改动。
  确实要在脏树上冻结时加 `--allow-dirty`，清单会把每个脏文件如实记下来。
- **同一提交重复运行会互相比较**。第二次运行读到同一提交的旧清单时，会比较清单摘要；不一致直接报错并列出
  哪些文件变了。逐字节可比这件事不是口头保证：`npm pack` 会把文件时间规范成固定值，同一份构建产物连续打包
  两次得到同样的字节（2026-10-29 实测）。
- **默认用「解包覆盖」的方式装进隔离 home**，不是跑 `dsh plugin add`。原因很具体：真机 profile 的 pnpm
  记录着安装时用的 store 在哪块盘，把 home 换到另一块盘后 pnpm 拒绝跨盘硬链接（实测报
  `ERR_PNPM_UNEXPECTED_STORE`）。解包法不依赖 pnpm 与网络，任何盘都能用，并且会逐文件核对解出来的内容
  与清单一致。要顺带验证真实安装命令时用 `--install-method cli`，命令会先判断是否同盘，不同盘直接说清原因。
- 只想复现清单、不装界面时加 `--no-ui` 或 `--install-method none`；想复用已有构建产物加 `--skip-build`。

### 双实例冒烟：`two-instance-smoke`

从零跑一次完整的真机验证流程，用来证明这套工具在一个从没跑过真机验证的检出里也能用：

```
node --import ./scripts/ts-hook.mts scripts/real-machine/commands/two-instance-smoke.mts
```

它按顺序做这些事，任何一步失败都会在最后汇总里列出：

1. 从真实 DSH home（或 `--template` 指定的候选 home 模板）复制两份隔离 home。
2. 造两种后端的工作区：一份 GitHub 后端（源仓库某个提交的 `git worktree`），一份 Markdown 后端
   （长名字夹具 + 子票）。工作区放在批次目录下，不带进仓库。
3. 把工作区登记进各自的 home（无头环境点不了原生目录选择器，所以直接写 `storages/workspace.json`）。
4. 跑隔离探针，确认 `USERPROFILE` 重定向生效、真实设置文件哈希没变。
5. 起两个实例（各自端口 0、各自启动目录），用同一个浏览器的两个独立上下文分别打开，核对工作区菜单、
   会话 cwd、页面无脚本异常、插件日志可读，并各截一张图。
6. 收证据、停实例（失败也停）。

产物在 `<工作根>/batches/smoke-<时间戳>/`：`evidence/evidence.json` 是带每个文件 SHA256 的清单，
`smoke-summary.json` 是汇总。注意 GitHub 工作区是源仓库的 `git worktree`；批次目录删掉之后，
在源仓库跑一次 `git worktree prune` 清掉失效登记。

### 清理批次产物：`cleanup`

```
# 先只报账，不删任何东西
node --import ./scripts/ts-hook.mts scripts/real-machine/commands/cleanup.mts

# 看清了再删
node --import ./scripts/ts-hook.mts scripts/real-machine/commands/cleanup.mts --yes
```

它先列出每个批次、隔离 home、临时目录的文件数、字节数与最后修改时间，然后按保留规则标记要删的目录；
不加 `--yes` 只报账。默认保留最近 2 个批次、不保留隔离 home（复制一份只要一两秒，留着没意义）、
候选包目录只报账不删（发布核对要用）。

**建议的上限与时机**写在 [docs/agents/real-machine-verification.md](../../docs/agents/real-machine-verification.md)
的「工具与环境」一节：工作根总量不超过 15GB、批次目录不超过 20 个、单个批次不超过 2GB；
每次批次结束、发布前、换版本重跑之前各清一次。2026-10 有过一次 4.3GB / 4.9 万文件的堆积，
就是因为没有这条命令、也没人记着清。

## GitLab 沙箱项目

GitLab 后端的验证需要一个真的 gitlab.com 项目，手工建删既慢又容易留下垃圾，所以用 `gitlab-sandbox` 管项目生命周期：

- 建项目：`node --import ./scripts/ts-hook.mts scripts/real-machine/commands/gitlab-sandbox.mts create --batch <批次目录> --path <group>/<project> [--description <补充描述>]`。它用 `glab repo create --private --skipGitInit --readme` 建一个空项目，然后按项目路径读回 `id`、`path_with_namespace`、`web_url`，写进 `<批次目录>/gitlab-projects.json`；项目描述里带批次标记 `[dsh-sandbox batch=<批次名>]`。同一个路径重复执行会复用清单里的项目（按 id 读回），不会重复建。
- 删项目：`node --import ./scripts/ts-hook.mts scripts/real-machine/commands/gitlab-sandbox.mts delete --batch <批次目录> --id <项目 id>`。它只删批次清单里记过、且项目描述仍带本批次标记的项目；清单里没有这条记录或没有批次标记时直接拒绝。GitLab 对删除只回 202 并延迟标记，所以命令会按 id 读回 `marked_for_deletion_at`，读到才算删成功；读回失败时把项目 id 保留在清单里、状态标成 `delete-failed` 并明确报错，再跑一次 delete 可以补完。
- 建完项目用 `make-workspace --kind gitlab --project <group>/<project>` 生成工作区：本地 `git init`，`origin` 指向 `https://gitlab.com/<group>/<project>.git`，工作区文件写 `backendId: gitlab`，不 clone、不联网。
- 命令依赖本机已登录 gitlab.com 的 `glab`。门禁不联网，用假 glab 与本地空仓库覆盖，所以门禁绿只说明逻辑对，真机还要跑一遍。每批只建 1-2 个沙箱项目，场景验完立刻删，避免 pending-deletion 配额被占满。

### 种子票池：`seed-gitlab`

真机验证要一个形状固定、能反复重建的票池（默认 101 张票、两张地图与子票、标签、指派、父子与阻塞关系），手工点太慢也容易漏，所以用 `seed-gitlab` 幂等地种：

```
node --import ./scripts/ts-hook.mts scripts/real-machine/commands/seed-gitlab.mts --batch <批次目录> --project <group>/<project>
```

- 目标项目必须已经存在（先 `gitlab-sandbox create`，或用批次里已有的项目）；这条命令只种票与关系，不建项目。
- 每张票正文文件头都写稳定键 `<!-- DSH-SEED-KEY: seed-issue-007 -->`，子票另带 `<!-- DSH-PARENT: <地图 iid> -->`。重跑先按 `state=all` 读回整池票，按稳定键认回已有的，只补缺的；种好后 `<批次目录>/gitlab-seed.json` 的 `mode` 是 `read-only`，之后要补种（远端少了票或被改坏）必须显式加 `--unlock-readonly`，补完自动恢复只读。
- 阻塞关系优先写原生 `is_blocked_by` 边；免费档拿不到原生能力时自动回落成正文成对两行：人读 `Blocked by: #N`、程序读 `<!-- DSH-BLOCKED-BY: N -->`。
- 部分失败时退出码 1，stdout 仍打一份 JSON 回执，`errors` 里指到第几张票、哪个稳定键、试了几次；manifest 已落盘，重跑只补那几项。
- 规模可以用 `--ticket-count` / `--closed` / `--maps` / `--children` / `--blocking` 调，默认 101/5/2/5/8；同一个批次目录只按第一次的规模补种。

### 直调 deck 写工具：`deck-write` 与 `deck-readback`

规格 #1703 阶段 0 要证明「隔离实例里能直调 deck 写工具、回执是无损 JSON、再用 glab 独立读回」。首选路线是在已开实例的页面上下文里走宿主代执行通道（`wf.deckExec`），但那需要真实例与 Playwright，进程外直接 POST `/api/dsws` 实测回 401；所以工具台先提供备选路线的两条命令：

```
node --import ./scripts/ts-hook.mts scripts/real-machine/commands/deck-write.mts --tool <工具名> --args <入参 JSON 文件> --ref <group>/<project> --workspace <工作区目录> [--out <回执文件>]
node --import ./scripts/ts-hook.mts scripts/real-machine/commands/deck-readback.mts --ref <group>/<project> --key <票号> [--out <读回文件>]
```

- `deck-write` 固定 GitLab 后端，按 `--args` 文件里的 JSON 调一次 `deck_issue_create` / `deck_issue_patch` / `deck_map_link`，把工具回执原样写成 JSON（stdout 一份，`--out` 一份，缺省是当前目录的 `tool-response.json`）。回执必须无损：JSON 表达不了的值（NaN、Infinity、函数、Symbol）直接报错，不悄悄变成 null；对象里值为 `undefined` 的键显式剥掉，剥掉后必须能往返等值。
- 退出码分四档：0 成功；1 工具自己回了失败（回执里 status 不是 ok）；2 参数或入口错（工具名不在可直调清单、入参文件读不了、缺 `--tool`）；3 环境不齐（缺 `GLAB_BIN`、`GLAB_BIN` 指向的文件不存在、工作区不存在、仓库标识不是 `<group>/<project>`）；4 内部装配错。缺 `GLAB_BIN` 时不会去 PATH 上找 glab，所以「没装」不会被误判成「装好了」。
- `deck-readback` 不经过 deck 装配，直接用 `glab api` 读 `projects/<编码后的 group%2Fproject>/issues/<票号>?with_labels_details=true`，输出票号、标题、正文、状态、标签名、父票号（读正文里的 `<!-- DSH-PARENT: n -->`）、web 地址与原始响应。写命令与读命令是两条独立路径，读回一致才有证据力。
- 门禁 `tests/verify-1709-deck-entry.ts` 只起子进程：入口与夹具存在、三条写场景（建票 / 评论 / 挂父票）各直调一次并核对回执与假 glab 的调用记录、`deck-readback` 独立读回、七条拒绝路径逐条单独触发且一次 glab 都不调、回执无损单测、`--negative` 自证会红。门禁不联网、不需要真 glab、不碰真实凭据；真机上写成功与否由 B0 批次取证。

### 批次前置巡检：`preflight`

每批开始前先跑一次前置巡检，一条命令把「这批环境到底能不能开始」核对完：

```
node --import ./scripts/ts-hook.mts scripts/real-machine/commands/preflight.mts --batch <批次目录>
```

- 九项硬检查：候选包身份（candidate.json 的提交与 tgz SHA256）、隔离 home 与 profile（已装插件版本是否等于候选版本）、工作区文件与 git remote（backendId: gitlab、origin 是否指向本批项目）、glab 版本与认证（GLAB_BIN 指到哪个 glab、登录的是哪个 gitlab.com 账号）、沙箱项目 id 与状态（按 id 用 glab api 读回，确认没被标记删除）、票池数量（默认至少 101 张，能用 issues_statistics 独立读回时一并记下）、日志目录可写（真写一个探针文件再删掉）、屏幕分辨率与主屏（预检自己跑屏幕命令，不靠人抄）、Node 版本（默认要求 24.15.0 及以上）。
- stdout 只有一段 JSON，同一段也写进 `<批次目录>/preflight.json`（`--out` 可改位置）；批次开始评论直接抄这段 JSON 的相关字段，包括屏幕分辨率与主屏。
- 每项都有稳定 id、中文名、是否硬项、ok、失败原因（写明期望与实际差在哪）与可复核的 details。全部通过时退出码 0；任一硬项失败退出码非 0，stderr 还会用一行汇总点到失败项的 id 与中文名。
- 屏幕信息默认用本机 powershell 取；要换命令用 `--screen-cmd` 或环境变量 `DSH_PREFLIGHT_SCREEN_CMD`（门禁就是用假命令替换的，不依赖本机显示器）。
- 只读：不访问网络（glab 由 GLAB_BIN 注入）、不写真实 DSH 配置，日志目录探针写完立刻删。

## 带 GitLab 环境起实例：`--instance-env-file` 与 `--launch-plan`

隔离实例默认读不到本机的 glab 配置，也没有 GitLab token。要让它按批次环境访问 GitLab，把要传的变量写进一个环境文件，再用 `--instance-env-file` 把文件路径交给 `start-instance`：

```
GLAB_CONFIG_DIR=D:\...\batch-a\glab-config
PATH=C:\Program Files\Git\cmd;C:\Program Files\nodejs
GITLAB_TOKEN=<本批使用的 token>
```

- 只认 `GLAB_CONFIG_DIR`、`PATH`、`GITLAB_TOKEN` 三个变量名；前两个必需，`GITLAB_TOKEN` 可选：这一批不需要访问 GitLab 时可以整行不写，或写成空值表示这次不注入 token。
- 值只合并进实例进程的环境，不会出现在命令行参数、`instance.json`、实例的 stdout/stderr 与插件日志里。命令只在 stderr 报一句「环境文件：<路径>；注入变量：GLAB_CONFIG_DIR、PATH、GITLAB_TOKEN（值不输出）」。
- 参数名是 `--instance-env-file` 而不是 `--env-file`：Node 自己有 `--env-file` 选项，会把后面的值当成 Node 自己的环境文件读，命令根本收不到这个参数。
- 文件不存在、缺少 `GLAB_CONFIG_DIR` 或 `PATH`、写了不认识的变量名、某行不是 `KEY=VALUE` 时，命令以退出码 1 失败，并在 stderr 用中文说清第几行、哪个变量名；错误信息不回显整行原文（那行可能正好写着 token）。

只想看会怎么启动、还不想真起进程时加 `--launch-plan`：

```
node --import ./scripts/ts-hook.mts scripts/real-machine/commands/start-instance.mts --home <批次home> --dir <启动目录> --instance-env-file <批次>/env.txt --launch-plan
```

计划模式只打印一段 JSON：启动命令、启动目录、环境变量名与各类日志落点；不检查 DSH 程序能不能起、不创建目录、不起进程。计划里没有任何变量值，可以直接贴进批次记录或证据文件。

## 全部命令

启动类：

| 命令 | 做什么 |
| --- | --- |
| `copy-home` | 把真实 web profile（或候选 home 模板）安静复制成批次专属 `DSH_HOME`，不打印文件名与文件内容 |
| `seed-workspace` | 把工作区登记写进 home 的 `storages/workspace.json`，绕过无头环境点不了原生目录选择器的问题 |
| `start-instance` | 在独立启动目录起一个实例，把 pid、端口、访问地址、日志位置写成 `instance.json`；支持 `--instance-env-file <环境文件>` 把 GLAB_CONFIG_DIR、PATH、GITLAB_TOKEN 传进实例进程，`--launch-plan` 只打印启动命令与变量名、不起进程 |
| `stop-instance` | 按 pid 结束实例整棵进程树，等它真的消失 |

造工作区：

| 命令 | 做什么 |
| --- | --- |
| `make-workspace --kind github` | 源仓库某个提交的 `git worktree`，写 GitHub 后端绑定 |
| `make-workspace --kind markdown` | 长名字 `.scratch/<effort>/` 夹具，含地图与子票，写 Markdown 后端绑定 |
| `make-workspace --kind cold` | 空目录（可选初始化成一个只有初始提交的本地仓库），验证离线首次启动 |
| `make-workspace --kind ab` | 形状相同、内容不同的 A/B 两个工作区 |
| `make-workspace --kind gitlab` | 本地空仓库加 `origin` 指向 GitLab 沙箱项目，写 GitLab 后端绑定（不 clone、不联网） |

GitLab 沙箱项目（建删细节见上面的「GitLab 沙箱项目」一节）：

| 命令 | 做什么 |
| --- | --- |
| `gitlab-sandbox create` | 在 gitlab.com 建带批次标记的私有空项目，读回 id、path、web_url 写进批次清单 |
| `gitlab-sandbox delete` | 只删批次清单里记过、仍带本批次标记的项目，读回 marked_for_deletion_at 才算删掉 |
| `seed-gitlab` | 把 101 张票、两张地图与子票、标签、指派、父子与阻塞关系幂等种进 GitLab 沙箱项目，写批次 manifest，重跑只补缺项 |
| `deck-write` | 按固定入参直调一次 deck 写工具（建票/改票/挂边），回执写成无损 JSON，退出码区分成功与各类失败 |
| `deck-readback` | 不经过 deck 装配，直接用 `glab api` 读回一张 GitLab 票，用来独立核对 `deck-write` 的回执 |

核对与证据：

| 命令 | 做什么 |
| --- | --- |
| `browser-check` | 打开实例做一组界面断言（工作区菜单、会话 cwd、按钮在视口内且没被盖住、弹窗已关、无脚本异常）并截图 |
| `log-query` | 按事件名、级别、字段过滤插件日志，可以断言「至少出现 N 次」 |
| `collect-evidence` | 把文件、检查结论、汇总写进批次证据包，生成带 SHA256 的 `evidence.json` |
| `isolation-probe` | 证明 `USERPROFILE` 重定向生效、真实用户设置文件未被写入 |
| `backup-settings` / `restore-settings` | 备份与恢复真实用户设置（需要临时改真实设置做对照时才用） |
| `global-lock` | 多人同时做真机验证时的互斥锁：拿锁、放锁 |
| `report-index` | 汇总全局 index.jsonl 与 conditions.jsonl，输出断言分组计数、缺陷等级、候选通过率、条件账本，并可渲染 Markdown 摘要 |
| `preflight` | 批次开始前一条命令输出九项环境预检 JSON（候选身份、隔离 home、工作区、glab 认证、沙箱项目、票池、日志目录、屏幕、Node），任一硬项失败退出码非 0 |

冻结与清理：

| 命令 | 做什么 |
| --- | --- |
| `freeze-candidate` | 构建 + 打包 + 逐文件清单 + 装隔离 home + 核对界面版本串 |
| `two-instance-smoke` | 从零跑一次双实例冒烟 |
| `cleanup` | 先报占用与文件数，确认后删批次产物 |

每个命令文件的开头注释都写了完整参数与输出字段；`--help` 不是这条工具的支持方式，看注释即可。

## 报告索引：`report-index`

批次归档后，`evidence-archive/index.jsonl`（一行一次尝试）与 `conditions.jsonl`（一行一个条件）需要按统一口径汇总，`report-index` 就是这件事：读这两个文件，在 stdout 打印一段 JSON，可选把 Markdown 摘要写到文件。

```
node --import ./scripts/ts-hook.mts scripts/real-machine/commands/report-index.mts \
  [--index <index.jsonl>] [--conditions <conditions.jsonl>] \
  [--defects <清单.json>] [--markdown-out <摘要.md>]
```

- `--index`：全局索引，默认 `<工作根>/evidence-archive/index.jsonl`。
- `--conditions`：条件账本，默认与 index 同目录的 `conditions.jsonl`；默认位置不存在时按 0 条处理，显式传了却不存在则报错。
- `--defects`：缺陷等级清单，JSON 数组，形如 `[{"ticket":"#2001","level":"P1"}]`。`index.jsonl` 里只有缺陷票号没有等级，所以不给清单时按该行场景在 #1675 里的最高 P 级上限推定；需要精确等级就传清单。
- `--markdown-out`：把 Markdown 摘要写到指定路径；不传就只打印。

输出字段：`totals`（行数、尝试数、未测数、结论分布）、`assertions`（8 条支持度断言的分组计数与支持率）、`unmappedScenarios`（映射表里没有的场景号，只提示不报错）、`candidates`（每个候选的通过率与未测数）、`defects`（P0/P1/P2 缺陷票与重验状态）、`conditions`（条件条数）、`markdown`。两点口径：一个场景可以支撑多条断言，所以断言次数相加会大于行数；有效通过率的分母会扣掉「环境限制」和「测试或工具问题」这些不算产品问题的行。

输入不合法时不出汇总，退出码 1，stderr 用一句中文指出问题与行号：非法 verdict、缺字段、重复行（同一批次 + 场景 + 尝试号）、candidate 不是完整 40 位提交哈希、场景号形状不对、非产品缺陷行带了缺陷票、条件缺字段等。

样例输入与期望快照在 `tests/fixtures/report-index/`，黑盒门禁是 `tests/verify-1711-report-index.ts`（加 `--negative` 可单独触发负例）。

## 隔离是怎么做到的

四个层次，缺一层就会串味：

1. **各自 `DSH_HOME`**：每个实例一个复制出来的 home，插件安装与 profile 依赖互不影响。
   复制来源是真实 home 的 `profiles/<名字>`，或冻结时做好的候选 home 模板。
2. **各自启动目录**：实例的工作目录、stdout/stderr、`instance.json`、插件日志都在这里。
   插件日志落在 `<启动目录>/.dsh-mattskillsdeck-cache/logs/<日期>.log`。
3. **各自 `USERPROFILE`/`HOME`**：指到 `<启动目录>/userprofile`。插件把设置写在
   `<USERPROFILE>/.dsh/mattskillsdeck/settings.yaml`，这样两个实例的设置不会互相覆盖，也碰不到真实用户设置。
4. **各自浏览器上下文**：同一个 Chromium 里每个实例一个新 `BrowserContext`，cookie 与 localStorage 不共享。

端口统一用 `--port 0` 让系统分配，所以两个实例不会抢同一个端口。

## 候选身份怎么判

界面里的版本串、安装目录里的 `lib/client.js` 哈希、只有这一版才有的行为，三者一起才是身份。
**不要拿合并后的包哈希当身份**：带启动期构建标识的产物每次启动哈希都会变。`candidate.json` 里记的
逐文件哈希是「源码构建出来的内容」，用来回答「装进去的是不是这次冻结的包」；界面里真正加载的版本串
由 `freeze-candidate` 的界面核对回答。

界面核对要注意一个细节：宿主是把多个插件的 `client.js` 合成一次请求发出来的（地址形如
`/plugins/??a/client.js,b/client.js`），取回来的内容比插件自己的 `lib/client.js` 大得多。
所以界面核对比的是「这段加载出来的内容里，我们这一版的版本常量是不是期望值」，外加「内容里确实带了
本插件名」，而不是拿整段内容的哈希去和安装目录比——那个比法只会得到假红。

## 已知限制

- 关首开弹窗靠「开始使用」这几个字（按 Escape，再点 `aria-label="关闭"`）。产品改文案后要同步改
  `lib/browser.mts`。
- 只装无头 Chromium（`chromium_headless_shell`）。要跑有头浏览器时先确认本机浏览器二进制可用。
- 验证用的工作区夹具必须放在仓库外或批次目录里。把夹具放在本仓库里时，插件会把本仓库的 git 根当成
  仓库身份，结论会被污染。
- 跨盘安装限制见上文「冻结候选包」一节；`--install-method cli` 只在 home 与 pnpm store 同盘时能用。
- 复制 home 会连 profile 里旧的 `dsh plugin add` 依赖记录一起复制过来，那是真机 home 的原样；
  工具只保证不打印文件内容、不写真实 home。
- `global-lock --release` 只释放 `owner.json` 里记的那个进程拿的锁；换一个进程去释放会回
  `{"released": false}`，reason 里写清锁的 owner 是哪个 pid，锁目录也不删。这是现有行为，不是门禁
  夹具引入的：要清掉锁就删锁目录，或让拿锁的那个进程自己释放。

## 相关文件

- 规则与批次记录格式：[docs/agents/real-machine-verification.md](../../docs/agents/real-machine-verification.md)
- 清单票模板：[docs/agents/checklist-issue-template.md](../../docs/agents/checklist-issue-template.md)
- 发布前 / 发布后机器检查：`scripts/release-preflight.mts`、`scripts/release-postflight.mts`
- 门禁用的进程级夹具：`tests/lib/real-machine-process.ts`；假 `glab`、隔离探针等夹具脚本在 `tests/fixtures/real-machine/`。
