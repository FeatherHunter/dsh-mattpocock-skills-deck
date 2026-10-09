// src/host/skillProbe.js —— H3 #447 从 host/index.js 312-637 搬出，纯结构、行为零变化。
// 以后谁改它：改技能探测口径或通道的人。预估约340行，超 350 打回。
// 接线：由 index.js 动态 import 加载；ctx/getPlatform/getWorkspaceStore/resetChainCache 显式注入；本文件不引用其他新文件。
// #968 技能按需新增两个可选接线：resetChainCacheForKey（按工作区键只清一桶链快照，缺省回落全清）、
// skillCacheTtlMs（问到的结果记住多久，缺省 30 秒，与检测级联缓存同档）。
export function createSkillProbe(deps) {
  const { ctx, getPlatform, getWorkspaceStore, resetChainCache, resetChainCacheForKey, logCtx } = deps
    // 工作区与技能名只记短指纹，不记原始路径（日志白名单纪律，与仓里别处同一种取法）。
    function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch { return '00000000' } }
    // #968 问到的结果短时记住多久（毫秒）。问不到（红）与没问出来（等待）永远不记，只记问到的（绿）。
    const SKILL_CACHE_TTL_MS = (deps && typeof deps.skillCacheTtlMs === 'number' && deps.skillCacheTtlMs > 0) ? deps.skillCacheTtlMs : 30000
    // #968 同一份回答最多在内存里留几条，超了丢最久没用的那条（键按写入顺序排）。
    const SKILL_CACHE_MAX = 200
    // #968 问到的结果按“工作区 + 语言 + 技能名”分桶记住：同一桶里短时不再重复问。
    const skillResultCache = new Map()
    // #968 同时在问的同一项共用同一份求值：键与上面同一把，值是还没落定的那一次查询。
    const skillProbeInflight = new Map()
    function skillCacheKeyOf(skillName, lang, cwd) { return String(cwd || '') + '|' + String(lang || 'zh') + '|' + String(skillName || '') }
    function readSkillCache(key) {
      try {
        const entry = skillResultCache.get(key)
        if (!entry) return null
        if ((Date.now() - entry.at) >= SKILL_CACHE_TTL_MS) { try { skillResultCache.delete(key) } catch {} return null }
        return entry.result || null
      } catch { return null }
    }
    function writeSkillCache(key, result) {
      try {
        if (!result || result.level !== 'ok') return
        if (skillResultCache.has(key)) skillResultCache.delete(key)
        skillResultCache.set(key, { result: result, at: Date.now() })
        while (skillResultCache.size > SKILL_CACHE_MAX) skillResultCache.delete(skillResultCache.keys().next().value)
      } catch {}
    }
    function clearSkillResultCache(scopeKey) {
      try {
        if (scopeKey) {
          const prefix = String(scopeKey) + '|'
          for (const k of Array.from(skillResultCache.keys())) { if (k === scopeKey || k.indexOf(prefix) === 0) skillResultCache.delete(k) }
          return
        }
        skillResultCache.clear()
      } catch {}
    }
    // #968 广播里带来的范围没有固定形状：字符串就是工作区本身，对象里按常见名字找工作区，都没有就是整机。
    function scopeKeyOf(scope) {
      try {
        if (typeof scope === 'string') { const t = scope.trim(); return t ? t : null }
        if (scope && typeof scope === 'object') {
          const cand = scope.cwd || scope.workspaceKey || scope.workspaceRoot || scope.key
          if (typeof cand === 'string' && cand.trim()) return cand.trim()
        }
        return null
      } catch { return null }
    }
    // 检查 7/8 · 技能安装探测（#373 拍板：两态 —— 已安装/未安装；去掉不可靠的「挂载」判定：
    //   宿主级 skills 服务与「当前会话挂载」不是同一上下文，服务不可用时会误报「未挂载」）
    const SKILL_INSTALL_URL = 'https://github.com/mattpocock/skills'
    // v1.6：技能安装引导 prompt 已收编进 client PROMPTS 注册表（installSkills 条目）；hint 用 prompt: 键名协议（prompt:installSkills）由 client 取双语文本
    // 判装唯一尺度（#280）：只以 DSH 注册表回答为准 — 一行查询即定绿/红，B 语义（别处同名有效副本亦算已安装）
    // 绝不触盘：辅助文件轻探永不产生绿色（该纪律见 #281）
    // #281 红牌分拣与等待合同（第三、五条推论）：
    //   - 绿：注册表命中即绿；若非标准根，附来源路径一行（B 语义可视化）
    //   - 红：注册表未命中时，轻探目标根区分「缺失」与「名片无效」；轻探永不产生绿
    //   - 等待：skills 服务不可用时显式 pending，订阅失效广播后有界推进，封顶转失败并附原文
    const SKILL_PENDING_MAX = 3
    const SKILL_PENDING_HINT_PREFIX = 'pending:skills-unavailable'
    const skillPendingState = {}
    let _skillsInvalidateSub = null
    function getOrCreatePendingState(name) {
      const k = String(name || '')
      if (!skillPendingState[k]) skillPendingState[k] = { attempts: 0, lastError: null }
      return skillPendingState[k]
    }
    function resetSkillPendingState(name) {
      if (name) delete skillPendingState[String(name)]
      else for (const k in skillPendingState) delete skillPendingState[k]
    }
    // 失效广播的统一收口：探针计数 + 本文件的短时记住 + 检测级联缓存（workspaceStore）+ 链快照一并失效，
    // 保证事件到达后下一步 wf.chain/wf.detect（无需 force）即全量重判——否则 detect 的 store 快照会冻住旧 skillProbes。
    // #968 分桶清理：广播里带了工作区就只清那一桶（短时记住的那一桶、检测级联的那一桶、链快照里那个工作区开头的几条），
    // 不带工作区才沿旧路全清（与 #281 断链回归一致：广播后无 force 的下一次检查也必须看到新装的技能）。
    function invalidateSkillProbeCaches(scope) {
      resetSkillPendingState()
      const scopeKey = scopeKeyOf(scope)
      clearSkillResultCache(scopeKey)
      // #284 修订（对抗式审查 2026-08-28）：链快照缓存一并失效——广播到达后【无 force】即全量重判（与 #281 断链回归一致）
      try {
        if (scopeKey && typeof resetChainCacheForKey === 'function') resetChainCacheForKey(scopeKey)
        else resetChainCache()
      } catch {}
      try {
        getWorkspaceStore().then(function (ws) {
          try {
            if (scopeKey && ws && typeof ws.invalidate === 'function') ws.invalidate({ cwd: scopeKey })
            else if (ws && typeof ws.clear === 'function') ws.clear()
          } catch {}
        }).catch(function () {}) } catch {}
    }
    function ensureSkillsInvalidateSubscription() {
      if (_skillsInvalidateSub) return
      try {
        const skills = ctx.get('skills')
        if (!skills) return
        let off = null
        if (typeof skills.onDidInvalidate === 'function') {
          off = skills.onDidInvalidate((detail) => { invalidateSkillProbeCaches(detail) })
          _skillsInvalidateSub = off
        } else if (typeof skills.on === 'function') {
          const handler = (detail) => { invalidateSkillProbeCaches(detail) }
          try { skills.on('invalidate', handler); _skillsInvalidateSub = () => { try { skills.off && skills.off('invalidate', handler) } catch {} } } catch {}
          if (!_skillsInvalidateSub) {
            try { skills.on('didInvalidate', handler); _skillsInvalidateSub = () => { try { skills.off && skills.off('didInvalidate', handler) } catch {} } } catch {}
          }
        } else if (typeof skills.subscribe === 'function') {
          try { off = skills.subscribe((detail) => { invalidateSkillProbeCaches(detail) }); _skillsInvalidateSub = off } catch {}
        }
        if (_skillsInvalidateSub) {
          try { ctx.effect(() => () => { try { if (typeof _skillsInvalidateSub === 'function') _skillsInvalidateSub(); } catch {} _skillsInvalidateSub = null }) } catch {}
        }
      } catch {}
    }
    function isSkillCardValid(skillText, expectedName) {
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
    async function probeFsExists(curFs, platform, pathStr) {
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
    async function directSkillCardRead(absPath) {
      try {
        const mod = await import('node:fs/promises')
        const fsp = mod.default || mod
        return await fsp.readFile(absPath, 'utf8')
      } catch { return null }
    }
    // #296：直读存在性探测（只读；用于 .git 项目根识别的兜底——围栏环境 DSH fs 服务可能读不到祖目录）
    async function directPathExists(absPath) {
      try {
        const mod = await import('node:fs/promises')
        const fsp = mod.default || mod
        const st = await fsp.stat(absPath)
        return !!st
      } catch { return false }
    }
    async function findProjectRootDir(cwd, platform) {
      if (!cwd || !platform || !platform.path || typeof platform.path.join !== 'function' || typeof platform.path.dirname !== 'function') return null
      try {
        let cur = String(cwd)
        const curFs = ctx.get('fs')
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
    async function probeCardViaFs(curFs, platform, cardPath, dirPath, skillName) {
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
    async function probeCardViaDirect(cardPath, skillName) {
      try {
        const content = await directSkillCardRead(cardPath)
        if (content == null) return { result: 'missing' }
        if (isSkillCardValid(content, skillName)) return { result: 'valid' }
        return { result: 'invalid', detail: 'frontmatter invalid' }
      } catch { return { result: 'missing' } }
    }
    function evidenceSummary(channels, lang) {
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
    async function lightProbeReason(skillName, lang, cwd) {
      const curFs = ctx.get('fs')
      let platform = null
      try { platform = await getPlatform() } catch {}
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
    // #968 人亲手点重查时带 force 上来：绕过短时记住，真实再问一次，刚装好的技能立即可见。
    async function probeSkill(skillName, lang, cwd, opts) {
      const force = !!(opts && opts.force)
      const cacheKey = skillCacheKeyOf(skillName, lang, cwd)
      // #968 先看短时记住里有没有问到的结果：有就直接用，不再问注册表与磁盘。
      // 记住的只有绿牌（问到的），红牌与等待从不记，所以这里拿到的必是绿牌。
      if (!force) {
        const remembered = readSkillCache(cacheKey)
        if (remembered) {
          // 命中记一行已有的技能探测日志，通道记“缓存”（不新增事件名，字段仍是白名单三键）。
          const hit = Object.assign({}, remembered, { via: 'cache' })
          emitSkillProbeLog(skillName, hit)
          return hit
        }
      }
      // #968 同一桶的同一个问题正在问：后来的人不等新开一份，直接拿那一份（防惊群）。
      // 重查也搭这趟车：在飞的那一次本就是刚问的新鲜结果，搭上它比另起一趟更省。
      const ongoing = skillProbeInflight.get(cacheKey)
      if (ongoing) {
        // 复用记一行已有的复用日志（按需级别，调试开关关着时连字段都不组装）。
        try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'dedup.hit', function () { return { scope: 'skill', keyHash: hash8(cacheKey) } }) } catch (eL) {}
        const shared = await ongoing
        emitSkillProbeLog(skillName, shared)
        return shared
      }
      const pending = (async function () {
        try {
          const fresh = await probeSkillInner(skillName, lang, cwd)
          writeSkillCache(cacheKey, fresh)
          return fresh
        } finally {
          try { if (skillProbeInflight.get(cacheKey) === pending) skillProbeInflight.delete(cacheKey) } catch {}
        }
      })()
      try { skillProbeInflight.set(cacheKey, pending) } catch {}
      const res = await pending
      emitSkillProbeLog(skillName, res)
      return res
    }
    // #968 技能探测的常驻日志收口：三条路（首问、命中、搭车）都走这里，行数与字段与原来一致。
    function emitSkillProbeLog(skillName, res) {
      try {
        if (logCtx) {
          const via = String((res && res.via) || ((res && res.level === 'ok') ? 'registry' : ((res && (res.pending || res.level === 'pending')) ? 'registry' : 'multi')))
          logCtx.fire('info', 'skill.probe', { name: String(skillName || ''), level: String((res && res.level) || 'bad'), via: via })
          try { const st = getOrCreatePendingState(skillName); if (res && res.level === 'bad' && st && st.attempts > SKILL_PENDING_MAX) logCtx.fire('warn', 'skill.pending.cap', { name: String(skillName || ''), attempts: st.attempts, max: SKILL_PENDING_MAX }) } catch (eC) {}
        }
      } catch (eL) {}
    }
    async function probeSkillInner(skillName, lang, cwd) {
      try { ensureSkillsInvalidateSubscription() } catch {}
      const skills = ctx.get('skills')
      let found = null
      let foundPath = null
      let skillsError = null
      if (skills !== undefined && skills !== null) {
        try {
          const res = await skills.get(skillName, cwd ? { cwd } : undefined)
          if (res) {
            found = res
            if (typeof res === 'object') {
              foundPath = res.path || res.dir || res.location || res.file || res.uri || res.source || null
              if (!foundPath && res.metadata && typeof res.metadata === 'object') foundPath = res.metadata.path || null
            } else if (typeof res === 'string') {
              foundPath = res
            }
          }
        } catch (e) {
          skillsError = String((e && e.message) || e || 'skills.get failed')
        }
      } else {
        skillsError = 'skills service unavailable'
      }
      if (found) {
        let detail = (lang === 'en') ? 'Installed' : '已安装'
        let hint = ''
        let isOffRoot = false
        if (foundPath) {
          try {
            const plat = await getPlatform()
            const home = await plat.getHome()
            if (home) {
              const standard = plat.path.join(home, '.agents', 'skills', skillName)
              const normFoundRaw = String(foundPath)
              const normStd = plat.path.normalize(String(standard))
              const normFound = plat.path.normalize(normFoundRaw)
              let cmpFound = normFound
              let cmpStd = normStd
              if (plat.os === 'win32') { cmpFound = cmpFound.toLowerCase(); cmpStd = cmpStd.toLowerCase() }
              let foundDir = cmpFound
              try {
                if (foundDir.toLowerCase().endsWith('skill.md')) foundDir = plat.path.dirname(foundDir)
                if (foundDir.length > 1 && (foundDir.endsWith('/') || foundDir.endsWith('\\'))) foundDir = foundDir.slice(0, -1)
              } catch {}
              let stdDir = cmpStd
              try { if (stdDir.length > 1 && (stdDir.endsWith('/') || stdDir.endsWith('\\'))) stdDir = stdDir.slice(0, -1) } catch {}
              isOffRoot = foundDir !== stdDir
            } else {
              isOffRoot = true
            }
          } catch { isOffRoot = false }
        }
        if (isOffRoot && foundPath) {
          const srcLine = (lang === 'en') ? ' (source: ' + foundPath + ')' : '（来源：' + foundPath + '）'
          detail = detail + srcLine
        }
        try { resetSkillPendingState(skillName) } catch {}
        return { ok: true, level: 'ok', detail, hint, sourcePath: foundPath || undefined, repo: null, channels: [{ channel: 'registry', root: 'registry', result: 'hit', detail: foundPath || '' }] }
      }
      if (skillsError) {
        const st = getOrCreatePendingState(skillName)
        st.attempts += 1
        st.lastError = skillsError
        if (st.attempts <= SKILL_PENDING_MAX) {
          return { ok: false, level: 'pending', detail: (lang === 'en') ? 'Waiting for skills service... (' + st.attempts + '/' + SKILL_PENDING_MAX + ')' : '等待技能服务就绪…（' + st.attempts + '/' + SKILL_PENDING_MAX + '）', hint: SKILL_PENDING_HINT_PREFIX + ':' + st.attempts, repo: null, pending: true, attempts: st.attempts, maxAttempts: SKILL_PENDING_MAX, error: skillsError }
        } else {
          return { ok: false, level: 'bad', detail: (lang === 'en') ? 'Skills service unavailable: ' + skillsError : '技能服务不可用：' + skillsError, hint: 'prompt:installSkills', repo: null, error: skillsError }
        }
      }
      const reason = await lightProbeReason(skillName, lang, cwd)
      try { resetSkillPendingState(skillName) } catch {}
      const allCh = [{ channel: 'registry', root: 'registry', result: 'miss', detail: '' }].concat(reason.channels || [])
      const ev = evidenceSummary(allCh, lang)
      if (reason.kind === 'ok') {
        // #296 新契约：注册表未收录但任一通道命中合法名片 → 按盘上事实判已安装（附来源与如实注记）
        const srcLine = reason.sourcePath ? ((lang === 'en') ? ' (source: ' + reason.sourcePath + ')' : '（来源：' + reason.sourcePath + '）') : ''
        const regNote = (lang === 'en') ? ' (DSH catalog miss; judged by disk facts)' : '（DSH 技能清单未收录，按盘上事实判定）'
        return { ok: true, level: 'ok', detail: reason.detail + srcLine + regNote, hint: '', sourcePath: reason.sourcePath || undefined, repo: null, via: reason.via, channels: allCh }
      }
      if (reason.kind === 'invalid') {
        return { ok: false, level: 'bad', detail: reason.detail + ev, hint: reason.hint, repo: null, reason: 'invalid', channels: allCh }
      }
      return { ok: false, level: 'bad', detail: reason.detail + ev, hint: reason.hint, repo: null, reason: 'missing', channels: allCh }
    }
    // #968 失效广播收口对外可调用：带工作区只清那一桶，不带才全清（调用方把广播里带来的范围原样传进来即可）。
    return { probeSkill, lightProbeReason, probeFsExists, directSkillCardRead, directPathExists, findProjectRootDir, probeCardViaFs, probeCardViaDirect, evidenceSummary, isSkillCardValid, invalidateSkillProbeCaches }
}
