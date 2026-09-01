/**
 * src/client/kernel/config.js — 内核模块（阶段 2 内核迁移 · #96 T3）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    export const CFG_KEY = 'dsws.cfg'
    // 功能配置（用户拍板 2026-08-14：外观图标/动作词由设计定死，不提供配置项）
    // v1.4：打开位置 cfg.openIn —— 检测到 dsh-better-sidebar 已装则默认 'sidebar'，否则 'dock'；
    //   localStorage 已有值则尊重用户选择（不覆盖）
    export const cfg = (function () {
      const bsInstalled = !!(ctx.get('betterSidebar') && typeof ctx.get('betterSidebar').registerTab === 'function')
      const d = { withWayfinder: true, openIn: bsInstalled ? 'sidebar' : 'dock' }
      try {
        const raw = localStorage.getItem(CFG_KEY)
        if (raw) {
          const saved = JSON.parse(raw)
          if (typeof saved.openIn === 'string') d.openIn = saved.openIn  // 用户已选过 → 尊重
          else d.openIn = bsInstalled ? 'sidebar' : 'dock'              // 首次 → 按安装情况默认
        }
        return Object.assign({ withWayfinder: true, openIn: 'dock' }, d)
      } catch (e) { /* 存储不可用用默认 */ }
      return d
    })()
    export const saveCfg = function () { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)) } catch (e) {} }
    // 模板存储（T2b 扩展全部动作；T2a 先承载 execute = 旧 custom）
    export const TPL_KEY = 'dsws.templates'
    export const templates = (function () {
      const d = { diagnose: '', fix: '', discuss: '', research: '', prototype: '', execute: '', handoff1: '', handoff2: '', fixate: '' }
      try {
        const raw = localStorage.getItem(TPL_KEY)
        if (raw) return Object.assign(d, JSON.parse(raw))
      } catch (e) { /* 存储不可用用默认 */ }
      return d
    })()
    export const saveTemplates = function () { try { localStorage.setItem(TPL_KEY, JSON.stringify(templates)) } catch (e) {} }
    // 迁移：旧 dsws.startCfg（{withWayfinder, custom}）→ cfg.withWayfinder + templates.execute，成功后清旧 key
    export const migrateStartCfg = function () {
      try {
        const raw = localStorage.getItem('dsws.startCfg')
        if (!raw) return
        const old = JSON.parse(raw)
        if (old && typeof old === 'object') {
          if (typeof old.withWayfinder === 'boolean') cfg.withWayfinder = old.withWayfinder
          if (typeof old.custom === 'string' && old.custom) templates.execute = old.custom
          saveCfg(); saveTemplates()
        }
        localStorage.removeItem('dsws.startCfg')
      } catch (e) { /* 迁移失败保留旧 key，下次再试 */ }
    }
    migrateStartCfg()

    // ---- v25 · T2b：动作模板引擎（T1 规格 §2-§4）----
    // 占位符全集：{url} {number} {title} {ts} {file} {path}（引导句是普通静态文本，不是占位符）
    export const PH = ['url', 'number', 'title', 'ts', 'file', 'path']
    // 各模板可用占位符（编辑器 chips 展示）
    export const TPL_PH = {
      diagnose: ['url'], fix: ['url'], discuss: ['url'], research: ['url'], prototype: ['url'], execute: ['number', 'url', 'title'],
      handoff1: ['ts'], handoff2: ['path', 'file'], fixate: [],
    }
    // 强制占位符表（T1 规格 §3）：缺失拒绝保存
    export const TPL_REQUIRED = {
      diagnose: ['url'], fix: ['url'], discuss: ['url'], research: ['url'], prototype: ['url'], execute: ['url'],
      handoff1: ['ts'], handoff2: ['path'], fixate: [],
    }
    // 默认模板文本（空 = 用默认；T1 规格 §3 默认文本 = 现状代码文本）
    export const TPL_DEFAULT = {
      // T4 #9-12：4 个动作按钮 prompt 明确化
      diagnose: function () { return promptText('tpl.diagnose') },
      fix: function () { return promptText('tpl.fix') },
      discuss: function () { return promptText('tpl.discuss') },
      research: function () { return promptText('tpl.research') },
      prototype: function () { return promptText('tpl.prototype') },
      execute: function () { return promptText('tpl.execute') },
      handoff1: function () { return promptText('tpl.handoff1') },
      handoff2: function () { return promptText('tpl.handoff2') },
      fixate: function () { return promptText('fixate') },
    }
    export const tplText = (id) => templates[id] || (TPL_DEFAULT[id] ? TPL_DEFAULT[id]() : '')
    // 渲染：转义 {{x}} → 字面 {x}（先替换哨兵防误替换），再替换已知占位符；未知占位符保留原样（保存层已拦截）
    // #77 定版：stageGate 入口与 STAGE_GATED_IDS 兜底删除 —— tpl.* 内联闸门清单为唯一形态（用户自定义模板不再自动挂闸门）
    export const renderTemplate = function (id, values) {
      let text = String(tplText(id))
      const esc = []
      text = text.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, function (m, name) { esc.push('{' + name + '}'); return '\u0001' + (esc.length - 1) + '\u0001' })
      text = text.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, function (m, name) {
        return Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : m
      })
      esc.forEach(function (s, i) { text = text.replace('\u0001' + i + '\u0001', s) })
      return text
    }
    // 校验：转义预处理 → 未知占位符检测 → 强制占位符缺失检测（T1 规格 §4 顺序）
    export const validateTemplate = function (id, text) {
      const found = []
      const scrubbed = String(text || '').replace(/\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/g, '')
      const re = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g
      let m
      while ((m = re.exec(scrubbed)) !== null) found.push(m[1])
      const unknown = []
      found.forEach(function (n) { if (PH.indexOf(n) < 0 && unknown.indexOf(n) < 0) unknown.push(n) })
      const missing = []
      ;(TPL_REQUIRED[id] || []).forEach(function (n) { if (found.indexOf(n) < 0 && missing.indexOf(n) < 0) missing.push(n) })
      return { ok: unknown.length === 0 && missing.length === 0, unknown: unknown, missing: missing }
    }
    export const fixateText = () => tplText('fixate')