import {
  $,
  $$,
  esc,
  rich,
  api,
  query,
  options,
  unique,
  sourceLink,
  modal,
  toast,
  pct,
  startPractice,
  handle,
  paperSubject,
  typeLabel,
  num,
  cascadeFacets,
  debounced,
  isAdmin,
} from "./ui.js";
import { icon } from "./icons.js";

function libraryTabs(current) {
  return `<nav class="segmented view-tabs" aria-label="题库视图">${[
    ["questions", "按题目", "#library"],
    ["papers", "按试卷", "#library?view=papers"],
  ]
    .map(([k, t, href]) => `<a href="${href}" aria-current="${k === current ? "page" : "false"}" class="${k === current ? "selected" : ""}">${t}</a>`)
    .join("")}</nav>`;
}

const PAPER_SUBJECTS = [
  ["", "全部"],
  ["计算机专业", "专业科目"],
  ["行测", "行测"],
  ["申论", "申论"],
];
const PAPERS_PER_PAGE = 15;

// Paper view: every source paper with the user's progress, startable in practice or exam mode.
async function renderPapers(root, meta, params) {
  const state = { subject: params.subject || "", search: params.search || "", kind: params.kind || "", page: 1 };
  root.innerHTML = `<header class="page-heading"><div><h1>题库</h1><p>共 ${num(meta.papers.length)} 套试卷 · 点试卷名查看全部题目</p></div>${libraryTabs("papers")}</header>
    <section class="card library-filters papers-filters"><div class="filter-main"><div class="segmented" role="group" aria-label="科目">${PAPER_SUBJECTS.map(
      ([v, t]) => `<button data-subject="${v}" aria-pressed="${v === state.subject}">${t}</button>`,
    ).join("")}</div><label class="search-control"><span class="visually-hidden">查找试卷</span>${icon("search")}<input id="paper-search" type="search" placeholder="试卷名称或年份" value="${esc(state.search)}"></label><label class="inline-field">类型<select id="paper-kind">${options(unique(meta.papers.map((p) => p.kind)), state.kind)}</select></label></div></section>
    <section class="card paper results-card"><div class="results-heading"><h2 id="paper-count" aria-live="polite"></h2><span class="caption">完成度按可练习题计算</span></div><div class="table-scroll" id="papers-table"></div><div class="pagination" id="papers-pages"></div></section>`;
  const matches = (p) => {
    const subject = paperSubject(p);
    return (
      (!state.subject ||
        (state.subject === "计算机专业" ? !["行测", "申论"].includes(subject) : subject === state.subject)) &&
      (!state.kind || p.kind === state.kind) &&
      `${p.title} ${p.year || ""}`.toLowerCase().includes(state.search.toLowerCase())
    );
  };
  function paint() {
    $$("[data-subject]", root).forEach((b) => b.setAttribute("aria-pressed", b.dataset.subject === state.subject));
    const list = meta.papers.filter(matches);
    const pages = Math.max(1, Math.ceil(list.length / PAPERS_PER_PAGE));
    state.page = Math.min(state.page, pages);
    $("#paper-count", root).textContent = `${num(list.length)} 套试卷`;
    const rows = list.slice((state.page - 1) * PAPERS_PER_PAGE, state.page * PAPERS_PER_PAGE);
    $("#papers-table", root).innerHTML = rows.length
      ? `<table class="papers-table"><thead><tr><th scope="col">年份</th><th scope="col">试卷</th><th scope="col">类型</th><th scope="col">可练习</th><th scope="col">完成</th><th scope="col">正确率</th><th scope="col"><span class="visually-hidden">操作</span></th></tr></thead><tbody>${rows
          .map((p) => {
            const acc = p.graded ? Math.round((p.correct / p.graded) * 100) : null;
            const share = p.ready ? Math.min(1, p.done / p.ready) : 0;
            return `<tr><td class="num paper-year">${p.year || "—"}</td><th scope="row"><a class="paper-link" href="#library?paper_id=${encodeURIComponent(p.id)}">${esc(p.title)}</a></th><td><span class="pill muted">${esc(p.kind || "—")}</span></td><td class="num">${num(p.ready)}${p.total > p.ready ? `<small class="caption"> / ${num(p.total)}</small>` : ""}</td><td><span class="paper-progress"><span class="meter thin"><i style="width:${share * 100}%"></i></span><small class="num">${num(p.done)}</small></span></td><td>${acc == null ? '<span class="pill muted">未开始</span>' : `<span class="pill ${acc >= 80 ? "good" : acc >= 60 ? "info" : "warn"}">${pct(acc)}</span>`}</td><td class="row-actions"><button class="quiet" data-paper="${esc(p.id)}" data-mode="practice" ${p.ready ? "" : "disabled"}>练习</button><button class="quiet" data-paper="${esc(p.id)}" data-mode="exam" ${p.ready ? "" : "disabled"}>模考</button></td></tr>`;
          })
          .join("")}</tbody></table>`
      : '<div class="empty"><h3>没有找到试卷</h3><p>试试换个科目，或用更短的关键词。</p></div>';
    $("#papers-pages", root).innerHTML = `<span>第 ${state.page} / ${pages} 页</span><button class="secondary" id="papers-prev" ${state.page <= 1 ? "disabled" : ""}>上一页</button><button class="secondary" id="papers-next" ${state.page >= pages ? "disabled" : ""}>下一页</button>`;
    $("#papers-prev", root).onclick = () => (state.page--, paint());
    $("#papers-next", root).onclick = () => (state.page++, paint());
    $$("[data-paper]", root).forEach(
      (b) =>
        (b.onclick = handle(() =>
          startPractice({
            filters: { paper_id: b.dataset.paper },
            mode: b.dataset.mode,
            full_paper: true,
            shuffle: false,
            title: meta.papers.find((p) => p.id === b.dataset.paper).title,
          }),
        )),
    );
  }
  $$("[data-subject]", root).forEach(
    (b) => (b.onclick = () => ((state.subject = b.dataset.subject), (state.page = 1), paint())),
  );
  $("#paper-search", root).oninput = (e) => ((state.search = e.target.value.trim()), (state.page = 1), paint());
  $("#paper-kind", root).onchange = (e) => ((state.kind = e.target.value), (state.page = 1), paint());
  paint();
}

