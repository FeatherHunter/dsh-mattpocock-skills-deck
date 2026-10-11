// src/host/configStore.js —— 配置文件的宿主适配器：调核的唯一入口（#1012）
//
// 人话：三份配置文件（工作区后端配置、本机全局设置、标签配色数据）要读要写都走这里。
// 它只做核不会做的事：拼路径、读文件、写文件、写完读回来比对、写成功后删老文件。
// 解析、校验、拼文本全在核里（src/shared/config-store/），这里一行都不重写。
//
// 冻结接口（与 #1003 票里那份逐字一致；要改必须同时改两份）：
//   readWorkspaceConfig(root, io) / writeWorkspaceConfig(root, value, io)
//   readLocalSettings(homeDir, io) / writeLocalSettings(value, homeDir, io)
//   readLabelColors(root, io) / writeLabelColors(root, value, io)
// root 是工作区根的绝对路径，homeDir 是用户主目录的绝对路径，io 是文件读写口：
//   { readText(absPath), writeText(absPath, text), rm(absPath), mkdir(dirAbsPath) }
// 为什么 io 由调用方递进来：宿主在不同运行时拿文件通道的方式不一样（桌面端走平台文件服务），
// 适配器不自己决定去哪里拿，只认这个口子，测试时给假实现即可。
//
// 三条并发约定（#1012 票里定的，#1003 那边照着用）：
// 1. 新老并存时以新（.yaml）为准，老（.json）只做兼容读；读到老文件不自动写，
//    由调用方决定何时迁移（老用户迁移的顺序「先写成功、再退役记忆」在 #1003）。
// 2. 写成功后再删老文件；删除失败只放在回执的 warnings 里，不影响主流程。
// 3. 不新增日志事件：迁移遗留、新老并存这些事实经回执字段（from / legacyPresent /
//    warnings）带出来，由调用方用已有事件记。日志附录与日志门禁是单写者文件，本票不动。
//
// 以后谁改它：改三份文件的读写顺序、迁移时机、失败说法的人。核里的格式与校验归核，
// 判定「当前后端是谁」归 #1003 的判定服务，这里只管把文件读写对。
import {
  LABEL_COLORS_JSON_REL,
  LABEL_COLORS_YAML_REL,
  SETTINGS_REL_SEGMENTS,
  WORKSPACE_JSON_REL,
  WORKSPACE_YAML_REL,
  parseConfig,
  stringifyConfig,
} from '../shared/config-store/config-store.js'

// ── 路径（只拼字符串，不碰文件系统） ──

/** 工作区根 + 相对路径 → 读写口要的绝对路径。根末尾的斜杠先清掉，剩下的原样拼。 */
function joinRoot(root, rel) {
  return String(root || '').replace(/[\\/]+$/, '') + '/' + String(rel || '')
}

/** 用户主目录 → 本机设置文件的绝对路径。 */
function settingsPath(homeDir) {
  return String(homeDir || '').replace(/[\\/]+$/, '') + '/' + SETTINGS_REL_SEGMENTS.join('/')
}

