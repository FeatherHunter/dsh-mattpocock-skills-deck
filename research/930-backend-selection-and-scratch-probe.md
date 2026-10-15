# 930 号票两个缺陷在今天这棵树里还能不能复现

调查日期：2026-10-15。调查当时代码停在 `f3da13da 地图09收尾：日志出口的同形复制收进内核一份，本房识别路径的失败不再被吞掉（#1182）`。
这份报告只回答「今天还有没有能复现那两个缺陷的代码路径」，不改任何代码、测试与配置。

先说清三个反复出现的词，免得只有当天在场的人才懂：

- 后端选择：决定这一次 `deck_*` 工具该用哪一套后端（本地 Markdown 文件，还是远端的 GitHub）的那一步。
- 工作区文件：放在被操作的仓库里的 `docs/agents/workspace.yaml`，里面写着「这个工作区上一次由用户亲手选了哪个后端」。它是人选留下的唯一一份记录。
- 写探测：不靠权限位、而是真的往目标目录写一个小临时文件再删掉，用「写得进去吗」来判断目录到底可不可写。

## 1. 票面说的两个缺陷

- 缺陷 A：`deck_*` 工具判定「用哪个后端」时，拿去查表的那条目录没有做归一。同一个工作区在宿主那一侧存的是归一后的小写、正斜杠、锚到工作区根的写法，而工具这一侧直接拿会话给的原始目录去查，命中不了任何人选记录，于是退回「各后端自己认领」那一层，认领平局时取注册顺序里的第一个，结果用户明明选的是本地 Markdown，工具却跑去 GitHub 上干活，写操作还可能落到别的仓库。
- 缺陷 B：检查链里的写探测（检查项 `md:scratchWritable`，界面上的名字是「本地数据目录可读写」）调用写文件时没有把本次调用的沙箱许可带上。沙箱于是按最窄的默认政策判，写探测永远被拒，这一行的状态永远是灰色等待（而不是红色失败），用户看不出到底是「目录不可写」还是「根本没量」。

## 2. 今天缺陷 A 对应的代码

判定：**(b) 已被新结构消除**。今天没有任何一处代码会因为「存钥匙时用了归一写法、读钥匙时用了原始写法」而失配，因为钥匙比较这件事本身已经不存在了。

- 人选不再存在注册表的进程内存里。`src/tracker/registry/core.ts:11-13` 与 `:85` 记着这段历史：注册表里的 `bind` / `bound` / `allBindings` 三个口子已经整段删掉（#1138），理由写得很直白——注册表里那份副本与工作区文件记的是同一件事，却是两份记录，宿主一重启就只剩一份，「用户的选择因此有两个家」。
- 工具侧取会话目录并做归一：`src/deck/shell/session-workdir.ts:142-166`。第 157 行调宿主注入的归一出口 `canonicalKey`，第 162-163 行在算不出规范根时如实失败（不拿原始目录凑一把钥匙），第 166 行把归一后的 `cwd` 与 `rawCwd` 一起交出去——原文只留给排错看，不再参与查表。
- 归一出口只有一处实现，由宿主注入：接线处是 `src/host/refresh/wiring.js:397`（`canonicalKey`），宿主入口把 `src/host/index.js:84` 的 `canonicalKey` 转进去，真正的实现在 `src/host/git-process.ts:346`（`async function canonicalKey(raw?: string)`，同文件 `:463` 转出）。
- 后端选择的入口：`src/deck/tools/context.ts:79` 调 `sessionContextOfAsync`，然后交给 `src/deck/shell/call-shell.ts:238` 的 `pickBackend`。
- 判定出口读盘，不查表：`src/tracker/detection/backendDecision.ts:853-854` 在 `readWorkspaceFileText` 拿到文本之后交给 `parseWorkspaceFile` 解析；工作区文件的位置写在 `src/deck/shell/workspace-anchor.ts:34`（`WORKSPACE_FILE_REL`），老位置 `docs/agents/workspace.json` 只做兼容读，见同文件 `:36`。
- 两个会话目录写法归一后是同一把钥匙：`workspaceKeyOf` 的实现只有一处（`src/shared/refresh-workspace-key.js`，经 `src/host/refresh/wiring.js:51,53` 转出）。
- 「同一工作区被多个后端认出」时的处理，今天分两段：判定出口按明文顺序裁剪认领名单（`src/tracker/detection/backendDecision.ts:349` 的 `MULTI_CLAIM_ORDER = ['github', 'markdown', 'gitlab']`，裁剪在 `:555-565`），也就是说多房认领时它自己会挑出排在前面的那一个；工具外壳再兜一层，只有在结论是「显式选择之外的多命中」或「还没定下来」时才拒绝执行，见 `src/deck/shell/call-shell.ts:334`，回绝文案分别是「这个工作区同时被 N 个后端认出，请在面板中选定后再试」与「后端还没定下来，先在面板上选一次后端」。

