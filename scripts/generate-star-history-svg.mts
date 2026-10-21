// 迁移说明（#1252）：本文件由 scripts/generate-star-history-svg.mjs 转写而来，只加类型注解，行为零变化。
// Star History 静态图表生成器：自包含 SVG，深浅双主题，供 README 直接内嵌。
// 设计要点：
// 1. buildSvg(data, theme) 是纯函数，无 IO、无全局随机——同输入必产出同字节，
//    保证每日 Action 在数据不变时不产生噪声提交。
// 2. 手绘感来自确定性种子抖动（fnv1a + mulberry32），而不是 Math.random。
// 3. 双 Y 轴：Total Stars 走左轴，Daily New 走右轴，各自按自己的最大值缩放。
//    两条线共用一根轴时，总量一大、每日新增就被压成贴着 X 轴的一条平线；
//    右轴的刻度数字、轴线与轴名全部染成 Daily 的颜色，读者一眼能看出哪根线读哪根轴。
//    细节留给交互页。
// 4. 字体走本机手写体回退链——SVG 以 <img> 渲染时不允许加载外部字体。
// 5. 两条曲线都要平滑、都不许有尖锐折角，但平滑手法不同：Total 单调上升，用 Catmull-Rom
//    就够；Daily 是小整数、天天上下跳，用单调三次插值（Fritsch–Carlson）过点，既圆滑，
//    又保证任意两个相邻点之间不越过这两点的取值——不会像 Catmull-Rom 那样在两个低点
//    之间插值出数据里根本不存在的波峰。手绘感来自数据点的确定性抖动，曲线本身走手写体的
//    圆头圆角，不靠折线去模仿笔触。
import fs from "fs";
import { pathToFileURL } from "url";

type StarTheme = { bg: string; text: string; muted: string; grid: string; axis: string; total: string; daily: string };
type StarPoint = { date: string; total: number; daily: number };

const THEMES: Record<string, StarTheme> = {
  dark:  { bg: "#0b0e14", text: "#e6edf3", muted: "#9aa3b2", grid: "#232b3a", axis: "#cdd9e5", total: "#ff6b6b", daily: "#38bdf8" },
  light: { bg: "#fffdf7", text: "#24292f", muted: "#57606a", grid: "#e8ebf0", axis: "#24292f", total: "#d94f4f", daily: "#2f81f7" },
};

const FONT = '"Comic Sans MS","Comic Sans","Chalkboard SE","Marker Felt","Segoe Print",cursive';
// PAD_R 从 36 改成 64：右边距现在要放 Daily 右轴的刻度数字（"10" 这种两位数）和轴名，
// 再按 36 留白会把数字裁到画布外。
const W = 840, H = 480, PAD_L = 64, PAD_R = 64, PAD_T = 64, PAD_B = 58;

