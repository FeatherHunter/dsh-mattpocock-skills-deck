// src/deck/tools/md-scope.ts —— 本地 Markdown 后端的「工作单元目录」参数（#1480 T2）
//
// 为什么要两个参数：Matt 原文里两套技能用两个词叫同一个物理位置——
//   · 规格、实施票、普通票住在 `.scratch/<feature-slug>/`（issue-tracker-local.md:7-9）；
//   · 探索地图与它的子票住在 `.scratch/<effort>/`（同文件 :25-28）。
// 工具面对 AI 时按场景给词：建/碰规格体系用 feature，碰探索地图用 effort。落到契约里仍然是同一个
// 寻址范围 `RepositoryRef.effortId`（本地后端 = `.scratch/` 下的目录名）；GitHub / GitLab 只有一个
// 隐含工作单元，照旧忽略这两个参数。内部字段名 effortId 不动：契约、快照键与工作路线都靠它。
//
// 不能改的约定：
//   1. 两个参数互斥。两个都填说明调用方没分清这次在哪套技能里，直接拒绝，不替它猜。
//   2. 目录名只能是单段：不许路径分隔符、不许 `.` / `..`、末尾不许点或空格。这个值要直接拼进
//      `<cwd>/.scratch/<目录>/`，放行 `../x` 就会把票写到工作区外面去。
//   3. 改了文案要同步改 tests/verify-1106-deck-surface.ts 的冻表：那份表盯着模型看到的字。
//   4. 参数说明按「建票类」与「查改类」两套给（区别只在「不填时怎么办」），别再复制第三份。

/** 收口后的结果：成功时 effortId 是 `.scratch/` 下的目录名（空串 = 不限定），scene 记调用方用哪个词。 */
export type MdScope = { ok: true; effortId: string; scene: '' | 'effort' | 'feature' } | { ok: false; message: string }

type StringParam = { type: 'string'; description: string }

/** 建票类工具的两个参数：目录不填时由父票或标题决定。 */
export const MD_SCOPE_CREATE: Record<'effort' | 'feature', StringParam> = {
  effort: {
    type: 'string',
    description: '本地 Markdown 后端专用：探索地图（wayfinder）所在的 `.scratch/` 目录名，原文叫 `<effort>`。不填时按父票或标题决定目录；远端后端忽略它。',
  },
  feature: {
    type: 'string',
    description: '本地 Markdown 后端专用：规格、实施票、普通票所在的 `.scratch/` 目录名，原文叫 `<feature-slug>`。不填时按父票或标题决定目录；远端后端忽略它。',
  },
}

/** 查/改类工具的两个参数：目录不填就查整个仓库。 */
export const MD_SCOPE_LOCATE: Record<'effort' | 'feature', StringParam> = {
  effort: {
    type: 'string',
    description: '本地 Markdown 后端专用：探索地图（wayfinder）所在的 `.scratch/` 目录名，原文叫 `<effort>`。不填就全仓库找；远端后端忽略它。',
  },
  feature: {
    type: 'string',
    description: '本地 Markdown 后端专用：规格、实施票、普通票所在的 `.scratch/` 目录名，原文叫 `<feature-slug>`。不填就全仓库找；远端后端忽略它。',
  },
}

/** 目录名里不能出现的东西：返回一句人话原因，能用就返回空串。 */
function badDirName(name: string): string {
  if (name === '.' || name === '..') return '它表示当前目录或上一级目录'
  // 路径分隔符与 Windows 保留字符：拼进路径后会变成另一条路，或者写不出来。
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name)) return '含有路径分隔符或文件名里不允许的字符'
  // Windows 会把结尾的点和空格吞掉，导致「以为写了 A、实际落在 A」。
  if (/[. ]$/.test(name)) return '末尾是点或空格（Windows 上会被吞掉）'
  return ''
}

/**
 * 把模型给的两个参数收成一份寻址范围：两个都填 → 拒绝；目录名不安全 → 拒绝；
 * 都没填 → 不限定（返回 ok，effortId 为空串）。选择困难时不猜，把话说明白让它重填。
 */
export function readMdScope(a: Record<string, unknown>): MdScope {
  const effort = typeof a.effort === 'string' ? a.effort.trim() : ''
  const feature = typeof a.feature === 'string' ? a.feature.trim() : ''
  if (effort && feature) {
    return {
      ok: false,
      message: 'effort 与 feature 只能填一个：它们都指本地后端 `.scratch/` 下的同一个目录名，只是原文两套技能叫法不同（探索地图叫 `<effort>`，规格体系叫 `<feature-slug>`）。这次在办哪套就留哪个，两个都填会让人猜你要听哪个。',
    }
  }
  const name = effort || feature
  if (name) {
    const bad = badDirName(name)
    if (bad) {
      return {
        ok: false,
        message: '目录名不能用「' + name + '」：' + bad + '。这个值会直接拼成 `.scratch/<目录>/`，只接受单段普通目录名（例如 buy-coffee、买咖啡积分）。',
      }
    }
  }
  return { ok: true, effortId: name, scene: effort ? 'effort' : (feature ? 'feature' : '') }
}

/**
 * 工具入口统一用这一份：收参数、校验、把目录名落到 repo.effortId 上，一次做完。
 * 八份工具各抄一遍这段会很快走散；参数含义、拒绝话与回执 note 都只在这里改。
 */
// repo 的类型写成 effortId?: unknown：工具壳里的 DeckRepo 把 effortId 声明成 unknown（它还要被
// 各种后端读，不在这里收窄），这里只负责把它填成校验过的字符串，所以入参要比 DeckRepo 宽。
export function applyMdScope(repo: { effortId?: unknown; mdScene?: unknown }, a: Record<string, unknown>): MdScope {
  const got = readMdScope(a)
  if (!got.ok) return got
  if (got.effortId) repo.effortId = got.effortId
  // #1486：后端读 00 号时要分清这次说的是 feature（找 spec.md）还是 effort（找 map.md）；
  // 只把目录名传下去不够，两套原文用同一个 00 指两种容器。
  repo.mdScene = got.scene
  return got
}

/** 回执里那句人话：说清这次用的是哪个词、本地后端把范围收在哪，免得以为远端也会跟着变。 */
export function mdScopeNote(scene: string, effortId: string): string {
  const word = scene === 'effort' ? 'effort（探索地图目录）' : (scene === 'feature' ? 'feature（规格体系目录）' : '工作单元目录')
  return '这次带了 ' + word + '「' + effortId.slice(0, 60) + '」：本地后端只在那一个 `.scratch/` 目录里找，远端后端忽略它。'
}
