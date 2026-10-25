/**
 * src/host/skillDoc.ts —— 技能原文直读（来源：src/host/skillDoc.js，issue #1247 转写）。
 *
 * 为什么要有它（一句话）：详情页读本地原文的电话 skill.readDoc；只读随包原文目录，中文译文有就一起回。
 * #1521 起中文译文搬到了兄弟目录 package/bundled-skills-zh/（与 package/bundled-skills/ 同级的镜像树）。
 * 原因：上游同步脚本每次会整目录重建 bundled-skills，译文放在里面会被抹掉。
 *
 * 三条不能改的约定（改之前先看原 skillDoc.js 头注释与调用点 index.ts）：
 * 1. 英文原文的定位与返回值口径不变：仍然只认 <root>/<name>/SKILL.md，读不到回 {ok:false,missing:true}。
 *    译文路径由找到的原文文件推出（<root> 的兄弟目录 <root>-zh/<name>/SKILL.md），译文缺失仍是 mdZh=null。
 * 2. 只写可剥离 TypeScript：不新增运行时语法（禁用 enum 与构造函数参数属性），类型一律 import type 或内联标注。
 * 3. 不新增任何 import 边：只给已有引用加类型，不引入新模块依赖；Node 内建模块的类型缺席由文件内局部声明与 @ts-expect-error 承接，不装 @types/node。
 *
 * #1522 起多认一个文件参数（2026-10-25 人拍板方案 C）：
 *   详情页正文里写到的随包 md 文件名要能点开看原文，所以电话在原来的技能名之外再收 args.file。
 *   文件名只认「随包目录里真实存在的那一份」：先把每个技能目录下的 md 文件扫成名单，
 *   再按名单解析；文件名本身还必须是不带路径的一段（绝对路径、../、斜杠、反斜杠一律拒绝）。
 *   同一个文件名在多份技能目录里都有时，当前技能目录里的优先；分不清就回一份候选清单让界面选，
 *   不擅自猜。方案 C 的三条对应关系：格式说明名 → 随包格式模板（kind=format）、
 *   issue-tracker.md → 三份上游模板选一份（kind=choose）、五个技能在用户项目里维护的文件 → 只给说明（kind=project）。
 */

// 运行时的 process 兜底声明（与 src/refresh/rooms/host/git-execution.ts:30 同形）：本 tsconfig 有意不加载任何类型包，Node 运行时保证 process 存在；只声明本文件实际用到的形状，不产生运行时代码。
declare const process: any;

// ---------------------------------------------------------------------------
// 类型（#1247 转 TypeScript：只写类型不写实现）。
//
// 为什么标成这样：进来的依赖全部由装配点显式传入，形状按本文件实际用到的成员写成最小；
// 从外面进来的东西（客户端参数、后端行数据、文件里读出的 JSON）一律按 any 或 unknown 收，
// 收窄发生在运行时的 typeof 与 Array.isArray 判断里 —— 类型不替代那些运行时判断。
// ---------------------------------------------------------------------------

/** 本文件组装函数的依赖：全部由调用方显式传入，缺席时按原逻辑默认处理。 */
type Deps = any;

/** 客户端调电话时送进来的参数：JSON 边界，形状由调用方保证，本文件只做运行时判空。 */
type WfArgs = any;

/** 一次取数的结果：成功、缺文、或让界面选一份候选。字段都是可选的，界面按 ok/kind 分支读。 */
type ReadDocResult = {
  ok?: boolean
  missing?: boolean
  kind?: 'file' | 'format' | 'project' | 'choose'
  /** kind=choose 且这个名字对应格式模板时（#1522）：选完模板后界面仍要注明「这是格式说明」。 */
  format?: boolean
  name?: string
  file?: string
  skill?: string
  md?: string
  path?: string
  mdZh?: string | null
  pathZh?: string | null
  refs?: string[]
  options?: { file: string; skill: string }[]
}

