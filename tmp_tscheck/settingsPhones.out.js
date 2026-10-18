import { mkdir as nodeMkdir, readFile as nodeReadFile, unlink as nodeUnlink, writeFile as nodeWriteFile } from "node:fs/promises";
function isSettingsAbsenceError(e) {
  const code = String(e && (e.code || e.cause && e.cause.code) || "");
  if (code === "ENOENT" || code === "FS_NOT_FOUND") return true;
  const msg = String(e && e.message || e || "");
  if (/ENOENT|FS_NOT_FOUND/i.test(msg)) return true;
  return /cannot read.*not found/i.test(msg);
}
const SETTINGS_KIND_MAP = {
  "missing": "absent",
  "env": "environment",
  "bad-shape": "invalid",
  "oversize": "invalid",
  "aliases": "invalid",
  "yaml-error": "invalid",
  "unknown-keys": "invalid",
  "version-newer": "readonly"
};
function mapSettingsKind(reason) {
  if (Object.prototype.hasOwnProperty.call(SETTINGS_KIND_MAP, reason)) return SETTINGS_KIND_MAP[reason];
  return "environment";
}
function createSettingsPhones(deps) {
  const input = deps || {};
  const getPlatform = input.getPlatform;
  const readLocalSettings = input.readLocalSettings;
  const writeLocalSettings = input.writeLocalSettings;
  const logCtx = input.logCtx || null;
  const fsPort = input.fs || null;
  const sysFs = fsPort || { readFile: nodeReadFile, writeFile: nodeWriteFile, mkdir: nodeMkdir, unlink: nodeUnlink };
  function buildIo() {
    return {
      async readText(absPath) {
        return sysFs.readFile(String(absPath), "utf8");
      },
      async writeText(absPath, text) {
        await sysFs.writeFile(String(absPath), String(text), "utf8");
      },
      async mkdir(dirPath) {
        await sysFs.mkdir(String(dirPath), { recursive: true });
      },
      async rm(absPath) {
        await sysFs.unlink(String(absPath));
      }
    };
  }
  async function resolveHome() {
    try {
      if (typeof getPlatform !== "function") return "";
      const platform = await getPlatform();
      if (!platform || typeof platform.getHome !== "function") return "";
      const home = await platform.getHome();
      if (typeof home !== "string" || home.trim() === "") return "";
      return home;
    } catch (e) {
      return "";
    }
  }
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
  function phoneLog(method, t0, res, err) {
    try {
      if (err !== void 0 && err !== null) {
        if (logCtx) logCtx.fire("warn", "host.call.fail", { method, kind: "settings", errorHash: hash8(String(err && err.message || err)) });
      } else if (res && res.ok) {
        if (logCtx) logCtx.fire("info", "host.call", { method, latencyMs: Date.now() - t0, ok: true, kind: "settings" });
      } else if (logCtx) logCtx.fire("warn", "host.call.fail", { method, kind: "settings", errorHash: hash8(String(res && res.error && (res.error.message || res.error.kind) || "settings-not-ok")) });
    } catch (eL) {
    }
  }
  let writeQueue = Promise.resolve();
  function serialWrite(task) {
    const next = writeQueue.then(task, task);
    writeQueue = next.then(function() {
    }, function() {
    });
    return next;
  }
  async function handleGetSettings() {
    const home = await resolveHome();
    if (!home) return { ok: false, error: { kind: "environment", message: "\u62FF\u4E0D\u5230\u7528\u6237\u4E3B\u76EE\u5F55\uFF0C\u6240\u4EE5\u8BFB\u4E0D\u51FA\u672C\u673A\u8BBE\u7F6E\u6587\u4EF6\u3002\u8BF7\u68C0\u67E5\u5E73\u53F0\u4E3B\u76EE\u5F55\u80FD\u529B\u662F\u5426\u53EF\u7528\uFF0C\u7136\u540E\u91CD\u8BD5\u3002" } };
    if (typeof readLocalSettings !== "function") return { ok: false, error: { kind: "environment", message: "\u8BFB\u672C\u673A\u8BBE\u7F6E\u8FD9\u4E00\u6B65\u6CA1\u6709\u88C5\u597D\uFF0C\u6240\u4EE5\u6CA1\u6709\u8BFB\u4EFB\u4F55\u6587\u4EF6\u3002\u8BF7\u91CD\u8BD5\u4E00\u6B21\uFF0C\u5982\u679C\u4ECD\u7136\u5931\u8D25\u8BF7\u628A\u8FD9\u6761\u63D0\u793A\u539F\u6587\u62A5\u544A\u7ED9\u63D2\u4EF6\u7EF4\u62A4\u8005\u3002" } };
    let raw = null;
    try {
      raw = await readLocalSettings(home, buildIo());
    } catch (e) {
      return { ok: false, error: { kind: "environment", message: "\u8BFB\u672C\u673A\u8BBE\u7F6E\u6587\u4EF6\u8FD9\u4E00\u6B65\u51FA\u9519\u4E86\uFF0C\u53EF\u80FD\u662F\u5F53\u524D\u8D26\u53F7\u8BFB\u4E0D\u5230\u5B83\uFF0C\u4E5F\u53EF\u80FD\u662F\u5B83\u6B63\u88AB\u522B\u7684\u7A0B\u5E8F\u5360\u7528\u3002\u8BF7\u68C0\u67E5\u540E\u91CD\u8BD5\u3002\u9519\u8BEF\u539F\u6587\uFF1A" + String(e && e.message || e).slice(0, 120) } };
    }
    if (raw && raw.ok === true) {
      return { ok: true, value: raw.value, warnings: raw.warnings || [], readonly: raw.readonly === true, from: raw.from || "yaml" };
    }
    const reason = String(raw && raw.reason || "env");
    return { ok: false, error: { kind: mapSettingsKind(reason), message: String(raw && raw.message || "\u8BFB\u672C\u673A\u8BBE\u7F6E\u6587\u4EF6\u8FD9\u4E00\u6B65\u51FA\u9519\u4E86\u3002") } };
  }
  async function handleSetSettings(args) {
    return serialWrite(async function() {
      const home = await resolveHome();
      if (!home) return { ok: false, error: { kind: "environment", message: "\u62FF\u4E0D\u5230\u7528\u6237\u4E3B\u76EE\u5F55\uFF0C\u6240\u4EE5\u4FDD\u5B58\u4E0D\u4E86\u672C\u673A\u8BBE\u7F6E\u6587\u4EF6\u3002\u8BF7\u68C0\u67E5\u5E73\u53F0\u4E3B\u76EE\u5F55\u80FD\u529B\u662F\u5426\u53EF\u7528\uFF0C\u7136\u540E\u91CD\u8BD5\u3002" } };
      if (typeof readLocalSettings !== "function" || typeof writeLocalSettings !== "function") return { ok: false, error: { kind: "environment", message: "\u5199\u672C\u673A\u8BBE\u7F6E\u8FD9\u4E00\u6B65\u6CA1\u6709\u88C5\u597D\uFF0C\u6240\u4EE5\u6CA1\u6709\u52A8\u76D8\u4E0A\u7684\u4EFB\u4F55\u6587\u4EF6\u3002\u8BF7\u91CD\u8BD5\u4E00\u6B21\uFF0C\u5982\u679C\u4ECD\u7136\u5931\u8D25\u8BF7\u628A\u8FD9\u6761\u63D0\u793A\u539F\u6587\u62A5\u544A\u7ED9\u63D2\u4EF6\u7EF4\u62A4\u8005\u3002" } };
      const inputValue = args && typeof args.value === "object" && args.value !== null ? args.value : args && typeof args.settings === "object" && args.settings !== null ? args.settings : null;
      if (inputValue === null) return { ok: false, error: { kind: "invalid", message: "\u8981\u4FDD\u5B58\u7684\u672C\u673A\u8BBE\u7F6E\u4E0D\u662F\u4E00\u4EFD\u540D\u5B57\u5230\u503C\u7684\u7EC4\u5408\uFF0C\u8BF7\u56DE\u5230\u8BBE\u7F6E\u754C\u9762\u91CD\u65B0\u4FDD\u5B58\u4E00\u6B21\u3002" } };
      let before = null;
      try {
        before = await readLocalSettings(home, buildIo());
      } catch (e) {
        before = null;
      }
      if (before && before.ok === true && before.readonly === true) {
        return { ok: false, error: { kind: "readonly", message: "\u8FD9\u4EFD\u672C\u673A\u8BBE\u7F6E\u6587\u4EF6\u662F\u65B0\u7248\u672C\u63D2\u4EF6\u5199\u7684\uFF0C\u5F53\u524D\u63D2\u4EF6\u53EA\u8BA4\u8BC6\u5230\u7248\u672C\u4E00\uFF0C\u53EF\u4EE5\u8BFB\u6765\u5C55\u793A\uFF0C\u4E0D\u8BB8\u5199\u56DE\u53BB\uFF0C\u8BF7\u5347\u7EA7\u63D2\u4EF6\u5230\u6700\u65B0\u7248\u672C\u540E\u518D\u6539\u3002" } };
      }
      let made = null;
      try {
        made = await writeLocalSettings(inputValue, home, buildIo());
      } catch (e) {
        return { ok: false, error: { kind: "environment", message: "\u4FDD\u5B58\u5931\u8D25\uFF0C\u5199\u4E0D\u8FDB\u672C\u673A\u8BBE\u7F6E\u6587\u4EF6\uFF0C\u8BF7\u68C0\u67E5\u5B83\u7684\u4E0A\u4E00\u7EA7\u76EE\u5F55\u5728\u4E0D\u5728\u4E0E\u5F53\u524D\u8D26\u53F7\u80FD\u4E0D\u80FD\u5199\u5165\uFF0C\u7136\u540E\u91CD\u8BD5\u3002\u9519\u8BEF\u539F\u6587\uFF1A" + String(e && e.message || e).slice(0, 120) } };
      }
      if (made && made.ok === true) {
        return { ok: true, from: made.from || "yaml", warnings: made.warnings || [] };
      }
      const reason = String(made && made.reason || "env");
      if (reason === "version-newer") {
        return { ok: false, error: { kind: "readonly", message: "\u8FD9\u4EFD\u672C\u673A\u8BBE\u7F6E\u6587\u4EF6\u662F\u65B0\u7248\u672C\u63D2\u4EF6\u5199\u7684\uFF0C\u5F53\u524D\u63D2\u4EF6\u53EA\u8BA4\u8BC6\u5230\u7248\u672C\u4E00\uFF0C\u53EF\u4EE5\u8BFB\u6765\u5C55\u793A\uFF0C\u4E0D\u8BB8\u5199\u56DE\u53BB\uFF0C\u8BF7\u5347\u7EA7\u63D2\u4EF6\u5230\u6700\u65B0\u7248\u672C\u540E\u518D\u6539\u3002" } };
      }
      const out = { kind: mapSettingsKind(reason), message: String(made && made.message || "\u4FDD\u5B58\u5931\u8D25\uFF0C\u5199\u4E0D\u8FDB\u672C\u673A\u8BBE\u7F6E\u6587\u4EF6\u3002") };
      if (made && Array.isArray(made.keys)) out.keys = made.keys;
      return { ok: false, error: out };
    });
  }
  function loggedPhone(method, fn) {
    return async function() {
      const t0 = Date.now();
      try {
        const r = await fn.apply(null, arguments);
        phoneLog(method, t0, r);
        return r;
      } catch (e) {
        phoneLog(method, t0, null, e);
        throw e;
      }
    };
  }
  return { handleGetSettings: loggedPhone("wf.getSettings", handleGetSettings), handleSetSettings: loggedPhone("wf.setSettings", handleSetSettings) };
}
var settingsPhones_default = { createSettingsPhones, isSettingsAbsenceError };
export {
  createSettingsPhones,
  settingsPhones_default as default,
  isSettingsAbsenceError
};
