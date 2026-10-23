// 迁移说明（#1252）：由 scripts/update-star-history.mjs 转写而来，零行为变化，只加类型注解；切口后旧文件已删。
// 拉取到的 starred_at 列表 → 聚合覆盖 docs/star-history.json
// 输入路径参数化：CI 传 /tmp/stars.txt，本地可传任意路径，两端同一套代码
import fs from "fs";
import { aggregateByDay, withZeroStart } from "./star-history.mts";

const input: string = process.argv[2] || "/tmp/stars.txt";
const list: string[] = fs.readFileSync(input, "utf8").trim().split(/\r?\n/).filter(Boolean);
const agg = withZeroStart(aggregateByDay(list));
fs.writeFileSync("docs/star-history.json", JSON.stringify(agg, null, 2) + "\n");
console.log("Wrote", agg.length, "days, total", agg[agg.length - 1]?.total);
