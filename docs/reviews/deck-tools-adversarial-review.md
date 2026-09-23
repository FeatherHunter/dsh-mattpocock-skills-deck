# 对抗式审查：给 AI 的 7 个工单工具 + 会话事件订阅

只读审查，未修改任何仓库文件。以下每条都给了可复验的落点。

## 致命

**F1 · `session/event` 的订阅面是全部作用域，不是本工作区**
- 攻击场景：`dsh-scope/lib/index.js:327-337` 的 `scopeTarget` 只让「带作用域标记的监听器」按其键过滤；`tag === undefined` 的监听器**一律放行**。我们的捆绑插件拿到的正是未打标的普通 Cordis 上下文（`docs/reviews/refresh-grilling-session.html:236` 已记）。而 `session/event` 在 `dsh-scope/lib/invariant.js:27` 的解析器登记为 `null`（只查载体、不做主题过滤），派发点是 `dsh-session/lib/index.js:1195-1202`。结论：同一个 DSH 里**别的会话、别的子代理、别的工作区**的每一次 `tool/call` 与 `tools/result` 都会进我们的回调。
- 坏结果：`tool/call` 的参数是模型原样给的 JSON（`write`/`bash` 的全文、`ask_user_question` 里人打的答案、客户数据、`.env` 片段、其它仓库私有路径）。这不是"读别人的会话"的味道，是事实层面的越权可见；一旦其中任何字段落进日志、处理链缓存或回传 client，就变成跨工作区数据泄漏。
- 建议处置：订阅回调第一行做硬过滤——`session.cwd|workspaceRoot` 归一到工作区根（`src/host/workspaceKey.js` 的 `canonicalWorkspaceKey`），不等于本机当前工作区根的直接 `return`，**先过滤再解析**；参数只做瞬时匹配，禁止进任何 event/日志/落盘/回包；新增一条门禁断言"事件处理函数写入的任何字段不出白名单"。

**F2 · "同一个键上写两张票"不是风险，是当前实现里的两条既有路径**
- 攻击场景一（重复建票）：`src/host/tracker/backends/github/issues-write.js:41-64`。REST 尝试 `gh api ... --input -` 必然拿不到 payload（代码注释自己承认 stdin 没接），所以永远走 `gh issue create` 回落；回落一旦"退出码不为 0 但票其实已建"（超时、`maxBuffer` 截断、EOF——`docs/architecture/refresh-budget-architecture.html:295` 明说本机有偶发 EOF），外层重试就**再建一张**。同文件 `:63` 那条 `unexpected empty response` 也说明"响应不可信"时会走到这条回落的判定里。发行产物 `package/lib/tracker/backends/github/issues-write.js` 同形（`:41`/`:63`）。
- 攻击场景二（markdown 抢号）：`src/host/tracker/backends/markdown/issues-create.js:41-57` 是"读目录取 max+1 → 探测文件是否存在"，`:86` 再写。这段**没有** `withSingleWriter` 保护（`label-colors.js:199` 那把锁只管配色与评论），所以 `deck_map_plan_create` 并发建子票会两张票撞同一个编号：一张被覆盖、另一张"看起来成功"其实不存在。
- 坏结果：一张票变两张；AI 报告"建了 6 张"，实际 5 张；依赖边指向被覆盖的那张，整张地图的阻塞关系错位且**没有报错**。
- 建议处置：契约层加"创建幂等锚"——`create(input.idempotencyKey)`，落到票面的可查标识（GitHub 用正文里的稳定标记 + 建后按标记回查；markdown 用文件名键），`deck_issue_create`/`deck_map_plan_create` 必须带；`create` 与 `setBlockedBy` 一并进 `withSingleWriter` 那条按工作区的串行队列；重试策略写死为"只在**能证明**没写成功时重试"。

## 严重

