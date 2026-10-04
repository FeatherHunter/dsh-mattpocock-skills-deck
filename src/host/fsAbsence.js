// src/host/fsAbsence.js —— 「这个文件确实不存在」的判据（#858 踩过一次的契约事实）
//
// DSH 的 fs 服务对外抛的是 FsError，缺失的 code 是 **FS_NOT_FOUND**，不是 Node 的 ENOENT
// （源码 dsh-fs/lib/index.js 里 Win32 的 ERROR_PATH_NOT_FOUND 只是它内部映射；对外抛的是
//  `new FsError(..., "FS_NOT_FOUND")`，例如「cannot list …: not found」）。只认 ENOENT 会把
// 「文件不存在」当成 IO 错误 —— 于是「读四个运行中标记文件（正常仓库里它们全都不存在）」这条路
// 必然失败，首屏整条读不出来，界面上还被说成「找不到 git 程序」。
//
// 判据放这里共享：谁拿 DSH 的 fs 服务，就照这份契约分档，别各写各的。
export const FS_NOT_FOUND = 'FS_NOT_FOUND'

/** 明确「没有」的 code：Node 的 ENOENT / ENOTDIR，加 DSH fs 服务的 FS_NOT_FOUND。 */
const ABSENCE_CODES = ['ENOENT', 'ENOTDIR', FS_NOT_FOUND]

export function isAbsenceError(e) {
  const code = e && e.code
  return typeof code === 'string' && ABSENCE_CODES.indexOf(code) >= 0
}

export const FS_ABSENCE_SOURCE = 'src/host/fsAbsence.js'
