# 全新工作区首开引导链：现状核查

所属：地图 #660「全新工作区第一次打开时的引导顺序」。定版结论在票 #661；本文件只做走查记录的存档，落地票照 #661 执行。

核查日期：2026-09-19。核查人：agent（会话内直读代码，未改任何文件）。
触发：维护者在一个全新工作区里，蓝条（选后端）→ 选了 GitHub 与 multi-context → 被注入一段「当前工作区不是 GitHub 仓库……」的长文，认为流程不够顺、注入文案体验差。
本文只记事实与坐标，不写结论；结论由维护者在对话里定。

---

## 一、维护者这次实际走的路径（按代码还原）

1. 打开全新工作区（本会话没有后端选择）→ 状态栏算 `firstBlock`，后端未定 → `'gate'` → 蓝条「该工作区还没有设置 — 点击选择后端」+ 按钮「去选择」。
   坐标：`src/client/statusbar/StatusBar.js:142`（判定）、`:256`（渲染）。
2. 点「去选择」→ `openStatusGate`（`src/client/statusbar/StatusBackend.js:87`）→ 弹窗里有两组单选：**后端三选** 与 **域文档布局两选**（`layoutRadios`，`StatusBar.js:279`）。
3. 选了 GitHub + multi-context → 点「确认并继续」→ `confirmStatusGate`（`StatusBackend.js:92`）：把布局写进会话状态（`applyStatusSetupLayout`，`:94`）→ 写 selection → `wf.bind` → 调 `injectSetupDecision(s, id, { allowCard: true })`（`:95`）。
4. 因为布局在这一步已经答过，`injectSetupDecision` 不再弹小卡（`src/client/kernel/prompts.js:168`）→ 走 `setupOrRepoPrompt`（`:124`）：GitHub 房声明了建仓能力（`repoCreateChain`，`src/host/tracker/backends/github/repo.js:71`），而会话里没有仓库引用 → `hasRepo=false` → 注入 GitHub 房声明的缺仓指引 `repoRemoteFix`（`src/host/tracker/backends/github/index.js:132-134`）。
   —— 这就是维护者贴出来的那段长文。

---

## 二、维护者要的流程 vs 今天

| # | 维护者要的 | 今天有没有 | 差在哪 |
|---|---|---|---|
| 1 | 全新工作区 → 蓝条提示选后端 | 有 | 无（#198/#201/#203 定的就是这条） |
| 2 | 点开后选 GitHub | 有 | 同一个弹窗里**同时问了布局**（#655 加的）。此刻还没装 gh、还没建仓，问「各部分共用一套用语吗」是超前的问题 |
| 3 | 选完检查 gh cli 装没装 | 状态栏有这一步；检查页也有一项 | **两处顺序都不对**：状态栏那条优先级（`gate → ghcli → ghauth → setup → skills`）里根本没有「仓库」这一步；检查页把「已关联 GitHub 仓库」排在最前（`src/shared/tracker/check-catalog-dirs.js:98`），gh 都没装时第一行红牌是「创建并发布」，点下去只会撞 no-gh |
| 4 | 没装 → 提示要装 gh cli | 有黄条与按钮 | **那颗按钮今天是坏的**：见下面第三节 |
| 5 | 点击 → 注入 `/wizard 帮用户安装gh cli 官方地址：https://cli.github.com/` | 注入的是另一段文本 | 检查行那颗「安装指引」注入的是 `noGhPrompt`（先 `gh --version`，再按系统 winget/brew/apt，`github/index.js:128-131`）。与 `/wizard` 口径不同 |
| 6 | 装了 → 检查有没有仓库 | 检查页有这一项 | 状态栏那条链没有这一步：gh 装好、登录好后直接跳到「该工作区尚未初始化」黄条 —— 仓库还不存在时就催人初始化 |
| 7 | 没仓库 → 出建仓弹窗 | 弹窗有，但走路绕开了它 | 可用的建仓弹窗 = 检查行 `gh:remote` 上的两步向导（仓库名 + 可见性 → `wf.initPublish`，`github/index.js:62-81`）。注入这条路不发它，发的是长文 |
| 8 | 就绪后 → 黄条 → 布局小卡 → 注入初始化全文 | 有 | 因为第 2 步已经答过布局，这条路不会再问 |

---

## 三、两颗按钮，一个坏点（可直接复现）

状态栏 ghcli 条那颗按钮：

```
StatusBar.js:258-259
// #195 修复(第二轮)：hint 直接为后端提供的完整 prompt（多态），UI 直接 inject；移除副按钮
? bann(tr('banner.ghcli'), tr('banner.ghcliBtn'), function () {
    var c = chainStep(s, 'gh:installed'); var h = (c && c.show && c.show.hint) || ''; if (h) inject(s, h) }, true)
```

它注入的是链上这一项的 `show.hint`。而 2026-08-29 的一次审查把 GitHub 房所有 `fixes` 的 hint 改成了「状态翻译」（`github/index.js:33-34` 的注释写着这条纪律），`gh:installed` 的 hint 现在是：

> GitHub 助手（gh cli）还没安装，安装后即可继续。

