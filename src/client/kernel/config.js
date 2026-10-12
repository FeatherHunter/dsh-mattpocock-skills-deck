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
    // 2026-09-21：原来这里还有一个「打开位置」（openIn，DSH 右侧边栏 与 BetterSidebar 二选一）配置项，整项已删。
    //   现在面板只有一条路：本插件自己注册一个类型、直接开进 DSH 原生右侧边栏，不依赖任何第三方插件，
    //   所以「用哪个入口打开」不再是一个可以选的东西，设置页那一栏也随之去掉。
    //   本地存档里若还留着 openIn 的旧值，读的时候不再读它；下次写存档时它自然被覆写掉，不需要迁移。
    export const cfg = (function () {
      const d = { withWayfinder: true }
      try {
        const raw = localStorage.getItem(CFG_KEY)
        // 存档里已经没有本插件要读的键了。这里仍解析一次：存档被写坏时照旧留一行告警，内容本身不再参与配置。
        if (raw) JSON.parse(raw)
        return d
      } catch (e) { try { log('warn', 'storage.fail', { key: CFG_KEY, op: 'read' }) } catch (eL) {} }
      return d
    })()
    export const saveCfg = function () { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)) } catch (e) { try { log('warn', 'storage.fail', { key: CFG_KEY, op: 'write' }) } catch (eL) {} } }
    // 模板存储（T2b 扩展全部动作；T2a 先承载 execute = 旧 custom）
    export const TPL_KEY = 'dsws.templates'
    // #519 落地 A：配置页模板编辑入口已删，只删人改入口。已存模板值按“忽略旧模板”处理：
    // 读取仍合并旧键（旧自定义值继续对行级快捷按钮生效），设置页不再调用 saveTemplates 覆盖，
    // 动手前备份即本地存档原文不动，回滚写回即恢复本提交前的设置页写入口。
    // #1012 第 4 步：模板的新家是本机设置文件的 templates 节（读与写的分工见
    //   kernel/settings-templates.js 文件头）。下面这个 templates 对象从此是「旧键那一份与文件那一份的
    //   合体」：模块加载时它是旧键那一份的快照，文档到手那一刻文件里非空的格搬进来（文件赢）。
    export const templates = (function () {
      const d = { diagnose: '', fix: '', discuss: '', research: '', prototype: '', takeover: '', supplement: '', execute: '', handoff1: '', handoff2: '', fixate: '' }
      try {
        const raw = localStorage.getItem(TPL_KEY)
        if (raw) return Object.assign(d, JSON.parse(raw))
      } catch (e) { try { log('warn', 'storage.fail', { key: TPL_KEY, op: 'read' }) } catch (eL) {} }
      return d
    })()
    // 整份写回旧键：只有设置文件那条路接不下时才走（文件问不到、是更高版本、或拼接次序上那一族还没就绪）。
    //   为什么单留一个函数而不复用 saveTemplates：saveTemplates 这个名字在接口冻结清单
    //   docs/architecture/kernel-contract.md 里有它，它已经改成走设置文件那条路；兜底再调它就会绕回新路自己。
    //   写旧键自己失败时补一行 storage.fail（既有事件名，字段只有 key 与 op 两个，与全库其余位置一致），
    //   不再一口吞掉：兜不住这件事要能在日志里看见，不然排查时只剩「用户改过、什么都没剩下」。
    const tplLegacyWriteAll = function () {
      try { localStorage.setItem(TPL_KEY, JSON.stringify(templates)); return true }
      catch (e) { try { log('warn', 'storage.fail', { key: TPL_KEY, op: 'write' }) } catch (eL) {} ; return false }
    }
    // 「整份模板交给设置文件」这件事的接手人：kernel/settings-templates.js 在自己末尾装上它（拼接次序上那一片
    //   排在本片之后，加载这一刻它还没执行完，const 还在暂时性死区里，本片不能直接调它）。装上之前为 null，
    //   saveTemplates 会照老办法整份写旧键。
    let tplSaveAllToSettings = null
    // 旧存档 dsws.startCfg 里那一笔 custom 的待办：见下面 migrateStartCfg 与 settings-templates.js 末尾那段。
    let tplMigratePending = false
    // 把整份模板交给设置文件那条路：与文件不同的每一格交给同一个待写队列（逐格判法与理由见
    //   kernel/settings-templates.js 的 settingsTemplatesSaveAll）。返回值是给调用方看的两种意思：
    //   true ＝ 交给新路了（可能还在防抖窗口里没落盘），调用方不要再写旧键；
    //   false ＝ 新路接不下，本函数照旧办法整份写回旧键兜底（写失败只记一行 storage.fail，不静默吞）。
    export const saveTemplates = function () {
      let took = false
      try { if (typeof tplSaveAllToSettings === 'function') took = (tplSaveAllToSettings() === true) } catch (e) { took = false }
      if (took) return true
      tplLegacyWriteAll()
      return false
    }
    // 迁移：旧 dsws.startCfg（{withWayfinder, custom}）→ cfg.withWayfinder + 设置文件 templates 节的 execute，
    //   成功后清旧 key（失败保留，下次再试）。
    //   模板那一笔的落点是设置文件，不是旧键：本片在拼接次序上排在设置文件那一族之前，加载这一刻那一片还没
    //   执行完（直接调它会撞上暂时性死区当场抛错），所以这里只把值写进内存（templates.execute）并留下待办
    //   （tplMigratePending），由 kernel/settings-templates.js 末尾接上以后立刻补写这一趟 —— 文档那一刻多半
    //   还在路上，这一笔正好进待写队列。旧 key dsws.startCfg 的删除不依赖这下半趟是否落盘：与改动前一样，
    //   只要求上面这一次读与解析没有抛错（写旧存档本身当时也是吞错的）。
    export const migrateStartCfg = function () {
      try {
        const raw = localStorage.getItem('dsws.startCfg')
        if (!raw) return
        const old = JSON.parse(raw)
        if (old && typeof old === 'object') {
          if (typeof old.withWayfinder === 'boolean') cfg.withWayfinder = old.withWayfinder
          if (typeof old.custom === 'string' && old.custom) { templates.execute = old.custom; tplMigratePending = true }
          saveCfg()
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
      diagnose: ['url'], fix: ['url'], discuss: ['url'], research: ['url'], prototype: ['url'], takeover: ['url'], supplement: ['url'], execute: ['number', 'url', 'title'],
      handoff1: ['ts'], handoff2: ['path', 'file'], fixate: [],
    }
    // 强制占位符表（T1 规格 §3）：缺失拒绝保存
    export const TPL_REQUIRED = {
      diagnose: ['url'], fix: ['url'], discuss: ['url'], research: ['url'], prototype: ['url'], takeover: ['url'], supplement: ['url'], execute: ['url'],
      handoff1: ['ts'], handoff2: ['path'], fixate: [],
    }
    // 默认模板文本（空 = 用默认；T1 规格 §3 默认文本 = 现状代码文本）
    // #725：正文格式契约整节删除（票的读写交给 deck_* 工具），动作模板里不再有按后端填空的标记
    export const TPL_DEFAULT = {
      // T4 #9-12：4 个动作按钮 prompt 明确化
      diagnose: function (st) { return promptTextFor(st, 'tpl.diagnose') },
      fix: function (st) { return promptTextFor(st, 'tpl.fix') },
      discuss: function (st) { return promptTextFor(st, 'tpl.discuss') },
      research: function (st) { return promptTextFor(st, 'tpl.research') },
      prototype: function (st) { return promptTextFor(st, 'tpl.prototype') },
      takeover: function (st) { return promptTextFor(st, 'tpl.takeover') },
      supplement: function (st) { return promptTextFor(st, 'tpl.supplement') },
      execute: function (st) { return promptTextFor(st, 'tpl.execute') },
      handoff1: function () { return promptText('tpl.handoff1') },
      handoff2: function () { return promptText('tpl.handoff2') },
      fixate: function (st) { return promptTextFor(st, 'fixate') },
    }
    export const tplText = (id, st) => templates[id] || (TPL_DEFAULT[id] ? TPL_DEFAULT[id](st) : '')
    // 渲染：转义 {{x}} → 字面 {x}（先替换哨兵防误替换），再替换已知占位符；未知占位符保留原样（保存层已拦截）
    // #684：values 由 backendParamsFor 补上「按当前后端解析」的那几个占位符（{subIssue} / {subject}）
    // #77 定版：stageGate 入口与 STAGE_GATED_IDS 兜底删除 —— tpl.* 内联闸门清单为唯一形态（用户自定义模板不再自动挂闸门）
    export const renderTemplate = function (id, values, st) {
      let text = String(tplText(id, st))
      const vals = (typeof backendParamsFor === 'function') ? backendParamsFor(st, values) : (values || {})
      const esc = []
      text = text.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, function (m, name) { esc.push('{' + name + '}'); return '\u0001' + (esc.length - 1) + '\u0001' })
      text = text.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, function (m, name) {
        return Object.prototype.hasOwnProperty.call(vals, name) ? String(vals[name]) : m
      })
      esc.forEach(function (s, i) { text = text.replace('\u0001' + i + '\u0001', s) })
      return text
    }
    // #595：模板里可写的「按后端填空」标记（存储层不许当未知占位符拒收）
    // #725：正文格式契约删除后没有这类标记了 —— 保留这条通道本身，清单留空
    export const TPL_BACKEND_MARKERS = []
    // 校验：转义预处理 → 未知占位符检测 → 强制占位符缺失检测（T1 规格 §4 顺序）
    export const validateTemplate = function (id, text) {
      const found = []
      const scrubbed = String(text || '').replace(/\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/g, '')
      const re = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g
      let m
      while ((m = re.exec(scrubbed)) !== null) found.push(m[1])
      const unknown = []
      found.forEach(function (n) { if (PH.indexOf(n) < 0 && TPL_BACKEND_MARKERS.indexOf(n) < 0 && unknown.indexOf(n) < 0) unknown.push(n) })
      const missing = []
      ;(TPL_REQUIRED[id] || []).forEach(function (n) { if (found.indexOf(n) < 0 && missing.indexOf(n) < 0) missing.push(n) })
      return { ok: unknown.length === 0 && missing.length === 0, unknown: unknown, missing: missing }
    }
    export const fixateText = (st) => tplText('fixate', st)