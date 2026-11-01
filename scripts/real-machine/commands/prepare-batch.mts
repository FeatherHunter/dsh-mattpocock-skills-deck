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
//         [--base-ref <基线分支，默认 main>] [--allow-outdated-base]
//         [--instance-env-file <环境文件路径>]
//
// 开批前必须能证明两件事（#1777）：候选提交包含本地基线分支（默认 main）的 tip——这一批验的是最新代码；
// 候选版本等于基线分支 package.json 的版本——这一批验的是这次要发布的版本。不成立就拒绝开批；
// --allow-outdated-base 只放行前者且只用于开发验证，--allow-dirty 不能绕过版本核对。
//
// 产物：
//   <批次>/pkg/candidate.json   候选清单（含提交、validity、fileDigest、buildCommit）
//   <批次>/batch.json           批次记录（从这里开始，后面的证据都绑定到它）
//   <批次>/home                 隔离的 DSH home
//   <批次>/run                  实例启动目录（--no-start 时没有）
//   <批次>/batch-preflight.json 前置巡检结论
//
// 批次 profile 的默认模型会在准备时配成 MiniMax CN（provider minimax-cn、模型 Minimax-M3.1-Flash），
// 密钥从批次 home、真实 home 的 .credentials.yaml 或当前进程环境取，只注入实例，不落盘、不进回执。
// 模型名与密钥变量名可用 DSH_REAL_MACHINE_MODEL* 三个环境变量覆盖。
//
// 默认批次目录是 <验证工作根>/batches/<批次名>；不给名字时用 batch-<时间戳>。
// 场景执行不在这条命令里：实例起好后由人按清单票逐条验，证据用 collect-evidence 收。
// 批次结束时跑 check-batch；HEAD 前进了这一批会标成 stale，不能用于发布收口。

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import {
  assertBatchName,
  batchBaseLine,
  batchIdentityLine,
  createBatchRecord,
  evidenceCandidate,
  judgeCandidateForBatch,
  readCandidateFile,
  writeBatch,
} from '../lib/batch.mts'
import { loadInstanceEnvFile, type InstanceEnvFile } from '../lib/envfile.mts'
import { probeSettingsIsolation } from '../lib/isolation.mts'
import { findInstalledPackage, gitContains, gitState, readLocalBaseline } from '../lib/candidate.mts'
import { startInstance } from '../lib/launch.mts'
import { credentialSourceLabel, ensureLaunchModel } from '../lib/model.mts'
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
  // 开批基线与环境文件都在动手之前验：路径写错、基线落后时要立刻停，不要先花几分钟构建。
  const baseRef = String(args.get('base-ref') || 'main')
  const allowOutdatedBase = args.has('allow-outdated-base')
  const instanceEnvFileArg = args.get('instance-env-file')
  let instanceEnv: InstanceEnvFile | null = null
  if (instanceEnvFileArg) {
    instanceEnv = loadInstanceEnvFile(String(instanceEnvFileArg))
    info('实例环境文件：' + instanceEnv.file + '（注入变量：' + instanceEnv.names.join('、') + '；值不输出）')
  }
  const baseline = readLocalBaseline(repository, baseRef)
  info('开批基线：本地 ' + baseline.ref + ' ' + baseline.tip + '，目标版本 ' + baseline.expectedVersion)
  const headAtStart = gitState(repository)
  if (!gitContains(repository, baseline.tip, headAtStart.commit)) {
    if (!allowOutdatedBase) {
      throw new Error(
        '当前 HEAD ' + headAtStart.commit + ' 不包含本地 ' + baseline.ref + ' 的 tip ' + baseline.tip +
          '：这一批会验证落后于最新代码的版本。先把 ' + baseline.ref + ' 合进当前分支再开批；' +
          '只在开发验证里可以加 --allow-outdated-base 放行（放行的批次 check-batch 会标 stale，不能用于发布收口）。',
      )
    }
    info('注意：--allow-outdated-base 放行了「候选不包含基线 tip」，这一批只能做开发验证，不能用于发布收口。')
  }
  ensureDir(targetDir)
  const candidateOut = path.join(targetDir, 'pkg')
  const home = path.join(targetDir, 'home')
  const runDir = path.join(targetDir, 'run')
  const timeoutMs = args.get('timeout') ? Number(args.get('timeout')) : undefined

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
    repository,
    baseline: {
      ref: baseline.ref,
      tip: baseline.tip,
      expectedVersion: baseline.expectedVersion,
      allowOutdated: allowOutdatedBase,
    },
  })
  if (!verdict.ok) {
    throw new Error('冻结出来的候选不能作为本批次的起点：\n  ' + verdict.problems.join('\n  '))
  }
  if (verdict.outdatedBase) {
    info('注意：候选没有包含基线 ' + baseline.ref + ' 的 tip，--allow-outdated-base 已放行；这一批只能做开发验证。')
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
    base: {
      ref: baseline.ref,
      tip: baseline.tip,
      expectedVersion: baseline.expectedVersion,
      allowOutdated: verdict.outdatedBase,
    },
  })
  record.candidate = verdict.identity
  // batch.json 先不落盘：等实例与前置巡检都通过再写。否则一个巡检失败的半成品批次
  // 会以 status=active 留在盘上，后面 collect-evidence 还得再拦一次；不如让「没有 batch.json」
  // 直接表示这一批没准备好。

  // 1.5 模型：freeze-candidate 复制 home 时已经写过一次；这里再确保一次并解析密钥，
  // 让「模型配好了、密钥找得到」成为前置巡检的硬检查，而不是等实例里第一次调用模型才失败。
  const modelRuntime = ensureLaunchModel({ home, profile })

  // 2. 起实例（除非明确只准备不启动）。实例留在后台，人接着在上面逐条验。
  const checks: { name: string; ok: boolean; detail: string }[] = []
  let instance: Record<string, any> | null = null
  let instanceError = ''
  if (args.has('no-start')) {
    info('--no-start：不启动实例，只完成候选与隔离 home。')
  } else {
    try {
      // 环境文件路径原样交给 startInstance：它负责解析与注入，prepare-batch 只记路径与变量名，不碰值。
      const startOptions: any = { home, dir: runDir, profile, timeoutMs }
      if (instanceEnv) startOptions.envFile = instanceEnv.file
      if (modelRuntime.selection) startOptions.model = modelRuntime.selection
      const started = await startInstance(startOptions)
      const injectedEnvNames = started.envFileNames ?? []
      instance = {
        ok: true,
        envFile: started.envFile,
        envFileNames: injectedEnvNames,
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
        model: started.model,
      }
      checks.push({ name: '实例可达', ok: true, detail: '端口 ' + started.port + '，启动耗时 ' + started.readyMs + ' 毫秒。' })
      if (instanceEnv) {
        checks.push({
          name: '实例环境文件已注入',
          ok: injectedEnvNames.length > 0,
          detail: '注入变量：' + (injectedEnvNames.join('、') || '无') + '（值不输出）。',
        })
      }
    } catch (error: any) {
      instanceError = String(error && error.message ? error.message : error)
      instance = { ok: false, error: instanceError }
      checks.push({ name: '实例可达', ok: false, detail: instanceError })
      info('实例启动失败：' + instanceError)
    }
  }

  // 2.5 模型检查：批次必须真的能调用模型。只报 provider/模型名/密钥来源，不报密钥值。
  const modelReport = modelRuntime.report
  checks.push({
    name: '模型已配置',
    ok: modelReport.profileConfigured,
    detail: modelReport.profileConfigured
      ? String(modelReport.provider) + '/' + String(modelReport.model) + '；profile 文件与期望一致。'
      : String(modelReport.profileReason || 'profile 里的模型配置与期望不一致。'),
  })
  checks.push({
    name: '模型密钥可用',
    ok: modelReport.credentialAvailable,
    detail: modelReport.credentialAvailable
      ? '变量 ' + String(modelReport.apiKeyEnv) + '，来源 ' + credentialSourceLabel(modelReport.credentialSource) + '（值不输出）。'
      : String(modelReport.error || '没有找到模型密钥。'),
  })

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
    base: {
      ref: baseline.ref,
      tip: baseline.tip,
      expectedVersion: baseline.expectedVersion,
      allowOutdated: verdict.outdatedBase,
    },
    candidate: {
      path: verdict.identity.path,
      sha256: verdict.identity.sha256,
      commit: verdict.identity.commit,
      version: verdict.identity.version,
      validity: verdict.identity.validity,
      fileDigest: verdict.identity.fileDigest,
    },
    // 环境文件只记路径与变量名：值可能是 token，任何输出与落盘文件都不许出现。
    envFile: instanceEnv ? { file: instanceEnv.file, names: instanceEnv.names, secretNames: instanceEnv.secretNames } : null,
    model: modelReport,
    instance,
    checks,
    isolation,
  }
  writeJson(path.join(targetDir, 'batch-preflight.json'), preflight)
  record.preflight = preflight as unknown as Record<string, any>
  record.instance = instance

  const passed = Boolean(preflight.ok) && !instanceError
  const preparedBinding = evidenceCandidate(record)
  assert(preparedBinding, '批次记录里没有候选身份：这是内部错误，停止继续。')
  if (!passed) {
    // 不写 batch.json：这一批还没准备好，不能开始收证据。候选、巡检结论与日志都留在目录里供排查；
    // 修好环境后换一个批次名重新开批（目录已占用，不复用）。
    printJson({
      ok: false,
      batchName,
      batchDir: targetDir,
      batchJson: null,
      base: record.base,
      candidate: record.candidate,
      instance,
      preflight: { ok: preflight.ok, checks },
      identityLine: batchIdentityLine(preparedBinding),
      baseLine: batchBaseLine(record.base),
      error:
        '前置巡检没有通过' + (instanceError ? '（实例启动失败：' + instanceError + '）' : '') +
        '：没有写 batch.json，这一批不能开始收证据。按 batch-preflight.json 的检查项修好环境后换一个批次名重来。',
      nextSteps: [],
    })
    process.exitCode = 1
    return
  }

  const saved = writeBatch(targetDir, record, nowIso())
  const binding = evidenceCandidate(saved)
  assert(binding, '批次记录里没有候选身份：这是内部错误，停止继续。')
  const identityLine = batchIdentityLine(binding)
  printJson({
    ok: true,
    batchName,
    batchDir: targetDir,
    batchJson: path.join(targetDir, 'batch.json'),
    base: saved.base,
    candidate: saved.candidate,
    instance,
    preflight: { ok: preflight.ok, checks },
    identityLine,
    baseLine: batchBaseLine(saved.base),
    nextSteps: [
      '把 identityLine 与 baseLine 一起原样写进批次开始评论（批次号、环境、场景清单也写清楚）。',
      '每条场景结果评论都带同一行 identityLine；证据用 collect-evidence --batch ' + batchName + ' 收。',
      '批次结束跑 check-batch --batch ' + batchName + '；HEAD 或本地基线前进会标 stale，不能用于发布收口。',
    ],
  })
})
