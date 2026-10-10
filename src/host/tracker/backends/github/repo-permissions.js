/**
 * backends/github/repo-permissions.js — 「这个仓库我能不能写」的单一出口（#992）。
 *
 * 为什么要有它：只读仓库上「建标签」「给票打标签」「批量改色」撞到的都是同一句 HTTP 404，
 * 光看错误文本分不出「标签不存在」还是「你没有写权限」。准确判据是
 * `gh api repos/<owner>/<name>` 回包里的 `.permissions.push` / `.permissions.triage`
 * （三样本实测：只读两仓 push:false,triage:false，本仓全 true），而不是 viewerPermission
 * （它把 triage 压扁了，分不出「能打标、不能建标签」的人）。命令形状与现有 repoAccess /
 * 预检同一形状（`gh api repos/` 前缀），不新增命令种类。
 *
 * 用法：调用方（setLabels 的 404 归因、改色链的 explain404、deck_context 的能力位）
 * 每批只读一次、批内复用 —— 把同一个 Map 传进来，同一仓库第二次问直接拿上一次的结论，
 * 不再另起进程。Map 里存的是承诺（Promise），并行的几条失败同时撞上也只真问一次。
 * 作用域只活一批（调用方现场建、现场丢），不跨批、不落盘。读不到（网络、仓库不存在、
 * 字段缺失）返回 null，调用方走已有的「分不清」诚实分支，不瞎猜。
 *
 * 日志：不新增事件名。这一路走 ghClient.execGh，调用成功与否由房内既有的
 * 常驻 gh.exec 记一行（只记命令名与耗时，不记仓库原文），这里不再另记。
 */

function pickPermissions(raw) {
  if (!raw || typeof raw !== 'object') return null
  const p = raw.permissions
  if (!p || typeof p !== 'object') {
    // --jq .permissions 在仓库不存在时 gh 直接报错走失败分支；能到这里却没字段，视为问不出来
    return null
  }
  if (typeof p.push !== 'boolean' || typeof p.triage !== 'boolean') return null
  return { push: p.push, triage: p.triage }
}

/**
 * 问一次「当前账号在这个仓库上的写权限」（只读命令，无副作用）。
 * @param {Object} c ghClient 的产物（execGh）
 * @param {string} spec `owner/name`
 * @param {Object} ctx OpContext（含 cwd）
 * @param {Map} [cache] 批内复用位（同批调用方共用一个；不传则这次单独问一次）
 * @returns {Promise<{push:boolean,triage:boolean}|null>} 问不出来返回 null（调用方按「分不清」处理）
 */
export async function readRepoPermissions(c, spec, ctx, cache) {
  const key = String(spec || '').trim()
  if (!key || key.indexOf('/') <= 0) return null
  if (cache && typeof cache.get === 'function' && typeof cache.set === 'function') {
    if (cache.has(key)) {
      try {
        const hit = await cache.get(key)
        return hit === undefined ? null : hit
      } catch {
        return null
      }
    }
    const pending = queryPermissions(c, key, ctx)
    cache.set(key, pending)
    try {
      return await pending
    } catch {
      return null
    }
  }
  try {
    return await queryPermissions(c, key, ctx)
  } catch {
    return null
  }
}

async function queryPermissions(c, spec, ctx) {
  const cwd = ctx && typeof ctx.cwd === 'string' ? ctx.cwd : undefined
  const r = await c.execGh(['api', 'repos/' + spec, '--jq', '.permissions'], { cwd: cwd })
  if (!r || !r.ok) return null
  const text = String((r.data && (r.data.stdout || r.data.text)) || '').trim()
  if (!text || text === 'null') return null
  try {
    return pickPermissions({ permissions: JSON.parse(text) })
  } catch {
    return null
  }
}

/**
 * 只读仓库那句统一说法（一种算法、一种说法：调用方不再各写一份）。
 * @param {string} spec `owner/name`（失败归因里必须带上它，用户才看得出绑的是哪个仓库）
 * @param {string[]} names 这次没挂上的标签名（原样列出，不截断到只剩数量）
 */
export function readonlyMessage(spec, names) {
  const list = (Array.isArray(names) ? names : []).map((n) => String(n || '').trim()).filter(Boolean)
  const suffix = list.length ? '这次没挂上的标签（' + list.join('、') + '）' : '这次要加的标签'
  return '你在「' + String(spec || '') + '」上只有读权限，没有给票打标签的权限（打标签要 triage 及以上，新建标签要 push）——'
    + suffix + '没写进去，票本身不受影响。请换有写权限的账号，或请仓库管理员授予权限后补打。'
}

export default { readRepoPermissions, readonlyMessage }
