// verify-version-control-rules.js — 版本控制核心判定规则门禁（#816 落地）
// 用法：在插件根目录执行 node tests/verify-version-control-rules.js，可独立运行。
//
// 断言文字：只测外部行为——给定一份固定状态，断言判定结果（allow/warn/block + 理由标识符）。
// 四个操作各一条底线：没东西暂存就拦暂存、没暂存就拦提交、脏树与冲突拦拉取、上游没了拦推拉；
// 理由只能是 REASONS 表里的取值。最后带断言装置自检：把规则改坏（永远放行），同一套断言必须判红。
// #819 复审 P2-8 补三条方向：合并/变基进行中推送拦住（推的是动手前那次提交）、落后远端推送拦住
// （推上去会被拒，与拉取同一条边界）、游离头上提交至少提醒（提交完只剩 reflog 能找回来）。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const file = (over = {}) => Object.assign({
  path: 'a.txt', origPath: null, staged: false, unstaged: true,
  change: 'modified', conflict: false, addedLines: 1, deletedLines: 0,
}, over)

const base = (over = {}) => Object.assign({
  identity: {
    worktreeDisplay: 'repo', worktreePath: 'D:/repo', branch: 'main', detached: false,
    oid: 'a'.repeat(40), sync: 'tracked-known', ahead: 0, behind: 0, basisMs: 1000,
  },
  staged: [], unstaged: [file()], stagedCount: 0, unstagedCount: 1, conflictCount: 0,
  otherWorktrees: [], branches: [], commits: [],
  repo: {
    merging: false, rebasing: false, cherryPicking: false, reverting: false,
    hasCommits: true, bare: false, tier: 'full', autocrlf: 'false',
  },
}, over)

function scenarios(judge) {
  return [
    {
      id: '暂存：有未暂存改动放行',
      run: () => judge(base(), 'stage').verdict === 'allow',
    },
    {
      id: '暂存：无事可做拦住（nothing-to-stage）',
      run: () => { const r = judge(base({ unstaged: [], unstagedCount: 0 }), 'stage'); return r.verdict === 'block' && r.reasons.includes('nothing-to-stage') },
    },
    {
      id: '提交：有暂存放行',
      run: () => judge(base({ staged: [file({ staged: true, unstaged: false })], stagedCount: 1 }), 'commit').verdict === 'allow',
    },
    {
      id: '提交：冲突未解决拦住',
      run: () => { const r = judge(base({ staged: [file({ staged: true })], stagedCount: 1, conflictCount: 1 }), 'commit'); return r.verdict === 'block' && r.reasons.includes('conflicts-unresolved') },
    },
    {
      id: '提交：无暂存拦住（nothing-staged）',
      run: () => { const r = judge(base(), 'commit'); return r.verdict === 'block' && r.reasons.includes('nothing-staged') },
    },
    {
      id: '拉取：干净有上游放行',
      run: () => judge(base({ unstaged: [], unstagedCount: 0 }), 'pull').verdict === 'allow',
    },
    {
      id: '拉取：脏树动手前停住（dirty-tree）',
      run: () => { const r = judge(base(), 'pull'); return r.verdict === 'block' && r.reasons.includes('dirty-tree') },
    },
    {
      id: '拉取：无上游拦住',
      run: () => { const s = base({ unstaged: [], unstagedCount: 0 }); s.identity.sync = 'no-upstream'; const r = judge(s, 'pull'); return r.verdict === 'block' && r.reasons.includes('no-upstream') },
    },
    {
      id: '拉取：上游被删拦住（upstream-gone）',
      run: () => { const s = base({ unstaged: [], unstagedCount: 0 }); s.identity.sync = 'upstream-gone'; const r = judge(s, 'pull'); return r.verdict === 'block' && r.reasons.includes('upstream-gone') },
    },
    {
      id: '拉取：游离头指针拦住',
      run: () => { const s = base({ unstaged: [], unstagedCount: 0 }); s.identity.detached = true; s.identity.sync = 'detached'; const r = judge(s, 'pull'); return r.verdict === 'block' && r.reasons.includes('detached-head') },
    },
    {
      id: '推送：落后远端拦住（behind-remote，与拉取同一条边界；推上去会被拒）',
      run: () => { const s = base({ unstaged: [], unstagedCount: 0 }); s.identity.behind = 3; const r = judge(s, 'push'); return r.verdict === 'block' && r.reasons.includes('behind-remote') },
    },
    {
      id: '推送：合并进行中拦住（mid-merge，推的是动手前那次提交）',
      run: () => { const s = base({ unstaged: [], unstagedCount: 0 }); s.repo.merging = true; const r = judge(s, 'push'); return r.verdict === 'block' && r.reasons.includes('mid-merge') },
    },
    {
      id: '推送：变基进行中拦住（mid-rebase）',
      run: () => { const s = base({ unstaged: [], unstagedCount: 0 }); s.repo.rebasing = true; const r = judge(s, 'push'); return r.verdict === 'block' && r.reasons.includes('mid-rebase') },
    },
    {
      id: '提交：游离头指针提醒（detached-head，合法但要找回来只能靠 reflog）',
      run: () => { const s = base({ staged: [file({ staged: true, unstaged: false })], stagedCount: 1 }); s.identity.detached = true; s.identity.sync = 'detached'; const r = judge(s, 'commit'); return r.verdict === 'warn' && r.reasons.includes('detached-head') },
    },
    {
      id: '推送：上游被删拦住',
      run: () => { const s = base(); s.identity.sync = 'upstream-gone'; const r = judge(s, 'push'); return r.verdict === 'block' && r.reasons.includes('upstream-gone') },
    },
    {
      id: '提交：合并进行中提醒（warn，不是 block）',
      run: () => { const s = base({ staged: [file({ staged: true, unstaged: false })], stagedCount: 1 }); s.repo.merging = true; const r = judge(s, 'commit'); return r.verdict === 'warn' && r.reasons.includes('mid-merge') },
    },
    {
      id: '未知操作诚实失败（block + unknown-operation，不抛异常）',
      run: () => { const r = judge(base(), 'rebase'); return r.verdict === 'block' && r.reasons.includes('unknown-operation') },
    },
  ]
}

