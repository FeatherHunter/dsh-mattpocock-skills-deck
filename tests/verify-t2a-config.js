// verify-t2a-config.js — dsh-waystation v25 T2a 配置模型验证（ticket #367）
// 复刻 client.js §2.5 配置模型 + broadcastCfg 逻辑，验证：
//   1) 旧 dsws.startCfg 迁移 → cfg.withWayfinder + templates.execute + 清旧 key
//   2) cfg 持久化 round-trip
//   3) broadcastCfg 同步所有会话 store（ui/size）
//   4) startText 注入（execute 模板占位符 + 前缀开关）
// 用法: node tests/verify-t2a-config.js
const assert = require('assert')

// ---- 内存 localStorage ----
function makeStorage() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _dump: () => Object.fromEntries(m),
  }
}

// ---- 复刻 §2.5 配置模型（与 client.js 同构）----
function loadConfigModel(storage) {
  const CFG_KEY = 'dsws.cfg'
  const TPL_KEY = 'dsws.templates'
  const cfg = (function () {
    const d = { withWayfinder: true, panelHeight: 'half' }
    try {
      const raw = storage.getItem(CFG_KEY)
      if (raw) return Object.assign(d, JSON.parse(raw))
    } catch (e) { /* 默认 */ }
    return d
  })()
  const saveCfg = function () { try { storage.setItem(CFG_KEY, JSON.stringify(cfg)) } catch (e) {} }
  const templates = (function () {
    const d = { diagnose: '', fix: '', discuss: '', execute: '', handoff1: '', handoff2: '', fixate: '' }
    try {
      const raw = storage.getItem(TPL_KEY)
      if (raw) return Object.assign(d, JSON.parse(raw))
    } catch (e) { /* 默认 */ }
    return d
  })()
  const saveTemplates = function () { try { storage.setItem(TPL_KEY, JSON.stringify(templates)) } catch (e) {} }
  const migrateStartCfg = function () {
    try {
      const raw = storage.getItem('dsws.startCfg')
      if (!raw) return
      const old = JSON.parse(raw)
      if (old && typeof old === 'object') {
        if (typeof old.withWayfinder === 'boolean') cfg.withWayfinder = old.withWayfinder
        if (typeof old.custom === 'string' && old.custom) templates.execute = old.custom
        saveCfg(); saveTemplates()
      }
      storage.removeItem('dsws.startCfg')
    } catch (e) { /* 迁移失败保留旧 key */ }
  }
  migrateStartCfg()
  const PANEL_RATIOS = { quarter: 0.25, half: 0.5, twothirds: 2 / 3 }
  const stores = {}
  const shared = { ui: { icon: 'compass', word: '沉淀' }, size: { w: 460, h: 400 }, tick: 0, subs: [] }
  const emit = (st) => { st.tick++ }
  const broadcastCfg = function () {
    const applyTo = function (st) {
      if (!st) return
      const r = PANEL_RATIOS[cfg.panelHeight] || 0.5
      st.size = { w: st.size ? st.size.w : 460, h: Math.max(240, Math.round((800) * r)) }
      emit(st)
    }
    applyTo(shared)
    Object.keys(stores).forEach(function (k) { applyTo(stores[k]) })
  }
  const startText = function (st, t, repoOwner, repoName) {
    const url = 'https://github.com/' + repoOwner + '/' + repoName + '/issues/' + t.number
    if (templates.execute) {
      return templates.execute
        .replace(/\{number\}/g, String(t.number))
        .replace(/\{url\}/g, url)
        .replace(/\{title\}/g, t.title)
    }
    const body = url + '\n\nGUIDE'
    return (cfg.withWayfinder ? '/wayfinder\n' : '') + body
  }
  return { cfg, saveCfg, templates, saveTemplates, broadcastCfg, startText, stores, shared, emit }
}

let passed = 0
const ok = (name) => { passed++; console.log('  PASS', name) }

