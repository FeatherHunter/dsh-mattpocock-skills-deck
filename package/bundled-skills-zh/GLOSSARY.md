# 随包技能中文译名表

这份表是 `package/bundled-skills-zh/` 下所有中文译文的统一用词依据。翻译时先读它；同一份英文原文里的同一个固定说法，在所有技能里都按这里的译法处理。

译者如果遇到表里没有的说法，先按以下顺序处理：

1. 看同一篇英文原文的旧译文（`package/bundled-skills/<技能名>/SKILL.zh.md`），它已有的好译法优先沿用。
2. 旧译文也没有的，就用最平实的完整说法表达，不要造简称或比喻。
3. 把新译法和出处（文件 + 英文原词）报告给协调者，由协调者补进这份表；不要自己另立一套。

## 总则

### 不译的东西

下面这些原样保留英文，不翻译、不改大小写、不加中文括注：

- 技能名（`implement`、`wayfinder`、`code-review` 等）与调用写法（`/grill-with-docs`）。
- 命令、路径、文件名、目录名、环境变量、字段名、配置键、标签值、代码标识符。
- 代码块（三个反引号或三个波浪线包起来的块）里的全部内容，包括注释、模板、示例、占位符。中文译文的代码块要和英文逐字一致。
- 行内代码（反引号包起来的片段）。
- frontmatter 里的 `name`、`disable-model-invocation`、`metadata` 等机器字段。
- 工具名（Skill 工具、Bash、Read、Grep 等）、产品名（GitHub、GitLab、Linear、Mermaid、DSH 等）、缩写（ADR、PR、CI、YAML、HTML、API、UI、URL、HITL、AFK 等）。
- 链接目标与锚点里的英文部分；同一页内的锚点链接，要按中文译文的标题重新算锚点（见「格式硬规则」）。

### 中文译名总表

表中「说明」一栏写清楚这个词在技能语境里指什么，遇到近义词先看说明再决定用哪一个。

#### 技能与调用

| 英文 | 中文 | 说明 |
| --- | --- | --- |
| skill | 技能 | 指一个可供代理调用的技能；技能名本身保留英文。 |
| skill description | 技能描述 | frontmatter 的 `description`。 |
| invocation | 调用方式 | 技能被触发的方式。 |
| model-invoked | 模型调用式 | 代理能自己触发、其他技能也能调用。 |
| user-invoked | 用户调用式 | 只有人输入技能名才能触发。 |
| router skill | 路由技能 | 用来指路、告诉人该用哪个技能的技能。 |
| trigger / trigger word | 触发条件 / 触发词 | 让技能该被调用出来的情形。 |
| frontmatter | frontmatter | 文件开头两个 `---` 之间的元数据区，保留英文。 |
| argument-hint | argument-hint | frontmatter 机器字段，键名保留英文。 |
| reference / reference material | 参考资料 | 按需查阅的定义、规则、事实；与「步骤」相对。 |
| steps | 步骤 | 代理按顺序执行的动作。 |
| progressive disclosure | 渐进式披露 | 把内容沿信息层级往下推到指针后面，让文件顶层保持易读。 |
| information hierarchy | 信息层级 | 按代理多快需要某块内容排出的层级。 |
| co-location | 就近放置 | 把同一概念的定义、规则、注意事项放在同一处。 |
| sprawl | 篇幅蔓延 | 文档过长导致注意力被摊薄。 |
| completion criterion | 完成判据 | 判断某一步做完了的条件。 |
| premature completion | 提前收尾 | 还没真正做完就转向下一步。 |
| post-completion steps | 完成后步骤 | 当前步骤之后才会走的步骤。 |
| demand | 要求强度 | 一条要求逼出多少深入的工作。 |
| legwork | 跑腿活 | 需要亲自动手、费时费力的工作；例如替用户查事实。 |
| leading word | 引导词 | 一个已经在模型预训练里、代理边做边用来思考的紧凑概念。 |
| negation | 否定式 | 用禁止来表达要求；技能文档里应尽量写正面目标。 |
| pruning | 修剪 | 按相关性删减文档内容。 |
| relevance | 相关性 | 某一行是否还与文档要做的事有关。 |
| sediment | 沉积 | 一层层过时内容因为不敢删而堆积下来。 |
| no-op | 空操作 | 模型本来就会默认遵守、说了等于没说的指示。 |
| cache | 缓存 | 对某处查找结果的复制；查找很贵时才值得写进文档。 |
| single source of truth | 单一事实来源 | 同一个意思只保留一个权威出处。 |
| environment | 环境 | `package.json`、配置文件、目录结构、`--help` 输出等代码之外的事实来源。 |

