// scripts/typecheck.mts —— 类型检查入口（票 #1020 立）。
//
// 这条入口回答两类问题，缺一类都不算检查过：
//
//   **一、「有没有源码没人检查」。** 项目配置（tsconfig）是手写的圈选规则，加了一份新源码却忘了
//   把它圈进去，编译器不会报错——它只是看不见这份文件。本仓真实的例子是
//   src/client/kernel/locale-cards.ts：它被构建转译、被客户端使用，却不在任何配置的 include 里，
//   从落地到今天一次类型检查都没过。症状是「跑了类型检查、全绿，可那份文件根本没被检查」。
//   所以这里用两个集合对账：**仓库里有哪些源码**（判据走 git，是外部事实）与
//   **配置各自看见了哪些源码**（判据走编译器）。差集里剩下的就是没人检查的文件。
//
//   **二、「有没有源码被检查了两遍」。** 同一个文件落在两份配置里，TypeScript 今天的表现是
//   两边都不报错（实测：父、子两个 composite 项目都圈住 sub/x.ts，两边退出码 0、零诊断、
//   零警告，还都往同一个产物路径写）。官方只有一句间接说明——handbook 的 Project References
//   写着 "otherwise the solution file will cause double compilation of files"——解法是约定，
//   不是强制。所以这条只能自己断言，指望编译器替我们拦是拦不住的。
//
// 除这两类以外，这里**不守**「谁可以 import 谁」。那条线是层级边界，由依赖图那份门禁守
// （tests/verify-dependency-rules.ts 一族）；同一个判断不写两遍是仓里的规矩：一处改了另一处
// 没改，症状是「本机全绿、另一条门禁红」。TypeScript 本身也没有任何选项能禁止从上层目录 import，
// 试过把「禁止向上引用」写进 tsconfig，编译器照过——所以不是不肯写，是写不出来。
//
// 这里也**不数**「新语言直接 import 旧语言的边」。那张票的开工令列了两把棘轮，落地的是第一把
// （手写旧语言文件数，tests/handwritten-js-baseline.json）。第二把（谁 import 了谁）今天只在
// 依赖图那份门禁里有一份实现，数出来是同一个数：本仓 42 条 `.js` 结尾的说明符全部是假后缀
// （磁盘上只有同名 .ts），指向真实 .js 的边是 0 条。再写一份扫描就是第二处判据，所以这一步
// 有意留给依赖图那条线，等它的白名单先把方向判出来，本文件顺手读同一份图即可。
//
// 用法（在插件根目录）：
//   node scripts/typecheck.mts             # 四步全跑 + 棘轮对账
//   node --import ./scripts/ts-hook.mjs scripts/typecheck.mts   # 等价（本文件不 import 同名 .js，钩子非必需）
//
// 退出码三分，为了让人和上游脚本能分辨该找谁：
//   0 —— 全绿
//   1 —— 有断言红（缺口／重复／越界／类型错误／棘轮涨了），要改的是仓库
//   2 —— 脚本自身跑不动（git 或 tsc 起不来、配置读不通、输出认不出来），要改的是环境或本文件
//
// 对外接口：本文件既是入口也是模块。tests/verify-typecheck.mts 直接 import 下面的
// collectFacts() / judge() / report()，用同一份实现判仓库现状，不再另写一套口径。

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 仓库根目录：本文件在 scripts/ 下，往上一层就是根。 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, '..')

/** 手写 JavaScript 的棘轮名单（只许缩短）。 */
export const BASELINE_PATH = path.join(ROOT, 'tests', 'handwritten-js-baseline.json')

/**
 * 三个源码根。目录清单写死是有意的：新增一个有配置的目录时应当有人来看一眼这份清单，
 * 而不是让它被自动卷进来。今天类型配置只圈 src/，tests/ 与 scripts/ 的归属是另一件事
 * （测试是运行时加载源码，与「构建输入集合」不是同一个集合），见票 #1020 的进度区。
 */
