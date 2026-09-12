/**
 * label-color-core/src/ports.ts —— 标签配色的插口形状（只放形状，不放运行时代码）
 *
 * 这个文件回答的是「核心需要外面提供什么」，所以这里只写形状：标签清单里的一行、
 * 一项改动、逐条记账的结果，以及两条方法的签名。核心第一批全是纯函数，自己不读写
 * 任何外部东西，所以这些形状现在还没有运行时的调用方——它的价值有两条：等下面接
 * 适配器时照它实现，以及让「插口由核心定、跑腿的活全在外面」这条纪律有一个
 * 机器看得见的落点（门禁会读一次这个文件的产物，确认模块标识还在）。
 *
 * 这里不写操作名，也不写错误分档。操作名（listLabels / setLabelColors）与错误档
 * （env / auth / rate-limit / conflict / unsupported / not-found / network / parse）
 * 归 tracker 契约层，规格见 #627 与 src/host/tracker/contract.js；两处各管一段，
 * 不要在这里再抄一份，否则以后改档位要改两个地方。
 */

/**
 * 标签清单里的一行。
 *
 * color 一律是「不带井号的小写六位十六进制」（例如 `9d7cd8`）；空串表示这个标签
 * 还没配颜色，界面按灰显示——空串是合法取值，不是错误，判断时不要把它当成缺失。
 * description 省略表示「这个后端给不了描述」，与「描述是空字符串」不是一回事。
 */
export interface LabelColorRow {
  name: string
  color: string
  description?: string
}

/** 一项要发给后端的改动：改哪个标签、改成什么颜色（同样是不带井号的小写六位）。 */
export interface ColorChange {
  name: string
  color: string
}

/**
 * 一项没改成功的改动：改的是哪个标签、为什么没改成功。
 *
 * reason 的形状与 tracker 契约层逐条记账里的失败条目**完全一致**（`{ kind, message }`），
 * 不另造字段名：同一个概念在仓库里只允许有一种写法，契约是已经定版、下游正照着实现的权威
 * （见 #627 的规格与 src/host/tracker/contract.js），核心是后来者，向它对齐。
 * kind 取契约那八个档位之一（env / auth / rate-limit / conflict / unsupported / not-found /
 * network / parse），具体取值表写在契约层，不在这里再抄一份。
 * message 是给人看的一句话，由后端组装好，界面直接显示。
 */
export interface ColorChangeFailure {
  name: string
  reason: { kind: string; message: string }
}

/**
 * 一次批量改色的逐条记账结果。
 *
 * ok 与 failed 都是数组，各自不会省略：全部成功时 failed 是空数组，全部失败时
 * ok 是空数组。为什么不做「整体成败」：批量改色中途失败不会回滚，会留下「前几个
 * 改了、后几个没改」的半成品，只给整体成败的话，界面在部分成功时只能说谎。
 */
export interface ColorChangeResult {
  ok: ColorChange[]
  failed: ColorChangeFailure[]
}

/**
 * 外面要实现的两件事：列出「这个后端能改色的全部标签」，以及按一批改动去改色。
 * 两个方法都是异步的——真正的读写都在适配器里（GitHub 房间、本地 Markdown 房间），
 * 核心只按这份形状把请求与结果转手。
 */
export interface LabelColorPorts {
  listLabels(): Promise<LabelColorRow[]>
  applyColors(changes: ColorChange[]): Promise<ColorChangeResult>
}

/**
 * 这份形状定义在哪个文件里。
 * 类型在转译时会被擦掉，产物里只剩这一行模块标识，用来证明「产物确实来自这份源码」。
 */
export const PORTS_SOURCE = 'label-color-core/src/ports.ts'
