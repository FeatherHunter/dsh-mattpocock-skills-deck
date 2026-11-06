// src/client/views/versionControl/vcWorktreesUi.ts —— 工作区页的界面读数归一（#1904 从 vcWorktreesOps 拆出）
//
// 为什么拆：处理层加上三张表单后超过 350 有效行上限；这一叶只做「任意来源的 ui → 形状完整的读数」，
//   页面与处理层都读它，口径只有这一份。
// 约定：缺字段一律补成空串 / 空表 / 默认模式，界面不用到处判 undefined；表单错误只存词条键与参数，
//   翻译留给视图层（处理层拿不到 t）。
//
// 本文件单独过 tsc 时看不到的东西（构建后同闭包里存在）：
declare const VC_WORKTREE_MODES: string[]

const vcWtUiStr = function (v: any): string {
  return String(v === undefined || v === null ? '' : v)
}

/** 只留字符串值：表单参数与结果参数都只放可翻译的短值，不把整份回包塞进界面读数。 */
const vcWtParamsOf = function (p: any): any {
  const out: any = {}
  const src: any = p && typeof p === 'object' ? p : {}
  const keys: string[] = Object.keys(src)
  for (let i = 0; i < keys.length; i += 1) {
    const v: any = src[keys[i]]
    if (v === undefined || v === null) continue
    out[keys[i]] = String(v)
  }
  return out
}

/** 一条结果条的缺省形状：文字说结论，细节说 git 原话；两者都由词条渲染，这里只存键与参数。 */
const vcWtResultOf = function (r: any): any {
  if (!r || typeof r !== 'object') return null
  const tone: string = r.tone === 'warn' || r.tone === 'error' ? String(r.tone) : 'ok'
  const dirs: string[] = []
  if (Array.isArray(r.dirs)) for (let i = 0; i < r.dirs.length; i += 1) dirs.push(vcWtUiStr(r.dirs[i]))
  return {
    tone: tone,
    textKey: vcWtUiStr(r.textKey),
    textParams: vcWtParamsOf(r.textParams),
    detailKey: vcWtUiStr(r.detailKey),
    detailParams: vcWtParamsOf(r.detailParams),
    detailText: vcWtUiStr(r.detailText),
    dirs: dirs,
  }
}

/** 表单错误的缺省形状：键 + 参数，渲染时再翻成人话（处理层拿不到 t）。 */
const vcWtFormErrorOf = function (e: any): any {
  if (!e || typeof e !== 'object' || vcWtUiStr(e.key) === '') return null
  return { key: vcWtUiStr(e.key), params: vcWtParamsOf(e.params) }
}

/** 页面读数的缺省形状：所有字段都在，界面不用到处判 undefined。 */
export const vcWorktreesUiOf = function (ui: any): any {
  const w: any = ui && ui.worktrees
  const input: any = (w && w.input) || {}
  const dirs: string[] = []
  if (Array.isArray(input.dirs)) {
    for (let i = 0; i < input.dirs.length; i += 1) dirs.push(vcWtUiStr(input.dirs[i]))
  }
  const rawCreate: any = (w && w.create) || {}
  const rawMove: any = (w && w.move) || {}
  const rawSparse: any = (w && w.sparse) || {}
  const sparseRules: any = {}
  const rawRules: any = (w && w.sparseRules) || {}
  const ruleKeys: string[] = Object.keys(rawRules)
  for (let i = 0; i < ruleKeys.length; i += 1) {
    const list: any[] = Array.isArray(rawRules[ruleKeys[i]]) ? rawRules[ruleKeys[i]] : []
    const kept: string[] = []
    for (let k = 0; k < list.length; k += 1) if (vcWtUiStr(list[k]) !== '') kept.push(vcWtUiStr(list[k]))
    sparseRules[ruleKeys[i]] = kept
  }
  const sparseRulesList: string[] = []
  if (Array.isArray(rawSparse.rules)) for (let i = 0; i < rawSparse.rules.length; i += 1) sparseRulesList.push(vcWtUiStr(rawSparse.rules[i]))
  const candidates: string[] = []
  if (Array.isArray(rawSparse.candidates)) for (let i = 0; i < rawSparse.candidates.length; i += 1) candidates.push(vcWtUiStr(rawSparse.candidates[i]))
  return {
    mode: w && VC_WORKTREE_MODES.indexOf(String(w.mode)) >= 0 ? String(w.mode) : 'idle',
    op: vcWtUiStr(w && w.op),
    input: {
      path: vcWtUiStr(input.path),
      dest: vcWtUiStr(input.dest),
      branch: vcWtUiStr(input.branch),
      reason: vcWtUiStr(input.reason),
      dirs: dirs,
    },
    decision: (w && w.decision) || null,
    plan: (w && w.plan) || null,
    ticket: (w && w.ticket) || null,
    result: (w && w.result) || null,
    error: (w && w.error) || null,
    requestId: vcWtUiStr(w && w.requestId),
    filter: w && w.filter === 'abnormal' ? 'abnormal' : 'all',
    noteOpen: !(w && w.noteOpen === false),
    // 新建表单：三种错误（目录空、目录已被占用、本地没有这条分支）都写进 create.error，渲染在表单里。
    create: {
      open: rawCreate.open === true,
      path: vcWtUiStr(rawCreate.path),
      branch: vcWtUiStr(rawCreate.branch),
      mode: rawCreate.mode === 'existing' ? 'existing' : 'new',
      error: vcWtFormErrorOf(rawCreate.error),
    },
    // 移动表单：path 非空表示这一行的表单开着，draft 预填当前路径。
    move: { path: vcWtUiStr(rawMove.path), draft: vcWtUiStr(rawMove.draft) },
    // 稀疏检出面板：path 非空表示这一行的面板开着；rules/candidates 来自预检回包。
    sparse: {
      path: vcWtUiStr(rawSparse.path),
      rules: sparseRulesList,
      candidates: candidates,
      ruleFile: vcWtUiStr(rawSparse.ruleFile),
    },
    sparseRules: sparseRules,
    lastCreated: vcWtUiStr(w && w.lastCreated),
    lastResult: vcWtResultOf(w && w.lastResult),
  }
}