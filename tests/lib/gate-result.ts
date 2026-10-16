// tests/lib/gate-result.ts —— 「完成证据」的唯一判据（#1158）。
//
// 起因：链的三条执行器（scripts/verify-chain.js、scripts/verify-parallel.mjs、scripts/verify-all.mjs）
// 判定一扇门禁过没过，只看它的退出码。于是「跑到一半就收摊、退出码仍是 0」这种假绿没有任何东西能拦：
// #1146 就是这么被发现的 —— tests/verify-deck-no-hang.js 的 21 条断言只跑到第 12 条就退出，退出码 0，
// 整条链判绿，没人知道少跑了 9 条。
//
// 这一份文件是那条判据的唯一来源：门禁自己交一份机读完成记录，执行器拿它跟归属表里记着的期望对数。
// 记录只有一行，固定写成：
//
//     GATE-RESULT {"gate":"verify-deck-no-hang","assertions":21,"failed":0}
//
// 三个字段的含义，以及为什么是这三个：
//   gate       门禁名 = 文件名去掉扩展名。执行器要拿它跟归属表里那一条对名字，防「打错行、串了门禁」。
//   assertions 这一趟真的跑过的断言总数（不是「期望」）。少跑几条，这个数字就会跟着变小。
//   failed     这一趟失败的断言条数。红了就该自己报红，别只靠退出码。
//
// 约定（改这里之前先读这三条）：
//   1. 门禁在收尾汇总行之后、process.exit 之前调用 printGateResult(...)，一行，最后一行。
//      中途收摊的门禁自然打不出这一行 —— 「打不出来」本身就是判据要的信号。
//   2. 判据是「退出码 0 且记录在且计数等于归属表里的期望」，缺一判红。期望存在
//      tests/gate-map.json 的 expectedAssertions 里（哪一扇已交记录看 completionRecord）。
//   3. 没有期望的步骤（completionRecord 为 false）保持今天的行为：只看退出码。
//      一扇门禁迁进来之前，别给它编一个期望数字 —— 编出来的数字会让真红变假绿。
//
// 反例（写测试时要用的那几条）：记录行写成非 JSON、少一个字段、gate 名字打错、
// assertions 与期望不等、failed 不为 0、整趟没有记录 —— 这六种都必须判红。
//
// 这一份是 .ts：新写的检查一律 .ts。它同时被 .js 门禁（require）与 .mjs 执行器（import）加载，
// 所以里面只写 ESM 语法（Node 对 .ts 的 require 走的是 require(esm) 那条路，两边都能用）。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 记录行的前缀。判据与执行器都从这里取，别在别处再写一遍字面量。 */
export const GATE_RESULT_PREFIX = 'GATE-RESULT '

/** 一条完成记录的三个字段。 */
export type GateResult = {
  gate: string
  assertions: number
  failed: number
}

/** 归属表里「这一扇已开闸」的期望：执行器拿它跟门禁交上来的记录对数。 */
export type CompletionExpectation = {
  /** 链上那一步的原文（`node tests/xxx.js`），执行器按它查表。 */
  step: string
  /** 门禁文件相对仓库根的路径，人读用。 */
  file: string
  /** 门禁名（文件名去扩展名），跟记录里的 gate 对名字。 */
  gate: string
  /** 这一扇该有多少条断言。少了就是提前收摊，多了就是有人加了断言忘了改这里。 */
  expectedAssertions: number
}

/** 一趟输出里扫出来的结果：最后一条能读懂的记录，加上读不懂的那些行。 */
export type GateResultScan = {
  record: GateResult | null
  broken: string[]
}

/** 判据的结论。reason 是给人看的一句话，ok 为真时它说明「证据齐全」在哪。 */
export type CompletionVerdict = {
  ok: boolean
  reason: string
}

/** 把一条记录拼成那一行。门禁自己不拼字符串，统一走这里。 */
export function formatGateResult(gate: string, assertions: number, failed: number): string {
  return GATE_RESULT_PREFIX + JSON.stringify({ gate, assertions, failed })
}

/** 打一行完成记录并把它交回调用方（门禁自测时要用到）。 */
export function printGateResult(gate: string, assertions: number, failed: number): GateResult {
  const record: GateResult = { gate, assertions, failed }
  console.log(formatGateResult(gate, assertions, failed))
  return record
}

/**
 * 从文件路径取门禁名：`tests/verify-deck-no-hang.js` → `verify-deck-no-hang`。
 * 只看文件名，不看目录 —— 门禁名在全仓是唯一的，执行器与归属表都按这个名字对。
 * 冒烟那几条长这样：`smoke-host-dispatch.test.js` —— `.test` 是这类文件的命名习惯，不是门禁名的一部分，
 * 所以也去掉，名字才与 verify-* 那些一致（`smoke-host-dispatch`，而不是 `smoke-host-dispatch.test`）。
 * 这一份与 scripts/gate-map.mjs 的同名函数必须字字一致：两边各算一次，差一个字判据就对不上。
 */
export function gateNameOf(file: string): string {
  const base = path.basename(String(file || ''))
  return base.replace(/\.(test|spec)\.(js|mjs|cjs|ts|mts|cts)$/, '').replace(/\.(js|mjs|cjs|ts|mts|cts)$/, '')
}

