/**
 * src/host/fsAbsence.ts —— 「这个文件确实不存在」的判据（来源：src/host/fsAbsence.js，#858 踩过一次的契约事实；本次只加类型标注与注释，逻辑一行未动）。
 *
 * 为什么要有它（一句话）：读文件失败有两种完全不同的意思，一种是文件本来就不在（用默认值顶上就行），一种是读的过程中真出了错（要当失败报）。判错了会把小事办大。
 *
 * 判据为什么是这三个码（改之前先看文件头原来那段注释）：
 * DSH 的文件服务对外抛的是 FsError，缺失的码是 FS_NOT_FOUND，不是 Node 的 ENOENT（源码 dsh-fs/lib/index.js 里 Win32 的 ERROR_PATH_NOT_FOUND 只是它内部映射，对外抛的是 `new FsError(..., "FS_NOT_FOUND")`）。只认 ENOENT 会把「文件不存在」当成输入输出错误，于是「读四个运行中标记文件（正常仓库里它们全都不存在）」这条路必然失败，首屏整条读不出来，界面上还被说成找不到程序。
 * 反例：如果把权限不足也算成不存在，就会用默认内容把用户手写的东西整份覆盖，那是真实的数据丢失，所以判据故意定得窄。
 */

// ---------------------------------------------------------------------------
// 类型（本次转 TypeScript：只写类型不写实现）。
//
// 为什么标成这样：判据函数的输入是外部抛出来的未知错误对象，形状不可信，所以按 unknown 收，只读其中 code 一格，类型不替代运行时的 typeof 判断。
// ---------------------------------------------------------------------------

/** 文件缺失的错误码常量：DSH 文件服务的 FS_NOT_FOUND。导出名不许改，调用点按这个名字读它。 */
export const FS_NOT_FOUND: string = 'FS_NOT_FOUND'

/** 明确「没有」的码：Node 的 ENOENT 与 ENOTDIR，加 DSH 文件服务的 FS_NOT_FOUND。 */
const ABSENCE_CODES: string[] = ['ENOENT', 'ENOTDIR', FS_NOT_FOUND]

/**
 * 判断一个错误是不是「文件确实不存在」。
 *
 * 为什么：调用点靠它决定走「用默认值顶上」还是走「当失败报」，两条路差的是用户看不看得到报错。
 * 什么约定不能改：只认码不认信息，码不在上面那份名单里就一律算不是缺失，哪怕信息里写着找不到。
 */
export function isAbsenceError(e: unknown): boolean {
  const code: unknown = (e as { code?: unknown } | null | undefined) && (e as { code?: unknown }).code
  return typeof code === 'string' && ABSENCE_CODES.indexOf(code) >= 0
}

/** 这份判据的出处：排查时凭它找到这份文件。 */
export const FS_ABSENCE_SOURCE: string = 'src/host/fsAbsence.js'
