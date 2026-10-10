// verify-640-dock-width-browser.js — 真实 Chromium 量「状态栏容器左右边 == 输入卡左右边」（#640）
//
// 起因：#640 报的是「输入框上方出现横向大面积背景带，且提示条 / 状态栏胶囊 / 输入框三者左右边互相对不齐」。
// 本门的判据是几何的，不是字符串的：
//   展开态（无横幅 / 有横幅）插件状态栏最外层容器的左右边，必须落在输入卡的左右边上（容差 1px）；
//   收起态是例外：只剩一句小字，容器收成包裹内容、居中落在卡片以内（不超出、不等宽）；胶囊不得超过卡片宽。
//
// 量尺必须来自外部：fixture 里「卡片那一侧」用的是**宿主产物原文**的算式（由 scripts/gen-fixture-640.js
// 从 DSH 桌面包里读出来）—— 输入卡外层「padding:0 var(--dsh-composer-side-clearance) <底距>」+
// 输入卡「width:100%; max-width:var(--dsh-composer-card-max-width)」；被测元素那一侧才用插件的几何。
// 两边不是同一个公式 —— 否则这道门恒真。宿主 0.2.0-rc.2 起把类名换成了 CSS Modules 哈希名
// （老名字 .p_FcLG_root / .p_FcLG_card 已经不在），所以抠规则改走「先认类名、失败按算式特征扫」。
// 反证用例同为必需：容器回到改造前那种「不做宽度约束」的写法时，本门必须量出「容器比卡片宽」。
//
// 宿主产物怎么找（2026-10-04）：候选 = 环境变量 DSH_CONVERSATION_BUNDLE → 原写死的那条安装路径 →
//   asar 解包缓存（scripts/gen-fixture-640.js 会用 scripts/asar-extract.js 从
//   D:\DeepseekHarness\resources\app.asar 里把宿主原文抽出来）。全都拿不到时本门**明确跳过**：
//   打印 SKIP + 试过的路径清单、exit 0；设 DSWS_REQUIRE_HOST_BUNDLE=1 时跳过算失败（exit 1），防假绿。
//
// 依赖：playwright（含 chromium）。无登录令牌也能跑（纯本地 fixture 页）。
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

let ok = true;
const check = function (cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) ok = false; };

