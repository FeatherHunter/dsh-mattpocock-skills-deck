/**
 * platform/linux/index.js — Linux 适配器（#169 落地，#168 G 决议定版）。
 *
 * 不变量（第一性原理 · L1-L6）：
 *   L1 getHome 主源 = `os.homedir() || null`，不另读 process.env.HOME 第二真相（#129 D2；重复读 env 属第二真相漂移）。
 *   L2 HOME 空/未设：空串视作未设；`os.homedir()` 抛异常或返回空串/falsy → catch → null（覆盖容器最小镜像/无 passwd 场景）。
 *   L3 sh 别名：不做别名，直透 DSH `subprocess.resolveExecutable('sh')` 原名（linux 无 sh.exe）。
 *   L4 gh 非常规安装：先 PATH（DSH `resolveExecutable('gh')`）后 `DSH_GH_PATH` 兜底 + `fs.lstat` 校验，兜底≠覆盖。
 *   L5 路径形态：全量委托 `node:path.posix`（sep='/'），零自实现（沿 #113 D1）。
 *   L6 ~/$VAR 展开：平台层不展开（shell 语义归调用方；path.posix 不展开 ~/ 语义）。
 *
 * 通用包装（缓存 / throw→null / path 委托 / fs 透传 / env 视图）由 `platform/index.js:composePlatform` 单点提供，
 * 本文件只提供 OS 专属原语（pathImpl / getHome / resolveExecutable），不重复实现通用层。
 */
import nodePath from 'node:path'
import nodeOs from 'node:os'

function resolveHomedir(ctx, opts) {
  const o = opts && typeof opts === 'object' ? opts : {}
  if (typeof o.homedir === 'function') return o.homedir
  if (ctx && typeof ctx._homedir === 'function') return ctx._homedir
  if (ctx && typeof ctx.__homedir === 'function') return ctx.__homedir
  return () => nodeOs.homedir()
}

export default function linuxAdapter(ctx, opts) {
  const homedir = resolveHomedir(ctx, opts)
  return {
    os: 'linux',
    /** 路径数学全委托 node:path.posix（零自实现；各 OS 不得重实现）。 */
    pathImpl: nodePath.posix,
    /** getHome：os.homedir() 直接采用，空串→null，抛异常→null（容器最小镜像/无 passwd 场景）。 */
    async getHome() {
      try {
        return homedir() || null
      } catch {
        return null
      }
    },
    /**
     * resolveExecutable：按 G 决议 L3/L4
     * - sh 等通用名：直透 DSH `subprocess.resolveExecutable(name)`，找不到时 throw → 由通用层 composePlatform 转 null。
     * - gh：先 PATH（DSH 解析），未命中 throw 后查 DSH_GH_PATH + fs.lstat 校验存在才返回，否则继续 throw → null。
     */
    async resolveExecutable(name) {
      const subprocess = ctx.get('subprocess')
      try {
        return await subprocess.resolveExecutable(name)
      } catch (e) {
        if (name === 'gh') {
          const envSrc =
            (opts && opts.env && typeof opts.env === 'object' && opts.env) ||
            (typeof process !== 'undefined' && process.env ? process.env : null)
          const fallback = envSrc && envSrc.DSH_GH_PATH ? envSrc.DSH_GH_PATH : ''
          if (!fallback) throw e
          try {
            const fs = ctx.get('fs')
            if (!fs || typeof fs.lstat !== 'function') throw e
            const info = await fs.lstat(fallback)
            if (info) return fallback
          } catch {
            throw e
          }
          throw e
        }
        throw e
      }
    },
  }
}
