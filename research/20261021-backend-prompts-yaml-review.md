# 对抗式审查：后端提示词该留 TypeScript 还是搬进 YAML

- 日期：2026-10-21。
- 审查对象：`research/20261021-backend-prompts-yaml.md`（下称「原报告」），它的结论是「不建议现在搬，维持混合方案」。
- 审查方式：从第一性原理重新提问，另起三路独立只读审查逐段核对，再自己复核一遍。下面每条判断都标了源码或文件出处。

## 0. 结论

原报告的数字与出处基本可信，但支撑「不搬」的三条论证里，两条不成立、一条被夸大。修正后的判断是：搬进 YAML 是可行的，运行时可以一行不改，代价约一两天；原报告把它写成「原理上不该搬、风险反而更大」，是把一个优先级判断说成了原理结论。

## 1. 原报告错在哪

### 1.1 「内容归属」判据有反例，而且是循环论证

原报告第 11-31 行立的判据是：文字里出现具体后端命令、站点名、接口形状，就是后端知识，只能留在 TypeScript；只剩结构与占位符，就进 YAML。这个判据在 YAML 侧直接有反例：

- 最重要的一条是报告自己引的样例。第 15 行说 `newBugWayfinder`「只留了 `{repo}` 一个占位符、不绑定任何一个后端」，引的是 `config/prompts/ticket-creation.yaml:1-10`；可这份模板第 10 行就写着「远端后端按原生标签方式打标签，本地 Markdown 后端在正文加标签行（例如 Labels: bug, needs-triage）」。同一份 YAML 里，模板自己按后端类型分支。
- 同类反例还有：`config/prompts/map-advancement.yaml:245`「本后端的原生父子关系」、`:320`「有的后端会按关键词自动关」、`config/prompts/ticket-creation.yaml:175`「create 时带 parentKey 或创后 setParent」。按报告第 13 行自己对「接口形状」的定义，这些都是后端知识，却都住在 YAML 里。
- 另一类反例不属跟踪器后端但同样证伪「YAML 只放中性内容」这句话：`config/prompts/repository-alignment.yaml:33`、`:41` 写死了 `npx -y skills@latest add mattpocock/skills -a cline -g --copy -y`、`https://github.com/mattpocock/skills`、`~/.agents/skills`。

判据不成立还不是最要命的，更要命的是报告用它做了循环论证：第 31 行「词汇本身就是后端」是用定义直接推出「词汇不该进 YAML」，中间没有独立证据。第 121-125 行更进一步，把「混合不是过渡状态，而是终态」当作结论宣布，而不是论证出来。第 49 行把 `src/tracker/rooms/github/index.ts:1-7` 文件头「prompts 字面量不可搬」的注释当成证据——那句注释的实际意思是「多道门禁按文件文本断言，搬了会红」，这是我们自己加的约束，不是设计理由，用它证明「不该搬」等于自己证明自己。

### 1.2 「运行时开放集合」是偷换：来源位置不等于运行期形态

原报告第 23 行说后端文案属于「运行时声明、开放集合」。事实正好相反，内置后端是构建期封闭集合：

- `src/tracker/registry/builtins.ts:32` 把 `BUILTIN_ROOM_IDS` 写死为 `github / markdown / gitlab`，`:50-61` 三个动态 import 与之一一对应。
- 宿主只注册这三个（`src/host/platformChannel.ts:192-194`）。全仓没有第三方后端的加载通路；`src/tracker/registry/core.ts:124` 的 `register` 只是公开 API，没有任何发现或读取外部模块的代码，开放只在类型层（`src/tracker/contract/identity.ts:27`）。
- 更关键的是逻辑上不相干：就算后端要到运行期才知道，文案的**来源**仍然可以是构建期生成的数据，运行时读到的还是模块对象上的 `prompts`。查表读的是内存里的模块对象数组（`src/client/kernel/prompts-backend.ts:53-63`），和这些字符串一开始写在哪个文件里没有关系。

于是原报告第 109-111 行的两条代价是伪代价：

- 「运行时解析会引入缺文件、解析失败、语言缺失三类降级」——只在你选择「运行期读 YAML」时才存在。用户提的方案（编译期进 TS）和最小迁移都是构建期生成，运行时零改动。仓库里已有两处同款先例：`src/client/kernel/prompt-data.ts` 是生成物（`.gitignore:61` 不入库）；时间配置的 ADR 更明确写了「三份 YAML 只活在仓库里，运行期没有任何代码读它们」（`docs/adr/20261016-time-config-yaml.md:70-74`）。
- 「国际化回退链要重写」——不用。值仍然是 `{zh,en}` 字典，`declaredLangPick` 照旧（`src/client/kernel/prompts-backend.ts:64-78`）。

