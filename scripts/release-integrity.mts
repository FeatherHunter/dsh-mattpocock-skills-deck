// scripts/release-integrity.mts —— 发布自证：把「发出去的字节」与「门禁验过的字节」逐文件对起来，并核对 dist-tag 指向。
//
// 为什么要有这个脚本（#1648）：上一次发布出现过两件事——发布包与候选包差了 102 个字节；latest 与 beta
// 两个 dist-tag 指向不一致。两件都是靠人翻日志发现的。人翻日志不能算判据：它没有退出码，漏看一次就过去了。
// 所以这里把两件事写成机器算得出来的东西：
//   1. 逐文件清单：解包 npm 的 tarball，给每个文件算 sha256，把这些行再算一次哈希得到「清单指纹」。
//      发布前拍一次门禁产物，发布前再拍一次真正要发的字节，发布后从 registry 拉回再拍一次；三次两两比对。
//   2. dist-tag 策略：预发布版本（版本号里带「-」）发布后 latest 与 beta 都指向新版本；稳定版本发布后只动
//      latest，beta 保持发布前的指向。发布前按当前指向算出「应该变成什么」，发布后读回来核对。
//
// 为什么比对的是解包后的逐文件清单，而不是整个 tarball 的哈希：npm 打包时会写入自己生成的元数据（时间戳、
// 打包顺序里的小差异），同一个目录打两次包整体哈希都可能不同，那样比出来的差异说明不了内容变了。
// 逐文件 sha256 只认内容：文件内容一样清单就一定一样，与打包过程无关。
//
// 本脚本不做任何 npm 调用，也不碰网络：调用 npm 的地方在 scripts/publish-token.ps1（Windows 上 npm 是 .cmd，
// 从 Node 里 spawn 要绕一层 shell 引号，容易出与业务无关的怪问题）。这里只做纯计算，输入是文件，输出是文件加
// 一行机器可读的结论。PowerShell 那侧负责：跑命令、把 JSON 送到这里、按退出码决定继续还是停。
//
// 用法（四个子命令，都在仓库根跑）：
//   node scripts/release-integrity.mts manifest --tarball <tgz> --out <json> [--name <包名>] [--version <版本>]
//   node scripts/release-integrity.mts compare --expected <json> --actual <json>
//   node scripts/release-integrity.mts tags-plan --version <版本> --before <json> --out <plan.json>
//   node scripts/release-integrity.mts tags-verify --version <版本> --plan <plan.json> --after <json>
// 退出码：0=一致/可行；1=对不上（差异、策略不许、指向不符）；2=用法或读文件出错。
//
// 结论行的标记（publish-token.ps1 与门禁都认这些字面量，改字面前先全仓搜一遍标记名）：
//   MANIFEST-OK / MANIFEST-FAIL
//   COMPARE-SAME / COMPARE-DIFF / COMPARE-SUMMARY
//   TAG-PLAN / TAG-PLAN-FAIL
//   TAG-VERIFY-OK / TAG-VERIFY-FAIL

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

/** 一个文件在包里的样子：包里相对路径、字节数、内容 sha256。 */
export type ManifestFile = {
  path: string
  size: number
  sha256: string
}

/**
 * 一个包（一个 tarball）的逐文件清单。
 *
 * digest 是「清单的指纹」：把所有「sha256 + 两个空格 + 路径」排成行、按路径排序后拼起来，再整体算一次 sha256。
 * 它让「两包文件一样吗」这件事可以先用一个短串回答；真正不一样的细节看 files 里逐项对。
 */
export type Manifest = {
  name: string
  version: string
  fileCount: number
  totalBytes: number
  digest: string
  files: ManifestFile[]
}

/** 从 npm 读到的 dist-tag 指向。没配某个 tag 时对应字段不存在。 */
export type TagsSnapshot = {
  latest?: string
  beta?: string
}

/** 预发布版本与稳定版本的发布策略不一样，用 kind 分开，后续判据各自只认自己的字段。 */
export type TagKind = 'prerelease' | 'stable'

