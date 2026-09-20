// gen-fixture-640.js — 由真源生成「状态栏容器 vs 输入卡」宽度复现页 tests/fixtures/640-dock-width-repro.html
//
// 为什么要这一页（#640）：插件的状态栏住在宿主的输入区槽位里。那个槽位是个 display:contents 锚点，
// 本身不产生盒子；盒子是插件自己那个外层容器产生的。宿主输入卡的真实算式是（宿主产物原文）
//   .p_FcLG_root{padding:0 var(--dsh-composer-side-clearance) 8px}          ← 内层左右各留一个「侧距」
//   .p_FcLG_card{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width)}
// 即「卡片外框宽 = min(列宽 − 2×侧距, 卡宽上限)」。插件原来什么都没写，容器横向铺满整列，
// 比输入卡左右各宽出约 90 CSS px —— 宿主的输入区底色从那块多出来的地方露出来，就是那条横带。
//
// 本文件做两件事，且刻意分开：
//   一、**卡片那一侧用宿主原产物的算式**（从 DSH 桌面包里读出来，写在下面 HOST_CARD_*），保证量尺是外部的、不是自证的；
//   二、被测元素那一侧用插件自己的几何（从 StatusBar.js 的 dswsStatusDockGeom 读出来）。
// 如果哪天宿主改了卡片算式，本文件会因读取失败而报错，而不是悄悄变成「两边同一个公式」的恒真测试。
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const statusSrc = fs.readFileSync(path.join(root, 'src/client/statusbar/StatusBar.js'), 'utf8');
const stylesSrc = fs.readFileSync(path.join(root, 'src/client/kernel/styles.js'), 'utf8');

// ── 一、从宿主产物里读「卡片那一侧」的真算式 ────────────────────────────────
const HOST_BUNDLE = process.env.DSH_CONVERSATION_BUNDLE ||
  'D:\\0Tools\\DSH Desktop\\resources\\app\\node_modules\\@deepseek-ai\\dsh-client-ui-conversation\\lib\\client.js';
let hostRootRule = '';
let hostCardRule = '';
if (fs.existsSync(HOST_BUNDLE)) {
  const bundle = fs.readFileSync(HOST_BUNDLE, 'utf8');
  const pick = function (sel, label) {
    const re = new RegExp(sel.replace('.', '\\.') + '\\{([^}]*)\\}');
    const m = bundle.match(re);
    if (!m) throw new Error('宿主产物里找不到 ' + label + ' 的规则（' + sel + '）；宿主可能改名了，本 fixture 需要同步更新');
    return m[1];
  };
  hostRootRule = pick('.p_FcLG_root', '输入卡外层');
  hostCardRule = pick('.p_FcLG_card', '输入卡');
  // 哨兵：卡片必须仍然用「侧距」做内边距、用「卡宽上限」夹宽度。任一条变了，量尺就不再成立。
  if (!/padding:0 var\(--dsh-composer-side-clearance\)/.test(hostRootRule)) {
    throw new Error('宿主输入卡外层的 padding 不再是 0 var(--dsh-composer-side-clearance)：' + hostRootRule.slice(0, 160));
  }
  if (!/max-width:var\(--dsh-composer-card-max-width\)/.test(hostCardRule)) {
    throw new Error('宿主输入卡的 max-width 不再引用 --dsh-composer-card-max-width：' + hostCardRule.slice(0, 160));
  }
} else {
  throw new Error('找不到宿主产物：' + HOST_BUNDLE + '。本 fixture 必须拿宿主原文量尺，不能用插件自己的公式自证。');
}
// 只取判定用的三条，行为性的（border-radius / box-shadow 等）不需要进 fixture
const hostRootPad = (hostRootRule.match(/padding:0 var\(--dsh-composer-side-clearance\)[^;}]*/) || [''])[0];
const hostCardWidth = (hostCardRule.match(/width:100%/) || [''])[0];
const hostCardMax = (hostCardRule.match(/max-width:var\(--dsh-composer-card-max-width\)/) || [''])[0];
if (!hostRootPad || !hostCardWidth || !hostCardMax) {
  throw new Error('宿主卡片算式抽取不全：pad=' + hostRootPad + ' / width=' + hostCardWidth + ' / max=' + hostCardMax);
}

