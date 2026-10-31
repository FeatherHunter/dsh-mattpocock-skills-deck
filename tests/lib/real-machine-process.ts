// tests/lib/real-machine-process.ts —— #1705 黑盒测试夹具：从进程边界跑 real-machine 工具台命令。
//
// 为什么这样测（规格 #1703 定下的唯一测试接缝）：命令的真实用法就是「一个 node 进程、一组参数、
// stdout 一段 JSON、退出码 + 工作根里的文件副作用」。门禁照执行会话的样子起子进程再读这些出口，
// 不去 import 命令内部函数、也不读命令源码 —— 命令怎么实现可以随便改，只要接口不变，门禁就不该红。
//
// 外部世界只从进程边界注入（改之前先读这四条约定）：
//   1. 工作根：建在系统临时目录（或 DSH_VERIFY_WORK_ROOT / 显式 baseDir）下的唯一 run-* 子目录，
//      结束时整棵删掉。只写这里与沙箱里的临时目录，不写真实 DSH 配置、用户目录。
//   2. 假 glab：把生成的 glab 启动器（Windows 是 glab.cmd，其它平台是可执行 sh）放进 <工作根>/fake-bin，
//      再把这一目录前置到 PATH；同时把 GLAB_BIN 指到它。它每次被调都把 argv 与 cwd 追加进
//      <工作根>/glab-calls.jsonl，测试可以断言调用顺序与每次的工作目录。
//   3. 沙箱 home / 临时目录：子进程的 USERPROFILE、HOME、DSH_REAL_HOME、TMP、TEMP、TMPDIR 全部
//      重定向进工作根。这一段只写进「给子进程的环境变量副本」，绝不改本进程的 process.env ——
//      宿主环境因此不会被污染，门禁跑完还能断言一个变量都没变。
//   4. Windows 上 .cmd/.bat 一律经 ComSpec 起（照 scripts/real-machine/lib/candidate.mts 的做法），
//      避免 Node 22+ 直接 spawn 批处理报 EINVAL。
//
// 用法（后续 #1706-#1711 的门禁照抄这一段即可）：
//   import { createRealMachineHarness } from './lib/real-machine-process.ts'
//   const harness = createRealMachineHarness()
//   try {
//     const run = harness.runCommand('global-lock', { args: ['--lock', path.join(harness.workRoot, 'x.lock')] })
//     if (run.exitCode !== 0) console.log(harness.formatFailure(run))   // 失败现场一屏看完
//     console.log(run.json)                                             // stdout 那段 JSON
//   } finally {
//     harness.dispose()                                                 // 删掉临时工作根
//   }
// 假 glab 的返回用 harness.writeGlabPlan({ rules: [{ argvPrefix: ['api','projects'], stdout: '…' }] }) 安排；
// 调用记录用 harness.readGlabCalls() 读回。

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 仓库根目录（本文件住在 tests/lib/，往上两级就是仓库根）。 */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))

/** 工具台命令统一走仓库根的装载钩子，与执行会话的入口一致。 */
const TS_HOOK_REL = './scripts/ts-hook.mts'
const COMMANDS_DIR_REL = 'scripts/real-machine/commands'
const FAKE_GLAB_REL = 'tests/fixtures/real-machine/fake-glab.mts'

/** 夹具会碰的那批环境变量：门禁用它在跑前跑后各拍一张快照，证明宿主环境没被污染。 */
export const HOST_ENV_KEYS = [
  'PATH',
  'GLAB_BIN',
  'GLAB_FAKE_LOG',
  'GLAB_FAKE_PLAN',
  'DSH_VERIFY_WORK_ROOT',
  'DSH_REAL_HOME',
  'DECK_REPO_ROOT',
  'USERPROFILE',
  'HOME',
  'TMP',
  'TEMP',
  'TMPDIR',
  'NODE_OPTIONS',
]

/** 假 glab 一次调用怎么回话；省略的字段按「退出码 0、不输出」处理。 */
export interface GlabResponse {
  exitCode?: number
  stdout?: string
  stderr?: string
}

