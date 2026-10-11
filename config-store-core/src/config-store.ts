/**
 * config-store-core/src/config-store.ts —— 三份配置文件的解析、校验与拼装（#1012）
 *
 * 只放纯函数：不碰文件系统、不碰注册表、不碰平台。跑腿的活（读文件、写文件、
 * 删老文件、拼路径、拿用户主目录）全在外面的宿主适配器（src/host/configStore.js）。
 *
 * 三份文件共用同一套规矩：
 * 1. 读：YAML 解析（老的 `.json` 是 YAML 的子集，直接可读）→ 白名单键 → 精确类型
 *    → 版本判定。任何一步不对都按档位回，不抛错、不崩。
 * 2. 写：模板 + 值。注释文字与字段定义在同一处常量，永远同步；手写的注释不保留，
 *    文件头第一句就把这条说明白。
 * 3. 版本高于认识时只读不写：读回来的值照给（界面能展示），但标 readonly，
 *    写回去时明确拒绝，旧版本不许把新字段抹掉。
 * 4. 两条硬限制：文件字符数上限与别名数量上限（文件允许提交、可能来自别人，
 *    防别名炸弹）。超了直接拒，不解析。
 *
 * YAML 隐式类型是个坑（`no`/`on`/`yes` 读成布尔、`1.10` 读成数字、前导零读成八进制），
 * 这里的解法是事后精确类型判定：字段要什么类型，解析出来就必须是什么类型，
 * 对不上的一律按「不认识的形状」回。解析库用 `yaml` 包并钉死 `core` 模式
 *（YAML 1.2 核心规则），行为由门禁钉住。
 */

import { parse as parseYaml } from 'yaml'
import type {
  ConfigParseResult,
  ConfigStringifyResult,
  SchemaId,
} from './ports.js'

/** 文件字符数上限：配置文件本该很小，64K 绰绰有余，超了说明拿错了文件。 */
export const MAX_FILE_BYTES = 65536

/** 别名（`*名字`）数量上限：正常配置文件里一个别名都不会有，50 是宽松的哨兵。 */
export const MAX_ALIASES = 50

/** 工作区后端配置的新路径（YAML）与老路径（JSON，只做兼容读）。 */
export const WORKSPACE_YAML_REL = 'docs/agents/workspace.yaml'
export const WORKSPACE_JSON_REL = 'docs/agents/workspace.json'
/** 工作区后端配置：核认识的版本就是 2（老 JSON 是版本 1，读进来做迁移）。 */
export const WORKSPACE_KNOWN_VERSION = 2

/** 标签配色数据的新路径（YAML）与老路径（JSON，只做兼容读）。 */
export const LABEL_COLORS_YAML_REL = 'docs/agents/label-colors.yaml'
export const LABEL_COLORS_JSON_REL = 'docs/agents/label-colors.json'
/** 标签配色数据：核认识的版本就是 1（老文件没有版本，当 1 读）。 */
export const LABEL_COLORS_KNOWN_VERSION = 1

/** 本机全局设置在用户主目录下的相对位置（调用方拼绝对路径，核里不碰主目录）。 */
export const SETTINGS_REL_SEGMENTS = ['.dsh', 'mattskillsdeck', 'settings.yaml']
/** 本机全局设置：核认识的版本就是 1。 */
export const SETTINGS_KNOWN_VERSION = 1

// ── 注释原文（程序要写进去的那些，与 #1012 票里定案的骨架逐字一致） ──
// 改这里的任何一个字，门禁 tests/verify-config-store-comments.js 都会红。

const WORKSPACE_HEADER = [
  '# 本文件的注释由插件生成；你自己加的注释会在下次写入时被替换。',
  '# 这份文件随仓库走：提交之后就团队共享，改动会影响所有人。',
]
const WORKSPACE_COMMENT_BACKEND = '# 这条工作区用哪个后端'
const WORKSPACE_COMMENT_PICKED = '# 这次选择发生的时间（毫秒）'
const WORKSPACE_COMMENT_SOURCE =
  '# 这条选择是谁做的：user=人在面板里亲手选的；migrated=从老版本机记忆搬来的；detected=插件按声明文件或自动识别生成的'
const WORKSPACE_COMMENT_LAYOUT = '# 面板布局：single=单栏；multi=多栏'

