// Playwright adapter for the base page checks and scenarios.
//
// The base loader only requires a default export with a launch function; it
// does not start Chromium. Every method below returns the exact Result shape
// documented in contracts/ports.ts, because the base runner distinguishes
// "blocked" (no adapter / cannot start) from "fail" (the page said something
// the check did not want).
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium } from "playwright";

function ok(value) {
  return { ok: true, value };
}

function fail(code, message) {
  return { ok: false, error: { code, message } };
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function sizeOf(page, script) {
  return page.evaluate(script).then(ok).catch((error) => fail("internal", messageOf(error)));
}

async function createPage(browser) {
  // viewport: null keeps the real window size, which is what the plugin's
  // narrow/wide layout checks compare against. A fixed viewport would make
  // those observations true by construction.
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(messageOf(error)));
  page.on("console", (message) => {
    // Chromium reports every failed subresource fetch as a console error. Those
    // are network noise from unrelated plugins (for example the IM companion's
    // optional endpoints), not uncaught shell exceptions; keep real JS errors.
    if (message.type() !== "error") return;
    if (/^Failed to load resource: the server responded with a status of \d+/.test(message.text())) return;
    errors.push(message.text());
  });

  return {
    // The base page check prefers goto() when the adapter exposes it. Using it
    // matters for DSH Web: the login redirect sets a cookie while a navigation
    // started with location.assign() can issue the follow-up request before the
    // cookie is applied, which makes the page show its 401 authentication text.
    goto: (url) => page.goto(url, { waitUntil: "load" }).then((response) => ok(response === null ? null : response.status())).catch((error) => fail("internal", messageOf(error))),
    url: () => page.url(),
    evaluate: (script) => page.evaluate(script).then(ok).catch((error) => fail("internal", messageOf(error))),
    innerSize: () => sizeOf(page, () => ({ width: window.innerWidth, height: window.innerHeight })),
    outerSize: () => sizeOf(page, () => ({ width: window.outerWidth, height: window.outerHeight })),
    text: async (selector) => {
      try {
        const value = await page.locator(selector).first().textContent({ timeout: 5000 });
        return ok(value);
      } catch {
        // A missing selector is an observation ("null"), not a broken page.
        return ok(null);
      }
    },
    // Real mouse and keyboard input, used by the workspace-menu checks: the
    // menu opens on a genuine click handler, and Escape closes it through the
    // same path a person would take. Dispatching synthetic DOM events from
    // page.evaluate would bypass both and make the observation weaker.
    click: (selector) =>
      page
        .locator(selector)
        .first()
        .click({ timeout: 5000 })
        .then(() => ok(null))
        .catch((error) => fail("not-found", "click " + selector + " failed: " + messageOf(error))),
    press: (key) => page.keyboard.press(key).then(() => ok(null)).catch((error) => fail("internal", messageOf(error))),
    screenshot: async (path, options) => {
      try {
        await mkdir(dirname(path), { recursive: true });
        await page.screenshot({ path, fullPage: options !== undefined && options.fullPage === true });
        const info = await stat(path);
        return ok({ bytes: info.size });
      } catch (error) {
        return fail("internal", messageOf(error));
      }
    },
    pageErrors: () => errors.slice(),
    close: () => context.close().catch(() => undefined),
  };
}

export async function launch(options = {}) {
  const headless = options.headless !== false;
  if (process.platform === "linux" && !headless && !process.env.DISPLAY) {
    return fail("prerequisite", "no display; run headed window checks on a desktop session");
  }
  try {
    const browser = await chromium.launch({
      headless,
      channel: process.env.DSH_BROWSER_CHANNEL || undefined,
    });
    return ok({
      newPage: () => createPage(browser).then(ok).catch((error) => fail("internal", messageOf(error))),
      close: () => browser.close().catch(() => undefined),
    });
  } catch (error) {
    return fail("prerequisite", "playwright could not start chromium: " + messageOf(error));
  }
}

export default { launch };
