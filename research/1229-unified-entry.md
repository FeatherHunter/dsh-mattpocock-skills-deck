# 研究：现行查询工作区后端归属的统一入口与形状（#1229）

> 对应票：#1229。只查一手来源，每个结论都注明来源文件与行号。全文使用完整中文句子，只使用术语表里已有的词，或者大白话，不造新的简称。

## 1. 问题重述

这次研究要回答的问题是，当有人问出一个工作区现在属于哪个后端的时候，程序里统一去问的那一条路到底是哪一条。调用的时候要传什么，回来的时候是什么形状。设置页里的总览应该调哪条电话，传什么参数，不该自己再算什么。如果统一的那条路缺了，或者不好用，应该先修哪里的封装，而不是另起一套。得到的结论会直接决定两件事，一是 #1233 定版时的口径怎么写，二是 #1231 落地时删掉哪一段重复的逻辑。

用户已经对齐的硬性要求是，落盘只认工作区根下面的 `docs/agents/workspace.yaml`，老的工作区文件不再作为依据，也不靠迁移来兜底。总览不直接读文件，要问统一判定入口拿答案。如果统一入口缺了，或者不好用，先修好封装，不另造轮子。这次摸到的手写代码一律转成 TypeScript，转完删掉旧文件。

## 2. 结论清单

1. 统一入口是名字叫 `wf.selection` 的那条宿主电话，它背后是 `handleSelection` 函数，函数内部再去调用判定文件里的 `decideBackend` 函数，最后用 `selectionFromOutlet` 函数把判定结果整理成调用方要的形状。来源是 `src/host/workspaceCwd.ts:217-242` 与 `src/host/index.ts:283`。
2. 总览应该调三条电话，分工是固定的。先调 `wf.registry` 拿后端模块的名单与展示信息，再调 `wf.bindings` 按名单批量读工作区文件，最后对名单里的每一个目录逐个调 `wf.selection` 拿统一判定结论。来源是 `src/client/views/SettingsWorkspaces.js:24`、`src/client/views/SettingsWorkspaces.js:40`、`src/client/views/SettingsWorkspaces.js:44`。
3. 调用时传的参数很简单。`wf.registry` 可以不传目录，或者传空目录。`wf.bindings` 传一个目录清单，字段名叫 `cwds`，值是一个字符串数组。`wf.selection` 传一个目录，字段名叫 `cwd`，值是一个字符串。来源是 `src/host/workspaceCwd.ts:185-204`、`src/host/workspaceCwd.ts:206-216`、`src/host/workspaceCwd.ts:217-221`。
4. 返回的形状是扁平的信封。`wf.registry` 成功时返回 `{ok:true, modules}`。`wf.bindings` 成功时返回 `{ok:true, bindings}`，数组里每一项是 `{cwd, backendId, source, ref}`。`wf.selection` 成功时返回 `{ok:true, selection, repository}`，其中 `selection` 至少有后端名、来源、出处、能不能写、原因这五个对外字段。来源是 `src/host/workspaceCwd.ts:203`、`src/host/workspaceCwd.ts:214`、`src/host/workspaceCwd.ts:240`，五个字段的口径见 `docs/adr/20261012-backend-decision-two-classes.md:18-19` 与 `src/tracker/detection/backendDecision.ts:376-396`。
5. 总览不该再算四件事。第一，不该直接读文件，文件只由宿主侧读。第二，不该自己拼谁绑定了谁，要问统一判定入口。第三，不该再读 `wf.registry` 回包里的绑定格，那一格已经删掉。第四，不该自己猜这台机器上有哪些工作区，名单要从工作区服务里拿。来源是 `src/host/workspaceCwd.ts:163-168`、`src/host/workspaceCwd.ts:211-214`、`src/client/views/SettingsWorkspaces.js:27-34`。
6. 如果统一入口缺了，或者不好用，先修封装，不另造轮子。缺的是判定函数没有装上，就修 `src/host/platformChannel.ts:470-477` 的装配。缺的是总览不好批量问，就给 `handleSelection` 加批量能力，或者在宿主侧包一层，而不是在界面侧另写一套判定。来源是 `src/host/workspaceCwd.ts:229-232` 与 `src/host/workspaceCwd.ts:227-228` 的注释。
7. 这次摸到的手写代码要转成 TypeScript。设置页总览文件今天还是手写的 JavaScript，转完要删旧文件。来源是 `src/client/views/SettingsWorkspaces.js:1-8` 的文件头，以及仓库对这类转换的要求。判定侧的统一出口本身已经是 TypeScript，不用再转。来源是 `src/tracker/detection/backendDecision.ts:1089` 的导出形状。
8. 落盘只认新的工作区文件。新的工作区文件是 `docs/agents/workspace.yaml`，老的 `docs/agents/workspace.json` 只是历史兼容读。来源是 `src/shared/config-store/src/workspace.ts:20-24` 与 `src/deck/shell/workspace-anchor.ts:34-36`。本次研究发现代码里两处读文件的地方都还留着先新后旧的顺序，来源是 `src/host/workspaceCwd.ts:174-182` 与 `src/tracker/detection/backendDecision.ts:821-826`。按用户对齐的硬性要求，#1233 应该把新的工作区文件写成唯一的依据，把老文件的读取写成临时的迁移路径，并写清删掉它的条件。#1231 应该删掉总览侧与宿主侧重复读文件的逻辑，只留统一判定入口里那一处。

