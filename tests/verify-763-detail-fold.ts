#!/usr/bin/env node
/**
 * verify-763-detail-fold.ts — ISSUE 详情页顶栏逐字折叠门禁（#763）
 * 口径：返回优先收到图标，一次只折一个控件，不放省略号。
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-763-detail-fold.ts
 * 本文件是 ESM：按文本求值走 tests/lib/eval-probe.js（钩子改指 .ts），只加类型标注不改判据。
 */
// 按文本求值走共用入口，理由与用法见 tests/lib/eval-probe.js 文件头（本文件是 ESM，用 import 取具名导出）。
import { compileFn } from './lib/eval-probe.js'
// 折叠判据已转成 TypeScript 真源 src/client/views/issueDetailFold.ts，同名 .js 构建产物已删除；
// 取源统一走 tests/lib/source-text.js（钩子改指 .ts），它会按构建同一套口径读出可拼接的 JavaScript。
import { spliceableJs } from './lib/source-text.js'

let passed = 0, failed = 0
function ok(msg: string): void { passed++; console.log('  PASS ' + msg) }
function bad(msg: string): void { failed++; console.log('  FAIL ' + msg) }
function check(cond: unknown, msg: string): void { if (cond) ok(msg); else bad(msg) }

const FOLD = 'src/client/views/issueDetailFold.js'

console.log('=== #763 详情页顶栏：返回优先逐字收到图标，不放省略号 ===')

// 以前这里直接 fs 读 src/client/views/issueDetailFold.js。那个 .js 是构建产物，已经随本次迁移
// 全部删除；现在同目录只剩真源 .ts。所以改为用 spliceableJs 取源：它先找同名 .ts，再按构建
// 同一套规则转成可拼接的 JavaScript（行首 export 已剥掉、模块语句会报错），拼出来的函数体形状
// 与旧产物一致，后面的断言原样继续跑。文件不存在时 spliceableJs 会抛错，被 catch 接住后 fold
// 仍是 null，下面「折叠判据文件存在且可加载」这条判据不放松。
const fold = (function () {
  try {
    return compileFn([], spliceableJs(FOLD) + '\nreturn { issueDetailFoldLadderOf, issueDetailFoldStateAt }')()
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

console.log('')
console.log(`共 ${passed} 通过，${failed} 失败`)
if (failed) process.exit(1)
