// tests/verify-host-log-slot-single-source.ts —— 宿主日志槽只定义一处（#1620）
// 门禁归属: src/shared/host-log-slot.ts
//
// 为什么要有这一扇：宿主把日志库挂在 globalThis 的一个固定键上，供不能 import 宿主模块的登记层
// 按约定读取。键值、槽形状、读取方式从前在入口、登记层与测试里各写一份；改一处漏一处，日志会
// 悄悄流向另一个格子，不报错，要等下次排查时才发现少了一行（#1620 记录的现象）。现在它们都住在
// src/shared/host-log-slot.ts，这一扇从两个面盯着「只剩一处」：
//   ① 静态面：src 下只有定义模块出现键值字面量；别的文件一次都不许有，拆成两段拼出来的也算
//      （按 'host_log' 片段查）。允许清单外的命中当场红。
//   ② 行为面：读取函数在四种情形下的回值——槽缺失、p 不是 Promise、p 拒绝、p 解析出日志库——
//      分别是 null、null、null、原样返回；读取本身不建槽、不抛错。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-host-log-slot-single-source.ts
// 只按退出码收尾，不交 GATE-RESULT（#1620 交接要求：不登记 completionRecord，避免编期望数）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const SLOT_MODULE = 'src/shared/host-log-slot.ts'
// 分诊时记下的旧键：这里再写一遍是故意的——改键时会同时惊动门禁与使用方。它不是给运行时代码的
// 第二份拷贝：宿主、登记层、测试运行时都只从 SLOT_MODULE 取。
const KEY_LITERAL = '__dsh_mattskillsdeck_host_log__'
const KEY_FRAGMENT = 'host_log'
const SKIP_DIRS = new Set(['node_modules', '.build', 'package'])

let passed = 0
let failed = 0
function check(ok, message) {
  if (ok) { passed += 1; console.log('  PASS ' + message) }
  else { failed += 1; console.log('  FAIL ' + message) }
}
function countOf(text, needle) {
  let hits = 0
  let at = text.indexOf(needle)
  while (at >= 0) { hits += 1; at = text.indexOf(needle, at + needle.length) }
  return hits
}
function walk(absDir, prefix, out) {
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const rel = prefix ? prefix + '/' + entry.name : entry.name
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(path.join(absDir, entry.name), rel, out)
      continue
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue
    out.push({ rel: rel, abs: path.join(absDir, entry.name) })
  }
  return out
}
/** 对一棵已经收集好的文件树做「键只许在定义模块出现一次」的判定，返回定义模块命中数与违规列表。 */
function inspect(files, defRel) {
  let moduleHits = 0
  const offenders = []
  for (const file of files) {
    const text = fs.readFileSync(file.abs, 'utf8')
    const keyHits = countOf(text, KEY_LITERAL)
    if (file.rel === defRel) moduleHits = keyHits
    else if (keyHits > 0) offenders.push(file.rel + '（' + keyHits + ' 处键值字面量）')
    // 拆成两段拼接也抓：片段只该出现在定义模块里（定义模块的键值本身含这个片段）。
    const fragHits = countOf(text, KEY_FRAGMENT)
    if (file.rel !== defRel && fragHits > 0) offenders.push(file.rel + "（" + fragHits + " 处 'host_log' 片段，可能是拼接键）")
  }
  return { moduleHits: moduleHits, offenders: offenders }
}

async function main() {
  // ── ① 静态面：src 下只有定义模块写这个键 ──
  const files = walk(path.join(ROOT, 'src'), 'src', [])
  check(files.length > 100, '扫到 src 下的 TypeScript 文件（' + files.length + ' 份）')
  const scanned = inspect(files, SLOT_MODULE)
  check(scanned.moduleHits === 1, '定义模块恰好写一次键值字面量（实得 ' + scanned.moduleHits + ' 处）')
  check(scanned.offenders.length === 0, '别处没有第二份键或拼接片段（违规 ' + scanned.offenders.length + ' 处' + (scanned.offenders.length ? '：' + scanned.offenders.join('、') : '') + '）')

  // ── ①b 负向自检：换一棵树，把同样的键写进第二个文件，静态面必须报红（原型建在临时目录，跑完即删） ──
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-host-log-slot-'))
  try {
    fs.writeFileSync(path.join(tmpRoot, 'def.ts'), 'export const K = ' + JSON.stringify(KEY_LITERAL) + '\n')
    fs.writeFileSync(path.join(tmpRoot, 'copy.ts'), 'export const K2 = ' + JSON.stringify(KEY_LITERAL) + '\n')
    const planted = inspect(walk(tmpRoot, '', []), 'def.ts')
    const caught = planted.moduleHits === 1 && planted.offenders.some(function (line) { return line.indexOf('copy.ts') === 0 })
    check(caught, '负向自检：同样的键写进第二个文件时静态面会判红')
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }

  // ── ② 行为面：读不到就是 null，读到就原样返回 ──
  const slotMod = await import(pathToFileURL(path.join(ROOT, SLOT_MODULE)).href)
  check(slotMod.HOST_LOG_SLOT === KEY_LITERAL, '导出的键值就是分诊时记下的旧键')
  const slotKey = slotMod.HOST_LOG_SLOT
  const g = globalThis
  const previous = g[slotKey]
  delete g[slotKey]
  try {
    const missing = await slotMod.readHostLogStore()
    check(missing === null, '槽缺失时读回 null（不抛错）')
    check(g[slotKey] === undefined, '读一次不会顺手把空槽建出来（建槽是宿主的事）')

    const slot = slotMod.ensureHostLogSlot()
    check(g[slotKey] === slot && slot.p === null && slot.hd === false && slot.svc === null, '缺槽时 ensure 建出带默认值的槽')
    check(slotMod.ensureHostLogSlot() === slot, '重复取槽拿到同一份对象（同一进程一份）')

    slot.p = 'not-a-promise'
    check((await slotMod.readHostLogStore()) === null, 'p 不是 Promise 时读回 null')

    slot.p = Promise.reject(new Error('日志库加载失败'))
    check((await slotMod.readHostLogStore()) === null, 'p 拒绝时读回 null（失败不逃逸）')

    const store = { isEnabled: function () { return true }, log: function () {} }
    slot.p = Promise.resolve(store)
    check((await slotMod.readHostLogStore()) === store, 'p 解析出日志库时原样返回')
  } finally {
    delete g[slotKey]
    if (previous !== undefined) g[slotKey] = previous
  }

  console.log('\n' + passed + ' 条断言，' + (failed ? '失败' : '通过'))
  if (failed) { console.log('存在失败 — verify-host-log-slot-single-source 未通过'); process.exitCode = 1 }
  else { console.log('全部通过 — 宿主日志槽只定义一处，读不到就安静回 null') }
}
main().catch(function (e) { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exitCode = 1 })
