/**
 * src/shared/issue-file/src/marker.ts —— 票面对象类型标记的唯一真源（#1277，口径见 #1275 的 ADR）
 *
 * 标记长这样，独占一行，写在文件头——幂等锚之后、一级标题之前：
 *   <!-- DSH-ISSUE-KIND: spec -->
 *
 * 为什么要有它：规格（spec）与实施票（ticket）约定不带 wayfinder 标签，标签分不出它们；正文形状
 * 只是兜底（ADR 2.3），所以「这张票是哪一种对象」的唯一真源就是这行注释。
 *
 * 谁在读：本地 Markdown 房（读票认规格、建票写入、整份替换搬回）、宿主快照组装层（类型没标对的行
 * 按标记兜底归一）、deck 工具（建票写标记、按类型过滤）。三处引同一份实现，不各写一遍。
 *
 * 纯在哪：只吃字符串、只吐字符串或 null，不读盘、不读钟、不联网；合法值表只在这里写一份。
 */

/** 九种对象类型。顺序与 ADR 2.1 的表一致：容器在前，施工/研判票在后。 */
export const OBJECT_KINDS = Object.freeze([
  'map', 'spec', 'ticket', 'research', 'prototype', 'grilling', 'task', 'bug', 'issue',
] as const)

/** 对象类型的联合类型；调用方拿它给参数与返回值收口。 */
export type ObjectKind = (typeof OBJECT_KINDS)[number]

// 标记的写法只在这里拼：标记名放常量，写入的行与按行判断的正则都从它拼出来，别处不再碰语法细节。
// 不导出这个常量：共享层词汇门禁会把「没人读的导出字符串常量」判红，它的读者只有本文件。
const MARKER_NAME = 'DSH-ISSUE-KIND'

/** 一整行标记的唯一判据：必须从头到尾都是标记，前后多一个字都不算（ADR 2.5 的「独占一行」）。 */
const MARKER_LINE_RE = new RegExp('^<!--\\s*' + MARKER_NAME + '\\s*:\\s*([a-z]+)\\s*-->$')

// 约定「正文不补进度区、建票时由工具写类型标记」的两类对象（规格单与实施票）：
// 判定收在这里一份，deck 规则与房间不必各写一遍 `kind === 'spec' || kind === 'ticket'`。
const HEADER_ONLY_KINDS = Object.freeze(['spec', 'ticket'] as const)

/** 两类「只在文件头写类型」的对象。 */
export type HeaderOnlyKind = (typeof HEADER_ONLY_KINDS)[number]

/** 运行时判断一个字符串是不是九种合法类型之一。 */
export function isObjectKind(value: unknown): value is ObjectKind {
  return typeof value === 'string' && (OBJECT_KINDS as readonly string[]).indexOf(value) >= 0
}

/** 这个类型是不是「只在文件头写标记」的两类（规格 / 实施票）之一。 */
export function isHeaderOnlyKind(value: unknown): value is HeaderOnlyKind {
  return typeof value === 'string' && (HEADER_ONLY_KINDS as readonly string[]).indexOf(value) >= 0
}

/**
 * 给一行可写入的标记文本，结尾带换行（与幂等锚的 `anchorLineFor` 同一习惯，拼进文件头时不缺换行）。
 * 传进来的类型不合法时回空串：宁可不写，也不写一行认不出来的注释。
 */
export function markerLineFor(kind: unknown): string {
  if (!isObjectKind(kind)) return ''
  return '<!-- ' + MARKER_NAME + ': ' + kind + ' -->\n'
}

/**
 * 单独一行是不是标记行：去首尾空白后必须精确是 `<!-- DSH-ISSUE-KIND: <合法值> -->`。
 * 这一行前后还有别的字（比如正文里讲解标记写法时写成一句话）都不算 —— ADR 2.5 要的是独占一行。
 */
export function markerKindOnLine(line: unknown): ObjectKind | null {
  const text = typeof line === 'string' ? line.trim() : ''
  if (!text) return null
  const m = MARKER_LINE_RE.exec(text)
  if (!m) return null
  return isObjectKind(m[1]) ? m[1] : null
}

/**
 * 读文件头里的类型标记：只看第一个一级标题之前（没有一级标题时只看前 10 行）。
 *
 * 为什么只看文件头：标记是文件元数据，按 ADR 2.5 写在标题之前；正文里也可能出现同样的写法
 * （文档里举例说明标记长什么样），那一行不算数。与本地房读 parentKey、created 的口径一致。
 *
 * 回 null 表示「文件头没有合法标记」，不是错 —— 标记允许丢失，调用方按普通票处理。
 */
export function markerKindInHeader(text: unknown): ObjectKind | null {
  const raw = typeof text === 'string' ? text : ''
  if (!raw) return null
  const h1 = /^#+\s+/m.exec(raw)
  const head = h1 ? raw.slice(0, h1.index) : raw.split('\n').slice(0, 10).join('\n')
  for (const line of head.split('\n')) {
    const kind = markerKindOnLine(line)
    if (kind) return kind
  }
  return null
}

/**
 * 读「第一个非空行」上的类型标记：deck 工具往正文最前面写标记时就是这种形状。
 *
 * 与 `markerKindInHeader` 分开是因为两种调用方读的东西不一样：工具读的是它自己刚拼好的正文，
 * 快照与本地房读的是一整份票面文件。两者别混用。
 */
export function markerKindAtStart(text: unknown): ObjectKind | null {
  const raw = typeof text === 'string' ? text : ''
  if (!raw) return null
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    return markerKindOnLine(line)
  }
  return null
}

/**
 * 数文本里有几行合法标记（整行判断，口径同 `markerKindOnLine`）。
 * 建票的单例核对与整份替换的「不许变多 / 不许弄丢」核对都吃这个数——不在别处用正则数子串，
 * 否则正文里引用一句标记写法也会被算成一条标记。
 */
export function countMarkerLines(text: unknown): number {
  const raw = typeof text === 'string' ? text : ''
  if (!raw) return 0
  let count = 0
  for (const line of raw.split('\n')) {
    if (markerKindOnLine(line)) count++
  }
  return count
}

/**
 * 票面文件头写的是不是 spec 标记。快照组装与 deck 列表的兜底共用这一处判断：
 * 「声明类型没标对、但票面文件头写着 spec」的行要当规格容器看，而写正文里举例的标记不算。
 */
export function isSpecHeaderMarked(text: unknown): boolean {
  return markerKindInHeader(text) === 'spec'
}

/**
 * 剥掉文本里所有合法标记行（建票与整份正文合并时用）：留下别的行，一行标记都不留。
 * 行尾的 `\r` 一并去掉，免得 Windows 换行在合并后留下半行空白。
 */
export function stripMarkerLines(text: unknown): string {
  const raw = typeof text === 'string' ? text : ''
  if (!raw) return ''
  return raw
    .split('\n')
    .filter((line) => markerKindOnLine(line) === null)
    .join('\n')
}
