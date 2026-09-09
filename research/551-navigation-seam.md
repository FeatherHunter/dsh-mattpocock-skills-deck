# T1 盘点：地图详情下钻导航栈应该落在哪一层、存成什么形状（#551）

背景：地图 #550 要求在右侧面板里从地图详情逐级下钻（普通票据进普通工单详情，地图票据进下一级地图详情），按返回逐级回到上一级，最终回到地图列表。本票 #551 只盘点存量实现并给出唯一推荐，不写实现代码。

下面每个结论后面都注明了一手来源文件与行号倾向。行号是当前工作区读到的实际行号。

## 查过的一手来源（都真实存在）

- `src/client/kernel/store-snapshot.js`：界面状态的初始形状（含 `activeMap` 与 `activeIssue`）
- `src/client/kernel/store-prefs.js`：读写 `activeMap` 与 `activeIssue` 的函数（含互斥逻辑）
- `src/client/views/MapDetail.js`：地图详情的展示
- `src/client/views/IssueDetail.js`：普通工单详情的展示
- `src/client/panel/Dock.js`：右侧停靠容器，按 `activeMap` 与 `activeIssue` 决定渲染哪一个详情
- `src/client/panel/Overlay.js`：悬浮面板容器，同样读 `activeMap`
- `src/client/views/ListTabRow.js`：主列表单行的点击入口
- `src/client/views/PrTab.js`：拉取请求页签的点击入口
- `src/client/views/SkillsTab.js`：技能页签读取 `activeMap` 做推荐
- `src/client/kernel/store-derived.js`：从面板快照派生出地图分组的函数
- `src/client/kernel/api-io.js`：普通工单详情的拉取通路
- `src/client/kernel/router.js`：面板打开位置与面板快照水合（本次与导航栈无关，只用来排除）
- `scripts/build.mjs`：一源两物的构建约定
- `CONTEXT.md`：五方职责与会话私有状态的用词
- `docs/adr/` 下全部 12 个文件：逐个搜过与详情页导航有关的定版

## 盘点结论

### 1. 五方职责要求导航栈落在界面层

`CONTEXT.md` 第 37 行把五方职责定为：界面层只消费契约产物做渲染，契约层定义接口与求值，后端层声明检查目录与动作并实现操作，平台抽象层封装系统能力原语，系统底座层做各系统的具体实现。

`CONTEXT.md` 第 68 行把会话私有状态定义为只在单个会话内有效的阅读与交互行为，其中明确包含面板内当前打开的地图或工单。导航栈记录的是这个人在当前会话里打开了哪几个详情、按什么顺序打开，属于阅读位置，不属于跨会话共享的数据。

所以导航栈落在界面层，与 `activeMap` 与 `activeIssue` 同一层。来源：`CONTEXT.md` 第 37 行与第 64 到 71 行。

### 2. 存量形状是两个互斥的数字，没有栈

界面状态的初始形状在 `src/client/kernel/store-snapshot.js` 第 9 到 11 行：`makeStore` 返回的对象里有 `activeMap: null, activeIssue: null`，每个会话一份（第 274 到 293 行的 `storeOf` 按会话编号建状态，新建时按工作区键水合面板快照）。

读写函数在 `src/client/kernel/store-prefs.js` 第 51 到 66 行：`setActiveMap` 置地图编号时把 `activeIssue` 清空（第 55 行），`setActiveIssue` 置工单编号时把 `activeMap` 清空（第 62 行）。`clearActiveMap`、`clearActiveIssue`、`clearActiveDetail` 只做清空并触发重渲染。注释第 51 行写明两者互斥。

结论：存量只能记住当前停在哪一个详情，记不住从哪一级下来。改成栈之后，这个互斥写法是第一个必须被替代的位置。来源：`src/client/kernel/store-snapshot.js` 第 9 到 11 行，`src/client/kernel/store-prefs.js` 第 51 到 66 行。

### 3. 右侧停靠按地图优先、工单其次、列表兜底的顺序渲染

`src/client/panel/Dock.js` 第 40 到 41 行先算出当前地图分组与是否有工单详情。第 263 行是主列表页签的渲染优先级：有当前地图就渲染地图详情，否则有工单编号就渲染工单详情，否则渲染主列表。第 264 行是拉取请求页签的同构优先级：有工单编号就渲染工单详情，否则渲染拉取请求列表。

改成栈之后，第 263 到 264 行的判断条件要从读两个互斥数字改为读栈顶元素。来源：`src/client/panel/Dock.js` 第 40 到 41 行与第 263 到 264 行。

