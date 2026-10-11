# 我们的 deck 工具都是用 TypeScript 写的吗（2026-10-10 调研）

这次只看仓库里的原始文件，没有看任何二手总结。

## 结论一句话

不是，9 个对外 deck 工具的每一行实现代码都是用 JavaScript 写的，仓库里的 TypeScript 文件全部在别的地方，管的是颜色计算、刷新规则、版本解析、配置读写和面板界面这几件事，没有一件直接实现 deck 工具。

## 9 个工具对照表（工具名 → 文件 → 语言）

下面 9 行就是对外提供的全部 deck 工具，顺序与装配顺序文件里写的顺序一致。每个文件的后缀都是 `.js`，文件头第一行注释里写的也是该文件的 `.js` 路径，每个文件里都用 `export const definition` 写出工具定义、用 `export function createDeck...` 写出创建函数。

| 对外工具名 | 实现文件 | 语言 |
| --- | --- | --- |
| deck_context | src/host/tools/deckContext.js | JavaScript |
| deck_issue_get | src/host/tools/deckIssueGet.js | JavaScript |
| deck_map_snapshot | src/host/tools/deckMapSnapshot.js | JavaScript |
| deck_issue_list | src/host/tools/deckIssueList.js | JavaScript |
| deck_issue_create | src/host/tools/deckIssueCreate.js | JavaScript |
| deck_map_plan_create | src/host/tools/deckMapPlanCreate.js | JavaScript |
| deck_map_link | src/host/tools/deckMapLink.js | JavaScript |
| deck_issue_patch | src/host/tools/deckIssuePatch.js | JavaScript |
| deck_issue_report | src/host/tools/deckIssueReport.js | JavaScript |

这 9 个工具之外的支撑文件也全部是 JavaScript：

- 共享目录 src/shared/deck-tools/ 下 10 个文件全部是 `.js`，分别是 plan.js、shell.js、exec-cell.js、agent-register.js、plan-store.js、edges.js、workspace-file.js、key-lock.js、session-resolve.js、call-scope.js。它们管的是 9 个工具共用的规则，例如补必备标签、补进度区、过宿主闸、从会话上下文取工作区目录、永不抛异常这几条。
- 装配用的两个文件也是 `.js`，分别是 src/host/platform/deckToolsAssembly.js（把 9 个工具文件读进来装成一张表）和 src/host/platform/deckToolsRow.js（把 9 个工具的定义交到 agent 层注册）。
- 顺序清单在 src/shared/deck-tools/plan.js 里的 DECK_TOOL_ORDER，常量里按顺序写着上面 9 个工具名。

## 仓库里 TypeScript 文件到底在哪里、管什么

仓库里确实有 TypeScript 文件，但没有一个落在 deck 工具链路上。它们分成两批。

第一批：4 个独立目录里用 TypeScript 写的共用计算部分，一共 35 个 `.ts` 文件。

- label-color-core/src/ 下 3 个文件：ports.ts、colors.ts、prompt.ts。管的是标签颜色的归一化、颜色合法性判断、颜色有没有变、给人看的提示语怎么写。
- refresh-core/src/ 下 14 个文件：ports.ts、budget.ts、policy.ts、backoff.ts、attention.ts、chain.ts、delta.ts、idempotency.ts、tool-cost.ts、write-detect.ts、create-write.ts、page-budget.ts、backend-quota.ts、failure-window.ts。管的是面板刷新相关的规则，例如新鲜度阈值、合并窗口、退避等待、注意力心跳、写操作识别、工具花费估算。
- version-control-core/src/ 下 14 个文件：ports.ts、capabilities.ts、commands.ts、rules.ts、state.ts、parse-status.ts、parse-worktrees.ts、parse-refs.ts、parse-log.ts、parse-diff-files.ts、parse-patch.ts、write-ticket.ts、write-reasons.ts、push-plan.ts。管的是版本管理页签的判定和解析，例如能不能暂存和提交、怎么读工作树列表、怎么解析差异内容。
- config-store-core/src/ 下 4 个文件：ports.ts、workspace.ts、settings.ts、labels.ts。管的是配置的读写，例如当前工作区归属、设置项、标签配置。

