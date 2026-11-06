// runtime/node-builtins.ts —— 快照库用到的文件系统与路径能力，统一从 process.getBuiltinModule 取。
//
// 为什么不直接写 import 'node:fs' / 'node:path'：契约入口会被刷新房间按字面量动态导入，
// 编译器顺着这条边把本树的 Node 环境声明带进 refresh / host 的编译程序；而宿主里大量
// 「本域不挂 Node 类型包」的 node:fs / node:path 导入靠 @ts-expect-error 过关，声明一旦
// 可见，那些忽略行就会变成「未使用」并判红。改从运行时取内置模块后，环境声明里只剩
// node:sqlite（宿主没有同名的忽略行），这个副作用就消失了。
//
// process.getBuiltinModule 从 Node 22.3 起可用，本仓的 Node 下限（22.22 / 24.15）覆盖它。
// 这一层只在 Node 宿主里跑；取不到就直接在装载时抛错，不会把问题拖到第一次写库。
declare const process: { getBuiltinModule(id: string): any }

const nodeFs: any = process.getBuiltinModule('node:fs')
const nodePath: any = process.getBuiltinModule('node:path')

export function existsSync(path: string): boolean {
  return nodeFs.existsSync(path)
}

/** 读文件元信息（库占用读数要 size 这一格；文件不存在时调用方自己先问 existsSync）。 */
export function statSync(path: string): { size: number } {
  return nodeFs.statSync(path)
}

/**
 * 读文件系统的类型编号（statfs 的 f_type）。storage-kind.ts 靠它认 NFS / SMB / FUSE 这些网络挂载：
 * 路径本身看不出挂载方式，只有文件系统类型能回答。
 */
export function statfsTypeOf(path: string): number {
  const stats = nodeFs.statfsSync(path)
  return Number(stats && stats.type)
}

export function mkdirSync(path: string, options?: { recursive?: boolean }): void {
  nodeFs.mkdirSync(path, options)
}

/** 读一个小文本文件（重建锁的 owner.json）；调用方负责把「读不到」当成正常的过期信号。 */
export function readFileSync(path: string, encoding: 'utf8'): string {
  return nodeFs.readFileSync(path, encoding)
}

/** 写一个小文本文件（重建锁的 owner.json）。固定 UTF-8：锁文件里只有 ASCII 标识与数字。 */
export function writeFileSync(path: string, data: string): void {
  nodeFs.writeFileSync(path, data, 'utf8')
}

export function renameSync(oldPath: string, newPath: string): void {
  nodeFs.renameSync(oldPath, newPath)
}

export function rmSync(path: string, options?: { force?: boolean, recursive?: boolean }): void {
  nodeFs.rmSync(path, options)
}

export function dirname(path: string): string {
  return nodePath.dirname(path)
}

export function resolve(...parts: string[]): string {
  return nodePath.resolve(...parts)
}

export function join(...parts: string[]): string {
  return nodePath.join(...parts)
}
