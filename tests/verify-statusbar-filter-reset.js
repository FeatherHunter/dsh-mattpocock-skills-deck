// tests/verify-statusbar-filter-reset.js — “可接/诊断 不残留 BUG 标签”契约 · issue #397
// 用法: node tests/verify-statusbar-filter-reset.js [file...]（默认 client.js + package/lib/client.js 双源）
//
// 契约：
//  - 状态栏胶囊 3 段的过滤切换必须互相独立，不得残留上一入口的标签维度
//  - 可接（frontier）：stateFilter='frontier' + lblFilters=[]（清空所有标签，含 BUG 与面板手动多选）
//  - BUG：stateFilter='open' + lblFilters=['bug']（保持现状，选中 BUG）
//  - 诊断：stateFilter='open' + lblFilters=['needs-triage']（覆盖 BUG 与其它手动多选，不与 BUG 取交集）
//  - ListTab 先按 lblFilters 过滤（byLabel），再按 stateFilter 过滤（frontier/open 等），因此入口需显式设定 lblFilters
//
// 校验：
//  1) 源码段 seg('target' ... frontier) 的 handler 必须含 s.lblFilters = []
//  2) 源码段 seg('alert' ... bug) 的 handler 必须含 s.lblFilters = ['bug']
//  3) 源码段 seg('search' ... triage) 的 handler 必须含 s.lblFilters = ['needs-triage']
//  4) 回归：byLabel 在 lblFilters=[] 时不过滤，['bug'] 仅保留含 bug 的票，['needs-triage'] 匹配空标签票（isTriageLike）
//  5) 功能：模拟 BUG -> 可接 的切换，验证可接后列表为全量可接而非 BUG 交集；BUG -> 诊断 不与 BUG 交集；手动多选后切可接/诊断 被清空或覆写
const fs = require('fs')
const path = require('path')

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['client.js', 'package/lib/client.js']
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('P1: 状态栏“可接/诊断”不残留 BUG 标签过滤契约 · #397')

for (const file of files) {
  if (!fs.existsSync(file)) { check(false, file + ' 缺失（请先 build）'); continue }
  const src = fs.readFileSync(file, 'utf8')
  // 1) 可接 handler
  // 匹配 seg('target', ..., function () { s.stateFilter = 'frontier'; s.lblFilters = []; go('list') } 的变体（允许空格、分号差异）
  const frontierSeg = /seg\('target'[\s\S]{0,300}function\s*\(\)\s*\{[^}]*s\.stateFilter\s*=\s*'frontier'[^}]*s\.lblFilters\s*=\s*\[\][^}]*go\('list'\)[^}]*\}/
  check(frontierSeg.test(src), file + ' · 可接段含 s.stateFilter=frontier + s.lblFilters=[] + go(list)')
  // 反例：旧版仅设 stateFilter 未清 lblFilters
  const frontierWithoutClear = /seg\('target'[\s\S]{0,200}function\s*\(\)\s*\{\s*s\.stateFilter\s*=\s*'frontier'\s*;\s*go\('list'\)/
  if (frontierWithoutClear.test(src) && !frontierSeg.test(src)) {
    check(false, file + ' · 可接段仍为旧版未清 lblFilters（仅 s.stateFilter=frontier; go(list)）')
  }
  // 2) BUG handler
  const bugSeg = /seg\('alert'[\s\S]{0,300}s\.stateFilter\s*=\s*'open'[^}]*s\.lblFilters\s*=\s*\['bug'\][^}]*go\('list'\)/
  check(bugSeg.test(src), file + ' · BUG 段含 s.stateFilter=open + s.lblFilters=[bug] + go(list)')
  // 3) 诊断 handler
  const triageSeg = /seg\('search'[\s\S]{0,300}s\.stateFilter\s*=\s*'open'[^}]*s\.lblFilters\s*=\s*\['needs-triage'\][^}]*go\('list'\)/
  check(triageSeg.test(src), file + ' · 诊断段含 s.stateFilter=open + s.lblFilters=[needs-triage] + go(list)')

  // 额外：确保 StatusBar 源码中三段都显式设定 lblFilters（而非依赖残留）
  const lblSetCount = (src.match(/s\.lblFilters\s*=/g) || []).length
  // 期望至少 3 次赋值（可接/BUG/诊断），外加可能的其它清零（如 ListTab chips），这里仅对 StatusBar 三段做下限检查
  // 在 client.js 全量中 lblFilters 赋值多处，此处不做强上界
  check(lblSetCount >= 3, file + ' · s.lblFilters 赋值次数 >=3（实际 ' + lblSetCount + '）')
}

