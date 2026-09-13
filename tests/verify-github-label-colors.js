#!/usr/bin/env node
/**
 * tests/verify-github-label-colors.js —— GitHub 房间「列标签 / 批量改色」两条契约操作的门禁（#620）。
 *
 * 这一条守的是四件事（都能用假数据断言，不联网、不碰真仓库）：
 *   一、**调用了什么命令**：列标签必须传分页参数（`gh label list` 默认只回 30 条，不传就会静默少一截）；
 *       改色只能发 `gh label edit <名字> --repo <仓库> --color <颜色>` —— 改名、改描述、建标签、删标签
 *       的命令一个字都不许出现（本票只改颜色）。
 *   二、**颜色怎么写**：入参带井号或大写先归一（`#0B7285` → `0b7285`），穿出去的颜色只有一种写法
 *       （不带井号的六位小写）；仓库里存着的大写色值读回来也要转小写（实测本仓库
 *       wayfinder:grilling 在 GitHub 上存的就是 9D7CD8）。
 *   三、**失败落哪一档**：八档逐条演一遍。最要紧的两条是 404 与退出码 4 ——
 *       「标签不存在 / 仓库不存在 / 没有写权限」在 gh 的错误里是同一句 HTTP 404，所以撞到 404 必须
 *       自己再问一次仓库权限（`gh repo view --json viewerPermission`）才下结论；「没登录」是退出码 4，
 *       只认退出码、不靠文案里出现某个词。
 *   四、**逐条记账**：一条改动恰好记一次账、中途失败不回滚、整批的形状坏掉才整条失败。
 *
 * 怎么装的：用假数据装配**真实**的 GitHub 后端模块（githubModule.create），走它真实的那两条操作；
 * 假的只有外部世界（一个脚本化的 gh：按参数回答，并把它收到的每一次调用都记下来给上面四条取证）。
 *
 * 自证能真红：把实现里「撞到 404 要问权限」那一行去掉 → 本门禁第 23 条立刻红（记录见
 * .scratch/map610/reports/issue-620.md）。
 */

import nodePath from 'node:path'
import { githubModule } from '../src/host/tracker/backends/github/index.js'
import { ghClient } from '../src/host/tracker/backends/github/client.js'
import { labelListCheck, labelBatchCheck, labelCompletenessCheck } from './tracker-contract/sections/labels.js'

let pass = 0
let fail = 0
const check = (cond, msg) => { if (!cond) { fail += 1; console.error('FAIL  ' + msg) } else { pass += 1; console.log('PASS  ' + msg) } }

const WS = '/ws/gate'
const REF = { backend: 'github', refId: 'acme/demo', name: 'demo', url: '' }
const GH_EXEC_FIELDS = ['argv0', 'cwdHash', 'latencyMs', 'kind', 'exitCode']

/** 从参数数组里读 `--flag value` 这种写法（不拼字符串再正则，标签名里可能有空格与冒号）。 */
function flagsOf(args) {
  const out = {}
  for (let i = 0; i < args.length; i++) if (typeof args[i] === 'string' && args[i].startsWith('--')) out[args[i]] = args[i + 1]
  return out
}

