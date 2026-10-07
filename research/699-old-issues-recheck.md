# 研究：地图 699 下面的老问题在当前主干是否还存在（427 / 428 / 429 复核）

调查范围是地图 [699](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/699) 下面的三张老问题票：[427](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/427)（新电脑已装 gh 仍报找不到命令）、[428](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/428)（仓库已就绪仍显示未识别仓库）、[429](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/429)（上面两起现象是否解决的待定票）。[702](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/702) 是 699 建图之后派生的新讨论，不是当初的老问题，这里只在边界处提一句，不计入存废结论。

老票基于 v1.7.10（427 与 428 的正文里写明了实测版本与版本对照）；本次复核的代码是当前主干 v1.7.46（`package/package.json:3` 写着 `"version": "1.7.46"`）。

**一句话结论：427 的 A 项（gh 假阴性）还存在，代码里的根因一处没动，只多了一次同环境的兜底探测；427 的 B 项（技能随包可用）已经不存在，当初的疑问被后面的版本解决了；427 的 C 项（git 与 pnpm 是否进检查链、登录指引是否换形态）还存在，都没有进检查链；428 的三级解析结构还存在，失败仍然静默，只是面板上挂哪块卡片搬过家；429 的待定还挂着，维护者还没有拍板。**

下面每节一条结论，每条结论后面跟一手来源。只交事实与边界，不写产品结论。

---

## 1 版本事实：从 v1.7.10 到 v1.7.46，这两处根因没有被修过

老票自己已经核对过一次：v1.7.10 到当时的主干没有任何针对环境检测与仓库识别的修复提交，所以 1.7.12 大概率仍可复现（427 的备注节、428 的版本与分流说明节、429 的备注节都写了同一句话）。

本次把这句话续到 v1.7.46：近期 CHANGELOG 的头几节（v1.7.46 初始化后黄条自动消失、v1.7.45 更新包跟到 0.8.0、v1.7.44 更新入口委托更新包并同步随包技能到 v1.3.1、v1.7.43 版本管理新增更新按钮、v1.7.42 提交详情骨架占位）都没有动过 gh 解析与仓库识别。来源是 `CHANGELOG.md` 头部连续五节的改了什么小节，里面没有出现 gh 解析或仓库识别的字样。

---

## 2 427-A（gh 假阴性）：还存在

程序找 gh 的办法还是两段式，没有新增第三段去读系统里的最新值。来源是 `src/host/platform/index.js:111-129`：先试 `spec.resolveExecutable(name)`（第 114 行），命中就直接返回（第 118 行）；只有名字正好是 `gh` 时才读 `DSH_GH_PATH` 并用文件系统校验存在才返回（第 119-127 行），否则返回空（第 128 行）。

三个系统的底座都是直透，没有自己加料。Windows 在 `src/host/platform/win32/index.js:62-65`，别名表里只有 `cmd` 到 `cmd.exe`，gh 不进表，直接调 `subprocess.resolveExecutable`；macOS 在 `src/host/platform/darwin/index.js:45-48`，注释写明找不到时抛错交给通用层转空，平台层不叠加兜底；Linux 在 `src/host/platform/linux/index.js:47-50`，注释写明原来自带的兜底已于 2026-08-29 移除，单一真源在通用层（第 42-45 行）。

环境变量的来源还是进程启动那一刻的快照。通用层在 `src/host/platform/index.js:107` 写着 `envSource = opts.env || process.env`，第 80-89 行的 `buildEnv` 只是只读包装；Windows 适配器在 `src/host/platform/win32/index.js:22-34` 按注入对象、测试挂载、最后 `process.env` 的顺序取；另一条兜底通道 `src/host/platformChannel.js:105` 同样写着 `envSrc = process.env`，第 151 行的 `envView` 也是只读包装。

全仓库搜不到读新鲜环境变量的代码。macOS 适配器在 `src/host/platform/darwin/index.js:8` 明确声明平台层不硬编码 `\/opt\/homebrew\/bin`；登录 shell、用户注册表、新鲜 PATH 这类取法在 `src` 下没有命中（Windows 注册表读数、登录 shell 起新终端打印 PATH、已知目录枚举都没有对应的实现代码）。

`DSH_GH_PATH` 这条兜底还在，但读的是同一份旧快照。拥有点仍在通用层，注释在 `src/host/platform/index.js:108-110`（2026-08-29 统一，三个系统行为一致）；读取点在第 120 行，读的是上面那份 `envSource`；另一条通道在 `src/host/platformChannel.js:135-148`，第 140 行同样读 `envSrc.DSH_GH_PATH` 再做文件校验。调用方都没有重复实现，注释写在 `src/host/tracker/backends/github/client.js` 附近与 `repoKeys` 附近（兜底已下沉，此处不再重复）。

