import { NAMING_FALLBACK_INTERVAL_MS as NAMING_FALLBACK_MS, NAMING_PERSIST_DEBOUNCE_MS, NAMING_SWEEP_SOON_MS } from "../shared/time-config/values.js";
function createNamingGuardian(deps) {
  const { fs, timer, DEFAULT_CWD, getCacheDir, getPlatform, getRepoKey, runGh, logCtx, getFirstText, getTitleFact } = deps;
  let _namingCore = null;
  let _namingCoreInit = null;
  async function getNamingCore() {
    if (_namingCore) return _namingCore;
    if (!_namingCoreInit) {
      _namingCoreInit = (async function() {
        try {
          const ms = await Promise.all([import("../shared/naming-titles.js"), import("../shared/naming-tracking.js"), import("../shared/naming-attribution.js")]);
          _namingCore = Object.assign({}, ms[0], ms[1], ms[2]);
          return _namingCore;
        } catch (e) {
          return null;
        }
      })();
    }
    return _namingCoreInit;
  }
  const NAMING_STATE_FILE = "naming-guardian.json";
  let _namingState = null, _namingStateDirty = false, _namingPersistTimer = null, _namingSweepBusy = false;
  let _namingSweepTimer = null;
  let sweepAnyChanged = false, sweepAssignedTotal = 0, sweepTrigger = "event";
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
  function namingDefaultState() {
    return { version: 1, sessions: {}, indexes: {} };
  }
  async function loadNamingState() {
    if (_namingState) return _namingState;
    _namingState = namingDefaultState();
    try {
      if (fs !== void 0 && typeof fs.readText === "function" && typeof fs.resolve === "function") {
        const dir = await getCacheDir();
        if (dir) {
          const platform2 = await getPlatform();
          const t = await platform2.fs.resolve(platform2.path.join(dir, NAMING_STATE_FILE));
          const txt = await fs.readText(t);
          if (txt) {
            const j = JSON.parse(txt);
            if (j && j.version === 1 && j.sessions && typeof j.sessions === "object") {
              _namingState = j;
              if (!_namingState.sessions) _namingState.sessions = {};
              if (!_namingState.indexes || typeof _namingState.indexes !== "object") _namingState.indexes = {};
            }
          }
        }
      }
    } catch (eLoad) {
    }
    return _namingState;
  }
  async function persistNamingState() {
    _namingStateDirty = false;
    try {
      if (fs === void 0 || typeof fs.writeText !== "function" || typeof fs.resolve !== "function") return;
      const dir = await getCacheDir();
      if (!dir) return;
      const platform2 = await getPlatform();
      const t = await platform2.fs.resolve(platform2.path.join(dir, NAMING_STATE_FILE));
      await fs.writeText(t, JSON.stringify(_namingState || namingDefaultState()));
    } catch (ePersist) {
    }
  }
  function markNamingStateDirty() {
    _namingStateDirty = true;
    if (_namingPersistTimer) return;
    _namingPersistTimer = timer.timeout(function() {
      _namingPersistTimer = null;
      if (_namingStateDirty) persistNamingState();
    }, NAMING_PERSIST_DEBOUNCE_MS);
    try {
      if (logCtx && logCtx.isEnabled("debug")) logCtx.fire("debug", "timer.schedule", { name: "naming-persist", intervalMs: NAMING_PERSIST_DEBOUNCE_MS });
    } catch (eL) {
    }
  }
  let _namingFallbackAt = 0, _namingSweepCursor = 0;
  function namingGuardianEvent(reason, booting) {
    if (booting) {
      try {
        if (typeof globalThis !== "undefined" && globalThis.__dswsNamingGuardianLoop) {
          clearTimeout(globalThis.__dswsNamingGuardianLoop);
          globalThis.__dswsNamingGuardianLoop = null;
        }
      } catch (eG) {
      }
      ;
      try {
        if (_namingStateDirty) persistNamingState();
      } catch (eInit) {
      }
    }
    namingSweepSoon(0, { trigger: String(reason || "event") });
    const now = Date.now();
    if (_namingFallbackAt > 0 && now - _namingFallbackAt < NAMING_FALLBACK_MS) return;
    _namingFallbackAt = now;
    try {
      namingSweepNow({ oneRepo: true, trigger: "fallback" });
    } catch (eF) {
    }
  }
  function startNamingGuardianEvents() {
    namingGuardianEvent("apply-start", true);
  }
  function namingRepoKeyOf(args) {
    if (!args) return null;
    let rk = args.repoKey;
    if (rk && typeof rk === "object") {
      const o = rk.owner || rk.login;
      const n = rk.name || rk.repo;
      rk = o && n ? String(o) + "/" + String(n) : null;
    }
    if (typeof rk === "string" && rk.indexOf("/") > 0) return rk;
    return null;
  }
  async function namingResolveRepoKey(cwd) {
    try {
      const repo = await getRepoKey(cwd || DEFAULT_CWD);
      if (repo && repo.owner && repo.name) return repo.owner + "/" + repo.name;
    } catch (e) {
    }
    return null;
  }
  async function namingFetchIndex(repoKey, cwd) {
    try {
      const url = "repos/" + repoKey + "/issues?state=all&per_page=100";
      const r = await runGh(["api", "--paginate", url, "--jq", ".[] | select(.pull_request == null) | {number: .number, title: .title, state: .state, updatedAt: .updated_at}"], cwd);
      if (!r.ok) return { ok: false, error: r };
      const index = {};
      const lines = String(r.text || "").split(/\r?\n/).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        try {
          const item = JSON.parse(lines[i]);
          if (item && item.number !== void 0 && item.number !== null) {
            index[String(item.number)] = { title: String(item.title || ""), state: String(item.state || "").toUpperCase(), updatedAt: String(item.updatedAt || "") };
          }
        } catch (eLine) {
        }
      }
      return { ok: true, index };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }
  function keepRelatedAssigned(list, core, sessions) {
    if (!list.length || !core.isHintRelatedToTitle) return list;
    return list.filter(function(a) {
      const e = sessions[a.sessionId];
      if (!e || !e.hint) return true;
      try {
        return core.isHintRelatedToTitle(e.hint, a.title);
      } catch (eRel) {
        return true;
      }
    });
  }
  async function namingSweepNow(opts) {
    if (_namingSweepBusy) return;
    _namingSweepBusy = true;
    try {
      const core = await getNamingCore();
      if (!core) return;
      const st = await loadNamingState();
      const byRepo = {};
      for (const sid in st.sessions) {
        const s = st.sessions[sid];
        if (!s || !s.repoKey) continue;
        if (!core.isNumberAwaitStage(s)) continue;
        if (!byRepo[s.repoKey]) byRepo[s.repoKey] = { sessions: [], cwd: s.cwd || DEFAULT_CWD };
        byRepo[s.repoKey].sessions.push(s);
      }
      let repoNames = Object.keys(byRepo);
      if (opts && opts.oneRepo && repoNames.length) {
        repoNames = [repoNames[_namingSweepCursor % repoNames.length]];
        _namingSweepCursor += 1;
      }
      for (let ri = 0; ri < repoNames.length; ri++) {
        const repoKey = repoNames[ri];
        const grp = byRepo[repoKey];
        const r = await namingFetchIndex(repoKey, grp.cwd);
        if (!r.ok) continue;
        const prev = st.indexes && st.indexes[repoKey] || null;
        let assigned = [];
        try {
          if (prev) assigned = core.attributeNewNumbers({ prevIndex: prev, currIndex: r.index, sessions: grp.sessions });
        } catch (eA) {
          assigned = [];
        }
        try {
          assigned = keepRelatedAssigned(assigned, core, st.sessions);
        } catch (eFilter) {
        }
        try {
          if (grp.sessions.length > 1 && r.index) {
            assigned = assigned.filter(function(a) {
              if (!a) return false;
              const info = r.index[String(a.number)];
              return !!(info && typeof info === "object" && info.title);
            });
          }
        } catch (eStrict) {
        }
        let changed = false;
        for (let i = 0; i < assigned.length; i++) {
          const a = assigned[i];
          const entry = st.sessions[a.sessionId];
          if (!entry) continue;
          const next = core.reduceTrackingState(entry, { type: "numbered", number: a.number, title: a.title });
          if (next !== entry) {
            st.sessions[a.sessionId] = next;
            changed = true;
          }
        }
        if (!st.indexes) st.indexes = {};
        try {
          let newNums = [];
          try {
            newNums = prev && core.newNumbersSince ? core.newNumbersSince(prev, r.index) : [];
          } catch (eN) {
            newNums = [];
          }
          const got = {};
          for (let gi = 0; gi < assigned.length; gi++) {
            if (assigned[gi] != null) got[String(assigned[gi].number)] = true;
          }
          const held = [];
          for (let ni = 0; ni < newNums.length; ni++) {
            const k = String(newNums[ni]);
            if (!got[k]) held.push(k);
          }
          if (held.length) {
            if (!st.indexRetry || typeof st.indexRetry !== "object") st.indexRetry = {};
            if (!st.indexRetry[repoKey] || typeof st.indexRetry[repoKey] !== "object") st.indexRetry[repoKey] = {};
            const retry = st.indexRetry[repoKey];
            const kept = {};
            for (let hi = 0; hi < held.length; hi++) {
              const k = held[hi];
              const tries = (Number(retry[k]) || 0) + 1;
              if (tries <= 5) {
                retry[k] = tries;
                kept[k] = true;
              } else {
                try {
                  delete retry[k];
                } catch (eD) {
                }
              }
            }
            if (Object.keys(kept).length) {
              const heldBack = {};
              for (const k of Object.keys(r.index)) {
                if (!kept[k]) heldBack[k] = r.index[k];
              }
              st.indexes[repoKey] = heldBack;
              markNamingStateDirty();
            } else {
              st.indexes[repoKey] = r.index;
            }
          } else {
            try {
              if (st.indexRetry && st.indexRetry[repoKey]) delete st.indexRetry[repoKey];
            } catch (eC) {
            }
            st.indexes[repoKey] = r.index;
          }
        } catch (eBase) {
          try {
            st.indexes[repoKey] = r.index;
          } catch (eB2) {
          }
        }
        if (changed) {
          await persistNamingState();
          sweepAnyChanged = sweepAnyChanged || changed;
          sweepAssignedTotal += assigned.length;
        } else markNamingStateDirty();
      }
      try {
        const trig = sweepTrigger, cnt = sweepAssignedTotal, chg = sweepAnyChanged;
        sweepTrigger = "tick";
        sweepAnyChanged = false;
        sweepAssignedTotal = 0;
        if (chg && logCtx && logCtx.isEnabled("debug")) logCtx.fire("debug", "naming.sweep", { trigger: trig, count: cnt });
      } catch (eL) {
      }
    } catch (eSweep) {
    } finally {
      _namingSweepBusy = false;
    }
  }
  function namingSweepSoon(delayMs, opts) {
    const delay = typeof delayMs === "number" ? delayMs : NAMING_SWEEP_SOON_MS;
    if (_namingSweepTimer) {
      try {
        if (logCtx && logCtx.isEnabled("debug")) logCtx.fire("debug", "timer.schedule", { name: "naming-sweep", intervalMs: delay });
      } catch (eL) {
      }
      ;
      return;
    }
    _namingSweepTimer = timer.timeout(function() {
      _namingSweepTimer = null;
      try {
        sweepTrigger = opts && opts.trigger || "soon";
        namingSweepNow(opts);
      } catch (e) {
      }
    }, delay);
  }
  async function namingEnsureTracked(args) {
    const sid = args && args.sessionId, baseline = args && args.baselineTitle;
    if (!sid || !baseline) return { ok: false, error: { kind: "parse", message: "\u7F3A\u5C11 sessionId/baselineTitle" } };
    const core = await getNamingCore();
    if (!core) return { ok: false, error: { kind: "parse", message: "\u547D\u540D\u6838\u5FC3\u672A\u5C31\u7EEA" } };
    const numbered = core.parseNumberedTitle ? core.parseNumberedTitle(baseline) : null;
    if (!core.isPlaceholderTitle(baseline) && !numbered) return { ok: false, error: { kind: "parse", message: "baselineTitle \u975E\u5360\u4F4D\u56DB\u5F0F\u6216\u7F16\u53F7\u6863" } };
    if (numbered && !(isFinite(numbered.number) && numbered.number >= 0)) return { ok: false, error: { kind: "parse", message: "\u7F16\u53F7\u6863\u7F16\u53F7\u975E\u6CD5" } };
    const wroteOurs = !(args && args.wroteTitle === false);
    const cwd = args && args.cwd || DEFAULT_CWD;
    let repoKey = namingRepoKeyOf(args);
    if (!repoKey) repoKey = await namingResolveRepoKey(cwd);
    const st = await loadNamingState(), entry = st.sessions[sid];
    if (!entry) {
      st.sessions[sid] = core.createTrackingState({ sessionId: sid, baselineTitle: baseline, repoKey, cwd, baselineIsOurs: wroteOurs });
      if (numbered) st.sessions[sid] = core.reduceTrackingState(st.sessions[sid], { type: "numbered", number: numbered.number, numberText: numbered.numberText, title: numbered.title });
    } else if (numbered && !entry.locked && (Number(entry.number) !== numbered.number || String(entry.baselineTitle) !== String(baseline))) {
      entry.stage = core.NAMING_STAGES.NUMBERED;
      entry.number = numbered.number;
      entry.numberText = numbered.numberText;
      entry.numberTitle = numbered.title;
      entry.baselineTitle = baseline;
      entry.baselineIsOurs = wroteOurs;
      entry.lastMachineTitle = null;
      entry.numberedDone = false;
      entry.hint = null;
      entry.lastDraftHint = null;
    } else if (entry.repoKey == null && repoKey) {
      entry.repoKey = repoKey;
    }
    if (args && args.hint) st.sessions[sid] = core.reduceTrackingState(st.sessions[sid], { type: "signal", hint: String(args.hint).slice(0, 80) });
    await persistNamingState();
    namingSweepSoon(800);
    return { ok: true };
  }
  const namingRegisterHandler = function(args) {
    return namingEnsureTracked(args);
  };
  async function handleNamingSignal(args) {
    const sid = args && args.sessionId, hint = args && args.hint;
    if (!sid || !hint) return { ok: true, tracked: false };
    const st = await loadNamingState(), entry = st.sessions[sid];
    if (!entry) return { ok: true, tracked: false };
    const core = await getNamingCore();
    if (!core) return { ok: true };
    if (!entry.locked) {
      st.sessions[sid] = core.reduceTrackingState(entry, { type: "signal", hint: String(hint).slice(0, 80) });
      markNamingStateDirty();
    }
    return { ok: true, tracked: true };
  }
  let _namingPlanBusy = false;
  async function handleNamingPlan() {
    if (_namingPlanBusy) return { ok: true, orders: [], tracked: [], failures: [] };
    _namingPlanBusy = true;
    try {
      return await namingPlanOnce();
    } finally {
      _namingPlanBusy = false;
    }
  }
  async function namingPlanOnce() {
    try {
      namingGuardianEvent("client-pull");
    } catch (eEv) {
    }
    const core = await getNamingCore();
    if (!core) return { ok: true, orders: [], tracked: [], failures: [] };
    const st = await loadNamingState();
    const orders = [], tracked = [], failures = [];
    for (const sid in st.sessions) {
      const s = st.sessions[sid];
      if (!s) continue;
      let curTitle = null;
      try {
        if (typeof getTitle === "function") curTitle = await getTitle(sid);
      } catch (eT) {
      }
      const o = core.planOrderFor(s, Date.now(), core.NAMING_HINT_GRACE_MS, curTitle);
      if (o) orders.push(o);
      let done = !!s.locked || s.stage === core.NAMING_STAGES.REFINED;
      if (!done && s.stage === core.NAMING_STAGES.NUMBERED && s.number != null) {
        done = !!s.numberedDone;
        if (!done) {
          try {
            done = s.lastMachineTitle != null && s.lastMachineTitle === core.newSessionTitle({ number: s.number, numberText: s.numberText, title: s.numberTitle || "" });
          } catch (eD) {
          }
        }
      }
      tracked.push({ sessionId: sid, stage: s.stage, done });
      try {
        if (!done && s.stage === core.NAMING_STAGES.NUMBERED && s.number != null && !s.numberedDone && !s.locked) {
          let want = null;
          try {
            want = core.newSessionTitle({ number: s.number, numberText: s.numberText, title: s.numberTitle || "" });
          } catch (eW) {
          }
          if (want && curTitle === want) {
            st.sessions[sid] = core.reduceTrackingState(s, { type: "renamed", title: curTitle });
            markNamingStateDirty();
            done = true;
            tracked[tracked.length - 1].done = true;
          }
        }
      } catch (eConv) {
      }
      const fi = core.namingFailureInfo(s);
      if (fi) failures.push(fi);
    }
    try {
      const byRepoHasHint = {};
      for (let i = 0; i < orders.length; i++) {
        const o = orders[i];
        if (o && o.kind === "draft" && o.hint) {
          const so = st.sessions[o.sessionId];
          const rk = so && so.repoKey;
          if (rk) byRepoHasHint[rk] = true;
        }
      }
      if (Object.keys(byRepoHasHint).length) {
        const kept = [];
        for (let i = 0; i < orders.length; i++) {
          const o = orders[i];
          if (o && o.kind === "draft" && !o.hint) {
            const so = st.sessions[o.sessionId];
            const rk = so && so.repoKey;
            if (rk && byRepoHasHint[rk]) continue;
          }
          kept.push(o);
        }
        orders.length = 0;
        for (let i = 0; i < kept.length; i++) orders.push(kept[i]);
      }
    } catch (eFilter) {
    }
    for (let i = 0; i < orders.length; i++) {
      const oo = orders[i];
      if (!oo || !oo.lock) continue;
      try {
        if (typeof getFirstText === "function") oo.lock.firstUserText = await getFirstText(oo.sessionId);
      } catch (eFt) {
      }
      try {
        if (typeof getTitleFact === "function") oo.lock.titleSource = await getTitleFact(oo.sessionId);
      } catch (eTf) {
      }
    }
    return { ok: true, orders, tracked, failures };
  }
  async function handleNamingResult(args) {
    const sid = args && args.sessionId, outcome = args && args.outcome;
    if (!sid || !outcome) return { ok: false, error: { kind: "parse", message: "\u7F3A\u5C11 sessionId/outcome" } };
    const st = await loadNamingState(), entry = st.sessions[sid];
    if (!entry) return { ok: true };
    const core = await getNamingCore();
    if (!core) return { ok: true };
    if (outcome === "renamed" && args.title) {
      st.sessions[sid] = core.reduceTrackingState(entry, { type: "renamed", title: String(args.title) });
      await persistNamingState();
      return { ok: true };
    }
    if (outcome === "locked") {
      st.sessions[sid] = core.reduceTrackingState(entry, { type: "locked" });
      try {
        if (logCtx) logCtx.fire("info", "naming.lock", { sidHash: hash8(sid), reason: String(args && args.reason || "hand-edit").slice(0, 40) });
      } catch (eL) {
      }
      await persistNamingState();
      return { ok: true };
    }
    if (outcome === "failed") {
      const next = core.reduceTrackingState(entry, { type: "renameFailed", error: args.error });
      st.sessions[sid] = next;
      await persistNamingState();
      return { ok: true, exhausted: !!core.namingFailureInfo(next) };
    }
    return { ok: true };
  }
  async function getEntry(sid) {
    try {
      const st = await loadNamingState();
      const s = st.sessions[sid];
      return s ? Object.assign({}, s) : null;
    } catch (e) {
      return null;
    }
  }
  async function applySummaryResult(args) {
    const sid = args && args.sessionId;
    if (!sid) return { ok: false };
    const st = await loadNamingState(), entry = st.sessions[sid];
    if (!entry || entry.locked) return { ok: true };
    const core = await getNamingCore();
    if (!core) return { ok: true };
    if (args.ok && args.hint) st.sessions[sid] = core.reduceTrackingState(core.reduceTrackingState(entry, { type: "signal", hint: String(args.hint).slice(0, 80) }), { type: "summaryDone" });
    else st.sessions[sid] = core.reduceTrackingState(entry, { type: "summaryFailed" });
    await persistNamingState();
    return { ok: true };
  }
  async function handleDirectCreated(args) {
    const sid = args && args.sessionId, num = Number(args && args.key);
    if (!sid || !isFinite(num) || num < 0) return { ok: false };
    const st = await loadNamingState(), entry = st.sessions[sid];
    const core = await getNamingCore();
    if (!entry || !core || !core.isNumberAwaitStage(entry)) return { ok: true, attributed: false };
    st.sessions[sid] = core.reduceTrackingState(entry, { type: "numbered", number: num, numberText: String((args && args.key) != null ? args.key : num).slice(0, 20), title: args.title });
    await persistNamingState();
    try {
      if (logCtx && logCtx.isEnabled("debug")) logCtx.fire("debug", "naming.sweep", { trigger: "direct-created", count: 1 });
    } catch (eL) {
    }
    return { ok: true, attributed: true };
  }
  async function handleCancelNewSessionWatcher(args) {
    const sid = args && args.sessionId;
    if (!sid) return { ok: false, error: { kind: "parse", message: "\u7F3A\u5C11 sessionId" } };
    const st = await loadNamingState();
    if (!st.sessions[sid]) return { ok: true, cancelled: false };
    delete st.sessions[sid];
    await persistNamingState();
    return { ok: true, cancelled: true };
  }
  async function handleAwaitCreatedIssue(args) {
    const sid = args && args.sessionId;
    if (!sid) return { ok: false, error: { kind: "parse", message: "\u7F3A\u5C11 sessionId" } };
    const core = await getNamingCore();
    const st = await loadNamingState(), entry = st.sessions[sid];
    const watching = !!(core && entry && core.isNumberAwaitStage(entry));
    if (watching) namingSweepSoon(120);
    return { ok: true, watching, stage: entry && entry.stage || null };
  }
  function phoneLog(method, kind, level, t0, res, err) {
    try {
      if (err !== void 0 && err !== null) {
        if (logCtx) logCtx.fire("warn", "host.call.fail", { method, kind, errorHash: hash8(String(err && err.message || err)) });
      } else if (res && res.ok) {
        if (level === "debug") {
          if (logCtx && logCtx.isEnabled("debug")) logCtx.fire("debug", "host.call", { method, latencyMs: Date.now() - t0, ok: true, kind });
        } else if (logCtx) logCtx.fire("info", "host.call", { method, latencyMs: Date.now() - t0, ok: true, kind });
      } else if (logCtx) logCtx.fire("warn", "host.call.fail", { method, kind, errorHash: hash8(String(res && (res.error && res.error.message || res.error) || "naming-not-ok")) });
    } catch (eL) {
    }
  }
  function loggedPhone(method, kind, level, fn) {
    return async function() {
      const t0 = Date.now();
      try {
        const r = await fn.apply(null, arguments);
        phoneLog(method, kind, level, t0, r);
        return r;
      } catch (e) {
        phoneLog(method, kind, level, t0, null, e);
        throw e;
      }
    };
  }
  return { namingSweepSoon, namingRegisterHandler: loggedPhone("wf.registerNewSessionWatcher", "naming-register", "info", namingRegisterHandler), handleNamingSignal: loggedPhone("wf.namingSignal", "naming-signal", "info", handleNamingSignal), handleNamingPlan: loggedPhone("wf.namingPlan", "naming-plan", "debug", handleNamingPlan), handleNamingResult: loggedPhone("wf.namingResult", "naming-result", "info", handleNamingResult), handleCancelNewSessionWatcher: loggedPhone("wf.cancelNewSessionWatcher", "naming-cancel", "info", handleCancelNewSessionWatcher), handleAwaitCreatedIssue: loggedPhone("wf.awaitCreatedIssue", "naming-await", "info", handleAwaitCreatedIssue), getEntry, applySummaryResult, handleDirectCreated, namingGuardianEvent, startNamingGuardianEvents };
}
export {
  createNamingGuardian
};
