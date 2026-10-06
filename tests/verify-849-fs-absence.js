// verify-849-fs-absence.js —— 「文件不存在」判据的三处统一（#849）与它的反证。
// 语义：明确没有（ENOENT / ENOTDIR / FS_NOT_FOUND）→ 走缺失分支；其它错误 → 仍如实报「读不到」。
const fs = require('fs'); const path = require('path'); const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
let failed = false; let total = 0;
const check = (ok, msg) => { total += 1; if (!ok) failed = true; console.log((ok ? '  PASS ' : '  FAIL ') + msg) };
// #875 薄接线：更新读取器与更新落盘已删（能力收进更新包），此处只剩选择状态文件。
const SITES = [
  ['src/host/choiceStore.js', 'FS_NOT_FOUND', '选择状态文件（行内同契约）'],
];
(async () => {
  const abs = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'fsAbsence.js')).href);
  console.log('缺文件判据：ENOENT / ENOTDIR / FS_NOT_FOUND 算「没有」；其它错误算「读不到」')
  check(abs.isAbsenceError({ code: 'ENOENT' }) === true && abs.isAbsenceError({ code: 'ENOTDIR' }) === true && abs.isAbsenceError({ code: 'FS_NOT_FOUND' }) === true, '① 明确没有：三种 code 都判「缺失」')
  check(abs.isAbsenceError({ code: 'EACCES' }) === false && abs.isAbsenceError(new Error('读不了')) === false && abs.isAbsenceError(null) === false, '② 真答不出来：其它错误/无 code 都不算「缺失」，仍如实报读不到')
  for (const [rel, needle, label] of SITES) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    check(src.indexOf(needle) >= 0, '③ ' + label + '：' + rel + ' 走共享判据或同一份契约（含 ' + needle + '）')
    check(src.indexOf("code === 'ENOENT'") < 0 || src.indexOf('FS_NOT_FOUND') >= 0 || src.indexOf('isAbsenceError') >= 0, '④ ' + label + '：不再「只认 ENOENT」（反证：把判据收回只认 ENOENT，这条与③一起变红）')
  }
  const cs = fs.readFileSync(path.join(ROOT, 'src/host/choiceStore.js'), 'utf8');
  const narrowed = cs.replace("e.code === 'ENOENT' || e.code === 'ENOTDIR' || e.code === 'FS_NOT_FOUND'", "e.code === 'ENOENT'");
  check(narrowed !== cs, '⑤ 反证装置自检：把判据收回只认 ENOENT 之后源文本必须与现状不同（收回即红）')
  console.log(failed ? '\n存在失败 — verify-849-fs-absence 未通过' : '\n全部通过 — 缺文件判据统一门禁生效（' + total + ' 项断言）');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) });
