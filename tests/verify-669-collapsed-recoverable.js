// verify-669-collapsed-recoverable.js — 「收起态必须看得见、回得来」（#669）
//
// 起因（2026-09-20 真机报告）：「在某个全新工作区一直操作到 /setup 黄条时点击了黄条后，整个胶囊状态栏全部消失了」。
// 代码里能让整条胶囊消失的只有一处 —— 横幅上那颗叉把整个功能区收起来（#422），收起态只剩一颗小按钮。
// 而那颗小按钮原来是 10px 灰字、没有底色也没有描边，看着像一句注释；用户按下叉之后眼前只剩这么一句灰字，
// 认不出是「回来的路」，于是报成胶囊不见了。这一门钉住两件事：收起态那颗按钮**看得见**（真浏览器量像素），
// 以及三处收起触发**离开主按钮**（不许再贴着主按钮放，点主按钮时手一偏就落到它上面）。
//
// 判据是几何的：Part B 在真 Chromium 里量它渲染出来的高、描边与底色，并用旧写法做反证 ——
//   旧写法必须量不通过，否则这一页量不出问题，门是假绿的。
// 依赖：playwright（含 chromium）。不需要登录令牌（纯本地 fixture 页）。
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const ROOT = path.resolve(__dirname, '..')
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['client.js', 'package/lib/client.js']

let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// ── 从产物里抠出「收起态那颗按钮」的样式与其身上的几处断言 ─────────────────────────
// 抠法照 verify-640 的先例：值必须从真源里读出来，读不到就报错，不许在门里另抄一份常量。
const collapsedBranchOf = function (src) {
  const at = src.indexOf('if (deckFolded) {')
  if (at < 0) throw new Error('产物里找不到收起态那一支（if (deckFolded)）')
  const end = src.indexOf('// #522', at)
  if (end < 0) throw new Error('找不到收起态那一支的结尾（锚点 // #522）')
  return src.slice(at, end)
}
const fieldOf = function (block, field) {
  // 数值型的字段在产物里是 `fontSize: 12`，百分号/尺寸那些是 `padding: '3px 12px'`，两种都要认。
  const m = block.match(new RegExp(field + ":\\s*(?:'([^']+)'|(\\d+))"))
  return m ? (m[1] !== undefined ? m[1] : m[2]) : null
}

