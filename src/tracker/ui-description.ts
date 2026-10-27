/**
 * src/tracker/ui-description.ts —— 宿主发给界面的「后端描述」只留一条出处（#1139）。
 *
 * ── 为什么要有这份文件 ──────────────────────────────────────────────────────
 * 界面跑在浏览器那一侧，读不到宿主里的后端模块对象：模块对象上挂着 create / matches 这些函数，
 * 过不了进程边界。所以宿主必须把每个后端「只给界面看的那部分」挑出来，放进快照与 wf.registry 回包。
 * 这段挑选原先在宿主里手抄了 11 遍（sessionSnapshot.ts 五处、sessionRefresh.ts 四处、
 * snapshotBuild.ts 一处、workspaceCwd.js 一处），每份都把同一张「哪些字段发给界面」清单重写一次。代价有两条：
 *   1. 哪一处漏一项，就是某条通道少一个字段——不报错、不记日志；界面拿到的是「这个后端没声明」，
 *      于是走「没读到开仓方式」那类兜底。GitHub 的 #620、GitLab 的 #1117 都是这样被漏掉的。
 *   2. 十处里有一处（workspaceCwd.js）键序与另外十处不同，正说明它们是各抄各的。
 * 本文件把「哪些字段算界面描述」收成一张表（数据只有一份），把「怎么拷」收成一个函数（流程只有一份）。
 *
 * ── 为什么住在这里，不住契约目录 ────────────────────────────────────────────
 * 契约目录（src/tracker/contract/）只放类型与契约自己的数据，那份 README 与门禁都守着这条；
 * 本文件带运行时行为（一个循环加一次对象构造），所以和 identity-keys.ts、label-names.ts、
 * fix-contract.ts 一样住在 src/tracker/ 下（#1026 定的口径：行为搬出契约目录，类型留下）。
 * 它对契约只有一个依赖：从 backend-module.ts 取模块对象的类型。
 *
 * ── 判据：键在不在，不看值真不真 ────────────────────────────────────────────
 * 旧写法是 `m.openRepository ? { openRepository: m.openRepository } : {}`：值假（''、null、0）
 * 就被丢掉，于是「声明了空值」与「根本没声明」在投影里变成同一件事，谁也分不出来。本文件改成
 * `if (value !== undefined)`：有定义就带。今天两个取值（'url' 与 'folder'）都是真值，所以对现有
 * 数据零变化；变的是语义本身——以后真出现空值声明，界面能分辨，而不是被当成缺席。
 *
 * ── 边界 ────────────────────────────────────────────────────────────────────
 * 这份投影只驱动界面渲染与引导，数据路径一个字都不许读（#231 的口径）。表里只许放**数据**字段：
 * 下面那个类型过滤器在编译期就把函数字段挡在外面，免得以后有人把 create / matches 也挂进表里
 * （函数过不了进程边界，发过去就是坏数据）。
 */

import type { BackendModule, RoomPresentation } from './contract/backend-module.js'

/**
 * 能从模块对象发给界面的字段名：把函数字段剔掉之后剩下的那些键。
 *
 * 为什么要这层过滤，而不直接写 `keyof BackendModule`：`keyof` 把 create / matches / describe
 * 这些方法也算进来，表里就能写进一个函数——那正是「宁可漏声，不可误发」要防的方向。
 * 写法是一张映射类型：每个键先看它的值能不能当函数用，能就映射成 never（等于从这个联合里消失）。
 */
type UiDescriptionDataField = {
  [K in keyof BackendModule]-?: BackendModule[K] extends (...args: never[]) => unknown ? never : K
}[keyof BackendModule]

/**
 * 界面描述字段表——这份投影的唯一真源。加一个界面字段只改这里一行，宿主零改动；
 * 写错字段名、或写进一个函数字段，编译当场报错（`satisfies` 那一步就是干这个的）。
 *
 * 八项的次序沿用宿主十处里那十处已有的写法（openRepository 及其后追加的两项打开方式放最后），
 * 这样这次收口只有 workspaceCwd.js 那一处的键序跟着变。键序本身不承载语义，统一由这张表说了算。
 */
export const UI_DESCRIPTION_FIELDS = [
  'links',
  'capabilities',
  'prompts',
  'setupPrompt',
  'labelPalette',
  'openRepository',
  // #1557：打开行为的声明也随这份描述发给界面——“用网址还是文件/文件夹打开”是后端
  // 自己知道的事实（本地 Markdown 的票是文件、GitHub 的票是网页），界面不该按地址前缀猜。
  'openIssue',
  'openContainer',
] as const satisfies readonly UiDescriptionDataField[]

/** 表里那八个字段名（联合类型），供类型标注引用，避免第二处手写这八个字符串。 */
export type UiDescriptionField = (typeof UI_DESCRIPTION_FIELDS)[number]

/**
 * 发给界面的那一份。身份三件套（id / label / presentation）永远在——界面画后端列表就要它们；
 * 其余八项按需带上：模块对象上有定义就带，没有就整个键不出现。
 */
export type UiDescription = {
  id: string
  label: string
  presentation?: RoomPresentation
} & Partial<Pick<BackendModule, UiDescriptionField>>

/**
 * 把模块对象投影成发给界面的那一份。宿主各处只调它，不许再各自挑字段。
 *
 * 构造期先用宽类型（Record<string, unknown>）装字段，返回处一次性收回成 UiDescription：
 * 字段名与取值类型已经在编译期由字段表与 `Pick` 钉住，这里是它们进出的唯一一道口子。
 */
export function projectUiDescription(mod: BackendModule): UiDescription {
  const out: Record<string, unknown> = { id: mod.id, label: mod.label, presentation: mod.presentation }
  for (const field of UI_DESCRIPTION_FIELDS) {
    const value = mod[field]
    if (value !== undefined) out[field] = value
  }
  return out as UiDescription
}
