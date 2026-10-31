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

## 常用命令

### 冻结候选包：`freeze-candidate`

一条命令做完全部动作：构建 → `npm pack` → 写逐文件 SHA256 清单 → 装进隔离 home → 起实例核对界面版本串。

```
node --import ./scripts/ts-hook.mts scripts/real-machine/commands/freeze-candidate.mts --ticket 1645
```

产物在 `<工作根>/pkg/`：

- `candidate.json`：候选清单。记着提交、分支、工作树是否干净、包版本、tgz 的字节数与 SHA256、
  包内每个文件的字节数与 SHA256、清单摘要，以及装进隔离 home 和界面核对的结论。
  另外还记着 `validity`、`sourceStable`、`package.buildCommit` 与 `package.fileDigest`，含义见下面「批次准备与收尾」一节。
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

### 批次准备与收尾：`prepare-batch` / `check-batch`

`prepare-batch` 把「用当前 HEAD 重新冻结候选 → 构建 → 打包 → 装隔离 home → 起实例 → 前置巡检」收成一条命令：

```
node --import ./scripts/ts-hook.mts scripts/real-machine/commands/prepare-batch.mts --name <批次名> --ticket <票号>
```

参数：`--batch <批次目录>` 直接指定批次目录；`--name <批次名>` 指定批次名，默认批次目录是 `<工作根>/batches/<批次名>`；`--ticket <票号>` 记下这批属于哪张票；`--allow-dirty` 允许在脏树上准备（这样冻结出来的候选 `validity` 是 `development`，只能算开发验证）；`--install-method extract|cli` 选安装方式；`--no-start` 只准备、不起实例；`--no-ui` 跳过界面版本串核对；`--timeout <毫秒>` 给构建与打包设上限。批次目录里已经存在 `batch.json` 的同名批次会被拒绝复用，免得把旧批次的产物当成新批次。

批次目录里的东西：

- `pkg/candidate.json` 与 `pkg/dsh-mattpocock-skills-deck-<版本>.tgz`：候选清单与候选包。
- `home/`：装好候选的隔离 home。
- `run/`：实例启动目录，`instance.json` 与插件日志都在这里。
- `batch-preflight.json`：前置巡检的结论。
- `batch.json`：这一批的机器可读记录，字段见下。
- `evidence/`：场景证据。

`batch.json` 记 `schemaVersion`、`batchName`、`batchDir`、`createdAt`、`updatedAt`、`status`（`active` / `stale`）、`startHead`、`startBranch`、`endHead`、`endCheckedAt`，以及 `candidate`（`path`、`sha256`、`commit`、`version`、`validity`、`tgzPath`、`tgzSha256`、`manifestDigest`、`fileDigest`）、`preflight`、`instance`。

`candidate.json` 在原来「提交、版本、tgz 与逐文件 SHA256」之外新增四个字段：`validity`（`release` = 干净树冻结、可用于发布；`development` = 带 `--allow-dirty` 的开发验证）、`sourceStable`（冻结前后 HEAD 与未提交文件集合是否一致，构建期间源码被改动会在这里露馅）、`package.buildCommit`（构建产物里的提交）、`package.fileDigest`（不含提交与版本的逐文件清单指纹，与 `scripts/release-integrity.mts` 的 digest 同一算法，用来和发布字节对账）。

批次结束时用 `check-batch` 收尾：

```
node --import ./scripts/ts-hook.mts scripts/real-machine/commands/check-batch.mts --batch <批次目录>
```

它读 `batch.json`，把当前 git HEAD 与候选提交比一次：不同就把 `status` 改成 `stale`、写 `endHead` 与 `endCheckedAt`，并提示这条批次不能用于发布收口（原件不删）；相同就只记 `endCheckedAt`，`status` 保持 `active`。

批次开始评论与每条场景结果评论都要带同一行验证身份，精确格式是：

```
- 验证身份：批次 <批次名>；候选提交 <40位小写提交>；候选包 sha256 <64位小写tgz哈希>
```

发布前检查靠这一行把评论与 `batch.json` 对上；格式不对或身份对不上的结果不算通过。

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

## 全部命令

启动类：

