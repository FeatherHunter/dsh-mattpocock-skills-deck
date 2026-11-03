// tests/verify-1829-config-hooks.ts —— 门禁：#1829 阶段 4 配置页与钩子页按定稿原型重做（#1842）。
//
// 背景：#1842 把配置页与钩子页从「页内再画一遍标题、每组一行字」改成定稿原型（docs/prototype/vc-redesign
// 第 44、45 张）的结构：页头交给页面壳的 vcPageHeadNode；配置页分成「相关配置」「只读读取」两段，
// 相关配置的四组是折叠段（身份组展开且是唯一可写的一组，其余三组只读）；钩子页分成「钩子目录」「钩子清单」
// 「手动运行」三段，目录段是事实格，清单段每个文件一行，运行入口在行上，版本门挪到手动运行段。
// 版式换了，但既有 data-vc-config-* / data-vc-hooks-* 判据与能力编号一个都不能丢（verify-818 的 Z17 组守着语义）。
//
// 本门禁锁住七件事：
//   1) 配置页：根节点与两段分区、四个折叠组的顺序与 attr 标记，身份组可写、其余三组只读；
//   2) 配置页：身份旧值事实格、两条编辑行（值 / 作用域 / 保存 12.2 / 删除 12.3）、读数行与 12.7、12.8 两条只读查询；
//   3) 配置页：读失败的 err 标记、待办时动作全禁用、确认卡四段与结果条按失败原因查人话；
//   4) 钩子页：三段结构与顺序、目录段六个事实格、清单段三态与每个文件的示例 / 已启用 / 可执行标记；
//   5) 钩子页：运行入口只在清单行上（12.6，一行一个），2.36 版本门下不画按钮并给替代做法，确认卡与输出块；
//   6) 两页都不再自己画页头（不出现 vcs-page-title / vcs-page-lede / 老 header），也不画能力主入口标记；
//   7) 样式叶子给新类名都写了规则，规则仍以 [data-vc-shell] 开头、只用 --vcs-* 令牌，四档宽下不横向溢出。
//
// 手法与 verify-1829-page-head 一致：视图叶子按构建口径剥 export 装进 compileFn 求值；
// 跨叶符号用真身从参数注入（配置 / 钩子的数据函数从 vcConfigOps 真源装出来，规则常量读共享层）；
// 词表读生成物，不在这里抄文案。
//
// 门禁归属: src/client/views/versionControl/vcConfigPage.ts
// 门禁归属: src/client/views/versionControl/vcHooksPage.ts
// 门禁归属: src/client/views/versionControl/vcPageStyles.ts
//
// 用法（在插件根目录）：
//   node --import ./scripts/ts-hook.mts tests/verify-1829-config-hooks.ts
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileFn } from './lib/eval-probe.ts'
import { spliceableJs } from './lib/source-text.ts'
import { ensureLocaleData } from './lib/locale-data.ts'
import { printGateResult } from './lib/gate-result.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GATE = 'verify-1829-config-hooks'

let total = 0
let failed = 0
function check(ok: any, msg: string) {
  total += 1
  if (!ok) {
    failed += 1
    console.log('  FAIL ' + msg)
  }
}

/** 假 React：与 verify-1829-page-head 同一份形状；children 里的数组递归展平，空值丢掉。 */
function makeReact() {
  return {
    createElement: function (type: any, props: any) {
      const kids: any[] = []
      const walk = function (k: any) {
        if (Array.isArray(k)) { k.forEach(walk); return }
        if (k === null || k === undefined || k === false) return
        kids.push(k)
      }
      walk(Array.prototype.slice.call(arguments, 2))
      if (typeof type === 'function') return { type: type, props: props || {}, children: [type(props || {}, kids[0])] }
      return { type: type, props: props || {}, children: kids }
    },
    useContext: function () { return null },
    useState: function (init: any) { return [typeof init === 'function' ? init() : init, function () {}] },
    useRef: function (init: any) { return { current: init === undefined ? null : init } },
    useEffect: function () { return undefined },
  }
}

function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { node.forEach(function (n: any) { findAll(n, pred, out) }); return out }
  if (pred(node)) out.push(node)
  if (node.children !== undefined) findAll(node.children, pred, out)
  return out
}

function textOf(node: any): string {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object') return textOf(node.children)
  return ''
}

function kidsOf(node: any): any[] {
  return node && Array.isArray(node.children) ? node.children : []
}

function clsOf(node: any): string {
  return String((node && node.props && node.props.className) || '')
}

function classHas(node: any, name: string): boolean {
  return clsOf(node).split(/\s+/).indexOf(name) >= 0
}

function pick(root: any, cls: string): any {
  return findAll(root, function (n: any) { return classHas(n, cls) })[0]
}

function byAttr(root: any, attr: string): any[] {
  return findAll(root, function (n: any) { return n && n.props && n.props[attr] !== undefined })
}

function attrVals(root: any, attr: string): string[] {
  return byAttr(root, attr).map(function (n: any) { return String(n.props[attr]) })
}

function hasAnyData(root: any, prefix: string): boolean {
  return findAll(root, function (n: any) {
    if (!n || !n.props) return false
    return Object.keys(n.props).some(function (k) { return k.indexOf(prefix) === 0 })
  }).length > 0
}

