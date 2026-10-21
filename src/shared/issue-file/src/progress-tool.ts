/**
 * src/shared/issue-file/src/progress-tool.ts —— deck_issue_patch 收进度参数用的纯函数（#1090）
 *
 * 为什么单独一份：工具层文件有 350 有效行的上限（tests/verify-file-granularity.ts 判），而「收参数、
 * 盖时间戳」是纯逻辑：不碰后端、不碰 ctx、不读文件。放这里之后，src/deck/tools/issue-patch.ts
 * 只留读回与记账的骨架。
 *
 * 约束：零 import（shared 层同层互引被规则禁止）。这里不引进度区的类型，只用同形的本地接口。
 */

/** 一条进度记录（与 src/shared/issue-file/src/progress.ts 的 ProgressEntry 同形，故意不 import）。 */
export interface ProgressEntryLike {
  percent: number
  note: string
  updatedAt: string | null
}

/** 把毫秒盖成 ISO 8601（带本机时区偏移），例如 2026-10-21T20:37:19+08:00。 */
export function stampNow(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => (n < 10 ? '0' + n : String(n))
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return String(d.getFullYear()) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
    + sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60)
}

/**
 * 收口 progress 参数：只认 {percent: 0..100 整数, note: 非空一行}。
 *
 * 为什么不再收自由文字（#1090）：以前传字符串时，工具把它原样塞进区里，读的人按
 * 「- 进度：N%（时间）：说明」的写法解析——写进去的是「90%」，读回来对不上，成了 null。
 * 现在写读共用同一套写法，参数也按同一套收；收不成时回一句能照着改的话，整笔不动。
 */
export function progressEntryFromArg(arg: unknown): { entry: ProgressEntryLike | null; problem: string } {
  if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) {
    return { entry: null, problem: 'progress 要写成 {percent, note} 对象（#1090 起不再收一段自由文字）：percent 是 0..100 的整数，note 是必填的一句话说明。' }
  }
  const obj = arg as Record<string, unknown>
  const percent = obj.percent
  const note = obj.note
  if (typeof percent !== 'number' || !isFinite(percent) || Math.floor(percent) !== percent || percent < 0 || percent > 100) {
    return { entry: null, problem: 'progress.percent 要是 0..100 的整数，这次收到的是 ' + String(percent) + '。' }
  }
  if (typeof note !== 'string' || note.trim() === '') {
    return { entry: null, problem: 'progress.note 必填：用一句话写清做到哪一步了，不能为空。' }
  }
  if (note.indexOf('\n') >= 0 || note.indexOf('\r') >= 0) {
    return { entry: null, problem: 'progress.note 只能是一行：进度区一条一行，带换行会把区里的写法打乱。' }
  }
  return { entry: { percent: percent, note: note.trim(), updatedAt: null }, problem: '' }
}
