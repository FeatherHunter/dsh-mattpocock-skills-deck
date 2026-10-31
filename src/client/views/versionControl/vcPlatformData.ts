// views/versionControl/vcPlatformData.ts —— 「平台与边界」页的数据层（#1762 T26，规格 #1586 域 14 与 5.9 / 8.15）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包。
//
// 这一页有两类读法，必须分开记：平台页读取（凭据助手链与 rebase.updateRefs 两个独立查询）与
//   request-pull 生成（只读，不推送、不联网）；输出目录补丁列表归迁移页用，也记在这里，避免两页各写一份电话名。
// 两条查询互不连坐：凭据链读失败时 updateRefs 照常显示；反过来也一样。失败保留上一份数据并标旧读数，
//   界面不会拿半份冒充新读数（与 vcRemoteData.ts 的约定一致）。
//
// 三条电话名是本文件与宿主唯一对得上的接头：宿主在 src/host/versionControlPlatformRead.ts 与
//   src/host/index.ts 登记同名电话，门禁拿这一份名单逐个对账（不另写第二份字符串）。
// 渲染函数不发请求；所有读取只在用户操作时由调用方调这里的入口发起。

/** 三条只读电话的真实名字（平台页读取 / request-pull 生成 / 输出目录补丁列表）。 */
export const VC_PLATFORM_PHONES: Record<string, string> = {
  read: 'wf.gitPlatformRead',
  requestPull: 'wf.gitRequestPull',
  patchFiles: 'wf.gitPatchFiles',
}
/** 真源标识：门禁按这一行找本文件，改路径要一起改门禁。 */
export const VC_PLATFORM_DATA_SOURCE = 'src/client/views/versionControl/vcPlatformData.ts'

/** 一份全新的平台读数（刚打开、还没读过、也没有 request-pull 结果）。 */
export const vcNewPlatformReads = function () {
  return {
    platform: { state: 'idle', data: null, error: null },
    requestPull: { state: 'idle', data: null, error: null },
    patches: { state: 'idle', dir: '', data: null, error: null },
  }
}

