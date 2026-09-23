// tests/verify-gitlab-single-write.js —— #722：GitLab 建票一次调用只做一次写尝试。
//
// 这一条门禁盯的不是「有没有实现一个函数」，而是一件在界面上看不出来的事：
// **一次建票调用里，到底有几条写请求真的发到了远端，发的是什么 URL 与 argv。**
// 原来的写法在一次 create 里先 PUT 到集合端点、拿不到票面再回落发一次 POST ——
// 对远端来说那是两次都可能写成功的请求：第一次其实建成了、只是回包没拿到（超时、EOF、回包形状不对），
// 回落那条就会再建一张，而两次调用都回成功。所以这里给 glab 一个脚本化的假远端，
// 把每一次调用的 argv 原文记下来，再按「远端真的收到几次写、多出几张票」判。
//
// 判据三条（票面 #722 的验收）：
//   ① 正常一次调用：只发一次建票写请求，argv 与 URL 原文如证据块所示；
//   ② 拿到任何「可能已经写出去」的回包（回包丢了、超时、回包形状不对、5xx）→ 绝不再发第二次写，
//      如实返回不确定，并把幂等键写在那句话里；
//   ③ 同一个幂等键提交两次 → 第二次一个字节都不往远端写，复用第一张票、返回同一个 key。
// 另外两条现场：确定没发出去（glab 没跑起来）时允许再发一次，但远端只收到第二次那一次；
// 远端说端点不存在（404）时确定没建出票，也不再发第二次。
//
// 反证（✗ probe）分两层：判据本体不空转（把「两条路都试」的账本喂给判据，必须报违规）；
// 把实现改回「两条路都试」或把幂等锚关掉，整条门禁必须变红（现场实验的输出原文见 T18 报告）。
//
// 用法（仓库根目录）：node tests/verify-gitlab-single-write.js

import { createRegistry } from '../src/host/tracker/registryCore.js'
import { gitlabBackend } from '../src/host/tracker/backends/gitlab/index.js'
import { anchorLineFor } from '../src/shared/refresh/idempotency.js'

const GL_REPO = { backend: 'gitlab', refId: 'acme/demo', name: 'demo', url: '' }
const KNOWN_KINDS = ['env', 'not-found', 'network', 'parse', 'auth', 'ratelimit', 'unsupported', 'conflict']

let failed = false
let total = 0
function check(ok, msg, detail) {
  total++
  if (ok) console.log('  PASS ' + msg)
  else { failed = true; console.log('  FAIL ' + msg + (detail ? ' —— ' + detail : '')) }
}

// ─────────────────────────────────────────────────────────────────────────────
// 一、脚本化的假远端 + 假 glab
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 一个按 GitLab 真实行为回答的假远端。它记三样东西：
 *   · calls —— 每一次 glab 调用的账：argv 原文、方法、路径、有没有真的发到远端；
 *   · tickets —— 假远端上真实存在的票（票面的 description 里带着我们写下去的那一行锚）；
 *   · 写请求只有打到集合端点 projects/<repo>/issues 才算，且**只有 POST 会建出票**：
 *     GitLab 的集合端点不接受 PUT（照真实行为回 404，什么都不建），这一点是判「两条路都试」的要害。
 *
 * @param {{mode?: string, searchMiss?: boolean, failToStartOnWriteTry?: number|string}} opts
 *   mode 取值见下面 remoteWrite；failToStartOnWriteTry 是「第几次建票写尝试根本没跑起来 glab」，
 *   可以给 'all'（每一次都没跑起来）。
 */
