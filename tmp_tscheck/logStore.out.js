import { LOG_WRITE_DEBOUNCE_MS as LOG_DEBOUNCE_MS } from "../shared/time-config/values.js";
const LOG_DIR_NAME = "logs";
const LOG_SWITCH_FILE = "log-switch.json";
function hashText(text) {
  let h = 5381;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i) >>> 0;
  return ("0000000" + h.toString(16)).slice(-8);
}
function formatLogFileName(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = function(n) {
    return String(n).padStart(2, "0");
  };
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + ".log";
}
function createLogStore(deps) {
  const input = deps || {};
  const fs = input.fs;
  const timer = input.timer;
  const getCacheDir = input.getCacheDir;
  const getPlatform = input.getPlatform;
  const defaultCwd = input.DEFAULT_CWD || "";
  let queue = [];
  let dropped = 0;
  let switchEnabled = false;
  let switchSampleRate = 1;
  let switchLoaded = false;
  let flushTimer = null;
  let flushing = false;
  let flushQueued = false;
  let pendingPersistFail = null;
  let persistFailOutstanding = false;
  function notePersistFail(op, reason, dir) {
    if (!pendingPersistFail) pendingPersistFail = { op, reason, dir: String(dir || "") };
    try {
      scheduleFlush(false);
    } catch (e) {
    }
  }
  let headerInfo = null;
  function later(fn, ms) {
    try {
      if (timer !== void 0 && timer !== null && typeof timer.timeout === "function") return timer.timeout(fn, ms);
    } catch (e) {
    }
    return setTimeout(fn, ms);
  }
  function joinPath(a, b) {
    return String(a).replace(/\/+$/, "") + "/" + String(b).replace(/^\/+/, "");
  }
  async function joinLogPath(dir, name) {
    try {
      const platform = typeof getPlatform === "function" ? await getPlatform() : null;
      if (platform && platform.path && typeof platform.path.join === "function") return platform.path.join(dir, name);
    } catch (e) {
    }
    return joinPath(dir, name);
  }
  async function resolveTarget(pathStr) {
    try {
      const platform = typeof getPlatform === "function" ? await getPlatform() : null;
      if (platform && platform.fs && typeof platform.fs.resolve === "function") return await platform.fs.resolve(pathStr);
    } catch (e) {
    }
    try {
      if (fs !== void 0 && fs !== null && typeof fs.resolve === "function") return await fs.resolve(pathStr);
    } catch (e2) {
    }
    return pathStr;
  }
  async function readTarget(target) {
    if (fs !== void 0 && fs !== null && typeof fs.readText === "function") return await fs.readText(target);
    const platform = typeof getPlatform === "function" ? await getPlatform() : null;
    if (platform && platform.fs && typeof platform.fs.readText === "function") return await platform.fs.readText(target);
    throw new Error("\u6587\u4EF6\u670D\u52A1\u4E0D\u53EF\u8BFB");
  }
  async function writeTarget(target, text) {
    if (fs !== void 0 && fs !== null && typeof fs.writeText === "function") return await fs.writeText(target, text);
    const platform = typeof getPlatform === "function" ? await getPlatform() : null;
    if (platform && platform.fs && typeof platform.fs.writeText === "function") return await platform.fs.writeText(target, text);
    throw new Error("\u6587\u4EF6\u670D\u52A1\u4E0D\u53EF\u5199");
  }
  async function ensureLogDir(logDir) {
    try {
      const platform = typeof getPlatform === "function" ? await getPlatform() : null;
      if (platform && platform.fs && typeof platform.fs.mkdir === "function") {
        try {
          await platform.fs.mkdir(logDir);
        } catch (e) {
        }
        return;
      }
    } catch (e) {
    }
    try {
      if (fs !== void 0 && fs !== null && typeof fs.mkdir === "function") await fs.mkdir(logDir);
    } catch (e2) {
    }
  }
  function isEnabled(level) {
    if (level === "error" || level === "warn") return true;
    return switchEnabled === true;
  }
  function log(level, event, fields) {
    if (!isEnabled(level)) return;
    queue.push({ ts: Date.now(), level, event: String(event || ""), fields: fields && typeof fields === "object" ? fields : {} });
    if (level === "error" || level === "warn") scheduleFlush(true);
    else scheduleFlush(false);
  }
  function scheduleFlush(immediate) {
    if (immediate) {
      if (flushTimer !== null) {
        try {
          clearTimeout(flushTimer);
        } catch (e) {
        }
        flushTimer = null;
      }
      later(flushNow, 0);
      return;
    }
    if (flushTimer !== null) return;
    flushTimer = later(flushNow, LOG_DEBOUNCE_MS);
  }
  function flush() {
    if (flushTimer !== null) {
      try {
        clearTimeout(flushTimer);
      } catch (e) {
      }
      flushTimer = null;
    }
    later(flushNow, 0);
    return { ok: true };
  }
  async function flushNow() {
    flushTimer = null;
    if (flushing) {
      flushQueued = true;
      return;
    }
    flushing = true;
    try {
      while (queue.length > 0) {
        const batch = queue.splice(0, queue.length);
        try {
          if (await writeBatch(batch)) persistFailOutstanding = false;
        } catch (e) {
          dropped += batch.length;
        }
      }
    } finally {
      flushing = false;
      if (pendingPersistFail) {
        const f = pendingPersistFail;
        pendingPersistFail = null;
        if (!persistFailOutstanding) {
          persistFailOutstanding = true;
          try {
            log("warn", "log.persist.fail", { op: f.op, reason: f.reason, dirHash: hashText(f.dir) });
          } catch (e) {
          }
        }
      }
      if (flushQueued) {
        flushQueued = false;
        if (queue.length > 0) scheduleFlush(false);
      }
    }
  }
  async function writeBatch(batch) {
    if (!batch || batch.length === 0) return true;
    const lines = [];
    for (let i = 0; i < batch.length; i++) {
      try {
        lines.push(JSON.stringify({ ts: batch[i].ts, level: batch[i].level, event: batch[i].event, fields: batch[i].fields }));
      } catch (e) {
        dropped += 1;
      }
    }
    if (lines.length === 0) return true;
    const text = lines.join("\n") + "\n";
    let failDir = "";
    try {
      const dir = typeof getCacheDir === "function" ? await getCacheDir() : null;
      if (!dir) {
        dropped += lines.length;
        notePersistFail("writeBatch", "no-dir", "");
        return false;
      }
      const logDir = await joinLogPath(dir, LOG_DIR_NAME);
      failDir = logDir;
      await ensureLogDir(logDir);
      const fileName = formatLogFileName(/* @__PURE__ */ new Date());
      const target = await resolveTarget(await joinLogPath(logDir, fileName));
      let existing = "";
      try {
        existing = await readTarget(target);
      } catch (eRead) {
        existing = "";
      }
      await writeTarget(target, String(existing || "") + text);
      return true;
    } catch (eWrite) {
      dropped += lines.length;
      notePersistFail("writeBatch", "write-fail", failDir);
      return false;
    }
  }
  function getDroppedCount() {
    return dropped;
  }
  function getSwitchState() {
    return { enabled: switchEnabled, sampleRate: switchSampleRate };
  }
  async function loadSwitch() {
    if (switchLoaded) return getSwitchState();
    switchLoaded = true;
    try {
      const dir = typeof getCacheDir === "function" ? await getCacheDir() : null;
      if (!dir) return getSwitchState();
      const target = await resolveTarget(await joinLogPath(dir, LOG_SWITCH_FILE));
      const txt = await readTarget(target);
      if (!txt) return getSwitchState();
      const parsed = JSON.parse(txt);
      if (parsed && typeof parsed.enabled === "boolean") switchEnabled = parsed.enabled;
      if (parsed && typeof parsed.sampleRate === "number") switchSampleRate = parsed.sampleRate;
    } catch (e) {
      notePersistFail("readBack", "read-fail", "");
    }
    return getSwitchState();
  }
  async function persistSwitch() {
    let failDir = "";
    try {
      const dir = typeof getCacheDir === "function" ? await getCacheDir() : null;
      if (!dir) {
        notePersistFail("persistSwitch", "no-dir", "");
        return;
      }
      failDir = String(dir || "");
      const target = await resolveTarget(await joinLogPath(dir, LOG_SWITCH_FILE));
      await writeTarget(target, JSON.stringify({ enabled: switchEnabled, sampleRate: switchSampleRate }));
    } catch (e) {
      notePersistFail("persistSwitch", "write-fail", failDir);
    }
  }
  async function setSwitch(enabled, sampleRate) {
    switchEnabled = enabled === true;
    if (typeof sampleRate === "number" && isFinite(sampleRate)) switchSampleRate = sampleRate;
    await persistSwitch();
    return getSwitchState();
  }
  async function writeStartupHeader() {
    try {
      const dir = typeof getCacheDir === "function" ? await getCacheDir() : null;
      let pid = 0;
      try {
        pid = typeof process !== "undefined" && process.pid || 0;
      } catch (e) {
      }
      headerInfo = { pid, startedAt: (/* @__PURE__ */ new Date()).toISOString(), dir: dir || defaultCwd || "" };
      log("info", "host.start", { pid: headerInfo.pid, startedAt: headerInfo.startedAt, dir: headerInfo.dir });
    } catch (e) {
    }
    return headerInfo;
  }
  function getHeaderInfo() {
    return headerInfo;
  }
  async function handleLogBatch(args) {
    try {
      const entries = args && Array.isArray(args.entries) ? args.entries : [];
      for (let i = 0; i < entries.length; i++) {
        const item = entries[i] || {};
        try {
          log(item.level, item.event, item.fields);
        } catch (e) {
          dropped += 1;
        }
      }
      return { ok: true, accepted: entries.length, dropped: getDroppedCount() };
    } catch (e) {
      return { ok: true, accepted: 0, dropped: getDroppedCount() };
    }
  }
  let _phonesP = null;
  function _phones() {
    if (!_phonesP) _phonesP = import("./logPhones.js").then(function(m) {
      return m.createLogPhones({ fs, getCacheDir, getPlatform, DEFAULT_CWD: defaultCwd, LOG_DIR_NAME, formatLogFileName, joinPath, joinLogPath, resolveTarget, readTarget, writeTarget, log, getSwitchState, getHeaderInfo, loadSwitch, setSwitch });
    });
    return _phonesP;
  }
  async function handleLogExport(args) {
    const p = await _phones();
    return p.handleLogExport(args);
  }
  async function handleLogClear(args) {
    const p = await _phones();
    return p.handleLogClear(args);
  }
  async function handleLogGetSwitch() {
    const p = await _phones();
    return p.handleLogGetSwitch();
  }
  async function handleLogSetSwitch(args) {
    const p = await _phones();
    return p.handleLogSetSwitch(args);
  }
  return {
    isEnabled,
    log,
    flush,
    flushNow,
    getDroppedCount,
    loadSwitch,
    setSwitch,
    getSwitchState,
    writeStartupHeader,
    getHeaderInfo,
    handleLogBatch,
    handleLogExport,
    handleLogClear,
    handleLogGetSwitch,
    handleLogSetSwitch
  };
}
export {
  LOG_DEBOUNCE_MS,
  LOG_DIR_NAME,
  LOG_SWITCH_FILE,
  createLogStore,
  formatLogFileName
};
