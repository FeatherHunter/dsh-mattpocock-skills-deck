import fs from "fs";
import { aggregateByDay } from "./star-history.mjs";
const list = fs.readFileSync("/tmp/stars.txt", "utf8").trim().split("\n").filter(Boolean);
const agg = aggregateByDay(list);
fs.writeFileSync("docs/star-history.json", JSON.stringify(agg, null, 2) + "\n");
console.log("Wrote", agg.length, "days, total", agg[agg.length-1]?.total);
