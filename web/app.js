import {
  $,
  esc,
  api,
  heading,
  startPractice,
  handle,
  duration,
  pct,
} from "./ui.js";
import { renderStats } from "./stats.js";
import { renderLibrary } from "./library.js";
import { renderPractice, leavePractice } from "./practice.js";
import { renderData } from "./data.js";
let routeToken = 0;
async function home(root, meta) {
  const stats = await api("/api/stats?days=7");
  const c = meta.counts;
  const modules = {};
  meta.facets.forEach((x) => {
    modules[x.module] = (modules[x.module] || 0) + x.ready;
  });
  root.innerHTML =
    heading(
      "A LITTLE PROGRESS, EVERY DAY",
      "把知识，练成把握。",
      "从专业课真题出发，让每一次练习都有反馈。",
      `<a class="button primary" href="#library">开始今日练习 <span>↗</span></a>`,
    ) +
    `<section class="hero-grid"><div class="study-hero"><span class="pill">你的学习进度</span><div class="hero-number">${c.seen}<span> / ${c.ready} 道</span></div><div class="progress"><i style="width:${c.ready ? Math.min((c.seen / c.ready) * 100, 100) : 0}%"></i></div><p>已练过的题目 / 当前可练习题目</p><div class="hero-bottom"><div><strong>${stats.summary.count}</strong><span>近7天作答</span></div><div><strong>${pct(stats.summary.accuracy)}</strong><span>近7天正确率</span></div><div><strong>${c.wrong}</strong><span>待复习错题</span></div></div></div><div class="card focus-card"><div class="eyebrow">FOCUS ON WHAT MATTERS</div><h2>先练，再看懂，<br>最后记住。</h2><p>专业科目占笔试合成成绩的50%。保持专业课训练，同时积累行测的速度与准确率。</p><a href="#review" class="text-link">打开错题本 →</a><span class="decorative-grid" aria-hidden="true"></span></div></section>
<div class="section-title"><h2>按模块开始</h2><span>默认跳过待核验题目</span></div><section class="module-grid">${Object.entries(
      modules,
    )
      .sort(
        ([a], [b]) =>
          ["计算机专业", "经济金融基础", "英语", "行测", "申论"].indexOf(a) -
          ["计算机专业", "经济金融基础", "英语", "行测", "申论"].indexOf(b),
      )
      .map(
        ([m, n], i) =>
          `<button class="card module-card" data-module="${esc(m)}"><span class="module-index">0${i + 1}</span><h3>${esc(m)}</h3><p>${n} 道可练习题</p><span class="arrow">↗</span></button>`,
      )
      .join("")}</section>
<div class="section-title"><h2>近期真题</h2><a href="#library" class="text-link">筛选全部试卷与题目 →</a></div><section class="paper-grid">${meta.papers.filter(p => !["国考模拟题","申论小模考"].includes(p.kind)).slice(0,12).map((p) => `<article class="card paper-card"><div class="paper-year">${p.year || "导入"}</div><div><h3>${esc(p.title)}</h3><p>${p.total} 道原题 · ${p.ready} 道可练习 · 建议 ${p.duration_minutes} 分钟</p>${p.total > p.ready ? `<small class="warning-text">${p.total - p.ready} 道待核验，组卷时跳过</small>` : ""}</div><button class="secondary" data-paper="${esc(p.id)}">整卷练习</button></article>`).join("")}</section>
${meta.sessions.length ? `<div class="section-title"><h2>最近练习</h2></div><div class="card session-list">${meta.sessions.map((s) => `<a href="#practice/${s.id}"><div><strong>${esc(s.title)}</strong><small>${s.created_at.slice(0, 16).replace("T", " ")} · ${s.total} 道题</small></div><span>${s.status === "completed" ? "查看复盘" : "继续练习"} →</span></a>`).join("")}</div>` : ""}`;
  root
    .querySelectorAll("[data-module]")
    .forEach(
      (b) =>
        (b.onclick = handle(() =>
          startPractice({
            filters: { module: b.dataset.module },
            count: 20,
            title: `${b.dataset.module} · 20题`,
          }),
        )),
    );
  root
    .querySelectorAll("[data-paper]")
    .forEach(
      (b) =>
        (b.onclick = handle(() =>
          startPractice({
            filters: { paper_id: b.dataset.paper },
            mode: "exam",
            shuffle: false,
            title: meta.papers.find((p) => p.id === b.dataset.paper).title,
          }),
        )),
    );
}
async function route() {
  const token = ++routeToken;
  leavePractice();
  const [path, search = ""] = location.hash.slice(1).split("?");
  const [view = "home", id] = path.split("/");
  document
    .querySelectorAll("nav a")
    .forEach((a) => a.classList.toggle("active", a.dataset.route === view));
  const root = $("#app");
  root.innerHTML = '<div class="empty loading">正在载入学习档案…</div>';
  try {
    const meta = await api("/api/meta");
    if (token !== routeToken) return;
    const params = Object.fromEntries(new URLSearchParams(search));
    if (view === "stats") await renderStats(root, meta);
    else if (view === "library" || view === "review")
      await renderLibrary(root, meta, view, params);
    else if (view === "practice") await renderPractice(root, id);
    else if (view === "data") await renderData(root, meta);
    else await home(root, meta);
  } catch (e) {
    root.innerHTML = `<div class="card empty"><h2>暂时无法载入</h2><p>${esc(e.message)}</p><button onclick="location.reload()">重试</button></div>`;
    console.error(e);
  }
  window.scrollTo(0, 0);
}
$("#today").textContent = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "long",
  day: "numeric",
}).format(new Date());
window.addEventListener("hashchange", route);
route();
