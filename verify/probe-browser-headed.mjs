// verify/probe-browser-headed.mjs —— 一次性真机验证用的有头浏览器适配器（不属于门禁，验完删）。
//
// 为什么临时加这一份：base 的场景原语固定 headless（窗口 800x600），「真全屏 / 三档窗口」
// 只能用本仓 verify/windows.mjs 的 CDP 执行函数。这个适配器把 base 的页面原语与那套执行函数
// 接在一起：页面句柄上多两个方法 preset(id) 与 measureWindow()，场景里据此切宽 / 窄 / 宽矮窗；
// 其余方法与 verify/browser.mjs 完全同形，场景代码不需要改。
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium } from "playwright";
import { applyWindowPreset, measureWindow, setWindowBounds, windowIdOf } from "./windows.mjs";

function ok(value) { return { ok: true, value }; }
function fail(code, message) { return { ok: false, error: { code, message } }; }
function messageOf(error) { return error instanceof Error ? error.message : String(error); }

async function createPage(browser) {
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(messageOf(error)));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/^Failed to load resource: the server responded with a status of \d+/.test(message.text())) return;
    errors.push(message.text());
  });
  return {
    page,
    goto: (url) => page.goto(url, { waitUntil: "load" }).then((response) => ok(response === null ? null : response.status())).catch((error) => fail("internal", messageOf(error))),
    url: () => page.url(),
    evaluate: (script) => page.evaluate(script).then(ok).catch((error) => fail("internal", messageOf(error))),
    innerSize: () => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })).then(ok).catch((error) => fail("internal", messageOf(error))),
    outerSize: () => page.evaluate(() => ({ width: window.outerWidth, height: window.outerHeight })).then(ok).catch((error) => fail("internal", messageOf(error))),
    text: async (selector) => {
      try { return ok(await page.locator(selector).first().textContent({ timeout: 5000 })); } catch { return ok(null); }
    },
    click: (selector) => page.locator(selector).first().click({ timeout: 5000 }).then(() => ok(null)).catch((error) => fail("not-found", "click " + selector + " failed: " + messageOf(error))),
    press: (key) => page.keyboard.press(key).then(() => ok(null)).catch((error) => fail("internal", messageOf(error))),
    screenshot: async (path, options) => {
      try { await mkdir(dirname(path), { recursive: true }); await page.screenshot({ path, fullPage: options !== undefined && options.fullPage === true }); const info = await stat(path); return ok({ bytes: info.size }); } catch (error) { return fail("internal", messageOf(error)); }
    },
    pageErrors: () => errors.slice(),
    close: () => context.close().catch(() => undefined),
    // 三款预设：真全屏 / 外框宽 800 / 宽矮窗。
    preset: async (id) => {
      try {
        const result = await applyWindowPreset(page, id);
        const measurement = await measureWindow(page);
        return ok({ preset: id, measurement: measurement, applied: result });
      } catch (error) { return fail("prerequisite", "window preset " + id + " failed: " + messageOf(error)); }
    },
    // 自定义外框尺寸（460 这类不在三款预设里的宽度）。
    resize: async (width, height) => {
      try {
        const cdp = await page.context().newCDPSession(page);
        const windowId = await windowIdOf(cdp);
        await setWindowBounds(cdp, windowId, { windowState: "normal" });
        await new Promise((resolve) => setTimeout(resolve, 300));
        await setWindowBounds(cdp, windowId, { windowState: "normal", width: width, height: height });
        await new Promise((resolve) => setTimeout(resolve, 500));
        return ok({ width: width, height: height, measurement: await measureWindow(page) });
      } catch (error) { return fail("prerequisite", "window resize failed: " + messageOf(error)); }
    },
    measureWindow: () => measureWindow(page).then(ok).catch((error) => fail("internal", messageOf(error))),
  };
}

export async function launch() {
  try {
    // ms-playwright 里只装了 headless shell，没有有头 chromium；本机装了系统 Chrome，就借它跑有头。
    const browser = await chromium.launch({ headless: false, channel: process.env.DSH_BROWSER_CHANNEL || "chrome" });
    return ok({ newPage: () => createPage(browser).then(ok).catch((error) => fail("internal", messageOf(error))), close: () => browser.close().catch(() => undefined) });
  } catch (error) {
    return fail("prerequisite", "playwright could not start a headed chromium: " + messageOf(error));
  }
}

export default { launch };