/** 发布前算出来的「应该变成什么」，发布后拿它核对实际指向。 */
export type TagPlan = {
  version: string
  kind: TagKind
  publishTag: 'beta' | 'latest'
  /** 预发布版本发布后要把 latest 也指过去（npm publish --tag beta 只动 beta，不动 latest）。 */
  addLatest: boolean
  expectedLatest: string
  /** 稳定版本发布后 beta 要保持发布前的指向；发布前没有 beta 时为 null。 */
  expectedBeta: string | null
  before: TagsSnapshot
}

type PlanResult = { ok: true; plan: TagPlan } | { ok: false; problems: string[] }

type VerifyResult = { ok: boolean; problems: string[] }

type Semver = {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

const TAR_BLOCK_SIZE = 512

/** npm 的 tarball 统一把内容放在 package/ 目录下；清单里去掉这一层，路径就与仓库里 files 白名单的写法一致。 */
const NPM_TARBALL_PREFIX = 'package/'

/**
 * 数一个小整数：tar 的元数据字段有两种写法（POSIX 的八进制文本、GNU 的 base-256 大端字节）。
 * 只认八进制时，一旦遇到大文件（字段放不下）就会把后面所有头的偏移全算错，那时报出来的会是
 * 「随机位置有坏头」这种看不出原因的错。两种都认，编译器就不必替我们猜。
 */
function readTarNumber(buffer: Buffer, start: number, length: number): number {
  if (buffer[start] & 0x80) {
    let value = 0
    for (let index = start + 1; index < start + length; index += 1) {
      value = value * 256 + buffer[index]
    }
    return value
  }
  return readTarString(buffer, start, length).trim() === ''
    ? 0
    : Number.parseInt(readTarString(buffer, start, length).trim(), 8)
}

/** 读一个 NUL 结尾的字段：tar 头里的路径、名字都是这种。 */
function readTarString(buffer: Buffer, start: number, length: number): string {
  let end = start
  const limit = start + length
  while (end < limit && buffer[end] !== 0) end += 1
  return buffer.toString('utf8', start, end)
}

/**
 * 校验一个 tar 头：把 checksum 字段当空格占位后求和，与头里记的值比。
 *
 * 校验它不是形式主义：npm 的 tarball 是 gzip 过的流，解压后如果中途读错一个字节，后面会把文件内容
 * 当成头来解析、算出一份看起来正常但完全错的清单。那比报错更糟（会误判「字节对得上」）。
 */
function assertTarHeaderChecksum(header: Buffer, offset: number): void {
  let sum = 0
  for (let index = 0; index < TAR_BLOCK_SIZE; index += 1) {
    const isChecksumField = index >= 148 && index < 156
    sum += isChecksumField ? 0x20 : header[index]
  }
  const expected = readTarNumber(header, 148, 8)
  if (sum !== expected) {
    throw new Error(
      '解包出的 tar 在偏移 ' + String(offset) + ' 处的文件头校验和不对（算出 ' + String(sum) + '，头里写 ' + String(expected) + '）：' +
        '这个 tarball 可能不完整，或者不是 npm 打的标准 tar。',
    )
  }
}

/** pax 扩展头（typeflag 'x'）的内容是「长度 键=值\n」的记录流；这里只认 path 与 size，其余原样跳过。 */
function applyPaxRecords(data: Buffer, state: { path?: string; size?: number }): void {
  let cursor = 0
  const text = data.toString('utf8')
  while (cursor < text.length) {
    const space = text.indexOf(' ', cursor)
    if (space < 0) break
    const recordLength = Number.parseInt(text.slice(cursor, space), 10)
    if (!Number.isFinite(recordLength) || recordLength <= 0) break
    const record = text.slice(space + 1, cursor + recordLength)
    const newline = record.indexOf('\n')
    const body = newline >= 0 ? record.slice(0, newline) : record
    const equals = body.indexOf('=')
    if (equals > 0) {
      const key = body.slice(0, equals)
      const value = body.slice(equals + 1)
      if (key === 'path') state.path = value
      else if (key === 'size') state.size = Number.parseInt(value, 10)
    }
    cursor += recordLength
  }
}

/**
 * 读一个未压缩的 tar 缓冲，返回其中每个普通文件的路径、字节数与内容 sha256。
 *
 * 只处理发布包里真会出现的头类型：普通文件（'0'）、目录（'5'，跳过）、pax 扩展头（'x'）、
 * GNU 长路径（'L'）、GNU 长链接名（'K'，跳过）。链接（'1'/'2'）与设备文件不会出现在 npm 包里，
 * 遇到了直接报错而不是猜——猜错会安静地少列一个文件，而少列的文件正好是「对账漏掉」的那一类。
 */
export function readTarEntries(tarBytes: Buffer, onFile?: (filePath: string, payload: Buffer) => void): ManifestFile[] {
  const entries: ManifestFile[] = []
  let offset = 0
  let nextPath: string | null = null
  let paxState: { path?: string; size?: number } = {}

  while (offset + TAR_BLOCK_SIZE <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + TAR_BLOCK_SIZE)
    // 连续两个全零块表示归档结束；有些实现只写一个，遇到全零就直接收尾即可。
    let allZero = true
    for (let index = 0; index < TAR_BLOCK_SIZE; index += 1) {
      if (header[index] !== 0) {
        allZero = false
        break
      }
    }
    if (allZero) break

    assertTarHeaderChecksum(header, offset)

    const typeflag = String.fromCharCode(header[156] || 0x30)
    const headerSize = readTarNumber(header, 124, 12)
    const size = paxState.size !== undefined ? paxState.size : headerSize
    const dataStart = offset + TAR_BLOCK_SIZE
    const dataEnd = dataStart + size
    if (dataEnd > tarBytes.length) {
      throw new Error('解包出的 tar 在偏移 ' + String(offset) + ' 处的文件声明了 ' + String(size) + ' 字节，但缓冲里只剩 ' + String(tarBytes.length - dataStart) + ' 字节：包被截断了。')
    }
    const dataBlockCount = Math.ceil(size / TAR_BLOCK_SIZE)
    const nextOffset = dataStart + dataBlockCount * TAR_BLOCK_SIZE

    if (typeflag === 'x') {
      applyPaxRecords(tarBytes.subarray(dataStart, dataEnd), paxState)
    } else if (typeflag === 'g') {
      // 全局 pax 头对后面所有文件都生效；npm 不用它。真遇到了，说明来源不是 npm pack，宁可直接报错。
      throw new Error('发布包里出现了全局 pax 扩展头（typeflag g），本脚本不支持：请确认这个 tarball 是 npm pack 打出来的。')
    } else if (typeflag === 'L') {
      nextPath = readTarString(tarBytes, dataStart, size).replace(/\0+$/, '')
    } else if (typeflag === 'K') {
      // GNU 长链接名：只对符号链接有意义，npm 包没有链接，记住但不用。
    } else if (typeflag === '0' || typeflag === '\0' || typeflag === '7') {
      const headerName = readTarString(header, 0, 100)
      const headerPrefix = readTarString(header, 345, 155)
      const ustarName = headerPrefix ? headerPrefix + '/' + headerName : headerName
      const rawPath = paxState.path !== undefined ? paxState.path : nextPath !== null ? nextPath : ustarName
      const filePath = normalizeTarballPath(rawPath)
      const payload = tarBytes.subarray(dataStart, dataEnd)
      entries.push({
        path: filePath,
        size: payload.length,
        sha256: createHash('sha256').update(payload).digest('hex'),
      })
      if (onFile) onFile(filePath, payload)
    } else if (typeflag === '5') {
      // 目录不落文件清单：tarball 里目录项本身没有内容，清单只回答「发出去的文件是哪些」。
    } else if (typeflag === '1' || typeflag === '2' || typeflag === '3' || typeflag === '4' || typeflag === '6') {
      throw new Error('发布包里出现了链接或设备文件（typeflag ' + typeflag + '）：npm 打出来的包不应该有这些东西，先确认 tarball 来源。')
    } else {
      throw new Error('发布包里出现了不认识的 tar 头类型（typeflag ' + JSON.stringify(typeflag) + '），无法安全地列清单。')
    }

    // pax（'x'）与 GNU 长名（'L'）/长链接名（'K'）都是「给下一个文件用的元数据头」：读到它们时
    // 不能把刚记下的状态清掉，否则长路径会被静默丢掉、退回被截断的头名（照样能列出文件，但路径是错的）。
    if (typeflag !== 'x' && typeflag !== 'L' && typeflag !== 'K') {
      // 覆盖只对紧接着的那一个文件生效；下一轮开始前必须清掉，否则会拿上一个文件的 path/size 去解释下一个头。
      paxState = {}
      nextPath = null
    }
    offset = nextOffset
  }

  if (entries.length === 0) {
    throw new Error('发布包里一个普通文件都没读到：要么 tarball 是空的，要么 tar 结构不是标准 ustar/pax。')
  }
  return entries
}

