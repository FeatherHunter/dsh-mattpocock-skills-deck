# 后端特有提示词是否也该搬进 YAML：第一性原理研究报告

- 日期：2026-10-21（文件名日期 20261021）。
- 提问：GitHub 后端、不同后端是否各有一份 YAML，是否应把后端特有提示词也搬进 YAML。
- 结论先行：不建议现在搬，建议维持混合方案，也就是中性模板进 YAML、后端词汇与接线留在 TypeScript。这个结论不是恋旧，而是内容归属与渲染时机共同决定的，后文会把推导过程完整展开。
- **2026-10-21 对抗式审查后修订**：本文结论已被推翻并降级为优先级判断，见 `research/20261021-backend-prompts-yaml-review.md`。第 1.1 节判据有反例（模板 YAML 自己就按后端类型分支），第 1.2 节把「YAML 存储」和「运行期解析」混为一谈，第 3.2 节的运行期失败面与回退链代价是伪代价；「单一真源风险最小」与事实不符（`ghAuthLogin` 今天已有两份）。阅读本文时以审查报告为准。

## 1. 第一性原理：两把尺子决定放哪里

### 1.1 第一把尺子是内容归属

第一性问题是，这段文字里有没有只能由某一个后端才知道的知识。

如果一段文字里出现了具体的跟踪器命令、站点名字、接口形状、文件布局，那么它就是后端知识，它只能跟着后端走。举例来说，GitHub 房的 `commandVocabulary` 直接写着命令名是 `gh`、站点名是 `GitHub`（来源：`src/tracker/rooms/github/index.ts:134`），装命令的引导里写着官方地址是 `https://cli.github.com/`（来源：`src/tracker/rooms/github/index.ts:142-145`），登录引导里写着运行 `gh auth login` 再跑 `gh auth status` 确认（来源：`src/tracker/rooms/github/index.ts:146-149`），这些都是换一个后端就必须换掉的知识。

如果一段文字只讲结构和流程，而把易变的部分留成占位符，那么它就是中性模板，它适合进 YAML。举例来说，仓库对齐族的登录模板只写了请为本机完成 `{cliBrand}` 登录、在终端执行 `{cli} auth login` 这类结构，命令名和站点名都留成了 `{cli}` 与 `{cliBrand}` 两个占位符（来源：`config/prompts/repository-alignment.yaml:1-22`），安装技能模板只留了 `{probeList}` 与 `{probeCount}` 两个占位符（来源：`config/prompts/repository-alignment.yaml:23-44`），建单模板 `newBugWayfinder` 只留了 `{repo}` 一个占位符（来源：`config/prompts/ticket-creation.yaml:1-10`），这些都不绑定任何一个后端。

### 1.2 第二把尺子是渲染时机

第二性问题是，这段文字是在什么时候被选中的。

构建期生成的东西是封闭集合，条目数量固定，发布前就能全部算出来。通用模板属于这一类，它由生成器在构建时读 YAML、校验后写出产物，运行时只读那份产物（来源：`scripts/generate-prompt-config.mts:49-61`）。

运行时声明的东西是开放集合，当前是哪个后端要在调用那一刻才知道。后端特有文案属于这一类，它挂在每个后端模块对象的 `prompts` 字段上，调用时按 `backendId` 查表（来源：`src/client/kernel/prompts-backend.ts:53-63`），再按语言链取词（来源：`src/client/kernel/prompts-backend.ts:64-78`），最后把 `{subIssue}`、`{subject}`、`{cli}`、`{cliBrand}` 一起填进去（来源：`src/client/kernel/prompts-backend.ts:82-95`）。

### 1.3 判定准则

两把尺子合起来得到一条可以直接用的判定准则，文字表述如下。

第一，凡是文字里出现具体后端知识的，就留在后端 TypeScript 里，与后端模块对象同生共死，改后端必须能一次改完。第二，凡是文字里只剩结构与占位符的，就进 YAML，成为版本化、可校验的中性模板。第三，凡是两边都要用的名字，必须只在一处定义，另一处只引用，这就是后文要讲的单一真源问题。

用一句话复述就是，模板进 YAML 的条件是它不认识任何后端，后端词汇进 YAML 的条件是不成立的，因为词汇本身就是后端。

## 2. 主要来源精读：每一处关键结论的出处

### 2.1 通用模板真源：五族 YAML

