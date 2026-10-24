// create-layout.ts —— Markdown 后端「按原文形状落盘」的目录选择与写盘（#1486，父票 #1480）。
//
// 建什么形状的正文由 create-render.ts 负责；本文件只负责：
//   1. 选中目录：给了 feature 就用它；没给就按标题生成目录名，占用时追加 -2、-3 后缀。
//   2. 在同一把工作区写锁里回查幂等键、重新列目录取号、写文件，保证并发不丢号不重号。
//   3. 返回最终路径、编号与目录名，让人话回执说清落在哪里。
import { parseMd, slugify } from './parse.js'
import { markerKindInHeader } from '../../../shared/issue-file/src/marker.js'
import { listDir, readTextFile } from './read.js'
import { publishTextFile } from './write.js'
import { getPlat, getScratchRoot, listEfforts, resolveMapFile } from './issues-locate.js'
import { failAs } from './error-fail.js'
import { withWorkspaceWriter } from './write-queue.js'
import { idempotencyKeyOf } from '../../../refresh/contract/idempotency-keys.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { OpContext } from '../../contract/contexts.js'
import type { RepositoryRef } from '../../contract/entities.js'
import type { CreateInput } from '../../contract/inputs.js'
import { nowIso, viewOf, labelsOf, assigneesOf, renderSpec, renderTicket } from './create-render.js'
import type { CreateView, OriginalKind, LayoutFailure } from './create-render.js'

/** 本地仓库引用：path 是本地后端的自有约定；mdScene 记调用方用的是 feature 还是 effort。 */
type RepoWithPath = RepositoryRef & { path?: string; mdScene?: string }

/** 落盘结果：路径、编号与目录名。回包由调用方按盘上内容再解析一次。 */
export interface LayoutPlacement {
  ok: true
  path: string
  key: string
  effortId: string
  reused: boolean
  kind: OriginalKind
  createdAt: string
}

async function dirOccupied(ctx: OpContext, dir: string): Promise<{ ok: true; occupied: boolean; names: string[] } | LayoutFailure> {
  const plat = getPlat(ctx)
  const listed = await listDir(ctx, dir)
  if (!listed.ok) {
    // 目录不存在就是空的（全新工作区），不是故障。
    if (listed.missing) return { ok: true, occupied: false, names: [] }
    return failAs(ERROR_KIND.ENV, '建票要列目录，但目录读不出来：' + dir + '（' + String((listed.error as Error)?.message || listed.error) + '）', String((listed.error as Error)?.message || listed.error))
  }
  const names = listed.names
  if (names.length === 0) return { ok: true, occupied: false, names: [] }
  // 只看目录里有没有规格/地图/票目录这三样；别的零散文件不挡建票。
  const hasSpec = names.indexOf('spec.md') >= 0
  const hasMap = names.indexOf('map.md') >= 0
  const hasIssues = names.indexOf('issues') >= 0
  return { ok: true, occupied: hasSpec || hasMap || hasIssues, names: names }
}

/** 按标题生成目录名：先试不带后缀的，被占用就依次试 -2、-3。最多试 50 次，之后如实失败。 */
async function generatedFeatureDir(ctx: OpContext, title: string, idempotencyKey: string, kind: OriginalKind): Promise<{ ok: true; root: string; dirName: string } | LayoutFailure> {
  const plat = getPlat(ctx)
  const scratch = await getScratchRoot(ctx)
  const base = slugify(title)
  for (let n = 1; n <= 50; n += 1) {
    const name = n === 1 ? base : base + '-' + n
    const dir = plat.join(scratch, name)
    const state = await dirOccupied(ctx, dir)
    if (!state.ok) return state
    if (!state.occupied) return { ok: true, root: dir, dirName: name }
    // 已占用：如果里面已经有同一个幂等键的票，就复用这个目录（重复创建不能因撞名又多一份）。
    const specPath = plat.join(dir, 'spec.md')
    if (state.names.indexOf('spec.md') >= 0) {
      const text = await readTextFile(ctx, specPath)
      if (idempotencyKey && idempotencyKeyOf(text) === idempotencyKey && kind === 'spec') {
        return { ok: true, root: dir, dirName: name }
      }
    }
    const issues = plat.join(dir, 'issues')
    if (idempotencyKey && state.names.indexOf('issues') >= 0) {
      const listed = await listDir(ctx, issues)
      if (listed.ok) {
        for (const f of listed.names) {
          if (!f.endsWith('.md')) continue
          const text = await readTextFile(ctx, plat.join(issues, f))
          if (idempotencyKeyOf(text) === idempotencyKey) return { ok: true, root: dir, dirName: name }
        }
      }
    }
  }
  return failAs(ERROR_KIND.CONFLICT, '标题「' + title + '」生成的前 50 个目录名都已经被别的票占用，这次没建：请给 feature 指定一个目录名。', title)
}

