// views/versionControl/vcCommit.js — 「这笔提交改了什么」这一层（#818 · 规格故事 32）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回 src/client/index.js
//   的 leaf 标记处（一源两物）。拼接顺序上它排在 vcBlocks 之前；文件行**不另造一套** ——
//   vcBlocks 把那一份 rowViewOf 现传进来，所以「看提交」与「看未提交改动」真的是同一套界面。
//
// 为什么要单开一份：规格要求这两层是同一套界面，但来路不同 —— 未提交那一层是首屏一次读回来的，
//   这一层是按需读的（wf.gitDiff 带 rev），而且有四种「清单是空的」必须分开说，不许混成一句
//   「没有改动」：
//     ① 还在读（loading）→ 说正在读；
//     ② 读不全（宿主回 truncated）→ 说读不全、指去命令行；
//     ③ 合并提交（模型的 parents 多于一条）→ git 默认不展开合并提交改了什么，清单空是正常的；
//     ④ 空提交（parents 正常、清单也空）→ 这笔提交本来就没改文件。
//   四种各是一句平实的话，中英成对（词条在 kernel/locale-panel.js 的 vc.commit.*）。
//
// 变化类型这件事要说清：这一路宿主只回 path / origPath / 增删行数，判不出「新增」与
//   「只加了行的修改」，所以**不冒充六种变化类型**；能证明的只有「重命名」（带了原路径）。
//   拿不准的那一栏就不画字，只给路径与 +a −d，宁可少说一句也不说错一句。
/** 这一层现在开着哪一笔提交（没开就是空串）。 */
export const vcCommitModeOf = function (ui) { return (ui && ui.openCommit) ? String(ui.openCommit) : '' }
/**
 * 这一层要画的那一块（提交行点开之后才画）。参数与 vcBlocksOf 同源：
 *   shownOf(groupKey) 决定这一组先画几行、rowViewOf(row) 是那一份共用的文件行画法。
 */
export const vcCommitBlockOf = function (screen, reads, ui, t, nowMs, shownOf, rowViewOf) {
  const rev = vcCommitModeOf(ui)
  if (!rev) return null
  const entry = (reads && reads.commit) || {}
  const mine = entry.rev === rev ? entry : { state: 'loading', files: [], truncated: false, reason: '', error: null }
  const commits = (screen && Array.isArray(screen.commits)) ? screen.commits : []
  const hit = commits.filter(function (c) { return String(c.oid || '') === rev || String(c.short || '') === rev })[0] || null
  const parents = (hit && Array.isArray(hit.parents)) ? hit.parents.length : 0
  const short = hit ? String(hit.short || vcShortOid(hit.oid)) : rev
  const subject = hit ? String(hit.subject || '') : ''
  const files = (mine.state === 'ok' && mine.truncated !== true && Array.isArray(mine.files)) ? mine.files : []
  const rows = files.map(function (f) {
    return rowViewOf({
      path: String((f && f.path) || ''),
      origPath: (f && f.origPath) ? String(f.origPath) : null,
      staged: false, unstaged: false, conflict: false,
      change: (f && f.origPath) ? 'renamed' : 'modified',
      changeProven: !!(f && f.origPath),
      // 判不出类型的那一行，悬停里如实说清来由（词条 vc.row.typeUnknown）。
      typeTip: (f && f.origPath) ? '' : t('vc.row.typeUnknown'),
      addedLines: (f && f.added !== undefined) ? f.added : null,
      deletedLines: (f && f.deleted !== undefined) ? f.deleted : null,
    })
  })
  let note = ''
  let retry = ''
  if (mine.state === 'loading' && rows.length === 0) note = t('vc.commit.loading')
  else if (mine.state === 'err' && rows.length === 0) { note = t('vc.commit.fail'); retry = t('vc.retry') }
  else if (mine.truncated === true) note = t('vc.commit.truncated')
  else if (mine.state === 'ok' && rows.length === 0) note = parents > 1 ? t('vc.commit.merge') : t('vc.commit.empty')
  const n = shownOf('commit')
  const shown = rows.slice(0, n)
  const moreCount = Math.max(0, rows.length - n)
  return {
    kind: 'changes', key: 'commit', commitMode: true,
    title: t('vc.commit.title'),
    back: t('vc.commit.back'),
    backTip: t('vc.commit.tip'),
    summary: short + (subject ? ' · ' + subject : ''),
    when: hit ? vcWhenText(t, nowMs, hit.commitDateMs !== undefined && hit.commitDateMs !== null ? hit.commitDateMs : hit.authorDateMs) : '',
    note: note,
    retry: retry,
    empty: false,
    emptyText: '',
    groups: rows.length === 0 ? [] : [{
      key: 'commit', title: t('vc.commit.files', { n: String(rows.length) }),
      count: rows.length, rows: shown, moreCount: moreCount,
      moreLabel: t('vc.more', { n: String(moreCount) }),
    }],
  }
}
