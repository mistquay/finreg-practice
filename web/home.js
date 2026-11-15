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
  num,
  modal,
  toast,
  isAdmin,
  paperSubject as getPaperSubject,
} from "./ui.js";
import { icon } from "./icons.js";

const SUBJECTS = ["计算机专业", "经济金融基础", "英语", "行测", "申论"];
const SUBJECT_ICONS = {
  计算机专业: "monitor",
  经济金融基础: "chart",
  英语: "globe",
  行测: "book",
  申论: "pen",
};
const DESCRIPTIONS = {
  计算机专业: "沿着知识点，打牢专业基础",
  经济金融基础: "理解概念，也掌握应用",
  英语: "在真题中积累阅读经验",
  行测: "练习解题方法与作答速度",
  申论: "阅读材料，组织有依据的表达",
};
const PAPER_TABS = [
  ["计算机专业", "专业科目"],
  ["行测", "行测"],
  ["申论", "申论"],
];
// Mock exams and daily essay drills are reachable from the library; the home page lists real papers.
const NOT_REAL_PAPER = ["国考模拟题", "申论小模考"];
const PAPER_PAGE = 5;

function readyBy(facets, key, filter = () => true) {
  const counts = {};
  facets.filter(filter).forEach((f) => {
    counts[f[key]] = (counts[f[key]] || 0) + f.ready;
  });
  return counts;
}

const accuracy = (s) =>
  s.graded ? pct(Math.round((s.correct / s.graded) * 1000) / 10) : null;

// The top panel: an unfinished session with real progress, else the round just finished, else a prompt.
function continueHTML(resume, finished, othersCount) {
  const others = othersCount
    ? `<small class="continue-more">另有 ${othersCount} 个未完成练习，见右侧“最近练习”。</small>`
    : "";
  if (resume) {
    const progress =
      resume.mode === "exam"
        ? `考试模式 · 已填写 ${resume.filled} / ${resume.total} 题，交卷后统一判分`
        : `已答 ${resume.answered} / ${resume.total} 题 · 上次看到第 ${resume.position + 1} 题`;
    return `<section class="continue-panel" aria-labelledby="continue-title"><div class="continue-copy"><span class="status-label">${icon("bookmark")}上次的练习还没做完</span><h2 id="continue-title">${esc(resume.title)}</h2><p>${progress}</p><div class="toolbar"><a class="button primary" href="#practice/${resume.id}">继续上次练习${icon("arrow")}</a><button class="quiet" data-discard="${resume.id}">放弃这次练习</button></div>${others}</div>${noteArt()}</section>`;
  }
  if (finished) {
    const wrong = finished.graded - finished.correct;
    const result = finished.graded
      ? `答对 ${finished.correct} / ${finished.graded} 题 · 正确率 ${accuracy(finished)}${wrong ? ` · ${wrong} 道错题已收进错题本` : ""}`
      : `已完成 ${finished.answered} 题`;
    return `<section class="continue-panel" aria-labelledby="continue-title"><div class="continue-copy"><span class="status-label">${icon("check")}上一轮已完成</span><h2 id="continue-title">${esc(finished.title)}</h2><p>${result}</p><div class="toolbar"><button class="primary" id="next-round">开始下一组${icon("arrow")}</button><a class="button secondary" href="#practice/${finished.id}">查看复盘</a></div></div>${noteArt()}</section>`;
  }
  return `<section class="continue-panel" aria-labelledby="continue-title"><div class="continue-copy"><span class="status-label">${icon("book")}为今天留一点学习时间</span><h2 id="continue-title">选一个专项，开始进入状态。</h2><p>专业课、行测与申论，按你的节奏练习。</p><a class="button primary" href="#library">浏览题库${icon("arrow")}</a></div>${noteArt()}</section>`;
}

function noteArt() {
  return '<div class="continue-note" aria-hidden="true"><span>知 序</span><div class="book-lines"><i></i><i></i><i></i><i></i></div><small>日有所学</small></div>';
}

