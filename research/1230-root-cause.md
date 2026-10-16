# 研究：总览全显示未绑定的根因证据链（#1230）

> 本文件只写从一手来源读到的事实。每条结论后面紧跟文件与行号。全文使用完整句子，只使用术语表里已有的词，或者不需要解释的大白话。

## 1. 复现链：点了哪里，调了哪几条电话，每条回了什么

第一步是人打开设置页。设置页只读全局总览，不做修改，也不调绑定的写入口。这句话写在 `src/client/views/SettingsPage.ts:51` 的注释里，原文说只读全局总览，不调写入口。

第二步是界面向工作区服务要名单。代码在 `src/client/views/SettingsWorkspaces.js:27-33`。它先问工作区服务手上的快照，快照可能是装着多个工作区条目的列表，也可能是按编号存放的对象，也可能是一个可以直接调的函数，拿不到才调备用入口。每个条目取路径时按顺序试多个字段，代码在 `src/client/views/SettingsWorkspaces.js:35`，字段包括路径、当前目录、目录、工作区路径等。客户端把拿到的路径只做一次很轻的整理，代码在 `src/client/views/SettingsWorkspaces.js:10-15`，绝对路径只去掉末尾的斜杠，相对路径原样交给宿主。名单去重按字符串完全相同判断，代码在 `src/client/views/SettingsWorkspaces.js:35`。这份名单给的是人选过的目录，不是锚定之后的工作区根，客户端把所选目录到工作区根的对应关系记在另一张表里，代码在 `src/client/kernel/store-snapshot.js:57-77`，总览只是查这张表加一句说明，不删除任何行，注释写明不删除也不迁移，代码在 `src/client/views/SettingsWorkspaces.js:73-78`。

第三步是界面带着这份名单问哪些工作区已经选过后端。电话名是工作区绑定列表，调用时把名单原样递过去，代码在 `src/client/views/SettingsWorkspaces.js:40`，注释说明这条电话不再读宿主进程里的旧副本，改成按给定的目录去读各工作区里的文件，代码在 `src/client/views/SettingsWorkspaces.js:36-38`。宿主收到后对每个目录先做一次归一，代码在 `src/host/workspaceCwd.ts:56-58`，归一转交统一的键函数。统一的键函数先把大小写和斜杠洗成同一把钥匙，再往上找到工作区根，洗钥匙的代码在 `src/host/workspaceKey.js:22-48`，找根的规则在 `src/host/workspaceKey.js:157-199`，三步合在一起的出口在 `src/host/workspaceKey.js:201-254`。然后宿主按归一后的目录去读工作区配置文件，新文件优先，老文件兼容，代码在 `src/host/workspaceCwd.ts:169-184`，新老路径常量在 `src/deck/shell/workspace-anchor.ts:34-36`，形状不对一律按没有这一层处理，代码在 `src/deck/shell/workspace-anchor.ts:58-60`。如果没有读到记录，或者记录里没有后端名，这一行直接跳过，不放进回包，代码在 `src/host/workspaceCwd.ts:197-198`。读到记录才放进回包，形状是目录、后端名、来源固定写人选，代码在 `src/host/workspaceCwd.ts:199-201`。所以这条电话的回包只装已经选过的行，没有选过的行不会出现，回包形状是成功加一个列表，代码在 `src/host/workspaceCwd.ts:203`。

第四步是界面对名单里的每个目录逐个问统一判定出口。电话名是工作区判定，循环逐个等待，代码在 `src/client/views/SettingsWorkspaces.js:44`，结果按请求时的目录存起来。如果目录是空的，宿主直接回还没有就绪的那一档，代码在 `src/host/workspaceCwd.ts:219-220`。目录非空时先归一，代码在 `src/host/workspaceCwd.ts:221`，再调统一判定出口，调用时注明调用方是工作区判定，代码在 `src/host/workspaceCwd.ts:235`。判定出口内部按三层顺序取第一条结论，三层是工作区文件、声明文件、各后端自己认领，顺序声明在 `src/tracker/detection/backendDecision.ts:83`。工作区文件那一层新文件优先、老文件兼容，代码在 `src/tracker/detection/backendDecision.ts:821-826`，读到后端名就是命中，文件不在、文件里没有后端名、文件读坏、文件读失败各有不同的结论词，代码在 `src/tracker/detection/backendDecision.ts:844-851`。声明文件那一层读工作区里的票仓说明文件，代码在 `src/tracker/detection/backendDecision.ts:881-897`。三层都没有结论时合成还没有选后端的那一档，形状是后端名是空、来源是回落、起点是空，代码在 `src/tracker/detection/backendDecision.ts:725-727`。宿主把这个结果原样交给界面，拿不到结果才用一个空的回落形状代替，代码在 `src/host/workspaceCwd.ts:237-240`。