/** 一条匹配规则：argvPrefix 逐项相等、argvIncludes 全部出现过，两者都写时同时满足。 */
export interface GlabRule extends GlabResponse {
  argvPrefix?: string[]
  argvIncludes?: string[]
}

/** 假 glab 的计划文件形状；rules 按顺序匹配，第一条命中的生效。 */
export interface GlabPlan {
  default?: GlabResponse
  rules?: GlabRule[]
}

/** 假 glab 记下来的一次调用。 */
export interface GlabCall {
  argv: string[]
  cwd: string
  matchedRule?: number | 'default'
  exitCode?: number
}

/** 起子进程的可选参数（runCommand / runNode 另外再加 args）。 */
export interface SpawnOptions {
  /** 子进程的工作目录；命令缺省是仓库根（与执行会话一致），假 glab 缺省是模拟工作区。 */
  cwd?: string
  /** 只对这一趟生效的环境变量覆盖；值为 undefined 表示删掉这个变量。 */
  env?: Record<string, string | undefined>
  /** 兜底超时，缺省 120 秒。 */
  timeoutMs?: number
}

/** runCommand / runNode 的参数：在 SpawnOptions 之上加命令自己的参数。 */
export interface RunOptions extends SpawnOptions {
  args?: string[]
}

/** 一次子进程的完整结果；json 是 stdout 整段解析出来的值（读不懂时是 null，原因在 jsonError）。 */
export interface CommandRun {
  /** 人读的命令行，失败时直接打出来定位。 */
  command: string
  cwd: string
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  stdout: string
  stderr: string
  elapsedMs: number
  json: unknown
  jsonError: string
}

export interface HarnessOptions {
  /** 工作根的父目录；缺省读 DSH_VERIFY_WORK_ROOT，再缺省用系统临时目录。 */
  baseDir?: string
  /** 只用来让人读懂这一趟是谁的临时目录；不影响行为。 */
  name?: string
  /** 每趟子进程的兜底超时，缺省 120 秒。 */
  timeoutMs?: number
}

export interface RealMachineHarness {
  /** 本趟的临时工作根（唯一目录，dispose 时整棵删掉）。 */
  workRoot: string
  /** PATH 前置的假程序目录（里面是生成的 glab 启动器）。 */
  binDir: string
  /** 沙箱 home：子进程的 USERPROFILE / HOME 指到这里。 */
  sandboxHome: string
  /** 沙箱里的「真实 DSH home」：子进程的 DSH_REAL_HOME 指到这里。 */
  sandboxDshHome: string
  /** 沙箱临时目录：子进程的 TMP / TEMP / TMPDIR 指到这里。 */
  tmpDir: string
  /** 模拟工作区目录，假 glab 的缺省工作目录。 */
  workspaceDir: string
  /** 假 glab 启动器的绝对路径（同时写进 GLAB_BIN）。 */
  glabBin: string
  /** 假 glab 的调用记录文件（JSONL）。 */
  glabCallLog: string
  /** 假 glab 的计划文件。 */
  glabPlanFile: string
  /** 给子进程用的完整环境变量副本；本进程的 process.env 不受影响。 */
  env: Record<string, string>
  /** 起一条 real-machine 工具台命令：<命令名> 对应 scripts/real-machine/commands/<命令名>.mts。 */
  runCommand: (commandName: string, options?: RunOptions) => CommandRun
  /** 起任意一份仓库内脚本（夹具探针用），入口与命令一致：node --import ts-hook <脚本> <参数>。 */
  runNode: (scriptRel: string, options?: RunOptions) => CommandRun
  /** 起一个外部程序（绝对路径或相对仓库根的路径）；Windows 的 .cmd/.bat 自动经 ComSpec。 */
  runExternal: (commandPath: string, options?: RunOptions) => CommandRun
  /** 按 PATH 解析命令名再起（用来证明 PATH 前置真的生效）；Windows 的 .cmd/.bat 自动经 ComSpec。 */
  runOnPath: (commandName: string, args: string[], options?: SpawnOptions) => CommandRun
  /** 起假 glab（GLAB_BIN），缺省工作目录是模拟工作区。 */
  runGlab: (args: string[], options?: SpawnOptions) => CommandRun
  /** 安排假 glab 下一次（及以后）怎么回话；在起子进程之前调用。 */
  writeGlabPlan: (plan: GlabPlan) => void
  /** 读回假 glab 的调用记录（按发生顺序）。 */
  readGlabCalls: () => GlabCall[]
  /** 造一份 home-template（profiles/web 下带 settings.json 与一份旧日志），返回模板目录。 */
  createHomeTemplate: (files?: Record<string, string>) => string
  /** 在工作根内写一个文本文件（测试准备现场用）；相对路径相对工作根，越界会拒绝。 */
  writeText: (relPath: string, text: string) => void
  /** 删工作根里的一个文件或目录（测试准备现场用）；不存在不报错，越界会拒绝。 */
  removePath: (relPath: string) => void
  /** 读工作根内的文本文件；相对路径相对工作根，越界会拒绝。 */
  readText: (relPath: string) => string
  /** 读工作根内的 JSON 文件；读不懂会带上文件路径抛错。 */
  readJson: (relPath: string) => unknown
  /** 工作根内的文件/目录是否存在。 */
  exists: (relPath: string) => boolean
  /** 列出工作根内的文件与目录（相对路径，目录带结尾斜杠），用于失败现场。 */
  listFiles: (relPath?: string) => string[]
  /** 把一次失败拼成一屏可定位的差异：命令行、工作目录、退出码、stdout、stderr、假 glab 调用、工作根文件。 */
  formatFailure: (run: CommandRun, expectation?: string) => string
  /** 删掉本趟临时工作根；有标记文件与 run-* 子目录两道校验，删不认识的目录宁可报错。 */
  dispose: () => void
}

