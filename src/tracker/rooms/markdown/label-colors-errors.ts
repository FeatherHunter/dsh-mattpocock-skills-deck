// label-colors-errors.js —— 写失败分档（#614 的结论落到这个房间的版本）
//
// 人话：保存没存上时，到底该跟用户说什么，只许这一处定。
// 沙箱拒绝必须能单独辨认——那是插件自己的限制，不是用户的文件权限问题（不许说成「目录不可写」）；
// 其余按路径类 / 占用类 / 只读类 / 空间类给不同的说法；分不出来时归环境档但不说成权限问题。
// 文件位置由调用方递进来（relPath）：调用方手里本来就有这条常量，
// 这里不从别处再引一份，免得房间内部转圈引用。
import { ERROR_KIND } from '../../contract/vocabulary.js'

/** 写失败分档：入参是抛出来的错与文件相对位置，出参是 {kind, message}（直接给用户看）。 */
// kind 注成 string 而不是契约 ErrorKind：冻住的 ERROR_KIND 常量对象成员被拓宽成 string，
// 逐处断言是噪音；返回值恒为那八档之一（实现里只取 ERROR_KIND.ENV），调用方 failAs 收的正是 string。
export function describeWriteFailure(err: unknown, relPath: string): { kind: string; message: string } {
  const rel = String(relPath || '')
  // err 的形状不一（文件服务各实现抛的不一样）：经 Record 视图读码值与文本；
  // 每次访问前都有 `err &&` 守卫（与原来逐字相同的短路），cast 只为过类型。
  const er = err as Record<string, unknown>
  const message = String((err && er.message) || err || '')
  const code = String((err && (er.code || er.kind)) || '')
  if (err && er.readBackMismatch === true) {
    // 这一档能确定的只有「这次没写成功或没写全」，所以动作要带用户把最后一条退路走完：
    // 核对下来内容不对就手动补改，否则再重试一次只会拿到同一句话。
    return { kind: ERROR_KIND.ENV, message: '保存失败：写完之后重新读这个文件，读到的内容与刚写进去的不一致，因此不能确认标签颜色已经保存。请打开工作区里的标签配色文件（' + rel + '）核对内容：如果里面写的不是你想保存的那份颜色，请手动改成你想保存的颜色，然后重新保存。' }
  }
  if (code === 'FS_SANDBOX_DENIED' || /file access denied|workspace-write|read-only mode/i.test(message)) {
    return { kind: ERROR_KIND.ENV, message: '保存失败：插件没有被允许往当前工作区里写标签配色文件（' + rel + '），这个限制来自插件自己这一侧，不是你的文件权限问题，修改文件或文件夹的权限不会有帮助。请换一个允许写入的工作区，然后重试。' }
  }
  if (/ENOSPC/.test(message) || code === 'ENOSPC') {
    return { kind: ERROR_KIND.ENV, message: '保存失败：磁盘空间不足，标签颜色没有写进标签配色文件（' + rel + '）。请腾出磁盘空间，然后重试；这个标签配色文件没有被改动。' }
  }
  // EPERM / EACCES 在「临时文件 + 改名」这种发布方式下原因不止一种（研究 #614 实测：只读、被别的程序
  // 占用、目标位置被换成目录，三种都会走到改名这一步并抛同一个 EPERM），所以这里不断言单一原因，
  // 把三种可能一并说清，每种都给一句「怎么做能解决」。
  if (/EACCES|EPERM/.test(message) || code === 'EACCES' || code === 'EPERM' || code === 'FS_NOT_REGULAR_FILE') {
    return {
      kind: ERROR_KIND.ENV,
      message: '保存失败：写不进工作区里的标签配色文件（' + rel + '）。下面三种情形插件分不出是哪一种，请按实际看到的情况处理：' +
        '① 工作区里的标签配色文件（' + rel + '）正被其它程序占用（编辑器、同步盘、杀毒软件都常见），请关掉那个程序后重试；' +
        '② 工作区里的标签配色文件（' + rel + '）或它所在的目录是只读的，请去掉只读属性后重试；' +
        '③ 工作区里的标签配色文件（' + rel + '）这个位置现在是一份目录、不是文件，请删掉这份目录、把这个文件恢复成一份文件，然后重试。' +
        '这个标签配色文件没有被改动，可以重试。',
    }
  }
  // 位置不存在与位置是目录这两种情形，要办的事正好相反（一个要建、一个要删），
  // 所以拆成两条各自能照做的说法，并且都写明是在哪一份文件上做；插件认不出是哪一种，照实说。
  if (/ENOENT/.test(message) || code === 'ENOENT' || code === 'EISDIR' || code === 'FS_NOT_FOUND') {
    return {
      kind: ERROR_KIND.ENV,
      message: '保存失败：写不进工作区里的标签配色文件（' + rel + '）。写不进的情形有两种，插件分不出是哪一种，请按实际看到的情况处理：' +
        '① 这个位置上的文件不存在：请在工作区里新建这份标签配色文件（' + rel + '），它上一层的 docs/agents/ 目录还没有的话，先把这层目录一并建出来，然后重试；' +
        '② 这个位置现在是一份目录、不是文件：请先删掉这份目录，再在工作区里新建这份标签配色文件（' + rel + '），然后重试。' +
        '这两种情形下这个标签配色文件都没有被改动。',
    }
  }
  // 认不出来的一律归环境档，并说清责任在插件这边（错误原文不进给用户的文案：
  // 原子写失败时错误里的路径是临时文件名，用户会去找一个不存在的文件）。
  // 「写坏的临时文件已经清掉」这句原来对所有情形都成立、其实只对「改名失败」那一支成立，所以改成
  // 「可能留了一份写到一半的中间文件、可以直接删掉」——直写那条路上没有中间文件，两种情形都说得通。
  return { kind: ERROR_KIND.ENV, message: '保存失败：标签颜色没有写进工作区里的标签配色文件（' + rel + '），插件认不出是哪一种失败原因。这个标签配色文件没有被改动。它的同一个目录里可能留了一份写到一半的中间文件，可以直接删掉，不影响这个文件。这是插件运行环境的问题，不是你的操作有误。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者。' }
}

export default { describeWriteFailure }
