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
import { parseLabelsText, stringifyLabelColors } from '../../../../shared/config-store/labels.js'
import { normalizeColor } from '../../../../shared/label-color/colors.js'

/**
 * 把文件文本读成房间形状。
 * 成功：{ ok:true, colors, raw, readonly } —— colors 是标签名 → 归一化颜色
 * （非法颜色归空串）；raw 是原写法的保留（字符串或 {color, description}，描述与写法
 * 都在，供保存时合并）；readonly 为真表示文件版本比核认识的新，只能展示不许写。
 * 失败：{ ok:false, reason, why, action, detail } —— reason 沿用 labelColors.read
 * 的 reason 词表；why/action/detail 给房间拼用户话术。
 */
export function decodeLabelsText(text) {
  return decodeLabelsParsed(parseLabelsText(text))
}

/** 把核的解析结果整理成房间形状（核只管判对错，这里的 shapes 是房间沿用的）。 */
export function decodeLabelsParsed(parsed) {
  if (!parsed || parsed.ok !== true) {
    const reason = (parsed && parsed.reason) || 'bad-shape'
    const message = (parsed && parsed.message) || '这个文件里的内容不对。'
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
        why: '这个文件里有多出来的名字，核不认识它们：' + ((parsed && parsed.keys) || []).join('、'),
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
  const colors = {}
  const raw = {}
  const table = (parsed.value && parsed.value.colors) || {}
  for (const name of Object.keys(table)) {
    const entry = table[name]
    raw[name] = entry
    let colorText = ''
    if (typeof entry === 'string') colorText = entry
    else if (entry && typeof entry === 'object' && typeof entry.color === 'string') colorText = entry.color
    colors[name] = normalizeColor(colorText) || ''
  }
  return { ok: true, colors, raw, readonly: parsed.readonly === true }
}

/**
 * 把标签表拼成落盘文本（含程序生成的注释与版本号）。
 * 成功：{ ok:true, text }；失败：{ ok:false, reason, message }（调用方按写失败分档，
 * 失败时一个字节都不写；直给表里出现 version / colors 这两个保留字也会明确拒绝，
 * 不静默丢标签）。
 */
export function encodeLabelsTable(table) {
  try {
    return stringifyLabelColors(table)
  } catch (e) {
    return { ok: false, reason: 'bad-shape', message: String((e && e.message) || e || '拼装失败') }
  }
  // 注：stringifyLabelColors 从不抛错（任何输入都按档位回），上面这支 catch 只是防御。
}

export default { decodeLabelsText, decodeLabelsParsed, encodeLabelsTable }
