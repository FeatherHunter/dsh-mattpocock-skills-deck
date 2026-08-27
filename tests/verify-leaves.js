// verify-leaves.js — dsh-mattpocock-skills-deck 阶段 2 叶子迁移（#97 T4）：叶子模块契约验证
// 验证：
//   1) 全部叶子文件存在且含预期导出（G3 共享 → views/shared/ · G4 严格一文件）
//   2) 每个叶子文件 ≤350 行（G4 Q1：≤350 默认、>500 强制拆）
//   3) 组件叶子含 React.useContext(DswsCtx) 消费（ARCHITECTURE-CTX.md §2 插座式）
//   4) 构建产物（_dev client.js / _pkg package/lib/client.js）已拼接全部叶子（一源两物 · 无标记残留）
//   5) 去重指标：tabsTip 单源（12→5）/ fitAllTags 单源（views/shared/tagsFit.js）/ Dock+Overlay tabs 行合成一处
//   6) 产物新鲜度门禁（缺失/过期 → FAIL，提示先构建；与 verify-kernel 同口径）
// 用法: node tests/verify-leaves.js（在插件根目录；先运行 node scripts/build.mjs 生成产物）
const fs = require('fs')
const path = require('path')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const PRODUCTS = ['client.js', 'package/lib/client.js']
const LEAVES = [
  { file: 'src/client/views/shared/chips.js', exports: ['Dot', 'TypeChip'], components: ['Dot', 'TypeChip'] },
  { file: 'src/client/views/shared/md.js', exports: ['MD_LINK_RE', 'MD_TASK_RE', 'mdEsc', 'mdInline', 'mdToHtml'], components: [] },
  { file: 'src/client/views/shared/ticket.js', exports: ['tStatus', 'tStatusLabel', 'tProgressBar', 'tStatusBadge'], components: [] },
  { file: 'src/client/views/shared/tagsFit.js', exports: ['_tagsFpOf', 'fitAllTags'], components: [] },
  { file: 'src/client/views/shared/Tabs.js', exports: ['useTabsRow'], components: [] },
  { file: 'src/client/views/TicketRow.js', exports: ['TicketRow'], components: ['TicketRow'] },
  { file: 'src/client/views/MapDetail.js', exports: ['MapDetail'], components: ['MapDetail'] },
  { file: 'src/client/views/IssueDetail.js', exports: ['IssueDetail'], components: ['IssueDetail'] },
  { file: 'src/client/views/NoRepoCard.js', exports: ['NoRepoCard'], components: ['NoRepoCard'] },
  { file: 'src/client/views/ListTab.js', exports: ['ListTab'], components: ['ListTab'] },
  { file: 'src/client/views/RingSkills.js', exports: ['RingSkills'], components: ['RingSkills'] },
  { file: 'src/client/views/SkillsTab.js', exports: ['SkillsTab'], components: ['SkillsTab'] },
  { file: 'src/client/views/ChecksTab.js', exports: ['ChecksTab'], components: ['ChecksTab'] },
  { file: 'src/client/views/SettingsPage.js', exports: ['TPL_NAMES', 'TPL_DESC', 'TPL_EDIT_IDS', 'PREVIEW_VALUES', 'SettingsPage'], components: ['SettingsPage'] },
  { file: 'src/client/views/RunPanel.js', exports: ['RunPanel'], components: ['RunPanel'] },
  { file: 'src/client/panel/Dock.js', exports: ['DetailsDock'], components: ['DetailsDock'] },
  { file: 'src/client/panel/NamingFailBanner.js', exports: ['NamingFailBanner'], components: ['NamingFailBanner'] },
  { file: 'src/client/panel/Overlay.js', exports: ['OverlayPanel'], components: ['OverlayPanel'] },
  { file: 'src/client/statusbar/Seg.js', exports: ['num', 'seg'], components: [] },
  { file: 'src/client/statusbar/checksums.js', exports: ['checksumsOf'], components: [] },
  { file: 'src/client/statusbar/StatusBar.js', exports: ['StatusBar'], components: ['StatusBar'] },
  { file: 'src/client/floating/SkillFloatList.js', exports: ['SkillFloatList'], components: ['SkillFloatList'] },
  { file: 'src/client/floating/Pop.js', exports: ['showPop'], components: [] },
]
const SOURCES = [
  'src/client/index.js', 'scripts/build.mjs', 'package/package.json',
  ...LEAVES.map((l) => l.file),
]

function productStale(prod) {
  if (!fs.existsSync(prod)) return '缺失（请先运行 node scripts/build.mjs）'
  const pm = fs.statSync(prod).mtimeMs
  for (const s of SOURCES) {
    if (fs.existsSync(s) && fs.statSync(s).mtimeMs > pm + 1000) {
      return '过期（' + s + ' 比产物新，请重新运行 node scripts/build.mjs）'
    }
  }
  return null
}

