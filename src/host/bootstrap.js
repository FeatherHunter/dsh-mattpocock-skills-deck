// src/host/bootstrap.js —— 启动技底与技能名单（H1 #445 从 host/index.js 31–215/235–249 搬出，纯结构、行为零变化）
// 以后谁改它：改启动装配、兜底技能 provider 或技能名单惰性加载的人。预估约 250 行，超 350 打回。
// 接线：由 index.js 动态 import 动态加载，依赖全显式传入（仅 ctx）；本文件不引用其他新文件。
export function createBootstrap(deps) {
  const { ctx } = deps
    // === T2 #389 bundled 兜底 provider（rank 600，trustedHost，ctx.effect 托管）===
    // 零代码声明：无需 env 晚置，直接 registerProvider；list 返回 package/bundled-skills 的 25 个，rank 600 兜底，bundled 随包消失
    // 选择 provider 而非 env 的依据见 R1 研究（env 构造时一次性读，晚置失效）；参见 docs/adr/20260828-skill-probe-union-channels.md 的 trustedHost 约束
    ;(() => {
      try {
        const skills = ctx.get('skills')
        if (!skills || typeof skills.registerProvider !== 'function') return
        ;(async () => {
          let bundledDir = null
          try {
            const pathMod = await import('node:path')
            const fsSync = await import('node:fs')
            const osMod = await import('node:os')
            const candidates = []
            const cwd = (typeof process !== 'undefined' && typeof process.cwd === 'function') ? String(process.cwd() || '') : ''
            if (cwd) {
              candidates.push(pathMod.resolve(cwd, 'package/bundled-skills'))
              candidates.push(pathMod.resolve(cwd, '../package/bundled-skills'))
              candidates.push(pathMod.resolve(cwd, '../../package/bundled-skills'))
              candidates.push(pathMod.resolve(cwd, 'bundled-skills'))
              let cur = cwd
              for (let i = 0; i < 4; i++) {
                candidates.push(pathMod.join(cur, 'package/bundled-skills'))
                candidates.push(pathMod.join(cur, 'node_modules/dsh-mattpocock-skills-deck/bundled-skills'))
                cur = pathMod.dirname(cur)
              }
            }
            try {
              const home = osMod.homedir()
              if (home) {
                candidates.push(pathMod.join(home, '.dsh/profiles/web/node_modules/dsh-mattpocock-skills-deck/bundled-skills'))
                candidates.push(pathMod.join(home, '.dsh/profiles/desktop/node_modules/dsh-mattpocock-skills-deck/bundled-skills'))
                try {
                  const profilesDir = pathMod.join(home, '.dsh/profiles')
                  const entries = await (await import('node:fs/promises')).readdir(profilesDir, { withFileTypes: true }).catch(() => [])
                  for (const e of entries) if (e.isDirectory()) candidates.push(pathMod.join(profilesDir, e.name, 'node_modules/dsh-mattpocock-skills-deck/bundled-skills'))
                } catch {}
              }
            } catch {}
            const seen = new Set()
            const uniq = []
            for (const c of candidates) {
              const n = pathMod.normalize(c)
              if (!seen.has(n)) { seen.add(n); uniq.push(n) }
            }
            for (const cand of uniq) {
              try {
                const st = fsSync.statSync(cand)
                if (st && st.isDirectory()) {
                  try {
                    const way = pathMod.join(cand, 'wayfinder', 'SKILL.md')
                    const wst = fsSync.statSync(way)
                    if (wst && wst.isFile()) { bundledDir = cand; break }
                  } catch {}
                  try {
                    const ents = fsSync.readdirSync(cand, { withFileTypes: true })
                    const dcount = ents.filter(e => e.isDirectory()).length
                    if (dcount >= 20) { bundledDir = cand; break }
                  } catch {}
                }
              } catch {}
            }
          } catch (e) { bundledDir = null }
          if (!bundledDir) {
            try { ctx.get('logger')?.warn?.('[bundled] dir not found, skip provider') } catch {}
            return
          }
          function parseSkillRaw(raw) {
            try {
              const s = String(raw || '').replace(/^﻿/, '')
              const m = s.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
              if (!m) return undefined
              const front = m[1]
              const body = s.slice(m[0].length)
              const getField = (key) => {
                const re = new RegExp('^\\s*' + key.replace(/-/g, '\\-') + '\\s*:\\s*(.+)$', 'm')
                const mm = front.match(re)
                if (!mm) return undefined
                let v = mm[1].trim()
                if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
                return v.trim()
              }
              const name = getField('name')
              const description = getField('description')
              if (!name || !description) return undefined
              const whenToUse = getField('whenToUse')
              const parseBool = (val) => {
                if (val === undefined) return undefined
                const l = String(val).toLowerCase().trim()
                if (l === 'true' || l === 'yes' || l === 'on' || l === '1') return true
                if (l === 'false' || l === 'no' || l === 'off' || l === '0') return false
                return undefined
              }
              const disableModel = parseBool(getField('disable-model-invocation'))
              const userInv = parseBool(getField('user-invocable'))
              const invocation = { modelInvocable: disableModel !== true, userInvocable: userInv !== false }
              return { name, description, whenToUse: whenToUse || undefined, invocation, body: body.trim(), content: body.trim() }
            } catch { return undefined }
          }
          function isValidSkillName(n) { try { return /^[\p{L}0-9]+(?:-[\p{L}0-9]+)*$/u.test(n) } catch { return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(n) } }
          const BUNDLED_RANK = 600
          const PROVIDER_NAME = 'bundled-mattpocock'
          const createBundledProvider = (control) => {
            return {
              name: PROVIDER_NAME,
              async list(opts) {
                try {
                  const fsp = await import('node:fs/promises')
                  const pathMod2 = await import('node:path')
                  if (opts && opts.signal && opts.signal.aborted) throw opts.signal.reason
                  let entries = []
                  try { entries = await fsp.readdir(bundledDir, { withFileTypes: true }) } catch { return [] }
                  const out = []
                  for (const ent of entries) {
                    if (!ent.isDirectory()) continue
                    const dirName = ent.name
                    if (!isValidSkillName(dirName)) continue
                    const mdPath = pathMod2.join(bundledDir, dirName, 'SKILL.md')
                    try {
                      const raw = await fsp.readFile(mdPath, 'utf8')
                      const parsed = parseSkillRaw(raw)
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
                        locator: { path: mdPath, directory: pathMod2.join(bundledDir, dirName) },
                        resourceBase: { kind: 'directory', path: pathMod2.join(bundledDir, dirName) },
                        path: mdPath
                      })
                    } catch {}
                  }
                  out.sort((a, b) => a.name.localeCompare(b.name))
                  return out
                } catch (e) {
                  try { ctx.get('logger')?.warn?.('[bundled] list failed: ' + String(e && e.message || e)) } catch {}
                  return []
                }
              },
              async get(candidate, opts) {
                try {
                  const fsp2 = await import('node:fs/promises')
                  if (opts && opts.signal && opts.signal.aborted) throw opts.signal.reason
                  const loc = candidate && candidate.locator ? candidate.locator : null
                  const p = (loc && loc.path) ? loc.path : (candidate && candidate.path) ? candidate.path : null
                  if (!p) return undefined
                  let raw
                  try { raw = await fsp2.readFile(p, 'utf8') } catch { return undefined }
                  const parsed = parseSkillRaw(raw)
                  if (!parsed) return undefined
                  if (parsed.name !== candidate.name) return undefined
                  const dir = loc && loc.directory ? loc.directory : (await import('node:path')).dirname(p)
                  if (opts && opts.signal && opts.signal.aborted) throw opts.signal.reason
                  return {
                    name: parsed.name,
                    description: parsed.description,
                    ...(parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {}),
                    invocation: parsed.invocation,
                    source: 'bundled',
                    provider: PROVIDER_NAME,
                    resourceBase: { kind: 'directory', path: dir },
                    path: p,
                    content: parsed.content
                  }
                } catch { return undefined }
              }
            }
          }
          let dispose = null
          try {
            dispose = skills.registerProvider(createBundledProvider)
            try { ctx.effect(() => () => { try { dispose && dispose() } catch {} }) } catch {}
            try { ctx.get('logger')?.info?.('[bundled] provider registered at ' + bundledDir + ' rank ' + BUNDLED_RANK) } catch {}
            console.log('[bundled] provider registered at ' + bundledDir + ' rank ' + BUNDLED_RANK + ' (25 skills expected)')
          } catch (e) {
            try { console.warn('[bundled] registerProvider failed ' + String(e && e.message || e)) } catch {}
          }
        })()
      } catch {}
    })()
    // 技能名单（#280 单一真源：与 check-catalog + client SKILLS 同步；拼写以真实目录为准，B 语义由 skills.get 覆盖）
    // 真源 = shared/matt-skills.js（MATT_SKILL_PROBE_NAMES）。本字段由 getMattSkillProbeNames() 惰性加载。
    let SKILL_PROBE_NAMES = null
    async function getMattSkillProbeNames() {
      if (SKILL_PROBE_NAMES) return SKILL_PROBE_NAMES
      try {
        const m = await import('../shared/matt-skills.js')
        SKILL_PROBE_NAMES = (m && (m.MATT_SKILL_PROBE_NAMES || m.default?.MATT_SKILL_PROBE_NAMES)) || null
        if (!SKILL_PROBE_NAMES) throw new Error('shared/matt-skills.js 未导出 MATT_SKILL_PROBE_NAMES')
      } catch (e) {
        // 兜底：内联一份与真源一致的常量（仅在 shared 文件丢失时使用；CI/构建必须保证真源在场）
        SKILL_PROBE_NAMES = ['ask-matt','code-review','codebase-design','diagnosing-bugs','domain-modeling','grill-with-docs','implement','improve-codebase-architecture','prototype','research','resolving-merge-conflicts','setup-matt-pocock-skills','tdd','to-spec','to-tickets','triage','wayfinder','wizard','grill-me','grilling','handoff','teach','to-questionnaire','wait-what','writing-for-agents']
      }
      return SKILL_PROBE_NAMES
    }
  return { getMattSkillProbeNames }
}
