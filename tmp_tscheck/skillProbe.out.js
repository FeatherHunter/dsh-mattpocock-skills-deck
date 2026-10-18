import { isSkillCardValid, probeFsExists, directSkillCardRead, directPathExists, findProjectRootDir, probeCardViaFs, probeCardViaDirect, evidenceSummary, lightProbeReason } from "../shared/skill-probe-channels.js";
import { SKILL_LIST_CACHE_TTL_MS } from "../shared/time-config/values.js";
function createSkillProbe(deps) {
  const { ctx, getPlatform, getWorkspaceStore, resetChainCache, resetChainCacheForKey, logCtx } = deps;
  function hash8(s) {
    try {
      const t = String(s || "");
      let h = 5381;
      for (let i = 0; i < t.length; i++) h = (h << 5) + h + t.charCodeAt(i) >>> 0;
      return ("0000000" + h.toString(16)).slice(-8);
    } catch {
      return "00000000";
    }
  }
  const SKILL_CACHE_TTL_MS = deps && typeof deps.skillCacheTtlMs === "number" && deps.skillCacheTtlMs > 0 ? deps.skillCacheTtlMs : SKILL_LIST_CACHE_TTL_MS;
  const SKILL_CACHE_MAX = 200;
  const skillResultCache = /* @__PURE__ */ new Map();
  const skillProbeInflight = /* @__PURE__ */ new Map();
  function skillCacheKeyOf(skillName, lang, cwd) {
    return String(cwd || "") + "|" + String(lang || "zh") + "|" + String(skillName || "");
  }
  function readSkillCache(key) {
    try {
      const entry = skillResultCache.get(key);
      if (!entry) return null;
      if (Date.now() - entry.at >= SKILL_CACHE_TTL_MS) {
        try {
          skillResultCache.delete(key);
        } catch {
        }
        return null;
      }
      return entry.result || null;
    } catch {
      return null;
    }
  }
  function writeSkillCache(key, result) {
    try {
      if (!result || result.level !== "ok") return;
      if (skillResultCache.has(key)) skillResultCache.delete(key);
      skillResultCache.set(key, { result, at: Date.now() });
      while (skillResultCache.size > SKILL_CACHE_MAX) skillResultCache.delete(skillResultCache.keys().next().value);
    } catch {
    }
  }
  function clearSkillResultCache(scopeKey) {
    try {
      if (scopeKey) {
        const prefix = String(scopeKey) + "|";
        for (const k of Array.from(skillResultCache.keys())) {
          if (k === scopeKey || k.indexOf(prefix) === 0) skillResultCache.delete(k);
        }
        return;
      }
      skillResultCache.clear();
    } catch {
    }
  }
  function scopeKeyOf(scope) {
    try {
      if (typeof scope === "string") {
        const t = scope.trim();
        return t ? t : null;
      }
      if (scope && typeof scope === "object") {
        const cand = scope.cwd || scope.workspaceKey || scope.workspaceRoot || scope.key;
        if (typeof cand === "string" && cand.trim()) return cand.trim();
      }
      return null;
    } catch {
      return null;
    }
  }
  const SKILL_INSTALL_URL = "https://github.com/mattpocock/skills";
  const SKILL_PENDING_MAX = 3;
  const SKILL_PENDING_HINT_PREFIX = "pending:skills-unavailable";
  const skillPendingState = {};
  let _skillsInvalidateSub = null;
  function getOrCreatePendingState(name) {
    const k = String(name || "");
    if (!skillPendingState[k]) skillPendingState[k] = { attempts: 0, lastError: null };
    return skillPendingState[k];
  }
  function resetSkillPendingState(name) {
    if (name) delete skillPendingState[String(name)];
    else for (const k in skillPendingState) delete skillPendingState[k];
  }
  function invalidateSkillProbeCaches(scope) {
    resetSkillPendingState();
    const scopeKey = scopeKeyOf(scope);
    clearSkillResultCache(scopeKey);
    try {
      if (scopeKey && typeof resetChainCacheForKey === "function") resetChainCacheForKey(scopeKey);
      else resetChainCache();
    } catch {
    }
    try {
      getWorkspaceStore().then(function(ws) {
        try {
          if (scopeKey && ws && typeof ws.invalidate === "function") ws.invalidate({ cwd: scopeKey });
          else if (ws && typeof ws.clear === "function") ws.clear();
        } catch {
        }
      }).catch(function() {
      });
    } catch {
    }
  }
  function ensureSkillsInvalidateSubscription() {
    if (_skillsInvalidateSub) return;
    try {
      const skills = ctx.get("skills");
      if (!skills) return;
      let off = null;
      if (typeof skills.onDidInvalidate === "function") {
        off = skills.onDidInvalidate((detail) => {
          invalidateSkillProbeCaches(detail);
        });
        _skillsInvalidateSub = off;
      } else if (typeof skills.on === "function") {
        const handler = (detail) => {
          invalidateSkillProbeCaches(detail);
        };
        try {
          skills.on("invalidate", handler);
          _skillsInvalidateSub = () => {
            try {
              skills.off && skills.off("invalidate", handler);
            } catch {
            }
          };
        } catch {
        }
        if (!_skillsInvalidateSub) {
          try {
            skills.on("didInvalidate", handler);
            _skillsInvalidateSub = () => {
              try {
                skills.off && skills.off("didInvalidate", handler);
              } catch {
              }
            };
          } catch {
          }
        }
      } else if (typeof skills.subscribe === "function") {
        try {
          off = skills.subscribe((detail) => {
            invalidateSkillProbeCaches(detail);
          });
          _skillsInvalidateSub = off;
        } catch {
        }
      }
      if (_skillsInvalidateSub) {
        try {
          ctx.effect(() => () => {
            try {
              if (typeof _skillsInvalidateSub === "function") _skillsInvalidateSub();
            } catch {
            }
            _skillsInvalidateSub = null;
          });
        } catch {
        }
      }
    } catch {
    }
  }
  async function probeSkill(skillName, lang, cwd, opts) {
    const force = !!(opts && opts.force);
    const cacheKey = skillCacheKeyOf(skillName, lang, cwd);
    if (!force) {
      const remembered = readSkillCache(cacheKey);
      if (remembered) {
        const hit = Object.assign({}, remembered, { via: "cache" });
        emitSkillProbeLog(skillName, hit);
        return hit;
      }
    }
    const ongoing = skillProbeInflight.get(cacheKey);
    if (ongoing) {
      try {
        if (logCtx && logCtx.isEnabled("debug")) logCtx.fire("debug", "dedup.hit", function() {
          return { scope: "skill", keyHash: hash8(cacheKey) };
        });
      } catch (eL) {
      }
      const shared = await ongoing;
      emitSkillProbeLog(skillName, shared);
      return shared;
    }
    const pending = (async function() {
      try {
        const fresh = await probeSkillInner(skillName, lang, cwd);
        writeSkillCache(cacheKey, fresh);
        return fresh;
      } finally {
        try {
          if (skillProbeInflight.get(cacheKey) === pending) skillProbeInflight.delete(cacheKey);
        } catch {
        }
      }
    })();
    try {
      skillProbeInflight.set(cacheKey, pending);
    } catch {
    }
    const res = await pending;
    emitSkillProbeLog(skillName, res);
    return res;
  }
  function emitSkillProbeLog(skillName, res) {
    try {
      if (logCtx) {
        const via = String(res && res.via || (res && res.level === "ok" ? "registry" : res && (res.pending || res.level === "pending") ? "registry" : "multi"));
        logCtx.fire("info", "skill.probe", { name: String(skillName || ""), level: String(res && res.level || "bad"), via });
        try {
          const st = getOrCreatePendingState(skillName);
          if (res && res.level === "bad" && st && st.attempts > SKILL_PENDING_MAX) logCtx.fire("warn", "skill.pending.cap", { name: String(skillName || ""), attempts: st.attempts, max: SKILL_PENDING_MAX });
        } catch (eC) {
        }
      }
    } catch (eL) {
    }
  }
  function safeHostFs() {
    try {
      return ctx.get("fs");
    } catch {
      return null;
    }
  }
  async function probeSkillInner(skillName, lang, cwd) {
    try {
      ensureSkillsInvalidateSubscription();
    } catch {
    }
    const skills = ctx.get("skills");
    let found = null;
    let foundPath = null;
    let skillsError = null;
    if (skills !== void 0 && skills !== null) {
      try {
        const res = await skills.get(skillName, cwd ? { cwd } : void 0);
        if (res) {
          found = res;
          if (typeof res === "object") {
            foundPath = res.path || res.dir || res.location || res.file || res.uri || res.source || null;
            if (!foundPath && res.metadata && typeof res.metadata === "object") foundPath = res.metadata.path || null;
          } else if (typeof res === "string") {
            foundPath = res;
          }
        }
      } catch (e) {
        skillsError = String(e && e.message || e || "skills.get failed");
      }
    } else {
      skillsError = "skills service unavailable";
    }
    if (found) {
      let detail = lang === "en" ? "Installed" : "\u5DF2\u5B89\u88C5";
      let hint = "";
      let isOffRoot = false;
      if (foundPath) {
        try {
          const plat = await getPlatform();
          const home = await plat.getHome();
          if (home) {
            const standard = plat.path.join(home, ".agents", "skills", skillName);
            const normFoundRaw = String(foundPath);
            const normStd = plat.path.normalize(String(standard));
            const normFound = plat.path.normalize(normFoundRaw);
            let cmpFound = normFound;
            let cmpStd = normStd;
            if (plat.os === "win32") {
              cmpFound = cmpFound.toLowerCase();
              cmpStd = cmpStd.toLowerCase();
            }
            let foundDir = cmpFound;
            try {
              if (foundDir.toLowerCase().endsWith("skill.md")) foundDir = plat.path.dirname(foundDir);
              if (foundDir.length > 1 && (foundDir.endsWith("/") || foundDir.endsWith("\\"))) foundDir = foundDir.slice(0, -1);
            } catch {
            }
            let stdDir = cmpStd;
            try {
              if (stdDir.length > 1 && (stdDir.endsWith("/") || stdDir.endsWith("\\"))) stdDir = stdDir.slice(0, -1);
            } catch {
            }
            isOffRoot = foundDir !== stdDir;
          } else {
            isOffRoot = true;
          }
        } catch {
          isOffRoot = false;
        }
      }
      if (isOffRoot && foundPath) {
        const srcLine = lang === "en" ? " (source: " + foundPath + ")" : "\uFF08\u6765\u6E90\uFF1A" + foundPath + "\uFF09";
        detail = detail + srcLine;
      }
      try {
        resetSkillPendingState(skillName);
      } catch {
      }
      return { ok: true, level: "ok", detail, hint, sourcePath: foundPath || void 0, repo: null, channels: [{ channel: "registry", root: "registry", result: "hit", detail: foundPath || "" }] };
    }
    if (skillsError) {
      const st = getOrCreatePendingState(skillName);
      st.attempts += 1;
      st.lastError = skillsError;
      if (st.attempts <= SKILL_PENDING_MAX) {
        return { ok: false, level: "pending", detail: lang === "en" ? "Waiting for skills service... (" + st.attempts + "/" + SKILL_PENDING_MAX + ")" : "\u7B49\u5F85\u6280\u80FD\u670D\u52A1\u5C31\u7EEA\u2026\uFF08" + st.attempts + "/" + SKILL_PENDING_MAX + "\uFF09", hint: SKILL_PENDING_HINT_PREFIX + ":" + st.attempts, repo: null, pending: true, attempts: st.attempts, maxAttempts: SKILL_PENDING_MAX, error: skillsError };
      } else {
        return { ok: false, level: "bad", detail: lang === "en" ? "Skills service unavailable: " + skillsError : "\u6280\u80FD\u670D\u52A1\u4E0D\u53EF\u7528\uFF1A" + skillsError, hint: "prompt:installSkills", repo: null, error: skillsError };
      }
    }
    const hostFs = safeHostFs();
    const reason = await lightProbeReason(skillName, lang, cwd, { curFs: hostFs, getPlatform });
    try {
      resetSkillPendingState(skillName);
    } catch {
    }
    const allCh = [{ channel: "registry", root: "registry", result: "miss", detail: "" }].concat(reason.channels || []);
    const ev = evidenceSummary(allCh, lang);
    if (reason.kind === "ok") {
      const srcLine = reason.sourcePath ? lang === "en" ? " (source: " + reason.sourcePath + ")" : "\uFF08\u6765\u6E90\uFF1A" + reason.sourcePath + "\uFF09" : "";
      const regNote = lang === "en" ? " (DSH catalog miss; judged by disk facts)" : "\uFF08DSH \u6280\u80FD\u6E05\u5355\u672A\u6536\u5F55\uFF0C\u6309\u76D8\u4E0A\u4E8B\u5B9E\u5224\u5B9A\uFF09";
      return { ok: true, level: "ok", detail: reason.detail + srcLine + regNote, hint: "", sourcePath: reason.sourcePath || void 0, repo: null, via: reason.via, channels: allCh };
    }
    if (reason.kind === "invalid") {
      return { ok: false, level: "bad", detail: reason.detail + ev, hint: reason.hint, repo: null, reason: "invalid", channels: allCh };
    }
    return { ok: false, level: "bad", detail: reason.detail + ev, hint: reason.hint, repo: null, reason: "missing", channels: allCh };
  }
  return { probeSkill, lightProbeReason, probeFsExists, directSkillCardRead, directPathExists, findProjectRootDir, probeCardViaFs, probeCardViaDirect, evidenceSummary, isSkillCardValid, invalidateSkillProbeCaches };
}
export {
  createSkillProbe
};
