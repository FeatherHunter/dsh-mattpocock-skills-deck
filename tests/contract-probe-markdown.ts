/**
 * 本地 Markdown 后端的贴合探针（#1026）：只做类型检查，不跑、不改后端。
 *
 * 它证明的事：`markdownModule` 这个对象能原样赋给契约的模块形状——必填四件套
 * `id` / `label` / `create` / `matches` 齐且形状对，可选成员（`prompts` / `fixes` /
 * `labelPalette` 等）一个不少且形状对；`getRepoPermissions` 这类只读旁路是可选的，
 * 没有也不算违约——诚实省略，不硬装。后端以后加成员、改形状，改歪了这里当场红——
 * 这就是「门禁长牙」的含义。
 *
 * 它诚实弱化的有两处（都写在类型里，不藏）：
 * - `create` 的**返回深层**（造出来的实例是不是每条操作都
 * 合 `OpResult` 的字面量联合）。原因如实写在这里：后端实现是旧语言时代写成的，
 * 返回对象经变量组装，`ok` 被加宽成 `boolean`，按契约的字面量联合算是不合
 * （这是真实存在的差距，不是探针的误报）。把它修对要给几十个后端函数补返回标注，
 * 那是后端实现面的改动——讨论票（#1025 第 7 条）定了本票不碰实现面，所以这里
 * 只断 `create` 是函数、存在、可调用，深层一致性留给后续专票（见 #1026 正文
 * 「下一步」）。
 * - `openRepository` 的**字面量**：两房声明的是对的（GitHub `'url'`、Markdown `'folder'`），
 *   但旧语言文件里的字面量被加宽成 `string`，静态只能断存在、断不断错；
 *   真值（`'url'` / `'folder'` 二选一）由门禁的运行时腿断（见门禁第七项）。
 * - `checks` 的**种类**：契约写的是数组（`RoomCheckEntry[]`），GitHub 房实际带的是
 *   一个零参数函数（调一次回一份新数组，防调用方改到冻住的源数组）；全仓搜下来今天
 *   没有任何调用方（宿主走 detectChain，不走它）。Markdown 房干脆没带（可选，本来就合法）。
 *   数组还是工厂、留还是删，要另起专票定——本票不猜、不改，只断存在；真种类由门禁
 *   的运行时腿如实记录（见门禁第七项）。
 *
 * 它不证明的另一件事：后端函数内部写得对不对。探针编译用宽松开关
 * （`noImplicitAny` 关），没标注的参数按 `any` 过；后端文件内部自己的报错
 * （联合收窄、参数个数这类）由门禁另行计数、不拦住本项（见门禁第五项）。
 *
 * 跑法：由契约门禁 `tests/verify-contract-types.js` 的第五项拿 `tsc` 直接编本文件
 * （命令行开关，不经任何 `tsconfig`——免得过渡引用触发覆盖对账的重复归属）。
 * 平时不要直接跑本文件，它没有运行时行为。
 */

/// <reference path="./contract-probe-env.d.ts" />

import type { BackendModule } from '../src/tracker/contract/backend-module.js'
import { markdownModule } from '../src/tracker/rooms/markdown/index.js'

/** 探针断言用的形状：与 `BackendModule` 有三处诚实弱化（理由都见文件头）。
 * - `create` 只断存在与可调用：返回深层的 `OpResult` 字面量一致性要动后端实现面，留给后续专票。
 * - `openRepository` 只断存在：字面量被加宽成 `string`，静态不断字面量；真值由门禁的运行时腿断。
 * - `checks` 只断存在：数组还是工厂要另起专票定；真种类由门禁的运行时腿如实记录。
 *
 * **导出它的理由**（#1051 讨论结论第 3 条）：门禁的第二条反面证明要拿探针同款开关 + 这份真形状，
 * 现拼一个缺 `matches` 的假后端，断「弱化之后仍然抓得住缺成员」。理由与 GitHub 那份同一条。 */
export type ProbeShape = Omit<BackendModule, 'create' | 'openRepository' | 'checks'> & {
  create: (...args: any[]) => unknown
  openRepository?: unknown
  checks?: unknown
}

export const markdownProbe: ProbeShape = markdownModule
