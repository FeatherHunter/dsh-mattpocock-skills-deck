/**
 * tracker/index.js — 契约层（主缝）模块入口（**纯聚合导出**）。
 *
 * 第一性原理（#132 定决 Q5）：契约层只导出「定义与机制」，不做装配——
 * 装配（内置后端注册 + host 薄装配器）归 #113/#114 下游 God-split 轮；
 * 曾有的 createTrackerHost（旧 register(backend,probe)/setWorkspace API）零调用方，
 * 与新版 registry（BackendModule/select/bind）不相容，已删除，避免陈旧 API 混入契约层。
 */

export { TRACKER_CONTRACT, OPERATIONS, NORMALIZE_RULES } from './contract.js'
export { createRegistry, TrackerRegistryError, MIGRATE_KEY, TRACKER_REGISTRY } from './registry.js'
export { diagnoseCapabilities, hasField, isEmpty, CAPABILITY } from './capability.js'
export { classifyError, fail, PREFLIGHT } from './preflight.js'
export { createSnapshotComposer, SNAPSHOT } from './snapshot.js'
export { deriveDeck, parseProgress, DECK_DERIVE } from '../../shared/tracker/deck-derive.js'
