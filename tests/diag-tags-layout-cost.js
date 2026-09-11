// tests/diag-tags-layout-cost.js
//
// 用途（一次性诊断，不是门禁）：量「列表里标签折叠」这个动作在真浏览器里到底要多久。
//
// 为什么盯它：列表每行右侧有一组标签，放不下就折叠成 +N。折叠的实现是「逐个标签读宽度再决定显示还是隐藏」，
//   而「读宽度」会让浏览器立刻停下把版面重算一遍。行数一多，这个动作就是成百上千次重算。
//   jsdom 里元素宽度恒为 0，量不出来；只有真浏览器才有真版面。
//
// 做法：真样式取自 package/lib/client.js 里那段内联 CSS（不是抄来的）；行结构按产物里真实生成的标记搭。
//   规模按真仓库：53 张地图 + 583 条独立 issue。
//
// 直接跑：node tests/diag-tags-layout-cost.js

import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const OUT = path.resolve(HERE, '../.scratch')
mkdirSync(OUT, { recursive: true })

const BUNDLE = readFileSync(path.resolve(HERE, '../package/lib/client.js'), 'utf8')

// 从产物里把真样式整段抠出来：样式是以字符串常量形式写进产物的，逐行找含 .dsws- 的引号串。
function extractRealCss(bundle) {
  const parts = []
  for (const line of bundle.split(/\r?\n/)) {
    if (!line.includes('.dsws-') || !line.includes('{')) continue
    const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g
    let m
    while ((m = re.exec(line))) {
      const s = (m[1] !== undefined ? m[1] : m[2] || '').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      if (s.includes('.dsws-') && s.includes('{') && /[a-z-]+\s*:/.test(s)) parts.push(s)
    }
  }
  return parts.join('\n')
}

const realCss = extractRealCss(BUNDLE)
if (!realCss.includes('.dsws-tags')) {
  console.error('没能从产物里抠出 .dsws-tags 的真样式，诊断无法进行')
  process.exit(1)
}

const NARROW = Number(process.env.PANEL_W || 460)
const ROWS = Number(process.env.DIAG_ROWS || 636)
const CHIPS = Number(process.env.DIAG_CHIPS || 5)
const LABELS = ['wayfinder:map', 'bug', 'ready-for-agent', 'needs-triage', 'wayfinder:task', 'enhancement', 'ready-for-human', 'wontfix']

