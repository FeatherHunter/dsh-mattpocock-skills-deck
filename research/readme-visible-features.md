# README 用户可见功能全量扫描清单（给 #481）

> 面向对象：第一次打开这个插件的人，只关心看得见、用得上的东西。
> 范围：任务板列表、底部任务栏、ISSUE 详情与评论诊断、新会话、技能快捷入口、多后端切换、安装与升级路径。
> 对照起点：中文 `README.md`（2026-09-04 版，272 行）与 `assets/` 下已有截图。
> 扫描办法：把 `src/client/` 里面真正渲染出来的按钮和页面挨个看一遍，再回头看中文 README 写了什么、assets 配了什么图，对不上就是缺口。
> 不收的内容：内部架构、构建脚本、测试门禁、后端代码细节。

## 1. 任务板列表：面板里那块看得见、派得动的板子

入口：DSH 侧边栏打开 MattSkillsDeck 面板，顶部一排页签就是任务板。

- 页签行有三个页签：列表、技能、环境检查，点哪里切哪里。（来源：`src/client/views/shared/Tabs.js`）
- 页签行右边有三个常用按钮：紫色描边的“新建需求”、红色描边的“新增 BUG 单”、刷新按钮，旁边还有一个可点击的版本号，点开是插件仓库主页。（来源：`src/client/views/shared/Tabs.js`）
- 列表页顶部有一行关键数字：可接几个、被占用几个，口径和下面列表里的开放任务一致。（来源：`src/client/views/ListTab.js`、`src/client/statusbar/checksums.js`）
- 列表可以按状态筛：全部、开放、阻塞、已关闭；还可以叠加按标签筛；地图类型的行永远置顶；排序可以按更新时间、编号、标题切换正倒序。（来源：`src/client/views/ListTab.js`）
- 已关闭的任务默认收成一行“已关闭（N）”，点开才看得到，不占地方。（来源：`src/client/views/ListTab.js`）
- 每一行任务都有动作按钮，按标签自动换：待分流的给“诊断”， bug 给“修复”，对齐讨论的给“讨论”，普通任务给“执行”；点一下不是直接开干，而是把写好的指令填进输入框，等人确认再发。（来源：`src/client/views/ListTabRow.js`、`src/client/kernel/store-derived.js`）
- 每一行还有三个小动作：复制链接、在浏览器里打开、新会话中打开；被阻塞的行会隐藏动作按钮，改成红色“被阻塞”标签，点标签跳到它所属的地图。（来源：`src/client/views/ListTabRow.js`）
- 地图详情页把一张大地图拆成一格一格：能直接做的排最左，被阻塞的排中间，已关闭的靠右；看不清目标的格子会打一层雾。（来源：`src/client/views/MapDetail.js`）
- 地图详情页顶部和底部都有同样的三个按钮：执行、完成、新会话，语义和列表行一致。（来源：`src/client/views/MapDetail.js`）
- 当前目录还不是可用仓库时，列表最上面会出现一张红色提示卡，告诉人先处理仓库问题，而不是显示一张空表。（来源：`src/client/views/NoRepoCard.js`）
- 窄屏用户可以另装 better-sidebar，把列表和详情并排看；不装也能用，只是详情走右侧列。（来源：中文 `README.md`“窄屏更好用”小节）

## 2. 底部任务栏：输入框下面那一条胶囊

入口：每个会话输入框下面都有一条胶囊状态栏，任何情况下都不隐藏。

- 胶囊最左边是插件图标加“任务板”字样，点一下打开或收起面板。（来源：`src/client/statusbar/StatusBar.js`）
- “可接”分段：点一下跳到列表并筛出可接任务。（来源：`src/client/statusbar/StatusBar.js`）
- “BUG”分段：点一下筛出 bug 标签的开放任务；鼠标悬停会浮出一层小菜单，里面有“新增 BUG 单”，点即开新会话预填写 bug 的指令。（来源：`src/client/statusbar/StatusBar.js`）
- “诊断”分段：点一下筛出待分流标签的任务。（来源：`src/client/statusbar/StatusBar.js`）
- “沉淀”分段：点一下往输入框注入一份“思维对齐成果沉淀”指令，适合告一段落时留档。（来源：`src/client/statusbar/StatusBar.js`、`src/client/kernel/prompts.js` 的 fixate 模板）
- “交接”是一对左右拼在一起的按钮：左边点一下生成交接文档，右边只有当交接文档就绪时才变亮，点一下开新会话并填好交接文档路径；没就绪时是灰的，点了也不会开空会话。（来源：`src/client/statusbar/StatusBar.js`、`src/client/kernel/api-new-session.js`）
- “环境”分段显示类似“3/9”的数字，意思是检查链过了几项、共几项；全绿是绿色，没全绿是黄色，拿不到数据是红色问号，点一下跳到环境检查页。（来源：`src/client/statusbar/StatusBar.js`）
- “刷新”分段带一个相对时间（比如几分钟前），点一下重拉面板数据和检查链。（来源：`src/client/statusbar/StatusBar.js`）
- 胶囊太窄时会自动折叠：按优先级先藏次要文字，保证不换行顶出版面。（来源：`src/client/statusbar/StatusBar.js` 的折叠逻辑）
- 胶囊最右侧有一个下箭头，点一下把整条功能区连同顶部横幅一起收起，只留一个小按钮；点小按钮再恢复；收起状态按工作区记住。（来源：`src/client/statusbar/StatusBar.js`）
- 还没选后端的新工作区，胶囊上方会叠一条蓝色引导条，点面板分段会先跳到设置页选后端。（来源：`src/client/statusbar/StatusBar.js`）