| 命令 | 做什么 |
| --- | --- |
| `copy-home` | 把真实 web profile（或候选 home 模板）安静复制成批次专属 `DSH_HOME`，不打印文件名与文件内容 |
| `seed-workspace` | 把工作区登记写进 home 的 `storages/workspace.json`，绕过无头环境点不了原生目录选择器的问题 |
| `start-instance` | 在独立启动目录起一个实例，把 pid、端口、访问地址、日志位置写成 `instance.json` |
| `stop-instance` | 按 pid 结束实例整棵进程树，等它真的消失 |

造工作区：

| 命令 | 做什么 |
| --- | --- |
| `make-workspace --kind github` | 源仓库某个提交的 `git worktree`，写 GitHub 后端绑定 |
| `make-workspace --kind markdown` | 长名字 `.scratch/<effort>/` 夹具，含地图与子票，写 Markdown 后端绑定 |
| `make-workspace --kind cold` | 空目录（可选初始化成一个只有初始提交的本地仓库），验证离线首次启动 |
| `make-workspace --kind ab` | 形状相同、内容不同的 A/B 两个工作区 |

核对与证据：

| 命令 | 做什么 |
| --- | --- |
| `browser-check` | 打开实例做一组界面断言（工作区菜单、会话 cwd、按钮在视口内且没被盖住、弹窗已关、无脚本异常）并截图 |
| `log-query` | 按事件名、级别、字段过滤插件日志，可以断言「至少出现 N 次」 |
| `collect-evidence` | 把文件、检查结论、汇总写进批次证据包，生成带 SHA256 的 `evidence.json` |
| `isolation-probe` | 证明 `USERPROFILE` 重定向生效、真实用户设置文件未被写入 |
| `backup-settings` / `restore-settings` | 备份与恢复真实用户设置（需要临时改真实设置做对照时才用） |
| `global-lock` | 多人同时做真机验证时的互斥锁：拿锁、放锁 |

冻结、批次与清理：

| 命令 | 做什么 |
| --- | --- |
| `freeze-candidate` | 构建 + 打包 + 逐文件清单 + 装隔离 home + 核对界面版本串 |
| `prepare-batch` | 用当前 HEAD 重新冻结候选，构建、打包、装隔离 home、起实例、前置巡检，一条命令完成 |
| `check-batch` | 批次结束时比较当前 HEAD 与候选提交，HEAD 前进就把批次标成 `stale` |
| `two-instance-smoke` | 从零跑一次双实例冒烟 |
| `cleanup` | 先报占用与文件数，确认后删批次产物 |

每个命令文件的开头注释都写了完整参数与输出字段；`--help` 不是这条工具的支持方式，看注释即可。

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

批次评论里那行「验证身份」、`candidate.json` 的 `package.fileDigest` 与 `batch.json` 的 `candidate.fileDigest` 是同一套身份在票面与文件里的写法：票面那行供发布前检查把评论和批次记录对上，两个 `fileDigest` 供 `publish-token.ps1 -Candidate` 把候选包和真正要发布的字节对上。

## 已知限制

- 关首开弹窗靠「开始使用」这几个字（按 Escape，再点 `aria-label="关闭"`）。产品改文案后要同步改
  `lib/browser.mts`。
- 只装无头 Chromium（`chromium_headless_shell`）。要跑有头浏览器时先确认本机浏览器二进制可用。
- 验证用的工作区夹具必须放在仓库外或批次目录里。把夹具放在本仓库里时，插件会把本仓库的 git 根当成
  仓库身份，结论会被污染。
- 跨盘安装限制见上文「冻结候选包」一节；`--install-method cli` 只在 home 与 pnpm store 同盘时能用。
- 复制 home 会连 profile 里旧的 `dsh plugin add` 依赖记录一起复制过来，那是真机 home 的原样；
  工具只保证不打印文件内容、不写真实 home。

## 相关文件

- 规则与批次记录格式：[docs/agents/real-machine-verification.md](../../docs/agents/real-machine-verification.md)
- 清单票模板：[docs/agents/checklist-issue-template.md](../../docs/agents/checklist-issue-template.md)
- 发布前 / 发布后机器检查：`scripts/release-preflight.mts`、`scripts/release-postflight.mts`
