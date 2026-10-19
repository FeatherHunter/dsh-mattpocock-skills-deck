/**
 * src/host/skillDoc.ts —— 技能原文直读（来源：src/host/skillDoc.js，issue #1247 转写，本次只加类型标注与注释，逻辑一行未动）。
 *
 * 为什么要有它（一句话）：详情页读本地原文的电话 skill.readDoc；只读随包原文目录，中文译文有就一起回。
 *
 * 三条不能改的约定（改之前先看原 skillDoc.js 头注释与调用点 index.ts）：
 * 1. 行为零变化：逻辑逐行对应，只加类型标注与中文注释，不改任何运行时语义；相对导入保留 .js 后缀，由 scripts/ts-hook.mts 改指同名 .ts。
 * 2. 只写可剥离 TypeScript：不新增运行时语法（禁用 enum 与构造函数参数属性），类型一律 import type 或内联标注，转译后与原 .js 逐行同义。
 * 3. 不新增任何 import 边：只给已有引用加类型，不引入新模块依赖；Node 内建模块的类型缺席由文件内局部声明与 @ts-expect-error 承接，不装 @types/node。
 */

// 运行时的 process 兜底声明（与 src/host/git-process.ts:30 同形）：本 tsconfig 有意不加载任何类型包，Node 运行时保证 process 存在；只声明本文件实际用到的形状，不产生运行时代码。
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

// src/host/skillDoc.js —— 技能原文直读（888 落地：详情页读本地原文的电话 skill.readDoc）。
// 以后谁改它：改详情取数口径或原文定位的人。接线：由 index.js 动态 import 加载，依赖全显式传入；
// 不引用其他新文件（H4），定位走与 bootstrap.js 同一套候选目录（随包目录可信口径与它一致）。
// 只读随包原文目录：技能名只认字母数字与 - _（防跨目录），只拼 <dir>/<name>/SKILL.md，
// 读不到、非法名、超长一律回 {ok:false, missing:true}。
// 成功时把该文件的绝对路径一并回给界面：弹窗上那颗「复制路径」要复制的就是它（2026-10-10 人拍板）。
// 中文译文包（同目录的 SKILL.zh.md）有就一起回：弹窗上的「中文」按钮据此出现，没有译文就不出现。
// 英文原文照旧必回；译文缺失、读不动、超长都只是「没有译文」，不影响英文那一份。
// 注意分寸：路径可以给界面显示与复制，但**日志里永远不写路径原文**（日志纪律另有其要求，两件事不冲突）。
export function createSkillDoc(deps?: any): any {
  const MAX_BYTES = 200000
  function validName(n?: any) { return typeof n === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(n) }
  function stripFrontmatter(raw?: any) {
    const s = String(raw || '').replace(/^\uFEFF/, '')
    const m = s.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/)
    if (!m) return s
    return s.slice(m[0].length)
  }
  async function findCardPath(name?: any) {
    // @ts-expect-error —— Node 内建模块的动态引用：类型声明随 @types/node 缺席，运行时一定存在（纯类型层面）。
    const pathMod: any = await import('node:path')
    // @ts-expect-error —— Node 内建模块的动态引用：类型声明随 @types/node 缺席，运行时一定存在（纯类型层面）。
    const fsSync: any = await import('node:fs')
    // @ts-expect-error —— Node 内建模块的动态引用：类型声明随 @types/node 缺席，运行时一定存在（纯类型层面）。
    const osMod: any = await import('node:os')
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
    for (const c of candidates) {
      const n = pathMod.normalize(c)
      if (seen.has(n)) continue
      seen.add(n)
      const file = pathMod.join(n, name, 'SKILL.md')
      try {
        const st = fsSync.statSync(file)
        if (st && st.isFile()) return file
      } catch {}
    }
    return null
  }
  async function readDoc(args?: any) {
    const name = args && args.name
    if (!validName(name)) return { ok: false, missing: true }
    try {
      const file = await findCardPath(name)
      if (!file) return { ok: false, missing: true }
      // @ts-expect-error —— Node 内建模块的动态引用：类型声明随 @types/node 缺席，运行时一定存在（纯类型层面）。
      const fsp: any = await import('node:fs/promises')
      const raw = await (fsp.default || fsp).readFile(file, 'utf8')
      if (raw == null || raw.length > MAX_BYTES) return { ok: false, missing: true }
      const md = stripFrontmatter(raw)
      if (!md || !md.trim()) return { ok: false, missing: true }
      let mdZh: any = null
      let pathZh: any = null
      try {
        const zhFile = file.replace(/SKILL\.md$/, 'SKILL.zh.md')
        const rawZh = await (fsp.default || fsp).readFile(zhFile, 'utf8')
        const z = stripFrontmatter(rawZh)
        if (z && z.trim() && z.length <= MAX_BYTES) { mdZh = z; pathZh = zhFile }
      } catch {}
      return { ok: true, md: md, path: file, mdZh: mdZh, pathZh: pathZh }
    } catch { return { ok: false, missing: true } }
  }
  return { readDoc }
}
