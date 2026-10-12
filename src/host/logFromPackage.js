// src/host/logFromPackage.js —— 宿主日志接线（#564 当前插件迁移到日志包，行为零变化）。
// 以后谁改它：改日志系统运行时走包还是走旧实现的人。改之前先看 #564 票：旧文件留而不搬。
// 接线：由 src/host/index.js 动态 import 加载（D7 禁止静态 import）；本文件只做一件事，
// 调日志包建日志库并拿回日志库（插件标识 wf，默认派生出的目录名、开关文件名、电话名与旧字面一致）。
// 旧实现（./logStore.js、./logPhones.js）原地只读留存，本文件不引用它们；包不可用时由调用方回退旧实现。
// 共存关系：旧文件只读、新文件派生，真搬迁或真删除旧文件另开票。
// 取哪一份（#1016 起）：这里直接 import 已安装的 npm 包 dsh-log 的宿主入口，
// 插件不再在自己的源码树里带一份上游代码副本（那份副本原先在 ./logPkg/，已随本次改动删除）。
// 宿主用哪一版由 package/package.json 里 pin 死的 dsh-log 版本说了算；客户端那半是构建时按同一个包
// 打包出来的，两半版本一致由 scripts/build.mjs 里的断言盯着，错配当场拦住构建。
export async function createLogFromPackage(deps) {
  const input = deps || {}
  const mod = await import('dsh-log/host')
  const holder = mod.createHostLog(
    {
      fs: input.fs,
      timer: input.timer,
      getCacheDir: input.getCacheDir,
      getPlatform: input.getPlatform,
      DEFAULT_CWD: input.DEFAULT_CWD,
    },
    { pluginId: 'wf' }
  )
  return holder.store
}
