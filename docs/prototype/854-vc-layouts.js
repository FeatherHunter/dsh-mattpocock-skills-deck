// 854-vc-layouts.js —— 三套「信息架构」共用的数据与渲染。
// 与 853 的区别：853 换的是视觉语言（颜色/字体/圆角），这一份换的是**东西摆在哪**：
// 同样一批事实，三种摆法，三种「要找一个功能要不要往下翻」的答案。
// 所有文案抄自产品词条（自造词条 0）。改文案先改产品词条，再回来改这里。
(function () {
  // 零件（沿用 853 的类名与规格）
  var P = {
    badge: function (t) { return function (b, k, path, add, del, extra) {
      var d = ''
      if (add !== undefined) d = '<span class="v3-delta">' + (add ? '<span class="v3-add">+' + add + '</span>' : '') +
        (del ? ' <span class="v3-del">\u2212' + del + '</span>' : '') + '</span>'
      else if (extra) d = '<span class="v3-delta">' + extra + '</span>'
      return '<div class="v3-row"><span class="v3-badge" data-t="' + (t || '') + '">' + b + '</span>' +
        '<span class="v3-main"><span class="v3-path">' + path + '</span>' +
        (k ? '<span class="v3-kind">' + k + '</span>' : '') + '</span>' + d + '</div>'
    }},
    sec: function (t, n) { return '<div class="v3-sec"><span>' + t + '</span>' + (n ? '<span class="n">' + n + '</span>' : '') + '</div>' },
    band: function (tone, mark, title, body, act) {
      return '<div class="v3-band" data-tone="' + tone + '"><span class="v3-band__mark">' + mark + '</span>' +
        '<span class="v3-band__main"><span class="v3-band__title">' + title + '</span>' +
        (body ? '<span class="v3-band__body">' + body + '</span>' : '') + '</span>' +
        (act ? '<span class="v3-band__act">' + act + '</span>' : '') + '</div>'
    },
    link: function (t) { return '<a class="v3-link">' + t + '</a>' }
  }
  var warn = function (t, b, a) { return P.band('warn', '!', t, b, a) }
  var err = function (t, b, a) { return P.band('error', '\u00d7', t, b, a) }
  var ok = function (t, b) { return P.band('ok', '\u2713', t, b) }
  var info = function (t, b) { return P.band('info', 'i', t, b) }

  // 三条动作按钮（所有布局共用，保证「能按到」这件事在任何布局里都成立）
  var actions = function (n, withInput) {
    return '<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">' +
      '<button class="v3-btn">拉取</button>' +
      '<button class="v3-btn v3-btn--primary">推送</button>' +
      '<span style="width:1px;height:16px;background:var(--line2);margin:0 3px"></span>' +
      '<button class="v3-btn">全部暂存</button>' +
      (withInput
        ? '<span class="lay-bar__grow"></span><span class="lay-bar__lbl">提交说明</span>' +
          '<input class="v3-input" style="flex:1;min-width:120px" placeholder="写一句提交说明">' +
          '<button class="v3-btn v3-btn--primary">提交 ' + n + ' 个文件</button>'
        : '') + '</div>'
  }
  var identity = function (compact) {
    return '<div class="v3-id"><span>deck</span><span class="sep">/</span><span class="br">feat/version-panel</span>' +
      '<span class="v3-tip" style="margin-left:auto">领先 2 · 落后 1</span></div>' +
      (compact ? '' : '<div class="v3-sub"><span>D:/work/deck</span><span>·</span><span class="num">读到于 刚刚</span>' +
        '<span>·</span><span>远端信息更新于 3 小时前</span></div>')
  }
  var stats = function () {
    return '<div class="stat">' +
      '<div class="stat__i" data-k="conflict"><div class="stat__n">1</div><div class="stat__t">卡在冲突里</div></div>' +
      '<div class="stat__i" data-k="staged"><div class="stat__n">3</div><div class="stat__t">已暂存</div></div>' +
      '<div class="stat__i" data-k="unstaged"><div class="stat__n">4</div><div class="stat__t">未暂存</div></div>' +
      '</div>'
  }
  var conflict = function () {
    return warn('有 1 个文件卡在冲突里，正等着你处理',
      '这些文件里同时留着两边的内容：已经在分支上的那些提交，和正在重放的那一笔。', P.link('去侧栏终端'))
  }
  var changed = function (withActs) {
    var stage = P.badge('added')('A', '新增', 'src/version-control-core/model.ts', 45, 2) +
      P.badge('modified')('M', '修改', 'src/client/panel/Dock.js', 12, 3) +
      P.badge('renamed')('R', '重命名', 'StatusView.js ← OldStatus.js', 8, 8)
    var unst = P.badge('modified')('M', '修改', 'src/client/panel/RepoChipSkeleton.js', 30, 6) +
      P.badge('')('?', '未跟踪', 'research/815-scratch-notes.md', undefined, undefined, 'untracked') +
      P.badge('renamed')('T', '类型改变', 'scripts/verify-log-coverage.js', 1, 1) +
      P.badge('modified')('M', '修改', 'notes/设计/…/控件图鉴.md', 24, 6)
    var cfl = P.badge('conflict')('!', '冲突：去侧栏终端处理', 'src/client/views/versionControl/vcBlocks.js', 1, 1)
    return conflict() +
      P.sec('卡在冲突里', '1') + cfl +
      P.sec('已暂存', '3') + stage +
      P.sec('未暂存', '4') + unst +
      (withActs ? '' : '')
  }
  var worktrees = function () {
    return P.sec('其他工作树', '2') +
      '<div class="v3-row"><span class="v3-badge" data-t="">o</span><span class="v3-main"><span class="v3-path">feat/deck</span></span><span class="v3-kind">同名 · 已加长一段区分</span></div>' +
      '<div class="v3-row"><span class="v3-badge" data-t="">o</span><span class="v3-main"><span class="v3-path">deck-hotfix</span></span><span class="v3-kind">已被占用</span></div>' +
      '<div style="padding:9px 6px">' + P.link('去侧栏终端') + '</div>'
  }
  var history = function (limit) {
    var rows = '<div class="v3-row"><span class="v3-badge" data-t="">·</span><span class="v3-main"><span class="v3-path">edfc5b8</span> 收录三份调研底稿</span><span class="v3-kind">3 小时前</span></div>' +
      '<div class="v3-row"><span class="v3-badge" data-t="">·</span><span class="v3-main"><span class="v3-path">ce6c97d</span> 只读视图不联网，领先落后只读本地缓存</span><span class="v3-kind">昨天</span></div>'
    if (limit) rows += '<div class="v3-row"><span class="v3-badge" data-t="">·</span><span class="v3-main"><span class="v3-path">e17b2b7</span> 三条 git 硬约束定版</span><span class="v3-kind">09-30</span></div>' +
      '<div style="padding:10px 6px">' + P.link('加载更早的提交') + '</div>'
    else rows += '<div style="padding:10px 6px">' + P.link('提交历史收起了（20 条），点开看') + '</div>'
    return P.sec('提交历史') + rows
  }

  // ===== A：状态优先 + 常驻操作条 =====
  function layA() {
    return '<div class="v3-shell v3-w520">' +
      '<div class="v3-shell__head"><span>version-control</span><span class="r">520px</span></div>' +
      '<div class="v3-shell__body">' +
      identity(false) + stats() +
      '<div class="lay-bar">' + actions(3, true) + '</div>' +
      changed(true) +
      '<div class="lay-tail">' +
      '<div class="lay-tail__c">' + worktrees() + '</div>' +
      '<div class="lay-tail__c">' + history(true) + '</div>' +
      '</div></div></div>'
  }

  // ===== B：双栏工作台 + 底部操作坞 =====
  function layB() {
    return '<div class="v3-shell v3-w520">' +
      '<div class="v3-shell__head"><span>version-control</span><span class="r">520px</span></div>' +
      '<div class="v3-shell__body">' +
      '<div class="lay-split">' +
      '<aside class="rail">' +
      '<div class="rail__t">工作树</div>' +
      '<div class="rail__id"><span>deck</span><span class="sep">/</span><span class="br">feat/version-panel</span></div>' +
      '<div class="rail__p">D:/work/deck</div>' +
      '<div class="rail__m"><b>领先 2</b> · 落后 1<br>远端信息更新于 3 小时前<br>读到于 刚刚</div>' +
      worktrees() +
      '<div class="rail__t">提示</div>' +
      '<div class="rail__m">暂存、提交、拉取、推送、切分支、建工作树这些会动仓库或要联网的事，都在同一排的侧栏终端里做。</div>' +
      '</aside>' +
      '<main class="lay-main">' + conflict() + stats() + changed(true) + '</main>' +
      '</div>' +
      '<div class="dock">' + actions(3, true) + '</div>' +
      '</div></div>'
  }

  // ===== C：视图切换 =====
  var viewKey = 'changes'
  function layC() {
    var views = {
      changes: '<div class="lay-view is-on" data-v="changes">' + conflict() + stats() +
        '<div class="viewbar"><span class="lbl">提交</span>' + actions(3, true) + '</div>' + changed(true) + '</div>',
      commits: '<div class="lay-view" data-v="commits">' + history(true) + '</div>',
      worktrees: '<div class="lay-view" data-v="worktrees">' + worktrees() + '</div>'
    }
    return '<div class="v3-shell v3-w520">' +
      '<div class="v3-shell__head"><span>version-control</span><span class="r">520px</span></div>' +
      '<div class="v3-shell__body">' +
      identity(false) +
      '<div class="lay-views" role="tablist">' +
      '<button role="tab" data-v="changes" aria-selected="true">改动 <span class="n">8</span></button>' +
      '<button role="tab" data-v="commits" aria-selected="false">提交历史 <span class="n">3</span></button>' +
      '<button role="tab" data-v="worktrees" aria-selected="false">工作树 <span class="n">2</span></button>' +
      '</div>' + views.changes + views.commits + views.worktrees +
      '</div></div>'
  }

  var LAYOUTS = {
    A: { name: 'A 状态优先 · 常驻操作条', render: layA,
      why: '把「现在有几件事」做成三个数字块，把四个写操作做成一条常驻操作条钉在列表上方。翻到哪儿都能按到；只读参考信息（其他工作树、提交历史）并排放在下面，高度省一半。',
      cost: '代价：操作条会占掉约一行高度；下面两块并排后每块变窄，长路径更容易截断。' },
    B: { name: 'B 双栏工作台 · 底部操作坞', render: layB,
      why: '左栏只放「我在哪」（工作树、分支、路径、领先落后、其他工作树 —— 都是导航性质），右栏只放「要做什么」（冲突、计数、改动、提交）。写操作收到最底部的操作坞，像 IDE 的状态栏。',
      cost: '代价：520px 宽里左栏要吃掉约 196px，右栏正文变窄，路径截断更早；窄面板（300px）需要把左栏收成一行。' },
    C: { name: 'C 视图切换 · 一次只看一件事', render: layC,
      why: '把改动、提交历史、工作树拆成三个视图，页签上带数量，一眼知道东西在哪个视图里；每个视图只放它自己的动作，改动页放暂存与提交，历史页放加载更多，工作树页放去终端。',
      cost: '代价：与 #821 已定的「首屏顺序」冲突（它要求其他工作树与提交历史出现在首屏），采用它需要改那张规格单。' }
  }
  function mount(el) {
    el.innerHTML = LAYOUTS[window.__vcLayout || 'A'].render()
    el.querySelectorAll('.lay-views button').forEach(function (b) {
      b.addEventListener('click', function () {
        el.querySelectorAll('.lay-views button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)) })
        el.querySelectorAll('.lay-view').forEach(function (v) { v.classList.toggle('is-on', v.dataset.v === b.dataset.v) })
      })
    })
  }
  window.VC_LAYOUTS = LAYOUTS
  window.VC_MOUNT_LAYOUT = mount
})()
