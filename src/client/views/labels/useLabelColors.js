/**
 * views/labels/useLabelColors.js — 标签配色弹窗的状态机（#621 新增）
 *
 * 这个钩子管四件事，界面拿到它渲染就行：
 *   一、打开时现取权威清单（host.call('wf.listLabels', {cwd})）。这一步会失败，所以状态有
 *       三种：loading（正在读）/ ready（读到了）/ failed（没读到，带档位与后端那句话，界面给重试）。
 *       清单的权威性只有这一个来源：面板快照里那份标签表是从各票收集来的派生数据，本来就不保证拿全。
 *   二、草稿：用户改过的行存在 draft（键是标签名，值是**用户填进去的原文**，没动过的行不在里面）。
 *       原文照存不归一化，是因为「这个值合不合法」由后端裁决、界面不自己拦（既有口径）；
 *       界面只是当场提示写法不对（见 labelColorErrors 的 lcToDisplay 与 LabelColorRow 的 incomplete）。
 *   三、保存：一次批量提交，入参只含**真正变了的行**——用配色核心的 pickChangedRows 挑
 *       （它内部用 colorsDiffer 按「两边都空不算变」的口径比），界面不自己写比较。
 *   四、保存成功后做两件事：一是把「后端刚确认的那几条」（`[{name, color}]`）报给面板那个回调，
 *       面板当场按新色显示（#635：不让面板等那次二十多秒的全量重拉）；二是重新取一次真实清单刷新
 *       （`load({ keepPhase: true, keepOutcome: true })`），把界面上显示的颜色换成后端刚返回的值。
 *       两处用的都是**后端确认过**的色值，不是用户填进格子的原文，所以这不算乐观刷新
 *       （乐观刷新指还没拿到后端答复就先按用户输入改界面）。
 *       失败的行保留草稿，用户不用重打一遍。
 *
 * 会话是不是只读、后端做不做这个操作，界面都不提前猜：只读会话采用做法 B（允许点保存，
 * 点了由后端报错，错误文案里说清那是插件自己的沙箱限制）；后端不支持时列表这一步就会
 * 以 unsupported 档失败，弹窗直接给一条诚实的「暂时做不到」，而不是摆一个点了才报错的按钮。
 *
 * 会话号（第三个参数，字段名 sessionId）是这两条电话必须带的一半：改色要写工作区里的文件，
 * 宿主得知道是哪一个会话在点保存，才能按那个会话算沙箱政策。宿主读的就是 args.sessionId
 * （见 src/host/workspaceCwd.js 的 resolveSandboxPolicy），与既有的 wf.cwd 那条路一致。
 * 面板没拿到会话号就传空串，不编一个假的——宿主那时会退回按工作区找唯一活会话，找不到就如实失败。
 *
 * 清单是从哪个后端读来的也要一起留着（#622）：列表回包里带着宿主选中的那个后端 id，这里原样存下来
 * 交给界面，界面靠它决定「复制推荐配色 prompt」拼哪一套文案（挑法见 labelColorErrors.js 的 lcCopyPlanOf）。
 * 界面不自己猜后端是谁：这份清单与那个 id 出自同一次选择，一起存才不会张冠李戴。
 *
 * 两条电话带上去的「面板现在用的是哪个后端」（#631 追加，见 phoneArgs）：它读的是**面板自己那份会话状态**，
 * 与上面那个回包里的 backendId 不是一回事——回包那个是宿主算完的结果（失败时根本没有），而这一条必须在
 * 打电话之前就带上，否则宿主只能自己按注册表规则算，多命中时就只能诚实地失败。
 * 带上它也不是让宿主去猜：宿主只核验这个后端是否真的认得这个工作区，认不得就照旧如实失败。
 */
