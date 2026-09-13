/**
 * views/labels/labelColorErrors.js — 标签配色弹窗的纯函数层（#621 新增）
 *
 * 这一份只做三件事，不碰界面、不碰状态、不写一个用户能看到的字：
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