const vcPfOkLog = function (method: any, kind: any, t0: any) {
  try { log('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) } catch (e) { /* 日志坏了不影响读数 */ }
}
const vcPfFailLog = function (method: any, kind: any, t0: any, fail: any) {
  try { log('warn', 'host.call.fail', { method: method, kind: kind, errorHash: dswsLogHash(dswsLogTrunc(String((fail && fail.kind) || '') + ' ' + String((fail && fail.message) || ''), 120, 'error')) }) } catch (e) { /* 日志坏了不影响读数 */ }
}
/** 把一份回包归一成失败：带 error 的信封按信封走，其余（含 ok:true 却缺字段）一律记 shape。 */
const vcPfFailureOf = function (reply: any) {
  if (reply && reply.ok === false) {
    const e = reply.error || {}
    return { kind: String(e.kind || 'unknown'), reason: String(e.reason || e.kind || 'unknown'), message: String(e.message || ''), hint: String(e.hint || '') }
  }
  return { kind: 'shape', reason: 'shape', message: '', hint: '' }
}
/** 平台读取回包的形状判据：读取时刻是数字、凭据与 updateRefs 两个对象都在；缺一样就按失败处理。 */
const vcPfReadShapeOk = function (data: any) {
  if (!data || typeof data.readAtMs !== 'number' || !isFinite(data.readAtMs)) return false
  return !!data.credential && !!data.updateRefs
}
const vcPfMerge = function (reads: any, key: any, next: any) {
  const base = reads || vcNewPlatformReads()
  const patch: any = {}
  patch[key] = next
  return Object.assign({}, base, patch)
}

/** 平台读取的三态（idle / loading / ok / err 原样给出，界面自己决定怎么画）。 */
export const vcPlatformStateOf = function (reads: any) {
  const r = reads && reads.platform
  return r && typeof r.state === 'string' ? r.state : 'idle'
}
/** 平台读取成功的整份数据（没成功回 null）。 */
export const vcPlatformDataOf = function (reads: any) {
  const r = reads && reads.platform
  return r && r.state === 'ok' && vcPfReadShapeOk(r.data) ? r.data : null
}
/** 平台读取失败的原因（不是 err 时回 null）。 */
export const vcPlatformErrorOf = function (reads: any) {
  const r = reads && reads.platform
  return r && r.state === 'err' ? r.error : null
}
/** 凭据助手链的读法（两个查询各自成败，只有这一份失败时不牵动 updateRefs）。 */
export const vcPlatformCredentialOf = function (reads: any) {
  const data = vcPlatformDataOf(reads)
  const c = data && data.credential
  if (!c || c.state !== 'ok') return { state: c && c.state === 'error' ? 'error' : 'idle', helpers: [], store: '', risk: 'ok', advice: 'ok', error: (c && c.error) || null }
  return {
    state: 'ok',
    helpers: Array.isArray(c.helpers) ? c.helpers.map(function (h: any) { return String(h) }) : [],
    store: String(c.store || ''),
    risk: String(c.risk || 'ok'),
    advice: String(c.advice || 'ok'),
    error: null,
  }
}
/** rebase.updateRefs 的读法：值、是否开着、这一份查询的成败。 */
export const vcPlatformUpdateRefsOf = function (reads: any) {
  const data = vcPlatformDataOf(reads)
  const u = data && data.updateRefs
  if (!u || u.state !== 'ok') return { state: u && u.state === 'error' ? 'error' : 'idle', value: '', enabled: false, error: (u && u.error) || null }
  return { state: 'ok', value: String(u.value || ''), enabled: u.enabled === true, error: null }
}
/** request-pull 生成的三态与结果。 */
export const vcPlatformRequestPullStateOf = function (reads: any) {
  const r = reads && reads.requestPull
  return r && typeof r.state === 'string' ? r.state : 'idle'
}
export const vcPlatformRequestPullOf = function (reads: any) {
  const r = reads && reads.requestPull
  if (!r || r.state !== 'ok' || !r.data || typeof r.data.text !== 'string') return null
  return r.data
}
export const vcPlatformRequestPullErrorOf = function (reads: any) {
  const r = reads && reads.requestPull
  return r && r.state === 'err' ? r.error : null
}
/** 输出目录补丁列表的三态、读取到的目录与结果。 */
export const vcPlatformPatchesStateOf = function (reads: any) {
  const r = reads && reads.patches
  return r && typeof r.state === 'string' ? r.state : 'idle'
}
export const vcPlatformPatchesOf = function (reads: any) {
  const r = reads && reads.patches
  if (!r || r.state !== 'ok' || !r.data || !Array.isArray(r.data.patches)) return null
  return r.data
}
export const vcPlatformPatchesErrorOf = function (reads: any) {
  const r = reads && reads.patches
  return r && r.state === 'err' ? r.error : null
}

/** 把一份平台读取回包落成读数：成功换掉整份数据，失败只记失败并保留上一份。 */
export const vcApplyPlatformReply = function (reads: any, reply: any) {
  const prev = (reads && reads.platform) || {}
  if (reply && reply.ok === true && vcPfReadShapeOk(reply)) {
    return vcPfMerge(reads, 'platform', { state: 'ok', data: { readAtMs: reply.readAtMs, repoRoot: String(reply.repoRoot || ''), credential: reply.credential, updateRefs: reply.updateRefs }, error: null })
  }
  return vcPfMerge(reads, 'platform', { state: 'err', data: prev.data || null, error: vcPfFailureOf(reply) })
}
/** 把 request-pull 回包落成读数；截断的回包也算成功但保留 truncated 标记，界面要如实说只显示了前一段。 */
export const vcApplyRequestPullReply = function (reads: any, reply: any) {
  const prev = (reads && reads.requestPull) || {}
  if (reply && reply.ok === true && typeof reply.text === 'string') {
    return vcPfMerge(reads, 'requestPull', { state: 'ok', data: { text: reply.text, truncated: reply.truncated === true, cmd: String(reply.cmd || 'request-pull'), ms: typeof reply.ms === 'number' ? reply.ms : null, range: String(reply.range || '') }, error: null })
  }
  return vcPfMerge(reads, 'requestPull', { state: 'err', data: prev.data || null, error: vcPfFailureOf(reply) })
}
/** 把补丁列表回包落成读数；列不出目录按失败处理，不猜「没有补丁」。 */
export const vcApplyPatchesReply = function (reads: any, reply: any, dir: any) {
  const prev = (reads && reads.patches) || {}
  if (reply && reply.ok === true && Array.isArray(reply.patches)) {
    return vcPfMerge(reads, 'patches', { state: 'ok', dir: String(reply.dir || dir || ''), data: reply, error: null })
  }
  return vcPfMerge(reads, 'patches', { state: 'err', dir: String(dir || prev.dir || ''), data: prev.data || null, error: vcPfFailureOf(reply) })
}

/** 读一次平台页数据（凭据助手链 + rebase.updateRefs）。进加载态并保留旧数据。 */
export const vcReadPlatform = function (reads: any, call: any, cwd: any) {
  const base = reads || vcNewPlatformReads()
  const prev = base.platform || { state: 'idle', data: null, error: null }
  const loading = vcPfMerge(base, 'platform', { state: 'loading', data: prev.data || null, error: null })
  const t0 = Date.now()
  return Promise.resolve()
    .then(function () { return call(VC_PLATFORM_PHONES.read, { cwd: String(cwd || '') }) })
    .then(function (reply: any) {
      if (reply && reply.ok === true && vcPfReadShapeOk(reply)) vcPfOkLog(VC_PLATFORM_PHONES.read, 'git-platform-read', t0)
      else vcPfFailLog(VC_PLATFORM_PHONES.read, 'git-platform-read', t0, vcPfFailureOf(reply))
      return vcApplyPlatformReply(loading, reply)
    })
    .catch(function (e: any) {
      const fail = { kind: 'throw', message: String((e && e.message) || e) }
      vcPfFailLog(VC_PLATFORM_PHONES.read, 'git-platform-read', t0, fail)
      return vcPfMerge(loading, 'platform', { state: 'err', data: prev.data || null, error: fail })
    })
}
/** 生成一段 request-pull 说明（只读；不推送、不联网）。 */
export const vcRunRequestPull = function (reads: any, call: any, cwd: any, form: any) {
  const base = reads || vcNewPlatformReads()
  const loading = vcPfMerge(base, 'requestPull', { state: 'loading', data: null, error: null })
  const f = form || {}
  const args = { cwd: String(cwd || ''), start: String(f.start || ''), url: String(f.url || ''), end: String(f.end || '') }
  const t0 = Date.now()
  return Promise.resolve()
    .then(function () { return call(VC_PLATFORM_PHONES.requestPull, args) })
    .then(function (reply: any) {
      if (reply && reply.ok === true && typeof reply.text === 'string') vcPfOkLog(VC_PLATFORM_PHONES.requestPull, 'git-request-pull', t0)
      else vcPfFailLog(VC_PLATFORM_PHONES.requestPull, 'git-request-pull', t0, vcPfFailureOf(reply))
      return vcApplyRequestPullReply(loading, reply)
    })
    .catch(function (e: any) {
      const fail = { kind: 'throw', message: String((e && e.message) || e) }
      vcPfFailLog(VC_PLATFORM_PHONES.requestPull, 'git-request-pull', t0, fail)
      return vcPfMerge(loading, 'requestPull', { state: 'err', data: null, error: fail })
    })
}
/** 列一次输出目录里的补丁文件（不存在的目录按 exists:false 如实说，不当成失败）。 */
export const vcReadPatchFiles = function (reads: any, call: any, cwd: any, dir: any) {
  const base = reads || vcNewPlatformReads()
  const d = String(dir || '')
  const loading = vcPfMerge(base, 'patches', { state: 'loading', dir: d, data: null, error: null })
  const t0 = Date.now()
  return Promise.resolve()
    .then(function () { return call(VC_PLATFORM_PHONES.patchFiles, { cwd: String(cwd || ''), dir: d }) })
    .then(function (reply: any) {
      if (reply && reply.ok === true && Array.isArray(reply.patches)) vcPfOkLog(VC_PLATFORM_PHONES.patchFiles, 'git-patch-files', t0)
      else vcPfFailLog(VC_PLATFORM_PHONES.patchFiles, 'git-patch-files', t0, vcPfFailureOf(reply))
      return vcApplyPatchesReply(loading, reply, d)
    })
    .catch(function (e: any) {
      const fail = { kind: 'throw', message: String((e && e.message) || e) }
      vcPfFailLog(VC_PLATFORM_PHONES.patchFiles, 'git-patch-files', t0, fail)
      return vcPfMerge(loading, 'patches', { state: 'err', dir: d, data: null, error: fail })
    })
}
