import fs from "fs";
const data = JSON.parse(fs.readFileSync("docs/star-history.json", "utf8"));
if (!data.length) { console.log("No data"); process.exit(0); }
const width = 800, height = 420, pad = 45;
const xs = data.map(d => new Date(d.date).getTime());
const totals = data.map(d => d.total);
const dailys = data.map(d => d.daily);
const minX = Math.min(...xs), maxX = Math.max(...xs), minY = 0, maxY = Math.max(...totals) * 1.15;
const maxDaily = Math.max(...dailys);
const x = t => pad + ((t - minX) / (maxX - minX || 1)) * (width - pad*2);
const y = v => height - pad - ((v - minY) / (maxY - minY || 1)) * (height - pad*2);
const yDaily = v => height - pad - ((v - 0) / (maxDaily * 3 || 1)) * (height - pad*2) * 0.3;
const jitter = (v) => v + (Math.random()-0.5)*1.0;
let totalPath = "";
let dailyPath = "";
data.forEach((p,i)=>{ const px=jitter(x(new Date(p.date).getTime())), py=jitter(y(p.total)); totalPath += (i===0?`M ${px} ${py}`:` L ${px} ${py}`); });
data.forEach((p,i)=>{ const px=jitter(x(new Date(p.date).getTime())), py=jitter(yDaily(p.daily)); dailyPath += (i===0?`M ${px} ${py}`:` L ${px} ${py}`); });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background:#0b0e14">
<style>text{font-family:"Patrick Hand",cursive;fill:#e6edf3} .axis{stroke:white;stroke-width:1.5}</style>
<rect width="100%" height="100%" fill="#0b0e14"/>
<text x="${width/2}" y="22" text-anchor="middle" font-size="16">Star History - Total & Daily</text>
<line x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}" class="axis"/>
<line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height-pad}" class="axis"/>
<path d="${totalPath}" fill="none" stroke="#ff6b6b" stroke-width="2.8" stroke-linecap="round" opacity="0.95"/>
<path d="${dailyPath}" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-dasharray="5 4" opacity="0.85"/>
</svg>`;
fs.writeFileSync("docs/star-history.svg", svg);
console.log("Wrote docs/star-history.svg");
