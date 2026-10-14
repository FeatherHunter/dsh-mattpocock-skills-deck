/**
 * tests/fixtures/error-samples.js —— 错误判档的「真实原文」夹具（票 #1111）
 *
 * 这份表是门禁 `tests/verify-error-rule-samples.js` 的证据表：每条夹具是一段**真实出现过**的
 * 报错原文，外加它应该被判成哪一档。门禁拿着它跑判档，档位对不上就红。
 *
 * 为什么每条都要标 `source`（来源）：这份表最容易出的事，是有人顺手编一句「看起来像」的英文
 * 报错塞进来当真实原文 —— 那样断言的是想象，不是事实。所以：
 *   · source 只能取下面 `SAMPLE_SOURCES` 里的值；
 *   · 凡来源写着「规则自带样本」或「后端扩展项自带样本」的，条目的 `trace` 必须在 `traceFile`
 *     里逐字出现（门禁去盘上核对，编不出来）；
 *   · 票面来源的两条实测错例另有出处：ADR 第 1 节把两句原文都抄了下来，`traceFile` 指向那份 ADR。
 *
 * 两条被点名的实测错例（`regression: true`）是这张表的主证据，删掉它们门禁会红：
 *   1) `403` 加 `API rate limit exceeded …` —— 曾被判成「没登录」，让人白去登录一轮；
 *   2) `getaddrinfo ENOTFOUND api.github.com` —— 曾被 `not ?found` 吞成「找不到」，
 *      界面于是让人去核对一个根本不存在的标签（#620 实测复现）。
 */

/** 夹具允许出现的来源。新增来源要同时改门禁里的白名单（那里会逐条核对）。 */
const SAMPLE_SOURCES = {
  /** 票面 #1111 Problem Statement 里记下的、实际发生过的原文。 */
  TICKET: '票面 #1111',
  /** 票面提到、但仓内没有第二处逐字出处的真实命令行原文（出处写在 provenanceNote 里）。 */
  TICKET_EXCERPT: '票面 #1111（Lead 摘录）',
  /** 规则表里那条规则自己带的样本（error-rules.ts 的 example）。 */
  RULE_SAMPLE: '规则自带样本',
  /** 某个后端的扩展表里那条规则自己带的样本。 */
  BACKEND_SAMPLE: '后端扩展项自带样本',
}

/**
 * 夹具。字段含义：
 *   id            稳定标识，改动时不要换名字（报告与门禁断言按它点名）
 *   note          这条挡的是哪种故障（写给人看，一句话）
 *   source        来源，取值见 SAMPLE_SOURCES
 *   text          原文（判档用的 text 段）
 *   status        有 HTTP 状态码就填，没有就别猜（判档的 fact 层只认这里给的值）
 *   errCode       有 errno 名就填（判档的 errcode 层）
 *   expectKind    应当判成的档位（八档之一，取值见 contract/vocabulary.ts 的 ERROR_KIND）
 *   expectLayer   应当由哪一层规则认走（fact / errcode / phrase / vague / fallback）
 *   expectVia     应当由谁认走：'extension'（本家扩展表）或 'common'（通用表）；不填表示不指定
 *   via           这条夹具同时用哪个后端入口跑一遍（'github' / 'gitlab' / 不填表示只跑通用表）
 *   regression    是不是票面点名的那两条实测错例
 *   traceFile     出处文件（相对仓库根）；与 trace 一起给，门禁去盘上逐字核对
 *   trace         必须出现在 traceFile 里的原文片段；票面摘录那条没有仓内出处，给 null
 *   provenanceNote trace 为 null 时必须写清出处，门禁会要求它非空
 */