/** 这次读到的上一级目录（写之前建它，免得目录不在写失败）。 */
function parentDir(absPath) {
  const s = String(absPath || '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i > 0 ? s.slice(0, i) : ''
}

// ── 错误分类 ──

/** 「文件确实不在」的判据：只有它才允许按「还没有这份文件」处理。
 * 判据故意定得窄（照标签配色房间同一套）：权限、被占用、位置被换成目录都不能证明文件不存在，
 * 照「没有」处理会用默认内容把用户手写的东西整份覆盖，那是真实的数据丢失。 */
function isMissingFile(e) {
  const code = String((e && (e.code || (e.cause && e.cause.code))) || '')
  if (code === 'ENOENT' || code === 'FS_NOT_FOUND') return true
  const msg = String((e && e.message) || e || '')
  return /ENOENT|FS_NOT_FOUND/i.test(msg) || /cannot read .*: not found/i.test(msg)
}

function needIo(io) {
  if (!io || typeof io.readText !== 'function' || typeof io.writeText !== 'function') {
    throw new Error('configStore：调用时要递文件读写口 io（至少有 readText 与 writeText），测试时给假实现即可')
  }
}

/** 回执里只放相对路径，不放绝对路径、不放令牌（日志纪律：工作区原始路径不记原文）。 */
function envFail(what, rel, detail) {
  return {
    ok: false,
    reason: 'env',
    message: what + '（' + rel + '）。' + detail,
  }
}

// ── 读写的公共骨架（新优先、老兼容） ──

/** 读一份文件：先读新的 .yaml，只有「确实不在」才读老 .json；新在但读坏了，老好的话照用并警告。 */
async function readWithFallback(io, yamlAbs, yamlRel, jsonAbs, jsonRel, schemaId, missingMessage) {
  let yamlText = null
  let yamlError = null
  try {
    yamlText = await io.readText(yamlAbs)
  } catch (e) {
    if (!isMissingFile(e)) yamlError = e
  }
  if (typeof yamlText === 'string') {
    const parsed = parseConfig(yamlText, schemaId)
    if (parsed.ok) {
      let legacyPresent = false
      try {
        await io.readText(jsonAbs)
        legacyPresent = true
      } catch (e) {
        legacyPresent = false
      }
      const warnings = [...(parsed.warnings || [])]
      if (legacyPresent) warnings.push('legacy-present：老文件（' + jsonRel + '）还在，以新文件（' + yamlRel + '）为准，它是迁移遗留')
      return { ok: true, value: parsed.value, from: 'yaml', readonly: parsed.readonly === true, legacyPresent, warnings }
    }
    // 新文件在但读坏了：看看老文件能不能救，不能才报错。
    if (yamlError === null) {
      try {
        const jsonText = await io.readText(jsonAbs)
        const fallback = parseConfig(jsonText, schemaId)
        if (fallback.ok) {
          return {
            ok: true,
            value: fallback.value,
            from: 'json',
            readonly: fallback.readonly === true,
            legacyPresent: false,
            warnings: ['yaml-unreadable：新文件（' + yamlRel + '）读不出来（' + parsed.message.slice(0, 80) + '），这次先用老文件（' + jsonRel + '）顶着，请检查新文件'],
          }
        }
      } catch (e2) {
        // 老文件也不在或也坏，下面按新文件的错回。
      }
      return { ok: false, reason: parsed.reason, message: parsed.message, from: 'yaml', warnings: [] }
    }
    return { ok: false, reason: parsed.reason, message: parsed.message, from: 'yaml', warnings: [] }
  }
  if (yamlError !== null) {
    return envFail('读这份文件这一步出错了', yamlRel, '可能是当前账号读不到它，也可能是它正被别的程序占用；插件分不出是哪一种。请检查后重试。错误原文：' + String((yamlError && yamlError.message) || yamlError).slice(0, 120))
  }
  // 新文件确实不在：读老文件。
  let jsonText = null
  try {
    jsonText = await io.readText(jsonAbs)
  } catch (e) {
    if (isMissingFile(e)) return { ok: false, reason: 'missing', message: missingMessage, from: 'none', warnings: [] }
    return envFail('读这份文件这一步出错了', jsonRel, '可能是当前账号读不到它，也可能是它正被别的程序占用。请检查后重试。错误原文：' + String((e && e.message) || e).slice(0, 120))
  }
  const parsed = parseConfig(jsonText, schemaId)
  if (!parsed.ok) return { ok: false, reason: parsed.reason, message: parsed.message, from: 'json', warnings: [] }
  return { ok: true, value: parsed.value, from: 'json', readonly: parsed.readonly === true, legacyPresent: false, warnings: [] }
}

/** 写一份文件：拼文本 → 建目录 → 写新文件 → 读回比对 → 顺手删老文件（删不掉只警告）。 */
async function writeWithCleanup(io, yamlAbs, yamlRel, jsonAbs, jsonRel, schemaId, value) {
  const made = stringifyConfig(value, schemaId)
  if (!made.ok) return { ok: false, reason: made.reason, message: made.message, keys: made.keys, warnings: [] }
  const text = made.text
  try {
    if (typeof io.mkdir === 'function') {
      try {
        await io.mkdir(parentDir(yamlAbs))
      } catch (eM) {
        // 建目录失败不单独报错，写文件那一步会给出真正的失败原因。
      }
    }
    await io.writeText(yamlAbs, text)
    const back = await io.readText(yamlAbs)
    if (String(back) !== text) {
      return envFail('保存失败：写完之后重新读这份文件，读到的内容与刚写进去的不一致', yamlRel, '因此不能确认已经保存。请打开这份文件核对内容，手动改成想保存的样子，然后重试。')
    }
  } catch (e) {
    return envFail('保存失败：写不进这份文件', yamlRel, '请检查它的上一级目录在不在、当前账号能不能写入，然后重试。错误原文：' + String((e && e.message) || e).slice(0, 120))
  }
  let legacyDeleted = false
  const warnings = []
  if (typeof io.rm === 'function') {
    try {
      await io.rm(jsonAbs)
      legacyDeleted = true
    } catch (e) {
      if (!isMissingFile(e)) {
        warnings.push('legacy-delete-failed：老文件（' + jsonRel + '）没能删掉，它还在，但已经没用了，可以手动删掉。错误原文：' + String((e && e.message) || e).slice(0, 80))
      } else {
        legacyDeleted = true
      }
    }
  }
  return { ok: true, from: 'yaml', legacyDeleted, warnings }
}

// ── 冻结接口（六个，与 #1003 票里那份逐字一致） ──

/**
 * 读工作区后端配置。新老并存时以新为准；只有老文件时照读（调用方决定何时迁移）；
 * 两个都没有时回 missing（界面说「这条工作区还没选后端，请选一次」）。
 */
export async function readWorkspaceConfig(root, io) {
  needIo(io)
  return readWithFallback(
    io,
    joinRoot(root, WORKSPACE_YAML_REL),
    WORKSPACE_YAML_REL,
    joinRoot(root, WORKSPACE_JSON_REL),
    WORKSPACE_JSON_REL,
    'workspace',
    '这条工作区还没选后端（工作区里的 ' + WORKSPACE_YAML_REL + ' 不在）。请去面板选一次后端。',
  )
}

/** 写工作区后端配置：只写新文件，写成功后顺手删老文件（删不掉只警告）。 */
export async function writeWorkspaceConfig(root, value, io) {
  needIo(io)
  return writeWithCleanup(
    io,
    joinRoot(root, WORKSPACE_YAML_REL),
    WORKSPACE_YAML_REL,
    joinRoot(root, WORKSPACE_JSON_REL),
    WORKSPACE_JSON_REL,
    'workspace',
    value,
  )
}

/** 读本机全局设置。文件不在就是 missing（调用方用默认值或引导，不算错）。 */
export async function readLocalSettings(homeDir, io) {
  needIo(io)
  const abs = settingsPath(homeDir)
  const rel = SETTINGS_REL_SEGMENTS.join('/')
  let text = null
  try {
    text = await io.readText(abs)
  } catch (e) {
    if (isMissingFile(e)) return { ok: false, reason: 'missing', message: '本机设置文件（' + rel + '）还没有，第一次保存时会自动建一份。', from: 'none', warnings: [] }
    return envFail('读这份文件这一步出错了', rel, '可能是当前账号读不到它，也可能是它正被别的程序占用。请检查后重试。错误原文：' + String((e && e.message) || e).slice(0, 120))
  }
  const parsed = parseConfig(text, 'settings')
  if (!parsed.ok) return { ok: false, reason: parsed.reason, message: parsed.message, from: 'yaml', warnings: [] }
  return { ok: true, value: parsed.value, from: 'yaml', readonly: parsed.readonly === true, legacyPresent: false, warnings: [...(parsed.warnings || [])] }
}

/** 写本机全局设置（整份覆盖，原子性由调用方的读写口保证：一次调用写完整份内容）。 */
export async function writeLocalSettings(value, homeDir, io) {
  needIo(io)
  const abs = settingsPath(homeDir)
  const rel = SETTINGS_REL_SEGMENTS.join('/')
  const made = stringifyConfig(value, 'settings')
  if (!made.ok) return { ok: false, reason: made.reason, message: made.message, keys: made.keys, warnings: [] }
  try {
    if (typeof io.mkdir === 'function') {
      try {
        await io.mkdir(parentDir(abs))
      } catch (eM) {
        // 建目录失败不单独报错，写文件那一步会给出真正的失败原因。
      }
    }
    await io.writeText(abs, made.text)
    const back = await io.readText(abs)
    if (String(back) !== made.text) {
      return envFail('保存失败：写完之后重新读这份文件，读到的内容与刚写进去的不一致', rel, '因此不能确认已经保存。请打开这份文件核对内容，然后重试。')
    }
  } catch (e) {
    return envFail('保存失败：写不进这份文件', rel, '请检查它的上一级目录在不在、当前账号能不能写入，然后重试。错误原文：' + String((e && e.message) || e).slice(0, 120))
  }
  return { ok: true, from: 'yaml', legacyDeleted: true, warnings: [] }
}

/** 读标签配色数据。新老并存时以新为准；只有老文件时照读；都没有时回 missing（调用方放置默认）。 */
export async function readLabelColors(root, io) {
  needIo(io)
  return readWithFallback(
    io,
    joinRoot(root, LABEL_COLORS_YAML_REL),
    LABEL_COLORS_YAML_REL,
    joinRoot(root, LABEL_COLORS_JSON_REL),
    LABEL_COLORS_JSON_REL,
    'label-colors',
    '工作区里的标签配色文件（' + LABEL_COLORS_YAML_REL + '）还没有，第一次打开改色弹窗时会自动按默认颜色建一份。',
  )
}

/** 写标签配色数据：只写新文件，写成功后顺手删老文件（删不掉只警告）。版本号固定写 1。 */
export async function writeLabelColors(root, value, io) {
  needIo(io)
  return writeWithCleanup(
    io,
    joinRoot(root, LABEL_COLORS_YAML_REL),
    LABEL_COLORS_YAML_REL,
    joinRoot(root, LABEL_COLORS_JSON_REL),
    LABEL_COLORS_JSON_REL,
    'label-colors',
    value,
  )
}

export default { readWorkspaceConfig, writeWorkspaceConfig, readLocalSettings, writeLocalSettings, readLabelColors, writeLabelColors }
