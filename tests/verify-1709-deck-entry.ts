// tests/verify-1709-deck-entry.ts —— #1709「deck 工具直调入口」的自证门禁。
//
// 只走规格 #1703 定下的唯一测试接缝：命令行进程接口。本文件不 import 命令内部函数，也不读命令源码文本；
// 它起子进程跑 scripts/real-machine/commands/deck-write.mts 与 deck-readback.mts，读 stdout 的 JSON、
// 退出码、文件副作用与假 glab 的调用记录。整个门禁不访问网络、不需要真 glab、不碰真实 DSH 配置。
//
// 覆盖的验收判据：
//   A. 入口与夹具存在：deck-write / deck-readback 两个命令、装配库、假 glab 计划与三份工具入参都在。
//   B. 正例：deck_issue_create、deck_issue_patch、deck_map_link 各直调一次，回执是可解析的 JSON、
//      退出码 0；回执写进文件后与 stdout 等值；假 glab 的调用记录能对上「发过什么请求、在哪个工作区发」。
//   C. 独立读回：deck-readback 不经过 deck 装配，直接用 glab api 读同一张票，字段与夹具一致。
//   D. 拒绝路径：缺 GLAB_BIN、GLAB_BIN 指向不存在的文件、工作区不存在、仓库标识形状不对、工具名不在
//      可直调清单、入参文件不存在、缺 --tool —— 每条都能单独触发，退出码与中文原因可读，且一次 glab 都不调。
//   E. 回执无损解析：子进程跑实现层单测 tests/fixtures/real-machine/deck/receipt-lossless.test.mts，
//      盯住中文、换行、嵌套参数与 JSON 表达不了的值。
//   F. 负例自检：正例跑一趟 --negative 子门禁，证明这扇门禁的断言能红（不是删掉断言换来的红）。
//
// 真机阶段（B0）才验的事：真的建一张 GitLab 票、真的改、真的挂边、再用真 glab 读回——那一步要真凭据，
// 不在提交门禁里跑；本门禁只证明入口、回执与拒绝路径，写成功与否由 B0 取证。
//
// 跑法：
//   node --import ./scripts/ts-hook.mts tests/verify-1709-deck-entry.ts
//   node --import ./scripts/ts-hook.mts tests/verify-1709-deck-entry.ts --negative

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO_ROOT, createRealMachineHarness, samePath } from './lib/real-machine-process.ts'
import type { GlabPlan } from './lib/real-machine-process.ts'
import { printGateResult, scanGateResult } from './lib/gate-result.ts'

const GATE = 'verify-1709-deck-entry'
const SELF_REL = 'tests/verify-1709-deck-entry.ts'
const NEGATIVE = process.argv.includes('--negative')

const COMMANDS_DIR = path.join(REPO_ROOT, 'scripts', 'real-machine', 'commands')
const DECK_WRITE_COMMAND = path.join(COMMANDS_DIR, 'deck-write.mts')
// 假 glab 脚本本体：Windows 上经 cmd.exe 传带换行的参数会被截断（实测退出码 0、一次都没跑到），
// 而建票正文一定带换行。所以三个正例把 GLAB_BIN 直接指向这份脚本，由 deck-write 用 node 起它；
// 独立读回那条参数是单行的，仍然走 harness 默认的 glab.cmd 启动器，两条起法的分支都有覆盖。
const FAKE_GLAB_SCRIPT = path.join(REPO_ROOT, 'tests', 'fixtures', 'real-machine', 'fake-glab.mts')
const LIB_DIR = path.join(REPO_ROOT, 'scripts', 'real-machine', 'lib')
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'real-machine', 'deck')

const REF = 'FixtureGroup/dsh-deck-demo'
const ISSUES_PATH = 'projects/FixtureGroup%2Fdsh-deck-demo/issues'
const ISSUE_PATH = ISSUES_PATH + '/7'
const ISSUE_READ_PATH = ISSUE_PATH + '?with_labels_details=true'
const NOTES_PATH = ISSUE_PATH + '/notes'

