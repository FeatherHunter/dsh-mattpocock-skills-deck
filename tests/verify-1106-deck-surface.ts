// tests/verify-1106-deck-surface.ts —— #1106：九个 deck 工具对外的样子（参数表 / 信封表 / 点数表）
// 门禁归属: src/deck/tools
// 门禁归属: src/deck/shell/call-shell.ts
// 门禁归属: src/shared/refresh/src/tool-cost.ts
//
// 这份门禁只回答一个问题：九个对外工具「长什么样」，是不是还和冻下来的对照面一样？
// 给人读的那一份表在 specs/1106-deck-tool-surface-spec.md —— 那边给人读，这边给机器盯，
// 说的是同一件事：参数改一个键、回执少一格、点数动一条，这里就红。
//
// 五层 + 一条静态扫描，对着票面（#1106）的三张表：
//   一、参数表：九个定义的形状（参数名与书写顺序、必填、枚举、每个对象节点都显式写 additionalProperties:false），
//       连同「模型看到的那几句话」逐字冻住（工具本级一句、每个参数各一句：改一个字就红）。
//   二、信封表：回执只有两种形状 —— 走到选后端之后的 14 格、还没走到之前的 6 格；三态取值；
//       失败时的原因码只能是八个之一（#1195 起超时与抛错分家，多了 backend-timeout）；失败永远是值不是异常（稀奇古怪的参数形状也回值）；
//       记账数不上信封。
//   三、点数表：每一支调用在闸上记多少条、多少点。
//   四、越界：工具层不许出现直连外面的写法（起进程、联网、读环境、读写文件、动态求值）。
//   五、缺省与钳制：参数不传时是多少、传过头时收到多少。这两件事在代码里只是两个数字，形状比对看不见，
//       所以单靠表一抓不住（实测把列票的 50 改成 30、上限 200 改成 500，旧版门禁全绿放行）；
//       这里挂一个「只记录、不真读」的后端，从外面看工具实际把什么交下去、按哪个数截断。
//
// 为什么用真闸 + 真账本 + 真注册表 + 本地 Markdown 房间：记账这件事只有真过一遍闸才看得见。
// 后端说「做不到」那一支按票面点名的缝来 —— 工具表工厂的依赖参数就是唯一的缝（传一个会说做不到的后端）。
//
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1106-deck-surface.ts
// 手工跑要自己挂装载钩子（源码之间写的是 `../src/x.js` 这类说明符，靠钩子改指同名 .ts）；
// 挂进 npm test / verify:parallel / verify-all / test:smoke 四个入口时，钩子由那几处自动加上。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// 夹具口（写法见 tests/lib/deck-decide-stub.js 开头）：#1138 起「用户选过哪个后端」只剩工作区文件里
// 那一条记录（docs/agents/workspace.yaml），注册表上那层 bind 已经整段删掉。下面用内存账本
// chooseWorkspace 顶替工作区文件、用真人选出口的夹具 makeDecideStub 顶替生产出口：工具读到的
// 就还是「这个工作区用户亲手选过 markdown」，写用途才会放行；中途换后端也照旧换一笔账。
import { chooseWorkspace, makeDecideStub } from './lib/deck-decide-stub.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)
let failed = false
let total = 0
const check = (ok: boolean, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const TOOL_FILES: Array<[string, string, string]> = [
  ['src/deck/tools/context.ts', 'createDeckContext', 'deck_context'],
  ['src/deck/tools/issue-get.ts', 'createDeckIssueGet', 'deck_issue_get'],
  ['src/deck/tools/map-snapshot.ts', 'createDeckMapSnapshot', 'deck_map_snapshot'],
  ['src/deck/tools/issue-list.ts', 'createDeckIssueList', 'deck_issue_list'],
  ['src/deck/tools/issue-create.ts', 'createDeckIssueCreate', 'deck_issue_create'],
  ['src/deck/tools/map-plan-create.ts', 'createDeckMapPlanCreate', 'deck_map_plan_create'],
  ['src/deck/tools/map-link.ts', 'createDeckMapLink', 'deck_map_link'],
  ['src/deck/tools/issue-patch.ts', 'createDeckIssuePatch', 'deck_issue_patch'],
  ['src/deck/tools/issue-report.ts', 'createDeckIssueReport', 'deck_issue_report'],
]

/** 表一 · 参数表：九个定义的形状。格式见 shapeOf() 上面那段注释。 */
const FROZEN_SHAPE: Record<string, string> = {
  deck_context: '必填=[] 多传=false',
  deck_issue_get: 'key:string, comments:number, section:string, blocking:boolean, effortId:string 必填=[key] 多传=false',
  deck_map_snapshot: 'key:string, frontierOnly:boolean, detail:枚举(full|thin), effortId:string 必填=[key] 多传=false',
  deck_issue_list: 'state:枚举(open|closed|all), type:枚举(issue|map|all), labels:数组<string>, assignee:string, query:string, limit:number, effortId:string 必填=[] 多传=false',
  deck_issue_create: 'title:string, body:string, kind:枚举(task|bug|map), parentKey:string, labels:数组<string>, assignees:数组<string>, idempotencyKey:string, effortId:string 必填=[title] 多传=false',
  deck_map_plan_create: 'title:string, body:string, planId:string, children:数组<对象(key:string, title:string, body:string, kind:枚举(task|bug|map), labels:数组<string>, assignees:数组<string> 必填=[key,title] 多传=false)>, edges:数组<对象(from:string, to:string, type:枚举(blocked-by|parent) 必填=[from,to] 多传=false)>, labels:数组<string>, effortId:string 必填=[title,children] 多传=false',
  deck_map_link: 'key:string, parentKey:string, blockedBy:数组<string>, edges:数组<对象(key:string, parentKey:string, blockedBy:数组<string> 必填=[key] 多传=false)>, effortId:string 必填=[] 多传=false',
  deck_issue_patch: 'key:string, comment:string, addLabels:数组<string>, removeLabels:数组<string>, assignees:数组<string>, title:string, body:string, progress:string, close:boolean, effortId:string 必填=[key] 多传=false',
  deck_issue_report: 'key:string, note:string, progress:number, effortId:string, release:boolean 必填=[key] 多传=false',
}

/**
 * 表一之二 · 说明：工具本级那句话 + 每个参数各自那句话，逐字冻着。
 * 为什么不只冻形状：说明也是模型看到的样子 —— 把「缺省 50」改个说法、把某句删掉、给某个参数补一句，
 * 模型的选择就可能变，而形状一模一样（实测：改一句参数说明，只有形状比对的那版门禁全绿放行）。
 * 改说明是允许的（比如为了让模型更好懂而润色），但必须连这里一起改：冻结是为了让改动留痕，不是不让改。
 * 这份文本由运行时打印后粘贴（一次性小脚本，见提交说明），不手抄 —— 手抄错了会把「改坏」记成「正常」。
 */
const FROZEN_DESC: Record<string, string> = {
  deck_context: "工具=这是 dsh-mattpocock-skills-deck 插件提供的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo。你要创建、查看、更新 ISSUE，查看 map 与 progress 时，先调用 deck_context 一次，确认 workspace 与 backend；如果 repo 里的说法和这里写的不一样，以这里写的为准。如果 deck_context 返回这个 workspace 还没有选 backend，或拿不到 workspace，就说明本插件不适用这个 workspace，直接停下，不再调用其余 deck 开头的工具，后续怎么做由用户决定。；",
  deck_issue_get: "工具=同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。读一个 ISSUE 的完整关系：正文、评论、label、assignee 与 parent 和 blockedBy 边，每条边标出落点。blocking=false 跳过反向边全仓扫描（快，见 blocking 参数）。；key=票号，例如 713；comments=最多带回几条评论，缺省 50；section=只回正文里这一节（## 标题子串），缺省回全文前 2000 字；blocking=要不要反向阻塞边（谁被这张票阻塞）。缺省要：读全量关系。关掉只读单票本身，跳过一次全仓扫描，快一个数量级；反向边记空并注记，要就再调一次。；effortId=只有本地后端需要填，填票所在的目录名，根目录的不填",
  deck_map_snapshot: "工具=同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。看一个 map 的全部 child ISSUE、进度统计与五个区块，用来判断 map 做到哪一步。detail=thin 只要薄行不断（见 detail 参数）。；key=地图那张票的票号；frontierOnly=只回可接的子票（未关闭、未认领、阻塞已满足），缺省回全部；detail=子票行要多细。缺省 full：每行带正文进度（回包大，票多时被截断）。thin：只要键、标题、状态、标签、认领、阻塞（回包小、清单不断；统计与进度表照算不变；要正文用 deck_issue_get 逐张取）。；effortId=只有本地后端需要填，填票所在的目录名，根目录的不填",
  deck_issue_list: "工具=同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。按状态、label、assignee 与关键词列出 ISSUE 薄行，不回正文与评论。；state=只列哪种状态，缺省 open；type=只列哪种类型，缺省 all；labels=必须同时带上这些 label（AND），缺省不过滤；assignee=只留认领含此人的行，缺省不过滤；query=标题与正文的子串过滤，缺省不过滤；limit=最多回几行，缺省 50，上限 200；effortId=只有本地后端需要填，填票所在的目录名，根目录的不填",
  deck_issue_create: "工具=同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。建一个 ISSUE（map / task / bug），自动补必备 label 与 progress 区，重复调用按锚复用同一张。；title=票的标题；body=正文；缺省时按种类补最小骨架；kind=票的种类，缺省 task；parentKey=父票（一般是地图那张票）的票号；labels=要带的标签，会在必备标签之外追加；assignees=认领人；idempotencyKey=这一批写的幂等锚，重试时带同一个值；effortId=只有本地后端需要填，填票所在的目录名，根目录的不填",
  deck_map_plan_create: "工具=同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。一次建一整张 map 的骨架（map ISSUE + child ISSUE + 依赖边），带逐项校验与可续跑中间态。；title=地图票的标题；body=地图正文；缺省时自动补五个区块；planId=这次计划的标识；重跑时带同一个值就能接着上次没做完的部分继续；想建第二张内容相同的计划时传一个不同的值；children=要建的子票清单；edges=子票之间的边；from 是计划内的短标识（也可以是地图自己，写 @map）；labels=(没有说明)；effortId=只有本地后端需要填，填票所在的目录名，根目录的不填",
  deck_map_link: "工具=同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。给已存在的 ISSUE 补 parent 或 blockedBy 边，写完读回并逐条标出落点。；key=要改的那张票（子票）；parentKey=要挂到的父票；不传就不动父子；blockedBy=这张票被哪些票阻塞（整批替换）；edges=一次改多张票的边；与 key/parentKey/blockedBy 二选一；effortId=只有本地后端需要填，填票所在的目录名，根目录的不填",
  deck_issue_patch: "工具=同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。改一个 ISSUE：评论、label、assignee、开关、标题正文、progress 区，一次只动点名的那些。；key=要改的那张票；comment=要发的评论正文；addLabels=要加的标签；removeLabels=要摘掉的标签；assignees=认领人（整批替换；给空数组就是取掉认领）；title=新的标题；body=新的正文；progress=只改「## 进度」那一段的内容；close=true 关闭这张票，false 重新打开；effortId=只有本地后端需要填，填票所在的目录名，根目录的不填",
  deck_issue_report: "工具=同属插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；先调 deck_context 确认 workspace 与 backend。开始处理、切换或完成一个 ISSUE 时都必须调用：开始前报一次，关闭时再报一次，这条是必选。职责划分：deck_issue_patch 负责变更 issue 内容，deck_issue_report 负责上报处理关系；用前者关闭 issue 不等价于已完成上报。key 填你要上报的 ISSUE 编号；只有本地后端需要填 effortId，填票所在目录名，根目录不填。要释放本会话的一条工作条目时带 release=true（只删本会话那一行，票本身不动）。有没有记上、记在哪里，看返回里的结果。；key=你要上报的那个 ISSUE 的编号；note=可选带一句备注（只回显，不进链）；progress=可选：这次上报的进度自评，0 到 100 的整数；只作展示，不参与任何判定。不传时条目上不记这一格，也不沿用上一次的数字；effortId=只有本地后端需要填，填票所在的目录名，根目录的不填；release=可选：传 true 表示把这张票从本会话的工作路线里释放掉（删掉本会话对它的那条工作条目；不是改票：票的状态与认领人都不动）；不传或传 false 就是正常上报",
}

/** 表二 · 信封表：两种形状的字段清单，一个不多一个不少。 */
const ENVELOPE_FULL = ['backend', 'cost', 'data', 'items', 'notes', 'ok', 'readBack', 'reason', 'repo', 'status', 'text', 'tool', 'touched', 'workspace']
const ENVELOPE_PRE_GATE = ['cost', 'ok', 'reason', 'status', 'text', 'tool']
/** 八个原因码，取值写在 src/deck/shell/call-shell.ts:47-55。 */
const REASONS = ['no-session-context', 'ai-tool-refused', 'no-backend', 'gate-defer', 'backend-threw', 'backend-timeout', 'backend-unsupported', 'bad-args']
const STATUSES = ['ok', 'partial', 'unsupported']

/** 表三 · 点数表：工具自己报的那一笔（不含选后端那固定 1 条 0 点）。 */
type PointsRow = { label: string, tool: string, args: Record<string, unknown>, own: [number, number] | 'est', select: boolean }
const POINTS: PointsRow[] = [
  { label: '工作区概况：成功', tool: 'deck_context', args: {}, own: [3, 2], select: true },
  { label: '建票：缺标题（还没走到选后端）', tool: 'deck_issue_create', args: {}, own: [0, 0], select: false },
  { label: '建票：成功、没有父子边', tool: 'deck_issue_create', args: { title: '点数表甲票', kind: 'task' }, own: [2, 4], select: true },
  { label: '建票：成功、带父子边', tool: 'deck_issue_create', args: { title: '点数表乙票', parentKey: '00' }, own: [3, 6], select: true },
  { label: '读票：缺票号（还没走到选后端）', tool: 'deck_issue_get', args: {}, own: [0, 0], select: false },
  { label: '读票：这张票读不回来', tool: 'deck_issue_get', args: { key: '999999' }, own: [1, 3], select: true },
  { label: '读票：成功、跳反向边', tool: 'deck_issue_get', args: { key: '01', blocking: false }, own: [1, 3], select: true },
  { label: '读票：成功、读全量关系（缺省）', tool: 'deck_issue_get', args: { key: '01' }, own: [2, 6], select: true },
  { label: '列票：成功（回多少行都一样）', tool: 'deck_issue_list', args: {}, own: [2, 5], select: true },
  { label: '看地图：成功、薄行也一样', tool: 'deck_map_snapshot', args: { key: '00', detail: 'thin' }, own: [2, 5], select: true },
  { label: '看地图：这张地图读不回来', tool: 'deck_map_snapshot', args: { key: '999999' }, own: [1, 3], select: true },
  { label: '建图：缺标题（还没走到选后端）', tool: 'deck_map_plan_create', args: {}, own: [0, 0], select: false },
  {
    label: '建图：成功（按估算：3 张票 + 2 条边）', tool: 'deck_map_plan_create', select: true, own: 'est',
    args: { planId: 'points-plan', title: '点数表地图', children: [{ key: 'a1', title: '子一' }, { key: 'a2', title: '子二' }], edges: [{ from: 'a2', to: 'a1', type: 'blocked-by' }] },
  },
  // 计划标识会原样当幂等键写进票面，字符集由后端定：中文会被后端挡下。
  // 这一支顺带钉住这条边界，以及它记账的价（1 条 / 4 点）。
  { label: '建图：计划标识带中文（后端挡下）', tool: 'deck_map_plan_create', args: { planId: '点数表图', title: '点数表地图', children: [{ key: 'c1', title: '子一' }] }, own: [1, 4], select: true },
  { label: '连边：两个都没给（还没走到选后端）', tool: 'deck_map_link', args: {}, own: [0, 0], select: false },
  { label: '连边：挂父子（按估算：1 条边 + 读一次）', tool: 'deck_map_link', args: { key: '02', parentKey: '00' }, own: 'est', select: true },
  { label: '连边：清空阻塞（按估算：没有边 + 读一次）', tool: 'deck_map_link', args: { key: '02', blockedBy: [] }, own: 'est', select: true },
  { label: '改票：缺票号（还没走到选后端）', tool: 'deck_issue_patch', args: {}, own: [0, 0], select: false },
  { label: '改票：成功（按估算：改一次 + 读一次）', tool: 'deck_issue_patch', args: { key: '02', comment: '点数表：改一下' }, own: 'est', select: true },
  { label: '上报：缺票号（还没走到选后端）', tool: 'deck_issue_report', args: {}, own: [0, 0], select: false },
  { label: '上报：成功', tool: 'deck_issue_report', args: { key: '02' }, own: [1, 3], select: true },
  { label: '上报：成功、带进度自评（同价）', tool: 'deck_issue_report', args: { key: '02', progress: 50 }, own: [1, 3], select: true },
  { label: '上报：这张票不存在（同价）', tool: 'deck_issue_report', args: { key: '999999' }, own: [1, 3], select: true },
]

/**
 * 把一个对象节点压成一行可比较的摘要（表一就是拿它比的）。
 * 格式：`字段名:类型` 按定义里的书写顺序排（顺序也冻着——模型看到的就是这个顺序），
 * 类型里 数组 写 `数组<元素>`、对象写 `对象(子摘要)`、枚举写 `枚举(a|b)`；末尾接必填与多传两格。
 * 每个对象节点都必须显式写 additionalProperties:false，缺一个就红（多传即拒靠的就是它）。
 */
function shapeOf(node: any): string {
  const props = node && node.properties ? node.properties : {}
  const names = Object.keys(props)
  const parts = names.map((name) => name + ':' + typeOf(props[name]))
  const required = Array.isArray(node && node.required) ? node.required : []
  const ap = (node && Object.prototype.hasOwnProperty.call(node, 'additionalProperties')) ? String(node.additionalProperties) : '(缺)'
  return (parts.length ? parts.join(', ') + ' ' : '') + '必填=[' + required.join(',') + '] 多传=' + ap
}
function typeOf(node: any): string {
  const t = node && node.type
  if (t === 'array') return '数组<' + (node.items ? typeOf(node.items) : '(缺 items)') + '>'
  if (t === 'object') return '对象(' + shapeOf(node) + ')'
  if (Array.isArray(node && node.enum)) return '枚举(' + node.enum.join('|') + ')'
  return String(t)
}

/**
 * 把一个工具给模型看的话压成一行（表一之二就是拿它比的）：工具本级那句话，接每个参数各自那句话，
 * 按定义里的书写顺序排（顺序也冻着）。参数没有说明就记「(没有说明)」—— 补上一句也算改动，得有人看一眼。
 */
function descOf(def: any): string {
  const props = (def && def.parameters && def.parameters.properties) || {}
  const parts = Object.keys(props).map((n) => n + '=' + (typeof props[n].description === 'string' ? props[n].description : '(没有说明)'))
  return '工具=' + String((def && def.description) || '') + '；' + parts.join('；')
}

/** 两行摘要第一处不一样的地方，给人看是哪一格变了（不是给人读全文）。 */
function firstDiff(want: string, got: string): string {
  const a = want.split('；')
  const b = got.split('；')
  const out: string[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue
    out.push('冻着「' + (a[i] === undefined ? '(没有这一项)' : a[i]) + '」现在「' + (b[i] === undefined ? '(没有这一项)' : b[i]) + '」')
  }
  return out.join('；')
}

/** 一个真实本地 Markdown 工作区（与 tests/verify-deck-tools.js 同一套做法：票就是盘上的 .md）。 */
function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-surface-'))
  const dir = path.join(root, '.scratch', 'demo')
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'map.md'), '# 演示地图\n\nStatus: ready-for-agent\n\n## Destination\n\n把演示做完\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n', 'utf8')
  const plat = {
    path: path.posix,
    fs: {
      async resolve(p: string) { return String(p).replace(/\\/g, '/') },
      async readText(t: string) { return fs.readFileSync(t, 'utf8') },
      async writeText(t: string, c: string) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t: string) { try { return fs.statSync(t) } catch (e) { return null } },
      async listDir(t: string) { try { return fs.readdirSync(t) } catch (e) { return [] } },
      async stat(t: string) { try { return fs.statSync(t) } catch (e) { return null } },
    },
  }
  const rootPosix = root.replace(/\\/g, '/')
  return {
    root, rootPosix, issuesDir: path.join(dir, 'issues'),
    ctx: { platform: plat, fs: plat.fs, cwd: rootPosix, get(name: string) { return name === 'fs' ? plat.fs : undefined } },
    ticketText(name: string) { return fs.readFileSync(path.join(dir, 'issues', name), 'utf8') },
    cleanup() { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

async function main() {
  console.log('#1106 九个工具对外长什么样（参数表 / 信封表 / 点数表）')
  const budget = await imp('src/shared/refresh/budget.js')
  const ledgerMod = await imp('src/host/refresh/ledger.ts')
  const gateMod = await imp('src/host/refresh/gate.ts')
  const registryMod = await imp('src/tracker/registry/core.ts')
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
  const toolCost = await imp('src/shared/refresh/tool-cost.js')

  // ── 组装：真闸 + 真账本 + 真注册表 + 真实本地 Markdown 后端 ──
  const ws = makeWorkspace()
  const clock = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => clock })
  const gate = gateMod.createGate({ ledger, now: () => clock })
  const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, ws.ctx), { matchesTimeout: 200 })
  registry.register(markdownModule)
  const handle = { cwd: ws.rootPosix, refId: '.scratch/demo' }
  // #1138：把「用户选过 markdown」写进夹具账本（等价于工作区文件里那一行）。原来这里是
  // registry.bind(handle, 'markdown')，绑定层已随 #1138 整段删掉。
  chooseWorkspace(ws.rootPosix, 'markdown')
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
  const planStore = (() => { const t = new Map(); return { durable: true, load(id: string) { return t.get(String(id)) || null }, save(id: string, s: unknown) { t.set(String(id), s) } } })()
  // #1261：工作路线用同一份真实现（临时家目录 + 固定时钟），上报回执的在办表形状由下面「二b」钉死。
  const workRouteMod = await imp('src/deck/shell/work-path-bindings.ts') as { createWorkRouteBindings: (io: unknown) => { note: (i: unknown) => Promise<unknown>, read: (i: unknown) => unknown } }
  const workPathHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-surface-workpath-'))
  const workRouteBindings = workRouteMod.createWorkRouteBindings({
    homeDir: workPathHome, now: () => clock,
    readFile: async (p: string) => { try { return fs.readFileSync(p, 'utf8') } catch { return null } },
    writeFile: async (p: string, c: string) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c, 'utf8') },
    mkdir: async (dir: string) => { fs.mkdirSync(dir, { recursive: true }) },
  })
  const deps = {
    gate, registry, budget,
    estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
    backendCtx: ws.ctx, handleFor: () => handle,
    decideBackend: makeDecideStub(registry),
    log: { fire: () => {} },
    now: () => clock,
    invalidate: () => {},
    workRouteNote: (input: unknown) => workRouteBindings.note(input),
    workRouteRead: (input: unknown) => workRouteBindings.read(input),
    workRouteRelease: (input: unknown) => workRouteBindings.release(input),
    planStore,
  }
  const exec = { agent: { session: { id: 's-1106', cwd: ws.rootPosix } } }
  const tools: Record<string, any> = {}
  for (const [file, factory, name] of TOOL_FILES) tools[name] = (await imp(file))[factory](deps)

  const claimedNow = () => ({ requests: gate.stats().claimed.requests, points: gate.stats().claimed.points })
  const run = async (name: string, args: unknown) => {
    let r: any = null
    let threw = ''
    try { r = await tools[name].run(exec, args) } catch (e) { threw = String((e && (e as Error).message) || e) }
    return { r, threw }
  }

  // ── 一、参数表 ──
  console.log('— 一、参数表：九个定义的形状（参数名与顺序、必填、枚举、多传即拒）')
  for (const [, , name] of TOOL_FILES) {
    const got = shapeOf(tools[name].definition.parameters)
    const want = FROZEN_SHAPE[name]
    check(got === want, name + ' 的参数形状没动' + (got === want ? '' : '\n        冻着的：' + want + '\n        现在的：' + got))
  }
  {
    // 说明文本也是模型看到的样子：把「缺省 50」改个说法、给某个参数补一句、删掉一句，模型的选择就可能变。
    // 长度由 tests/verify-deck-tools.js 盯着（≤350 字）、两处关键文案由 tests/verify-deck-thin-reads.ts 盯着，
    // 但「谁把哪句话改了」原来没人盯（实测改一句参数说明是全绿），所以这里逐字冻住。
    const bad: string[] = []
    for (const [, , name] of TOOL_FILES) {
      const got = descOf(tools[name].definition)
      const want = FROZEN_DESC[name]
      if (got !== want) bad.push(name + '：' + firstDiff(want, got))
    }
    check(bad.length === 0, '九个工具给模型看的话没动过（工具本级一句 + 每个参数各一句）' + (bad.length ? '\n        ' + bad.join('\n        ') : ''))
  }
  {
    // 哪些格子有各自的说明、哪些没有，也是模型看到的样子的一部分，所以一并冻住。
    // 现在没有各自说明的是下面这十二个（数组本身有一句说明，条目里的字段没有）：这是本来就有的粗糙处，
    // 不在本票范围内，也不许在这里被悄悄改动 —— 变红说明模型看到的东西变了，得有人来看一眼再决定。
    const FROZEN_NO_DESC = [
      'deck_map_plan_create.children[].title', 'deck_map_plan_create.children[].body', 'deck_map_plan_create.children[].kind',
      'deck_map_plan_create.children[].labels', 'deck_map_plan_create.children[].assignees',
      'deck_map_plan_create.edges[].from', 'deck_map_plan_create.edges[].to', 'deck_map_plan_create.edges[].type',
      'deck_map_plan_create.labels',
      'deck_map_link.edges[].key', 'deck_map_link.edges[].parentKey', 'deck_map_link.edges[].blockedBy',
    ]
    const noDesc: string[] = []
    const walk = (node: any, where: string) => {
      const props = (node && node.properties) || {}
      for (const n of Object.keys(props)) {
        const p = props[n]
        if (typeof p.description !== 'string' || !p.description.trim()) noDesc.push(where + '.' + n)
        walk(p, where + '.' + n)
      }
      if (node && node.items) walk(node.items, where + '[]')
    }
    for (const [, , name] of TOOL_FILES) walk(tools[name].definition.parameters, name)
    const same = noDesc.join('、') === FROZEN_NO_DESC.join('、')
    check(same, '没有各自说明的参数还是那十二个' + (same ? '' : '\n        冻着的：' + FROZEN_NO_DESC.join('、') + '\n        现在的：' + noDesc.join('、')))
  }
  {
    // 多传即拒的机制在定义里：每个对象节点都显式写了 false（工具自己收到不认识的键时当没有）。
    const bad: string[] = []
    const walk = (node: any, where: string) => {
      if (node && node.type === 'object' && node.additionalProperties !== false) bad.push(where)
      const props = (node && node.properties) || {}
      for (const n of Object.keys(props)) walk(props[n], where + '.' + n)
      if (node && node.items) walk(node.items, where + '[]')
    }
    for (const [, , name] of TOOL_FILES) walk(tools[name].definition.parameters, name)
    check(bad.length === 0, '每个对象节点都显式写了 additionalProperties:false（漏的：' + (bad.length ? bad.join('、') : '一个都没有') + '）')
  }
  {
    // 装配顺序：宿主装配与展示都按它来。
    const orderMod = await imp('src/deck/rules/tool-order.ts')
    const want = TOOL_FILES.map((x) => x[2]).join(',')
    check(orderMod.DECK_TOOL_ORDER.join(',') === want, '九个工具的装配顺序冻着：' + want)
  }

  // 先按顺序建出后面要用的票：01 甲票、02 乙票（乙票挂在 00 地图下）。
  await run('deck_issue_create', { title: '信封表甲票', kind: 'task', body: '正文' })
  await run('deck_issue_create', { title: '信封表乙票', parentKey: '00' })

  // ── 二、信封表 ──
  console.log('— 二、信封表：两种形状、三态、八个原因码、失败不抛、记账数不外露')
  const representative: Array<[string, Record<string, unknown>]> = [
    ['deck_context', {}],
    ['deck_issue_get', { key: '01' }],
    ['deck_map_snapshot', { key: '00' }],
    ['deck_issue_list', { state: 'open' }],
    ['deck_issue_create', { title: '信封表丙票' }],
    ['deck_map_plan_create', { planId: 'surface-plan', title: '信封表地图', children: [{ key: 'b1', title: '子一' }] }],
    ['deck_map_link', { key: '02', parentKey: '00' }],
    ['deck_issue_patch', { key: '02', comment: '信封表：改一下' }],
    ['deck_issue_report', { key: '02' }],
  ]
  for (const [name, args] of representative) {
    const { r, threw } = await run(name, args)
    check(!threw && !!r && r.status === 'ok', name + ' 正例：回值且 ok（实得 ' + (threw || (r && r.status)) + '）')
    const keys = r && typeof r === 'object' ? Object.keys(r).sort() : []
    check(keys.join(',') === ENVELOPE_FULL.join(','), name + ' 回执正好 14 格，一格不多一格不少（实得 ' + keys.length + ' 格：' + keys.join(',') + '）')
    check(Object.prototype.hasOwnProperty.call(r, 'claimed') === false, name + ' 记账数不上信封（回执里没有 claimed）')
    check(!!(r && r.cost && r.cost.estimated && typeof r.cost.estimated.points === 'number' && typeof r.cost.estimated.requests === 'number'),
      name + ' 带回调用前的估算（' + JSON.stringify(r && r.cost && r.cost.estimated) + '）')
    check(!!(r && r.cost && r.cost.actual && typeof r.cost.actual.remaining === 'number'), name + ' 带回调用后的真实花费一格（' + JSON.stringify(r && r.cost && r.cost.actual) + '）')
  }
  {
    // 二b、在办表（#1261）：上报成功才有 data.workRoute，失败上报没有这一格；原始会话 id 不进回执。
    // 不带进度时回执 data 与在办表条目都不出现 progress 这一格（最近一次写照）。
    const got = await run('deck_issue_report', { key: '01' })
    const wr = got.r && got.r.data && got.r.data.workRoute
    check(!got.threw && got.r && got.r.status === 'ok' && !!wr, '上报成功回执带 data.workRoute（实得 ' + (got.threw || (got.r && got.r.status)) + '）')
    const keys = wr && wr.entries && wr.entries[0] ? Object.keys(wr.entries[0]).sort().join(',') : ''
    check(keys === 'action,actionAt,active,currentSession,sessionLabel,source,ticketKey,title', '在办表每条正好八格（实得 ' + keys + '）')
    check(!(got.r && got.r.data && Object.prototype.hasOwnProperty.call(got.r.data, 'progress')), '不带进度上报：回执 data 里没有 progress 这一格（实得 ' + JSON.stringify(got.r && got.r.data && got.r.data.progress) + '）')
    check(!!(wr && wr.entries.some((e: { ticketKey: string }) => String(e.ticketKey).replace(/^0+(?=\d)/, '') === '1' && e.action === 'report' && e.source === 'reported' && e.currentSession === true)), '在办表里有刚上报的票（动作 report、来源 reported、当前会话）')
    check(!!(wr && typeof wr.at === 'string' && typeof wr.staleCount === 'number' && wr.collisions === undefined), '在办表有 at 与 staleCount、单会话无 collisions 键')
    check(!!(got.r && (got.r.notes || []).some((n: string) => n.indexOf('工作路线摘要') === 0)), 'notes 带工作路线摘要')
    check(JSON.stringify(got.r).indexOf('s-1106') < 0, '回执全文没有原始会话 id（s-1106 只进盘，不进回执）')
    const failed = await run('deck_issue_report', { key: '999999' })
    check(!failed.threw && failed.r && failed.r.status === 'unsupported' && !(failed.r.data && failed.r.data.workRoute), '失败上报没有 data.workRoute（这一格只属于成功的上报）')
  }
  {
    // 二c、进度自评（#1084）：带 0 到 100 的整数时条目与回执 data 都多一格 progress；不带时两处都不出这一格
    // （同一会话同一票只留最近一次写照，不沿用上一次的数字）；不合规按 bad-args 拒绝。
    const withProgress = await run('deck_issue_report', { key: '01', progress: 37 })
    const wr = withProgress.r && withProgress.r.data && withProgress.r.data.workRoute
    const entry = wr && wr.entries && wr.entries.filter((e: { ticketKey: string }) => String(e.ticketKey).replace(/^0+(?=\d)/, '') === '1')[0]
    check(!withProgress.threw && withProgress.r && withProgress.r.status === 'ok' && !!(withProgress.r && withProgress.r.data && withProgress.r.data.progress === 37),
      '带进度上报：回执 data 里带进度 37（实得 ' + JSON.stringify(withProgress.r && withProgress.r.data && withProgress.r.data.progress) + '）')
    check(!!entry && entry.progress === 37, '带进度上报：在办表这一条带进度 37（实得 ' + JSON.stringify(entry) + '）')
    const entryKeys = entry ? Object.keys(entry).sort().join(',') : ''
    check(entryKeys === 'action,actionAt,active,currentSession,progress,sessionLabel,source,ticketKey,title', '带进度时在办表每条正好九格（实得 ' + entryKeys + '）')
    // 不传进度再报一次：条目是最近一次的写照，旧数字不留。
    const cleared = await run('deck_issue_report', { key: '01' })
    const clearedEntry = (cleared.r && cleared.r.data && cleared.r.data.workRoute && cleared.r.data.workRoute.entries || []).filter((e: { ticketKey: string }) => String(e.ticketKey).replace(/^0+(?=\d)/, '') === '1')[0]
    check(!cleared.threw && !!clearedEntry && clearedEntry.progress === undefined, '不带进度再上报：在办表这一条不再带旧数字（实得 ' + JSON.stringify(clearedEntry && clearedEntry.progress) + '）')
    check(!(cleared.r && cleared.r.data && Object.prototype.hasOwnProperty.call(cleared.r.data, 'progress')), '不带进度再上报：回执 data 里没有 progress 这一格（实得 ' + JSON.stringify(cleared.r && cleared.r.data && cleared.r.data.progress) + '）')
    const clearedKeys = clearedEntry ? Object.keys(clearedEntry).sort().join(',') : ''
    check(clearedKeys === 'action,actionAt,active,currentSession,sessionLabel,source,ticketKey,title', '不带进度时在办表这一条正好八格、progress 不出现（实得 ' + clearedKeys + '）')
    // 不合规的进度：101 / -1 / 12.5 / '30' 都按 bad-args 拒绝，回执还是「还没走到选后端」的六格。
    const badProgress: Array<[string, unknown]> = [['超过 100', 101], ['负数', -1], ['小数', 12.5], ['字符串', '30']]
    const bad: string[] = []
    for (const [label, value] of badProgress) {
      const rr = await run('deck_issue_report', { key: '01', progress: value })
      const cells = Object.keys(rr.r || {}).sort()
      const okShape = !rr.threw && rr.r && rr.r.ok === false && rr.r.reason === 'bad-args' && cells.join(',') === ENVELOPE_PRE_GATE.join(',')
      if (!okShape) bad.push(label + '（' + JSON.stringify({ threw: rr.threw, status: rr.r && rr.r.status, reason: rr.r && rr.r.reason, cells: cells.length }) + '）')
    }
    check(bad.length === 0, '进度自评不合规（超过 100 / 负数 / 小数 / 字符串）一律 bad-args + 六格' + (bad.length ? '：' + bad.join('；') : ''))
  }
  {
    // 二d、释放入口（#1086）：带 release=true 的上报删掉本会话对这张票的工作条目，不记动作、不动票本身；
    // 释放后回执照常带在办表（形状与正常上报一致），再释放同一条说不「本来就没有」，再上报能恢复。
    const norm = (k: string) => String(k).replace(/^0+(?=\d)/, '')
    const beforeGet = await run('deck_issue_get', { key: '02', blocking: false })
    const beforeTicket = beforeGet.r && beforeGet.r.data && beforeGet.r.data.ticket
    const rel = await run('deck_issue_report', { key: '02', release: true })
    check(!rel.threw && rel.r && rel.r.status === 'ok' && Object.keys(rel.r || {}).sort().join(',') === ENVELOPE_FULL.join(','),
      '释放：成功回执正好 14 格（实得 ' + (rel.threw || Object.keys(rel.r || {}).length + ' 格') + '）')
    const relWr = rel.r && rel.r.data && rel.r.data.workRoute
    const relEntries = (relWr && relWr.entries || []).filter((e: { ticketKey: string }) => norm(e.ticketKey) === '2')
    check(!!relWr && relEntries.length === 0, '释放：在办表里已经没有这张票（实得 ' + JSON.stringify(relEntries) + '）')
    check((rel.r && rel.r.notes || []).some((n: string) => n.indexOf('已把票 2 从本会话的工作路线里释放掉') === 0 && n.indexOf('还剩 1 条在办') > 0),
      '释放：备注写明删掉了哪张票与剩余条数（实得 ' + JSON.stringify(rel.r && rel.r.notes) + '）')
    check(!(rel.r && rel.r.data && Object.prototype.hasOwnProperty.call(rel.r.data, 'progress')), '释放回执的 data 里不出现 progress 这一格（释放不记动作）')
    const afterGet = await run('deck_issue_get', { key: '02', blocking: false })
    const afterTicket = afterGet.r && afterGet.r.data && afterGet.r.data.ticket
    const faceOf = (t: any) => JSON.stringify(t && { state: t.state, assignees: t.assignees })
    check(!afterGet.threw && afterGet.r && afterGet.r.status === 'ok' && !!beforeTicket && !!afterTicket
      && faceOf(beforeTicket) === faceOf(afterTicket),
      '释放不改票本身：票照样读得回来，状态与认领人前后一致（前 ' + faceOf(beforeTicket) + '，后 ' + faceOf(afterTicket) + '）')
    const relAgain = await run('deck_issue_report', { key: '02', release: true })
    check(!relAgain.threw && relAgain.r && relAgain.r.status === 'ok'
      && (relAgain.r.notes || []).some((n: string) => n.indexOf('本来就不在本会话的工作路线里') >= 0),
      '再释放同一条：成功回执 + 备注说本来就没有（不冒充删掉）')
    const relFalse = await run('deck_issue_report', { key: '02', release: false })
    const relFalseWr = relFalse.r && relFalse.r.data && relFalse.r.data.workRoute
    check(!relFalse.threw && relFalse.r && relFalse.r.status === 'ok'
      && (relFalseWr && relFalseWr.entries || []).some((e: { ticketKey: string }) => norm(e.ticketKey) === '2'),
      'release:false 仍走正常上报：条目重新落上、回执带在办表')
  }
  {
    // 失败那一侧：还没走到选后端就失败的回执是 6 格；走到之后的失败回执是 14 格。别的形状一律算破。
    const shapes: Array<[string, Record<string, unknown>]> = [
      ['deck_issue_get', {}], ['deck_issue_create', {}], ['deck_map_snapshot', {}],
      ['deck_map_plan_create', {}], ['deck_map_link', {}], ['deck_issue_patch', {}], ['deck_issue_report', {}],
      ['deck_issue_get', { key: '999999' }], ['deck_map_snapshot', { key: '999999' }], ['deck_issue_report', { key: '999999' }],
    ]
    const unexpected: string[] = []
    const badReason: string[] = []
    for (const [name, args] of shapes) {
      const { r, threw } = await run(name, args)
      if (threw) { unexpected.push(name + ' 抛了：' + threw); continue }
      const keys = Object.keys(r || {}).sort().join(',')
      if (keys !== ENVELOPE_FULL.join(',') && keys !== ENVELOPE_PRE_GATE.join(',')) unexpected.push(name + ' 回执形状没见过的 ' + keys)
      if (!STATUSES.includes(r.status) || r.ok !== (r.status === 'ok')) unexpected.push(name + ' 三态不成形：' + JSON.stringify({ status: r.status, ok: r.ok }))
      if (r.status !== 'ok' && !REASONS.includes(r.reason)) badReason.push(name + ' 原因码不认识：' + r.reason)
      if (r.status === 'ok' && r.reason !== '') badReason.push(name + ' 成功了却带原因码：' + r.reason)
    }
    check(unexpected.length === 0, '失败也回值、回执只有两种形状、三态自洽' + (unexpected.length ? '：' + unexpected.join('；') : ''))
    check(badReason.length === 0, '失败的原因码都在八个码里（' + (badReason.length ? badReason.join('；') : '零例外') + '）')
  }
  {
    // 稀奇古怪的参数形状：一律回值，一支都不许抛（抛出去 AI 会退回去用 gh，两条写路径同时开火）。
    const hostiles: unknown[] = [undefined, null, 42, '字符串', [], { key: {} }]
    const threwList: string[] = []
    let seen = 0
    for (const [, , name] of TOOL_FILES) {
      for (const bad of hostiles) {
        const { r, threw } = await run(name, bad)
        seen += 1
        if (threw) threwList.push(name + '(' + JSON.stringify(bad) + ')：' + threw)
        else if (!r || typeof r !== 'object' || !STATUSES.includes(r.status)) threwList.push(name + '(' + JSON.stringify(bad) + ') 没回三态回执')
      }
    }
    check(threwList.length === 0, '九个工具 × ' + hostiles.length + ' 种怪参数（共 ' + seen + ' 次）都回值不抛' + (threwList.length ? '：' + threwList.join('；') : ''))
  }

  // ── 三、点数表 ──
  console.log('— 三、点数表：每一支调用在闸上记多少条、多少点')
  {
    const limits = { maxPointsPerCall: 600, maxRequestsPerCall: 400, maxPointsPerHour: 2000, maxRequestsPerHour: 1500, maxChildTicketsPerCall: 60, usedPointsThisHour: 0, usedRequestsThisHour: 0 }
    for (const row of POINTS) {
      const before = claimedNow()
      const { r, threw } = await run(row.tool, row.args)
      const after = claimedNow()
      const delta = { requests: after.requests - before.requests, points: after.points - before.points }
      let own: [number, number]
      if (row.own === 'est') {
        const est = toolCost.estimateToolCost(toolCost.toolCostInputFrom(row.tool, row.args), limits)
        own = [est.requests, est.points]
      } else own = row.own
      const want = { requests: own[0] + (row.select ? 1 : 0), points: own[1] }
      const ok = !threw && delta.requests === want.requests && delta.points === want.points
      check(ok, row.label + '：这一笔记 ' + want.requests + ' 条 / ' + want.points + ' 点（实得 ' + delta.requests + ' / ' + delta.points + (threw ? '，抛了 ' + threw : '，状态 ' + (r && r.status)) + '）')
    }
  }
  {
    // 后端说「做不到」那一支（票面点名的缝：工具表工厂的依赖参数）。本地房间不会这样失败，所以另挂一个后端。
    const refusing = {
      id: 'refuse-1106', label: '会说做不到的后端', matches: async () => false,
      create: () => ({
        id: 'refuse-1106',
        async list() { return { ok: false, error: { kind: 'unsupported', message: '这次故意说做不到（门禁探针）' } } },
        async create() { return { ok: false, error: { kind: 'unsupported', message: '这次故意说做不到（门禁探针）' } } },
      }),
    }
    const dispose = registry.register(refusing)
    // #1138：换成「这个工作区选了这个后端」的唯一写法 —— 往夹具账本里改一笔（原来这里是 registry.bind）。
    chooseWorkspace(ws.rootPosix, 'refuse-1106')
    try {
      const before = claimedNow()
      const listed = await run('deck_issue_list', { state: 'open' })
      const afterList = claimedNow()
      check(listed.r && listed.r.status === 'unsupported' && listed.r.reason === 'backend-unsupported',
        '后端说做不到：列表这一支回 unsupported + backend-unsupported（实得 ' + (listed.r && listed.r.status) + '/' + (listed.r && listed.r.reason) + '）')
      check(afterList.requests - before.requests === 2 && afterList.points - before.points === 3,
        '后端说做不到：列表这一笔记 2 条 / 3 点（实得 ' + (afterList.requests - before.requests) + ' / ' + (afterList.points - before.points) + '）')
      const beforeCreate = claimedNow()
      const created = await run('deck_issue_create', { title: '后端说建不成的那一张' })
      const afterCreate = claimedNow()
      check(created.r && created.r.status === 'unsupported' && created.r.reason === 'backend-unsupported',
        '后端说做不到：建票这一支回 unsupported + backend-unsupported（实得 ' + (created.r && created.r.status) + '/' + (created.r && created.r.reason) + '）')
      check(afterCreate.requests - beforeCreate.requests === 2 && afterCreate.points - beforeCreate.points === 4,
        '后端说做不到：建票这一笔记 2 条 / 4 点（实得 ' + (afterCreate.requests - beforeCreate.requests) + ' / ' + (afterCreate.points - beforeCreate.points) + '）')
    } finally { dispose.dispose(); chooseWorkspace(ws.rootPosix, 'markdown') }
  }

  {
    // 同一份计划标识同时在两次执行里跑：先到的那次上锁，后到的那次在碰后端之前就被挡下，一分钱不记。
    // 这一支写着「计划标识正被别的执行占用」，平常跑不出来，所以这里并发叫两次把它逼出来。
    const raceArgs = { planId: 'race-plan', title: '并发地图', children: [{ key: 'r1', title: '唯一子票' }] }
    const before = claimedNow()
    const [one, two] = await Promise.all([run('deck_map_plan_create', raceArgs), run('deck_map_plan_create', raceArgs)])
    const after = claimedNow()
    const refused = [one, two].filter((x) => !x.threw && x.r && x.r.status === 'unsupported' && x.r.reason === 'backend-unsupported')
    const succeeded = [one, two].filter((x) => !x.threw && x.r && x.r.status === 'ok')
    const delta = { requests: after.requests - before.requests, points: after.points - before.points }
    check(refused.length === 1 && succeeded.length === 1,
      '同一个计划标识并发叫两次：恰好一次被挡下、一次做成（挡下 ' + refused.length + ' 次、做成 ' + succeeded.length + ' 次）')
    check(refused.length === 1 && refused[0].r && Object.keys(refused[0].r).length === ENVELOPE_PRE_GATE.length,
      '被挡下的那一次回的是「还没走到选后端」的那种形状（' + (refused[0] && refused[0].r ? Object.keys(refused[0].r).length : '?') + ' 格）')
    check(delta.requests === 8 && delta.points === 13,
      '并发这一次只记做成的那一笔（1 张地图 + 1 张子票 + 1 条父子边 + 选后端 1 条 = 8 条 / 13 点），被挡下的不记（实得 ' + delta.requests + ' 条 / ' + delta.points + ' 点）')
  }

  // ── 四、越界判据 ──
  console.log('— 四、越界：工具层不许出现直连外面的写法')
  {
    // 每一条都配一个「必须命中」的例子与一个「不许误伤」的反例：表里任何一条写错，它就成了一条永不命中的死条目，
    // 而外面那条断言只会更绿 —— 这正是假门禁的典型形状，所以每条都要当场证明自己是活的。
    const PATTERNS: Array<{ re: RegExp, label: string, hit: string, miss: string }> = [
      { re: /child_process/, label: '起进程', hit: "require('child_process')", miss: 'const childProcessName = 1' },
      { re: /\bfetch\s*\(/, label: '联网', hit: "fetch('https://x')", miss: 'const fetchLabel = 1' },
      { re: /process\.(env|argv|pid|platform)/, label: '读环境', hit: 'process.env.HOME', miss: 'const processed = 1' },
      { re: /require\s*\(/, label: '旧式取模块', hit: "require('node:fs')", miss: 'const requiredField = 1' },
      { re: /from\s+['"]node:/, label: '取 Node 能力', hit: "import fs from 'node:fs'", miss: "import x from './x.js'" },
      { re: /fs\.(readFile|writeFile|readdir)/, label: '读写文件', hit: 'fs.readFile(p)', miss: 'const fsLike = 1' },
      { re: /\bgh\s+(issue|api|pr|repo)\b/, label: '走命令行 gh', hit: "const cmd = 'gh issue view 1106'", miss: "const ghName = 'gh'" },
      { re: /\beval\s*\(/, label: '动态求值', hit: "eval('1')", miss: 'const evaluate = 1' },
      { re: /new\s+Function\s*\(/, label: '动态构造函数', hit: "new Function('return 1')", miss: 'const funcFactory = 1' },
    ]
    for (const p of PATTERNS) {
      check(p.re.test(p.hit), '越界写法表里这条真的会命中：' + p.label + '（' + p.hit + '）')
      check(!p.re.test(p.miss), '越界写法表里这条不误伤正常写法：' + p.label + '（' + p.miss + '）')
    }
    // 时间这一类单独判，不能一禁了之：票面的可动清单里，超时钳制与「测试里可换的时钟缺省」是点过名允许的，
    // 九份工具都各写了一份。真正要拦的是拿它们去读真实时间做业务判断。所以规则是「栏行 + 同行必须还有另一半」：
    //   时钟缺省：这一行出现 Date.now / new Date 时，同行必须写着 typeof d.now === 'function'；
    //   超时钳制：这一行出现 setTimeout 时，同行必须写着 Promise（那支超时竞赛）。
    // 判每一行而不是整份文件，是因为这两件事本来就写在同一行里，按行判才能同时抓住两种情形。
    const ALLOWED: Array<{ label: string, line: RegExp, mustAlso: RegExp, hit: string, miss: string }> = [
      {
        label: '时钟缺省', line: /Date\.now|new\s+Date\s*\(/, mustAlso: /typeof d\.now === 'function'/,
        hit: 'const t = Date.now()', miss: "now: (typeof d.now === 'function') ? d.now : Date.now",
      },
      {
        label: '超时钳制', line: /setTimeout\s*\(/, mustAlso: /Promise/,
        hit: 'setTimeout(f, 1)', miss: 'new Promise(function (r) { setTimeout(function () { r(1) }, 1) })',
      },
    ]
    for (const a of ALLOWED) {
      check(a.line.test(a.hit) && !a.mustAlso.test(a.hit), '允许形状表：' + a.label + ' 的越界写法真会被抓到（' + a.hit + '）')
      check(!(a.line.test(a.miss) && !a.mustAlso.test(a.miss)), '允许形状表：' + a.label + ' 的正常写法不误伤（' + a.miss + '）')
    }
    const dir = path.join(ROOT, 'src', 'deck', 'tools')
    const names = fs.readdirSync(dir).filter((n) => n.endsWith('.ts')).sort()
    // 工具层就是这十份：九份工具 + 顺序表的宿主侧门面。门面（tool-order.ts）只转发一行，
    // 本体在 src/deck/rules/tool-order.ts，跟装表住同一层。多一份少一份都该有人看一眼。
    const EXPECTED_FILES = ['context.ts', 'issue-create.ts', 'issue-get.ts', 'issue-list.ts', 'issue-patch.ts', 'issue-report.ts', 'map-link.ts', 'map-plan-create.ts', 'map-snapshot.ts', 'tool-order.ts'].sort()
    check(names.join(',') === EXPECTED_FILES.join(','), '工具层是九份工具 + 顺序表门面这十份（实际 ' + names.join(',') + '）')
    const bad: string[] = []
    let sawClock = 0
    let sawTimer = 0
    for (const name of names) {
      const text = fs.readFileSync(path.join(dir, name), 'utf8')
      // 注释里会讲清为什么不许用这些写法，所以先把注释剔掉再扫。
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
      for (const line of code.split('\n')) {
        for (const p of PATTERNS) if (p.re.test(line)) bad.push(name + '：' + p.label + '（' + line.trim().slice(0, 60) + '）')
        for (const a of ALLOWED) {
          if (!a.line.test(line)) continue
          if (a.label === '时钟缺省') sawClock += 1
          else sawTimer += 1
          if (!a.mustAlso.test(line)) bad.push(name + '：' + a.label + '写成了不许的样子（' + line.trim().slice(0, 80) + '）')
        }
      }
    }
    check(bad.length === 0, bad.length
      ? '工具层有直连外面的写法：' + bad.join('；')
      : '十份文件里没有起进程、联网、走 gh、读环境、旧式取模块、取 Node 能力、读写文件、动态求值的写法；时间只用在票面点名的两种形状上')
    check(sawClock > 0 && sawTimer > 0, '允许形状表在真实文件上确实被走到（时钟缺省 ' + sawClock + ' 处、超时钳制 ' + sawTimer + ' 处），这套判据不是空转')
  }

  // ── 五、缺省与钳制 ──
  console.log('— 五、缺省与钳制：不传这个参数时是多少、传过头时收到多少')
  {
    // 这两件事在代码里只是两个数字，表一（形状）看不见它们 —— 实测把列票的缺省 50 改成 30、上限 200 改成 500，
    // 只有形状比对的那版门禁全绿放行。办法是从外面撞：挂一个「只记录、不真读」的后端，
    // 它把收到的条件记下来，再回一批固定 300 行的清单；于是「回给模型几行」只由工具自己那个数决定，
    // 不用去读源码里的数字（读源码只是把同一份东西抄第二遍）。
    const ROWS = Array.from({ length: 300 }, (_, i) => ({ key: 'r' + (i + 1), title: '假行 ' + (i + 1), state: 'open', type: 'issue', labels: [], assignees: [], updatedAt: '', url: '', effortId: '', parentKey: null }))
    const ONE_ISSUE = { key: '01', title: '假票', state: 'open', type: 'issue', labels: [], assignees: [], body: '正文', comments: [], parentKey: null }
    const seen: Array<{ call: string, filter?: unknown, opts?: unknown }> = []
    const recorder = {
      id: 'record-1106', label: '只记录、不真读的后端', matches: async () => false,
      create: () => ({
        id: 'record-1106',
        async list(_repo: unknown, filter: unknown) { seen.push({ call: 'list', filter: filter }); return { ok: true, data: ROWS } },
        async get(_repo: unknown, _key: unknown, opts: unknown) { seen.push({ call: 'get', opts: opts }); return { ok: true, data: ONE_ISSUE } },
        async getDependencies() { seen.push({ call: 'getDependencies' }); return { ok: false, error: { kind: 'unsupported', message: '记录用后端：只记录，不真读' } } },
      }),
    }
    const disposeRec = registry.register(recorder)
    // #1138：同上，换成往夹具账本里改一笔（原来这里是 registry.bind）。
    chooseWorkspace(ws.rootPosix, 'record-1106')
    const take = () => { const x = seen.slice(); seen.length = 0; return x }
    const returnedOf = (r: any) => (r && r.data && typeof r.data.returned === 'number') ? r.data.returned : -1
    try {
      // 列票：后端每次都回 300 行，回给模型几行只由工具自己那个数决定；顺带看它把什么过滤条件交下去。
      const listCases: Array<[string, Record<string, unknown>, number, string]> = [
        ['不传条数（缺省 50）', {}, 50, '{"state":"open"}'],
        ['传 30', { limit: 30 }, 30, '{"state":"open"}'],
        ['传 500（超过上限 200）', { limit: 500 }, 200, '{"state":"open"}'],
        ['传 0（不算数，退缺省 50）', { limit: 0 }, 50, '{"state":"open"}'],
        ['传 state=all（全选就不往后端送这一格）', { state: 'all' }, 50, '{}'],
        ['传 type=map（在内存里筛，300 行都是 issue）', { type: 'map' }, 0, '{"state":"open","type":"map"}'],
      ]
      for (const [label, args, wantRows, wantFilter] of listCases) {
        const { r, threw } = await run('deck_issue_list', args)
        const calls = take()
        const filter = calls.length ? calls[0].filter : '(没调后端)'
        const gotRows = returnedOf(r)
        check(!threw && gotRows === wantRows, '列票 ' + label + '：回 ' + wantRows + ' 行（实得 ' + (threw || gotRows) + '）')
        check(JSON.stringify(filter) === wantFilter, '列票 ' + label + '：交给后端的过滤条件是 ' + wantFilter + '（实得 ' + JSON.stringify(filter) + '）')
      }
      // 读票：评论数交下去是多少；blocking 缺省要不要反向边（要就真去取一次，关掉就整段跳过）。
      const getCases: Array<[string, Record<string, unknown>, number, boolean]> = [
        ['不传评论数（缺省 50）、不传 blocking（缺省要反向边）', { key: '01' }, 50, true],
        ['传评论数 30', { key: '01', comments: 30 }, 30, true],
        ['传评论数 500（超过上限 200）', { key: '01', comments: 500 }, 200, true],
        ['传评论数 0（不算数，退缺省 50）', { key: '01', comments: 0 }, 50, true],
        ['传 blocking=false（跳过反向边）', { key: '01', blocking: false }, 50, false],
      ]
      for (const [label, args, wantFirst, wantDep] of getCases) {
        const { r, threw } = await run('deck_issue_get', args)
        const calls = take()
        const getter = calls.filter((x) => x.call === 'get')[0]
        const first = (getter && getter.opts && (getter.opts as any).comments) ? (getter.opts as any).comments.first : '(没调后端)'
        const sawDep = calls.some((x) => x.call === 'getDependencies')
        check(!threw && first === wantFirst, '读票 ' + label + '：要后端的评论数是 ' + wantFirst + '（实得 ' + (threw || first) + '）')
        check(sawDep === wantDep, '读票 ' + label + '：' + (wantDep ? '会去取反向阻塞边' : '跳过反向阻塞边') + '（实得 ' + (sawDep ? '取了' : '没取') + '）')
      }
    } finally { disposeRec.dispose(); chooseWorkspace(ws.rootPosix, 'markdown') }
  }

  try { fs.rmSync(workPathHome, { recursive: true, force: true }) } catch (e) {}
  ws.cleanup()
  console.log('共 ' + total + ' 项，' + (failed ? '有失败' : '全部通过'))
  // 显式收工，同 tests/verify-deck-tools.js 与金标准回执那两扇。原因是本门禁真的走调用链：
  // 主逻辑 215 毫秒就跑完，之后进程还挂着几个「超时钳制」留下的定时器，最晚的约 60 秒才到 ——
  // 不写这一句，门禁会白等一分钟（量过：整进程 60.3 秒）。
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('  FAIL 异常：' + ((e && e.stack) || e)); process.exit(1) })
