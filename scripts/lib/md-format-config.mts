// md-format-config.mts —— Markdown 后端格式映射的共享读取核（#1480 T1 立）。
//
// 真源是 src/tracker/rooms/markdown/format/original-skills.yaml：它把随包原文
// （package/bundled-skills/ 下的 Matt 技能模板，pin 见 tests/bundled-skills-upstream-hashes.json）
// 与本插件写出的文件形态对应起来。scripts/generate-md-format-config.mts 用它生成代码常量；
// tests/verify-md-format-config.ts 用它做原文锚点核对与坏数据演练。两边共用这里的
// validateMdFormatConfig / renderMdFormatData，避免生成器与门禁各写一套判据。
//
// 为什么是「YAML → 生成 .ts」而不是运行时读 YAML：与 #1215 时间参数、#1292 提示词、#1294 界面词表
// 同一条纪律——客户端与宿主都不在运行时读配置文件，两边吃的是同一份构建期快照；YAML 只有一份真源，
// 生成物不入库，改了 YAML 忘跑生成器时由门禁判红（见 docs/adr/20261021-config-ownership.md）。
//
// 校验的原则：错的地方要指到「哪一项、为什么错」，不静默忽略；未知键一律报错（多半是拼错）。

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'yaml'

/** 映射真源（仓库相对路径）。 */
export const MD_FORMAT_REL: string = 'src/tracker/rooms/markdown/format/original-skills.yaml'
/** 生成物（仓库相对路径）：构建期现场生成、不入库，内容见 renderMdFormatData。 */
export const MD_FORMAT_OUT_REL: string = 'src/tracker/rooms/markdown/format/generated.ts'
/** 上游哈希清单（仓库相对路径）：pin 与每个随包文件的哈希。 */
export const UPSTREAM_HASH_REL: string = 'tests/bundled-skills-upstream-hashes.json'

/** 映射文档允许的顶层键：多一个说明写错了位置，少一个由下面的逐项校验报出。 */
const TOP_LEVEL_KEYS: string[] = [
  'version', 'upstream', 'sources', 'layout', 'objects', 'status',
  'hidden-comments', 'reading', 'enhancements', 'upgrade',
]

/** 对象的 kind 只能是契约里的三种对象类型之一，外加规格/地图的容器位置。 */
const ALLOWED_KINDS: string[] = ['spec', 'map', 'spec-ticket', 'map-ticket', 'issue']

/** 每张票的对象 key：顺序固定，供渲染与消费方按名取值。 */
const OBJECT_KEYS: string[] = ['spec', 'map', 'implementation-ticket', 'wayfinder-child', 'plain-issue']

function fail(problems: string[], message: string): void {
  problems.push(message)
}

function isObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

function checkStringArray(problems: string[], where: string, v: unknown, allowEmpty: boolean = false): void {
  if (!Array.isArray(v) || (!allowEmpty && v.length === 0) || !v.every((x: unknown) => isNonEmptyString(x))) {
    fail(problems, where + ' 必须是非空字符串数组，读到的是 ' + JSON.stringify(v))
  }
}

function checkUnknownKeys(problems: string[], where: string, obj: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) fail(problems, where + ' 里有未知键「' + key + '」；允许的是：' + allowed.join(' / '))
  }
}

