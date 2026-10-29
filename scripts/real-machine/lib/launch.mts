// launch.mts —— 启动一个 DSH web 实例：独立启动目录、独立 DSH_HOME、独立 USERPROFILE。
//
// 启动方式：直接 spawn DSH 自带的程序本体（不经过 dsh.cmd），环境变量 ELECTRON_RUN_AS_NODE=1，
// 参数是 asar 里的命令行入口加 --profile web --port 0 --no-open。
// stdout 里会出现一行带 token 的访问地址；本工具把它解析出来，连同 pid、端口、日志目录写进 instance.json。

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { findDshPaths, assertWritableTarget } from './paths.mts'
import { ensureDir, exists, info, isDir, nowIso, readJson, sleep, today, writeJson } from './util.mts'
import { PLUGIN_CACHE_DIR } from './home.mts'

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
  const home = path.resolve(options.home)
  const dir = path.resolve(options.dir)
  assertWritableTarget(dir)
  const profile = options.profile || 'web'
  if (!isDir(path.join(home, 'profiles', profile))) {
    throw new Error('home「' + home + '」里没有 profiles/' + profile + '：先跑 copy-home 生成批次 home。')
  }
  ensureDir(dir)
  const userprofile = path.resolve(options.userprofile || path.join(dir, 'userprofile'))
  ensureDir(userprofile)

  const { exe, cli } = findDshPaths({ exe: options.exe || process.env.DSH_EXE, cli: options.cli || process.env.DSH_CLI_JS })
  const stdoutPath = path.join(dir, 'stdout.log')
  const stderrPath = path.join(dir, 'stderr.log')
  for (const file of [stdoutPath, stderrPath]) fs.writeFileSync(file, '', 'utf8')
  const outFd = fs.openSync(stdoutPath, 'a')
  const errFd = fs.openSync(stderrPath, 'a')

  const args = ['--expose-internals', cli, '--profile', profile, '--port', String(options.port ?? 0), '--no-open']
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ELECTRON_RUN_AS_NODE: '1',
    DSH_HOME: home,
    USERPROFILE: userprofile,
    HOME: userprofile,
  }
  for (const [key, value] of Object.entries(options.extraEnv || {})) env[key] = value

  // detached：让实例脱离本命令所在的进程组；否则命令退出时，宿主清理进程树会把实例一起带走。
  const child = spawn(exe, args, { cwd: dir, env, stdio: ['ignore', outFd, errFd], windowsHide: true, detached: true })
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