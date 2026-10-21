# 研究：#1089 讨论要用的现行事实（进度区与用户原话，2026-10-21）

> 对应票：#1089。只查一手来源，每个结论都注明来源文件与行号。这次研究不改代码、不改票。

## 一、建票骨架：`deck_issue_create` 给新票补什么正文

1. 补正文的规则只有一份实现，在 `src/deck/rules/minimal-spec.ts` 的 `ensureBody(body, kind)`；`src/deck/shell/minimal-spec.ts` 只是把这个函数原样转出给工具层，自己不含判断。函数上方的说明写着「地图补五个区块，别的票补一个进度区」，并且补不补的判据是「正文里有没有认得出的那一行」，不是「正文是不是空的」。来源：`src/deck/rules/minimal-spec.ts:96-100`、`src/deck/shell/minimal-spec.ts:31-33`。
2. 判断「正文里已经有进度标题」的函数是 `hasProgressHeading`，它同时认 `## 进度`、`## 进度：80%` 与 `## Progress: 40%` 三种写法；注释说明放宽到带百分比的标题是为了避免给已经写了百分比的票再插一段重复的进度区（#908 实测）。来源：`src/deck/rules/minimal-spec.ts:85-94`。
3. 地图票只补五个区块，补完就返回，不会得到 `## 进度` 区：缺哪个就补哪个，候选是 `## Destination`、`## Notes`、`## Decisions so far`、`## Not yet specified`、`## Out of scope`，正文完全为空时先放一行 `<!-- 这张地图的正文由 deck_map_plan_create 建骨架时补上 -->`。这五个标题与共享层 `parseMapBody` 认识的标题逐字一致。来源：`src/deck/rules/minimal-spec.ts:43-45`、`src/deck/rules/minimal-spec.ts:104-111`。
4. 规格票与实施票什么也不补：代码在 `isHeaderOnlyKind(kind)` 为真时直接返回原正文。`isHeaderOnlyKind` 只对 `spec` 与 `ticket` 两类返回真；注释说明这两类票的正文由技能模板写（规格是 to-spec 的七节，实施票是 to-tickets 的四节），进度区是给探索地图上的任务票记「做到哪一步」的，规格与实施票的状态由票的 `state` 表达。来源：`src/deck/rules/minimal-spec.ts:113-115`、`src/shared/issue-file/src/marker.ts:31-46`。
5. 其余票（`task`、`bug`）在没有认得出的进度标题时，会在正文末尾追加下面这一段，并把 `## 进度` 记进 `added`：`\n\n## 进度\n\n<!-- 做到哪一步了，在这里一行一行记 -->\n`。注意这里写出的标题行只有 `## 进度` 四个字，百分比不写在标题行。来源：`src/deck/rules/minimal-spec.ts:116-119`。
6. 建票工具确实调用这个函数：`deck_issue_create` 在 `src/deck/tools/issue-create.ts:175` 调 `ensureBody(a.body, kind)`，并在回执里用 `我替你补了正文区块：` 加上补过的标题（`:208`）；`deck_map_plan_create` 在 `src/deck/tools/map-plan-create.ts:273` 与 `:362` 分别给地图本身和子票补正文。来源：`src/deck/tools/issue-create.ts:175`、`src/deck/tools/issue-create.ts:208`、`src/deck/tools/map-plan-create.ts:273`、`src/deck/tools/map-plan-create.ts:362`。
7. 真实建票产物的形状可以从金标准回执里逐字看到：文件头是幂等锚与 `created` 注释，然后是一级标题、正文、`## 进度`（标题独占一行）、占位注释、字段行 `Status: ready-for-agent` / `Type: task` / `Blocked by:` / `Labels: wayfinder:task`，最后是 `## Comments` 与 `## Answer`。也就是说，新建任务票的进度区今天长成「标题一行、说明注释一段」，里面没有百分比。来源：`tests/tracker-contract/fixtures/golden-receipts/02-deck_issue_create.golden.json:31`。
8. 房里的示例票提供了另一种既存形态：`.scratch/__fixtures__/markdown-sample/demo-full/issues/01-hello-world.md` 把 `## 进度：30%` 放在整份文件最末（`## Answer` 之后），没有占位注释。这说明读取端对进度区放在哪里并不敏感，建票产物与手工维护的票可以位置不同。来源：`.scratch/__fixtures__/markdown-sample/demo-full/issues/01-hello-world.md:19-23`。

## 二、改票写入：`deck_issue_patch` 的 progress 参数怎么替换进度区

