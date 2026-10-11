# #1012「配置存储统一改造」最终敲定方案核对稿（带出处）

> 调研时间：2026-10-12 04:13 至 04:30（Asia/Shanghai）。
> 代码状态以 **HEAD = d0f14a86**（2026-10-12 04:27 观测）为准。调研期间仓库被别的会话持续提交：开始时 HEAD 是 9924d3f9，结束时是 d0f14a86（中间多了 335bbd20、d0f14a86 两个提交）。所以本文件里凡是「已落地／未落地」的判断，看的时候都要照当时的 HEAD 再复查一次。
> 本文件只写从一手来源读到的东西：GitHub 票 #1012、#1003、#947、#1010 的正文与全部评论，仓库文档（CONTEXT.md、docs/adr/、docs/agents/），仓库代码与门禁。每条结论后面紧跟出处；读不出结论的地方明确写「不确定」，不猜。
> 出处的写法：票面用完整链接；文件用 `路径:行号`；提交用短哈希。

## 0. 一句话结论

维护者 2026-10-11 拍板、2026-10-12 凌晨补答三个问题的最终口径是：三份配置全部改 YAML（工作区后端配置 `docs/agents/workspace.yaml`、工作区标签配色 `docs/agents/label-colors.yaml`、本机全局设置 `<用户主目录>/.dsh/mattskillsdeck/settings.yaml`），读写只有一份实现（新建 TypeScript 核 `config-store-core/`，产物 `src/shared/config-store/`），字段注释由程序生成、与字段定义同一个常量源；老 `.json` 继续读、读到就迁、写成功后删老文件；19 条清单逐条有去向（来源：[#1012 评论 6106488823](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6106488823)、[#1012 评论 6106517592](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6106517592)、[#1012 评论 6113252694](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6113252694)）。

到 HEAD d0f14a86 为止，核、宿主适配器、两条本机设置电话、绑定回执展示、客户端三项观看状态搬迁已经落地并有门禁；清单第 3 条（列表过滤排序）与第 9 条（十一个动作模板）还是老存储；第 10、11 条（`dsws.cfg`、`dsws.startCfg`）没删；第 4 条（标签点击计数）与第 8 条（调试开关真源）在 2026-10-12 凌晨刚被维护者改判，代码还没跟上（依据见第 7 节第 4、5 条）。

---

## 1. 目的地与三个文件

### 1.1 三个文件一览

| 文件 | 新路径（YAML） | 老路径（兼容读） | 版本 | 允许提交进仓库 | 读写实现落在哪 |
| --- | --- | --- | --- | --- | --- |
| 工作区后端配置 | `docs/agents/workspace.yaml` | `docs/agents/workspace.json` | 新文件 2；老 JSON 是 1 | 允许，随仓库走 | 核单元 `config-store-core/src/workspace.ts`（产物 `src/shared/config-store/workspace.js`）+ 宿主适配器 `src/host/configStore.js`；共享层垫片 `src/shared/deck-tools/workspace-file.js` 只做新老名字翻译 |
| 工作区标签配色 | `docs/agents/label-colors.yaml` | `docs/agents/label-colors.json` | 1（老文件没有版本，当 1 读） | 允许（它本来就在工作区里，是数据不是配置） | 核单元 `labels.ts`（产物 `labels.js`）+ 本地 Markdown 后端房间 `src/host/tracker/backends/markdown/label-colors.js` 与同目录 `label-colors-codec.js` |
| 本机全局设置 | `<用户主目录>/.dsh/mattskillsdeck/settings.yaml` | 没有老文件（新建） | 1 | 不随仓库走 | 核单元 `settings.ts`（产物 `settings.js`）+ 宿主适配器 `src/host/configStore.js` + 两条电话 `src/host/settingsPhones.js`；客户端经 `wf.getSettings` / `wf.setSettings` 读写 |

出处：三个路径与「兼容读老 `.json`」写在票面「已定事项」第 1、2、3 条与「已确认的决定」第 1 条（[#1012 正文](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012)）；版本号写在 `config-store-core/src/workspace.ts:24`（`WORKSPACE_KNOWN_VERSION = 2`）、`config-store-core/src/settings.ts:14`（`SETTINGS_KNOWN_VERSION = 1`）、`config-store-core/src/labels.ts:27`（`LABEL_COLORS_KNOWN_VERSION = 1`）；老路径写在 `workspace.ts:21-22`、`labels.ts:24-25`；本机设置相对位置写在 `settings.ts:17`（`SETTINGS_REL_SEGMENTS = ['.dsh', 'mattskillsdeck', 'settings.yaml']`）；三条电话注册在 `src/host/index.js:308-309`。

有一点要如实说明：**本仓库自己到现在还没有这两个工作区文件**。`docs/agents/` 下实测只有 `commit-convention.md`、`domain.md`、`issue-tracker.md`、`triage-labels.md` 四个 Markdown（HEAD d0f14a86 实测），既没有 `workspace.yaml` / `workspace.json`，也没有 `label-colors.yaml` / `label-colors.json`；本机 `%USERPROFILE%\.dsh\mattskillsdeck\` 下实测只有即将退役的 `choices.json`（1269 字节），`settings.yaml` 还没被建出来。这与 #1003 票面「说明（2026-10-11 收尾核对）」那一行的自述一致（[#1003 正文](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1003)）。

### 1.2 兼容读规则、迁移与删老文件的时机

票面原文（「已定事项」第 1 条）：「`docs/agents/workspace.json` 改造成 YAML：新路径 `docs/agents/workspace.yaml`；**继续读**老的 `.json`（读到就迁移；两个同时在时以 `.yaml` 为准并留一条日志；写成功后再删老文件，删除失败只记日志、不影响主流程）」（[#1012 正文](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012)）。第 2 条对标签配色文件写了同一套规则。

代码里的确切行为（`src/host/configStore.js`）：

1. 读的顺序：先读新 `.yaml`；只有「文件确实不在」时才读老 `.json`（`readWithFallback`，`src/host/configStore.js:130-188`）。「确实不在」的判据故意定得窄，只认 `ENOENT` 与 `FS_NOT_FOUND`，权限、被占用、位置被换成目录都不算「没有」，以免用默认内容覆盖用户手写的东西（`isMissingFile`，`src/host/configStore.js:46-51`）。
2. 两个同时在时以 `.yaml` 为准，并在回执的 `warnings` 里带一条 `legacy-present`（原文：「老文件（…）还在，以新文件（…）为准，它是迁移遗留」，`src/host/configStore.js:149`）。
3. 新文件在但读坏、老文件能读时，这一次先用老文件顶着并警告 `yaml-unreadable`（`src/host/configStore.js:152-166`）。
4. 写的顺序：拼文本 → 建上一级目录 → 写新文件 → **读回比对**，读回来的内容与刚写进去的不一致就按环境失败回（`src/host/configStore.js:191-210`）。
5. 删老文件在「写成功且读回一致」之后：删不掉只往 `warnings` 里放一条 `legacy-delete-failed`，不影响主流程（`src/host/configStore.js:211-225`）。

**迁移时机上票面与实现有一个需要人确认的差别（不确定）**：票面说「读到就迁移」。实现里，标签配色那条是在房间的放置函数 `ensureLabelColors` 里做的（读到 `from === 'json'` 且不是高版本就迁进新文件，写成功后删老文件，`src/host/tracker/backends/markdown/label-colors.js:234-264`）；而工作区后端配置那条的**读路径不迁移**，只回报 `from: 'json'`，注释明写「调用方决定何时迁移」（`src/host/configStore.js:230-245`）。也就是说工作区那份老 JSON 会在调用方（属 #1003 的写入口／老用户迁移）下一次写新文件时才消失。这是不是维护者要的效果，票面没有一句话说清，见第 7 节第 9 条。

### 1.3 文件允许提交进仓库的含义

票面原文：「这份文件**允许提交进仓库**，说明里写清『提交了就团队共享，改动会影响所有人』」（[#1012 正文「对齐成果 · 约束与偏好」](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012)）。这句话程序写进了 `workspace.yaml` 文件头的第二行（`config-store-core/src/workspace.ts:33`）。标签配色数据本来就在工作区里；本机 `settings.yaml` 在用户主目录下，不进仓库、不共享。

### 1.4 注释由程序生成：规则与文件头那句话的原文

维护者原话（票面「已定事项」第 5 条逐字引用）：「程序重写时，把我们定好的注释写进去，我们每个字段都有我们定义好的注释，这个是让修改的人看的，而不是让他们修改注释的。」规则因此定为：不需要保留注释的往返库；**写入 = 模板 + 值**，注释与字段定义同一个常量源，永远同步（[#1012 正文](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012)）。实现上，写侧不依赖 YAML 解析库，按模板逐行拼、纯量保守转义，所以注释位置与键顺序永远稳定（`config-store-core/README.md:46-53`）。

文件头那句话的逐字原文是：

```
# 本文件的注释由插件生成；你自己加的注释会在下次写入时被替换。
```

（`config-store-core/src/workspace.ts:32`、`config-store-core/src/settings.ts:19`、`config-store-core/src/labels.ts:29`；两个工作区文件之外，`workspace.yaml` 还多一行文件头，见第 2 节。）

注意标点有两处写法不一致：`#1003` 的「存储层」那一节把它写成「本文件的注释由插件生成**，**你自己加的注释会在下次写入时被替换」（逗号 + 无句号，[#1003 评论 6105121298](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1003#issuecomment-6105121298)）。以骨架与核常量里的那一版为准（分号 + 句号），理由是注释门禁 `tests/verify-config-store-comments.js:34-50` 就是拿这一版做逐字断言。

---

## 2. 两个文件的骨架（逐字抄自定案评论）

两段骨架都摘自「清单定案」评论（[#1012 评论 6106488823](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6106488823)，2026-10-11 07:02:54Z）。评论自己的话是：「两个文件定案后的样子（供实现照抄；注释就是程序要写进去的那些）」。

### 2.1 `docs/agents/workspace.yaml`（随仓库走，允许提交）

```yaml
# 本文件的注释由插件生成；你自己加的注释会在下次写入时被替换。
# 这份文件随仓库走：提交之后就团队共享，改动会影响所有人。
version: 2
# 这条工作区用哪个后端
backendId: github
# 这次选择发生的时间（毫秒）
pickedAt: 1791524461229
# 这条选择是谁做的：user=人在面板里亲手选的；migrated=从老版本机记忆搬来的；detected=插件按声明文件或自动识别生成的
source: user
# 面板布局：single=单栏；multi=多栏
layout: multi
```

### 2.2 本机 `<主目录>/.dsh/mattskillsdeck/settings.yaml`（不随仓库走）

```yaml
# 本文件的注释由插件生成；你自己加的注释会在下次写入时被替换。
version: 1
# 界面偏好（本机全工作区默认生效）
ui:
  # 主列表的状态过滤与排序
  stateFilter: open
  sortKey: updatedAt
  sortDir: desc
  # 标签被点过的次数，用于标签 chip 排序
  labelClicks: {}
# 按工作区区分的观看状态（键 = 工作区根目录）
workspaces:
  D:\dsh-plugin\dsh-mattpocock-skills-deck:
    # 状态栏横幅与胶囊是否收起
    bannerFolded: true
    # 无仓库红卡是否已收起
    noRepoDismissed: true
    # 红文件夹标志的说明浮层是否已自动展开过
    subwsMarkAutoShown: true
# 本地诊断日志开关
debug:
  enabled: false
  sampleRate: 1
# 动作模板（空 = 用默认文本）
templates: {}
```

### 2.3 骨架与实现的关系（门禁钉到什么程度、哪里不一样）

1. `workspace.yaml` 的骨架是**逐字**钉死的：注释门禁把整段文本当期望值做全等断言（`tests/verify-config-store-comments.js:37-50`）。核里的注释常量在 `config-store-core/src/workspace.ts:31-39`。
2. `settings.yaml` 的骨架是按「每个字段前面都有定义的注释」逐条断言的，不钉整段文本（`tests/verify-config-store-comments.js:63-72`）；字段集合与注释常量在 `config-store-core/src/settings.ts:19-33`。
3. 有一处**实现与骨架的字面差别**要说明：`workspaces:` 那一节的键在实现里会过一道纯量转义（`settings.ts:57-74` 的 `esc`，拼装处 `settings.ts:232`）。本机实测（HEAD d0f14a86，用 `stringifyConfig` 拼一份带 Windows 路径键的设置）落盘的那一行是 `  "D:\\a\\b":` 这种形状：键被双引号包起来，键里的每个反斜杠写成两个（YAML 双引号内的转义）。骨架里写的 `D:\dsh-plugin\dsh-mattpocock-skills-deck:` 是不加引号的示意写法。两者语义相同，但字节不同；如果维护者要的是骨架那种写法，得改 `esc` 的保守策略（现状是「拿不准的一律双引号」，见 `config-store-core/README.md:50-51`）。
4. 定案评论里给的取值只是示例（`stateFilter: open`、`sortKey: updatedAt`、`sortDir: desc`、`backendId: github`、`pickedAt: 1791524461229`、`bannerFolded: true` 等）；实现里读时缺节给默认、写时永远写完整模板（`settings.ts:99-181`、`184-254`）。

---

## 3. 19 条清单的最终归属表

最终归属取自「清单定案」评论（[#1012 评论 6106488823](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6106488823)），该评论自己声明「本评论取代前面两条清单评论里的建议，以这里为准」。「现在在哪」一列取自清单原始版（[#1012 评论 6106364491](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6106364491)）。「到 HEAD 的落地情况」是我在 HEAD d0f14a86 上读代码得到的事实，附文件行号。

| # | 项 | 现在在哪 | 最终去向 | 到 HEAD d0f14a86 的落地情况 |
| --- | --- | --- | --- | --- |
| 1 | 后端选择 | localStorage 镜像 `dsws.selectionByCwd` + 宿主记忆 `choices.json` 的 workspaces 表 | `docs/agents/workspace.yaml` | 文件路径与读写已就位（`src/shared/deck-tools/workspace-file.js` 读写成 YAML v2）；选择镜像那一族已由 #1003 退役 |
| 2 | 面板布局 single / multi | `dsws.setupLayoutByCwd` + 本机记忆 layouts 表 | `docs/agents/workspace.yaml` | 已有提交做这件事：`9924d3f9`「面板布局写进工作区文件并从它读回，本机记忆只作老工作区的过渡来源」 |
| 3 | 列表状态过滤 + 排序 | `dsws.listPrefs` | 本机 `settings.yaml` | **未搬**：`src/client/kernel/store-prefs.js:13-22` 仍是 localStorage；#1012 进度自述「本票剩余：列表过滤排序与十一个动作模板的搬迁」（评论 6112678924） |
| 4 | 标签点击计数 | `dsws.labelClicks` | 定案写「本机 `settings.yaml`（也可以不落盘，动手前定一句）」 | **改判不落盘**（2026-10-12 维护者答复）；但代码里两处仍在：`src/client/kernel/store-prefs.js:24-32` 仍持久化 `dsws.labelClicks`，核 schema 仍保留 `labelClicks`（`config-store-core/src/settings.ts:31`、`108-118`、`216-223`）。见第 7 节第 4 条 |
| 5 | 横幅收起（按工作区） | `dsws.bannerFold` | 本机 `settings.yaml`（按工作区分节） | 已落地：读先查文件、查不到回退旧键；写失败才回写旧键（`src/client/kernel/settings-view.js:52-55`、`328-340`；写这一趟在 `src/client/kernel/settings-view-write.js`，随提交 d0f14a86 演进） |
| 6 | 无仓库红卡收起（按工作区） | `dsws:noRepoDismiss:*` | 本机 `settings.yaml`（按工作区分节）；要不要退役等 #1004 | 按设计**不接线**（等 #1004）；客户端仍走旧键 `src/client/views/NoRepoCard.js:25,118`。核 schema 里有这一格且写盘时按默认补上（`settings.ts:32,133,236`） |
| 7 | 红文件夹标志的说明浮层「已自动展开过」 | `dsws.subwsAutoShown` | 本机 `settings.yaml`（按工作区分节） | 已落地（同第 5 条那条路；旧键 `dsws.subwsAutoShown` 按工作区根记，`settings-view.js:52-55`）；并修过一条时序回退（提交 `5eae85f8`） |
| 8 | 调试开关 | `dsws.debug` + 宿主侧 `log-switch.json` | 本机 `settings.yaml`（并与宿主那份 `log-switch.json` 定一份真源） | **真源已改判**（2026-10-12：以 `settings.yaml` 的 debug 节为主）；但客户端仍以 localStorage 为准（`src/client/kernel/log.js:14,28-52`），宿主仍写 `log-switch.json`（`src/host/logStore.js:10,187-209`），`settings.yaml` 的 debug 节目前没有消费方。见第 7 节第 5 条 |
| 9 | 动作模板（11 个） | `dsws.templates` | 本机 `settings.yaml` | **未搬**：仍走 `dsws.templates`（`src/client/kernel/config.js:27-39`；十一个键见 `config.js:32` 与 `71-84`） |
| 10 | `dsws.cfg`（旧配置存档，定案说「今天不读」） | `dsws.cfg` | **删除** | **未落地**：`CFG_KEY = 'dsws.cfg'` 与 `saveCfg()` 仍在（`src/client/kernel/config.js:9-25`）。见第 7 节第 3 条 |
| 11 | `dsws.startCfg`（更早存档，只读一次做迁移） | `dsws.startCfg` | **删除**（连迁移逻辑一起） | **未落地**：`migrateStartCfg()` 仍在（`src/client/kernel/config.js:40-54`） |
| 12 | `dsws.issuePath`（已退役面包屑的遗留键） | 代码里只剩一行 `removeItem` | **删除**（连那行 `removeItem` 一起） | **已落地**：提交 `7840749b`「配色房间切YAML主路径并删issuePath遗留清理行」删掉了 `store-prefs.js` 里那两行（`git show --stat 7840749b` 显示 `src/client/kernel/store-prefs.js | 2 -`） |
| 13 | 窗口身份 | sessionStorage `dsws.windowId` | 保持 sessionStorage | 保持原样（`src/client/kernel/attention-heartbeat.js:26`） |
| 14 | 额度降级横幅「这次会话别再弹」 | sessionStorage `dsws.restFallbackDismissed:*` | 保持 sessionStorage | 保持原样（`src/client/views/shared/RestFallbackBanner.js:23`）；维护者 2026-10-12 再次确认（评论 6113252694） |
| 15 | 运行期缓存（快照、命名、session tickets、deck plans） | `<DSH 进程目录>/.dsh-mattskillsdeck-cache/*` | 保持现状（不是配置） | 未涉及 |
| 16 | 快照缓存 | IndexedDB `dsws-cache` + 内存 LRU | 保持现状 | 未涉及 |
| 17 | 标签配色**数据** | `docs/agents/label-colors.json` | 改 YAML（`docs/agents/label-colors.yaml`），仍在工作区；它是数据不是配置 | 已落地：房间读写切 YAML、老 JSON 兼容读并迁移（提交 `7840749b`；`src/host/tracker/backends/markdown/label-colors.js:36-38,130-168,234-264`） |
| 18 | 技能文档 `issue-tracker.md` / `triage-labels.md` | `docs/agents/*.md` | 保持 Markdown，不动 | 未涉及（`docs/agents/` 实测仍只有那四个 Markdown） |
| 19 | 本机记忆 `choices.json`（workspaces + layouts 两张表） | `<用户主目录>/.dsh/mattskillsdeck/choices.json` | 迁移成功后退役（顺序在 #1003） | 本机文件还在（实测 1269 字节）；#1012 进度写「choices.json 退役等 #1003 通知」（评论 6112291948） |

---

## 4. TS 核的形态与硬要求

### 4.1 目录形态与产物落点

票面要求原文：「**一份逻辑一处实现，且新代码全 TS**：新建一个 TS 核目录，形态与 `label-color-core/`、`refresh-core/`、`version-control-core/` 完全一致（`src/*.ts` + `build.mjs` + `tsconfig.json` + `README.md`，转译产物落到 `src/shared/<核名>/`，由 `scripts/build.mjs` 第 0 步带进来）。核里只放纯函数，三个文件（两个工作区文件 + 全局设置）都由它读写，谁都不许再各写一份解析。」（[#1012 正文「已定事项」第 7 条](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012)）

实际落地（目录 `config-store-core/`，产物 `src/shared/config-store/`）：

- 源码四个单元：`src/ports.ts`（只装类型与模块标识）、`src/workspace.ts`、`src/settings.ts`、`src/labels.ts`（`config-store-core/build.mjs:31-36` 的 `UNITS` 清单就是唯一一份清单，新鲜度门禁直接读它，不手抄）。
- 产物四个：`src/shared/config-store/ports.js`（空壳，只留 `PORTS_SOURCE` 一行模块标识）、`workspace.js`、`settings.js`、`labels.js`（`config-store-core/README.md:66-71`）。四个都提交进 git。
- 产物实测行数（HEAD d0f14a86）：`ports.js` 2 行、`workspace.js` 156 行、`settings.js` 208 行、`labels.js` 159 行，都在文件粒度门禁的 350 行上限之内（`config-store-core/README.md:28-29` 说明为什么拆成三个单元而不是一个单体）。
- 形态依据是仓库既有 ADR：源码放仓库根的独立目录、不进 pnpm workspace、不建 `packages/<名字>/`、不发 npm 包，产物逐文件转译并提交（`docs/adr/20260913-builtin-ts-shape.md` §2.3；`config-store-core/README.md:3-7`）。
- 构建接线：`scripts/build.mjs:74-81` 动态加载核的 `build.mjs`，`scripts/build.mjs:843-848` 在「两段派生之前」调用 `buildAll()`（与版本控制核同一位置、同一理由：产物是客户端闭包与宿主适配器的输入，必须先就位）。`buildAll()` 先判断源码目录与 `tsconfig.json` 在不在，不在就跳过并打印一行提示，不打断整个构建（`config-store-core/build.mjs:113-118`）——发布包与 `package/` 子树里没有这棵源码树，这是预期情况。
- 类型检查配置：`target ES2020`、`lib ES2020`、`module ESNext`、`moduleResolution Bundler`、`noEmit`、`strict`、`types: []`、`skipLibCheck`（`config-store-core/tsconfig.json:1-17`）。
- 产物三条边界条件由门禁钉住：要用的东西都带行首 `export`、零相对引用（互相不 import）、不含 `__DSW_VERSION__` 与 `__DSW_REPO_URL__` 两个占位符（`tests/verify-config-store-freshness.js:61-74`）。
- 转译口径：esbuild 只转译不打包，目标写死 ES2020；把 esbuild 收在文件末尾的 `export { … };` 改写成声明前的行首 export，找不到声明就抛错，绝不静默产出少导出的产物（`config-store-core/build.mjs:50-75, 78-89`）。

### 4.2 纯函数边界与冻结接口

- 核里只有纯函数，不碰文件系统、不碰网络、不打日志：没有跨模块边界的调用、没有缓存、没有定时活、没有读写动作，所以核里一条日志点都不落（`config-store-core/README.md:82-88`，依据 `docs/design/335-logging-contract.md` 第 3 章的判定）。
- 跑腿的活全在宿主适配器 `src/host/configStore.js`：拼路径、读文件、写文件、写完读回比对、写成功后删老文件；它是「调核的唯一入口」（`src/host/configStore.js:1-16`）。
- **文本出入口住在适配器**：`parseConfig(text, schema)` / `stringifyConfig(value, schema)`；超大与别名两道守卫在这里做一次、YAML 解析只见一次；两个上限数字（64K 字、50 个别名）的唯一出处就是这里（`src/host/configStore.js:68-125`；`config-store-core/README.md:30-32`）。核单元另有 `parseWorkspaceText` / `parseLabelsText` 两个文本入口，给不能用裸包引用的调用方（共享层垫片与后端房间），守卫数字与适配器同值、行为一致由门禁钉（`config-store-core/src/workspace.ts:85-123`、`labels.ts:77-115`）。
- **冻结接口**（票面与 #1003 票里那份逐字一致，要改必须同时改两份）：`readWorkspaceConfig(root)` / `writeWorkspaceConfig(root, value)`、`readLocalSettings()` / `writeLocalSettings(value)`、`readLabelColors(root)` / `writeLabelColors(root, value)`（[#1012 正文「接口」一节](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012)、[#1003 正文「接口」一节](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1003)）。实现里六个函数都多带一个文件读写口 `io`（`{ readText, writeText, rm, mkdir }`），由调用方递进来：桌面端走平台文件服务或系统文件直连，测试给假实现（`src/host/configStore.js:13-14, 228-330`）。冻结函数清单由门禁逐个断言（`tests/verify-config-store-package.js:54-59`）。
- 客户端半边不直接调核：客户端经宿主那两条电话读写设置，不拼进闭包（`config-store-core/README.md:79`）。宿主侧用普通相对 import 产物，例如 `import { parseWorkspace } from '../shared/config-store/workspace.js'`（`config-store-core/README.md:71-75`）。
- 同层互引的门禁与一条记名的例外：`src/shared` 内部文件之间不许互相引用，所以共享层的 `workspace-file.js` 保持调核这件事在 `tests/same-layer-baseline.json` 里记名（`src/shared/deck-tools/workspace-file.js:6-7`）。

### 4.3 严格校验清单

票面「交付物」里列的与代码里落到的，逐条如下：

1. **白名单键**：核不认识的名字一律按 `unknown-keys` 拒绝并点名是哪些（读与写都拒），绝不静默丢掉用户手写的键。工作区配置的已知键是 `version`、`backendId`、`pickedAt`、`source`、`layout`（`config-store-core/src/workspace.ts:44, 128-131, 177-180`）；本机设置顶层五节与各节内键都有白名单（`settings.ts:30-33, 83-86, 101-102, 129-132, 146-147`）；标签配色的标签名是动态的，但每个标签的写法只认「直接写颜色」或 `{color, description}` 两种（`labels.ts:31, 146-165`）。
2. **精确类型与 YAML 陷阱**：`version` 必须是整数，`1.10` 被 YAML 读成数字 1.1 → 按坏形状回（门禁用例见 `tests/verify-config-store-core.js:87-88`）；`no`/`on`/`yes` 这类裸词在 core 模式下是字符串而不是布尔，凡是要求布尔的位置（例如 `debug.enabled`、`workspaces.<根>.bannerFolded`）读到字符串就按坏形状回（`settings.ts:136-139, 148-149`；门禁用例 `tests/verify-config-store-core.js:83-86`）；前导零被读成八进制数字，`pickedAt: 0777` 读成 777 照收，因为这一格只要求「非负整数」（门禁用例 `tests/verify-config-store-core.js:89-90`）；`backendId` 必须是非空文字，`"  "` 这种按坏形状回（`workspace.ts:143-144`；门禁用例 `:93-94`）。
3. **文件大小上限**：65536 字（按字符数不按字节），超了回 `oversize` 并拒绝解析，理由写在文案里「配置文件本该很小，超了说明拿错了文件」（`src/host/configStore.js:73-75, 97-99`；核单元同值 `workspace.ts:26-27`、`labels.ts:18-19`）。
4. **别名数量上限**：50 个，超了回 `aliases`；YAML 解析时另钉 `maxAliasCount` 与 `uniqueKeys: true`（重复键拒绝）（`src/host/configStore.js:76-77, 100-108`；`workspace.ts:111`；门禁用例 `tests/verify-config-store-core.js:111-118`）。理由是这份文件允许提交、可能来自别人，要防别名炸弹（[#1012 正文「交付物」](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012)）。
5. **版本高于已知只读不写**：读成功但标 `readonly: true` 并给一条 `version-newer` 警告；写明确拒绝，回执文案里说明「旧版本写回去会把新字段抹掉，请升级插件后再改」（`workspace.ts:134-141, 183-189`；`settings.ts:89-96, 192-198`；`labels.ts:126-133, 188-194`）。宿主那两条设置电话在写之前先读一次，读到只读就直接回升级文案、**不动盘上任何字节**（`src/host/settingsPhones.js:140-155`）。
6. **危险键与形状**：`__proto__` / `constructor` / `prototype` 不能当数据键（标签名、模板名、`labelClicks` 的键），否则读出来会撞原型链（`settings.ts:47-50`、`labels.ts:41-44`；门禁用例 `tests/verify-config-store-core.js:139-140`）。
7. **老格式兼容**：JSON 是 YAML 的子集，老 `.json` 直接可读；工作区老文件是版本 1，`source` 允许第四种取值 `auto`（历史文件里有），但**写出来的一律是版本 2，且版本 2 里不再认 `auto`**（`workspace.ts:23-24, 41-42, 142, 149-157`；门禁用例 `tests/verify-config-store-core.js:123-132`）。标签配色老文件没有版本，当 1 读（`labels.ts:118-135`）。
8. **布局缺席允许**：读（v1 老文件本来就没有）与写（调用方还没拿到值，如迁移与首次绑定）都允许缺，缺了整段省略，绝不编默认值；一旦写进去，覆盖写必须由调用方「读改写」保住（`workspace.ts:13-14, 158-162, 169, 208-211`；门禁用例 `tests/verify-config-store-core.js:37-42`）。
9. **冲突档与失败分档**：解析失败只有五种档位 `oversize` / `aliases` / `yaml-error` / `bad-shape` / `unknown-keys`；拼装失败三种 `version-newer` / `unknown-keys` / `bad-shape`（`config-store-core/src/ports.ts:15-54`）。宿主那两条电话再把内部原因映射成给界面看的四种种类：`absent`（文件不在）/ `environment` / `invalid` / `readonly`，未知原因一律按 `environment`，不让界面猜（`src/host/settingsPhones.js:35-51`）。

### 4.4 读与写为什么不对称

读要包容（老 JSON、手工改过的空白与顺序），写要稳定（同一份值每次写出来逐字一致，注释永远在字段前面）。所以读用 `yaml` 包并钉死 `core` 模式（YAML 1.2 核心规则）与别名上限；写不依赖解析库，按模板逐行拼、纯量保守转义（`config-store-core/README.md:46-53`）。写侧的转义规则：能裸写才裸写（只允许 `^[A-Za-z_][A-Za-z0-9_-]*$` 且不是 `yes/no/y/n/on/off/true/false/null/~` 这些会被读成别的类型的词），拿不准的一律双引号并转义反斜杠、引号、换行、制表与控制字符（`workspace.ts:58-76`，另两个单元各写一遍，理由见 `workspace.ts:8-10`）。

---

## 5. 门禁与验收标准

### 5.1 票面写的「门禁（至少五条）」（逐字）

> - 改了 TS 没重新生成 → 红（照 `tests/verify-label-color-freshness.js` 的形态）；
> - 写出来的每个字段前面都有我们定义的注释 → 断言；
> - 老 `.json` 能读、能迁移；
> - 版本高于已知 → 拒绝写（并有明确回执）；
> - 发布包里能解析 YAML（依赖或内联二者其一，钉住）。

（[#1012 正文「交付物」](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012)）

### 5.2 票面写的「验收标准」（逐字）

> - [ ] 三个文件都能读写，格式是 YAML，注释由程序生成且与 schema 同源。
> - [ ] 老 `.json` 与新 `.yaml` 并存时以 `.yaml` 为准，并有一条日志说明这是迁移遗留。
> - [ ] 未知键、坏形状、超大文件、超多别名、版本过高：都不崩，并按既定档位如实回报。
> - [ ] `npm run verify`、`npm test` 全绿；新增门禁挂在 verify 链上。
> - [ ] 发布包（`package/`）里能真正解析 YAML。

（同上，[#1012 正文「验收标准」](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012)）

### 5.3 实际存在的门禁，以及它们各自量什么

以下五个是票面那五条的落地件，全部登记在 `package.json` 的 `scripts.verify` 链上（HEAD d0f14a86 实测链里含这五个，另外还挂了 `verify-settings-phones.js`、`verify-workspace-file-note.js`、`verify-settings-view.js`）：

1. `tests/verify-config-store-freshness.js` —— 新鲜度。逐字比对 `config-store-core/src/*.ts` 与 `src/shared/config-store/*.js`（转译口径直接复用 `config-store-core/build.mjs` 导出的同一个 `transpileUnit`），另跑一次 `tsc --noEmit`，断言产物零相对引用、带行首 export、不含两个版本占位符、插口空壳仍带 `PORTS_SOURCE`，并把单元数钉死四个（文件头 `tests/verify-config-store-freshness.js:1-11`）。
2. `tests/verify-config-store-comments.js` —— 注释门禁。文件头原文：「写出来的每个字段前面都有我们定义的注释，且注释文字与核里那份常量逐字一致；两个文件的头一句都是『本文件的注释由插件生成；你自己加的注释会在下次写入时被替换。』」（`tests/verify-config-store-comments.js:1-5`）。
3. `tests/verify-config-store-migration.js` —— 迁移门禁。盯四件事：M1 只有老 `.json` 时照读（`from` 记 `json`）；M2 新老并存以新为准并带一条迁移遗留警告；M3 写新删老、删不掉只警告；M4 高版本读成功标只读、写明确拒绝、两个都没有时回 `missing`（`tests/verify-config-store-migration.js:1-7`）。
4. `tests/verify-config-store-core.js` —— 行为门禁，六组共 34 条（我在 HEAD 上实跑：全部通过）。文件头原文：「C1 往返…C2 精确类型…C3 未知键…C4 硬限制…C5 版本：高于认识的只读不写…C6 标签形状」（`tests/verify-config-store-core.js:1-10`）。
5. `tests/verify-config-store-package.js` —— 发布包门禁。P1 仓库与发布包 `package/package.json` 两处生产依赖都有 `yaml` 且主版本一致、两份版本号都没动（本票不发版）；P2 装好的包里能解析一份 YAML；P3 发布包 `files` 白名单含 `shared`、核产物已生成、老单体产物已拆掉；P4 宿主适配器可加载、八个冻结函数都在（`tests/verify-config-store-package.js:1-8`）。

补三门与本次改造直接相关、同样挂在链上的门禁：

6. `tests/verify-settings-phones.js` —— 本机设置两条电话，量五件事：缺席、失败分档、只读写入拒绝、行数（新叶子与宿主入口各不超过 350 行）、真跑日志（读与写各成功一次、各失败一次，每次恰好一行，事件名与电话名与类型都对得上）（`tests/verify-settings-phones.js:1-11`）。
7. `tests/verify-settings-view.js` —— 客户端「按工作区的观看状态」搬到本机设置文件，量十二件事（缺席回退旧表读、写成功不写旧键、写失败才过渡写旧键、合并着写不丢别人的东西、键的写法、防抖、接线、文档还在路上时不许下结论，以及后续修复补的四条真行为）；它自己先跑一次 `node scripts/build.mjs`，用真 jsdom + 真 React 把「文档迟到」那一刻渲染出来（`tests/verify-settings-view.js:2-37`）。
8. `tests/verify-workspace-file-note.js` —— 绑定回执那一行「工作区配置文件写成什么样」，量六件事，含四个变异体反证（`tests/verify-workspace-file-note.js:1-58`）。#1012 进度记它 68 项（评论 6112678924），#1012 进度另一处记本机设置电话与回执门禁 58 项（评论 6112291948）。

另外，`tests/verify-947-workspace-file.js` 与 `tests/verify-957-workspace-writer.js` 两扇既有门禁已按新口径改过并全绿（#1012 进度第三轮自述，[#1012 正文「进度」](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012)）。

### 5.4 与验收标准的对照（现状）

- 第 1 条（三个文件都能读写、注释与 schema 同源）：核与适配器已就位；注释由门禁逐字段断言。已可核对。
- 第 2 条（并存以 `.yaml` 为准并有一条日志说明迁移遗留）：适配器带回执字段 `legacyPresent` 与 `warnings` 里的 `legacy-present`；#1012 的取舍是**不新增日志事件**，由调用方用已有事件记（`src/host/configStore.js:148-150`；`config-store-core/README.md:82-88`）。「由哪个调用方在哪一行记」这件事 #1012 进度里列为还没落定的收尾项之一（「本票剩的：…迁移遗留日志落点」，[#1012 正文「进度」](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012)）。
- 第 3 条（未知键、坏形状、超大、别名、版本过高都不崩并如实回报）：由门禁 C1 至 C6 与 M4 覆盖；实测 34 条全过。
- 第 4 条（`npm run verify`、`npm test` 全绿；门禁挂链）：门禁已挂进 `scripts.verify`（HEAD 实测）；但 #1012 进度写明「`npm run verify` 在 Windows 上因命令行过长本就跑不起来（既有环境限制），CI 走 `scripts/verify-all.mjs`」（评论 6112291948）。#1012 正文的「进度」一节还记着当时树上 14 条红全是别的票造成的（正文进度一节自述，2026-10-11 18:40 那一条）。
- 第 5 条（发布包能真正解析 YAML）：由 P1/P2 覆盖。实现选择的落点是「两处 `package.json` 声明生产依赖 `yaml: ^2.9.1` + 门禁钉住」，不是构建时内联（HEAD 实测：仓库 `package.json` 与 `package/package.json` 的 dependencies 都有 `yaml`；`tests/verify-config-store-package.js:26-43`）。票面雾区里写的「做法未定」没有被改写，见第 8 节第 2 条。

---

## 6. 已认可的补充口径

1. **`workspaces:` 那一节的键用工作区根的可读路径（不用散列值）**。维护者已认可（Q1）。原文：「**Q1、Q2 维护者已认可**：`workspaces:` 那一节的键用**工作区根的可读路径**（不用散列）；…」（[#1012 评论 6106517592](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6106517592)）。定案评论给的理由：「这份文件就是为了给人看、给手改；散列键没人看得懂。（老的宿主记忆用的是 sha256 前 24 位，那是给日志与隐私用的，不该搬到这里。）」（[#1012 评论 6106488823](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6106488823)）
2. **三个按工作区记的项统一到同一把键（工作区根）**。维护者已认可（Q2），原文同上一条评论：「三个按工作区记的项（横幅收起 / 红卡收起 / 红文件夹标志浮层）**统一到同一把键（工作区根）**」。定案给的理由：「老的三个键其实用了三种不同的键形态（工作区键 / 工作区键散列 / 工作区根），搬进来时归一成一种，免得同一件事又出现三把钥匙。」
3. **自动识别只在文件缺席时用来生成一次**。「文件存在就是第一优先级；文件不存在时，那份声明文件 `docs/agents/issue-tracker.md` 与自动识别**只用来把文件生成出来一次**，此后不再参与任何判定」（[#1003 评论 6105121298「上位口径」第 5 条](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1003#issuecomment-6105121298)）；#1003 的「已确认的决定」第 2 条重述为「文件存在 → 只有它说话；文件不存在 → 用那份声明文件与自动识别**生成一次**（带来源标记），此后它们不再参与」（[#1003 正文](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1003)）。
4. **多命中不许自动生成**。原文：「`auto` 的处置：多命中或身份待定时**不生成、如实拒绝并引导去面板选一次** → 旧的『自动挑一个 GitHub』这一档消失」（[#1012 正文「待决问题」](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012)）；#1003 期望行为第 6 条：「**`auto` 不再写文件**：deck 工具那段双命中保护不再往文件里写；多命中或待定一律如实拒绝并引导去面板选一次」（[#1003 评论 6105121298](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1003#issuecomment-6105121298)）。被接替的旧票 #947 原来那一档「无文件加双命中保护：…且两个后端里有 GitHub 时，自动存一个 GitHub 默认值并照此走」随 #947 关闭而作废（[#947 正文](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/947)、[#947 评论 6106024992](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/947#issuecomment-6106024992)）。
5. **来源标记 `user` / `migrated` / `detected`**。骨架里 `source` 那一行的注释原文：「这条选择是谁做的：user=人在面板里亲手选的；migrated=从老版本机记忆搬来的；detected=插件按声明文件或自动识别生成的」（[#1012 评论 6106488823](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6106488823)）；核里版本 2 只认这三种，版本 1（老文件）另认 `auto`（`config-store-core/src/workspace.ts:41-42`）。#1012 正文把「迁移来源标记：按骨架里的 `user` / `migrated` / `detected` 落地」列在「已由既有决定推出、不再单独决策」里。
6. **文件允许提交的含义**：「提交了就团队共享，改动会影响所有人」，并且这份文件是**人可以手改的配置文件**——手改写下的 `source: "user"` 同样算人的选择（[#1012 正文「约束与偏好」](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012)、[#1003 正文「已确认的决定」第 7 条](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1003)）。
7. **1.8.0 正式版等完全修复之后再发新版本**。维护者 2026-10-11 定；#1012 与 #1003 两票正文都记了同一句（[#1012 正文「已定（原待决问题，2026-10-11 维护者答复）」](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012)、[#1003 正文同节](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1003)）。发版门禁另有旁证：`tests/verify-config-store-package.js:33` 断言两份 `package.json` 的版本号都还是 `1.8.0-rc.7`，即「本票不发版」。
8. **本票挂在地图 #1010 下**。票面自述「本票**已挂进地图 #1010**（维护者认可，父子边已建并读回核对：parentKey = 1010）」（[#1012 正文](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012)）。我另外用 deck 工具读回一次：`deck_issue_get 1012` 返回的 `relations.parentKey` 是 `1010`（2026-10-12 04:2x 观测；同一次会话里 `deck_map_snapshot 1010` 报「子票没取全」，所以父子边以单票读回为准）。

---

## 7. 冲突与不确定

这一节把「同一件事在不同评论／不同票里说法不一致」的地方全部列出来。凡有新答复覆盖旧说法的，写清以哪条为准、依据是什么。

### 7.1 文件自己能不能当「工作区根」的标记

- 说法 A（建议加）：2026-10-11 04:37 的「第三组确认 + 一条必须先堵的逻辑洞」第 4 点：「**工作区根的标记加上 `docs/agents/workspace.json` 自己**（按『谁近听谁』，子目录自带一份就是嵌套工作区）。不加它，没有 `.git` 的工作区从子目录打开时读不到那份文件（实测在案）。若维护者『这个效果是认可的』指的是『保持现状、不改标记』，本条撤回。」（[#1003 评论 6105492636](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1003#issuecomment-6105492636)）
- 说法 B（不加）：同一票的实施契约「上位口径」第 9 条：「工作区根的标记保持今天两个（自带 `.git`、或自带那份声明文件），**不新增** `workspace.json` 自己作为标记。」（[#1003 评论 6105121298](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1003#issuecomment-6105121298)）同一条也写在 #1012 正文「约束与偏好」里：「**不新增** `workspace.json`／`workspace.yaml` 自己作为『工作区根』的标记（根标记保持今天两个：自带 `.git`、或自带那份声明文件）。」
- **以哪条为准**：以说法 B 为准。依据有两条，都是可核的时间证据：一是那份契约评论虽然在 2026-10-11 03:42:48Z 创建，但**最后编辑于 2026-10-11 06:45:24Z**（GitHub API 的 `updated_at`，我实测读回），编辑时间晚于 04:37 那条建议，且编辑后的文本仍保留第 9 条；二是 2026-10-11 05:08 的评论声明「实施契约已更新为**最终版**（维护者 2026-10-11 的四轮口径全部并入）…后续动手只认这一条」（[#1003 评论](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1003)）。
- 旁证，但**不确定**：地图 #1010 的重构计划把 `src/shared/deck-tools/workspace-file.js` 搬到 `src/deck/shell/workspace-anchor.ts`（[#1012 评论 6112720202](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6112720202)、`research/1010-ticket-scope-5.md:91`）。名字里带「anchor」只说明它被当作读取后端选择的凭据，**不能据此认定它成了工作区根标记**；这一点票面没有一句话说明，不确定。

### 7.2 有没有「清除后端选择 / 显式无后端」这个动作

- 说法 A（要加）：2026-10-11 04:37 那条评论的第 1、2 点主张文件里支持一种明确的「无后端」记录（例如 `backendId: ""` 且 `source: "user"`），并给界面一个正规的「清除后端选择」按钮（[#1003 评论 6105492636](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1003#issuecomment-6105492636)）；更早的对抗式审查（04:14）也提过同一个洞（[#1003 评论 6105342485](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1003#issuecomment-6105342485)）。
- 说法 B（没有这个动作）：契约「上位口径」第 8 条：「没有『清除后端选择』这个动作：用户必须选一个他要的后端并切过去」；「期望行为」第 7 条：「**没有『无后端』这一档**…不做『清除选择』按钮」；「已知取舍」末条：「不做『清除后端选择』：要换只能切到另一个后端」（[#1003 评论 6105121298](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1003#issuecomment-6105121298)）。同一条写在 #1012 正文「约束与偏好」，也写在更早的 ADR：`docs/adr/20260921-persist-user-choice-host-side.md` §4「不引入『清除后端选择』这类入口（#669 第 6 件已把那条路退役）」，该 ADR 的 R5b 还写明 `backendId === null` 永不写入，「退役的『无后端』逃生舱不许借这条路复活」。
- **以哪条为准**：以说法 B 为准，依据同 7.1（契约最后编辑时间晚于建议，且契约声明为最终版）。核的现状与说法 B 一致：`backendId` 必须是非空文字（`config-store-core/src/workspace.ts:143-144`），没有「无后端」这一种合法取值。

### 7.3 `withWayfinder` 前缀开关的去留

- 票面只说了两件事：第 10 条 `dsws.cfg`（旧配置存档）**删除**；第 11 条 `dsws.startCfg`（更早存档）**删除（连迁移逻辑一起）**（[#1012 评论 6106488823](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6106488823)）。逐条解释那条评论说 `dsws.cfg`「历史上存过『打开位置（DSH 右侧边栏 / BetterSidebar 二选一）』与『**是否带 wayfinder 技能集**』这类开关；今天插件**一个字都不读它**」（[#1012 评论 6106442752](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6106442752)）。
- 代码实际情况（HEAD d0f14a86 实测）与「一个字都不读它」有出入：`src/client/kernel/config.js:15-25` 仍然维护 `cfg`（默认值 `{ withWayfinder: true }`）、启动时 `localStorage.getItem('dsws.cfg')` 仍会被解析一次、`saveCfg()` 仍把 `cfg` 写回同一个键；`src/client/kernel/config.js:40-54` 的 `migrateStartCfg()` 仍会把老 `dsws.startCfg` 里的 `withWayfinder` 迁进 `cfg`；而 `src/client/kernel/router.js:131-134` 的 `withWayfinderPrefix` **仍在用它**（`if (!cfg.withWayfinder) return body`，为真时在注入文本前加 `/wayfinder\n`）。
- 也就是说：**存储值事实上已经读不回来**（启动时永远是默认的 `true`，因为 `cfg` 是从常量起步的），但**这个开关的代码路径是活的**。源码 `src/` 下 `withWayfinder` 只出现在 `src/client/kernel/config.js` 与 `src/client/kernel/router.js` 两处，没有界面可以把它改成 `false`（HEAD d0f14a86 实测全仓 grep；其余命中都在 `docs/`、`scripts/`、`tests/` 与 `research/` 里）。
- **不确定**：票面没有一句话交代「`withWayfinder` 这个前缀开关本身留不留」。按第 10、11 条把两个存档键与迁移逻辑删掉之后，`cfg.withWayfinder` 就没有落点了；删与不删都不违反票面文字，但会影响行为（当前恒为真）。这一条要么请维护者一句话，要么在动手前把「默认恒真」写成明文。

### 7.4 标签点击计数落不落盘

- 第 1 轮（06:45）：「标签点击计数 | `dsws.labelClicks` | 全局，或干脆不落盘 | 只是给标签 chip 排序用的热度，丢了不影响功能」（[#1012 评论 6106364491](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6106364491)）。
- 第 2 轮定案（07:02）：「4 | 标签点击计数 | 本机 `settings.yaml`（也可以不落盘，动手前定一句）」，并且骨架里带着这一项与它的注释（`# 标签被点过的次数，用于标签 chip 排序` / `labelClicks: {}`）（[#1012 评论 6106488823](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6106488823)）。
- 2026-10-12 凌晨维护者明确答复（20:13:25Z）：「1. 标签点击计数（`dsws.labelClicks`）：**不落盘**。它只是标签排序用的热度，丢了不影响功能；**本机设置文件里不存这一项**。」（[#1012 评论 6113252694](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6113252694)）
- **以哪条为准**：以 2026-10-12 的那条答复为准（时间最新、且是对这一问的直接回答；它同时推翻了骨架里那一项）。**到 HEAD 为止还没落地**：客户端仍把 `dsws.labelClicks` 持久化（`src/client/kernel/store-prefs.js:24-32`），核的 schema 仍保留 `labelClicks` 并每次写盘都写一行（`config-store-core/src/settings.ts:31, 108-118, 216-223`），注释门禁也仍在断言那一行的注释（`tests/verify-config-store-comments.js:66`）。要照最新答复办，就得同时改核、注释门禁、客户端三处。

### 7.5 调试开关的真源

- 第 1 轮（06:45）：「调试开关 | `dsws.debug` + 宿主侧 `log-switch.json` | 全局，并**定一份真源** | 今天两处各一份，要对账」（[#1012 评论 6106364491](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6106364491)）。
- 第 2 轮定案（07:02）：「8 | 调试开关 | 本机 `settings.yaml`（并与宿主那份 `log-switch.json` 定一份真源）」（[#1012 评论 6106488823](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6106488823)）。
- 2026-10-12 凌晨维护者明确答复（20:13:25Z）：「2. 调试开关真源：**以全局配置文件（本机 `settings.yaml` 的 `debug` 节）为主**。理由（维护者原话的意思）：重启电脑后打开 DSH，看到开关是开的，就说明这次要开调试；宿主那份 `log-switch.json` 只是当初为了开调试通过接口去设的产物，不是真源。」（[#1012 评论 6113252694](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6113252694)）
- **以哪条为准**：以 2026-10-12 那条答复为准（第一次把「真源是谁」说死）。**到 HEAD 为止还没落地**：客户端仍以 localStorage 的 `dsws.debug` 为启动秒显来源并回写（`src/client/kernel/log.js:14, 28-52, 203, 281`），宿主仍读写缓存目录下的 `log-switch.json`（`src/host/logStore.js:10, 187-209`），而 `settings.yaml` 的 `debug` 节目前**没有任何消费方**（全仓 `readLocalSettings` / `wf.getSettings` 的调用点只有设置那两条电话与客户端观看状态那一片；HEAD 实测 grep）。

### 7.6 第 14 条（额度降级横幅「这次会话别再弹」）

- 定案（07:02）：「保持 sessionStorage（键里带仓库，但语义是『这次会话』；**待维护者一句话确认**）」（[#1012 评论 6106488823](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6106488823)）。解释那条给了理由：它的语义就是「这次会话里别再烦我」，关掉窗口即重置，而且刻意不写进快照、不改宿主的标记（有一条静态门禁 `tests/verify-visible-truth.js` 盯着）（[#1012 评论 6106517592](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6106517592)）。
- 2026-10-12 凌晨维护者确认（20:13:25Z）：「3. 第 14 条（额度降级横幅『这次会话别再弹』）：**保持 sessionStorage，不落盘、不进配置文件**（此前已敲定）。」（[#1012 评论 6113252694](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6113252694)）
- **以哪条为准**：以最新确认那条为准，结论与定案相同（没有变化）；代码现状一致（`src/client/views/shared/RestFallbackBanner.js:23` 的键是 `dsws.restFallbackDismissed:<repoRoot||repo>`）。

### 7.7 第 5、6、7 条（观看状态）先去哪个文件

- 中间那条（06:56）给了一个「更简单的判据」：「**凡是『按工作区记』的，就进工作区文件 `workspace.yaml`**；不按工作区分的进全局 `settings.yaml`」，并据此把第 5 条判进 `workspace.yaml`、第 6 条先搬进 `workspace.yaml`；同时提醒了三个副作用（每次点一下收起都改写随仓库走的文件、同事 clone 会继承你的观看状态、写盘频率变高），并给了两个折中（单独放一节 `ui:` 并在文件头写「这一节是本机观看状态，通常不建议提交」，或者放全局 `settings.yaml` 里按工作区分节）（[#1012 评论 6106442752](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6106442752)）。
- 定案（07:02）把它们改判进本机文件：「5 | 横幅收起（按工作区） | 本机 `settings.yaml`（按工作区分节）」「6 | 无仓库红卡收起 | 本机 `settings.yaml`（按工作区分节）；要不要退役等 #1004」「7 | 红文件夹标志的说明浮层 | 本机 `settings.yaml`（按工作区分节）」，并写明「**本评论取代前面两条清单评论里的建议**，以这里为准」，还补了一句「顺带解决掉一个副作用：第 5、6、7 项（观看状态）放本机文件后，不再出现『点一下收起就改写随仓库走的文件、同事还会继承你看过没看过』这类问题」（[#1012 评论 6106488823](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6106488823)）。
- **以哪条为准**：以定案那条为准（它自己声明取代前两条，且时间更晚）。落地与之一致（第 3 节第 5、7 条）。

### 7.8 读用途在文件缺席且生成不出来时兜不兜

- #1003 契约期望行为第 4 条：「**写用途只认文件里的记录**：文件不存在、或生成不出来时，写操作（建票、改票、改标签颜色、deck 工具）一律拒绝并引导『先去面板选一次』；**读用途（面板展示、环境检查、看票）在文件缺席时可以用生成结果兜**。」（[#1003 评论 6105121298](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1003#issuecomment-6105121298)）
- #1012 正文「待决问题 · 已由既有决定推出」：「读用途兜底：那份声明文件与自动识别**只用来生成文件、没有别的价值** → **生成不出来时读用途也不兜**，界面说『这条工作区还没选后端，请选一次』。」（[#1012 正文](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012)）
- 两句话读起来是打架的（「读用途可以兜」对「读用途也不兜」），但**字面上可以并存**：#1003 说的是「生成得出来的结果可以用来兜读用途」，#1012 那句限定在「生成不出来时」这一档不兜。**不确定**：两张票都没有把这两句放在一起对账，也没有一句话说明它们是不是同一件事；需要维护者一句话，或者把判据写成明文（例如「文件缺席、且声明文件与自动识别都生不出唯一来源时，读用途也不兜，界面说还没选后端」）。
- 相关的一条实测证据（属 #1003 那一侧）：2026-10-12 的对抗式审查发现写用途当时没有被拦住——统一判定出口给了 `canWrite:false`，但 deck 工具与改色电话都不看它（[#1003 评论 6112248266](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1003#issuecomment-6112248266)）；随后仓库里有提交 `50bbf472`「开启写用途拦截并让本机记忆退出判定，判定只剩文件与人的选择两个凭据」（`git log --oneline` 实测）。这条只说明写用途那一半后来有人动了，**不代表读用途那两句的口径已经对齐**。

### 7.9 「读到就迁移」还是「读不迁、由调用方决定」

- 票面（#1012 已定事项第 1 条）：「**继续读**老的 `.json`（**读到就迁移**；两个同时在时以 `.yaml` 为准并留一条日志；写成功后再删老文件…）」（[#1012 正文](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012)）。
- 实现：标签配色那条**在放置函数里读到就迁**（`src/host/tracker/backends/markdown/label-colors.js:242-255`）；工作区后端配置那条**读不迁**，适配器只回报 `from: 'json'`，注释写「调用方决定何时迁移」（`src/host/configStore.js:230-245`），实际迁移动作在 #1003 的老用户迁移与写入口那一侧。
- **不确定**：「读到就迁移」这句话是不是同时约束工作区那份文件，票面没有区分；两种做法都能满足「老文件能读、能迁移」的验收标准，但「什么时候迁」不一致。建议请维护者一句话定，或者把两种文件的迁移时机分别写成明文。

### 7.10 同一份契约里 `workspace.json` 与 `workspace.yaml` 两种写法

- #1003 的最终契约在 2026-10-11 06:45 被编辑时加进了「## 存储层（2026-10-11 新增口径，落在 #1012）」一节，其中一句是：「本票正文与验收标准里凡是写 `workspace.json` 的地方，**一律按 `workspace.yaml` 理解**（老 `.json` 只作为兼容读的输入）。」但同一评论的标题、Summary、上位口径第 2 条、期望行为第 1、2 条仍然写着 `workspace.json`（[#1003 评论 6105121298](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1003#issuecomment-6105121298)）。
- **以哪条为准**：以「存储层」那一句为准（它自己声明是新增口径，且 #1012 的路径事实就是 `.yaml`）。这不是分歧，是同一份评论内部没改干净；读这份契约的人要注意这一处。

### 7.11 谁写那七个重叠文件（地图 #1010 重构 vs #1012）

- 重构侧 2026-10-11 19:16:59 在本票留了一条边界通报：地图 #1010 的重构要搬走并转成 TypeScript 的文件共七个（`src/shared/deck-tools/workspace-file.js` → `src/deck/shell/workspace-anchor.ts`；`src/host/tracker/backends/markdown/label-colors.js` 与 `label-colors-codec/errors/ops/paint/palette.js` 整房搬进 `src/tracker/rooms/markdown/` 并逐个转 `.ts`）；按地图硬规则「同一条边界同一时间只许一个写者」，这批文件在重构落地期间归重构，请 #1012 对它们改为只读引用；并请 #1012「在评论里回一句时间点」，「**在你回复之前，我们不动这七个文件**」（[#1012 评论 6112720202](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6112720202)）。
- 同一时刻地图票上也留了一条同内容的评论，并写明「重叠面共十三个文件，已逐条核过：`src/host/workspaceCwd.js` 里一行 import、`src/host/tracker/detection/**` 六件（#1003 拥有）、Markdown 房配色六件（#1012 拥有）。已按此在 #1012 与 #1003 各留一条边界通报评论，**等它们回复时间点后排先后**」（[#1010 评论 6112720747](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1010#issuecomment-6112720747)）。
- 地图侧的调研笔记把这件事写成待维护者拍板：「要么它先把这 7 个文件改完…要么我们先转 `.ts`…**这个选择要维护者拍板，不归我这一层定**」（`research/1010-ticket-scope-5.md:94`，判定为「部分，并且存在文件级冲突，必须排先后」，同文件 `:86`）。
- 到本稿写作为止，#1012 的最后一条评论（20:13:25Z）只回答了标签点击计数、调试开关真源、第 14 条三件事，**没有回时间点**（[#1012 评论 6113252694](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6113252694)）。
- **状态：未定。** 另外我观测到，调研期间工作树里有未提交改动落在本票声明的写范围内——`package.json`、`scripts/build.mjs`、`src/client/index.js`、`src/client/kernel/store-prefs.js`、`src/client/views/NoRepoCard.js`、`src/client/views/SubworkspaceMark.js`（2026-10-12 04:14 与 04:26 两次 `git status --short` 实测；其中一部分随后被提交，HEAD 从 9924d3f9 走到 d0f14a86）。这些文件不在重构通报点名的七个里，改它们的是谁、有没有事先说定，**我不确定**；写代码前请先看当时的 `git log` 与两条边界通报评论。

### 7.12 「只剩老 JSON 文件的工作区」那条归属

- #1012 进度（18:32）把一个问题挂在末尾：「另有旧 JSON 回退归属一句（**只剩老 `workspace.json` 的工作区，展示栏空着算对方补回退还是接受自然缺口**）」（[#1012 评论 6112291948](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6112291948)）。
- 2026-10-12 维护者答复（20:13）：「另附：#4『只剩老 JSON 文件的工作区』那条**不是既成决定**，是我表述不清引发的疑问，见同期对话说明；**定下来后再补记**。」（[#1012 评论 6113252694](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012#issuecomment-6113252694)）
- **状态：至今未定**（票面说到「定下来后再补记」，但此后没有新评论）。

### 7.13 `auto` 那一档（旧票与新票的分歧，已收口）

- 旧票 #947 的「已定事项」写着：「无文件加双命中保护：四处都没有显式选择、且两个后端里有 GitHub 时，**自动存一个 GitHub 默认值并照此走**（看得见、可一键纠正…）」（[#947 正文](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/947)）。
- 新方案把它推翻：「`auto` 的处置：多命中或身份待定时**不生成、如实拒绝并引导去面板选一次** → 旧的『自动挑一个 GitHub』这一档消失」（[#1012 正文](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1012)）。#947 已在 2026-10-11 关闭并在评论里写明三条冲突（格式 JSON→YAML、读取顺序以本机记忆优先→文件为唯一真源、个人切换只写本机记忆→每次都写文件）（[#947 评论 6106024992](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/947#issuecomment-6106024992)）。
- **以哪条为准**：以新方案为准（#947 已废弃关闭）。核的实现与之一致：版本 2 不再认 `source: auto`，只有读版本 1 的老文件时才认（`config-store-core/src/workspace.ts:41-42, 149-157`；门禁用例 `tests/verify-config-store-core.js:125-132`）。

---

## 8. 尚未成文（雾区）

以下是 #1012 正文「### 雾区」一节的原话（逐条抄录），后面注明到本稿写作为止有没有人定。

1. 原文：「「全部工作区有效的配置」这条边界还没写成判据文字（建议落一条 `CONTEXT.md` 词条或一条 ADR）。」
   **至今仍无人成文**。实测：`CONTEXT.md` 里对 `yaml`、`YAML`、`settings.yaml`、`workspace.yaml`、`config-store` 都没有命中，「配置」只在子工作区那条词条里顺带出现一次（「并在同一仓库里长出第二套配置与票仓」）；`docs/adr/` 下也没有对应 ADR（目录里按文件名排序最后两条是 `20261004-version-control-write-path.md` 与 `20261011-deck-ts-rewrite.md`，没有一条讲配置存储分层）。
2. 原文：「YAML 依赖最终落在哪（仓库 `package.json` / 发布包 `package/package.json` / 构建时内联）——验收标准里写了「必须能解析」，做法未定。」
   **事实上已经选了做法，但票面文字没改**：两处 `package.json` 的 dependencies 都声明 `yaml: ^2.9.1`，不用「构建时内联」，并有一条门禁从行为上钉住（`tests/verify-config-store-package.js:26-43`；HEAD 实测两份文件的依赖都是 `"yaml": "^2.9.1"`）。核的 README 也把这写成结论（`config-store-core/README.md:46-53`）。没有找到维护者就「做法」说过一句话，所以严格说：**实现已定、成文未定**。
3. 原文：「`workspace.yaml` 从 v1 升 v2 的兼容矩阵（谁读谁、什么情况下只读不写）没写成文字。」
   **仍没写成文字**（没有 ADR、没有 CONTEXT.md 词条）。实现里的规则是可读的：v1 读（迁移用，`source` 允许 `auto`）、v2 读写、版本高于 2 只读不写、写一律输出 v2、写时版本缺席默认 2、传 1 视为升级写出（`config-store-core/src/workspace.ts:23-24, 41-42, 134-142, 181-190`）。要不要把这套规则抄成文档，票面没说。
4. 原文：「「数据 vs 配置」的隐含原则（`label-colors` 是数据却跟工作区走；`settings` 是配置却在本机）没成文。」
   **仍没成文**。现在能读到的只有两处散句：定案评论第 17 条「改 YAML…仍在工作区；它是数据不是配置」，与核里 `labels.ts:6-8` 的头注「它是数据不是配置：键是标签名（动态，多少个都行），值是颜色或颜色加一句说明」。
5. 原文：「面板布局随仓库走的副作用（我切了布局，同事 clone 后也变）没有讨论过。」
   **至今无人讨论**（#1012 评论里没有任何一条回应这句；定案把第 5、6、7 项挪去本机文件解决了「观看状态」的同类副作用，但 `layout` 仍在 `workspace.yaml` 里，骨架里那一行注释就是「面板布局：single=单栏；multi=多栏」）。

「### 地图层面的条目（map 层面，随建图搬入）」两条的现状：

- 原文：「本票目前**不在任何地图下**，与 #1003 的关系只靠两票正文维系。」——**这一条已经过期**：本票现在挂在 #1010 下（deck 工具读回 `relations.parentKey = "1010"`；票面也写了「父子边已建并读回核对」）。
- 原文：「「全 TS 项目」的迁移路线需要一条自己的路线图（今天只有三个 TS 核与客户端组件是 TS）。」——**已有承接**：地图 #1010 的目的地就是「围绕 deck 工具全部能力的每一份代码全部用 TypeScript 实现」，并已有设计决议 `docs/adr/20261011-deck-ts-rewrite.md` 与共识 `research/1010-consensus.md`（`#1010` 评论 6112720747 的「相关文件」一节列了它们）。这条是不是算「迁移路线图」，**不确定**，因为它只覆盖 deck 工具与两个后端房间，不等于全仓。

---

## 9. 怎么复核（可直接跑的命令）

1. 读票与评论（本文件所有票面出处的来源）：
   - `gh issue view 1012 --json body --jq .body`
   - `gh issue view 1012 --comments --json comments --jq '.comments[] | "\(.createdAt) \(.id)\n\(.body)\n"'`
   - 同样读 `1003`、`947`、`1010`。
2. 读评论的「创建时间 vs 最后编辑时间」（第 7.1、7.2 节判断「以哪条为准」的依据就在这里）：
   - `gh api repos/FeatherHunter/dsh-mattpocock-skills-deck/issues/comments/6105121298 --jq '{created_at,updated_at}'`
3. 复核核与适配器：`node tests/verify-config-store-core.js`、`node tests/verify-config-store-comments.js`（两条我都实跑过，分别 34 条全过与全过）、`node tests/verify-config-store-freshness.js`、`node tests/verify-config-store-migration.js`、`node tests/verify-config-store-package.js`。
4. 复核父子边：`deck_issue_get 1012`（看 `relations.parentKey`）。
5. 复核落地情况：`git log --oneline -- config-store-core src/shared/config-store`，以及第 3 节表里逐条给的文件行号。

---

## 附：本稿引用到的一手材料清单

- 票：#1012（本票，含正文与 8 条评论）、#1003（判定收口，含正文与 14 条评论）、#947（被接替的旧票，已关闭）、#1010（地图，含正文与评论）、#1004（无仓库红卡退役，尚在 open，第 6 条等它）。
- 仓库文档：`CONTEXT.md`、`docs/adr/20260828-workspace-key-unification.md`、`docs/adr/20260913-builtin-ts-shape.md`、`docs/adr/20260921-persist-user-choice-host-side.md`、`docs/adr/20260921-tracker-choice-precedence.md`、`docs/adr/20261011-deck-ts-rewrite.md`、`docs/agents/` 目录、`research/1010-ticket-scope-5.md`、`research/1010-consensus.md`。
- 代码与门禁：`config-store-core/**`（README、build.mjs、tsconfig.json、src/ports.ts、src/workspace.ts、src/settings.ts、src/labels.ts）、`src/shared/config-store/*.js`、`src/host/configStore.js`、`src/host/settingsPhones.js`、`src/host/index.js`、`src/shared/deck-tools/workspace-file.js`、`src/host/tracker/backends/markdown/label-colors*.js`、`src/client/kernel/settings-view.js`、`settings-view-state.js`、`settings-view-write.js`、`store-prefs.js`、`config.js`、`log.js`、`router.js`、`src/client/views/NoRepoCard.js`、`src/client/views/shared/RestFallbackBanner.js`、`src/host/logStore.js`、`tests/verify-config-store-*.js`、`tests/verify-settings-phones.js`、`tests/verify-settings-view.js`、`tests/verify-workspace-file-note.js`、`package.json`（`scripts.verify` 链与 dependencies）、`package/package.json`、`scripts/build.mjs`。