const SETTINGS_HEADER = ['# 本文件的注释由插件生成；你自己加的注释会在下次写入时被替换。']
const SETTINGS_COMMENT_UI = '# 界面偏好（本机全工作区默认生效）'
const SETTINGS_COMMENT_STATE = '# 主列表的状态过滤与排序'
const SETTINGS_COMMENT_CLICKS = '# 标签被点过的次数，用于标签 chip 排序'
const SETTINGS_COMMENT_WORKSPACES = '# 按工作区区分的观看状态（键 = 工作区根目录）'
const SETTINGS_COMMENT_BANNER = '# 状态栏横幅与胶囊是否收起'
const SETTINGS_COMMENT_NOREPO = '# 无仓库红卡是否已收起'
const SETTINGS_COMMENT_SUBWS = '# 红文件夹标志的说明浮层是否已自动展开过'
const SETTINGS_COMMENT_DEBUG = '# 本地诊断日志开关'
const SETTINGS_COMMENT_TEMPLATES = '# 动作模板（空 = 用默认文本）'

const LABELS_HEADER = ['# 本文件的注释由插件生成；你自己加的注释会在下次写入时被替换。']
const LABELS_COMMENT_VERSION = '# 这一份数据的版本号（核不认识的新版本只读不写）'

// ── 小工具（纯函数，无外部依赖） ──

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

function failParse(
  reason: 'oversize' | 'aliases' | 'yaml-error' | 'bad-shape' | 'unknown-keys',
  message: string,
  keys?: string[],
): ConfigParseResult {
  return keys ? { ok: false, reason, message, keys } : { ok: false, reason, message }
}

/** 写 YAML 纯量：能裸写才裸写，拿不准的一律双引号，这是只写不错的保守方向。 */
function escScalar(text: string): string {
  if (text === '') return "''"
  const lower = text.toLowerCase()
  const looksSpecial =
    lower === '' ||
    lower === '~' ||
    lower === 'null' ||
    lower === 'true' ||
    lower === 'false' ||
    lower === 'yes' ||
    lower === 'no' ||
    lower === 'y' ||
    lower === 'n' ||
    lower === 'on' ||
    lower === 'off'
  const bareOk =
    !looksSpecial &&
    /^[A-Za-z_][A-Za-z0-9_\-]*$/.test(text) &&
    !/^[0-9]/.test(text)
  if (bareOk) return text
  return (
    '"' +
    text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, (c) => {
        const n = c.charCodeAt(0).toString(16)
        return '\\u' + ('0000' + n).slice(-4)
      }) +
    '"'
  )
}

function escKey(key: string): string {
  return escScalar(key)
}

