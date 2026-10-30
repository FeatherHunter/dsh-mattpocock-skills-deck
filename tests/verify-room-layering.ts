// tests/verify-room-layering.ts —— 门禁：GitHub 房间九目录分层、依赖只向下、传输唯一 gh 出口、新代码不从旧路径导入（#1684）
// 门禁归属: src/tracker/rooms/github
//
// 为什么要有一条专门的房间分层门禁：
// GitHub 房间原来是一个平铺目录，38 个文件互相引用，谁也说不清哪一层能调哪一层。
// 规格 #1681 要把房间拆成九类职责目录，并让「传输层是 gh 命令的唯一出口」从注释约定变成可执行的判据。
// 只靠人记约定会随着文件增多失效，所以这里把 ADR 20261030-github-room-channel-layering 第 2 章与第 3 章
// 的表格直接写成检查：
//   1. 九个职责目录必须存在（transport、channels/graphql、channels/rest、routing、read、write、model、room、support）。
//   2. 依赖只能向下：room → read/write → routing → channels → transport；model 与 support 是共享下层。
//      同一层里 read 与 write 互不引用，channels/graphql 与 channels/rest 互不引用。
//   3. channels 不得引用 routing/read/write/room——它只认 transport 与 support，不能反向依赖上游。
//   4. 房间内除 transport/ 外不得出现直接执行 gh、拿 gh 执行器、导入 child_process 的代码；transport/ 必须真的有一处，
//      否则「唯一出口」只是把目录建出来、gh 调用还留在别处。
//      房间里的 git 探测（backend.ts、repo.ts 经 ctx.exec 起 git）不算 gh 传输，这里不拦——它不是 gh 调用，
//      也不能为了门禁好看就把这些探测硬塞进传输层。
//   5. 已经搬走的旧平铺文件只留纯转发器；新分层里的文件若还从这些旧路径导入，判红。
//      非转发器的旧文件（例如尚未搬走的 errors.ts）在迁移期允许被导入，因为 1686/1687 才轮到它们。
//
// 判据怎么自证：门禁最怕自己写错以后一直报绿。这里用内存样例做三向自证——
// 一份合规样例必须绿；缺目录、反向依赖、channels 越界、通道互引、传输外起进程、旧路径导入、坏转发器
// 各来一份负例，必须逐条判红。样例不落盘，避免在 tests/fixtures 下养一堆一次性小文件。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-room-layering.ts
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const ROOM_REL = 'src/tracker/rooms/github'
const ROOM = path.join(ROOT, ROOM_REL)

/** 九个职责目录。顺序即依赖层级：越靠前越底层。 */
const LAYERS = ['transport', 'channels/graphql', 'channels/rest', 'routing', 'read', 'write', 'model', 'room', 'support']

/**
 * 允许的层间依赖。键是导入方，值是它可以直接引用的层。
 * 同一层内互相引用是允许的（层内拆文件不算跨层依赖，例如 routing/ 里组装函数引用同层的取数轨迹）；
 * 表里 transport/model/routing 把自己写进允许清单就是这条的机器表达。
 * support 在最底层，任何层都可以引用它；transport 也要用它的错误分类与用量计数，所以这一格多了 support。
 * model 也可以引用 transport：仓库身份与远端探测经客户端出手，本层不直接起进程；反过来 transport 不许引用 model。
 * 这张表是 ADR 第 2 章的机器可读版本：改分层先改 ADR，再改这里，不要只改这里。
 */
const ALLOWED: Record<string, string[]> = {
  transport: ['transport', 'support'],
  support: [],
  model: ['model', 'transport'],
  'channels/graphql': ['transport', 'support'],
  'channels/rest': ['transport', 'support'],
  routing: ['routing', 'channels/graphql', 'channels/rest', 'model', 'support', 'transport'],
  read: ['routing', 'model', 'support', 'transport'],
  write: ['routing', 'model', 'support', 'transport'],
  room: ['read', 'write', 'routing', 'model', 'support', 'transport'],
}

