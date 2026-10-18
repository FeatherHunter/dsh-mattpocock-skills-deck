function createMapTickets(deps) {
  const { canonicalKey, selectEarly, isComposerSelection, getTrackerRegistry, getPlatform, ctx, DEFAULT_CWD, logCtx, groupTickets, getMapBody, detectionExec } = deps;
  function hash8(s) {
    try {
      const t = String(s || "");
      let h = 5381;
      for (let i = 0; i < t.length; i++) h = (h << 5) + h + t.charCodeAt(i) >>> 0;
      return ("0000000" + h.toString(16)).slice(-8);
    } catch (e) {
      return "00000000";
    }
  }
  let opSeq = 0;
  function newOpId() {
    opSeq += 1;
    try {
      return Date.now().toString(36) + "-" + opSeq.toString(36);
    } catch (e) {
      return "";
    }
  }
  function phoneLog(method, kind, t0, res, err) {
    try {
      const logged = res && res.logged ? res.logged : null;
      const opId = String(logged && logged.opId || "");
      const cwdHash = logged && logged.cwd ? hash8(logged.cwd) : hash8("");
      if (err !== void 0 && err !== null) {
        if (logCtx) logCtx.fire("warn", "host.call.fail", { method, kind, errorHash: hash8(String(err && err.message || err)), opId, cwdHash });
      } else if (res && res.ok) {
        if (logCtx) logCtx.fire("info", "host.call", { method, latencyMs: Date.now() - t0, ok: true, kind, opId, cwdHash });
      } else if (logCtx) logCtx.fire("warn", "host.call.fail", { method, kind, errorHash: hash8(String(res && (res.error && res.error.message || res.error) || "map-tickets-not-ok")), opId, cwdHash });
    } catch (eL) {
    }
  }
  const unsupported = function(message, logged) {
    return { ok: false, error: { kind: "unsupported", message }, logged };
  };
  function backendLogEvent(level, event, fields) {
    try {
      if (logCtx && typeof logCtx.fire === "function") logCtx.fire(level, event, fields);
    } catch (e) {
    }
  }
  function backendLogEnabled(level) {
    try {
      return logCtx ? logCtx.isEnabled(level) : level === "error" || level === "warn";
    } catch (e) {
      return level === "error" || level === "warn";
    }
  }
  function prepareRow(raw, parseProgress) {
    const t = Object.assign({}, raw);
    if (t.key != null && t.number == null) {
      const nn = parseInt(t.key, 10);
      if (!isNaN(nn)) t.number = nn;
    }
    if (t.key != null) t.key = String(t.key);
    t.state = String(t.state || "").toUpperCase();
    if (Array.isArray(t.blockedBy)) {
      t.blockedBy = t.blockedBy.map(function(ref) {
        if (typeof ref === "number" || typeof ref === "string") return ref;
        if (ref && typeof ref === "object" && ref.key != null) return String(ref.key);
        return ref;
      });
    } else t.blockedBy = [];
    if (t.claimedBy == null) {
      const owners = t.assignees;
      t.claimedBy = Array.isArray(owners) && owners.length ? owners[0] && owners[0].login || "" : "";
    }
    const body = typeof t.body === "string" ? t.body : "";
    t.progress = typeof parseProgress === "function" ? parseProgress(body) : null;
    delete t.body;
    delete t.comments;
    return t;
  }
  async function handleMapTickets(args) {
    const opId = newOpId();
    const logged = { opId, cwd: "" };
    const _rawMapCwd = args && typeof args.cwd === "string" && args.cwd.trim() ? args.cwd : "";
    if (!_rawMapCwd) return { ok: false, error: "\u8FD9\u4E2A\u5DE5\u4F5C\u533A\u8FD8\u6CA1\u5C31\u7EEA\uFF08\u8FD8\u6CA1\u8BA4\u51FA\u662F\u54EA\u4E2A\u76EE\u5F55\uFF09\uFF0C\u7B49\u9762\u677F\u8BA4\u51FA\u5DE5\u4F5C\u533A\u540E\u518D\u8BD5\u3002", logged };
    const cwd = await canonicalKey(_rawMapCwd);
    logged.cwd = cwd;
    const key = String(args && (args.key != null ? args.key : args.number) || "").trim();
    if (!key) return { ok: false, error: { kind: "parse", message: "\u7F3A\u5C11\u5730\u56FE\u7F16\u53F7\uFF08key\uFF09" }, logged };
    const sel = await selectEarly({ cwd, backendId: args && args.backendId || void 0 });
    if (!isComposerSelection(sel)) return unsupported("\u8FD9\u4E2A\u540E\u7AEF\u4E0D\u80FD\u6309\u9700\u53D6\u4E00\u5F20\u5730\u56FE\u7684\u5B50\u7968\uFF08\u5728\u5B83\u81EA\u5DF1\u7684\u7F51\u9875\u4E0A\u770B\u5168\u90E8\uFF09", logged);
    const reg = await getTrackerRegistry();
    const backendId = sel.backendId;
    const tracker = reg.get(backendId);
    if (!tracker || typeof tracker.listSubIssues !== "function") return unsupported("\u8FD9\u4E2A\u540E\u7AEF\u4E0D\u652F\u6301\u6309\u9700\u53D6\u4E00\u5F20\u5730\u56FE\u7684\u5B50\u7968", logged);
    let repoRef = null;
    try {
      repoRef = reg.describe({ cwd }, backendId);
    } catch (e) {
      repoRef = null;
    }
    if (!repoRef) repoRef = { backend: backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || backendId, url: "" };
    if (args && args.effortId !== void 0 && args.effortId !== null) repoRef = Object.assign({}, repoRef, { effortId: String(args.effortId) });
    const ctx2 = { cwd, opId, platform: await getPlatform(), fs: ctx.get("fs"), exec: function(c, a, o) {
      return detectionExec(c, a, o, "map-tickets");
    }, logEvent: backendLogEvent, isEnabled: backendLogEnabled };
    const res = await tracker.listSubIssues(repoRef, key, {}, ctx2);
    if (!res || res.ok !== true) {
      const err = res && res.error || { kind: "network", message: "\u5B50\u7968\u6CA1\u53D6\u56DE\u6765" };
      if (err.kind === "unsupported") return unsupported("\u8FD9\u4E2A\u540E\u7AEF\u4E0D\u652F\u6301\u6309\u9700\u53D6\u4E00\u5F20\u5730\u56FE\u7684\u5B50\u7968", logged);
      return { ok: false, error: err, logged };
    }
    const d = res.data || {};
    const mb = typeof getMapBody === "function" ? await getMapBody() : null;
    const parseProgress = mb && typeof mb.parseProgress === "function" ? mb.parseProgress : null;
    const items = (Array.isArray(d.items) ? d.items : []).map(function(raw) {
      return prepareRow(raw, parseProgress);
    });
    let stats = { total: items.length, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} };
    try {
      if (typeof groupTickets === "function") stats = groupTickets(items);
    } catch (e) {
    }
    return {
      ok: true,
      key,
      items,
      stats,
      total: typeof d.total === "number" ? d.total : items.length,
      // 后端说的总数（连接上的 totalCount）
      fetched: typeof d.fetched === "number" ? d.fetched : items.length,
      // 这次真的拉回来的张数
      capped: d.capped === true,
      // 撞到 1000 张硬上限
      missing: typeof d.missing === "number" && d.missing > 0 ? d.missing : 0,
      // 与总数对不上的差额（0 = 对上了）
      // logged 只给 phoneLog 用，界面不读它：编号与目录都不该往界面上跑。
      logged
    };
  }
  const handleMapTicketsLogged = async function(args) {
    const t0 = Date.now();
    try {
      const r = await handleMapTickets(args);
      phoneLog("wf.mapTickets", "map-tickets", t0, r);
      return r;
    } catch (e) {
      phoneLog("wf.mapTickets", "map-tickets", t0, null, e);
      throw e;
    }
  };
  return { handleMapTickets: handleMapTicketsLogged };
}
export {
  createMapTickets
};