const SOURCE_ROOTS = ['src', 'tests', 'scripts']

/** 派生目录：不是手写的，不进棘轮名单，也不参与任何源码集合。 */
const DERIVED_DIRS = ['scripts/generated/']

/** 发布壳：build.mjs 从 src/ 拷出来的镜像，判据是 src/ 那边的真源。 */
const PACKAGE_DIR = 'package/'

/** 会被类型检查的源码后缀。点 mts 也算——本文件自己就是这种后缀。 */
const SCRIPT_EXTS = ['.ts', '.tsx', '.mts']

/**
 * 跑一条命令并拿回文本。
 *
 * 路径统一用 path.resolve 的相对写法传给子进程，避免把 Windows 反斜杠路径塞进 git 的参数里
 * （git 的 pathspec 只认正斜杠）。
 *
 * 为什么不用 shell：本仓的路径含中文与空格，走 shell 会被再解释一遍；execFileSync 直接传参数组，
 * 一个字节都不经过 shell，连引号都不需要。
 */
function run(file: string, args: string[], cwd = ROOT): { ok: boolean; out: string; code: number } {
  try {
    const out = execFileSync(file, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      // stderr 并进 stdout：编译器把诊断写哪一路都算它的输出，分两路读会漏。
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, out, code: 0 }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number; code?: string }
    if (e.code === 'ENOENT') return { ok: false, out: '', code: -1 }
    return { ok: e.status === 0, out: (e.stdout ?? '') + (e.stderr ?? ''), code: typeof e.status === 'number' ? e.status : -1 }
  }
}

/**
 * 取「仓库里有这些文件」——判据只走 git，不扫目录。
 *
 * 为什么必须走 git 而不是 readdir：
 *   1. 工作区有删了一半的中间态（改名是「删旧建新」两步），扫目录会把半成品算进来；
 *   2. 将来接上工程引用、测试夹具这些派生或忽略的文件时，不必再写一份忽略规则与 .gitignore 对账；
 *   3. git 的索引是一个外部事实，本文件不需要自己维护任何映射。
 *
 * 三条命令参数各自都有来历，改动前先读这三条：
 *   - -z：路径含空格或非 ASCII 时，只有 NUL 分隔的结果跨环境稳定。**不能省**：不带 -z 时
 *     git 会按 core.quotePath 给路径加引号并转义，本仓今天有 82 个非 ASCII 路径（通病是
 *     「本机看着对、换台机器全乱」）。另外要自己按 NUL 切分——PowerShell 这类外层不认 NUL，
 *     会把整段输出当成「一个很长的字符串」。
 *   - :(glob) 前缀：git 默认的 pathspec 把「最后一个斜杠之前」当**目录前缀**，所以双星号加斜杠的写法
 *     匹配不到仓库根下的文件（本仓实测：单星号写法 328 条、双星号写法 323 条，缺口正好是根上 5 个 md）。
 *     带上 :(glob) 前缀才是我们想要的「任意深度」。
 *   - --others 与 --exclude-standard：把还没提交的新文件也算进来。少了它，「新增一份没人检查的源码」
 *     在提交前不会被发现，而发现它的成本正好是提交前那一秒。
 */
function gitFiles(pathspec: string[]): string[] {
  const r = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', ...pathspec])
  if (!r.ok) {
    throw new Error(
      'git ls-files 跑不动（退出码 ' + r.code + '）。这条命令是「仓库里有哪些文件」的唯一判据，' +
        '起不来就不能继续——请先确认当前目录是插件根目录、且这台机器上 git 可用。原始输出：' + r.out.trim(),
    )
  }
  return r.out.split('\0').filter(Boolean)
}

