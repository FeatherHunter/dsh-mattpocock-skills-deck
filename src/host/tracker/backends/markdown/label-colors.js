// label-colors.js —— 工作区里那份本地配色文件（docs/agents/label-colors.json）的读写与放置。
// 以后谁改它：改配色文件的位置、形状、默认内容、写入方式（原子写与串行化）、放置时机的人。
// 另外两半各自住一个文件：内置默认色表在 label-colors-palette.js，票面上色在 label-colors-paint.js；
// 契约那两条操作（列出标签 / 批量改色）在 label-colors-ops.js。
//
// 这份文件是「本地 Markdown 后端的标签颜色从哪来」的唯一真源（#618）：JSON 里的键值对就是标签与颜色，
// 用户可以直接手改它，插件只写这一个文件。旧的那张 docs/agents/triage-labels.md 调色盘表已经不再读
// （按「干净切断」的口径：不做迁移、也不回填）。
//
// 文件形状（先按 #615 定下的形状写，一个 JSON 对象）：
//   {"wayfinder:map": "8b5cf6", "bug": "d73a4a", "还没配色的": ""}
//   键是标签名原样（可以有冒号、空格），值是颜色：不带井号的六位十六进制，大小写都收，读进来统一成小写；
//   空串表示「这个标签还没配颜色」（界面按灰显示）。想给某个标签写一句含义说明时，
//   把值写成 {"color": "8b5cf6", "description": "地图票"} 也可以，读的时候两种写法都认。
//
// 为什么写入要串行化、要有原子发布、读不出来就不许写（三条硬要求，出处见 src/host/tracker/contract.js
// 的 setLabelColors 注释）：
//   同一个工作区可能开着两个会话，两边同时保存时「读—改—写」会交错，后写的那份把先写的那份整轮改动
//   无声抹掉（保存成功、颜色却没变，最难查）；配色文件又是用户会手改、会提交进版本库的文件，
//   写一半崩掉就会留下半截内容；读不出来（被占用、写坏了）时若照常覆盖，用户手写的内容就被推平了。
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { normalizeColor } from '../../../../shared/label-color/colors.js'
import { readTextFile } from './read.js'
import { writeTextFile, renameFile } from './write.js'
import { getPlat } from './issues-locate.js'
import { builtinColorObject } from './label-colors-palette.js'

/** 配色文件在工作区里的相对位置（工作区根 = 本次调用上下文里的 cwd）。 */
export const LABEL_COLORS_REL_PATH = 'docs/agents/label-colors.json'

// ── 路径与文件服务 ─────────────────────────────────────────────────────────────

function getFs(ctx) {
  if (ctx && ctx.platform && ctx.platform.fs) return ctx.platform.fs
  if (ctx && ctx.fs) return ctx.fs
  if (ctx && typeof ctx.get === 'function') { try { const f = ctx.get('fs'); if (f) return f } catch (e) {} }
  return null
}

/** 这个工作区根目录（配色文件落在它的 docs/agents/ 下）。 */
function workspaceDirOf(ctx, repo) {
  if (ctx && typeof ctx.cwd === 'string' && ctx.cwd) return ctx.cwd
  if (repo && typeof repo.refId === 'string' && repo.refId) return repo.refId
  return (typeof process !== 'undefined' && typeof process.cwd === 'function') ? process.cwd() : '.'
}

/** 队列钥匙：同一个工作区的不同写法（盘符大小写、斜杠方向、尾部斜杠）必须落到同一把钥匙上。
 *  为什么不能直接用路径串当钥匙：`D:\ws` 与 `d:/ws` 是同一个工作区，用原始串会各走一条队列，
 *  两次并发保存就会交错执行、后写的那份把先写的那份整份覆盖——正是本功能要防的那种「保存成功、
 *  颜色却没变」（审查实测：/ws 与 /WS 同时保存会丢一份）。 */
