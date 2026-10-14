// label-colors-codec.js —— 标签配色文件的文本与房间形状互转（#1012 YAML 翻转）
//
// 人话：文件里是什么字、房间里是什么值，两边的翻译只许这一处做。
// 读：YAML 文本（老的 `.json` 是 YAML 的子集，直接可读）→ 校验 → 房间要的
// `{colors, raw}`；写：标签表 → 带程序生成注释的 YAML 文本。
// 校验规则与文本入口住核里（src/shared/config-store/labels.js 的 parseLabelsText：
// 房间文件不许用裸包引用，产物在 shared 层用裸包是允许的方向）。
// 这里只做一件事：把核的档位翻译成用户能看懂的话术材料，把核的值整理成房间沿用的形状。
// 颜色值本身的合法性由配色核定（normalizeColor），非法颜色按「还没配颜色」归空，
// 文件不算坏（沿房间既有口径，用户改回来就能恢复）。
//
// 与 label-colors.js 的分工：这里不碰文件系统（不读不写不删），只做字符串与对象；
// 读文件、原子发布、串行队列、日志都在 label-colors.js。
import { parseLabelsText, stringifyLabelColors } from '../../../shared/config-store/labels.js'
import { normalizeColor } from '../../../shared/label-color/colors.js'

/**
 * 把文件文本读成房间形状。
 * 成功：{ ok:true, colors, raw, readonly } —— colors 是标签名 → 归一化颜色
 * （非法颜色归空串）；raw 是原写法的保留（字符串或 {color, description}，描述与写法
 * 都在，供保存时合并）；readonly 为真表示文件版本比核认识的新，只能展示不许写。
 * 失败：{ ok:false, reason, why, action, detail } —— reason 沿用 labelColors.read
 * 的 reason 词表；why/action/detail 给房间拼用户话术。
 */
// 译码结果的字面量联合：ok 用 true/false 字面量（不用 boolean），调用方 `if (!d.ok)` 之后
// 才能直接读 why 或 colors——宽成 boolean 的话两边都读不到（label-colors-ops 曾因此多处报错）。
export interface DecodedLabelsOk {
  ok: true
  colors: Record<string, string>
  raw: Record<string, unknown>
  readonly: boolean
}
export interface DecodedLabelsFail {
  ok: false
  reason: string
  why: string
  action: string
  detail: string
}
export type DecodedLabels = DecodedLabelsOk | DecodedLabelsFail
// 核的解析产物形状（只取本文件实际读的几个键；核的完整形状归核，房间不复述）。
interface ParsedLabels {
  ok?: unknown
  reason?: unknown
  message?: unknown
  keys?: unknown
  value?: unknown
  readonly?: unknown
}
export function decodeLabelsText(text: string): DecodedLabels {
  return decodeLabelsParsed(parseLabelsText(text))
}

/** 把核的解析结果整理成房间形状（核只管判对错，这里的 shapes 是房间沿用的）。 */
export function decodeLabelsParsed(parsed: unknown): DecodedLabels {
  // 核产物经 unknown 收口：`as` 只为过类型，求值顺序与原表达式逐字相同。
  const p = parsed as ParsedLabels | null | undefined
  if (!p || p.ok !== true) {
    const reason = ((p && p.reason) || 'bad-shape') as string
    const message = ((p && p.message) || '这个文件里的内容不对。') as string
    if (reason === 'oversize') {
      return {
        ok: false,
        reason: 'oversize',
        why: message,
        action: '请确认这份文件是不是放错了位置，然后重新保存。',
        detail: '',
      }
    }
    if (reason === 'aliases') {
      return {
        ok: false,
        reason: 'aliases',
        why: message,
        action: '请检查这份文件是不是被别的工具改过，然后重新保存。',
        detail: '',
      }
    }
    if (reason === 'yaml-error') {
      return {
        ok: false,
        reason: 'yaml-error',
        why: '这个文件里的内容不是合法的文字格式。这一档只可能是内容本身写坏了，与权限、被别的程序占用都无关',
        action: '请手工把内容改成「标签名 → 颜色」的写法、每个标签一行，例如 "bug": "d73a4a"，然后重新保存。',
        detail: '',
      }
    }
    if (reason === 'unknown-keys') {
      return {
        ok: false,
        reason: 'unknown-keys',
        why: '这个文件里有多出来的名字，核不认识它们：' + (((p && p.keys) as string[]) || []).join('、'),
        action: '请删掉这些多出来的名字，只留标签与颜色，然后重新保存。',
        detail: '',
      }
    }
    return {
      ok: false,
      reason: 'bad-shape',
      why: message,
      action: '请把这个文件改成一个标签与颜色的对应表：每个标签写一行，例如 "bug": "d73a4a"，然后重新保存。',
      detail: '',
    }
  }
  const colors: Record<string, string> = {}
  const raw: Record<string, unknown> = {}
  const v = (p && p.value) as { colors?: Record<string, unknown> } | null | undefined
  const table: Record<string, unknown> = (v && v.colors) as Record<string, unknown> || {}
  for (const name of Object.keys(table)) {
    // 值是字符串或对象两种写法（见文件头形状说明）：经视图读 color，求值与原来逐字相同。
    const entry = table[name] as string | { color?: unknown } | null | undefined
    raw[name] = entry
    let colorText = ''
    if (typeof entry === 'string') colorText = entry
    else if (entry && typeof entry === 'object' && typeof entry.color === 'string') colorText = entry.color
    colors[name] = normalizeColor(colorText) || ''
  }
  return { ok: true, colors, raw, readonly: p.readonly === true }
}

/**
 * 把标签表拼成落盘文本（含程序生成的注释与版本号）。
 * 成功：{ ok:true, text }；失败：{ ok:false, reason, message }（调用方按写失败分档，
 * 失败时一个字节都不写；直给表里出现 version / colors 这两个保留字也会明确拒绝，
 * 不静默丢标签）。
 */
export interface EncodedLabelsOk {
  ok: true
  text: string
}
export interface EncodedLabelsFail {
  ok: false
  reason: string
  message: string
}
export function encodeLabelsTable(table: Record<string, unknown>): EncodedLabelsOk | EncodedLabelsFail {
  try {
    // 核的返回在它的声明里把 ok 拓宽成 boolean（它的 .d.ts 如此，房间动不了它）：
    // 运行时的 ok 恒为 true/false 字面量（成功带 text、失败带 reason/message，调用方只读这三键），
    // 断言只收类型视野，返回的还是原来那个对象。
    return stringifyLabelColors(table) as EncodedLabelsOk | EncodedLabelsFail
  } catch (e) {
    return { ok: false, reason: 'bad-shape', message: String((e && (e as Record<string, unknown>).message) || e || '拼装失败') }
  }
  // 注：stringifyLabelColors 从不抛错（任何输入都按档位回），上面这支 catch 只是防御。
}

export default { decodeLabelsText, decodeLabelsParsed, encodeLabelsTable }
