// verify/scenarios/1854-log-fs-port.ts —— 真机验证 #1854：宿主日志拿到能力齐全的文件服务之后，
// 5MB 封存与 14 天保留清理真的会执行，而且行真的落进当日文件。
//
// 背景（一句话）：插件把 DSH 平台文件服务递给 dsh-log，平台服务没有 appendText / rename / unlink / sizeOf
// 这四格能力，日志库于是每次刷盘都把整份日志读出来、拼上新行、再整份写回去，封存与清理静默失效；
// 2026-11-03 单日日志长到 180MB，把宿主堆拖爆。修复是建库前探测这四格能力，缺任一就换用 dsh-log/node
// 的 Node 文件服务，并把平台对象收窄成只含 os 与 path.join。
//
// 这一条场景验的是「装进真实实例之后的行为」，不是门禁里的桩：起一个隔离的 web profile 实例，
// 在宿主启动前（prepareHome 那一刻）做两件前置：
//   1. 把当日日志垫到 5MB 阈值之下（贴着阈值停），让宿主的第一笔刷盘正好把它顶过阈值；
//   2. 放一份 20 天前的旧日志，它早于 14 天保留窗口，应当被清掉。
// 然后看宿主自己的刷盘结果：
//   - 当日文件被改名成 `<日期>.1.log` 封存件（这一步只有 rename 能做成）；
//   - 新当日文件从头开始写，里面有 host.start 行（追加路要 appendText 与 sizeOf 都齐全才成立）；
//   - 任何文件里都没有 log.rotate.degraded 行（旧接线在同一个位置会记 reason=no-rename）；
//   - 20 天前的旧日志被删掉、audit.json 记了 retain.evict（这一步只有 unlink 能做成）；
//   - 日志目录里不出现 `[object Object]` 这种名字（平台目标对象与 Node 服务混用时会被字符串化）。
//
// 为什么要把文件垫到阈值之下、而不是等它自然长到 5MB：5MB 是日志包的默认阈值（DEFAULT_MAX_SIZE），
// 靠界面操作攒够 5MB 要几个小时，场景等不起。垫料是前置条件，不是被验的行为——被验的是
// 「宿主手里已经有一份 5MB 的当日文件时，能不能封存、能不能清理」，与这份文件是怎么长到 5MB 的无关。
// 旧接线下同一份垫料会得到 log.rotate.degraded（reason=no-rename）、没有封存件、旧日志不删。
//
// 手动跑法（工作根与批次 home 换成你自己的）：
//   $env:DSH_HOME='<批次 home>'
//   node node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js `
//     run verify/scenarios/1854-log-fs-port.ts --profile web --work-root <工作根> --json

import fs from 'node:fs'
import path from 'node:path'
import { defineScenario } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import type { ScenarioContext, ScenarioLaunchHookInfo, ScenarioObservation } from 'dsh-featherhunter-plugin-base/real-machine-verification'

/** 插件缓存目录名：与 verify/profile.ts 的 pluginCacheDir、插件宿主的落盘规则是同一处约定。 */
const PLUGIN_CACHE_DIR = '.dsh-mattskillsdeck-cache'
/** 日志包的单文件封存阈值（dsh-log 的 DEFAULT_MAX_SIZE，5MB）。 */
const SEAL_THRESHOLD_BYTES = 5 * 1024 * 1024
/**
 * 垫料目标：贴着阈值停（整行写，所以实际比阈值低不到一行的量），宿主下一笔刷盘就正好把它顶过去。
 * 为什么不留几 KB 的余量：实测宿主启动后的第一笔刷盘只有 1KB 左右，留 8KB 余量时这一笔顶不过阈值，
 * 之后实例空闲、不再有刷盘，封存就一直等不到。贴着阈值停时「下一笔追加跨过阈值」这个条件必然成立。
 */
const PAD_TARGET_BYTES = SEAL_THRESHOLD_BYTES - 1
/** 日志包的保留天数（dsh-log 的 DEFAULT_MAX_DAYS，含当日）。 */
const KEEP_DAYS = 14
/** 旧日志放在多少天前：必须早于保留窗口，才该被清掉。 */
const EXPIRED_DAYS_AGO = KEEP_DAYS + 6
/** 垫料行的事件名单独起一个，读日志的人一眼看出这不是插件写的行。 */
const PAD_EVENT = 'verify.1854.pad'
const DEGRADED_EVENT = 'log.rotate.degraded'
const SEAL_EVENT = 'log.rotate.seal'
const AUDIT_FILE = 'audit.json'
/** 等宿主第一笔刷盘落地的上限；正常两三秒就够，这里给足余量。 */
const WAIT_LIMIT_MS = 90000
const POLL_MS = 500

