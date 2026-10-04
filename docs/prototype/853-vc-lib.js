// 853-vc-lib.js —— 三套风格共用的渲染层（页面用 <script src> 引入；file:// 下也能跑）
// 里面有：风格切换（A/B/C，写 sessionStorage）+ 所有零件函数 + 全部假数据。文案全部抄自产品词条。
/* ---- 风格切换（存到 sessionStorage，回来看还是你选的那套） ---- */
var STYLE_KEY = 'vc-style'
var STYLE_NAME = { A: 'A 工程台账', B: 'B 终端记录', C: 'C 纸质便签' }
function setStyle(s) {
  document.documentElement.dataset.style = s
  try { sessionStorage.setItem(STYLE_KEY, s) } catch (e) {}
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.setAttribute('aria-selected', String(b.dataset.s === s))
  })
  document.querySelector('.v3-style-label').textContent = '当前风格：' + STYLE_NAME[s]
}
document.querySelectorAll('.tabs button').forEach(function (b) {
  b.addEventListener('click', function () { setStyle(b.dataset.s) })
})
var saved = 'A'
try { saved = sessionStorage.getItem(STYLE_KEY) || 'A' } catch (e) {}
setStyle(['A','B','C'].indexOf(saved) >= 0 ? saved : 'A')

/* ---- 零件（只管结构与文案，不带任何风格） ---- */
function head(w, right) {
  return '<div class="v3-shell__head"><span>version-control</span><span class="r">' + (right || (w + 'px')) + '</span></div>'
}
function idline(wt, br, sync) {
  return '<div class="v3-id"><span>' + wt + '</span><span class="sep">/</span><span class="br">' + br + '</span>' +
    (sync ? '<span class="v3-tip" style="margin-left:auto">' + sync + '</span>' : '') + '</div>'
}
function subline(path, readAt) {
  return '<div class="v3-sub"><span>' + path + '</span><span>·</span><span class="num">' + readAt + '</span>' +
    '<a class="v3-link" style="margin-left:auto">重新读一次</a></div>'
}
function row(o) {
  var d = ''
  if (o.add || o.del) {
    d = '<span class="v3-delta">' + (o.add ? '<span class="v3-add">+' + o.add + '</span>' : '') +
      (o.del ? ' <span class="v3-del">\u2212' + o.del + '</span>' : '') + '</span>'
  } else if (o.note) { d = '<span class="v3-delta">' + o.note + '</span>' }
  return '<div class="v3-row' + (o.open ? ' is-open' : '') + '">' +
    '<span class="v3-badge" data-t="' + (o.t || '') + '">' + o.b + '</span>' +
    '<span class="v3-main"><span class="v3-path">' + o.path + '</span>' +
    (o.kind ? '<span class="v3-kind">' + o.kind + '</span>' : '') + '</span>' + d +
    (o.act ? '<button class="v3-btn v3-btn--quiet">' + o.act + '</button>' : '') + '</div>'
}
function sec(t, n) {
  return '<div class="v3-sec"><span>' + t + '</span>' + (n ? '<span class="n">' + n + '</span>' : '') + '</div>'
}
function band(tone, mark, title, body, act) {
  return '<div class="v3-band" data-tone="' + tone + '"><span class="v3-band__mark">' + mark + '</span>' +
    '<span class="v3-band__main"><span class="v3-band__title">' + title + '</span>' +
    (body ? '<span class="v3-band__body">' + body + '</span>' : '') + '</span>' +
    (act ? '<span class="v3-band__act">' + act + '</span>' : '') + '</div>'
}
function ok(t, b) { return band('ok', '\u2713', t, b) }
function err(t, b) { return band('error', '\u00d7', t, b) }
function warn(t, b) { return band('warn', '!', t, b) }
function info(t, b) { return band('info', 'i', t, b) }
function shell(w, inner, right) {
  return '<div class="v3-shell v3-w' + w + '">' + head(w, right) + '<div class="v3-shell__body">' + inner + '</div></div>'
}
function cap(t, k, note) {
  return '<div class="cellcap"><b>' + t + '</b><span class="k">' + k + '</span>' + (note ? '<span>' + note + '</span>' : '') + '</div>'
}
function cell(t, k, note, html) {
  return '<div>' + cap(t, k, note) + html + '</div>'
}
function grid(inner, two) {
  return '<div class="grid" style="' + (two ? 'grid-template-columns:repeat(2,minmax(0,1fr))' : '') + '">' + inner + '</div>'
}
function diff(lines) { return '<div class="v3-diff">' + lines + '</div>' }
function dlg(t, body, cmd, okText) {
  return '<div class="v3-dialog"><div class="v3-dialog__title">' + t + '</div>' +
    '<div class="v3-dialog__body">' + body + '</div>' +
    '<div class="v3-dialog__cmd">' + cmd + '</div>' +
    '<div class="v3-dialog__ttl">这次确认 120 秒内有效；过期了重新看一眼再点。</div>' +
    '<div class="v3-dialog__foot"><button class="v3-btn v3-btn--quiet">取消</button>' +
    '<button class="v3-btn v3-btn--primary">' + okText + '</button></div></div>'
}
function empty(t, b) {
  return '<div class="v3-empty"' + (b ? '' : ' style="border:1px solid var(--line);border-radius:var(--radius);padding:14px 8px"') + '>' +
    (b ? '<b>' + t + '</b>' + b : t) + '</div>'
}
function commitArea(o) {
  o = o || {}
  return '<div class="v3-sec" style="margin-top:16px"><span>提交</span></div>' + (o.band || '') +
    '<textarea class="v3-input" rows="2"' + (o.disabled ? ' disabled' : '') + ' placeholder="写一句提交说明">' + (o.text || '') + '</textarea>' +
    '<div class="v3-tip" style="margin:5px 0 9px">提交的是暂存区里的内容；没有暂存的文件不会跟着走。</div>' +
    '<div style="display:flex;gap:8px;align-items:center">' +
    '<button class="v3-btn v3-btn--primary"' + (o.disabled || o.busy ? ' disabled' : '') + '>' +
    (o.busy ? '<span class="spin"></span>正在执行…' : '提交 ' + o.n + ' 个文件') + '</button>' +
    (o.hint ? '<span class="v3-tip">' + o.hint + '</span>' : '') + '</div>'
}
/* 数据都在这里：换风格时结构原样复用 */
var SCREENS = {
  readDirty: function () {
    return shell(520,
      warn('有 1 个文件卡在冲突里，正等着你处理', '这些文件里同时留着两边的内容：已经在分支上的那些提交，和正在重放的那一笔。', '去侧栏终端') +
      idline('deck', 'feat/version-panel', '领先 2 · 落后 1') +
      subline('D:/work/deck', '刚刚') +
      '<div class="v3-count">已暂存 3 个文件 / 未暂存 4 个文件，另有 1 个卡在冲突里</div>' +
      sec('未提交改动') + sec('已暂存', '3') +
      row({ b: 'A', t: 'added', kind: '新增', path: 'src/version-control-core/model.ts', add: 45, del: 2 }) +
      row({ b: 'M', t: 'modified', kind: '修改', path: 'src/client/panel/Dock.js', add: 12, del: 3 }) +
      row({ b: 'R', t: 'renamed', kind: '重命名', path: 'StatusView.js ← OldStatus.js', add: 8, del: 8 }) +
      sec('卡在冲突里', '1') +
      row({ b: '!', t: 'conflict', kind: '冲突：去侧栏终端处理', path: 'src/client/views/versionControl/vcBlocks.js', add: 1, del: 1 }) +
      sec('未暂存', '4') +
      row({ b: 'M', t: 'modified', kind: '修改', path: 'src/client/panel/RepoChipSkeleton.js', add: 30, del: 6, act: '暂存' }) +
      row({ b: '?', t: '', kind: '未跟踪', path: 'research/815-scratch-notes.md', note: 'untracked', act: '暂存' }) +
      row({ b: 'T', t: 'renamed', kind: '类型改变', path: 'scripts/verify-log-coverage.js', add: 1, del: 1, act: '暂存' }) +
      sec('其他工作树', '2') +
      '<div class="v3-row"><span class="v3-badge" data-t="">o</span><span class="v3-main"><span class="v3-path">feat/deck</span></span><span class="v3-kind">同名 · 已加长一段区分</span></div>' +
      '<div class="v3-row"><span class="v3-badge" data-t="">o</span><span class="v3-main"><span class="v3-path">deck-hotfix</span></span><span class="v3-kind">已被占用</span></div>' +
      sec('提交历史') +
      '<div class="v3-row"><span class="v3-badge" data-t="">·</span><span class="v3-main"><span class="v3-path">edfc5b8</span> 收录三份调研底稿</span><span class="v3-kind">3 小时前</span></div>' +
      '<div class="v3-row"><span class="v3-badge" data-t="">·</span><span class="v3-main"><span class="v3-path">ce6c97d</span> 只读视图不联网，领先落后只读本地缓存</span><span class="v3-kind">昨天</span></div>')
  },
  readClean: function () {
    return shell(520,
      idline('deck', 'main', '领先 2') + subline('D:/work/deck', '3 小时前') +
      '<div class="v3-sec" style="margin-top:14px"><span>未提交改动</span></div>' +
      empty('没有未提交的改动') +
      sec('提交历史') +
      '<div class="v3-row"><span class="v3-badge" data-t="">·</span><span class="v3-main"><span class="v3-path">e17b2b7</span> 三条 git 硬约束定版</span><span class="v3-kind">09-30</span></div>')
  },
  readMidOp: function (t) {
    return shell(520,
      warn(t, '处理合并、变基、冲突这些事都在同一排的侧栏终端里做，这里一个字节都不动你的仓库。', '去侧栏终端') +
      idline('deck', 'main', '领先 2') + subline('D:/work/deck', '刚刚') +
      '<div class="v3-sec" style="margin-top:14px"><span>未提交改动</span></div>' +
      empty('没有未提交的改动'))
  },
  readDetached: function () {
    return shell(520,
      idline('deck', '游离头指针', '不在任何分支上，领先落后这一套用不上') +
      subline('D:/work/deck', '刚刚') +
      '<div class="v3-tip" style="margin-top:8px">当前不在任何分支上，停在这笔提交上。这是正常状态，不是出错。</div>' +
      sec('未提交改动') + sec('未暂存', '1') +
      row({ b: 'M', t: 'modified', kind: '修改', path: 'src/client/views/versionControl/vcRows.js', add: 14, del: 2, act: '暂存' }))
  },
  readNoUpstream: function () {
    return shell(520,
      idline('deck', 'main', '还没有推送目标') + subline('D:/work/deck', '刚刚') +
      '<div class="v3-tip" style="margin-top:8px">这个分支还没设过上游，所以还没有「领先几个提交」这回事。推送和拉取请去侧栏终端。</div>' +
      sec('未提交改动') + empty('没有未提交的改动'))
  },
  readGone: function () {
    return shell(520,
      idline('deck', 'main', '推送目标已经不存在') + subline('D:/work/deck', '3 小时前') +
      '<div class="v3-tip" style="margin-top:8px">本地记着的那个远端分支在远端已经没了，所以领先落后没有意义。要重新设推送目标请去侧栏终端。</div>' +
      sec('未提交改动') + empty('没有未提交的改动'))
  },
  readBasisUnknown: function () {
    return shell(520,
      idline('deck', 'main', '') + subline('D:/work/deck', '刚刚') +
      '<div style="margin-top:10px">' + warn('不清楚本地记的远端信息有多旧，推送前先确认',
        '这个时间来自本地记着的远端跟踪引用的最后一次更新，不一定等于远端此刻的样子；在终端里跑 git fetch 才会变新。') + '</div>' +
      sec('未提交改动') + empty('没有未提交的改动'))
  },
  readBare: function () {
    return shell(520,
      warn('这是个裸仓库（没有工作树），这些操作都做不了') +
      sec('其他工作树', '1') +
      '<div class="v3-row"><span class="v3-badge" data-t="">o</span><span class="v3-main"><span class="v3-path">deck</span></span><span class="v3-kind">裸仓库（没有工作树）</span></div>' +
      sec('提交历史') +
      '<div class="v3-row"><span class="v3-badge" data-t="">·</span><span class="v3-main"><span class="v3-path">e17b2b7</span> 三条 git 硬约束定版</span><span class="v3-kind">09-30</span></div>')
  },
  readNotRepo: function () {
    return shell(520, err('这个目录不在任何 git 仓库里。'))
  },
  readNoGit: function () {
    return shell(520, err('找不到 git 程序：请确认装好了 git、并且它在 PATH 里，然后重启 DSH 再打开这个页签。'))
  },
  readOldGit: function () {
    return shell(520, err('这台机器上的 git 版本太旧，这个页签需要新一点的版本。'))
  },
  readNoCwd: function () {
    return shell(520, empty('这个会话还没有工作区，读不到版本信息'))
  },
  readNoCommits: function () {
    return shell(520,
      idline('deck', 'main', '还没有推送目标') + subline('D:/work/deck', '刚刚') +
      sec('提交历史') +
      empty('这个仓库还没有任何提交', '刚建好的仓库就是这样；做出第一次提交之后，这里就有历史了。'))
  },
  writeHome: function () {
    return shell(520,
      idline('deck', 'main', '领先 2 · 远端快照 · 2026-10-01 21:14') + subline('D:/work/deck', '刚刚') +
      '<div style="display:flex;gap:8px;margin:10px 0"><button class="v3-btn">拉取</button><button class="v3-btn v3-btn--primary">推送</button></div>' +
      sec('未提交改动') + sec('已暂存', '2') +
      row({ b: 'M', t: 'modified', kind: '修改', path: 'src/host/versionControl.js', add: 12, del: 3 }) +
      row({ b: 'A', t: 'added', kind: '新增', path: 'docs/adr/20261004-version-control-write-path.md', add: 86, del: 0 }) +
      sec('未暂存', '2') +
      row({ b: 'M', t: 'modified', kind: '修改', path: 'src/client/views/versionControl/vcRows.js', add: 14, del: 2, act: '暂存' }) +
      row({ b: '?', t: '', kind: '未跟踪', path: 'research/889-写操作-验收清单.md', note: 'untracked', act: '暂存' }) +
      commitArea({ text: '把版本管理页签的写操作接上宿主四条电话', n: 2 }))
  },
  writePullConfirm: function () {
    return shell(520,
      idline('deck', 'main', '领先 2 · 落后 1') + subline('D:/work/deck', '刚刚') +
      dlg('要拉取这个分支', '只做快进：把远端的新提交接到本地。需要合并时面板会停下来，指你去侧栏终端。',
        'git pull --ff-only origin main', '拉取'))
  },
  writePushConfirm: function (t) {
    if (t === 'set') {
      return shell(520, idline('deck', 'main', '还没有推送目标') + subline('D:/work/deck', '刚刚') +
        dlg('第一次推送：要把它设为上游', '把本地 main 推到 origin/main，并把它设为上游。',
          'git push --set-upstream origin main:main', '设为上游并推送'))
    }
    if (t === 'recreate') {
      return shell(520, idline('deck', 'main', '推送目标已经不存在') + subline('D:/work/deck', '3 小时前') +
        dlg('原来那个上游已经不存在了', '远端分支 origin/main 已经不在了（原来的上游已经不存在）：会把本地 main 推上去，并把它设为上游。',
          'git push --set-upstream origin main:main', '重建上游并推送'))
    }
    return shell(520, idline('deck', 'main', '领先 2') + subline('D:/work/deck', '刚刚') +
      dlg('要推送这些提交', '推到 origin/main。', 'git push origin main:main', '推送'))
  },
  writeRemotePick: function () {
    return shell(520, idline('deck', 'main', '还没有推送目标') + subline('D:/work/deck', '刚刚') +
      '<div class="v3-dialog"><div class="v3-dialog__title">这个仓库有多个远端，选一个再推</div>' +
      '<div class="v3-dialog__body">面板不替你挑远端；选中之后会重新预检，确认框里会写清推到哪。</div>' +
      '<div style="display:flex;gap:8px;margin-top:11px"><button class="v3-btn v3-btn--primary">origin</button>' +
      '<button class="v3-btn">upstream</button><button class="v3-btn">fork</button></div></div>')
  },
  writeErrs: function () {
    var out = ''
    out += err('远端不认这台机器上的凭据，需要重新登录', '面板不替你保存或输入凭据：去侧栏终端跑一次 fetch 或 push，按提示登录，成功后回来点刷新。')
    out += err('远端拒绝了这个动作（权限或服务端规则拦下了）', '面板改不了远端的规则：确认用的是哪个账号，要换账号请去侧栏终端。')
    out += err('远端规则拦下了这次推送（钩子或保护规则）', '上面那句是远端原话，按它处理；面板改不了远端的规则，也不用换账号。')
    out += err('本地和远端都有新提交，直接拉会打架', '面板不替你合并：去侧栏终端跑 git pull，处理完冲突再回来。')
    out += err('远端的新提交已经取回来了，但本地和它分开了，不能快进', '面板只做快进：合并或变基去侧栏终端。')
    out += err('远端有你本地还没有的提交，直接推会被拒', '先在侧栏终端 fetch 或 pull 把远端的新提交取回来，再合并或变基。')
    out += err('网络断了或者超时了，这一步没做完', '面板不自动重试：检查网络后再点一次。')
    out += err('这次确认已经过期，或者仓库在你确认之后又变了', '面板不替你猜：重新看一眼当前状态，再点一次。')
    out += err('这一步现在做不成，宿主把原因写在悬停提示里了', '面板不替你改仓库：按悬停里那句做完再回来。')
    out += err('这次失败面板说不清原因', '原始说明：{msg}　上面那句是宿主的原话：按它处理；面板不自动重试。')
    out += warn('这一步的结果不确定：提交可能已经发生，先看提交历史再决定', '面板不替你猜结果：看一眼提交历史，确认了再决定要不要再提交。')
    out += ok('已经提交了') + ok('推送完成') + ok('拉取完成', '已经快进到远端最新') +
      ok('第一次推送完成，已经把它设为上游') + ok('已重建上游：把本地 main 推到了 origin/main')
    return out
  },
  writeBlocked: function () {
    var list = ['没有可暂存的东西', '暂存区是空的，没有可提交的内容', '有文件卡在冲突里，先处理完再继续',
      '工作区有未提交的改动，先提交再拉取', '这个分支还没有上游', '这个分支的上游在远端已经不存在了',
      '现在不在任何分支上（游离头指针），这一步做不了', '仓库里还有没做完的操作，先处理完',
      '远端有你本地还没有的提交，先拉取再推送', '这是个裸仓库（没有工作树），这些操作都做不了', '这一步现在做不了']
    var out = '<div class="v3-btn v3-btn--primary" style="opacity:.4">全部暂存</div><div class="v3-btn v3-btn--primary" style="opacity:.4">提交 2 个文件</div>'
    list.forEach(function (t) { out += '<div class="v3-row"><span class="v3-chip">禁用原因</span><span class="v3-main"><span class="v3-kind">' + t + '</span></span></div>' })
    return out
  },
  diffOpen: function () {
    return shell(520,
      idline('deck', 'main', '领先 2') + subline('D:/work/deck', '刚刚') +
      sec('未提交改动') + sec('已暂存', '1') +
      row({ b: 'M', t: 'modified', kind: '修改', path: 'src/client/views/versionControl/vcRows.js', add: 12, del: 3, open: true }) +
      diff('<div class="v3-diff__hunk">@@ -10,6 +10,9 @@ 展开键与块模型共用</div>' +
        '<div class="v3-diff__ctx">   const rev = String(ui.openCommit || \'\')</div>' +
        '<div class="v3-diff__del">-  return rev ? vcCommitKeyOf(rev, row.path) : String(row.path || \'\')</div>' +
        '<div class="v3-diff__add">+  return vcDiffOpenKeyOf(row, ui.openCommit)</div>' +
        '<div class="v3-diff__note">这一处看的是相对上一次提交的全部改动（已暂存与未暂存两部分都在里面）。</div>') +
      sec('未暂存', '1') +
      row({ b: 'M', t: 'modified', kind: '修改', path: 'src/client/views/versionControl/vcBlocks.js', add: 3, del: 3 }))
  },
  diffCommit: function () {
    return shell(520,
      idline('deck', 'main', '领先 2') + subline('D:/work/deck', '刚刚') +
      '<div class="v3-sec" style="display:flex;align-items:baseline"><span>提交历史</span>' +
      '<a class="v3-link" style="margin-left:auto">回到未提交改动</a></div>' +
      '<div class="v3-row is-open"><span class="v3-badge" data-t="">·</span><span class="v3-main"><span class="v3-path">edfc5b8</span> 收录三份调研底稿</span><span class="v3-kind">3 小时前</span></div>' +
      sec('这笔提交改了什么') +
      '<div class="v3-count" style="margin-top:8px">这笔提交改了 3 个文件</div>' +
      row({ b: 'A', t: 'added', kind: '新增', path: 'research/github-desktop-feature-survey.md', add: 412, del: 0, open: true }) +
      diff('<div class="v3-diff__hunk">@@ -0,0 +1,3 @@</div><div class="v3-diff__add">+ # GitHub Desktop 功能调研</div><div class="v3-diff__add">+ </div><div class="v3-diff__add">+ 一、支持什么</div>') +
      row({ b: 'M', t: 'modified', kind: '修改', path: 'CONTEXT.md', add: 12, del: 6 }))
  },
  diffForms: function () {
    return grid(
      cell('加载中', 'vc.diff.loading', '', shell(520, sec('未暂存', '1') +
        row({ b: 'M', t: 'modified', kind: '修改', path: 'src/host/versionControl.js', add: 1, del: 0, open: true }) +
        '<div style="padding:6px"><div class="v3-skel" style="width:80%"></div><div class="v3-skel" style="width:62%"></div><div class="v3-skel" style="width:74%"></div></div>' +
        '<div class="v3-tip">正在读改动…</div>')) +
      cell('二进制文件', 'vc.diff.binary', '', shell(520, sec('未暂存', '1') +
        row({ b: 'M', t: 'modified', kind: '修改', path: 'assets/logo.png', add: 0, del: 0, note: '—', open: true }) +
        empty('二进制文件，不逐行显示改动。'))) +
      cell('改动太大', 'vc.diff.tooBig', '', shell(520, sec('未暂存', '1') +
        row({ b: 'M', t: 'modified', kind: '修改', path: 'vendor/bundle.js', add: 18422, del: 9103, open: true }) +
        empty('这个文件的改动太大，读不全就没给内容；去侧栏终端看这一处的完整改动。'))) +
      cell('合并提交', 'vc.diff.mergeCommit', '', shell(520, sec('提交历史') +
        '<div class="v3-row"><span class="v3-badge" data-t="">·</span><span class="v3-main"><span class="v3-path">9ab31c0</span> Merge branch \'feat/deck\'</span></div>' +
        empty('这是一次合并提交：git 默认不展开合并提交的逐行差异，所以这里没有内容。'))) +
      cell('未跟踪', 'vc.diff.untracked', '', shell(520, sec('未暂存', '1') +
        row({ b: '?', t: '', kind: '未跟踪', path: 'notes/设计/控件图鉴.md', note: 'untracked', open: true }) +
        empty('这个文件还没被 git 跟踪，没有可比的旧版本。'))) +
      cell('读失败', 'vc.diff.fail', '', shell(520, sec('未暂存', '1') +
        row({ b: 'M', t: 'modified', kind: '修改', path: 'src/client/views/versionControl/vcRows.js', add: 1, del: 0, open: true }) +
        err('这个文件的改动读不到', '', '<a class="v3-link">重试</a>'))) +
      cell('没有内容', 'vc.diff.empty', '', shell(520, sec('未暂存', '1') +
        row({ b: 'M', t: 'modified', kind: '修改', path: 'docs/adr/20261004-x.md', add: 0, del: 0, open: true }) +
        empty('这一处这次没读到改动内容。'))) +
      cell('还没有基线', 'vc.diff.noBaseline', '', shell(520, sec('未提交改动') +
        empty('这个仓库还没有第一次提交，没有可比的基线。')))
    )
  },
  histStates: function () {
    return grid(
      cell('加载更早的提交', 'vc.commits.loading', '', shell(520, sec('提交历史') +
        '<div class="v3-row"><span class="v3-badge" data-t="">·</span><span class="v3-main"><span class="v3-path">edfc5b8</span> 收录三份调研底稿</span><span class="v3-kind">3 小时前</span></div>' +
        '<div style="padding:6px"><div class="v3-skel" style="width:78%"></div><div class="v3-skel" style="width:58%"></div></div>' +
        '<div class="v3-tip" style="padding:4px 6px">正在读更早的提交…</div>')) +
      cell('读失败', 'vc.commits.fail', '', shell(520, sec('提交历史') +
        '<div class="v3-row"><span class="v3-badge" data-t="">·</span><span class="v3-main"><span class="v3-path">ce6c97d</span> 只读视图不联网</span><span class="v3-kind">昨天</span></div>' +
        err('更早的提交读不到', '', '<a class="v3-link">重试</a>'))) +
      cell('还有更多', 'vc.commits.more', '', shell(520, sec('提交历史') +
        '<div class="v3-row"><span class="v3-badge" data-t="">·</span><span class="v3-main"><span class="v3-path">edfc5b8</span> 收录三份调研底稿</span><span class="v3-kind">3 小时前</span></div>' +
        '<div style="padding:11px 6px"><a class="v3-link">加载更早的提交</a></div>')) +
      cell('已经到底', 'vc.commits.allLoaded · expand', '', shell(520, sec('提交历史') +
        '<div class="v3-row"><span class="v3-badge" data-t="">·</span><span class="v3-main"><span class="v3-path">e17b2b7</span> 三条 git 硬约束定版</span><span class="v3-kind">09-30</span></div>' +
        '<div class="v3-tip" style="padding:10px 6px 4px">已经到底了</div>' +
        '<div style="padding:0 6px 10px"><a class="v3-link">提交历史收起了（20 条），点开看</a></div>')) +
      cell('没有提交', 'vc.noCommits · noCommitsTip', '', shell(520, sec('提交历史') +
        empty('这个仓库还没有任何提交', '刚建好的仓库就是这样；做出第一次提交之后，这里就有历史了。')))
    )
  },
  worktrees: function () {
    var r = function (n, note) {
      return '<div class="v3-row"><span class="v3-badge" data-t="">o</span><span class="v3-main"><span class="v3-path">' + n + '</span></span><span class="v3-kind">' + note + '</span></div>'
    }
    return grid(
      cell('当前这个 / 同名加长', 'vc.other.title · summary', '', shell(520, sec('其他工作树', '2') + r('deck', '当前这个') + r('feat/deck', '同名 · 已加长一段区分'))) +
      cell('被占用 / 答不出', 'vc.other.locked · lockUnknown', '', shell(520, sec('其他工作树', '2') + r('deck-hotfix', '已被占用') + r('old-fix', '无法显示'))) +
      cell('目录已不存在 / 裸仓库', 'vc.other.prunable · bare', '', shell(520, sec('其他工作树', '2') + r('gone-dir', '目录已不存在') + r('mirror', '裸仓库（没有工作树）'))) +
      cell('没有分支 / 收起更多', 'vc.other.noBranch · more', '', shell(520, sec('其他工作树', '4') + r('detached-one', '没有分支') + r('feat/deck', '同名 · 已加长一段区分') +
        '<div style="padding:9px 6px"><a class="v3-link">还有 2 棵没收起，点开接着看</a></div>')) +
      cell('一个都没有', 'vc.other.empty · tip', '', shell(520, sec('其他工作树', '0') + empty('没有别的工作树') +
        '<div class="v3-tip" style="margin-top:9px">这台机器上 git 记着的其他工作树副本。这里不列没有检出的本地分支，所以它不是分支全貌。</div>'))
    )
  },
  controlsTop: function () {
    return '<div class="spec"><div class="spec__name">面板顶部动作</div>' +
      '<div class="spec__key">vc.reload · vc.action.pull · vc.action.push · pushSetUpstream · pushRecreate</div>' +
      '<div class="spec__row"><a class="v3-link">重新读一次</a><button class="v3-btn">拉取</button>' +
      '<button class="v3-btn v3-btn--primary">推送</button></div>' +
      '<div class="spec__row"><button class="v3-btn v3-btn--primary">设为上游并推送</button>' +
      '<button class="v3-btn v3-btn--primary">重建上游并推送</button></div>' +
      '<div class="spec__row"><button class="v3-btn" disabled>拉取</button>' +
      '<span class="v3-tip">禁用原因写在悬停里：工作区有未提交的改动 / 有文件卡在冲突里 / 裸仓库 / 游离头 / 仓库里还有没做完的操作。</span></div></div>'
  },
  controlsStage: function () {
    return '<div class="spec"><div class="spec__name">暂存与提交</div>' +
      '<div class="spec__key">vc.action.stage · stageAll · commit · block.nothingToStage · block.nothingStaged</div>' +
      '<div class="spec__row"><button class="v3-btn">全部暂存</button><button class="v3-btn" disabled>全部暂存</button>' +
      '<span class="v3-tip">没有可暂存的东西</span></div>' +
      '<div class="spec__row"><button class="v3-btn v3-btn--primary">提交 2 个文件</button>' +
      '<button class="v3-btn v3-btn--primary" disabled>提交 0 个文件</button>' +
      '<span class="v3-tip">暂存区是空的，没有可提交的内容</span></div>' +
      '<div class="spec__row"><button class="v3-btn v3-btn--quiet">暂存</button>' +
      '<span class="v3-tip">只出现在未暂存那一行右边；冲突行给的是「冲突：去侧栏终端处理」</span></div></div>'
  },
  controlsInput: function () {
    return '<div class="spec"><div class="spec__name">提交说明输入框</div>' +
      '<div class="spec__key">vc.commitArea.placeholder · hint · needMessage</div>' +
      '<textarea class="v3-input" rows="2" placeholder="写一句提交说明"></textarea>' +
      '<div class="spec__row"><textarea class="v3-input" rows="2" style="width:190px">把版本管理页签的写操作接上宿主四条电话</textarea>' +
      '<textarea class="v3-input" rows="2" style="width:130px" disabled>已有说明</textarea></div>' +
      '<div class="spec__row">' + warn('先写一句提交说明') + '</div></div>'
  },
  controlsStates: function () {
    return '<div class="spec"><div class="spec__name">进行中 / 完成 / 失败 / 不确定</div>' +
      '<div class="spec__key">vc.op.running · done* · failed · unknown</div>' +
      '<div class="spec__row"><button class="v3-btn v3-btn--primary" disabled><span class="spin"></span>正在执行…</button></div>' +
      '<div class="spec__row">' + ok('已暂存 2 个文件') + ok('已经提交了') + '</div>' +
      '<div class="spec__row">' + err('没做成') + warn('结果不确定') + '</div></div>'
  },
  controlsBadges: function () {
    var b = [['A','added','新增'],['M','modified','修改'],['D','deleted','删除'],['R','renamed','重命名'],['T','renamed','类型改变'],['?','','未跟踪'],['!','conflict','冲突']]
    var h = '<div class="spec"><div class="spec__name">状态字母徽章 + 正负行数</div><div class="spec__key">vc.change.* · vc.row.conflict · vc.row.countsDual</div><div class="spec__row">'
    b.forEach(function (x) {
      h += '<span class="v3-badge" data-t="' + x[1] + '">' + x[0] + '</span><span class="v3-kind">' + x[2] + '</span>'
    })
    h += '</div><div class="spec__row"><span class="v3-delta"><span class="v3-add">+45</span> −2</span>' +
      '<span class="v3-delta"><span class="v3-add">+8</span> <span class="v3-del">−8</span></span>' +
      '<span class="v3-delta">−120</span><span class="v3-delta">untracked</span></div></div>'
    return h
  },
  controlsBlocked: function () {
    return '<div class="spec"><div class="spec__name">被规则挡住时的 11 句禁用原因</div>' +
      '<div class="spec__key">vc.block.*</div><div class="v3-tip">每一条都写成人话，不用错误码。</div>' +
      '<div class="spec__row">' + SCREENS.writeBlocked() + '</div></div>'
  },
  controlsWarns: function () {
    return '<div class="spec"><div class="spec__name">提交前的三条提醒（不拦，只提醒）</div>' +
      '<div class="spec__key">vc.warn.detachedHead · midOperation · basisUnknown</div>' +
      '<div class="spec__row">' + warn('现在不在任何分支上，提交会落在游离头指针上') + '</div>' +
      '<div class="spec__row">' + warn('仓库里还有没做完的操作，提交前先确认') + '</div>' +
      '<div class="spec__row">' + warn('不清楚本地记的远端信息有多旧，推送前先确认') + '</div></div>'
  },
  controlsReadFail: function () {
    return '<div class="spec"><div class="spec__name">读不到的 14 种说法</div><div class="spec__key">vc.fail.*</div>' +
      '<div class="spec__row">' + err('这个目录不在任何 git 仓库里。') + '</div>' +
      '<div class="spec__row">' + err('找不到 git 程序：请确认装好了 git、并且它在 PATH 里，然后重启 DSH 再打开这个页签。') + '</div>' +
      '<div class="spec__row">' + err('这台机器上的 git 版本太旧，这个页签需要新一点的版本。') + '</div>' +
      '<div class="spec__row">' + err('读不到仓库的运行状态（宿主的文件服务没给出结论），这一步读不到就不给数；稍后再试。') + '</div>' +
      '<div class="spec__row">' + err('git 没有正常结束：多半是别的程序正占着这个仓库，或者权限不够。等它结束再重试。') + '</div>' +
      '<div class="spec__row">' + err('读这个仓库超时了：git 一直没有回音，等它忙完再重试。') + '</div>' +
      '<div class="spec__row">' + err('读到的内容看不懂：这台 git 的输出形状和预期不一样。') + '</div>' +
      '<div class="spec__row"><span class="v3-kind">起不了 git 进程，这一步读不到。/ 读这一步时断了，内容没拿到。/ 读到的内容超过了上限，读不全就不给半份数据。/ 这条路没有按约定回话，读不到内容。/ 界面这一侧把请求发错了，这一步读不到。/ 读不到这一项。</span></div></div>'
  },
  controlsLinks: function () {
    return '<div class="spec"><div class="spec__name">链接族</div>' +
      '<div class="spec__key">vc.terminal · vc.retry · vc.commits.more · vc.commit.back · vc.more · vc.other.more</div>' +
      '<div class="spec__row"><a class="v3-link">去侧栏终端</a><a class="v3-link">重试</a>' +
      '<a class="v3-link">加载更早的提交</a><a class="v3-link">回到未提交改动</a></div>' +
      '<div class="spec__row"><a class="v3-link">还有 12 个文件，点开接着看</a>' +
      '<a class="v3-link">还有 3 棵没收起，点开接着看</a></div></div>'
  },
  controlsEmpty: function () {
    return '<div class="spec"><div class="spec__name">空态与骨架</div><div class="spec__key">vc.changes.none · vc.other.empty · vc.noCommits</div>' +
      '<div class="spec__row">' + empty('没有未提交的改动') + '</div>' +
      '<div class="spec__row">' + empty('这个仓库还没有任何提交', '刚建好的仓库就是这样；做出第一次提交之后，这里就有历史了。') + '</div>' +
      '<div class="spec__row"><div style="width:100%"><div class="v3-skel" style="width:74%"></div>' +
      '<div class="v3-skel" style="width:56%"></div><div class="v3-skel" style="width:66%"></div></div></div></div>'
  }
}