## 3. ISSUE 详情与评论诊断：在面板里把一张票看透、回上话

入口：在列表里点任意一行，或者点“被阻塞”标签跳过去。

- 详情页顶部固定一行：返回列表、“列表 / #编号”、快照或加载中提示、“新会话”主按钮、复制链接、在远端打开。（来源：`src/client/views/IssueDetail.js`）
- 拿不到详情时会给诚实提示：转圈加载、有快照就先看快照并标“快照”、失败给红色横幅加“重试”，不会 blank 一片。（来源：`src/client/views/IssueDetail.js`）
- 票头信息一行看全：编号、标题、开放或已关闭状态、标签、认领人、更新日期、创建日期、有作者就显示作者、有关闭时间就显示关闭时间。（来源：`src/client/views/IssueDetail.js`）
- 如果这张票属于某张地图，会有一条紫色小横条写“属于 #N 标题”，点一下跳到地图详情。（来源：`src/client/views/IssueDetail.js`）
- 描述正文支持 Markdown 渲染；评论区支持分页，前面 50 条先出，下拉或点按钮加载更多，600 毫秒内重复点击会被节流，失败可重试。（来源：`src/client/views/IssueDetail.js`、`src/client/views/IssueDetailComments.js`、`src/client/kernel/api-io.js`）
- 评论输入框就在详情页底部，不用跳终端；发完自动清空并重拉详情，面板快照静默刷新；提交成功有短暂确认闪烁。（来源：`src/client/views/IssueDetailComments.js`、`src/client/kernel/api-io.js`）
- 详情页底部同样有行级动作：按标签给诊断、修复、讨论、执行，全部预填输入框，和列表行语义一致。（来源：`src/client/views/IssueDetail.js`、`src/client/kernel/store-derived.js`）
- 地图是空的（0/0）时有专门的诊断提示，告诉人关联缺失了，而不是显示空白。（来源：`src/client/kernel/prompts.js` 的 mapInspect 模板）

## 4. 新会话：任何活都能另起一个干净会话干

入口很多，语义同一个：开一个继承当前工作区的新会话，标题自动起好，指令预填进输入框，人确认后再发。

- 列表每一行的“新会话”、详情页的“新会话”、地图详情页的“新会话”，都是这个语义。（来源：`src/client/views/ListTabRow.js`、`src/client/views/IssueDetail.js`、`src/client/views/MapDetail.js`）
- 页签行的“新建需求”和“新增 BUG 单”也是新会话：前者预填写需求的指令，后者预填报 bug 的指令。（来源：`src/client/views/shared/Tabs.js`、`src/client/kernel/prompts.js`）
- 状态栏 BUG 悬停菜单里的“新增”、交接区右半“交接给新会话”，同样开新会话。（来源：`src/client/statusbar/StatusBar.js`、`src/client/kernel/api-new-session.js`）
- 新会话默认继承点按钮时所在会话的工作区，不会开到别的文件夹去。（来源：`src/client/kernel/api-new-session.js`）
- 安全规则三条：新建会话的预设一定是可用的工作预设，不会掉进空白的 code 会话；历史上坏掉的空白会话会被永久隔离、不再复用；空工作区的空白会话不跨区污染。（来源：`src/client/kernel/api-new-session.js`、`CONTEXT.md` 新建会话三要素与复用闸门词条）
- 开失败时不吞错：指令会留在当前输入框并弹一句 toast，告诉人手动建一个同名会话再发。（来源：`src/client/kernel/locale-word.js` 的 newSessionManual 文案）

