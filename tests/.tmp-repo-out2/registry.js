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

// src/host/tracker/registry.js
var registry_exports = {};
__export(registry_exports, {
  MIGRATE_KEY: () => MIGRATE_KEY,
  TRACKER_REGISTRY: () => TRACKER_REGISTRY,
  TrackerRegistryError: () => TrackerRegistryError,
  createRegistry: () => createRegistry
});
module.exports = __toCommonJS(registry_exports);

// src/shared/tracker/constants.js
var BACKEND_KIND = Object.freeze({
  GITHUB: "github",
  MARKDOWN: "markdown",
  GITLAB: "gitlab"
});
var STATE = Object.freeze({
  OPEN: "open",
  CLOSED: "closed"
});
var ISSUE_TYPE = Object.freeze({
  ISSUE: "issue",
  MAP: "map"
});
var SNAP_MODE = Object.freeze({
  OK: "ok",
  LOADING: "loading",
  ERR: "err"
});
var CLOSED_REASON = Object.freeze({
  COMPLETED: "completed",
  NOT_PLANNED: "not_planned",
  REOPENED: "reopened",
  DUPLICATE: "duplicate"
});
var ACTOR_KIND = Object.freeze({
  USER: "user",
  BOT: "bot",
  ORGANIZATION: "organization"
});
var FIELD_TYPE = Object.freeze({
  TEXT: "text",
  NUMBER: "number",
  DATE: "date",
  SINGLE: "single",
  MULTI: "multi"
});
var ERROR_KIND = Object.freeze({
  ENV: "env",
  // 环境缺工具/缺变量（category: 工具不可用、路径不存在）
  AUTH: "auth",
  // 未登录 / 凭据失效 / 权限不足
  RATELIMIT: "rate-limit",
  // 限流（对齐库内「小写短横线」规范；旧值 'rateLimit' 已弃）
  CONFLICT: "conflict",
  // 写前置失败 / 图不变量违反（如 If-Match 不匹配、setBlockedBy 自环/成环）
  UNSUPPORTED: "unsupported",
  // 该后端不实现某操作/字段（= 能力缺失）
  NOTFOUND: "not-found",
  // 资源不存在（对应 GitHub 404；不区分具体 HTTP 码；旧值 'notfound' 已弃）
  NETWORK: "network",
  PARSE: "parse"
});
var CONTRACT_VERSION = 1;

// src/host/tracker/contract.js
var OPERATIONS = Object.freeze([
  "preflight",
  "list",
  "get",
  "getDependencies",
  "create",
  "close",
  "reopen",
  "comment",
  "update",
  "setLabels",
  "setAssignees",
  "setParent",
  "setBlockedBy",
  "getCurrentUser",
  "initProject"
]);
var NORMALIZE_RULES = Object.freeze({
  completeShape: true,
  // interface 声明全部字段，UI 假设必填
  emptyVsMissing: true,
  // 能实现→空值=EMPTY；不能实现→省略=MISSING
  logBisect: true,
  // host 记每字段填/空，client 记渲染/隐藏，不引入运行期内省
  noCapabilityBranching: true
  // 能力视图只作诊断，不驱动 UI 隐藏（G5）
});
var TRACKER_CONTRACT = Object.freeze({
  version: CONTRACT_VERSION,
  operations: OPERATIONS,
  normalizeRules: NORMALIZE_RULES,
  state: STATE,
  issueType: ISSUE_TYPE,
  errorKind: ERROR_KIND
});

