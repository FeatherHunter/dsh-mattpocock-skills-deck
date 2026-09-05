# Matt Pocock Skills — Resources

> 本文档是本教学的唯一可信知识源。课中每一个断言都要能在这里找到出处。

## Knowledge — 官方与一手资料

- [站点：AI Hero — Skills 总览 https://www.aihero.dev/skills](https://www.aihero.dev/skills)
  官网总表：6 个分组、安装方式、变更新闻的权威入口。用于：全貌、分组、安装选型。
- [仓库：mattpocock/skills — README https://github.com/mattpocock/skills](https://github.com/mattpocock/skills)
  为什么做这些 skills（4 个失效模式）、安装双路径（Claude Code plugin vs skills.sh）、user-invoked vs model-invoked 定义。用于：动机、安装、心智模型。
- [Skill: setup-matt-pocock-skills](https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/setup-matt-pocock-skills/SKILL.md)
  配置 issue tracker / triage labels / domain doc 布局的 prompt-driven 流程。用于：第 1 课。
- [Skill: grill-with-docs](https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs)
  带文档产出的拷问访谈，同时驱动 domain-modeling 更新 CONTEXT.md 与 ADR。用于：主流程第 1 步。
- [Skill: to-spec](https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/to-spec/SKILL.md)
  不访谈、只综合；含 seams 确认与 spec 模板。用于：主流程第 2 步。
- [Skill: to-tickets](https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/to-tickets/SKILL.md)
  tracer-bullet 垂直切片、blocking edges、expand-contract 宽重构。用于：主流程第 3 步拆票。
- [Skill: implement](https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/implement/SKILL.md)
  驱动 /tdd、定期 typecheck、收尾 /code-review、落盘 commit。用于：主流程第 4 步。
- [Skill: wayfinder](https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/wayfinder/SKILL.md)
  超大迷雾任务的 map + decision tickets，frontier / blocking 原生渲染。用于：超大任务入口。
- [Skill: ask-matt](https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/ask-matt/SKILL.md)
  路由器：主流程 idea→ship、双 on-ramp、codebase health、vocabulary underneath。用于：选型总图。
- [Skill: tdd](https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/tdd/SKILL.md)
  red→green 循环、good test 定义、seams 事前约定、反模式。用于：implement 内部。
- [Skill: codebase-design](https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/codebase-design/SKILL.md)
  深模块词汇：module / interface / depth / seam / adapter / leverage / locality、deletion test。用于：架构讨论。
- [Skill: domain-modeling](https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/domain-modeling/SKILL.md)
  CONTEXT.md + ADR 的主动维护、挑战术语、场景锐化。用于：消除啰嗦。
- [Skill: diagnosing-bugs](https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/diagnosing-bugs/SKILL.md)
  先造 tight feedback loop，再复现-极小化-假说-埋点-修复-回归。用于：硬 bug。
- [Skill: improve-codebase-architecture](https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/improve-codebase-architecture/SKILL.md)
  热点扫描 → 可视化 HTML 报告 → grilling 选型。用于：日常架构体检。
- [Skill: code-review](https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/code-review/SKILL.md)
  双轴并行：Standards vs Spec，固定点 diff。用于：收尾审查。
- [Skill: research](https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/research/SKILL.md)
  后台 agent 读一手来源、落盘可引用的 md。用于：shadowing 任务。
- [Skill: prototype](https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/prototype/SKILL.md)
  逻辑 vs UI 双分支、throwaway、单文件可双击预览。用于：设计问题快速验证。
- [本地：本仓库的设计定稿 DESIGN.md / CONTEXT.md / docs/agents/*.md](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck)
  本仓库就是 mattpocock/skills 在 DSH 上的“游戏任务系统”实现：map + 任务栏、前端/宿主契约。用于：活例子对照。

## Wisdom (Communities)

- [Newsletter — Skills Updates https://www.aihero.dev/s/skills-newsletter](https://www.aihero.dev/s/skills-newsletter)
  官方更新、~60k 开发者，变更与新 skill 首发。用于：跟进 v1.2 / v1.1 变更。
- [GitHub Discussions — mattpocock/skills https://github.com/mattpocock/skills/discussions](https://github.com/mattpocock/skills/discussions)
  真实使用中踩坑与改法（editable fork 流派）。用于：实战智慧。

## Gaps

- 中文系统性教程几乎没有：多数为搬运官网；本教学填补“从安装到主流程跑通”的中文动手路径。
- /wizard、/to-questionnaire 等 productivity skills 的真实录屏案例少，需后续在演练中自产。