/** 校验一份已经解析好的映射文档；返回问题清单，空数组表示通过。纯函数，门禁用它演练坏数据。 */
export function validateMdFormatConfig(doc: unknown): string[] {
  const problems: string[] = []
  if (!isObject(doc)) {
    return ['映射文档顶层必须是一个对象']
  }
  const cfg: Record<string, any> = doc as Record<string, any>
  checkUnknownKeys(problems, '顶层', cfg, TOP_LEVEL_KEYS)
  if (cfg.version !== 1) fail(problems, 'version 必须是 1，读到的是 ' + JSON.stringify(cfg.version))

  // ---- upstream：原文来自哪、钉在哪一版 ----
  if (!isObject(cfg.upstream)) {
    fail(problems, 'upstream 必须是一个对象（repo / pin / hash-manifest / verify-gate）')
  } else {
    checkUnknownKeys(problems, 'upstream', cfg.upstream, ['repo', 'pin', 'hash-manifest', 'verify-gate'])
    for (const key of ['repo', 'hash-manifest', 'verify-gate']) {
      if (!isNonEmptyString(cfg.upstream[key])) fail(problems, 'upstream.' + key + ' 必须是非空字符串')
    }
    if (!isNonEmptyString(cfg.upstream.pin) || !/^v\d+\.\d+\.\d+$/.test(cfg.upstream.pin)) {
      fail(problems, 'upstream.pin 必须是形如 v1.3.1 的版本号，读到的是 ' + JSON.stringify(cfg.upstream.pin))
    }
  }

  // ---- sources：映射引用的随包原文 ----
  const sourceIds: string[] = []
  if (!isObject(cfg.sources) || Object.keys(cfg.sources).length === 0) {
    fail(problems, 'sources 必须是一个非空对象（原文 id → 文件与用途）')
  } else {
    for (const [id, src] of Object.entries(cfg.sources as Record<string, any>)) {
      if (!/^[a-z][a-z0-9-]*$/.test(id)) fail(problems, 'sources 的 id「' + id + '」必须是 kebab-case 英文')
      sourceIds.push(id)
      if (!isObject(src)) {
        fail(problems, 'sources.' + id + ' 必须是一个对象（file / role）')
        continue
      }
      checkUnknownKeys(problems, 'sources.' + id, src, ['file', 'role'])
      if (!isNonEmptyString(src.file) || !src.file.endsWith('.md')) {
        fail(problems, 'sources.' + id + '.file 必须是 .md 路径')
      }
      if (!isNonEmptyString(src.role)) fail(problems, 'sources.' + id + '.role 必须说明这份原文管什么')
    }
  }

  // ---- layout：文件写在哪 ----
  if (!isObject(cfg.layout)) {
    fail(problems, 'layout 必须是一个对象')
  } else {
    const layoutKeys: string[] = ['root', 'feature-dir', 'effort-dir', 'spec-file', 'map-file', 'issues-dir', 'ticket-file', 'numbering']
    checkUnknownKeys(problems, 'layout', cfg.layout, layoutKeys)
    for (const key of ['root', 'feature-dir', 'effort-dir', 'spec-file', 'map-file', 'issues-dir', 'ticket-file']) {
      if (!isNonEmptyString(cfg.layout[key])) fail(problems, 'layout.' + key + ' 必须是非空字符串')
    }
    if (isNonEmptyString(cfg.layout.root) && cfg.layout.root !== '.scratch') {
      fail(problems, 'layout.root 必须是 .scratch（原文 issue-tracker-local.md 的约定），读到的是 ' + JSON.stringify(cfg.layout.root))
    }
    if (isNonEmptyString(cfg.layout['ticket-file']) && !cfg.layout['ticket-file'].includes('<NN>')) {
      fail(problems, 'layout.ticket-file 必须包含 <NN> 占位符，读到的是 ' + JSON.stringify(cfg.layout['ticket-file']))
    }
    const num = cfg.layout.numbering
    if (!isObject(num)) {
      fail(problems, 'layout.numbering 必须是一个对象')
    } else {
      checkUnknownKeys(problems, 'layout.numbering', num, ['first', 'digits', 'scope', 'dependency-order'])
      if (!Number.isInteger(num.first) || num.first < 1) fail(problems, 'layout.numbering.first 必须是 ≥1 的整数')
      if (!Number.isInteger(num.digits) || num.digits < 2 || num.digits > 4) fail(problems, 'layout.numbering.digits 必须是 2～4 的整数')
      if (num.scope !== 'per-directory') fail(problems, 'layout.numbering.scope 必须是 per-directory（每个目录各自从 01）')
      if (num['dependency-order'] !== true) fail(problems, 'layout.numbering.dependency-order 必须是 true（阻塞者先建）')
    }
  }

  // ---- objects：每个对象写成什么文件 ----
  if (!isObject(cfg.objects)) {
    fail(problems, 'objects 必须是一个对象')
  } else {
    for (const key of OBJECT_KEYS) {
      if (!isObject(cfg.objects[key])) fail(problems, 'objects 缺少「' + key + '」这一项')
    }
    for (const [key, obj] of Object.entries(cfg.objects as Record<string, any>)) {
      const where: string = 'objects.' + key
      if (!isObject(obj)) {
        fail(problems, where + ' 必须是一个对象')
        continue
      }
      const allowed: string[] = ['kind', 'path', 'source', 'title-shape', 'sections', 'fields', 'top-lines', 'body-section', 'resolve', 'acceptance', 'status', 'anchors', 'reuse', 'note', 'user-story-shape']
      checkUnknownKeys(problems, where, obj, allowed)
      if (!ALLOWED_KINDS.includes(obj.kind)) fail(problems, where + '.kind 必须是 ' + ALLOWED_KINDS.join(' / ') + ' 之一')
      if (!isNonEmptyString(obj.path) || !obj.path.startsWith('.scratch/')) fail(problems, where + '.path 必须是 .scratch/ 下的路径')
      const srcs: unknown = obj.source
      const srcList: string[] = Array.isArray(srcs) ? (srcs as string[]) : (typeof srcs === 'string' ? [srcs as string] : [])
      if (srcList.length === 0) fail(problems, where + '.source 必须引用至少一份原文')
      for (const id of srcList) {
        if (!sourceIds.includes(id)) fail(problems, where + '.source 引用了不存在的原文 id「' + id + '」')
      }
      if (obj.reuse !== undefined && (typeof obj.reuse !== 'string' || !OBJECT_KEYS.includes(obj.reuse))) {
        fail(problems, where + '.reuse 必须指向另一个对象 key')
      }
      if (!Array.isArray(obj.anchors) || obj.anchors.length === 0) {
        fail(problems, where + '.anchors 必须是非空字符串数组：原文里能逐字找到的锚点')
      } else {
        checkStringArray(problems, where + '.anchors', obj.anchors)
      }
      if (obj.sections !== undefined) {
        checkStringArray(problems, where + '.sections', obj.sections)
        if (Array.isArray(obj.sections)) {
          const seen = new Set<string>()
          for (const s of obj.sections) {
            if (typeof s === 'string' && s.startsWith('## ')) fail(problems, where + '.sections 里不要带 ## 前缀，写作「' + s + '」会拼出两个井号')
            if (typeof s === 'string' && seen.has(s)) fail(problems, where + '.sections 有重复项「' + s + '」')
            if (typeof s === 'string') seen.add(s)
          }
        }
      }
      if (obj.fields !== undefined) {
        if (!Array.isArray(obj.fields) || obj.fields.length === 0) {
          fail(problems, where + '.fields 必须是非空数组')
        } else {
          for (const field of obj.fields) {
            if (!isObject(field) || !isNonEmptyString(field.label) || !isNonEmptyString(field['line-shape'])) {
              fail(problems, where + '.fields 的每一项都要有 label 与 line-shape')
            }
          }
        }
      }
      if (obj['top-lines'] !== undefined) {
        if (!Array.isArray(obj['top-lines']) || obj['top-lines'].length === 0) {
          fail(problems, where + '.top-lines 必须是非空数组')
        } else {
          for (const line of obj['top-lines']) {
            if (!isObject(line) || !isNonEmptyString(line.label)) fail(problems, where + '.top-lines 的每一项都要有 label')
            if (line.values !== undefined) checkStringArray(problems, where + '.top-lines[' + String(line.label) + '].values', line.values)
            if (line['line-shape'] !== undefined && !isNonEmptyString(line['line-shape'])) fail(problems, where + '.top-lines 的 line-shape 必须是非空字符串')
          }
        }
      }
      if (obj.titleShape !== undefined || obj['title-shape'] !== undefined) {
        const titleShape: unknown = obj['title-shape']
        if (typeof titleShape !== 'string' || !titleShape.startsWith('# ')) {
          fail(problems, where + '.title-shape 必须是「# 标题」形状的字符串')
        }
      }
      if (obj.status !== undefined) {
        if (!isObject(obj.status)) {
          fail(problems, where + '.status 必须是一个对象')
        } else {
          checkUnknownKeys(problems, where + '.status', obj.status, ['visible-line', 'hidden-comment', 'default'])
          if (typeof obj.status['visible-line'] !== 'boolean') fail(problems, where + '.status.visible-line 必须是布尔值')
          if (obj.status.default !== undefined && !isNonEmptyString(obj.status.default)) fail(problems, where + '.status.default 必须是非空字符串')
        }
      }
      if (obj.acceptance !== undefined && !isNonEmptyString(obj.acceptance)) fail(problems, where + '.acceptance 必须是非空字符串')
      if (obj['body-section'] !== undefined && !isNonEmptyString(obj['body-section'])) fail(problems, where + '.body-section 必须是非空字符串')
      if (obj.note !== undefined && !isNonEmptyString(obj.note)) fail(problems, where + '.note 必须是非空字符串')
    }
    // 五类对象都引用同一份 issue-tracker-local，至少要在那边有锚点；这里不重复查引用计数。
  }

  // ---- status：状态词集合 ----
  let triageRoles: string[] = []
  let wayfinderStatuses: string[] = []
  if (!isObject(cfg.status)) {
    fail(problems, 'status 必须是一个对象（triage-roles / wayfinder）')
  } else {
    checkUnknownKeys(problems, 'status', cfg.status, ['triage-roles', 'wayfinder'])
    checkStringArray(problems, 'status.triage-roles', cfg.status['triage-roles'])
    checkStringArray(problems, 'status.wayfinder', cfg.status.wayfinder)
    if (Array.isArray(cfg.status['triage-roles'])) triageRoles = cfg.status['triage-roles'].filter(isNonEmptyString)
    if (Array.isArray(cfg.status.wayfinder)) wayfinderStatuses = cfg.status.wayfinder.filter(isNonEmptyString)
    for (const role of triageRoles) {
      if (wayfinderStatuses.includes(role)) fail(problems, 'status 里「' + role + '」同时出现在 triage-roles 与 wayfinder；两个集合不能混用')
    }
  }

  // ---- hidden-comments：插件自己的隐藏信息 ----
  const commentNames: string[] = []
  if (!isObject(cfg['hidden-comments'])) {
    fail(problems, 'hidden-comments 必须是一个对象（placement / one-per-line / entries）')
  } else {
    const hc: Record<string, any> = cfg['hidden-comments'] as Record<string, any>
    checkUnknownKeys(problems, 'hidden-comments', hc, ['placement', 'one-per-line', 'entries'])
    if (hc.placement !== 'before-first-h1') fail(problems, 'hidden-comments.placement 必须是 before-first-h1')
    if (hc['one-per-line'] !== true) fail(problems, 'hidden-comments.one-per-line 必须是 true')
    if (!Array.isArray(hc.entries) || hc.entries.length === 0) {
      fail(problems, 'hidden-comments.entries 必须是非空数组')
    } else {
      for (const entry of hc.entries) {
        if (!isObject(entry)) {
          fail(problems, 'hidden-comments.entries 的每一项必须是对象')
          continue
        }
        const where: string = 'hidden-comments.' + String(entry.name || '(未命名)')
        checkUnknownKeys(problems, where, entry, ['name', 'line', 'scope', 'why'])
        if (!isNonEmptyString(entry.name) || !/^DSH-[A-Z-]+$/.test(entry.name)) {
          fail(problems, where + '.name 必须是 DSH- 开头的大写英文（如 DSH-STATUS）')
        } else {
          if (commentNames.includes(entry.name)) fail(problems, 'hidden-comments 里「' + entry.name + '」写了两次；一个名字只能定义一次')
          commentNames.push(entry.name)
        }
        if (!isNonEmptyString(entry.line) || !entry.line.startsWith('<!-- ') || !entry.line.endsWith(' -->')) {
          fail(problems, where + '.line 必须是 <!-- ... --> 形式的整行')
        } else if (isNonEmptyString(entry.name) && !entry.line.includes('<!-- ' + entry.name)) {
          fail(problems, where + '.line 必须以「<!-- ' + entry.name + '」开头（名字对不上就无法靠它识别）')
        }
        if (!Array.isArray(entry.scope) || entry.scope.length === 0) {
          fail(problems, where + '.scope 必须是非空数组（all-files 或具体对象 key）')
        } else {
          for (const scope of entry.scope) {
            if (scope !== 'all-files' && !OBJECT_KEYS.includes(scope)) {
              fail(problems, where + '.scope 里的「' + String(scope) + '」既不是 all-files 也不是已定义的对象 key')
            }
          }
        }
        if (!isNonEmptyString(entry.why) || entry.why.trim().length < 10) {
          fail(problems, where + '.why 必须写清为什么加这条隐藏信息（至少一句完整的话）')
        }
      }
    }
  }

  // 交叉校验：对象引用的隐藏注释必须真的定义过；默认状态词必须在两个集合里。
  if (isObject(cfg.objects)) {
    for (const [key, obj] of Object.entries(cfg.objects as Record<string, any>)) {
      if (!isObject(obj)) continue
      if (isObject(obj.status) && isNonEmptyString(obj.status['hidden-comment'])) {
        if (!commentNames.includes(obj.status['hidden-comment'])) {
          fail(problems, 'objects.' + key + '.status.hidden-comment 引用了未定义的隐藏注释「' + obj.status['hidden-comment'] + '」')
        }
      }
      if (isObject(obj.status) && isNonEmptyString(obj.status.default)) {
        if (!triageRoles.includes(obj.status.default) && !wayfinderStatuses.includes(obj.status.default)) {
          fail(problems, 'objects.' + key + '.status.default「' + obj.status.default + '」不在 status 的两个集合里')
        }
      }
    }
  }

  // ---- reading：怎么读回两种来源的文件 ----
  if (!isObject(cfg.reading)) {
    fail(problems, 'reading 必须是一个对象')
  } else {
    const reading: Record<string, any> = cfg.reading as Record<string, any>
    checkUnknownKeys(problems, 'reading', reading, ['format-detection', 'layout-discovery', 'fallbacks'])
    for (const key of ['format-detection', 'layout-discovery', 'fallbacks']) {
      const list = reading[key]
      if (!Array.isArray(list) || list.length === 0) {
        fail(problems, 'reading.' + key + ' 必须是非空数组')
        continue
      }
      for (const item of list) {
        if (!isObject(item)) {
          fail(problems, 'reading.' + key + ' 的每一项必须是「一行规则」对象')
          continue
        }
        for (const [k, v] of Object.entries(item)) {
          if (!isNonEmptyString(v)) fail(problems, 'reading.' + key + ' 的「' + k + '」必须是完整的一句话')
        }
      }
    }
  }

  // ---- enhancements：本插件额外加的行为，每条都要有理由与替代方案 ----
  if (!Array.isArray(cfg.enhancements) || cfg.enhancements.length === 0) {
    fail(problems, 'enhancements 必须是非空数组（本插件额外加的行为及其理由）')
  } else {
    for (const item of cfg.enhancements) {
      if (!isObject(item)) {
        fail(problems, 'enhancements 的每一项必须是对象')
        continue
      }
      const where: string = 'enhancements.' + String(item.id || '(未命名)')
      checkUnknownKeys(problems, where, item, ['id', 'what', 'why', 'alternatives'])
      for (const key of ['id', 'what', 'why', 'alternatives']) {
        if (!isNonEmptyString(item[key])) fail(problems, where + '.' + key + ' 必须是非空字符串')
      }
    }
  }

  // ---- upgrade：原文升级时照什么顺序改 ----
  if (!isObject(cfg.upgrade)) {
    fail(problems, 'upgrade 必须是一个对象')
  } else {
    const upgrade: Record<string, any> = cfg.upgrade as Record<string, any>
    checkUnknownKeys(problems, 'upgrade', upgrade, ['schema-version', 'pin-history', 'checklist'])
    if (!isNonEmptyString(upgrade['schema-version'])) fail(problems, 'upgrade.schema-version 必须是非空字符串')
    if (!Array.isArray(upgrade['pin-history']) || upgrade['pin-history'].length === 0) {
      fail(problems, 'upgrade.pin-history 必须是非空数组（至少记录首次建立映射的那一版）')
    } else {
      for (const item of upgrade['pin-history']) {
        if (!isObject(item) || !isNonEmptyString(item.pin) || !isNonEmptyString(item['recorded-at']) || !isNonEmptyString(item.note)) {
          fail(problems, 'upgrade.pin-history 的每一项都要有 pin / recorded-at / note')
        }
      }
    }
    checkStringArray(problems, 'upgrade.checklist', upgrade.checklist)
  }

  return problems
}

