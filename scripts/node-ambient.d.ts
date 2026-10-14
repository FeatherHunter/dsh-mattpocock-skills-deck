// scripts/node-ambient.d.ts —— scripts/ 下脚本用到的那几样 Node 能力的最小声明（#1052 加）。
//
// 为什么不挂 @types/node：本仓没装它，其余几份 tsconfig 的 types 也都是空数组（口径见 src/host/tsconfig.json
// 里那段说明）。为一份日志阅读器引一整包 Node 类型，会顺手把 console、process、Buffer 这些全局全部打开，
// 等于把「这里到底用了什么」藏起来。所以按本文件实际用到的部分逐条声明：多写一条就多一条约束，
// 写少一条下面的代码就读不了。
//
// 运行时这些当然都在（脚本用 Node 跑）；类型只是让「读错方法名、参数给错」当场看得见。

declare const process: {
  /** 命令行参数，前两项是 node 与脚本路径。 */
  argv: string[]
  /** 结束进程；本脚本用退出码表达「读出来了 / 没读出来」。 */
  exit(code?: number): never
}

declare const console: {
  log(...args: unknown[]): void
}

declare module 'node:fs' {
  /** 文件状态，本脚本只问「这是不是一个文件」。 */
  interface Stats {
    isFile(): boolean
  }
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function readdirSync(path: string): string[]
  export function statSync(path: string): Stats
}

declare module 'node:path' {
  export function join(...parts: string[]): string
}
