// 三张卡演示页的打包脚本：一条命令重出 demo.html（人认可的那份就是它生成的）。
// 用法：node .scratch/cards-demo/build.mts
import esbuild from "esbuild";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const dir = fileURLToPath(new URL('.', import.meta.url));

// 界面词表 locale-data.ts 是 scripts/generate-locale-config.mts 生成的东西（被 .gitignore 忽略，
// 新克隆的仓库里没有）。缺了就先补跑一次生成器，否则 esbuild 只会甩一句 "Could not resolve"，
// 让人以为是路径写错了。生成器的真源 config/copy/*.yaml 是入库的，所以这一步在任何克隆里都能跑。
const localeData = path.join(dir, '../../src/client/kernel/locale-data.ts');
if (!fs.existsSync(localeData)) {
  console.log('[cards-demo] 缺少界面词表生成物 locale-data.ts，先跑 scripts/generate-locale-config.mts');
  const gen = spawnSync(process.execPath, [path.join(dir, '../../scripts/generate-locale-config.mts')], { stdio: 'inherit' });
  if (gen.status !== 0) {
    throw new Error('界面词表生成失败（scripts/generate-locale-config.mts），demo.html 没有重出');
  }
  if (!fs.existsSync(localeData)) {
    throw new Error('界面词表生成器跑完了，但 src/client/kernel/locale-data.ts 还是没有生成出来');
  }
}

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
