// src/host/tracker/predicateFileProbes.ts —— 文件系统类原语探测：存在探测与可写探测（#1255 从 predicatePrimitives.ts 拆出）
//
// 为什么单列：FILE_EXISTS 与 DIR_WRITABLE 是六原语里唯二碰磁盘的两支，各自带着独立的兜底史
//   （#284 目录型真相、#344 直读兜底、#476 沙箱拒信判灰）；结果模型（makeResult/detailFor）与三个
//   类型一起搬过来，分发骨架（COMMAND/HOME/ENV/SKILL）留在 predicatePrimitives.ts，
//   两边变化原因不同（磁盘判据变 vs 分发策略变）。
// 什么约定不能改：
//   1. 全部只读探测；不创建或删除写探针。
//   2. 无法安全验证可写性时返回 pending。
//   3. 双语文案走 detailFor 单一真源，不在本文件另起文案。
// 方向只有一条（predicatePrimitives.ts → 本文件，被依赖方）：执行器调两支探测；
//   本文件不反向引用，构不成环；Check/Platform/BackendId 三个类型直连各共享层真源。

import type { Check } from '../../shared/tracker/chain-types.js'
import type { Platform } from '../platform/index.js'
import type { BackendId } from '../../shared/tracker/shape.js'

// 谓词结果：状态只认三档，细节与引导文案供日志与链快照复用。
export interface PredicateResult {
  status: 'pass' | 'fail' | 'pending'
  // 人读细节（日志用）
  detail?: string
  // 引导文案透传（与 Show.hint 同源，供链快照复用）
  hint?: string
}

// 谓词上下文：契约字段之外，宿主在契约之外多喂了语言、技能判装与沙箱许可三格。
// 为什么在这里一并声明：detailFor 按语言选文案，技能探测优先走注入原语，写探测带上本次调用的写许可；
//   缺省一律按没有处理，运行时取值形状与原来完全一致。
export interface PredicateContext {
  // 平台抽象实例
  platform: Platform
  // 当前后端（通用探测时 null）
  backendId: BackendId | null
  // 工作区路径
  cwd: string
  signal?: AbortSignal
  // 额外上下文（如 repoRef）
  extras?: Record<string, unknown>
  // 宿主在契约之外喂的语言（面板主语言缺省按中文）
  lang?: string
  // 宿主注入的技能判装原语（未注入时回退标准根文件探测）
  skillProbe?: (skill: string) => Promise<any>
  // 本次调用的写许可（无归属会话时为空，不自己拼宽松政策）
  sandboxPolicy?: unknown
}

// 谓词函数：检查描述与上下文喂进来，异步给出结果。
export type PredicateFn = (check: Check, ctx: PredicateContext) => Promise<PredicateResult>

export function makeResult(status: PredicateResult['status'], detail?: string, hint?: string): PredicateResult {
  const r: PredicateResult = { status }
  if (detail) r.detail = String(detail).slice(0, 600)
  if (hint) r.hint = String(hint).slice(0, 2000)
  return r
}

// 2026-08-29（审查 S1）：谓词 detail 双语——detail 会经 enrichSnap 直出到 UI 行内描述，
//   中文界面不得出现英文黑话行。按 ctx.lang（wf.chain 注入）取词；lang 缺省 zh（面板主语言）。
export function detailFor(ctx: PredicateContext | null | undefined, zhText: string, enText: string): string {
  return (ctx && ctx.lang === 'en') ? enText : zhText
}