检查链判定 gh 是否安装还是走同一条路。检查目录在 `src/host/tracker/backends/github/checks.js:25-30`，`gh:installed` 就是 `commandExists gh`；原语实现在 `src/host/tracker/predicatePrimitives.js:53-59`，经 `resolveExecutable` 命中算通过、否则算失败；门禁预检在 `src/host/tracker/backends/github/preflight.js:44-53`，第一项同样经 `platform.resolveExecutable('gh')`，拿不到就返回环境类错误。链快照与门禁同源，都受进程快照影响。

唯一的新增是一次同环境的存活探测，不是新鲜环境变量修复。在 `src/host/tracker/backends/github/client.js:99-113`，平台找不到 gh 之后会再经 `ctx.exec('gh', ['--version'])` 探一次（第 107 行），命中就按找到了算（第 108-111 行）。注释在第 102-103 行写明了目的只是绕开子进程解析与终端 PATH 不一致导致的那类建票拉不到的问题；这次探测没有传自定义环境变量也没有起登录 shell，继承的还是宿主进程的环境，所以装完 gh 但进程没重启的那种快照滞后它覆盖不了。

文案搬过家，但根因链没变。修复知识现在在 `src/host/tracker/backends/github/index.js:39-49`，`gh:installed` 的提示还是说没安装并给安装指引与重新检查两个动作；安装指引的那句话在第 136-139 行，是维护者给的原话（用向导帮用户装 gh 并附官方地址）；第 17-18 行与第 133-135 行注释写明这句话是按 716 从共享清单挪回本模块的；第 144-146 行注释写明原来按系统分平台的那段长文已按 664 退役。共享清单在 `src/shared/tracker/guide-steps.js:26` 只留注入哪条提示词的键名，第 66-72 行的 `gh:installed` 步骤仍指向它，第 164-174 行与第 184-194 行确认固定文案已经搬走。所以 427 原文里引用的两段长文名字已经对不上现在的文件，但找不到 gh 就判失败、失败就给安装指引这条路还在。

---

## 3 427-B（技能随包可用）：已经不存在

当初疑问的前提是 v1.7.10 还没有随包机制。427 的版本与分流说明节写明了这一点，并写明该能力在 v1.7.11 落地。

当前随包已经到了 v1.3.1 的 27 个技能。来源是 `package/package.json:8` 的介绍句（安装即自带 v1.3.1 的 27 个技能，无需手动装技能）与 `package/bundled-skills/VERSION:1`（内容就是 `v1.3.1`）。CHANGELOG 的 v1.7.44 一节也记了同步上游 v1.3.1、27 个全覆盖。首开引导链里技能那一步还在（`src/shared/tracker/guide-steps.js:106-114`，三个技能检查共用一条横幅），但含义已经是在随包兜底之后再检查，不是当初缺技能的那种缺口。

---

## 4 427-C（git 与 pnpm 是否进检查链、登录指引是否换形态）：还存在

检查目录还是四项，没有 git 与 pnpm。来源是 `src/host/tracker/backends/github/checks.js:15-48`，四项是远端可解析、命令行工具已安装、已登录、可访问，没有为 git 或 pnpm 单独立项。门禁预检在 `src/host/tracker/backends/github/preflight.js` 也是三项门禁：gh 可执行、登录态、仓库可达，没有检查 git 与 pnpm 是否安装。

登录指引还是文字，没有换成向导代执行。来源是 `src/host/tracker/backends/github/index.js:140-143` 的 `ghAuthLogin`（运行登录命令、去浏览器授权、再确认状态）；装 gh 的那句已经是向导口径（第 136-139 行），但登录这一句没有跟着换。第 170-172 行的错误名里有缺 git 与缺 gh 的说法，但那是建仓向导的错误名，不是环境链里的检查项。

---

## 5 428（三级解析全失败）：结构上还存在

解析还是三层，顺序与失败处理都没变。来源是 `src/host/tracker/backends/github/repo.js:92-154`：第一层用 git 问远端地址再解析（第 98-122 行），第二层直读 `.git\/config` 里的远端地址再解析（第 124-141 行），第三层用 gh 问仓库全名再拆分（第 143-152 行）；三层各自吞错，全挂才返回空（第 153-154 行）。

