/**
 * src/host/bootstrap.ts —— 启动技底与技能名单（来源：src/host/bootstrap.js，H1 #445 从 host/index.js 31–215/235–249 搬出，纯结构、行为零变化；本次只加类型标注与注释，逻辑一行未动）。
 *
 * 为什么要有它（一句话）：宿主启动时要做两件事，一是把随包带的技能目录注册成一个高优先级的技能来源（盖过家目录里的旧副本），二是把技能名单与链条要的三项技能名惰性读出来，收在这里组装，调用点只按名取。
 *
 * 三条不能改的约定（改之前先看文件头原来那段注释与调用点 index.js）：
 * 1. 由 index.js 动态引用加载，依赖全显式传入（只有 ctx 一件），本文件不静态引用其它新文件（shared 的散文件只在用到时动态 import，读不到就回退），技能名单的真源是 shared/matt-skills.js，链条三项的真源是链目录视图。
 * 2. 随包来源的排序号固定写 350（家目录两档是 400 与 500，数字越小越优先），来源名固定写 bundled-mattpocock，改了旧副本就盖不住。
 * 3. 技能目录找不到时只记一行警告就退，不抛错，因为随包目录在某些安装形态下本来就不在。
 */

// 运行时的 process 声明（与 src/host/git-process.ts:30 同形）：本文件只在拼随包目录候选路径时读它，且按「可能不存在」写（见下面那行 typeof 守卫）。
declare const process: { cwd?: () => string } | undefined

// ---------------------------------------------------------------------------
// 类型（本次转 TypeScript：只写类型不写实现）。
//
// 为什么标成这样：进来的依赖只有 ctx 一件（读技能服务、日志服务与副作用托管），形状按本文件实际用到的三个成员写成最小；技能名单是字符串数组，读不到时用内联兜底顶上；随包目录的解析全走动态引用的 Node 内建模块，类型用 any 接住，运行时行为一字不变。
// ---------------------------------------------------------------------------

/** 组装函数收到的依赖：只有宿主上下文 ctx 一件（技能服务、日志服务与副作用托管都从它现取）。 */
interface BootstrapDeps {
  ctx: any
}

/** 组装产出的两个惰性加载器：技能名单与链条三项，都只在第一次调用时读文件。 */
export interface BootstrapPhones {
  getMattSkillProbeNames: () => Promise<string[]>
  getChainSkillNames: () => Promise<string[]>
}

/** /ask-matt 正文末尾要追加的规则节：skillName 管「拼给谁」，section 是要拼上去的原文。 */
interface AskMattExtra {
  skillName: string
  section: string
}

/**
 * 组装启动技底与技能名单（依赖全显式传入，只有 ctx）。
 *
 * 为什么：随包技能来源要在启动时尽早注册，而技能名单很大，惰性读能让不需要它的启动路径不付这笔钱。
 * 什么约定不能改：返回对象的两个字段名是调用点按名取的，改名调用点就拿不到。
 */