/** 扫描 `.scratch` 下所有含 spec.md 的目录（没有 feature 时，实施票要先找到唯一的规格）。 */
async function specDirs(ctx: OpContext): Promise<{ ok: true; dirs: Array<{ root: string; dirName: string }> } | LayoutFailure> {
  const plat = getPlat(ctx)
  const scratch = await getScratchRoot(ctx)
  const listed = await listDir(ctx, scratch)
  if (!listed.ok) {
    if (listed.missing) return { ok: true, dirs: [] }
    return failAs(ERROR_KIND.ENV, '要列 .scratch 找规格目录，但列不出来（' + String((listed.error as Error)?.message || listed.error) + '）', String((listed.error as Error)?.message || listed.error))
  }
  const dirs: Array<{ root: string; dirName: string }> = []
  for (const name of listed.names) {
    if (!name || name.startsWith('.')) continue
    const dir = plat.join(scratch, name)
    const specPath = plat.join(dir, 'spec.md')
    try {
      const text = await readTextFile(ctx, specPath)
      if (text !== '') dirs.push({ root: dir, dirName: name })
    } catch { /* 没有 spec.md 的目录就是地图/旧布局，不在这里报错 */ }
  }
  return { ok: true, dirs: dirs }
}

/** 解析这次落哪个 feature 目录；实施票没给 feature 时必须恰好能找到一个规格目录。 */
async function resolveTarget(ctx: OpContext, repo: RepoWithPath, kind: OriginalKind, title: string, idempotencyKey: string, parentKey = ''): Promise<{ ok: true; root: string; dirName: string; explicit: boolean } | LayoutFailure> {
  const plat = getPlat(ctx)
  const cwd = ctx && typeof ctx.cwd === 'string' ? ctx.cwd : '.'
  const scratch = await getScratchRoot(ctx)
  const effort = repo && repo.effortId !== undefined && repo.effortId !== null ? String(repo.effortId).trim() : ''
  if (effort) return { ok: true, root: plat.join(scratch, effort), dirName: effort, explicit: true }

  // 调用方明确用 feature 参数给了目录（mdScene='feature'）时，上面那条已经接住；
  // 没有 feature 但仓库引用本身指着一个具体目录（测试夹具与旧调用常见）时，就落那一个目录。
  const direct = repo && repo.path ? String(repo.path) : (repo && repo.refId ? String(repo.refId) : '')
  if (direct) {
    // Windows 盘符路径在 path.posix 眼里不是绝对路径（`D:/...` 不以 `/` 开头），不单独认一下，
    // 会把它当相对路径再拼一次 cwd，得到 `D:/ws/D:/ws` 这种坏路径。
    const winAbs = /^[A-Za-z]:[\\/]/.test(direct)
    const abs = plat.isAbsolute(direct) || winAbs ? direct : plat.join(cwd, direct)
    const base = abs.split(/[\\/]/).filter(Boolean).pop() || ''
    const normalized = abs.replace(/[\\/]+$/, '')
    const cwdNormalized = String(cwd).replace(/[\\/]+$/, '')
    const scratchNormalized = String(scratch).replace(/[\\/]+$/, '')
    if (base && base !== '.scratch' && normalized !== cwdNormalized && normalized !== scratchNormalized) {
      return { ok: true, root: abs, dirName: base, explicit: true }
    }
  }

  // 规格没给 feature：一律按标题建自己的目录，不自动落进「唯一那个已有容器」。
  // 规格是 feature 的顶层容器，一个目录只能有一张 spec.md；沿用已有容器会撞上那里的规格，
  // 而多张规格共用一个目录本来就不合法。旧行为「单 effort 仓库无感」只适用于票，不适用于规格。
  if (kind === 'spec') {
    const generated = await generatedFeatureDir(ctx, title, idempotencyKey, kind)
    if (!generated.ok) return generated
    return { ok: true, root: generated.root, dirName: generated.dirName, explicit: false }
  }

  // 实施票没给 feature：规格目录必须唯一，猜错会把票挂到别人的规格下。
  // 要在「单容器自动回落」之前判断：地图目录不是规格目录，拿地图目录去建实施票会找不到父规格。
  if (kind === 'spec-ticket') {
    const found = await specDirs(ctx)
    if (!found.ok) return found
    if (found.dirs.length === 1) return { ok: true, root: found.dirs[0].root, dirName: found.dirs[0].dirName, explicit: true }
    if (found.dirs.length === 0) {
      return failAs(ERROR_KIND.NOTFOUND, '实施票必须挂在规格票下：这个工作区里还没有 spec.md。先建规格，或者用 feature 指定规格所在的目录。', '')
    }
    return failAs(ERROR_KIND.CONFLICT, '这个工作区里有 ' + found.dirs.length + ' 个规格目录（' + found.dirs.map((d) => d.dirName).join('、') + '），没法判断实施票该落哪一个：请用 feature 指定目录名。', JSON.stringify(found.dirs.map((d) => d.dirName)))
  }

  // 没有点名目录、但工作区里只有一个已有容器时，沿用旧口径自动落那一个目录：
  // 这是 #1486 之前「单 effort 仓库用起来无感」的行为，改布局不该把它弄丢；
  // 一个都没有（新工作区）才按标题生成新目录，多义的留给下面各类对象自己判断。
  const efforts = await listEfforts(ctx)
  if (efforts.length === 1) return { ok: true, root: efforts[0].dir, dirName: efforts[0].effortId, explicit: true }

  // 普通票/缺陷票明确挂在某张地图下（parentKey）时，落在那张地图的目录里，和旧口径一致：
  // 父子关系只在同一个 effort 内成立，按标题另起一个目录会让父票指向一张不在同一目录的票。
  if ((kind === 'issue' || kind === 'bug') && parentKey) {
    const map = await resolveMapFile(ctx, repo, { mode: 'read' })
    if (!map.ok) return failAs(ERROR_KIND.NOTFOUND, '父票 #' + parentKey + ' 找不到对应的地图文件：普通票和缺陷票要挂在地图下时，必须先有那张地图。', '')
    const parts = map.path.split(/[\\/]/).filter(Boolean)
    const parentDir = parts.length >= 2 ? parts[parts.length - 2] : ''
    return { ok: true, root: map.path.replace(/[\\/][^\\/]+$/, ''), dirName: parentDir, explicit: true }
  }

  // 普通票/缺陷票没给 feature：按标题建自己的目录（原文的 plain-issue 也住在 feature 目录里）。
  const generated = await generatedFeatureDir(ctx, title, idempotencyKey, kind)
  if (!generated.ok) return generated
  return { ok: true, root: generated.root, dirName: generated.dirName, explicit: false }
}

