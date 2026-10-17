/**
 * src/tracker/kernel/log-emit.ts —— 各房日志出口共用的那几件小事（#1182 第 3 件）。
 *
 * 为什么要有它：三座远端/本地房各自的 `read-log.ts`（GitHub / GitLab / Markdown）与写路径的
 * `write-log.ts` 里，每一处「记一行」的函数都长着同一副骨架 ——
 * `try { 拿不到 logEvent 就静默返回 →（按需再判一次调试开关）→ ctx.logEvent(级别, 事件名, 字段对象)
 * } catch {}`。这层壳一共抄了十几遍，而它守着的是同一句承诺：**日志写不出去绝不能弄坏这一趟操作本身**
 * （读路径不许因为日志而失败、写路径不许因为日志而少写一份文件）。抄十几遍的风险不在于占几行，
 * 在于哪天有人给一处补上处理、另一处忘了补 —— 于是同一句承诺在三个房里成了三种行为。
 * 除了这层壳，还有三件同形的小事：耗时归一化（负数、小数、非数字一律收敛到 0）、
 * 从操作返回里读「成没成 / 失败是哪一档」、把档位拼成 `fail:<档位>`。这三件在几份文件里是
 * 逐字相同的实现（注释略有出入），一并搬来这里。
 *
 * 为什么住在内核、不住在某一个房里：写日志的是三座房，`src/tracker/kernel/` 是这三座房共同的上一层 ——
 * 内核的定义就是「房间与宿主都要用、又不是『类型与数据』的运行时件」（见
 * `src/tracker/kernel/README.md` 与 `docs/adr/20261014-tracker-room-boundary.md`）。
 * 放进任何一座房里都会让另两座跨房 import，而 `.dependency-cruiser.cjs` 的 `cross-room-import`
 * 明令禁止（起点 `^src/tracker/rooms/([^/]+)/`）：三座房是平级的。放进契约层
 * （`src/tracker/contract/`）也不行 —— 那一层只有类型与数据、不许有运行时实现
 * （`tests/verify-contract-types.ts` 第二项守着），本文件带的是函数体。
 *
 * 这个文件**一个 import 都没有**，是有意的：内核里的件互相引用不算违规（同层规则把 `^src/tracker/kernel/`
 * 排除在外），但今天这几份内核件互相零依赖；这里不用契约层的 `OpContext`，是为了让「只要有 logEvent 就能记」
 * 这件事在最底层就成立 —— 测试里手搓的上下文、宿主兜底那条路递进来的瘦上下文都能直接喂进来。
 *
 * 各房**不搬进这里**的东西（同形的是壳，不是内容）：事件名、字段名与字段含义、各房自己的取值表
 * （`READ_DEGRADED_OPS` / `READ_DEGRADED_REASONS` / `ISSUE_WRITE_KINDS` …）、以及「这一趟算成功还是算
 * 降级」那类结论推导。那些本来就是各房各样，硬搬到一处只会把三份不同的说明书混成一份。
 *
 * 隐私：本文件不组装任何字段，字段由调用点按各自登记的形状给出；内核这一层不引入新的可记内容。
 */

/**
 * 记日志时最少需要的那点上下文形状。
 *
 * 两件都是可选的，这是刻意的：调用方递进来的可能是一个没有文件服务、也没有日志服务的瘦上下文
 * （宿主兜底那条路就是这样），`logEvent` 缺席时一律静默返回，不许抛。
 * 这里不引契约层的 `OpContext`，理由见文件头最后一段。
 */
export interface LogEmitCtx {
  /** 落一行的那个口子；缺席表示这个调用方记不了日志。 */
  logEvent?: (level: string, event: string, fields: Record<string, unknown>) => void
  /** 按档位问「这个级别要不要记」；只有按需（调试级）的落点用它。 */
  isEnabled?: (level: string) => boolean
}

