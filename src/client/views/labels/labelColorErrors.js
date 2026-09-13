/**
 * views/labels/labelColorErrors.js — 标签配色弹窗的纯函数层（#621 新增；#622 加进「复制推荐配色 prompt」的拼装）
 *
 * 这一份只做四件事，不碰界面、不碰状态、不写一个用户能看到的字：
 *
 * 一、宿主电话回包取形状。列表与保存都是经 tracker 契约层的两个操作拿的，回包形状由宿主定：
 *     列表成功时是 { ok:true, labels:[{name,color,description}] }（契约里把后端回的那份数组叫 data，
 *     宿主把它改名成 labels 交给客户端；这里两种键都认，免得宿主改口径时界面先崩）；
 *     保存成功时是 { ok:true, applied:[...], failed:[...] }（同样兼容包在 data 里的一种写法——
 *     本地 Markdown 后端自己回的就是 { ok:true, data:{applied,failed} }，宿主那层才把它摊平）。
 *     失败一律是 { ok:false, error:{kind,message} }。
 *
 * 二、契约的八个错误档位到词条键的映射。档位名见 src/host/tracker/contract.js 的 ERROR_KIND；
 *     人话写在中英词条文件 kernel/locale-labels.js 里（#617 交接口径：这八条归 #621 负责）。
 *     没见过的档位一律落到「原因没说清」那条，绝不猜。
 *
 * 三、色值换算与「这一行算不算填完了」这两件纯判断。色值那两个口径是：
 *     界面显示与输入接受的都是**带井号的小写六位**（例如 #8b5cf6），因为浏览器原生取色盘
 *     <input type="color"> 给出来的就是这个格式；
 *     契约与配色核心内部用的是**不带井号的小写六位**（例如 8b5cf6），比较颜色有没有变也是按这个口径。
 *     显示这一侧收在 lcToDisplay（内部 → 显示）一处；
 *     反方向（用户填的值 → 契约口径）不在界面里另写一份：界面把用户填的原文直接交给配色核心的
 *     pickChangedRows，由它在挑改动时顺手归一。所以界面只有这一个换算函数。
 *     lcRowIncomplete 管的是「这一行还没填完」：写错了字、或者把原本有颜色的格子清空了，都算没填完。
 *
 * 四、(#622) 「复制推荐配色 prompt」这一侧的三件纯事：该拼哪一套文案与两处真实值（lcCopyPlanOf）、
 *     整段文字的拼装（lcCopyPromptOf），以及把文字写进剪贴板并把成没成如实回报给界面（lcWriteClipboard）。
 *     文字本身一句都不住在这里：两套文案（远程仓库版与工作区文件版）在中英词条 kernel/locale-labels.js 里，
 *     表格与整段的拼接调的是配色核心 buildPalettePrompt / buildPaletteTable（src/shared/label-color/prompt.js，
 *     #629 建好），这一层不自己手写表格，也不自己拼表头文字。
 */
export const LC_KIND_KEYS = {
  'env': 'lc.err.env',
  'auth': 'lc.err.auth',
  'rate-limit': 'lc.err.rateLimit',
  'conflict': 'lc.err.conflict',
  'unsupported': 'lc.err.unsupported',
  'not-found': 'lc.err.notFound',
  'network': 'lc.err.network',
  'parse': 'lc.err.parse',
}

/** 没配色的标签，色块拿这个灰值当占位（原生取色盘不接受空值，必须有颜色才打得开）。 */
export const LC_PLACEHOLDER_COLOR = '#808080'

/** 档位名（可能为空、可能是没见过的值）到词条键。 */
export const lcKindKey = function (kind) {
  const k = String(kind === null || kind === undefined ? '' : kind)
  return Object.prototype.hasOwnProperty.call(LC_KIND_KEYS, k) ? LC_KIND_KEYS[k] : 'lc.err.unknown'
}

/** 从电话回包里取出错误的两段：档位与后端写好的那句话；没有错误时给两个空串。 */
export const lcErrorOf = function (res) {
  const e = res && res.error
  if (e && typeof e === 'object') return { kind: String(e.kind || ''), message: String(e.message || '') }
  if (typeof e === 'string') return { kind: '', message: e }
  return { kind: '', message: '' }
}

/** 列表调用成功时给出权威清单（每项 {name,color,description}）；失败或形状不对给 null。 */
export const lcLabelsOf = function (res) {
  if (!res || res.ok !== true) return null
  const raw = Array.isArray(res.labels) ? res.labels : ((res.data && Array.isArray(res.data)) ? res.data : null)
  if (!raw) return null
  const out = []
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i]
    if (!r || typeof r.name !== 'string' || r.name === '') continue
    out.push({
      name: r.name,
      color: typeof r.color === 'string' ? r.color : '',
      description: typeof r.description === 'string' ? r.description : '',
    })
  }
  return out
}

