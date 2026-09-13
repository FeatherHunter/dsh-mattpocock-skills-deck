/**
 * backends/github/label-colors-ops.js — 标签配色契约里那两条操作在 GitHub 房间的实现（#620 落地）。
 * 以后谁改它：改「GitHub 上怎么列全部标签」「改颜色怎么调 gh、失败了落哪一档」的人。
 *
 * 契约（#627 定版，正文见 src/host/tracker/contract.js 的「标签配色契约」一节）：
 *   listLabels(repo, ctx)                → {ok:true, data: LabelColor[]}，每条只有 name / color / 可选 description
 *   setLabelColors(repo, changes, ctx)   → {ok:true, data: {applied, failed}}，逐条记账
 * 两条的共同规矩：颜色统一是不带井号的六位十六进制小写；入参里每一条改动必须恰好出现在
 * applied 或 failed 之一；列标签取不全时必须整体失败，不许把残缺清单当全量发出去。
 *
 * 三个容易踩的点（都在 research/612-github-label-write.md 里有实测）：
 *   一、`gh label list` 默认只回 30 条，不传 `--limit` 时标签多的仓库会静默少一截 —— 所以要传，而且
 *       拿到「正好等于上限」的条数时当作「可能没拿全」，整条操作失败。
 *   二、`gh label edit` 的「标签不存在」「仓库不存在」「你没有写权限」返回的是同一句 HTTP 404，
 *       光看错误文本分不开，撞到 404 时得自己再问一次 `gh repo view --json viewerPermission`。
 *   三、「没登录」的退出码是 4（不是 1，见 `gh help exit-codes`），所以只认退出码、不靠文案巧合。
 *
 * 只改颜色：发出去的命令只有 `gh label edit <名字> --repo <仓库> --color <颜色>`，
 * 不带 `--name`、不带 `--description`，也不建标签、不删标签。
 *
 * 还有一个只有在真机上才看得见的坑（#620 整改 D1）：宿主递过来的仓库标识（repo.refId）**常常是空的**
 * （注册表出 RepositoryRef 时只认显式给的那一个）。这两条操作因此会自己再解析一次 owner/name
 * （见 resolveRepoTarget），否则在真实 GitHub 工作区上会一律报「仓库不存在」、一条 gh 命令都发不出去。
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { normalizeColor } from '../../../../shared/label-color/colors.js'
import { fail } from '../../preflight.js'
import { ghClient } from './client.js'
import { classifyGhError } from './errors.js'
import { parseRepo, repoId } from './labels.js'
import { getRepoKey } from './repo.js'

/** 一次最多向 gh 要多少条标签。标签数达到这个数就当作「可能没拿全」，整条操作失败。 */
export const LABEL_LIST_LIMIT = 1000
/** 同时最多发几个改色请求。官方文档要求串行、每条之间最好隔一秒，所以默认逐条来，上限只到 4。 */
export const WRITE_CONCURRENCY_MAX = 4
export const WRITE_CONCURRENCY_DEFAULT = 1

function repoSpec(repo) {
  const parsed = parseRepo(repo)
  if (!parsed) return null
  return parsed.owner + '/' + parsed.name
}

/** 这次要动的仓库是哪个（`owner/name`）。
 *
 *  为什么不能只看宿主递过来的 repo.refId：#620 整改实测（D1）——**真实工作区里它常常是空的**。
 *  注册表出 RepositoryRef 时只认显式给的 refId（registryViews.js 的骨架回退对非本地后端回空串），
 *  「用户选定后端」那一步也没人给过 owner/name；于是这里一路空下去，两条操作在真仓库上
 *  **一律报「仓库不存在」、一条 gh 命令都发不出去**（fail-closed，不会改错仓库，但功能等于没接上）。
 *  所以拿不到时照本房间既有的三层兜底自己解析一次：git remote → .git/config → gh repo view
 *  （repo.js 的 getRepoKey，快照侧用的是同一个方法，口径一致）。 */
