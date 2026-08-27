/**
 * tracker/statusDerive.js — wf.status 检查链目录视图派生（#229，规约基线 #224 v2 2026-08-28）。
 *
 * 生效日期：2026-08-29
 * 效力规则：本文件以 #224 规约 v2 为基线（承接 #217/#218/#219/#245 定版、#246 删 na 落地）；
 *           与更早方案（含 #229 票面 v1 的「na 置灰」措辞）冲突以本规约为准；
 *           未来任何定版方案若改动本规约，以未来版本为准（见 CONTEXT.md「版本与效力」）。
 *
 * 第一性原理：
 *  - 9→N：检查面板行 = 目录视图（catalogFor(backendId) = 通用目录 + 当前后端目录合并），N 动态；
 *    跨后端无关行**直接不存在**（物理隔离），而非标 na —— #246 已删契约层 NA。
 *  - 'na' 语义的 v2 落法：pending（未注册谓词 / 探测超时 / 输入缺位）= 诚实未知，
 *    渲染置灰（env.pending 分组）、就绪计数与胶囊汇总不计入（分母只含真实活跃行）；
 *    markdown 下 gh 行不是 pending 也不是置灰，而是根本不存在（D7 物理隔离根治误导文案）。
 *  - 委托优先：github 行复用 host 既有 checkRepo/checkGhCli/checkGhAuth/checkApi（delegates 注入，
 *    零重复实现）；gitlab/glab 链路本票仅保证契约形状（未接入 → pending，不猜不误报）；
 *    markdown parseOk 复用 backends/markdown/parse.js parseMd（相对导入，pkg/dev 双形态可解析）。
 *  - 双语名单源：ROW_NAMES zh/en 同步维护；client 不再翻译检查名（locale 类别 6 泛化路径）。
 *  - 兼容桥：带数字 legacy id 的行继续携带数字 id（gh:remote=1 等），UI 旧查找逐步迁 key 化不断档。
 *
 * 数据纪律：全函数只读探测（fs/exec 只读），失败返回而非抛；不做任何写操作。
 */

import { catalogFor } from '../../shared/tracker/check-catalog.js'

export const STATUS_DERIVE_VERSION = 1

/** 仅服务仓库就绪链（#227 gh:labels 标签引导），不属于环境检测面板语义。 */
export const EXCLUDED_FROM_STATUS = Object.freeze(['gh:labels'])

/**
 * 双语行名单源（zh/en 同步维护）。名称沿用旧 CHECK_NAMES 的中文习惯 + 目录 label 泛化。
 */
export const ROW_NAMES = Object.freeze({
  'selection:backendSelected': { zh: '已选择后端', en: 'Backend selected' },
  'tracker:initialized': { zh: '工作区已初始化', en: 'Workspace initialized' },
  'skill:wayfinder': { zh: 'wayfinder 技能已安装', en: 'wayfinder skill installed' },
  'skill:setup-mattpocock-skills': { zh: 'setup-mattpocock-skills 技能已安装', en: 'setup-mattpocock-skills skill installed' },
  'skill:ask-matt': { zh: 'ask-matt 技能已安装', en: 'ask-matt skill installed' },
  'env:home': { zh: '用户主目录可解析', en: 'User home resolvable' },
  'gh:remote': { zh: '仓库定位', en: 'Repo located' },
  'gh:installed': { zh: 'GitHub CLI (gh) 已安装', en: 'GitHub CLI (gh) installed' },
  'gh:authed': { zh: 'gh 已登录', en: 'gh logged in' },
  'gh:repoAccess': { zh: 'API 可达', en: 'API reachable' },
  'glab:installed': { zh: 'GitLab CLI (glab) 已安装', en: 'GitLab CLI (glab) installed' },
  'glab:authed': { zh: 'glab 已登录', en: 'glab logged in' },
  'glab:repoAccess': { zh: 'GitLab 仓库可达', en: 'GitLab repo reachable' },
  'md:scratchWritable': { zh: '.scratch 目录可用', en: '.scratch directory available' },
  'md:parseOk': { zh: '本地图谱可解析', en: 'Local map parses' },
})

/** key → 数字 legacy id（兼容桥：旧 UI 按 c.id===n 查找的行在此映射后仍可命中）。 */
export const LEGACY_ID = Object.freeze({
  'gh:remote': 1,
  'tracker:initialized': 2,
  'gh:installed': 4,
  'gh:authed': 5,
  'gh:repoAccess': 6,
  'skill:wayfinder': 7,
  'skill:ask-matt': 8,
})

