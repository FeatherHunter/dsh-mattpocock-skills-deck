// tests/verify-markdown-label-colors.js —— 本地配色文件的三条硬要求（#618 的验收硬条件）：
//   ① 文件读不出来时，改色一个字节都不许写，文件内容原样不动；
//   ② 写入走的是「临时文件 + 改名」，不是直接覆盖目标（原子发布的证据）；
//   ③ 同一工作区两次并发保存，不许丢更新（单写者队列）。
// 另外守着：默认文件内容与内置调色盘一致、放置幂等、并集语义、不在文件里的标签不许新增一行、
// 颜色的空值语义（两边都空不算变）。
//
// 怎么装的：用一份假文件系统装配**真实**的本地 Markdown 后端模块（不是另写一个假后端），
// 走的是后端真实的那两条契约操作与真实的读写函数；假文件系统只替换磁盘，并把它收到的每一次
// 写与改名都记下来，供上面三条硬要求拿来当证据。
//
// 为什么要有这一条门禁：#627 交接时写明「本地 Markdown 写入的三条硬要求现在只写在契约注释里，
// 没有任何可执行守卫」，本文件就是那三条的守卫。把实现临时改成「直接覆盖目标」或「读不出来也照写」，
// 这一条会立刻亮红（自证记录见 .scratch/map610/reports/issue-618.md）。
import nodePath from 'node:path'
import { markdownModule } from '../src/host/tracker/backends/markdown/index.js'
import { describeWriteFailure } from '../src/host/tracker/backends/markdown/label-colors.js'
import { CANONICAL_LABELS } from '../src/shared/labels.js'
import { colorsDiffer } from '../src/shared/label-color/colors.js'

let failed = 0
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const WS = '/ws'
const COLOR_PATH = '/ws/docs/agents/label-colors.json'
const REF = { backend: 'markdown', refId: '/ws', name: 'ws', url: '' }

/** 假文件系统：只替换磁盘，接口形状照 DSH 文件服务（resolve 出句柄、readText/writeText 吃句柄）。
 *  每一次写与改名都记在 calls 里，三条硬要求就靠它取证。 */