#### 代理、会话与上下文

| 英文 | 中文 | 说明 |
| --- | --- | --- |
| agent | 代理 | 泛指执行任务的 AI；不要译成「智能体」。 |
| subagent / sub-agent | 子代理 | 由主代理起出来、在独立上下文里干活的代理。 |
| background agent | 后台代理 | 放出去查资料、主代理继续干活的代理。 |
| AFK agent | AFK 代理 | 无人值守、按简报自主干活的代理；AFK 保留英文。 |
| HITL | HITL | human in the loop，保留英文。 |
| session | 会话 | 一次连续的对话与工作过程。 |
| context | 上下文 | 代理当前能看到的材料。 |
| context window | 上下文窗口 | 模型一次能容纳的上下文容量。 |
| context pointer | 上下文指针 | 上下文里指向外部材料、并写明何时去够它的一条引用。 |
| context load | 上下文负载 | 常驻上下文的材料在每一轮花掉的词元与注意力。 |
| cognitive load | 认知负载 | 压在人身上的成本：有哪些文档、何时该用哪一份。 |
| compact | 压缩 | 把会话历史压缩成摘要。 |
| clear | 清空 | 清空上下文。 |
| context hygiene | 上下文卫生 | 让上下文保持在合适大小与质量的习惯。 |
| smart zone | 智能区 | 模型仍能锐利推理的上下文范围（约 150k 词元）；aihero 词典链接保留原样。 |
| harness | 运行环境 | 跑代理的那套工具与界面（Claude、Codex 等）；「环境」指工具与界面，不是程序运行时；不译成「马具」。 |
| design tree | 设计树 | 把设计选项一层层展开比较的树。 |
| spawn | 起 | 起一个代理或子代理；例如「起两个并行子代理」。 |
| delegate | 委派 | 把活交给子代理或后台代理去做。 |
| exploration subagent | 探查子代理 | 在代码库里摸清情况、只回报发现的子代理。 |
| implementer subagent | 实现者子代理 | 拿着任务说明真正动手改代码的子代理。 |
| merger subagent | 合并子代理 | 把各批次改动合到一起并解决冲突的子代理。 |

#### 流程、规格与工单

