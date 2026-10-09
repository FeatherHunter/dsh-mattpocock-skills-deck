# 885 调研：Markdown 漂亮版式与弹窗落点的现状可用项

> 落盘日期：2026-10-07。归属：地图 883 下 885 号调研票。效力规则见 CONTEXT.md：今天的内容是当前生效的基线，未来有新定版以未来版本为准。
> 纪律：只读代码，没有改生产代码；只找事实，不做选型决定。每一个事实后面都跟了它所在的文件，顺着文件路径就能核对原文。
> 用词：只用 CONTEXT.md 已有词与本票正文已有词（渲染器、代码块、表格、长文滚动、弹窗落点、内部 5 端口、父槽、加载骨架、失败提示、文案词条、技能列表、详情入口、原文）。新东西用完整一句话说清，不造简称。

## 0. 一页现状（给第一次读的人）

1. 仓库里已经有一个议题正文专用的 Markdown 渲染器（`src/client/views/shared/md.js` 的 `mdToHtml`），议题详情、评论、地图目的地都在用它；它支持标题、加粗、列表、代码块、引用、图片，不支持表格。
2. 长文滚动不需要新造：面板主滚动区就是 `src/client/panel/Dock.js` 里带 `dsws-body` 类名的那层（纵向自动滚动），弹窗内部另有各自的纵向滚动写法（见第 3 章）。
3. 内部 5 端口里，只有 `modal-seat` 是主区居中遮罩、一次只显示一张的那种；它的官方父槽是 `shell.overlay`。其余 4 个端口分别是顶部横幅、右栏页签、输入区胶囊、右下角轻提示，都不是居中遮罩形态。
4. 加载、失败、空状态都有现成写法：头部灰色占位条（`RepoChipSkeleton`）、转圈加「加载中」字样、红色错误横幅加「重试」按钮、标签弹窗里的加载中与加载失败与空态三段式。
5. 文案词条走中英文两套对照表，源码里不直接写中文；技能列表目前每行只有短描述加「加载」按钮，还没有详情入口，技能原文全量文本在仓库里没找到对应的存储位置（见第 6 章）。

## 1. Markdown 展示可以复用的部件

### 1.1 渲染器本体：`mdToHtml`

- 位置：`src/client/views/shared/md.js` 第 194 行起的 `mdToHtml(md, opts)`，行内小格式走同一文件第 109 行起的 `mdInline`。
- 现在已经在用的地方有 4 处：议题详情正文（`src/client/views/IssueDetail.js` 第 172 行）、评论正文（`src/client/views/IssueDetailComments.js` 第 74 行）、地图目的地与备注（`src/client/views/MapDetail.js` 第 224、231 行）、地图折叠块里的逐条文字（同一文件第 294、300 行）。
- 支持的写法（逐条核对过 `md.js` 全文）：
  - 1 到 6 级标题，按级别给 16 到 10 像素字号（第 241 到 246 行）。
  - 行内加粗、斜体、行内代码、删除线（第 182 到 190 行）。
  - 超链接：只放行安全地址（`https/http/mailto` 与站内 `#/..` 相对路径），危险地址退化成纯文字（第 134 到 147 行）。
  - 图片两种写法都认：感叹号方括号圆括号的写法，与尖括号图片标签的写法；图片标签只读地址、说明、宽、高、标题五个属性，其余属性忽略（第 27 到 58 行）；图片地址只认 `https` 开头，其余退化成说明文字（第 21 到 26 行）。
  - 无序列表、有序列表、任务列表（方括号空格与方括号叉号两种勾选），连续行自动归成一组（第 252 到 266 行）。
  - 引用块、分隔线（第 248 到 251 行）。
  - 三个反引号围起来的代码块：纯文本显示，不执行，块里不解析图片与链接，横向超出时横向滚动（第 229 到 240 行）。
- 明确不支持的写法：表格。把 `md.js` 全文找了一遍，没有识别竖线表格的分支，竖线行会按普通段落原样显示。这是事实陈述，不是建议加表格。
- 安全约束（白名单思路，见文件头第 6 到 14 行注释）：正文被当作不可信的用户输入，只构造界面元素，不拼接网页字符串；图片缩略图只做上限约束（宽度不超过内容区、高度不超过 220 像素），从不拉大，从不变形（第 64 到 71 行）。

### 1.2 代码块与行内代码的现成样式

- 代码块：灰底、圆角 6、11 像素字号、1.5 倍行高、横向滚动，字体是 `Consolas/Menlo` 一类等宽字体（`md.js` 第 236 到 238 行）。
- 行内代码：浅灰底、左右各 3 像素内边距、圆角 4（`md.js` 第 187 行）。
- 另一套差异对比里的等宽样式在 `src/client/views/versionControl/vcStyles.js` 第 96 行（`.dsws-vc-diff`，11.5 像素、最高 320 像素、超出滚动），那是版本对比专用的，字号与上限和正文代码块不同，不要混用。