function makeFakeFs(seed) {
  // 路径一律按大小写不敏感存（Windows / macOS 的真实行为）：这样 /ws 与 /WS 指的是同一份文件，
  // 「同一个工作区不同写法」这一类并发问题才装得进来（D2 那条断言要用）。
  const K = (p) => String(p).toLowerCase()
  const files = new Map()
  for (const k of Object.keys(seed || {})) files.set(K(k), String(seed[k]))
  // 目录集合从种子文件推出来（每个文件的各级父目录都存在），另加配色文件所在的目录。
  // 别的目录就是「不存在」——列它应当抛 ENOENT（真实文件系统就是这么做的），
  // 这样「地图还没有 issues/ 子目录」那条用例才真的走到实现里（A1）。
  const dirs = new Set(['/ws', '/ws/docs', '/ws/docs/agents'])
  for (const k of files.keys()) {
    let d = k
    while (d.includes('/')) {
      d = d.slice(0, d.lastIndexOf('/'))
      if (d) dirs.add(d)
    }
  }
  const calls = { writeText: [], rename: [], readText: [] }
  const failRead = new Set()
  const failProbe = new Set()
  const tamperWrite = { on: false }
  const delay = (ms) => new Promise((r) => setTimeout(r, ms))
  const fs = {
    calls: calls,
    failReadOn(p) { failRead.add(K(p)) },
    // 模拟「探测文件在不在的每一路都失败，但写是通的」（权限问题、被其他程序锁住、路径被换成目录都可能这样）：
    // lstat/stat/readText 全抛 EACCES，写与改名照常работа。D1 那条断言要用这个形状。
    failProbeOn(p) { failProbe.add(K(p)) },
    // 模拟「写是成功了，但落盘的内容和写进去的不一样」（别的程序同时在改这份文件）：D4 的回读校验要用。
    tamperWritesOn() { tamperWrite.on = true },
    show(p) { return files.has(K(p)) ? files.get(K(p)) : null },
    async resolve(p) { return String(p) },
    async readText(t) {
      const p = String(t)
      calls.readText.push(p)
      if (failRead.has(K(p)) || failProbe.has(K(p))) throw Object.assign(new Error('EACCES: permission denied, open \'' + p + '\''), { code: 'EACCES' })
      if (!files.has(K(p))) throw Object.assign(new Error('ENOENT: no such file or directory, open \'' + p + '\''), { code: 'ENOENT' })
      await delay(1)
      return files.get(K(p))
    },
    async writeText(t, content) {
      const p = String(t)
      const body = tamperWrite.on ? String(content) + '{"别人改的":"111111"}' : String(content)
      calls.writeText.push({ path: p, content: body })
      await delay(1)
      files.set(K(p), body)
    },
    async rename(from, to) {
      const a = String(from); const b = String(to)
      calls.rename.push({ from: a, to: b })
      if (!files.has(K(a))) throw Object.assign(new Error('ENOENT: no such file or directory, rename'), { code: 'ENOENT' })
      files.set(K(b), files.get(K(a)))
      files.delete(K(a))
    },
    async rm(p) { files.delete(K(p)) },
    async mkdir(p) { dirs.add(K(p)) },
    async lstat(p) { if (failProbe.has(K(p))) throw Object.assign(new Error('EACCES: permission denied, lstat \'' + p + '\''), { code: 'EACCES' }); return files.has(K(p)) ? { mtime: 0 } : null },
    async stat(p) { if (failProbe.has(K(p))) throw Object.assign(new Error('EACCES: permission denied, stat \'' + p + '\''), { code: 'EACCES' }); return files.has(K(p)) ? { mtime: 0 } : null },
    async listDir(p) {
      const p2 = K(p).replace(/\/+$/, '')
      if (failProbe.has(p2)) throw Object.assign(new Error('EACCES: permission denied, scandir \'' + p + '\''), { code: 'EACCES' })
      if (!dirs.has(p2)) throw Object.assign(new Error('ENOENT: no such file or directory, scandir \'' + p + '\''), { code: 'ENOENT' })
      const out = new Set()
      const add = (k) => {
        if (!k.startsWith(p2 + '/')) return
        const rest = k.slice(p2.length + 1)
        const seg = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest
        if (seg) out.add(seg)
      }
      for (const k of files.keys()) add(k)
      for (const d of dirs.keys()) add(d)
      return Array.from(out)
    },
  }
  return fs
}

const events = []
function mkCtx(fakeFs) {
  return {
    cwd: WS,
    platform: { path: nodePath.posix, fs: fakeFs },
    fs: fakeFs,
    logEvent: (level, event, fields) => events.push({ level: level, event: event, fields: fields }),
    isEnabled: (level) => level === 'debug',
  }
}

const tracker = markdownModule.create({})

// ── 一、默认文件内容：内置调色盘那 11 个标签，颜色小写，且与 src/shared/labels.js 不打架 ──
{
  const fake = makeFakeFs({})
  const ctx = mkCtx(fake)
  const r = await tracker.ensureLabelColorsFile(REF, ctx)
  check(r.ok === true && r.placed === true, '放置配色文件：文件不存在时新建一份（实得 ' + JSON.stringify(r) + '）')
  const text = fake.show(COLOR_PATH)
  let parsed = null
  try { parsed = JSON.parse(String(text)) } catch (e) { parsed = null }
  check(!!parsed && typeof parsed === 'object' && !Array.isArray(parsed), '新文件是「标签名 → 颜色」的 JSON 对象')
  const names = parsed ? Object.keys(parsed) : []
  check(names.length === 11, '新文件预填 11 个内置标签（实得 ' + names.length + '）')
  check(names.every((n) => typeof parsed[n] === 'string' && /^[0-9a-f]{6}$/.test(parsed[n])), '新文件里的颜色都是不带井号的小写六位十六进制')
  // 与 src/shared/labels.js 单源对齐：两边都收录的标签，颜色（忽略大小写）必须一致。
  const drift = CANONICAL_LABELS.filter((l) => parsed && parsed[l.name] && String(parsed[l.name]).toLowerCase() !== String(l.color).toLowerCase())
  check(drift.length === 0, '新文件里与 src/shared/labels.js 同名的标签颜色一致（不一致的：' + drift.map((l) => l.name).join('、') + '）')
  const written = fake.calls.writeText
  check(written.length === 1 && written[0].path !== COLOR_PATH && written[0].path.startsWith(COLOR_PATH), '放置配色文件：只写了一次，写的是临时文件（实得 ' + JSON.stringify(written.map((w) => w.path)) + '）')
  check(fake.calls.rename.some((x) => x.to === COLOR_PATH), '放置配色文件：再改名发布成目标文件')
}

