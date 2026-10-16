#!/usr/bin/env node
/**
 * verify-683-mirror-write.js —— 选择镜像退役门禁（#1003 二期改写，原 #683 F1 R7b/R7c/R7d 已退役）：
 * 后端选择只认工作区文件，本地这张镜像表（dsws.selectionByCwd）不再读写；
 * 布局那张表（dsws.setupLayoutByCwd）保留读-改-写、跨窗口合并、写失败看得见（随 #1012 搬）。
 *
 * 做法：把 src/client/kernel/store-prefs.js 的真身文本喂进一个沙箱求值（真源、假 localStorage 与假 window），
 * 再用改坏的那一份跑同一批断言 —— 该红的必须当场红。
 *
 * 用法：node tests/verify-683-mirror-write.js
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { compileFn } from './lib/eval-probe.js'
// 中央时间真值：缓存 TTL 只住 config/*.yaml，这里读同一份导出来预埋，不在测试里写第二份数字。
import { SYNC_ISSUE_CACHE_TTL_MS } from '../src/shared/time-config/values.js'
;(globalThis as unknown as Record<string, unknown>).SYNC_ISSUE_CACHE_TTL_MS = SYNC_ISSUE_CACHE_TTL_MS
// 中央 import 在 compileFn 函数体里非法，求值前整行剥掉（闭包里它由时间片段提供，门禁里走上面的全局预埋）。
const stripTimeConfigImport = (s: string): string => s.split('\n').filter((l) => !/^\s*import\s.*time-config\/values\.js/.test(l)).join('\n')

const ROOT = path.resolve(import.meta.dirname, '..')
const PREFS_REL = 'src/client/kernel/store-prefs.js'
let passed = 0
let failed = 0
const check = (ok: unknown, msg: string): void => { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }

const prefsSrc = fs.readFileSync(path.join(ROOT, PREFS_REL), 'utf8')
const stripExports = (s: string): string => s.replace(/^[ \t]*export[ \t]+/gm, '')
const TBL_SEL = 'dsws.selectionByCwd'
const TBL_LAYOUT = 'dsws.setupLayoutByCwd'
const wsKey = (p: unknown): string => String(p == null ? '' : p).replace(/\\/g, '/').toLowerCase()

const makeHarness = function (srcText: string, opts?: any) {
  const o = opts || {}
  const disk: Record<string, string> = {}
  Object.keys(o.disk || {}).forEach((k) => { disk[k] = o.disk[k] })
  const logs: any[] = []
  const storageHandlers: any[] = []
  const failKeys: any[] = o.failKeys || []
  const localStorage = {
    getItem: function (k: string) { return Object.prototype.hasOwnProperty.call(disk, k) ? disk[k] : null },
    setItem: function (k: string, v: unknown) { if (failKeys.indexOf(k) >= 0) throw new Error('quota-exceeded'); disk[k] = String(v) },
    removeItem: function (k: string) { delete disk[k] },
  }
  const win = { innerHeight: 800, addEventListener: function (name: string, fn: any) { storageHandlers.push({ name: name, fn: fn }) } }
  const body = stripExports(stripTimeConfigImport(srcText)) +
    '\n; return { setCachedSelection: setCachedSelection, getCachedSelection: getCachedSelection, selectionByCwd: selectionByCwd,' +
    ' setCachedSetupLayout: setCachedSetupLayout, getCachedSetupLayout: getCachedSetupLayout, setupLayoutByCwd: setupLayoutByCwd,' +
    ' writeTableEntry: writeTableEntry, migrateCachedChoiceToKey: migrateCachedChoiceToKey, SELECTION_BY_CWD_KEY: SELECTION_BY_CWD_KEY, SETUP_LAYOUT_BY_CWD_KEY: SETUP_LAYOUT_BY_CWD_KEY }'
  const factory = compileFn(['window', 'localStorage', 'log', 'keyOf', 'wsKeyOf', 'emit', 'shared', 'stores'], body)
  const api = factory(win, localStorage, function (level: unknown, event: unknown, fields: unknown) { logs.push({ level: level, event: event, fields: fields }) }, wsKey, wsKey, function () {}, {}, {})
  return { api: api, disk: disk, logs: logs, handlers: storageHandlers }
}
const tableOf = (h: any, key: string) => { try { return JSON.parse(h.disk[key] || '{}') || {} } catch (e) { return {} } }
const fireStorage = (h: any, key: string) => {
  const hs = h.handlers.filter((x) => x.name === 'storage')
  if (!hs.length) return false
  hs.forEach((x) => x.fn({ key: key }))
  return true
}

console.log('选择镜像退役门禁（#1003：选择表不再读写，布局表保留读-改-写）')

// ── A 选择表：写了当没写，读了当没有 ──────────────────────────────────────────
console.log('')
console.log('== A 选择镜像已退役（写空、读空、不碰盘）==')
{
  const h = makeHarness(prefsSrc, { disk: { [TBL_SEL]: JSON.stringify({ 'd:/other/window': { backendId: 'gitlab' } }) } })
  h.api.setCachedSelection('D:\\Mine', { backendId: 'github' })
  check(Object.keys(h.disk).filter((k) => k === TBL_SEL && h.disk[k] !== JSON.stringify({ 'd:/other/window': { backendId: 'gitlab' } })).length === 0, '写选择镜像不再落盘（磁盘原样不动）')
  check(h.api.getCachedSelection('D:\\Mine') === null, '读选择镜像恒为空（真相在宿主文件里，不在本地）')

  const h2 = makeHarness(prefsSrc, { disk: { [TBL_LAYOUT]: JSON.stringify({ 'd:/other/window': 'multi' }) } })
  h2.api.setCachedSetupLayout('D:\\Mine', 'single')
  const t2 = tableOf(h2, TBL_LAYOUT)
  check(!!t2['d:/other/window'] && t2['d:/mine'] && t2['d:/mine'].layout === 'single', '布局表保留读-改-写（别的工作区那条留住）—— 实得 ' + JSON.stringify(t2))
  check(h2.api.getCachedSetupLayout('D:\\Mine') === 'single', '布局读得回来')
}

// ── B 布局写失败仍看得见 ────────────────────────────────────────────────────
console.log('')
console.log('== B 布局写失败记 storage.fail ==')
{
  const h = makeHarness(prefsSrc, { failKeys: [TBL_LAYOUT] })
  h.api.setCachedSetupLayout('D:\\X', 'single')
  const fail = h.logs.filter((l) => l.event === 'storage.fail')
  check(fail.length >= 1 && fail[0].fields && fail[0].fields.key === TBL_LAYOUT, '布局写失败记了一条 storage.fail —— 实得 ' + JSON.stringify(h.logs))
}

// ── C storage 监听仍在（为布局表），选择键不再合并 ───────────────────────────
console.log('')
console.log('== C 跨窗口合并只剩布局表 ==')
{
  const h = makeHarness(prefsSrc, {})
  check(h.handlers.some((x) => x.name === 'storage'), '登记了 storage 事件监听')
  h.disk[TBL_SEL] = JSON.stringify({ 'd:/other/window': { backendId: 'gitlab' } })
  fireStorage(h, TBL_SEL)
  check(h.api.getCachedSelection('D:/other/window') === null, '选择键的 storage 事件不再合并出选择（读恒为空）')
  h.disk[TBL_LAYOUT] = JSON.stringify({ 'd:/other/window': 'multi' })
  fireStorage(h, TBL_LAYOUT)
  check(h.api.getCachedSetupLayout('D:/other/window') === 'multi', '布局表跨窗口合并读得到')
}

// ── E 搬家只搬布局 ──────────────────────────────────────────────────────────
console.log('')
console.log('== E 搬家只搬布局，选择不搬 ==')
{
  const h = makeHarness(prefsSrc, {})
  h.api.setCachedSetupLayout('D:\\Repo\\Sub', 'multi')
  const moved = h.api.migrateCachedChoiceToKey('d:/repo/sub', 'd:/repo')
  check(moved === true, '布局从老键搬到根键（回 true）')
  check(h.api.getCachedSetupLayout('D:\\Repo') === 'multi', '根键上读得到布局')
  check(h.api.getCachedSelection('D:\\Repo') === null, '根键上没有选择（选择不搬）')
  check(h.api.migrateCachedChoiceToKey('d:/same', 'd:/same') === false, '同一个键不搬（回 false）')
}

// ── F 反证 ──────────────────────────────────────────────────────────────────
console.log('')
console.log('== F 反证：把实现做坏，对应的那几条必须当场红 ==')
const brokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-1003-mirror-'))
const loadBroken = function (tag: string, from: string, to: string): { bad?: string; src?: string } {
  if (!prefsSrc.includes(from)) return { bad: '这道反证的改法在真源里找不到落点（源文本已变）' }
  const file = path.join(brokenDir, tag + '.js')
  fs.writeFileSync(file, prefsSrc.replace(from, to), 'utf8')
  return { src: fs.readFileSync(file, 'utf8') }
}
{
  const b1 = loadBroken('sel-write-back', 'export const setCachedSelection = function (cwd, sel) {}', 'export const setCachedSelection = function (cwd, sel) { try { localStorage.setItem(SELECTION_BY_CWD_KEY, JSON.stringify(sel)) } catch (e) {} }')
  check(!b1.bad, '反证 F1 的改法能落地（把选择写盘加回去）' + (b1.bad ? ' —— ' + b1.bad : ''))
  if (b1.src) {
    const h = makeHarness(b1.src, {})
    h.api.setCachedSelection('D:\\Mine', { backendId: 'github' })
    check(!!h.disk[TBL_SEL], '反证 F1 成立：加回写盘之后磁盘又脏了 —— 说明 A 组量的就是“不写盘”')
  }
  const b2 = loadBroken('sel-read-back', 'export const getCachedSelection = function (cwd) { return null }', 'export const getCachedSelection = function (cwd) { return { backendId: "github" } }')
  check(!b2.bad, '反证 F2 的改法能落地（把选择读数加回去）' + (b2.bad ? ' —— ' + b2.bad : ''))
  if (b2.src) {
    const h = makeHarness(b2.src, {})
    check(h.api.getCachedSelection('D:\\Mine') !== null, '反证 F2 成立：加回读数之后读恒不为空 —— 说明 A 组量的就是“读恒空”')
  }
}

try { fs.rmSync(brokenDir, { recursive: true, force: true }) } catch (e) {}

console.log('')
console.log(failed ? '存在失败 — verify-683-mirror-write 未通过（' + passed + ' 项通过、' + failed + ' 项失败）' : '全部通过 — 选择镜像退役门禁生效（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