/**
 * 把「这次提交的改动清单」与「保存回包」合成逐条结果。
 *
 * 为什么要合成：契约把保存定成**逐条记账**（applied 与 failed 各一份名单，入参里每一条
 * 改动必须恰好出现在其中之一），但整体失败时后端只给一个 error，不会给逐条名单——
 * 那时每一条改动的结果都是这同一个错误，界面要照样把「哪几条没成、为什么」说清楚。
 * 返回的 rows 顺序与入参 changes 顺序一致；missing 为真表示后端既没把它算进 applied
 * 也没算进 failed（等于没按契约回话），界面按「原因没说清」显示，不假装成功。
 */
export const lcSaveOutcome = function (res, changes) {
  const list = Array.isArray(changes) ? changes : []
  const appliedByName = {}
  const failedByName = {}
  let wholeError = null
  if (res && res.ok === true) {
    const d = (res.data && typeof res.data === 'object') ? res.data : res
    const applied = Array.isArray(d.applied) ? d.applied : null
    const failed = Array.isArray(d.failed) ? d.failed : null
    if (applied && failed) {
      for (let i = 0; i < applied.length; i++) {
        const a = applied[i]
        if (a && typeof a.name === 'string') appliedByName[a.name] = String(a.color || '')
      }
      for (let i = 0; i < failed.length; i++) {
        const f = failed[i]
        if (f && typeof f.name === 'string') failedByName[f.name] = lcErrorOf({ error: f.reason })
      }
    } else {
      wholeError = { kind: '', message: '' }
    }
  } else {
    wholeError = lcErrorOf(res)
  }
  const rows = list.map(function (c) {
    const name = c && c.name ? String(c.name) : ''
    if (Object.prototype.hasOwnProperty.call(appliedByName, name)) {
      return { name: name, ok: true, kind: '', message: '', color: appliedByName[name], missing: false }
    }
    const hit = Object.prototype.hasOwnProperty.call(failedByName, name) ? failedByName[name] : wholeError
    return { name: name, ok: false, kind: hit ? hit.kind : '', message: hit ? hit.message : '', missing: !hit }
  })
  let appliedCount = 0
  for (let i = 0; i < rows.length; i++) if (rows[i].ok) appliedCount++
  return { changes: list, rows: rows, appliedCount: appliedCount, failedCount: rows.length - appliedCount, wholeError: wholeError }
}

/** 保存结果里某一个标签的那一条；没有这个标签的记录时给 null。 */
export const lcOutcomeRowOf = function (outcome, name) {
  if (!outcome || !Array.isArray(outcome.rows)) return null
  for (let i = 0; i < outcome.rows.length; i++) {
    if (outcome.rows[i].name === name) return outcome.rows[i]
  }
  return null
}

/** 内部口径（不带井号的小写六位）→ 界面显示（带井号的小写六位）；没配色的空值给空串。 */
export const lcToDisplay = function (color) {
  const n = normalizeColor(color)
  return n ? '#' + n : ''
}

/**
 * 这一行是不是「还没填完」——两件事都算：
 *   - 用户填进去的字不是六位十六进制（写错了、还是半截）；
 *   - 这一行原本有颜色，用户把格子清空了（清空在契约里不是合法颜色，后端会按解析档拒；
 *     本图不做「清除颜色」这个动作，要清除得去配色文件里删掉那一行）。
 * 什么都没填、这一行本来也没颜色（还是「未配色」）不算没填完：用户没碰它。
 */
export const lcRowIncomplete = function (row, text) {
  const raw = (text === null || text === undefined) ? '' : String(text)
  if (isColor(raw)) return false
  if (raw.trim() !== '') return true
  return !!(row && isColor(row.color))
}

// ==================== #622 复制推荐配色 prompt：拼哪一套、拼出什么、怎么送进剪贴板 ====================

/**
 * 这次点击要拼的是哪一套文案，以及要写进文案里的两处真实值。
 *
 * 分套的依据是后端**自己声明的开仓动作**（BackendModule.openRepository，经 wf.registry 与快照透传到客户端）。
 * **只认显式声明，不猜默认**（总工裁决）：声明 'folder'（仓库就是本地这个文件夹）→ 颜色存在工作区文件里 →
 * 用「改工作区文件」那一套；声明 'url'（仓库在远端）→ 用「到远程仓库里用 gh 命令行改」那一套；
 * 其余（没有这个后端模块，或模块没声明开仓动作）→ ok 为假，界面如实说这一档没读到、这次不生成方案——
 * 猜错的话用户会照着一段指向别处的命令去改，比不生成糟得多。
 * 为什么不按后端名字判断：客户端树里不许出现品牌 id 的等值比较（tests/verify-client-hardcode-gate.js 的 F1 红线）；
 * 而且「颜色存在哪里」本来就是后端自己声明的事。
 *
 * 返回 { ok, reason, version, repo, workspace }：repo 只有远程那一套有值（真实仓库名，读不到给空串、
 * 改用不含仓库名的结尾，**不留占位符**）；workspace 只有文件那一套有值（工作区文件夹名，见 lcWorkspaceNameOf）。
 */