// ── 二、幂等：文件已存在时一个字都不改（用户手改过的内容原样留着）──
{
  const mine = '{\n  "我的标签": "abcdef"\n}\n'
  const fake = makeFakeFs({ [COLOR_PATH]: mine })
  const ctx = mkCtx(fake)
  const r = await tracker.ensureLabelColorsFile(REF, ctx)
  check(r.ok === true && r.placed === false, '放置配色文件：文件已存在时不新建（实得 ' + JSON.stringify(r) + '）')
  check(fake.show(COLOR_PATH) === mine, '放置幂等：文件内容一个字节都没动')
  check(fake.calls.writeText.length === 0, '放置幂等：一次写都没发生（实得 ' + fake.calls.writeText.length + ' 次）')
}

// ── 二之二、D1：探测全失败但写得进时，放置绝不能覆盖用户手写的内容 ──
// 这一条守的是「只有明确的『文件不在』才允许按没有文件处理」：
// 旧写法把「文件在不在」建在 exists() 上，而房间的 exists() 把 lstat/stat/access/读一字节的每一路失败
// 都吞成 false —— 于是「文件读不出来（权限、被占用、位置被换成目录）」被当成「没有这份文件」，
// 放置就用默认 11 色把用户手写的原文整份覆盖了。这是真实的数据丢失路径。
{
  const mine = '{"bug":"abcdef"}'
  const fake = makeFakeFs({ [COLOR_PATH]: mine })
  fake.failProbeOn(COLOR_PATH)         // 探测在不在的每一路（lstat/stat/读）全失败，但写是通的
  const ctx = mkCtx(fake)
  const r = await tracker.ensureLabelColorsFile(REF, ctx)
  check(r.ok === false && r.error && r.error.kind === 'parse', '放置：读不出来（不是明确的「不在」）→ 如实失败（实得 ' + JSON.stringify(r) + '）')
  check(fake.calls.writeText.length === 0, '放置硬要求：探测失败时零写入（实得 ' + fake.calls.writeText.length + ' 次）')
  check(fake.show(COLOR_PATH) === mine, '放置硬要求：用户手写的原文一个字节没变')

  // 反例：真的不在（明确的 ENOENT）时才新建，别把「文件不在」也一并堵死。
  const fake2 = makeFakeFs({})
  const r2 = await tracker.ensureLabelColorsFile(REF, mkCtx(fake2))
  check(r2.ok === true && r2.placed === true, '放置：文件确确实实不在（明确的「不在」）时照常新建一份（实得 ' + JSON.stringify(r2) + '）')
}

