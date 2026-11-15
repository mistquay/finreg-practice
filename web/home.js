import {
  $,
  $$,
  esc,
  api,
  startPractice,
  handle,
  duration,
  pct,
  num,
  modal,
  toast,
  isAdmin,
  account,
  paperSubject as getPaperSubject,
} from "./ui.js";
import { icon } from "./icons.js";
import { sparkBars, sparkLine, gauge } from "./charts.js";
import { openBuilder, subjectOrder } from "./builder.js";
import { openSettings } from "./auth.js";

const PAPER_TABS = [
  ["计算机专业", "专业科目"],
  ["行测", "行测"],
  ["申论", "申论"],
];
// Mock exams and daily essay drills live in the library; the home page lists real papers.
const NOT_REAL_PAPER = ["国考模拟题", "申论小模考"];
const GAUGE_COLORS = ["var(--primary)", "var(--amber)", "var(--violet)"];
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

const accuracyOf = (s) => (s.graded ? Math.round((s.correct / s.graded) * 1000) / 10 : null);
const minutes = (ms) => {
  const m = Math.round(ms / 60000);
  return m < 60 ? [String(m), "分钟"] : [`${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`, "时:分"];
};

function greeting() {
  const h = Number(
    new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "numeric", hour12: false }).format(
      new Date(),
    ),
  );
  return h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 13 ? "中午好" : h < 18 ? "下午好" : "晚上好";
}

function delta(now, before, unit = "", digits = 0) {
  if (before == null || now == null) return '<span class="delta flat">—</span>';
  const diff = Math.round((now - before) * 10 ** digits) / 10 ** digits;
  if (!diff) return '<span class="delta flat">持平</span>';
  return `<span class="delta ${diff > 0 ? "up" : "down"}">${diff > 0 ? "↑" : "↓"} ${Math.abs(diff)}${unit}</span>`;
}

function resumeCard(resume, finished, othersCount) {
  if (resume) {
    const exam = resume.mode === "exam";
    const done = exam ? resume.filled : resume.answered;
    const wrong = resume.graded - resume.correct;
    return `<article class="card dash-resume span-6" aria-labelledby="resume-title"><div class="card-heading"><h2>上次的练习</h2><span>${resume.updated_at.slice(5, 16).replace("T", " ")}</span></div>
      <h3 id="resume-title" class="resume-title">${esc(resume.title)}</h3>
      <p class="resume-meta">${exam ? "考试模式 · 交卷后统一判分" : "练习模式 · 单选即判，多选确认后判分"}${othersCount ? ` · 另有 ${othersCount} 个未完成` : ""}</p>
      <div class="resume-progress"><span class="meter"><i style="width:${(done / resume.total) * 100}%"></i></span><b class="num">${done} / ${resume.total}</b></div>
      <div class="resume-foot"><dl class="mini-stats">${
        exam
          ? `<div><dt>已填写</dt><dd class="num">${resume.filled}</dd></div><div><dt>未作答</dt><dd class="num">${resume.total - resume.filled}</dd></div>`
          : `<div><dt>答对</dt><dd class="num">${resume.correct}</dd></div><div><dt>答错</dt><dd class="num">${wrong}</dd></div><div><dt>正确率</dt><dd class="num">${pct(accuracyOf(resume))}</dd></div>`
      }</dl><div class="toolbar"><button class="quiet" data-discard="${resume.id}">放弃</button><a class="primary ink" href="#practice/${resume.id}">从第 ${resume.position + 1} 题继续${icon("arrow")}</a></div></div></article>`;
  }
  if (finished) {
    const wrong = finished.graded - finished.correct;
    return `<article class="card dash-resume span-6" aria-labelledby="resume-title"><div class="card-heading"><h2>上一轮已完成</h2><span>${finished.updated_at.slice(5, 16).replace("T", " ")}</span></div>
      <h3 id="resume-title" class="resume-title">${esc(finished.title)}</h3>
      <p class="resume-meta">${finished.graded ? `答对 ${finished.correct} / ${finished.graded} 题${wrong ? ` · ${wrong} 道错题已收进错题本` : ""}` : `已完成 ${finished.answered} 题`}</p>
      <div class="resume-progress"><span class="meter good"><i style="width:100%"></i></span><b class="num">${pct(accuracyOf(finished))}</b></div>
      <div class="resume-foot"><span></span><div class="toolbar"><a class="ghost" href="#practice/${finished.id}">查看复盘</a><button class="primary ink" data-open-builder>开始下一组${icon("arrow")}</button></div></div></article>`;
  }
  return `<article class="card dash-resume span-6" aria-labelledby="resume-title"><div class="card-heading"><h2>开始今天的练习</h2></div>
    <h3 id="resume-title" class="resume-title">选一个专项，进入状态</h3>
    <p class="resume-meta">专业课、行测与申论，按科目和小类组题，练习记录自动保存。</p>
    <div class="resume-foot"><span></span><div class="toolbar"><a class="ghost" href="#library">浏览题库</a><button class="primary ink" data-open-builder>${icon("plus")}自选专项</button></div></div></article>`;
}

