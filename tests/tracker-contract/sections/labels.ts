/**
 * tests/tracker-contract/sections/labels.ts — 标签配色契约段（#627）。
 *
 * 第一性原理：这两条操作（listLabels / setLabelColors）是「标签颜色可编辑」在契约层的全部接缝，
 * 界面只跟它们打交道、不知道底下是哪个后端。所以这一段**只断言它们答应的事有没有做到**：
 *   列表项的字段形状、颜色只有一种写法（不带井号的六位小写）、描述缺省合法、
 *   「全部标签」的语义（这个后端能改色的全部标签，且**取不全必须整体失败**，不许静默给残缺列表）、
 *   批量改色的逐条记账（部分成功必须能表达出来）、以及每一类失败落在哪一档。
 * 不锁实现细节：断言里不出现「用了哪条命令、参数怎么拼、文件叫什么名字」，以后换命令、换文件名、
 * 换解析方式，这一段都不该红（Markdown 假身里的「文件」只是一份内存数据，测试不碰真实路径）。
 *
 * 三个假身只活在测试里，各代表一种位置：
 *   unsupported-fake —— 没实现这两条操作的后端：注册表按 OPERATIONS 自动补桩，它必须诚实地说做不到，
 *                       不许假装能（走真注册表包一层，桩是自动补的，不是手写的）。
 *   github-fake      —— 仓库标签是真实数据：列表给仓库全量（含还没被任何票用到的），颜色读回来转小写。
 *   markdown-fake    —— 颜色住在工作区那个用户可手改的配色文件里：列表给「票面出现过的 ∪
 *                       配色文件里的 ∪ 内置默认那些」的并集，改色只改文件里已有的标签。
 *
 * 另外三段不是对着假身自说自话，而是对着真实的东西断言：
 *   一之二 · 真实 GitLab 后端模块：两条操作已由地图 10（#1062）真实现（2026-10-14 起）。这一段给一个
 *            脚本化的 glab，要求它拿到（假的）远端回话之后**做对**：两页拼出完整清单、颜色归一、
 *            逐条记账、空批次不发请求、重名整批拒掉、404 落「找不到」档。
 *   五     · 真实 GitHub 与本地 Markdown 后端模块（#627 二次整改 P1）：把两个真实模块注册进注册表真调用，
 *            要求它们**要么诚实地说做不到（unsupported），要么把这一条操作做到契约要求**（列表形状检查器
 *            与逐条记账检查器全过）。今天两个后端都还没实现这两条操作，所以走「诚实地说做不到」；
 *            下游一实现，这一段自动变成真验收，不用改测试。
 *   六     · 宿主那两条电话（src/host/workspaceCwd.js 的 wf.listLabels / wf.setLabelColors）：验回包信封
 *            形状与失败分档（真连不通才归 network；形状不对、抛异常、宿主自己的错一律归 env；
 *            没选定后端 / 多个后端同时命中 / 身份识别没定下来一律归 conflict）。
 *
 * 2026-10-15 返工（对抗式审查报告 research/1063-adversarial-review.md 的发现 1）：一之二原来只断言
 * 「失败得好看就算过」（`honestFailure(...) || batchBookkeeping(...)`）—— 把两条真实现换成一律
 * fail(env, '还没做') 的空壳，它照样绿。现在换成 `labelListAnswerCheck` / `labelBatchAnswerCheck`
 * 这两条正向判据（清单要真的全、记账要与脚本化的远端回话对得上），并各带「空壳必须被逮住」的 ✗ probe。
 *
 * 每段自带反例（✗ probe）：检查器是纯函数，把故意写错的样本喂给它，必须逮住；逮不住这一段就形同虚设。
 */

import { createRegistry } from '../../../src/tracker/registry/core.ts'
import { ERROR_KIND } from '../../../src/tracker/contract/vocabulary.ts'
import { gitlabBackend } from '../../../src/tracker/rooms/gitlab/index.ts'
import { githubModule } from '../../../src/tracker/rooms/github/index.ts'
import { markdownModule } from '../../../src/tracker/rooms/markdown/index.ts'
import { createWorkspaceCwd } from '../../../src/host/workspaceCwd.js'
import { createDetectionService } from '../../../src/tracker/detection/detectionService.ts'
import { decideBackend as decDecideBackend, selectionFromOutlet as decSelectionFromOutlet } from '../../../src/tracker/detection/backendDecision.ts'
import { createOutboundControl } from '../../../src/refresh/rooms/host/outbound-control.ts'
try { decDecideBackend.selectionFromOutlet = decSelectionFromOutlet } catch (eAttachDec) {}
import nodePath from 'node:path'
// #1138：夹具手里的「工作区文件」账本（虚拟目录，不碰盘）。这两件都在 tests/lib/deck-decide-stub.js，
// 与 verify-deck-tools.js 用的是同一份；以前夹具想说「这个工作区选过了」只能调 reg.bind，那个口子已经删了。
import { chooseWorkspace, workspaceFileOf } from '../../lib/deck-decide-stub.js'