// ── 三、硬要求①：文件读不出来时，改色零写入、文件原样不动 ──
{
  const mine = '{"bug": "d73a4a"\n'   // 少一个右花括号：读得出来但解析不了
  const fake = makeFakeFs({ [COLOR_PATH]: mine })
  const ctx = mkCtx(fake)
  const r = await tracker.setLabelColors(REF, [{ name: 'bug', color: '0b7285' }], ctx)
  check(r.ok === false && r.error && r.error.kind === 'parse', '文件解析不了 → 整条改色失败，落解析档（实得 ' + JSON.stringify(r) + '）')
  check(String((r.error || {}).message || '').includes('没能拿全标签') === false, '改色失败文案不说「没能拿全标签」（那是列标签那一档的说法）')
  check(fake.calls.writeText.length === 0, '硬要求①：解析不了时零写入（实得 ' + fake.calls.writeText.length + ' 次）')
  check(fake.show(COLOR_PATH) === mine, '硬要求①：文件内容一个字节没变')

  const fake2 = makeFakeFs({ [COLOR_PATH]: '{"bug": "d73a4a"}' })
  fake2.failReadOn(COLOR_PATH)
  const ctx2 = mkCtx(fake2)
  const r2 = await tracker.setLabelColors(REF, [{ name: 'bug', color: '0b7285' }], ctx2)
  check(r2.ok === false && r2.error && r2.error.kind === 'parse', '文件存在但读不出来 → 整条改色失败，落解析档（实得 ' + JSON.stringify(r2) + '）')
  check(fake2.calls.writeText.length === 0, '硬要求①：读不出来时零写入（实得 ' + fake2.calls.writeText.length + ' 次）')
  check(fake2.show(COLOR_PATH) === '{"bug": "d73a4a"}', '硬要求①：读不出来时文件一个字节没变（没有推平重写）')
}

// ── 四、硬要求②：写入走临时文件 + 改名，不是直接覆盖目标 ──
{
  const fake = makeFakeFs({ [COLOR_PATH]: JSON.stringify({ bug: 'd73a4a' }) })
  const ctx = mkCtx(fake)
  const r = await tracker.setLabelColors(REF, [{ name: 'bug', color: '0b7285' }], ctx)
  check(r.ok === true && r.data.applied.length === 1, '改文件里已有的标签成功（实得 ' + JSON.stringify(r) + '）')
  const targets = fake.calls.writeText.map((w) => w.path)
  check(!targets.includes(COLOR_PATH), '硬要求②：没有直接往目标文件上写（这一次写过的路径：' + JSON.stringify(targets) + '）')
  check(targets.some((p) => p !== COLOR_PATH && p.startsWith(COLOR_PATH)), '硬要求②：先把完整内容写进同目录的临时文件')
  const published = fake.calls.rename.some((x) => x.to === COLOR_PATH)
  check(published, '硬要求②：再改名把临时文件发布成目标文件（改名记录：' + JSON.stringify(fake.calls.rename) + '）')
  const after = JSON.parse(String(fake.show(COLOR_PATH)))
  check(after.bug === '0b7285', '硬要求②：发布之后目标文件里是新颜色（实得 ' + after.bug + '）')
  check(fake.show(targets[0]) === null || fake.show(targets[0]) === undefined, '硬要求②：临时文件发布后不留在工作区里')
}

// ── 五、硬要求③：两次并发保存不丢更新 ──
{
  const fake = makeFakeFs({ [COLOR_PATH]: JSON.stringify({ bug: 'd73a4a', 'wayfinder:map': '8b5cf6' }) })
  const ctx = mkCtx(fake)
  const p1 = tracker.setLabelColors(REF, [{ name: 'bug', color: '0b7285' }], ctx)
  const p2 = tracker.setLabelColors(REF, [{ name: 'wayfinder:map', color: 'ff00ff' }], ctx)
  const both = await Promise.all([p1, p2])
  check(both.every((r) => r.ok === true && r.data.applied.length === 1), '两次并发保存都报成功（实得 ' + JSON.stringify(both) + '）')
  const after = JSON.parse(String(fake.show(COLOR_PATH)))
  check(after.bug === '0b7285' && after['wayfinder:map'] === 'ff00ff', '硬要求③：两次改动都在文件里，没有被后写的那次抹掉（实得 ' + JSON.stringify(after) + '）')
}