### 1.3 图片点击放大

- 缩略图点一下会打开居中放大的浮层，共用同一份共享状态 `st.imgOverlay`：打开是 `mdOpenImg`（第 73 行），关闭是 `mdCloseImg`（第 79 行），浮层本体是 `mdImgOverlay`（第 85 行）。
- 浮层形态：全屏半透明黑底居中一张卡片，卡片头显示说明加关闭叉号，中间显示大图（最高 60% 视口高度），底部显示原图地址加「打开链接」，点空白处与按退出键关闭（第 92 到 105 行）。
- 挂载方式走挂顶底座 `portalTop`（第 106 行），议题详情与地图详情两处都挂了同一个浮层函数（`IssueDetail.js` 第 346 行、`MapDetail.js` 第 304 行）。

### 1.4 长文滚动：复用面板主滚动区

- 面板主滚动区是 `src/client/panel/Dock.js` 里带 `dsws-body` 类名的那层，样式是纵向自动滚动（第 282、296、332 行三种分支写法相同），全局定义在 `src/client/kernel/styles.js` 第 35 行（`.dsws-body{flex:1;overflow-y:auto;padding:10px 12px}`）。
- 含义：已经处在详情页里的长正文不需要自己再包一层滚动，跟着面板主滚动区走即可；这是议题详情正文今天的做法（正文只是一段普通纵向排列的节点，见 `IssueDetail.js` 第 304 到 307 行）。
- 弹窗内部的滚动另有三套现成写法（形态一致，都是内容区纵向自动滚动、横向隐藏）：标签配色弹窗正文区（`LabelColorDialog.js` 第 340 行）、切换确认弹窗内容区（`SwitchConfirmModal.js` 第 75 行）、图片浮层中间看图区（`md.js` 第 97 行）。
- 小浮层也有上限写法可抄：技能悬浮列表最高取 300 像素与视口高度减 24 像素两者较小值，超出纵向滚动（`src/client/floating/SkillFloatList.js` 第 95 行）。

## 2. 弹窗落点可以复用的部件

### 2.1 内部 5 端口对照表（单一真源）

声明文件是 `src/shared/ui/slots.js` 的 `SLOT_DEFS`（第 22 到 29 行），客户端内核里有一份零依赖的同源声明（`src/client/kernel/slots.js` 的 `SLOT_DEFS_KERNEL`，第 20 到 26 行）。5 行逐字抄录如下：

| 端口 | 长什么样 | 官方父槽 | 作用域 | 一次一张还是一排多张 |
| --- | --- | --- | --- | --- |
| banner-seat | 主区顶部 42 像素满宽横幅，同槽互斥（蓝黄红） | shell.overlay | root | 一排多张 |
| dock-seat | 右栏 details 里面的页签栏（不是整列外壳） | details | session-maybe | 一排多张 |
| statusbar-seat | 输入框正上方的胶囊区 | conversation.input.dock | session | 一排多张 |
| modal-seat | 主区居中遮罩弹窗 | shell.overlay | root | 一次一张 |
| toast-seat | 右下角轻提示队列 | shell.overlay | root | 一排多张 |

- 官方父槽一共 3 个，不自创顶级槽：`shell.overlay`、`details`、`conversation.input.dock`（`slots.js` 第 41 行 `PARENT_SLOTS`）。
- 同父槽的遮挡顺序写死：弹窗大于轻提示大于横幅（第 44 行 `Z_ORDER`，弹窗 300、轻提示 200、横幅 100）。
- 治理规则两条：作用域写死，越权不渲染（`slots.js` 作用域枚举与 `kernel/slots.js` 第 37 到 44 行的校验函数）；弹窗只在检查失败且动作是填表单或走多步向导时才打开（两处 `shouldShowInModal`，判据逐字一致）。
- 落点事实：5 个端口里只有 `modal-seat` 是主区居中遮罩且一次只显示一张的形态；其余 4 个都不是居中遮罩。这句话只描述现状，不替详情页选落点。

### 2.2 父槽复用：今天弹窗都挂在哪里

