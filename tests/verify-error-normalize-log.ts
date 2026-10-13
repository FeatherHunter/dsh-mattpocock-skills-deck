#!/usr/bin/env node
/**
 * tests/verify-error-normalize-log.js —— #1111 决策 9：所有后端都留同一趟 `error.normalize`
 *
 * 守着的源码路径（按改动挑门禁时照这份清单）：
 *   src/tracker/error-rules.ts            emitNormalize / judgeFactsDetailed / emitPassthrough（字段由这里组装）
 *   src/tracker/preflight.ts              classifyError / verdictOf（透传那一路）
 *   src/tracker/rooms/github/errors.ts    classifyGhError（本家判档入口）
 *   src/tracker/rooms/gitlab/errors.js    classifyGlabError（本家判档入口）
 *   src/tracker/rooms/markdown/**         本后端有没有判档入口、有没有把判档上下文传下去
 *   research/489-appendix.md              第 1 章对照表里 error.normalize 那一行（字段名对不上就判红；
 *                                         读不到那一行才按 SKIP 记，因为可能只是事件改名了）
 *
 * 做法：造一个假的判档上下文 `{logEvent, isEnabled: () => true}`，驱动各后端的判档入口，
 * 断言确实发出了 `error.normalize`，且字段与 `error-rules.ts` 里实际组装的那一份**恰好一致**
 * （是恰好的集合，不是「至少包含」——多一个字段、少一个字段都算红）。
 *
 * 两件容易写错、这里专门定点的事：
 *   · 同一签名连着记第二次是噪音，代码里做了去重（`lastNormalizeSignature`）——
 *     所以每个用例都挑签名不同的输入，另外单列一段断言去重本身生效；
 *   · 日志红线：可重放的凭据原文永不落盘。给一段带假令牌的原文，断言日志字段里搜不到明文。
 *
 * 最后一段（I）是自证：拿「没发事件 / 少一个字段 / 档位记错 / 日志里出现令牌明文」四种反例
 * 试这道门禁会不会红 —— 不会红的门禁等于没写。
 *
 * 运行：node --import ./scripts/ts-hook.mjs tests/verify-error-normalize-log.js
 * 接线：由 Lead 统一挂进 scripts 里的门禁链（本次交付不动 scripts/**）。
 * 期望：全 PASS 退出码 0；SKIP 行表示读不到/尚未接线的部分（不算通过），末尾会汇总。
 */
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
let skips = 0
let notes = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const skip = (msg) => { skips += 1; console.log('  SKIP ' + msg) }
const note = (msg) => { notes += 1; console.log('  NOTE ' + msg) }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 代码里实际会出现的字段名（以 error-rules.ts 的组装为准）。多出来的键一律算红。 */
const ALLOWED_FIELDS = ['rawKind', 'mappedKind', 'layer', 'via', 'latencyMs', 'httpCode', 'exitCode', 'errCode']
/** 判档那一趟的固定五键；另有状态码/退出码/错误码名时各加一个。 */
const BASE_JUDGE_KEYS = ['layer', 'latencyMs', 'mappedKind', 'rawKind', 'via']
const keysWith = (extra) => (extra ? BASE_JUDGE_KEYS.concat([extra]) : BASE_JUDGE_KEYS.slice()).sort()
/** 透传那一路只记三个键（emitPassthrough 的组装，没有 via 也没有耗时）。 */
const PASSTHROUGH_KEYS = ['layer', 'mappedKind', 'rawKind']

/** 本次跑批收到的全部日志事件（最后用来核对字段名白名单）。 */
const ALL_EVENTS = []

/** 假上下文：把每次 logEvent 原样收下来；isEnabled 默认放行。 */
function recorder(enabled = true) {
  const events = []
  return {
    events,
    ctx: {
      logEvent: (level, event, fields) => {
        events.push({ level, event, fields })
        ALL_EVENTS.push({ level, event, fields })
      },
      isEnabled: () => enabled,
    },
  }
}

