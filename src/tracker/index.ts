/**
 * tracker/index.ts — 跟踪器契约层的模块入口（**纯聚合导出**）。
 *
 * 第一性原理（#132 定决 Q5）：契约层只导出「定义与机制」，不做装配——
 * 装配（内置后端注册 + host 薄装配器）归 #113/#114 下游 God-split 轮；
 * 曾有的 createTrackerHost（旧 register(backend,probe)/setWorkspace API）零调用方，
 * 与新版 registry（BackendModule/select/bind）不相容，已删除，避免陈旧 API 混入契约层。
 *
 * 跨代接缝（口径见规格单 #1110 实现决定第 16 条）：下面那行
 * `export { createSnapshotComposer, SNAPSHOT } from '../host/tracker/snapshot.js'`
 * 指向的是**旧家**。2026-10-13 那次目录归位（#1019）把跟踪器这一整片搬进 src/tracker/，
 * 但快照组装那几件留在 src/host/tracker/ 没搬，今天仍是手写 .js；本入口照旧把它再导出，
 * 不改它的行为。写清这三件事，是免得后来人以为这是一处忘了搬的疏漏：
 *   1. 指向旧家的哪一件：`src/host/tracker/snapshot.js`（快照组装那件，与它同住的还有
 *      capability.js、generic.js、predicateCore.js、predicatePrimitives.js）。
 *   2. 为什么留：快照组装做的是宿主侧装配的事（谁去问平台、按什么顺序拼出一份快照），
 *      契约层只需要把它的名字挂在同一个出口上，调用方少记一个路径；单独搬这一件会把
 *      「新树」这条缝撕开，于是它按搬迁时的边界留在原处，本票（#1044）也不动它。
 *   3. 什么时候能收：等 src/host/tracker/ 剩下那几件整体迁移时一起搬（范围外，今天还没有
 *      点名的票），届时把这一行的来源改到新家。在那之前，无论谁改本文件，导出的名字都不许变。
 */

export { TRACKER_CONTRACT, OPERATIONS, NORMALIZE_RULES } from './contract/index.js'
export { createRegistry, TRACKER_REGISTRY } from './registry/core.js' // V1 #461：registry.js 已拆为三块
// V1 #461：形状错误类与迁移键随 registryShape.js 搬出（聚合出口保持原名）
export { TrackerRegistryError, MIGRATE_KEY } from './registry/registryShape.js'
export { diagnoseCapabilities, hasField, isEmpty, CAPABILITY } from '../host/tracker/capability.js'
export { classifyError, fail, PREFLIGHT } from './preflight.js'
export { createSnapshotComposer, SNAPSHOT } from '../host/tracker/snapshot.js'
export { deriveDeck, parseProgress, DECK_DERIVE } from './deck-derive.js'
