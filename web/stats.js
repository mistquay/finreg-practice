import {
  $,
  $$,
  esc,
  api,
  options,
  unique,
  query,
  pct,
  duration,
  num,
  handle,
  cascadeFacets,
} from "./ui.js";
import { icon } from "./icons.js";
import { sparkBars, sparkLine, trendChart, heatmap } from "./charts.js";

const PERIODS = [
  ["7", "近 7 天"],
  ["30", "近 30 天"],
  ["90", "近 90 天"],
  ["0", "全部时间"],
];
const GROUPS = [
  ["module", "按科目"],
  ["category", "按小类"],
  ["topic", "按考点"],
  ["tag", "按标签"],
];
const FILTER_KEYS = ["attempt", "mode", "module", "category", "topic", "tag"];

function delta(now, before, unit = "", { digits = 0, invert = false } = {}) {
  if (now == null || before == null) return "";
  const diff = Math.round((now - before) * 10 ** digits) / 10 ** digits;
  if (!diff) return '<span class="delta flat">持平</span>';
  const good = invert ? diff < 0 : diff > 0;
  return `<span class="delta ${good ? "up" : "down"}">${diff > 0 ? "↑" : "↓"} ${Math.abs(diff)}${unit}</span>`;
}

function kpis(d, label, days) {
  const s = d.summary,
    p = d.previous,
    t = d.trend;
  const cmp = `较前 ${days} 天`;
  return `<article class="card kpi"><div class="card-heading"><h2>作答题数</h2><span>${label}</span></div><div class="kpi-value"><b class="num">${num(s.count)}</b><small>题</small>${p ? delta(s.count, p.count) : ""}</div><p class="kpi-note">覆盖 ${num(s.unique)} 道题${p ? ` · ${cmp} ${num(p.count)}` : ""}</p>${sparkBars(t.map((x) => x.count), "var(--primary)", "每日作答题数")}</article>
    <article class="card kpi"><div class="card-heading"><h2>正确率</h2><span>不含申论</span></div><div class="kpi-value"><b class="num">${s.accuracy == null ? "—" : s.accuracy}</b><small>${s.accuracy == null ? "暂无判分" : "%"}</small>${p ? delta(s.accuracy, p.accuracy, "%", { digits: 1 }) : ""}</div><p class="kpi-note">对 ${num(s.correct)} · 错 ${num(s.wrong)}${p ? ` · ${cmp} ${pct(p.accuracy)}` : ""}</p>${sparkLine(t.map((x) => x.accuracy), "var(--violet)", "每日正确率")}</article>
    <article class="card kpi"><div class="card-heading"><h2>平均用时</h2><span>每题</span></div><div class="kpi-value"><b class="num">${duration(s.avg_ms)}</b>${p && p.count ? delta(Math.round(s.avg_ms / 1000), Math.round(p.avg_ms / 1000), " 秒", { invert: true }) : ""}</div><p class="kpi-note">按有效作答计时，暂停不计${p && p.count ? ` · ${cmp} ${duration(p.avg_ms)}` : ""}</p>${sparkBars(t.map((x) => Math.round(x.avg_ms / 1000)), "var(--violet)", "每日平均每题用时（秒）")}</article>
    <article class="card kpi"><div class="card-heading"><h2>累计用时</h2><span>${label}</span></div><div class="kpi-value"><b class="num">${duration(s.elapsed_ms)}</b></div><p class="kpi-note">${num(s.graded)} 次已判分${p ? ` · ${cmp} ${duration(p.elapsed_ms)}` : ""}</p>${sparkBars(t.map((x) => Math.round(x.elapsed_ms / 60000)), "var(--amber)", "每日有效用时（分钟）")}</article>`;
}

