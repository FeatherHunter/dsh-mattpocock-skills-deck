/**
 * src/shared/config-store/src/settings.ts —— 本机全局设置的校验与拼装（#1012）
 *
 * 纯函数，不碰文件系统。文件：`<用户主目录>/.dsh/mattskillsdeck/settings.yaml`（版本 1）。
 * 注释原文与 #1012 票定案骨架逐字一致。读时缺节给默认（写回去自然补全），
 * 未知名字一律拒绝（静默丢掉用户手写的键等于丢数据）。
 * 自包含：小工具自己写一遍，不引用别的单元（产物零相对引用，见 workspace.ts 头注）。
 * YAML 入口守卫住宿主适配器的 parseConfig（唯一入口）。
 */

import type { ConfigParseResult, ConfigStringifyResult } from './ports.js'

/** 本机全局设置：核认识的版本就是 1。 */
export const SETTINGS_KNOWN_VERSION = 1

/** 本机设置在用户主目录下的相对位置（调用方拼绝对路径，核里不碰主目录）。 */
export const SETTINGS_REL_SEGMENTS = ['.dsh', 'mattskillsdeck', 'settings.yaml']

const HEADER = ['# 本文件的注释由插件生成；你自己加的注释会在下次写入时被替换。']
const COMMENT_UI = '# 界面偏好（本机全工作区默认生效）'
const COMMENT_STATE = '# 主列表的状态过滤与排序'
const COMMENT_WORKSPACES = '# 按工作区区分的观看状态（键 = 工作区根目录）'
const COMMENT_BANNER = '# 状态栏横幅与胶囊是否收起'
const COMMENT_NOREPO = '# 无仓库红卡是否已收起'
const COMMENT_SUBWS = '# 红文件夹标志的说明浮层是否已自动展开过'
const COMMENT_DEBUG = '# 本地诊断日志开关'
const COMMENT_TEMPLATES = '# 动作模板（空 = 用默认文本）'

const TOP_KEYS = ['version', 'ui', 'workspaces', 'debug', 'templates']
// labelClicks 只在「读」这一侧认得（老文件里可能已经写进去了，读出来不能报错），写出去的一份里没有它：
// 维护者 2026-10-12 拍板这项不落盘——它只是标签 chip 排序用的热度，丢了不影响功能，没必要占文件。
const UI_KEYS = ['stateFilter', 'sortKey', 'sortDir', 'labelClicks']
const WS_KEYS = ['bannerFolded', 'noRepoDismissed', 'subwsMarkAutoShown']
const DEBUG_KEYS = ['enabled', 'sampleRate']

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

/** 不能当数据键的名字：会撞上原型链，读出来就变味。 */
function isDangerousKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype'
}

function fail(reason: 'bad-shape' | 'unknown-keys', message: string, keys?: string[]): ConfigParseResult {
  return keys ? { ok: false, reason, message, keys } : { ok: false, reason, message }
}

/** 写 YAML 纯量：能裸写才裸写，拿不准的一律双引号（键与值共用这一支）。 */
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

function unknownIn(obj: Record<string, unknown>, allowed: string[]): string[] {
  return Object.keys(obj).filter((k) => allowed.indexOf(k) < 0)
}

