// scripts/node-ambient.d.ts —— scripts/ 下脚本用到的那几样 Node 能力的最小声明（#1052 加，#1252 长到 36 份）。
//
// 为什么不挂 @types/node：本仓没装它，其余几份 tsconfig 的 types 也都是空数组（口径见 src/host/tsconfig.json
// 里那段说明）。为一份日志阅读器引一整包 Node 类型，会顺手把 console、process、Buffer 这些全局全部打开，
// 等于把「这里到底用了什么」藏起来。所以按本目录实际用到的部分逐条声明：多写一条就多一条约束，
// 写少一条下面的代码就读不了。
//
// #1252 补的口径（36 份脚本一起登记，错误从 783 条开始收敛，逐条对过）：
//   1) 签名一律来者不拒（(...args: any[]) => any）：这些是运维小脚本，真正的精度在它们自己身上的类型标注里，
//      环境声明只负责「名字存在、调得通」，不复刻 Node 文档里的重载表。复刻重载等于把 @types/node 手抄一遍，
//      抄错一条就是一条假门禁。
//   2) fs / path 额外给一个 export default（any）：generate-demo-fixtures.ts 等沿用 `import fs from 'node:fs'`
//      的 CJS 式默认导入，运行时是 Node 的互操作给的，声明里补上才对得上。
//   3) document / localStorage / location / host / getComputedStyle / HTMLElement：ui-* 那几份脚本把
//      「要在浏览器里跑的片段」写在 page.evaluate 回调里，回调在浏览器执行，但类型检查在 Node 语境下跑，
//      没有 DOM 库。声明只覆盖脚本实际摸到的那几个成员（下面 document/localStorage 的形状就是逐个 grep 出来的），
//      多一个都不加；host 是页面里由宿主挂上的全局对象。
//   4) ImportMeta.url 与 String.replaceAll：运行时 Node 22 都有，lib 保守留在 ES2020，所以单点声明。
//   5) declare module 块里的每个成员都必须写 export：环境模块里不写 export 等于没导出，
//      命名导入会报 TS2614（#1252 第二轮 100 多条全是这个原因）。
//
// 运行时这些当然都在（脚本用 Node 跑）；类型只是让「读错方法名、参数给错」当场看得见。

interface RequireFn {
  (id: string): any
  /** 入口模块（asar-extract.ts、measure-967-outbound.ts 拿它判断「被直接跑还是被引用」）。 */
  main: any
  /** createRequire 拿到的那把尺也能解析路径（build.mts 等拿它把相对说明符解成绝对路径）。 */
  resolve(id: string): string
  cache: any
}
declare const require: RequireFn
declare const module: { exports: any }
declare const exports: any
declare const __dirname: string
declare const __filename: string

declare const process: {
  /** 命令行参数，前两项是 node 与脚本路径。 */
  argv: string[]
  /** 结束进程；脚本用退出码表达「读出来了 / 没读出来」。 */
  exit(code?: number): never
  /** 环境变量。值可能是 undefined（没设这个变量）：取用方自己判空。 */
  env: Record<string, string | undefined>
  /** 当前工作目录。 */
  cwd(): string
  /** 当前进程号。 */
  pid: number
  /** Node 版本串（如 'v24.19.0'）。 */
  version: string
  /** 当前 node 可执行文件的绝对路径。 */
  execPath: string
  stdout: { write(chunk: string): void }
  stderr: { write(chunk: string): void }
  /** 信号与退出事件的订阅（如 'SIGINT'、'exit'）。 */
  on(event: string, listener: (...args: any[]) => void): void
}

declare const console: {
  log(...args: unknown[]): void
  error(...args: unknown[]): void
  warn(...args: unknown[]): void
}

declare function setTimeout(fn: (...args: any[]) => void, ms?: number, ...args: any[]): any
declare function clearTimeout(handle: any): void
declare function setInterval(fn: (...args: any[]) => void, ms?: number, ...args: any[]): any
declare function clearInterval(handle: any): void

declare const Buffer: {
  from(data: any, encoding?: string): any
  concat(list: any[], totalLength?: number): any
  isBuffer(x: unknown): boolean
  byteLength(s: string, encoding?: string): number
  alloc(size: number, fill?: any): any
}
declare type Buffer = any

