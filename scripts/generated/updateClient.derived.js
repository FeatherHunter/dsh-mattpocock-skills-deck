// 由 dsh-plugin-update@0.8.0 的集成工具生成，人手不改。
// 生成命令：node dsh-plugin-update/derive-client-values.mjs --prefix wf --out <本文件路径>
// 生成对象：dsh-mattpocock-skills-deck。改了前缀或想升级本包，重新跑一次这条命令即可。
// node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/config.js
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
function updBuildPhoneNames(prefix) {
  const checked = assertPrefix(prefix, "\u7535\u8BDD\u540D\u524D\u7F00 prefix");
  return {
    updateStatus: checked + ".updateStatus",
    updateCheck: checked + ".updateCheck",
    updateInstall: checked + ".updateInstall",
    updateChangelog: checked + ".updateChangelog"
  };
}
function buildChangelogPhoneName(prefix) {
  return updBuildPhoneNames(prefix).updateChangelog;
}
function updBuildPhoneName(prefix, action) {
  return updBuildPhoneNames(prefix)[action];
}

// node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/commands.js
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
  let version = picks.length > 0 ? picks[0] : "latest";
  try {
    const ranked = picks.filter((v) => compareReleaseVersions(v, input.runningVersion) >= 0);
    if (ranked.length > 0) {
      version = ranked[0];
      for (const v of ranked) if (compareReleaseVersions(v, version) === 1) version = v;
    }
  } catch {
  }
  return `dsh plugin --profile ${arg} add --save-exact ${targetName}@${version} --registry=${registry}`;
}

// node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/queue.js
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

// node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/batch.js
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

// node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/service.js
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

// node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/lang.js
function normalizeLangTag(tag) {
  if (typeof tag !== "string") return "zh";
  const s = tag.trim().toLowerCase().replace(/_/g, "-");
  if (!s) return "zh";
  if (s === "zh" || s.startsWith("zh-")) return "zh";
  if (s === "en" || s.startsWith("en-")) return "en";
  if (/^[a-z]{2,3}(-[a-z0-9]+)*$/.test(s)) return "en";
  return "zh";
}