/** 一个文件是不是「不算手写」的：派生目录与发布壳都排除，其余按后缀算。 */
function isHandwrittenJs(rel: string): boolean {
  if (!SOURCE_ROOTS.some((root) => rel.startsWith(root + '/'))) return false
  if (DERIVED_DIRS.some((dir) => rel.startsWith(dir))) return false
  if (rel.startsWith(PACKAGE_DIR)) return false
  return /\.(js|mjs|cjs)$/.test(rel)
}

/** 会被类型检查的源码：三个源码根下的 .ts/.tsx/.mts（派生目录与发布壳除外）。 */
function isSourceScript(rel: string): boolean {
  if (!SOURCE_ROOTS.some((root) => rel.startsWith(root + '/'))) return false
  if (DERIVED_DIRS.some((dir) => rel.startsWith(dir))) return false
  if (rel.startsWith(PACKAGE_DIR)) return false
  return SCRIPT_EXTS.includes(path.extname(rel))
}

/**
 * 全部类型配置，按路径排序。
 *
 * 判据是「磁盘上有这份配置」而不是「某张登记表里写了这份配置」：新增一份配置就自动进检查，
 * 不需要有人记得去别处登记——忘记登记正是这类检查最常见的失效方式。
 */
function findConfigs(): string[] {
  return gitFiles([':(glob)**/tsconfig*.json'])
    .filter((rel) => !rel.startsWith('package/'))
    .sort()
}

/** 找 tsc 的入口。找不到返回 null，由调用方报成「脚本跑不动」而不是「检查不通过」。 */
function findTsc(): string | null {
  for (const rel of ['node_modules/typescript/bin/tsc', 'node_modules/typescript/lib/tsc.js']) {
    const abs = path.join(ROOT, rel)
    if (fs.existsSync(abs)) return abs
  }
  return null
}

/** 一份配置跑出来的事实。 */
export interface ConfigFacts {
  /** 配置路径，仓库相对、正斜杠。 */
  config: string
  /** 配置所在目录，仓库相对；根上的配置是空串。 */
  dir: string
  /** 枚举到的仓库内文件（仓库相对路径，去重后排序）。 */
  files: string[]
  /** 枚举这一步的原始退出码。非 0 表示枚举本身失败，不是「有缺口」。 */
  enumCode: number
  /** 枚举失败时编译器留下的文字。 */
  enumOutput: string
  /** 类型检查的退出码，以及去重后的错误行（形如「文件:行:列 - error TSxxxx: 说明」）。 */
  checkCode: number
  errors: string[]
}

/** 一次完整调查的产出：配置事实 + 仓库事实 + 棘轮对账。 */
export interface Facts {
  configs: ConfigFacts[]
  /** 仓库里全部会被类型检查的源码（三个源码根，仓库相对，排序）。 */
  repoScripts: string[]
  /** 其中落在 src/ 下的：缺口断言只对这一部分成立，见 judge() 里的说明。 */
  repoScriptsInSrc: string[]
  /** 棘轮名单与基线的对账结果。 */
  ratchet: { current: string[]; baseline: string[]; added: string[]; gone: string[]; baselineFound: boolean }
}