async function resolveRepoTarget(repo, ctx) {
  const spec = repoSpec(repo)
  if (spec) return { spec: spec }
  const cwd = ctx && typeof ctx.cwd === 'string' ? ctx.cwd : ''
  if (!cwd) return null
  let key = null
  try { key = await getRepoKey(cwd, ctx) } catch (e) { key = null }
  if (key && key.owner && key.name) return { spec: key.owner + '/' + key.name }
  return null
}

/** 认不出仓库时对用户说的话（这是用户在界面上会看到的那一句）。 */
function noRepoTarget(opCn, repo) {
  return opCn + '时没能认出这个工作区属于哪个 GitHub 仓库（宿主给的仓库标识是空的：'
    + (repoId(repo) || '（空）') + '，自己解析也没拿到 owner/name —— 这个目录可能不是 git 仓库、'
    + 'remote 没指向 GitHub，或者没登录 gh）。先给这个目录配好 GitHub 远端，或在面板里选定仓库，再试一次。'
}

/** 一条进给用户的错误（契约里 applied/failed 的 reason 只许 kind 与 message 两个键）。 */
function reason(kind, message) {
  return { kind: kind, message: message }
}

/** gh 报错原文只当证据用：截一段附在中文说明后面，太长就标已截断。 */
function rawHint(err) {
  const t = String((err && (err.message || err.stderr)) || '').trim().replace(/\s+/g, ' ')
  if (!t) return ''
  return '（gh 的原话：' + (t.length > 160 ? t.slice(0, 160) + '…已截断' : t) + '）'
}

// ── 列标签 ───────────────────────────────────────────────────────────────────

/** 列出这个仓库的全部标签与颜色（契约操作 listLabels）。
 *  「全部」＝仓库标签全量（含还没被任何票用到的）；取不全就整体失败，不返回残缺清单。 */
export async function listLabels(repo, ctx) {
  try {
    const c = ghClient(ctx)
    const target = await resolveRepoTarget(repo, ctx)
    if (!target) return fail(ERROR_KIND.NOTFOUND, noRepoTarget('列标签', repo))
    const r = await c.execGh(
      ['label', 'list', '--repo', target.spec, '--json', 'name,color,description', '--limit', String(LABEL_LIST_LIMIT)],
      { cwd: ctx && ctx.cwd }
    )
    if (!r.ok) return listFailure(r.error)
    const text = (r.data && r.data.stdout) || ''
    let arr = null
    try { arr = JSON.parse(text) } catch (e) {
      return fail(ERROR_KIND.ENV, '没能拿全标签：gh 回来的东西读不成标签清单（' + String((e && e.message) || e).slice(0, 120) + '）。这是插件这边的问题，不是你操作错了。')
    }
    if (!Array.isArray(arr)) {
      return fail(ERROR_KIND.ENV, '没能拿全标签：gh 回来的标签清单不是一份清单（应当是一个数组）。这是插件这边的问题，不是你操作错了。')
    }
    if (arr.length >= LABEL_LIST_LIMIT) {
      return fail(ERROR_KIND.ENV, '没能拿全标签：这个仓库的标签条数到了插件一次能问的上限 ' + LABEL_LIST_LIMIT + ' 条，没法确认后面还有没有。这是插件这边的限制，不是你操作错了。')
    }
    return { ok: true, data: arr.map(toLabelColor).filter(Boolean) }
  } catch (err) {
    return fail(classifyGhError(err, ctx), String((err && err.message) || err))
  }
}

/** 一条 gh 回的标签 → 契约的列表项。只保留三个键，描述给不了就整个键省掉（给空串也一样算「给不了」）。 */
function toLabelColor(raw) {
  if (!raw || typeof raw.name !== 'string' || !raw.name) return null
  const item = { name: raw.name, color: normalizeColor(raw.color) || '' }
  if (typeof raw.description === 'string' && raw.description.trim() !== '') item.description = raw.description
  return item
}

