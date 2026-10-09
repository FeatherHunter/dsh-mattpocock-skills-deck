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
  return { cls: cls, moment: moment, process: process, detail: detail, result: result }
}