/** 一次判定应当报出的问题清单（空数组 = 这次判定与预期一人不差）。 */
function normalizeProblems(events, expectedKeys, expectedValues) {
  const bad = []
  const normalized = events.filter((e) => e.event === 'error.normalize')
  if (normalized.length !== 1) {
    bad.push('应当恰好发出 1 条 error.normalize，实得 ' + normalized.length + ' 条'
      + (events.length ? '（收到的事件：' + events.map((e) => e.event).join('、') + '）' : ''))
    return bad
  }
  const ev = normalized[0]
  if (ev.level !== 'debug') bad.push('事件级别应当是 debug，实得 ' + ev.level)
  const actual = Object.keys(ev.fields).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expectedKeys)) {
    bad.push('字段集合应当恰好是 ' + expectedKeys.join('、') + '，实得 ' + actual.join('、'))
  }
  for (const k of Object.keys(expectedValues)) {
    if (String(ev.fields[k]) !== String(expectedValues[k])) {
      bad.push(k + ' 应当是 ' + JSON.stringify(expectedValues[k]) + '，实得 ' + JSON.stringify(ev.fields[k]))
    }
  }
  return bad
}

/** 一次判定 + 断言：恰好一条 error.normalize，字段集合一字不差，指定字段值对得上。 */
function expectNormalize(label, events, expectedKeys, expectedValues) {
  const bad = normalizeProblems(events, expectedKeys, expectedValues)
  check(bad.length === 0, label + '：恰好一条 error.normalize，字段与代码实际组装的那份一字不差'
    + (bad.length ? ' —— ' + bad.join('；') : ''))
  return bad.length === 0 ? events.filter((e) => e.event === 'error.normalize')[0] : null
}

/** 在一段文本里找这些特征串（用来查日志有没有把原文或凭据写出去）。 */
function findLeaks(text, needles) {
  return needles.filter(([, needle]) => text.indexOf(needle) >= 0)
}

/** 从「backend」返回的判档结果里取档位：新写法给 `{kind, fallback}`，旧写法直接给字符串。 */
function kindOf(out) { return typeof out === 'string' ? out : (out && out.kind) }

/** 扫 markdown 目录里对 classifyError 的调用，数出有几处把判档上下文传了下去。 */
function scanMarkdownClassifyCalls(dirRel) {
  const dir = path.join(ROOT, dirRel)
  const out = { files: 0, total: 0, withCtx: 0 }
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(ts|js)$/.test(name) || /\.d\.ts$/.test(name)) continue
    // 同名 .ts 在场时，那个 .js 是构建产物，不数它
    if (name.endsWith('.js') && fs.existsSync(path.join(dir, name.replace(/\.js$/, '.ts')))) continue
    const src = readRel(path.posix.join(dirRel, name))
    if (src.indexOf('classifyError') < 0) continue
    out.files += 1
    // 只认「调用点」：classifyError 后面紧跟左括号。import { classifyError } 这种写法不算。
    const callRe = /classifyError\s*\(/g
    let m
    while ((m = callRe.exec(src)) !== null) {
      const open = m.index + m[0].length - 1
      let depth = 0
      let i = open
      for (; i < src.length; i++) {
        const c = src[i]
        if (c === '(') depth += 1
        else if (c === ')') { depth -= 1; if (depth === 0) break }
      }
      const args = src.slice(open + 1, i)
      out.total += 1
      if (args.indexOf(',') >= 0) out.withCtx += 1
      callRe.lastIndex = i
    }
  }
  return out
}

