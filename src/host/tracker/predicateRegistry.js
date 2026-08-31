/**
 * tracker/predicateRegistry.js — 宿主谓词注册表（异步 resolve → 纯函数输入）。
 *
 * 生效日期：2026-08-28
 * 效力规则：本文件以 #226 规约为基线；与更早方案冲突以本规约为准；未来任何定版方案若改动本规约，以未来版本为准（见 CONTEXT.md「版本与效力」）。
 *
 * 第一性原理（#217 定版，2026-08-28 修订 #219/#245/#226 删 na，通用谓词原语）：
 *  - 契约层 evaluateChain 为纯函数（喂状态 → 出步骤快照），无 IO；宿主负责把真实世界 resolve 成 Record<id, 'pass'|'fail'|null>（2026-08-27 起无 na）。
 *  - 谓词执行只在宿主（Node）侧，经平台抽象层（platform）访问 OS，不在契约层/ UI 层执行；全部只读探测，失败返回而非抛（#226 验收）。
 *  - 三层 check kind 分发：primitive（通用原语 fs/exec/gh/技能探测）/ backend（后端专属）/ preflight（复用既有门禁）。
 *  - 宿主可知的原语（fs/exec/gh/技能探测）供检查项 check 引用，全部只读探测；注册表验形状不验内容（与 tracker registry 哲学一致，#226）。
 *  - 超时按 pending 处理（不抛、不阻塞整链），诚实透传 detail；谓词只读，永不写文件/环境。
 *  - 2026-08-29 修订（可写性判据）：唯一例外 = DIR_WRITABLE 原语，向被检目录写 2 字节临时探针并清理——
 *    跨 OS 唯一可靠的「可写」判据（Windows 无 POSIX 权限位）；fs 无 writeText 时回退存在性并如实注明。
 *
 * 版本：2026-08-28 与 src/shared/tracker/chain.js + check-catalog.js 同步，删 na，通用原语注册表。
 */

import { PRIMITIVE_KIND } from '../../shared/tracker/chain.js'

/**
 * @typedef {Object} PredicateResult
 * @property {'pass'|'fail'|'pending'} status
 * @property {string} [detail] 人读细节（日志用）
 * @property {string} [hint] 引导文案透传（与 Show.hint 同源，供链快照复用）
 */

/**
 * @typedef {Object} PredicateContext
 * @property {import('../platform/index.js').Platform} platform 平台抽象实例
 * @property {import('../../shared/tracker/shape.js').BackendId|null} backendId 当前后端（通用探测时 null）
 * @property {string} cwd 工作区路径
 * @property {AbortSignal} [signal]
 * @property {Record<string,unknown>} [extras] 额外上下文（如 repoRef）
 */

/**
 * @typedef {(check: import('../../shared/tracker/chain.js').Check, ctx: PredicateContext) => Promise<PredicateResult>} PredicateFn
 */

function makeResult(status, detail, hint) {
  const r = { status }
  if (detail) r.detail = String(detail).slice(0, 600)
  if (hint) r.hint = String(hint).slice(0, 2000)
  return r
}

/** 2026-08-29（审查 S1）：谓词 detail 双语——detail 会经 enrichSnap 直出到 UI 行内描述，
 *  中文界面不得出现英文黑话行。按 ctx.lang（wf.chain 注入）取词；lang 缺省 zh（面板主语言）。 */
function detailFor(ctx, zhText, enText) {
  return (ctx && ctx.lang === 'en') ? enText : zhText
}

