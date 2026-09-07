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
    /**
     * 本机可见打开配方（#497，OS 底座拥有）。
     * 宿主调起层常驻隐藏，直接拉资源管理器不可见；经 cmd start 显式可视（真机验证：/max 可见）。
     * 路径数学仍委托 node:path.win32，本配方只定“用哪个程序、拼什么参数”，不手写分隔符。
     */
    shellOpen: {
      opener: 'cmd',
      normalize: (t) => nodePath.win32.normalize(t),
      /** 含壳元字符（& | ^ % ! < >）一律拒绝，宁可诚实失败也不让 cmd 多执行半句。 */
      allowOpen: (t) => !/[&|^%!<>]/.test(t),
      /** 目录：start 显式可视直接打开看里面（数组直传，引号由调起层按需加，不手写）。 */
      folderArgs: (t) => ['/c', 'start', '', '/max', t],
      /**
       * 文件：先切到所在目录再按名选中（名内无空格与特殊字符才拼选中串，避开引号嵌套）。
       * 名内有空格或特殊字符时回 null，由通用层改开上级目录（看得见位置，不选中；注释写明不猜）。
       */
      fileArgs: (t) => {
        const base = nodePath.win32.basename(t)
        if (!/^[A-Za-z0-9._-]+$/.test(base)) return null
        return ['/c', 'start', '', '/max', '/d', nodePath.win32.dirname(t), 'explorer', '/select,' + base]
      },
    },
  }
}
