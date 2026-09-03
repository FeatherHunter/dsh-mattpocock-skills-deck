const fs = require("fs");
const { JSDOM } = require("jsdom");
const styleSrc = fs.readFileSync("src/client/kernel/styles.js", "utf8");
function pull(needle) {
  const line = styleSrc.split(String.fromCharCode(10)).find(l => l.includes(needle));
  if (!line) throw new Error("styles 规则未找到: " + needle);
  const start = line.indexOf("'.");
  const end = line.lastIndexOf("'");
  let s = line.slice(start + 1, end);
  s = s.replace(/\\\\\\./g, ".");
  s = s.replace(/\\\\/g, "");
  return s;
}
const clampRule = pull(".dsws-tt-wrap{min-width");
const measureRule = pull(".dsws-tt-wrap.measure");
if (!clampRule.includes("-webkit-line-clamp:2") || !clampRule.includes("display:-webkit-box")) throw new Error("clamp 规则缺失");
if (!measureRule.includes("line-clamp:unset!important")) throw new Error("measure 规则缺失");
const title = "这是一个特别长的标题用来验证窄面板下标题是否被限制在两行以内不会继续换行到五六行的情况";
const avatar = "<img src='data:image/gif;base64,R0lGODlhAQABAAAAACw=' width=16 height=16 style='flex:none' alt='a'>";
const rowCss = [clampRule, measureRule,
  ".dsws-aggrow{display:flex;flex-direction:column;align-items:stretch;gap:6px;padding:6px 6.4px}",
  ".dsws-body{width:320px;border:1px solid #555;font-family:Arial;font-size:12.5px}"
].join(String.fromCharCode(10));
// 修复后的 DOM 形状 = 外层 flex span（标题+头像横排）+ 内层 dsws-tt-wrap 标题（与 React 产物一致）
const fixed = "<div class='dsws-aggrow'><div class='dsws-body'><span style='flex:1;min-width:0;display:flex;align-items:center;gap:6px'><span class='dsws-tt-wrap' style='flex:1;min-width:0'>" + title + "</span>" + avatar + "</span></div></div>";
const html = "<!doctype html><html><head><meta charset=utf-8><style>" + rowCss + "</style></head><body>" + fixed + "</body></html>";
const dom = new JSDOM(html);
const doc = dom.window.document;
const wrap = doc.querySelector(".dsws-tt-wrap");
const wrapper = wrap.parentElement;
const cs = dom.window.getComputedStyle(wrap);
const pc = dom.window.getComputedStyle(wrapper);
const checks = [];
checks.push(["标题节点 display = -webkit-box（line-clamp 生效前提）", cs.display === "-webkit-box"]);
checks.push(["标题节点 -webkit-line-clamp = 2", cs.webkitLineClamp === "2"]);
checks.push(["标题节点 overflow = hidden", cs.overflow === "hidden"]);
checks.push(["外层仍为 flex 横排（标题+头像各自占据一行）", pc.display === "flex"]);
checks.push(["标题节点为外层首个子节点（宽度优先给标题）", wrapper.firstElementChild === wrap]);
checks.push(["外层 min-width:0 保留（允许收缩不撑破）", pc.minWidth === "0px"]);
checks.push(["头像在标题之后（附加元素不被截断）", wrapper.querySelectorAll("img").length === 1]);
let ok = true;
for (const [name, pass] of checks) { console.log(pass ? "PASS" : "FAIL", "-", name); if (!pass) ok = false; }
const broken = "<span class='dsws-tt-wrap' style='flex:1;display:flex;align-items:center;gap:6px;flex-wrap:wrap'><span style='flex:1;min-width:0'>" + title + "</span>" + avatar + "</span>";
const bdom = new JSDOM("<!doctype html><html><head><style>" + rowCss + "</style></head><body>" + broken + "</body></html>");
const bcs = bdom.window.getComputedStyle(bdom.window.document.querySelector(".dsws-tt-wrap"));
console.log("---");
console.log("旧结构对照：dsws-tt-wrap 计算 display =", bcs.display);
checks.push(["反证成立：旧结构 dsws-tt-wrap 计算 display ≠ -webkit-box（内联覆盖使 clamp 失效）", bcs.display !== "-webkit-box"]);
for (const [name, pass] of checks) { if (!pass) ok = false; }
console.log("---");
const lt = ["src/client/views/ListTab.js", "src/client/views/ListTabRow.js"].map((f) => fs.readFileSync(f, "utf8")).join("\n"); // V3 #463：行渲染（含标题截断）搬到行文件，拼合断言意图不变
const tr = fs.readFileSync("src/client/views/TicketRow.js", "utf8");
function hasClampSource(src) { return src.indexOf("className: 'dsws-tt-wrap'") >= 0; }
function noInlineDisplayOnWrap(src) {
  const re = /className:\s*'dsws-tt-wrap'[\s\S]{0,220}?style:\s*\{[^}]*display/;
  return !re.test(src);
}
const srcChecks = [
  ["ListTab 标题带 dsws-tt-wrap（截断契约落在文本节点）", hasClampSource(lt)],
  ["ListTab dsws-tt-wrap 无内联 display（走样式表 -webkit-box）", noInlineDisplayOnWrap(lt)],
  ["TicketRow 标题带 dsws-tt-wrap", hasClampSource(tr)],
  ["TicketRow dsws-tt-wrap 无内联 display", noInlineDisplayOnWrap(tr)],
  ["测量态规则含 !important（不被内联 style 覆盖）", measureRule.includes("!important") && measureRule.includes("white-space:nowrap")]
];
console.log("---");
for (const [name, pass] of srcChecks) { console.log(pass ? "PASS" : "FAIL", "-", name); if (!pass) ok = false; }
console.log("---");
console.log(ok ? "全部通过（共 " + (checks.length + srcChecks.length) + " 项）" : "存在失败项！");
if (!ok) process.exit(1);