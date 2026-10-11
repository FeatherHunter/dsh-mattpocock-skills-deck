/**
 * config-store-core/src/labels.ts —— 标签配色数据的校验与拼装（#1012）
 *
 * 纯函数，不碰文件系统。文件：`docs/agents/label-colors.yaml`（版本 1；
 * 兼容读老 `label-colors.json`，老文件没有版本，当 1 读）。
 * 它是数据不是配置：键是标签名（动态，多少个都行），值是颜色或颜色加一句说明。
 * 颜色值本身的合法性（六位十六进制）由配色核定，这里只管形状：
 * 非法颜色按「还没配颜色」由调用方归一，不算文件坏掉（沿房间既有口径）。
 * 自包含：小工具自己写一遍，不引用别的单元（产物零相对引用，见 workspace.ts 头注）。
 * YAML 入口守卫住宿主适配器的 parseConfig（唯一入口）。
 */

import type { ConfigParseResult, ConfigStringifyResult } from './ports.js'

/** 标签配色数据的新路径（YAML）与老路径（JSON，只做兼容读）。 */
export const LABEL_COLORS_YAML_REL = 'docs/agents/label-colors.yaml'
export const LABEL_COLORS_JSON_REL = 'docs/agents/label-colors.json'
/** 核认识的版本就是 1（老文件没有版本，当 1 读）。 */
export const LABEL_COLORS_KNOWN_VERSION = 1

const HEADER = ['# 本文件的注释由插件生成；你自己加的注释会在下次写入时被替换。']
const COMMENT_VERSION = '# 这一份数据的版本号（核不认识的新版本只读不写）'
const ENTRY_KEYS = ['color', 'description']

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

/** 不能当标签名的名字：会撞上原型链，读出来就变味。 */
function isDangerousKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype'
}

function fail(reason: 'bad-shape' | 'unknown-keys', message: string, keys?: string[]): ConfigParseResult {
  return keys ? { ok: false, reason, message, keys } : { ok: false, reason, message }
}

/** 写 YAML 纯量：能裸写才裸写，拿不准的一律双引号（标签名与颜色共用这一支）。 */
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

/** 校验一份已解析出来的标签配色。版本高于认识时读成功标只读。 */
export function parseLabelColors(doc: unknown): ConfigParseResult {
  if (!isRecord(doc)) return fail('bad-shape', '标签配色文件里放的不是一组「标签 → 颜色」，读到的是清单或一段文字')
  let version = 1
  if (doc['version'] !== undefined) {
    // 兼容注意：版本号的位置就叫 version，所以标签名不能叫 version。
    // 老文件里如果真有一个叫 version 的标签，这里会明确报错并指改名，不断言它是版本。
    if (!isInt(doc['version'])) return fail('bad-shape', '标签配色文件里的 version 必须是数字（如果 version 是你的一个标签名，请把它改个名字：version 是版本号的位置）')
    version = doc['version'] as number
    if (version > LABEL_COLORS_KNOWN_VERSION) {
      return {
        ok: true,
        value: doc,
        readonly: true,
        warnings: ['version-newer：这份文件是版本 ' + version + '，核只认识到版本 1，可以读来展示，不许写回去。请升级插件。'],
      }
    }
    if (version < 1) return fail('bad-shape', '标签配色文件里的 version 现在只认 1（没有版本的老文件照读）')
  }
  const colors: Record<string, unknown> = {}
  for (const name of Object.keys(doc)) {
    if (name === 'version') continue
    if (name.trim() === '') return fail('bad-shape', '标签配色文件里有一个标签名是空的')
    if (isDangerousKey(name)) return fail('bad-shape', '标签配色文件里不能用这个标签名：' + name)
    const entry = doc[name]
    if (typeof entry === 'string') {
      colors[name] = entry
      continue
    }
    if (isRecord(entry)) {
      const strange = Object.keys(entry).filter((k) => ENTRY_KEYS.indexOf(k) < 0)
      if (strange.length > 0) {
        return fail('unknown-keys', '标签配色文件里标签「' + name + '」有多出来的名字：' + strange.join('、'), strange)
      }
      if (typeof entry['color'] !== 'string') {
        return fail('bad-shape', '标签配色文件里标签「' + name + '」的 color 必须是一段文字（颜色，不带井号的六位）')
      }
      if (entry['description'] !== undefined && typeof entry['description'] !== 'string') {
        return fail('bad-shape', '标签配色文件里标签「' + name + '」的 description 必须是一段文字')
      }
      const norm: Record<string, unknown> = { color: entry['color'] }
      if (entry['description'] !== undefined) norm['description'] = entry['description']
      colors[name] = norm
      continue
    }
    return fail(
      'bad-shape',
      '标签「' + name + '」的颜色写法不对，这个位置只能写两种样子：直接写颜色，例如 "8b5cf6"；或者写成 {"color": "8b5cf6", "description": "地图票"}',
    )
  }
  return { ok: true, value: { version, colors }, readonly: false, warnings: [] }
}

