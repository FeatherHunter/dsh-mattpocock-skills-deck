// scripts/lib/discover-gates.ts —— 门禁自动发现：目录约定加显式排除表（#1125）。
//
// 为什么要有它：`package.json` 里那条单行长串同时记着「有哪些门禁」和「按什么顺序跑」，
// 这两件是能从磁盘算出来的派生信息。人手写派生信息，必然抢同一个文件、打出无人能审的 diff
// （#1106 的收尾就卡在这里）。本文件只回答「有哪些门禁」：扫 `tests/` 下符合约定的文件，
// 减去排除表里写明理由的那几项。顺序与执行仍由阶段表决定，不管发现。
//
// 另外回答「冒烟按什么顺序跑哪几条」（#1643）：冒烟清单的唯一来源是 package.json 的
// scripts.smoke，读法与切法也收在这一处，两个执行器（verify-chain、verify-parallel）与归属表生成器共用，不许各抄一份。
//
// 约定：文件名以 `verify-` 开头、后缀是可跑的脚本（.js/.mjs/.cjs/.ts/.mts/.cts），
// 且不是本文件头里排除表点名的那几类。注意 `.html` 与 `.json` 不可跑，从不进链。
//
// 用法：
//   node --import ./scripts/ts-hook.mjs scripts/lib/discover-gates.ts --list
// 三个执行器（verify-chain / verify-parallel / verify-all）与看守门禁都调 planGates() 拿名单，
// 不再读 package.json 长串；冒烟清单（今天五条）走 readSmokeCommands()，两个执行器与归属表共用同一份。
import fs from 'node:fs'
import path from 'node:path'

export const RUNNABLE_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']

// 可跑的门禁文件名：verify- 开头。大小写按磁盘原样，不做归一化。
export function isGateFileName(name: string): boolean {
  if (!name.startsWith('verify-')) return false
  const ext = name.slice(name.lastIndexOf('.'))
  return RUNNABLE_EXTS.includes(ext)
}

// 扫出磁盘上全部符合约定的门禁（仓库相对路径，斜杠统一，正序排好）。
// 只读目录，不读文件内容，所以另一会话正在改门禁内容时，扫出来的名单不受影响。
export function discoverGateFiles(root: string): string[] {
  const dir = path.join(root, 'tests')
  const names = fs.readdirSync(dir)
  return names
    .filter((n: any) => isGateFileName(n))
    .map((n: any) => 'tests/' + n)
    .sort()
}

// 一段：名字加认领前缀。match 为空的那一段是默认段，认领不上的都归它。
export interface StageDef {
  name: string
  match: string[]
}

// 排除表的一条：文件加理由加票号，缺一不可（缺了 loadConvention 就抛错）。
export interface ExcludeEntry {
  file: string
  reason: string
  ticket: string
}

export interface Convention {
  stages: StageDef[]
  exclude: ExcludeEntry[]
}

// 规划好的一步：文件、在哪一段、执行器怎么起它。
export interface PlannedGate {
  file: string
  stage: string
  cmd: string
}

// 读约定并验形状。形状不对直接抛错（调用方是执行器或看守门禁，抛错就是红，
// 不许拿着半份约定静默跑）。理由与票号不许空白：没有出处的排除就是漏网。
export function loadConvention(root: string): Convention {
  const file = path.join(root, 'scripts', 'verify-stages.json')
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    stages?: Array<{ name?: unknown; match?: unknown }>
    exclude?: Array<{ file?: unknown; reason?: unknown; ticket?: unknown }>
  }
  if (!raw || !Array.isArray(raw.stages) || raw.stages.length === 0) throw new Error('约定里没有 stages：' + file)
  const stages: StageDef[] = raw.stages.map((s, i) => {
    if (!s || typeof s.name !== 'string' || !s.name) throw new Error('约定第 ' + (i + 1) + ' 段没有名字：' + file)
    if (!Array.isArray(s.match) || s.match.some((m) => typeof m !== 'string')) {
      throw new Error('约定第 ' + (i + 1) + ' 段（' + s.name + '）的 match 不是字符串数组：' + file)
    }
    return { name: s.name, match: s.match as string[] }
  })
  const exclude: ExcludeEntry[] = (raw.exclude || []).map((e, i) => {
    if (!e || typeof e.file !== 'string' || !e.file) throw new Error('约定排除表第 ' + (i + 1) + ' 条没有 file：' + file)
    for (const key of ['reason', 'ticket'] as const) {
      if (typeof e[key] !== 'string' || !(e[key] as string).trim()) {
        throw new Error('约定排除表第 ' + (i + 1) + ' 条（' + e.file + '）缺 ' + key + '：没有出处的排除就是漏网，不许进表')
      }
    }
    return { file: e.file, reason: (e.reason as string).trim(), ticket: (e.ticket as string).trim() }
  })
  return { stages, exclude }
}

