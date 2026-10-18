import { resolveSessionCwd } from "../shared/session-cwd.js";
function createSessionLifecycle(deps) {
  const { ctx, DEFAULT_CWD, errText, getDetectionService, getTrackerRegistry, getPlatform, canonicalKey, logCtx } = deps;
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
  async function handlePing() {
    return { ok: true, ts: Date.now() };
  }
  const diskCache = /* @__PURE__ */ new Map();
  const diskInflight = /* @__PURE__ */ new Map();
  const DISK_CACHE_MAX = 2e3;
  function diskCacheGet(sid) {
    try {
      return diskCache.get(String(sid));
    } catch (e) {
      return void 0;
    }
  }
  function diskCacheSet(sid, cwd) {
    try {
      const k = String(sid);
      if (diskCache.has(k)) diskCache.delete(k);
      diskCache.set(k, cwd);
      while (diskCache.size > DISK_CACHE_MAX) diskCache.delete(diskCache.keys().next().value);
    } catch (e) {
    }
  }
  function emitDiskLog(row) {
    try {
      if (logCtx && typeof logCtx.fire === "function") logCtx.fire("info", "cwd.persisted", row);
    } catch (e) {
    }
  }
  function isNotFoundErr(e) {
    try {
      if (!e) return false;
      if (e.name === "SessionPersistenceNotFoundError") return true;
      const code = e.code || e.errorKind;
      if (code === "SESSION_QUERY_SESSION_NOT_FOUND") return true;
      return /not found/i.test(String(e && e.message || e));
    } catch (err) {
      return false;
    }
  }
  async function readDiskOnce(sid) {
    const key = String(sid);
    try {
      let ps = null;
      try {
        ps = ctx.get("sessionPersistence");
      } catch (e) {
        ps = null;
      }
      if (ps && typeof ps.open === "function") {
        let handle = null;
        try {
          handle = await ps.open(key, "read");
          const header = handle && handle.header;
          const cwd = resolveSessionCwd({ header });
          if (cwd) {
            diskCacheSet(key, cwd);
            return { cwd, via: "persist-open", outcome: "hit" };
          }
          return { cwd: "", via: "persist-open", outcome: "not-found" };
        } catch (e) {
          return { cwd: "", via: "persist-open", outcome: isNotFoundErr(e) ? "not-found" : "error" };
        } finally {
          try {
            if (handle && typeof handle.close === "function") await handle.close();
          } catch (eC) {
          }
        }
      }
    } catch (eOuter) {
    }
    try {
      const q = ctx.get("sessionQuery");
      if (!q || typeof q.filterSessions !== "function") return { cwd: "", via: "unavailable", outcome: "no-service" };
      const records = await q.filterSessions([{ kind: "id", values: [key] }]);
      if (!Array.isArray(records)) return { cwd: "", via: "query-filter", outcome: "error" };
      for (const rec of records) {
        const cwd = resolveSessionCwd(rec);
        if (cwd) {
          diskCacheSet(key, cwd);
          return { cwd, via: "query-filter", outcome: "hit" };
        }
      }
      return { cwd: "", via: "query-filter", outcome: "not-found" };
    } catch (e) {
    }
    return { cwd: "", via: "query-filter", outcome: "error" };
  }
  async function persistedCwdOf(sid) {
    const key = String(sid);
    const t0 = Date.now();
    try {
      const cached = diskCacheGet(key);
      if (typeof cached === "string" && cached) {
        emitDiskLog({ hit: true, latencyMs: Date.now() - t0, via: "cache", outcome: "hit" });
        return cached;
      }
    } catch (e) {
    }
    try {
      let p = null;
      try {
        p = diskInflight.get(key);
      } catch (e) {
        p = null;
      }
      if (!p) {
        p = readDiskOnce(key).catch(function() {
          return { cwd: "", via: "persist-open", outcome: "error" };
        });
        try {
          diskInflight.set(key, p);
        } catch (e) {
        }
        const drop = function() {
          try {
            if (diskInflight.get(key) === p) diskInflight.delete(key);
          } catch (e) {
          }
        };
        p.then(drop, drop);
      }
      const r = await p;
      const cwd = r && typeof r.cwd === "string" ? r.cwd : "";
      emitDiskLog({ hit: cwd !== "", latencyMs: Date.now() - t0, via: r && r.via || "persist-open", outcome: r && r.outcome || (cwd ? "hit" : "not-found") });
      return cwd;
    } catch (e) {
    }
    return "";
  }
  async function handleCwd(args) {
    const sid = args && args.sessionId;
    if (!sid) return { ok: false, error: "\u7F3A\u5C11 sessionId", kind: "no-sid" };
    const sessions = ctx.get("sessions");
    if (sessions === void 0 || typeof sessions.get !== "function") return { ok: false, error: "sessions \u670D\u52A1\u4E0D\u53EF\u7528", kind: "no-service" };
    let liveMissing = false;
    try {
      const s = sessions.get(sid);
      if (!s) liveMissing = true;
      else {
        const cwd = resolveSessionCwd(s);
        if (cwd) return await withRoot({ ok: true, cwd }, cwd);
      }
    } catch (e) {
      return { ok: false, error: errText(e) };
    }
    const fromDisk = await persistedCwdOf(sid);
    if (fromDisk) return await withRoot({ ok: true, cwd: fromDisk }, fromDisk);
    if (liveMissing) return { ok: false, error: "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4F1A\u8BDD", kind: "not-found" };
    return { ok: false, error: "\u4F1A\u8BDD\u65E0 cwd \u4FE1\u606F", kind: "no-cwd" };
  }
  async function withRoot(res, rawCwd) {
    try {
      if (typeof canonicalKey !== "function") return res;
      const root = await canonicalKey(rawCwd);
      if (typeof root === "string" && root) res.workspaceRoot = root;
    } catch (e) {
    }
    return res;
  }
  async function selectEarly(selCtx) {
    const cwd = selCtx.cwd;
    let sel = null;
    let svcSaid = false;
    let why = "";
    let errHash = "";
    try {
      const svc = await getDetectionService();
      if (svc && typeof svc.detect === "function") {
        const det = await svc.detect({ cwd }, { skipSkillProbes: true });
        if (det && det.selection) {
          sel = det.selection;
          svcSaid = true;
        } else why = "service-no-selection";
      } else why = "service-missing";
    } catch (eSvc) {
      why = "service-threw";
      try {
        errHash = hash8(String(eSvc && eSvc.message || eSvc));
      } catch (eH) {
      }
    }
    if (!svcSaid) {
      const t1 = Date.now();
      try {
        const regTmp = await getTrackerRegistry();
        const tmpHandle = { cwd };
        const tmpCtx = { cwd, platform: await getPlatform(), fs: ctx.get("fs"), caller: "snapshot-early" };
        const sel2 = await regTmp.select(tmpHandle, tmpCtx);
        if (sel2) sel = sel2;
      } catch (eReg) {
        why = (why || "service-threw") + "+registry-threw";
        try {
          errHash = hash8(String(eReg && eReg.message || eReg));
        } catch (eH2) {
        }
      }
      try {
        if (logCtx && typeof logCtx.fire === "function" && typeof logCtx.isEnabled === "function" && logCtx.isEnabled("debug")) {
          logCtx.fire("debug", "detection.fallback", { cwdHash: hash8(cwd), backendId: String(sel && sel.backendId || ""), source: String(sel && sel.source || ""), pending: !!(sel && sel.pending), why: why || "service-no-selection", errorHash: errHash, latencyMs: Date.now() - t1 });
        }
      } catch (eL) {
      }
    }
    return sel;
  }
  function isComposerSelection(sel) {
    return !!(sel && sel.backendId && sel.backendId !== "github" && sel.backendId !== "" && sel.backendId !== "other");
  }
  function phoneLog(method, kind, t0, res, err) {
    try {
      if (err !== void 0 && err !== null) {
        if (logCtx) logCtx.fire("warn", "host.call.fail", { method, kind, errorHash: hash8(String(err && err.message || err)) });
      } else if (res && res.ok) {
        if (logCtx) logCtx.fire("info", "host.call", { method, latencyMs: Date.now() - t0, ok: true, kind });
      } else if (logCtx) logCtx.fire("warn", "host.call.fail", { method, kind, errorHash: hash8(String(res && (res.error || res.errorKind) || "cwd-not-ok")) });
    } catch (eL) {
    }
  }
  function loggedPhone(method, kind, fn) {
    return async function() {
      const t0 = Date.now();
      try {
        const r = await fn.apply(null, arguments);
        phoneLog(method, kind, t0, r);
        return r;
      } catch (e) {
        phoneLog(method, kind, t0, null, e);
        throw e;
      }
    };
  }
  return { handlePing, handleCwd: loggedPhone("wf.cwd", "cwd", handleCwd), selectEarly, isComposerSelection };
}
export {
  createSessionLifecycle
};
