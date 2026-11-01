// tests/verify-real-machine-model.ts —— 真机实例自动配置 MiniMax CN 模型的黑盒门禁。
//
// 这扇门禁不 import 工具台命令的内部函数；它按执行会话的样子起子进程（同一个 node 入口、
// 同一份 ts-hook、同一组参数），再读 stdout 的 JSON、退出码与文件副作用。密钥值只允许出现在
// 假实例写下的观测文件里，其它输出、instance.json 与启动目录的文本文件都不许出现。
//
// 跑法：
//   node --import ./scripts/ts-hook.mts tests/verify-real-machine-model.ts
//
// 覆盖：复制 profile 时写入默认模型（并保留其它条目）、profile 没有 cordis.patch.yml 时新建、
// 非法 YAML 明确失败、--no-model 逃生口、环境变量覆盖、计划模式不写盘、
// 密钥来自真实 home / 批次 home 的优先级、无密钥时的报告、实际启动时注入子进程且不泄露。

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'yaml'
import { createRealMachineHarness, REPO_ROOT } from './lib/real-machine-process.ts'
import { printGateResult } from './lib/gate-result.ts'
import type { CommandRun, RealMachineHarness } from './lib/real-machine-process.ts'

const GATE = 'verify-real-machine-model'
const FAKE_INSTANCE = path.join('tests', 'fixtures', 'real-machine', 'launch', 'fake-instance.mts')
const REAL_HOME_KEY = 'mm-SENTINEL-real-home-1766'
const BATCH_HOME_KEY = 'mm-SENTINEL-batch-home-1766'
const OVERRIDE_KEY = 'mm-SENTINEL-override-1766'

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

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

/** 从 JSON 里取模型报告；不是对象就给 null。 */
function modelOf(value: unknown): JsonRecord | null {
  const record = asRecord(value)
  return record ? asRecord(record.model) : null
}

/** 写一份 home-template：只写 profiles/web 下的文件，copy-home 要的就是这一层。 */
function writeTemplate(harness: RealMachineHarness, name: string, files: Record<string, string>): string {
  for (const rel of Object.keys(files)) {
    harness.writeText(name + '/profiles/web/' + rel, files[rel])
  }
  return path.join(harness.workRoot, name)
}

/** start-instance 的公共参数：用假实例，计划模式或启动模式都只碰临时工作根。 */
function startArgs(homeRel: string, dir: string, extras: string[]): string[] {
  return [
    '--home', path.join(harnessRoot(), homeRel),
    '--dir', dir,
    '--profile', 'web',
    '--port', '0',
    '--exe', process.execPath,
    '--cli', path.join(REPO_ROOT, FAKE_INSTANCE),
    '--userprofile', path.join(dir, 'userprofile'),
  ].concat(extras)
}

let currentHarness: RealMachineHarness | null = null
function harnessRoot(): string {
  if (!currentHarness) throw new Error('门禁还没创建夹具。')
  return currentHarness.workRoot
}

/** 找 cordis.patch.yml 里的条目；找不到给 null。 */
function findEntry(entries: unknown[], id: string): JsonRecord | null {
  for (const entry of entries) {
    const record = asRecord(entry)
    if (record && record.id === id) return record
  }
  return null
}

function readPatch(homeRel: string): unknown[] {
  if (!currentHarness) throw new Error('门禁还没创建夹具。')
  const text = currentHarness.readText(homeRel + '/profiles/web/cordis.patch.yml')
  const parsed = yaml.parse(text)
  return Array.isArray(parsed) ? parsed : []
}

function main(): void {
  const harness = createRealMachineHarness({ name: 'verify-real-machine-model' })
  currentHarness = harness
  try {
    runPositive(harness)
  } finally {
    harness.dispose()
    currentHarness = null
  }
  console.log('')
  console.log('  ' + GATE + '：' + passed + ' 条通过，' + failed + ' 条失败')
  printGateResult(GATE, passed, failed)
  if (failed > 0) process.exitCode = 1
}

