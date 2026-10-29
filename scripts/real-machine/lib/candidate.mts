// candidate.mts —— 候选包从源码到「可核对的安装」这一路的事实与动作：
// 构建、打包、逐文件 SHA256 清单、装进隔离 home、核对安装目录与界面加载的版本串。
//
// 为什么把「构建/打包/清单」写成库而不是命令里的几行：冻结候选是发布前的一道关口，
// 每一步都要能被别的命令复用、被后续票复核（例如发布前检查要读同一份清单）。
// 这里的函数只做「一次动作」，不决定冻结策略（要不要跳过构建、要不要装 UI）——那是命令的事。
//
// 两条与候选身份有关的实测事实（本机 2026-10-29 实测）：
//   1. 同一次构建产物上连续跑两次 npm pack，得到的 tgz 字节完全一致（同一 SHA256）。
//      原因是 npm 打包时把文件时间规范成固定值，tar 头里的可变字段被抹平；因此候选清单可以逐字节比较。
//   2. 真机 home 里 web profile 的 pnpm 依赖记录着「安装时用的 store 在哪块盘」。把 profile 复制到
//      另一块盘再跑 dsh plugin add，pnpm 会拒绝（跨盘不能硬链接 store）。所以「装进隔离 home」默认
//      走「把 tgz 解出来覆盖插件目录」这条不依赖 pnpm 的路；同盘时可以用 --install-method cli 走真实
//      安装命令，两条路都会核对安装结果与清单逐文件一致。

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { findDshPaths } from './paths.mts'
import { assert, dirStats, ensureDir, exists, sha256File, sha256Text } from './util.mts'

export interface GitState {
  commit: string
  branch: string
  /** git status --porcelain 的原始行（含未跟踪文件）。为空表示工作树干净。 */
  dirtyFiles: string[]
}

/**
 * 起一个外部命令并等它跑完。Windows 上 .cmd/.bat 不能直接 spawn：Node 22 起会抛 EINVAL
 * （安全修复禁止不经 shell 启动批处理），这类命令统一包一层 cmd.exe，参数分开传、由 Node 负责加引号。
 * .exe（git、node）与其它平台原样跑。
 */
function runCommand(command: string, args: string[], options: Record<string, any>): any {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', command, ...args], options)
  }
  return spawnSync(command, args, options)
}

/** npm 的调用方式：优先用本机 Node 自带的 npm-cli.js（不经过 .cmd，参数与路径原样传），找不到才退回 npm 命令。 */
function npmInvocation(): { command: string; prefix: string[] } {
  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (exists(cli)) return { command: process.execPath, prefix: [cli] }
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', prefix: [] }
}

function run(command: string, args: string[], options: { cwd: string; env?: Record<string, string | undefined>; timeoutMs?: number }): { status: number | null; stdout: string; stderr: string; elapsedMs: number } {
  const started = Date.now()
  const result = runCommand(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs || 20 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  return {
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || '') + (result.error ? '\n' + String(result.error.message || result.error) : ''),
    elapsedMs: Date.now() - started,
  }
}

/** 读当前提交、分支与工作树里的改动行。候选清单要把这些原样记下来，谁都不能假装工作树是干净的。 */
export function gitState(repo: string): GitState {
  const commit = run('git', ['rev-parse', 'HEAD'], { cwd: repo })
  assert(commit.status === 0, '读不到当前提交：' + commit.stderr.trim())
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo })
  const status = run('git', ['status', '--porcelain'], { cwd: repo })
  assert(status.status === 0, '读不到工作树状态：' + status.stderr.trim())
  return {
    commit: commit.stdout.trim(),
    branch: branch.stdout.trim(),
    dirtyFiles: status.stdout
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean),
  }
}

/** 跑一次只产出发行制品的构建（node scripts/build.mts --pkg-only）。失败时把 stderr 末尾带出来。 */
export function buildPackage(options: { repo: string; timeoutMs?: number }): { argv: string[]; exitCode: number | null; elapsedMs: number; stdoutTail: string; stderrTail: string } {
  const argv = [path.join(options.repo, 'scripts', 'build.mts'), '--pkg-only']
  const result = run(process.execPath, argv, { cwd: options.repo, timeoutMs: options.timeoutMs || 20 * 60 * 1000 })
  const stdoutTail = result.stdout.trim().split('\n').slice(-25).join('\n')
  const stderrTail = result.stderr.trim().split('\n').slice(-25).join('\n')
  assert(result.status === 0, '构建失败（退出码 ' + String(result.status) + '）。stderr 末尾：\n' + stderrTail)
  return { argv: [process.execPath].concat(argv), exitCode: result.status, elapsedMs: result.elapsedMs, stdoutTail, stderrTail }
}

