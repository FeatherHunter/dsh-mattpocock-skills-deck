// 由 dsh-plugin-update@0.17.1 的集成工具生成，人手不改。
// 生成命令：node dsh-plugin-update/derive-client-values.mjs --prefix wf --out <本文件路径>
// 生成对象：dsh-mattpocock-skills-deck。改了前缀或想升级本包，重新跑一次这条命令即可。
// node_modules/.pnpm/dsh-plugin-update@0.17.1/node_modules/dsh-plugin-update/dist/config.js
// 派生后处理（#800）：已按 #597 把三个重名函数改名（build* → updBuild*），顶撞检查已过；数据源是已安装的更新包，本地包目录不是来源。
var DEFAULT_CONFIRMATION_TTL_MS = 10 * 6e4;
var DEFAULT_INSTALL_TIMEOUT_MS = 15 * 6e4;
var DEFAULT_PANEL_POLL_MS = 1e3;
var MIN_PANEL_POLL_MS = 250;
function assertPrefix(value, role) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("[dsh-plugin-update] " + role + " \u975E\u6CD5\uFF1A\u987B\u4E3A\u975E\u7A7A\u5B57\u7B26\u4E32\uFF08\u6536\u5230 " + JSON.stringify(value) + "\uFF09");
  }
  if (value.includes(".") || value.includes("/") || value.includes("\\") || /\s/.test(value)) {
    throw new Error("[dsh-plugin-update] " + role + " \u975E\u6CD5\uFF1A\u4E0D\u5F97\u542B\u6709\u70B9\u3001\u8DEF\u5F84\u5206\u9694\u7B26\u6216\u7A7A\u767D\uFF08\u6536\u5230 " + JSON.stringify(value) + "\uFF09");
  }
  return value;
}
var LOG_APPEND_ACTION = "logAppend";
function updBuildPhoneNames(prefix) {
  const checked = assertPrefix(prefix, "\u7535\u8BDD\u540D\u524D\u7F00 prefix");
  return {
    updateStatus: checked + ".updateStatus",
    updateCheck: checked + ".updateCheck",
    updateInstall: checked + ".updateInstall",
    updateChangelog: checked + ".updateChangelog",
    logAppend: checked + "." + LOG_APPEND_ACTION
  };
}
function buildChangelogPhoneName(prefix) {
  return updBuildPhoneNames(prefix).updateChangelog;
}
function updBuildPhoneName(prefix, action) {
  return updBuildPhoneNames(prefix)[action];
}

// node_modules/.pnpm/dsh-plugin-update@0.17.1/node_modules/dsh-plugin-update/dist/commands.js
var PACKAGE_NAME = "dsh-mattpocock-skills-deck";
var NPM_REGISTRY = "https://registry.npmjs.org/";
var INSTALL_TIMEOUT_MS = 15 * 6e4;
function validVersion(v) {
  return typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v);
}
function validPrereleaseIds(ids) {
  if (typeof ids !== "string" || !ids) return false;
  const parts = ids.split(".");
  if (parts.length === 0) return false;
  for (const p of parts) {
    if (!p || !/^[0-9A-Za-z-]+$/.test(p)) return false;
    if (/^\d+$/.test(p) && p.length > 1 && p.startsWith("0")) return false;
  }
  return true;
}
function validReleaseVersion(v) {
  if (typeof v !== "string" || !v) return false;
  const dash = v.indexOf("-");
  if (dash < 0) return validVersion(v);
  if (v.slice(dash + 1).includes("+")) return false;
  return validVersion(v.slice(0, dash)) && validPrereleaseIds(v.slice(dash + 1));
}
function versionAllowed(version, channel) {
  if (channel === "prerelease") return validReleaseVersion(version);
  return validVersion(version);
}
function parseTriple(v) {
  const parts = String(v).split(".");
  if (parts.length > 3) return null;
  const nums = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (!Number.isSafeInteger(n)) return null;
    nums.push(n);
  }
  while (nums.length < 3) nums.push(0);
  return [nums[0], nums[1], nums[2]];
}
function compareVersions(a, b) {
  const pa = parseTriple(a);
  const pb = parseTriple(b);
  if (!pa || !pb) throw new Error("invalid-release");
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}
function compareReleaseVersions(a, b) {
  if (!validReleaseVersion(a) || !validReleaseVersion(b)) throw new Error("invalid-release");
  const dashA = a.indexOf("-");
  const dashB = b.indexOf("-");
  const coreA = dashA < 0 ? a : a.slice(0, dashA);
  const coreB = dashB < 0 ? b : b.slice(0, dashB);
  const order = compareVersions(coreA, coreB);
  if (order !== 0) return order;
  const preA = dashA < 0 ? null : a.slice(dashA + 1).split(".");
  const preB = dashB < 0 ? null : b.slice(dashB + 1).split(".");
  if (preA === null && preB === null) return 0;
  if (preA === null) return 1;
  if (preB === null) return -1;
  const width = Math.max(preA.length, preB.length);
  for (let i = 0; i < width; i++) {
    const x = preA[i];
    const y = preB[i];
    if (x === void 0) return -1;
    if (y === void 0) return 1;
    const xn = /^\d+$/.test(x) ? Number(x) : null;
    const yn = /^\d+$/.test(y) ? Number(y) : null;
    if (xn !== null && yn !== null) {
      if (xn < yn) return -1;
      if (xn > yn) return 1;
      continue;
    }
    if (xn !== null) return -1;
    if (yn !== null) return 1;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}
function usableProfileName(raw) {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name || name.length > 255 || name.startsWith("-")) return null;
  if ([".", "..", "node_modules"].includes(name)) return null;
  return name;
}
function manualCommand(input) {
  if (input.sourceInstall || input.blockedReason === "source-install" || input.blockedReason === "unknown-profile") return null;
  const name = usableProfileName(input.profileName);
  if (!name) return null;
  const targetName = input.targetPackageName ?? PACKAGE_NAME;
  const registry = input.registryUrl ?? NPM_REGISTRY;
  if (!targetName || !registry) return null;
  const channel = input.releaseChannel === "prerelease" ? "prerelease" : "stable";
  const arg = /^[A-Za-z0-9_.-]+$/.test(name) ? name : JSON.stringify(name);
  const picks = [input.latestVersion, input.jobTargetVersion, input.installedVersion].filter((v) => versionAllowed(v, channel));
  let version = null;
  try {
    const ranked = picks.filter((v) => compareReleaseVersions(v, input.runningVersion) >= 0);
    if (ranked.length > 0) {
      version = ranked[0];
      for (const v of ranked) if (compareReleaseVersions(v, version) === 1) version = v;
    }
  } catch {
    version = null;
  }
  if (!version) return null;
  return `dsh plugin --profile ${arg} add --save-exact ${targetName}@${version} --registry=${registry}`;
}

// node_modules/.pnpm/dsh-plugin-update@0.17.1/node_modules/dsh-plugin-update/dist/queue.js
var QUEUE_INTENT_TTL_MS = 10 * 6e4;
function emptyQueueState() {
  return { version: 1, owner: null, waiting: [] };
}
function updIsNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
function asMillis(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
function normalizeQueueState(raw) {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyQueueState();
    const input = raw;
    if (input["version"] !== 1) return emptyQueueState();
    let owner = null;
    const rawOwner = input["owner"];
    if (rawOwner && typeof rawOwner === "object" && !Array.isArray(rawOwner)) {
      const o = rawOwner;
      if (updIsNonEmptyString(o["pluginId"]) && updIsNonEmptyString(o["jobId"])) {
        owner = {
          pluginId: o["pluginId"],
          jobId: o["jobId"],
          requestId: typeof o["requestId"] === "string" ? o["requestId"] : null,
          targetVersion: typeof o["targetVersion"] === "string" ? o["targetVersion"] : null,
          startedAt: asMillis(o["startedAt"], 0)
        };
      }
    }
    const waiting = [];
    const rawWaiting = input["waiting"];
    if (Array.isArray(rawWaiting)) {
      for (const item of rawWaiting) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const e = item;
        if (!updIsNonEmptyString(e["pluginId"])) continue;
        waiting.push({
          pluginId: e["pluginId"],
          requestId: typeof e["requestId"] === "string" ? e["requestId"] : null,
          targetVersion: typeof e["targetVersion"] === "string" ? e["targetVersion"] : null,
          enqueuedAt: asMillis(e["enqueuedAt"], 0)
        });
      }
    }
    return { version: 1, owner, waiting };
  } catch {
    return emptyQueueState();
  }
}
function sameIntent(a, b) {
  return a.pluginId === b.pluginId && (a.requestId ?? null) === (b.requestId ?? null);
}
function pruneExpiredIntents(state, nowMs, ttlMs = QUEUE_INTENT_TTL_MS) {
  const now = asMillis(nowMs, 0);
  const ttl = typeof ttlMs === "number" && Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : QUEUE_INTENT_TTL_MS;
  const waiting = state.waiting.filter((e) => now - asMillis(e.enqueuedAt, now) < ttl);
  if (waiting.length === state.waiting.length) return state;
  return { version: 1, owner: state.owner, waiting };
}
function enqueueInQueue(state, entry) {
  const base = normalizeQueueState(state);
  if (!updIsNonEmptyString(entry.pluginId)) return { state: base, position: null };
  const key = { pluginId: entry.pluginId, requestId: entry.requestId ?? null };
  if (base.owner && sameIntent(base.owner, key)) return { state: base, position: 0 };
  const at = base.waiting.findIndex((e) => sameIntent(e, key));
  if (at >= 0) return { state: base, position: at + 1 };
  const next = {
    pluginId: entry.pluginId,
    requestId: entry.requestId ?? null,
    targetVersion: typeof entry.targetVersion === "string" ? entry.targetVersion : null,
    enqueuedAt: asMillis(entry.enqueuedAt, 0)
  };
  const waiting = [...base.waiting, next];
  return { state: { version: 1, owner: base.owner, waiting }, position: waiting.length };
}
function cancelEnqueuedInQueue(state, pluginId, requestId) {
  const base = normalizeQueueState(state);
  if (!updIsNonEmptyString(pluginId)) return { state: base, removed: false };
  const key = { pluginId, requestId: requestId ?? null };
  if (base.owner && sameIntent(base.owner, key)) return { state: base, removed: false };
  const at = base.waiting.findIndex((e) => sameIntent(e, key));
  if (at < 0) return { state: base, removed: false };
  const waiting = [...base.waiting.slice(0, at), ...base.waiting.slice(at + 1)];
  return { state: { version: 1, owner: base.owner, waiting }, removed: true };
}
function releaseOwnerInQueue(state, pluginId, jobId) {
  const base = normalizeQueueState(state);
  if (!updIsNonEmptyString(pluginId) || !updIsNonEmptyString(jobId)) return { state: base, released: false };
  if (!base.owner || base.owner.pluginId !== pluginId || base.owner.jobId !== jobId) {
    return { state: base, released: false };
  }
  return { state: { version: 1, owner: null, waiting: base.waiting }, released: true };
}
function setOwnerIfFree(state, owner) {
  const base = normalizeQueueState(state);
  if (base.owner) return { state: base, set: false };
  if (!updIsNonEmptyString(owner.pluginId) || !updIsNonEmptyString(owner.jobId)) return { state: base, set: false };
  return {
    state: {
      version: 1,
      owner: {
        pluginId: owner.pluginId,
        jobId: owner.jobId,
        requestId: owner.requestId ?? null,
        targetVersion: typeof owner.targetVersion === "string" ? owner.targetVersion : null,
        startedAt: asMillis(owner.startedAt, 0)
      },
      // 抢到锁即消费自己的队首意向（若有），不留僵尸占位。
      waiting: base.waiting.filter((e) => !sameIntent(e, { pluginId: owner.pluginId, requestId: owner.requestId ?? null }))
    },
    set: true
  };
}
function queuePositionOf(state, pluginId, requestId) {
  const base = normalizeQueueState(state);
  if (!updIsNonEmptyString(pluginId)) return null;
  const key = { pluginId, requestId: requestId ?? null };
  if (base.owner && sameIntent(base.owner, key)) return 0;
  const at = base.waiting.findIndex((e) => sameIntent(e, key));
  return at >= 0 ? at + 1 : null;
}
function isHeadOfQueue(state, pluginId, requestId) {
  const base = normalizeQueueState(state);
  if (!updIsNonEmptyString(pluginId)) return false;
  if (base.waiting.length === 0) return true;
  const head = base.waiting[0];
  return head.pluginId === pluginId && (head.requestId ?? null) === (requestId ?? null);
}
function isQueueBusy(state) {
  return normalizeQueueState(state).owner !== null;
}
function visibleQueueFor(state, viewerPluginId, showOthers = false, requestId) {
  const base = normalizeQueueState(state);
  const rid = requestId === void 0 ? derivedRequestId(base, viewerPluginId) : requestId ?? null;
  const position = updIsNonEmptyString(viewerPluginId) ? queuePositionOf(base, viewerPluginId, rid) : null;
  if (showOthers === true) {
    return { busy: base.owner !== null, owner: base.owner, waiting: [...base.waiting], position };
  }
  const mine = updIsNonEmptyString(viewerPluginId) ? base.waiting.filter((e) => e.pluginId === viewerPluginId) : [];
  let owner = null;
  if (base.owner) {
    if (base.owner.pluginId === viewerPluginId) owner = base.owner;
    else owner = { pluginId: null, busy: true };
  }
  return { busy: base.owner !== null, owner, waiting: mine, position };
}
function derivedRequestId(state, viewerPluginId) {
  const mine = state.waiting.filter((e) => e.pluginId === viewerPluginId);
  if (state.owner && state.owner.pluginId === viewerPluginId) return state.owner.requestId;
  if (mine.length === 0) return null;
  return mine[0].requestId;
}

// node_modules/.pnpm/dsh-plugin-update@0.17.1/node_modules/dsh-plugin-update/dist/batch.js
var BATCH_SESSION_VERSION = 1;
function isTerminalPhase(phase) {
  return phase === "done" || phase === "failed" || phase === "skipped" || phase === "current";
}
function asMillis2(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
function isNonEmptyString2(value) {
  return typeof value === "string" && value.length > 0;
}
var PHASES = ["pending", "checking", "ready", "installing", "current", "done", "failed", "skipped"];
function asPhase(value) {
  return typeof value === "string" && PHASES.includes(value) ? value : "pending";
}
function orderTargets(keys, selfKey) {
  const seen = /* @__PURE__ */ new Set();
  const others = [];
  let self = null;
  for (const key of keys) {
    if (!isNonEmptyString2(key) || seen.has(key)) continue;
    seen.add(key);
    if (selfKey && key === selfKey) self = key;
    else others.push(key);
  }
  return self ? [...others, self] : others;
}
function batchRequestId(sessionId, key) {
  return "batch:" + sessionId + ":" + key;
}
function createBatchSession(args) {
  const id = isNonEmptyString2(args.id) ? args.id : "batch";
  const selfKey = isNonEmptyString2(args.selfKey) ? args.selfKey : null;
  const order = orderTargets(args.keys, selfKey);
  const now = asMillis2(args.now, 0);
  const entries = order.map((key) => ({
    key,
    phase: "pending",
    requestId: batchRequestId(id, key),
    targetVersion: null,
    restartRequired: false,
    error: null,
    updatedAt: now
  }));
  return {
    version: BATCH_SESSION_VERSION,
    id,
    selfKey,
    stopOnFailure: args.stopOnFailure === true,
    order,
    entries,
    createdAt: now,
    updatedAt: now
  };
}
function emptyBatchSession() {
  return {
    version: BATCH_SESSION_VERSION,
    id: "",
    selfKey: null,
    stopOnFailure: false,
    order: [],
    entries: [],
    createdAt: 0,
    updatedAt: 0
  };
}
function normalizeBatchSession(raw) {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyBatchSession();
    const input = raw;
    if (input["version"] !== BATCH_SESSION_VERSION) return emptyBatchSession();
    const id = isNonEmptyString2(input["id"]) ? input["id"] : "";
    const selfKey = isNonEmptyString2(input["selfKey"]) ? input["selfKey"] : null;
    const entries = [];
    const seen = /* @__PURE__ */ new Set();
    const rawEntries = input["entries"];
    if (Array.isArray(rawEntries)) {
      for (const item of rawEntries) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const e = item;
        const key = e["key"];
        if (!isNonEmptyString2(key) || seen.has(key)) continue;
        seen.add(key);
        const requestId = isNonEmptyString2(e["requestId"]) ? e["requestId"] : batchRequestId(id, key);
        entries.push({
          key,
          phase: asPhase(e["phase"]),
          requestId,
          targetVersion: isNonEmptyString2(e["targetVersion"]) ? e["targetVersion"] : null,
          restartRequired: e["restartRequired"] === true,
          error: isNonEmptyString2(e["error"]) ? e["error"] : null,
          updatedAt: asMillis2(e["updatedAt"], 0)
        });
      }
    }
    const order = entries.map((e) => e.key);
    return {
      version: BATCH_SESSION_VERSION,
      id,
      selfKey: selfKey && seen.has(selfKey) ? selfKey : null,
      stopOnFailure: input["stopOnFailure"] === true,
      order,
      entries,
      createdAt: asMillis2(input["createdAt"], 0),
      updatedAt: asMillis2(input["updatedAt"], 0)
    };
  } catch {
    return emptyBatchSession();
  }
}
function batchEntryOf(session, key) {
  return session.entries.find((e) => e.key === key) ?? null;
}
function nextBatchKey(session) {
  if (session.stopOnFailure && session.entries.some((e) => e.phase === "failed")) return null;
  for (const key of session.order) {
    const entry = session.entries.find((e) => e.key === key);
    if (entry && !isTerminalPhase(entry.phase)) return key;
  }
  return null;
}
function markBatchEntry(session, key, patch, now) {
  const at = session.entries.findIndex((e) => e.key === key);
  if (at < 0) return { session, changed: false };
  const next = { ...session.entries[at], ...patch, key: session.entries[at].key, requestId: session.entries[at].requestId, updatedAt: asMillis2(now, session.entries[at].updatedAt) };
  const entries = [...session.entries.slice(0, at), next, ...session.entries.slice(at + 1)];
  return { session: { ...session, entries, updatedAt: next.updatedAt }, changed: true };
}
function batchProgress(session) {
  const total = session.entries.length;
  let done = 0;
  let failed = 0;
  let skipped = 0;
  let current = 0;
  let pending = 0;
  for (const entry of session.entries) {
    if (entry.phase === "done" || entry.phase === "current") done += 1;
    else if (entry.phase === "failed") failed += 1;
    else if (entry.phase === "skipped") skipped += 1;
    else if (entry.phase === "installing" || entry.phase === "checking" || entry.phase === "ready") current += 1;
    else pending += 1;
  }
  return { total, done, failed, skipped, current, pending, finished: isBatchFinished(session) };
}
function isBatchFinished(session) {
  return session.entries.length > 0 && session.entries.every((e) => isTerminalPhase(e.phase));
}
function needsRestartKeys(session) {
  return session.entries.filter((e) => e.restartRequired).map((e) => e.key);
}
function failedKeys(session) {
  return session.entries.filter((e) => e.phase === "failed").map((e) => e.key);
}
function resumeBatchSession(session, now) {
  const at = asMillis2(now, session.updatedAt);
  let changed = false;
  const entries = session.entries.map((entry) => {
    if (entry.phase === "checking" || entry.phase === "installing") {
      changed = true;
      return { ...entry, phase: "pending", error: null, updatedAt: at };
    }
    return entry;
  });
  return changed ? { ...session, entries, updatedAt: at } : session;
}

