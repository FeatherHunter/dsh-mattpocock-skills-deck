// packages/dsh-log/src/node.ts —— 日志包的 Node 程序入口（dsh-log/node）。
//
// 给谁用：不是 DSH 插件、自己独立跑的 Node 程序（例如一个技能自己的命令行）。
// 它只做一件事：把 Node 标准库的能力，抹平成日志包要的那几种依赖形状。
//
// 它不决定日志写到哪：目录由调用方通过 cacheDir 传入，本入口不读任何环境变量、
// 也不带任何默认路径。位置是调用方的事，本入口只负责把写文件这条路铺好。
//
// 与另外两个入口的关系：dsh-log/host 是 DSH 插件的入口（要传宿主的文件服务、要注册电话），
// dsh-log/client 是插件客户端侧入口。本入口不碰电话层，也没有客户端转发，
// 只有「把一行日志落到本地文件」与它背后的级别规则、目录派生、失败计数。
//
// 用法：
//   import { createNodeHostLog } from 'dsh-log/node'
//   const log = await createNodeHostLog({ cacheDir: '/path/to/your/cache' })
//   log.store.log('warn', 'your.step.fail', { step: 'fetch', reason: 'timeout' })
//   log.store.flush()
//   await log.ready   // 短命程序：刷完等这一下，进程退出前日志才真的落盘

import { readFile, readdir, mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createHostLog } from './host.js'
import type { HostLog } from './host.js'
import { logFileNamePattern } from './config.js'
import type { HostLogConfigInput, PhoneNameMap } from './config.js'
import type { LogFileService, LogStore, LogStoreDeps, LogTimer } from './store.js'

export type { HostLog } from './host.js'
export type { HostLogConfigInput, PhoneNameMap } from './config.js'
export type { LogFileService, LogStore, LogStoreDeps, LogTimer } from './store.js'

export interface NodeCacheDirDeps {
  /** 日志与开关文件的落点，由调用方决定；本入口自己建这个目录，不读环境变量、不带默认值。 */
  cacheDir: string
  /** 覆盖文件服务（一般不用传；测试或特殊环境才传）。 */
  fs?: LogFileService
  /** 覆盖计时器（一般不用传；测试才传）。 */
  timer?: LogTimer
  /** 覆盖目录拼接方式（一般不用传；测试或特殊平台才传）。 */
  joinPath?: (...parts: string[]) => string
}

// 日志包按「目标对象」读写文件，Node 标准库按路径字符串读写，所以这里把路径装成一个薄对象。
function resolvePath(pathStr: string): Promise<{ path: string }> {
  return Promise.resolve({ path: String(pathStr) })
}
function targetPath(target: unknown): string {
  if (target && typeof target === 'object' && typeof (target as { path?: unknown }).path === 'string') {
    return (target as { path: string }).path
  }
  return String(target)
}

/**
 * 用 Node 标准库拼出日志包要的文件服务。
 *
 * 两个要点：写之前先建父目录（开关文件写在缓存根目录下，包不建它的父目录），
 * 以及不存在的文件读成空串而不是抛错（第一次运行时当天日志文件还不存在）。
 */
export function createNodeFileService(): LogFileService {
  return {
    resolve: resolvePath,
    async readText(target: unknown): Promise<string> {
      try {
        return await readFile(targetPath(target), 'utf8')
      } catch (e) {
        if (e && (e as { code?: string }).code === 'ENOENT') return ''
        throw e
      }
    },
    async writeText(target: unknown, text: string): Promise<void> {
      const target2 = targetPath(target)
      await mkdir(dirname(target2), { recursive: true })
      await writeFile(target2, text, 'utf8')
    },
    async mkdir(dir: string): Promise<void> {
      await mkdir(String(dir), { recursive: true })
    },
    async unlink(target: unknown): Promise<void> {
      try {
        await unlink(targetPath(target))
      } catch (e) {
        if (e && (e as { code?: string }).code === 'ENOENT') return
        throw e
      }
    },
    async listDir(target: unknown): Promise<string[]> {
      try {
        return await readdir(targetPath(target))
      } catch (e) {
        if (e && (e as { code?: string }).code === 'ENOENT') return []
        throw e
      }
    }
  }
}

