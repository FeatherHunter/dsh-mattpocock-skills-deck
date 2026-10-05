#!/usr/bin/env node
// 回归门禁 #857：详情页评论成功被判成失败
// 背景：通用进程执行成功时没带退出码数字，转交层原样转发空值，命令执行器按拿不到整数退出码就判失败，远端写成了面板却报失败。
// 运行：node --no-warnings tests/verify-857-comment-false-failure.js
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL ' + msg); failed++; } else console.log('PASS ' + msg); }
// 1) 源头：成功必须带整数退出码 0
const repoKeys = readFileSync(resolve(ROOT, 'src/host/repoKeys.js'), 'utf8');
check(repoKeys.includes("return { ok: true, text: out.text || '', code: 0 }"), 'execProc 成功带 code: 0');
// 2) 三处转交：成功时空值兜底成 0，不再转发 undefined
for (const [f, via] of [['src/host/commentThreads.js','comment-write'],['src/host/snapshotBuild.js','viewer-lookup'],['src/host/snapshotBuild.js','snapshot-select']]) {
  const s = readFileSync(resolve(ROOT, f), 'utf8');
  check(s.includes(via) && s.includes('Number.isInteger(r.code) ? r.code : 0'), f + ' 的 ' + via + ' 空退出码兜底成 0');
}
// 3) 行为：用修后的形状走一次判定，成功不再判失败
function ghJudge(result) { const raw = result && result.code; const code = Number.isInteger(raw) ? raw : -1; return code === 0; }
function fixedWrapper(r) { return { stdout: r.text, text: r.text, ok: true, code: (Number.isInteger(r.code) ? r.code : 0) }; }
const fixed = fixedWrapper({ ok: true, text: '{"id":1}' , code: 0});
check(ghJudge(fixed) === true, '修后成功走成功分支');
const legacy = fixedWrapper({ ok: true, text: '{"id":1}' });
check(ghJudge(legacy) === true, '即使上游缺码，兜底后成功仍走成功分支');
// 4) 失败仍是失败：非零码不洗成成功
check(ghJudge({ code: 1, stdout: 'err' }) === false, '非零退出码仍判失败');
console.log(failed ? ('\n857 回归失败 ' + failed + ' 项') : '\n857 回归全部通过');
process.exit(failed ? 1 : 0);