interface LogRow {
  readonly event: string
  readonly level: string
  readonly fields: Record<string, unknown>
}

interface SeededLogs {
  readonly dir: string
  /** 当日可写文件名（YYYY-MM-DD.log），封存件是它加 `.1`。 */
  readonly todayName: string
  /** 垫进去的字节数：封存件的长度应当与它完全相等（改名不动字节）。 */
  readonly padBytes: number
  /** 20 天前的旧日志文件名，应当被保留清理删掉。 */
  readonly expiredName: string
}

/** 启动钩子种下的东西留给后面的步骤断言；场景是一个进程，用模块级变量传递即可。 */
let seeded: SeededLogs | null = null

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** 本地日期串（插件按本地日期给日志文件起名，这里必须用同一口径）。 */
function localDateString(date: Date): string {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return year + '-' + month + '-' + day
}

function daysAgoDateString(days: number): string {
  return localDateString(new Date(Date.now() - days * 24 * 60 * 60 * 1000))
}

/** Windows 上路径比较不区分大小写，斜杠方向也不参与。 */
function samePath(left: string, right: string): boolean {
  if (!left || !right) return false
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
}

/** 读一份日志文件：逐行解析，坏行计数不抛错（日志正在被写时读到半行是常态）。 */
function readRows(file: string): { rows: LogRow[]; badLines: number; bytes: number; text: string } {
  const text = fs.readFileSync(file, 'utf8')
  const rows: LogRow[] = []
  let badLines = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      rows.push({
        event: String(parsed.event ?? ''),
        level: String(parsed.level ?? ''),
        fields: (parsed.fields && typeof parsed.fields === 'object' ? parsed.fields : {}) as Record<string, unknown>,
      })
    } catch {
      badLines += 1
    }
  }
  return { rows, badLines, bytes: Buffer.byteLength(text, 'utf8'), text }
}

/**
 * 在整份文件里数几个字面出现了多少次。封存件有 5MB，整份读进内存没必要，
 * 按 4MB 分块扫，块与块之间留一行重叠，避免把跨块的字面漏掉。
 */
function countTokens(file: string, tokens: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const token of tokens) counts[token] = 0
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const buffer = Buffer.alloc(4 * 1024 * 1024)
    let position = 0
    let carry = ''
    while (position < size) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, position)
      if (read <= 0) break
      position += read
      const text = carry + buffer.toString('utf8', 0, read)
      for (const token of tokens) {
        let from = 0
        for (;;) {
          const at = text.indexOf(token, from)
          if (at < 0) break
          counts[token] += 1
          from = at + token.length
        }
      }
      // 只保留尾部一小段：被切断的字面最多跨一个块边界，长度不会超过 token 本身。
      carry = text.slice(Math.max(0, text.length - 64))
    }
  } finally {
    fs.closeSync(fd)
  }
  return counts
}

/** 目录清单（只读名字与长度，不递归）。 */
function listDirectory(dir: string): Array<{ name: string; bytes: number }> {
  try {
    return fs
      .readdirSync(dir)
      .map((name) => {
        const abs = path.join(dir, name)
        let bytes = 0
        try {
          bytes = fs.statSync(abs).size
        } catch {
          bytes = -1
        }
        return { name, bytes }
      })
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  } catch {
    return []
  }
}

/**
 * 宿主启动前的唯一窗口：home 已经复制好、实例目录已经建好、宿主进程还没起。
 * 在这里把当日日志垫到阈值之下，并放一份过期的旧日志——宿主启动后第一笔刷盘就会读到它们。
 */
