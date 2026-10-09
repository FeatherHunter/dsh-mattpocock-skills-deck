// 三张卡演示页的打包脚本：一条命令重出 demo.html（人认可的那份就是它生成的）。
// 用法：node .scratch/cards-demo/build.cjs
const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");
const dir = __dirname;
esbuild.buildSync({
  entryPoints: [path.join(dir, "main.ts")],
  bundle: true,
  outfile: path.join(dir, "bundle.js"),
  format: "iife",
  target: "es2020",
  loader: { ".ts": "ts" },
  logLevel: "warning",
});
const HEAD = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>S1/S6/S7 三张卡演示</title>' +
  '<style>body{margin:0;font:14px/1.6 system-ui,sans-serif;padding:18px;background:#8a6f4d;color:#2b2113}' +
  '.sec{margin:0 0 22px}.sec h2{font-size:15px;font-family:ui-monospace,Menlo,Consolas,monospace;color:#ffd97a;margin:0 0 8px}' +
  '.grid{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-start}</style></head><body><div id="root"></div><script>';
const html = HEAD + fs.readFileSync(path.join(dir, "bundle.js"), "utf8") + "</script></body></html>";
fs.writeFileSync(path.join(dir, "demo.html"), html, "utf8");
console.log("[cards-demo] demo.html 已重出，" + html.length + " 字节");