/** 展示顺序：开门组 → 通用环境组 → 后端分区（目录内稳定排序）。 */
export const GENERIC_ORDER = Object.freeze(['selection:backendSelected', 'tracker:initialized', 'skill:wayfinder', 'skill:setup-mattpocock-skills', 'skill:ask-matt', 'env:home'])

function nameFor(key, lang) {
  const t = ROW_NAMES[key]
  if (!t) return key
  return (lang === 'en') ? t.en : t.zh
}

function baseRow(key, lang) {
  return {
    key: key,
    id: (LEGACY_ID[key] !== undefined) ? LEGACY_ID[key] : key,
    name: nameFor(key, lang),
    ok: false,
    level: 'pending',
    detail: '',
    hint: '',
    section: GENERIC_ORDER.indexOf(key) >= 0 ? 'generic' : 'backend',
    group: (key === 'selection:backendSelected' || key === 'tracker:initialized') ? 'gate' : (GENERIC_ORDER.indexOf(key) >= 0 ? 'env' : 'backend'),
  }
}

// ---------- 本地原语解析器（与 predicateRegistry.execPrimitive 同语义，防 dev 形态导入断裂） ----------

async function safeHome(platform) {
  try {
    if (platform && typeof platform.getHome === 'function') {
      const h = await platform.getHome()
      return (h && typeof h === 'string') ? h : null
    }
  } catch {}
  return null
}

async function fileExistsRel(platform, cwd, rel) {
  try {
    if (!platform || !platform.fs || typeof platform.fs.resolve !== 'function') return null // unknown
    const abs = await platform.fs.resolve(rel, { cwd })
    if (typeof platform.fs.exists === 'function') {
      return (await platform.fs.exists(abs)) === true
    }
    if (typeof platform.fs.readText === 'function') {
      try { await platform.fs.readText(abs); return true } catch { return false }
    }
    if (typeof platform.fs.lstat === 'function') {
      try { const info = await platform.fs.lstat(abs); return !!info } catch { return false }
    }
    return null
  } catch { return false }
}

async function commandExists(platform, cmd) {
  try {
    if (!platform || typeof platform.resolveExecutable !== 'function') return null
    const hit = await platform.resolveExecutable(cmd)
    return hit ? true : false
  } catch { return false }
}

async function nativeSkillProbe(platform, cwd, skill) {
  const home = await safeHome(platform)
  const dirs = home ? ['.agents/skills', '.minimax/skills', '.claude/skills'] : ['.agents/skills']
  for (let i = 0; i < dirs.length; i++) {
    const found = await fileExistsRel(platform, cwd, dirs[i] + '/' + skill + '/SKILL.md')
    if (found === true) {
      const where = (dirs[i].indexOf('~') < 0 && home) ? (dirs[i]) : dirs[i]
      return { status: 'pass', detail: skill + ' found at ' + where }
    }
    // 目录存在但 SKILL.md 缺失也视为已安装候选（目录命中即装）
    const dirHit = await fileExistsRel(platform, cwd, dirs[i] + '/' + skill)
    if (dirHit === true) return { status: 'pass', detail: skill + ' found at ' + where0(dirs[i]) }
  }
  if (home === null) return { status: 'pending', detail: 'home unavailable for skillProbe' }
  return { status: 'fail', detail: skill + ' not found' }
}

// 防止遗漏：占位转换（目录字符串直接回显）
function where0(d) { return d }

async function envHome(platform) {
  let val
  try {
    const env = platform && platform.env ? platform.env : null
    val = env && typeof env.get === 'function'
      ? (env.get('HOME') || env.get('USERPROFILE'))
      : ((typeof process !== 'undefined' && process.env) ? (process.env.HOME || process.env.USERPROFILE) : undefined)
  } catch { val = undefined }
  return val ? { status: 'pass', detail: 'HOME set' } : { status: 'fail', detail: 'HOME not set' }
}

// ---------- markdown parseOk（复用 backends/markdown/parse.js parseMd） ----------