/** 把环境变量表里的字符串拷出来（process.env 的值可能是 undefined）。 */
function copyStringEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of Object.keys(source)) {
    const value = source[key]
    if (typeof value === 'string') out[key] = value
  }
  return out
}

/** 人读的命令行：带空格的参数加引号，失败时人能直接把这一行抄去复跑。 */
function displayArgv(argv: string[]): string {
  return argv.map((item) => (/\s/.test(item) ? JSON.stringify(item) : item)).join(' ')
}

/** 两个路径是不是同一个（Windows 大小写不敏感；子进程回读的 cwd 可能把 D:\Temp 写成 D:\temp）。 */
export function samePath(left: string, right: string): boolean {
  const a = path.resolve(String(left || ''))
  const b = path.resolve(String(right || ''))
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** 工作根内的相对路径解析；越界（../ 或绝对路径跑到外面）直接报错，避免读到宿主文件。 */
function resolveInside(root: string, relPath: string): string {
  const abs = path.resolve(root, relPath)
  const rel = path.relative(root, abs)
  if (rel === '' || rel === '.') return abs
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('路径「' + relPath + '」跑出了临时工作根「' + root + '」，夹具拒绝读它。')
  }
  return abs
}

function listEntries(root: string, relPath: string, out: string[]): void {
  const abs = resolveInside(root, relPath)
  if (!fs.existsSync(abs)) return
  const entries = fs.readdirSync(abs, { withFileTypes: true })
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRel = relPath ? relPath + '/' + entry.name : entry.name
    if (entry.isDirectory()) {
      out.push(childRel + '/')
      listEntries(root, childRel, out)
    } else {
      out.push(childRel)
    }
  }
}

function previewText(text: string): string[] {
  if (!text) return ['（空）']
  const lines = text.split(/\r?\n/)
  const shown = lines.slice(0, 40)
  if (lines.length > shown.length) shown.push('…（还有 ' + (lines.length - shown.length) + ' 行没打出来）')
  return shown
}

