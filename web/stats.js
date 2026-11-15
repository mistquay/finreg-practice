import {
  $,
  $$,
  esc,
  api,
  options,
  unique,
  heading,
  query,
  metric,
  pct,
  duration,
  handle,
  cascadeFacets,
} from "./ui.js";
function chart(data) {
  if (!data.some((d) => d.count))
    return '<div class="empty chart-empty"><h3>还没有作答趋势</h3><p>完成练习后，在这里查看每日作答量与正确率。</p><a class="button primary" href="#library">选择题目开始练习</a></div>';
  const w = Math.max(760, data.length * 40),
    h = 260,
    left = 45,
    right = 50,
    bottom = 32,
    top = 26,
    ih = h - top - bottom,
    iw = w - left - right,
    max = Math.max(
      4,
      Math.ceil(Math.max(...data.map((d) => d.count), 1) / 4) * 4,
    ),
    step = iw / data.length;
  let svg = "";
  for (let i = 0; i <= 4; i++) {
    const y = top + (ih * i) / 4;
    svg += `<line x1="${left}" y1="${y}" x2="${w - right}" y2="${y}" class="gridline"/><text x="${left - 10}" y="${y + 4}" text-anchor="end">${Math.round(max * (1 - i / 4))}</text><text x="${w - right + 8}" y="${y + 4}">${100 - i * 25}%</text>`;
  }
  let segment = [];
  const paths = [];
  data.forEach((d, i) => {
    const x = left + step * (i + 0.5),
      bh = (d.count / max) * ih,
      y = top + ih - bh;
    svg += `<g><title>${d.date}：${d.count} 次，正确率 ${pct(d.accuracy)}</title><rect x="${x - step * 0.25}" y="${y}" width="${step * 0.5}" height="${bh}" rx="4" class="bar"/>${d.count ? `<text x="${x}" y="${y - 7}" text-anchor="middle" class="bar-label">${d.count}</text>` : ""}</g>`;
    if (d.accuracy != null) {
      segment.push(`${x},${top + ih * (1 - d.accuracy / 100)}`);
    } else if (segment.length) {
      paths.push(segment);
      segment = [];
    }
    if (data.length <= 31 || i % Math.ceil(data.length / 20) === 0)
      svg += `<text x="${x}" y="${h - 8}" text-anchor="middle">${d.date.slice(5)}</text>`;
  });
  if (segment.length) paths.push(segment);
  paths.forEach(
    (p) => (svg += `<polyline points="${p.join(" ")}" class="trend-line"/>`),
  );
  data.forEach((d, i) => {
    if (d.accuracy != null)
      svg += `<circle cx="${left + step * (i + 0.5)}" cy="${top + ih * (1 - d.accuracy / 100)}" r="4" class="trend-dot"><title>${d.date} 正确率 ${d.accuracy}%</title></circle>`;
  });
  return `<div class="chart-scroll"><svg preserveAspectRatio="none" viewBox="0 0 ${w} ${h}" style="min-width:${w}px" role="img" aria-label="每日作答次数柱状图与正确率折线图">${svg}</svg></div>`;
}
export async function renderStats(root, meta) {
  const state = {
    days: "7",
    attempt: "",
    mode: "",
    module: "",
    category: "",
    topic: "",
    tag: "",
    group: "module",
  };
  let current,
    sort = "count",
    desc = true,
    seq = 0;
  root.innerHTML =
    heading(
      "学习统计",
      "按时间与科目查看作答表现，找到下一步的练习重点。",
    ) +
    `<section class="card filter-bar" id="stats-filters"><label>时间周期<select name="days"><option value="7">近7天</option><option value="30">近30天</option><option value="90">近90天</option><option value="0">全部时间</option></select></label><label>作答口径<select name="attempt"><option value="">全部作答</option><option value="first">仅首次作答</option></select></label><label>练习方式<select name="mode"><option value="">全部方式</option><option value="practice">模块练习</option><option value="review">错题复习</option><option value="exam">整卷练习</option></select></label><label>模块<select name="module">${options(unique(meta.facets.map((f) => f.module)))}</select></label><label>小类<select name="category"></select></label><label>考点<select name="topic"></select></label><label>标签<select name="tag">${options(meta.tags)}</select></label></section><div id="stats-content"></div><p class="caption">统计按北京时间归日；正确率 = 答对次数 / 已判分次数。首次作答指该题在本地的第一次提交；多标签分组之间可能重复计数。</p>`;
  const facets = () => cascadeFacets(root, meta.facets, state);
  function table() {
    const groups = [...current.groups].sort((a, b) => {
      const x = a[sort] ?? -1,
        y = b[sort] ?? -1;
      return (
        (typeof x === "string" ? x.localeCompare(y) : x - y) * (desc ? -1 : 1)
      );
    });
    $("#group-table", root).innerHTML = `<table><thead><tr><th>分类</th>${[
      ["accuracy", "正确率"],
      ["avg_ms", "平均用时"],
      ["count", "答题次数"],
      ["last", "最近作答"],
    ]
      .map(
        ([k, t]) =>
          `<th aria-sort="${sort === k ? (desc ? "descending" : "ascending") : "none"}"><button data-sort="${k}">${t} ${sort === k ? (desc ? "↓" : "↑") : "↕"}</button></th>`,
      )
      .join(
        "",
      )}</tr></thead><tbody>${groups.map((g) => `<tr><th>${esc(g.name)}</th><td class="teal">${pct(g.accuracy)}</td><td>${duration(g.avg_ms)}</td><td>${g.count}</td><td>${g.last.slice(0, 16).replace("T", " ")}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">当前筛选条件下还没有作答记录。</td></tr>'}</tbody></table>`;
    $$("[data-sort]", root).forEach(
      (b) =>
        (b.onclick = () => {
          desc = sort === b.dataset.sort ? !desc : true;
          sort = b.dataset.sort;
          table();
        }),
    );
  }
  async function load() {
    const n = ++seq;
    const d = await api("/api/stats?" + query(state));
    if (n !== seq) return;
    current = d;
    $("#stats-content", root).innerHTML =
      `<section class="stats-pair"><article class="card"><h2>${state.days === "0" ? "全部时间" : `近${state.days}天`}</h2>${metric(d.summary)}</article><article class="card"><h2>今日<span class="caption"> · 沿用当前筛选</span></h2>${metric(d.today)}</article></section><section class="card chart-card"><div class="card-heading"><h2>作答趋势</h2><div class="legend"><span><i class="blue-key"></i>刷题次数</span><span><i class="green-key"></i>正确率</span></div></div>${chart(d.trend)}</section><section class="card"><div class="card-heading wrap"><h2>分类表现</h2><div class="segmented">${[
        ["module", "按模块"],
        ["category", "按小类"],
        ["topic", "按考点"],
        ["tag", "按标签"],
      ]
        .map(
          ([v, t]) =>
            `<button data-group="${v}" aria-pressed="${state.group === v}" class="${state.group === v ? "selected" : ""}">${t}</button>`,
        )
        .join(
          "",
        )}</div></div><div id="group-table" class="table-scroll"></div></section>`;
    table();
    $$("[data-group]", root).forEach(
      (b) =>
        (b.onclick = handle(async () => {
          state.group = b.dataset.group;
          await load();
        })),
    );
  }
  facets();
  $$("#stats-filters select", root).forEach(
    (s) =>
      (s.onchange = handle(async () => {
        state[s.name] = s.value;
        if (s.name === "module") {
          state.category = "";
          state.topic = "";
        }
        if (s.name === "category") state.topic = "";
        facets();
        await load();
      })),
  );
  await load();
}