通用模板的真源是 `config/prompts/` 目录下的五份族 YAML 再加一份语言清单，这个清单由生成器共用的路径表登记（来源：`scripts/lib/prompt-config.mts:202-206`），族名一共有五种，分别是工作区初始化、仓库对齐、地图推进、票面动作模板、建票入口（来源：`scripts/lib/prompt-config.mts:82-88`）。

模板登记表一共登记了二十八条模板，每条写明所属族与占位符表，新增模板只改这一处（来源：`scripts/lib/prompt-config.mts:153-188`），门禁里硬编码的条目数也是二十八（来源：`tests/verify-prompts.ts:90`），两边对不上就会判红，所以漏加或多加都会被发现。

片段登记表一共登记了三处片段，分别是建单引导语、建单默认接线、中性词汇兜底，它们按注入时机住在对应族的 YAML 里（来源：`scripts/lib/prompt-config.mts:190-200`），其中中性词汇兜底住在仓库对齐族里（来源：`scripts/lib/prompt-config.mts:192-200`），它的 YAML 形状是按占位符名字分层、每层再分中英（来源：`config/prompts/repository-alignment.yaml:61-67`），运行时整份按语言链查找（来源：`src/client/kernel/prompts.ts:149-151`）。

读取 YAML 时按登记表分流模板与片段，放错族会报错（来源：`scripts/lib/prompt-config.mts:223-265`），模板字段校验要求每条模板必须带版本号、占位符表、用途说明、中英正文，且占位符声明与正文出现必须一一对应（来源：`scripts/lib/prompt-config.mts:346-387`），语言清单校验要求默认语言必须存在、回退链必须无环（来源：`scripts/lib/prompt-config.mts:440-507`），这些校验在生成前会再跑一遍，不通过就抛错（来源：`scripts/generate-prompt-config.mts:49-54`）。

生成器的产物是写到 `src/client/kernel/prompt-data.ts` 的 TypeScript，文件头明确写着人手不改、改请改 YAML（来源：`scripts/generate-prompt-config.mts:57-61`），产物里带模板条目类型、片段形状、语言配置类型与模板编号联合类型（来源：`scripts/generate-prompt-config.mts:68-102`），并按族生成再合并成以编号为键的记录表（来源：`scripts/generate-prompt-config.mts:104-147`，具体行号以生成器版本为准），主流程支持 `--check` 比对，不一致就退出非零（来源：`scripts/generate-prompt-config.mts:173-206`，行号以生成器版本为准）。

### 2.2 后端特有文案：三个房间的 prompts 块

GitHub 房的文件头明确写着 `fixes`、`prompts`、`githubModule` 字面量留在本文件，多道产物门禁按文件文本断言，不可搬（来源：`src/tracker/rooms/github/index.ts:1-7`）。

GitHub 房的 `prompts` 块一共八个顶层键（来源：`tests/verify-prompts.ts:97`），块内字符串字面量总数是五十（含拼接续段，来源：`tests/verify-prompts.ts:107`），八个键分别是命令行词汇、补标签、装命令、登录引导、仓库修复、子议题接线、体检科目、错误类目（来源：`src/tracker/rooms/github/index.ts:127-191`），其中命令行词汇把命令名定死为 `gh`（来源：`src/tracker/rooms/github/index.ts:134`），装命令的原话注明是从共享清单搬回这里，因为装命令只跟 GitHub 有关（来源：`src/tracker/rooms/github/index.ts:139-145`），子议题接线注明原来的一整套直连命令已搬进契约层工具，这里只讲用哪个工具与参数是什么，一条裸命令都不留（来源：`src/tracker/rooms/github/index.ts:160-166`），体检科目注明总纲住在中性模板里，这里只交 GitHub 自己那一份，经总纲里的 `{subject}` 填空（来源：`src/tracker/rooms/github/index.ts:167-173`），错误类目一共十档，含属主不一致与兜底两档短文案（来源：`src/tracker/rooms/github/index.ts:174-189`），这些注释本身就是内容归属的第一手证据。

GitLab 房的 `prompts` 块一共六个顶层键（来源：`tests/verify-prompts.ts:97`），字面量总数是十二（来源：`tests/verify-prompts.ts:107`），六个键分别是命令行词汇、装工具修复、登录修复、仓库修复、子议题接线、体检科目（来源：`src/tracker/rooms/gitlab/index.ts:281-323`，行号以该文件版本为准）。

本地 Markdown 房的 `prompts` 块一共四个顶层键（来源：`tests/verify-prompts.ts:97`），字面量总数是七（来源：`tests/verify-prompts.ts:107`），四个键分别是命令行词汇、建图引导、子议题接线、体检科目（来源：`src/tracker/rooms/markdown/index.ts:325-350`，行号以该文件版本为准）。