1. 真正做替换的函数是 `replaceProgressSection(body, text)`，文件里的说明只有一句：「只替换『## 进度』那一段：前面的正文与后面的其它区块原样保留」。来源：`src/deck/tools/issue-patch.ts:101-102`。
2. 它先去掉入参结尾的空白，然后固定拼出 `## 进度\n\n` 加上入参、再加两个换行。**标题永远只写 `## 进度`，入参原样落在标题下一行**，函数没有任何把百分比搬上标题行的分支。来源：`src/deck/tools/issue-patch.ts:104-105`。
3. 定位进度区用的正则接受「`## 进度`」以及「`## 进度：80%`」「`## Progress: 40%`」这类带百分比或英文的标题；注释说明写进度的人也要认读进度的人认的写法，否则会再插一段重复的进度区。来源：`src/deck/tools/issue-patch.ts:106-107`、`src/deck/tools/issue-patch.ts:112`。
4. 右边界有三个终点：下一个 `## ` 标题、字段行 `Status/Type/Blocked by/Labels`、以及整个字符串的真正末尾。注释解释了两件事：多行模式下不能用普通的 `$`，否则惰性匹配会停在标题行尾、只换掉标题几个字；`$(?![\s\S])` 只在整个字符串末尾成立。另有一条 #1002 的记录：右边界要停在字段行之前，否则字段行会被吞进进度段，再由改正文的整份分支补到文件末尾。来源：`src/deck/tools/issue-patch.ts:107-112`。
5. 正文里没有进度区时，插入位置分三档：第一档插在第一条字段行之前；第二档插在 `## Comments` 或 `## Answer` 骨架标题之前；第三档直接追加到文末。三档都会在拼接后压掉三连以上的空行。实测一张「一级标题 → 正文 → Status/Type/Labels → `## Comments`」的票，进度区被插在 `Status` 行之前、正文之后。来源：`src/deck/tools/issue-patch.ts:113-131`；插入位置由本次临时脚本实测，见第四节。
6. 正文里已有进度区时，用同一条正则加 `g` 标志全局匹配：第一个命中替换成新块，后面的命中替换成空串（清掉历史脏数据留下的第二个进度区），最后在「非换行字符紧跟 `## `」的地方补一个空行，并把三连以上的空行压成一段。来源：`src/deck/tools/issue-patch.ts:133-141`。
7. 工具层的 `progress` 参数说明只有一句「只改『## 进度』那一段的内容」；执行分支是：如果本次同时给了整段 `body`，就直接在 `body` 上替换；否则先读回旧正文，读不到就拒绝写入，错误文案是「旧正文没读回来，不敢拿半截正文覆盖：这次进度没写，等能读回旧正文再写（若急用，改传整段 body）。」；读到后先过一遍 `ensureBody(base, 'task')` 再替换。写入后工具还会 `get` 一次做读回，回执里带 `readBack`。来源：`src/deck/tools/issue-patch.ts:86`、`src/deck/tools/issue-patch.ts:357-370`、`src/deck/tools/issue-patch.ts:376`、`src/deck/tools/issue-patch.ts:425-427`。
8. 写成功后的正文形态是 `## 进度` 独占一行、空行、内容一行、空行，然后接原来的后续区块。若入参是 `90%`，内容行就是 `90%`；若入参是 `进度：90%`，内容行就是 `进度：90%`——标题下面会再出现一次「进度：」。来源：`src/deck/tools/issue-patch.ts:104-105`；逐字结果见第四节。
9. 这条替换行为有专门的门禁：`tests/verify-908-progress-replace.ts` 钉住六种正文形态，以及 #1002 的两条整份形态（进度必须换在字段行之前、不能被吞到文末），还覆盖带百分比标题、英文 `Progress` 与双进度脏数据。来源：`tests/verify-908-progress-replace.ts:36-41`、`tests/verify-908-progress-replace.ts:71-83`、`tests/verify-908-progress-replace.ts:92-98`。

## 三、读回：进度百分比怎么被读出来

1. 读回的真源是 `src/tracker/body-parse.ts` 的 `parseProgress(body)`，注释写明三级锚定按顺序试、先命中先用：① 标题行 `## 进度：90%`；② 行首变体 `进度：90%`（不带标题符号）；③ 全文兜底（兼容老票随手格式，放最后是为了不劫持前两层）。返回值是 0 到 100 的整数；正文里没有进度、或数字不是合法整数时返回 `null`，不是 0。来源：`src/tracker/body-parse.ts:241-260`。
2. 三条正则逐字如下：第一级 `^\s*#{1,6}\s*(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%`（多行、忽略大小写）；第二级 `^\s*(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%`；第三级 `(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%`。读出数字后 `parseInt`，再夹到 0 与 100 之间。来源：`src/tracker/body-parse.ts:254-260`。
3. 第二份同口径解析在 `src/tracker/deck-derive.ts`，函数名与三级正则都与上一条相同；它在派生阶段按票算 `progressOf[poolIdOfTicket(t)] = parseProgress(t.body)`，类型注释写明「无进度为 `null`」。来源：`src/tracker/deck-derive.ts:151-167`、`src/tracker/deck-derive.ts:107`、`src/tracker/deck-derive.ts:305-307`。
4. 第三份同口径解析在 `src/host/mapBody.ts`，同样是三级正则；它被 `mapTicket` 用来给单张票填 `progress`，注释写着「null = 未表达」，并在 `createMapBody` 的返回对象里对外提供 `parseProgress`。来源：`src/host/mapBody.ts:117-131`、`src/host/mapBody.ts:147`、`src/host/mapBody.ts:156`。
5. 宿主侧列表的调用点在 `src/host/mapTickets.ts` 的 `prepareRow`：取票正文，调用注入的 `parseProgress`，把结果写进 `t.progress`，随后删掉 `t.body`（列表不背正文）。注释明确写着「解析不出给 null（= 未表达），界面对 null 画『—』而不是假装 0%」。来源：`src/host/mapTickets.ts:101-105`。
6. 共享形状 `src/shared/tracker/shape.ts` 把 `progressOf` 定义成 `Record<string, number | null>`，注释是「每票 `## 进度:N%`；无→null」；这说明共享层对「没有进度」的约定就是 `null`，而不是 0。来源：`src/shared/tracker/shape.ts:295`、`src/shared/tracker/shape.ts:309-310`。
7. 单票路径与地图快照路径各走各的：`src/host/snapshotBuild.ts` 在 `:182` 从依赖里取出 `mapTicket`、在 `:250` 用 `subs.map(mapTicket)` 把子票逐个装成面板票（`mapTicket` 本身定义在 `src/host/mapBody.ts:133`）；`src/deck/tools/map-snapshot.ts:66` 直接对每张票调 `parseProgress(issue.body)`，`:190` 把派生结果 `projection.progressOf` 放进回执；`src/host/index.ts:119` 只是把宿主侧 `mapBody.parseProgress` 包成异步门面。来源：`src/host/snapshotBuild.ts:182`、`src/host/snapshotBuild.ts:250`、`src/host/mapBody.ts:133`、`src/deck/tools/map-snapshot.ts:11`、`src/deck/tools/map-snapshot.ts:66`、`src/deck/tools/map-snapshot.ts:190`、`src/host/index.ts:119`。
8. 任务描述里提到的 `src/host/refresh/patch.ts` 今天不参与进度解析：这个文件负责行级增量刷新，全文没有 `progress` 或 `mapTicket` 的调用，所以它不是 `parseProgress` 的调用点。来源：`src/host/refresh/patch.ts:1-30`（文件头说明只做三件跑腿的事），并见本次对该文件的检索结果无进度相关命中。
9. `null` 的语义是「未表达」，不是「0%」：0 是明确的「未动工」，`null` 是「正文里根本没写进度」。解析层、共享形状、宿主列表注释与展示层都按这个区分处理。来源：`src/tracker/body-parse.ts:249`、`src/shared/tracker/shape.ts:295`、`src/host/mapTickets.ts:101-102`、`src/client/views/shared/ticket.ts:23-29`。