/** 列标签失败时的说法：环境类与连不通这两档要带上「没能拿全标签」这句话（契约要求），其余照实说。 */
function listFailure(err) {
  const kind = (err && err.kind) || ERROR_KIND.NETWORK
  const hint = rawHint(err)
  if (kind === ERROR_KIND.ENV) return fail(kind, '没能拿全标签：本机的 GitHub 助手（gh）这次没跑起来。这是插件这边的问题，不是你操作错了。' + hint)
  if (kind === ERROR_KIND.NETWORK) return fail(kind, '没能拿全标签：连不上 GitHub（网络不通或超时），检查网络或代理后再列一次。你的仓库没有被改动。' + hint)
  if (kind === ERROR_KIND.AUTH) return fail(kind, '没登录 GitHub（或登录已失效），所以列不出标签：先运行 gh auth login 登录一次再试。' + hint)
  if (kind === ERROR_KIND.RATELIMIT) return fail(kind, 'GitHub 限速了（短时间内请求太多），等一会儿再列一次。' + hint)
  return fail(kind, '列标签没成功：' + (err && err.message ? String(err.message) : 'gh 没有说明原因'))
}

// ── 批量改色 ─────────────────────────────────────────────────────────────────

/** 入参形状把关：不是一批改动就整条失败（落解析档）。
 *  单条的颜色写错不算入参坏掉：那一条落解析档，其余照改。
 *  重名判定按**归一化后的名字**（转小写 + 去掉首尾空格，与「比色前两边都转小写」同口径）：
 *  契约里名字是要原样交给 GitHub 的，而 GitHub 认名字时大小写不敏感、首尾空格也不算数，
 *  只比字节串会让「bug」与「BUG」这种同一批里的同一个标签各发一次命令（#620 整改 D4）。 */
function changesProblem(changes) {
  if (!Array.isArray(changes)) return '批量改色要一批「标签 → 新颜色」（changes 数组），这次收到的不像一批改动'
  const seen = new Set()
  for (const ch of changes) {
    if (!ch || typeof ch !== 'object' || Array.isArray(ch)) return '这一批里有一条改动不是「标签 → 新颜色」的形状'
    if (typeof ch.name !== 'string' || !ch.name.trim()) return '这一批里有一条改动没写标签名'
    if (typeof ch.color !== 'string' || !ch.color.trim()) return '这一批里有一条改动没写新颜色'
    const key = ch.name.trim().toLowerCase()
    if (seen.has(key)) return '同一批里「' + ch.name + '」出现了两次（一个标签一批里只许出现一次；名字比较时大小写与首尾空格不算数，因为 GitHub 上它们指同一个标签）'
    seen.add(key)
  }
  return ''
}

/** 这次用几路并发。默认逐条串行（官方文档要求串行、每条之间最好隔一秒）；要提速最多 4 路。 */
function writeConcurrency(ctx) {
  const raw = ctx && typeof ctx.labelColorConcurrency === 'number' ? ctx.labelColorConcurrency : WRITE_CONCURRENCY_DEFAULT
  if (!Number.isFinite(raw) || raw < 1) return WRITE_CONCURRENCY_DEFAULT
  return Math.min(Math.floor(raw), WRITE_CONCURRENCY_MAX)
}

/** 按并发上限跑一批活，结果按入参顺序放回。
 *  逐条记账的前提是「每条的结果都拿回来」：跑失败的那条自己也返回一个结果，这里不因为某条失败就停。 */
async function runWithLimit(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const lanes = Math.max(1, Math.min(limit, items.length))
  const runners = []
  for (let i = 0; i < lanes; i++) {
    runners.push((async () => {
      for (;;) {
        const idx = next
        next += 1
        if (idx >= items.length) return
        results[idx] = await worker(items[idx], idx)
      }
    })())
  }
  await Promise.all(runners)
  return results
}

/** 改一个标签的颜色：成功给 {ok:true, entry:{name,color}}，失败给 {ok:false, entry:{name,reason}}。 */
async function applyOne(c, spec, ch, ctx) {
  const want = normalizeColor(ch.color)
  if (!want) {
    return { ok: false, entry: { name: ch.name, reason: reason(ERROR_KIND.PARSE, '「' + ch.name + '」的新颜色填错了：要写成不带井号的六位十六进制，例如 9d7cd8。') } }
  }
  const r = await c.execGh(['label', 'edit', ch.name, '--repo', spec, '--color', want], { cwd: ctx && ctx.cwd })
  if (r.ok) return { ok: true, entry: { name: ch.name, color: want } }
  return { ok: false, entry: { name: ch.name, reason: await explainWriteFailure(c, spec, ch, r.error, ctx) } }
}

