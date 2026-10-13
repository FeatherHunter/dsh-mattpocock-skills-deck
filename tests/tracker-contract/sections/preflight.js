/**
 * tests/tracker-contract/sections/preflight.js — preflight 判档段（票 #1111 按新规则表同步）。
 *
 * 判档现在的顺序是「按证据分层来」：src/tracker/error-rules.ts 里的 RULE_LAYERS 就是
 *   fact → errcode → phrase → vague → fallback
 *   fact     机器给的结构化事实（HTTP 状态码）：401→auth、403+限流文案→rate-limit、403→auth、404→not-found、429→rate-limit；
 *   errcode  错误码名：ENOENT→env、ENOTFOUND 等连接类码→network、EACCES/EPERM→auth；
 *   phrase   整句专有句式：command not found→env、rate limit→rate-limit、unauthorized→auth、连接层整句→network；
 *   vague    整句认不出、只剩含糊英文短语：not found→not-found、unsupported→unsupported、parse→parse、network→network；
 *   fallback 一条都没认出来 → network，而且调用方要据此换成 HINT_UNRECOGNIZED 的话术。
 *
 * 与上一版相比有两处实质变化，这一段的断言跟着改：
 *   一、不再讲「auth 先于 rate-limit」这条老先后关系。今天的规则是「403 加上限流文案」这条更具体的
 *       事实先认走，所以 403 限流的原文现在判 rate-limit —— 这正是票面记下的那起实测错判（光看 403
 *       会判成没登录，让人白去登录一轮）。
 *   二、失败结果里的 raw（后端原文，已遮蔽凭据、已头尾截断）是必填字段，这一节要真的断言它带得出来。
 */

import { classifyError, verdictOf, fail, HINT_UNRECOGNIZED, HINT_UNSUPPORTED } from '../../../src/tracker/preflight.ts'
import { ERROR_KIND } from '../../../src/tracker/contract/vocabulary.ts'