function makeFakeGitlab(opts) {
  const o = opts || {}
  const tickets = []
  const calls = []
  let writeTries = 0

  const flagOf = (args, name) => { const i = args.indexOf(name); return i >= 0 ? String(args[i + 1] == null ? '' : args[i + 1]) : '' }
  const fieldsOf = (args) => {
    const out = {}
    for (let i = 0; i < args.length; i++) {
      if (args[i] !== '-f' || typeof args[i + 1] !== 'string') continue
      const eq = args[i + 1].indexOf('=')
      if (eq > 0) out[args[i + 1].slice(0, eq)] = args[i + 1].slice(eq + 1)
    }
    return out
  }
  const notFound = { code: 1, stdout: '', stderr: '404 Not Found {"message":"404 Not Found"}' }

  /** 一次写请求到了远端的回答。 */
  function remoteWrite(method, fields, entry) {
    // 只有 POST 能建票。PUT / DELETE 打到集合端点：照 GitLab 真实行为回 404，什么都不建。
    if (method !== 'POST') return notFound
    if (o.mode === 'endpoint-absent') return notFound
    if (o.mode !== 'server-error') {
      const iid = tickets.length + 1
      tickets.push({ iid, title: String(fields.title || ''), description: String(fields.description || ''), state: 'opened' })
      entry.landed = true
    }
    if (o.mode === 'lost-response') return { code: 1, stdout: '', stderr: 'EOF（假远端：回包在回程丢了，票其实已经建好）' }
    if (o.mode === 'timeout') return { code: 1, stdout: '', stderr: 'context deadline exceeded: Client.Timeout exceeded while awaiting headers' }
    if (o.mode === 'odd-answer') return { code: 0, stdout: JSON.stringify({ message: '假远端：回包形状不对（探针脚本）' }), stderr: '' }
    if (o.mode === 'server-error') return { code: 1, stdout: '', stderr: '500 Internal Server Error' }
    return { code: 0, stdout: JSON.stringify(tickets[tickets.length - 1]), stderr: '' }
  }

  /** 一次读请求到了远端的回答（回查用的搜索与列表、以及建完以后的附注与关联）。 */
  function remoteRead(path, entry) {
    const q = path.split('?')[1] || ''
    if (q.indexOf('search=') >= 0) {
      // searchMiss：模拟 GitLab 的搜索索引还没建好（刚建完的票搜不到），退回「列出来逐张看票面」那条路。
      if (o.searchMiss) return { code: 0, stdout: '[]', stderr: '' }
      const key = decodeURIComponent((/search=([^&]*)/.exec(q) || [])[1] || '')
      return { code: 0, stdout: JSON.stringify(tickets.filter((t) => String(t.description).indexOf(key) >= 0)), stderr: '' }
    }
    if (q.indexOf('order_by=created_at') >= 0) return { code: 0, stdout: JSON.stringify(tickets), stderr: '' }
    entry.kind = 'other-read'
    return { code: 0, stdout: '[]', stderr: '' }
  }

  const exec = async (cmd, args) => {
    const method = flagOf(args, '--method') || 'GET'
    const path = String(args[1] || '')
    const onCollection = /^projects\/[^/]+\/issues$/.test(path.split('?')[0])
    const isWrite = onCollection && method !== 'GET'
    const entry = { line: 'glab ' + args.join(' '), argv: args.slice(), method, path, kind: isWrite ? 'create-write' : 'read', reachedServer: true }
    calls.push(entry)
    if (cmd !== 'glab') return { code: 1, stdout: '', stderr: '假远端没脚本化这条命令: ' + cmd }
    if (!isWrite) return remoteRead(path, entry)
    writeTries += 1
    if (o.failToStartOnWriteTry === 'all' || o.failToStartOnWriteTry === writeTries) {
      entry.reachedServer = false // 这台机器上 glab 根本没跑起来：请求一个字节都没发出去
      return { code: 127, stdout: '', stderr: 'glab: command not found' }
    }
    return remoteWrite(method, fieldsOf(args), entry)
  }

  return { exec, calls, tickets, writeTries: () => writeTries }
}