/** 脚本化的 gh：像一个只有三条标签的小仓库那样回答，并把每一次调用都记下来。 */
function makeGh(opts) {
  const o = opts || {}
  const calls = []
  const events = []
  const labels = (o.labels || []).map((l) => ({ name: l.name, color: String(l.color == null ? '' : l.color), description: l.description === undefined ? '' : l.description }))
  const state = { inFlight: 0, maxInFlight: 0 }
  const ctx = {
    cwd: WS,
    platform: o.noGh === true
      ? { resolveExecutable: async () => null, env: { get: () => '' } }
      : { resolveExecutable: async (n) => (n === 'gh' || n === 'git' ? n : null), env: { get: () => '' } },
    exec: async (cmd, args) => {
      const list = Array.isArray(args) ? args.slice() : []
      const f = flagsOf(list)
      calls.push({ cmd: cmd, args: list, flags: f })
      state.inFlight += 1
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
      try {
        if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs))
        if (o.throws) throw Object.assign(new Error(o.throws), { code: o.throwsCode || 'ENOTFOUND' })
        // git remote get-url origin（后端解析仓库标识时第一层就走它）
        if (list[0] === 'git' && list.includes('remote')) {
          if (o.noRemote) return { code: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git' }
          return { code: 0, stdout: String(o.remoteUrl || 'https://github.com/acme/demo.git') + '\n', stderr: '' }
        }
        // gh label list --repo X --json name,color,description --limit N
        if (list[0] === 'label' && list[1] === 'list') {
          if (o.listFails) return { code: o.listFailsCode || 1, stdout: '', stderr: o.listFails }
          if (o.listRaw !== undefined) return { code: 0, stdout: o.listRaw, stderr: '' }
          if (o.listExactLimit) {
            // 真 GitHub 就是这样：一次最多回那么多条，回满了也看不出后面还有没有
            const n = Number(f['--limit'] || 0)
            const arr = []
            for (let i = 0; i < n; i++) arr.push({ name: 'label-' + String(i + 1).padStart(4, '0'), color: '0e8a16', description: '' })
            return { code: 0, stdout: JSON.stringify(arr), stderr: '' }
          }
          if (o.listOmitLimit) return { code: 0, stdout: JSON.stringify(labels.slice(0, 30)), stderr: '' }
          return { code: 0, stdout: JSON.stringify(labels), stderr: '' }
        }
        // gh label edit <名字> --repo X --color C
        if (list[0] === 'label' && list[1] === 'edit') {
          const name = list[2]
          if (o.editFails) return { code: o.editFailsCode || 1, stdout: '', stderr: o.editFails }
          if (o.editFailByName && o.editFailByName[name]) return { code: o.editFailByName[name].code || 1, stdout: '', stderr: o.editFailByName[name].stderr }
          // 「命令没跑完、连退出码都没有」：执行器原样回传底层进程的退出码，被信号杀掉的进程就是没有
          if (o.editNoCode) return { stdout: '', stderr: '' }
          const hit = labels.find((l) => l.name.toLowerCase() === String(name || '').toLowerCase())
          if (o.viewerPermission === 'READ' || o.viewerPermission === 'NONE') return { code: 1, stdout: '', stderr: 'HTTP 404: Not Found (https://api.github.com/repos/acme/demo/labels/' + name + ')' }
          if (!hit) return { code: 1, stdout: '', stderr: 'HTTP 404: Not Found (https://api.github.com/repos/acme/demo/labels/' + name + ')' }
          hit.color = String(f['--color'] || '')
          return { code: 0, stdout: '', stderr: '' }
        }
        // gh repo view X --json viewerPermission / --json nameWithOwner
        if (list[0] === 'repo' && list[1] === 'view') {
          if (o.viewFails) return { code: 1, stdout: '', stderr: o.viewFails }
          if (String(f['--json'] || '').includes('nameWithOwner')) return { code: 0, stdout: 'acme/demo\n', stderr: '' }
          return { code: 0, stdout: JSON.stringify({ viewerPermission: o.viewerPermission || 'ADMIN' }), stderr: '' }
        }
        return { code: 1, stdout: '', stderr: '门禁的假 gh 没脚本化这条命令: ' + list.join(' ') }
      } finally {
        state.inFlight -= 1
      }
    },
    logEvent: (level, event, fields) => events.push({ level: level, event: event, fields: fields }),
    isEnabled: (level) => (o.info === true ? level === 'info' : level === 'debug'),
  }
  return { ctx: ctx, calls: calls, events: events, labels: labels, state: state }
}

const tracker = githubModule.create({})
const edits = (gh) => gh.calls.filter((c) => c.args[0] === 'label' && c.args[1] === 'edit')
const lists = (gh) => gh.calls.filter((c) => c.args[0] === 'label' && c.args[1] === 'list')
const views = (gh) => gh.calls.filter((c) => c.args[0] === 'repo' && c.args[1] === 'view')
const reasonOf = (res, name) => {
  const f = (res && res.ok === true && Array.isArray(res.data.failed)) ? res.data.failed.find((x) => x.name === name) : null
  return f ? f.reason : null
}

const SEED = [
  { name: 'bug', color: 'D73A4A', description: "Something isn't working" },   // GitHub 上存的是大写
  { name: 'wayfinder:grilling', color: '9D7CD8', description: 'Open decision/discussion ticket' },
  { name: '带 空格 与:冒号', color: '1F6FEB', description: '' },               // 没描述：这条要给不了就省略
]

// ── 一、列标签：调用了什么、颜色怎么归一、拿不全怎么办 ─────────────────────────
{
  const gh = makeGh({ labels: SEED })
  const r = await tracker.listLabels(REF, gh.ctx)
  const l = lists(gh)[0]
  check(lists(gh).length === 1, '列标签只调一次 gh label list（实得 ' + lists(gh).length + ' 次）')
  check(!!l && l.flags['--repo'] === 'acme/demo', '列标签指名仓库（实得 ' + JSON.stringify(l && l.flags['--repo']) + '）')
  check(!!l && l.flags['--json'] === 'name,color,description', '列标签只要三个字段 name,color,description（实得 ' + JSON.stringify(l && l.flags['--json']) + '）')
  const lim = l ? Number(l.flags['--limit']) : NaN
  check(Number.isInteger(lim) && lim >= 100, '列标签传了分页参数 --limit 且远大于 gh 的默认 30（实得 ' + JSON.stringify(l && l.flags['--limit']) + '）——不传就会静默少一截')
  check(r.ok === true && labelListCheck(r.data).length === 0, '列标签的返回过契约的列表形状检查器（' + (r.ok === true ? labelListCheck(r.data).join('；') : JSON.stringify(r)) + '）')
  const byName = (n) => (r.ok === true ? r.data.find((x) => x.name === n) : null) || {}
  check(byName('bug').color === 'd73a4a', 'GitHub 上存的大写色值读回来转成六位小写（实得 ' + JSON.stringify(byName('bug').color) + '）')
  check(byName('wayfinder:grilling').color === '9d7cd8', '大小写与冒号同时存在时照样转小写（实得 ' + JSON.stringify(byName('wayfinder:grilling').color) + '）')
  check(!('description' in byName('带 空格 与:冒号')), '给不了的描述整个键省掉（不许留一个空串或 undefined）')
  check(byName('带 空格 与:冒号').name === '带 空格 与:冒号', '名字里的空格与冒号原样返回，不做大小写折叠')
  check(r.ok === true && labelCompletenessCheck(r.data, SEED.map((x) => x.name)).length === 0, '清单是全仓库全量（含还没被任何票用到的）')

  // 取不全：gh 一次回满 --limit 条，看不出后面还有没有 → 必须整条失败，不许把残缺清单当全量发出去
  const many = makeGh({ listExactLimit: true })
  const rMany = await tracker.listLabels(REF, many.ctx)
  check(rMany.ok === false, '标签数到上限时整条失败（不许退回残缺清单），实得 ok=' + JSON.stringify(rMany.ok))
  check(rMany.ok === false && (rMany.error.kind === 'env' || rMany.error.kind === 'network'), '取不全落环境档或网络档（实得 ' + JSON.stringify(rMany.ok === false ? rMany.error.kind : '') + '）')
  check(rMany.ok === false && String(rMany.error.message).includes('没能拿全标签'), '取不全的文案说清「没能拿全标签」（实得 ' + JSON.stringify(rMany.ok === false ? rMany.error.message : '') + '）')
  // 反面：这一条要是实现只回前 30 条、还报成功，完整性检查器必须逮住它
  const truncated = makeGh({ listOmitLimit: true })
  const rCut = await tracker.listLabels(REF, truncated.ctx)
  const caught = rCut.ok !== true || labelCompletenessCheck(rCut.data, SEED.map((x) => x.name)).length > 0
  check(caught, '✗ probe: 只回前 30 条又不报失败的那种实现会被逮住（残缺清单不许过关）')
}