| 英文 | 中文 | 说明 |
| --- | --- | --- |
| flow | 流程 | 一条穿过若干技能的路径。 |
| main flow | 主流程 | 从想法到交付的主线。 |
| on-ramp | 上匝道 | 并入主流程的入口。 |
| phase | 阶段 | 一次会话里的一块工作（盘问、实现、验收等）。 |
| phase boundary | 阶段边界 | 两个阶段之间要决定继续还是拆开的点。 |
| standalone | 独立使用 | 不属于主流程、可以单独调用的技能或做法。 |
| idea | 想法 | 还没成形的方案。 |
| spec / specification | 规格说明（后文可简称规格） | 描述要做什么、为什么、怎么验收的文档。 |
| ticket | 工单 | 从计划或规格里拆出来的一张工作单元，会落到议题跟踪器上；不要只写「票」。 |
| issue | 议题 | 议题跟踪器上的 issue；与「工单」区分开。 |
| decision ticket | 决策工单 | 只产出决定、不产出交付物的工单。 |
| blocking edge / blocked by | 阻塞边 / 被谁阻塞 | 工单之间的先后依赖。 |
| blocker | 阻塞项 | 必须先行完成的工单。 |
| frontier | 前沿 | 当前已经可以推进的一批工单或问题；保持同一个译法。 |
| vertical slice | 垂直切片 | 一次穿过各层、能独立演示的一条窄而完整的实现路径。 |
| horizontal slice | 水平切片 | 只做某一层的切片；技能里通常是要避免的做法。 |
| tracer bullet | 曳光弹 | 先用最小完整路径探路、再逐步加厚的做法。 |
| wide refactor | 大范围重构 | 一次机械性改动横扫整个代码库的重构。 |
| mechanical change | 机械性改动 | 不改变行为、只改形式的批量改动。 |
| blast radius | 爆炸半径 | 一次改动波及的范围。 |
| expand–contract | 先扩展后收缩 | 先加新形式、迁移调用点、最后删旧形式的顺序。 |
| integration branch | 集成分支 | 多个并行批次汇合、统一验证的分支。 |
| call site | 调用点 | 调用某个函数或接口的位置。 |
| prefactor / prefactoring | 预重构 | 先做让后续实现变容易的整理。 |
| granularity | 粒度 | 工单或步骤拆得多粗或多细。 |
| acceptance criteria | 验收判据 | 判断一张工单是否做对的条件。 |
| scope creep | 范围蔓延 | 做了没有被要求的工作。 |
| out of scope | 不在范围内 | 明确排除在本次工作之外的内容。 |
| further notes | 补充说明 | 规格模板的最后一节。 |
| trade-off | 取舍 | 方案之间各让一步的选择。 |
| plan | 计划 | 要做什么的整体安排。 |
| progress | 进度 | 当前做到哪一步。 |
| monorepo | 多包仓库 | 一个仓库里装多个包；首次出现可括注 monorepo。 |
| single-context | 单上下文 | 整个仓库共用一份领域文档与词汇表。 |
| multi-context | 多上下文 | 一个仓库里按边界拆成多份上下文文档。 |
| request surface | 请求入口 | 外部需求进入仓库的入口；模板开关 "PRs as a request surface" 正文写作「PR 作为请求入口」，字面量保留行内代码。 |
| consumer rules | 使用规则 | 别的项目或代理使用本仓库时需要遵守的约定。 |
| seed template | 种子模板 | 用来起一个新仓库或新项目的模板。 |
| task graph | 任务图 | 把任务及其依赖画成一张有向图。 |
| handoff | 交接 | 把当前进展整理成材料，交给下一位接手的人或代理。 |
| handoff document | 交接文档 | 交接时写的结构化材料。 |
| wizard | 向导 | 一步步引导人完成只有本人能做的操作。 |
| upsert | 写入（有则更新、无则新建） | 对配置文件里某一项按「存在就改、不存在就加」的方式写。 |
| gold-plating | 镀金 | 超出要求多做、还自以为更周到的部分。 |
| institutional memory | 组织记忆 | 仓库长期积累的「为什么否决」等背景。 |
| deduplication | 去重 | 把重复出现的内容合并成一处。 |
| variance | 运行波动 | 同一过程在不同运行之间走出的路径差异。 |
| gist | 要点 | 一段材料的核心意思。 |
| claim（工单） | 认领 | 把一张未认领的工单接到自己名下开始干。 |
| store | 存储 | 长期存东西的地方；与「索引」相对（地图是索引，不是存储）。 |
| effort | 这项工作 | 一次寻路要完成的那件事；不译成「努力」。 |
| QA | 验收 | 阶段语境里指验收；命令示例 `/compact we're going to QA this area` 里的 QA 原样保留。 |
| child issue / sub-issue | 子议题 | 挂在父议题下的议题。 |
| child ticket | 子工单 | 从一张工单里拆出来、挂在它下面的工单。 |
| tool economy | 工具开销 | 用工具时消耗的时间、词元与判断力。 |
| guardrail | 护栏 | 防止改动滑出安全范围、但不改变功能的检查或约定。 |

#### 议题跟踪器与分诊

| 英文 | 中文 | 说明 |
| --- | --- | --- |
| issue tracker | 议题跟踪器 | GitHub、GitLab、Linear 或本地 Markdown 目录。 |
| tracker | 跟踪器 | 上面那个东西的简称。 |
| triage | 分诊 | 判断议题归类、优先级、下一步由谁处理。 |
| triage role | 分诊角色 | 五个规范标签背后的处理角色。 |
| triage label | 分诊标签 | `needs-triage` 等标签；标签值保留英文。 |
| agent brief | 代理简报 | 分诊时写在议题上的结构化说明，AFK 代理按它干活。 |
| brief | 任务说明 | 交给子代理的一段任务说明；与「代理简报」区分开。 |
| label | 标签 | 标签值保留英文。 |
| native blocking link | 原生阻塞链接 | 平台自带的阻塞关系。 |
| merge request / MR | 合并请求 | GitLab 的叫法；标题与字面量保留英文。 |
| pull request / PR | PR | 不强行翻译成「拉取请求」；正文里首次出现可写「PR（拉取请求）」。 |
| triage surface | 分诊入口 | 把 PR 也当作需要分诊的对象。 |
| needs-info template | needs-info 模板 | 缺信息时贴在议题上的模板。 |
| triage notes | 分诊备注 | 分诊时写下的记录。 |
| wayfinding operation | 寻路操作 | 在跟踪器上画地图、查地图、推进工单的操作。 |
| issue-tracker（配置文档名） | 保留英文 | 指仓库里那份 issue-tracker 配置文档；不译成「议题跟踪器」。 |