这 4 个目录里的每个 `.ts` 文件，都会被翻译成 src/shared/ 下对应目录里的同名 `.js` 文件。翻译后的文件头第一行都写着是由哪个 `.ts` 文件生成的，请勿手改。例如 src/shared/label-color/colors.js 的第一行写着它是由 label-color-core/src/colors.ts 生成的。

第二批：src/client/ 下面板界面用的 TypeScript 真源，大约 34 个 `.ts` 文件，另外还有 4 个只放类型说明的 `.d.ts` 文件。

- 位置集中在 src/client/views/pixel/（像素风按钮、圆点、数字、印章、骨架、横幅这一类最小组件）、src/client/views/cards/（三种卡片和卡片上的标题、标签、备注、按钮这一类）、src/client/views/skillDetail/（技能详情页的排版、列表、弹窗、操作这一类）、src/client/kernel/locale-cards.ts 和 src/client/kernel/locale-skilldetail.ts（卡片和技能详情页的中英文词条）。
- 每个 `.ts` 文件旁边都有一个构建生成的同名 `.js` 文件。例如 src/client/views/pixel/PixelBtn.ts 是手写的真源，旁边 src/client/views/pixel/PixelBtn.js 的第一行写着它是由这个 `.ts` 文件生成的，请勿手改。
- 它们管的都是面板长什么样、按钮点了发生什么、中英文词条怎么写，没有一个文件实现 deck 工具的读写逻辑。

## 为什么容易误以为全是 TypeScript

构建脚本 scripts/build.mjs 里有一段很显眼的说明，写着先把 TypeScript 写的共用部分逐个翻译成 JavaScript，再做后面的打包。对应代码里连续 4 段分别加载 label-color-core/build.mjs、refresh-core/build.mjs、version-control-core/build.mjs、config-store-core/build.mjs，每段下面都写着如果加载不到就打印一行提示然后跳过这一步、其余照跑。

而这 4 个目录各自的 build.mjs 文件头都写着同一句话：用仓库现成的 esbuild 把本目录 src/ 下每个 TypeScript 文件一对一翻译成 src/shared/ 下的同名 JavaScript 文件，另外跑一次类型检查只检查类型对不对。翻译出来的 JavaScript 文件会提交到仓库里，改了 TypeScript 却没有重新生成，对应的新鲜度检查就会变红。

也就是说，只要看构建日志，就会反复看到 TypeScript 翻译成功的提示；只要打开 src/shared/label-color/、src/shared/refresh/、src/shared/version-control/、src/shared/config-store/ 或 src/client/views/ 下的生成文件，就会反复看到第一行写着它是由某个 `.ts` 文件生成的。这两处痕迹都很密，很容易留下全仓都是 TypeScript 的印象。但 deck 工具住的 src/host/tools/、src/shared/deck-tools/、src/host/platform/deckToolsAssembly.js 与 deckToolsRow.js 这几处，没有经过上面任何一段翻译，原文件就是可以直接运行的 JavaScript。

## 每个断言的来源文件路径