// ── 二、从插件真源里读「被测容器」的几何 ────────────────────────────────────
function pullGeom(field) {
  const m = statusSrc.match(new RegExp(field + ":\\s*'([^']+)'"));
  if (!m) throw new Error('StatusBar.js 的 dswsStatusDockGeom 里找不到 ' + field);
  return m[1];
}
const geomWidth = pullGeom('width');
const geomMaxWidth = pullGeom('maxWidth');
const geomPad = pullGeom('padding');
// 哨兵：容器宽度必须引用宿主「侧距」变量；这条算式如果退回 self-owned 常数，测试就没有意义了
if (!geomWidth.includes('--dsh-composer-side-clearance')) {
  throw new Error('dswsStatusDockGeom.width 不再引用 --dsh-composer-side-clearance：' + geomWidth);
}
// 横向 padding 必须为 0，否则胶囊会被再往里挤一层，与输入卡又对不上
if (!/^3px 0 0$/.test(geomPad)) {
  throw new Error('dswsStatusDockGeom.padding 必须是不带横向内边距的 "3px 0 0"，现在是：' + geomPad);
}

function pullCapsuleRule(needle) {
  const line = stylesSrc.split('\n').find((l) => l.includes(needle));
  if (!line) throw new Error('styles.js 里找不到规则: ' + needle);
  return line.slice(line.indexOf("'.") + 1, line.lastIndexOf("'"));
}
const capsuleRules = [pullCapsuleRule('.dsws-capsule{width:100%'), pullCapsuleRule('.dsws-capsule{max-width:var(--dsh-composer-card-max-width')];

// ── 三、搭页 ────────────────────────────────────────────────────────────────
// 卡宽上限按**宿主真实公式**算：宿主 root 上是
//   --dsh-chat-content-width: var(--dsh-chat-user-width, clamp(680px, calc(列宽 * .64), 920px))
//   --dsh-composer-card-max-width: calc(--dsh-chat-content-width + 32px)
// 用例里就直接写这条 clamp 算式，让门至少有一个用例落在宿主真数值上（而不是手填常数）。
const hostCardMaxFormula = function (colPx, stored) {
  const inner = 'clamp(680px, ' + (typeof stored === 'number' ? stored + 'px' : 'calc(' + colPx + 'px * .64)') + ', 920px)';
  return 'calc(' + inner + ' + 32px)';
};

const scenarioList = [
  { name: 'host-formula-col1428', viewport: 1428, cardMax: hostCardMaxFormula(1428), clearance: 16, inset: 8, variant: 'plain' },
  { name: 'host-formula-stored-userWidth', viewport: 1428, cardMax: hostCardMaxFormula(1428, 1199), clearance: 16, inset: 8, variant: 'plain' },
  { name: 'cardMax-binds-1120', viewport: 1428, cardMax: '1120px', clearance: 16, inset: 8, variant: 'plain' },
  { name: 'narrow-960', viewport: 960, cardMax: hostCardMaxFormula(960), clearance: 16, inset: 8, variant: 'plain' },
  { name: 'narrow-700', viewport: 700, cardMax: hostCardMaxFormula(700), clearance: 16, inset: 8, variant: 'plain' },
  { name: 'wide-clearance-24', viewport: 1510, cardMax: '1400px', clearance: 24, inset: 12, variant: 'plain' },
  { name: 'no-vars', viewport: 1428, cardMax: null, clearance: null, inset: null, variant: 'plain' },
  // #640 的三支容器都要被量到（有横幅 / 无横幅 / 收起态）；只量一支会漏掉「某一支忘了套几何」这类洞。
  { name: 'banner-branch-col1428', viewport: 1428, cardMax: hostCardMaxFormula(1428), clearance: 16, inset: 8, variant: 'banner' },
  { name: 'folded-branch-col1428', viewport: 1428, cardMax: hostCardMaxFormula(1428), clearance: 16, inset: 8, variant: 'folded' },
  // 宽列：让卡宽上限（2000）大过胶囊的自编兜底 1400，胶囊的上限才成为约束项。
  // 没有这一例时，把胶囊上限换回 min(100%,1400px) 这种改动量不出来（卡宽一直小于 1400，上限不生效）。
  { name: 'wide-col-cap-binds', viewport: 2400, cardMax: '2000px', clearance: 16, inset: 8, variant: 'plain' },
];

const makeDockStyle = function (variant) {
  if (variant === 'folded') {
    return ['display:flex', 'flex:none', 'justify-content:center',
      'width:' + geomWidth, 'max-width:' + geomMaxWidth, 'margin-left:auto', 'margin-right:auto',
      'box-sizing:border-box', 'padding:' + geomPad].join(';');
  }
  return ['display:flex', 'flex:none', 'flex-direction:column', 'align-items:center',
    'gap:' + (variant === 'banner' ? 4 : 2), 'position:relative',
    'width:' + geomWidth, 'max-width:' + geomMaxWidth, 'margin-left:auto', 'margin-right:auto',
    'box-sizing:border-box', 'padding:' + geomPad].join(';');
};