async function mdParseOk(platform, cwd) {
  const hasMap = await fileExistsRel(platform, cwd, '.scratch/map.md')
  if (hasMap === null) return { level: 'pending', detail: 'fs probe unavailable', hint: '' }
  if (hasMap === false) {
    return {
      level: 'warn',
      hint: 'prompt:setupRun',
      detailZh: '.scratch/map.md 不存在 — 初始化后生成',
      detailEn: '.scratch/map.md missing — created by initialization',
    }
  }
  try {
    let text = ''
    try {
      const abs = await platform.fs.resolve('.scratch/map.md', { cwd })
      text = await platform.fs.readText(abs)
    } catch (e) {
      return { level: 'bad', detailZh: '.scratch/map.md 读取失败：' + String((e && e.message) || e), detailEn: '.scratch/map.md read failed: ' + String((e && e.message) || e), hint: '' }
    }
    try {
      const mod = await import('./backends/markdown/parse.js')
      const parseMd = mod.parseMd || mod.default
      if (typeof parseMd === 'function') {
        parseMd(String(text || ''), {})
        return { level: 'ok', detailZh: '本地图谱解析通过', detailEn: 'local map parses OK', hint: '' }
      }
      return { level: 'pending', detailZh: 'parseMd 未导出', detailEn: 'parseMd not exported', hint: '' }
    } catch (eParse) {
      return { level: 'bad', detailZh: '本地图谱解析失败：' + String((eParse && eParse.message) || eParse), detailEn: 'local map parse failed: ' + String((eParse && eParse.message) || eParse), hint: '' }
    }
  } catch (eOuter) {
    return { level: 'pending', detailZh: String((eOuter && eOuter.message) || eOuter), detailEn: String((eOuter && eOuter.message) || eOuter), hint: '' }
  }
}

// ---------- 选择行（开门链首步，#218 开门链 D7 c2） ----------

function selectionRow(selection, lang) {
  const sel = selection || null
  const bid = sel && sel.backendId ? String(sel.backendId) : null
  if (bid) {
    const multi = sel && Array.isArray(sel.multiHit) && sel.multiHit.length
    return { ok: true, level: 'ok', detail: bid + (multi ? (' · multiHit:' + multi.join(',')) : '') + (sel && sel.source ? (' (' + sel.source + ')') : ''), hint: '' }
  }
  if (sel && sel.pending) {
    return {
      ok: false, level: 'warn',
      detailZh: '探测中 · 等待选择后端或重测',
      detailEn: 'Detecting… select a backend or retry',
      hint: 'pending:explicit-bind',
    }
  }
  return {
    ok: false, level: 'warn',
    detailZh: '未绑定后端 — 请选择后端',
    detailEn: 'No backend bound — please select one',
    hint: '',
  }
}

// ---------- 主入口 ----------

/**
 * 派生环境检测目录视图。
 * @param {Object} deps
 * @param {string} [deps.cwd]
 * @param {'zh'|'en'} [deps.lang]
 * @param {object|null} [deps.platform] 平台抽象实例
 * @param {{backendId?:string|null,pending?:boolean,multiHit?:string[],source?:string}|null} [deps.selection]
 * @param {{github?:Function, gitlab?:Function, skillProbe?:Function}} [deps.delegates]
 *   delegates.github(): Promise<{c1,c4,c5,c6}>（host 既有 checkRepo/checkGhCli/checkGhAuth/checkApi 产物）
 *   delegates.gitlab(): Promise<{installed?,authed?,repoAccess?}>（可选，未接则 pending）
 *   delegates.skillProbe(name): Promise<{ok,level,detail,hint}>（host probeSkill 双源探测）
 * @returns {Promise<{view:'directory', backendId:string|null, repoRef:object|null, checks:Array, ready:number, total:number, sections:Object}>}
 */
