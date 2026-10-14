/**
 * platform/win32/index.js — Windows 适配器（win32 底座定版 #161）。
 *
 * 定版来源：#129（平台原语接口）+ #160 G 票三裁决
 *  ① 护栏 ^[A-Za-z]:→USERPROFILE→HOMEDRIVE+HOMEPATH（#129 D2）/ 别名仅 cmd→cmd.exe / 路径全委托 node:path.win32。
 * 通用包装（getHome 缓存 / env 只读视图 / resolveExecutable throw→null / path 委托 node:path / fs 透传）
 * 由 `platform/index.js` 的 `composePlatform` 单点提供，不在此重复。
 */

// 本域 tsconfig 有意不加载任何类型包（types 为空），node:path / node:os 的类型声明随 @types/node
// 一起被挡在门外；运行时一定是 Node，这两个模块必然存在。所以只忽略导入这一行的类型错误
// （纯类型层面，不影响 esbuild 的运行时转译）——与 src/tracker/rooms/markdown/path.ts 同一写法。
// @ts-expect-error
import nodePath from 'node:path'
// @ts-expect-error
import nodeOs from 'node:os'

// 运行时的 process 声明：本文件最后一道兜底直接读 process.env，Node 运行时保证它存在；
// 本域 types 为空是既有口径（同 src/tracker/rooms/markdown/*.ts），所以只声明用到的 env 一个成员，
// 不挂 Node 类型包，也不产生运行时代码。
declare const process: { env: Record<string, string | undefined> }

const WIN32_GUARD_RE = /^[A-Za-z]:/
/** 别名表：查不到就原样透传，所以键类型写宽到字符串（运行时形状不变，仍是那个冻结对象）。 */
const ALIAS: Readonly<Record<string, string>> = Object.freeze({ cmd: 'cmd.exe' })

/** 宿主上下文的最小形状：适配器只从它取 subprocess 原语，外加两个测试注入点（#113/#131）。 */
type HostCtx = {
  get(name: 'subprocess'): { resolveExecutable(name: string): string | Promise<string> }
  _homedir?: () => string
  __homedir?: () => string
  _env?: Record<string, string | undefined>
  __env?: Record<string, string | undefined>
}

/** 适配器可选项：测试夹具用它注入 homedir / env；生产走 ctx 与 node:os、process.env。 */
type HostAdapterOpts = { homedir?: () => string; env?: Record<string, string | undefined> }

/**
 * 解析注入源（可测性前提 #113/#131）。
 * 测试侧可通过两种方式注入以使护栏分支单机可达：
 *  1) 直接传 opts：win32Adapter(ctx, { homedir: () => string, env })
 *  2) 经 composePlatform 的 opts 透传；或在 mock ctx 上挂 _homedir/_env（兼容旧夹具）。
 */
function resolveDeps(ctx: HostCtx | undefined, opts: HostAdapterOpts | undefined) {
  const o: HostAdapterOpts = opts && typeof opts === 'object' ? opts : {}
  const homedir: () => string =
    (typeof o.homedir === 'function' && o.homedir) ||
    (ctx && typeof ctx._homedir === 'function' && ctx._homedir) ||
    (ctx && typeof ctx.__homedir === 'function' && ctx.__homedir) ||
    (() => nodeOs.homedir())
  const env: Record<string, string | undefined> =
    (o.env && typeof o.env === 'object' && o.env) ||
    (ctx && ctx._env && typeof ctx._env === 'object' && ctx._env) ||
    (ctx && ctx.__env && typeof ctx.__env === 'object' && ctx.__env) ||
    process.env
  return { homedir, env }
}

export default function win32Adapter(ctx: HostCtx, opts?: HostAdapterOpts) {
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
    async resolveExecutable(name: string) {
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
      normalize: (t: string) => nodePath.win32.normalize(t),
      /** 含壳元字符（& | ^ % ! < >）一律拒绝，宁可诚实失败也不让 cmd 多执行半句。 */
      allowOpen: (t: string) => !/[&|^%!<>]/.test(t),
      /** 目录：start 显式可视直接打开看里面（数组直传，引号由调起层按需加，不手写）。 */
      folderArgs: (t: string) => ['/c', 'start', '', '/max', t],
      /**
       * 文件：先切到所在目录再按名选中（名内无空格与特殊字符才拼选中串，避开引号嵌套）。
       * 名内有空格或特殊字符时回 null，由通用层改开上级目录（看得见位置，不选中；注释写明不猜）。
       */
      fileArgs: (t: string) => {
        const base = nodePath.win32.basename(t)
        if (!/^[A-Za-z0-9._-]+$/.test(base)) return null
        return ['/c', 'start', '', '/max', '/d', nodePath.win32.dirname(t), 'explorer', '/select,' + base]
      },
    },
  }
}
