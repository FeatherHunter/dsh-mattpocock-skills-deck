/**
 * views/shared/DebugSwitchFailHint.js —— 调试开关写失败时挑哪条提示（#597 由 SettingsPage.js 拆出）。
 *
 * 底座（日志客户端引擎）写开关失败时只回机器码，不回面向用户的话；这里把机器码翻成词条键，
 * 让界面能说清是哪一类失败，而不是每次都一句笼统的「开关保存失败，请重试」。
 * 认不出的码（含通用抛错 throw）一律回落通用的那一句，界面行为与拆出前一致。
 */
export const DBG_SWITCH_FAIL_KEY = {
  'host-unavailable': 'cfg.dbgSwitchFailNoHost',
  'throw-connection': 'cfg.dbgSwitchFailNoHost',
  'switch-timeout': 'cfg.dbgSwitchFailTimeout',
  'host-rejected': 'cfg.dbgSwitchFailRejected',
  'stale': 'cfg.dbgSwitchFailStale',
  'throw-unknown-endpoint': 'cfg.dbgSwitchFailUnknownEndpoint',
}
export const dbgSwitchFailKey = (res) => DBG_SWITCH_FAIL_KEY[String((res && res.error) || '')] || 'cfg.dbgSwitchFail'
