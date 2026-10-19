// workRouteReadoutForHost.ts —— 宿主里「工作路线读数」的两件装配（#1082）。
//
// 两件东西住在一起，是因为它们共用同一个实例、也同属「宿主接线」这一层的事，而宿主同层互引要记存量豁免
// （tests/same-layer-baseline.json）—— 合成一个文件，接线处只多一条边，不把两笔债分开记。
//
// 一、createLazyWorkRouteBindings：工作路线读写零件的惰性装配。
//   为什么惰性：宿主装配在进程启动时只跑一次，那时还取不到平台层给的家目录；谁先用到谁触发，
//   取不到只让那一次读写回诚实的原因（没落上 / 没接上），不把整个插件带崩。
//   为什么单列：宿主接线文件（wiring.ts）贴着 350 有效行的红线，而这里是「问平台层要家目录、
//   动态引入 Node 原生 fs、把读写/改名/日志交给 createWorkRouteBindings」的一整段展开。
//   工具依赖与面板「跨会话在办表」共用同一个实例，所以两边读的是同一份存档。
//
// 二、createWorkRouteTableReadout：面板「跨会话在办表」的挂载口。
//   这张表回答「这个工作区里每个会话在处理哪些票」。数据只有一个来源：工具壳每次写票成功时落在
//   工作路线存档里的那一份（src/deck/shell/work-path-store.ts）。工具回执里的 data.workRoute
//   和这张表读的是同一份存档、同一个读出口（work-path-bindings.ts 的 read），两边不会各算一套。
//
//   调用方给的东西：
//     read      现成的读出口（输入 { rootKey, sessionId, at }，输出 { ok, readout } 或 { ok:false, reason }）
//     rootKeyOf 工作区根 → 工作区键（与工具会话里的 workspaceKey 是同一把钥匙，见 shared/refresh-workspace-key.ts）
//     now       取时间（门禁注入固定时钟；生产是 Date.now）
//     回包不是 ok:true 时原样返回 —— 失败快照不许挂一份看起来成功的读数。
import { createWorkRouteBindings } from '../../deck/shell/work-path-bindings.js'

/** 快照回包上这个字段的名字；界面（client/views/shared/workRouteTable.ts）读的是同一个名字。 */
export const WORK_ROUTE_TABLE_FIELD = 'workRouteTable'

/** 装配要的宿主出口：取平台层（家目录从它来）、宿主日志出口。 */
export interface WorkRouteBindingsHostDeps {
  /** 取平台层对象；缺省（或取不到）时按没有家目录处理，读写会如实回「没落上」。 */
  getPlatform?: () => any
  /** 宿主日志出口（workRoute.write / workRoute.read 从这里出去）；缺了就不记。 */
  logCtx?: any
}

/**
 * 造一个惰性的工作路线实例 getter：第一次调用时装配，之后复用同一份。
 * 回包形状与 createWorkRouteBindings 一致（note / read / release）。
 */
export function createLazyWorkRouteBindings(deps?: WorkRouteBindingsHostDeps): () => Promise<any> {
  const d = deps || {}
  let p: Promise<any> | null = null
  return function get(): Promise<any> {
    if (!p) {
      p = (async function (): Promise<any> {
        let platform: any = null
        try { platform = (typeof d.getPlatform === 'function') ? await d.getPlatform() : null } catch (eP) { platform = null }
        // @ts-expect-error
        const fsPromises: any = await import('node:fs/promises')
        let workPathHome = ''
        try { if (platform && typeof platform.getHome === 'function') workPathHome = String(await platform.getHome() || '') } catch (eH) {}
        return createWorkRouteBindings({
          homeDir: workPathHome, now: Date.now,
          // 只有「文件不存在」才当没有（回 null，第一次用的正常情况）；权限、占用、盘错等读失败要让
          // 存储看见 failed（否则会被当成空账静默重写，回执也不说明，workRoute.read 几乎永远不发）。
          readFile: function (pth: any): any { try { return Promise.resolve(fsPromises.readFile(String(pth), 'utf8')).then(function (t: any) { return t }, function (eR: any) { if (eR && eR.code === 'ENOENT') return null; throw eR }) } catch (eR: any) { return Promise.reject(eR) } },
          writeFile: function (pth: any, t: any): any { return fsPromises.writeFile(String(pth), String(t), 'utf8') },
          mkdir: function (dir: any): any { return fsPromises.mkdir(String(dir), { recursive: true }) },
          rename: function (from: any, to: any): any { return fsPromises.rename(String(from), String(to)) },
          log: d.logCtx,
        })
      })()
    }
    return p
  }
}

/** 读出口的入参形状（与 work-path-bindings.ts 的 read 一致）。 */
export interface WorkRouteTableReadInput { rootKey: string; sessionId: string; at: number }

/** 建挂载函数要的三只口子；都允许在门禁里换成固定时钟与内存读。 */
export interface WorkRouteTableReadoutDeps {
  read: (input: WorkRouteTableReadInput) => Promise<unknown> | unknown
  rootKeyOf: (root: string) => string
  now?: () => number
}

/**
 * 造一个「给快照回包挂表」的函数：输入回包与这次是哪个会话在问，把字段挂到回包上，
 * 返回值就是挂在字段上的那一格（快照信封把它原样写进回包）。
 *
 * 工作区根取自回包自己的 workspaceRoot（宿主算好的工作区根，客户端算不出来），再换算成工作区键 ——
 * 工具写文件时用的也是这把键，两处必须同源，否则表读的是另一份存档。
 */
export function createWorkRouteTableReadout(deps: WorkRouteTableReadoutDeps) {
  const read = deps && typeof deps.read === 'function' ? deps.read : null
  const rootKeyOf = deps && typeof deps.rootKeyOf === 'function' ? deps.rootKeyOf : null
  const now = deps && typeof deps.now === 'function' ? deps.now : Date.now
  return async function attach(reply: any, ctx?: { sessionId?: unknown }): Promise<any> {
    if (!reply || typeof reply !== 'object' || reply.ok !== true) return undefined
    const put = function (value: any): any {
      reply[WORK_ROUTE_TABLE_FIELD] = value
      return value
    }
    if (!read || !rootKeyOf) return put({ ok: false, reason: 'host.work-route.no-binding' })
    const root = typeof reply.workspaceRoot === 'string' ? reply.workspaceRoot : ''
    if (root === '') return put({ ok: false, reason: 'host.work-route.no-workspace' })
    let out: any = null
    try {
      out = await read({
        rootKey: String(rootKeyOf(root)),
        sessionId: ctx && ctx.sessionId ? String(ctx.sessionId) : '',
        at: now(),
      })
    } catch (e) {
      out = null
    }
    if (!out || out.ok !== true) return put({ ok: false, reason: String((out && out.reason) || 'read-failed') })
    return put({ ok: true, readout: out.readout })
  }
}