三个后端模块对象都用满足契约的方式声明，GitHub 房把 `prompts`、`checks`、`fixes` 挂在模块对象上（来源：`src/tracker/rooms/github/index.ts:202-238`），契约允许 `prompts` 取三种形状，分别是多数词条用的中英全文、命令行词表用的命令名与站点名、错误类目用的按类目分的中英表（来源：`src/tracker/contract/backend-module.ts:221-231`），契约注释还写明后两种形状是为真实实现而保留的，只认中英全文会把真实现当场打红（来源：`src/tracker/contract/backend-module.ts:224-231`）。

### 2.3 渲染链：中性模板如何吃到后端词汇

客户端的模板表直接取生成物，词汇兜底直接取片段表里的中性兜底（来源：`src/client/kernel/prompts.ts:26-33`，行号以该文件版本为准）。

词汇解析函数先按语言链取中性兜底，再看当前后端有没有声明命令行词汇，有就覆盖，没有就回落到中性说法，整节永远不许把 `{cli}` 这类占位符原样注入会话（来源：`src/client/kernel/prompts.ts:146-170`）。

取正文函数按语言链取对应语言的正文，没人传值的那几个词汇名自动填中性说法，再做占位符替换（来源：`src/client/kernel/prompts.ts:171-187`）。

按后端渲染函数在调用时把三类占位符补齐，分别是子议题接线、体检科目、命令行词汇，其中体检科目文本里若还嵌着别的占位符，会再补一遍替换，免得把嵌套占位符原样注入会话（来源：`src/client/kernel/prompts-backend.ts:79-95`）。

这条链说明模板与后端是生产者与消费者的关系，模板只留空，后端只填空，中性兜底保证后端没声明时也不穿帮。

### 2.4 门禁：S1 与 S3 的断言差异

门禁头注释定义了八个扫描面与八条判定规则（来源：`tests/verify-prompts.ts:1-60`，行号以该文件版本为准），判定函数收到 `allowTracker` 才放行跟踪器命令，其余规则在任何面都判（来源：`tests/verify-prompts.ts:230-283`）。

注册表面的收集函数对每条模板的中文、英文、用途、占位符名逐项判定，并做三种展开与拆占位符拼装探测（来源：`tests/verify-prompts.ts:1263-1321`），其中允许跟踪器命令的键只有以 `github.` 开头的占位符值（来源：`tests/verify-prompts.ts:1263`）。

后端面的收集函数按文件文本抽出 `export const prompts` 块，再数顶层键数与字面量总数（来源：`tests/verify-prompts.ts:1327-1336`），只有 GitHub 面传放行，其余两面不放行（来源：`tests/verify-prompts.ts:1324-1326`），同一键内的字符串拼接合起来再判一次，防拆字藏命令（来源：`tests/verify-prompts.ts:1338-1355`）。

受保护清单覆盖全部扫描面的编号减去豁免，一个不漏（来源：`tests/verify-prompts.ts:117-133`），豁免登记条数硬编码为八（来源：`tests/verify-prompts.ts:115`），宿主常量数硬编码为一（来源：`tests/verify-prompts.ts:112`），这些数字都是防偷偷加豁免的锁。

机械注入面改成在注册表对象上改、再用 YAML 序列化器写探针文件，探针永远是合法 YAML，子进程红的原因一定是被判定抓住，而不是 YAML 写坏（来源：`tests/verify-prompts.ts:2018-2036`），跑完还要比真源摘要，真源一字不差才算过（来源：`tests/verify-prompts.ts:2046-2064`），夹具与门禁自身另有三处哈希自锁（来源：`tests/verify-prompts.ts:2168-2276`）。

## 3. 方案比较：维持现状、每后端一份 YAML、混合

### 3.1 方案 A：维持现状

方案 A 是今天的样子，中性模板住 YAML，后端特有文案住各后端的 `index.ts`，渲染时再拼起来。

构建链最简单，YAML 走生成器，后端走源码求值与文本扫描，两条路互不干扰（来源：`scripts/generate-prompt-config.mts:49-61` 与 `tests/verify-prompts.ts:1327-1336`）。

门禁改动量为零，已有锁全部有效，包括条目数、键数、字面量数、豁免数、自锁摘要（来源：`tests/verify-prompts.ts:90-115` 与 `tests/verify-prompts.ts:2271-2275`）。