export async function questionDetail(id) {
  const q = await api("/api/question/" + encodeURIComponent(id) + "?answer=1");
  const d = modal(
    `<p class="caption">${esc(q.source)} · 第${q.number}题</p><h2>${typeLabel(q.type)} <span class="badge ${q.quality === "review" ? "warn" : ""}">${q.quality === "review" ? "待核验" : "可练习"}</span></h2>${q.issues.length ? `<div class="notice">${q.issues.map(esc).join("；")}</div>` : ""}${q.material ? `<details class="material" open><summary>阅读材料</summary><div class="prose">${rich(q.material)}</div></details>` : ""}<div class="prose question-stem">${rich(q.stem)}</div><div class="detail-options">${Object.entries(
      q.options,
    )
      .map(([k, v]) => `<p><b>${k}.</b> ${rich(v)}</p>`)
      .join(
        "",
      )}</div><div class="answer-box"><strong>来源参考答案：${q.type === "essay" ? "见下方文字解析" : q.answer.join("、") || "未提供"}</strong><div class="prose">${rich(q.explanation) || "来源暂未提供文字解析。请结合原卷或课程核对。"}</div></div><p>${sourceLink(q)}</p><div class="toolbar"><button id="detail-favorite" class="secondary">${q.favorite ? "取消收藏" : "收藏题目"}</button>${isAdmin() ? '<button id="detail-edit" class="secondary">编辑 / 核验</button>' : ""}</div><label class="field">我的笔记<textarea id="detail-note" rows="3" placeholder="停止输入后自动保存">${esc(q.note)}</textarea></label><button id="save-note" class="primary">保存笔记</button>${q.provider ? `<details class="raw"><summary>来源字段 · ${esc(q.provider)} / ${esc(q.external_id)} · 难度 ${q.difficulty ?? "未提供"}</summary><p class="caption">完整原始业务字段保存在本地，未用到的字段也会保留。${q.raw?.platform_statistics?.totalCount != null ? `粉笔平台作答量 ${q.raw.platform_statistics.totalCount} 次，平台正确率 ${Number(q.raw.platform_statistics.correctRatio).toFixed(1)}%（采集时快照，与个人统计分开）。` : ""}</p><pre>${esc(JSON.stringify(q.raw, null, 2))}</pre></details>` : ""}`,
  );
  $("#detail-favorite", d).onclick = handle(async (e) => {
    const v = await api("/api/mark/" + id, { favorite: !q.favorite });
    q.favorite = v.favorite;
    e.target.textContent = q.favorite ? "取消收藏" : "收藏题目";
    toast("已保存");
  });
  const note = $("#detail-note", d);
  const saveNote = async () => {
    if (note.value === q.note) return;
    await api("/api/mark/" + id, { note: note.value });
    q.note = note.value;
    toast("笔记已保存");
  };
  const autosave = debounced(handle(saveNote), 1000);
  note.oninput = () => autosave.schedule();
  d.addEventListener("close", () => autosave.flush(), { once: true });
  $("#save-note", d).onclick = handle(async () => {
    autosave.flush();
    await saveNote();
    toast("笔记已保存");
  });
  const editButton = $("#detail-edit", d);
  if (editButton) editButton.onclick = () => edit(q, d);
}
function edit(q, d) {
  d.innerHTML = `<button class="dialog-close secondary" aria-label="关闭">×</button><h2>编辑与核验题目</h2><p class="caption">核验请以原卷为依据。保存会更新题目；历史作答仍保留当时的答案快照与判分。</p><p>${sourceLink(q)}</p><form id="edit-form"><label class="field">题干<textarea name="stem" rows="4" required>${esc(q.stem)}</textarea></label><label class="field">选项（每行 A=选项内容）<textarea name="options" rows="7">${esc(
    Object.entries(q.options)
      .map(([k, v]) => k + "=" + v.replaceAll("\n", " "))
      .join("\n"),
  )}</textarea></label><div class="form-grid"><label>参考答案<input name="answer" value="${q.answer.join("")}" placeholder="例如 A 或 ACD"></label><label>题型<select name="type"><option value="essay" ${q.type === "essay" ? "selected" : ""}>申论主观题</option><option value="single" ${q.type === "single" ? "selected" : ""}>单选</option><option value="multiple" ${q.type === "multiple" ? "selected" : ""}>多选</option></select></label><label>核验状态<select name="quality"><option value="review" ${q.quality === "review" ? "selected" : ""}>待核验</option><option value="ready" ${q.quality === "ready" ? "selected" : ""}>可练习（已核验）</option></select></label><label>模块<input name="module" value="${esc(q.module)}" required></label><label>小类<input name="category" value="${esc(q.category)}" required></label><label>考点<input name="topic" value="${esc(q.topic)}" required></label></div><label class="field">标签（逗号分隔）<input name="tags" value="${esc(q.tags.join("，"))}"></label><label class="field">阅读材料<textarea name="material" rows="4">${esc(q.material)}</textarea></label><label class="field">解析<textarea name="explanation" rows="5">${esc(q.explanation)}</textarea></label><button class="primary" type="submit">保存修改</button></form>`;
  $(".dialog-close", d).onclick = () => d.close();
  $("#edit-form", d).onsubmit = handle(async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const lines = data.options.split("\n").filter((x) => x.trim());
    const opts = {};
    for (const line of lines) {
      const m = line.match(/^([A-H])\s*=\s*(.*)$/);
      if (!m) throw new Error("选项格式应为 A=内容，每行一个");
      if (opts[m[1]]) throw new Error("选项标签重复");
      opts[m[1]] = m[2];
    }
    data.options = opts;
    if (!/^[A-H,，\s]*$/.test(data.answer.toUpperCase()))
      throw new Error("答案只能填写 A-H");
    data.answer = unique(data.answer.toUpperCase().match(/[A-H]/g) || []);
    data.tags = data.tags
      .split(/[,，]/)
      .map((x) => x.trim())
      .filter(Boolean);
    data.issues = data.quality === "ready" ? [] : q.issues;
    await api("/api/edit/" + q.id, data);
    toast("题目已更新");
    d.close();
    await questionDetail(q.id);
  });
}
export async function renderLibrary(root, meta, view, params) {
  const defaults = {
    page: 1,
    module: "",
    category: "",
    topic: "",
    paper_id: "",
    quality: "",
    type: "",
    year: "",
    kind: "",
    exam_level: "",
    tag: "",
    search: "",
  };
  const state = {
    ...defaults,
    ...params,
    page: Math.max(1, Number(params.page) || 1),
  };
  let scope = ["all", "unseen", "wrong", "favorite"].includes(params.scope)
    ? params.scope
    : view === "review"
      ? "wrong"
      : "all";
  delete state.scope;
  if (view === "library" && params.view === "papers") return renderPapers(root, meta, params);
  delete state.view;
  let seq = 0;
  const wrongModules = Object.entries(meta.counts.wrong_modules || {}).sort((a, b) => b[1] - a[1]);
  const wrongStrip =
    view === "review"
      ? `<section class="wrong-strip" aria-label="各科目错题">${
          wrongModules.length
            ? wrongModules
                .map(
                  ([m, n]) =>
                    `<button class="card wrong-tile ${state.module === m && scope === "wrong" ? "selected" : ""}" data-wrong-module="${esc(m)}"><span>${esc(m)}</span><b class="num">${num(n)}</b><small>道待复习</small></button>`,
                )
                .join("")
            : '<div class="card wrong-tile empty-tile"><span>暂时没有错题</span><small>练习中答错的题会自动收进这里</small></div>'
        }<a class="card wrong-tile fav-tile ${scope === "favorite" ? "selected" : ""}" href="#review?scope=favorite"><span>${icon("star")}我的收藏</span><b class="num">${num(meta.counts.favorites)}</b><small>道题</small></a></section>`
      : "";
  root.innerHTML = `<header class="page-heading"><div><h1>${view === "review" ? "错题收藏" : "题库"}</h1><p>${
    view === "review"
      ? `错题按每道题最近一次作答判断，共 ${num(meta.counts.wrong)} 道待复习。`
      : `${num(meta.counts.total)} 道题 · ${num(meta.counts.ready)} 道可练习 · ${num(meta.counts.review)} 道待核验`
  }</p></div>${view === "library" ? libraryTabs("questions") : ""}</header>
    ${wrongStrip}
    <section class="card library-filters" id="library-filters" aria-label="题库筛选">
      <div class="filter-main"><label class="search-control"><span class="visually-hidden">搜索题目</span>${icon("search")}<input name="search" type="search" placeholder="搜索题干、知识点或解析" value="${esc(state.search)}"></label>
      <label>学习科目<select name="module">${options(unique(meta.facets.map((f) => f.module)), state.module, "全部科目")}</select></label><label>试卷类型<select name="kind">${options(unique(meta.papers.map((p) => p.kind)), state.kind)}</select></label><button class="secondary" id="reset-filters" hidden>清除筛选</button></div>
      <details class="advanced-filters" ${["exam_level", "year", "category", "paper_id", "type", "quality", "topic", "tag"].some((k) => state[k]) ? "open" : ""}><summary>更多筛选 · 年份、试卷、题型与考点</summary><div class="filter-grid">
      <label>试卷类别<select name="exam_level">${options(unique(meta.papers.map((p) => p.exam_level)), state.exam_level)}</select></label><label>年份<select name="year">${options(
        unique(meta.papers.map((p) => p.year)).sort((a, b) => b - a),
        state.year,
      )}</select></label>
      <label>知识小类<select name="category"></select></label><label>试卷<select name="paper_id"></select></label><label>题型<select name="type">${options(
        [
          ["single", "单选"],
          ["multiple", "多选"],
          ["essay", "申论主观题"],
        ],
        state.type,
      )}</select></label>
      <label>核验状态<select name="quality">${options(
        [
          ["ready", "可练习"],
          ["review", "待核验"],
        ],
        state.quality,
      )}</select></label><label>考点<select name="topic"></select></label><label>标签<select name="tag">${options(meta.tags, state.tag)}</select></label></div></details>
      <div id="filter-summary" class="filter-summary"></div>
    </section>
    <div class="library-toolbar"><div class="segmented" role="group" aria-label="题目范围">${[
      ["all", "全部题目"],
      ["unseen", "未做"],
      ["wrong", "错题"],
      ["favorite", "收藏"],
    ]
      .map(
        ([k, t]) =>
          `<button data-scope="${k}" class="${scope === k ? "selected" : ""}" aria-pressed="${scope === k}">${t}</button>`,
      )
      .join(
        "",
      )}</div><div class="toolbar practice-controls"><label class="inline-field">方式<select id="practice-mode"><option value="practice">练习模式</option><option value="exam">考试模式</option></select></label><label class="inline-field">题量<select id="practice-count"><option>10</option><option selected>20</option><option>30</option><option>50</option></select></label><button id="practice-paper" class="secondary" hidden disabled title="请在更多筛选中选择一套试卷">整卷练习</button><button id="practice-current" class="primary">${icon("play")}${view === "review" ? "用这些题练习" : "开始练习"}</button></div></div>
    <section class="card paper results-card"><div class="results-heading"><h2 id="result-count" aria-live="polite">正在查找题目…</h2><span class="caption">点题目查看解析与笔记</span></div><div id="questions-list" class="question-list" aria-label="题目列表"></div><div id="pagination" class="pagination"></div></section><p class="caption">错题按最近一次作答判断；待核验题默认不参与练习。题库题数按卷内题次统计。</p>`;
  $$("[data-wrong-module]", root).forEach(
    (b) =>
      (b.onclick = () => {
        const m = b.dataset.wrongModule;
        location.hash = `review?${query(state.module === m && scope === "wrong" ? {} : { module: m })}`;
      }),
  );
  function filters() {
    return { ...state, ...(scope !== "all" ? { [scope]: "1" } : {}) };
  }
  const facets = () => cascadeFacets(root, meta.facets, state);
  function paperOptions() {
    const papers = meta.papers.filter(
      (p) =>
        (!state.module ||
          paperSubject(p) === state.module ||
          (!["行测", "申论"].includes(paperSubject(p)) &&
            !["行测", "申论"].includes(state.module))) &&
        (!state.kind || p.kind === state.kind) &&
        (!state.exam_level || p.exam_level === state.exam_level) &&
        (!state.year || String(p.year) === String(state.year)),
    );
    if (!papers.some((p) => p.id === state.paper_id)) state.paper_id = "";
    $("[name=paper_id]", root).innerHTML = options(
      papers.map((p) => [p.id, p.title]),
      state.paper_id,
    );
    $("#practice-paper", root).disabled = !state.paper_id;
    $("#practice-paper", root).hidden = !state.paper_id;
    $("#practice-paper", root).title = state.paper_id
      ? "练习所选试卷全部可练习题，忽略其他题目筛选"
      : "请在更多筛选中选择一套试卷";
  }
  function syncURL() {
    // replaceState keeps typing and dropdown changes in one history entry.
    const q = query({
      ...state,
      page: state.page === 1 ? "" : state.page,
      scope: scope === (view === "review" ? "wrong" : "all") ? "" : scope,
    });
    if (document.contains(root) && location.hash.split("?")[0] === `#${view}`)
      history.replaceState(null, "", `#${view}${q ? "?" + q : ""}`);
    try {
      sessionStorage.setItem("finreg-library-route", location.hash);
    } catch {}
    const selected = $$("#library-filters select", root)
      .filter((e) => e.value)
      .map((e) => e.selectedOptions[0]?.textContent);
    if (state.search) selected.push(`关键词：${state.search}`);
    $("#reset-filters", root).hidden = !selected.length;
    $("#filter-summary", root).innerHTML = selected.length
      ? `<strong>已筛选 ${selected.length} 项</strong><span class="muted">${esc(selected.join(" / "))}</span>`
      : "";
  }
  function scrollToList() {
    $("#result-count", root).scrollIntoView({ block: "start" });
  }
  async function load() {
    if (!root.isConnected) return;
    const n = ++seq;
    const list = $("#questions-list", root);
    list.setAttribute("aria-busy", "true");
    $("#practice-current", root).disabled = true;
    syncURL();
    let d;
    try {
      d = await api("/api/questions?" + query(filters()));
    } catch (e) {
      if (n !== seq || !root.isConnected) return;
      list.removeAttribute("aria-busy");
      list.innerHTML = `<div class="empty"><h3>题目载入失败</h3><p>${esc(e.message)}</p><button class="secondary" id="retry-questions">重试</button></div>`;
      $("#result-count", root).textContent = "暂时无法载入";
      $("#pagination", root).innerHTML = "";
      $("#retry-questions", root).onclick = handle(load);
      return;
    }
    if (n !== seq || !root.isConnected) return;
    if (d.pages && state.page > d.pages) {
      state.page = d.pages;
      return load();
    }
    list.removeAttribute("aria-busy");
    $("#practice-current", root).disabled =
      !d.total || state.quality === "review";
    $("#result-count", root).textContent =
      `${scope === "wrong" ? "待复习错题" : scope === "favorite" ? "已收藏题目" : "筛选结果"} · ${num(d.total)} 道`;
    list.innerHTML = d.items.length
      ? d.items
          .map(
            (q) =>
              `<article class="question-preview"><div class="question-meta"><span class="badge">${esc(q.module)}</span><span>${esc(q.category)}</span><span class="q-sub">${q.year || ""} · 第${q.number}题 · ${typeLabel(q.type)}</span>${q.quality === "review" ? '<span class="pill warn">待核验</span>' : ""}${q.last_correct === 0 ? '<span class="pill bad">错题</span>' : ""}</div><button class="question-title" data-id="${esc(q.id)}">${esc(q.stem.replace(/\[\[image:[^\]]+\]\]/g, "[题图]").slice(0, 220))}</button><div class="question-bottom"><span>${esc(q.source)}</span><button class="quiet fav-button ${q.favorite ? "on" : ""}" data-favorite="${esc(q.id)}" data-value="${q.favorite}" aria-pressed="${Boolean(q.favorite)}">${icon("star")}<span>${q.favorite ? "已收藏" : "收藏"}</span></button></div></article>`,
          )
          .join("")
      : `<div class="empty"><h2>${scope === "wrong" ? "当前没有待复习错题" : scope === "favorite" ? "还没有符合条件的收藏" : "没有找到符合条件的题目"}</h2><p>${scope === "wrong" ? "完成练习后，答错的题目会自动收录在这里。" : "试试减少筛选条件，或在题目详情中收藏重点题。"}</p><button class="secondary" id="empty-reset">清除条件，查看全部题目</button></div>`;
    $("#pagination", root).innerHTML =
      `<span>第 ${d.page} / ${d.pages || 1} 页 · 每页 20 道</span>${d.pages > 1 ? `<label>前往<input id="jump-page" type="number" min="1" max="${d.pages}" value="${d.page}" aria-label="跳转页码"></label><button class="secondary" id="go-page">跳转</button>` : ""}<button class="secondary" id="prev-page" ${d.page <= 1 ? "disabled" : ""}>上一页</button><button class="secondary" id="next-page" ${d.page >= d.pages ? "disabled" : ""}>下一页</button>`;
    $$("[data-id]", root).forEach(
      (b) => (b.onclick = handle(() => questionDetail(b.dataset.id))),
    );
    $$("[data-favorite]", root).forEach(
      (b) =>
        (b.onclick = handle(async () => {
          await api("/api/mark/" + b.dataset.favorite, {
            favorite: b.dataset.value !== "1",
          });
          await load();
        })),
    );
    $("#prev-page", root).onclick = handle(async () => {
      state.page--;
      await load();
      scrollToList();
    });
    $("#next-page", root).onclick = handle(async () => {
      state.page++;
      await load();
      scrollToList();
    });
    const jump = $("#go-page", root);
    if (jump) {
      jump.onclick = handle(async () => {
        state.page = Math.max(
          1,
          Math.min(d.pages, Number($("#jump-page", root).value) || 1),
        );
        await load();
        scrollToList();
      });
      $("#jump-page", root).onkeydown = (e) => {
        if (e.key === "Enter") jump.click();
      };
    }
    const reset = $("#empty-reset", root);
    if (reset) reset.onclick = handle(() => clear(true));
  }
  let debounce;
  async function clear(all = false) {
    clearTimeout(debounce);
    Object.assign(state, defaults);
    if (all) scope = "all";
    $$("#library-filters select, #library-filters input", root).forEach(
      (e) => (e.value = ""),
    );
    updateScope();
    facets();
    paperOptions();
    await load();
  }
  function updateScope() {
    $$("[data-scope]", root).forEach((b) => {
      b.classList.toggle("selected", b.dataset.scope === scope);
      b.setAttribute("aria-pressed", b.dataset.scope === scope);
    });
  }
  facets();
  paperOptions();
  $("#reset-filters", root).onclick = handle(() => clear());
  $$("#library-filters select", root).forEach(
    (e) =>
      (e.onchange = handle(async () => {
        state[e.name] = e.value;
        state.page = 1;
        if (e.name === "module") {
          state.category = "";
          state.topic = "";
          facets();
        }
        if (e.name === "category") {
          state.topic = "";
          facets();
        }
        paperOptions();
        await load();
      })),
  );
  $("[name=search]", root).oninput = (e) => {
    state.search = e.target.value;
    state.page = 1;
    clearTimeout(debounce);
    debounce = setTimeout(handle(load), 250);
  };
  $$("[data-scope]", root).forEach(
    (b) =>
      (b.onclick = handle(async () => {
        scope = b.dataset.scope;
        state.page = 1;
        updateScope();
        await load();
      })),
  );
  $("#practice-current", root).onclick = handle(() =>
    startPractice({
      filters: filters(),
      mode:
        $("#practice-mode", root).value === "exam"
          ? "exam"
          : scope === "wrong"
            ? "review"
            : "practice",
      count: Number($("#practice-count", root).value),
      title:
        scope === "wrong" ? "错题复习" : `${state.module || "综合"}专项练习`,
    }),
  );
  $("#practice-paper", root).onclick = handle(() =>
    startPractice({
      filters: { paper_id: state.paper_id },
      mode: $("#practice-mode", root).value,
      full_paper: true,
      shuffle: false,
      title: meta.papers.find((p) => p.id === state.paper_id).title,
    }),
  );
  await load();
}