## 3. 三条电话分工对照表

下面三条电话都挂在同一个装配文件里，来源是 `src/host/index.ts:280-283`。其中 `wf.bind` 是写入口，只负责人在界面上点确认的那一下，不在本次总览只读范围里，所以对照表只列查询用的三条。

| 要问的事 | 电话名 | 调用形状 | 返回的信封展开 | 备注 |
| --- | --- | --- | --- | --- |
| 这个工作区用哪个后端，这是统一入口 | `wf.selection` | 传入 `{cwd}`，其中 `cwd` 是所选目录整理后的字符串，为空时直接按未知回，不去探测。来源是 `src/host/workspaceCwd.ts:217-221`。 | 成功时返回 `{ok:true, selection, repository}`。其中 `selection` 是整理后的选择，至少有后端名、来源、出处、能不能写、原因这五个对外字段，有后端时还带引用。`repository` 是该后端的引用，没有后端时为空。来源是 `src/host/workspaceCwd.ts:235-240` 与 `src/tracker/detection/backendDecision.ts:382-396`。失败时返回 `{ok:false, error}`，例如注册表拿不到，或者判定出口没有装上。来源是 `src/host/workspaceCwd.ts:226` 与 `src/host/workspaceCwd.ts:230-232`。 | 内部固定走判定文件的统一出口，调用时带上注册表、平台、文件服务、调用方名字与日志上下文。来源是 `src/host/workspaceCwd.ts:227-235`。调用方名字固定写成 `wf.selection`，日志里可以据此查到这一趟判定。 |
| 哪些工作区已经选过后端，各选的是谁 | `wf.bindings` | 传入 `{cwds}`，其中 `cwds` 是候选目录的字符串数组。来源是 `src/host/workspaceCwd.ts:189`。 | 成功时返回 `{ok:true, bindings}`。其中 `bindings` 是数组，每一项是 `{cwd, backendId, source, ref}`，来源固定写成已选定的意思，没有记录的目录直接跳过，不占位。来源是 `src/host/workspaceCwd.ts:191-203`。失败时返回 `{ok:false, error}`。 | 这一条按调用方给的候选目录逐个读工作区文件，与判定出口读的是同一份东西。来源是 `src/host/workspaceCwd.ts:163-168`。它不是统一入口，只是总览为了少打几通电话做的批量预读，最终展示仍以统一入口为准。 |
| 现在装了哪些后端，展示用什么名字与颜色 | `wf.registry` | 传入空对象，或者带空目录的对象，总览里传的是 `{cwd:''}`。来源是 `src/client/views/SettingsWorkspaces.js:24` 与 `src/host/workspaceCwd.ts:206`。 | 成功时返回 `{ok:true, modules}`。其中 `modules` 是后端模块的展示信息数组。来源是 `src/host/workspaceCwd.ts:210-214`。失败时返回 `{ok:false, error}`。 | 这一条以前还回一个绑定的格，那一格正是注册表里那份进程内副本，副本删掉之后没有东西可答，整格去掉。来源是 `src/host/workspaceCwd.ts:211-214`。要问这个工作区用哪个后端，请走统一入口。客户端拿到模块名单后，只取名单做展示与排序，不再读绑定格。来源是 `research/1047-binding-removal-facts.md:78-81`。 |

