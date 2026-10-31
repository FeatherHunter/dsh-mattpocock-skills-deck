// 门禁归属: src/host/versionControlWrite.ts
// verify-1586-write-registration.ts —— 写命令七个登记点门禁（规格 #1586 之 T06 #1741）。
//
// 守的东西：一条写命令要真的能用，光有处理逻辑不够，还必须在**七个地方**同时登记上——
//   ① 操作枚举（共享核心的 WriteOp / Operation 联合类型）
//   ② 判定分支（rules.judge 的 switch，漏了会永远落到 unknown-operation）
//   ③ 检查白名单（预检只放行登记过的动作）
//   ④ 写处理函数（执行层真的有这个函数，并且被装配返回出去）
//   ⑤ 宿主注册（harness.handle 的 'wf.gitXxx' 电话名）
//   ⑥ 电话表（界面层 op 名 → 电话名的对照表）
//   ⑦ 超时配置（中央 YAML 里这条命令的单条超时，以及执行层真的引用了它）
// 漏掉任何一处的症状都不一样（点得动但必被拦 / 打电话找不到方法 / 挂住不超时），所以逐处断言，不靠一处。
//
// 做法：只读源码文本，按「登记点 × 期望记号」的表逐项查在不在；再用一份**故意删掉两条记号的副本**跑同一个判据，
// 确认判据真的会报缺（test-the-test，防止正则或查表写得太松、门禁永远绿）。
// 本文件是 CommonJS：判据工具用 require 取 .ts 需要钩子，跑法见文件末尾注释。
const fs = require('fs')
const path = require('path')
const { printGateResult } = require('./lib/gate-result.ts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-write-registration'
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; if (!ok) failed = true; console.log((ok ? '  PASS ' : '  FAIL ') + msg) }

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8') }

/** 七个登记点各自落在哪份源码里。只读文本，不改任何东西。 */
const SOURCES = {
  ports: read('src/shared/version-control/src/ports.ts'),
  rules: read('src/shared/version-control/src/rules.ts'),
  check: read('src/host/versionControlCheck.ts'),
  write: read('src/host/versionControlWrite.ts'),
  hostIndex: read('src/host/index.ts'),
  clientPhones: read('src/client/views/versionControl/vcWriteRun.ts'),
  yaml: read('config/timeouts.yaml'),
}

/**
 * 登记点 → 期望记号。记号都取「少了这一项就真的会坏」的那一小段源码，
 * 不取注释、不取实现细节：例如 ④ 只认装配返回值里的 handleGitXxx: handleGitXxx，光有函数定义但没装配出去也算缺。
 */
const POINTS = [
  { point: '① 操作枚举', file: 'ports', tokens: ["export type WriteOp = 'commit' | 'pull' | 'push' | 'fetch'"] },
  { point: '② 判定分支', file: 'rules', tokens: ["case 'stage':", "case 'commit':", "case 'pull':", "case 'push':", "case 'fetch':", "'unknown-operation'"] },
  { point: '③ 检查白名单', file: 'check', tokens: ["op !== 'commit'", "op !== 'pull'", "op !== 'push'", "op !== 'fetch'"] },
  { point: '④ 写处理函数', file: 'write', tokens: ['handleGitStage: handleGitStage', 'handleGitUnstage: handleGitUnstage', 'handleGitCommit: handleGitCommit', 'handleGitPull: handleGitPull', 'handleGitFetch: handleGitFetch', 'handleGitPush: handleGitPush'] },
  { point: '⑤ 宿主注册', file: 'hostIndex', tokens: ["harness.handle('wf.gitWriteCheck'", "harness.handle('wf.gitStage'", "harness.handle('wf.gitUnstage'", "harness.handle('wf.gitCommit'", "harness.handle('wf.gitPull'", "harness.handle('wf.gitFetch'", "harness.handle('wf.gitPush'"] },
  { point: '⑥ 电话表', file: 'clientPhones', tokens: ["check: 'wf.gitWriteCheck'", "stage: 'wf.gitStage'", "unstage: 'wf.gitUnstage'", "commit: 'wf.gitCommit'", "pull: 'wf.gitPull'", "fetch: 'wf.gitFetch'", "push: 'wf.gitPush'"] },
  { point: '⑦ 超时配置', file: 'yaml', tokens: ['vcRunTimeoutMs:', 'vcCheckCallBudgetMs:', 'vcAddTimeoutMs:', 'vcCommitTimeoutMs:', 'vcPullTimeoutMs:', 'vcPushTimeoutMs:', 'vcFetchTimeoutMs:'] },
  { point: '⑦ 超时接线', file: 'write', tokens: ['ADD_TIMEOUT_MS', 'COMMIT_TIMEOUT_MS', 'PULL_TIMEOUT_MS', 'PUSH_TIMEOUT_MS', 'FETCH_TIMEOUT_MS'] },
]

/** 判据本体：给一份源码表，回「缺了哪些登记记号」。空数组 = 七个登记点一处不漏。 */
function missingRegistrations(sources) {
  const out = []
  for (const p of POINTS) {
    const text = String(sources[p.file] || '')
    for (const token of p.tokens) {
      if (text.indexOf(token) < 0) out.push(p.point + ' → ' + token)
    }
  }
  return out
}

console.log('七个登记点逐项查在不在（操作枚举 / 判定分支 / 检查白名单 / 写处理函数 / 宿主注册 / 电话表 / 超时配置）')
for (const p of POINTS) {
  for (const token of p.tokens) {
    check(SOURCES[p.file].indexOf(token) >= 0, p.point + ' 登记在 ' + p.file + '：' + token)
  }
}

// test-the-test：把两份源码里各删掉一条登记记号，同一个判据必须正好报出这两条缺。
// 如果这里不报缺，说明判据太松（比如查的是文件里任意出现的词），上面那一片 PASS 就没有证据力。
const mutated = Object.assign({}, SOURCES)
mutated.rules = SOURCES.rules.replace("case 'pull':", '')
mutated.hostIndex = SOURCES.hostIndex.replace("harness.handle('wf.gitPush'", '')
const gaps = missingRegistrations(mutated)
check(gaps.length === 2 && gaps[0].indexOf("case 'pull':") >= 0 && gaps[1].indexOf("harness.handle('wf.gitPush'") >= 0, '反证自检：故意删掉两条登记记号后判据正好报出这两条缺（' + gaps.join('；') + '）')

console.log('')
if (failed) console.log('存在失败 — ' + GATE + ' 未通过')
else console.log('全部通过 — 七个登记点一处不漏（' + total + ' 项断言）')
printGateResult(GATE, total, failed ? 1 : 0)
process.exit(failed ? 1 : 0)