// ── 五之二、D2：同一个工作区的不同写法必须排同一条队（/ws 与 /WS 同时保存不许丢）──
// 队列钥匙原来直接用路径串，`/ws` 与 `/WS` 各走一条队列，两次保存交错执行、后写的那份整份覆盖先写的。
{
  const fake = makeFakeFs({ [COLOR_PATH]: JSON.stringify({ bug: 'd73a4a', 'wayfinder:map': '8b5cf6' }) })
  const ctxLower = mkCtx(fake)
  const ctxUpper = Object.assign({}, mkCtx(fake), { cwd: '/WS' })
  const p1 = tracker.setLabelColors(REF, [{ name: 'bug', color: '0b7285' }], ctxLower)
  const p2 = tracker.setLabelColors(REF, [{ name: 'wayfinder:map', color: 'ff00ff' }], ctxUpper)
  const both = await Promise.all([p1, p2])
  check(both.every((r) => r.ok === true && r.data.applied.length === 1), '不同写法（/ws 与 /WS）并发保存都报成功（实得 ' + JSON.stringify(both) + '）')
  const after = JSON.parse(String(fake.show(COLOR_PATH)))
  check(after.bug === '0b7285' && after['wayfinder:map'] === 'ff00ff', 'D2：不同写法并发保存两边的改动都在，没有丢一份（实得 ' + JSON.stringify(after) + '）')
}

// ── 五之三、D4：保存成功后回读比对，不一致就报错（不静默当成功）──
{
  const fake = makeFakeFs({ [COLOR_PATH]: JSON.stringify({ bug: 'd73a4a' }) })
  fake.tamperWritesOn()                 // 模拟「写完之后文件里的内容与写进去的不一样」
  const ctx = mkCtx(fake)
  const r = await tracker.setLabelColors(REF, [{ name: 'bug', color: '0b7285' }], ctx)
  check(r.ok === false && r.error && r.error.kind === 'env', 'D4：回读不一致 → 如实报失败（实得 ' + JSON.stringify(r) + '）')
  check(String((r.error || {}).message || '').includes('回读'), 'D4：文案说清是回读对不上，而不是含糊的写失败（实得 ' + String((r.error || {}).message || '') + '）')
}

// ── 五之四、D3：EPERM/EACCES 不许断言单一原因 ──
{
  const d = describeWriteFailure(Object.assign(new Error('EPERM: operation not permitted, rename \'x.tmp\' -> \'label-colors.json\''), { code: 'EPERM' }))
  const m = String(d.message || '')
  check(['只读', '占着', '不是一份普通文件'].every((k) => m.includes(k)), 'D3：EPERM/EACCES 这类失败把三种可能一并说清（实得 ' + m + '）')
  check(m.includes('你的文件没有被改动'), 'D3：仍然说清文件没有被改动')
  const d2 = describeWriteFailure(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }))
  check(d2.message === m, 'D3：EACCES 与 EPERM 用同一段文案（发布方式决定了这两种错误的原因本来就分不开）')
}

// ── 六、并集语义与「不许新增一行」──
{
  const ticket = '# 一张票\n\nStatus: ready-for-agent\nLabels: bug, 只出现在票面上\n'
  const fake = makeFakeFs({
    [COLOR_PATH]: JSON.stringify({ bug: 'd73a4a', '只在文件里的标签': 'abcdef' }),
    '/ws/.scratch/demo/map.md': '# 地图\n\nStatus: ready-for-agent\nLabels: wayfinder:map\n',
    '/ws/.scratch/demo/issues/01-some-ticket.md': ticket,
  })
  const ctx = mkCtx(fake)
  const rl = await tracker.listLabels(REF, ctx)
  const names = rl.ok === true ? rl.data.map((x) => x.name) : []
  check(rl.ok === true, '列出标签成功（实得 ' + JSON.stringify(rl).slice(0, 160) + '）')
  check(names.includes('只出现在票面上'), '并集含票面出现过的标签（实得 ' + JSON.stringify(names) + '）')
  check(names.includes('只在文件里的标签'), '并集含只在配色文件里的标签')
  check(names.includes('bug') && names.includes('wayfinder:map') && names.includes('wontfix'), '并集含内置默认那些标签')
  const byName = (n) => (rl.ok === true ? rl.data.find((x) => x.name === n) : null) || {}
  check(byName('只在文件里的标签').color === 'abcdef', '文件里的标签颜色取文件里的值')
  check(byName('只出现在票面上').color === '', '文件里没有的标签颜色是空串（界面按灰显示）')
  check(byName('bug').color === 'd73a4a', '文件里写了的标签颜色取文件里的值（覆盖内置默认色）')
  check(Object.keys(byName('bug')).sort().join(',') === 'color,name', '列表项只有 name 与 color 两个键（给不了描述时省略 description）')

  const before = fake.show(COLOR_PATH)
  const rs = await tracker.setLabelColors(REF, [{ name: '还没进文件的标签', color: 'abcdef' }], ctx)
  check(rs.ok === true && rs.data.failed.length === 1 && rs.data.failed[0].reason.kind === 'not-found', '要改的标签不在文件里 → 找不到档（实得 ' + JSON.stringify(rs) + '）')
  check(String((rs.data.failed[0] || {}).reason ? rs.data.failed[0].reason.message : '').includes('label-colors.json'), '失败提示说清怎么做才能成功（指向那个文件）')
  check(fake.show(COLOR_PATH) === before, '不许新增一行：文件内容一个字节没变')
}