/** 读真源文本（读不到直接报错：主配置缺失是故障，不是可忽略状态）。 */
export function readMdFormatText(root: string): string {
  const full: string = path.join(root, MD_FORMAT_REL)
  try {
    return fs.readFileSync(full, 'utf8')
  } catch {
    throw new Error('读不到 ' + MD_FORMAT_REL + '：Markdown 后端的格式映射真源缺了')
  }
}

/** 读真源并校验。任何问题都抛错（生成器与门禁都不想让半份映射生效）。 */
export function readMdFormatConfig(root: string): Record<string, any> {
  const doc: unknown = yaml.parse(readMdFormatText(root))
  const problems: string[] = validateMdFormatConfig(doc)
  if (problems.length > 0) {
    throw new Error('格式映射有问题：\n- ' + problems.join('\n- '))
  }
  return doc as Record<string, any>
}

/** 按映射生成 generated.ts 全文。生成物只包含数据，不含逻辑；消费方静态 import 它。 */
export function renderMdFormatData(cfg: Record<string, any>): string {
  const lines: string[] = []
  lines.push('// generated.ts —— Markdown 后端「随包原文 ↔ 本插件」格式映射的生成源码（#1480 T1）。')
  lines.push('//')
  lines.push('// 人手不改：本文件由 scripts/generate-md-format-config.mts 按')
  lines.push('// ' + MD_FORMAT_REL + ' 写出；改映射请改那份 YAML 再跑生成器。')
  lines.push('// 生成物不入库：真源只有 YAML 一份，改了 YAML 忘跑生成器由 tests/verify-md-format-config.ts 判红。')
  lines.push('// 为什么读生成物而不是运行时读 YAML：与时间参数、提示词、界面词表同一条纪律，')
  lines.push('// 宿主与客户端吃同一份构建期快照，两边不会悄悄分叉。')
  lines.push('')
  lines.push('export const MD_FORMAT = ' + JSON.stringify(cfg, null, 2) + ' as const;')
  lines.push('')
  lines.push('export type MdFormat = typeof MD_FORMAT;')
  return lines.join('\n')
}