// ── 二、改色：只发改颜色那一条命令，颜色先归一 ───────────────────────────────
{
  const gh = makeGh({ labels: SEED })
  const r = await tracker.setLabelColors(REF, [{ name: 'bug', color: '0b7285' }], gh.ctx)
  const e = edits(gh)[0]
  check(edits(gh).length === 1, '一条改动只发一条 gh label edit（实得 ' + edits(gh).length + ' 条）')
  check(!!e && e.args.length === 7 && e.args[0] === 'label' && e.args[1] === 'edit' && e.args[2] === 'bug' && e.args[3] === '--repo' && e.args[4] === 'acme/demo' && e.args[5] === '--color' && e.args[6] === '0b7285',
    '改色的命令恰好是 `label edit <名字> --repo <仓库> --color <颜色>`，一个多余的参数都没有（实得 ' + JSON.stringify(e && e.args) + '）')
  check(!!e && e.flags['--name'] === undefined && e.flags['--description'] === undefined, '不带 --name、不带 --description（本票只改颜色，不改名不改描述）')
  check(r.ok === true && labelBatchCheck([{ name: 'bug', color: '0b7285' }], r.data).length === 0, '改色的返回过契约的逐条记账检查器（' + (r.ok === true ? labelBatchCheck([{ name: 'bug', color: '0b7285' }], r.data).join('；') : JSON.stringify(r)) + '）')
  check(r.ok === true && r.data.applied.length === 1 && r.data.applied[0].color === '0b7285', 'applied 里给的是这次写下去的目标颜色（契约口径：不是回读值；实得 ' + JSON.stringify(r.ok === true ? r.data.applied : r) + '）')
  check(gh.labels.find((x) => x.name === 'bug').color === '0b7285', '假仓库里的颜色真的变了（保存后按真值刷新拿得到新色）')
  const kinds = gh.calls.map((c) => c.args[0] + ' ' + c.args[1])
  check(kinds.every((k) => k === 'label list' || k === 'label edit' || k === 'repo view'), '全程只出现「列标签 / 改颜色 / 问仓库权限」三种命令，没有建标签、删标签、改名（实得 ' + JSON.stringify(kinds) + '）')

  // 带井号与大写：先归一，再发出去
  const gh2 = makeGh({ labels: SEED })
  const r2 = await tracker.setLabelColors(REF, [{ name: 'bug', color: '#0B7285' }], gh2.ctx)
  const e2 = edits(gh2)[0]
  check(!!e2 && e2.flags['--color'] === '0b7285', '带井号大写的入参先归一再发（实得 ' + JSON.stringify(e2 && e2.flags['--color']) + '）')
  check(r2.ok === true && r2.data.applied.length === 1 && r2.data.applied[0].color === '0b7285', '归一后的颜色记进 applied（实得 ' + JSON.stringify(r2.ok === true ? r2.data.applied : r2) + '）')
}