/** 批量改标签颜色（契约操作 setLabelColors）。
 *  逐条记账、中途失败不回滚（GitHub 没有一次改 N 个标签颜色的接口，改到一半失败必然留半成品）。 */
export async function setLabelColors(repo, changes, ctx) {
  try {
    const bad = changesProblem(changes)
    if (bad) return fail(ERROR_KIND.PARSE, bad)
    const target = await resolveRepoTarget(repo, ctx)
    if (!target) return fail(ERROR_KIND.NOTFOUND, noRepoTarget('批量改色', repo))
    if (changes.length === 0) return { ok: true, data: { applied: [], failed: [] } }
    const c = ghClient(ctx)
    // 逐条兜底（#620 整改 D5）：某一条上冒出意外异常时，只把这一条记成失败，其余照跑。
    //   不这么写的话：异常会冒到外面那个整批 catch，**已经改好的标签一条都不记账**，
    //   违反契约的「入参里每一条改动必须恰好出现在 applied 或 failed 之一」。
    const results = await runWithLimit(changes, writeConcurrency(ctx), async (ch) => {
      try {
        return await applyOne(c, target.spec, ch, ctx)
      } catch (e) {
        return {
          ok: false,
          entry: {
            name: ch.name,
            reason: reason(ERROR_KIND.ENV, '改「' + ch.name + '」时插件这边出了意外（' + String((e && e.message) || e).slice(0, 120) + '）。这是插件这边的问题，不是你操作错了；同一批里其它标签照改。'),
          },
        }
      }
    })
    const applied = []
    const failed = []
    for (const r of results) {
      if (!r) continue
      if (r.ok) applied.push(r.entry)
      else failed.push(r.entry)
    }
    return { ok: true, data: { applied: applied, failed: failed } }
  } catch (err) {
    return fail(classifyGhError(err, ctx), String((err && err.message) || err))
  }
}

/** 一条改动没改成时，它该落契约八档里的哪一档、对用户说什么。
 *  顺序按「能确定程度」排：先看退出码（没登录只靠退出码 4 认），再看 gh 的报错原文。 */
