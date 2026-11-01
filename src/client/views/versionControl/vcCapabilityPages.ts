// views/versionControl/vcCapabilityPages.ts —— 版本管理页的页面注册表（#1738 T03）
// 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处。
//
// 为什么单起一份：页面注册表与能力数据必须同源。页面清单、每页能力、每页数量全部从能力账本
// （src/shared/version-control/src/capability-ledger.ts，构建时按 shared:vcCapabilityLedger 拼进闭包）
// 读，这里一条 id、名称或计数都不抄 —— 抄一份就会有两处真源，门禁 tests/verify-818-version-control-view.ts
// 的 Z 组会判红。
//
// 页面归属的两条硬规矩（规格 #1586 第 9 节）：一个能力只归一处；层级最多「页签或页面 → 二级页」，
// 二级页不开三级页。四页签 + 九个管理分区 + 变基待办 + 冲突向导 + 全库搜索 = 16 页。
// 13.14 图形历史浏览器按账本落在提交历史页；管理 › 平台与边界页只放一条说明指回历史页。

declare const CAPABILITIES: any[]
declare const PAGE_SURFACES: any[]
declare const PAGE_COUNTS: Record<string, number>
declare const PRIMARY_ENTRY_PAGE: Record<string, string>

export const VC_TAB_PAGES: string[] = ['changes', 'commits', 'worktrees', 'stash']
export const VC_MANAGE_PAGES: string[] = [
  'branch-tags', 'remote', 'submodules', 'maintenance', 'migrate', 'config', 'hooks', 'diagnostics', 'platform',
]
export const VC_SIDE_PAGES: string[] = ['rebase', 'conflicts']
export const VC_SEARCH_PAGE = 'search'

// 齿轮九分区索引的文案键（顺序即规格第 9 节的顺序）。页面标题、能力清单都不在这里，仍从账本读。
export const VC_MANAGE_SECTION_KEYS: Record<string, string> = {
  'branch-tags': 'vc.shell.gear.branchTags',
  remote: 'vc.shell.gear.remote',
  submodules: 'vc.shell.gear.submodules',
  maintenance: 'vc.shell.gear.maintenance',
  migrate: 'vc.shell.gear.migrate',
  config: 'vc.shell.gear.config',
  hooks: 'vc.shell.gear.hooks',
  diagnostics: 'vc.shell.gear.diagnostics',
  platform: 'vc.shell.gear.platform',
}

// 深链参数表（规格第 9 节）：参数只决定「打开哪个位置」，一律 executes:false，
// 打开位置不等于执行写动作。manage 落到第一个管理分区（分支与标签），palette 落到全库搜索。
export const VC_DEEP_LINKS: Record<string, string> = {
  manage: 'branch-tags',
  remote: 'remote',
  submodules: 'submodules',
  maintenance: 'maintenance',
  migrate: 'migrate',
  config: 'config',
  hooks: 'hooks',
  diagnostics: 'diagnostics',
  platform: 'platform',
  rebase: 'rebase',
  conflicts: 'conflicts',
  palette: 'search',
}

// 层级：页签与全局面第 1 层；九个管理分区与两个二级页第 2 层。二级页不开三级页，所以没有第 3 层。
const VC_PAGE_DEPTHS: Record<string, number> = {
  changes: 1, commits: 1, worktrees: 1, stash: 1, search: 1,
  'branch-tags': 2, remote: 2, submodules: 2, maintenance: 2, migrate: 2,
  config: 2, hooks: 2, diagnostics: 2, platform: 2, rebase: 2, conflicts: 2,
}

export const vcPageDepthOf = function (pageId: any) {
  const id = String(pageId === undefined || pageId === null ? '' : pageId)
  const d = VC_PAGE_DEPTHS[id]
  // 未知页面按第 2 层算：宁可多报一层也不让门禁误以为它是一级页面。
  return typeof d === 'number' ? d : 2
}

export const vcPageSurfaceOf = function (pageId: any) {
  const id = String(pageId === undefined || pageId === null ? '' : pageId)
  for (let i = 0; i < PAGE_SURFACES.length; i += 1) {
    const p = PAGE_SURFACES[i]
    if (p && p.id === id) return p
  }
  return null
}

export const vcPageCapabilitiesOf = function (pageId: any) {
  const id = String(pageId === undefined || pageId === null ? '' : pageId)
  return CAPABILITIES.filter(function (c: any) { return c && c.page === id })
}

export const vcCapabilityOf = function (capId: any) {
  const id = String(capId === undefined || capId === null ? '' : capId)
  for (let i = 0; i < CAPABILITIES.length; i += 1) {
    const c = CAPABILITIES[i]
    if (c && c.id === id) return c
  }
  return null
}

// 页面注册表：门禁拿它的能力并集与能力数据的页面集合比对，拿每页数量与 PAGE_COUNTS 逐页比对。
// capabilities 只带渲染要用的字段，不复制整份账本（账本仍只有一份）。
export const vcPageRegistryOf = function () {
  return PAGE_SURFACES.map(function (p: any) {
    const caps = vcPageCapabilitiesOf(p.id)
    return {
      id: p.id,
      name: p.name,
      kind: p.kind,
      primaryEntry: p.primaryEntry,
      depth: vcPageDepthOf(p.id),
      count: Number(PAGE_COUNTS && PAGE_COUNTS[p.id]) || 0,
      capabilities: caps.map(function (c: any) {
        return {
          id: c.id, name: c.name, command: c.command, level: c.level,
          finalForm: c.finalForm, primaryEntry: c.primaryEntry, panelPath: c.panelPath,
        }
      }),
    }
  })
}

export const vcDeepLinkOf = function (key: any) {
  const k = String(key === undefined || key === null ? '' : key)
  const page = VC_DEEP_LINKS[k]
  if (!page) return null
  return { key: k, page: page, depth: vcPageDepthOf(page), executes: false, highlight: true }
}

export const vcPageOrderOf = function () {
  return PAGE_SURFACES.map(function (p: any) { return p.id })
}

export const vcPrimaryEntryPageOf = function (entry: any) {
  const k = String(entry === undefined || entry === null ? '' : entry)
  return PRIMARY_ENTRY_PAGE[k] || null
}
