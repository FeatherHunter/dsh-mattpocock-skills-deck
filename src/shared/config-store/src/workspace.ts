/**
 * src/shared/config-store/src/workspace.ts —— 工作区后端配置的校验与拼装（#1012）
 *
 * 纯函数，不碰文件系统。文件：`docs/agents/workspace.yaml`（版本 2；
 * 兼容读老 `workspace.json` 版本 1，JSON 是 YAML 的子集，直接可读）。
 * 注释原文与 #1012 票定案骨架逐字一致，改一个字注释门禁就红。
 *
 * 2026-11-02 #1806 起，本文件同时承担工作区身份记录的格式（`docs/agents/workspace-root.yaml`，
 * 见文件末尾的 stringifyIdentityRecord / parseIdentityRecord）：前面这段 #1012 的约定与注释原文
 * 只针对后端配置那一份 YAML；身份记录是另一种文件，只表示「这一层是工作区」，不记录后端。
 *
 * 本文件自包含：要用的小工具自己写一遍，不引用别的单元。
 * 原因是产物之间零相对引用（同层互引门禁），与 label-color-core 把同一段
 * 十六进制打印在 colors.ts 与 prompt.ts 各写一遍是同一个道理。
 * 文本入口（parseWorkspaceText）也住这里：兼容垫片与房间文件不许用裸包引用，
 * 产物在 shared 层用裸包是允许的方向；入口守卫数字与适配器同值，行为一致由门禁钉。
 * 布局缺席：读（v1 老文件本来就没有）与写（调用方还没拿到值，如迁移与首次绑定）
 * 都允许缺，缺了整段省略，绝不编默认值；一旦写进去，覆盖写必须由调用方读改写保住。
 *
 * 布局取值的白名单不写在这里：唯一真源是 src/shared/doc-layout/src/layouts.ts，由调用方
 * 作为 layouts 参数传进来（共享层内部不许互相引用，所以核不能直接 import 它，见上面那条
 * 「自包含」的由来）。核只回答「传进来的名单里认不认得这个值」，自己不再保留一份字面量（#1342）。
 */

import { parse as parseYaml } from 'yaml'
import type { ConfigParseResult, ConfigStringifyResult } from './ports.js'

/** 工作区后端配置的新路径（YAML）与老路径（JSON，只做兼容读）。 */
export const WORKSPACE_YAML_REL = 'docs/agents/workspace.yaml'
export const WORKSPACE_JSON_REL = 'docs/agents/workspace.json'
/**
 * 工作区身份记录（#1806）：只表示「这一层是一个工作区」，不表示用哪个后端。
 * 与后端记录 `workspace.yaml` 同属根判定认的两份插件记录，所以路径也放在这里一处定义；
 * 判定层（src/host/workspaceKey.ts）与写入侧都必须 import 这里，不许各自再抄字面量。
 */
export const WORKSPACE_IDENTITY_REL = 'docs/agents/workspace-root.yaml'
/**
 * 从属记录（#1806 第 3 步）：表示「这一层不是工作区，归上面的工作区」。
 * 与身份记录同一套写法，但语义相反：它遮住同一层已有的两份记录，让判定继续往上找。
 * 「并入上级工作区」写它而不是删旧记录，是因为历史数据不迁移、不删除，而且动作要可逆
 * （删掉从属记录，这个目录原来的记录就重新生效）。
 */
export const WORKSPACE_MEMBER_REL = 'docs/agents/workspace-member.yaml'
/**
 * 人写的说明文件路径（后端选择说明）。判定层从 #1806 起不读它、也不拿它当根标记；
 * 界面事实用它判断「历史遗留：有说明文件、但没有任何工作区记录」，这时只提示、不参与判定。
 */
export const WORKSPACE_TRACKER_DOC_REL = 'docs/agents/issue-tracker.md'
/** 核认识的版本就是 2（老 JSON 是版本 1，读进来做迁移）。 */
export const WORKSPACE_KNOWN_VERSION = 2

