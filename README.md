# dsh-mattpocock-skills-deck

> **Matt Skills Deck** —— 非官方 DeepSeek Harness 插件：**Matt Pocock 技能套件（mattpocock/skills）的 DSH 控制面板**。

把 wayfinder 地图/票务/进度、triage / grilling / handoff 动作注入带进 DSH 右侧面板：
状态栏胶囊（可接/阻塞/沉淀/交接/环境/更新）、地图列表与详情（frontier/阻塞/进度）、技能雷达、环境检查（含 /setup-matt-pocock-skills 检测）、自动探测刷新（变化行高亮）、全量中英双语。

> 非官方：本项目是 Matt Pocock Skills 的第三方配套工具，与 mattpocock/skills 无隶属关系。
## 安装（一条命令）

```bash
# 需要 DSH CLI（首次）
npm install -g @deepseek-ai/dsh
# 安装到 profile
dsh plugin --profile web add dsh-mattpocock-skills-deck
```

或 npx（免全局安装）：

```bash
npx --yes @deepseek-ai/dsh plugin --profile web add dsh-mattpocock-skills-deck
```

安装后刷新浏览器页面即生效（bundle 装配 · 无 postinstall · pnpm v10 不拦截）。升级 / 卸载：

```bash
dsh plugin --profile web update dsh-mattpocock-skills-deck
dsh plugin --profile web remove dsh-mattpocock-skills-deck
```

## 前置依赖

- **Matt Pocock skills**（mattpocock/skills）：wayfinder / triage / grilling / handoff 等，环境检查页会检测安装状态并引导
- **GitHub 仓库工作目录**（wayfinder 地图所在仓库）+ gh CLI

## 作者的其他作品

喜欢这个插件的话，这些可能你也用得上：

- [**dsh-opencode-palette**](https://github.com/FeatherHunter/dsh-opencode-palette) —— 觉得 DSH 默认界面看腻了？34 款 opencode 经典主题，点一下就换。
- [**dsh-prompt**](https://github.com/FeatherHunter/dsh-prompt) —— 写 Prompt 卡壳的时候，里面有 24 条深度模板，点一下直接进输入框。

## 文档

- package/README.md — 完整功能/使用说明
- DESIGN.md — 设计定稿 · DEV-WORKFLOW.md — 开发流程
- CHANGELOG.md — 变更历史（含 dsh-waystation → 本仓库迁移记录）

## License

MIT © FeatherHunter
