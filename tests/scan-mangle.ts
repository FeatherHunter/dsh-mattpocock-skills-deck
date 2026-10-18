// tests/scan-mangle.ts —— 手工扫描两条构建产物里「别的名字被压成 xxr(」的痕迹（例如 t 被压成 tr 之外的名字）。
// 这是一把手的探针：没有判定阈值，只把命中的名字打出来给人看，链上没有任何门禁引用它。
// 审查结论：不能删（全仓仅此一处这条正则，说不出继任者），改名为 .ts 保留原样。
// 跑法：node --import ./scripts/ts-hook.mts tests/scan-mangle.ts
const fs = require('fs');
for (const f of ['client.js', 'package/lib/client.js']) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /\b([A-Za-z0-9_$]+)r\('[a-z]/g;
  const hits = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = m[1] + 'r';
    if (name !== 'tr') hits.add(m[1] + 'r(');
  }
  console.log(f, '->', [...hits].join(' '));
}
