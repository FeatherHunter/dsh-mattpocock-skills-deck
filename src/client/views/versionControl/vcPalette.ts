// views/versionControl/vcPalette.ts —— 全库搜索（命令面板）的纯逻辑与画法（#1738 T03）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包。
//
// 命令面板按能力 id、名称、别名、命令原文、一行摘要搜索，结果显示它落在哪一页；
// 选中只做「跳到入口并高亮」，需要对象上下文的动作一律不在这里执行（executes 恒 false）。
// 数据全部来自能力账本（CAPABILITIES），不抄名单。

declare const CAPABILITIES: any[]
declare const PAGE_SURFACES: any[]
declare function vcPageDepthOf(pageId: any): number
// 共享层 capabilities.ts 由构建整段拼进页面闭包（src/client/index.ts 的 shared:vcCapabilities 标记）。
declare function capabilityAvailability(cap: any, version: any): any

export const VC_PALETTE_MAX = 80
// 一次最多画几行：这是渲染上限，不是能力上限；命中数另外由 vcPaletteMatchOf 算出来显示。
export const VC_PALETTE_RENDER_MAX = 20

export const vcCapabilityAliasOf = function (cap: any) {
  const cmd = String((cap && cap.command) || '')
  if (!cmd) return ''
  const words = cmd.split(/\s+/)
  const out: string[] = []
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]
    // 别名只收英文子命令与命令名：去掉 git 前缀、选项、占位符与斜杠组合。
    if (!word || word === 'git') continue
    if (word.charAt(0) === '-') continue
    if (!/^[a-z][a-z0-9-]*$/.test(word)) continue
    out.push(word)
    if (out.length >= 2) break
  }
  return out.join(' ')
}

export const vcCapabilityPageNameOf = function (cap: any) {
  const id = String((cap && cap.page) || '')
  for (let i = 0; i < PAGE_SURFACES.length; i += 1) {
    if (PAGE_SURFACES[i] && PAGE_SURFACES[i].id === id) return PAGE_SURFACES[i].name
  }
  return ''
}

export const vcCapabilitySummaryOf = function (cap: any) {
  if (!cap) return ''
  return String(cap.domainName || '') + '｜' + vcCapabilityPageNameOf(cap) + '｜' + String(cap.finalForm || '')
}

// 写 / 毁 / 改写的动作需要对象上下文（选哪条分支、哪笔提交），命令面板只跳入口，不直接执行。
export const vcCapabilityNeedsObjectOf = function (cap: any) {
  const level = String((cap && cap.level) || '')
  return level === '写' || level === '毁' || level === '改写'
}

// 命令面板的版本说明：只在真的读到过 git 版本（首屏状态读成功）时才画。
// 版本未知时 capabilityAvailability 会按「低于 2.11 底线」给出 hidden，照着写「版本不支持」就是假话，
// 所以这里版本为空就什么都不说；账本里没有版本限制（versionPolicy 为空）的行也不画。
// #1776：真实页签的首屏快照在 reads.firstScreen（七片聚合），旧块那一份在 reads.screen；
//   先读新形状的 version 片，读不到再看旧形状，两代入口共用这同一份行渲染。
const vcPaletteVersionOf = function (reads: any) {
  const first = reads && reads.firstScreen && reads.firstScreen.data
  const slices = first && first.slices ? first.slices : null
  const slice = slices && slices.version ? slices.version : null
  const fresh = slice && slice.state === 'ok' ? slice.data : null
  if (fresh && fresh.gitVersion) return String(fresh.gitVersion)
  const data = reads && reads.screen && reads.screen.data
  return data && data.gitVersion ? String(data.gitVersion) : ''
}

const vcPaletteVersionNoteOf = function (cap: any, version: any) {
  if (!cap || !cap.versionPolicy || !version) return null
  const avail = capabilityAvailability(cap, String(version))
  if (!avail || avail.state === 'full') return null
  return {
    state: String(avail.state),
    needed: String(avail.needed || ''),
    alternative: avail.alternative ? String(avail.alternative) : '',
  }
}

export const vcPaletteRowOf = function (cap: any, version: any) {
  const alias = vcCapabilityAliasOf(cap)
  const note = vcPaletteVersionNoteOf(cap, version)
  return {
    id: String(cap.id),
    name: String(cap.name || ''),
    alias: alias,
    command: String(cap.command || ''),
    summary: vcCapabilitySummaryOf(cap),
    pageName: vcCapabilityPageNameOf(cap),
    page: String(cap.page || ''),
    primaryEntry: String(cap.primaryEntry || ''),
    level: String(cap.level || ''),
    finalForm: String(cap.finalForm || ''),
    needsObject: vcCapabilityNeedsObjectOf(cap),
    versionState: note ? note.state : '',
    versionNeed: note ? note.needed : '',
    versionAlternative: note ? note.alternative : '',
  }
}