### 4. 悬浮面板只有地图分支，没有工单分支

`src/client/panel/Overlay.js` 第 108 行同样按 `activeMap` 找当前地图分组。但第 259 到 262 行的主列表页签只写了有当前地图就渲染地图详情、否则渲染主列表，没有工单详情分支；拉取请求页签同样没有工单详情分支。

`src/client/views/PrTab.js` 第 10 到 12 行的文件头注释写明：悬浮面板本来就没有详情分支，点行后详情走别层，右侧停靠按 `activeIssue` 渲染工单详情，本页点行只调 `setActiveIssue`，留待 #507 再验。

结论：导航栈落地时，悬浮面板是已知缺口。要么给悬浮面板补上与停靠栏一致的栈顶渲染分支，要么在定版里明确只支持停靠栏下钻、悬浮面板点行只写栈不展示。不能默认两边行为一致。来源：`src/client/panel/Overlay.js` 第 108 行与第 259 到 262 行，`src/client/views/PrTab.js` 第 10 到 12 行与第 27 到 30 行。

### 5. 地图详情的取数走面板快照派生，不单独发请求

`src/client/views/MapDetail.js` 第 8 行接收调用方传进来的 `st` 与 `g`（当前地图分组），第 11 行取 `g.m`，第 14 到 29 行直接读该地图的票据、分层统计与迷雾字段做展示。分组本身由 `src/client/kernel/store-derived.js` 第 10 到 22 行的 `compute` 从 `st.snapshot.maps` 算出，不经过网络。

地图详情顶部的返回按钮在 `MapDetail.js` 第 140 行，直接调 `clearActiveMap` 回到列表。地图内票据节点目前没有下钻点击（第 73 到 110 行的节点只处理去雾展开与动作按钮），下钻分流是 T3 的工作。来源：`src/client/views/MapDetail.js` 第 8 到 29 行与第 140 行，`src/client/kernel/store-derived.js` 第 10 到 22 行。

### 6. 普通工单详情的取数走详情接口加 60 秒缓存，快照只做降级

`src/client/views/IssueDetail.js` 第 13 行读 `st.activeIssue` 拿到工单编号，第 18 到 21 行在编号或工作区变化时调 `fetchIssueDetail` 拉取，第 28 到 31 行优先用拉取到的 `st.issueDetail`，没有才用快照里的同号工单做降级展示。

拉取函数在 `src/client/kernel/api-io.js` 第 51 到 110 行：先查 `st.issueCache`，60 秒内命中直接用（第 56 到 63 行），未命中走 `host.call('wf.issueDetail', ...)` 问宿主（第 73 行），成功写入缓存（第 88 到 94 行）。缓存时间常量在 `src/client/kernel/store-prefs.js` 第 67 到 68 行，初始形状在 `src/client/kernel/store-snapshot.js` 第 11 行。

结论：栈元素不需要存详情正文，只需要存编号与种类。地图详情下钻复用面板快照，工单详情下钻复用这条 60 秒缓存通路。来源：`src/client/views/IssueDetail.js` 第 13 行、第 18 到 21 行、第 28 到 31 行，`src/client/kernel/api-io.js` 第 47 到 50 行与第 51 到 110 行。

### 7. 所有进入详情的点击入口都要一起改

- 主列表单行：`src/client/views/ListTabRow.js` 第 33 到 34 行按是否有地图标签判断种类，第 55 到 58 行按种类调 `setActiveMap` 或 `setActiveIssue`。这是地图 #550 已定分流口径（有 `wayfinder:map` 标签进地图详情，无则进普通工单详情）的主列表版本。
- 拉取请求行：`src/client/views/PrTab.js` 第 27 到 30 行点行只调 `setActiveIssue`。文件头第 12 行留痕：`activeIssue` 是裸数字，同号的普通工单与拉取请求进同一个详情。
- 工单详情内的跳转：`src/client/views/IssueDetail.js` 第 34 行的返回调 `clearActiveIssue`（改成栈后应改为弹出栈顶）；第 174 行的所属地图链接调 `setActiveMap`（改成栈后应改为压栈，否则丢掉返回路径）；第 188 行的子票与第 201 行的阻塞票都调 `setActiveIssue`（地图 #550 的未阐明事项要求确认是否一律压栈，见 #550 正文雾区第三条）。
- 技能页签：`src/client/views/SkillsTab.js` 第 12 到 13 行读 `activeMap` 做推荐，栈顶是地图时要改读栈顶，否则推荐与展示错位。