// ── 三、逐条记账：部分成功、中途失败不回滚、整批形状坏掉才整体失败 ─────────────
{
  const gh = makeGh({ labels: SEED, viewerPermission: 'ADMIN' })
  const changes = [
    { name: 'bug', color: '0b7285' },          // 改得成
    { name: '新配色写错了', color: '12345' },   // 颜色不合法 → 解析档，不发命令
    { name: '不存在的标签', color: 'abcdef' },  // 仓库里没有 → 找不到档（404 + 有写权限）
    { name: 'wayfinder:grilling', color: 'ff00ff' }, // 改得成
  ]
  const r = await tracker.setLabelColors(REF, changes, gh.ctx)
  check(r.ok === true && labelBatchCheck(changes, r.data).length === 0, '四条改动逐条记账全过（' + (r.ok === true ? labelBatchCheck(changes, r.data).join('；') : JSON.stringify(r)) + '）')
  check(r.ok === true && r.data.applied.length === 2 && r.data.failed.length === 2, '部分成功如实回报（实得 applied=' + (r.ok === true ? r.data.applied.length : '?') + '、failed=' + (r.ok === true ? r.data.failed.length : '?') + '）')
  check(r.ok === true && reasonOf(r, '新配色写错了').kind === 'parse', '颜色写错落解析档（实得 ' + JSON.stringify(r.ok === true ? reasonOf(r, '新配色写错了').kind : '') + '）')
  check(r.ok === true && reasonOf(r, '不存在的标签').kind === 'not-found', '标签不存在落找不到档（实得 ' + JSON.stringify(r.ok === true ? reasonOf(r, '不存在的标签').kind : '') + '）')
  check(r.ok === true && r.data.failed.every((f) => Object.keys(f.reason).sort().join(',') === 'kind,message'), '每条失败的 reason 只有 kind 与 message 两个键（复用既有错误形状，不新增字段）')
  check(edits(gh).length === 3 && edits(gh).every((e) => e.args[2] !== '新配色写错了'), '颜色写错的那条根本没发命令（四条改动只发了三条，实得 ' + edits(gh).length + ' 条）')

  // 中途失败不回滚：第二条失败，后面的照改
  const gh2 = makeGh({ labels: SEED, editFailByName: { 'wayfinder:grilling': { code: 1, stderr: 'HTTP 500: Internal Server Error' } } })
  const many = [
    { name: 'bug', color: '111111' },
    { name: 'wayfinder:grilling', color: '222222' },
    { name: '带 空格 与:冒号', color: '333333' },
    { name: '还没建的标签', color: '444444' },
  ]
  const r2 = await tracker.setLabelColors(REF, many, gh2.ctx)
  check(edits(gh2).length === 4, '五条改动里前四条都发了命令（中途失败不停下，实得 ' + edits(gh2).length + ' 条）')
  check(r2.ok === true && r2.data.applied.length === 2 && r2.data.failed.length === 2, '失败的那两条如实记进 failed，成功的那两条照记 applied（实得 ' + JSON.stringify(r2.ok === true ? { a: r2.data.applied.length, f: r2.data.failed.length } : r2) + '）')
  check(r2.ok === true && gh2.labels.find((x) => x.name === '带 空格 与:冒号').color === '333333', '失败之后没轮到的标签真的改到了（不回滚、不跳过）')

  // 空批次与整批形状
  const gh3 = makeGh({ labels: SEED })
  const rEmpty = await tracker.setLabelColors(REF, [], gh3.ctx)
  check(rEmpty.ok === true && Array.isArray(rEmpty.data.applied) && rEmpty.data.applied.length === 0 && Array.isArray(rEmpty.data.failed) && rEmpty.data.failed.length === 0, '空批次回两个空数组（不许省略 applied/failed）')
  const rBad = await tracker.setLabelColors(REF, { bug: '0b7285' }, gh3.ctx)
  check(rBad.ok === false && rBad.error.kind === 'parse', '入参不是一批改动 → 整条失败落解析档（实得 ' + JSON.stringify(rBad.ok === false ? rBad.error : rBad) + '）')
  const rDup = await tracker.setLabelColors(REF, [{ name: 'bug', color: '111111' }, { name: 'bug', color: '222222' }], gh3.ctx)
  check(rDup.ok === false && rDup.error.kind === 'parse', '同一标签一批里出现两次 → 整条失败落解析档（实得 ' + JSON.stringify(rDup.ok === false ? rDup.error : rDup) + '）')
  check(edits(gh3).length === 0, '入参坏掉的两次一条命令都没发（实得 ' + edits(gh3).length + ' 条）')
}