- 挂顶底座：`src/client/kernel/portal.js` 的 `portalTop`（把节点挂到文档顶层，取不到挂载能力时原地渲染不抛错）与 `PortalOverlay`（统一的挂顶覆盖层入口）。技能悬浮提示被遮挡的根因与修法写在该文件头注释里（宿主输入区祖先带变换属性时固定定位会降级，所以要挂顶）。
- 表单与多步向导弹窗（`FormModalSeat`）：本体在 `src/client/kernel/slotRenderer-modal-view.js`，打开入口与排队在 `src/client/kernel/slotRenderer-queue.js` 的 `openFormModal`（弹窗打开时再触发直接排队，多步向导占一位，去抖 80 毫秒后弹下一个），关闭是 `closeFormModal`，字段渲染拆在 `src/client/kernel/modal-fields.js`。挂载点在状态栏那一层（`src/client/statusbar/StatusBar.js` 第 219 行），无仓库黄条那条链路上另有一处挂载（`src/client/views/NoRepoCard.js` 第 106 行）。
- 「域文档布局」小卡（`SetupLayoutCard`，文件 `src/client/views/SetupCard.js`）：与上面的表单弹窗共用同一个座位，同一时刻只画一张，卡开着就先画卡（`slotRenderer-modal-view.js` 头注释与第 10 到 14 行逻辑）。
- 切换后端确认窗（`SwitchConfirmModal`，文件 `src/client/views/shared/SwitchConfirmModal.js`）：不是挂顶弹窗，是面板内就地覆盖层（顶部锚定、卡片最高 90% 视口高度、内容区内部滚动，见第 71 到 75 行），就地渲染在右侧面板容器里。这是与上面两类不同的第二种弹窗形态。
- 标签配色弹窗（`LabelColorDialog`，文件 `src/client/views/labels/LabelColorDialog.js`）：宽 520、最高 82% 视口高度的纵向卡片（第 336 到 344 行），三条关闭路径（底部退出、右上角叉号、点空白处）共用同一个关闭函数（第 108 到 113 行），有未保存改动时第一次点只摆提示、第二次才真关（第 87 到 93 行）。这是第三种可抄的弹窗形态。

### 2.3 现有加载骨架与失败提示

- 头部灰色占位条 `RepoChipSkeleton`（`src/client/panel/RepoChipSkeleton.js`）：快照还没回来时只说「这里在等数据」，不等同于「没有仓库」。三条硬约束是定宽 96、不带折叠机标记、与真芯片同高 20 像素，改它要守住这三条。
- 转圈加一句话：议题详情首次加载（`IssueDetail.js` 第 120 行）、正文区等待（第 174 到 177 行）、标签弹窗加载中（`LabelColorDialog.js` 第 198 到 202 行）用的都是同一套转圈样式 `dsws-spinner` 加文案词条 `list.loading`（「加载中…」）。
- 红色错误横幅加「重试」：议题详情无数据时整页横幅（`IssueDetail.js` 第 123 到 141 行：种类加原文前 160 字、重试按钮、打开原票链接），有数据时顶部细横幅不遮挡主体（第 264 到 271 行）。正文区本身不重复放重试按钮，失败原因只出现在顶部横幅（第 168 到 169 行注释）。
- 正文三态写法（第 170 到 177 行）：详情回来了且有字就渲染；详情回来了但没字才说「无描述」；详情还没回来时说「加载中」，取数失败时说「正文还没拿到」。「无描述」这句话只有详情回来才能说。
- 评论区「加载下 50」按钮：平时显示加载下 50，加载中显示加载中并禁用，失败 1 到 2 次显示重试加悬停说明「加载失败，可重试」（`IssueDetailComments.js` 第 79 到 105 行）。
- 标签弹窗四态（`LabelColorDialog.js` 第 197 到 236 行与 `useLabelColors.js` 头注释）：加载中、加载失败（含后端档位与后端原话，给重试）、后端不支持（诚实说暂时做不到）、空态（没有标签时只给「先去建标签」一句，底部整条按钮区不渲染）。
- 列表页秒开旧数据：已有快照时不显示全屏加载，秒开旧列表加后台静默刷新（`ListTab.js` 第 319 到 322 行）。

### 2.4 文案词条：在哪里、怎么用

- 位置：`src/client/kernel/locale-flow.js`（列表与详情流程词条）、`locale-panel.js`（面板与链接）、`locale-labels.js`（标签弹窗）、`locale-word.js`（技能与通用词）、`locale-skilldesc.js`（技能英文短描述对照）。源码里不直接写中文，统一走 `tr(键名)` 取词，取不到时回落英文（`md.js` 第 59 到 63 行的 `mdT` 与同文件注释第 59 行）。
- 与本票相关的现成键（中英成对，中文在前）：
  - 加载与失败：`list.loading`（加载中…）、`list.loadFail`（加载失败）、`list.back`（返回）、`detail.viewOnTracker`（打开原票）、`detail.noBody`（无描述）、`detail.bodyNotYet`（正文还没拿到）、`detail.notYet`（评论还没拿到处同义）、`detail.blockedPrefix`（被阻塞前缀）、`detail.readOnlyHint`（只读说明）。
  - 图片与关闭：`env.actOpenUrl`（打开链接）、`panel.closeDetailTitle`（关闭详情）。
  - 标签弹窗：`lc.loading`（正在读取标签清单…）、`lc.emptyTitle`、`lc.emptyDesc`、`lc.err.*` 各档位说明。
  - 技能列表：`act.load`（加载）、`skill.list`（列表）、`skill.ring`（圆环）、`skill.generic`（通用建议）、`tip.header.skillUse`（技能用途）。