/** 通用原语执行器（primitive）。 */
async function execPrimitive(check, ctx) {
  const p = ctx && ctx.platform ? ctx.platform : null
  const kind = check && check.primitive
  try {
    if (kind === PRIMITIVE_KIND.COMMAND_EXISTS) {
      const cmd = check.command
      if (!p || typeof p.resolveExecutable !== 'function') return makeResult('pending', detailFor(ctx, '系统找不到命令的能力不可用', 'platform.resolveExecutable unavailable'))
      const hit = await p.resolveExecutable(cmd)
      return hit
        ? makeResult('pass', detailFor(ctx, '已找到 ' + cmd + '：' + hit, cmd + ' found: ' + hit))
        : makeResult('fail', detailFor(ctx, '未找到命令 ' + cmd + '（可能还没安装）', cmd + ' not found in PATH'))
    }
    if (kind === PRIMITIVE_KIND.FILE_EXISTS) {
      const rel = check.path
      if (!p || !p.fs || typeof p.fs.resolve !== 'function') return makeResult('pending', 'platform.fs unavailable')
      // 优先用 platform.fs.resolve + readText 探测；不存在即 fail
      try {
        const abs0 = await p.fs.resolve(rel, { cwd: ctx.cwd })
        // #284：resolve 可能返回 target-shaped 对象（真实 DSH fs 契约）——取 path 再交给探测分支
        const abs = (abs0 && typeof abs0 === 'object' && abs0 !== null && typeof abs0.path === 'string') ? abs0.path : abs0
        // 尝试 stat 式探测（若平台提供 exists/readText）
        if (typeof p.fs.exists === 'function') {
          const ok = await p.fs.exists(abs)
          if (ok) return makeResult('pass', detailFor(ctx, rel + ' 已存在', rel + ' exists'))
          // #284 修复（2026-08-28）：目录型检查（如 md:.scratch）——DSH fs.exists 可能只对文件为真，
          //   目录用 listDir/stat/lstat 兜底判定存在（.scratch 明明是目录却报 not found）。
          if (typeof p.fs.listDir === 'function') { try { await p.fs.listDir(abs); return makeResult('pass', detailFor(ctx, rel + ' 已存在（目录）', rel + ' exists (dir)')) } catch (eD) {} }
          if (typeof p.fs.stat === 'function') { try { const st = await p.fs.stat(abs); if (st) return makeResult('pass', detailFor(ctx, rel + ' 已存在', rel + ' exists')) } catch (eS) {} }
          if (typeof p.fs.lstat === 'function') { try { const info = await p.fs.lstat(abs); if (info) return makeResult('pass', detailFor(ctx, rel + ' 已存在', rel + ' exists')) } catch (eL) {} }
          // #344 加固（2026-08-31）：平台侧未探测到但文件可能已在盘上（DSH fs 沙箱滞后或围栏），直读兜底
          try{
            const directOk = await (async function(){
              try{
                const pathJoin = (p && p.path && typeof p.path.join === 'function') ? p.path.join : function(a,b){ return (String(a||'').replace(/[\\/]+$/, '') + '/' + String(b||'').replace(/^[\\/]+/, '')) }
                const absDirect = pathJoin(String(ctx.cwd||''), String(rel||''))
                const mod = await import('node:fs/promises')
                const fsp = mod.default || mod
                await fsp.stat(absDirect)
                return true
              }catch(eDirect){ return false }
            })()
            if(directOk) return makeResult('pass', detailFor(ctx, rel + ' 已存在', rel + ' exists'))
          }catch(eDirect2){}
          return makeResult('fail', detailFor(ctx, rel + ' 不存在', rel + ' not found'))
        }
        if (typeof p.fs.readText === 'function') {
          try { await p.fs.readText(abs); return makeResult('pass', detailFor(ctx, rel + ' 已存在', rel + ' exists')) } catch {
            // #344 加固：readText 未命中时同样尝试直读兜底
            try{
              const pathJoin2 = (p && p.path && typeof p.path.join === 'function') ? p.path.join : function(a,b){ return (String(a||'').replace(/[\\/]+$/, '') + '/' + String(b||'').replace(/^[\\/]+/, '')) }
              const absDirect2 = pathJoin2(String(ctx.cwd||''), String(rel||''))
              const mod2 = await import('node:fs/promises')
              const fsp2 = mod2.default || mod2
              await fsp2.stat(absDirect2)
              return makeResult('pass', detailFor(ctx, rel + ' 已存在', rel + ' exists'))
            }catch(eDirect3){}
            return makeResult('fail', detailFor(ctx, rel + ' 不存在', rel + ' not found'))
          }
        }
        // 无探测能力 → pending（诚实，不猜）
        return makeResult('pending', detailFor(ctx, '文件探测能力不可用', 'fs probe unavailable'))
      } catch (e) {
        return makeResult('fail', String((e && e.message) || e))
      }
    }
    if (kind === PRIMITIVE_KIND.DIR_WRITABLE) {
      // dirWritable：目录「存在且可写」——写探测（往目录写固定名临时探针，写完尽力清理）。
      //   为什么不用 stat/lstat 权限位：Windows 无 POSIX mode 位、ACL 不可靠，唯一跨三端一致的判据是真实写入。
      //   谓词只读纪律的唯一例外（2026-08-29）：本探测向被检目录写 2 字节探针并删除，属验证性写、无业务副作用。
      //   2026-08-29 实机修复（用户反馈 "The "path" argument must be of type string. Received an instance of Object"）：
      //     fs.resolve 返回的是 target 对象（形状随宿主，无 .path 字符串），原实现把它喂进 path.join 必抛 TypeError。
      //     修正：绝不对 resolve 输出做字符串操作；所有 fs 调用配对 resolve → 方法；字符串拼接只发生在 rel/cwd 上。
      //   fs 无 writeText 能力（异常宿主）→ 回退存在性判定并如实注明（链仍能完成，不卡 pending）。
      const rel = check.path
      const zh = !!(ctx && ctx.lang === 'zh')
      if (!p || !p.fs || typeof p.fs.resolve !== 'function') return makeResult('pending', 'platform.fs unavailable')
      const probeRel = (typeof p.path.join === 'function') ? p.path.join(rel, '.dsh-write-probe') : (rel + '/.dsh-write-probe')
      try {
        // 1) 目录存在性尽力判定。判据（与 FILE_EXISTS 同哲学）：
        //    - 有探测能力（exists/listDir/stat 任一）且全数未证明存在 → 视为不存在（诚实 fail）；
        //    - 无任何探测能力（异常宿主/mock）→ 不臆断（dirExists=null），交写探测作最终判据；
        //    - 目录型真相（#284：DSH fs.exists 可能只对文件为真）由 exists→listDir→stat 链兜底。
        let dirExists = null
        let probeCaps = 0
        try {
          const dirT = await p.fs.resolve(rel, { cwd: ctx.cwd })
          if (typeof p.fs.exists === 'function') {
            probeCaps++
            try { if ((await p.fs.exists(dirT)) === true) dirExists = true } catch (eE) {}
          }
          if (dirExists !== true && typeof p.fs.listDir === 'function') {
            probeCaps++
            try { await p.fs.listDir(dirT); dirExists = true } catch (eD) {}
          }
          if (dirExists !== true && typeof p.fs.stat === 'function') {
            probeCaps++
            try { const st = await p.fs.stat(dirT); if (st) dirExists = true } catch (eS) {}
          }
          if (dirExists !== true && probeCaps > 0) dirExists = false
        } catch (eR) {
          dirExists = false
        }
        if (dirExists === false) return makeResult('fail', zh ? '目录不存在' : rel + ' not found')
        // 2) 写探测（resolve(探针相对路径) → writeText；清理同理用该 target）
        if (typeof p.fs.writeText === 'function') {
          try {
            const probeT = await p.fs.resolve(probeRel, { cwd: ctx.cwd })
            await p.fs.writeText(probeT, 'ok')
            const cleaners = ['unlink', 'remove', 'rm', 'delete']
            for (const m of cleaners) {
              if (typeof p.fs[m] === 'function') {
                try { await p.fs[m](probeT); break } catch (eC) {}
              }
            }
            return makeResult('pass', zh ? '目录可读写' : rel + ' exists & writable')
          } catch (e) {
            return makeResult('fail', (zh ? '目录不可写：' : 'not writable: ') + String((e && e.message) || e).slice(0, 200))
          }
        }
        // 3) 无写探测能力 → 回退存在性（详情如实注明未验证可写；链可完成）
        if (dirExists === true) {
          return makeResult('pass', zh ? '目录存在（fs 无写探测能力，未验证可写）' : rel + ' exists (writable not verified: fs has no writeText)')
        }
        if (typeof p.fs.readText === 'function') {
          try {
            const t0 = await p.fs.resolve(rel, { cwd: ctx.cwd })
            await p.fs.readText(t0)
            return makeResult('pass', zh ? '目录存在（fs 无写探测能力，未验证可写）' : rel + ' exists (writable not verified: fs has no writeText)')
          } catch { return makeResult('fail', zh ? '目录不存在' : rel + ' not found') }
        }
        return makeResult('pending', 'fs probe unavailable')
      } catch (e) {
        return makeResult('fail', String((e && e.message) || e).slice(0, 200))
      }
    }
    if (kind === PRIMITIVE_KIND.HOME_DIR) {
      // /homeDir（2026-08-28 修复）：主目录判装只问平台层——win32 不读 HOME（os.homedir→USERPROFILE），linux/mac 走 os.homedir；
      //   原 ENV(HOME) 在 Windows 必然误报「HOME not set」，主目录明明可解析却判 fail。
      //   平台层不可用 → 诚实 pending（不猜）；解析失败 → fail（环境级异常：daemon/容器/服务账户无用户上下文）。
      if (!p || typeof p.getHome !== 'function') return makeResult('pending', detailFor(ctx, '平台主目录能力不可用', 'platform.getHome unavailable'))
      try {
        const h = await p.getHome()
        return h ? makeResult('pass', h) : makeResult('fail', detailFor(ctx, '用户主目录无法解析（系统级环境异常）', 'user home not resolved'))
      } catch (e) { return makeResult('pending', String((e && e.message) || e)) }
    }
    if (kind === PRIMITIVE_KIND.ENV) {
      const key = check.key
      const env = p && p.env ? p.env : null
      const val = env && typeof env.get === 'function' ? env.get(key) : (typeof process !== 'undefined' ? process.env[key] : undefined)
      return val ? makeResult('pass', key + '=set') : makeResult('fail', detailFor(ctx, key + ' 未设置', key + ' not set'))
    }
    if (kind === PRIMITIVE_KIND.SKILL_PROBE) {
      const skill = check.skill
      // #284：优先走 host 注入的判装原语（ctx.skillProbe = DSH 注册表查询 + 红牌分拣 + 等待契约）；
      //   仅未注入时回退标准根 fs 探测（#280 单一尺度：仅标准根 .agents/skills；#281 轻探永不绿的纪律由 host probeSkill 承载）
      if (ctx && typeof ctx.skillProbe === 'function') {
        try {
          const r = await ctx.skillProbe(skill)
          if (r && typeof r === 'object') {
            if (r.level === 'ok') return makeResult('pass', r.detail || (skill + ' ok'), r.hint)
            if (r.level === 'pending') return makeResult('pending', r.detail || ('waiting'), r.hint)
            return makeResult('fail', r.detail || (skill + ' not ok'), r.hint)
          }
          if (r && r.status) return r
        } catch (e) { return makeResult('pending', 'skillProbe error: ' + String((e && e.message) || e)) }
      }
      if (!p || typeof p.getHome !== 'function' || !p.fs) return makeResult('pending', detailFor(ctx, '平台能力不可用，无法探测技能', 'platform unavailable for skillProbe'))
      try {
        const home = await p.getHome()
        const candidates = [
          home ? (p.path.join(home, '.agents', 'skills', skill)) : null,
        ].filter(Boolean)
        for (const cand of candidates) {
          try {
            if (typeof p.fs.exists === 'function') {
              if (await p.fs.exists(cand)) return makeResult('pass', detailFor(ctx, skill + ' 已找到：' + cand, skill + ' found at ' + cand))
            } else if (typeof p.fs.readText === 'function') {
              try { await p.fs.readText(p.path.join(cand, 'SKILL.md')); return makeResult('pass', detailFor(ctx, skill + ' 已找到', skill + ' found')) } catch {}
            }
          } catch {}
        }
        return makeResult('fail', detailFor(ctx, skill + ' 未找到', skill + ' not found'))
      } catch (e) {
        return makeResult('pending', String((e && e.message) || e))
      }
    }
    return makeResult('pending', 'unknown primitive: ' + kind)
  } catch (e) {
    return makeResult('pending', String((e && e.message) || e))
  }
}

