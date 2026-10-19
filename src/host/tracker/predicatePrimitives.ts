// src/host/tracker/predicatePrimitives.ts —— 从同目录 predicatePrimitives.js 逐行转写而来，只加类型标注与注释，运行时逻辑一个字未动。
//
// 为什么要转写这一份：通用原语执行器是谓词注册表的底层执行件，转成 TypeScript 后调用方
//   （同目录 predicateCore.ts 取 execPrimitive 与 makeResult）能按类型取用，探测行为仍与原来逐行一致。
// 什么约定不能改：
//   1. 全部只读探测，失败返回而非抛出，超时与未知一律按待定诚实上报，不猜测。
//   2. 目录可写判据是唯一例外：向被检目录写固定名临时探针并清理，不做权限位推断。
//   3. 平台文件服务的目标形状与路径形状区分保持原样，字符串拼接只发生在相对路径与工作区上。
//   4. 相对导入一律保留 .js 后缀，运行时由 scripts/ts-hook.mts 改指同名 .ts，本文件不改说明符。
//   5. 只写可剥离类型：类型一律经 import type 引入，Node 内置模块的动态导入仍走原来字符串，不新增任何运行时边。

import { PRIMITIVE_KIND } from '../../shared/tracker/chain-types.js' // S1 #451：chain.js 已拆为三文件，枚举改从类型文件取（V1 新文件同步改路径）

// 类型只做编译期约束，不产生运行时引用：检查形状以共享层为准，平台与后端标识以各真源为准。
import type { Check } from '../../shared/tracker/chain-types.js'

// 本域 tsconfig 有意不加载任何类型包（types 为空），宿主进程环境的声明随 @types/node 一起缺席。
// 运行时一定是 Node，进程环境一定存在，所以按存在声明（同 git-process.ts 的写法），不产生运行时代码。
declare const process: { env: Record<string, string | undefined> } | undefined

import { probeFileExists, probeDirWritable, makeResult, detailFor } from './predicateFileProbes.js'
import type { PredicateContext, PredicateResult, PredicateFn } from './predicateFileProbes.js'

// 结果模型与两支磁盘探测已搬至 ./predicateFileProbes.js（#1255）：本文件只留分发骨架；
// 门禁与装配入口原来从这里取引入名，取法不变（下面原样再导出），跨文件边只有这一条
// （本文件 → predicateFileProbes.js，被依赖方），反向不依赖，不构环。
export { makeResult, detailFor }
export type { PredicateContext, PredicateResult, PredicateFn }