- 新增详情入口与原文页时，按钮字、标题字、失败句按这套键表添新键即可，不在源码里写死中文。

## 3. 技能列表现状：缺的那一块在哪里

- 渲染底座：`src/client/views/SkillsTab.js` 逐行画出 `SKILLS` 数组（第 38 到 51 行），每行是状态点加名称加短描述加一颗「加载」按钮，点「加载」即向会话注入斜杠加技能名（第 49 行 `inject(st, '/' + sk.name)`）。
- 短描述悬停：短描述过长时截断，悬停显示用途两段式（小灰字标题 `tip.header.skillUse` 加正文，见第 47 行）。
- 事实：当前行上没有详情入口，没有通往原文页的按钮或链接；列表消费的只是短描述，没有展示原文全量文本的位置。
- 技能名单单一真源：`src/shared/matt-skills.js` 的 `SKILLS_DATA`（27 项，每项只有名称、级别、中文短描述三个字段，第 51 到 79 行），英文短描述在 `src/client/kernel/locale-skilldesc.js`（头注释写明增减技能时两边同改）。
- 技能原文全量文本：以 `SKILL`、`HELP`、`skill content` 等关键词在 `src` 全文搜索，只找到短描述与安装引导提示词，没有找到技能原文全量文本的仓库内存储位置。结论是「仓库内没找到」，原文从哪里取（随包文件、已安装技能目录、帮助指令输出）需要后续票确认，这里不猜。

## 4. 给后续票的事实清单（不做选型）

1. 渲染器直接复用 `mdToHtml` 即可覆盖标题、列表、代码块、引用、图片；表格是它今天不支持的唯一常见写法，后续票需要先确认技能原文里有没有表格。
2. 长文放在面板主滚动区里即可；只有弹窗形态才需要内部滚动，弹窗内部滚动有三套现成写法（第 1.4 章）。
3. 居中遮罩形态只有 `modal-seat` 一个；面板内就地覆盖（切换确认窗）与宽卡片弹窗（标签配色窗）是另外两种现成形态，各自的文件路径见第 2.2 章。
4. 加载骨架抄 `RepoChipSkeleton` 的三约束；失败提示抄议题详情的顶部横幅；正文三态（有字、无描述、还没拿到）抄 `IssueDetail.js` 第 170 到 177 行。
5. 文案全部走词条添新键；技能列表缺的是详情入口与原文来源确认，入口加在 `SkillsTab.js` 第 38 到 51 行的行结构里，原文来源见第 3 章末尾的未找到结论。

## 5. 来源清单

- `src/client/views/shared/md.js`（渲染器全文，第 1 到 274 行；本次逐行读完）
- `src/shared/ui/slots.js`（5 端口声明，第 22 到 44 行）
- `src/client/kernel/slots.js`（内核同源声明与守门函数）
- `src/client/kernel/portal.js`（挂顶底座）
- `src/client/kernel/slotRenderer-queue.js`（弹窗打开入口与排队）、`src/client/kernel/slotRenderer-modal-view.js`（弹窗本体）、`src/client/kernel/modal-fields.js`（字段渲染下沉处）
- `src/client/views/IssueDetail.js`（第 100 到 180 行加载与正文三态、第 232 到 307 行滚动与正文挂载、第 346 行图片浮层）
- `src/client/views/IssueDetailComments.js`（第 61 到 105 行评论加载与重试）
- `src/client/views/MapDetail.js`（第 223 到 232、291 到 304 行渲染器复用）
- `src/client/panel/Dock.js`（第 282、296、332 行主滚动区）、`src/client/kernel/styles.js`（第 35 行滚动区定义）
- `src/client/panel/RepoChipSkeleton.js`（全文，骨架三约束）
- `src/client/views/labels/LabelColorDialog.js`（第 75 到 236 行四态、第 336 到 344 行卡片形态）、`src/client/views/labels/useLabelColors.js`（头注释三阶段）、`src/client/views/labels/LabelColorEntry.js`（第 84 到 94 行挂载）
- `src/client/views/shared/SwitchConfirmModal.js`（第 63 到 75 行面板内覆盖形态）、`src/client/views/SetupCard.js`（全文，共用座位）
- `src/client/views/SkillsTab.js`（全文 66 行）、`src/shared/matt-skills.js`（全文 81 行）、`src/client/kernel/locale-*.js`（词条对照）
- `src/client/floating/SkillFloatList.js`（第 95 行小浮层上限写法）、`src/client/views/ListTab.js`（第 319 到 322 行秒开旧数据）、`src/client/views/ListTabClosed.js`（滚动容器说明）