/**
 * 拼装。收两种形状：直给标签表，或 {version, colors} 包裹（读回来的就是后者），
 * 写出来永远是完整模板（version 在头，标签按给进来的顺序）。
 */
export function stringifyLabelColors(value: unknown): ConfigStringifyResult {
  if (!isRecord(value)) return { ok: false, reason: 'bad-shape', message: '要写入的标签配色不是一组「标签 → 颜色」' }
  // 包裹与直给二选一：带 colors 键的就是 {version, colors} 包裹；直给的标签表里
  // 不能出现 version / colors 这两个名字（它们是格式保留字，标签请改名）。
  const looksWrapped = value['colors'] !== undefined || isInt(value['version'])
  let version = 1
  let table: unknown = value
  if (looksWrapped) {
    if (!isInt(value['version'])) return { ok: false, reason: 'bad-shape', message: '要写入的标签配色里的 version 必须是数字 1' }
    version = value['version'] as number
    table = value['colors']
  } else if ('version' in value || 'colors' in value) {
    return { ok: false, reason: 'bad-shape', message: '直给的标签表里不能有 version / colors 这两个名字（它们是格式保留字）。请用 {version, colors} 包裹，或把这两个标签改名。' }
  }
  if (version > LABEL_COLORS_KNOWN_VERSION) {
    return {
      ok: false,
      reason: 'version-newer',
      message: '拒绝写入：这份标签配色是版本 ' + version + '，核只认识到版本 1。旧版本写回去会把新字段抹掉，请升级插件后再改。',
    }
  }
  if (version !== LABEL_COLORS_KNOWN_VERSION) return { ok: false, reason: 'bad-shape', message: '要写入的标签配色里的 version 必须是 1' }
  if (!isRecord(table)) return { ok: false, reason: 'bad-shape', message: '要写入的标签配色里的 colors 必须是一组「标签 → 颜色」' }
  const probe: Record<string, unknown> = { version }
  for (const k of Object.keys(table)) probe[k] = (table as Record<string, unknown>)[k]
  const check = parseLabelColors(probe)
  if (!check.ok) return { ok: false, reason: check.reason === 'unknown-keys' ? 'unknown-keys' : 'bad-shape', message: check.message, keys: check.keys }
  const colors = ((check as { ok: true; value: Record<string, unknown> }).value['colors'] || {}) as Record<string, unknown>
  const lines = [...HEADER]
  lines.push(COMMENT_VERSION)
  lines.push('version: 1')
  for (const name of Object.keys(colors)) {
    const entry = colors[name]
    if (typeof entry === 'string') {
      lines.push(esc(name) + ': ' + esc(entry))
    } else {
      const rec = entry as Record<string, unknown>
      const inner =
        '{"color": ' + esc(String(rec['color'])) +
        (rec['description'] === undefined ? '' : ', "description": ' + esc(String(rec['description']))) +
        '}'
      lines.push(esc(name) + ': ' + inner)
    }
  }
  return { ok: true, text: lines.join('\n') + '\n' }
}
