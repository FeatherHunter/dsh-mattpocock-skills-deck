/**
 * platform/darwin/index.js — macOS 适配器（#165 落地，#164 G 决议定版）。
 *
 * 不变量（第一性原理 · 源自 #129 D2 + #164 选 A）：
 *   D1 getHome 主源 = `os.homedir() || null`，不二次读 process.env.HOME 第二真相（#129 POSIX 直接采用；重复读 env 属契约修订）。
 *   D2 兜底链全部由 os.homedir 内部承载（HOME → getpwuid(pw_dir)），失败仅剩 try/catch → null；H5 抛异常归一为 null。
 *   D3 别名仅 sh→sh 恒等；cmd/cmd.exe 在 darwin 不生效（预期 null）；gh 不做别名，PATH 失败仅透传 null。
 *   D4 gh 的 homebrew/nix DSH_GH_PATH 兜底由上层 resolveGh 承载，平台层不硬编码 /opt/homebrew/bin。
 *   D5 路径形态全量委托 node:path.posix（sep='/'），零自实现（沿 #113 D1）；joinHome = path.join(await getHome(), ...segs)。
 *   D6 反斜杠在 darwin 是合法文件名字符，不作分隔符；deck 永不 home+'\\'+dir。
 *
 * v1.7.2（fix/skill-probe-fallback-and-list）· D1 例外条款：
 *   Electron 主进程在某些升级/重启窗口期内，`os.homedir()` 返回空字符串（HOME 未就绪），
 *   会导致 probeSkill 整段 fs 探测被跳过，UI 全员报「未安装」。fallback 在主源空时读取
 *   `process.env.HOME`（仅当主源为空或抛错）——不违反「主源单一真相」原则（fallback 不覆盖正常结果）。
 *   修复后 D1 在「主源有真值」时仍 100% 适用；仅「主源空/抛」时才让 env 兜底。
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

export default function darwinAdapter(ctx, opts) {
  const homedir = resolveHomedir(ctx, opts)
  // v1.7.2：D1 例外条款——主源空时读 process.env.HOME 兜底（仅 darwin；win32 由 win32 adapter 自行处理 USERPROFILE/HOMEDRIVE）
  const envFallback = () => {
    try { return (process && process.env && (process.env.HOME || process.env.USERPROFILE)) || '' } catch { return '' }
  }
  return {
    os: 'darwin',
    /** 路径数学全委托 node:path.posix（零自实现；各 OS 不得重实现）。 */
    pathImpl: nodePath.posix,
    /** getHome：os.homedir() 主源；空串/抛错时回退 process.env.HOME（v1.7.2 例外条款） */
    async getHome() {
      try {
        return homedir() || envFallback() || null
      } catch {
        try { return envFallback() || null } catch { return null }
      }
    },
    /**
     * resolveExecutable：按 #164 G 决议 D3/D4
     * - 别名表仅 sh→sh 恒等，直透 DSH subprocess 解析结果。
     * - 找不到时 throw → 由通用层 composePlatform 转 null；平台层不叠加 DSH_GH_PATH 兜底。
     */
    async resolveExecutable(name) {
      const subprocess = ctx.get('subprocess')
      return subprocess.resolveExecutable(name)
    },
  }
}
