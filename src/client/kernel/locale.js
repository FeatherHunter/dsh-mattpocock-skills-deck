/**
 * src/client/kernel/locale.js — 内核模块（#458 瘦身为合并器：只留 L 合并三个片段，key 一个不改只搬家）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 片段真源见 locale-panel.js（导航、面板、横幅、环境、初始化引导）/ locale-flow.js（动作、类型、列表、配置、详情、地图、提示）/ locale-word.js（技能、检查、浮层、命名、切换、进度、错误、模板、运行、技能描述）；本文件只做合并，行为零变化。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    export const L = {
      zh: Object.assign({}, L_PANEL.zh, L_FLOW.zh, L_WORD.zh),
      en: Object.assign({}, L_PANEL.en, L_FLOW.en, L_WORD.en),
    }