也就是说，票面说的「看不见用户选的后端」具体丢在哪一步，答案是：**丢在「注册表的进程内副本」这一步**。而这个副本连同那把按工作区算的句柄键，已经在 #1138 整段删掉了；今天的选择是每次调用现读工作区文件，读到的就是用户亲手写下的那一个后端名，没有第二份记录可以失配。

## 3. 今天缺陷 B 对应的代码

判定：**(b) 已被新结构消除**，写探测今天会真的落地写一次并回读结果。

- 检查项的定义：`src/shared/tracker/check-catalog-dirs.js:174-182`，`md:scratchWritable` 的判定方式是 `{ kind: 'primitive', primitive: DIR_WRITABLE, path: '.scratch' }`。同一份文件 `:172-173` 记着更早的一次修正：这一项原先用「文件存在」来判，从来不测可写，2026-08-29 才改成写探测。
- 写探测的实现：`src/host/tracker/predicatePrimitives.js:115` 起，探针文件名是 `.dsh-write-probe`（`:125`）。第 158-160 行是这次修复的要害：取到本次调用的 `ctx.sandboxPolicy` 就带着它写（`p.fs.writeText(probeT, 'ok', undefined, undefined, probePolicy)`），取不到就不带参数写。写完在 `:161` 起尽力清理这个临时文件。
- 许可从哪里来：`src/host/detectChain.ts:278-279` 先问 `sandboxPolicyFor({ cwd, sessionId })`，把拿到的 policy 放进传给谓词注册表的上下文里（`sandboxPolicy: chainPolicy`）；真正按会话算出这份许可的是 `src/host/index.js:137` 那一行的 `sandboxPolicyFor`，它按会话号取会话、取不到再按工作区目录在会话列表里回退匹配。
- 沙箱拒绝与目录不可写的分档：`predicatePrimitives.js:176` 把沙箱拒绝写成「沙箱没放行这次探测，可写性没有验证（目录是存在的）」，状态判等待而不是失败。这正是票面说的「恒灰」被拆成了两件事：量不出（灰）与真不可写（红）。

## 4. 实测证据

调查当时跑了两道与本票直接相关的门禁，都没有改动它们：

- `node --import ./scripts/ts-hook.mjs tests/verify-934-935-invariants.js` —— 18 条全通过。这一道门禁的文件头第 4 行就写着它盯的是「930 缺陷 A/B 的不变式形态」。关键几条：I1 用 `D:\Temp\demo-ws` 与 `d:/temp/demo-ws/` 两种写法各走一遍，归一后同根、同闸钥匙，两次都命中显式选择的 markdown；I1b 多房认领且没有显式选择时判冲突，不回注册顺序的第一个；I4b 写探测把本次调用的许可透传给文件服务，无许可时判灰且文案讲的是沙箱而不是「目录不可写」。
- `node --import ./scripts/ts-hook.mjs tests/verify-dirwritable.js` —— 22 条全通过。D1 验的是可写目录判通过、探针确实写进了目标目录、随后被清理；D5 验的是 markdown 目录里含 `md:scratchWritable`、它已切换为写探测原语、目标是 `.scratch`，而 GitHub 目录里不含这一项；D8/D9 验的是沙箱拒绝判灰、系统级权限错误仍判红。