function workspaceKeyOf(ctx, repo) {
  return String(workspaceDirOf(ctx, repo)).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** 配色文件的完整路径。 */
export function labelColorsPath(ctx, repo) {
  return getPlat(ctx).join(workspaceDirOf(ctx, repo), LABEL_COLORS_REL_PATH)
}

/** 工作区键散列（日志只记散列，不记路径原文）。 */
function hash8(s) {
  try {
    const t = String(s || '')
    let h = 5381
    for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
    return ('0000000' + h.toString(16)).slice(-8)
  } catch (e) { return '00000000' }
}

/** 写入记常驻：用户点一次保存才发生一次，低频、轻量，始终落盘。 */
function logWrite(ctx, fields) {
  try { if (ctx && typeof ctx.logEvent === 'function') ctx.logEvent('info', 'labelColors.write', fields) } catch (e) {}
}

/** 读取记按需：界面渲染与列标签都会读它，属高频路径，只在调试开关打开时才记。
 *  按纪律必须在同一行先判开关：关着的时候连字段对象都不组装（build 函数根本不会被调用）。 */
function logRead(ctx, build) {
  try {
    if (!ctx || typeof ctx.logEvent !== 'function') return
    if (typeof ctx.isEnabled === 'function' && ctx.isEnabled('debug') === true) ctx.logEvent('debug', 'labelColors.read', build())
  } catch (e) {}
}

// ── 读 ────────────────────────────────────────────────────────────────────────

/** 「读不出来」这一档：工作区里配色文件存在但读不出来。
 *  按契约归解析档（parse），文案要说清是读不出来、以及插件不会覆盖用户自己写的内容。 */
function readFailure(why, detail) {
  return {
    ok: false,
    error: {
      kind: ERROR_KIND.PARSE,
      message: '工作区里的配色文件（' + LABEL_COLORS_REL_PATH + '）读不出来：' + why +
        '。请先手工把它改成合法内容再试；插件不会覆盖你自己写的内容' + (detail ? '（' + detail + '）' : ''),
    },
  }
}

/** 「文件确实不在」的判据：只有它才允许按「还没有这份文件」处理。
 *  为什么定得这么窄：其余任何读探测失败（权限、被占用、位置被换成目录、磁盘故障）都不能证明文件不存在，
 *  照「没有这份文件」处理的话，下一步的放置就会用默认 11 色把用户手写的内容整份覆盖掉——那是真实的数据丢失
 *  （审查实测：让 lstat/stat/readText 全失败而写成功，旧写法确实覆盖了用户原文）。
 *  两种环境各有一种「不在」的写法：DSH 文件服务给 `FS_NOT_FOUND`（消息里是 `not found`），
 *  Node 那套文件系统给 `ENOENT`。
 *  这一条判据对「文件」与「目录」是同一套：列标签时 `issues/` 目录不存在也按「这个地图还没有票」处理。 */
export function isMissingFile(e) {
  const code = String((e && (e.code || (e.cause && e.cause.code))) || '')
  if (code === 'ENOENT' || code === 'FS_NOT_FOUND') return true
  const msg = String((e && e.message) || e || '')
  return /ENOENT|FS_NOT_FOUND/i.test(msg) || /cannot read .*: not found/i.test(msg)
}

/** 读配色文件。
 *  返回 {ok:true, colors, raw, present} 或 {ok:false, error}。
 *    colors —— 标签名 → 颜色（不带井号的小写六位；空串 = 文件里写了但还没配颜色，或写了个不合法的颜色）
 *    raw    —— 文件里原本的那份对象（保存时要按原样保留用户自己写的其它行与写法）
 *    present—— 文件确确实实不在（只有明确的「不在」才是 false；读不出来是另一档，见下）
 *  不存在与读不出来是两件事：不存在不算错（新工作区还没建过这份文件，用内置默认色就够，也可以放置一份）；
 *  读不出来（权限、被占用、位置被换成目录、内容不是合法 JSON）一律 {ok:false}，调用方据此拒绝写入。
 *  没有文件服务时按「文件确确实实不在」处理：这与本房间既有的读辅助件（readDir 返回空表、exists 返回 false）
 *  是同一套约定，契约测试也是在没有文件服务的上下文里调这个后端的。 */
export async function readLabelColors(ctx, repo) {
  const path = labelColorsPath(ctx, repo)
  const where = () => hash8(workspaceKeyOf(ctx, repo))
  if (!getFs(ctx)) {
    logRead(ctx, () => ({ cwdHash: where(), present: false, count: 0, ok: true }))
    return { ok: true, colors: {}, raw: {}, present: false }
  }
  let text = ''
  try { text = await readTextFile(ctx, path) } catch (e) {
    if (isMissingFile(e)) {
      logRead(ctx, () => ({ cwdHash: where(), present: false, count: 0, ok: true }))
      return { ok: true, colors: {}, raw: {}, present: false }
    }
    logRead(ctx, () => ({ cwdHash: where(), present: true, count: 0, ok: false, reason: 'read-fail' }))
    return readFailure('读它的时候出错了', String((e && e.message) || e).slice(0, 120))
  }
  let parsed = null
  try { parsed = JSON.parse(String(text || '')) } catch (e) {
    logRead(ctx, () => ({ cwdHash: where(), present: true, count: 0, ok: false, reason: 'not-json' }))
    return readFailure('内容不是合法的 JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logRead(ctx, () => ({ cwdHash: where(), present: true, count: 0, ok: false, reason: 'not-object' }))
    return readFailure('内容要是一个「标签名 → 颜色」的对象', '这次读到的是 ' + (Array.isArray(parsed) ? '一份清单' : typeof parsed))
  }
  const colors = {}
  for (const name of Object.keys(parsed)) {
    const value = parsed[name]
    let colorText = ''
    if (typeof value === 'string') colorText = value
    else if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.color === 'string') colorText = value.color
    else {
      logRead(ctx, () => ({ cwdHash: where(), present: true, count: Object.keys(parsed).length, ok: false, reason: 'bad-entry' }))
      return readFailure('「' + name + '」这一行的写法不对', '颜色要么写成 "8b5cf6" 这样的字符串，要么写成 {"color": "8b5cf6", "description": "..."}')
    }
    // 颜色写错了不算文件坏掉：按「还没配颜色」处理（界面显示为灰），用户改回来就能恢复。
    colors[name] = normalizeColor(colorText) || ''
  }
  logRead(ctx, () => ({ cwdHash: where(), present: true, count: Object.keys(colors).length, ok: true }))
  return { ok: true, colors: colors, raw: parsed, present: true }
}

// ── 写 ────────────────────────────────────────────────────────────────────────

/** 默认文件内容：内置默认的那些标签，颜色按内置表预填。
 *  形状与用户手写的形状一致（一个 JSON 对象，键是标签名、值是颜色），方便人直接看懂、直接改。 */
export function defaultLabelColorsText() {
  return JSON.stringify(defaultLabelColors(), null, 2) + '\n'
}

// 单写者队列（照 src/host/logStore.js 的单写者刷盘写法）：同一个文件的读—改—写排成一条链，
// 后来的调用等前一条做完再做。为什么必须有：两个会话同时保存时交错执行会丢整轮改动（见文件头）。
const writerChains = new Map()
function withSingleWriter(key, work) {
  const prev = writerChains.get(key) || Promise.resolve()
  const run = prev.then(work, work)
  // 链上只留「上一条已经结束」这个事实：上一条失败不该把后面的调用一起带崩。
  writerChains.set(key, run.then(function () {}, function () {}))
  return run
}

/** 原子发布：先把完整内容写进同目录的临时文件，再把它改名成目标文件。
 *  为什么要临时文件＋改名：这份文件是用户会手改、会提交进版本库、而且是「整份一次性覆盖」的文件，
 *  直接往目标上写，写一半崩掉就会把用户的内容留成半截。
 *  为什么还要有「没有改名原语」的那条退路：DSH 的文件服务只给了 writeText / editText 两个写方法，
 *  没有改名原语（读它的实现可以看到：它自己的 writeText 就是「同目录暂存文件 + 改名」发布的，
 *  见 dsh-fs-local 的 writeFileAtomic），所以真实宿主里走的是这条退路——一次调用写完整份内容，
 *  同样是整份替换、不会留下半截文件。两条路都写完整份内容，都不做「边算边往目标上写」。 */
async function publishAtomically(ctx, targetPath, text) {
  const fs = getFs(ctx)
  if (!fs) throw Object.assign(new Error('fs unavailable'), { kind: ERROR_KIND.ENV })
  // 本次调用的政策由宿主按当前会话算好放在上下文里（见 src/host/workspaceCwd.js 的 resolveSandboxPolicy）。
  // 这里原样往下传，不自己填模式：会话是只读时就该被 DSH 拒掉。
  const policy = ctx && ctx.sandboxPolicy
  if (typeof fs.rename !== 'function') {
    await writeTextFile(ctx, targetPath, text, policy)
    return 'write-text'
  }
  const tmpPath = targetPath + '.' + String((typeof process !== 'undefined' && process.pid) || 0) + '.tmp'
  await writeTextFile(ctx, tmpPath, text, policy)
  try {
    await renameFile(ctx, tmpPath, targetPath)
  } catch (e) {
    // 改名没成功：把临时文件清掉（清不掉也不影响目标文件，目标文件此时仍是旧内容），再把错报上去。
    try { if (typeof fs.rm === 'function') await fs.rm(tmpPath, { force: true }) } catch (e2) {}
    throw e
  }
  return 'rename'
}

/** 写失败分档（按「研究：宿主往用户工作区写文件的边界与失败语义」#614 的结论）：
 *  沙箱拒绝必须能单独辨认——那是插件自己的限制，不是用户的文件权限问题（不许说成「目录不可写」）；
 *  其余按路径类 / 占用类 / 只读类 / 空间类给不同的说法；分不出来时归环境档但不说成权限问题。 */
export function describeWriteFailure(err) {
  const message = String((err && err.message) || err || '')
  const code = String((err && (err.code || err.kind)) || '')
  if (err && err.readBackMismatch === true) {
    return { kind: ERROR_KIND.ENV, message: '保存失败：写完之后回读，文件里的内容和刚写进去的不一致（可能有别的程序同时在改这份文件，或者这次写没有真正落盘）。请打开这个文件看一眼再重试；插件不会在你不知情的时候把内容推平。' }
  }
  if (code === 'FS_SANDBOX_DENIED' || /file access denied|workspace-write|read-only mode/i.test(message)) {
    return { kind: ERROR_KIND.ENV, message: '保存失败：插件没有被允许往这个工作区写文件。这是插件自己的限制，不是你的文件权限问题——去改文件或文件夹的权限不会有帮助。' }
  }
  if (/ENOSPC/.test(message) || code === 'ENOSPC') {
    return { kind: ERROR_KIND.ENV, message: '保存失败：磁盘空间不足，配色没有写进去。腾出空间后再试；你的文件没有被改动。' }
  }
  // EPERM / EACCES 在「临时文件 + 改名」这种发布方式下原因不止一种（研究 #614 实测：只读、被别的程序
  // 占用、目标位置被换成目录，三种都会走到改名这一步并抛同一个 EPERM），所以这里不断言单一原因，
  // 把三种可能一并说清，每种都给一句「怎么做能解决」。
  if (/EACCES|EPERM/.test(message) || code === 'EACCES' || code === 'EPERM' || code === 'FS_NOT_REGULAR_FILE') {
    return {
      kind: ERROR_KIND.ENV,
      message: '保存失败：写不进 ' + LABEL_COLORS_REL_PATH + '。常见三种原因，按你的情况处理：' +
        '① 这个文件或它所在的文件夹是只读的（去掉只读属性再试）；' +
        '② 文件正被别的程序占着（编辑器、同步盘、杀毒都常见，关掉那个程序再试）；' +
        '③ 这个位置不是一份普通文件（例如被换成了目录或同名文件夹，换回文件再试）。' +
        '你的文件没有被改动，可以重试。',
    }
  }
  if (/ENOENT/.test(message) || code === 'ENOENT' || code === 'EISDIR' || code === 'FS_NOT_FOUND') {
    return { kind: ERROR_KIND.ENV, message: '保存失败：写不进 ' + LABEL_COLORS_REL_PATH + '，它所在的文件夹不见了。文件没有改动，可以重试。' }
  }
  // 认不出来的一律归环境档，并说清责任在插件这边（错误原文不进给用户的文案：
  // 原子写失败时错误里的路径是临时文件名，用户会去找一个不存在的文件）。
  return { kind: ERROR_KIND.ENV, message: '保存失败：写配色文件的时候出错了，你的文件没有被改动（写坏的临时文件已经清掉）。这是插件这边的问题，不是你操作错了。' }
}

/** 放置配色文件（幂等）。两条路都走它：① 用户为工作区选定后端时；② 首次打开改色弹窗时。
 *  硬要求：文件已经存在时一个字都不改——先读一次，能读到就原样返回，绝不覆盖用户改过的内容。
 *  读不出来（不是「确确实实不在」）时也不动它，并如实报错：那种情况下我们并不知道文件里有什么，
 *  照默认内容写一遍就等于把用户手写的东西整份抹掉。
 *  返回 {ok:true, placed, reason} 或 {ok:false, error}。placed=true 表示这次真的新建了一份。 */
export async function ensureLabelColors(ctx, repo) {
  return await withSingleWriter(workspaceKeyOf(ctx, repo), async () => {
    const read = await readLabelColors(ctx, repo)
    if (!read.ok) {
      // 读不出来就不动它（也不覆盖），并且留痕：调用方与日志都要能看见「这次放置没做成、原因是读不出来」。
      logWrite(ctx, { cwdHash: hash8(workspaceKeyOf(ctx, repo)), count: 0, ok: false, reason: 'refused-read-fail' })
      return read
    }
    if (read.present) return { ok: true, placed: false, reason: 'exists' }
    try {
      await publishLabelColors(ctx, repo, defaultLabelColors(), 'placed')
    } catch (e) {
      return { ok: false, error: describeWriteFailure(e) }
    }
    return { ok: true, placed: true, reason: 'created' }
  })
}

/** 默认文件内容里那份「标签 → 颜色」对象（表与颜色都来自 label-colors-palette.js 注入的那份表）。 */
function defaultLabelColors() {
  return builtinColorObject()
}

/** 把一份新的标签 → 颜色对象发布进文件（整份覆盖，原子写），写成功后记一条常驻日志。
 *  保存成功后回读比对（研究 #614 §3.3 点名要做的事）：只写不校验的话，被别的进程覆盖或这次写其实
 *  没落盘时，用户会看到「保存成功、颜色却没变」而没有任何线索。回读不一致就如实报错，不静默当成功。
 *  返回 'rename' 或 'write-text'（走了哪条发布路径，给日志与门禁用）；失败抛错，由调用方分档。 */
export async function publishLabelColors(ctx, repo, next, reason) {
  const text = JSON.stringify(next, null, 2) + '\n'
  const key = workspaceKeyOf(ctx, repo)
  const count = Object.keys(next).length
  let via = ''
  try {
    via = await publishAtomically(ctx, labelColorsPath(ctx, repo), text)
    const back = await readTextFile(ctx, labelColorsPath(ctx, repo))
    if (String(back) !== text) {
      const err = new Error('label-colors read-back mismatch')
      err.readBackMismatch = true
      throw err
    }
  } catch (e) {
    logWrite(ctx, { cwdHash: hash8(key), count: count, ok: false, reason: 'write-fail' })
    throw e
  }
  logWrite(ctx, { cwdHash: hash8(key), count: count, ok: true, reason: reason === 'placed' ? 'placed' : 'saved', via: via })
  return via
}

/** 同一个文件的读—改—写排队执行（单写者队列）。导出给契约操作那两条用。
 *  钥匙按工作区归一（见 workspaceKeyOf）：同一个工作区的不同写法必须排同一条队。 */
export function withLabelColorsWriter(ctx, repo, work) {
  return withSingleWriter(workspaceKeyOf(ctx, repo), work)
}


export default { LABEL_COLORS_REL_PATH, labelColorsPath, readLabelColors, ensureLabelColors, publishLabelColors, describeWriteFailure, isMissingFile, withLabelColorsWriter, defaultLabelColorsText }