## 四、回合缺口：传 `90%` 与传 `进度：90%` 各自写出什么、读回什么

1. 本次用系统临时目录里的脚本 `D:\Temp\probe-1089.mjs` 实测，没有改仓库文件。脚本通过 `node --import ./scripts/ts-hook.mts` 直接导入两个真函数：`src/deck/tools/issue-patch.ts` 的 `replaceProgressSection` 与 `src/tracker/body-parse.ts` 的 `parseProgress`，输入是构造好的正文串。来源：本次实测（脚本在仓库外，仓库文件未改动）。
2. 已有进度区时传 `progress='90%'`：旧正文 `## 进度\n\n40%\n\n<!-- 做到哪一步了，在这里一行一行记 -->` 被换成 `## 进度\n\n90%\n\n`，`parseProgress` 读回 **`null`**。原因是写出的内容行只有 `90%`，三级正则都要求「进度」或「Progress」加冒号再加数字。来源：`src/deck/tools/issue-patch.ts:104-105`、`src/tracker/body-parse.ts:254-256`、本次实测。
3. 同一段正文传 `progress='进度：90%'`：正文变成 `## 进度\n\n进度：90%\n\n`，`parseProgress` 读回 **`90`**。代价是标题下一行重复了一次「进度：」四个字符，人读起来是「进度 / 进度：90%」。来源：`src/deck/tools/issue-patch.ts:104-105`、`src/tracker/body-parse.ts:254-256`、本次实测。
4. 正文里没有进度区时，传 `progress='90%'` 会得到 `## 进度\n\n90%\n\n`，插入位置在 `Status` 字段行之前、一级标题与正文之后；`parseProgress` 仍读回 **`null`**。同一张票传 `progress='进度：90%'`，插入位置相同，正文是 `## 进度\n\n进度：90%\n\n`，`parseProgress` 读回 **`90`**。来源：`src/deck/tools/issue-patch.ts:113-121`、本次实测。
5. 直接喂 `parseProgress` 的逐字结果如下：正文 `## 进度：90%` 读回 `90`（第一级，标题行）；正文 `## 进度\n\n90%` 读回 `null`；正文 `## 进度\n\n进度：90%` 读回 `90`（第二级）；正文 `正文 进度：90% 结尾` 读回 `90`（第三级）；正文 `## 进度\n\n<!-- 做到哪一步了，在这里一行一行记 -->` 读回 `null`。来源：`src/tracker/body-parse.ts:254-256`、本次实测。
6. 写路径今天**永远不会**产出「标题行带百分比」的形态：无论入参是什么，`blockBase` 的第一行都是固定的 `## 进度`。若讨论决定采用「`## 进度：90%`」这种标题行写法，需要改的就是 `src/deck/tools/issue-patch.ts:105` 这一处拼装逻辑（例如当入参本身已经带「进度：」前缀时把它放到标题行），否则只能靠调用方传 `进度：90%` 来「骗」过读取端，代价是标题下多一行重复前缀。来源：`src/deck/tools/issue-patch.ts:104-105`、本次实测。
7. 读路径的注释把「标题行 `## 进度：90%`」称为「进度区正形」，门禁 `tests/verify-progress.ts` 的第一条样例也是 `## 进度：90%\n下一步：x` 读回 90。也就是说，读的一侧一直把标题行带百分比当正形，写的一侧却只写标题、把百分比放下一行；这个错位就是本次讨论要定「进度写哪」的直接原因。来源：`src/tracker/deck-derive.ts:152`、`src/host/mapBody.ts:118`、`tests/verify-progress.ts:28`。
8. 另外一个容易忽略的后果：传 `90%` 写出来的票，界面上会显示「—」并按「未动工」处理，人却在正文里明明看到「90%」。这不是显示 bug，而是读回失败：`parseProgress` 回 `null`，列表与详情都按未表达处理。来源：`src/client/views/shared/ticket.ts:23-48`、`src/host/mapTickets.ts:101-104`。

