/**
 * verify-414-single-card — 回归：single 卡片可点切换 public/private
 * 断言：弹窗视图文件 slotRenderer-modal-view.js 的 single 分支含 onClick/onKeyDown/role=radio/aria-checked（原 slotRenderer.js 已拆为三文件，此处读三文件拼合断言），
 * 且 isWizard 场景同步 valuesByStep。并验证 client 产物已同步。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function check(cond, msg){ if(!cond){ console.error('FAIL', msg); process.exitCode=1; } else console.log('PASS', msg); }
const SR_FILES = ['src/client/kernel/slotRenderer-queue.js', 'src/client/kernel/slotRenderer-repo-sync.js', 'src/client/kernel/slotRenderer-modal-view.js']; // 原 slotRenderer.js 已消除，读三文件拼合断言（single 分支在弹窗视图文件）
const src = SR_FILES.map((f) => readFileSync(resolve(ROOT, f), 'utf8')).join('\n');
const pkg = readFileSync(resolve(ROOT, 'package/lib/client.js'), 'utf8');
check(src.includes("role: 'radio'") || src.includes('role: "radio"') || src.includes("role: 'radio'"), 'src single 含 role radio');
check(src.includes('onClick') && src.includes("vals[f.name]"), 'src single 含 onClick 更新 vals');
check(src.includes('onKeyDown'), 'src single 含 onKeyDown 键盘可达');
check(src.includes('aria-checked'), 'src single 含 aria-checked');
check(src.includes('valuesByStep[stepIndex]'), 'src single 同步 valuesByStep（向导按步隔离）');
check(src.includes('m.pending ? -1 : 0'), 'src single pending 时 tabIndex -1');
check(pkg.includes("role: 'radio'"), 'package/lib/client.js 已同步 single 修复');
console.log('done');