/** 远端后端探针用的调用上下文（platform + 脚本化的命令行，形状同 tracker-contract 那一段）。 */
function ctxFor(fake) {
  return {
    cwd: 'C:/ws/fake',
    platform: {
      resolveExecutable: async (n) => (n === 'glab' ? 'C:/usr/local/bin/glab' : null),
      path: { join: (...p) => p.join('/') },
      env: { get: () => undefined },
    },
    exec: (cmd, args) => fake.exec(cmd, args),
    isEnabled: () => false,
    logEvent: () => {},
  }
}

/** 用一份**全新**的注册表与后端实例建票（模拟「进程重启之后再来一次」）。 */
async function createOnce(fake, input) {
  const reg = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
  const d = reg.register(gitlabBackend)
  try {
    return await reg.get('gitlab').create(GL_REPO, input, ctxFor(fake))
  } finally { d.dispose() }
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、判据本体：一次调用的账本合不合规
// ─────────────────────────────────────────────────────────────────────────────

/** 把一次调用期间记下来的调用账，算成「本机发起几次写尝试、真的发出去几次、argv 原文是什么」。 */
function writeLedger(calls) {
  const attemptList = calls.filter((c) => c.kind === 'create-write')
  return {
    attempts: attemptList.length, // 本机发起的建票写尝试（含根本没跑起来的那次）
    sent: attemptList.filter((c) => c.reachedServer).length, // 真的发到远端的写请求
    argvs: attemptList.map((c) => c.line),
  }
}

/**
 * 判据本体：给出「这一次调用的账本」与「调用之后远端上的票」，返回违规清单（空 = 合规）。
 * 一条调用里，真的发到远端的建票写请求多于一次就算违规 —— 那正是「先试 A 失败再试 B」的形状；
 * 一次调用之后远端多出一张以上的票同样算违规（重复建票）。
 */
function judgeCall(ledger, ticketsAfter) {
  const bad = []
  if (ledger.sent > 1) bad.push('这一次调用里，真的发到建票端点的写请求有 ' + ledger.sent + ' 次（一次调用只许一次）：' + JSON.stringify(ledger.argvs))
  if (ticketsAfter > 1) bad.push('这一次调用之后，远端多出了 ' + ticketsAfter + ' 张票（一次调用只许多出一张）')
  return bad
}

/** 从一次调用账里切出属于这一次调用的那一段（calls 从 fromIndex 开始）。 */
const since = (fake, fromIndex) => fake.calls.slice(fromIndex)

// ─────────────────────────────────────────────────────────────────────────────
// 三、现场
// ─────────────────────────────────────────────────────────────────────────────

const SCENARIOS = [
  { name: '正常一次调用', opts: {}, expect: { ok: true, attempts: 1, sent: 1, tickets: 1, uncertain: false } },
  { name: '写进去了、回包丢了（EOF）', opts: { mode: 'lost-response' }, expect: { ok: false, attempts: 1, sent: 1, tickets: 1, uncertain: true } },
  { name: '回包等超时', opts: { mode: 'timeout' }, expect: { ok: false, attempts: 1, sent: 1, tickets: 1, uncertain: true } },
  { name: '回包形状不对（票其实已经建出）', opts: { mode: 'odd-answer' }, expect: { ok: false, attempts: 1, sent: 1, tickets: 1, uncertain: true } },
  { name: '远端 5xx（写可能没落地）', opts: { mode: 'server-error' }, expect: { ok: false, attempts: 1, sent: 1, tickets: 0, uncertain: true } },
  { name: '远端说端点不存在（404）', opts: { mode: 'endpoint-absent' }, expect: { ok: false, attempts: 1, sent: 1, tickets: 0, kind: 'not-found', certainNoTicket: true } },
  { name: '本机第一次写尝试时 glab 没跑起来', opts: { failToStartOnWriteTry: 1 }, expect: { ok: true, attempts: 2, sent: 1, tickets: 1, uncertain: false } },
  { name: '本机两次写尝试都没跑起来', opts: { failToStartOnWriteTry: 'all' }, expect: { ok: false, attempts: 2, sent: 0, tickets: 0, kind: 'env', neverSent: true } },
]

async function main() {
  console.log('GitLab 建票单次写入门禁（#722：一次 create 只做一次写尝试）')

  console.log('\n— 断言一 · 一次调用发几次写请求、argv 原文是什么 —')
  for (const s of SCENARIOS) {
    const fake = makeFakeGitlab(s.opts)
    const from = fake.calls.length
    const res = await createOnce(fake, { title: '门禁探针票', body: '正文在这里' })
    const ledger = writeLedger(since(fake, from))
    const e = s.expect
    console.log('  场景「' + s.name + '」假远端收到的 argv：')
    ledger.argvs.forEach((l, i) => console.log('    #' + (i + 1) + '  ' + l))
    console.log('    本机写尝试 ' + ledger.attempts + ' 次 / 真的发出去 ' + ledger.sent + ' 次 / 假远端上的票 ' + fake.tickets.length + ' 张')
    const bad = judgeCall(ledger, fake.tickets.length)
    check(bad.length === 0, '场景「' + s.name + '」：一次调用里发到远端的建票写请求不超过一次，也没多建票', bad.join('；'))
    check(ledger.attempts === e.attempts && ledger.sent === e.sent && fake.tickets.length === e.tickets,
      '场景「' + s.name + '」：本机写尝试 ' + e.attempts + ' 次 / 发出去 ' + e.sent + ' 次 / 远端 ' + e.tickets + ' 张票（与预期一致）',
      JSON.stringify(ledger))
    check(!!res.ok === !!e.ok, '场景「' + s.name + '」：调用结果 ' + (e.ok ? '成功' : '失败') + '（与预期一致）', JSON.stringify(res).slice(0, 200))
    if (!e.ok) {
      check(KNOWN_KINDS.includes(res.error && res.error.kind), '场景「' + s.name + '」：失败档位是既有枚举之一（' + (res.error && res.error.kind) + '）', JSON.stringify(res.error))
    }
    if (e.kind) check(res.error && res.error.kind === e.kind, '场景「' + s.name + '」：失败档位是 ' + e.kind, JSON.stringify(res.error))
    if (e.uncertain) {
      check(/可能已经建出来|有可能已经把票建出来/.test(String(res.error && res.error.message)) && /只发了 1 次建票写请求/.test(String(res.error && res.error.message)),
        '场景「' + s.name + '」：如实说「票可能已经建出来、这次只发了一次写、不会再发第二次」', String(res.error && res.error.message).slice(0, 200))
    }
    if (e.certainNoTicket) check(/确定没有建出票/.test(String(res.error && res.error.message)), '场景「' + s.name + '」：如实说「确定没有建出票」', String(res.error && res.error.message).slice(0, 200))
    if (e.neverSent) check(/没能跑起来|没发出去/.test(String(res.error && res.error.message)), '场景「' + s.name + '」：如实说「请求一个字节都没发出去」', String(res.error && res.error.message).slice(0, 200))
  }

  console.log('\n— 断言二 · 写请求的 URL 与参数形状（不是随便哪条 glab 命令都算）—')
  {
    const fake = makeFakeGitlab({})
    const from = fake.calls.length
    await createOnce(fake, { title: '形状探针', body: '正文', labels: ['bug'] })
    const writes = since(fake, from).filter((c) => c.kind === 'create-write')
    const argv = writes.length === 1 ? writes[0].argv : []
    check(writes.length === 1 && argv[2] === '--method' && argv[3] === 'POST',
      '这一次调用的建票写请求只有一条，方法是 POST', JSON.stringify(writes.map((c) => c.line)))
    check(argv[0] === 'api' && argv[1] === 'projects/acme%2Fdemo/issues',
      'URL 原文是 projects/acme%2Fdemo/issues（集合端点）', JSON.stringify(argv.slice(0, 2)))
    check(argv.includes('-f') && argv.includes('title=形状探针') && argv.includes('description=正文') && argv.includes('labels=bug'),
      '参数逐项 -f 带上 title / description / labels', JSON.stringify(argv))
  }

  console.log('\n— 断言三 · 同一个幂等键提交两次：第二次一个字节都不往远端写 —')
  {
    const fake = makeFakeGitlab({ searchMiss: true }) // 搜索索引还没建好：必须靠「列出来逐张看票面」复用
    const key = 'gl-722-a1'
    const from1 = fake.calls.length
    const r1 = await createOnce(fake, { title: '幂等探针', body: '正文', idempotencyKey: key })
    const first = writeLedger(since(fake, from1))
    check(r1.ok === true && !!r1.data.key, '第一次带锚建票成功', JSON.stringify(r1).slice(0, 200))
    check(judgeCall(first, fake.tickets.length).length === 0 && first.attempts === 1 && first.sent === 1 && fake.tickets.length === 1,
      '第一次：本机写尝试 1 次、发出去 1 次、远端 1 张票', JSON.stringify(first))
    check(fake.tickets.length === 1 && String(fake.tickets[0].description).split('\n')[0] === anchorLineFor(key).trim(),
      '锚确实写在建票请求的正文第一行（回查凭它找票）', JSON.stringify(String(fake.tickets[0] && fake.tickets[0].description).slice(0, 80)))

    const from2 = fake.calls.length
    const r2 = await createOnce(fake, { title: '幂等探针', body: '正文', idempotencyKey: key })
    const second = writeLedger(since(fake, from2))
    check(r2.ok === true && r1.ok === true && r2.data.key === r1.data.key, '第二次返回同一个 key（复用那张票）', JSON.stringify({ k1: r1.data && r1.data.key, k2: r2.data && r2.data.key }))
    check(second.attempts === 0 && second.sent === 0 && fake.tickets.length === 1,
      '第二次一个字节都没往远端写（本机写尝试 0 次），远端仍然只有 1 张票', JSON.stringify({ second, tickets: fake.tickets.length }))
    check(since(fake, from2).every((c) => c.kind !== 'create-write'),
      '第二次那一段账里没有一条建票写请求（argv 原文里没有 --method POST 打到集合端点）', JSON.stringify(second.argvs))
  }

  console.log('\n— 反证 · 判据本体不空转（把「两条路都试」的账本喂给它，它必须报违规） —')
  {
    const twoPaths = { attempts: 2, sent: 2, argvs: ['glab api projects/acme%2Fdemo/issues --method PUT -f title=x', 'glab api projects/acme%2Fdemo/issues --method POST -f title=x'] }
    const badTwo = judgeCall(twoPaths, 2)
    check(badTwo.length > 0 && /真的发到建票端点的写请求有 2 次/.test(badTwo.join('；')), '✗ probe：「一条 PUT 一条 POST」的账本被逮住（这一次调用有两次写）', JSON.stringify(badTwo))
    const badDup = judgeCall({ attempts: 1, sent: 1, argvs: ['glab api projects/acme%2Fdemo/issues --method POST -f title=x'] }, 2)
    check(badDup.length > 0 && /多出了 2 张票/.test(badDup.join('；')), '✗ probe：一次调用之后远端多出两张票，被逮住', JSON.stringify(badDup))
    const clean = judgeCall({ attempts: 1, sent: 1, argvs: ['glab api projects/acme%2Fdemo/issues --method POST -f title=x'] }, 1)
    check(clean.length === 0, '合规的账本（一条写、一张票）不报违规（判据不会乱红）', JSON.stringify(clean))
  }

  console.log('\n' + (failed ? '存在失败' : '全部通过 — GitLab 建票一次调用只做一次写尝试（' + total + ' 条断言）'))
  console.log('提示：本门禁还没接进 npm run verify 链；请统筹者在 package.json 的 scripts.verify 里加一节：node tests/verify-gitlab-single-write.js')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
