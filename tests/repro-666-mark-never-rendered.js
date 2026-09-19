#!/usr/bin/env node
/**
 * repro-666-mark-never-rendered.js —— 复现 #666 并证明修好的那一版真能画出来
 *
 * 这个脚本把「修复前」与「修复后」的同一枚标志放同一条环境里各渲染一次，用渲染出来的 DOM 说话：
 *
 *   旧版（#653 落地的那一版，按提交从 git 里取，不是手抄）：读会话状态上的 st.workspaceRoot。
 *     这个字段在客户端里没有任何地方赋过值 → 渲染结果里没有那枚标志（这就是票面说的「一次都没亮过」）。
 *   新版（当前源码）：读面板正在显示的那份快照 st.snapshot.workspaceRoot → 渲染结果里有那枚标志，
 *     点击区 18 像素、aria-label 三句拼一句、点一下调 wf.openFolder 打开工作区根。
 *
 * 为什么单独写一个脚本、而不并进门禁：门禁要长期稳定地跑，依赖 git 历史会脆；这里只为留一份
 * 「旧版确实不亮、新版确实亮」的现场证据。长期守住这件事的判据在 tests/verify-666-subws-mark-root.js 的 E 组。
 *
 * 用法：node tests/repro-666-mark-never-rendered.js
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { renderMark, ROOT } = require('./lib/render-subws-mark.js')

const MARK_REL = 'src/client/views/SubworkspaceMark.js'
const FIX_COMMIT = '9665735'
const ROOT_DIR = 'D:\\ilife'
const SUB_DIR = 'D:\\ilife\\packages\\skill-calorie'

let failures = 0
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

async function main() {
  console.log('=== #666 复现：旧版那枚标志为什么不亮；新版为什么亮 ===')

  const nowSrc = fs.readFileSync(path.join(ROOT, MARK_REL), 'utf8')

  // 旧版：按提交从 git 里取（9665735 是 #666 的修复提交，取它的父提交）
  let oldSrc = ''
  let oldTag = ''
  let oldIsReal = true
  try {
    oldSrc = execFileSync('git', ['show', FIX_COMMIT + '^:' + MARK_REL], { cwd: ROOT, encoding: 'utf8' })
    oldTag = FIX_COMMIT + '^'
  } catch (e) {
    // 没有 git 历史（例如只拿到一份源码快照）时退回「按旧写法现造一版」；判据不变，但这一次不算独立证据。
    oldSrc = nowSrc.replace(/const root = subwsMarkRootOf\(st\)/, 'const root = (st && st.workspaceRoot) || null')
    oldTag = '（无 git 历史，按旧写法现造）'
    oldIsReal = false
  }
  if (oldSrc === nowSrc) {
    check(false, '取到的旧版与新版源码一样，这次对照不成立')
    return
  }

  // 会话状态：所选目录是子目录，面板正在显示的那份快照带着工作区根。
  const subSt = { cwd: SUB_DIR, snapshot: { ok: true, maps: [], workspaceRoot: ROOT_DIR } }
  // 而「旧版读的那个字段」—— 客户端里没有任何地方写过它，所以这里就是没有。
  check(!('workspaceRoot' in subSt), '本脚本喂进去的会话状态里没有旧版读的那个字段')
  // 顺带核一句：客户端源码里到底有没有人写它（这才是「没人写」那句断言的证据）
  const clientFiles = []
  ;(function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (ent.name.endsWith('.js')) clientFiles.push(full)
    }
  })(path.join(ROOT, 'src/client'))
  const writers = clientFiles.filter(function (f) {
    const src = fs.readFileSync(f, 'utf8')
    return /\.workspaceRoot\s*=/.test(src) || /st\.workspaceRoot\s*=/.test(src)
  })
  check(writers.length === 0, '客户端源码里确实没有一处给会话状态写 st.workspaceRoot（实得 ' + writers.length + ' 处）')

  console.log('\nA) 修复前：把这份会话状态喂给旧版组件（' + oldTag + '）')
  const oldRes = await renderMark(subSt, { src: oldSrc })
  check(oldRes.isSub === false, '旧版渲染结果里没有那枚标志（复现成功：它从来没亮过）')
  check(oldRes.html.trim() === '', '旧版整段渲染为空（组件直接返回 null）：' + JSON.stringify(oldRes.html.slice(0, 80)))

  console.log('\nB) 修复后：同一份会话状态喂给当前组件')
  const newRes = await renderMark(subSt, { click: true })
  check(newRes.isSub === true, '新版渲染结果里有那枚标志')
  check(/width="13"/.test(newRes.html) && /height="13"/.test(newRes.html), '里面那枚图标是 #650 定稿的 13×13 绘制')
  check(/width: ?18px/.test(newRes.html) && /height: ?18px/.test(newRes.html), '标志的点击区是 18 像素（#650 定的尺寸）')
  check(/aria-label="[^"]*面板数据来自工作区 D:\\ilife[^"]*"/.test(newRes.html), 'aria-label 念得出「面板数据来自工作区 D:\\ilife」')
  check(/aria-label="[^"]*当前目录是它的子目录：packages › skill-calorie[^"]*"/.test(newRes.html), 'aria-label 念得出相对关系，且用 › 连、不吐反斜杠')

  console.log('\nC) 反向：换成根目录会话（所选目录就是工作区根）')
  const rootRes = await renderMark({ cwd: ROOT_DIR, snapshot: { ok: true, maps: [], workspaceRoot: ROOT_DIR } })
  check(rootRes.isSub === false, '根会话里新版不画这枚标志：' + JSON.stringify(rootRes.html.slice(0, 80)))

  console.log('\nD) 点击：真的点一下，看它调的是不是宿主打开文件夹那条电话')
  check(newRes.hasLink === true, '标志外面那圈链接渲染出来了（点它才是「打开工作区根」）')
  const call = newRes.hostCalls[0]
  check(!!call && call.method === 'wf.openFolder' && call.args && call.args.cwd === ROOT_DIR,
    '点一下调的是 wf.openFolder，参数 cwd 是工作区根；实测 ' + JSON.stringify(newRes.hostCalls))

  console.log(failures ? '\n=== FAIL（' + failures + ' 项没守住） ===' : '\n=== PASS（新版已验；旧版取自 ' + oldTag + (oldIsReal ? '） ===' : '，不算独立复现证据） ==='))
  process.exit(failures ? 1 : 0)
}

main().catch(function (e) {
  console.log('  FAIL 脚本异常：' + ((e && e.stack) || e))
  process.exit(1)
})
