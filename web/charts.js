// Small inline-SVG charts. Colors come from CSS variables so both themes work without redraw.
import { esc, pct } from "./ui.js";

const f = (n) => Number(n.toFixed(1));

// Micro bars for a KPI card: zero days show as a short track stub, the last bar is emphasized.
export function sparkBars(values, color = "var(--primary)", label = "") {
  const W = 140,
    H = 44,
    n = values.length,
    max = Math.max(...values, 1),
    step = W / n,
    bw = Math.max(2, step * 0.56);
  const bars = values
    .map((v, i) => {
      const h = v ? Math.max(3, (v / max) * (H - 2)) : 2;
      const x = i * step + (step - bw) / 2;
      const style = v
        ? `fill:${color};fill-opacity:${i === n - 1 ? 1 : 0.42}`
        : "fill:var(--track)";
      return `<rect x="${f(x)}" y="${f(H - h)}" width="${f(bw)}" height="${f(h)}" rx="1.5" style="${style}"/>`;
    })
    .join("");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${bars}</svg>`;
}

// Micro line with a soft area; days without data break the line instead of dropping to zero.
export function sparkLine(values, color = "var(--violet)", label = "") {
  const W = 140,
    H = 44,
    n = values.length,
    known = values.filter((v) => v != null);
  if (!known.length)
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}"><line x1="0" x2="${W}" y1="${H - 1}" y2="${H - 1}" style="stroke:var(--track);stroke-width:2"/></svg>`;
  const lo = Math.max(0, Math.min(...known) - 5),
    hi = Math.min(100, Math.max(...known) + 5),
    span = hi - lo || 1;
  const pts = values.map((v, i) =>
    v == null ? null : [3 + (i * (W - 6)) / Math.max(1, n - 1), 4 + (1 - (v - lo) / span) * (H - 8)],
  );
  const segments = [];
  let cur = [];
  pts.forEach((p) => {
    if (p) cur.push(p);
    else if (cur.length) segments.push(cur), (cur = []);
  });
  if (cur.length) segments.push(cur);
  const path = (seg) => seg.map((p, i) => `${i ? "L" : "M"}${f(p[0])} ${f(p[1])}`).join(" ");
  const areas = segments
    .filter((s) => s.length > 1)
    .map(
      (s) =>
        `<path d="${path(s)} L${f(s[s.length - 1][0])} ${H} L${f(s[0][0])} ${H}Z" style="fill:${color};fill-opacity:.12"/>`,
    )
    .join("");
  const lines = segments
    .map((s) =>
      s.length > 1
        ? `<path d="${path(s)}" vector-effect="non-scaling-stroke" style="fill:none;stroke:${color};stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round"/>`
        : "",
    )
    .join("");
  const last = [...pts].reverse().find(Boolean);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${areas}${lines}<circle cx="${f(last[0])}" cy="${f(last[1])}" r="3" style="fill:${color}"/></svg>`;
}

// Half-ring split into equal arcs, one per subject; each arc fills to that subject's accuracy.
export function gauge(parts, centerValue, centerLabel) {
  const cx = 100,
    cy = 98,
    r = 78,
    gapDeg = parts.length > 1 ? 5 : 0,
    each = (180 - gapDeg * (parts.length - 1)) / Math.max(1, parts.length);
  const at = (deg) => {
    const t = Math.PI * (1 - deg / 180);
    return [cx + r * Math.cos(t), cy - r * Math.sin(t)];
  };
  const arc = (a0, a1, style) => {
    const [x0, y0] = at(a0),
      [x1, y1] = at(a1);
    return `<path d="M${f(x0)} ${f(y0)} A${r} ${r} 0 0 1 ${f(x1)} ${f(y1)}" style="fill:none;stroke-width:13;stroke-linecap:round;${style}"/>`;
  };
  let svg = "";
  parts.forEach((p, i) => {
    const a0 = i * (each + gapDeg),
      a1 = a0 + each;
    svg += arc(a0, a1, "stroke:var(--track)");
    if (p.value > 0) svg += arc(a0, a0 + Math.max(2, each * Math.min(1, p.value)), `stroke:${p.color}`);
  });
  return `<svg class="gauge" viewBox="0 0 200 112" role="img" aria-label="${esc(centerLabel)} ${esc(centerValue)}">${svg}<text x="100" y="74" text-anchor="middle" style="fill:var(--ink-3);font-size:11px">${esc(centerLabel)}</text><text x="100" y="101" text-anchor="middle" style="fill:var(--ink);font-size:26px;font-family:var(--font-num)">${esc(centerValue)}</text></svg>`;
}

// Daily answers as bars with the accuracy line on a second 0–100% axis.
export function trendChart(data) {
  const w = Math.max(940, data.length * 34),
    h = 260,
    left = 40,
    right = 46,
    top = 22,
    bottom = 30,
    ih = h - top - bottom,
    iw = w - left - right,
    max = Math.max(4, Math.ceil(Math.max(...data.map((d) => d.count), 1) / 4) * 4),
    step = iw / data.length,
    bw = Math.min(22, step * 0.52);
  let svg = "";
  for (let i = 0; i <= 4; i++) {
    const y = top + (ih * i) / 4;
    svg += `<line class="grid" x1="${left}" x2="${w - right}" y1="${y}" y2="${y}"/><text x="${left - 8}" y="${y + 4}" text-anchor="end">${Math.round(max * (1 - i / 4))}</text><text x="${w - right + 8}" y="${y + 4}">${100 - i * 25}%</text>`;
  }
  const every = data.length <= 31 ? 1 : Math.ceil(data.length / 20);
  const x = (i) => left + step * (i + 0.5);
  data.forEach((d, i) => {
    const bh = (d.count / max) * ih,
      y = top + ih - bh;
    svg += `<g><title>${d.date}：${d.count} 题，正确率 ${pct(d.accuracy)}</title><rect x="${f(x(i) - bw / 2)}" y="${f(y)}" width="${f(bw)}" height="${f(Math.max(bh, 0))}" rx="4" style="fill:var(--primary);fill-opacity:${d.count ? 0.85 : 0}"/></g>`;
    if (i % every === 0)
      svg += `<text x="${f(x(i))}" y="${h - 8}" text-anchor="middle">${d.date.slice(5)}</text>`;
  });
  let seg = [];
  const segs = [];
  data.forEach((d, i) => {
    if (d.accuracy != null) seg.push(`${f(x(i))},${f(top + ih * (1 - d.accuracy / 100))}`);
    else if (seg.length) segs.push(seg), (seg = []);
  });
  if (seg.length) segs.push(seg);
  segs.forEach(
    (s) =>
      (svg += `<polyline points="${s.join(" ")}" style="fill:none;stroke:var(--amber);stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round"/>`),
  );
  data.forEach((d, i) => {
    if (d.accuracy != null)
      svg += `<circle cx="${f(x(i))}" cy="${f(top + ih * (1 - d.accuracy / 100))}" r="3.5" style="fill:var(--paper);stroke:var(--amber);stroke-width:2"><title>${d.date} 正确率 ${d.accuracy}%</title></circle>`;
  });
  return `<div class="chart-scroll"><svg class="chart" viewBox="0 0 ${w} ${h}" style="min-width:${w}px" role="img" aria-label="每日作答题数柱状图与正确率折线图">${svg}</svg></div>`;
}

// 26-week calendar heatmap, Monday rows on top; color steps by quartile of the busiest day.
export function heatmap(days) {
  const cell = 13,
    gap = 3,
    weeks = Math.ceil(days.length / 7),
    max = Math.max(...days.map((d) => d.count), 1),
    left = 22,
    top = 18;
  const level = (n) => (n ? Math.min(4, Math.ceil((n / max) * 4)) : 0);
  const fills = [
    "fill:var(--track)",
    "fill:var(--primary);fill-opacity:.28",
    "fill:var(--primary);fill-opacity:.5",
    "fill:var(--primary);fill-opacity:.74",
    "fill:var(--primary)",
  ];
  let svg = "";
  ["一", "三", "五"].forEach((t, i) => {
    svg += `<text x="0" y="${top + (i * 2) * (cell + gap) + 10}">${t}</text>`;
  });
  let lastMonth = "";
  days.forEach((d, i) => {
    const wk = Math.floor(i / 7),
      dow = i % 7,
      xx = left + wk * (cell + gap),
      yy = top + dow * (cell + gap);
    const month = d.date.slice(5, 7);
    if (dow === 0 && month !== lastMonth) {
      svg += `<text x="${xx}" y="11">${Number(month)}月</text>`;
      lastMonth = month;
    }
    svg += `<rect x="${xx}" y="${yy}" width="${cell}" height="${cell}" rx="3" style="${fills[level(d.count)]}"><title>${d.date}：${d.count} 题</title></rect>`;
  });
  const w = left + weeks * (cell + gap),
    h = top + 7 * (cell + gap);
  return `<div class="chart-scroll"><svg class="chart heatmap" viewBox="0 0 ${w} ${h}" style="min-width:${w}px;max-width:${w * 1.6}px" role="img" aria-label="近 26 周每日作答热力图">${svg}</svg></div>`;
}