// 通用原语执行器（primitive）。
export async function execPrimitive(check: Check, ctx: PredicateContext): Promise<PredicateResult> {
  const p = ctx && ctx.platform ? ctx.platform : null
  const kind = check && (check as Check).primitive
  try {
    if (kind === PRIMITIVE_KIND.COMMAND_EXISTS) {
      const cmd = (check as Check).command as string
      if (!p || typeof p.resolveExecutable !== 'function') return makeResult('pending', detailFor(ctx, '系统找不到命令的能力不可用', 'platform.resolveExecutable unavailable'))
      const hit = await p.resolveExecutable(cmd)
      return hit
        ? makeResult('pass', detailFor(ctx, '已找到 ' + cmd + '：' + hit, cmd + ' found: ' + hit))
        : makeResult('fail', detailFor(ctx, '未找到命令 ' + cmd + '（可能还没安装）', cmd + ' not found in PATH'))
    }
    if (kind === PRIMITIVE_KIND.FILE_EXISTS) { return probeFileExists(check, ctx) }
    if (kind === PRIMITIVE_KIND.DIR_WRITABLE) { return probeDirWritable(check, ctx) }
    if (kind === PRIMITIVE_KIND.HOME_DIR) {
      // /homeDir（2026-08-28 修复）：主目录判装只问平台层——win32 不读 HOME（os.homedir→USERPROFILE），linux/mac 走 os.homedir；
      //   原 ENV(HOME) 在 Windows 必然误报「HOME not set」，主目录明明可解析却判 fail。
      //   平台层不可用 → 诚实 pending（不猜）；解析失败 → fail（环境级异常：daemon/容器/服务账户无用户上下文）。
      if (!p || typeof p.getHome !== 'function') return makeResult('pending', detailFor(ctx, '平台主目录能力不可用', 'platform.getHome unavailable'))
      try {
        const h = await p.getHome()
        return h ? makeResult('pass', h) : makeResult('fail', detailFor(ctx, '用户主目录无法解析（系统级环境异常）', 'user home not resolved'))
      } catch (e) { const caught = e as { message?: unknown } | null | undefined; return makeResult('pending', String((caught && caught.message) || e)) }
    }
    if (kind === PRIMITIVE_KIND.ENV) {
      const key = (check as Check).key as string
      const env = p && p.env ? p.env : null
      // 宿主进程环境经文件头局部声明取用，缺席时按未设置处理，运行时取值与原来完全一致。
      const val = env && typeof env.get === 'function' ? env.get(key) : (typeof process !== 'undefined' && process ? process.env[key] : undefined)
      return val ? makeResult('pass', key + '=set') : makeResult('fail', detailFor(ctx, key + ' 未设置', key + ' not set'))
    }
    if (kind === PRIMITIVE_KIND.SKILL_PROBE) {
      const skill = (check as Check).skill as string
      // #284：优先走 host 注入的判装原语（ctx.skillProbe = DSH 注册表查询 + 红牌分拣 + 等待契约）；
      //   仅未注入时回退标准根 fs 探测（#280 单一尺度：仅标准根 .agents/skills；#281 轻探永不绿的纪律由 host probeSkill 承载）
      if (ctx && typeof ctx.skillProbe === 'function') {
        try {
          const r: any = await ctx.skillProbe(skill)
          if (r && typeof r === 'object') {
            if (r.level === 'ok') return makeResult('pass', r.detail || (skill + ' ok'), r.hint)
            if (r.level === 'pending') return makeResult('pending', r.detail || ('waiting'), r.hint)
            return makeResult('fail', r.detail || (skill + ' not ok'), r.hint)
          }
          if (r && r.status) return r as PredicateResult
        } catch (e) { const caught = e as { message?: unknown } | null | undefined; return makeResult('pending', 'skillProbe error: ' + String((caught && caught.message) || e)) }
      }
      if (!p || typeof p.getHome !== 'function' || !p.fs) return makeResult('pending', detailFor(ctx, '平台能力不可用，无法探测技能', 'platform unavailable for skillProbe'))
      try {
        const home = await p.getHome()
        const candidates = [
          home ? (p.path.join(home, '.agents', 'skills', skill)) : null,
        ].filter(Boolean) as string[]
        for (const cand of candidates) {
          try {
            if (typeof (p.fs as any).exists === 'function') {
              if (await (p.fs as any).exists(cand)) return makeResult('pass', detailFor(ctx, skill + ' 已找到：' + cand, skill + ' found at ' + cand))
            } else if (typeof (p.fs as any).readText === 'function') {
              try { await (p.fs as any).readText(p.path.join(cand, 'SKILL.md')); return makeResult('pass', detailFor(ctx, skill + ' 已找到', skill + ' found')) } catch {}
            }
          } catch {}
        }
        return makeResult('fail', detailFor(ctx, skill + ' 未找到', skill + ' not found'))
      } catch (e) {
        const caught = e as { message?: unknown } | null | undefined
        return makeResult('pending', String((caught && caught.message) || e))
      }
    }
    return makeResult('pending', 'unknown primitive: ' + String(kind))
  } catch (e) {
    const caught = e as { message?: unknown } | null | undefined
    return makeResult('pending', String((caught && caught.message) || e))
  }
}