/** 在票目录里按幂等键回查；命中返回盘上那一份，读不出来就如实失败。 */
async function findAnchor(ctx: OpContext, issuesDir: string, key: string): Promise<{ ok: true; hit: { path: string; name: string } | null } | LayoutFailure> {
  if (!key) return { ok: true, hit: null }
  const plat = getPlat(ctx)
  const listed = await listDir(ctx, issuesDir)
  if (!listed.ok) {
    if (listed.missing) return { ok: true, hit: null }
    return failAs(ERROR_KIND.ENV, '回查幂等键要列票目录，但目录读不出来：' + issuesDir + '（' + String((listed.error as Error)?.message || listed.error) + '）', String((listed.error as Error)?.message || listed.error))
  }
  for (const name of listed.names) {
    if (!name || !name.endsWith('.md')) continue
    const full = plat.join(issuesDir, name)
    let text = ''
    try { text = await readTextFile(ctx, full) } catch (e) {
      return failAs(ERROR_KIND.UNSUPPORTED, '回查幂等键要读票文件，但读不出来：' + full + '（' + String((e as Error)?.message || e) + '）。这次没建新票，免得重复。', '')
    }
    if (idempotencyKeyOf(text) === key) return { ok: true, hit: { path: full, name: name } }
  }
  return { ok: true, hit: null }
}