/** 读一行记录；不是记录行、或字段不合法，都回 null（读不懂的另算，见 scanGateResult）。 */
export function parseGateResultLine(line: string): GateResult | null {
  const text = String(line || '').trim()
  if (!text.startsWith(GATE_RESULT_PREFIX)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(GATE_RESULT_PREFIX.length))
  } catch (e) {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const rec = parsed as Record<string, unknown>
  if (typeof rec.gate !== 'string' || !rec.gate) return null
  if (!Number.isInteger(rec.assertions) || (rec.assertions as number) < 0) return null
  if (!Number.isInteger(rec.failed) || (rec.failed as number) < 0) return null
  return { gate: rec.gate, assertions: rec.assertions as number, failed: rec.failed as number }
}

/**
 * 扫一趟输出，取最后一条能读懂的记录，并留下读不懂的记录行。
 * 为什么取最后一条：一扇门禁万一打了两次，收尾那一次才是它的结论；中间那次是过程。
 */
export function scanGateResult(text: string): GateResultScan {
  const out: GateResultScan = { record: null, broken: [] }
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith(GATE_RESULT_PREFIX)) continue
    const rec = parseGateResultLine(line)
    if (rec) out.record = rec
    else out.broken.push(line)
  }
  return out
}

/**
 * 读归属表，把「已开闸」的步骤抽成期望表。
 * 表里有两处记着开闸：gates（主链规划名单每步）与 smokeGates（冒烟链 scripts.smoke 每步，#1178）。
 * 两条链共用这一份期望表：执行器按文件找自己链上那一步的期望，找不到就是「没开闸，只看退出码」。
 * 默认读仓库里的 tests/gate-map.json（本文件在 tests/lib 下，往上一级就是它）；
 * 传 mapPath 是为了让测试能拿内存里的表来验，不必改盘上的那一份。
 */
export function loadCompletionExpectations(mapPath?: string): {
  byStep: Map<string, CompletionExpectation>
  byFile: Map<string, CompletionExpectation>
} {
  const file = mapPath || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gate-map.json')
  const map = JSON.parse(fs.readFileSync(file, 'utf8')) as { gates?: unknown; smokeGates?: unknown }
  const byStep = new Map<string, CompletionExpectation>()
  const byFile = new Map<string, CompletionExpectation>()
  const rows = [
    ...(Array.isArray(map.gates) ? map.gates : []),
    ...(Array.isArray(map.smokeGates) ? map.smokeGates : []),
  ] as Array<Record<string, unknown>>
  for (const g of rows) {
    if (g.completionRecord !== true) continue
    const expected = g.expectedAssertions
    if (!Number.isInteger(expected) || (expected as number) <= 0) continue
    const step = String(g.step || '')
    const gateFile = String(g.file || '')
    if (!step || !gateFile) continue
    const entry: CompletionExpectation = { step, file: gateFile, gate: gateNameOf(gateFile), expectedAssertions: expected as number }
    byStep.set(step, entry)
    byFile.set(gateFile, entry)
  }
  return { byStep, byFile }
}

/**
 * 判一扇已开闸的门禁这一趟算不算过。
 * 判据只有一条：退出码 0，且记录在，且 gate 名字对得上，且 failed 为 0，且计数等于期望。
 * 每一条不满足都给一句人话，执行器直接把这句话打出去 —— 别让人再去猜「为什么绿了却是坏的」。
 */
export function judgeGateCompletion(input: {
  gate: string
  expectedAssertions: number
  exitCode: number
  output: string
}): CompletionVerdict & { record: GateResult | null } {
  const { gate, expectedAssertions, exitCode, output } = input
  if (exitCode !== 0) {
    return { ok: false, reason: '门禁退出码 ' + exitCode + '（不是 0）', record: null }
  }
  const scan = scanGateResult(output)
  if (scan.broken.length) {
    return { ok: false, reason: '完成记录这一行读不懂（应当是 ' + GATE_RESULT_PREFIX + ' 加一段 JSON）：' + scan.broken[0], record: null }
  }
  const record = scan.record
  if (!record) {
    return {
      ok: false,
      reason: '缺完成记录：整趟输出里没有一行 ' + GATE_RESULT_PREFIX + '（门禁跑到一半就收摊了，或者忘了在收尾时交记录）',
      record: null,
    }
  }
  if (record.gate !== gate) {
    return { ok: false, reason: '完成记录里的门禁名「' + record.gate + '」与归属表里的「' + gate + '」对不上', record }
  }
  if (record.failed !== 0) {
    return { ok: false, reason: '完成记录自报 ' + record.failed + ' 条断言失败', record }
  }
  if (record.assertions !== expectedAssertions) {
    const diff = expectedAssertions - record.assertions
    return {
      ok: false,
      reason:
        '断言数 ' +
        record.assertions +
        ' ≠ 归属表里记着的 ' +
        expectedAssertions +
        '（' +
        (diff > 0 ? '少跑了 ' + diff + ' 条' : '多跑了 ' + -diff + ' 条，加了断言就顺手改 tests/gate-map.json 的期望') +
        '）',
      record,
    }
  }
  return { ok: true, reason: '完成记录齐全：' + record.assertions + ' 条断言、0 条失败', record }
}

/**
 * 执行器用的那一层：没有期望的步骤一律放行（保持今天只看退出码的行为），
 * 有期望的步骤才走上面的判据。这样三条执行器各只有一处调用，判定不会各写一份。
 */
export function judgeStepCompletion(
  entry: CompletionExpectation | undefined,
  exitCode: number,
  output: string,
): CompletionVerdict {
  if (!entry) return { ok: true, reason: '' }
  const verdict = judgeGateCompletion({
    gate: entry.gate,
    expectedAssertions: entry.expectedAssertions,
    exitCode,
    output,
  })
  return { ok: verdict.ok, reason: verdict.reason }
}