function weekCard(dash) {
  const days = dash.week
    .map((d, i) => {
      const future = d.date > dash.date;
      const cls = d.date === dash.date ? "today" : d.count ? "done" : future ? "future" : "";
      return `<li class="${cls}"><span>${WEEKDAYS[i]}</span><b class="num" title="${d.date}：${d.count} 题">${Number(d.date.slice(8))}</b></li>`;
    })
    .join("");
  const practiced = dash.week.filter((d) => d.count).length;
  return `<article class="card dash-week span-3"><div class="card-heading"><h2>本周打卡</h2><span>${Number(dash.date.slice(5, 7))} 月</span></div><ol class="week-strip">${days}</ol><p class="streak">${icon("flame")}<b class="num">${dash.streak}</b> 天连续 · 本周练了 ${practiced} 天</p></article>`;
}

function masteryCard(dash) {
  const focus = dash.settings.focus.filter((m) => dash.subjects.some((s) => s.name === m));
  const byActivity = [...dash.subjects].sort((a, b) => b.graded - a.graded);
  const names = (focus.length ? focus : byActivity.filter((s) => s.graded).map((s) => s.name))
    .concat(subjectOrder(dash.subjects.map((s) => s.name)))
    .filter((m, i, a) => a.indexOf(m) === i)
    .slice(0, 3);
  const picked = names.map((n) => dash.subjects.find((s) => s.name === n));
  const graded = picked.reduce((n, s) => n + s.graded, 0);
  const correct = picked.reduce((n, s) => n + (s.accuracy == null ? 0 : (s.accuracy / 100) * s.graded), 0);
  const overall = graded ? `${Math.round((correct / graded) * 100)}%` : "—";
  return `<article class="card dash-mastery span-3"><div class="card-heading"><h2>科目掌握</h2><button class="text-link" id="edit-focus">${focus.length ? "主攻科目" : "设主攻"}</button></div>${gauge(
    picked.map((s, i) => ({ value: (s.accuracy || 0) / 100, color: GAUGE_COLORS[i] })),
    overall,
    "累计正确率",
  )}<ul class="subject-legend">${picked
    .map((s, i) => {
      const tone =
        s.accuracy == null ? ["muted", "未开始"] : s.name === dash.weakest ? ["warn", `${s.accuracy}% 薄弱`] : s.accuracy >= 80 ? ["good", `${s.accuracy}%`] : ["info", `${s.accuracy}%`];
      return `<li><i style="background:${GAUGE_COLORS[i]}"></i><span>${esc(s.name)}</span><span class="pill ${tone[0]}">${tone[1]}</span></li>`;
    })
    .join("")}</ul></article>`;
}

