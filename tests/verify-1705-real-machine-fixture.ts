// tests/verify-1705-real-machine-fixture.ts —— #1705「黑盒测试夹具」的自证门禁。
//
// 这扇门禁不 import 工具台命令的任何内部函数，也不读命令源码文本；它只按执行会话的样子
// 起子进程（同一个 node 入口、同一份 ts-hook、同一组参数），再读 stdout 的那段 JSON、
// 退出码与文件副作用。这正是规格 #1703 定下的唯一测试接缝，后续 #1706-#1711 的门禁照抄它的用法。
//
// 跑法：
//   node --import ./scripts/ts-hook.mts tests/verify-1705-real-machine-fixture.ts
//   node --import ./scripts/ts-hook.mts tests/verify-1705-real-machine-fixture.ts --negative
// 正例退出码 0；--negative 走负例通道：真的起子进程跑一条会成功的命令，然后故意把期望写错，
// 证明这扇门禁的断言能红（不是删掉断言换来的红）。正例收尾还会起一份 --negative 子门禁自检，
// 这样负例本身也进了每次全链的判据。

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  REPO_ROOT,
  HOST_ENV_KEYS,
  createRealMachineHarness,
  samePath,
} from './lib/real-machine-process.ts'
import { printGateResult, scanGateResult } from './lib/gate-result.ts'

const GATE = 'verify-1705-real-machine-fixture'
const SELF_REL = 'tests/verify-1705-real-machine-fixture.ts'
const NEGATIVE = process.argv.includes('--negative')

let passed = 0
let failed = 0

/** 一条断言：通过的只留一行；失败的把可定位的现场整段缩进打出来，供人直接照着查。 */
function check(ok: boolean, message: string, detail?: string): void {
  if (ok) {
    passed += 1
    console.log('  PASS ' + message)
    return
  }
  failed += 1
  console.log('  FAIL ' + message)
  if (!detail) return
  const lines = String(detail).split(/\r?\n/)
  const shown = lines.slice(0, 80)
  for (const line of shown) console.log('       | ' + line)
  if (lines.length > shown.length) console.log('       | …（还有 ' + (lines.length - shown.length) + ' 行没打出来）')
}

/** 宿主环境快照：夹具只该改子进程的 env，不该动本进程的 env。 */
function snapshotHostEnv(): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const key of HOST_ENV_KEYS) out[key] = process.env[key] ?? null
  return out
}