export async function deriveStatusView(deps) {
  const d = deps || {}
  const lang = d.lang === 'en' ? 'en' : 'zh'
  const platform = d.platform || null
  const selection = d.selection || null
  const delegates = d.delegates || {}
  const backendId = selection && selection.backendId ? String(selection.backendId) : null
  const isEn = lang === 'en'
  const rows = []
  let repoRef = null

  // —— 通用 · 开门组 ——
  const selRow = baseRow('selection:backendSelected', lang)
  const s1 = selectionRow(selection, lang)
  applyResult(selRow, s1, lang)
  rows.push(selRow)

  const initRow = baseRow('tracker:initialized', lang)
  const initRes = await fileExistsRel(platform, d.cwd || '', 'docs/agents/issue-tracker.md')
  if (initRes === true) applyResult(initRow, { ok: true, level: 'ok', detailZh: 'docs/agents/issue-tracker.md 存在', detailEn: 'docs/agents/issue-tracker.md exists' }, lang)
  else if (initRes === false) applyResult(initRow, { ok: false, level: 'warn', detailZh: 'docs/agents/issue-tracker.md 不存在', detailEn: 'docs/agents/issue-tracker.md missing', hint: 'prompt:setupRun' }, lang)
  else applyResult(initRow, { pending: true, detailZh: 'fs 服务不可用，无法探测', detailEn: 'fs service unavailable' }, lang)
  rows.push(initRow)

  // —— 通用 · 环境组（技能 ×3 + HOME）——
  const SKILL_KEYS = ['skill:wayfinder', 'skill:setup-mattpocock-skills', 'skill:ask-matt']
  for (const key of SKILL_KEYS) {
    const row = baseRow(key, lang)
    const skillName = key.slice('skill:'.length)
    if (typeof delegates.skillProbe === 'function') {
      try {
        const r = await delegates.skillProbe(skillName)
        if (r && r.level) applyLegacy(row, r)
        else applyResult(row, { pending: true, detailZh: '探测无结果', detailEn: 'no probe result' }, lang)
      } catch (e) {
        applyResult(row, { pending: true, detailZh: '技能探测异常：' + short(e), detailEn: 'skill probe error: ' + short(e) }, lang)
      }
    } else {
      const r = await nativeSkillProbe(platform, d.cwd || '', skillName)
      applyPredicate(row, r, lang)
    }
    rows.push(row)
  }

  const homeRow = baseRow('env:home', lang)
  const hr = await envHome(platform)
  applyPredicate(homeRow, hr, lang)
  if (hr.status === 'fail') { homeRow.level = 'warn'; homeRow.ok = false; setDetail(homeRow, '用户主目录不可解析', 'User home not resolvable', lang) }
  rows.push(homeRow)

  // —— 后端分区（物理隔离：非当前后端的行不存在；gh:labels 专属仓库就绪链除外）——
  const backendItems = backendId
    ? catalogFor(backendId).filter(function (it) { return it.scope === 'backend' && EXCLUDED_FROM_STATUS.indexOf(it.id) < 0 })
    : []
  for (const it of backendItems) {
    const key = it.id
    const row = baseRow(key, lang)
    if (key.indexOf('gh:') === 0) {
      if (typeof delegates.github !== 'function') {
        applyResult(row, { pending: true, detailZh: 'github 探测委托未注入', detailEn: 'github delegate not wired' }, lang)
        rows.push(row)
        continue
      }
      try {
        const g = await delegates.github()
        const mapLegacy = { 'gh:remote': g.c1, 'gh:installed': g.c4, 'gh:authed': g.c5, 'gh:repoAccess': g.c6 }
        const lr = mapLegacy[key]
        if (!lr) applyResult(row, { pending: true, detailZh: '委托结果缺位', detailEn: 'delegate result missing' }, lang)
        else {
          applyLegacy(row, lr)
          if (key === 'gh:remote' && lr.repo) repoRef = lr.repo
        }
      } catch (e) {
        applyResult(row, { pending: true, detailZh: 'github 探测异常：' + short(e), detailEn: 'github probe error: ' + short(e) }, lang)
      }
    } else if (key === 'glab:installed') {
      const ce = await commandExists(platform, 'glab')
      applyPredicate(row, ce === null
        ? { status: 'pending', detail: 'platform.resolveExecutable unavailable' }
        : (ce ? { status: 'pass', detail: 'glab found' } : { status: 'fail', detail: 'glab not found in PATH' }), lang)
    } else if (key === 'glab:authed' || key === 'glab:repoAccess') {
      if (typeof delegates.gitlab === 'function') {
        try {
          const g = await delegates.gitlab()
          const lr = (key === 'glab:authed') ? g.authed : g.repoAccess
          if (lr && lr.level) applyLegacy(row, lr)
          else applyResult(row, { pending: true, detailZh: 'gitlab 探测委托结果缺位', detailEn: 'gitlab delegate result missing' }, lang)
        } catch (e) {
          applyResult(row, { pending: true, detailZh: 'gitlab 探测异常：' + short(e), detailEn: 'gitlab probe error: ' + short(e) }, lang)
        }
      } else {
        // 仅保证契约形状（GitLab 完整适配为后续票）：诚实 pending，计数剔除，不猜不误报
        applyResult(row, { pending: true, detailZh: 'glab 链路未接入（仅保证契约形状）', detailEn: 'glab chain not wired (shape-only guarantee)' }, lang)
      }
    } else if (key === 'md:scratchWritable') {
      const sw = await fileExistsRel(platform, d.cwd || '', '.scratch')
      if (sw === true) applyResult(row, { ok: true, level: 'ok', detailZh: '.scratch 可用', detailEn: '.scratch available' }, lang)
      else if (sw === false) applyResult(row, { ok: false, level: 'bad', detailZh: '.scratch 不存在或不可读', detailEn: '.scratch missing or unreadable', hint: 'prompt:setupRun' }, lang)
      else applyResult(row, { pending: true, detailZh: 'fs 服务不可用，无法探测', detailEn: 'fs service unavailable' }, lang)
    } else if (key === 'md:parseOk') {
      const pr = await mdParseOk(platform, d.cwd || '')
      if (pr.pending) applyResult(row, { pending: true, detailZh: pr.detailZh, detailEn: pr.detailEn }, lang)
      else {
        row.level = pr.level
        row.ok = pr.level === 'ok'
        row.detail = isEn ? pr.detailEn : pr.detailZh
        row.hint = pr.hint || ''
      }
    } else {
      // 未知目录项：诚实 pending（后续新增目录项时显式补派生分支）
      applyResult(row, { pending: true, detailZh: '该目录项暂无派生实现', detailEn: 'no derivation for this catalog item yet' }, lang)
    }
    rows.push(row)
  }

  // 稳定排序：GENERIC_ORDER 先序，其余按目录出现顺序（数组本身已按生成序）
  rows.forEach(function (r, i) { r.seq = i })

  // 计数口径（#246 删 na · #229 分母口径）：pending 不计入分子分母
  const active = rows.filter(function (r) { return r.level !== 'pending' })
  const ready = active.filter(function (r) { return r.ok }).length
  const total = active.length

  return {
    view: 'directory',
    backendId: backendId,
    repoRef: repoRef,
    checks: rows,
    ready: ready,
    total: total,
    sections: {
      gate: rows.filter(function (r) { return r.group === 'gate' }).map(function (r) { return r.key }),
      env: rows.filter(function (r) { return r.group === 'env' }).map(function (r) { return r.key }),
      backend: rows.filter(function (r) { return r.group === 'backend' }).map(function (r) { return r.key }),
    },
  }
}