// ── 七、颜色的空值语义：两边都空不算变（不给没配色的标签白发请求）──
{
  check(colorsDiffer('', '') === false, '两边都没配色不算变（空值与空值相等）')
  check(colorsDiffer('', 'ABCDEF') === true, '从没配色改成一个颜色算变')
  const fake = makeFakeFs({ [COLOR_PATH]: JSON.stringify({ '还没配色的': '', bug: 'D73A4A' }) })
  const ctx = mkCtx(fake)
  const rl = await tracker.listLabels(REF, ctx)
  const byName = (n) => (rl.ok === true ? rl.data.find((x) => x.name === n) : null) || {}
  check(byName('还没配色的').color === '', '文件里写空串的标签，返回的颜色也是空串')
  check(byName('bug').color === 'd73a4a', '文件里大写写的颜色读出来转成小写（穿出契约的颜色只有一种写法）')
}

// ── 八、取不全就必须整体失败：有一张票读不出来时，列标签不许退回残缺清单 ──
{
  const fake = makeFakeFs({
    [COLOR_PATH]: JSON.stringify({ bug: 'd73a4a' }),
    '/ws/.scratch/demo/map.md': '# 地图\n\nStatus: ready-for-agent\nLabels: wayfinder:map\n',
    '/ws/.scratch/demo/issues/01-broken.md': '# 坏的票\n\nLabels: 读不出来的标签\n',
  })
  fake.failReadOn('/ws/.scratch/demo/issues/01-broken.md')
  const ctx = mkCtx(fake)
  const rl = await tracker.listLabels(REF, ctx)
  check(rl.ok === false && rl.error && (rl.error.kind === 'env' || rl.error.kind === 'network'), '有票读不出来 → 整条列标签失败，落环境档（实得 ' + JSON.stringify(rl) + '）')
  check(String((rl.error || {}).message || '').includes('没能拿全标签'), '取不全的文案说清「没能拿全标签」')
}

// ── 八之二、A1：地图还没有 issues/ 子目录时，列标签照常成功（= 这个地图还没有票）──
// 这是本票新增的「首次打开改色弹窗」会碰到的真实场景：地图刚建好、还没开任何票。
// 「目录不存在」要与「读不出来」分开：只有非 ENOENT 的读失败才按「取不全」整体失败。
{
  const fake = makeFakeFs({
    [COLOR_PATH]: JSON.stringify({ bug: 'd73a4a' }),
    '/ws/.scratch/demo/map.md': '# 地图\n\nStatus: ready-for-agent\nLabels: wayfinder:map\n',
  })
  const ctx = mkCtx(fake)
  const rl = await tracker.listLabels(REF, ctx)
  const names = rl.ok === true ? rl.data.map((x) => x.name) : []
  check(rl.ok === true, 'A1：地图只有 map.md、还没有 issues/ 目录 → 列标签照常成功（实得 ' + JSON.stringify(rl).slice(0, 140) + '）')
  check(names.includes('wayfinder:map') && names.includes('bug') && names.includes('wontfix'), 'A1：并集里有地图票面上的标签、配色文件里的标签与内置默认那些（实得 ' + JSON.stringify(names) + '）')

  // 反例（同一原则的另一半）：非 ENOENT 的目录读失败仍要按「取不全」整体失败。
  const fake2 = makeFakeFs({
    [COLOR_PATH]: JSON.stringify({ bug: 'd73a4a' }),
    '/ws/.scratch/demo/map.md': '# 地图\n\nLabels: wayfinder:map\n',
    '/ws/.scratch/demo/issues/01-a.md': '# 一张票\n\nLabels: bug\n',
  })
  fake2.failProbeOn('/ws/.scratch/demo/issues')
  const rl2 = await tracker.listLabels(REF, mkCtx(fake2))
  check(rl2.ok === false && (rl2.error.kind === 'env' || rl2.error.kind === 'network'), 'A1 反例：目录读不出来（不是不存在）→ 仍然整体失败（实得 ' + JSON.stringify(rl2).slice(0, 140) + '）')
  check(String((rl2.error || {}).message || '').includes('没能拿全标签'), 'A1 反例：文案仍是「没能拿全标签」')
}