- 9 个对外工具的文件名都是 `.js`：src/host/tools/ 目录的 glob 结果是 deckContext.js、deckIssueGet.js、deckMapSnapshot.js、deckIssueList.js、deckIssueCreate.js、deckMapPlanCreate.js、deckMapLink.js、deckIssuePatch.js、deckIssueReport.js，共 9 个，没有 `.ts` 文件。
- 9 个工具名与顺序：src/shared/deck-tools/plan.js 第 100 到 102 行的 DECK_TOOL_ORDER，常量里按顺序写着 deck_context、deck_issue_get、deck_map_snapshot、deck_issue_list、deck_issue_create、deck_map_plan_create、deck_map_link、deck_issue_patch、deck_issue_report。
- 9 个工具文件清单：src/host/platform/deckToolsAssembly.js 第 47 到 57 行的 DECK_TOOL_FILES，列出的 9 条路径与上一条的工具名一一对应，全部以 `.js` 结尾；第 34 到 44 行的 DECK_TOOL_FACTORIES 列出 9 个创建函数，顺序与 DECK_TOOL_ORDER 一致。
- 每个工具文件里都有工具定义与创建函数：对 src/host/tools/ 目录搜索 `export (const definition|function createDeck)`，9 个文件各返回两处命中，例如 src/host/tools/deckContext.js 第 32 行的 definition 与第 44 行的 createDeckContext；抽看 src/host/tools/deckContext.js 第 1 到 14 行，文件头注释写明路径是 src/host/tools/deckContext.js，并从 ../../shared/deck-tools/shell.js 等共享 JavaScript 文件引用共用规则。
- 共享支撑 10 个文件都是 `.js`：src/shared/deck-tools/ 目录的 glob 结果是 exec-cell.js、agent-register.js、plan-store.js、edges.js、workspace-file.js、key-lock.js、session-resolve.js、call-scope.js、plan.js、shell.js，共 10 个，没有 `.ts` 文件。抽看 src/shared/deck-tools/shell.js 第 1 到 28 行，写明它是 8 个 deck 工具共用的薄壳机制，管过闸、选后端、取工作区、永不抛异常这四条。
- 装配与注册行文件都是 `.js`：src/host/platform/ 目录的 glob 结果是 deckToolsAssembly.js 与 deckToolsRow.js。抽看 src/host/platform/deckToolsAssembly.js 第 1 到 32 行，写明它只做把 9 个工具文件读进来装成一张表这一件事；抽看 src/host/platform/deckToolsRow.js 第 19 到 34 行，写明它从 9 个 `.js` 工具文件里引用定义并组成待注册列表。
- 构建脚本先翻译 TypeScript 共用部分：scripts/build.mjs 第 40 到 50 行加载 label-color-core/build.mjs、第 57 到 62 行加载 refresh-core/build.mjs、第 67 到 72 行加载 version-control-core/build.mjs、第 77 到 82 行加载 config-store-core/build.mjs，每段注释都写着转译与类型检查写在各自的 build.mjs 里，本文件只负责在一条命令里带上。
- 4 个目录各自说明一对一翻译：label-color-core/build.mjs 第 1 到 7 行、refresh-core/build.mjs 第 1 到 7 行、version-control-core/build.mjs 第 1 到 7 行、config-store-core/build.mjs 第 1 到 7 行，都写着用 esbuild 把各自 src/ 下每个 TypeScript 文件翻译成 src/shared/ 下对应目录的同名 JavaScript 文件，另外跑类型检查，生成文件提交到仓库，改了不重新生成则新鲜度检查变红。
- 4 个目录的 TypeScript 文件清单：label-color-core/src/ 下 3 个 `.ts` 文件的 glob 结果；refresh-core/src/ 下 14 个 `.ts` 文件的 glob 结果；version-control-core/src/ 下 14 个 `.ts` 文件的 glob 结果；config-store-core/src/ 下 4 个 `.ts` 文件的 glob 结果。抽看 label-color-core/src/colors.ts 第 1 到 8 行，写明它管色值归一化与比较，供宿主与客户端引用同一份产物。
- 翻译产物头可查：src/shared/label-color/colors.js 第 1 行写着它是由 label-color-core/src/colors.ts 生成的，请勿手改；src/shared/ 目录的 glob 结果里可见 src/shared/label-color/、src/shared/refresh/、src/shared/version-control/、src/shared/config-store/ 下的全部同名 `.js` 产物。
- 面板界面 TypeScript 真源位置与用途：src/client/ 下 `**/*.ts` 的 glob 结果约 38 条，其中 4 条是以 `.d.ts` 结尾的类型说明，其余约 34 条集中在 views/pixel/、views/cards/、views/skillDetail/、kernel/locale-cards.ts 与 kernel/locale-skilldetail.ts。抽看 src/client/views/pixel/PixelBtn.ts 全文 24 行，文件头写明它是像素风按钮的 TypeScript 真源，构建会翻译出同名 `.js` 再拼回面板；抽看 src/client/kernel/locale-cards.ts 第 1 到 11 行，文件头写明它是三种卡片的中英文词条真源；对应产物 src/client/views/pixel/PixelBtn.js 第 1 行写着它是由 views/pixel/PixelBtn.ts 生成的，请勿手改。
