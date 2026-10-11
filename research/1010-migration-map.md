# 老路径到新路径的迁移映射表（怎么读、怎么用）

这是子任务 D 的产物，配对的两个文件：`research/1010-migration-map.json` 给机器读（供自动改路径），本文件给人读。表里的每一条都来自真实源码——老路径逐条打开确认存在，import 语句逐条抄自源文件，行号写在每条证据里；不是照着设计文档推出来的。

一句话说明它是干什么的：**deck 重构要把哪些文件搬到哪、每条 import 字符串要改成什么，这一份说全**，执行的人或脚本照单改完即可。

## 一、怎么用（三步，顺序不能换）

1. **先搬文件**：按 `modules` 一条一条搬并改名。`old` 是今天的位置，`new` 是搬到后的位置，`kind` 说明这条是搬家改名、还是拆分、还是只换扩展名。
2. **再改 import**：按 `specifiers` 一条一条改。每条写清「哪个文件里的哪条字符串」改成「什么」。`specifier` 是今天写的那串，`to` 是改完要写成的那串；**`to` 已经按文件的新位置算过层数**，照抄即可，不用自己数 `../` 有几层。
3. **最后批量扫类**：`rules` 是整类改写的做法（房间内部、房间到共享层、JSDoc 类型引用这几类），适合用查找替换或脚本一次过。

改完要跑的验证：`node scripts/build.mjs` 与 `npm run verify`。测试脚本里写死的旧路径不在本表内，另有一份清单：`research/1010-deck-blast-radius.md`（34 个测试文件）。

## 二、`specifiers` 与 `modules` 是什么关系

- `modules` 回答「文件去哪」；`specifiers` 回答「引用它的那行字改成什么」。两者互补，缺一个都改不完。
- `specifiers.from` 用的是**老路径**（改之前的样子），不是新路径——因为改 import 的人此刻手上拿的还是老文件。
- 一个文件搬了家，所有引用它的地方都要改；本表覆盖 22 个导入方、91 条字符串。条数最多的是四个文件：装配点 13 条、行模块 11 条、平台通道 8 条、接线 6 条，合计 38 条；其余分散在九个工具与宿主入口等处。
- 没有相对引用的搬家件（额度同步、沙箱两个文件）在 `modules` 里有、在 `specifiers` 里没有，这是正常的。
- 指向不搬家的目标（`src/shared/refresh/budget.js`、`tool-cost.js` 这些）单独放在 `unchangedSpecifiers` 里，是给执行者看的「这些别动」。

## 三、`kind` 四个取值

| 取值 | 意思 | 本表条数 |
| --- | --- | --- |
| `move-rename` | 搬家并改名（九个工具、共享十件、平台五件、两房、契约与注册表等） | 89 |
| `split` | 一个文件拆成多个（`plan.js` 拆成最小规范、装配口、工具顺序三件） | 3 |
| `stay-ext-change` | 位置不动，只从 JavaScript 转成 TypeScript（宿主入口、平台通道、接线等六件） | 6 |
| `path-only` | 只跟着父目录改名，代码不转写（GitLab 房 14 个文件） | 14 |

`plan.js` 那三条 `split` 的老路径相同（本就是同一个文件拆三处），其余老路径在本表里各自唯一。

## 四、这份表自己验过什么

生成完立刻做了一次自检（脚本临时写、跑完删），结论写在这里：

1. **落点解析**：91 条 import 的新写法，按各导入方的新位置逐条拼出绝对落点，全部命中 `modules` 里的新路径——0 条落空。这一步真抓出过两个错：两个识别层文件的层数我一开始写成不变，实际搬浅了一层，已改成少跳一层。
2. **老文件存在**：`modules` 里点名的老文件逐个确认在当前仓库里真实存在。
3. **老路径唯一**：除 `plan.js` 的三条拆分外无重复。

`json` 能被 `JSON.parse` 直接读通（Node 24 实测）；条数：模块 112、import 改写 91、批量规则 5、不动的引用 18、构建产物 25、手写映射 2、范围外 7。

## 五、构建自动产出的镜像（不要手改）

`buildGenerated` 一节列的是构建时自动生成的副本，跟着源码走，人不要动：

- `package/shared/deck-tools/` 十个文件——源码搬走后它们随构建清理消失，新产物路径由新构建布局决定。
- `package/lib/platform/` 五个 deck 文件、`package/lib/tools/` 九个工具文件，同理。
- 一句话：`package/` 整树都是构建产物，旧副本不需要手工删除。

## 六、手写映射：一处必须人改，一处待定

