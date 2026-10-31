/**
 * src/host/notifications.ts —— 通知事件库的宿主接线叶子（#1693 建立，#1681 复审修复搬出宿主入口）
 *
 * 为什么单独一个文件：宿主入口贴着四百行上限（#1697 靠「两句合一行」才把通知接线塞进去），
 * 事件库的惰性加载与 wf.notifications 一条只读电话放在入口里既挤又难读。这里照
 * src/host/settingsPhones.ts 的先例把这段接线做成自包含叶子，入口只留一行加载器与一行注册。
 *
 * 三条不能改的约定：
 * 1. 事件库只加载一次，之后复用同一份实例：库里用一条 promise 链串起读改写，两个实例会互相覆盖盘上文件。
 * 2. wf.notifications 是只读电话，只调事件库的 read 取历史；当前是否降级永远从快照派生，不从事件历史反推。
 * 3. 事件库加载失败或读盘失败都不影响主流程：记录类调用静默跳过，只读电话回空历史加 ok:true，
 *    界面按「读得到、暂时没有」来画，不抛异常、不把宿主卡住。
 */
type Deps = any
type WfArgs = any

export function createNotifications(deps?: any): any {
  const d = (deps || {}) as Deps
  let storeP: Promise<any> | null = null
  /** 惰性加载事件库；加载失败时清掉缓存的 promise，下一次调用可以再试。 */
  function store(): Promise<any> {
    if (!storeP) {
      storeP = (async function (): Promise<any> {
        const mod = await import('../refresh/rooms/host/notification-store.js')
        return mod.createNotificationStore({
          fs: d.fs,
          getPlatform: d.getPlatform,
          getCacheDir: d.getCacheDir,
          getRepoKey: d.getRepoKey,
          logCtx: d.logCtx
        })
      })()
      storeP.catch(function () { storeP = null })
    }
    return storeP
  }
  /** 把一次记录排进事件库；事件库不可用就静默跳过，绝不影响取数、刷新与写票。 */
  function note(method: string, args: any[]): Promise<any> {
    return store().then(function (st: any) {
      return st[method].apply(st, args)
    }).catch(function () { return null })
  }
  function noteSnapshot(snap: any, cwd: any): Promise<any> { return note('noteSnapshot', [snap, cwd]) }
  function noteRefreshFailure(cwd: any, error: any): Promise<any> { return note('noteRefreshFailure', [cwd, error]) }
  function noteWriteFailure(info: any): Promise<any> { return note('noteWriteFailure', [info]) }
  /** wf.notifications：按工作区读事件历史，读不到就是空历史（不冒充「没有事件」以外的任何状态）。 */
  async function handleNotifications(args: any): Promise<any> {
    const a = (args || {}) as WfArgs
    let events: any[] = []
    try {
      const st = await store()
      events = await st.read(a.cwd || d.defaultCwd || '')
    } catch (e) { events = [] }
    return { ok: true, events: events }
  }
  return { noteSnapshot: noteSnapshot, noteRefreshFailure: noteRefreshFailure, noteWriteFailure: noteWriteFailure, handleNotifications: handleNotifications }
}

export default createNotifications