/** 文件字符数上限（与适配器同数；超了说明拿错了文件）。 */
export const MAX_WORKSPACE_FILE_CHARS = 65536
/** 别名数量上限（与适配器同数；正常文件里一个别名都不会有）。 */
export const MAX_WORKSPACE_ALIASES = 50

const HEADER = [
  '# 本文件的注释由插件生成；你自己加的注释会在下次写入时被替换。',
  '# 这份文件随仓库走：提交之后就团队共享，改动会影响所有人。',
]
const COMMENT_BACKEND = '# 这条工作区用哪个后端'
const COMMENT_PICKED = '# 这次选择发生的时间（毫秒）'
const COMMENT_SOURCE =
  '# 这条选择是谁做的：user=人在面板里亲手选的；migrated=从老版本机记忆搬来的；detected=插件按声明文件或自动识别生成的'
const COMMENT_LAYOUT_1 = '# 域文档布局：single=单上下文（各部分共用一套用语，根目录一份 GLOSSARY.md）；'
const COMMENT_LAYOUT_2 = '# multi=多上下文（各有各的用语，子项目各一份 GLOSSARY.md，根目录一份 GLOSSARY-MAP.md指过去）'

const SOURCES_V2 = ['user', 'migrated', 'detected']
const SOURCES_V1 = ['user', 'migrated', 'detected', 'auto']
const KNOWN_KEYS = ['version', 'backendId', 'pickedAt', 'source', 'layout']

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

function fail(reason: 'bad-shape' | 'unknown-keys', message: string, keys?: string[]): ConfigParseResult {
  return keys ? { ok: false, reason, message, keys } : { ok: false, reason, message }
}

/** 写 YAML 纯量：能裸写才裸写，拿不准的一律双引号，只写不错的保守方向。 */
function esc(text: string): string {
  if (text === '') return "''"
  const lower = text.toLowerCase()
  if (/^[A-Za-z_][A-Za-z0-9_\-]*$/.test(text) && lower !== 'yes' && lower !== 'no' && lower !== 'y' && lower !== 'n' && lower !== 'on' && lower !== 'off' && lower !== 'true' && lower !== 'false' && lower !== 'null' && lower !== '~') {
    return text
  }
  return (
    '"' +
    text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, (c) => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4)) +
    '"'
  )
}

