/**
 * src/host/skillProbe.ts —— 技能探测（来源：src/host/skillProbe.js，issue #1247 转写，本次只加类型标注与注释，逻辑一行未动）。
 *
 * 为什么要有它（一句话）：安装探测口径、短时记住、单飞与失效广播；只以注册表回答为准，轻探永不产生绿。
 *
 * 三条不能改的约定（改之前先看原 skillProbe.js 头注释与调用点 index.ts）：
 * 1. 行为零变化：逻辑逐行对应，只加类型标注与中文注释，不改任何运行时语义；相对导入保留 .js 后缀，由 scripts/ts-hook.mts 改指同名 .ts。
 * 2. 只写可剥离 TypeScript：不新增运行时语法（禁用 enum 与构造函数参数属性），类型一律 import type 或内联标注，转译后与原 .js 逐行同义。
 * 3. 不新增任何 import 边：只给已有引用加类型，不引入新模块依赖；Node 内建模块的类型缺席由文件内局部声明与 @ts-expect-error 承接，不装 @types/node。
 */

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

// src/host/skillProbe.js —— H3 #447 从 host/index.js 312-637 搬出，纯结构、行为零变化。
// 以后谁改它：改技能探测口径或通道的人。预估约340行，超 350 打回。
// 接线：由 index.js 动态 import 加载；ctx/getPlatform/getWorkspaceStore/resetChainCache 显式注入；本文件不引用其他新文件。
// #968 技能按需新增两个可选接线：resetChainCacheForKey（按工作区键只清一桶链快照，缺省回落全清）、
// skillCacheTtlMs（问到的结果记住多久，缺省 30 秒，与检测级联缓存同档）。
import { isSkillCardValid, probeFsExists, directSkillCardRead, directPathExists, findProjectRootDir, probeCardViaFs, probeCardViaDirect, evidenceSummary, lightProbeReason } from '../shared/skill-probe-channels.js'
// 短时缓存的缺省存活时间住中央 YAML（config/ttl.yaml 的 skillListCacheTtlMs 键）：
// 这里直接读中央常量，调时间改 YAML（缺表时 values.ts 已回落到同一个数 30000，行为与今天一致）。
// 路径走域构建产物写法，值由 tests/verify-time-config.ts 看守一致。
import { SKILL_LIST_CACHE_TTL_MS } from '../shared/time-config/src/values.js'
export function createSkillProbe(deps?: any): any {
  const { ctx, getPlatform, getWorkspaceStore, resetChainCache, resetChainCacheForKey, logCtx } = deps
    // 工作区与技能名只记短指纹，不记原始路径（日志白名单纪律，与仓里别处同一种取法）。
    function hash8(s?: any) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch { return '00000000' } }
    // #968 问到的结果短时记住多久（毫秒）。这里有一条不能改的约定：只记问到的（绿），问不到（红）
    // 与没问出来（等待）永远不记 —— 否则刚装好的技能会被一条旧的「没有」按在缓存里骗住，重查也看不见。
    // 接线 skillCacheTtlMs 仍可覆盖：调用方传了正数就听调用方的（语义不变）；没传时用中央常量的缺省值，
    // 值住 config/ttl.yaml 的 skillListCacheTtlMs 键，调时间改 YAML。
    const SKILL_CACHE_TTL_MS = (deps && typeof deps.skillCacheTtlMs === 'number' && deps.skillCacheTtlMs > 0) ? deps.skillCacheTtlMs : SKILL_LIST_CACHE_TTL_MS
    // #968 同一份回答最多在内存里留几条，超了丢最久没用的那条（键按写入顺序排）。
    const SKILL_CACHE_MAX = 200
    // #968 问到的结果按“工作区 + 语言 + 技能名”分桶记住：同一桶里短时不再重复问。
    const skillResultCache = new Map()
    // #968 同时在问的同一项共用同一份求值：键与上面同一把，值是还没落定的那一次查询。
    const skillProbeInflight = new Map()
    function skillCacheKeyOf(skillName?: any, lang?: any, cwd?: any) { return String(cwd || '') + '|' + String(lang || 'zh') + '|' + String(skillName || '') }
    function readSkillCache(key?: any) {
      try {
        const entry = skillResultCache.get(key)
        if (!entry) return null
        if ((Date.now() - entry.at) >= SKILL_CACHE_TTL_MS) { try { skillResultCache.delete(key) } catch {} return null }
        return entry.result || null
      } catch { return null }
    }
    function writeSkillCache(key?: any, result?: any) {
      try {
        if (!result || result.level !== 'ok') return
        if (skillResultCache.has(key)) skillResultCache.delete(key)
        skillResultCache.set(key, { result: result, at: Date.now() })
        while (skillResultCache.size > SKILL_CACHE_MAX) skillResultCache.delete(skillResultCache.keys().next().value)
      } catch {}
    }
    function clearSkillResultCache(scopeKey?: any) {
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
    function scopeKeyOf(scope?: any) {
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
    const skillPendingState: any = {}
    let _skillsInvalidateSub: any = null
    function getOrCreatePendingState(name?: any) {
      const k = String(name || '')
      if (!skillPendingState[k]) skillPendingState[k] = { attempts: 0, lastError: null }
      return skillPendingState[k]
    }
    function resetSkillPendingState(name?: any) {
      if (name) delete skillPendingState[String(name)]
      else for (const k in skillPendingState) delete skillPendingState[k]
    }
    // 失效广播的统一收口：探针计数 + 本文件的短时记住 + 检测级联缓存（workspaceStore）+ 链快照一并失效，
    // 保证事件到达后下一步 wf.chain/wf.detect（无需 force）即全量重判——否则 detect 的 store 快照会冻住旧 skillProbes。
    // #968 分桶清理：广播里带了工作区就只清那一桶（短时记住的那一桶、检测级联的那一桶、链快照里那个工作区开头的几条），
    // 不带工作区才沿旧路全清（与 #281 断链回归一致：广播后无 force 的下一次检查也必须看到新装的技能）。
    function invalidateSkillProbeCaches(scope?: any) {
      resetSkillPendingState()
      const scopeKey = scopeKeyOf(scope)
      clearSkillResultCache(scopeKey)
      // #284 修订（对抗式审查 2026-08-28）：链快照缓存一并失效——广播到达后【无 force】即全量重判（与 #281 断链回归一致）
      try {
        if (scopeKey && typeof resetChainCacheForKey === 'function') resetChainCacheForKey(scopeKey)
        else resetChainCache()
      } catch {}
      try {
        getWorkspaceStore().then(function(ws?: any) {
          try {
            if (scopeKey && ws && typeof ws.invalidate === 'function') ws.invalidate({ cwd: scopeKey })
            else if (ws && typeof ws.clear === 'function') ws.clear()
          } catch {}
        }).catch(function() {}) } catch {}
    }
    function ensureSkillsInvalidateSubscription() {
      if (_skillsInvalidateSub) return
      try {
        const skills = ctx.get('skills')
        if (!skills) return
        let off: any = null
        if (typeof skills.onDidInvalidate === 'function') {
          off = skills.onDidInvalidate((detail?: any) => { invalidateSkillProbeCaches(detail) })
          _skillsInvalidateSub = off
        } else if (typeof skills.on === 'function') {
          const handler = (detail?: any) => { invalidateSkillProbeCaches(detail) }
          try { skills.on('invalidate', handler); _skillsInvalidateSub = () => { try { skills.off && skills.off('invalidate', handler) } catch {} } } catch {}
          if (!_skillsInvalidateSub) {
            try { skills.on('didInvalidate', handler); _skillsInvalidateSub = () => { try { skills.off && skills.off('didInvalidate', handler) } catch {} } } catch {}
          }
        } else if (typeof skills.subscribe === 'function') {
          try { off = skills.subscribe((detail?: any) => { invalidateSkillProbeCaches(detail) }); _skillsInvalidateSub = off } catch {}
        }
        if (_skillsInvalidateSub) {
          try { ctx.effect(() => () => { try { if (typeof _skillsInvalidateSub === 'function') _skillsInvalidateSub(); } catch {} _skillsInvalidateSub = null }) } catch {}
        }
      } catch {}
    }
    // #968 人亲手点重查时带 force 上来：绕过短时记住，真实再问一次，刚装好的技能立即可见。
    async function probeSkill(skillName?: any, lang?: any, cwd?: any, opts?: any) {
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
        try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'dedup.hit', function() { return { scope: 'skill', keyHash: hash8(cacheKey) } }) } catch (eL) {}
        const shared = await ongoing
        emitSkillProbeLog(skillName, shared)
        return shared
      }
      // 先声明后赋值（原先是 const 就地初始化，闭包 finally 里引用自身在 strict 下报「先用后赋」；
      // 拆成两句后仍只赋值一次、从不改写，finally 读到时赋值早已完成，运行时序与原来一致）。
      let pending: any
      pending = (async function() {
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
    function emitSkillProbeLog(skillName?: any, res?: any) {
      try {
        if (logCtx) {
          const via = String((res && res.via) || ((res && res.level === 'ok') ? 'registry' : ((res && (res.pending || res.level === 'pending')) ? 'registry' : 'multi')))
          logCtx.fire('info', 'skill.probe', { name: String(skillName || ''), level: String((res && res.level) || 'bad'), via: via })
          try { const st = getOrCreatePendingState(skillName); if (res && res.level === 'bad' && st && st.attempts > SKILL_PENDING_MAX) logCtx.fire('warn', 'skill.pending.cap', { name: String(skillName || ''), attempts: st.attempts, max: SKILL_PENDING_MAX }) } catch (eC) {}
        }
      } catch (eL) {}
    }
    function safeHostFs() { try { return ctx.get('fs') } catch { return null } }
    async function probeSkillInner(skillName?: any, lang?: any, cwd?: any) {
      try { ensureSkillsInvalidateSubscription() } catch {}
      const skills = ctx.get('skills')
      let found: any = null
      let foundPath: any = null
      let skillsError: any = null
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
          skillsError = String((e && (e as any).message) || e || 'skills.get failed')
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
      const hostFs = safeHostFs()
      const reason = await lightProbeReason(skillName, lang, cwd, { curFs: hostFs, getPlatform: getPlatform })
      try { resetSkillPendingState(skillName) } catch {}
      // 通道行只加类型不改形状（共享 skill-probe-channels.ts 转写后 channels 元素的 detail 可缺席，
      // 字面量直接 concat 会报类型不合；标成 any 后拼接语义与原来一致）。
      // 首行先标成 any 再拼（直接在字面量上 concat 会按字面量元素收窄去卡共享侧放宽后的类型；分两句后拼接语义不变）。
      const head: any = [{ channel: 'registry', root: 'registry', result: 'miss', detail: '' }]
      const allCh: any = head.concat(reason.channels || [])
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
