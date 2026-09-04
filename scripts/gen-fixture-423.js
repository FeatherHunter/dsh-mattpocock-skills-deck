// gen-fixture-423.js — 由真源 styles.js 提取 .dsws-tt-wrap 规则，生成浏览器复现页 tests/fixtures/423-clamp-repro.html
const fs = require('fs');
const styleSrc = fs.readFileSync('src/client/kernel/styles.js', 'utf8');
function pull(needle) {
  const line = styleSrc.split(String.fromCharCode(10)).find(l => l.includes(needle));
  if (!line) throw new Error('styles 规则未找到: ' + needle);
  const start = line.indexOf(String.fromCharCode(39) + '.');
  const end = line.lastIndexOf(String.fromCharCode(39));
  let s = line.slice(start + 1, end);
  s = s.replace(/\\\\\\./g, '.');
  s = s.replace(/\\\\/g, '');
  return s;
}
const clampRule = pull('.dsws-tt-wrap{min-width');
const measureRule = pull('.dsws-tt-wrap.measure');
const title = '这是一个特别长的标题用来验证窄面板下标题是否被限制在两行以内不会继续换行到五六行的情况';
const title2 = 'Fix log formatting edge cases and update README with new example configurations for users';
const avatar = "<img src='data:image/gif;base64,R0lGODlhAQABAAAAACw=' width=16 height=16 style='flex:none' alt='a'>";
const rowCss = [
  'body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#111;color:#eee}',
  '.dsws-aggrow{display:flex;flex-direction:column;align-items:stretch;gap:6px;padding:6px 6.4px;font-size:13px;line-height:1.6}',
  '.dsws-row1{display:flex;align-items:flex-start;gap:8px}',
  '.case{margin:14px 0;padding:8px;border:1px dashed #3a3f4a;border-radius:8px}',
  '.case b{display:block;font-size:11px;color:#9ca3af;margin-bottom:6px}',
  clampRule, measureRule
].join(String.fromCharCode(10));
const cases = [
  { name: 'fixed-320', w: '320px', body: "<div class='dsws-row1'><span style='flex:1;min-width:0;display:flex;align-items:center;gap:6px'><span class='dsws-tt-wrap' style='flex:1;min-width:0'>" + title + "</span>" + avatar + "</span></div>" },
  { name: 'broken-320', w: '320px', body: "<span class='dsws-tt-wrap' style='flex:1;display:flex;align-items:center;gap:6px;flex-wrap:wrap'><span style='flex:1;min-width:0'>" + title + "</span>" + avatar + "</span>" },
  { name: 'fixed-260', w: '260px', body: "<div class='dsws-row1'><span style='flex:1;min-width:0;display:flex;align-items:center;gap:6px'><span class='dsws-tt-wrap' style='flex:1;min-width:0'>" + title + "</span>" + avatar + "</span></div>" },
  { name: 'broken-260', w: '260px', body: "<span class='dsws-tt-wrap' style='flex:1;display:flex;align-items:center;gap:6px;flex-wrap:wrap'><span style='flex:1;min-width:0'>" + title + "</span>" + avatar + "</span>" },
  { name: 'fixed-en-320', w: '320px', body: "<div class='dsws-row1'><span style='flex:1;min-width:0;display:flex;align-items:center;gap:6px'><span class='dsws-tt-wrap' style='flex:1;min-width:0'>" + title2 + "</span>" + avatar + "</span></div>" },
  { name: 'fixed-short-320', w: '320px', body: "<div class='dsws-row1'><span style='flex:1;min-width:0;display:flex;align-items:center;gap:6px'><span class='dsws-tt-wrap' style='flex:1;min-width:0'>修复标题截断</span>" + avatar + "</span></div>" }
];
const html = "<!doctype html><html><head><meta charset=utf-8><style>" + rowCss + "</style></head><body>" + cases.map(c => "<div class='case' data-case='" + c.name + "' style='width:" + c.w + "'><b>" + c.name + "</b>" + c.body + "</div>").join(String.fromCharCode(10)) + "</body></html>";
fs.mkdirSync('tests/fixtures', { recursive: true });
fs.writeFileSync('tests/fixtures/423-clamp-repro.html', html);
console.log('fixture written', html.length, 'bytes');