export interface CandidateFile {
  /** 包内相对路径（与 tgz 内的一致，但去掉 npm 加的 package/ 前缀）。 */
  path: string
  bytes: number
  sha256: string
}

export interface PackResult {
  tgzPath: string
  tgzBytes: number
  tgzSha256: string
  filename: string
  files: CandidateFile[]
  npmShasum: string
  npmIntegrity: string
  elapsedMs: number
}

/**
 * 在构建产物目录（package/）里跑 npm pack，把 tgz 写到指定目录，并按 npm 报出的文件清单逐个算 SHA256。
 * 用 npm pack --json 的输出当「哪些文件进了包」的唯一依据，不自己猜 .npmignore 的规则。
 */
export function packCandidate(options: { packageDir: string; destinationDir: string; timeoutMs?: number }): PackResult {
  const packageDir = path.resolve(options.packageDir)
  const destinationDir = path.resolve(options.destinationDir)
  assert(exists(path.join(packageDir, 'package.json')), '构建产物目录里没有 package.json：' + packageDir + '（先跑构建）')
  ensureDir(destinationDir)
  const npm = npmInvocation()
  const result = run(npm.command, [...npm.prefix, 'pack', '--json', '--pack-destination', destinationDir], {
    cwd: packageDir,
    timeoutMs: options.timeoutMs || 10 * 60 * 1000,
  })
  assert(result.status === 0, 'npm pack 失败（退出码 ' + String(result.status) + '）。stderr 末尾：\n' + result.stderr.trim().split('\n').slice(-15).join('\n'))
  let parsed: any
  try {
    parsed = JSON.parse(result.stdout)
  } catch (error) {
    throw new Error('npm pack 的输出不是 JSON，无法读文件清单：' + String((error as Error).message))
  }
  const entry = Array.isArray(parsed) ? parsed[0] : parsed
  assert(entry && entry.filename, 'npm pack 输出里没有 filename')
  const tgzPath = path.join(destinationDir, String(entry.filename))
  assert(exists(tgzPath), 'npm pack 报告生成了 ' + entry.filename + '，但目标目录里没有这个文件')
  const npmFiles: { path: string; size: number }[] = Array.isArray(entry.files) ? entry.files : []
  assert(npmFiles.length > 0, 'npm pack 输出里没有文件清单（files 为空）')
  const files: CandidateFile[] = npmFiles.map((item) => {
    const abs = path.join(packageDir, item.path.split('/').join(path.sep))
    assert(exists(abs), 'npm 清单里的文件在构建产物里不存在：' + item.path)
    const bytes = fs.statSync(abs).size
    assert(bytes === Number(item.size), '文件大小与 npm 清单不一致：' + item.path + '（盘上 ' + bytes + '，清单 ' + item.size + '）')
    return { path: item.path, bytes, sha256: sha256File(abs) }
  })
  return {
    tgzPath,
    tgzBytes: fs.statSync(tgzPath).size,
    tgzSha256: sha256File(tgzPath),
    filename: String(entry.filename),
    files,
    npmShasum: String(entry.shasum || ''),
    npmIntegrity: String(entry.integrity || ''),
    elapsedMs: result.elapsedMs,
  }
}

/** 键排序后的 JSON 文本：同一份内容永远得到同一段字节，供清单摘要使用。 */
export function stableStringify(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort)
    if (input && typeof input === 'object') {
      const record = input as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(record).sort()) out[key] = sort(record[key])
      return out
    }
    return input
  }
  return JSON.stringify(sort(value))
}

/** 清单摘要：只覆盖稳定的身份字段（版本、提交、文件清单等），时间戳与路径不参与。 */
export function manifestDigest(value: unknown): string {
  return sha256Text(stableStringify(value))
}

/** 读 package.json 里的版本号；调用方用它判断「这次冻结的是哪一版」。 */
export function readPackageVersion(packageDir: string): string {
  const file = path.join(packageDir, 'package.json')
  const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: string; name?: string }
  assert(json.version, 'package.json 里没有 version：' + file)
  return String(json.version)
}

/** 从 client.js 源码里读界面版本常量（形如 DSW_VERSION = "v1.2.3"）。 */
export function readVersionConstant(text: string): string | null {
  const match = /DSW_VERSION\s*=\s*"([^"]+)"/.exec(text)
  return match ? match[1] : null
}

interface TarEntry {
  path: string
  type: 'file' | 'dir' | 'other'
  bytes: Buffer | null
}