#### 代码库设计

| 英文 | 中文 | 说明 |
| --- | --- | --- |
| codebase | 代码库 | 一个项目的代码整体。 |
| architecture | 架构 | 模块、接口与依赖的整体形状。 |
| module | 模块 | 任何有接口和实现的东西，不限于文件或包。 |
| interface | 接口 | 调用方必须知道的一切：签名、不变量、顺序约束、错误模式、配置、性能特征。 |
| implementation | 实现 | 模块内部的代码主体。 |
| deep module | 深模块 | 小接口背后藏着大量行为的模块。 |
| shallow module | 浅模块 | 接口几乎和实现一样复杂的模块。 |
| depth | 深度 | 接口处能撬动多少实现；深模块的属性。 |
| leverage | 杠杆 | 调用方从深度里得到的好处。 |
| locality | 局部性 | 改动、缺陷、知识和验证集中在一处的性质。 |
| seam | 接缝 | 可以不改那里就能改变行为的位置；模块接口所在之处。 |
| adapter | 适配器 | 在接缝上满足某个接口的具体东西。 |
| port | 端口 | 接缝处定义的接口；只用于「端口与适配器」这个模式。 |
| external seam | 外部接缝 | 模块接口处的接缝。 |
| internal seam | 内部接缝 | 实现内部、只给自身测试用的接缝。 |
| boundary | 边界 | 只在明确指物理或组织边界时使用；作为架构术语时避免，用「接缝」或「接口」。 |
| caller | 调用方 | 调用模块接口的代码。 |
| test surface | 测试面 | 测试与调用方共同穿过的那个接口。 |
| testability | 可测试性 | 能否通过公开接口验证行为。 |
| invariant | 不变量 | 任何时候都必须成立的条件。 |
| error mode | 错误模式 | 出错时的表现方式。 |
| AI-navigable | 适合 AI 导航 | 代理容易找到、读懂、改动。 |
| deepening opportunity | 加深机会 | 把浅模块改成深模块的重构机会。 |
| design it twice | 设计两遍 | 起多个并行子代理，用不同约束各设计一版再比较。 |

#### 测试与调试

| 英文 | 中文 | 说明 |
| --- | --- | --- |
| test-driven development / TDD | 测试驱动开发 | 先写测试再写实现的做法。 |
| red–green–refactor | 红-绿-重构 | 先让测试变红、再让它变绿、然后重构的循环。 |
| test list | 测试清单 | 动手前先列出的待写测试。 |
| behavior | 行为 | 从使用者角度看功能做了什么。 |
| public interface | 公开接口 | 调用方与测试共用的接口。 |
| unit test | 单元测试 | 只测一个单元。 |
| integration test | 集成测试 | 跨模块、跨进程或跨网络的测试。 |
| end-to-end / e2e | 端到端 | 从用户入口一直测到结果。 |
| acceptance test | 验收测试 | 按验收判据验证功能。 |
| regression test | 回归测试 | 锁住已修缺陷、防止复发的测试。 |
| mock | 模拟 | 用可替换的对象代替真实依赖；行内代码里的 mock 保留英文。 |
| fake | 假实现 | 有真实行为、但走内存或简化路径的替代实现。 |
| stub | 桩 | 只返回固定结果的替代实现。 |
| stand-in | 替代实现 | 测试时代替真实依赖的东西。 |
| tautological test | 同义反复的测试 | 期望值是用与实现相同的方式算出来的，永远不可能失败。 |
| test double | 测试替身 | mock、fake、stub 的统称。 |
| feedback loop | 反馈回路 | 一条能快速告诉你是对是错的信号。 |
| tight feedback loop | 紧密反馈回路 | 快、确定、直接指向当前缺陷的反馈回路。 |
| goes red | 变红 | 测试或信号指向失败。 |
| goes green | 变绿 | 测试通过。 |
| flake / intermittent | 偶发失败 | 时好时坏的测试或缺陷。 |
| reproduce | 复现 | 让缺陷稳定出现。 |
| minimise | 最小化 | 把复现范围缩到最小。 |
| hypothesis | 假设 | 对缺陷原因的猜测。 |
| instrumentation | 插桩 | 临时加日志或观测点来定位问题。 |
| throwaway harness | 用完即弃的测试台 | 只用来复现和定位缺陷的最小运行环境。 |
| redact | 脱敏 | 去掉隐私与凭证后保留可排查的信息。 |
| crash dump | 崩溃转储 | 进程崩溃时留下的内存与调用信息。 |
| HAR file | HAR 文件 | 浏览器导出的网络请求记录。 |

