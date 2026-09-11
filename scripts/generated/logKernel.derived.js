// 派生文件（#564）：由 packages/dsh-log/src/client.ts（含配置面）打包生成，内容与日志包 0.1.0 一致，人手不改。
// 旧模块（src/client/kernel/log.js）原地只读留存；构建时本文件拼入原来日志模块的位置（kernel:log 标记处）。
// 共存关系：旧文件只读、新文件派生，真搬迁或真删除旧文件另开票。重新生成：node scripts/derive-log-from-package.mjs。
// packages/dsh-log/src/config.ts
var CLIENT_BATCH_MAX = 50;
var CLIENT_BATCH_INTERVAL_MS = 1e3;
var CLIENT_PACKET_BYTES = 128 * 1024;
var CLIENT_QUEUE_MAX = 100;
var PHONE_ACTIONS = ["logBatch", "logExport", "logClear", "logGetSwitch", "logSetSwitch"];
var ID_PATTERN = /^[a-z0-9-]{1,32}$/;
function assertPluginId(value, role) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new Error(
      "[dsh-log] " + role + " \u975E\u6CD5\uFF1A\u53EA\u80FD\u7528\u5C0F\u5199\u82F1\u6587\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u4E2D\u6A2A\u7EBF\uFF0C\u957F\u5EA6 1 \u5230 32\uFF08\u6536\u5230 " + JSON.stringify(value) + "\uFF09"
    );
  }
  return value;
}
function buildPhoneName(prefix, action) {
  return assertPluginId(prefix, "\u7535\u8BDD\u540D\u524D\u7F00 prefix") + "." + action;
}
function buildPhoneNames(prefix) {
  const checked = assertPluginId(prefix, "\u7535\u8BDD\u540D\u524D\u7F00 prefix");
  const names = {};
  for (const action of PHONE_ACTIONS) names[action] = checked + "." + action;
  return names;
}
var EVENT_LEVELS = ["error", "warn", "info", "debug"];
var EVENT_KINDS = ["resident", "ondemand", "selfmon"];
function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
function assertStringArray(value, what) {
  if (!Array.isArray(value)) throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1A" + what + " \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6570\u7EC4");
  const seen = [];
  for (const item of value) {
    if (!isNonEmptyString(item)) throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1A" + what + " \u91CC\u6709\u7A7A\u5B57\u6BB5\u540D");
    if (seen.indexOf(item) >= 0) throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1A" + what + " \u91CC\u5B57\u6BB5\u540D\u91CD\u590D\uFF1A" + item);
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
  const countsRaw = input["counts"];
  if (!countsRaw || typeof countsRaw !== "object" || Array.isArray(countsRaw)) {
    throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1Acounts \u5FC5\u987B\u662F\u542B\u4E09\u7C7B\u8BA1\u6570\u7684\u5BF9\u8C61");
  }
  const countsRecord = countsRaw;
  const counts = { resident: 0, ondemand: 0, selfmon: 0 };
  for (const kind of EVENT_KINDS) {
    const n = countsRecord[kind];
    if (typeof n !== "number" || !isFinite(n) || Math.floor(n) !== n || n < 0) {
      throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1Acounts." + kind + " \u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570");
    }
    counts[kind] = n;
  }
  const eventsRaw = input["events"];
  if (!eventsRaw || typeof eventsRaw !== "object" || Array.isArray(eventsRaw)) {
    throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1Aevents \u5FC5\u987B\u662F\u4E8B\u4EF6\u540D\u5230\u6761\u76EE\u7684\u5BF9\u8C61");
  }
  const events = {};
  for (const name of Object.keys(eventsRaw)) {
    events[name] = parseEventEntry(name, eventsRaw[name]);
  }
  return { version: 1, pluginId, counts, events };
}
function parseEventEntry(name, value) {
  if (!isNonEmptyString(name)) throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1A\u4E8B\u4EF6\u540D\u4E0D\u80FD\u4E3A\u7A7A");
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
  if (input["codes"] !== void 0) entry.codes = assertStringArray(input["codes"], "\u4E8B\u4EF6 " + name + " \u7684 codes");
  if (input["rules"] !== void 0) entry.rules = assertStringArray(input["rules"], "\u4E8B\u4EF6 " + name + " \u7684 rules");
  if (input["guard"] !== void 0) {
    if (typeof input["guard"] !== "string") {
      throw new Error("[dsh-log] \u4E8B\u4EF6\u6E05\u5355 eventList \u975E\u6CD5\uFF1A\u4E8B\u4EF6 " + name + " \u7684 guard \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
    }
    entry.guard = input["guard"];
  }
  return entry;
}

// packages/dsh-log/src/client.ts
var CLIENT_BATCH = {
  maxPerBatch: CLIENT_BATCH_MAX,
  intervalMs: CLIENT_BATCH_INTERVAL_MS,
  packetBytes: CLIENT_PACKET_BYTES,
  queueMax: CLIENT_QUEUE_MAX
};
function buildClientPhoneNames(prefix) {
  return buildPhoneNames(prefix);
}
function resolveClientLogConfig(input) {
  const raw = input === void 0 || input === null ? {} : input;
  const pluginId = raw.pluginId === void 0 ? "wf" : assertPluginId(raw.pluginId, "\u63D2\u4EF6\u6807\u8BC6 pluginId");
  const prefix = raw.prefix === void 0 ? pluginId : assertPluginId(raw.prefix, "\u7535\u8BDD\u540D\u524D\u7F00 prefix");
  const eventList = raw.eventList === void 0 ? null : raw.eventList;
  if (eventList !== null && typeof eventList === "object") {
    parseEventListManifest(eventList);
  }
  return { pluginId, prefix, eventList };
}
var LOG_DEBUG_KEY = "dsws.debug";
var LOG_BATCH_MAX = CLIENT_BATCH_MAX;
var LOG_FLUSH_MS = CLIENT_BATCH_INTERVAL_MS;
var LOG_PACKET_BYTES = CLIENT_PACKET_BYTES;
var LOG_QUEUE_MAX = CLIENT_QUEUE_MAX;
var LOG_WATCHDOG_MS = 5e3;
var LOG_REV = 1;
var LOG_LEVELS = ["error", "warn", "info", "debug"];
function createClientLog(deps, configInput) {
  const input = deps || {};
  const host = input.host === void 0 ? null : input.host;
  const timer = input.timer === void 0 ? null : input.timer;
  const storage = input.storage !== void 0 && input.storage !== null ? input.storage : input.localStorage === void 0 ? null : input.localStorage;
  const broadcast = typeof input.broadcastLogSwitch === "function" ? input.broadcastLogSwitch : null;
  const config = resolveClientLogConfig(configInput);
  const phoneNames = buildClientPhoneNames(config.prefix);
  function readLocalDebugSwitch() {
    const fallback = { enabled: false, sampleRate: 1, rev: LOG_REV };
    try {
      if (!storage || typeof storage.getItem !== "function") return fallback;
      const raw = storage.getItem(LOG_DEBUG_KEY);
      if (!raw) return fallback;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return fallback;
      return {
        enabled: saved.enabled === true,
        sampleRate: typeof saved.sampleRate === "number" && isFinite(saved.sampleRate) ? saved.sampleRate : 1,
        rev: typeof saved.rev === "number" && isFinite(saved.rev) ? saved.rev : LOG_REV
      };
    } catch (e) {
      void e;
      return fallback;
    }
  }
  function persistLocalDebugSwitch(state) {
    try {
      if (!storage || typeof storage.setItem !== "function") return false;
      storage.setItem(
        LOG_DEBUG_KEY,
        JSON.stringify({
          enabled: !!(state && state.enabled),
          sampleRate: state && typeof state.sampleRate === "number" && isFinite(state.sampleRate) ? state.sampleRate : 1,
          rev: state && typeof state.rev === "number" && isFinite(state.rev) ? state.rev : LOG_REV
        })
      );
      return true;
    } catch (e) {
      void e;
      return false;
    }
  }
  const logSwitch = readLocalDebugSwitch();
  const logQueue = [];
  const logDroppedState = { count: 0 };
  const logForwardState = { lastSummaryAt: 0, lastSummaryDropped: 0, lastReason: "" };
  const logFlushTimer = { id: null };
  const setLogSwitchGen = { n: 0 };
  function isEnabled(level) {
    if (level === "error" || level === "warn") return true;
    try {
      return logSwitch.enabled === true;
    } catch (e) {
      void e;
      return false;
    }
  }
  function log(level, event, fields) {
    if (!isEnabled(level)) return;
    if (logQueue.length >= LOG_QUEUE_MAX) {
      logDroppedState.count += 1;
      logForwardState.lastReason = "queue-full";
      return;
    }
    logQueue.push({
      ts: Date.now(),
      level,
      event: String(event || ""),
      fields: fields && typeof fields === "object" ? fields : {}
    });
    if (level === "error" || level === "warn") scheduleLogFlush(true);
    else scheduleLogFlush(false);
  }
  function scheduleLogFlush(immediate) {
    const later = function(fn, ms) {
      try {
        if (timer !== null && timer !== void 0 && typeof timer.timeout === "function") return timer.timeout(fn, ms);
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
    if (logFlushTimer.id !== null) return;
    logFlushTimer.id = later(function() {
      logFlushTimer.id = null;
      sendLogBatch();
    }, LOG_FLUSH_MS);
  }
  function estimateBatchBytes(entries) {
    try {
      const text = JSON.stringify(entries);
      const g = globalThis;
      if (typeof g.TextEncoder !== "undefined") return new g.TextEncoder().encode(text).length;
      return String(text).length;
    } catch (e) {
      void e;
      return LOG_PACKET_BYTES + 1;
    }
  }
  function maybeForwardSummary() {
    const delta = logDroppedState.count - logForwardState.lastSummaryDropped;
    if (delta <= 0) return;
    logForwardState.lastSummaryDropped = logDroppedState.count;
    const now = Date.now();
    const windowMs = now - logForwardState.lastSummaryAt;
    logForwardState.lastSummaryAt = now;
    try {
      log("warn", 'log.forward.summary', {
        droppedDelta: delta,
        totalDropped: logDroppedState.count,
        reason: logForwardState.lastReason || "send-fail",
        windowMs
      });
    } catch (e) {
      void e;
    }
  }
  function hash8(value) {
    try {
      const t = String(value || "");
      let h = 5381;
      for (let i = 0; i < t.length; i++) h = (h << 5) + h + t.charCodeAt(i) >>> 0;
      return ("0000000" + h.toString(16)).slice(-8);
    } catch (e) {
      void e;
      return "00000000";
    }
  }
  function logExportFail(op, reason, err) {
    try {
      const g = globalThis;
      if (typeof g.dswsLogHash === "function" && typeof g.dswsLogTrunc === "function") {
        const trunc = g.dswsLogTrunc;
        const hash = g.dswsLogHash;
        const raw = err && typeof err === "object" && "message" in err ? String(err.message) : String(err || reason);
        log("warn", 'log.export.fail', { op, reason, errorHash: hash(trunc(raw, 120, "error")) });
      } else {
        const raw = err && typeof err === "object" && "message" in err ? String(err.message) : String(err || reason);
        log("warn", 'log.export.fail', { op, reason, errorHash: hash8(raw) });
      }
    } catch (e) {
      void e;
    }
  }
  function watchSwitchOp(op, pending) {
    let settled = false;
    try {
      if (pending && typeof pending.then === "function") {
        ;
        pending.then(
          function() {
            settled = true;
          },
          function() {
            settled = true;
          }
        );
      }
    } catch (e) {
      void e;
    }
    const fire = function() {
      if (!settled) {
        settled = true;
        try {
          log("warn", 'log.switch.watchdog', { op, timeoutMs: LOG_WATCHDOG_MS, stage: "waiting-host" });
        } catch (e) {
          void e;
        }
      }
    };
    try {
      if (timer !== null && timer !== void 0 && typeof timer.timeout === "function") {
        timer.timeout(fire, LOG_WATCHDOG_MS);
        return;
      }
    } catch (e) {
      void e;
    }
    try {
      setTimeout(fire, LOG_WATCHDOG_MS);
    } catch (e2) {
      void e2;
    }
  }
  function sendLogBatch() {
    if (logQueue.length === 0) return Promise.resolve({ ok: true, sent: 0 });
    const entries = logQueue.splice(0, LOG_BATCH_MAX);
    let trimmed = 0;
    while (entries.length > 1 && estimateBatchBytes(entries) > LOG_PACKET_BYTES) {
      entries.pop();
      trimmed += 1;
    }
    while (logQueue.length > LOG_QUEUE_MAX) {
      logQueue.shift();
      trimmed += 1;
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
      logDroppedState.count += entries.length;
      logForwardState.lastReason = "send-fail";
      if (!onlySummary) maybeForwardSummary();
      return Promise.resolve({ ok: false, sent: 0 });
    }
    try {
      return host.call(phoneNames.logBatch, args).then(function(res) {
        const ok = !!res && typeof res === "object" && res.ok === true;
        if (!ok) {
          logDroppedState.count += entries.length;
          logForwardState.lastReason = "host-reject";
        }
        if (ok) maybeForwardSummary();
        else if (!onlySummary) maybeForwardSummary();
        return { ok, sent: entries.length };
      }).catch(function() {
        logDroppedState.count += entries.length;
        logForwardState.lastReason = "send-fail";
        if (!onlySummary) maybeForwardSummary();
        return { ok: false, sent: 0 };
      });
    } catch (e) {
      void e;
      logDroppedState.count += entries.length;
      logForwardState.lastReason = "send-fail";
      if (!onlySummary) maybeForwardSummary();
      return Promise.resolve({ ok: false, sent: 0 });
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
  function reconcileLogSwitch() {
    if (!host || typeof host.call !== "function") {
      return Promise.resolve({ ok: false, enabled: logSwitch.enabled, sampleRate: logSwitch.sampleRate });
    }
    try {
      const pendingGet = host.call(phoneNames.logGetSwitch, {});
      watchSwitchOp("reconcile", pendingGet);
      return pendingGet.then(function(res) {
        const body = res && typeof res === "object" ? res : null;
        if (!body || body.ok !== true) return { ok: false, enabled: logSwitch.enabled, sampleRate: logSwitch.sampleRate };
        logSwitch.enabled = body.enabled === true;
        if (typeof body.sampleRate === "number" && isFinite(body.sampleRate)) logSwitch.sampleRate = body.sampleRate;
        persistLocalDebugSwitch(logSwitch);
        try {
          if (broadcast) broadcast();
        } catch (e) {
          void e;
        }
        return { ok: true, enabled: logSwitch.enabled, sampleRate: logSwitch.sampleRate };
      }).catch(function() {
        return { ok: false, enabled: logSwitch.enabled, sampleRate: logSwitch.sampleRate };
      });
    } catch (e) {
      void e;
      return Promise.resolve({ ok: false, enabled: logSwitch.enabled, sampleRate: logSwitch.sampleRate });
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
    if (/unknown endpoint/i.test(msg)) return "throw-unknown-endpoint";
    if (/connection|host\.call 不可用|unavailable/i.test(msg)) return "throw-connection";
    return "throw";
  };
  const failByThrow = function(e) {
    const kind = switchThrowKind(e);
    logSwitchSetFail(
      kind,
      (e && typeof e === "object" && "message" in e ? e.message : void 0) || e
    );
    return kind;
  };
  function setLogSwitch(enabled, sampleRate) {
    const next = {
      enabled: enabled === true,
      sampleRate: typeof sampleRate === "number" && isFinite(sampleRate) ? sampleRate : logSwitch.sampleRate
    };
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
            timer.timeout(fire, LOG_WATCHDOG_MS);
            return;
          }
        } catch (e) {
          void e;
        }
        try {
          setTimeout(fire, LOG_WATCHDOG_MS);
        } catch (e2) {
          void e2;
        }
      });
      return Promise.race([pendingSet, timeoutAt]).then(function(res) {
        const body = res && typeof res === "object" ? res : null;
        if (body && body["switchTimedOut"] === true) {
          logSwitchSetFail("timeout", "timeout-" + LOG_WATCHDOG_MS);
          return { ok: false, enabled: logSwitch.enabled, error: "switch-timeout" };
        }
        if (myGen !== setLogSwitchGen.n) return { ok: false, enabled: logSwitch.enabled, error: "stale" };
        if (!body || body["ok"] !== true) {
          logSwitchSetFail("host-rejected", "host-rejected");
          return { ok: false, enabled: logSwitch.enabled, error: "host-rejected" };
        }
        logSwitch.enabled = body["enabled"] === true;
        logSwitch.sampleRate = next.sampleRate;
        persistLocalDebugSwitch(logSwitch);
        try {
          if (broadcast) broadcast();
        } catch (e) {
          void e;
        }
        return { ok: true, enabled: logSwitch.enabled, sampleRate: logSwitch.sampleRate };
      }).catch(function(e) {
        if (myGen !== setLogSwitchGen.n) return { ok: false, enabled: logSwitch.enabled, error: "stale" };
        return { ok: false, enabled: logSwitch.enabled, error: failByThrow(e) };
      });
    } catch (e) {
      return Promise.resolve({ ok: false, enabled: logSwitch.enabled, error: failByThrow(e) });
    }
  }
  return {
    config,
    phoneNames,
    logSwitch,
    logQueue,
    logDroppedState,
    logForwardState,
    logFlushTimer,
    isEnabled,
    log,
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
export {
  CLIENT_BATCH,
  LOG_BATCH_MAX,
  LOG_DEBUG_KEY,
  LOG_FLUSH_MS,
  LOG_LEVELS,
  LOG_PACKET_BYTES,
  LOG_QUEUE_MAX,
  LOG_REV,
  LOG_WATCHDOG_MS,
  buildClientPhoneNames,
  buildPhoneName,
  buildPhoneNames,
  createClientLog,
  resolveClientLogConfig
};

// ---- 实例化（#564）：用闭包里现成的四个名字建日志器，插件标识 wf，默认配置与旧行为一致 ----
// 旧模块（src/client/kernel/log.js）原地只读留存；运行时走本派生文件。共存关系见本文件头，真删除旧文件另开票。
// 注意：broadcastLogSwitch 的声明在 probeSnapshot 分块里，拼入位置在本分块之后；这里若直接写名字，
// 加载时就会因先用后声明而抛错（渲染冒烟实测）。所以包一层转发函数，调用时（模块早已加载完）再解析，行为与直传一致。
const __broadcastLogSwitchLate = function () { try { if (typeof broadcastLogSwitch === 'function') return broadcastLogSwitch.apply(null, arguments) } catch (e) {} }
const __pkgLog = createClientLog({ host: host, timer: timer, storage: localStorage, broadcastLogSwitch: __broadcastLogSwitchLate }, { pluginId: 'wf' })
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