export function createBootstrap(deps: BootstrapDeps): BootstrapPhones {
  const { ctx } = deps as { ctx: any }
    // === T2 #389 bundled 优先 provider（rank 350，盖过家目录旧副本，trustedHost，ctx.effect 托管）===
    // 零代码声明：无需 env 晚置，直接 registerProvider；list 返回 package/bundled-skills 的 27 个，rank 350 优先（家目录 400/500 旧副本被盖住，删项残留需手动清），bundled 随包消失
    // 选择 provider 而非 env 的依据见 R1 研究（env 构造时一次性读，晚置失效）；参见 docs/adr/20260828-skill-probe-union-channels.md 的 trustedHost 约束
    ;(() => {
      try {
        const skills: any = ctx.get('skills')
        if (!skills || typeof skills.registerProvider !== 'function') return
        ;(async () => {
          let bundledDir: string | null = null
          try {
            // @ts-expect-error —— 本域 tsconfig 有意不加载任何类型包（types 为空），node:path / node:fs / node:os 的类型声明随 @types/node 一起缺席；运行时一定是 Node，这三个模块必然存在（纯类型层面，不影响运行时转译）。
            const pathMod: any = await import('node:path')
            // @ts-expect-error —— 见上，node:fs 同理。
            const fsSync: any = await import('node:fs')
            // @ts-expect-error —— 见上，node:os 同理。
            const osMod: any = await import('node:os')
            const candidates: string[] = []
            const cwd: string = (typeof process !== 'undefined' && typeof process.cwd === 'function') ? String(process.cwd() || '') : ''
            if (cwd) {
              candidates.push(pathMod.resolve(cwd, 'package/bundled-skills'))
              candidates.push(pathMod.resolve(cwd, '../package/bundled-skills'))
              candidates.push(pathMod.resolve(cwd, '../../package/bundled-skills'))
              candidates.push(pathMod.resolve(cwd, 'bundled-skills'))
              let cur: string = cwd
              for (let i: number = 0; i < 4; i++) {
                candidates.push(pathMod.join(cur, 'package/bundled-skills'))
                candidates.push(pathMod.join(cur, 'node_modules/dsh-mattpocock-skills-deck/bundled-skills'))
                cur = pathMod.dirname(cur)
              }
            }
            try {
              const home: string = osMod.homedir()
              if (home) {
                candidates.push(pathMod.join(home, '.dsh/profiles/web/node_modules/dsh-mattpocock-skills-deck/bundled-skills'))
                candidates.push(pathMod.join(home, '.dsh/profiles/desktop/node_modules/dsh-mattpocock-skills-deck/bundled-skills'))
                try {
                  const profilesDir: string = pathMod.join(home, '.dsh/profiles')
                  // @ts-expect-error —— 见上，node:fs/promises 同理。
                  const entries: any = await (await import('node:fs/promises')).readdir(profilesDir, { withFileTypes: true }).catch(() => [])
                  for (const e of (entries as any[])) if (e.isDirectory()) candidates.push(pathMod.join(profilesDir, e.name, 'node_modules/dsh-mattpocock-skills-deck/bundled-skills'))
                } catch {}
              }
            } catch {}
            const seen: Set<string> = new Set()
            const uniq: string[] = []
            for (const c of candidates) {
              const n: string = pathMod.normalize(c)
              if (!seen.has(n)) { seen.add(n); uniq.push(n) }
            }
            for (const cand of uniq) {
              try {
                const st: any = fsSync.statSync(cand)
                if (st && st.isDirectory()) {
                  try {
                    const way: string = pathMod.join(cand, 'wayfinder', 'SKILL.md')
                    const wst: any = fsSync.statSync(way)
                    if (wst && wst.isFile()) { bundledDir = cand; break }
                  } catch {}
                  try {
                    const ents: any = fsSync.readdirSync(cand, { withFileTypes: true })
                    const dcount: number = (ents as any[]).filter((e: any) => e.isDirectory()).length
                    if (dcount >= 20) { bundledDir = cand; break }
                  } catch {}
                }
              } catch {}
            }
          } catch (e: unknown) { bundledDir = null }
          if (!bundledDir) {
            try { ctx.get('logger')?.warn?.('[bundled] dir not found, skip provider') } catch {}
            return
          }
          function parseSkillRaw(raw: unknown): any {
            try {
              const s: string = String(raw || '').replace(/^﻿/, '')
              const m: RegExpMatchArray | null = s.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
              if (!m) return undefined
              const front: string = m[1]
              const body: string = s.slice(m[0].length)
              const getField = (key: string): string | undefined => {
                const re: RegExp = new RegExp('^\\s*' + key.replace(/-/g, '\\-') + '\\s*:\\s*(.+)$', 'm')
                const mm: RegExpMatchArray | null = front.match(re)
                if (!mm) return undefined
                let v: string = mm[1].trim()
                if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
                return v.trim()
              }
              const name: string | undefined = getField('name')
              const description: string | undefined = getField('description')
              if (!name || !description) return undefined
              const whenToUse: string | undefined = getField('whenToUse')
              const parseBool = (val: string | undefined): boolean | undefined => {
                if (val === undefined) return undefined
                const l: string = String(val).toLowerCase().trim()
                if (l === 'true' || l === 'yes' || l === 'on' || l === '1') return true
                if (l === 'false' || l === 'no' || l === 'off' || l === '0') return false
                return undefined
              }
              const disableModel: boolean | undefined = parseBool(getField('disable-model-invocation'))
              const userInv: boolean | undefined = parseBool(getField('user-invocable'))
              const invocation: { modelInvocable: boolean; userInvocable: boolean } = { modelInvocable: disableModel !== true, userInvocable: userInv !== false }
              return { name, description, whenToUse: whenToUse || undefined, invocation, body: body.trim(), content: body.trim() }
            } catch { return undefined }
          }
          function isValidSkillName(n: unknown): boolean { try { return /^[\p{L}0-9]+(?:-[\p{L}0-9]+)*$/u.test(String(n)) } catch { return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(String(n)) } }
          // 数字越小越优先：家目录两档是 400 与 500，随包取 350 盖过家目录旧副本，项目级仍可高于随包。
          const BUNDLED_RANK: number = 350
          const PROVIDER_NAME: string = 'bundled-mattpocock'
          const createBundledProvider = (control: unknown): any => {
            return {
              name: PROVIDER_NAME,
              async list(opts: any): Promise<any[]> {
                try {
                  // @ts-expect-error —— 见上，node:fs/promises 同理。
                  const fsp: any = await import('node:fs/promises')
                  // @ts-expect-error —— 见上，node:path 同理。
                  const pathMod2: any = await import('node:path')
                  if (opts && opts.signal && opts.signal.aborted) throw opts.signal.reason
                  let entries: any[] = []
                  try { entries = await fsp.readdir(bundledDir, { withFileTypes: true }) } catch { return [] }
                  const out: any[] = []
                  for (const ent of entries) {
                    if (!ent.isDirectory()) continue
                    const dirName: string = ent.name
                    if (!isValidSkillName(dirName)) continue
                    const mdPath: string = pathMod2.join((bundledDir as string), dirName, 'SKILL.md')
                    try {
                      const raw: string = await fsp.readFile(mdPath, 'utf8')
                      const parsed: any = parseSkillRaw(raw)
                      if (!parsed) continue
                      if (parsed.name !== dirName) continue
                      out.push({
                        name: parsed.name,
                        description: parsed.description,
                        ...(parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {}),
                        invocation: parsed.invocation,
                        source: 'bundled',
                        provider: PROVIDER_NAME,
                        rank: BUNDLED_RANK,
                        locator: { path: mdPath, directory: pathMod2.join((bundledDir as string), dirName) },
                        resourceBase: { kind: 'directory', path: pathMod2.join((bundledDir as string), dirName) },
                        path: mdPath
                      })
                    } catch {}
                  }
                  out.sort((a: any, b: any) => a.name.localeCompare(b.name))
                  return out
                } catch (e: unknown) {
                  try { ctx.get('logger')?.warn?.('[bundled] list failed: ' + String((e as any) && (e as any).message || e)) } catch {}
                  return []
                }
              },
              async get(candidate: any, opts: any): Promise<any> {
                try {
                  // @ts-expect-error —— 见上，node:fs/promises 同理。
                  const fsp2: any = await import('node:fs/promises')
                  if (opts && opts.signal && opts.signal.aborted) throw opts.signal.reason
                  const loc: any = candidate && candidate.locator ? candidate.locator : null
                  const p: string | null = (loc && loc.path) ? loc.path : (candidate && candidate.path) ? candidate.path : null
                  if (!p) return undefined
                  let raw: string
                  try { raw = await fsp2.readFile(p, 'utf8') } catch { return undefined }
                  const parsed: any = parseSkillRaw(raw)
                  if (!parsed) return undefined
                  if (parsed.name !== candidate.name) return undefined
                  // @ts-expect-error —— 见上，node:path 同理。
                  const dir: string = loc && loc.directory ? loc.directory : (await import('node:path')).dirname(p)
                  if (opts && opts.signal && opts.signal.aborted) throw opts.signal.reason
                  // #1412：模型执行 /ask-matt 时读到的正文在这里定稿。上游原文照旧，只在归属技能是
                  // ask-matt 时把插件追加的「推荐下一步」规则节拼到末尾。每次都从盘上原文重新拼，
                  // 不在解析结果上累加，所以同一个技能反复读也不会把规则节叠两遍。
                  let content: string = parsed.content
                  const askMatt: AskMattExtra | null = await loadAskMattExtra()
                  if (askMatt && parsed.name === askMatt.skillName) {
                    content = (content ? String(content).replace(/\s+$/, '') + '\n\n' : '') + askMatt.section
                  }
                  return {
                    name: parsed.name,
                    description: parsed.description,
                    ...(parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {}),
                    invocation: parsed.invocation,
                    source: 'bundled',
                    provider: PROVIDER_NAME,
                    resourceBase: { kind: 'directory', path: dir },
                    path: p,
                    content: content
                  }
                } catch { return undefined }
              }
            }
          }
          let dispose: any = null
          try {
            dispose = skills.registerProvider(createBundledProvider)
            try { ctx.effect(() => () => { try { dispose && dispose() } catch {} }) } catch {}
            try { ctx.get('logger')?.info?.('[bundled] provider registered at ' + bundledDir + ' rank ' + BUNDLED_RANK) } catch {}
            console.log('[bundled] provider registered at ' + bundledDir + ' rank ' + BUNDLED_RANK + ' (27 skills expected)')
          } catch (e: unknown) {
            try { console.warn('[bundled] registerProvider failed ' + String((e as any) && (e as any).message || e)) } catch {}
          }
        })()
      } catch {}
    })()
    // 技能名单（#280 单一真源：与 check-catalog + client SKILLS 同步；拼写以真实目录为准，B 语义由 skills.get 覆盖）
    // 真源 = shared/matt-skills.js（MATT_SKILL_PROBE_NAMES）。本字段由 getMattSkillProbeNames() 惰性加载。
    let SKILL_PROBE_NAMES: string[] | null = null
    async function getMattSkillProbeNames(): Promise<string[]> {
      if (SKILL_PROBE_NAMES) return SKILL_PROBE_NAMES
      try {
        const m: any = await import('../shared/matt-skills.js')
        SKILL_PROBE_NAMES = (m && (m.MATT_SKILL_PROBE_NAMES || m.default?.MATT_SKILL_PROBE_NAMES)) || null
        if (!SKILL_PROBE_NAMES) throw new Error('shared/matt-skills.js 未导出 MATT_SKILL_PROBE_NAMES')
      } catch (e: unknown) {
        // 兜底：内联一份与真源一致的常量（仅在 shared 文件丢失时使用；CI/构建必须保证真源在场）
        SKILL_PROBE_NAMES = ['ask-matt','code-review','codebase-design','diagnosing-bugs','domain-modeling','grill-with-docs','implement','improve-codebase-architecture','prototype','research','setup-matt-pocock-skills','tdd','to-spec','to-tickets','triage','wayfinder','wizard','grill-me','grilling','handoff','teach','to-questionnaire','wait-what','writing-for-agents','implement-spec','pr','retro']
      }
      return SKILL_PROBE_NAMES as string[]
    }
    // #968 链条要的三项技能名（真源 = 链目录视图 GENERIC_CHECK_ITEMS 里挂技能探针的那几项；
    // 平时探测只问这三项，全量只在人亲手重查时问。目录增减技能项，这里跟着变，不手写第二份名单。）
    let CHAIN_SKILL_NAMES: string[] | null = null
    async function getChainSkillNames(): Promise<string[]> {
      if (CHAIN_SKILL_NAMES) return CHAIN_SKILL_NAMES
      try {
        const m: any = await import('../shared/tracker/check-catalog-views.js')
        const items: any[] = (m && m.GENERIC_CHECK_ITEMS) || []
        CHAIN_SKILL_NAMES = items.filter(function (it: any) { return it && it.check && typeof it.check.skill === 'string' }).map(function (it: any) { return it.check.skill })
        if (!CHAIN_SKILL_NAMES.length) throw new Error('链目录里没有技能检查项')
      } catch (e: unknown) {
        // 兜底：与链目录一致的三项（仅在目录文件丢失时使用；目录在场时以上面读到的为准）
        CHAIN_SKILL_NAMES = ['wayfinder', 'setup-matt-pocock-skills', 'ask-matt']
      }
      return CHAIN_SKILL_NAMES as string[]
    }
    // #1412 /ask-matt 的「推荐下一步」规则节：真源是 shared/ask-matt-next-steps.ts，上游
    // package/bundled-skills/ask-matt/SKILL.md 一个字不动；只在 provider.get() 返回正文时拼到末尾。
    // 读不到规则文件时回退成空：规则缺失不该让 /ask-matt 整体读不出来，技能正文照常返回。
    let ASK_MATT_EXTRA: AskMattExtra | null = null
    async function loadAskMattExtra(): Promise<AskMattExtra | null> {
      if (ASK_MATT_EXTRA !== null) return ASK_MATT_EXTRA
      try {
        const m: any = await import('../shared/ask-matt-next-steps.js')
        const skillName: string = String((m && m.ASK_MATT_SKILL_NAME) || '')
        const section: string = String((m && m.ASK_MATT_NEXT_STEPS_SECTION) || '').trim()
        if (skillName && section) ASK_MATT_EXTRA = { skillName: skillName, section: section }
      } catch (e: unknown) {
        // 不做内联兜底：这里没有第二份可信的规则原文，宁可这次不追加，也不能自己编一份。
      }
      return ASK_MATT_EXTRA
    }
  return { getMattSkillProbeNames, getChainSkillNames }
}