export const lcCopyPlanOf = function (input) {
  const store = (input && input.store) || null
  const backendId = (input && input.backendId) || ''
  const meta = (typeof moduleMetaOf === 'function') ? moduleMetaOf(store, backendId) : null
  if (!meta) return { ok: false, reason: 'no-backend', version: '', repo: '', workspace: '' }
  const declared = meta.openRepository
  const openMode = (declared === 'folder' || declared === 'url') ? declared : ''
  if (!openMode) return { ok: false, reason: 'no-open-mode', version: '', repo: '', workspace: '' }
  const fileBacked = openMode === 'folder'
  return {
    ok: true,
    reason: '',
    version: fileBacked ? 'file' : 'remote',
    repo: fileBacked ? '' : lcRepoNameOf(store),
    workspace: fileBacked ? lcWorkspaceNameOf(input && input.cwd) : '',
  }
}

/**
 * 面板当前这份快照里的真实仓库名，取法与该写法的既有单源一致（先 refId，再 owner/name，再 name）。
 * 读不到就给空串——绝不给 'owner/repo' 这类占位符：那是让人自己去填的假名字，#622 明确不许。
 */
export const lcRepoNameOf = function (store) {
  try {
    const snap = store && store.snapshot
    const repo = (store && store.repository) || (snap && (snap.repository || snap.repo)) || null
    if (repo && typeof repo.refId === 'string' && repo.refId) return repo.refId
    if (repo && repo.owner && repo.name) return String(repo.owner) + '/' + String(repo.name)
    if (repo && typeof repo.name === 'string' && repo.name) return repo.name
  } catch (e) { /* 读不到就当作读不到，落到下面返回空串 */ }
  return ''
}

/**
 * 工作区文件夹名：取工作区路径的最后一段。
 * 只取最后一段是有意的——这段文字要粘进 AI 会话，机器上的完整路径既没用到，也不该出现在文案里
 * （票面边界：文案里不许出现本机绝对路径，也不许写死在 Windows 上才成立的写法，路径来自运行时的 cwd）。
 */
export const lcWorkspaceNameOf = function (cwd) {
  const s = String(cwd === null || cwd === undefined ? '' : cwd).trim()
  if (!s) return ''
  const parts = s.split(/[\\/]+/).filter(function (p) { return p !== '' })
  return parts.length ? parts[parts.length - 1] : ''
}

/**
 * 把一段文字写进剪贴板，并把成没成如实回报给界面：写成回 true，没写成回 false。
 * 只碰剪贴板这一件事：不发网络请求、不调任何宿主接口、更不把这段文字送进任何会话（#622 的硬要求）。
 * 为什么不复用 kernel 的 copyText：那个函数把结果 flash 到面板级提示条上，调用方拿不到成没成；
 * 这里返回 Promise，判断顺序与它一致（navigator.clipboard 在不在、writeText 在不在、写这次成不成）。
 */
export const lcWriteClipboard = function (text) {
  const s = String(text === null || text === undefined ? '' : text)
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return Promise.resolve(navigator.clipboard.writeText(s)).then(function () { return true }).catch(function (e) {
        warnClipboardFailed('write rejected', e)
        return false
      })
    }
    warnClipboardFailed('navigator.clipboard.writeText is not available', null)
  } catch (e) {
    warnClipboardFailed('clipboard call threw', e)
  }
  return Promise.resolve(false)
}

/** 剪贴板没写成时在开发者控制台留一句（不是本仓库那份本地诊断日志，也不新增事件名）：
 *  界面上如实说失败、控制台里留个由头，查问题的人不用猜。只记为什么没写成，不记那段文字本身。 */
function warnClipboardFailed(why, err) {
  try {
    if (typeof console !== 'undefined' && console && typeof console.warn === 'function') {
      console.warn('[dsws] clipboard write failed: ' + why + (err && err.message ? ' — ' + err.message : ''))
    }
  } catch (e) { /* 连 console 都没有就当没这回事 */ }
}