const ERROR_SAMPLES = [
  {
    id: 'gh-403-rate-limit',
    note: '实测错例一：GitHub 限流回的是 HTTP 403 加限流文案，必须判成限流而不是没登录',
    source: SAMPLE_SOURCES.TICKET,
    text: 'gh: API rate limit exceeded for user ID 1. (HTTP 403)',
    status: 403,
    expectKind: 'rate-limit',
    expectLayer: 'fact',
    via: 'github',
    regression: true,
    traceFile: 'src/tracker/kernel/error-rules.ts',
    trace: 'gh: API rate limit exceeded for user ID 1. (HTTP 403)',
  },
  {
    id: 'rate-limit-phrase',
    note: '实测错例一的原文原句（不靠状态码也给限流）：只有限流文案时走短语层',
    source: SAMPLE_SOURCES.TICKET,
    text: 'API rate limit exceeded for user ID 1.',
    expectKind: 'rate-limit',
    expectLayer: 'phrase',
    regression: true,
    traceFile: 'docs/adr/20261014-error-classification-single-source.md',
    trace: 'API rate limit exceeded',
  },
  {
    id: 'dns-enotfound-bare-text',
    note: '实测错例二：真实观测到的写法没有 errCode 字段，全靠原文里的 ENOTFOUND 词边界认出来',
    source: SAMPLE_SOURCES.TICKET,
    text: 'getaddrinfo ENOTFOUND api.github.com',
    expectKind: 'network',
    expectLayer: 'errcode',
    regression: true,
    traceFile: 'docs/adr/20261014-error-classification-single-source.md',
    trace: 'getaddrinfo ENOTFOUND api.github.com',
  },
  {
    id: 'dns-enotfound-err-code',
    note: '同一句原文带上机器给的 errCode 时，走错误码名那一层，结论不变',
    source: SAMPLE_SOURCES.RULE_SAMPLE,
    text: 'getaddrinfo ENOTFOUND api.github.com',
    errCode: 'ENOTFOUND',
    expectKind: 'network',
    expectLayer: 'errcode',
    via: 'github',
    traceFile: 'src/tracker/kernel/error-rules.ts',
    trace: 'getaddrinfo ENOTFOUND api.github.com',
  },
  {
    id: 'gh-http-404',
    note: '真实 gh 输出里的 404：原文里带着状态码，归资源不存在',
    source: SAMPLE_SOURCES.TICKET_EXCERPT,
    text: 'gh: Not Found (HTTP 404)',
    expectKind: 'not-found',
    expectLayer: 'fact',
    via: 'github',
    trace: null,
    provenanceNote: '票面里提到「若干真实 gh 报错原文」，这一句由 Lead 在 task-5 规格里逐字给出，仓内没有第二处出处',
  },
  {
    id: 'glab-command-not-found',
    note: '本机没装 glab 的命令行原话：归环境档，不许被「not found」吞成资源不存在（#124 铁律）',
    source: SAMPLE_SOURCES.RULE_SAMPLE,
    text: 'sh: 1: glab: command not found',
    expectKind: 'env',
    expectLayer: 'phrase',
    via: 'gitlab',
    traceFile: 'src/tracker/kernel/error-rules.ts',
    trace: 'sh: 1: glab: command not found',
  },
  {
    id: 'eacces-permission-denied',
    note: '真实 Node 的 EACCES 原话：权限不够归认证/权限档（八档里没有单列一档）',
    source: SAMPLE_SOURCES.RULE_SAMPLE,
    text: "EACCES: permission denied, open '/etc/hosts'",
    expectKind: 'auth',
    expectLayer: 'errcode',
    traceFile: 'src/tracker/kernel/error-rules.ts',
    trace: "EACCES: permission denied, open '/etc/hosts'",
  },
  {
    id: 'eacces-bare',
    note: '同上但更短的一句（票面点名的真实原文）：只有 errno 名与短语，照样归认证/权限档',
    source: SAMPLE_SOURCES.RULE_SAMPLE,
    text: 'EACCES: permission denied',
    expectKind: 'auth',
    expectLayer: 'errcode',
    traceFile: 'src/tracker/kernel/error-rules.ts',
    trace: 'EACCES: permission denied',
  },
  {
    id: 'unexpected-token-json',
    note: '回包不是 JSON（多半是上游回了 HTML 错误页）：归解析档',
    source: SAMPLE_SOURCES.RULE_SAMPLE,
    text: 'Unexpected token < in JSON at position 0',
    expectKind: 'parse',
    expectLayer: 'vague',
    traceFile: 'src/tracker/kernel/error-rules.ts',
    trace: 'Unexpected token < in JSON at position 0',
  },
  {
    id: 'git-connect-timeout',
    note: '真实 git 连不上 api.github.com 的原话：归网络档，不许掉进「找不到」',
    source: SAMPLE_SOURCES.RULE_SAMPLE,
    text: "fatal: unable to access 'https://api.github.com/': Failed to connect to api.github.com port 443: Connection timed out",
    expectKind: 'network',
    expectLayer: 'phrase',
    via: 'github',
    traceFile: 'src/tracker/kernel/error-rules.ts',
    trace: 'Failed to connect to api.github.com port 443: Connection timed out',
  },
  {
    id: 'gh-auth-login-hint',
    note: '真实 gh 未登录时给的指路话：归认证档',
    source: SAMPLE_SOURCES.RULE_SAMPLE,
    text: 'gh: To get started with GitHub CLI, please run: gh auth login',
    expectKind: 'auth',
    expectLayer: 'phrase',
    traceFile: 'src/tracker/kernel/error-rules.ts',
    trace: 'gh: To get started with GitHub CLI, please run: gh auth login',
  },
  {
    id: 'enoent-missing-file',
    note: '本机缺文件的 ENOENT：归环境档，必须排在「找不到」之前',
    source: SAMPLE_SOURCES.RULE_SAMPLE,
    text: "ENOENT: no such file or directory, open '/tmp/x'",
    expectKind: 'env',
    expectLayer: 'errcode',
    via: 'gitlab',
    traceFile: 'src/tracker/kernel/error-rules.ts',
    trace: "ENOENT: no such file or directory, open '/tmp/x'",
  },
  {
    id: 'issue-not-found',
    note: '只有含糊短语时的资源不存在判断（词边界写法，ENOTFOUND 掉不到这里）',
    source: SAMPLE_SOURCES.RULE_SAMPLE,
    text: 'Issue not found',
    expectKind: 'not-found',
    expectLayer: 'vague',
    traceFile: 'src/tracker/kernel/error-rules.ts',
    trace: 'Issue not found',
  },
  {
    id: 'gh-could-not-resolve-repo',
    note: 'GitHub 说「解析不到这个仓库」的句式：归资源不存在，不许掉进兜底的网络',
    source: SAMPLE_SOURCES.BACKEND_SAMPLE,
    text: "Could not resolve to a Repository with the name 'nope/nope'.",
    expectKind: 'not-found',
    expectLayer: 'phrase',
    expectVia: 'extension',
    via: 'github',
    traceFile: 'src/tracker/rooms/github/errors.ts',
    trace: "Could not resolve to a Repository with the name 'nope/nope'.",
  },
  {
    id: 'glab-host-not-found',
    note: 'glab 说「这个 host 上没配过凭据」的原话：字面像 DNS，其实归认证档',
    source: SAMPLE_SOURCES.BACKEND_SAMPLE,
    text: 'glab: host not found for gitlab.example.com; run glab auth login',
    expectKind: 'auth',
    expectLayer: 'phrase',
    expectVia: 'extension',
    via: 'gitlab',
    traceFile: 'src/tracker/rooms/gitlab/errors.ts',
    trace: 'glab: host not found for gitlab.example.com; run glab auth login',
  },
  {
    id: 'glab-no-token',
    note: 'glab 找不到凭据的原话：归认证档（通用表的认证句式认不出它）',
    source: SAMPLE_SOURCES.BACKEND_SAMPLE,
    text: 'no token found for gitlab.com',
    expectKind: 'auth',
    expectLayer: 'phrase',
    expectVia: 'extension',
    via: 'gitlab',
    traceFile: 'src/tracker/rooms/gitlab/errors.ts',
    trace: 'no token found for gitlab.com',
  },
  {
    id: 'fallback-unknown',
    note: '一条规则都没认出来的原文：兜底归网络，且结果要标 fallback（调用方据此换通用提示）',
    source: SAMPLE_SOURCES.RULE_SAMPLE,
    text: 'zsh: segmentation fault (core dumped)',
    expectKind: 'network',
    expectLayer: 'fallback',
    traceFile: 'src/tracker/kernel/error-rules.ts',
    trace: 'zsh: segmentation fault (core dumped)',
  },
]

/** 票面点名、必须一直留在这张表里的两条实测错例（门禁按 id 点名，删了或改名都算红）。 */
const REQUIRED_REGRESSIONS = ['gh-403-rate-limit', 'rate-limit-phrase', 'dns-enotfound-bare-text']

module.exports = { ERROR_SAMPLES, SAMPLE_SOURCES, REQUIRED_REGRESSIONS }