function failuresOf(judge) {
  const out = []
  for (const s of scenarios(judge)) {
    let ok = false
    try { ok = s.run() === true } catch (e) { ok = false; console.log('    [诊断] ' + s.id + ' 抛异常：' + (e && e.message)) }
    if (!ok) out.push(s.id)
  }
  return out
}

async function main() {
  console.log('版本控制判定规则门禁（#816：四操作底线 + 装置自检）')

  const rules = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'rules.js')).href)
  check(rules.RULES_SOURCE === 'version-control-core/src/rules.ts', '产物带模块标识 RULES_SOURCE')
  check(typeof rules.judge === 'function', '导出单一入口 judge')

  const realFailures = failuresOf(rules.judge)
  check(realFailures.length === 0, '真实规则全部场景通过' + (realFailures.length ? ' —— 没过：' + realFailures.join('；') : '（' + scenarios(rules.judge).length + ' 个场景）'))

  // 理由只能是 REASONS 表里的取值。
  const used = new Set()
  for (const op of ['stage', 'commit', 'pull', 'push']) {
    for (const s of [base(), base({ unstaged: [], unstagedCount: 0 })]) {
      for (const r of rules.judge(s, op).reasons) used.add(r)
    }
  }
  const unknown = Array.from(used).filter((r) => !rules.REASONS[r])
  check(unknown.length === 0, '理由标识符都在 REASONS 表里（实得 ' + used.size + ' 种）' + (unknown.length ? ' —— 表里没有：' + unknown.join('、') : ''))

  // 断言装置自检：永远放行的坏规则必须被逮住。
  const broken = (/* screen, op */) => ({ verdict: 'allow', reasons: ['ok'] })
  const caught = failuresOf(broken)
  check(caught.length > 0, '断言装置自检：永远放行必须判红（被 ' + caught.length + ' 条逮住）')

  // ---- H 组反证（#819 复审 P2-8）：把这三条方向改回旧写法，同一批输入必须当场红 ----
  const midReasonsOf = (s) => { const out = []; if (s.repo.merging) out.push('mid-merge'); if (s.repo.rebasing) out.push('mid-rebase'); if (s.repo.cherryPicking || s.repo.reverting) out.push('mid-cherry-revert'); return out }
  const pushMid = (() => { const s = base({ unstaged: [], unstagedCount: 0 }); s.repo.merging = true; return s })()
  const pushBehind = (() => { const s = base({ unstaged: [], unstagedCount: 0 }); s.identity.behind = 3; return s })()
  const commitDetached = (() => { const s = base({ staged: [file({ staged: true, unstaged: false })], stagedCount: 1 }); s.identity.detached = true; s.identity.sync = 'detached'; return s })()
  const oldJudgePush = (s) => {
    if (s.identity.sync === 'no-upstream') return { verdict: 'block', reasons: ['no-upstream'] }
    if (s.identity.behind > 0) return { verdict: 'warn', reasons: ['behind-remote'] }
    if (s.identity.basisMs === null) return { verdict: 'warn', reasons: ['basis-unknown'] }
    return { verdict: 'allow', reasons: ['ok'] }
  }
  const oldJudgeCommit = (s) => { const mid = midReasonsOf(s); if (mid.length > 0) return { verdict: 'warn', reasons: mid }; return { verdict: 'allow', reasons: ['ok'] } }
  check(oldJudgePush(pushMid).verdict === 'allow', '反证 a：旧方向把「合并进行中推送」判成能继续（实得 ' + oldJudgePush(pushMid).verdict + '），新场景会把它逮住')
  check(oldJudgePush(pushBehind).verdict === 'warn', '反证 b：旧方向把「落后远端推送」只提醒（实得 ' + oldJudgePush(pushBehind).verdict + '），新场景要求拦住')
  check(oldJudgeCommit(commitDetached).verdict === 'allow', '反证 c：旧方向在游离头上提交直接放行（实得 ' + oldJudgeCommit(commitDetached).verdict + '），新场景要求至少提醒')
  check(rules.judge(pushMid, 'push').verdict === 'block' && rules.judge(pushBehind, 'push').verdict === 'block' && rules.judge(commitDetached, 'commit').verdict === 'warn',
    '三条新方向同时成立：合并中推送拦住、落后远端拦住、游离头提交提醒')


  console.log(failed ? '\n存在失败 — verify-version-control-rules 未通过' : '\n全部通过 — 判定规则门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
