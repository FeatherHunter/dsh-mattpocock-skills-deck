// launch.mts —— 启动一个 DSH web 实例：独立启动目录、独立 DSH_HOME、独立 USERPROFILE。
//
// 启动方式：直接 spawn DSH 自带的程序本体（不经过 dsh.cmd），环境变量 ELECTRON_RUN_AS_NODE=1，
// 参数是 asar 里的命令行入口加 --profile web --port 0 --no-open。
// stdout 里会出现一行带 token 的访问地址；本工具把它解析出来，连同 pid、端口、日志目录写进 instance.json。
// 环境文件（--instance-env-file）里的变量只合并进子进程环境，值不写日志、不进 instance.json。

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { findDshPaths, assertWritableTarget } from './paths.mts'
import { ensureDir, exists, info, isDir, nowIso, readJson, sleep, today, writeJson } from './util.mts'
import { PLUGIN_CACHE_DIR } from './home.mts'
import { loadInstanceEnvFile } from './envfile.mts'

export interface Instance {
  /** DSH 进程号；停止实例时用它。 */
  pid: number
  /** 启动目录，也是插件的缓存与日志落点。 */
  dir: string
  home: string
  userprofile: string
  profile: string
  /** 系统分配的端口。 */
  port: number
  /** 带 token 的访问地址，浏览器工具用它打开页面。 */
  tokenUrl: string
  /** 同一台机器上的其它命令（如日志工具）用它定位实例。 */
  originUrl: string
  startedAt: string
  /** 从 spawn 到 stdout 打出访问地址的耗时。 */
  readyMs: number
  stdoutPath: string
  stderrPath: string
  pluginLogDir: string
  /** 启动后当天的插件日志文件；还没生成时为 null，启动后一两秒再找一次就有了。 */
  pluginLogFile: string | null
  exe: string
  cli: string
  /** 这次启动用的环境文件；没传 --instance-env-file 时是 null。只记路径，不记里面的值。 */
  envFile?: string | null
  /** 从环境文件注入的变量名（只有名字，永远不记值）。 */
  envFileNames?: string[]
  /** 这次启动显式设置的全部环境变量名（不含从本命令进程继承的环境）。 */
  envNames?: string[]
}

export interface StartOptions {
  home: string
  dir: string
  userprofile?: string
  profile?: string
  port?: number
  timeoutMs?: number
  exe?: string
  cli?: string
  extraEnv?: Record<string, string>
  /** 环境文件：一行一个 KEY=VALUE，值只合并进子进程环境，不写日志、不进 instance.json。 */
  envFile?: string
}

/** 计划模式（--launch-plan）给人看的一份启动计划：只有变量名与启动命令，没有变量值。 */
export interface LaunchPlanReport {
  /** 固定为 'launch-plan'：读 JSON 的人不必先猜这是实例描述还是计划。 */
  mode: 'launch-plan'
  home: string
  dir: string
  userprofile: string
  profile: string
  port: number
  exe: string
  cli: string
  /** 实例进程的工作目录：spawn 时传的 cwd。 */
  startCwd: string
  /** 人读的启动命令：程序本体加参数；环境变量名在 envNames 里单列，值不出现。 */
  startCommand: string
  /** 这次用的环境文件绝对路径；没传 --instance-env-file 时是 null。 */
  envFile: string | null
  /** 从环境文件里取到的变量名（按固定顺序）。 */
  envFileNames: string[]
  /** 其中属于凭证、绝不能进输出与日志的变量名（目前只有 GITLAB_TOKEN）。 */
  secretEnvNames: string[]
  /** 这次启动显式设置的全部环境变量名。 */
  envNames: string[]
  /** 实例的 stdout、stderr 与插件日志落点。 */
  logFiles: { stdout: string; stderr: string; pluginLogDir: string }
  /** 一句话说明这份计划为什么没有值。 */
  note: string
}