/**
 * 拼出「推荐配色 prompt」的整段文字：开头一句、一张两列的标签表、结尾一句，三段之间空一行。
 * 开头与结尾按 version 选一套（两套都在词表里）；真实仓库名与工作区文件夹名由调用方（lcCopyPlanOf）
 * 从面板当前这份数据里读出来传进来——**点了才拼、拿当前值**。表头与表格本体交给配色核心的
 * buildPalettePrompt / buildPaletteTable 拼，色值由核心统一印成不带井号的小写六位。
 * t 是词条解析函数（界面把 tr 传进来）：两套文案由词表决定，拼装顺序由这里决定。
 */
export const lcCopyPromptOf = function (input) {
  const src = input || {}
  const t = (typeof src.t === 'function') ? src.t : function (key) { return String(key) }
  const rows = Array.isArray(src.rows) ? src.rows : []
  const fileBacked = src.version === 'file'
  const repo = String(src.repo || '')
  const workspace = String(src.workspace || '')
  const lead = fileBacked
    ? (workspace ? t('lc.copyWsLine', { ws: workspace }) : '')
    : (repo ? t('lc.copyRepoLine', { repo: repo }) : '')
  const opening = lead ? (lead + '\n' + t(fileBacked ? 'lc.copyOpenFile' : 'lc.copyOpenRemote')) : t(fileBacked ? 'lc.copyOpenFile' : 'lc.copyOpenRemote')
  const closing = fileBacked
    ? t('lc.copyCloseFile')
    : (repo ? t('lc.copyCloseRemote', { repo: repo }) : t('lc.copyCloseRemoteNoRepo'))
  return buildPalettePrompt({
    rows: rows,
    texts: {
      opening: opening,
      columnNames: { name: t('lc.copyColName'), color: t('lc.copyColColor') },
      closing: closing,
    },
  })
}

/**
 * 那段文字里每一行用哪个颜色（#622 整改 D3：复制侧与保存侧用同一条「填完了没有」的规则）：
 * 填完了的行用界面上现在显示的值（用户改了还没保存的草稿跟着走，他看的就是这个）；
 * 没填完的行（写错的字、或把原本有颜色的格子清空）一律退回**后端刚返回的真实当前值**，不许把半截草稿
 * 当成新颜色写进方案——照着一份写着「空」的方案去执行，用户会把「空」当成目标色。
 * textOf 由界面传进来（就是它渲染每行时用的那个取值的函数），这一层不自己决定显示口径。
 */
export const lcCopyRowsOf = function (rows, textOf) {
  const list = Array.isArray(rows) ? rows : []
  const pick = (typeof textOf === 'function') ? textOf : function () { return '' }
  const out = []
  for (let i = 0; i < list.length; i++) {
    const row = list[i] || {}
    const text = pick(row)
    out.push({ name: row.name, color: lcRowIncomplete(row, text) ? String(row.color || '') : text })
  }
  return out
}

/**
 * 一次「复制推荐配色 prompt」点击的完整决定（纯函数）：要么给一段要写进剪贴板的文字，要么给一个
 * 「这一次不写」的理由键——判断全在这里，界面只负责渲染。write 为假时**不调用剪贴板**（连文字都不给），
 * 界面拿 key 去词表取那一句人话。这么分是为了让「什么情况下不许写剪贴板」能被自动检查钉住
 * （tests/verify-label-color-core.js 第 8 节）：分套与拼装都在纯函数里，不用起界面也能验。
 */
export const lcCopyAttemptOf = function (input) {
  const src = input || {}
  const plan = lcCopyPlanOf(src)
  if (!plan.ok) {
    return {
      write: false,
      kind: 'blocked',
      key: plan.reason === 'no-open-mode' ? 'lc.copyNoOpenMode' : 'lc.copyNoBackend',
      text: '',
    }
  }
  return {
    write: true,
    kind: 'pending',
    key: '',
    text: lcCopyPromptOf({
      version: plan.version,
      repo: plan.repo,
      workspace: plan.workspace,
      rows: lcCopyRowsOf(src.rows, src.textOf),
      t: src.t,
    }),
  }
}

/**
 * 剪贴板写成了没有 → 界面该显示哪一句（纯函数，界面照着渲染）。只有 written 严格等于 true 才算「已复制」；
 * 被拒、抛异常、环境里没有剪贴板一律是失败那一支，并把那段文字原样带上（界面摊在只读框里让用户手动选）。
 * **不允许失败走成功那一支**——这正是原型票栽过的坑，所以由自动检查钉住（verify-label-color-core 第 8 节）。
 */
export const lcCopyFeedbackOf = function (written, text) {
  if (written === true) return { kind: 'ok', key: 'lc.copied', text: '' }
  return { kind: 'fail', key: 'lc.copyFailed', text: String(text === null || text === undefined ? '' : text) }
}
