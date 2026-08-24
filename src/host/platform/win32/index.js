/**
 * platform/win32/index.js — Windows 适配器（win32 底座定版 #161）。
 *
 * 定版来源：#129（平台原语接口）+ #160 G 票三裁决
 *  ① 护栏 ^[A-Za-z]:→USERPROFILE→HOMEDRIVE+HOMEPATH（#129 D2）/ 别名仅 cmd→cmd.exe / 路径全委托 node:path.win32。
 * 通用包装（getHome 缓存 / env 只读视图 / resolveExecutable throw→null / path 委托 node:path / fs 透传）
 * 由 `platform/index.js` 的 `composePlatform` 单点提供，不在此重复。
 */

import nodePath from 'node:path'
import nodeOs from 'node:os'

const WIN32_GUARD_RE = /^[A-Za-z]:/
const ALIAS = Object.freeze({ cmd: 'cmd.exe' })

/**
 * 解析注入源（可测性前提 #113/#131）。
 * 测试侧可通过两种方式注入以使护栏分支单机可达：
 *  1) 直接传 opts：win32Adapter(ctx, { homedir: () => string, env })
 *  2) 经 composePlatform 的 opts 透传；或在 mock ctx 上挂 _homedir/_env（兼容旧夹具）。
 */
function resolveDeps(ctx, opts) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const homedir =
    (typeof o.homedir === 'function' && o.homedir) ||
    (ctx && typeof ctx._homedir === 'function' && ctx._homedir) ||
    (ctx && typeof ctx.__homedir === 'function' && ctx.__homedir) ||
    (() => nodeOs.homedir())
  const env =
    (o.env && typeof o.env === 'object' && o.env) ||
    (ctx && ctx._env && typeof ctx._env === 'object' && ctx._env) ||
    (ctx && ctx.__env && typeof ctx.__env === 'object' && ctx.__env) ||
    process.env
  return { homedir, env }
}

export default function win32Adapter(ctx, opts) {
  const { homedir, env } = resolveDeps(ctx, opts)
  return {
    os: 'win32',
    /** 路径数学全委托 node:path.win32（零自实现；规避 PR #106 分隔符回归）。 */
    pathImpl: nodePath.win32,
    /** 用户主目录：主源 os.homedir()，形态非 ^[A-Za-z]: 时回退 USERPROFILE → HOMEDRIVE+HOMEPATH；不读 HOME。 */
    async getHome() {
      let primary = ''
      try {
        const v = homedir()
        primary = v == null ? '' : String(v)
      } catch {
        primary = ''
      }
      if (primary && WIN32_GUARD_RE.test(primary)) return primary
      const up = env.USERPROFILE
      if (up) return up
      const drive = env.HOMEDRIVE || ''
      const homePath = env.HOMEPATH || ''
      const combined = drive + homePath
      if (combined) return combined
      return null
    },
    /** 包装 DSH subprocess.resolveExecutable；别名仅 cmd→cmd.exe（sh 不映射，gh 不进表）。 */
    async resolveExecutable(name) {
      const mapped = ALIAS[name] ?? name
      const subprocess = ctx.get('subprocess')
      return subprocess.resolveExecutable(mapped)
    },
  }
}
