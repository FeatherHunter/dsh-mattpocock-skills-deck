// tests/verify-1146-virtual-clock-liveness.ts —— 时间压缩助手：泵必须跟着「还有没有被引用的等待」活着（#1146）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1146-virtual-clock-liveness.ts
//
// 守的是什么（#1146 的现象）：真实事件循环上只有泵这一个句柄，所以「门禁会不会提前收摊、后面的断言还跑
// 不跑」只看泵有没有被引用。修复前的助手只在「重新装泵走到底」那条路上算一次引用状态，提前返回那一格会
// 把状态留在上一次的样子：泵一旦正停在 unref 上，之后进来的被引用等待（产品代码里普通的 setTimeout）就
// 拖不住事件循环，进程带着没跑完的等待自然收摊，**退出码还是 0**。
//
// 这一条把这个现场钉住：先排一笔不被引用的等待（产品侧 realSleep 的形状：排完立刻 unref），等它到点、
// 泵已经安顿在「队列里只剩不被引用的等待」之后，再排一笔**被引用**的等待（产品侧 withCap 那种普通
// setTimeout）。修复前：进程在第二笔跑到之前就收摊，它的回调一次都不执行；修复后：它必须跑到。
//
// 为什么非要在子进程里看：「提前收摊」是「进程没了」这件事本身，进程内观测不到（进程都没了）。
// 所以跑法是父进程起一个同文件的子进程，子进程把自己的进度写进临时文件，父进程读文件判定。
//
// 为什么子进程的输出必须写文件、绝不能走管道：管道本身是一个被引用的 Socket，它会替子进程吊住事件循环，
// 于是「提前收摊」这件事永远不会发生，这条门禁会变成一条恒绿的空门禁。同理子进程的 stdio 一律丢掉。
//
// 自检（C2 那条）：另跑一次「跑到一半就自己退出」的子进程，用来证明「文件里没有 C-FIRED」真的是
// 「进程提前收摊」的证据，而不是「这条判据本来就永远看不到那个字样」。没有这一条，本门禁自己也可能是假的。
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SELF_REL = 'tests/verify-1146-virtual-clock-liveness.ts'

/** 父进程起子进程时用的两个环境变量：跑哪个场景、进度写到哪。 */
const ENV_MODE = 'DSH_1146_CHILD'
const ENV_OUT = 'DSH_1146_OUT'

/** 子进程场景：live = 正常现场（修复前必须缺 C-FIRED）；cut = 跑到一半自己退出（自检用）。 */
type ChildMode = 'live' | 'cut'

/**
 * 子进程那一半：在真事件循环上摆出「泵停在 unref 上、之后又来一笔被引用的等待」这个现场。
 * 一切输出都自己写文件（原因见文件头），不用 console。
 */
function runChild(mode: ChildMode, out: string): void {
  const write = (line: string): void => {
    appendFileSync(out, line + '\n')
  }
  try {
    const requireHere = createRequire(import.meta.url)
    const helper = requireHere('./lib/time-compress.js') as {
      installTimeCompression: (opts?: { maxDelayMs?: number }) => unknown
      uninstallTimeCompression: () => boolean
    }
    helper.installTimeCompression()

    // 第一笔：不被引用的等待。产品侧 src/deck/shell/call-shell.ts 的 realSleep 就是这个形状——
    // 排完立刻 unref（#1114：只为到点提醒的定时器不许决定进程活多久）。
    const first = setTimeout(() => {
      write('A-FIRED')
      if (mode === 'cut') {
        // 自检场景：A 跑完就自己收摊，模拟「后面那笔没跑到」的样子。
        write('CHILD-CUT')
        process.exit(0)
      }
      // 第二笔：被引用的等待，产品侧 withCap 那种普通 setTimeout。它到达时，泵正停在 unref 上
      // （上一笔到点后的重装发现队列里只剩不被引用的等待，于是把新泵 unref 掉了）。
      // 修复前：这一次排入跳过了引用状态的同步，进程当场收摊，下面的回调一次都不执行。
      setTimeout(() => {
        write('C-FIRED')
        // 收尾：卸载后还挂着的等待会以 0 延时的真实定时器尽快放完，进程随后自然退出。
        helper.uninstallTimeCompression()
        write('CHILD-END')
      }, 200)
    }, 10)
    first.unref()

    // 第三笔：不被引用的长等待，用来把泵压在「队列里只剩不被引用的等待」这个状态上。
    const second = setTimeout(() => {
      write('B-FIRED')
    }, 200)
    second.unref()
  } catch (e) {
    write('CHILD-CRASH ' + String((e && (e as Error).stack) || e))
    process.exit(1)
  }
}

/** 父进程那一半：起一个子进程跑一个场景，把它写下的进度读回来。 */
function runScenario(mode: ChildMode, tmpDir: string): { status: number | null; text: string } {
  const out = join(tmpDir, mode + '.log')
  writeFileSync(out, '')
  const run = spawnSync(process.execPath, ['--import', './scripts/ts-hook.mts', SELF_REL], {
    cwd: ROOT,
    env: { ...process.env, [ENV_MODE]: mode, [ENV_OUT]: out },
    // stdio 一律丢掉：管道会替子进程吊住事件循环，把要观测的「提前收摊」抹掉（见文件头）。
    stdio: 'ignore',
    timeout: 60_000,
  })
  const text = existsSync(out) ? readFileSync(out, 'utf8') : ''
  return { status: run.status, text: text }
}

let failed = 0
let total = 0
const check = (ok: boolean, msg: string): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

/** 把子进程写下的进度整理成一眼能看的样子，判红时好定位。 */
const show = (text: string): string => {
  const lines = text.split(/\r?\n/).filter(Boolean)
  return lines.length ? lines.join(' ／ ') : '（子进程什么都没写）'
}

const childMode = process.env[ENV_MODE]
const childOut = process.env[ENV_OUT]
if (childMode === 'live' || childMode === 'cut') {
  runChild(childMode, String(childOut))
} else {
  const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-1146-'))
  try {
    // C1：正常现场——被引用的等待必须在「泵已停在 unref 上」之后仍然跑到。
    const live = runScenario('live', tmpDir)
    const liveText = live.text
    check(live.status === 0, 'C1 子进程退出码是 0（实际 ' + String(live.status) + '）')
    check(liveText.includes('A-FIRED'), 'C1 第一笔（不被引用的等待）跑到了：' + show(liveText))
    check(
      liveText.includes('C-FIRED'),
      'C1 后到的被引用等待跑到了（修复前这里必红：它拖不住事件循环，进程带着它收摊）',
    )
    check(
      liveText.includes('CHILD-END'),
      'C1 子进程自己打出了收尾标记 CHILD-END（没被提前掐断）：' + show(liveText),
    )

    // C2：观测机制自检——「跑到一半收摊」时，文件里确实只留得下收摊前那几行。
    const cut = runScenario('cut', tmpDir)
    const cutText = cut.text
    check(cutText.includes('A-FIRED') && cutText.includes('CHILD-CUT'), 'C2 自检子进程确实跑到了「收摊」这一步：' + show(cutText))
    check(
      !cutText.includes('C-FIRED'),
      'C2 提前收摊时 C-FIRED 不会出现（证明这条判据真的分得出「跑了」与「没跑」）',
    )
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch (e) {
      check(false, '临时目录清理失败 ' + tmpDir + '：' + String((e && (e as Error).message) || e))
    }
  }

  console.log('时间压缩助手存活门禁：' + (total - Number(Boolean(failed))) + '/' + total + ' 条通过')
  if (failed) process.exit(1)
}
