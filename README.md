# 🧠 dsh-mattpocock-skills-deck

**🌐 [中文](README.md) · [English](docs/README.en.md)**

**拨开迷雾看见终点，剩下的交给任务栏 —— 把 [mattpocock/skills](https://github.com/mattpocock/skills) 变成 DSH 里的游戏任务系统（MattSkills）。**

*Part the fog, see the end — the task bar handles the rest.*

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-mattpocock-skills-deck)](https://www.npmjs.com/package/dsh-mattpocock-skills-deck)
[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-orange.svg)](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck)
[![skills](https://img.shields.io/badge/skills-mattpocock%2Fskills-9D7CD8)](https://github.com/mattpocock/skills)

![hero](assets/hero-zh.svg)

> 装它，30 秒。剩下的交给任务栏。

## 🚀 装它（30 秒）

三个命令分开复制 — 已装过的步骤直接跳过：

**① 安装 DSH CLI（仅首次 · 一次性）**

```bash
npm install -g @deepseek-ai/dsh
```

**② 前置推荐：better-sidebar（可选 · 已装可跳过）**

```bash
dsh plugin --profile web add dsh-better-sidebar
```

> 💡 面板在 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 的 VSCode 风侧边栏打开效果最好（并排看列表 / 详情）。不装也能用（右侧 details 列），只是窄屏体验略逊。

**③ 安装 MattSkills**

```bash
dsh plugin --profile web add dsh-mattpocock-skills-deck
```

**④ 或者：把安装交给你的 AI** —— 复制下面这段提示词发给你的 AI，它会读仓库、检查环境、按需安装（已装的自动跳过）：

```text
请帮我安装 DeepSeek Harness 插件 dsh-mattpocock-skills-deck（MattSkills）。
先读仓库 README：https://github.com/FeatherHunter/dsh-mattpocock-skills-deck
然后自行检查环境并按需安装（已装的跳过），完成后简要汇报结果。
```

![装完长这样 · 30 秒后的 DSH](assets/after-install-zh.svg)

刷新即生效，零配置 —— 剩下的交给 AI。

## 🎮 设计理念

Matt Pocock 的 skills 很强：wayfinder 先画一张 **map**，拨开迷雾、看到终点。但地图只告诉你终点在哪——路要一步一步走，每一步谁来推？

MattSkills 在 map 之上加了一层**任务系统**，把 skills 变成 DSH 里一套游戏式的操作台：

- **接任务** —— 地图上每个可推进的点都是「可接」任务，点一下接过来
- **推进一步** —— 完成一个子任务，进度圆环走一格，下一个任务自动浮现
- **随时存档** —— 卡住了标记「阻塞」；要离开就「沉淀」快照；回来或交接给同伴，上下文一点不丢

迷雾还在，但你已经有了地图和任务栏。

免全局安装：`npx --yes @deepseek-ai/dsh plugin --profile web add dsh-mattpocock-skills-deck`

升级 / 卸载：`dsh plugin --profile web update|remove dsh-mattpocock-skills-deck`

> **⚠️ 更新后仍显示旧版本？（DSH 平台问题，非本插件 BUG）**
> 这是 **DSH 桌面端**的 `pnpm` 供应链策略 `minimumReleaseAge` 导致——刚发布的新版本会被 `dsh plugin update` / 插件市场的“更新”按钮**静默忽略**（`pnpm update` 不报错但也不更新，需等待数小时）。**更新后请务必完全退出 DSH 再重开，并 Ctrl+F5 刷新页面**才能看到新版本（如 `v1.6.14`）。若刚发布后立即更新仍不生效，请显式执行：
> ```bash
> dsh plugin --profile web add dsh-mattpocock-skills-deck@latest --registry https://registry.npmjs.org
> ```
> 或等待数小时后重试。此为 DSH 平台行为，已实测复现（`pnpm update` → `Packages: -2` 仍 `1.0.0`；`pnpm add @1.6.14` → `Added 1` 才成功）。

![它是什么](assets/what-it-is-zh.svg)

> 非官方：本项目是 Matt Pocock Skills 的第三方配套工具，与 mattpocock/skills 无隶属关系。

## 📖 功能详解

![功能详解](assets/features-zh.svg)

完整使用说明见 [package/README.md](package/README.md)；设计定稿见 [DESIGN.md](DESIGN.md)；变更历史见 [CHANGELOG.md](CHANGELOG.md)。

## 🛠️ 开发（贡献者）

> 仓库只见 `src/` 为真源，`client.js`/`host.js`/`package/lib/*` 为构建产物（`npm run build` 生成，`gitignore`）。

```bash
# 1. 改 src/ 真源（永不手改产物）
# 2. 构建
node scripts/build.mjs          # 或 bash scripts/build.sh --no-sync
# 或 npm run build

# 3. 验证（冒烟 + 契约）
npm run test:smoke   # 4 项：client/host/dispatch/render（含面板/状态栏/tab 关键路径）
npm run verify       # 9 项：t3-locale/skill-tooltip/bug-entry/no-repo-redcard/kernel/leaves/ctx/parse-leaf/tabsfold-leaf

# 4. 同步到 DSH（若已装插件）
bash scripts/build.sh   # 构建 + 同步到 ~/.dsh/profiles/web/node_modules/dsh-mattpocock-skills-deck
```

详见 [DEV-WORKFLOW.md](DEV-WORKFLOW.md)（构建流 / 验证 / 同步 / 发布三段式）。

## 💛 作者的其他作品

喜欢这个插件的话，这些可能你也用得上：

[![dsh-opencode-palette](assets/other-palette-zh.svg)](https://github.com/FeatherHunter/dsh-opencode-palette)

[![dsh-prompt](assets/other-prompt-zh.svg)](https://github.com/FeatherHunter/dsh-prompt)

## License

MIT © FeatherHunter
