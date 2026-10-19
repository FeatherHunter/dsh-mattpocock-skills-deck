/**
 * src/client/kernel/settings-templates.ts — 内核模块（#1012 第 4 步：动作模板搬进本机设置文件）
 * （原来是 .js：按「动到哪里转哪里」转成 TypeScript，行为零变化。本文件是模块真源，同名 .js 已改由构建生成（会被覆盖，不要去改），本 .ts 既进类型检查也进拼接与 ts-hook 测试。）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mts 在构建时去掉每行行首 export 关键字，把声明体文本
 *   拼回 src/client/index.ts 里那一行 kernel:settingsTemplates 拼接标记处（apply 闭包内原位），与
 *   ctx.ts/seam 同模式，源码树里只有这一份真源。这一行标记必须排在 kernel:settingsViewWrite 之后：
 *   本片要用那一片的待写队列与防抖排期（viewFlagState.journal / deferred / retryLeft、viewFlagScheduleWrite），
 *   以及设置视图那一份的文档工具与状态对象（kernel/settings-view.ts、kernel/settings-view-state.ts）。
 *
 * 本片管 11 条动作模板（diagnose fix discuss research prototype takeover supplement execute handoff1
 *   handoff2 fixate）。它们从前只活在 localStorage 的 dsws.templates 里，现在新家是本机设置文件的
 *   templates 节 —— #1012 要改的三份配置里的第三份。旧键那一条留着当过渡：读先看文件，写进文件成功就
 *   一个字都不写旧键，只有文档问不到或写失败时才照改动前的老办法整份写回旧键。
 *
 * 读这一侧的次序（读口是 config.ts 的 tplText，本片只负责把文件那一份搬进内存）：
 *   ① 文档已到手且文件 templates 节里这一格是非空文字 → 用文件那一份；
 *   ② 否则用旧键那一份（config.ts 的 templates 对象，模块加载时从旧键读来的快照）；
 *   ③ 再否则用默认文本（config.ts 的 TPL_DEFAULT）。
 *   把文件那一份搬进内存只做一次：文档到手那一刻（viewFlagSettle 收口之后的 viewFlagNotifySettled），
 *   照 kernel/settings-ui.ts 的现成写法（订阅 viewFlagSubscribe）。文档没到手时行为与今天一字不差。
 *
 * 搬进来时的合并规矩（与界面偏好那一族不同，改之前先读懂）：文件里非空的值赢，文件里没写或写成空串的
 *   格保留旧键那一份。理由是核的语义（config-store-core/src/settings.ts 第 161 行旁那段注释）：空串表示
 *   「这一格用默认文本」，不是「用户选了空」；拿空串去顶掉用户旧存档里改过的模板，等于把人家改过的白改。
 *
 * 写这一侧只有一条真实路径：config.ts 的 saveTemplates（那个冻结导出名，它把整份交给本片的
 *   settingsTemplatesSaveAll；配置页那个模板编辑入口早在 #519 就删了，没有第二个写入口）。
 *   更旧的存档 dsws.startCfg 的迁移已按 #1012 定案第 11 条连同迁移逻辑一起删除，本片不再有待办要补。
 *
 * 队列里 templates 那几笔与界面偏好那一族同形：没有工作区路径，只有格名。记号固定为
 *   \u0000templates\u0000 + 模板 id（工作区路径里不可能出现 \u0000，两族记号不会撞上）；
 *   section 记 'templates'，settings-view.ts 的 viewFlagSettle 与 settings-view-write.ts 的三处
 *   （写前重读合并、回包取值、写失败兜底）都按这个 section 分派过来。
 */
