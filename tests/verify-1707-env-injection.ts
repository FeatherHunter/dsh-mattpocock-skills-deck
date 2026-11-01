// tests/verify-1707-env-injection.ts —— #1707「实例环境注入与启动计划」的黑盒门禁。
//
// 这扇门禁不 import 工具台命令的内部函数，也不读命令源码文本；它按执行会话的样子起子进程
// （同一个 node 入口、同一份 ts-hook、同一组参数），再读 stdout 的那段 JSON、退出码与文件副作用。
// 失败路径与正例走同一个进程接口，所以「值不进日志与诊断」也是在真实输出上断言的。
//
// 跑法：
//   node --import ./scripts/ts-hook.mts tests/verify-1707-env-injection.ts
//   node --import ./scripts/ts-hook.mts tests/verify-1707-env-injection.ts --negative
// 正例退出码 0；--negative 真的起子进程跑一条会成功的命令，再故意把期望写错，证明断言能红
// （不是删掉断言换来的红）。正例收尾还会起一份 --negative 子门禁自检，负例本身也进了每次全链的判据。

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO_ROOT, createRealMachineHarness, samePath } from './lib/real-machine-process.ts'
import { printGateResult, scanGateResult } from './lib/gate-result.ts'
import type { CommandRun, RealMachineHarness } from './lib/real-machine-process.ts'

const GATE = 'verify-1707-env-injection'
const SELF_REL = 'tests/verify-1707-env-injection.ts'
const FAKE_INSTANCE_REL = 'tests/fixtures/real-machine/launch/fake-instance.mts'
const FAKE_INSTANCE = path.join(REPO_ROOT, FAKE_INSTANCE_REL)
const FAKE_PORT = 34567
// 假的 GitLab 令牌：只在这个门禁里用。任何不该出现它的输出里出现它，都算泄密。
const TOKEN = 'glpat-SENTINEL-1707-do-not-leak'
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

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

/** 读一个「字符串数组」字段；不是数组就给空数组。 */
function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

interface EnvCase {
  dir: string
  configDir: string
  pathValue: string
  envFile: string
}

/** 一组互不相同的假值：谁出现在不该出现的地方，门禁都能指名道姓。 */
function envCase(harness: RealMachineHarness, name: string): EnvCase {
  const dir = path.join(harness.workRoot, name)
  return {
    dir,
    configDir: path.join(dir, 'glab-config'),
    pathValue: path.join(dir, 'path-without-glab'),
    envFile: path.join(dir, 'env.txt'),
  }
}

/** 写一份环境文件，返回它的绝对路径；统一用 CRLF，顺便证明解析不挑换行符。 */
function writeEnv(harness: RealMachineHarness, name: string, lines: string[]): string {
  const file = path.join(harness.workRoot, name, 'env.txt')
  harness.writeText(name + '/env.txt', lines.join('\r\n') + '\r\n')
  return file
}

/** start-instance 的公共参数：用假实例，计划模式或启动模式都只碰临时工作根。 */
function startArgs(home: string, dir: string, extras: string[], envFile?: string): string[] {
  const args = [
    '--home', home,
    '--dir', dir,
    '--profile', 'web',
    '--port', '0',
    '--exe', process.execPath,
    '--cli', FAKE_INSTANCE,
    '--userprofile', path.join(dir, 'userprofile'),
  ]
  if (envFile !== undefined) args.push('--instance-env-file', envFile)
  return args.concat(extras)
}

