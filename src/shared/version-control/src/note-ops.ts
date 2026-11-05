/**
 * src/shared/version-control/src/note-ops.ts —— 提交备注（3.12）的输入口径与命令参数（#1903，纯函数）
 *
 * 为什么单独一叶：备注的读写要过票据门（docs/adr/20261004-version-control-write-path.md：
 * 任何写命令之前必须先过票据门），而「票里绑的是什么」必须在宿主预检与执行两处用同一份口径算出来 ——
 * 就是这一份。客户端本地也用它判「这句话写不写得进去」，三处吃同一套规则。
 *
 * 备注的真实存储口径由 git 决定：`git notes add -f -m <文本> <提交>` 覆盖写、`git notes remove <提交>` 删。
 * 本文件只拼 argv 与判输入形状，不碰进程、不读仓库、不拿时钟。
 */

/** 备注最长多少字：一段贴在人眼前的注解，长到超出这一屏就不是备注了，显式拒绝，不悄悄截断。 */
export const NOTE_TEXT_MAX: number = 2000
/** 提交号（引用名）最长多少字符：与历史查询那边同口径（200）。 */
export const NOTE_REV_MAX: number = 200

/**
 * 备注文本的形状：空串合法，含义是「把这条提交的备注删掉」（原型行为：清空再存就是删）。
 * 不许 NUL（会截断 argv），不许超过上限；换行是允许的，备注本来就可以写几行。
 */
export function noteTextProblem(text: any): string | null {
  const s: string = String(text === undefined || text === null ? '' : text)
  if (s.length > NOTE_TEXT_MAX) return 'too-long'
  if (s.indexOf('\u0000') >= 0) return 'bad-shape'
  return null
}

/** 提交号的形状：与 undo-ops 的引用校验同一套（不以 - 开头、无空白、无区间、无冒号、无反斜杠）。 */
export function noteRevProblem(rev: any): string | null {
  const text: string = String(rev === undefined || rev === null ? '' : rev).trim()
  if (text === '') return 'required'
  if (text.length > NOTE_REV_MAX) return 'too-long'
  if (/[\s\u0000]/.test(text)) return 'bad-shape'
  if (text.charAt(0) === '-' || text.indexOf('..') >= 0 || text.indexOf(':') >= 0 || text.indexOf('\\') >= 0) return 'bad-shape'
  return null
}

/**
 * 写备注要跑的那一条 git 命令的参数（不含固定前缀与 -C，那是宿主唯一出口补的）。
 * 空文本 = 删除；非空 = 覆盖写入（-f：已有备注就替换，不让 git 报「already exists」把用户卡住）。
 * 提交号这一格必须已经是解析好的完整提交号：用户在确认卡上停留的几秒里引用可能被移动。
 */
export function noteArgvOf(oid: any, text: any): string[] {
  const rev: string = String(oid === undefined || oid === null ? '' : oid)
  const body: string = String(text === undefined || text === null ? '' : text)
  if (body === '') return ['notes', 'remove', rev]
  return ['notes', 'add', '-f', '-m', body, rev]
}

/** 这条动作是不是「删除」：界面按它说不同的话（保存了 / 已删除）。 */
export function noteRemovingOf(text: any): boolean {
  return String(text === undefined || text === null ? '' : text) === ''
}

/**
 * 票里绑的那份字节：提交号 + 这次要写的文本。
 * 执行前重算的是「这条提交此刻的备注原文」，与预检时记下的那份比不相等就拒绝 ——
 * 判定「变没变」的哈希在宿主做（node:crypto 不进客户端闭包）。
 */
export function notePlanInputOf(oid: any, currentNote: any): string {
  return String(oid === undefined || oid === null ? '' : oid) + '\u0000' + String(currentNote === undefined || currentNote === null ? '' : currentNote)
}

export const NOTE_OPS_SOURCE = 'src/shared/version-control/src/note-ops.ts'