## 五、展示：票面进度百分比显示在哪里、null 显示什么

1. 进度条的共用函数是 `src/client/views/shared/ticket.ts` 的 `tProgressBar`：票已关闭时标签写 `100%`；`progress` 为 `null` 或 `undefined` 时标签写 `—`、条色用 `#52525b`；否则标签写 `n%`、条色用 `#58a6ff`。来源：`src/client/views/shared/ticket.ts:38-48`。
2. 状态判断也用同一个值：`tStatus` 在票已关闭时回 `done`；`progress` 为 `null`、`undefined` 或小于等于 0 时回 `todo`；大于等于 100 回 `accept`；大于等于 95 回 `confirm`；其余回 `doing`。`tStatusLabel` 分别显示「完成」「未动工」「100% · 待验收」「95% · 待确认」「进行中 {n}%」。来源：`src/client/views/shared/ticket.ts:23-37`、`config/copy/word.yaml:146-150`。
3. 票列表行的画法在 `src/client/views/TicketRow.ts`：状态小标一直画，进度条只在票是 `OPEN` 时画。也就是说已关闭票不再显示进度条，只显示「完成」类状态。来源：`src/client/views/TicketRow.ts:53-55`。
4. 地图详情的子票节点与列表行同一套：每个子票节点画 `tProgressBar` 与 `tStatusBadge`。地图自己那一行不同：它画的是分层段条，标题文案是「地图进度」，下面显示当前层与 `N/M 层已通过`，**没有百分比数字**；所以「地图行与子票行的差别」是「层进度 vs 百分比进度」。来源：`src/client/views/MapDetail.ts:255-256`、`src/client/views/MapDetail.ts:316`、`src/client/views/MapDetail.ts:322-325`、`config/copy/flow.yaml:96-98`。
5. 详情页的正文是整段渲染的：只要详情回来了且有正文，就把 `detail.body` 整个交给 `mdToHtml`，没有按区块拆开渲染；因此正文里新增一个 `##` 区块不需要改面板代码，它会作为普通 Markdown 显示出来。来源：`src/client/views/IssueDetail.ts:219-224`。

## 六、上报的进度自评：`deck_issue_report` 的 progress 是什么

1. `deck_issue_report` 的 `progress` 是一个可选的 0 到 100 整数，参数说明写明「这次上报的进度自评……只作展示，不参与任何判定。不传时条目上不记这一格，也不沿用上一次的数字」；文件头注释同样强调它只写进本会话这张票的工作条目、只作展示。来源：`src/deck/tools/issue-report.ts:3-5`、`src/deck/tools/issue-report.ts:88`。
2. 它的取值校验是 `normProgress` 与一段显式判断：不是 0 到 100 的整数就按参数错误拒绝，错误文案是「进度要写 0 到 100 的整数（例如 40）……」。校验通过的值会随回执的 `data.progress` 返回。来源：`src/deck/tools/issue-report.ts:32-36`、`src/deck/tools/issue-report.ts:139-140`、`src/deck/tools/issue-report.ts:231`。
3. 它写进的位置是本会话的工作条目，不是票正文：`src/deck/shell/work-path-ledger.ts` 的条目形状里有可选的 `progress?: number`，`validProgress` 只接受 0 到 100 的有限整数，`applyNote` 在传入合法值时才写 `entry.progress = progress`；账本随后由 `ledgerToText` 序列化、由 `loadLedgerFromText` 读回。来源：`src/deck/shell/work-path-ledger.ts:46-47`、`src/deck/shell/work-path-ledger.ts:129-131`、`src/deck/shell/work-path-ledger.ts:174-175`、`src/deck/shell/work-path-ledger.ts:200-229`、`src/deck/shell/work-path-ledger.ts:267`。
4. GLOSSARY 的「进度自评」词条把边界写死了：它是 `deck_issue_report` 可选带的 0 到 100 整数，写进本会话这张票的工作条目，只作展示，不参与任何判定；词条还专门列出要避免的三种误解——把它当正文的「## 进度」段、拿它当完成判据或认领凭据、把「没带」当成「归零」。来源：`GLOSSARY.md:174`。
5. 因此两者不是同一物：正文的 `## 进度` 是票面内容，只有它会被 `parseProgress` 读出并画成进度条；上报的进度自评只进工作路线账本，`parseProgress` 完全不读账本。来源：`GLOSSARY.md:174`、`src/tracker/body-parse.ts:251-260`、`src/deck/shell/work-path-ledger.ts:200-229`。

## 七、用户原话的既有写法先例