**F3 · 事件判定会误花配额：看一眼也算写**
- 攻击场景：AI 在一个会话里连续 `deck_issue_get` 或 `gh issue view` 二十张票（纯读）；判定器若把 `gh issue` 子命令当成"可能改远端"，二十次都命中 → 二十次立即刷新。
- 坏结果：刷新旁路是事件驱动的，绕开 30 秒探测 / 60 秒合并窗口（`docs/architecture/refresh-budget-architecture.html:224`）；这二十次是"用户动作"类，**永远放行**，不进退避序列，还会和 `quota.spend` 的账对不上。单次刷新实测 13 点（同文档 `:238`），二十次就是 260 点，白花在没改任何东西上。
- 建议处置：命中清单只收写动词且必须带写意图（`create/edit/close/reopen/comment/delete` 且带 `--add-label`/`--remove-label`/`--body`/标题等实参）；命中的刷新仍要过闸的合并窗口，并单列 `<事件>` 这一档进账本，便于对账。

**F4 · 命令解析我们会重犯老错，而且记录在案**
- 攻击场景：本仓 `research/347-scenarios/README.md` 的 S4/S20（`:32`,`:48`）已经实测过同一套解析的偏差：白名单把 `close/comment/reopen` 全算 `edit`、`--add-label` 也被当流转、create 号从 JSON 正文里**回退取任意数字**。今天 `gh issue edit 12 --add-label bug` 会被判成"在处理 #12"并触发刷新——它只是打了个标签。
- 坏结果：处理链假阳性（见 F10）+ 假刷新（见 F3）同时发生，而且 S3 的"回退取任意数字"会污染成完全无关的票号。
- 建议处置：只做"首词匹配 + 子命令识别"，禁正则扫全文取数字；票号只从**结构化**出口拿（`gh` 的 `--json number` 或 `tools/result` 的 `result.value.exitCode`/返回值，见 `dsh-tools/lib/index.js:3290-3301` 的派发形状）；别名、`bash -c "…"`、脚本、多行命令一律记为"未知 → 不判定"，不要猜。

**F5 · 批量建图失败之后没有可恢复的中间态**
- 攻击场景：`deck_map_plan_create` 计划 12 张票 + 14 条边，建到第 7 张时 GitHub 撞二级限流（`research/github-api-rate-limits-2026-09-22.md:78`），或本地 markdown 建到第 5 张时沙箱拒绝写（`src/host/tracker/backends/markdown/issues-patch.js` 的 `classifyError` 会把 FS 拒绝原样返回）。
- 坏结果：前 6 张已落盘、后 6 张没有；"逐项校验计数"这句只在**成功路径**上有意义，失败路径没有报告，AI 看不到自己已经建了哪几张，重跑就是 F2 的重复建票。
- 建议处置：计划执行前把计划本身写成可读的中间态（工作区缓存里一份 `plan.json`：计划清单 + 已建成结果 + 已建边），逐项落进度；返回报告必须同时给"本次建成的键"和"下次续跑要跳过的键"；把重跑定义成"按中间态补齐"，而不是"重来一遍"。

**F6 · 后端不同形被当成同形，工具会盲目乐观**
- 攻击场景：GitLab 的 `setParent` 是 `link_type=relates_to` 的**平级链接**（`src/host/tracker/backends/gitlab/graph-membership.js:41`），不是父子层级；markdown 的 `setParent` 直接回 `unsupported`（`issues-patch.js:112-114`），本地票的归属只靠票文件里那行 `<!-- parentKey: NN -->` 注释（`issues-create.js:85`）。GitHub 的 `setBlockedBy` 在原生路径上直接 `unsupported`、回落到改正文里的 `Blocked by:` 行（`graph-blocking.js:183`），而且成环检测是 `catch {}` 静默吞掉的 best-effort（`:191-211`）。markdown 的 `setAssignees` **不落认领人**，只把 `Status:` 改成 `claimed`（`issues-patch.js:97-105`）。
- 坏结果：一次 `deck_map_plan_create` 在 GitHub 上得到真父子 + 真阻塞；在 GitLab 上得到一堆平级链接（"父子"被当成同级"相关"），在 markdown 上父票信息只写进注释、阻塞只写进正文行。同一个工具的返回都是 `ok:true`，但三种后端的关系图**结构不同、语义不同**；AI 会以为地图结构已经建好。
- 建议处置：`contract.js` 那条"不做能力表"的红线（`src/host/issuePage.js:8-9` 写死了）意味着只能**逐项如实透传**：`deck_map_snapshot` 与报告必须把每条边的落点标出来（原生层级 / 平级链接 / 正文行 / 票文件注释），并在后端做不到时返回 `ok:false` + 明说"这个后端没有层级父子"；`deck_issue_patch` 写认领时，markdown 的返回要如实说"只改了状态、没记认领人"。