export const useLabelColors = function (cwd, onSaved, sessionId) {
  const [phase, setPhase] = React.useState('loading')
  const [rows, setRows] = React.useState([])
  const [backendId, setBackendId] = React.useState('')
  const [loadError, setLoadError] = React.useState(null)
  const [draft, setDraft] = React.useState({})
  const [saving, setSaving] = React.useState(false)
  const [outcome, setOutcome] = React.useState(null)
  const liveRef = React.useRef(true)
  React.useEffect(function () {
    liveRef.current = true
    return function () { liveRef.current = false }
  }, [])

  // 会话号是这两条电话的一半（另一半是沙箱政策，由宿主自己算）：
  // 改色要写工作区里的文件，宿主必须知道「这是哪一个会话在点保存」才知道拿哪一档政策。
  // 字段名就是宿主实际读的那个：src/host/workspaceCwd.js 的 resolveSandboxPolicy 读 args.sessionId
  // （客户端那条既有的 wf.cwd 路径也传这个名字，两条电话与它保持一致）。
  // 面板没拿到会话号时传空串，不编一个假的：宿主收到空串会退回「按工作区找唯一活会话」，
  // 找不到就如实失败（宁可如实报失败，也不假装能写）。
  const sidArg = String(sessionId || '')

  // 两条电话要带上去的「面板现在用的是哪个后端」（#631 追加）：读的是面板自己那份会话状态，
  //   与面板头部那颗「切换后端」按钮同一个 store 对象、同一句话（取法见 labelColorErrors.js 的 lcPanelBackendOf）。
  //   面板当前没有后端（或者读不到）时是空串，**这时不带这个字段**——不编一个，宿主收到空的就是原来那条诚实失败。
  //   每次打电话现读一次：所以用户在面板里把后端换好、再回来点「重试」，带上去的就是他刚选的那个。
  const phoneArgs = function (extra) {
    const a = { cwd: String(cwd || ''), sessionId: sidArg }
    let panelBackend = ''
    try { panelBackend = lcPanelBackendOf((typeof storeOf === 'function') ? storeOf(sidArg) : null) } catch (e) { panelBackend = '' }
    if (panelBackend) a.backendId = panelBackend
    return Object.assign(a, extra || {})
  }

  const callHost = function (method, args) {
    try {
      if (typeof host !== 'undefined' && host && typeof host.call === 'function') return host.call(method, args)
    } catch (e) { /* 落到下面统一当作「拿不到回包」 */ }
    return null
  }
  const logCall = function (method, t0, res, err) {
    try {
      if (err !== undefined && err !== null) {
        log('warn', 'host.call.fail', { method: method, kind: 'label-colors', errorHash: dswsLogHash(dswsLogTrunc(String((err && err.message) || err), 120, 'error')) })
      } else if (res && res.ok === true) {
        log('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: 'label-colors' })
      } else {
        const why = (res && res.error && (res.error.message || res.error.kind)) || 'label-colors-not-ok'
        log('warn', 'host.call.fail', { method: method, kind: 'label-colors', errorHash: dswsLogHash(dswsLogTrunc(String(why), 120, 'error')) })
      }
    } catch (eL) { /* 记日志失败不影响功能 */ }
  }

  // opts.keepPhase 为真表示这次重取是「保存之后的重取」：正文不切回「加载中」——那会让刚保存完的清单闪一下变空。
  // opts.keepOutcome 为真表示上次保存的逐条结果要留着：点「重试」只重拉列表，不该把上一次「哪几条成了、哪几条没成」
  // 永久抹掉（用户正是靠那几行去对着修文件的）。只有真正打开弹窗那一次才清空它。
  const load = function (opts) {
    const keepPhase = !!(opts && opts.keepPhase)
    const keepOutcome = !!(opts && opts.keepOutcome)
    if (!keepPhase) setPhase('loading')
    setLoadError(null)
    if (!keepOutcome) setOutcome(null)
    const t0 = Date.now()
    return Promise.resolve(callHost('wf.listLabels', phoneArgs(null))).then(function (res) {
      logCall('wf.listLabels', t0, res)
      if (!liveRef.current) return null
      const list = lcLabelsOf(res)
      if (list) {
        setRows(list)
        // 清单与「它是哪个后端给的」是同一次选择的产物，一起存：界面挑复制那两套文案时靠的就是它。
        setBackendId(String((res && res.backendId) || ''))
        setPhase('ready')
        if (!keepPhase) setDraft({})
        return list
      }
      setLoadError(lcErrorOf(res))
      setPhase('failed')
      return null
    }).catch(function (e) {
      logCall('wf.listLabels', t0, null, e)
      if (!liveRef.current) return null
      setLoadError({ kind: '', message: String((e && e.message) || e) })
      setPhase('failed')
      return null
    })
  }

  React.useEffect(function () { load({}) }, [cwd])

  // 界面显示与真正发出去的清单**共用这一份**（只算一次）：核心挑出来的那些，再减掉「被清空」的行。
  // 为什么减：核心的判据是 colorsDiffer（两边归一化后不相等就算变了），所以「原本有颜色、用户把格子清空」
  // 在它看来是一条改动（新值是空串）。本图不做「清除颜色」这个动作，空串发过去只会被后端预检整体按 parse
  // 拒掉、错误再摊回每一行，用户看到「一个也没改成功」却不知道是自己清空了格子。所以这里把空值改动排除，
  // 由界面按「这一行还没填完」当场提示（见 lcRowIncomplete），并且不让保存按钮亮。
  // 要清除颜色得去工作区的配色文件里删掉那一行。
  const changes = (phase === 'ready')
    ? pickChangedRows(rows, draft).filter(function (c) { return c.color !== '' })
    : []

  const setRowText = function (name, text) {
    const next = Object.assign({}, draft)
    next[name] = String(text === null || text === undefined ? '' : text)
    setDraft(next)
  }

  const save = function () {
    if (saving) return Promise.resolve(null)
    // 发出去的清单就是上面算好的那一份 changes，这里不再自己重算一遍：
    // 两条各算一遍的路径迟早会漂开（曾经就是这里少了那个空值过滤，界面显示的与真正发出去的成了两份）。
    const list = changes
    if (!list.length) return Promise.resolve(null)
    setSaving(true)
    setOutcome(null)
    const t0 = Date.now()
    return Promise.resolve(callHost('wf.setLabelColors', phoneArgs({ changes: list }))).then(function (res) {
      logCall('wf.setLabelColors', t0, res)
      if (!liveRef.current) return null
      const result = lcSaveOutcome(res, list)
      const appliedNames = {}
      for (let i = 0; i < result.rows.length; i++) if (result.rows[i].ok) appliedNames[result.rows[i].name] = true
      // 改成功的行从草稿里删掉（后端刚返回的颜色就是它的新值）；没改成功的留着，方便重试。
      setDraft(function (prev) {
        const next = {}
        const keys = Object.keys(prev)
        for (let i = 0; i < keys.length; i++) if (!appliedNames[keys[i]]) next[keys[i]] = prev[keys[i]]
        return next
      })
      setOutcome(result)
      setSaving(false)
      // 面板那一侧当场按新颜色显示（#635）：把后端刚确认的这几行报上去，不让它等下面那次全量重拉。
      // 报的是「标签名 + 后端确认的最终色」，不是用户填进格子的原文（谁对由后端裁决）。
      // 面板拿到之后会把它写进面板那份快照（见 views/labels/labelColorPatch.js），并照旧在后台重拉一次。
      const appliedRows = []
      for (let i = 0; i < result.rows.length; i++) if (result.rows[i].ok) appliedRows.push({ name: result.rows[i].name, color: result.rows[i].color })
      if (appliedRows.length && typeof onSaved === 'function') { try { onSaved(appliedRows) } catch (e) { /* 面板当场改色失败不影响这次保存的结果 */ } }
      // 保存成功后重新取一次真实清单：界面显示的颜色一律以后端刚返回的这份为准。
      // 全部成功时弹窗紧接着会自己关掉（判据与关法见 LabelColorDialog.js），这一次重拉的结果没有人再看；
      // 仍然照拉，是因为这一层不该去猜上面关不关窗。
      return load({ keepPhase: true, keepOutcome: true }).then(function () { return result })
    }).catch(function (e) {
      logCall('wf.setLabelColors', t0, null, e)
      if (!liveRef.current) return null
      const result = lcSaveOutcome({ ok: false, error: { kind: '', message: String((e && e.message) || e) } }, list)
      setOutcome(result)
      setSaving(false)
      return load({ keepPhase: true, keepOutcome: true }).then(function () { return result })
    })
  }

  return {
    phase: phase,
    rows: rows,
    backendId: backendId,
    loadError: loadError,
    draft: draft,
    saving: saving,
    outcome: outcome,
    changes: changes,
    reload: load,
    save: save,
    setRowText: setRowText,
  }
}
