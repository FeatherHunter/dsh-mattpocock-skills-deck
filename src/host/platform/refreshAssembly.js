// src/host/platform/refreshAssembly.js —— 行级增量那半边在宿主里的装配点（#723 T19c · 第 E 件）
//
// 这个文件只做一件事：把 src/host/refresh/patch.js 的行级增量跑腿件读进来，并把它的纯逻辑入口
// （src/shared/tracker/indexWindow.js 的时间窗与水印规则）一起交给它。依赖（读快照 / 写快照 /
// 探测索引 / 跑 gh / 取仓库键 / 过闸）全部由宿主接线方现取现传，本文件不判断任何业务。
//
// 为什么住在 src/host/platform/：与同目录的 deckToolsAssembly.js 同一个理由 —— 同层互引门禁
// （tests/verify-no-same-layer-import.js）把 src/host/ 整棵树算作「宿主层」，宿主层里的文件之间
// 不许互相引用；patch.js 也在宿主层里，所以「谁把它读进来」这件事落在宿主层的文件上就要新增一条
// 同层引用边。代价与备选见 #723 交付报告第 6 节。
//
// 日志：本文件自己不记日志。patch.js 每一次跑都会按需落一行 refresh.patch（事件与字段都没变）。
import { createPatch } from '../refresh/patch.js'
import * as indexWindow from '../../shared/tracker/indexWindow.js'

/**
 * 装一个行级增量跑腿件。deps 原样转给 patch.js（它的依赖清单见那个文件的文件头），
 * 只是把 windowRules 固定成共享层那一个模块 —— 时间窗与水印的规则只许有一份真源。
 */
export function createPatchForHost(deps) {
  return createPatch(Object.assign({}, deps || {}, { windowRules: indexWindow }))
}

/** 这一层读的是哪几个文件（给排查与门禁看：这两条边就是这个文件存在的理由）。 */
export const REFRESH_ASSEMBLY_FILES = Object.freeze([
  'src/host/refresh/patch.js',
  'src/shared/tracker/indexWindow.js',
])