function kpiCards(dash, wrongTotal, wrongModules) {
  const t = dash.today,
    y = dash.yesterday,
    r = dash.recent;
  const [tv, tu] = minutes(t.elapsed_ms);
  const [yv] = minutes(y.elapsed_ms);
  const wrongPills = Object.entries(wrongModules)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([m, n]) => `<a class="pill warn" href="#review?module=${encodeURIComponent(m)}">${esc(m)} ${n}</a>`)
    .join("");
  return `<article class="card kpi span-3"><div class="card-heading"><h2>今日作答</h2><span>近 14 天</span></div><div class="kpi-value"><b class="num">${num(t.count)}</b><small>题</small>${delta(t.count, y.count)}</div><p class="kpi-note">昨天 ${num(y.count)} 题 · 目标 ${dash.settings.daily_goal} 题</p>${sparkBars(r.map((d) => d.count), "var(--primary)", "近 14 天每日作答题数")}</article>
  <article class="card kpi span-3"><div class="card-heading"><h2>正确率</h2><span>近 14 天</span></div><div class="kpi-value"><b class="num">${t.accuracy == null ? "—" : t.accuracy}</b><small>${t.accuracy == null ? "今天还没判分" : "%"}</small>${delta(t.accuracy, y.accuracy, "%", 1)}</div><p class="kpi-note">昨天 ${pct(y.accuracy)} · 不含申论</p>${sparkLine(r.map((d) => d.accuracy), "var(--violet)", "近 14 天每日正确率")}</article>
  <article class="card kpi span-3"><div class="card-heading"><h2>有效用时</h2><span>近 14 天</span></div><div class="kpi-value"><b class="num">${tv}</b><small>${tu}</small>${delta(Math.round(t.elapsed_ms / 60000), Math.round(y.elapsed_ms / 60000), " 分")}</div><p class="kpi-note">昨天 ${yv === "0" ? "未练习" : duration(y.elapsed_ms)} · 暂停不计时</p>${sparkBars(r.map((d) => Math.round(d.elapsed_ms / 60000)), "var(--amber)", "近 14 天每日有效用时（分钟）")}</article>
  <article class="card kpi span-3"><div class="card-heading"><h2>待复习错题</h2><a class="text-link" href="#review">错题本${icon("arrow")}</a></div><div class="kpi-value"><b class="num">${num(wrongTotal)}</b><small>道</small>${t.review ? `<span class="delta up">今天复习 ${t.review}</span>` : ""}</div><p class="kpi-note">按每道题最近一次作答判断</p><div class="kpi-pills">${wrongPills || '<span class="caption">暂时没有错题</span>'}</div>${wrongTotal ? `<button class="ghost wide" id="start-review">${icon("redo")}错题重练 ${Math.min(20, wrongTotal)} 题</button>` : ""}</article>`;
}

function tasksCard(dash) {
  const done = dash.tasks.filter((t) => t.done >= t.total).length;
  return `<article class="card dash-tasks span-4"><div class="card-heading"><h2>今日清单</h2><span>${done} / ${dash.tasks.length} 完成</span></div><span class="meter amber thin"><i style="width:${(done / dash.tasks.length) * 100}%"></i></span><ul class="task-list">${dash.tasks
    .map((t) => {
      const ok = t.done >= t.total;
      return `<li class="${ok ? "ok" : ""}"><button data-task="${t.key}" ${t.module ? `data-task-module="${esc(t.module)}"` : ""}><span class="task-check">${ok ? icon("check") : ""}</span><span class="task-label">${esc(t.label)}</span><span class="task-count num">${t.done} / ${t.total}</span></button></li>`;
    })
    .join("")}</ul>${dash.settings.daily_goal === 50 && !dash.settings.exam_date ? '<button class="text-link" data-open-settings>设置每日目标和考试日期</button>' : ""}</article>`;
}