/** 数一数文本里用了多少个别名。注释里的不算，先去掉行注释。 */
function countAliases(text: string): number {
  const noComments = text.replace(/(^|\s)#[^\n]*$/gm, '$1')
  const hits = noComments.match(/(^|[\s\[{,])\*[A-Za-z0-9_-]+/g)
  return hits ? hits.length : 0
}

/**
 * 文本入口：超大与别名两道守卫 → YAML 解析（钉死 core 模式）→ 校验。
 * 给不能用裸包引用的调用方（兼容垫片）；宿主适配器走自己的 parseConfig，
 * 两处守卫数字相同、行为一致（门禁从行为上钉住）。
 * layouts 是这次允许的布局取值（调用方从唯一真源 src/shared/doc-layout 取，见文件头）。
 */
export function parseWorkspaceText(text: unknown, layouts: readonly string[]): ConfigParseResult {
  if (typeof text !== 'string') {
    return { ok: false, reason: 'yaml-error', message: '要解析的不是一段文字' }
  }
  const stripped = text.replace(/^\uFEFF/, '')
  if (stripped.length > MAX_WORKSPACE_FILE_CHARS) {
    return {
      ok: false,
      reason: 'oversize',
      message: '这份文件太大了（' + stripped.length + ' 字，上限 ' + MAX_WORKSPACE_FILE_CHARS + ' 字），核拒绝解析：配置文件本该很小，超了说明拿错了文件',
    }
  }
  if (countAliases(stripped) > MAX_WORKSPACE_ALIASES) {
    return {
      ok: false,
      reason: 'aliases',
      message: '这份文件里的别名太多了（上限 ' + MAX_WORKSPACE_ALIASES + ' 个），核拒绝解析：正常配置文件里一个别名都不会有',
    }
  }
  let doc: unknown = null
  try {
    doc = parseYaml(stripped, { schema: 'core', maxAliasCount: MAX_WORKSPACE_ALIASES, uniqueKeys: true })
  } catch (e) {
    const msg = String((e && (e as Error).message) || e || '')
    if (/alias/i.test(msg)) {
      return { ok: false, reason: 'aliases', message: '这份文件里的别名太多了，核拒绝解析：正常配置文件里一个别名都不会有' }
    }
    return { ok: false, reason: 'yaml-error', message: '这份文件的内容不是合法的 YAML（也就是老的 JSON 也不是）：' + msg.slice(0, 160) }
  }
  if (doc === undefined || doc === null || (typeof doc === 'string' && (doc as string).trim() === '')) {
    return { ok: false, reason: 'bad-shape', message: '这份文件里什么都没有（空白文件）' }
  }
  return parseWorkspace(doc, layouts)
}

/** 校验一份已解析出来的工作区配置。版本高于认识时读成功标只读（写时由拼装拒绝）。
 *  layouts 是这次允许的布局取值（调用方从唯一真源 src/shared/doc-layout 取，见文件头）。 */
export function parseWorkspace(doc: unknown, layouts: readonly string[]): ConfigParseResult {
  if (!isRecord(doc)) return fail('bad-shape', '工作区配置文件里放的不是一组「名字 → 值」，读到的是清单或一段文字')
  const strange = Object.keys(doc).filter((k) => KNOWN_KEYS.indexOf(k) < 0)
  if (strange.length > 0) {
    return fail('unknown-keys', '工作区配置文件里有多出来的名字，核不认识它们：' + strange.join('、'), strange)
  }
  if (!isInt(doc['version'])) return fail('bad-shape', '工作区配置文件里的 version 必须是数字')
  const version = doc['version'] as number
  if (version > WORKSPACE_KNOWN_VERSION) {
    return {
      ok: true,
      value: doc,
      readonly: true,
      warnings: ['version-newer：这份文件是版本 ' + version + '，核只认识到版本 2，可以读来展示，不许写回去（写回去会把新字段抹掉）。请升级插件。'],
    }
  }
  if (version !== 1 && version !== 2) return fail('bad-shape', '工作区配置文件里的 version 现在只认 1（老 JSON 迁移用）与 2')
  if (typeof doc['backendId'] !== 'string' || doc['backendId'].trim() === '') {
    return fail('bad-shape', '工作区配置文件里的 backendId 必须是一段非空文字（YAML 会把没加引号的 yes/no/on 读成文字、把 1.10 读成数字，类型对不上的按坏形状回）')
  }
  if (!isInt(doc['pickedAt']) || (doc['pickedAt'] as number) < 0) {
    return fail('bad-shape', '工作区配置文件里的 pickedAt 必须是选择发生的时间（毫秒，非负整数）')
  }
  const allowed = version === 2 ? SOURCES_V2 : SOURCES_V1
  if (typeof doc['source'] !== 'string' || allowed.indexOf(doc['source']) < 0) {
    return fail(
      'bad-shape',
      version === 2
        ? '工作区配置文件里的 source 必须是 user（人亲手选的）、migrated（从老版本记忆搬来的）、detected（插件按声明或自动识别生成的）三者之一'
        : '工作区配置文件里的 source 必须是 user、migrated、detected、auto 四者之一',
    )
  }
  // 布局缺席允许：v1 老文件本来就没有；v2 文件缺了也照读（值里不带 layout 键）。
  // 写布局是调用方的事（有点确认/迁移时带上）；一旦写进去，覆盖写必须读改写保住。
  if (doc['layout'] !== undefined && (typeof doc['layout'] !== 'string' || layouts.indexOf(doc['layout']) < 0)) {
    return fail('bad-shape', '工作区配置文件里的 layout 必须是这些取值之一：' + layouts.join('、'))
  }
  const value: Record<string, unknown> = {
    version,
    backendId: (doc['backendId'] as string).trim(),
    pickedAt: doc['pickedAt'],
    source: doc['source'],
  }
  if (doc['layout'] !== undefined) value['layout'] = doc['layout']
  return { ok: true, value, readonly: false, warnings: [] }
}

/** 拼装：模板 + 值，一律出版本 2；高版本拒绝写（旧版本不许把新字段抹掉）。
 *  version 缺席默认 2，传 1 视为升级写出（老版本 1 只用来读）；布局缺席整段省略。
 *  layouts 是这次允许的布局取值（调用方从唯一真源 src/shared/doc-layout 取，见文件头）。 */
export function stringifyWorkspace(value: unknown, layouts: readonly string[]): ConfigStringifyResult {
  if (!isRecord(value)) return { ok: false, reason: 'bad-shape', message: '要写入的工作区配置不是一组「名字 → 值」' }
  const strange = Object.keys(value).filter((k) => KNOWN_KEYS.indexOf(k) < 0)
  if (strange.length > 0) {
    return { ok: false, reason: 'unknown-keys', message: '要写入的工作区配置里有多出来的名字，核不会把它们写进去：' + strange.join('、'), keys: strange }
  }
  const version = value['version'] === undefined ? WORKSPACE_KNOWN_VERSION : value['version']
  if (!isInt(version)) return { ok: false, reason: 'bad-shape', message: '要写入的工作区配置里的 version 必须是数字（缺席默认 2）' }
  if ((version as number) > WORKSPACE_KNOWN_VERSION) {
    return {
      ok: false,
      reason: 'version-newer',
      message: '拒绝写入：这份工作区配置是版本 ' + String(version) + '，核只认识到版本 2。旧版本写回去会把新字段抹掉，请升级插件后再改。',
    }
  }
  if (version !== 1 && version !== WORKSPACE_KNOWN_VERSION) return { ok: false, reason: 'bad-shape', message: '要写入的工作区配置里的 version 必须是 1（升级写出）或 2' }
  const check = parseWorkspace({
    version: WORKSPACE_KNOWN_VERSION,
    backendId: value['backendId'],
    pickedAt: value['pickedAt'],
    source: value['source'],
    layout: value['layout'],
  }, layouts)
  if (!check.ok) return { ok: false, reason: check.reason === 'unknown-keys' ? 'unknown-keys' : 'bad-shape', message: check.message, keys: check.keys }
  const v = (check as { ok: true; value: Record<string, unknown> }).value
  const lines = [...HEADER]
  lines.push('version: ' + String(v['version']))
  lines.push(COMMENT_BACKEND)
  lines.push('backendId: ' + esc(String(v['backendId'])))
  lines.push(COMMENT_PICKED)
  lines.push('pickedAt: ' + String(v['pickedAt']))
  lines.push(COMMENT_SOURCE)
  lines.push('source: ' + esc(String(v['source'])))
  if (v['layout'] !== undefined) {
    lines.push(COMMENT_LAYOUT_1)
    lines.push(COMMENT_LAYOUT_2)
    lines.push('layout: ' + esc(String(v['layout'])))
  }
  return { ok: true, text: lines.join('\n') + '\n' }
}

/**
 * 工作区身份记录（#1806）：只回答「这一层是不是一个工作区」，不回答用哪个后端。
 *
 * 为什么单独一份文件、而不是往 workspace.yaml 里加字段：后端记录是「人选了哪个后端」的
 * 产物，一场只读的初始化、或人显式「标为独立工作区」，都不该顺带假装选了后端。
 * 两份文件同属判定层认的插件记录（见 src/host/workspaceKey.ts），路径都定义在上方。
 *
 * 文件由插件写、内容由插件独占；人删掉它，这个目录就重新按上级工作区看待。
 * 判定层只查它在不在、不读内容，所以这里的内容格式只服务于排查与将来展示，
 * 坏内容不会改变归属（删了才改变）。
 */
export const WORKSPACE_IDENTITY_KIND = 'workspace-root'
/** 身份记录版本；与后端记录的版本各记各的，互不影响。 */
export const WORKSPACE_IDENTITY_KNOWN_VERSION = 1
/** 谁写的这份记录：setup=初始化流程走完时插件自己补的；user=人在面板上显式标的。 */
export const WORKSPACE_IDENTITY_SOURCES = ['setup', 'user']
const IDENTITY_KEYS = ['version', 'kind', 'writtenAt', 'source']
const IDENTITY_HEADER = [
  '# 工作区身份记录：这份文件由插件写下，表示「这个目录是一个工作区」。',
  '# 它不记录用哪个后端（那是 docs/agents/workspace.yaml 的事）。',
  '# 删掉它，这个目录就会按上级工作区看待。',
]

/** 拼装身份记录文本。值不合法时回失败，绝不写出半份文件。 */
export function stringifyIdentityRecord(value: unknown): ConfigStringifyResult {
  if (!isRecord(value)) return { ok: false, reason: 'bad-shape', message: '要写入的工作区身份记录不是一组「名字 → 值」' }
  const strange = Object.keys(value).filter((k) => IDENTITY_KEYS.indexOf(k) < 0)
  if (strange.length > 0) {
    return { ok: false, reason: 'unknown-keys', message: '要写入的工作区身份记录里有多出来的名字，核不会把它们写进去：' + strange.join('、'), keys: strange }
  }
  const version = value['version'] === undefined ? WORKSPACE_IDENTITY_KNOWN_VERSION : value['version']
  if (!isInt(version)) return { ok: false, reason: 'bad-shape', message: '工作区身份记录里的 version 必须是数字（缺席默认 1）' }
  if ((version as number) > WORKSPACE_IDENTITY_KNOWN_VERSION) {
    return {
      ok: false,
      reason: 'version-newer',
      message: '拒绝写入：这份工作区身份记录是版本 ' + String(version) + '，核只认识到版本 1。旧版本写回去会把新字段抹掉，请升级插件后再改。',
    }
  }
  if (version !== WORKSPACE_IDENTITY_KNOWN_VERSION) return { ok: false, reason: 'bad-shape', message: '工作区身份记录现在只出版本 1' }
  if (value['kind'] !== WORKSPACE_IDENTITY_KIND) {
    return { ok: false, reason: 'bad-shape', message: '工作区身份记录里的 kind 必须是 ' + WORKSPACE_IDENTITY_KIND + '（这份文件只表示「这一层是工作区」）' }
  }
  if (!isInt(value['writtenAt']) || (value['writtenAt'] as number) < 0) {
    return { ok: false, reason: 'bad-shape', message: '工作区身份记录里的 writtenAt 必须是写下这份文件的时间（毫秒，非负整数）' }
  }
  if (typeof value['source'] !== 'string' || WORKSPACE_IDENTITY_SOURCES.indexOf(value['source']) < 0) {
    return { ok: false, reason: 'bad-shape', message: '工作区身份记录里的 source 必须是 setup（初始化流程补写的）、user（人在面板上显式标的）两者之一' }
  }
  const lines = [...IDENTITY_HEADER]
  lines.push('version: ' + String(WORKSPACE_IDENTITY_KNOWN_VERSION))
  lines.push('kind: ' + WORKSPACE_IDENTITY_KIND)
  lines.push('writtenAt: ' + String(value['writtenAt']))
  lines.push('source: ' + esc(value['source'] as string))
  return { ok: true, text: lines.join('\n') + '\n' }
}

/** 读身份记录文本。判定层不靠它，排查与展示靠它；读不懂就明说读不懂，不猜。 */
export function parseIdentityRecord(text: unknown): ConfigParseResult {
  if (typeof text !== 'string') return { ok: false, reason: 'yaml-error', message: '要解析的不是一段文字' }
  const stripped = text.replace(/^\uFEFF/, '')
  if (stripped.length > MAX_WORKSPACE_FILE_CHARS) {
    return { ok: false, reason: 'oversize', message: '这份工作区身份记录太大了（' + stripped.length + ' 字，上限 ' + MAX_WORKSPACE_FILE_CHARS + ' 字），核拒绝解析' }
  }
  let doc: unknown = null
  try {
    doc = parseYaml(stripped, { schema: 'core', maxAliasCount: MAX_WORKSPACE_ALIASES, uniqueKeys: true })
  } catch (e) {
    const msg = String((e && (e as Error).message) || e || '')
    return { ok: false, reason: 'yaml-error', message: '这份工作区身份记录的内容不是合法的 YAML：' + msg.slice(0, 160) }
  }
  if (!isRecord(doc)) return fail('bad-shape', '工作区身份记录里放的不是一组「名字 → 值」')
  const strange = Object.keys(doc).filter((k) => IDENTITY_KEYS.indexOf(k) < 0)
  if (strange.length > 0) return fail('unknown-keys', '工作区身份记录里有多出来的名字，核不认识它们：' + strange.join('、'), strange)
  if (doc['version'] !== WORKSPACE_IDENTITY_KNOWN_VERSION) {
    return fail('bad-shape', '工作区身份记录里的 version 现在只认 1')
  }
  if (doc['kind'] !== WORKSPACE_IDENTITY_KIND) return fail('bad-shape', '工作区身份记录里的 kind 必须是 ' + WORKSPACE_IDENTITY_KIND)
  if (!isInt(doc['writtenAt']) || (doc['writtenAt'] as number) < 0) return fail('bad-shape', '工作区身份记录里的 writtenAt 必须是毫秒时间戳')
  if (typeof doc['source'] !== 'string' || WORKSPACE_IDENTITY_SOURCES.indexOf(doc['source']) < 0) {
    return fail('bad-shape', '工作区身份记录里的 source 必须是 setup 或 user')
  }
  return { ok: true, value: { version: doc['version'], kind: doc['kind'], writtenAt: doc['writtenAt'], source: doc['source'] }, readonly: false, warnings: [] }
}

/**
 * 从属记录（#1806 第 3 步）：只回答「这一层归上面的工作区、不是独立工作区」，不回答用哪个后端。
 *
 * 为什么需要它：人要求把某个目录「并入上级工作区」时，不能删掉这个目录里已有的
 * workspace.yaml 或 workspace-root.yaml——历史数据不迁移、不删除，而且动作必须可逆。
 * 从属记录只是一份「遮罩」：判定层看到它，就跳过这一层已有的记录继续往上找；
 * 人再点「标为独立工作区」时删掉它，原来的记录重新生效。
 *
 * 文件由插件写、内容由插件独占；判定层只查它在不在、不读内容，坏内容不会改变归属。
 */
export const WORKSPACE_MEMBER_KIND = 'workspace-member'
/** 从属记录版本；与身份记录各记各的。 */
export const WORKSPACE_MEMBER_KNOWN_VERSION = 1
/** 谁写的这份记录：目前只有 user=人在面板上显式选择「并入上级工作区」。 */
export const WORKSPACE_MEMBER_SOURCES = ['user']
const MEMBER_KEYS = ['version', 'kind', 'writtenAt', 'source']
const MEMBER_HEADER = [
  '# 从属记录：这份文件由插件写下，表示「这个目录归上面的工作区，不算独立工作区」。',
  '# 它不记录用哪个后端，也不删除这个目录里已有的工作区记录（那些记录只是被这份文件盖住）。',
  '# 删掉它，这个目录里已有的工作区记录会重新生效。',
]

/** 拼装从属记录文本。值不合法时回失败，绝不写出半份文件。 */
export function stringifyMemberRecord(value: unknown): ConfigStringifyResult {
  if (!isRecord(value)) return { ok: false, reason: 'bad-shape', message: '要写入的从属记录不是一组「名字 → 值」' }
  const strange = Object.keys(value).filter((k) => MEMBER_KEYS.indexOf(k) < 0)
  if (strange.length > 0) {
    return { ok: false, reason: 'unknown-keys', message: '要写入的从属记录里有多出来的名字，核不会把它们写进去：' + strange.join('、'), keys: strange }
  }
  const version = value['version'] === undefined ? WORKSPACE_MEMBER_KNOWN_VERSION : value['version']
  if (!isInt(version)) return { ok: false, reason: 'bad-shape', message: '从属记录里的 version 必须是数字（缺席默认 1）' }
  if ((version as number) > WORKSPACE_MEMBER_KNOWN_VERSION) {
    return {
      ok: false,
      reason: 'version-newer',
      message: '拒绝写入：这份从属记录是版本 ' + String(version) + '，核只认识到版本 1。旧版本写回去会把新字段抹掉，请升级插件后再改。',
    }
  }
  if (version !== WORKSPACE_MEMBER_KNOWN_VERSION) return { ok: false, reason: 'bad-shape', message: '从属记录现在只出版本 1' }
  if (value['kind'] !== WORKSPACE_MEMBER_KIND) {
    return { ok: false, reason: 'bad-shape', message: '从属记录里的 kind 必须是 ' + WORKSPACE_MEMBER_KIND + '（这份文件只表示「这一层归上面的工作区」）' }
  }
  if (!isInt(value['writtenAt']) || (value['writtenAt'] as number) < 0) {
    return { ok: false, reason: 'bad-shape', message: '从属记录里的 writtenAt 必须是写下这份文件的时间（毫秒，非负整数）' }
  }
  if (typeof value['source'] !== 'string' || WORKSPACE_MEMBER_SOURCES.indexOf(value['source']) < 0) {
    return { ok: false, reason: 'bad-shape', message: '从属记录里的 source 必须是 user（人在面板上显式并入上级）' }
  }
  const lines = [...MEMBER_HEADER]
  lines.push('version: ' + String(WORKSPACE_MEMBER_KNOWN_VERSION))
  lines.push('kind: ' + WORKSPACE_MEMBER_KIND)
  lines.push('writtenAt: ' + String(value['writtenAt']))
  lines.push('source: ' + esc(value['source'] as string))
  return { ok: true, text: lines.join('\n') + '\n' }
}

/** 读从属记录文本。判定层不靠它，排查与展示靠它；读不懂就明说读不懂，不猜。 */
export function parseMemberRecord(text: unknown): ConfigParseResult {
  if (typeof text !== 'string') return { ok: false, reason: 'yaml-error', message: '要解析的不是一段文字' }
  const stripped = text.replace(/^\uFEFF/, '')
  if (stripped.length > MAX_WORKSPACE_FILE_CHARS) {
    return { ok: false, reason: 'oversize', message: '这份从属记录太大了（' + stripped.length + ' 字，上限 ' + MAX_WORKSPACE_FILE_CHARS + ' 字），核拒绝解析' }
  }
  let doc: unknown = null
  try {
    doc = parseYaml(stripped, { schema: 'core', maxAliasCount: MAX_WORKSPACE_ALIASES, uniqueKeys: true })
  } catch (e) {
    const msg = String((e && (e as Error).message) || e || '')
    return { ok: false, reason: 'yaml-error', message: '这份从属记录的内容不是合法的 YAML：' + msg.slice(0, 160) }
  }
  if (!isRecord(doc)) return fail('bad-shape', '从属记录里放的不是一组「名字 → 值」')
  const strange = Object.keys(doc).filter((k) => MEMBER_KEYS.indexOf(k) < 0)
  if (strange.length > 0) return fail('unknown-keys', '从属记录里有多出来的名字，核不认识它们：' + strange.join('、'), strange)
  if (doc['version'] !== WORKSPACE_MEMBER_KNOWN_VERSION) return fail('bad-shape', '从属记录里的 version 现在只认 1')
  if (doc['kind'] !== WORKSPACE_MEMBER_KIND) return fail('bad-shape', '从属记录里的 kind 必须是 ' + WORKSPACE_MEMBER_KIND)
  if (!isInt(doc['writtenAt']) || (doc['writtenAt'] as number) < 0) return fail('bad-shape', '从属记录里的 writtenAt 必须是毫秒时间戳')
  if (typeof doc['source'] !== 'string' || WORKSPACE_MEMBER_SOURCES.indexOf(doc['source']) < 0) {
    return fail('bad-shape', '从属记录里的 source 必须是 user')
  }
  return { ok: true, value: { version: doc['version'], kind: doc['kind'], writtenAt: doc['writtenAt'], source: doc['source'] }, readonly: false, warnings: [] }
}

