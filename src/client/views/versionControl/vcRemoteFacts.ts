// views/versionControl/vcRemoteFacts.ts —— 「远端与同步」页的同步事实格（#1841，对应定稿原型第 39 张）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回同一个闭包，跨叶引用用 declare。
//
// 这一页最先要回答的不是「能做什么」，而是「这支仓库现在处于什么状态」：
//   当前分支、与上游差多少、这些数字读于什么时候、远端依据来自哪次读取、工作区里有多少改动。
// 五条事实都由页面壳已经读到的同一份首屏种子（seed）与首屏工作区计数折成，不在这里另发读数。
// 缺读数时写占位符，绝不写 0：0 是一个读数，「不知道」不是 0。
// 事实格的形状（dt/dd、色调、两列与窄档一列）由 vcPageHead.ts 的 vcPageFactGridNode 统一画，这里只出数据，
// 不碰 DOM、不写内联样式，也不决定字号与间距。

/** 空读数的统一占位：短破折号配 muted 色调，表示「这里本来会有一个值，这次没读到」。 */
const VC_REMOTE_EMPTY = '—'

/**
 * 同步状态：分离头指针时点名它（这时超前与落后不适用，不能画成 0/0）；
 * 有分支与计数时写「超前 N · 落后 M」；两者都不成立时给占位。
 * 返回 value 与 tone：warn 用于「读数在，但这是一种需要人注意的状态」。
 */
const vcRemoteSyncFactOf = function (t: any, seed: any) {
  if (seed.detached === true) return { value: t('vc.sync.detached'), tone: 'warn' }
  if (!String(seed.branch || '')) return { value: VC_REMOTE_EMPTY, tone: 'muted' }
  if (typeof seed.ahead !== 'number' && typeof seed.behind !== 'number') return { value: VC_REMOTE_EMPTY, tone: 'muted' }
  return {
    value: t('vc.sync.aheadBehind', {
      ahead: String(Math.max(0, Number(seed.ahead || 0))),
      behind: String(Math.max(0, Number(seed.behind || 0))),
    }),
    tone: '',
  }
}

/**
 * 工作区改动：三个计数一起写；没有这份读数时整格给占位，不写「0 个已暂存」。
 * 有冲突时整格用 warn 色调——冲突会拦住拉取与切换，是这一页最该先看见的事。
 */
const vcRemoteChangesFactOf = function (t: any, changes: any) {
  const counts = changes && changes.counts ? changes.counts : null
  if (!counts) return { value: VC_REMOTE_EMPTY, tone: 'muted' }
  return {
    value: t('vc.remote.fact.changesValue', {
      staged: String(Math.max(0, Number(counts.staged || 0))),
      unstaged: String(Math.max(0, Number(counts.unstaged || 0))),
      conflicts: String(Math.max(0, Number(counts.conflicts || 0))),
    }),
    tone: Number(counts.conflicts || 0) > 0 ? 'warn' : '',
  }
}

/**
 * 五条事实，顺序照原型第 39 张：当前分支、同步状态、读取于、远端依据、工作区改动。
 * seed 是页面壳的 vcRealSeedOf 结果（branch / when / basisWhen / ahead / behind / detached），
 * changes 是首屏工作区片（counts.staged / unstaged / conflicts）。两者都可缺，缺的那一格写占位。
 * 返回的 key 是词条键（由事实格原语过 t），不是已经译好的标签。
 */
export const vcRemoteFactsOf = function (t: any, seed: any, changes: any) {
  const s = seed || {}
  const syncFact = vcRemoteSyncFactOf(t, s)
  const changesFact = vcRemoteChangesFactOf(t, changes)
  return [
    { key: 'vc.remote.fact.branch', value: String(s.branch || VC_REMOTE_EMPTY), mono: true, tone: s.branch ? '' : 'muted' },
    { key: 'vc.remote.fact.sync', value: syncFact.value, tone: syncFact.tone },
    { key: 'vc.remote.fact.readAt', value: String(s.when || VC_REMOTE_EMPTY), tone: s.when ? '' : 'muted' },
    { key: 'vc.remote.fact.basis', value: String(s.basisWhen || t('vc.remote.fact.basisUnknown')), tone: s.basisWhen ? '' : 'muted' },
    { key: 'vc.remote.fact.changes', value: changesFact.value, tone: changesFact.tone },
  ]
}