所以：**点「AI 引导安装」注入的是一句陈述句，不是安装步骤**。源码里那条注释还停留在「hint 就是完整 prompt」的旧假设上。
真正注入安装步骤的是检查页那一行的「安装指引」按钮（`fixes['gh:installed'].actions[0]`，`github/index.js:41`）。
对照：同一颗按钮的登录版（`StatusBar.js:261`）注入的是后端的完整指引 `prompts.ghAuthLogin` —— 两条同槽的按钮，口径不一致。

---

## 四、三个后端各自的链（今天的目录）

按 `src/shared/tracker/check-catalog-dirs.js`：

- **GitHub**：`gh:remote`（已关联 GitHub 仓库）/ `gh:installed`（gh cli 已安装）/ `gh:authed`（已登录）/ `gh:repoAccess`（仓库可访问）/ `gh:labels`（标签齐）。
  能力位：`repoCreateChain: true`（`github/repo.js:71`）→ 缺仓分支只对 GitHub 生效。
- **GitLab**：`glab:installed` / `glab:authed` / `glab:repoAccess`。**没有**建仓能力位 → 「没仓库就弹建仓窗」这条在 GitLab 上今天不成立。
- **本地 Markdown**：`md:scratchWritable`（本地数据目录可读写）/ `md:parseOk`（本地关卡地图可读取）。没有 CLI、没有仓库 → 维护者要的分支在 md 上只剩「蓝条 → 黄条 → 布局卡 → 注入」。
- **通用三项**：`skill:wayfinder` / `skill:setup-matt-pocock-skills` / `skill:ask-matt`（技能套件）、`env:home`、`tracker:initialized`（工作区已初始化）。

状态栏那条优先级链只认 `gh:installed` 与 `gh:authed`（`src/client/statusbar/checksums.js:36-40`），加上 setup 黄条与技能条；GitLab 与 Markdown 的 CLI、仓库项**不在**状态栏这条链里。

---

## 五、顺序今天写在四个地方（没有共同真源）

1. 状态栏优先级：`StatusBar.js:142` 的 `firstBlock`。
2. 检查目录排行：`check-catalog-dirs.js` 的三个目录 → 决定检查页从上到下怎么排。
3. 注入决策：`prompts.js` 的 `injectSetupDecision` / `setupOrRepoPrompt`。
4. 后端自己的修复知识：`backends/<id>/index.js` 的 `fixes`（hint + actions），由宿主在组装链快照时解析进去（`src/host/tracker/fixContract.js`）。

四处各写一份，所以维护者要的顺序总会在某处对不上 —— 今天已经漏了两处（状态栏没有仓库这一步；检查页把仓库排在 gh 之前）。

---

## 六、相关历史（新工作要对齐或有意修订）

- **#198 图**（+ #201 门控优先级、#202 黄条文案与一键注入、#203 蓝黄同槽原型）：定的就是这条首用链 —— 蓝条与黄条同一个位置互斥出现。
- **#195**（gh CLI 误报 + 安装按钮只外跳不注入）：定的就是 ghcli 条走「注入后端声明的安装指引」。上面第三节那个坏点是这条规矩后来被改写时漏掉的。
- **#496**（全新工作区选 GitHub 却注入初始化提示词）：定的就是「有建仓能力且仓库为空时改发缺仓指引 + 建仓成功后再补发一次初始化全文」。维护者现在要的流程，是对这条的修订：把「发一段长文」换成「把用户带到那个建仓弹窗」。
- **#655**（初始化流程与弹窗支持多上下文）：把布局那一问放进了门控弹窗与小卡两处。
- **#427**（装好 gh 仍报「未找到命令 gh」）：装 gh 这一步必须带上「重开终端 / 重启 DSH 再重查」，否则会撞上这个已知缺口。
- **#429**：新电脑首接入的 gh 假阴性与未识别仓库，与本图的顺序问题相邻但不同源。

---

## 七、可以直接复用的现成件（不用重造）

- 建仓弹窗：`type:'wizard'` 两步 + `submitAction: wf.initPublish`（`github/index.js:62-81`）；渲染在 `src/client/kernel/slotRenderer-modal-view.js`，由 `ChecksTab.js:60-66` 分发。
- 动作词汇表：`inject-prompt / open-url / rpc / form / wizard / refresh`（`src/client/kernel/actions.js:15`）。UI 只分发，后端只声明。
- 注入漏斗：`injectSetupDecision`（唯一允许注入初始化文案的地方）与 `consumePendingSetup`（建仓成功后补发一次，`prompts.js:191`）。
- 建仓卡 `NoRepoCard`（`src/client/views/NoRepoCard.js`）：**组件还在产物里，但已经没有任何地方挂载它** —— ListTab 自 2026-08-28 起不再挂它（`ListTab.js:227-228` 的注释），全仓搜不到调用点。要么这张图把它接回去当建仓入口，要么顺手删掉。
- 技能 `/wizard`：产出的是**交互式 bash 脚本**（`bundled-skills/wizard/SKILL.md`），技能自己写着「不要用在我自己能做的步骤上」。

---

## 八、本轮问维护者的问题

见对话正文的 Q1–Q7。答复落定后再建图、建票、派研究票。
