// workspace-snapshot/node-ambient.d.ts —— 快照库这一层用到的那几样 Node 能力的最小声明。
//
// 为什么不挂 @types/node：本仓没装它，其余几份 tsconfig 的 types 都是空数组（口径见
// src/host/tsconfig.json 里那段说明）。但这一层和宿主一样要碰文件系统与 SQLite，运行时
// 一定在 Node 里；不给声明的话编译器会把 import 'node:sqlite' 判成「未安装类型包」。
//
// 这里只声明本模块实际用到的成员，签名来者不拒（any）——精度靠调用处自己的类型标注，
// 环境声明的职责只是让名字存在、调用形状对得上。新增一处 Node 能力就补一条，多一条都算约束。

declare module 'node:sqlite' {
  export type SQLInputValue = null | number | bigint | string | Uint8Array
  export interface StatementResultingChanges {
    changes: number | bigint
    lastInsertRowid: number | bigint
  }
  export class StatementSync {
    get(...params: SQLInputValue[]): any
    all(...params: SQLInputValue[]): any[]
    run(...params: SQLInputValue[]): StatementResultingChanges
  }
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean, timeout?: number })
    prepare(sql: string): StatementSync
    exec(sql: string): void
    close(): void
  }
}

// node:fs / node:path 不在这里声明：runtime/node-builtins.ts 改用 process.getBuiltinModule
// 取它们，避免契约入口被刷新房间导入时，把这两个模块的类型声明带进宿主的编译程序
// （那里有一批 @ts-expect-error 依赖「node:fs / node:path 不可见」才成立）。

// 生成默认租约标识要用进程号；宿主那几份文件也是按「可能不存在」的方式局部声明的。
declare const process: { pid: number }