// ── 四、错误分档：八档逐条演 ────────────────────────────────────────────────
{
  const one = (name) => [{ name: name || 'bug', color: '0b7285' }]

  // ① 没登录：gh 的退出码是 4（gh help exit-codes），只认退出码
  const noLogin = makeGh({ labels: SEED, editFails: 'To get started with GitHub CLI, please run:  gh auth login', editFailsCode: 4 })
  const r1 = await tracker.setLabelColors(REF, one(), noLogin.ctx)
  const k1 = r1.ok === true ? reasonOf(r1, 'bug').kind : null
  check(k1 === 'auth', '没登录（退出码 4）落鉴权档（实得 ' + JSON.stringify(k1) + '）')
  check(r1.ok === true && String(reasonOf(r1, 'bug').message).includes('gh auth login'), '没登录的文案告诉用户去做什么（实得 ' + JSON.stringify(r1.ok === true ? reasonOf(r1, 'bug').message : '') + '）')

  // 退出码修复的直证：client 回来的错误对象里必须带着退出码（不然上一条只能靠文案巧合）
  const c = ghClient({
    cwd: WS,
    platform: { resolveExecutable: async () => 'gh', env: { get: () => '' } },
    exec: async () => ({ code: 4, stdout: '', stderr: 'please run gh auth login' }),
    logEvent: () => {}, isEnabled: () => false,
  })
  const rExec = await c.execGh(['label', 'edit', 'bug', '--repo', 'acme/demo', '--color', '000000'])
  check(rExec.ok === false && rExec.error.code === 4, 'gh 调用的错误对象带着退出码（#620 修掉的那处：以前只有 kind 与 message，实得 ' + JSON.stringify(rExec.ok === false ? rExec.error : rExec) + '）')

  // ② 凭据失效
  const bad401 = makeGh({ labels: SEED, editFails: 'HTTP 401: Bad credentials (https://api.github.com/repos/acme/demo/labels/bug)' })
  const r2 = await tracker.setLabelColors(REF, one(), bad401.ctx)
  check(r2.ok === true && reasonOf(r2, 'bug').kind === 'auth', '凭据失效（HTTP 401 Bad credentials）落鉴权档（实得 ' + JSON.stringify(r2.ok === true ? reasonOf(r2, 'bug').kind : '') + '）')

  // ③ 颜色被 API 拒（422）：不许落成「网络错误」
  const bad422 = makeGh({ labels: SEED, editFails: 'HTTP 422: Validation Failed (https://api.github.com/repos/acme/demo/labels/bug)\nLabel.color is invalid' })
  const r3 = await tracker.setLabelColors(REF, one('bug'), bad422.ctx)
  check(r3.ok === true && reasonOf(r3, 'bug').kind === 'parse', '颜色被 API 拒（HTTP 422）落解析档，不是网络档（实得 ' + JSON.stringify(r3.ok === true ? reasonOf(r3, 'bug').kind : '') + '）')

  // ④ 404 + 仓库权限只有读 → 没有写权限（鉴权档），并且确实多发了一次问权限的命令
  const noWrite = makeGh({ labels: SEED, viewerPermission: 'READ' })
  const r4 = await tracker.setLabelColors(REF, one(), noWrite.ctx)
  check(r4.ok === true && reasonOf(r4, 'bug').kind === 'auth', '404 且仓库权限只有读 → 没有写权限，落鉴权档（实得 ' + JSON.stringify(r4.ok === true ? reasonOf(r4, 'bug').kind : '') + '）')
  check(views(noWrite).length === 1 && views(noWrite)[0].flags['--json'] === 'viewerPermission', '撞到 404 时多发一次 `gh repo view --json viewerPermission` 才下结论（实得 ' + JSON.stringify(views(noWrite).map((v) => v.args)) + '）')

  // ⑤ 404 + 有写权限 → 标签或仓库真的不存在（找不到档）
  const okWrite = makeGh({ labels: SEED, viewerPermission: 'ADMIN' })
  const r5 = await tracker.setLabelColors(REF, one('没有这个标签'), okWrite.ctx)
  check(r5.ok === true && reasonOf(r5, '没有这个标签').kind === 'not-found', '404 且自己有写权限 → 标签不存在，落找不到档（实得 ' + JSON.stringify(r5.ok === true ? reasonOf(r5, '没有这个标签').kind : '') + '）')
  check(r5.ok === true && String(reasonOf(r5, '没有这个标签').message).includes('没有这个标签'), '找不到档的文案点名是哪个标签（实得 ' + JSON.stringify(r5.ok === true ? reasonOf(r5, '没有这个标签').message : '') + '）')

  // ⑥ 404 + 权限问不出来 → 如实说分不清，不瞎猜成权限不足
  const cantAsk = makeGh({ labels: SEED, viewFails: 'HTTP 401: Bad credentials' })
  const r6 = await tracker.setLabelColors(REF, one('不知道是哪种'), cantAsk.ctx)
  const m6 = r6.ok === true ? String(reasonOf(r6, '不知道是哪种').message) : ''
  check(r6.ok === true && reasonOf(r6, '不知道是哪种').kind === 'not-found' && m6.includes('没能问出'), '权限问不出来时如实说「没能问出你在哪个仓库上的权限」，不瞎猜成权限不足（实得 ' + JSON.stringify(reasonOf(r6, '不知道是哪种')) + '）')

  // ⑦ 次限速（官方文档：403/429 都可能，文案里带 secondary rate limit）
  const limited = makeGh({ labels: SEED, editFails: 'HTTP 403: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (https://api.github.com/repos/acme/demo/labels/bug)' })
  const r7 = await tracker.setLabelColors(REF, one(), limited.ctx)
  check(r7.ok === true && reasonOf(r7, 'bug').kind === 'rate-limit', '被限速落限速档（实得 ' + JSON.stringify(r7.ok === true ? reasonOf(r7, 'bug').kind : '') + '）')

  // ⑧ 连不通
  const offline = makeGh({ labels: SEED, throws: 'dial tcp: lookup api.github.com: no such host' })
  const r8 = await tracker.setLabelColors(REF, one(), offline.ctx)
  check(r8.ok === true && reasonOf(r8, 'bug').kind === 'network', '连不通落网络档（实得 ' + JSON.stringify(r8.ok === true ? reasonOf(r8, 'bug').kind : '') + '）')

  // ⑨ 本机没有 gh：环境档，不许说成「标签不存在」（它那句错误文案里也有 not found）
  const noGh = makeGh({ labels: SEED, noGh: true })
  const r9 = await tracker.setLabelColors(REF, one(), noGh.ctx)
  check(r9.ok === true && reasonOf(r9, 'bug').kind === 'env', '本机没有 gh → 环境档，不许误判成「标签不存在」（实得 ' + JSON.stringify(r9.ok === true ? reasonOf(r9, 'bug').kind : '') + '）')
  check(r9.ok === true && String(reasonOf(r9, 'bug').message).includes('插件这边的问题'), '环境档的文案说清责任在插件这边（实得 ' + JSON.stringify(r9.ok === true ? reasonOf(r9, 'bug').message : '') + '）')

  // 列标签这一路的分档：连不通时要说清「没能拿全标签」，没登录时要说清去登录
  const listOffline = makeGh({ labels: SEED, listFails: 'could not resolve host: api.github.com' })
  const rl1 = await tracker.listLabels(REF, listOffline.ctx)
  check(rl1.ok === false && rl1.error.kind === 'network' && String(rl1.error.message).includes('没能拿全标签'), '列标签连不通 → 网络档且说清「没能拿全标签」（实得 ' + JSON.stringify(rl1) + '）')
  const listNoLogin = makeGh({ labels: SEED, listFails: 'please run gh auth login', listFailsCode: 4 })
  const rl2 = await tracker.listLabels(REF, listNoLogin.ctx)
  check(rl2.ok === false && rl2.error.kind === 'auth', '列标签没登录 → 鉴权档（实得 ' + JSON.stringify(rl2.ok === false ? rl2.error.kind : rl2) + '）')
}