function parseTar(buffer: Buffer): TarEntry[] {
  const entries: TarEntry[] = []
  let offset = 0
  let pendingPath: string | null = null
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    offset += 512
    if (header.every((byte: number) => byte === 0)) break
    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0+$/, '')
    const sizeText = header.subarray(124, 136).toString('utf8').replace(/\0+$/, '').trim()
    const size = parseInt(sizeText || '0', 8) || 0
    const typeFlag = String.fromCharCode(header[156] || 48)
    const data = size > 0 ? buffer.subarray(offset, offset + size) : Buffer.alloc(0)
    offset += Math.ceil(size / 512) * 512
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0+$/, '')
    let name = prefix ? prefix + '/' + rawName : rawName
    if (typeFlag === 'x' || typeFlag === 'g') {
      const text = data.toString('utf8')
      const pathLine = text.split('\n').find((line: string) => line.startsWith('path='))
      if (pathLine) pendingPath = pathLine.slice('path='.length)
      continue
    }
    if (typeFlag === 'L') {
      pendingPath = data.toString('utf8').replace(/\0+$/, '')
      continue
    }
    if (pendingPath) {
      name = pendingPath
      pendingPath = null
    }
    // npm 打包会在每个路径前加 package/：解包时去掉，让结果就是插件目录本身的内容。
    const normalized = name.replace(/^package\//, '').replace(/\/$/, '')
    if (!normalized) continue
    if (typeFlag === '0' || typeFlag === '\0' || typeFlag === '7') entries.push({ path: normalized, type: 'file', bytes: data })
    else if (typeFlag === '5') entries.push({ path: normalized, type: 'dir', bytes: null })
    else entries.push({ path: normalized, type: 'other', bytes: null })
  }
  return entries
}

/** 解开一个 tgz，把文件写到目标目录（不保留符号链接；npm 包里没有符号链接）。 */
export function extractTgz(tgzPath: string, destDir: string): { files: number; bytes: number } {
  const entries = parseTar(zlib.gunzipSync(fs.readFileSync(tgzPath)))
  let files = 0
  let bytes = 0
  for (const entry of entries) {
    const target = path.join(destDir, entry.path.split('/').join(path.sep))
    assert(target.startsWith(path.resolve(destDir) + path.sep), 'tgz 里有越界路径，拒绝解包：' + entry.path)
    if (entry.type === 'dir') {
      ensureDir(target)
    } else if (entry.type === 'file' && entry.bytes) {
      ensureDir(path.dirname(target))
      fs.writeFileSync(target, entry.bytes)
      files += 1
      bytes += entry.bytes.length
    }
  }
  return { files, bytes }
}

/** 递归算一个目录里每个文件的 SHA256（相对路径用 / 分隔，便于和清单直接比较）。 */
export function hashTree(dir: string): CandidateFile[] {
  const out: CandidateFile[] = []
  const walk = (current: string, rel: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name)
      const nextRel = rel ? rel + '/' + entry.name : entry.name
      if (entry.isDirectory()) walk(abs, nextRel)
      else if (entry.isFile()) out.push({ path: nextRel, bytes: fs.statSync(abs).size, sha256: sha256File(abs) })
    }
  }
  walk(path.resolve(dir), '')
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

export interface InstalledPackage {
  dir: string
  packageJsonPath: string
  version: string
  clientJsPath: string
  clientSha256: string
  versionConstant: string | null
}

/** 在隔离 home 的 profile 里找装好的插件目录，读出包版本、client.js 哈希与界面版本常量。 */
export function findInstalledPackage(home: string, profile: string, name: string): InstalledPackage | null {
  const candidates = [
    path.join(home, 'profiles', profile, 'node_modules', name),
  ]
  for (const dir of candidates) {
    const packageJsonPath = path.join(dir, 'package.json')
    if (!exists(packageJsonPath)) continue
    const json = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: string }
    const clientJsPath = path.join(dir, 'lib', 'client.js')
    if (!exists(clientJsPath)) continue
    return {
      dir,
      packageJsonPath,
      version: String(json.version || ''),
      clientJsPath,
      clientSha256: sha256File(clientJsPath),
      versionConstant: readVersionConstant(fs.readFileSync(clientJsPath, 'utf8')),
    }
  }
  return null
}