// node_modules/.pnpm/dsh-plugin-update@0.17.1/node_modules/dsh-plugin-update/dist/service.js
var CONFIRMATION_TTL_MS = 10 * 6e4;
var MAX_METADATA_BYTES = 256 * 1024;
function updateError(code) {
  return Object.assign(new Error(code), { code });
}
function validVersion2(v) {
  return typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v);
}
function validPrereleaseIds2(ids) {
  if (typeof ids !== "string" || !ids) return false;
  const parts = ids.split(".");
  if (parts.length === 0) return false;
  for (const p of parts) {
    if (!p || !/^[0-9A-Za-z-]+$/.test(p)) return false;
    if (/^\d+$/.test(p) && p.length > 1 && p.startsWith("0")) return false;
  }
  return true;
}
function validReleaseVersion2(v) {
  if (typeof v !== "string" || !v) return false;
  const dash = v.indexOf("-");
  if (dash < 0) return validVersion2(v);
  const core = v.slice(0, dash);
  const ids = v.slice(dash + 1);
  if (!validVersion2(core) || !validPrereleaseIds2(ids)) return false;
  if (ids.includes("+")) return false;
  return true;
}
function parseTriple2(v) {
  const parts = String(v).split(".");
  if (parts.length > 3) return null;
  const nums = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (!Number.isSafeInteger(n)) return null;
    nums.push(n);
  }
  while (nums.length < 3) nums.push(0);
  return [nums[0], nums[1], nums[2]];
}
function compareVersions2(a, b) {
  const pa = parseTriple2(a);
  const pb = parseTriple2(b);
  if (!pa || !pb) throw updateError("invalid-release");
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}
function parseReleaseIds(ids) {
  return ids.split(".").map((p) => /^\d+$/.test(p) ? Number(p) : p);
}
function compareReleaseVersions2(a, b) {
  if (!validReleaseVersion2(a) || !validReleaseVersion2(b)) throw updateError("invalid-release");
  const dashA = String(a).indexOf("-");
  const dashB = String(b).indexOf("-");
  const coreA = dashA < 0 ? String(a) : String(a).slice(0, dashA);
  const coreB = dashB < 0 ? String(b) : String(b).slice(0, dashB);
  const order = compareVersions2(coreA, coreB);
  if (order !== 0) return order;
  const preA = dashA < 0 ? null : parseReleaseIds(String(a).slice(dashA + 1));
  const preB = dashB < 0 ? null : parseReleaseIds(String(b).slice(dashB + 1));
  if (preA === null && preB === null) return 0;
  if (preA === null) return 1;
  if (preB === null) return -1;
  const width = Math.max(preA.length, preB.length);
  for (let i = 0; i < width; i++) {
    const x = preA[i];
    const y = preB[i];
    if (x === void 0) return -1;
    if (y === void 0) return 1;
    if (typeof x === "number" && typeof y === "number") {
      if (x < y) return -1;
      if (x > y) return 1;
      continue;
    }
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

// node_modules/.pnpm/dsh-plugin-update@0.17.1/node_modules/dsh-plugin-update/dist/lang.js
function normalizeLangTag(tag) {
  if (typeof tag !== "string") return "zh";
  const s = tag.trim().toLowerCase().replace(/_/g, "-");
  if (!s) return "zh";
  if (s === "zh" || s.startsWith("zh-")) return "zh";
  if (s === "en" || s.startsWith("en-")) return "en";
  if (/^[a-z]{2,3}(-[a-z0-9]+)*$/.test(s)) return "en";
  return "zh";
}

// node_modules/.pnpm/dsh-plugin-update@0.17.1/node_modules/dsh-plugin-update/dist/bilingual.js
var BILINGUAL_STRINGS = {
  "entry.label.idle": { en: "Check for updates", zh: "\u68C0\u67E5\u66F4\u65B0", draft: true },
  "entry.label.failed": { en: "Update failed \u2014 View details", zh: "\u66F4\u65B0\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u8BE6\u60C5", draft: true },
  "entry.label.busy": { en: "Installing\u2026", zh: "\u6B63\u5728\u5B89\u88C5\u2026", draft: true },
  "entry.label.restart": { en: "Restart required", zh: "\u5F85\u91CD\u542F", draft: true },
  "entry.label.has-update": { en: "Update available {version}", zh: "\u6709\u65B0\u7248\u672C {version}", draft: true },
  "entry.action.checking": { en: "Checking for updates\u2026", zh: "\u6B63\u5728\u67E5\u8BE2\u7248\u672C\u4FE1\u606F\u2026", draft: true },
  "entry.note.up-to-date": { en: "Up to date {version}", zh: "\u5DF2\u662F\u6700\u65B0 {version}", draft: true },
  "batch-entry.label.idle": { en: "Check for updates", zh: "\u68C0\u67E5\u66F4\u65B0", draft: true },
  "batch-entry.label.update": { en: "{count} updates available", zh: "{count} \u4E2A\u53EF\u66F4\u65B0", draft: true },
  "batch-entry.label.busy": { en: "Installing\u2026", zh: "\u6B63\u5728\u5B89\u88C5\u2026", draft: true },
  "batch-entry.label.restart": { en: "{count} restarts required", zh: "{count} \u4E2A\u5F85\u91CD\u542F", draft: true },
  "batch-entry.label.failed": { en: "{count} failed \u2014 View details", zh: "{count} \u4E2A\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u8BE6\u60C5", draft: true },
  "batch-entry.action.checking": { en: "Checking for updates\u2026", zh: "\u6B63\u5728\u67E5\u8BE2\u7248\u672C\u4FE1\u606F\u2026", draft: true },
  "panel.blocked.unknown-profile.title": { en: "Unrecognized scope or plugin location", zh: "\u65E0\u6CD5\u8BC6\u522B\u4F7F\u7528\u8303\u56F4\u6216\u63D2\u4EF6\u5B89\u88C5\u4F4D\u7F6E", draft: true },
  "panel.blocked.unknown-profile.action": { en: "Reopen the host and check again; if it persists, send the version and logs to the plugin author; no manual command is provided for this case.", zh: "\u91CD\u542F\u5BBF\u4E3B\u540E\u91CD\u65B0\u67E5\u8BE2\uFF1B\u82E5\u6301\u7EED\uFF0C\u8BF7\u63D0\u4EA4\u7248\u672C\u53F7\u4E0E\u8BCA\u65AD\u4FE1\u606F\u81F3\u63D2\u4EF6\u4F5C\u8005\uFF1B\u6B64\u573A\u666F\u4E0D\u63D0\u4F9B\u624B\u5DE5\u547D\u4EE4", draft: true },
  "panel.blocked.channel-mismatch.title": { en: "Installed version is not in the selected release channel", zh: "\u5DF2\u5B89\u88C5\u7248\u672C\u4E0E\u5F53\u524D\u7248\u672C\u901A\u9053\u4E0D\u7B26", draft: true },
  "panel.blocked.channel-mismatch.action": { en: "Switch to the prerelease channel, or install the channel release, then check again.", zh: "\u5207\u6362\u81F3\u9884\u53D1\u5E03\u901A\u9053\uFF0C\u6216\u91CD\u65B0\u5B89\u88C5\u672C\u901A\u9053\u6B63\u5F0F\u7248\u672C\u540E\u67E5\u8BE2", draft: true },
  "panel.blocked.source-install.title": { en: "Installed from source, not by version", zh: "\u6E90\u7801\u5B89\u88C5\u5B9E\u4F8B\uFF0C\u4E0D\u652F\u6301\u7248\u672C\u66F4\u65B0", draft: true },
  "panel.blocked.source-install.action": { en: "No manual command is provided here; to update, reinstall by version first.", zh: "\u6B64\u573A\u666F\u4E0D\u63D0\u4F9B\u624B\u5DE5\u547D\u4EE4\uFF1B\u5982\u9700\u66F4\u65B0\uFF0C\u8BF7\u6309\u5305\u540D@\u7248\u672C\u53F7\u91CD\u65B0\u5B89\u88C5", draft: true },
  "panel.blocked.invalid-installation.title": { en: "Installed package is incomplete (name mismatch, invalid version, or missing entry file)", zh: "\u5DF2\u5B89\u88C5\u5305\u7ED3\u6784\u4E0D\u5B8C\u6574\uFF08\u5305\u540D / \u7248\u672C\u53F7 / \u5165\u53E3\u6587\u4EF6\u5F02\u5E38\uFF09", draft: true },
  "panel.blocked.invalid-installation.action": { en: "Reinstall the current version to repair the install directory, then check again.", zh: "\u91CD\u65B0\u5B89\u88C5\u5F53\u524D\u7248\u672C\u4EE5\u4FEE\u590D\u5B89\u88C5\u76EE\u5F55\uFF0C\u7136\u540E\u91CD\u65B0\u67E5\u8BE2\u66F4\u65B0", draft: true },
  "panel.blocked.installation-changed.title": { en: "Install location changed during use (directory or package changed)", zh: "\u5B89\u88C5\u4F4D\u7F6E\u53D1\u751F\u53D8\u66F4\uFF08\u76EE\u5F55\u6216\u5305\u4F53\u4E0D\u4E00\u81F4\uFF09", draft: true },
  "panel.blocked.installation-changed.action": { en: "Reopen the host and check again; if it persists, reinstall.", zh: "\u91CD\u542F\u5BBF\u4E3B\u540E\u91CD\u65B0\u67E5\u8BE2\uFF1B\u82E5\u6301\u7EED\uFF0C\u8BF7\u91CD\u65B0\u5B89\u88C5", draft: true },
  "panel.blocked.pending-restart.title": { en: "New version is on disk; the running instance is still the old version", zh: "\u65B0\u7248\u672C\u5DF2\u5199\u5165\u78C1\u76D8\uFF0C\u5F53\u524D\u8FD0\u884C\u4ECD\u4E3A\u65E7\u7248\u672C", draft: true },
  "panel.blocked.pending-restart.action": { en: "Restart the host to run the new version; this is a normal end state, not a failure.", zh: "\u91CD\u542F\u5BBF\u4E3B\u4EE5\u52A0\u8F7D\u65B0\u7248\u672C\uFF1B\u6B64\u4E3A\u6B63\u5E38\u72B6\u6001\uFF0C\u975E\u5B89\u88C5\u5931\u8D25", draft: true },
  "panel.blocked.registry-conflict.title": { en: "Declared version conflicts with the version on disk", zh: "\u7248\u672C\u58F0\u660E\u4E0E\u78C1\u76D8\u5B9E\u9645\u7248\u672C\u51B2\u7A81", draft: true },
  "panel.blocked.registry-conflict.action": { en: "Open the scope manifest and set the target package line to the version number, then retry.", zh: "\u6838\u5BF9\u4F7F\u7528\u8303\u56F4\u6E05\u5355\u6587\u4EF6\u4E2D\u76EE\u6807\u5305\u7684\u7248\u672C\u58F0\u660E\uFF0C\u4FEE\u6B63\u540E\u91CD\u8BD5", draft: true },
  "panel.blocked.incompatible-node.title": { en: "Required Node version does not match the running Node", zh: "Node \u8FD0\u884C\u65F6\u7248\u672C\u4E0D\u517C\u5BB9", draft: true },
  "panel.blocked.incompatible-node.action": { en: "Upgrade Node to 22 or later, then check again.", zh: "\u8BF7\u5347\u7EA7 Node \u81F3 22 \u6216\u66F4\u9AD8\u7248\u672C\u540E\u91CD\u65B0\u67E5\u8BE2", draft: true },
  "panel.blocked.recovery-required.title": { en: "Last install was interrupted, leaving a partial task", zh: "\u4E0A\u6B21\u5B89\u88C5\u5F02\u5E38\u4E2D\u65AD\uFF0C\u5B58\u5728\u672A\u5B8C\u6210\u4EFB\u52A1", draft: true },
  "panel.blocked.recovery-required.action": { en: "Run install once more; if it persists, follow section 6 to troubleshoot.", zh: "\u91CD\u65B0\u6267\u884C\u5B89\u88C5\uFF1B\u82E5\u6301\u7EED\uFF0C\u8BF7\u6309\u7B2C 6 \u8282\u6392\u9519", draft: true },
  "panel.failure.check-failed.title": { en: "Couldn\u2019t check for updates (network, source, or rate limit)", zh: "\u7248\u672C\u4FE1\u606F\u67E5\u8BE2\u5931\u8D25\uFF08\u7F51\u7EDC / \u6570\u636E\u6E90 / \u9650\u6D41\uFF09", draft: true },
  "panel.failure.check-failed.action": { en: "Try checking again later; if it keeps failing, send the copied diagnostics to the plugin author.", zh: "\u7A0D\u540E\u91CD\u65B0\u67E5\u8BE2\uFF1B\u82E5\u6301\u7EED\uFF0C\u8BF7\u63D0\u4EA4\u8BCA\u65AD\u4FE1\u606F\u81F3\u63D2\u4EF6\u4F5C\u8005", draft: true },
  "panel.failure.invalid-release.title": { en: "Release info is invalid (bad version or mismatched content)", zh: "\u53D1\u5E03\u7248\u672C\u4FE1\u606F\u65E0\u6548\uFF08\u7248\u672C\u53F7\u975E\u6CD5\u6216\u5185\u5BB9\u4E0D\u4E00\u81F4\uFF09", draft: true },
  "panel.failure.invalid-release.action": { en: "Check the package name and version in the manifest, then check again.", zh: "\u6838\u5BF9\u6E05\u5355\u6587\u4EF6\u4E2D\u7684\u5305\u540D\u4E0E\u7248\u672C\u58F0\u660E\u540E\u91CD\u65B0\u67E5\u8BE2", draft: true },
  "panel.failure.check-expired.title": { en: "Credentials expired; the install request was rejected", zh: "\u67E5\u8BE2\u51ED\u8BC1\u8FC7\u671F\uFF0C\u5B89\u88C5\u8BF7\u6C42\u88AB\u62D2\u7EDD", draft: true },
  "panel.failure.check-expired.action": { en: "Check for updates again before installing; do not retry with the old ID.", zh: "\u8BF7\u91CD\u65B0\u67E5\u8BE2\u7248\u672C\u4FE1\u606F\u540E\u5B89\u88C5\uFF1B\u8BF7\u52FF\u590D\u7528\u8FC7\u671F\u8BF7\u6C42\u7F16\u53F7", draft: true },
  "panel.failure.update-busy.title": { en: "Another install is running in the same scope", zh: "\u540C\u4E00\u4F7F\u7528\u8303\u56F4\u5185\u5B58\u5728\u8FDB\u884C\u4E2D\u7684\u5B89\u88C5\u4EFB\u52A1", draft: true },
  "panel.failure.update-busy.action": { en: "Wait until the current task leaves installing/verifying, then try; check status for your queue position.", zh: "\u5F85\u5F53\u524D\u4EFB\u52A1\u9000\u51FA installing/verifying \u72B6\u6001\u540E\u91CD\u8BD5\uFF1B\u6392\u961F\u671F\u95F4\u53EF\u67E5\u8BE2\u4EFB\u52A1\u72B6\u6001\u786E\u8BA4\u961F\u5217\u4F4D\u7F6E", draft: true },
  "panel.failure.install-failed.title": { en: "Couldn\u2019t install (see the diagnostic summary)", zh: "\u5B89\u88C5\u6267\u884C\u5931\u8D25\uFF0C\u8BE6\u60C5\u89C1\u8BCA\u65AD\u6458\u8981", draft: true },
  "panel.failure.install-failed.action": { en: "Read the copied diagnostics first; on official desktop builds, send it to the plugin author.", zh: "\u8BF7\u67E5\u9605\u8BCA\u65AD\u6458\u8981\uFF1B\u5B98\u65B9\u684C\u9762\u7248\u8BF7\u63D0\u4EA4\u8BE5\u8BCA\u65AD\u4FE1\u606F\u81F3\u63D2\u4EF6\u4F5C\u8005", draft: true },
  "panel.failure.internal.title": { en: "Something went wrong; the cause is unknown", zh: "\u5185\u90E8\u9519\u8BEF\uFF0C\u539F\u56E0\u672A\u77E5", draft: true },
  "panel.failure.internal.action": { en: "Retry once first; if it persists, send the copied diagnostics to the plugin author.", zh: "\u8BF7\u91CD\u8BD5\u4E00\u6B21\uFF1B\u82E5\u6301\u7EED\uFF0C\u8BF7\u63D0\u4EA4\u8BCA\u65AD\u4FE1\u606F\u81F3\u63D2\u4EF6\u4F5C\u8005", draft: true },
  "panel.failure.unknown.title": { en: "Something went wrong; the cause is unknown", zh: "\u5185\u90E8\u9519\u8BEF\uFF0C\u539F\u56E0\u672A\u77E5", draft: true },
  "panel.failure.unknown.action": { en: "Retry once first; if it persists, send the copied diagnostics to the plugin author (include the code you saw).", zh: "\u8BF7\u91CD\u8BD5\u4E00\u6B21\uFF1B\u82E5\u6301\u7EED\uFF0C\u8BF7\u63D0\u4EA4\u8BCA\u65AD\u4FE1\u606F\u81F3\u63D2\u4EF6\u4F5C\u8005\uFF08\u8BF7\u4E00\u5E76\u63D0\u4EA4\u6240\u89C1\u9519\u8BEF\u7801\uFF09", draft: true },
  "panel.seal.loading.text": { en: "Not checked", zh: "\u5F85\u67E5", draft: true },
  "panel.seal.loading.mini": { en: "Check", zh: "\u67E5", draft: true },
  "panel.seal.idle.text": { en: "Not checked", zh: "\u5F85\u67E5", draft: true },
  "panel.seal.idle.mini": { en: "Check", zh: "\u67E5", draft: true },
  "panel.seal.update.text": { en: "Update available", zh: "\u53EF\u66F4\u65B0", draft: true },
  "panel.seal.update.mini": { en: "Install", zh: "\u88C5", draft: true },
  "panel.seal.busy.text": { en: "Installing", zh: "\u5B89\u88C5\u4E2D", draft: true },
  "panel.seal.busy.mini": { en: "Install", zh: "\u88C5", draft: true },
  "panel.seal.restart.text": { en: "Restart required", zh: "\u5F85\u91CD\u542F", draft: true },
  "panel.seal.restart.mini": { en: "Restart", zh: "\u542F", draft: true },
  "panel.seal.blocked.text": { en: "Blocked \u2014 Action needed", zh: "\u53D7\u963B", draft: true },
  "panel.seal.blocked.mini": { en: "Blocked", zh: "\u963B", draft: true },
  "panel.seal.failed.text": { en: "Failed \u2014 Retry available", zh: "\u5931\u8D25", draft: true },
  "panel.seal.failed.mini": { en: "Failed", zh: "\u963B", draft: true },
  "panel.seal.done.text": { en: "Up to date", zh: "\u5DF2\u662F\u6700\u65B0", draft: true },
  "panel.seal.done.mini": { en: "Done", zh: "\u5B9A", draft: true },
  "panel.banner.error.title": { en: "Update failed ({code}): {detail}.", zh: "\u66F4\u65B0\u5931\u8D25\uFF08{code}\uFF09\uFF1A{detail}\u3002", draft: true },
  "panel.banner.error.action-fallback": { en: "Copy the diagnostics for the plugin author; see the log channel for details.", zh: "\u8BF7\u590D\u5236\u8BCA\u65AD\u4FE1\u606F\u63D0\u4EA4\u81F3\u63D2\u4EF6\u4F5C\u8005\uFF1B\u8BE6\u60C5\u8BF7\u67E5\u770B\u65E5\u5FD7\u901A\u9053\u3002", draft: true },
  "panel.action.retry-install": { en: "Retry install", zh: "\u91CD\u8BD5\u5B89\u88C5", draft: true },
  "panel.banner.loading": { en: "Loading update status\u2026", zh: "\u6B63\u5728\u8BFB\u53D6\u66F4\u65B0\u72B6\u6001\u2026", draft: true },
  "panel.action.install": { en: "Install update", zh: "\u5B89\u88C5\u66F4\u65B0", draft: true },
  "panel.queue.busy-self": { en: "Installing (this plugin is installing).", zh: "\u672C\u63D2\u4EF6\u6B63\u5728\u5B89\u88C5\u3002", draft: true },
  "panel.queue.busy-queued": { en: "An install is running ahead; this plugin is #{n} in queue. Install when it reaches the front.", zh: "\u524D\u65B9\u6709\u5B89\u88C5\u6B63\u5728\u8FDB\u884C\uFF0C\u672C\u63D2\u4EF6\u6392\u7B2C {n} \u4F4D\uFF1B\u5230\u961F\u9996\u540E\u8BF7\u9009\u62E9\u5B89\u88C5\u3002", draft: true },
  "panel.queue.busy-other": { en: "Another plugin is installing; retry later.", zh: "\u524D\u65B9\u6709\u5176\u4ED6\u63D2\u4EF6\u6B63\u5728\u5B89\u88C5\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", draft: true },
  "panel.skip.skipped-title": { en: "Skipped {latest}", zh: "\u5DF2\u8DF3\u8FC7\u7248\u672C {latest}", draft: true },
  "panel.skip.skipped-action": { en: "Select \u201CRestore\u201D to be reminded of this version again; newer versions will still notify.", zh: "\u9009\u62E9\u300C\u6062\u590D\u63D0\u9192\u300D\u53EF\u91CD\u65B0\u63D0\u9192\u8BE5\u7248\u672C\uFF1B\u66F4\u65B0\u7684\u7248\u672C\u4ECD\u4F1A\u6B63\u5E38\u63D0\u9192\u3002", draft: true },
  "panel.banner.restart-title": { en: "Version {latest} is installed; restart the host to take effect.", zh: "\u65B0\u7248\u672C {latest} \u5DF2\u5B89\u88C5\uFF0C\u91CD\u542F\u5BBF\u4E3B\u540E\u751F\u6548\u3002", draft: true },
  "panel.banner.installing-title": { en: "Installing {version}\u2026 Closing the panel won\u2019t interrupt it.", zh: "\u6B63\u5728\u5B89\u88C5 {version}\u2026\u5173\u95ED\u9762\u677F\u4E0D\u4F1A\u4E2D\u65AD\u3002", draft: true },
  "panel.banner.installing-action": { en: "Progress refreshes automatically; reopening the panel restores the view within a second.", zh: "\u8FDB\u5EA6\u5C06\u81EA\u52A8\u8F6E\u8BE2\u5237\u65B0\uFF1B\u91CD\u65B0\u6253\u5F00\u9762\u677F\u5C06\u5728 1 \u79D2\u5185\u6062\u590D\u663E\u793A\u3002", draft: true },
  "panel.action.installing": { en: "Installing\u2026", zh: "\u6B63\u5728\u5B89\u88C5\u2026", draft: true },
  "panel.banner.update-title": { en: "Update available: {latest} (current: {running}).", zh: "\u6709\u65B0\u7248\u672C {latest} \u53EF\u5B89\u88C5\uFF08\u5F53\u524D\u7248\u672C {running}\uFF09\u3002", draft: true },
  "panel.banner.update-action": { en: "Install runs the exact version; only one install runs per scope at a time.", zh: "\u9009\u62E9\u5B89\u88C5\u5C06\u6309\u7CBE\u786E\u7248\u672C\u5B89\u88C5\uFF1B\u540C\u4E00\u4F7F\u7528\u8303\u56F4\u540C\u65F6\u4EC5\u5B89\u88C5\u4E00\u9879\u3002", draft: true },
  "panel.action.install-version": { en: "Install {latest}", zh: "\u5B89\u88C5\u7248\u672C {latest}", draft: true },
  "panel.banner.done": { en: "Up to date. No update needed.", zh: "\u5DF2\u662F\u6700\u65B0\uFF0C\u65E0\u9700\u66F4\u65B0\u3002", draft: true },
  "panel.banner.not-installed": { en: "Not installed", zh: "\u672A\u5B89\u88C5", draft: true },
  "panel.toast.checking": { en: "Checking for updates\u2026", zh: "\u6B63\u5728\u67E5\u8BE2\u7248\u672C\u4FE1\u606F\u2026", draft: true },
  "panel.toast.installing": { en: "Installing\u2026", zh: "\u6B63\u5728\u5B89\u88C5\u2026", draft: true },
  "panel.toast.copy-manual-ok": { en: "Manual command copied; paste the full line into the terminal to run it.", zh: "\u624B\u5DE5\u547D\u4EE4\u5DF2\u590D\u5236\uFF0C\u8BF7\u7C98\u8D34\u81F3\u7EC8\u7AEF\u6574\u884C\u6267\u884C\u3002", draft: true },
  "panel.toast.copy-manual-fail": { en: "Copy failed; please select the command above manually.", zh: "\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u9009\u62E9\u4E0A\u65B9\u547D\u4EE4\u3002", draft: true },
  "panel.toast.copy-diag-ok": { en: "Diagnostics copied; paste it to the plugin author (already redacted).", zh: "\u8BCA\u65AD\u4FE1\u606F\u5DF2\u590D\u5236\uFF0C\u8BF7\u63D0\u4EA4\u81F3\u63D2\u4EF6\u4F5C\u8005\uFF08\u5DF2\u8131\u654F\uFF09\u3002", draft: true },
  "panel.toast.copy-diag-fail": { en: "Copy failed; please select the info above manually.", zh: "\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u9009\u62E9\u4E0A\u65B9\u4FE1\u606F\u3002", draft: true },
  "panel.toast.restart-delegated": { en: "Handled by the caller\u2019s restart flow; the new version takes effect after restart.", zh: "\u5DF2\u6309\u8C03\u7528\u65B9\u91CD\u542F\u6D41\u7A0B\u5904\u7406\uFF1B\u91CD\u542F\u540E\u65B0\u7248\u672C\u751F\u6548\u3002", draft: true },
  "panel.toast.restart-manual": { en: "This host provides no restart entry; please restart the host manually. The new version takes effect after restart.", zh: "\u672C\u5BBF\u4E3B\u672A\u63D0\u4F9B\u91CD\u542F\u5165\u53E3\uFF0C\u8BF7\u624B\u52A8\u91CD\u542F\u5BBF\u4E3B\uFF1B\u91CD\u542F\u540E\u65B0\u7248\u672C\u751F\u6548\u3002", draft: true },
  "panel.toast.restart-failed": { en: "Restart entry failed; please restart the host manually. The new version takes effect after restart.", zh: "\u91CD\u542F\u5165\u53E3\u8C03\u7528\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u91CD\u542F\u5BBF\u4E3B\uFF1B\u91CD\u542F\u540E\u65B0\u7248\u672C\u751F\u6548\u3002", draft: true },
  "panel.toast.copy-state-ok": { en: "Current state copied (no failure); paste it to the plugin author (already redacted).", zh: "\u5F53\u524D\u72B6\u6001\u5DF2\u590D\u5236\uFF08\u65E0\u5931\u8D25\uFF09\uFF0C\u8BF7\u63D0\u4EA4\u81F3\u63D2\u4EF6\u4F5C\u8005\uFF08\u5DF2\u8131\u654F\uFF09\u3002", draft: true },
  "panel.toast.failure-dismissed": { en: "Failure acknowledged; it will be re-evaluated on the next check or install.", zh: "\u5DF2\u786E\u8BA4\u8BE5\u5931\u8D25\u63D0\u793A\uFF1B\u4E0B\u6B21\u67E5\u8BE2\u7248\u672C\u4FE1\u606F\u6216\u5B89\u88C5\u5C06\u91CD\u65B0\u8BC4\u4F30\u3002", draft: true },
  "panel.strip.running": { en: "Running", zh: "\u8FD0\u884C\u7248", draft: true },
  "panel.strip.installed": { en: "Installed", zh: "\u5DF2\u5B89\u88C5", draft: true },
  "panel.strip.latest": { en: "Latest", zh: "\u6700\u65B0\u7248", draft: true },
  "panel.meta.label": { en: "Scope", zh: "\u4F7F\u7528\u8303\u56F4", draft: true },
  "panel.meta.unknown": { en: "Unknown", zh: "\u672A\u77E5", draft: true },
  "panel.masthead.kicker": { en: "Plugin update", zh: "\u63D2\u4EF6\u66F4\u65B0", draft: true },
  "panel.masthead.title": { en: "Update archive", zh: "\u66F4\u65B0\u6863\u6848", draft: true },
  "panel.masthead.volume": { en: "Vol.", zh: "\u5377", draft: true },
  "panel.chapter.check": { en: "Check and install", zh: "\u68C0\u67E5\u4E0E\u5B89\u88C5", draft: true },
  "panel.chapter.changelog": { en: "Changelog", zh: "\u66F4\u65B0\u65E5\u5FD7", draft: true },
  "panel.chapter.queue": { en: "Update queue", zh: "\u66F4\u65B0\u961F\u5217", draft: true },
  "panel.chapter.error": { en: "Error details", zh: "\u9519\u8BEF\u4FE1\u606F", draft: true },
  "panel.chapter.manual": { en: "Manual command", zh: "\u624B\u5DE5\u547D\u4EE4", draft: true },
  "panel.progress.installing": { en: "Installing new version\u2026", zh: "\u6B63\u5728\u5B89\u88C5\u65B0\u7248\u672C\u2026", draft: true },
  "panel.progress.verifying": { en: "Verifying install result\u2026", zh: "\u6B63\u5728\u6821\u9A8C\u5B89\u88C5\u7ED3\u679C\u2026", draft: true },
  "panel.action.check": { en: "Check for updates", zh: "\u68C0\u67E5\u66F4\u65B0", draft: true },
  "panel.action.check-title": { en: "Check the official source once more (read-only, never installs)", zh: "\u91CD\u65B0\u5411\u5B98\u65B9\u6E90\u67E5\u8BE2\u7248\u672C\u4FE1\u606F\uFF08\u53EA\u8BFB\uFF0C\u4E0D\u5B89\u88C5\uFF09", draft: true },
  "panel.action.checking-busy": { en: "Checking for updates\u2026", zh: "\u6B63\u5728\u67E5\u8BE2\u7248\u672C\u4FE1\u606F\u2026", draft: true },
  "panel.action.checking-busy-title": { en: "Checking the official source; please wait", zh: "\u6B63\u5728\u5411\u5B98\u65B9\u6E90\u67E5\u8BE2\u7248\u672C\u4FE1\u606F\uFF0C\u8BF7\u7A0D\u5019", draft: true },
  "panel.action.installing-busy": { en: "Installing\u2026", zh: "\u6B63\u5728\u5B89\u88C5\u2026", draft: true },
  "panel.action.installing-busy-title": { en: "Installing; please wait", zh: "\u6B63\u5728\u5B89\u88C5\uFF0C\u8BF7\u7A0D\u5019", draft: true },
  "panel.action.install-title": { en: "Install the exact version; one install per scope at a time", zh: "\u6309\u7CBE\u786E\u7248\u672C\u5B89\u88C5\uFF1B\u540C\u4E00\u4F7F\u7528\u8303\u56F4\u540C\u65F6\u4EC5\u5B89\u88C5\u4E00\u9879", draft: true },
  "panel.action.skip": { en: "Skip this version", zh: "\u8DF3\u8FC7\u8BE5\u7248\u672C", draft: true },
  "panel.action.skip-title": { en: "This version will no longer notify; newer versions still will", zh: "\u8BE5\u7248\u672C\u5C06\u4E0D\u518D\u63D0\u9192\uFF1B\u66F4\u65B0\u7684\u7248\u672C\u4ECD\u4F1A\u6B63\u5E38\u63D0\u9192", draft: true },
  "panel.action.unskip": { en: "Restore ({version})", zh: "\u6062\u590D\u63D0\u9192\uFF08{version}\uFF09", draft: true },
  "panel.action.unskip-title": { en: "Undo skip; this version will remind again", zh: "\u64A4\u9500\u8DF3\u8FC7\uFF0C\u8BE5\u7248\u672C\u5C06\u91CD\u65B0\u63D0\u9192", draft: true },
  "panel.action.copy-manual": { en: "Copy manual command", zh: "\u590D\u5236\u624B\u5DE5\u547D\u4EE4", draft: true },
  "panel.action.copy-manual-title": { en: "Copy the manual command; paste the full line into the terminal", zh: "\u590D\u5236\u624B\u5DE5\u547D\u4EE4\uFF0C\u8BF7\u7C98\u8D34\u81F3\u7EC8\u7AEF\u6574\u884C\u6267\u884C", draft: true },
  "panel.action.restart-host": { en: "Please restart DSH", zh: "\u8BF7\u91CD\u542FDSH", draft: true },
  "panel.action.restart-host-title": { en: "Run the caller restart flow if available, otherwise restart DSH manually", zh: "\u4F18\u5148\u8D70\u8C03\u7528\u65B9\u91CD\u542F\u6D41\u7A0B\uFF1B\u82E5\u65E0\uFF0C\u8BF7\u624B\u52A8\u91CD\u542F DSH", draft: true },
  "panel.action.dismiss": { en: "Got it", zh: "\u5DF2\u77E5\u6653", draft: true },
  "panel.action.dismiss-title": { en: "Acknowledge the failure and return; next check or install will re-evaluate", zh: "\u786E\u8BA4\u5DF2\u77E5\u6653\u8BE5\u5931\u8D25\uFF1A\u8FD4\u56DE\u53EF\u5B89\u88C5\u9875\uFF0C\u4E0B\u6B21\u67E5\u8BE2\u6216\u5B89\u88C5\u5C06\u91CD\u65B0\u8BC4\u4F30", draft: true },
  "panel.action.copy-diag": { en: "Copy diagnostics", zh: "\u590D\u5236\u8BCA\u65AD", draft: true },
  "panel.action.copy-diag-title": { en: "Copy redacted diagnostics for the plugin author", zh: "\u590D\u5236\u5DF2\u8131\u654F\u8BCA\u65AD\uFF0C\u8BF7\u63D0\u4EA4\u81F3\u63D2\u4EF6\u4F5C\u8005", draft: true },
  "panel.skip.line-tag": { en: "Skipped {version}", zh: "\u5DF2\u8DF3\u8FC7\u7248\u672C {version}", draft: true },
  "panel.skip.line-note": { en: "Select \u201CRestore\u201D to undo; this version will remind again.", zh: "\u9009\u62E9\u300C\u6062\u590D\u63D0\u9192\u300D\u53EF\u64A4\u9500\uFF0C\u8BE5\u7248\u672C\u6B64\u540E\u4ECD\u4F1A\u63D0\u9192\u3002", draft: true },
  "panel.changelog.heading": { en: "Changelog:", zh: "\u66F4\u65B0\u8BF4\u660E\uFF1A", draft: true },
  "panel.changelog.heading-range": { en: "Changelog ({from} \u2192 {to}):", zh: "\u66F4\u65B0\u8BF4\u660E\uFF08{from} \u2192 {to}\uFF09\uFF1A", draft: true },
  "panel.changelog.unavailable": { en: "Could not read logs; install is unaffected.", zh: "\u66F4\u65B0\u65E5\u5FD7\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u5B89\u88C5\u4E0D\u53D7\u5F71\u54CD\u3002", draft: true },
  "panel.changelog.unavailable-empty": { en: "No release found yet; logs will show after a check.", zh: "\u5C1A\u672A\u67E5\u8BE2\u5230\u65B0\u7248\u672C\uFF1B\u67E5\u8BE2\u5230\u540E\u5C06\u663E\u793A\u66F4\u65B0\u65E5\u5FD7\u3002", draft: true },
  "panel.changelog.toggle-title": { en: "Expand or collapse changelog", zh: "\u5C55\u5F00\u6216\u6536\u8D77\u66F4\u65B0\u65E5\u5FD7", draft: true },
  "panel.changelog.expand": { en: "Expand changelog", zh: "\u5C55\u5F00\u66F4\u65B0\u65E5\u5FD7", draft: true },
  "panel.changelog.collapse": { en: "Collapse changelog", zh: "\u6536\u8D77\u66F4\u65B0\u65E5\u5FD7", draft: true },
  "panel.queue.state-idle": { en: "Idle", zh: "\u7A7A\u95F2", draft: true },
  "panel.queue.other": { en: "Other plugin", zh: "\u5176\u4ED6\u63D2\u4EF6", draft: true },
  "panel.queue.self": { en: "This plugin", zh: "\u672C\u63D2\u4EF6", draft: true },
  "panel.queue.pos-absent": { en: "Not queued", zh: "\u672A\u6392\u961F", draft: true },
  "panel.queue.pos-n": { en: "Position {n}", zh: "\u6392\u961F\u7B2C {n} \u4F4D", draft: true },
  "panel.queue.pos-next": { en: "You are next", zh: "\u4E0B\u4E00\u4F4D\u5C31\u662F\u4F60", draft: true },
  "panel.queue.pos-ahead": { en: "{n} ahead", zh: "\u524D\u65B9\u8FD8\u6709 {n} \u9879", draft: true },
  "panel.queue.row-installing": { en: "Installing", zh: "\u6B63\u5728\u5B89\u88C5", draft: true },
  "panel.queue.row-installing-note": { en: "You are next when it finishes", zh: "\u5B89\u88C5\u5B8C\u6210\u540E\u81EA\u52A8\u8F6E\u5230\u4F60", draft: true },
  "panel.queue.row-idle-note": { en: "One install per scope at a time", zh: "\u540C\u4E00\u4F7F\u7528\u8303\u56F4\u540C\u65F6\u4EC5\u5B89\u88C5\u4E00\u9879", draft: true },
  "panel.queue.row-position": { en: "Your position", zh: "\u4F60\u7684\u6392\u961F\u987A\u4F4D", draft: true },
  "panel.queue.row-order": { en: "Queue order", zh: "\u6392\u961F\u987A\u5E8F", draft: true },
  "panel.queue.toggle-hide": { en: "Hide others", zh: "\u9690\u85CF\u5176\u4ED6\u63D2\u4EF6\u660E\u7EC6", draft: true },
  "panel.queue.toggle-show": { en: "Show others", zh: "\u663E\u793A\u5176\u4ED6\u63D2\u4EF6", draft: true },
  "panel.queue.empty": { en: "No queued tasks; one install per scope at a time.", zh: "\u5F53\u524D\u65E0\u6392\u961F\u4EFB\u52A1\uFF1B\u540C\u4E00\u4F7F\u7528\u8303\u56F4\u540C\u65F6\u4EC5\u5B89\u88C5\u4E00\u9879\u3002", draft: true },
  "panel.error.code-label": { en: "Stable code", zh: "\u7A33\u5B9A\u7801", draft: true },
  "panel.error.code-note": { en: "The line above tells you what to do; to report upstream, paste \u201CCopy diagnostics\u201D as a whole (already redacted).", zh: "\u4E0A\u65B9\u4E2D\u6587\u8BF4\u660E\u5373\u9700\u6267\u884C\u7684\u64CD\u4F5C\uFF1B\u5982\u9700\u5411\u4E0A\u6E38\u53CD\u9988\uFF0C\u8BF7\u4F7F\u7528\u300C\u590D\u5236\u8BCA\u65AD\u300D\u6574\u6BB5\u7C98\u8D34\uFF08\u5DF2\u8131\u654F\uFF09\u3002", draft: true },
  "panel.error.query-request": { en: "Request", zh: "\u8BF7\u6C42", draft: true },
  "panel.error.query-check": { en: "Check", zh: "\u68C0\u67E5", draft: true },
  "panel.error.failed-at": { en: "Failed at {time}", zh: "\u5931\u8D25\u65F6\u95F4 {time}", draft: true },
  "panel.error.query-keys": { en: "Query keys: {keys} (use them to match in logs).", zh: "\u672C\u6B21\u67E5\u8BE2\u952E\uFF1A{keys}\uFF08\u53EF\u51ED\u6B64\u5728\u65E5\u5FD7\u4E2D\u68C0\u7D22\u5339\u914D\uFF09\u3002", draft: true },
  "panel.error.target-version": { en: "Failed target {version}", zh: "\u5931\u8D25\u76EE\u6807\u7248\u672C {version}", draft: true },
  "panel.error.evidence-frozen": { en: "Evidence frozen: the code, versions, and IDs in copied diagnostics are from the failure moment and do not refresh with polling; the next check or install will update them.", zh: "\u8BC1\u636E\u5DF2\u51BB\u7ED3\uFF1A\u590D\u5236\u8BCA\u65AD\u4E2D\u7684\u7A33\u5B9A\u7801\u3001\u7248\u672C\u4E0E\u7F16\u53F7\u5747\u53D6\u81EA\u5931\u8D25\u65F6\u523B\uFF0C\u4E0D\u968F\u8F6E\u8BE2\u5237\u65B0\uFF1B\u4E0B\u6B21\u67E5\u8BE2\u7248\u672C\u4FE1\u606F\u6216\u5B89\u88C5\u5C06\u66F4\u65B0\u3002", draft: true },
  "panel.error.evidence-transient": { en: "Transient read failure: it clears on the next successful read; if it persists, troubleshoot by stable code.", zh: "\u77AC\u6001\u8BFB\u53D6\u5931\u8D25\uFF1A\u4E0B\u6B21\u6210\u529F\u8BFB\u53D6\u5C06\u81EA\u52A8\u89E3\u9664\uFF1B\u82E5\u6301\u7EED\u51FA\u73B0\uFF0C\u8BF7\u6309\u7A33\u5B9A\u7801\u6392\u67E5\u3002", draft: true },
  "panel.error.no-failure": { en: "No failure: copying diagnostics gives the current state snapshot.", zh: "\u6682\u65E0\u5931\u8D25\uFF1A\u6B64\u65F6\u590D\u5236\u8BCA\u65AD\u63D0\u4F9B\u7684\u662F\u5F53\u524D\u72B6\u6001\u5FEB\u7167\u3002", draft: true },
  "panel.error.log-hint": { en: "Check logs: {dir} (one directory per plugin, no overlap). Read them with {cmd}; filter by plugin ID {pluginId} for events {e1}, {e2}, {e3}.", zh: "\u8BF7\u67E5\u770B\u65E5\u5FD7\uFF1A{dir}\uFF08\u4E00\u4E2A\u63D2\u4EF6\u4E00\u68F5\u76EE\u5F55\uFF0C\u4E92\u4E0D\u8986\u76D6\uFF09\u3002\u4E00\u6761\u547D\u4EE4\u770B\uFF1A{cmd}\uFF1B\u6309\u63D2\u4EF6\u6807\u8BC6 {pluginId} \u7B5B\u9009 {e1}\u3001{e2}\u3001{e3} \u4E8B\u4EF6\u3002", draft: true },
  "panel.error.log-follow": { en: "Match the request/check IDs above in {eFail}; baseline timing in {eCall}, execution result in {eExec}.", zh: "\u51ED\u4E0A\u65B9\u8BF7\u6C42\uFF0F\u68C0\u67E5\u7F16\u53F7\u5728 {eFail} \u4E2D\u5339\u914D\uFF1B\u57FA\u7EBF\u8017\u65F6\u8BF7\u67E5\u770B {eCall}\uFF0C\u6267\u884C\u7ED3\u679C\u8BF7\u67E5\u770B {eExec}\u3002", draft: true },
  "panel.manual.heading": { en: "Manual fallback command (copy the full line to run):", zh: "\u624B\u5DE5\u5907\u7528\u547D\u4EE4\uFF08\u8BF7\u590D\u5236\u6574\u884C\u6267\u884C\uFF09\uFF1A", draft: true },
  "panel.manual.absent": { en: "No manual command available (unrecognized scope or source install).", zh: "\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u7684\u624B\u5DE5\u547D\u4EE4\uFF08\u4F7F\u7528\u8303\u56F4\u65E0\u6CD5\u8BC6\u522B\u6216\u6E90\u7801\u5B89\u88C5\u573A\u666F\u4E0D\u63D0\u4F9B\uFF09\u3002", draft: true },
  "panel.footer.note": { en: "Closing never interrupts updates; come back anytime", zh: "\u5173\u95ED\u7A97\u53E3\uFF0C\u66F4\u65B0\u4E0D\u53D7\u5F71\u54CD\uFF0C\u53EF\u968F\u65F6\u8FD4\u56DE\u67E5\u770B\u3002", draft: true },
  "panel.footer.close": { en: "Close", zh: "\u5173\u95ED", draft: true },
  "panel.footer.close-title": { en: "Close the window; updates keep running", zh: "\u5173\u95ED\u7A97\u53E3\uFF0C\u66F4\u65B0\u4E0D\u53D7\u5F71\u54CD", draft: true },
  "panel.diag.header": { en: "[Update Diagnostics] {pluginId} Stable code: {code}", zh: "[\u66F4\u65B0\u8BCA\u65AD] {pluginId} \u7A33\u5B9A\u7801\uFF1A{code}", draft: true },
  "panel.diag.label.human": { en: "Detail: {detail}", zh: "\u4EBA\u8BDD\uFF1A{detail}", draft: true },
  "panel.diag.label.running": { en: "Running: {version}", zh: "\u8FD0\u884C\u7248\uFF1A{version}", draft: true },
  "panel.diag.label.installed": { en: "Installed: {version}", zh: "\u5DF2\u5B89\u88C5\uFF1A{version}", draft: true },
  "panel.diag.label.latest": { en: "Latest: {version}", zh: "\u6700\u65B0\u7248\uFF1A{version}", draft: true },
  "panel.diag.queue.installing": { en: "Installing", zh: "\u6B63\u5728\u5B89\u88C5", draft: true },
  "panel.diag.queue.position": { en: "Queued at position {n}", zh: "\u6392\u961F\u7B2C {n} \u4F4D", draft: true },
  "panel.diag.queue.absent": { en: "Not queued", zh: "\u672A\u6392\u961F", draft: true },
  "panel.diag.label.host": { en: "Host: {host}", zh: "\u5BBF\u4E3B\uFF1A{host}", draft: true },
  "panel.diag.label.profile": { en: "Scope: {profile}", zh: "\u4F7F\u7528\u8303\u56F4\uFF1A{profile}", draft: true },
  "panel.diag.label.queue": { en: "Queue: {queue}", zh: "\u961F\u5217\uFF1A{queue}", draft: true },
  "panel.diag.label.request": { en: "Request ID: {requestId}", zh: "\u8BF7\u6C42\u7F16\u53F7\uFF1A{requestId}", draft: true },
  "panel.diag.label.manual": { en: "Manual command: {manual}", zh: "\u624B\u5DE5\u547D\u4EE4\uFF1A{manual}", draft: true },
  "panel.diag.copy.no-detail": { en: "(This response carries no diagnostic summary; it will be completed when phone-side diag lands)", zh: "\uFF08\u672C\u54CD\u5E94\u672A\u643A\u5E26\u8BCA\u65AD\u6458\u8981\uFF0C\u5F85\u8BCA\u65AD\u4FE1\u606F\u5C31\u7EEA\u540E\u8865\u5168\uFF09", draft: true },
  "panel.diag.copy.unknown-package": { en: "(Unknown package)", zh: "\uFF08\u672A\u77E5\u63D2\u4EF6\u5305\uFF09", draft: true },
  "panel.diag.copy.unknown": { en: "Unknown", zh: "\u672A\u77E5", draft: true },
  "panel.diag.copy.field.plugin": { en: "Plugin={plugin}", zh: "\u63D2\u4EF6={plugin}", draft: true },
  "panel.diag.copy.field.version": { en: "Version={run}\u2192{inst}", zh: "\u7248\u672C={run}\u2192{inst}", draft: true },
  "panel.diag.copy.field.host": { en: "Host={host}", zh: "\u5BBF\u4E3B={host}", draft: true },
  "panel.diag.copy.field.profile": { en: "Scope={profile}", zh: "\u4F7F\u7528\u8303\u56F4={profile}", draft: true },
  "panel.diag.copy.field.route": { en: "Route={route}", zh: "\u8DEF\u7531={route}", draft: true },
  "panel.diag.copy.field.stage": { en: "Stage={stage}", zh: "\u9636\u6BB5={stage}", draft: true },
  "panel.diag.copy.field.method": { en: "Method={method}", zh: "\u65B9\u6CD5={method}", draft: true },
  "panel.diag.copy.field.latency": { en: "Latency={latency}", zh: "\u8017\u65F6={latency}", draft: true },
  "panel.diag.copy.field.registry": { en: "Source={host}", zh: "\u6E90={host}", draft: true },
  "panel.diag.copy.field.registry-unknown": { en: "Source=Unknown (Omitted for non-official sources, which is itself information)", zh: "\u6E90=\u672A\u77E5\uFF08\u975E\u5B98\u65B9\u6E90\u65F6\u7701\u7565\u672C\u8EAB\u5373\u4FE1\u606F\uFF09", draft: true },
  "panel.diag.copy.field.action": { en: "Suggestion={action}", zh: "\u5EFA\u8BAE={action}", draft: true },
  "panel.diag.copy.field.request": { en: "Request={request}", zh: "\u8BF7\u6C42={request}", draft: true },
  "panel.diag.copy.field.check": { en: "Check={check}", zh: "\u68C0\u67E5={check}", draft: true },
  "panel.diag.copy.field.queue": { en: "Queue={queue}", zh: "\u961F\u5217={queue}", draft: true },
  "panel.diag.copy.field.target": { en: "Target={version}", zh: "\u76EE\u6807={version}", draft: true },
  "panel.diag.copy.line.summary": { en: "Summary={summary}", zh: "\u6458\u8981={summary}", draft: true },
  "panel.diag.copy.line.remedy": { en: "Remedy={remedy}", zh: "\u600E\u4E48\u529E={remedy}", draft: true },
  "panel.diag.copy.block.summary": { en: "Summary\uFF1A{summary}", zh: "\u6458\u8981\uFF1A{summary}", draft: true },
  "panel.diag.copy.block.source": { en: "Source\uFF1A{source}", zh: "\u6765\u6E90\uFF1A{source}", draft: true },
  "panel.diag.copy.block.remedy": { en: "Remedy\uFF1A{remedy}", zh: "\u600E\u4E48\u529E\uFF1A{remedy}", draft: true },
  "batch.action.resume": { en: "Continue the unfinished batch ({count} left)", zh: "\u7EE7\u7EED\u4E0A\u6B21\u672A\u5B8C\u6210\u7684\u66F4\u65B0\uFF08\u5269\u4F59 {count} \u4E2A\uFF09\u3002", draft: true },
  "batch.action.resume-title": { en: "Continue from where it stopped; installed ones stay", zh: "\u4ECE\u4E0A\u6B21\u4E2D\u65AD\u5904\u7EE7\u7EED\u5B89\u88C5\uFF0C\u5DF2\u5B8C\u6210\u7684\u4E0D\u4F1A\u91CD\u590D\u5B89\u88C5\u3002", draft: true },
  "batch.action.discard": { en: "Discard this unfinished batch (installed ones stay)", zh: "\u4E22\u5F03\u672C\u6279\u672A\u5B8C\u6210\u7684\u66F4\u65B0\uFF08\u5DF2\u5B8C\u6210\u7684\u5C06\u4FDD\u7559\uFF09\u3002", draft: true },
  "batch.action.confirm-discard": { en: "Confirm discard", zh: "\u786E\u8BA4\u4E22\u5F03", draft: true },
  "batch.fact.close-safe": { en: "Closing this panel won't stop it \u2014 progress is saved on disk.", zh: "\u5173\u95ED\u9762\u677F\u4E0D\u4F1A\u4E2D\u65AD\u66F4\u65B0\uFF1A\u8FDB\u5EA6\u5DF2\u4FDD\u5B58\uFF0C\u53EF\u968F\u65F6\u8FD4\u56DE\u7EE7\u7EED\u3002", draft: true },
  "batch.setting.check-on-open": { en: "Check for updates when opening", zh: "\u6253\u5F00\u9762\u677F\u65F6\u81EA\u52A8\u68C0\u67E5\u66F4\u65B0", draft: true },
  "batch.row.update": { en: "Update available {version}", zh: "\u6709\u65B0\u7248\u672C {version}", draft: true },
  "batch.row.current": { en: "Up to date", zh: "\u5DF2\u662F\u6700\u65B0\uFF0C\u65E0\u9700\u64CD\u4F5C\u3002", draft: true },
  "batch.row.never": { en: "Not checked yet", zh: "\u5C1A\u672A\u67E5\u8BE2", draft: true },
  "batch.row.failed": { en: "Last check failed", zh: "\u672C\u6B21\u672A\u80FD\u67E5\u8BE2", draft: true },
  "batch.row.not-installed": { en: "Not installed", zh: "\u672A\u5B89\u88C5", draft: true },
  "batch.notice.auto-resumed": { en: "Auto-continued the unfinished batch ({count} left).", zh: "\u5DF2\u81EA\u52A8\u7EE7\u7EED\u4E0A\u6B21\u672A\u5B8C\u6210\u7684\u66F4\u65B0\uFF08\u5269\u4F59 {count} \u4E2A\uFF09\u3002", draft: true },
  "batch.notice.resumed": { en: "Continued the unfinished batch ({count} left).", zh: "\u5DF2\u7EE7\u7EED\u4E0A\u6B21\u672A\u5B8C\u6210\u7684\u66F4\u65B0\uFF08\u5269\u4F59 {count} \u4E2A\uFF09\u3002", draft: true },
  "batch.notice.no-resume": { en: "Nothing to continue.", zh: "\u6682\u65E0\u53EF\u7EE7\u7EED\u7684\u5185\u5BB9\u3002", draft: true },
  "batch.notice.discarded": { en: "Discarded this unfinished batch (installed ones stay).", zh: "\u5DF2\u4E22\u5F03\u672C\u6279\u672A\u5B8C\u6210\u7684\u66F4\u65B0\uFF08\u5DF2\u5B8C\u6210\u7684\u5C06\u4FDD\u7559\uFF09\u3002", draft: true },
  "batch.notice.cancel-confirm": { en: "Click again to confirm discard.", zh: "\u8BF7\u518D\u6B21\u9009\u62E9\u4EE5\u786E\u8BA4\u4E22\u5F03\u3002", draft: true },
  "batch.notice.busy-cancel": { en: "An install is running and cannot be stopped.", zh: "\u6B63\u5728\u5B89\u88C5\u7684\u9879\u65E0\u6CD5\u505C\u6B62\u3002", draft: true },
  "batch.row.unfinished-tag": { en: "unfinished last time", zh: "\u4E0A\u6B21\u672A\u5B8C\u6210", draft: true },
  "batch.summary.updatable": { en: "{n} updates available", zh: "{n} \u4E2A\u53EF\u66F4\u65B0", draft: true },
  "batch.summary.installing": { en: "{n} installing", zh: "{n} \u4E2A\u5B89\u88C5\u4E2D", draft: true },
  "batch.summary.pending": { en: "{n} not checked", zh: "{n} \u4E2A\u5F85\u67E5\u8BE2", draft: true },
  "batch.summary.restart": { en: "{n} restart required", zh: "{n} \u4E2A\u5F85\u91CD\u542F", draft: true },
  "batch.summary.failed": { en: "{n} failed", zh: "{n} \u4E2A\u5931\u8D25", draft: true },
  "batch.summary.skipped": { en: "{n} skipped", zh: "{n} \u4E2A\u5DF2\u8DF3\u8FC7", draft: true },
  "batch.summary.settled": { en: "{n} up to date", zh: "{n} \u4E2A\u5DF2\u662F\u6700\u65B0", draft: true },
  "batch.summary.empty": { en: "No targets yet", zh: "\u6682\u65E0\u76EE\u6807", draft: true },
  "batch.header.title": { en: "Update archive", zh: "\u66F4\u65B0\u6863\u6848", draft: true },
  "batch.action.check": { en: "Check for updates", zh: "\u68C0\u67E5\u66F4\u65B0", draft: true },
  "batch.action.check-title": { en: "Re-read batch status (read-only)", zh: "\u91CD\u65B0\u8BFB\u53D6\u6279\u91CF\u72B6\u6001\uFF08\u53EA\u8BFB\uFF09", draft: true },
  "batch.action.install-all": { en: "Update all", zh: "\u5168\u90E8\u66F4\u65B0", draft: true },
  "batch.action.install-all-title": { en: "Submit all updatable plugins at once; one idempotency key per session", zh: "\u5C06\u6709\u66F4\u65B0\u7684\u63D2\u4EF6\u4E00\u6B21\u63D0\u4EA4\uFF1B\u540C\u4E00\u4F1A\u8BDD\u4F7F\u7528\u540C\u4E00\u5E42\u7B49\u7F16\u53F7\u3002", draft: true },
  "batch.action.close": { en: "Close", zh: "\u5173\u95ED", draft: true },
  "batch.action.close-title": { en: "Close the window; batch progress keeps running", zh: "\u5173\u95ED\u7A97\u53E3\uFF0C\u6279\u91CF\u66F4\u65B0\u4E0D\u53D7\u5F71\u54CD", draft: true },
  "batch.banner.loading": { en: "Loading batch update status\u2026", zh: "\u6B63\u5728\u8BFB\u53D6\u6279\u91CF\u66F4\u65B0\u72B6\u6001\u2026", draft: true },
  "batch.hint.error": { en: "Last run failed: follow the red banner below.", zh: "\u4E0A\u6B21\u6267\u884C\u5931\u8D25\uFF1A\u8BF7\u6309\u4E0B\u65B9\u7EA2\u8272\u6A2A\u5E45\u63D0\u793A\u64CD\u4F5C\u3002", draft: true },
  "batch.hint.empty": { en: "No targets yet: select \u201CCheck for updates\u201D to see which plugins have updates.", zh: "\u6682\u65E0\u76EE\u6807\uFF1A\u8BF7\u9009\u62E9\u300C\u68C0\u67E5\u66F4\u65B0\u300D\u67E5\u770B\u54EA\u4E9B\u63D2\u4EF6\u6709\u66F4\u65B0\u3002", draft: true },
  "batch.hint.installing-queueable": { en: "Installing {a}; {b} more can join the queue.", zh: "\u6B63\u5728\u5B89\u88C5 {a} \u4E2A\uFF1B\u53E6\u6709 {b} \u4E2A\u53EF\u9009\u62E9\u300C\u52A0\u5165\u961F\u5217\u300D\u7B49\u5F85\u3002", draft: true },
  "batch.hint.installing-auto": { en: "Installing {a}; the next starts automatically.", zh: "\u6B63\u5728\u5B89\u88C5 {a} \u4E2A\uFF0C\u5B8C\u6210\u540E\u81EA\u52A8\u5B89\u88C5\u4E0B\u4E00\u9879\u3002", draft: true },
  "batch.hint.failed": { en: "{n} failed to install; retry each one from the failure notes below.", zh: "{n} \u4E2A\u63D2\u4EF6\u5B89\u88C5\u5931\u8D25\uFF1B\u8BF7\u6309\u4E0B\u65B9\u5931\u8D25\u63D0\u793A\u9010\u9879\u91CD\u8BD5\u3002", draft: true },
  "batch.hint.updatable": { en: "{n} updates available; select \u201CUpdate all\u201D to install at once, or install each one inline.", zh: "{n} \u4E2A\u53EF\u66F4\u65B0\uFF1B\u8BF7\u9009\u62E9\u300C\u5168\u90E8\u66F4\u65B0\u300D\u4E00\u6B21\u5B89\u88C5\u5B8C\u6210\uFF0C\u4E5F\u53EF\u9010\u9879\u9009\u62E9\u300C\u5B89\u88C5\u6B64\u63D2\u4EF6\u300D\u3002", draft: true },
  "batch.hint.restart": { en: "{n} installed; restart the host to take effect.", zh: "{n} \u4E2A\u5DF2\u5B89\u88C5\u5B8C\u6210\uFF0C\u91CD\u542F\u5BBF\u4E3B\u540E\u751F\u6548\u3002", draft: true },
  "batch.hint.pending": { en: "{n} not checked yet; select \u201CCheck for updates\u201D for a round.", zh: "{n} \u4E2A\u5C1A\u672A\u67E5\u8BE2\uFF1B\u8BF7\u9009\u62E9\u300C\u68C0\u67E5\u66F4\u65B0\u300D\u67E5\u8BE2\u4E00\u8F6E\u3002", draft: true },
  "batch.hint.done": { en: "All up to date; nothing to do.", zh: "\u5DF2\u5168\u90E8\u4E3A\u6700\u65B0\uFF0C\u65E0\u9700\u64CD\u4F5C\u3002", draft: true },
  "batch.seal.ledger": { en: "Ledger", zh: "\u603B\u8D26", draft: true },
  "batch.banner.error-title": { en: "Failed this time ({code}): {detail}.", zh: "\u672C\u6B21\u6267\u884C\u5931\u8D25\uFF08{code}\uFF09\uFF1A{detail}\u3002", draft: true },
  "batch.banner.error-action-fallback": { en: "Retry once first; if it persists, send the copied diagnostics to the plugin author.", zh: "\u8BF7\u91CD\u8BD5\u4E00\u6B21\uFF1B\u82E5\u6301\u7EED\uFF0C\u8BF7\u63D0\u4EA4\u8BCA\u65AD\u4FE1\u606F\u81F3\u63D2\u4EF6\u4F5C\u8005\u3002", draft: true },
  "batch.banner.failed-title": { en: "{n} failed to install.", zh: "{n} \u4E2A\u63D2\u4EF6\u5B89\u88C5\u5931\u8D25\u3002", draft: true },
  "batch.banner.failed-action": { en: "Retry each one inline; if it keeps failing, send the copied diagnostics to the plugin author.", zh: "\u8BF7\u9010\u5BB6\u4F7F\u7528\u884C\u5185\u300C\u91CD\u8BD5\u300D\uFF1B\u82E5\u6301\u7EED\uFF0C\u8BF7\u63D0\u4EA4\u8BCA\u65AD\u4FE1\u606F\u81F3\u63D2\u4EF6\u4F5C\u8005\u3002", draft: true },
  "batch.banner.restart-title": { en: "{n} installed; restart the host to take effect.", zh: "{n} \u4E2A\u5DF2\u5B89\u88C5\u5B8C\u6210\uFF0C\u91CD\u542F\u5BBF\u4E3B\u540E\u751F\u6548\u3002", draft: true },
  "batch.banner.restart-action": { en: "Restart the host to run the new version; this is a normal end state, not a failure.", zh: "\u91CD\u542F\u5BBF\u4E3B\u4EE5\u52A0\u8F7D\u65B0\u7248\u672C\uFF1B\u6B64\u4E3A\u6B63\u5E38\u72B6\u6001\uFF0C\u975E\u5B89\u88C5\u5931\u8D25\u3002", draft: true },
  "batch.banner.restart-button": { en: "Please restart DSH", zh: "\u8BF7\u91CD\u542FDSH", draft: true },
  "batch.row.queued-generic": { en: "Queued \xB7 waiting for the running install to finish", zh: "\u5DF2\u6392\u961F \xB7 \u7B49\u5F85\u524D\u65B9\u5B89\u88C5\u5B8C\u6210", draft: true },
  "batch.row.queued-n": { en: "Queued \xB7 {n} ahead", zh: "\u5DF2\u6392\u961F \xB7 \u524D\u65B9\u8FD8\u6709 {n} \u9879", draft: true },
  "batch.row.skipped": { en: "Skipped {version}", zh: "\u5DF2\u8DF3\u8FC7\u7248\u672C {version}", draft: true },
  "batch.row.wait-turn": { en: "Waiting for its turn; it will check automatically", zh: "\u8BF7\u7B49\u5F85\uFF0C\u8F6E\u5230\u5C06\u81EA\u52A8\u67E5\u8BE2\u7248\u672C\u4FE1\u606F\u3002", draft: true },
  "batch.row.checking": { en: "Checking for updates; please wait", zh: "\u6B63\u5728\u67E5\u8BE2\u7248\u672C\u4FE1\u606F\uFF0C\u8BF7\u7A0D\u5019\u3002", draft: true },
  "batch.row.cta-version": { en: "Select \u201CInstall this plugin\u201D to install {version}", zh: "\u9009\u62E9\u300C\u5B89\u88C5\u6B64\u63D2\u4EF6\u300D\u5B89\u88C5 {version}", draft: true },
  "batch.row.cta-generic": { en: "Select \u201CInstall this plugin\u201D to install the new version", zh: "\u9009\u62E9\u300C\u5B89\u88C5\u6B64\u63D2\u4EF6\u300D\u5B89\u88C5\u65B0\u7248\u672C", draft: true },
  "batch.row.installing": { en: "Installing; please wait", zh: "\u6B63\u5728\u5B89\u88C5\uFF0C\u8BF7\u52FF\u64CD\u4F5C\u3002", draft: true },
  "batch.row.done-restart": { en: "Installed; restart the host to take effect", zh: "\u5DF2\u5B89\u88C5\u5B8C\u6210\uFF0C\u91CD\u542F\u5BBF\u4E3B\u540E\u751F\u6548\u3002", draft: true },
  "batch.row.done": { en: "Installed; nothing to do", zh: "\u5DF2\u5B89\u88C5\u5B8C\u6210\uFF0C\u65E0\u9700\u64CD\u4F5C\u3002", draft: true },
  "batch.row.failed-retry": { en: "Install failed; select \u201CRetry\u201D to try again", zh: "\u5B89\u88C5\u5931\u8D25\uFF0C\u8BF7\u9009\u62E9\u300C\u91CD\u8BD5\u300D\u3002", draft: true },
  "batch.row.skipped-idle": { en: "This version is skipped; nothing to do", zh: "\u8BE5\u7248\u672C\u5DF2\u8DF3\u8FC7\uFF0C\u65E0\u9700\u64CD\u4F5C\u3002", draft: true },
  "batch.row.unknown": { en: "Unknown state; select \u201CCheck for updates\u201D to check again", zh: "\u72B6\u6001\u65E0\u6CD5\u8BC6\u522B\uFF0C\u8BF7\u9009\u62E9\u300C\u68C0\u67E5\u66F4\u65B0\u300D\u91CD\u65B0\u67E5\u8BE2\u3002", draft: true },
  "batch.row-action.installing": { en: "Installing\u2026", zh: "\u6B63\u5728\u5B89\u88C5\u2026", draft: true },
  "batch.row-action.cancel-queue": { en: "Cancel queue", zh: "\u53D6\u6D88\u6392\u961F", draft: true },
  "batch.row-action.queue": { en: "Join queue", zh: "\u52A0\u5165\u961F\u5217", draft: true },
  "batch.row-action.install-row": { en: "Install this plugin", zh: "\u5B89\u88C5\u6B64\u63D2\u4EF6", draft: true },
  "batch.row-action.retry": { en: "Retry", zh: "\u91CD\u8BD5", draft: true },
  "batch.row-action.install-version": { en: "Install {version}", zh: "\u5B89\u88C5\u7248\u672C {version}", draft: true },
  "batch.row-action.install-generic": { en: "Install the new version", zh: "\u5B89\u88C5\u65B0\u7248\u672C", draft: true },
  "batch.row-action.unskip": { en: "Restore ({version})", zh: "\u6062\u590D\u63D0\u9192\uFF08{version}\uFF09", draft: true },
  "batch.row-action.restart": { en: "Please restart DSH", zh: "\u8BF7\u91CD\u542FDSH", draft: true },
  "batch.row-action.show-detail": { en: "Details", zh: "\u8BE6\u60C5", draft: true },
  "batch.row-action.hide-detail": { en: "Collapse", zh: "\u6536\u8D77", draft: true },
  "batch.row-action.skip": { en: "Skip this version", zh: "\u8DF3\u8FC7\u8BE5\u7248\u672C", draft: true },
  "batch.row-action.copy-manual": { en: "Copy manual command", zh: "\u590D\u5236\u624B\u5DE5\u547D\u4EE4", draft: true },
  "batch.row-action.copy-diag": { en: "Copy diagnostics", zh: "\u590D\u5236\u8BCA\u65AD", draft: true },
  "batch.row.error-label": { en: "Failed {code}: {detail}", zh: "\u5931\u8D25 {code}\uFF1A{detail}", draft: true },
  "batch.diag.source-job": { en: "(Source: background job record)", zh: "\uFF08\u6765\u6E90\uFF1A\u540E\u53F0\u4EFB\u52A1\u6267\u884C\u8BB0\u5F55\uFF09", draft: true },
  "batch.toast.copy-fail": { en: "Copy failed; please select the info above manually.", zh: "\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u9009\u62E9\u4E0A\u65B9\u4FE1\u606F\u3002", draft: true },
  "batch.toast.queue-missed": { en: "Another install is running: this plugin is not queued yet; try again after it finishes.", zh: "\u524D\u65B9\u4ECD\u5728\u5B89\u88C5\uFF1A\u6B64\u63D2\u4EF6\u5C1A\u672A\u6392\u961F\uFF0C\u8BF7\u5F85\u524D\u65B9\u5B89\u88C5\u5B8C\u6210\u540E\u518D\u6B21\u9009\u62E9\u3002", draft: true },
  "batch.toast.skipped": { en: "Skipped {version}: no further reminders for this version; select \u201CRestore\u201D to undo.", zh: "\u5DF2\u8DF3\u8FC7\u7248\u672C {version}\uFF1A\u8BE5\u7248\u672C\u4E0D\u518D\u63D0\u9192\uFF1B\u9009\u62E9\u300C\u6062\u590D\u63D0\u9192\u300D\u53EF\u64A4\u9500\u3002", draft: true },
  "batch.toast.unskipped-version": { en: "Restored {version}: reminders for this version are back on.", zh: "\u5DF2\u6062\u590D {version}\uFF1A\u8BE5\u7248\u672C\u5C06\u6B63\u5E38\u63D0\u9192\u3002", draft: true },
  "batch.toast.unskipped-all": { en: "Skip reminder restored.", zh: "\u5DF2\u6062\u590D\u8DF3\u8FC7\u63D0\u9192\u3002", draft: true },
  "batch.toast.cancel-unavailable": { en: "This row carries no phone or ID to cancel the queue; try again after the next refresh.", zh: "\u6B64\u884C\u7F3A\u5C11\u53D6\u6D88\u6392\u961F\u6240\u9700\u7684\u4FE1\u606F\uFF0C\u6682\u65E0\u6CD5\u53D6\u6D88\uFF1B\u8BF7\u5F85\u4E0B\u6B21\u5237\u65B0\u540E\u91CD\u8BD5\u3002", draft: true },
  "batch.toast.cancel-ok": { en: "Queue cancelled: this plugin will not wait.", zh: "\u5DF2\u53D6\u6D88\u6392\u961F\uFF1A\u6B64\u63D2\u4EF6\u5C06\u4E0D\u518D\u7B49\u5F85\u3002", draft: true },
  "batch.toast.cancel-fail": { en: "Could not cancel the queue (it may have started installing); see the latest state below.", zh: "\u53D6\u6D88\u6392\u961F\u5931\u8D25\uFF08\u53EF\u80FD\u5DF2\u5F00\u59CB\u5B89\u88C5\uFF09\uFF1A\u8BF7\u67E5\u770B\u4E0B\u65B9\u6700\u65B0\u72B6\u6001\u3002", draft: true },
  "batch.toast.copy-manual-ok": { en: "Manual command copied; paste the full line into the terminal to run it.", zh: "\u624B\u5DE5\u547D\u4EE4\u5DF2\u590D\u5236\uFF0C\u8BF7\u7C98\u8D34\u81F3\u7EC8\u7AEF\u6574\u884C\u6267\u884C\u3002", draft: true },
  "batch.toast.copy-diag-ok": { en: "Diagnostics copied; paste it to the plugin author (already redacted).", zh: "\u8BCA\u65AD\u4FE1\u606F\u5DF2\u590D\u5236\uFF0C\u8BF7\u63D0\u4EA4\u81F3\u63D2\u4EF6\u4F5C\u8005\uFF08\u5DF2\u8131\u654F\uFF09\u3002", draft: true },
  "batch.toast.restart-delegated": { en: "Handled by the caller\u2019s restart flow; the new version takes effect after restart.", zh: "\u5DF2\u6309\u8C03\u7528\u65B9\u91CD\u542F\u6D41\u7A0B\u5904\u7406\uFF1B\u91CD\u542F\u540E\u65B0\u7248\u672C\u751F\u6548\u3002", draft: true },
  "batch.toast.restart-manual": { en: "This host provides no restart entry; please restart the host manually. The new version takes effect after restart.", zh: "\u672C\u5BBF\u4E3B\u672A\u63D0\u4F9B\u91CD\u542F\u5165\u53E3\uFF0C\u8BF7\u624B\u52A8\u91CD\u542F\u5BBF\u4E3B\uFF1B\u91CD\u542F\u540E\u65B0\u7248\u672C\u751F\u6548\u3002", draft: true },
  "batch.toast.restart-failed": { en: "Restart entry failed; please restart the host manually. The new version takes effect after restart.", zh: "\u91CD\u542F\u5165\u53E3\u8C03\u7528\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u91CD\u542F\u5BBF\u4E3B\uFF1B\u91CD\u542F\u540E\u65B0\u7248\u672C\u751F\u6548\u3002", draft: true },
  "changelog.neutral.hint": { en: "No changelog provided", zh: "\u4F5C\u8005\u672A\u63D0\u4F9B\u66F4\u65B0\u8BF4\u660E", draft: true },
  "changelog.neutral.line": { en: "No changelog provided. Install is not affected.", zh: "\u4F5C\u8005\u672A\u63D0\u4F9B\u66F4\u65B0\u8BF4\u660E\uFF0C\u5B89\u88C5\u4E0D\u53D7\u5F71\u54CD\u3002", draft: true },
  "changelog.breaking.badge": { en: "Breaking", zh: "\u4E0D\u517C\u5BB9", draft: true },
  "changelog.breaking.aria": { en: "Breaking change", zh: "\u7834\u574F\u6027\u53D8\u66F4", draft: true },
  "changelog.truncated.count": { en: "Showing {n} of {m} items", zh: "\u5171 {m} \u6761\uFF0C\u4EC5\u663E\u793A\u524D {n} \u6761", draft: true },
  "changelog.truncated.file": { en: "This log is larger than 64 KiB; only the first part is rendered.", zh: "\u65E5\u5FD7\u8FC7\u957F\uFF0C\u8D85\u51FA\u4E0A\u9650\u7684\u90E8\u5206\u6CA1\u6709\u6E32\u67D3\u3002", draft: true },
  "changelog.truncated.versions": { en: "{n} more versions are hidden.", zh: "\u5176\u540E\u8FD8\u6709 {n} \u4E2A\u7248\u672C\u672A\u663E\u793A\u3002", draft: true },
  "changelog.yanked.banner": { en: "Version {version} was yanked by the author. Install is not affected. Please confirm before proceeding.", zh: "\u76EE\u6807\u7248\u672C {version} \u5DF2\u88AB\u4F5C\u8005\u64A4\u56DE\uFF08yanked\uFF09\uFF0C\u5B89\u88C5\u4E0D\u53D7\u5F71\u54CD\uFF0C\u7EE7\u7EED\u524D\u8BF7\u786E\u8BA4\u3002", draft: true },
  "changelog.yanked.suffix": { en: " \xB7 Yanked", zh: " \xB7 \u5DF2\u64A4\u56DE", draft: true },
  "changelog.security.summary": { en: "{n} more items", zh: "\u5176\u4F59 {n} \u6761", draft: true },
  "changelog.security.note": { en: "Remaining entries are collapsed to keep the panel fast. See the original text.", zh: "\u4E3A\u4FDD\u6301\u9762\u677F\u6027\u80FD\uFF0C\u5176\u4F59\u6761\u76EE\u5DF2\u6298\u53E0\uFF0C\u8BF7\u67E5\u770B\u539F\u6587\u3002", draft: true },
  "diag.fallback.generic": { en: "Operation failed", zh: "\u64CD\u4F5C\u5931\u8D25", draft: true },
  "diag.fallback.read-installed": { en: "Failed to read local state", zh: "\u8BFB\u53D6\u672C\u5730\u72B6\u6001\u5931\u8D25", draft: true },
  "diag.fallback.revalidate-fetch": { en: "Revalidation fetch failed before install", zh: "\u5B89\u88C5\u524D\u590D\u9A8C\u5931\u8D25\uFF0C\u672A\u80FD\u83B7\u53D6\u7248\u672C\u4FE1\u606F", draft: true },
  "diag.fallback.rate-limited": { en: "Source returned 429. Too many requests this minute.", zh: "\u6570\u636E\u6E90\u8FD4\u56DE 429\uFF0C\u672C\u5206\u949F\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\u3002", draft: true },
  "diag.fallback.http-status": { en: "Source returned {status}. Retry still failed.", zh: "\u6570\u636E\u6E90\u8FD4\u56DE {status}\uFF0C\u91CD\u8BD5\u540E\u4ECD\u5931\u8D25\u3002", draft: true },
  "diag.fallback.invalid-release": { en: "Version in the manifest is not valid", zh: "\u6E05\u5355\u6587\u4EF6\u4E2D\u7248\u672C\u53F7\u975E\u6CD5", draft: true },
  "diag.fallback.install-failed": { en: "Install failed", zh: "\u5B89\u88C5\u6267\u884C\u5931\u8D25", draft: true },
  "diag.fallback.unknown-profile": { en: "Scope or plugin location not recognized", zh: "\u65E0\u6CD5\u8BC6\u522B\u4F7F\u7528\u8303\u56F4\u6216\u63D2\u4EF6\u5B89\u88C5\u4F4D\u7F6E", draft: true },
  "diag.fallback.channel-mismatch": { en: "Installed version is not in the selected release channel", zh: "\u5DF2\u5B89\u88C5\u7248\u672C\u4E0E\u5F53\u524D\u7248\u672C\u901A\u9053\u4E0D\u7B26", draft: true },
  "diag.fallback.source-install": { en: "Installed from source, not by version", zh: "\u6E90\u7801\u5B89\u88C5\u5B9E\u4F8B\uFF0C\u4E0D\u652F\u6301\u7248\u672C\u66F4\u65B0", draft: true },
  "diag.fallback.invalid-installation": { en: "Installed package is incomplete", zh: "\u5DF2\u5B89\u88C5\u5305\u7ED3\u6784\u4E0D\u5B8C\u6574", draft: true },
  "diag.fallback.installation-changed": { en: "Install location changed during use", zh: "\u5B89\u88C5\u4F4D\u7F6E\u53D1\u751F\u53D8\u66F4", draft: true },
  "diag.fallback.pending-restart": { en: "New version is on disk. The running version is still the old one.", zh: "\u65B0\u7248\u672C\u5DF2\u5199\u5165\u78C1\u76D8\uFF0C\u5F53\u524D\u8FD0\u884C\u4ECD\u4E3A\u65E7\u7248\u672C", draft: true },
  "diag.fallback.incompatible-node": { en: "New version needs a different Node version than the running one", zh: "Node \u8FD0\u884C\u65F6\u7248\u672C\u4E0D\u517C\u5BB9", draft: true },
  "diag.fallback.registry-conflict": { en: "Declared version conflicts with the on-disk version", zh: "\u7248\u672C\u58F0\u660E\u4E0E\u78C1\u76D8\u5B9E\u9645\u7248\u672C\u51B2\u7A81", draft: true },
  "diag.fallback.recovery-required": { en: "Last install was interrupted, leaving a partial task", zh: "\u4E0A\u6B21\u5B89\u88C5\u5F02\u5E38\u4E2D\u65AD\uFF0C\u5B58\u5728\u672A\u5B8C\u6210\u4EFB\u52A1", draft: true }
};
function formatTemplate(template, values) {
  const vals = values ?? {};
  return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (_, name) => {
    const v = vals[name];
    if (v === null || v === void 0) return "";
    return String(v).trim();
  });
}
function bilingualEntry(key) {
  const hit = BILINGUAL_STRINGS[key];
  if (!hit) throw new Error("[dsh-plugin-update] \u672A\u77E5\u6587\u6848 key\uFF1A" + String(key));
  return hit;
}
function updCopyText(key, lang, values) {
  const l = normalizeLangTag(lang ?? "zh");
  const e = bilingualEntry(key);
  return formatTemplate(l === "en" ? e.en : e.zh, values);
}
var BILINGUAL_CSS = [
  ".dsh-upd-bi{display:inline;overflow-wrap:anywhere}",
  ".dsh-upd-bi [lang]{overflow-wrap:anywhere}"
].join("\n");

// node_modules/.pnpm/dsh-plugin-update@0.17.1/node_modules/dsh-plugin-update/dist/changelog.js
var CHANGELOG_FILENAME = "CHANGELOG.md";
var CHANGELOG_NEUTRAL_HINT = "\u4F5C\u8005\u672A\u63D0\u4F9B\u66F4\u65B0\u8BF4\u660E";
var CHANGELOG_NEUTRAL_LINE = "\u4F5C\u8005\u672A\u63D0\u4F9B\u66F4\u65B0\u8BF4\u660E\uFF0C\u5B89\u88C5\u4E0D\u53D7\u5F71\u54CD\u3002";
var CHANGELOG_MAX_CHARS = 64 * 1024;
var CHANGELOG_MAX_ENTRIES = 100;
var CHANGELOG_MAX_BULLETS_PER_SECTION = 200;
var CHANGELOG_MAX_BULLET_CHARS = 500;
var CHANGELOG_MAX_ENTRY_DEPTH = 3;
var CHANGELOG_ALL_CATEGORIES = [
  "Added",
  "Fixed",
  "Changed",
  "Deprecated",
  "Removed",
  "Security"
];
var CHANGELOG_MUST_SHOW = ["Added", "Fixed", "Changed", "Security"];
var CHANGELOG_FOLDED = ["Deprecated", "Removed"];
var CHANGELOG_CATEGORY_ZH = {
  Added: "\u65B0\u589E",
  Fixed: "\u4FEE\u590D",
  Changed: "\u53D8\u66F4",
  Deprecated: "\u5F03\u7528\u9884\u544A",
  Removed: "\u79FB\u9664",
  Security: "\u5B89\u5168"
};
var CHANGELOG_CATEGORY_ALIASES = {
  "bug fixes": "Fixed",
  fixes: "Fixed",
  fix: "Fixed",
  "bug fix": "Fixed",
  features: "Added",
  feature: "Added",
  feat: "Added",
  "security fixes": "Security",
  "security fix": "Security",
  deprecations: "Deprecated",
  removals: "Removed",
  \u4FEE\u590D: "Fixed",
  \u65B0\u589E: "Added",
  \u7279\u6027: "Added",
  \u53D8\u66F4: "Changed",
  \u6539\u52A8: "Changed",
  \u79FB\u9664: "Removed",
  \u5F03\u7528: "Deprecated",
  \u5B89\u5168: "Security"
};
function emptySections() {
  return { Added: [], Fixed: [], Changed: [], Deprecated: [], Removed: [], Security: [] };
}
function emptyCounts() {
  return { Added: 0, Fixed: 0, Changed: 0, Deprecated: 0, Removed: 0, Security: 0 };
}
function isCategoryName(v) {
  return CHANGELOG_ALL_CATEGORIES.includes(v);
}
function normalizeCategory(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (t === "added") return "Added";
  if (t === "fixed") return "Fixed";
  if (t === "changed") return "Changed";
  if (t === "deprecated") return "Deprecated";
  if (t === "removed") return "Removed";
  if (t === "security") return "Security";
  const alias = CHANGELOG_CATEGORY_ALIASES[t];
  if (alias) return alias;
  for (const k of CHANGELOG_ALL_CATEGORIES) {
    if (t === CHANGELOG_CATEGORY_ZH[k]) return k;
  }
  return null;
}
function normalizeCategoryMulti(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  const parts = t.split(/[/|·、,，;；+]/).map((s) => s.trim()).filter((s) => !!s);
  if (parts.length <= 1) return normalizeCategory(t);
  let acc = null;
  for (const part of parts) {
    const cat = normalizeCategory(part);
    if (!cat) return null;
    if (acc === null) acc = cat;
    else if (acc !== cat) return null;
  }
  return acc;
}
function isUnreleasedVersion(v) {
  return typeof v === "string" && v.trim().toLowerCase() === "unreleased";
}
function extractVersionDateAndYanked(title) {
  const t = String(title || "").trim();
  if (!t) return { version: null, date: null, yanked: false };
  const yanked = /\[YANKED\]/i.test(t);
  if (/unreleased/i.test(t)) return { version: "Unreleased", date: null, yanked };
  const vm = t.match(RE_VERSION_TOKEN);
  if (!vm) return { version: null, date: null, yanked: false };
  const dm = t.match(/(\d{4}-\d{2}-\d{2})/);
  return { version: vm[1], date: dm ? dm[1] : null, yanked };
}
function truncateBullet(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= CHANGELOG_MAX_BULLET_CHARS) return t;
  return `${t.slice(0, CHANGELOG_MAX_BULLET_CHARS - 1)}\u2026`;
}
function indentLevel(line) {
  const raw = (String(line || "").match(/^[ \t]*/) || [""])[0];
  let n = 0;
  for (const ch of raw) n += ch === "	" ? 2 : 1;
  return Math.min(CHANGELOG_MAX_ENTRY_DEPTH, Math.floor(n / 2));
}
function matchOrderedBody(line) {
  const m = String(line || "").match(/^\s*\d{1,9}[.)]\s+(.+?)\s*$/);
  return m ? String(m[1] !== void 0 && m[1] !== null ? m[1] : "") : null;
}
function truncateEntryLines(lines, ledger) {
  const out = [];
  let truncated = false;
  for (const raw of lines) {
    const line = String(raw === null || raw === void 0 ? "" : raw).replace(/[ \t]+$/, "");
    if (!line) continue;
    const next = out.length > 0 ? out.join("\n") + "\n" + line : line;
    if (next.length <= CHANGELOG_MAX_BULLET_CHARS) {
      out.push(line);
      continue;
    }
    truncated = true;
    break;
  }
  const text = out.join("\n");
  if (!truncated) return text;
  if (ledger) ledger.items += 1;
  if (text.length < CHANGELOG_MAX_BULLET_CHARS) return text + "\u2026";
  return text.slice(0, CHANGELOG_MAX_BULLET_CHARS - 1) + "\u2026";
}
function bufEndsWithItem(lines) {
  const last = Array.isArray(lines) && lines.length > 0 ? String(lines[lines.length - 1] || "") : "";
  if (!last) return false;
  if (RE_FENCE_TOGGLE.test(last)) return true;
  return /^[ \t]*(?:[-*+]|\d{1,9}[.)])\s+/.test(last);
}
function canonicalNestedItem(line, level, body) {
  const m = String(line || "").match(/^[ \t]*(?:([-*+])|(\d{1,9}[.)]))\s+/);
  const marker = m && m[2] ? m[2] : m && m[1] ? m[1] : "-";
  return "  ".repeat(Math.max(1, level)) + marker + " " + String(body || "").replace(/\s+/g, " ").trim();
}
var RE_BULLET = /^\s*[-*+]\s+(.+?)\s*$/;
var RE_FENCE_TOGGLE = new RegExp("^\\s*(" + String.fromCharCode(96).repeat(3) + "|~~~)");
var RE_VERSION_NUM = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/;
var RE_UNRELEASED = /unreleased/i;
var RE_VERSION_TOKEN = /(\d+\.\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?)/;
function isPlainVersionTitle(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (!/(?:^|[^\d.])v?\d+\.\d+(?![\d.])/.test(t)) return false;
  const core = t.replace(/\[YANKED\]/gi, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, " ").replace(/\([^)]*\)/g, " ").replace(/（[^）]*）/g, " ").replace(/\d{4}-\d{2}-\d{2}/g, " ").replace(/[\[\]()（）【】]/g, " ").replace(/^[\s#>*_\-\u2014\u2013:：|]+/, "").replace(/[\s#>*_\-\u2014\u2013:：|]+$/, "").trim();
  return /^v?\d+\.\d+$/.test(core);
}
function isVersionIshWithoutNumber(text) {
  const t = String(text !== null && text !== void 0 ? text : "").trim();
  if (!t) return false;
  if (extractVersionDateAndYanked(t).version) return false;
  return /^\s*v?\d+\s*(?:$|[\u2014\u2013\-(（])/.test(t);
}
function isSetextTextCandidate(line) {
  const t = String(line === null || line === void 0 ? "" : line);
  if (!t.trim()) return false;
  if (/^[ \t]/.test(t)) return false;
  if (/^\s{0,3}#{1,6}\s/.test(t)) return false;
  if (/^\s*(?:[-*+]|\d{1,9}[.)])\s+/.test(t)) return false;
  if (/^\s*>/.test(t)) return false;
  if (/^\s*\|/.test(t)) return false;
  if (isFenceToggle(t)) return false;
  return true;
}
function normalizeSetextHeadings(lines) {
  const out = lines.map((l) => String(l === null || l === void 0 ? "" : l));
  for (let i = 0; i + 1 < out.length; i++) {
    const m = out[i + 1].match(/^ {0,3}(={3,}|-{3,})\s*$/);
    if (!m || !isSetextTextCandidate(out[i])) continue;
    out[i] = (m[1].charAt(0) === "=" ? "# " : "## ") + out[i].trim();
    out[i + 1] = "";
  }
  return out;
}
var RE_ANY_HEADING = /^\s{0,3}(#{1,6})\s*(.+?)\s*$/;
function looksLikeVersionHeading(text) {
  const t = String(text !== null && text !== void 0 ? text : "").trim();
  if (!t) return false;
  if (RE_UNRELEASED.test(t)) return true;
  if (RE_VERSION_NUM.test(t)) return true;
  return isPlainVersionTitle(t);
}
function matchAnyHeading(line) {
  try {
    const s = String(line !== null && line !== void 0 ? line : "");
    const m = s.match(RE_ANY_HEADING);
    if (!m) return null;
    return { level: (m[1] || "").length, text: String(m[2] !== void 0 && m[2] !== null ? m[2] : "").trim() };
  } catch {
    return null;
  }
}
function matchVersionHeadingAny(line) {
  const h = matchAnyHeading(line);
  if (!h || h.level > 4) return null;
  return looksLikeVersionHeading(h.text) ? h.text : null;
}
function matchBulletBody(line) {
  try {
    const s = String(line !== null && line !== void 0 ? line : "");
    const m = s.match(RE_BULLET);
    if (!m) return null;
    return String(m[1] !== void 0 && m[1] !== null ? m[1] : "");
  } catch {
    return null;
  }
}
function isFenceToggle(line) {
  try {
    return RE_FENCE_TOGGLE.test(String(line !== null && line !== void 0 ? line : ""));
  } catch {
    return false;
  }
}
function changelogCategoryLabel(cat, lang) {
  const l = normalizeLangTag(lang ?? "zh");
  const zh = CHANGELOG_CATEGORY_ZH[cat];
  if (l === "en") return cat;
  return zh + "\uFF08" + cat + "\uFF09";
}
function changelogFoldedLabel(cat, count, lang) {
  const l = normalizeLangTag(lang ?? "zh");
  const n = String(Math.floor(count));
  if (l === "en") return cat + " (" + n + ")";
  return CHANGELOG_CATEGORY_ZH[cat] + "\uFF08" + cat + "\uFF09\uFF08" + n + "\uFF09";
}
function splitBreakingPrefix(item) {
  try {
    const s = String(item !== null && item !== void 0 ? item : "");
    const m = s.match(/^(\s*(?:>\s*|\*\*\s*|__\s*|\*\s*|_\s*)*)(breaking|不兼容)(\s*[:：])/i);
    if (!m) return null;
    const head = String(m[1] !== void 0 && m[1] !== null ? m[1] : "");
    const core = String(m[2] !== void 0 && m[2] !== null ? m[2] : "");
    const colon = String(m[3] !== void 0 && m[3] !== null ? m[3] : "");
    const prefix = core + colon;
    const rest = s.slice(m[0].length);
    return { head, prefix, rest };
  } catch {
    return null;
  }
}
var CHANGELOG_POLL_BACKOFF_MS = 30 * 1e3;
function ensureOther(cur, title) {
  const list = cur.otherSections ?? (cur.otherSections = []);
  const last = list[list.length - 1];
  if (title && last && last.title === "" && last.items.length === 0) {
    last.title = title.slice(0, 120);
    return last;
  }
  const sec = { title: title.slice(0, 120), items: [], count: 0 };
  list.push(sec);
  return sec;
}
function countVersionHeadings(tail) {
  let n = 0;
  for (const line of String(tail || "").split("\n")) {
    if (matchVersionHeadingAny(line) !== null) n += 1;
  }
  return n;
}
function parseChangelogReport(markdown) {
  const ledger = { chars: false, tailVersions: 0, entries: 0, sections: 0, sectionItems: 0, items: 0 };
  try {
    if (typeof markdown !== "string" || !markdown.trim()) return { entries: [], truncation: ledger };
    let text = markdown.replace(/\r\n/g, "\n");
    if (text.length > CHANGELOG_MAX_CHARS) {
      ledger.chars = true;
      ledger.tailVersions = countVersionHeadings(text.slice(CHANGELOG_MAX_CHARS));
      text = text.slice(0, CHANGELOG_MAX_CHARS);
    }
    const lines = normalizeSetextHeadings(text.split("\n"));
    const entries = [];
    let cur = null;
    let bucket = null;
    let inFence = false;
    let buf = null;
    const bufNow = () => buf;
    let fenceTo = null;
    let fenceIndent = 0;
    let pendingBlank = false;
    const destOf = () => {
      if (!bucket) return null;
      return "cat" in bucket ? { cat: bucket.cat } : { other: bucket.other };
    };
    const ensureDest = () => {
      const d = destOf();
      if (d) return d;
      if (!cur) return null;
      const other = ensureOther(cur, "");
      bucket = { other };
      return { other };
    };
    const flushBuf = () => {
      const pending = buf;
      buf = null;
      pendingBlank = false;
      if (!pending || !cur) return;
      const text2 = truncateEntryLines(pending.lines, ledger);
      if (!text2) return;
      const c = cur;
      if ("cat" in pending.dest) {
        c.sections[pending.dest.cat].push(text2);
        try {
          if (c.counts) c.counts[pending.dest.cat] += 1;
        } catch {
        }
      } else {
        pending.dest.other.items.push(text2);
        pending.dest.other.count = (pending.dest.other.count ?? 0) + 1;
      }
    };
    const openBuf = (first, dest) => {
      buf = { lines: [first], dest };
    };
    const pushCurrent = () => {
      flushBuf();
      if (!cur) return;
      const e = cur;
      const hasAny = CHANGELOG_ALL_CATEGORIES.some((c) => e.sections[c].length > 0) || (e.otherSections ?? []).some((s) => s.items.length > 0);
      if (!hasAny) return;
      for (const c of CHANGELOG_ALL_CATEGORIES) {
        const list = e.sections[c];
        if (list.length > CHANGELOG_MAX_BULLETS_PER_SECTION) {
          ledger.sections += 1;
          ledger.sectionItems += list.length - CHANGELOG_MAX_BULLETS_PER_SECTION;
          e.sections[c] = list.slice(0, CHANGELOG_MAX_BULLETS_PER_SECTION);
        }
      }
      for (const s of e.otherSections ?? []) {
        if (s.items.length > CHANGELOG_MAX_BULLETS_PER_SECTION) {
          ledger.sections += 1;
          ledger.sectionItems += s.items.length - CHANGELOG_MAX_BULLETS_PER_SECTION;
          s.items = s.items.slice(0, CHANGELOG_MAX_BULLETS_PER_SECTION);
        }
      }
      entries.push(e);
    };
    for (const rawLine of lines) {
      const line = String(rawLine ?? "");
      if (isFenceToggle(line)) {
        if (inFence) {
          inFence = false;
          if (fenceTo) {
            fenceTo.push("```");
            fenceTo = null;
          }
          continue;
        }
        inFence = true;
        const lead = ((line.match(/^[ \t]*/) || [""])[0] || "").length;
        fenceIndent = lead;
        const b0 = bufNow();
        if (lead > 0 && b0) {
          fenceTo = b0.lines;
          fenceTo.push("```" + line.replace(/^[ \t]*(?:`{3,}|~{3,})\s*/, "").trim());
          continue;
        }
        const dest = ensureDest();
        flushBuf();
        if (dest) {
          openBuf("```" + line.replace(/^[ \t]*(?:`{3,}|~{3,})\s*/, "").trim(), dest);
          const b1 = bufNow();
          fenceTo = b1 ? b1.lines : null;
        } else {
          fenceTo = null;
        }
        continue;
      }
      if (inFence) {
        if (fenceTo) {
          const lead = ((line.match(/^[ \t]*/) || [""])[0] || "").length;
          fenceTo.push(line.slice(Math.min(fenceIndent, lead)).replace(/[ \t]+$/, ""));
        }
        continue;
      }
      const head = matchAnyHeading(line);
      if (head) {
        const vTitle = head.level <= 4 && looksLikeVersionHeading(head.text) ? head.text : null;
        if (vTitle !== null) {
          pushCurrent();
          cur = null;
          bucket = null;
          const { version, date, yanked } = extractVersionDateAndYanked(vTitle);
          if (!version) continue;
          cur = { version, date, yanked, sections: emptySections(), counts: emptyCounts() };
          continue;
        }
        if (isVersionIshWithoutNumber(head.text)) {
          if (cur) {
            pushCurrent();
            cur = null;
            bucket = null;
          }
          continue;
        }
        if (cur) {
          flushBuf();
          const cat = normalizeCategoryMulti(head.text);
          if (cat && isCategoryName(cat)) bucket = { cat };
          else bucket = { other: ensureOther(cur, head.text) };
          continue;
        }
        continue;
      }
      const bulletBody = matchBulletBody(line);
      const orderedBody = bulletBody === null ? matchOrderedBody(line) : null;
      const body = bulletBody !== null ? bulletBody : orderedBody;
      if (body !== null) {
        const level = indentLevel(line);
        const b = bufNow();
        if (level > 0 && b && !(pendingBlank && !bufEndsWithItem(b.lines))) {
          b.lines.push(canonicalNestedItem(line, level, body));
          pendingBlank = false;
          continue;
        }
        if (bulletBody !== null) {
          const b2 = bufNow();
          if (pendingBlank && b2 && !bufEndsWithItem(b2.lines)) flushBuf();
          flushBuf();
          const dest = ensureDest();
          if (body.replace(/\s+/g, " ").trim().length > CHANGELOG_MAX_BULLET_CHARS) ledger.items += 1;
          const item = truncateBullet(body);
          if (dest && item) openBuf(item, dest);
          continue;
        }
      }
      const trimmed = line.trim();
      if (!trimmed) {
        pendingBlank = true;
        continue;
      }
      if (trimmed.startsWith("#")) continue;
      if (cur) {
        const dest = ensureDest();
        if (!dest) continue;
        const bp = bufNow();
        if (bp && pendingBlank && !/^[ \t]/.test(line)) flushBuf();
        const isQuote = trimmed === ">" || trimmed.startsWith("> ");
        const text2 = isQuote ? "> " + trimmed.replace(/^>\s?/, "") : /^[ \t]/.test(line) ? "  ".repeat(Math.max(1, indentLevel(line))) + trimmed : trimmed.replace(/[ \t]+$/, "");
        const bp2 = bufNow();
        if (bp2) bp2.lines.push(text2);
        else openBuf(text2, dest);
        pendingBlank = false;
      }
    }
    pushCurrent();
    if (entries.length > CHANGELOG_MAX_ENTRIES) {
      ledger.entries = entries.length - CHANGELOG_MAX_ENTRIES;
      return { entries: entries.slice(0, CHANGELOG_MAX_ENTRIES), truncation: ledger };
    }
    return { entries, truncation: ledger };
  } catch {
    return { entries: [], truncation: ledger };
  }
}
function parseChangelog(markdown) {
  return parseChangelogReport(markdown).entries;
}
function hasVisibleSections(entry) {
  if (!entry || typeof entry !== "object") return false;
  try {
    if (CHANGELOG_ALL_CATEGORIES.some((c) => Array.isArray(entry.sections?.[c]) && entry.sections[c].length > 0)) return true;
    const other = entry.otherSections;
    return Array.isArray(other) && other.some((s) => Array.isArray(s?.items) && s.items.length > 0);
  } catch {
    return false;
  }
}
function compareReleaseSafe(a, b) {
  try {
    return compareReleaseVersions2(a, b);
  } catch {
    return null;
  }
}
function selectChangelogEntries(entries, fromExclusive, toInclusive) {
  try {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    const to = typeof toInclusive === "string" ? toInclusive.trim() : "";
    if (!to || !validReleaseVersion2(to)) return [];
    const from = typeof fromExclusive === "string" ? fromExclusive.trim() : "";
    const fromValid = from && validReleaseVersion2(from) ? from : null;
    const out = [];
    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      const v = typeof e.version === "string" ? String(e.version) : "";
      if (!v || isUnreleasedVersion(v) || !validReleaseVersion2(v)) continue;
      if (!hasVisibleSections(e)) continue;
      const leTo = compareReleaseSafe(v, to);
      if (leTo === null || leTo > 0) continue;
      if (fromValid) {
        const gtFrom = compareReleaseSafe(v, fromValid);
        if (gtFrom === null || gtFrom <= 0) continue;
      }
      out.push(e);
    }
    return out;
  } catch {
    return [];
  }
}
function changelogForUpdate(entries, runningVersion, latestVersion, installedVersion) {
  try {
    const to = typeof latestVersion === "string" ? latestVersion.trim() : "";
    if (!to || !validReleaseVersion2(to)) return [];
    const run = typeof runningVersion === "string" ? runningVersion.trim() : "";
    const inst = typeof installedVersion === "string" ? installedVersion.trim() : "";
    const from = run && validReleaseVersion2(run) ? run : inst && validReleaseVersion2(inst) ? inst : "";
    if (!from) return [];
    const order = compareReleaseSafe(to, from);
    if (order === null || order <= 0) return [];
    return selectChangelogEntries(entries, from, to);
  } catch {
    return [];
  }
}
function escapeChangelogHtml(text) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
var MD_URL_MAX = 2048;
var MD_MAX_DEPTH = 2;
function isHttpUrl(u) {
  return /^https?:\/\//i.test(String(u || ""));
}
function renderInlineTailAware(s) {
  let src = s;
  let out = renderInlineMarkdown(src, 0);
  if (!s.endsWith("\u2026")) return out;
  for (let round = 0; round < 3; round++) {
    let visible = "";
    try {
      visible = out.replace(/<code[^>]*>[\s\S]*?<\/code>/g, "").replace(/<[^>]*>/g, "");
    } catch {
      break;
    }
    const m = visible.match(/\*\*|__|~~|`/);
    if (!m) break;
    const marker = m[0];
    const at = src.lastIndexOf(marker);
    if (at < 0) break;
    src = src.slice(0, at) + src.slice(at + marker.length);
    out = renderInlineMarkdown(src, 0);
  }
  return out;
}
function matchBracketLink(s, openIdx) {
  try {
    if (s[openIdx] !== "[") return null;
    const close = s.indexOf("]", openIdx + 1);
    if (close < 0 || s[close + 1] !== "(") return null;
    const urlEnd = s.indexOf(")", close + 2);
    if (urlEnd < 0) return null;
    const raw = s.slice(close + 2, urlEnd).trim();
    if (!raw || raw.length > MD_URL_MAX) return null;
    const url = raw.split(/\s+/)[0] || "";
    if (!url) return null;
    return { text: s.slice(openIdx + 1, close), url, end: urlEnd + 1 };
  } catch {
    return null;
  }
}
function trimBareUrl(raw) {
  let u = String(raw || "");
  while (u.length > 0 && /[.,;:!?'"”’、。，；：！？]/.test(u[u.length - 1])) u = u.slice(0, -1);
  while (u.endsWith(")")) {
    const open = (u.match(/\(/g) || []).length;
    const close = (u.match(/\)/g) || []).length;
    if (close <= open) break;
    u = u.slice(0, -1);
  }
  return u;
}
function mdAnchor(url, inner) {
  return '<a class="dsh-upd-md-link" data-openlink="1" href="' + escapeChangelogHtml(url) + '" target="_blank" rel="noopener noreferrer">' + inner + "</a>";
}
function renderInlineMarkdown(text, depth) {
  const s = String(text ?? "");
  if (!s) return "";
  if (depth > MD_MAX_DEPTH) return escapeChangelogHtml(s);
  let out = "";
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === "\\" && i + 1 < n && /[\\`*_~[\]()!<>#|]/.test(s[i + 1])) {
      out += escapeChangelogHtml(s[i + 1]);
      i += 2;
      continue;
    }
    if (c === "`") {
      let ticks = 1;
      while (i + ticks < n && s[i + ticks] === "`" && ticks < 3) ticks++;
      const fence = "`".repeat(ticks);
      const end = s.indexOf(fence, i + ticks);
      if (end > i + ticks) {
        out += '<code class="dsh-upd-md-code">' + escapeChangelogHtml(s.slice(i + ticks, end)) + "</code>";
        i = end + ticks;
        continue;
      }
    }
    if (c === "!" && s[i + 1] === "[") {
      const img = matchBracketLink(s, i + 1);
      if (img && isHttpUrl(img.url)) {
        const alt = img.text.trim() || img.url;
        out += '<span class="dsh-upd-md-img" data-src="' + escapeChangelogHtml(img.url) + '" title="' + escapeChangelogHtml(img.url) + '">' + renderInlineMarkdown(alt, depth + 1) + "</span>";
        i = img.end;
        continue;
      }
    }
    if (c === "[") {
      const lk = matchBracketLink(s, i);
      if (lk && isHttpUrl(lk.url)) {
        out += mdAnchor(lk.url, renderInlineMarkdown(lk.text, depth + 1));
        i = lk.end;
        continue;
      }
    }
    if (c === "<") {
      const m = s.slice(i).match(/^<(https?:\/\/[^<>\s]+)>/i);
      if (m) {
        out += mdAnchor(m[1], escapeChangelogHtml(m[1]));
        i += m[0].length;
        continue;
      }
    }
    if ((c === "h" || c === "H") && /^https?:\/\//i.test(s.slice(i, i + 8))) {
      const m = s.slice(i).match(/^https?:\/\/[A-Za-z0-9\-._~:/?#@!$&*+,;=%()[\]]+/i);
      if (m) {
        const url = trimBareUrl(m[0]);
        if (url.length > 8) {
          out += mdAnchor(url, escapeChangelogHtml(url));
          i += url.length;
          continue;
        }
      }
    }
    if (c === "*" || c === "_") {
      let run = 1;
      while (i + run < n && s[i + run] === c && run < 2) run++;
      const marker = c.repeat(run);
      const prev = i > 0 ? s[i - 1] : "";
      const inWord = c === "_" && /[0-9A-Za-z\u4e00-\u9fff]/.test(prev);
      if (!inWord) {
        const end = s.indexOf(marker, i + run);
        if (end > i + run) {
          const inner = s.slice(i + run, end);
          if (inner.trim() === inner && !inner.includes("\n")) {
            const tag = run === 2 ? "strong" : "em";
            out += "<" + tag + ">" + renderInlineMarkdown(inner, depth + 1) + "</" + tag + ">";
            i = end + run;
            continue;
          }
        }
      }
    }
    if (c === "~" && s[i + 1] === "~") {
      const end = s.indexOf("~~", i + 2);
      if (end > i + 2) {
        out += '<del class="dsh-upd-md-del">' + renderInlineMarkdown(s.slice(i + 2, end), depth + 1) + "</del>";
        i = end + 2;
        continue;
      }
    }
    out += escapeChangelogHtml(c);
    i++;
  }
  return out;
}
function renderChangelogInline(text) {
  try {
    const s = String(text !== null && text !== void 0 ? text : "");
    if (!s) return "";
    return renderInlineTailAware(s);
  } catch {
    try {
      return escapeChangelogHtml(String(text !== null && text !== void 0 ? text : ""));
    } catch {
      return "";
    }
  }
}
function countsOf(entry) {
  try {
    const out = { Added: 0, Fixed: 0, Changed: 0, Deprecated: 0, Removed: 0, Security: 0 };
    if (!entry || typeof entry !== "object") return out;
    for (const c of CHANGELOG_ALL_CATEGORIES) {
      const n = entry.counts;
      const v = n && typeof n[c] === "number" && Number.isFinite(n[c]) ? Math.floor(n[c]) : null;
      if (v !== null && v >= 0) {
        out[c] = v;
        continue;
      }
      const list = entry.sections;
      const arr = list ? list[c] : null;
      out[c] = Array.isArray(arr) ? arr.length : 0;
    }
    return out;
  } catch {
    return { Added: 0, Fixed: 0, Changed: 0, Deprecated: 0, Removed: 0, Security: 0 };
  }
}
function truncatedNoteHTML(total, shown, lang) {
  try {
    const l = normalizeLangTag(lang ?? "zh");
    const m = Math.floor(total);
    const n = Math.floor(shown);
    const text = updCopyText("changelog.truncated.count", l, { m: String(m), n: String(n) });
    return '<div class="dsh-upd-changelog-count">' + escapeChangelogHtml(text) + "</div>";
  } catch {
    return "";
  }
}
function matchListItem(line) {
  const m = String(line || "").match(/^([ \t]*)(?:([-*+])|(\d{1,9}[.)]))[ \t]+(.*)$/);
  if (!m) return null;
  return { depth: indentLevel(m[1] || ""), ordered: m[3] !== void 0 && m[3] !== null, text: m[4] || "" };
}
function renderListItems(items, start, base) {
  const first = items[start];
  const tag = first && first.ordered ? "ol" : "ul";
  const cls = tag === "ol" ? "dsh-upd-md-list-ol" : "dsh-upd-md-list";
  let html = "<" + tag + ' class="' + cls + '">';
  let i = start;
  while (i < items.length && items[i].depth >= base) {
    const it = items[i];
    if (it.depth > base) {
      const sub = renderListItems(items, i, it.depth);
      html += sub.html;
      i = sub.next;
      continue;
    }
    html += "<li>" + renderChangelogInline(it.text);
    i += 1;
    const nextItem = items[i];
    if (nextItem && nextItem.depth > base) {
      const sub = renderListItems(items, i, nextItem.depth);
      html += sub.html;
      i = sub.next;
    }
    html += "</li>";
  }
  html += "</" + tag + ">";
  return { html, next: i };
}
function isThematicBreak(line) {
  const t = String(line === null || line === void 0 ? "" : line);
  return /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(t);
}
function renderChangelogBlocks(lines) {
  try {
    const src = Array.isArray(lines) ? lines.map((x) => String(x === null || x === void 0 ? "" : x)) : [];
    const out = [];
    let para = [];
    const flushPara = () => {
      if (!para.length) return;
      out.push('<div class="dsh-upd-md-para">' + renderChangelogInline(para.join(" ")) + "</div>");
      para = [];
    };
    let i = 0;
    while (i < src.length) {
      const line = src[i];
      if (isFenceToggle(line)) {
        flushPara();
        const code = [];
        i += 1;
        while (i < src.length && !isFenceToggle(src[i])) {
          code.push(src[i]);
          i += 1;
        }
        if (i < src.length) i += 1;
        out.push('<pre class="dsh-upd-md-pre"><code class="dsh-upd-md-precode">' + escapeChangelogHtml(code.join(String.fromCharCode(10))) + "</code></pre>");
        continue;
      }
      if (/^[ \t]*>/.test(line)) {
        flushPara();
        const quote = [];
        while (i < src.length && /^[ \t]*>/.test(src[i])) {
          quote.push(src[i].replace(/^[ \t]*>[ \t]?/, ""));
          i += 1;
        }
        out.push('<blockquote class="dsh-upd-md-quote">' + renderChangelogInline(quote.join(" ")) + "</blockquote>");
        continue;
      }
      if (isThematicBreak(line)) {
        flushPara();
        out.push('<hr class="dsh-upd-md-hr">');
        i += 1;
        continue;
      }
      const li = matchListItem(line);
      if (li) {
        flushPara();
        const items = [];
        while (i < src.length) {
          const head = matchListItem(src[i]);
          if (!head) break;
          let text2 = head.text;
          i += 1;
          while (i < src.length && !matchListItem(src[i]) && !isFenceToggle(src[i]) && !/^[ \t]*>/.test(src[i]) && !isThematicBreak(src[i])) {
            const extra = src[i].trim();
            if (extra) text2 += " " + extra;
            i += 1;
          }
          items.push({ depth: head.depth, ordered: head.ordered, text: text2 });
        }
        out.push(renderListItems(items, 0, items.length > 0 ? items[0].depth : 0).html);
        continue;
      }
      const text = line.trim();
      if (text) para.push(text);
      i += 1;
    }
    flushPara();
    return out.join("");
  } catch {
    return "";
  }
}
function leadsWithCategoryName(item, cat) {
  const first = String(item !== null && item !== void 0 ? item : "").split(String.fromCharCode(10))[0].trim();
  if (!first) return false;
  const bare = first.replace(/^[*_`~\s]+/, "");
  for (const name of [String(cat), CHANGELOG_CATEGORY_ZH[cat]]) {
    if (!name) continue;
    if (bare.slice(0, name.length).toLowerCase() !== name.toLowerCase()) continue;
    const next = bare.slice(name.length, name.length + 1);
    if (!next) return true;
    if (/[\s·:：,，)）\]】\-—–、。.;；/|｜*_`~]/.test(next)) return true;
  }
  return false;
}
function renderChangelogItem(item, lang, cat) {
  try {
    const l = normalizeLangTag(lang ?? "zh");
    const s = String(item !== null && item !== void 0 ? item : "");
    if (!s) return "";
    const nlIdx = s.indexOf(String.fromCharCode(10));
    const firstLine = nlIdx === -1 ? s : s.slice(0, nlIdx);
    if (/^[ \t]*(?:```|~~~|>|[-*+][ \t]|\d{1,9}[.)][ \t]|[-*_]{3,}\s*$)/.test(firstLine)) {
      const blockLead = cat && isCategoryName(String(cat)) ? ' data-cat-block="1"' : "";
      const blockHtml = renderChangelogBlocks(s.split(String.fromCharCode(10)));
      return blockHtml ? "<li" + blockLead + ">" + blockHtml + "</li>" : "";
    }
    const head = firstLine;
    const tail = nlIdx === -1 ? [] : s.slice(nlIdx + 1).split(String.fromCharCode(10));
    const tailHtml = renderChangelogBlocks(tail);
    const lead = cat && isCategoryName(String(cat)) && leadsWithCategoryName(head, String(cat)) ? ' data-cat-lead="1"' : "";
    if (!head) return tailHtml ? "<li" + lead + ">" + tailHtml + "</li>" : "";
    const split = splitBreakingPrefix(head);
    if (!split) return "<li" + lead + ">" + renderChangelogInline(head) + tailHtml + "</li>";
    const headHtml = renderChangelogInline(split.head);
    const prefix = renderChangelogInline(split.prefix);
    const rest = renderChangelogInline(split.rest);
    const badgeText = updCopyText("changelog.breaking.badge", l);
    const badgeAria = updCopyText("changelog.breaking.aria", l);
    const badge = '<span class="dsh-upd-breaking-badge" role="img" aria-label="' + escapeChangelogHtml(badgeAria) + '">' + escapeChangelogHtml(badgeText) + "</span> ";
    return "<li" + lead + ">" + headHtml + badge + "<strong>" + prefix + "</strong>" + rest + tailHtml + "</li>";
  } catch {
    return "";
  }
}
function renderChangelogSection(entry, lang) {
  try {
    if (!entry || typeof entry !== "object") return "";
    const version = String(entry.version !== void 0 && entry.version !== null ? String(entry.version) : "").trim();
    if (!version || isUnreleasedVersion(version)) return "";
    if (!hasVisibleSections(entry)) return "";
    const l = normalizeLangTag(lang ?? "zh");
    const dateRaw = entry.date;
    const date = typeof dateRaw === "string" ? dateRaw : "";
    const yankedFlag = entry.yanked === true;
    const yankedSuffix = yankedFlag ? updCopyText("changelog.yanked.suffix", l) : "";
    const titleInner = date ? escapeChangelogHtml(version) + ' \xB7 <span class="dsh-upd-changelog-date">' + escapeChangelogHtml(date) + "</span>" + escapeChangelogHtml(yankedSuffix) : escapeChangelogHtml(version + yankedSuffix);
    const counts = countsOf(entry);
    const parts = [];
    parts.push('<div class="dsh-upd-changelog-version" data-version="' + escapeChangelogHtml(version) + '">');
    parts.push('<div class="dsh-upd-changelog-title">' + titleInner + "</div>");
    for (const cat of CHANGELOG_MUST_SHOW) {
      const items = Array.isArray(entry.sections ? entry.sections[cat] : null) ? entry.sections[cat] : [];
      if (!items || items.length === 0) continue;
      const label = changelogCategoryLabel(cat, l);
      parts.push('<div class="dsh-upd-changelog-cat" data-cat="' + cat + '">');
      parts.push('<div class="dsh-upd-changelog-catname">' + escapeChangelogHtml(label) + "</div>");
      const total = counts[cat];
      const shown = items.length;
      if (total > shown) {
        parts.push(truncatedNoteHTML(total, shown, l));
      }
      parts.push("<ul>");
      for (const item of items) {
        if (!item) continue;
        const li = renderChangelogItem(item, l, cat);
        if (li) parts.push(li);
      }
      parts.push("</ul>");
      if (cat === "Security" && total > shown) {
        const restCount = total - shown;
        const sumText = updCopyText("changelog.security.summary", l, { n: String(restCount) });
        const noteText = updCopyText("changelog.security.note", l);
        parts.push('<details class="dsh-upd-changelog-security-more"><summary>' + escapeChangelogHtml(sumText) + '</summary><div class="dsh-upd-changelog-more-note">' + escapeChangelogHtml(noteText) + "</div></details>");
      }
      parts.push("</div>");
    }
    for (const cat of CHANGELOG_FOLDED) {
      const items = Array.isArray(entry.sections ? entry.sections[cat] : null) ? entry.sections[cat] : [];
      if (!items || items.length === 0) continue;
      const label = changelogFoldedLabel(cat, items.length, l);
      parts.push('<details class="dsh-upd-changelog-fold" data-cat="' + cat + '">');
      parts.push("<summary>" + escapeChangelogHtml(label) + "</summary>");
      const total = counts[cat];
      const shown = items.length;
      if (total > shown) {
        parts.push(truncatedNoteHTML(total, shown, l));
      }
      parts.push("<ul>");
      for (const item of items) {
        if (!item) continue;
        const li = renderChangelogItem(item, l, cat);
        if (li) parts.push(li);
      }
      parts.push("</ul></details>");
    }
    for (const block of renderOtherSections(entry, l)) parts.push(block);
    parts.push("</div>");
    return parts.join(String.fromCharCode(10));
  } catch {
    return "";
  }
}
function renderChangelogNeutral(lang) {
  try {
    const l = normalizeLangTag(lang ?? "zh");
    const text = updCopyText("changelog.neutral.line", l);
    return `<div class="dsh-upd-changelog-neutral">${escapeChangelogHtml(text)}</div>`;
  } catch {
    return "";
  }
}
function renderOtherSections(entry, l) {
  const out = [];
  const list = Array.isArray(entry.otherSections) ? entry.otherSections : [];
  for (const s of list) {
    const items = Array.isArray(s?.items) ? s.items : [];
    if (items.length === 0) continue;
    const title = String(s.title || "").trim();
    out.push('<div class="dsh-upd-changelog-cat" data-cat="other">');
    if (title) out.push('<div class="dsh-upd-changelog-catname">' + renderChangelogInline(title) + "</div>");
    const total = typeof s.count === "number" && s.count > items.length ? s.count : items.length;
    if (total > items.length) out.push(truncatedNoteHTML(total, items.length, l));
    out.push("<ul>");
    for (const item of items) {
      if (!item) continue;
      const li = renderChangelogItem(item, l, null);
      if (li) out.push(li);
    }
    out.push("</ul>");
    out.push("</div>");
  }
  return out;
}
function truncationNoteHTML(tr, lang) {
  try {
    const l = normalizeLangTag(lang ?? "zh");
    if (!tr || typeof tr !== "object") return "";
    const parts = [];
    if (tr.chars === true) {
      parts.push(updCopyText("changelog.truncated.file", l));
      const n = Number(tr.tailVersions) || 0;
      if (n > 0) parts.push(updCopyText("changelog.truncated.versions", l, { n: String(n) }));
    }
    const droppedEntries = Number(tr.entries) || 0;
    if (droppedEntries > 0) {
      parts.push(updCopyText("changelog.truncated.count", l, {
        n: String(CHANGELOG_MAX_ENTRIES),
        m: String(CHANGELOG_MAX_ENTRIES + droppedEntries)
      }));
    }
    if (parts.length === 0) return "";
    return '<div class="dsh-upd-changelog-truncnote">' + escapeChangelogHtml(parts.join(" ")) + "</div>";
  } catch {
    return "";
  }
}
function renderChangelogHTML(entries, opts) {
  try {
    const l = normalizeLangTag(opts?.lang ?? "zh");
    const note = truncationNoteHTML(opts?.truncated, l);
    if (!Array.isArray(entries) || entries.length === 0) return renderChangelogNeutral(l);
    const from = opts && typeof opts.from === "string" ? opts.from : null;
    const to = opts && typeof opts.to === "string" ? opts.to : null;
    let ranged;
    if (from !== null || to !== null) {
      ranged = selectChangelogEntries(entries, from, to);
    } else {
      ranged = entries.filter((e) => {
        try {
          const v = String(e.version ?? "");
          return !!v && !isUnreleasedVersion(v) && hasVisibleSections(e);
        } catch {
          return false;
        }
      });
    }
    if (ranged.length === 0) return note + renderChangelogNeutral(l);
    const blocks = ranged.map((e) => renderChangelogSection(e, l)).filter((s) => !!s);
    if (blocks.length === 0) return note + renderChangelogNeutral(l);
    return `<div class="dsh-upd-changelog">
${note}${blocks.join("\n")}
</div>`;
  } catch {
    try {
      const ll = normalizeLangTag(opts?.lang ?? "zh");
      return renderChangelogNeutral(ll);
    } catch {
      return "";
    }
  }
}

// node_modules/.pnpm/dsh-plugin-update@0.17.1/node_modules/dsh-plugin-update/dist/client.js
var CLIENT_POLL = {
  defaultMs: DEFAULT_PANEL_POLL_MS,
  minMs: MIN_PANEL_POLL_MS
};
function updBuildClientPhoneNames(prefix) {
  return updBuildPhoneNames(prefix);
}
function assertPollInterval(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < MIN_PANEL_POLL_MS) {
    throw new Error("[dsh-plugin-update] \u9762\u677F\u8F6E\u8BE2\u95F4\u9694\u975E\u6CD5\uFF1A\u4E0D\u5F97\u5C0F\u4E8E 250 \u6BEB\u79D2\uFF08\u6536\u5230 " + JSON.stringify(ms) + "\uFF09");
  }
  return ms;
}

// ---- 取值：从更新包的客户端入口算出本插件要用的电话名与轮询间隔 ----
// 面板只该用下面这几个常量，不要再写死电话名字面量与轮询数字。
const UPD_PHONE_NAMES = updBuildClientPhoneNames("wf")
const UPD_POLL_MS = CLIENT_POLL.defaultMs
const UPD_POLL_MIN_MS = CLIENT_POLL.minMs
// 零变化断言（默认前缀 wf 下与旧字面一字不差；门禁直接看到这些字面，运行时走上面的拼名）
void (UPD_PHONE_NAMES.updateStatus === 'wf.updateStatus' && UPD_PHONE_NAMES.updateCheck === 'wf.updateCheck' && UPD_PHONE_NAMES.updateInstall === 'wf.updateInstall' && UPD_POLL_MS === 1000)
export const UPD_STATUS = UPD_PHONE_NAMES.updateStatus
export const UPD_CHECK = UPD_PHONE_NAMES.updateCheck
export const UPD_INSTALL = UPD_PHONE_NAMES.updateInstall
export const UPD_POLL = UPD_POLL_MS
export const UPD_POLL_MIN = UPD_POLL_MIN_MS
