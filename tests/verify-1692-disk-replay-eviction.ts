/**
 * tests/verify-1692-disk-replay-eviction.ts —— 整份磁盘快照退役门禁（#1692 立，#1870 改题，#1922 收窄）
 *
 * 文件名与在链上的位置保留（收口矩阵按名字引用它）。它现在只守两件事：
 *   A 整份磁盘快照退役（#1870）：旧的 .dsh-mattskillsdeck-cache/<owner>__<repo>.json 不再被读、
 *     不再被写、不再被迁移；格式模块已删除；两条快照宿主方法它们的装配处都不再引用那三个口。
 *     旧 JSON 文件仍原地留在磁盘上——谁也不碰它，所以它的字节一个都不会变。
 *   B 显示（#1928 起）：列表上方不再出现「上次已知 / 只读 / 写锁」这类内部状态；数据年龄由面板
 *     头部的时间标签表达。本地快照库自己报的损坏/身份/结构重建诊断仍走列表状态行 —— 它们说
 *     「本机数据出了什么事」，不是底层锁在谁手里。
 *   C 接线：首屏与刷新的读写都经本地快照库门面；没有新增定时器。
 *
 * 2026-11-05（#1922）退役的部分：本门禁原来的 B 段「按需细节按上限淘汰」（条数 200 / 字节 512KB、
 * LRU、detailEvicted 记号）与 C 段的「详情页对已淘汰的行说「未取（曾在 HH:mm）」」整段删除。
 * 维护者当天拍板「我们就不限制上限了，也不要淘汰了。数据库里面存的数据，除非源头被删除，
 * 否则不会再消失」——淘汰规则模块本身已删除，留着重演它只会让人以为那套机制还在。
 * 新决定由 tests/verify-1922-retire-eviction.ts 守（源码里没有淘汰、库里没有容量清理、
 * 诊断读数看得见库文件字节数与票行数、文档写下决定）。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1692-disk-replay-eviction.ts
 */
// 门禁归属: src/refresh/rooms/host/session-snapshot-cache.ts
// 门禁归属: src/refresh/rooms/host/session-refresh-schedule.ts
// 门禁归属: src/refresh/rooms/host/row-patch.ts

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import { truthFreshnessBox, truthNoticeLines } from '../src/client/views/shared/truthLines.ts'

// truthLines.ts 拼进客户端闭包时，freshnessLevel 由 budget 片段提供；门禁单独求值这一片，
// 所以在这里挂一个最小替身（只给 B3 的头部时间标签用，回 'fresh' 就够，不参与任何阈值判断）。
;(globalThis as any).freshnessLevel = function (): string { return 'fresh' }

const GATE = 'verify-1692-disk-replay-eviction'
const ROOT = process.cwd()
let total = 0
let failed = 0

function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) {
    console.log('PASS ' + message)
    return
  }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

function srcText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

