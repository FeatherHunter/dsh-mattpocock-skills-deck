// global-lock —— 多人/多会话同时做真机验证时的互斥锁：拿锁、看锁、放锁。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/global-lock.mts --lock <锁目录>
//         [--purpose "批次 1645 双实例冒烟"]     拿锁
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/global-lock.mts --lock <锁目录> --release
//                                              放锁
//
// 输出：拿锁返回锁目录、所有者与时间；放锁返回是否真的删掉了。
// 为什么需要：真机验证会动真实 DSH home 的只读副本、占用端口与浏览器，两个人同时跑会互相干扰。
// 锁是 mkdir 原子创建的目录，里面的 owner.json 写明谁在什么时候拿了锁。

import { parseArgs, printJson, runCli } from '../lib/util.mts'
import { acquireGlobalLock, releaseGlobalLock } from '../lib/isolation.mts'

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const lockDir = args.require('lock', '锁目录，例如 <工作根>\\global.lock')
  if (args.has('release')) {
    printJson(releaseGlobalLock(lockDir))
    return
  }
  printJson(acquireGlobalLock({ lockDir, purpose: args.get('purpose') }))
})