#### 寻路、盘问与原型

| 英文 | 中文 | 说明 |
| --- | --- | --- |
| wayfinding | 寻路 | 在目的地不清楚时，先画地图、驱散迷雾的做法。 |
| wayfinder | 寻路技能 | 技能名保留英文；正文提到技能时写「`/wayfinder`」。 |
| map | 地图 | 议题跟踪器上的一张共享地图。 |
| chart the map | 绘制地图 | 把决定与未知画成地图。 |
| work through the map | 沿地图推进 | 一次解决一个工单，把迷雾推回去。 |
| destination | 目的地 | 这次寻路最终要到的地方。 |
| frontier | 前沿 | 已经可以问、可以做的事；与工单语境同一个译法。 |
| fog of war | 战争迷雾 | 还没看清、要先调查才能做决定的部分。 |
| decision | 决定 | 一个需要人拿主意的选择。 |
| plan, don't do | 先规划，不要动手 | 寻路阶段只产出决定，不产出实现。 |
| refer by name | 按名字指代 | 用名字引用决定与工单，而不是复制内容。 |
| grilling | 盘问 | 一轮轮追问，把方案里的含糊与假设逼出来。 |
| round | 轮次 | 盘问的一轮问题。 |
| interview primitive | 访谈原语 | 盘问最基本的动作：提问、等回答、再提问。 |
| prototype | 原型 | 用来回答一个设计问题的小程序；原型本身不是交付物。 |
| throwaway | 用完即弃 | 对代码写法的约束，不等于做完就删。 |
| primary source | 一手来源 | 最接近事实本身的材料；不要写成「主要来源」。 |
| secondary source | 二手来源 | 转述、总结一手来源的材料。 |
| branch | 分支 | 原型的两条路线（逻辑 / 界面），或 Git 分支；按上下文判断。 |
| logic prototype | 逻辑原型 | 用代码验证状态模型或算法。 |
| UI prototype | 界面原型 | 用页面验证交互与视觉。 |
| variant | 变体 | 同一界面的不同设计版本。 |
| switcher | 切换器 | 在多个变体之间切换的浮动控件。 |
| reducer | 归约器 | 用纯函数处理状态变化；首次出现可括注 reducer。 |
| state machine | 状态机 | 用状态与转移描述行为的模型。 |
| research | 调研 | 对着可信来源查一个问题，并把结论写成带引用的 Markdown。 |
| citation | 引用 | 指向来源的链接或出处。 |
| question | 问题 | 盘问、调研或地图条目里待回答的东西。 |
| answer | 答案 | 问题解决后记录下来的结论。 |
| resolve | 解决 | 把工单或问题处理完并记录答案。 |
| questionnaire | 问卷 | 一次问清需求、交给下一环节填写的结构化问题清单；技能名 to-questionnaire 保留英文。 |
| discovery questionnaire | 发现式问卷 | 目的是把未知与约束问出来的问卷。 |
| answer stub | 作答占位 | 问卷里预先放好的空答案位，等人或代理补全。 |
| sub-shape | 子形态 | 界面原型里同一形态的细分写法，例如「子形态 A」；A/B 作为固定标签保留。 |
| free-play | 自由操作 | 不按固定脚本、让人自己点着试的模式。 |
| guided walkthrough | 引导式走查 | 按固定步骤带着人走一遍的演示。 |
| scenario | 情景 | 演示或测试里的一段具体使用情形。 |
| shareable demo | 可分享的演示 | 能直接发给别人打开的演示页面。 |
| domain language | 领域语言 | 领域里的概念在代码与对话中的说法。 |
| primary affordance | 首要的操作入口 | 界面上最该被看见、最该被点的那个控件。 |
| method surface | 方法集合 | 一个对象或模块对外暴露的方法。 |
| Notes / Decisions so far / Not yet specified / Out of scope（地图小节名） | 保留英文 | 地图正文模板里的固定小节名；正文引用这些小节时同样保留英文。 |

