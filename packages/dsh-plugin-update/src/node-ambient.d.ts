/**
 * packages/dsh-plugin-update/src/node-ambient.d.ts —— 本包触碰的 Node 内建能力最小形状。
 *
 * 为什么不用 @types/node：包定死零运行时依赖（规格 #581 第 5 条底座），加 @types/node 等于
 * 给每个消费者带一份类型依赖；本文件只声明本包实际用到的几个函数形状，调用处照旧传真值，
 * 类型检查只认这里写的形状。新增 Node 能力先补这里，再在实现里用。
 */

declare module 'node:crypto' {
  export function createHash(algorithm: string): {
    update(data: string): { digest(encoding: string): string }
  }
  export function randomUUID(): string
}

declare module 'node:fs/promises' {
  export function mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<string | undefined>
  export function open(
    path: string,
    flags: string,
    mode?: number
  ): Promise<{ writeFile(data: string): Promise<void>; close(): Promise<void> }>
  export function readFile(path: string, encoding?: string): Promise<string>
  export function rename(oldPath: string, newPath: string): Promise<void>
  export function realpath(path: string): Promise<string>
  export function stat(path: string): Promise<{ size: number; isFile(): boolean }>
  export function unlink(path: string): Promise<void>
  export function writeFile(path: string, data: string, options?: { mode?: number; flag?: string }): Promise<void>
}

declare module 'node:os' {
  export function homedir(): string
}

declare module 'node:path' {
  export function join(...parts: string[]): string
  export function resolve(...parts: string[]): string
  export function dirname(path: string): string
  export function basename(path: string): string
  export function relative(from: string, to: string): string
  export function isAbsolute(path: string): boolean
  export const sep: string
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string
}

// 模块地址（读取器与宿主入口用 import.meta.url 反查已装位置，只读地址，不碰模块状态）。
interface ImportMeta {
  url: string
}

// 计时器回退只用运行环境自带的全局函数，不引入任何 Node 或浏览器专属类型（与 dsh-log 同口径）。
declare function setTimeout(fn: () => void, ms: number): unknown
declare function clearTimeout(handle: unknown): void

// 二进制长度计算（使用范围名合法性判定用，只读字节长度，不碰缓冲内容）。
declare const Buffer: {
  byteLength(input: string): number
}

// 宿主进程全局（本包只读环境变量、运行时路径、进程号、Node 版本号，不写进程状态）。
declare const process: {
  env: Record<string, string | undefined>
  execPath: string
  execArgv: string[]
  argv: string[]
  pid: number
  versions: { node: string }
}