interface ImportMeta {
  /** 当前模块文件的 file:// 地址（脚本拿它推导仓库根目录）。 */
  url: string
}

interface String {
  /** ES2021 起运行时自带；lib 保守留在 ES2020，所以单点声明。 */
  replaceAll(search: string, replacement: string): string
}

/** 在浏览器里执行的片段（page.evaluate 回调）：形状由浏览器决定，本仓不断言。 */
declare const document: {
  querySelector(sel: string): any
  querySelectorAll<T = any>(sel: string): T[]
  body: any
  head: any
  createElement(...args: any[]): any
}
declare const localStorage: {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
/** 页面里的地址栏对象（只在 evaluate 回调里读 href）。 */
declare const location: any
/** 页面里的宿主对象（ui-verify-registry 用它调 wf.registry，Node 侧不存在）。 */
declare const host: any
declare function getComputedStyle(...args: any[]): any
declare type HTMLElement = any
declare type HTMLDetailsElement = any
declare const AbortSignal: any
declare type AbortSignal = any

declare module 'node:fs' {
  /** 文件状态，脚本只问「是不是文件 / 是不是目录 / 有多新」。 */
  export interface Stats {
    isFile(): boolean
    isDirectory(): boolean
    /** 修改时间毫秒戳（产物新鲜度门禁拿它比先后）。 */
    mtimeMs: number
    size: number
  }
  /** readdirSync 开 { withFileTypes: true } 时拿到的条目。 */
  export interface Dirent {
    name: string
    isFile(): boolean
    isDirectory(): boolean
  }
  export function readFileSync(path: any, ...args: any[]): any
  export function writeFileSync(file: any, data: any, ...args: any[]): void
  export function appendFileSync(file: any, data: any, ...args: any[]): void
  export function mkdirSync(path: any, ...args: any[]): any
  export function existsSync(path: any): boolean
  export function rmSync(path: any, ...args: any[]): void
  export function cpSync(src: any, dest: any, ...args: any[]): void
  export function utimesSync(path: any, ...args: any[]): void
  export function mkdtempSync(prefix: string, ...args: any[]): string
  export function readdirSync(path: any, ...args: any[]): any
  export function statSync(path: any, ...args: any[]): any
  export function openSync(path: any, ...args: any[]): any
  export function readSync(fd: any, ...args: any[]): any
  export function writeSync(fd: any, ...args: any[]): any
  export function closeSync(fd: any): void
  const _default: any
  export default _default
}

/** 裸 'fs'（双引号写法，见 generate-star-history-svg.mts、update-star-history.mts）：与 node:fs 同一套。 */
declare module 'fs' {
  export * from 'node:fs'
  const _default: any
  export default _default
}

declare module 'node:path' {
  export function join(...parts: any[]): string
  export function resolve(...parts: any[]): string
  export function dirname(p: any): string
  export function basename(p: any, ...args: any[]): string
  export function extname(p: any): string
  export function relative(from: any, to: any): string
  export function isAbsolute(p: any): boolean
  /** 跨平台拼 POSIX 风格路径（gate-map 拿它归一化斜杠）。 */
  export const posix: any
  /** 路径分隔符（'\\' / '/'）。 */
  export const sep: string
  const _default: any
  export default _default
}

declare module 'node:url' {
  export function fileURLToPath(url: any): string
  export function pathToFileURL(path: string): any
}

/** 裸 'url'（双引号写法）：与 node:url 同一套。 */
declare module 'url' {
  export * from 'node:url'
}

declare module 'node:module' {
  export function createRequire(filename: string): RequireFn
  /** 同步 ESM 钩子装载器（ts-hook.mts 用它同时管住 import 与 require）。 */
  export function registerHooks(...args: any[]): any
}

declare module 'node:child_process' {
  export function spawnSync(...args: any[]): any
  export function execSync(...args: any[]): any
  export function spawn(...args: any[]): any
  export function execFileSync(...args: any[]): any
}

declare module 'node:os' {
  export function cpus(): any[]
  export function tmpdir(): string
  export function platform(): string
  export function homedir(): string
}

declare module 'node:crypto' {
  export function createHash(algorithm: string): any
}

declare module 'node:vm' {
  export class Script {
    constructor(code: string, ...args: any[])
    runInNewContext(...args: any[]): any
  }
}
