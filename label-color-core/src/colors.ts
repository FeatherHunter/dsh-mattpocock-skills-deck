/**
 * label-color-core/src/colors.ts —— 色值的归一化、合法性判断、比较，以及「只挑出真正变了的行」
 *
 * 为什么这件事要收在一处：宿主侧要按同一套口径判断某个标签的颜色有没有变（变了才发请求），
 * 客户端侧要按同一套口径判断用户填进去的值能不能用。两边各写一份，迟早会漂移
 * （仓库里同族的默认色表就有五处，其中一处把 `9D7CD8` 写成了大写，正是这种漂移的既成事实），
 * 所以两件事都放在这里，宿主与客户端引同一份产物。
 *
 * 空值语义（2026-09-13 由总工裁决，四条，实现时不要自行改动）：
 * 1. 归一化 = 去掉开头的井号、转成小写、去掉首尾空白；
 * 2. colorsDiffer(a, b)：两边归一化后相等就算「没变」，包括两边都是空串、或两边是
 *    同一个非法值；不相等就算「变了」；
 * 3. 「值是否合法」由 isColor 单独判定，不参与相等比较：两个不同的非法值算「变了」，
 *    照常发给后端，由后端按解析档报错（后端不做本地校验是既有口径）；
 * 4. pickChangedRows 只挑 colorsDiffer 为真的行。
 *
 * 第 2 条的依据是一个真实反例：契约层允许颜色是空串（表示这个标签还没配颜色），
 * 如果按「任一边归一化失败就当作不同」来写，colorsDiffer('', '') 会返回真，
 * 于是每一条还没配色的标签都会被算成「改过了」，用户一保存就白发一批请求。
 * 同一件事还说明：isColor('') 为假，不代表 colorsDiffer('', '') 要为真——
 * 「合法不合法」与「有没有变」是两件事，必须分开判。
 */
import type { ColorChange, LabelColorRow } from './ports.js'

/**
 * 只做归一化，不判合法性，任何输入都能得到一个字符串。
 *
 * 不是字符串的输入（null、undefined、数字等）一律当作空串：在这件事上「没给值」
 * 与「给了空值」是同一件事，都表示这个标签还没配颜色。
 * 三步的顺序是先去掉首尾空白、再摘掉开头的井号、最后转小写：用户从别处复制来的值
 * 常常带空白，先去干净，井号才真的在开头；摘掉之后剩下的部分也再清一次空白。
 */
function normalizeForCompare(value: unknown): string {
  let text = typeof value === 'string' ? value.trim() : ''
  if (text.startsWith('#')) text = text.slice(1)
  return text.trim().toLowerCase()
}

/** 六位十六进制才算合法颜色（大小写都收，井号可有可无，判断前先归一化）。 */
const COLOR_PATTERN = /^[0-9a-f]{6}$/

/**
 * 把用户能写出来的各种写法收成一种：不带井号的小写六位。
 * 例如 `'#8B5CF6'`、`'8b5cf6'`、`'  #8B5CF6  '` 都得到 `'8b5cf6'`。
 *
 * 不是六位十六进制一律返回 null——不做纠正、不猜：`'8b5cf'`（少一位）、
 * `'8b5cf6ff'`（多两位）、`'gggggg'`、空串都返回 null。
 * 注意 null 只表示「这个值不合法」，它不等于「这个标签没有颜色」的意思：
 * 空串也不合法，也返回 null，而「没有颜色」是靠空串本身表达的。
 */
export function normalizeColor(input: unknown): string | null {
  const normalized = normalizeForCompare(input)
  return COLOR_PATTERN.test(normalized) ? normalized : null
}

/**
 * 这个值能不能当颜色用（同一套口径的合法性判断）。
 * 空串、null、undefined、位数不对、含非十六进制字符都算不合法。
 * 空串不合法这件事是有意的：界面上「还没配颜色」应该显示成灰，而不是显示成一个颜色。
 */
export function isColor(value: unknown): boolean {
  return normalizeColor(value) !== null
}

/**
 * 两边是不是「不一样」，也就是这次要不要为这个标签发一条改动。
 *
 * 判据只有一条：两边按同一条归一化规则收完之后相不相等，相等就是没变、不发送。
 * 这里不看值合不合法（那是 isColor 的事）：两个不同的非法值也是「用户改了点什么」，
 * 该照常发给后端、由后端按解析档报错；而两边是同一个非法值时并没有变化，不必发。
 */
export function colorsDiffer(current: string | null, next: string | null): boolean {
  return normalizeForCompare(current) !== normalizeForCompare(next)
}

/**
 * 从「后端刚给的那份清单」与「用户改过的那些行」里挑出真正变了的行。
 *
 * baseline 是后端刚给的一份清单；draft 是用户动过的行，键是标签名、值是用户填的颜色。
 * 只有 draft 里出现的名字会被检查——draft 里没有的名字表示用户没碰过它，不算改动；
 * 这条是照原型的做法定的（prototype 里草稿表只装被改过的行，保存时也是按它的键走）。
 * 两种情形算一项改动：
 *   - 清单里有这个标签，且用户填的值与清单里的颜色不一样；
 *   - 清单里根本没有这个标签（名字打错或标签已被删掉都会这样）：此时按「这个标签
 *     还没配颜色」与用户填的值比，挑出来交给后端裁决「标签不存在」，界面不自己判——
 *     界面自己判就要为每个后端各写一遍，还会与后端的判定打架。
 * 送出去的值一律先做归一化（不带井号的小写六位），与契约层「穿过契约只有一种写法」
 * 的口径一致。是不是一个合法颜色不在这里拦：两个不同的非法值也算改动，照常发送，
 * 由后端按解析档报错。
 * 返回的顺序跟 draft 里键的出现顺序一致，调用方按这个顺序展示逐条结果即可。
 */
export function pickChangedRows(baseline: LabelColorRow[], draft: Record<string, string>): ColorChange[] {
  const currentByName = new Map<string, string>()
  for (const row of baseline) currentByName.set(row.name, row.color)

  const changed: ColorChange[] = []
  for (const name of Object.keys(draft)) {
    const next = draft[name]
    const current = currentByName.get(name) ?? ''
    if (!colorsDiffer(current, next)) continue
    changed.push({ name, color: normalizeForCompare(next) })
  }
  return changed
}
