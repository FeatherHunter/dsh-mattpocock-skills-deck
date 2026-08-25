// verify-issue179-workspace-switch.js — #179 门禁：切工作区后右侧仓库名不残留 DSH 路径
// 用法: node tests/verify-issue179-workspace-switch.js
const fs = require('fs')
let failed=false
const check=(ok,msg)=>{ console.log((ok?'  PASS ':'  FAIL ')+msg); if(!ok) failed=true }
const srcDock = fs.readFileSync('src/client/panel/Dock.js','utf8')
const srcHost = fs.readFileSync('src/host/index.js','utf8')
const builtClient = fs.existsSync('client.js') ? fs.readFileSync('client.js','utf8') : null
const builtHost = fs.existsSync('host.js') ? fs.readFileSync('host.js','utf8') : null

console.log('P1: Dock 响应式同步')
check(/const hookCurrent/.test(srcDock), 'hookCurrent 存在')
check(/const summaryCwd/.test(srcDock) && /useSessions/.test(srcDock), 'summaryCwd 权威信号')
check(/React\.useEffect\(function \(\) \{[\s\S]*?apply\(summaryCwd/.test(srcDock), 'effect 含 apply(summaryCwd)')
check(/\}, \[sid, summaryCwd\]\)/.test(srcDock), 'deps 为 [sid, summaryCwd]（覆盖同 sid 切工作区）')
check(/getCwdSync\(sid\)/.test(srcDock), '含 getCwdSync 同步兜底')
check(/host\.call\('wf\.cwd'/.test(srcDock), '含 wf.cwd 异步兜底')
check(/\/\/ #179/.test(srcDock), '#179 注释标记')

console.log('P2: 污染自愈')
check(/isPolluted/.test(srcDock), 'isPolluted 存在')
check(/hydrateFromCache\(s\)/.test(srcDock), 'hydrateFromCache 存在')
check(/repoRoot/.test(srcDock) && /cwdBasename/.test(srcDock) || /repository/.test(srcDock), '污染判断含 repoRoot/repository')

console.log('P3: host 空 cwd 防御')
check(srcHost.includes("wf.snapshot") && srcHost.includes("缺少 cwd"), 'host wf.snapshot 空 cwd 防御')
check(srcHost.includes("wf.refresh") && srcHost.includes("缺少 cwd"), 'host wf.refresh 空 cwd 防御')
check(srcHost.includes("bad-cwd"), 'bad-cwd 语义')
check(!/const cwd = \(args && args\.cwd\) \|\| DEFAULT_CWD/.test(srcHost) || /if \(!cwd/.test(srcHost), '不再无条件兜 DEFAULT_CWD')

console.log('P4: 构建产物')
if(builtClient){ check(builtClient.includes('summaryCwd') || builtClient.includes('useSessions'), 'client.js 含 summaryCwd') } else { console.log('  SKIP client.js 未生成') }
if(builtHost){ check(builtHost.includes('缺少 cwd') || builtHost.includes('bad-cwd'), 'host.js 含空 cwd 防御') } else { console.log('  SKIP host.js 未生成') }

if(failed){ console.log('\nFAIL'); process.exit(1) }
console.log('\nAll PASS — #179 门禁通过')