**F7 · 7 个工具的常驻成本与"静默错工作区"是同一个问题的两面**
- 攻击场景：工具是 `ctx.tools.register` 注册的，对所有会话可见（`dsh-mcp-client/lib/index.js:171` 同一套注册面）。一个不碰工单的工作区里，7 个工具的 schema 与描述照样常驻系统提示；同时 `deck_*` 若不从 `exec` 取会话（`dsh-tool-bash/lib/index.js:226` 的 `exec.agent.session` 是现成取法），就只能用宿主进程的 cwd 猜工作区——父子目录各开一个会话时，两边"当前仓库"会解析成同一个根、或都解析错。
- 坏结果：提示词成本付给所有会话（本仓 `research/642-parts/05-productivity.md:239` 明确把这笔账算作 context load）；解析错工作区时写进另一个仓库，而且没有任何错误——用户只会在几天后发现"这些票怎么在这个仓库里"。
- 建议处置：描述压到一句"干什么 + 什么时候用"，参数说明交给 `deck_context` 的返回值；每个工具都从 `exec.agent.session` 取会话与工作区根（`canonicalWorkspaceKey`），`deck_context` 第一个返回字段就是"解析到的工作区根 + 仓库"，写操作前把解析结果回显一次；仓库/工作区不允许当可选参数传（那就等于允许跨工作区写）。

## 值得修

**F8 · 写工具从不指定仓库，AI 没有动机换掉 `gh`**
- 攻击场景：AI 要改一张远端票，会优先用熟悉的 `gh issue edit`（信息全、输出它看得懂），`deck_issue_patch` 只在描述里说"更好用"。
- 坏结果：两条写路径并行存在，一边用工具写、一边用 `gh` 写；工具链看不到 `gh` 改了字段（事件层只能认出"发生过写"，见 F4），两边的乐观判断互相打架，票面会出现工具与 `gh` 各写一半的状态。
- 建议处置：不靠"更好用"，靠"边界清楚"：在描述里写明"改字段用本工具（因为它按工作区解析并核验边），读全文与搜全仓仍用 `gh`"；参数名与 `gh` 习惯对齐，减少它的迁移成本；`deck_*` 越早被采用越好，但不要靠守卫逼（不建议拒绝裸 `gh`，那条已经在 `refresh-grilling-session.html:352` 被明确否决且理由成立）。

**F9 · 写后立即读会读到 5 秒前的旧状态**
- 攻击场景：`deck_issue_patch` 加完标签，接着 `deck_issue_get` 或 `deck_map_snapshot`；`src/host/tracker/snapshot.js:132,157,233` 的快照与边缓存 TTL 默认 5000ms，`snapshot.js:236-245` 的 `getDependencies` 是 LRU + TTL 缓存。
- 坏结果：AI 看到"标签还没加上"，于是再写一次——重复写、重复评论；`unsupported` 不进缓存这条红线保住了"做不到"的判定（`contract.js:261`），但保不住"刚做完的乐观回答"。
- 建议处置：本进程内的写操作完成后，按 `(后端, 仓库, 键)` 显式失效相关缓存条目（写路径回调里做）;`deck_*` 写工具的返回值就是"写后真状态"，不要让 AI 再读一次去确认。