/** 校验一份已解析出来的本机设置。版本高于认识时读成功标只读。 */
export function parseSettings(doc: unknown): ConfigParseResult {
  if (!isRecord(doc)) return fail('bad-shape', '本机设置文件里放的不是一组「名字 → 值」，读到的是清单或一段文字')
  const strange = unknownIn(doc, TOP_KEYS)
  if (strange.length > 0) {
    return fail('unknown-keys', '本机设置文件里有多出来的名字，核不认识它们：' + strange.join('、'), strange)
  }
  if (!isInt(doc['version'])) return fail('bad-shape', '本机设置文件里的 version 必须是数字')
  const version = doc['version'] as number
  if (version > SETTINGS_KNOWN_VERSION) {
    return {
      ok: true,
      value: doc,
      readonly: true,
      warnings: ['version-newer：这份文件是版本 ' + version + '，核只认识到版本 1，可以读来展示，不许写回去。请升级插件。'],
    }
  }
  if (version !== SETTINGS_KNOWN_VERSION) return fail('bad-shape', '本机设置文件里的 version 现在只认 1')

  const uiRaw = doc['ui'] === undefined ? {} : doc['ui']
  if (!isRecord(uiRaw)) return fail('bad-shape', '本机设置文件里的 ui 必须是一组「名字 → 值」')
  const uiStrange = unknownIn(uiRaw, UI_KEYS)
  if (uiStrange.length > 0) return fail('unknown-keys', '本机设置文件 ui 节里有多出来的名字：' + uiStrange.join('、'), uiStrange)
  for (const k of ['stateFilter', 'sortKey', 'sortDir']) {
    if (uiRaw[k] !== undefined && typeof uiRaw[k] !== 'string') {
      return fail('bad-shape', '本机设置文件 ui 节里的 ' + k + ' 必须是一段文字')
    }
  }
  const clicksRaw = uiRaw['labelClicks'] === undefined ? {} : uiRaw['labelClicks']
  if (!isRecord(clicksRaw)) return fail('bad-shape', '本机设置文件 ui 节里的 labelClicks 必须是一组「标签 → 次数」')
  const clicks: Record<string, unknown> = {}
  for (const name of Object.keys(clicksRaw)) {
    if (isDangerousKey(name)) return fail('bad-shape', '本机设置文件 labelClicks 里不能用这个名字：' + name)
    const n = clicksRaw[name]
    if (!isFiniteNumber(n) || (n as number) < 0) {
      return fail('bad-shape', '本机设置文件 labelClicks 里「' + name + '」的次数必须是非负数字')
    }
    clicks[name] = n
  }

  // workspaces 节：键是工作区根的可读路径（动态），值里只认三个开关（横幅折叠缺了默认收起，其余缺了默认关）。
  const wsRaw = doc['workspaces'] === undefined ? {} : doc['workspaces']
  if (!isRecord(wsRaw)) return fail('bad-shape', '本机设置文件里的 workspaces 必须是一组「工作区根 → 开关」')
  const workspaces: Record<string, unknown> = {}
  for (const root of Object.keys(wsRaw)) {
    if (root.trim() === '') return fail('bad-shape', '本机设置文件 workspaces 节里有一条的键是空的（键必须是工作区根目录）')
    if (isDangerousKey(root)) return fail('bad-shape', '本机设置文件 workspaces 节里不能用这个名字：' + root)
    const entry = wsRaw[root]
    if (!isRecord(entry)) return fail('bad-shape', '本机设置文件 workspaces 节里「' + root + '」的值必须是一组开关')
    const entryStrange = unknownIn(entry, WS_KEYS)
    if (entryStrange.length > 0) {
      return fail('unknown-keys', '本机设置文件 workspaces 节里「' + root + '」有多出来的名字：' + entryStrange.join('、'), entryStrange)
    }
    const norm: Record<string, unknown> = { bannerFolded: true, noRepoDismissed: false, subwsMarkAutoShown: false }
    for (const k of WS_KEYS) {
      if (entry[k] === undefined) continue
      if (typeof entry[k] !== 'boolean') {
        return fail('bad-shape', '本机设置文件 workspaces 节里「' + root + '」的 ' + k + ' 必须是真假值（YAML 会把没加引号的 yes/no/on 读成文字，那种按坏形状回）')
      }
      norm[k] = entry[k]
    }
    workspaces[root] = norm
  }

  const debugRaw = doc['debug'] === undefined ? {} : doc['debug']
  if (!isRecord(debugRaw)) return fail('bad-shape', '本机设置文件里的 debug 必须是一组「名字 → 值」')
  const debugStrange = unknownIn(debugRaw, DEBUG_KEYS)
  if (debugStrange.length > 0) return fail('unknown-keys', '本机设置文件 debug 节里有多出来的名字：' + debugStrange.join('、'), debugStrange)
  const enabled = debugRaw['enabled'] === undefined ? false : debugRaw['enabled']
  if (typeof enabled !== 'boolean') return fail('bad-shape', '本机设置文件 debug 节里的 enabled 必须是真假值')
  const sampleRate = debugRaw['sampleRate'] === undefined ? 1 : debugRaw['sampleRate']
  if (!isFiniteNumber(sampleRate) || (sampleRate as number) < 0 || (sampleRate as number) > 1) {
    return fail('bad-shape', '本机设置文件 debug 节里的 sampleRate 必须是 0 到 1 之间的数字')
  }

  const tplRaw = doc['templates'] === undefined ? {} : doc['templates']
  if (!isRecord(tplRaw)) return fail('bad-shape', '本机设置文件里的 templates 必须是一组「动作 → 文本」')
  const templates: Record<string, unknown> = {}
  for (const name of Object.keys(tplRaw)) {
    if (isDangerousKey(name)) return fail('bad-shape', '本机设置文件 templates 里不能用这个名字：' + name)
    if (typeof tplRaw[name] !== 'string') return fail('bad-shape', '本机设置文件 templates 里「' + name + '」的值必须是一段文字')
    templates[name] = tplRaw[name]
  }

  return {
    ok: true,
    value: {
      version: 1,
      ui: {
        stateFilter: uiRaw['stateFilter'] === undefined ? '' : uiRaw['stateFilter'],
        sortKey: uiRaw['sortKey'] === undefined ? '' : uiRaw['sortKey'],
        sortDir: uiRaw['sortDir'] === undefined ? '' : uiRaw['sortDir'],
        labelClicks: clicks,
      },
      workspaces,
      debug: { enabled, sampleRate },
      templates,
    },
    readonly: false,
    warnings: [],
  }
}