// ---------- 结果应用工具 ----------

function short(e) { return String((e && e.message) || e).slice(0, 120) }

function setDetail(row, zh, en, lang) { row.detail = (lang === 'en') ? en : zh }

function applyResult(row, r, lang) {
  if (!r) return
  if (r.pending) {
    row.level = 'pending'
    row.ok = false
    if (r.detailZh || r.detailEn) setDetail(row, r.detailZh || r.detailEn, r.detailEn || r.detailZh, lang)
    else if (r.detail) row.detail = r.detail
    if (r.hint) row.hint = r.hint
    return
  }
  row.ok = r.ok === true || r.level === 'ok'
  row.level = r.level || (row.ok ? 'ok' : 'bad')
  if (r.detailZh || r.detailEn) setDetail(row, r.detailZh || r.detailEn, r.detailEn || r.detailZh, lang)
  else if (r.detail) row.detail = r.detail
  if (r.hint !== undefined && r.hint !== null) row.hint = r.hint
}

/** legacy 检查形状 { ok, level, detail, hint, repo? } 直接映射。 */
function applyLegacy(row, c) {
  row.ok = c.ok === true || c.level === 'ok'
  row.level = c.level || (row.ok ? 'ok' : 'bad')
  row.detail = c.detail || ''
  row.hint = c.hint || ''
}

function applyPredicate(row, pr, lang) {
  if (!pr) { applyResult(row, { pending: true }, lang); return }
  if (pr.status === 'pass') { row.ok = true; row.level = 'ok'; row.detail = pr.detail || ''; row.hint = pr.hint || '' }
  else if (pr.status === 'fail') { row.ok = false; row.level = 'bad'; row.detail = pr.detail || ''; row.hint = pr.hint || '' }
  else { row.ok = false; row.level = 'pending'; row.detail = pr.detail || ''; row.hint = pr.hint || '' }
}
