// views/versionControl/vcDiffOps.js — 差异与提交那几路的动作（#857：从组件里抽出来的一层）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回 src/client/index.js。
//
// 为什么抽出来：组件已经贴着 350 行上限，而这一族动作要装三件事 ——
//   ① 读某一处差异、某一笔提交的文件清单与某一笔提交里某个文件的补丁（按需，不预读）；
//   ② 回包落地前的两道闸：stale drop（晚到的旧回包不许顶掉新的）与工作区校验（换工作区后在飞的那一枪不许写进新工作区）；
//   ③ 同键在途不重复发（每一次 wf.gitDiff 在宿主那边都要起一个 git 进程，连点就是白起）。
// 抽出来之后组件只剩「调它」，这三条也终于有个能单独验收的地方。
/**
 * 差异/提交那一族的动作。
 * 入参形状与组件里原来那几个闭包一致：ui / setUi / setReads / readsRef / callHost / cwd / stateCwdRef，
 * 再加数据层的读与落库函数（vcRead* / vcApply* / vcMark* 全部由调用方注入进来，本文件不直接 import）。
 */
export const vcDiffOpsOf = function (o) {
  const ui = o.ui, setUi = o.setUi, setReads = o.setReads, readsRef = o.readsRef
  const callHost = o.callHost, cwd = o.cwd, stateCwdRef = o.stateCwdRef
  const vcDiffOpenKeyOf = o.vcDiffOpenKeyOf, vcReadDiff = o.vcReadDiff, vcReadCommitFiles = o.vcReadCommitFiles
  const vcReadCommitFileDiff = o.vcReadCommitFileDiff, vcApplyDiffReply = o.vcApplyDiffReply
  const vcApplyCommitReply = o.vcApplyCommitReply, vcReadsOf = o.vcReadsOf
  const vcMarkDiffLoading = o.vcMarkDiffLoading, vcMarkCommitLoading = o.vcMarkCommitLoading
  const vcMarkCommitFileDiffLoading = o.vcMarkCommitFileDiffLoading, vcApplyCommitFileDiffReply = o.vcApplyCommitFileDiffReply
  const onView = o.onView

  const rev = function () { return String(ui.openCommit || '') }
  const keyOf = function (row) { return vcDiffOpenKeyOf(row, ui.openCommit) }
  const loadDiff = function (row) {
    const r = rev()
    return r ? vcReadCommitFileDiff(readsRef.current, callHost, cwd, r, row.path)
      : vcReadDiff(readsRef.current, callHost, cwd, row.path, row.untracked === true)
  }
  const entryOf = function (row) {
    const r = rev()
    return r ? (((readsRef.current.commitDiffs || {})[keyOf(row)]) || { state: 'idle' }) : vcReadsOf(readsRef.current, row.path)
  }
  // 回包落地的两道闸：工作区变了直接丢（#857 P2），同一键里代际号更小的直接丢（#857 P1）。
  // 提交里某一处文件的补丁走 commitDiffs 那张表，所以要按模式选落库函数；直接复用未提交路会把新回包丢掉。
  const applyFile = function (next, isCommitFile) {
    if (stateCwdRef && stateCwdRef.current !== cwd) return
    if (isCommitFile) { setReads(function (cur) { return vcApplyCommitFileDiffReply(cur, next) }); return }
    setReads(function (cur) { return vcApplyDiffReply(cur, next) })
  }
  const applyCommit = function (next) {
    if (stateCwdRef && stateCwdRef.current !== cwd) return
    setReads(function (cur) { return vcApplyCommitReply(cur, next) })
  }
  const toggleDiff = function (row) {
    const key = keyOf(row)
    if (ui.openDiff === key) { setUi(Object.assign({}, ui, { openDiff: '' })); return }
    setUi(Object.assign({}, ui, { openDiff: key }))
    // 同键在途不重复发（P4）：loading 也跳过，每一次 wf.gitDiff 在宿主那边都要起一个 git 进程。
    // 先同步写 loading 标记，否则两次点击之间读数没变，第二枪照发。
    const st = entryOf(row).state
    if (st === 'ok' || st === 'loading') return
    const isCommitFile = rev() !== ''
    // 未提交那一路的缓存键就是裸路径（vcReadDiff / vcReadsOf 都按路径存取），不能拿复合展开键去标记，否则标记和数据落在两个键上。
    if (isCommitFile) setReads(vcMarkCommitFileDiffLoading(readsRef.current, rev(), row.path))
    else setReads(vcMarkDiffLoading(readsRef.current, row.path))
    loadDiff(row).then(function (next) { applyFile(next, isCommitFile) })
  }
  const retryDiff = function (row) {
    const isCommitFile = rev() !== ''
    if (isCommitFile) setReads(vcMarkCommitFileDiffLoading(readsRef.current, rev(), row.path))
    else setReads(vcMarkDiffLoading(readsRef.current, row.path))
    loadDiff(row).then(function (next) { applyFile(next, isCommitFile) })
  }
  const openCommit = function (c) {
    const r = String(c.key || '')
    // #853 第三步：点开某一笔提交就落在「提交历史」视图（那笔提交的文件清单画在那里）。
    // #881：已经在提交历史里时这次跳转是多余的，但要保留它来记住视图；顺序不能反 ——
    //   切页签那条老路每次都清空正在看的提交，先切再记，记的那一步才留得住；反过来会被清空盖掉，看起来就是点不动。
    if (typeof onView === 'function') onView('commits')
    setUi(function (cur) { return Object.assign({}, cur, { openCommit: r, openDiff: '' }) })
    const entry = readsRef.current.commit || {}
    if (entry.rev === r && (entry.state === 'ok' || entry.state === 'loading')) return
    setReads(vcMarkCommitLoading(readsRef.current, r))
    vcReadCommitFiles(readsRef.current, callHost, cwd, r).then(applyCommit)
  }
  // 「回到未提交改动」那条路本来就指回改动页：关掉的同时把视图也带回去。
  const closeCommit = function () { setUi(Object.assign({}, ui, { openCommit: '', openDiff: '' })); if (typeof onView === 'function') onView('changes') }
  const retryCommit = function () {
    const r = rev()
    if (!r) return
    setReads(vcMarkCommitLoading(readsRef.current, r))
    vcReadCommitFiles(readsRef.current, callHost, cwd, r).then(applyCommit)
  }
  return { diffKeyOf: keyOf, entryOf: entryOf, toggleDiff: toggleDiff, retryDiff: retryDiff, openCommit: openCommit, closeCommit: closeCommit, retryCommit: retryCommit }
}
