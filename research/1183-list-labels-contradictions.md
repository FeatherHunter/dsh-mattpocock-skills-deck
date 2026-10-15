# #1183 两处契约矛盾的核实笔记（只读调查，不改产品代码）

调查对象是 issue #1183《契约规格单补两处说明：list 是否带完整正文与评论、labels 空集的语义》。
调查方法只认一手来源：当前 HEAD 的源码、注释、门禁脚本、回执夹具。
下面引用的行号都是我亲眼读到的当前行号，建票时的旧行号凡有变化都另行注明。

## 第一条：list 是否该带完整正文与评论

### 当前契约原文（一共三处在说话，不止两处）

第一处是 `src/tracker/contract/operations.ts:110`，它是 `Tracker.list` 的文档：

> 列票（薄行，不带正文评论之外的展开；详细口径见 `ListFilter` 各字段注释）。

第二处是 `src/tracker/contract/contract-page.ts:30-34`，它说的是另一个操作 `listPage` 的 `items`：

> `items` 是薄片段的行数据，只带画成列表里一行用的字段。不带正文、不带评论。

第三处是 `src/tracker/contract/results.ts:138`，给 `PageResult.items` 的定性是薄片段，不带正文、不带评论，
与第二处完全一致。`src/tracker/contract/index.ts:38` 对 `listPage` 的一句话介绍也是薄片段，不带正文与评论，
口径同样一致。

### 关键澄清：两处说的是两个不同的操作

`operations.ts:110` 文档的是 `list`，`contract-page.ts:30-34` 文档的是 `listPage`。
把它们当成同一句话来对比，本身就是一次误读，引文的对比关系不成立。
但是 `operations.ts:110` 自己的措辞确实有歧义：它没有写顿号，
既可以断成薄行、不带正文和评论，也可以断成不带正文评论之外的展开，
也就是行里带着正文与评论、只是不带别的展开。两种断句的意思正好相反。

### 三个后端的实际行为：契约层的 list 都回完整行

GitHub 房的批量查询 `src/tracker/rooms/github/queries.ts:36-43`（`LIST_QUERY`）直接复用
`src/tracker/rooms/github/queries.ts:17-33` 的整票片段，里面含有 `body`（第 21 行）与
`comments(first:50)`（第 30 行），注释第 35 行写明过滤在内存完成。
归一 `src/tracker/rooms/github/normalize.ts:310` 原样保留 `body`，
`src/tracker/rooms/github/normalize.ts:296-318` 原样保留 `comments`。
`src/tracker/rooms/github/issues.ts:145-169` 的内存过滤只筛状态、类型、父子、编号、拉取请求，
全文件没有任何删掉正文与评论的语句，我用删除与薄行两个关键字查过，是零命中。
结论：GitHub 房的 `list` 回完整正文与完整评论。

GitLab 房的列票 `src/tracker/rooms/gitlab/issues.ts:128-160` 按页拉远端数组，
`src/tracker/rooms/gitlab/issues.ts:159` 逐行归一，
`src/tracker/rooms/gitlab/normalize.ts:321-325` 把远端的 `description` 留作正文，
`src/tracker/rooms/gitlab/normalize.ts:355` 与第 315、363 行把评论留下来，
没有任何薄化步骤。结论：GitLab 房的 `list` 同样回完整正文与评论。

本地 Markdown 房的 `src/tracker/rooms/markdown/issues-read.ts:210-257`（`listIssues`）
走 `enumerateIssueRows` 逐文件解析后只做过滤与排序，全程没有薄化。
解析器 `src/tracker/rooms/markdown/parse.ts:316` 把整份文件原文留作正文，
`src/tracker/rooms/markdown/parse.ts:235-274` 解析评论段。
结论：Markdown 房的 `list` 也是完整行。

真正的薄化发生在另外两层。分页操作 `listPage` 在 Markdown 房由
`src/tracker/rooms/markdown/page.ts:57-66` 的 `thinRow` 删掉正文与评论，
在 GitHub 房由 `src/tracker/rooms/github/page.ts:13-14` 注明的薄片段查询完成，
GitLab 房的 `src/tracker/rooms/gitlab/pages.ts:215-230` 逐行归一后按页返回。
而用户摸到的 `deck_issue_list` 工具在
`src/deck/tools/issue-list.ts:185-196` 自己拼出不含正文与评论的薄行，
它的对外介绍 `src/deck/tools/issue-list.ts:31` 也写明薄行不回正文与评论。
顺带一个反证：该工具 `src/deck/tools/issue-list.ts:181-183` 用标题加正文做子串过滤，
它必须依赖契约层 `list` 回正文，否则按关键词过滤在远端后端上只剩标题可查，
所以契约层 `list` 不能改薄，只能把文字改准。

