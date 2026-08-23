/**
 * platform/darwin/index.js — macOS 适配器（通用层骨架）。
 *
 * 本票 (#130) 只做「通用层」——此处只提供 OS 专属原语（pathImpl / getHome / resolveExecutable），
 * 通用包装（getHome 缓存 / env 只读视图 / resolveExecutable throw→null / path 委托 node:path / fs 透传）
 * 由 `platform/index.js` 的 `composePlatform` **单点**提供，不在本文件重复。
 *
 * OS 专属行为（D2 getHome POSIX 优先级、resolveExecutable 别名 sh→sh 等）归 **darwin 底座 map**
 * （作为 #113 子票另行规划）；本票只留最小结构 + TODO 占位。
 */
import nodePath from 'node:path'

export default function darwinAdapter(ctx) {
  void ctx
  return {
    os: 'darwin',
    /** 路径数学委托 node:path（POSIX；各 OS 不得重实现）。 */
    pathImpl: nodePath.posix,
    /** 用户主目录（跨 OS 单点；OS 专属优先级细节待 darwin 底座 map）。 */
    async getHome() {
      // TODO(darwin 底座 map)：D2 POSIX 优先级——os.homedir() 即 $HOME，归一化为本机路径形态。
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
