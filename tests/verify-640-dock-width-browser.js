// verify-640-dock-width-browser.js — 真实 Chromium 量「状态栏容器左右边 == 输入卡左右边」（#640）
//
// 起因：#640 报的是「输入框上方出现横向大面积背景带，且提示条 / 状态栏胶囊 / 输入框三者左右边互相对不齐」。
// 本门的判据是几何的，不是字符串的：
//   插件状态栏最外层容器的左右边，必须落在输入卡的左右边上（容差 1px）；胶囊不得超过卡片宽。
//
// 量尺必须来自外部：fixture 里「卡片那一侧」用的是**宿主产物原文**（.p_FcLG_root 的
// `padding:0 var(--dsh-composer-side-clearance) 8px` + .p_FcLG_card 的
// `width:100%; max-width:var(--dsh-composer-card-max-width)`，由 scripts/gen-fixture-640.js
// 从 DSH 桌面包里读出来），被测元素那一侧才用插件的几何。两边不是同一个公式 —— 否则这道门恒真。
// 反证用例同为必需：容器回到改造前那种「不做宽度约束」的写法时，本门必须量出「容器比卡片宽」。
//
// 依赖：playwright（含 chromium）。无登录令牌也能跑（纯本地 fixture 页）。
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const gen = require(path.resolve(__dirname, '../scripts/gen-fixture-640.js'));
  void gen;
  const fixture = path.resolve(__dirname, 'fixtures/640-dock-width-repro.html');
  if (!fs.existsSync(fixture)) { console.error('fixture 缺失：' + fixture); process.exit(1); }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 2500, height: 1600 } });
  await page.goto('file:///' + fixture.replace(/\\/g, '/'));
  const rows = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.case').forEach((c) => {
      const wrap = c.querySelector('[data-wrap]');
      const card = c.querySelector('[data-card]');
      const cap = c.querySelector('[data-capsule]');
      // 收起态那一支本来就没有胶囊，只要求有容器和卡片；其余用例三样都要有。
      const needsCapsule = c.dataset.case.indexOf('folded') !== 0;
      if (!wrap || !card || (needsCapsule && !cap)) {
        throw new Error('用例 ' + c.dataset.case + ' 缺元素：wrap=' + !!wrap + ' card=' + !!card + ' capsule=' + !!cap);
      }
      const rw = wrap.getBoundingClientRect(), rc = card.getBoundingClientRect();
      out.push({
        name: c.dataset.case,
        wrapL: Math.round(rw.left * 100) / 100, wrapR: Math.round(rw.right * 100) / 100, wrapW: Math.round(rw.width * 100) / 100,
        cardL: Math.round(rc.left * 100) / 100, cardR: Math.round(rc.right * 100) / 100, cardW: Math.round(rc.width * 100) / 100,
        capW: cap ? Math.round(cap.getBoundingClientRect().width * 100) / 100 : -1,
      });
    });
    if (!out.length) throw new Error('fixture 里一个用例都没有：' + document.body.innerHTML.slice(0, 200));
    return out;
  });
  await browser.close();

  const TOL = 1.0; // 1px：允许子像素取整
  let ok = true;
  console.log('用例                      容器左右            卡片左右            左差   右差   容器=卡片  胶囊≤卡片');
  for (const r of rows) {
    const dL = Math.round((r.wrapL - r.cardL) * 100) / 100;
    const dR = Math.round((r.wrapR - r.cardR) * 100) / 100;
    const aligned = Math.abs(dL) <= TOL && Math.abs(dR) <= TOL;
    const capFits = r.capW < 0 || r.capW <= r.cardW + TOL; // 收起态没有胶囊，跳过这一条
    const isAnti = r.name === 'anti-unconstrained';
    console.log(
      r.name.padEnd(24) + ' ' +
      (r.wrapL + '..' + r.wrapR).padEnd(19) + ' ' +
      (r.cardL + '..' + r.cardR).padEnd(19) + ' ' +
      String(dL).padStart(6) + ' ' + String(dR).padStart(6) + '   ' +
      (aligned ? '是  ' : '否  ').padEnd(10) + (capFits ? '是' : '否')
    );
    if (isAnti) {
      // 反证：改造前的写法必须量出「容器比卡片宽」；量不出来说明这一页失效
      if (aligned) { console.log('FAIL 反证用例竟然也对齐了 —— 这一页量不出问题，门是假绿的'); ok = false; }
      else console.log('PASS 反证成立：不做宽度约束时容器比卡片宽 ' + Math.round((r.wrapW - r.cardW) * 100) / 100 + 'px');
    } else if (!aligned) {
      console.log('FAIL ' + r.name + ' 容器左右边没落在卡片左右边上（左差 ' + dL + '，右差 ' + dR + '）');
      ok = false;
    } else if (!capFits) {
      console.log('FAIL ' + r.name + ' 胶囊比输入卡还宽（' + r.capW + ' > ' + r.cardW + '）');
      ok = false;
    } else {
      console.log('PASS ' + r.name);
    }
  }
  console.log(ok
    ? '全部通过：' + rows.length + ' 种列宽/变量组合（含三种容器分支与宽列下胶囊上限生效的那一档）下，'
      + '状态栏容器左右边都落在输入卡左右边上，胶囊不超过卡片宽；反证用例仍能测出问题'
    : '存在失败项');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
