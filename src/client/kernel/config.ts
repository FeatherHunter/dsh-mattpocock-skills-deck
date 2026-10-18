/**
 * src/client/kernel/config.ts — 内核模块（阶段 2 内核迁移 · #96 T3）。
 *
 * 为什么模板读写要收在这里：动作模板有旧键快照与设置文件两份来源，哪份赢、写回走哪条路，
 * 一旦散到各处就会出现两份真相，所以来源合并与写回兜底只住在这里，别处只调 tplText 与 saveTemplates。
 * 契约：本文件为模块真源（行首 export 形态由构建拼回 index.js apply 闭包内原位）；
 * 接口冻结清单见 docs/architecture/kernel-contract.md。settings-templates 就绪前写回走旧键兜底。
 * 本文件由 config.js 转写而来，只加类型标注，运行行为一字不改。
 * 反例：不要在这里新增配置键（旧 dsws.cfg 整块已按 #1012 删除），不要在这里决定模板长什么样。
 */
declare const localStorage: any;
declare function log(...args: any[]): any;
declare function backendParamsFor(...args: any[]): any;
declare function promptTextFor(...args: any[]): any;
declare function promptText(...args: any[]): any;
    export const TPL_KEY: string = 'dsws.templates'
    // #519 落地 A：配置页模板编辑入口已删，只删人改入口。已存模板按“忽略旧模板”处理
    export const templates: any = (function (): any {
      const d: any = { diagnose: '', fix: '', discuss: '', research: '', prototype: '', takeover: '', supplement: '', execute: '', handoff1: '', handoff2: '', fixate: '' }
      try {
        const raw: any = localStorage.getItem(TPL_KEY)
        if (raw) return Object.assign(d, JSON.parse(raw))
      } catch (e) { try { log('warn', 'storage.fail', { key: TPL_KEY, op: 'read' }) } catch (eL) {} }
      return d
    })()
    const tplLegacyWriteAll = function (): boolean {
      try { localStorage.setItem(TPL_KEY, JSON.stringify(templates)); return true }
      catch (e) { try { log('warn', 'storage.fail', { key: TPL_KEY, op: 'write' }) } catch (eL) {} ; return false }
    }
    // 「整份模板交给设置文件」这件事的接手人：kernel/settings-templates.js 在自己末尾装上它。
    let tplSaveAllToSettings: any = null
    export const saveTemplates = function (): boolean {
      let took: boolean = false
      try { if (typeof tplSaveAllToSettings === 'function') took = (tplSaveAllToSettings() === true) } catch (e) { took = false }
      if (took) return true
      tplLegacyWriteAll()
      return false
    }
    export const PH: string[] = ['url', 'number', 'title', 'ts', 'file', 'path']
    // 各模板可用占位符（编辑器 chips 展示）
    export const TPL_PH: any = {
      diagnose: ['url'], fix: ['url'], discuss: ['url'], research: ['url'], prototype: ['url'], takeover: ['url'], supplement: ['url'], execute: ['number', 'url', 'title'],
      handoff1: ['ts'], handoff2: ['path', 'file'], fixate: [],
    }
    // 强制占位符表（T1 规格 §3）：缺失拒绝保存
    export const TPL_REQUIRED: any = {
      diagnose: ['url'], fix: ['url'], discuss: ['url'], research: ['url'], prototype: ['url'], takeover: ['url'], supplement: ['url'], execute: ['url'],
      handoff1: ['ts'], handoff2: ['path'], fixate: [],
    }
    // 默认模板文本（空 = 用默认；T1 规格 §3 默认文本 = 现状代码文本）
    export const TPL_DEFAULT: any = {
      diagnose: function (st: any): any { return promptTextFor(st, 'tpl.diagnose') },
      fix: function (st: any): any { return promptTextFor(st, 'tpl.fix') },
      discuss: function (st: any): any { return promptTextFor(st, 'tpl.discuss') },
      research: function (st: any): any { return promptTextFor(st, 'tpl.research') },
      prototype: function (st: any): any { return promptTextFor(st, 'tpl.prototype') },
      takeover: function (st: any): any { return promptTextFor(st, 'tpl.takeover') },
      supplement: function (st: any): any { return promptTextFor(st, 'tpl.supplement') },
      execute: function (st: any): any { return promptTextFor(st, 'tpl.execute') },
      handoff1: function (): any { return promptText('tpl.handoff1') },
      handoff2: function (): any { return promptText('tpl.handoff2') },
      fixate: function (st: any): any { return promptTextFor(st, 'fixate') },
    }
    export const tplText = (id: any, st: any): string => templates[id] || (TPL_DEFAULT[id] ? TPL_DEFAULT[id](st) : '')
    // 渲染：转义 {{x}} → 字面 {x}，再替换已知占位符；未知占位符保留原样（保存层已拦截）
    export const renderTemplate = function (id: any, values: any, st: any): string {
      let text: string = String(tplText(id, st))
      const vals: any = (typeof backendParamsFor === 'function') ? backendParamsFor(st, values) : (values || {})
      const esc: string[] = []
      text = text.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, function (m: string, name: string): string { esc.push('{' + name + '}'); return '\u0001' + (esc.length - 1) + '\u0001' })
      text = text.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, function (m: string, name: string): string {
        return Object.prototype.hasOwnProperty.call(vals, name) ? String(vals[name]) : m
      })
      esc.forEach(function (s: string, i: number): void { text = text.replace('\u0001' + i + '\u0001', s) })
      return text
    }
    // #595：模板里可写的按后端填空标记通道，清单留空（#725 后无此类标记）
    export const TPL_BACKEND_MARKERS: any[] = []
    // 校验：转义预处理 → 未知占位符检测 → 强制占位符缺失检测（T1 规格 §4 顺序）
    export const validateTemplate = function (id: any, text: any): any {
      const found: string[] = []
      const scrubbed: string = String(text || '').replace(/\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/g, '')
      const re: RegExp = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g
      let m: any
      while ((m = re.exec(scrubbed)) !== null) found.push(m[1])
      const unknown: string[] = []
      found.forEach(function (n: string): void { if (PH.indexOf(n) < 0 && TPL_BACKEND_MARKERS.indexOf(n) < 0 && unknown.indexOf(n) < 0) unknown.push(n) })
      const missing: string[] = []
      ;(TPL_REQUIRED[id] || []).forEach(function (n: string): void { if (found.indexOf(n) < 0 && missing.indexOf(n) < 0) missing.push(n) })
      return { ok: unknown.length === 0 && missing.length === 0, unknown: unknown, missing: missing }
    }
    export const fixateText = (st: any): string => tplText('fixate', st)