// ── 五、并发：默认串行，最多 4 路 ───────────────────────────────────────────
{
  const six = []
  for (let i = 1; i <= 6; i++) six.push({ name: 'label-' + i, color: '11111' + i })
  const repo = six.map((c) => ({ name: c.name, color: '000000', description: '' }))
  const serial = makeGh({ labels: repo, delayMs: 2 })
  const rSerial = await tracker.setLabelColors(REF, six, serial.ctx)
  check(rSerial.ok === true && rSerial.data.applied.length === 6, '六条改动逐条都改了（实得 ' + JSON.stringify(rSerial.ok === true ? rSerial.data.applied.length : rSerial) + '）')
  check(serial.state.maxInFlight === 1, '默认逐条串行（同时最多 1 个 gh 进程，实得 ' + serial.state.maxInFlight + '）')
  const capped = makeGh({ labels: repo, delayMs: 2 })
  const ctxCapped = Object.assign({}, capped.ctx, { labelColorConcurrency: 99 })
  await tracker.setLabelColors(REF, six, ctxCapped)
  check(capped.state.maxInFlight === 4, '要 99 路也只并发 4 路（实得 ' + capped.state.maxInFlight + '）')
}

// ── 六、日志点：新的 gh 调用走既有的常驻 gh.exec，字段只取白名单 ───────────────
{
  const gh = makeGh({ labels: SEED, info: true })
  await tracker.listLabels(REF, gh.ctx)
  await tracker.setLabelColors(REF, [{ name: 'bug', color: '0b7285' }], gh.ctx)
  const execs = gh.events.filter((e) => e.event === 'gh.exec')
  check(execs.length === 2, '每次 gh 调用记一条常驻 gh.exec（实得 ' + execs.length + ' 条）')
  check(execs.every((e) => e.level === 'info'), 'gh.exec 是信息级（常驻名单里那一条）')
  check(execs.every((e) => Object.keys(e.fields).every((k) => GH_EXEC_FIELDS.includes(k))), 'gh.exec 的字段只取白名单里那五个（实得 ' + JSON.stringify(execs.map((e) => Object.keys(e.fields))) + '）')
  check(execs.every((e) => !String(e.fields.cwdHash || '').includes('/')), '日志里工作区只记短指纹，不记路径原文')

  const dark = makeGh({ labels: SEED, info: false })
  await tracker.listLabels(REF, dark.ctx)
  check(dark.events.filter((e) => e.event === 'gh.exec').length === 0, '信息级开关关着时不记（外层先判开关，关闭时不组装字段）')
}

