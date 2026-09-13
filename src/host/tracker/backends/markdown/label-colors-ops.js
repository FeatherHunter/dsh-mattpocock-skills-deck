// label-colors-ops.js —— 标签配色契约里那两条操作在本后端的实现（#627 冻结的形状，#618 落地）。
// 以后谁改它：改「列出这个工作区能改色的全部标签」的并集规则、或改色时的逐条记账规则的人。
//
// 这里只管契约那一层：入参是不是一批改动、每一条改动记成功还是失败、拿不全时整条操作怎么失败。
// 文件本身的读、写、原子发布、串行化在 label-colors.js 里。
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { normalizeColor } from '../../../../shared/label-color/colors.js'
import { readTextFile, readDir } from './read.js'
import { getPlat, listEfforts } from './issues-locate.js'
import { parseMd } from './parse.js'
import { LABEL_COLORS_REL_PATH, readLabelColors, ensureLabelColors, publishLabelColors, withLabelColorsWriter, describeWriteFailure, isMissingFile } from './label-colors.js'
import { builtinLabelColors } from './label-colors-palette.js'

/** 本文件要用到的文件服务（与 label-colors.js 同一套取法）。 */
function getFs(ctx) {
  if (ctx && ctx.platform && ctx.platform.fs) return ctx.platform.fs
  if (ctx && ctx.fs) return ctx.fs
  if (ctx && typeof ctx.get === 'function') { try { const f = ctx.get('fs'); if (f) return f } catch (e) {} }
  return null
}

function fail(kind, message) { return { ok: false, error: { kind: kind, message: message } } }

/** 改色入参的形状把关（契约：不是一批改动就整条失败，落解析档）。
 *  颜色写错不算入参坏掉：那一条落解析档，其余照改。 */
function shapeProblem(changes) {
  if (!Array.isArray(changes)) return '批量改色要一批「标签 → 新颜色」（changes 数组），这次收到的不像一批改动'
  const seen = new Set()
  for (const c of changes) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return '这一批里有一条改动不是「标签 → 新颜色」的形状'
    if (typeof c.name !== 'string' || !c.name.trim()) return '这一批里有一条改动没写标签名'
    if (typeof c.color !== 'string' || !c.color.trim()) return '这一批里有一条改动没写新颜色'
    if (seen.has(c.name)) return '同一批里「' + c.name + '」出现了两次（一个标签一批里只许出现一次）'
    seen.add(c.name)
  }
  return ''
}

// ── 票面上的标签（并集里的第二个来源）────────────────────────────────────────

/** 扫票面：把这个工作区所有票（含地图票）的 Labels 行里出现过的标签名收齐。
 *  为什么不用本房间既有的 listIssues：它对读不出来的票文件一律吞掉错误（catch{}），
 *  而契约定死「取不全就必须整体失败」——它没法告诉我们有没有漏读，这里必须让错误冒出来。 */
async function collectTicketLabelNames(ctx, repo) {
  const plat = getPlat(ctx)
  const names = new Set()
  const dirs = []
  if (repo && typeof repo.path === 'string' && repo.path) dirs.push(repo.path)
  for (const e of await listEfforts(ctx)) dirs.push(e.dir)
  for (const dir of dirs) {
    const files = [plat.join(dir, 'map.md')]
    const idir = plat.join(dir, 'issues')
    let entries = []
    try { entries = await readDirOrThrow(ctx, idir) } catch (e) {
      return fail(ERROR_KIND.ENV, '没能拿全标签：工作区里有一个目录读不出来（' + String((e && e.message) || e).slice(0, 120) + '）。这是插件这边的问题，不是你操作错了。')
    }
    for (const f of entries) {
      if (f && f.endsWith('.md') && /^(\d+)-/.test(f)) files.push(plat.join(idir, f))
    }
    for (const file of files) {
      // 这里曾经先用 exists() 探一次「这张票在不在」再读。那支辅助件把每一路探测失败（权限、被占用）
      // 都吞成 false，于是「探不到但确实在」的票会被静默跳过，标签清单悄悄少一截——正好违反契约的
      // 「取不全就必须整体失败」。改成直接读：只有明确的「文件不在了」才跳过（列目录之后被删掉这种），
      // 其余读失败一律按「取不全」整体失败。
      let text = ''
      try { text = await readTextFile(ctx, file) } catch (e) {
        if (isMissingFile(e)) continue
        // 有一张票读不出来 = 拿不全标签：整条操作失败，不许把残缺清单当全量发出去。
        return fail(ERROR_KIND.ENV, '没能拿全标签：工作区里有一张票的文件读不出来（' + String((e && e.message) || e).slice(0, 120) + '）。这是插件这边的问题，不是你操作错了。')
      }
      let labels = []
      try { labels = parseMd(text, { key: '00', parentKey: null, isMap: true }).labels || [] } catch (e) { labels = [] }
      for (const lab of labels) if (lab && lab.name) names.add(String(lab.name))
    }
  }
  return { ok: true, names: Array.from(names) }
}

