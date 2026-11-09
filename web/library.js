import {
  $,
  $$,
  esc,
  rich,
  api,
  query,
  options,
  unique,
  heading,
  sourceLink,
  modal,
  toast,
  startPractice,
  handle,
  paperSubject,
} from "./ui.js";
export async function questionDetail(id) {
  const q = await api("/api/question/" + encodeURIComponent(id) + "?answer=1");
  const d = modal(
    `<p class="caption">${esc(q.source)} · 第${q.number}题</p><h2>${q.type === "essay" ? "申论主观题" : q.type === "multiple" ? "多选题" : "单选题"} <span class="badge ${q.quality === "review" ? "warn" : ""}">${q.quality === "review" ? "待核验" : "可练习"}</span></h2>${q.issues.length ? `<div class="notice">${q.issues.map(esc).join("；")}</div>` : ""}${q.material ? `<details class="material" open><summary>阅读材料</summary><div class="prose">${rich(q.material)}</div></details>` : ""}<div class="prose question-stem">${rich(q.stem)}</div><div class="detail-options">${Object.entries(
      q.options,
    )
      .map(([k, v]) => `<p><b>${k}.</b> ${rich(v)}</p>`)
      .join(
        "",
      )}</div><div class="answer-box"><strong>来源参考答案：${q.type === "essay" ? "见下方文字解析" : q.answer.join("、") || "未提供"}</strong><div class="prose">${rich(q.explanation) || "来源暂未提供文字解析。请结合原卷或课程核对。"}</div></div><p>${sourceLink(q)}</p><div class="toolbar"><button id="detail-favorite" class="secondary">${q.favorite ? "取消收藏" : "收藏题目"}</button><button id="detail-edit" class="secondary">编辑 / 核验</button></div><label class="field">我的笔记<textarea id="detail-note" rows="3">${esc(q.note)}</textarea></label><button id="save-note" class="primary">保存笔记</button>${q.provider ? `<details class="raw"><summary>来源字段 · ${esc(q.provider)} / ${esc(q.external_id)} · 难度 ${q.difficulty ?? "未提供"}</summary><p class="caption">完整原始业务字段保存在本地，未用到的字段也会保留。${q.raw?.platform_statistics?.totalCount != null ? `粉笔平台作答量 ${q.raw.platform_statistics.totalCount} 次，平台正确率 ${Number(q.raw.platform_statistics.correctRatio).toFixed(1)}%（采集时快照，与个人统计分开）。` : ""}</p><pre>${esc(JSON.stringify(q.raw, null, 2))}</pre></details>` : ""}`,
  );
  $("#detail-favorite", d).onclick = handle(async (e) => {
    const v = await api("/api/mark/" + id, { favorite: !q.favorite });
    q.favorite = v.favorite;
    e.target.textContent = q.favorite ? "取消收藏" : "收藏题目";
    toast("已保存");
  });
  $("#save-note", d).onclick = handle(async () => {
    await api("/api/mark/" + id, { note: $("#detail-note", d).value });
    toast("笔记已保存");
  });
  $("#detail-edit", d).onclick = () => edit(q, d);
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
  let seq = 0;
  const count = (n) => Number(n || 0).toLocaleString("zh-CN");
  root.innerHTML =
    heading(
      "",
      view === "review" ? "错题与收藏" : "我的题库",
      view === "review"
        ? "回看错因，留住重点。下一次，答得更有把握。"
        : `${count(meta.counts.total)} 道题已保存 · ${count(meta.counts.ready)} 道可练习 · ${count(meta.counts.review)} 道待核验`,
    ) +
    `
    <section class="card library-filters" id="library-filters" aria-label="题库筛选">
      <div class="filter-main"><label class="search-control">搜索题目<input name="search" type="search" placeholder="搜索题干、知识点或解析" value="${esc(state.search)}"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></label>
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
      )}</div><div class="toolbar"><label class="inline-field">模式<select id="practice-mode"><option value="practice">练习模式</option><option value="exam">考试模式</option></select></label><label class="inline-field">题量<select id="practice-count"><option>10</option><option selected>20</option><option>30</option><option>50</option></select></label><button id="practice-current" class="primary">开始练习</button><button id="practice-paper" class="secondary" hidden disabled title="请在更多筛选中选择一套试卷">整卷练习</button></div></div>
    <div class="results-heading"><h2 id="result-count" aria-live="polite">正在查找题目…</h2><span class="muted">点击题目查看解析与笔记</span></div><section id="questions-list" class="question-list" aria-label="题目列表"></section><div id="pagination" class="pagination"></div><p class="caption">错题按最近一次作答判断；待核验题默认不参与练习。题库题数按卷内题次统计。</p>`;
  function filters() {
    return { ...state, ...(scope !== "all" ? { [scope]: "1" } : {}) };
  }
  function facets() {
    const f = meta.facets.filter(
      (f) => !state.module || f.module === state.module,
    );
    $("[name=category]", root).innerHTML = options(
      unique(f.map((f) => f.category)),
      state.category,
    );
    $("[name=topic]", root).innerHTML = options(
      unique(
        f
          .filter((f) => !state.category || f.category === state.category)
          .map((f) => f.topic),
      ),
      state.topic,
    );
  }
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
      `${scope === "wrong" ? "待复习错题" : scope === "favorite" ? "已收藏题目" : "筛选结果"} · ${count(d.total)} 道`;
    list.innerHTML = d.items.length
      ? d.items
          .map(
            (q) =>
              `<article class="question-preview"><div class="question-meta"><span class="badge">${esc(q.module)}</span><span>${esc(q.category)}</span><span class="muted">${q.year || ""} · 第${q.number}题 · ${q.type === "essay" ? "申论主观题" : q.type === "multiple" ? "多选" : "单选"}</span>${q.quality === "review" ? '<span class="badge warn">待核验</span>' : ""}${q.last_correct === 0 ? '<span class="badge wrong">错题</span>' : ""}</div><button class="question-title" data-id="${esc(q.id)}">${esc(q.stem.replace(/\[\[image:[^\]]+\]\]/g, "[题图]").slice(0, 220))}</button><div class="question-bottom"><span>${esc(q.source)}</span><button class="quiet favorite" data-favorite="${esc(q.id)}" data-value="${q.favorite}" aria-pressed="${Boolean(q.favorite)}">${q.favorite ? "已收藏" : "收藏题目"}</button></div></article>`,
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
