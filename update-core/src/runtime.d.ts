/**
 * update-core/src/runtime.d.ts — 核心允许触碰的通用运行时形状
 *
 * 只有 Node 宿主与浏览器闭包两边都有的能力才允许出现在这里；
 * Node 专属（如 fs、子进程）与浏览器专属一律不许加，加了就是破保证。
 * 类型只用标准写法，不依赖特殊编译选项。
 */

declare class TextEncoder {
  encode(input?: string): Uint8Array
}

declare class URL {
  constructor(url: string)
  readonly origin: string
  readonly username: string
  readonly password: string
  readonly search: string
  readonly hash: string
  readonly pathname: string
  readonly href: string
}