// 文件存在探测（原 execPrimitive 的 FILE_EXISTS 分支原样搬运，只加导出与函数壳，不改逻辑）。
export async function probeFileExists(check: Check, ctx: PredicateContext): Promise<PredicateResult> {
  const p = ctx && ctx.platform ? ctx.platform : null
  const rel = (check as Check).path as string
  if (!p || !(p.fs as unknown) || typeof (p.fs as any).resolve !== 'function') return makeResult('pending', 'platform.fs unavailable')
  // 优先用 platform.fs.resolve + readText 探测；不存在即 fail
  try {
    const abs0 = await (p.fs as any).resolve(rel, { cwd: ctx.cwd })
    // #284：resolve 可能返回 target-shaped 对象（真实 DSH fs 契约）——取 path 再交给探测分支
    const abs = (abs0 && typeof abs0 === 'object' && abs0 !== null && typeof (abs0 as { path?: unknown }).path === 'string') ? (abs0 as { path: string }).path : abs0
    // 尝试 stat 式探测（若平台提供 exists/readText）
    if (typeof (p.fs as any).exists === 'function') {
      const ok = await (p.fs as any).exists(abs)
      if (ok) return makeResult('pass', detailFor(ctx, rel + ' 已存在', rel + ' exists'))
      // #284 修复（2026-08-28）：目录型检查（如 md:.scratch）——DSH fs.exists 可能只对文件为真，
      //   目录用 listDir/stat/lstat 兜底判定存在（.scratch 明明是目录却报 not found）。
      if (typeof (p.fs as any).listDir === 'function') { try { await (p.fs as any).listDir(abs); return makeResult('pass', detailFor(ctx, rel + ' 已存在（目录）', rel + ' exists (dir)')) } catch (eD) {} }
      if (typeof (p.fs as any).stat === 'function') { try { const st = await (p.fs as any).stat(abs); if (st) return makeResult('pass', detailFor(ctx, rel + ' 已存在', rel + ' exists')) } catch (eS) {} }
      if (typeof (p.fs as any).lstat === 'function') { try { const info = await (p.fs as any).lstat(abs); if (info) return makeResult('pass', detailFor(ctx, rel + ' 已存在', rel + ' exists')) } catch (eL) {} }
      // #344 加固（2026-08-31）：平台侧未探测到但文件可能已在盘上（DSH fs 沙箱滞后或围栏），直读兜底
      try{
        const directOk = await (async function(): Promise<boolean>{
          try{
            const pathJoin = (p && p.path && typeof p.path.join === 'function') ? p.path.join : function(a: string,b: string){ return (String(a||'').replace(/[\\/]+$/, '') + '/' + String(b||'').replace(/^[\\/]+/, '')) }
            const absDirect = pathJoin(String(ctx.cwd||''), String(rel||''))
            // @ts-expect-error —— 本域 types 为空，node:fs/promises 的类型声明缺席；运行时一定是 Node，该模块必然存在（纯类型层面，不影响运行时转译，同 bootstrap.ts 写法）。
            const mod: any = await import('node:fs/promises')
            const fsp = mod.default || mod
            await fsp.stat(absDirect)
            return true
          }catch(eDirect){ return false }
        })()
        if(directOk) return makeResult('pass', detailFor(ctx, rel + ' 已存在', rel + ' exists'))
      }catch(eDirect2){}
      return makeResult('fail', detailFor(ctx, rel + ' 不存在', rel + ' not found'))
    }
    if (typeof (p.fs as any).readText === 'function') {
      try { await (p.fs as any).readText(abs); return makeResult('pass', detailFor(ctx, rel + ' 已存在', rel + ' exists')) } catch {
        // #344 加固：readText 未命中时同样尝试直读兜底
        try{
          const pathJoin2 = (p && p.path && typeof p.path.join === 'function') ? p.path.join : function(a: string,b: string){ return (String(a||'').replace(/[\\/]+$/, '') + '/' + String(b||'').replace(/^[\\/]+/, '')) }
          const absDirect2 = pathJoin2(String(ctx.cwd||''), String(rel||''))
          // @ts-expect-error —— 见上，node:fs/promises 同理。
          const mod2: any = await import('node:fs/promises')
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
    const caught = e as { message?: unknown } | null | undefined
    return makeResult('fail', String((caught && caught.message) || e))
  }
}

// 目录不存在时失败；否则不写入文件，可写性未验证。
export async function probeDirWritable(check: Check, ctx: PredicateContext): Promise<PredicateResult> {
  const p = ctx && ctx.platform ? ctx.platform : null
  const rel = (check as Check).path as string
  const zh = !!(ctx && ctx.lang === 'zh')
  if (!p || !(p.fs as unknown) || typeof (p.fs as any).resolve !== 'function') return makeResult('pending', 'platform.fs unavailable')
  const missing = (error: unknown): boolean => {
    const e = error as { code?: unknown; message?: unknown } | null
    if (typeof e?.code === 'string') return e.code === 'ENOENT'
    return typeof e?.message === 'string' && /\bENOENT\b/.test(e.message)
  }
  let absent = false
  let found = false
  try {
    const target = await (p.fs as any).resolve(rel, { cwd: ctx.cwd })
    // exists(false) may mean a directory rather than a missing path; null stat is also ambiguous.
    for (const method of ['exists', 'listDir', 'stat', 'lstat']) {
      if (found || typeof (p.fs as any)[method] !== 'function') continue
      try {
        const result = await (p.fs as any)[method](target)
        if (method === 'listDir' || (method === 'exists' ? result === true : !!result)) found = true
      } catch (e) { if (missing(e)) absent = true }
    }
  } catch (e) { if (missing(e)) absent = true }
  if (!found && absent) return makeResult('fail', zh ? '目录不存在' : rel + ' not found')
  // 无条件删除安全保证，绝不创建写入探针。
  return makeResult('pending', zh ? '未进行写入探测，目录可写性未验证' : 'no write probe attempted; directory writability unverified')
}