function seedLogDirectory(info: ScenarioLaunchHookInfo): void {
  // 宿主进程的当前目录是实例目录下的 workdir（base 的启动记录里写的是 workdir），不是实例目录本身：
  // 插件把日志写在「DSH 进程当前目录」下，所以垫料也必须落在这里。
  const dir = path.join(info.dir, 'workdir', PLUGIN_CACHE_DIR, 'logs')
  fs.mkdirSync(dir, { recursive: true })
  const todayName = localDateString(new Date())
  const padPath = path.join(dir, todayName + '.log')
  const now = Date.now()
  const parts: string[] = []
  let bytes = 0
  let index = 0
  for (;;) {
    const row = JSON.stringify({
      v: 3,
      ts: now,
      level: 'info',
      event: PAD_EVENT,
      fields: { i: index, note: '真机验证垫料：把当日日志顶到 5MB 封存阈值之下，不是插件写的行' },
    }) + '\n'
    const rowBytes = Buffer.byteLength(row, 'utf8')
    // 只在「写完这一行仍不超过目标」时才写：垫出来的文件一定落在阈值之下，下一笔追加才会跨过它。
    if (bytes + rowBytes > PAD_TARGET_BYTES) break
    parts.push(row)
    bytes += rowBytes
    index += 1
  }
  fs.writeFileSync(padPath, parts.join(''), 'utf8')

  const expiredName = daysAgoDateString(EXPIRED_DAYS_AGO) + '.log'
  fs.writeFileSync(
    path.join(dir, expiredName),
    JSON.stringify({
      v: 3,
      ts: now,
      level: 'info',
      event: PAD_EVENT,
      fields: { i: -1, note: EXPIRED_DAYS_AGO + ' 天前的旧日志：早于 14 天保留窗口，应当被清理删掉' },
    }) + '\n',
    'utf8',
  )

  seeded = { dir, todayName, padBytes: bytes, expiredName }
  console.log(
    '[1854] 垫料写好：' + padPath + '（' + String(bytes) + ' 字节，阈值 ' + String(SEAL_THRESHOLD_BYTES) + ' 字节）；过期文件 ' + expiredName,
  )
}