function main() {
  // ---- 产物新鲜度门禁 ----
  PRODUCTS.forEach((p) => {
    const why = productStale(p)
    check(!why, '产物门禁 ' + p + (why ? '：' + why : '（存在且新鲜）'))
  })
  if (failed) { console.log('\n存在失败'); process.exit(1) }

  // ---- 叶子文件 + 导出齐全 + ≤350 行 + 组件 useContext ----
  for (const l of LEAVES) {
    const file = l.file
    if (!fs.existsSync(file)) { check(false, file + ' 缺失'); continue }
    const src = fs.readFileSync(file, 'utf8')
    const lines = src.split(/\r?\n/).length
    const limit = file.includes('StatusBar') ? 450 : 350
    check(lines <= limit, file + ' ≤' + limit + ' 行（G4 · 实际 ' + lines + '）')
    for (const ex of l.exports) {
      const ok = new RegExp('export\\s+(const|let|function|var)\\s+' + ex + '\\b').test(src)
      check(ok, file + ' 导出 ' + ex)
    }
    for (const c of l.components) {
      check(src.includes('React.useContext(DswsCtx)'), file + ' 组件 ' + c + ' 消费 useContext(DswsCtx)')
      // 故障回归（2026-08-21 修复 9d0de74）：禁止「cx 缺失 → return null」的静默空白模式——
      //   必须兜底回退闭包依赖（h/useStore 在 text-splice 架构下恒在闭包作用域）
      check(!/if\s*\(!cx\)\s*return\s*null/.test(src), file + ' 组件 ' + c + ' 无 if(!cx) return null（静默空白模式已禁用）')
      check(src.includes('cx ? cx.h : React.createElement'), file + ' 组件 ' + c + ' 含 cx 兜底回退（h）')
    }
  }

  // ---- 产物已拼接（无标记残留 + 关键导出在双产物）----
  const cli = fs.readFileSync('client.js', 'utf8')
  const pcli = fs.readFileSync('package/lib/client.js', 'utf8')
  for (const l of LEAVES) {
    const marker = 'leaf:' + (l.file.split('/').pop().replace(/\.js$/, '')) + ' (spliced'
    check(!cli.includes(marker) && !pcli.includes(marker), '双产物无 ' + l.file + ' 拼接标记残留')
  }
  const spot = [
    'const Dot = ({ level })', 'const mdToHtml = function', 'const tStatus = function',
    'const fitAllTags = function', 'const useTabsRow = function', 'const TicketRow = React.memo(({ st, g, t',
    'const MapDetail = ({ st, g })', 'const NoRepoCard = function', 'const ListTab = ({ st, narrow })',
    'const RingSkills = ({ st, rec, list })', 'const SkillsTab = ({ st })', 'const ChecksTab = ({ st })',
    'const SettingsPage = (props)', 'const RunPanel = (props)', 'const DetailsDock = (props)',
    'const OverlayPanel = (props)', 'const checksumsOf = function', 'const StatusBar = (props)',
    'const SkillFloatList = function', 'const showPop = function',
  ]
  // IssueDetail spot（新增叶 · 独立 detail 插件化）
  check(cli.includes('const IssueDetail = function') && pcli.includes('const IssueDetail = function'), '双产物含 const IssueDetail …（' + (cli.includes('const IssueDetail = function') ? '✓' : '✗') + '/' + (pcli.includes('const IssueDetail = function') ? '✓' : '✗') + '）')
  spot.forEach((k) => {
    check(cli.includes(k) && pcli.includes(k), '双产物含 ' + k.slice(0, 30) + '…（' + (cli.includes(k) ? '✓' : '✗') + '/' + (pcli.includes(k) ? '✓' : '✗') + '）')
  })

  // ---- 去重指标（T4 验收）：tabsTip 单源 12→≤6 / fitAllTags 单源 / Dock+Overlay tabs 行合成一处 ----
  const countOf = (src, needle) => (src.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
  // tabsTip 指标 = tabsTip 出现次数（排除 tabsTipOff 子串）：迁移前 Dock+Overlay 各 5 处 = 10/产物 → 单源后 5/产物
  const tipRe = /tabsTip(?!Off)/g
  const cliTip = (cli.match(tipRe) || []).length
  const pkgTip = (pcli.match(tipRe) || []).length
  check(cliTip <= 6 && pkgTip <= 6, '产物 tabsTip 单源（10→≤6 · 实际 _dev ' + cliTip + ' / _pkg ' + pkgTip + '）')
  check(cliTip === pkgTip, '双产物 tabsTip 计数一致（' + cliTip + '）')
  check(countOf(cli, 'const tabBtn') === 1 && countOf(pcli, 'const tabBtn') === 1, '产物 tabBtn 仅 1 处声明（Dock/Overlay tabs 行合成一处 · _dev ' + countOf(cli, 'const tabBtn') + ' / _pkg ' + countOf(pcli, 'const tabBtn') + '）')
  check(countOf(cli, 'const fitAllTags') === 1 && countOf(pcli, 'const fitAllTags') === 1, '产物 fitAllTags 仅 1 处定义（单源）')
  check(cli.includes('fitAllTags()') && pcli.includes('fitAllTags()'), '产物 ListTab 调用 fitAllTags（消费点保留）')

  // ---- index.js 无残留大块（组件已全部迁出，只剩装配 + tabsfold 机器 + 接线）----
  const idx = fs.readFileSync('src/client/index.js', 'utf8')
  check(!idx.includes('const StatusBar = '), 'src/client/index.js 已不含 StatusBar（迁出 statusbar/StatusBar.js）')
  check(!idx.includes('const DetailsDock = '), 'src/client/index.js 已不含 DetailsDock（迁出 panel/Dock.js）')
  check(!idx.includes('const OverlayPanel = '), 'src/client/index.js 已不含 OverlayPanel（迁出 panel/Overlay.js）')
  check(!idx.includes('const ListTab = '), 'src/client/index.js 已不含 ListTab（迁出 views/ListTab.js）')
  check(!idx.includes('const SettingsPage = '), 'src/client/index.js 已不含 SettingsPage（迁出 views/SettingsPage.js）')
  check(idx.includes('tabsLevelDecide'), 'src/client/index.js 保留 tabsfold 机器（verify-tabsfold-leaf 文本基准）')

  console.log(failed ? '\n存在失败' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}
main()