// ── 八之三、D1 的另一半：票文件的「在不在」探测失败，不许被当成「这张票不存在」跳过 ──
// 票的清单来自列目录（列出来了就说明它当时在），接着还要判一次「这张票在不在」。
// 判「在不在」这件事本身也会失败（权限、被占用）：这种失败既不能证明票不存在，也不能把它跳过——
// 跳过的结果是标签清单静默少一截，而契约要求「取不全就必须整体失败」。
// 旧写法用 read.js 的 exists()：那支辅助件把每一路探测失败都吞成 false，于是这张票被静默跳过。
{
  const fake = makeFakeFs({
    [COLOR_PATH]: JSON.stringify({ bug: 'd73a4a' }),
    '/ws/.scratch/demo/map.md': '# 地图\n\nStatus: ready-for-agent\nLabels: wayfinder:map\n',
    '/ws/.scratch/demo/issues/01-probe-denied.md': '# 一张票\n\nLabels: 探不到但确实在的标签\n',
  })
  // 只让「探这张票在不在」失败：lstat / stat / 直接读全部抛 EACCES（权限或占用都可能长这样）。
  fake.failProbeOn('/ws/.scratch/demo/issues/01-probe-denied.md')
  const rl = await tracker.listLabels(REF, mkCtx(fake))
  check(rl.ok === false && (rl.error.kind === 'env' || rl.error.kind === 'network'), 'D1 调用点：票的存在性探测失败（不是明确的「不在」）→ 整条列标签失败，不许静默跳过（实得 ' + JSON.stringify(rl).slice(0, 140) + '）')
  check(String((rl.error || {}).message || '').includes('没能拿全标签'), 'D1 调用点：文案仍是「没能拿全标签」')
}