/** 枚举 + 类型检查一份配置，把两份产物分开拿。 */
function measureConfig(config: string, tsc: string): ConfigFacts {
  const dirAbs = path.dirname(path.join(ROOT, config))
  const dir = path.relative(ROOT, dirAbs).split(path.sep).join('/')

  // 第 2 步：枚举（--listFilesOnly）。
  // 注意它不是「只枚举、绝不出错」：实测它跳过**语义**检查（类型不匹配之类），但**不跳语法**检查——
  // 源码里写一句残缺的 export 时它照样报 error TS1109 并退 1。所以这一步的退出码
  // 必须单独当成一类失败（枚举挂了），不能与「枚举成功但集合有缺口」混成一条路径。
  const listed = run(process.execPath, [tsc, '-p', config, '--listFilesOnly'])
  const rawLines = listed.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)

  // 诊断行写成「文件路径(行,列): error TS编号: 说明」。文件名**不加引号**，所以路径含空格时
  // 靠正则拆行是不可靠的；下面的做法是不拆行——只把诊断行剔掉，剩下的整行拿去路径索引里查表，
  // 查中即映射回仓库相对路径。查不中的行单独报出来，宁可不认，也不猜。
  const fileLines: string[] = []
  for (const line of rawLines) {
    // 诊断行在这里丢掉，但错误正文另有出处：真编译那一步会把它们收进 errors，按「哪份配置、哪几条」
    // 打出来，所以这里跳过不会让任何人看不到错误。
    if (/\(\d+,\d+\)\s*:\s*(error|warning)\s+TS\d+/.test(line)) continue
    fileLines.push(line)
  }

  // 第 3 步的过滤：**不在 node_modules 下**，且**落在仓库根之下**。两条都不能少。
  // 第二条是实测逼出来的：被 import 进来、却跑到项目目录外的文件会进清单（临时项目里
  // D:/temp/.../outside/outside.ts 进了另一个项目的清单）。只用 node_modules 过滤的话，
  // 域外文件会被误当成「这份配置覆盖了它」，缺口判定就会假绿。
  const files: string[] = []
  for (const line of fileLines) {
    if (line.includes('/node_modules/') || line.includes('\\node_modules\\')) continue
    const rel = toRepoRelative(line)
    if (rel !== null) files.push(rel)
  }
  const unique = Array.from(new Set(files)).sort()

  // 第 4 步：真编译一遍。与枚举分开跑是有意的——两者支撑的是不同的事实，合并会让「枚举成功」
  // 被误读成「类型没问题」（实测：纯类型错误时枚举退 0、真编译退 1）。
  //
  // 诊断要按「哪条真要紧」筛一遍再报：编译器自带的库声明文件（lib.*.d.ts）、装进来的依赖
  // 与仓库外的文件都可能在清单里出现（实测配置写坏的那次，98 行输出里九成是 node_modules 下的
  // 库文件）。这些不是本仓源码的问题，报出来只会淹掉真正要改的那几条。判据与枚举那一步同源：
  // 不在 node_modules 下，且认得出是本仓的路径。
  const checked = run(process.execPath, [tsc, '-p', config])
  const diagnosed: string[] = []
  for (const line of checked.out.split(/\r?\n/).map((s) => s.trim())) {
    if (!/\(\d+,\d+\)\s*:\s*error\s+TS\d+/.test(line)) continue
    // 诊断行的形状是「路径(行,列): ...」，路径里通常不含左圆括号，所以第一个左圆括号之前就是路径。
    const cut = line.indexOf('(')
    const file = (cut >= 0 ? line.slice(0, cut) : '').split(path.sep).join('/')
    if (file.includes('node_modules')) continue
    // 配置自己的语法错（TS1012 之类）不是「某个源码文件里的错」：枚举那一步已经把它整条报出来了，
    // 这里再报一遍只会让人以为是源码的问题。
    if (file.endsWith(config)) continue
    diagnosed.push(line.replace(/^\.[\\/]/, '').split(path.sep).join('/'))
  }
  const errors = Array.from(new Set(diagnosed)).sort()

  return {
    config,
    dir,
    files: unique,
    enumCode: listed.code,
    enumOutput: listed.out.trim(),
    checkCode: checked.code,
    errors,
  }
}

/**
 * 把一个可能来自 tsc 的路径认回仓库相对路径；认不出返回 null。
 *
 * tsc 给出的路径可能是绝对路径（今天实测就是绝对路径）、也可能相对仓库根或相对 cwd。
 * 三种都试一遍，最后一条兜底规则只对「以某个源码根开头的相对写法」生效，且要求文件真的在磁盘上，
 * 免得把编译器诊断里出现的裸文件名误认成源码。
 */
