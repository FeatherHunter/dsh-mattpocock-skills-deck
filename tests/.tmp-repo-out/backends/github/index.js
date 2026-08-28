var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
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

// src/shared/tracker/constants.js
var BACKEND_KIND, STATE, ISSUE_TYPE, SNAP_MODE, CLOSED_REASON, ACTOR_KIND, FIELD_TYPE, ERROR_KIND;
var init_constants = __esm({
  "src/shared/tracker/constants.js"() {
    BACKEND_KIND = Object.freeze({
      GITHUB: "github",
      MARKDOWN: "markdown",
      GITLAB: "gitlab"
    });
    STATE = Object.freeze({
      OPEN: "open",
      CLOSED: "closed"
    });
    ISSUE_TYPE = Object.freeze({
      ISSUE: "issue",
      MAP: "map"
    });
    SNAP_MODE = Object.freeze({
      OK: "ok",
      LOADING: "loading",
      ERR: "err"
    });
    CLOSED_REASON = Object.freeze({
      COMPLETED: "completed",
      NOT_PLANNED: "not_planned",
      REOPENED: "reopened",
      DUPLICATE: "duplicate"
    });
    ACTOR_KIND = Object.freeze({
      USER: "user",
      BOT: "bot",
      ORGANIZATION: "organization"
    });
    FIELD_TYPE = Object.freeze({
      TEXT: "text",
      NUMBER: "number",
      DATE: "date",
      SINGLE: "single",
      MULTI: "multi"
    });
    ERROR_KIND = Object.freeze({
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
  }
});

// src/host/tracker/preflight.js
function classifyError(err) {
  if (err && KIND_VALUES.has(err.kind)) return err.kind;
  if (err && err.error && KIND_VALUES.has(err.error.kind)) return err.error.kind;
  const msg = err && typeof err === "object" ? err.message || err.stderr || err.stdout || err.error && err.error.message || "" : err;
  const s = String(msg || "").toLowerCase();
  if (!s) return ERROR_KIND.NETWORK;
  if (/\bnot (logged )?in\b|\bauth\b|\b401\b|\b403\b|credential|unauthorized|permission denied/i.test(s)) return ERROR_KIND.AUTH;
  if (/\brate ?limit\b|\b429\b/i.test(s)) return ERROR_KIND.RATELIMIT;
  if (/is not recognized|\bcommand not found\b|\bno such file\b|cannot find|not found in path|which:|ENOENT/i.test(s)) return ERROR_KIND.ENV;
  if (/not ?found|\b404\b/.test(s)) return ERROR_KIND.NOTFOUND;
  if (/unsupported|not supported|not implemented/i.test(s)) return ERROR_KIND.UNSUPPORTED;
  if (/parse|invalid json|syntax/i.test(s)) return ERROR_KIND.PARSE;
  if (/network|timed ?out|econn|eai_again|offline|timeout|fetch failed|enotfound/i.test(s)) return ERROR_KIND.NETWORK;
  return ERROR_KIND.NETWORK;
}
function fail(kind, message) {
  return { ok: false, error: { kind, message } };
}
var KIND_VALUES, PREFLIGHT;
var init_preflight = __esm({
  "src/host/tracker/preflight.js"() {
    init_constants();
    KIND_VALUES = new Set(Object.values(ERROR_KIND));
    PREFLIGHT = Object.freeze({ version: 1 });
  }
});

// src/host/tracker/backends/github/errors.js
function isTrackerError(err) {
  if (!err || typeof err !== "object") return false;
  if (KIND_VALUES2.has(err.kind)) return true;
  if (err.error && KIND_VALUES2.has(err.error.kind)) return true;
  return false;
}
function classifyGhError(err) {
  if (isTrackerError(err)) {
    if (err.kind) return err.kind;
    if (err.error && err.error.kind) return err.error.kind;
  }
  if (err && err.error && KIND_VALUES2.has(err.error.kind)) return err.error.kind;
  const msg = String(err && (err.stderr || err.message || err.stdout || err.error && err.error.message) || err || "");
  const s = msg.toLowerCase();
  if (/cannot find.*gh|not found.*gh|which:.*gh|resolveexecutable|ENOENT|is not recognized|command not found|no such file/i.test(msg)) {
    return ERROR_KIND.ENV;
  }
  if (/not logged in|authentication|bad credentials|unauthorized|permission denied|credential/i.test(s) || /\b401\b|\b403\b/.test(s)) {
    if (/rate limit|429|api rate limit exceeded/i.test(s)) return ERROR_KIND.RATELIMIT;
    return ERROR_KIND.AUTH;
  }
  if (/rate limit|429|api rate limit exceeded/i.test(s)) return ERROR_KIND.RATELIMIT;
  if (/\b404\b|not found.*repo|not found.*issue|no such issue|issue not found/i.test(s)) return ERROR_KIND.NOTFOUND;
  if (/invalid json|parse|syntax/i.test(s) && /json/i.test(s)) return ERROR_KIND.PARSE;
  return classifyError(err);
}
var KIND_VALUES2;
var init_errors = __esm({
  "src/host/tracker/backends/github/errors.js"() {
    init_constants();
    init_preflight();
    KIND_VALUES2 = new Set(Object.values(ERROR_KIND));
  }
});

// src/host/tracker/backends/github/client.js
function getExec(ctx) {
  if (ctx && typeof ctx.exec === "function") return ctx.exec.bind(ctx);
  if (ctx && ctx.platform && typeof ctx.platform.exec === "function") return ctx.platform.exec.bind(ctx.platform);
  return null;
}
function getPlatform(ctx) {
  if (ctx && ctx.platform && typeof ctx.platform.resolveExecutable === "function") return ctx.platform;
  if (ctx && typeof ctx.resolveExecutable === "function") return ctx;
  return null;
}
function getCwd(ctx, explicitCwd) {
  if (explicitCwd) return explicitCwd;
  if (ctx && typeof ctx.cwd === "string" && ctx.cwd) return ctx.cwd;
  return void 0;
}
function ghClient(ctx) {
  const platform = getPlatform(ctx);
  const exec = getExec(ctx);
  async function resolveGh(cwd) {
    if (!platform) {
      return { ok: false, error: fail(ERROR_KIND.ENV, "gh not found: platform.resolveExecutable unavailable").error };
    }
    try {
      const p = await platform.resolveExecutable("gh");
      if (!p) return { ok: false, error: { kind: ERROR_KIND.ENV, message: "gh not found: platform.resolveExecutable returned null" } };
      return { ok: true, ghPath: p };
    } catch (e) {
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: String(e && e.message || e || "gh not found") } };
    }
  }
  async function execGh(args, opts = {}) {
    const cwd = getCwd(ctx, opts.cwd);
    const resolved = await resolveGh(cwd);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    if (!exec) {
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: "ctx.exec unavailable" } };
    }
    const signal = opts.signal || ctx && ctx.signal || void 0;
    const timeout = opts.timeout != null ? opts.timeout : TIMEOUT_MS;
    try {
      const result = await exec("gh", args, { cwd, timeout, signal });
      const code = result && typeof result.code === "number" ? result.code : 0;
      const stdout = result && typeof result.stdout === "string" ? result.stdout : result && result.text ? result.text : "";
      const stderr = result && typeof result.stderr === "string" ? result.stderr : "";
      if (code !== 0) {
        const err = { message: stderr || stdout || `gh exit ${code}`, stderr: stderr || stdout, code, stdout };
        const kind = classifyGhError(err);
        return { ok: false, error: { kind, message: String(stderr || stdout || err.message).slice(0, 800) } };
      }
      return { ok: true, data: { stdout, stderr, code } };
    } catch (e) {
      const kind = classifyGhError(e);
      const message = String(e && (e.message || e.stderr) || e || "gh exec failed").slice(0, 800);
      return { ok: false, error: { kind, message } };
    }
  }
  async function execJson(args, opts = {}) {
    const r = await execGh(args, opts);
    if (!r.ok) return r;
    const text = (r.data.stdout || "").trim();
    if (!text) return { ok: true, data: null };
    try {
      const parsed = JSON.parse(text);
      return { ok: true, data: parsed };
    } catch (e) {
      return { ok: false, error: { kind: ERROR_KIND.PARSE, message: `invalid json from gh: ${String(e.message).slice(0, 200)}` } };
    }
  }
  async function run(args, cwdOrId) {
    const cwd = typeof cwdOrId === "string" && /[/\\]/.test(cwdOrId) ? cwdOrId : getCwd(ctx, void 0);
    return execGh(args, { cwd });
  }
  return {
    execGh,
    execJson,
    run
    // 兼容旧调用
    // 便捷：gh api --paginate 模拟（简单封装，调用方传 --paginate 时由 execGh 直接交 gh 处理）
  };
}
var TIMEOUT_MS;
var init_client = __esm({
  "src/host/tracker/backends/github/client.js"() {
    init_constants();
    init_preflight();
    init_errors();
    TIMEOUT_MS = 3e4;
  }
});