// node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/bilingual.js
var BILINGUAL_STRINGS = {
  "entry.label.idle": { en: "Check for updates", zh: "\u68C0\u67E5\u66F4\u65B0", draft: true },
  "entry.label.failed": { en: "Update failed \u2014 View details", zh: "\u66F4\u65B0\u5931\u8D25\uFF0C\u70B9\u6B64\u67E5\u770B", draft: true },
  "entry.label.busy": { en: "Installing\u2026", zh: "\u6B63\u5728\u5B89\u88C5\u2026", draft: true },
  "entry.label.restart": { en: "Restart required", zh: "\u5F85\u91CD\u542F", draft: true },
  "entry.label.has-update": { en: "Update available {version}", zh: "\u6709\u65B0\u7248 {version}", draft: true },
  "entry.action.checking": { en: "Checking for updates\u2026", zh: "\u6B63\u5728\u67E5\u65B0\u7248\u2026", draft: true },
  "entry.note.up-to-date": { en: "Up to date {version}", zh: "\u5DF2\u662F\u6700\u65B0 {version}", draft: true },
  "batch-entry.label.idle": { en: "Check for updates", zh: "\u68C0\u67E5\u66F4\u65B0", draft: true },
  "batch-entry.label.update": { en: "{count} updates available", zh: "{count} \u5BB6\u53EF\u66F4\u65B0", draft: true },
  "batch-entry.label.busy": { en: "Installing\u2026", zh: "\u6B63\u5728\u5B89\u88C5\u2026", draft: true },
  "batch-entry.label.restart": { en: "{count} restarts required", zh: "{count} \u5BB6\u5F85\u91CD\u542F", draft: true },
  "batch-entry.label.failed": { en: "{count} failed \u2014 View details", zh: "{count} \u5BB6\u5931\u8D25\uFF0C\u70B9\u6B64\u67E5\u770B", draft: true },
  "batch-entry.action.checking": { en: "Checking for updates\u2026", zh: "\u6B63\u5728\u67E5\u65B0\u7248\u2026", draft: true },
  "panel.blocked.unknown-profile.title": { en: "Unrecognized scope or plugin location", zh: "\u4F7F\u7528\u8303\u56F4\u6216\u63D2\u4EF6\u4F4D\u7F6E\u8BA4\u4E0D\u51FA", draft: true },
  "panel.blocked.unknown-profile.action": { en: "Reopen the host and check again; if it persists, send the version and logs to the plugin author; no manual command is provided for this case.", zh: "\u91CD\u5F00\u5BBF\u4E3B\u518D\u67E5\u4E00\u6B21\uFF1B\u4E00\u76F4\u8FD9\u6837\u5C31\u628A\u7248\u672C\u53F7\u4E0E\u65E5\u5FD7\u4EA4\u7ED9\u63D2\u4EF6\u4F5C\u8005\uFF1B\u8FD9\u79CD\u60C5\u5F62\u4E0D\u7ED9\u624B\u5DE5\u547D\u4EE4", draft: true },
  "panel.blocked.source-install.title": { en: "Installed from source, not by version", zh: "\u5F53\u524D\u662F\u4ECE\u6E90\u7801\u88C5\u7684\uFF0C\u4E0D\u662F\u6309\u7248\u672C\u53F7\u88C5\u7684", draft: true },
  "panel.blocked.source-install.action": { en: "No manual command is provided here; to update, reinstall by version first.", zh: "\u8FD9\u79CD\u60C5\u5F62\u4E0D\u7ED9\u624B\u5DE5\u547D\u4EE4\uFF1B\u60F3\u8D70\u66F4\u65B0\u5148\u6309\u7248\u672C\u53F7\u91CD\u88C5\u4E00\u6B21", draft: true },
  "panel.blocked.invalid-installation.title": { en: "Installed package is incomplete (name mismatch, invalid version, or missing entry file)", zh: "\u5DF2\u88C5\u7684\u5305\u4E0D\u5B8C\u6574\uFF08\u540D\u5B57\u5BF9\u4E0D\u4E0A\u3001\u7248\u672C\u975E\u6CD5\u3001\u5165\u53E3\u6587\u4EF6\u7F3A\u5931\uFF09", draft: true },
  "panel.blocked.invalid-installation.action": { en: "Reinstall the current version to repair the install directory, then check again.", zh: "\u91CD\u88C5\u5F53\u524D\u7248\u672C\uFF0C\u4FEE\u597D\u5DF2\u88C5\u76EE\u5F55\u518D\u67E5\u66F4\u65B0", draft: true },
  "panel.blocked.installation-changed.title": { en: "Install location changed during use (directory or package changed)", zh: "\u5B89\u88C5\u4F4D\u7F6E\u5728\u4F7F\u7528\u4E2D\u9014\u53D8\u4E86\uFF08\u6362\u4E86\u76EE\u5F55\u6216\u6362\u4E86\u5305\uFF09", draft: true },
  "panel.blocked.installation-changed.action": { en: "Reopen the host and check again; if it persists, reinstall.", zh: "\u91CD\u65B0\u6253\u5F00\u5BBF\u4E3B\u518D\u67E5\u4E00\u6B21\uFF1B\u8FD8\u51FA\u73B0\u5C31\u91CD\u88C5", draft: true },
  "panel.blocked.pending-restart.title": { en: "New version is on disk; the running instance is still the old version", zh: "\u65B0\u7248\u5DF2\u88C5\u5230\u78C1\u76D8\uFF0C\u6B63\u5728\u8DD1\u7684\u8FD8\u662F\u65E7\u7248", draft: true },
  "panel.blocked.pending-restart.action": { en: "Restart the host to run the new version; this is a normal end state, not a failure.", zh: "\u91CD\u542F\u5BBF\u4E3B\uFF0C\u8BA9\u65B0\u7248\u8DD1\u8D77\u6765\uFF1B\u8FD9\u662F\u6B63\u5E38\u7EC8\u6001\uFF0C\u4E0D\u662F\u5931\u8D25", draft: true },
  "panel.blocked.registry-conflict.title": { en: "Declared version conflicts with the version on disk", zh: "\u672C\u5730\u58F0\u660E\u7684\u7248\u672C\u4E0E\u78C1\u76D8\u5B9E\u9645\u7248\u672C\u4E92\u76F8\u77DB\u76FE", draft: true },
  "panel.blocked.registry-conflict.action": { en: "Open the scope manifest and set the target package line to the version number, then retry.", zh: "\u6253\u5F00\u4F7F\u7528\u8303\u56F4\u7684\u6E05\u5355\u6587\u4EF6\uFF0C\u628A\u76EE\u6807\u5305\u540D\u90A3\u4E00\u884C\u6539\u6210\u7248\u672C\u53F7\u518D\u8BD5", draft: true },
  "panel.blocked.incompatible-node.title": { en: "Required Node version does not match the running Node", zh: "\u65B0\u7248\u8981\u6C42\u7684 Node \u4E0E\u5F53\u524D\u8FD0\u884C\u7684\u5BF9\u4E0D\u4E0A", draft: true },
  "panel.blocked.incompatible-node.action": { en: "Upgrade Node to 22 or later, then check again.", zh: "\u5148\u5347\u7EA7 Node \u5230 22 \u6216\u66F4\u9AD8\uFF0C\u518D\u67E5\u66F4\u65B0", draft: true },
  "panel.blocked.recovery-required.title": { en: "Last install was interrupted, leaving a partial task", zh: "\u4E0A\u6B21\u5B89\u88C5\u88AB\u6253\u65AD\uFF0C\u7559\u4E0B\u4E00\u4E2A\u534A\u622A\u4EFB\u52A1", draft: true },
  "panel.blocked.recovery-required.action": { en: "Run install once more; if it persists, follow section 6 to troubleshoot.", zh: "\u91CD\u65B0\u70B9\u4E00\u6B21\u5B89\u88C5\uFF1B\u4E00\u76F4\u51FA\u73B0\u5C31\u6309\u7B2C 6 \u8282\u6392\u9519", draft: true },
  "panel.failure.check-failed.title": { en: "Couldn\u2019t check for updates (network, source, or rate limit)", zh: "\u67E5\u65B0\u7248\u6CA1\u6210\u529F\uFF08\u8054\u7F51\u3001\u6E90\u3001\u9650\u6D41\u90FD\u53EF\u80FD\uFF09", draft: true },
  "panel.failure.check-failed.action": { en: "Try checking again later; if it keeps failing, send the copied diagnostics to the plugin author.", zh: "\u8FC7\u4E00\u4F1A\u513F\u518D\u67E5\u4E00\u6B21\uFF1B\u4E00\u76F4\u5931\u8D25\u5C31\u628A\u590D\u5236\u8BCA\u65AD\u4EA4\u7ED9\u63D2\u4EF6\u4F5C\u8005", draft: true },
  "panel.failure.invalid-release.title": { en: "Release info is invalid (bad version or mismatched content)", zh: "\u62FF\u5230\u7684\u53D1\u5E03\u4FE1\u606F\u4E0D\u5408\u6CD5\uFF08\u7248\u672C\u53F7\u975E\u6CD5\u6216\u5185\u5BB9\u5BF9\u4E0D\u4E0A\uFF09", draft: true },
  "panel.failure.invalid-release.action": { en: "Check the package name and version in the manifest, then check again.", zh: "\u68C0\u67E5\u6E05\u5355\u6587\u4EF6\u91CC\u7684\u5305\u540D\u4E0E\u7248\u672C\u5199\u6CD5\uFF0C\u518D\u67E5\u4E00\u6B21", draft: true },
  "panel.failure.check-expired.title": { en: "Credentials expired; the install request was rejected", zh: "\u51ED\u8BC1\u8FC7\u671F\u4E86\uFF0C\u5B89\u88C5\u8BF7\u6C42\u88AB\u62D2", draft: true },
  "panel.failure.check-expired.action": { en: "Check for updates again before installing; do not retry with the old ID.", zh: "\u91CD\u65B0\u67E5\u4E00\u6B21\u65B0\u7248\u518D\u70B9\u5B89\u88C5\uFF0C\u4E0D\u8981\u91CD\u8BD5\u65E7\u7F16\u53F7", draft: true },
  "panel.failure.update-busy.title": { en: "Another install is running in the same scope", zh: "\u540C\u4E00\u4F7F\u7528\u8303\u56F4\u6B63\u5728\u88C5\u53E6\u4E00\u4E2A", draft: true },
  "panel.failure.update-busy.action": { en: "Wait until the current task leaves installing/verifying, then try; check status for your queue position.", zh: "\u7B49\u5F53\u524D\u4EFB\u52A1\u79BB\u5F00 installing/verifying \u518D\u70B9\uFF1B\u6392\u961F\u4E2D\u53BB\u67E5\u72B6\u6001\u770B\u4F4D\u7F6E", draft: true },
  "panel.failure.install-failed.title": { en: "Couldn\u2019t install (see the diagnostic summary)", zh: "\u88C5\u4E0D\u4E0A\uFF08\u8BE6\u89C1\u8BCA\u65AD\u6458\u8981\uFF09", draft: true },
  "panel.failure.install-failed.action": { en: "Read the copied diagnostics first; on official desktop builds, send it to the plugin author.", zh: "\u5148\u770B\u590D\u5236\u8BCA\u65AD\uFF1B\u5B98\u65B9\u684C\u9762\u7248\u628A\u8FD9\u6BB5\u4EA4\u7ED9\u63D2\u4EF6\u4F5C\u8005", draft: true },
  "panel.failure.internal.title": { en: "Something went wrong; the cause is unknown", zh: "\u51FA\u4E86\u70B9\u95EE\u9898\uFF0C\u8BA4\u4E0D\u51FA\u5177\u4F53\u539F\u56E0", draft: true },
  "panel.failure.internal.action": { en: "Retry once first; if it persists, send the copied diagnostics to the plugin author.", zh: "\u5148\u91CD\u8BD5\u4E00\u6B21\uFF1B\u4E00\u76F4\u8FD9\u6837\u5C31\u628A\u590D\u5236\u8BCA\u65AD\u4EA4\u7ED9\u63D2\u4EF6\u4F5C\u8005", draft: true },
  "panel.failure.unknown.title": { en: "Something went wrong; the cause is unknown", zh: "\u51FA\u4E86\u70B9\u95EE\u9898\uFF0C\u8BA4\u4E0D\u51FA\u5177\u4F53\u539F\u56E0", draft: true },
  "panel.failure.unknown.action": { en: "Retry once first; if it persists, send the copied diagnostics to the plugin author (include the code you saw).", zh: "\u5148\u91CD\u8BD5\u4E00\u6B21\uFF1B\u4E00\u76F4\u8FD9\u6837\u5C31\u628A\u590D\u5236\u8BCA\u65AD\u4EA4\u7ED9\u63D2\u4EF6\u4F5C\u8005\uFF08\u5E26\u4E0A\u4F60\u770B\u5230\u7684\u7801\uFF09", draft: true },
  "panel.seal.loading.text": { en: "Not checked", zh: "\u5F85\u67E5", draft: true },
  "panel.seal.loading.mini": { en: "Check", zh: "\u67E5", draft: true },
  "panel.seal.idle.text": { en: "Not checked", zh: "\u5F85\u67E5", draft: true },
  "panel.seal.idle.mini": { en: "Check", zh: "\u67E5", draft: true },
  "panel.seal.update.text": { en: "Update available", zh: "\u53EF\u88C5", draft: true },
  "panel.seal.update.mini": { en: "Install", zh: "\u88C5", draft: true },
  "panel.seal.busy.text": { en: "Installing", zh: "\u5B89\u88C5\u4E2D", draft: true },
  "panel.seal.busy.mini": { en: "Install", zh: "\u88C5", draft: true },
  "panel.seal.restart.text": { en: "Restart required", zh: "\u5F85\u91CD\u542F", draft: true },
  "panel.seal.restart.mini": { en: "Restart", zh: "\u542F", draft: true },
  "panel.seal.blocked.text": { en: "Blocked \u2014 Action needed", zh: "\u53D7\u963B", draft: true },
  "panel.seal.blocked.mini": { en: "Blocked", zh: "\u963B", draft: true },
  "panel.seal.failed.text": { en: "Failed \u2014 Retry available", zh: "\u53D7\u963B", draft: true },
  "panel.seal.failed.mini": { en: "Failed", zh: "\u963B", draft: true },
  "panel.seal.done.text": { en: "Up to date", zh: "\u5DF2\u6700\u65B0", draft: true },
  "panel.seal.done.mini": { en: "Done", zh: "\u5B9A", draft: true },
  "panel.banner.error.title": { en: "Update failed ({code}): {detail}.", zh: "\u66F4\u65B0\u5931\u8D25\uFF08{code}\uFF09\uFF1A{detail}\u3002", draft: true },
  "panel.banner.error.action-fallback": { en: "Copy the diagnostics for the plugin author; see the log channel for details.", zh: "\u590D\u5236\u8BCA\u65AD\u53D1\u7ED9\u63D2\u4EF6\u4F5C\u8005\uFF1B\u6DF1\u6316\u770B\u65E5\u5FD7\u901A\u9053\u3002", draft: true },
  "panel.action.retry-install": { en: "Retry install", zh: "\u91CD\u8BD5\u5B89\u88C5", draft: true },
  "panel.banner.loading": { en: "Loading update status\u2026", zh: "\u6B63\u5728\u8BFB\u53D6\u66F4\u65B0\u72B6\u6001\u2026", draft: true },
  "panel.action.install": { en: "Install update", zh: "\u5B89\u88C5\u66F4\u65B0", draft: true },
  "panel.queue.busy-self": { en: "Installing (this plugin is installing).", zh: "\u6B63\u5728\u5B89\u88C5\uFF08\u672C\u63D2\u4EF6\u5728\u88C5\uFF09\u3002", draft: true },
  "panel.queue.busy-queued": { en: "An install is running ahead; this plugin is #{n} in queue. Install when it reaches the front.", zh: "\u524D\u65B9\u6709\u5B89\u88C5\u5728\u8FDB\u884C\uFF0C\u672C\u63D2\u4EF6\u6392\u7B2C {n} \u4F4D\uFF0C\u5230\u961F\u9996\u518D\u70B9\u5B89\u88C5\u3002", draft: true },
  "panel.queue.busy-other": { en: "Another plugin is installing; retry later.", zh: "\u524D\u65B9\u6709\u5176\u4ED6\u63D2\u4EF6\u5728\u5B89\u88C5\uFF0C\u7A0D\u540E\u91CD\u8BD5\u3002", draft: true },
  "panel.skip.skipped-title": { en: "Skipped {latest}", zh: "\u5DF2\u8DF3\u8FC7 {latest}", draft: true },
  "panel.skip.skipped-action": { en: "Select \u201CRestore\u201D to be reminded of this version again; newer versions will still notify.", zh: "\u70B9\u201C\u6062\u590D\u201D\u53EF\u91CD\u65B0\u63D0\u9192\u8BE5\u7248\u672C\uFF1B\u6709\u66F4\u65B0\u7684\u65B0\u7248\u672C\u4F1A\u7167\u5E38\u63D0\u9192\u3002", draft: true },
  "panel.banner.restart-title": { en: "Version {latest} is installed; restart the host to take effect.", zh: "\u65B0\u7248 {latest} \u5DF2\u5B89\u88C5\uFF0C\u91CD\u542F\u5BBF\u4E3B\u540E\u751F\u6548\u3002", draft: true },
  "panel.banner.installing-title": { en: "Installing {version}\u2026 Closing the panel won\u2019t interrupt it.", zh: "\u6B63\u5728\u5B89\u88C5 {version}\u2026\u5173\u95ED\u9762\u677F\u4E0D\u4F1A\u4E2D\u65AD\u3002", draft: true },
  "panel.banner.installing-action": { en: "Progress refreshes automatically; reopening the panel restores the view within a second.", zh: "\u8FDB\u5EA6\u6309\u8F6E\u8BE2\u81EA\u52A8\u5237\u65B0\uFF1B\u91CD\u5F00\u9762\u677F 1 \u79D2\u5185\u6062\u590D\u663E\u793A\u3002", draft: true },
  "panel.action.installing": { en: "Installing\u2026", zh: "\u5B89\u88C5\u4E2D\u2026", draft: true },
  "panel.banner.update-title": { en: "Update available: {latest} (current: {running}).", zh: "\u6709\u65B0\u7248 {latest} \u53EF\u88C5\uFF08\u5F53\u524D {running}\uFF09\u3002", draft: true },
  "panel.banner.update-action": { en: "Install runs the exact version; only one install runs per scope at a time.", zh: "\u70B9\u5B89\u88C5\u5373\u8D70\u7CBE\u786E\u7248\u672C\u5B89\u88C5\uFF1B\u540C\u4E00\u4F7F\u7528\u8303\u56F4\u540C\u65F6\u53EA\u88C5\u4E00\u4E2A\u3002", draft: true },
  "panel.action.install-version": { en: "Install {latest}", zh: "\u5B89\u88C5 {latest}", draft: true },
  "panel.banner.done": { en: "Up to date. No update needed.", zh: "\u5DF2\u662F\u6700\u65B0\uFF0C\u65E0\u9700\u66F4\u65B0\u3002", draft: true },
  "panel.toast.checking": { en: "Checking for updates\u2026", zh: "\u6B63\u5728\u67E5\u65B0\u7248\u2026", draft: true },
  "panel.toast.installing": { en: "Installing\u2026", zh: "\u6B63\u5728\u5B89\u88C5\u2026", draft: true },
  "panel.toast.copy-manual-ok": { en: "Manual command copied; paste the full line into the terminal to run it.", zh: "\u624B\u5DE5\u547D\u4EE4\u5DF2\u590D\u5236\uFF0C\u7C98\u5230\u7EC8\u7AEF\u6574\u884C\u6267\u884C\u5373\u53EF\u3002", draft: true },
  "panel.toast.copy-manual-fail": { en: "Copy failed; please select the command above manually.", zh: "\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u9009\u4E2D\u4E0A\u9762\u7684\u547D\u4EE4\u3002", draft: true },
  "panel.toast.copy-diag-ok": { en: "Diagnostics copied; paste it to the plugin author (already redacted).", zh: "\u8BCA\u65AD\u5DF2\u590D\u5236\uFF0C\u76F4\u63A5\u7C98\u7ED9\u63D2\u4EF6\u4F5C\u8005\u5373\u53EF\uFF08\u5DF2\u8131\u654F\uFF09\u3002", draft: true },
  "panel.toast.copy-diag-fail": { en: "Copy failed; please select the info above manually.", zh: "\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u9009\u4E2D\u4E0A\u9762\u7684\u4FE1\u606F\u3002", draft: true },
  "panel.toast.restart-delegated": { en: "Handled by the caller\u2019s restart flow; the new version takes effect after restart.", zh: "\u5DF2\u6309\u8C03\u7528\u65B9\u7684\u91CD\u542F\u6D41\u7A0B\u5904\u7406\uFF1B\u91CD\u542F\u540E\u65B0\u7248\u751F\u6548\u3002", draft: true },
  "panel.toast.restart-manual": { en: "This host provides no restart entry; please restart the host manually. The new version takes effect after restart.", zh: "\u672C\u5BBF\u4E3B\u672A\u63D0\u4F9B\u91CD\u542F\u5165\u53E3\uFF1A\u8BF7\u624B\u52A8\u91CD\u542F\u5BBF\u4E3B\uFF0C\u91CD\u542F\u540E\u65B0\u7248\u751F\u6548\u3002", draft: true },
  "panel.toast.restart-failed": { en: "Restart entry failed; please restart the host manually. The new version takes effect after restart.", zh: "\u91CD\u542F\u5165\u53E3\u8C03\u7528\u5931\u8D25\uFF1A\u8BF7\u624B\u52A8\u91CD\u542F\u5BBF\u4E3B\uFF0C\u91CD\u542F\u540E\u65B0\u7248\u751F\u6548\u3002", draft: true },
  "panel.toast.copy-state-ok": { en: "Current state copied (no failure); paste it to the plugin author (already redacted).", zh: "\u5DF2\u590D\u5236\u5F53\u524D\u72B6\u6001\uFF08\u65E0\u5931\u8D25\uFF09\uFF0C\u76F4\u63A5\u7C98\u7ED9\u63D2\u4EF6\u4F5C\u8005\u5373\u53EF\uFF08\u5DF2\u8131\u654F\uFF09\u3002", draft: true },
  "panel.toast.failure-dismissed": { en: "Failure acknowledged; it will be re-evaluated on the next check or install.", zh: "\u5DF2\u786E\u8BA4\u8BE5\u5931\u8D25\u63D0\u793A\uFF1B\u4E0B\u6B21\u67E5\u65B0\u7248\u6216\u5B89\u88C5\u5C06\u91CD\u65B0\u8BC4\u4F30\u3002", draft: true },
  "panel.strip.running": { en: "Running", zh: "\u8FD0\u884C", draft: true },
  "panel.strip.installed": { en: "Installed", zh: "\u78C1\u76D8", draft: true },
  "panel.strip.latest": { en: "Latest", zh: "\u8FDC\u7AEF", draft: true },
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
  "panel.progress.installing": { en: "Installing new version\u2026", zh: "\u6B63\u5728\u5B89\u88C5\u65B0\u7248\u2026", draft: true },
  "panel.progress.verifying": { en: "Verifying install result\u2026", zh: "\u6B63\u5728\u6821\u9A8C\u5B89\u88C5\u7ED3\u679C\u2026", draft: true },
  "panel.action.check": { en: "Check for updates", zh: "\u67E5\u65B0\u7248", draft: true },
  "panel.action.check-title": { en: "Check the official source once more (read-only, never installs)", zh: "\u91CD\u65B0\u5411\u5B98\u65B9\u6E90\u67E5\u4E00\u6B21\u65B0\u7248\uFF08\u53EA\u8BFB\uFF0C\u4E0D\u5B89\u88C5\uFF09", draft: true },
  "panel.action.checking-busy": { en: "Checking for updates\u2026", zh: "\u6B63\u5728\u67E5\u65B0\u7248\u2026", draft: true },
  "panel.action.checking-busy-title": { en: "Checking the official source; please wait", zh: "\u6B63\u5728\u5411\u5B98\u65B9\u6E90\u67E5\u8BE2\uFF0C\u8BF7\u7A0D\u5019", draft: true },
  "panel.action.installing-busy": { en: "Installing\u2026", zh: "\u6B63\u5728\u5B89\u88C5\u2026", draft: true },
  "panel.action.installing-busy-title": { en: "Installing; please wait", zh: "\u6B63\u5728\u5B89\u88C5\uFF0C\u8BF7\u7A0D\u5019", draft: true },
  "panel.action.install-title": { en: "Install the exact version; one install per scope at a time", zh: "\u7528\u7CBE\u786E\u7248\u672C\u5B89\u88C5\uFF1B\u540C\u4E00\u4F7F\u7528\u8303\u56F4\u540C\u65F6\u53EA\u88C5\u4E00\u4E2A", draft: true },
  "panel.action.skip": { en: "Skip this version", zh: "\u8DF3\u8FC7\u8BE5\u7248\u672C", draft: true },
  "panel.action.skip-title": { en: "This version will no longer notify; newer versions still will", zh: "\u8BE5\u7248\u672C\u4E0D\u518D\u63D0\u9192\uFF1B\u6709\u66F4\u65B0\u7684\u65B0\u7248\u672C\u7167\u5E38\u63D0\u9192", draft: true },
  "panel.action.unskip": { en: "Restore ({version})", zh: "\u6062\u590D\uFF08{version}\uFF09", draft: true },
  "panel.action.unskip-title": { en: "Undo skip; this version will remind again", zh: "\u64A4\u9500\u8DF3\u8FC7\uFF0C\u8BE5\u7248\u672C\u91CD\u65B0\u63D0\u9192", draft: true },
  "panel.action.copy-manual": { en: "Copy manual command", zh: "\u590D\u5236\u624B\u5DE5\u547D\u4EE4", draft: true },
  "panel.action.copy-manual-title": { en: "Copy the manual command; paste the full line into the terminal", zh: "\u590D\u5236\u624B\u5DE5\u547D\u4EE4\uFF0C\u7C98\u5230\u7EC8\u7AEF\u6574\u884C\u6267\u884C", draft: true },
  "panel.action.restart-host": { en: "Restart host", zh: "\u91CD\u542F\u5BBF\u4E3B", draft: true },
  "panel.action.restart-host-title": { en: "This host provides no restart entry; restart the host manually", zh: "\u5BBF\u4E3B\u6CA1\u6709\u81EA\u91CD\u542F\u7535\u8BDD\uFF1A\u8BF7\u624B\u52A8\u91CD\u542F\u5BBF\u4E3B", draft: true },
  "panel.action.dismiss": { en: "Got it", zh: "\u77E5\u9053\u4E86", draft: true },
  "panel.action.dismiss-title": { en: "Acknowledge the failure and return; next check or install will re-evaluate", zh: "\u786E\u8BA4\u5DF2\u77E5\u6653\u8BE5\u5931\u8D25\uFF1A\u56DE\u5230\u53EF\u88C5\u9875\uFF0C\u4E0B\u6B21\u67E5/\u88C5\u5C06\u91CD\u65B0\u8BC4\u4F30", draft: true },
  "panel.action.copy-diag": { en: "Copy diagnostics", zh: "\u590D\u5236\u8BCA\u65AD", draft: true },
  "panel.action.copy-diag-title": { en: "Copy redacted diagnostics for the plugin author", zh: "\u590D\u5236\u5DF2\u8131\u654F\u8BCA\u65AD\uFF0C\u76F4\u63A5\u7C98\u7ED9\u63D2\u4EF6\u4F5C\u8005", draft: true },
  "panel.skip.line-tag": { en: "Skipped {version}", zh: "\u5DF2\u8DF3\u8FC7 {version}", draft: true },
  "panel.skip.line-note": { en: "Select \u201CRestore\u201D to undo; this version will remind again.", zh: "\u70B9\u300C\u6062\u590D\u300D\u53EF\u64A4\u9500\uFF0C\u4E4B\u540E\u8FD9\u4E00\u7248\u8FD8\u4F1A\u518D\u63D0\u9192\u3002", draft: true },
  "panel.changelog.heading": { en: "Changelog:", zh: "\u66F4\u65B0\u8BF4\u660E\uFF1A", draft: true },
  "panel.changelog.heading-range": { en: "Changelog ({from} \u2192 {to}):", zh: "\u66F4\u65B0\u8BF4\u660E\uFF08{from} \u2192 {to}\uFF09\uFF1A", draft: true },
  "panel.changelog.unavailable": { en: "Could not read logs; install is unaffected.", zh: "\u65E5\u5FD7\u8BFB\u4E0D\u51FA\u6765\uFF0C\u5B89\u88C5\u4E0D\u53D7\u5F71\u54CD\u3002", draft: true },
  "panel.changelog.unavailable-empty": { en: "No release found yet; logs will show after a check.", zh: "\u8FD8\u6CA1\u67E5\u5230\u65B0\u7248\uFF1B\u67E5\u5230\u540E\u518D\u663E\u793A\u65E5\u5FD7\u3002", draft: true },
  "panel.changelog.toggle-title": { en: "Expand or collapse changelog", zh: "\u5C55\u5F00\u6216\u6536\u8D77\u66F4\u65B0\u65E5\u5FD7", draft: true },
  "panel.changelog.expand": { en: "Expand changelog", zh: "\u5C55\u5F00\u66F4\u65B0\u65E5\u5FD7", draft: true },
  "panel.changelog.collapse": { en: "Collapse changelog", zh: "\u6536\u8D77\u66F4\u65B0\u65E5\u5FD7", draft: true },
  "panel.queue.state-idle": { en: "Idle", zh: "\u7A7A\u95F2", draft: true },
  "panel.queue.other": { en: "Other plugin", zh: "\u5176\u4ED6\u63D2\u4EF6", draft: true },
  "panel.queue.self": { en: "This plugin", zh: "\u672C\u63D2\u4EF6", draft: true },
  "panel.queue.pos-absent": { en: "Not queued", zh: "\u672A\u6392\u961F", draft: true },
  "panel.queue.pos-n": { en: "Position {n}", zh: "\u7B2C {n} \u4F4D", draft: true },
  "panel.queue.pos-next": { en: "You are next", zh: "\u4E0B\u4E00\u4E2A\u5C31\u662F\u4F60", draft: true },
  "panel.queue.pos-ahead": { en: "{n} ahead", zh: "\u524D\u65B9 {n} \u4E2A", draft: true },
  "panel.queue.row-installing": { en: "Installing", zh: "\u6B63\u5728\u5B89\u88C5", draft: true },
  "panel.queue.row-installing-note": { en: "You are next when it finishes", zh: "\u88C5\u5B8C\u81EA\u52A8\u8F6E\u5230\u4F60", draft: true },
  "panel.queue.row-idle-note": { en: "One install per scope at a time", zh: "\u540C\u4E00\u4F7F\u7528\u8303\u56F4\u4E00\u6B21\u53EA\u88C5\u4E00\u4E2A", draft: true },
  "panel.queue.row-position": { en: "Your position", zh: "\u4F60\u7684\u987A\u4F4D", draft: true },
  "panel.queue.row-order": { en: "Queue order", zh: "\u6392\u961F\u987A\u5E8F", draft: true },
  "panel.queue.toggle-hide": { en: "Hide others", zh: "\u9690\u85CF\u4ED6\u4EBA\u660E\u7EC6", draft: true },
  "panel.queue.toggle-show": { en: "Show others", zh: "\u663E\u793A\u5176\u4ED6\u63D2\u4EF6", draft: true },
  "panel.queue.empty": { en: "No queued tasks; one install per scope at a time.", zh: "\u5F53\u524D\u6CA1\u6709\u6392\u961F\u4EFB\u52A1\uFF0C\u540C\u4E00\u4F7F\u7528\u8303\u56F4\u4E00\u6B21\u53EA\u88C5\u4E00\u4E2A\u3002", draft: true },
  "panel.error.code-label": { en: "Stable code", zh: "\u7A33\u5B9A\u7801", draft: true },
  "panel.error.code-note": { en: "The line above tells you what to do; to report upstream, paste \u201CCopy diagnostics\u201D as a whole (already redacted).", zh: "\u4E0A\u4E00\u6761\u4E2D\u6587\u8BF4\u660E\u5C31\u662F\u8981\u7528\u6237\u505A\u7684\u4E8B\uFF1B\u8981\u5F80\u4E0A\u6E38\u62A5\uFF0C\u7528\u300C\u590D\u5236\u8BCA\u65AD\u300D\u6574\u6BB5\u7C98\uFF08\u5DF2\u8131\u654F\uFF09\u3002", draft: true },
  "panel.error.query-request": { en: "Request", zh: "\u8BF7\u6C42", draft: true },
  "panel.error.query-check": { en: "Check", zh: "\u68C0\u67E5", draft: true },
  "panel.error.failed-at": { en: "Failed at {time}", zh: "\u5931\u8D25\u4E8E {time}", draft: true },
  "panel.error.query-keys": { en: "Query keys: {keys} (use them to match in logs).", zh: "\u672C\u6B21\u67E5\u8BE2\u952E\uFF1A{keys}\uFF08\u62FF\u7740\u5B83\u4EEC\u53BB\u65E5\u5FD7\u91CC\u5BF9\uFF09\u3002", draft: true },
  "panel.error.evidence-frozen": { en: "Evidence frozen: the code, versions, and IDs in copied diagnostics are from the failure moment and do not refresh with polling; the next check or install will update them.", zh: "\u8BC1\u636E\u5DF2\u51BB\u7ED3\uFF1A\u590D\u5236\u8BCA\u65AD\u91CC\u7684\u7801\u3001\u7248\u672C\u3001\u7F16\u53F7\u90FD\u53D6\u81EA\u5931\u8D25\u65F6\u523B\uFF0C\u4E0D\u968F\u8F6E\u8BE2\u5237\u65B0\uFF1B\u4E0B\u4E00\u6B21\u67E5\u65B0\u7248\u6216\u5B89\u88C5\u4F1A\u66F4\u65B0\u5B83\u3002", draft: true },
  "panel.error.evidence-transient": { en: "Transient read failure: it clears on the next successful read; if it persists, troubleshoot by stable code.", zh: "\u8BFB\u6570\u77AC\u6001\u5931\u8D25\uFF1A\u4E0B\u4E00\u6B21\u6210\u529F\u8BFB\u6570\u4F1A\u81EA\u52A8\u89E3\u9664\uFF1B\u4E00\u76F4\u51FA\u73B0\u518D\u6309\u7A33\u5B9A\u7801\u6392\u67E5\u3002", draft: true },
  "panel.error.no-failure": { en: "No failure: copying diagnostics gives the current state snapshot.", zh: "\u6682\u65E0\u5931\u8D25\uFF1A\u6B64\u65F6\u590D\u5236\u8BCA\u65AD\u7ED9\u51FA\u7684\u662F\u5F53\u524D\u72B6\u6001\u5FEB\u7167\u3002", draft: true },
  "panel.error.log-hint": { en: "Check logs: filter by plugin ID {pluginId} for events {e1}, {e2}, {e3}.", zh: "\u6DF1\u6316\u770B\u65E5\u5FD7\uFF1A\u6309\u63D2\u4EF6\u6807\u8BC6 {pluginId} \u8FC7\u6EE4 {e1}\u3001{e2}\u3001{e3} \u4E09\u4E2A\u4E8B\u4EF6\u3002", draft: true },
  "panel.error.log-follow": { en: "Match the request/check IDs above in {eFail}; baseline timing in {eCall}, execution result in {eExec}.", zh: "\u51ED\u4E0A\u9762\u7684\u8BF7\u6C42\uFF0F\u68C0\u67E5\u7F16\u53F7\u5728 {eFail} \u91CC\u5BF9\u4E0A\uFF1B\u57FA\u7EBF\u8017\u65F6\u770B {eCall}\uFF0C\u6267\u884C\u7ED3\u679C\u770B {eExec}\u3002", draft: true },
  "panel.manual.heading": { en: "Manual fallback command (copy the full line to run):", zh: "\u624B\u5DE5\u515C\u5E95\u547D\u4EE4\uFF08\u590D\u5236\u6574\u884C\u6267\u884C\uFF09\uFF1A", draft: true },
  "panel.manual.absent": { en: "No manual command available (unrecognized scope or source install).", zh: "\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u7684\u624B\u5DE5\u547D\u4EE4\uFF08\u8BA4\u4E0D\u51FA\u4F7F\u7528\u8303\u56F4\u6216\u5C5E\u6E90\u7801\u5B89\u88C5\u65F6\u4E0D\u7ED9\uFF09\u3002", draft: true },
  "panel.footer.note": { en: "Closing never interrupts updates; come back anytime", zh: "\u5173\u95ED\u4E0D\u5F71\u54CD\u66F4\u65B0\uFF0C\u53EF\u968F\u65F6\u56DE\u6765\u67E5\u770B", draft: true },
  "panel.footer.close": { en: "Close", zh: "\u5173\u95ED", draft: true },
  "panel.footer.close-title": { en: "Close the window; updates keep running", zh: "\u5173\u95ED\u7A97\u53E3\uFF0C\u66F4\u65B0\u4E0D\u53D7\u5F71\u54CD", draft: true },
  "panel.diag.header": { en: "[Update Diagnostics] {pluginId} Stable code: {code}", zh: "[\u66F4\u65B0\u8BCA\u65AD] {pluginId} \u7A33\u5B9A\u7801\uFF1A{code}", draft: true },
  "panel.diag.label.human": { en: "Detail: {detail}", zh: "\u4EBA\u8BDD\uFF1A{detail}", draft: true },
  "panel.diag.label.running": { en: "Running: {version}", zh: "\u8FD0\u884C\u7248\uFF1A{version}", draft: true },
  "panel.diag.label.installed": { en: "Installed: {version}", zh: "\u5DF2\u88C5\uFF1A{version}", draft: true },
  "panel.diag.label.latest": { en: "Latest: {version}", zh: "\u8FDC\u7AEF\uFF1A{version}", draft: true },
  "panel.diag.queue.installing": { en: "Installing", zh: "\u6B63\u5728\u5B89\u88C5", draft: true },
  "panel.diag.queue.position": { en: "Queued at position {n}", zh: "\u6392\u961F\u7B2C {n} \u4F4D", draft: true },
  "panel.diag.queue.absent": { en: "Not queued", zh: "\u4E0D\u5728\u961F\u5217\u91CC", draft: true },
  "panel.diag.label.host": { en: "Host: {host}", zh: "\u5BBF\u4E3B\uFF1A{host}", draft: true },
  "panel.diag.label.profile": { en: "Scope: {profile}", zh: "\u4F7F\u7528\u8303\u56F4\uFF1A{profile}", draft: true },
  "panel.diag.label.queue": { en: "Queue: {queue}", zh: "\u961F\u5217\uFF1A{queue}", draft: true },
  "panel.diag.label.request": { en: "Request ID: {requestId}", zh: "\u8BF7\u6C42\u7F16\u53F7\uFF1A{requestId}", draft: true },
  "panel.diag.label.manual": { en: "Manual command: {manual}", zh: "\u624B\u5DE5\u547D\u4EE4\uFF1A{manual}", draft: true },
  "panel.diag.copy.no-detail": { en: "(This response carries no diagnostic summary; it will be completed when phone-side diag lands)", zh: "\uFF08\u672C\u56DE\u5305\u6CA1\u6709\u5E26\u8BCA\u65AD\u6458\u8981\uFF0C\u7B49\u7535\u8BDD\u4FA7 diag \u843D\u5B9A\u540E\u8865\u9F50\uFF09", draft: true },
  "panel.diag.copy.unknown-package": { en: "(Unknown package)", zh: "(\u672A\u77E5\u5305)", draft: true },
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
  "panel.diag.copy.line.summary": { en: "Summary={summary}", zh: "\u6458\u8981={summary}", draft: true },
  "panel.diag.copy.line.remedy": { en: "Remedy={remedy}", zh: "\u600E\u4E48\u529E={remedy}", draft: true },
  "panel.diag.copy.block.summary": { en: "Summary\uFF1A{summary}", zh: "\u6458\u8981\uFF1A{summary}", draft: true },
  "panel.diag.copy.block.source": { en: "Source\uFF1A{source}", zh: "\u6765\u6E90\uFF1A{source}", draft: true },
  "panel.diag.copy.block.remedy": { en: "Remedy\uFF1A{remedy}", zh: "\u600E\u4E48\u529E\uFF1A{remedy}", draft: true },
  "batch.action.resume": { en: "Continue the unfinished batch ({count} left)", zh: "\u7EE7\u7EED\u4E0A\u6B21\u672A\u5B8C\u6210\u7684\u66F4\u65B0\uFF08\u8FD8\u5269 {count} \u5BB6\uFF09", draft: true },
  "batch.action.discard": { en: "Discard this unfinished batch (installed ones stay)", zh: "\u4E22\u5F03\u8FD9\u6279\u672A\u5B8C\u6210\u7684\u66F4\u65B0\uFF08\u5DF2\u5B8C\u6210\u7684\u4FDD\u7559\uFF09", draft: true },
  "batch.action.confirm-discard": { en: "Confirm discard", zh: "\u786E\u8BA4\u4E22\u5F03", draft: true },
  "batch.fact.close-safe": { en: "Closing this panel won't stop it \u2014 progress is saved on disk.", zh: "\u5173\u6389\u9762\u677F\u4E0D\u4F1A\u4E2D\u65AD\uFF1A\u8FDB\u5EA6\u5DF2\u5199\u76D8\uFF0C\u56DE\u6765\u53EF\u7EE7\u7EED\u3002", draft: true },
  "batch.setting.check-on-open": { en: "Check for updates when opening", zh: "\u6253\u5F00\u9762\u677F\u65F6\u81EA\u52A8\u68C0\u67E5\u66F4\u65B0", draft: true },
  "batch.row.update": { en: "Update available {version}", zh: "\u6709\u65B0\u7248 {version}", draft: true },
  "batch.row.current": { en: "Up to date", zh: "\u5DF2\u662F\u6700\u65B0\uFF0C\u4E0D\u7528\u52A8", draft: true },
  "batch.row.never": { en: "Not checked yet", zh: "\u8FD8\u6CA1\u67E5\u8FC7", draft: true },
  "batch.row.failed": { en: "Last check failed", zh: "\u8FD9\u6B21\u6CA1\u67E5\u5230", draft: true },
  "batch.notice.auto-resumed": { en: "Auto-continued the unfinished batch ({count} left).", zh: "\u5DF2\u81EA\u52A8\u7EE7\u7EED\u4E0A\u6B21\u672A\u5B8C\u6210\u7684\u66F4\u65B0\uFF08\u8FD8\u5269 {count} \u5BB6\uFF09\u3002", draft: true },
  "batch.notice.resumed": { en: "Continued the unfinished batch ({count} left).", zh: "\u5DF2\u7EE7\u7EED\u4E0A\u6B21\u672A\u5B8C\u6210\u7684\u66F4\u65B0\uFF08\u8FD8\u5269 {count} \u5BB6\uFF09\u3002", draft: true },
  "batch.notice.no-resume": { en: "Nothing to continue.", zh: "\u6CA1\u6709\u53EF\u7EE7\u7EED\u7684\u5185\u5BB9\u3002", draft: true },
  "batch.notice.discarded": { en: "Discarded this unfinished batch (installed ones stay).", zh: "\u5DF2\u4E22\u5F03\u8FD9\u6279\u672A\u5B8C\u6210\u7684\u66F4\u65B0\uFF08\u5DF2\u5B8C\u6210\u7684\u4FDD\u7559\uFF09\u3002", draft: true },
  "batch.notice.cancel-confirm": { en: "Click again to confirm discard.", zh: "\u518D\u70B9\u4E00\u6B21\u786E\u8BA4\u4E22\u5F03\u3002", draft: true },
  "batch.notice.busy-cancel": { en: "An install is running and cannot be stopped.", zh: "\u6B63\u5728\u88C5\u7684\u90A3\u4E00\u5BB6\u505C\u4E0D\u4E86\u3002", draft: true },
  "batch.row.unfinished-tag": { en: "unfinished last time", zh: "\u4E0A\u4E00\u6279\u6CA1\u505A\u5B8C", draft: true },
  "batch.summary.updatable": { en: "{n} updates available", zh: "{n} \u5BB6\u53EF\u66F4\u65B0", draft: true },
  "batch.summary.installing": { en: "{n} installing", zh: "{n} \u5BB6\u5B89\u88C5\u4E2D", draft: true },
  "batch.summary.pending": { en: "{n} not checked", zh: "{n} \u5BB6\u5F85\u67E5", draft: true },
  "batch.summary.restart": { en: "{n} restart required", zh: "{n} \u5BB6\u5F85\u91CD\u542F", draft: true },
  "batch.summary.failed": { en: "{n} failed", zh: "{n} \u5BB6\u5931\u8D25", draft: true },
  "batch.summary.skipped": { en: "{n} skipped", zh: "{n} \u5BB6\u5DF2\u8DF3\u8FC7", draft: true },
  "batch.summary.settled": { en: "{n} up to date", zh: "{n} \u5BB6\u5DF2\u6700\u65B0", draft: true },
  "batch.summary.empty": { en: "No targets yet", zh: "\u8FD8\u6CA1\u6709\u76EE\u6807", draft: true },
  "batch.header.title": { en: "Update archive", zh: "\u66F4\u65B0\u6863\u6848", draft: true },
  "batch.action.check": { en: "Check for updates", zh: "\u68C0\u67E5\u66F4\u65B0", draft: true },
  "batch.action.check-title": { en: "Re-read batch status (read-only)", zh: "\u91CD\u65B0\u8BFB\u53D6\u6279\u91CF\u72B6\u6001\uFF08\u53EA\u8BFB\uFF09", draft: true },
  "batch.action.install-all": { en: "Update all", zh: "\u5168\u90E8\u66F4\u65B0", draft: true },
  "batch.action.install-all-title": { en: "Submit all updatable plugins at once; one idempotency key per session", zh: "\u628A\u6709\u65B0\u7248\u7684\u51E0\u5BB6\u4E00\u6B21\u63D0\u4EA4\uFF1B\u540C\u4E00\u4F1A\u8BDD\u540C\u4E00\u5E42\u7B49\u7F16\u53F7", draft: true },
  "batch.action.close": { en: "Close", zh: "\u5173\u95ED", draft: true },
  "batch.action.close-title": { en: "Close the window; batch progress keeps running", zh: "\u5173\u95ED\u7A97\u53E3\uFF0C\u6279\u91CF\u66F4\u65B0\u4E0D\u53D7\u5F71\u54CD", draft: true },
  "batch.banner.loading": { en: "Loading batch update status\u2026", zh: "\u6B63\u5728\u8BFB\u53D6\u6279\u91CF\u66F4\u65B0\u72B6\u6001\u2026", draft: true },
  "batch.hint.error": { en: "Last run failed: follow the red banner below.", zh: "\u521A\u624D\u90A3\u6B21\u6CA1\u6210\u529F\uFF1A\u770B\u4E0B\u9762\u7684\u7EA2\u6761\uFF0C\u7167\u5B83\u8BF4\u7684\u505A\u4E00\u6B21\u3002", draft: true },
  "batch.hint.empty": { en: "No targets yet: select \u201CCheck for updates\u201D to see which plugins have updates.", zh: "\u8FD8\u6CA1\u6709\u76EE\u6807\uFF1A\u70B9\u300C\u68C0\u67E5\u66F4\u65B0\u300D\u770B\u770B\u54EA\u51E0\u5BB6\u6709\u65B0\u7248\u3002", draft: true },
  "batch.hint.installing-queueable": { en: "Installing {a}; {b} more can join the queue.", zh: "\u6B63\u5728\u5B89\u88C5 {a} \u5BB6\uFF1B\u8FD8\u6709 {b} \u5BB6\u53EF\u4EE5\u70B9\u300C\u52A0\u5165\u961F\u5217\u300D\u6392\u961F\u7B49\u3002", draft: true },
  "batch.hint.installing-auto": { en: "Installing {a}; the next starts automatically.", zh: "\u6B63\u5728\u5B89\u88C5 {a} \u5BB6\uFF0C\u5B89\u88C5\u5B8C\u81EA\u52A8\u4E0B\u4E00\u5BB6\u3002", draft: true },
  "batch.hint.failed": { en: "{n} failed to install; retry each one from the failure notes below.", zh: "{n} \u5BB6\u5B89\u88C5\u5931\u8D25\uFF1B\u7167\u4E0B\u9762\u7684\u5931\u8D25\u63D0\u793A\u9010\u5BB6\u91CD\u8BD5\u3002", draft: true },
  "batch.hint.updatable": { en: "{n} updates available; select \u201CUpdate all\u201D to install at once, or install each one inline.", zh: "{n} \u5BB6\u53EF\u66F4\u65B0\uFF1B\u70B9\u300C\u5168\u90E8\u66F4\u65B0\u300D\u4E00\u6B21\u5B89\u88C5\u5B8C\uFF0C\u4E5F\u53EF\u4EE5\u9010\u5BB6\u70B9\u300C\u5B89\u88C5\u8FD9\u5BB6\u300D\u3002", draft: true },
  "batch.hint.restart": { en: "{n} installed; restart the host to take effect.", zh: "{n} \u5BB6\u5DF2\u5B89\u88C5\u597D\uFF0C\u91CD\u542F\u5BBF\u4E3B\u540E\u751F\u6548\u3002", draft: true },
  "batch.hint.pending": { en: "{n} not checked yet; select \u201CCheck for updates\u201D for a round.", zh: "{n} \u5BB6\u8FD8\u6CA1\u67E5\u8FC7\uFF1B\u70B9\u300C\u68C0\u67E5\u66F4\u65B0\u300D\u67E5\u4E00\u8F6E\u3002", draft: true },
  "batch.hint.done": { en: "All up to date; nothing to do.", zh: "\u5168\u90E8\u5DF2\u6700\u65B0\uFF0C\u6CA1\u6709\u8981\u505A\u7684\u3002", draft: true },
  "batch.seal.ledger": { en: "Ledger", zh: "\u603B\u8D26", draft: true },
  "batch.banner.error-title": { en: "Failed this time ({code}): {detail}.", zh: "\u8FD9\u6B21\u6CA1\u6210\u529F\uFF08{code}\uFF09\uFF1A{detail}\u3002", draft: true },
  "batch.banner.error-action-fallback": { en: "Retry once first; if it persists, send the copied diagnostics to the plugin author.", zh: "\u5148\u91CD\u8BD5\u4E00\u6B21\uFF1B\u4E00\u76F4\u8FD9\u6837\u5C31\u628A\u590D\u5236\u8BCA\u65AD\u4EA4\u7ED9\u63D2\u4EF6\u4F5C\u8005\u3002", draft: true },
  "batch.banner.failed-title": { en: "{n} failed to install.", zh: "{n} \u5BB6\u5B89\u88C5\u5931\u8D25\u3002", draft: true },
  "batch.banner.failed-action": { en: "Retry each one inline; if it keeps failing, send the copied diagnostics to the plugin author.", zh: "\u9010\u5BB6\u70B9\u884C\u5185\u300C\u91CD\u8BD5\u300D\u518D\u6765\u4E00\u6B21\uFF1B\u4E00\u76F4\u5931\u8D25\u5C31\u628A\u590D\u5236\u8BCA\u65AD\u4EA4\u7ED9\u63D2\u4EF6\u4F5C\u8005\u3002", draft: true },
  "batch.banner.restart-title": { en: "{n} installed; restart the host to take effect.", zh: "{n} \u5BB6\u5DF2\u5B89\u88C5\u597D\uFF0C\u91CD\u542F\u5BBF\u4E3B\u540E\u751F\u6548\u3002", draft: true },
  "batch.banner.restart-action": { en: "Restart the host to run the new version; this is a normal end state, not a failure.", zh: "\u91CD\u542F\u5BBF\u4E3B\uFF0C\u8BA9\u65B0\u7248\u8DD1\u8D77\u6765\uFF1B\u8FD9\u662F\u6B63\u5E38\u7EC8\u6001\uFF0C\u4E0D\u662F\u5931\u8D25\u3002", draft: true },
  "batch.banner.restart-button": { en: "Restart host", zh: "\u91CD\u542F\u5BBF\u4E3B", draft: true },
  "batch.row.queued-generic": { en: "Queued \xB7 waiting for the running install to finish", zh: "\u5DF2\u6392\u961F \xB7 \u7B49\u524D\u9762\u5B89\u88C5\u5B8C", draft: true },
  "batch.row.queued-n": { en: "Queued \xB7 {n} ahead", zh: "\u5DF2\u6392\u961F \xB7 \u524D\u65B9 {n} \u4E2A", draft: true },
  "batch.row.skipped": { en: "Skipped {version}", zh: "\u5DF2\u8DF3\u8FC7 {version}", draft: true },
  "batch.row.wait-turn": { en: "Waiting for its turn; it will check automatically", zh: "\u7B49\u5B83\uFF0C\u8F6E\u5230\u5C31\u81EA\u52A8\u67E5\u65B0\u7248", draft: true },
  "batch.row.checking": { en: "Checking for updates; please wait", zh: "\u6B63\u5728\u67E5\u65B0\u7248\uFF0C\u7A0D\u7B49", draft: true },
  "batch.row.cta-version": { en: "Select \u201CInstall this plugin\u201D to install {version}", zh: "\u70B9\u300C\u5B89\u88C5\u8FD9\u5BB6\u300D\u5B89\u88C5 {version}", draft: true },
  "batch.row.cta-generic": { en: "Select \u201CInstall this plugin\u201D to install the new version", zh: "\u70B9\u300C\u5B89\u88C5\u8FD9\u5BB6\u300D\u5B89\u88C5\u65B0\u7248", draft: true },
  "batch.row.installing": { en: "Installing; please wait", zh: "\u6B63\u5728\u5B89\u88C5\uFF0C\u522B\u52A8", draft: true },
  "batch.row.done-restart": { en: "Installed; restart the host to take effect", zh: "\u5B89\u88C5\u597D\u4E86\uFF0C\u91CD\u542F\u5BBF\u4E3B\u624D\u751F\u6548", draft: true },
  "batch.row.done": { en: "Installed; nothing to do", zh: "\u5B89\u88C5\u597D\u4E86\uFF0C\u4E0D\u7528\u52A8", draft: true },
  "batch.row.failed-retry": { en: "Install failed; select \u201CRetry\u201D to try again", zh: "\u5B89\u88C5\u6CA1\u6210\u529F\uFF0C\u70B9\u300C\u91CD\u8BD5\u300D\u518D\u6765\u4E00\u6B21", draft: true },
  "batch.row.skipped-idle": { en: "This version is skipped; nothing to do", zh: "\u8FD9\u4E00\u7248\u5DF2\u8DF3\u8FC7\uFF0C\u4E0D\u7528\u52A8", draft: true },
  "batch.row.unknown": { en: "Unknown state; select \u201CCheck for updates\u201D to check again", zh: "\u72B6\u6001\u8BA4\u4E0D\u51FA\uFF0C\u70B9\u300C\u68C0\u67E5\u66F4\u65B0\u300D\u91CD\u67E5\u4E00\u6B21", draft: true },
  "batch.row-action.installing": { en: "Installing\u2026", zh: "\u5B89\u88C5\u4E2D\u2026", draft: true },
  "batch.row-action.cancel-queue": { en: "Cancel queue", zh: "\u53D6\u6D88\u6392\u961F", draft: true },
  "batch.row-action.queue": { en: "Join queue", zh: "\u52A0\u5165\u961F\u5217", draft: true },
  "batch.row-action.install-row": { en: "Install this plugin", zh: "\u5B89\u88C5\u8FD9\u5BB6", draft: true },
  "batch.row-action.retry": { en: "Retry", zh: "\u91CD\u8BD5", draft: true },
  "batch.row-action.install-version": { en: "Install {version}", zh: "\u5B89\u88C5 {version}", draft: true },
  "batch.row-action.install-generic": { en: "Install the new version", zh: "\u5B89\u88C5 \u65B0\u7248", draft: true },
  "batch.row-action.unskip": { en: "Restore ({version})", zh: "\u6062\u590D\uFF08{version}\uFF09", draft: true },
  "batch.row-action.restart": { en: "Restart host", zh: "\u91CD\u542F\u5BBF\u4E3B", draft: true },
  "batch.row-action.show-detail": { en: "Details", zh: "\u8BE6\u60C5", draft: true },
  "batch.row-action.hide-detail": { en: "Collapse", zh: "\u6536\u8D77", draft: true },
  "batch.row-action.skip": { en: "Skip this version", zh: "\u8DF3\u8FC7\u8FD9\u4E00\u7248", draft: true },
  "batch.row-action.copy-manual": { en: "Copy manual command", zh: "\u590D\u5236\u624B\u5DE5\u547D\u4EE4", draft: true },
  "batch.row-action.copy-diag": { en: "Copy diagnostics", zh: "\u590D\u5236\u8BCA\u65AD", draft: true },
  "batch.row.error-label": { en: "Failed {code}: {detail}", zh: "\u5931\u8D25 {code}\uFF1A{detail}", draft: true },
  "batch.diag.source-job": { en: "(Source: background job record)", zh: "\uFF08\u6765\u6E90\uFF1A\u540E\u53F0\u4EFB\u52A1\u6536\u5C3E\u8BB0\u5F55\uFF09", draft: true },
  "batch.toast.copy-fail": { en: "Copy failed; please select the info above manually.", zh: "\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u9009\u4E2D\u4E0A\u9762\u7684\u4FE1\u606F\u3002", draft: true },
  "batch.toast.queue-missed": { en: "Another install is running: this plugin is not queued yet; try again after it finishes.", zh: "\u524D\u9762\u8FD8\u5728\u88C5\uFF1A\u8FD9\u4E00\u5BB6\u8FD8\u6CA1\u6392\u4E0A\uFF0C\u7B49\u90A3\u5BB6\u88C5\u5B8C\u518D\u70B9\u4E00\u6B21\u3002", draft: true },
  "batch.toast.skipped": { en: "Skipped {version}: no further reminders for this version; select \u201CRestore\u201D to undo.", zh: "\u5DF2\u8DF3\u8FC7 {version}\uFF1A\u8FD9\u4E00\u7248\u4E0D\u518D\u63D0\u9192\uFF1B\u70B9\u300C\u6062\u590D\u300D\u53EF\u64A4\u9500\u3002", draft: true },
  "batch.toast.unskipped-version": { en: "Restored {version}: reminders for this version are back on.", zh: "\u5DF2\u6062\u590D {version}\uFF1A\u8FD9\u4E00\u7248\u4F1A\u7167\u5E38\u63D0\u9192\u3002", draft: true },
  "batch.toast.unskipped-all": { en: "Skip reminder restored.", zh: "\u5DF2\u6062\u590D\u8DF3\u8FC7\u63D0\u9192\u3002", draft: true },
  "batch.toast.cancel-unavailable": { en: "This row carries no phone or ID to cancel the queue; try again after the next refresh.", zh: "\u8FD9\u4E00\u884C\u6CA1\u5E26\u53D6\u6D88\u6392\u961F\u8981\u7528\u7684\u7535\u8BDD\u540D\u6216\u7F16\u53F7\uFF0C\u6682\u4E0D\u80FD\u53D6\u6D88\uFF1A\u7B49\u4E0B\u4E00\u6B21\u5237\u65B0\u518D\u770B\u3002", draft: true },
  "batch.toast.cancel-ok": { en: "Queue cancelled: this plugin will not wait.", zh: "\u5DF2\u53D6\u6D88\u6392\u961F\uFF1A\u8FD9\u4E00\u5BB6\u4E0D\u7B49\u4E86\u3002", draft: true },
  "batch.toast.cancel-fail": { en: "Could not cancel the queue (it may have started installing); see the latest state below.", zh: "\u53D6\u6D88\u6392\u961F\u6CA1\u6210\u529F\uFF08\u53EF\u80FD\u5DF2\u7ECF\u5F00\u59CB\u88C5\u4E86\uFF09\uFF1A\u770B\u4E0B\u9762\u6700\u65B0\u72B6\u6001\u3002", draft: true },
  "batch.toast.copy-manual-ok": { en: "Manual command copied; paste the full line into the terminal to run it.", zh: "\u624B\u5DE5\u547D\u4EE4\u5DF2\u590D\u5236\uFF0C\u7C98\u5230\u7EC8\u7AEF\u6574\u884C\u6267\u884C\u5373\u53EF\u3002", draft: true },
  "batch.toast.copy-diag-ok": { en: "Diagnostics copied; paste it to the plugin author (already redacted).", zh: "\u8BCA\u65AD\u5DF2\u590D\u5236\uFF0C\u76F4\u63A5\u7C98\u7ED9\u63D2\u4EF6\u4F5C\u8005\u5373\u53EF\uFF08\u5DF2\u8131\u654F\uFF09\u3002", draft: true },
  "batch.toast.restart-delegated": { en: "Handled by the caller\u2019s restart flow; the new version takes effect after restart.", zh: "\u5DF2\u6309\u8C03\u7528\u65B9\u7684\u91CD\u542F\u6D41\u7A0B\u5904\u7406\uFF1B\u91CD\u542F\u540E\u65B0\u7248\u751F\u6548\u3002", draft: true },
  "batch.toast.restart-manual": { en: "This host provides no restart entry; please restart the host manually. The new version takes effect after restart.", zh: "\u672C\u5BBF\u4E3B\u672A\u63D0\u4F9B\u91CD\u542F\u5165\u53E3\uFF1A\u8BF7\u624B\u52A8\u91CD\u542F\u5BBF\u4E3B\uFF0C\u91CD\u542F\u540E\u65B0\u7248\u751F\u6548\u3002", draft: true },
  "batch.toast.restart-failed": { en: "Restart entry failed; please restart the host manually. The new version takes effect after restart.", zh: "\u91CD\u542F\u5165\u53E3\u8C03\u7528\u5931\u8D25\uFF1A\u8BF7\u624B\u52A8\u91CD\u542F\u5BBF\u4E3B\uFF0C\u91CD\u542F\u540E\u65B0\u7248\u751F\u6548\u3002", draft: true },
  "changelog.neutral.hint": { en: "No changelog provided", zh: "\u4F5C\u8005\u672A\u63D0\u4F9B\u66F4\u65B0\u8BF4\u660E", draft: true },
  "changelog.neutral.line": { en: "No changelog provided. Install is not affected.", zh: "\u4F5C\u8005\u672A\u63D0\u4F9B\u66F4\u65B0\u8BF4\u660E\uFF0C\u5B89\u88C5\u4E0D\u53D7\u5F71\u54CD\u3002", draft: true },
  "changelog.breaking.badge": { en: "Breaking", zh: "\u4E0D\u517C\u5BB9", draft: true },
  "changelog.breaking.aria": { en: "Breaking change", zh: "\u7834\u574F\u6027\u53D8\u66F4", draft: true },
  "changelog.truncated.count": { en: "Showing {n} of {m} items", zh: "\u5171 {m} \u6761\uFF0C\u4EC5\u663E\u793A\u524D {n} \u6761", draft: true },
  "changelog.yanked.banner": { en: "Version {version} was yanked by the author. Install is not affected. Please confirm before proceeding.", zh: "\u76EE\u6807\u7248\u672C {version} \u5DF2\u88AB\u4F5C\u8005\u64A4\u56DE\uFF08yanked\uFF09\uFF0C\u5B89\u88C5\u4E0D\u53D7\u5F71\u54CD\uFF0C\u7EE7\u7EED\u524D\u8BF7\u786E\u8BA4\u3002", draft: true },
  "changelog.yanked.suffix": { en: " \xB7 Yanked", zh: " \xB7 \u5DF2\u64A4\u56DE", draft: true },
  "changelog.security.summary": { en: "{n} more items", zh: "\u5176\u4F59 {n} \u6761", draft: true },
  "changelog.security.note": { en: "Remaining entries are collapsed to keep the panel fast. See the original text.", zh: "\u4E3A\u4FDD\u6301\u9762\u677F\u6027\u80FD\uFF0C\u5176\u4F59\u6761\u76EE\u5DF2\u6298\u53E0\uFF0C\u53EF\u67E5\u770B\u539F\u6587\u3002", draft: true },
  "diag.fallback.generic": { en: "Operation failed", zh: "\u64CD\u4F5C\u5931\u8D25", draft: true },
  "diag.fallback.read-installed": { en: "Failed to read local state", zh: "\u8BFB\u672C\u5730\u72B6\u6001\u6CA1\u6210\u529F", draft: true },
  "diag.fallback.revalidate-fetch": { en: "Revalidation fetch failed before install", zh: "\u88C5\u524D\u91CD\u9A8C\u53D6\u6570\u6CA1\u6210\u529F", draft: true },
  "diag.fallback.rate-limited": { en: "Source returned 429. Too many requests this minute.", zh: "\u6E90\u8FD4\u56DE 429\uFF0C\u8FD9\u4E00\u5206\u949F\u8BF7\u6C42\u592A\u591A", draft: true },
  "diag.fallback.http-status": { en: "Source returned {status}. Retry still failed.", zh: "\u6E90\u8FD4\u56DE {status}\uFF0C\u91CD\u8BD5\u4ECD\u5931\u8D25", draft: true },
  "diag.fallback.invalid-release": { en: "Version in the manifest is not valid", zh: "\u6E05\u5355\u91CC\u7684\u7248\u672C\u53F7\u4E0D\u662F\u5408\u6CD5\u7248\u672C", draft: true },
  "diag.fallback.install-failed": { en: "Install failed", zh: "\u5B89\u88C5\u5931\u8D25", draft: true },
  "diag.fallback.unknown-profile": { en: "Scope or plugin location not recognized", zh: "\u4F7F\u7528\u8303\u56F4\u6216\u63D2\u4EF6\u4F4D\u7F6E\u8BA4\u4E0D\u51FA", draft: true },
  "diag.fallback.source-install": { en: "Installed from source, not by version", zh: "\u5F53\u524D\u662F\u4ECE\u6E90\u7801\u88C5\u7684\uFF0C\u4E0D\u662F\u6309\u7248\u672C\u53F7\u88C5\u7684", draft: true },
  "diag.fallback.invalid-installation": { en: "Installed package is incomplete", zh: "\u5DF2\u88C5\u7684\u5305\u4E0D\u5B8C\u6574", draft: true },
  "diag.fallback.installation-changed": { en: "Install location changed during use", zh: "\u5B89\u88C5\u4F4D\u7F6E\u5728\u4F7F\u7528\u4E2D\u9014\u53D8\u4E86", draft: true },
  "diag.fallback.pending-restart": { en: "New version is on disk. The running version is still the old one.", zh: "\u65B0\u7248\u5DF2\u88C5\u5230\u78C1\u76D8\uFF0C\u6B63\u5728\u8DD1\u7684\u8FD8\u662F\u65E7\u7248", draft: true },
  "diag.fallback.incompatible-node": { en: "New version needs a different Node version than the running one", zh: "\u65B0\u7248\u8981\u6C42\u7684 Node \u4E0E\u5F53\u524D\u8FD0\u884C\u7684\u5BF9\u4E0D\u4E0A", draft: true },
  "diag.fallback.registry-conflict": { en: "Declared version conflicts with the on-disk version", zh: "\u672C\u5730\u58F0\u660E\u7684\u7248\u672C\u4E0E\u78C1\u76D8\u5B9E\u9645\u7248\u672C\u4E92\u76F8\u77DB\u76FE", draft: true },
  "diag.fallback.recovery-required": { en: "Last install was interrupted, leaving a partial task", zh: "\u4E0A\u6B21\u5B89\u88C5\u88AB\u6253\u65AD\uFF0C\u7559\u4E0B\u4E00\u4E2A\u534A\u622A\u4EFB\u52A1", draft: true }
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

// node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/changelog.js
var CHANGELOG_FILENAME = "CHANGELOG.md";
var CHANGELOG_NEUTRAL_HINT = "\u4F5C\u8005\u672A\u63D0\u4F9B\u66F4\u65B0\u8BF4\u660E";
var CHANGELOG_NEUTRAL_LINE = "\u4F5C\u8005\u672A\u63D0\u4F9B\u66F4\u65B0\u8BF4\u660E\uFF0C\u5B89\u88C5\u4E0D\u53D7\u5F71\u54CD\u3002";
var CHANGELOG_MAX_CHARS = 64 * 1024;
var CHANGELOG_MAX_ENTRIES = 100;
var CHANGELOG_MAX_BULLETS_PER_SECTION = 200;
var CHANGELOG_MAX_BULLET_CHARS = 500;
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
  return null;
}
function isUnreleasedVersion(v) {
  return typeof v === "string" && v.trim().toLowerCase() === "unreleased";
}
function extractVersionDateAndYanked(title) {
  const t = String(title || "").trim();
  if (!t) return { version: null, date: null, yanked: false };
  const yanked = /\[YANKED\]/i.test(t);
  if (/unreleased/i.test(t)) return { version: "Unreleased", date: null, yanked };
  const vm = t.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
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
var RE_VERSION_HEADING = /^##(?!#)\s*(.+?)\s*$/;
var RE_CATEGORY_HEADING = /^###\s*(.+?)\s*$/;
var RE_BULLET = /^\s*[-*+]\s+(.+?)\s*$/;
var RE_FENCE_TOGGLE = new RegExp("^\\s*(" + String.fromCharCode(96).repeat(3) + "|~~~)");
function matchVersionHeading(line) {
  try {
    const s = String(line !== null && line !== void 0 ? line : "");
    const m = s.match(RE_VERSION_HEADING);
    if (!m) return null;
    return String(m[1] !== void 0 && m[1] !== null ? m[1] : "").trim();
  } catch {
    return null;
  }
}
function matchCategoryHeading(line) {
  try {
    const s = String(line !== null && line !== void 0 ? line : "");
    const m = s.match(RE_CATEGORY_HEADING);
    if (!m) return null;
    return String(m[1] !== void 0 && m[1] !== null ? m[1] : "").trim();
  } catch {
    return null;
  }
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
function parseChangelog(markdown) {
  try {
    if (typeof markdown !== "string" || !markdown.trim()) return [];
    let text = markdown.replace(/\r\n/g, "\n");
    if (text.length > CHANGELOG_MAX_CHARS) text = text.slice(0, CHANGELOG_MAX_CHARS);
    const lines = text.split("\n");
    const entries = [];
    let cur = null;
    let curCat = null;
    let inFence = false;
    const pushCurrent = () => {
      if (!cur) return;
      const hasAny = CHANGELOG_ALL_CATEGORIES.some(
        (c) => cur.sections[c].length > 0
      );
      if (!hasAny) return;
      for (const c of CHANGELOG_ALL_CATEGORIES) {
        const list = cur.sections[c];
        if (list.length > CHANGELOG_MAX_BULLETS_PER_SECTION) {
          cur.sections[c] = list.slice(0, CHANGELOG_MAX_BULLETS_PER_SECTION);
        }
      }
      entries.push(cur);
    };
    for (const rawLine of lines) {
      const line = String(rawLine ?? "");
      if (isFenceToggle(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const versionTitle = matchVersionHeading(line);
      if (versionTitle !== null) {
        pushCurrent();
        cur = null;
        curCat = null;
        const title = versionTitle;
        const { version, date, yanked } = extractVersionDateAndYanked(title);
        if (!version) continue;
        cur = { version, date, yanked, sections: emptySections(), counts: emptyCounts() };
        continue;
      }
      const catTitle = matchCategoryHeading(line);
      if (catTitle !== null) {
        const cat = normalizeCategory(catTitle);
        curCat = cur && cat && isCategoryName(cat) ? cat : null;
        continue;
      }
      const bulletBody = matchBulletBody(line);
      if (bulletBody !== null && cur && curCat) {
        const item = truncateBullet(bulletBody);
        if (item) {
          cur.sections[curCat].push(item);
          try {
            if (cur.counts) cur.counts[curCat] += 1;
          } catch {
          }
        }
        continue;
      }
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && /^\s/.test(line) && cur && curCat) {
        const list = cur.sections[curCat];
        if (list.length > 0) {
          const merged = truncateBullet(`${list[list.length - 1]} ${trimmed}`);
          if (merged) list[list.length - 1] = merged;
        }
        continue;
      }
    }
    pushCurrent();
    return entries.slice(0, CHANGELOG_MAX_ENTRIES);
  } catch {
    return [];
  }
}
function hasVisibleSections(entry) {
  if (!entry || typeof entry !== "object") return false;
  try {
    return CHANGELOG_ALL_CATEGORIES.some((c) => Array.isArray(entry.sections?.[c]) && entry.sections[c].length > 0);
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
function renderChangelogItem(item, lang) {
  try {
    const l = normalizeLangTag(lang ?? "zh");
    const s = String(item !== null && item !== void 0 ? item : "");
    if (!s) return "";
    const split = splitBreakingPrefix(s);
    if (!split) return "<li>" + escapeChangelogHtml(s) + "</li>";
    const head = escapeChangelogHtml(split.head);
    const prefix = escapeChangelogHtml(split.prefix);
    const rest = escapeChangelogHtml(split.rest);
    const badgeText = updCopyText("changelog.breaking.badge", l);
    const badgeAria = updCopyText("changelog.breaking.aria", l);
    const badge = '<span class="dsh-upd-breaking-badge" role="img" aria-label="' + escapeChangelogHtml(badgeAria) + '">' + escapeChangelogHtml(badgeText) + "</span> ";
    return "<li>" + head + badge + "<strong>" + prefix + "</strong>" + rest + "</li>";
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
    const title = (date ? version + " \xB7 " + date : version) + yankedSuffix;
    const counts = countsOf(entry);
    const parts = [];
    parts.push('<div class="dsh-upd-changelog-version" data-version="' + escapeChangelogHtml(version) + '">');
    parts.push('<div class="dsh-upd-changelog-title">' + escapeChangelogHtml(title) + "</div>");
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
        const li = renderChangelogItem(item, l);
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
        const li = renderChangelogItem(item, l);
        if (li) parts.push(li);
      }
      parts.push("</ul></details>");
    }
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
function renderChangelogHTML(entries, opts) {
  try {
    const l = normalizeLangTag(opts?.lang ?? "zh");
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
    if (ranged.length === 0) return renderChangelogNeutral(l);
    const blocks = ranged.map((e) => renderChangelogSection(e, l)).filter((s) => !!s);
    if (blocks.length === 0) return renderChangelogNeutral(l);
    return `<div class="dsh-upd-changelog">
${blocks.join("\n")}
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

// node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/client.js
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