/** 列目录：目录不存在按「这里还没有票」处理（返回空表），只有别的读失败才抛出去让上层判「取不全」。
 *  为什么要分开：地图建好、还没开任何票的工作区里 `issues/` 目录根本不存在，
 *  而「首次打开改色弹窗」正是本票新增的那条路——把「目录不存在」当错误，用户一开弹窗就会看到一句报错，
 *  而他什么都没做错（审查实测过这个场景）。判据与配色文件那条一样窄：只有明确的「不在」才算不存在，
 *  非 ENOENT 的读失败（权限、被占用、磁盘故障）照旧按「取不全」整体失败，不许退回残缺清单。
 *  没有文件服务时按空表处理，与房间既有约定一致（exists 返回 false、readDir 返回空表）。
 *  已知缺口（写进报告，不在本票范围内修）：工作区根目录本身读不出来时，listEfforts 也拿不到 effort，
 *  这一层仍然会静默返回「没有票」——要把这个缺口也堵上，得改房间既有的读辅助件。 */
async function readDirOrThrow(ctx, dir) {
  const fs = getFs(ctx)
  if (!fs) return []
  const norm = (list) => (Array.isArray(list) ? list.map((x) => (typeof x === 'string' ? x : (x && x.name) || String(x))) : [])
  if (typeof fs.resolve === 'function' && typeof fs.listDir === 'function') {
    try { return norm(await fs.listDir(await fs.resolve(dir))) }
    catch (e) {
      if (isMissingFile(e)) return []
      throw e
    }
  }
  if (typeof fs.readdir === 'function') {
    try { return norm(await fs.readdir(dir)) }
    catch (e) {
      if (isMissingFile(e)) return []
      throw e
    }
  }
  return await readDir(ctx, dir)
}

/** 文件里某一行的含义说明（值写成对象时才有）。 */
function descriptionOf(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.description === 'string' && value.description.trim()) {
    return value.description.trim()
  }
  return ''
}

/** 这次要列的全部标签：内置默认那些 ∪ 票面出现过的 ∪ 配色文件里的。 */
async function collectAllLabels(ctx, repo) {
  const read = await readLabelColors(ctx, repo)
  if (!read.ok) {
    // 「读不出来」按契约落解析档，同时说清没能拿全标签（界面上这两件事都要能看懂）。
    return fail(read.error.kind, '没能拿全标签：' + read.error.message)
  }
  const tickets = await collectTicketLabelNames(ctx, repo)
  if (!tickets.ok) return tickets
  const out = new Map()
  // 内置默认那些：名字、颜色与含义说明都来自那份内置调色盘（表里写了说明的才给 description）。
  for (const item of builtinLabelColors()) {
    if (!item || !item.name) continue
    const name = String(item.name)
    const entry = { name: name, color: normalizeColor(item.color) || '' }
    if (typeof item.description === 'string' && item.description) entry.description = item.description
    out.set(name, entry)
  }
  // 票面出现过的：票里只写名，颜色由配色文件里的值决定，所以先占位、颜色留空。
  for (const name of tickets.names) if (!out.has(name)) out.set(name, { name: name, color: '' })
  // 配色文件里的：颜色以文件为准，含义说明取文件里写的或内置表里的。
  for (const name of Object.keys(read.colors)) {
    const prev = out.get(name) || {}
    const entry = { name: name, color: read.colors[name] || '' }
    const description = descriptionOf(read.raw[name]) || prev.description
    if (description) entry.description = String(description)
    out.set(name, entry)
  }
  return { ok: true, labels: Array.from(out.values()) }
}