第五步是界面渲染。界面把绑定列表按目录原样做成一张表，键没有再做归一，代码在 `src/client/views/SettingsWorkspaces.js:98`。判定结果按请求时的目录存另一张表。两张表并起来再加工作区名单去重成最终要显示的行，代码在 `src/client/views/SettingsWorkspaces.js:99-100`。某一行算不算已绑定，看两张表里有没有带后端名的结果，代码在 `src/client/views/SettingsWorkspaces.js:105`。有后端名就显示后端名，没有就显示还没有绑定的字样，代码在 `src/client/views/SettingsWorkspaces.js:125-127`。来源是人选就显示人选，是程序自己认就显示自动，否则显示还没有指定的字样，代码在 `src/client/views/SettingsWorkspaces.js:129-132`。显示名只取路径最后一段，代码在 `src/client/views/SettingsWorkspaces.js:107` 与 `src/client/views/SettingsWorkspaces.js:133`。表头总数是最终行数，已绑定数是算出已绑定的行数，代码在 `src/client/views/SettingsWorkspaces.js:108-113` 与 `src/client/views/SettingsWorkspaces.js:120`。加载中与报错各有一行，代码在 `src/client/views/SettingsWorkspaces.js:122-123`。截图里没有报错也没有加载态，说明三条电话都成功返回，只是每行的结果都是还没有选后端的那一档。

## 2. 候选根因分级

### 2.1 主因：工作区根上没有人选的记录，列表电话跳过，判定电话回落

证据是宿主读文件的两处。列表电话没有记录直接跳过，代码在 `src/host/workspaceCwd.ts:197-198`。判定电话三层无结论合成回落，代码在 `src/tracker/detection/backendDecision.ts:725-727`。界面判定已绑定的条件是有后端名，代码在 `src/client/views/SettingsWorkspaces.js:105`。三处连起来就是，没有记录的行必然显示还没有绑定加还没有指定。

反例也很直接。如果工作区根上的工作区配置文件里写着后端名，读文件的函数会把它返回，代码在 `src/host/workspaceCwd.ts:178-180`，列表电话会把它放进回包，代码在 `src/host/workspaceCwd.ts:199-201`，判定电话第一层会命中，代码在 `src/tracker/detection/backendDecision.ts:844-845`，界面会判为已绑定。所以代码没有把已绑定吃掉，吃掉的前提是文件里本来就没有。

补充一条改动背景。以前注册表里还有一份进程内副本，重启就消失，注释说明它已整段删除，代码在 `src/tracker/registry/core.ts:10-17`，没有绑定操作是故意的，不是漏了，代码在 `src/tracker/registry/core.ts:90`。列表电话因此改成读文件，注释在 `src/client/views/SettingsWorkspaces.js:36-38` 与 `src/host/workspaceCwd.ts:163-168`。注册表查询电话也去掉了已绑定那一格，注释说没有东西可答就不凑一个值，代码在 `src/host/workspaceCwd.ts:206-215`。这意味着以前在旧版本里点过、但没有写进文件的选择，升级后必然显示没有绑定。这与截图里十一行全是没有绑定一致。

要定死这一条，还需要在真机上看一眼十一个目录各自的工作区根上有没有工作区配置文件。本研究只读代码，没有改代码，也没有读用户机器上的文件，所以这一条目前是基于代码链的判定，文件是否真的缺席留给复现时按目录逐个确认。

### 2.2 次因：客户端与宿主用的目录写法不一致，可能让已绑定的行对不上

证据是两边归一不一样。客户端只去尾斜杠，代码在 `src/client/views/SettingsWorkspaces.js:10-15`。宿主洗大小写、统一斜杠、再锚到工作区根，代码在 `src/host/workspaceKey.js:22-48` 与 `src/host/workspaceKey.js:201-254`。界面做绑定表时键没有再归一，代码在 `src/client/views/SettingsWorkspaces.js:98`。如果宿主回来的目录是锚定后的工作区根，而界面手上的行是子目录，两边字符串对不上，绑定表那一侧就命中不了。

反例是判定结果那一侧不受这条影响，因为判定是按请求时的目录存的，代码在 `src/client/views/SettingsWorkspaces.js:44`，请求发哪个目录就存哪个目录。所以即使绑定表对不上，只要文件里有记录，判定那一侧仍会命中，界面仍判已绑定，判定条件是两表任一有后端名，代码在 `src/client/views/SettingsWorkspaces.js:105`。因此这一条不能单独造成十一行全是没有绑定，只能在边界上放大计数与显示问题，或者在个别行上让绑定数少算。

### 2.3 次因：名单里同时装着工作区根与它的子目录，但只标注归属，不合并行