function split(s, trend) {
  const ungraded = s.count - s.graded;
  const active = trend.filter((x) => x.count).length;
  const best = trend.reduce((a, b) => (b.count > a.count ? b : a), { count: 0 });
  const facts = `<dl class="split-facts"><div><dt>练习天数</dt><dd class="num">${active}<small> / ${trend.length} 天</small></dd></div><div><dt>日均题数</dt><dd class="num">${active ? Math.round(s.count / active) : 0}<small> 题</small></dd></div><div><dt>最多一天</dt><dd class="num">${best.count}<small>${best.count ? ` 题 · ${best.date.slice(5)}` : " 题"}</small></dd></div></dl>`;
  const parts = [
    ["答对", s.correct, "var(--good)"],
    ["答错", s.wrong, "var(--bad)"],
    ["未判分", ungraded, "var(--line-strong)"],
  ];
  const total = Math.max(1, s.count);
  return `<div class="split-bar" role="img" aria-label="答对 ${s.correct}，答错 ${s.wrong}，未判分 ${ungraded}">${parts
    .filter(([, n]) => n)
    .map(([t, n, c]) => `<i style="width:${(n / total) * 100}%;background:${c}" title="${t} ${n}"></i>`)
    .join("")}</div><ul class="split-legend">${parts
    .map(
      ([t, n, c]) =>
        `<li><i style="background:${c}"></i><span>${t}</span><b class="num">${num(n)}</b><small class="num">${s.count ? Math.round((n / s.count) * 100) : 0}%</small></li>`,
    )
    .join("")}</ul>${facts}`;
}

