// src/shared/feedback-map.js —— 等待加代价加形状到反馈组合的映射（#949 · 948 图首批）
//
// 为什么单开一个文件：这是 #946 规格里唯一的判断口（等待时长定过程样式、
// 操作代价定结果重量、控件形状定瞬间能不能用），样式与文字图标横幅的出现消失
// 都走这里同一来源。全图 8 张票共用这一份真源，不各写一份。
// 本文件是纯函数，零相对引用，零副作用，可单测；测试口在 tests/verify-948-feedback-map.js。
//
// 31 种全部分配（人已否的 A9/A10/B2/B8/B10/C13 不在内）：
//   瞬间 10 种 A1 A2 A3 A4 A5 A6 A7 A8 A11 A12
//   过程 9 种 B1 B3 B4 B5 B6 B7 B9 B11 B12
//   结果 12 种 C1 C2 C3 C4 C5 C6 C7 C8 C9 C10 C11 C12
// 四类归宿见 ALLOCATION。组合铁律：同一时刻只有一个主力过程效果；
// 高危险不用弹跳扩散自动消失气泡；小图标不用缩小下沉倾斜；
// 无真实时间与真实进度不显示倒计时与百分比；结果换字只给宽按钮。

export const FEEDBACK_31 = [
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A11', 'A12',
  'B1', 'B3', 'B4', 'B5', 'B6', 'B7', 'B9', 'B11', 'B12',
  'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12',
]

export const DENIED_6 = ['A9', 'A10', 'B2', 'B8', 'B10', 'C13']

