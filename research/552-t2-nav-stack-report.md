# T2 实现报告：导航栈状态机与返回语义（#552）

状态：已实现并验证，未关闭（等双审查后由总编排决定）。

## 改了什么（3 个源文件，只动界面层）

1. `src/client/kernel/store-snapshot.js`：`makeStore` 里 `activeMap`/`activeIssue` 旁边加 `navStack: []`，元素只存坐标 `{ kind: 'map' | 'issue', n: 数字编号 }`，不存详情正文。
2. `src/client/kernel/store-prefs.js`：`setActiveMap`/`setActiveIssue` 旁边新增压栈 `pushNav`、弹栈 `popNav`、看栈顶 `peekNav`（另有内部用的只读栈 `peekStackNav`、镜像同步 `syncNavMirror`、旧对象补层 `seedNavFromMirror`、清空栈 `clearNavStack`）；旧的 5 个函数收敛为调新函数——进入详情一律压栈，返回一律弹同类栈顶，`clearActiveDetail` 等于清空栈；`activeMap`/`activeIssue` 过渡期保留为栈顶镜像。
3. `src/client/panel/Dock.js`：主列表与拉取请求页签的渲染优先级改为读栈顶（镜像兜底，旧状态不崩）；空栈回列表。

返回语义：进入压栈、返回弹栈、空栈回列表；同一详情重复进入不重复压栈（防双击）；弹栈只改栈与镜像，不碰滚动位置、展开收起、详情缓存与面板快照，所以上一级原样保留、不强制重刷。没有动契约层、后端目录、宿主接口、快照字段与构建机制，也没有新增日志点（纯界面状态，不跨进程、不加缓存与定时任务）。

## Overlay 定夺：明确只支持停靠栏下钻，悬浮面板不动

二选一中选了第二条。理由：悬浮面板本来就没有工单详情分支（点行后详情走停靠栏，见 `PrTab.js` 文件头留痕），在 T2 给它补栈顶分支等于改悬浮面板的渲染，是展示层扩张；靠栈顶镜像，悬浮面板的行为与改动前逐字一致（栈顶是地图就展示地图，栈顶是工单或空栈就回列表）。悬浮面板要不要下钻，留给 T4/T5 与地图负责人定。

## 验证结果

- `node scripts/build.mjs`：通过，双产物已重新生成（含 `package/lib/client.js`）。
- 临时行为抽查（10 组：空栈、单层与旧互斥一致、多层压栈、重复进入去重、逐级弹出、空栈回列表、非法输入、旧对象兼容、弹栈不碰展开与缓存）：全过；抽查脚本用完即删。抽查中发现并修掉一个真 bug：镜像同步用了带兜底的看栈顶，弹空栈时会把旧镜像写回去，已拆出只读栈的 `peekStackNav` 给同步用。
- `tests/verify-active-issue.js`、`tests/verify-kernel.js`、`tests/verify-issue-detail.js`、`tests/verify-mapdetail-fields.js`、`tests/verify-leaves.js`、`tests/verify-strict-module-syntax.js`、`tests/verify-build-artifacts.js`：全过。
- `tests/verify-panel.js`：失败，但干净树（暂存本次改动后）跑同样失败，原因是测试架子自身 `h.wf.refresh is not a function`，与本次改动无关。
- 全量 `npm run verify` 太重没有跑，只跑了上面与状态相关的子集，特此注明。

## 遗留风险（交 T3/T4）

- 调用方还没切：`ListTabRow`、`PrTab`、`IssueDetail`（返回、所属地图、子票、阻塞票）、`MapDetail`（返回）、`SkillsTab` 仍调旧入口；旧入口现在等于压栈/弹栈，所以行为正确，但 T3/T4 应把它们逐个改成直接调新函数并补面包屑。
- 重复访问同一编号会留下重复栈层（如 A→B→A 栈里有两个 A），返回时逐级经过，不截断；T4 若觉得层太深，可再定是否折叠。
- 旧磁盘里没有栈概念，但栈是纯内存会话私有状态，不落盘，所以没有迁移问题。

## 需领导裁决的重大事项

无。本次没有遇到必须动契约层、后端接口或重画地图目的地的情况。
