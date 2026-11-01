// tests/fixtures/real-machine/deck/receipt-lossless.test.mts —— 回执无损解析的实现层单测（#1709）。
//
// 验收接缝是命令行进程接口，但「回执经 JSON 往返不丢东西」这件事要用固定样例逐格盯住：
// 中文、换行、制表符、嵌套 args、status/text/reason 三个基本格，以及 JSON 表达不了的值必须报错。
// 这份脚本被门禁 tests/verify-1709-deck-entry.ts 的 D 段用子进程跑（harness.runNode），
// 也可以单独跑：
//   node --import ./scripts/ts-hook.mts tests/fixtures/real-machine/deck/receipt-lossless.test.mts
// 退出码 0 = 全部通过；1 = 有断言红了。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  EXIT_OK,
  EXIT_TOOL_FAILED,
  buildReceipt,
  checkWriteEnvironment,
  exitCodeForReceipt,
  losslessProblems,
  readToolArgsFile,
  serializeReceipt,
} from '../../../../scripts/real-machine/lib/deck-write.mts'

let passed = 0
let failed = 0

function check(ok: boolean, message: string, detail?: string): void {
  if (ok) {
    passed += 1
    console.log('  PASS ' + message)
    return
  }
  failed += 1
  console.log('  FAIL ' + message)
  if (detail) console.log('       | ' + detail)
}

function messageOf(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}

function throwsWith(fn: () => unknown, keyword: string): { ok: boolean; message: string } {
  try {
    fn()
  } catch (error) {
    const message = messageOf(error)
    return { ok: message.indexOf(keyword) >= 0, message: message }
  }
  return { ok: false, message: '没有抛错' }
}