#### 教学

| 英文 | 中文 | 说明 |
| --- | --- | --- |
| teaching workspace | 教学工作区 | 教一个主题时建在用户仓库里的目录。 |
| mission | 使命 | 用户为什么想学这个主题；`MISSION.md` 保留文件名。 |
| lesson | 课程 | 一份自包含、只教一件事的 HTML 产物。 |
| learning record | 学习记录 | 记录已经学会了什么、以后可能要修订的条目。 |
| reference document | 参考文档 | 课程压缩出来的速查材料。 |
| resource | 资源 | 用户可以去读、去看的一手来源。 |
| knowledge | 知识 | 可以陈述与提取的事实与概念。 |
| skill acquisition | 技能习得 | 通过练习把能力练出来，而不是只记住知识。 |
| fluency strength | 流畅强度 | 当下就能把知识提取出来的强度。 |
| storage strength | 存储强度 | 知识长期留存的强度。 |
| desirable difficulty | 合意困难 | 适当增加练习难度，反而让长期留存更好。 |
| retrieval | 提取 | 不看书、凭记忆把知识调出来。 |
| spaced repetition | 间隔重复 | 隔开时间反复复习。 |
| working memory | 工作记忆 | 当下能同时处理的信息量。 |
| zone of proximal development | 最近发展区 | 用户踮脚能够到的学习区间。 |
| component | 组件 | 可复用的教学零件，例如测验小部件、图示辅助工具。 |
| asset | 素材 | 教学素材；目录 `./assets/` 保留字面量，文中组件属于 assets。寻路与原型语境里指解决工单期间做出的草案、原型、调研材料。 |
| quiz widget | 测验小部件 | 课程里可交互的小测验。 |
| simulator | 模拟器 | 让用户动手试的可交互模型。 |
| notes | 笔记 | `NOTES.md` 保留文件名。 |
| supersede / supersession | 取代 | 后来的记录取代早先的记录。 |
| constraints | 约束 | 不能违反的现实条件。 |
| success looks like | 成功的模样 | 使命文件里描述达成状态的一节。 |

#### 领域建模与文档

| 英文 | 中文 | 说明 |
| --- | --- | --- |
| domain | 领域 | 业务或问题本身的范畴。 |
| domain modeling | 领域建模 | 把领域里的概念、关系与规则弄清楚并写下来。 |
| domain glossary | 领域词汇表 | 项目自己的 `GLOSSARY.md`。 |
| glossary | 词汇表 | 术语与定义的集合；文件 `GLOSSARY.md` 保留。 |
| ubiquitous language | 通用语言 | 团队与代码共用的一套说法。 |
| bounded context | 限界上下文 | DDD 里一个模型适用的边界。 |
| ADR / architecture decision record | ADR / 架构决策记录 | 记录一个架构决定及其理由；ADR 保留英文。 |
| decision | 决定 | 已经定下来的选择；与「问题」「选项」区分。 |
| alternative | 备选方案 | 被考虑过的其他做法。 |
| rejected framing | 被否决的说法 | 明确不采用的表述；术语表里用来防止滑回旧词。 |
| schema | 模式 | 数据结构；规格模板里的 `Schema changes` 一节译作「数据结构变更」。 |
| contract | 契约 | 接口或 API 对外承诺的行为。 |
| constraint | 约束 | 限制方案空间的条件。 |

#### 插件的本仓专有词

| 英文 | 中文 | 说明 |
| --- | --- | --- |
| bundled skills | 随包技能 | 插件随包携带、安装后可直接用的技能。 |
| bundled-skills / bundled-skills-zh | 保留英文 | 目录名、路径一律保留。 |
| sync | 同步 | 从上游仓库同步随包原文。 |
| pin | 固定版本 | 同步时钉住的上游版本。 |
| refresh | 刷新 | 重新读取或重建已缓存的东西。 |
| plugin | 插件 | 本插件本身。 |
| skill detail page | 技能详情页 | 界面上看技能描述与文件的地方。 |
| gate | 门禁 | 自动检查；本仓术语，保留「门禁」。 |
| deck | deck | 本插件界面与技能总览的统称，保留英文。 |
| DSH | DSH | DeepSeek Harness，保留英文。 |

## 格式硬规则