export default defineScenario<ScenarioContext>({
  id: 'log-fs-port-1854',
  title: '宿主日志在真实实例里封存、清理并继续写进新文件',
  description:
    '在宿主启动前把当日日志垫到 5MB 阈值之下并放一份 20 天前的旧日志，然后检查宿主第一笔刷盘的结果：当日文件被改名成封存件、新当日文件里有 host.start、没有 log.rotate.degraded、旧日志被清掉且 audit.json 记了 retain.evict、目录里没有 [object Object] 这种名字。',
  hooks: {
    prepareHome: (_context, info) => {
      seedLogDirectory(info)
    },
  },
  steps: [
    {
      id: 'launch',
      kind: 'launch',
      title: '起一个隔离的 web profile 实例（启动前已垫好当日日志与一份过期日志）',
    },
    {
      id: 'log-fs-port',
      kind: 'custom',
      title: '宿主第一笔刷盘把当日文件封存、清掉过期日志，并继续写进新文件',
      run: async (context) => {
        const observations: ScenarioObservation[] = []
        const instance = context.instance ?? context.instances[0] ?? null
        if (instance === null || seeded === null) {
          observations.push({
            checkId: 'log-dir-seeded',
            title: '场景拿到了实例，并且启动前确实种过日志目录',
            ok: false,
            status: 'blocked',
            detail: '没有实例句柄或没有种子记录：instance=' + String(instance !== null) + '，seeded=' + String(seeded !== null),
            expected: '一个启动成功的实例，以及 prepareHome 钩子留下的种子记录',
            actual: 'instance=' + String(instance !== null) + '，seeded=' + String(seeded !== null),
            hint: '先看 launch 那一步的观测；钩子没跑说明场景没有把 prepareHome 交给 launch',
          })
          return observations
        }

        // 一、先确认宿主真的把日志写在我们垫过的那份目录里：目录对不上，后面的断言都无从谈起。
        const actualDir = String(instance.record.pluginLogDir ?? '')
        const dirMatches = samePath(actualDir, seeded.dir)
        observations.push({
          checkId: 'log-dir-is-seeded-one',
          title: '宿主写日志的目录就是启动前垫过的那份',
          ok: dirMatches,
          status: dirMatches ? undefined : 'blocked',
          detail: '实例记录的插件日志目录：' + (actualDir || '(空)') + '；垫料目录：' + seeded.dir,
          expected: '两者是同一个目录',
          actual: dirMatches ? '一致' : '不一致',
          hint: '插件日志写在「DSH 进程当前目录」下的 ' + PLUGIN_CACHE_DIR + '/logs；目录不一致说明启动目录不是实例目录，垫料落到了别处',
        })
        if (!dirMatches) return observations

        // 二、等宿主第一笔刷盘把垫过的文件顶过阈值。封存是这一笔里做的，等封存件出现即可。
        const sealedName = seeded.todayName + '.1.log'
        const sealedPath = path.join(seeded.dir, sealedName)
        const currentPath = path.join(seeded.dir, seeded.todayName + '.log')
        const expiredPath = path.join(seeded.dir, seeded.expiredName)
        const auditPath = path.join(seeded.dir, AUDIT_FILE)
        const startedAt = Date.now()
        while (!fs.existsSync(sealedPath) && Date.now() - startedAt < WAIT_LIMIT_MS) {
          await sleep(POLL_MS)
        }
        const waitedMs = Date.now() - startedAt
        const sealedExists = fs.existsSync(sealedPath)
        const sealedBytes = sealedExists ? fs.statSync(sealedPath).size : -1
        const entries = listDirectory(seeded.dir)

        // 三、把两份文件都读一遍：当日文件要行行能解析，封存件只数字面（5MB 没必要解析成对象）。
        const current = fs.existsSync(currentPath) ? readRows(currentPath) : { rows: [] as LogRow[], badLines: 0, bytes: 0, text: '' }
        const sealedCounts = sealedExists ? countTokens(sealedPath, [DEGRADED_EVENT, SEAL_EVENT, PAD_EVENT]) : null
        const currentCounts = countTokens(currentPath, [DEGRADED_EVENT, SEAL_EVENT])
        const degradedTotal = (currentCounts[DEGRADED_EVENT] ?? 0) + (sealedCounts === null ? 0 : sealedCounts[DEGRADED_EVENT] ?? 0)

        const sealRow = current.rows.find((row) => row.event === SEAL_EVENT) ?? null
        const startRow = current.rows.find((row) => row.event === 'host.start') ?? null
        const auditText = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, 'utf8') : ''
        const objectObjectEntries = entries.filter((entry) => entry.name.indexOf('[object Object]') >= 0)
        const objectObjectRows = current.text.indexOf('[object Object]') >= 0 ? 1 : 0

        const facts = {
          waitedMs,
          logDir: seeded.dir,
          entries,
          paddedBytes: seeded.padBytes,
          sealThresholdBytes: SEAL_THRESHOLD_BYTES,
          sealedName,
          sealedExists,
          sealedBytes,
          sealedCounts,
          currentCounts,
          currentBytes: current.bytes,
          currentRows: current.rows.length,
          currentBadLines: current.badLines,
          sealRow: sealRow === null ? null : sealRow.fields,
          hostStart: startRow === null ? null : startRow.fields,
          expiredName: seeded.expiredName,
          expiredStillThere: fs.existsSync(expiredPath),
          auditPresent: auditText.length > 0,
          auditHasSeal: auditText.indexOf('rotate.seal') >= 0,
          auditHasEvict: auditText.indexOf('retain.evict') >= 0,
          auditText: auditText.slice(0, 2000),
        }
        const saved = await context.evidence.recordJson('log-dir-facts.json', facts, {
          note: '宿主第一笔刷盘前后的日志目录事实：垫料字节数、封存件、当日文件行、audit.json、过期文件是否还在',
        })
        const evidence = saved.ok ? [saved.value.path] : []

        // 四、逐条断言。每一条都写清期望与实际的差别，失败时不用回来看代码。
        observations.push({
          checkId: 'seal-file-appeared',
          title: '当日文件被改名成封存件 <日期>.1.log',
          ok: sealedExists,
          detail: '等了 ' + String(waitedMs) + ' 毫秒；封存件 ' + sealedName + (sealedExists ? ' 在，' + String(sealedBytes) + ' 字节' : ' 没有出现') + '；目录里有：' + entries.map((entry) => entry.name).join(', '),
          expected: '日志目录里出现 ' + sealedName,
          actual: sealedExists ? '出现' : '没有出现',
          hint: '没有封存件说明 rename 能力不可用：旧接线会退化成「继续往同一个文件里追加」，并记一行 log.rotate.degraded',
          evidence,
        })
        observations.push({
          checkId: 'seal-kept-every-byte',
          title: '封存件的字节数与垫进去的完全相等（是改名搬走，不是复制截断）',
          ok: sealedExists && sealedBytes === seeded.padBytes,
          detail: '封存件 ' + String(sealedBytes) + ' 字节；垫进去 ' + String(seeded.padBytes) + ' 字节',
          expected: String(seeded.padBytes) + ' 字节',
          actual: String(sealedBytes) + ' 字节',
          hint: '字节数不等说明封存不是同目录改名；日志包明确禁止「复制+截断」冒充原子封存，那会在中途失败时真丢数据',
          evidence,
        })
        observations.push({
          checkId: 'no-degrade-row',
          title: '日志里没有 log.rotate.degraded（封存没有降级）',
          ok: degradedTotal === 0,
          detail: '当日文件里 ' + String(currentCounts[DEGRADED_EVENT] ?? 0) + ' 行，封存件里 ' + String(sealedCounts === null ? 0 : sealedCounts[DEGRADED_EVENT] ?? 0) + ' 行',
          expected: '0 行',
          actual: String(degradedTotal) + ' 行',
          hint: '这一行是旧接线的证据（reason=no-rename）。出现它就说明宿主又把平台文件服务递给了日志库',
          evidence,
        })
        observations.push({
          checkId: 'seal-row-recorded',
          title: '当日文件里有一行 log.rotate.seal，写清封存了哪个文件、叫什么',
          ok: sealRow !== null && String(sealRow.fields.sealed ?? '') === sealedName,
          detail: sealRow === null ? '没有 log.rotate.seal 行' : 'sealed=' + String(sealRow.fields.sealed ?? '') + '，file=' + String(sealRow.fields.file ?? '') + '，bytes=' + String(sealRow.fields.bytes ?? ''),
          expected: '一行 log.rotate.seal，sealed=' + sealedName,
          actual: sealRow === null ? '(没有)' : 'sealed=' + String(sealRow.fields.sealed ?? ''),
          hint: '封存成功必须留一行 info 自监控；没有它说明封存走了别的分支',
          evidence,
        })
        observations.push({
          checkId: 'new-file-continues',
          title: '新当日文件从头写起：有 host.start 行，行行能解析，长度回到 KB 级',
          ok: startRow !== null && current.badLines === 0 && current.bytes > 0 && current.bytes < SEAL_THRESHOLD_BYTES,
          detail: '当日文件 ' + String(current.bytes) + ' 字节、' + String(current.rows.length) + ' 行、坏行 ' + String(current.badLines) + '；host.start ' + (startRow === null ? '没有' : '有'),
          expected: 'host.start 存在，坏行 0，字节数远小于 5MB',
          actual: String(current.bytes) + ' 字节，坏行 ' + String(current.badLines),
          hint: '没有 host.start 说明宿主没有再往新文件写；坏行说明写入把行切断了（追加路按行边界切块就是为了防这个）',
          evidence,
        })
        observations.push({
          checkId: 'expired-log-evicted',
          title: '20 天前的旧日志被 14 天保留清理删掉',
          ok: !fs.existsSync(expiredPath),
          detail: '过期文件 ' + seeded.expiredName + (fs.existsSync(expiredPath) ? ' 还在' : ' 已删掉'),
          expected: '被删掉',
          actual: fs.existsSync(expiredPath) ? '还在' : '已删掉',
          hint: '没删说明 unlink 能力不可用，保留清理被静默跳过（旧接线就是这样，日志目录会无限长大）',
          evidence,
        })
        observations.push({
          checkId: 'audit-records-both-ops',
          title: 'audit.json 记下了封存与清理两笔操作',
          ok: facts.auditHasSeal && facts.auditHasEvict,
          detail: 'audit.json ' + (facts.auditPresent ? '在' : '不在') + '；rotate.seal ' + String(facts.auditHasSeal) + '，retain.evict ' + String(facts.auditHasEvict),
          expected: '两笔都在',
          actual: 'rotate.seal=' + String(facts.auditHasSeal) + '，retain.evict=' + String(facts.auditHasEvict),
          hint: 'audit.json 是封存与清理的账本；缺哪一笔就说明那一步没真正执行',
          evidence,
        })
        observations.push({
          checkId: 'no-object-object-target',
          title: '日志目录与当日文件里都没有 [object Object] 这种目标名',
          ok: objectObjectEntries.length === 0 && objectObjectRows === 0,
          detail: '目录里 ' + String(objectObjectEntries.length) + ' 个名字带它；当日文件里 ' + String(objectObjectRows) + ' 处',
          expected: '0 个名字、0 处',
          actual: String(objectObjectEntries.length) + ' / ' + String(objectObjectRows),
          hint: '平台目标对象与 Node 服务混用时会被字符串化，日志会写到一个叫 [object Object] 的文件里；切换分支必须把平台对象剥成只含 os 与 path.join',
          evidence,
        })

        return observations
      },
    },
  ],
  notes: [
    '垫料是前置条件，不是被验的行为：5MB 阈值等不起，被验的是「宿主手里已有一份到阈值的当日文件时能不能封存与清理」。',
    '旧接线下同一份垫料会得到 log.rotate.degraded（reason=no-rename）、没有封存件、过期文件不删——这三条正是本场景要区分的。',
  ],
})
