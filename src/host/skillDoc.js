// src/host/skillDoc.js —— 技能原文直读（888 落地：详情页读本地原文的电话 skill.readDoc）。
// 以后谁改它：改详情取数口径或原文定位的人。接线：由 index.js 动态 import 加载，依赖全显式传入；
// 不引用其他新文件（H4），定位走与 bootstrap.js 同一套候选目录（随包目录可信口径与它一致）。
// 只读随包原文目录：技能名只认字母数字与 - _（防跨目录），只拼 <dir>/<name>/SKILL.md，
// 读不到、非法名、超长一律回 {ok:false, missing:true}。
// 成功时把该文件的绝对路径一并回给界面：弹窗上那颗「复制路径」要复制的就是它（2026-10-10 人拍板）。
// 注意分寸：路径可以给界面显示与复制，但**日志里永远不写路径原文**（日志纪律另有其要求，两件事不冲突）。
export function createSkillDoc(deps) {
  const MAX_BYTES = 200000
  function validName(n) { return typeof n === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(n) }
  function stripFrontmatter(raw) {
    const s = String(raw || '').replace(/^\uFEFF/, '')
    const m = s.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/)
    if (!m) return s
    return s.slice(m[0].length)
  }
  async function findCardPath(name) {
    const pathMod = await import('node:path')
    const fsSync = await import('node:fs')
    const osMod = await import('node:os')
    const candidates = []
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
  async function readDoc(args) {
    const name = args && args.name
    if (!validName(name)) return { ok: false, missing: true }
    try {
      const file = await findCardPath(name)
      if (!file) return { ok: false, missing: true }
      const fsp = await import('node:fs/promises')
      const raw = await (fsp.default || fsp).readFile(file, 'utf8')
      if (raw == null || raw.length > MAX_BYTES) return { ok: false, missing: true }
      const md = stripFrontmatter(raw)
      if (!md || !md.trim()) return { ok: false, missing: true }
      return { ok: true, md: md, path: file }
    } catch { return { ok: false, missing: true } }
  }
  return { readDoc }
}