// src/host/tracker/backends/github/normalize.js
function normalizeLabel(rawLabel) {
  if (typeof rawLabel === "string") {
    const name2 = rawLabel.trim();
    if (!name2) return null;
    return { name: name2, color: "" };
  }
  if (!rawLabel || typeof rawLabel !== "object") return null;
  const name = typeof rawLabel.name === "string" ? rawLabel.name.trim() : "";
  if (!name) return null;
  const color = typeof rawLabel.color === "string" ? rawLabel.color : "";
  const out = { name, color };
  if (typeof rawLabel.description === "string" && rawLabel.description.trim() !== "") {
    out.description = rawLabel.description;
  }
  return out;
}
function normalizeLabels(raw) {
  let nodes = null;
  if (raw && raw.labels && Array.isArray(raw.labels.nodes)) nodes = raw.labels.nodes;
  else if (Array.isArray(raw && raw.labels)) nodes = raw.labels;
  else if (Array.isArray(raw)) nodes = raw;
  else return [];
  const out = [];
  for (const n of nodes) {
    const l = normalizeLabel(n);
    if (l) out.push(l);
  }
  return out;
}
function kindFromTypename(t) {
  const s = String(t || "").toLowerCase();
  if (s === "bot") return "bot";
  if (s === "organization") return "organization";
  return "user";
}
function normalizeActor(raw) {
  if (!raw || typeof raw !== "object") return null;
  const login = typeof raw.login === "string" ? raw.login.trim() : "";
  if (!login) return null;
  const out = { login };
  const kind = raw.__typename ? kindFromTypename(raw.__typename) : raw.kind ? String(raw.kind) : void 0;
  if (kind) out.kind = kind;
  if (typeof raw.name === "string" && raw.name.trim() !== "") out.name = raw.name;
  if (typeof raw.avatarUrl === "string" && raw.avatarUrl !== "") out.avatarUrl = raw.avatarUrl;
  else if (typeof raw.avatar_url === "string" && raw.avatar_url !== "") out.avatarUrl = raw.avatar_url;
  return out;
}
function normalizeAssignees(raw) {
  let nodes = null;
  if (raw && raw.assignees && Array.isArray(raw.assignees.nodes)) nodes = raw.assignees.nodes;
  else if (Array.isArray(raw && raw.assignees)) nodes = raw.assignees;
  else if (raw && Array.isArray(raw.nodes)) nodes = raw.nodes;
  else return [];
  const out = [];
  for (const n of nodes) {
    const a = normalizeActor(n);
    if (a) out.push(a);
  }
  return out;
}
function deriveKey(raw) {
  if (raw == null) return "0";
  if (typeof raw.key === "string" && raw.key !== "") return raw.key;
  if (raw.number != null) return String(raw.number);
  if (raw.id != null) return String(raw.id);
  return "0";
}
function deriveType(raw) {
  const labels = normalizeLabels(raw);
  if (labels.some((l) => l.name === "wayfinder:map")) return ISSUE_TYPE.MAP;
  if (raw && (raw.isMap === true || raw.type === "map")) return ISSUE_TYPE.MAP;
  return ISSUE_TYPE.ISSUE;
}
function deriveParentKey(raw) {
  if (!raw) return null;
  if (typeof raw.parentKey === "string") return raw.parentKey;
  if (raw.parentKey === null) return null;
  if (raw.parent && raw.parent.number != null) return String(raw.parent.number);
  if (raw.parent && typeof raw.parent.key === "string") return raw.parent.key;
  return null;
}
function normalizeMilestone(raw) {
  const src = raw && raw.milestone;
  if (!src || typeof src !== "object") return void 0;
  const title = typeof src.title === "string" ? src.title.trim() : "";
  if (!title) return void 0;
  const out = { name: title };
  if (typeof src.description === "string" && src.description.trim() !== "") out.description = src.description;
  if (typeof src.state === "string") {
    const s = src.state.toLowerCase();
    if (s === "open" || s === "closed") out.state = s;
  }
  if (typeof src.dueOn === "string" && src.dueOn !== "") out.dueOn = src.dueOn;
  else if (typeof src.due_on === "string" && src.due_on !== "") out.dueOn = src.due_on;
  else out.dueOn = null;
  return out;
}
function normalizeComments(raw) {
  let nodes = null;
  if (raw && raw.comments && Array.isArray(raw.comments.nodes)) nodes = raw.comments.nodes;
  else if (Array.isArray(raw && raw.comments)) nodes = raw.comments;
  else return [];
  const out = [];
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    const body = typeof n.body === "string" ? n.body : "";
    const author = normalizeActor(n.author || n.user) || { login: "" };
    const association = typeof n.authorAssociation === "string" ? n.authorAssociation : typeof n.author_association === "string" ? n.author_association : "";
    const c = {
      author,
      authorAssociation: association,
      body,
      createdAt: typeof n.createdAt === "string" ? n.createdAt : typeof n.created_at === "string" ? n.created_at : "",
      updatedAt: typeof n.updatedAt === "string" ? n.updatedAt : typeof n.updated_at === "string" ? n.updated_at : ""
    };
    if (typeof n.id === "string" || typeof n.id === "number") c.id = String(n.id);
    if (typeof n.editedAt === "string" || n.editedAt === null) c.editedAt = n.editedAt;
    else if (typeof n.edited_at === "string" || n.edited_at === null) c.editedAt = n.edited_at;
    out.push(c);
  }
  return out;
}
function normalizeBlockedBy(raw) {
  let nodes = null;
  if (raw && raw.blockedBy && Array.isArray(raw.blockedBy.nodes)) nodes = raw.blockedBy.nodes;
  else if (raw && raw.blocked_by && Array.isArray(raw.blocked_by)) nodes = raw.blocked_by;
  else if (Array.isArray(raw && raw.blockedBy)) nodes = raw.blockedBy;
  else return [];
  const out = [];
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    const k = n.number != null ? String(n.number) : typeof n.key === "string" ? n.key : "";
    if (!k) continue;
    const title = typeof n.title === "string" ? n.title : "";
    const stateRaw = n.state != null ? String(n.state).toLowerCase() : "open";
    const state = stateRaw === "closed" ? STATE.CLOSED : STATE.OPEN;
    const ref = { key: k, title, state };
    if (n.type === "map" || n.type === "issue") ref.type = n.type;
    out.push(ref);
  }
  return out;
}
function normalizeIssue(raw) {
  const key = deriveKey(raw);
  const type = deriveType(raw);
  const stateRaw = raw && raw.state != null ? String(raw.state).toLowerCase() : "open";
  const state = stateRaw === "closed" ? STATE.CLOSED : STATE.OPEN;
  const labels = normalizeLabels(raw);
  const assignees = normalizeAssignees(raw);
  const comments = normalizeComments(raw);
  const blockedBy = normalizeBlockedBy(raw);
  const parentKey = deriveParentKey(raw);
  const issue = {
    key,
    type,
    title: raw && typeof raw.title === "string" ? raw.title : "",
    state,
    body: raw && typeof raw.body === "string" ? raw.body : "",
    url: raw && typeof raw.url === "string" ? raw.url : typeof raw.html_url === "string" ? raw.html_url : "",
    createdAt: raw && typeof raw.createdAt === "string" ? raw.createdAt : typeof raw.created_at === "string" ? raw.created_at : "",
    updatedAt: raw && typeof raw.updatedAt === "string" ? raw.updatedAt : typeof raw.updated_at === "string" ? raw.updated_at : "",
    closedAt: raw && (typeof raw.closedAt === "string" || raw.closedAt === null) ? raw.closedAt : raw && (typeof raw.closed_at === "string" || raw.closed_at === null) ? raw.closed_at : null,
    parentKey,
    labels,
    assignees,
    comments,
    blockedBy,
    // reason：GitHub 支持 closedReason，open 也输出 ''(EMPTY)
    reason: raw && typeof raw.reason === "string" ? raw.reason : raw && typeof raw.stateReason === "string" ? raw.stateReason : ""
  };
  const authorRaw = raw && (raw.author || raw.user);
  const author = normalizeActor(authorRaw);
  if (author) issue.author = author;
  const milestone = normalizeMilestone(raw);
  if (milestone) issue.milestone = milestone;
  return issue;
}
var init_normalize = __esm({
  "src/host/tracker/backends/github/normalize.js"() {
    init_constants();
  }
});

