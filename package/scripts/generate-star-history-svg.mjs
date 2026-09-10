// Star History 静态图表生成器：自包含 SVG，深浅双主题，供 README 直接内嵌。
// 设计要点：
// 1. buildSvg(data, theme) 是纯函数，无 IO、无全局随机——同输入必产出同字节，
//    保证每日 Action 在数据不变时不产生噪声提交。
// 2. 手绘感来自确定性种子抖动（fnv1a + mulberry32），而不是 Math.random。
// 3. 单一比例尺：Total 与 Daily 画在同一坐标系，图上不撒谎；细节留给交互页。
// 4. 字体走本机手写体回退链——SVG 以 <img> 渲染时不允许加载外部字体。
import fs from "fs";
import { pathToFileURL } from "url";

const THEMES = {
  dark:  { bg: "#0b0e14", text: "#e6edf3", muted: "#9aa3b2", grid: "#232b3a", axis: "#cdd9e5", total: "#ff6b6b", daily: "#38bdf8" },
  light: { bg: "#fffdf7", text: "#24292f", muted: "#57606a", grid: "#e8ebf0", axis: "#24292f", total: "#d94f4f", daily: "#2f81f7" },
};

const FONT = '"Comic Sans MS","Comic Sans","Chalkboard SE","Marker Felt","Segoe Print",cursive';
const W = 840, H = 480, PAD_L = 64, PAD_R = 36, PAD_T = 64, PAD_B = 58;

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function niceStep(rough) {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1, rough))));
  for (const m of [1, 2, 5, 10]) if (m * pow >= rough) return m * pow;
  return 10 * pow;
}

// Catmull-Rom 转贝塞尔，让曲线圆滑接近手绘描线
function smoothPath(pts) {
  if (pts.length === 1) return `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

export function buildSvg(data, themeName = "dark") {
  const t = THEMES[themeName] || THEMES.dark;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const rng = mulberry32(fnv1a(JSON.stringify(data) + themeName));
  const j = (amp) => (rng() - 0.5) * 2 * amp;

  const totals = data.map((d) => d.total);
  const maxTotal = Math.max(1, ...totals);
  const yStep = niceStep(maxTotal / 4);
  const yMax = Math.max(yStep, Math.ceil((maxTotal * 1.06) / yStep) * yStep);

  const times = data.map((d) => Date.parse(d.date + "T00:00:00Z"));
  const minX = Math.min(...times), maxX = Math.max(...times);
  const X = (i) => (data.length === 1 ? PAD_L + plotW / 2 : PAD_L + ((times[i] - minX) / (maxX - minX)) * plotW);
  const Y = (v) => PAD_T + plotH - (v / yMax) * plotH;

  const yTicks = [];
  for (let v = 0; v <= yMax; v += yStep) yTicks.push(v);
  const want = Math.min(5, data.length);
  const xTicks = [...new Set(Array.from({ length: want }, (_, k) => Math.round((k * (data.length - 1)) / (want - 1 || 1))))]
    .map((i) => ({ i, label: data[i].date.slice(5).replace("-", "/") }));

  const totalPts = data.map((d, i) => [X(i) + j(1.1), Y(d.total) + j(1.1)]);
  const dailyPts = data.map((d, i) => [X(i) + j(1.1), Y(d.daily) + j(1.1)]);

  const axisY = PAD_T + plotH;
  const sketchy = (x1, y1, x2, y2) => {
    let d = `M ${x1} ${y1}`;
    const segs = 8;
    for (let s = 1; s <= segs; s++) {
      const f = s / segs;
      d += ` L ${(x1 + (x2 - x1) * f + j(1.2)).toFixed(1)} ${(y1 + (y2 - y1) * f + j(1.2)).toFixed(1)}`;
    }
    return d;
  };

  const gridLines = yTicks.slice(1).map((v) =>
    `<line x1="${PAD_L}" y1="${Y(v).toFixed(1)}" x2="${W - PAD_R}" y2="${Y(v).toFixed(1)}" stroke="${t.grid}" stroke-width="1" opacity="0.7"/>`).join("\n  ");
  const yLabels = yTicks.map((v) =>
    `<text x="${PAD_L - 10}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" font-size="13" fill="${t.muted}">${v}</text>`).join("\n  ");
  const xLabels = xTicks.map((tk) =>
    `<text x="${X(tk.i).toFixed(1)}" y="${axisY + 24}" text-anchor="middle" font-size="13" fill="${t.muted}">${tk.label}</text>`).join("\n  ");

  const legend = `
  <rect x="${PAD_L + 14}" y="${PAD_T + 8}" width="152" height="52" rx="7" fill="${t.bg}" stroke="${t.text}" stroke-width="1.4" opacity="0.92"/>
  <line x1="${PAD_L + 26}" y1="${PAD_T + 24}" x2="${PAD_L + 52}" y2="${PAD_T + 24}" stroke="${t.total}" stroke-width="3" stroke-linecap="round"/>
  <text x="${PAD_L + 60}" y="${PAD_T + 28}" font-size="13">Total Stars</text>
  <line x1="${PAD_L + 26}" y1="${PAD_T + 44}" x2="${PAD_L + 52}" y2="${PAD_T + 44}" stroke="${t.daily}" stroke-width="2" stroke-dasharray="6 4" stroke-linecap="round"/>
  <text x="${PAD_L + 60}" y="${PAD_T + 48}" font-size="13">Daily New</text>`;

  const midY = (PAD_T + axisY) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <style>text{font-family:${FONT};fill:${t.text}}</style>
  <rect width="100%" height="100%" fill="${t.bg}"/>
  <text x="${W / 2}" y="34" text-anchor="middle" font-size="21">⭐ Star History</text>
  ${gridLines}
  <path d="${sketchy(PAD_L, axisY, W - PAD_R, axisY)}" stroke="${t.axis}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <path d="${sketchy(PAD_L, PAD_T, PAD_L, axisY)}" stroke="${t.axis}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  ${yLabels}
  ${xLabels}
  <text x="18" y="${midY}" font-size="12" fill="${t.muted}" transform="rotate(-90 18 ${midY})" text-anchor="middle">Stars</text>
  <text x="${W / 2}" y="${H - 12}" font-size="12" fill="${t.muted}" text-anchor="middle">Date</text>
  <path d="${smoothPath(dailyPts)}" fill="none" stroke="${t.daily}" stroke-width="1.8" stroke-dasharray="6 4" stroke-linecap="round" opacity="0.9"/>
  <path d="${smoothPath(totalPts)}" fill="none" stroke="${t.total}" stroke-width="3" stroke-linecap="round"/>
${legend}
  <text x="${W - PAD_R}" y="${axisY + 44}" text-anchor="end" font-size="12" fill="${t.muted}">${totals[totals.length - 1]} stars · ${data[data.length - 1].date}</text>
</svg>`;
}

function main() {
  const data = JSON.parse(fs.readFileSync("docs/star-history.json", "utf8"));
  if (!Array.isArray(data) || !data.length) { console.log("No data"); process.exit(0); }
  fs.writeFileSync("docs/star-history-dark.svg", buildSvg(data, "dark"));
  fs.writeFileSync("docs/star-history-light.svg", buildSvg(data, "light"));
  console.log(`Wrote docs/star-history-dark.svg + docs/star-history-light.svg (${data.length} days, ${data[data.length - 1].total} stars)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