/**
 * 记一行日志的统一壳，也是这个文件存在的理由。
 *
 * 做的事按顺序只有三件，与原来各处手写的那层壳逐字同义：
 *   1. 拿不到上下文、或者它没有 `logEvent`：静默返回，连字段都不组装；
 *   2. `guard` 给了、且它回 false：静默返回。**调用方把「没长 isEnabled」也判成 false** ——
 *      于是「拿不准要不要记」时，按需的那些落点选择不记，而不是记出去（同款写法见
 *      `src/tracker/kernel/error-rules.ts` 的 `emitNormalize`）；
 *   3. 调 `emit(ctx)`：真正那一行日志由调用方在这段回调里自己落（字段现取现组装，关掉开关的那一趟零组装）。
 *
 * 整段包 try/catch：**日志写不出去绝不能弄坏这一趟操作本身**。这一条是这些落点共同的承诺，
 * 也是为什么它必须只有一份实现：读路径上它保证「读不动」还是「读不动」，写路径上它保证
 * 「写没写下去」的结论不因为日志而变。
 *
 * 为什么这层壳收的是一段回调，而不是「级别 + 事件名 + 字段」三件现成的值：**`logEvent(...)` 那一行
 * 必须留在各房的调用点上**。全仓的字段白名单门禁（`tests/verify-log-fields.ts`）是照着源码认形状的 ——
 * 它只认 `logEvent('warn', 'read.degraded', { … })` 这种「调用点旁边就摆着字段字面量」的写法，
 * 靠这个把「这个事件有哪些字段」一条条数出来。要是把事件名与字段搬进内核、由内核代发，门禁在房里
 * 就再也看不到这些落点，`read.degraded`、`issue.write` 这些事件会整条判成「全仓未找到」。
 * 所以内核只收「怎么记才安全」这层壳，收不到「记什么」—— 后者本来就该由各房自己说。
 *
 * @param ctx 单次调用上下文（可能是瘦上下文；缺席就什么都不记）
 * @param emit 真正落那一行的地方，写成 `(c) => { c.logEvent(级别, 事件名, { 字段 }) }`；
 *             只有真要落这一行时才会被调到一次，`c` 一定不是空的
 * @param guard 按需落点的外层开关（例如 `() => ctx.isEnabled!('debug') === true`）；常驻落点不传
 *
 * 上下文那一格是泛型，是为了让 `emit` 拿到的还是**调用方自己那个上下文的类型**：
 * 各房的上下文（契约层的 `OpContext`）除 `logEvent` 之外还有 `opId` 这类要原样照抄进字段的格子，
 * 而内核不认识那些格子、也不该认识（认识就等于把契约层的形状搬进内核）。写成 `C extends LogEmitCtx`
 * 之后，调用方传什么上下文，`emit` 的参数就是什么类型，取 `opId` 这类字段照旧有类型可依。
 */
export function guardEmit<C extends LogEmitCtx>(
  ctx: C | null | undefined,
  emit: (ctx: C) => void,
  guard?: () => boolean,
): void {
  try {
    if (!ctx || typeof ctx.logEvent !== 'function') return
    if (guard && guard() !== true) return
    emit(ctx)
  } catch {
    // 日志写不出去不影响这一趟操作：这里什么都不做是行为的一部分，不是漏写。
  }
}

/**
 * 「调试开关开着吗」这一问的统一写法：按需（调试级）落点的外层判断。
 *
 * 与各处原来手写的那句逐字同义：上下文没有 `isEnabled`、或者它回的**不是恰好 `true`**，都算关着
 * —— 「拿不准要不要记」时选择不记，而不是记出去。它单独成一个函数，是因为这句话在按需落点上
 * 出现了七八遍，而它表达的是同一条纪律：**关着的时候连字段对象都不组装**（`guardEmit` 的
 * `guard` 为假时那个回调根本不会被调到）。
 *
 * @param ctx 单次调用上下文（可能是瘦上下文；缺席就是关着）
 * @returns 开关开着才回 true
 */
export function debugOn(ctx: LogEmitCtx | null | undefined): boolean {
  return !!(ctx && typeof ctx.isEnabled === 'function' && ctx.isEnabled('debug') === true)
}

/**
 * 让「这一笔花了多久」永远是一个非负整数：负数、小数、非数字都收敛到 0。
 * 三份 read-log 里逐字相同的那一个（含小数向下取整），搬到这里只有一份。
 */
export function ms(latencyMs: unknown): number {
  const n = typeof latencyMs === 'number' ? latencyMs : Number(latencyMs)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

/**
 * 从操作返回里读「成没成、失败是哪一档」：返回是联合类型，先判 ok，再读 error.kind。
 * 三份 write-log/edge-log 里逐字相同的那一个；档位读不到时写 `unknown`，绝不写空串
 * （空档位在日志里分不清「没失败」与「失败了但没档位」）。
 */
export function outcomeOf(r: unknown): { ok: boolean; errKind: string } {
  const rb = r as { ok?: unknown; error?: { kind?: unknown } } | null | undefined
  return { ok: !!(rb && rb.ok === true), errKind: String((rb && rb.error && rb.error.kind) || 'unknown') }
}

/** 失败一律以档位收尾：查的人不用再去别处拼。取值形如 `fail:network`，这一格不在各房的取值表里。 */
export function failReason(errKind: string): string {
  return 'fail:' + errKind
}