function diffEnv(before: Record<string, string | null>, after: Record<string, string | null>): string {
  const lines: string[] = []
  for (const key of Object.keys(before)) {
    if (before[key] !== after[key]) lines.push(key + '：' + JSON.stringify(before[key]) + ' → ' + JSON.stringify(after[key]))
  }
  return lines.join('\n')
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

/** 负例：起一条真的会成功的命令，然后故意把两处期望写错，让断言红、门禁退出码非 0。 */
function runNegative(harness: ReturnType<typeof createRealMachineHarness>): void {
  const lockDir = path.join(harness.workRoot, 'global.lock')
  const run = harness.runCommand('global-lock', { args: ['--lock', lockDir, '--purpose', 'verify-1705-negative'] })
  const json = asRecord(run.json)
  check(
    run.exitCode === 1,
    '[负例] 故意把一条成功命令的退出码期望成 1：这条断言必须红',
    harness.formatFailure(run),
  )
  check(
    json !== null && String(json.lockDir) === path.join(harness.workRoot, '并不存在的锁目录'),
    '[负例] 故意把回执里的 lockDir 期望成另一个路径：这条断言必须红',
    harness.formatFailure(run),
  )
}

async function main(): Promise<void> {
  const hostBefore = snapshotHostEnv()
  const harness = createRealMachineHarness({ name: 'verify-1705' })
  try {
    console.log('临时工作根：' + harness.workRoot)

    if (NEGATIVE) {
      runNegative(harness)
    } else {
      // ── A. 工具台命令的进程接口：global-lock 拿锁 ──────────────────────────────
      const lockDir = path.join(harness.workRoot, 'global.lock')
      const acquire = harness.runCommand('global-lock', { args: ['--lock', lockDir, '--purpose', 'verify-1705'] })
      check(acquire.exitCode === 0, 'A1 global-lock 拿锁：退出码 0', harness.formatFailure(acquire))
      check(acquire.jsonError === '', 'A2 成功时 stdout 是单段可解析的 JSON', harness.formatFailure(acquire))
      const acquireJson = asRecord(acquire.json)
      check(
        acquireJson !== null && samePath(String(acquireJson.lockDir), lockDir),
        'A3 回执里的 lockDir 就是传进去的锁目录',
        harness.formatFailure(acquire),
      )
      check(
        acquireJson !== null && samePath(String(acquireJson.ownerPath), path.join(lockDir, 'owner.json')),
        'A4 回执里的 ownerPath 指向锁目录下的 owner.json',
        harness.formatFailure(acquire),
      )
      check(harness.exists('global.lock/owner.json'), 'A5 受控文件副作用：锁目录下真的写下了 owner.json', harness.formatFailure(acquire))
      const owner = asRecord(harness.readJson('global.lock/owner.json'))
      check(owner !== null && owner.purpose === 'verify-1705', 'A6 owner.json 里记着这次拿锁的用途', harness.formatFailure(acquire))

      // ── B. 失败路径：重复拿锁必须非 0 退出 + 中文 stderr ──────────────────────
      const duplicate = harness.runCommand('global-lock', { args: ['--lock', lockDir, '--purpose', 'verify-1705-dup'] })
      check(duplicate.exitCode !== null && duplicate.exitCode !== 0, 'B1 重复拿锁：退出码非 0', harness.formatFailure(duplicate))
      check(duplicate.stdout.trim() === '', 'B2 失败时 stdout 是空的（JSON 只留给成功那一路）', harness.formatFailure(duplicate))
      check(duplicate.stderr.includes('全局锁已被占用'), 'B3 失败时 stderr 说清是全局锁已被占用', harness.formatFailure(duplicate))

      // ── C. 释放锁：跨进程释放会被 owner pid 校验拒绝，锁目录不在时给出原因 ─────
      // 锁是上面那个子进程拿的，owner.json 里的 pid 与这次释放的进程不是同一个；命令按约定
      // 拒绝跨进程释放（交回一段 JSON、退出码仍是 0），测试只断言这条能观察到的行为。
      const release = harness.runCommand('global-lock', { args: ['--lock', lockDir, '--release'] })
      const releaseJson = asRecord(release.json)
      check(
        release.exitCode === 0 && releaseJson !== null && releaseJson.released === false,
        'C1 别的进程持锁时释放：退出码 0 且回执 released=false（命令把拒绝当正常结果）',
        harness.formatFailure(release),
      )
      check(
        releaseJson !== null &&
          String(releaseJson.reason || '').includes('锁的 owner 是 pid') &&
          String(releaseJson.reason || '').includes('不是当前进程'),
        'C2 拒绝原因说清锁的 owner 是另一个进程',
        harness.formatFailure(release),
      )
      // 测试自己把锁目录删掉（模拟「锁已经没了的现场」），再让命令释放一次。
      harness.removePath('global.lock')
      const releaseAgain = harness.runCommand('global-lock', { args: ['--lock', lockDir, '--release'] })
      const releaseAgainJson = asRecord(releaseAgain.json)
      check(
        releaseAgain.exitCode === 0 && releaseAgainJson !== null && releaseAgainJson.released === false,
        'C3 锁目录不在时释放：退出码 0 且回执 released=false',
        harness.formatFailure(releaseAgain),
      )
      check(
        releaseAgainJson !== null && String(releaseAgainJson.reason || '').includes('锁目录不存在'),
        'C4 该情况下回执写清原因（锁目录不存在）',
        harness.formatFailure(releaseAgain),
      )

      // ── D. 缺参数时的失败输出，以及把差异拼成一屏的 formatFailure ─────────────
      const missing = harness.runCommand('global-lock', { args: [] })
      check(missing.exitCode === 1, 'D1 缺 --lock 时退出码 1', harness.formatFailure(missing))
      check(missing.stdout.trim() === '', 'D2 缺参数时不往 stdout 打半截 JSON', harness.formatFailure(missing))
      check(missing.stderr.includes('缺少参数 --lock') && missing.stderr.includes('锁目录'), 'D3 stderr 指出缺的是哪个参数、该给什么', harness.formatFailure(missing))
      const failureText = harness.formatFailure(missing, '期望退出码 0')
      check(
        failureText.includes('退出码：1') && failureText.includes('命令：') && failureText.includes('缺少参数 --lock') && failureText.includes('期望退出码 0'),
        'D4 formatFailure 拼出的差异能直接定位（命令、退出码、stderr、期望都齐）',
        failureText,
      )

      // ── E. 第二条命令：copy-home（模板模式），读回执与复制出来的文件 ───────────
      const template = harness.createHomeTemplate()
      const home = path.join(harness.workRoot, 'batch-a', 'home')
      const copy = harness.runCommand('copy-home', { args: ['--template', template, '--home', home] })
      check(copy.exitCode === 0, 'E1 copy-home（模板模式）：退出码 0', harness.formatFailure(copy))
      const copyJson = asRecord(copy.json)
      check(
        copyJson !== null && samePath(String(copyJson.home), home) && copyJson.profile === 'web',
        'E2 copy-home 回执里的 home 与 profile 正确',
        harness.formatFailure(copy),
      )
      check(
        copyJson !== null && asRecord(copyJson.source) !== null && (asRecord(copyJson.source) as JsonRecord).kind === 'template',
        'E3 copy-home 回执记下来源是 home-template',
        harness.formatFailure(copy),
      )
      check(harness.exists('batch-a/home/copy-home.json'), 'E4 受控文件副作用：home 下写下了 copy-home.json', harness.listFiles())
      const receipt = asRecord(harness.readJson('batch-a/home/copy-home.json'))
      check(
        receipt !== null && receipt.profile === 'web' && asRecord(receipt.source) !== null,
        'E5 回执文件本身可回读，内容与 stdout 那份对得上',
        harness.listFiles(),
      )
      check(
        harness.readText('batch-a/home/profiles/web/settings.json') === '{"theme":"dark"}\n',
        'E6 复制出来的 profile 文件内容可回读',
        harness.listFiles(),
      )
      check(
        copyJson !== null && copyJson.files === 1,
        'E7 回执里的文件数与复制结果一致（旧日志已删，只剩 settings.json）',
        harness.formatFailure(copy),
      )
      check(
        copyJson !== null &&
          Array.isArray(copyJson.staleLogsRemoved) &&
          copyJson.staleLogsRemoved.length === 1 &&
          copyJson.staleLogsRemoved[0] === '2026-01-01.log' &&
          !harness.exists('batch-a/home/profiles/web/.dsh-mattskillsdeck-cache/logs'),
        'E8 复制时删掉了旧日志目录，且回执记下了删掉的文件名',
        harness.formatFailure(copy),
      )

      // ── F. 隔离：子进程看到的是沙箱里的 home、临时目录、工作根与 PATH ──────────
      const probe = harness.runNode('tests/fixtures/real-machine/probe-env.mts')
      check(probe.exitCode === 0 && probe.jsonError === '' && probe.json !== null, 'F1 隔离探针命令跑通并输出单段 JSON', harness.formatFailure(probe))
      const probeEnv = asRecord(probe.json)
      check(probeEnv !== null && samePath(String(probeEnv.cwd), REPO_ROOT), 'F2 工具台命令从仓库根运行（与执行会话一致）', harness.formatFailure(probe))
      check(probeEnv !== null && samePath(String(probeEnv.homedir), harness.sandboxHome), 'F3 子进程的 home 已重定向进沙箱（不碰真实用户目录）', harness.formatFailure(probe))
      check(probeEnv !== null && samePath(String(probeEnv.tempDir), harness.tmpDir), 'F4 子进程的临时目录已重定向进沙箱', harness.formatFailure(probe))
      check(probeEnv !== null && samePath(String(probeEnv.dshVerifyWorkRoot), harness.workRoot), 'F5 子进程看到 DSH_VERIFY_WORK_ROOT 指向本次临时工作根', harness.formatFailure(probe))
      check(probeEnv !== null && samePath(String(probeEnv.dshRealHome), harness.sandboxDshHome), 'F6 子进程眼里的真实 DSH home 也在沙箱里（不碰真实 DSH 配置）', harness.formatFailure(probe))
      const probePath = probeEnv !== null && Array.isArray(probeEnv.pathEntries) ? (probeEnv.pathEntries as string[]) : []
      check(probePath.length > 0 && samePath(probePath[0], harness.binDir), 'F7 PATH 第一段就是假 glab 目录', harness.formatFailure(probe))
      check(probeEnv !== null && samePath(String(probeEnv.glabBin), harness.glabBin), 'F8 GLAB_BIN 指向假 glab 命令', harness.formatFailure(probe))

      // ── G. 假 glab：按计划回话、记录 argv 与 cwd、调用顺序可断言 ───────────────
      harness.writeGlabPlan({
        rules: [
          { argvPrefix: ['api', 'projects'], stdout: '{"ok":true,"source":"fake-glab"}\n', exitCode: 0 },
          { argvIncludes: ['--version'], stdout: 'glab version 1.0.0 (fake)\n', exitCode: 0 },
        ],
      })
      const glabApi = harness.runGlab(['api', 'projects', '--per-page', '20'])
      check(glabApi.exitCode === 0 && glabApi.stdout.trim() === '{"ok":true,"source":"fake-glab"}', 'G1 假 glab 按计划返回 stdout 与退出码', harness.formatFailure(glabApi))
      const glabVersion = harness.runOnPath('glab', ['--version'])
      check(glabVersion.exitCode === 0 && glabVersion.stdout.includes('glab version 1.0.0 (fake)'), 'G2 PATH 前置后按名字 glab 也能解析到假 glab', harness.formatFailure(glabVersion))
      const calls = harness.readGlabCalls()
      check(calls.length === 2, 'G3 假 glab 每次调用都记进 JSONL（两条）', JSON.stringify(calls, null, 2))
      check(
        calls.length >= 1 && JSON.stringify(calls[0].argv) === JSON.stringify(['api', 'projects', '--per-page', '20']),
        'G4 第 1 条记录里的 argv 原样还原（调用顺序可断言）',
        JSON.stringify(calls, null, 2),
      )
      check(
        calls.length >= 2 && JSON.stringify(calls[1].argv) === JSON.stringify(['--version']),
        'G5 第 2 条记录里的 argv 原样还原（调用顺序可断言）',
        JSON.stringify(calls, null, 2),
      )
      check(
        calls.length === 2 && samePath(calls[0].cwd, harness.workspaceDir) && samePath(calls[1].cwd, REPO_ROOT),
        'G6 每条记录都带上假 glab 当时的工作目录（两次调用 cwd 不同，各自记住）',
        JSON.stringify(calls, null, 2),
      )
    }

    // ── H. 夹具不许污染宿主进程的环境变量 ────────────────────────────────────
    const hostAfter = snapshotHostEnv()
    const envDiff = NEGATIVE ? '' : diffEnv(hostBefore, hostAfter)
    if (!NEGATIVE) {
      check(envDiff === '', 'H1 跑完一圈后宿主进程的环境变量一个没变（PATH / GLAB_BIN / 工作根等）', envDiff)
    }

    // ── I. 负例自检：正例跑一趟 --negative 子门禁，证明这扇门禁真的能红 ─────────
    if (!NEGATIVE) {
      const negativeRun = spawnSync(process.execPath, ['--import', './scripts/ts-hook.mts', SELF_REL, '--negative'], {
        cwd: REPO_ROOT,
        env: Object.assign({}, process.env, { DSH_VERIFY_WORK_ROOT: harness.workRoot }),
        encoding: 'utf8',
        timeout: 120000,
        windowsHide: true,
      })
      const negativeOutput = String(negativeRun.stdout || '') + String(negativeRun.stderr || '')
      const scan = scanGateResult(negativeOutput)
      check(negativeRun.status === 1, 'I1 --negative 子门禁退出码 1（负例必须能红）', negativeOutput)
      check(
        scan.record !== null && scan.record.failed >= 2 && scan.record.assertions >= 2,
        'I2 --negative 的完成记录自报至少 2 条失败断言',
        negativeOutput,
      )
      check(
        negativeOutput.includes('[负例]') && negativeOutput.includes('FAIL '),
        'I3 负例输出里能看到被故意触发的断言与失败行',
        negativeOutput,
      )
    }
  } finally {
    harness.dispose()
  }
}

main()
  .then(() => {
    console.log('')
    console.log('结果：' + passed + ' 条通过，' + failed + ' 条失败')
    printGateResult(GATE, passed + failed, failed)
    process.exitCode = failed > 0 ? 1 : 0
  })
  .catch((error: unknown) => {
    failed += 1
    console.log('  FAIL 门禁自己崩了：' + (error instanceof Error && error.stack ? error.stack : String(error)))
    printGateResult(GATE, passed + failed, failed)
    process.exitCode = 1
  })