function toRepoRelative(p: string): string | null {
  const norm = (s: string) => path.resolve(s).split(path.sep).join('/')
  const rootNorm = norm(ROOT)

  // 绝对路径：在仓库根之下才认，并且必须真的存在（域外文件在这里被挡掉）。
  if (path.isAbsolute(p)) {
    const abs = norm(p)
    if(!isUnderRoot(abs, rootNorm)) return null
    return abs.slice(rootNorm.length + 1)
  }

  const asCwd = norm(path.resolve(ROOT, p))
  if (isUnderRoot(asCwd, rootNorm) && fs.existsSync(asCwd)) return asCwd.slice(rootNorm.length + 1)

  const rel = p.split('\\').join('/')
  if (SOURCE_ROOTS.some((root) => rel.startsWith(root + '/')) && fs.existsSync(path.join(ROOT, rel))) return rel
  return null
}

/** abs 是不是 root 自己或它下面的东西（字符串前缀比较，两边的分隔符都已统一成 /）。 */
function isUnderRoot(abs: string, rootNorm: string): boolean {
  return abs === rootNorm || abs.startsWith(rootNorm + '/')
}

/** 读棘轮基线；读不到或格式不对时当成「没有基线」，由 judge() 报出来。 */
function readBaseline(): string[] {
  if (!fs.existsSync(BASELINE_PATH)) return []
  const parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as { files?: unknown }
  if (!Array.isArray(parsed.files)) return []
  return parsed.files.filter((f): f is string => typeof f === 'string')
}

/**
 * 只对账棘轮名单，不跑编译器。
 *
 * 单独拆出来是为了让测试与「只想核一眼名单」的场合不必等两次编译器；同时也让这份实现只写一遍——
 * 入口与门禁共用它，不会出现两套口径。
 */
export function compareBaseline(current: string[], baseline: string[]): Facts['ratchet'] {
  const inBaseline = new Set(baseline)
  const currentSet = new Set(current)
  return {
    current,
    baseline,
    added: current.filter((f) => !inBaseline.has(f)),
    gone: baseline.filter((f) => !currentSet.has(f)),
    baselineFound: baseline.length > 0,
  }
}

/** 把仓库现状与棘轮名单都收齐。这是本文件对外的调查接口，门禁也调它。 */
export function collectFacts(): Facts {
  const tsc = findTsc()
  if (!tsc) {
    throw new Error(
      '找不到编译器入口（先找过 node_modules/typescript/bin/tsc，再找 node_modules/typescript/lib/tsc.js）。' +
        '类型检查要编译器才能判，先把依赖装上（pnpm install 或 npm install）再重跑。',
    )
  }

  const repoScripts = gitFiles([':(glob)**/*.ts', ':(glob)**/*.tsx', ':(glob)**/*.mts']).filter(isSourceScript).sort()
  const baseline = readBaseline()
  const configs = findConfigs().map((config) => measureConfig(config, tsc))

  return {
    configs,
    repoScripts,
    repoScriptsInSrc: repoScripts.filter((rel) => rel.startsWith('src/')),
    ratchet: compareBaseline(gitFiles([':(glob)**/*.js', ':(glob)**/*.mjs', ':(glob)**/*.cjs']).filter(isHandwrittenJs).sort(), baseline),
  }
}

/** 一条结论。level 里只有 fail 会改变退出码；warn 是「值得看一眼，但今天不算账」。 */
export interface Finding {
  level: 'fail' | 'warn' | 'info'
  topic: string
  msg: string
}

/**
 * 判据本体：把事实变成结论。与收数据完全分开，测试可以直接喂假事实进来验判据，
 * 不必真的去动仓库。
 */
