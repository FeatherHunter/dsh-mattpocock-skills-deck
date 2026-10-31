// 长任务记录的任务库（#1740）：把最近的任务写成一个整文件，供查询与重启后对账。
//
// 为什么是整文件而不是数据库：任务区只显示最近二十条，读写频率低；整文件写入天然是
// 原子替换之前的最小实现（先写全文、再落盘），不引入新依赖。代价是并发写会互相覆盖——
// 同一时间只有宿主进程一个写者，界面只读，因此可以接受。
//
// 三条安全约束写在这里，改之前先想清楚：
//   1. 只按 task-protocol 的 TASK_RECORD_FIELDS 白名单过滤字段。参数原文、输入文件内容、
//      原始路径都不许进文件；落盘前过滤是最后一道闸。
//   2. 路径来自调用方传入的目录；文件名固定前缀加仓库指纹，不让外部决定文件名。
//   3. 文件坏了当空任务库处理并继续，界面要能打开；不许因为一条坏记录让整个面板崩掉。
// @ts-expect-error 本域 tsconfig 有意不加载 Node 类型包（types 为空），运行时一定是 Node，这个内建模块必然存在
import path from 'node:path'
import { TASK_RECORD_FIELDS } from '../shared/version-control/src/task-protocol.js'

const FILE_PREFIX = 'vc-task-events__'
const FILE_SUFFIX = '.json'
const DEFAULT_LIMIT = 20

/** 按白名单挑字段：白名单之外的键一律不进任务库，这是「参数原文与文件内容不落盘」的最后一道闸。 */
function pickRecordFields(input: any): Record<string, any> {
  const out: Record<string, any> = {}
  if (!input || typeof input !== 'object') return out
  for (const key of TASK_RECORD_FIELDS) {
    if (input[key] !== undefined) out[key] = input[key]
  }
  return out
}

/** 一条记录至少要有任务 id 才算数；坏记录在读取时被过滤掉，不让它拖垮整个任务库。 */
function validRecord(rec: any): boolean {
  return !!rec && typeof rec === 'object' && typeof rec.taskId === 'string' && rec.taskId.length > 0 && rec.taskId.length <= 120
}

/**
 * 建一个任务库。deps.fs 是宿主文件服务（resolve/readText/writeText/mkdir/exists），
 * dir 是缓存目录的绝对路径，fileKey 是仓库指纹（同一仓库的任务放在同一个文件里）。
 */
export function createTaskStore(deps: any): any {
  const fs = deps.fs
  const dir: string = deps.dir
  const fileKey: string = String(deps.fileKey || 'root').replace(/[^A-Za-z0-9._-]/g, '') || 'root'
  const limit: number = Number.isInteger(deps.limit) && deps.limit > 0 ? deps.limit : DEFAULT_LIMIT
  const now: any = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const filePath: string = path.join(dir, FILE_PREFIX + fileKey + FILE_SUFFIX)
  let records: any[] = []
  let loaded: boolean = false
  let loading: Promise<void> | null = null

  async function ensureLoaded(): Promise<void> {
    if (loaded) return
    if (loading) return loading
    loading = (async (): Promise<void> => {
      try {
        if (await fs.exists(filePath)) {
          const text: any = await fs.readText(filePath)
          const parsed: any = JSON.parse(String(text || '{}'))
          const tasks: any[] = parsed && Array.isArray(parsed.tasks) ? parsed.tasks : []
          records = tasks.filter(validRecord).map(pickRecordFields).slice(0, limit)
        } else records = []
      } catch {
        // 坏文件或读不动都当空库：查询照常回空，下一次写入会覆盖成合法内容。
        records = []
      }
      loaded = true
    })()
    return loading
  }

  async function save(): Promise<boolean> {
    await ensureLoaded()
    try {
      await fs.mkdir(dir)
      const text: string = JSON.stringify({ version: 1, savedAt: now(), tasks: records })
      await fs.writeText(filePath, text)
      return true
    } catch {
      // 写不进去不让调用方崩：本次会话里记录还在内存里，重启后会标成中断，界面会如实说明。
      return false
    }
  }

  return {
    filePath,
    limit,
    async load(): Promise<any[]> { await ensureLoaded(); return records.slice() },
    async list(): Promise<any[]> { await ensureLoaded(); return records.slice() },
    async get(taskId: any): Promise<any> {
      await ensureLoaded()
      for (const rec of records) if (rec.taskId === taskId) return rec
      return null
    },
    async findByRequestId(requestId: any): Promise<any> {
      await ensureLoaded()
      if (typeof requestId !== 'string' || requestId.length === 0) return null
      for (const rec of records) if (rec.requestId === requestId) return rec
      return null
    },
    async put(record: any): Promise<any> {
      await ensureLoaded()
      const rec: any = pickRecordFields(record)
      if (!validRecord(rec)) return null
      const index: number = records.findIndex((item: any) => item.taskId === rec.taskId)
      if (index >= 0) records[index] = rec
      else records.unshift(rec)
      // 只留最近 limit 条：最旧的在数组末尾，从末尾丢，运行中的记录因为总是新写入而留在前面。
      if (records.length > limit) records = records.slice(0, limit)
      await save()
      return rec
    },
    async patch(taskId: any, fields: any): Promise<any> {
      await ensureLoaded()
      const index: number = records.findIndex((item: any) => item.taskId === taskId)
      if (index < 0) return null
      const merged: any = pickRecordFields({ ...records[index], ...(fields || {}) })
      records[index] = merged
      await save()
      return merged
    },
  }
}
