// 长任务通道的宿主接线叶子（#1740）：把运行器、任务库与执行层三块拼起来，向入口暴露三条电话。
//
// 三块各自的边：
//   1. 任务库（versionControlTaskStore）只认注入的 fs 门面与缓存目录，自己不解析路径；
//   2. 运行器（versionControlTaskRun）不自己起进程，命令拼装来自 task-protocol，进程出口由
//      versionControl.ts 的 launchTaskGit 注入（固定前缀、GIT_EDITOR、-C 钉仓库、报闸都在那一层）；
//   3. 这个叶子把宿主 fs 门面适配成任务库要的形状（fs 服务的读写要求先 resolve 出 target），
//      并在首次调用时把上一进程留下的在途记录标成中断。
//
// 三条不能改的约定：
//   - 任务记录只落缓存目录，不落仓库工作区；参数原文与输入文件内容不进记录文件；
//   - 运行器同一个进程只建一次（在途表只有一份，重建会把在途任务当成不存在）；
//   - 任何装配失败都回固定失败信封，不让入口抛出未处理异常（面板要能打开、能看见原因）。

import { failPhone, firstLine } from '../shared/version-control/exec-envelope.js'
import { createTaskStore } from './versionControlTaskStore.js'
import { createTaskRunner } from './versionControlTaskRun.js'
import { VC_TASK_POLL_INTERVAL_MS, VC_TASK_CANCEL_GRACE_MS, VC_TASK_HARD_KILL_MS } from '../shared/time-config/src/values.js'

// 查询进度的节奏：太密会白读收集器，太稀会让界面上的百分比一跳一大段。值住中央 YAML。
export const TASK_POLL_MS: number = Math.max(100, Number(VC_TASK_POLL_INTERVAL_MS) || 400)
const TASK_FILE_KEY = 'tasks'
// 任务文件只留最近二十条：任务区一屏放得下，再多也没有人回头看。
const TASK_KEEP = 20

/**
 * 任务库要的 fs 形状：读写前先 resolve 出 fs 服务的 target 对象（直接传路径字符串会被拒绝），
 * 四个方法都对不存在与不可读做兜底——任务记录坏了最多丢一条，不许让面板打不开。
 */
function makeFsFace(face: any): any {
  async function targetOf(p: string): Promise<any> {
    if (face && typeof face.resolve === 'function') return await face.resolve(p)
    return p
  }
  return {
    async exists(p: string): Promise<boolean> {
      try { return !!(await face.exists(await targetOf(p))) } catch (e) {
        try { return !!(await face.exists(p)) } catch (e2) { return false }
      }
    },
    async readText(p: string): Promise<string> {
      const target = await targetOf(p)
      return String((await face.readText(target)) || '')
    },
    async writeText(p: string, text: string): Promise<void> {
      const target = await targetOf(p)
      await face.writeText(target, text)
    },
    async mkdir(p: string): Promise<void> {
      if (!face || typeof face.mkdir !== 'function') return
      try { await face.mkdir(await targetOf(p), { recursive: true }) } catch (e) {
        try { await face.mkdir(p) } catch (e2) { /* 已存在或不可建，写文件时会再报一次并被任务库兜住 */ }
      }
    },
  }
}

/** 取缓存目录（宿主 getCacheDir 是异步口）；拿不到就回空串——任务库写盘会失败，但内存里照常可用。 */
async function cacheDirOf(deps: any): Promise<string> {
  try {
    const dir = await Promise.resolve(typeof deps.getCacheDir === 'function' ? deps.getCacheDir() : null)
    return typeof dir === 'string' ? dir : ''
  } catch (e) { return '' }
}

export function createTaskChannel(deps: any): any {
  const d = deps || {}
  let runnerP: Promise<any> | null = null
  function runner(): Promise<any> {
    if (!runnerP) {
      runnerP = (async function (): Promise<any> {
        const dir = await cacheDirOf(d)
        const store = createTaskStore({ fs: makeFsFace(d.fs), dir: dir, fileKey: TASK_FILE_KEY, now: d.now, limit: TASK_KEEP })
        const r = createTaskRunner({
          store: store,
          launch: d.launch,
          prepareStdinFile: d.prepareStdinFile,
          timer: d.timer,
          now: d.now,
          hash8: d.hash8,
          instanceId: d.instanceId,
          repoRoot: d.repoRoot,
          fire: d.fire,
          // 软取消宽限与强杀等待值住中央 YAML；下限兜住配置写坏时变成 0 的情况。
          graceMs: Math.max(1000, Number(VC_TASK_CANCEL_GRACE_MS) || 5000),
          hardKillMs: Math.max(500, Number(VC_TASK_HARD_KILL_MS) || 2000),
        })
        // 上一进程留下的在途记录在这里统一标成中断：只做一次，标完不会再变。
        await r.resumeInterrupted()
        return r
      })()
      runnerP.catch(function (): void { runnerP = null })
    }
    return runnerP
  }
  async function call(method: string, args: any): Promise<any> {
    try {
      const r: any = await runner()
      return await r[method](args)
    } catch (e) {
      return failPhone('env', '长任务通道装配失败：' + firstLine(String(((e as any) && (e as any).message) || (e as any))))
    }
  }
  return {
    // 三条电话：开始、查询、取消。会话工作区由调用方给 cwd；没给就用宿主默认目录（与写命令同一口径）。
    handleGitTaskStart: function (args: any): Promise<any> { return call('start', args) },
    handleGitTaskQuery: function (args: any): Promise<any> { return call('query', args) },
    handleGitTaskCancel: function (args: any): Promise<any> { return call('cancel', args) },
  }
}

export default createTaskChannel