export function judge(facts: Facts): Finding[] {
  const out: Finding[] = []
  const add = (level: Finding['level'], topic: string, msg: string) => out.push({ level, topic, msg })

  // —— 断言 A：每份配置至少圈到一个文件。
  // 开工令点名的两条自动下限之一。在这套判据里它其实是「缺口断言」的推论（一份圈到 0 个文件的配置
  // 抓不到任何源码），保留它是为了便宜的早期报警：配置写错路径或 include 打成相对 ../../ 时，
  // 这一条立刻能说是哪份配置，不必等集合运算。
  for (const c of facts.configs) {
    if (c.files.length === 0) {
      add('fail', '空配置', c.config + ' 一个源码文件都没圈到：要么 include 写错了，要么这份配置已经没用了，该删。')
    }
  }

  // —— 断言 B（硬失败）：src/ 下每个源码文件至少被一份配置圈到。
  // 这是本文件存在的头号理由：漏圈的源码编译器不会报错，只会安静地不检查它。
  const seenBy = new Map<string, string[]>()
  for (const c of facts.configs) for (const f of c.files) {
    const list = seenBy.get(f)
    if (list) list.push(c.config)
    else seenBy.set(f, [c.config])
  }
  const missing = facts.repoScriptsInSrc.filter((f) => !seenBy.has(f))
  for (const f of missing) {
    add(
      'fail',
      '缺口',
      f + ' 不在任何配置的检查范围内，它今天一次类型检查都没过。把它圈进所属那份配置的 include（例如该目录的通配写法），或说明它为什么不该被检查。',
    )
  }

  // —— 断言 C（硬失败）：同一份源码不许落在两份配置里。
  // 实测依据：TypeScript 不会拦这件事（两份 composite 配置都圈住同一个文件时，两边退出 0、零诊断，
  // 还往同一个产物路径写），所以这条只能自己断言。真出现了，改法是让每份配置只圈自己的目录树。
  for (const [f, configs] of seenBy) if (configs.length > 1) {
    add('fail', '重复归属', f + ' 同时落在这些配置里：' + configs.join('、') + '。同一个文件被检查两遍，两边还会各按自己的编译设置解释它；请让每份配置只圈自己的目录树。')
  }

  // —— 断言 D（硬失败）：一份配置看到的文件必须落在它自己所在目录之下。
  // 这条与上面两条合起来才是「一个文件只属于一个域」：B 管有没有人管，C 管有没有重复，D 管有没有越界吸收。
  for (const c of facts.configs) {
    for (const f of c.files) {
      // 仓库根上的配置（tsconfig.client.json、tsconfig.contract.json）用 include 圈了别的目录树，
      // 它们的「自己所在目录」是根，所以这一条对它们恒真——越界对这两份没有意义，跳过。
      if (c.dir === '') continue
      if (f === c.dir || f.startsWith(c.dir + '/')) continue
      // 只看 src/ 与 tests/ 下的源码：声明文件（.d.ts）与配置自身不属于任何域，跨目录出现是正常的。
      if (!facts.repoScripts.includes(f)) continue
      add('fail', '越界', c.config + ' 看到了自己目录之外的 ' + f + '。要么把这个文件圈回它所属的那份配置，要么把这份配置的 include 收窄到自己目录。')
    }
  }

  // —— 断言 E（硬失败）：每份配置的类型检查必须过。
  for (const c of facts.configs) {
    if (c.enumCode !== 0) {
      add('fail', '枚举失败', c.config + ' 连文件清单都列不出来（退出码 ' + c.enumCode + '，多半是配置读不通或源码有语法错）。这一步失败与「覆盖有缺口」是两回事，先看它的原始输出：' + firstLines(c.enumOutput, 3))
      continue
    }
    if (c.checkCode !== 0) {
      add('fail', '类型错误', c.config + ' 报了 ' + c.errors.length + ' 条类型错误：' + firstLines(c.errors.join('\n'), 3))
    }
  }

  // —— 断言 F（硬失败）：手写 JavaScript 的名单只许缩短。
  // 名单存的是**完整路径**而不是计数，理由是这样报错能直接指名道姓，且名单本身就是一份待办清单；
  // 只存个数字的话，降下来之后没人知道还欠哪些文件。仓里既有的两份基线（有效行、未迁移测试）
  // 都是这个形态。
  const ratchet = facts.ratchet
  if (!ratchet.baselineFound) {
    add('fail', '棘轮缺基线', '读不到或读不懂 ' + relPath(BASELINE_PATH) + '。这份名单是「手写 JavaScript 只许减不许增」的判据，缺了它这条检查等于没跑。')
  } else {
    for (const f of ratchet.added) {
      add('fail', '棘轮涨了', '新增了手写 JavaScript：' + f + '。新写的源码一律 .ts（见 AGENTS.md「TypeScript 优先」一节）；如果是给门禁造夹具这类确有必要的情形，重录基线并把理由写进提交信息。')
    }
  }

  // 名单变短是进展，不是问题，但要报出来——不报的话「少了一行」与「漏扫了一个文件」在输出里
  // 长得一样。这条按信息级打印，让人能一眼确认「减少」正是自己刚做的转换。
  for (const f of ratchet.gone) add('info', '棘轮已缩', f + ' 已不在名单里（转换完成、或文件被删）。不用做什么，看到它说明进展被记上了。')

  return out
}