// src/host/skillDoc.js —— 技能原文直读（888 落地：详情页读本地原文的电话 skill.readDoc）。
// 以后谁改它：改详情取数口径或原文定位的人。接线：由 index.js 动态 import 加载，依赖全显式传入；
// 不引用其他新文件（H4），定位走与 bootstrap.js 同一套候选目录（随包目录可信口径与它一致）。
// 只读随包原文目录：技能名只认字母数字与 - _（防跨目录），只拼 <dir>/<name>/SKILL.md，
// 读不到、非法名、超长一律回 {ok:false, missing:true}。
// 成功时把该文件的绝对路径一并回给界面：弹窗上那颗「复制路径」要复制的就是它（2026-10-10 人拍板）。
// 中文译文（兄弟目录 bundled-skills-zh 下的同名文件）有就一起回：弹窗上的「中文」按钮据此出现，没有译文就不出现。
// 英文原文照旧必回；译文缺失、读不动、超长都只是「没有译文」，不影响英文那一份。
// 注意分寸：路径可以给界面显示与复制，但**日志里永远不写路径原文**（日志纪律另有其要求，两件事不冲突）。
export function createSkillDoc(deps?: any): any {
  const MAX_BYTES = 200000
  // #1522 方案 C（2026-10-25 人拍板）的三张表。它们是「正文里怎么写」到「随包里哪一份」的翻译，
  // 不是内容缓存；随包文件改名了这里就要跟着改，tests/verify-1522-skill-md-refs.ts 会当场报红。
  const FORMAT_ALIASES: any = {
    'GLOSSARY.md': 'GLOSSARY-FORMAT.md',
    'GLOSSARY-MAP.md': 'GLOSSARY-FORMAT.md',
    'MISSION.md': 'MISSION-FORMAT.md',
    'RESOURCES.md': 'RESOURCES-FORMAT.md',
    '0001-event-sourced-orders.md': 'ADR-FORMAT.md',
    '0002-postgres-for-write-model.md': 'ADR-FORMAT.md',
  }
  const CHOICE_REFS: any = {
    'issue-tracker.md': ['issue-tracker-github.md', 'issue-tracker-gitlab.md', 'issue-tracker-local.md'],
  }
  const PROJECT_FILES: any = {
    'AGENTS.md': true,
    'CLAUDE.md': true,
    'CONTRIBUTING.md': true,
    'CODING_STANDARDS.md': true,
    'NOTES.md': true,
  }
  function validName(n?: any) { return typeof n === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(n) }
  // 文件名只认「一段」：不带路径分隔符、不以点开头。这样绝对路径、../ 越界、反斜杠、目录外名字
  // 在这里就被挡住；后面的解析又只从真实文件名单里查，两层都不靠字符串拼接决定去哪读。
  function validFileRef(n?: any) { return typeof n === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(n) }
  function stripFrontmatter(raw?: any) {
    const s = String(raw || '').replace(/^\uFEFF/, '')
    const m = s.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/)
    if (!m) return s
    return s.slice(m[0].length)
  }
  // Node 内建模块只在第一次用时动态加载一次，之后复用：不用 import 边，也不装着类型包。
  let modsCache: any = null
  async function loadMods() {
    if (modsCache) return modsCache
    // @ts-expect-error —— Node 内建模块的动态引用：类型声明随 @types/node 缺席，运行时一定存在（纯类型层面）。
    const pathMod: any = await import('node:path')
    // @ts-expect-error —— Node 内建模块的动态引用：类型声明随 @types/node 缺席，运行时一定存在（纯类型层面）。
    const fsSync: any = await import('node:fs')
    // @ts-expect-error —— Node 内建模块的动态引用：类型声明随 @types/node 缺席，运行时一定存在（纯类型层面）。
    const osMod: any = await import('node:os')
    modsCache = { pathMod: pathMod, fsSync: fsSync, osMod: osMod }
    return modsCache
  }
  /** 随包目录的候选位置（与 bootstrap 同一套口径），按可信度排好序；调用方负责判断哪个真的在盘上。 */
  function candidateDirs(mods: any) {
    const pathMod = mods.pathMod
    const osMod = mods.osMod
    const candidates: any[] = []
    try {
      const cwd = (typeof process !== 'undefined' && typeof process.cwd === 'function') ? String(process.cwd() || '') : ''
      if (cwd) {
        candidates.push(pathMod.resolve(cwd, 'package/bundled-skills'))
        candidates.push(pathMod.resolve(cwd, '../package/bundled-skills'))
        candidates.push(pathMod.resolve(cwd, '../../package/bundled-skills'))
        let cur = cwd
        for (let i = 0; i < 4; i++) {
          candidates.push(pathMod.join(cur, 'package/bundled-skills'))
          candidates.push(pathMod.join(cur, 'node_modules/dsh-mattpocock-skills-deck/bundled-skills'))
          cur = pathMod.dirname(cur)
        }
      }
    } catch {}
    try {
      const home = osMod.homedir()
      if (home) {
        candidates.push(pathMod.join(home, '.dsh/profiles/web/node_modules/dsh-mattpocock-skills-deck/bundled-skills'))
        candidates.push(pathMod.join(home, '.dsh/profiles/desktop/node_modules/dsh-mattpocock-skills-deck/bundled-skills'))
      }
    } catch {}
    const seen = new Set()
    const out: string[] = []
    for (const c of candidates) {
      const n = pathMod.normalize(c)
      if (seen.has(n)) continue
      seen.add(n)
      out.push(n)
    }
    return out
  }
  async function findCardPath(name?: any) {
    const mods = await loadMods()
    const pathMod = mods.pathMod
    const fsSync = mods.fsSync
    const dirs = candidateDirs(mods)
    for (const dir of dirs) {
      const file = pathMod.join(dir, name, 'SKILL.md')
      try {
        const st = fsSync.statSync(file)
        if (st && st.isFile()) {
          // 译文取随包根的兄弟目录 bundled-skills-zh（<root>-zh/<name>/SKILL.md），按技能名镜像。
          // 不能和原文同目录：同步脚本每次整目录重建 bundled-skills，同目录的译文会被一起删掉。
          const zhRoot = pathMod.join(pathMod.dirname(dir), 'bundled-skills-zh')
          return { file: file, zhFile: pathMod.join(zhRoot, name, 'SKILL.md') }
        }
      } catch {}
    }
    return null
  }
  /** 这个技能目录所在的那一份随包目录：正文成功时据此算「哪些文件名能点」。 */
  async function findRootForSkill(name?: any) {
    const mods = await loadMods()
    const pathMod = mods.pathMod
    const fsSync = mods.fsSync
    for (const dir of candidateDirs(mods)) {
      const file = pathMod.join(dir, name, 'SKILL.md')
      try {
        const st = fsSync.statSync(file)
        if (st && st.isFile()) return dir
      } catch {}
    }
    return null
  }
  // 扫一份随包目录：每个技能目录下的 *.md（含子目录）按文件名建索引。
  // 中文译文（*.zh.md）不进名单 —— 它是译文的配套文件，正文里不会写它的名字。
  function walkMd(fsSync: any, pathMod: any, dir: string, prefix: string, out: string[]) {
    let entries: any[] = []
    try { entries = fsSync.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const nm = String((e && e.name) || '')
      if (!nm || nm.charAt(0) === '.') continue
      const rel = prefix ? prefix + '/' + nm : nm
      let isDir = false
      try { isDir = !!(e && typeof e.isDirectory === 'function' && e.isDirectory()) } catch {}
      if (isDir) { walkMd(fsSync, pathMod, pathMod.join(dir, nm), rel, out); continue }
      if (!/\.md$/i.test(nm) || /\.zh\.md$/i.test(nm)) continue
      out.push(rel)
    }
  }
  function buildIndex(rootPath: string, mods: any) {
    const fsSync = mods.fsSync
    const pathMod = mods.pathMod
    const byBase: any = {}
    let skills: any[] = []
    try { skills = fsSync.readdirSync(rootPath, { withFileTypes: true }) } catch { skills = [] }
    for (const ent of skills) {
      let isDir = false
      try { isDir = !!(ent && typeof ent.isDirectory === 'function' && ent.isDirectory()) } catch {}
      if (!isDir) continue
      const skill = String(ent.name || '')
      if (!validName(skill)) continue
      const files: string[] = []
      walkMd(fsSync, pathMod, pathMod.join(rootPath, skill), '', files)
      for (const rel of files) {
        const baseName = rel.split('/').pop()
        if (!baseName) continue
        if (!byBase[baseName]) byBase[baseName] = []
        byBase[baseName].push({ skill: skill, rel: rel })
      }
    }
    return { root: rootPath, byBase: byBase }
  }
  function staticRefs() {
    return Object.keys(FORMAT_ALIASES).concat(Object.keys(CHOICE_REFS), Object.keys(PROJECT_FILES))
  }
  function refsOf(index: any) {
    const out: string[] = []
    const seen: any = {}
    const push = function (n: string) { if (!n || seen[n]) return; seen[n] = true; out.push(n) }
    const add = function (list: any[]) { for (const n of list) push(String(n)) }
    add(staticRefs())
    if (index && index.byBase) add(Object.keys(index.byBase))
    return out
  }
  /** 第一份真的在盘上的随包目录（用来给「没有文件可读」的那些结果也带上可点名单）。 */
  async function firstRoot() {
    const mods = await loadMods()
    for (const dir of candidateDirs(mods)) {
      try {
        const st = mods.fsSync.statSync(dir)
        if (st && st.isDirectory()) return dir
      } catch {}
    }
    return null
  }
  async function allRefs() {
    try {
      const root = await firstRoot()
      if (!root) return staticRefs()
      return refsOf(buildIndex(root, await loadMods()))
    } catch { return staticRefs() }
  }
  /**
   * 按文件名找真文件：只从随包目录的真实名单里查。
   * 优先当前技能目录；只有一份就直接用；同名多份就回候选（界面选完再带着技能名回来重读）。
   */
  async function findEntry(baseName: string, currentSkill: string | null) {
    const mods = await loadMods()
    for (const root of candidateDirs(mods)) {
      try {
        const st = mods.fsSync.statSync(root)
        if (!st || !st.isDirectory()) continue
      } catch { continue }
      const index = buildIndex(root, mods)
      const hits = index.byBase[baseName]
      if (!hits || !hits.length) continue
      if (currentSkill) {
        for (const h of hits) {
          if (h.skill === currentSkill) return { root: root, entry: h, refs: refsOf(index) }
        }
      }
      if (hits.length === 1) return { root: root, entry: hits[0], refs: refsOf(index) }
      const options: any[] = []
      const seenSkill: any = {}
      for (const h of hits) {
        if (seenSkill[h.skill]) continue
        seenSkill[h.skill] = true
        options.push({ file: baseName, skill: h.skill })
      }
      return { root: root, entry: null, options: options, refs: refsOf(index) }
    }
    return { root: null, entry: null, refs: await allRefs() }
  }
  /** 读一份随包文件；超长、空文件、读不动都按「没有这一篇」。中文译文按既有规则有就一起回。 */
  async function readEntry(rootPath: string, entry: any, mods: any) {
    // @ts-expect-error —— Node 内建模块的动态引用：类型声明随 @types/node 缺席，运行时一定存在（纯类型层面）。
    const fsp: any = await import('node:fs/promises')
    const pathMod = mods.pathMod
    const file = pathMod.join(rootPath, entry.skill, entry.rel)
    const raw = await (fsp.default || fsp).readFile(file, 'utf8')
    if (raw == null || raw.length > MAX_BYTES) return null
    const md = stripFrontmatter(raw)
    if (!md || !md.trim()) return null
    let mdZh: any = null
    let pathZh: any = null
    // 既有译文规则只给 SKILL.md 用：同目录的 SKILL.zh.md。别的文件没有这个同目录约定，
    // 不判这一下会把英文原文当成译文读回来（replace 不匹配时文件名原样）。
    if (/SKILL\.md$/.test(file)) {
      try {
        const zhFile = file.replace(/SKILL\.md$/, 'SKILL.zh.md')
        const rawZh = await (fsp.default || fsp).readFile(zhFile, 'utf8')
        const z = stripFrontmatter(rawZh)
        if (z && z.trim() && z.length <= MAX_BYTES) { mdZh = z; pathZh = zhFile }
      } catch {}
    }
    // 非 SKILL.md 的随包文件：按 #1521 定下的位置在随包目录旁边的 bundled-skills-zh 找译文。
    if (!mdZh) {
      try {
        let zhRoot: any = null
        if (pathMod.basename(rootPath) === 'bundled-skills') zhRoot = pathMod.join(pathMod.dirname(rootPath), 'bundled-skills-zh')
        if (zhRoot) {
          const zhFile2 = pathMod.join(zhRoot, entry.skill, entry.rel)
          const rawZh2 = await (fsp.default || fsp).readFile(zhFile2, 'utf8')
          const z2 = stripFrontmatter(rawZh2)
          if (z2 && z2.trim() && z2.length <= MAX_BYTES) { mdZh = z2; pathZh = zhFile2 }
        }
      } catch {}
    }
    return { md: md, path: file, mdZh: mdZh, pathZh: pathZh }
  }
  async function readFileRef(args?: any): Promise<ReadDocResult> {
    const ref = args && args.file
    const wanted = validFileRef(ref) ? String(ref) : ''
    if (!wanted) return { ok: false, missing: true }
    const currentSkill = validName(args && args.name) ? String(args.name) : null
    // 项目文件：技能在你的项目里创建或维护的文件，插件没有随包原文 —— 只给一句说明，不伪造内容。
    if (PROJECT_FILES[wanted]) return { ok: true, kind: 'project', name: wanted, refs: await allRefs() }
    // issue-tracker.md：上游拆成三份模板，先让使用者选一份。
    if (CHOICE_REFS[wanted]) {
      const options: any[] = []
      for (const one of CHOICE_REFS[wanted]) {
        const found = await findEntry(String(one), currentSkill)
        if (found && found.entry) options.push({ file: one, skill: found.entry.skill })
      }
      if (!options.length) return { ok: false, missing: true }
      return { ok: true, kind: 'choose', name: wanted, options: options, refs: await allRefs() }
    }
    const aliased = FORMAT_ALIASES[wanted] ? String(FORMAT_ALIASES[wanted]) : null
    const target = aliased || wanted
    const found = await findEntry(target, currentSkill)
    if (found && found.entry && found.root) {
      const got = await readEntry(found.root, found.entry, await loadMods())
      if (!got) return { ok: false, missing: true }
      return {
        ok: true,
        kind: aliased ? 'format' : 'file',
        name: wanted,
        file: target,
        skill: found.entry.skill,
        md: got.md,
        path: got.path,
        mdZh: got.mdZh,
        pathZh: got.pathZh,
        refs: found.refs,
      }
    }
    if (found && found.options && found.options.length) {
      // 别名（如 GLOSSARY.md）在当前技能目录里没有模板、整包却有好几份时先让人选；
      // 「这是格式说明」靠 format 标出来，选完模板后界面才不会把它当普通原文画。
      return { ok: true, kind: 'choose', name: wanted, options: found.options, refs: found.refs, format: aliased ? true : false }
    }
    return { ok: false, missing: true }
  }
  async function readDoc(args?: any): Promise<ReadDocResult> {
    const wantFile = args && args.file
    // 有文件参数就走「正文里的文件名」这一档；没有就仍是原来的 SKILL.md 一档，行为不变。
    if (wantFile !== undefined && wantFile !== null) return readFileRef(args)
    const name = args && args.name
    if (!validName(name)) return { ok: false, missing: true }
    try {
      const found = await findCardPath(name)
      if (!found) return { ok: false, missing: true }
      const file = found.file
      // @ts-expect-error —— Node 内建模块的动态引用：类型声明随 @types/node 缺席，运行时一定存在（纯类型层面）。
      const fsp: any = await import('node:fs/promises')
      const raw = await (fsp.default || fsp).readFile(file, 'utf8')
      if (raw == null || raw.length > MAX_BYTES) return { ok: false, missing: true }
      const md = stripFrontmatter(raw)
      if (!md || !md.trim()) return { ok: false, missing: true }
      let mdZh: any = null
      let pathZh: any = null
      try {
        const rawZh = await (fsp.default || fsp).readFile(found.zhFile, 'utf8')
        const z = stripFrontmatter(rawZh)
        if (z && z.trim() && z.length <= MAX_BYTES) { mdZh = z; pathZh = found.zhFile }
      } catch {}
      // 可点名单一并回给界面：正文里写到的随包 md 文件名按它判断能不能点。
      let refs: any = null
      try {
        const root = await findRootForSkill(name)
        if (root) refs = refsOf(buildIndex(root, await loadMods()))
      } catch {}
      if (!refs) refs = await allRefs()
      return { ok: true, md: md, path: file, mdZh: mdZh, pathZh: pathZh, refs: refs }
    } catch { return { ok: false, missing: true } }
  }
  return { readDoc }
}