const HEX6 = /^[0-9a-f]{6}$/
const KNOWN_KINDS = Object.values(ERROR_KIND)
const EXTRA_KEYS_HINT = '列表项只许有 name、color 与可选的 description 三个键（不许带「有多少张票在用」这类计数，也不带分组标记）'
/** 颜色归一（后端收到用户填的写法时用）：去掉井号、转小写。 */
const norm = (v) => String(v == null ? '' : v).trim().replace(/^#/, '').toLowerCase()

/** 列表检查器：返回违规清单（空 = 合规）。 */
export function labelListCheck(list): string[] {
  const bad = []
  if (!Array.isArray(list)) return ['列标签要返回一个数组（这次收到 ' + typeof list + '）']
  list.forEach((it, i) => {
    const at = '清单第 ' + (i + 1) + ' 项'
    if (!it || typeof it !== 'object' || Array.isArray(it)) { bad.push(at + ' 不是一项标签'); return }
    const keys = Object.keys(it).sort().join(',')
    if (keys !== 'color,name' && keys !== 'color,description,name') bad.push(at + ' 的键是 ' + keys + '，' + EXTRA_KEYS_HINT)
    if (typeof it.name !== 'string' || !it.name.trim()) bad.push(at + ' 的 name 要是非空字符串')
    if (typeof it.color !== 'string' || (it.color !== '' && !HEX6.test(it.color))) bad.push(at + ' 的 color 要么是不带井号的六位小写十六进制，要么是空串（还没配颜色），实得 ' + JSON.stringify(it.color))
    if ('description' in it && typeof it.description !== 'string') bad.push(at + ' 的 description 给了就必须是字符串')
  })
  return bad
}

/** 批量改色入参检查器：返回违规清单（空 = 合规）。
 *  只管形状：颜色的写法由后端校验（写不对这一条落解析档，不会让整批崩掉），所以这里不判六位十六进制。 */
export function labelChangeCheck(changes): string[] {
  const bad = []
  if (!Array.isArray(changes)) return ['批量改色要收一批「标签 → 新颜色」（changes 数组）']
  const seen = new Set()
  changes.forEach((c, i) => {
    const at = '第 ' + (i + 1) + ' 条改动'
    if (!c || typeof c !== 'object' || Array.isArray(c)) { bad.push(at + ' 不是一条改动'); return }
    const keys = Object.keys(c).sort().join(',')
    if (keys !== 'color,name') bad.push(at + ' 的键是 ' + keys + '，一条改动只许有 name 与 color 两个键')
    if (typeof c.name !== 'string' || !c.name.trim()) bad.push(at + ' 的 name 要是非空字符串')
    if (typeof c.color !== 'string' || !c.color.trim()) bad.push(at + ' 的 color 要是非空字符串（写法由后端校验），实得 ' + JSON.stringify(c.color))
    if (typeof c.name === 'string' && seen.has(c.name)) bad.push(at + ' 与前面重名（同一个标签名一批里只许出现一次）: ' + c.name)
    if (typeof c.name === 'string') seen.add(c.name)
  })
  return bad
}

/** 逐条记账检查器：拿入参那一批改动去核对返回，返回违规清单（空 = 合规）。 */
export function labelBatchCheck(changes, result): string[] {
  const bad = []
  if (!result || typeof result !== 'object' || Array.isArray(result)) return ['批量改色的返回要是 {applied, failed} 形状的对象']
  const keys = Object.keys(result).sort().join(',')
  if (keys !== 'applied,failed') bad.push('批量改色的返回只许有 applied 与 failed 两个键，实得 ' + keys)
  if (!Array.isArray(result.applied)) bad.push('applied 要是数组（没有成功的就给空数组，不许省略）')
  if (!Array.isArray(result.failed)) bad.push('failed 要是数组（全部成功也给空数组，不许省略）')
  if (bad.length) return bad
  const accounted = []
  result.applied.forEach((a, i) => {
    const at = 'applied 第 ' + (i + 1) + ' 项'
    if (!a || typeof a !== 'object') { bad.push(at + ' 不是对象'); return }
    if (Object.keys(a).sort().join(',') !== 'color,name') bad.push(at + ' 只许有 name 与 color 两个键')
    if (typeof a.name !== 'string' || !a.name) bad.push(at + ' 缺 name')
    if (typeof a.color !== 'string' || !HEX6.test(a.color)) bad.push(at + ' 的 color 是改完之后的最终颜色，必须是不带井号的六位小写十六进制，实得 ' + JSON.stringify(a.color))
    accounted.push(a && a.name)
  })
  result.failed.forEach((f, i) => {
    const at = 'failed 第 ' + (i + 1) + ' 项'
    if (!f || typeof f !== 'object') { bad.push(at + ' 不是对象'); return }
    if (Object.keys(f).sort().join(',') !== 'name,reason') bad.push(at + ' 只许有 name 与 reason 两个键')
    if (typeof f.name !== 'string' || !f.name) bad.push(at + ' 缺 name')
    if (!f.reason || typeof f.reason !== 'object') { bad.push(at + ' 缺 reason（要说清为什么没改成）'); return }
    // #1111：失败形状统一成 kind + message + raw 三段（raw 是后端原文，界面能展开看）。
    // 这里仍然只许这三个键 —— 形状不许再长第四段，也不许退回两段（退回两段界面上的「原始说明」永远是空的）。
    if (Object.keys(f.reason).sort().join(',') !== 'kind,message,raw') bad.push(at + ' 的 reason 必须是 kind、message、raw 三个键（复用既有错误形状，不新增第四段）')
    if (!KNOWN_KINDS.includes(f.reason.kind)) bad.push(at + ' 的 reason.kind 必须是既有错误分类之一，实得 ' + JSON.stringify(f.reason.kind))
    if (typeof f.reason.message !== 'string' || !f.reason.message.trim()) bad.push(at + ' 的 reason.message 要是能直接给用户看的一句话')
    if (typeof f.reason.raw !== 'string') bad.push(at + ' 的 reason.raw 必须是字符串（确实没有原文时给空串，不能缺、也不能是别的类型）')
    accounted.push(f.name)
  })
  // 逐条记账：入参里每一条改动必须恰好出现在 applied 或 failed 之一（不许漏，也不许两边都算）。
  for (const c of changes) {
    const n = accounted.filter((x) => x === c.name).length
    if (n !== 1) bad.push('改动 ' + JSON.stringify(c.name) + ' 没有被恰好记账一次（实得 ' + n + ' 次）')
  }
  if (accounted.length !== changes.length) bad.push('记账条数 ' + accounted.length + ' 与改动条数 ' + changes.length + ' 不一致')
  return bad
}

/** 「做不到」那一档的检查器：没实现的后端必须诚实地说做不到，不许假装能。 */
export function unsupportedAnswerCheck(opName, res): string[] {
  const bad = []
  if (!res || typeof res !== 'object') return [opName + ' 要返回 {ok:false, error:{kind, message}}']
  if (res.ok !== false) bad.push(opName + ' 没实现就该返回 ok:false，实得 ok=' + JSON.stringify(res.ok))
  const err = res.error
  if (!err || typeof err !== 'object') bad.push(opName + ' 要说清为什么做不到（error 对象）')
  else {
    if (err.kind !== 'unsupported') bad.push(opName + ' 的 error.kind 应为 unsupported，实得 ' + JSON.stringify(err.kind))
    if (typeof err.message !== 'string' || !err.message.includes(opName)) bad.push(opName + ' 的 error.message 里要点名是哪个操作做不到，实得 ' + JSON.stringify(err.message))
  }
  return bad
}

/** 沙箱拒绝那一档的检查器：必须是环境类，且说清是插件自己的限制，不指用户去查文件夹权限。 */
export function sandboxDenialCheck(reason): string[] {
  const bad = []
  if (!reason || typeof reason !== 'object') return ['沙箱拒绝要给 reason {kind, message}']
  if (reason.kind !== 'env') bad.push('沙箱拒绝属于环境类（kind 应为 env），实得 ' + JSON.stringify(reason.kind))
  const m = String(reason.message || '')
  if (!m.includes('插件自己的限制')) bad.push('沙箱拒绝的消息必须说清「这是插件自己的限制」，实得：' + m)
  if (!m.includes('不是你的文件权限问题')) bad.push('沙箱拒绝的消息必须说清「不是你的文件权限问题」，实得：' + m)
  if (m.includes('目录不可写')) bad.push('沙箱拒绝不许说成「目录不可写」，实得：' + m)
  return bad
}

/** 「全部标签」拿全了没有：拿已知的全量清单（这个后端能改色的全部标签名）去核对返回，返回违规清单。
 *  为什么要这条：列表项被钉死只有 name/color/description 三个键，没有位置能表示「这份清单被截断了」，
 *  所以残缺清单在界面上和全量一模一样——用户只会看到「标签凭空少了几个」。契约因此定死：
 *  取不全就必须整体失败（env 或 network 档），不许静默返回残缺列表（契约正文见 contract.js 的 listLabels）。
 *  expectedNames 是测试自己知道的那份全量（假身的数据是测试给的，所以测试知道全量是什么）。 */
export function labelCompletenessCheck(list, expectedNames): string[] {
  if (!Array.isArray(list)) return ['要核对「拿全了没有」，得先有一份标签清单（数组），这次收到 ' + typeof list]
  const bad = []
  const got = new Set(list.map((it) => (it && typeof it === 'object') ? it.name : undefined))
  for (const name of expectedNames) {
    if (!got.has(name)) bad.push('「' + name + '」是这个后端能改色的标签，却没出现在返回里——取不全就必须整体失败，不许静默返回残缺列表')
  }
  return bad
}

/** 「取不全就整体失败」那一档的检查器：整条操作失败，且说清是未能获取全部标签，档位只能是 env 或 network。 */
export function incompleteAnswerCheck(res, expectedNames): string[] {
  const bad = []
  if (!res || typeof res !== 'object') return ['取不全时要以 {ok:false, error:{kind, message}} 整体失败，实得 ' + JSON.stringify(res)]
  if (res.ok !== false) {
    // 没整体失败 → 那就得看它是不是真的给全了（把残缺当全量发出来，正是这条契约要消灭的行为）
    const miss = labelCompletenessCheck(res.data, expectedNames)
    return ['取不全时必须整体失败（不许退回残缺列表），实得 ok=' + JSON.stringify(res.ok)].concat(miss)
  }
  const err = res.error
  if (!err || typeof err !== 'object') return ['取不全时要给出 error 对象说清为什么', JSON.stringify(res)]
  if (err.kind !== 'env' && err.kind !== 'network') bad.push('取不全属于环境类（env）或连不通（network），实得 ' + JSON.stringify(err.kind))
  const m = String(err.message || '')
  if (!m.includes('未能获取全部标签')) bad.push('取不全的消息必须说清「未能获取全部标签」，实得：' + m)
  return bad
}

/** 真实后端探针的判据（#627 二次整改 P1）：要么诚实地说做不到（unsupported），要么把这一条做到契约要求。
 *  今天没实现这两条操作的真实后端走前一条；下游实现之后自动走后一条——测试不必改，红绿自动跟着变。 */
export function labelListProbeCheck(res): string[] {
  if (res && typeof res === 'object' && res.ok === false) return unsupportedAnswerCheck('listLabels', res)
  if (!res || res.ok !== true) return ['列出标签要么回 {ok:true, data:[...]}，要么诚实地回 {ok:false, error:{kind:unsupported,...}}，实得 ' + JSON.stringify(res)]
  return labelListCheck(res.data)
}

/** 同上，批量改色的探针判据：输入形状（labelChangeCheck）＋ 逐条记账（labelBatchCheck）。 */
export function labelBatchProbeCheck(changes, res): string[] {
  const bad = labelChangeCheck(changes)
  if (res && typeof res === 'object' && res.ok === false) return bad.concat(unsupportedAnswerCheck('setLabelColors', res))
  if (!res || res.ok !== true) return bad.concat(['批量改色要么回 {ok:true, data:{applied,failed}}，要么诚实地回 {ok:false, error:{kind:unsupported,...}}，实得 ' + JSON.stringify(res)])
  return bad.concat(labelBatchCheck(changes, res.data))
}

/**
 * 对着**真实现**的列标签探针判据（2026-10-15 返工新增）：必须真的给出完整清单。
 *
 * 为什么要有它：`labelListProbeCheck` 把「ok:false 且 kind=unsupported」也算合规 —— 那是给「这一条还是
 * 注册表补的桩」那个阶段写的；一之二那段更宽，只要「失败得好看」就放行。于是把真实现换成一律
 * `fail(env, '还没做')` 的空壳照样绿（对抗式审查的发现 1）。凡是对着真实现的探针，都要要求它做到
 * 契约要求的那件事，还要用测试自己知道的全量去核对「拿全了没有」。
 *
 * @param res 真实后端模块的返回
 * @param expectedNames 测试自己知道的那份全量（脚本化的回话给了哪些标签，测试就知道全量是什么）
 */
export function labelListAnswerCheck(res, expectedNames): string[] {
  if (!res || typeof res !== 'object' || res.ok !== true) {
    return ['列标签要真的拿到清单（{ok:true, data:[...]}），不许用「失败得好看」过关，实得 ' + JSON.stringify(res)]
  }
  return labelListCheck(res.data).concat(labelCompletenessCheck(res.data, expectedNames || []))
}

/**
 * 对着**真实现**的批量改色探针判据（2026-10-15 返工新增）：必须真的给出逐条记账，而且账目要与测试
 * 脚本化的远端回话对得上（哪几条该改成、哪几条该落哪一档）。
 *
 * 为什么光有 `labelBatchCheck` 不够：它只管「每一条改动恰好被记账一次」，不管记的是不是真话 ——
 * 「全部记成 env 失败」的空壳能过它。所以这里再用 `want` 核对两摞名单与失败档位。
 *
 * @param changes 这一批改动（入参，labelBatchCheck 用它核对记账）
 * @param res 真实后端模块的返回
 * @param want 期望的 `{applied, failed, kindOf}`：前两个是标签名清单，kindOf 是「某个名字该落哪一档」
 */
export function labelBatchAnswerCheck(changes, res, want): string[] {
  if (!res || typeof res !== 'object' || res.ok !== true) {
    return ['批量改色要真的给出逐条记账（{ok:true, data:{applied,failed}}），不许用「失败得好看」过关，实得 ' + JSON.stringify(res)]
  }
  const bad = labelBatchCheck(changes, res.data)
  if (bad.length) return bad
  const w = want || {}
  const sortedNames = (arr) => arr.map((x) => x.name).slice().sort()
  if (w.applied) {
    const got = sortedNames(res.data.applied)
    const exp = w.applied.slice().sort()
    if (got.join('|') !== exp.join('|')) bad.push('改成的应是 ' + JSON.stringify(exp) + '，实得 ' + JSON.stringify(got))
  }
  if (w.failed) {
    const got = sortedNames(res.data.failed)
    const exp = w.failed.slice().sort()
    if (got.join('|') !== exp.join('|')) bad.push('没改成的应是 ' + JSON.stringify(exp) + '，实得 ' + JSON.stringify(got))
  }
  if (w.kindOf) {
    for (const name of Object.keys(w.kindOf)) {
      const f = res.data.failed.find((x) => x.name === name)
      if (!f) bad.push('「' + name + '」该落在 failed 里（脚本化的远端回话让它失败），实得不在')
      else if (f.reason.kind !== w.kindOf[name]) bad.push('「' + name + '」的 reason.kind 应为 ' + w.kindOf[name] + '，实得 ' + JSON.stringify(f.reason.kind))
    }
  }
  return bad
}

// ── 三个假身（只活在测试里）──────────────────────────────────────────────────

/** 做不到的假身：create() 只给 list，两条新操作由注册表按 OPERATIONS 自动补桩。 */
export function createUnsupportedFake(id) {
  return {
    id: id || 'unsupported-fake',
    label: '做不到的假身',
    // 做不到的假身只验自动补桩行为，不断言额度，所以按离网口径声明。
    budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
    create: () => ({ list: async () => ({ ok: true, data: [] }) }),
    matches: async () => false,
  }
}

/** GitHub 假身：仓库标签是真实数据（含还没被任何票用到的），颜色读回来一律转小写。
 *  scripted 按标签名演某一条改动的失败（没权限、限速之类），用来验证失败分档。 */
export function createGithubFake(seed) {
  const repoLabels = (seed.labels || []).map((l) => ({ name: l.name, color: String(l.color == null ? '' : l.color), description: l.description }))
  const scripted = seed.scripted || {}
  return {
    id: 'github-fake',
    label: 'GitHub 假身',
    create: () => ({
      listLabels: async () => ({
        ok: true,
        data: repoLabels.map((l) => {
          const item = { name: l.name, color: norm(l.color) }
          if (l.description !== undefined) item.description = l.description
          return item
        }),
      }),
      setLabelColors: async (repo, changes) => {
        const applied = []
        const failed = []
        for (const c of changes) {
          const want = norm(c.color)
          if (!HEX6.test(want)) { failed.push({ name: c.name, reason: { kind: 'parse', message: '这个颜色填错了：要写成不带井号的六位十六进制，例如 9d7cd8', raw: '' } }); continue }
          if (scripted[c.name]) { failed.push({ name: c.name, reason: scripted[c.name] }); continue }
          const cur = repoLabels.find((l) => l.name === c.name)
          if (!cur) { failed.push({ name: c.name, reason: { kind: 'not-found', message: '这个仓库里没有名为「' + c.name + '」的标签，先确认名字再试', raw: '' } }); continue }
          cur.color = want
          applied.push({ name: c.name, color: want })
        }
        return { ok: true, data: { applied, failed } }
      },
    }),
    matches: async () => false,
    // GitHub 假身只演标签读写与失败分档，不断言额度，所以按离网口径声明。
    budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
    _repoLabels: repoLabels,
  }
}

/**
 * 本地 Markdown 假身：颜色住在工作区那个用户可手改的配色文件里。
 * seed 三部分对应契约里的三个来源：ticketLabels 票面出现过的、file 配色文件里的（名 → 颜色）、
 * builtins 内置默认那些；readable / busy / sandboxDenied / writeFails 四种开关演读写失败。
 */
export function createMarkdownFake(seed, id) {
  const file = Object.assign({}, seed.file || {})
  const state = { writes: 0 }
  function readProblem() {
    if (seed.busy === true) return { kind: 'env', message: '配色文件被别的程序占着，关掉那个程序再试一次（你的文件没有被改动）' }
    if (seed.readable === false) return { kind: 'parse', message: '工作区里的配色文件读不出来（内容不是合法的 JSON），请先手工修一下再试；插件不会覆盖你自己写的内容' }
    return null
  }
  return {
    id: id || 'markdown-fake',
    label: '本地 Markdown 假身',
    // 本地假身只读写工作区配色文件，不断言额度，所以按离网口径声明。
    budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
    create: () => ({
      listLabels: async () => {
        const problem = readProblem()
        if (problem) return { ok: false, error: problem }
        const out = new Map()
        for (const b of seed.builtins || []) out.set(b.name, { name: b.name, color: String(b.color == null ? '' : b.color), description: b.description })
        for (const n of seed.ticketLabels || []) if (!out.has(n)) out.set(n, { name: n, color: '' })
        for (const n of Object.keys(file)) out.set(n, { name: n, color: String(file[n] == null ? '' : file[n]), description: (out.get(n) || {}).description })
        return {
          ok: true,
          data: Array.from(out.values(), (v) => (v.description === undefined ? { name: v.name, color: v.color } : { name: v.name, color: v.color, description: v.description })),
        }
      },
      setLabelColors: async (repo, changes) => {
        const problem = readProblem()
        if (problem) return { ok: false, error: problem }
        if (seed.sandboxDenied === true) return { ok: false, error: { kind: 'env', message: '保存失败：插件没有被允许往这个工作区写文件。这是插件自己的限制，不是你的文件权限问题——去改文件夹权限不会有帮助。' } }
        if (seed.writeFails === true) { state.writes += 1; return { ok: false, error: { kind: 'env', message: '写配色文件的时候出错了，你的文件没有被改动（写坏的临时文件已经清掉）' } } }
        const applied = []
        const failed = []
        const pending = {}
        for (const c of changes) {
          const want = norm(c.color)
          if (!HEX6.test(want)) { failed.push({ name: c.name, reason: { kind: 'parse', message: '这个颜色填错了：要写成不带井号的六位十六进制，例如 9d7cd8', raw: '' } }); continue }
          if (!Object.prototype.hasOwnProperty.call(file, c.name)) { failed.push({ name: c.name, reason: { kind: 'not-found', message: '配色文件里没有「' + c.name + '」这一行，插件不会替你新增。想让这个标签能改色，先把 "名字": "颜色" 这一行加进配色文件再保存', raw: '' } }); continue }
          pending[c.name] = want
          applied.push({ name: c.name, color: want })
        }
        if (Object.keys(pending).length) { state.writes += 1; Object.assign(file, pending) }
        return { ok: true, data: { applied, failed } }
      },
    }),
    matches: async () => false,
    _file: file,
    _state: state,
  }
}

/** 取不全的假身（#627 二次整改 P3）：故意漏传翻页参数，只把第一页当全量交出去。
 *  这不是凭空想的场景 —— 本仓库真出过这个 bug：GitHub 列标签默认只回 30 条，漏传翻页就一直少一截。
 *  它回的信封完全合规（ok:true ＋ 数组 ＋ 每项三键），所以只有「跟已知的全量清单核对」才逮得住它。 */
export function createTruncatingFake(seed) {
  const all = (seed.all || []).map((n) => String(n))
  const pageSize = seed.serverPageSize || 30
  return {
    id: seed.id || 'truncating-fake',
    label: '取不全的假身',
    // 取不全的假身只验残缺判定，不断言额度，所以按离网口径声明。
    budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
    create: () => ({
      listLabels: async () => ({ ok: true, data: all.slice(0, pageSize).map((name) => ({ name: name, color: '0e8a16' })) }),
    }),
    matches: async () => false,
    _all: all,
  }
}

/** 诚实说「取不全」的假身：整条操作失败，并说清是未能获取全部标签。
 *  kind = 'env'（本机这边取不全，插件自身/环境问题）或 'network'（连不通、超时）。 */
export function createIncompleteFake(id, kind) {
  const k = kind === 'network' ? 'network' : 'env'
  return {
    id: id || 'incomplete-fake',
    label: '取不全就整体失败的假身',
    // 失败样本假身只演失败分档，不断言额度，所以按离网口径声明。
    budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
    create: () => ({
      listLabels: async () => ({
        ok: false,
        error: k === 'network'
          ? { kind: 'network', message: '未能获取全部标签：连 GitHub 的时候超时了，等一会儿或换个网络再试；你的仓库没有被改动' }
          : { kind: 'env', message: '未能获取全部标签：本机的 gh 版本不支持翻页，第 31 个之后的标签取不到。这是插件运行环境的问题，不是你的操作有误。' },
      }),
    }),
    matches: async () => false,
  }
}

export async function run() {
  const out = []
  const P = 'labels · '
  const assert = async (name, cond, detail) => {
    let ok = false
    try { ok = !!(await cond) } catch (e) { out.push({ name: P + name, ok: false, detail: String(e) }); return }
    out.push({ name: P + name, ok, detail: detail || '' })
  }
  const reg = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
  const ref = (backend) => ({ backend: backend, refId: backend === 'markdown' ? '/ws/fake' : 'acme/demo', name: 'demo', url: '' })
  const ctx = { cwd: '/ws/fake' }

  // ── 一、做不到的假身：注册表自动补桩，它必须诚实地说做不到 ──
  {
    const d = reg.register(createUnsupportedFake('unsupported-fake'))
    const tracker = reg.get('unsupported-fake')
    await assert('注册表包桩后两条新操作可调（不抛）', typeof tracker.listLabels === 'function' && typeof tracker.setLabelColors === 'function', 'Proxy 没按 OPERATIONS 补桩')
    const rl = await tracker.listLabels(ref('gitlab'), ctx)
    const rs = await tracker.setLabelColors(ref('gitlab'), [{ name: 'bug', color: '9d7cd8' }], ctx)
    await assert('做不到的假身：listLabels 诚实说做不到', unsupportedAnswerCheck('listLabels', rl).length === 0, unsupportedAnswerCheck('listLabels', rl).join('；') || JSON.stringify(rl))
    await assert('做不到的假身：setLabelColors 诚实说做不到', unsupportedAnswerCheck('setLabelColors', rs).length === 0, unsupportedAnswerCheck('setLabelColors', rs).join('；') || JSON.stringify(rs))
    await assert('✗ probe: 假装能用的回答被逮（列标签给空表）', unsupportedAnswerCheck('listLabels', { ok: true, data: [] }).length > 0, '检查器放过了「假装能」')
    await assert('✗ probe: 假装能用的回答被逮（改色报整体成功）', unsupportedAnswerCheck('setLabelColors', { ok: true, applied: [], failed: [] }).length > 0, '检查器放过了「假装能」')
    await assert('✗ probe: 说错了错误档也被逮', unsupportedAnswerCheck('listLabels', { ok: false, error: { kind: 'network', message: 'unsupported-fake does not implement op listLabels' } }).length > 0, '检查器放过了错误的 error.kind')
    d.dispose()
  }

  // ── 一之二、真实 GitLab 后端模块：给一个脚本化的 glab，要求它拿到回话之后做对 ──
  //   2026-10-14（地图 10 / #1062）这一房真实现了 listLabels 与 setLabelColors；2026-10-15 返工
  //   （对抗式审查报告 research/1063-adversarial-review.md 的发现 1）把这一段从「失败得好看就算过」
  //   改成正向行为断言。
  //   这一段的 ctx 与第五节 github/markdown 探针同一个形状：cwd、platform（resolveExecutable 认得 glab）、
  //   exec（脚本化的桩）、isEnabled 与 logEvent —— 有 exec 有 platform，glabClient 才走「真去做」那条路。
  {
    // 脚本化的 glab：按路径分派。GET /labels 按 page / per_page 切片（本房固定 per_page=100，所以只有
    // 第一页会满、第二页短）；PUT /labels/:name 按标签名决定这一条成还是败。
    const mkScriptedGlab = (opts) => {
      const o = opts || {}
      const calls = []
      const pages = o.pages || [[]]
      const exec = async (cmd, args) => {
        const line = (args || []).join(' ')
        calls.push(line)
        if (cmd !== 'glab') return { code: 1, stdout: '', stderr: 'probe 没脚本化这条命令: ' + cmd }
        const path = String((args && args[1]) || '')
        const q = path.indexOf('?') >= 0 ? new URLSearchParams(path.slice(path.indexOf('?') + 1)) : new URLSearchParams()
        if (path.indexOf('/labels?') >= 0) {
          const page = Number(q.get('page') || '1')
          if (o.listFailPage === page) return { code: 1, stdout: '', stderr: o.listFailText || 'glab: HTTP 404: Not Found' }
          return { code: 0, stdout: JSON.stringify(pages[page - 1] || []), stderr: '' }
        }
        const put = /\/labels\/([^?]*)$/.exec(path)
        if (put) {
          const name = decodeURIComponent(put[1])
          const verdict = (o.write && o.write[name]) || 'ok'
          if (verdict === 'ok') return { code: 0, stdout: '{}', stderr: '' }
          return { code: 1, stdout: '', stderr: verdict }
        }
        return { code: 1, stdout: '', stderr: 'probe 没脚本化这条命令: ' + line }
      }
      return { exec: exec, calls: calls }
    }
    const glProbeCtx = (s) => ({ cwd: '/ws/fake', platform: { resolveExecutable: async (n) => (n === 'glab' ? 'glab' : null) }, exec: s.exec, isEnabled: () => false, logEvent: () => {} })

    const d = reg.register(gitlabBackend)
    const tracker = reg.get('gitlab')
    const glRef = ref('gitlab')

    // ① 两页拼出完整清单：第一页取满 100、第二页 3 条（短页就是最后一页），而且只请求这两页
    const page1 = []
    for (let i = 1; i <= 100; i++) page1.push({ name: 'label-' + String(i).padStart(3, '0'), color: '#0E8A16' })
    const page2 = [
      { name: 'bug', color: '#D73A4A', description: "Something isn't working" },
      { name: 'wayfinder:grilling', color: '9d7cd8' },
      { name: 'unused-label', color: '' },
    ]
    const wantAll = page1.map((x) => x.name).concat(page2.map((x) => x.name))
    const s1 = mkScriptedGlab({ pages: [page1, page2] })
    const rl = await tracker.listLabels(glRef, glProbeCtx(s1))
    await assert('真实 gitlab 后端：两页拼出完整清单（100 + 3，一条不少、顺序照回包）', labelListAnswerCheck(rl, wantAll).length === 0 && rl.ok === true && rl.data.length === 103 && rl.data[102].name === 'unused-label', labelListAnswerCheck(rl, wantAll).join('；') || JSON.stringify(rl).slice(0, 240))
    await assert('真实 gitlab 后端：只请求了这两页（第二页是短页就收手，不多翻一页）', s1.calls.length === 2 && /[?&]page=1(&|$)/.test(s1.calls[0]) && /[?&]page=2(&|$)/.test(s1.calls[1]), JSON.stringify(s1.calls))
    await assert('真实 gitlab 后端：列表请求带上了 include_ancestor_groups=false（只列项目自己的标签，分组标签改不了色）与 per_page=100', /[?&]include_ancestor_groups=false(&|$)/.test(s1.calls[0]) && /[?&]per_page=100(&|$)/.test(s1.calls[0]), s1.calls[0])
    await assert('真实 gitlab 后端：颜色归一（带井号的 #D73A4A → d73a4a，不带井号的原样小写，给不出的写空串）', rl.ok === true && rl.data.some((l) => l.name === 'bug' && l.color === 'd73a4a') && rl.data.some((l) => l.name === 'wayfinder:grilling' && l.color === '9d7cd8') && rl.data.some((l) => l.name === 'unused-label' && l.color === ''), rl.ok === true ? JSON.stringify(rl.data.slice(100)) : JSON.stringify(rl))

    // ② 第二页失败 → 整体失败，不许把第一页那 100 条当全量交出去
    const s2 = mkScriptedGlab({ pages: [page1, page2], listFailPage: 2 })
    const rlBroken = await tracker.listLabels(glRef, glProbeCtx(s2))
    await assert('真实 gitlab 后端：第二页失败 → 整体失败，不许返回残缺清单（档位来自既有分类）', rlBroken.ok === false && rlBroken.error.kind === 'not-found' && rlBroken.data === undefined, JSON.stringify(rlBroken).slice(0, 240))

    // ③ 批量改色：全部成功 / 部分失败 / 全部失败，三种都要逐条记账
    const changes = [{ name: 'bug', color: '#9D7CD8' }, { name: 'wayfinder:grilling', color: '0e8a16' }]
    const s3 = mkScriptedGlab({})
    const rs = await tracker.setLabelColors(glRef, changes, glProbeCtx(s3))
    await assert('真实 gitlab 后端：全部成功时逐条记账（两条都改成了）', labelBatchAnswerCheck(changes, rs, { applied: ['bug', 'wayfinder:grilling'], failed: [] }).length === 0, labelBatchAnswerCheck(changes, rs, { applied: ['bug', 'wayfinder:grilling'], failed: [] }).join('；') || JSON.stringify(rs))
    await assert('真实 gitlab 后端：发出去的颜色参数带前导井号（GitLab 要求 #rrggbb）', s3.calls.length === 2 && s3.calls.every((c) => /-f color=#[0-9a-f]{6}/.test(c)), JSON.stringify(s3.calls))
    await assert('真实 gitlab 后端：走现行接口 PUT /projects/:id/labels/:label_id，只发 color 一个参数', s3.calls.every((c) => /\/labels\/(bug|wayfinder%3Agrilling) --method PUT -f color=#/.test(c)), JSON.stringify(s3.calls))

    const s4 = mkScriptedGlab({ write: { 'wayfinder:grilling': 'glab: HTTP 404: Not Found' } })
    const rsPartial = await tracker.setLabelColors(glRef, changes, glProbeCtx(s4))
    await assert('真实 gitlab 后端：部分成功逐条记账（一条改成、一条落 failed 且归「找不到」档）', labelBatchAnswerCheck(changes, rsPartial, { applied: ['bug'], failed: ['wayfinder:grilling'], kindOf: { 'wayfinder:grilling': 'not-found' } }).length === 0, labelBatchAnswerCheck(changes, rsPartial, { applied: ['bug'], failed: ['wayfinder:grilling'], kindOf: { 'wayfinder:grilling': 'not-found' } }).join('；') || JSON.stringify(rsPartial))

    const changesAllFail = [{ name: 'bug', color: '9d7cd8' }, { name: 'unused-label', color: '0e8a16' }]
    const s5 = mkScriptedGlab({ write: { bug: 'no token found for gitlab.com', 'unused-label': 'no token found for gitlab.com' } })
    const rsAllFail = await tracker.setLabelColors(glRef, changesAllFail, glProbeCtx(s5))
    await assert('真实 gitlab 后端：全部失败时也逐条记账（两条都落 failed、都归认证档）', labelBatchAnswerCheck(changesAllFail, rsAllFail, { applied: [], failed: ['bug', 'unused-label'], kindOf: { bug: 'auth', 'unused-label': 'auth' } }).length === 0, labelBatchAnswerCheck(changesAllFail, rsAllFail, { applied: [], failed: ['bug', 'unused-label'], kindOf: { bug: 'auth', 'unused-label': 'auth' } }).join('；') || JSON.stringify(rsAllFail))

    // ④ 空批次与重名：两种都不该发请求（用计数器证明「一个请求都没发」）
    const s6 = mkScriptedGlab({})
    const rsEmpty = await tracker.setLabelColors(glRef, [], glProbeCtx(s6))
    await assert('真实 gitlab 后端：空批次成功且一个请求都不发', rsEmpty.ok === true && rsEmpty.data.applied.length === 0 && rsEmpty.data.failed.length === 0 && s6.calls.length === 0, JSON.stringify(rsEmpty) + '；请求数 ' + s6.calls.length)
    const s7 = mkScriptedGlab({})
    const rsDup = await tracker.setLabelColors(glRef, [{ name: 'bug', color: '9d7cd8' }, { name: ' bug ', color: '0e8a16' }], glProbeCtx(s7))
    await assert('真实 gitlab 后端：同一批里重名（去掉首尾空白后逐字相同）→ 整批拒掉，一个请求都不发', rsDup.ok === false && rsDup.error.kind === 'parse' && s7.calls.length === 0, JSON.stringify(rsDup) + '；请求数 ' + s7.calls.length)
    const s8 = mkScriptedGlab({})
    const caseChanges = [{ name: 'Bug', color: '9d7cd8' }, { name: 'bug', color: '0e8a16' }]
    const rsCase = await tracker.setLabelColors(glRef, caseChanges, glProbeCtx(s8))
    await assert('真实 gitlab 后端：只差大小写的两个名字不算重名（GitLab 标签名区分大小写），两条都发出去', rsCase.ok === true && s8.calls.length === 2 && labelBatchAnswerCheck(caseChanges, rsCase, { applied: ['Bug', 'bug'], failed: [] }).length === 0, JSON.stringify(rsCase) + '；请求数 ' + s8.calls.length)

    await assert('真实 gitlab 后端：既有的列票操作不受影响（加操作没碰坏旧后端）', (await tracker.list(glRef, {}, ctx)) !== undefined, 'list 调用没拿到结果')

    // ✗ probe：这一段的新判据必须逮得住「一律返回失败」的空壳 —— 这正是 2026-10-15 返工要堵的洞。
    //   为什么要专门写这几条：原来这一段只看「ok:false、档位不是 unsupported、消息非空」，把两条真实现
    //   换成 `fail(env, '还没做')` 的空壳照样绿。判据放不放空壳过去，只能靠喂空壳来证明。
    const SHELL_LIST = { ok: false, error: { kind: 'env', message: 'listLabels 还没做' } }
    await assert('✗ probe: 「一律返回失败」的空壳回答过不了新的列标签判据', labelListAnswerCheck(SHELL_LIST, wantAll).length > 0, '判据给出的违规清单：' + JSON.stringify(labelListAnswerCheck(SHELL_LIST, wantAll)))
    await assert('✗ probe: 空壳改回一个合规的空清单也过不了（清单必须真的全）', labelListAnswerCheck({ ok: true, data: [] }, wantAll).length > 0, '判据给出的违规清单：' + JSON.stringify(labelListAnswerCheck({ ok: true, data: [] }, wantAll)))
    const SHELL_BATCH = { ok: true, data: { applied: [], failed: changes.map((c) => ({ name: c.name, reason: { kind: 'env', message: '还没做', raw: '' } })) } }
    await assert('✗ probe: 「逐条都记成 env 失败」的空壳过不了新的记账判据（形状全对、账目是假话）', labelBatchAnswerCheck(changes, SHELL_BATCH, { applied: ['bug', 'wayfinder:grilling'], failed: [] }).length > 0, '判据给出的违规清单：' + JSON.stringify(labelBatchAnswerCheck(changes, SHELL_BATCH, { applied: ['bug', 'wayfinder:grilling'], failed: [] })))
    await assert('✗ probe: 空壳记账连 raw 都缺时更过不了（形状这关就拦住）', labelBatchAnswerCheck([{ name: 'bug', color: '9d7cd8' }], { ok: true, data: { applied: [], failed: [{ name: 'bug', reason: { kind: 'env', message: '还没做' } }] } }, { applied: ['bug'], failed: [] }).length > 0, '判据给出的违规清单：' + JSON.stringify(labelBatchAnswerCheck([{ name: 'bug', color: '9d7cd8' }], { ok: true, data: { applied: [], failed: [{ name: 'bug', reason: { kind: 'env', message: '还没做' } }] } }, { applied: ['bug'], failed: [] })))
    await assert('✗ probe: 「一律返回失败」的空壳回答也过不了记账判据', labelBatchAnswerCheck(changes, { ok: false, error: { kind: 'env', message: 'setLabelColors 还没做' } }, { applied: ['bug', 'wayfinder:grilling'], failed: [] }).length > 0, '判据给出的违规清单：' + JSON.stringify(labelBatchAnswerCheck(changes, { ok: false, error: { kind: 'env', message: 'setLabelColors 还没做' } }, { applied: ['bug', 'wayfinder:grilling'], failed: [] })))
    d.dispose()
  }

  // ── 二、GitHub 假身 ──
  {
    const gh = createGithubFake({
      labels: [
        { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
        { name: 'wayfinder:grilling', color: '9D7CD8', description: 'Open decision/discussion ticket' },
        { name: 'unused-label', color: '0e8a16' },   // 还没被任何票用到（仓库全量语义的证据）
        { name: '带 空格 与:冒号', color: '1f6feb' },
      ],
      scripted: {
        '限速标签': { kind: 'rate-limit', message: 'GitHub 限速了，等一会儿再试' },
        '别人的标签': { kind: 'auth', message: '你没有这个仓库的写权限，找仓库管理员或换一个有权限的账号' },
      },
    })
    const d = reg.register(gh)
    const tracker = reg.get('github-fake')
    const rl = await tracker.listLabels(ref('github'), ctx)
    await assert('GitHub 假身：列表项字段形状合规（name＋color＋可选 description）', rl.ok === true && labelListCheck(rl.data).length === 0, rl.ok === true ? labelListCheck(rl.data).join('；') : JSON.stringify(rl))
    await assert('GitHub 假身：「全部标签」＝仓库全量（含还没被任何票用到的）', rl.ok === true && rl.data.some((l) => l.name === 'unused-label'), '清单里少了没被用到的那个标签')
    await assert('GitHub 假身：颜色统一成六位小写（仓库里存的是大写 9D7CD8）', rl.ok === true && rl.data.some((l) => l.name === 'wayfinder:grilling' && l.color === '9d7cd8'), '大写颜色没有转成小写')
    await assert('GitHub 假身：描述给不了就省略（没有描述的项不带 description 键）', rl.ok === true && rl.data.every((l) => l.name !== 'unused-label' || !('description' in l)), '给不了的描述被凭空补上了')
    await assert('GitHub 假身：名字里有冒号空格的标签照常列出', rl.ok === true && rl.data.some((l) => l.name === '带 空格 与:冒号'), '特殊写法的标签名被丢了')

    const changes = [{ name: 'bug', color: '0b7285' }, { name: '新配色写错了', color: '12345' }, { name: '不存在的标签', color: 'abcdef' }]
    await assert('GitHub 假身：改色入参形状合规（name＋color 两个键）', labelChangeCheck(changes).length === 0, labelChangeCheck(changes).join('；'))
    const rs = await tracker.setLabelColors(ref('github'), changes, ctx)
    await assert('GitHub 假身：批量改色逐条记账（形状与账目都合规）', rs.ok === true && labelBatchCheck(changes, rs.data).length === 0, rs.ok === true ? labelBatchCheck(changes, rs.data).join('；') : JSON.stringify(rs))
    await assert('GitHub 假身：部分成功可表达（一条改了、一条颜色填错、一条标签不存在）', rs.ok === true && rs.data.applied.length === 1 && rs.data.applied[0].name === 'bug' && rs.data.failed.length === 2, JSON.stringify(rs))
    const reasonKind = (r, n) => { const f = (r.ok === true && Array.isArray(r.data.failed)) ? r.data.failed.find((x) => x.name === n) : null; return f ? f.reason.kind : '(没找到)' }
    await assert('GitHub 假身：颜色填错落解析档（不是网络错误）', reasonKind(rs, '新配色写错了') === 'parse', '实得 ' + reasonKind(rs, '新配色写错了'))
    await assert('GitHub 假身：标签不存在落「找不到」档', reasonKind(rs, '不存在的标签') === 'not-found', '实得 ' + reasonKind(rs, '不存在的标签'))
    await assert('GitHub 假身：没有写权限落鉴权档', reasonKind(await tracker.setLabelColors(ref('github'), [{ name: '别人的标签', color: 'abcdef' }], ctx), '别人的标签') === 'auth', '权限失败没落在鉴权档')
    await assert('GitHub 假身：限速落限速档', reasonKind(await tracker.setLabelColors(ref('github'), [{ name: '限速标签', color: 'abcdef' }], ctx), '限速标签') === 'rate-limit', '限速没落在限速档')
    const rl2 = await tracker.listLabels(ref('github'), ctx)
    await assert('GitHub 假身：保存后重拉能读到新颜色（界面按真值刷新）', rl2.ok === true && rl2.data.some((l) => l.name === 'bug' && l.color === '0b7285'), '重拉拿到的还是旧颜色')
    const rsHash = await tracker.setLabelColors(ref('github'), [{ name: 'bug', color: '#0B7285' }], ctx)
    await assert('GitHub 假身：带井号大写的新颜色先归一再改（不把整批判成解析失败）', rsHash.ok === true && rsHash.data.applied.length === 1 && rsHash.data.applied[0].color === '0b7285', JSON.stringify(rsHash))
    d.dispose()

    // ✗ probe：故意写错的样本必须被逮住
    await assert('✗ probe: 颜色写成大写带井号被逮（穿出契约的颜色只有一种写法）', labelListCheck([{ name: 'bug', color: '#FF0000' }]).length > 0, '检查器放过了 #FF0000')
    await assert('✗ probe: 列表项多带「有多少张票在用」的计数被逮', labelListCheck([{ name: 'bug', color: 'd73a4a', ticketCount: 3 }]).length > 0, '检查器放过了多余字段')
    await assert('✗ probe: 列表不是数组被逮', labelListCheck({ labels: [] }).length > 0, '检查器放过了非数组')
    await assert('✗ probe: 描述给了非字符串被逮', labelListCheck([{ name: 'bug', color: 'd73a4a', description: 42 }]).length > 0, '检查器放过了非字符串描述')
    await assert('✗ probe: 只报整体成败的返回被逮', labelBatchCheck(changes, { ok: true }).length > 0, '检查器放过了整体成败')
    await assert('✗ probe: 漏记账（少一条改动）被逮', labelBatchCheck(changes, { applied: [{ name: 'bug', color: '0b7285' }], failed: [] }).length > 0, '检查器没发现有一条改动没被记账')
    await assert('✗ probe: 失败项缺 reason 被逮', labelBatchCheck(changes, { applied: [], failed: [{ name: 'bug' }, { name: '新配色写错了', reason: { kind: 'parse', message: 'x' } }, { name: '不存在的标签', reason: { kind: 'not-found', message: 'y' } }] }).length > 0, '检查器放过了缺 reason')
    await assert('✗ probe: 自造错误档被逮', labelBatchCheck(changes, { applied: [{ name: 'bug', color: '0b7285' }], failed: [{ name: '新配色写错了', reason: { kind: 'forbidden', message: 'x' } }, { name: '不存在的标签', reason: { kind: 'not-found', message: 'y' } }] }).length > 0, '检查器放过了自造的错误档')
    await assert('✗ probe: 同一标签记两次账被逮', labelBatchCheck(changes, { applied: [{ name: 'bug', color: '0b7285' }, { name: 'bug', color: '0b7285' }], failed: [{ name: '新配色写错了', reason: { kind: 'parse', message: 'x' } }] }).length > 0, '检查器放过了重复记账')
    await assert('✗ probe: 入参多带 description 被逮', labelChangeCheck([{ name: 'bug', color: '0b7285', description: 'x' }]).length > 0, '检查器放过了入参里的多余字段')
    await assert('✗ probe: 入参里同一标签出现两次被逮', labelChangeCheck([{ name: 'bug', color: '0b7285' }, { name: 'bug', color: 'abcdef' }]).length > 0, '检查器放过了重复的入参')
  }

  // ── 三、本地 Markdown 假身 ──
  {
    const md = createMarkdownFake({
      ticketLabels: ['bug', '只出现在票面上'],
      file: { bug: 'd73a4a', '只出现在配色文件里': 'abcdef' },
      builtins: [{ name: 'wayfinder:map', color: '8b5cf6', description: '地图票' }, { name: '只在内置默认里', color: '0e8a16' }],
    })
    const d = reg.register(md)
    const tracker = reg.get('markdown-fake')
    const rl = await tracker.listLabels(ref('markdown'), ctx)
    await assert('Markdown 假身：列表项字段形状合规', rl.ok === true && labelListCheck(rl.data).length === 0, rl.ok === true ? labelListCheck(rl.data).join('；') : JSON.stringify(rl))
    const find = (l, n) => (l.ok === true ? l.data.find((x) => x.name === n) : null)
    await assert('Markdown 假身：并集含票面出现过的标签', !!find(rl, '只出现在票面上'), '票面上的标签没进清单')
    await assert('Markdown 假身：并集含只在配色文件里的标签，颜色取文件里的', (find(rl, '只出现在配色文件里') || {}).color === 'abcdef', '配色文件里的标签没进清单或颜色不对')
    await assert('Markdown 假身：并集含内置默认那些（带描述）', (find(rl, 'wayfinder:map') || {}).description === '地图票', '内置默认的标签没进清单')
    await assert('Markdown 假身：没配颜色的标签用空串表示（界面显示为灰）', (find(rl, '只出现在票面上') || {}).color === '', '没配颜色的标签没有用空串表示')

    const okChanges = [{ name: 'bug', color: '0b7285' }]
    const rs = await tracker.setLabelColors(ref('markdown'), okChanges, ctx)
    await assert('Markdown 假身：改文件里已有的标签成功，逐条记账合规', rs.ok === true && labelBatchCheck(okChanges, rs.data).length === 0 && rs.data.applied.length === 1, JSON.stringify(rs))
    await assert('Markdown 假身：改完颜色落进那份配色文件', md._file.bug === '0b7285', '文件里还是旧颜色 ' + md._file.bug)
    await assert('Markdown 假身：重新列一次读到新颜色（保存后按真值刷新）', ((await tracker.listLabels(ref('markdown'), ctx)).data.find((l) => l.name === 'bug') || {}).color === '0b7285', '重拉拿到的还是旧颜色')

    const before = JSON.stringify(md._file)
    const notInFile = [{ name: '还没进配色文件的标签', color: 'abcdef' }]
    const rsMissing = await tracker.setLabelColors(ref('markdown'), notInFile, ctx)
    await assert('Markdown 假身：要改的标签不在配色文件里 → 找不到档', rsMissing.ok === true && labelBatchCheck(notInFile, rsMissing.data).length === 0 && rsMissing.data.failed[0].reason.kind === 'not-found', JSON.stringify(rsMissing))
    await assert('Markdown 假身：不新增一行（两边一律报不存在）', JSON.stringify(md._file) === before, '文件被偷偷加了一行')
    await assert('Markdown 假身：失败提示说清怎么才能成功', String((rsMissing.data.failed[0] || {}).reason ? rsMissing.data.failed[0].reason.message : '').includes('配色文件'), '提示没告诉用户怎么才能成功')
    d.dispose()

    const busy = createMarkdownFake({ file: { bug: 'd73a4a' }, busy: true }, 'markdown-busy')
    const dBusy = reg.register(busy)
    const rsBusy = await reg.get('markdown-busy').setLabelColors(ref('markdown'), okChanges, ctx)
    await assert('Markdown 假身：文件被别的程序占着 → 环境档，并说清关掉那个程序再试', rsBusy.ok === false && rsBusy.error.kind === 'env' && String(rsBusy.error.message).includes('占着'), JSON.stringify(rsBusy))
    await assert('✗ probe: 占用被误判成解析档会被逮（档位要对得上）', !(rsBusy.ok === false && rsBusy.error.kind === 'parse'), '占用被误判成解析档')
    dBusy.dispose()

    const sandbox = createMarkdownFake({ file: { bug: 'd73a4a' }, sandboxDenied: true }, 'markdown-sandbox')
    const dSand = reg.register(sandbox)
    const rsSand = await reg.get('markdown-sandbox').setLabelColors(ref('markdown'), okChanges, ctx)
    await assert('Markdown 假身：沙箱拒绝 → 环境档，且说清是插件自己的限制', rsSand.ok === false && sandboxDenialCheck(rsSand.error).length === 0, rsSand.ok === false ? sandboxDenialCheck(rsSand.error).join('；') : JSON.stringify(rsSand))
    await assert('Markdown 假身：沙箱拒绝时文件一个字节都没改', sandbox._file.bug === 'd73a4a', '沙箱拒绝却动了文件')
    await assert('✗ probe: 把沙箱拒绝说成「目录不可写」被逮', sandboxDenialCheck({ kind: 'env', message: '保存失败：目录不可写' }).length > 0, '检查器放过了「目录不可写」')
    await assert('✗ probe: 沙箱拒绝没说清「不是你的文件权限问题」被逮', sandboxDenialCheck({ kind: 'env', message: '保存失败：这是插件自己的限制' }).length > 0, '检查器放过了没交代清楚权限责任的文案')
    await assert('✗ probe: 沙箱拒绝被归到别的档也被逮', sandboxDenialCheck({ kind: 'network', message: '这是插件自己的限制，不是你的文件权限问题' }).length > 0, '检查器放过了错误的档位')
    dSand.dispose()

    const broken = createMarkdownFake({ file: { bug: 'd73a4a' }, readable: false }, 'markdown-broken')
    const dBroken = reg.register(broken)
    const trackerBroken = reg.get('markdown-broken')
    const rlBroken = await trackerBroken.listLabels(ref('markdown'), ctx)
    await assert('Markdown 假身：配色文件读不出来 → 解析档（不装作没有这个文件）', rlBroken.ok === false && rlBroken.error.kind === 'parse', JSON.stringify(rlBroken))
    const rsBroken = await trackerBroken.setLabelColors(ref('markdown'), okChanges, ctx)
    await assert('Markdown 假身：文件读不出来时一律不许写（不推平重写）', rsBroken.ok === false && broken._file.bug === 'd73a4a' && broken._state.writes === 0, '读不出来还写了文件')
    dBroken.dispose()

    const crashy = createMarkdownFake({ file: { bug: 'd73a4a' }, writeFails: true }, 'markdown-crashy')
    const dCrashy = reg.register(crashy)
    const rsCrashy = await reg.get('markdown-crashy').setLabelColors(ref('markdown'), okChanges, ctx)
    await assert('Markdown 假身：写的过程中出意外 → 环境档，且文件没有被改动', rsCrashy.ok === false && rsCrashy.error.kind === 'env' && crashy._file.bug === 'd73a4a', JSON.stringify(rsCrashy))
    dCrashy.dispose()
  }

  // ── 四、「全部标签」取不全就算整体失败（契约定死；#627 二次整改 P3）──
  {
    // 真出过的 bug 场景：这个后端一共有 40 个能改色的标签，但接口默认只回前 30 条。
    const all = Array.from({ length: 40 }, (_, i) => 'label-' + String(i + 1).padStart(2, '0'))
    const truncating = createTruncatingFake({ all: all, serverPageSize: 30 })
    const dTrunc = reg.register(truncating)
    const rlTrunc = await reg.get('truncating-fake').listLabels(ref('github'), ctx)
    await assert('残缺清单单看形状完全合规（40 个标签只回了 30 个，列表形状却挑不出毛病）', rlTrunc.ok === true && labelListCheck(rlTrunc.data).length === 0, rlTrunc.ok === true ? labelListCheck(rlTrunc.data).join('；') : JSON.stringify(rlTrunc))
    await assert('✗ probe: 返回残缺列表的桩被逮住（40 个只回 30 个不许过关）', labelCompletenessCheck(rlTrunc.data, all).length > 0, '检查器没发现清单被截断了')
    await assert('✗ probe: 拿全了不被冤枉（完整的 40 个不该被判残缺）', labelCompletenessCheck(all.map((n) => ({ name: n, color: '' })), all).length === 0, '检查器把完整的清单也判成了残缺')
    dTrunc.dispose()

    const incomplete = createIncompleteFake('incomplete-env', 'env')
    const dInc = reg.register(incomplete)
    const rsInc = await reg.get('incomplete-env').listLabels(ref('github'), ctx)
    await assert('取不全 → 整体失败落在环境档，并说清「未能获取全部标签」', incompleteAnswerCheck(rsInc, all).length === 0, incompleteAnswerCheck(rsInc, all).join('；') || JSON.stringify(rsInc))
    const partial = { ok: true, data: all.slice(0, 30).map((n) => ({ name: n, color: '' })) }
    await assert('✗ probe: 取不全却退回残缺列表被逮（静默少一截正是这条契约要消灭的）', incompleteAnswerCheck(partial, all).length > 0, '检查器放过了「退回残缺列表」')
    await assert('✗ probe: 取不全被归到解析档被逮（档位只能是 env 或 network）', incompleteAnswerCheck({ ok: false, error: { kind: 'parse', message: '未能获取全部标签：文件读了一半' } }, all).length > 0, '检查器放过了错误的档位')
    await assert('✗ probe: 取不全却没说清「未能获取全部标签」被逮', incompleteAnswerCheck({ ok: false, error: { kind: 'env', message: '读取失败' } }, all).length > 0, '检查器放过了说不清的文案')
    dInc.dispose()

    // network 档的正面样本：真连不通/超时导致取不全 —— 归 network 是对的
    const incompleteNet = createIncompleteFake('incomplete-network', 'network')
    const dIncNet = reg.register(incompleteNet)
    const rsIncNet = await reg.get('incomplete-network').listLabels(ref('github'), ctx)
    await assert('network 档正面样本：连不通导致取不全 → 整体失败归 network，且说清未能获取全部标签', rsIncNet.ok === false && rsIncNet.error.kind === 'network' && incompleteAnswerCheck(rsIncNet, all).length === 0, incompleteAnswerCheck(rsIncNet, all).join('；') || JSON.stringify(rsIncNet))
    dIncNet.dispose()
  }

  // ── 五、真实后端模块探针（#627 二次整改 P1；#620 给 GitHub 一路配了外部命令）──
  // 这一段的判据始终是「要么诚实地说做不到（unsupported），要么把这一条操作做到契约要求」：
  //   GitHub 与本地 Markdown 两个真实后端都还没实现这两条操作时，注册表按 OPERATIONS 自动补桩，
  //   它们只能诚实地回「做不到」；一实现，同样这一段自动变成真验收（列表形状与逐条记账检查器全过）。
  // 为什么要有这一段：前面三段测的都是测试自带的假身，真实后端模块一次都没被调用；
  //   没有这一段，下游把颜色返回成大写、列表项多带键、failed 省略、只回整体成败，契约测试照样绿。
  //
  // #620 在这里补的一件事：**给 GitHub 一路配一个脚本化的 gh**。
  //   理由是这一段自己要求的两种答案里有一种是「把操作做到契约要求」，而 GitHub 的两个操作要跑外部命令
  //   （gh）：上下文里没有执行器时它只能如实回「本机缺工具」（env）——那不是「做不到」，拿 env 去比
  //   unsupported 会当场冤枉一个诚实的实现（#620 实测踩到：620 passed / 4 failed 变成 619 passed / 5 failed）。
  //   配上之后，这一段仍然是真验收：检查器检查的是**真实模块的输出**，不是假身的输出。
  //   判据一个字没放宽，只是让「真去做」这条路走得通。
  //
  // #620 整改补的一句（免得只跑契约测试的人以为这里管得多）：这一段只验「列表形状 + 逐条记账」，
  //   **404 那一档（标签不存在 / 仓库不存在 / 没有写权限 三选一）走不到这里来** —— 它要撞的是一次
  //   真的 404 响应，而这里的 gh 是脚本化的、只回成功。404 的分档与「撞到 404 多问一次仓库权限」
  //   由 `tests/verify-github-label-colors.ts` 守（那一份用假数据把八档各演一遍）。
  {
    // 脚本化的仓库：三条标签，其中两条的颜色在 GitHub 上存的是大写（真实仓库里就有这种，见 #612 第 5.2 节）。
    const GH_LABELS = [
      { name: 'bug', color: 'D73A4A', description: "Something isn't working" },
      { name: 'wayfinder:grilling', color: '9D7CD8', description: 'Open decision/discussion ticket' },
      { name: 'unused-label', color: '0E8A16' }, // 还没被任何票用到：仓库全量语义的证据
    ]
    const scriptedGh = async (cmd, args) => {
      const a = (args || []).join(' ')
      if (a.startsWith('label list ')) return { code: 0, stdout: JSON.stringify(GH_LABELS), stderr: '' }
      if (a.startsWith('label edit ')) return { code: 0, stdout: '', stderr: '' }
      return { code: 1, stdout: '', stderr: 'probe 没脚本化这条命令: ' + a }
    }
    const probeCtx = {
      // 本地 Markdown：没有文件服务时照内置调色盘回答（#618 的实现），不需要外部命令
      markdown: ctx,
      // GitHub：给它一个能跑的外部命令（gh），否则它只能报「本机缺工具」
      github: Object.assign({}, ctx, {
        // #1159 起房间要求宿主注入出站控制面（ctx.outbound）；夹具自带生产那一份（只做转发），
        // 否则脚本化的 gh 连被调用的机会都没有（与 sections/counts.js 同一套做法，#1197）。
        outbound: createOutboundControl(),
        platform: { resolveExecutable: async (n) => (n === 'gh' ? 'gh' : null) },
        exec: scriptedGh,
      }),
    }
    const realBackends = [
      { id: 'github', mod: githubModule },
      { id: 'markdown', mod: markdownModule },
    ]
    const probeChanges = [{ name: 'bug', color: '9d7cd8' }]
    for (const rb of realBackends) {
      const rbCtx = probeCtx[rb.id] || ctx
      const regReal = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
      const d = regReal.register(rb.mod)
      const realTracker = regReal.get(rb.id)
      const rl = await realTracker.listLabels(ref(rb.id), rbCtx)
      const badge = labelListProbeCheck(rl)
      await assert('真实 ' + rb.id + ' 后端：列出标签「诚实说做不到 或 形状检查器全过」', badge.length === 0, badge.join('；') || JSON.stringify(rl))
      // 真的给出了清单时，再加一条：这份清单必须是全量（取不全就必须整体失败，不许静默少一截）。
      //   只在测试自己知道「全量是什么」的那一路核对（GitHub 的标签是脚本给的；Markdown 的并集语义由它自己的门禁守）。
      if (rb.id === 'github' && rl && rl.ok === true) {
        const full = GH_LABELS.map((l) => l.name)
        const miss = labelCompletenessCheck(rl.data, full)
        await assert('真实 github 后端：清单是全量（含没被任何票用到的那个标签，也不许少一条）', miss.length === 0, miss.join('；') || JSON.stringify(rl))
      }
      const rs = await realTracker.setLabelColors(ref(rb.id), probeChanges, rbCtx)
      const badge2 = labelBatchProbeCheck(probeChanges, rs)
      await assert('真实 ' + rb.id + ' 后端：批量改色「诚实说做不到 或 记账检查器全过」', badge2.length === 0, badge2.join('；') || JSON.stringify(rs))
      d.dispose()
    }
    // ✗ probe：探针判据本身要逮得住「既不诚实、也没做到契约」的回答（否则这一段等于没写）
    await assert('✗ probe: 真实后端把颜色回成大写被逮（穿出契约的颜色只有一种写法）', labelListProbeCheck({ ok: true, data: [{ name: 'bug', color: '#D73A4A' }] }).length > 0, '探针放过了大写带井号的颜色')
    await assert('✗ probe: 真实后端只回整体成败被逮（部分成功必须能表达）', labelBatchProbeCheck(probeChanges, { ok: true, data: { ok: true } }).length > 0, '探针放过了只报整体成败的返回')
    await assert('✗ probe: 真实后端省略 failed 被逮', labelBatchProbeCheck(probeChanges, { ok: true, data: { applied: [{ name: 'bug', color: '9d7cd8' }] } }).length > 0, '探针放过了省略 failed 的返回')
    await assert('✗ probe: 真实后端说做不到却用了别的档被逮', labelListProbeCheck({ ok: false, error: { kind: 'network', message: 'backend github does not implement op listLabels' } }).length > 0, '探针放过了错误的 error.kind')
  }

  // ── 六、宿主那两条电话（信封形状与失败分档；#627 二次整改 P4、P5、P9）──
  // 前面几段都对着后端房间说话；这一段往上一层，验宿主把后端的回答转成给客户端的回包时的样子：
  //   成功的回包只有契约约定的那几个键（后端多给的字段不许漏出去），失败按四档分清楚 ——
  //   真连不通才归 network；形状不对、抛异常、宿主自己出错一律归 env（说清是插件运行环境的问题，不是用户操作有误）；
  //   没选定后端 / 多个后端同时命中 / 身份识别没定下来一律归 conflict（先选定后端再试）。
  {
    const HOST_CWD = '/ws/fake'
    const keysOf = (o) => Object.keys(o).sort().join(',')
    // 文案判据：说清责任在插件运行环境这一侧（宿主模板原话「这是插件运行环境的问题，不是你的操作有误。」，
    //   两句话必须都在），别让用户去翻自己的操作找原因
    const blameOk = (m) => { const s = String(m == null ? '' : m); return s.includes('插件运行环境的问题') && s.includes('不是你的操作有误') }
    const mkReg = () => createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
    /**
     * #1138：判定出口读「这个工作区选了谁」那一路要用的最小文件服务。
     *
     * 为什么夹具必须给这一份：人选的唯一真源是工作区文件 docs/agents/workspace.yaml，而生产里读它的是
     * 判定出口自己的 deps.fs 分支（src/tracker/detection/backendDecision.ts 的 readFileLayer：resolve 出
     * 路径、readText 读文本、再交给 parseWorkspaceFile）。桩上的账本（chooseWorkspace）只记了「这份文件
     * 写了什么」，没有「谁去读它」；所以这一份把两者接起来——这就是生产那条路的最小形态，
     * 不是另写一套判定规则（判定仍由生产那一个出口做）。
     *
     * 为什么以前不用给：以前「这个工作区选过了」记在注册表的进程内绑定表里，宿主直接问注册表就能拿到；
     * 那份表已经删了（见 src/tracker/registry/core.ts 文件头），所以夹具也要改成给文件。
     */
    const workspaceFs = {
      resolve: async (rel, opts) => ({ cwd: (opts && opts.cwd) || '', rel: String(rel) }),
      readText: async (target) => {
        const rel = String((target && target.rel) || '')
        // 账本的钥匙是「工作区目录」，不是「某一条文件路径」（chooseWorkspace(cwd, id) 记的就是这个工作区）。
        // 判定出口按顺序来问新旧两条路径（新 docs/agents/workspace.yaml 优先、老 json 兼容读），
        // 所以这里按「问的是不是工作区文件那两张脸」作答，别的路径一律说没有。
        const text = (rel === 'docs/agents/workspace.yaml' || rel === 'docs/agents/workspace.json')
          ? workspaceFileOf((target && target.cwd) || '')
          : null
        if (text == null) throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
        return text
      },
    }
    // 造一个宿主实例：deps 全部现场给，不碰真实平台与真实注册表
    const mkHost = (reg) => {
      const events = []
      const execVias = []
      const hostPlatform = { path: nodePath.posix, getHome: async () => '/home/u', fs: workspaceFs }
      const detectionExec = async (cmd, args, opts, via) => { execVias.push(via); return { ok: true, stdout: '假身输出' } }
      const host = createWorkspaceCwd({
        ctx: { get: () => undefined },
        DEFAULT_CWD: HOST_CWD,
        getPlatform: async () => hostPlatform,
        getTrackerRegistry: async () => reg,
        getWorkspaceStore: async () => ({ invalidate: () => {} }),
        getDecisionFn: async () => ({ decideBackend: decDecideBackend }),
        // #1131：这两条电话的判定取数改走带缓存的探测服务，夹具照生产的接法把服务给上：
        //   同一个注册表、同一份平台与文件服务，出口是同一份统一判定函数。这一组验的是回包形状与失败分档、
        //   不验缓存，所以工作区缓存给 null（每次调用照旧真算一遍，与改动前的行为一致）。
        getDetectionService: async () => createDetectionService({
          registry: reg,
          getPlatform: async () => hostPlatform,
          getFs: () => workspaceFs,
          workspaceStore: null,
          decideBackend: decDecideBackend,
        }),
        canonicalKey: async (c) => c,
        setCache: () => {},
        logCtx: { fire: (level, event, fields) => events.push({ level: level, event: event, fields: fields }), isEnabled: () => false },
        timer: { timeout: (fn, ms) => setTimeout(fn, ms) },
        detectionExec: detectionExec,
        // #1445：两条电话改走会话。夹具照生产回包形状给一份最小开会话：判定结论里的后端 → 注册表里那份假身当会话 →
        //   上下文带 exec（via 那一格透传给宿主这同一个 detectionExec，所以「日志 kind 与执行器 via 同叫法」照旧可验）；
        //   写会话照实回 canWrite=true，仓库引用沿用判定结论里的那一个。
        openSession: async (cwd2, o) => {
          const sel = (o && typeof o.resolveSelection === 'function') ? o.resolveSelection({ cwd: cwd2 }, {}) : null
          const backendId = (sel && sel.backendId) || null
          if (!backendId) return { ok: false, reason: 'no-backend' }
          const tracker = reg.get(backendId)
          if (!tracker) return { ok: false, reason: 'no-tracker' }
          const ref = (sel && sel.ref) || { backend: backendId, refId: '', name: '', url: '' }
          const baseCtx = { cwd: cwd2, refId: (ref && ref.refId) || '', signal: undefined, platform: hostPlatform, fs: workspaceFs, caller: 'refresh', exec: detectionExec, logEvent: () => {}, isEnabled: () => false }
          const canWrite = !!(o && o.write)
          return { ok: true, backendId: backendId, repoRef: ref, budget: {}, canWrite: canWrite, call: (fn) => fn(Object.assign({}, tracker, { backendId: backendId, budget: {}, canWrite: canWrite }), baseCtx) }
        },
      })
      return { host: host, events: events, execVias: execVias }
    }
    // 宿主行为这一组的假身只验宿主分发，不断言额度，所以按离网口径声明。
    const mod = (id, impl) => ({ id: id, label: id, budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create: () => impl, matches: async () => false })
    const changes = [{ name: 'bug', color: '0b7285' }]

    // ① 正常一路：回包键位、标签形状、逐条记账，以及「后端多给的字段不许漏给客户端」
    {
      const regOK = mkReg()
      const d = regOK.register(mod('labels-host-fake', {
        listLabels: async () => ({ ok: true, data: [{ name: 'bug', color: 'd73a4a' }] }),
        setLabelColors: async (repo, cs, opCtx) => {
          if (opCtx && typeof opCtx.exec === 'function') await opCtx.exec('gh', ['label', 'list'])
          return { ok: true, data: { applied: [{ name: 'bug', color: '0b7285' }], failed: [], 后端多给的字段: '不许漏给客户端' } }
        },
      }))
      chooseWorkspace(HOST_CWD, 'labels-host-fake')
      const h = mkHost(regOK)
      const rl = await h.host.handleListLabels({ cwd: HOST_CWD })
      await assert('宿主 wf.listLabels：回包只有 ok / backendId / labels 三个键，且清单过形状检查器', rl.ok === true && keysOf(rl) === 'backendId,labels,ok' && labelListCheck(rl.labels).length === 0, '实得键：' + keysOf(rl) + '；' + (rl.ok === true ? labelListCheck(rl.labels).join('；') : JSON.stringify(rl)))
      await assert('宿主 wf.listLabels：回包里写着它选中的是哪个后端', rl.ok === true && rl.backendId === 'labels-host-fake', 'backendId=' + JSON.stringify(rl && rl.backendId))
      const rs = await h.host.handleSetLabelColors({ cwd: HOST_CWD, changes: changes })
      await assert('宿主 wf.setLabelColors：回包只有 ok / backendId / applied / failed 四个键（后端多给的字段不漏出去）', rs.ok === true && keysOf(rs) === 'applied,backendId,failed,ok', '实得键：' + keysOf(rs) + '；' + JSON.stringify(rs))
      await assert('宿主 wf.setLabelColors：逐条记账过检查器', rs.ok === true && labelBatchCheck(changes, { applied: rs.applied, failed: rs.failed }).length === 0, rs.ok === true ? labelBatchCheck(changes, { applied: rs.applied, failed: rs.failed }).join('；') : JSON.stringify(rs))
      const kinds = h.events.filter((e) => e.event === 'host.call').map((e) => e.fields && e.fields.kind)
      await assert('宿主两条电话的日志 kind 与交给后端执行器的 via 是同一个叫法（同一件事只有一个名字）', kinds.length === 2 && h.execVias.length >= 1 && kinds[0] === kinds[1] && kinds[0] === h.execVias[0], '日志 kind=' + JSON.stringify(kinds) + '，执行器 via=' + JSON.stringify(h.execVias))
      d.dispose()
    }

    // ② network 档正面样本：后端如实说真连不上，宿主原样透传（宿主不自己造 network）
    {
      const regNet = mkReg()
      const d = regNet.register(mod('labels-net-fake', {
        listLabels: async () => ({ ok: false, error: { kind: 'network', message: '连不上 GitHub：检查网络或代理后再试；你的仓库没有被改动' } }),
      }))
      chooseWorkspace(HOST_CWD, 'labels-net-fake')
      const h = mkHost(regNet)
      const rl = await h.host.handleListLabels({ cwd: HOST_CWD })
      await assert('network 档正面样本：真连不通 → 宿主原样透传 network（连不通才是网络不通）', rl.ok === false && rl.error.kind === 'network' && String(rl.error.message).includes('连不上'), JSON.stringify(rl))
      d.dispose()
    }

    // ③ 形状不对 / 后端抛异常 → env，且说清责任在插件这边
    {
      const regBad = mkReg()
      const d1 = regBad.register(mod('labels-shape-fake', {
        listLabels: async () => ({ ok: true, data: { labels: [] } }),
        setLabelColors: async () => ({ ok: true, data: { applied: [] } }),
      }))
      chooseWorkspace(HOST_CWD, 'labels-shape-fake')
      const hBad = mkHost(regBad)
      const rlShape = await hBad.host.handleListLabels({ cwd: HOST_CWD })
      await assert('后端回的标签清单不是数组 → 环境档，且说清是插件运行环境的问题、不是用户操作有误', rlShape.ok === false && rlShape.error.kind === 'env' && blameOk(rlShape.error.message), JSON.stringify(rlShape))
      await assert('✗ probe: 形状不对被报成 network 会被逮（宿主兜底不许一律报网络不通）', !(rlShape.ok === false && rlShape.error.kind === 'network'), '形状不对被报成了 network')
      const rsShape = await hBad.host.handleSetLabelColors({ cwd: HOST_CWD, changes: changes })
      await assert('后端回的记账缺「没改成功的清单」→ 环境档，且点名缺了 failed', rsShape.ok === false && rsShape.error.kind === 'env' && blameOk(rsShape.error.message) && String(rsShape.error.message).includes('failed'), JSON.stringify(rsShape))
      d1.dispose()

      const regThrow = mkReg()
      const d2 = regThrow.register(mod('labels-throw-fake', { listLabels: async () => { throw new Error('房间内部炸了') } }))
      chooseWorkspace(HOST_CWD, 'labels-throw-fake')
      const hThrow = mkHost(regThrow)
      const rlThrow = await hThrow.host.handleListLabels({ cwd: HOST_CWD })
      await assert('后端抛异常 → 环境档（不是网络不通），并说清是插件运行环境的问题、不是用户操作有误', rlThrow.ok === false && rlThrow.error.kind === 'env' && blameOk(rlThrow.error.message), JSON.stringify(rlThrow))
      d2.dispose()

      const regSilent = mkReg()
      const d3 = regSilent.register(mod('labels-silent-fake', { listLabels: async () => ({ ok: true }) }))
      chooseWorkspace(HOST_CWD, 'labels-silent-fake')
      const rlSilent = await mkHost(regSilent).host.handleListLabels({ cwd: HOST_CWD })
      await assert('后端既不说成功也不说为什么没成 → 环境档（形状不符合契约）', rlSilent.ok === false && rlSilent.error.kind === 'env', JSON.stringify(rlSilent))
      d3.dispose()
    }

    // ④ conflict 档正面样本：没选定后端 / 多个后端同时命中 / 身份识别还没定下来
    {
      const regNone = mkReg()
      regNone.register(mod('labels-none-fake', {}))
      // #1138：这个工作区没有工作区文件，也没有任何后端说自己认得它 → 就是「还没选定后端」这一档。
      //   以前这一档靠 regNone.bind(handle, null)（显式选了「无后端」）造出来；那个口子删掉之后，
      //   「显式无后端」这条状态今天没有存法（工作区文件里只能写一个后端名，见 src/host/workspaceCwd.js 的
      //   handleBind：收到 null 会如实回失败），所以这里造的是「文件缺席 + 无人认领」这同一条用户可见的路。
      const rlNone = await mkHost(regNone).host.handleListLabels({ cwd: HOST_CWD })
      await assert('conflict 档正面样本：这个工作区没选定后端 → conflict，并说清先选定后端再试', rlNone.ok === false && rlNone.error.kind === 'conflict' && String(rlNone.error.message).includes('选定'), JSON.stringify(rlNone))

      const regMulti = mkReg()
      const dm1 = regMulti.register(mod('labels-multi-a', {}))
      const dm2 = regMulti.register(mod('labels-multi-b', {}))
      // 多命中：两个后端的 matches 都说「这是我的工作区」→ 不许静默挑一个（可能改错仓库）
      // #631 追加：c / d 给出可分辨的清单与记账，好让下面「客户端声明的就是哪一个」看得见。
      // writeCalls：谁真的收到了这一批改动。用来证明「被拒绝的那一次一个字节都没动」——只看回包是 conflict
      //   还不够，回包可以是拒绝了但改动仍然漏了出去，所以两个后端都把收到的写调用记下来。
      const writeCalls = []
      const implMulti = (id) => ({
        listLabels: async () => ({ ok: true, data: [{ name: id, color: '', description: '' }] }),
        setLabelColors: async (repo, cs) => { writeCalls.push(id); return { ok: true, data: { applied: cs.map((x) => ({ name: x.name, color: x.color })), failed: [] } } },
      })
      // 多后端候选这一组的假身只验宿主仲裁，不断言额度，所以按离网口径声明。
      regMulti.register({ id: 'labels-multi-c', label: 'c', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create: () => implMulti('labels-multi-c'), matches: async () => true })
      regMulti.register({ id: 'labels-multi-d', label: 'd', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create: () => implMulti('labels-multi-d'), matches: async () => true })
      const hMulti = mkHost(regMulti)
      const rlMulti = await hMulti.host.handleListLabels({ cwd: '/ws/multi' })
      await assert('conflict 档正面样本：两个后端同时命中 → conflict，并说清是哪个没定下来', rlMulti.ok === false && rlMulti.error.kind === 'conflict' && String(rlMulti.error.message).includes('同时对应'), JSON.stringify(rlMulti))

      // ⑤ #631 追加：客户端**显式声明**了它面板上正在用的那个后端。宿主只做核验——声明的那个确实出现在
      //    这次算出来的候选名单里（multiHit 那份名单）就交给它；核验不通过的一律保持上面那条诚实的失败。
      //    这不是把「不许猜」放松了：猜是「宿主自己挑一个」，这里挑的动作在客户端，宿主只是核对这一句真不真。
      //    #1003 追加（2026-10-12 维护者拍板）：核验只在**读用途**上够用。改色是写用途，除核验之外还要有一个
      //    凭据——这个工作区的那份配置文件，或者用户这次亲手绑定过——两样都没有时，就算声明得没错也一律拒绝，
      //    所以下面「列标签认声明」和「改色不认声明」是同一口径的两面，不是互相打架。
      const rlDeclared = await hMulti.host.handleListLabels({ cwd: '/ws/multi', backendId: 'labels-multi-d' })
      await assert('#631 声明的后端在候选名单里 → 直接交给它（回包写的就是它，清单也出自它）',
        rlDeclared.ok === true && rlDeclared.backendId === 'labels-multi-d' && rlDeclared.labels.length === 1 && rlDeclared.labels[0].name === 'labels-multi-d', JSON.stringify(rlDeclared))
      // 读用途不受写用途那条门槛约束（上面刚验过）；写用途在这个还没选定后端的 /ws/multi 上必须如实拒绝。
      const rsDeclared = await hMulti.host.handleSetLabelColors({ cwd: '/ws/multi', backendId: 'labels-multi-d', changes: changes })
      await assert('#1003 还没选定后端（只有自动识别与面板声明）→ 改色如实拒绝，并指路去面板选定',
        rsDeclared.ok === false && rsDeclared.error.kind === 'conflict' && String(rsDeclared.error.message).includes('先在面板上选定'), JSON.stringify(rsDeclared))
      await assert('#1003 拒绝那一次确实没落到任何后端上（回包说拒绝不等于改动没漏出去，所以要查后端收没收到）',
        writeCalls.length === 0, '这一次被拒了，改动却还是交给了 ' + JSON.stringify(writeCalls))
      // 记下「被拒那一刻后端一共收到过几次写调用」，好让最后那条断言只比较它自己这一趟，
      //   而不是把前面几条的调用数一起算进来（否则前面一红，这条也跟着红，两句话混成一句）。
      const writeCallsBeforePick = writeCalls.length
      const rlOther = await hMulti.host.handleListLabels({ cwd: '/ws/multi', backendId: 'labels-multi-c' })
      await assert('#631 声明另一个也在名单里的后端 → 交给声明的那个（不是交给注册序排前面的那个）',
        rlOther.ok === true && rlOther.backendId === 'labels-multi-c' && rlOther.labels[0].name === 'labels-multi-c', JSON.stringify(rlOther))
      const rlOutsider = await hMulti.host.handleListLabels({ cwd: '/ws/multi', backendId: 'labels-multi-a' })
      await assert('#631 声明的后端这次没说自己认得这个工作区（不在候选名单里）→ 仍然 conflict，不将就',
        rlOutsider.ok === false && rlOutsider.error.kind === 'conflict' && String(rlOutsider.error.message).includes('同时对应'), JSON.stringify(rlOutsider))
      const rlGhost = await hMulti.host.handleListLabels({ cwd: '/ws/multi', backendId: 'labels-never-heard-of' })
      await assert('#631 声明了一个从没听说过的后端 → 仍然 conflict，不将就',
        rlGhost.ok === false && rlGhost.error.kind === 'conflict', JSON.stringify(rlGhost))
      const rlSilent2 = await hMulti.host.handleListLabels({ cwd: '/ws/multi' })
      await assert('#631 什么都没声明 → 仍然 conflict（老行为一个字没松）',
        rlSilent2.ok === false && rlSilent2.error.kind === 'conflict' && String(rlSilent2.error.message).includes('同时对应'), JSON.stringify(rlSilent2))

      // 用户在面板上选定 d：生产里这一步落在工作区文件 docs/agents/workspace.yaml（用户在工作区入口点确认，
      //   handleBind 把选择写进那份文件；#1138 起这是唯一一份记录，注册表里那份进程内副本已经删了）。
      //   为什么用另一条目录：上面五条断言测的是「只有自动识别与面板声明、还没选定后端」的 /ws/multi，
      //   而要造「用户亲手选定过」就必须写工作区文件；写在同一把钥匙上会把上面那五条的前提改掉，
      //   所以换成同一批后端下的另一条工作区目录。
      //   为什么这一段必须放在最后：选定之后宿主手里就有人的记录，不再回头看面板声明的那个名字。
      chooseWorkspace('/ws/multi-picked', 'labels-multi-d')
      const rsBound = await hMulti.host.handleSetLabelColors({ cwd: '/ws/multi-picked', backendId: 'labels-multi-d', changes: changes })
      await assert('#1003 用户亲手选定之后，改色这条电话照样落到选定的那个后端上，逐条记账也过检查器',
        rsBound.ok === true && rsBound.backendId === 'labels-multi-d'
          && writeCalls.length === writeCallsBeforePick + 1 && writeCalls[writeCalls.length - 1] === 'labels-multi-d'
          && labelBatchCheck(changes, { applied: rsBound.applied, failed: rsBound.failed }).length === 0,
        JSON.stringify(rsBound) + '；这一趟之前收到过 ' + writeCallsBeforePick + ' 次写调用，之后是 ' + JSON.stringify(writeCalls))
      dm1.dispose(); dm2.dispose()

      // 这个工作区没有工作区文件（没人选过）、后端也不认它时，客户端声明别的后端同样不认：
      //   声明的那个不在候选名单里，宿主不将就（与上面 /ws/multi 那条同一口径）。
      const rlNoneDeclared = await mkHost(regNone).host.handleListLabels({ cwd: HOST_CWD, backendId: 'labels-none-fake' })
      await assert('#631 这个工作区没有选定后端时，客户端声明一个后端也不认（不许绕开「还没选定」那一档）',
        rlNoneDeclared.ok === false && rlNoneDeclared.error.kind === 'conflict', JSON.stringify(rlNoneDeclared))

      // 待定：身份识别超时未决（注册表的 pending），也不许当作「干净的没选定」悄悄开工
      const regPending = mkReg()
      // 待定态的假身只验识别未完成时不开工，不断言额度，所以按离网口径声明。
      const dp = regPending.register({ id: 'labels-pending-fake', label: 'p', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create: () => ({}), matches: () => new Promise(() => {}) })
      const rlPending = await mkHost(regPending).host.handleListLabels({ cwd: '/ws/pending' })
      await assert('conflict 档正面样本：身份识别尚未完成（待定）→ conflict，不许静默挑一个后端', rlPending.ok === false && rlPending.error.kind === 'conflict' && String(rlPending.error.message).includes('等识别完成后再重试'), JSON.stringify(rlPending))
      // #631 追加：待定时声明也不许开工 —— 那时名单里的名字只是注册序的暂时赢家，仲裁根本还没完。
      const rlPendingDeclared = await mkHost(regPending).host.handleListLabels({ cwd: '/ws/pending', backendId: 'labels-pending-fake' })
      await assert('#631 身份识别尚未完成时，客户端声明了也不许开工（先等它定下来）',
        rlPendingDeclared.ok === false && rlPendingDeclared.error.kind === 'conflict' && String(rlPendingDeclared.error.message).includes('等识别完成后再重试'), JSON.stringify(rlPendingDeclared))
      dp.dispose()
    }
  }

  return out
}

export default { name: 'labels', run }