// ── 契约操作 ─────────────────────────────────────────────────────────────────

/** 列出标签与颜色（契约操作 listLabels）。
 *  首次打开改色弹窗时顺带补一份默认文件的兜底也在这里：文件缺失就按内置默认色预填一份（幂等，
 *  已存在时一个字都不改）；补不上不影响列标签，只记一条日志——列标签是只读操作，不该被写失败挡住。 */
export async function listLabels(ctx, repo) {
  const placed = await ensureForDialog(ctx, repo)
  const all = await collectAllLabels(ctx, repo)
  if (!all.ok) return all
  return { ok: true, data: all.labels }
}

/** 弹窗首次打开时的兜底放置：只在文件缺失时补一份，补不上不报错（记日志）。 */
async function ensureForDialog(ctx, repo) {
  try {
    return await ensureLabelColors(ctx, repo)
  } catch (e) { return { ok: false, error: describeWriteFailure(e) } }
}

/** 批量改标签颜色（契约操作 setLabelColors）。
 *  逐条记账：颜色写错的、标签不在配色文件里的各记一条失败，其余照改；
 *  文件读不出来时整条操作失败、一个字节都不写（这是硬要求，见 contract.js 的那三条）。 */
export async function setLabelColors(ctx, repo, changes) {
  const bad = shapeProblem(changes)
  if (bad) return fail(ERROR_KIND.PARSE, bad)
  return await withLabelColorsWriter(ctx, repo, async () => {
    const read = await readLabelColors(ctx, repo)
    if (!read.ok) return { ok: false, error: read.error }              // 读不出来 → 一律不许写
    // 文件不存在不算「读不出来」：这时一份颜色都没有，每一要改的标签都落「标签不存在」这一条，
    // 一个字节都不写（契约：两边一律报不存在、都不许新增一行），提示里说清怎么才能成功。
    const fileExists = read.present === true
    const applied = []
    const failed = []
    const pending = {}
    for (const c of changes) {
      const want = normalizeColor(c.color)
      if (!want) {
        failed.push({ name: c.name, reason: { kind: ERROR_KIND.PARSE, message: '「' + c.name + '」的新颜色填错了：要写成不带井号的六位十六进制，例如 9d7cd8' } })
        continue
      }
      if (!fileExists) {
        failed.push({ name: c.name, reason: { kind: ERROR_KIND.NOTFOUND, message: '工作区里还没有配色文件（' + LABEL_COLORS_REL_PATH + '），所以哪个标签都还没配过色。先在面板里打开一次标签配色弹窗把默认文件建出来，再把 "名字": "颜色" 这一行加进去，然后回来保存。' } })
        continue
      }
      if (!Object.prototype.hasOwnProperty.call(read.colors, c.name)) {
        failed.push({ name: c.name, reason: { kind: ERROR_KIND.NOTFOUND, message: '配色文件里没有「' + c.name + '」这一行，插件不会替你新增。想让这个标签能改色，先把 "名字": "颜色" 这一行加进 ' + LABEL_COLORS_REL_PATH + ' 再保存。' } })
        continue
      }
      pending[c.name] = want
      applied.push({ name: c.name, color: want })
    }
    if (applied.length === 0) return { ok: true, data: { applied: [], failed: failed } }
    // 只动被改的那几行，其余行（含用户自己写的含义说明与写法）按原样留着。
    const next = {}
    for (const name of Object.keys(read.raw)) {
      const value = read.raw[name]
      if (Object.prototype.hasOwnProperty.call(pending, name)) {
        next[name] = (value && typeof value === 'object' && !Array.isArray(value)) ? Object.assign({}, value, { color: pending[name] }) : pending[name]
      } else {
        next[name] = value
      }
    }
    try {
      await publishLabelColors(ctx, repo, next, 'saved')
    } catch (e) {
      // 写失败：整条操作失败、不留半截账（原本说会改的那几条一起报失败），理由按失败语义分档。
      const reason = describeWriteFailure(e)
      return { ok: false, error: { kind: reason.kind, message: reason.message + '（这次要改的 ' + applied.length + ' 个标签一个都没改）' } }
    }
    return { ok: true, data: { applied: applied, failed: failed } }
  })
}

export default { listLabels, setLabelColors, collectAllLabels, collectTicketLabelNames }