/** 用 Node 的全局定时函数拼出日志包要的计时器形状。 */
export function createNodeTimer(): LogTimer {
  return {
    timeout: (fn: (...args: unknown[]) => void, ms: number) => setTimeout(fn, ms)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), ms)
  })
}

/** 基准行有没有真的写进当天文件：写进去了，排在它前面的每一行就也进去了。 */
async function markerLanded(store: LogStore, cacheDir: string, marker: string): Promise<boolean> {
  try {
    const logDir = join(cacheDir, store.config.logDirName)
    const pattern = logFileNamePattern(store.config)
    const names = await readdir(logDir)
    for (const name of names) {
      if (!pattern.test(name)) continue
      const text = await readFile(join(logDir, name), 'utf8')
      if (text.includes(`"event":"${marker}"`)) return true
    }
    return false
  } catch (e) {
    void e
    return false
  }
}

/**
 * 给独立 Node 程序用的日志库：一次调用得到可用的落盘日志。
 *
 * 返回的对象里，store 是日志库本体（isEnabled / log / flush / getDroppedCount 等），
 * phoneNames 只是照标识派生出来的名字，本入口不注册电话、独立程序也用不着；
 * ready 是一个 Promise，等它等于等日志真的进了当天文件。
 */
export async function createNodeHostLog(
  deps: NodeCacheDirDeps,
  configInput: HostLogConfigInput
): Promise<HostLog & { ready: Promise<void> }> {
  if (!deps || typeof deps.cacheDir !== 'string' || deps.cacheDir === '') {
    throw new Error('[dsh-log] 建 Node 日志库必须给 cacheDir：日志写到哪由调用方决定，本入口不猜位置')
  }
  const cacheDir = deps.cacheDir
  const fs = deps.fs ?? createNodeFileService()
  const timer = deps.timer ?? createNodeTimer()
  const joinPath = deps.joinPath ?? ((...parts: string[]) => join(...parts))

  // 目录先建好：开关文件直接写在根目录下，包不建它的父目录。
  await mkdir(cacheDir, { recursive: true })

  const hostLog = createHostLog(
    { fs, timer, getCacheDir: () => cacheDir, DEFAULT_CWD: cacheDir },
    configInput
  )
  const store = hostLog.store as LogStore & { flushNow?: () => Promise<void> }

  // 把上次留下的开关读回来。
  //
  // 为什么要这一步：引擎自己不会在新建时读开关（插件那边由宿主在同一进程里一直持有开关状态），
  // 而独立程序每次调用都是新进程——不读回来，上一轮打开的详细日志这一轮就不生效。
  try {
    await store.loadSwitch()
  } catch (e) {
    void e
  }

  // 等队列真的落盘。
  //
  // 为什么不是「调一次 flush 就完事」：刷盘是防抖加单写者，写盘正在进行时再叫一次会直接返回，
  // 所以「叫过了」不等于「写完了」。这里放一条基准行当路标——它排在前面那些行之后写，
  // 等它在文件里出现，就等于前面每一行都已经在文件里了。
  const ready = (async () => {
    const marker = 'log.flush.marker'
    let flushed = false
    try {
      store.log('debug', marker, {})
      flushed = true
    } catch (e) {
      void e
    }
    for (let pass = 0; pass < 6; pass++) {
      try {
        if (typeof store.flushNow === 'function') await store.flushNow()
        else store.flush()
      } catch (e) {
        void e
      }
      if (!flushed) return
      if (await markerLanded(hostLog.store, cacheDir, marker)) return
      await delay(10)
    }
  })()

  return { store: hostLog.store, phoneNames: hostLog.phoneNames, ready }
}