/** 数一数文本里用了多少个别名（`*名字`）。注释里的不算，先去掉行注释。 */
function countAliases(text: string): number {
  const noComments = text.replace(/(^|\s)#[^\n]*$/gm, '$1')
  const hits = noComments.match(/(^|[\s\[{,])\*[A-Za-z0-9_-]+/g)
  return hits ? hits.length : 0
}

// ── 工作区后端配置 ──

const WORKSPACE_SOURCES_V2 = ['user', 'migrated', 'detected']
const WORKSPACE_SOURCES_V1 = ['user', 'migrated', 'detected', 'auto']
const WORKSPACE_LAYOUTS = ['single', 'multi']

function parseWorkspace(doc: unknown): ConfigParseResult {
  if (!isRecord(doc)) return failParse('bad-shape', '工作区配置文件里放的不是一组「名字 → 值」，读到的是清单或一段文字')
  const seen = Object.keys(doc)
  const knownV1 = ['version', 'backendId', 'pickedAt', 'source', 'layout']
  const strange = seen.filter((k) => knownV1.indexOf(k) < 0)
  if (strange.length > 0) {
    return failParse('unknown-keys', '工作区配置文件里有多出来的名字，核不认识它们：' + strange.join('、'), strange)
  }
  if (!isInt(doc['version'])) return failParse('bad-shape', '工作区配置文件里的 version 必须是数字')
  const version = doc['version'] as number
  if (version > WORKSPACE_KNOWN_VERSION) {
    return {
      ok: true,
      value: doc,
      readonly: true,
      warnings: ['version-newer：这份文件是版本 ' + version + '，核只认识到版本 2，可以读来展示，不许写回去（写回去会把新字段抹掉）。请升级插件。'],
    }
  }
  if (version !== 1 && version !== 2) return failParse('bad-shape', '工作区配置文件里的 version 现在只认 1（老 JSON 迁移用）与 2')
  if (typeof doc['backendId'] !== 'string' || doc['backendId'].trim() === '') {
    return failParse('bad-shape', '工作区配置文件里的 backendId 必须是一段非空文字（YAML 会把没加引号的 no/on/yes 读成真假值、把 1.10 读成数字，那种一律按坏形状回）')
  }
  if (!isInt(doc['pickedAt']) || (doc['pickedAt'] as number) < 0) {
    return failParse('bad-shape', '工作区配置文件里的 pickedAt 必须是选择发生的时间（毫秒，非负整数）')
  }
  const allowedSources = version === 2 ? WORKSPACE_SOURCES_V2 : WORKSPACE_SOURCES_V1
  if (typeof doc['source'] !== 'string' || allowedSources.indexOf(doc['source']) < 0) {
    return failParse(
      'bad-shape',
      version === 2
        ? '工作区配置文件里的 source 必须是 user（人亲手选的）、migrated（从老版本记忆搬来的）、detected（插件按声明或自动识别生成的）三者之一'
        : '工作区配置文件里的 source 必须是 user、migrated、detected、auto 四者之一',
    )
  }
  if (version === 2) {
    if (typeof doc['layout'] !== 'string' || WORKSPACE_LAYOUTS.indexOf(doc['layout']) < 0) {
      return failParse('bad-shape', '工作区配置文件里的 layout 必须是 single（单栏）或 multi（多栏）')
    }
  } else if (doc['layout'] !== undefined) {
    if (typeof doc['layout'] !== 'string' || WORKSPACE_LAYOUTS.indexOf(doc['layout']) < 0) {
      return failParse('bad-shape', '工作区配置文件里的 layout 必须是 single（单栏）或 multi（多栏）')
    }
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

function stringifyWorkspace(value: unknown): ConfigStringifyResult {
  if (!isRecord(value)) return { ok: false, reason: 'bad-shape', message: '要写入的工作区配置不是一组「名字 → 值」' }
  const seen = Object.keys(value)
  const strange = seen.filter((k) => ['version', 'backendId', 'pickedAt', 'source', 'layout'].indexOf(k) < 0)
  if (strange.length > 0) {
    return { ok: false, reason: 'unknown-keys', message: '要写入的工作区配置里有多出来的名字，核不会把它们写进去：' + strange.join('、'), keys: strange }
  }
  if (!isInt(value['version'])) return { ok: false, reason: 'bad-shape', message: '要写入的工作区配置里的 version 必须是数字 2' }
  const version = value['version'] as number
  if (version > WORKSPACE_KNOWN_VERSION) {
    return {
      ok: false,
      reason: 'version-newer',
      message: '拒绝写入：这份工作区配置是版本 ' + version + '，核只认识到版本 2。旧版本写回去会把新字段抹掉，请升级插件后再改。',
    }
  }
  if (version !== WORKSPACE_KNOWN_VERSION) return { ok: false, reason: 'bad-shape', message: '要写入的工作区配置里的 version 必须是 2（老版本 1 只用来读，不用来写）' }
  const check = parseWorkspace({
    version: value['version'],
    backendId: value['backendId'],
    pickedAt: value['pickedAt'],
    source: value['source'],
    layout: value['layout'],
  })
  if (!check.ok) return { ok: false, reason: check.reason === 'unknown-keys' ? 'unknown-keys' : 'bad-shape', message: check.message, keys: check.keys }
  const v = (check as { ok: true; value: Record<string, unknown> }).value
  const lines = [...WORKSPACE_HEADER]
  lines.push('version: ' + String(v['version']))
  lines.push(WORKSPACE_COMMENT_BACKEND)
  lines.push('backendId: ' + escScalar(String(v['backendId'])))
  lines.push(WORKSPACE_COMMENT_PICKED)
  lines.push('pickedAt: ' + String(v['pickedAt']))
  lines.push(WORKSPACE_COMMENT_SOURCE)
  lines.push('source: ' + escScalar(String(v['source'])))
  lines.push(WORKSPACE_COMMENT_LAYOUT)
  lines.push('layout: ' + escScalar(String(v['layout'])))
  return { ok: true, text: lines.join('\n') + '\n' }
}

// ── 本机全局设置 ──

const SETTINGS_WS_KEYS = ['bannerFolded', 'noRepoDismissed', 'subwsMarkAutoShown']

function parseSettings(doc: unknown): ConfigParseResult {
  if (!isRecord(doc)) return failParse('bad-shape', '本机设置文件里放的不是一组「名字 → 值」，读到的是清单或一段文字')
  const strange = Object.keys(doc).filter((k) => ['version', 'ui', 'workspaces', 'debug', 'templates'].indexOf(k) < 0)
  if (strange.length > 0) {
    return failParse('unknown-keys', '本机设置文件里有多出来的名字，核不认识它们：' + strange.join('、'), strange)
  }
  if (!isInt(doc['version'])) return failParse('bad-shape', '本机设置文件里的 version 必须是数字')
  const version = doc['version'] as number
  if (version > SETTINGS_KNOWN_VERSION) {
    return {
      ok: true,
      value: doc,
      readonly: true,
      warnings: ['version-newer：这份文件是版本 ' + version + '，核只认识到版本 1，可以读来展示，不许写回去。请升级插件。'],
    }
  }
  if (version !== SETTINGS_KNOWN_VERSION) return failParse('bad-shape', '本机设置文件里的 version 现在只认 1')

  // ui 节：缺了就给空默认，写回去时自然补全。
  const uiRaw = doc['ui'] === undefined ? {} : doc['ui']
  if (!isRecord(uiRaw)) return failParse('bad-shape', '本机设置文件里的 ui 必须是一组「名字 → 值」')
  const uiStrange = Object.keys(uiRaw).filter((k) => ['stateFilter', 'sortKey', 'sortDir', 'labelClicks'].indexOf(k) < 0)
  if (uiStrange.length > 0) {
    return failParse('unknown-keys', '本机设置文件 ui 节里有多出来的名字：' + uiStrange.join('、'), uiStrange)
  }
  for (const k of ['stateFilter', 'sortKey', 'sortDir']) {
    if (uiRaw[k] !== undefined && typeof uiRaw[k] !== 'string') {
      return failParse('bad-shape', '本机设置文件 ui 节里的 ' + k + ' 必须是一段文字')
    }
  }
  const clicksRaw = uiRaw['labelClicks'] === undefined ? {} : uiRaw['labelClicks']
  if (!isRecord(clicksRaw)) return failParse('bad-shape', '本机设置文件 ui 节里的 labelClicks 必须是一组「标签 → 次数」')
  const clicks: Record<string, unknown> = {}
  for (const name of Object.keys(clicksRaw)) {
    if (isDangerousKey(name)) return failParse('bad-shape', '本机设置文件 labelClicks 里不能用这个名字：' + name)
    const n = clicksRaw[name]
    if (!isFiniteNumber(n) || (n as number) < 0) {
      return failParse('bad-shape', '本机设置文件 labelClicks 里「' + name + '」的次数必须是非负数字')
    }
    clicks[name] = n
  }

  // workspaces 节：键是工作区根的可读路径（动态，多少条都行），值里只认三个开关。
  const wsRaw = doc['workspaces'] === undefined ? {} : doc['workspaces']
  if (!isRecord(wsRaw)) return failParse('bad-shape', '本机设置文件里的 workspaces 必须是一组「工作区根 → 开关」')
  const workspaces: Record<string, unknown> = {}
  for (const root of Object.keys(wsRaw)) {
    if (root.trim() === '') return failParse('bad-shape', '本机设置文件 workspaces 节里有一条的键是空的（键必须是工作区根目录）')
    if (isDangerousKey(root)) return failParse('bad-shape', '本机设置文件 workspaces 节里不能用这个名字：' + root)
    const entry = wsRaw[root]
    if (!isRecord(entry)) return failParse('bad-shape', '本机设置文件 workspaces 节里「' + root + '」的值必须是一组开关')
    const entryStrange = Object.keys(entry).filter((k) => SETTINGS_WS_KEYS.indexOf(k) < 0)
    if (entryStrange.length > 0) {
      return failParse('unknown-keys', '本机设置文件 workspaces 节里「' + root + '」有多出来的名字：' + entryStrange.join('、'), entryStrange)
    }
    const norm: Record<string, unknown> = { bannerFolded: false, noRepoDismissed: false, subwsMarkAutoShown: false }
    for (const k of SETTINGS_WS_KEYS) {
      if (entry[k] === undefined) continue
      if (typeof entry[k] !== 'boolean') {
        return failParse('bad-shape', '本机设置文件 workspaces 节里「' + root + '」的 ' + k + ' 必须是真假值（YAML 会把没加引号的 yes/no/on 读成文字，那种一律按坏形状回）')
      }
      norm[k] = entry[k]
    }
    workspaces[root] = norm
  }

  // debug 节：缺了就给默认（关）。
  const debugRaw = doc['debug'] === undefined ? {} : doc['debug']
  if (!isRecord(debugRaw)) return failParse('bad-shape', '本机设置文件里的 debug 必须是一组「名字 → 值」')
  const debugStrange = Object.keys(debugRaw).filter((k) => ['enabled', 'sampleRate'].indexOf(k) < 0)
  if (debugStrange.length > 0) {
    return failParse('unknown-keys', '本机设置文件 debug 节里有多出来的名字：' + debugStrange.join('、'), debugStrange)
  }
  const enabled = debugRaw['enabled'] === undefined ? false : debugRaw['enabled']
  if (typeof enabled !== 'boolean') return failParse('bad-shape', '本机设置文件 debug 节里的 enabled 必须是真假值')
  const sampleRate = debugRaw['sampleRate'] === undefined ? 1 : debugRaw['sampleRate']
  if (!isFiniteNumber(sampleRate) || (sampleRate as number) < 0 || (sampleRate as number) > 1) {
    return failParse('bad-shape', '本机设置文件 debug 节里的 sampleRate 必须是 0 到 1 之间的数字')
  }

  // templates 节：键是动作名（动态），值是模板文本（空表示用默认文本）。
  const tplRaw = doc['templates'] === undefined ? {} : doc['templates']
  if (!isRecord(tplRaw)) return failParse('bad-shape', '本机设置文件里的 templates 必须是一组「动作 → 文本」')
  const templates: Record<string, unknown> = {}
  for (const name of Object.keys(tplRaw)) {
    if (isDangerousKey(name)) return failParse('bad-shape', '本机设置文件 templates 里不能用这个名字：' + name)
    if (typeof tplRaw[name] !== 'string') {
      return failParse('bad-shape', '本机设置文件 templates 里「' + name + '」的值必须是一段文字')
    }
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

function stringifySettings(value: unknown): ConfigStringifyResult {
  if (!isRecord(value)) return { ok: false, reason: 'bad-shape', message: '要写入的本机设置不是一组「名字 → 值」' }
  const strange = Object.keys(value).filter((k) => ['version', 'ui', 'workspaces', 'debug', 'templates'].indexOf(k) < 0)
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
  // 先按读的同一套规矩校验并补默认，写出来的永远是完整模板。
  const check = parseSettings(value)
  if (!check.ok) return { ok: false, reason: check.reason === 'unknown-keys' ? 'unknown-keys' : 'bad-shape', message: check.message, keys: check.keys }
  const v = (check as { ok: true; value: Record<string, unknown> }).value
  const ui = v['ui'] as Record<string, unknown>
  const workspaces = v['workspaces'] as Record<string, Record<string, unknown>>
  const debug = v['debug'] as Record<string, unknown>
  const templates = v['templates'] as Record<string, unknown>

  const lines = [...SETTINGS_HEADER]
  lines.push('version: 1')
  lines.push(SETTINGS_COMMENT_UI)
  lines.push('ui:')
  lines.push('  ' + SETTINGS_COMMENT_STATE)
  lines.push('  stateFilter: ' + escScalar(String(ui['stateFilter'])))
  lines.push('  sortKey: ' + escScalar(String(ui['sortKey'])))
  lines.push('  sortDir: ' + escScalar(String(ui['sortDir'])))
  lines.push('  ' + SETTINGS_COMMENT_CLICKS)
  const clickKeys = Object.keys(ui['labelClicks'] as Record<string, unknown>)
  if (clickKeys.length === 0) {
    lines.push('  labelClicks: {}')
  } else {
    lines.push('  labelClicks:')
    for (const name of clickKeys) {
      lines.push('    ' + escKey(name) + ': ' + String((ui['labelClicks'] as Record<string, unknown>)[name]))
    }
  }
  lines.push(SETTINGS_COMMENT_WORKSPACES)
  const wsKeys = Object.keys(workspaces)
  if (wsKeys.length === 0) {
    lines.push('workspaces: {}')
  } else {
    lines.push('workspaces:')
    for (const root of wsKeys) {
      const entry = workspaces[root] as Record<string, unknown>
      lines.push('  ' + escKey(root) + ':')
      lines.push('    ' + SETTINGS_COMMENT_BANNER)
      lines.push('    bannerFolded: ' + String(entry['bannerFolded']))
      lines.push('    ' + SETTINGS_COMMENT_NOREPO)
      lines.push('    noRepoDismissed: ' + String(entry['noRepoDismissed']))
      lines.push('    ' + SETTINGS_COMMENT_SUBWS)
      lines.push('    subwsMarkAutoShown: ' + String(entry['subwsMarkAutoShown']))
    }
  }
  lines.push(SETTINGS_COMMENT_DEBUG)
  lines.push('debug:')
  lines.push('  enabled: ' + String(debug['enabled']))
  lines.push('  sampleRate: ' + String(debug['sampleRate']))
  lines.push(SETTINGS_COMMENT_TEMPLATES)
  const tplKeys = Object.keys(templates)
  if (tplKeys.length === 0) {
    lines.push('templates: {}')
  } else {
    lines.push('templates:')
    for (const name of tplKeys) {
      lines.push('  ' + escKey(name) + ': ' + escScalar(String(templates[name])))
    }
  }
  return { ok: true, text: lines.join('\n') + '\n' }
}

// ── 标签配色数据（键是标签名，动态；值是颜色或颜色加一句说明） ──

function parseLabelColors(doc: unknown): ConfigParseResult {
  if (!isRecord(doc)) return failParse('bad-shape', '标签配色文件里放的不是一组「标签 → 颜色」，读到的是清单或一段文字')
  let version = 1
  if (doc['version'] !== undefined) {
    if (!isInt(doc['version'])) return failParse('bad-shape', '标签配色文件里的 version 必须是数字')
    version = doc['version'] as number
    if (version > LABEL_COLORS_KNOWN_VERSION) {
      return {
        ok: true,
        value: doc,
        readonly: true,
        warnings: ['version-newer：这份文件是版本 ' + version + '，核只认识到版本 1，可以读来展示，不许写回去。请升级插件。'],
      }
    }
    if (version < 1) return failParse('bad-shape', '标签配色文件里的 version 现在只认 1（没有版本的老文件照读）')
  }
  const colors: Record<string, unknown> = {}
  for (const name of Object.keys(doc)) {
    if (name === 'version') continue
    if (name.trim() === '') return failParse('bad-shape', '标签配色文件里有一个标签名是空的')
    if (isDangerousKey(name)) return failParse('bad-shape', '标签配色文件里不能用这个标签名：' + name)
    const entry = doc[name]
    if (typeof entry === 'string') {
      colors[name] = entry
      continue
    }
    if (isRecord(entry)) {
      const entryStrange = Object.keys(entry).filter((k) => ['color', 'description'].indexOf(k) < 0)
      if (entryStrange.length > 0) {
        return failParse('unknown-keys', '标签配色文件里标签「' + name + '」有多出来的名字：' + entryStrange.join('、'), entryStrange)
      }
      if (typeof entry['color'] !== 'string') {
        return failParse('bad-shape', '标签配色文件里标签「' + name + '」的 color 必须是一段文字（颜色，不带井号的六位）')
      }
      if (entry['description'] !== undefined && typeof entry['description'] !== 'string') {
        return failParse('bad-shape', '标签配色文件里标签「' + name + '」的 description 必须是一段文字')
      }
      const norm: Record<string, unknown> = { color: entry['color'] }
      if (entry['description'] !== undefined) norm['description'] = entry['description']
      colors[name] = norm
      continue
    }
    return failParse(
      'bad-shape',
      '标签「' + name + '」的颜色写法不对，这个位置只能写两种样子：直接写颜色，例如 "8b5cf6"；或者写成 {"color": "8b5cf6", "description": "地图票"}',
    )
  }
  return { ok: true, value: { version, colors }, readonly: false, warnings: [] }
}

function stringifyLabelColors(value: unknown): ConfigStringifyResult {
  if (!isRecord(value)) return { ok: false, reason: 'bad-shape', message: '要写入的标签配色不是一组「标签 → 颜色」' }
  // 写入口收两种形状：直给标签表，或 {version, colors} 包裹。两种都认，写出来永远是完整模板。
  const table: unknown = value['colors'] !== undefined && value['version'] !== undefined ? value['colors'] : value
  const versionRaw = value['version'] === undefined ? 1 : value['version']
  if (!isInt(versionRaw)) return { ok: false, reason: 'bad-shape', message: '要写入的标签配色里的 version 必须是数字 1' }
  const version = versionRaw as number
  if (version > LABEL_COLORS_KNOWN_VERSION) {
    return {
      ok: false,
      reason: 'version-newer',
      message: '拒绝写入：这份标签配色是版本 ' + version + '，核只认识到版本 1。旧版本写回去会把新字段抹掉，请升级插件后再改。',
    }
  }
  if (version !== LABEL_COLORS_KNOWN_VERSION) return { ok: false, reason: 'bad-shape', message: '要写入的标签配色里的 version 必须是 1' }
  const probe: Record<string, unknown> = { version }
  if (!isRecord(table)) return { ok: false, reason: 'bad-shape', message: '要写入的标签配色里的 colors 必须是一组「标签 → 颜色」' }
  for (const k of Object.keys(table)) probe[k] = (table as Record<string, unknown>)[k]
  const check = parseLabelColors(probe)
  if (!check.ok) return { ok: false, reason: check.reason === 'unknown-keys' ? 'unknown-keys' : 'bad-shape', message: check.message, keys: check.keys }
  const colors = ((check as { ok: true; value: Record<string, unknown> }).value['colors'] || {}) as Record<string, unknown>
  const lines = [...LABELS_HEADER]
  lines.push(LABELS_COMMENT_VERSION)
  lines.push('version: 1')
  for (const name of Object.keys(colors)) {
    const entry = colors[name]
    if (typeof entry === 'string') {
      lines.push(escKey(name) + ': ' + escScalar(entry))
    } else {
      const rec = entry as Record<string, unknown>
      const inner =
        '{"color": ' + escScalar(String(rec['color'])) +
        (rec['description'] === undefined ? '' : ', "description": ' + escScalar(String(rec['description']))) +
        '}'
      lines.push(escKey(name) + ': ' + inner)
    }
  }
  return { ok: true, text: lines.join('\n') + '\n' }
}

// ── 对外入口 ──

/**
 * 解析一份配置文本。schemaId 三选一：workspace（工作区后端配置）、
 * settings（本机全局设置）、label-colors（标签配色数据）。
 * 老的 `.json` 是 YAML 的子集，直接可读，不用区分。
 */
export function parseConfig(text: unknown, schemaId: SchemaId): ConfigParseResult {
  if (typeof text !== 'string') return failParse('bad-shape', '要解析的不是一段文字')
  const stripped = text.replace(/^\uFEFF/, '')
  if (stripped.length > MAX_FILE_BYTES) {
    return failParse(
      'oversize',
      '这份文件太大了（' + stripped.length + ' 字，上限 ' + MAX_FILE_BYTES + ' 字），核拒绝解析：配置文件本该很小，超了说明拿错了文件',
    )
  }
  if (countAliases(stripped) > MAX_ALIASES) {
    return failParse(
      'aliases',
      '这份文件里的别名（`*名字`）太多了（上限 ' + MAX_ALIASES + ' 个），核拒绝解析：正常配置文件里一个别名都不会有',
    )
  }
  let doc: unknown = null
  try {
    doc = parseYaml(stripped, { schema: 'core', maxAliasCount: MAX_ALIASES })
  } catch (e) {
    // 解析库自己的别名熔断也落到同一档，口径统一。
    const msg = String((e && (e as Error).message) || e || '')
    if (/alias/i.test(msg)) {
      return failParse('aliases', '这份文件里的别名太多了，核拒绝解析：正常配置文件里一个别名都不会有')
    }
    return failParse('yaml-error', '这份文件的内容不是合法的 YAML（也就是老的 JSON 也不是）：' + msg.slice(0, 160))
  }
  if (doc === undefined || doc === null || (typeof doc === 'string' && doc.trim() === '')) {
    return failParse('bad-shape', '这份文件里什么都没有（空白文件）')
  }
  if (schemaId === 'workspace') return parseWorkspace(doc)
  if (schemaId === 'settings') return parseSettings(doc)
  return parseLabelColors(doc)
}

/**
 * 把一份值拼成要落盘的文本（含程序生成的注释）。字段定义、类型、注释文字、
 * 键顺序都在上面的 schema 一处，改一处就全同步。
 */
export function stringifyConfig(value: unknown, schemaId: SchemaId): ConfigStringifyResult {
  if (schemaId === 'workspace') return stringifyWorkspace(value)
  if (schemaId === 'settings') return stringifySettings(value)
  return stringifyLabelColors(value)
}