## 5. 技能快捷入口：Matt 那 25 个技能一点即用

入口有两处：底部任务栏最右侧的技能悬浮入口，面板里的“技能”页签。

- 面板技能页有两种摆法：列表摆法一行一个，圆环摆法围成一圈，右上角可切换。（来源：`src/client/views/SkillsTab.js`、`src/client/views/RingSkills.js`）
- 技能页顶部会按当前打开的地图给推荐：地图备注提到调研就推 research，提到对齐提问就推 grilling 相关，什么都没打开就默认推 ask-matt。（来源：`src/client/views/SkillsTab.js`）
- 每个技能一行显示斜杠名、中文一句话用途、悬浮提示的完整用法，右边一个载入按钮，点一下把斜杠指令填进输入框。（来源：`src/client/views/SkillsTab.js`、`src/shared/matt-skills.js`）
- 随包一共 25 个：ask-matt、setup-matt-pocock-skills、wayfinder、triage、grilling、grill-with-docs、grill-me、domain-modeling、research、prototype、implement、code-review、codebase-design、diagnosing-bugs、improve-codebase-architecture、tdd、wizard、handoff、teach、to-spec、to-tickets、to-questionnaire、resolving-merge-conflicts、wait-what、writing-for-agents。（来源：`src/shared/matt-skills.js`）
- 装好即用，不用再跑 npx 下载；自己在用户目录手装的同名技能会优先覆盖随包版本；默认不往用户目录写东西。（来源：中文 `README.md`“技能随包可用”小节）
- 技能缺失或名字对不上时，状态栏和横幅会诚实报警并给出证据链，而不是假装正常。（来源：`src/client/statusbar/checksums.js`、`CONTEXT.md` 技能探测词条）

## 6. 多后端切换：在 GitHub、GitLab、本地 Markdown 之间换跑道

入口：面板设置页的后端选择器、仓库名右侧的切换按钮、状态栏后端相关引导。

- 可选三条真跑道：GitHub、本地 Markdown、GitLab，外加一个“Other（无后端）”逃生舱；没选时面板只做导航引导，不假装有数据。（来源：`src/client/kernel/builtin-backends.js`、`src/client/views/shared/BackendSelector.js`）
- 每一项显示圆点颜色、英文 id、中文名；当前选中的一项会多一个来源小胶囊：显式绑定、自动匹配、回退，一眼知道这个选择从哪来。（来源：`src/client/views/shared/BackendSelector.js`）
- 检测到多个后端都可用时会出黄色“多命中”警告，建议人手动显式绑定；探测没回来时显示“探测未决”，不会卡死。（来源：`src/client/views/shared/BackendSelector.js`）
- 从已选后端换到另一个时，会弹确认框：默认保留原后端数据并可编辑提示语；确认后按新后端重新初始化并注入一次引导指令。（来源：`src/client/views/shared/BackendSelector.js`、`src/client/views/shared/SwitchConfirmModal.js`、`src/client/kernel/store-switch.js`）
- 换跑道后旧后端的数据原地保留、切走即不可见，切回来又可见，不会删数据。（来源：`src/client/kernel/locale-word.js` 的 switch 提示文案）
- 不同后端各有各的检查链：通用检查走系统能力直接测，后端专属检查各回各家，Markdown 卷子上不会冒出 GitHub 的行。（来源：`src/client/views/ChecksTab.js`、`CONTEXT.md` 后端感知架构词条）

## 7. 安装与升级路径：装进对的 profile 才算装上

入口：终端命令、插件市场、发给 AI 的代装文案。

- 前置要求只有一个：先装好 DSH。（来源：中文 `README.md` 安装小节）
- 安装命令必须带 profile：用自启 web 服务就装进 web，用桌面应用就装进 desktop，装错等于没装。（来源：中文 `README.md` 安装小节）
- 标准装法、锁版本装法、免全局装法、换官方源装法四选一，README 都给了现成命令，当前锁版本示例是 1.7.14。（来源：中文 `README.md` 安装与“免全局安装”小节）
- 窄屏想并排看列表和详情，再往同一个 profile 里装 better-sidebar。（来源：中文 `README.md` 安装小节）
- 装完必须重启对应的 DSH 入口：桌面应用完全退出重开，web 服务重启后刷新页面；零配置。（来源：中文 `README.md` 安装小节）
- 升级用 update，卸载用 remove，desktop 用户把命令里的 web 换成 desktop。（来源：中文 `README.md`“升级卸载”小节）
- 刚发布几小时内点更新没反应是 DSH 桌面端的供应链老化策略，不是 bug：完全退出重开、Ctrl+F5 硬刷，或显式指定官方源装一次 latest。（来源：中文 `README.md` 常见问题第一条）
- 懒得敲命令可以复制 README 里那段话发给自己的 AI，让它读仓库、认 profile、检查环境、按需安装。（来源：中文 `README.md`“把安装交给你的 AI”小节）
- 初始化新工作区有六步截图（建工作区、建会话、选后端、确认注入、等 AI 执行、环境检测失败提示），目前放在 `assets/init/`，中文 README 正文没有引用。（来源：`assets/init/` 六张截图）

