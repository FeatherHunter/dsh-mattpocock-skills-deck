// tests/lib/json-lossless.ts —— 「无损 JSON」的单一判据（#1559）。
//
// 为什么需要它：DSH 宿主收工具返回值时要求它是一个无损 JSON 值（宿主侧是 snapshotToolValue →
// snapshotJsonValue → walkJsonValue）。本仓的 deck 工具回执是人手拼的对象；只要有一个 undefined、
// Date、BigInt、循环引用、不可枚举自有属性或 symbol 键，宿主就会把整笔调用拒收
// （tool "xxx" returned invalid output: value is not lossless JSON），连降级都没有。
//
// 这份文件把宿主那条规则复刻成门禁能用的判据（只住 tests/，不进运行时；运行时仍由宿主严格校验，
// 插件不在出口再抄一份会漂移的规则）：
//   · 允许：null / 布尔 / 字符串 / 有限数（不含 -0）/ 纯数组 / 纯对象（原型是 Object.prototype 或 null）。
//   · 纯对象的自有键必须全是可枚举字符串键（不可枚举属性、symbol 键都被宿主拒收）。
//   · 数组不许有空洞、不许带额外自有属性（宿主按 Reflect.ownKeys 的数量判）。
//   · 不许循环引用；undefined、函数、symbol、BigInt 值本身都不是 JSON 值。
//
// 用法：
//   import { losslessProblems } from './lib/json-lossless.js'
//   const problems = losslessProblems(toolResult)   // 空数组 = 能过宿主那道检查
//
// 判据出处：本机 DSH 宿主包（app.asar，2026-10-26 现场版本）的 walkJsonValue /
// hasPlainObjectPrototype / hasPlainArrayPrototype / enumerableStringKeys。宿主升级时若规则变了，
// 这里要跟着复核 —— 门禁与宿主对不上，就会出现「门禁绿、宿主红」或反过来。

/** 一处「不是无损 JSON」的具体位置与原因。path 从 value 起算，例如 value.data.fallback。 */
export interface LosslessProblem {
  path: string
  reason: string
}

/** 一个值能不能无损地成为 JSON；返回空数组表示能。 */
export function losslessProblems(value: unknown): LosslessProblem[] {
  const out: LosslessProblem[] = []
  const ancestors = new Set<object>()

  const add = (path: string, reason: string): void => { out.push({ path, reason }) }

  const visit = (current: unknown, path: string): void => {
    if (current === null) return
    if (typeof current === 'boolean' || typeof current === 'string') return
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) add(path, '不是有限数（' + String(current) + '）')
      else if (Object.is(current, -0)) add(path, '是 -0（宿主按有损值拒收）')
      return
    }
    if (typeof current === 'undefined') { add(path, '是 undefined（JSON 里没有这个值）'); return }
    if (typeof current !== 'object') { add(path, '是 ' + typeof current + '，不是 JSON 值'); return }
    if (ancestors.has(current)) { add(path, '是循环引用'); return }

    ancestors.add(current)
    try {
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype) {
          add(path, '不是普通数组（原型不是 Array.prototype）')
          return
        }
        const ownKeys = Reflect.ownKeys(current)
        if (ownKeys.length !== current.length + 1) add(path, '数组有空洞或额外自有属性（宿主会拒收）')
        for (let i = 0; i < current.length; i++) {
          if (!Object.prototype.hasOwnProperty.call(current, i)) continue
          visit(current[i], path + '[' + i + ']')
        }
        return
      }

      const prototype = Object.getPrototypeOf(current)
      if (prototype !== null && prototype !== Object.prototype) {
        add(path, '不是普通对象（原型不是 Object.prototype 或 null）')
        return
      }
      for (const key of Reflect.ownKeys(current)) {
        if (typeof key !== 'string') { add(path, '带 symbol 自有键'); continue }
        if (!Object.prototype.propertyIsEnumerable.call(current, key)) {
          add(path + '.' + key, '是不可枚举的自有属性（JSON 序列化会丢掉它）')
          continue
        }
        let child: unknown
        try { child = (current as Record<string, unknown>)[key] } catch (e) {
          add(path + '.' + key, '取值时抛错：' + String((e as { message?: unknown } | null)?.message || e))
          continue
        }
        visit(child, path + '.' + key)
      }
    } finally {
      ancestors.delete(current)
    }
  }

  visit(value, 'value')
  return out
}

/** 把问题压成一行人话，给门禁的失败信息用。 */
export function describeLosslessProblems(problems: LosslessProblem[], cap = 5): string {
  const shown = problems.slice(0, cap).map((p) => p.path + ' ' + p.reason)
  return shown.join('；') + (problems.length > cap ? '；另有 ' + (problems.length - cap) + ' 处' : '')
}
