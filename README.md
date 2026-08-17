# 🧠 dsh-mattpocock-skills-deck

**让 AI 不只是聊天，还能把事办成 —— [mattpocock/skills](https://github.com/mattpocock/skills) 技能套件的 DSH 控制面板（MattSkills）。**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-mattpocock-skills-deck)](https://www.npmjs.com/package/dsh-mattpocock-skills-deck)
[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-orange.svg)](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck)
[![skills](https://img.shields.io/badge/skills-mattpocock%2Fskills-9D7CD8)](https://github.com/mattpocock/skills)

![hero](assets/hero-zh.svg)

> 装它，30 秒。剩下的交给 AI。

## 🚀 装它（30 秒）

```bash
npm install -g @deepseek-ai/dsh        # 首次装 CLI
dsh plugin --profile web add dsh-mattpocock-skills-deck
```

刷新页面 → 右侧 details 列出现 **MattSkills** 面板，输入框上方出现状态胶囊（可接 / 阻塞 / 沉淀 / 交接 / 环境 / 更新）。打开任意 issue 行点「执行」，`/wayfinder` 技能命令自动进输入框 —— 剩下的交给 AI。

<details>
<summary>免全局安装 / 升级 / 卸载（点开）</summary>

- 免全局安装：`npx --yes @deepseek-ai/dsh plugin --profile web add dsh-mattpocock-skills-deck`
- 升级 / 卸载：`dsh plugin --profile web update|remove dsh-mattpocock-skills-deck`

</details>

## ✨ 它是什么

AI 会聊天，但活儿要有人盯。MattSkills 把 Matt Pocock 的工程技能接到 DSH 面板上，让 AI 按流程把 GitHub issue 干完：

- 🧭 **wayfinder 决策地图** —— map 全量落地、子票进度圆环、frontier / 阻塞 / 已关闭一目了然
- 🎯 **动作注入** —— 按标签四选一：诊断（/triage）/ 修复（/wayfinder）/ 讨论 / 执行（/wayfinder），统一带「从第一性原理出发 + 对抗式审查」引导句
- 📡 **技能雷达** —— 25 个技能推荐 / 列表 / 圆环，点击注入 /skill
- 🩺 **环境检查** —— 9 项前置检查，红黄绿分组，依赖链引导（gh CLI → 登录 → setup → 技能），一键处理
- 🤝 **交接** —— /handoff 时间戳模板 → 复述确认开新会话，上下文不丢
- 🌐 **全量中英双语** —— 面板跟随 DSH 界面语言

> 非官方：本项目是 Matt Pocock Skills 的第三方配套工具，与 mattpocock/skills 无隶属关系。

<details>
<summary>📖 功能详解（7 大模块 · 点开）</summary>

| 模块 | 说明 |
| --- | --- |
| 状态栏胶囊 | 输入区上方：可接 / 阻塞 / 沉淀（零丢失快照）/ 交接 / 环境 / 更新，点击直达对应视图 |
| 面板 · 列表 | issue 全列表（map 置顶 + 子票迷你圆环进度）、标签过滤 chips、阻塞筛选、已关闭折叠、行级动作 |
| 面板 · 技能 | 技能雷达（推荐 / 列表 / 圆环），点击注入 /skill |
| 面板 · 环境检查 | 9 项前置检查 + 一键处理 + 引导依赖链，完成自动勾选 |
| map 详情 | 顶部「执行」+ 任务状态走廊（可接 / 已认领 / 被阻塞 / 已关闭）、Decision / Fog / Out-of-scope 折叠 |
| 交接 | 第一击注入 /handoff 时间戳模板；第二击预填 /read + 复述确认并开新会话 |
| 自动刷新 | 变化行高亮、即时转圈反馈，无需手动刷新 |

完整使用说明见 [package/README.md](package/README.md)；设计定稿见 [DESIGN.md](DESIGN.md)；变更历史见 [CHANGELOG.md](CHANGELOG.md)。

</details>

## 💛 作者的其他作品

喜欢这个插件的话，这些可能你也用得上：

- [**dsh-opencode-palette**](https://github.com/FeatherHunter/dsh-opencode-palette) —— 喜欢 opencode 的配色？让 DSH 也穿上它 —— 34 款经典主题，眼睛舒服了，码字也开心。
- [**dsh-prompt**](https://github.com/FeatherHunter/dsh-prompt) —— 写 Prompt 卡壳的时候，里面有 24 条深度模板，点一下直接进输入框。

## License

MIT © FeatherHunter
