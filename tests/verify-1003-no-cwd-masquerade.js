#!/usr/bin/env node
/**
 * verify-1003-no-cwd-masquerade.js —— 「拿不到工作区目录时，不许拿进程目录冒充」这条不变式的门禁。
 *
 * 依据：#1003 实施契约的期望行为第 9 条，以及维护者 2026-10-12 对第 3 个问题的拍板（选 A：同期收掉）。
 * 为什么单独立一扇：兜底值一旦回到「进程自己的目录」，缺目录的调用会静默落到一条真实存在的、
 * 别人的目录上——读会在错的仓库里读，写会在错的仓库里写，而且**不报错**，最难查。
 *
 * 钉三件事：
 *   ① 兜底值本身不再取进程目录（静态读源码那一行）；
 *   ② 凭据 git 出口（真会执行 git 的那一条）在空目录上如实失败，且一次都没有起进程；有目录时照常执行（对照）；
 *   ③ gh 出口在空目录上如实失败，且起进程那一处不再拿兜底值顶上（静态钉住）。
 *
 * 用法：node tests/verify-1003-no-cwd-masquerade.js
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
let passed = 0
let failed = 0
const check = (ok, msg) => { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }

console.log('== ① 兜底值本身：不许再取进程自己的目录 ==')
{
  const src = read('src/host/index.js')
  const defLine = src.split(/\r?\n/).find((l) => /const DEFAULT_CWD =/.test(l)) || ''
  check(/const DEFAULT_CWD = ''/.test(defLine), '宿主兜底值是空串（不是进程目录）—— 实得：' + defLine.trim())
  check(!/process\.cwd\(\)/.test(defLine), '那一行里不再出现 process.cwd()（兜底值不再指向任何真实目录）')
}

console.log('')
console.log('== ② 凭据 git 出口：空目录如实失败，且一次都没起进程 ==')
{
  const mod = await imp('src/host/gitCredentialExec.js')
  const calls = []
  const runGit = async function (exe, cwd, argv) { calls.push({ exe, cwd, argv }); return { kind: 'ok', stdout: 'ok', truncated: false } }
  const deps = {
    runGit,
    getPlatform: async () => ({ resolveExecutable: async () => '/usr/bin/git' }),
    getEnv: () => ({}),
    DEFAULT_CWD: '',
  }
  const safe = mod.createCredentialSafeGit(deps)

  const empty = await safe.runOnce({ args: ['status'], cwd: '' })
  check(empty && empty.ok === false, '空目录：如实失败（不返回成功）—— 实得 ' + JSON.stringify(empty))
  check(empty && empty.kind === 'cwd', '空目录：失败原因是「没有工作区目录」这一档 —— 实得 kind=' + (empty && empty.kind))
  check(calls.length === 0, '空目录：一次都没有起 git 进程（不拿进程目录顶上）—— 实得起了 ' + calls.length + ' 次')

  const blank = await safe.runOnce({ args: ['status'], cwd: '   ' })
  check(blank && blank.ok === false && calls.length === 0, '只有空白字符的目录：同样如实失败且不起进程')

  const withDir = await safe.runOnce({ args: ['status'], cwd: 'D:\\ws' })
  check(withDir && withDir.ok === true, '对照：有目录时照常执行（说明上面两条拦的就是「缺目录」，不是把功能整个关掉）')
  check(calls.length === 1 && calls[0].cwd === 'D:\\ws', '对照：这一趟确实带着那个目录起了进程 —— 实得 cwd=' + (calls[0] && calls[0].cwd))
}

console.log('')
console.log('== ③ gh 出口：空目录如实失败，起进程那一处不再拿兜底值顶上 ==')
{
  const src = read('src/host/repoKeys.js')
  const hasGuard = /这个工作区还没就绪（还没认出是哪个目录），所以这一次没有执行任何 gh 命令/.test(src)
  check(hasGuard, 'gh 出口里有一段「拿不到目录就如实失败」的早返回')
  const guardBeforeLane = /async function runGh\(args, cwd\) \{[\s\S]{0,900}?还没就绪[\s\S]{0,900}?getGhLane\(\)\.acquire/.test(src)
  check(guardBeforeLane, '那段早返回在拿命令名额之前（这一笔没有出站，不该占名额）')
  const spawnFallback = /cwd:\s*cwd\s*\|\|\s*DEFAULT_CWD/.test(src)
  check(!spawnFallback, '起进程那一处不再写「cwd 缺省就回退兜底值」')
}

console.log('')
console.log(failed ? '存在失败 — 空目录冒充不变式没守住（' + passed + ' 项通过、' + failed + ' 项失败）' : '全部通过 — 空目录不许冒充工作区（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
