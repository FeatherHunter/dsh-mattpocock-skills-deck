// prepare-batch —— 用当前 HEAD 重新冻结候选，并把这批验证的起点一次准备好。
//
// 为什么要有这条命令：以前开一批验证要人依次跑冻结、构建、打包、装隔离 home、起实例、巡检，
// 中间任何一步用了旧产物或旧候选，整批证据就说不清在验什么。这里把「从当前源码到可以开始验」
// 收成一条命令，并在每一步核对候选身份；任一环节不成立就停下，不产生 batch.json。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/prepare-batch.mts
//         [--batch <批次名或批次目录>] [--name <批次名>]
//         [--ticket <来源票号>] [--allow-dirty]
//         [--profile <profile>] [--install-method extract|cli] [--no-start] [--no-ui] [--timeout <毫秒>]
//
// 产物：
//   <批次>/pkg/candidate.json   候选清单（含提交、validity、fileDigest、buildCommit）
//   <批次>/batch.json           批次记录（从这里开始，后面的证据都绑定到它）
//   <批次>/home                 隔离的 DSH home
//   <批次>/run                  实例启动目录（--no-start 时没有）
//   <批次>/batch-preflight.json 前置巡检结论
//
// 默认批次目录是 <验证工作根>/batches/<批次名>；不给名字时用 batch-<时间戳>。
// 场景执行不在这条命令里：实例起好后由人按清单票逐条验，证据用 collect-evidence 收。
// 批次结束时跑 check-batch；HEAD 前进了这一批会标成 stale，不能用于发布收口。

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import {
  assertBatchName,
  batchIdentityLine,
  createBatchRecord,
  evidenceCandidate,
  judgeCandidateForBatch,
  readCandidateFile,
  writeBatch,
} from '../lib/batch.mts'
import { probeSettingsIsolation } from '../lib/isolation.mts'
import { findInstalledPackage, gitState } from '../lib/candidate.mts'
import { startInstance } from '../lib/launch.mts'
import { assertWritableTarget, batchDir, realDshHome, repo, resolveBatchPath, workRoot } from '../lib/paths.mts'
import { assert, ensureDir, exists, info, isEmptyDir, nowIso, parseArgs, printJson, runCli, stamp, writeJson } from '../lib/util.mts'

function tail(text: string, limit = 4000): string {
  return text.length > limit ? text.slice(-limit) : text
}