### 3.1 总览现在的调用序列

设置页总览的钩子叫 `useWsOverview`，来源是 `src/client/views/SettingsWorkspaces.js:8`。它做的事情按顺序是四步。

1. 先调 `wf.registry` 拿后端模块的名单，名单用来做展示与排序。来源是 `src/client/views/SettingsWorkspaces.js:24`。
2. 再从工作区服务里拿这台机器上的工作区名单，支持快照、数组、按编号的对象三种形状。来源是 `src/client/views/SettingsWorkspaces.js:27-34`。
3. 把工作区名单里的目录整理成候选目录，去重后调 `wf.bindings` 批量读工作区文件。来源是 `src/client/views/SettingsWorkspaces.js:35-41`。注释里写清了为什么要候选目录，插件这边没有这台机器上有哪些工作区的名单，那是工作区服务的知识。来源是 `src/host/workspaceCwd.ts:167-168` 与 `src/client/views/SettingsWorkspaces.js:36-38`。
4. 对去重后的每一个目录逐个调 `wf.selection`，结果按目录存进一张表。来源是 `src/client/views/SettingsWorkspaces.js:42-44`。渲染时按选择与批量预读的双来源判断是否已绑定，已绑定的排前面。来源是 `src/client/views/SettingsWorkspaces.js:103-112`。

## 4. 判定出口分层证据说明

统一判定出口是判定文件里的 `decideBackend` 函数，形状是 `decideBackend(工作区目录, 依赖对象)`，返回一份完整的判定结论。来源是 `src/tracker/detection/backendDecision.ts:1089-1151`。依赖对象里至少有注册表、平台、文件服务、调用方名字、日志上下文。来源是 `src/host/workspaceCwd.ts:235` 与 `src/host/platformChannel.ts:442` 的装配。

判定结论里对外只交五个字段，加一个原因。判定内部新加的过程状态、档位、覆盖度与轨迹不进这条路。来源是 `src/tracker/detection/backendDecision.ts:376-380`。整理形状的函数是 `selectionFromOutlet`，形状是 `selectionFromOutlet(判定结果, 按编号查引用的函数)`，有后端就给编号加引用，无后端就给回退，没有结果就给空，由调用方走老路或诚实失败。来源是 `src/tracker/detection/backendDecision.ts:382-396`。

判定内部看三层，顺序是固定的。第一层是工作区文件，属于人选。第二层是声明文件，属于程序自己认。第三层是各后端自己的命中，属于程序自己认。来源是 `docs/adr/20261012-backend-decision-two-classes.md:27-31` 与 `CONTEXT.md:152-156`。判定顺序仍以用户手动选择在前、声明文件居中、自动识别在后的口径为准，分类不改顺序。来源是 `docs/adr/20261012-backend-decision-two-classes.md:37-39`。

工作区文件那一层的读法是新的优先、老的兼容。新的路径是 `docs/agents/workspace.yaml`，老的路径是 `docs/agents/workspace.json`。来源是 `src/shared/config-store/src/workspace.ts:20-24` 与 `src/deck/shell/workspace-anchor.ts:34-36`。判定出口里先把新路径放进待读清单，老路径不同时才追加。来源是 `src/tracker/detection/backendDecision.ts:821-826`。宿主侧批量预读的地方是同一顺序。来源是 `src/host/workspaceCwd.ts:174-182`。读到后端名就按命中回，文件在但里面没有可用的后端名就继续试下一条路径，都试完再说读不出。来源是 `src/tracker/detection/backendDecision.ts:843-851`。文件不在与读不成的区别在这里就分开，前者够格参与确实没有的结论，后者不够。来源是 `src/tracker/detection/backendDecision.ts:815-818` 与 `src/tracker/detection/backendDecision.ts:406-417`。

