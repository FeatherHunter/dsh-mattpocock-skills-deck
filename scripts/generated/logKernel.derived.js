// 派生文件（#564）：由已安装日志包的 dist/client.js（含配置面与客户端分面）打包生成，内容与日志包 0.4.1 一致，人手不改。
// 旧模块（src/client/kernel/log.ts）已随 #1143 删除；构建时本文件拼入原来日志模块的位置（kernel:log 标记处）。
// 重新生成：node scripts/derive-log-from-package.mts。
// ---- 作用域隔离（0.3.x）：包体多文件打包的顶层声明与下面 tail 同名，包进 IIFE 藏起来，只留三个外面要用的 ----
const __pkgLogScope = (() => {
  // packages/dsh-log/dist/core/row.js
  var LOG_FORMAT_VERSION = 3;

  // packages/dsh-log/dist/core/level.js
  var LOG_LEVEL_ORDER = ["error", "warn", "info", "debug"];
  var LEVEL_SEVERITY = { error: 0, warn: 1, info: 2, debug: 3 };
  function isKnownLevel(level) {
    return typeof level === "string" && Object.prototype.hasOwnProperty.call(LEVEL_SEVERITY, level);
  }
  function isUrgentLevel(level) {
    return level === "error" || level === "warn";
  }
  function isErrorLevel(level) {
    return level === "error";
  }

  // packages/dsh-log/dist/config/constants.js
  var DEFAULT_MAX_SIZE = 5 * 1024 * 1024;
  var CLIENT_BATCH_MAX = 50;
  var CLIENT_BATCH_INTERVAL_MS = 1e3;
  var CLIENT_PACKET_BYTES = 128 * 1024;
  var CLIENT_QUEUE_MAX = 100;
  var PHONE_ACTIONS = ["logBatch", "logExport", "logClear", "logGetSwitch", "logSetSwitch"];
  var EVENT_LEVELS = LOG_LEVEL_ORDER;
  var EVENT_KINDS = ["resident", "ondemand", "selfmon"];
  var LOG_QUERY_ACTION_SUFFIX = "logQuery";

  // packages/dsh-log/dist/config/validate.js
  var ID_PATTERN = /^[a-z0-9-]{1,32}$/;
  function assertPluginId(value, role) {
    if (typeof value !== "string" || !ID_PATTERN.test(value)) {
      throw new Error("[dsh-log] " + role + " \u975E\u6CD5\uFF1A\u53EA\u80FD\u7528\u5C0F\u5199\u82F1\u6587\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u4E2D\u6A2A\u7EBF\uFF0C\u957F\u5EA6 1 \u5230 32\uFF08\u6536\u5230 " + JSON.stringify(value) + "\uFF09");
    }
    return value;
  }

  // packages/dsh-log/dist/config/event-list.js
  function isNonEmptyString(value) {
    return typeof value === "string" && value.length > 0;
  }
  function assertStringArray(value, what) {
    if (!Array.isArray(value))
      throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1A" + what + " \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6570\u7EC4");
    const seen = [];
    for (const item of value) {
      if (!isNonEmptyString(item))
        throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1A" + what + " \u91CC\u6709\u7A7A\u5B57\u6BB5\u540D");
      if (seen.indexOf(item) >= 0)
        throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1A" + what + " \u91CC\u5B57\u6BB5\u540D\u91CD\u590D\uFF1A" + item);
      seen.push(item);
    }
    return seen;
  }
  function parseEventListManifest(value) {
    if (typeof value === "string") {
      throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1A\u8DEF\u5F84\u5F62\u5F0F\u8BF7\u8C03\u7528\u65B9\u81EA\u5DF1\u8BFB\u6210\u5BF9\u8C61\u518D\u4F20\u5165\uFF0C\u65E5\u5FD7\u5305\u4E0D\u8BFB\u76D8");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1A\u53EA\u6536\u5BF9\u8C61\u5F62\u5F0F\uFF08\u7A7A\u6A21\u677F\u89C1\u5305\u5185\u7684 event-list.template.json\uFF09");
    }
    const input = value;
    if (input["version"] !== 1) {
      throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1Aversion \u73B0\u5728\u53EA\u8BA4 1\uFF08\u6536\u5230 " + JSON.stringify(input["version"]) + "\uFF09");
    }
    const pluginId = assertPluginId(input["pluginId"], "\u4E8B\u4EF6\u6E05\u5355 pluginId");
    const eventsRaw = input["events"];
    if (!eventsRaw || typeof eventsRaw !== "object" || Array.isArray(eventsRaw)) {
      throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1Aevents \u5FC5\u987B\u662F\u4E8B\u4EF6\u540D\u5230\u6761\u76EE\u7684\u5BF9\u8C61");
    }
    const events = {};
    for (const name of Object.keys(eventsRaw)) {
      events[name] = parseEventEntry(name, eventsRaw[name]);
    }
    const counts = computeEventCounts({ version: 1, pluginId, counts: { resident: 0, ondemand: 0, selfmon: 0 }, events });
    return { version: 1, pluginId, counts, events };
  }
  function parseEventEntry(name, value) {
    if (!isNonEmptyString(name))
      throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1A\u4E8B\u4EF6\u540D\u4E0D\u80FD\u4E3A\u7A7A");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1A\u4E8B\u4EF6 " + name + " \u5FC5\u987B\u662F\u5BF9\u8C61");
    }
    const input = value;
    if (EVENT_LEVELS.indexOf(input["level"]) < 0) {
      throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1A\u4E8B\u4EF6 " + name + " \u7684 level \u53EA\u8BB8 error\u3001warn\u3001info\u3001debug");
    }
    if (EVENT_KINDS.indexOf(input["kind"]) < 0) {
      throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1A\u4E8B\u4EF6 " + name + " \u7684 kind \u53EA\u8BB8 resident\u3001ondemand\u3001selfmon");
    }
    for (const key of Object.keys(input)) {
      if (["level", "kind", "fields", "codes", "rules", "guard"].indexOf(key) < 0) {
        throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1A\u4E8B\u4EF6 " + name + " \u6709\u4E0D\u8BA4\u8BC6\u7684\u952E " + key);
      }
    }
    const entry = {
      level: input["level"],
      kind: input["kind"],
      fields: assertStringArray(input["fields"], "\u4E8B\u4EF6 " + name + " \u7684 fields")
    };
    if (input["codes"] !== void 0)
      entry.codes = assertStringArray(input["codes"], "\u4E8B\u4EF6 " + name + " \u7684 codes");
    if (input["rules"] !== void 0)
      entry.rules = assertStringArray(input["rules"], "\u4E8B\u4EF6 " + name + " \u7684 rules");
    if (input["guard"] !== void 0) {
      if (typeof input["guard"] !== "string") {
        throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1A\u4E8B\u4EF6 " + name + " \u7684 guard \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
      }
      entry.guard = input["guard"];
    }
    return entry;
  }
  function computeEventCounts(manifest) {
    const actual = { resident: 0, ondemand: 0, selfmon: 0 };
    for (const name of Object.keys(manifest.events)) {
      actual[manifest.events[name].kind] += 1;
    }
    return actual;
  }

  // packages/dsh-log/dist/config/phones.js
  function buildPhoneName(prefix, action) {
    return assertPluginId(prefix, "\u7535\u8BDD\u540D\u524D\u7F00 prefix") + "." + action;
  }
  function buildPhoneNames(prefix) {
    const checked = assertPluginId(prefix, "\u7535\u8BDD\u540D\u524D\u7F00 prefix");
    const names = {};
    for (const action of PHONE_ACTIONS)
      names[action] = checked + "." + action;
    return names;
  }
  function buildLogQueryPhoneName(prefix) {
    return assertPluginId(prefix, "\u7535\u8BDD\u540D\u524D\u7F00 prefix") + "." + LOG_QUERY_ACTION_SUFFIX;
  }

  // packages/dsh-log/dist/core/ids.js
  function hash8(value) {
    try {
      const t = String(value || "");
      let h = 5381;
      for (let i = 0; i < t.length; i++)
        h = (h << 5) + h + t.charCodeAt(i) >>> 0;
      return ("0000000" + h.toString(16)).slice(-8);
    } catch (e) {
      void e;
      return "00000000";
    }
  }
  function genHex(len) {
    try {
      const digits = "0123456789abcdef";
      let out = "";
      for (let i = 0; i < len; i++)
        out += digits[Math.floor(Math.random() * 16)];
      return out || "0".repeat(len);
    } catch (e) {
      void e;
      return "0".repeat(len > 0 ? len : 8);
    }
  }

  // packages/dsh-log/dist/core/resident.js
  var BUILTIN_RESIDENT_EVENTS = [
    "snapshot.request",
    "snapshot.cache.miss",
    "repo.resolve.tier",
    "gh.exec",
    "gh.timeout",
    "gh.resolve.fail",
    "graphql.fallback",
    "issues.fallback",
    "snapshot.built",
    "panelSync.dirty",
    "registry.select",
    "detection.detect",
    "skill.probe",
    "skill.pending.cap",
    "host.call",
    "host.call.fail",
    "snapshot.hydrate",
    "backend.switch",
    "naming.guard",
    "naming.lock",
    "panel.open",
    "statusbar.fallback",
    "dock.rehydrate",
    "storage.fail",
    "chain.derive.error",
    "fallback.chain",
    "client.snapshot.miss",
    "host.start",
    "update.install.exec",
    "labelColors.write",
    "guide.inject",
    "healthCheck.inject",
    "choiceStore.file.bad",
    "choiceStore.write.fail",
    "issues.page",
    "sessionTickets.chain",
    "chain.backoff",
    "host.dispatch.empty",
    "naming.summary",
    "cwd.persisted",
    "update.install.manifestSync",
    "git.exec",
    "git.exec.fail"
  ];
  function declaredResidentEvents(manifest) {
    if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest))
      return [];
    const events = manifest.events;
    if (events === null || typeof events !== "object" || Array.isArray(events))
      return [];
    const names = [];
    for (const name of Object.keys(events)) {
      const entry = events[name];
      if (entry !== null && typeof entry === "object" && entry.kind === "resident") {
        names.push(name);
      }
    }
    return names;
  }
  function residentEventSet(manifest) {
    const set = new Set(BUILTIN_RESIDENT_EVENTS);
    for (const name of declaredResidentEvents(manifest))
      set.add(name);
    return set;
  }

  // packages/dsh-log/dist/client/switch-cache.js
  function createSwitchCache(input) {
    const storage = input.storage;
    const debugKey = input.debugKey;
    const LOG_REV2 = input.rev;
    function readLocalDebugSwitch() {
      const fallback = { enabled: false, rev: LOG_REV2 };
      try {
        if (!storage || typeof storage.getItem !== "function")
          return fallback;
        const raw = storage.getItem(debugKey);
        if (!raw)
          return fallback;
        const saved = JSON.parse(raw);
        if (!saved || typeof saved !== "object")
          return fallback;
        return {
          enabled: saved.enabled === true,
          rev: typeof saved.rev === "number" && isFinite(saved.rev) ? saved.rev : LOG_REV2
        };
      } catch (e) {
        void e;
        return fallback;
      }
    }
    function persistLocalDebugSwitch(state) {
      try {
        if (!storage || typeof storage.setItem !== "function")
          return false;
        storage.setItem(debugKey, JSON.stringify({
          enabled: !!(state && state.enabled),
          rev: state && typeof state.rev === "number" && isFinite(state.rev) ? state.rev : LOG_REV2
        }));
        return true;
      } catch (e) {
        void e;
        return false;
      }
    }
    return { read: readLocalDebugSwitch, persist: persistLocalDebugSwitch };
  }

  // packages/dsh-log/dist/client/trace.js
  function createTraceStage(input) {
    const traceState = input.state;
    function ensureSpanId() {
      if (!traceState.spanId) {
        traceState.spanId = genHex(8);
        if (traceState.spanSource === "none")
          traceState.spanSource = "auto";
      }
      return traceState.spanId;
    }
    function ensureTraceForLevel(level) {
      if (traceState.traceId)
        return traceState.traceId;
      if (isKnownLevel(level)) {
        traceState.traceId = genHex(16);
        traceState.traceSource = "auto";
        ensureSpanId();
        return traceState.traceId;
      }
      return traceState.traceId;
    }
    return { ensureSpanId, ensureForLevel: ensureTraceForLevel };
  }

  // packages/dsh-log/dist/client/transport.js
  var LOG_PACKET_BYTES = CLIENT_PACKET_BYTES;
  var LOG_RETRY_MAX_ATTEMPTS = 3;
  var LOG_RETRY_BACKOFF_MS = 500;
  function estimateBatchBytes(entries) {
    try {
      const text = JSON.stringify(entries);
      const g = globalThis;
      if (typeof g.TextEncoder !== "undefined")
        return new g.TextEncoder().encode(text).length;
      return String(text).length;
    } catch (e) {
      void e;
      return LOG_PACKET_BYTES + 1;
    }
  }

  // packages/dsh-log/dist/client/switch-ops.js
  function createSwitchOps(input) {
    const host = input.host;
    const phoneNames = input.phoneNames;
    const timer = input.timer;
    const LOG_WATCHDOG_MS2 = input.watchdogMs;
    const logSwitch = input.state;
    const setLogSwitchGen = input.gen;
    const persistLocalDebugSwitch = input.cache.persist;
    const broadcast = input.broadcast;
    const log = input.log;
    const watchSwitchOp = input.watch;
    function reconcileLogSwitch() {
      if (!host || typeof host.call !== "function") {
        return Promise.resolve({ ok: false, enabled: logSwitch.enabled });
      }
      try {
        const pendingGet = host.call(phoneNames.logGetSwitch, {});
        watchSwitchOp("reconcile", pendingGet);
        return pendingGet.then(function(res) {
          const body = res && typeof res === "object" ? res : null;
          if (!body || body.ok !== true)
            return { ok: false, enabled: logSwitch.enabled };
          logSwitch.enabled = body.enabled === true;
          persistLocalDebugSwitch(logSwitch);
          try {
            if (broadcast)
              broadcast();
          } catch (e) {
            void e;
          }
          return { ok: true, enabled: logSwitch.enabled };
        }).catch(function() {
          return { ok: false, enabled: logSwitch.enabled };
        });
      } catch (e) {
        void e;
        return Promise.resolve({ ok: false, enabled: logSwitch.enabled });
      }
    }
    const logSwitchSetFail = function(kind, hint) {
      try {
        log("warn", "host.call.fail", {
          method: phoneNames.logSetSwitch,
          kind: "set-switch-" + kind,
          errorHash: hash8(String(hint === void 0 || hint === null ? kind : hint).slice(0, 120))
        });
      } catch (e) {
        void e;
      }
    };
    const switchThrowKind = function(e) {
      const msg = String((e && typeof e === "object" && ("code" in e || "message" in e) ? e.code || e.message : e) || "");
      if (/unknown endpoint/i.test(msg))
        return "throw-unknown-endpoint";
      if (/connection|host\.call 不可用|unavailable/i.test(msg))
        return "throw-connection";
      return "throw";
    };
    const failByThrow = function(e) {
      const kind = switchThrowKind(e);
      logSwitchSetFail(kind, (e && typeof e === "object" && "message" in e ? e.message : void 0) || e);
      return kind;
    };
    function setLogSwitch(enabled) {
      const next = { enabled: enabled === true };
      if (!host || typeof host.call !== "function") {
        logSwitchSetFail("host-unavailable", "host-unavailable");
        return Promise.resolve({ ok: false, enabled: logSwitch.enabled, error: "host-unavailable" });
      }
      try {
        const pendingSet = host.call(phoneNames.logSetSwitch, next);
        watchSwitchOp("set", pendingSet);
        const myGen = setLogSwitchGen.n += 1;
        const timeoutAt = new Promise(function(resolve) {
          const fire = function() {
            resolve({ switchTimedOut: true });
          };
          try {
            if (timer !== null && timer !== void 0 && typeof timer.timeout === "function") {
              timer.timeout(fire, LOG_WATCHDOG_MS2);
              return;
            }
          } catch (e) {
            void e;
          }
          try {
            setTimeout(fire, LOG_WATCHDOG_MS2);
          } catch (e2) {
            void e2;
          }
        });
        return Promise.race([pendingSet, timeoutAt]).then(function(res) {
          const body = res && typeof res === "object" ? res : null;
          if (body && body["switchTimedOut"] === true) {
            logSwitchSetFail("timeout", "timeout-" + LOG_WATCHDOG_MS2);
            return { ok: false, enabled: logSwitch.enabled, error: "switch-timeout" };
          }
          if (myGen !== setLogSwitchGen.n)
            return { ok: false, enabled: logSwitch.enabled, error: "stale" };
          if (!body || body["ok"] !== true) {
            logSwitchSetFail("host-rejected", "host-rejected");
            return { ok: false, enabled: logSwitch.enabled, error: "host-rejected" };
          }
          logSwitch.enabled = body["enabled"] === true;
          persistLocalDebugSwitch(logSwitch);
          try {
            if (broadcast)
              broadcast();
          } catch (e) {
            void e;
          }
          return { ok: true, enabled: logSwitch.enabled };
        }).catch(function(e) {
          if (myGen !== setLogSwitchGen.n)
            return { ok: false, enabled: logSwitch.enabled, error: "stale" };
          return { ok: false, enabled: logSwitch.enabled, error: failByThrow(e) };
        });
      } catch (e) {
        return Promise.resolve({ ok: false, enabled: logSwitch.enabled, error: failByThrow(e) });
      }
    }
    return { reconcile: reconcileLogSwitch, set: setLogSwitch };
  }

  // packages/dsh-log/dist/client/forward.js
  function createForwardStage(input) {
    const logDiagnostic = input.logDiagnostic;
    const logDroppedState = input.dropped;
    const logForwardState = input.forward;
    const timer = input.timer;
    const LOG_WATCHDOG_MS2 = input.watchdogMs;
    const hashFn = input.hashFn;
    function maybeForwardSummary() {
      const delta = logDroppedState.count - logForwardState.lastSummaryDropped;
      if (delta <= 0)
        return;
      logForwardState.lastSummaryDropped = logDroppedState.count;
      const now = Date.now();
      const windowMs = now - logForwardState.lastSummaryAt;
      logForwardState.lastSummaryAt = now;
      const fields = {
        droppedDelta: delta,
        totalDropped: logDroppedState.count,
        reason: logForwardState.lastReason || "send-fail",
        windowMs
      };
      if (logForwardState.lastAccepted >= 0)
        fields.accepted = logForwardState.lastAccepted;
      if (logForwardState.lastSkipped >= 0)
        fields.skipped = logForwardState.lastSkipped;
      if (logForwardState.lastRejected >= 0)
        fields.rejected = logForwardState.lastRejected;
      try {
        logDiagnostic("warn", 'log.forward.summary', fields);
      } catch (e) {
        void e;
      }
    }
    function logExportFail(op, reason, err) {
      try {
        const hash = hashFn && typeof hashFn === "function" ? hashFn : hash8;
        const raw = err && typeof err === "object" && "message" in err ? String(err.message) : String(err || reason);
        const sliced = String(raw || "").slice(0, 120);
        let hashed = "";
        try {
          hashed = hash(sliced);
        } catch (eH) {
          void eH;
          hashed = hash8(sliced);
        }
        logDiagnostic("warn", 'log.export.fail', { op, reason, errorHash: hashed });
      } catch (e) {
        void e;
      }
    }
    function watchSwitchOp(op, pending) {
      let settled = false;
      try {
        if (pending && typeof pending.then === "function") {
          ;
          pending.then(function() {
            settled = true;
          }, function() {
            settled = true;
          });
        }
      } catch (e) {
        void e;
      }
      const fire = function() {
        if (!settled) {
          settled = true;
          try {
            logDiagnostic("warn", 'log.switch.watchdog', { op, timeoutMs: LOG_WATCHDOG_MS2, stage: "waiting-host" });
          } catch (e) {
            void e;
          }
        }
      };
      try {
        if (timer !== null && timer !== void 0 && typeof timer.timeout === "function") {
          timer.timeout(fire, LOG_WATCHDOG_MS2);
          return;
        }
      } catch (e) {
        void e;
      }
      try {
        setTimeout(fire, LOG_WATCHDOG_MS2);
      } catch (e2) {
        void e2;
      }
    }
    return {
      maybeForwardSummary,
      logExportFail,
      watchSwitchOp
    };
  }

  // packages/dsh-log/dist/core/admission.js
  function findEvictableIndex(rows) {
    for (let i = 0; i < rows.length; i += 1)
      if (!isUrgentLevel(rows[i].level))
        return i;
    return -1;
  }
  function findTrimmableIndex(rows, direction) {
    if (direction === "newest-first") {
      for (let i = rows.length - 1; i >= 0; i -= 1)
        if (!isErrorLevel(rows[i].level))
          return i;
      return -1;
    }
    for (let i = 0; i < rows.length; i += 1)
      if (!isErrorLevel(rows[i].level))
        return i;
    return -1;
  }

  // packages/dsh-log/dist/client/send.js
  var LOG_BATCH_MAX = CLIENT_BATCH_MAX;
  var LOG_PACKET_BYTES2 = CLIENT_PACKET_BYTES;
  var LOG_QUEUE_MAX = CLIENT_QUEUE_MAX;
  function createSendStage(input) {
    const host = input.host;
    const phoneNames = input.phoneNames;
    const logQueue = input.queue;
    const logRetryState = input.retry;
    const logDroppedState = input.dropped;
    const logForwardState = input.forward;
    const logFlushTimer = input.flushTimer;
    const timer = input.timer;
    const laterRun = input.laterRun;
    const maybeForwardSummary = input.maybeForwardSummary;
    const scheduleLogFlush = input.scheduleLogFlush;
    function userRowCount(rows) {
      let n = 0;
      for (let i = 0; i < rows.length; i += 1)
        if (rows[i].isDiagnostic !== true)
          n += 1;
      return n;
    }
    function settleSendFailure(reason, entries, onlySummary) {
      logForwardState.lastReason = reason;
      if (logRetryState.attempts < LOG_RETRY_MAX_ATTEMPTS) {
        logRetryState.rows = entries.slice();
        logRetryState.attempts += 1;
        if (logRetryState.timer === null) {
          const wait = LOG_RETRY_BACKOFF_MS * logRetryState.attempts;
          logRetryState.timer = laterRun(function() {
            logRetryState.timer = null;
            try {
              sendLogBatch();
            } catch (e) {
              void e;
            }
          }, wait);
        }
      } else {
        const rc = logRetryState.rejectCount;
        const countable = userRowCount(entries);
        logDroppedState.count += rc >= 0 ? Math.min(rc, countable) : countable;
        logRetryState.rows = [];
        logRetryState.rejectCount = -1;
        logRetryState.attempts = 0;
      }
      if (!onlySummary)
        maybeForwardSummary();
      return { ok: false, sent: 0 };
    }
    function sendLogBatch() {
      let entries;
      if (logRetryState.rows.length > 0) {
        entries = logRetryState.rows.splice(0, LOG_BATCH_MAX);
      } else {
        if (logQueue.length === 0)
          return Promise.resolve({ ok: true, sent: 0 });
        entries = logQueue.splice(0, LOG_BATCH_MAX);
      }
      let trimmed = 0;
      while (entries.length > 1 && estimateBatchBytes(entries) > LOG_PACKET_BYTES2) {
        const victim = findTrimmableIndex(entries, "newest-first");
        if (victim < 0)
          break;
        if (entries[victim].isDiagnostic !== true)
          trimmed += 1;
        entries.splice(victim, 1);
      }
      while (logQueue.length > LOG_QUEUE_MAX) {
        const victim = findTrimmableIndex(logQueue, "oldest-first");
        if (victim < 0)
          break;
        if (logQueue[victim].isDiagnostic !== true)
          trimmed += 1;
        logQueue.splice(victim, 1);
      }
      if (trimmed > 0) {
        logDroppedState.count += trimmed;
        logForwardState.lastReason = "packet-trim";
        try {
          entries[entries.length - 1].truncated = true;
        } catch (e) {
          void e;
        }
      }
      const args = { entries, droppedCount: logDroppedState.count };
      const onlySummary = entries.length === 1 && entries[0] && entries[0].event === 'log.forward.summary';
      if (!host || typeof host.call !== "function") {
        logDroppedState.count += userRowCount(entries);
        logForwardState.lastReason = "send-fail";
        if (!onlySummary)
          maybeForwardSummary();
        return Promise.resolve({ ok: false, sent: 0 });
      }
      try {
        return host.call(phoneNames.logBatch, args).then(function(res) {
          const obj = res && typeof res === "object" ? res : null;
          const ok = !!obj && obj.ok === true;
          const countOf = (v) => typeof v === "number" && isFinite(v) && v >= 0 ? Math.floor(v) : -1;
          const acceptedRaw = countOf(obj ? obj.accepted : void 0);
          const skippedRaw = countOf(obj ? obj.skipped : void 0);
          const rejectedRaw = countOf(obj ? obj.rejected : void 0);
          logForwardState.lastAccepted = acceptedRaw;
          logForwardState.lastSkipped = skippedRaw;
          let rejected = rejectedRaw > 0 ? Math.min(rejectedRaw, entries.length) : 0;
          if (!ok && rejected === 0) {
            rejected = acceptedRaw >= 0 ? Math.max(0, Math.min(entries.length - acceptedRaw, entries.length)) : entries.length;
          }
          logForwardState.lastRejected = rejected;
          if (ok && rejected === 0) {
            logRetryState.attempts = 0;
            logRetryState.rejectCount = -1;
            maybeForwardSummary();
            return { ok: true, sent: entries.length };
          }
          logRetryState.rejectCount = rejected;
          return settleSendFailure("host-reject", entries, onlySummary);
        }).catch(function() {
          return settleSendFailure("send-fail", entries, onlySummary);
        });
      } catch (e) {
        void e;
        return Promise.resolve(settleSendFailure("send-fail", entries, onlySummary));
      }
    }
    function flush() {
      if (logFlushTimer.id !== null) {
        try {
          clearTimeout(logFlushTimer.id);
        } catch (e) {
          void e;
        }
        logFlushTimer.id = null;
      }
      try {
        sendLogBatch();
      } catch (e) {
        void e;
      }
      return { ok: true };
    }
    function getDroppedCount() {
      return logDroppedState.count;
    }
    return { sendLogBatch, flush, getDroppedCount };
  }

  // packages/dsh-log/dist/core/trace.js
  var SHADOW_FIELD = "_shadow";
  function isReservedTraceField(key) {
    return key === "traceId" || key === "spanId" || key === "seq";
  }
  function relocateReservedFields(userFields) {
    const fields = {};
    let shadow = null;
    let reservedMoved = false;
    try {
      for (const k of Object.keys(userFields)) {
        if (isReservedTraceField(k)) {
          if (!shadow)
            shadow = {};
          shadow[k] = userFields[k];
          reservedMoved = true;
        } else if (k === SHADOW_FIELD) {
          continue;
        } else {
          fields[k] = userFields[k];
        }
      }
      const userShadow = userFields[SHADOW_FIELD];
      if (userShadow !== void 0) {
        if (userShadow && typeof userShadow === "object" && !Array.isArray(userShadow)) {
          if (!shadow)
            shadow = {};
          const src = userShadow;
          const target = shadow;
          for (const sk of Object.keys(src)) {
            if (target[sk] === void 0)
              target[sk] = src[sk];
          }
        } else if (!shadow) {
          fields[SHADOW_FIELD] = userShadow;
        }
      }
    } catch (e) {
      void e;
    }
    return { fields, shadow, reservedMoved };
  }

  // packages/dsh-log/dist/client/write.js
  var LOG_FLUSH_MS = CLIENT_BATCH_INTERVAL_MS;
  var LOG_QUEUE_MAX2 = CLIENT_QUEUE_MAX;
  function createWriteStage(input) {
    const getSwitchEnabled = input.getSwitchEnabled;
    const logQueue = input.queue;
    const logDroppedState = input.dropped;
    const logForwardState = input.forward;
    const logFlushTimer = input.flushTimer;
    const traceState = input.traceState;
    const ensureSpanId = input.ensureSpanId;
    const ensureTraceForLevel = input.ensureTraceForLevel;
    const sendLogBatch = input.sendLogBatch;
    const timer = input.timer;
    const residentEvents = input.residentEvents;
    function isEnabled(level, event) {
      if (isUrgentLevel(level))
        return true;
      try {
        if (typeof event === "string" && residentEvents.has(event))
          return true;
        return getSwitchEnabled() === true;
      } catch (e) {
        void e;
        return false;
      }
    }
    function dropForRoom(level) {
      if (isUrgentLevel(level)) {
        const victim = findEvictableIndex(logQueue);
        if (victim >= 0) {
          logQueue.splice(victim, 1);
          logDroppedState.count += 1;
          logForwardState.lastReason = "queue-full";
          return;
        }
        if (logQueue.length > 0) {
          logQueue.splice(0, 1);
          logDroppedState.count += 1;
          logForwardState.lastReason = "queue-full";
          return;
        }
      }
      logDroppedState.count += 1;
      logForwardState.lastReason = "queue-full";
    }
    function log(level, event, fields, isDiagnostic) {
      if (!isEnabled(level, event))
        return "skipped";
      if (logQueue.length >= LOG_QUEUE_MAX2) {
        dropForRoom(level);
        if (logQueue.length >= LOG_QUEUE_MAX2)
          return "dropped";
      }
      const userFields = fields && typeof fields === "object" ? fields : {};
      const relocated = relocateReservedFields(userFields);
      const out = relocated.fields;
      const shadow = relocated.shadow;
      if (shadow) {
        out[SHADOW_FIELD] = shadow;
      }
      if (shadow && relocated.reservedMoved) {
        traceState.shadowWarns += 1;
        try {
          if (logQueue.length + 1 < LOG_QUEUE_MAX2) {
            logQueue.push({
              v: LOG_FORMAT_VERSION,
              ts: Date.now(),
              level: "warn",
              event: "log.trace.shadow",
              fields: { event: String(event || ""), shadowed: Object.keys(shadow) },
              isDiagnostic: true
            });
          }
        } catch (e2) {
          void e2;
        }
      }
      try {
        ensureTraceForLevel(level);
      } catch (e3) {
        void e3;
      }
      if (traceState.traceId) {
        try {
          ensureSpanId();
        } catch (e4) {
          void e4;
        }
        out.traceId = traceState.traceId;
        out.spanId = traceState.spanId;
      }
      try {
        out.seq = traceState.seq;
        traceState.seq += 1;
      } catch (e5) {
        void e5;
      }
      if (logQueue.length >= LOG_QUEUE_MAX2) {
        dropForRoom(level);
        if (logQueue.length >= LOG_QUEUE_MAX2)
          return "dropped";
      }
      logQueue.push({
        v: LOG_FORMAT_VERSION,
        ts: Date.now(),
        level,
        event: String(event || ""),
        fields: out,
        isDiagnostic: isDiagnostic === true
      });
      if (isUrgentLevel(level))
        scheduleLogFlush(true);
      else
        scheduleLogFlush(false);
      return "queued";
    }
    function logDiagnostic(level, event, fields) {
      return log(level, event, fields, true);
    }
    function scheduleLogFlush(immediate) {
      const later = function(fn, ms) {
        try {
          if (timer !== null && timer !== void 0 && typeof timer.timeout === "function")
            return timer.timeout(fn, ms);
        } catch (e) {
          void e;
        }
        return setTimeout(fn, ms);
      };
      if (immediate) {
        if (logFlushTimer.id !== null) {
          try {
            clearTimeout(logFlushTimer.id);
          } catch (e) {
            void e;
          }
          logFlushTimer.id = null;
        }
        later(sendLogBatch, 0);
        return;
      }
      if (logFlushTimer.id !== null)
        return;
      logFlushTimer.id = later(function() {
        logFlushTimer.id = null;
        sendLogBatch();
      }, LOG_FLUSH_MS);
    }
    return {
      log,
      logDiagnostic,
      isEnabled,
      dropForRoom,
      scheduleLogFlush
    };
  }

  // packages/dsh-log/dist/client.js
  var CLIENT_BATCH = {
    maxPerBatch: CLIENT_BATCH_MAX,
    intervalMs: CLIENT_BATCH_INTERVAL_MS,
    packetBytes: CLIENT_PACKET_BYTES,
    queueMax: CLIENT_QUEUE_MAX
  };
  function buildClientPhoneNames(prefix) {
    return buildPhoneNames(prefix);
  }
  function resolveClientLogConfig2(input) {
    const raw = input === void 0 || input === null ? {} : input;
    const pluginId = raw.pluginId !== void 0 && raw.pluginId !== null ? assertPluginId(raw.pluginId, "\u63D2\u4EF6\u6807\u8BC6 pluginId") : (function() {
      throw new Error("[dsh-log] \u5EFA\u5BA2\u6237\u7AEF\u65E5\u5FD7\u5E93\u7F3A\u5C11\u914D\u7F6E\uFF1A\u63D2\u4EF6\u6807\u8BC6 pluginId \u5FC5\u586B\uFF08\u987B\u663E\u5F0F\u4F20\u5165\uFF0C\u4E0D\u518D\u56DE\u9000\uFF09");
    })();
    const prefix = raw.prefix !== void 0 && raw.prefix !== null ? assertPluginId(raw.prefix, "\u7535\u8BDD\u540D\u524D\u7F00 prefix") : (function() {
      throw new Error("[dsh-log] \u5EFA\u5BA2\u6237\u7AEF\u65E5\u5FD7\u5E93\u7F3A\u5C11\u914D\u7F6E\uFF1A\u7535\u8BDD\u540D\u524D\u7F00 prefix \u5FC5\u586B\uFF08\u987B\u663E\u5F0F\u4F20\u5165\uFF0C\u4E0D\u518D\u56DE\u9000\u5230 pluginId\uFF09");
    })();
    const eventList = raw.eventList === void 0 ? null : raw.eventList;
    if (eventList !== null && typeof eventList === "object") {
      parseEventListManifest(eventList);
    }
    return { pluginId, prefix, eventList };
  }
  var LOG_DEBUG_KEY = "dsws.debug";
  function debugStorageKey(pluginId) {
    return LOG_DEBUG_KEY + "." + pluginId;
  }
  var LOG_BATCH_MAX2 = CLIENT_BATCH_MAX;
  var LOG_FLUSH_MS2 = CLIENT_BATCH_INTERVAL_MS;
  var LOG_PACKET_BYTES3 = CLIENT_PACKET_BYTES;
  var LOG_QUEUE_MAX3 = CLIENT_QUEUE_MAX;
  var LOG_WATCHDOG_MS = 5e3;
  var LOG_REV = 1;
  var LOG_LEVELS = ["error", "warn", "info", "debug"];
  function createClientLog(deps, configInput) {
    const input = deps || {};
    const host = input.host === void 0 ? null : input.host;
    const timer = input.timer === void 0 ? null : input.timer;
    const storage = input.storage !== void 0 && input.storage !== null ? input.storage : input.localStorage === void 0 ? null : input.localStorage;
    const broadcast = typeof input.broadcastLogSwitch === "function" ? input.broadcastLogSwitch : null;
    const config = resolveClientLogConfig2(configInput);
    const phoneNames = buildClientPhoneNames(config.prefix);
    const debugKey = debugStorageKey(config.pluginId);
    const switchCache = createSwitchCache({ storage, debugKey, rev: LOG_REV });
    const readLocalDebugSwitch = () => switchCache.read();
    const persistLocalDebugSwitch = (state) => switchCache.persist(state);
    const logSwitch = readLocalDebugSwitch();
    const logQueue = [];
    const logDroppedState = { count: 0 };
    const logForwardState = {
      lastSummaryAt: Date.now(),
      lastSummaryDropped: 0,
      lastReason: "",
      // 宿主最近一次回包里的三档计数（-1＝这一档宿主没说，汇总行不写这个键）。
      lastAccepted: -1,
      lastSkipped: -1,
      lastRejected: -1
    };
    const logRetryState = {
      rows: [],
      rejectCount: -1,
      attempts: 0,
      timer: null
    };
    function laterRun(fn, ms) {
      try {
        if (timer !== null && timer !== void 0 && typeof timer.timeout === "function")
          return timer.timeout(fn, ms);
      } catch (e) {
        void e;
      }
      return setTimeout(fn, ms);
    }
    const logFlushTimer = { id: null };
    const setLogSwitchGen = { n: 0 };
    const traceState = { traceId: null, spanId: null, seq: 0, traceSource: "none", spanSource: "none", shadowWarns: 0 };
    const trace = createTraceStage({ state: traceState });
    const ensureSpanId = () => trace.ensureSpanId();
    const ensureTraceForLevel = (level) => trace.ensureForLevel(level);
    let sendBatchRef = () => Promise.resolve({ ok: false, sent: 0 });
    const write = createWriteStage({
      getSwitchEnabled: () => logSwitch.enabled,
      // 常驻集合单源在 core/resident.ts：包内固定 43 条 ∪ 调用方清单里 kind === 'resident' 的事件。
      // 客户端清单由 createClientLog 的 configInput.eventList 传入（字符串路径形式本包不读盘，
      // 那时只有固定 43 条放行，与 0.3.0 之前一字不差）。两端共用一份，防漂移。
      residentEvents: residentEventSet(config.eventList),
      queue: logQueue,
      dropped: logDroppedState,
      forward: logForwardState,
      flushTimer: logFlushTimer,
      traceState,
      ensureSpanId,
      ensureTraceForLevel,
      sendLogBatch: () => sendBatchRef(),
      timer
    });
    const log = (level, event, fields) => write.log(level, event, fields);
    const isEnabled = (level, event) => write.isEnabled(level, event);
    const dropForRoom = (level) => write.dropForRoom(level);
    const scheduleLogFlush = (immediate) => write.scheduleLogFlush(immediate);
    const forward = createForwardStage({
      logDiagnostic: write.logDiagnostic,
      dropped: logDroppedState,
      forward: logForwardState,
      timer,
      watchdogMs: LOG_WATCHDOG_MS,
      hashFn: input && typeof input.hashFn === "function" ? input.hashFn : null
    });
    const maybeForwardSummary = () => forward.maybeForwardSummary();
    const logExportFail = (op, reason, err) => forward.logExportFail(op, reason, err);
    const watchSwitchOp = (op, pending) => forward.watchSwitchOp(op, pending);
    const send = createSendStage({
      host,
      phoneNames,
      queue: logQueue,
      retry: logRetryState,
      dropped: logDroppedState,
      forward: logForwardState,
      flushTimer: logFlushTimer,
      timer,
      laterRun,
      maybeForwardSummary,
      scheduleLogFlush
    });
    const sendLogBatch = () => send.sendLogBatch();
    const flush = () => send.flush();
    const getDroppedCount = () => send.getDroppedCount();
    sendBatchRef = sendLogBatch;
    const switchOps = createSwitchOps({
      host,
      phoneNames,
      timer,
      watchdogMs: LOG_WATCHDOG_MS,
      state: logSwitch,
      gen: setLogSwitchGen,
      cache: switchCache,
      broadcast,
      log,
      watch: watchSwitchOp
    });
    const reconcileLogSwitch = () => switchOps.reconcile();
    const setLogSwitch = (enabled) => switchOps.set(enabled);
    function child(ctx) {
      const next = createClientLog(input, { pluginId: config.pluginId, prefix: config.prefix, eventList: config.eventList });
      try {
        let tid = null;
        let tsrc = "none";
        const c = ctx;
        if (c && typeof c === "object" && typeof c.traceId === "string" && c.traceId) {
          tid = c.traceId;
          tsrc = "explicit";
        } else if (traceState.traceId) {
          tid = traceState.traceId;
          tsrc = "inherited";
        }
        next.traceState.traceId = tid;
        next.traceState.traceSource = tsrc;
        next.traceState.spanId = genHex(8);
        next.traceState.spanSource = "refreshed";
        next.traceState.seq = 0;
      } catch (e) {
        void e;
      }
      return next;
    }
    function why() {
      const detail = "traceId \u6765\u6E90=" + traceState.traceSource + "\uFF08explicit=child(ctx)\u663E\u5F0F\u4F20\u5165\uFF0Cinherited=\u4ECE\u7236\u5B9E\u4F8B\u7EE7\u627F\uFF0Cauto=\u7F3A\u94FE\u81EA\u52A8\u5EFA\u94FE\u4EC5info\u4EE5\u4E0A+\u91C7\u6837\u540Edebug\uFF0Cnone=\u5C1A\u672A\u5EFA\u94FE\uFF09\uFF1BspanId \u6765\u6E90=" + traceState.spanSource + "\uFF08child \u6BCF\u6B21\u5237\u65B0\uFF0C\u9996\u94FE\u81EA\u52A8\u751F\u6210\uFF09\uFF1Bseq=" + String(traceState.seq) + "\uFF08\u672C\u5B9E\u4F8B\u5185\u5355\u8C03\uFF0C\u5B50\u5B9E\u4F8B\u4ECE0\uFF0C\u6309(seq,ts)\u6392\u94FE\uFF09\uFF1B\u4FDD\u7559\u5B57\u51B2\u7A81_shadow \u8BA1" + String(traceState.shadowWarns) + "\u6B21\uFF08traceId/spanId/seq \u6C38\u4E0D\u62D2\u6536\uFF0Cerror \u7167\u843D\uFF09\uFF1B\u65E7\u884C v!=" + String(LOG_FORMAT_VERSION) + " \u8DF3\u8FC7\u8BA1\u6570\u4E0D\u629B\uFF08\u8BFB\u4FA7 handleLogQuery\uFF09";
      return {
        traceId: traceState.traceId,
        spanId: traceState.spanId,
        seq: traceState.seq,
        sources: { traceId: traceState.traceSource, spanId: traceState.spanSource, seq: "per-instance" },
        shadowWarns: traceState.shadowWarns,
        detail
      };
    }
    function queryLogs(args) {
      const name = buildLogQueryPhoneName(config.prefix);
      if (!host || typeof host.call !== "function") {
        return Promise.resolve({ ok: false, entries: [], error: "host-unavailable" });
      }
      try {
        return host.call(name, args || {}).catch(function(e) {
          void e;
          return { ok: false, entries: [] };
        });
      } catch (e) {
        void e;
        return Promise.resolve({ ok: false, entries: [] });
      }
    }
    const logFn = log;
    try {
      logFn.child = child;
      logFn.why = why;
    } catch (e) {
      void e;
    }
    return {
      config,
      phoneNames,
      logSwitch,
      logQueue,
      logDroppedState,
      logForwardState,
      logFlushTimer,
      traceState,
      isEnabled,
      log: logFn,
      child,
      why,
      queryLogs,
      scheduleLogFlush,
      estimateBatchBytes,
      maybeForwardSummary,
      hash8,
      logExportFail,
      watchSwitchOp,
      sendLogBatch,
      flush,
      getDroppedCount,
      readLocalDebugSwitch,
      persistLocalDebugSwitch,
      reconcileLogSwitch,
      setLogSwitch
    };
  }
  return { createClientLog: createClientLog, debugStorageKey: debugStorageKey, LOG_DEBUG_KEY: LOG_DEBUG_KEY };
})();
const createClientLog = __pkgLogScope.createClientLog;
const debugStorageKey = __pkgLogScope.debugStorageKey;
const LOG_DEBUG_KEY = __pkgLogScope.LOG_DEBUG_KEY;

