/**
 * 贴合探针的环境垫片（#1026）：只给类型检查看的空气，不进任何构建与产物。
 *
 * 为什么需要它：仓库按设计不引 `@types/node`（契约配置 `types: []`，只要语言自带库），
 * 而房间的旧语言文件里有三处 `import ... from 'node:path'` 与 `typeof process`。
 * 探针要编译后端入口，这两个名字在类型层面必须有出处——这个文件就是那个出处：
 * `node:path` 按 `any` 给（房间只拿它拼路径，探针不断言路径拼得对不对），
 * `process` 按 `any` 给。
 *
 * 它只垫环境，不垫任何后端形状：后端少一个成员、写错一个形状，探针照样红
 * （契约门禁里的反面证明每次运行都验这一点，见 `tests/verify-contract-types.js`）。
 *
 * 本文件是声明文件（`.d.ts`）：覆盖对账（`scripts/typecheck.mts`）明文豁免声明文件，
 * 它不属于任何域，也不需要被任何配置圈到。
 */
declare module 'node:path' {
  const fallback: any
  export default fallback
}
declare const process: any