这些规则和术语一样，是硬要求；违反任何一条，门禁都会判红。

1. **文件与路径一一对应。** 英文 `package/bundled-skills/<技能>/<文件>.md` 的中文版在 `package/bundled-skills-zh/<技能>/<文件>.md`，路径完全镜像；不要新增、删除、重命名文件。
2. **frontmatter 结构不变。** 键的顺序与英文一致；`name` 原样；`description` 译成中文且不能与英文相同；`disable-model-invocation` 原样；`metadata` 等机器字段逐字照抄。`argument-hint` 的值译成中文（若英文是给人看的提示语）。
3. **标题层级序列完全一致。** 英文有几个几级标题，中文就逐一对齐，层级不能变。代码块外（以及 `<spec-template>`、`<local-ticket-template>` 这类伪标签模板内）的标题要译成中文；代码块内的标题原样保留英文。
4. **标题不译的例外只有两处**：`teach/SKILL.md` 的 `## \`NOTES.md\``（文件名）与 `wayfinder/SKILL.md` 讲「不在范围内」概念的那一节标题 `## Out of scope`（`/wayfinder` 的机器字面量）。其余标题都要有中文。
5. **代码块逐字一致。** 代码块的数量、类型标记（```markdown、```bash、```ts 等）、顺序和内部内容都要和英文完全相同。
6. **行内代码一个不能少。** 英文里出现过的每个反引号片段，在中文里都要出现，允许中文额外补充，不允许丢失。
7. **链接目标一致。** 指向其他文件或网页的链接目标原样保留；同一页内的 `#...` 锚点要按中文标题重算（小写、空格转连字符、去掉标点），并且锚点必须能在本页某个中文标题上解析到。
8. **数字与固定值一个不能少。** 正文里的阿拉伯数字（列表序号除外）、版本号、示例编号、时间、路径、命令、标签值，都要在中文里原样保留；英文列表项前手写的 `1.`、`2.` 如果中文用 Markdown 自动编号，也要保证渲染出的序号与英文一致。
9. **中英比例。** 去掉代码块与行内代码后，每一篇中文正文里汉字字数占「汉字 + 拉丁字母」的比例不低于 50%。英文原文正文本身不足 120 个字符的（例如 `grill-me`、`grill-with-docs` 这种整篇只有一句「调用 Skill 工具」的指针文件），这一条不适用——专有名词占大头，比例天然上不去。
10. **术语一致。** 这份表里有的词，一律按表里的译法；没有的，沿用旧译文里的好译法，并把新词报给协调者。
11. **规格七段标题逐字固定。** `to-spec/SKILL.md` 里那份规格模板的七个区块标题必须一字不差地写成：**问题陈述、解决方案、用户故事、实现决策、测试决策、不在范围内、补充说明**。本地 Markdown 后端的识别器（`src/tracker/body-parse.ts` 的 `SPEC_SECTION_TITLES`）按这几个中文字面量切块，改一个字中文规格正文就读不出区块；门禁会逐字校验。地图模板的五节标题（Destination、Notes、Decisions so far、Not yet specified、Out of scope）在代码围栏里，原样保留英文。

## 旧译文怎么用

`package/bundled-skills/<技能>/SKILL.zh.md` 是之前的本地译文，可以作为底稿：它的句子通顺、不少术语已经定下来。但这次要按出版标准重译，旧译文里以下问题必须改掉：

- `agent` 在部分文件里译成「智能体」，统一改成「代理」；`subagent` 统一「子代理」。
- `issue` 有时被译成「工单」，`ticket` 有时被译成「议题」，两者要按这份表分开。
- 有些数字、示例编号、列表序号在旧译文里丢了，要补回来。
- `wayfinder` 旧译文把 `#ticket-types`、`#work-through-the-map` 两个同页锚点按中文标题重算成了 `#工单类型`、`#沿地图推进`，这是正确做法，照做；`teach` 的 `#assets` 锚点没跟着「## 组件」重算，是坏的，要修。
- 旧译文里文学性过强、但不够准确或不够好懂的句子，改成平实、完整、专业的中文。

## 新增或修订术语

协作者发现表里缺词、或者某个译法明显不妥时，把「英文原词 + 出现位置 + 建议译法 + 理由」报告给协调者。协调者改这份表后，所有译文跟着对齐；不要各自改。

---

这份表随议题 [#1521](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1521) 建立并维护。