// ---- 实例化（#564）：用闭包里现成的四个名字建日志器，插件标识 wf，默认配置与旧行为一致 ----
// 旧模块（src/client/kernel/log.ts）已随 #1143 删除；运行时走本派生文件。
// 注意：broadcastLogSwitch 的声明在 probeSnapshot 分块里，拼入位置在本分块之后；这里若直接写名字，
// 加载时就会因先用后声明而抛错（渲染冒烟实测）。所以包一层转发函数，调用时（模块早已加载完）再解析，行为与直传一致。
const __broadcastLogSwitchLate = function () { try { if (typeof broadcastLogSwitch === 'function') return broadcastLogSwitch.apply(null, arguments) } catch (e) {} }
const __pkgLog = createClientLog({ host: host, timer: timer, storage: localStorage, broadcastLogSwitch: __broadcastLogSwitchLate }, { pluginId: 'wf', prefix: 'wf', eventList: {"version":1,"pluginId":"wf","events":{"edge.write":{"level":"info","kind":"resident","fields":["kind","route","ok","added","removed","kept","reason","latencyMs"]},"issue.write":{"level":"info","kind":"resident","fields":["kind","route","ok","written","failed","reason","latencyMs"]},"labelDefs.write":{"level":"info","kind":"resident","fields":["planned","written","failed","ok","reason","latencyMs"]},"repo.init":{"level":"info","kind":"resident","fields":["route","steps","ok","reason","latencyMs"]},"workRoute.write":{"level":"info","kind":"resident","fields":["sidHash","rootHash","kind","ok","action","count","why","detail"]},"workRoute.read":{"level":"info","kind":"resident","fields":["sidHash","rootHash","ok","why","detail"]},"entry.open":{"level":"info","kind":"resident","fields":["from","cards"]},"entry.pick":{"level":"info","kind":"resident","fields":["from","card","ok","textLen"]},"guide.banner":{"level":"info","kind":"resident","fields":["step","banner","tone","outcome","ageMs","reason","decideStep","backendId","steps","wsHash","sidHash"]},"chain.flow":{"level":"info","kind":"resident","fields":["side","outcome","reason","bypass","backendId","lang","steps","done","ageMs","wsHash","sidHash"]},"probe.loop":{"level":"info","kind":"resident","fields":["reason","intervalMs","visible","timerOk"]},"gh.lane.wait":{"level":"info","kind":"resident","fields":["bucket","waitedMs","inflight","max","queued"],"guard":"排队放行时先看等了多久：三秒以上才记；同一只桶五分钟最多一行，风暴期间也不逐条刷"},"newsession.decide":{"level":"info","kind":"resident","fields":["entry","textLen","curSidHash","cwdHash","cwdSource","wsResolved","wsSource","wsItems","branch","reuseFrom","reuseSidHash","allowReuse","createOpts","reuseSkip","sidHash","outcome","errorHash"]},"quota.window":{"level":"info","kind":"resident","fields":["requests","points","estPoints","restRequests","aiPoints","pluginPoints","userPoints","failCount","limitCount","inflightPeak","inflightMax","queuedPeak","oldestWaitMs","allowUser","allowAi","softOver","allowBg","deferCount","gqlRemain","resetSec","syncAgeMs","tier","namingPages","namingPoints","suppressed"],"guard":"每分钟最多一行；只有真发生了事的分钟才写（跨分钟收尾时写上一分钟，空分钟零落行）"},"quota.detail":{"level":"info","kind":"resident","fields":["via","opId","account","points","waitedMs","latencyMs","kind"]},"quota.recover":{"level":"info","kind":"resident","fields":["durationMs","incidents","suppressed","failsInWindow","opsFailed","maxInflightDuring","firstOkVia","resetPast"]},"quota.sync":{"level":"info","kind":"resident","fields":["trigger","serverLimit","serverRemaining","resetSec","allowance","spentSinceSync","driftPoints","resetSeen","ageMs"]},"quota.pressure":{"level":"info","kind":"resident","fields":["pointsLastMin","pointsLastHour","projectedHour","capacity","inflightPeak","top"]},"quota.op":{"level":"info","kind":"resident","fields":["op","opId","caller","account","bucket","ok","requests","points","pointSource","latencyMs","remaining","tier","backendId"]},"tool.receipt":{"level":"info","kind":"resident","fields":["tool","opId","status","estRequests","estPoints","requests","points","latencyMs","remaining","tier","backendId","note"]}}} })
// ---- 开机秒显的升级兜底（0.2.x→0.3.x）：包只读新键 dsws.debug.wf，裸旧键 dsws.debug 不认了；
// 老用户开着时会先闪一下关。持久化那份迁移归 settings-debug.js（settingsDebugLegacy，新键没有、旧键是对象
// 才搬，采样率证据也由它收），这里只把内存这份原地改成开，让导出的快照即刻为开——不能在这里 persist：
// 一写新键，settings-debug 那边的“新键没有才读旧键”就进不去了，升级证据里的采样率就丢了（门禁实测）。
// 必须原地改、不换对象：
// 包的对账（reconcile）拿的是同一个对象引用，原地改两边才都认；换对象会让导出的快照与对账各说各话。
try {
  if (__pkgLog && __pkgLog.logSwitch && __pkgLog.logSwitch.enabled !== true && typeof localStorage !== 'undefined' && localStorage && !localStorage.getItem(debugStorageKey('wf'))) {
    const __legacySaved = JSON.parse(localStorage.getItem(LOG_DEBUG_KEY) || 'null')
    if (__legacySaved && typeof __legacySaved === 'object' && !Array.isArray(__legacySaved) && __legacySaved.enabled === true) {
      __pkgLog.logSwitch.enabled = true
    }
  }
} catch (eM) { void eM }
export const readLocalDebugSwitch = __pkgLog.readLocalDebugSwitch
export const persistLocalDebugSwitch = __pkgLog.persistLocalDebugSwitch
export const logSwitch = __pkgLog.logSwitch
export const logQueue = __pkgLog.logQueue
export const logDroppedState = __pkgLog.logDroppedState
export const logForwardState = __pkgLog.logForwardState
export const logFlushTimer = __pkgLog.logFlushTimer
export const isEnabled = __pkgLog.isEnabled
export const log = __pkgLog.log
export const scheduleLogFlush = __pkgLog.scheduleLogFlush
export const estimateBatchBytes = __pkgLog.estimateBatchBytes
export const maybeForwardSummary = __pkgLog.maybeForwardSummary
export const hash8 = __pkgLog.hash8
export const logExportFail = __pkgLog.logExportFail
export const watchSwitchOp = __pkgLog.watchSwitchOp
export const sendLogBatch = __pkgLog.sendLogBatch
export const flush = __pkgLog.flush
export const getDroppedCount = __pkgLog.getDroppedCount
export const reconcileLogSwitch = __pkgLog.reconcileLogSwitch
export const setLogSwitch = __pkgLog.setLogSwitch
// 零变化断言字面（默认 wf 下 5 个电话名与旧字面一致；双产物检查直接看到这些字面，运行时走上面的工厂拼名）
void (__pkgLog.phoneNames.logBatch === 'wf.logBatch' && __pkgLog.phoneNames.logExport === 'wf.logExport' && __pkgLog.phoneNames.logClear === 'wf.logClear' && __pkgLog.phoneNames.logGetSwitch === 'wf.logGetSwitch' && __pkgLog.phoneNames.logSetSwitch === 'wf.logSetSwitch')
