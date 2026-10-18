import { readFileSync } from "node:fs";
const DSW_RPC_CHANNEL = "dsws";
const DSW_RPC_ROUTE = "/api/" + DSW_RPC_CHANNEL;
const DSH_RPC_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DSW_ENDPOINT_PATTERN = /^[A-Za-z0-9_$.-]+$/;
function replyEnvelope(rpcId, result) {
  return Response.json({ type: "server-response", rpcId, result });
}
const MANIFEST_CANDIDATES = ["../package.json", "../../package/package.json"];
const MANIFEST_NAME = "dsh-mattpocock-skills-deck";
let servingVersion = null;
function versionOfServingCopy() {
  if (servingVersion !== null) return servingVersion;
  servingVersion = "unknown";
  for (const rel of MANIFEST_CANDIDATES) {
    try {
      const url = new URL(rel, import.meta.url);
      const pkg = JSON.parse(readFileSync(url, "utf8"));
      const v = pkg && pkg.name === MANIFEST_NAME ? String(pkg.version || "") : "";
      if (v) {
        servingVersion = "v" + v;
        break;
      }
    } catch (e) {
    }
  }
  return servingVersion;
}
function emptyReplyShape(value) {
  if (value === void 0) return "no-value";
  if (value === null) return "null-value";
  if (typeof value === "object" && !Array.isArray(value) && value.ok === false && !String(value.error || "").trim()) return "no-error";
  return "";
}
function rpcIdOf(raw) {
  return typeof raw === "string" && DSH_RPC_ID_PATTERN.test(raw) ? raw : "invalid-request";
}
function createRpcChannel(deps) {
  const ctx = deps.ctx;
  const handlers = deps.handlers;
  const fireLog = deps.fireLog;
  const dispatchMeta = deps.dispatchMeta;
  const log = deps.fireLog;
  const reportRegisterFail = function(kind, failMsg) {
    const say = kind + (typeof failMsg === "string" && failMsg !== "" ? "\uFF1A" + failMsg.slice(0, 120) : "");
    try {
      fireLog("error", "host.dispatch.error", { method: DSW_RPC_ROUTE + " \u901A\u9053\u6CE8\u518C", argsHash: "", errorKind: "internal" });
    } catch (eLog) {
    }
    return say;
  };
  const dispatchRpcEndpoint = async function(endpoint, payload) {
    const fn = handlers.get(endpoint);
    if (!fn) {
      try {
        log("warn", "host.dispatch.empty", { method: "wf." + endpoint, shape: "unknown-endpoint", version: versionOfServingCopy() });
      } catch (eL) {
      }
      return { ok: false, error: { code: "internal", message: "unknown endpoint: " + endpoint, details: {} } };
    }
    try {
      const value = await fn(payload);
      const shape = emptyReplyShape(value);
      if (shape) {
        try {
          log("warn", "host.dispatch.empty", { method: "wf." + endpoint, shape, version: versionOfServingCopy() });
        } catch (eL) {
        }
      }
      return { ok: true, value };
    } catch (e) {
      try {
        dispatchMeta().then(function(dm) {
          try {
            fireLog("error", "host.dispatch.error", { method: "wf." + endpoint, argsHash: dm.shortArgHash(payload), errorKind: dm.dispatchErrorKind(e) });
          } catch (eInner) {
          }
        }).catch(function() {
        });
      } catch (eLog) {
      }
      return { ok: false, error: { code: "internal", message: String(e && e.message || e), details: {} } };
    }
  };
  const badRequest = function(rpcId, why) {
    return replyEnvelope(rpcId, { ok: false, error: { code: "gateway/bad-request", message: why, details: {} } });
  };
  const routeFetch = async function(request) {
    if (!request || request.method !== "POST") return new Response("method not allowed", { status: 405 });
    let body = null;
    try {
      body = await request.json();
    } catch (eBody) {
      return new Response("body is not JSON", { status: 400 });
    }
    const rpcId = rpcIdOf(body && body.rpcId);
    const message = body && typeof body === "object" ? body : {};
    const call = message.payload;
    if (call === null || typeof call !== "object") return badRequest(rpcId, "missing call payload");
    if (message.type !== "client-request") return badRequest(rpcId, "invalid client-request message");
    if (typeof message.rpcId !== "string" || !DSH_RPC_ID_PATTERN.test(message.rpcId)) return badRequest(rpcId, "invalid rpcId");
    const endpoint = call.method;
    if (typeof endpoint !== "string" || !DSW_ENDPOINT_PATTERN.test(endpoint)) return badRequest(rpcId, "invalid endpoint name");
    const pathname = String(request.url && request.url.split("?")[0] || "");
    if (!pathname.endsWith(DSW_RPC_ROUTE)) return badRequest(rpcId, "request path is not on channel " + DSW_RPC_ROUTE);
    return replyEnvelope(rpcId, await dispatchRpcEndpoint(endpoint, call.payload));
  };
  try {
    const connection = ctx.get("connection");
    const fetchRegistry = connection !== void 0 && connection !== null ? connection.fetch : void 0;
    if (fetchRegistry === void 0 || typeof fetchRegistry.register !== "function") {
      reportRegisterFail("connection.fetch.register-missing");
      return { ok: false, path: DSW_RPC_ROUTE, reason: "connection.fetch.register-missing" };
    }
    const disposed = fetchRegistry.register({
      path: DSW_RPC_ROUTE,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: routeFetch
    });
    if (typeof disposed !== "function" && typeof ctx.effect === "function") {
      try {
        ctx.effect(function() {
          return function() {
          };
        }, "dsh-mattpocock-skills-deck: " + DSW_RPC_ROUTE);
      } catch (eEff) {
      }
    }
    return { ok: true, path: DSW_RPC_ROUTE };
  } catch (eReg) {
    const msg = String(eReg && eReg.message || eReg);
    const kind = msg.indexOf("already registered") >= 0 || msg.indexOf("duplicate") >= 0 ? "fetch-route-duplicate" : "fetch-route-throw";
    reportRegisterFail(kind, msg);
    return { ok: false, path: DSW_RPC_ROUTE, reason: kind };
  }
}
export {
  DSW_ENDPOINT_PATTERN,
  DSW_RPC_CHANNEL,
  DSW_RPC_ROUTE,
  createRpcChannel
};