async function main() {
  console.log('#1829 阶段 4 配置页与钩子页按定稿原型重做：两页分区结构、身份可写与三组只读、钩子行与版本门、空态失败态、样式类名')

  // 词表读生成物的真中文，与运行时同一个取词口径：查不到键就回键名本身，占位符按 {name} 替换。
  const localeRel = ensureLocaleData(ROOT)
  const locale: any = await import(pathToFileURL(path.join(ROOT, localeRel)).href)
  const zh = locale.LOCALE_COPY && locale.LOCALE_COPY.zh
  if (!zh) throw new Error('读不到生成物 ' + localeRel + ' 的中文词表（LOCALE_COPY.zh）')
  const trZh = function (key: string, params?: any) {
    let text = zh[key] !== undefined ? String(zh[key]) : String(key)
    Object.keys(params || {}).forEach(function (name: string) {
      text = text.split('{' + name + '}').join(String((params || {})[name]))
    })
    return text
  }

  // 跨叶符号用真身：规则常量与钩子版本门读共享层 config-rules，配置 / 钩子的数据函数从 vcConfigOps 真源装出来。
  const rules: any = await import(pathToFileURL(path.join(ROOT, 'src/shared/version-control/src/config-rules.ts')).href)
  const opsSrc = spliceableJs('src/client/views/versionControl/vcConfigOps.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const opsFactory = compileFn(
    ['CONFIG_GROUPS', 'CONFIG_IDENTITY_KEYS', 'configGroupOf', 'configNeedsConfirmOf', 'configHookRunStateOf'],
    opsSrc + '\nreturn { vcConfigStateNew: vcConfigStateNew, vcConfigApplyRead: vcConfigApplyRead, vcConfigApplyCheck: vcConfigApplyCheck, vcConfigApplyReply: vcConfigApplyReply, vcConfigReadStateOf: vcConfigReadStateOf, vcConfigIdentityRowsOf: vcConfigIdentityRowsOf, vcConfigGroupsOf: vcConfigGroupsOf, vcConfigGroupRowsOf: vcConfigGroupRowsOf, vcConfigEditOf: vcConfigEditOf, vcConfigSetInputOf: vcConfigSetInputOf, vcConfigUnsetInputOf: vcConfigUnsetInputOf, vcConfigConfirmOf: vcConfigConfirmOf, vcConfigConfirmTargetOf: vcConfigConfirmTargetOf, vcConfigFailKeyOf: vcConfigFailKeyOf, vcConfigResultOf: vcConfigResultOf, vcHooksApplyReply: vcHooksApplyReply, vcHookResultOf: vcHookResultOf, vcHookRowsOf: vcHookRowsOf, vcHooksDirOf: vcHooksDirOf, vcHooksReadStateOf: vcHooksReadStateOf, vcHookRunStateOf: vcHookRunStateOf, vcHookRunVisibleOf: vcHookRunVisibleOf, vcHookOutputOf: vcHookOutputOf };',
  )
  const ops: any = opsFactory(
    rules.CONFIG_GROUPS,
    rules.CONFIG_IDENTITY_KEYS,
    rules.configGroupOf,
    rules.configNeedsConfirmOf,
    rules.configHookRunStateOf,
  )

  const headLeaf: any = await import(pathToFileURL(path.join(ROOT, 'src/client/views/versionControl/vcPageHead.ts')).href)
  const shellLeaf: any = await import(pathToFileURL(path.join(ROOT, 'src/client/views/versionControl/vcShellPrimitives.ts')).href)
  // 样式叶子里读 MOTION（闭包里由 build 先拼 kernel:motion 片）；单文件 import 这个模块时没有闭包，
  // 得把同一份真源补到 globalThis 上，否则 declare 只是类型声明、运行时没有值。
  globalThis.MOTION = (await import(pathToFileURL(path.join(ROOT, 'src/client/kernel/motion.js')).href)).MOTION
  const styleMod: any = await import(pathToFileURL(path.join(ROOT, 'src/client/views/versionControl/vcPageStyles.ts')).href)
  const h = makeReact().createElement

  const configSrc = spliceableJs('src/client/views/versionControl/vcConfigPage.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const configLeaf: any = compileFn(
    ['CONFIG_GROUPS', 'vcConfigStateNew', 'vcConfigReadStateOf', 'vcConfigIdentityRowsOf', 'vcConfigGroupsOf', 'vcConfigGroupRowsOf', 'vcConfigEditOf', 'vcConfigSetInputOf', 'vcConfigUnsetInputOf', 'vcConfigConfirmOf', 'vcConfigConfirmTargetOf', 'vcConfigFailKeyOf', 'vcShellConfirmCardNode', 'vcPageSectionNode', 'vcPageFoldNode', 'vcPageFactGridNode'],
    configSrc + '\nreturn { vcConfigPageNode: vcConfigPageNode };',
  )(rules.CONFIG_GROUPS, ops.vcConfigStateNew, ops.vcConfigReadStateOf, ops.vcConfigIdentityRowsOf, ops.vcConfigGroupsOf, ops.vcConfigGroupRowsOf, ops.vcConfigEditOf, ops.vcConfigSetInputOf, ops.vcConfigUnsetInputOf, ops.vcConfigConfirmOf, ops.vcConfigConfirmTargetOf, ops.vcConfigFailKeyOf, shellLeaf.vcShellConfirmCardNode, headLeaf.vcPageSectionNode, headLeaf.vcPageFoldNode, headLeaf.vcPageFactGridNode)

  const hooksSrc = spliceableJs('src/client/views/versionControl/vcHooksPage.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const hooksLeaf: any = compileFn(
    ['vcConfigStateNew', 'vcHookRowsOf', 'vcHooksDirOf', 'vcHooksReadStateOf', 'vcHookRunStateOf', 'vcHookRunVisibleOf', 'vcHookOutputOf', 'vcConfigFailKeyOf', 'vcShellConfirmCardNode', 'vcPageSectionNode', 'vcPageFactGridNode', 'vcPageObjRowNode'],
    hooksSrc + '\nreturn { vcHooksPageNode: vcHooksPageNode };',
  )(ops.vcConfigStateNew, ops.vcHookRowsOf, ops.vcHooksDirOf, ops.vcHooksReadStateOf, ops.vcHookRunStateOf, ops.vcHookRunVisibleOf, ops.vcHookOutputOf, ops.vcConfigFailKeyOf, shellLeaf.vcShellConfirmCardNode, headLeaf.vcPageSectionNode, headLeaf.vcPageFactGridNode, headLeaf.vcPageObjRowNode)

  // 读配置成功时的回包：身份两键本仓库有值、这台机器名字没配、邮箱配了；三个只读组各有读数与空组。
  const readReply = function (over: any) {
    const base: any = {
      ok: true,
      readAtMs: 1700000000000,
      repoRoot: 'D:/w/repo',
      gitVersion: '2.49.0',
      hookRunVersion: { state: 'full' },
      configPath: 'D:/w/repo/.git/config',
      groups: [
        { key: 'user.name', value: 'FeatherHunter', scope: 'local' },
        { key: 'user.email', value: '975559549@qq.com', scope: 'local' },
        { key: 'core.autocrlf', value: 'true', scope: 'local' },
        { key: 'core.hooksPath', value: '.githooks', scope: 'global' },
      ],
      identity: { name: { local: 'FeatherHunter', global: null }, email: { local: '975559549@qq.com', global: 'machine@example.com' } },
      hooks: {
        dir: 'D:/w/repo/.git/hooks',
        configured: null,
        readable: true,
        entries: [
          { name: 'pre-commit', sample: false, executable: true, size: 100 },
          { name: 'pre-commit.sample', sample: true, executable: true, size: 100 },
          { name: 'post-merge', sample: false, executable: false, size: 100 },
        ],
        known: [],
      },
      attr: { state: 'ok', entries: [{ attr: 'text', value: 'auto' }, { attr: 'eol', value: 'lf' }] },
      mailmap: { state: 'ok', mapped: 'FeatherHunter <975559549@qq.com>' },
      entries: [],
    }
    return Object.assign(base, over || {})
  }
  const configState = ops.vcConfigApplyRead(ops.vcConfigStateNew(), readReply())
  const configPage = configLeaf.vcConfigPageNode(h, trZh, { state: configState, onConfig: function () {}, onConfigEdit: function () {} })
  const pageSections = findAll(configPage, function (n: any) { return n.type === 'section' && classHas(n, 'page-section') })

  // ===== A 配置页根节点：根 section 属性不变，两段分区，不再自己画页头 =====
  check(!!configPage && configPage.type === 'section' && clsOf(configPage) === 'vcs-config-page', 'A1 配置页根是 section.vcs-config-page（实得「' + clsOf(configPage) + '」）')
  check(configPage.props.id === 'vc-config-page' && configPage.props['data-vc-config-page'] === '1', 'A2 根节点保留 id=vc-config-page 与 data-vc-config-page=1（既有判据按它找页）')
  check(configPage.props['data-vc-config-read'] === 'ok', 'A3 根节点带读状态 data-vc-config-read=ok（实得 ' + String(configPage.props['data-vc-config-read']) + '）')
  check(configPage.props['data-vc-config-version'] === '2.49.0', 'A4 根节点带 git 版本 data-vc-config-version（实得 ' + String(configPage.props['data-vc-config-version']) + '）')
  check(configPage.props['data-vc-config-pending'] === '0', 'A5 空闲时 data-vc-config-pending=0')
  check(kidsOf(configPage).length === 3, 'A6 读成功且没有确认卡 / 结果条时根节点三段：元信息、相关配置、只读读取（实得 ' + kidsOf(configPage).length + ' 段）')
  check(findAll(configPage, function (n: any) { return classHas(n, 'vcs-page-title') || classHas(n, 'vcs-page-lede') || n.type === 'header' }).length === 0, 'A7 页面正文不再画标题 / 导语 / 老 header（页头由壳的 vcPageHeadNode 提供）')
  const meta = pick(configPage, 'vcs-config-meta')
  check(!!meta && meta.type === 'p', 'A8 第一段是 p.vcs-config-meta（配置文件与 git 版本）')
  const metaValues = findAll(configPage, function (n: any) { return classHas(n, 'vcs-config-meta-value') })
  check(attrVals(configPage, 'data-vc-config-path').join(',') === '1' && textOf(metaValues[0]) === 'D:/w/repo/.git/config', 'A9 元信息印配置文件路径（data-vc-config-path=1 + 真实路径，实得「' + textOf(metaValues[0]) + '」）')
  check(attrVals(configPage, 'data-vc-config-git-version').join(',') === '1' && textOf(metaValues[1]) === '2.49.0', 'A10 元信息印 git 版本（data-vc-config-git-version=1 + 2.49.0，实得「' + textOf(metaValues[1]) + '」）')
  check(pageSections.length === 2, 'A11 正文恰好两段分区：相关配置、只读读取（实得 ' + pageSections.length + ' 段）')

  // ===== B 相关配置段：标题 / 条数 / 说明来自词条，四组按共享层顺序画成折叠段 =====
  const related = pageSections[0]
  check(textOf(pick(related, 'section-title')) === trZh('vc.config.section.related'), 'B1 第一段标题是「相关配置」（实得「' + textOf(pick(related, 'section-title')) + '」）')
  check(textOf(pick(related, 'section-count')) === '8', 'B2 条数取共享层八个配置键（实得「' + textOf(pick(related, 'section-count')) + '」）')
  check(textOf(pick(related, 'section-note')) === trZh('vc.config.section.relatedNote'), 'B3 说明用 vc.config.section.relatedNote 的真中文')
  const folds = findAll(related, function (n: any) { return n.type === 'details' && n.props && n.props['data-vc-page-fold'] !== undefined })
  check(folds.length === 4, 'B4 相关配置画成四个折叠段（实得 ' + folds.length + ' 个）')
  check(attrVals(related, 'data-vc-page-fold').join(',') === 'identity,eol,hooksPath,credential', 'B5 折叠顺序与共享层一致：身份、行尾、钩子路径、凭据（实得 ' + attrVals(related, 'data-vc-page-fold').join(',') + '）')
  check(attrVals(related, 'data-vc-config-group').join(',') === 'identity,eol,hooksPath,credential', 'B6 每组带 data-vc-config-group=组 id（既有判据按它找组）')
  check(attrVals(related, 'data-vc-config-editable').join(',') === 'true,false,false,false', 'B7 只有身份组可写：data-vc-config-editable 顺序 true,false,false,false（实得 ' + attrVals(related, 'data-vc-config-editable').join(',') + '）')
  check(attrVals(related, 'data-vc-config-readonly').join(',') === '1,1,1', 'B8 三个只读组各带一次 data-vc-config-readonly=1（实得 ' + attrVals(related, 'data-vc-config-readonly').join(',') + '）')
  check(folds[0].props['data-vc-config-cap'] === '12.4' && folds.slice(1).every(function (f: any) { return f.props['data-vc-config-cap'] === undefined }) && attrVals(related, 'data-vc-config-cap').filter(function (v: string) { return v === '12.4' }).length === 1, 'B9 可写组标能力编号 12.4，且只标一次（实得 ' + attrVals(related, 'data-vc-config-cap').filter(function (v: string) { return v === '12.4' }).join(',') + '）')
  check(folds[0].props.open === 'open' && folds[1].props.open === undefined && folds[2].props.open === undefined && folds[3].props.open === undefined, 'B10 身份组默认展开，三个只读组默认收起')
  check(textOf(pick(folds[0], 'fold-title')) === trZh('vc.config.group.identity') && textOf(pick(folds[1], 'fold-title')) === trZh('vc.config.group.eol'), 'B11 折叠标题用 vc.config.group.<id> 的真中文')
  check(textOf(pick(folds[1], 'fold-note')) === trZh('vc.config.group.eol.note'), 'B12 折叠说明用 vc.config.group.<id>.note 的真中文（收起时也看得见这段在讲什么）')

  // ===== C 身份组：四格旧值事实 + 两条编辑行（值 / 作用域 / 保存 / 删除） =====
  const identityBody = pick(folds[0], 'fold-body')
  const idCells = findAll(identityBody, function (n: any) { return classHas(n, 'fact-cell') })
  check(idCells.length === 4, 'C1 身份组先画四格旧值：两个键的本仓库与这台机器（实得 ' + idCells.length + ' 格）')
  const scopeLocal = trZh('vc.config.scope.local')
  const scopeGlobal = trZh('vc.config.scope.global')
  const idKeys = idCells.map(function (c: any) { return textOf(c.children[0]) })
  check(idKeys.join('|') === ['user.name', 'user.email', 'user.name', 'user.email'].map(function (k: string, i: number) { return k + ' · ' + (i < 2 ? scopeLocal : scopeGlobal) }).join('|'), 'C2 四格顺序：本仓库的姓名与邮箱、这台机器的姓名与邮箱（实得 ' + idKeys.join('|') + '）')
  const idValues = idCells.map(function (c: any) { return textOf(c.children[1]) })
  check(idValues[0] === 'FeatherHunter' && idValues[1] === '975559549@qq.com', 'C3 本仓库两格照实印值（实得 ' + idValues.slice(0, 2).join(',') + '）')
  check(idValues[2] === trZh('vc.config.identity.never') && idValues[3] === 'machine@example.com', 'C4 没配的那一格明说「未配置」，不是空白（实得 ' + idValues[2] + '）')
  check(classHas(idCells[2].children[1], 'is-mono') && classHas(idCells[2].children[1], 'is-muted'), 'C5 旧值格用等宽 + 弱化，空值不抢眼（实得「' + clsOf(idCells[2].children[1]) + '」）')
  const idRows = byAttr(identityBody, 'data-vc-config-identity')
  check(idRows.length === 2 && idRows.map(function (n: any) { return n.props['data-vc-config-identity'] }).join(',') === 'user.name,user.email', 'C6 身份组有两条编辑行，顺序 user.name、user.email（实得 ' + idRows.map(function (n: any) { return n.props['data-vc-config-identity'] }).join(',') + '）')
  const oldSpans = byAttr(identityBody, 'data-vc-config-old')
  check(oldSpans.length === 2, 'C7 两条编辑行各印一次旧值（data-vc-config-old 恰好两个，实得 ' + oldSpans.length + ' 个）')
  const oldText = textOf(oldSpans[0])
  check(oldText === trZh('vc.config.identity.old', { local: 'FeatherHunter', global: trZh('vc.config.identity.never') }), 'C8 旧值句用 vc.config.identity.old 拼出本仓库与这台机器两个值（实得「' + oldText + '」）')
  check(attrVals(identityBody, 'data-vc-config-value').join(',') === 'user.name,user.email', 'C9 每条编辑行一个值输入框（data-vc-config-value 顺序与行一致）')
  check(attrVals(identityBody, 'data-vc-config-scope').join(',') === 'user.name,user.email', 'C10 每条编辑行一个作用域选择（data-vc-config-scope 顺序与行一致）')
  const scopeOptions = findAll(identityBody, function (n: any) { return n.type === 'option' })
  check(scopeOptions.length === 4 && textOf(scopeOptions[0]) === trZh('vc.config.identity.scope.local') && textOf(scopeOptions[1]) === trZh('vc.config.identity.scope.global'), 'C11 作用域选项写人话「只改本仓库 / 改这台机器」，不印 local / global（实得「' + textOf(scopeOptions[0]) + '」）')
  const setBtns = byAttr(identityBody, 'data-vc-config-op').filter(function (n: any) { return n.props['data-vc-config-op'] === 'config-set' })
  const unsetBtns = byAttr(identityBody, 'data-vc-config-op').filter(function (n: any) { return n.props['data-vc-config-op'] === 'config-unset' })
  check(setBtns.length === 2 && setBtns.every(function (n: any) { return n.props['data-vc-config-cap'] === '12.2' }), 'C12 两条保存按钮都标 12.2（实得 ' + setBtns.length + ' 个）')
  check(unsetBtns.length === 2 && unsetBtns.every(function (n: any) { return n.props['data-vc-config-cap'] === '12.3' && n.props['data-vc-config-danger'] === '1' }), 'C13 两条删除按钮都标 12.3 与危险标记（实得 ' + unsetBtns.length + ' 个）')
  check(unsetBtns.every(function (n: any) { return classHas(n, 'vcs-config-danger') }), 'C14 危险按钮另有样式类 vcs-config-danger（颜色由样式表按令牌给）')
  check(findAll(configPage, function (n: any) { return classHas(n, 'vcs-config-input') }).length === 4, 'C15 可写输入框只出现在身份组（2 条）与两条查询行（2 条），共 4 个（实得 ' + findAll(configPage, function (n: any) { return classHas(n, 'vcs-config-input') }).length + ' 个）')

  // ===== D 只读三组：只画事实格，行属性保留，空组明说未配置 =====
  const eolFacts = findAll(folds[1], function (n: any) { return classHas(n, 'fact-cell') })
  check(attrVals(folds[1], 'data-vc-config-row').join(',') === 'core.autocrlf' && attrVals(folds[1], 'data-vc-config-row-scope').join(',') === 'local', 'D1 行尾组按行画格：每格带 data-vc-config-row 与作用域（实得 ' + attrVals(folds[1], 'data-vc-config-row').join(',') + '）')
  check(textOf(eolFacts[0].children[1]) === 'true', 'D2 行尾组读数照实印（实得「' + textOf(eolFacts[0].children[1]) + '」）')
  const hookPathFacts = findAll(folds[2], function (n: any) { return classHas(n, 'fact-cell') })
  check(attrVals(folds[2], 'data-vc-config-row').join(',') === 'core.hooksPath' && attrVals(folds[2], 'data-vc-config-row-scope').join(',') === 'global', 'D3 钩子路径组的行带 core.hooksPath 与 global 作用域')
  check(hookPathFacts.length === 2 && textOf(hookPathFacts[1].children[0]) === trZh('vc.config.fact.defaultHooksDir') && textOf(hookPathFacts[1].children[1]) === trZh('vc.config.fact.defaultHooksDirValue'), 'D4 钩子路径组补一条「默认钩子目录」说明格（实得 ' + hookPathFacts.length + ' 格）')
  const credEmpty = byAttr(folds[3], 'data-vc-config-group-empty')
  check(credEmpty.length === 1 && textOf(credEmpty[0]) === trZh('vc.config.group.empty'), 'D5 凭据组没有读数时明说「用默认值」，不画空表（实得 ' + credEmpty.length + ' 个空态）')
  check(attrVals(configPage, 'data-vc-config-group-empty').length === 1, 'D6 整页只有一个空组标记（凭据组），空态不重复画（实得 ' + attrVals(configPage, 'data-vc-config-group-empty').length + ' 个）')
  check(findAll(folds[1], function (n: any) { return n.type === 'input' || n.type === 'select' || n.type === 'button' }).length === 0, 'D7 只读组里没有输入框 / 选择器 / 按钮（可写与只读在结构上分开）')
  check(classHas(folds[1], 'fold') && folds[1].props['data-vc-config-readonly'] === '1', 'D8 只读组是普通折叠段并带只读标记')

  // ===== E 只读读取段：读数行 + 12.7 属性规则 + 12.8 邮件映射，结果贴行内 =====
  const readonlySec = pageSections[1]
  check(textOf(pick(readonlySec, 'section-title')) === trZh('vc.config.section.readonly') && textOf(pick(readonlySec, 'section-count')) === '3', 'E1 第二段标题「只读读取」、条数 3（实得「' + textOf(pick(readonlySec, 'section-title')) + '」/「' + textOf(pick(readonlySec, 'section-count')) + '」）')
  check(textOf(pick(readonlySec, 'section-note')) === trZh('vc.config.section.readonlyNote'), 'E2 说明用 vc.config.section.readonlyNote 的真中文')
  check(kidsOf(readonlySec).length === 5, 'E3 段内五块：标题行、说明、读数行、属性规则、邮件映射（实得 ' + kidsOf(readonlySec).length + ' 块）')
  const readRow = pick(readonlySec, 'vcs-config-read-row')
  check(!!readRow && byAttr(readonlySec, 'data-vc-config-refresh').length === 1, 'E4 读数行有一个「重新读取」按钮（data-vc-config-refresh）')
  check(attrVals(readonlySec, 'data-vc-config-read').join(',') === 'ok' && textOf(pick(readonlySec, 'vcs-config-read-state')) === trZh('vc.config.read.ok'), 'E5 读数行印读成功（data-vc-config-read=ok，实得「' + textOf(pick(readonlySec, 'vcs-config-read-state')) + '」）')
  check(textOf(pick(readonlySec, 'vcs-config-read-label')) === trZh('vc.config.read.label'), 'E6 读数行标签用 vc.config.read.label 的真中文')
  const attrRow = byAttr(readonlySec, 'data-vc-config-attr')[0]
  const mailmapRow = byAttr(readonlySec, 'data-vc-config-mailmap')[0]
  check(!!attrRow && attrRow.props['data-vc-config-attr'] === '1' && !!mailmapRow && mailmapRow.props['data-vc-config-mailmap'] === '1', 'E7 属性规则与邮件映射各一行（data-vc-config-attr / data-vc-config-mailmap）')
  check(attrVals(attrRow, 'data-vc-config-cap').join(',') === '12.7' && attrVals(mailmapRow, 'data-vc-config-cap').join(',') === '12.8', 'E8 两行的查询按钮各标 12.7 与 12.8（实得 ' + attrVals(attrRow, 'data-vc-config-cap').join(',') + ' / ' + attrVals(mailmapRow, 'data-vc-config-cap').join(',') + '）')
  check(attrVals(attrRow, 'data-vc-config-attr-result')[0] === 'ok' && textOf(pick(attrRow, 'vcs-config-query-result')) === 'text=auto；eol=lf', 'E9 属性规则结果贴行内，按 key=value 原样印（实得「' + textOf(pick(attrRow, 'vcs-config-query-result')) + '」）')
  check(attrVals(mailmapRow, 'data-vc-config-mailmap-result')[0] === 'ok' && textOf(pick(mailmapRow, 'vcs-config-query-result')) === 'FeatherHunter <975559549@qq.com>', 'E10 邮件映射结果贴行内，映射后的地址原样印（实得「' + textOf(pick(mailmapRow, 'vcs-config-query-result')) + '」）')
  const attrNoneState = ops.vcConfigApplyRead(configState, readReply({ attr: { state: 'ok', entries: [] } }))
  const attrNonePage = configLeaf.vcConfigPageNode(h, trZh, { state: attrNoneState })
  check(textOf(pick(byAttr(attrNonePage, 'data-vc-config-attr')[0], 'vcs-config-query-result')) === trZh('vc.config.attr.none'), 'E11 查询没有命中时印「没有匹配到」而不是空白')

  // ===== F 读失败与待办态：标记两处、动作全禁用 =====
  const errState = ops.vcConfigApplyRead(configState, { ok: false, error: { kind: 'read' } })
  const errPage = configLeaf.vcConfigPageNode(h, trZh, { state: errState })
  check(errPage.props['data-vc-config-read'] === 'err' && attrVals(errPage, 'data-vc-config-read').join(',') === 'err,err', 'F1 读失败时页根与读数行两处都标 err（既有判据要求恰好两处，实得 ' + attrVals(errPage, 'data-vc-config-read').join(',') + '）')
  check(textOf(pick(errPage, 'vcs-config-read-err')) === trZh('vc.config.read.err', { kind: 'read' }), 'F2 读失败印带原因的人话（实得「' + textOf(pick(errPage, 'vcs-config-read-err')) + '」）')
  const pendingState = Object.assign({}, configState, { pending: true })
  const pendingPage = configLeaf.vcConfigPageNode(h, trZh, { state: pendingState })
  const actionBtns = findAll(pendingPage, function (n: any) {
    return n.type === 'button' && n.props && (n.props['data-vc-config-refresh'] !== undefined || n.props['data-vc-config-op'] !== undefined || n.props['data-vc-config-attr-go'] !== undefined || n.props['data-vc-config-mailmap-go'] !== undefined)
  })
  check(actionBtns.length === 7 && actionBtns.every(function (n: any) { return n.props.disabled === true }), 'F3 待办时七个写 / 读动作按钮全部禁用，不让连点（实得 ' + actionBtns.length + ' 个）')
  check(pendingPage.props['data-vc-config-pending'] === '1', 'F4 待办时根节点标 data-vc-config-pending=1')

  // ===== G 确认卡与结果条：删键要先确认，失败按原因码查人话 =====
  const checkState = ops.vcConfigApplyCheck(configState, { ok: true, op: 'config-unset', ticket: { id: 't-1' }, confirmRequired: true, confirm: { target: 'user.name' } })
  const confirmPage = configLeaf.vcConfigPageNode(h, trZh, { state: checkState })
  check(attrVals(confirmPage, 'data-vc-config-confirm').join(',') === 'user.name', 'G1 删键预检签票后出现确认卡，目标写 user.name（实得 ' + attrVals(confirmPage, 'data-vc-config-confirm').join(',') + '）')
  check(byAttr(confirmPage, 'data-vc-confirm-seg').length === 4 && byAttr(confirmPage, 'data-focus-default').length === 1, 'G2 确认卡四段齐全，默认焦点在取消（data-focus-default=cancel）')
  check(byAttr(confirmPage, 'data-vc-config-confirm-go').length === 1 && byAttr(confirmPage, 'data-vc-config-confirm-cancel').length === 1, 'G3 确认卡给出确认与取消两个入口')
  const okState = Object.assign({}, configState, { result: ops.vcConfigResultOf({ ok: true, op: 'read' }) })
  const okPage = configLeaf.vcConfigPageNode(h, trZh, { state: okState })
  check(attrVals(okPage, 'data-vc-config-result').join(',') === 'ok' && textOf(pick(okPage, 'vcs-config-result')) === trZh('vc.config.result.ok'), 'G4 成功结果条用 vc.config.result.ok 的真中文')
  const failState = Object.assign({}, configState, { result: ops.vcConfigResultOf({ ok: false, error: { kind: 'timeout', message: 'git config 超时' } }) })
  const failPage = configLeaf.vcConfigPageNode(h, trZh, { state: failState })
  check(attrVals(failPage, 'data-vc-config-result').join(',') === 'fail' && attrVals(failPage, 'data-vc-config-fail-kind').join(',') === 'timeout', 'G5 失败结果条标 fail 与原因码（data-vc-config-fail-kind）')
  check(textOf(pick(failPage, 'vcs-config-result')) === trZh('vc.config.fail.timeout', { reason: 'timeout', message: 'git config 超时' }), 'G6 失败印人话并带上 git 原话，不印裸原因码（实得「' + textOf(pick(failPage, 'vcs-config-result')).slice(0, 40) + '…」）')

  // ===== H 钩子页根节点：三段结构，不自己画页头 =====
  const hooksPage = hooksLeaf.vcHooksPageNode(h, trZh, { state: configState, onHooks: function () {}, onHooksEdit: function () {} })
  check(!!hooksPage && hooksPage.type === 'section' && hooksPage.props.id === 'vc-hooks-page' && hooksPage.props['data-vc-hooks-page'] === '1', 'H1 钩子页根是 section#vc-hooks-page 带 data-vc-hooks-page=1')
  check(hooksPage.props['data-vc-hooks-count'] === '3', 'H2 根节点带钩子文件数 data-vc-hooks-count=3（实得 ' + String(hooksPage.props['data-vc-hooks-count']) + '）')
  check(hooksPage.props['data-vc-hooks-version'] === '2.49.0' && hooksPage.props['data-vc-hooks-pending'] === '0', 'H3 根节点带 git 版本与待办标记')
  check(kidsOf(hooksPage).length === 3, 'H4 页面三段：钩子目录、钩子清单、手动运行（实得 ' + kidsOf(hooksPage).length + ' 段）')
  check(findAll(hooksPage, function (n: any) { return classHas(n, 'vcs-page-title') || classHas(n, 'vcs-page-lede') || n.type === 'header' }).length === 0, 'H5 钩子页不再自己画标题 / 导语 / 老 header')
  check(findAll(hooksPage, function (n: any) { return n.props && n.props['data-cap-primary'] !== undefined }).length === 0, 'H6 页面正文不画能力主入口标记（主入口归页面壳的能力清单）')

  // ===== I 钩子目录段：安装说明 + 六个事实格 =====
  const dirSec = kidsOf(hooksPage)[0]
  check(textOf(pick(dirSec, 'section-title')) === trZh('vc.hooks.section.dir') && textOf(pick(dirSec, 'section-note')) === trZh('vc.hooks.section.dirNote'), 'I1 第一段标题与说明用 vc.hooks.section.dir / dirNote 的真中文')
  const installNote = byAttr(dirSec, 'data-vc-hooks-install-note')
  check(installNote.length === 1 && textOf(installNote[0]) === trZh('vc.hooks.install.note'), 'I2 安装说明留在目录段最前（既有判据 data-vc-hooks-install-note）')
  const dirFacts = findAll(dirSec, function (n: any) { return classHas(n, 'fact-cell') })
  check(dirFacts.length === 6, 'I3 目录段六个事实格：钩子目录、core.hooksPath、已启用、示例、编辑方式、git 版本（实得 ' + dirFacts.length + ' 格）')
  check(attrVals(dirSec, 'data-vc-hooks-dir').join(',') === '1' && textOf(dirFacts[0].children[1]) === 'D:/w/repo/.git/hooks', 'I4 钩子目录一格带 data-vc-hooks-dir=1，值是真实目录（实得「' + textOf(dirFacts[0].children[1]) + '」）')
  check(textOf(dirFacts[1].children[1]) === trZh('vc.hooks.notConfigured'), 'I5 没配 core.hooksPath 时印「用默认目录」（实得「' + textOf(dirFacts[1].children[1]) + '」）')
  check(textOf(dirFacts[2].children[1]) === trZh('vc.hooks.countValue', { n: 2 }) && textOf(dirFacts[3].children[1]) === trZh('vc.hooks.countValue', { n: 1 }), 'I6 已启用 2 个、示例 1 个（示例不算已启用，实得 ' + textOf(dirFacts[2].children[1]) + ' / ' + textOf(dirFacts[3].children[1]) + '）')
  check(textOf(dirFacts[4].children[0]) === trZh('vc.hooks.fact.editor') && textOf(dirFacts[4].children[1]) === trZh('vc.hooks.fact.editorValue') && textOf(dirFacts[5].children[1]) === '2.49.0' && attrVals(dirSec, 'data-vc-hooks-version').join(',') === '1', 'I7 编辑方式明说交给外部编辑器，git 版本另有一格（data-vc-hooks-version=1）')

  // ===== J 钩子清单段：三态与每个文件一行 =====
  const listSec = kidsOf(hooksPage)[1]
  check(textOf(pick(listSec, 'section-title')) === trZh('vc.hooks.section.list') && textOf(pick(listSec, 'section-count')) === '3', 'J1 第二段标题「钩子清单」、条数 3（实得「' + textOf(pick(listSec, 'section-title')) + '」/「' + textOf(pick(listSec, 'section-count')) + '」）')
  check(textOf(pick(listSec, 'section-note')) === trZh('vc.hooks.section.listNote'), 'J2 说明用 vc.hooks.section.listNote 的真中文')
  check(attrVals(listSec, 'data-vc-hooks-list').join(',') === 'ok' && attrVals(listSec, 'data-vc-hooks-count').join(',') === '3', 'J3 清单容器标 ok 与条数（既有判据 data-vc-hooks-list=%s）')
  const hookRows = byAttr(listSec, 'data-vc-hook')
  check(hookRows.length === 3 && hookRows.map(function (n: any) { return n.props['data-vc-hook'] }).join(',') === 'pre-commit,pre-commit.sample,post-merge', 'J4 每个文件一行，顺序按文件名（实得 ' + hookRows.map(function (n: any) { return n.props['data-vc-hook'] }).join(',') + '）')
  check(hookRows.every(function (n: any) { return classHas(n, 'obj-row') }), 'J5 每行用对象行原语：左边名字与说明、右边运行入口')
  check(attrVals(listSec, 'data-vc-hook-sample').join(',') === '0,1,0', 'J6 每行标出是不是示例（data-vc-hook-sample 顺序 0,1,0，实得 ' + attrVals(listSec, 'data-vc-hook-sample').join(',') + '）')
  check(textOf(pick(hookRows[1], 'vcs-hook-note')) === trZh('vc.hooks.sample.note'), 'J7 示例行说明改名去掉 .sample 才会生效（实得「' + textOf(pick(hookRows[1], 'vcs-hook-note')) + '」）')
  check(textOf(pick(hookRows[0], 'vcs-hook-note')) === trZh('vc.hooks.executable.note'), 'J8 真钩子行说明它会在 git 动作前后被执行')
  check(attrVals(listSec, 'data-vc-hook-executable').join(',') === '0' && textOf(pick(listSec, 'vcs-hook-warn')) === trZh('vc.hooks.notExecutable'), 'J9 没可执行位的真钩子单独标出（data-vc-hook-executable=0，实得 ' + attrVals(listSec, 'data-vc-hook-executable').join(',') + '）')
  check(attrVals(listSec, 'data-vc-hook-run').join(',') === 'pre-commit,post-merge', 'J10 运行入口在行上：两个可跑钩子各一个按钮（实得 ' + attrVals(listSec, 'data-vc-hook-run').join(',') + '）')
  check(attrVals(listSec, 'data-vc-hooks-cap').join(',') === '12.6,12.6', 'J11 两个运行按钮都标 12.6，且只有行上这一处（实得 ' + attrVals(listSec, 'data-vc-hooks-cap').join(',') + '）')
  check(findAll(listSec, function (n: any) { return n.type === 'button' }).length === 2, 'J12 清单段一共两个按钮，没有第二套批量入口（实得 ' + findAll(listSec, function (n: any) { return n.type === 'button' }).length + ' 个）')

  // ===== K 手动运行段与版本门 =====
  const runSec = kidsOf(hooksPage)[2]
  check(textOf(pick(runSec, 'section-title')) === trZh('vc.hooks.section.run') && textOf(pick(runSec, 'vcs-hooks-run-note')) === trZh('vc.hooks.section.runNote'), 'K1 第三段「手动运行」带说明（实得「' + textOf(pick(runSec, 'vcs-hooks-run-note')) + '」）')
  check(findAll(runSec, function (n: any) { return n.type === 'button' }).length === 0, 'K2 手动运行段不重复画运行按钮（入口只在清单行上）')
  const lowReply = readReply({ gitVersion: '2.34.0', hookRunVersion: { state: 'hidden', needed: '2.36.0', alternativeKey: 'vc.hooks.gate.alternative' } })
  const lowState = ops.vcConfigApplyRead(ops.vcConfigStateNew(), lowReply)
  const lowPage = hooksLeaf.vcHooksPageNode(h, trZh, { state: lowState })
  check(attrVals(lowPage, 'data-vc-hook-run').length === 0, 'K3 git 低于 2.36 时一个运行按钮都不画（实得 ' + attrVals(lowPage, 'data-vc-hook-run').length + ' 个）')
  const lowGate = byAttr(lowPage, 'data-vc-hooks-gate')
  check(lowGate.length === 1 && lowGate[0].props['data-vc-hooks-gate'] === 'hidden', 'K4 低版本时画版本门 data-vc-hooks-gate=hidden')
  check(textOf(lowGate[0]).indexOf(trZh('vc.hooks.gate.hidden', { needed: '2.36.0' })) >= 0 && byAttr(lowPage, 'data-vc-hooks-gate-alternative').length === 1, 'K5 版本门说清需要 2.36.0 并给替代做法（隐藏不等于沉默）')
  const noRowsReply = readReply({ hooks: { dir: 'D:/w/repo/.git/hooks', configured: null, readable: true, entries: [], known: [] } })
  const emptyPage = hooksLeaf.vcHooksPageNode(h, trZh, { state: ops.vcConfigApplyRead(ops.vcConfigStateNew(), noRowsReply) })
  check(attrVals(emptyPage, 'data-vc-hooks-list').join(',') === 'empty' && textOf(pick(emptyPage, 'vcs-hooks-list-empty')) === trZh('vc.hooks.list.empty'), 'K6 空目录时清单段明说没有钩子（data-vc-hooks-list=empty）')
  check(emptyPage.props['data-vc-hooks-count'] === '0' && findAll(kidsOf(emptyPage)[1], function (n: any) { return classHas(n, 'section-count') }).length === 0, 'K7 空目录时页根条数 0，清单段不画数字（空清单不画「0 条」）')
  const errHooksState = ops.vcConfigApplyRead(ops.vcConfigStateNew(), { ok: false, error: { kind: 'read' } })
  const errHooksPage = hooksLeaf.vcHooksPageNode(h, trZh, { state: errHooksState })
  check(attrVals(errHooksPage, 'data-vc-hooks-list').join(',') === 'err' && textOf(pick(errHooksPage, 'vcs-hooks-list-err')) === trZh('vc.hooks.list.err', { kind: 'read' }), 'K8 读失败时清单段印失败原因（data-vc-hooks-list=err）')

  // ===== L 钩子确认卡与结果块 =====
  const hooksCheckState = ops.vcConfigApplyCheck(configState, { ok: true, op: 'hook-run', ticket: { id: 't-2' }, confirmRequired: true, confirm: { target: 'pre-commit' } })
  const hooksConfirmPage = hooksLeaf.vcHooksPageNode(h, trZh, { state: hooksCheckState })
  check(attrVals(hooksConfirmPage, 'data-vc-hooks-confirm').join(',') === 'pre-commit', 'L1 跑钩子预检签票后出现确认卡，目标写钩子名（实得 ' + attrVals(hooksConfirmPage, 'data-vc-hooks-confirm').join(',') + '）')
  check(byAttr(hooksConfirmPage, 'data-vc-confirm-seg').length === 4 && byAttr(hooksConfirmPage, 'data-focus-default').length === 1, 'L2 确认卡四段齐全，默认焦点在取消')
  check(byAttr(hooksConfirmPage, 'data-vc-hooks-confirm-go').length === 1 && byAttr(hooksConfirmPage, 'data-vc-hooks-confirm-cancel').length === 1, 'L3 确认卡给出确认与取消两个入口')
  const runOkState = ops.vcHooksApplyReply(configState, { ok: true, exitCode: 0, output: 'lint ok\n', hookFailed: true, truncated: true })
  const runOkPage = hooksLeaf.vcHooksPageNode(h, trZh, { state: runOkState })
  check(attrVals(runOkPage, 'data-vc-hooks-result').join(',') === 'ok' && attrVals(runOkPage, 'data-vc-hooks-hook-failed').length === 1, 'L4 钩子正常退出时结果块标 ok，钩子自己失败另有标记（data-vc-hooks-hook-failed）')
  check(attrVals(runOkPage, 'data-vc-hooks-output').join(',') === '1' && textOf(pick(runOkPage, 'vcs-hooks-output')) === 'lint ok\n' && attrVals(runOkPage, 'data-vc-hooks-output-truncated').length === 1, 'L5 输出原样印在 pre 里，截断另有提示')
  const runFailState = ops.vcHooksApplyReply(configState, { ok: false, error: { kind: 'timeout', message: '钩子超时' } })
  const runFailPage = hooksLeaf.vcHooksPageNode(h, trZh, { state: runFailState })
  check(attrVals(runFailPage, 'data-vc-hooks-result').join(',') === 'fail' && attrVals(runFailPage, 'data-vc-hooks-fail-kind').join(',') === 'timeout', 'L6 电话失败时结果块标 fail 与原因码')
  check(textOf(pick(runFailPage, 'vcs-hooks-result')) === trZh('vc.config.fail.timeout', { reason: 'timeout', message: '钩子超时' }), 'L7 失败印人话并带上游原话（实得「' + textOf(pick(runFailPage, 'vcs-hooks-result')).slice(0, 40) + '…」）')
  const hooksPendingPage = hooksLeaf.vcHooksPageNode(h, trZh, { state: Object.assign({}, configState, { pending: true }) })
  check(attrVals(hooksPendingPage, 'data-vc-hook-run').length === 2 && byAttr(hooksPendingPage, 'data-vc-hook-run').every(function (n: any) { return n.props.disabled === true }), 'L8 待办时运行按钮全部禁用，不让连点')

  // ===== M 两页互不串画 =====
  check(!hasAnyData(hooksPage, 'data-vc-config-'), 'M1 钩子页里没有配置页的 data-vc-config-*（两页不串画）')
  check(!hasAnyData(configPage, 'data-vc-hooks-'), 'M2 配置页里没有钩子页的 data-vc-hooks-*（两页不串画）')
  check(!hasAnyData(configPage, 'data-cap-primary') && !hasAnyData(hooksPage, 'data-cap-primary'), 'M3 两页正文都不画主入口标记（再读一遍：主入口归能力清单）')

  // ===== N 样式叶子：新类名都写了规则，仍守三条硬规矩 =====
  const styleText = String(styleMod.VC_PAGE_STYLE_TEXT || '')
  const frozen = [
    'vcs-config-meta', 'vcs-config-meta-key', 'vcs-config-meta-value', 'vcs-config-id-rows', 'vcs-config-id-row', 'vcs-config-id-head', 'vcs-config-id-key', 'vcs-config-old', 'vcs-config-id-controls',
    'vcs-config-input', 'vcs-config-select', 'vcs-config-btn', 'vcs-config-danger', 'vcs-config-group-empty', 'vcs-config-read-row', 'vcs-config-read-label', 'vcs-config-read-state', 'vcs-config-read-err',
    'vcs-config-query', 'vcs-config-query-label', 'vcs-config-query-result', 'vcs-config-result', 'vcs-config-result-fail', 'vcs-config-confirm-wrap', 'vcs-config-confirm-acts',
    'vcs-hooks-install-note', 'vcs-hooks-list', 'vcs-hook-name-row', 'vcs-hook-name', 'vcs-hook-chip', 'vcs-hook-note', 'vcs-hook-warn', 'vcs-hook-run-btn',
    'vcs-hooks-run-note', 'vcs-hooks-gate', 'vcs-hooks-result', 'vcs-hooks-result-fail', 'vcs-hooks-output', 'vcs-hooks-confirm-wrap', 'vcs-hooks-confirm-acts',
  ]
  const missing = frozen.filter(function (name: string) { return styleText.indexOf('.' + name) < 0 })
  check(missing.length === 0, 'N1 配置页与钩子页的新类名都在样式里（缺 ' + missing.join(',') + '）')
  const ruleLines = styleText.split('\n').map(function (s: string) { return s.trim() }).filter(function (s: string) { return s !== '' && s.indexOf('/*') !== 0 })
  check(ruleLines.length > 0 && ruleLines.every(function (s: string) { return s.indexOf('[data-vc-shell]') === 0 }), 'N2 每条规则都以 [data-vc-shell] 开头（实得 ' + ruleLines.length + ' 条）')
  check(ruleLines.every(function (s: string) { return s.charAt(s.length - 1) === '}' }), 'N3 每条规则都以右花括号收尾（没有半截规则）')
  check(!/#[0-9a-fA-F]{3,8}\b/.test(styleText) && !/rgba?\(/.test(styleText), 'N4 颜色只用 --vcs-* 令牌，没有硬编码色值（浅色皮肤只换令牌）')
  check(styleText.indexOf('[data-vc-width="380"] .vcs-config-id-controls .vcs-config-input{flex:1 1 100%}') >= 0, 'N5 380 宽时身份输入框独占一行')
  check(styleText.indexOf('[data-vc-width="300"] .vcs-config-id-controls .vcs-config-input{flex:1 1 100%}') >= 0, 'N6 300 宽时身份输入框独占一行')
  check(styleText.indexOf('[data-vc-width="300"] .vcs-hook-run-btn{width:100%}') >= 0, 'N7 300 宽时运行按钮占满整行（行内不横向溢出）')
  check(/\.vcs-config-meta-value\{[^}]*overflow-wrap:anywhere/.test(styleText) && /\.vcs-hook-name\{[^}]*overflow-wrap:anywhere/.test(styleText), 'N8 长路径与长文件名允许词内换行（四档宽都不横向溢出）')
  check(/\.vcs-hook-chip\.is-enabled\{[^}]*var\(--vcs-accent\)/.test(styleText) && /\.vcs-config-danger\{[^}]*var\(--vcs-danger\)/.test(styleText), 'N9 已启用标记与删除按钮各自用强调色 / 危险色令牌')
  check(styleText.indexOf('.vcs-hooks-output{') >= 0 && /\.vcs-hooks-output\{[^}]*overflow:auto/.test(styleText), 'N10 钩子输出块自身滚动，不把整页撑宽')

  console.log('\n共 ' + total + ' 条断言，失败 ' + failed + ' 条')
  if (failed > 0) console.log('存在失败（共 ' + total + ' 项）')
  else console.log('全部通过（共 ' + total + ' 项）')
  printGateResult(GATE, total, failed)
  if (failed > 0) process.exitCode = 1
}

main().catch(function (e: any) {
  console.log('  FAIL 门禁自身抛错：' + String((e && e.stack) || e))
  printGateResult(GATE, total, failed)
  process.exitCode = 1
})
