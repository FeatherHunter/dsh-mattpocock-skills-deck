<h1 align="center">dsh-mattpocock-skills-deck</h1>

<div align="center">

**中文** · [English](docs/README.en.md)

**拨开战争迷雾看见终点，剩下的交给 MattSkillsDeck。**  
让 [mattpocock/skills](https://github.com/mattpocock/skills) 在 DSH 里化作游戏系统的任务面板。

你的 ⭐是我夜空中最亮的星。

*Part the fog of war, see the end — MattSkillsDeck handles the rest.*

[![版本](https://img.shields.io/npm/v/dsh-mattpocock-skills-deck?label=%E7%89%88%E6%9C%AC)](https://www.npmjs.com/package/dsh-mattpocock-skills-deck) [![下载量](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.npmjs.org%2Fdownloads%2Fpoint%2Flast-month%2Fdsh-mattpocock-skills-deck&query=%24.downloads&label=%E4%B8%8B%E8%BD%BD%E9%87%8F&suffix=%2F%E6%9C%88&color=brightgreen)](https://www.npmjs.com/package/dsh-mattpocock-skills-deck) [![下载总量](https://img.shields.io/npm/dt/dsh-mattpocock-skills-deck?label=%E4%B8%8B%E8%BD%BD%E6%80%BB%E9%87%8F&color=red)](https://www.npmjs.com/package/dsh-mattpocock-skills-deck) [![最近更新](https://img.shields.io/github/last-commit/FeatherHunter/dsh-mattpocock-skills-deck?label=%E6%9C%80%E8%BF%91%E6%9B%B4%E6%96%B0&color=FE7D37)](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/commits/main) [![月提交](https://img.shields.io/github/commit-activity/m/FeatherHunter/dsh-mattpocock-skills-deck?label=%E6%8F%90%E4%BA%A4%E6%95%B0&color=DFAB01)](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/graphs/commit-activity) [![技能包](https://img.shields.io/badge/%E6%8A%80%E8%83%BD%E5%8C%85-mattpocock%2Fskills-9D7CD8)](https://github.com/mattpocock/skills) [![欢迎提交PR🌹](https://img.shields.io/badge/%E6%AC%A2%E8%BF%8E%E6%8F%90%E4%BA%A4PR%F0%9F%8C%B9-red.svg)](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues)

<span style="color:red">欢迎提交PR，不要求完美无瑕，有缺陷也会在合入后进行优化而不是拒绝，星星之火🔥可以燎原！</span><br>
唯一要求：使用技能 /pr 填写PR信息。

</div>

<h2 align="center"><sub>INSTALL</sub><br>安装</h2>

```bash
# ① 安装 DSH CLI（已装跳过）
npm install -g @deepseek-ai/dsh

# ② 安装 MattSkillsDeck —— --profile 必填：装进你实际使用的 DSH 入口对应的 profile
#    （装错 profile 等于没装，重启多少次都不会加载）
dsh plugin --profile web add dsh-mattpocock-skills-deck     # 用自启 web 服务（dsh web）
#     或者
dsh plugin --profile desktop add dsh-mattpocock-skills-deck   # 用 DSH Desktop 桌面应用
# 锁定最新版更稳（当前 1.9.0-beta.9）：
dsh plugin --profile web add dsh-mattpocock-skills-deck@1.9.0-beta.9 --registry https://registry.npmjs.org
#     或者
dsh plugin --profile desktop add dsh-mattpocock-skills-deck@1.9.0-beta.9 --registry https://registry.npmjs.org
```

<h2 align="center"><sub>BOARD</sub><br>任务板</h2>

<div align="center">

把一整仓库的活装进一块随时能扫一眼的面板：地图、规格、票自动归位，每行都标着此刻该做的那一个动作，点一下指令就填进输入框，确认即发。

<table>
  <tr>
    <td valign="top">👇 单仓多票：可接、阻塞、已关闭自动归位，地图永远置顶<br><img src="assets/readme/中文-深色-右侧面板-列表-列表.png" width="400" alt="任务板列表：可接阻塞已关闭归位" style="border:1px solid #30363d;border-radius:6px"></td>
    <td valign="top">👇 多区并发：多个工作区、几十个会话同时跑，谁卡在哪一眼看清<br><img src="assets/readme/中文-深色-工作区-多ISSUE并发.png" width="400" alt="多工作区多会话并发" style="border:1px solid #30363d;border-radius:6px"></td>
  </tr>
</table>

<table>
  <tr>
    <td valign="top">👇 地图详情：可接与已结案分色铺满卡片墙，进度环直接给到第几格<br><img src="assets/readme/中文-深色-右侧面板-列表-Map详情.png" width="400" alt="地图详情卡片墙可接与已结案" style="border:1px solid #30363d;border-radius:6px"></td>
    <td valign="top">👇 单票详情：描述、验收、进度、评论全在面板里，回话不必跳终端<br><img src="assets/readme/中文-深色-右侧面板-列表-ISSUE详情.png" width="400" alt="单票详情描述验收进度评论" style="border:1px solid #30363d;border-radius:6px"></td>
  </tr>
</table>

</div>

<h2 align="center"><sub>STATUSBAR</sub><br>对话框胶囊栏</h2>

<div align="center">

离手最近的一条状态栏：可接、故障、诊断、沉淀、交接、环境一次报清，点一下直达对应面板；正在推进的会话路线也挂在上面，切换会话不用回翻聊天记录。

<table>
  <tr>
    <td valign="top">👇 一条胶囊装下可接、故障、诊断、沉淀、交接与环境进度<br><img src="assets/readme/中文-深色-胶囊状态栏-输入框区域.png" width="400" alt="对话框胶囊栏输入框区域" style="border:1px solid #30363d;border-radius:6px"></td>
    <td valign="top">👇 工作路线摊开：本会话在办什么、还有几十个会话在跑，一眼在列<br><img src="assets/readme/中文-深色-胶囊状态栏-WorkRoute.png" width="400" alt="工作路线浮层多会话处理中" style="border:1px solid #30363d;border-radius:6px"></td>
  </tr>
</table>

</div>

<h2 align="center"><sub>DEMAND</sub><br>新增需求</h2>

<div align="center">

想到什么，随手就是一张票：一键起需求，类型选好，带上下文的指令已经写好，确认即发，不再手打模板。

<table>
  <tr>
    <td valign="top">👇 右侧面板一点，弹窗里挑需求类型<br><img src="assets/readme/中文-深色-右侧面板-新增需求-选择弹窗.png" width="400" alt="右侧面板新建需求选择弹窗" style="border:1px solid #30363d;border-radius:6px"></td>
    <td valign="top">👇 胶囊上同样一点即建，手不离输入框<br><img src="assets/readme/中文-深色-胶囊状态栏-新增需求-选择弹窗.png" width="400" alt="胶囊状态栏新建需求选择弹窗" style="border:1px solid #30363d;border-radius:6px"></td>
  </tr>
</table>

</div>

<h2 align="center"><sub>SKILLS</sub><br>技能面板</h2>

<div align="center">

随包 27 个技能（快照 v1.3.1）装好即用，却不用背命令：技能页把每个技能压成一行中文说明，顶部直接给当下最该用的推荐，点「加载」斜杠指令自动填进输入框。完整名单与教程见 Matt 官方 [aihero.dev/skills](https://www.aihero.dev/skills)。

<table>
  <tr>
    <td valign="top">👇 一行一个技能，中文讲清什么时候该用它<br><img src="assets/readme/中文-深色-右侧面板-技能页面-列表.png" width="400" alt="技能页面列表一行讲清用途" style="border:1px solid #30363d;border-radius:6px"></td>
    <td valign="top">👇 点开详情看完整说明，确认无误再加载<br><img src="assets/readme/中文-深色-右侧面板-技能页面-详情.png" width="400" alt="技能页面详情完整说明" style="border:1px solid #30363d;border-radius:6px"></td>
  </tr>
</table>

</div>

<h2 align="center"><sub>BACKENDS · ENV</sub><br>多后端切换与环境检查</h2>

<div align="center">

面板不绑死一种存法：GitHub、本地 Markdown、GitLab 与无后端都能接，换跑道只换数据源，原数据留在原地、切回即见。开工前环境自检把缺的项一次列清，照提示补齐就能干。

<table>
  <tr>
    <td valign="top">👇 一条跑道随时换，切回来数据还在<br><img src="assets/readme/中文-深色-右侧面板-切换后端.png" width="400" alt="设置页后端选择器" style="border:1px solid #30363d;border-radius:6px"></td>
    <td valign="top">👇 环境自检逐项过，不通过的照提示补<br><img src="assets/readme/中文-深色-右侧面板-环境检查-列表.png" width="400" alt="环境检查列表" style="border:1px solid #30363d;border-radius:6px"></td>
  </tr>
</table>

</div>

<h2 align="center"><sub>VERSION</sub><br>版本管理</h2>

<div align="center">

日常提交的三个视角收进面板：改了哪些文件、提交历史长什么样、几棵树在并行，不必再切终端敲 git 命令。

<table>
  <tr>
    <td valign="top">👇 改动：这次改了哪些文件、各加删多少<br><img src="assets/readme/中文-深色-右侧面板-版本管理-改动.png" width="260" alt="版本管理改动" style="border:1px solid #30363d;border-radius:6px"></td>
    <td valign="top">👇 提交历史：落到哪次提交、提交信息是什么<br><img src="assets/readme/中文-深色-右侧面板-版本管理-提交历史.png" width="260" alt="版本管理提交历史" style="border:1px solid #30363d;border-radius:6px"></td>
    <td valign="top">👇 工作树：几棵树在并行、各自停在哪一步<br><img src="assets/readme/中文-深色-右侧面板-版本管理-worktree.png" width="260" alt="版本管理工作树" style="border:1px solid #30363d;border-radius:6px"></td>
  </tr>
</table>

</div>

<h2 align="center"><sub>APPEARANCE</sub><br>设置与外观</h2>

<div align="center">

面板长什么样由你定：设置页集中所有入口，调色板给每类标签配一套颜色，深浅主题下都一眼可辨。

<table>
  <tr>
    <td valign="top">👇 设置主页：所有入口一处收齐<br><img src="assets/readme/中文-深色-设置面板-主页.png" width="400" alt="设置面板主页" style="border:1px solid #30363d;border-radius:6px"></td>
    <td valign="top">👇 调色板：每类标签一种颜色，扫一眼就知道是什么票<br><img src="assets/readme/中文-深色-右侧面板-调色板-设置label颜色.png" width="400" alt="调色板设置标签颜色" style="border:1px solid #30363d;border-radius:6px"></td>
  </tr>
</table>

</div>

<h2 align="center"><sub>INIT FLOW</sub><br>初始化流程</h2>

<div align="center">

从空工作区到能开工，六步走完，不用查文档：选后端、确认注入、等 AI 执行，最后环境自检兜底。

<table>
  <tr>
    <td valign="top">👇 第 1 步：创建新工作区<br><img src="assets/init/中文-深色-1-创建新工作区.png" width="280" alt="第1步：创建新工作区" style="border:1px solid #30363d;border-radius:6px"></td>
    <td valign="top">👇 第 2 步：新建会话并选择后端<br><img src="assets/init/中文-深色-2-新建会话-选择后端.png" width="400" alt="第2步：新建会话并选择后端" style="border:1px solid #30363d;border-radius:6px"></td>
  </tr>
  <tr>
    <td valign="top">👇 第 3 步：选择后端为 GitHub<br><img src="assets/init/中文-深色-3-选择后端为github.png" width="400" alt="第3步：选择后端为 GitHub" style="border:1px solid #30363d;border-radius:6px"></td>
    <td valign="top">👇 第 4 步：点击确认后注入提示词<br><img src="assets/init/中文-深色-4-点击确认后-注入prompt.png" width="400" alt="第4步：点击确认后注入提示词" style="border:1px solid #30363d;border-radius:6px"></td>
  </tr>
  <tr>
    <td valign="top">👇 第 5 步：等待 AI 执行初始化<br><img src="assets/init/中文-深色-5-等待AI执行.png" width="400" alt="第5步：等待 AI 执行初始化" style="border:1px solid #30363d;border-radius:6px"></td>
    <td valign="top">👇 第 6 步：环境检测不通过时照提示补齐<br><img src="assets/init/中文-深色-6-环境检测页面-提示用户2项失败.png" width="400" alt="第6步：环境检测提示用户两项失败" style="border:1px solid #30363d;border-radius:6px"></td>
  </tr>
</table>

</div>

<h2 align="center"><sub>JOIN</sub><br>欢迎您加入我们</h2>

<div align="center">

非常欢迎提交PR、共同维护项目，现在迭代中很缺对markdown后端的开发和完善，Gitlab目前无人力开发。

</div>

<h2 align="center"><sub>THANKS</sub><br>致谢</h2>

<div align="left">

感谢每一位提交 Issue、PR 与参与讨论的朋友，是你们让这个插件一点点变好。

<!-- THANKS-TABLE-ZH-START -->
| 贡献者 | 致敬 | 贡献 |
| --- | --- | --- |
| [@pioneerAlone](https://github.com/pioneerAlone) | 🌹🌹🌹🌹🌹🌹 | [#234](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/234) [#274](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/274) [#298](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/298) [#645](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/645) [#273](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/273) [#316](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/316) |
| [@zhengcookie](https://github.com/zhengcookie) | 🌹🌹🌹🌹🌹 | [#960](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/960) [#1003](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1003) [#1160](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1160) [#1291](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1291) [#1005](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/discussions/1005) |
| [@Shimmernight](https://github.com/Shimmernight) | 🌹🌹🌹🌹 | [#277](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/277) [#106](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/106) [#275](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/275) [#287](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/287) |
| [@anupamme](https://github.com/anupamme) | 🌹🌹🌹 | [#727](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/727) [#728](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/728) [#1156](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/1156) |
| [@9agj](https://github.com/9agj) | 🌹🌹🌹 | [#992](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/992) [#993](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/993) [#994](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/994) |
| [@776317107](https://github.com/776317107) | 🌹🌹 | [#1375](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1375) [#1376](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/1376) |
| [@gzy31007](https://github.com/gzy31007) | 🌹🌹 | [#1272](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1272) [#1273](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1273) |
| [@qq1393950873-bit](https://github.com/qq1393950873-bit) | 🌹🌹 | [#970](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/970) [#974](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/974) |
| [@hyperion2144](https://github.com/hyperion2144) | 🌹🌹 | [#110](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/110) [#646](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/646) |
| [@arnold117](https://github.com/arnold117) | 🌹🌹 | [#574](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/574) [#575](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/575) |
| [@xiSage](https://github.com/xiSage) | 🌹🌹 | [#435](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/435) [#436](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/discussions/436) |
| [@angenet](https://github.com/angenet) | 🌹🌹 | [#262](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/262) [#295](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/295) |
| [@lilincen](https://github.com/lilincen) | 🌹 | [#1301](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/discussions/1301) |
| [@WDXXZH](https://github.com/WDXXZH) | 🌹 | [#1137](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1137) |
| [@Drayee](https://github.com/Drayee) | 🌹 | [#1101](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1101) |
| [@30892096](https://github.com/30892096) | 🌹 | [#1100](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1100) |
| [@fishke22](https://github.com/fishke22) | 🌹 | [#1000](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/1000) |
| [@jack2jiehua](https://github.com/jack2jiehua) | 🌹 | [#930](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/930) |
| [@asesr](https://github.com/asesr) | 🌹 | [#926](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/926) |
| [@SKADI0718](https://github.com/SKADI0718) | 🌹 | [#856](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/856) |
| [@li873582595](https://github.com/li873582595) | 🌹 | [#835](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/835) |
| [@zerocodefast](https://github.com/zerocodefast) | 🌹 | [#823](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/823) |
| [@seameafst](https://github.com/seameafst) | 🌹 | [#793](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/793) |
| [@SbDonger](https://github.com/SbDonger) | 🌹 | [#640](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/640) |
| [@snmtg1008](https://github.com/snmtg1008) | 🌹 | [#476](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/476) |
| [@dis0neplay](https://github.com/dis0neplay) | 🌹 | [#493](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/493) |
| [@tafcear](https://github.com/tafcear) | 🌹 | [#422](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/422) |
| [@21967201](https://github.com/21967201) | 🌹 | [#321](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/321) |
| [@271912980](https://github.com/271912980) | 🌹 | [#257](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/257) |
<!-- THANKS-TABLE-ZH-END -->

也感谢在评论区与讨论区留下想法的每一位朋友。如果你也遇到了问题或有新想法，欢迎直接提 Issue 或发起讨论。

</div>

<h2 align="center"><sub>CONNECT</sub><br>加入我们</h2>

<div align="center">

扫码加入话题群——二维码永久有效。日常闲聊与快速答疑走群里，Bug 与需求请直接提 ISSUE，更高效可追溯。

<img src="assets/qr-topic-group.png" width="280" alt="扫码加入话题群，dsh-mattpocock-skills 的组织">
<br>
<strong>加入话题群</strong>
<br>
<sub>dsh-mattpocock-skills · 该二维码永久有效</sub>

</div>

<div align="center">

<a href="https://featherhunter.github.io/dsh-mattpocock-skills-deck/star-history.html">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/docs/star-history-dark.svg?v=20261022" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/docs/star-history-light.svg?v=20261022" />
    <img alt="Star History Chart" src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/docs/star-history-light.svg?v=20261022" />
  </picture>
</a>

</div>

<h2 align="center"><sub>MORE</sub><br>作者的其他作品</h2>

<div align="left">

喜欢这个插件的话，这些可能你也用得上：

**[dsh-opencode-palette](https://github.com/FeatherHunter/dsh-opencode-palette)** —— 38 款 opencode 经典配色 + 20+自定义主题 一键换装 DSH。

**[dsh-prompt](https://github.com/FeatherHunter/dsh-prompt)** —— 经常反复重复的模板化提示词，存成自定义模板，选中后直接注入，不再需要耗费精力。

**[dsh-im-companion](https://github.com/FeatherHunter/dsh-im-companion)** —— 给 dsh-im 加了「助理」和「家」的概念。

**[ilife](https://github.com/FeatherHunter/ilife)** —— ⚠️建设中⚠️爱生活：居家生活套件，记账、运动、饮食、体重、食谱、物品管理、作息规划、备忘录等。

</div>