const CHINESE_TITLE = '无人机送检票'
const CHINESE_BODY = '中文正文：夹具里的票面内容'
const CHINESE_COMMENT = '这是一条中文评论，用来验证回执与评论写入。'

let passed = 0
let failed = 0

/** 一条断言：通过的只留一行；失败的把可定位的现场整段缩进打出来，供人直接照着查。 */
function check(ok: boolean, message: string, detail?: string): void {
  if (ok) {
    passed += 1
    console.log('  PASS ' + message)
    return
  }
  failed += 1
  console.log('  FAIL ' + message)
  if (!detail) return
  const lines = String(detail).split(/\r?\n/)
  const shown = lines.slice(0, 80)
  for (const line of shown) console.log('       | ' + line)
  if (lines.length > shown.length) console.log('       | …（还有 ' + (lines.length - shown.length) + ' 行没打出来）')
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

function readJsonFile(absPath: string): JsonRecord | null {
  if (!fs.existsSync(absPath)) return null
  try {
    return asRecord(JSON.parse(fs.readFileSync(absPath, 'utf8')))
  } catch {
    return null
  }
}

type GlabCall = { argv: string[]; cwd: string; matchedRule?: number | 'default'; exitCode?: number }

function callsSince(harness: ReturnType<typeof createRealMachineHarness>, mark: number): GlabCall[] {
  return harness.readGlabCalls().slice(mark) as GlabCall[]
}

function findCall(calls: GlabCall[], prefix: string[]): GlabCall | null {
  for (const call of calls) {
    if (call.argv.length < prefix.length) continue
    let hit = true
    for (let index = 0; index < prefix.length; index += 1) {
      if (call.argv[index] !== prefix[index]) { hit = false; break }
    }
    if (hit) return call
  }
  return null
}

function hasMethod(call: GlabCall | null, method: string): boolean {
  return call !== null && call.argv.includes(method)
}

function argvContains(call: GlabCall | null, needle: string): boolean {
  return call !== null && call.argv.some(function (item) { return item.indexOf(needle) >= 0 })
}

function receiptOf(run: { json: unknown }): JsonRecord | null {
  return asRecord(run.json)
}

function ticketOf(receipt: JsonRecord | null): JsonRecord | null {
  if (!receipt) return null
  const data = asRecord(receipt.data)
  return data ? asRecord(data.ticket) : null
}

// 工具回执把「这次做了哪几步」放在顶层 items 里（与 status/text 同级）；个别旧形状曾塞进 data，
// 这里两处都认，但顶层优先——门禁盯的是命令打印出来的那份 JSON，不是某个内部字段的摆放位置。
function itemsOf(receipt: JsonRecord | null): JsonRecord[] {
  if (!receipt) return []
  const data = asRecord(receipt.data)
  const top = Array.isArray(receipt.items) ? receipt.items : []
  const raw = top.length > 0 ? top : (data && Array.isArray(data.items) ? data.items : [])
  const out: JsonRecord[] = []
  for (const item of raw) {
    const record = asRecord(item)
    if (record) out.push(record)
  }
  return out
}

/** 负例：真起一条会走拒绝路径的命令（缺 GLAB_BIN，命令会退出 3），然后故意把两处期望写错，让断言红。 */
function runNegative(harness: ReturnType<typeof createRealMachineHarness>): void {
  const run = harness.runCommand('deck-write', {
    args: [
      '--tool', 'deck_issue_create',
      '--args', path.join(FIXTURE_DIR, 'create.json'),
      '--ref', REF,
      '--workspace', harness.workspaceDir,
    ],
    env: { GLAB_BIN: undefined, PATH: harness.tmpDir },
  })
  check(
    run.exitCode === 0,
    '[负例] 故意把「缺 GLAB_BIN 时拒绝」的退出码期望成 0：这条断言必须红（实际退出码 ' + String(run.exitCode) + '）',
    harness.formatFailure(run),
  )
  check(
    run.stdout.trim() !== '',
    '[负例] 故意把「拒绝时不输出半截回执」期望成 stdout 非空：这条断言必须红',
    harness.formatFailure(run),
  )
}

function main(): void {
  const harness = createRealMachineHarness({ name: 'verify-1709' })
  try {
    console.log('临时工作根：' + harness.workRoot)

    if (NEGATIVE) {
      runNegative(harness)
      return
    }

    // ── A. 入口与夹具存在 ───────────────────────────────────────────────────────
    check(fs.existsSync(path.join(LIB_DIR, 'deck-write.mts')), 'A1 装配库 scripts/real-machine/lib/deck-write.mts 存在')
    check(fs.existsSync(path.join(COMMANDS_DIR, 'deck-write.mts')), 'A2 命令 scripts/real-machine/commands/deck-write.mts 存在')
    check(fs.existsSync(path.join(COMMANDS_DIR, 'deck-readback.mts')), 'A3 命令 scripts/real-machine/commands/deck-readback.mts 存在')
    const plan = readJsonFile(path.join(FIXTURE_DIR, 'plan-ok.json'))
    check(plan !== null, 'A4 假 glab 计划 tests/fixtures/real-machine/deck/plan-ok.json 能解析')
    const planRules = plan && Array.isArray(plan.rules) ? plan.rules : []
    check(
      planRules.length === 4 && planRules.every(function (rule) { const r = asRecord(rule); return r !== null && Array.isArray(r.argvPrefix) }),
      'A5 假 glab 计划有 4 条按 argv 前缀命中的规则',
      JSON.stringify(plan, null, 2),
    )
    const createArgs = readJsonFile(path.join(FIXTURE_DIR, 'create.json'))
    check(
      createArgs !== null && createArgs.title === CHINESE_TITLE && typeof createArgs.kind === 'string',
      'A6 建票入参夹具带中文标题与 kind',
      JSON.stringify(createArgs, null, 2),
    )
    const patchArgs = readJsonFile(path.join(FIXTURE_DIR, 'patch.json'))
    check(
      patchArgs !== null && patchArgs.key === '7' && patchArgs.comment === CHINESE_COMMENT,
      'A7 改票入参夹具带票号与中文评论',
      JSON.stringify(patchArgs, null, 2),
    )
    const linkArgs = readJsonFile(path.join(FIXTURE_DIR, 'link.json'))
    check(
      linkArgs !== null && linkArgs.key === '7' && linkArgs.parentKey === '3',
      'A8 挂边入参夹具带票号与父票号',
      JSON.stringify(linkArgs, null, 2),
    )
    check(fs.existsSync(path.join(FIXTURE_DIR, 'receipt-lossless.test.mts')), 'A9 回执无损解析的实现层单测存在')

    // 后面三个正例都用同一份假 glab 计划：建票 POST 回一张票、评论 POST 回一条评论、读票回同一张票。
    harness.writeGlabPlan(plan as unknown as GlabPlan)

    // ── B. 正例一：创建（deck_issue_create），不带 --out，验证缺省回执文件名 ──────
    const beforeCreate = harness.readGlabCalls().length
    // 这里用绝对路径起命令（runNode 的脚本路径相对 cwd 解析），好让命令自己的当前目录是临时工作根，
    // 这样「不带 --out 时回执落在当前目录」这条才是被测命令真实的行为，而不是门禁替它选好了路径。
    const create = harness.runNode(DECK_WRITE_COMMAND, {
      cwd: harness.workRoot,
      env: { GLAB_BIN: FAKE_GLAB_SCRIPT },
      args: ['--tool', 'deck_issue_create', '--args', path.join(FIXTURE_DIR, 'create.json'), '--ref', REF, '--workspace', harness.workspaceDir],
    })
    check(create.exitCode === 0, 'B1 建票：退出码 0', harness.formatFailure(create))
    check(create.jsonError === '', 'B2 建票：stdout 是单段可解析的 JSON', harness.formatFailure(create))
    const createReceipt = receiptOf(create)
    check(createReceipt !== null && createReceipt.status === 'ok', 'B3 建票：回执 status 是 ok', harness.formatFailure(create))
    check(createReceipt !== null && createReceipt.tool === 'deck_issue_create', 'B4 建票：回执记下工具名', harness.formatFailure(create))
    const createTicket = ticketOf(createReceipt)
    check(createTicket !== null && createTicket.key === '7', 'B5 建票：回执里带回新票的票号 7', harness.formatFailure(create))
    check(createTicket !== null && createTicket.title === CHINESE_TITLE, 'B6 建票：回执里的票面标题与入参一致（中文不丢）', harness.formatFailure(create))
    check(harness.exists('tool-response.json'), 'B7 建票：不带 --out 时回执落在当前目录的 tool-response.json', harness.listFiles())
    let defaultReceiptText = ''
    try { defaultReceiptText = harness.readText('tool-response.json') } catch { defaultReceiptText = '' }
    let defaultReceipt: JsonRecord | null = null
    try { defaultReceipt = asRecord(JSON.parse(defaultReceiptText)) } catch { defaultReceipt = null }
    check(
      defaultReceipt !== null && createReceipt !== null && JSON.stringify(defaultReceipt) === JSON.stringify(createReceipt),
      'B8 建票：回执文件与 stdout 是同一份 JSON（不是两套拼法）',
      defaultReceiptText,
    )
    const createCalls = callsSince(harness, beforeCreate)
    const createPost = findCall(createCalls, ['api', ISSUES_PATH, '--method', 'POST'])
    check(createPost !== null && hasMethod(createPost, 'POST'), 'B9 建票：向 issues 发了一次 POST', JSON.stringify(createCalls, null, 2))
    check(argvContains(createPost, CHINESE_BODY), 'B10 建票：POST 的参数里带着中文正文原文', JSON.stringify(createCalls, null, 2))
    check(
      createCalls.length > 0 && createCalls.every(function (call) { return samePath(call.cwd, harness.workspaceDir) }),
      'B11 建票：glab 全部在 --workspace 指定的工作区里跑（不是别处）',
      JSON.stringify(createCalls, null, 2),
    )

    // ── C. 正例二：改票（deck_issue_patch，写一条评论）─────────────────────────
    const beforePatch = harness.readGlabCalls().length
    const patch = harness.runCommand('deck-write', {
      env: { GLAB_BIN: FAKE_GLAB_SCRIPT },
      args: [
        '--tool', 'deck_issue_patch',
        '--args', path.join(FIXTURE_DIR, 'patch.json'),
        '--ref', REF,
        '--workspace', harness.workspaceDir,
        '--out', path.join(harness.workRoot, 'receipts', 'patch.json'),
      ],
    })
    check(patch.exitCode === 0, 'C1 改票：退出码 0', harness.formatFailure(patch))
    const patchReceipt = receiptOf(patch)
    check(patchReceipt !== null && patchReceipt.status === 'ok', 'C2 改票：回执 status 是 ok', harness.formatFailure(patch))
    const patchItems = itemsOf(patchReceipt)
    check(
      patchItems.length >= 1 && patchItems[0].step === 'comment' && patchItems[0].status === 'ok',
      'C3 改票：回执里评论那一项是 ok',
      JSON.stringify(patchReceipt, null, 2),
    )
    const patchTicket = ticketOf(patchReceipt)
    check(patchTicket !== null && patchTicket.key === '7', 'C4 改票：写后读回同一张票 7', harness.formatFailure(patch))
    const patchCalls = callsSince(harness, beforePatch)
    const notePost = findCall(patchCalls, ['api', NOTES_PATH, '--method', 'POST'])
    check(notePost !== null && hasMethod(notePost, 'POST'), 'C5 改票：向 notes 发了一次 POST', JSON.stringify(patchCalls, null, 2))
    check(argvContains(notePost, CHINESE_COMMENT), 'C6 改票：评论正文里的中文原样传出去', JSON.stringify(patchCalls, null, 2))
    check(
      harness.exists('receipts/patch.json') && JSON.stringify(harness.readJson('receipts/patch.json')) === JSON.stringify(patchReceipt),
      'C7 改票：--out 指定的回执文件与 stdout 等值',
      harness.exists('receipts/patch.json') ? harness.readText('receipts/patch.json') : '（文件不存在）',
    )

    // ── D. 正例三：挂边（deck_map_link，只挂父票）──────────────────────────────
    const beforeLink = harness.readGlabCalls().length
    const link = harness.runCommand('deck-write', {
      env: { GLAB_BIN: FAKE_GLAB_SCRIPT },
      args: [
        '--tool', 'deck_map_link',
        '--args', path.join(FIXTURE_DIR, 'link.json'),
        '--ref', REF,
        '--workspace', harness.workspaceDir,
        '--out', path.join(harness.workRoot, 'receipts', 'link.json'),
      ],
    })
    check(link.exitCode === 0, 'D1 挂边：退出码 0', harness.formatFailure(link))
    const linkReceipt = receiptOf(link)
    check(linkReceipt !== null && linkReceipt.status === 'ok', 'D2 挂边：回执 status 是 ok', harness.formatFailure(link))
    const linkItems = itemsOf(linkReceipt)
    check(linkItems.length === 1 && linkItems[0].status === 'ok', 'D3 挂边：回执里这条边是 ok（读回父票号对得上才算）', JSON.stringify(linkReceipt, null, 2))
    const linkCalls = callsSince(harness, beforeLink)
    // 挂边之前要先读正文，看里面有没有目标父票的隐藏标记（有就不重复改正文）。
    // 实际实现走的是带标签详情的读法（with_labels_details=true）；裸读（不带查询串）也算读过，
    // 所以两种路径都认——这一条守的是「读过」，不是「用哪种查法读」。
    const linkRead = linkCalls.some(function (call) {
      if (call.argv.length < 2 || call.argv[0] !== 'api') return false
      return call.argv[1] === ISSUE_PATH || call.argv[1] === ISSUE_READ_PATH
    })
    check(linkRead, 'D4 挂边：读过这张票的原始内容（先看正文里有没有父票标记）', JSON.stringify(linkCalls, null, 2))
    const linkPut = linkCalls.filter(function (call) { return hasMethod(call, 'PUT') })
    check(linkPut.length === 0, 'D5 挂边：夹具里已经有父票标记，不该再发 PUT（幂等，不重复改正文）', JSON.stringify(linkCalls, null, 2))

    // ── E. 独立读回：deck-readback 不经过 deck 装配，直接用 glab api 读 ──────────
    const beforeReadback = harness.readGlabCalls().length
    const readback = harness.runCommand('deck-readback', {
      args: ['--ref', REF, '--key', '7', '--out', path.join(harness.workRoot, 'receipts', 'readback.json')],
    })
    check(readback.exitCode === 0, 'E1 独立读回：退出码 0', harness.formatFailure(readback))
    check(readback.jsonError === '', 'E2 独立读回：stdout 是单段可解析的 JSON', harness.formatFailure(readback))
    const readbackJson = receiptOf(readback)
    check(readbackJson !== null && readbackJson.key === '7', 'E3 独立读回：读到的票号是 7', harness.formatFailure(readback))
    check(readbackJson !== null && readbackJson.title === CHINESE_TITLE, 'E4 独立读回：标题与写入时的一致（中文不丢）', harness.formatFailure(readback))
    check(
      readbackJson !== null && typeof readbackJson.body === 'string' && readbackJson.body.indexOf('第一行：先把夹具做出来') >= 0,
      'E5 独立读回：正文读得回来（含换行分隔的中文行）',
      harness.formatFailure(readback),
    )
    check(readbackJson !== null && readbackJson.parentKey === '3', 'E6 独立读回：父票号是挂上去的 3', harness.formatFailure(readback))
    check(
      readbackJson !== null && JSON.stringify(readbackJson.labels) === JSON.stringify(['bug']),
      'E7 独立读回：标签读成名字数组',
      JSON.stringify(readbackJson, null, 2),
    )
    check(
      readbackJson !== null && readbackJson.url === 'https://gitlab.com/' + REF + '/-/issues/7',
      'E8 独立读回：带回票的 web 地址',
      harness.formatFailure(readback),
    )
    const readbackCalls = callsSince(harness, beforeReadback)
    check(
      readbackCalls.length === 1 && JSON.stringify(readbackCalls[0].argv) === JSON.stringify(['api', ISSUE_READ_PATH]),
      'E9 独立读回：只发一条 glab api 读请求，路径与写命令无关',
      JSON.stringify(readbackCalls, null, 2),
    )
    check(
      harness.exists('receipts/readback.json') && JSON.stringify(harness.readJson('receipts/readback.json')) === JSON.stringify(readbackJson),
      'E10 独立读回：--out 指定的读回文件与 stdout 等值',
      harness.exists('receipts/readback.json') ? harness.readText('receipts/readback.json') : '（文件不存在）',
    )

    // ── F. 拒绝路径：每条单独触发，退出码与原因可读，一次 glab 都不调 ───────────
    const beforeRefusals = harness.readGlabCalls().length
    const baseArgs = ['--tool', 'deck_issue_create', '--args', path.join(FIXTURE_DIR, 'create.json'), '--ref', REF, '--workspace', harness.workspaceDir]

    const noGlab = harness.runCommand('deck-write', { args: baseArgs, env: { GLAB_BIN: undefined, PATH: harness.tmpDir } })
    check(noGlab.exitCode === 3, 'F1 缺 GLAB_BIN：退出码 3（环境缺失）', harness.formatFailure(noGlab))
    check(noGlab.stdout.trim() === '', 'F2 缺 GLAB_BIN：stdout 不输出半截回执', harness.formatFailure(noGlab))
    check(
      noGlab.stderr.includes('GLAB_BIN') && noGlab.stderr.includes('PATH'),
      'F3 缺 GLAB_BIN：stderr 点名缺的变量，并说明不会去 PATH 上找',
      harness.formatFailure(noGlab),
    )

    const badGlab = harness.runCommand('deck-write', {
      args: baseArgs,
      env: { GLAB_BIN: path.join(harness.tmpDir, 'no-such-glab.cmd') },
    })
    check(badGlab.exitCode === 3, 'F4 GLAB_BIN 指向不存在的文件：退出码 3', harness.formatFailure(badGlab))
    check(badGlab.stderr.includes('不存在'), 'F5 GLAB_BIN 指向不存在的文件：stderr 说清「不存在」', harness.formatFailure(badGlab))

    const badWorkspace = harness.runCommand('deck-write', {
      args: ['--tool', 'deck_issue_create', '--args', path.join(FIXTURE_DIR, 'create.json'), '--ref', REF, '--workspace', path.join(harness.workRoot, 'no-such-ws')],
    })
    check(badWorkspace.exitCode === 3, 'F6 工作区目录不存在：退出码 3', harness.formatFailure(badWorkspace))
    check(badWorkspace.stderr.includes('工作区目录不存在'), 'F7 工作区目录不存在：stderr 说清是工作区的问题', harness.formatFailure(badWorkspace))

    const badRef = harness.runCommand('deck-write', {
      args: ['--tool', 'deck_issue_create', '--args', path.join(FIXTURE_DIR, 'create.json'), '--ref', 'dsh-deck-demo', '--workspace', harness.workspaceDir],
    })
    // 仓库标识形状由 checkWriteEnvironment 一起把关（它属于「环境齐不齐」，不是命令行写法错），
    // 所以这里期望 3 而不是 2：换成一个能起步的命令也没用，缺的是能用的仓库身份。
    check(badRef.exitCode === 3, 'F8 仓库标识没有斜杠：退出码 3（环境不齐，缺能用的仓库身份）', harness.formatFailure(badRef))
    check(badRef.stderr.includes('<group>/<project>'), 'F9 仓库标识没斜杠：stderr 说清要写成 <group>/<project>', harness.formatFailure(badRef))

    const badTool = harness.runCommand('deck-write', {
      args: ['--tool', 'deck_issue_get', '--args', path.join(FIXTURE_DIR, 'create.json'), '--ref', REF, '--workspace', harness.workspaceDir],
    })
    check(badTool.exitCode === 2, 'F10 工具名不在可直调清单：退出码 2', harness.formatFailure(badTool))
    check(badTool.stderr.includes('可直调清单'), 'F11 工具名不在可直调清单：stderr 列出可直调的工具', harness.formatFailure(badTool))

    const missingArgs = harness.runCommand('deck-write', {
      args: ['--tool', 'deck_issue_create', '--args', path.join(FIXTURE_DIR, 'no-such-args.json'), '--ref', REF, '--workspace', harness.workspaceDir],
    })
    check(missingArgs.exitCode === 2, 'F12 入参文件不存在：退出码 2', harness.formatFailure(missingArgs))
    check(missingArgs.stderr.includes('入参文件不存在'), 'F13 入参文件不存在：stderr 点名入参文件', harness.formatFailure(missingArgs))

    const noTool = harness.runCommand('deck-write', {
      args: ['--args', path.join(FIXTURE_DIR, 'create.json'), '--ref', REF, '--workspace', harness.workspaceDir],
    })
    check(noTool.exitCode === 2, 'F14 缺 --tool：退出码 2', harness.formatFailure(noTool))
    check(noTool.stderr.includes('--tool'), 'F15 缺 --tool：stderr 点名缺的参数', harness.formatFailure(noTool))

    check(
      harness.readGlabCalls().length === beforeRefusals,
      'F16 所有拒绝路径合起来一次 glab 都没调（拒绝发生在起外部程序之前）',
      JSON.stringify(callsSince(harness, beforeRefusals), null, 2),
    )

    // ── G. 回执无损解析：子进程跑实现层单测 ─────────────────────────────────────
    const unit = harness.runNode('tests/fixtures/real-machine/deck/receipt-lossless.test.mts')
    check(unit.exitCode === 0, 'G1 回执无损解析单测退出码 0', harness.formatFailure(unit))
    check(
      unit.stdout.includes('条通过') && unit.stdout.includes('0 条失败'),
      'G2 单测自报「0 条失败」（不是提前收摊）',
      harness.formatFailure(unit),
    )
    check(unit.stdout.indexOf('FAIL ') < 0, 'G3 单测输出里没有失败行', harness.formatFailure(unit))

    // ── H. 负例自检：正例跑一趟 --negative 子门禁，证明这扇门禁真的能红 ───────
    const negativeRun = spawnSync(process.execPath, ['--import', './scripts/ts-hook.mts', SELF_REL, '--negative'], {
      cwd: REPO_ROOT,
      env: Object.assign({}, process.env, { DSH_VERIFY_WORK_ROOT: harness.workRoot }),
      encoding: 'utf8',
      timeout: 120000,
      windowsHide: true,
    })
    const negativeOutput = String(negativeRun.stdout || '') + String(negativeRun.stderr || '')
    const scan = scanGateResult(negativeOutput)
    check(negativeRun.status === 1, 'H1 --negative 子门禁退出码 1（负例必须能红）', negativeOutput)
    check(
      scan.record !== null && scan.record.failed >= 2 && scan.record.assertions >= 2,
      'H2 --negative 的完成记录自报至少 2 条失败断言',
      negativeOutput,
    )
    check(
      negativeOutput.includes('[负例]') && negativeOutput.includes('FAIL '),
      'H3 负例输出里能看到被故意触发的断言与失败行',
      negativeOutput,
    )
  } finally {
    harness.dispose()
  }
}

try {
  main()
} catch (error) {
  failed += 1
  console.log('  FAIL 门禁自己崩了：' + (error instanceof Error && error.stack ? error.stack : String(error)))
}
console.log('')
console.log('结果：' + passed + ' 条通过，' + failed + ' 条失败')
printGateResult(GATE, passed + failed, failed)
process.exitCode = failed > 0 ? 1 : 0