/** 假 glab 启动器：Windows 写 .cmd，其它平台写可执行 sh；两种都直接调 node 跑 fixture 脚本。 */
function writeGlabLauncher(binDir: string, fakeScript: string): string {
  const nodeExe = process.execPath
  if (process.platform === 'win32') {
    const file = path.join(binDir, 'glab.cmd')
    fs.writeFileSync(file, '@echo off\r\n"' + nodeExe + '" --no-warnings "' + fakeScript + '" %*\r\n', 'utf8')
    return file
  }
  const file = path.join(binDir, 'glab')
  fs.writeFileSync(file, '#!/bin/sh\nexec "' + nodeExe + '" --no-warnings "' + fakeScript + '" "$@"\n', 'utf8')
  fs.chmodSync(file, 0o755)
  return file
}

/** 假 glab 脚本与探针脚本必须真的存在：夹具是给他们用的，缺了要当场说清楚。 */
function assertRepoFile(relPath: string): string {
  const abs = path.resolve(REPO_ROOT, relPath)
  if (!fs.existsSync(abs)) throw new Error('夹具依赖的仓库内文件不存在：' + abs)
  return abs
}

/**
 * 建一套隔离的进程级测试夹具。返回的对象里所有路径都在同一个唯一临时工作根下面；
 * 用完必须 dispose()，否则临时目录会留在系统临时目录里。
 */