// ── 七、整改补的四条：拿不到退出码、重名归一化、逐条兜底、两类误判（#620 整改 D2/D4/D5/D6）──
{
  // D2：执行器没给退出码（被信号杀掉、或命令根本没起来）时，不许当成 0 记成「改成功」
  const noCode = makeGh({ labels: SEED, editNoCode: true })
  const rNoCode = await tracker.setLabelColors(REF, [{ name: 'bug', color: '0b7285' }], noCode.ctx)
  check(rNoCode.ok === true && rNoCode.data.applied.length === 0 && rNoCode.data.failed.length === 1, '拿不到退出码 → 记成失败，不许记成成功（实得 ' + JSON.stringify(rNoCode.ok === true ? { a: rNoCode.data.applied, f: rNoCode.data.failed.length } : rNoCode) + '）')
  const whyNoCode = rNoCode.ok === true ? reasonOf(rNoCode, 'bug') : null
  check(!!whyNoCode && whyNoCode.kind === 'env' && String(whyNoCode.message).includes('插件这边的问题'), '拿不到退出码时落环境档并说清责任在插件这边（实得 ' + JSON.stringify(whyNoCode) + '）')
  check(gh0NoCode(noCode), '拿不到退出码那次确实发过命令、也确实没改到东西（假仓库里 bug 还是老色）')
  function gh0NoCode(gh) { return edits(gh).length === 1 && gh.labels.find((x) => x.name === 'bug').color === 'D73A4A' }

  // D4：重名按归一化后的名字判（大小写、首尾空格都算同一个标签），不许对同一个标签发两次命令
  const dupGh = makeGh({ labels: SEED })
  const rCase = await tracker.setLabelColors(REF, [{ name: 'bug', color: '111111' }, { name: 'BUG', color: '222222' }], dupGh.ctx)
  check(rCase.ok === false && rCase.error.kind === 'parse', '同一批里「bug」与「BUG」→ 整条失败落解析档（实得 ' + JSON.stringify(rCase.ok === false ? rCase.error : rCase) + '）')
  const rSpace = await tracker.setLabelColors(REF, [{ name: 'bug', color: '111111' }, { name: ' bug ', color: '222222' }], dupGh.ctx)
  check(rSpace.ok === false && rSpace.error.kind === 'parse', '同一批里「bug」与「 bug 」→ 整条失败落解析档（实得 ' + JSON.stringify(rSpace.ok === false ? rSpace.error : rSpace) + '）')
  check(edits(dupGh).length === 0, '重名的两次一条命令都没发（实得 ' + edits(dupGh).length + ' 条）')

  // D5：某一条上冒出意外异常时，只把这一条记成失败，其余照跑、账不丢
  const boom = makeGh({ labels: SEED })
  let cwdReads = 0
  Object.defineProperty(boom.ctx, 'cwd', {
    get() {
      cwdReads += 1
      // 第 1 次读照常（第一条改动正常发命令），之后每次读都抛：模拟某一条上冒出的意外异常
      if (cwdReads >= 2) throw new Error('门禁故意抛的意外异常')
      return WS
    },
    configurable: true,
  })
  const three = [{ name: 'bug', color: '111111' }, { name: 'wayfinder:grilling', color: '222222' }, { name: '带 空格 与:冒号', color: '333333' }]
  const rBoom = await tracker.setLabelColors(REF, three, boom.ctx)
  check(rBoom.ok === true && labelBatchCheck(three, rBoom.data).length === 0, '某一条抛意外异常时逐条记账仍然成立（' + (rBoom.ok === true ? labelBatchCheck(three, rBoom.data).join('；') : JSON.stringify(rBoom)) + '）')
  check(rBoom.ok === true && rBoom.data.applied.length === 1 && rBoom.data.failed.length === 2, '已经改好的那条照样记进 applied，抛异常的两条记进 failed（实得 ' + JSON.stringify(rBoom.ok === true ? { a: rBoom.data.applied.length, f: rBoom.data.failed.length } : rBoom) + '）')
  const boomReason = rBoom.ok === true ? (rBoom.data.failed[0] || {}).reason : null
  check(!!boomReason && boomReason.kind === 'env' && String(boomReason.message).includes('插件这边的问题'), '意外异常落环境档并说清责任在插件这边（实得 ' + JSON.stringify(boomReason) + '）')

  // D6：两类误判（用真机上实测的报错原文）
  const realRepoMissing = 'GraphQL: Could not resolve to a Repository with the name \'FeatherHunter/no-such-repo-xyz\'. (repository)'
  const ghRepoMissing = makeGh({ labels: SEED, editFails: realRepoMissing })
  const rRepo = await tracker.setLabelColors(REF, [{ name: 'bug', color: '0b7285' }], ghRepoMissing.ctx)
  check(rRepo.ok === true && reasonOf(rRepo, 'bug').kind === 'not-found', '仓库不存在（实测原文 "Could not resolve to a Repository"）落找不到档，不许说成「连不上」（实得 ' + JSON.stringify(rRepo.ok === true ? reasonOf(rRepo, 'bug').kind : rRepo) + '）')
  const realDns = 'Get "https://api.github.com/repos/acme/demo/labels?limit=1000": dial tcp: lookup api.github.com: getaddrinfo ENOTFOUND api.github.com'
  const ghDns = makeGh({ labels: SEED, editFails: realDns })
  const rDns = await tracker.setLabelColors(REF, [{ name: 'bug', color: '0b7285' }], ghDns.ctx)
  check(rDns.ok === true && reasonOf(rDns, 'bug').kind === 'network', 'DNS 失败（实测原文 getaddrinfo ENOTFOUND）落网络档，不许说成「标签不存在」（实得 ' + JSON.stringify(rDns.ok === true ? reasonOf(rDns, 'bug').kind : rDns) + '）')
  const ghDnsList = makeGh({ labels: SEED, listFails: realDns })
  const rDnsList = await tracker.listLabels(REF, ghDnsList.ctx)
  check(rDnsList.ok === false && rDnsList.error.kind === 'network' && String(rDnsList.error.message).includes('没能拿全标签'), '列标签时 DNS 失败同样落网络档并说清「没能拿全标签」（实得 ' + JSON.stringify(rDnsList) + '）')
  const ghNoHost = makeGh({ labels: SEED, editFails: 'Get "https://api.github.com/repos/acme/demo/labels": dial tcp: lookup api.github.com on 8.8.8.8:53: no such host' })
  const rNoHost = await tracker.setLabelColors(REF, [{ name: 'bug', color: '0b7285' }], ghNoHost.ctx)
  check(rNoHost.ok === true && reasonOf(rNoHost, 'bug').kind === 'network', 'DNS 失败（no such host 家族）也落网络档（实得 ' + JSON.stringify(rNoHost.ok === true ? reasonOf(rNoHost, 'bug').kind : rNoHost) + '）')
  const ghReal404 = makeGh({ labels: SEED, viewerPermission: 'ADMIN' })
  const r404 = await tracker.setLabelColors(REF, [{ name: '没有这个标签', color: '0b7285' }], ghReal404.ctx)
  check(r404.ok === true && reasonOf(r404, '没有这个标签').kind === 'not-found', '真的 404（HTTP 404 Not Found）仍然落找不到档（别改坏了，实得 ' + JSON.stringify(r404.ok === true ? reasonOf(r404, '没有这个标签').kind : r404) + '）')
}