function runPositive(harness: RealMachineHarness): void {
  // ── A. 复制 profile 时写入默认模型，保留其它条目 ───────────────────────────
  const templateA = writeTemplate(harness, 'template-a', {
    'settings.json': '{"theme":"dark"}\n',
    'cordis.patch.yml': [
      '- id: ui-theme',
      "  name: '@deepseek-ai/dsh-ui-theme'",
      '  config:',
      '    theme: dark',
      '- id: agent-default-model',
      "  name: '@deepseek-ai/dsh-agent-default-model'",
      '  config:',
      '    provider: deepseek-account',
      '    model: deepseek-flash',
      '    reasoningEffort: max',
      '',
    ].join('\n'),
  })
  const copyA = harness.runCommand('copy-home', { args: ['--template', templateA, '--home', path.join(harness.workRoot, 'batch-a/home')] })
  const copyAJson = asRecord(copyA.json)
  const modelA = modelOf(copyAJson)
  const failA = harness.formatFailure(copyA)
  check(copyA.exitCode === 0 && copyA.jsonError === '', 'A1 copy-home 正常退出并输出 JSON', failA)
  check(copyAJson !== null && copyAJson.files === 2, 'A2 copy-home 的文件数把新增的 cordis.patch.yml 算进去（settings + cordis = 2）', failA)
  check(modelA !== null && modelA.configured === true, 'A3 回执里模型已配置', failA)
  check(
    modelA !== null && modelA.provider === 'minimax-cn' && modelA.model === 'Minimax-M3.1-Flash' && modelA.apiKeyEnv === 'MINIMAX_CN_API_KEY',
    'A4 回执里的默认模型是 minimax-cn/Minimax-M3.1-Flash，密钥变量是 MINIMAX_CN_API_KEY',
    failA,
  )
  const patchA = readPatch('batch-a/home')
  const themeA = findEntry(patchA, 'ui-theme')
  const agentA = findEntry(patchA, 'agent-default-model')
  const llmA = findEntry(patchA, 'llm-pi-ai')
  check(themeA !== null && asRecord(themeA.config) !== null && asRecord(themeA.config)?.theme === 'dark', 'A5 复制后原有的 ui-theme 条目与配置原样保留', failA)
  const agentAConfig = agentA ? asRecord(agentA.config) : null
  check(
    agentAConfig !== null && agentAConfig.provider === 'minimax-cn' && agentAConfig.model === 'Minimax-M3.1-Flash',
    'A6 agent-default-model 改写成 minimax-cn/Minimax-M3.1-Flash',
    failA,
  )
  check(agentAConfig !== null && !('reasoningEffort' in agentAConfig), 'A7 agent-default-model 里不再带 reasoningEffort（登录态专属字段已删）', failA)
  const llmConfigA = llmA ? asRecord(llmA.config) : null
  const providersA = llmConfigA ? asRecord(llmConfigA.providers) : null
  const minimaxA = providersA ? asRecord(providersA['minimax-cn']) : null
  check(minimaxA !== null && minimaxA.apiKeyEnv === 'MINIMAX_CN_API_KEY', 'A8 llm-pi-ai 里写入了 minimax-cn 的 apiKeyEnv', failA)
  const modelsA = minimaxA && Array.isArray(minimaxA.models) ? minimaxA.models : []
  const modelEntryA = asRecord(modelsA.find((item) => asRecord(item)?.id === 'Minimax-M3.1-Flash'))
  check(
    modelEntryA !== null &&
      modelEntryA.contextWindow === 1000000 &&
      modelEntryA.maxTokens === 120000 &&
      JSON.stringify(modelEntryA.input) === JSON.stringify(['text', 'image']),
    'A9 模型条目带上上下文窗口、最大输出与输入类型',
    failA,
  )
  const copyJsonA = asRecord(harness.readJson('batch-a/home/copy-home.json'))
  check(modelOf(copyJsonA)?.configured === true, 'A10 copy-home.json 里也记着模型配置，事后可回读', failA)

  // ── B. 计划模式：没有密钥时如实报告，且不写盘 ───────────────────────────────
  const patchBefore = harness.readText('batch-a/home/profiles/web/cordis.patch.yml')
  const planNoKey = harness.runCommand('start-instance', { args: startArgs('batch-a/home', path.join(harness.workRoot, 'plan-a', 'run'), ['--launch-plan']), timeoutMs: 60000 })
  const planNoKeyJson = asRecord(planNoKey.json)
  const modelNoKey = modelOf(planNoKeyJson)
  const failPlanNoKey = harness.formatFailure(planNoKey)
  check(planNoKey.exitCode === 0 && planNoKey.jsonError === '', 'B1 没有密钥时 --launch-plan 仍正常输出计划', failPlanNoKey)
  check(modelNoKey !== null && modelNoKey.enabled === true && modelNoKey.profileConfigured === true, 'B2 计划里模型已启用且 profile 已配置', failPlanNoKey)
  check(modelNoKey !== null && modelNoKey.credentialAvailable === false && modelNoKey.credentialSource === 'missing', 'B3 没有密钥时计划如实报告「缺失」', failPlanNoKey)
  const noKeyNames = stringsOf(planNoKeyJson?.envNames)
  const noKeySecret = stringsOf(planNoKeyJson?.secretEnvNames)
  check(!noKeyNames.includes('MINIMAX_CN_API_KEY') && !noKeySecret.includes('MINIMAX_CN_API_KEY'), 'B4 没有密钥时不把 MINIMAX_CN_API_KEY 列进这次启动的变量名', failPlanNoKey)
  check(harness.readText('batch-a/home/profiles/web/cordis.patch.yml') === patchBefore, 'B5 计划模式不写 profile（只看不落盘）', failPlanNoKey)
  check(!fs.existsSync(path.join(harness.workRoot, 'plan-a', 'run')), 'B6 计划模式不创建启动目录', failPlanNoKey)

  // ── C. 密钥来自真实 home：计划报来源，输出不含值；批次 home 的存储优先 ───────
  harness.writeText('home/.dsh/.credentials.yaml', ['version: 1', 'refs:', '  MINIMAX_CN_API_KEY: ' + REAL_HOME_KEY, ''].join('\n'))
  const planReal = harness.runCommand('start-instance', { args: startArgs('batch-a/home', path.join(harness.workRoot, 'plan-real', 'run'), ['--launch-plan']), timeoutMs: 60000 })
  const planRealJson = asRecord(planReal.json)
  const modelReal = modelOf(planRealJson)
  const failPlanReal = harness.formatFailure(planReal)
  check(modelReal !== null && modelReal.credentialAvailable === true && modelReal.credentialSource === 'real-home-store', 'C1 真实 home 的 .credentials.yaml 里的密钥被找到', failPlanReal)
  check(stringsOf(planRealJson?.secretEnvNames).includes('MINIMAX_CN_API_KEY'), 'C2 计划把 MINIMAX_CN_API_KEY 标成秘密变量名', failPlanReal)
  check(!(planReal.stdout + planReal.stderr).includes(REAL_HOME_KEY), 'C3 计划输出里没有密钥值', failPlanReal)

  harness.writeText('batch-a/home/.credentials.yaml', ['version: 1', 'refs:', '  MINIMAX_CN_API_KEY: ' + BATCH_HOME_KEY, ''].join('\n'))
  const planBatch = harness.runCommand('start-instance', { args: startArgs('batch-a/home', path.join(harness.workRoot, 'plan-batch', 'run'), ['--launch-plan']), timeoutMs: 60000 })
  const modelBatch = modelOf(planBatch.json)
  const failPlanBatch = harness.formatFailure(planBatch)
  check(modelBatch !== null && modelBatch.credentialSource === 'batch-home-store', 'C4 批次 home 的 .credentials.yaml 优先于真实 home', failPlanBatch)
  check(!(planBatch.stdout + planBatch.stderr).includes(BATCH_HOME_KEY) && !(planBatch.stdout + planBatch.stderr).includes(REAL_HOME_KEY), 'C5 计划输出里两处密钥值都不出现', failPlanBatch)

  // ── D. 实际启动：密钥真的进了子进程环境，但不在任何回执与日志里 ─────────────
  const runDir = path.join(harness.workRoot, 'run-a', 'run-a')
  const start = harness.runCommand('start-instance', { args: startArgs('batch-a/home', runDir, ['--timeout', '30000']), timeoutMs: 60000 })
  const failStart = harness.formatFailure(start)
  const instance = asRecord(start.json)
  const modelStart = modelOf(instance)
  check(start.exitCode === 0 && start.jsonError === '', 'D1 实际启动正常退出并输出实例 JSON', failStart)
  check(modelStart !== null && modelStart.credentialSource === 'batch-home-store' && modelStart.credentialAvailable === true, 'D2 instance.json 的模型报告记着密钥来源与可用性', failStart)
  const observedFile = path.join(runDir, 'fake-instance-observed.json')
  let observed: JsonRecord | null = null
  try {
    observed = asRecord(JSON.parse(fs.readFileSync(observedFile, 'utf8')))
  } catch {
    observed = null
  }
  const observedEnv = observed ? asRecord(observed.env) : null
  check(observedEnv !== null && observedEnv.MINIMAX_CN_API_KEY === BATCH_HOME_KEY, 'D3 子进程环境里读到了注入的 MINIMAX_CN_API_KEY', failStart)
  const instanceText = fs.existsSync(path.join(runDir, 'instance.json')) ? fs.readFileSync(path.join(runDir, 'instance.json'), 'utf8') : ''
  check(instanceText !== '' && !instanceText.includes(BATCH_HOME_KEY) && !instanceText.includes(REAL_HOME_KEY), 'D4 instance.json 里没有密钥值', failStart)
  check(!(start.stdout + start.stderr).includes(BATCH_HOME_KEY), 'D5 start-instance 的标准输出与诊断里没有密钥值', failStart)
  const runDirRel = path.relative(harness.workRoot, runDir)
  const leaks: string[] = []
  for (const entry of harness.listFiles(runDirRel)) {
    if (entry.endsWith('/') || entry.replace(/\\/g, '/').endsWith('fake-instance-observed.json')) continue
    let text = ''
    try {
      text = harness.readText(entry)
    } catch {
      continue
    }
    if (text.includes(BATCH_HOME_KEY) || text.includes(REAL_HOME_KEY)) leaks.push(entry)
  }
  check(leaks.length === 0, 'D6 启动目录里除假实例观测文件外没有出现密钥值', leaks.join('\n') || '（没有列出可疑文件）')

  // ── E. profile 没有 cordis.patch.yml 时新建；非法 YAML 明确失败 ──────────────
  const templateB = writeTemplate(harness, 'template-b', { 'settings.json': '{"theme":"light"}\n' })
  const copyB = harness.runCommand('copy-home', { args: ['--template', templateB, '--home', path.join(harness.workRoot, 'batch-b/home')] })
  const modelB = modelOf(copyB.json)
  const failB = harness.formatFailure(copyB)
  check(copyB.exitCode === 0 && modelB !== null && modelB.configured === true, 'E1 模板里没有 cordis.patch.yml 时复制后新建并配置', failB)
  check(fs.existsSync(path.join(harness.workRoot, 'batch-b/home/profiles/web/cordis.patch.yml')), 'E2 新建的 cordis.patch.yml 真的落在批次 profile 里', failB)
  const patchB = readPatch('batch-b/home')
  check(findEntry(patchB, 'agent-default-model') !== null && findEntry(patchB, 'llm-pi-ai') !== null, 'E3 新建文件里两条配置齐全', failB)

  const templateC = writeTemplate(harness, 'template-c', {
    'settings.json': '{"theme":"light"}\n',
    'cordis.patch.yml': '- id: broken\n  config: [\n',
  })
  const copyC = harness.runCommand('copy-home', { args: ['--template', templateC, '--home', path.join(harness.workRoot, 'batch-c/home')] })
  check(copyC.exitCode === 1, 'E4 非法 YAML 让 copy-home 明确失败（不留下一个假配置的 home）', harness.formatFailure(copyC))
  check((copyC.stdout + copyC.stderr).includes('读不懂') || (copyC.stdout + copyC.stderr).includes('cordis.patch.yml'), 'E5 失败时用中文说清是 cordis.patch.yml 读不懂', harness.formatFailure(copyC))

  // ── F. --no-model 逃生口与环境变量覆盖 ──────────────────────────────────────
  const templateD = writeTemplate(harness, 'template-d', { 'settings.json': '{"theme":"light"}\n' })
  const copyD = harness.runCommand('copy-home', { args: ['--template', templateD, '--home', path.join(harness.workRoot, 'batch-d/home'), '--no-model'] })
  check(copyD.exitCode === 0 && asRecord(copyD.json)?.model === null, 'F1 --no-model 时回执里模型是 null', harness.formatFailure(copyD))
  check(!fs.existsSync(path.join(harness.workRoot, 'batch-d/home/profiles/web/cordis.patch.yml')), 'F2 --no-model 时不写 cordis.patch.yml', harness.formatFailure(copyD))
  const planD = harness.runCommand('start-instance', { args: startArgs('batch-d/home', path.join(harness.workRoot, 'plan-d', 'run'), ['--launch-plan', '--no-model']), timeoutMs: 60000 })
  const modelD = modelOf(planD.json)
  check(planD.exitCode === 0 && modelD !== null && modelD.enabled === false, 'F3 --no-model 的启动计划明确报告模型未启用', harness.formatFailure(planD))
  check(!fs.existsSync(path.join(harness.workRoot, 'batch-d/home/profiles/web/cordis.patch.yml')), 'F4 --no-model 的计划模式也不写 profile', harness.formatFailure(planD))

  const templateE = writeTemplate(harness, 'template-e', { 'settings.json': '{"theme":"light"}\n' })
  const copyE = harness.runCommand('copy-home', {
    args: ['--template', templateE, '--home', path.join(harness.workRoot, 'batch-e/home')],
    env: {
      DSH_REAL_MACHINE_MODEL_PROVIDER: 'minimax-cn',
      DSH_REAL_MACHINE_MODEL: 'minimax-cn/Custom-Model',
      DSH_REAL_MACHINE_MODEL_KEY_ENV: 'MINIMAX_CN_API_KEY',
    },
  })
  const modelE = modelOf(copyE.json)
  check(copyE.exitCode === 0 && modelE !== null && modelE.model === 'Custom-Model', 'F5 DSH_REAL_MACHINE_MODEL 的 provider/model 覆盖生效', harness.formatFailure(copyE))
  const patchE = readPatch('batch-e/home')
  const agentE = findEntry(patchE, 'agent-default-model')
  const agentEConfig = agentE ? asRecord(agentE.config) : null
  check(agentEConfig !== null && agentEConfig.model === 'Custom-Model', 'F6 覆盖后的模型 id 真的写进了 profile', harness.formatFailure(copyE))
  // 覆盖密钥变量名，确认 apiKeyEnv 跟着走；这里只改名字，不写值。
  const templateF = writeTemplate(harness, 'template-f', { 'settings.json': '{"theme":"light"}\n' })
  const copyF = harness.runCommand('copy-home', {
    args: ['--template', templateF, '--home', path.join(harness.workRoot, 'batch-f/home')],
    env: { DSH_REAL_MACHINE_MODEL_KEY_ENV: 'CUSTOM_MODEL_KEY', MINIMAX_CN_API_KEY: OVERRIDE_KEY },
  })
  const patchF = readPatch('batch-f/home')
  const llmF = findEntry(patchF, 'llm-pi-ai')
  const providersF = llmF && asRecord(llmF.config) ? asRecord((llmF.config as JsonRecord).providers) : null
  const minimaxF = providersF ? asRecord(providersF['minimax-cn']) : null
  check(copyF.exitCode === 0 && minimaxF !== null && minimaxF.apiKeyEnv === 'CUSTOM_MODEL_KEY', 'F7 DSH_REAL_MACHINE_MODEL_KEY_ENV 覆盖 apiKeyEnv', harness.formatFailure(copyF))
  check(!(copyF.stdout + copyF.stderr).includes(OVERRIDE_KEY), 'F8 覆盖测试的假值没有混进输出', harness.formatFailure(copyF))
}

main()