/** 读假实例写下的观测文件；没有或读不懂就是 null。 */
function readObserved(dir: string): JsonRecord | null {
  const file = path.join(dir, 'fake-instance-observed.json')
  if (!fs.existsSync(file)) return null
  try {
    return asRecord(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

/** 扫一遍目录里的文本文件，列出哪些文件含有给定的值；allowed 里的文件允许出现（假实例的观测文件）。 */
function scanValues(harness: RealMachineHarness, dirRel: string, values: string[], allowed: string[]): string[] {
  const allowedSet = new Set(allowed.map((item) => item.replace(/\\/g, '/')))
  const leaks: string[] = []
  for (const entry of harness.listFiles(dirRel)) {
    if (entry.endsWith('/')) continue
    if (allowedSet.has(entry.replace(/\\/g, '/'))) continue
    let text = ''
    try {
      text = harness.readText(entry)
    } catch {
      continue
    }
    for (const value of values) {
      if (text.includes(value)) leaks.push(entry + ' 里出现了不该出现的环境变量值')
    }
  }
  return leaks
}

/** 失败型命令的公共断言：退出码 1、stdout 空、stderr 用中文说清原因、输出里没有环境变量值。 */
function expectFailure(label: string, run: CommandRun, fragments: string[], forbiddenValues: string[], detail: string): void {
  check(run.exitCode === 1, label + '：退出码 1', detail)
  check(run.stdout.trim() === '', label + '：失败时不往 stdout 打半截 JSON', detail)
  for (const fragment of fragments) check(run.stderr.includes(fragment), label + '：stderr 说清「' + fragment + '」', detail)
  const output = run.stdout + run.stderr
  for (const value of forbiddenValues) check(!output.includes(value), label + '：输出里没有出现环境变量的值', detail)
}

// ── 正例 ────────────────────────────────────────────────────────────────────

function runPositive(harness: RealMachineHarness): void {
  check(fs.existsSync(FAKE_INSTANCE), '0 假实例夹具存在：' + FAKE_INSTANCE_REL)
  const home = harness.createHomeTemplate()
  const fixture = envCase(harness, 'env-case')
  harness.writeText(
    'env-case/env.txt',
    [
      '# 本批实例的环境文件：值只给实例进程，计划与日志里都不出现',
      'GLAB_CONFIG_DIR=' + fixture.configDir,
      'PATH=' + fixture.pathValue,
      'GITLAB_TOKEN=' + TOKEN,
    ].join('\r\n') + '\r\n',
  )

  // ── A. --launch-plan：只给变量名与启动命令，不出现任何值，也不产生副作用 ──
  const planDir = path.join(harness.workRoot, 'plan-run', 'run-a')
  const plan = harness.runCommand('start-instance', {
    args: startArgs(home, planDir, ['--launch-plan'], fixture.envFile),
    timeoutMs: 60000,
  })
  const planFailure = harness.formatFailure(plan)
  const planJson = asRecord(plan.json)
  check(plan.exitCode === 0 && plan.jsonError === '', 'A1 --launch-plan 正常退出并输出单段 JSON', planFailure)
  check(planJson !== null, 'A2 --launch-plan 的 stdout 是 JSON 对象', planFailure)
  check(!fs.existsSync(planDir), 'A3 --launch-plan 不创建启动目录（计划模式没有真实副作用）', planFailure)
  check(
    JSON.stringify(stringsOf(planJson && planJson.envFileNames)) === JSON.stringify(['GLAB_CONFIG_DIR', 'PATH', 'GITLAB_TOKEN']),
    'A4 计划里列出环境文件的三个变量名（顺序固定）',
    planFailure,
  )
  check(
    JSON.stringify(stringsOf(planJson && planJson.secretEnvNames)) === JSON.stringify(['GITLAB_TOKEN']),
    'A5 计划把 GITLAB_TOKEN 标成秘密变量名（只有名字，没有值）',
    planFailure,
  )
  const allNames = stringsOf(planJson && planJson.envNames)
  const baseNames = ['ELECTRON_RUN_AS_NODE', 'DSH_HOME', 'USERPROFILE', 'HOME']
  check(
    baseNames.concat(['GLAB_CONFIG_DIR', 'PATH', 'GITLAB_TOKEN']).every((name) => allNames.includes(name)),
    'A6 计划列出这次启动显式设置的全部变量名',
    planFailure,
  )
  const startCommand = planJson !== null && typeof planJson.startCommand === 'string' ? planJson.startCommand : ''
  check(
    startCommand.includes('fake-instance.mts') &&
      startCommand.includes('--profile web') &&
      startCommand.includes('--port 0') &&
      startCommand.includes('--no-open'),
    'A7 计划里的启动命令带上程序入口与实例参数',
    planFailure,
  )
  check(planJson !== null && samePath(String(planJson.startCwd || ''), planDir), 'A8 计划里的启动工作目录就是 --dir 指过去的位置', planFailure)
  check(planJson !== null && samePath(String(planJson.envFile || ''), fixture.envFile), 'A9 计划里记着使用的是哪个环境文件（路径不是值）', planFailure)
  const planText = plan.stdout + plan.stderr
  check(!planText.includes(TOKEN), 'A10 计划输出里没有 token 明文', planFailure)
  check(
    !planText.includes(fixture.configDir) && !planText.includes(fixture.pathValue),
    'A11 计划输出里没有环境文件里其它变量的值',
    planFailure,
  )
  check(planJson !== null && planJson.env === undefined, 'A12 计划里没有「变量名→值」的映射，只列名字', planFailure)

  // ── B. start-instance：环境文件的变量真的进了子进程环境，输出里没有值 ──────
  const runDir = path.join(harness.workRoot, 'instance-a', 'run-a')
  const run = harness.runCommand('start-instance', {
    args: startArgs(home, runDir, ['--timeout', '30000'], fixture.envFile),
    timeoutMs: 60000,
  })
  const runFailure = harness.formatFailure(run)
  const instance = asRecord(run.json)
  check(run.exitCode === 0 && run.jsonError === '', 'B1 start-instance 带着环境文件正常启动（退出码 0、stdout 是 JSON）', runFailure)
  check(instance !== null && instance.port === FAKE_PORT, 'B2 从假实例的访问地址里解析出端口', runFailure)
  const observed = readObserved(runDir)
  const observedEnv = observed !== null ? asRecord(observed.env) : null
  check(observed !== null, 'B3 假实例写下了这一趟的 argv、工作目录与环境变量', runFailure)
  check(
    observedEnv !== null && observedEnv.GLAB_CONFIG_DIR === fixture.configDir,
    'B4 子进程环境里读到环境文件的 GLAB_CONFIG_DIR（值原样）',
    runFailure,
  )
  check(
    observedEnv !== null && observedEnv.PATH === fixture.pathValue,
    'B5 子进程环境里的 PATH 被环境文件整体替换（「未安装 glab」的场景就靠它）',
    runFailure,
  )
  check(observedEnv !== null && observedEnv.GITLAB_TOKEN === TOKEN, 'B6 子进程环境里读到环境文件的 GITLAB_TOKEN（值原样）', runFailure)
  const userprofile = path.join(runDir, 'userprofile')
  check(
    observedEnv !== null &&
      samePath(String(observedEnv.DSH_HOME || ''), home) &&
      samePath(String(observedEnv.USERPROFILE || ''), userprofile) &&
      samePath(String(observedEnv.HOME || ''), userprofile),
    'B7 原有的隔离变量（DSH_HOME / USERPROFILE / HOME）没有被环境文件挤掉',
    runFailure,
  )
  const observedArgv = observed !== null && Array.isArray(observed.argv) ? (observed.argv as unknown[]) : []
  const observedArgvText = JSON.stringify(observedArgv)
  check(
    observed !== null &&
      !observedArgvText.includes(TOKEN) &&
      !observedArgvText.includes(fixture.configDir) &&
      !observedArgvText.includes(fixture.pathValue),
    'B8 实例进程的命令行参数里没有 token 或其它环境值（值只走环境变量）',
    runFailure,
  )
  const instanceFile = path.join(runDir, 'instance.json')
  const instanceText = fs.existsSync(instanceFile) ? fs.readFileSync(instanceFile, 'utf8') : ''
  check(instance !== null && instance.envFile !== undefined && samePath(String(instance.envFile), fixture.envFile), 'B9 instance.json 记着这次用的环境文件路径', runFailure)
  check(
    JSON.stringify(stringsOf(instance && instance.envFileNames)) === JSON.stringify(['GLAB_CONFIG_DIR', 'PATH', 'GITLAB_TOKEN']),
    'B10 instance.json 只记注入的变量名，不记值',
    runFailure,
  )
  check(
    !instanceText.includes(TOKEN) && !instanceText.includes(fixture.configDir) && !instanceText.includes(fixture.pathValue),
    'B11 instance.json 里没有任何环境变量的值',
    runFailure,
  )
  const stdoutLog = fs.existsSync(path.join(runDir, 'stdout.log')) ? fs.readFileSync(path.join(runDir, 'stdout.log'), 'utf8') : ''
  const stderrLog = fs.existsSync(path.join(runDir, 'stderr.log')) ? fs.readFileSync(path.join(runDir, 'stderr.log'), 'utf8') : ''
  check(stdoutLog !== '' && !stdoutLog.includes(TOKEN) && !stderrLog.includes(TOKEN), 'B12 实例的 stdout.log / stderr.log 里没有 token 明文', runFailure)
  check(
    !run.stdout.includes(TOKEN) && !run.stdout.includes(fixture.configDir) && !run.stdout.includes(fixture.pathValue),
    'B13 start-instance 的 stdout 里没有 token 或其它环境值',
    runFailure,
  )
  check(
    run.stderr.includes('环境文件') && run.stderr.includes('GLAB_CONFIG_DIR') && !run.stderr.includes(TOKEN),
    'B14 诊断只报环境文件路径与变量名，不报值',
    runFailure,
  )
  const runDirRel = path.relative(harness.workRoot, runDir)
  const leaks = scanValues(
    harness,
    runDirRel,
    [TOKEN, fixture.configDir, fixture.pathValue],
    [path.join(runDirRel, 'fake-instance-observed.json')],
  )
  check(leaks.length === 0, 'B15 启动目录里除假实例的观测文件外没有出现变量的值', leaks.join('\n') || '（没有列出可疑文件）')

  // ── C. 坏输入一律明确失败，且失败输出里不泄露值 ─────────────────────────────
  // C1 环境文件不存在（计划模式）
  const c1Dir = path.join(harness.workRoot, 'fail-c1', 'run-a')
  const c1 = harness.runCommand('start-instance', {
    args: startArgs(home, c1Dir, ['--launch-plan'], path.join(fixture.dir, 'missing-env.txt')),
    timeoutMs: 60000,
  })
  expectFailure('C1 环境文件不存在（计划模式）', c1, ['找不到环境文件'], [], harness.formatFailure(c1))
  check(!fs.existsSync(c1Dir), 'C1b 环境文件不存在时没有创建启动目录（计划模式无副作用）', harness.formatFailure(c1))

  // C2 环境文件不存在（启动模式）：失败发生在写目录、起进程之前
  const c2Dir = path.join(harness.workRoot, 'fail-c2', 'run-a')
  const c2 = harness.runCommand('start-instance', {
    args: startArgs(home, c2Dir, [], path.join(fixture.dir, 'missing-env.txt')),
    timeoutMs: 60000,
  })
  expectFailure('C2 环境文件不存在（启动模式）', c2, ['找不到环境文件'], [], harness.formatFailure(c2))
  check(!fs.existsSync(c2Dir), 'C2b 环境文件不存在时没有创建启动目录（失败发生在起进程之前）', harness.formatFailure(c2))

  // C3 缺必需变量 GLAB_CONFIG_DIR
  const c3Env = writeEnv(harness, 'env-c3', ['# 故意不写 GLAB_CONFIG_DIR', 'PATH=' + fixture.pathValue, 'GITLAB_TOKEN=' + TOKEN])
  const c3 = harness.runCommand('start-instance', {
    args: startArgs(home, path.join(harness.workRoot, 'fail-c3', 'run-a'), ['--launch-plan'], c3Env),
    timeoutMs: 60000,
  })
  expectFailure('C3 环境文件缺 GLAB_CONFIG_DIR', c3, ['缺少必需变量', 'GLAB_CONFIG_DIR'], [TOKEN, fixture.pathValue], harness.formatFailure(c3))

  // C4 缺必需变量 PATH
  const c4Env = writeEnv(harness, 'env-c4', ['GLAB_CONFIG_DIR=' + fixture.configDir, 'GITLAB_TOKEN=' + TOKEN])
  const c4 = harness.runCommand('start-instance', {
    args: startArgs(home, path.join(harness.workRoot, 'fail-c4', 'run-a'), ['--launch-plan'], c4Env),
    timeoutMs: 60000,
  })
  expectFailure('C4 环境文件缺 PATH', c4, ['缺少必需变量', 'PATH'], [TOKEN, fixture.configDir], harness.formatFailure(c4))

  // C5 不认识的变量名
  const c5Env = writeEnv(harness, 'env-c5', [
    'GLAB_CONFIG_DIR=' + fixture.configDir,
    'PATH=' + fixture.pathValue,
    'GITLAB_TOKEN=' + TOKEN,
    'GITLAB_HOST=gitlab.example.com',
  ])
  const c5 = harness.runCommand('start-instance', {
    args: startArgs(home, path.join(harness.workRoot, 'fail-c5', 'run-a'), ['--launch-plan'], c5Env),
    timeoutMs: 60000,
  })
  expectFailure(
    'C5 环境文件写了不认识的变量名',
    c5,
    ['不支持', 'GITLAB_HOST'],
    [TOKEN, fixture.configDir, fixture.pathValue],
    harness.formatFailure(c5),
  )

  // C6 写坏的整行里带着 token 哨兵：错误信息不许把这一行抄出来
  const c6Env = writeEnv(harness, 'env-c6', [
    '# 这一行故意写坏：值里带着 token 哨兵，错误信息不许回显它',
    'GLAB_CONFIG_DIR=' + fixture.configDir,
    'PATH=' + fixture.pathValue,
    'GITLAB_TOKEN ' + TOKEN,
  ])
  const c6 = harness.runCommand('start-instance', {
    args: startArgs(home, path.join(harness.workRoot, 'fail-c6', 'run-a'), ['--launch-plan'], c6Env),
    timeoutMs: 60000,
  })
  expectFailure(
    'C6 环境文件有一行不是 KEY=VALUE（且该行带着 token）',
    c6,
    ['KEY=VALUE', '第 4 行'],
    [TOKEN, fixture.configDir, fixture.pathValue],
    harness.formatFailure(c6),
  )

  // C7 必需变量的值是空的
  const c7Env = writeEnv(harness, 'env-c7', ['GLAB_CONFIG_DIR=', 'PATH=' + fixture.pathValue, 'GITLAB_TOKEN=' + TOKEN])
  const c7 = harness.runCommand('start-instance', {
    args: startArgs(home, path.join(harness.workRoot, 'fail-c7', 'run-a'), ['--launch-plan'], c7Env),
    timeoutMs: 60000,
  })
  expectFailure('C7 必需变量的值是空的', c7, ['GLAB_CONFIG_DIR', '值是空的'], [TOKEN, fixture.pathValue], harness.formatFailure(c7))

  // C8 可选变量 GITLAB_TOKEN 写成空值：视为这次不注入，计划里自然没有它
  const c8Env = writeEnv(harness, 'env-c8', ['GLAB_CONFIG_DIR=' + fixture.configDir, 'PATH=' + fixture.pathValue, 'GITLAB_TOKEN='])
  const c8 = harness.runCommand('start-instance', {
    args: startArgs(home, path.join(harness.workRoot, 'fail-c8', 'run-a'), ['--launch-plan'], c8Env),
    timeoutMs: 60000,
  })
  const c8Failure = harness.formatFailure(c8)
  const c8Json = asRecord(c8.json)
  check(c8.exitCode === 0, 'C8 可选变量 GITLAB_TOKEN 留空时计划仍然成功（这次不注入 token）', c8Failure)
  check(
    JSON.stringify(stringsOf(c8Json && c8Json.envFileNames)) === JSON.stringify(['GLAB_CONFIG_DIR', 'PATH']),
    'C8b 空值的 GITLAB_TOKEN 不出现在计划变量名里',
    c8Failure,
  )

  // ── D. 不传 --instance-env-file：行为与改动前一致（环境文件是可选的） ────────────────
  const d1Dir = path.join(harness.workRoot, 'no-env-plan', 'run-a')
  const d1 = harness.runCommand('start-instance', { args: startArgs(home, d1Dir, ['--launch-plan']), timeoutMs: 60000 })
  const d1Json = asRecord(d1.json)
  check(d1.exitCode === 0 && d1.jsonError === '', 'D1 不传 --instance-env-file 时计划模式照常工作', harness.formatFailure(d1))
  check(d1Json !== null && d1Json.envFile === null && stringsOf(d1Json.envFileNames).length === 0, 'D2 计划里记着这次没有环境文件', harness.formatFailure(d1))
  check(!fs.existsSync(d1Dir), 'D3 计划模式不创建启动目录（没有环境文件时也一样）', harness.formatFailure(d1))

  const d4Dir = path.join(harness.workRoot, 'no-env-instance', 'run-a')
  const d4 = harness.runCommand('start-instance', { args: startArgs(home, d4Dir, ['--timeout', '30000']), timeoutMs: 60000 })
  const d4Json = asRecord(d4.json)
  check(d4.exitCode === 0 && d4.jsonError === '', 'D4 不传 --instance-env-file 时实例照常启动（旧行为不变）', harness.formatFailure(d4))
  check(d4Json !== null && d4Json.envFile === null && stringsOf(d4Json.envFileNames).length === 0, 'D5 不传环境文件时 instance.json 记的是空环境文件', harness.formatFailure(d4))
  check(readObserved(d4Dir) !== null, 'D6 假实例照常写下观测文件（D4 真的起了子进程）', harness.formatFailure(d4))

  // ── E. 负例自检：正例跑一趟 --negative 子门禁，证明这扇门禁真的能红 ──────────
  const negativeRun = spawnSync(process.execPath, ['--import', './scripts/ts-hook.mts', SELF_REL, '--negative'], {
    cwd: REPO_ROOT,
    env: Object.assign({}, process.env, { DSH_VERIFY_WORK_ROOT: harness.workRoot }),
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
  })
  const negativeOutput = String(negativeRun.stdout || '') + String(negativeRun.stderr || '')
  const scan = scanGateResult(negativeOutput)
  check(negativeRun.status === 1, 'E1 --negative 子门禁退出码 1（负例必须能红）', negativeOutput)
  check(
    scan.record !== null && scan.record.failed >= 3 && scan.record.assertions >= 3,
    'E2 --negative 的完成记录自报至少 3 条失败断言',
    negativeOutput,
  )
  check(
    negativeOutput.includes('[负例]') && negativeOutput.includes('FAIL '),
    'E3 负例输出里能看到被故意触发的断言与失败行',
    negativeOutput,
  )
}

// ── 负例通道：真的起子进程，再故意把期望写错 ────────────────────────────────

function runNegative(harness: RealMachineHarness): void {
  const home = harness.createHomeTemplate()
  const fixture = envCase(harness, 'env-negative')
  // 故意不写 GITLAB_TOKEN：正常实现会成功启动，但下面三条期望会红。
  const envFile = writeEnv(harness, 'env-negative', ['GLAB_CONFIG_DIR=' + fixture.configDir, 'PATH=' + fixture.pathValue])
  const planDir = path.join(harness.workRoot, 'negative-plan', 'run-a')
  const plan = harness.runCommand('start-instance', {
    args: startArgs(home, planDir, ['--launch-plan'], envFile),
    timeoutMs: 60000,
  })
  const planJson = asRecord(plan.json)
  check(plan.exitCode === 0 && planJson !== null, '[负例] 前提：缺 token 的环境文件也能出启动计划', harness.formatFailure(plan))
  check(
    stringsOf(planJson && planJson.envFileNames).includes('GITLAB_TOKEN'),
    '[负例] 故意期望计划里出现 GITLAB_TOKEN：实际环境文件没写它，这条必须红',
    harness.formatFailure(plan),
  )
  check(
    plan.stdout.includes(TOKEN),
    '[负例] 故意期望计划输出里出现 token 值：实际不输出值，这条必须红',
    harness.formatFailure(plan),
  )
  const runDir = path.join(harness.workRoot, 'negative-instance', 'run-a')
  const started = harness.runCommand('start-instance', {
    args: startArgs(home, runDir, ['--timeout', '30000'], envFile),
    timeoutMs: 60000,
  })
  check(started.exitCode === 0 && asRecord(started.json) !== null, '[负例] 前提：缺 token 时实例也能起', harness.formatFailure(started))
  const observed = readObserved(runDir)
  const observedEnv = observed !== null ? asRecord(observed.env) : null
  check(
    observedEnv !== null && observedEnv.GITLAB_TOKEN === TOKEN,
    '[负例] 故意期望子进程读到 GITLAB_TOKEN 哨兵值：实际没有，这条必须红',
    harness.formatFailure(started),
  )
}

// ── 入口 ────────────────────────────────────────────────────────────────────

function main(): void {
  const harness = createRealMachineHarness({ name: 'verify-1707' })
  try {
    console.log('临时工作根：' + harness.workRoot)
    if (NEGATIVE) runNegative(harness)
    else runPositive(harness)
  } finally {
    harness.dispose()
  }
}

try {
  main()
  console.log('')
  console.log('结果：' + passed + ' 条通过，' + failed + ' 条失败')
  printGateResult(GATE, passed + failed, failed)
  process.exitCode = failed > 0 ? 1 : 0
} catch (error: unknown) {
  failed += 1
  console.log('  FAIL 门禁自己崩了：' + (error instanceof Error && error.stack ? error.stack : String(error)))
  printGateResult(GATE, passed + failed, failed)
  process.exitCode = 1
}
