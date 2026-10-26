// tests/lib/child-probe.ts —— 「父进程起同文件的子进程、子进程把进度写临时文件」的公共骨架
//
// 为什么要有这个文件：有些现象只能在进程外面看 —— 例如「工具调用结束之后，进程还要多久才退出」
// （#1114）或者「一笔还没结算的等待还剩几个人在等时，进程会不会提前收摊」（#1157）。
// 两扇门禁原先各自抄了一份逐字相同的父进程骨架，改一处得想着另一处；#1114 第二批把这段收在这里。
//
// 约定（照抄两份原实现的现场经验，不要图省事改掉）：
//   1. 子进程的 stdio 一律丢掉。管道本身是一个被引用的 Socket，它会替子进程吊住事件循环，
//      把「进程该退出却没退出」这个要观测的现象抹平，门禁于是变成一条恒绿的空判据。
//   2. 子进程把进度写进临时文件，父进程读文件判定；不用 stdout 回传，原因同上。
//   3. 父进程用 spawnSync 等子进程自然结束，自己带一个兜底 timeout（默认 60 秒），
//      免得子进程真的卡死时整条门禁被拖住。
//
// 两个门禁各自决定「跑哪个场景」：子进程用一组环境变量（ENV_MODE、ENV_OUT）认领任务，
// 这两个名字由调用方给，因为 #1114 与 #1157 的旧现场就是各用各的。
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓库根目录（本文件住在 tests/lib/，往上两级就是仓库根）。 */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** 跑一个子进程场景的入参。 */
export interface ChildScenarioOptions {
  /** 要跑的那份门禁文件相对仓库根的路径，例如 'tests/verify-1114-timer-exit.ts'。 */
  selfRel: string
  /** 跑哪个场景；原样写进 ENV_MODE。 */
  mode: string
  /** 临时目录；子进程的进度写进 <临时目录>/<场景名>.log。 */
  tmpDir: string
  /** 认领场景的环境变量名（两份门禁用不同的名字，沿用各自旧现场）。 */
  envMode: string
  /** 收进度文件路径的环境变量名。 */
  envOut: string
  /** 父进程等子进程的兜底时长；缺省 60 秒。 */
  timeoutMs?: number
}

/** 一次子进程场景的结果：退出码、写下的进度、父进程量到的墙钟毫秒数。 */
export interface ChildScenario {
  status: number | null
  text: string
  wallMs: number
}

/**
 * 起一个子进程跑一个场景，把它写下的进度读回来。
 * 子进程用的是「同一个解释器 + 同一个 .ts 装载钩子 + 同一个文件」，所以父进程与子进程
 * 看到的是同一份实现；场景靠环境变量分开。
 */
export function runChildScenario(opts: ChildScenarioOptions): ChildScenario {
  const out = join(opts.tmpDir, opts.mode + '.log')
  writeFileSync(out, '')
  const started = Date.now()
  const run = spawnSync(process.execPath, ['--import', './scripts/ts-hook.mts', opts.selfRel], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { [opts.envMode]: opts.mode, [opts.envOut]: out }),
    // stdio 一律丢掉：管道会替子进程吊住事件循环，把要观测的「提前收摊 / 晚退出」抹掉（见文件头）。
    stdio: 'ignore',
    timeout: opts.timeoutMs || 60_000,
  })
  const text = existsSync(out) ? readFileSync(out, 'utf8') : ''
  return { status: run.status, text: text, wallMs: Date.now() - started }
}

/** 从子进程写下的进度里取一行；取不到回空串。 */
export function lineOf(text: string, name: string): string {
  const hit = text.split(/\r?\n/).find(function (l) { return l.startsWith(name + ' ') })
  return hit ? hit.slice(name.length + 1).trim() : ''
}

/** 把某一行的 JSON 读出来；没有这一行、或者不是合法 JSON 时回 null，由断言如实判红。 */
export function jsonOf(text: string, name: string): unknown {
  const raw = lineOf(text, name)
  if (!raw) return null
  try { return JSON.parse(raw) } catch (e) { return null }
}

/** 把子进程写下的进度整理成一眼能看的样子，判红时一屏看完。 */
export function show(text: string): string {
  return text.split(/\r?\n/).filter(Boolean).join(' ／ ') || '（子进程什么都没写）'
}
