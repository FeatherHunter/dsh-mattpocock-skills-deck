// shared/version-control/src/parse-branch.ts —— 域 4 的解析器（#1746 T11）
//
// 口径与其它解析器一致：读不全就返回显式的失败，不给半份；成功才返回 { ok: true, ... }。
// 本片自包含（shared 同层不许互相 import）。标签列表、已并入分支、分支说明三份输出都从这里解析，
// 命令格式串由 commands.ts 生成，两边不各写一份。
export interface TagRecord {
  name: string
  oid: string
  objectType: string
  annotated: boolean
  atMs: number | null
  subject: string
}

export interface BranchParseFailure {
  ok: false
  error: string
  detail: string
}

export interface TagListOk {
  ok: true
  tags: TagRecord[]
}

export interface BranchNameListOk {
  ok: true
  names: string[]
}

export interface BranchDescriptionsOk {
  ok: true
  descriptions: { [branch: string]: string }
}

export interface DescriptionOk {
  ok: true
  text: string | null
}

const OID_RE = /^[0-9a-fA-F]{40}$|^[0-9a-fA-F]{64}$/

function fail(error: string, detail: string): BranchParseFailure {
  return { ok: false, error: error, detail: detail }
}

/** 标签列表：每行五段（名字、对象号、对象类型、打标签时间秒、主题），段间 NUL。
 *  annotated 按对象类型判：附注标签的对象类型是 tag，轻量标签是旧的提交对象（commit 等）。 */
export function parseTagList(stdout: string): TagListOk | BranchParseFailure {
  const text: string = typeof stdout === 'string' ? stdout : ''
  if (!text) return { ok: true, tags: [] }
  const lines: string[] = text.split('\n')
  const tags: TagRecord[] = []
  for (let i: number = 0; i < lines.length; i += 1) {
    const line: string = lines[i]
    if (!line) continue
    const parts: string[] = line.split('\u0000')
    if (parts.length !== 5) return fail('tag-malformed', '第 ' + String(i + 1) + ' 行不是五段（名字、对象号、类型、时间、主题）')
    const name: string = parts[0]
    const oid: string = parts[1]
    const objectType: string = parts[2]
    const atText: string = parts[3]
    if (!name || /\s/.test(name)) return fail('tag-malformed', '第 ' + String(i + 1) + ' 行的标签名是空的或带空白')
    if (!OID_RE.test(oid)) return fail('tag-malformed', '第 ' + String(i + 1) + ' 行的对象号不是 40 或 64 位十六进制')
    if (atText && !/^\d+$/.test(atText)) return fail('tag-malformed', '第 ' + String(i + 1) + ' 行的打标签时间不是秒数')
    tags.push({ name: name, oid: oid, objectType: objectType, annotated: objectType === 'tag', atMs: atText ? Number(atText) * 1000 : null, subject: parts[4] })
  }
  return { ok: true, tags: tags }
}

/** 一行一个分支名（git branch --merged / --no-merged 的输出；以 * 开头的那行是当前分支）。 */
export function parseBranchNameList(stdout: string): BranchNameListOk | BranchParseFailure {
  const text: string = typeof stdout === 'string' ? stdout : ''
  const lines: string[] = text.split('\n')
  const names: string[] = []
  for (let i: number = 0; i < lines.length; i += 1) {
    let line: string = lines[i].replace(/\r$/, '')
    if (!line.trim()) continue
    line = line.replace(/^\*\s*/, '').trim()
    if (!line) continue
    if (/\s/.test(line)) return fail('branch-list-malformed', '第 ' + String(i + 1) + ' 行不是单个分支名：' + line.slice(0, 120))
    names.push(line)
  }
  return { ok: true, names: names }
}

/** 分支说明（git config -z --get-regexp 的输出）：每条「键\n值\0」。键是 branch.<名>.description。 */
export function parseBranchDescriptions(stdout: string): BranchDescriptionsOk | BranchParseFailure {
  const text: string = typeof stdout === 'string' ? stdout : ''
  if (!text) return { ok: true, descriptions: {} }
  const entries: string[] = text.split('\u0000')
  const descriptions: { [branch: string]: string } = {}
  for (let i: number = 0; i < entries.length; i += 1) {
    const entry: string = entries[i]
    if (!entry) continue
    const at: number = entry.indexOf('\n')
    if (at < 0) return fail('description-malformed', '第 ' + String(i + 1) + ' 条不是「键\n值」两段')
    const key: string = entry.slice(0, at)
    const value: string = entry.slice(at + 1)
    const m: RegExpExecArray | null = /^branch\.(.+)\.description$/.exec(key)
    if (!m) return fail('description-malformed', '第 ' + String(i + 1) + ' 条的键不是 branch.<名>.description：' + key.slice(0, 120))
    descriptions[m[1]] = value
  }
  return { ok: true, descriptions: descriptions }
}

/** 单条分支说明（git config --get 的输出）：没有配置时调用方按 exit 1 判无说明，这里只负责去掉行尾换行。
 *  说明本身可以包含换行，所以只去掉 git 追加的那一个行尾换行，不 trim 掉用户写的空白。 */
export function parseDescriptionText(stdout: string): DescriptionOk | BranchParseFailure {
  const text: string = typeof stdout === 'string' ? stdout : ''
  if (!text) return { ok: true, text: null }
  const stripped: string = text.replace(/\r?\n$/, '')
  if (stripped.indexOf('\u0000') >= 0) return fail('description-malformed', '说明里出现了 NUL 字符')
  return { ok: true, text: stripped }
}

export const PARSE_BRANCH_SOURCE = 'src/shared/version-control/src/parse-branch.ts'