/** 启动前的内部结论：除了给人看的路径，还带着只能进子进程环境的变量值。 */
interface ResolvedLaunch {
  home: string
  dir: string
  userprofile: string
  profile: string
  port: number
  exe: string
  cli: string
  argv: string[]
  env: Record<string, string>
  envFile: string | null
  envFileNames: string[]
  secretEnvNames: string[]
  envNames: string[]
}

/** 显式设置的、与实例隔离有关的变量名；顺序固定，计划里照这个顺序出现。 */
const BASE_ENV_NAMES = ['ELECTRON_RUN_AS_NODE', 'DSH_HOME', 'USERPROFILE', 'HOME']

/** 人读的命令行：带空格的参数加引号，失败时人能直接照着复跑。 */
function displayArgv(argv: string[]): string {
  return argv.map((item) => (/\s/.test(item) ? JSON.stringify(item) : item)).join(' ')
}

/**
 * 把所有启动前的检查与计算集中在一处：路径、profile、环境文件、程序路径、参数与环境变量。
 * 这个函数不写盘、不起进程，所以计划模式可以直接用它；startInstance 再用同一个结果去启动。
 *
 * 检查顺序有意固定：先确认 home/profile 在、再读环境文件、最后才找 DSH 程序。这样参数写错时
 * 报的是真正缺的那一项（例如环境文件路径写错），而不是被后面的程序路径错误盖住。
 */
function resolveLaunch(options: StartOptions): ResolvedLaunch {
  const home = path.resolve(options.home)
  const dir = path.resolve(options.dir)
  assertWritableTarget(dir)
  const profile = options.profile || 'web'
  if (!isDir(path.join(home, 'profiles', profile))) {
    throw new Error('home「' + home + '」里没有 profiles/' + profile + '：先跑 copy-home 生成批次 home。')
  }
  const userprofile = path.resolve(options.userprofile || path.join(dir, 'userprofile'))
  const envFile = options.envFile ? loadInstanceEnvFile(options.envFile) : null
  const { exe, cli } = findDshPaths({ exe: options.exe || process.env.DSH_EXE, cli: options.cli || process.env.DSH_CLI_JS })
  const port = options.port ?? 0
  const argv = ['--expose-internals', cli, '--profile', profile, '--port', String(port), '--no-open']
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ELECTRON_RUN_AS_NODE: '1',
    DSH_HOME: home,
    USERPROFILE: userprofile,
    HOME: userprofile,
  }
  for (const [key, value] of Object.entries(options.extraEnv || {})) env[key] = value
  // 环境文件最后合并：它是这批实例的显式输入，优先于继承来的进程环境与调用方给的 extraEnv。
  if (envFile) for (const [key, value] of Object.entries(envFile.values)) env[key] = value
  const envFileNames = envFile ? envFile.names : []
  const secretEnvNames = envFile ? envFile.secretNames : []
  const envNames = BASE_ENV_NAMES.concat(envFileNames)
  return { home, dir, userprofile, profile, port, exe, cli, argv, env, envFile: envFile ? envFile.file : null, envFileNames, secretEnvNames, envNames }
}

/**
 * 计划模式：把 resolveLaunch 的结论去掉所有变量值，只留路径、变量名与启动命令。
 * 调用它不写盘、不起进程，所以「先看一眼要起什么」不会留下任何现场。
 */
export function describeLaunch(options: StartOptions): LaunchPlanReport {
  const resolved = resolveLaunch(options)
  return {
    mode: 'launch-plan',
    home: resolved.home,
    dir: resolved.dir,
    userprofile: resolved.userprofile,
    profile: resolved.profile,
    port: resolved.port,
    exe: resolved.exe,
    cli: resolved.cli,
    startCwd: resolved.dir,
    startCommand: displayArgv([resolved.exe].concat(resolved.argv)),
    envFile: resolved.envFile,
    envFileNames: resolved.envFileNames,
    secretEnvNames: resolved.secretEnvNames,
    envNames: resolved.envNames,
    logFiles: {
      stdout: path.join(resolved.dir, 'stdout.log'),
      stderr: path.join(resolved.dir, 'stderr.log'),
      pluginLogDir: path.join(resolved.dir, PLUGIN_CACHE_DIR, 'logs'),
    },
    note: '这份计划只列变量名与启动命令；环境文件里的值只交给实例进程，不写在这里。',
  }
}