/** 去掉 tar 里的顶层 package/ 前缀与「./」写法；路径里出现 .. 说明包结构不对，直接报错。 */
function normalizeTarballPath(rawPath: string): string {
  let filePath = rawPath.replace(/^\.\//, '').replace(/\\/g, '/')
  if (filePath.startsWith(NPM_TARBALL_PREFIX)) filePath = filePath.slice(NPM_TARBALL_PREFIX.length)
  if (filePath === '' || filePath.endsWith('/')) throw new Error('发布包里有一个空的或目录形式的文件路径：' + JSON.stringify(rawPath))
  if (filePath.split('/').includes('..')) throw new Error('发布包里有一个带 .. 的路径，拒绝了：' + JSON.stringify(rawPath))
  return filePath
}

/** 读 tarball 文件（.tgz）并列出清单：先按 gzip 魔数解压，不是 gzip 时按未压缩 tar 处理（便于用夹具测试）。
 *
 * onFile 是给调用方取原始内容的回调：清单只留路径、字节数与 sha256，而取包名/版本这类元数据
 * 需要 package.json 的原文。带上回调就能在同一趟里读完，不必为了元数据把 tarball 再解压一遍。
 */
export function readTarballEntries(tarballPath: string, onFile?: (filePath: string, payload: Buffer) => void): ManifestFile[] {
  const raw = readFileSync(tarballPath)
  const isGzip = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b
  const tarBytes = isGzip ? gunzipSync(raw) : raw
  return readTarEntries(tarBytes, onFile)
}

/** 清单指纹：文件按路径排序后，每行「sha256 + 两个空格 + 路径」，整体再算 sha256。 */
export function digestOfFiles(files: ManifestFile[]): string {
  const lines = files
    .map((file) => ({ ...file }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map((file) => file.sha256 + '  ' + file.path)
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

/** 把逐文件清单组装成带统计与指纹的 Manifest；name/version 只是给人看的元数据，不参与比对。 */
export function buildManifest(entries: ManifestFile[], meta: { name?: string; version?: string } = {}): Manifest {
  const files = entries
    .map((entry) => ({ path: entry.path, size: entry.size, sha256: entry.sha256 }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  return {
    name: meta.name || '(未知)',
    version: meta.version || '(未知)',
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    digest: digestOfFiles(files),
    files,
  }
}

/** 比对结果里的一处差异。missing=预期有、实际没有；extra=实际有、预期没有；changed=两边都有但内容不同。 */
export type ManifestDiff = {
  kind: 'changed' | 'missing' | 'extra'
  path: string
  expectedSha: string | null
  actualSha: string | null
}

export type ManifestComparison = {
  same: boolean
  changed: ManifestDiff[]
  missing: ManifestDiff[]
  extra: ManifestDiff[]
}

/**
 * 逐文件比对两份清单。
 *
 * 按路径集合比，不按顺序比：npm 往 tarball 里写文件的顺序不保证稳定，顺序不同但内容相同应算一致。
 * 差异按 changed → missing → extra 分组，每组按路径排序，这样第一处差异总是确定的那一条，
 * 发布脚本把它打出来时，人看到的就是「最先该查的那一处」。
 */
export function compareManifests(expected: Manifest, actual: Manifest): ManifestComparison {
  const expectedByPath = new Map<string, ManifestFile>()
  for (const file of expected.files) expectedByPath.set(file.path, file)
  const actualByPath = new Map<string, ManifestFile>()
  for (const file of actual.files) actualByPath.set(file.path, file)

  const changed: ManifestDiff[] = []
  const missing: ManifestDiff[] = []
  const extra: ManifestDiff[] = []
  const paths = Array.from(new Set([...expectedByPath.keys(), ...actualByPath.keys()])).sort()

  for (const filePath of paths) {
    const left = expectedByPath.get(filePath)
    const right = actualByPath.get(filePath)
    if (left && !right) {
      missing.push({ kind: 'missing', path: filePath, expectedSha: left.sha256, actualSha: null })
    } else if (!left && right) {
      extra.push({ kind: 'extra', path: filePath, expectedSha: null, actualSha: right.sha256 })
    } else if (left && right && left.sha256 !== right.sha256) {
      changed.push({ kind: 'changed', path: filePath, expectedSha: left.sha256, actualSha: right.sha256 })
    }
  }

  return {
    same: changed.length === 0 && missing.length === 0 && extra.length === 0,
    changed,
    missing,
    extra,
  }
}

/** 解析语义化版本；允许前面带 v。解析不了返回 null（调用方给出人看得懂的错误）。 */
export function parseSemver(text: string): Semver | null {
  const matched = /^[vV]?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(text).trim())
  if (!matched) return null
  return {
    major: Number.parseInt(matched[1], 10),
    minor: Number.parseInt(matched[2], 10),
    patch: Number.parseInt(matched[3], 10),
    prerelease: matched[4] ? matched[4].split('.') : [],
  }
}

/**
 * 比较两个版本号的大小（按语义化版本的优先级规则）：返回负数表示 a 更旧，0 相等，正数表示 a 更新。
 * 只要有一个解析不了就抛错——发布路径上宁可停住，也不要用一个猜出来的顺序决定要不要往回推 tag。
 */
export function compareVersions(left: string, right: string): number {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (!a || !b) {
    throw new Error('比较版本号时遇到了不合法的版本：' + JSON.stringify(left) + ' / ' + JSON.stringify(right))
  }
  if (a.major !== b.major) return a.major > b.major ? 1 : -1
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const leftNumeric = /^\d+$/.test(leftPart)
    const rightNumeric = /^\d+$/.test(rightPart)
    if (leftNumeric && rightNumeric) {
      const leftValue = Number.parseInt(leftPart, 10)
      const rightValue = Number.parseInt(rightPart, 10)
      if (leftValue !== rightValue) return leftValue > rightValue ? 1 : -1
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1
    } else if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1
    }
  }
  return 0
}

/** 解析 npm view <包> dist-tags --json 的输出：空串或空对象都当作「一个 tag 都没有」。 */
export function parseTagsJson(text: string): TagsSnapshot {
  const trimmed = String(text || '').trim()
  if (!trimmed) return {}
  let parsed: any
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    throw new Error('读 dist-tag 的输出不是合法 JSON：' + String(error) + '；原文前 200 字：' + trimmed.slice(0, 200))
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('读 dist-tag 的输出不是一个对象，看不懂：' + trimmed.slice(0, 200))
  }
  const snapshot: TagsSnapshot = {}
  if (typeof parsed.latest === 'string' && parsed.latest !== '') snapshot.latest = parsed.latest
  if (typeof parsed.beta === 'string' && parsed.beta !== '') snapshot.beta = parsed.beta
  return snapshot
}

/**
 * 按版本形态与当前 dist-tag 指向，算出发完这一版之后 tag 应该指向哪里。
 *
 * 约定（#1648 定，见 RELEASE-RUNBOOK.md 的「发布后机器判据」一节）：
 *   - 预发布版本（1.2.3-beta.4 这种带「-」的）：publish 用 --tag beta，再手动把 latest 也指过去；
 *     发完 latest 与 beta 都等于新版本。npm publish --tag beta 只写 beta，不动 latest，所以必须补一步。
 *   - 稳定版本（1.2.3）：publish 用 --tag latest；beta 保持发布前的指向不动。稳定版发布不代表
 *     预发布通道结束，beta 应该继续指向上一个预发布号，方便下一轮 beta 从那里继续。
 *
 * 发布前还要挡住两类明显不对的状态：beta 指向一个正式版本（约定里 beta 只放预发布号），以及
 * 新版本比要覆盖的 tag 还旧（那会让 latest/beta 往回退）。只做这两类检查，不做更多猜测。
 * 由此有一个已知的保守取舍：预发布会把 latest 指到 2.0.0-beta.1 这种号上，之后若想补发旧线
 * 1.9.1 的稳定版，会因为「不比 latest 新」被拦下。跨版本线的补发要人工拍板（先定 latest 该指向
 * 哪里），不交给脚本自动放行。
 */
export function planTags(input: { version: string; before: TagsSnapshot }): PlanResult {
  const problems: string[] = []
  const version = String(input.version || '').trim().replace(/^[vV]/, '')
  const parsed = parseSemver(version)
  if (!parsed) {
    return { ok: false, problems: ['版本号「' + version + '」不是合法的语义化版本（形如 1.2.3 或 1.2.3-beta.1）。'] }
  }
  const before: TagsSnapshot = {}
  if (input.before.latest) before.latest = input.before.latest
  if (input.before.beta) before.beta = input.before.beta

  const kind: TagKind = parsed.prerelease.length > 0 ? 'prerelease' : 'stable'

  if (before.beta) {
    const betaParsed = parseSemver(before.beta)
    if (!betaParsed) {
      problems.push('beta 当前指向「' + before.beta + '」，这不是一个合法的版本号：先人工核对 registry 上的 beta。')
    } else if (betaParsed.prerelease.length === 0) {
      problems.push('beta 当前指向正式版本「' + before.beta + '」，按约定 beta 只放预发布版本。先人工把它改回一个预发布号或删掉，再发布。')
    }
  }

  if (kind === 'prerelease') {
    if (before.latest && compareVersions(version, before.latest) < 0) {
      problems.push('要发布的「' + version + '」比 latest 当前指向的「' + before.latest + '」更旧：预发布不许把 latest 往回推。')
    }
    if (before.beta && compareVersions(version, before.beta) <= 0) {
      problems.push('要发布的「' + version + '」不比 beta 当前指向的「' + before.beta + '」更新：发布新预发布版必须比上一个 beta 新。')
    }
    if (problems.length > 0) return { ok: false, problems }
    return {
      ok: true,
      plan: {
        version,
        kind,
        publishTag: 'beta',
        addLatest: true,
        expectedLatest: version,
        expectedBeta: version,
        before,
      },
    }
  }

  if (before.latest && compareVersions(version, before.latest) <= 0) {
    problems.push('要发布的稳定版「' + version + '」不比 latest 当前指向的「' + before.latest + '」更新：发布新版本必须比 latest 新。')
  }
  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    plan: {
      version,
      kind,
      publishTag: 'latest',
      addLatest: false,
      expectedLatest: version,
      expectedBeta: before.beta ? before.beta : null,
      before,
    },
  }
}

/**
 * 发布后读回 registry 的 dist-tag，核对是否符合计划。
 * 每个不符的 tag 单独记一行：latest 与 beta 都错时，人要能一次看到两处，而不是改一个再发现下一个。
 */
export function verifyTags(input: { version: string; plan: TagPlan; after: TagsSnapshot }): VerifyResult {
  const problems: string[] = []
  const version = String(input.version || '').trim().replace(/^[vV]/, '')
  if (version !== input.plan.version) {
    problems.push('核对用的版本「' + version + '」与发布计划里的「' + input.plan.version + '」不一致：计划文件可能拿错了。')
  }
  const after = input.after || {}
  if (after.latest !== input.plan.expectedLatest) {
    problems.push('latest 期望是「' + input.plan.expectedLatest + '」，实际是「' + (after.latest || '（不存在）') + '」。')
  }
  if (input.plan.kind === 'prerelease') {
    if (after.beta !== input.plan.expectedBeta) {
      problems.push('beta 期望是「' + (input.plan.expectedBeta || '（不存在）') + '」，实际是「' + (after.beta || '（不存在）') + '」。')
    }
  } else {
    const expectedBeta = input.plan.expectedBeta || '（不存在）'
    const actualBeta = after.beta || '（不存在）'
    if ((input.plan.expectedBeta || null) !== (after.beta || null)) {
      problems.push('beta 按策略应保持发布前的指向「' + expectedBeta + '」，实际是「' + actualBeta + '」。')
    }
  }
  return { ok: problems.length === 0, problems }
}

/** 把清单写成一个文件（给编排脚本的下一步读）；两空格缩进便于人直接看。 */
export function writeManifestFile(filePath: string, manifest: Manifest): void {
  writeFileSync(filePath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
}

/** 读一个 JSON 文件；读不到或不是对象都抛错，错误里带路径，排错时不用猜是哪个文件。 */
function readJsonFile(filePath: string): any {
  const text = readJsonText(filePath)
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error('「' + filePath + '」不是合法 JSON：' + String(error))
  }
}

/**
 * 从 tarball 里的 package.json 原文兜底取 name/version：调用方没传时，清单文件里也能看出这是哪个包。
 *
 * 包名与版本不参与比对（比对只认文件路径与内容），所以这里读不出来也不算错：返回空对象，
 * 清单里就写「(未知)」。真正要紧的是文件清单，这一点不能因为元数据读不到而受影响。
 */
function metaFromPackageJsonText(packageJsonText: string): { name?: string; version?: string } {
  if (!packageJsonText) return {}
  try {
    const parsed = JSON.parse(packageJsonText)
    return {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      version: typeof parsed.version === 'string' ? parsed.version : undefined,
    }
  } catch (error) {
    void error
    return {}
  }
}

type CommandOptions = Record<string, string>

function parseCommandArgs(argv: string[]): { command: string; options: CommandOptions } {
  const command = argv[0] || ''
  const options: CommandOptions = {}
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      throw new Error('不认识的参数：' + arg + '（参数都写成 --名字 值 的形式）')
    }
    const value = argv[index + 1]
    if (value === undefined) throw new Error('参数 ' + arg + ' 后面缺值。')
    options[arg.slice(2)] = value
    index += 1
  }
  return { command, options }
}