async function main() {
  const rulesMod = await imp('src/tracker/error-rules.ts')
  const { rawText } = rulesMod

  // ── A GitHub 判档入口 ────────────────────────────────────────────────────
  console.log('\nA GitHub 判档入口（本家扩展命中 / 通用表命中 / 退出码分支）')
  let gh = null
  try { gh = (await imp('src/tracker/rooms/github/errors.ts')).classifyGhError } catch (e) {
    skip('GitHub 判档入口读不进来 —— ' + String((e && e.message) || e))
  }
  if (typeof gh !== 'function') {
    if (gh !== null) skip('GitHub 模块里没有 classifyGhError 这个判档入口，没法驱动')
  } else {
    const a = recorder()
    const kindA = kindOf(gh({ status: 403, text: 'gh: API rate limit exceeded for user ID 1. (HTTP 403)' }, a.ctx))
    check(kindA === 'rate-limit', 'A1 上限流 403 判成 rate-limit（实得 ' + kindA + '）')
    expectNormalize('A1', a.events, keysWith('httpCode'),
      { rawKind: 'http:403', mappedKind: 'rate-limit', layer: 'fact', via: 'common', httpCode: 403 })

    const b = recorder()
    const kindB = kindOf(gh({ status: 404, text: 'HTTP 404: Not Found' }, b.ctx))
    check(kindB === 'not-found', 'A2 404 判成 not-found（实得 ' + kindB + '）')
    expectNormalize('A2', b.events, keysWith('httpCode'),
      { rawKind: 'http:404', mappedKind: 'not-found', layer: 'fact', via: 'common', httpCode: 404 })

    // gh 约定「需要登录 = 退出码 4」：这一段证明退出码作为结构化事实进了日志，
    // 而且是 GitHub 家扩展表里那条 `exitCode === 4` 的规则认走的（layer=fact、via=extension）
    const c = recorder()
    const kindC = kindOf(gh({ code: 4, message: 'gh: To get started with GitHub CLI, please run: gh auth login' }, c.ctx))
    check(kindC === 'auth', 'A3 退出码 4 判成 auth（实得 ' + kindC + '）')
    expectNormalize('A3', c.events, keysWith('exitCode'),
      { rawKind: 'exit:4', mappedKind: 'auth', layer: 'fact', via: 'extension', exitCode: 4 })
  }

  // ── B 跟踪器层判档入口（markdown 这类后端走的就是它）──────────────────────
  console.log('\nB 跟踪器层判档入口 classifyError（本后端不判档的后端走这条）')
  const { classifyError, fail } = await imp('src/tracker/preflight.ts')

  const d = recorder()
  // 原始错误值里的错误码名走 `code` / `errno` 两个字段（Node 的约定，见 factsFromError）
  const kindD = classifyError({ code: 'ENOTFOUND', text: 'getaddrinfo ENOTFOUND api.github.com' }, d.ctx)
  check(kindD === 'network', 'B1 DNS 失败判成 network（实得 ' + kindD + '）')
  expectNormalize('B1', d.events, keysWith('errCode'),
    { rawKind: 'errno:ENOTFOUND', mappedKind: 'network', layer: 'errcode', via: 'common', errCode: 'ENOTFOUND' })

  const e = recorder()
  classifyError({ text: 'getaddrinfo ENOTFOUND api.github.com' }, e.ctx)
  expectNormalize('B2', e.events, keysWith(null),
    { rawKind: 'unknown', mappedKind: 'network', layer: 'errcode', via: 'common' })

  // 已经整理好的事实对象走 judgeFactsDetailed（本后端自己攒事实时用这条路），错误码名照记
  const { judgeFactsDetailed } = rulesMod
  const e2 = recorder()
  const kindE2 = judgeFactsDetailed({ errCode: 'ECONNREFUSED', text: 'connect ECONNREFUSED 127.0.0.1:443' }, [], e2.ctx).kind
  check(kindE2 === 'network', 'B3 事实对象里的错误码名照样判成 network（实得 ' + kindE2 + '）')
  expectNormalize('B3', e2.events, keysWith('errCode'),
    { rawKind: 'errno:ECONNREFUSED', mappedKind: 'network', layer: 'errcode', via: 'common', errCode: 'ECONNREFUSED' })

  // ── C 透传那一路 ─────────────────────────────────────────────────────────
  console.log('\nC 已经是规范档位的失败（透传）：也留同一趟轨迹')
  const f = recorder()
  const kindF = classifyError({ kind: 'conflict', message: '版本对不上' }, f.ctx)
  check(kindF === 'conflict', 'C1 已是规范档位时原样透传（实得 ' + kindF + '）')
  expectNormalize('C1', f.events, PASSTHROUGH_KEYS,
    { rawKind: 'passthrough', mappedKind: 'conflict', layer: 'passthrough' })

  // ── D GitLab 判档入口 ────────────────────────────────────────────────────
  console.log('\nD GitLab 判档入口')
  let glab = null
  try { glab = (await imp('src/tracker/rooms/gitlab/errors.js')).classifyGlabError } catch (e) {
    skip('GitLab 判档入口读不进来 —— ' + String((e && e.message) || e))
  }
  if (typeof glab !== 'function') {
    if (glab !== null) skip('GitLab 模块里没有 classifyGlabError 这个判档入口，没法驱动')
  } else {
    if (glab.length < 2) {
      skip('GitLab 判档入口只收一个参数，判档上下文没有接线，所以它发不出 error.normalize（接口接上 ctx 后本项自动变断言）')
    } else {
      const g = recorder()
      const kindG = kindOf(glab({ text: 'glab: host not found for gitlab.example.com; run glab auth login' }, g.ctx))
      check(kindG === 'auth', 'D1 glab 的 host not found 判成 auth（实得 ' + kindG + '）')
      expectNormalize('D1', g.events, keysWith(null),
        { rawKind: 'unknown', mappedKind: kindG, layer: 'phrase', via: 'extension' })

      const h = recorder()
      const kindH = kindOf(glab({ kind: 'unsupported', message: '做不到' }, h.ctx))
      check(kindH === 'unsupported', 'D2 已是规范档位时原样透传（实得 ' + kindH + '）')
      expectNormalize('D2', h.events, PASSTHROUGH_KEYS,
        { rawKind: 'passthrough', mappedKind: 'unsupported', layer: 'passthrough' })
    }
  }

  // ── E 原文不进日志 ───────────────────────────────────────────────────────
  console.log('\nE 日志红线：可重放的凭据原文永不落盘')
  const GH_TOKEN = 'ghp_AAAABBBBCCCCDDDDEEEE1234'
  const URL_PASSWORD = 's3cretpw'
  const SECRET_TEXT = 'HTTP 429: Too Many Requests — Authorization: Bearer ' + GH_TOKEN
    + ' — see https://user:' + URL_PASSWORD + '@example.com/repo'
  const secretInput = { status: 429, text: SECRET_TEXT }
  const s = recorder()
  const kindS = classifyError(secretInput, s.ctx)
  check(kindS === 'rate-limit', 'E1 带令牌的原文照样判出档位（实得 ' + kindS + '）')
  expectNormalize('E1', s.events, keysWith('httpCode'),
    { rawKind: 'http:429', mappedKind: 'rate-limit', layer: 'fact', via: 'common', httpCode: 429 })

  const loggedText = JSON.stringify(s.events)
  const LEAK_NEEDLES = [
    ['令牌样式 ghp_', 'ghp_'],
    ['令牌内容', GH_TOKEN],
    ['URL 里的口令', URL_PASSWORD],
    ['原文片段（限流文案）', 'Too Many Requests'],
    ['原文片段（地址）', 'example.com'],
    ['授权头字样', 'Authorization'],
  ]
  const leaks = findLeaks(loggedText, LEAK_NEEDLES)
  check(leaks.length === 0, 'E2 日志字段里搜不到原文与凭据明文' + (leaks.length ? ' —— 泄漏：' + leaks.map(([n]) => n).join('、') : '（比对 ' + LEAK_NEEDLES.length + ' 个特征串）'))

  const raw = rawText(secretInput)
  const rawLeaks = findLeaks(raw, [['令牌内容', GH_TOKEN], ['URL 里的口令', URL_PASSWORD], ['令牌样式 ghp_', 'ghp_']])
  check(rawLeaks.length === 0 && raw.indexOf('凭据已遮蔽') >= 0,
    'E3 交给人的原文先遮蔽再截断：明文不在、遮蔽标记在' + (rawLeaks.length ? ' —— 明文仍在：' + rawLeaks.map(([n]) => n).join('、') : ''))

  // ── F 三条埋点纪律 ───────────────────────────────────────────────────────
  console.log('\nF 埋点纪律：同签名去重、开关关着零事件、没有上下文不抛错')
  const twice = { errCode: 'EAI_AGAIN', text: 'getaddrinfo EAI_AGAIN api.github.com' }
  const t = recorder()
  classifyError(twice, t.ctx)
  classifyError(twice, t.ctx)
  check(t.events.length === 1, 'F1 同一签名连着判两次只记一条（实得 ' + t.events.length + ' 条）')

  const off = recorder(false)
  const kindOff = classifyError({ text: 'Issue not found' }, off.ctx)
  check(kindOff === 'not-found' && off.events.length === 0, 'F2 调试开关关着时零事件，判档照常（档位 ' + kindOff + '，事件 ' + off.events.length + ' 条）')

  let noCtxThrew = null
  let kindNoCtx = null
  try { kindNoCtx = classifyError({ text: 'zsh: segmentation fault (core dumped)' }) } catch (e) { noCtxThrew = e }
  check(noCtxThrew === null && kindNoCtx === 'network', 'F3 没有判档上下文时不抛错、照常判档（档位 ' + String(kindNoCtx) + (noCtxThrew ? '，抛错 ' + noCtxThrew.message : '') + '）')

  // ── G markdown 后端 ──────────────────────────────────────────────────────
  console.log('\nG markdown 后端（本后端不判档时要说清，不许静默略过）')
  const md = scanMarkdownClassifyCalls('src/tracker/rooms/markdown')
  if (md.total === 0) {
    skip('markdown：本后端不判档（目录里没有 classifyError 调用），也没有本家判档入口 —— 这一条按「不适用」记，不算通过')
  } else if (md.withCtx === md.total) {
    check(true, 'markdown：' + md.total + ' 处 classifyError 调用都传了判档上下文，因此都留得下 error.normalize')
  } else {
    skip('markdown：本后端没有本家判档入口，直接调用跟踪器层 classifyError；盘上 ' + md.total + ' 处调用里只有 '
      + md.withCtx + ' 处传了判档上下文，其余发不出 error.normalize（它在跟踪器层那条路本身是会发的，见 B 段）—— 补线归 Markdown 房')
  }

  // ── H 字段名与附录对照表 ─────────────────────────────────────────────────
  console.log('\nH 字段名白名单与附录对照表')
  const unknownFields = []
  for (const ev of ALL_EVENTS) {
    for (const k of Object.keys(ev.fields)) if (ALLOWED_FIELDS.indexOf(k) < 0) unknownFields.push(k)
  }
  check(unknownFields.length === 0, 'H1 本次所有用例发出的字段都在允许清单里（共 '
    + ALL_EVENTS.length + ' 条事件，允许 ' + ALLOWED_FIELDS.join('、') + '）'
    + (unknownFields.length ? ' —— 多出：' + Array.from(new Set(unknownFields)).join('、') : ''))

  let appendixLine = ''
  let appendixLineNo = 0
  try {
    const appendixLines = readRel('research/489-appendix.md').split('\n')
    appendixLineNo = appendixLines.findIndex((l) => l.indexOf('error.normalize') >= 0) + 1
    appendixLine = appendixLineNo > 0 ? appendixLines[appendixLineNo - 1] : ''
  } catch (e) {
    appendixLine = ''
  }
  if (!appendixLine) {
    skip('research/489-appendix.md 里读不到 error.normalize 那一行，没法核对字段是否同步（归该附录维护者）')
  } else {
    const missing = ALLOWED_FIELDS.filter((k) => appendixLine.indexOf(k) < 0)
    check(missing.length === 0, 'H2 附录第 1 章对照表（research/489-appendix.md:' + appendixLineNo + '）列出了 error.normalize 会发的全部字段：'
      + ALLOWED_FIELDS.join('、')
      + (missing.length ? ' —— 那一行缺：' + missing.join('、') + '；按日志纪律「增删事件同步改附录对照表」补齐即可' : ''))
  }

  // ── I 自证：这道门禁本身有牙 ─────────────────────────────────────────────
  console.log('\nI 自证：拿反例试这道门禁会不会红（不会红的门禁等于没写）')
  const noEvent = normalizeProblems([], keysWith(null), { mappedKind: 'network' })
  check(noEvent.length > 0, 'I1 反例：一条事件都没发时判红' + (noEvent.length ? '（' + noEvent[0] + '）' : ''))

  const missingKey = normalizeProblems(
    [{ level: 'debug', event: 'error.normalize', fields: { rawKind: 'http:403', mappedKind: 'rate-limit', layer: 'fact', via: 'common', latencyMs: 1 } }],
    keysWith('httpCode'), { mappedKind: 'rate-limit' })
  check(missingKey.length > 0, 'I2 反例：少了 httpCode 这样的字段时判红' + (missingKey.length ? '（' + missingKey[0] + '）' : ''))

  const wrongValue = normalizeProblems(
    [{ level: 'debug', event: 'error.normalize', fields: { rawKind: 'http:403', mappedKind: 'auth', layer: 'fact', via: 'common', latencyMs: 1, httpCode: 403 } }],
    keysWith('httpCode'), { mappedKind: 'rate-limit' })
  check(wrongValue.length > 0, 'I3 反例：档位记成别的值时判红' + (wrongValue.length ? '（' + wrongValue[0] + '）' : ''))

  const caughtLeak = findLeaks('{"rawKind":"' + GH_TOKEN + '"}', LEAK_NEEDLES)
  check(caughtLeak.length > 0, 'I4 反例：日志里出现令牌明文时泄漏检查会逮住' + (caughtLeak.length ? '（命中 ' + caughtLeak.map(([n]) => n).join('、') + '）' : ''))

  // ── J 探测路径 ───────────────────────────────────────────────────────────
  // 探测编排层自己拼 OpContext（buildOpContextBase）。它带不带日志出口，决定「预检失败判成哪一档」
  // 这件事在 wf.detect / wf.chain 这条路上看不看得见（#1111 决策 9：所有后端都留同一趟 error.normalize）。
  // 这一段拿假的 registry 与假的日志出口走一遍真探测入口，只看外部可观察结果：预检回执里的档位与原文，
  // 以及那一条 error.normalize。用 503 是因为它在本文件里没被别的用例用过——归一埋点按签名去重，
  // 与前面某一段撞签名会让这条断言假红。
  console.log('\nJ 探测路径：探测编排层拼出的上下文要带上日志出口')
  const detectEvents = []
  // 平台层递进来的日志出口叫 fire/isEnabled（见 host/platformChannel.js 里 backendLogEvent 的用法），
  // 不是各房上下文里的 logEvent —— 探测编排层就是从这个出口转出来的。
  const detectLogCtx = {
    fire: (level, event, fields) => detectEvents.push({ level, event, fields }),
    isEnabled: (level) => level === 'debug',
  }
  const FAKE_RAW = 'HTTP 503: Service Unavailable — upstream connect error'
  const detectRegistry = {
    get: () => ({
      preflight: async (repoHandle, ctx) => {
        const kind = classifyError({ status: 503, text: FAKE_RAW }, ctx)
        return fail(kind, '代码托管服务暂时不可用，请稍后再试', FAKE_RAW)
      },
    }),
    select: async () => ({ backendId: 'fake', pending: false }),
    describe: () => ({ backendId: 'fake' }),
  }
  const detectFs = {
    resolve: async (p) => p,
    listDir: async () => [],
    readFile: async () => { throw new Error('no file') },
    stat: async () => { throw new Error('no file') },
    exists: async () => false,
  }
  const detectPlatform = { fs: detectFs, env: {}, path: { join: (...a) => a.join('/') } }
  let detectSvc = null
  try { detectSvc = (await imp('src/tracker/detection/detectionService.ts')).createDetectionService } catch (e) {
    skip('探测编排层读不进来 —— ' + String((e && e.message) || e))
  }
  if (typeof detectSvc === 'function') {
    const detectOutlet = async () => ({ backendId: 'fake' })
    detectOutlet.selectionFromOutlet = (o) => ({ backendId: o.backendId, pending: false })
    const svc = detectSvc({
      registry: detectRegistry,
      getPlatform: async () => detectPlatform,
      getFs: () => detectFs,
      getTimers: () => ({ setTimeout, clearTimeout }),
      skillProbe: async () => ({ ok: true, missing: [], probes: {} }),
      decideBackend: detectOutlet,
      logCtx: detectLogCtx,
    })
    let detectRes = null
    try { detectRes = await svc.detect({ cwd: ROOT }) } catch (e) { detectRes = null }
    const pf = detectRes && detectRes.preflight
    check(!!pf && pf.ok === false && pf.error && pf.error.kind === 'network',
      'J1 探测路径上的预检失败照样判出档位（预检 ok=' + String(pf && pf.ok) + '，档位 ' + String(pf && pf.error && pf.error.kind) + '）')
    check(!!pf && pf.ok === false && pf.error && pf.error.raw === FAKE_RAW,
      'J2 探测路径上的失败结果也带原文（实得 ' + JSON.stringify(pf && pf.error && pf.error.raw) + '）')
    expectNormalize('J3', detectEvents, keysWith('httpCode'),
      { rawKind: 'http:503', mappedKind: 'network', layer: 'fallback', via: 'common', httpCode: 503 })
  }

  console.log('\n' + (failed
    ? '存在失败 — #1111 归一埋点门禁未通过'
    : '全部通过 — #1111 归一埋点门禁（' + total + ' 项断言，' + skips + ' 项 SKIP，' + notes + ' 条 NOTE）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