运行时解析最直接，后端模块对象常驻内存，按编号查表即可（来源：`src/client/kernel/prompts-backend.ts:53-63`），不需要在运行时再装一遍 YAML 解析器，也不需要处理后端 YAML 缺失或写坏时的降级。

国际化回退链最清晰，中性模板走语言清单的回退链（来源：`scripts/lib/prompt-config.mts:440-507`），后端声明走按链取词，缺语言时用任意一份兜底，整节不许静默消失（来源：`src/client/kernel/prompts-backend.ts:64-78`），中性词汇兜底保证后端没声明时也不穿帮（来源：`src/client/kernel/prompts.ts:146-151`）。

占位符校验最完整，中性模板有声明与正文一一对应的校验（来源：`scripts/lib/prompt-config.mts:346-387`），后端占位符值有不许含换行的断言与三种展开判定（来源：`tests/verify-prompts.ts:1286-1317`）。

单一真源风险最小，命令行名只在后端声明一处写死，模板只引用占位符（来源：`src/tracker/rooms/github/index.ts:132-134` 与 `config/prompts/repository-alignment.yaml:8-14`），改命令名只改一格，模板一行都不用动。

### 3.2 方案 B：每后端一份 YAML

方案 B 是给每个后端各一份 YAML，例如 `config/prompts/backend-github.yaml` 这类，把八个、六个、四个键搬进去。

构建链会变复杂，生成器要么为后端 YAML 另写一套读取与校验，要么把现有五族模型扩展成二维（族乘以后端），而现有路径表与族类型都是按五族写的（来源：`scripts/lib/prompt-config.mts:82-88` 与 `scripts/lib/prompt-config.mts:202-206`），类型联合、占位符映射、产物形状都要动（来源：`scripts/generate-prompt-config.mts:68-109`）。

门禁改动量很大，条目数、键数、字面量数三处硬编码要重算（来源：`tests/verify-prompts.ts:90-107`），S3 的文本抽取要从读 `index.ts` 改成读 YAML（来源：`tests/verify-prompts.ts:1327-1336`），文件头那句不可搬的断言要删（来源：`src/tracker/rooms/github/index.ts:1-7`），机械注入的后端探针要从改后端源码改成改后端 YAML（来源：`tests/verify-prompts.ts:2103-2114`），三处自锁摘要要重算（来源：`tests/verify-prompts.ts:2271-2275`），漏一处就会红或放水。

运行时解析会引入新的失败面，客户端闭包要么在构建时把后端 YAML 也拼进去，要么在运行时按后端编号懒加载，后者需要处理缺文件、解析失败、语言缺失三类降级，而今天的后端查表是没有解析失败这一档的（来源：`src/client/kernel/prompts-backend.ts:53-63`）。

国际化回退链要重写，后端 YAML 若缺某门语言，是沿语言清单回退，还是沿后端 YAML 内的其它语言回退，需要新口径，而今天的口径是声明里任意一份兜底（来源：`src/client/kernel/prompts-backend.ts:64-78`）。

占位符校验要另起一套，后端 YAML 里的 `{subIssue}` 嵌套、`{cli}` 注入、`errorKinds` 按类目分表这三种形状，都不在现有模板校验里（来源：`scripts/lib/prompt-config.mts:346-387` 与 `src/tracker/rooms/github/index.ts:170-189`），新校验稍有遗漏就会出现渲染后才暴露的穿帮。

单一真源风险反而变大，命令名、站点名、接线工具名会在中性模板的占位符默认值、后端 YAML、后端 TypeScript 三处出现，改一处忘一处就会出现模板与后端对不上的情况，而今天只有两处，且模板那一处是空占位符（来源：`config/prompts/repository-alignment.yaml:61-67` 与 `src/tracker/rooms/github/index.ts:134`）。

还有一个容易被忽略的代价是第三方后端会被迫跟进，契约今天允许第三方只交模块对象、不交任何 YAML（来源：`src/tracker/contract/backend-module.ts:221-231`），改成 YAML 后，注册表要么强制要求每个后端都交 YAML，要么为缺 YAML 的后端保留 TypeScript 通路，结果是两条通路长期并存，维护成本翻倍。

### 3.3 方案 C：混合，也就是维持现状的准确说法

方案 C 与方案 A 的做法相同，但说法更准确，中性模板进 YAML，后端词汇与接线留 TypeScript。

构建链、门禁、运行时、回退链、占位符校验、单一真源六项与方案 A 完全相同，不再重复。

它比方案 A 多一句话，就是明确承认混合不是过渡状态，而是终态，后端知识本来就不该进中性模板的 YAML，真源按知识归属分两处才是对的。

