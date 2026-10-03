// views/versionControl/vcText.js — 版本管理页签里「一句话怎么写」的纯规则（#818）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回 src/client/index.js
//   的 leaf 标记处（一源两物）。本文件不画界面、不打电话、不碰进程与文件系统：只把状态模型里的
//   原始值变成该显示的那串字。措辞一律从传进来的词条函数 t 取，所以本文件里一个中文字面量都没有。
//
// 两条砍字规则**不许合并**（规格里的折叠纪律）：
//   · 工作树显示名砍尾（vcTail）：从尾部砍、末尾补一个省略号，前面那段（也就是互相区分的那一段）
//     一个字不动 —— 砍尾巴对「这是哪个工作树」这件事无损；
//   · 文件路径砍中段（vcMiddle）：中间省略、文件名那一头完整保留 —— 文件路径砍尾会把
//     「这是哪个文件」这唯一有用的信息砍掉。
//
// vcMiddle 与版本管理核心 src/shared/version-control/state.js 的 foldMiddle 是同一条规则
//   （前段取 40% 上整、其余留给尾部、短于 10 个字符不砍、砍了补一个省略号）。核心那一份住宿主侧，
//   客户端半边不许运行时 import src/shared（仓库既有纪律），所以这里照同一条规则写一份；
//   「两边不许各说各话」这条由 tests/verify-818-version-control-view.js 的第三种比照盯着：
//   同一批输入喂给核心 foldMiddle 与本文件 vcMiddle，必须给出同一串字。
//
// 时间的两档分界（相对 / 绝对）与核心 describeTime 同一条：一周以内写相对说法，更早写日期时刻。
//   同一条纪律也由那道门禁的 T 组比照（核心说 relative 的，本文件也必须说 relative）。
/** 六种变化类型的词条键（缺省按「修改」说，绝不编第七种）。 */
export const VC_CHANGE_KEY = {
  added: 'vc.change.added',
  modified: 'vc.change.modified',
  deleted: 'vc.change.deleted',
  renamed: 'vc.change.renamed',
  typechange: 'vc.change.typechange',
  untracked: 'vc.change.untracked',
}
/** 六种变化类型各自的中性色档名（具体颜色由视图那一侧映射成主题变量，纯规则层不认识颜色）。 */
export const VC_CHANGE_TONE = {
  added: 'success',
  modified: 'warning',
  deleted: 'error',
  renamed: 'accent',
  typechange: 'accent',
  untracked: 'caption',
}
export const vcChangeKeyOf = function (change) {
  return VC_CHANGE_KEY[String(change)] || 'vc.change.modified'
}
export const vcChangeToneOf = function (change) {
  return VC_CHANGE_TONE[String(change)] || 'warning'
}
/** 工作树显示名砍尾：留前面 n 个字符，末尾补一个省略号；完整内容由调用方放进悬停提示。 */
export const vcTail = function (text, maxChars) {
  const s = String(text === null || text === undefined ? '' : text)
  const n = Math.floor(Number(maxChars))
  if (!isFinite(n) || n <= 0) return s
  if (s.length <= n) return s
  if (n === 1) return '\u2026'
  return s.slice(0, n - 1) + '\u2026'
}
/** 砍中段允许的最短长度：与核心 foldMiddle 同一条（短于这个长度就不砍了，砍下去会把文件名也砍没）。 */
export const VC_MIDDLE_MIN = 10
/** 文件路径砍中段：与核心 foldMiddle 逐字同规则（见文件头）。maxLen 至少 10 才砍，否则原样返回。 */
export const vcMiddle = function (path, maxLen) {
  const p = String(path === null || path === undefined ? '' : path)
  const n = Math.floor(Number(maxLen))
  if (!isFinite(n) || p.length <= n || n < VC_MIDDLE_MIN) return p
  const keep = n - 1
  const headLen = Math.ceil(keep * 0.4)
  return p.slice(0, headLen) + '\u2026' + p.slice(p.length - (keep - headLen))
}
/** 提交哈希的显示写法：模型里给的是完整 40 位（或 git 自己给的短号），这里只做显示用的取舍。 */
export const vcShortOid = function (oid) {
  const s = String(oid === null || oid === undefined ? '' : oid).trim()
  return s.length <= 12 ? s : s.slice(0, 12)
}
/** 一处改动改了多少行：'+2 −1'；二进制那一条两个数都是 null，这里如实回空串（不冒充 0）。 */
export const vcPlusMinus = function (added, deleted) {
  const a = added === null || added === undefined ? null : Number(added)
  const d = deleted === null || deleted === undefined ? null : Number(deleted)
  if (a === null || d === null || !isFinite(a) || !isFinite(d)) return ''
  return '+' + String(a) + ' \u2212' + String(d)
}
/** 相对说法的窗口：一周。与核心 describeTime 的那条 7 天分界同一条。 */
export const VC_RELATIVE_WINDOW_MS = 7 * 24 * 3600 * 1000
export const vcTimeKind = function (nowMs, ms) {
  const now = Number(nowMs)
  const t0 = Number(ms)
  if (!isFinite(now) || !isFinite(t0)) return 'absolute'
  const diff = now - t0
  if (diff >= 0 && diff < VC_RELATIVE_WINDOW_MS) return 'relative'
  return 'absolute'
}
const vcPad2 = function (n) { return (n < 10 ? '0' : '') + String(n) }
/** 精确时刻：按本机时区写成 yyyy-mm-dd hh:mm（词条里给格式，本文件不写死写法）。 */
export const vcClockText = function (t, ms) {
  const d = new Date(Number(ms))
  return t('vc.time.absolute', {
    y: String(d.getFullYear()), m: vcPad2(d.getMonth() + 1), d: vcPad2(d.getDate()),
    hh: vcPad2(d.getHours()), mm: vcPad2(d.getMinutes()),
  })
}
/** 一个时刻怎么念：一周以内是「3 小时前」这种相对说法，更早写精确时刻；读不到给空串。 */
export const vcWhenText = function (t, nowMs, ms) {
  // 没有时间这一项时如实回空串：Number(null) 是 0，直接算会画成 1970 年，那是编出来的时刻。
  if (ms === null || ms === undefined || ms === '') return ''
  const t0 = Number(ms)
  if (!isFinite(t0)) return ''
  if (vcTimeKind(nowMs, t0) === 'absolute') return vcClockText(t, t0)
  const minutes = Math.max(0, Math.floor((Number(nowMs) - t0) / 60000))
  if (minutes < 1) return t('vc.ago.justNow')
  if (minutes < 60) return t('vc.ago.minutes', { n: String(minutes) })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('vc.ago.hours', { n: String(hours) })
  return t('vc.ago.days', { n: String(Math.floor(hours / 24)) })
}
/**
 * 依据时间那一句（领先落后旁边永远要有的那一个）：读到了就写「远端信息更新于 <时刻>」，
 * 读不到就如实写读不到 —— 绝不拿「现在」冒充依据时间（规格第 10、11 条）。
 */
export const vcBasisText = function (t, nowMs, basisMs) {
  const b = Number(basisMs)
  if (basisMs === null || basisMs === undefined || !isFinite(b)) return t('vc.basis.unknown')
  return t('vc.basis.at', { when: vcWhenText(t, nowMs, b) })
}