function fnv1a(str: string): number {
  let h: number = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a: number = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t: number = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function niceStep(rough: number): number {
  const pow: number = Math.pow(10, Math.floor(Math.log10(Math.max(1, rough))));
  for (const m of [1, 2, 5, 10]) if (m * pow >= rough) return m * pow;
  return 10 * pow;
}

// Catmull-Rom 转贝塞尔，让曲线圆滑接近手绘描线
function smoothPath(pts: number[][]): string {
  if (pts.length === 1) return `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  let d: string = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0: number[] = pts[Math.max(0, i - 1)], p1: number[] = pts[i], p2: number[] = pts[i + 1], p3: number[] = pts[Math.min(pts.length - 1, i + 2)];
    const c1: number[] = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: number[] = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

// 每日新增用单调三次插值（Fritsch–Carlson）连接：它的值是小整数、相邻两天跳得厉害，
// 需要一条圆滑、没有尖锐折角的手绘线；但普通的 Catmull-Rom 会在两个低点之间冲高，
// 插值出数据里根本不存在的波峰，这条线又挂在小量程的右轴上，假波峰会被放得更大。
// 单调三次插值过每个数据点、在拐点处切线连续，同时用切线限幅保证每段曲线都夹在该段
// 两端取值之间：平滑但不撒谎。首尾两端只用外侧那一段的斜率，避免端点处翘头。
export function monotonePath(pts: number[][]): string {
  const n: number = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;

  // h 是相邻点的横向距离，s 是各段斜率。x 轴按真实日期铺，抖动后仍严格递增，h 不会为 0。
  const h: number[] = [], s: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(pts[i + 1][0] - pts[i][0]);
    s.push(h[i] === 0 ? 0 : (pts[i + 1][1] - pts[i][1]) / h[i]);
  }
  // 每个点的切线初值：首尾取外侧段斜率，中间取左右两段斜率的平均。
  const m: number[] = new Array<number>(n);
  m[0] = s[0];
  m[n - 1] = s[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = (s[i - 1] + s[i]) / 2;
  // Fritsch–Carlson 限幅：切线方向与这一段走向相反时直接压平（否则曲线会先反着走再折回来，
  // 冲高或塌坑），切线太陡则按 3/sqrt(a²+b²) 收紧。a、b 都非负且 a²+b² ≤ 9 是这一段
  // 不过冲的充要条件。顺序处理时后一段只会把共享切线往小里改，前一段的约束仍然成立。
  for (let i = 0; i < n - 1; i++) {
    if (s[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    let a: number = m[i] / s[i], b: number = m[i + 1] / s[i];
    if (a < 0) { m[i] = 0; a = 0; }
    if (b < 0) { m[i + 1] = 0; b = 0; }
    const q: number = a * a + b * b;
    if (q > 9) { const t: number = 3 / Math.sqrt(q); m[i] = t * a * s[i]; m[i + 1] = t * b * s[i]; }
  }

  let d: string = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    // 三次 Hermite 段的两个控制点：横向各走三分之一，纵向带上切线。
    const c1x: number = pts[i][0] + h[i] / 3, c1y: number = pts[i][1] + (m[i] * h[i]) / 3;
    const c2x: number = pts[i + 1][0] - h[i] / 3, c2y: number = pts[i + 1][1] - (m[i + 1] * h[i]) / 3;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${pts[i + 1][0].toFixed(1)} ${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}

export function buildSvg(data: StarPoint[], themeName: string = "dark"): string {
  const t: StarTheme = THEMES[themeName] || THEMES.dark;
  const plotW: number = W - PAD_L - PAD_R, plotH: number = H - PAD_T - PAD_B;
  const rng: () => number = mulberry32(fnv1a(JSON.stringify(data) + themeName));
  const j = (amp: number): number => (rng() - 0.5) * 2 * amp;

  const totals: number[] = data.map((d) => d.total);
  const maxTotal: number = Math.max(1, ...totals);
  const yStep: number = niceStep(maxTotal / 4);
  const yMax: number = Math.max(yStep, Math.ceil((maxTotal * 1.06) / yStep) * yStep);

  // 右轴（Daily）自己的量程：刻度最多给 3 档，所以按“最大值的一半”来找步长，
  // 例如最大值 8 时步长取 5、量程到 10，既不会出现 8 这种不好读的刻度，也不会把线顶到框上。
  const dailies: number[] = data.map((d) => d.daily);
  const maxDaily: number = Math.max(1, ...dailies);
  const dStep: number = niceStep(maxDaily / 2);
  const dMax: number = Math.max(dStep, Math.ceil((maxDaily * 1.06) / dStep) * dStep);

  const times: number[] = data.map((d) => Date.parse(d.date + "T00:00:00Z"));
  const minX: number = Math.min(...times), maxX: number = Math.max(...times);
  const X = (i: number): number => (data.length === 1 ? PAD_L + plotW / 2 : PAD_L + ((times[i] - minX) / (maxX - minX)) * plotW);
  const Y = (v: number): number => PAD_T + plotH - (v / yMax) * plotH;
  // 右轴映射：和左轴共用同一条 0 基线（都从底部起），只是比例尺各自独立。
  const Yd = (v: number): number => PAD_T + plotH - (v / dMax) * plotH;

  const yTicks: number[] = [];
  for (let v = 0; v <= yMax; v += yStep) yTicks.push(v);
  const dTicks: number[] = [];
  for (let v = 0; v <= dMax; v += dStep) dTicks.push(v);
  const want: number = Math.min(5, data.length);
  const xTicks: Array<{ i: number; label: string }> = [...new Set(Array.from({ length: want }, (_, k) => Math.round((k * (data.length - 1)) / (want - 1 || 1))))]
    .map((i) => ({ i, label: data[i].date.slice(5).replace("-", "/") }));

  const totalPts: number[][] = data.map((d, i) => [X(i) + j(1.1), Y(d.total) + j(1.1)]);
  const dailyPts: number[][] = data.map((d, i) => [X(i) + j(1.1), Yd(d.daily) + j(1.1)]);

  const axisY: number = PAD_T + plotH;
  const sketchy = (x1: number, y1: number, x2: number, y2: number): string => {
    let d: string = `M ${x1} ${y1}`;
    const segs: number = 8;
    for (let s = 1; s <= segs; s++) {
      const f: number = s / segs;
      d += ` L ${(x1 + (x2 - x1) * f + j(1.2)).toFixed(1)} ${(y1 + (y2 - y1) * f + j(1.2)).toFixed(1)}`;
    }
    return d;
  };

  const gridLines: string = yTicks.slice(1).map((v) =>
    `<line x1="${PAD_L}" y1="${Y(v).toFixed(1)}" x2="${W - PAD_R}" y2="${Y(v).toFixed(1)}" stroke="${t.grid}" stroke-width="1" opacity="0.7"/>`).join("\n  ");
  const yLabels: string = yTicks.map((v) =>
    `<text x="${PAD_L - 10}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" font-size="13" fill="${t.muted}">${v}</text>`).join("\n  ");
  // 右轴刻度用 Daily 的颜色，和左轴的灰色刻度区分开：图例里的 Daily New 也是这个颜色，
  // 读者顺着颜色就知道这条虚线读右边的数字。
  const dLabels: string = dTicks.map((v) =>
    `<text x="${W - PAD_R + 10}" y="${(Yd(v) + 4).toFixed(1)}" text-anchor="start" font-size="13" fill="${t.daily}">${v}</text>`).join("\n  ");
  // 右轴的刻度位置不落在左轴的网格线上，只给数字会显得“浮空”；补一小段同色刻度线，
  // 让读者一眼看出这个数字读的是右边这条轴，而不是最近的横网格。
  const dAxisTicks: string = dTicks.map((v) =>
    `<path d="${sketchy(W - PAD_R - 6, Yd(v), W - PAD_R, Yd(v))}" stroke="${t.daily}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`).join("\n  ");
  const xLabels: string = xTicks.map((tk) =>
    `<text x="${X(tk.i).toFixed(1)}" y="${axisY + 24}" text-anchor="middle" font-size="13" fill="${t.muted}">${tk.label}</text>`).join("\n  ");

  const legend: string = `
  <rect x="${PAD_L + 14}" y="${PAD_T + 8}" width="152" height="52" rx="7" fill="${t.bg}" stroke="${t.text}" stroke-width="1.4" opacity="0.92"/>
  <line x1="${PAD_L + 26}" y1="${PAD_T + 24}" x2="${PAD_L + 52}" y2="${PAD_T + 24}" stroke="${t.total}" stroke-width="3" stroke-linecap="round"/>
  <text x="${PAD_L + 60}" y="${PAD_T + 28}" font-size="13">Total Stars</text>
  <line x1="${PAD_L + 26}" y1="${PAD_T + 44}" x2="${PAD_L + 52}" y2="${PAD_T + 44}" stroke="${t.daily}" stroke-width="2" stroke-dasharray="6 4" stroke-linecap="round"/>
  <text x="${PAD_L + 60}" y="${PAD_T + 48}" font-size="13">Daily New</text>`;

  const midY: number = (PAD_T + axisY) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <style>text{font-family:${FONT};fill:${t.text}}</style>
  <rect width="100%" height="100%" fill="${t.bg}"/>
  <text x="${W / 2}" y="34" text-anchor="middle" font-size="21">⭐ Star History</text>
  ${gridLines}
  <path d="${sketchy(PAD_L, axisY, W - PAD_R, axisY)}" stroke="${t.axis}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <path d="${sketchy(PAD_L, PAD_T, PAD_L, axisY)}" stroke="${t.axis}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <path d="${sketchy(W - PAD_R, PAD_T, W - PAD_R, axisY)}" stroke="${t.axis}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  ${dAxisTicks}
  ${yLabels}
  ${dLabels}
  ${xLabels}
  <text x="18" y="${midY}" font-size="12" fill="${t.muted}" transform="rotate(-90 18 ${midY})" text-anchor="middle">Stars</text>
  <text x="${W - 18}" y="${midY}" font-size="12" fill="${t.daily}" transform="rotate(90 ${W - 18} ${midY})" text-anchor="middle">New / day</text>
  <text x="${W / 2}" y="${H - 12}" font-size="12" fill="${t.muted}" text-anchor="middle">Date</text>
  <path d="${monotonePath(dailyPts)}" fill="none" stroke="${t.daily}" stroke-width="1.8" stroke-dasharray="6 4" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
  <path d="${smoothPath(totalPts)}" fill="none" stroke="${t.total}" stroke-width="3" stroke-linecap="round"/>
${legend}
  <text x="${W - PAD_R}" y="${axisY + 44}" text-anchor="end" font-size="12" fill="${t.muted}">${totals[totals.length - 1]} stars · ${data[data.length - 1].date}</text>
</svg>`;
}

function main(): void {
  const data: unknown = JSON.parse(fs.readFileSync("docs/star-history.json", "utf8"));
  if (!Array.isArray(data) || !data.length) { console.log("No data"); process.exit(0); }
  fs.writeFileSync("docs/star-history-dark.svg", buildSvg(data, "dark"));
  fs.writeFileSync("docs/star-history-light.svg", buildSvg(data, "light"));
  console.log(`Wrote docs/star-history-dark.svg + docs/star-history-light.svg (${data.length} days, ${data[data.length - 1].total} stars)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