/** 取前 n 行，用于把编译器的长篇输出压成一句能读的话。 */
function firstLines(text: string, n: number): string {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  return lines.slice(0, n).join(' ／ ') + (lines.length > n ? ' …（共 ' + lines.length + ' 行）' : '')
}

/** 仓库相对路径，给错误信息用。 */
function relPath(abs: string): string {
  return path.relative(ROOT, abs).split(path.sep).join('/')
}

/** 把结论打印成人能读的报告，返回是否全绿。 */
// 导出是给 tests/verify-typecheck.mts 那层壳用的：挂进 verify 长串时复用同一套判定与同一份输出，
// 不在壳里复制第二处判据。
export function report(facts: Facts, findings: Finding[]): void {
  const covered = new Set<string>()
  for (const c of facts.configs) for (const f of c.files) covered.add(f)
  const inSrcCovered = facts.repoScriptsInSrc.filter((f) => covered.has(f)).length

  console.log('类型检查：' + facts.configs.length + ' 份配置')
  for (const c of facts.configs) {
    console.log('  ' + c.config + ' —— 圈到 ' + c.files.length + ' 个源码文件' + (c.checkCode === 0 && c.enumCode === 0 ? '' : '（未通过）'))
  }
  console.log('src/ 下源码 ' + facts.repoScriptsInSrc.length + ' 份，被配置圈住 ' + inSrcCovered + ' 份')
  console.log('手写 JavaScript 名单 ' + facts.ratchet.current.length + ' 份，基线 ' + facts.ratchet.baseline.length + ' 份')
  console.log('')

  const order: Finding['level'][] = ['fail', 'warn', 'info']
  const label = { fail: '不通过', warn: '注意', info: '进展' }
  for (const level of order) {
    const group = findings.filter((f) => f.level === level)
    if (!group.length) continue
    console.log('【' + label[level] + '】' + group.length + ' 条')
    for (const f of group) console.log('  · [' + f.topic + '] ' + f.msg)
    console.log('')
  }

  const failed = findings.filter((f) => f.level === 'fail')
  if (failed.length === 0) console.log('全绿：没有没人检查的源码，没有重复归属，类型检查都过，手写 JavaScript 名单没有变长。')
  else console.log('不通过：' + failed.length + ' 条，逐条见上。')
}

/** 入口：只有直接跑这个文件时才执行（被 import 时不该有副作用）。 */
const invokedDirectly = (() => {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  try {
    const facts = collectFacts()
    const findings = judge(facts)
    report(facts, findings)
    process.exitCode = findings.some((f) => f.level === 'fail') ? 1 : 0
  } catch (err) {
    // 脚本自身跑不动与「检查不通过」必须分开：前者要改环境或本文件，后者要改仓库。
    console.error('类型检查入口自身出错（退出码 2）：' + (err instanceof Error ? err.message : String(err)))
    process.exitCode = 2
  }
}