const CHANNELS = ['channels/graphql', 'channels/rest']
/** channels 碰了这些层就是反向依赖上游。 */
const CHANNEL_UPSTREAM = ['routing', 'read', 'write', 'room']

interface Tree {
  /** 相对仓库根的 posix 路径 → 源码文本。 */
  files: Map<string, string>
  /** 相对仓库根的 posix 路径集合，含空目录。 */
  dirs: Set<string>
}

interface Violation {
  kind: string
  where: string
  message: string
}

interface ImportRef {
  spec: string
  line: number
}

/** 去注释，保留换行，避免把注释里的示例当成真代码。行注释要放过 https:// 里的两个斜杠。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\w])\/\/[^\n]*/g, (match, lead: string) => lead + ' '.repeat(Math.max(0, match.length - lead.length)))
}

const FROM_RE = /\bfrom\s*['"]([^'"]+)['"]/g
const BARE_IMPORT_RE = /\bimport\s*['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

/** 抓出所有静态/动态导入与 require；按“行号 + 说明符”去重。 */
function importsOf(source: string): ImportRef[] {
  const found: ImportRef[] = []
  const seen = new Set<string>()
  for (const re of [FROM_RE, BARE_IMPORT_RE, DYNAMIC_IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(source))) {
      const line = lineOf(source, match.index)
      const key = line + ':' + match[1]
      if (seen.has(key)) continue
      seen.add(key)
      found.push({ spec: match[1], line })
    }
  }
  return found
}

/**
 * 直接执行 gh、拿 gh 执行器、导入 child_process 的写法。prod 代码里只有 transport/ 可以命中。
 * 注意只看 gh：backend.ts 与 repo.ts 用 ctx.exec 起 git 探测仓库身份，那是 git 不是 gh，不属于传输层要收的出口。
 */