// src/host/tracker/backends/github/queries.js
var ISSUE_FRAGMENT, LIST_QUERY, GET_QUERY;
var init_queries = __esm({
  "src/host/tracker/backends/github/queries.js"() {
    ISSUE_FRAGMENT = [
      "number",
      // keySource only → normalize String(number) → Issue.key（不产 number 字段）
      "title",
      "state",
      "body",
      "url",
      "createdAt",
      "updatedAt",
      "closedAt",
      "author{login name avatarUrl __typename}",
      "assignees(first:50){nodes{login name avatarUrl __typename}}",
      "labels(first:50){nodes{name color description}}",
      "milestone{title description state dueOn}",
      "comments(first:50){nodes{id author{login name avatarUrl __typename} authorAssociation body createdAt updatedAt editedAt}}",
      "parent{number}",
      "blockedBy(first:50){nodes{number title state}}"
    ].join(" ");
    LIST_QUERY = `query($owner:String!,$name:String!,$first:Int!,$after:String){
  repository(owner:$owner,name:$name){
    issues(first:$first, after:$after, states:[OPEN,CLOSED], orderBy:{field:UPDATED_AT, direction:DESC}){
      nodes{ ${ISSUE_FRAGMENT} }
      pageInfo{ hasNextPage endCursor }
    }
  }
}`;
    GET_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    issue(number:$number){ ${ISSUE_FRAGMENT} }
  }
}`;
  }
});

// src/host/tracker/backends/github/labels.js
var labels_exports = {};
__export(labels_exports, {
  addLabel: () => addLabel,
  default: () => labels_default,
  listLabels: () => listLabels,
  setLabels: () => setLabels
});
function normalizeLabelInput(li) {
  if (typeof li === "string") {
    const name2 = li.trim();
    if (!name2) return null;
    return { name: name2, color: "" };
  }
  if (!li || typeof li !== "object") return null;
  const name = typeof li.name === "string" ? li.name.trim() : "";
  if (!name) return null;
  const color = typeof li.color === "string" ? li.color : "";
  const out = { name, color };
  if (typeof li.description === "string" && li.description.trim() !== "") out.description = li.description;
  return out;
}
function normalizeLabelInputs(labels) {
  if (!Array.isArray(labels)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const li of labels) {
    const l = normalizeLabelInput(li);
    if (!l) continue;
    if (seen.has(l.name)) continue;
    seen.add(l.name);
    out.push(l);
  }
  return out;
}
function parseRepo(repo) {
  if (!repo || typeof repo.refId !== "string" || !repo.refId) return null;
  const s = repo.refId.trim();
  const idx = s.indexOf("/");
  if (idx <= 0) return null;
  return { owner: s.slice(0, idx), name: s.slice(idx + 1) };
}
function repoId(repo) {
  if (!repo) return "";
  if (typeof repo.refId === "string" && repo.refId) return repo.refId;
  if (typeof repo.name === "string" && repo.name) return repo.name;
  return "";
}
async function setLabels(repo, key, labels, opts, ctx) {
  const wanted = normalizeLabelInputs(labels);
  const k = String(key || "").trim();
  if (!k) return fail(ERROR_KIND.PARSE, "setLabels: key required (string)");
  try {
    const parsed = parseRepo(repo);
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `setLabels: repo.refId missing: ${repoId(repo)}`);
    if (opts && typeof opts.expectedUpdatedAt === "string" && opts.expectedUpdatedAt !== "") {
      const cur = await getIssue(repo, k, {}, ctx);
      if (!cur.ok) return cur;
      if (cur.data.updatedAt !== opts.expectedUpdatedAt) {
        return fail(ERROR_KIND.CONFLICT, `conflict: expectedUpdatedAt mismatch (want ${opts.expectedUpdatedAt} got ${cur.data.updatedAt})`);
      }
    }
    const c = ghClient(ctx);
    const curRes = await getIssue(repo, k, {}, ctx);
    const curLabels = curRes.ok ? curRes.data.labels.map((l) => l.name) : [];
    const wantNames = wanted.map((l) => l.name);
    const toAdd = wantNames.filter((n) => !curLabels.includes(n));
    const toRemove = curLabels.filter((n) => !wantNames.includes(n));
    for (const n of toRemove) {
      const r = await c.execGh(["issue", "edit", k, "--repo", `${parsed.owner}/${parsed.name}`, "--remove-label", n], { cwd: ctx && ctx.cwd });
      if (!r.ok) return { ok: false, error: r.error };
    }
    for (const n of toAdd) {
      const r = await c.execGh(["issue", "edit", k, "--repo", `${parsed.owner}/${parsed.name}`, "--add-label", n], { cwd: ctx && ctx.cwd });
      if (!r.ok) return { ok: false, error: r.error };
    }
    const finalRes = await getIssue(repo, k, {}, ctx);
    if (!finalRes.ok) {
      const optimisticRaw = { number: Number(k) || k, title: "", state: "open", body: "", url: "", labels: { nodes: wanted.map((l) => ({ name: l.name, color: l.color || "", description: l.description || "" })) }, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      const issue = normalizeIssue(optimisticRaw);
      issue.labels = wanted;
      return { ok: true, data: issue };
    }
    finalRes.data.labels = wanted;
    return finalRes;
  } catch (err) {
    const kind = classifyGhError(err);
    if (kind === ERROR_KIND.CONFLICT) return fail(ERROR_KIND.CONFLICT, err && err.message ? String(err.message) : "conflict");
    return fail(kind, err && err.message ? String(err.message) : String(err));
  }
}
async function listLabels(repo, ctx) {
  try {
    const parsed = parseRepo(repo);
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `listLabels: repo.refId missing: ${repoId(repo)}`);
    const c = ghClient(ctx);
    const r = await c.execGh(["label", "list", "--repo", `${parsed.owner}/${parsed.name}`, "--json", "name,color,description"], { cwd: ctx && ctx.cwd });
    if (!r.ok) return { ok: false, error: r.error };
    const text = r.data.stdout || "";
    let arr = [];
    try {
      arr = JSON.parse(text);
    } catch {
      arr = [];
    }
    const labels = Array.isArray(arr) ? arr.map((l) => ({ name: l.name, color: l.color || "", description: l.description || void 0 })).filter((l) => l.name) : [];
    return { ok: true, data: labels };
  } catch (err) {
    const kind = classifyGhError(err);
    return fail(kind, err && err.message ? String(err.message) : String(err));
  }
}
var addLabel, labels_default;
var init_labels = __esm({
  "src/host/tracker/backends/github/labels.js"() {
    init_preflight();
    init_constants();
    init_normalize();
    init_client();
    init_errors();
    init_issues();
    addLabel = (...args) => setLabels(...args);
    labels_default = { setLabels, addLabel, listLabels };
  }
});

// src/host/tracker/backends/github/graph.js
var graph_exports = {};
__export(graph_exports, {
  default: () => graph_default,
  getDependencies: () => getDependencies,
  setBlockedBy: () => setBlockedBy,
  setParent: () => setParent
});
function parseRepo2(repo) {
  if (!repo || typeof repo.refId !== "string" || !repo.refId) return null;
  const s = repo.refId.trim();
  const idx = s.indexOf("/");
  if (idx <= 0) return null;
  return { owner: s.slice(0, idx), name: s.slice(idx + 1) };
}
function repoId2(repo) {
  if (!repo) return "";
  if (typeof repo.refId === "string" && repo.refId) return repo.refId;
  if (typeof repo.name === "string" && repo.name) return repo.name;
  return "";
}
async function setParent(repo, key, parentKey, opts, ctx) {
  try {
    const parsed = parseRepo2(repo);
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `setParent: repo.refId missing: ${repoId2(repo)}`);
    const k = String(key || "").trim();
    if (!k) return fail(ERROR_KIND.PARSE, "setParent: key required");
    const wantParent = parentKey == null ? null : String(parentKey).trim() || null;
    if (opts && typeof opts.expectedUpdatedAt === "string" && opts.expectedUpdatedAt !== "") {
      const cur = await getIssue(repo, k, {}, ctx);
      if (!cur.ok) return cur;
      if (cur.data.updatedAt !== opts.expectedUpdatedAt) {
        return fail(ERROR_KIND.CONFLICT, `conflict: expectedUpdatedAt mismatch (want ${opts.expectedUpdatedAt} got ${cur.data.updatedAt})`);
      }
    }
    const curRes = await getIssue(repo, k, {}, ctx);
    const curParentKey = curRes.ok ? curRes.data.parentKey : null;
    if (wantParent === curParentKey) {
      if (curRes.ok) return curRes;
      return fail(ERROR_KIND.NOTFOUND, `setParent: issue ${k} not found`);
    }
    const c = ghClient(ctx);
    if (wantParent == null) {
      if (curParentKey == null) {
        if (curRes.ok) return curRes;
        return fail(ERROR_KIND.NOTFOUND, `setParent: issue ${k} not found`);
      }
      const args = ["api", `repos/${parsed.owner}/${parsed.name}/issues/${curParentKey}/sub_issues`, "--method", "DELETE", "-f", `sub_issue_id=${k}`];
      const r = await c.execGh(args, { cwd: ctx && ctx.cwd });
      if (!r.ok) {
        const msg = String(r.error.message || "").toLowerCase();
        if (/not found|404/.test(msg)) return { ok: false, error: r.error };
        if (/unsupported|not supported|404.*sub_issues|sub_issues.*not/i.test(msg)) {
          return fail(ERROR_KIND.UNSUPPORTED, "setParent unsupported (GHES or sub_issues not enabled)");
        }
        return { ok: false, error: r.error };
      }
    } else {
      if (curParentKey != null && curParentKey !== wantParent) {
        const delArgs = ["api", `repos/${parsed.owner}/${parsed.name}/issues/${curParentKey}/sub_issues`, "--method", "DELETE", "-f", `sub_issue_id=${k}`];
        await c.execGh(delArgs, { cwd: ctx && ctx.cwd });
      }
      const args = ["api", `repos/${parsed.owner}/${parsed.name}/issues/${wantParent}/sub_issues`, "--method", "POST", "-f", `sub_issue_id=${k}`];
      const r = await c.execGh(args, { cwd: ctx && ctx.cwd });
      if (!r.ok) {
        const msg = String(r.error.message || "").toLowerCase();
        if (/unsupported|not supported|sub_issues.*not|ghes/i.test(msg)) {
          return fail(ERROR_KIND.UNSUPPORTED, "setParent unsupported (GHES or sub_issues not enabled)");
        }
        return { ok: false, error: r.error };
      }
    }
    const finalRes = await getIssue(repo, k, {}, ctx);
    if (finalRes.ok) return finalRes;
    const optimisticRaw = { number: Number(k) || k, parent: wantParent ? { number: Number(wantParent) } : null, parentKey: wantParent };
    const issue = normalizeIssue(optimisticRaw);
    issue.parentKey = wantParent;
    return { ok: true, data: issue };
  } catch (e) {
    const kind = classifyGhError(e);
    return fail(kind, String(e && e.message || e).slice(0, 800));
  }
}
async function getDependencies(repo, key, opts, ctx) {
  try {
    const parsed = parseRepo2(repo);
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `getDependencies: repo.refId missing: ${repoId2(repo)}`);
    if (opts && Array.isArray(opts.keys) && opts.keys.length) {
      const results = [];
      for (const kk of opts.keys) {
        const single = await getDependencies(repo, kk, {}, ctx);
        if (!single.ok) return single;
        results.push({ key: String(kk), data: single.data });
      }
      if (results.length === 1) return { ok: true, data: results[0].data };
      return { ok: true, data: results[0]?.data || { blockedBy: [], blocking: [] } };
    }
    const k = String(key || "").trim();
    if (!k) return fail(ERROR_KIND.PARSE, "getDependencies: key required");
    const cur = await getIssue(repo, k, {}, ctx);
    if (!cur.ok) return cur;
    const blockedBy = Array.isArray(cur.data.blockedBy) ? cur.data.blockedBy : [];
    const allRes = await listIssues(repo, {}, ctx);
    const all = allRes.ok ? allRes.data : [];
    const blocking = [];
    for (const issue of all) {
      if (!issue.blockedBy || !Array.isArray(issue.blockedBy)) continue;
      if (issue.blockedBy.some((b) => b.key === k)) {
        blocking.push({ key: issue.key, title: issue.title, state: issue.state, type: issue.type });
      }
    }
    return { ok: true, data: { blockedBy, blocking } };
  } catch (e) {
    const kind = classifyGhError(e);
    return fail(kind, String(e && e.message || e).slice(0, 800));
  }
}
async function wouldCreateCycle(repo, key, blockers, ctx) {
  try {
    let dfs = function(u) {
      if (visiting.has(u)) return true;
      if (visited.has(u)) return false;
      visiting.add(u);
      const neigh = adj.get(u) || /* @__PURE__ */ new Set();
      for (const v of neigh) {
        if (dfs(v)) return true;
      }
      visiting.delete(u);
      visited.add(u);
      return false;
    };
    const allRes = await listIssues(repo, {}, ctx);
    const all = allRes.ok ? allRes.data : [];
    const adj = /* @__PURE__ */ new Map();
    for (const issue of all) {
      const deps = (issue.blockedBy || []).map((b) => b.key);
      adj.set(issue.key, new Set(deps));
    }
    adj.set(String(key), new Set(blockers.map((b) => String(b))));
    const visiting = /* @__PURE__ */ new Set();
    const visited = /* @__PURE__ */ new Set();
    for (const u of adj.keys()) {
      if (dfs(u)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
async function setBlockedBy(repo, key, blockers, opts, ctx) {
  try {
    const parsed = parseRepo2(repo);
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `setBlockedBy: repo.refId missing: ${repoId2(repo)}`);
    const k = String(key || "").trim();
    if (!k) return fail(ERROR_KIND.PARSE, "setBlockedBy: key required");
    const want = Array.isArray(blockers) ? blockers.map((b) => String(b).trim()).filter(Boolean) : [];
    const uniq = [...new Set(want)];
    if (uniq.includes(k)) return fail(ERROR_KIND.CONFLICT, `conflict: self in blockers (${k})`);
    if (opts && typeof opts.expectedUpdatedAt === "string" && opts.expectedUpdatedAt !== "") {
      const cur = await getIssue(repo, k, {}, ctx);
      if (!cur.ok) return cur;
      if (cur.data.updatedAt !== opts.expectedUpdatedAt) {
        return fail(ERROR_KIND.CONFLICT, `conflict: expectedUpdatedAt mismatch (want ${opts.expectedUpdatedAt} got ${cur.data.updatedAt})`);
      }
    }
    const cycle = await wouldCreateCycle(repo, k, uniq, ctx);
    if (cycle) return fail(ERROR_KIND.CONFLICT, `conflict: cycle detected for ${k} -> [${uniq.join(",")}]`);
    const c = ghClient(ctx);
    const curRes = await getDependencies(repo, k, {}, ctx);
    if (!curRes.ok) return curRes;
    const curBlockers = curRes.data.blockedBy.map((b) => b.key);
    const toAdd = uniq.filter((b) => !curBlockers.includes(b));
    const toRemove = curBlockers.filter((b) => !uniq.includes(b));
    for (const b of toRemove) {
      const args = ["api", `repos/${parsed.owner}/${parsed.name}/issues/${k}/dependencies/blocked_by/${b}`, "--method", "DELETE"];
      const r = await c.execGh(args, { cwd: ctx && ctx.cwd });
      if (!r.ok) {
        const msg = String(r.error.message || "").toLowerCase();
        if (/unsupported|not found|404.*dependencies/i.test(msg)) return fail(ERROR_KIND.UNSUPPORTED, "setBlockedBy unsupported");
        return { ok: false, error: r.error };
      }
    }
    for (const b of toAdd) {
      const args = ["api", `repos/${parsed.owner}/${parsed.name}/issues/${k}/dependencies/blocked_by`, "--method", "POST", "-f", `issue_id=${b}`];
      const r = await c.execGh(args, { cwd: ctx && ctx.cwd });
      if (!r.ok) {
        const msg = String(r.error.message || "").toLowerCase();
        if (/unsupported|not found|404.*dependencies/i.test(msg)) return fail(ERROR_KIND.UNSUPPORTED, "setBlockedBy unsupported");
        if (/cycle|circular/i.test(msg)) return fail(ERROR_KIND.CONFLICT, `conflict: cycle ${msg.slice(0, 200)}`);
        return { ok: false, error: r.error };
      }
    }
    const finalRes = await getIssue(repo, k, {}, ctx);
    if (finalRes.ok) {
      finalRes.data.blockedBy = uniq.map((kk) => ({ key: String(kk), title: "", state: "open" }));
      return finalRes;
    }
    const optimisticRaw = { number: Number(k) || k, blockedBy: { nodes: uniq.map((kk) => ({ number: Number(kk), title: "", state: "open" })) } };
    const issue = normalizeIssue(optimisticRaw);
    issue.blockedBy = uniq.map((kk) => ({ key: String(kk), title: "", state: "open" }));
    return { ok: true, data: issue };
  } catch (e) {
    const kind = classifyGhError(e);
    if (kind === ERROR_KIND.CONFLICT) return fail(ERROR_KIND.CONFLICT, String(e && e.message || e).slice(0, 800));
    return fail(kind, String(e && e.message || e).slice(0, 800));
  }
}
var graph_default;
var init_graph = __esm({
  "src/host/tracker/backends/github/graph.js"() {
    init_constants();
    init_preflight();
    init_client();
    init_errors();
    init_issues();
    init_normalize();
    graph_default = { setParent, getDependencies, setBlockedBy };
  }
});

// src/host/tracker/backends/github/issues.js
function parseRepo3(repo) {
  if (!repo || typeof repo.refId !== "string" || !repo.refId) return null;
  const s = repo.refId.trim();
  const idx = s.indexOf("/");
  if (idx <= 0) return null;
  return { owner: s.slice(0, idx), name: s.slice(idx + 1) };
}
function repoId3(repo) {
  if (!repo) return "";
  if (typeof repo.refId === "string" && repo.refId) return repo.refId;
  if (typeof repo.name === "string" && repo.name) return repo.name;
  return "";
}
async function listIssues(repo, filter, ctx) {
  try {
    const parsed = parseRepo3(repo);
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `list: repo.refId missing or malformed: ${repoId3(repo)}`);
    const c = ghClient(ctx);
    const all = [];
    let after = null;
    let hasNext = true;
    while (hasNext) {
      const query = LIST_QUERY;
      const args = ["api", "graphql", "-f", `query=${query}`, "-F", `owner=${parsed.owner}`, "-F", `name=${parsed.name}`, "-F", `first=100`];
      if (after) args.push("-F", `after=${after}`);
      else args.push("-F", "after=");
      const r = await c.execGh(args, { cwd: ctx && ctx.cwd });
      if (!r.ok) return { ok: false, error: r.error };
      const text = r.data.stdout || "";
      let j;
      try {
        j = JSON.parse(text);
      } catch (e) {
        return fail(ERROR_KIND.PARSE, `list: invalid json ${String(e.message).slice(0, 200)}`);
      }
      if (j.errors) {
        const msg = JSON.stringify(j.errors).slice(0, 800);
        const kind = classifyGhError({ message: msg, stderr: msg });
        return fail(kind, `list: graphql errors ${msg}`);
      }
      const repoData = j.data && j.data.repository;
      if (!repoData) return fail(ERROR_KIND.NOTFOUND, "list: repository not found");
      const issues = repoData.issues;
      if (!issues || !Array.isArray(issues.nodes)) {
        break;
      }
      for (const n of issues.nodes) {
        try {
          all.push(normalizeIssue(n));
        } catch {
        }
      }
      const pageInfo = issues.pageInfo;
      if (pageInfo && pageInfo.hasNextPage) after = pageInfo.endCursor;
      else hasNext = false;
      if (all.length >= 500) break;
    }
    let filtered = all;
    if (filter && typeof filter === "object") {
      if (filter.state) {
        const want = String(filter.state).toLowerCase();
        filtered = filtered.filter((i) => i.state === want);
      }
      if (filter.type) {
        filtered = filtered.filter((i) => i.type === filter.type);
      }
      if (filter.parentKey !== void 0) {
        if (filter.parentKey === null) filtered = filtered.filter((i) => i.parentKey === null);
        else filtered = filtered.filter((i) => i.parentKey === String(filter.parentKey));
      }
      if (Array.isArray(filter.keys) && filter.keys.length) {
        const set = new Set(filter.keys.map((k) => String(k)));
        filtered = filtered.filter((i) => set.has(i.key));
      }
    }
    return { ok: true, data: filtered };
  } catch (e) {
    const kind = classifyGhError(e);
    return fail(kind, String(e && e.message || e).slice(0, 800));
  }
}
async function getIssue(repo, key, opts, ctx) {
  try {
    const parsed = parseRepo3(repo);
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `get: repo.refId missing: ${repoId3(repo)}`);
    const k = String(key || "").trim();
    if (!k) return fail(ERROR_KIND.PARSE, "get: key required (string)");
    const num = Number(k);
    if (!Number.isFinite(num)) return fail(ERROR_KIND.PARSE, `get: key must be numeric for github: ${k}`);
    const c = ghClient(ctx);
    const query = GET_QUERY;
    const args = ["api", "graphql", "-f", `query=${query}`, "-F", `owner=${parsed.owner}`, "-F", `name=${parsed.name}`, "-F", `number=${num}`];
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd });
    if (!r.ok) return { ok: false, error: r.error };
    const text = r.data.stdout || "";
    let j;
    try {
      j = JSON.parse(text);
    } catch (e) {
      return fail(ERROR_KIND.PARSE, `get: invalid json ${String(e.message).slice(0, 200)}`);
    }
    if (j.errors) {
      const msg = JSON.stringify(j.errors).slice(0, 800);
      if (/not found|could not resolve/i.test(msg)) return fail(ERROR_KIND.NOTFOUND, msg);
      const kind = classifyGhError({ message: msg, stderr: msg });
      return fail(kind, msg);
    }
    const issue = j.data && j.data.repository && j.data.repository.issue;
    if (!issue) return fail(ERROR_KIND.NOTFOUND, `get: issue ${k} not found`);
    let normalized = normalizeIssue(issue);
    if (opts && opts.comments && typeof opts.comments.first === "number" && normalized.comments && normalized.comments.length > opts.comments.first) {
      normalized.comments = normalized.comments.slice(0, opts.comments.first);
    }
    return { ok: true, data: normalized };
  } catch (e) {
    const kind = classifyGhError(e);
    return fail(kind, String(e && e.message || e).slice(0, 800));
  }
}
async function createIssue(repo, input, ctx) {
  try {
    const parsed = parseRepo3(repo);
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `create: repo.refId missing: ${repoId3(repo)}`);
    if (!input || typeof input.title !== "string" || !input.title.trim()) return fail(ERROR_KIND.PARSE, "create: title required");
    const c = ghClient(ctx);
    const body = typeof input.body === "string" ? input.body : "";
    const payload = { title: input.title.trim(), body };
    if (Array.isArray(input.labels) && input.labels.length) {
      payload.labels = input.labels.map((l) => typeof l === "string" ? l.trim() : l && typeof l.name === "string" ? l.name.trim() : "").filter(Boolean);
    }
    if (Array.isArray(input.assignees) && input.assignees.length) {
      payload.assignees = input.assignees.map((a) => typeof a === "string" ? a.trim() : a && typeof a.login === "string" ? a.login.trim() : "").filter(Boolean);
    }
    const args = ["api", `repos/${parsed.owner}/${parsed.name}/issues`, "--method", "POST", "--input", "-", "--jq", "."];
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd });
    let createdRaw = null;
    if (!r.ok) {
      const altArgs = ["issue", "create", "--title", input.title.trim(), "--body", body, "--json", "number,title,state,body,url,updatedAt,createdAt,closedAt,labels,assignees"];
      if (payload.labels && payload.labels.length) {
        for (const lb of payload.labels) altArgs.push("--label", lb);
      }
      if (payload.assignees && payload.assignees.length) {
        for (const a of payload.assignees) altArgs.push("--assignee", a);
      }
      altArgs.push("--repo", `${parsed.owner}/${parsed.name}`);
      const r2 = await c.execGh(altArgs, { cwd: ctx && ctx.cwd });
      if (!r2.ok) return { ok: false, error: r2.error };
      const text2 = r2.data.stdout || "";
      try {
        const j2 = JSON.parse(text2);
        createdRaw = Array.isArray(j2) ? j2[0] : j2;
      } catch (e) {
        return fail(ERROR_KIND.PARSE, `create: invalid json ${String(e.message).slice(0, 200)}`);
      }
    } else {
      return fail(ERROR_KIND.PARSE, "create: unexpected empty response");
    }
    if (!createdRaw) return fail(ERROR_KIND.PARSE, "create: empty response");
    const rawForNormalize = Object.assign({}, createdRaw, {
      number: createdRaw.number ?? createdRaw.id,
      state: createdRaw.state || "open",
      url: createdRaw.url || createdRaw.html_url || "",
      createdAt: createdRaw.createdAt || createdRaw.created_at || "",
      updatedAt: createdRaw.updatedAt || createdRaw.updated_at || "",
      closedAt: createdRaw.closedAt || createdRaw.closed_at || null,
      labels: createdRaw.labels ? { nodes: Array.isArray(createdRaw.labels) ? createdRaw.labels.map((l) => typeof l === "string" ? { name: l, color: "" } : l) : [] } : { nodes: [] },
      assignees: createdRaw.assignees ? { nodes: Array.isArray(createdRaw.assignees) ? createdRaw.assignees.map((a) => typeof a === "string" ? { login: a } : a) : [] } : { nodes: [] }
    });
    let issue = normalizeIssue(rawForNormalize);
    const wantType = input.type === "map" ? "map" : "issue";
    if (wantType === "map" && issue.type !== "map") {
      try {
        const { setLabels: setLabels2 } = await Promise.resolve().then(() => (init_labels(), labels_exports));
        const curLabels = issue.labels.map((l) => l.name);
        if (!curLabels.includes("wayfinder:map")) {
          const withMap = [...issue.labels, { name: "wayfinder:map", color: "" }];
          await setLabels2(repo, issue.key, withMap, {}, ctx);
          issue.type = "map";
        }
      } catch {
      }
    }
    if (input.parentKey != null && input.parentKey !== "") {
      try {
        const { setParent: setParent2 } = await Promise.resolve().then(() => (init_graph(), graph_exports));
        const pr = await setParent2(repo, issue.key, String(input.parentKey), {}, ctx);
        if (pr.ok) issue = pr.data;
      } catch {
      }
    }
    return { ok: true, data: issue };
  } catch (e) {
    const kind = classifyGhError(e);
    return fail(kind, String(e && e.message || e).slice(0, 800));
  }
}
async function closeIssue(repo, key, opts, ctx) {
  try {
    const parsed = parseRepo3(repo);
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `close: repo.refId missing: ${repoId3(repo)}`);
    const k = String(key || "").trim();
    if (!k) return fail(ERROR_KIND.PARSE, "close: key required");
    const c = ghClient(ctx);
    const args = ["issue", "close", k, "--repo", `${parsed.owner}/${parsed.name}`, "--json", "number,title,state,body,url,updatedAt,closedAt"];
    if (opts && typeof opts.reason === "string" && opts.reason) {
      args.push("--reason", opts.reason);
    }
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd });
    if (!r.ok) return { ok: false, error: r.error };
    const text = r.data.stdout || "";
    let raw;
    try {
      raw = JSON.parse(text);
      if (Array.isArray(raw)) raw = raw[0];
    } catch (e) {
      return fail(ERROR_KIND.PARSE, `close: invalid json ${String(e.message).slice(0, 200)}`);
    }
    const normalized = normalizeIssue(Object.assign({}, raw, {
      number: raw.number ?? Number(k),
      url: raw.url || raw.html_url || "",
      closedAt: raw.closedAt || raw.closed_at || (/* @__PURE__ */ new Date()).toISOString()
    }));
    if (opts && typeof opts.reason === "string") normalized.reason = opts.reason;
    return { ok: true, data: normalized };
  } catch (e) {
    const kind = classifyGhError(e);
    return fail(kind, String(e && e.message || e).slice(0, 800));
  }
}
async function reopenIssue(repo, key, ctx) {
  try {
    const parsed = parseRepo3(repo);
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `reopen: repo.refId missing: ${repoId3(repo)}`);
    const k = String(key || "").trim();
    if (!k) return fail(ERROR_KIND.PARSE, "reopen: key required");
    const c = ghClient(ctx);
    const args = ["issue", "reopen", k, "--repo", `${parsed.owner}/${parsed.name}`, "--json", "number,title,state,body,url,updatedAt,closedAt"];
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd });
    if (!r.ok) return { ok: false, error: r.error };
    const text = r.data.stdout || "";
    let raw;
    try {
      raw = JSON.parse(text);
      if (Array.isArray(raw)) raw = raw[0];
    } catch (e) {
      return fail(ERROR_KIND.PARSE, `reopen: invalid json ${String(e.message).slice(0, 200)}`);
    }
    const normalized = normalizeIssue(Object.assign({}, raw, {
      number: raw.number ?? Number(k),
      state: "open",
      url: raw.url || raw.html_url || "",
      closedAt: null
    }));
    return { ok: true, data: normalized };
  } catch (e) {
    const kind = classifyGhError(e);
    return fail(kind, String(e && e.message || e).slice(0, 800));
  }
}
async function updateIssue(repo, key, patch, ctx) {
  try {
    const parsed = parseRepo3(repo);
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `update: repo.refId missing: ${repoId3(repo)}`);
    const k = String(key || "").trim();
    if (!k) return fail(ERROR_KIND.PARSE, "update: key required");
    if (!patch || typeof patch !== "object") return fail(ERROR_KIND.PARSE, "update: patch required");
    if (patch.milestone !== void 0 || patch.customFields !== void 0) {
      const hasMilestone = patch.milestone !== void 0;
      const hasCustom = patch.customFields !== void 0;
      if (hasCustom) return fail(ERROR_KIND.UNSUPPORTED, "update: customFields unsupported for github");
      if (hasMilestone) return fail(ERROR_KIND.UNSUPPORTED, "update: milestone unsupported (requires milestone number lookup)");
    }
    const c = ghClient(ctx);
    const args = ["issue", "edit", k, "--repo", `${parsed.owner}/${parsed.name}`, "--json", "number,title,state,body,url,updatedAt,closedAt"];
    if (typeof patch.title === "string") args.push("--title", patch.title);
    if (typeof patch.body === "string") args.push("--body", patch.body);
    if (args.length <= 8) return fail(ERROR_KIND.PARSE, "update: empty patch (no title/body)");
    const r = await c.execGh(args, { cwd: ctx && ctx.cwd });
    if (!r.ok) return { ok: false, error: r.error };
    const text = r.data.stdout || "";
    let raw;
    try {
      raw = JSON.parse(text);
      if (Array.isArray(raw)) raw = raw[0];
    } catch (e) {
      return fail(ERROR_KIND.PARSE, `update: invalid json ${String(e.message).slice(0, 200)}`);
    }
    const normalized = normalizeIssue(Object.assign({}, raw, {
      number: raw.number ?? Number(k),
      url: raw.url || raw.html_url || ""
    }));
    return { ok: true, data: normalized };
  } catch (e) {
    const kind = classifyGhError(e);
    return fail(kind, String(e && e.message || e).slice(0, 800));
  }
}
function normalizeAssigneeInput(ai) {
  if (typeof ai === "string") {
    const login2 = ai.trim();
    if (!login2) return null;
    return { login: login2 };
  }
  if (!ai || typeof ai !== "object") return null;
  const login = typeof ai.login === "string" ? ai.login.trim() : "";
  if (!login) return null;
  const out = { login };
  if (typeof ai.name === "string" && ai.name.trim() !== "") out.name = ai.name;
  if (typeof ai.avatarUrl === "string" && ai.avatarUrl !== "") out.avatarUrl = ai.avatarUrl;
  if (typeof ai.kind === "string" && ai.kind) out.kind = ai.kind;
  return out;
}
async function setAssignees(repo, key, assignees, opts, ctx) {
  try {
    const parsed = parseRepo3(repo);
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `setAssignees: repo.refId missing: ${repoId3(repo)}`);
    const k = String(key || "").trim();
    if (!k) return fail(ERROR_KIND.PARSE, "setAssignees: key required");
    const wanted = [];
    const seen = /* @__PURE__ */ new Set();
    if (Array.isArray(assignees)) {
      for (const ai of assignees) {
        const a = normalizeAssigneeInput(ai);
        if (!a) continue;
        if (seen.has(a.login)) continue;
        seen.add(a.login);
        wanted.push(a);
      }
    }
    if (opts && typeof opts.expectedUpdatedAt === "string" && opts.expectedUpdatedAt !== "") {
      const cur = await getIssue(repo, k, {}, ctx);
      if (!cur.ok) return cur;
      if (cur.data.updatedAt !== opts.expectedUpdatedAt) return fail(ERROR_KIND.CONFLICT, `conflict: expectedUpdatedAt mismatch (want ${opts.expectedUpdatedAt} got ${cur.data.updatedAt})`);
    }
    const c = ghClient(ctx);
    const logins = wanted.map((a) => a.login);
    const curRes = await getIssue(repo, k, {}, ctx);
    const curLogins = curRes.ok ? curRes.data.assignees.map((a) => a.login) : [];
    const toAdd = logins.filter((l) => !curLogins.includes(l));
    const toRemove = curLogins.filter((l) => !logins.includes(l));
    for (const l of toRemove) {
      const r = await c.execGh(["issue", "edit", k, "--repo", `${parsed.owner}/${parsed.name}`, "--remove-assignee", l], { cwd: ctx && ctx.cwd });
      if (!r.ok) return { ok: false, error: r.error };
    }
    for (const l of toAdd) {
      const r = await c.execGh(["issue", "edit", k, "--repo", `${parsed.owner}/${parsed.name}`, "--add-assignee", l], { cwd: ctx && ctx.cwd });
      if (!r.ok) return { ok: false, error: r.error };
    }
    const finalRes = await getIssue(repo, k, {}, ctx);
    if (!finalRes.ok) {
      const optimisticRaw = { number: Number(k) || k, title: "", state: "open", body: "", url: "", assignees: { nodes: wanted } };
      const issue = normalizeIssue(optimisticRaw);
      issue.assignees = wanted;
      return { ok: true, data: issue };
    }
    finalRes.data.assignees = wanted;
    return finalRes;
  } catch (e) {
    const kind = classifyGhError(e);
    return fail(kind, String(e && e.message || e).slice(0, 800));
  }
}
var init_issues = __esm({
  "src/host/tracker/backends/github/issues.js"() {
    init_constants();
    init_preflight();
    init_client();
    init_normalize();
    init_errors();
    init_queries();
  }
});

// src/host/tracker/backends/github/index.js
var github_exports = {};
__export(github_exports, {
  GITHUB_CHECKS: () => GITHUB_CHECKS,
  capabilities: () => capabilities,
  checks: () => checks,
  createGithubBackend: () => createGithubBackend,
  default: () => github_default,
  describe: () => describe,
  getRepoKey: () => getRepoKey,
  githubMatches: () => githubMatches,
  githubModule: () => githubModule,
  initProject: () => initProject,
  issueUrl: () => issueUrl,
  linkPattern: () => linkPattern,
  links: () => links,
  openRepository: () => openRepository,
  parseGithubRepo: () => parseGithubRepo,
  prompts: () => prompts,
  searchUrl: () => searchUrl
});
module.exports = __toCommonJS(github_exports);
init_constants();

// src/shared/labels.js
var CANONICAL_LABELS = [
  { name: "bug", color: "d73a4a", description: "Something isn't working" },
  { name: "needs-triage", color: "fbca04", description: "Maintainer needs to evaluate this issue (unexamined, awaiting diagnosis)" },
  { name: "needs-info", color: "5319e7", description: "Waiting on reporter for more information" },
  { name: "ready-for-agent", color: "0e8a16", description: "Fully specified, ready for an AFK agent to implement" },
  { name: "ready-for-human", color: "b60205", description: "Requires human implementation" },
  { name: "wayfinder:grilling", color: "9D7CD8", description: "Open decision/discussion ticket (wayfinder grilling type) \u2014 drives the deck's discuss action" },
  { name: "wayfinder:map", color: "8b5cf6", description: "The map issue (wayfinder) \u2014 owns Notes/Decisions so far/Fog" },
  { name: "wayfinder:prototype", color: "f59e0b", description: "Prototype ticket (wayfinder)" },
  { name: "wayfinder:research", color: "0ea5e9", description: "Research ticket (wayfinder)" },
  { name: "wayfinder:task", color: "10b981", description: "Task ticket (wayfinder)" }
];
var CANONICAL_LABEL_NAMES = CANONICAL_LABELS.map(function(l) {
  return l.name;
});
var CANONICAL_LABEL_SET = new Set(CANONICAL_LABEL_NAMES);

// src/host/tracker/backends/github/index.js
init_client();

// src/host/tracker/backends/github/preflight.js
init_constants();
init_client();
init_errors();
var GH_INSTALL_PROMPT = "\u8BF7\u4E3A DSH \u5B89\u88C5 GitHub CLI\uFF08gh\uFF09\u2014\u2014 \u9762\u677F\u6240\u6709\u6570\u636E\u4F9D\u8D56 gh\uFF08issue / PR / label / \u63A2\u6D4B\u94FE / \u5951\u7EA6\u540E\u7AEF\uFF09\uFF1A\\n\\n1. \u5148\u68C0\u67E5\uFF1A\u7EC8\u7AEF\u6267\u884C `gh --version`\uFF1B\u6709\u7248\u672C\u53F7\u8F93\u51FA \u2192 \u76F4\u63A5\u6C47\u62A5\u5DF2\u88C5\u7248\u672C\u5E76\u7ED3\u675F\uFF0C\u4E0D\u8981\u91CD\u590D\u5B89\u88C5\uFF1B\\n2. \u65E0 gh \u5219\u6309 OS \u5B89\u88C5\uFF08DSH \u63A2\u6D4B\u6309 PATH + PATHEXT \u627E gh.exe / gh\uFF09\uFF1A\\n   - Windows\uFF08PowerShell / pwsh\uFF09\u2192 `winget install --id GitHub.cli` \u6216 `winget install --id GitHub.GitHubDesktop` \u540E\u52FE\u9009 GitHub CLI\uFF1B\u6216\u4ECE https://cli.github.com/ \u4E0B\u8F7D GitHubCLI.msi \u5B89\u88C5\uFF0C\u5B89\u88C5\u65F6\u52FE\u9009 PATH \u9009\u9879\uFF1B\\n   - macOS \u2192 `brew install gh`\uFF1B\u6216 `brew install --cask github-cli`\uFF1B\u65E0 brew \u5219 https://cli.github.com/ \u4E0B\u8F7D .pkg\uFF1B\\n   - Linux\uFF08Debian/Ubuntu\uFF09\u2192 `sudo apt install gh` \u6216\u5B98\u65B9\u6E90 https://github.com/cli/cli/blob/trunk/docs/install_linux.md\uFF1B\\n   - Linux\uFF08Fedora\uFF09\u2192 `sudo dnf install gh`\uFF1B\\n3. \u5B89\u88C5\u540E\u9A8C\u8BC1\uFF1A\u91CD\u5F00\u7EC8\u7AEF\u4F7F PATH \u751F\u6548\uFF0C`gh --version` \u8F93\u51FA\u7248\u672C\u53F7\uFF1B\\n4. \u82E5 gh \u5DF2\u88C5\u4F46 DSH \u4ECD\u62A5\u672A\u5B89\u88C5\uFF1A\u7528\u6237\u9700\u5728 DSH \u4E2D\u70B9\u73AF\u5883\u68C0\u67E5\u7684\u300C\u91CD\u6D4B\u300D\u6309\u94AE\uFF08force \u91CD\u63A2\uFF09\uFF0C\u6216\u91CD\u542F DSH Desktop \u8BA9 ghPath \u7F13\u5B58\u5931\u6548\uFF1B\\n5. \u5B8C\u6210\u540E\u6C47\u62A5\uFF1Agh \u7248\u672C\u53F7 + DSH \u73AF\u5883\u68C0\u67E5\u4E2D\u300Cgh CLI \u53EF\u7528\u300D\u9879\u5DF2\u53D8\u7EFF\uFF08\u5982\u5DF2\u767B\u5F55 gh auth login\uFF0C\u5219\u300Cgh \u5DF2\u767B\u5F55\u300D\u4E5F\u53D8\u7EFF\uFF09\u3002";
function parseRepoRef(handle, ctx) {
  if (handle && typeof handle.refId === "string" && handle.refId) return handle.refId;
  if (ctx && typeof ctx.refId === "string" && ctx.refId) return ctx.refId;
  return null;
}
function repoFromRefId(refId) {
  if (!refId || typeof refId !== "string") return null;
  const idx = refId.indexOf("/");
  if (idx <= 0) return null;
  return { owner: refId.slice(0, idx), name: refId.slice(idx + 1) };
}
async function ghPreflight(handle, ctx) {
  const cwd = handle && handle.cwd || ctx && ctx.cwd || void 0;
  const opCtx = Object.assign({}, ctx || {}, cwd ? { cwd } : {});
  try {
    const platform = opCtx.platform;
    if (!platform || typeof platform.resolveExecutable !== "function") {
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: "gh not found: platform.resolveExecutable unavailable" }, prompt: GH_INSTALL_PROMPT };
    }
    const ghPath = await platform.resolveExecutable("gh");
    if (!ghPath) {
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: "gh not found: platform.resolveExecutable returned null (install https://cli.github.com/)" }, prompt: GH_INSTALL_PROMPT };
    }
  } catch (e) {
    return { ok: false, error: { kind: ERROR_KIND.ENV, message: String(e && e.message || e).slice(0, 400) }, prompt: GH_INSTALL_PROMPT };
  }
  try {
    const c = ghClient(opCtx);
    const r = await c.execGh(["auth", "status"], { cwd });
    if (!r.ok) {
      const kind = r.error && r.error.kind ? r.error.kind : classifyGhError(r.error);
      if (kind === ERROR_KIND.ENV) return { ok: false, error: r.error };
      if (kind === ERROR_KIND.AUTH) return { ok: false, error: r.error };
      return { ok: false, error: r.error };
    }
  } catch (e) {
    const kind = classifyGhError(e);
    if (kind === ERROR_KIND.AUTH) return { ok: false, error: { kind, message: String(e && e.message || e).slice(0, 400) } };
    return { ok: false, error: { kind, message: String(e && e.message || e).slice(0, 400) } };
  }
  try {
    let refId = parseRepoRef(handle, opCtx);
    if (!refId) {
      const c2 = ghClient(opCtx);
      const rr = await c2.execGh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { cwd });
      if (rr.ok) {
        const s = (rr.data.stdout || "").trim();
        if (s && s.includes("/")) refId = s;
      }
    }
    if (!refId) {
      return { ok: false, error: { kind: ERROR_KIND.NOTFOUND, message: "repo not found: cannot resolve owner/name (no refId and gh repo view failed)" } };
    }
    const repo = repoFromRefId(refId);
    if (!repo) return { ok: false, error: { kind: ERROR_KIND.NOTFOUND, message: `repo refId malformed: ${refId}` } };
    const c = ghClient(opCtx);
    const r = await c.execGh(["api", `repos/${repo.owner}/${repo.name}`], { cwd });
    if (!r.ok) {
      return { ok: false, error: r.error };
    }
    return { ok: true };
  } catch (e) {
    const kind = classifyGhError(e);
    return { ok: false, error: { kind, message: String(e && e.message || e).slice(0, 400) } };
  }
}

// src/host/tracker/backends/github/index.js
init_issues();

// src/host/tracker/backends/github/comments.js
init_constants();
init_preflight();
init_client();
init_errors();
function parseRepo4(repo) {
  if (!repo || typeof repo.refId !== "string" || !repo.refId) return null;
  const s = repo.refId.trim();
  const idx = s.indexOf("/");
  if (idx <= 0) return null;
  return { owner: s.slice(0, idx), name: s.slice(idx + 1) };
}
function repoId4(repo) {
  if (!repo) return "";
  if (typeof repo.refId === "string" && repo.refId) return repo.refId;
  if (typeof repo.name === "string" && repo.name) return repo.name;
  return "";
}
async function addComment(repo, key, body, ctx) {
  try {
    const parsed = parseRepo4(repo);
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `comment: repo.refId missing: ${repoId4(repo)}`);
    const k = String(key || "").trim();
    if (!k) return fail(ERROR_KIND.PARSE, "comment: key required");
    if (typeof body !== "string" || !body.trim()) return fail(ERROR_KIND.PARSE, "comment: body required");
    const c = ghClient(ctx);
    const args = ["api", `repos/${parsed.owner}/${parsed.name}/issues/${k}/comments`, "--method", "POST", "-f", `body=${body}`, "--jq", "."];
    let r = await c.execGh(args, { cwd: ctx && ctx.cwd });
    if (!r.ok) {
      const alt = ["issue", "comment", k, "--repo", `${parsed.owner}/${parsed.name}`, "--body", body, "--json", "id,author,body,createdAt,updatedAt"];
      r = await c.execGh(alt, { cwd: ctx && ctx.cwd });
      if (!r.ok) return { ok: false, error: r.error };
    }
    const text = r.data.stdout || r.data.stderr || "";
    let raw = null;
    try {
      raw = JSON.parse(text);
      if (Array.isArray(raw)) raw = raw[0];
    } catch {
      raw = { body, author: { login: "" }, createdAt: (/* @__PURE__ */ new Date()).toISOString(), updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
    const authorLogin = raw && raw.author && raw.author.login || raw && raw.user && raw.user.login || "";
    const comment = {
      id: raw && raw.id != null ? String(raw.id) : void 0,
      author: { login: String(authorLogin) },
      authorAssociation: raw && (raw.authorAssociation || raw.author_association) || "",
      body: raw && typeof raw.body === "string" ? raw.body : body,
      createdAt: raw && (raw.createdAt || raw.created_at) || (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: raw && (raw.updatedAt || raw.updated_at) || (/* @__PURE__ */ new Date()).toISOString()
    };
    if (raw && (raw.editedAt || raw.edited_at)) comment.editedAt = raw.editedAt || raw.edited_at;
    return { ok: true, data: comment };
  } catch (e) {
    const kind = classifyGhError(e);
    return fail(kind, String(e && e.message || e).slice(0, 800));
  }
}

// src/host/tracker/backends/github/index.js
init_labels();
init_graph();
function parseGithubRepo(url) {
  const s = String(url || "").trim();
  const m = s.match(/github\.com[\/:]([^\/\s]+)\/([^\/\s]+?)(?:\.git)?\s*$/);
  if (!m) return null;
  return { owner: m[1], name: m[2] };
}
function describe(handle, backendId) {
  const rawRef = handle && typeof handle.refId === "string" && handle.refId ? String(handle.refId).trim() : "";
  const cwd = handle && typeof handle.cwd === "string" ? String(handle.cwd) : "";
  let refId = rawRef;
  if (!refId && cwd && cwd.includes("/") && !cwd.includes("\\") && cwd.split("/").length === 2) {
    const maybe = cwd.trim();
    if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(maybe)) refId = maybe;
  }
  const name = refId || (cwd ? cwd.split(/[\\/]/).pop() || cwd : backendId) || backendId;
  const url = refId && refId.includes("/") ? "https://github.com/" + refId : "";
  return { backend: backendId, refId: refId || "", name: name || refId || backendId, url };
}
function issueUrl(ref, key) {
  const refId = ref && typeof ref.refId === "string" ? ref.refId : "";
  if (!refId) return "";
  return "https://github.com/" + refId + "/issues/" + String(key);
}
function searchUrl(name) {
  return "https://github.com/search?q=" + encodeURIComponent(String(name || ""));
}
var linkPattern = /github\.com\/[^\/\s]+\/[^\/\s]+\/issues\/(\d+)/g;
var links = {
  issueUrlTemplate: "https://github.com/{refId}/issues/{key}",
  repoUrlTemplate: "https://github.com/{refId}",
  searchUrlTemplate: "https://github.com/search?q={q}",
  linkPatternSource: "github\\.com\\/[^\\/\\s]+\\/[^\\/\\s]+\\/issues\\/(\\d+)"
};
var capabilities = { labelsGuide: true, repoCreateChain: true };
var openRepository = "url";
var prompts = (function() {
  const names = CANONICAL_LABELS.map(function(l) {
    return l && l.name ? String(l.name) : String(l);
  });
  const zhNames = names.join(", ");
  const enNames = names.join(", ");
  return {
    ensureLabels: {
      zh: "\u8BF7\u4E3A\u5F53\u524D\u4ED3\u5E93\u8865\u5168\u7F3A\u5931\u7684\u6838\u5FC3\u6807\u7B7E\uFF08\u5171 " + names.length + " \u4E2A\uFF09\uFF1A\n\n\u5FC5\u5907\u6807\u7B7E\uFF1A" + zhNames + '\n\n\u6B65\u9AA4\uFF1A\n- [ ] \u5148\u68C0\u67E5\u73B0\u6709\u6807\u7B7E\uFF08gh api repos/{owner}/{repo}/labels \u6216 gh label list --json name\uFF1B\u540D\u5927\u5C0F\u5199\u4E0D\u654F\u611F\uFF09\n- [ ] \u5BF9\u7F3A\u5931\u7684\u6BCF\u4E2A\u6807\u7B7E\u6267\u884C gh label create --repo {owner}/{repo} --name "<name>" --color <color> --description "<desc>"\uFF08\u5DF2\u5B58\u5728\u8DF3\u8FC7\uFF0C\u5E42\u7B49\uFF1B\u5931\u8D25\u4E0D\u56DE\u6EDA\u4ED3\u5E93\uFF09\n- [ ] \u5B8C\u6210\u540E\u7528 gh label list \u590D\u67E5\u76F4\u81F3\u9F50\u5168\n\n\u8272\u503C/\u63CF\u8FF0\u4EE5 src/shared/labels.js \u5355\u6E90\u4E3A\u51C6\uFF0C\u4EC5\u6821\u9A8C\u540D\u5B50\u96C6\u3002',
      en: "Please complete the missing canonical labels (" + names.length + " total):\n\nRequired labels: " + enNames + '\n\nSteps:\n- [ ] Check existing labels first (gh api repos/{owner}/{repo}/labels or gh label list --json name; case-insensitive)\n- [ ] For each missing label run gh label create --repo {owner}/{repo} --name "<name>" --color <color> --description "<desc>" (skip if exists, idempotent; do not rollback on failure)\n- [ ] Re-check via gh label list afterwards until complete\n\nColors/descriptions are single-sourced in src/shared/labels.js; verification is name-subset only.'
    },
    ghAuthLogin: {
      zh: "\u8BF7\u5B8C\u6210 gh \u767B\u5F55\uFF1A\u8FD0\u884C gh auth login \u5E76\u6309\u63D0\u793A\u5728\u6D4F\u89C8\u5668\u5B8C\u6210\u6388\u6743\uFF1B\u7ED3\u675F\u540E\u8FD0\u884C gh auth status \u786E\u8BA4\u5DF2\u767B\u5F55\u3002",
      en: "Please complete gh login: run gh auth login and finish browser authorization; afterwards run gh auth status to confirm."
    },
    noGhPrompt: {
      zh: "\u8BF7\u4E3A DSH \u5B89\u88C5 GitHub CLI\uFF08gh\uFF09\u2014\u2014 \u9762\u677F\u6240\u6709\u6570\u636E\u4F9D\u8D56 gh\uFF1A\n\n1. \u5148\u68C0\u67E5\uFF1A\u7EC8\u7AEF\u6267\u884C gh --version\uFF1B\n2. \u65E0 gh \u5219\u6309 OS \u5B89\u88C5\uFF1AWindows \u2192 winget install --id GitHub.cli\uFF1BmacOS \u2192 brew install gh\uFF1BLinux \u2192 sudo apt install gh\u3002",
      en: "Install the GitHub CLI (gh) for DSH \u2014 all panel data depends on it:\n\n1. Check first: run gh --version;\n2. If missing, install per OS: Windows \u2192 winget install --id GitHub.cli; macOS \u2192 brew install gh; Linux \u2192 sudo apt install gh."
    },
    errorKinds: {
      "no-git": { zh: "\u672A\u627E\u5230 git\uFF0C\u8BF7\u5148\u5B89\u88C5 Git", en: "git not found \u2014 please install Git" },
      "no-gh": { zh: "\u672A\u627E\u5230 gh\uFF0C\u8BF7\u5148\u5B89\u88C5 GitHub CLI", en: "gh not found \u2014 please install GitHub CLI" },
      "not-logged-in": { zh: "\u672A\u767B\u5F55 GitHub\uFF0C\u8BF7\u5148\u6267\u884C gh auth login", en: "Not logged into GitHub \u2014 run gh auth login" },
      "already-exists": { zh: "\u540C\u540D\u4ED3\u5E93\u5DF2\u5B58\u5728\uFF08\u53EF\u5728\u5E73\u53F0\u67E5\u770B\uFF09", en: "Repository already exists (view it on the platform)" }
    }
  };
})();
async function getRepoKey(cwd, ctx) {
  const execCwd = cwd || "";
  const platform = ctx && ctx.platform ? ctx.platform : null;
  const fs = platform && platform.fs ? platform.fs : ctx && ctx.fs ? ctx.fs : null;
  try {
    if (platform && typeof platform.resolveExecutable === "function") {
      const git = await platform.resolveExecutable("git");
      if (git && ctx && typeof ctx.exec === "function") {
        try {
          const r = await ctx.exec("git", ["-C", execCwd, "remote", "get-url", "origin"], { cwd: execCwd, timeout: 3e3 });
          const out = r && (r.stdout || r.text || r.stdout === "" ? r.stdout || r.text : "") || "";
          const k = parseGithubRepo(String(out));
          if (k) return k;
        } catch (e) {
        }
      } else if (git) {
        try {
          const execFn = ctx.exec || platform && platform.exec;
          if (typeof execFn === "function") {
            const r2 = await execFn("git", ["-C", execCwd, "remote", "get-url", "origin"], { cwd: execCwd, timeout: 3e3 });
            const out2 = r2 && (r2.stdout || r2.text) || "";
            const k2 = parseGithubRepo(String(out2));
            if (k2) return k2;
          }
        } catch (e2) {
        }
      }
    }
  } catch (e) {
  }
  if (fs && typeof fs.resolve === "function" && typeof fs.readText === "function") {
    try {
      const t = await fs.resolve(".git/config", { cwd: execCwd });
      const txt = await fs.readText(t);
      const um = String(txt || "").match(/\[remote\s+"origin"\][^[]*url\s*=\s*([^\r\n]+)/);
      if (um) {
        const k = parseGithubRepo(um[1]);
        if (k) return k;
      }
      const um2 = String(txt || "").match(/url\s*=\s*(.+)/);
      if (um2 && !um) {
        const k2 = parseGithubRepo(um2[1]);
        if (k2) return k2;
      }
    } catch (e) {
    }
  }
  try {
    const c = ghClient(ctx);
    const rr = await c.execGh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { cwd: execCwd });
    if (rr && rr.ok) {
      const s = (rr.data.stdout || "").trim();
      const idx = s.indexOf("/");
      if (idx > 0) return { owner: s.slice(0, idx), name: s.slice(idx + 1) };
    }
  } catch (e) {
  }
  return null;
}
var GITHUB_CHECKS = Object.freeze([
  {
    id: "gh:remote",
    label: "GitHub \u8FDC\u7AEF\u53EF\u89E3\u6790\uFF08git remote origin \u2192 owner/name\uFF09",
    scope: "backend",
    backends: ["github"],
    check: { kind: "backend", id: "repoRemote", backendId: "github" },
    origin: "host/checkRepo\u2192github/repo.js:parseGithubRepo (inventory \u7C7B\u522B 8 c1)"
  },
  {
    id: "gh:installed",
    label: "GitHub CLI (gh) \u5DF2\u5B89\u88C5",
    scope: "backend",
    backends: ["github"],
    check: { kind: "primitive", primitive: "commandExists", command: "gh" },
    origin: "host/index.js:checkGhCli / backends/github/preflight.js:1 (inventory \u7C7B\u522B 8 c4)"
  },
  {
    id: "gh:authed",
    label: "gh \u5DF2\u767B\u5F55\uFF08gh auth status\uFF09",
    scope: "backend",
    backends: ["github"],
    check: { kind: "preflight", id: "ghAuth" },
    origin: "host/index.js:checkGhAuth / backends/github/preflight.js:2 (c5)"
  },
  {
    id: "gh:repoAccess",
    label: "\u4ED3\u5E93\u53EF\u8FBE\uFF08gh api repos/{owner}/{name}\uFF09",
    scope: "backend",
    backends: ["github"],
    check: { kind: "backend", id: "repoAccess", backendId: "github" },
    origin: "backends/github/preflight.js:3 / inventory \u7C7B\u522B 8 c6"
  }
]);
function checks() {
  return [...GITHUB_CHECKS];
}
async function initProject(handle, input, ctx) {
  const cwd = handle && handle.cwd || ctx && ctx.cwd || "";
  const name = input && input.name ? String(input.name).trim() : "";
  const visibility = input && input.visibility === "public" ? "public" : "private";
  if (!name) return { ok: false, error: { kind: "bad-name", message: "\u4ED3\u5E93\u540D\u4E3A\u7A7A" } };
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.length > 100) {
    return { ok: false, error: { kind: "bad-name", message: "\u4ED3\u5E93\u540D\u4EC5\u652F\u6301\u5B57\u6BCD/\u6570\u5B57/._- \u4E14 \u2264100\uFF1A" + name } };
  }
  const visFlag = visibility === "public" ? "--public" : "--private";
  const platform = ctx && ctx.platform ? ctx.platform : null;
  const execFn = ctx && typeof ctx.exec === "function" ? ctx.exec.bind(ctx) : platform && typeof platform.exec === "function" ? platform.exec.bind(platform) : null;
  async function execProcLocal(argv, execCwd) {
    const cmd = argv[0];
    const args = argv.slice(1);
    if (execFn) {
      try {
        const r = await execFn(cmd, args, { cwd: execCwd || cwd, timeout: 3e4 });
        const code = r && typeof r.code === "number" ? r.code : 0;
        const out = r && typeof r.stdout === "string" ? r.stdout : r && r.text ? r.text : "";
        const err = r && typeof r.stderr === "string" ? r.stderr : "";
        if (code !== 0) return { ok: false, code, error: (err || out || "exit " + code).slice(0, 400), text: out };
        return { ok: true, code: 0, text: out };
      } catch (e) {
        return { ok: false, code: -1, error: String(e && e.message || e).slice(0, 400), text: "" };
      }
    }
    return { ok: false, code: -1, error: "exec unavailable", text: "" };
  }
  async function resolveGitLocal() {
    if (platform && typeof platform.resolveExecutable === "function") {
      try {
        const p = await platform.resolveExecutable("git");
        if (p) return p;
      } catch (e) {
      }
    }
    if (execFn) {
      try {
        const r = await execFn("git", ["--version"], { cwd, timeout: 3e3 });
        if (r && r.code === 0) return "git";
      } catch (e) {
      }
    }
    return null;
  }
  async function resolveGhLocal() {
    if (platform && typeof platform.resolveExecutable === "function") {
      try {
        const p = await platform.resolveExecutable("gh");
        if (p) return p;
      } catch (e) {
      }
    }
    return null;
  }
  function classifyCreateError(errText, kind) {
    const low = String(errText || "").toLowerCase();
    if (/already exists|name already exists|already exists on github|repository.*already exists/i.test(low)) return "already-exists";
    if (kind === "network" || /network|econn|timed out|timeout|enotfound|getaddrinfo|connect etimedout|unable to access|failed to connect|could not resolve host/i.test(low)) return "network";
    if (/not logged in|auth failed|bad credentials|authentication required|gh auth login/i.test(low)) return "not-logged-in";
    if (/permission|forbidden|403|401|insufficient|not authorized|resource not accessible|must be.*admin/i.test(low)) return "permission";
    if (kind === "auth") return "not-logged-in";
    return "permission";
  }
  const git = await resolveGitLocal();
  if (!git) return { ok: false, error: { kind: "no-git", message: "\u672A\u627E\u5230 git\uFF08\u8BF7\u5B89\u88C5 https://git-scm.com/\uFF09" } };
  const gh = await resolveGhLocal();
  if (!gh) return { ok: false, error: { kind: "no-gh", message: "\u672A\u627E\u5230 gh\uFF08\u8BF7\u5B89\u88C5 https://cli.github.com/\uFF09", prompt: "\u8BF7\u4E3A DSH \u5B89\u88C5 GitHub CLI\uFF08gh\uFF09\u2014\u2014 \u9762\u677F\u6240\u6709\u6570\u636E\u4F9D\u8D56 gh\uFF1A\n\n1. \u5148\u68C0\u67E5\uFF1A\u7EC8\u7AEF\u6267\u884C gh --version;\n2. \u65E0 gh \u5219\u6309 OS \u5B89\u88C5\uFF1AWindows \u2192 winget install --id GitHub.cli; macOS \u2192 brew install gh; Linux \u2192 sudo apt install gh;\n3. \u5B89\u88C5\u540E\u9A8C\u8BC1\uFF1Agh --version;\n4. \u82E5 gh \u5DF2\u88C5\u4F46 DSH \u4ECD\u62A5\u672A\u5B89\u88C5\uFF1A\u70B9\u73AF\u5883\u68C0\u67E5\u300C\u91CD\u6D4B\u300D\u6309\u94AE\u6216\u91CD\u542F DSH Desktop\uFF1B\n5. \u5B8C\u6210\u540E\u6C47\u62A5\uFF1Agh \u7248\u672C\u53F7 + \u300Cgh CLI \u53EF\u7528\u300D\u9879\u5DF2\u53D8\u7EFF\u3002" } };
  try {
    const c = ghClient(ctx);
    const authR = await c.execGh(["auth", "status"], { cwd });
    if (!authR.ok) {
      const t = String(authR.error && authR.error.message || authR.error || "").toLowerCase();
      const kind = authR.error && authR.error.kind;
      if (kind === "network" || /network|econn|timed out|timeout|enotfound|getaddrinfo|connect/.test(t)) {
        return { ok: false, error: { kind: "network", message: String(authR.error.message || authR.error).slice(0, 400) } };
      }
      return { ok: false, error: { kind: "not-logged-in", message: String(authR.error.message || authR.error).slice(0, 400) } };
    }
  } catch (e) {
    const t = String(e && e.message || e).toLowerCase();
    if (/network|econn|timed out|timeout|enotfound|getaddrinfo|connect/.test(t)) return { ok: false, error: { kind: "network", message: String(e && e.message || e).slice(0, 400) } };
    return { ok: false, error: { kind: "not-logged-in", message: String(e && e.message || e).slice(0, 400) } };
  }
  let currentUser = "";
  try {
    const c2 = ghClient(ctx);
    const u = await c2.execGh(["api", "user", "-q", ".login"], { cwd });
    if (u && u.ok) currentUser = (u.data.stdout || "").trim();
  } catch (e) {
  }
  try {
    const probe = await execProcLocal([git, "-C", cwd, "rev-parse", "--is-inside-work-tree"], cwd);
    if (!probe.ok) {
      const initR = await execProcLocal([git, "init"], cwd);
      if (!initR.ok) {
        const k = classifyCreateError(initR.error, null);
        return { ok: false, error: { kind: k === "already-exists" ? "permission" : k, message: initR.error } };
      }
    }
  } catch (e) {
    const initR = await execProcLocal([git, "init"], cwd);
    if (!initR.ok) {
      const k = classifyCreateError(initR.error, null);
      return { ok: false, error: { kind: k === "already-exists" ? "permission" : k, message: initR.error } };
    }
  }
  const addR = await execProcLocal([git, "add", "."], cwd);
  if (!addR.ok) {
    const k = classifyCreateError(addR.error, null);
    return { ok: false, error: { kind: k, message: addR.error } };
  }
  let commitR = await execProcLocal([git, "commit", "-m", "initial commit", "--allow-empty"], cwd);
  if (!commitR.ok) {
    const low = String(commitR.error || "").toLowerCase();
    if (/please tell me who you are|user\.name|user\.email|author identity unknown|unable to auto-detect email/.test(low)) {
      await execProcLocal([git, "config", "user.email", "dsh@local"], cwd);
      await execProcLocal([git, "config", "user.name", "DSH User"], cwd);
      commitR = await execProcLocal([git, "commit", "-m", "initial commit", "--allow-empty"], cwd);
    }
    if (!commitR.ok) {
      const k = classifyCreateError(commitR.error, null);
      return { ok: false, error: { kind: k, message: commitR.error } };
    }
  }
  let hasOrigin = false;
  try {
    const ro = await execProcLocal([git, "remote", "get-url", "origin"], cwd);
    hasOrigin = !!ro.ok;
  } catch (e) {
    hasOrigin = false;
  }
  const cGH = ghClient(ctx);
  if (!hasOrigin) {
    const cr = await cGH.execGh(["repo", "create", name, visFlag, "--source=.", "--push"], { cwd });
    if (!cr.ok) {
      const kind = classifyCreateError(cr.error.message || cr.error, cr.error && cr.error.kind);
      const repoUrl = kind === "already-exists" && currentUser ? "https://github.com/" + currentUser + "/" + name : void 0;
      const err = { kind, message: String(cr.error.message || cr.error).slice(0, 400) };
      if (repoUrl) err.repoUrl = repoUrl;
      if (cr.error && cr.error.prompt) err.prompt = cr.error.prompt;
      return { ok: false, error: err };
    }
  } else {
    const cr2 = await cGH.execGh(["repo", "create", name, visFlag], { cwd });
    if (!cr2.ok) {
      const kind = classifyCreateError(cr2.error.message || cr2.error, cr2.error && cr2.error.kind);
      const repoUrl = kind === "already-exists" && currentUser ? "https://github.com/" + currentUser + "/" + name : void 0;
      const err = { kind, message: String(cr2.error.message || cr2.error).slice(0, 400) };
      if (repoUrl) err.repoUrl = repoUrl;
      return { ok: false, error: err };
    }
    let remoteUrl = "";
    if (currentUser) remoteUrl = "https://github.com/" + currentUser + "/" + name + ".git";
    else {
      const m = String(cr2.data && cr2.data.stdout || "").match(/https:\/\/github\.com\/[^\s\/]+\/[^\s\/]+/);
      if (m) remoteUrl = m[0] + ".git";
    }
    if (remoteUrl) {
      await execProcLocal([git, "remote", "set-url", "origin", remoteUrl], cwd);
    }
    const pushR = await execProcLocal([git, "push", "-u", "origin", "HEAD"], cwd);
    if (!pushR.ok) {
      const kind = classifyCreateError(pushR.error, null);
      return { ok: false, error: { kind, message: pushR.error } };
    }
  }
  let owner = currentUser;
  try {
    const rk = await getRepoKey(cwd, ctx);
    if (rk && rk.owner) owner = rk.owner;
  } catch (e) {
  }
  if (!owner) {
    try {
      const c3 = ghClient(ctx);
      const u2 = await c3.execGh(["api", "user", "-q", ".login"], { cwd });
      if (u2 && u2.ok) owner = (u2.data.stdout || "").trim();
    } catch (e2) {
    }
  }
  const refId = owner ? owner + "/" + name : name;
  const repoRef = { backend: "github", refId, name: refId, url: "https://github.com/" + refId };
  return { ok: true, data: repoRef };
}
async function githubMatches(handle, ctx) {
  try {
    if (handle && typeof handle.refId === "string" && handle.refId.includes("/")) {
      return true;
    }
    const platform = ctx && ctx.platform ? ctx.platform : null;
    const fs = platform && platform.fs ? platform.fs : ctx && ctx.fs ? ctx.fs : null;
    const cwd = handle && handle.cwd || ctx && ctx.cwd || "";
    if (fs && cwd && typeof fs.readText === "function" && typeof fs.resolve === "function") {
      try {
        const t = await fs.resolve(".git/config", { cwd });
        const txt = await fs.readText(t);
        if (typeof txt === "string" && /github\.com/i.test(txt)) return true;
      } catch {
      }
    }
    if (ctx && typeof ctx.exec === "function" && cwd) {
      try {
        const r = await ctx.exec("git", ["-C", cwd, "remote", "get-url", "origin"], { cwd, timeout: 3e3 });
        const out = r && (r.stdout || r.text) || "";
        if (/github\.com/i.test(String(out))) return true;
      } catch {
      }
    }
    return false;
  } catch {
    return false;
  }
}
function createGithubBackend(ctx) {
  void ghClient(ctx);
  return {
    id: "github",
    preflight: (handle, opCtx) => ghPreflight(handle, opCtx || ctx),
    list: (repo, filter, opCtx) => listIssues(repo, filter, opCtx || ctx),
    get: (repo, key, opts, opCtx) => getIssue(repo, key, opts, opCtx || ctx),
    getDependencies: (repo, key, opts, opCtx) => getDependencies(repo, key, opts, opCtx || ctx),
    create: (repo, input, opCtx) => createIssue(repo, input, opCtx || ctx),
    close: (repo, key, opts, opCtx) => closeIssue(repo, key, opts, opCtx || ctx),
    reopen: (repo, key, opCtx) => reopenIssue(repo, key, opCtx || ctx),
    comment: (repo, key, body, opCtx) => addComment(repo, key, body, opCtx || ctx),
    update: (repo, key, patch, opCtx) => updateIssue(repo, key, patch, opCtx || ctx),
    setLabels: (repo, key, labels, opts, opCtx) => setLabels(repo, key, labels, opts, opCtx || ctx),
    setAssignees: (repo, key, assignees, opts, opCtx) => setAssignees(repo, key, assignees, opts, opCtx || ctx),
    setParent: (repo, key, parentKey, opts, opCtx) => setParent(repo, key, parentKey, opts, opCtx || ctx),
    setBlockedBy: (repo, key, blockers, opts, opCtx) => setBlockedBy(repo, key, blockers, opts, opCtx || ctx),
    getCurrentUser: async (repo, opCtx) => {
      const c = ghClient(opCtx || ctx);
      const r = await c.execGh(["api", "user", "--jq", "{login: .login, name: .name, avatarUrl: .avatar_url}"], { cwd: opCtx && opCtx.cwd || ctx && ctx.cwd });
      if (!r.ok) {
        const kind = r.error && r.error.kind || "unsupported";
        if (kind === "auth" || kind === "unsupported") return { ok: false, error: { kind: ERROR_KIND.UNSUPPORTED, message: r.error && r.error.message || "viewer unsupported" } };
        return { ok: false, error: r.error };
      }
      try {
        const j = JSON.parse(r.data.stdout || r.data.text || "{}");
        const login = String(j.login || "").trim();
        if (!login) return { ok: false, error: { kind: ERROR_KIND.UNSUPPORTED, message: "viewer login empty" } };
        const actor = { login };
        if (j.name) actor.name = String(j.name);
        if (j.avatarUrl) actor.avatarUrl = String(j.avatarUrl);
        else if (j.avatar_url) actor.avatarUrl = String(j.avatar_url);
        actor.kind = "user";
        return { ok: true, data: actor };
      } catch (e) {
        return { ok: false, error: { kind: ERROR_KIND.PARSE, message: String(e.message || e) } };
      }
    },
    initProject: (handle, input, opCtx) => initProject(handle, input, opCtx || ctx),
    describe: (handle, opCtx) => describe(handle, "github"),
    issueUrl: (ref, key) => issueUrl(ref, key)
  };
}
var githubModule = {
  id: "github",
  label: "GitHub",
  // #191：品牌色完整色板（B 方案定版 · #177）——后端是配色单一真源，UI 仅消费
  presentation: {
    color: "#0969da",
    darkColor: "#58a6ff",
    bg: "light-dark(#ddf4ff, rgba(56,139,253,.15))",
    border: "light-dark(rgba(84,174,255,.4), rgba(56,139,253,.4))"
  },
  // #230（D10 · 键入 locale）：setup 提示词描述数据 —— 只声明 client locale 双语键名，文案不落后端（双语单源）
  setupPrompt: {
    trackerLine: "setup.github.trackerLine",
    trackerChoice: "setup.github.trackerChoice",
    backendNote: "setup.github.backendNote",
    labelReqs: "setup.github.labelReqs"
  },
  create: createGithubBackend,
  matches: githubMatches,
  describe,
  issueUrl,
  searchUrl,
  linkPattern,
  links,
  capabilities,
  prompts,
  checks
};
var github_default = createGithubBackend;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GITHUB_CHECKS,
  capabilities,
  checks,
  createGithubBackend,
  describe,
  getRepoKey,
  githubMatches,
  githubModule,
  initProject,
  issueUrl,
  linkPattern,
  links,
  openRepository,
  parseGithubRepo,
  prompts,
  searchUrl
});