// 文件名进哪一段：按段的顺序，第一段认领上的就归它；谁都没认领就进默认段
// （match 为空的那一段，一份约定只许有一段是默认段）；连默认段都没有就抛错。
// 认领只看文件名的子串，不读文件内容 —— 认领规则本身不能依赖被认领者的内容。
export function assignStage(baseName: string, stages: StageDef[]): string {
  for (const stage of stages) {
    if (stage.match.some((m) => m !== '' && baseName.includes(m))) return stage.name
  }
  const defaults = stages.filter((s) => s.match.length === 0)
  if (defaults.length !== 1) throw new Error('约定里默认段（match 为空）必须恰好一段，实有 ' + defaults.length + ' 段')
  return defaults[0].name
}

// 纯规划：给文件名清单减排除、定段、排序。不碰磁盘，所以看守门禁可以用夹具
// 文件名演“漏网”的红路径，执行器用同一份逻辑跑真仓 —— 两边不可能各说各话。
export function planFromNames(names: string[], convention: Convention): { steps: PlannedGate[]; excluded: string[] } {
  const excludedSet = new Set(convention.exclude.map((e) => e.file))
  const order = new Map(convention.stages.map((s, i) => [s.name, i]))
  const steps: PlannedGate[] = []
  const excluded: string[] = []
  for (const file of names) {
    if (excludedSet.has(file)) {
      excluded.push(file)
      continue
    }
    const base = file.slice(file.lastIndexOf('/') + 1)
    steps.push({ file, stage: assignStage(base, convention.stages), cmd: 'node ' + file })
  }
  steps.sort((a, b) => {
    const d = (order.get(a.stage) || 0) - (order.get(b.stage) || 0)
    return d !== 0 ? d : a.file < b.file ? -1 : a.file > b.file ? 1 : 0
  })
  return { steps, excluded }
}

// 整仓规划：扫磁盘、减排除、定段、排序。三个执行器的名单只有这一个来源。
export function planGates(root: string): PlannedGate[] {
  return planFromNames(discoverGateFiles(root), loadConvention(root)).steps
}

// 这扇门禁今天会不会被链跑到：看守门禁之外的门禁自证入链，就问这一句。
// 进链的意思是在规划里（排除表里的不算进链 —— 排除就是“今天不跑”，
// 自称已入链的门禁不许同时躺在排除表里）。
export function isGatePlanned(root: string, file: string): boolean {
  return planGates(root).some((s) => s.file === file)
}

// 漏网文件名：tests/ 下以 verify 开头、但扫不进链的可跑文件
// （如下划线 verify_rogue.js、大小写 Verify-x.js）。
// 不可跑的（.html/.json 手工夹具）不算漏网，它们是门禁用的数据，不是门禁。
// 扫到就说明有人新增了门禁却没按约定起名，看守门禁当场红。
export function nearMissGateFiles(root: string): string[] {
  const dir = path.join(root, 'tests')
  const names = fs.readdirSync(dir)
  const out: string[] = []
  for (const n of names) {
    if (!n.startsWith('verify') && !n.startsWith('Verify')) continue
    if (isGateFileName(n)) continue
    const ext = n.slice(n.lastIndexOf('.')).toLowerCase()
    if (!RUNNABLE_EXTS.includes(ext)) continue
    out.push('tests/' + n)
  }
  return out.sort()
}

// ---------------------------------------------------------------------------
// 规划：目录约定加显式排除表（#1125 的后半段）。
// ---------------------------------------------------------------------------
//
// 三个执行器与看守门禁读的是同一份东西：
//   scripts/verify-stages.json  四段的顺序与认领前缀，加显式排除表；
//   本文件的这几个函数      把“磁盘上有哪些”变成“按什么顺序跑”。
// package.json 里那条长串不再是名单的来源，三个执行器都不读它。

