// tests/verify-881-commit-open.js — #881 回归门禁：提交历史里点开不再被清空
// 用法：在插件根目录执行 node tests/verify-881-commit-open.js，可独立运行。
//
// 守的是这一次修的最小可用：已经在提交历史里点某一条，原地展开详情；
//   人手动点页签才离开详情。写法照 verify-842 的 M5/M6 那一组，只多模拟 React
//   把同一拍里的两次 setUi 按序执行（对象与函数两种形态都按序落）。
const path = require('path')
const { pathToFileURL } = require('url')
const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const flush = () => new Promise((r) => setImmediate(r))
async function main() {
  console.log('提交点开回归门禁（#881）')
  const opsMod = await import(pathToFileURL(path.join(ROOT, 'src', 'client', 'views', 'versionControl', 'vcDiffOps.js')).href)
  const viewsMod = await import(pathToFileURL(path.join(ROOT, 'src', 'client', 'views', 'versionControl', 'vcViews.js')).href)
  const vcDiffOpsOf = opsMod.vcDiffOpsOf
  const vcPickViewStateOf = viewsMod.vcPickViewStateOf
  check(typeof vcDiffOpsOf === 'function', '真源可加载：vcDiffOpsOf 存在')
  check(typeof vcPickViewStateOf === 'function', '真源可加载：vcPickViewStateOf 存在')
  // 手动点页签仍清空：这是要保留的老约定，修完也不能丢。
  const cleared = vcPickViewStateOf({ view: 'commits', openCommit: 'abc', openDiff: '' }, 'changes')
  check(cleared.openCommit === '' && cleared.view === 'changes', '手动切页签仍离开详情（openCommit 被清空）')
  // 模拟一个组件拍：setUi 只排队，拍末按序执行（与 React 批量一致）。
  const runBatch = (ui0, fn) => {
    const queue = []
    const setUi = (u) => queue.push(u)
    const setReads = () => {}
    const readsRef = { current: { commit: { rev: '', state: 'idle' } } }
    const vcStub = (reads) => reads
    const pickView = (v) => { try { const { vcRememberView } = viewsMod; if (typeof vcRememberView === 'function') vcRememberView(v) } catch (e) {} ; setUi((cur) => vcPickViewStateOf(cur, v)) }
    const ops = vcDiffOpsOf({ ui: ui0, setUi, setReads, readsRef, callHost: () => Promise.resolve({ ok: true, files: [], truncated: false, reason: 'ok' }), cwd: 'D:/w/repo', stateCwdRef: { current: 'D:/w/repo' }, vcDiffOpenKeyOf: () => 'k', vcReadDiff: vcStub, vcReadCommitFiles: (reads) => Promise.resolve(reads), vcReadCommitFileDiff: vcStub, vcApplyDiffReply: vcStub, vcApplyCommitReply: vcStub, vcReadsOf: () => ({ state: 'idle' }), vcMarkDiffLoading: vcStub, vcMarkCommitLoading: vcStub, vcMarkCommitFileDiffLoading: vcStub, vcApplyCommitFileDiffReply: vcStub, onView: pickView })
    fn(ops)
    let cur = ui0
    for (const u of queue) cur = (typeof u === 'function') ? u(cur) : u
    return cur
  }
  // 已经在提交历史里点第一条：多余跳转不能把刚记的擦掉。
  const end1 = runBatch({ view: 'commits', openCommit: '', openDiff: '' }, (ops) => ops.openCommit({ key: '094aad3' }))
  check(end1.openCommit === '094aad3', '已在提交历史里点 094aad3：openCommit 留得住（实得 ' + JSON.stringify(end1.openCommit) + '）')
  check((end1.openCommit ? 'commits' : end1.view) === 'commits', '点开后按提交历史那一页画（effView 仍是 commits）')
  // 从改动页点开（兼容老链路）：同样留得住。
  const end2 = runBatch({ view: 'changes', openCommit: '', openDiff: '' }, (ops) => ops.openCommit({ key: 'r9' }))
  check(end2.openCommit === 'r9' && end2.view === 'commits', '从改动页点开也留得住并落在提交历史（实得 ' + JSON.stringify(end2) + '）')
  // 回来那条路不变：关掉回到改动页。
  const end3 = (() => {
    const queue = []
    const setUi = (u) => queue.push(u)
    const ops = vcDiffOpsOf({ ui: { view: 'commits', openCommit: 'r9', openDiff: '' }, setUi, setReads: () => {}, readsRef: { current: { commit: { rev: 'r9', state: 'ok' } } }, callHost: () => Promise.resolve({}), cwd: 'D:/w/repo', stateCwdRef: { current: 'D:/w/repo' }, vcDiffOpenKeyOf: () => 'k', vcReadDiff: (r) => r, vcReadCommitFiles: (r) => Promise.resolve(r), vcReadCommitFileDiff: (r) => r, vcApplyDiffReply: (r) => r, vcApplyCommitReply: (r) => r, vcReadsOf: () => ({}), vcMarkDiffLoading: (r) => r, vcMarkCommitLoading: (r) => r, vcMarkCommitFileDiffLoading: (r) => r, vcApplyCommitFileDiffReply: (r) => r, onView: (v) => setUi((cur) => vcPickViewStateOf(cur, v)) })
    ops.closeCommit()
    let cur = { view: 'commits', openCommit: 'r9', openDiff: '' }
    for (const u of queue) cur = (typeof u === 'function') ? u(cur) : u
    return cur
  })()
  check(end3.openCommit === '' && end3.view === 'changes', '回来仍回到改动页（openCommit 清空）')
  await flush()
  console.log(failed ? '\\n存在失败' : '\\n全部通过 — #881 回归门禁生效（' + total + ' 条断言）')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
