// util.mts —— 每个命令都用得到的小工具：参数解析、JSON 读写、文件哈希、时间戳与安全删除。
//
// 这里只放与具体业务无关的通用件；DSH 路径、home 复制、启动实例分别在 paths / home / launch 里。
// 所有命令脚本都以「直接跑 .mts」的方式使用（node 24.15 及以上）。

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** 等一会儿。启动与页面轮询里反复用。 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function nowMs(): number {
  return Date.now()
}

/** 建目录（含父目录），返回原路径，方便链式使用。 */
export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function exists(target: string): boolean {
  return fs.existsSync(target)
}

export function isDir(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

/** 判断目录是否为空（不存在也算空）。 */
export function isEmptyDir(dir: string): boolean {
  if (!exists(dir)) return true
  try {
    return fs.readdirSync(dir).length === 0
  } catch {
    return false
  }
}

/**
 * 删除目录或文件。**只用于本工具自己创建的批次目录、临时 home、临时工作区**。
 * 这里故意加一道保险：拒绝删除盘符根、仓库根、当前工作目录，避免参数传错时把仓库清掉。
 */
export function rmrf(target: string): void {
  const resolved = path.resolve(target)
  const segments = resolved.split(path.sep).filter(Boolean)
  const forbidden = [path.parse(resolved).root, process.cwd(), repoRoot()]
  if (segments.length < 3 || forbidden.some((item) => path.resolve(item) === resolved)) {
    throw new Error('拒绝删除「' + resolved + '」：这不像是本工具创建的批次目录或临时目录。')
  }
  fs.rmSync(resolved, { recursive: true, force: true })
}

/** 仓库根目录：从本文件位置往上数三层（scripts/real-machine/lib → scripts/real-machine → scripts → 仓库根）。 */
export function repoRoot(): string {
  const override = process.env.DECK_REPO_ROOT
  if (override) return path.resolve(override)
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  return path.resolve(here, '../../..')
}

export function readJson<T = unknown>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T
}

/** 写 JSON 文件，自动建父目录，末尾换行（方便人直接打开看）。 */
export function writeJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

export function writeText(file: string, text: string): void {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, text, 'utf8')
}

export function sha256File(file: string): string {
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(file))
  return hash.digest('hex')
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function fileSize(file: string): number {
  try {
    return fs.statSync(file).size
  } catch {
    return 0
  }
}

/** 递归数一个目录下的文件数与总字节数（复制完成后报告规模用，不列文件名）。 */
export function dirStats(dir: string): { files: number; bytes: number } {
  let files = 0
  let bytes = 0
  const walk = (current: string): void => {
    let entries: any[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        files += 1
        try {
          bytes += fs.statSync(full).size
        } catch {
          // 文件刚好被别的进程删掉：忽略，不影响总数口径
        }
      }
    }
  }
  walk(dir)
  return { files, bytes }
}

/** 时间戳目录名：20261029-055745（本地时间）。 */
export function stamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    String(date.getFullYear()) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    '-' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  )
}

/** 当天日期，与插件日志文件名同口径（本地时区）：2026-10-29。 */
export function today(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return String(date.getFullYear()) + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

/** 把任意文字变成适合做文件名的一段：只留字母数字与连字符，最长 60 字。 */
export function slugify(text: string): string {
  const cleaned = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned.slice(0, 60) || 'item'
}

export function formatMs(ms: number): string {
  if (ms < 1000) return ms + 'ms'
  return (ms / 1000).toFixed(2) + 's'
}

/** 命令行里 --key value / --key=value / --flag / 重复同名参数都认。 */
export interface ParsedArgs {
  positional: string[]
  flags: Record<string, string | true | string[]>
  has(name: string): boolean
  get(name: string): string | undefined
  getAll(name: string): string[]
  require(name: string, why?: string): string
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const flags: Record<string, string | true | string[]> = {}
  const put = (key: string, value: string | true): void => {
    const current = flags[key]
    if (current === undefined) {
      flags[key] = value
    } else if (Array.isArray(current)) {
      current.push(String(value))
    } else {
      flags[key] = [String(current), String(value)]
    }
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--') {
      positional.push(...argv.slice(i + 1))
      break
    }
    if (arg.startsWith('--')) {
      const body = arg.slice(2)
      const eq = body.indexOf('=')
      if (eq >= 0) {
        put(body.slice(0, eq), body.slice(eq + 1))
      } else {
        const next = argv[i + 1]
        if (next !== undefined && next !== '' && !next.startsWith('--')) {
          put(body, next)
          i += 1
        } else {
          put(body, true)
        }
      }
    } else {
      positional.push(arg)
    }
  }
  const get = (name: string): string | undefined => {
    const value = flags[name]
    if (value === undefined || value === true) return undefined
    return Array.isArray(value) ? value[value.length - 1] : value
  }
  return {
    positional,
    flags,
    has(name: string): boolean {
      return Object.prototype.hasOwnProperty.call(flags, name)
    },
    get,
    getAll(name: string): string[] {
      const value = flags[name]
      if (value === undefined || value === true) return []
      return Array.isArray(value) ? value.slice() : [value]
    },
    require(name: string, why?: string): string {
      const value = get(name)
      if (value === undefined || value === '') {
        throw new Error('缺少参数 --' + name + (why ? '（' + why + '）' : ''))
      }
      return value
    },
  }
}

/** 输出一段 JSON 给人看/给下游读：命令的 stdout 只放这一份 JSON，别的说明走 stderr。 */
export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n')
}

export function info(message: string): void {
  process.stderr.write('[harness] ' + message + '\n')
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/**
 * 命令入口包装：统一把异常变成一行「命令失败：……」与退出码 1，不打印半截堆栈吓人。
 * 需要堆栈排查时给环境变量 HARNESS_DEBUG=1。
 */
export function runCli(main: () => Promise<void>): void {
  main().catch((error: unknown) => {
    const message = error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : String(error)
    process.stderr.write('命令失败：' + message + '\n')
    if (process.env.HARNESS_DEBUG === '1' && error instanceof Error && error.stack) {
      process.stderr.write(error.stack + '\n')
    }
    process.exitCode = 1
  })
}