## 4. 建议结论与最小可行迁移路径

### 4.1 建议结论

建议采用方案 C，也就是维持现状，并把文件头那句不可搬的注释保留为定案（来源：`src/tracker/rooms/github/index.ts:1-7`）。

理由有三句完整的话。第一，中性模板与后端词汇的变更频率与责任人不同，模板改的是流程与措辞，后端改的是命令与接线，放在一起只会互相绊脚。第二，渲染时机不同决定了存储不同，构建期能算完的东西进 YAML，调用时才知道的东西留在模块对象里，大一统的 YAML 并不能消灭运行时查表，只是把查表从读对象换成读解析后的 YAML。第三，门禁已经为今天的分工写了足量的锁，搬家要动锁，而锁一动就 Ortho 需要重审强度，收益只是目录看起来整齐，代价是整套判据重写。

什么情况下才值得重议搬家。只有当出现第四个后端，且三个后端的体检科目与接线文案出现大段重复，抽成中性模板能省下可观的重复时，才值得把重复的那一段抽成带更多占位符的中性模板，而不是把整个后端块搬进 YAML。换句话说，搬的单位应该是重复段落，而不是后端。

### 4.2 如果非要搬，最小可行迁移路径

如果未来仍决定搬，最小路径应按以下顺序走，每一步都是完整的一句话。

第一步，先冻结口径，明确后端 YAML 只装后端知识，不装中性模板，且第三方后端缺 YAML 时的行为是沿用模块对象还是判红，这一步不定，后面全是返工。

第二步，扩展共用读取核，在路径表里登记后端 YAML 路径，在模板编号表之外另立后端词条表，不复用模板编号联合类型（来源：`scripts/lib/prompt-config.mts:153-206`），后端三种形状的校验另写，不套用模板的版本与占位符校验（来源：`scripts/lib/prompt-config.mts:346-387` 与 `src/tracker/contract/backend-module.ts:221-231`）。

第三步，改生成器，让后端 YAML 生成独立的产物对象，不与模板记录表混在同一张表里，且产物文件头写明人手不改（来源：`scripts/generate-prompt-config.mts:57-61`）。

第四步，改契约，明确 `prompts` 字段的真源是 YAML 产物还是模块对象，二选一，不允许两处同时是真源（来源：`src/tracker/contract/backend-module.ts:221-231`）。

第五步，改客户端渲染链，让查表函数从读模块对象改成读产物，并保留中性兜底（来源：`src/client/kernel/prompts-backend.ts:53-95` 与 `src/client/kernel/prompts.ts:146-170`）。

第六步，改门禁，把 S3 的文本抽取从读 `index.ts` 改成读后端 YAML，把键数与字面量数的期望值按新真源重算（来源：`tests/verify-prompts.ts:97-107` 与 `tests/verify-prompts.ts:1327-1336`），把机械注入的后端探针改成改 YAML 对象（来源：`tests/verify-prompts.ts:2103-2114`），把三处自锁摘要重算（来源：`tests/verify-prompts.ts:2271-2275`），并全链跑通。

### 4.3 回滚点

回滚点只有一处，就是搬家前的提交。回滚时删掉后端 YAML，恢复 `index.ts` 里的字面量，恢复生成器与契约与渲染链，恢复门禁期望值与自锁摘要，然后全链跑通。因为门禁带自锁，任何只回滚一半的状态都会红，这恰好是回滚是否干净的验收信号（来源：`tests/verify-prompts.ts:2271-2275`）。

## 5. 未确认事项

- 第三方后端是否需要交 YAML，今天的契约没有要求，搬家后是否强制要求，还没有定论（来源：`src/tracker/contract/backend-module.ts:143-154`）。
- 后端 YAML 缺文件或解析失败时的运行时降级口径，今天不存在这个失败面，需要新定（来源：`src/client/kernel/prompts-backend.ts:53-63`）。
- 后端 YAML 缺某门语言时的回退口径，是沿语言清单回退还是沿后端 YAML 内其它语言回退，还没有定论（来源：`src/client/kernel/prompts-backend.ts:64-78`）。
- 体检科目与子议题接线在三个后端之间到底有多重复，本文只读了键名与 GitHub 全文，没有逐字统计重复率，若未来要抽重复段落，需要一次重复率实测。
- 宿主那一处常量是否也应进 YAML，本文没有展开，因为门禁口径是大于等于一，合法新增不判红（来源：`tests/verify-prompts.ts:108-112`），它与后端 YAML 是两个问题，不宜捆绑。
