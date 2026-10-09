const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 140)));
  await page.goto("file:///" + path.resolve(".scratch/cards-demo/demo.html").replace(/\\/g, "/"), { waitUntil: "load" });
  const res = [];
  const cases = [
    { sec: 8, mate: "blk-921", idx: 0, name: "issue卡片 挡住别人" },
    { sec: 9, mate: "s7-blk-921", idx: 2, name: "issue卡片-map 挡住别人" },
  ];
  for (const c of cases) {
    const s = page.locator(".sec").nth(c.sec);
    const blocked = s.locator(".cd-card").nth(c.idx || 0);
    const beforeCls = await blocked.getAttribute("class");
    const beforeChip = await blocked.locator(".cd-bchip").count();
    await blocked.click();
    await page.waitForTimeout(150);
    const afterCls = await blocked.getAttribute("class");
    const afterChip = await blocked.locator(".cd-bchip").count();
    const veilVisible = await blocked.locator(".cd-dimveil").first().isVisible().catch(() => false);
    const mateCls = await page.locator("#" + c.mate).getAttribute("class");
    const mateChip = await page.locator("#" + c.mate + " .cd-bchip").first().isVisible();
    res.push({ name: c.name, beforeCls, beforeChip, afterCls, afterChip, veilVisible, mateCls, mateChip });
  }
  console.log(JSON.stringify({ res, errs }, null, 1));
  await browser.close();
})().catch((e) => { console.log("ERR " + e.message); process.exit(1); });