### 门禁与回执钉住了哪一层

`tests/tracker-contract/sections/listPage.js:394` 钉住 GitHub 分页查询不取正文与评论，
`tests/tracker-contract/sections/listPage.js:396` 钉住分页行给正文空值与空评论数组而不是省略，
`tests/tracker-contract/sections/listPage.js:407-408` 钉住非空标签原样透传。
`tests/verify-deck-tools.js:171-175` 钉住 `deck_issue_list` 只回薄行。
金标准回执 `tests/tracker-contract/fixtures/golden-receipts/03-deck_issue_list.golden.json`
是工具层形状，行里本来就没有正文与评论两格。
`tests/verify-contract-types.ts` 与本条无关，全文件只有
`tests/verify-contract-types.ts:163` 一处提到标签，还是关于视图配色错误文案的，
没有钉住任何行形状语义。
也就是说，门禁钉住的是分页与工具层的薄，契约层 `list` 回完整行这件事没有门禁背书，
属于三后端一致、但文字没写明的实际行为。

### 历史沿革

薄行措辞是 `3d788c9a` 新建 `src/tracker/contract/operations.ts` 时带入的，
此前契约住在旧目录的 JSDoc 版里。`280b889e` 新建 `deck_issue_list` 薄列表工具，
`a4145d41` 给快照加薄行。没有哪次提交修好过本条所说的矛盾，因为引文对比的本来就是两个操作。

### 第一条的小结

引文声称的两处措辞对立不存在，理由是它们文档的是两个操作：`list` 回完整行是三后端一致的实际行为，
`listPage` 回薄片段是契约、实现、门禁三处一致的实际行为。
真问题只有一个，是 `operations.ts:110` 的措辞歧义：缺一个顿号，两种断句意思相反，
而且薄行两个字与三后端实际回完整行的行为对不上。
处理建议是以实际行为为准，只动契约文字：把 `operations.ts:110` 改写成完整句，
写明 `list` 回完整行（含正文与评论），除正文评论外不带其他展开，
并点名它与 `listPage` 薄片段的区别。后端行为、能力登记、金标准回执都不用动。
金标准不受影响的理由是金标准收的是工具层回执，那一层本来就是薄的。

## 第二条：`labels: []` 的语义

### 契约里确实还有一句自相矛盾的话

`src/tracker/contract/inputs.ts:38-41` 写明空数组与省略不同，
省略是不过滤，空数组是一个标签都不带。这句话当前仍然存在。
而 issue 引文的另一半 `src/tracker/contract/index.ts:270` 已经过期：
当前第 270 行只说计数按标签筛走 GraphQL 的 `filterBy`，是这些都要有的语义，
全文件用恒真、空集、空数组三个关键字能搜到的只有
`src/tracker/contract/README.md:41-42` 的通用空值说明与 `inputs.ts:40` 本身，
契约文字里已经没有空集恒真这句话。

### 空集恒真住在实现里，三后端口径一致

Markdown 房 `src/tracker/rooms/markdown/issues-read.ts:201-208` 的 `hasAllLabels`
在要求为空时直接回真，`src/tracker/rooms/markdown/issues-read.ts:186-198` 的 `labelsOf`
把空数组归一成空，`src/tracker/rooms/markdown/issues-read.ts:250-251` 仅在非空时筛，
`src/tracker/rooms/markdown/counts.ts:86-91` 复用同一对函数
（`src/tracker/rooms/markdown/counts.ts:49-50`），分页
`src/tracker/rooms/markdown/page.ts:105-108` 也是仅在非空时筛。
GitHub 房计数 `src/tracker/rooms/github/counts.ts:90-98` 与分页
`src/tracker/rooms/github/page.ts:132-143` 都是仅在标签非空时才换用带标签筛的查询，
`src/tracker/rooms/github/queries.ts:55-56` 的注释写明不敢传空数组的原因是
各版本远端对空数组的行为不一致。GitHub 房列票的内存过滤
`src/tracker/rooms/github/issues.ts:145-169` 根本没有标签这一项。
GitLab 房计数 `src/tracker/rooms/gitlab/counts.ts:155-162` 与分页
`src/tracker/rooms/gitlab/pages.ts:175-182` 都是仅在非空时设标签参数，
列票 `src/tracker/rooms/gitlab/issues.ts:128-160` 既不向远端传标签也不在内存里筛。
`deck_issue_list` 工具 `src/deck/tools/issue-list.ts:171-176` 仅在非空时筛标签，
它的参数说明 `src/deck/tools/issue-list.ts:37` 写的是缺省不过滤。
结论：三个后端加一层工具在实际行为上完全一致，空数组等于不过滤，
与 `inputs.ts:40` 一个标签都不带的文字直接对立。