// ── 九、日志点：写入记常驻、读取记按需，字段只取白名单里那几个 ──
{
  const WRITE_FIELDS = ['cwdHash', 'count', 'ok', 'reason', 'via']
  const READ_FIELDS = ['cwdHash', 'present', 'count', 'ok', 'reason']
  const fake = makeFakeFs({})
  const ctx = mkCtx(fake)
  const writeEvents = []
  const readEvents = []
  ctx.logEvent = (level, event, fields) => {
    if (event === 'labelColors.write') writeEvents.push({ level: level, fields: fields })
    if (event === 'labelColors.read') readEvents.push({ level: level, fields: fields })
  }
  await tracker.ensureLabelColorsFile(REF, ctx)
  await tracker.listLabels(REF, ctx)
  check(writeEvents.length >= 1 && writeEvents.every((e) => e.level === 'info'), '写入记常驻（信息级、不依赖调试开关）：实得 ' + writeEvents.length + ' 条')
  check(writeEvents.every((e) => Object.keys(e.fields).every((k) => WRITE_FIELDS.includes(k))), '写入日志的字段只取白名单子集（实得 ' + JSON.stringify(writeEvents.map((e) => Object.keys(e.fields))) + '）')
  check(writeEvents.every((e) => !String(e.fields.cwdHash || '').includes('/')), '写入日志里的工作区只记散列，不记路径原文')
  check(readEvents.length >= 1 && readEvents.every((e) => e.level === 'debug'), '读取记按需（调试级）：实得 ' + readEvents.length + ' 条')
  check(readEvents.every((e) => Object.keys(e.fields).every((k) => READ_FIELDS.includes(k))), '读取日志的字段只取白名单子集（实得 ' + JSON.stringify(readEvents.map((e) => Object.keys(e.fields))) + '）')
  const dark = makeFakeFs({})
  const darkCtx = mkCtx(dark)
  const darkReads = []
  darkCtx.isEnabled = () => false
  darkCtx.logEvent = (level, event) => { if (event === 'labelColors.read') darkReads.push(event) }
  await tracker.listLabels(REF, darkCtx)
  check(darkReads.length === 0, '调试开关关着时，读取日志一条都不发（外层判断先挡住）')

  // 读不出来时拒绝放置，也要留下一条 ok:false 的痕（不能只有成功时才写日志）。
  const refused = makeFakeFs({ [COLOR_PATH]: '{"bug":"d73a4a"}' })
  refused.failProbeOn(COLOR_PATH)
  const refusedEvents = []
  const refusedCtx = mkCtx(refused)
  refusedCtx.logEvent = (level, event, fields) => { if (event === 'labelColors.write') refusedEvents.push({ level: level, fields: fields }) }
  await tracker.ensureLabelColorsFile(REF, refusedCtx)
  check(refusedEvents.some((e) => e.fields.ok === false), 'D5：放置没做成时日志如实写 ok:false（实得 ' + JSON.stringify(refusedEvents) + '）')
}

// ── 十、D5：「用户为工作区选定后端」这一步的放置结果要如实回给调用方 ──
// 放置失败不能在 bind 里无声丢掉：回包里带 labelColorsFile 一项说明放没放、为什么没放。
{
  const { createWorkspaceCwd } = await import('../src/host/workspaceCwd.js')
  const events = []
  const registry = {
    modules: () => [{ id: 'markdown', label: 'Markdown' }],
    bind: () => {},
    get: () => ({
      ensureLabelColorsFile: async () => ({ ok: false, error: { kind: 'env', message: '写不进去（门禁里演的失败）' } }),
    }),
    describe: () => ({ backend: 'markdown', refId: '/ws', name: 'ws', url: '' }),
    allBindings: () => [],
    bound: () => 'markdown',
    select: async () => ({ backendId: 'markdown' }),
  }
  const host = createWorkspaceCwd({
    ctx: { get: () => undefined },
    DEFAULT_CWD: '/ws',
    getPlatform: async () => ({ path: nodePath.posix, getHome: async () => '/home/u' }),
    getTrackerRegistry: async () => registry,
    getWorkspaceStore: async () => ({ invalidate: () => {} }),
    canonicalKey: async (c) => c,
    setCache: () => {},
    logCtx: { fire: (level, event, fields) => events.push({ level: level, event: event, fields: fields }), isEnabled: () => false },
    timer: { timeout: (fn, ms) => setTimeout(fn, ms) },
    detectionExec: async () => ({ ok: true }),
  })
  const r = await host.handleBind({ cwd: '/ws', backendId: 'markdown' })
  check(r.ok === true, '绑定本身照样成功（放置失败不回滚绑定）')
  check(r.labelColorsFile && r.labelColorsFile.ok === false, 'D5：bind 回包如实带上放置结果（实得 ' + JSON.stringify(r.labelColorsFile) + '）')
  check(events.some((e) => e.event === 'labelColors.write' && e.fields && e.fields.ok === false), 'D5：放置失败在宿主侧也留下一条 ok:false 的日志（实得 ' + JSON.stringify(events.filter((e) => e.event === 'labelColors.write')) + '）')
}

console.log('\n' + (failed ? '存在失败 —— 本地配色文件三条硬要求守卫未通过' : '全部通过 —— 本地配色文件三条硬要求守卫生效（' + total + ' 项断言）'))
if (failed) process.exit(1)