const URL_RE = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([^\s"'<>]+)/

function waitForUrl(stdoutPath: string, stderrPath: string, childPid: number, timeoutMs: number): Promise<{ tokenUrl: string; port: number; readyMs: number; startedAtMs: number }> {
  const startedAtMs = Date.now()
  return new Promise((resolve, reject) => {
    let finished = false
    const done = (error: Error | null, value?: { tokenUrl: string; port: number; readyMs: number; startedAtMs: number }): void => {
      if (finished) return
      finished = true
      clearInterval(timer)
      if (error) reject(error)
      else if (value) resolve(value)
    }
    const timer = setInterval(() => {
      let text = ''
      try {
        text = fs.readFileSync(stdoutPath, 'utf8')
      } catch {
        text = ''
      }
      const match = URL_RE.exec(text)
      if (match) {
        done(null, { tokenUrl: match[0], port: Number(match[1]), readyMs: Date.now() - startedAtMs, startedAtMs })
        return
      }
      const exitCode = processAlive(childPid) ? null : 1
      if (exitCode !== null) {
        let stderrTail = ''
        try {
          stderrTail = fs.readFileSync(stderrPath, 'utf8').slice(-2000)
        } catch {
          stderrTail = ''
        }
        done(
          new Error(
            'DSH 在打出访问地址之前就退出了（pid ' + childPid + '）。' +
              (stderrTail ? 'stderr 末尾：' + stderrTail : 'stderr 是空的，检查 DSH_HOME 与 profile 是否完整。'),
          ),
        )
        return
      }
      if (Date.now() - startedAtMs > timeoutMs) {
        let stderrTail = ''
        try {
          stderrTail = fs.readFileSync(stderrPath, 'utf8').slice(-2000)
        } catch {
          stderrTail = ''
        }
        done(new Error('等了 ' + timeoutMs + 'ms 还没看到访问地址；进程还活着，可以加 --timeout 再等，或看 ' + stdoutPath + ' 与 ' + stderrPath + (stderrTail ? '。stderr 末尾：' + stderrTail : '')))
      }
    }, 150)
  })
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function findTodayLog(pluginLogDir: string): string | null {
  const file = path.join(pluginLogDir, today() + '.log')
  return exists(file) ? file : null
}

/**
 * 启动实例。返回后进程已在后台运行；命令脚本退出不会带走它（stdio 已落到文件）。
 * 需要停掉时用 stopInstance()，它会按 pid 结束整棵进程树。
 */
export async function startInstance(options: StartOptions): Promise<Instance> {
  // 启动前的检查与计算都在 resolveLaunch 里做，计划模式（--launch-plan）走的是同一份结论：
  // 两条路不会各算各的，计划里看到的命令就是真正要跑的命令。
  const launch = resolveLaunch(options)
  const { home, dir, userprofile, profile, exe, cli } = launch
  ensureDir(dir)
  ensureDir(userprofile)

  const stdoutPath = path.join(dir, 'stdout.log')
  const stderrPath = path.join(dir, 'stderr.log')
  for (const file of [stdoutPath, stderrPath]) fs.writeFileSync(file, '', 'utf8')
  const outFd = fs.openSync(stdoutPath, 'a')
  const errFd = fs.openSync(stderrPath, 'a')
  if (launch.envFile) {
    // 只报文件与变量名，不报值：这行会进命令的 stderr（执行会话记录里也会留一份），token 原文不能跟着进去。
    info('环境文件：' + launch.envFile + '；注入变量：' + launch.envFileNames.join('、') + '（值不输出）')
  }

  // detached：让实例脱离本命令所在的进程组；否则命令退出时，宿主清理进程树会把实例一起带走。
  const child = spawn(exe, launch.argv, { cwd: dir, env: launch.env, stdio: ['ignore', outFd, errFd], windowsHide: true, detached: true })
  fs.closeSync(outFd)
  fs.closeSync(errFd)
  if (!child.pid) throw new Error('spawn 之后拿不到进程号：DSH 程序没有起来。')
  // 解开引用，让本命令退出后子进程继续在后台跑：启动命令的职责是「把实例交出去」，不是守着它。
  child.unref()

  const timeoutMs = options.timeoutMs ?? 120000
  const seen = await waitForUrl(stdoutPath, stderrPath, child.pid, timeoutMs)
  const relaunchAt = Date.now()
  const instance: Instance = {
    pid: child.pid,
    dir,
    home,
    userprofile,
    profile,
    port: seen.port,
    tokenUrl: seen.tokenUrl,
    originUrl: 'http://127.0.0.1:' + seen.port,
    startedAt: new Date(seen.startedAtMs).toISOString(),
    readyMs: seen.readyMs,
    stdoutPath,
    stderrPath,
    pluginLogDir: path.join(dir, PLUGIN_CACHE_DIR, 'logs'),
    pluginLogFile: findTodayLog(path.join(dir, PLUGIN_CACHE_DIR, 'logs')),
    exe,
    cli,
    envFile: launch.envFile,
    envFileNames: launch.envFileNames,
    envNames: launch.envNames,
  }
  // 日志文件常在访问地址出现之后才写出来：再等一小会儿，让调用方拿到的是已经可读的路径。
  for (let i = 0; i < 20 && !instance.pluginLogFile; i += 1) {
    await sleep(150)
    instance.pluginLogFile = findTodayLog(instance.pluginLogDir)
  }
  if (!instance.pluginLogFile) info('提示：暂时没看到今天的插件日志文件，稍后用日志工具按目录找即可。')

  const instancePath = path.join(dir, 'instance.json')
  writeJson(instancePath, { ...instance, instancePath, generatedAt: nowIso(), waitAfterUrlMs: Date.now() - relaunchAt })
  return instance
}

/** 从 instance.json 或启动目录读一个实例描述。 */
export function loadInstance(dirOrFile: string): Instance {
  const resolved = path.resolve(dirOrFile)
  const file = fs.statSync(resolved).isDirectory() ? path.join(resolved, 'instance.json') : resolved
  if (!exists(file)) throw new Error('找不到实例描述文件「' + file + '」：先跑 start-instance，或把 --instance 指到启动目录。')
  return readJson<Instance>(file)
}

/** 停掉实例：按 pid 结束整棵进程树（DSH 会带出渲染、插件等子进程）。 */
export async function stopInstance(dirOrFile: string, options: { timeoutMs?: number } = {}): Promise<{ stopped: boolean; pid: number; alreadyGone: boolean }> {
  const instance = loadInstance(dirOrFile)
  if (!processAlive(instance.pid)) return { stopped: true, pid: instance.pid, alreadyGone: true }
  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill', ['/PID', String(instance.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    killer.on('exit', () => resolve())
    killer.on('error', () => resolve())
  })
  const deadline = Date.now() + (options.timeoutMs ?? 15000)
  while (Date.now() < deadline && processAlive(instance.pid)) await sleep(200)
  const alive = processAlive(instance.pid)
  if (alive) throw new Error('结束进程 ' + instance.pid + ' 之后它还活着：请手动检查任务管理器，或再跑一次 stop。')
  writeJson(path.join(instance.dir, 'stopped.json'), { stoppedAt: nowIso(), pid: instance.pid })
  return { stopped: true, pid: instance.pid, alreadyGone: false }
}

export { processAlive }