来源：上面各文件行号即来源。

### 8. 构建是一源两物，导航栈不需要改构建机制

`scripts/build.mjs` 开头第 1 到 19 行写明一源两物的约定：规范源是 `src/client/index.js` 与 `src/host/index.js`，产物是根下的 `client.js` 与 `host.js`（开发用）加 `package/lib/` 下的发布形态。内核模块与叶子模块在构建时把声明体文本拼回 `src/client/index.js` 的拼接标记处。

`MapDetail` 与 `IssueDetail` 已在叶子清单里：`scripts/build.mjs` 第 251 行（`mapDetail`）与第 253 行（`IssueDetail`）；状态文件在内核清单里：第 198 行（`storePrefs`）与第 200 行（`storeSnapshot`）。根产物文件头有自动生成横幅，人手不碰（第 330 行附近）。

结论：导航栈只是在已有状态文件里加一个数组字段与几个操作函数，不新增构建标记类型，不改拼接机制。如果新建独立文件，才需要在清单与 `src/client/index.js` 加一对标记；推荐做法是不建新文件（见唯一推荐）。来源：`scripts/build.mjs` 第 1 到 19 行、第 198 行、第 200 行、第 251 行、第 253 行。

### 9. 定版档案里没有与详情页导航有关的定版

把 `docs/adr/` 下 12 个文件全部搜过（关键词：详情、导航、`activeMap`、`activeIssue`、下钻、栈、`MapDetail`、`IssueDetail`），唯一命中是 `docs/adr/20260902-tip500-preset-and-no-title-gate.md` 第 9 行盘点提示气泡散落位置时顺带列出 8 类文件含 `MapDetail` 与 `IssueDetail`。那是提示气泡的定版，与导航栈无关。

结论：导航栈没有历史定版约束，本票的推荐就是第一个定版依据。来源：`docs/adr/` 全目录检索，唯一命中见上。

## 唯一推荐

落点文件：`src/client/kernel/store-snapshot.js` 声明形状，`src/client/kernel/store-prefs.js` 放操作函数。两个文件是同一界面状态的前后两半（前者是初始形状，后者是读写函数），构建时拼回同一个界面闭包（见 `scripts/build.mjs` 第 198 行与第 200 行）。不新建文件，避免新增拼接标记。

栈元素形状：`{ kind: 'map' | 'issue', n: 数字编号 }` 的数组，字段名建议 `navStack`，与 `activeMap` 与 `activeIssue` 放在同一个状态对象里。只存种类与编号，不存详情正文。理由：地图详情的正文来自面板快照派生（结论 5），工单详情的正文来自 60 秒详情缓存加 TEFNGY 降级（结论 6），栈只做坐标，数据真源不动。过渡期把 `activeMap` 与 `activeIssue` 保留为栈顶的镜像（由压栈与弹栈函数同步写），让停靠栏、技能页签等读方逐个改到读栈顶，避免一次改全库。

必须一起改的函数：`store-prefs.js` 的 `setActiveMap`、`setActiveIssue`、`clearActiveMap`、`clearActiveIssue`、`clearActiveDetail`（第 52 到 66 行）旁边新增压栈、弹栈、看栈顶、清空栈四个函数，并把旧函数收敛为调新函数；`Dock.js` 第 40 到 41 行与第 263 到 264 行的渲染优先级改为读栈顶；`Overlay.js` 第 108 行与第 259 到 262 行补上与停靠栏一致的栈顶分支或明确不支持；`ListTabRow.js` 第 55 到 58 行、`PrTab.js` 第 27 到 30 行、`IssueDetail.js` 第 34 行、第 174 行、第 188 行、第 201 行的进入与返回改为压栈与弹栈；`SkillsTab.js` 第 12 到 13 行的推荐改为读栈顶；`MapDetail.js` 第 140 行的返回改为弹栈。

不能碰的层：契约层（`src/shared/` 下的接口形状、列表过滤器登记、动作词汇表）不新增字段；后端层（`src/host/` 下的后端目录、`wf.issueDetail` 等宿主接口、快照字段）不新增接口与字段；平台抽象层与系统底座层不动；`scripts/build.mjs` 的拼接机制与根产物 `client.js` 与 `host.js` 不动（构建后自动生成）。理由：地图 #550 已定本次只动界面层的展示与界面状态，不新增后端字段，不新增接口，不改数据结构；导航栈是会话私有状态（结论 1），不需要跨进程，不新增宿主接口，不加缓存与定时任务，所以也不新增日志点。