async function explainWriteFailure(c, spec, ch, err, ctx) {
  const code = err && typeof err.code === 'number' ? err.code : null
  const text = String((err && (err.message || err.stderr)) || '')
  const hint = rawHint(err)
  // ① 没登录：gh 自己的约定（gh help exit-codes：需要登录 = 退出码 4）。只认退出码，不靠文案巧合。
  if (code === 4) {
    return reason(ERROR_KIND.AUTH, '没有登录 GitHub，所以改不了标签：先运行 gh auth login 把账号登录上，再回来保存。这次「' + ch.name + '」没有改动。')
  }
  // ② 限速：403 或 429 带 rate limit 文案（官方文档：次限速也走这两个状态码）
  if (/rate limit|api rate limit exceeded|\b429\b/i.test(text)) {
    return reason(ERROR_KIND.RATELIMIT, 'GitHub 限速了（短时间内改得太频繁），等一会儿再保存一次。这次「' + ch.name + '」没有改动。')
  }
  // ③ 凭据被拒
  if (/HTTP 401|bad credentials|unauthorized/i.test(text)) {
    return reason(ERROR_KIND.AUTH, 'GitHub 说登录凭据无效（可能已经过期或被撤销）：重新运行 gh auth login 登录一次再保存。这次「' + ch.name + '」没有改动。' + hint)
  }
  // ④ 颜色被 API 拒（422）：实测原文是两行「HTTP 422: Validation Failed」加「Label.color is invalid」
  if (/HTTP 422|validation failed/i.test(text)) {
    return reason(ERROR_KIND.PARSE, 'GitHub 没有收下「' + ch.name + '」的新颜色：颜色要写成不带井号的六位十六进制（例如 9d7cd8）。改对之后再保存一次。' + hint)
  }
  // ⑤ 404：三种情况（标签不存在 / 仓库不存在 / 没有写权限）长得一模一样，只能再问一次仓库权限。
  //    这里只认状态码 404，不认「not found」这句英文——gh 可执行文件缺失时的那句
  //    「gh not found: …」里也有 not found，认文案会把「本机缺工具」误判成「标签不存在」。
  if (/HTTP 404|\b404\b/i.test(text)) return await explain404(c, spec, ch, ctx, hint)
  // ⑥ 其余按 client 已经归好的档，只是把说法换成能给用户看的一句
  const kind = (err && err.kind) || classifyGhError(err, ctx)
  if (kind === ERROR_KIND.ENV) return reason(ERROR_KIND.ENV, '本机的 GitHub 助手（gh）这次没跑起来，所以「' + ch.name + '」没改成。这是插件这边的问题，不是你操作错了。' + hint)
  if (kind === ERROR_KIND.NETWORK) return reason(ERROR_KIND.NETWORK, '连不上 GitHub（网络不通或超时），「' + ch.name + '」没改成。检查网络或代理后再保存一次。' + hint)
  if (kind === ERROR_KIND.AUTH) return reason(ERROR_KIND.AUTH, '改「' + ch.name + '」时 GitHub 说身份不被认可（没登录或没有权限）：先确认登录状态，再试一次。' + hint)
  if (kind === ERROR_KIND.RATELIMIT) return reason(ERROR_KIND.RATELIMIT, 'GitHub 限速了，「' + ch.name + '」没改成，等一会儿再试。' + hint)
  if (kind === ERROR_KIND.NOTFOUND) return reason(ERROR_KIND.NOTFOUND, '改「' + ch.name + '」时 GitHub 说找不到：先核对仓库名与标签名。' + hint)
  return reason(kind, '改「' + ch.name + '」失败：' + (err && err.message ? String(err.message) : 'gh 没有说明原因'))
}

/** 撞到 404 时多问一次仓库权限，把「标签或仓库不存在」与「你没有写权限」分开。
 *  按 #612 实测：有仓库写权限却 404 → 标签或仓库真的不存在；权限只有 READ → 就是没有写权限。 */
async function explain404(c, spec, ch, ctx, hint) {
  const perm = await readViewerPermission(c, spec, ctx)
  if (perm === 'READ' || perm === 'NONE') {
    return reason(ERROR_KIND.AUTH, '你的账号在「' + spec + '」上没有写权限（只能读），所以改不了标签。换一个有写权限的账号，或请仓库管理员给你写权限（要给写权限，不是给你看仓库的权限）。这次「' + ch.name + '」没有改动。')
  }
  if (perm === 'WRITE' || perm === 'MAINTAIN' || perm === 'ADMIN') {
    return reason(ERROR_KIND.NOTFOUND, '这个仓库里没有名为「' + ch.name + '」的标签（问过权限了，你有写权限，所以不是权限问题）。先核对标签名——GitHub 上名字大小写不敏感，冒号和空格都算名字的一部分——或者先在仓库里把这个标签建出来再改色。')
  }
  return reason(ERROR_KIND.NOTFOUND, 'GitHub 说「' + ch.name + '」找不到，同时插件也没能问出你在「' + spec + '」上的权限（可能仓库名不对、没登录，或网络不通）。先确认仓库名与标签名没错、账号已经登录，再试一次。' + hint)
}

/** 问一次「我这个账号在这个仓库上的权限」（gh repo view --json viewerPermission）。
 *  问不出来时返回 null（调用方按「分不清」处理，不瞎猜）。 */
async function readViewerPermission(c, spec, ctx) {
  const r = await c.execJson(['repo', 'view', spec, '--json', 'viewerPermission'], { cwd: ctx && ctx.cwd })
  if (!r || !r.ok) return null
  const p = r.data && r.data.viewerPermission
  return typeof p === 'string' && p ? p.toUpperCase() : null
}

export default { listLabels, setLabelColors }
