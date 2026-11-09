import {
  $,
  $$,
  esc,
  api,
  heading,
  startPractice,
  handle,
  duration,
  pct,
  query,
  paperSubject as getPaperSubject,
} from "./ui.js";
import { icon } from "./icons.js";
const subjects = ["计算机专业", "经济金融基础", "英语", "行测", "申论"];
const subjectIcons = {
  计算机专业: "monitor",
  经济金融基础: "chart",
  英语: "globe",
  行测: "book",
  申论: "pen",
};
const descriptions = {
  计算机专业: "沿着知识点，打牢专业基础",
  经济金融基础: "理解概念，也掌握应用",
  英语: "在真题中积累阅读经验",
  行测: "练习解题方法与作答速度",
  申论: "阅读材料，组织有依据的表达",
};
export async function renderHome(root, meta) {
  const stats = await api("/api/stats?days=7");
  const c = meta.counts;
  const modules = {};
  meta.facets.forEach((x) => {
    modules[x.module] = (modules[x.module] || 0) + x.ready;
  });
  const available = Object.keys(modules).sort(
    (a, b) => subjects.indexOf(a) - subjects.indexOf(b),
  );
  let chosen = available[0] || "";
  let paperSubject = "计算机专业";
  const resume = meta.sessions.find((s) => s.status === "active");
  const num = (n) => Number(n || 0).toLocaleString("zh-CN");
  root.innerHTML =
    heading(
      "",
      "今天，从一道题开始。",
      "专注练习，认真复盘。把每一步积累留在这里。",
      `<a class="button secondary" href="#stats">${icon("chart")}查看学习统计</a>`,
    ) +
    `
    <div class="home-columns">
      <div class="home-main">
        <section class="continue-panel" aria-labelledby="continue-title"><div class="continue-copy"><span class="status-label">${icon(resume ? "bookmark" : "book")}${resume ? "上次的练习，还可以继续" : "为今天留一点学习时间"}</span><h2 id="continue-title">${esc(resume?.title || "选一个专项，开始进入状态。")}</h2><p>${resume ? `上次停在第 ${resume.position + 1} 题 · 共 ${resume.total} 道题，草稿已保留` : "专业课、行测与申论，按你的节奏练习。"}</p><a class="button primary" href="${resume ? `#practice/${resume.id}` : "#library"}">${resume ? "继续上次练习" : "浏览题库"}${icon("arrow")}</a></div><div class="continue-note" aria-hidden="true"><span>知 序</span><div class="book-lines"><i></i><i></i><i></i><i></i></div><small>日有所学</small></div></section>
        <section class="practice-builder" aria-labelledby="module-title"><div class="section-title"><h2 id="module-title">专项练习</h2><span>选择科目，立即开始</span></div><div class="subject-list">${available.map((m) => `<button class="subject-row ${m === chosen ? "selected" : ""}" data-module="${esc(m)}" aria-pressed="${m === chosen}"><span class="subject-symbol">${icon(subjectIcons[m])}</span><span class="subject-copy"><strong>${esc(m)}</strong><small>${esc(descriptions[m] || "按模块练习，逐步积累")}</small></span><span class="subject-count">${num(modules[m])}<small>道题</small></span><span class="subject-select">${icon("check")}</span></button>`).join("") || '<div class="empty"><h3>先为学习空间添加题目</h3><a class="button primary" href="#data">导入题库</a></div>'}</div>${available.length ? `<div class="builder-actions"><label class="inline-field">模式<select id="quick-mode"><option value="practice">练习模式</option><option value="exam">考试模式</option></select></label><label class="inline-field">每组题量<select id="quick-count"><option>10</option><option selected>20</option><option>30</option><option>50</option></select></label><label class="check-field"><input id="quick-unseen" type="checkbox">只练未做题</label><button class="primary" id="quick-start">开始练习 ${icon("arrow")}</button></div><p class="builder-hint" id="builder-hint">${esc(chosen)} · 随机组题，自动跳过待核验题目</p>` : ""}</section>
        <section aria-labelledby="papers-title"><div class="section-title"><h2 id="papers-title">真题练习</h2><a class="text-link" href="#library">全部题库 ${icon("arrow")}</a></div><div class="paper-tabs segmented" role="group" aria-label="真题科目">${[
          ["计算机专业", "专业科目"],
          ["行测", "行测"],
          ["申论", "申论"],
        ]
          .map(
            ([v, t]) =>
              `<button data-paper-subject="${v}" class="${v === paperSubject ? "selected" : ""}" aria-pressed="${v === paperSubject}">${t}</button>`,
          )
          .join(
            "",
          )}</div><div class="paper-list" id="home-papers"></div></section>
      </div>
      <aside class="home-aside"><section class="today-panel"><div class="section-title"><h2>今日学习</h2><span>北京时间</span></div><div class="today-count"><strong>${num(stats.today.count)}</strong><span>次作答</span></div><dl class="today-details"><div><dt>正确率</dt><dd>${pct(stats.today.accuracy)}</dd></div><div><dt>有效用时</dt><dd>${duration(stats.today.elapsed_ms)}</dd></div><div><dt>近 7 天作答</dt><dd>${num(stats.summary.count)} 次</dd></div></dl><div class="coverage"><span>题目覆盖</span><strong>${num(c.seen)} <small>/ ${num(c.total)}</small></strong><progress max="${c.total || 1}" value="${c.seen || 0}" aria-label="已作答题目覆盖"></progress><small>按卷内题次统计，同一源题可能出现在多套试卷。</small></div></section>
        <section class="review-links" aria-label="复习入口"><a href="#review">${icon("bookmark")}<span><strong>错题复习</strong><small>${c.wrong ? "再练一次，找出薄弱处" : "练习中的错题会收录在这里"}</small></span><b>${num(c.wrong)}</b>${icon("arrow")}</a><a href="#review?scope=favorite">${icon("book")}<span><strong>我的收藏</strong><small>留住值得反复看的题</small></span><b>${num(c.favorites)}</b>${icon("arrow")}</a></section>
        <section class="recent-panel"><div class="section-title"><h2>最近练习</h2></div>${
          meta.sessions.length
            ? `<div class="session-list">${meta.sessions
                .slice(0, 4)
                .map(
                  (s) =>
                    `<a href="#practice/${s.id}"><span class="session-status ${s.status === "completed" ? "done" : ""}">${icon(s.status === "completed" ? "check" : "clock")}</span><div><strong>${esc(s.title)}</strong><small>${s.created_at.slice(5, 16).replace("T", " ")} · ${s.total} 题</small><span>${s.status === "completed" ? "查看复盘" : "继续练习"}</span></div>${icon("arrow")}</a>`,
                )
                .join("")}</div>`
            : '<p class="recent-empty">还没有练习记录。<br>完成第一组练习后，随时回来继续。</p>'
        }</section>
      </aside>
    </div>`;
  $$("[data-module]", root).forEach(
    (b) =>
      (b.onclick = () => {
        chosen = b.dataset.module;
        $$("[data-module]", root).forEach((x) => {
          x.classList.toggle("selected", x === b);
          x.setAttribute("aria-pressed", x === b);
        });
        $("#builder-hint", root).textContent =
          `${chosen} · 随机组题，自动跳过待核验题目`;
      }),
  );
  const start = $("#quick-start", root);
  if (start)
    start.onclick = handle(async () => {
      start.disabled = true;
      try {
        await startPractice({
          filters: {
            module: chosen,
            ...($("#quick-unseen", root).checked ? { unseen: "1" } : {}),
          },
          mode: $("#quick-mode", root).value,
          count: Number($("#quick-count", root).value),
          title: `${chosen} · 专项练习`,
        });
      } finally {
        start.disabled = false;
      }
    });
  function papers() {
    const list = meta.papers
      .filter((p) => {
        const subject = getPaperSubject(p);
        return (
          !["国考模拟题", "申论小模考"].includes(p.kind) &&
          (paperSubject === "计算机专业"
            ? !["行测", "申论"].includes(subject)
            : subject === paperSubject)
        );
      })
      .slice(0, 5);
    $("#home-papers", root).innerHTML =
      list
        .map(
          (p) =>
            `<article class="paper-row"><div class="paper-year">${p.year || "—"}</div><div class="paper-copy"><h3>${esc(p.title)}</h3><p>${num(p.ready)} 道可练习 · 建议 ${p.duration_minutes} 分钟${p.total > p.ready ? ` · ${p.total - p.ready} 道待核验` : ""}</p></div><button class="secondary" data-paper="${esc(p.id)}">开始练习</button></article>`,
        )
        .join("") ||
      `<div class="empty"><p>该科目还没有真题。</p><a class="text-link" href="#library?${query({ module: paperSubject })}">查看该科目题库</a></div>`;
    $$("[data-paper]", root).forEach(
      (b) =>
        (b.onclick = handle(() =>
          startPractice({
            filters: { paper_id: b.dataset.paper },
            mode: $("#quick-mode", root)?.value || "practice",
            full_paper: true,
            shuffle: false,
            title: meta.papers.find((p) => p.id === b.dataset.paper).title,
          }),
        )),
    );
  }
  $$("[data-paper-subject]", root).forEach(
    (b) =>
      (b.onclick = () => {
        paperSubject = b.dataset.paperSubject;
        $$("[data-paper-subject]", root).forEach((x) => {
          x.classList.toggle("selected", x === b);
          x.setAttribute("aria-pressed", x === b);
        });
        papers();
      }),
  );
  papers();
}