function findClientSha(candidate: { package?: { files?: { path: string; sha256: string }[] } }): string | null {
  const files = candidate.package && candidate.package.files ? candidate.package.files : []
  const entry = files.find((item) => item.path === 'lib/client.js')
  return entry ? entry.sha256 : null
}

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const startedAt = nowIso()
  const repository = repo()
  const profile = args.get('profile') || 'web'
  const installMethod = args.get('install-method') || 'extract'
  assert(
    installMethod === 'extract' || installMethod === 'cli',
    '--install-method 只能是 extract 或 cli：prepare-batch 要把候选装进隔离 home，none 不能用来开批次。',
  )
  const explicitBatch = args.get('batch')
  const explicitName = args.get('name')
  let targetDir: string
  let batchName: string
  if (explicitBatch) {
    targetDir = resolveBatchPath(explicitBatch)
    batchName = path.basename(targetDir)
    if (explicitName && explicitName !== batchName) {
      throw new Error('--batch 指向「' + batchName + '」，--name 却是「' + explicitName + '」：两个参数只能给一个，或给成同一个名字。')
    }
  } else {
    batchName = assertBatchName(explicitName || 'batch-' + stamp())
    targetDir = batchDir(batchName)
  }
  const batchStartedAt = startedAt
  assertWritableTarget(targetDir)
  if (exists(targetDir)) {
    const hasBatch = exists(path.join(targetDir, 'batch.json'))
    if (hasBatch || !isEmptyDir(targetDir)) {
      throw new Error(
        '批次目录「' + targetDir + '」已经有内容' + (hasBatch ? '（含 batch.json）' : '') + '：' +
          '一个批次目录只代表一批，不能复用。换一个批次名（--batch <新名字>）重新开始。',
      )
    }
  }
  ensureDir(targetDir)
  const candidateOut = path.join(targetDir, 'pkg')
  const home = path.join(targetDir, 'home')
  const runDir = path.join(targetDir, 'run')
  const timeoutMs = args.get('timeout') ? Number(args.get('timeout')) : undefined
  const headAtStart = gitState(repository)

  // 1. 用当前 HEAD 重新冻结候选。所有参数原样交给 freeze-candidate：构建、打包、装 home、界面核对都在那边，
  //    这里只负责把输出放进本批次目录，并在冻结完成后再验一次候选身份。
  const freezeScript = path.join(repository, 'scripts', 'real-machine', 'commands', 'freeze-candidate.mts')
  const freezeArgs = [
    '--import',
    './scripts/ts-hook.mts',
    path.relative(repository, freezeScript),
    '--out',
    candidateOut,
    '--home',
    home,
    '--install-method',
    installMethod,
    '--profile',
    profile,
  ]
  if (args.get('ticket')) freezeArgs.push('--ticket', String(args.get('ticket')))
  if (args.has('allow-dirty')) freezeArgs.push('--allow-dirty')
  if (args.has('no-ui')) freezeArgs.push('--no-ui')
  if (args.get('timeout')) freezeArgs.push('--timeout', String(args.get('timeout')))
  info('开始批次 ' + batchName + '：先冻结当前 HEAD 的候选……')
  const frozen = spawnSync(process.execPath, freezeArgs, { cwd: repository, encoding: 'utf8', timeout: timeoutMs })
  if (frozen.error) throw new Error('冻结候选失败（进程起不来）：' + frozen.error.message)
  if (frozen.status !== 0) {
    throw new Error(
      '冻结候选失败（退出码 ' + String(frozen.status) + '）：\n' +
        tail(String(frozen.stderr || '')) +
        '\n批次目录里可能留下半成品：换一个批次名重来，或先人工确认「' + targetDir + '」里没有要保留的东西。',
    )
  }
  const candidatePath = path.join(candidateOut, 'candidate.json')
  const candidate = readCandidateFile(candidatePath)
  // 冻结是几十秒到几分钟的活：这期间 HEAD 可能被别人切换、工作树可能被人改脏。
  // 只有冻结结束后再读一次代码状态，才能说这个候选确实是从「这一批开始时的源码」做出来的。
  const headAfterFreeze = gitState(repository)
  if (headAfterFreeze.commit !== headAtStart.commit) {
    throw new Error(
      '冻结期间代码前进了：批次开始时 HEAD 是 ' + headAtStart.commit + '，冻结完成时是 ' + headAfterFreeze.commit +
        '。这一批的候选说不清是从哪份源码做出来的，换一个批次名重来。',
    )
  }
  const verdict = judgeCandidateForBatch({
    candidatePath,
    candidate,
    batchDir: targetDir,
    batchStartedAt,
    currentHead: headAfterFreeze.commit,
  })
  if (!verdict.ok) {
    throw new Error('冻结出来的候选不能作为本批次的起点：\n  ' + verdict.problems.join('\n  '))
  }
  if (verdict.validity === 'release' && headAfterFreeze.dirtyFiles.length > 0) {
    throw new Error(
      '这是 release 候选，但冻结完成时工作树有 ' + headAfterFreeze.dirtyFiles.length +
        ' 个未提交改动：发布候选必须来自干净工作树，先把改动提交或收起来再重新开批次。',
    )
  }
  if (verdict.validity === 'development') {
    info('注意：这是 development 候选（工作树不干净），只能用于开发验证，不能进发布收口。')
  }

  const record = createBatchRecord({
    batchName,
    batchDir: targetDir,
    now: startedAt,
    git: { commit: verdict.identity.commit, branch: String(candidate.manifest.git?.branch || '') },
  })
  record.candidate = verdict.identity
  writeBatch(targetDir, record, nowIso())

  // 2. 起实例（除非明确只准备不启动）。实例留在后台，人接着在上面逐条验。
  const checks: { name: string; ok: boolean; detail: string }[] = []
  let instance: Record<string, any> | null = null
  let instanceError = ''
  if (args.has('no-start')) {
    info('--no-start：不启动实例，只完成候选与隔离 home。')
  } else {
    try {
      const started = await startInstance({ home, dir: runDir, profile, timeoutMs })
      instance = {
        ok: true,
        pid: started.pid,
        port: started.port,
        tokenUrl: started.tokenUrl,
        originUrl: started.originUrl,
        readyMs: started.readyMs,
        startedAt: started.startedAt,
        stdoutPath: started.stdoutPath,
        stderrPath: started.stderrPath,
        pluginLogDir: started.pluginLogDir,
        pluginLogFile: started.pluginLogFile,
      }
      checks.push({ name: '实例可达', ok: true, detail: '端口 ' + started.port + '，启动耗时 ' + started.readyMs + ' 毫秒。' })
    } catch (error: any) {
      instanceError = String(error && error.message ? error.message : error)
      instance = { ok: false, error: instanceError }
      checks.push({ name: '实例可达', ok: false, detail: instanceError })
      info('实例启动失败：' + instanceError)
    }
  }

  // 3. 前置巡检：装进去的东西必须自证是这份候选，设置隔离必须成立。
  //    这些结论不替代逐条场景验证，只保证「开始验之前，环境与候选是干净的」。
  const installed = findInstalledPackage(home, profile, 'dsh-mattpocock-skills-deck')
  const expectedClientSha = findClientSha(candidate.manifest)
  if (installed) {
    checks.push({
      name: '已装插件版本等于候选版本',
      ok: installed.version === verdict.identity.version,
      detail: '已装 ' + installed.version + '，候选 ' + verdict.identity.version + '。',
    })
    checks.push({
      name: '已装 lib/client.js 与候选清单一致',
      ok: Boolean(expectedClientSha && installed.clientSha256 === expectedClientSha),
      detail: expectedClientSha
        ? '已装 ' + installed.clientSha256.slice(0, 12) + '，候选清单 ' + expectedClientSha.slice(0, 12) + '。'
        : '候选清单里找不到 lib/client.js。',
    })
  } else {
    checks.push({ name: '已装插件版本等于候选版本', ok: false, detail: '隔离 home 里找不到插件目录：' + home })
  }
  let isolation: any = null
  try {
    isolation = await probeSettingsIsolation({ batchDir: targetDir, realHome: realDshHome() })
    checks.push({ name: '设置文件隔离探针', ok: Boolean(isolation.ok), detail: String(isolation.reason || '') })
  } catch (error: any) {
    isolation = { ok: false, reason: String(error && error.message ? error.message : error) }
    checks.push({ name: '设置文件隔离探针', ok: false, detail: String(isolation.reason) })
  }
  const preflight = {
    checkedAt: nowIso(),
    ok: checks.every((entry) => entry.ok),
    candidate: {
      path: verdict.identity.path,
      sha256: verdict.identity.sha256,
      commit: verdict.identity.commit,
      version: verdict.identity.version,
      validity: verdict.identity.validity,
      fileDigest: verdict.identity.fileDigest,
    },
    instance,
    checks,
    isolation,
  }
  writeJson(path.join(targetDir, 'batch-preflight.json'), preflight)
  record.preflight = preflight as unknown as Record<string, any>
  record.instance = instance
  const saved = writeBatch(targetDir, record, nowIso())

  const binding = evidenceCandidate(saved)
  assert(binding, '批次记录里没有候选身份：这是内部错误，停止继续。')
  const identityLine = batchIdentityLine(binding)
  printJson({
    ok: Boolean(preflight.ok) && !instanceError,
    batchName,
    batchDir: targetDir,
    batchJson: path.join(targetDir, 'batch.json'),
    candidate: saved.candidate,
    instance,
    preflight: { ok: preflight.ok, checks },
    identityLine,
    nextSteps: [
      '把 identityLine 原样写进批次开始评论（批次号、环境、场景清单也写清楚）。',
      '每条场景结果评论都带同一行 identityLine；证据用 collect-evidence --batch ' + batchName + ' 收。',
      '批次结束跑 check-batch --batch ' + batchName + '；HEAD 前进会标 stale，不能用于发布收口。',
    ],
  })
  if (!preflight.ok || instanceError) process.exitCode = 1
})
