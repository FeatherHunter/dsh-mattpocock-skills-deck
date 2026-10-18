// src/host/platform/refreshAssembly.ts —— 从同目录 refreshAssembly.js 逐行转写而来，只加类型标注与注释，运行时逻辑一个字未动。
//
// 为什么要转写这一份：行级增量那半边在宿主里的装配点，转成 TypeScript 后接线形状可见，
//   依赖仍由宿主接线方现取现传，本文件不判断任何业务。
// 什么约定不能改：
//   1. 本文件只做一件事：把行级增量跑腿件读进来，并把共享层那一份时间窗与水印规则一起交给它。
//   2. 住在 src/host/platform/ 的理由与代价见文件头原注释：同层互引门禁把 src/host 整棵树算作宿主层，
//      装配点落在宿主层之外才能不新增同层边，备选见 #723 交付报告第 6 节。
//   3. 相对导入一律保留 .js 后缀，运行时由 scripts/ts-hook.mjs 改指同名 .ts，本文件不改说明符。
//   4. 只写可剥离类型：类型一律就地声明或经 import type 引入，不新增任何运行时边。
//   5. 本文件自己不记日志：跑腿件按需落的那一行事件与字段都没变。
import { createPatch } from '../refresh/patch.js'
import * as indexWindow from '../../shared/tracker/indexWindow.js'

// 装一个行级增量跑腿件。deps 原样转给 patch.js（它的依赖清单见那个文件的文件头），
// 只是把 windowRules 固定成共享层那一个模块 —— 时间窗与水印的规则只许有一份真源。
export function createPatchForHost(deps: Record<string, any> | null | undefined): ReturnType<typeof createPatch> {
  return createPatch(Object.assign({}, deps || {}, { windowRules: indexWindow }))
}

// 这一层读的是哪几个文件（给排查与门禁看：这两条边就是这个文件存在的理由）。
export const REFRESH_ASSEMBLY_FILES = Object.freeze([
  'src/host/refresh/patch.js',
  'src/shared/tracker/indexWindow.js',
])