`manualOnly` 一节记了两条不跟构建走的地方：

1. **`package/package.json` 第 21 行**（必须改）：现在是 `"./tools": "./lib/platform/deckToolsRow.js"`。行模块搬到 `src/deck/registration/agent-row.ts` 之后，这一行是发包的对外出口，不改就断。**新值目前标 `needs-decision`**：它取决于绿色编译模型下这个文件的产物落点，构建布局定案后回填。
2. **`scripts/build.mjs`**（待定）：现在靠通用复制逻辑覆盖旧树；新树 `src/deck/**` 与 `src/tracker/**` 需要新增转译与投放步骤。本轮搜过，构建脚本里没有 deck 专属清单段落。

## 七、批量规则五条（`rules`）

1. 房间到共享层：`../../../../shared/` 改 `../../../shared/`（房间上移一层所致）。
2. 房间到 tracker 顶层：`../../preflight.js` 改 `../../preflight.ts`，`../../contract.js` 改 `../../contract/index.ts`（层数不变，只换目标与扩展名）。
3. 两房 JSDoc 里的 `import('../../contract.js')` 改 `import('../../contract/index.ts')`——转 TypeScript 后 JSDoc 类型由编译器读，不改会报错。
4. 房间内部相对引用 `'./x.js'` 改 `'./x.ts'`（文件名不变）。
5. `src/tracker/contract` 与 `src/tracker/detection` 内部相对引用同理只换扩展名。

第 1 条里两个房间的条数是抽样数（GitHub 房 20 处、Markdown 房 12 处），执行时以替换脚本的实测结果为准，标在此处是让人对量级有数。

## 八、本轮比影响面清单多找到的引用者（重要）

上一份影响面清单（`research/1010-deck-blast-radius.md`）只点了四个 `src/` 内部引用者，本轮全仓搜索又找出三处真实引用，已进本表：

- `src/host/platformChannel.js`：8 条。它装配注册表、三个房间与识别层，是房间搬家的最大外部调用方，上一份清单完全没提。
- `src/host/index.js` 第 137 行：动态引 GitHub 房 `client.js` 取超时常量。
- `src/host/issueDetail.js` 第 4 行：引 GitHub 房 `normalize.js`。
- `src/host/remotePredicates.js` 第 19 行：动态引 Markdown 房 `parse.js`。

这四处说明一件事：房间不是只有 deck 在用，面板那条线也在用同一批文件——这正是它们归 `src/tracker/` 而不归 `src/deck/` 的实证。

## 九、三处要维护者拍板的地方（我没有替人决定）

1. **契约入口的命名**：`contract.js` 搬进 `src/tracker/contract/` 后，本表给了 `index.ts`。因为文件夹已经叫 contract，再叫 `contract.ts` 会读成「contract/contract.ts」。备选是拆成 `operations.ts` 与 `types.ts` 两个文件——那是改结构，需要你定。
2. **注册表三件保留原名**：`registryCore.ts`、`registryShape.ts`、`registryViews.ts` 放在 `registry/` 目录里，前缀显得重复。本表采取保守做法（`src/tracker/**` 一律不重命名，只换扩展名），要顺手改名就另说一声。
3. **GitLab 房的理解**：任务说它「不动」，但它的父目录 `backends/` 要改名成 `rooms/`，所以它的物理路径必然跟着变。本表按「路径跟着变、代码一个字不转」处理，并附一条加 `MIGRATION-SLOT.md` 的要求；如果你的意思是它连目录都不挪，请回一句，我改成原样留在 `backends/` 下。

## 十、未核实与不在本表范围

- 未核实：`package/package.json` 出口的新取值、`scripts/build.mjs` 新步骤的落点、两房共享层引用的精确条数（抽样）。
- 不在本表：34 个测试脚本里的旧路径（见影响面清单）、`docs/` 与 `research/` 里的历史引用（只记录不改）、`src/host/tracker/` 下属检查链与谓词那一摊的五个文件（`capability`、`generic`、`predicateCore`、`predicatePrimitives`、`snapshot`，deck 调用链不经过，本次不动）。

## 十一、证据出处

- 结构依据：`docs/adr/20261011-deck-ts-rewrite.md`（新树、归属原则、编译模型）。
- 链路依据：`research/1010-deck-chain-dirs.md`（一次调用经过八层的目录表）。
- 影响面依据：`research/1010-deck-blast-radius.md`（测试与镜像那一批）。
- 语句依据：真实源码，本轮逐条读过；行号写在 JSON 每条 `specifiers.evidence` 里。
