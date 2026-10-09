/**
 * shared/skill-probe-channels.js — 技能名片探测通道（纯函数下沉）。
 *
 * 从 host/skillProbe.js 搬出（只搬逻辑，不改行为）：注册表之外的文件通道——
 * 存在性轻探、名片直读、判装分拣。宿主上下文（fs 服务、平台）由调用方当参数传进来，
 * 本文件不读任何宿主状态。调用方：host/skillProbe.js（经 import 回供链上三项与重查全量用）。
 */
export function isSkillCardValid(skillText, expectedName) {
  try {
    // #295 加固：先剥首个 UTF-8 BOM 再做 frontmatter 匹配——Windows 编辑器另存的 SKILL.md
    //   带隐形 BOM 前缀时 frontmatter 本身合法，此前被误判「名片无效 · frontmatter invalid」。
    //   仅剥离开头一个 BOM：非 BOM 输入逐字节透传（行为差集实测为空），name 精确匹配防冒名机制不变。
    const s = String(skillText || '').replace(/^\uFEFF/, '')
    const m = s.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
    if (!m) return false
    const front = m[1]
    const nameMatch = front.match(/^\s*name\s*:\s*["']?([^"'\r\n]+?)["']?\s*$/m)
    if (!nameMatch) return false
    const foundName = String(nameMatch[1] || '').trim()
    return foundName === String(expectedName || '').trim()
  } catch { return false }
}
// 路径存在性探测（path-shaped 纪律：lstat/exists 接受裸路径字符串；target-shaped 仅 readText/writeText 用 resolve 返回值）
export async function probeFsExists(curFs, platform, pathStr) {
  if (!pathStr) return false
  try {
    if (curFs && typeof curFs.lstat === 'function') {
      const info = await curFs.lstat(pathStr)
      if (info) return true
    }
  } catch {}
  try {
    if (platform && platform.fs && typeof platform.fs.lstat === 'function') {
      const info = await platform.fs.lstat(pathStr)
      if (info) return true
    }
  } catch {}
  try {
    if (platform && platform.fs && typeof platform.fs.exists === 'function') {
      const ok = await platform.fs.exists(pathStr)
      if (ok) return true
    }
  } catch {}
  return false
}
// #296 多通道并联探针（契约修订见 docs/adr/20260828-skill-probe-union-channels.md）：
// 判装口径从「注册表唯一绿」修订为「任一通道有效即已安装」——修复协议（installSkills 提示词以
// ~/.agents/skills 盘上齐全为成功）与检测口径必须用同一把尺；通道全空才红，红时附各通道判据。
// 通道：REGISTRY（probeSkill 上游已查）· FS_USER/FS_PROJECT（DSH fs 服务读用户/项目标准根）
//       · DIRECT（插件只读直读同一批候选根——#296 决策：只读、仅技能标准根，绕开工作区作用域限制）。
// 纪律：轻探只读；直读仅在技能标准根使用，绝不写、绝不读其他路径；绿牌需名片合法（frontmatter name 匹配）。
export async function directSkillCardRead(absPath) {
  try {
    const mod = await import('node:fs/promises')
    const fsp = mod.default || mod
    return await fsp.readFile(absPath, 'utf8')
  } catch { return null }
}
// #296：直读存在性探测（只读；用于 .git 项目根识别的兜底——围栏环境 DSH fs 服务可能读不到祖目录）
export async function directPathExists(absPath) {
  try {
    const mod = await import('node:fs/promises')
    const fsp = mod.default || mod
    const st = await fsp.stat(absPath)
    return !!st
  } catch { return false }
}
export async function findProjectRootDir(cwd, platform, curFs) {
  if (!cwd || !platform || !platform.path || typeof platform.path.join !== 'function' || typeof platform.path.dirname !== 'function') return null
  try {
    let cur = String(cwd)
    while (true) {
      const gitPath = platform.path.join(cur, '.git')
      if (await probeFsExists(curFs, platform, gitPath)) return cur
      if (await directPathExists(gitPath)) return cur
      const parent = platform.path.dirname(cur)
      if (parent === cur) return null
      cur = parent
    }
  } catch { return null }
}
// fs 服务通道探卡：返回 { result: 'valid'|'invalid'|'missing'|'unavailable', detail? }
export async function probeCardViaFs(curFs, platform, cardPath, dirPath, skillName) {
  let cardTarget = null
  try {
    if (curFs && typeof curFs.resolve === 'function') cardTarget = await curFs.resolve(cardPath)
    else cardTarget = cardPath
  } catch { cardTarget = null }
  if (cardTarget && curFs && typeof curFs.readText === 'function') {
    try {
      const content = await curFs.readText(cardTarget)
      if (isSkillCardValid(content, skillName)) return { result: 'valid' }
      return { result: 'invalid', detail: 'frontmatter invalid' }
    } catch (e) {
      const cardExists = await probeFsExists(curFs, platform, cardPath)
      if (cardExists) return { result: 'invalid', detail: 'SKILL.md unreadable' }
      const dirExists = await probeFsExists(curFs, platform, dirPath)
      if (dirExists) return { result: 'invalid', detail: 'SKILL.md missing' }
      return { result: 'missing' }
    }
  }
  return { result: 'unavailable', detail: 'fs probe unavailable' }
}
// 直读通道探卡：只读、仅标准技能根；readFile 失败一律视为未找到（证据留给其他通道分类）
export async function probeCardViaDirect(cardPath, skillName) {
  try {
    const content = await directSkillCardRead(cardPath)
    if (content == null) return { result: 'missing' }
    if (isSkillCardValid(content, skillName)) return { result: 'valid' }
    return { result: 'invalid', detail: 'frontmatter invalid' }
  } catch { return { result: 'missing' } }
}
export function evidenceSummary(channels, lang) {
  if (!channels || !channels.length) return ''
  const stOf = function (c) { return c.result === 'valid' ? '命中' : (c.result === 'invalid' ? '无效' : (c.result === 'missing' ? '未找到' : String(c.result || '?'))) }
  // 按通道分组：同通道结果一致 → 合并成一条（如 fs=未找到×4）；不一致才逐条展开（人读优先，横幅不刷屏）
  const byChan = {}
  for (let i = 0; i < channels.length; i++) {
    const c = channels[i]
    const key = String(c.channel || '?')
    if (!byChan[key]) byChan[key] = []
    byChan[key].push(c)
  }
  const parts = []
  for (const key of Object.keys(byChan)) {
    const list = byChan[key]
    const label = (key === 'registry') ? 'registry' : key
    const uniq = []
    for (let i = 0; i < list.length; i++) { const s = stOf(list[i]); if (uniq.indexOf(s) < 0) uniq.push(s) }
    if (uniq.length === 1) {
      parts.push(label + '=' + uniq[0] + (list.length > 1 ? ('×' + list.length) : ''))
    } else {
      for (let i = 0; i < list.length; i++) parts.push(label + ':' + list[i].root + '=' + stOf(list[i]))
    }
  }
  return (lang === 'en') ? ('; probed: ' + parts.join(', ')) : ('；已查：' + parts.join('，'))
}
export async function lightProbeReason(skillName, lang, cwd, env) {
  const e = env || {}
  const curFs = (e && 'curFs' in e) ? e.curFs : null
  let platform = (e && e.platform) || null
  if (!platform && e && typeof e.getPlatform === 'function') { try { platform = await e.getPlatform() } catch {} }
  if (!platform) {
    return { kind: 'missing', detail: (lang === 'en') ? 'Not installed' : '未安装', hint: 'prompt:installSkills', channels: [{ channel: 'fs', root: 'user-agents', result: 'unavailable', detail: 'platform unavailable' }] }
  }
  let home = null
  try { home = await platform.getHome() } catch {}
  if (!home) {
    return { kind: 'missing', detail: (lang === 'en') ? 'Not installed' : '未安装', hint: 'prompt:installSkills', channels: [] }
  }
  // 候选根：用户标准根（.agents/skills 优先，.dsh/skills 次之）+ 项目根（.dsh/skills + .agents/skills）
  const candidates = [
    { label: 'user', root: 'user-agents', dir: platform.path.join(home, '.agents', 'skills', skillName) },
    { label: 'user', root: 'user-dsh', dir: platform.path.join(home, '.dsh', 'skills', skillName) },
  ]
  try {
    const projRoot = cwd ? await findProjectRootDir(cwd, platform) : null
    if (projRoot) {
      candidates.push({ label: 'project', root: 'project-dsh', dir: platform.path.join(projRoot, '.dsh', 'skills', skillName) })
      candidates.push({ label: 'project', root: 'project-agents', dir: platform.path.join(projRoot, '.agents', 'skills', skillName) })
    }
  } catch {}
  const channels = []
  let validHit = null
  let invalidSeen = false
  // ① fs 服务通道（DSH 沙箱 fs——现行构建读穿透；旧环境可能受工作区作用域限制，由 ② 顶替）
  for (let i = 0; i < candidates.length && !validHit; i++) {
    const cand = candidates[i]
    const cardPath = platform.path.join(cand.dir, 'SKILL.md')
    const r = await probeCardViaFs(curFs, platform, cardPath, cand.dir, skillName)
    channels.push({ channel: 'fs', root: cand.root, path: cardPath, result: r.result, detail: r.detail || '' })
    if (r.result === 'valid') validHit = { path: cardPath, dir: cand.dir, via: 'fs:' + cand.root }
    else if (r.result === 'invalid') invalidSeen = true
  }
  // ② 直读通道（插件只读直读——不经过 DSH fs 服务，绕开工作区作用域限制；仅技能标准根）
  if (!validHit) {
    for (let i = 0; i < candidates.length && !validHit; i++) {
      const cand = candidates[i]
      const cardPath = platform.path.join(cand.dir, 'SKILL.md')
      const r = await probeCardViaDirect(cardPath, skillName)
      channels.push({ channel: 'direct', root: cand.root, path: cardPath, result: r.result, detail: r.detail || '' })
      if (r.result === 'valid') validHit = { path: cardPath, dir: cand.dir, via: 'direct:' + cand.root }
      else if (r.result === 'invalid') invalidSeen = true
    }
  }
  if (validHit) {
    // 新契约：任一通道命中合法名片即已安装（附来源 + 注册表未收录的如实注记）
    return { kind: 'ok', detail: (lang === 'en') ? 'Installed' : '已安装', hint: '', sourcePath: validHit.path, via: validHit.via, registryMiss: true, channels }
  }
  if (invalidSeen) {
    return { kind: 'invalid', detail: (lang === 'en') ? 'Invalid skill card' : '名片无效', hint: 'prompt:installSkills', channels }
  }
  return { kind: 'missing', detail: (lang === 'en') ? 'Not installed (missing)' : '未安装（缺失）', hint: 'prompt:installSkills', channels }
}