export const vcPaletteMatchOf = function (query: any, version: any) {
  const q = String(query === undefined || query === null ? '' : query).trim().toLowerCase()
  const all = CAPABILITIES.map(function (cap: any) { return vcPaletteRowOf(cap, version) })
  if (!q) return all
  return all.filter(function (row: any) {
    const hay = [row.id, row.name, row.alias, row.command, row.summary, row.pageName].join(' ').toLowerCase()
    return hay.indexOf(q) >= 0
  })
}

export const vcPaletteRowsOf = function (query: any, limit: any, version: any) {
  const rows = vcPaletteMatchOf(query, version)
  const n = Number(limit) > 0 ? Math.min(Number(limit), VC_PALETTE_MAX) : VC_PALETTE_RENDER_MAX
  return rows.slice(0, n)
}

export const vcPaletteTargetOf = function (capId: any) {
  const cap = CAPABILITIES.filter(function (c: any) { return c && c.id === String(capId) })[0]
  if (!cap) return null
  return {
    capId: cap.id,
    page: cap.page,
    depth: vcPageDepthOf(cap.page),
    primaryEntry: cap.primaryEntry,
    needsObject: vcCapabilityNeedsObjectOf(cap),
    executes: false,
    highlight: true,
  }
}

// 一行搜索结果：id、名称、别名、命令原文、所在页面；带 data-cap-secondary 标记这是能力在命令面板里的第二入口。
export const vcPaletteRowNode = function (h: any, t: any, row: any, hit: boolean) {
  const kids: any[] = [
    h('span', { key: 'id', className: 'vcs-pal-id' }, row.id),
    h('span', { key: 'name', className: 'vcs-pal-name' }, row.name),
    h('span', { key: 'where', className: 'vcs-pal-where' }, t('vc.shell.palette.jump') + ' ' + row.pageName),
  ]
  if (row.alias) kids.push(h('code', { key: 'alias', className: 'vcs-pal-alias' }, row.alias))
  if (row.command) kids.push(h('code', { key: 'cmd', className: 'vcs-pal-cmd' }, row.command))
  if (row.needsObject) kids.push(h('span', { key: 'need', className: 'vcs-pal-need' }, t('vc.shell.palette.needsObject')))
  // 版本说明跟着行一起画：data-vc-palette-version 让门禁能逐条量到「需要哪版」与替代做法。
  if (row.versionState) {
    const need = row.versionState === 'degraded'
      ? t('vc.shell.palette.versionDegraded', { need: row.versionNeed })
      : t('vc.shell.palette.versionHidden', { need: row.versionNeed })
    const noteKids: any[] = [h('span', { key: 'need', className: 'vcs-pal-version-need' }, need)]
    if (row.versionAlternative) noteKids.push(h('span', { key: 'alt', className: 'vcs-pal-version-alt' }, t('vc.shell.palette.versionAlt', { alt: row.versionAlternative })))
    kids.push(h('span', {
      key: 'version', className: 'vcs-pal-version',
      'data-vc-palette-version': row.id,
      'data-vc-palette-version-state': row.versionState,
      'data-vc-palette-version-need': row.versionNeed,
    }, noteKids))
  }
  const attrs: any = {
    key: row.id,
    'data-cap-secondary': row.id,
    'data-vc-palette-row': row.id,
    className: 'vcs-pal-row',
    type: 'button',
  }
  if (hit) attrs['data-vc-palette-hit'] = '1'
  return h('li', { key: row.id, className: 'vcs-pal-li' }, [h('button', attrs, kids)])
}

export const vcPaletteNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const version = vcPaletteVersionOf(opts.reads)
  const matches = vcPaletteMatchOf(opts.query, version)
  const rows = vcPaletteRowsOf(opts.query, opts.limit, version)
  const hitId = opts.highlight ? String(opts.highlight) : ''
  const body: any[] = []
  body.push(h('div', { key: 'head', className: 'vcs-pal-head' }, [
    h('h3', { key: 'title', className: 'vcs-pal-title' }, t('vc.shell.palette.title')),
    h('span', { key: 'hint', className: 'vcs-pal-hint' }, t('vc.shell.palette.hint', { n: matches.length })),
  ]))
  body.push(h('input', {
    key: 'q',
    type: 'search',
    className: 'vcs-pal-input',
    'data-vc-palette-input': '1',
    'data-cap-main': 'palette',
    placeholder: t('vc.shell.palette.placeholder'),
    'aria-label': t('vc.shell.palette.placeholder'),
    defaultValue: String(opts.query === undefined || opts.query === null ? '' : opts.query),
  }))
  if (!rows.length) {
    body.push(h('p', { key: 'empty', className: 'vcs-pal-empty', 'data-vc-palette-empty': '1' }, t('vc.shell.palette.empty')))
  } else {
    body.push(h('ul', { key: 'rows', className: 'vcs-pal-list', 'data-vc-palette-list': '1' },
      rows.map(function (row: any) { return vcPaletteRowNode(h, t, row, !!hitId && row.id === hitId) })))
  }
  const attrs: any = { id: opts.id, className: 'vcs-palette', 'data-vc-palette': '1', role: 'search' }
  return h('section', attrs, body)
}