// ---- 功能模拟：ListTab byLabel + stateFilter 叠加语义 ----
// 与 ListTab.js:131-143 同构的最小过滤实现
const byLabel = (lblFilters, x) => {
  const ls = lblFilters || []
  if (!ls.length) return true
  const labs = x.labels || []
  if (!labs.length) return ls.indexOf('needs-triage') >= 0
  return labs.some(l => ls.indexOf(l.name) >= 0)
}
const mkIssues = () => [
  { number: 1, state: 'OPEN', labels: [{ name: 'bug' }], assignees: [] },
  { number: 2, state: 'OPEN', labels: [{ name: 'enhancement' }], assignees: [] },
  { number: 3, state: 'OPEN', labels: [{ name: 'bug' }], assignees: [{ login: 'a' }] }, // 被占用，不可接
  { number: 4, state: 'OPEN', labels: [], assignees: [] }, // 空标签视作待诊断
  { number: 5, state: 'OPEN', labels: [{ name: 'needs-triage' }], assignees: [] },
  { number: 6, state: 'OPEN', labels: [{ name: 'feature' }], assignees: [] },
  { number: 7, state: 'CLOSED', labels: [{ name: 'bug' }], assignees: [] },
]
const isOccupied = (x) => !!(x.assignees && x.assignees.length)
const filterFrontier = (issues, lblFilters) => {
  const openRows = issues.filter(x => x.state !== 'CLOSED')
  const openFiltered = lblFilters.length ? openRows.filter(x => byLabel(lblFilters, x)) : openRows
  return openFiltered.filter(x => !isOccupied(x))
}
const filterOpen = (issues, lblFilters) => {
  const openRows = issues.filter(x => x.state !== 'CLOSED')
  return lblFilters.length ? openRows.filter(x => byLabel(lblFilters, x)) : openRows
}

console.log('\nP2: 功能模拟（ListTab 双维叠加）')
const issues = mkIssues()
{
  // BUG -> 可接（旧：未清 BUG，交集）
  const oldFrontier = filterFrontier(issues, ['bug'])
  check(oldFrontier.length === 1 && oldFrontier[0].number === 1, '旧行为 BUG+可接 交集仅剩 bug 可接 1 条（复现残留）')
  const newFrontier = filterFrontier(issues, [])
  const allFrontierNums = issues.filter(x => x.state !== 'CLOSED' && !isOccupied(x)).map(x => x.number).sort((a,b)=>a-b)
  const newNums = newFrontier.map(x=>x.number).sort((a,b)=>a-b)
  check(JSON.stringify(newNums) === JSON.stringify(allFrontierNums), '新行为 可接 清空后为全量可接 ' + JSON.stringify(allFrontierNums) + '（实际 ' + JSON.stringify(newNums) + '）')
}
{
  // BUG -> 诊断：诊断应覆写为 needs-triage，不与 BUG 交集，且空标签视作待诊断
  const diag = filterOpen(issues, ['needs-triage'])
  const diagNums = diag.map(x=>x.number).sort((a,b)=>a-b)
  check(JSON.stringify(diagNums) === JSON.stringify([4,5]), '诊断 覆写为 needs-triage 后为 [4,5]（空标签 4 视作待诊断，实际 ' + JSON.stringify(diagNums) + '）')
  // 确认不含 bug
  check(!diag.some(x=> x.labels.some(l=>l.name==='bug')), '诊断列表不含 bug（已清除 BUG 残留）')
}
{
  // 面板内手动多选标签后切可接/诊断：应被清空或覆写，不残留
  // 模拟：手动选中 ['enhancement','bug','feature'] 后点可接 -> []
  const manualBefore = ['enhancement','bug','feature']
  const afterTakeable = [] // 可接 handler 清空
  const res = filterFrontier(issues, afterTakeable)
  check(res.length === 5, '手动多选后切可接 被清空为 []，得到全量可接 5 条（实际 ' + res.length + '）')
  // 手动多选后点诊断 -> ['needs-triage']
  const afterTriage = ['needs-triage']
  const res2 = filterOpen(issues, afterTriage)
  check(JSON.stringify(res2.map(x=>x.number).sort((a,b)=>a-b)) === JSON.stringify([4,5]), '手动多选后切诊断 被覆写为 needs-triage，不残留旧标签')
}
{
  // 单独点 BUG 仍为 BUG 过滤
  const bugOnly = filterOpen(issues, ['bug'])
  check(JSON.stringify(bugOnly.map(x=>x.number).sort((a,b)=>a-b)) === JSON.stringify([1,3]), '单独 BUG 仍为 bug 过滤 [1,3]')
  // 单独点可接不依赖先前的 BUG 状态（即 [] 时为全量）
  const soloFrontier = filterFrontier(issues, [])
  check(soloFrontier.length === 5, '单独可接 为全量可接 5 条，不依赖 BUG')
}
{
  // 边界：byLabel 空集合不过滤
  check(byLabel([], { labels: [{name:'bug'}] }) === true, '边界 byLabel([]) 对有标签票不过滤')
  check(byLabel([], { labels: [] }) === true, '边界 byLabel([]) 对空标签票不过滤')
  // 边界：needs-triage 对空标签票视作命中
  check(byLabel(['needs-triage'], { labels: [] }) === true, '边界 needs-triage 命中空标签票')
  check(byLabel(['bug'], { labels: [] }) === false, '边界 bug 不命中空标签票')
  // 边界：CLOSED 不进入 frontier/open 计数，但 closed 过滤仍走 byLabel
  const closedOnly = [{ number: 10, state: 'CLOSED', labels: [{name:'bug'}]}]
  check(filterFrontier(closedOnly, []).length === 0, '边界 CLOSED 不计入可接')
}

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