function groupBars(groups) {
  const list = [...groups].sort((a, b) => b.count - a.count).slice(0, 8);
  if (!list.length) return '<p class="empty-line">当前筛选条件下还没有作答记录。</p>';
  return `<ul class="group-bars">${list
    .map((g) => {
      const tone = g.accuracy == null ? "muted" : g.accuracy >= 80 ? "good" : g.accuracy >= 60 ? "info" : "warn";
      return `<li><span class="group-name" title="${esc(g.name)}">${esc(g.name)}</span><span class="meter thin ${tone}"><i style="width:${g.accuracy ?? 0}%"></i></span><span class="pill ${tone}">${pct(g.accuracy)}</span><small class="num">${num(g.count)} 题</small></li>`;
    })
    .join("")}</ul>`;
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
  root.innerHTML = `<header class="page-heading"><div><h1>学习统计</h1><p>按北京时间归日；未交卷的考试不计入。</p></div>
    <div class="toolbar stats-controls"><div class="segmented" role="group" aria-label="时间范围">${PERIODS.map(
      ([v, t]) => `<button data-days="${v}" aria-pressed="${v === state.days}">${t}</button>`,
    ).join("")}</div>
    <details class="filter-pop" id="stats-filter-pop"><summary class="ghost">${icon("sliders")}<span>筛选</span><b class="filter-count" id="filter-count" hidden></b></summary>
      <div class="filter-panel" id="stats-filters"><label>作答口径<select name="attempt"><option value="">全部作答</option><option value="first">仅首次作答</option></select></label><label>练习方式<select name="mode"><option value="">全部方式</option><option value="practice">模块练习</option><option value="review">错题复习</option><option value="exam">整卷练习</option></select></label><label>科目<select name="module">${options(unique(meta.facets.map((f) => f.module)))}</select></label><label>小类<select name="category"></select></label><label>考点<select name="topic"></select></label><label>标签<select name="tag">${options(meta.tags)}</select></label><button class="quiet" id="clear-stats-filters">清除筛选</button></div>
    </details></div></header>
    <div id="stats-content" class="stats-content" aria-live="polite"></div>
    <p class="caption">正确率 = 答对次数 / 已判分次数；首次作答指该题第一次提交；按标签分组时，一题多标签会重复计数。</p>`;
  const facets = () => cascadeFacets(root, meta.facets, state);

  function table() {
    const groups = [...current.groups].sort((a, b) => {
      const x = a[sort] ?? -1,
        y = b[sort] ?? -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * (desc ? -1 : 1);
    });
    $("#group-table", root).innerHTML = `<table><thead><tr><th scope="col">分类</th>${[
      ["accuracy", "正确率"],
      ["avg_ms", "平均用时"],
      ["count", "作答题数"],
      ["last", "最近作答"],
    ]
      .map(
        ([k, t]) =>
          `<th scope="col" aria-sort="${sort === k ? (desc ? "descending" : "ascending") : "none"}"><button data-sort="${k}">${t} ${sort === k ? (desc ? "↓" : "↑") : "↕"}</button></th>`,
      )
      .join(
        "",
      )}</tr></thead><tbody>${groups.map((g) => `<tr><th scope="row">${esc(g.name)}</th><td class="teal">${pct(g.accuracy)}</td><td class="num">${duration(g.avg_ms)}</td><td class="num">${num(g.count)}</td><td class="num">${g.last.slice(0, 16).replace("T", " ")}</td></tr>`).join("") || '<tr><td colspan="5" class="empty-line">当前筛选条件下还没有作答记录。</td></tr>'}</tbody></table>`;
    $$("[data-sort]", root).forEach(
      (b) =>
        (b.onclick = () => {
          desc = sort === b.dataset.sort ? !desc : true;
          sort = b.dataset.sort;
          table();
        }),
    );
  }

  function paintControls() {
    $$("[data-days]", root).forEach((b) => b.setAttribute("aria-pressed", b.dataset.days === state.days));
    const active = FILTER_KEYS.filter((k) => state[k]).length;
    $("#filter-count", root).hidden = !active;
    $("#filter-count", root).textContent = active;
  }

  async function load() {
    const n = ++seq;
    paintControls();
    const d = await api("/api/stats?" + query({ ...state, compare: "1", heatmap: "1" }));
    if (n !== seq || !root.isConnected) return;
    current = d;
    const label = PERIODS.find(([v]) => v === state.days)[1];
    const hasData = d.trend.some((x) => x.count);
    $("#stats-content", root).innerHTML = `<section class="stats-kpis" aria-label="${label}概览"><h2 class="visually-hidden" id="stats-period">${label}</h2>${kpis(d, label, state.days)}</section>
      <div class="stats-grid">
        <section class="card stats-trend"><div class="card-heading"><h2>作答趋势</h2><div class="legend"><span><i style="background:var(--primary)"></i>作答题数</span><span><i style="background:var(--amber)"></i>正确率</span></div></div>${
          hasData
            ? trendChart(d.trend)
            : '<div class="empty"><h3>这段时间还没有作答</h3><p>完成练习后，这里会显示每日作答题数与正确率。</p><a class="primary" href="#home">去学习中心</a></div>'
        }</section>
        <section class="card stats-split"><div class="card-heading"><h2>作答结果</h2><span>${label}</span></div>${split(d.summary, d.trend)}</section>
        <section class="card stats-heat"><div class="card-heading"><h2>学习日历</h2><span>近 26 周 · 颜色越深题数越多</span></div>${heatmap(d.heatmap)}</section>
        <section class="card stats-groups"><div class="card-heading wrap"><h2>分类表现</h2><div class="segmented" role="group" aria-label="分组方式">${GROUPS.map(
          ([v, t]) => `<button data-group="${v}" aria-pressed="${state.group === v}">${t}</button>`,
        ).join("")}</div></div>${groupBars(d.groups)}</section>
        <section class="card paper stats-table"><div class="card-heading"><h2>明细</h2><span>点表头排序</span></div><div id="group-table" class="table-scroll"></div></section>
      </div>`;
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
  $$("[data-days]", root).forEach(
    (b) =>
      (b.onclick = handle(async () => {
        state.days = b.dataset.days;
        await load();
      })),
  );
  $$("#stats-filters select", root).forEach(
    (s) =>
      (s.onchange = handle(async () => {
        state[s.name] = s.value;
        if (s.name === "module") state.category = state.topic = "";
        if (s.name === "category") state.topic = "";
        facets();
        await load();
      })),
  );
  $("#clear-stats-filters", root).onclick = handle(async () => {
    FILTER_KEYS.forEach((k) => (state[k] = ""));
    $$("#stats-filters select", root).forEach((s) => (s.value = ""));
    facets();
    await load();
  });
  // Close the filter panel when clicking elsewhere.
  const pop = $("#stats-filter-pop", root);
  const outside = (e) => {
    if (!root.isConnected) return document.removeEventListener("click", outside);
    if (pop.open && !pop.contains(e.target)) pop.open = false;
  };
  document.addEventListener("click", outside);
  await load();
}
