/**
 * shared/version-control/exec-envelope.js — 版本管理取数失败信封（纯函数下沉）。
 *
 * 从 host/versionControl.js 搬出（原地只剩调用）：失败信封唯一真源 failPhone、
 * 取首行 firstLine、进程四种情形翻译 failureFromExec。纯函数：不读盘、不联网、不起进程。
 * failureFromExec 另认 cancelled（排队/在飞被取消）：调用方重试，不当成功。
 */

/** 失败信封的唯一真源：三条电话共用这一份形状（扁平信封，错误只有一个 kind 与一句人话）。 */
export function failPhone(kind, message, extra) { return Object.assign({ ok: false, error: { kind: kind, message: message } }, extra || {}) }

/** 取错误信息的第一行做说明；空的时候给一句兜底，不留空白。 */
export function firstLine(text) { const t = String(text || '').replace(/\r/g, '').trim(); if (!t) return 'git 没有给出说明'; const i = t.indexOf('\n'); return (i >= 0 ? t.slice(0, i) : t).slice(0, 300) }

/** 把一次进程执行的情形翻译成失败信封；成功交给调用方继续（回 null）。 */
export function failureFromExec(res, what) {
  if (!res) return null
  if (res.kind === 'cancelled') return failPhone('cancelled', what + '被取消了，可重试')
  if (res.kind === 'timeout') return failPhone('timeout', what + '超时了（' + res.timeoutMs + ' 毫秒没有回音）')
  if (res.kind === 'spawn-failed') return failPhone('spawn', what + '时起不了 git 进程：' + res.message)
  if (res.kind === 'non-zero') return failPhone('exit', what + '失败（git 退出码 ' + res.exitCode + '）：' + firstLine(res.stderr))
  return null
}

export default failureFromExec