1. 今天没有统一的「用户原话」区约定：全仓检索没有以 `## 用户原话`、`## 原声`、`## 原话摘录` 为标题的区块，也没有 `## 诉求（维护者 … 原话）` 这样的区块；最接近的写法分散在原型文档与研究笔记里，标题措辞、引用形式与出处位置各不相同。来源：本次全仓检索；对照 `docs/prototype/474-feeling-notes.md:7`、`docs/prototype/474-design-brief.md:44`、`research/790-silent-parent-edge-failure.md:9`。
2. 最接近「成块引用」的一族是原型设计说明：`docs/prototype/474-design-brief.md` 用标题 `## 2. 设计理念（来自 issue #474，维护者原话）`，下面用两行 `> 「**目的地清晰而模糊**」：……` 引用块；出处只写在标题括号里的 issue 编号，没有日期。`474-design-brief-caseboard.md` 复用同一个标题与同一种引用块，并另有一句粗体引导 `**维护者在这一轮点名的三个方向（他原话）**：`。来源：`docs/prototype/474-design-brief.md:44-47`、`docs/prototype/474-design-brief-caseboard.md:41`、`docs/prototype/474-design-brief-caseboard.md:71-73`。
3. `docs/prototype/474-design-brief-movieboard.md` 是同一族的另一种写法：标题 `## 0. 这一轮的来历（维护者的原话）`，引导句「维护者说：」，下面两条 `> 「……」`，两条之间用单独一行 `>` 隔开；没有日期与链接。来源：`docs/prototype/474-design-brief-movieboard.md:9-15`。
4. 另一族是「逐句复述、请本人校正」的清单：`docs/prototype/474-feeling-notes.md` 的标题是 `## 一、你留在票里的原话`，出处写在引导句里——「票是 2026-09-04 由 `/to-spec` 从你的话固化的，你自己在评论里把它订正为**理念存档**：」，随后用编号列表与「」内联引语逐条抄，例如「抄在 `## Further Notes` 里的原话锚点一共五句：」。这一族不用 `>` 引用块，日期、命令与「谁的评论」都写在引导句里。来源：`docs/prototype/474-feeling-notes.md:7-18`。
5. 第三族是研究笔记里的「原话摘要」标题：`## 一、票面症状原话摘要`、`## 一、票面症状（原话摘要）`、`## 一、票面写的现象（原话摘要）`、`## 八、文档里对这份副本的既有定版口径（逐条抄原话）`、`## ① 作者反复给出的主链（原话）`。这些标题只说明「下面是原话或转述」，具体引用形式随笔记而变，有的用「」，有的直接用票面片段。来源：`research/790-silent-parent-edge-failure.md:9`、`research/971-markdown-parent-edge.md:7`、`research/898-blocked-by-overwrite.md:10`、`research/895-batch-write-timeout.md:7`、`research/1047-binding-removal-facts.md:264`、`research/642-parts/matrix-web.md:41`。
6. `research/1010-ticket-structure.md` 记过一个更贴近「诉求」的写法：`.tmp-666-brand.md:1-3` 与 `.tmp-667-body.md:1-3` 用 `## 诉求（维护者 2026-09-19 原话）` 加引用块。但这**两个文件今天既不在工作树、也不在 `git ls-files` 里**，从未入库，原文无法恢复；今天能查到的只有 1010 笔记的这一句描述。来源：`research/1010-ticket-structure.md:101`；本次 `Test-Path` 与 `git ls-files` 检索均无命中。
7. 结论：今天没有统一约定，最接近的做法有三族——（甲）标题括号里写 issue 编号与「维护者原话」、正文用 `> 「……」` 引用块（474 设计说明）；（乙）标题写「你留在票里的原话」、出处写在引导句里、正文用编号清单加「」内联（474-feeling-notes）；（丙）研究笔记用「（原话摘要）」标题、引用形式不固定。三族在「标题怎么起」「用不用引用块」「出处置于标题还是引导句」「写不写日期与链接」四个问题上都不一致。来源：`docs/prototype/474-design-brief.md:44-47`、`docs/prototype/474-feeling-notes.md:7-18`、`research/790-silent-parent-edge-failure.md:9`。

## 八、出处写法惯例

1. 仓里唯一一条把「出处怎么写」写成通用规则的是 `research/1012-final-plan.md` 第 6 行：「出处的写法：票面用完整链接；文件用 `路径:行号`；提交用短哈希。」它没有单独规定「引用某个人的话时出处怎么写」。来源：`research/1012-final-plan.md:6`。
2. 票正文的写法规矩在 `docs/agents/issue-tracker.md`：正文先写成文件，文件里必须是真实换行（每个 `## 章节` 独占一行、段落之间留一个空行），再交给工具写回；不要把正文拼进命令行，不要把换行写成字面的 `\n` 两个字符，不要以 BOM 开头，写完读回来核对一遍。这条规则三个后端通用。来源：`docs/agents/issue-tracker.md:33-37`。
3. 同一份文档还规定了一种降级写法：真拿不到原生能力时，才退回在子票正文首行写 `Blocked by: #n`（多个阻塞票号用逗号隔开），并明确「不许拿它当默认做法」。来源：`docs/agents/issue-tracker.md:39-42`。
4. 旧的提示词契约确实删过：`CHANGELOG.md` 的 v1.7.29（2026-09-24）一节说，这次把提示词里两段「只能手敲跟踪器命令」时代的契约删掉（正文格式、进度规矩）；具体条目写「删掉「## 正文格式」整节……删掉进度契约（不再要求 `## 进度：N%` 固定写法、不再有 0/1-94/95/100 的语义阶梯、取消「未确认不得 close」）」。注意任务里说的 `CHANGELOG.md:412` 今天已漂移成 v1.7.35 的验证命令，真正的记录在 `:487`。来源：`CHANGELOG.md:481`、`CHANGELOG.md:485`、`CHANGELOG.md:487`、`CHANGELOG.md:412`。
5. `docs/` 下没有「票正文区块契约」这一类专门文档。与正文形状沾边的只有三类：ADR 把「正文形状」当成识别对象类型的兜底判据（地图五节、规格七节、实施票四节）；`docs/design/1277-md-spec-container.md` 第 2 节给出本地房票面的文件头顺序样例；`docs/tour/deck-call-end-to-end.md` 指出补正文的真身是 `src/deck/rules/minimal-spec.ts` 的哪几行。它们都不是「正文可以有哪些区块、每个区块怎么写」的契约。来源：`docs/adr/20261020-object-kind-identification.md:17`、`docs/adr/20261020-object-kind-identification.md:59-67`、`docs/design/1277-md-spec-container.md:26-49`、`docs/tour/deck-call-end-to-end.md:518`。
6. 因此「原话出处怎么写」今天只有可借用的惯例，没有硬规定：1012 的规则要求票面用完整链接，但现有三族先例都没给链接——474-design-brief 只写 issue 编号，474-feeling-notes 写日期加命令、不写链接，研究笔记的「原话摘要」多数连日期也不写。这是讨论需要补的空档。来源：`research/1012-final-plan.md:6`、`docs/prototype/474-design-brief.md:44`、`docs/prototype/474-feeling-notes.md:9-10`、`research/790-silent-parent-edge-failure.md:9`。

## 九、Markdown 房票面形状与新增区块的代价

1. 建票产物里，正文、字段行与 `## Comments` 的先后是固定的：文件头注释（幂等锚、created）→ 一级标题 → 正文 → `## 进度` → 字段行 `Status` / `Type` / `Blocked by` / `Labels` → `## Comments` → `## Answer`。`docs/design/1277-md-spec-container.md` 第 2 节给的规格票样例也是同一顺序（注释行 → 一级标题 → 正文 → 字段行 → `## Comments`），只是规格票没有 `## 进度`。来源：`tests/tracker-contract/fixtures/golden-receipts/02-deck_issue_create.golden.json:31`、`docs/design/1277-md-spec-container.md:34-49`。
2. Markdown 房解析票面时，`body` 就是整份原文（`raw`），没有按区块拆成结构化字段；它只额外读取字段行（`Status` / `Type` / `Blocked by` / `Labels` 等）、把 `## Comments` 当作评论锚、再按 `###` 切评论，`## Answer` 不单独结构化。因此任意新增的 `##` 区块都会原样留在 `body` 里，解析不需要为它加代码，除非要在界面上单独展示。来源：`src/tracker/rooms/markdown/parse.ts:195-246`、`src/tracker/rooms/markdown/parse.ts:248-255`、`src/tracker/rooms/markdown/parse.ts:332`。
3. 「整份 vs 片段」判据今天有两份在用的实现：一份在 `src/deck/rules/minimal-spec.ts` 的 `isWholeIssueBody`，一份在 `src/tracker/rooms/markdown/parse.ts` 的 `isWholeIssueBody`。四条正则的语义完全一致（一级标题、幂等锚、四个字段行、`Comments`/`Answer` 骨架标题），但**函数体不是逐字相同**：前者用 `str(body)` 取字符串，后者用 `typeof body === 'string' ? body : ''`；第三条正则的字符类顺序也不同，前者写 `[\uFF1A:]`，后者写 `[:\uFF1A]`。所以两份注释里说的「逐字一致」严格讲不成立，准确说法是「四条判据等价」。来源：`src/deck/rules/minimal-spec.ts:123-140`、`src/tracker/rooms/markdown/parse.ts:62-78`（`parse.ts:68-70` 的注释还指向已不存在的 `plan.js`）。
4. 同一份 Markdown 房里还有第三份判据：`src/tracker/rooms/markdown/patch-body.ts` 的 `looksLikeWholeDocument` 只认两条（一级标题或幂等锚），比上面两份窄；它被 `issues-patch.ts:9` 导入，但全文没有任何调用点——今天是一份没人用的遗留判据。来源：`src/tracker/rooms/markdown/patch-body.ts:18-21`、`src/tracker/rooms/markdown/issues-patch.ts:9`。
5. 新增一个正文区块，写路径要动的地方取决于它怎么进来：如果由建票工具自动补，要改 `ensureBody`（今天它只认地图五节与 `## 进度`）；如果由 `deck_issue_patch` 的新参数写入，要照 `replaceProgressSection` 的样子加一个替换函数与插入位置；如果只是调用方自己在整段 `body` 里写，则不需要改写入代码。读取与展示都不用改，因为 `body` 是整份原文、详情页整段走 `mdToHtml`。来源：`src/deck/rules/minimal-spec.ts:100-121`、`src/deck/tools/issue-patch.ts:102-142`、`src/client/views/IssueDetail.ts:219-224`。
6. 但整份替换有一个会丢区块的坑：Markdown 房在收到「整份正文」时走 `mergeWholeBodyForPatch`，它只用盘上的幂等锚、`created`、一级标题与缺的字段行做补齐，正文里**只搬回 `Comments` 与 `Answer` 两节**；新增的 `## 用户原话` 不在这个名单里，整份替换后会被丢掉。要保住它，必须把这个标题加进 `src/tracker/rooms/markdown/patch-body.ts:118-126` 的 `names` 名单，或改成片段写入。来源：`src/tracker/rooms/markdown/patch-body.ts:85-139`、`src/tracker/rooms/markdown/patch-body.ts:118-126`。
7. 写前核对也帮不上忙：`checkNoWorseForPatch` 只数一级标题、幂等锚、类型标记、已知字段行与 `Comments` / `Answer` 两节，新增区块既不在白名单里，丢了也不会被它判成「变坏」。所以「整份替换丢新区块」这件事今天没有任何门禁拦。来源：`src/tracker/rooms/markdown/patch-body.ts:54-83`、`src/tracker/rooms/markdown/issues-patch.ts:164-168`。
8. 片段写入则相对安全：它把片段插在一级标题之后、第一条字段行之前（字段名包括 `Assignees` 与 `Close reason`），不会碰后面的 `## Comments`；`replaceProgressSection` 的右边界又认所有 `^## `，所以新增区块放在 `## 进度` 后面不会被进度替换吞掉。来源：`src/tracker/rooms/markdown/issues-patch.ts:100-118`、`src/deck/tools/issue-patch.ts:111-112`。

## 十、既有笔记 `research/1010-ticket-structure.md` 的可用性

1. 5.2 的机制结论仍然成立，但路径全部失效：写入确实由 `progress` 参数触发、按标题正则替换、右边界是字段行、无进度区时三档插入、写后读回；只是今天这些代码在 `src/deck/tools/issue-patch.ts`（`replaceProgressSection` 在 `:102-142`，读回在 `:425-427`），不再是 `src/host/tools/deckIssuePatch.js`。来源：`research/1010-ticket-structure.md:93`、`src/deck/tools/issue-patch.ts:102-142`、`src/deck/tools/issue-patch.ts:425-427`。
2. 5.2 记的读取三份实现仍然成立，但三份的路径都换了：真源在 `src/tracker/body-parse.ts:251-260`，派生在 `src/tracker/deck-derive.ts:157-167`，宿主在 `src/host/mapBody.ts:121-131`；1010 写的 `src/shared/parser.js:49-59`、`src/shared/tracker/deck-derive.js:33-38`、`src/host/mapBody.js:45-50` 今天都不存在。来源：`research/1010-ticket-structure.md:93`、`src/tracker/body-parse.ts:251-260`、`src/tracker/deck-derive.ts:157-167`、`src/host/mapBody.ts:121-131`。
3. 5.2 记的展示位置仍然成立，路径也换了：进度条在 `src/client/views/shared/ticket.ts:38-48`，子票节点在 `src/client/views/MapDetail.ts:255-256`；1010 写的 `src/client/views/shared/ticket.js:23` 与 `src/client/views/MapDetail.js:151` 已不存在。5.2 说 `deck_map_snapshot` 按票算进度统计，今天仍然如此（`src/deck/tools/map-snapshot.ts:66`、`:190`）。来源：`research/1010-ticket-structure.md:93`、`src/client/views/shared/ticket.ts:38-48`、`src/client/views/MapDetail.ts:255-256`、`src/deck/tools/map-snapshot.ts:66-190`。
4. 5.2 的「真实写法先例」仍然成立：`.scratch/map610/map-610-body.md:110` 今天确实是一整行 `## 进度：96%（22 张子票，已关闭 21 张……）`，标题行带百分比加括号说明的写法真实存在。来源：`research/1010-ticket-structure.md:94`、`.scratch/map610/map-610-body.md:110`。
5. 5.2 的建票骨架与调用点失效：`src/shared/deck-tools/plan.js:44-63` 已不存在，今天是 `src/deck/rules/minimal-spec.ts:100-121`；调用点也不是 `deckIssueCreate.js:86` / `deckMapPlanCreate.js:164/218`，而是 `src/deck/tools/issue-create.ts:175` 与 `src/deck/tools/map-plan-create.ts:273`、`:362`。来源：`research/1010-ticket-structure.md:95`、`src/deck/rules/minimal-spec.ts:100-121`、`src/deck/tools/issue-create.ts:175`、`src/deck/tools/map-plan-create.ts:273-362`。
6. 5.2 最后一句「正文区块没有文档契约」今天仍然成立；它引的 `CHANGELOG.md:412` 已漂移，真正的记录在 `CHANGELOG.md:487`（v1.7.29 删掉进度契约）。来源：`research/1010-ticket-structure.md:96`、`CHANGELOG.md:487`、`CHANGELOG.md:412`。
7. 5.3 的前两条仍然成立：全仓没有 `## 用户原话 / 原声 / 原话摘录` 区块；`docs/prototype/474-feeling-notes.md:7` 仍然用 `## 一、你留在票里的原话`。但 `.tmp-666-brand.md` 与 `.tmp-667-body.md` 今天既不在工作树也不在 `git ls-files` 里，那一条无法再核对原文。来源：`research/1010-ticket-structure.md:100-101`、`docs/prototype/474-feeling-notes.md:7`、本次 `Test-Path` 与 `git ls-files` 检索。
8. 5.3 说「加一个新区块要改的地方比预想少，Markdown 房不用改、面板也不用改」：**片段写入**这条路径今天仍然成立，面板也确实不用改（详情页整段走 `mdToHtml`）；但「Markdown 房不用改」在**整份替换**时不成立——`mergeWholeBodyForPatch` 只搬回 `Comments` 与 `Answer`，新区块会被丢掉。1010 列的那批路径（`plan.js`、`src/host/tracker/backends/markdown/parse.js`、`src/client/views/IssueDetail.js` 等）今天全部不存在。来源：`research/1010-ticket-structure.md:102`、`src/tracker/rooms/markdown/patch-body.ts:118-126`、`src/client/views/IssueDetail.ts:219-224`。
9. 5.4 的第一条待查今天有答案：`tests/verify-prompts.js` 已改名为 `tests/verify-prompts.ts`，F22 样例还在（`:1903`，内容仍是 `## 进度：90% 独占一行，空行后接 下一步：xxx`）。但它所在的清单从 `:1889` 起叫 `FIXTURE_FALSE_POS`，用途是「这段话不得被门禁误判」，不等于今天的提示词仍在教这个写法；1010 把它当成「与已删契约疑似未同步」，严格说只能证明门禁仍允许这句话出现，不能证明提示词里还有它。来源：`research/1010-ticket-structure.md:106`、`tests/verify-prompts.ts:1889`、`tests/verify-prompts.ts:1903`、`CHANGELOG.md:487`。
10. 5.4 的第二条待查今天仍然存在，且 1010 引的行号也漂了：代码侧必备标签在 `src/deck/rules/minimal-spec.ts:34-40`（地图 `wayfinder:map`、任务 `wayfinder:task`、缺陷 `bug` 加 `needs-triage`）；文档侧「必备三枚」在 `docs/agents/triage-labels.md:27-33`（`bug`、`needs-triage`、`wayfinder:grilling`），而 1010 引的 `:41-45` 今天是五个 wayfinder 标签的清单。两套口径仍不一致。来源：`research/1010-ticket-structure.md:107`、`src/deck/rules/minimal-spec.ts:34-40`、`docs/agents/triage-labels.md:27-33`、`docs/agents/triage-labels.md:41-43`。
11. 仓里没有更新的、专门覆盖「进度区写法」或「用户原话区」的一手笔记：`research/` 顶层的 208 份笔记里，唯一直接提到 #1089 的是讨论图 `research/1010-discussion-graph.md:29`，它只写议题「进度写哪、原话区的写法：票正文的区块怎么定、谁写、怎么回读」。所以 1010 仍是唯一相关旧笔记，但它的路径需要按本笔记逐条替换。来源：`research/1010-discussion-graph.md:29`、`research/1010-ticket-structure.md:62`。

## 十一、供讨论用的一句话摘要

1. 今天新建任务票时，工具只写 `## 进度` 一行标题加一段占位注释，百分比从来不进标题行；而读取端的三份实现都把「`## 进度：90%` 标题行」当作第一级正形，这个写与读的错位就是 #1089 要定的第一件事。
2. 如果调用 `deck_issue_patch` 时传 `progress='90%'`，写出来的是 `## 进度` 下一行 `90%`，`parseProgress` 读回 `null`，界面显示「—」并按未动工处理；传 `progress='进度：90%'` 能读回 90，但标题下会多一行「进度：90%」，读起来重复。
3. 因此「进度写标题行还是标题下第一行」不是排版偏好，而是写路径与读路径必须同时改的接口问题：写路径固定在 `src/deck/tools/issue-patch.ts:105`，读路径的三级正则在 `src/tracker/body-parse.ts:254-256`。
4. 展示侧对 `null` 的处理已经定死为「—」与未动工，地图行则用层段条与「N/M 层已通过」而不是百分比；所以无论讨论选哪种写法，都不需要改展示代码，只需要保证写出的正文能被 `parseProgress` 读回。
5. 上报的进度自评与正文的 `## 进度` 是两件不同的东西：前者只进本会话的工作条目、只作展示，后者才是票面内容与界面进度条的数据源，讨论时不要把两者混成一个「进度」。
6. 用户原话今天没有统一区块：最接近的三族写法分别是 474 设计说明的「标题括号写 issue 编号加 `> 「……」` 引用块」、474-feeling-notes 的「`## 一、你留在票里的原话` 加编号清单与「」内联、出处写在引导句」、以及研究笔记的「（原话摘要）」标题；三族在标题、引用形式与出处位置上都不一致。
7. 出处的唯一通用规则是 `research/1012-final-plan.md:6` 的「票面用完整链接、文件用 `路径:行号`、提交用短哈希」，但它没有规定引用某人的话时怎么写；`docs/agents/issue-tracker.md:33-37` 只管正文的真实换行与章节独占一行，`docs/` 下也没有正文区块契约文档。
8. 新增 `## 用户原话` 区块的主要代价不在读取或展示，而在 Markdown 房的整份替换：`mergeWholeBodyForPatch` 只搬回 `Comments` 与 `Answer`，新区块会被丢掉，必须把标题加进 `src/tracker/rooms/markdown/patch-body.ts:118-126` 的名单，或统一走片段写入。