### 实现自己承认矛盾还没定

`src/tracker/rooms/markdown/issues-read.ts:183-185` 的注释白纸黑字写着契约对这一格有两句互相矛盾的话，
点名一处是 `contract/inputs.ts` 的一个标签都不带，另一处是空集恒真，
并写明按 #1174 先复现、复现出来再定，今天维持两房一致的老行为。
这是一手来源里对本条矛盾 Acknowledged 的直接证据。
历史提交上，`186865a0` 引入一个标签都不带的说法，
`71cca385` 补齐 Markdown 房时留下这段承认矛盾的注释，
之后没有任何提交改过 `inputs.ts:40`，矛盾至今有效。

### 门禁与回执都没有钉住空数组语义

`tests/tracker-contract/sections/counts.js` 全文件只有一个与标签相关的 import，
没有任何空数组断言。`tests/tracker-contract/sections/listPage.js:407-408` 只钉住非空标签透传，
空数组走哪条查询没有断言。金标准 `03-deck_issue_list` 调的是无标签过滤，
钉不住本条。`tests/verify-contract-types.ts` 与本条无关。
结论：今天传 `labels: []` 会得到什么行为，全靠各实现的巧合一致，没有任何机器判据守着。

### 第二条的小结

这是真问题，而且引用的一半已经过期：`inputs.ts:40` 的说法还在，
`index.ts:270` 的说法已经不在契约文字里，空集恒真只活在实现代码里。
处理建议是以实际行为为准，把文字改向行为，而不是把三后端行为改向文字。
理由有三：三后端加工具层四处一致都是空等于不过滤；
`deck_issue_list` 对外承诺缺省不过滤，改行为会连带改工具语义；
`queries.ts:55-56` 作证往远端传空数组本身不可靠。
要动的是两处文字：`src/tracker/contract/inputs.ts:40` 改成空数组与省略同样表示不过滤，
`src/tracker/rooms/markdown/issues-read.ts:183-185` 的矛盾注释同步结论。
后端行为、能力登记都不用动。金标准回执不受影响，理由是现有金标准没有传标签的用例。
建议顺手补一条门禁，断言空数组与省略在计数与分页上同结果，否则下次改查询时没人会发现走样。

## 能力登记有没有如实登记相关上限

三房登记里 `list`、`counts`、`listPage` 全是明确提供功能：
GitHub 房 `src/tracker/rooms/github/capability-register.ts:32`、`48-49`，
GitLab 房 `src/tracker/rooms/gitlab/capability-register.ts:37`、`50-51`，
Markdown 房 `src/tracker/rooms/markdown/capability-register.ts:35`、`46-47`。
`tests/verify-capability-register.ts` 只比三处（登记数据、人读的表、房间成员集合）档位一致，
不管字段级语义。`docs/tracker` 三张能力表里用薄行、正文、评论搜到的只有
`docs/tracker/capability-markdown.md:15` 关于读单票评论分页的一行，
没有任何关于列表薄厚或空数组语义的登记。
结论：登记层面没有失实，但这两处语义本来就不在登记的表达范围内，
修契约文字不需要动登记。

## 总判断

第一条不是真矛盾，是误读加一句有歧义的文字：引文把 `list` 与 `listPage` 当成了同一个操作，
但 `operations.ts:110` 缺顿号的措辞确实该修，建议只改文字，行为以三后端一致的完整行为准，
金标准与登记不受影响。
第二条是真问题：`inputs.ts:40` 的一个标签都不带与三后端一加工具层四处一致的空等于不过滤对立，
实现注释自己承认未决，门禁与金标准都没钉住。建议改 `inputs.ts:40` 与实现里的矛盾注释，
以空等于不过滤为准，后端、登记、金标准都不动，另补一条空数组语义的门禁。
两条都不需要关闭 issue #1183 本身：第二条修完之前它应当保持打开，
第一条的措辞修订可以与第二条同一次改完。