// 跨闭包的值引用按仓里规矩写模块级 declare（实现只在拼好的闭包里有一份，类型检查各看各的）：
// viewFlagState 与 viewFlagSubscribe 的真源在 kernel/settings-view-state.ts，settingsViewLoad 的真源在
//   kernel/settings-view.ts，viewFlagScheduleWrite 的真源在 kernel/settings-view-write.ts，templates 与
//   tplLegacyWriteAll 的真源在 config.ts；本片只在调用时求值，初始化期不碰；类型一律写 any 是刻意的：
//   在这里凭记忆写窄，只会把那边正常的改动变成这里的假报错（与 kernel/link.ts 同例）。
//   log 走全局已声明的那一份，这里不重复。
declare const viewFlagState: any;
declare function viewFlagSubscribe(...args: any[]): any;
declare function settingsViewLoad(...args: any[]): any;
declare function viewFlagScheduleWrite(...args: any[]): any;
declare const templates: any;
declare function tplLegacyWriteAll(...args: any[]): any;
// tplSaveAllToSettings 是 config.js 那一份的冻结导出名（saveTemplates 的接手人）：
// 它在闭包里别处有真身，本片只在末尾把它指到 settingsTemplatesSaveAll；
// declare var 只声明形状、不生成代码，赋值仍是原来那一行（与 kernel/link.ts 同例）。
declare var tplSaveAllToSettings: any;
    // 这 11 个名字与核（config-store-core/src/settings.ts 第 159–163 行：名字是动态的、不许危险名、
    //   值必须是一段文字、空串合法）以及 config.js 的 templates 对象同一份。本片是唯一的写入方，
    //   所以名字在这里钉成一张清单：绝不放任调用方拿任意字符串当模板 id 写进文件（危险名字会被核整份拒绝）。
    const TPL_SETTING_NAMES = ['diagnose', 'fix', 'discuss', 'research', 'prototype', 'takeover', 'supplement', 'execute', 'handoff1', 'handoff2', 'fixate']
    // 文件里那一份搬进内存这件事只做一次（一次问话只有一个终点，搬完就放下，后续以内存这一份为准）。
    let tplAdopted = false
    // 队列里 templates 那几笔的记号：固定段名 + \u0000 + 模板 id（见文件头那一段）。
    const settingsTemplatesJournalKeyOf = function (name: any): any { return '\u0000templates\u0000' + name }
    // 文档里的 templates 节：形状对不上（更高版本插件写的文件、或不是一组「名字 → 值」）时回 null。
    const settingsTemplatesSectionOf = function (doc: any): any {
      try {
        if (!doc || typeof doc !== 'object') return null
        const tpl = doc.templates
        if (!tpl || typeof tpl !== 'object' || Array.isArray(tpl)) return null
        return tpl
      } catch (e) { return null }
    }
    // 文件里这一格的非空文字：没写、写成空串、或写的不是文字，一律回空串（空串在这份文件里的意思是
    //   「这一格用默认文本」，不是一份用户选定的值，见文件头那段合并规矩）。
    const settingsTemplatesDocTextOf = function (name: any): any {
      try {
        const tpl = settingsTemplatesSectionOf(viewFlagState.doc)
        const v = tpl ? tpl[name] : undefined
        return (typeof v === 'string' && v !== '') ? v : ''
      } catch (e) { return '' }
    }
    // 把一格模板改进内存文档的 templates 节：别的节与别的格一律不动；这一节缺失或形状不对就新建一份空的。
    export const settingsTemplatesSetInDoc = function (doc: any, name: any, value: any): any {
      try {
        if (!doc || typeof doc !== 'object') return false
        if (!doc.templates || typeof doc.templates !== 'object' || Array.isArray(doc.templates)) doc.templates = {}
        doc.templates[name] = value
        return true
      } catch (e) { return false }
    }
    // 一笔模板写不进内存文档时记一行（沿用既有的 storage.fail，不新开事件名；key 记一个固定的记号，
    //   与同库另两处 viewFlagLogDocFail / settingsUiLogDocFail 的写法一致，日志纪律不许把用户数据写进日志）。
    const settingsTemplatesLogDocFail = function (): void {
      try { log('warn', 'storage.fail', { key: 'settings.templates', op: 'write' }) } catch (eL) {}
    }
    // 文档到手（或判定问不到）时，把还在路上的 templates 那几笔接上：能进文档就进待写队列，进不去就旧键兜底。
    //   由 kernel/settings-view.js 的 viewFlagSettle 在清空 deferred 那一趟里按 section 分派过来；返回 true
    //   表示这一笔已经处理完（调用方不必再按工作区那条路处理它，那条路会拿 undefined 当工作区根）。
    //   文件里已经有这一格的非空值时不再写：文件那一份赢（与下面 adopt 同一条规矩），旧存档那一份不许顶掉它。
    export const settingsTemplatesDrainDeferred = function (d: any, status: any): any {
      try {
        if (status === 'ready') {
          if (settingsTemplatesDocTextOf(d.name) !== '') return true
          if (settingsTemplatesSetInDoc(viewFlagState.doc, d.name, d.value)) {
            viewFlagState.journal[settingsTemplatesJournalKeyOf(d.name)] = { section: 'templates', name: d.name, value: d.value }
            return true
          }
          settingsTemplatesLogDocFail()
        }
        tplLegacyWriteAll()
      } catch (e) {}
      return true
    }
    // 文件里那一份搬进内存这一份：只搬文件写过（非空文字）且与内存那一份不同的格；文件里没写或写成空串的
    //   格保留内存里那一份（＝旧键那一份，见文件头那段合并规矩）。搬完不重画：模板文本是人点动作按钮那一刻
    //   才读的（kernel/router.js 第 162 行、kernel/store-derived.js 第 276–283 行、kernel/api-naming.js 第 20
    //   与第 35 行），不像界面偏好那样已经按旧表画过一次，所以这里没有要把界面改回来的东西。
    export const settingsTemplatesAdoptFromDoc = function (): void {
      try {
        if (tplAdopted) return
        tplAdopted = true
        const tpl = settingsTemplatesSectionOf(viewFlagState.doc)
        if (!tpl) return
        for (let i = 0; i < TPL_SETTING_NAMES.length; i++) {
          const name = TPL_SETTING_NAMES[i]
          const v = tpl[name]
          if (typeof v !== 'string' || v === '') continue
          if (templates[name] !== v) templates[name] = v
        }
      } catch (e) {}
    }
    // 写一格模板进文件。返回值与 setViewFlag / setUiPref 同义，给调用方看两种意思：
    //   true ＝ 这一次交给本机设置文件这条路了（可能还在防抖窗口里没落盘），调用方不要再写旧键；
    //   false ＝ 这条路接不下（文档问不到、是更高版本、形状对不上、或名字不在上面那张清单里），
    //          调用方按老办法写旧键兜底。
    //   空串一律回 false 且不写：空串的语义是「用默认文本」，本片不拿它去顶掉任何已经存在的一份。
    const settingsTemplatesSet = function (name: any, value: any): any {
      try {
        if (TPL_SETTING_NAMES.indexOf(name) < 0) return false
        const v = String(value == null ? '' : value)
        if (v === '') return false
        settingsViewLoad()
        if (viewFlagState.status === 'loading') {
          // 文档还在路上：先记下这一笔，等它落地再并进文档（此刻先写旧键的话，文档一到手就会拿文件里的
          //   旧值把「刚搬的这一笔」顶掉，用户会看见自己改过的模板又变回默认文本）。
          viewFlagState.deferred[settingsTemplatesJournalKeyOf(name)] = { section: 'templates', name: name, value: v }
          return true
        }
        if (viewFlagState.status !== 'ready') return false
        if (!settingsTemplatesSetInDoc(viewFlagState.doc, name, v)) { settingsTemplatesLogDocFail(); return false }
        viewFlagState.journal[settingsTemplatesJournalKeyOf(name)] = { section: 'templates', name: name, value: v }
        viewFlagScheduleWrite()
        return true
      } catch (e) { return false }
    }
    // 把内存里这一份模板整体交给设置文件（config.js 那个冻结导出名 saveTemplates 的接手人，见文件头）。
    //   逐格判：内存里是空串的格不写（空＝用默认文本，没有要写的东西）；文件里已经有非空值的格不写
    //   （文件那一份赢）；剩下「内存有、文件没有」的格才交给上面 settingsTemplatesSet 那条路。
    //   返回 false 表示有格接不下（文档问不到、是更高版本、形状对不上），调用方照旧办法整份写回旧键兜底。
    export const settingsTemplatesSaveAll = function (): any {
      try {
        let took = true
        for (let i = 0; i < TPL_SETTING_NAMES.length; i++) {
          const name = TPL_SETTING_NAMES[i]
          const v = templates[name]
          if (typeof v !== 'string' || v === '') continue
          if (settingsTemplatesDocTextOf(name) !== '') continue
          if (!settingsTemplatesSet(name, v)) took = false
        }
        return took
      } catch (e) { return false }
    }
    // 初始化一件事（与 kernel/settings-ui.js 末尾同例）：把「文件到手就把文件那一份搬进内存」登记上去
    //   （文档早已到手时它会立刻调一次），同时装上 config.js 那个冻结导出名 saveTemplates 的接手人。
    try { viewFlagSubscribe(settingsTemplatesAdoptFromDoc) } catch (e0) {}
    try { tplSaveAllToSettings = settingsTemplatesSaveAll } catch (e1) {}