// ── 八、穿过宿主（#620 整改 D1）：真实电话链路上仓库标识是空的，照样要能认出仓库并真的发命令 ──
// 这一段是这一票最要紧的一条：前面几段都直接调后端模块、自己把 refId 填好，所以照不出
// 「宿主交给后端的仓库标识恒为空」这件事（真实工作区里就是这个样子：注册表只认显式 refId）。
{
  const { createWorkspaceCwd } = await import('../src/host/workspaceCwd.js')
  const { createRegistry } = await import('../src/host/tracker/registryCore.js')
  const HOST_CWD = '/ws/gh-project'
  const gh = makeGh({ labels: SEED })
  const vias = []
  const ctxHost = {
    ctx: { get: () => undefined },
    DEFAULT_CWD: HOST_CWD,
    // 假平台：真实平台有 resolveExecutable（后端解析 gh / git 都靠它），这里照它的形状给一份
    getPlatform: async () => ({ path: nodePath.posix, resolveExecutable: async (n) => (n === 'gh' || n === 'git' ? n : null), env: { get: () => '' }, getHome: async () => '/home/u' }),
    getTrackerRegistry: async () => reg,
    getWorkspaceStore: async () => ({ invalidate: () => {} }),
    canonicalKey: async (c) => c,
    setCache: () => {},
    logCtx: { fire: () => {}, isEnabled: () => false },
    timer: { timeout: (fn, ms) => setTimeout(fn, ms) },
    detectionExec: async (cmd, args, opts, via) => { vias.push({ cmd: cmd, args: args, via: via }); return gh.ctx.exec(cmd, args) },
  }
  const reg = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
  const d = reg.register(githubModule)
  // 绑定后端，但**谁也不给 owner/name** —— 和真实工作区里「用户选定后端」那一步完全一样
  reg.bind({ cwd: HOST_CWD }, 'github')
  const host = createWorkspaceCwd(ctxHost)

  const rl = await host.handleListLabels({ cwd: HOST_CWD })
  check(rl.ok === true && Array.isArray(rl.labels) && labelListCheck(rl.labels).length === 0, '穿过宿主：列标签能拿到仓库并回一份合规清单（实得 ' + JSON.stringify(rl).slice(0, 200) + '）')
  const listCall = lists(gh)[0]
  check(!!listCall && listCall.flags['--repo'] === 'acme/demo', '穿过宿主：仓库标识是空的时候，后端自己解析出 acme/demo 再发命令（实得 --repo ' + JSON.stringify(listCall && listCall.flags['--repo']) + '）')
  check(gh.calls.some((c) => c.cmd === 'git'), '穿过宿主：解析仓库走的是后端的既有三层兜底（这一次是 git remote get-url origin）')

  const rs = await host.handleSetLabelColors({ cwd: HOST_CWD, changes: [{ name: 'bug', color: '0b7285' }] })
  check(rs.ok === true && labelBatchCheck([{ name: 'bug', color: '0b7285' }], { applied: rs.applied, failed: rs.failed }).length === 0, '穿过宿主：批量改色能拿到仓库并逐条记账（实得 ' + JSON.stringify(rs).slice(0, 200) + '）')
  const editCall = edits(gh)[0]
  check(!!editCall && editCall.flags['--repo'] === 'acme/demo' && editCall.flags['--color'] === '0b7285', '穿过宿主：改色命令带着解析出来的仓库与归一后的颜色（实得 ' + JSON.stringify(editCall && editCall.args) + '）')
  check(gh.labels.find((x) => x.name === 'bug').color === '0b7285', '穿过宿主：假仓库里的颜色真的变了（这条电话真的接到了 GitHub 上）')
  check(vias.length >= 3 && vias.every((v) => v.via === 'label-colors'), '穿过宿主：这些外部命令都由标签配色这条链发起（via 是 label-colors）')

  // 反面：工作区里既没有 git 远端、也没法从 gh 问出来 → 如实失败，并说清怎么才能成功
  const noRemoteGh = makeGh({ labels: SEED, noRemote: true })
  const reg2 = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
  const d2 = reg2.register(githubModule)
  reg2.bind({ cwd: '/ws/no-repo' }, 'github')
  const host2 = createWorkspaceCwd(Object.assign({}, ctxHost, {
    getTrackerRegistry: async () => reg2,
    detectionExec: async (cmd, args) => (cmd === 'git' ? noRemoteGh.ctx.exec(cmd, args) : { code: 1, stdout: '', stderr: 'HTTP 404: Not Found (https://api.github.com/repos/acme/demo)' }),
  }))
  const rNoRepo = await host2.handleListLabels({ cwd: '/ws/no-repo' })
  check(rNoRepo.ok === false && rNoRepo.error.kind === 'not-found' && String(rNoRepo.error.message).includes('没能认出'), '认不出仓库时如实失败，并说清先配远端或先选定仓库（实得 ' + JSON.stringify(rNoRepo) + '）')
  d.dispose()
  d2.dispose()
}

console.log('\n' + (fail ? '存在失败 —— GitHub 标签配色两条操作的门禁未通过' : '全部通过 —— GitHub 标签配色两条操作守卫生效（' + pass + ' 项断言）'))
if (fail) process.exit(1)