## 8. README 与 assets 对齐：写了什么、配了什么、缺了什么

### 8.1 中文 README 已经讲到且配了图的（起点已对齐）

- 面板任务列表配 `assets/panel-list-zh.png`。（README“看得见、派得动的任务板”处）
- 底部任务栏配 `assets/statusbar-zh.png`。（README“为什么要做”处）
- ISSUE 详情配 `assets/issue-detail-zh.png`，评论配 `assets/issue-comment-zh.png`。（README“真机演示”处）
- 状态栏技能快捷入口配 `assets/statusbar-skills-menu-zh.png`。（README“真机演示”处）
- 安装、升级、卸载、better-sidebar、代装文案、随包技能、更新是旧版本 FAQ，文字齐全。（README 安装与 FAQ 小节）

### 8.2 assets 里有、README 正文没用上的（补漏候选）

- `assets/issue-authors-zh.png`：作者显示相关截图，正文没引用，详情页作者行没有配图。
- `assets/init/` 六张：新建工作区到环境检测的完整向导截图，正文没引用，新人第一次建工作区没有图可以照着点。
- `assets/*.svg` 两套中英文（hero、features、what-it-is、after-install、other-palette、other-prompt）：英文 README 在用或文档页在用，中文 README 正文没引用，多后端切换、Other 逃生舱没有配图。
- `assets/feishu-*.png`、`assets/qr-hunter-contact.png`：飞书与个人联系方式相关，正文只留了话题群二维码，联系路径不全。

### 8.3 用户用得上、但现有截图和正文都没讲透的（下一轮筛选建议优先）

- 技能页的列表与圆环两种摆法、按地图给推荐的星标，完全没配图，纯文字也只有“状态栏最右侧一键直达”一句。（来源：`src/client/views/SkillsTab.js` 对照 README 真机演示小节）
- 环境检查页：链式步骤、蓝黄红横幅、20 秒自动重查、表单与向导弹窗，README 和截图都没出现。（来源：`src/client/views/ChecksTab.js`）
- 后端切换确认框：保留原数据加可编辑提示语这一步，没配图，新人容易误点。（来源：`src/client/views/shared/SwitchConfirmModal.js`）
- 交接两段按钮什么时候亮、什么时候灰，沉淀按钮按完往哪看，BUG 悬停菜单长什么样，胶囊折叠与收起长什么样，都没配图。（来源：`src/client/statusbar/StatusBar.js`）
- 地图详情的雾、排序、可执行最左，列表的阻塞筛、标签筛、排序、已关闭折叠，NoRepo 红卡，多命中与探测未决，版本号可点，英文版 README（`docs/README.en.md`）是否同步，都没进中文 README 配图。（来源：第 1、6 节诸文件对照 assets 清单）

## 来源清单

- 中文 `README.md` 全文 272 行：安装、WHY、真机演示、FAQ、架构、开发、作者作品、致谢、加入我们。
- `assets/` 共 25 个文件：5 张中文 README 配图、1 张作者截图、6 张 init 向导截图、12 个中英文 SVG、飞书与二维码 3 张。（以 `assets` 目录实测为准）
- `src/client/` 渲染真源：`views/shared/Tabs.js`、`views/ListTab.js`、`views/ListTabRow.js`、`views/MapDetail.js`、`views/IssueDetail.js`、`views/IssueDetailComments.js`、`views/SkillsTab.js`、`views/RingSkills.js`、`views/ChecksTab.js`、`views/NoRepoCard.js`、`views/shared/BackendSelector.js`、`views/shared/SwitchConfirmModal.js`、`statusbar/StatusBar.js`、`floating/SkillFloatList.js`、`kernel/api-new-session.js`、`kernel/store-derived.js`、`kernel/prompts.js`、`shared/matt-skills.js`、`kernel/builtin-backends.js`。
- 本票原文：`gh issue view 481`（标题“研究：README 用用户可见功能全量扫描与清单”，标签 wayfinder:research）。