工作区文件的解析规则由校验文件定死。认识的版本就是 2，老文件是版本 1，读进来做迁移。来源是 `src/shared/config-store/src/workspace.ts:23-24`。新版本允许的来源是人亲手选的、从老版本记忆搬来的、按声明或自动识别生成的三种，老版本多一种历史取值。来源是 `src/shared/config-store/src/workspace.ts:41-42`。后端名必须是一段非空文字，空的按坏形状回。来源是 `src/shared/config-store/src/workspace.ts:143-145`。多出来的名字直接判坏，加不了自定义字段。来源是 `src/shared/config-store/src/workspace.ts:128-131`。版本高于认识时读成功但标只读，写时拒绝。来源是 `src/shared/config-store/src/workspace.ts:134-141`。文件字符数与别名数量各有一道上限。来源是 `src/shared/config-store/src/workspace.ts:26-29`。写出时一律出版本 2，注释由程序生成。来源是 `src/shared/config-store/src/workspace.ts:175-212`。

声明文件那一层读的是 `docs/agents/issue-tracker.md`，用同一套解析器得出后端编号。来源是 `src/tracker/detection/backendDecision.ts:866-903`。这份声明文件同时也是后端命中的输入之一，所以它属于程序自己认，不属于人选。来源是 `docs/adr/20261012-backend-decision-two-classes.md:35` 与 `CONTEXT.md:156`。

各后端命中那一层会读现场，例如读版本库配置、列工作单元目录，必要时起子进程，不消耗远端接口配额。它是三层里最弱，也最贵的一层。在只求结论的范围下，只在前两层都没给出可用结论时才问。来源是 `src/tracker/detection/backendDecision.ts:905-912`。

两个历史结论已经落地，不再回头。第一，注册表里那份进程内副本已经整段删除，判定出口第一层直接读工作区文件，写文件成功才算这次选择生效。来源是 #1138 票正文的做完的标志第 1 至 3 条，以及 `docs/adr/20261012-backend-decision-two-classes.md:66-84`。第二，宿主侧按工作区记的选择不再参与后端判定，只用来把工作区文件生成一次，以及回答布局问题。来源是 `CONTEXT.md:154` 与 `docs/adr/20261012-backend-decision-two-classes.md:43-44`。任何地方都不许再靠本进程里有绑定来答话。来源是 `docs/adr/20261012-backend-decision-two-classes.md:76-83`。

## 5. 给 #1233 的可执行建议

1. 把统一入口写成一句话，判定的唯一出口是 `wf.selection` 背后的 `decideBackend` 函数，别人只许包它，不许另写。来源是 `src/host/workspaceCwd.ts:227-229`。
2. 把总览的调用序列写死，先拿工作区名单，再批量预读，最后逐个问统一入口。明确写出总览不直接读文件，不自己拼绑定，不读已经删掉的绑定格，不猜工作区名单。来源是 `src/client/views/SettingsWorkspaces.js:24-44` 与 `src/host/workspaceCwd.ts:211-214`。
3. 把落盘依据写成只认新的工作区文件。把老文件的读取写成临时的迁移路径，写清触发条件与删掉它的时间，而不是长期保留的第二依据。理由是代码里两处读文件的地方今天还是先新后旧，来源是 `src/host/workspaceCwd.ts:174-175` 与 `src/tracker/detection/backendDecision.ts:822-826`，这与用户对齐的硬性要求不一致，需要定版时收口。
4. 把写权限写清，只有人选那一层能写，程序自己认的两层一律不给写权限。来源是 `docs/adr/20261012-backend-decision-two-classes.md:47-49` 与 `src/tracker/detection/backendDecision.ts:1086-1087`。
5. 把缺轮子时先修哪里写清，判定函数没有装上就修装配，总览不好批量问就给统一入口加批量能力。来源是 `src/host/platformChannel.ts:470-477` 与 `src/host/workspaceCwd.ts:229-232`。
6. 把转语言的要求写进落地票。本次摸到的设置页总览还是手写的 JavaScript，要转成 TypeScript，转完删旧文件。来源是 `src/client/views/SettingsWorkspaces.js:1-8`。

## 6. 给 #1231 落地时删哪段重复逻辑的建议

