#!/usr/bin/env node
/**
 * verify-client-no-undef.js — 产物里不许出现「叫不出名字的调用」（#669 真机现场的真凶就是这么一个名字）
 *
 * 为什么要有一道这样的门：#669 那一件（真机原话「在某个全新工作区一直操作到 /setup 黄条时点击了黄条后，
 *   整个胶囊状态栏全部消失了」）查到最后，真凶是状态栏那张初始化小卡在「后端名单还没到」这一档调用了一个
 *   **从来没有定义过**的函数（`supportedBackendViews`，2026-09-21 之前 `src/` 里只有调用处，没有实现）。
 *   它平时一点事都没有：只有那条兜底路径真的被走到（点黄条、名单还没回来）才会抛 ReferenceError，
 *   而渲染里抛错会把整条状态栏从界面上摘掉 —— 用户看到的就是「胶囊整条没了」。
 *   构建那道门只做语法与装载器特征，人眼走查也只会看正常路径，所以这一类名字能一直躺在产物里。
 *
 * 做法：拿 TypeScript 编译器（devDependency，已装）对每个产物的真源做一次**只读**检查，
 *   只挑「找不到名字」这一类诊断（TS2304 / TS2552），把已知的两种情形列成白名单，其余一律报红。
 *   白名单只有两类，各自都写清为什么：宿主提供的全局、以及调用处带 typeof 保护的可选依赖。
 *
 * 用法：node tests/verify-client-no-undef.js
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..')
const FILES = process.argv.slice(2).length ? process.argv.slice(2) : ['client.js', 'package/lib/client.js', 'host.js', 'package/lib/index.js']

// 白名单：在产物里「找不到名字」但确实没问题的那两类。新增条目必须写明理由。
const ALLOWED = {
  ReactDOM: '宿主外壳提供的全局（seam 那份 shim 在浏览器里用它；与 React 同一个来源）',
  isNewPlaceholderTitle: '选配依赖：调用处一律写成 typeof isNewPlaceholderTitle === "function" ? 用它 : 走回退，取不到也不会抛',
}

let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// 只读扫一遍：返回 [{ name, file, line }]（同一名字同一文件只报第一条，够定位）
const undefinedNamesOf = function (file) {
  const program = ts.createProgram([file], {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
    skipLibCheck: true,
    types: [],
    noResolve: true,
  })
  const diags = ts.getPreEmitDiagnostics(program)
  const out = []
  const seen = new Set()
  for (const d of diags) {
    if (d.code !== 2304 && d.code !== 2552) continue
    const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ')
    const m = msg.match(/Cannot find name '([^']+)'/)
    if (!m) continue
    const name = m[1]
    if (seen.has(name)) continue
    seen.add(name)
    let line = 0
    try { if (d.file && d.start != null) line = d.file.getLineAndCharacterOfPosition(d.start).line + 1 } catch (e) {}
    out.push({ name: name, file: file, line: line })
  }
  return out
}

console.log('== 逐个产物：有没有「叫不出名字的调用」 ==')
for (const rel of FILES) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) { check(false, rel + '：产物不存在（先跑 node scripts/build.mjs）'); continue }
  let found = []
  try { found = undefinedNamesOf(abs) } catch (e) { check(false, rel + '：检查过程本身出错 — ' + ((e && e.message) || e)); continue }
  const bad = found.filter((f) => !ALLOWED[f.name])
  const okOnes = found.filter((f) => ALLOWED[f.name])
  for (const f of okOnes) console.log('    （白名单）' + rel + ':' + f.line + ' 的 ' + f.name + ' —— ' + ALLOWED[f.name])
  check(bad.length === 0, rel + '：产物里每个被调用的名字都能在真源里找到定义' +
    (bad.length ? '（这些找不到：' + bad.map((b) => b.name + ' @' + b.line).join('、') + '）' : '（找不到的 0 个）'))
}

console.log('')
console.log('== 反证：往产物里塞一个叫不出名字的调用，这道门必须当场变红 ==')
{
  const src = fs.readFileSync(path.join(ROOT, FILES[0]), 'utf8')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws-undef-'))
  const probe = path.join(dir, 'client-probe.js')
  // 塞在最前面即可：这一份是 module 工厂体，顶层多一句调用不会影响语法解析。
  fs.writeFileSync(probe, ';__dswsUndefProbe__(1);\n' + src, 'utf8')
  let got = []
  try { got = undefinedNamesOf(probe) } catch (e) { got = [] }
  check(got.some((g) => g.name === '__dswsUndefProbe__'), '反证成立：塞进去的那个名字被当场报出来（实得 ' + JSON.stringify(got.map((g) => g.name).slice(0, 5)) + '）')
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {}
}

console.log('')
console.log(failed ? 'FAIL ' + total + ' 项里有过不去的' : 'PASS 全部 ' + total + ' 项检查通过')
process.exit(failed ? 1 : 0)