修复这两处的提交是 `5a8b697c 收敛工作区钥匙与沙箱政策两条不变式，让显式绑定命中与写探测带许可（933/934/935/936）`（2026-10-09），它一次改了 24 个文件，正是把 `canonicalKey` 接到工具壳、把沙箱政策接到写探测的那一次；本票的两道门禁也是那一次加进来的。

## 5. 不确定的地方

1. 今天的门禁全部是夹具驱动的：它用一个与生产同形的归一替身、一个内存账本当作「工作区磁盘」来验证不变式，没有一条是从真实会话目录出发、真读盘上那份 `docs/agents/workspace.yaml` 的端到端走查。要彻底排除「真实归一出口在这台机器上把两种写法算成两把钥匙」这一种可能，还需要一次真盘走查。
2. 缺陷 A 的第二半「多房认领时报冲突」在两处各有一半：判定出口按 `MULTI_CLAIM_ORDER` 自己挑一个，工具外壳只在多命中且不是显式选择时才拒绝。也就是说，如果同一个工作区既被 GitHub 房认领又被本地 Markdown 房认领，而用户没有显式选过，工具会按明文顺序选 GitHub，而不是报冲突。这是有意的排序规则（有注释与日志说明），但它与「多命中即冲突」的读法不完全一致，判断口径值得确认一次。
3. 沙箱许可要经过「按会话号取会话、取不到再按目录在会话列表里回退匹配」这一段（`src/host/index.js:137`）。这一段自己没有独立门禁守着，I4b 验的是「拿到许可之后有没有传下去」，没有验「许可有没有被正确取到」。如果会话号与目录两者都取不到，写探测仍然会判灰——那是「量不出」，不是这次的恒灰缺陷，但两者在界面上看起来一样。
4. 代码里有几处注释还指着搬家前的老路径（例如 `src/host/refresh/wiring.js:101` 说归一出口在 `src/host/repoKeys.js`，而那个文件今天已经不存在，实现落在 `src/host/git-process.ts:346`）。这属于注释漂移，不影响行为，但会让后来查这段逻辑的人先走一段错路。

## 6. 如果真要处理，该怎么做

- 两个缺陷都不必再修：它们各自的复现路径在 #1138 与 `5a8b697c` 之后已经不存在。
- 值得补的是第 5 节那三条：加一次从真实会话目录出发的端到端走查（真盘上的工作区文件）；把「多房认领时到底该按顺序选还是该报冲突」写成一句明文决定，并让门禁只守这一种读法；给「沙箱许可有没有取到」补一条门禁，让它与「许可有没有传下去」分开守。
- 如果这些确认都做完了，这张票可以直接关掉，并在关闭评论里指向 `5a8b697c` 与 `tests/verify-934-935-invariants.js`。

## 7. 附：调查当时的现场

- `git log -1 --oneline`：`f3da13da 地图09收尾：日志出口的同形复制收进内核一份，本房识别路径的失败不再被吞掉（#1182）`。
- `git status --porcelain` 显示工作树里另有别的会话留下的改动，本次调查一行都没有碰：已跟踪文件里 `src/tracker/contract/README.md`、`src/tracker/contract/backend-module.ts`、`src/tracker/rooms/github/checks.ts`、`src/tracker/rooms/github/index.ts`、`src/tracker/rooms/gitlab/index.ts`、`src/tracker/rooms/markdown/index.ts`、`tests/verify-contract-types.js` 处于已修改未提交状态；另有四份未跟踪的研究笔记 `research/783-ticket-identity-and-source.md`、`research/895-batch-write-timeout.md`、`research/898-blocked-by-overwrite.md`、`research/971-markdown-parent-edge.md`。
