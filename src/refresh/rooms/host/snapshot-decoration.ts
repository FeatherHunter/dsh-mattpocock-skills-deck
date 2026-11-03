// src/refresh/rooms/host/snapshot-decoration.ts —— 快照回包的三处「装饰」：布局答案、后端模块声明、跨会话在办表。
//
// 为什么单开这一个文件：session-snapshot-cache.ts 贴着 350 行上限（tests/verify-file-granularity.ts），
// #1835 要往里加「快照取数失败记历史」时它已经 430 行（含注释），把与电话体无关的读盘、取注册表、
// 挂表这三件搬出来。搬的时候只搬不改：函数体、注释、兜底值与原来逐字一致。
import { parseWorkspaceFile, WORKSPACE_FILE_REL, isWorkspaceLayout } from '../../../deck/shell/workspace-anchor.js'
import { projectUiDescription } from '../../../tracker/ui-description.js'

/** 记住的布局答案（#683）：layout 是选的哪一种，pickedAt 是什么时候选的。 */
type Layout = { layout: unknown; pickedAt: unknown }
/** 接线处交进来的几只口子（字段名与 session-snapshot-cache 的 SnapshotDeps 一一对应）。 */
type DecorationDeps = {
  getPlatform(): Promise<unknown> | unknown
  ctx: { get(name: string): unknown }
  getTrackerRegistry(): Promise<any> | any
  env: any
}

export function createSnapshotDecoration(deps: DecorationDeps) {
  const { getPlatform, ctx, getTrackerRegistry, env } = deps
  // #595：快照带后端的 prompts 声明（正文格式按当前后端解析）。盘缓存存的是旧 backendModules、无 prompts，直接回放会丢两步写回，故命中时用当前注册表重挂，取不到保留原值。
  async function freshBackendModules() {
    try {
      const regM = await getTrackerRegistry()
      if (regM && typeof regM.modules === 'function') {
        return regM.modules().map(projectUiDescription)
      }
    } catch (e) {}
    return null
  }
  // #683（F1 · ADR 的 R6）：快照里带上记住的布局答案（同 R4 那条路：落后的那扇窗不靠它就永远停在老答案上）。
  // #1433 起重播工作区文件；#1449 起这里是唯一读法——文件里没有就是「还没答过」，本机记忆不再参与。
  async function readSetupLayoutOf(cwd: string): Promise<Layout | null> {
    try {
      const plat = await Promise.resolve(getPlatform()).catch(function () { return null }); let f: any = (plat && (plat as any).fs) || null
      if (!f && ctx && typeof ctx.get === 'function') { try { f = ctx.get('fs') } catch (eG) {} }
      if (f && typeof f.resolve === 'function' && typeof f.readText === 'function') { try { const rec = parseWorkspaceFile(await f.readText(await f.resolve(WORKSPACE_FILE_REL, { cwd: cwd }))); if (rec && isWorkspaceLayout(rec.layout)) return { layout: rec.layout, pickedAt: 0 } } catch (eR) {} }
    } catch (e) {}
    return null
  }
  // #1082：跨会话在办表的读数也在回包交出去之前现挂（异步读盘）；信封没这一口（旧测试手捏的）就不挂。
  async function attachWorkRouteTable(reply: unknown, args: any) {
    return (env && typeof env.withWorkRouteTable === 'function') ? await env.withWorkRouteTable(reply, args) : reply
  }
  return { freshBackendModules, readSetupLayoutOf, attachWorkRouteTable }
}
