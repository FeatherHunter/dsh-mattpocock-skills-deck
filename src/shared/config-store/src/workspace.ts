/**
 * src/shared/config-store/src/workspace.ts —— 工作区后端配置的校验与拼装（#1012）
 *
 * 纯函数，不碰文件系统。文件：`docs/agents/workspace.yaml`（版本 2；
 * 兼容读老 `workspace.json` 版本 1，JSON 是 YAML 的子集，直接可读）。
 * 注释原文与 #1012 票定案骨架逐字一致，改一个字注释门禁就红。
 *
 * 本文件自包含：要用的小工具自己写一遍，不引用别的单元。
 * 原因是产物之间零相对引用（同层互引门禁），与 label-color-core 把同一段
 * 十六进制打印在 colors.ts 与 prompt.ts 各写一遍是同一个道理。
 * 文本入口（parseWorkspaceText）也住这里：兼容垫片与房间文件不许用裸包引用，
 * 产物在 shared 层用裸包是允许的方向；入口守卫数字与适配器同值，行为一致由门禁钉。
 * 布局缺席：读（v1 老文件本来就没有）与写（调用方还没拿到值，如迁移与首次绑定）
 * 都允许缺，缺了整段省略，绝不编默认值；一旦写进去，覆盖写必须由调用方读改写保住。
 */

import { parse as parseYaml } from 'yaml'
import type { ConfigParseResult, ConfigStringifyResult } from './ports.js'

/** 工作区后端配置的新路径（YAML）与老路径（JSON，只做兼容读）。 */
export const WORKSPACE_YAML_REL = 'docs/agents/workspace.yaml'
export const WORKSPACE_JSON_REL = 'docs/agents/workspace.json'
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
const COMMENT_LAYOUT = '# 面板布局：single=单栏；multi=多栏'

const SOURCES_V2 = ['user', 'migrated', 'detected']
const SOURCES_V1 = ['user', 'migrated', 'detected', 'auto']
const LAYOUTS = ['single', 'multi']
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
 */
export function parseWorkspaceText(text: unknown): ConfigParseResult {
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
  return parseWorkspace(doc)
}

/** 校验一份已解析出来的工作区配置。版本高于认识时读成功标只读（写时由拼装拒绝）。 */
export function parseWorkspace(doc: unknown): ConfigParseResult {
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
  if (doc['layout'] !== undefined && (typeof doc['layout'] !== 'string' || LAYOUTS.indexOf(doc['layout']) < 0)) {
    return fail('bad-shape', '工作区配置文件里的 layout 必须是 single（单栏）或 multi（多栏）')
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
 *  version 缺席默认 2，传 1 视为升级写出（老版本 1 只用来读）；布局缺席整段省略。 */
export function stringifyWorkspace(value: unknown): ConfigStringifyResult {
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
  })
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
    lines.push(COMMENT_LAYOUT)
    lines.push('layout: ' + esc(String(v['layout'])))
  }
  return { ok: true, text: lines.join('\n') + '\n' }
}