// ---------------------------------------------------------------------------
// 冒烟清单（package.json 的 scripts.smoke）：读法与切法也收在这一处（#1643）。
// ---------------------------------------------------------------------------
//
// 为什么冒烟不像主链那样扫目录：冒烟不是「tests/ 下有哪些门禁」，而是人挑出来、按固定顺序跑的五条
// （其中 tests/smoke-naming-persistence.test.ts 会临时切换工作目录，顺序一乱后面的步骤就跟着错）。
// 所以清单只有一处来源 —— package.json 的 scripts.smoke 那一格；读法收在本文件：
// 两个执行器（verify-chain 的 --script smoke、verify-parallel 的冒烟阶段）都从这里读，
// gate-map 生成器读同一份清单出归属表 —— 它是生成器，不算执行器。
// 切法与「这一步跑的是哪个测试文件」也共用本文件，不许各抄一份。
// 读不到清单时返回空数组：算不算红由调用方判（两个执行器都当红，不许静默跳过）。

/**
 * 把一段命令行按「引号外的分隔符」切开；扫描逻辑只写这一份，冒烟链与参数切分共用（#1643）。
 * separatorAt(text, i) 返回位置 i 处那个分隔符的长度（0 表示这里不是分隔符）：
 * 冒烟链传 `&&`（2 个字符），参数切分传空白（1 个字符）。
 * 引号里的字符原样保留在词里，由调用方决定要不要剥掉（参数切分要剥，链切分不剥）。
 */
function splitOutsideQuotes(text: string, separatorAt: (t: string, i: number) => number): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }
    const sep: number = separatorAt(text, i)
    if (sep) {
      if (cur) out.push(cur)
      cur = ''
      i += sep - 1
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

/** 把词里成对的引号剥掉（`"a b"` 变成 `a b`）。今天链上没有引号，这层是防御。 */
function stripQuotes(word: string): string {
  let out = ''
  let quote: string | null = null
  for (const ch of word) {
    if (quote) {
      if (ch === quote) quote = null
      else out += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    out += ch
  }
  return out
}

/**
 * 把一条 && 串切成一条条命令，照顾引号里的 &&（链里今天没有引号，分支是防御）。
 * 切法必须与并行执行器、归属表生成器完全一致，否则同一份 package.json 在三处会切出三种结果。
 */
export function splitCommandChain(text: string): string[] {
  return splitOutsideQuotes(text, (t: string, i: number) => (t[i] === '&' && t[i + 1] === '&' ? 2 : 0))
    .map((x: string) => x.trim())
    .filter(Boolean)
}

/** 把一条命令按空白切成参数，照顾引号。今天链上没有引号，这一步等价于按空白切。 */
export function splitCommandArgs(cmd: string): string[] {
  return splitOutsideQuotes(cmd, (t: string, i: number) => (/\s/.test(t[i]) ? 1 : 0)).map(stripQuotes).filter(Boolean)
}

/**
 * 一条命令跑的是哪个测试文件（仓库相对路径、斜杠统一）。归属表里的 file 就是这个写法。
 * 主链一步长这样：`node tests/verify-x.js`，第二个参数就是它；
 * 冒烟链多一层装载钩子：`node --import ./scripts/ts-hook.mts tests/smoke-x.test.ts`，
 * 所以取「第一个落在 tests/ 下的参数」，找不到再退回第二个 —— 两种写法都能认出文件。
 * 不是 node 命令时返回空串：这类条目不该进链，交给调用方判红。
 */
export function commandTestFile(cmd: string): string {
  const parts = splitCommandArgs(cmd)
  if (parts[0] !== 'node') return ''
  const norm = (p: string): string => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '')
  const testArg: string | undefined = parts.slice(1).find((p: string) => norm(p).startsWith('tests/'))
  const chosen: string = testArg || parts[1] || ''
  return chosen ? norm(chosen) : ''
}

/** 读 package.json 的 scripts.smoke 并按 && 切开；缺这一格时返回空数组，由调用方判红。 */
export function readSmokeCommands(root: string): string[] {
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, unknown>
  }
  const smoke = raw && raw.scripts && typeof raw.scripts.smoke === 'string' ? raw.scripts.smoke : ''
  return smoke ? splitCommandChain(smoke) : []
}
