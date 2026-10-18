// verify-849-fs-absence.ts —— 「文件不存在」判据的三处统一（#849）与它的反证。
// 语义：明确没有（ENOENT / ENOTDIR / FS_NOT_FOUND）→ 走缺失分支；其它错误 → 仍如实报「读不到」。
// 用法：node --import ./scripts/ts-hook.mts tests/verify-849-fs-absence.ts
// 本文件是 CommonJS：走 pathToFileURL + 动态 import 取产品源码（fsAbsence.js 今天还是手写 JS，
// 所以那一行的 .js 后缀必须原样保留，也正是它撑起归属表里唯一的那条 guard）；只加类型标注，判据不动。
const path = require('path'); const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
let failed = false; let total = 0;
const check = (ok: boolean, msg: string): void => { total += 1; if (!ok) failed = true; console.log((ok ? '  PASS ' : '  FAIL ') + msg) };
(async () => {
  const abs = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'fsAbsence.js')).href);
  console.log('缺文件判据：ENOENT / ENOTDIR / FS_NOT_FOUND 算「没有」；其它错误算「读不到」')
  check(abs.isAbsenceError({ code: 'ENOENT' }) === true && abs.isAbsenceError({ code: 'ENOTDIR' }) === true && abs.isAbsenceError({ code: 'FS_NOT_FOUND' }) === true, '① 明确没有：三种 code 都判「缺失」')
  check(abs.isAbsenceError({ code: 'EACCES' }) === false && abs.isAbsenceError(new Error('读不了')) === false && abs.isAbsenceError(null) === false, '② 真答不出来：其它错误/无 code 都不算「缺失」，仍如实报读不到')
  console.log(failed ? '\n存在失败 — verify-849-fs-absence 未通过' : '\n全部通过 — 缺文件判据统一门禁生效（' + total + ' 项断言）');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) });