function main(): void {
  console.log('整份磁盘快照退役门禁（#1692 / #1870 / #1922 收窄）')

  // ── A 整份磁盘快照退役（#1870）：旧 JSON 不读、不写、不迁、不删 ──
  {
    check(!existsSync(path.join(ROOT, 'src/refresh/kernel/disk-snapshot-format.ts')), 'A1 旧磁盘快照的格式模块已删除')

    const gitSrc = srcText('src/refresh/rooms/host/git-execution.ts')
    check(!/readDiskCache|writeDiskCache|cacheFileName|readDiskSnapshot|buildDiskSnapshot/.test(gitSrc), 'A2 宿主执行层不再有读写旧 JSON 的函数')

    const snapshotHostModules = [
      'src/refresh/rooms/host/session-snapshot-cache.ts',
      'src/refresh/rooms/host/session-refresh-schedule.ts',
      'src/refresh/rooms/host/issue-list-fetch.ts',
      'src/refresh/rooms/host/issue-index-scan.ts',
      'src/refresh/rooms/host/comment-thread-fetch.ts',
      'src/refresh/rooms/host/patch-wiring.ts',
      'src/host/index.ts',
    ]
    const dirty = snapshotHostModules.filter(function (rel) { return /readDiskCache|writeDiskCache|cacheFileName/.test(srcText(rel)) })
    check(dirty.length === 0, 'A3 快照宿主方法与它们的装配处都不再引用旧的磁盘快照口', dirty)

    // 全仓源码扫一遍：三个旧口与两个格式函数一个都不许留（命中就是还有人在读写那份 JSON）。
    const offenders: string[] = []
    const stack: string[] = [path.join(ROOT, 'src')]
    let sourceChars = 0
    while (stack.length) {
      const dir = stack.pop() as string
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) { stack.push(full); continue }
        if (!/\.(ts|mts)$/.test(name)) continue
        const txt = readFileSync(full, 'utf8')
        sourceChars += txt.length
        if (/readDiskCache|writeDiskCache|cacheFileName|buildDiskSnapshot|readDiskSnapshot/.test(txt)) {
          offenders.push(path.relative(ROOT, full).replace(/\\/g, '/'))
        }
      }
    }
    check(offenders.length === 0, 'A4 全仓 src 里再没有旧的整份磁盘快照读写口', offenders)
    check(sourceChars > 0 && !gitSrc.includes('__' + 'name.json'), 'A5 宿主执行层里再没有旧快照的文件名拼法')

    // 旧文件原地不动：本地快照库只认一个 .sqlite 文件，库路径从不指向那份 JSON。
    const libPaths = srcText('src/workspace-snapshot/runtime/paths.ts')
    check(libPaths.indexOf('.sqlite') >= 0 && libPaths.indexOf('.json') < 0, 'A6 本地快照库只认 .sqlite 一个文件，库路径不指向旧的 JSON（旧文件原地留着，谁也不碰）')
  }

  // ── B 显示：列表上方不再出现回放/只读/写锁这类内部状态（#1928） ──
  //
  // 这一段的判据从「内部状态要上列表」翻成「内部状态不上列表」：回放与只读租约都不再由列表
  // 状态行说；数据年龄仍在面板头部的时间标签里（同一份 generatedMs）。损坏/身份/结构重建三条
  // 仍然要上列表 —— 它们说「本机数据出了什么事」，不是「底层哪把锁在谁手里」。
  {
    const at = new Date(2026, 9, 31, 9, 23, 0).getTime()
    const st = { snapshot: { generatedMs: at, diskReplay: { schema: 3, source: 'legacy-unknown', completeness: 'unknown', legacy: true, lastKnownAtMs: at } } }
    const lines = truthNoticeLines(st, at + 1000)
    check(!lines.some(function (l: any) { return l.key === 'truth.replayLastKnown' || l.kind === 'replay' }),
      'B1 磁盘回放不再在列表上方说「上次已知」（数据年龄由头部时间标签表达）')

    const pages = srcText('config/copy/pages.yaml')
    check(pages.indexOf('truth.replayLastKnown') < 0 && pages.indexOf('truth.snapshotReadonly') < 0 && pages.indexOf('truth.snapshotLeaseLost') < 0,
      'B2 词表里「上次已知 / 只读显示 / 租约丢失」三条内部状态词条已删')

    const header = truthFreshnessBox(st, at + 1000)
    check(!!header && header.agoKey === 'truth.updatedJustNow' && header.time === '09:23',
      'B3 数据年龄仍在面板头部的时间标签里（同一份 generatedMs）', header)

    // #1869 真机演练补：本地快照库自己报的开库诊断（损坏重建）也要走这条状态行，
    // 否则库坏了重建完，列表区只剩「加载中… 暂无」，谁也看不出本机数据被清掉。
    const corruptDiag = truthNoticeLines({ snapshot: { snapshotDiagnostics: [{ code: 'corrupt-rebuilt', message: '本地快照已重建' }] } }, at)
    check(corruptDiag.some(function (l: any) { return l.key === 'truth.snapshotCorrupt' }), 'B4 库损坏重建时状态行仍说「已整库重建」')
    const readOnlyDiag = truthNoticeLines({ snapshot: { snapshotDiagnostics: [{ code: 'lease-held-readonly', message: '另一个窗口在写' }] } }, at)
    check(!readOnlyDiag.some(function (l: any) { return l.kind === 'snapshot' }), 'B5 只读/租约诊断不再出现在列表状态行')
    check(!truthNoticeLines({ snapshot: { snapshotDiagnostics: [] } }, at).some(function (l: any) { return l.kind === 'snapshot' }), 'B6 负例：没有开库诊断时不说快照提示')
    check(pages.indexOf('truth.snapshotCorrupt') >= 0 && pages.indexOf('本地快照已损坏') >= 0 && pages.indexOf('Local snapshot was corrupt') >= 0, 'B7 词表两个语言都保留快照损坏这一组')
  }

  // ── C 接线：新库是唯一持久副本，且没新增定时器 ──
  {
    const cacheSrc = srcText('src/refresh/rooms/host/session-snapshot-cache.ts')
    check(cacheSrc.indexOf('firstScreenFromLibrary') >= 0 && cacheSrc.indexOf('commitRows') >= 0, 'C1 首屏的读与写都经快照库门面：先读库回放，取回的行整批写库')
    const refreshSrc = srcText('src/refresh/rooms/host/session-refresh-schedule.ts')
    check(refreshSrc.indexOf('recordIssueRows') >= 0, 'C2 一轮刷新整批写进同一个库（先提交，再交给界面）')

    const timerFiles = [
      'src/refresh/rooms/host/git-execution.ts',
      'src/refresh/rooms/host/row-patch.ts',
      'src/refresh/rooms/host/session-snapshot-cache.ts',
    ]
    let timerHits = 0
    for (let i = 0; i < timerFiles.length; i++) {
      const t = srcText(timerFiles[i])
      timerHits += (t.match(/setInterval|setTimeout/g) || []).length
    }
    check(timerHits === 0, 'C3 这一票没有新增定时器：写回与回放几处都不出现 setInterval/setTimeout')
  }

  console.log('')
  console.log(failed ? '存在失败 — ' + GATE + ' 未通过' : '全部通过 — 磁盘快照退役门禁生效（' + total + ' 项断言）')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main()