const marked = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>
html,body{margin:0;padding:0;background:#10131a;color:#e6edf3;font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif}
#panel{width:${NARROW}px;height:900px;overflow:auto}
.dsws-row{padding:6px 12px;border-bottom:1px solid #2a2d35}
${realCss}
</style></head><body>
<div id="panel"></div>
<script>
window.__rows = [];
(function(){
  const LAB = ${JSON.stringify(LABELS)};
  const host = document.getElementById('panel');
  const frag = document.createDocumentFragment();
  for (let r = 0; r < ${ROWS}; r++) {
    const row = document.createElement('div');
    row.className = 'dsws-row';
    const line2 = document.createElement('div');
    line2.style.cssText = 'margin-top:2px;display:flex;align-items:center;gap:6px;width:100%';
    const tags = document.createElement('div');
    tags.className = 'dsws-tags';
    const n = ${CHIPS};
    for (let i = 0; i < n; i++) {
      const c = document.createElement('span');
      c.className = 'dsws-chip';
      c.style.cssText = 'font-size:10px;background:rgba(188,140,255,.16);color:#bc8cff;border:1px solid rgba(188,140,255,.6)';
      c.textContent = LAB[i % LAB.length];
      tags.appendChild(c);
    }
    const more = document.createElement('span');
    more.className = 'dsws-chip dsws-more';
    more.textContent = '+0';
    tags.appendChild(more);
    line2.appendChild(tags);
    // 按钮组（真实行也有，占住右侧宽度）
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;align-items:center;gap:3px;flex:none;margin-left:auto';
    for (let b = 0; b < 3; b++) {
      const btn = document.createElement('button');
      btn.className = 'dsws-btn';
      btn.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:1px 6px;font-size:11px;flex:none';
      btn.textContent = '执行';
      btns.appendChild(btn);
    }
    line2.appendChild(btns);
    row.appendChild(line2);
    frag.appendChild(row);
  }
  host.appendChild(frag);
})();
window.__tagsCount = document.querySelectorAll('.dsws-tags').length;
window.__chipCount = document.querySelectorAll('.dsws-chip').length;
</script>
</body></html>`

const file = path.join(OUT, 'diag-tags.html')
writeFileSync(file, marked, 'utf8')

const run = async () => {
  console.log('=== 标签折叠排版成本（真 Chromium）· 行 ' + ROWS + ' · 每行标签 ' + CHIPS + ' · 面板宽 ' + NARROW + ' ===\n')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } })
  await page.goto('file:///' + file.replace(/\\/g, '/'))
  await page.waitForTimeout(300)

  const meta = await page.evaluate(() => ({ tags: window.__tagsCount, chips: window.__chipCount, rows: document.querySelectorAll('.dsws-row').length }))
  console.log('  实际生成: 行 ' + meta.rows + '  标签组 ' + meta.tags + '  标签 ' + meta.chips + '\n')

  // ① 纯读宽度（不做任何写操作）：这是「边量边改」之前的地板价
  const readOnly = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('.dsws-chip'))
    const t0 = performance.now()
    let sum = 0
    for (const c of all) sum += c.offsetWidth
    return { ms: Math.round(performance.now() - t0), n: all.length, sum: sum }
  })
  console.log('  ① 只读一遍宽度（' + readOnly.n + ' 个）: ' + readOnly.ms + ' ms')

  // ② 照 fitAllTags 的写法整体跑一遍：每读一个宽度之前先改一次 display
  const full = await page.evaluate(() => {
    const tagsAll = Array.from(document.querySelectorAll('.dsws-tags'))
    const t0 = performance.now()
    for (const tags of tagsAll) {
      const more = tags.querySelector('.dsws-more')
      if (!more) continue
      const chips = Array.prototype.slice.call(tags.querySelectorAll('.dsws-chip:not(.dsws-more):not(.dsws-blocked)'))
      chips.forEach(function (c) { c.style.display = 'inline-flex' })
      more.style.display = 'inline-flex'
      const avail = tags.clientWidth
      const moreW = more.offsetWidth
      const gap = 3
      const room = avail - moreW - gap
      let used = 0, shown = 0
      chips.forEach(function (c, i) {
        const w = c.offsetWidth
        if (used + w <= room || i === 0) { c.style.display = 'inline-flex'; used += w + gap; shown++ }
        else c.style.display = 'none'
      })
      const hidden = chips.length - shown
      more.textContent = '+' + hidden
      more.style.display = hidden > 0 ? 'inline-flex' : 'none'
    }
    return Math.round(performance.now() - t0)
  })
  console.log('  ② 整轮 fitAllTags（真写法）: ' + full + ' ms')

  // ③ 只跑一次「关掉再打开」的开关（看单次重排的地板价）
  const oneReflow = await page.evaluate(() => {
    const el = document.querySelector('.dsws-tags')
    const c = el.querySelector('.dsws-chip')
    const t0 = performance.now()
    for (let i = 0; i < 100; i++) { c.style.display = 'none'; void c.offsetWidth; c.style.display = 'inline-flex'; void c.offsetWidth }
    return Math.round((performance.now() - t0) / 100) / 100
  })
  console.log('  ③ 单次「改样式→读宽度」重排: ' + oneReflow.toFixed(3) + ' ms')

  // ④ 再跑一遍整轮（第二次通常受缓存影响，看是否可重复）
  const full2 = await page.evaluate(() => {
    const tagsAll = Array.from(document.querySelectorAll('.dsws-tags'))
    const t0 = performance.now()
    for (const tags of tagsAll) {
      const more = tags.querySelector('.dsws-more')
      const chips = Array.prototype.slice.call(tags.querySelectorAll('.dsws-chip:not(.dsws-more):not(.dsws-blocked)'))
      chips.forEach(function (c) { c.style.display = 'inline-flex' })
      const avail = tags.clientWidth, moreW = more.offsetWidth
      let used = 0, shown = 0
      chips.forEach(function (c, i) { const w = c.offsetWidth; if (used + w <= avail - moreW - 3 || i === 0) { used += w + 3; shown++ } else c.style.display = 'none' })
      more.textContent = '+' + (chips.length - shown)
    }
    return Math.round(performance.now() - t0)
  })
  console.log('  ④ 第二遍整轮（复核可重复性）: ' + full2 + ' ms')

  console.log('\n=== 读法 ===')
  console.log('  若 ② 明显大于 ①，慢的就是「边改样式边量宽度」这个写法本身，')
  console.log('  行数越多越贵，而且这段跑在主线程上，用户看到的就是界面卡住。')
  console.log('  按每行 ' + CHIPS + ' 个标签算，② 平摊到每行是 ' + (full / ROWS).toFixed(2) + ' ms。')

  await browser.close()
}

run().catch((e) => { console.error('fatal: ' + e.message); process.exit(1) })