const runStatic = function (src, tag) {
  const block = collapsedBranchOf(src)
  const fontSize = fieldOf(block, 'fontSize')
  const padding = fieldOf(block, 'padding')
  const border = fieldOf(block, 'border')
  const background = fieldOf(block, 'background')
  check(!!fontSize && Number(fontSize) >= 12, tag + ' · 收起态按钮字号不小于 12（现在是 ' + fontSize + '）')
  check(!!border && border !== 'none' && /solid/.test(border), tag + ' · 收起态按钮有描边（现在是 ' + border + '）')
  check(!!background && /var\(--dsw-alias-bg-layer-1/.test(background), tag + ' · 收起态按钮有底色（与胶囊同源变量；现在是 ' + background + '）')
  check(/borderRadius:\s*14/.test(block), tag + ' · 收起态按钮圆角与胶囊同形（14）')
  check(block.indexOf("tr('banner.expandDeck')") >= 0, tag + ' · 收起态按钮写着面板名（tr banner.expandDeck）')
  check(/'?aria-label'?:\s*tr\('banner.expandDeck'\)/.test(block), tag + ' · 收起态按钮保留无障碍名')
  check(/onClick:\s*expandBanner/.test(block), tag + ' · 收起态按钮点下去调 expandBanner')
  // 旧写法必须消失：否则这一门会对着幽灵按钮误绿
  check(!/fontSize:\s*10,\s*padding:\s*'0 8px'/.test(block), tag + ' · 旧的 10px 幽灵写法已消失')
  check(!/lineHeight:\s*1\.2/.test(block), tag + ' · 旧的紧凑行高写法已消失')
  // 回得来：展开仍然把这条工作区的收起标记删掉
  const prefs = fs.readFileSync(path.join(ROOT, 'src/client/kernel/store-prefs.js'), 'utf8')
  check(/setBannerFolded = function \(cwd, folded\)[\s\S]{0,400}else delete bannerFoldByCwd\[k\]/.test(prefs),
    tag + ' · setBannerFolded(cwd,false) 仍然是删掉标记（展开真回得来）')
  // 三处收起触发都要离开主按钮（黄条 / 探测中黄条 / 蓝条）。
  //   只数 JSX 上那三处（className 里带 dsws-btn ghost 的那种）；样式表里那条 :hover 规则不是触发点，不能算进来。
  const triggers = src.match(/dsws-btn ghost dsws-banner-fold-x/g) || []
  let spacedAll = 0
  let at = src.indexOf('dsws-btn ghost dsws-banner-fold-x')
  while (at >= 0) {
    if (/marginLeft:\s*12/.test(src.slice(at, at + 260))) spacedAll += 1
    at = src.indexOf('dsws-btn ghost dsws-banner-fold-x', at + 1)
  }
  check(triggers.length >= 3, tag + ' · 收起触发共 ' + triggers.length + ' 处（黄条 / 探测中黄条 / 蓝条）')
  check(spacedAll >= triggers.length, tag + ' · 每处收起触发都带 marginLeft:12 离开主按钮（带距离的 ' + spacedAll + ' / 共 ' + triggers.length + '）')
  return { fontSize, padding, border, background }
}

const main = async function () {
  let values = null
  for (const file of files) {
    const tag = file.indexOf('package/') >= 0 ? 'npm' : 'dyn'
    console.log('=== ' + file + ' ===')
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
    try { const v = runStatic(src, tag); if (!values) values = v } catch (e) { failed = true; console.log('  FAIL ' + tag + ' — ' + e.message) }
  }
  if (!values) { console.log('\n量不到样式值，浏览器那一段跳过'); console.log('\n存在失败'); process.exit(1) }

  // ── Part B：真 Chromium 量「看得见」 ────────────────────────────────────────
  // 两套值同页渲染：一套是产物里读出来的真样式，一套是改动前的旧写法。判据同一条，
  // 要求真样式过、旧写法不过 —— 不过的那一套就是这一门的反证。
  const capsuleBorder = (fs.readFileSync(path.join(ROOT, 'src/client/kernel/styles.js'), 'utf8').match(/1px solid var\(--dsw-alias-border-l1[^']*/) || [''])[0]
  const page = [
    '<!doctype html><html><head><meta charset=utf-8><style>',
    'body{margin:0;background:#0a0a0a;color:#e6edf3;font-family:Arial,Helvetica,sans-serif}',
    '.row{padding:16px}',
    '</style></head><body>',
    '<div class="row"><button id="real" style="display:inline-flex;align-items:center;gap:6px;font-size:' + values.fontSize + ';line-height:1.4;padding:' + values.padding + ';border-radius:14px;border:' + values.border + ';background:' + values.background + ';color:#a1a1aa">展开MattSkillsDeck</button></div>',
    '<div class="row"><button id="old" style="display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:0 8px;line-height:1.2;border:none;border-radius:99px;color:#8b8b95">展开MattSkillsDeck</button></div>',
    '</body></html>',
  ].join('\n')
  void capsuleBorder

  const browser = await chromium.launch({ headless: true })
  const p = await browser.newPage({ viewport: { width: 900, height: 400 } })
  await p.setContent(page)
  const measure = () => p.evaluate(() => {
    const out = {}
    for (const id of ['real', 'old']) {
      const el = document.getElementById(id)
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      out[id] = {
        h: Math.round(r.height * 100) / 100, w: Math.round(r.width * 100) / 100,
        borderW: parseFloat(cs.borderTopWidth) || 0,
        bg: cs.backgroundColor,
        pageBg: getComputedStyle(document.body).backgroundColor,
      }
    }
    return out
  })
  const m = await measure()
  await browser.close()

  const visible = (x) => x.h >= 20 && x.borderW >= 1 && x.bg !== x.pageBg
  console.log('真样式：高 ' + m.real.h + 'px、宽 ' + m.real.w + 'px、描边 ' + m.real.borderW + 'px、底色 ' + m.real.bg + '（页面底色 ' + m.real.pageBg + '）')
  console.log('旧写法：高 ' + m.old.h + 'px、宽 ' + m.old.w + 'px、描边 ' + m.old.borderW + 'px、底色 ' + m.old.bg)
  check(visible(m.real), '收起态按钮看得见：高≥20px 且有描边且有底色（实测 ' + m.real.h + 'px / ' + m.real.borderW + 'px / ' + m.real.bg + '）')
  check(m.real.w >= 110, '收起态按钮够宽（写全面板名，实测 ' + m.real.w + 'px ≥ 110）')
  check(!visible(m.old), '反证成立：旧写法量不通过（高 ' + m.old.h + 'px、描边 ' + m.old.borderW + 'px、底色 ' + m.old.bg + '）')

  console.log('\n共 ' + total + ' 项检查')
  if (failed) { console.log('存在失败'); process.exit(1) }
  console.log('全部通过')
}
main().catch((e) => { console.error(e); process.exit(1) })