1. 删掉总览侧自己算绑定的逻辑，只留统一入口的结论。批量预读可以留作性能手段，但展示口径必须以统一入口为准。来源是 `src/client/views/SettingsWorkspaces.js:103-112` 的双来源判断。
2. 删掉宿主侧与判定侧重复的文件读取，只留判定出口里那一处，或者把宿主侧批量预读改成直接调用判定出口的读文件层。理由是两处今天是同一顺序的两份实现，来源是 `src/host/workspaceCwd.ts:169-184` 与 `src/tracker/detection/backendDecision.ts:821-864`。
3. 按定版口径删掉老文件路径的分支，或者把它收成迁移专用的一次性路径。涉及的常量是老文件位置，来源是 `src/deck/shell/workspace-anchor.ts:35-36`，使用点是上面第 2 条的两处。
4. 删掉客户端里对已经删掉的绑定格的残留读取与兼容分支。全仓已经确认没有调用方读它，来源是 `src/host/workspaceCwd.ts:211-214` 与 `research/1047-binding-removal-facts.md:78-81`。

## 7. 来源索引

1. `src/host/workspaceCwd.ts:163-184`：批量预读的说明注释与按候选目录读工作区文件的实现，新路径优先、老文件兼容读。
2. `src/host/workspaceCwd.ts:185-205`：`handleBindings` 的实现，传入目录清单，返回批量绑定的信封。
3. `src/host/workspaceCwd.ts:206-216`：`handleRegistry` 的实现，只回后端模块名单，绑定格已删。
4. `src/host/workspaceCwd.ts:217-242`：`handleSelection` 的实现，统一判定出口的调用形状与返回信封，含空目录闸与迁移捎带。
5. `src/host/index.ts:280-283`：四条电话的装配，查询用的三条与写入口各归其位。
6. `src/host/platformChannel.ts:470-477`：判定函数的装配点，缺了时总览拿不到统一结论。
7. `src/tracker/detection/backendDecision.ts:382-396`：`selectionFromOutlet` 的实现，对外五个字段的整理规则。
8. `src/tracker/detection/backendDecision.ts:821-864`：工作区文件层的读法，新优先、老兼容，文件不在与读不成要分开。
9. `src/tracker/detection/backendDecision.ts:866-903`：声明文件层的读法，与探测器用同一套解析器。
10. `src/tracker/detection/backendDecision.ts:905-934`：三层证据的收集范围，只求结论时最贵的一层最后才问。
11. `src/tracker/detection/backendDecision.ts:1089-1151`：`decideBackend` 的实现，空目录直接按未知回，否则收集证据再合成结论。
12. `src/deck/shell/workspace-anchor.ts:34-39`：新老路径常量的取值，新写入一律走新路径。
13. `src/shared/config-store/src/workspace.ts:20-24`：新老路径与认识版本号的定义。
14. `src/shared/config-store/src/workspace.ts:41-44`：允许的来源、布局与已知键。
15. `src/shared/config-store/src/workspace.ts:128-171`：校验规则，后端名非空、多余键判坏、高版本只读、布局缺席允许。
16. `src/shared/config-store/src/workspace.ts:175-212`：拼装规则，一律出版本 2，注释由程序生成。
17. `src/client/views/SettingsWorkspaces.js:8-50`：总览钩子的调用序列，先拿模块名单，再拿工作区名单，再批量预读，最后逐个问统一入口。
18. `src/client/views/SettingsWorkspaces.js:103-136`：总览渲染时的双来源判断与排序展示。
19. `docs/adr/20261012-backend-decision-two-classes.md:23-35`：判定三层归两类的裁决，人选只有工作区文件一份记录。
20. `docs/adr/20261012-backend-decision-two-classes.md:66-87`：#1138 落地后的修订，删掉进程内副本的理由与跟着改的地方。
21. `research/1047-binding-removal-facts.md:64-96`：四条电话与界面消费点的事实清单，绑定格没有客户端消费点。
22. `CONTEXT.md:121-125`：所选目录、工作区根、子工作区的定义，总览传参时只用原文定义。
23. `CONTEXT.md:69-73`：工作区共享数据与后端选择集的定义，跨会话下次生效，不即时跳变。
24. `CONTEXT.md:152-156`：人选、程序自己认、声明文件的定义，人选写进文件才算生效。
25. #1138 票正文与评论：做完的标志五条与三处要写清，副本已删、电话改道、写失败如实报。
26. #1012 相关迁移说明：新路径优先、老文件兼容读、写成功后再处理老文件，新代码全用 TypeScript。
