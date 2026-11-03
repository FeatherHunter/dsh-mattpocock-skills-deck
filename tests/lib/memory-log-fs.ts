// tests/lib/memory-log-fs.ts —— 门禁用的「内存日志文件服务」假实现（#1854 抽出来的共用件）。
//
// 为什么要有它：日志库要求注入的文件服务自带 appendText / rename / unlink / sizeOf 四格能力；
// 两个门禁（tests/verify-1854-log-fs-port.ts 与 tests/verify-log-switch-single-source.ts）都要
// 递一份「四格齐全、落盘现场可断言」的假服务。之前两处各写一份逐行相同的实现，加一格能力要改三处，
// 所以收到这里：所有方法都读写同一份「路径 → 文本」的 Map，改一处两边同时生效。
//
// 形状约定（与 dsh-log 的 LogFileService 对齐）：
// - resolve(路径) 回 { __target: 路径 }，其余方法按这个对象的 __target 取键；直接传字符串也认。
// - readText 读不到时抛「文件不存在」，与真实文件服务一致（日志库会 catch 后当成空文件）。
// - sizeOf 按 UTF-8 字节数算，读不到回 null（日志库据此判断「要不要回读核对」）。
// - snapshot() 与 texts 是同一份 Map，门禁据此断言「那一行真的写进去了」。
export type MemoryLogFsSnapshot = Map<string, string>

export type MemoryLogFs = {
  /** 文件服务的调用计数：writeText 与 appendText 各记一次，用来证明调用方递进来的服务真的被用了。 */
  calls: { write: number, append: number }
  /** 路径 → 文本；与 snapshot() 指向同一份 Map。 */
  texts: MemoryLogFsSnapshot
  /** 直接递给 dsh-log 的文件服务对象。 */
  fs: Record<string, unknown>
  /** 落盘现场快照（与 texts 同一份）。 */
  snapshot: () => MemoryLogFsSnapshot
}

// 把「调用方递进来的目标」还原成 Map 的键：日志库自己的目标是 { path }；本假服务 resolve 出来的是 { __target }；
// 直接传字符串的调用方也认。三种形状统一成一个键，断言才不依赖调用方用哪种。
function keyOf(target: unknown): string {
  if (target && typeof target === 'object' && typeof (target as { __target?: unknown }).__target === 'string') {
    return String((target as { __target: string }).__target)
  }
  return String(target)
}

export function makeMemoryLogFs(): MemoryLogFs {
  const texts: MemoryLogFsSnapshot = new Map()
  const calls = { write: 0, append: 0 }
  const fs: Record<string, unknown> = {
    async resolve(p: unknown) { return { __target: String(p) } },
    async readText(t: unknown) {
      const k = keyOf(t)
      if (!texts.has(k)) throw new Error('文件不存在：' + k)
      return texts.get(k)
    },
    async writeText(t: unknown, text: unknown) {
      calls.write += 1
      texts.set(keyOf(t), String(text))
    },
    async appendText(t: unknown, text: unknown) {
      calls.append += 1
      const k = keyOf(t)
      texts.set(k, (texts.has(k) ? texts.get(k) : '') + String(text))
    },
    async mkdir() {},
    async listDir() { return [] },
    async unlink(t: unknown) { texts.delete(keyOf(t)) },
    async rename(from: unknown, to: unknown) {
      const a = keyOf(from)
      const b = keyOf(to)
      if (!texts.has(a)) throw new Error('文件不存在：' + a)
      texts.set(b, texts.get(a) as string)
      texts.delete(a)
    },
    async sizeOf(t: unknown) {
      const k = keyOf(t)
      return texts.has(k) ? Buffer.byteLength(texts.get(k) as string, 'utf8') : null
    },
    snapshot() { return texts },
  }
  return { calls, texts, fs, snapshot() { return texts } }
}
