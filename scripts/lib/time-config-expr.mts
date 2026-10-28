// time-config-expr.mts —— 时间参数数组项里的「引用另一个键」写法（票 #1629）。
//
// 为什么要有这个模块：中央时间参数里有一个数要同时充当几种含义——「一步等待的上限」只有一个值
// （config/timeouts.yaml 的 stepWaitMs：面板自动复查一次、deck 工具走一步、宿主闸的一次求值），
// 而检查链的重试退避序列是「8 秒 → 30 秒 → 2 分钟 → 5 分钟」，第二档就是一步等待本身、后两档是它的倍数。
// 若在 config/intervals.yaml 里再抄一遍 30000，就出现第二份数字：调 stepWaitMs 时退避档位不会跟着走
// （违反 #1215 的单源头纪律）。所以数组项允许写引用，由构建期的生成器把它算成一个普通数字写进生成源码；
// 调用方拿到的仍是数字数组，写法与行为都不变。
//
// 支持两种写法（数组项只认这两种，其余一律报错并说清哪里不对）：
//   1. 正整数：8000 —— 独立的一档，与别的键无关；
//   2. 引用：stepWaitMs —— 等于被引用键的值；stepWaitMs * 4 —— 等于被引用键的值乘一个正整数倍。
//
// 有意不做的（不要让解析器去猜）：
//   · 只能引用标量键（timeouts / intervals / ttl 三组里那些单值键），不能引用数组键，也不能层层套引用；
//   · 只支持一次乘法，倍数只写正整数；不写加减、括号、变量以外的表达式；
//   · 被引用的键必须是 KEYS 表里登记过的键，写错名字会报错（多半是拼错，静默当成别的条件会让门禁失效）。
// 报错文案都带上「哪份文件、哪个数组、第几项」，调参的人照着一行就能改对。

/** 解析数组项引用时要问生成器的三件事：这一项写在哪、标量键的值是多少、某个键是不是数组键。 */
export interface TimeArrayDeps {
  /** 数组所在的那份 YAML（报错用），例如 config/intervals.yaml。 */
  file: string
  /** 数组的 YAML 键名（报错用），例如 chainBackoffMs。 */
  key: string
  /** 取某个标量键的值；没登记、或登记成数组键时返回 undefined。 */
  scalarOf: (key: string) => number | undefined
  /** 某个键在 KEYS 表里是不是数组键（用来把「引用了数组」单独说清楚）。 */
  isArrayKey: (key: string) => boolean
}

/** 一次乘法的写法：键名，或「键名 * 正整数」。键名与倍数之间允许空格。 */
const REF_RE = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*\*\s*([1-9][0-9]*))?$/

/**
 * 把一串引用写法解析成「引用的键 + 倍数」。不是引用的写法（数字、看不懂的文字）返回 null，
 * 由调用方决定是「这是独立的一档」还是「写错了」。
 */
export function parseTimeArrayRef(raw: string): { key: string; factor: number } | null {
  const matched = REF_RE.exec(raw.trim())
  if (!matched) return null
  return { key: matched[1], factor: matched[2] === undefined ? 1 : Number(matched[2]) }
}

/** 解析数组里的一项，得到它在生成源码里的数字。写错时抛错，错误文案直接指到文件、键名与第几项。 */
export function resolveTimeArrayItem(item: unknown, deps: TimeArrayDeps, index: number): number {
  const where = deps.file + ' 的 ' + deps.key + ' 第 ' + (index + 1) + ' 项'
  if (typeof item === 'number') {
    if (!Number.isInteger(item) || item <= 0) {
      throw new Error(where + ' 必须是正整数毫秒，读到的是 ' + JSON.stringify(item))
    }
    return item
  }
  if (typeof item !== 'string') {
    throw new Error(where + ' 只能写正整数或「键名 / 键名 * 倍数」的引用，读到的是 ' + JSON.stringify(item))
  }
  const ref = parseTimeArrayRef(item)
  if (ref === null) {
    throw new Error(where + ' 的写法看不懂：' + JSON.stringify(item)
      + '；这里只能写正整数，或「键名」/「键名 * 正整数倍数」（例如 stepWaitMs * 4）')
  }
  if (deps.isArrayKey(ref.key)) {
    throw new Error(where + ' 引用了数组键 ' + ref.key + '；数组项只能引用一个单值键，不能套一层数组')
  }
  const base = deps.scalarOf(ref.key)
  if (base === undefined) {
    throw new Error(where + ' 引用了不存在的键 ' + ref.key + '；只能引用 KEYS 表里已登记的单值键（见 scripts/generate-time-config.mts）')
  }
  const value = base * ref.factor
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(where + ' 引用 ' + ref.key + ' 算出来是 ' + value + '，不再是一个正整数毫秒；检查倍数是否写错')
  }
  return value
}

/** 解析一个时间参数数组：空数组报错（没有档位等于没有退避），逐项解析后返回普通数字数组。 */
export function resolveTimeArray(items: unknown, deps: TimeArrayDeps): number[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(deps.file + ' 的 ' + deps.key + ' 必须是非空数组，读到的是 ' + JSON.stringify(items))
  }
  return items.map((item: unknown, index: number) => resolveTimeArrayItem(item, deps, index))
}