### 1.3 「单一真源风险今天最小」与事实相反

原报告第 99 行说「命令行名只在后端声明一处写死，模板只引用占位符，改命令名只改一格」。这句对 `commandVocabulary` 成立，对 `ghAuthLogin` 不成立——同一件事今天有两份完整文案：

- YAML 那份：`config/prompts/repository-alignment.yaml:1-22`，五步手动流程，`{cli}` 由后端 `commandVocabulary` 填成 `gh`。
- 后端那份：`src/tracker/rooms/github/index.ts:146-149`，一句 `/wizard` 引导。
- 解析顺序是后端优先：宿主给修复动作附契约时就把 prompt 解析成终稿（`src/tracker/fix-contract.ts:85-95`、`:121-123`）；状态栏横幅先看后端声明、再落回模板（`src/client/statusbar/bannerChain.ts:149-160`、`:279`）；登录失败弹窗同样先后端后 YAML（`src/client/kernel/slotRenderer-modal-view.ts:222-236`）。

我复核后要把这事说得比审查员更准确一点：今天只有 GitHub 会触发 `gh:authed`（该检查只在 GitHub 房里声明，`src/tracker/rooms/github/checks.ts:38`），而 GitHub 自己声明了 `ghAuthLogin`，所以 YAML 那份在上述三条用户可见路径上全部被遮蔽。也就是说，用户永远看不到它，可它仍被门禁列为受保护条目（`tests/verify-prompts.ts:125`、`:136`），每次改登录指引都得改两处、否则两份继续漂移。这不是「风险最小」，这是已经在为双份付维护费，只是暂时没露出来。原报告第 115 行「今天只有两处，且模板那一处是空占位符」只对命令行词汇成立，`ghAuthLogin` 就是反例。

同一句话在安装指引上更站不住。那句「怎么装 gh」的真源住在 `src/tracker/rooms/github/index.ts:143`，可测试里还有三份逐字复制（`tests/verify-663-gh-install-inject.ts:25`、`tests/verify-665-fresh-workspace-chain.ts:46`、`tests/verify-issue195.ts:20`）；同一件事又各自写了一遍在 `src/tracker/rooms/github/init-project.ts:197` 与 `src/host/publishFlow.ts:163`。改一句安装指引，保守要同步 4 处字面量；要让口径一致，是 6 处。报告第 99 行「改命令名只改一格」只在命令行词汇这个字段上成立，在提示词正文里不成立——`gh` 也直接写在 `src/tracker/rooms/github/index.ts:143`、`:147` 的正文里。

## 2. 原报告站得住的部分

1. 门禁耦合是真的。S3 按文件文本抽 `export const prompts`（`tests/verify-prompts.ts:1327-1336`），L2 机械注入改的是后端源码（`:2086`、`:2103-2114`），受保护清单 45 条、键数 8/6/4、字面量 50/12/7、三处自锁哈希（`:2271-2275`）；另有一批按文件文本断言的锚点门禁（`tests/verify-deck-slots.ts:147-149`、`tests/verify-chain-renderer.ts:159-160`、`tests/verify-labels-sync.ts:53`、`:83`、`tests/verify-issue195.ts:14`、`:18`、`tests/verify-prompts.ts:2736`）。搬家确实要动这些锁。
2. 搬家不是零成本。GitHub 的 `prompts` 是立即执行函数，`ensureLabels` 用 `CANONICAL_LABELS` 拼出来（`src/tracker/rooms/github/index.ts:127-137`），生成期要插值，得先定 canonical 名单归 YAML 还是归共享常量（`src/tracker/contract/backend-module.ts:231`）。
3. 收益是编辑体验与校验统一，不是功能收益。18 个键、69 条字面量，规模不大；值不值得做取决于接下来改提示词的频率。
4. 「第三方后端会被迫跟进」这条今天不疼：没有第三方加载通路，契约层的开放只是类型层。
5. 「三处真源」不成立：终态是「中性模板 YAML + 后端 YAML」两处数据源，只有过渡期才会出现第三处（生成物）。

## 3. 代价重估

按「每后端一份 YAML → 构建期生成 TS → 三个房间各改一行 import」的最小路径估：