/** 在目标目录里取下一个编号：锁内重新列目录，跳过盘上已经占用的号。 */
async function nextNumber(ctx: OpContext, issuesDir: string): Promise<{ ok: true; number: string; max: number } | LayoutFailure> {
  const listed = await listDir(ctx, issuesDir)
  if (!listed.ok) {
    if (listed.missing) return { ok: true, number: '01', max: 0 }
    return failAs(ERROR_KIND.ENV, '取号要列票目录，但目录读不出来：' + issuesDir + '（' + String((listed.error as Error)?.message || listed.error) + '）', String((listed.error as Error)?.message || listed.error))
  }
  let max = 0
  for (const name of listed.names) {
    const m = /^(\d+)-/.exec(name)
    if (!m) continue
    const n = parseInt(m[1], 10)
    if (!isNaN(n) && n > max) max = n
  }
  return { ok: true, number: String(max + 1).padStart(2, '0'), max: max }
}

/** 找目标目录里的 spec.md，并核对它确实是规格（新文件没有旧标记，靠文件名与位置判断）。 */
async function requireSpec(ctx: OpContext, root: string): Promise<{ ok: true; path: string; text: string } | LayoutFailure> {
  const plat = getPlat(ctx)
  const specPath = plat.join(root, 'spec.md')
  let text = ''
  try { text = await readTextFile(ctx, specPath) } catch {
    return failAs(ERROR_KIND.NOTFOUND, '实施票必须挂在规格票下：目录「' + root + '」里没有 spec.md。先在那个目录建规格，或者用 feature 指定规格所在的目录。', specPath)
  }
  if (!text.trim()) return failAs(ERROR_KIND.PARSE, '目录「' + root + '」里的 spec.md 是空的，没法确认它是不是规格：这次没建实施票。', specPath)
  // 老文件可能还带 DSH-ISSUE-KIND；写着别的类型就拒绝，避免把实施票挂到地图或普通票下面。
  const marked = markerKindInHeader(text)
  if (marked && marked !== 'spec') {
    return failAs(ERROR_KIND.PARSE, '目录「' + root + '」里的 spec.md 写着「' + marked + '」标记，不是规格容器：这次没建实施票。', specPath)
  }
  return { ok: true, path: specPath, text: text }
}

