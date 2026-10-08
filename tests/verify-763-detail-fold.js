#!/usr/bin/env node
/**
 * verify-763-detail-fold.js — ISSUE 详情页顶栏逐字折叠门禁（#763）
 * 口径：返回优先收到图标，一次只折一个控件，不放省略号。
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
// 按文本求值走共用入口，理由与用法见 tests/lib/eval-probe.js 文件头（本文件是 ESM，用 import 取具名导出）。
import { compileFn } from './lib/eval-probe.js'

let passed = 0, failed = 0
function ok(msg) { passed++; console.log('  PASS ' + msg) }
function bad(msg) { failed++; console.log('  FAIL ' + msg) }
function check(cond, msg) { if (cond) ok(msg); else bad(msg) }

const read = (rel) => readFileSync(resolve(rel), 'utf8')
const FOLD = 'src/client/views/issueDetailFold.js'
const DETAIL = 'src/client/views/IssueDetail.js'

console.log('=== #763 详情页顶栏：返回优先逐字收到图标，不放省略号 ===')

const fold = (function () {
  if (!existsSync(resolve(FOLD))) return null
  try {
    // 按文本求值走共用入口：这里没有参数名、函数体是剥掉行首 export 的纯函数源码，所以走 compileFn。
    return compileFn([], read(FOLD).replace(/^[ \t]*export[ \t]+/gm, '') + '\nreturn { issueDetailFoldLadderOf, issueDetailFoldStateAt }')()
  } catch (e) { return null }
})()

check(!!fold, '折叠判据文件存在且可加载')
if (fold) {
  const ladder = fold.issueDetailFoldLadderOf({ back: '返回列表', crumb: '#758', snapshot: '快照', primary: '修复', newSession: '新会话' })
  check(Array.isArray(ladder.steps), '阶梯 steps 为数组')
  const order = ladder.steps.map((s) => s.el)
  const firstBack = order.indexOf('back')
  const firstCrumb = order.indexOf('crumb')
  const firstSnap = order.indexOf('snapshot')
  const firstPrim = order.indexOf('primary')
  const firstNew = order.indexOf('newSession')
  check(firstBack === 0, '返回先折（第 0 步即返回）')
  check(firstBack < firstCrumb && firstCrumb < firstSnap && firstSnap < firstPrim && firstPrim < firstNew, '顺序：返回→面包屑→快照→主动作→新会话')
  const s0 = fold.issueDetailFoldStateAt(ladder, 0)
  check(s0.back === '返回列表' && s0.crumb === '#758', '第 0 档全展开')
  let prevTotal = s0.back.length + s0.crumb.length + s0.snapshot.length + s0.primary.length + s0.newSession.length
  let stepOk = true
  for (let t = 1; t <= ladder.steps.length; t++) {
    const cur = fold.issueDetailFoldStateAt(ladder, t)
    const total = cur.back.length + cur.crumb.length + cur.snapshot.length + cur.primary.length + cur.newSession.length
    if (total !== prevTotal - 1) { stepOk = false; break }
    prevTotal = total
    const dump = cur.back + cur.crumb + cur.snapshot + cur.primary + cur.newSession
    if (dump.includes('…') || dump.includes('...')) { stepOk = false; break }
  }
  check(stepOk, '相邻两档只差一个字且不补省略号')
  const last = fold.issueDetailFoldStateAt(ladder, ladder.steps.length)
  check(last.back === '' && last.crumb === '' && last.snapshot === '' && last.primary === '' && last.newSession === '', '收到底全空，只剩图标')
  const fulls = { back: '返回列表', crumb: '#758', snapshot: '快照', primary: '修复', newSession: '新会话' }
  let singleOk = true
  for (let t = 0; t <= ladder.steps.length; t++) {
    const cur = fold.issueDetailFoldStateAt(ladder, t)
    const keys = ['back', 'crumb', 'snapshot', 'primary', 'newSession']
    let partial = 0
    for (const k of keys) {
      const v = cur[k] || ''
      const f = fulls[k] || ''
      if (v.length > 0 && v.length < f.length) partial++
      if (v.length > 0 && f.indexOf(v) !== 0) { partial = 99; break }
    }
    if (partial > 1) { singleOk = false; break }
  }
  check(singleOk, '同一档最多只有一个控件半截字，不多按钮同时显示不全')
}

const src = read(DETAIL)
const hookSrc = existsSync(resolve('src/client/views/useIssueDetailFold.js')) ? read('src/client/views/useIssueDetailFold.js') : ''
check(src.includes('data-detail-back-text') && src.includes('data-detail-crumb') && src.includes('data-detail-primary-text') && src.includes('data-detail-new-text'), '顶栏五串字挂折叠标记')
check(src.includes('useIssueDetailFold') && src.includes('topBarRef'), '折叠机 hook 接线在')
check(hookSrc.includes('issueDetailFoldLadderOf') && hookSrc.includes('issueDetailFoldStateAt'), '折叠机读判据')
check(!/data-detail-(back-text|crumb|snapshot|primary-text|new-text)[\s\S]{0,220}flex:\s*'(0 1 auto|1 1 auto)'/.test(src), '折叠字不靠 CSS 并行收缩（除空隙外全 flex:none）')
check(!/data-detail-(back-text|crumb|snapshot|primary-text|new-text)[\s\S]{0,200}textOverflow/.test(src), '折叠字不走省略号')
check(src.includes("h('span', { 'data-detail-primary-text': 1"), '主动作按钮自建以便逐字裁字')
check(src.includes('primaryInfo'), '主动作口径与列表行同源')

console.log('')
console.log(`共 ${passed} 通过，${failed} 失败`)
if (failed) process.exit(1)
