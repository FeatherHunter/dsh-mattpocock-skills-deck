// contract/index.ts —— 快照库唯一对外入口。
//
// 上层只 import 这一个文件：类型从 types.ts 出，开库函数从 runtime/open.ts 出。
// 这样以后换内部实现（例如把 SQLite 换成别的存储）不用改调用方。
export * from './types.js'
export { openWorkspaceSnapshot } from '../runtime/open.js'
