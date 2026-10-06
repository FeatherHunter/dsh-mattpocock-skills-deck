// 由 dsh-plugin-update@0.8.0 的入口件产物打成浏览器绑定包，人手不改。
// 来源：已安装更新包的 dist/entry.js（含内部 dialog 面板）；摆法与关闭轮询约定全部走包默认。
var __DshUpdateEntry = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/entry.js
  var entry_exports = {};
  __export(entry_exports, {
    UPDATE_ENTRY_CSS: () => UPDATE_ENTRY_CSS,
    entryBilingualHTMLFor: () => entryBilingualHTMLFor,
    entryBilingualKeyFor: () => entryBilingualKeyFor,
    entryBilingualTextFor: () => entryBilingualTextFor,
    entryBilingualValuesFor: () => entryBilingualValuesFor,
    entryLabelFor: () => entryLabelFor,
    entrySizingStyleFor: () => entrySizingStyleFor,
    entryStateKind: () => entryStateKind,
    mountUpdateEntry: () => mountUpdateEntry
  });

  // ../node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/config.js
  var DEFAULT_PREFIX = "wf";
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
  function buildPhoneNames(prefix) {
    const checked = assertPrefix(prefix, "\u7535\u8BDD\u540D\u524D\u7F00 prefix");
    return {
      updateStatus: checked + ".updateStatus",
      updateCheck: checked + ".updateCheck",
      updateInstall: checked + ".updateInstall",
      updateChangelog: checked + ".updateChangelog"
    };
  }
  function buildChangelogPhoneName(prefix) {
    return buildPhoneNames(prefix).updateChangelog;
  }

  // ../node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/redaction.js
  var COPY_BUDGET_CHARS = 1500;
  var REDACTED_PATH = "<\u8DEF\u5F84>";
  var REDACTED_SECRET = "<\u8131\u654F>";
  var ABSOLUTE_PATH_RE = /[A-Za-z]:\\[^\s"']*|\\\\[^\s"'()\[\];]+|(^|[\s"'(\[=,])\/\/[^\s"'()\[\];]+|(^|[\s"'(\[=:,])\/(?!\/)[^\s"'()\[\];]+/g;
  var URL_USERINFO_RE = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/]*@/;
  var NPM_TOKEN_RE = /\bnpm_[A-Za-z0-9_-]{8,}/g;
  var GITHUB_TOKEN_RE = /\b(?:gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{10,})/g;
  var SK_TOKEN_RE = /\bsk-[A-Za-z0-9_-]{6,}/g;
  var BEARER_TOKEN_RE = /(\bbearer\s+)[A-Za-z0-9._~+/-=]{6,}/gi;
  var CRED_PAIR_RE = /(\b(?:token|password|passwd|pwd|api[_-]?key|access[_-]?key|auth[_-]?token|secret|cookie)\s*[:=]\s*)("[^"]+"|'[^']+'|[^\s'";,)\]]+)/gi;
  var EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  function flattenWhitespace(text) {
    return String(text ?? "").replace(/\s+/g, " ").trim();
  }
  function applyPathRule(text) {
    ABSOLUTE_PATH_RE.lastIndex = 0;
    return text.replace(ABSOLUTE_PATH_RE, (_whole, g1, g2) => {
      const lead = g1 ?? g2 ?? "";
      return `${lead}${REDACTED_PATH}`;
    });
  }
  function applyTokenRule(text) {
    NPM_TOKEN_RE.lastIndex = 0;
    GITHUB_TOKEN_RE.lastIndex = 0;
    SK_TOKEN_RE.lastIndex = 0;
    BEARER_TOKEN_RE.lastIndex = 0;
    return text.replace(NPM_TOKEN_RE, REDACTED_SECRET).replace(GITHUB_TOKEN_RE, REDACTED_SECRET).replace(SK_TOKEN_RE, REDACTED_SECRET).replace(BEARER_TOKEN_RE, (_whole, prefix) => `${prefix}${REDACTED_SECRET}`);
  }
  function applyCredPairRule(text) {
    CRED_PAIR_RE.lastIndex = 0;
    return text.replace(CRED_PAIR_RE, (_whole, head) => `${head}${REDACTED_SECRET}`);
  }
  function applyEmailRule(text) {
    EMAIL_RE.lastIndex = 0;
    return text.replace(EMAIL_RE, REDACTED_SECRET);
  }
  function hasUserinfo(text) {
    URL_USERINFO_RE.lastIndex = 0;
    return URL_USERINFO_RE.test(text);
  }
  function truncateToWordBoundary(text, max) {
    const input = String(text ?? "");
    if (input.length <= max) return input;
    const slice = input.slice(0, max);
    const lastSpace = slice.lastIndexOf(" ");
    let cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
    const lastOpen = cut.lastIndexOf("<");
    const lastClose = cut.lastIndexOf(">");
    if (lastOpen > lastClose) cut = cut.slice(0, lastOpen).trimEnd();
    if (!cut) cut = slice;
    return `${cut}\u2026`;
  }
  function truncateForCopy(text) {
    return truncateToWordBoundary(text, COPY_BUDGET_CHARS);
  }
  function scrubWithoutBudget(text) {
    return applyEmailRule(applyCredPairRule(applyTokenRule(applyPathRule(text))));
  }
  function sanitizeForCopy(text) {
    const flat = flattenWhitespace(String(text ?? ""));
    if (!flat) return "";
    if (hasUserinfo(flat)) return "";
    return truncateForCopy(scrubWithoutBudget(flat));
  }

  // ../node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/service.js
  var CONFIRMATION_TTL_MS = 10 * 6e4;
  var MAX_METADATA_BYTES = 256 * 1024;
  function updateError(code) {
    return Object.assign(new Error(code), { code });
  }
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
    const core = v.slice(0, dash);
    const ids = v.slice(dash + 1);
    if (!validVersion(core) || !validPrereleaseIds(ids)) return false;
    if (ids.includes("+")) return false;
    return true;
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
  function compareReleaseVersions(a, b) {
    if (!validReleaseVersion(a) || !validReleaseVersion(b)) throw updateError("invalid-release");
    const dashA = String(a).indexOf("-");
    const dashB = String(b).indexOf("-");
    const coreA = dashA < 0 ? String(a) : String(a).slice(0, dashA);
    const coreB = dashB < 0 ? String(b) : String(b).slice(0, dashB);
    const order = compareVersions(coreA, coreB);
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

  // ../node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/lang.js
  function normalizeLangTag(tag) {
    if (typeof tag !== "string") return "zh";
    const s = tag.trim().toLowerCase().replace(/_/g, "-");
    if (!s) return "zh";
    if (s === "zh" || s.startsWith("zh-")) return "zh";
    if (s === "en" || s.startsWith("en-")) return "en";
    if (/^[a-z]{2,3}(-[a-z0-9]+)*$/.test(s)) return "en";
    return "zh";
  }
  function readDocumentLang() {
    try {
      const g = globalThis;
      const v = g.document?.documentElement?.lang;
      if (typeof v === "string" && v.trim()) return v;
    } catch {
    }
    return null;
  }
  function readNavigatorLangs() {
    try {
      const g = globalThis;
      const nav = g.navigator;
      if (!nav) return [];
      const out = [];
      if (Array.isArray(nav.languages)) {
        for (const c of nav.languages) {
          if (typeof c === "string" && c.trim()) out.push(c);
        }
      }
      if (typeof nav.language === "string" && nav.language.trim()) out.push(nav.language);
      return out;
    } catch {
      return [];
    }
  }
  function resolveLang(override) {
    if (override !== null && typeof override === "object") {
      try {
        const fn = override.getActive;
        if (typeof fn === "function") {
          const v = fn.call(override);
          if (typeof v === "string" && v.trim()) return normalizeLangTag(v);
        }
      } catch {
      }
    } else if (typeof override === "string" && override.trim()) {
      return normalizeLangTag(override);
    }
    const docLang = readDocumentLang();
    if (docLang !== null) return normalizeLangTag(docLang);
    const navs = readNavigatorLangs();
    for (const c of navs) {
      return normalizeLangTag(c);
    }
    return "zh";
  }
  var entries = /* @__PURE__ */ new Set();
  var mo = null;
  function ensureGlobalObserver() {
    if (mo !== null) return;
    try {
      const g = globalThis;
      const docEl = g.document?.documentElement;
      const MO = g.MutationObserver;
      if (!docEl || typeof MO !== "function") return;
      const obs = new MO(() => {
        notifyAll();
      });
      obs.observe(docEl, { attributes: true, attributeFilter: ["lang"] });
      mo = obs;
    } catch {
      mo = null;
    }
  }
  function notifyAll() {
    for (const e of [...entries]) {
      try {
        const next = resolveLang(e.override);
        if (next !== e.last) {
          e.last = next;
          e.cb(next);
        }
      } catch {
      }
    }
  }
  function subscribeLang(cb, override) {
    if (typeof cb !== "function") throw new Error("[dsh-plugin-update] subscribeLang needs a function");
    const entry = { cb, override: override ?? void 0, last: resolveLang(override), serviceUnsub: null };
    entries.add(entry);
    ensureGlobalObserver();
    try {
      if (entry.override !== null && typeof entry.override === "object") {
        const sub = entry.override.subscribe;
        if (typeof sub === "function") {
          const un = sub.call(entry.override, () => {
            try {
              const next = resolveLang(entry.override);
              if (next !== entry.last) {
                entry.last = next;
                entry.cb(next);
              }
            } catch {
            }
          });
          if (typeof un === "function") entry.serviceUnsub = un;
        }
      }
    } catch {
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      entries.delete(entry);
      try {
        entry.serviceUnsub?.();
      } catch {
      }
      entry.serviceUnsub = null;
      if (entries.size === 0) {
        try {
          mo?.disconnect();
        } catch {
        }
        mo = null;
      }
    };
  }

  // ../node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/bilingual.js
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
  function escapeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
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
  function copyText(key, lang, values) {
    const l = normalizeLangTag(lang ?? "zh");
    const e = bilingualEntry(key);
    return formatTemplate(l === "en" ? e.en : e.zh, values);
  }
  function copyHTML(key, lang, values) {
    const l = normalizeLangTag(lang ?? "zh");
    const e = bilingualEntry(key);
    const text = escapeHtml(formatTemplate(l === "en" ? e.en : e.zh, values));
    return '<span class="dsh-upd-bi"><span lang="' + l + '">' + text + "</span></span>";
  }
  var BILINGUAL_CSS = [
    ".dsh-upd-bi{display:inline;overflow-wrap:anywhere}",
    ".dsh-upd-bi [lang]{overflow-wrap:anywhere}"
  ].join("\n");

  // ../node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/changelog.js
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
  function shouldFetchChangelog(opts) {
    try {
      const o = opts;
      if (o.hasCache === true) return false;
      if (o.isManual === true) return true;
      const now = typeof o.now === "number" && Number.isFinite(o.now) ? o.now : Date.now();
      const failedAt = typeof o.failedAt === "number" && Number.isFinite(o.failedAt) ? o.failedAt : null;
      if (failedAt === null) return true;
      const backoff = typeof o.backoffMs === "number" && Number.isFinite(o.backoffMs) && o.backoffMs > 0 ? Math.floor(o.backoffMs) : CHANGELOG_POLL_BACKOFF_MS;
      return now - failedAt >= backoff;
    } catch {
      return true;
    }
  }
  function parseChangelog(markdown) {
    try {
      if (typeof markdown !== "string" || !markdown.trim()) return [];
      let text = markdown.replace(/\r\n/g, "\n");
      if (text.length > CHANGELOG_MAX_CHARS) text = text.slice(0, CHANGELOG_MAX_CHARS);
      const lines = text.split("\n");
      const entries2 = [];
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
        entries2.push(cur);
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
      return entries2.slice(0, CHANGELOG_MAX_ENTRIES);
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
      return compareReleaseVersions(a, b);
    } catch {
      return null;
    }
  }
  function selectChangelogEntries(entries2, fromExclusive, toInclusive) {
    try {
      if (!Array.isArray(entries2) || entries2.length === 0) return [];
      const to = typeof toInclusive === "string" ? toInclusive.trim() : "";
      if (!to || !validReleaseVersion(to)) return [];
      const from = typeof fromExclusive === "string" ? fromExclusive.trim() : "";
      const fromValid = from && validReleaseVersion(from) ? from : null;
      const out = [];
      for (const e of entries2) {
        if (!e || typeof e !== "object") continue;
        const v = typeof e.version === "string" ? String(e.version) : "";
        if (!v || isUnreleasedVersion(v) || !validReleaseVersion(v)) continue;
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
  function changelogForUpdate(entries2, runningVersion, latestVersion, installedVersion) {
    try {
      const to = typeof latestVersion === "string" ? latestVersion.trim() : "";
      if (!to || !validReleaseVersion(to)) return [];
      const run = typeof runningVersion === "string" ? runningVersion.trim() : "";
      const inst = typeof installedVersion === "string" ? installedVersion.trim() : "";
      const from = run && validReleaseVersion(run) ? run : inst && validReleaseVersion(inst) ? inst : "";
      if (!from) return [];
      const order = compareReleaseSafe(to, from);
      if (order === null || order <= 0) return [];
      return selectChangelogEntries(entries2, from, to);
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
      const text = copyText("changelog.truncated.count", l, { m: String(m), n: String(n) });
      return '<div class="dsh-upd-changelog-count">' + escapeChangelogHtml(text) + "</div>";
    } catch {
      return "";
    }
  }
  function yankedBannerHTML(version, lang) {
    try {
      const l = normalizeLangTag(lang ?? "zh");
      const v = typeof version === "string" ? version.trim() : "";
      if (!v) return "";
      const text = copyText("changelog.yanked.banner", l, { version: v });
      return '<div class="dsh-upd-changelog-yanked" role="alert">' + escapeChangelogHtml(text) + "</div>";
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
      const badgeText = copyText("changelog.breaking.badge", l);
      const badgeAria = copyText("changelog.breaking.aria", l);
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
      const yankedSuffix = yankedFlag ? copyText("changelog.yanked.suffix", l) : "";
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
          const sumText = copyText("changelog.security.summary", l, { n: String(restCount) });
          const noteText = copyText("changelog.security.note", l);
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
      const text = copyText("changelog.neutral.line", l);
      return `<div class="dsh-upd-changelog-neutral">${escapeChangelogHtml(text)}</div>`;
    } catch {
      return "";
    }
  }
  function renderChangelogHTML(entries2, opts) {
    try {
      const l = normalizeLangTag(opts?.lang ?? "zh");
      if (!Array.isArray(entries2) || entries2.length === 0) return renderChangelogNeutral(l);
      const from = opts && typeof opts.from === "string" ? opts.from : null;
      const to = opts && typeof opts.to === "string" ? opts.to : null;
      let ranged;
      if (from !== null || to !== null) {
        ranged = selectChangelogEntries(entries2, from, to);
      } else {
        ranged = entries2.filter((e) => {
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

  // ../node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/log-events.js
  var LOG_EVENT_CALL = "host.call";
  var LOG_EVENT_CALL_FAIL = "host.call.fail";
  var LOG_EVENT_INSTALL_EXEC = "update.install.exec";

  // ../node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/queue.js
  var QUEUE_INTENT_TTL_MS = 10 * 6e4;

  // ../node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/panel.js
  function normalizePanelTheme(value) {
    return value === "archive" ? "archive" : "default";
  }
  var THEME_TOKEN_VARS = {
    text: "--dsh-update-text",
    textMuted: "--dsh-update-text-muted",
    bg: "--dsh-update-bg",
    bgSoft: "--dsh-update-bg-soft",
    border: "--dsh-update-border",
    borderStrong: "--dsh-update-border-strong",
    buttonBg: "--dsh-update-button-bg",
    primary: "--dsh-update-primary",
    primaryDeep: "--dsh-update-primary-deep",
    focus: "--dsh-update-focus",
    okBg: "--dsh-update-ok-bg",
    okBorder: "--dsh-update-ok-border",
    okText: "--dsh-update-ok-text",
    warnBg: "--dsh-update-warn-bg",
    warnBorder: "--dsh-update-warn-border",
    warnText: "--dsh-update-warn-text",
    badBg: "--dsh-update-bad-bg",
    badBorder: "--dsh-update-bad-border",
    badText: "--dsh-update-bad-text",
    busyBg: "--dsh-update-busy-bg",
    busyBorder: "--dsh-update-busy-border",
    busyText: "--dsh-update-busy-text",
    newText: "--dsh-update-new-text",
    fontSans: "--dsh-update-font-sans",
    fontSerif: "--dsh-update-font-serif",
    fontMono: "--dsh-update-font-mono",
    shadow: "--dsh-update-shadow",
    radiusPanel: "--dsh-update-radius-panel",
    radiusButton: "--dsh-update-radius-button",
    radiusBadge: "--dsh-update-radius-badge",
    entryFontSize: "--dsh-update-entry-font-size",
    entryPadding: "--dsh-update-entry-padding",
    entryBorderRadius: "--dsh-update-entry-border-radius",
    entryScale: "--dsh-update-entry-scale"
  };
  var THEME_TOKEN_COLOR_KEYS = /* @__PURE__ */ new Set([
    "text",
    "textMuted",
    "bg",
    "bgSoft",
    "border",
    "borderStrong",
    "buttonBg",
    "primary",
    "primaryDeep",
    "focus",
    "okBg",
    "okBorder",
    "okText",
    "warnBg",
    "warnBorder",
    "warnText",
    "badBg",
    "badBorder",
    "badText",
    "busyBg",
    "busyBorder",
    "busyText",
    "newText"
  ]);
  function themeTokensError(raw) {
    return new Error(`[dsh-plugin-update] \u4E3B\u9898\u53C2\u6570 themeTokens \u975E\u6CD5\uFF1A\u53EA\u6536\u5DF2\u77E5 token \u952E\uFF08\u989C\u8272\u7528 hex \u6216\u82F1\u6587\u540D\uFF0C\u5B57\u4F53/\u5706\u89D2/\u9634\u5F71/\u5C3A\u5BF8\u4E3A\u5B89\u5168 CSS \u503C\uFF0CentryScale \u4E3A\u5927\u4E8E 0 \u7684\u6709\u9650\u6570\uFF09\uFF08\u6536\u5230 ${JSON.stringify(raw ?? null)})`);
  }
  function isSafeThemeCssValue(value) {
    const v = value.trim();
    if (!v || v.length > 200) return false;
    if (/[;"'<>\`{}!&]/.test(v)) return false;
    if (/url\s*\(/i.test(v)) return false;
    if (/expression\s*\(/i.test(v)) return false;
    if (/javascript\s*:/i.test(v)) return false;
    return true;
  }
  function isThemeColorValue(value) {
    const v = value.trim();
    if (!v || v.length > 100) return false;
    return /^(?:#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|[a-zA-Z]+)$/.test(v);
  }
  function themeTokensStyleFor(tokens) {
    if (tokens === void 0 || tokens === null) return "";
    if (typeof tokens !== "object" || Array.isArray(tokens)) throw themeTokensError(tokens);
    for (const key of Object.keys(tokens)) {
      if (!Object.prototype.hasOwnProperty.call(THEME_TOKEN_VARS, key)) throw themeTokensError(tokens);
    }
    const parts = [];
    for (const key of Object.keys(THEME_TOKEN_VARS)) {
      const value = tokens[key];
      if (value === void 0) continue;
      if (key === "entryScale") {
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw themeTokensError(tokens);
        parts.push(THEME_TOKEN_VARS[key] + ":" + String(value));
        continue;
      }
      if (typeof value !== "string") throw themeTokensError(tokens);
      const text = value.trim();
      if (THEME_TOKEN_COLOR_KEYS.has(key)) {
        if (!isThemeColorValue(text)) throw themeTokensError(tokens);
      } else if (!isSafeThemeCssValue(text)) throw themeTokensError(tokens);
      parts.push(THEME_TOKEN_VARS[key] + ":" + text);
    }
    return parts.join(";");
  }
  var BLOCKED_KEYS = {
    "unknown-profile": { title: "panel.blocked.unknown-profile.title", action: "panel.blocked.unknown-profile.action" },
    "source-install": { title: "panel.blocked.source-install.title", action: "panel.blocked.source-install.action" },
    "invalid-installation": { title: "panel.blocked.invalid-installation.title", action: "panel.blocked.invalid-installation.action" },
    "installation-changed": { title: "panel.blocked.installation-changed.title", action: "panel.blocked.installation-changed.action" },
    "pending-restart": { title: "panel.blocked.pending-restart.title", action: "panel.blocked.pending-restart.action" },
    "registry-conflict": { title: "panel.blocked.registry-conflict.title", action: "panel.blocked.registry-conflict.action" },
    "incompatible-node": { title: "panel.blocked.incompatible-node.title", action: "panel.blocked.incompatible-node.action" },
    "recovery-required": { title: "panel.blocked.recovery-required.title", action: "panel.blocked.recovery-required.action" }
  };
  function blockedCopy(reason, lang) {
    if (reason === null || reason === void 0) return null;
    const keys = BLOCKED_KEYS[reason];
    if (!keys) return null;
    const l = normalizeLangTag(lang ?? "zh");
    return { title: copyText(keys.title, l), action: copyText(keys.action, l) };
  }
  var PHONE_FAILURE_KEYS = {
    "check-failed": { title: "panel.failure.check-failed.title", action: "panel.failure.check-failed.action" },
    "invalid-release": { title: "panel.failure.invalid-release.title", action: "panel.failure.invalid-release.action" },
    "check-expired": { title: "panel.failure.check-expired.title", action: "panel.failure.check-expired.action" },
    "update-busy": { title: "panel.failure.update-busy.title", action: "panel.failure.update-busy.action" },
    "install-failed": { title: "panel.failure.install-failed.title", action: "panel.failure.install-failed.action" },
    internal: { title: "panel.failure.internal.title", action: "panel.failure.internal.action" }
  };
  var UNKNOWN_FAILURE_KEYS = {
    title: "panel.failure.unknown.title",
    action: "panel.failure.unknown.action"
  };
  function failureCopy(code, lang) {
    if (typeof code !== "string") return null;
    const c = code.trim();
    if (!c) return null;
    const l = normalizeLangTag(lang ?? "zh");
    const blocked = BLOCKED_KEYS[c];
    if (blocked) return { zh: copyText(blocked.title, l), act: copyText(blocked.action, l) };
    const phone = PHONE_FAILURE_KEYS[c];
    if (phone) return { zh: copyText(phone.title, l), act: copyText(phone.action, l) };
    return { zh: copyText(UNKNOWN_FAILURE_KEYS.title, l), act: copyText(UNKNOWN_FAILURE_KEYS.action, l) };
  }
  function failureCodeOf(reply, fallback) {
    const kind = reply && typeof reply.errorKind === "string" ? reply.errorKind.trim() : "";
    if (kind) return kind;
    const err = reply && typeof reply.error === "string" ? reply.error.trim() : "";
    if (err) return err;
    if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
    return "internal";
  }
  function redactForCopy(text) {
    return sanitizeForCopy(text);
  }
  var DIAG_KNOWN_TYPES = {
    v: "number",
    stage: "string",
    route: "string",
    method: "string",
    httpStatus: "number",
    exitCode: "number",
    latencyMs: "number",
    detail: "string",
    targetPackageName: "string",
    runningVersion: "string",
    latestVersion: "string",
    environmentKind: "string",
    requestId: "string",
    checkId: "string",
    registryHost: "string",
    action: "string"
  };
  function readDiagTolerant(diag) {
    const empty = {
      stage: null,
      route: null,
      method: null,
      httpStatus: null,
      exitCode: null,
      latencyMs: null,
      detail: null,
      targetPackageName: null,
      runningVersion: null,
      latestVersion: null,
      environmentKind: null,
      requestId: null,
      checkId: null,
      registryHost: null,
      action: null,
      unknownKeys: []
    };
    if (!diag || typeof diag !== "object" || Array.isArray(diag)) return empty;
    const raw = diag;
    const out = { ...empty, unknownKeys: [] };
    for (const key of Object.keys(DIAG_KNOWN_TYPES)) {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
      const v = raw[key];
      if (v === void 0 || v === null) continue;
      if (typeof v !== DIAG_KNOWN_TYPES[key]) continue;
      out[key] = v;
    }
    for (const key of Object.keys(raw)) {
      if (!Object.prototype.hasOwnProperty.call(DIAG_KNOWN_TYPES, key)) out.unknownKeys.push(key);
    }
    return out;
  }
  function pickText(value, fallback) {
    if (typeof value === "string" && value.trim()) return value.trim();
    return fallback;
  }
  function queueTextOf(queuePosition, lang, _diagQueuePos) {
    void _diagQueuePos;
    const l = normalizeLangTag(lang ?? "zh");
    const pos = typeof queuePosition === "number" ? queuePosition : null;
    if (pos === 0) return copyText("panel.diag.queue.installing", l);
    if (typeof pos === "number") return copyText("panel.diag.queue.position", l, { n: pos });
    return copyText("panel.diag.queue.absent", l);
  }
  function buildUpdateDiagCopy(input, langOverride) {
    const l = normalizeLangTag(langOverride ?? input.lang ?? "zh");
    const unknown = copyText("panel.diag.copy.unknown", l);
    const unknownPkg = copyText("panel.diag.copy.unknown-package", l);
    const rawCode = String(input.code ?? "").trim() || "internal";
    const copy = failureCopy(rawCode, l) ?? failureCopy("unknown", l);
    const diag = readDiagTolerant(input.diag);
    const detailRaw = diag.detail ?? input.detail ?? "";
    const detail = redactForCopy(detailRaw) || copyText("panel.diag.copy.no-detail", l);
    const pluginName = pickText(diag.targetPackageName ?? input.pluginId, unknownPkg);
    const runVer = pickText(diag.runningVersion ?? input.runningVersion, "?");
    const instVer = pickText(input.installedVersion ?? diag.latestVersion, "?");
    const host = pickText(diag.environmentKind ?? input.hostKind, unknown);
    const routeRaw = diag.route ?? input.route;
    const requestRaw = diag.requestId ?? input.requestId;
    const checkRaw = diag.checkId ?? input.checkId;
    const queue = queueTextOf(input.queuePosition ?? null, l);
    const prov = [copyText("panel.diag.copy.field.plugin", l, { plugin: pluginName }), copyText("panel.diag.copy.field.version", l, { run: runVer, inst: instVer }), copyText("panel.diag.copy.field.host", l, { host })];
    prov.push(copyText("panel.diag.copy.field.profile", l, { profile: pickText(input.profileName, unknown) }));
    if (typeof routeRaw === "string" && routeRaw.trim()) prov.push(copyText("panel.diag.copy.field.route", l, { route: routeRaw.trim() }));
    if (diag.stage) prov.push(copyText("panel.diag.copy.field.stage", l, { stage: diag.stage }));
    if (diag.method) prov.push(copyText("panel.diag.copy.field.method", l, { method: diag.method }));
    if (typeof diag.httpStatus === "number") prov.push(`HTTP=${diag.httpStatus}`);
    if (typeof diag.exitCode === "number") prov.push(`exit=${diag.exitCode}`);
    if (typeof diag.latencyMs === "number") prov.push(`${copyText("panel.diag.copy.field.latency", l, { latency: diag.latencyMs })}ms`);
    if (diag.registryHost) prov.push(copyText("panel.diag.copy.field.registry", l, { host: diag.registryHost }));
    else prov.push(copyText("panel.diag.copy.field.registry-unknown", l));
    if (diag.action) prov.push(copyText("panel.diag.copy.field.action", l, { action: diag.action }));
    if (typeof requestRaw === "string" && requestRaw.trim()) prov.push(copyText("panel.diag.copy.field.request", l, { request: requestRaw.trim() }));
    if (typeof checkRaw === "string" && checkRaw.trim()) prov.push(copyText("panel.diag.copy.field.check", l, { check: checkRaw.trim() }));
    prov.push(copyText("panel.diag.copy.field.queue", l, { queue }));
    const format = input.format === "line" ? "line" : "block";
    const provLine = redactForCopy(prov.join(" \xB7 "));
    if (format === "line") {
      const line = `[update-diag] code=${rawCode} \xB7 ${copy.zh} \xB7 ${copyText("panel.diag.copy.line.summary", l, { summary: detail })} \xB7 ${provLine} \xB7 ${copyText("panel.diag.copy.line.remedy", l, { remedy: copy.act })}`;
      return redactForCopy(line);
    }
    const block = [
      `[update-diag] ${rawCode} \u2014 ${copy.zh}`,
      `  ${copyText("panel.diag.copy.block.summary", l, { summary: detail })}`,
      `  ${copyText("panel.diag.copy.block.source", l, { source: provLine })}`,
      `  ${copyText("panel.diag.copy.block.remedy", l, { remedy: copy.act })}`
    ].join("\n");
    return block;
  }
  var PANEL_SKIPPED_MAX = 50;
  function panelSkipKey(pluginId) {
    return `dsh-upd-skipped/${String(pluginId)}`;
  }
  function normalizePanelSkipped(raw) {
    if (!raw || typeof raw !== "object") return [];
    const list = raw.skipped;
    if (!Array.isArray(list)) return [];
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const version = item.version;
      if (!validReleaseVersion(version) || seen.has(version)) continue;
      seen.add(version);
      const at = item.skippedAt;
      out.push({ version, skippedAt: typeof at === "number" && Number.isFinite(at) ? at : 0 });
    }
    return out.slice(0, PANEL_SKIPPED_MAX);
  }
  function createMemorySkipStore(now = Date.now) {
    let skipped = [];
    function assertVersion(version) {
      if (!validReleaseVersion(version)) {
        throw new Error(`[dsh-plugin-update] \u8DF3\u8FC7\u7248\u672C\u53F7\u975E\u6CD5\uFF1A\u987B\u4E3A\u53D1\u884C\u7248\u672C\u53F7\uFF08\u6536\u5230 ${JSON.stringify(version)}\uFF09`);
      }
      return version;
    }
    return {
      list: () => skipped.map((e) => e.version),
      has: (version) => validReleaseVersion(version) ? skipped.some((e) => e.version === version) : false,
      skip: (version) => {
        const v = assertVersion(version);
        const at = now();
        skipped = [{ version: v, skippedAt: typeof at === "number" && Number.isFinite(at) ? at : 0 }].concat(skipped.filter((e) => e.version !== v)).slice(0, PANEL_SKIPPED_MAX);
      },
      reset: (version) => {
        if (version === void 0) skipped = [];
        else skipped = skipped.filter((e) => e.version !== version);
      }
    };
  }
  function probeStorage(candidate) {
    try {
      if (!candidate || typeof candidate !== "object") return null;
      const s = candidate;
      if (typeof s.getItem !== "function" || typeof s.setItem !== "function" || typeof s.removeItem !== "function") return null;
      return s;
    } catch {
      return null;
    }
  }
  function createBrowserSkipStore(pluginId, storage, now = Date.now) {
    const memory = createMemorySkipStore(now);
    const store = probeStorage(storage) ?? probeStorage(globalThis["localStorage"] ?? null) ?? null;
    if (!store) return memory;
    const active = store;
    const key = panelSkipKey(pluginId);
    function read() {
      try {
        const raw = active.getItem(key);
        if (!raw) return [];
        return normalizePanelSkipped(JSON.parse(raw));
      } catch {
        return [];
      }
    }
    function write(entries2) {
      try {
        active.setItem(key, JSON.stringify({ skipped: entries2 }));
      } catch {
      }
    }
    try {
      for (const e of read()) memory.skip(e.version);
    } catch {
    }
    return {
      list: () => memory.list(),
      has: (version) => memory.has(version),
      skip: (version) => {
        memory.skip(version);
        write(normalizePanelSkipped({ skipped: memory.list().map((v) => ({ version: v, skippedAt: now() })) }));
      },
      reset: (version) => {
        memory.reset(version);
        if (version === void 0) {
          try {
            active.removeItem(key);
          } catch {
          }
        } else {
          write(normalizePanelSkipped({ skipped: memory.list().map((v) => ({ version: v, skippedAt: now() })) }));
        }
      }
    };
  }
  var SEAL_KEYS = {
    loading: { text: "panel.seal.loading.text", mini: "panel.seal.loading.mini", tone: "ink" },
    idle: { text: "panel.seal.idle.text", mini: "panel.seal.idle.mini", tone: "ink" },
    update: { text: "panel.seal.update.text", mini: "panel.seal.update.mini", tone: "green" },
    busy: { text: "panel.seal.busy.text", mini: "panel.seal.busy.mini", tone: "yellow" },
    restart: { text: "panel.seal.restart.text", mini: "panel.seal.restart.mini", tone: "yellow" },
    blocked: { text: "panel.seal.blocked.text", mini: "panel.seal.blocked.mini", tone: "red" },
    failed: { text: "panel.seal.failed.text", mini: "panel.seal.failed.mini", tone: "red" },
    done: { text: "panel.seal.done.text", mini: "panel.seal.done.mini", tone: "green" }
  };
  function panelSealFor(kind, lang) {
    const keys = SEAL_KEYS[kind] ?? SEAL_KEYS.idle;
    const l = normalizeLangTag(lang ?? "zh");
    return { text: copyText(keys.text, l), mini: copyText(keys.mini, l), tone: keys.tone };
  }
  function messageCodeOf(message) {
    if (typeof message !== "string" || !message) return "";
    const at = message.indexOf(":");
    return (at < 0 ? message : message.slice(0, at)).trim();
  }
  function panelViewModel(input, lang) {
    const l = normalizeLangTag(lang ?? input.lang ?? "zh");
    const view = panelViewModelCore(input, l);
    return { ...view, seal: panelSealFor(view.banner.kind, l) };
  }
  function panelViewModelCore(input, lang) {
    const { snapshot, manual, queue, skippedLatest, lastError } = input;
    const errorKind = input.errorKind;
    const l = normalizeLangTag(lang ?? "zh");
    if (!snapshot) {
      const earlyCode = typeof errorKind === "string" && errorKind.trim() || lastError || "";
      if (earlyCode) {
        const copy = failureCopy(earlyCode, l);
        return {
          banner: {
            kind: "failed",
            title: copyText("panel.banner.error.title", l, { code: earlyCode, detail: copy?.zh ?? earlyCode }),
            action: copy?.act || copyText("panel.banner.error.action-fallback", l)
          },
          installEnabled: false,
          installLabel: copyText("panel.action.retry-install", l),
          skippedLatest: false,
          showManual: manual ? true : false,
          showReset: false,
          queueNote: null
        };
      }
      return {
        banner: { kind: "loading", title: copyText("panel.banner.loading", l), action: "" },
        installEnabled: false,
        installLabel: copyText("panel.action.install", l),
        skippedLatest: false,
        showManual: false,
        showReset: false,
        queueNote: null
      };
    }
    const job = snapshot.job ?? null;
    const jobState = job?.state ?? null;
    const queueNote = queue && queue.busy ? queue.position === 0 ? copyText("panel.queue.busy-self", l) : typeof queue.position === "number" ? copyText("panel.queue.busy-queued", l, { n: queue.position }) : copyText("panel.queue.busy-other", l) : null;
    if (skippedLatest && snapshot.latestVersion) {
      return {
        banner: {
          kind: "idle",
          title: copyText("panel.skip.skipped-title", l, { latest: snapshot.latestVersion }),
          action: copyText("panel.skip.skipped-action", l)
        },
        installEnabled: false,
        installLabel: copyText("panel.action.install", l),
        skippedLatest: true,
        showManual: false,
        showReset: true,
        queueNote
      };
    }
    if (snapshot.blockedReason === "pending-restart") {
      const latest = snapshot.latestVersion ?? snapshot.installedVersion ?? "";
      return {
        banner: {
          kind: "restart",
          // 文案照原型（archive.html:329）：不带 emoji——警示由横幅左侧的手绘 SVG 标承担，
          // 印章在状态一侧，两者各司其职，不再三重标记。
          title: copyText("panel.banner.restart-title", l, { latest }),
          action: blockedCopy("pending-restart", l)?.action ?? ""
        },
        installEnabled: false,
        installLabel: copyText("panel.action.install", l),
        skippedLatest: false,
        showManual: manual ? true : false,
        showReset: false,
        queueNote
      };
    }
    if (jobState === "installing" || jobState === "verifying") {
      const ver = typeof job?.targetVersion === "string" && job.targetVersion.trim() ? job.targetVersion.trim() : "";
      let installingTitle = copyText("panel.banner.installing-title", l, { version: ver || " " });
      if (!ver) installingTitle = installingTitle.replace(" \u2026", "\u2026").replace(" ...", "...");
      return {
        banner: {
          kind: "busy",
          title: installingTitle,
          action: copyText("panel.banner.installing-action", l)
        },
        installEnabled: false,
        installLabel: copyText("panel.action.installing", l),
        skippedLatest: false,
        showManual: false,
        showReset: false,
        queueNote
      };
    }
    const jobCode = jobState === "failed" ? messageCodeOf(job?.message) || "install-failed" : "";
    const failedCode = typeof errorKind === "string" && errorKind.trim() || lastError || jobCode || "";
    if (failedCode || jobState === "failed" || jobState === "interrupted") {
      const code = failedCode || "install-failed";
      const copy = failureCopy(code, l);
      return {
        banner: {
          kind: "failed",
          title: copyText("panel.banner.error.title", l, { code, detail: copy?.zh ?? code }),
          action: copy?.act || copyText("panel.banner.error.action-fallback", l)
        },
        installEnabled: snapshot.canInstall,
        installLabel: copyText("panel.action.retry-install", l),
        skippedLatest: false,
        showManual: manual ? true : false,
        showReset: false,
        queueNote
      };
    }
    if (snapshot.blockedReason) {
      const copy = blockedCopy(snapshot.blockedReason, l);
      const stop = l === "en" ? "." : "\u3002";
      return {
        banner: {
          kind: "blocked",
          title: copy ? `${copy.title}${stop}` : `${snapshot.blockedReason}${stop}`,
          action: copy?.action || ""
        },
        installEnabled: false,
        installLabel: copyText("panel.action.install", l),
        skippedLatest: false,
        showManual: manual ? true : false,
        showReset: false,
        queueNote
      };
    }
    if (snapshot.canInstall && snapshot.latestVersion) {
      return {
        banner: {
          kind: "update",
          title: copyText("panel.banner.update-title", l, { latest: snapshot.latestVersion, running: snapshot.runningVersion }),
          action: copyText("panel.banner.update-action", l)
        },
        installEnabled: true,
        installLabel: copyText("panel.action.install-version", l, { latest: snapshot.latestVersion }),
        skippedLatest: false,
        showManual: manual ? true : false,
        showReset: false,
        queueNote
      };
    }
    return {
      banner: { kind: "done", title: copyText("panel.banner.done", l), action: "" },
      installEnabled: false,
      installLabel: copyText("panel.action.install", l),
      skippedLatest: false,
      showManual: false,
      showReset: false,
      queueNote
    };
  }
  var UPDATE_PANEL_CSS = [
    '.dsh-upd{font:14px/1.75 system-ui,"Microsoft YaHei",sans-serif;color:var(--dsh-update-text,#1f2937);',
    "background:var(--dsh-update-bg,#ffffff);border:1px solid var(--dsh-update-border,#e5e7eb);border-radius:8px;padding:12px 14px;max-width:560px;",
    // 横幅配色走变量（浅色默认 + 深色覆盖，见下方 dark 媒体块）：硬编码浅色会让深色下
    // 「浅底 + 浅字」读不出来（现场回归：默认主题深色模式更新横幅白底浅字）。
    "--dsh-update-ok-bg:#ecfdf5;--dsh-update-ok-border:#059669;--dsh-update-warn-bg:#fffbeb;--dsh-update-warn-border:#d97706;",
    "--dsh-update-bad-bg:#fef2f2;--dsh-update-bad-border:#dc2626;--dsh-update-busy-bg:#eff6ff;--dsh-update-busy-border:#2563eb}",
    ".dsh-upd *{box-sizing:border-box}",
    ".dsh-upd button{font:inherit;border:1px solid var(--dsh-update-border-strong,#d1d5db);border-radius:var(--dsh-update-radius-button,6px);background:var(--dsh-update-button-bg,#f9fafb);",
    "color:inherit;padding:7px 14px;cursor:pointer;margin:2px 6px 2px 0}",
    ".dsh-upd button:disabled{opacity:.45;cursor:not-allowed}",
    ".dsh-upd button:focus-visible{outline:2px solid var(--dsh-update-focus,#2563eb);outline-offset:1px}",
    '.dsh-upd button[data-primary="1"]{background:var(--dsh-update-primary,#2563eb);border-color:var(--dsh-update-primary,#2563eb);color:#fff}',
    ".dsh-upd-banner{border-left:4px solid var(--dsh-update-border,#9ca3af);padding:6px 10px;margin:0 0 8px;background:var(--dsh-update-bg-soft,#f3f4f6)}",
    '.dsh-upd-banner[data-kind="restart"]{border-color:var(--dsh-update-warn-border);background:var(--dsh-update-warn-bg)}',
    '.dsh-upd-banner[data-kind="failed"],.dsh-upd-banner[data-kind="blocked"]{border-color:var(--dsh-update-bad-border);background:var(--dsh-update-bad-bg)}',
    '.dsh-upd-banner[data-kind="update"]{border-color:var(--dsh-update-ok-border);background:var(--dsh-update-ok-bg)}',
    '.dsh-upd-banner[data-kind="busy"]{border-color:var(--dsh-update-busy-border);background:var(--dsh-update-busy-bg)}',
    ".dsh-upd code{font-family:Consolas,Menlo,monospace;font-size:12px;word-break:break-all}",
    ".dsh-upd-manual,.dsh-upd-queue,.dsh-upd-log{margin:4px 0;font-size:13px}",
    ".dsh-upd-changelog-wrap{margin:4px 0 0;font-size:13px}",
    ".dsh-upd-changelog-title{font-weight:700;margin:0 0 4px}",
    ".dsh-upd-changelog-version{margin:6px 0}",
    ".dsh-upd-changelog-catname{font-weight:600;margin:6px 0 2px}",
    ".dsh-upd-changelog ul{margin:2px 0 6px 20px;padding:0}",
    ".dsh-upd-changelog li{margin:2px 0}",
    ".dsh-upd-changelog-fold{margin:4px 0}",
    ".dsh-upd-changelog-fold>summary{cursor:pointer}",
    ".dsh-upd-changelog-count{font-size:12px;opacity:.7;margin:2px 0 4px}",
    ".dsh-upd-changelog-yanked{border-left:4px solid var(--dsh-update-warn-border,#d97706);background:var(--dsh-update-warn-bg,#fffbeb);padding:6px 10px;margin:6px 0;font-size:13px}",
    ".dsh-upd-breaking-badge{display:inline-block;font-size:11px;font-weight:700;border:1px solid currentColor;border-radius:3px;padding:0 5px;margin-right:6px;vertical-align:baseline}",
    ".dsh-upd-changelog-security-more{margin:4px 0 6px}",
    ".dsh-upd-changelog-security-more>summary{cursor:pointer;font-size:12px;opacity:.8}",
    ".dsh-upd-changelog-more-note{font-size:12px;opacity:.7;margin:2px 0 4px}",
    ".dsh-upd-changelog-neutral{color:inherit;opacity:.8}",
    ".dsh-upd-overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999}",
    ".dsh-upd-overlay .dsh-upd{background:var(--dsh-update-bg,#ffffff);max-height:85vh;display:flex;flex-direction:column;overflow:hidden}",
    // —— 弹窗分栏滚动：头（抬头/档案头/横幅/版本条）与尾固定，只有 01–05 章节区滚动 ——
    ".dsh-upd-body{min-height:0}",
    ".dsh-upd-body *{min-width:0}",
    ".dsh-upd-overlay .dsh-upd-body{flex:1 1 auto;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--dsh-update-border,#e5e7eb) transparent}",
    ".dsh-upd-overlay .dsh-upd-body::-webkit-scrollbar{width:8px}",
    ".dsh-upd-overlay .dsh-upd-body::-webkit-scrollbar-thumb{background:var(--dsh-update-border,#e5e7eb);border-radius:4px}",
    ".dsh-upd-overlay .dsh-upd-body::-webkit-scrollbar-track{background:transparent}",
    // —— 章节标题磁吸：滚动时节标题贴顶（纯 CSS sticky；背景跟随主题，Archive 另覆）——
    ".dsh-upd-overlay .dsh-upd-body .dsh-upd-chap-head{position:sticky;top:0;z-index:1;background:var(--dsh-update-bg,#ffffff);padding-top:2px}",
    // —— 档案头 / 版本条 / 章节 / 进度条 / 跳过行（原型 :208-245 的新结构，默认主题给最小可用样式）——
    ".dsh-upd-head{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}",
    // 卷宗抬头「插件更新 / 更新档案 卷」：Archive 档案卷才画，默认（最小）主题不画。
    // 两个主题共用同一份内核 HTML（见 renderUpdatePanelHTML 的注释），画不画是皮肤决定的事。
    ".dsh-upd-masthead{display:none}",
    ".dsh-upd-name{font-weight:700}",
    ".dsh-upd-meta{font-size:12.5px;opacity:.75}",
    ".dsh-upd-proftag{font-family:Consolas,Menlo,monospace;font-size:11px;border:1px solid var(--dsh-update-border,#d1d5db);border-radius:3px;padding:0 5px;margin-left:6px;letter-spacing:.06em}",
    ".dsh-upd-strip{display:flex;flex-wrap:wrap;margin:8px 0 0;border:1px solid var(--dsh-update-border,#e5e7eb);border-radius:4px;overflow:hidden;font-size:12.5px}",
    ".dsh-upd-strip>div{flex:1 1 110px;min-width:0;padding:6px 10px;border-left:1px solid var(--dsh-update-border,#e5e7eb)}",
    ".dsh-upd-strip>div:first-child{border-left:0}",
    ".dsh-upd-strip-k{display:block;font-size:11px;letter-spacing:.14em;opacity:.7}",
    ".dsh-upd-strip-v{font-family:Consolas,Menlo,monospace;font-size:12.5px;word-break:break-all}",
    ".dsh-upd-chapter{margin-top:18px;padding-top:14px;border-top:1px solid var(--dsh-update-border,#e5e7eb)}",
    // 右下角独立 footer 区（#47 定案 A）：与第一章 actions 脱钩，右对齐，一次找到。
    ".dsh-upd-footer{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:14px;padding-top:10px;border-top:1px solid var(--dsh-update-border,#e5e7eb)}",
    ".dsh-upd-foot-note{margin-right:auto;font-size:12px;opacity:.7}",
    ".dsh-upd-footer button{margin:0}",
    ".dsh-upd-chap-head{display:flex;align-items:baseline;gap:10px;margin-bottom:6px}",
    ".dsh-upd-chap-no{font-size:13px;font-style:italic;opacity:.6}",
    ".dsh-upd-chap-title{font-size:14px;margin:0}",
    ".dsh-upd-chap-rule{flex:1;border-top:1px solid var(--dsh-update-border,#e5e7eb);transform:translateY(-3px)}",
    // 03 章标题行右端的开关（问题 3 定案：按钮形态、挪到标题行）。
    ".dsh-upd-chap-note{flex:none;font-size:12px;opacity:.75}",
    ".dsh-upd-chap-note button{margin:0}",
    // 更新队列两行键值（用户定案的设计）：结构两主题共用，皮肤各自收敛。
    ".dsh-upd-qrow{display:flex;align-items:baseline;flex-wrap:wrap;gap:10px;padding:6px 0;min-width:0}",
    ".dsh-upd-qrow+.dsh-upd-qrow{border-top:1px solid var(--dsh-update-border,#e5e7eb)}",
    ".dsh-upd-qdot{width:8px;height:8px;border-radius:50%;flex:none;align-self:center;background:currentColor;opacity:.5}",
    '.dsh-upd-qdot[data-tone="busy"]{background:var(--dsh-update-warn-border,#d97706);opacity:1}',
    '.dsh-upd-qdot[data-tone="you"]{background:var(--dsh-update-primary,#2563eb);opacity:1}',
    ".dsh-upd-qk{flex:none;width:5.5em;font-size:12px;opacity:.7}",
    ".dsh-upd-qv{font-weight:600}",
    ".dsh-upd-qn{margin-left:auto;font-size:12px;opacity:.7}",
    ".dsh-upd-qseq{font-family:Consolas,Menlo,monospace;font-size:12px;word-break:break-all}",
    ".dsh-upd-prog{height:8px;background:var(--dsh-update-border,#e5e7eb);border-radius:4px;overflow:hidden;margin:10px 0 4px}",
    ".dsh-upd-prog-bar{display:block;height:100%;background:var(--dsh-update-primary,#2563eb);transition:width .3s}",
    ".dsh-upd-progtxt{font-size:12.5px;opacity:.75}",
    ".dsh-upd-skipline{font-size:13px;margin-top:8px}",
    // 骨架微光：只在首帧 loading 出现；reduced-motion 下静止占位，不断语义。
    ".dsh-upd-skv{display:inline-block;min-width:64px;border-radius:3px;color:transparent !important;user-select:none;",
    "background:linear-gradient(90deg,var(--dsh-update-border,#e5e7eb) 25%,var(--dsh-update-bg-soft,#f3f4f6) 50%,var(--dsh-update-border,#e5e7eb) 75%);",
    "background-size:200% 100%;animation:dsh-upd-shimmer 1.2s linear infinite}",
    "@keyframes dsh-upd-shimmer{to{background-position:-200% 0}}",
    ".dsh-upd-tag{display:inline-block;border:1px dashed currentColor;border-radius:3px;padding:1px 8px;margin-right:8px;font-family:Consolas,Menlo,monospace;font-size:12px}",
    ".dsh-upd-err{font-size:13px;margin:0 0 6px}",
    // —— 全按钮交互反馈（#36：悬停/按下/过渡/在途忙态；浅深双主题通用写法，不碰上面的既有串）——
    ".dsh-upd button{transition:background-color .15s ease,border-color .15s ease,color .15s ease,transform .06s ease}",
    ".dsh-upd button:hover:not(:disabled){border-color:var(--dsh-update-focus,#2563eb)}",
    '.dsh-upd button[data-primary="1"]:hover:not(:disabled){filter:brightness(.93)}',
    ".dsh-upd button:active:not(:disabled){transform:translateY(1px)}",
    '.dsh-upd button[aria-busy="true"]{cursor:wait;animation:dsh-upd-pulse 1s ease-in-out infinite}',
    "@keyframes dsh-upd-pulse{0%,100%{opacity:1}50%{opacity:.55}}",
    // —— 状态横幅淡入 + 日志折叠格动画（纯 CSS；重绘只发生在真变时；reduced-motion 下静止）——
    ".dsh-upd-banner{animation:dsh-upd-fadein .22s ease}",
    "@keyframes dsh-upd-fadein{from{opacity:.35;transform:translateY(2px)}}",
    ".dsh-upd-changelog-foldbox{display:grid;grid-template-rows:1fr;opacity:1;transition:grid-template-rows .22s ease,opacity .18s ease}",
    ".dsh-upd-changelog-foldbox-inner{min-height:0;overflow:hidden}",
    '.dsh-upd-changelog-foldbox[data-open="0"]{grid-template-rows:0fr;opacity:0}',
    // 在途转圈：纯 CSS ::after，不加 DOM 节点（内核 DOM 冻结）；转的是边框缺口，不是 emoji。
    '.dsh-upd button[aria-busy="true"]::after{content:"";display:inline-block;width:11px;height:11px;margin-left:8px;vertical-align:-1px;',
    "border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:dsh-upd-spin .8s linear infinite}",
    "@keyframes dsh-upd-spin{to{transform:rotate(360deg)}}",
    '@media (prefers-reduced-motion: reduce){.dsh-upd button{transition:none}.dsh-upd button:active:not(:disabled){transform:none}.dsh-upd button[aria-busy="true"]{animation:none}.dsh-upd-skv{animation:none}.dsh-upd-banner{animation:none}.dsh-upd-changelog-foldbox{transition:none}}',
    "@media (forced-colors: active){.dsh-upd-overlay .dsh-upd-body .dsh-upd-chap-head{background:Canvas}}",
    // —— 查新版布局稳定：按钮预留宽度 + 动态区最小高度 + 锚定不漂（只稳布局，不改文案语义）——
    ".dsh-upd{overflow-anchor:none}",
    ".dsh-upd-body{overflow-anchor:none}",
    ".dsh-upd-actions{display:flex;flex-wrap:wrap;align-items:center;min-height:34px}",
    ".dsh-upd-actions button:first-child{min-width:8em;text-align:center}",
    '.dsh-upd-actions button[data-primary="1"]{min-width:7em;text-align:center}',
    '.dsh-upd-actions button:first-child:not([aria-busy="true"])::after{content:"";display:inline-block;width:11px;height:11px;margin-left:8px;visibility:hidden}',
    ".dsh-upd-banner{min-height:1.2em}",
    ".dsh-upd-strip{min-height:48px}",
    // —— 查新版瞬时抖动补强：忙闲两帧同高 + 横幅不动（只追加覆盖，不改上面既有串）——
    ".dsh-upd-actions{align-content:flex-start}",
    ".dsh-upd-actions button{white-space:nowrap}",
    ".dsh-upd-actions button:first-child{min-width:10em}",
    '.dsh-upd-actions button[data-primary="1"]{min-width:9em}',
    ".dsh-upd-banner{min-height:3.4em;display:flex;flex-direction:column;justify-content:center}",
    ".dsh-upd-banner{animation:none}",
    ".dsh-upd-copy{min-height:1.75em}",
    ".dsh-upd-copy--empty{visibility:hidden}",
    "@media (prefers-color-scheme: dark){.dsh-upd{--dsh-update-text:#e5e7eb;--dsh-update-bg:#111827;--dsh-update-border:#374151;",
    "--dsh-update-button-bg:#1f2937;--dsh-update-bg-soft:#1f2937;--dsh-update-primary:#3b82f6;--dsh-update-focus:#93c5fd;",
    // 横幅深色覆盖：底色用低透明度同色系（不是浅色原值），边线提亮，保证「深底浅字」可读。
    "--dsh-update-ok-bg:rgba(16,185,129,.14);--dsh-update-ok-border:#34d399;",
    "--dsh-update-warn-bg:rgba(245,158,11,.16);--dsh-update-warn-border:#fbbf24;",
    "--dsh-update-bad-bg:rgba(239,68,68,.16);--dsh-update-bad-border:#f87171;",
    "--dsh-update-busy-bg:rgba(59,130,246,.16);--dsh-update-busy-border:#60a5fa}}"
  ].join("\n");
  var UPDATE_PANEL_ARCHIVE_CSS = [
    "/* Archive \u6863\u6848\u5377\u53EF\u9009\u4E3B\u9898\uFF1A\u53EA\u6362\u989C\u8272/\u5B57\u4F53/\u95F4\u8DDD\uFF1B\u5185\u6838 DOM \u987A\u5E8F\u4E00\u5B57\u4E0D\u52A8\uFF0C\u4E0D\u65AD\u590D\u5236\u8BCA\u65AD\u3002 */",
    '.dsh-upd[data-theme="archive"]{--dsh-update-bg-soft:#f7f3ea;--dsh-update-bg:#fffdf6;--dsh-update-text:#1a1a1a;--dsh-update-text-muted:#6f675a;',
    "--dsh-update-border:#e3d9c4;--dsh-update-border-strong:#c4b896;--dsh-update-primary:#c8402a;--dsh-update-primary-deep:#9c2e1d;",
    "--dsh-update-ok-text:#1a7f37;--dsh-update-ok-bg:#e9f4ea;--dsh-update-warn-text:#8a5a00;--dsh-update-warn-bg:#fbf0d0;",
    "--dsh-update-bad-text:#b3261e;--dsh-update-bad-bg:#fbe9e5;",
    '--dsh-update-font-serif:Georgia,"Songti SC","STSong","SimSun","Noto Serif CJK SC","Source Han Serif SC",serif;',
    '--dsh-update-font-sans:system-ui,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;',
    '--dsh-update-font-mono:ui-monospace,"SF Mono",SFMono-Regular,Consolas,"Noto Sans Mono",monospace;',
    "--dsh-update-shadow:0 1px 2px rgba(60,40,20,.08),0 12px 32px rgba(60,40,20,.10);",
    "font-family:var(--dsh-update-font-sans);color:var(--dsh-update-text);background:var(--dsh-update-bg);",
    "border:1px solid var(--dsh-update-border-strong);border-radius:var(--dsh-update-radius-panel,4px);box-shadow:var(--dsh-update-shadow)}",
    // 按钮脸自己不透明（宿主底色未知时也读得出；卡片上渲染与 transparent 逐字同色）。
    '.dsh-upd[data-theme="archive"] button{border-color:var(--dsh-update-border-strong);background:var(--dsh-update-button-bg);color:var(--dsh-update-text);border-radius:var(--dsh-update-radius-button,3px);font-family:var(--dsh-update-font-sans)}',
    '.dsh-upd[data-theme="archive"] button:hover:not(:disabled){border-color:var(--dsh-update-primary);color:var(--dsh-update-primary)}',
    '.dsh-upd[data-theme="archive"] button[data-primary="1"]{background:var(--dsh-update-primary);border-color:var(--dsh-update-primary);color:#fff}',
    '.dsh-upd[data-theme="archive"] button[data-primary="1"]:hover:not(:disabled){background:var(--dsh-update-primary-deep);color:#fff}',
    '.dsh-upd[data-theme="archive"] button:focus-visible{outline:2px solid var(--dsh-update-primary);outline-offset:2px}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner{background:var(--dsh-update-bg-soft);border-color:var(--dsh-update-border-strong)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="update"]{border-color:var(--dsh-update-ok-border);background:var(--dsh-update-ok-bg)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="busy"]{border-color:var(--dsh-update-busy-border);background:var(--dsh-update-busy-bg)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="restart"]{border-color:var(--dsh-update-warn-border);background:var(--dsh-update-warn-bg);font-family:var(--dsh-update-font-serif);border-width:2px}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="failed"],.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="blocked"]{border-color:var(--dsh-update-bad-border);background:var(--dsh-update-bad-bg)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="done"]{border-color:var(--dsh-update-ok-border);background:var(--dsh-update-ok-bg)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-changelog-yanked{border-color:var(--dsh-update-warn-text);background:var(--dsh-update-warn-bg);color:var(--dsh-update-text)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-breaking-badge{color:var(--dsh-update-primary);border-color:var(--dsh-update-primary)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-changelog-count{color:var(--dsh-update-text-muted)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-changelog-more-note{color:var(--dsh-update-text-muted)}',
    // —— 大印章（原型 :206 `.seal`：右上 88px、旋转 -7°、双细框；内容与色调来自根属性，不加节点）——
    '.dsh-upd[data-theme="archive"]{position:relative;padding:16px 20px 14px}',
    '.dsh-upd[data-theme="archive"]::before{content:attr(data-seal);position:absolute;top:20px;right:24px;width:88px;height:88px;',
    "display:flex;align-items:center;justify-content:center;text-align:center;letter-spacing:.18em;text-indent:.18em;line-height:1.35;",
    "border:3px solid currentColor;border-radius:14px;transform:rotate(-7deg);font-family:var(--dsh-update-font-serif);font-weight:700;font-size:21px;",
    "background:color-mix(in srgb,currentColor 8%,transparent);user-select:none;pointer-events:none;",
    "box-shadow:inset 0 0 0 5px var(--dsh-update-bg),inset 0 0 0 6px currentColor,0 2px 6px rgba(0,0,0,.12)}",
    '.dsh-upd[data-theme="archive"][data-seal-tone="ink"]::before{color:var(--dsh-update-text-muted)}',
    '.dsh-upd[data-theme="archive"][data-seal-tone="green"]::before{color:var(--dsh-update-ok-text)}',
    '.dsh-upd[data-theme="archive"][data-seal-tone="yellow"]::before{color:var(--dsh-update-warn-text)}',
    '.dsh-upd[data-theme="archive"][data-seal-tone="red"]::before{color:var(--dsh-update-bad-text)}',
    // 印章占位：首行（横幅/状态行）右侧留出 120px，文字不许压到印章上（原型 .filehead padding-right:120px）
    // —— 卷宗抬头（原型 :195-203 的刊头，主题切换按钮按用户口径去掉）：只有 Archive 档案卷才显示 ——
    '.dsh-upd[data-theme="archive"] .dsh-upd-masthead{display:block;padding:0 0 8px;margin:0 0 8px;border-bottom:1px solid var(--dsh-update-border)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-masthead-kicker{display:block;font-size:11px;letter-spacing:.35em;color:var(--dsh-update-text-muted);margin-bottom:3px}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-masthead-title{font-family:var(--dsh-update-font-serif);font-size:26px;font-weight:700;line-height:1.2}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-masthead-title i{color:var(--dsh-update-primary);font-style:normal}',
    // 横幅不再给大印章留 124px：实测（headless 量盒子）印章盒底边 y=109，横幅正文顶边 y=108、
    // 状态行那句在 y=159——印章只压到横幅顶部的留白带，压不到正文。留着反而把 27px 那句话挤成两行
    // （27px 单行需 428px，留白后只剩 366px）。档案头那 120px 保留：那里是真的重叠。
    // —— 更新队列（03 章）Archive 皮肤 ——
    '.dsh-upd[data-theme="archive"] .dsh-upd-qrow{padding:6px 0}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-qk{width:66px;letter-spacing:.18em}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-qv{font-family:var(--dsh-update-font-serif);font-size:16px}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-qn{font-family:var(--dsh-update-font-mono);font-size:11.5px;color:var(--dsh-update-text-muted)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-qseq{color:var(--dsh-update-text-muted)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-chap-note{color:var(--dsh-update-text-muted)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-body .dsh-upd-chap-head{background:var(--dsh-update-bg)}',
    '.dsh-upd-overlay .dsh-upd[data-theme="archive"] .dsh-upd-body{scrollbar-color:var(--dsh-update-border-strong) transparent}',
    '.dsh-upd-overlay .dsh-upd[data-theme="archive"] .dsh-upd-body::-webkit-scrollbar-thumb{background:var(--dsh-update-border-strong)}',
    // —— 小印章（原型 :215 `.sealmini`：30px、旋转 -5°、一字）——
    // 待重启横幅一律不画印章：那一档的标记是左侧手绘 SVG（原型 :446 的 .mark 只有 SVG）。
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="loading"]::before,.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="idle"]::before,',
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="update"]::before,.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="busy"]::before,',
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="blocked"]::before,.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="failed"]::before,',
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="done"]::before{content:attr(data-mini);display:inline-flex;align-items:center;justify-content:center;',
    "width:30px;height:30px;margin-right:10px;vertical-align:middle;border:2px solid currentColor;border-radius:7px;",
    "font-family:var(--dsh-update-font-serif);font-weight:700;font-size:16px;line-height:26px;transform:rotate(-5deg);flex:none;color:var(--dsh-update-text-muted)}",
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="update"]::before{color:var(--dsh-update-ok-text)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="busy"]::before{color:var(--dsh-update-warn-text)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="blocked"]::before,.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="failed"]::before{color:var(--dsh-update-bad-text)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="done"]::before{color:var(--dsh-update-ok-text)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-log code{font-family:var(--dsh-update-font-mono);font-size:11px;color:var(--dsh-update-text-muted);border:1px solid var(--dsh-update-border-strong);border-radius:3px;padding:0 6px;letter-spacing:.06em}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-manual code{display:block;background:var(--dsh-update-text);color:var(--dsh-update-bg-soft);font-family:var(--dsh-update-font-mono);font-size:12.5px;padding:12px 14px;border-radius:4px;white-space:pre-wrap;word-break:break-all}',
    // 待重启标记：手绘 SVG 当**独立 flex 标记**放在文字块左侧（原型 :446 `.mark` 是独立节点），
    // 不能用行内背景——那样换行时三角会落在句子中间把话劈开（现场回归）。
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="restart"]>div:first-child{display:flex;gap:10px;align-items:flex-start}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="restart"]>div:first-child::before{content:"";flex:none;width:20px;height:20px;margin-top:3px;',
    'background:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2720%27 height=%2720%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%238a5a00%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z%27/%3E%3Cline x1=%2712%27 y1=%279%27 x2=%2712%27 y2=%2713%27/%3E%3Cline x1=%2712%27 y1=%2717%27 x2=%2712.01%27 y2=%2717%27/%3E%3C/svg%3E") no-repeat center/20px 20px}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner>div:first-child{overflow:hidden;text-overflow:ellipsis}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-actions{flex-wrap:wrap}',
    // footer 只换肤（#47 定案 A + Archive 约束：不换 DOM 顺序；复制诊断永不隐藏，本串不动它）。
    '.dsh-upd[data-theme="archive"] .dsh-upd-footer{margin-top:14px;padding-top:10px;border-top:1px solid var(--dsh-update-border)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-foot-note{color:var(--dsh-update-text-muted)}',
    // —— 档案头（原型 :208-211 `.filehead`：serif 插件名 22px + 使用范围 + profile 牌；右侧留章位）——
    '.dsh-upd[data-theme="archive"] .dsh-upd-head{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap;padding-right:120px}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-name{font-family:var(--dsh-update-font-serif);font-size:22px;font-weight:700}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-meta{width:100%;font-size:12.5px;color:var(--dsh-update-text-muted)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-meta b{color:var(--dsh-update-text);font-weight:600}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-proftag{font-family:var(--dsh-update-font-mono);font-size:11px;color:var(--dsh-update-text-muted);border:1px solid var(--dsh-update-border-strong);border-radius:3px;padding:0 6px;margin-left:8px;letter-spacing:.06em}',
    // —— 版本条（原型 :216 `.strip`：三格，格间一线，左上小写标签 + 等宽值）——
    '.dsh-upd[data-theme="archive"] .dsh-upd-strip{display:flex;flex-wrap:wrap;margin:8px 0 0;border:1px solid var(--dsh-update-border);border-radius:4px;overflow:hidden;font-size:12.5px}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-strip>div{flex:1 1 120px;padding:6px 10px;border-left:1px solid var(--dsh-update-border)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-strip>div:first-child{border-left:0}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-strip-k{display:block;font-size:11px;letter-spacing:.2em;color:var(--dsh-update-text-muted)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-strip-v{font-family:var(--dsh-update-font-mono);font-size:13px}',
    // —— 章节（原型 :218-245：01–05 编号 + 衬线标题 + 细线）——
    '.dsh-upd[data-theme="archive"] .dsh-upd-chapter{margin-top:16px;padding-top:10px;border-top:1px solid var(--dsh-update-border)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-chap-head{display:flex;align-items:baseline;gap:12px;margin-bottom:6px}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-chap-no{font-family:var(--dsh-update-font-serif);font-style:italic;font-size:15px;color:var(--dsh-update-text-muted)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-chap-title{font-family:var(--dsh-update-font-serif);font-size:17px;margin:0;letter-spacing:.1em}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-chap-rule{flex:1;border-top:1px solid var(--dsh-update-border);transform:translateY(-4px)}',
    // —— 横幅即状态行 / 待重启横幅（原型 :81-85 `.restart-banner`：2px 边框、圆角 4、内边距 12/16、衬线；右侧留章位）——
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner{border:2px solid var(--dsh-update-border-strong);border-radius:4px;padding:10px 12px;font-size:14.5px;font-family:var(--dsh-update-font-serif);display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner>div:first-child{flex:1 1 auto;min-width:0}',
    // 状态行字号照原型 .status-line=27px（实测去掉横幅右侧占位后可写 486px > 428px，一行放得下）
    '.dsh-upd[data-theme="archive"] .dsh-upd-banner>div:first-child strong{font-family:var(--dsh-update-font-serif);font-size:27px;font-weight:700;line-height:1.25}',
    // —— 进度条 / 跳过行（原型 :132-133 `.prog`、:129-131 `.skipline .tag`）——
    '.dsh-upd[data-theme="archive"] .dsh-upd-prog{height:8px;background:var(--dsh-update-border);border-radius:4px;overflow:hidden;margin:10px 0 4px}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-prog-bar{display:block;height:100%;background:var(--dsh-update-primary);transition:width .3s}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-progtxt{font-size:12.5px;color:var(--dsh-update-text-muted)}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-skipline{font-size:13px;margin-top:8px}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-tag{display:inline-block;border:1px dashed var(--dsh-update-border-strong);border-radius:3px;padding:1px 8px;margin-right:8px;font-family:var(--dsh-update-font-mono);font-size:12px}',
    '.dsh-upd[data-theme="archive"] .dsh-upd-err{font-size:13px;margin:0 0 6px;color:var(--dsh-update-text-muted)}',
    '@media (max-width:640px){.dsh-upd[data-theme="archive"]{padding:10px 12px}.dsh-upd[data-theme="archive"]::before{top:12px;right:12px;width:56px;height:56px;font-size:15px;box-shadow:inset 0 0 0 4px var(--dsh-update-bg),inset 0 0 0 5px currentColor}.dsh-upd[data-theme="archive"] .dsh-upd-masthead-title{font-size:19px}.dsh-upd[data-theme="archive"] .dsh-upd-banner{padding-right:16px}.dsh-upd[data-theme="archive"] .dsh-upd-banner::before{width:24px;height:24px;font-size:14px;line-height:20px;flex:none}.dsh-upd[data-theme="archive"] .dsh-upd-banner>div:first-child{white-space:normal}}',
    '@media (prefers-color-scheme: dark){.dsh-upd[data-theme="archive"]{--dsh-update-bg-soft:#141210;--dsh-update-bg:#1e1a15;--dsh-update-text:#ece5d3;--dsh-update-text-muted:#a89c83;',
    "--dsh-update-border:#3a3226;--dsh-update-border-strong:#5c4e3b;--dsh-update-primary:#e0684e;--dsh-update-primary-deep:#f0866b;",
    "--dsh-update-ok-text:#8fd6a4;--dsh-update-ok-bg:rgba(80,180,120,.12);--dsh-update-warn-text:#e8c15a;--dsh-update-warn-bg:rgba(232,193,90,.12);",
    "--dsh-update-bad-text:#ef8a7d;--dsh-update-bad-bg:rgba(239,138,125,.12);--dsh-update-shadow:0 1px 2px rgba(0,0,0,.4),0 12px 32px rgba(0,0,0,.45)}}",
    '@media (prefers-color-scheme: dark){.dsh-upd[data-theme="archive"] button[data-primary="1"]{color:#141210}.dsh-upd[data-theme="archive"] button:focus-visible{outline-color:var(--dsh-update-primary-deep)}}',
    '@media (prefers-color-scheme: dark){.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="restart"]>div:first-child::before{background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2720%27 height=%2720%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23e8c15a%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z%27/%3E%3Cline x1=%2712%27 y1=%279%27 x2=%2712%27 y2=%2713%27/%3E%3Cline x1=%2712%27 y1=%2717%27 x2=%2712.01%27 y2=%2717%27/%3E%3C/svg%3E")}}',
    '@media (forced-colors: active){.dsh-upd[data-theme="archive"]{box-shadow:none}.dsh-upd[data-theme="archive"]::before{background:none;box-shadow:none;border-color:CanvasText;color:CanvasText}.dsh-upd[data-theme="archive"] .dsh-upd-banner{border:1px solid CanvasText}.dsh-upd[data-theme="archive"] .dsh-upd-banner::before{border-color:CanvasText;color:CanvasText;background:Canvas}.dsh-upd[data-theme="archive"] button{border:1px solid ButtonText}.dsh-upd[data-theme="archive"] button[data-primary="1"]{background:ButtonFace;color:ButtonText;border-color:ButtonText}.dsh-upd[data-theme="archive"] .dsh-upd-banner[data-kind="restart"]>div:first-child::before{background-image:none;content:"\u26A0"}}',
    '@media (prefers-reduced-motion: reduce){.dsh-upd[data-theme="archive"] *{transition:none !important;animation:none !important}}'
  ].join("\n");
  function escapeHtml2(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  var CHAPTER_KEYS = [
    "panel.chapter.check",
    "panel.chapter.changelog",
    "panel.chapter.queue",
    "panel.chapter.error",
    "panel.chapter.manual"
  ];
  function chapterTitle(index, lang) {
    const l = normalizeLangTag(lang ?? "zh");
    return copyText(CHAPTER_KEYS[index - 1], l);
  }
  function formatLatchTime(atMs, lang) {
    if (typeof atMs !== "number" || !Number.isFinite(atMs) || atMs <= 0) return null;
    const raw = typeof lang === "string" ? lang.trim().replace(/_/g, "-") : "";
    const l = normalizeLangTag(lang ?? "zh");
    const primary = l === "en" ? "en-US" : "zh-CN";
    const fallback = l === "en" ? "zh-CN" : "en-US";
    const candidates = [];
    if (raw && raw !== primary && /^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/.test(raw)) candidates.push(raw);
    candidates.push(primary, fallback);
    for (const tag of candidates) {
      try {
        const s = new Date(atMs).toLocaleTimeString(tag, { hour12: false });
        if (s) return s;
      } catch {
      }
    }
    return null;
  }
  function chapterOf(index, inner, note = "", lang) {
    const no = String(index).padStart(2, "0");
    const l = normalizeLangTag(lang ?? "zh");
    const title = chapterTitle(index, l);
    return `<section class="dsh-upd-chapter" data-chapter="${no}"><div class="dsh-upd-chap-head"><span class="dsh-upd-chap-no">${no}</span><h3 class="dsh-upd-chap-title">${escapeHtml2(title)}</h3><span class="dsh-upd-chap-rule"></span>${note}</div>${inner}</section>`;
  }
  function skeletonStrip(loading, lang) {
    if (!loading) return "";
    const l = normalizeLangTag(lang ?? "zh");
    const cell = (k) => `<div><span class="dsh-upd-strip-k">${escapeHtml2(k)}</span><span class="dsh-upd-strip-v dsh-upd-skv" aria-hidden="true">\u2026</span></div>`;
    return `<div class="dsh-upd-strip" aria-hidden="true">` + cell(copyText("panel.strip.running", l)) + cell(copyText("panel.strip.installed", l)) + cell(copyText("panel.strip.latest", l)) + `</div>`;
  }
  function versionStrip(snapshot, lang) {
    const l = normalizeLangTag(lang ?? "zh");
    const unknown = copyText("panel.meta.unknown", l);
    const cell = (k, v) => `<div><span class="dsh-upd-strip-k">${escapeHtml2(k)}</span><span class="dsh-upd-strip-v">${escapeHtml2(v ?? unknown)}</span></div>`;
    if (!snapshot) return "";
    return `<div class="dsh-upd-strip">` + cell(copyText("panel.strip.running", l), snapshot.runningVersion) + cell(copyText("panel.strip.installed", l), snapshot.installedVersion) + cell(copyText("panel.strip.latest", l), snapshot.latestVersion) + `</div>`;
  }
  function progressBar(snapshot, lang) {
    const job = snapshot?.job;
    if (!job) return "";
    const state = String(job.state);
    if (state !== "installing" && state !== "verifying") return "";
    const l = normalizeLangTag(lang ?? "zh");
    const width = state === "installing" ? 60 : 90;
    const text = state === "installing" ? copyText("panel.progress.installing", l) : copyText("panel.progress.verifying", l);
    return `<div class="dsh-upd-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${width}"><i class="dsh-upd-prog-bar" style="width:${width}%"></i></div><div class="dsh-upd-progtxt">${escapeHtml2(text)}</div>`;
  }
  function renderUpdatePanelKernel(input, view, lang) {
    const { snapshot, manual, queue, mode, showOthers, pluginId, copyNotice } = input;
    const l = normalizeLangTag(lang ?? input.lang ?? "zh");
    const changelogMarkdown = input.changelogMarkdown ?? null;
    const profileName = typeof input.profileName === "string" && input.profileName ? input.profileName : null;
    const b = view.banner;
    const seal = view.seal;
    const parts = [];
    parts.push(
      '<div class="dsh-upd-masthead"><span class="dsh-upd-masthead-kicker">' + escapeHtml2(copyText("panel.masthead.kicker", l)) + '</span><span class="dsh-upd-masthead-title">' + escapeHtml2(copyText("panel.masthead.title", l)) + " <i>" + escapeHtml2(copyText("panel.masthead.volume", l)) + "</i></span></div>"
    );
    parts.push(
      `<div class="dsh-upd-head"><span class="dsh-upd-name">${escapeHtml2(pluginId)}</span><span class="dsh-upd-meta">${escapeHtml2(copyText("panel.meta.label", l))} <b>${escapeHtml2(profileName ?? copyText("panel.meta.unknown", l))}</b><span class="dsh-upd-proftag">profile</span></span></div>`
    );
    parts.push(`<div class="dsh-upd-banner" data-kind="${b.kind}" data-mini="${escapeHtml2(seal.mini)}" role="status" aria-live="polite">`);
    parts.push(`<div><strong>${escapeHtml2(b.title)}</strong></div>`);
    if (b.action) parts.push(`<div>${escapeHtml2(b.action)}</div>`);
    parts.push("</div>");
    parts.push(snapshot ? versionStrip(snapshot, l) : skeletonStrip(view.banner.kind === "loading", l));
    const showActions = input.actions !== "none";
    const actions = [];
    if (showActions) {
      const busyAct = input.busyAct;
      const checkBusy = busyAct === "check";
      const installBusy = busyAct === "install";
      actions.push('<div class="dsh-upd-actions">');
      actions.push(
        (checkBusy ? `<button type="button" data-action="check" disabled aria-busy="true" title="${escapeHtml2(copyText("panel.action.checking-busy-title", l))}">${escapeHtml2(copyText("panel.action.checking-busy", l))}</button>` : `<button type="button" data-action="check" title="${escapeHtml2(copyText("panel.action.check-title", l))}">${escapeHtml2(copyText("panel.action.check", l))}</button>`) + (installBusy ? `<button type="button" data-action="install" data-primary="1" disabled aria-busy="true" title="${escapeHtml2(copyText("panel.action.installing-busy-title", l))}">${escapeHtml2(copyText("panel.action.installing-busy", l))}</button>` : `<button type="button" data-action="install" data-primary="1" title="${escapeHtml2(copyText("panel.action.install-title", l))}"${view.installEnabled ? "" : " disabled"}>${escapeHtml2(view.installLabel)}</button>`)
      );
      if (snapshot?.latestVersion && !view.skippedLatest && view.banner.kind === "update") {
        actions.push(`<button type="button" data-action="skip" title="${escapeHtml2(copyText("panel.action.skip-title", l))}">${escapeHtml2(copyText("panel.action.skip", l))}</button>`);
      }
      if (view.showReset && snapshot?.latestVersion) {
        actions.push(`<button type="button" data-action="reset-skip" title="${escapeHtml2(copyText("panel.action.unskip-title", l))}">${escapeHtml2(copyText("panel.action.unskip", l, { version: snapshot.latestVersion }))}</button>`);
      }
      if (view.showManual && manual) {
        actions.push(`<button type="button" data-action="copy-manual" title="${escapeHtml2(copyText("panel.action.copy-manual-title", l))}">${escapeHtml2(copyText("panel.action.copy-manual", l))}</button>`);
      }
      if (b.kind === "restart") {
        actions.push(`<button type="button" data-action="restart-hint" data-primary="1" title="${escapeHtml2(copyText("panel.action.restart-host-title", l))}">${escapeHtml2(copyText("panel.action.restart-host", l))}</button>`);
      }
      if (b.kind === "failed") {
        actions.push(`<button type="button" data-action="dismiss-failure" title="${escapeHtml2(copyText("panel.action.dismiss-title", l))}">${escapeHtml2(copyText("panel.action.dismiss", l))}</button>`);
      }
      if (snapshot) {
        actions.push(`<button type="button" data-action="copy-diag" title="${escapeHtml2(copyText("panel.action.copy-diag-title", l))}">${escapeHtml2(copyText("panel.action.copy-diag", l))}</button>`);
      }
      actions.push("</div>");
    }
    actions.push(progressBar(snapshot, l));
    if (view.skippedLatest && snapshot?.latestVersion) {
      actions.push(
        `<div class="dsh-upd-skipline"><span class="dsh-upd-tag">${escapeHtml2(copyText("panel.skip.line-tag", l, { version: snapshot.latestVersion }))}</span>${escapeHtml2(copyText("panel.skip.line-note", l))}</div>`
      );
    }
    const chapters = [];
    chapters.push(chapterOf(1, actions.join(""), "", l));
    {
      let inner = "";
      let hasLog = false;
      if (snapshot && snapshot.latestVersion) {
        try {
          const mdText = typeof changelogMarkdown === "string" ? changelogMarkdown : "";
          const entries2 = parseChangelog(mdText);
          const ranged = changelogForUpdate(
            entries2,
            snapshot.runningVersion,
            snapshot.latestVersion,
            snapshot.installedVersion
          );
          const changelogHTML = renderChangelogHTML(ranged, { lang: l });
          const fromText = String(snapshot.runningVersion ?? "");
          const toText = String(snapshot.latestVersion ?? "");
          const rangeTitle = fromText && toText ? copyText("panel.changelog.heading-range", l, { from: fromText, to: toText }) : copyText("panel.changelog.heading", l);
          let yankedBanner = "";
          try {
            const toEntry = Array.isArray(ranged) ? ranged.find(function(e) {
              try {
                return e && e.version === toText;
              } catch {
                return false;
              }
            }) : null;
            if (toEntry && toEntry.yanked === true && toText) {
              yankedBanner = yankedBannerHTML(toText, l);
            }
          } catch {
            yankedBanner = "";
          }
          const logOpen = input.changelogCollapsed !== true;
          inner = `<div class="dsh-upd-changelog-wrap"><div>${escapeHtml2(rangeTitle)}</div><div class="dsh-upd-changelog-foldbox" data-open="${logOpen ? "1" : "0"}"><div class="dsh-upd-changelog-foldbox-inner">${yankedBanner}
${changelogHTML}
</div></div></div>`;
          hasLog = Array.isArray(ranged) && ranged.length > 0;
        } catch {
          inner = "";
        }
      }
      if (!inner) {
        inner = `<div class="dsh-upd-changelog-wrap"><div class="dsh-upd-changelog-neutral">${escapeHtml2(
          snapshot && snapshot.latestVersion ? copyText("panel.changelog.unavailable", l) : copyText("panel.changelog.unavailable-empty", l)
        )}</div></div>`;
      }
      const logCollapsed = input.changelogCollapsed === true;
      const logNote = showActions && hasLog ? '<span class="dsh-upd-chap-note"><button type="button" data-action="toggle-changelog" title="' + escapeHtml2(copyText("panel.changelog.toggle-title", l)) + `">${escapeHtml2(logCollapsed ? copyText("panel.changelog.expand", l) : copyText("panel.changelog.collapse", l))}</button></span>` : "";
      chapters.push(chapterOf(2, inner, logNote, l));
    }
    {
      const queued = !!queue && (queue.busy || queue.waiting.length > 0);
      if (queued && queue) {
        const busy = queue.busy;
        const ownerRaw = queue.owner;
        const named = ownerRaw && "pluginId" in ownerRaw && ownerRaw.pluginId ? String(ownerRaw.pluginId) : null;
        const version = ownerRaw && "targetVersion" in ownerRaw && ownerRaw.targetVersion ? `@${String(ownerRaw.targetVersion)}` : "";
        const aboutSelf = named !== null && named === pluginId;
        const reveal = showOthers === true;
        const ownerShown = !busy ? copyText("panel.queue.state-idle", l) : named === null ? copyText("panel.queue.other", l) : aboutSelf ? copyText("panel.queue.self", l) : reveal ? named : copyText("panel.queue.other", l);
        const ownerVer = busy && named !== null && (aboutSelf || reveal) ? version : "";
        const pos = typeof queue.position === "number" ? queue.position : null;
        const posText = pos === null ? copyText("panel.queue.pos-absent", l) : copyText("panel.queue.pos-n", l, { n: pos });
        const posNote = pos === null ? "" : pos === 1 ? copyText("panel.queue.pos-next", l) : copyText("panel.queue.pos-ahead", l, { n: pos - 1 });
        const rows = [
          `<div class="dsh-upd-qrow"><span class="dsh-upd-qdot" data-tone="${busy ? "busy" : "idle"}"></span><span class="dsh-upd-qk">${escapeHtml2(copyText("panel.queue.row-installing", l))}</span><span class="dsh-upd-qv">${escapeHtml2(ownerShown + ownerVer)}</span><span class="dsh-upd-qn">${escapeHtml2(busy ? copyText("panel.queue.row-installing-note", l) : copyText("panel.queue.row-idle-note", l))}</span></div>`,
          `<div class="dsh-upd-qrow"><span class="dsh-upd-qdot" data-tone="you"></span><span class="dsh-upd-qk">${escapeHtml2(copyText("panel.queue.row-position", l))}</span><span class="dsh-upd-qv">${escapeHtml2(posText)}</span><span class="dsh-upd-qn">${escapeHtml2(posNote)}</span></div>`
        ];
        if (reveal && queue.waiting.length > 0) {
          const seq = queue.waiting.map((e) => `${e.pluginId}${e.targetVersion ? `@${e.targetVersion}` : ""}`).join(" \u2192 ");
          rows.push(
            `<div class="dsh-upd-qrow"><span class="dsh-upd-qdot"></span><span class="dsh-upd-qk">${escapeHtml2(copyText("panel.queue.row-order", l))}</span><span class="dsh-upd-qseq">${escapeHtml2(seq)}</span></div>`
          );
        }
        const note = showActions ? `<span class="dsh-upd-chap-note"><button type="button" data-action="toggle-queue">${escapeHtml2(reveal ? copyText("panel.queue.toggle-hide", l) : copyText("panel.queue.toggle-show", l))}</button></span>` : "";
        chapters.push(chapterOf(3, `<div class="dsh-upd-queue">${rows.join("")}</div>`, note, l));
      } else {
        chapters.push(
          chapterOf(
            3,
            `<div class="dsh-upd-queue"><div class="dsh-upd-changelog-neutral">${escapeHtml2(
              view.queueNote ?? copyText("panel.queue.empty", l)
            )}</div></div>`,
            "",
            l
          )
        );
      }
    }
    {
      const errLines = [];
      const failedNow = b.kind === "failed" || b.kind === "blocked";
      const failRef = input.failure;
      if (failedNow) {
        const shownCode = b.kind === "blocked" ? snapshot?.blockedReason ?? b.kind : typeof input.lastError === "string" && input.lastError.trim() ? input.lastError : "install-failed";
        errLines.push(
          `<div class="dsh-upd-err">${escapeHtml2(copyText("panel.error.code-label", l))} <code>${escapeHtml2(String(shownCode))}</code>${l === "en" ? ":" : "\uFF1A"}${escapeHtml2(copyText("panel.error.code-note", l))}</div>`
        );
        if (b.kind === "failed" && failRef) {
          const keys = [];
          if (typeof failRef.requestId === "string" && failRef.requestId) keys.push(`${escapeHtml2(copyText("panel.error.query-request", l))} <code>${escapeHtml2(failRef.requestId)}</code>`);
          if (typeof failRef.checkId === "string" && failRef.checkId) keys.push(`${escapeHtml2(copyText("panel.error.query-check", l))} <code>${escapeHtml2(failRef.checkId)}</code>`);
          const at = formatLatchTime(failRef.atMs, input.lang ?? l);
          if (at) keys.push(`${escapeHtml2(copyText("panel.error.failed-at", l, { time: at }))}`);
          if (keys.length > 0) {
            errLines.push(`<div class="dsh-upd-err">${copyText("panel.error.query-keys", l, { keys: keys.join(" \xB7 ") })}</div>`);
          }
          if (!failRef.volatile) {
            errLines.push(
              `<div class="dsh-upd-err">${escapeHtml2(copyText("panel.error.evidence-frozen", l))}</div>`
            );
          } else {
            errLines.push(
              `<div class="dsh-upd-err">${escapeHtml2(copyText("panel.error.evidence-transient", l))}</div>`
            );
          }
        }
      } else {
        errLines.push(`<div class="dsh-upd-changelog-neutral">${escapeHtml2(copyText("panel.error.no-failure", l))}</div>`);
      }
      if (input.showLogHint !== false) {
        errLines.push(
          `<div class="dsh-upd-log">${copyText("panel.error.log-hint", l, {
            pluginId: `<code>${escapeHtml2(pluginId)}</code>`,
            e1: `<code>${LOG_EVENT_CALL}</code>`,
            e2: `<code>${LOG_EVENT_CALL_FAIL}</code>`,
            e3: `<code>${LOG_EVENT_INSTALL_EXEC}</code>`
          })}</div>`
        );
        if (b.kind === "failed" && failRef && (failRef.requestId || failRef.checkId)) {
          errLines.push(
            `<div class="dsh-upd-log">${copyText("panel.error.log-follow", l, {
              eFail: `<code>${LOG_EVENT_CALL_FAIL}</code>`,
              eCall: `<code>${LOG_EVENT_CALL}</code>`,
              eExec: `<code>${LOG_EVENT_INSTALL_EXEC}</code>`
            })}</div>`
          );
        }
      }
      if (copyNotice) errLines.push(`<div class="dsh-upd-copy" role="status">${escapeHtml2(copyNotice)}</div>`);
      else errLines.push('<div class="dsh-upd-copy dsh-upd-copy--empty" aria-hidden="true"></div>');
      chapters.push(chapterOf(4, errLines.join(""), "", l));
    }
    chapters.push(
      chapterOf(
        5,
        view.showManual && manual ? `<div class="dsh-upd-manual"><div>${escapeHtml2(copyText("panel.manual.heading", l))}</div><code>${escapeHtml2(manual)}</code></div>` : `<div class="dsh-upd-manual"><div class="dsh-upd-changelog-neutral">${escapeHtml2(copyText("panel.manual.absent", l))}</div></div>`,
        "",
        l
      )
    );
    parts.push('<div class="dsh-upd-body">' + chapters.join("\n") + "</div>");
    if (showActions && mode === "dialog") {
      parts.push(
        '<div class="dsh-upd-footer"><span class="dsh-upd-foot-note">' + escapeHtml2(copyText("panel.footer.note", l)) + `</span><button type="button" data-action="close-view" title="${escapeHtml2(copyText("panel.footer.close-title", l))}">${escapeHtml2(copyText("panel.footer.close", l))}</button></div>`
      );
    }
    return parts.join("\n");
  }
  function renderUpdatePanelHTML(input, lang) {
    const l = normalizeLangTag(lang ?? input.lang ?? "zh");
    const view = panelViewModel(input, l);
    const kernel = renderUpdatePanelKernel(input, view, l);
    const archive = normalizePanelTheme(input.theme) === "archive";
    const attr = archive ? ' data-theme="archive"' : "";
    const tokensStyle = themeTokensStyleFor(input.themeTokens ?? void 0);
    const tokensAttr = tokensStyle ? ` style="${tokensStyle}"` : "";
    const sealAttr = ` data-seal="${escapeHtml2(view.seal.text)}" data-seal-tone="${view.seal.tone}"`;
    const body = input.mode === "dialog" ? `<div class="dsh-upd-overlay" data-mode="dialog"><div class="dsh-upd" data-mode="dialog" data-plugin="${escapeHtml2(input.pluginId)}"${sealAttr}${attr}${tokensAttr}>
${kernel}
</div></div>` : `<div class="dsh-upd" data-mode="embedded" data-plugin="${escapeHtml2(input.pluginId)}"${sealAttr}${attr}${tokensAttr}>
${kernel}
</div>`;
    const css = archive ? `${UPDATE_PANEL_CSS}
${UPDATE_PANEL_ARCHIVE_CSS}` : UPDATE_PANEL_CSS;
    return `<style>${css}</style>
${body}`;
  }
  var PANEL_FAILURE_LATCHES = /* @__PURE__ */ new Map();
  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function asSnapshot(value) {
    if (!isObject(value)) return null;
    const s = value;
    if (typeof s["runningVersion"] !== "string") return null;
    if (typeof s["canInstall"] !== "boolean") return null;
    return value;
  }
  function asQueue(value) {
    if (!isObject(value) || typeof value["busy"] !== "boolean") return null;
    return value;
  }
  function randomRequestId() {
    try {
      const rand = Math.floor(Math.random() * 16777215).toString(36);
      return `r${Date.now().toString(36)}${rand}`.slice(0, 64);
    } catch {
      return `r${Date.now()}`;
    }
  }
  function getTimer() {
    const g = globalThis;
    const set = g["setInterval"];
    const clear = g["clearInterval"];
    if (typeof set === "function" && typeof clear === "function") {
      return {
        set: (fn, ms) => set(fn, ms),
        clear: (h) => clear(h)
      };
    }
    const setT = g["setTimeout"];
    const clearT = g["clearTimeout"];
    return {
      set: (fn, ms) => setT(fn, ms),
      clear: (h) => clearT(h)
    };
  }
  async function defaultCopyText(text) {
    try {
      const holder = globalThis["navigator"];
      const clip = holder?.clipboard;
      const write = clip?.writeText;
      if (clip && typeof write === "function") {
        await write.call(clip, text);
        return;
      }
    } catch {
    }
  }
  function pendingAutoCheck(snapshot, busyAct) {
    if (busyAct === "check" || busyAct === "install") return false;
    if (!snapshot) return false;
    const st = snapshot?.job?.state;
    if (st === "installing" || st === "verifying") return false;
    return true;
  }
  function mountUpdatePanel(container, options) {
    if (!container || typeof container.innerHTML !== "string") {
      throw new Error("[dsh-plugin-update] \u6302\u8F7D\u9762\u677F\u9700\u8981\u4E00\u4E2A\u6709 innerHTML \u7684\u5BB9\u5668");
    }
    if (!options || typeof options !== "object") {
      throw new Error("[dsh-plugin-update] \u6302\u8F7D\u9762\u677F\u7F3A\u5C11\u914D\u7F6E\uFF1A\u63D2\u4EF6\u6807\u8BC6 pluginId \u5FC5\u586B");
    }
    const pluginId = options.pluginId;
    if (typeof pluginId !== "string" || !pluginId) {
      throw new Error(`[dsh-plugin-update] \u63D2\u4EF6\u6807\u8BC6 pluginId \u5FC5\u586B\uFF1A\u987B\u4E3A\u975E\u7A7A\u5B57\u7B26\u4E32\uFF08\u6536\u5230 ${JSON.stringify(pluginId)}\uFF09`);
    }
    if (typeof options.call !== "function") {
      throw new Error("[dsh-plugin-update] \u6302\u8F7D\u9762\u677F\u9700\u8981\u4F20\u8F93\u51FD\u6570 call\uFF08\u9762\u677F\u8C03\u5BBF\u4E3B\u7535\u8BDD\u7684\u552F\u4E00\u63A5\u89E6\u9762\uFF09");
    }
    const prefix = options.prefix === void 0 ? "wf" : options.prefix;
    const phoneNames = buildPhoneNames(prefix);
    const changelogPhone = buildChangelogPhoneName(prefix);
    const autoChangelogEnabled = typeof options.changelogMarkdown !== "string" && options.autoChangelog !== false;
    let manualChangelogOverride = typeof options.changelogMarkdown === "string";
    const changelogCache = /* @__PURE__ */ new Map();
    const changelogInflight = /* @__PURE__ */ new Set();
    const changelogFailedAt = /* @__PURE__ */ new Map();
    let autoSeq = 0;
    const pollMs = options.pollMs === void 0 ? DEFAULT_PANEL_POLL_MS : options.pollMs;
    if (typeof pollMs !== "number" || !Number.isFinite(pollMs) || pollMs < MIN_PANEL_POLL_MS) {
      throw new Error(`[dsh-plugin-update] \u9762\u677F\u8F6E\u8BE2\u95F4\u9694\u975E\u6CD5\uFF1A\u4E0D\u5F97\u5C0F\u4E8E 250 \u6BEB\u79D2\uFF08\u6536\u5230 ${JSON.stringify(options.pollMs)}\uFF09`);
    }
    let mode = options.mode ?? "embedded";
    if (mode !== "embedded" && mode !== "dialog") {
      throw new Error(`[dsh-plugin-update] \u6446\u653E\u5F62\u6001\u975E\u6CD5\uFF1A\u53EA\u6536 embedded \u6216 dialog\uFF08\u6536\u5230 ${JSON.stringify(options.mode)}\uFF09`);
    }
    if (options.theme !== void 0 && options.theme !== "default" && options.theme !== "archive") {
      throw new Error(`[dsh-plugin-update] \u4E3B\u9898\u975E\u6CD5\uFF1A\u53EA\u6536 default \u6216 archive\uFF08\u6536\u5230 ${JSON.stringify(options.theme)}\uFF09`);
    }
    let theme = normalizePanelTheme(options.theme ?? "default");
    themeTokensStyleFor(options.themeTokens ?? void 0);
    let themeTokens = options.themeTokens;
    const localeOpt = options.locale ?? void 0;
    if (localeOpt !== void 0 && localeOpt !== null) {
      const isStr = typeof localeOpt === "string";
      const isObj = typeof localeOpt === "object" && typeof localeOpt.getActive === "function";
      if (!isStr && !isObj) {
        throw new Error("[dsh-plugin-update] invalid locale: expected zh / en / BCP47 or { getActive(), subscribe? }");
      }
      if (isStr && !localeOpt.trim()) {
        throw new Error("[dsh-plugin-update] invalid locale: empty string");
      }
    }
    function currentLang() {
      return resolveLang(localeOpt);
    }
    let showOthers = options.showOthers === true;
    let changelogCollapsed = false;
    const call = options.call;
    const onRestartRequested = options.onRestartRequested;
    const onCloseRequested = typeof options.onCloseRequested === "function" ? options.onCloseRequested : null;
    let lastHTML = "";
    const copyTextOut = options.copyText ?? defaultCopyText;
    const skipStore = options.skipStore ?? createBrowserSkipStore(pluginId);
    const hostKind = typeof options.hostKind === "string" && options.hostKind ? options.hostKind : null;
    const profileNameOption = typeof options.profileName === "string" && options.profileName ? options.profileName : null;
    const showLogHintOption = options.showLogHint !== false;
    const diagCopyFormat = options.diagCopyFormat === "line" ? "line" : "block";
    let changelogMarkdown = typeof options.changelogMarkdown === "string" ? options.changelogMarkdown : null;
    let snapshot = null;
    let manual = null;
    let queue = null;
    let receipt = null;
    let requestId = null;
    const latchKey = `${pluginId}${profileNameOption ?? ""}`;
    let latch = null;
    try {
      latch = PANEL_FAILURE_LATCHES.get(latchKey) ?? null;
      if (latch?.volatile) latch = null;
    } catch {
      latch = null;
    }
    function saveLatch() {
      try {
        if (latch && !latch.volatile) {
          if (!PANEL_FAILURE_LATCHES.has(latchKey) && PANEL_FAILURE_LATCHES.size >= 100) {
            const oldest = PANEL_FAILURE_LATCHES.keys().next();
            if (!oldest.done) PANEL_FAILURE_LATCHES.delete(oldest.value);
          }
          PANEL_FAILURE_LATCHES.set(latchKey, latch);
        } else PANEL_FAILURE_LATCHES.delete(latchKey);
      } catch {
      }
    }
    function latchNow() {
      try {
        const n = Date.now();
        return Number.isFinite(n) ? n : null;
      } catch {
        return null;
      }
    }
    function setLatch(next) {
      latch = next;
      saveLatch();
    }
    function clearLatch() {
      if (!latch) return;
      latch = null;
      saveLatch();
    }
    function currentEnvPair() {
      return { hostKind: hostKind ?? envHostKind, profileName: profileNameOption ?? envProfileName };
    }
    function latchFromReply(reply, source) {
      const env = currentEnvPair();
      return {
        code: failureCodeOf(
          { error: reply["error"], errorKind: reply["errorKind"] },
          source === "install" ? "install-failed" : "check-failed"
        ),
        kind: typeof reply["errorKind"] === "string" && reply["errorKind"].trim() ? reply["errorKind"].trim() : null,
        detail: null,
        diag: Object.prototype.hasOwnProperty.call(reply, "diag") ? reply["diag"] : null,
        requestId: source === "install" ? requestId : null,
        checkId: source === "install" ? receipt?.checkId ?? null : null,
        runningVersion: snapshot?.runningVersion ?? null,
        installedVersion: snapshot?.installedVersion ?? null,
        latestVersion: snapshot?.latestVersion ?? null,
        hostKind: env.hostKind,
        profileName: env.profileName,
        source,
        volatile: false,
        jobId: null,
        atMs: latchNow()
      };
    }
    function latchFromJob(job, snap) {
      const env = currentEnvPair();
      const message = typeof job.message === "string" ? job.message : null;
      const detail = message && message.includes(":") ? message.slice(message.indexOf(":") + 1).trim() || null : message;
      return {
        code: messageCodeOf(message) || "install-failed",
        kind: null,
        detail,
        // 快照里没有 diag：保留锁存里既有的（多半是致命安装回包自带的），没有即缺省说人话
        diag: latch?.diag ?? null,
        requestId: job.requestId ?? latch?.requestId ?? requestId,
        checkId: receipt?.checkId ?? latch?.checkId ?? null,
        runningVersion: snap?.runningVersion ?? snapshot?.runningVersion ?? null,
        installedVersion: snap?.installedVersion ?? snapshot?.installedVersion ?? null,
        latestVersion: snap?.latestVersion ?? snapshot?.latestVersion ?? null,
        hostKind: env.hostKind ?? latch?.hostKind ?? null,
        profileName: env.profileName ?? latch?.profileName ?? null,
        source: "install",
        volatile: false,
        jobId: typeof job.id === "string" ? job.id : null,
        atMs: latchNow()
      };
    }
    function thrownDetail(err) {
      try {
        const raw = err instanceof Error ? err.message : typeof err === "string" ? err : null;
        if (typeof raw !== "string") return null;
        const t = raw.trim();
        if (!t) return null;
        if (/^[a-z][a-z-]*$/.test(t) && t.length <= 32) return null;
        return redactForCopy(t) || null;
      } catch {
        return null;
      }
    }
    function userThrowLatch(source, err) {
      const env = currentEnvPair();
      return {
        code: source === "install" ? "install-failed" : "check-failed",
        kind: null,
        detail: thrownDetail(err),
        diag: null,
        requestId: source === "install" ? requestId : null,
        checkId: source === "install" ? receipt?.checkId ?? null : null,
        runningVersion: snapshot?.runningVersion ?? null,
        installedVersion: snapshot?.installedVersion ?? null,
        latestVersion: snapshot?.latestVersion ?? null,
        hostKind: env.hostKind,
        profileName: env.profileName,
        source,
        volatile: false,
        jobId: null,
        atMs: latchNow()
      };
    }
    function volatileLatch(source) {
      const env = currentEnvPair();
      return {
        code: "check-failed",
        kind: null,
        detail: null,
        diag: null,
        requestId,
        checkId: receipt?.checkId ?? null,
        runningVersion: snapshot?.runningVersion ?? null,
        installedVersion: snapshot?.installedVersion ?? null,
        latestVersion: snapshot?.latestVersion ?? null,
        hostKind: env.hostKind,
        profileName: env.profileName,
        source,
        volatile: true,
        jobId: null,
        atMs: latchNow()
      };
    }
    function backfillLatch(s) {
      if (!latch) return;
      let touched = false;
      if (latch.runningVersion === null && s.runningVersion) {
        latch.runningVersion = s.runningVersion;
        touched = true;
      }
      if (latch.installedVersion === null && s.installedVersion) {
        latch.installedVersion = s.installedVersion;
        touched = true;
      }
      if (latch.latestVersion === null && s.latestVersion) {
        latch.latestVersion = s.latestVersion;
        touched = true;
      }
      if (touched) saveLatch();
    }
    function tripleChanged(s) {
      if (!latch) return false;
      backfillLatch(s);
      const pairs = [
        [latch.runningVersion, s.runningVersion ?? null],
        [latch.installedVersion, s.installedVersion ?? null],
        [latch.latestVersion, s.latestVersion ?? null]
      ];
      return pairs.some(([a, b]) => a !== null && b !== null && a !== b);
    }
    let copyNotice = null;
    let noticeExpiresAt = 0;
    let busyAct = null;
    let mounted = true;
    let envProfileName = null;
    let envHostKind = null;
    function sayCopy(text) {
      copyNotice = text;
    }
    function sayCopyKey(key, values) {
      try {
        copyNotice = copyText(key, currentLang(), values);
      } catch {
        copyNotice = copyText(key, "zh", values);
      }
      try {
        noticeExpiresAt = Date.now() + 5e3;
      } catch {
        noticeExpiresAt = 0;
      }
    }
    function setStableHTML(target, html) {
      try {
        const g = globalThis;
        const doc = g["document"];
        const el = target;
        if (!doc || typeof el.querySelectorAll !== "function") {
          target.innerHTML = html;
          return;
        }
        let focusAction = null;
        try {
          const active = doc.activeElement;
          if (active && typeof active.getAttribute === "function") {
            focusAction = active.getAttribute("data-action");
          }
        } catch {
          focusAction = null;
        }
        let scrolls = [];
        try {
          const nodes = el.querySelectorAll(".dsh-upd-body");
          if (nodes) {
            for (let i = 0; i < nodes.length; i++) {
              const n = nodes[i];
              scrolls.push(typeof n.scrollTop === "number" ? n.scrollTop : 0);
            }
          }
        } catch {
          scrolls = [];
        }
        target.innerHTML = html;
        try {
          const bodies = el.querySelectorAll(".dsh-upd-body");
          if (bodies) {
            for (let i = 0; i < bodies.length && i < scrolls.length; i++) {
              const n = bodies[i];
              try {
                n.scrollTop = scrolls[i];
              } catch {
              }
            }
          }
        } catch {
        }
        try {
          if (focusAction && typeof el.querySelector === "function") {
            const next = el.querySelector('[data-action="' + focusAction + '"]');
            if (next && typeof next.focus === "function") {
              try {
                next.focus.call(next, { preventScroll: true });
              } catch {
                try {
                  next.focus.call(next);
                } catch {
                }
              }
            }
          }
        } catch {
        }
      } catch {
        try {
          target.innerHTML = html;
        } catch {
        }
      }
    }
    function queueArgs() {
      return { includeQueue: true, includeEnv: true, showOthers, ...requestId ? { requestId } : {} };
    }
    function render() {
      if (!mounted) return;
      if (!copyNotice) noticeExpiresAt = 0;
      else if (noticeExpiresAt && Date.now() > noticeExpiresAt) {
        copyNotice = null;
        noticeExpiresAt = 0;
      }
      const latest = snapshot?.latestVersion ?? null;
      const skippedLatest = !!latest && validReleaseVersion(latest) && skipStore.has(latest);
      const langNow = currentLang();
      const nextHTML = renderUpdatePanelHTML({
        snapshot,
        manual,
        queue,
        busyAct,
        lang: langNow,
        skippedLatest,
        lastError: latch?.code ?? null,
        errorKind: latch?.kind ?? null,
        failure: latch ? { requestId: latch.requestId, checkId: latch.checkId, atMs: latch.atMs, source: latch.source, volatile: latch.volatile } : null,
        showLogHint: showLogHintOption,
        changelogMarkdown,
        mode,
        showOthers,
        changelogCollapsed,
        pluginId,
        copyNotice,
        theme,
        themeTokens,
        // 使用范围与宿主种类：调用方显式传的优先，否则用宿主回的真值。
        profileName: profileNameOption ?? envProfileName,
        hostKind: hostKind ?? envHostKind
      });
      if (nextHTML !== lastHTML) {
        lastHTML = nextHTML;
        setStableHTML(container, nextHTML);
      }
    }
    function applyStatusReply(reply, via) {
      if (!isObject(reply)) return;
      if (reply["ok"] === true) {
        const s = asSnapshot(reply["snapshot"]);
        if (s) snapshot = s;
        manual = typeof reply["manual"] === "string" ? reply["manual"] : null;
        if (reply["receipt"] && isObject(reply["receipt"]) && typeof reply["receipt"]["checkId"] === "string") {
          receipt = { checkId: reply["receipt"]["checkId"] };
        }
        const q = asQueue(reply["queue"]);
        if (q) queue = q;
        const env = reply["env"];
        if (isObject(env)) {
          const pn = env["profileName"];
          const hk = env["environmentKind"];
          if (typeof pn === "string" && pn.trim()) envProfileName = pn.trim();
          if (typeof hk === "string" && hk.trim()) envHostKind = hk.trim();
        }
        const jobState = snapshot?.job?.state ?? null;
        if (jobState === "installing" || jobState === "verifying") {
          clearLatch();
        } else if (jobState === "completed" || jobState === "restart-required") {
          clearLatch();
        } else if ((jobState === "failed" || jobState === "interrupted") && snapshot?.job) {
          setLatch(latchFromJob(snapshot.job, snapshot));
        } else if (via === "install") {
          clearLatch();
        } else if (snapshot && tripleChanged(snapshot)) {
          clearLatch();
        } else if (via === "check" && latch?.source === "check") {
          clearLatch();
        } else if (latch?.volatile) {
          clearLatch();
        }
      } else {
        const errText = typeof reply["error"] === "string" ? reply["error"].trim() : "";
        const kindText = typeof reply["errorKind"] === "string" ? reply["errorKind"].trim() : "";
        if ((kindText || errText) === "update-busy") {
        } else {
          setLatch(latchFromReply(reply, via === "install" ? "install" : "check"));
        }
        try {
          const env = reply["env"];
          if (isObject(env)) {
            const pn = env["profileName"];
            const hk = env["environmentKind"];
            if (typeof pn === "string" && pn.trim()) envProfileName = pn.trim();
            if (typeof hk === "string" && hk.trim()) envHostKind = hk.trim();
          }
        } catch {
        }
        try {
          const q = asQueue(reply["queue"]);
          if (q) queue = q;
        } catch {
        }
      }
    }
    function pendingAutoChangelogVersion() {
      if (!autoChangelogEnabled || manualChangelogOverride || !mounted) return null;
      const v = snapshot?.latestVersion ?? null;
      if (typeof v !== "string" || !validReleaseVersion(v)) return null;
      if (!snapshot || snapshot.canInstall !== true) return null;
      try {
        if (skipStore.has(v)) return null;
      } catch {
      }
      if (changelogInflight.has(v)) return null;
      const hasCache = changelogCache.has(v);
      const failedAt = changelogFailedAt.has(v) ? changelogFailedAt.get(v) : null;
      let nowMs = 0;
      try {
        nowMs = Date.now();
      } catch {
        nowMs = 0;
      }
      if (!shouldFetchChangelog({ hasCache, failedAt, now: nowMs, isManual: false })) return null;
      return v;
    }
    function maybeAutoChangelog() {
      const v = pendingAutoChangelogVersion();
      if (v === null) return;
      changelogInflight.add(v);
      const seq = autoSeq;
      void Promise.resolve().then(() => call(changelogPhone, { version: v })).then(
        (reply) => {
          changelogInflight.delete(v);
          if (!mounted || seq !== autoSeq) return;
          if (!reply || typeof reply !== "object" || reply["ok"] !== true) {
            try {
              changelogFailedAt.set(v, Date.now());
            } catch {
              try {
                changelogFailedAt.set(v, 0);
              } catch {
              }
            }
            return;
          }
          const md = reply["markdown"];
          changelogCache.set(v, typeof md === "string" ? md : null);
          if (typeof md === "string") {
            changelogMarkdown = md;
            render();
          }
        },
        () => {
          changelogInflight.delete(v);
          if (mounted && seq === autoSeq) {
            try {
              changelogFailedAt.set(v, Date.now());
            } catch {
              try {
                changelogFailedAt.set(v, 0);
              } catch {
              }
            }
          }
        }
      );
    }
    async function refresh() {
      if (!mounted) return;
      try {
        const reply = await call(phoneNames.updateStatus, queueArgs());
        if (!mounted) return;
        applyStatusReply(reply, "refresh");
      } catch {
        if (!mounted) return;
        setLatch(volatileLatch("check"));
      }
      render();
      maybeAutoChangelog();
    }
    async function act(kind, arg) {
      if (!mounted) return;
      copyNotice = null;
      switch (kind) {
        case "check": {
          if (busyAct) return;
          busyAct = "check";
          copyNotice = copyText("panel.toast.checking", currentLang());
          render();
          try {
            const reply = await call(phoneNames.updateCheck, queueArgs());
            if (!mounted) return;
            applyStatusReply(reply, "check");
            changelogFailedAt.clear();
          } catch (err) {
            if (!mounted) return;
            setLatch(userThrowLatch("check", err));
          } finally {
            busyAct = null;
            try {
              const zh = copyText("panel.toast.checking", "zh");
              const en = copyText("panel.toast.checking", "en");
              if (copyNotice === zh || copyNotice === en) copyNotice = null;
            } catch {
              copyNotice = null;
            }
          }
          render();
          maybeAutoChangelog();
          return;
        }
        case "install": {
          if (busyAct) return;
          busyAct = "install";
          copyNotice = copyText("panel.toast.installing", currentLang());
          render();
          try {
            if (!receipt) {
              try {
                const checked = await call(phoneNames.updateCheck, queueArgs());
                if (!mounted) return;
                applyStatusReply(checked, "check");
              } catch (err) {
                if (!mounted) return;
                setLatch(userThrowLatch("check", err));
                render();
                return;
              }
            }
            if (!mounted) return;
            if (!receipt) {
              const expiredEnv = currentEnvPair();
              setLatch({
                code: "check-expired",
                kind: "check-expired",
                detail: null,
                diag: null,
                requestId,
                checkId: null,
                runningVersion: snapshot?.runningVersion ?? null,
                installedVersion: snapshot?.installedVersion ?? null,
                latestVersion: snapshot?.latestVersion ?? null,
                hostKind: expiredEnv.hostKind,
                profileName: expiredEnv.profileName,
                source: "install",
                volatile: false,
                jobId: null,
                atMs: latchNow()
              });
              render();
              return;
            }
            requestId = randomRequestId();
            const reply = await call(phoneNames.updateInstall, {
              checkId: receipt.checkId,
              requestId,
              ...queueArgs()
            });
            if (!mounted) return;
            applyStatusReply(reply, "install");
          } catch (err) {
            if (!mounted) return;
            setLatch(userThrowLatch("install", err));
          } finally {
            busyAct = null;
            try {
              const zh = copyText("panel.toast.installing", "zh");
              const en = copyText("panel.toast.installing", "en");
              if (copyNotice === zh || copyNotice === en) copyNotice = null;
            } catch {
              copyNotice = null;
            }
          }
          render();
          maybeAutoChangelog();
          return;
        }
        case "skip": {
          const v = snapshot?.latestVersion ?? null;
          if (v && validReleaseVersion(v)) {
            try {
              skipStore.skip(v);
            } catch {
            }
          }
          render();
          return;
        }
        case "reset-skip": {
          try {
            skipStore.reset(arg ?? snapshot?.latestVersion ?? void 0);
          } catch {
          }
          await refresh();
          return;
        }
        case "copy-manual": {
          if (manual) {
            try {
              await copyTextOut(manual);
              sayCopyKey("panel.toast.copy-manual-ok");
            } catch {
              sayCopyKey("panel.toast.copy-manual-fail");
            }
          }
          render();
          return;
        }
        case "copy-diag": {
          const jobCode = snapshot?.job?.state === "failed" ? messageCodeOf(snapshot.job.message) || "install-failed" : "";
          if (!latch && !jobCode && !snapshot?.blockedReason && snapshot) {
            const stateLine = snapshot.canInstall && snapshot.latestVersion ? `\u6709\u65B0\u7248 ${snapshot.latestVersion} \u53EF\u88C5\uFF08\u5F53\u524D ${snapshot.runningVersion}\uFF09` : "\u5DF2\u662F\u6700\u65B0\uFF0C\u65E0\u9700\u66F4\u65B0\u3002";
            const queueName = queueTextOf(queue?.position ?? null);
            const envBits = [
              `\u63D2\u4EF6=${pluginId}`,
              `\u5BBF\u4E3B=${hostKind ?? envHostKind ?? "\u672A\u77E5"}`,
              `\u4F7F\u7528\u8303\u56F4=${profileNameOption ?? envProfileName ?? "\u672A\u77E5"}`,
              `\u961F\u5217=${queueName}`
            ];
            if (requestId) envBits.push(`\u8BF7\u6C42=${requestId}`);
            if (receipt?.checkId) envBits.push(`\u68C0\u67E5=${receipt.checkId}`);
            const segs = [
              `[update-diag] \u5F53\u524D\u65E0\u5931\u8D25\uFF1A${stateLine}`,
              `\u7248\u672C\uFF1A\u8FD0\u884C ${snapshot.runningVersion}\uFF0F\u78C1\u76D8 ${snapshot.installedVersion ?? "\u672A\u77E5"}\uFF0F\u8FDC\u7AEF ${snapshot.latestVersion ?? "\u672A\u67E5\u8FC7"}`,
              `\u6765\u6E90\uFF1A${envBits.join(" \xB7 ")}`
            ].map((s) => redactForCopy(s));
            const text2 = diagCopyFormat === "line" ? segs.join(" \xB7 ") : segs.join("\n");
            try {
              await copyTextOut(text2);
              sayCopyKey("panel.toast.copy-state-ok");
            } catch {
              sayCopyKey("panel.toast.copy-diag-fail");
            }
            render();
            return;
          }
          const frozen = latch;
          const code = frozen?.code ?? failureCodeOf({ error: null, errorKind: null }, jobCode || snapshot?.blockedReason || "check-failed");
          const detail = frozen?.detail ?? (snapshot?.job?.message && snapshot.job.message.includes(":") ? snapshot.job.message.slice(snapshot.job.message.indexOf(":") + 1) : snapshot?.job?.message);
          const text = buildUpdateDiagCopy({
            pluginId,
            code,
            detail,
            runningVersion: frozen?.runningVersion ?? snapshot?.runningVersion ?? null,
            installedVersion: frozen?.installedVersion ?? snapshot?.installedVersion ?? null,
            latestVersion: frozen?.latestVersion ?? snapshot?.latestVersion ?? null,
            hostKind: frozen?.hostKind ?? hostKind ?? envHostKind,
            profileName: frozen?.profileName ?? profileNameOption ?? envProfileName,
            queuePosition: queue?.position ?? null,
            requestId: frozen?.requestId ?? requestId,
            checkId: frozen?.checkId ?? receipt?.checkId ?? null,
            route: null,
            diag: frozen?.diag ?? null,
            manual,
            format: diagCopyFormat,
            lang: currentLang()
          });
          try {
            await copyTextOut(text);
            sayCopyKey("panel.toast.copy-diag-ok");
          } catch {
            sayCopyKey("panel.toast.copy-diag-fail");
          }
          render();
          return;
        }
        case "dismiss-failure": {
          clearLatch();
          sayCopyKey("panel.toast.failure-dismissed");
          render();
          return;
        }
        case "toggle-queue": {
          showOthers = !showOthers;
          await refresh();
          return;
        }
        case "toggle-changelog": {
          changelogCollapsed = !changelogCollapsed;
          render();
          return;
        }
        // 「重启宿主」：宿主没有重启自己的电话，所以只做入口——
        // 调用方给了 onRestartRequested 就交给它；没给就如实说“请手动重启”，不假装。
        case "restart-hint": {
          try {
            if (typeof onRestartRequested === "function") {
              await onRestartRequested();
              sayCopyKey("panel.toast.restart-delegated");
            } else {
              sayCopyKey("panel.toast.restart-manual");
            }
          } catch {
            sayCopyKey("panel.toast.restart-failed");
          }
          render();
          return;
        }
        case "close-view": {
          await requestDialogClose();
          return;
        }
      }
    }
    async function setMode(next) {
      if (next !== "embedded" && next !== "dialog") {
        throw new Error(`[dsh-plugin-update] \u6446\u653E\u5F62\u6001\u975E\u6CD5\uFF1A\u53EA\u6536 embedded \u6216 dialog\uFF08\u6536\u5230 ${JSON.stringify(next)}\uFF09`);
      }
      mode = next;
      render();
    }
    async function setTheme(next) {
      if (next !== "default" && next !== "archive") {
        throw new Error(`[dsh-plugin-update] \u4E3B\u9898\u975E\u6CD5\uFF1A\u53EA\u6536 default \u6216 archive\uFF08\u6536\u5230 ${JSON.stringify(next)}\uFF09`);
      }
      theme = normalizePanelTheme(next);
      render();
    }
    async function setThemeTokens(next) {
      themeTokensStyleFor(next ?? void 0);
      themeTokens = next ?? void 0;
      render();
    }
    async function setShowOthers(show) {
      showOthers = show === true;
      await refresh();
    }
    async function setChangelogCollapsed(collapsed) {
      changelogCollapsed = collapsed === true;
      render();
    }
    function onClick(ev) {
      try {
        const t = ev;
        const btn = t?.target && typeof t.target.closest === "function" ? t.target.closest("[data-action]") : null;
        const kind = btn?.getAttribute ? btn.getAttribute("data-action") : null;
        if (!kind) return;
        void act(kind);
      } catch {
      }
    }
    async function requestDialogClose() {
      if (!mounted || mode !== "dialog") return;
      if (onCloseRequested) {
        try {
          await onCloseRequested();
        } catch {
        }
      }
      unmount();
    }
    function onKeyDown(ev) {
      try {
        const e = ev;
        if (!mounted || mode !== "dialog" || !e || e.key !== "Escape") return;
        void requestDialogClose();
      } catch {
      }
    }
    function setChangelogMarkdown(markdown) {
      changelogMarkdown = typeof markdown === "string" ? markdown : null;
      if (typeof markdown === "string") manualChangelogOverride = true;
      render();
    }
    function unmount() {
      if (!mounted) return;
      mounted = false;
      try {
        unsubLang();
      } catch {
      }
      autoSeq++;
      changelogInflight.clear();
      try {
        timer.clear(handle);
      } catch {
      }
      try {
        container.removeEventListener?.("click", onClick);
      } catch {
      }
      try {
        container.removeEventListener?.("keydown", onKeyDown);
      } catch {
      }
    }
    const unsubLang = subscribeLang(() => {
      render();
    }, localeOpt);
    render();
    try {
      container.addEventListener?.("click", onClick);
    } catch {
    }
    try {
      container.addEventListener?.("keydown", onKeyDown);
    } catch {
    }
    const timer = getTimer();
    const handle = timer.set(() => {
      if (busyAct) return;
      void refresh();
    }, pollMs);
    try {
      const h = handle;
      if (h && typeof h.unref === "function") h.unref();
    } catch {
    }
    void (async () => {
      await refresh();
      try {
        if (pendingAutoCheck(snapshot, busyAct)) void act("check");
      } catch {
      }
    })();
    return { refresh, act, setMode, setTheme, setThemeTokens, setShowOthers, setChangelogCollapsed, setChangelogMarkdown, unmount };
  }

  // ../node_modules/.pnpm/dsh-plugin-update@0.8.0/node_modules/dsh-plugin-update/dist/entry.js
  function upToDateVersionOf(snapshot, error) {
    if (error || !snapshot || hasUpdateOf(snapshot)) return null;
    const v = snapshot.runningVersion;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  }
  function hasUpdateOf(snapshot) {
    if (!snapshot) return false;
    const latest = snapshot.latestVersion;
    if (typeof latest !== "string" || !latest.trim()) return false;
    return latest.trim() !== snapshot.runningVersion;
  }
  function entryStateKind(state) {
    const snapshot = state?.snapshot ?? null;
    const job = snapshot?.job ?? null;
    if (job && (job.state === "installing" || job.state === "verifying")) return "busy";
    if (snapshot && (snapshot.blockedReason === "pending-restart" || job?.state === "restart-required")) {
      return "restart";
    }
    if (state && state.error || job && (job.state === "failed" || job.state === "interrupted")) {
      return "failed";
    }
    if (hasUpdateOf(snapshot)) return "update";
    return "idle";
  }
  function entryBilingualKeyFor(state) {
    switch (entryStateKind(state)) {
      case "busy":
        return "entry.label.busy";
      case "restart":
        return "entry.label.restart";
      case "failed":
        return "entry.label.failed";
      case "update": {
        const latest = state?.snapshot?.latestVersion;
        return typeof latest === "string" && latest.trim() ? "entry.label.has-update" : "entry.label.idle";
      }
      default:
        return "entry.label.idle";
    }
  }
  function entryBilingualValuesFor(state) {
    const key = entryBilingualKeyFor(state);
    if (key === "entry.label.has-update") {
      const v = state?.snapshot?.latestVersion;
      return { version: typeof v === "string" ? v.trim() : "" };
    }
    return {};
  }
  function entryBilingualHTMLFor(state, lang) {
    const l = lang ?? resolveLang();
    return copyHTML(entryBilingualKeyFor(state), l, entryBilingualValuesFor(state));
  }
  function entryBilingualTextFor(state, lang) {
    const l = lang ?? resolveLang();
    return copyText(entryBilingualKeyFor(state), l, entryBilingualValuesFor(state));
  }
  function entryLabelFor(state, lang) {
    const l = lang ?? resolveLang();
    return copyText(entryBilingualKeyFor(state), l, entryBilingualValuesFor(state));
  }
  function entrySizingError(raw) {
    return new Error(`[dsh-plugin-update] \u5165\u53E3\u4EF6\u5C3A\u5BF8\u53C2\u6570 sizing \u975E\u6CD5\uFF1A\u53EA\u6536 fontSize / padding / borderRadius\uFF08\u975E\u7A7A CSS \u503C\uFF09\u4E0E scale\uFF08\u5927\u4E8E 0 \u7684\u6709\u9650\u6570\uFF09\uFF08\u6536\u5230 ${JSON.stringify(raw ?? null)})`);
  }
  function isSafeEntryCssValue(value) {
    const v = value.trim();
    if (!v || v.length > 200) return false;
    if (/[;"'<>`{}!&]/.test(v)) return false;
    if (/url\s*\(/i.test(v)) return false;
    if (/expression\s*\(/i.test(v)) return false;
    if (/javascript\s*:/i.test(v)) return false;
    return true;
  }
  function entrySizingStyleFor(sizing) {
    if (sizing === void 0 || sizing === null) return "";
    if (typeof sizing !== "object" || Array.isArray(sizing)) throw entrySizingError(sizing);
    for (const key of Object.keys(sizing)) {
      if (key !== "fontSize" && key !== "padding" && key !== "borderRadius" && key !== "scale") {
        throw entrySizingError(sizing);
      }
    }
    const parts = [];
    const { fontSize, padding, borderRadius, scale } = sizing;
    if (fontSize !== void 0) {
      if (typeof fontSize !== "string" || !isSafeEntryCssValue(fontSize)) throw entrySizingError(sizing);
      parts.push(`--dsh-update-entry-font-size:${fontSize.trim()}`);
    }
    if (padding !== void 0) {
      if (typeof padding !== "string" || !isSafeEntryCssValue(padding)) throw entrySizingError(sizing);
      parts.push(`--dsh-update-entry-padding:${padding.trim()}`);
    }
    if (borderRadius !== void 0) {
      if (typeof borderRadius !== "string" || !isSafeEntryCssValue(borderRadius)) throw entrySizingError(sizing);
      parts.push(`--dsh-update-entry-border-radius:${borderRadius.trim()}`);
    }
    if (scale !== void 0) {
      if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) throw entrySizingError(sizing);
      parts.push(`--dsh-update-entry-scale:${String(scale)}`);
    }
    return parts.join(";");
  }
  var UPDATE_ENTRY_CSS = [
    '.dsh-upd-entry{display:inline-flex;align-items:center;gap:8px;font:13px/1.6 var(--dsh-update-font-sans,system-ui,"Microsoft YaHei",sans-serif);font-size:var(--dsh-update-entry-font-size,13px);color:var(--dsh-update-text,#1f2937)}',
    ".dsh-upd-entry-btn{font:inherit;border:1px solid var(--dsh-update-border,#d1d5db);border-radius:var(--dsh-update-entry-border-radius,6px);",
    "background:var(--dsh-update-button-bg,#f9fafb);color:inherit;padding:var(--dsh-update-entry-padding,4px 12px);zoom:var(--dsh-update-entry-scale,1);cursor:pointer}",
    ".dsh-upd-entry-btn:hover{border-color:var(--dsh-update-primary,#2563eb)}",
    ".dsh-upd-entry-btn,.dsh-upd-entry-dot{transition:background-color .15s ease,border-color .15s ease,color .15s ease,transform .06s ease}",
    ".dsh-upd-entry-btn:active:not(:disabled){transform:translateY(1px)}",
    ".dsh-upd-entry-btn:disabled,.dsh-upd-entry-dot:disabled{opacity:.55;cursor:wait}",
    '.dsh-upd-entry-btn[aria-busy="true"]::after{content:"";display:inline-block;width:10px;height:10px;margin-left:7px;vertical-align:-1px;',
    "border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:dsh-upd-entry-spin .8s linear infinite}",
    "@keyframes dsh-upd-entry-spin{to{transform:rotate(360deg)}}",
    '@media (prefers-reduced-motion: reduce){.dsh-upd-entry-btn,.dsh-upd-entry-dot{transition:none}.dsh-upd-entry-btn[aria-busy="true"]::after{animation:none}}',
    ".dsh-upd-entry-btn:focus-visible,.dsh-upd-entry-dot:focus-visible{outline:2px solid var(--dsh-update-focus,#2563eb);outline-offset:1px}",
    '.dsh-upd-entry[data-state="update"] .dsh-upd-entry-btn{border-color:var(--dsh-update-ok-border,#059669);color:var(--dsh-update-ok-border,#059669)}',
    '.dsh-upd-entry[data-state="restart"] .dsh-upd-entry-btn{border-color:var(--dsh-update-warn-border,#d97706);color:var(--dsh-update-warn-border,#d97706)}',
    '.dsh-upd-entry[data-state="failed"] .dsh-upd-entry-btn{border-color:var(--dsh-update-bad-border,#dc2626);color:var(--dsh-update-bad-border,#dc2626)}',
    ".dsh-upd-entry-dot{width:10px;height:10px;padding:0;border:0;border-radius:50%;background:var(--dsh-update-border,#9ca3af);cursor:pointer}",
    '.dsh-upd-entry[data-state="update"] .dsh-upd-entry-dot{background:var(--dsh-update-ok-border,#059669)}',
    '.dsh-upd-entry[data-state="busy"] .dsh-upd-entry-dot,.dsh-upd-entry[data-state="restart"] .dsh-upd-entry-dot{background:var(--dsh-update-warn-border,#d97706)}',
    '.dsh-upd-entry[data-state="failed"] .dsh-upd-entry-dot{background:var(--dsh-update-bad-border,#dc2626)}',
    // C 直显（upToDateDisplay='button'）：无新版时按钮本身即版本，走中性弱边（不抢有新版的红/绿），hover 才走 primary 暗示可再查；复用既有 token，不加新键。
    '.dsh-upd-entry[data-known="uptodate"] .dsh-upd-entry-btn{border-color:var(--dsh-update-border,#d1d5db);color:var(--dsh-update-text-muted,#6b7280)}',
    '.dsh-upd-entry[data-known="uptodate"] .dsh-upd-entry-btn:hover{border-color:var(--dsh-update-primary,#2563eb);color:var(--dsh-update-primary,#2563eb)}',
    // 小字自带底（深色宿主 + 浅色变量时也读得出；浅底宿主上只是多一圈细线，不抢戏）。
    ".dsh-upd-entry-note{font-size:12.5px;opacity:.9;background:var(--dsh-update-bg,#ffffff);border:1px solid var(--dsh-update-border,#e5e7eb);border-radius:var(--dsh-update-radius-badge,4px);padding:1px 8px}",
    '.dsh-upd-entry[data-theme="archive"] .dsh-upd-entry-note{background:var(--dsh-update-bg);border-color:var(--dsh-update-border-strong);color:var(--dsh-update-text)}',
    '.dsh-upd-entry[data-theme="archive"]{--dsh-update-text:#1a1a1a;--dsh-update-text-muted:#6f675a;--dsh-update-border-strong:#c4b896;--dsh-update-primary:#c8402a;--dsh-update-bg:#fffdf6;',
    '--dsh-update-font-serif:Georgia,"Songti SC","STSong","SimSun",serif;',
    'font-family:var(--dsh-update-font-serif,Georgia,"Songti SC","STSong","SimSun",serif);color:var(--dsh-update-text)}',
    // 按钮脸自己不透明（深色宿主 + 浅色系统变量时也读得出；hover 红在深浅底上都可见）。
    '.dsh-upd-entry[data-theme="archive"] .dsh-upd-entry-btn{border-color:var(--dsh-update-border-strong);background:var(--dsh-update-bg);color:var(--dsh-update-text);border-radius:var(--dsh-update-entry-border-radius,3px)}',
    '.dsh-upd-entry[data-theme="archive"] .dsh-upd-entry-btn:hover{border-color:var(--dsh-update-primary);color:var(--dsh-update-primary)}',
    '@media (prefers-color-scheme: dark){.dsh-upd-entry[data-theme="archive"]{--dsh-update-text:#ece5d3;--dsh-update-text-muted:#a89c83;--dsh-update-border-strong:#5c4e3b;--dsh-update-primary:#e0684e;--dsh-update-bg:#1e1a15}}',
    "@media (prefers-color-scheme: dark){.dsh-upd-entry{color:#e5e7eb;--dsh-update-text-muted:#9ca3af}",
    ".dsh-upd-entry-btn{--dsh-update-button-bg:#1f2937;--dsh-update-border:#374151}}"
  ].join("\n");
  var ENTRY_ATTR = "data-dsh-upd-entry";
  var ENTRY_SELECTOR = "[data-dsh-upd-entry]";
  function isObject2(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function asSnapshot2(value) {
    if (!isObject2(value)) return null;
    if (typeof value["runningVersion"] !== "string") return null;
    if (typeof value["canInstall"] !== "boolean") return null;
    return value;
  }
  function escapeHtml3(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function mountUpdateEntry(container, options) {
    if (!container || typeof container.innerHTML !== "string") {
      throw new Error("[dsh-plugin-update] \u6302\u66F4\u65B0\u5165\u53E3\u4EF6\u9700\u8981\u4E00\u4E2A\u6709 innerHTML \u7684\u5BB9\u5668");
    }
    if (!options || typeof options !== "object") {
      throw new Error("[dsh-plugin-update] \u6302\u66F4\u65B0\u5165\u53E3\u4EF6\u7F3A\u5C11\u914D\u7F6E\uFF1A\u63D2\u4EF6\u6807\u8BC6 pluginId \u5FC5\u586B");
    }
    const pluginId = options.pluginId;
    if (typeof pluginId !== "string" || !pluginId) {
      throw new Error(`[dsh-plugin-update] \u63D2\u4EF6\u6807\u8BC6 pluginId \u5FC5\u586B\uFF1A\u987B\u4E3A\u975E\u7A7A\u5B57\u7B26\u4E32\uFF08\u6536\u5230 ${JSON.stringify(pluginId)}\uFF09`);
    }
    if (typeof options.call !== "function") {
      throw new Error("[dsh-plugin-update] \u6302\u66F4\u65B0\u5165\u53E3\u4EF6\u9700\u8981\u4F20\u8F93\u51FD\u6570 call\uFF08\u5165\u53E3\u4EF6\u8C03\u5BBF\u4E3B\u7535\u8BDD\u7684\u552F\u4E00\u63A5\u89E6\u9762\uFF09");
    }
    const rawPrefix = options.prefix;
    const prefix = rawPrefix === void 0 ? DEFAULT_PREFIX : rawPrefix;
    const phoneNames = buildPhoneNames(prefix);
    const variant = options.variant ?? "button";
    if (variant !== "button" && variant !== "badge" && variant !== "inline") {
      throw new Error(`[dsh-plugin-update] \u5165\u53E3\u4EF6\u5F62\u6001\u975E\u6CD5\uFF1A\u53EA\u6536 button / badge / inline\uFF08\u6536\u5230 ${JSON.stringify(options.variant)}\uFF09`);
    }
    const autoCheck = options.autoCheck ?? "mount";
    if (autoCheck !== "mount" && autoCheck !== "never") {
      throw new Error(`[dsh-plugin-update] \u81EA\u52A8\u68C0\u67E5\u65F6\u673A\u975E\u6CD5\uFF1A\u53EA\u6536 mount \u6216 never\uFF08\u6536\u5230 ${JSON.stringify(options.autoCheck)}\uFF09`);
    }
    const openOn = options.openOn ?? "has-update";
    if (openOn !== "has-update" && openOn !== "always" && openOn !== "manual" && openOn !== "direct") {
      throw new Error(`[dsh-plugin-update] \u70B9\u51FB\u53BB\u5411\u975E\u6CD5\uFF1A\u53EA\u6536 has-update / always / manual / direct\uFF08\u6536\u5230 ${JSON.stringify(options.openOn)}\uFF09`);
    }
    const upToDateDisplay = options.upToDateDisplay ?? "button";
    if (upToDateDisplay !== "note" && upToDateDisplay !== "button" && upToDateDisplay !== "tooltip") {
      throw new Error(`[dsh-plugin-update] invalid upToDateDisplay: expected note / button / tooltip (got ${JSON.stringify(options.upToDateDisplay)})`);
    }
    if (options.theme !== void 0 && options.theme !== "default" && options.theme !== "archive") {
      throw new Error(`[dsh-plugin-update] \u4E3B\u9898\u975E\u6CD5\uFF1A\u53EA\u6536 default \u6216 archive\uFF08\u6536\u5230 ${JSON.stringify(options.theme)}\uFF09`);
    }
    let theme = normalizePanelTheme(options.theme ?? "default");
    const pollMs = options.pollMs;
    if (pollMs !== void 0 && (typeof pollMs !== "number" || !Number.isFinite(pollMs) || pollMs < MIN_PANEL_POLL_MS)) {
      throw new Error(`[dsh-plugin-update] \u9762\u677F\u8F6E\u8BE2\u95F4\u9694\u975E\u6CD5\uFF1A\u4E0D\u5F97\u5C0F\u4E8E 250 \u6BEB\u79D2\uFF08\u6536\u5230 ${JSON.stringify(options.pollMs)}\uFF09`);
    }
    const labelOverride = typeof options.label === "string" && options.label ? options.label : null;
    const sizingStyle = entrySizingStyleFor(options.sizing ?? void 0);
    themeTokensStyleFor(options.themeTokens ?? void 0);
    let themeTokens = options.themeTokens;
    const localeOpt = options.locale ?? void 0;
    if (localeOpt !== void 0 && localeOpt !== null) {
      const isStr = typeof localeOpt === "string";
      const isObj = typeof localeOpt === "object" && typeof localeOpt.getActive === "function";
      if (!isStr && !isObj) {
        throw new Error("[dsh-plugin-update] invalid locale: expected zh / en / BCP47 or { getActive(), subscribe? }");
      }
      if (isStr && !localeOpt.trim()) {
        throw new Error("[dsh-plugin-update] invalid locale: empty string");
      }
    }
    function currentLang() {
      return resolveLang(localeOpt);
    }
    const profileName = typeof options.profileName === "string" && options.profileName ? options.profileName : null;
    const onActivate = typeof options.onActivate === "function" ? options.onActivate : null;
    const call = options.call;
    let snapshot = null;
    let error = null;
    let noteVersion = null;
    let activating = false;
    let mounted = true;
    let panel = null;
    let panelMode = null;
    const panelHost = {
      get innerHTML() {
        return container.innerHTML;
      },
      set innerHTML(value) {
        container.innerHTML = value;
      },
      addEventListener(type, listener) {
        container.addEventListener?.(type, listener);
      },
      removeEventListener(type, listener) {
        container.removeEventListener?.(type, listener);
      }
    };
    async function panelCall(name, args) {
      const reply = await call(name, args);
      return isObject2(reply) ? reply : {};
    }
    function stateOf() {
      return { snapshot, error };
    }
    function currentLabel() {
      if (labelOverride) return labelOverride;
      const lang = currentLang();
      if (!activating && upToDateDisplay === "button" && entryStateKind(stateOf()) === "idle") {
        const v = upToDateVersionOf(snapshot, error);
        if (v) return copyText("entry.note.up-to-date", lang, { version: v });
      }
      return entryLabelFor(stateOf(), lang);
    }
    function hasUpdate() {
      return hasUpdateOf(snapshot);
    }
    function phoneArgs() {
      return {};
    }
    function entryHTML() {
      const kind = entryStateKind(stateOf());
      const lang = currentLang();
      const knownUpToDate = !activating && kind === "idle" ? upToDateVersionOf(snapshot, error) : null;
      const buttonMode = !labelOverride && upToDateDisplay === "button" && knownUpToDate;
      const tooltipMode = !labelOverride && upToDateDisplay === "tooltip" && knownUpToDate;
      const labelHTML = labelOverride ? escapeHtml3(labelOverride) : activating ? copyHTML("entry.action.checking", lang) : buttonMode && knownUpToDate ? copyHTML("entry.note.up-to-date", lang, { version: knownUpToDate }) : copyHTML(entryBilingualKeyFor(stateOf()), lang, entryBilingualValuesFor(stateOf()));
      const labelText = labelOverride ?? (activating ? copyText("entry.action.checking", lang) : buttonMode && knownUpToDate ? copyText("entry.note.up-to-date", lang, { version: knownUpToDate }) : copyText(entryBilingualKeyFor(stateOf()), lang, entryBilingualValuesFor(stateOf())));
      const titleText = labelOverride ? labelOverride : activating ? copyText("entry.action.checking", lang) : buttonMode && knownUpToDate ? copyText(entryBilingualKeyFor(stateOf()), lang, entryBilingualValuesFor(stateOf())) : tooltipMode && knownUpToDate ? copyText("entry.note.up-to-date", lang, { version: knownUpToDate }) : labelText;
      const busyAttr = activating ? ' disabled aria-busy="true"' : "";
      const themeAttr = theme === "archive" ? ' data-theme="archive"' : "";
      const tokensStyle = themeTokensStyleFor(themeTokens ?? void 0);
      const styleBody = [sizingStyle, tokensStyle].filter((part) => part).join(";");
      const styleAttr = styleBody ? ` style="${styleBody}"` : "";
      const knownAttr = buttonMode ? ' data-known="uptodate"' : "";
      const displayAttr = ` data-uptodate="${upToDateDisplay}"`;
      const control = variant === "badge" ? `<button type="button" class="dsh-upd-entry-dot" ${ENTRY_ATTR}="activate" title="${escapeHtml3(titleText)}" aria-label="${escapeHtml3(labelText)}"${busyAttr}></button>` : `<button type="button" class="dsh-upd-entry-btn" ${ENTRY_ATTR}="activate" title="${escapeHtml3(titleText)}" aria-label="${escapeHtml3(labelText)}"${busyAttr}>${labelHTML}</button>`;
      const noteHTML = upToDateDisplay === "note" && noteVersion ? `<span class="dsh-upd-entry-note" data-dsh-upd-note="1">${copyHTML("entry.note.up-to-date", lang, { version: noteVersion })}</span>` : "";
      return `<style>${UPDATE_ENTRY_CSS}
${BILINGUAL_CSS}</style>
<span class="dsh-upd-entry" data-variant="${variant}" data-state="${kind}"${displayAttr}${knownAttr}${themeAttr}${styleAttr}>${control}${noteHTML}</span>`;
    }
    function render() {
      if (!mounted) return;
      if (panelMode !== null) return;
      container.innerHTML = entryHTML();
    }
    function applyReply(reply) {
      if (!isObject2(reply) || reply["ok"] !== true) {
        error = failureCodeOf(isObject2(reply) ? reply : null, "check-failed");
        return;
      }
      const next = asSnapshot2(reply["snapshot"]);
      if (next) snapshot = next;
      error = null;
    }
    async function refresh() {
      if (!mounted) return;
      try {
        const reply = await call(phoneNames.updateStatus, phoneArgs());
        if (!mounted) return;
        applyReply(reply);
      } catch {
        if (!mounted) return;
        error = "check-failed";
      }
      render();
    }
    async function checkNow() {
      try {
        const reply = await call(phoneNames.updateCheck, phoneArgs());
        if (!mounted) return;
        applyReply(reply);
      } catch {
        if (!mounted) return;
        error = "check-failed";
      }
    }
    function mountPanel(mode) {
      if (!mounted || panelMode !== null) return;
      panel = mountUpdatePanel(panelHost, {
        pluginId,
        prefix,
        mode,
        theme,
        themeTokens,
        pollMs,
        profileName,
        autoChangelog: options.autoChangelog,
        changelogMarkdown: options.changelogMarkdown ?? null,
        locale: localeOpt,
        // 面板点「关闭」即走入口件的完整关闭（收 dialog + 还原按钮 + 重查一次），不再是面板自己停轮询。
        onCloseRequested: () => close(),
        call: panelCall
      });
      panelMode = mode;
    }
    function openDialog() {
      mountPanel("dialog");
    }
    function open() {
      if (!mounted || panelMode !== null) return;
      if (variant === "inline") return;
      openDialog();
    }
    function close() {
      if (!mounted || panelMode !== "dialog" || !panel) return;
      const opened = panel;
      panel = null;
      panelMode = null;
      try {
        opened.unmount();
      } catch {
      }
      render();
      void refresh();
    }
    async function activate() {
      if (!mounted || panelMode !== null || activating) return;
      if (openOn === "direct" && variant === "button") {
        openDialog();
        return;
      }
      activating = true;
      noteVersion = null;
      render();
      try {
        await checkNow();
      } finally {
        activating = false;
      }
      if (!mounted) return;
      if (variant === "badge" || openOn === "manual") {
        if (onActivate) onActivate({ hasUpdate: hasUpdate(), latestVersion: snapshot?.latestVersion ?? null });
        else openDialog();
        render();
        return;
      }
      if (openOn === "always" || hasUpdate() || !snapshot || error) {
        openDialog();
        return;
      }
      if (upToDateDisplay === "note") noteVersion = snapshot.runningVersion;
      render();
    }
    function setTheme(next) {
      if (next !== "default" && next !== "archive") {
        throw new Error(`[dsh-plugin-update] \u4E3B\u9898\u975E\u6CD5\uFF1A\u53EA\u6536 default \u6216 archive\uFF08\u6536\u5230 ${JSON.stringify(next)}\uFF09`);
      }
      theme = normalizePanelTheme(next);
      if (panel) void panel.setTheme(theme);
      else render();
    }
    function setThemeTokens(next) {
      themeTokensStyleFor(next ?? void 0);
      themeTokens = next ?? void 0;
      if (panel) void panel.setThemeTokens(themeTokens);
      else render();
    }
    function onClick(ev) {
      if (!mounted) return;
      try {
        const target = ev?.target;
        const closest = target && typeof target.closest === "function" ? target.closest.bind(target) : null;
        if (!closest) return;
        if (closest(ENTRY_SELECTOR)) {
          void activate();
          return;
        }
      } catch {
      }
    }
    function onKeyDown(ev) {
      try {
        const e = ev;
        if (!mounted || panelMode !== "dialog" || !e || e.key !== "Escape") return;
        close();
      } catch {
      }
    }
    function unmount() {
      if (!mounted) return;
      mounted = false;
      try {
        unsubLang();
      } catch {
      }
      const opened = panel;
      panel = null;
      panelMode = null;
      try {
        opened?.unmount();
      } catch {
      }
      try {
        container.removeEventListener?.("click", onClick);
      } catch {
      }
      try {
        container.removeEventListener?.("keydown", onKeyDown);
      } catch {
      }
    }
    const unsubLang = subscribeLang(() => {
      render();
    }, localeOpt);
    try {
      container.addEventListener?.("click", onClick);
    } catch {
    }
    try {
      container.addEventListener?.("keydown", onKeyDown);
    } catch {
    }
    if (variant === "inline") mountPanel("embedded");
    else render();
    if (autoCheck === "mount") void refresh();
    return { refresh, open, close, label: currentLabel, setTheme, setThemeTokens, unmount };
  }
  return __toCommonJS(entry_exports);
})();