失败还是静默的，埋点只记层号。来源是同文件第 83-90 行的 `emitRepoTier`，只记第几层、是否成功、耗时；成功时在第 107、117、132、138、150 行各记一行，全挂在第 153 行记第三层失败一行，不记哪一段掉的原因。

工作目录拿不到就回落的写法还在，只是搬过家。当前回落在 `src/host/workspaceCwd.js:6`（入参里还有 `DEFAULT_CWD`）、第 14、41、104、111、309、326 行都是收到工作目录就用收到的、拿不到就用默认值的写法。428 原文引用的旧位置（当时宿主入口里的默认值等于进程启动目录）已经不在原文件，探测编排的搬家注释在 `src/host/detectChain.js:1`（从宿主入口搬出，行为零变化）。

面板上挂哪块卡片搬过家。428 原文引用的是当时面板右上角的警示芯片；当前无仓库红卡的触发改成了从链快照派生，来源是 `src/client/views/NoRepoCard.js:22-24`（判仓库缺位改从链快照的 `gh:remote` 失败派生）。现象名字还在，挂载位置变了，读 428 的复现步骤时要按新的触发条件去对。

---

## 6 429（两起现象是否解决）：还挂着，没有拍板

地图本次读回（`deck_map_snapshot` 读 699：子票 7 张、未关闭 4 张、已关闭 3 张）显示 429 还是开放且指着维护者，702 被 429 阻塞；地图正文的已定事项里没有 429 的结论，雾里还留着决策点 1 就是 429 的那一句（这两起现象到底解不解决、什么时候解决，702 阻塞于它）。来源是 429 的正文待决策点三节与地图 699 的雾的第五段。

---

## 7 还没确定的事

1. 本次是代码静态复核，没有在 v1.7.46 的真机上重跑 427 与 428 的复现步骤（全新电脑、用快捷方式启动、在用户级环境变量补丁生效前启动），真机上是否还是三处红与未识别仓库仍需实测。
2. 四个分叉点的运行时值（宿主进程环境里有没有 `DSH_GH_PATH`、子进程里的 PATH 实际是什么、宿主收到的工作目录是真实目录还是回落值、文件沙箱的可写根实际是什么）都要真机转储才能定，代码只能对应到位置，给不出值。
3. 地图雾里的 winget 提权交互（当场失败还是先弹一个要人按的框）仍只到官方资料，没有真机验过。
4. 本次没有重验 DSH 本体（子进程服务与文件沙箱）的版本变化，子进程清理规则与沙箱根的结论沿用 699 前两份研究的实测（`research/699-gh-self-install.md` 与 `research/699-gh-auth-automation.md`）。

---

## 证据索引

| 用到的内容 | 来源 |
|---|---|
| 地图正文的目的地、已定三票、雾的六段 | 699 正文（本次经 `deck_issue_get` 读回） |
| 地图子票 7 张、未关闭 4 张、702 被 429 阻塞 | 本次经 `deck_map_snapshot` 读 699 的返回 |
| 老问题原文与版本对照 | 427、428、429 正文（本次经 `deck_issue_get` 读回） |
| 程序找 gh 的两段式与快照来源 | `src/host/platform/index.js:107-129`、`src/host/platform/win32/index.js:22-34,62-65`、`src/host/platform/darwin/index.js:8,45-48`、`src/host/platform/linux/index.js:42-50`、`src/host/platformChannel.js:105,135-152` |
| 检查目录四项与门禁三项 | `src/host/tracker/backends/github/checks.js:15-48`、`src/host/tracker/backends/github/preflight.js:44-75` |
| 同环境存活探测 | `src/host/tracker/backends/github/client.js:99-115` |
| 文案搬家（共享清单只留键名、原话挪回后端、旧长文退役） | `src/shared/tracker/guide-steps.js:26,66-72,164-194`、`src/host/tracker/backends/github/index.js:17-18,39-49,133-146,170-172` |
| 随包技能版本 | `package/package.json:3,8`、`package/bundled-skills/VERSION:1`、CHANGELOG v1.7.44 一节 |
| 三级解析与静默失败 | `src/host/tracker/backends/github/repo.js:83-90,92-154` |
| 工作目录回落与编排搬家 | `src/host/workspaceCwd.js:6,14,41,104,111,309,326`、`src/host/detectChain.js:1` |
| 无仓库红卡的新触发 | `src/client/views/NoRepoCard.js:22-24` |
| 前两份研究的实测（子进程环境清理规则、凭据保留、安装通道） | `research/699-gh-self-install.md`、`research/699-gh-auth-automation.md` |
