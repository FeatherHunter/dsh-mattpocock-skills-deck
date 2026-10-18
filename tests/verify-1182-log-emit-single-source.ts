/**
 * tests/verify-1182-log-emit-single-source.ts —— 记日志那层壳只许有一份（#1182 第 3 件）。
 *
 * 为什么要这一条：日志出口在三个房间里各抄了一遍 —— `read-log.ts` 三份、`write-log.ts` 两份，
 * 再加上各处「先看 ctx 有没有 logEvent、再 try/catch 包一层」的发射壳。抄一份的成本不只是行数：
 * 改动要改 N 处、N 处会各自漂移，而漂移的那一处恰恰是出事时最需要它准的地方。
 * #1182 把这份同形机制收进房外的 `src/tracker/kernel/log-emit.ts`（跨房 import 被 cross-room-import
 * 规则禁止，所以它住在 kernel 这一层），各房只留下「级别 + 事件名 + 字段」。
 *
 * 这道门禁断四件事：
 *   一、**房里不许再有手写发射壳**：`typeof x.logEvent === 'function'` 这种写法在房间里一次都不许出现。
 *   二、**调 logEvent 的房内文件必须走内核那一份**：文件里出现 `.logEvent(` 就必须从 `kernel/log-emit.js`
 *       import 过 `guardEmit`（逐个文件两向对账，而不是只看总数）。
 *   三、**内核那一份的四件都在、都有房内用户**：`guardEmit` / `ms` / `outcomeOf` / `debugOn` 四个导出
 *       都要真的从内核导出，且各自至少被一个房内文件 import —— 守的是「有人把公共件又抄回房里，
 *       内核那份变成没人用的孤儿」。
 *   四、**同形复制反向断言**：房里不许再各自声明 `ms` / `outcomeOf` / `failReason` / 本地 `guardEmit`。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1182-log-emit-single-source.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = process.cwd()
const ROOMS = path.join(ROOT, 'src/tracker/rooms')
const KERNEL_EMIT = path.join(ROOT, 'src/tracker/kernel/log-emit.ts')

let failed = false
const check = (ok: boolean, msg: string) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

/** 房内所有手写 .ts（构建产物不在这里；rooms 下没有派生文件）。 */
function roomFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      const st = fs.statSync(full)
      if (st.isDirectory()) walk(full)
      else if (name.endsWith('.ts')) out.push(full)
    }
  }
  walk(ROOMS)
  return out.sort()
}

/** 从「谁 import 了 kernel/log-emit.js」那一行里取出名字清单（只认这一份公共件的对口 import）。 */
function kernelImports(text: string): string[] {
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'\.\.\/\.\.\/kernel\/log-emit\.js'/g
  const names: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    for (const raw of m[1].split(',')) {
      const n = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
      if (n) names.push(n)
    }
  }
  return names
}

const files = roomFiles()
const rel = (f: string): string => f.replace(ROOT + path.sep, '').replace(/\\/g, '/')

console.log('== 一、房里不许再有手写的发射壳 ==')
const shellRe = /typeof\s+[\w.$]+\s*\.\s*logEvent\s*[!=]==?\s*'function'/
const shells: string[] = []
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (shellRe.test(line)) shells.push(rel(f) + ':' + (i + 1))
  })
}
check(shells.length === 0, '房里没有 typeof … logEvent === \'function\' 的手写壳 → 命中 ' + JSON.stringify(shells))

console.log('== 二、调 logEvent 的房内文件都要走内核那一份 ==')
const callers: string[] = []
const noImport: string[] = []
const importedNames = new Set<string>()
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8')
  for (const n of kernelImports(text)) importedNames.add(n)
  if (!/\.logEvent\s*\(/.test(text)) continue
  callers.push(rel(f))
  if (kernelImports(text).indexOf('guardEmit') < 0) noImport.push(rel(f))
}
check(callers.length >= 10, '房里调 logEvent 的文件都数得出来（至少 10 份）→ 实得 ' + callers.length + ' 份')
check(noImport.length === 0, '调 logEvent 的房内文件都 import 过 guardEmit → 漏的 ' + JSON.stringify(noImport))

console.log('== 三、内核那一份的四件都在、都有房内用户 ==')
const kernelText = fs.readFileSync(KERNEL_EMIT, 'utf8')
for (const name of ['guardEmit', 'ms', 'outcomeOf', 'debugOn']) {
  const exported = new RegExp('export\\s+(?:async\\s+)?function\\s+' + name + '\\b').test(kernelText)
  check(exported, '内核 log-emit.ts 导出了 ' + name)
  check(importedNames.has(name), '至少有房内文件 import 了内核的 ' + name + ' → 实得用户数 ' +
    files.filter((f) => kernelImports(fs.readFileSync(f, 'utf8')).indexOf(name) >= 0).length)
}

console.log('== 四、房里不许再各自声明这几个公共件 ==')
const localDecl = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(ms|outcomeOf|failReason|guardEmit)\s*\(/
const dup: string[] = []
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (localDecl.test('\n' + line)) dup.push(rel(f) + ':' + (i + 1) + ' ' + line.trim().slice(0, 60))
  })
}
check(dup.length === 0, '房里没有 ms / outcomeOf / failReason / guardEmit 的本地声明 → 命中 ' + JSON.stringify(dup))

console.log('')
if (failed) {
  console.log('存在失败 — verify-1182-log-emit-single-source 未通过')
  process.exitCode = 1
} else {
  console.log('全部通过 — 记日志那层壳在房里只剩调用点，机制只有内核一份')
}
