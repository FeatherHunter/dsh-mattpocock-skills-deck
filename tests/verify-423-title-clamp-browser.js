// verify-423-title-clamp-browser.js — 真实 Chromium 复现窄面板标题行数截断（#423）
// 依赖：playwright（含浏览器）；fixture 由 scripts/gen-fixture-423.js 从真源 styles.js 生成
// 判据：以渲染高度（clientHeight ÷ lineHeight = 行数）为准；clamp=2 时固定结构 ≤2 行，旧结构 >2 行（反证）
const { chromium } = require('playwright');
const path = require('path');
; (async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const url = 'file:///' + path.resolve(__dirname, 'fixtures/423-clamp-repro.html').replace(/\\/g, '/');
  await page.goto(url);
  const data = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.case').forEach(c => {
      const t = c.querySelector('.dsws-tt-wrap');
      const cs = getComputedStyle(t);
      const lh = parseFloat(cs.lineHeight) || 20.8;
      out.push({ name: c.dataset.case, display: cs.display, clamp: cs.webkitLineClamp, lines: Math.round((t.clientHeight / lh) * 10) / 10, h: t.clientHeight, lh: lh });
    });
    return out;
  });
  console.log(JSON.stringify(data, null, 2));
  // 阈值留 0.3 行容差：不同平台的行盒取整不一样，macOS runner 上每个用例都比 Linux/Windows 高约 0.1 行
  //（实测 fixed-320：44px ÷ 20.8 = 2.115；Linux/Windows 上约 2.0），原来贴边的 2.05 / 1.05 会把
  //「clamp 正常工作」误判成失败。判别的关键是两类差一整行（固定 ≈2.1，旧结构 ≥3.2），不受这点容差影响。
  const FIXED_MAX = 2.3;
  const SHORT_MAX = 1.3;
  let ok = true;
  for (const d of data) {
    if (d.name.startsWith('broken')) {
      if (d.lines <= 2.05) { console.log('FAIL', d.name, '反证失败：旧结构竟然也 ≤2 行 (lines=' + d.lines + ')'); ok = false; }
      else console.log('PASS', d.name, '(反证) lines=' + d.lines, 'h=' + d.h);
    } else if (d.name.includes('short')) {
      if (d.lines > SHORT_MAX) { console.log('FAIL', d.name, '短标题应为 1 行 lines=' + d.lines); ok = false; }
      else console.log('PASS', d.name, 'lines=' + d.lines, 'h=' + d.h);
    } else {
      if (d.clamp !== '2') { console.log('FAIL', d.name, 'clamp=' + d.clamp); ok = false; }
      else if (d.lines > FIXED_MAX) { console.log('FAIL', d.name, 'lines=' + d.lines, '(应以 2 行截断)'); ok = false; }
      else console.log('PASS', d.name, 'lines=' + d.lines, 'clamp=' + d.clamp, 'h=' + d.h);
    }
  }
  await browser.close();
  console.log(ok ? '全部通过：真实浏览器中 fixed 结构两行截断、broken 结构无限制换行（反证成立）' : '存在失败项');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });