# Mission: 用 Matt Pocock Skills 做真正的 AI 工程

## Why
我想把 https://www.aihero.dev/skills 上的 25 个 skills 真正用起来——不是背命令，而是能在自己的 AI 开发项目里，用正确的工作流把一个模糊的想法从“访谈→规格→拆票→实现→审查”完整地交付出去，产出符合自己标准的代码，而不是让 Agent 瞎写。

## Success looks like
- 能在任意新仓库 30 秒内完成 `setup-matt-pocock-skills`，并说清 issue tracker / triage labels / CONTEXT.md 选型的后果
- 给一个模糊需求，能自主跑通主流程：`/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement`（内含 TDD）→ `/code-review`，并在合适的岔路正确插入 `/prototype` / `/handoff`
- 遇到“需求堆积 / 难缠 bug / 超大迷雾任务 / 架构腐化”四种入口，能立刻选对 `/triage` / `/diagnosing-bugs` / `/wayfinder` / `/improve-codebase-architecture`
- 能用 `domain-modeling` 维护 `CONTEXT.md` 和 ADR，让 Agent 用 1 个词代替 20 个词来沟通
- 能判断一个 skill 是否适合 model-invoked，并会写出符合 `writing-for-agents` 标准的 agent 文档

## Constraints
- 以中文教学，保留 skill 原名（如 `/to-spec`）不翻译
- 每节课 10–15 分钟可完成，带可交互练习和即时反馈（不要纯阅读）
- 优先用本仓库 `dsh-mattpocock-skills-deck` 作为活例子演练

## Out of scope
- 不深入 Claude Code 插件市场底层实现、不写全新 skill 的发布流程（除非主流程掌握后有余力）
- 不展开所有 25 个 skill 的每一行参数，只抓“何时用、输入是什么、输出是什么、和谁衔接”