function requireOption(options: CommandOptions, name: string): string {
  const value = options[name]
  if (!value) throw new Error('缺参数 --' + name + '。')
  return value
}

/** 打印一处差异，路径与两个哈希都给全：人拿到这一行就能去两边各查一个文件。 */
function formatDiff(diff: ManifestDiff): string {
  return 'COMPARE-DIFF path=' + diff.path + ' expected=' + (diff.expectedSha || '（缺）') + ' actual=' + (diff.actualSha || '（缺）')
}

function runManifest(options: CommandOptions): void {
  const tarballPath = requireOption(options, 'tarball')
  const outPath = requireOption(options, 'out')
  // 一次解压读完清单与 package.json：meta 只用来给人看这是哪个包，读不出来不影响对账本身。
  let packageJsonText = ''
  const entries = readTarballEntries(tarballPath, (filePath: string, payload: Buffer) => {
    if (filePath === 'package.json') packageJsonText = payload.toString('utf8')
  })
  const meta = metaFromPackageJsonText(packageJsonText)
  const manifest = buildManifest(entries, {
    name: options.name || meta.name,
    version: options.version || meta.version,
  })
  writeManifestFile(outPath, manifest)
  console.log(
    'MANIFEST-OK name=' + manifest.name + ' version=' + manifest.version + ' files=' + String(manifest.fileCount) +
      ' bytes=' + String(manifest.totalBytes) + ' digest=' + manifest.digest,
  )
}