function sessionsCard(sessions) {
  const items = sessions.slice(0, 4).map((s, i) => {
    const done = s.status === "completed";
    const status = done
      ? `<span class="pill good">${s.graded ? `已完成 · ${pct(accuracyOf(s))}` : "已完成"}</span>`
      : s.started
        ? '<span class="pill warn">进行中</span>'
        : '<span class="pill muted">未开始</span>';
    const detail = done
      ? `${s.total} 题`
      : s.mode === "exam"
        ? `已填 ${s.filled} / ${s.total}`
        : `已答 ${s.answered} / ${s.total}`;
    return `<li class="${!done && s.started && i === 0 ? "hot" : ""}"><a href="#practice/${s.id}"><span class="session-title">${esc(s.title)}</span><span class="session-meta">${status}<small>${detail} · ${s.updated_at.slice(5, 16).replace("T", " ")}</small></span></a>${done ? "" : `<button class="quiet" data-discard="${s.id}" aria-label="放弃：${esc(s.title)}">${icon("close")}</button>`}</li>`;
  });
  return `<article class="card dash-sessions span-3"><div class="card-heading"><h2>最近练习</h2><span>${sessions.length ? `${Math.min(4, sessions.length)} 条` : ""}</span></div>${
    items.length
      ? `<ul class="session-list">${items.join("")}</ul>`
      : '<p class="empty-line">还没有练习记录。完成第一组练习后，可以随时回来继续。</p>'
  }</article>`;
}

