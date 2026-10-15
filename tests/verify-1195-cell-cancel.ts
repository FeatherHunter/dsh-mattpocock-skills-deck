// verify-1195-cell-cancel.ts —— #1195 第二件门禁：同进程快路传取消信号、有上限。
// 用法：在插件根目录执行 node tests/verify-1195-cell-cancel.ts，可独立运行。
//
// 为什么要这一段：代执行的同进程快路（共享格里宿主装好的实现）曾经无上限地等宿主跑完，
// 调用方的取消信号也传不进去 —— 调用方走了，宿主那边还在跑，跑完的值还可能被用掉。
// 现在快路把取消信号传给宿主实现，并给单次运行加上限（缺省与注册侧单次上限同值）：
// 调用方中止或到上限时停用这次回包、走下一路，迟到的值一律不用。本文件钉住三层：
//   ① 调用方中途中止 → 宿主实现收到中止、当次回包被停用、事后没有残留写。
//   ② 宿主实现一直不回 → 到上限（测试点名 200 毫秒）就走下一路，不无限等。
//   ③ 宿主实现立刻回 → 原样采用（快路不断）。
// 本文件不联网：直连与同源两路在测试里都不通（空上下文、无服务），最后落到诚实占位。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

// 假宿主实现：只在信号没中止时才写。wrote 记“中止之后还写了没有”。
function fakeHost(delayMs) {
  const rec = { sawSignal: false, wrote: false, aborted: false }
  const run = async (execLike, args) => {
    const sig = execLike && execLike.signal
    rec.sawSignal = !!(sig && typeof sig.addEventListener === 'function')
    if (sig && sig.aborted) { rec.aborted = true; throw new Error('aborted-already') }
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        if (sig && sig.aborted) { rec.aborted = true; reject(new Error('aborted')); return }
        rec.wrote = true
        resolve(null)
      }, delayMs)
      if (sig && typeof sig.addEventListener === 'function') {
        sig.addEventListener('abort', () => { clearTimeout(t); rec.aborted = true; reject(new Error('aborted')) }, { once: true })
      }
    })
    return { status: 'ok', text: '宿主做了' }
  }
  return { run: run, rec: rec }
}

async function main() {
  console.log('1195 快路取消门禁（传取消信号、有上限、无残留写）')
  const rowMod = await imp('src/deck/registration/agent-row.ts')
  const cellMod = await imp('src/deck/shell/table-cell.ts')

  // 表里装一个分发器：每轮测试换行为，不重装表。
  let current = fakeHost(10)
  cellMod.publishDeckTable(Promise.resolve({ tools: { deck_context: { run: (e, a) => current.run(e, a) } } }))
  const table = await cellMod.awaitDeckTable(2000)
  check(!!(table && table.tools && table.tools.deck_context), '共享格装表成功')

  // ① 调用方中途中止：宿主收到中止、当次回包停用、事后无残留写
  {
    current = fakeHost(5000)
    const exec = rowMod.makeDelegatedExecute('deck_context', {}, {})
    const caller = new AbortController()
    const execCtx = { agent: { session: { cwd: 'D:/demo', id: 's-1' } }, signal: caller.signal }
    const p = exec({}, execCtx)
    setTimeout(() => { try { caller.abort() } catch (e) {} }, 50)
    const t0 = Date.now()
    const r = await p
    const dt = Date.now() - t0
    check(current.rec.sawSignal === true, '宿主实现拿到了可订阅的取消信号')
    check(current.rec.wrote === false, '中止后宿主没有残留写')
    check(!(r && r.text === '宿主做了'), '中止那次回包被停用、走了下一路')
    check(dt < 2000, '中止后很快脱身、不干等宿主（实耗 ' + dt + ' 毫秒）')
  }

  // ② 宿主一直不回：到上限就走下一路
  {
    current = fakeHost(5000)
    const exec = rowMod.makeDelegatedExecute('deck_context', {}, { cellRunTimeoutMs: 200 })
    const execCtx = { agent: { session: { cwd: 'D:/demo', id: 's-1' } } }
    const t0 = Date.now()
    const r = await exec({}, execCtx)
    const dt = Date.now() - t0
    check(current.rec.sawSignal === true, '上限那次宿主实现同样拿到取消信号')
    check(dt < 2000, '到上限就走下一路、不无限等（实耗 ' + dt + ' 毫秒）')
    check(!(r && r.text === '宿主做了'), '超时那次回包被停用、走了下一路')
    await new Promise((resolve) => setTimeout(resolve, 100))
    check(current.rec.wrote === false, '超时后宿主的迟到值不用（无残留写）')
  }

  // ③ 快路不断：宿主立刻回就原样采用
  {
    current = fakeHost(10)
    const exec = rowMod.makeDelegatedExecute('deck_context', {}, {})
    const execCtx = { agent: { session: { cwd: 'D:/demo', id: 's-1' } } }
    const r = await exec({}, execCtx)
    check(r && r.text === '宿主做了', '宿主立刻回时原样采用快路回包')
  }

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