function sessionHTML(s) {
  const done = s.status === "completed";
  const [symbol, tone, action] = done
    ? ["check", "done", "查看复盘"]
    : s.started
      ? ["clock", "", "继续练习"]
      : ["book", "idle", "未开始 · 点击开始"];
  const detail = done
    ? s.graded
      ? ` · 正确率 ${accuracy(s)}`
      : ` · 已答 ${s.answered}`
    : s.started
      ? s.mode === "exam"
        ? ` · 已填 ${s.filled}`
        : ` · 已答 ${s.answered}`
      : "";
  return `<div class="session-item"><a href="#practice/${s.id}"><span class="session-status ${tone}">${icon(symbol)}</span><div><strong>${esc(s.title)}</strong><small>${s.updated_at.slice(5, 16).replace("T", " ")} · ${s.total} 题${detail}</small><span>${action}</span></div>${icon("arrow")}</a>${done ? "" : `<button class="quiet discard" data-discard="${s.id}" aria-label="放弃：${esc(s.title)}">放弃</button>`}</div>`;
}

export async function renderHome(root, meta) {
  const stats = await api("/api/stats?days=7");
  const c = meta.counts;
  const modules = readyBy(meta.facets, "module");
  const available = Object.keys(modules).sort(
    (a, b) => SUBJECTS.indexOf(a) - SUBJECTS.indexOf(b),
  );
  const state = {
    modules: available.slice(0, 1),
    category: "",
    paperSubject: "计算机专业",
    paperLimit: PAPER_PAGE,
  };
  // Sessions arrive most recently active first; untouched ones are listed but never promoted.
  const inProgress = meta.sessions.filter(
    (s) => s.status === "active" && s.started,
  );
  const latest = meta.sessions[0];
  const finished =
    !inProgress.length && latest?.status === "completed" ? latest : null;
  root.innerHTML =
    heading(
      "今天，从一道题开始。",
      "专注练习，认真复盘。把每一步积累留在这里。",
      `<a class="button secondary" href="#stats">${icon("chart")}查看学习统计</a>`,
    ) +
    `<div class="home-columns">
      <div class="home-main">
        ${continueHTML(inProgress[0], finished, inProgress.length - 1)}
        <section class="practice-builder" aria-labelledby="module-title"><div class="section-title"><h2 id="module-title">专项练习</h2><span>科目可多选；只选一科时可再选小类</span></div><div class="subject-list">${
          available
            .map(
              (m) =>
                `<button class="subject-row" data-module="${esc(m)}" role="checkbox"><span class="subject-symbol">${icon(SUBJECT_ICONS[m])}</span><span class="subject-copy"><strong>${esc(m)}</strong><small>${esc(DESCRIPTIONS[m] || "按模块练习，逐步积累")}</small></span><span class="subject-count">${num(modules[m])}<small>道题</small></span><span class="subject-select">${icon("check")}</span></button>`,
            )
            .join("") ||
          (isAdmin()
            ? '<div class="empty"><h3>先为学习空间添加题目</h3><a class="button primary" href="#data">导入题库</a></div>'
            : '<div class="empty"><h3>题库还没有题目</h3><p>请联系管理员导入题库。</p></div>')
        }</div>${
          available.length
            ? `<div class="category-picker" id="category-picker" role="group" aria-label="知识小类"></div><div class="builder-actions"><label class="inline-field">模式<select id="quick-mode"><option value="practice">练习模式</option><option value="exam">考试模式</option></select></label><label class="inline-field">每组题量<select id="quick-count"><option>10</option><option selected>20</option><option>30</option><option>50</option></select></label><label class="check-field"><input id="quick-unseen" type="checkbox">只练未做题</label><button class="primary" id="quick-start">开始练习 ${icon("arrow")}</button></div><p class="builder-hint" id="builder-hint"></p>`
            : ""
        }</section>
        <section aria-labelledby="papers-title"><div class="section-title"><h2 id="papers-title">真题练习</h2><a class="text-link" href="#library">全部题库 ${icon("arrow")}</a></div><div class="paper-tabs segmented" role="group" aria-label="真题科目">${PAPER_TABS.map(
          ([v, t]) => `<button data-paper-subject="${v}">${t}</button>`,
        ).join("")}</div><div class="paper-list" id="home-papers"></div></section>
      </div>
      <aside class="home-aside"><section class="today-panel"><div class="section-title"><h2>今日学习</h2><span>北京时间</span></div><div class="today-count"><strong>${num(stats.today.count)}</strong><span>次作答</span></div><dl class="today-details"><div><dt>正确率</dt><dd>${pct(stats.today.accuracy)}</dd></div><div><dt>有效用时</dt><dd>${duration(stats.today.elapsed_ms)}</dd></div><div><dt>近 7 天作答</dt><dd>${num(stats.summary.count)} 次</dd></div></dl><div class="coverage"><span>题目覆盖</span><strong>${num(c.seen)} <small>/ ${num(c.total)}</small></strong><progress max="${c.total || 1}" value="${c.seen || 0}" aria-label="已作答题目覆盖"></progress><small>按卷内题次统计，同一源题可能出现在多套试卷。</small></div></section>
        <section class="review-links" aria-label="复习入口"><a href="#review">${icon("bookmark")}<span><strong>错题复习</strong><small>${c.wrong ? "再练一次，找出薄弱处" : "练习中的错题会收录在这里"}</small></span><b>${num(c.wrong)}</b>${icon("arrow")}</a><a href="#review?scope=favorite">${icon("book")}<span><strong>我的收藏</strong><small>留住值得反复看的题</small></span><b>${num(c.favorites)}</b>${icon("arrow")}</a>${c.wrong ? `<button class="secondary wide" id="start-review">立即复习错题 · ${Math.min(20, c.wrong)} 题</button>` : ""}</section>
        <section class="recent-panel"><div class="section-title"><h2>最近练习</h2></div>${
          meta.sessions.length
            ? `<div class="session-list">${meta.sessions.slice(0, 5).map(sessionHTML).join("")}</div>`
            : '<p class="recent-empty">还没有练习记录。<br>完成第一组练习后，随时回来继续。</p>'
        }</section>
      </aside>
    </div>`;

  function selectSubject() {
    $$("[data-module]", root).forEach((b) => {
      const on = state.modules.includes(b.dataset.module);
      b.classList.toggle("selected", on);
      b.setAttribute("aria-checked", on);
    });
    const picker = $("#category-picker", root);
    if (!picker) return;
    if (state.modules.length > 1) {
      // Categories belong to one subject; a mix draws from each whole subject.
      picker.hidden = true;
      $("#builder-hint", root).textContent =
        `${state.modules.join(" + ")} · 共 ${num(state.modules.reduce((n, m) => n + modules[m], 0))} 道 · 各科目平均分配题量，随机混合出题`;
      return;
    }
    const [module] = state.modules;
    const counts = readyBy(meta.facets, "category", (f) => f.module === module);
    const categories = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    // A single-category subject has nothing to choose.
    picker.hidden = categories.length < 2;
    picker.innerHTML = [["", "全部小类", modules[module]]]
      .concat(categories.map((k) => [k, k, counts[k]]))
      .map(
        ([v, t, n]) =>
          `<button class="chip ${v === state.category ? "selected" : ""}" data-category="${esc(v)}" aria-pressed="${v === state.category}">${esc(t)}<small>${num(n)}</small></button>`,
      )
      .join("");
    $$("[data-category]", root).forEach(
      (b) =>
        (b.onclick = () => {
          state.category = b.dataset.category;
          selectSubject();
        }),
    );
    $("#builder-hint", root).textContent =
      `${module}${state.category ? ` · ${state.category}` : ""} · 随机组题，自动跳过待核验题目`;
  }
  $$("[data-module]", root).forEach(
    (b) =>
      (b.onclick = () => {
        const m = b.dataset.module;
        if (!state.modules.includes(m))
          state.modules = available.filter(
            (x) => x === m || state.modules.includes(x),
          );
        else if (state.modules.length > 1)
          state.modules = state.modules.filter((x) => x !== m);
        else return toast("至少选择一个科目");
        state.category = "";
        selectSubject();
      }),
  );
  if (available.length) selectSubject();

  const start = $("#quick-start", root);
  if (start)
    start.onclick = handle(async () => {
      start.disabled = true;
      try {
        await startPractice({
          filters: {
            module:
              state.modules.length > 1 ? state.modules : state.modules[0],
            ...(state.category ? { category: state.category } : {}),
            ...($("#quick-unseen", root).checked ? { unseen: "1" } : {}),
          },
          mode: $("#quick-mode", root).value,
          count: Number($("#quick-count", root).value),
          title:
            state.modules.length > 1
              ? `${state.modules.join("、")} · 综合练习`
              : `${state.category || state.modules[0]} · 专项练习`,
        });
      } finally {
        start.disabled = false;
      }
    });
  const review = $("#start-review", root);
  if (review)
    review.onclick = handle(() =>
      startPractice({ mode: "review", count: 20, title: "错题复习" }),
    );

  function papers() {
    $$("[data-paper-subject]", root).forEach((b) => {
      const on = b.dataset.paperSubject === state.paperSubject;
      b.classList.toggle("selected", on);
      b.setAttribute("aria-pressed", on);
    });
    const all = meta.papers.filter((p) => {
      const subject = getPaperSubject(p);
      return (
        !NOT_REAL_PAPER.includes(p.kind) &&
        (state.paperSubject === "计算机专业"
          ? !["行测", "申论"].includes(subject)
          : subject === state.paperSubject)
      );
    });
    const list = all.slice(0, state.paperLimit);
    const rest = all.length - list.length;
    $("#home-papers", root).innerHTML =
      (list
        .map((p) => {
          const progress = p.done
            ? `<span class="paper-done ${p.done >= p.ready ? "complete" : ""}">已做 ${num(p.done)} / ${num(p.ready)}</span>`
            : "";
          return `<article class="paper-row"><div class="paper-year">${p.year || "—"}</div><div class="paper-copy"><h3>${esc(p.title)}</h3><p>${num(p.ready)} 道可练习 · 建议 ${p.duration_minutes} 分钟${p.total > p.ready ? ` · ${p.total - p.ready} 道待核验` : ""}${progress}</p></div><button class="secondary" data-paper="${esc(p.id)}">${p.done ? "再练一遍" : "开始练习"}</button></article>`;
        })
        .join("") ||
        `<div class="empty"><p>该科目还没有真题。</p><a class="text-link" href="#library?${query({ module: state.paperSubject })}">查看该科目题库</a></div>`) +
      (rest > 0
        ? `<button class="quiet more-papers" id="more-papers">显示更多 · 还有 ${rest} 套</button>`
        : "");
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
    const more = $("#more-papers", root);
    if (more)
      more.onclick = () => {
        state.paperLimit += 10;
        papers();
      };
  }
  $$("[data-paper-subject]", root).forEach(
    (b) =>
      (b.onclick = () => {
        state.paperSubject = b.dataset.paperSubject;
        state.paperLimit = PAPER_PAGE;
        papers();
      }),
  );
  papers();

  const next = $("#next-round", root);
  if (next)
    next.onclick = () => {
      const builder = $(".practice-builder", root);
      builder.scrollIntoView({
        block: "start",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
      $("#quick-start", root)?.focus({ preventScroll: true });
    };

  $$("[data-discard]", root).forEach(
    (b) =>
      (b.onclick = () => {
        const s = meta.sessions.find((x) => x.id === b.dataset.discard);
        const kept = s.answered
          ? `已提交的 ${s.answered} 道作答会保留在统计和错题中，这次练习将标记为结束。`
          : "这次练习还没有提交任何作答，草稿会被删除。";
        const d = modal(
          `<h2>放弃“${esc(s.title)}”？</h2><p class="finish-note">${kept}</p><div class="toolbar"><button class="secondary" id="keep-session">保留</button><button class="primary" id="confirm-discard">放弃练习</button></div>`,
        );
        $("#keep-session", d).onclick = () => d.close();
        $("#confirm-discard", d).onclick = handle(async (e) => {
          e.target.disabled = true;
          try {
            localStorage.removeItem(`finreg-drafts-${s.id}`);
          } catch {}
          await api(`/api/session/${s.id}/discard`, {});
          d.close();
          toast("已放弃这次练习");
          await renderHome(root, await api("/api/meta"));
        });
      }),
  );
}