export async function renderHome(root, meta) {
  const dash = await api("/api/dashboard");
  if (!root.isConnected) return;
  const c = meta.counts;
  const mastery = Object.fromEntries(dash.subjects.map((s) => [s.name, s.accuracy]));
  const state = { paperSubject: "计算机专业" };
  const inProgress = meta.sessions.filter((s) => s.status === "active" && s.started);
  const latest = meta.sessions[0];
  const finished = !inProgress.length && latest?.status === "completed" ? latest : null;
  const name = account.user?.username || "";
  const countdown =
    dash.countdown == null
      ? '<button class="text-link" data-open-settings>设置考试日期</button>'
      : dash.countdown >= 0
        ? `距${esc(dash.settings.exam_name || "考试")}还有 <b class="num">${dash.countdown}</b> 天`
        : `${esc(dash.settings.exam_name || "考试")}已过去 ${-dash.countdown} 天`;
  const goalLeft = Math.max(0, dash.settings.daily_goal - dash.today.count);

  root.innerHTML = `<header class="dash-hello"><div><h1>${greeting()}，${esc(name)}</h1><p>${countdown}<span class="dot-sep"></span>${goalLeft ? `今日目标 ${dash.settings.daily_goal} 题，还差 <b class="num">${goalLeft}</b> 题` : `今日目标 ${dash.settings.daily_goal} 题已完成`}</p></div>
    <div class="quick-actions">${inProgress[0] ? `<a class="chip primary-chip" href="#practice/${inProgress[0].id}">${icon("play")}继续练习</a>` : ""}<button class="chip ${inProgress[0] ? "" : "primary-chip"}" data-open-builder id="open-builder">${icon("plus")}自选专项</button>${c.wrong ? `<button class="chip" id="chip-review">${icon("redo")}错题重练<small>${num(c.wrong)}</small></button>` : ""}<a class="chip" href="#library?view=papers">${icon("layers")}真题整卷</a></div></header>
    <div class="dash-grid">
      ${resumeCard(inProgress[0], finished, Math.max(0, inProgress.length - 1))}
      ${weekCard(dash)}
      ${masteryCard(dash)}
      ${kpiCards(dash, c.wrong, c.wrong_modules)}
      ${tasksCard(dash)}
      <article class="card dash-papers span-5"><div class="card-heading wrap"><h2>真题进度</h2><div class="segmented" role="group" aria-label="真题科目">${PAPER_TABS.map(
        ([v, t]) => `<button data-paper-subject="${v}">${t}</button>`,
      ).join("")}</div></div><div id="home-papers"></div></article>
      ${sessionsCard(meta.sessions)}
    </div>`;

  $$("[data-open-builder]", root).forEach((b) => (b.onclick = () => openBuilder(meta, {}, mastery)));
  $$("[data-open-settings]", root).forEach(
    (b) => (b.onclick = () => openSettings(() => renderHome(root, meta))),
  );
  $("#edit-focus", root).onclick = () => openSettings(() => renderHome(root, meta), "focus");
  const startReview = handle(() => startPractice({ mode: "review", count: 20, title: "错题复习" }));
  [$("#start-review", root), $("#chip-review", root)].forEach((b) => b && (b.onclick = startReview));
  $$("[data-task]", root).forEach(
    (b) =>
      (b.onclick = () => {
        if (b.dataset.task === "review") return startReview();
        openBuilder(meta, b.dataset.taskModule ? { modules: [b.dataset.taskModule] } : {}, mastery);
      }),
  );

  function papers() {
    $$("[data-paper-subject]", root).forEach((b) =>
      b.setAttribute("aria-pressed", b.dataset.paperSubject === state.paperSubject),
    );
    const list = meta.papers
      .filter((p) => {
        const subject = getPaperSubject(p);
        return (
          !NOT_REAL_PAPER.includes(p.kind) &&
          (state.paperSubject === "计算机专业"
            ? !["行测", "申论"].includes(subject)
            : subject === state.paperSubject)
        );
      })
      .slice(0, 5);
    $("#home-papers", root).innerHTML = list.length
      ? `<div class="table-scroll"><table class="paper-table"><thead><tr><th scope="col">年份</th><th scope="col">试卷</th><th scope="col">完成</th><th scope="col">正确率</th><th scope="col"><span class="visually-hidden">操作</span></th></tr></thead><tbody>${list
          .map((p) => {
            const acc = p.graded ? Math.round((p.correct / p.graded) * 100) : null;
            const share = p.ready ? Math.min(1, p.done / p.ready) : 0;
            return `<tr><td class="paper-year num">${p.year || "—"}</td><th scope="row" class="paper-name" title="${esc(p.title)}">${esc(p.title.replace(/^\d{4}\s*/, ""))}</th><td><span class="meter thin paper-meter" title="已做 ${p.done} / ${p.ready}"><i style="width:${share * 100}%"></i></span></td><td>${acc == null ? '<span class="pill muted">未开始</span>' : `<span class="pill ${acc >= 80 ? "good" : acc >= 60 ? "info" : "warn"}">${acc}%</span>`}</td><td><button class="quiet" data-paper="${esc(p.id)}">${p.done ? "再练" : "开始"}</button></td></tr>`;
          })
          .join("")}</tbody></table></div><a class="text-link more-link" href="#library?view=papers">全部真题${icon("arrow")}</a>`
      : `<p class="empty-line">该科目还没有真题。</p>`;
    $$("[data-paper]", root).forEach(
      (b) =>
        (b.onclick = handle(() =>
          startPractice({
            filters: { paper_id: b.dataset.paper },
            mode: "practice",
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
        state.paperSubject = b.dataset.paperSubject;
        papers();
      }),
  );
  papers();

  $$("[data-discard]", root).forEach(
    (b) =>
      (b.onclick = () => {
        const s = meta.sessions.find((x) => x.id === b.dataset.discard);
        const kept = s.answered
          ? `已提交的 ${s.answered} 道作答会保留在统计和错题中，这次练习将标记为结束。`
          : "这次练习还没有提交任何作答，草稿会被删除。";
        const d = modal(
          `<h2>放弃“${esc(s.title)}”？</h2><p class="muted">${kept}</p><div class="toolbar dialog-actions"><button class="secondary" id="keep-session">保留</button><button class="primary" id="confirm-discard">放弃练习</button></div>`,
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
  if (!meta.facets.length)
    $(".dash-grid", root).insertAdjacentHTML(
      "afterbegin",
      `<div class="card span-12 empty"><h2>题库还没有题目</h2><p>${isAdmin() ? "先导入题库，学习中心就会出现练习入口。" : "请联系管理员导入题库。"}</p>${isAdmin() ? '<a class="primary" href="#data">导入题库</a>' : ""}</div>`,
    );
}
