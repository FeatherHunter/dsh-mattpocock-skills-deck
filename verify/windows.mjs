// verify/windows.mjs —— 真全屏判据与「通过 CDP 改窗口尺寸 / 进真全屏」的执行函数。
// 2026-11-02 票 13 阶段 B1b 从旧的 scripts/real-machine/lib/browser.mts 平移，行为保持不变。
//
// 为什么它还在插件仓（风险 R4）：base 库的页面检查没有「改窗口尺寸」与「真全屏」这两个原语，
// 它只描述页面里发生了什么，不负责把宿主窗口摆成某个尺寸。这个插件的有头验证必须能回答
// 「这条遮挡结论是在真全屏下取的吗」，而 2026-10-29 出过一次误判：页面视口是 2195×1235，
// 外框却只有 1083×1168（浏览器窗口被摆在半个屏幕上），当时差点把半屏当作全屏证据。
// 所以判据必须同时看 inner / outer / screen 六个数，并且改窗口只能走 CDP
// Browser.setWindowBounds —— 把视口设成屏幕大小（固定视口）不能冒充全屏，也不会改变外框。
// base 0.1.5 仍未补这一层，插件仓因此保留它，不能静默丢。
//
// 本文件不 import playwright，也不 import base：执行函数接收调用方给的 CDP send 对象
// 或 playwright page 句柄，判据是纯函数。这样 headless 门禁能直接测判据、换算与 CDP 调用顺序，
// 真开窗的有头检查由人跑（见 tests/verify-windows.ts 文件头）。
import { presetById, resolvePresetWindow } from "./presets.mjs";

const MEASUREMENT_KEYS = [
  "innerWidth",
  "innerHeight",
  "outerWidth",
  "outerHeight",
  "screenWidth",
  "screenHeight",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 判断一次窗口测量是不是「真全屏」。
 *
 * 真全屏要同时满足三件事：外框宽高都等于屏幕宽高（容差内）、页面视口等于外框
 * （没有浏览器边框或工具栏占位）、六个测量值都是大于 0 的有限数字。
 * 2026-10-29 的事故里 inner 是 2195×1235 而 outer 只有 1083×1168：
 * 只看视口会判成通过，所以判据以外框与屏幕为主，视口只用来排除「外框贴边但有边框」。
 *
 * tolerance 默认 2px，吸收系统缩放的取整误差；NaN / 负数容差按 0 处理。
 * 返回 {ok, reason}；reason 里带实际数值，失败时能直接看出差在哪。
 */
export function judgeFullscreen(measurement, tolerance = 2) {
  if (measurement === null || typeof measurement !== "object") {
    return { ok: false, reason: "没有拿到窗口与屏幕尺寸，无法判断是不是真全屏" };
  }
  for (const key of MEASUREMENT_KEYS) {
    const value = measurement[key];
    if (!Number.isFinite(value) || value <= 0) {
      return { ok: false, reason: "测量里缺少有效的 " + key + "，无法判断是不是真全屏" };
    }
  }
  const tol = Math.max(0, Number(tolerance) || 0);
  const problems = [];
  const { innerWidth, innerHeight, outerWidth, outerHeight, screenWidth, screenHeight } = measurement;
  if (Math.abs(outerWidth - screenWidth) > tol) {
    problems.push(
      "外框宽 " + outerWidth + " 与屏幕宽 " + screenWidth + " 相差超过 " + tol + "px（窗口没有铺满屏幕宽）",
    );
  }
  if (Math.abs(outerHeight - screenHeight) > tol) {
    problems.push(
      "外框高 " + outerHeight + " 与屏幕高 " + screenHeight + " 相差超过 " + tol + "px（窗口没有铺满屏幕高）",
    );
  }
  if (Math.abs(outerWidth - innerWidth) > tol || Math.abs(outerHeight - innerHeight) > tol) {
    problems.push(
      "页面视口 " + innerWidth + "x" + innerHeight + " 与外框 " + outerWidth + "x" + outerHeight +
        " 不一致，说明还有浏览器边框或工具栏占位",
    );
  }
  if (problems.length > 0) {
    return { ok: false, reason: "窗口不是真全屏：" + problems.join("；") };
  }
  return {
    ok: true,
    reason:
      "真全屏：页面视口与外框都是 " + innerWidth + "x" + innerHeight +
      "，等于屏幕尺寸 " + screenWidth + "x" + screenHeight,
  };
}

/**
 * 读一次窗口测量。page 是 playwright 页面句柄；有头检查直接把它传进来。
 * 门禁不调用这个函数（headless 下没有真实窗口），而是给下面的执行函数传 measure 替身。
 */
export function measureWindow(page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  }));
}

/** 打开页面所在浏览器的 CDP 会话。没有 CDP 就没有可靠的窗口控制，直接说清为什么。 */
async function connectCdp(page) {
  const context = page !== null && typeof page === "object" && typeof page.context === "function" ? page.context() : null;
  if (context === null || typeof context.newCDPSession !== "function") {
    throw new Error(
      "这个页面句柄没有 context().newCDPSession，无法通过 CDP 改窗口尺寸；真全屏不能靠固定视口冒充",
    );
  }
  return context.newCDPSession(page);
}

/** 取当前页面的浏览器窗口 id（Browser.getWindowForTarget）。 */
export async function windowIdOf(cdp) {
  const info = await cdp.send("Browser.getWindowForTarget");
  if (info === null || typeof info !== "object" || typeof info.windowId !== "number") {
    throw new Error("Browser.getWindowForTarget 没有返回 windowId，无法改这个窗口");
  }
  return info.windowId;
}