function main(): void {
  const body = '第一行：中文与换行都要原样回来\n第二行：制表符\t也要在'
  const sample = {
    ok: true,
    status: 'ok',
    tool: 'deck_issue_create',
    reason: '',
    text: '建好了：' + body,
    data: {
      args: { title: '无人机送检票', body: body, nested: [{ k: '值一' }, { k: '值二' }] },
      ticket: { key: '7', title: '无人机送检票', labels: ['bug'] },
    },
    items: [{ key: '7', step: 'comment', status: 'ok' }],
    notes: ['中文备注'],
  }

  // 一、基本格与嵌套内容原样保留
  const receipt = buildReceipt('deck_issue_create', sample)
  check(receipt.status === 'ok', '回执 status 原样保留（实得 ' + JSON.stringify(receipt.status) + '）')
  check(receipt.text === sample.text, '回执 text 里的中文与换行一字不差')
  check(receipt.reason === '', '回执 reason 原样保留（空串还是空串）')
  const data = receipt.data as Record<string, unknown>
  const args = data.args as Record<string, unknown>
  check(args.title === '无人机送检票', '嵌套 data.args.title 的中文原样保留')
  check(args.body === body, '嵌套 data.args.body 的换行与制表符原样保留')
  const nested = args.nested as Array<Record<string, unknown>>
  check(nested.length === 2 && nested[1].k === '值二', '嵌套数组里的中文原样保留')
  check(serializeReceipt(receipt).indexOf('无人机送检票') >= 0, '序列化后的回执文本里找得到中文原文')

  // 二、JSON 往返等值
  const text = serializeReceipt(receipt)
  check(text.slice(-1) === '\n', '回执序列化以换行结尾（工具输出形状稳定）')
  const roundTrip = JSON.parse(text)
  check(JSON.stringify(roundTrip) === JSON.stringify(receipt), '回执经 JSON 往返后与本身等值')
  check(losslessProblems(receipt, roundTrip).length === 0, '回执经无损检查没有变样的位置')

  // 三、undefined 键显式剥掉，不假装写了
  const withUndefined = buildReceipt('deck_issue_patch', {
    status: 'ok',
    text: '说明',
    reason: '',
    data: { keep: '留着', gone: undefined, nested: { keepToo: 1, goneToo: undefined } },
  })
  const uData = withUndefined.data as Record<string, unknown>
  check(!Object.prototype.hasOwnProperty.call(uData, 'gone'), '对象里 undefined 的键不会出现在回执里')
  check(uData.keep === '留着', '同一个对象里正常的键不受影响')
  check(!Object.prototype.hasOwnProperty.call(uData.nested, 'goneToo'), '嵌套对象里 undefined 的键同样剥掉')

  // 四、JSON 表达不了的值必须报错，不悄悄变成 null
  const nanCase = throwsWith(function () { buildReceipt('deck_issue_create', { status: 'ok', data: { bad: NaN } }) }, 'NaN')
  check(nanCase.ok, 'NaN 让建回执直接报错（含 NaN 字样）', nanCase.message)
  const infCase = throwsWith(function () { buildReceipt('deck_issue_create', { status: 'ok', data: { bad: Infinity } }) }, 'Infinity')
  check(infCase.ok, 'Infinity 让建回执直接报错（含 Infinity 字样）', infCase.message)
  const fnCase = throwsWith(function () { buildReceipt('deck_issue_create', { status: 'ok', data: { bad: function () {} } }) }, '函数值')
  check(fnCase.ok, '函数让建回执直接报错（含函数值字样）', fnCase.message)
  const notObject = throwsWith(function () { buildReceipt('deck_issue_create', null) }, '对象回执')
  check(notObject.ok, '工具回 null 时报「没有对象回执」', notObject.message)
  const noStatus = throwsWith(function () { buildReceipt('deck_issue_create', { text: '没有 status' }) }, 'status')
  check(noStatus.ok, '回执缺 status 时报错（没法判断成败）', noStatus.message)

  // 五、状态到退出码
  check(exitCodeForReceipt({ status: 'ok' }) === EXIT_OK, 'status=ok 映射退出码 0')
  check(exitCodeForReceipt({ status: 'failed' }) === EXIT_TOOL_FAILED, 'status=failed 映射退出码 1')
  check(exitCodeForReceipt({ status: 'partial' }) === EXIT_TOOL_FAILED, 'status=partial 映射退出码 1')
  check(exitCodeForReceipt({ status: 'unsupported' }) === EXIT_TOOL_FAILED, 'status=unsupported 映射退出码 1')

  // 六、环境检查：缺一件就报一件，齐了才放行
  const missing = checkWriteEnvironment({ glabBin: '', workspace: '', refId: '' })
  check(!missing.ok && missing.problems.length === 3, '缺 glab / 工作区 / 仓库标识时一次报三条（实得 ' + missing.problems.length + ' 条）', missing.problems.join('；'))
  check(missing.problems[0].indexOf('GLAB_BIN') >= 0, '第一条原因点名 GLAB_BIN')
  const noSlash = checkWriteEnvironment({ glabBin: path.join(os.tmpdir(), 'x'), workspace: os.tmpdir(), refId: 'dsh-deck-demo' })
  check(!noSlash.ok && noSlash.problems.some(function (p) { return p.indexOf('<group>/<project>') >= 0 }), '仓库标识没有斜杠时点明要写成 <group>/<project>', noSlash.problems.join('；'))
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-receipt-test-'))
  try {
    const fakeGlab = path.join(tempRoot, 'glab.cmd')
    fs.writeFileSync(fakeGlab, '@echo off\r\n', 'utf8')
    const workspace = path.join(tempRoot, 'workspace')
    fs.mkdirSync(workspace)
    const ready = checkWriteEnvironment({ glabBin: fakeGlab, workspace: workspace, refId: 'FixtureGroup/dsh-deck-demo' })
    check(ready.ok, 'glab 文件、工作区目录、两段仓库标识齐了才放行', ready.problems.join('；'))
    const missingGlab = checkWriteEnvironment({ glabBin: path.join(tempRoot, 'no-such.cmd'), workspace: workspace, refId: 'FixtureGroup/dsh-deck-demo' })
    check(!missingGlab.ok && missingGlab.problems[0].indexOf('不存在') >= 0, 'GLAB_BIN 指向不存在的文件时点名「不存在」', missingGlab.problems.join('；'))
    const badWorkspace = checkWriteEnvironment({ glabBin: fakeGlab, workspace: path.join(tempRoot, 'no-such-dir'), refId: 'FixtureGroup/dsh-deck-demo' })
    check(!badWorkspace.ok && badWorkspace.problems[0].indexOf('工作区目录不存在') >= 0, '工作区目录不存在时点名「工作区目录不存在」', badWorkspace.problems.join('；'))
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }

  // 七、入参文件：本票夹具能读、缺文件与坏 JSON 能说清
  const fixtureDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const createArgs = readToolArgsFile(path.join(fixtureDir, 'create.json'))
  check(createArgs.ok && createArgs.args.title === '无人机送检票', '夹具里的 create.json 能读成参数对象', createArgs.problem)
  const missingArgs = readToolArgsFile(path.join(fixtureDir, 'no-such-args.json'))
  check(!missingArgs.ok && missingArgs.problem.indexOf('入参文件不存在') >= 0, '入参文件不存在时点名「入参文件不存在」', missingArgs.problem)
  const brokenJsonPath = path.join(os.tmpdir(), 'deck-receipt-broken-' + process.pid + '.json')
  fs.writeFileSync(brokenJsonPath, '{ 这不是 JSON', 'utf8')
  try {
    const broken = readToolArgsFile(brokenJsonPath)
    check(!broken.ok && broken.problem.indexOf('读不懂') >= 0, '坏 JSON 的入参文件点名「读不懂」', broken.problem)
  } finally {
    fs.rmSync(brokenJsonPath, { force: true })
  }
}

try {
  main()
} catch (error) {
  failed += 1
  console.log('  FAIL 单测自己崩了：' + messageOf(error))
}
console.log('')
console.log('结果：' + passed + ' 条通过，' + failed + ' 条失败')
process.exitCode = failed > 0 ? 1 : 0