**F10 · 处理链的键与留存，是 F1 的缩小版**
- 攻击场景：键按"工作区根 + 后端 + 票键"，而票键在各后端**不唯一**：markdown 是每个 effort（含裸键回落）内从 `01` 起编号（`issues-create.js:40`），GitHub 是仓库内编号，GitLab 是项目内 iid；同工作区换后端时键空间重叠。落盘缓存里若自带"票文件路径"，那就是工作区原始路径（日志纪律明令只记散列：`AGENTS.md` 第 2 条与 `research/489-appendix.md:50-52`）。旧功能已经踩过同一类坑：`research/347-scenarios/README.md:35` 的 S7 是"多会话串味"、`:39` 的 S11 是"`#12` 混后端"。
- 坏结果：处理链把 A 会话的票算到 B 会话头上（"每会话最近 20 张"如果按工作区根存就会互相覆盖），或者同一张 `#12` 在 GitHub 与 markdown 之间串台。
- 建议处置：键写成 `工作区根散列 + 后端 + 票键`**并显式带上会话 id**，"每会话 20 张"按会话分片、分片内按会话分片防抖（旧 S8 的单例 timer 会让后写的丢掉前一条）；落盘只存散列与键，路径一律哈希；明确"事件订阅"与"处理链"是两条独立的链，前者不落盘、后者才落盘。

**F11 · 工具返回码的承诺要写死**
- 攻击场景：AI 调 `deck_issue_patch`，后端回 `kind:'unsupported'`（GitLab 原生边路径就这么回，`graph-blocking.js:183`），若工具把它包装成"操作成功，关系已按可用方式建立"，AI 会按"已建立层级"继续往下做。
- 坏结果：地图结构从头就是错的，且错在看不见的地方。
- 建议处置：三个返回值分开：`ok`（真做到了）/ `partial`（做了 A 没做 B，逐项列出）/ `unsupported`（这个后端做不到，附"这个后端的关系是平级链接/正文行"这类事实）。`deck_*` 永不抛异常——抛出去 AI 会退回流熟悉的 `gh`，两条写路径同时开火。

## 可接受（不建议现在做）

- **拒绝裸 `gh` 的守卫**：不做是对的（`refresh-grilling-session.html:352` 的理由成立：拦不住人类斜杠命令、换 preset 就形同虚设）。代价认下来即可。
- **事件命中即刷新**：作为"尽力而为的加速项"接受，但必须过闸的合并窗口（F3）。
- **`plan_create` 一次建一整张地图**：方向对，别加"自动重试到成功"，那会把 F2 放大。
- **不做能力表**：这是契约层的既有红线（`issuePage.js:8-9`），别为了这两个工具去破坏它——改用"逐项如实透传 + 部分成功报告"。

## 必须补进设计的 12 条

1. 事件订阅入口按工作区根硬过滤，且**参数只做瞬时匹配**，禁止进日志/落盘/回包。
2. 每个工具从 `exec.agent.session` 取会话与工作区根，**不接受**工作区/仓库作为可选参数；`deck_context` 回显解析结果。
3. 契约层加"创建幂等锚"，创建路径进按工作区的串行写队列；重试只在能证明未写成功时发生。
4. 批量建图有可续跑的中间态与"本次建成的键"报告；失败不是黑箱。
5. 事件判定的写动词清单、命中即刷新过合并窗口、单列账本条目，三者一起定。
6. 票号只从结构化出口取；解析不出就记"未知"，绝不猜号。
7. 每条边在返回里标出落点（原生层级/平级链接/正文行/票文件注释）；后端做不到如实说做不到。
8. 写后由写路径显式失效缓存；写工具返回值就是写后真状态。
9. 处理链键含会话 id，按会话分片与防抖，落盘只存散列。
10. 工具返回码三态（`ok`/`partial`/`unsupported`），工具永不抛异常。
11. 工具注册面与提示词成本的账要算：描述一句话，详细语义放 `deck_context` 返回值。
12. 事件触发的刷新与处理链的维护，都要进日志契约（新增事件进 `research/489-appendix.md` 对照表，字段只用白名单子集，跑通 `tests/verify-log-*`）。