const capsuleHtml = "      <div class='dsws-capsule' data-capsule><span class='dsws-capsule-word'>MattSkills</span><span class='dsws-seg'>可接 0</span></div>";
const bannerHtml = "      <div class='dsws-banner warn' style='margin:0;max-width:560px'>横幅一行</div>";
const foldedHtml = "      <div class='dsws-folded-stub' style='display:inline-flex;align-items:center;padding:0 8px'>展开状态栏</div>";

const cases = scenarioList.map((sc) => {
  const vars = [];
  if (sc.cardMax !== null) vars.push('--dsh-composer-card-max-width:' + sc.cardMax);
  if (sc.clearance !== null) vars.push('--dsh-composer-side-clearance:' + sc.clearance + 'px');
  if (sc.inset !== null) vars.push('--dsh-composer-dock-inset:' + sc.inset + 'px');
  const columnStyle = ['display:flex', 'flex-direction:column', 'align-items:stretch', 'width:100%'].concat(vars).join(';');
  // 输入卡外层：变量缺失时**不写**那条 padding —— 宿主原文的 padding 里没有兜底值，
  //   变量缺失时整条 padding 作废，卡片的左右边就是列的两边。fixture 必须照这个实形来，
  //   否则「容器＝卡片」这条判据在旧宿主上会被量成「容器比卡片窄 32px」。
  const rootStyle = ['display:flex', 'flex-direction:column', 'align-items:center', sc.clearance === null ? '' : hostRootPad].join(';');
  // 输入卡：照宿主 .p_FcLG_card 的实形
  const cardStyle = ['box-sizing:border-box', hostCardWidth, hostCardMax, 'height:56px', 'border-radius:22px', 'background:#141414'].join(';');
  const inner = sc.variant === 'folded'
    ? foldedHtml.replace('      ', '')
    : [bannerHtml, capsuleHtml].join('\n');
  return [
    "<div class='case' data-case='" + sc.name + "' style='width:" + sc.viewport + "px'>",
    "  <div class='hostcol' style='" + columnStyle + "'>",
    "    <div class='wrap' data-wrap style='" + makeDockStyle(sc.variant) + "'>",
    inner,
    '    </div>',
    "    <div class='root' style='" + rootStyle + "'>",
    "      <div class='card' data-card style='" + cardStyle + "'>输入卡</div>",
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}).join('\n');

// 反证块：容器回到改造前那种「什么都不写」的写法，它必须量出比卡片宽 —— 证明这一页量得出问题
const antiProof = [
  "<div class='case' data-case='anti-unconstrained' style='width:1428px'>",
  "  <div class='hostcol' style='display:flex;flex-direction:column;align-items:stretch;width:100%;--dsh-composer-card-max-width:1231px;--dsh-composer-side-clearance:16px;--dsh-composer-dock-inset:8px'>",
  "    <div class='wrap' data-wrap style='display:flex;flex:none;flex-direction:column;align-items:center;gap:4;padding:3px 8px 0'>",
  "      <div class='dsws-capsule' data-capsule><span class='dsws-capsule-word'>MattSkills</span><span class='dsws-seg'>可接 0</span></div>",
  '    </div>',
  "    <div class='root' style='display:flex;flex-direction:column;align-items:center;" + hostRootPad + "'>",
  "      <div class='card' data-card style='box-sizing:border-box;" + hostCardWidth + ';' + hostCardMax + ";height:56px;border-radius:22px;background:#141414'>输入卡</div>",
  '    </div>',
  '  </div>',
  '</div>',
].join('\n');

const css = [
  'body{margin:0;background:#0a0a0a;color:#e6edf3;font-family:Arial,Helvetica,sans-serif}',
  '.case{margin:12px;padding:8px;border:1px dashed #3a3f4a}',
  '.case>b{display:block;font-size:11px;color:#9ca3af;margin-bottom:6px}',
  '.hostcol{background:#0a0a0a}',
  '.card{color:#e6edf3;font-size:12px;padding:6px 10px}',
  '.dsws-banner{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.45);color:#fbbf24;font-size:12px;padding:4px 8px;border-radius:8px}',
].concat(capsuleRules).join('\n');

const html = '<!doctype html><html><head><meta charset=utf-8><style>' + css + '</style></head><body>\n' +
  cases + '\n' + antiProof + '\n</body></html>';

const outDir = path.join(root, 'tests/fixtures');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, '640-dock-width-repro.html');
fs.writeFileSync(outFile, html);
console.log('fixture written', path.relative(root, outFile), html.length, 'bytes');
console.log('  量尺（宿主原文）：root「' + hostRootPad + '」 + card「' + hostCardWidth + ' / ' + hostCardMax + '」');
console.log('  被测（插件真源）：width「' + geomWidth + '」，maxWidth「' + geomMaxWidth + '」，padding「' + geomPad + '」');