const PROCESS_PATTERNS: [string, RegExp][] = [
  ['spawn-gh', /\b(?:subprocess\s*\.\s*)?spawnSync?\s*\(\s*['"]gh['"]/g],
  ['exec-gh', /\bexec(?:File|FileSync)?\s*\(\s*['"]gh['"]/g],
  ['gh-executor', /\bgetExec\s*\(|\b(?:execProc|runGh)\s*\(/g],
  ['child_process', /\bfrom\s*['"](?:node:)?child_process['"]|\brequire\s*\(\s*['"](?:node:)?child_process['"]\s*\)/g],
]

function scanProcess(source: string): { pattern: string; line: number; text: string }[] {
  const hits: { pattern: string; line: number; text: string }[] = []
  for (const [pattern, re] of PROCESS_PATTERNS) {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(source))) {
      hits.push({ pattern, line: lineOf(source, match.index), text: match[0].trim() })
    }
  }
  return hits
}

function insideRoom(rel: string): boolean {
  return rel.startsWith(ROOM_REL + '/')
}

/** 文件属于哪一层；房间根下的旧平铺文件返回 null。 */
function layerOf(rel: string): string | null {
  if (!insideRoom(rel)) return null
  const rest = rel.slice(ROOM_REL.length + 1)
  for (const layer of LAYERS) {
    if (rest === layer || rest.startsWith(layer + '/')) return layer
  }
  return null
}

/** 把相对说明符规范成“相对仓库根、去掉扩展名”的路径；包名等非相对说明符返回 null。 */
function resolveRelative(importer: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(importer), spec))
  return joined.replace(/\.d\.ts$/, '').replace(/\.(?:js|ts|mjs|cjs)$/, '')
}

function fileExists(tree: Tree, stem: string): boolean {
  return tree.files.has(stem + '.ts') || tree.files.has(stem + '.js') || tree.files.has(stem + '.d.ts')
}

/**
 * 纯旧路径转发器：去注释后每个非空行都是 `export * from './x.js'` 或 `export { ... } from './x.js'`。
 * 转发器只许是这一种形状，形状不对就不是转发器，门禁按普通旧文件对待。
 */
function forwarderSpecs(source: string): string[] | null {
  const lines = stripComments(source).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return null
  const specs: string[] = []
  for (const line of lines) {
    const match = line.match(/^export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"](\.[^'"]+)['"];?$/)
    if (!match) return null
    specs.push(match[1])
  }
  return specs
}

function forwarderText(tree: Tree, stem: string): string | null {
  if (tree.files.has(stem + '.ts')) return tree.files.get(stem + '.ts') as string
  if (tree.files.has(stem + '.js')) return tree.files.get(stem + '.js') as string
  return null
}

function isForwarderAt(tree: Tree, stem: string): boolean {
  const text = forwarderText(tree, stem)
  return text !== null && forwarderSpecs(text) !== null
}

/** 判一棵树。真树与内存样例共用这一份逻辑，避免“样例绿、真树另一套规则”。 */
function judge(tree: Tree): Violation[] {
  const violations: Violation[] = []

  for (const layer of LAYERS) {
    if (!tree.dirs.has(ROOM_REL + '/' + layer)) {
      violations.push({ kind: 'missing-dir', where: ROOM_REL + '/' + layer, message: '职责目录不存在：' + layer })
    }
  }

  let transportHasExit = false
  for (const [rel, text] of tree.files) {
    const source = stripComments(text)
    const layer = layerOf(rel)
    const hits = scanProcess(source)
    if (layer === 'transport') {
      if (hits.length > 0) transportHasExit = true
    } else {
      for (const hit of hits) {
        violations.push({
          kind: 'process-outside-transport',
          where: rel + ':' + hit.line,
          message: (layer ?? '旧平铺文件') + '里直接起进程或拿执行器（' + hit.text + '）；gh 调用只许留在 transport/',
        })
      }
    }

    for (const imp of importsOf(source)) {
      const target = resolveRelative(rel, imp.spec)
      if (!target || !insideRoom(target)) continue
      const importerLayer = layer
      const targetLayer = layerOf(target)
      if (targetLayer === null) {
        // 旧路径：目标若是转发器，说明文件已经搬走，新分层不许再走旧路径。
        if (importerLayer !== null && isForwarderAt(tree, target)) {
          violations.push({
            kind: 'legacy-forwarder',
            where: rel + ':' + imp.line,
            message: importerLayer + ' 仍从旧路径 ' + imp.spec + ' 导入；该路径只是转发器，请不要从旧路径导入',
          })
        }
        continue
      }
      if (importerLayer === null) continue
      if (ALLOWED[importerLayer].includes(targetLayer)) continue
      if (CHANNELS.includes(importerLayer) && CHANNEL_UPSTREAM.includes(targetLayer)) {
        violations.push({
          kind: 'channels-upstream',
          where: rel + ':' + imp.line,
          message: importerLayer + ' 反向引用了上游 ' + targetLayer + '；channels 只能依赖 transport 与 support',
        })
        continue
      }
      if (CHANNELS.includes(importerLayer) && CHANNELS.includes(targetLayer)) {
        violations.push({
          kind: 'channels-cross',
          where: rel + ':' + imp.line,
          message: importerLayer + ' 与 ' + targetLayer + ' 必须互不引用，两套通道只在 routing 汇合',
        })
        continue
      }
      violations.push({
        kind: 'direction',
        where: rel + ':' + imp.line,
        message: importerLayer + ' 不允许引用 ' + targetLayer + '；依赖只能向下（room → read/write → routing → channels → transport）',
      })
    }
  }

  if (!transportHasExit) {
    violations.push({
      kind: 'no-transport-exit',
      where: ROOM_REL + '/transport',
      message: 'transport/ 里没有任何起进程的代码，gh 的唯一出口没有落位',
    })
  }

  // 旧路径转发器必须指到真实存在的层内文件；指空了就等于旧导入静默断掉。
  for (const [rel, text] of tree.files) {
    if (layerOf(rel) !== null) continue
    const specs = forwarderSpecs(text)
    if (specs === null) continue
    for (const spec of specs) {
      const target = resolveRelative(rel, spec)
      if (!target || !insideRoom(target) || layerOf(target) === null || !fileExists(tree, target)) {
        violations.push({
          kind: 'broken-forwarder',
          where: rel,
          message: '旧路径转发器指向 ' + spec + '，但目标不存在或不在任何职责层里',
        })
      }
    }
  }

  return violations
}

// ---------------------------------------------------------------------------
// 真树加载
// ---------------------------------------------------------------------------

function loadTree(): Tree {
  const files = new Map<string, string>()
  const dirs = new Set<string>()
  const relOf = (full: string) => path.relative(ROOT, full).split(path.sep).join('/')
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        dirs.add(relOf(full))
        walk(full)
        continue
      }
      if (!/\.(?:ts|js)$/.test(entry.name)) continue
      files.set(relOf(full), fs.readFileSync(full, 'utf8'))
    }
  }
  walk(ROOM)
  return { files, dirs }
}

// ---------------------------------------------------------------------------
// 自证样例
// ---------------------------------------------------------------------------

const BASE_FILES: Record<string, string> = {
  'transport/client.ts': "export default function run() { return exec('gh', ['--version']) }\n",
  'transport/support.ts': "export const note = 'transport helper'\n",
  'channels/graphql/gql.ts': "import run from '../../transport/client.js'\nexport const query = run\n",
  'channels/rest/rest.ts': "import run from '../../transport/client.js'\nexport const call = run\n",
  'routing/routing.ts': "import { query } from '../channels/graphql/gql.js'\nexport const route = query\n",
  'read/read.ts': "import { route } from '../routing/routing.js'\nexport const read = route\n",
  'write/write.ts': "import { route } from '../routing/routing.js'\nexport const write = route\n",
  'model/model.ts': "export interface Model { id: string }\n",
  'room/room.ts': "import { read } from '../read/read.js'\nexport const room = read\n",
  'support/support.ts': "export const log = 'support'\n",
  'client.ts': "export * from './transport/client.js'\nexport { default } from './transport/client.js'\n",
}

function sampleTree(files: Record<string, string>, missing: string[] = []): Tree {
  const map = new Map<string, string>()
  const dirs = new Set<string>()
  for (const layer of LAYERS) dirs.add(ROOM_REL + '/' + layer)
  for (const [rel, text] of Object.entries(files)) {
    const full = ROOM_REL + '/' + rel
    map.set(full, text)
    let dir = path.posix.dirname(full)
    while (dir.length > ROOM_REL.length) {
      dirs.add(dir)
      dir = path.posix.dirname(dir)
    }
  }
  for (const layer of missing) dirs.delete(ROOM_REL + '/' + layer)
  return { files: map, dirs }
}

const sample = (overrides: Record<string, string>): Tree => sampleTree({ ...BASE_FILES, ...overrides })

// ---------------------------------------------------------------------------
// 跑检查
// ---------------------------------------------------------------------------

let total = 0
let failed = 0
function check(ok: boolean, message: string): void {
  total += 1
  if (!ok) failed += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + message)
}

function report(label: string, violations: Violation[]): void {
  check(violations.length === 0, label + (violations.length === 0 ? ' 判绿' : ' 判红，共 ' + violations.length + ' 条'))
  for (const violation of violations) {
    console.log('       [' + violation.kind + '] ' + violation.where + ' —— ' + violation.message)
  }
}

console.log('GitHub 房间分层门禁（#1684）\n')

// 真树按判据族分别报绿：三件依赖门禁（方向、传输唯一出口、channels 不越界）各自有独立的一行结论，
// 红了也一眼看得出是哪一族越界，不必在一行合并结论里翻明细。任何 judge 产出的新 kind 没被下面覆盖时，
// 由最后那条「没有未分类违规」兜住，不会静默漏判。
const real = loadTree()
const realViolations = judge(real)
const ofKinds = (kinds: string[]): Violation[] => realViolations.filter((violation) => kinds.includes(violation.kind))
const reportedKinds = ['missing-dir', 'broken-forwarder', 'legacy-forwarder', 'direction', 'channels-cross', 'process-outside-transport', 'no-transport-exit', 'channels-upstream']
report('真树：九个职责目录都在', ofKinds(['missing-dir']))
report('真树：旧路径只剩转发、转发目标都在（旧导入不会断）', ofKinds(['broken-forwarder', 'legacy-forwarder']))
report('真树：依赖方向只能向下（含两套通道互不引用）', ofKinds(['direction', 'channels-cross']))
report('真树：gh 进程只在 transport/，且 transport 真的有一处出口', ofKinds(['process-outside-transport', 'no-transport-exit']))
report('真树：channels 不引用 routing/read/write/room', ofKinds(['channels-upstream']))
report('真树：没有落在上面几族之外的违规', realViolations.filter((violation) => !reportedKinds.includes(violation.kind)))
check(real.files.has(ROOM_REL + '/transport/client.ts'), 'transport/client.ts 已落位（gh 的唯一出口）')

console.log('\n自证：合规样例')
report('合规样例', judge(sampleTree(BASE_FILES)))
report('合规样例：注释里的 exec 不算数', judge(sample({
  'read/read.ts': "// exec('gh', [])\nimport { route } from '../routing/routing.js'\nexport const read = route\n",
})))
report('合规样例：旧平铺的非转发器仍可被导入（迁移期）', judge(sample({
  'errors.ts': "export const kind = 'x'\n",
  'transport/client.ts': "import { kind } from '../errors.js'\nexport default function run() { return exec('gh', []) + kind }\n",
})))

console.log('\n自证：负例')
function expectViolation(name: string, tree: Tree, kind: string): void {
  const violations = judge(tree)
  const hit = violations.some((violation) => violation.kind === kind)
  check(hit, name + ' 判红（期望 ' + kind + '）')
  if (!hit) console.log('       实际违规：' + (violations.map((violation) => violation.kind).join(', ') || '无'))
}

expectViolation('channels/graphql 引用 read', sample({
  'channels/graphql/gql.ts': "import { read } from '../../read/read.js'\nexport const query = read\n",
}), 'channels-upstream')

expectViolation('channels/rest 引用 room', sample({
  'channels/rest/rest.ts': "import { room } from '../../room/room.js'\nexport const call = room\n",
}), 'channels-upstream')

expectViolation('channels/graphql 引用 channels/rest', sample({
  'channels/graphql/gql.ts': "import { call } from '../rest/rest.js'\nexport const query = call\n",
}), 'channels-cross')

expectViolation('channels/rest 引用 channels/graphql', sample({
  'channels/rest/rest.ts': "import { query } from '../graphql/gql.js'\nexport const call = query\n",
}), 'channels-cross')

expectViolation('read 引用 room（向上）', sample({
  'read/read.ts': "import { room } from '../room/room.js'\nexport const read = room\n",
}), 'direction')

expectViolation('transport 引用 read（向上）', sample({
  'transport/client.ts': "import { read } from '../read/read.js'\nexport default function run() { return exec('gh', []) + read }\n",
}), 'direction')

expectViolation('channels/rest 里直接起进程', sample({
  'channels/rest/rest.ts': "import run from '../../transport/client.js'\nexport const call = exec('gh', [])\n",
}), 'process-outside-transport')

expectViolation('channels/rest 从旧转发器导入', sample({
  'channels/rest/rest.ts': "import run from '../../client.js'\nexport const call = run\n",
}), 'legacy-forwarder')

expectViolation('旧转发器指向不存在的文件', sample({
  'client.ts': "export * from './transport/missing.js'\n",
}), 'broken-forwarder')

expectViolation('缺少一个职责目录', sampleTree(BASE_FILES, ['support']), 'missing-dir')

expectViolation('transport 里没有任何 gh 调用', sample({
  'transport/client.ts': "export default function run() { return 'not a process' }\n",
}), 'no-transport-exit')

console.log('\n共 ' + total + ' 项检查，失败 ' + failed + ' 项')
if (failed > 0) {
  console.log('存在失败：GitHub 房间分层不符合 ADR 20261030-github-room-channel-layering。')
  process.exit(1)
}
console.log('全部通过：GitHub 房间九目录、依赖方向、channels 边界、传输唯一出口与旧路径禁令都符合约定。')