(async () => {
  const gen = require(path.resolve(__dirname, '../scripts/gen-fixture-640.js'));
  // 找不到宿主原文产物：本门没有外部量尺就无从判定 —— 按仓库惯例「明确跳过」，不报红也不装绿。
  //   设 DSWS_REQUIRE_HOST_BUNDLE=1 时跳过算失败（给 CI 或严格场合用）。
  if (gen.skipped) {
    console.log('SKIP verify-640：本机找不到宿主原文产物（这道门量的是「容器 vs 宿主输入卡」的外部尺子，缺了它没有替代量法）。');
    console.log('  试过这些路径：');
    (gen.tried || []).forEach(function (p) { console.log('    ' + p); });
    console.log('  asar 兜底：' + (gen.asarDisabled ? '被 DSWS_640_NO_ASAR=1 关掉' : ('试过 ' + gen.asarPath + ' 的 ' + gen.asarEntry)));
    console.log('  要跑：把宿主那份 client.js 放到任一候选位置，或设 DSH_CONVERSATION_BUNDLE=<client.js 路径>。');
    console.log('  口径：默认跳过不算红（exit 0）；设 DSWS_REQUIRE_HOST_BUNDLE=1 时跳过算失败（exit 1）。');
    process.exit(process.env.DSWS_REQUIRE_HOST_BUNDLE === '1' ? 1 : 0);
  }

  // ── A 组：量尺从哪来、规则怎么抠 —— 两条路径各有断言 + 反证 ──────────────────
  check(!!gen.hostBundle && fs.existsSync(gen.hostBundle), 'A1 宿主原文产物找到并存在：' + gen.hostBundle + '（来源：' + gen.hostBundleFrom + '）');
  check(/padding:0 var\(--dsh-composer-side-clearance\)/.test(gen.hostRootRule), 'A2 输入卡外层规则取自宿主原文：' + String(gen.hostRootRule).slice(0, 90));
  check(/max-width:var\(--dsh-composer-card-max-width\)/.test(gen.hostCardRule), 'A3 输入卡规则取自宿主原文：' + String(gen.hostCardRule).slice(0, 90));
  let byFeature = '';
  try { byFeature = gen.pickRule('.p_NOT_THERE_root', function (b) { return /^padding:0 var\(--dsh-composer-side-clearance\)\s+\d/.test(b); }, '输入卡外层'); } catch (e) { byFeature = ''; }
  check(/padding:0 var\(--dsh-composer-side-clearance\)/.test(byFeature), 'A4 反证：类名不存在时按算式特征仍扫得到（实得 ' + String(byFeature).slice(0, 90) + '）');
  let threw = false;
  try { gen.pickByFormula(gen.hostBundleText, function (b) { return /这份产物里绝不可能出现的算式/.test(b); }, '输入卡外层'); } catch (e) { threw = true; }
  check(threw, 'A5 反证：算式特征找不到时报错（不是随便返回第一条）');

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
  console.log('用例                      容器左右            卡片左右            左差   右差   对齐/包住  胶囊≤卡片');
  for (const r of rows) {
    const dL = Math.round((r.wrapL - r.cardL) * 100) / 100;
    const dR = Math.round((r.wrapR - r.cardR) * 100) / 100;
    const aligned = Math.abs(dL) <= TOL && Math.abs(dR) <= TOL;
    const capFits = r.capW < 0 || r.capW <= r.cardW + TOL; // 收起态没有胶囊，跳过这一条
    const isAnti = r.name === 'anti-unconstrained';
    const isFolded = r.name.indexOf('folded') === 0;
    // 收起态是例外：只剩一句小字，容器收成包裹内容、居中落在卡片以内（不对齐等宽）。
    const foldedInside = r.wrapL >= r.cardL - TOL && r.wrapR <= r.cardR + TOL;
    const foldedCentered = Math.abs((r.wrapL - r.cardL) - (r.cardR - r.wrapR)) <= 2 * TOL;
    const foldedNarrower = r.wrapW < r.cardW - 10;
    const foldedOk = foldedInside && foldedCentered && foldedNarrower;
    const verdict = isFolded ? foldedOk : aligned;
    console.log(
      r.name.padEnd(24) + ' ' +
      (r.wrapL + '..' + r.wrapR).padEnd(19) + ' ' +
      (r.cardL + '..' + r.cardR).padEnd(19) + ' ' +
      String(dL).padStart(6) + ' ' + String(dR).padStart(6) + '   ' +
      (verdict ? '是  ' : '否  ').padEnd(10) + (capFits ? '是' : '否')
    );
    if (isAnti) {
      // 反证：改造前的写法必须量出「容器比卡片宽」；量不出来说明这一页失效
      if (aligned) { console.log('FAIL 反证用例竟然也对齐了 —— 这一页量不出问题，门是假绿的'); ok = false; }
      else console.log('PASS 反证成立：不做宽度约束时容器比卡片宽 ' + Math.round((r.wrapW - r.cardW) * 100) / 100 + 'px');
    } else if (isFolded) {
      if (!foldedOk) { console.log('FAIL ' + r.name + ' 收起态容器没有包住居中（是否在卡内 ' + foldedInside + '、是否居中 ' + foldedCentered + '、是否收窄 ' + foldedNarrower + '，容器宽 ' + r.wrapW + '、卡片宽 ' + r.cardW + '）'); ok = false; }
      else console.log('PASS ' + r.name + '（收起态包住居中：容器宽 ' + r.wrapW + ' < 卡片宽 ' + r.cardW + '）');
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
    ? '全部通过：展开态容器左右边落在输入卡左右边上、收起态容器包住一句小字居中、胶囊不超过卡片宽；反证用例仍能测出问题'
    : '存在失败项');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