// 每类用到的种（同一种可在多类复用，如转圈既是短等待主力也是中长等待主力）。
export const ALLOCATION = {
  1: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A11', 'A12', 'C8', 'C10'],
  2: ['B1', 'B3', 'B4', 'B9', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C11', 'C12'],
  3: ['B1', 'B4', 'B5', 'B6', 'B7', 'B9', 'B11', 'B12', 'C8', 'C9'],
  4: ['B1', 'B4', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C9'],
}

const WAITS = ['instant', 'short', 'long']
const COSTS = ['low', 'medium', 'high']
const SHAPES = ['large-button', 'small-icon', 'pill', 'row', 'wide-button']

function isOneOf(v, list) { return list.indexOf(v) !== -1 }

// 按下瞬间的底座组合。深底按钮看不清加深时，用外圈描边代替（调用点按深浅二选一，
// 规矩是描边与加深不同时开）。缩小下沉只给大按钮，倾斜只给弹窗里的大按钮。
function momentOf(shape, dialog) {
  const base = []
  if (shape === 'small-icon') {
    base.push('focus-ring', 'stroke-flash', 'ring-out')
    return base
  }
  base.push('press-darken', 'focus-ring', 'hover-lift')
  if (shape === 'large-button' || shape === 'wide-button') {
    base.push('ripple', 'shrink', 'sink', 'sheen')
    if (shape === 'large-button' && dialog === true) base.push('tilt')
  } else {
    base.push('ripple')
  }
  base.push('stroke-flash')
  return base
}

// 结果组合。换字只给宽按钮，成功圈与弹跳只给低代价的复制类，
// 高危险只用确认框加横幅留痕，不用轻佻效果。
function resultOf(cls, shape, cost) {
  if (cls === 1) return ['bubble', 'toast']
  if (cls === 3) return ['toast', 'banner']
  if (cls === 4) return ['confirm-box', 'check', 'cross', 'triangle', 'green-flash', 'red-flash', 'shake', 'banner']
  const out = ['check', 'cross', 'triangle', 'green-flash', 'red-flash', 'shake']
  if (shape === 'wide-button') out.push('result-text')
  if (cost === 'low') out.push('success-ring', 'bounce')
  return out
}

// 主入口。hasRealTime/hasRealProgress 只认真实时间与真实进度，
// 没有就不给倒计时与百分比，不编数字骗人。
// alt 是短等待的备用过程（省略号圆点与呼吸）：只给没有转圈位子的文字按钮用
// （弹窗提交等待中用圆点，评论分页加载中用呼吸），永不与转圈同开。
// 非法输入诚实抛错，不猜默认值。
export function feedbackComboOf(input) {
  const v = input || {}
  if (!isOneOf(v.wait, WAITS)) throw new Error('feedback-map: 未知等待档位 ' + String(v.wait))
  if (!isOneOf(v.cost, COSTS)) throw new Error('feedback-map: 未知代价档位 ' + String(v.cost))
  if (!isOneOf(v.shape, SHAPES)) throw new Error('feedback-map: 未知控件形状 ' + String(v.shape))
  const cls = v.cost === 'high' ? 4 : (v.wait === 'long' ? 3 : (v.wait === 'short' ? 2 : 1))
  const moment = momentOf(v.shape, v.dialog)
  let process = 'none'
  if (cls === 2 || cls === 4) process = 'spinner'
  if (cls === 3) process = 'spinner-stage'
  const detail = []
  if (cls === 3) {
    if (v.hasRealTime === true) detail.push('countdown')
    if (v.hasRealProgress === true) detail.push('percent')
  }
  const result = resultOf(cls, v.shape, v.cost)
  const alt = cls === 2 ? ['dots', 'breath'] : []
  return { cls: cls, moment: moment, process: process, detail: detail, result: result, alt: alt }
}

// ---------------------------------------------------------------------------
// #955 补欠账：三张「落地对账表」，门禁与票面都从这里取，避免两处各写一份。
// ---------------------------------------------------------------------------

// 一、演示秒数表（按真实接口耗时分布的四个档位）。
// 每一行是「效果名 → 实际时长 + 归属档位 + 对应哪一类真实调用」。
// 档位口径来自 #861 调研：瞬间 300 毫秒以内、短 0.3 到 2 秒、中 2 到 10 秒、长 10 秒以上。
// 表里的毫秒数必须与生产代码里那一处逐字对齐（门禁 tests/verify-955-alignment.js 双向核对）：
//   css 列的键是叶子 src/client/views/feedback/feedback-styles.js 里的动画时长；
//   js  列的键是调用点自己排的自退时间（setTimeout）。
// 不编数字：某档真实耗时给不出证据时，那一格写 null 并在 why 里说明为什么不演示。
export const FB_DURATIONS = [
  { fx: 'ripple', css: '.55s', tier: 'instant', why: '按下瞬间的点缀，跟着手指走，与接口耗时无关（真实调用：点一下就到，没有等待）' },
  { fx: 'ringout', css: '.6s', tier: 'instant', why: '小图标按下的外扩环，同上，属于按下那一瞬的确认' },
  { fx: 'sheen', css: '.5s', tier: 'instant', why: '光泽扫过是备用效果，只在弹窗大按钮上手动演示' },
  { fx: 'pop', css: '.35s', tier: 'instant', why: '复制成功的轻弹，复制是本地动作（真实耗时约 0.2 秒，落在瞬间档）' },
  { fx: 'success-ring', css: '.6s', tier: 'instant', why: '复制成功的成功圈，与轻弹同一次动作' },
  { fx: 'dots', css: '.9s', tier: 'short', why: '圆点循环一轮的时长，用在弹窗提交等待（真实调用：提交向导约 1 秒级）' },
  { fx: 'okflash-errflash-warnflash', css: '.45s', tier: 'short', why: '结果闪光半秒内自退，强调一下就退场，不占等待时间' },
  { fx: 'shake', css: '.4s', tier: 'short', why: '失败抖动一次，幅度小、只抖一遍' },
  { fx: 'breath', css: '1.6s', tier: 'short', why: '呼吸循环一轮的时长，用在评论翻页加载（真实调用：翻页约 1 秒级）' },
  { fx: 'skel', css: '1.1s', tier: 'medium', why: '骨架微光循环一轮的时长，用在面板列表首开（真实调用：列表首拉约 2 到 10 秒）' },
  { fx: 'justSent', js: 1100, tier: 'short', why: '弹窗提交成功后「已提交」停留 1.1 秒再关窗（真实调用：提交向导约 1 秒级）' },
  { fx: 'copyRetire', js: 1300, tier: 'instant', why: '复制成功对勾停留 1.3 秒（本地动作，留够看清的时间）' },
  { fx: 'commentRetire', js: 1500, tier: 'short', why: '发评论成功对勾停留 1.5 秒（真实调用：发评论约 0.5 到 2 秒）' },
  { fx: 'stageText', js: null, tier: 'medium', why: '阶段文字轮换按真实阶段推进，没有写死秒数（真实调用：提交、检查更新、版本读写约 2 到 10 秒）' },
  { fx: 'countdown', js: null, tier: 'long', why: '倒计时只在有真实时间时显示（真实调用：限流重试可到 10 秒以上），秒数取自真实剩余时间' },
  { fx: 'percent', js: null, tier: 'long', why: '百分比只在有真实进度时显示，数值取自真实进度' },
]

// 二、结果三图标的尺寸表（叉号、三角与对勾同尺寸，一处一行）。
// 尺寸指 Ic 的 size 参数（像素），同一条里的三个必须相等，门禁逐条核对。
export const FB_ICON_SIZES = [
  { site: '发评论按钮', file: 'src/client/views/IssueDetailComments.js', size: 11, trio: ['check', 'x'] },
  { site: '行内复制按钮', file: 'src/client/views/ListTabRow.js', size: 13, trio: ['check', 'x'] },
  { site: '标签配色弹窗保存按钮', file: 'src/client/views/labels/LabelColorDialog.js', size: 12, trio: ['check', 'x', 'alert'] },
  { site: '清空日志留痕横幅', file: 'src/client/statusbar/LogDangerConfirm.js', size: 12, trio: ['check', 'x'] },
]

// 三、失败红逐路径清单（不设一个全局硬值：每一处用它所在界面的既有色调）。
// 这份清单是「按路径逐处对齐」的证据，门禁核对每个色值在对应文件里真实存在。
export const FB_FAIL_RED_PATHS = [
  { path: '失败横幅', file: 'src/client/kernel/styles.js', colors: ['#f87171', 'rgba(248,113,113,.12)', 'rgba(248,113,113,.45)'], note: '走到处：.dsws-banner.bad（清空日志留痕、仓库链失败横幅共用这一支）' },
  { path: '失败红闪', file: 'src/client/views/feedback/feedback-styles.js', colors: ['rgba(248,113,113,.55)'], note: '结果闪光是 #f87171 的透明版，不另立色值' },
  { path: '弹窗内联错误条', file: 'src/client/kernel/slotRenderer-modal-view.js', colors: ['#fca5a5', 'rgba(248,113,113,.45)', 'rgba(248,113,113,.10)'], note: '深底上用亮一档的红保证可读，底与边仍是 #f87171 的透明版' },
  { path: '发评论失败提示', file: 'src/client/views/IssueDetailComments.js', colors: ['#f87171'], note: '限流那一档走琥珀 #f59e0b，与「网络失败」分开说' },
  { path: '标签配色弹窗', file: 'src/client/views/labels/LabelColorDialog.js', colors: ['#f87171'], note: '标题、消息、提示、横幅四处同色' },
  { path: '清空日志失败重试键', file: 'src/client/statusbar/LogDangerConfirm.js', colors: ['#fca5a5'], note: '横幅上的重试键文字用亮红，与横幅本体的 #f87171 同族' },
  { path: '浮层小提示失败', file: 'src/client/kernel/store-snapshot.js', colors: ['#fbbf24'], note: '浮层提示只有 ok/warn/info 三档，失败走 warn 琥珀（NOTICE_COLOR.warn），不自造红' },
  { path: '原型占位红（不在反馈路径）', file: 'src/client/views/SubworkspaceMark.js', colors: ['#f85149'], note: '子工作区角标的既有红，保留原样；反馈路径一处都不用，也不许把它提成全局值' },
]

