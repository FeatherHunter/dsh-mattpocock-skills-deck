/**
 * src/deck/shell/body-write.ts —— 写正文时「进度 + 维护者原话」的组合与写后核对（#1091）
 *
 * 为什么单独一份：两个写正文的工具（deck_issue_patch / deck_issue_create）要用同一套组合规则，
 * 而组合本身要同时引「进度区」与「维护者原话区」两份共享实现；放在这里，两个工具各自只剩几行调用。
 * 另一层原因与 tests/verify-file-granularity.ts 有关：issue-patch.ts 的有效行已经贴到 350 的上限，
 * 把纯计算搬到这份文件，工具那边才腾得出地方放参数与回执。
 *
 * 纯计算：不碰 ctx、不读盘、不读钟；正文从哪读、写后从哪读回，都由调用方负责。
 */
import { applyProgressEntry, progressReadbackProblem } from '../../shared/issue-file/src/progress.js'
import type { ProgressEntry } from '../../shared/issue-file/src/progress.js'
import { applyOriginalWordsEntry, originalWordsPresenceProblem, originalWordsReadbackProblem } from '../../shared/issue-file/src/original-words.js'
import type { OriginalWordsEntry } from '../../shared/issue-file/src/original-words.js'

/** 一次正文写入的计划：写下去的新正文 + 核对用的旧状态 + 这次点了哪几区。 */
export interface BodyWritePlan {
  /** 写下去的新正文；写后读回要与它逐字相同（两端空白不计：本地 Markdown 后端会重排正文两端）。 */
  next: string
  /** 这次要写的进度记录；没点进度时为 null。 */
  progress: ProgressEntry | null
  /** 这次要追加的原话；没点原话时为 null。 */
  originalWords: OriginalWordsEntry | null
  /** 写进度之前的那份正文（进度区核对用：去掉进度区后要与它逐字相同）。 */
  beforeProgress: string
  /** 这次原话是否因为「同一段原话 + 同一出处已经在正文里」而幂等跳过（跳过的条目不重复追加）。 */
  skipped: boolean
  /** 原话核对要不要连整份正文一起比：改票非整份替换时要比（只许追加），建票/整份替换时后端会套标题与字段，没法比整份。 */
  strictRoundTrip: boolean
}

/**
 * 把这次点到的区依次写进正文：先进度、再维护者原话。
 *
 * 顺序固定为「进度在前」：进度区永远在正文最后，原话区紧跟目的区，两块的位置规则互不干扰；
 * 反过来先写原话也能得到同样的正文，固定顺序只是让核对时的「写前正文」只有一种算法。
 *
 * @param limit 正文长度硬顶（与进度区共用 60KB 那一份值，由调用方传 PROGRESS_BODY_LIMIT）。
 * @param strictRoundTrip 写后核对要不要连整份正文一起比：改票（非整份替换）时要，建票时不要。
 * @returns plan 为空时 problem 说明为什么没写（正文一个字不动）；blocked 的写法与 #1090 一致。
 */
export function planBodyWrite(base: string, progress: ProgressEntry | null, originalWords: OriginalWordsEntry | null, limit: number, strictRoundTrip: boolean = false): { plan: BodyWritePlan | null; problem: string } {
  let next = base
  if (progress) {
    const planned = applyProgressEntry(next, progress)
    if (planned.next === null) return { plan: null, problem: planned.problem }
    next = planned.next
  }
  let skipped = false
  if (originalWords) {
    const planned = applyOriginalWordsEntry(next, originalWords, limit)
    if (planned.next === null) return { plan: null, problem: planned.problem }
    skipped = planned.skipped
    next = planned.next
  }
  return { plan: { next: next, progress: progress, originalWords: originalWords, beforeProgress: base, skipped: skipped, strictRoundTrip: strictRoundTrip }, problem: '' }
}

/**
 * 写后核对：返回空串表示核对通过；否则返回一句说清差在哪、并提醒「别当成已经写好」的话。
 *
 * 进度区：第一条记录逐项相同 + 去掉进度区后其余正文与写前逐字相同（#1090 的口径）。
 * 原话区：读回正文里要逐字找到这条原话 + 整份正文与计划里的新正文逐字相同（#1091 的门禁）。
 * 两个一起写时，进度区的「写前正文」按计划里的新正文算：原话区本来就在进度区外面，
 * 不这么算的话「其他正文逐字不变」会把刚写进去的原话区当成顺手动过的正文。
 */
export function bodyWriteReadbackProblem(plan: BodyWritePlan, body: string): string {
  if (plan.progress) {
    const beforeProgress = plan.originalWords ? plan.next : plan.beforeProgress
    const problem = progressReadbackProblem(plan.progress, body, beforeProgress)
    if (problem) return problem
  }
  if (plan.originalWords) {
    // 第一道在哪一路都要过：这一条原话本身必须逐字读得回来。
    const presence = originalWordsPresenceProblem(plan.originalWords, body)
    if (presence) return presence
    // 第二道只在「后端不会重排整份文件」的那一路加：只许追加，别处一个字都不该动。
    if (plan.strictRoundTrip) return originalWordsReadbackProblem(plan.originalWords, body, plan.next)
  }
  return ''
}

/** 这次写正文点了哪几区：写后核对那一步的 fields（与 #1090 的写法一致，模型按它看得懂核对过什么）。 */
export function bodyWriteFields(plan: BodyWritePlan): string[] {
  const fields: string[] = []
  if (plan.progress) fields.push('progress')
  if (plan.originalWords) fields.push('originalWords')
  return fields
}