export async function run() {
  const out = []
  const P = 'preflight · '
  const assert = async (name, cond, detail) => {
    let ok = false
    try { ok = !!(await cond) } catch (e) { out.push({ name: P + name, ok: false, detail: String(e) }); return }
    out.push({ name: P + name, ok, detail: detail || '' })
  }

  // ── 第一层 fact：机器给的 HTTP 状态码，不看正文里写没写这几个字 ──────────────────
  await assert('fact：403 带限流文案 → rate-limit（不是 auth）',
    classifyError('403 rate limit exceeded') === ERROR_KIND.RATELIMIT,
    'got=' + classifyError('403 rate limit exceeded'))
  await assert('fact：403 不带限流文案 → auth（权限不足）',
    classifyError({ status: 403, text: 'Resource not accessible by integration' }) === ERROR_KIND.AUTH,
    'got=' + classifyError({ status: 403, text: 'Resource not accessible by integration' }))
  await assert('fact：401 → auth', classifyError({ status: 401 }) === ERROR_KIND.AUTH,
    'got=' + classifyError({ status: 401 }))
  await assert('fact：404 → not-found', classifyError({ status: 404 }) === ERROR_KIND.NOTFOUND,
    'got=' + classifyError({ status: 404 }))
  await assert('fact：429 → rate-limit', classifyError({ status: 429 }) === ERROR_KIND.RATELIMIT,
    'got=' + classifyError({ status: 429 }))

  // ── 第二层 errcode：认错误码名，整层排在句式之前 ────────────────────────────────
  await assert('errcode：ENOENT → env（本机缺文件/缺命令）',
    classifyError({ code: 'ENOENT', message: 'spawn gh ENOENT' }) === ERROR_KIND.ENV,
    'got=' + classifyError({ code: 'ENOENT', message: 'spawn gh ENOENT' }))
  await assert('errcode：ENOTFOUND 不会被「not found」这句话吞掉 → network',
    classifyError({ code: 'ENOTFOUND', stderr: 'getaddrinfo ENOTFOUND api.github.com: not found by resolver' }) === ERROR_KIND.NETWORK,
    'got=' + classifyError({ code: 'ENOTFOUND', stderr: 'getaddrinfo ENOTFOUND api.github.com: not found by resolver' }))
  await assert('errcode：EACCES → auth', classifyError({ code: 'EACCES', message: 'permission denied' }) === ERROR_KIND.AUTH,
    'got=' + classifyError({ code: 'EACCES', message: 'permission denied' }))

  // ── 第三层 phrase：整句专有句式 ─────────────────────────────────────────────────
  await assert('phrase：command not found → env（排在含糊的 not found 之前）',
    classifyError('command not found: gh') === ERROR_KIND.ENV,
    'got=' + classifyError('command not found: gh'))
  await assert('phrase：no such file → env', classifyError('no such file or directory: /x') === ERROR_KIND.ENV,
    'got=' + classifyError('no such file or directory: /x'))
  await assert('phrase：连接层整句 → network', classifyError("fatal: unable to access 'https://api.github.com/': Connection timed out") === ERROR_KIND.NETWORK,
    'got=' + classifyError("fatal: unable to access 'https://api.github.com/': Connection timed out"))
  await assert('phrase：限流文案 → rate-limit', classifyError('API rate limit exceeded for user ID 1.') === ERROR_KIND.RATELIMIT,
    'got=' + classifyError('API rate limit exceeded for user ID 1.'))
  await assert('phrase：未登录句式 → auth', classifyError('gh: To get started with GitHub CLI, please run: gh auth login') === ERROR_KIND.AUTH,
    'got=' + classifyError('gh: To get started with GitHub CLI, please run: gh auth login'))

  // ── 第四层 vague：只剩含糊英文短语 ──────────────────────────────────────────────
  await assert('vague：not found → not-found', classifyError('Issue not found') === ERROR_KIND.NOTFOUND,
    'got=' + classifyError('Issue not found'))
  await assert('vague：not implemented → unsupported', classifyError('not implemented by backend') === ERROR_KIND.UNSUPPORTED,
    'got=' + classifyError('not implemented by backend'))
  await assert('vague：invalid json → parse', classifyError('invalid json: syntax error') === ERROR_KIND.PARSE,
    'got=' + classifyError('invalid json: syntax error'))
  await assert('vague：fetch failed → network', classifyError('fetch failed ECONNREFUSED') === ERROR_KIND.NETWORK,
    'got=' + classifyError('fetch failed ECONNREFUSED'))

  // ── 第五层 fallback：一条都没认出来 ────────────────────────────────────────────
  await assert('fallback：认不出来 → network', classifyError('zsh: segmentation fault (core dumped)') === ERROR_KIND.NETWORK
    && classifyError('') === ERROR_KIND.NETWORK && classifyError(undefined) === ERROR_KIND.NETWORK,
    'got=' + classifyError('zsh: segmentation fault (core dumped)'))
  await assert('fallback：verdictOf 明确说这是兜底（调用方据此换 HINT_UNRECOGNIZED）',
    (() => { const v = verdictOf('zsh: segmentation fault (core dumped)'); return v.kind === ERROR_KIND.NETWORK && v.layer === 'fallback' && v.fallback === true })(),
    JSON.stringify(verdictOf('zsh: segmentation fault (core dumped)')))
  await assert('verdictOf 交出「这条档位是哪一层给的」：403 限流是 fact 层',
    (() => { const v = verdictOf('403 rate limit exceeded'); return v.kind === ERROR_KIND.RATELIMIT && v.layer === 'fact' && v.fallback === false })(),
    JSON.stringify(verdictOf('403 rate limit exceeded')))
  await assert('两句兜底话术都在，且是一句人看得懂的话',
    typeof HINT_UNRECOGNIZED === 'string' && HINT_UNRECOGNIZED.length >= 10
    && typeof HINT_UNSUPPORTED === 'string' && HINT_UNSUPPORTED.length >= 10,
    HINT_UNRECOGNIZED + ' / ' + HINT_UNSUPPORTED)

  // ── 透传：后端显式给的档位（conflict / unsupported）不再拿文本猜一遍 ──────────────
  await assert('透传：{kind:conflict}', classifyError({ kind: 'conflict', message: 'cycle detected' }) === ERROR_KIND.CONFLICT)
  await assert('透传：{error:{kind:unsupported}}', classifyError({ error: { kind: 'unsupported', message: '' } }) === ERROR_KIND.UNSUPPORTED)
  await assert('透传：verdictOf 记 passthrough，不记成某一层猜出来的',
    (() => { const v = verdictOf({ kind: 'conflict', message: 'cycle detected' }); return v.kind === ERROR_KIND.CONFLICT && v.layer === 'passthrough' && v.fallback === false })(),
    JSON.stringify(verdictOf({ kind: 'conflict', message: 'cycle detected' })))

  // ── fail()：第三段 raw 必填，而且真的把后端原文带出来 ────────────────────────────
  await assert('fail() 返回统一失败形状',
    (() => { const r = fail(ERROR_KIND.CONFLICT, 'self in blockers', ''); return r && r.ok === false && r.error.kind === 'conflict' && r.error.message === 'self in blockers' })(),
    JSON.stringify(fail(ERROR_KIND.CONFLICT, 'self in blockers', '')))
  await assert('fail() 的 raw 一定是字符串（没有原文时是空串，不能是 undefined）',
    (() => { const r = fail(ERROR_KIND.CONFLICT, 'self in blockers', '') ; return typeof r.error.raw === 'string' && r.error.raw === '' })(),
    JSON.stringify(fail(ERROR_KIND.CONFLICT, 'self in blockers', '')))
  await assert('fail() 多路合并：stderr 与 stdout 两段原文都要留下',
    (() => {
      const r = fail(ERROR_KIND.PARSE, '回包解析失败', { stderr: 'Unexpected token < in JSON', stdout: 'partial body' })
      return r.error.raw.indexOf('Unexpected token < in JSON') >= 0 && r.error.raw.indexOf('partial body') >= 0
    })(),
    JSON.stringify(fail(ERROR_KIND.PARSE, '回包解析失败', { stderr: 'Unexpected token < in JSON', stdout: 'partial body' }).error.raw))
  await assert('fail() 遮蔽凭据：原文里不留令牌明文，但留下「这里原本有凭据」的标记',
    (() => {
      const r = fail(ERROR_KIND.AUTH, '凭据无效', { stderr: 'HTTP 403: Bad credentials; Authorization: token ghp_abcdefghijklmnop' })
      return r.error.raw.indexOf('ghp_abcdefghijklmnop') < 0 && r.error.raw.indexOf('***') >= 0
    })(),
    JSON.stringify(fail(ERROR_KIND.AUTH, '凭据无效', { stderr: 'HTTP 403: Bad credentials; Authorization: token ghp_abcdefghijklmnop' }).error.raw))
  await assert('fail() 头尾截断：长原文保留结尾的错因（gh 的错因常在尾巴上）',
    (() => {
      const head = 'x'.repeat(900)
      const r = fail(ERROR_KIND.NETWORK, '连接失败', { stderr: head + '\nfatal: the real cause is here' })
      return r.error.raw.indexOf('（原文中间省略') >= 0 && r.error.raw.indexOf('fatal: the real cause is here') >= 0
    })(),
    String(fail(ERROR_KIND.NETWORK, '连接失败', { stderr: 'x'.repeat(900) + '\nfatal: the real cause is here' }).error.raw.length))

  // ✗ probe：分层顺序是真的 —— planted 一个「先看含糊短语再看整句」的错序分类器，
  //   它会把 command-not-found 判成「找不到」，而真分类器判成「环境问题」。
  await assert('✗ probe: 错序分类器（vague 先于 phrase）会把 command not found 误判为 not-found', (async () => {
    const wrongOrder = (msg) => (/\bnot\s+found\b/i.test(msg) ? ERROR_KIND.NOTFOUND : ERROR_KIND.ENV)
    const mis = wrongOrder('command not found: gh')
    return mis === ERROR_KIND.NOTFOUND && classifyError('command not found: gh') === ERROR_KIND.ENV
  })(), 'prove layer order is real (vague-first misclassifies)')

  // ✗ probe：confl 不靠猜 —— 正文里出现 conflict 这个单词，不得被判成 conflict（它只能由后端显式给出）。
  await assert('✗ probe: conflict 靠透传不靠文本', classifyError('a conflict happened in some account') !== ERROR_KIND.CONFLICT,
    'got=' + classifyError('a conflict happened in some account'))

  return out
}

export default { name: 'preflight', run }