// src/host/tracker/registry.js
var MIGRATE_KEY = Object.freeze({ other: null });
var TrackerRegistryError = class extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
    this.name = "TrackerRegistryError";
  }
};
function handleKey(handle) {
  if (!handle || typeof handle !== "object") throw new TrackerRegistryError("bad-handle", "handle is required");
  const k = handle.cwd || handle.refId;
  if (!k) throw new TrackerRegistryError("bad-handle", "handle needs cwd or refId");
  return String(k);
}
function unsupportedStub(opName, backendId) {
  const stub = async function unsupportedOp() {
    return { ok: false, error: { kind: ERROR_KIND.UNSUPPORTED, message: `backend ${backendId} does not implement op ${opName}` } };
  };
  Object.defineProperty(stub, "name", { value: `${opName}:unsupported`, configurable: true });
  return stub;
}
function wrapTracker(mod, impl) {
  if (!impl || typeof impl !== "object") {
    throw new TrackerRegistryError("shape", `create(${mod.id}) must return an object (got ${typeof impl})`);
  }
  if (impl.id !== void 0 && impl.id !== mod.id) {
    throw new TrackerRegistryError("shape", `create(${mod.id}) returned inconsistent id '${impl.id}'`);
  }
  const target = Object.assign({}, impl);
  return new Proxy(target, {
    get(t, prop, receiver) {
      const v = Reflect.get(t, prop, receiver);
      if (v !== void 0) return v;
      if (typeof prop === "string" && prop === "id") return mod.id;
      if (typeof prop === "string" && OPERATIONS.includes(prop)) return unsupportedStub(prop, mod.id);
      return void 0;
    }
  });
}
function withTimeout(promise, ms, timers, controller) {
  const setT = timers && typeof timers.setTimeout === "function" ? timers.setTimeout.bind(timers) : setTimeout;
  const clearT = timers && typeof timers.clearTimeout === "function" ? timers.clearTimeout.bind(timers) : clearTimeout;
  return new Promise((resolve) => {
    let settled = false;
    const t = setT(() => {
      if (settled) return;
      settled = true;
      try {
        if (controller) controller.abort();
      } catch (e) {
      }
      resolve({ timedOut: true });
    }, ms);
    Promise.resolve(promise).then(
      (v) => {
        if (!settled) {
          settled = true;
          clearT(t);
          resolve({ value: v });
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearT(t);
          resolve({ value: false });
        }
      }
      // matches 抛错 → 假身位不可用（false + diagnostics 由调用方日志）
    );
  });
}
function createRegistry(backendCtx = {}, opts = {}) {
  const matchesTimeout = opts && opts.matchesTimeout != null ? opts.matchesTimeout : 3e3;
  const byId = /* @__PURE__ */ new Map();
  const byHandle = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Map([["register", /* @__PURE__ */ new Set()], ["unregister", /* @__PURE__ */ new Set()], ["bind", /* @__PURE__ */ new Set()]]);
  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (e) {
      }
    }
  }
  function validateMod(mod) {
    if (!mod || typeof mod !== "object") throw new TrackerRegistryError("shape", "BackendModule must be an object");
    if (typeof mod.id !== "string" || !mod.id) throw new TrackerRegistryError("shape", "id must be a non-empty string");
    if (typeof mod.label !== "string") throw new TrackerRegistryError("shape", "label must be a string");
    if (typeof mod.create !== "function") throw new TrackerRegistryError("shape", "create must be a function");
    if (typeof mod.matches !== "function") throw new TrackerRegistryError("shape", "matches must be a function");
    if (mod.id === "other") {
      throw new TrackerRegistryError("other-not-registrable", "'other' \u5DF2\u5F03\u7528\uFF1A\u65E0\u540E\u7AEF\u8BF7\u7528 Selection.backendId:null\uFF08\u4E0D\u9020\u540E\u7AEF\uFF0C\u4E0D\u9020\u5047\u8EAB\u4EFD\uFF09");
    }
  }
  function unregister(id) {
    if (!byId.has(id)) return;
    byId.delete(id);
    const keys = [];
    const staleHandles = [];
    for (const [k, v] of byHandle) {
      if (v.backendId === id) {
        byHandle.delete(k);
        keys.push(k);
        staleHandles.push(v.handle);
      }
    }
    emit("unregister", { id, handles: keys });
    for (const handle of staleHandles) emit("bind", { handle, backendId: null, stale: true });
  }
  function describe(handle, backendId) {
    const entry = byId.get(backendId);
    if (entry && entry.mod && typeof entry.mod.describe === "function") {
      try {
        const r = entry.mod.describe(handle, backendId);
        if (r && typeof r === "object" && typeof r.refId === "string") {
          return {
            backend: r.backend || backendId,
            refId: r.refId || "",
            name: r.name || r.refId || (handle.cwd || backendId),
            url: typeof r.url === "string" ? r.url : ""
          };
        }
        if (r && typeof r === "object") return r;
      } catch (e) {
      }
    }
    try {
      const tr = entry && entry.tracker;
      if (tr && typeof tr.describe === "function") {
        const r2 = tr.describe(handle, backendId);
        if (r2 && typeof r2 === "object" && typeof r2.refId === "string") {
          return {
            backend: r2.backend || backendId,
            refId: r2.refId || "",
            name: r2.name || r2.refId || (handle.cwd || backendId),
            url: typeof r2.url === "string" ? r2.url : ""
          };
        }
      }
    } catch (e) {
    }
    const refId = handle.refId || (backendId === "markdown" ? handle.cwd : "");
    const name = refId || (handle.cwd || backendId);
    return { backend: backendId, refId, name, url: "" };
  }
  function issueUrl(backendId, ref, key) {
    const entry = byId.get(backendId);
    if (entry && entry.mod && typeof entry.mod.issueUrl === "function") {
      try {
        const u = entry.mod.issueUrl(ref, String(key));
        if (typeof u === "string") return u;
      } catch (e) {
      }
    }
    try {
      const tr = entry && entry.tracker;
      if (tr && typeof tr.issueUrl === "function") {
        const u2 = tr.issueUrl(ref, String(key));
        if (typeof u2 === "string") return u2;
      }
    } catch (e) {
    }
    if (backendId === "github" && ref && ref.refId) return "https://github.com/" + ref.refId + "/issues/" + String(key);
    if (backendId === "gitlab" && ref && ref.refId) return "https://gitlab.com/" + ref.refId + "/-/issues/" + String(key);
    return "";
  }
  function linkPattern(backendId) {
    const entry = byId.get(backendId);
    if (entry && entry.mod && entry.mod.linkPattern) return entry.mod.linkPattern;
    try {
      const tr = entry && entry.tracker;
      if (tr && tr.linkPattern) return tr.linkPattern;
    } catch (e) {
    }
    if (backendId === "github") return /github\.com\/[^\/\s]+\/[^\/\s]+\/issues\/(\d+)/g;
    if (backendId === "gitlab") return /gitlab\.com\/[^\/\s]+\/[^\/\s]+\/-\/issues\/(\d+)/g;
    return null;
  }
  function searchUrl(backendId, name) {
    const entry = byId.get(backendId);
    if (entry && entry.mod && typeof entry.mod.searchUrl === "function") {
      try {
        const u = entry.mod.searchUrl(String(name));
        if (typeof u === "string") return u;
      } catch (e) {
      }
    }
    try {
      const tr = entry && entry.tracker;
      if (tr && typeof tr.searchUrl === "function") {
        const u2 = tr.searchUrl(String(name));
        if (typeof u2 === "string") return u2;
      }
    } catch (e) {
    }
    if (backendId === "github") return "https://github.com/search?q=" + encodeURIComponent(String(name));
    return "";
  }
  return {
    /** 注册（同步、无副作用**之外的**副作用：只验形状 + Proxy 包桩；不因缺 op 拒绝）。返回 Disposable。 */
    register(mod, registerOpts) {
      validateMod(mod);
      const replacing = byId.has(mod.id);
      if (replacing && !(registerOpts && registerOpts.replace)) {
        throw new TrackerRegistryError("duplicate-id", `duplicate backend id '${mod.id}' (pass {replace:true} for HMR)`);
      }
      const tracker = wrapTracker(mod, mod.create(backendCtx));
      const entry = { mod, tracker };
      byId.set(mod.id, entry);
      emit("register", { id: mod.id, mod, replacing });
      let disposed = false;
      return {
        /** 按代隔离：仅当 byId 里仍是「本次注册的 entry」才卸载——replace:true 覆盖后，旧代 dispose 不得误杀新代。 */
        dispose() {
          if (disposed) return;
          disposed = true;
          if (byId.get(mod.id) !== entry) return;
          unregister(mod.id);
        }
      };
    },
    /** 卸载（幂等）；被绑定的 handle 标 stale（清除绑定，触发 on('bind') 监听回退）。 */
    unregister,
    get(id) {
      const e = byId.get(id);
      return e ? e.tracker : void 0;
    },
    has(id) {
      return byId.has(id);
    },
    allBindings() {
      return Array.from(byHandle.entries(), ([handleKey2, v]) => ({ handleKey: handleKey2, cwd: v.handle && v.handle.cwd || "", backendId: v.backendId, handle: v.handle }));
    },
    /** 已注册模块（注册序；供 discover/UI 展示）。 */
    modules() {
      return Array.from(byId.values(), (e) => e.mod);
    },
    /** 同步、无副作用**之外**：仅布尔 matches 运行时调用 + 并行 allSettled + 超时 + AbortSignal。 */
    async select(handle, ctx = {}) {
      const k = handleKey(handle);
      if (byHandle.has(k)) {
        const id = byHandle.get(k).backendId;
        if (id === null) return { backendId: null, source: "explicit" };
        if (byId.has(id)) return { backendId: id, source: "explicit", ref: describe(handle, id) };
      }
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const signal = ctx && ctx.signal ? ctx.signal : controller ? controller.signal : void 0;
      const matchCtx = Object.assign({}, ctx, signal ? { signal } : {});
      const entries = Array.from(byId.entries());
      const results = await Promise.all(entries.map(async ([id, entry]) => {
        const out = await withTimeout(Promise.resolve(entry.mod.matches(handle, matchCtx)), matchesTimeout, matchCtx.timers, controller);
        if (out.timedOut) return { id, pending: true };
        return { id, ok: out.value === true };
      }));
      const hits = results.filter((r) => r.ok).map((r) => r.id);
      const pendingIds = results.filter((r) => r.pending).map((r) => r.id);
      if (hits.length >= 1) {
        const choice = hits[0];
        return {
          backendId: choice,
          source: "matches",
          ref: describe(handle, choice),
          multiHit: hits.length > 1 ? hits : void 0,
          pending: pendingIds.length ? true : void 0
        };
      }
      return { backendId: null, source: "fallback", pending: pendingIds.length ? true : void 0 };
    },
    /** 显式绑定（backendId=null = 显式无后端，逃生舱）；'other' 等未注册 id 拒绝。 */
    bind(handle, backendId) {
      const k = handleKey(handle);
      if (backendId !== null && !byId.has(backendId)) {
        throw new TrackerRegistryError("unknown-backend", `backend '${backendId}' not registered`);
      }
      byHandle.set(k, { backendId, handle });
      emit("bind", { handle, backendId });
    },
    /** undefined = 从未 bound；null = 显式无后端；string = 已绑定。 */
    bound(handle) {
      const k = handleKey(handle);
      return byHandle.has(k) ? byHandle.get(k).backendId : void 0;
    },
    /** 出 RepositoryRef：转发 BackendModule.describe，见上方。 */
    describe,
    issueUrl,
    linkPattern,
    searchUrl,
    /** 事件订阅（register/unregister/bind）；返回取消订阅；监听抛错隔离。 */
    on(event, fn) {
      const set = listeners.get(event);
      if (!set || typeof fn !== "function") throw new TrackerRegistryError("bad-event", `unknown event '${event}'`);
      set.add(fn);
      return () => set.delete(fn);
    }
  };
}
var TRACKER_REGISTRY = Object.freeze({ version: 1 });
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MIGRATE_KEY,
  TRACKER_REGISTRY,
  TrackerRegistryError,
  createRegistry
});
