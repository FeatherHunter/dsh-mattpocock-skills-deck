/**
 * packages/dsh-log/src/node-ambient.d.ts —— Node 程序入口（node.ts）实际用到的 Node 内建能力最小形状。
 *
 * 为什么不用 @types/node：本包至今不引入任何 Node 专属类型（tsconfig 的 types 为空），
 * 引擎两侧要保持「宿主与浏览器闭包都能跑」；加 @types/node 等于给每个消费者带一份类型依赖。
 * 所以这里只声明 node.ts 真正用到的几个函数形状，类型检查只认这里写的形状。
 * 新增 Node 能力先补这里，再在实现里用；其余源文件不许引用本文件声明的模块。
 */

declare module 'node:fs/promises' {
  export function mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<string | undefined>
  export function readFile(path: string, encoding: string): Promise<string>
  export function readdir(path: string): Promise<string[]>
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  export function unlink(path: string): Promise<void>
  export function writeFile(path: string, data: string, encoding: string): Promise<void>
}

declare module 'node:path' {
  export function join(...parts: string[]): string
  export function dirname(path: string): string
}

// 计时器用运行环境自带的全局函数（与包内 store.ts 同口径，不引入 Node 专属类型）。
declare function setTimeout(fn: (...args: unknown[]) => void, ms: number): unknown