- 新增约 200-300 行：照 `scripts/lib/prompt-config.mts:154-206` 现成的读取与三形状校验（双语全文 / 词汇表 / 错误类目表）加一套后端 YAML 读取；在 `scripts/generate-prompt-config.mts:40` 旁加第二个产物。
- 改动约 30 行：S3 换读取路径（`tests/verify-prompts.ts:1247-1249`），抽取逻辑 `:1327-1336` 不动；L2 改读 YAML（YAML 探针通路 `:2101`、`:2117-2119` 已有）；自锁哈希机械重算；新产物在 `tests/verify-file-granularity.ts:59` 登记一行；`scripts/build.mts:1666-1678` 的生成顺序已经对，不用改。
- 运行时零改动，门禁强度不变：键数 8/6/4 与字面量 50/12/7 是内容量，搬家人不改内容，值不用重算；只需在 YAML 侧确认统计口径（块标量按一条算）。
- 量级：一两天。

## 4. 第一性原理的重新表述

原报告问的是「这段文字里有没有后端知识」，这是个分类问题，答了也推不出「只能以什么形式存在」。更有用的问法是四个：

1. 这段文字是内容，还是逻辑？三个后端的 `prompts` 都是纯文案与词表，是内容。
2. 它随后端变化吗？是，所以每个后端一份数据。
3. 它在运行期被读取吗？被读，但读的是内存里的模块对象，不是磁盘文件；所以构建期生成一份数据挂上去就够了，不必运行期解析。
4. 谁会改它、怎么验证？人和发布流程。所以 YAML 加生成器校验，比藏在 TypeScript 字面量里更容易改、也更容易验。

四条都指向同一件事：后端提示词可以以 YAML 为真源、构建期生成 TypeScript。真正值得守住的不变量只有两条：一个键只有一份文案（单一真源），运行期不解析配置文件。这两条与「后端模块对象持有 prompts」并不冲突。

按这个口径，今天的分工不是设计，是历史：`cliInstall` 从共享清单搬回后端（#716，注释在 `src/tracker/rooms/github/index.ts:139-145`），五份注册表模板从源码搬进 YAML（#1292）。同一类东西两种存法，编辑与校验不统一，这才是真实成本；原报告把它写成了「真源按知识归属分两处才是对的」。

## 5. 建议（按代价从低到高）

1. 先止血，与搬不搬无关：`ghAuthLogin` 的两份文案二选一——要么删掉 YAML 那份，要么让后端那份引用生成的同一份文字；再加一条门禁禁止同键双份。今天就该做。
2. 若目标是「扫一遍 YAML 就能改所有提示词」：每后端一份 YAML 加构建期生成 TypeScript，运行时不动，一两天。先搬 markdown / gitlab（无插值），再搬 GitHub 的 `ensureLabels`（要先定 canonical 名单归属）。动手前建议先单独立一张票拆掉 S3 的文本锚点：S3 逐字符扫 `index.ts` 的 `prompts` 块，L2 探针也锚在同一段文本上（`tests/verify-prompts.ts:44`、`:2103-2114`），不先拆，门禁重写会和搬数据搅在一起。
3. 若只想解决「找不到」、不想动存储：写一个检索脚本或文档索引（从 YAML 与三个房间 `prompts` 块里抽出键、文件、语言、用途），半天。也可以让构建期生成一份只读 catalog（键、正文首行、出处 `file:line`），只补可发现性、不动真源；代价是它一旦签入就多一个同步点，且抽取逻辑会和 S3 重复。

我的建议：先做第 1 条；第 2 条与第 3 条取决于接下来改提示词的频率——如果这条流水线还在频繁调文案，第 2 条值得。

## 6. 审查过程说明

三路审查的结论分别是：「内容归属判据不成立」；「搬家非零成本为真，但报告列的其余四条代价不成立或夸大」；「报告低估了动机——改一句提示词实际要动 4 到 6 处」。三路指向同一个修正方向：问题不在原理，在优先级与门禁耦合。

另有一处我复核后推翻了审查员的说法：审查员说检查页按钮仍会显示 YAML 版 `ghAuthLogin`，但宿主在附修复契约时已把动作 prompt 解析成终稿（`src/tracker/fix-contract.ts:121-123`），所以检查页注入的也是后端那句；据此把「两份都活着」改成了更准确的「一份被遮蔽」。其余事实均按上文出处逐条读过源码或文件。
