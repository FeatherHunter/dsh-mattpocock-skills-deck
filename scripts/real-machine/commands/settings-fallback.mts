// settings-fallback —— 隔离失败时的替代动作：备份真实设置、按哈希恢复、取全局锁、释放全局锁。
//
// 用法（action 四选一）：
//   ... settings-fallback.mts --action backup   --out <备份目录> [--real-home <真实DSH_HOME>]
//   ... settings-fallback.mts --action restore  --backup <备份目录> [--force] [--real-home <真实DSH_HOME>]
//   ... settings-fallback.mts --action lock     --lock <锁目录> [--purpose 批次名]
//   ... settings-fallback.mts --action unlock   --lock <锁目录>
//   ... settings-fallback.mts --action fingerprint [--real-home <真实DSH_HOME>]
//
// 这些命令只在隔离探针结论为「隔离不住」时才需要；能隔离时不需要碰真实设置文件。

import { parseArgs, printJson, runCli } from '../lib/util.mts'
import { acquireGlobalLock, backupRealSettings, realSettingsFingerprint, releaseGlobalLock, restoreRealSettings } from '../lib/isolation.mts'

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const action = args.require('action', 'backup / restore / lock / unlock / fingerprint 之一')
  const realHome = args.get('real-home')
  if (action === 'backup') {
    printJson(backupRealSettings({ outDir: args.require('out', '备份目录'), realHome }))
    return
  }
  if (action === 'restore') {
    printJson(restoreRealSettings({ backupDir: args.require('backup', '备份目录'), realHome, force: args.has('force') }))
    return
  }
  if (action === 'lock') {
    printJson(acquireGlobalLock({ lockDir: args.require('lock', '锁目录'), purpose: args.get('purpose') }))
    return
  }
  if (action === 'unlock') {
    printJson(releaseGlobalLock(args.require('lock', '锁目录')))
    return
  }
  if (action === 'fingerprint') {
    printJson(realSettingsFingerprint(realHome))
    return
  }
  throw new Error('不认识的 --action「' + action + '」：只能是 backup、restore、lock、unlock、fingerprint。')
})