/** 读真机 profile 里记录的 pnpm storeDir；用于判断 CLI 安装会不会因为跨盘被 pnpm 拒绝。 */
export function readRecordedStoreDir(home: string, profile: string): string | null {
  const modulesFile = path.join(home, 'profiles', profile, 'node_modules', '.modules.yaml')
  if (!exists(modulesFile)) return null
  const text = fs.readFileSync(modulesFile, 'utf8')
  const match = /storeDir:\s*(\S+)/.exec(text)
  return match ? match[1].replace(/^["']|["']$/g, '') : null
}

/** 同盘判断：Windows 比盘符，其它平台比根路径。跨盘时 pnpm 不能硬链接 store，CLI 安装必定失败。 */
export function sameVolume(a: string, b: string): boolean {
  return path.parse(path.resolve(a)).root.toLowerCase() === path.parse(path.resolve(b)).root.toLowerCase()
}

export interface InstallByExtractResult {
  method: 'extract'
  home: string
  profile: string
  pluginDir: string
  files: number
  bytes: number
  manifestMatched: boolean
  mismatches: string[]
}

/**
 * 把候选包直接解到隔离 home 的插件目录里（先删旧目录），再逐文件核对与清单一致。
 * 这条路不依赖 pnpm store、不依赖网络，任何盘的 home 都能用；代价是绕过 profile 的依赖记账，
 * 所以清单只把它当作「候选内容装进隔离 home」的证据，发布身份仍以界面版本串与安装目录哈希为准。
 */
export function installCandidateByExtract(options: { home: string; profile: string; name: string; tgzPath: string; manifest: CandidateFile[] }): InstallByExtractResult {
  const pluginDir = path.join(options.home, 'profiles', options.profile, 'node_modules', options.name)
  const staging = pluginDir + '.extract-' + Date.now()
  fs.rmSync(staging, { recursive: true, force: true })
  const extracted = extractTgz(options.tgzPath, staging)
  fs.rmSync(pluginDir, { recursive: true, force: true })
  ensureDir(path.dirname(pluginDir))
  fs.renameSync(staging, pluginDir)
  const installed = hashTree(pluginDir)
  const expected = new Map(options.manifest.map((item) => [item.path, item.sha256]))
  const mismatches: string[] = []
  for (const item of installed) {
    if (expected.get(item.path) !== item.sha256) mismatches.push(item.path)
  }
  for (const item of options.manifest) {
    if (!installed.some((entry) => entry.path === item.path)) mismatches.push('缺文件：' + item.path)
  }
  return {
    method: 'extract',
    home: options.home,
    profile: options.profile,
    pluginDir,
    files: extracted.files,
    bytes: extracted.bytes,
    manifestMatched: mismatches.length === 0,
    mismatches: mismatches.slice(0, 20),
  }
}

/**
 * 找到本机 DSH 程序的两个入口：图形程序 exe 与它内部的命令行 cli.js。
 * 不调用安装目录里的 dsh.cmd：那只是一层批处理包装，最终也是「设 ELECTRON_RUN_AS_NODE 再跑 cli.js」，
 * 直接起 exe 少一层 shell，参数与退出码都原样拿得到（与 lib/launch.mts 起实例的方式一致）。
 */
export function resolveDshRuntime(exeOverride?: string): { exe: string; cli: string; argv: string[] } {
  const paths = findDshPaths({ exe: exeOverride })
  return { exe: paths.exe, cli: paths.cli, argv: [paths.exe, '--expose-internals', paths.cli] }
}

export interface InstallByCliResult {
  method: 'cli'
  home: string
  profile: string
  dshExe: string
  argv: string[]
  exitCode: number | null
  elapsedMs: number
  stdoutTail: string
  stderrTail: string
}

/**
 * 用真实的 dsh plugin add 把候选包装进隔离 home。只在 home 与真机 profile 记录的 pnpm store
 * 同盘时才有成功可能（pnpm 不允许跨盘硬链接 store），调用方负责先判断，否则这里会明确报错。
 */
export function installCandidateByCli(options: { home: string; profile: string; tgzPath: string; exe?: string; timeoutMs?: number }): InstallByCliResult {
  const runtime = resolveDshRuntime(options.exe)
  const env: Record<string, string | undefined> = { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: options.home, CI: 'true' }
  const argv = [...runtime.argv, 'plugin', '--profile', options.profile, 'add', options.tgzPath, '--offline']
  const result = run(runtime.exe, argv.slice(1), {
    cwd: path.dirname(options.home),
    env,
    timeoutMs: options.timeoutMs || 10 * 60 * 1000,
  })
  const stdoutTail = result.stdout.trim().split('\n').slice(-20).join('\n')
  const stderrTail = result.stderr.trim().split('\n').slice(-20).join('\n')
  assert(result.status === 0, 'dsh plugin add 失败（退出码 ' + String(result.status) + '）。stderr 末尾：\n' + stderrTail)
  return {
    method: 'cli',
    home: options.home,
    profile: options.profile,
    dshExe: runtime.exe,
    argv,
    exitCode: result.status,
    elapsedMs: result.elapsedMs,
    stdoutTail,
    stderrTail,
  }
}
