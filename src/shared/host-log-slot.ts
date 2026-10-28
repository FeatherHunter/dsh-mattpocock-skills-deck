// 宿主日志槽：宿主入口把日志库的加载结果挂在 globalThis 的一个固定键上，供不能 import 宿主模块的
// 地方（工具行的登记层、测试）按约定读取。键值、槽的形状、建槽与读取规则从前在入口、登记层与测试
// 里各写一份，改一处漏一处时日志会悄悄流向另一个格子，不报错（#1620 记录的就是这种「少一行轨迹、
// 要等下次排查才发现」的现象）。现在只有这一个文件知道键与形状，别处都从这里取。
//
// 约定（改之前先读完）：
// 1. 本文件是 src/shared 根上的散文件，不许 import 任何模块。宿主入口只能用动态 import 拉它（D7：
//    入口的静态 import 会被构建脚本的预检判红）；登记层静态 import 它，也不会把宿主模块带进工具行。
// 2. 槽对象全进程只有一份，p 是日志库的加载 Promise（可能还没解析），hd 记录启动头是否已写过，
//    svc 挂当前这次装配的服务（fs/timer/缓存目录/设置读取/默认工作目录），由宿主每次取槽时覆盖。
// 3. 读不到就回 null，不抛错、不建槽：日志可以缺，不能因为读日志把业务路径弄红。建槽只发生在宿主
//    入口（ensureHostLogSlot），读方不要替宿主决定槽什么时候出现。
export const HOST_LOG_SLOT = '__dsh_mattskillsdeck_host_log__'

export interface HostLogSlot {
  p: Promise<any> | null
  hd: boolean
  svc: any
}

/**
 * 取宿主日志槽；还没有就建一份默认的。
 *
 * 默认值必须与旧入口里的一致：p 为空（日志库还没开始加载）、hd 为 false（启动头还没写）、svc 为空。
 * 重复调用拿到的是同一个对象——同一进程里日志库只加载一次，谁先加载谁往 p 上挂。
 */
export function ensureHostLogSlot(): HostLogSlot {
  const g: any = globalThis as any
  if (!g[HOST_LOG_SLOT]) g[HOST_LOG_SLOT] = { p: null, hd: false, svc: null }
  return g[HOST_LOG_SLOT]
}

/**
 * 读日志库本体：槽里挂的加载 Promise 解析出来是什么就回什么，读不到回 null。
 *
 * 三种读不到都收成 null：槽还没建、p 还不是 Promise（宿主还没开始加载）、p 拒绝（日志库加载失败）。
 * 读方据此安静丢弃这一行日志即可。这里只在读取这一下等，不重试——什么时候该重试是读方的事
 * （登记层的兜底口在等待窗口内重读几次，见 suggest-steps-register.ts）。
 */
export async function readHostLogStore(): Promise<any | null> {
  try {
    const g: any = globalThis as any
    const slot = g[HOST_LOG_SLOT]
    const pending = slot && slot.p
    if (!pending || typeof pending.then !== 'function') return null
    const store = await pending
    return store || null
  } catch (eRead) {
    return null
  }
}
