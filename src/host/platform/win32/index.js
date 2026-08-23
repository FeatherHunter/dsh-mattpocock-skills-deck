/**
 * platform/win32/index.js — Windows 适配器（通用层骨架）。
 *
 * 本票 (#130) 只做「通用层」——此处只提供 OS 专属原语（pathImpl / getHome / resolveExecutable），
 * 通用包装（getHome 缓存 / env 只读视图 / resolveExecutable throw→null / path 委托 node:path / fs 透传）
 * 由 `platform/index.js` 的 `composePlatform` **单点**提供，不在本文件重复。
 *
 * OS 专属行为（D2 win32 盘符护栏、resolveExecutable 别名 cmd→cmd.exe、gh→DSH_GH_PATH 兜底等）
 * 归 **win32 底座 map**（作为 #113 子票另行规划）；本票只留最小结构 + TODO 占位。
 */
import nodePath from 'node:path'

export default function win32Adapter(ctx) {
  void ctx
  return {
    os: 'win32',
    /** 路径数学委托 node:path.win32（各 OS 不得重实现；亦规避 PR #106 的路径分隔符回归）。 */
    pathImpl: nodePath.win32,
    /** 用户主目录（跨 OS 单点；win32 盘符护栏细节待 win32 底座 map）。 */
    async getHome() {
      // TODO(win32 底座 map)：D2 护栏——结果形态非 ^[A-Za-z]: 时回退 USERPROFILE → HOMEDRIVE+HOMEPATH。
      const os = await import('node:os')
      return os.homedir() || null
    },
    /** 包装 DSH subprocess.resolveExecutable；别名/环境变量覆盖细节待底座 map。 */
    async resolveExecutable(name) {
      const subprocess = ctx.get('subprocess')
      return subprocess.resolveExecutable(name)
    },
  }
}