/** 一次建票的完整落盘：锁内选目录、回查幂等键、取号、写文件。 */
export async function createInOriginalLayout(ctx: OpContext, repo: RepoWithPath | null, input: CreateInput, kind: OriginalKind, idempotencyKey: string): Promise<LayoutPlacement | LayoutFailure> {
  const plat = getPlat(ctx)
  const view = viewOf(input)
  const title = String(input.title || '').trim()
  const createdAt = nowIso()
  const labels = labelsOf(view)
  const assignees = assigneesOf(view)
  const parentRaw = input.parentKey === undefined || input.parentKey === null ? '' : String(input.parentKey).trim()
  const parentKey = parentRaw && /^\d+$/.test(parentRaw) ? parentRaw.padStart(2, '0') : parentRaw

  return await withWorkspaceWriter(ctx, repo, async (): Promise<LayoutPlacement | LayoutFailure> => {
    const target = await resolveTarget(ctx, repo || {} as RepoWithPath, kind, title, idempotencyKey, parentKey)
    if (!target.ok) return target
    const root = target.root
    const dirName = target.dirName

    if (kind === 'spec') {
      const specPath = plat.join(root, 'spec.md')
      const anchor = await findAnchor(ctx, root, idempotencyKey)
      // 规格目录里只有 spec.md 一个候选；findAnchor 扫整个目录会把 issues/ 也读进来，
      // 所以这里单独按 spec.md 判断（上面扫到的是别的票的键，不能拿来复用规格）。
      if (anchor.ok && anchor.hit && anchor.hit.name === 'spec.md') {
        const text = await readTextFile(ctx, anchor.hit.path)
        return { ok: true, path: anchor.hit.path, key: '00', effortId: dirName, reused: true, kind: kind, createdAt: createdOf(text, createdAt) }
      }
      // 目标目录已经有 spec.md 但键不同 → 不能再写一份，必须换一个目录或如实失败。
      const occupied = await dirOccupied(ctx, root)
      if (!occupied.ok) return occupied
      if (occupied.names.indexOf('spec.md') >= 0) {
        // 给了 feature 时不允许改名：这是调用方指定的目录，覆盖别人的规格比失败更贵。
        if (target.explicit && String(repo && repo.effortId || '').trim()) {
          return failAs(ERROR_KIND.CONFLICT, '目录「' + dirName + '」里已经有一份 spec.md（不是这次这个幂等键建的）：这次没建，免得覆盖它。换一个 feature，或先用新目录。', specPath)
        }
        // 按标题生成的目录在占用时已经换成 -2/-3 了；走到这里说明是显式目录，同上拒绝。
        return failAs(ERROR_KIND.CONFLICT, '目录「' + dirName + '」里已经有一份 spec.md（不是这次这个幂等键建的）：这次没建，免得覆盖它。', specPath)
      }
      const text = renderSpec(view, { createdAt: createdAt, idempotencyKey: idempotencyKey, labels: labels, assignees: assignees })
      await publishTextFile(ctx, specPath, text, ctx && (ctx as { sandboxPolicy?: unknown }).sandboxPolicy)
      return { ok: true, path: specPath, key: '00', effortId: dirName, reused: false, kind: kind, createdAt: createdAt }
    }

    // 实施票：父票只能是本次目录里的规格（00）。没给父票也按 00 处理，原文靠目录表达父子。
    if (kind === 'spec-ticket') {
      if (parentKey && parentKey !== '00') {
        return failAs(ERROR_KIND.PARSE, '实施票的父票要填 00（一个目录里只有一份规格容器），收到的是「' + parentKey + '」：这次没建。', parentKey)
      }
      const spec = await requireSpec(ctx, root)
      if (!spec.ok) return spec
    }

    const issuesDir = plat.join(root, 'issues')
    const anchor = await findAnchor(ctx, issuesDir, idempotencyKey)
    if (!anchor.ok) return anchor
    if (anchor.hit) {
      const m = /^(\d+)-/.exec(anchor.hit.name)
      const key = m ? m[1].padStart(2, '0') : '01'
      const text = await readTextFile(ctx, anchor.hit.path)
      return { ok: true, path: anchor.hit.path, key: key, effortId: dirName, reused: true, kind: kind, createdAt: createdOf(text, createdAt) }
    }

    const numbered = await nextNumber(ctx, issuesDir)
    if (!numbered.ok) return numbered
    const key = numbered.number
    const fileName = key + '-' + slugify(title) + '.md'
    const finalPath = plat.join(issuesDir, fileName)
    const text = renderTicket(kind, view, {
      number: key,
      createdAt: createdAt,
      idempotencyKey: idempotencyKey,
      labels: labels,
      assignees: assignees,
      parentKey: kind === 'spec-ticket' ? '00' : parentKey,
    })
    await publishTextFile(ctx, finalPath, text, ctx && (ctx as { sandboxPolicy?: unknown }).sandboxPolicy)
    return { ok: true, path: finalPath, key: key, effortId: dirName, reused: false, kind: kind, createdAt: createdAt }
  })
}

/** 复用旧票时，创建时间沿用盘上那一行（没有就回退到本次时钟）。 */
function createdOf(text: string, fallback: string): string {
  const parsed = parseMd(text, { key: '00', parentKey: null, isMap: false })
  return parsed.createdAt || fallback
}
