<h1 align="center">dsh-mattpocock-skills-deck</h1>

<div align="center">

**中文** · [English](docs/README.en.md)

**拨开战争迷雾看见终点，剩下的交给 MattSkillsDeck。**  
让 [mattpocock/skills](https://github.com/mattpocock/skills) 在 DSH 里化作一块看得见、派得动的任务板。

你的 ⭐是我夜空中最亮的星。

*Part the fog of war, see the end — MattSkillsDeck handles the rest.*

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![npm](https://img.shields.io/npm/v/dsh-mattpocock-skills-deck)](https://www.npmjs.com/package/dsh-mattpocock-skills-deck) [![dsh-plugin](https://img.shields.io/badge/dsh-plugin-orange.svg)](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck) [![skills](https://img.shields.io/badge/skills-mattpocock%2Fskills-9D7CD8)](https://github.com/mattpocock/skills)

<img src="assets/panel-list-zh.png" width="640" alt="MattSkillsDeck 面板：任务列表、进度环与一键操作">

<strong>一块看得见、派得动的任务板。</strong>

**装它，30 秒。**

</div>

<h2 align="center"><sub>INSTALL</sub><br>安装</h2>

<div align="center">

前置要求：[DSH](https://www.npmjs.com/package/@deepseek-ai/dsh)（DeepSeek Harness）。在 DSH 里，你下指令、AI 干活；MattSkillsDeck 把这些活变成面板上的任务。

</div>

```bash
# ① 安装 DSH CLI（已装跳过）
npm install -g @deepseek-ai/dsh

# ② 安装 MattSkillsDeck —— --profile 必填：装进你实际使用的 DSH 入口对应的 profile
#    （装错 profile 等于没装，重启多少次都不会加载）
dsh plugin --profile web add dsh-mattpocock-skills-deck     # 用自启 web 服务（dsh web）
#     或者
dsh plugin --profile desktop add dsh-mattpocock-skills-deck   # 用 DSH Desktop 桌面应用
# 锁定最新版更稳（当前 1.7.12）：
dsh plugin --profile web add dsh-mattpocock-skills-deck@1.7.12 --registry https://registry.npmjs.org
#     或者
dsh plugin --profile desktop add dsh-mattpocock-skills-deck@1.7.12 --registry https://registry.npmjs.org

# ③ 窄屏更好用（可选）：better-sidebar 记得装进同一个 profile
dsh plugin --profile web add dsh-better-sidebar
dsh plugin --profile desktop add dsh-better-sidebar
```

<div align="center">

装完**重启一次对应的 DSH 入口**即生效：桌面应用完全退出并重开 DSH Desktop；web 服务重启 `dsh web` 后刷新页面。零配置。

</div>

<details>
<summary>窄屏更好用？配个 better-sidebar</summary>

推荐搭配 better-sidebar：在 VSCode 风格的侧边栏里并排查看列表与详情，体验更佳。

```bash
dsh plugin --profile web add dsh-better-sidebar
dsh plugin --profile desktop add dsh-better-sidebar
```

</details>

<details>
<summary>把安装交给你的 AI</summary>

复制下面这段发给你的 AI，它会读仓库、检查环境、按需安装：

```text
请帮我安装 DeepSeek Harness 插件 dsh-mattpocock-skills-deck（MattSkillsDeck）。
先读仓库 README：https://github.com/FeatherHunter/dsh-mattpocock-skills-deck
先确认我实际使用的 DSH 入口对应哪个 profile（DSH Desktop 桌面应用 → desktop；自启 web 服务 → web），把插件装进正确的 profile；
然后自行检查环境并按需安装（已装的跳过），完成后简要汇报结果。
```

</details>

<details>
<summary>免全局安装 / 更新不生效时怎么装</summary>

下面命令以 web profile 为例——**DSH Desktop 桌面应用用户请把所有 `--profile web` 换成 `--profile desktop`**。

```bash
# 给定最新版本号安装
dsh plugin --profile web add dsh-mattpocock-skills-deck@1.7.12 --registry https://registry.npmjs.org

# 免全局安装（想更稳，像上面一样锁版本）
npx --yes @deepseek-ai/dsh plugin --profile web add dsh-mattpocock-skills-deck

# 更新被静默忽略时，显式指定官方源
dsh plugin --profile web add dsh-mattpocock-skills-deck@latest --registry https://registry.npmjs.org
```

</details>

升级 · 卸载（desktop profile 用户把 `--profile web` 换成 `--profile desktop`）：

```bash
dsh plugin --profile web update dsh-mattpocock-skills-deck   # 升级
dsh plugin --profile web remove dsh-mattpocock-skills-deck   # 卸载
```

<details>
<summary>技能随包可用，无需手动 <code>npx skills add</code>（bundled 兜底）</summary>

本插件已随包内置 **mattpocock/skills 的 25 个技能**（快照 **v1.2.3**，见 `package/bundled-skills/VERSION`），装好即用，无需再执行 `npx -y skills@latest add mattpocock/skills` 或 `git clone`：

- **发现路径**：DSH 通过 `bundledSkillDir` 以 `rank 600（bundled 兜底）` 发现，随包消失（`dsh plugin remove` 后自动移除）；体积增量 ≤ 5 MB，已在 `verify-bundled-skills` 设硬门禁。
- **覆盖规则**：你在 `~/.agents/skills` 手装的同名技能以 `rank 500（user-agents）` 优先覆盖随包版本——团队可在仓库或用户目录自定义覆盖，始终以你的版本为准。
- **三态环境检查**：面板的 `skill:wayfinder / skill:setup-matt-pocock-skills / skill:ask-matt` 三项在“空 HOME → bundled 绿、有效 HOME → user 500 绿、无效名片 → 红牌 + 证据链”三种工作区下均已回归（见 `tests/verify-bundled-trio-matrix.js` 与 `docs/reviews/390-bundled-trio-matrix.md`）。
- **合规与同步**：随包分发保留 `MIT LICENSE（Copyright (c) 2026 Matt Pocock）` 于 `package/bundled-skills/LICENSE`；快照与 `src/shared/matt-skills.js` 单源一致，同步纪律为 `node scripts/sync-matt-skills.mjs --pin v1.2.3 --verify`（纯手动，不挂 prepare）。
- **默认零污染**：默认不写 `~/.agents/skills`；如需将技能复制进用户目录以便提交到 git，留待后续显式“复制到 ~/.agents/skills”按钮（需用户点确认才写，当前首版暂缓）。

> 首通道已绿：空 HOME 下 `ctx.skills.get('wayfinder')` 直接命中 bundled，无需在 `lightProbeReason` 回退分支再查 bundled（R1 结论，T3 回归已固化）。
</details>

<h2 align="center"><sub>WHY</sub><br>为什么要做 MattSkillsDeck</h2>

<div align="center">

Matt Pocock 的 [skills 套件](https://github.com/mattpocock/skills)里，wayfinder 非常强大：能画出一张地图，带你穿过迷雾，抵达终点。但是，**你脚下的每一步该如何走呢？**

MattSkillsDeck 在地图之上加了一层任务系统：

**一块看得见的任务板** —— 仓库里的 ISSUE 不再是流水账：MattSkillsDeck 把它们搬进 DSH 侧边栏，可接、阻塞、已关闭各归各位，进度环走到哪一格，一眼看清

**一个会干活的操作台** —— 每张任务卡本身就是按钮：诊断、修复、执行、新会话，点一下，AI 就去干活；干到哪一步、卡在哪里，卡上写得清清楚楚

地图管终点，MattSkillsDeck 管脚下。

<img src="assets/statusbar-zh.png" width="720" alt="DSH 底部任务栏">

<strong>DSH 底部的任务栏：可接、阻塞、沉淀、交接，全在这一条。</strong>

</div>

<h2 align="center"><sub>IN ACTION</sub><br>真机演示</h2>

<div align="center">

<img src="assets/issue-detail-zh.png" width="640" alt="ISSUE 详情页">

<strong>点开一个 ISSUE：描述、作者、一键新会话。</strong>

<img src="assets/issue-comment-zh.png" width="560" alt="面板内直接评论">

<strong>不动终端：在面板里直接评论、响应 ISSUE、跑诊断。</strong>

<img src="assets/statusbar-skills-menu-zh.png" width="480" alt="状态栏快捷入口">

<strong>状态栏最右侧：Matt 技能套件一键直达。</strong>

Matt 的 skills 官网（文档与教程）：[aihero.dev/skills](https://www.aihero.dev/skills)

</div>

<h2 align="center"><sub>FAQ</sub><br>常见问题</h2>

<details open>
<summary>更新之后还是旧版本？</summary>

这是 DSH 桌面端的 pnpm 供应链策略（`minimumReleaseAge`）导致的：刚发布的版本，几个小时内 `dsh plugin update` 和插件市场的「更新」按钮都会静默跳过。更新后请完全退出 DSH 再重开，按 Ctrl+F5 刷新页面；还没更新的话，显式指定官方源装一次：

```bash
dsh plugin --profile web add dsh-mattpocock-skills-deck@latest --registry https://registry.npmjs.org
```

</details>

<details>
<summary>不装 better-sidebar，窄屏能用吗？</summary>

能。任务列表在主面板，详情走右侧列；需要并排对照时再装 better-sidebar 就行。

</details>

<h2 align="center"><sub>ARCHITECTURE</sub><br>架构</h2>

<div align="center">

想看代码是怎么组织的？这份可交互架构图由 AI 生成，把整体结构、数据流与关键状态都画出来了，支持深色与浅色主题切换，也能导出为图片。

[在线预览（推荐）](https://featherhunter.github.io/dsh-mattpocock-skills-deck/architecture/MattSkills-architecture.html) · 本地克隆后直接打开 [`docs/architecture/MattSkills-architecture.html`](docs/architecture/MattSkills-architecture.html) 也能看，无需起服务。源数据在同目录的 `mattskills.architecture.json`，更多文字说明在同目录的 `*.md` 文件里。

</div>

<h2 align="center"><sub>DEVELOPMENT</sub><br>开发</h2>

改代码只改 `src/`；根目录的 `client.js`、`host.js` 与 `package/lib/` 都是构建产物，别手改。

```bash
node scripts/build.mjs      # 构建
npm run test:smoke          # 冒烟测试
npm run verify              # 契约验证
bash scripts/build.sh       # 构建 + 同步到已装的 DSH
```

构建 / 验证 / 同步 / 发布的完整流程见 [DEV-WORKFLOW.md](DEV-WORKFLOW.md)。

<h2 align="center"><sub>MORE</sub><br>作者的其他作品</h2>

<div align="center">

喜欢这个插件的话，这些可能你也用得上：

**[dsh-opencode-palette](https://github.com/FeatherHunter/dsh-opencode-palette)** —— 34 款 opencode 经典配色一键换装 DSH，即点即换，重启不丢

**[dsh-prompt](https://github.com/FeatherHunter/dsh-prompt)** —— Prompt 工具箱：24 条深度模板随手点，别再复制粘贴

**[dsh-chinese-skill-patch](https://github.com/FeatherHunter/dsh-chinese-skill-patch)** —— 让 DSH 直接用中文技能名：输入 /私 就能直达「私家大厨」，技能不必改英文名

---

有问题、有想法？[提交 ISSUE](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues)，或到 [讨论区](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/discussions)聊聊

个人作品，与 [mattpocock/skills](https://github.com/mattpocock/skills) 官方没有关系。
MIT © FeatherHunter

</div>

<h2 align="center"><sub>THANKS</sub><br>致谢</h2>

<div align="left">

感谢每一位提交 Issue、PR 与参与讨论的朋友，是你们让这个插件一点点变好。

[@pioneerAlone](https://github.com/pioneerAlone) — 反馈了 #298（details/better-sidebar 重复，附完整复现与截图）、#274、#234 等状态栏与健康检查误报，并提交了修复 PR #273、#316，感谢你让「重装后到处异常」的体感得以一次清爽修复 🌹

[@Shimmernight](https://github.com/Shimmernight) — 提交了 #277 等 Issue，以及 PR #287、#275、#106（toast 主题、命名修正、macOS 适配）

[@21967201](https://github.com/21967201) — 提交了 PR #321（完善 triage + wayfinder 标签文档）

[@angenet](https://github.com/angenet) — 反馈了 #295、#262 等 macOS 环境检测问题

[@hyperion2144](https://github.com/hyperion2144) — 反馈了 #110 等环境检查问题

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
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/docs/star-history-dark.svg?v=20260902" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/docs/star-history-light.svg?v=20260902" />
    <img alt="Star History Chart" src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/docs/star-history-light.svg?v=20260902" />
  </picture>
</a>

</div>