/** 拼装：先按读的同一套规矩校验并补默认，写出来的永远是完整模板。 */
export function stringifySettings(value: unknown): ConfigStringifyResult {
  if (!isRecord(value)) return { ok: false, reason: 'bad-shape', message: '要写入的本机设置不是一组「名字 → 值」' }
  const strange = unknownIn(value, TOP_KEYS)
  if (strange.length > 0) {
    return { ok: false, reason: 'unknown-keys', message: '要写入的本机设置里有多出来的名字，核不会把它们写进去：' + strange.join('、'), keys: strange }
  }
  if (!isInt(value['version'])) return { ok: false, reason: 'bad-shape', message: '要写入的本机设置里的 version 必须是数字 1' }
  const version = value['version'] as number
  if (version > SETTINGS_KNOWN_VERSION) {
    return {
      ok: false,
      reason: 'version-newer',
      message: '拒绝写入：这份本机设置是版本 ' + version + '，核只认识到版本 1。旧版本写回去会把新字段抹掉，请升级插件后再改。',
    }
  }
  if (version !== SETTINGS_KNOWN_VERSION) return { ok: false, reason: 'bad-shape', message: '要写入的本机设置里的 version 必须是 1' }
  const check = parseSettings(value)
  if (!check.ok) return { ok: false, reason: check.reason === 'unknown-keys' ? 'unknown-keys' : 'bad-shape', message: check.message, keys: check.keys }
  const v = (check as { ok: true; value: Record<string, unknown> }).value
  const ui = v['ui'] as Record<string, unknown>
  const workspaces = v['workspaces'] as Record<string, Record<string, unknown>>
  const debug = v['debug'] as Record<string, unknown>
  const templates = v['templates'] as Record<string, unknown>

  const lines = [...HEADER]
  lines.push('version: 1')
  lines.push(COMMENT_UI)
  lines.push('ui:')
  lines.push('  ' + COMMENT_STATE)
  lines.push('  stateFilter: ' + esc(String(ui['stateFilter'])))
  lines.push('  sortKey: ' + esc(String(ui['sortKey'])))
  lines.push('  sortDir: ' + esc(String(ui['sortDir'])))
  // labelClicks 不写出去（理由见上面 UI_KEYS 旁的注释）。老文件里那一节在下次写入时自然消失。
  lines.push(COMMENT_WORKSPACES)
  const wsKeys = Object.keys(workspaces)
  if (wsKeys.length === 0) {
    lines.push('workspaces: {}')
  } else {
    lines.push('workspaces:')
    for (const root of wsKeys) {
      const entry = workspaces[root] as Record<string, unknown>
      lines.push('  ' + esc(root) + ':')
      lines.push('    ' + COMMENT_BANNER)
      lines.push('    bannerFolded: ' + String(entry['bannerFolded']))
      lines.push('    ' + COMMENT_NOREPO)
      lines.push('    noRepoDismissed: ' + String(entry['noRepoDismissed']))
      lines.push('    ' + COMMENT_SUBWS)
      lines.push('    subwsMarkAutoShown: ' + String(entry['subwsMarkAutoShown']))
    }
  }
  lines.push(COMMENT_DEBUG)
  lines.push('debug:')
  lines.push('  enabled: ' + String(debug['enabled']))
  lines.push('  sampleRate: ' + String(debug['sampleRate']))
  lines.push(COMMENT_TEMPLATES)
  const tplKeys = Object.keys(templates)
  if (tplKeys.length === 0) {
    lines.push('templates: {}')
  } else {
    lines.push('templates:')
    for (const name of tplKeys) lines.push('  ' + esc(name) + ': ' + esc(String(templates[name])))
  }
  return { ok: true, text: lines.join('\n') + '\n' }
}