/**
 * 通过 CDP 设置窗口外框。bounds 传 {windowState:"normal", width, height} 或
 * {windowState:"fullscreen"}；这是唯一能真正改变宿窗外框的路径。
 */
export async function setWindowBounds(cdp, windowId, bounds) {
  await cdp.send("Browser.setWindowBounds", { windowId, bounds });
  return { windowId, bounds };
}

/**
 * 把页面切到真全屏并等到判据通过。
 *
 * 先发 Browser.setWindowBounds({windowState:"fullscreen"})，再按 150ms 的间隔重新测量，
 * 直到 judgeFullscreen 通过或超时（默认 8000ms）。超时抛错，错误里写明「这条结论不能当作全屏证据」，
 * 避免调用方把一次没进全屏的测量继续当作遮挡类结论的依据。
 * options.measure / options.cdp / options.windowId 是给门禁用的注入点，有头检查不用传。
 */
export async function enterFullscreen(page, options = {}) {
  const timeoutMs = options.timeoutMs === undefined ? 8000 : options.timeoutMs;
  const pollMs = options.pollMs === undefined ? 150 : options.pollMs;
  const tolerance = options.tolerance === undefined ? 2 : options.tolerance;
  const measure = options.measure === undefined ? () => measureWindow(page) : options.measure;
  const cdp = options.cdp === undefined ? await connectCdp(page) : options.cdp;
  const windowId = options.windowId === undefined ? await windowIdOf(cdp) : options.windowId;
  await setWindowBounds(cdp, windowId, { windowState: "fullscreen" });
  const deadline = Date.now() + timeoutMs;
  let measurement = null;
  let judged = null;
  for (;;) {
    measurement = await measure();
    judged = judgeFullscreen(measurement, tolerance);
    if (judged.ok) {
      return { windowId, bounds: { windowState: "fullscreen" }, measurement, judge: judged };
    }
    if (Date.now() >= deadline) break;
    await sleep(pollMs);
  }
  throw new Error(
    "页面窗口没有进入真全屏（等了 " + String(timeoutMs) + " 毫秒）：" + judged.reason +
      "；最后一次测量 " + JSON.stringify(measurement) + "。这条结论不能当作全屏证据。",
  );
}

/**
 * 把页面窗口调到一款预设，并等到外框真的变成预设要求的大小。
 *
 * 从真全屏回到普通窗要分两步：先单独发 {windowState:"normal"} 退出全屏，等 300ms，
 * 再发带 width / height 的 normal 边界。一步同时给状态与宽高时，Chromium 有时沿用
 * 全屏前的尺寸，预设就量不准。等待成功后返回外框与最后一次测量；超时抛错。
 * 全屏预设（wide）会复用 enterFullscreen 的判据，而不是把视口设成屏幕大小。
 */
export async function applyWindowPreset(page, presetOrId, options = {}) {
  const preset = typeof presetOrId === "string" ? presetById(presetOrId) : presetOrId;
  if (preset === null || typeof preset !== "object" || typeof preset.id !== "string") {
    throw new Error("窗口预设无效：传 id 或 presetById() 返回的对象");
  }
  const timeoutMs = options.timeoutMs === undefined ? 8000 : options.timeoutMs;
  const pollMs = options.pollMs === undefined ? 150 : options.pollMs;
  const tolerancePx = options.tolerancePx === undefined ? 4 : options.tolerancePx;
  const restoreDelayMs = options.restoreDelayMs === undefined ? 300 : options.restoreDelayMs;
  const measure = options.measure === undefined ? () => measureWindow(page) : options.measure;
  const before = await measure();
  const screen = { width: before.screenWidth, height: before.screenHeight };
  const target = resolvePresetWindow(preset, screen);
  const cdp = options.cdp === undefined ? await connectCdp(page) : options.cdp;
  const windowId = options.windowId === undefined ? await windowIdOf(cdp) : options.windowId;
  if (target.windowState === "fullscreen") {
    await setWindowBounds(cdp, windowId, { windowState: "fullscreen" });
  } else {
    await setWindowBounds(cdp, windowId, { windowState: "normal" });
    await sleep(restoreDelayMs);
    await setWindowBounds(cdp, windowId, { windowState: "normal", width: target.width, height: target.height });
  }
  const deadline = Date.now() + timeoutMs;
  let measurement = null;
  for (;;) {
    measurement = await measure();
    if (target.windowState === "fullscreen") {
      if (judgeFullscreen(measurement, tolerancePx).ok) {
        return { presetId: preset.id, bounds: target, windowId, measurement };
      }
    } else if (
      Math.abs(measurement.outerWidth - target.width) <= tolerancePx &&
      Math.abs(measurement.outerHeight - target.height) <= tolerancePx
    ) {
      return { presetId: preset.id, bounds: target, windowId, measurement };
    }
    if (Date.now() >= deadline) break;
    await sleep(pollMs);
  }
  const want =
    target.windowState === "fullscreen"
      ? "真全屏"
      : target.width + "x" + target.height;
  throw new Error(
    "窗口没有变成预设 " + preset.id + " 要求的外框 " + want + "（容差 " + tolerancePx + "px）：实测 " +
      measurement.outerWidth + "x" + measurement.outerHeight + "。这条结论不能当作该预设下的界面证据。",
  );
}