/**
 * 创建谓词注册表。
 * @param {Object} [opts]
 * @param {number} [opts.timeout] 单个谓词超时（ms，默认 3000）
 * @returns {{register: (key:string, fn:PredicateFn)=>void, has:(key:string)=>boolean, resolveAll:(chain:import('../../shared/tracker/chain.js').Chain, ctx:PredicateContext)=>Promise<Record<string, PredicateResult>>}}
 */
export function createPredicateRegistry(opts = {}) {
  const timeout = typeof opts.timeout === 'number' ? opts.timeout : 3000
  /** @type {Map<string, PredicateFn>} */
  const map = new Map()

  function register(key, fn) {
    if (typeof key !== 'string' || !key) throw new Error('predicate key must be non-empty string')
    if (typeof fn !== 'function') throw new Error('predicate fn must be function')
    if (map.has(key)) throw new Error('predicate duplicate: ' + key)
    map.set(key, fn)
  }

  function has(key) { return map.has(key) }

  function withTimeout(promise, ms) {
    let t
    const timer = new Promise((resolve) => { t = setTimeout(() => resolve({ __timeout: true }), ms) })
    return Promise.race([promise, timer]).finally(() => clearTimeout(t))
  }

  /**
   * 解析整条链的所有谓词（并行 + 超时按 pending）。
   * - primitive：直接 execPrimitive
   * - backend/preflight：查注册表；未注册 → 'pending'（2026-08-27 起删 na，行不存在而非标 na，诚实不猜）
   * - 超时 → pending（不抛，不阻塞其他）
   */
  async function resolveAll(chain, ctx) {
    const out = {}
    if (!Array.isArray(chain) || chain.length === 0) return out
    const tasks = chain.map(async (item) => {
      const id = item && item.id
      let check = item && item.check
      // B2 fix: 兼容 chain 校验通过的 string 简写（G5 诚实，此处归一为 backend）
      if (typeof check === 'string') check = { kind: 'backend', id: check }
      if (!id || !check) { out[id || '__bad__'] = makeResult('pending', 'bad item'); return }
      try {
        let r
        if (check.kind === 'primitive') {
          const raced = await withTimeout(execPrimitive(check, ctx), timeout)
          if (raced && raced.__timeout) r = makeResult('pending', 'timeout after ' + timeout + 'ms (probe hung or network slow; re-check later)')
          else r = raced
        } else if (check.kind === 'backend' || check.kind === 'preflight') {
          // key 规则：backend: 'backend:<backendId>:<id>' 或 'preflight:<id>'；兼容直接 id
          const backendId = check.backendId || (ctx && ctx.backendId) || ''
          const keysToTry = []
          if (check.kind === 'backend') {
            if (check.id) keysToTry.push('backend:' + (backendId || '*') + ':' + check.id)
            if (check.id) keysToTry.push('backend:*:' + check.id)
            if (check.id) keysToTry.push(check.id)
          } else {
            if (check.id) keysToTry.push('preflight:' + check.id)
            if (check.id) keysToTry.push(check.id)
          }
          let fn = null
          for (const k of keysToTry) if (map.has(k)) { fn = map.get(k); break }
          if (!fn) {
            // 未注册 = 对当前宿主/后端不适用 → pending（2026-08-27 起删 na，行不存在而非标 na，不误判 fail）
            r = makeResult('pending', 'predicate not registered: ' + (check.id || ''))
          } else {
            const raced = await withTimeout(fn(check, ctx), timeout)
            if (raced && raced.__timeout) r = makeResult('pending', 'timeout after ' + timeout + 'ms (probe hung or network slow; re-check later)')
            else r = raced
          }
        } else {
          r = makeResult('pending', 'unknown check.kind: ' + check.kind)
        }
        // 归一化 status
        const s = r && r.status
        if (s !== 'pass' && s !== 'fail' && s !== 'pending') r.status = 'pending' // 2026-08-27 起无 na
        out[id] = r
      } catch (e) {
        out[id] = makeResult('pending', String((e && e.message) || e))
      }
    })
    await Promise.all(tasks)
    return out
  }

  return { register, has, resolveAll, get _map(){ return new Map(map) } } // D-3 fix: _map 只读拷贝，不暴露内部可变 Map
}

/**
 * 将 resolveAll 的结果转为 evaluateChain 的输入（Record<id, 'pass'|'fail'|null>，2026-08-27 起无 na）。
 * @param {Record<string, PredicateResult>} resolved
 * @returns {Record<string, 'pass'|'fail'|null>}
 */
export function toPredicateResults(resolved) {
  const out = {}
  for (const [k, v] of Object.entries(resolved || {})) {
    const s = v && v.status
    if (s === 'pass') out[k] = 'pass'
    else if (s === 'fail') out[k] = 'fail'
    else out[k] = null // pending/unknown → null（evaluateChain 视为 pending）
  }
  return out
}

export const PREDICATE_REGISTRY_VERSION = 1