function runCompare(options: CommandOptions): void {
  const expectedPath = requireOption(options, 'expected')
  const actualPath = requireOption(options, 'actual')
  const expected = readJsonFile(expectedPath) as Manifest
  const actual = readJsonFile(actualPath) as Manifest
  if (!expected || !Array.isArray(expected.files)) throw new Error('「' + expectedPath + '」不是本脚本生成的清单文件（没有 files 数组）。')
  if (!actual || !Array.isArray(actual.files)) throw new Error('「' + actualPath + '」不是本脚本生成的清单文件（没有 files 数组）。')
  const comparison = compareManifests(expected, actual)
  if (comparison.same) {
    console.log('COMPARE-SAME files=' + String(expected.files.length))
    return
  }
  const diffs = [...comparison.changed, ...comparison.missing, ...comparison.extra]
  const limit = 50
  for (const diff of diffs.slice(0, limit)) console.log(formatDiff(diff))
  if (diffs.length > limit) console.log('COMPARE-DIFF 还有 ' + String(diffs.length - limit) + ' 处差异没打印（共 ' + String(diffs.length) + ' 处）。')
  console.log(
    'COMPARE-SUMMARY changed=' + String(comparison.changed.length) + ' missing=' + String(comparison.missing.length) +
      ' extra=' + String(comparison.extra.length) + ' expected=' + String(expected.files.length) + ' actual=' + String(actual.files.length),
  )
  process.exit(1)
}