证据是总览的注释写明只加一句说明，不删除行，代码在 `src/client/views/SettingsWorkspaces.js:73-78`。归属判断靠所选目录到工作区根的表，代码在 `src/client/views/SettingsWorkspaces.js:79-92` 与 `src/client/kernel/store-snapshot.js:57-77`。合并到的根只在悬停与括号里说明，代码在 `src/client/views/SettingsWorkspaces.js:134-138`。最终行把三处来源并起来去重，代码在 `src/client/views/SettingsWorkspaces.js:100`。同一个仓库因此可以占两行，一行是根，一行是子目录。

### 2.4 排除项：老文件里有记录但新文件里没有

代码上老文件仍兼容读，列表电话按新老顺序读，代码在 `src/host/workspaceCwd.ts:175`，判定出口同样新优先老兼容，代码在 `src/tracker/detection/backendDecision.ts:822-826`。但是本次任务的铁律写明落盘只认工作区根下的新文件，老文件不考虑。所以即使老文件里有记录，按任务口径仍应判为没有绑定，不算程序吃掉。这条排除不是因为代码不读，而是因为任务口径不认。

### 2.5 排除项：声明文件与自动识别那两层坏了

如果这两层坏了，人选那一层仍在前面，顺序声明在 `src/tracker/detection/backendDecision.ts:83`。人选命中就停，不会走到后面。十一行全是没有绑定，说明人选层已经是缺席，声明与自动识别只是同样没有给出结论，不是把人选覆盖掉。它们的读法各有缺席与读失败的区分，代码在 `src/tracker/detection/backendDecision.ts:851` 与 `src/tracker/detection/backendDecision.ts:887-888`，读失败不会伪装成确实没有。

### 2.6 排除项：空目录那条回包

空目录回的是还没有就绪，代码在 `src/host/workspaceCwd.ts:219-220`，界面会按来源显示不同的字样，代码在 `src/client/views/SettingsWorkspaces.js:129-132`。截图里是还没有指定，不是还没有就绪，且总览在名单为空时会用当前目录补一行，代码在 `src/client/views/SettingsWorkspaces.js:42`。所以走的不是空目录那条路。

### 2.7 排除项：两个验证文件能证明绑定语义

新的设置页验证脚本只点设置页截图、查横向滚动，代码在 `scripts/ui-verify-new-settings.mjs:1-70`，不问绑定语义。配置面板滚动验证页只验滚动容器数，全文件二百三十三行里没有绑定判定。两者都不能用来证明绑定对错，只能用来排除样式干扰。

### 2.8 排除项：新旧格式统一那次改动本身吃掉记录

统一改动的定案是三份配置改可读格式、读写只有一份实现、老文件继续读、读到就迁，事实整理在 `research/1012-final-plan.md:10` 与 `research/1012-final-plan.md:32`。解析坏形状回空的兜底在 `src/deck/shell/workspace-anchor.ts:58-60`。版本高于认识的按没有这一层处理，注释在 `src/deck/shell/workspace-anchor.ts:53-55`。这条只有在文件版本写高时才触发，属于个别文件问题，不能解释十一行全是没有绑定，且核对时应先看文件在不在，再看版本对不对。

## 3. 重名与计数解释

总数十一是三处来源并起来的行数，不是工作区根的个数。算法是工作区服务名单加绑定表加判定表去重，代码在 `src/client/views/SettingsWorkspaces.js:100`，表头总数取这个长度，代码在 `src/client/views/SettingsWorkspaces.js:120`。工作区服务给的是所选目录，子目录与根可以同时在名单里，而合并规则只标注归属，不删除行，依据见 `src/client/views/SettingsWorkspaces.js:73-78` 与共享范围改为按工作区根共享的词条。显示名只取最后一段，代码在 `src/client/views/SettingsWorkspaces.js:107` 与 `src/client/views/SettingsWorkspaces.js:133`，于是不同父目录下的同名目录显示成一模一样的两行。截图里同名出现两次且只显示最后一段，与这段代码一致。已绑定零是已绑定行数，算法是过滤出带后端名的行再计数，代码在 `src/client/views/SettingsWorkspaces.js:108-113`。十一行都没有后端名，所以总数是十一，已绑定是零。

## 4. 给 #1233 的最小修复方向，只指方向，不写代码

先定听谁的。按证据链，总览不直读文件，只问统一判定出口，而统一判定出口的第一层就是工作区文件。所以 #1233 定版应听统一判定出口的结论，不另立第二套判断。复现时先按十一个目录逐个确认工作区根上有没有工作区配置文件，文件缺席就走写入口补选，不改总览。

如果文件明明在而总览仍显示没有绑定，再修封装，不在界面里打补丁。方向是把目录的归一收进同一处封装，让名单、绑定表、判定表用同一把钥匙比对，缺轮子先修封装。行数与重名分两步走，先把子目录行按工作区根合并计数，再把显示名从只取最后一段改成能区分同名的写法。注册表那一格已经去掉，不再补回，依据是 `src/host/workspaceCwd.ts:211-213` 的注释，要问用哪个后端请走判定电话。
