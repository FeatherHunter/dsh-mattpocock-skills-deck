import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function check(c,m){ if(!c){ console.error('FAIL',m); process.exitCode=1; } else console.log('PASS',m); }
const hostSrc = readFileSync(resolve(ROOT,'src/host/index.js'),'utf8');
const hostPkg = readFileSync(resolve(ROOT,'package/lib/index.js'),'utf8');
// isForce guard
check(hostSrc.includes('isForce = !!(args && args.force)'), 'src host 含 isForce');
check(hostSrc.includes('if (!isForce && cache.snapshot'), 'src host wf.snapshot 受 isForce 守卫');
check(hostPkg.includes('isForce'), 'pkg host 含 isForce');
// fetchIssues fallback 100
check(hostSrc.includes("tryList(100)"), 'src fetchIssues 使用 100 而非 500');
check(hostSrc.includes('unexpected eof'), 'src 对 unexpected EOF 容错');
check(hostSrc.includes('tryParseIndex'), 'src fetchIssueIndex 对部分成功解析');
check(hostSrc.includes("runGh(['issue', 'list', '--state', 'open'"), 'src 有 open 100 兜底');
console.log('done');