function runTagsPlan(options: CommandOptions): void {
  const version = requireOption(options, 'version')
  const beforePath = requireOption(options, 'before')
  const outPath = requireOption(options, 'out')
  const before = parseTagsJson(readJsonText(beforePath))
  const result = planTags({ version, before })
  if (!result.ok) {
    for (const problem of result.problems) console.error('TAG-PLAN-FAIL ' + problem)
    process.exit(1)
  }
  writeFileSync(outPath, JSON.stringify(result.plan, null, 2) + '\n', 'utf8')
  console.log(
    'TAG-PLAN kind=' + result.plan.kind + ' publish-tag=' + result.plan.publishTag + ' add-latest=' + (result.plan.addLatest ? 'yes' : 'no') +
      ' expected-latest=' + result.plan.expectedLatest + ' expected-beta=' + (result.plan.expectedBeta || '（不存在）'),
  )
}

/** 读一段文本：dist-tag 的输出是 npm 打出来的 JSON 文本，可能带警告以外的空白，原样交给 parseTagsJson。 */
function readJsonText(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new Error('读不到「' + filePath + '」：' + String(error))
  }
}

function runTagsVerify(options: CommandOptions): void {
  const version = requireOption(options, 'version')
  const planPath = requireOption(options, 'plan')
  const afterPath = requireOption(options, 'after')
  const plan = readJsonFile(planPath) as TagPlan
  if (!plan || !plan.version || !plan.kind) throw new Error('「' + planPath + '」不是本脚本生成的发布计划文件。')
  const after = parseTagsJson(readJsonText(afterPath))
  const result = verifyTags({ version, plan, after })
  if (!result.ok) {
    for (const problem of result.problems) console.error('TAG-VERIFY-FAIL ' + problem)
    process.exit(1)
  }
  console.log('TAG-VERIFY-OK latest=' + (after.latest || '（不存在）') + ' beta=' + (after.beta || '（不存在）'))
}

function main(argv: string[]): void {
  let parsed: { command: string; options: CommandOptions }
  try {
    parsed = parseCommandArgs(argv)
  } catch (error) {
    console.error('RELEASE-INTEGRITY-FAIL ' + String(error))
    process.exit(2)
  }
  try {
    if (parsed.command === 'manifest') runManifest(parsed.options)
    else if (parsed.command === 'compare') runCompare(parsed.options)
    else if (parsed.command === 'tags-plan') runTagsPlan(parsed.options)
    else if (parsed.command === 'tags-verify') runTagsVerify(parsed.options)
    else {
      console.error(
        'RELEASE-INTEGRITY-FAIL 不认识的子命令「' + parsed.command + '」。可用：manifest / compare / tags-plan / tags-verify。',
      )
      process.exit(2)
    }
  } catch (error) {
    console.error('RELEASE-INTEGRITY-FAIL ' + String(error))
    process.exit(2)
  }
}

const invokedDirectly = (() => {
  try {
    return resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url))
  } catch (error) {
    void error
    return false
  }
})()

if (invokedDirectly) main(process.argv.slice(2))
