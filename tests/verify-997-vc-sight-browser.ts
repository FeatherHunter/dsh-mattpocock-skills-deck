#!/usr/bin/env node
/**
 * verify-997-vc-sight-browser.ts —— 版本管理页入口委托与旧块渲染路径退役的门禁（#997 落地，#1776 M1 改口径）
 *
 * 这扇门禁原来在真浏览器里量一件事：旧版本管理页的改动列表滚到底、看见「另有 N 个文件」那句提示时，
 * 列表会自动接着画下一批，而且画面不跳。那段行为只属于旧块渲染路径（vcInView + vcBlocks 那一套）。
 *
 * #1776 M1 把版本管理页换成真实页签：入口 VersionControlTab.ts 只剩一层委托，旧块渲染路径整段删除。
 * 新页签里提交历史下一页是显式的「加载更多」按钮（vcHistory.ts 的 data-vc-load-more），不再靠滚动触发；
 * 因此原来量的三件事已经没有被测对象，真浏览器那一套装置也不再需要。
 *
 * 本文件改守三件事，判据都直接读源码文本，不起浏览器：
 *   A. 入口只剩委托：VersionControlTab.ts 必须把渲染交给 VcRealTab，且旧块渲染路径的三个特征都不在
 *      （vcBlocksOf / vcViewBlocksOf / data-vc-root 这些旧块画法）。
 *   B. 新容器真的用页面壳画：vcRealTab.ts 里要出现 vcShellPageNode(h, tr, shellOpts)，且不再引用旧块的
 *      自动续读（vcInView）。
 *   C. 三时机刷新与键盘导航的地基还在：vcRealActions.ts 里有进入 / 任务完成 / 手动刷新三个入口，
 *      vcRealDelegate.ts 里有方向键与 Home/End 的处理。
 * 反证：把入口那一行 return 改成 null，同一个判据函数必须当场报红（证明门禁抓得住「入口没接上」）。
 *
 * 后续如果要在真浏览器里量新页签的滚动行为，应另建门禁；这扇门禁的职责到「入口委托 + 旧路径退役」为止。
 */
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: unknown, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')

type AuditResult = { ok: boolean, msg: string }

// 判据写成纯函数：给一个「按仓库内相对路径读源码」的函数，交回逐条结论。
// 反证复用同一个函数，避免「专供自证」的宽松版本。
function entryAudit(readFile: (rel: string) => string): AuditResult[] {
  const out: AuditResult[] = []
  const checkOne = (ok: unknown, msg: string): void => { out.push({ ok: !!ok, msg: msg }) }

  const entry = readFile('src/client/views/versionControl/VersionControlTab.ts')
  checkOne(entry.indexOf('VcRealTab') >= 0 && entry.indexOf('React.createElement(VcRealTab, props)') >= 0, 'A1 入口 VersionControlTab.ts 只剩一层委托：用 React.createElement(VcRealTab, props) 把渲染交给真实页签容器')
  checkOne(entry.indexOf('vcBlocksOf') < 0 && entry.indexOf('vcViewBlocksOf') < 0 && entry.indexOf("'data-vc-root'") < 0, 'A2 旧块渲染路径已从入口删净：入口里不再出现 vcBlocksOf / vcViewBlocksOf / data-vc-root')
  checkOne(entry.indexOf('VC_TONE') >= 0, 'A3 页签自带的配色表 VC_TONE 仍留在入口文件（container-colors 门禁按这个文件找警告色令牌）')

  const tab = readFile('src/client/views/versionControl/vcRealTab.ts')
  checkOne(tab.indexOf('vcShellPageNode(h, tr, shellOpts)') >= 0, 'B1 新容器真的用页面壳画页面：vcRealTab.ts 里出现 vcShellPageNode(h, tr, shellOpts)')
  checkOne(tab.indexOf('vcInView') < 0, 'B2 新容器不再用旧块的「滑到就续读」：vcRealTab.ts 里不出现 vcInView')
  checkOne(tab.indexOf("'data-vc-live'") >= 0 && tab.indexOf("'data-vc-live-empty'") >= 0, 'B3 新容器挂了自己的标记：data-vc-live（正常态）与 data-vc-live-empty（空 cwd 空态）')

  const actions = readFile('src/client/views/versionControl/vcRealActions.ts')
  checkOne(actions.indexOf('vcReadFirstScreenOnEnter') >= 0 && actions.indexOf('vcReadFirstScreenOnManual') >= 0 && actions.indexOf('vcReadFirstScreenAfterTask') >= 0, 'C1 三时机刷新都接在同一处：进入 / 任务完成 / 手动刷新三个入口都出现在 vcRealActions.ts')
  const delegate = readFile('src/client/views/versionControl/vcRealDelegate.ts')
  checkOne(delegate.indexOf('onKeyDown') >= 0 && delegate.indexOf('ArrowRight') >= 0 && delegate.indexOf('Home') >= 0 && delegate.indexOf('End') >= 0, 'C2 键盘导航的地基在：委托层处理方向键与 Home / End（页签组按 WAI-ARIA 的 Tabs 模式走）')
  return out
}

for (const r of entryAudit(read)) check(r.ok, r.msg)

// 反证：把入口那一行 return 改成 null，A1 必须判红。改的只是内存里的文本，真实文件一个字都不动。
const original = read('src/client/views/versionControl/VersionControlTab.ts')
const brokenEntry = original.replace('return React.createElement(VcRealTab, props)', 'return null')
check(brokenEntry !== original, '反证自证：入口那一行 return 确实被改坏了')
const brokenResults = entryAudit((rel: string) => (rel === 'src/client/views/versionControl/VersionControlTab.ts' ? brokenEntry : read(rel)))
const brokenA1 = brokenResults.filter((r) => r.msg.indexOf('A1') === 0)
check(brokenA1.length === 1 && brokenA1[0].ok === false, '反证：入口不再交给 VcRealTab 时 A1 当场判红（门禁抓得住「入口没接上」）')

console.log('')
if (failed) { console.log('存在失败 — verify-997-vc-entry-retired 未通过（' + total + ' 项断言）'); process.exit(1) }
console.log('全部通过 — 版本管理页入口委托与旧块渲染路径退役门禁生效（' + total + ' 项断言）')