export function createRealMachineHarness(options?: HarnessOptions): RealMachineHarness {
  const opts = options || {}
  const baseDir = path.resolve(
    opts.baseDir || process.env.DSH_VERIFY_WORK_ROOT || path.join(os.tmpdir(), 'dsh-real-machine-fixture'),
  )
  fs.mkdirSync(baseDir, { recursive: true })
  // mkdtemp 生成唯一目录（run-******）：并发跑多扇门禁时互不踩。
  const workRoot = fs.mkdtempSync(path.join(baseDir, 'run-'))
  const startedAt = new Date().toISOString()
  fs.writeFileSync(
    path.join(workRoot, '.fixture-root.json'),
    JSON.stringify({ createdBy: 'tests/lib/real-machine-process.ts', baseDir, name: opts.name || '', startedAt }, null, 2) + '\n',
    'utf8',
  )

  const binDir = path.join(workRoot, 'fake-bin')
  const sandboxHome = path.join(workRoot, 'home')
  const sandboxDshHome = path.join(sandboxHome, '.dsh')
  const tmpDir = path.join(workRoot, 'tmp')
  const workspaceDir = path.join(workRoot, 'workspaces', 'ws-a')
  const glabCallLog = path.join(workRoot, 'glab-calls.jsonl')
  const glabPlanFile = path.join(workRoot, 'glab-plan.json')
  for (const dir of [binDir, sandboxHome, sandboxDshHome, tmpDir, workspaceDir]) fs.mkdirSync(dir, { recursive: true })

  const fakeGlabScript = assertRepoFile(FAKE_GLAB_REL)
  const glabBin = writeGlabLauncher(binDir, fakeGlabScript)

  const env = copyStringEnv(process.env)
  // 清掉宿主可能带进来的假 glab 变量与调试开关，下面重新按本趟设置。
  for (const key of ['GLAB_BIN', 'GLAB_FAKE_LOG', 'GLAB_FAKE_PLAN', 'DSH_REAL_HOME', 'HARNESS_DEBUG', 'NODE_OPTIONS']) delete env[key]
  env.DSH_VERIFY_WORK_ROOT = workRoot
  env.DECK_REPO_ROOT = REPO_ROOT
  env.USERPROFILE = sandboxHome
  env.HOME = sandboxHome
  env.DSH_REAL_HOME = sandboxDshHome
  env.TMP = tmpDir
  env.TEMP = tmpDir
  env.TMPDIR = tmpDir
  env.GLAB_BIN = glabBin
  env.GLAB_FAKE_LOG = glabCallLog
  env.GLAB_FAKE_PLAN = glabPlanFile
  const pathParts = [binDir, path.dirname(process.execPath)]
  if (process.env.PATH) pathParts.push(process.env.PATH)
  env.PATH = pathParts.join(path.delimiter)

  const defaultTimeoutMs = opts.timeoutMs || 120000
  let disposed = false

  function mergeEnv(extra?: Record<string, string | undefined>): Record<string, string> {
    const merged: Record<string, string> = Object.assign({}, env)
    if (extra) {
      for (const key of Object.keys(extra)) {
        const value = extra[key]
        if (value === undefined) delete merged[key]
        else merged[key] = value
      }
    }
    return merged
  }

  function syntheticRun(command: string, cwd: string, message: string): CommandRun {
    return {
      command,
      cwd,
      exitCode: null,
      signal: null,
      timedOut: false,
      stdout: '',
      stderr: message,
      elapsedMs: 0,
      json: null,
      jsonError: '没有 stdout，解析不出 JSON：' + message,
    }
  }

  function spawnAndCollect(command: string, executable: string, argv: string[], spawnOptions: SpawnOptions): CommandRun {
    const cwd = path.resolve(spawnOptions.cwd || REPO_ROOT)
    const isBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)
    const comspec = process.env.ComSpec || 'cmd.exe'
    const actualExecutable = isBatch ? comspec : executable
    const actualArgv = isBatch ? ['/d', '/c', executable].concat(argv) : argv
    const startedAtMs = Date.now()
    const result = spawnSync(actualExecutable, actualArgv, {
      cwd,
      env: mergeEnv(spawnOptions.env),
      encoding: 'utf8',
      timeout: spawnOptions.timeoutMs || defaultTimeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    })
    const elapsedMs = Date.now() - startedAtMs
    let stdout = result.stdout || ''
    let stderr = result.stderr || ''
    let timedOut = false
    const error = result.error as NodeJS.ErrnoException | undefined
    if (error) {
      if (error.code === 'ETIMEDOUT') timedOut = true
      stderr = stderr + (stderr ? '\n' : '') + '[夹具] 起进程失败：' + error.message
    }
    let json: unknown = null
    let jsonError = ''
    const trimmed = stdout.trim()
    if (!trimmed) {
      jsonError = 'stdout 是空的，没有可解析的 JSON（成功命令应当输出一段 JSON）'
    } else {
      try {
        json = JSON.parse(trimmed)
        jsonError = ''
      } catch (parseError) {
        jsonError = 'stdout 不是单段合法 JSON：' + (parseError instanceof Error ? parseError.message : String(parseError))
      }
    }
    return {
      command,
      cwd,
      exitCode: result.status,
      signal: result.signal,
      timedOut,
      stdout,
      stderr,
      elapsedMs,
      json,
      jsonError,
    }
  }

  function runNode(scriptRel: string, runOptions?: RunOptions): CommandRun {
    const runOpts = runOptions || {}
    const args = runOpts.args || []
    const cwd = path.resolve(runOpts.cwd || REPO_ROOT)
    const scriptAbs = path.resolve(REPO_ROOT, scriptRel)
    const hookArg = cwd === REPO_ROOT ? TS_HOOK_REL : pathToFileURL(path.resolve(REPO_ROOT, 'scripts/ts-hook.mts')).href
    const argv = ['--import', hookArg, scriptRel].concat(args)
    const command = displayArgv(['node'].concat(argv))
    if (!fs.existsSync(scriptAbs)) return syntheticRun(command, cwd, '找不到要跑的脚本：' + scriptAbs)
    return spawnAndCollect(command, process.execPath, argv, { cwd, env: runOpts.env, timeoutMs: runOpts.timeoutMs })
  }

  function runCommand(commandName: string, runOptions?: RunOptions): CommandRun {
    const fileName = /\.(mts|ts|js|mjs)$/.test(commandName) ? commandName : commandName + '.mts'
    return runNode(COMMANDS_DIR_REL + '/' + fileName, runOptions)
  }

  function resolveExternal(commandPath: string): string {
    if (path.isAbsolute(commandPath)) return commandPath
    return path.resolve(REPO_ROOT, commandPath)
  }

  function runExternal(commandPath: string, runOptions?: RunOptions): CommandRun {
    const runOpts = runOptions || {}
    const args = runOpts.args || []
    const abs = resolveExternal(commandPath)
    const command = displayArgv([abs].concat(args))
    if (!fs.existsSync(abs)) return syntheticRun(command, path.resolve(runOpts.cwd || REPO_ROOT), '外部程序不存在：' + abs)
    return spawnAndCollect(command, abs, args, { cwd: runOpts.cwd, env: runOpts.env, timeoutMs: runOpts.timeoutMs })
  }

  /** 在夹具自己的 PATH 里按顺序找命令：Windows 认 PATHEXT（假 glab 是 .cmd），其它平台直接找同名文件。 */
  function resolveOnPath(commandName: string): string {
    const dirs = String(env.PATH || '').split(path.delimiter).filter(Boolean)
    const exts = process.platform === 'win32'
      ? String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : ['']
    for (const dir of dirs) {
      for (const ext of exts) {
        for (const candidate of [path.join(dir, commandName + ext), path.join(dir, commandName)]) {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
        }
      }
    }
    return ''
  }

  function runOnPath(commandName: string, args: string[], spawnOptions?: SpawnOptions): CommandRun {
    const spawnOpts = spawnOptions || {}
    const resolved = resolveOnPath(commandName)
    if (!resolved) {
      return syntheticRun(
        displayArgv([commandName].concat(args)),
        path.resolve(spawnOpts.cwd || REPO_ROOT),
        '在夹具的 PATH 里找不到命令「' + commandName + '」。PATH=' + String(env.PATH || ''),
      )
    }
    return runExternal(resolved, { args, cwd: spawnOpts.cwd, env: spawnOpts.env, timeoutMs: spawnOpts.timeoutMs })
  }

  function runGlab(args: string[], spawnOptions?: SpawnOptions): CommandRun {
    const spawnOpts = spawnOptions || {}
    return runExternal(glabBin, {
      args,
      cwd: spawnOpts.cwd || workspaceDir,
      env: spawnOpts.env,
      timeoutMs: spawnOpts.timeoutMs,
    })
  }

  function writeGlabPlan(plan: GlabPlan): void {
    fs.writeFileSync(glabPlanFile, JSON.stringify(plan || {}, null, 2) + '\n', 'utf8')
  }

  function readGlabCalls(): GlabCall[] {
    if (!fs.existsSync(glabCallLog)) return []
    const text = fs.readFileSync(glabCallLog, 'utf8')
    const calls: GlabCall[] = []
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      let record: Record<string, unknown>
      try {
        record = JSON.parse(line) as Record<string, unknown>
      } catch (error) {
        throw new Error('假 glab 的调用记录不是合法 JSON，去看这一行：' + line)
      }
      calls.push({
        argv: Array.isArray(record.argv) ? (record.argv as string[]) : [],
        cwd: typeof record.cwd === 'string' ? record.cwd : '',
        matchedRule: record.matchedRule as number | 'default' | undefined,
        exitCode: typeof record.exitCode === 'number' ? record.exitCode : undefined,
      })
    }
    return calls
  }

  function createHomeTemplate(files?: Record<string, string>): string {
    const template = path.join(workRoot, 'home-template')
    if (fs.existsSync(template)) throw new Error('这一趟已经建过 home-template：' + template)
    const content = files || {
      'profiles/web/settings.json': '{"theme":"dark"}\n',
      'profiles/web/.dsh-mattskillsdeck-cache/logs/2026-01-01.log': '上一台机器的旧日志\n',
    }
    for (const rel of Object.keys(content)) {
      const abs = resolveInside(template, rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, content[rel], 'utf8')
    }
    // copy-home 按 profiles/<profile> 找来源；即使调用方只给了别的文件，也要保证 web profile 存在。
    fs.mkdirSync(path.join(template, 'profiles', 'web'), { recursive: true })
    return template
  }

  function writeText(relPath: string, text: string): void {
    const abs = resolveInside(workRoot, relPath)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, text, 'utf8')
  }

  function removePath(relPath: string): void {
    fs.rmSync(resolveInside(workRoot, relPath), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }

  function readText(relPath: string): string {
    return fs.readFileSync(resolveInside(workRoot, relPath), 'utf8')
  }

  function readJson(relPath: string): unknown {
    const abs = resolveInside(workRoot, relPath)
    const text = fs.readFileSync(abs, 'utf8')
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new Error('工作根里的「' + relPath + '」不是合法 JSON：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  function exists(relPath: string): boolean {
    return fs.existsSync(resolveInside(workRoot, relPath))
  }

  function listFiles(relPath?: string): string[] {
    const out: string[] = []
    listEntries(workRoot, relPath || '', out)
    return out
  }

  function formatFailure(run: CommandRun, expectation?: string): string {
    const lines: string[] = []
    lines.push('命令：' + run.command)
    lines.push('工作目录：' + run.cwd)
    lines.push(
      '退出码：' +
        (run.exitCode === null ? '（没拿到）' : String(run.exitCode)) +
        '；信号：' +
        (run.signal || '无') +
        '；耗时：' +
        run.elapsedMs +
        'ms' +
        (run.timedOut ? '；超时' : ''),
    )
    if (expectation) lines.push('期望：' + expectation)
    if (run.jsonError) lines.push('stdout 解析：' + run.jsonError)
    lines.push('—— stdout（' + Buffer.byteLength(run.stdout, 'utf8') + ' 字节）——')
    for (const line of previewText(run.stdout)) lines.push(line)
    lines.push('—— stderr（' + Buffer.byteLength(run.stderr, 'utf8') + ' 字节）——')
    for (const line of previewText(run.stderr)) lines.push(line)
    let calls: GlabCall[] = []
    try {
      calls = readGlabCalls()
    } catch (error) {
      lines.push('—— 假 glab 调用记录读不出来：' + (error instanceof Error ? error.message : String(error)))
    }
    lines.push('—— 假 glab 调用（' + calls.length + ' 条）——')
    if (calls.length === 0) lines.push('（没有调用）')
    for (let index = 0; index < Math.min(calls.length, 10); index += 1) {
      lines.push('#' + (index + 1) + ' argv=' + JSON.stringify(calls[index].argv) + ' cwd=' + calls[index].cwd)
    }
    if (calls.length > 10) lines.push('…（还有 ' + (calls.length - 10) + ' 条没打出来）')
    let files: string[] = []
    try {
      files = listFiles()
    } catch (error) {
      lines.push('—— 临时工作根文件列不出来：' + (error instanceof Error ? error.message : String(error)))
    }
    lines.push('—— 临时工作根里的文件（' + files.length + ' 个）——')
    const shownFiles = files.slice(0, 40)
    for (const file of shownFiles) lines.push(file)
    if (files.length > shownFiles.length) lines.push('…（还有 ' + (files.length - shownFiles.length) + ' 个没打出来）')
    return lines.join('\n')
  }

  function dispose(): void {
    if (disposed) return
    const marker = path.join(workRoot, '.fixture-root.json')
    if (!fs.existsSync(marker)) throw new Error('拒绝清理：临时工作根里找不到标记文件 ' + marker)
    const relative = path.relative(baseDir, workRoot)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(workRoot).startsWith('run-')) {
      throw new Error('拒绝清理：' + workRoot + ' 不像是本夹具建的 run-* 子目录')
    }
    fs.rmSync(workRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    disposed = true
  }

  writeGlabPlan({ default: { exitCode: 0, stdout: '' } })

  return {
    workRoot,
    binDir,
    sandboxHome,
    sandboxDshHome,
    tmpDir,
    workspaceDir,
    glabBin,
    glabCallLog,
    glabPlanFile,
    env,
    runCommand,
    runNode,
    runExternal,
    runOnPath,
    runGlab,
    writeGlabPlan,
    readGlabCalls,
    createHomeTemplate,
    writeText,
    removePath,
    readText,
    readJson,
    exists,
    listFiles,
    formatFailure,
    dispose,
  }
}