console.log('T1: 旧 startCfg 迁移')
{
  const storage = makeStorage()
  storage.setItem('dsws.startCfg', JSON.stringify({ withWayfinder: false, custom: '/wayfinder\n{url}\n\n请处理 {title} (#{number})' }))
  const m = loadConfigModel(storage)
  assert.strictEqual(m.cfg.withWayfinder, false, 'withWayfinder 迁入 cfg')
  assert.strictEqual(m.templates.execute, '/wayfinder\n{url}\n\n请处理 {title} (#{number})', 'custom 迁入 templates.execute')
  assert.strictEqual(storage.getItem('dsws.startCfg'), null, '旧 key 清除')
  assert.deepStrictEqual(JSON.parse(storage.getItem('dsws.cfg')).withWayfinder, false, 'cfg 已持久化')
  ok('迁移字段 + 清旧 key + 持久化')
}
{
  const storage = makeStorage() // 无旧 key
  const m = loadConfigModel(storage)
  assert.strictEqual(m.cfg.withWayfinder, true, '默认开')
  assert.strictEqual(m.templates.execute, '', '默认空模板')
  assert.strictEqual(storage.getItem('dsws.cfg'), null, '无旧 key 时不写 cfg')
  ok('无旧 key 走默认，不落盘')
}
{
  const storage = makeStorage()
  storage.setItem('dsws.startCfg', 'not-json{{{')
  const m = loadConfigModel(storage)
  assert.strictEqual(m.cfg.withWayfinder, true, '坏 JSON 走默认')
  ok('坏 JSON 迁移容错')
}

console.log('T2: cfg 持久化 round-trip')
{
  const storage = makeStorage()
  const m = loadConfigModel(storage)
  m.cfg.panelHeight = 'quarter'; m.cfg.icon = 'radar'; m.cfg.word = '存档'
  m.saveCfg()
  const m2 = loadConfigModel(storage)
  assert.strictEqual(m2.cfg.panelHeight, 'quarter')
  assert.strictEqual(m2.cfg.icon, 'radar')
  assert.strictEqual(m2.cfg.word, '存档')
  ok('cfg 保存后重载一致')
}

console.log('T3: broadcastCfg 同步所有会话 store 的面板尺寸')
{
  const storage = makeStorage()
  const m = loadConfigModel(storage)
  m.stores['s1'] = { size: { w: 460, h: 400 }, tick: 0 }
  m.stores['s2'] = { size: { w: 600, h: 500 }, tick: 0 }
  m.cfg.panelHeight = 'twothirds'
  m.broadcastCfg()
  assert.strictEqual(m.shared.size.h, Math.max(240, Math.round(800 * 2 / 3)), 'shared 高度按 2/3')
  assert.strictEqual(m.stores['s1'].size.h, Math.max(240, Math.round(800 * 2 / 3)), 's1 高度覆盖')
  assert.strictEqual(m.stores['s2'].size.h, Math.max(240, Math.round(800 * 2 / 3)), 's2 高度覆盖')
  assert.strictEqual(m.stores['s2'].size.w, 600, '宽度保留用户拖拽值')
  ok('广播到 shared + 所有会话 store，宽保留高覆盖')
}

console.log('T4: startText 注入')
{
  const storage = makeStorage()
  const m = loadConfigModel(storage)
  const t = { number: 365, title: 'T1 规格' }
  // 默认 + 前缀开
  assert.strictEqual(m.startText(m.shared, t, 'FeatherHunter', 'SKILLS'), '/wayfinder\nhttps://github.com/FeatherHunter/SKILLS/issues/365\n\nGUIDE')
  // 前缀关
  m.cfg.withWayfinder = false
  assert.strictEqual(m.startText(m.shared, t, 'FeatherHunter', 'SKILLS'), 'https://github.com/FeatherHunter/SKILLS/issues/365\n\nGUIDE')
  // execute 模板优先（含全部占位符）
  m.templates.execute = '/wayfinder\n{url}\n\n请处理 {title} (#{number})'
  const out = m.startText(m.shared, t, 'FeatherHunter', 'SKILLS')
  assert.ok(out.includes('https://github.com/FeatherHunter/SKILLS/issues/365'), 'url 替换')
  assert.ok(out.includes('T1 规格'), 'title 替换')
  assert.ok(out.includes('365'), 'number 替换')
  assert.ok(!out.includes('{url}') && !out.includes('{title}') && !out.includes('{number}'), '无残留占位符')
  ok('默认/开关/自定义模板三种注入')
}

console.log(`\n全部通过：${passed}/4 组`)
