function createPickerShell(deps) {
  const { DEFAULT_CWD, getPlatform, logCtx } = deps;
  async function handleOpenFolder(args) {
    const cwd = args && (args.cwd || args.path) || DEFAULT_CWD;
    if (!cwd) return { ok: false, error: "\u7F3A\u5C11 cwd" };
    try {
      const platform = await getPlatform();
      if (!platform || typeof platform.openFolder !== "function") return { ok: false, error: "\u5F53\u524D\u5E73\u53F0\u4E0D\u652F\u6301\u6253\u5F00" };
      const res = await platform.openFolder(String(cwd), DEFAULT_CWD);
      if (!res || res.ok !== true) return { ok: false, error: String(res && res.error || "\u6253\u5F00\u5931\u8D25") };
      return { ok: true, cwd: String(cwd), opener: res.opener || "" };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }
  async function handlePickDirectory(args) {
    const cwd = args && (args.cwd || args.initial) ? String(args.cwd || args.initial) : DEFAULT_CWD;
    const initial = args && args.initial ? String(args.initial) : cwd;
    try {
      let electron = null;
      try {
        electron = typeof require === "function" ? require("electron") : null;
      } catch (_) {
      }
      if (electron && electron.dialog && typeof electron.dialog.showOpenDialogSync === "function") {
        try {
          const picked = electron.dialog.showOpenDialogSync({ properties: ["openDirectory"], defaultPath: initial || cwd });
          if (Array.isArray(picked) && picked[0]) return { ok: true, path: String(picked[0]) };
          return { ok: false, error: "cancelled", errorKind: "cancelled" };
        } catch (_) {
        }
      }
      try {
        let plat = null;
        try {
          plat = await getPlatform();
        } catch (_) {
        }
        if (plat && typeof plat.pickDirectory === "function") {
          const p = await plat.pickDirectory(initial || cwd);
          if (p) return { ok: true, path: String(p) };
        }
      } catch (_) {
      }
      return { ok: false, error: "\u5F53\u524D\u73AF\u5883\u6682\u65E0\u539F\u751F\u76EE\u5F55\u9009\u62E9\u5668\uFF0C\u8BF7\u624B\u52A8\u8F93\u5165\u8DEF\u5F84", errorKind: "no-picker" };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e), errorKind: "internal" };
    }
  }
  async function handlePickFile(args) {
    const cwd = args && (args.cwd || args.initial) ? String(args.cwd || args.initial) : DEFAULT_CWD;
    const initial = args && args.initial ? String(args.initial) : cwd;
    try {
      let electron = null;
      try {
        electron = typeof require === "function" ? require("electron") : null;
      } catch (_) {
      }
      if (electron && electron.dialog && typeof electron.dialog.showOpenDialogSync === "function") {
        try {
          const picked = electron.dialog.showOpenDialogSync({ properties: ["openFile"], defaultPath: initial || cwd });
          if (Array.isArray(picked) && picked[0]) return { ok: true, path: String(picked[0]) };
          return { ok: false, error: "cancelled", errorKind: "cancelled" };
        } catch (_) {
        }
      }
      try {
        let plat = null;
        try {
          plat = await getPlatform();
        } catch (_) {
        }
        if (plat && typeof plat.pickFile === "function") {
          const p = await plat.pickFile(initial || cwd);
          if (p) return { ok: true, path: String(p) };
        }
      } catch (_) {
      }
      return { ok: false, error: "\u5F53\u524D\u73AF\u5883\u6682\u65E0\u539F\u751F\u6587\u4EF6\u9009\u62E9\u5668\uFF0C\u8BF7\u624B\u52A8\u8F93\u5165\u8DEF\u5F84", errorKind: "no-picker" };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e), errorKind: "internal" };
    }
  }
  async function handleOpenPath(args) {
    const raw = args && args.path ? String(args.path) : "";
    if (!raw) return { ok: false, error: "\u7F3A\u5C11 path", errorKind: "bad-arg" };
    let p = raw.trim();
    if (/^file:\/\//i.test(p)) {
      try {
        p = decodeURI(p.replace(/^file:\/\/\//i, "").replace(/^file:\/\//i, ""));
      } catch {
      }
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
    }
    if (!p) return { ok: false, error: "path \u4E3A\u7A7A", errorKind: "bad-arg" };
    try {
      const plat = await getPlatform();
      if (!plat || typeof plat.openFile !== "function" || typeof plat.openFolder !== "function") return { ok: false, error: "\u5F53\u524D\u5E73\u53F0\u4E0D\u652F\u6301\u6253\u5F00", errorKind: "unsupported" };
      let base = "";
      try {
        base = plat.path && typeof plat.path.basename === "function" ? plat.path.basename(p) : "";
      } catch {
      }
      const looksDir = !base || base.indexOf(".") < 0;
      const res = looksDir ? await plat.openFolder(p, DEFAULT_CWD) : await plat.openFile(p, DEFAULT_CWD);
      if (!res || res.ok !== true) return { ok: false, error: String(res && res.error || "\u6253\u5F00\u5931\u8D25"), errorKind: "open-fail" };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e), errorKind: "internal" };
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
  function phoneLog(method, kind, t0, res, err) {
    try {
      if (err !== void 0 && err !== null) {
        if (logCtx) logCtx.fire("warn", "host.call.fail", { method, kind, errorHash: hash8(String(err && err.message || err)) });
      } else if (res && res.ok) {
        if (logCtx) logCtx.fire("info", "host.call", { method, latencyMs: Date.now() - t0, ok: true, kind });
      } else if (logCtx) logCtx.fire("warn", "host.call.fail", { method, kind, errorHash: hash8(String(res && (res.error && res.error.message || res.error || res.errorKind) || "picker-not-ok")) });
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
  return { handleOpenFolder: loggedPhone("wf.openFolder", "picker", handleOpenFolder), handlePickDirectory: loggedPhone("wf.pickDirectory", "picker", handlePickDirectory), handlePickFile: loggedPhone("wf.pickFile", "picker", handlePickFile), handleOpenPath: loggedPhone("wf.openPath", "picker", handleOpenPath) };
}
export {
  createPickerShell
};
